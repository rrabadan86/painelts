'use strict';
/**
 * Confiança nos dados (Vendas → Conferência): junta o que o painel já tem e chama as contas puras de
 * public/js/conferencia.js (uma definição só; o faturamento é o de public/js/contas.js).
 *
 *  - Conferência com o caixa: vendas do painel × fechamento do caixa (src/caixa.js) por dia, últimos 60 dias.
 *  - Cupons cancelados: XMLs em dados/<loja>/xmls/AAAA-MM/cancelados × planilha de vendas; cancelamentos que o caixa
 *    registrou (campo "cancelado" do fechamento); linhas negativas da planilha.
 *  - Saúde dos dados: idade de cada fonte (vendas, estoque, catálogo, notas de compra, XML, FIXE, caixa).
 *
 * Configuração por loja (lojas.json → conferencia): { tolerancia (R$), cancelados: 'avisar' | 'excluir' }.
 * Padrão: tolerância de R$ 1,00 e só avisar (tirar cupom cancelado das vendas muda a comissão: é decisão do dono).
 * Nada aqui grava: só lê.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');
const CX = require('./caixa');
const CF = require('../public/js/conferencia');
const CT = require('../public/js/contas');

const DIAS = 60;
const r2 = (x) => Math.round((+x || 0) * 100) / 100;

function cfg(loja) {
  const c = (loja && loja.conferencia) || {};
  return { tolerancia: Number.isFinite(c.tolerancia) && c.tolerancia >= 0 ? c.tolerancia : CF.TOLERANCIA_PADRAO, cancelados: c.cancelados === 'excluir' ? 'excluir' : 'avisar' };
}
/** confere o que veio da tela → { ok: cfg } ou { erro } */
function validarCfg(b, atual) {
  const out = { ...cfg({ conferencia: atual }) };
  if (b.tolerancia != null) {
    const t = Number(String(b.tolerancia).replace(',', '.'));
    if (!Number.isFinite(t) || t < 0 || t > 1000) return { erro: 'A tolerância precisa ser um valor entre R$ 0,00 e R$ 1.000,00.' };
    out.tolerancia = Math.round(t * 100) / 100;
  }
  if (b.cancelados != null) {
    if (!['avisar', 'excluir'].includes(b.cancelados)) return { erro: 'Escolha "só avisar" ou "tirar das vendas".' };
    out.cancelados = b.cancelados;
  }
  return { ok: out };
}

// ---------- notas canceladas (XML) ----------
const cacheCanc = new Map(); // loja → { sig, notas }
const raizXml = (id) => path.join(C.pastaLoja(id), 'xmls');
const vNF = (txt) => { const m = /<vNF>([\d.]+)<\/vNF>/.exec(txt); return m ? +m[1] : 0; };
/** nota de venda? (devolução, transferência e entrada não são venda) — a mesma regra do e-mail de faturamento */
const ehVenda = (txt) => !require('./xmlarquivos').ehNaoVenda(txt);
/**
 * Notas canceladas guardadas pelo coletor: [{ dia, numero, mod, serie, valor, chave }].
 * O arquivo é AAAAMMDD_<chave>.xml (dia = emissão); a chave traz o modelo (65 = cupom, 55 = nota grande), a série e o número.
 * Os arquivos "_evento_" são o protocolo do cancelamento e não contam de novo.
 */
function notasCanceladas(id) {
  let meses = [];
  try { meses = fs.readdirSync(raizXml(id)).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort(); } catch { cacheCanc.delete(id); return { notas: [], temXml: false }; }
  const pastas = [];
  let sig = '';
  for (const ym of meses) {
    const dir = path.join(raizXml(id), ym, 'cancelados');
    let st; try { st = fs.statSync(dir); } catch { continue; }
    pastas.push(dir); sig += `${ym}:${st.mtimeMs}|`;
  }
  const hit = cacheCanc.get(id);
  if (hit && hit.sig === sig) return hit.val;
  const notas = [];
  for (const dir of pastas) {
    let arqs = []; try { arqs = fs.readdirSync(dir); } catch { continue; }
    for (const f of arqs) {
      const m = /^(\d{4})(\d{2})(\d{2})_(\d{44})\.xml$/.exec(f);
      if (!m) continue; // eventos e nomes fora do padrão
      const ch = m[4];
      let txt = '';
      try { txt = fs.readFileSync(path.join(dir, f), 'latin1'); } catch { continue; }
      if (!ehVenda(txt)) continue;
      notas.push({ dia: `${m[1]}-${m[2]}-${m[3]}`, numero: +ch.slice(25, 34), mod: ch.slice(20, 22), serie: String(+ch.slice(22, 25)), valor: r2(vNF(txt)), chave: ch });
    }
  }
  const val = { notas, temXml: meses.length > 0 };
  cacheCanc.set(id, { sig, val });
  return val;
}

/** tira das vendas os cupons cancelados quando a loja escolheu "tirar das vendas"; senão devolve como veio */
function aplicarCancelados(loja, vendas) {
  const atual = C.get().lojas.find((l) => l.id === loja.id) || loja;
  if (cfg(atual).cancelados !== 'excluir') return { vendas, fora: [] };
  try { return CF.semCancelados(vendas, notasCanceladas(loja.id).notas); } catch (e) { console.error('[conferência] cancelados:', e.message); return { vendas, fora: [] }; }
}

// ---------- saúde: idade das fontes ----------
const mtime = (f) => { try { return fs.statSync(f).mtime.toISOString(); } catch { return null; } };
const lerJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const FONTES = [
  ['vendas', 'Vendas', 'Planilha de vendas do AppNext. É a base de tudo: faturamento, meta e comissão.', 'Configurações → loja → Coletor → "Atualizar agora". Se o robô falhar, envie a planilha em "Enviar planilha".'],
  ['estoque', 'Estoque e custos', 'Planilha "Estoque Atual" do AppNext: saldo e custo de cada produto.', 'O robô baixa junto com as vendas. Sem ele: Configurações → loja → Enviar planilha → "Estoque atual e custos".'],
  ['catalogo', 'Catálogo do Sistema de Pedidos', 'Produtos, preços e disponibilidade no site de pedidos da franquia.', 'O robô lê na última coleta do dia. Confira o login do Sistema de Pedidos em Configurações → loja.'],
  ['compras', 'Notas de compra', 'Notas de entrada do AppNext: custo de cada compra e histórico de preços.', 'Estoque → Notas fiscais → "Sincronizar agora".'],
  ['xml', 'XML dos cupons', 'Notas e cupons emitidos (ativos e cancelados): CPF do cliente e conferência de cancelados.', 'Configurações → loja → Coletor → Histórico → "Só XML".'],
  ['fixe', 'FIXE (fidelidade)', 'Pontos e resgates do programa de fidelidade.', 'Configurações → loja → FIXE: confira o e-mail e peça a exportação de novo.'],
  ['caixa', 'Fechamento do caixa', 'Fechamentos de PDV do AppNext: formas de pagamento, sangria e diferença da gaveta.', 'É lido junto com as vendas. Se o dia não aparece, feche o caixa no AppNext e atualize.'],
];
/** datas da última atualização de cada fonte da loja (o sinal verde/amarelo/vermelho é dado por CF.sinalFonte) */
function fontes(id, agora = Date.now()) {
  const P = C.pastaLoja(id);
  const em = {};
  let detalhe = {};
  try {
    const b = require('./base').resumo(id);
    em.vendas = (b.importacoes && b.importacoes[0] && b.importacoes[0].em) || null;
    detalhe.vendas = b.ultimaVenda ? `última venda em ${b.ultimaVenda.slice(8, 10)}/${b.ultimaVenda.slice(5, 7)}` : '';
  } catch { em.vendas = null; }
  try { const e = require('./estoque').atual(id); em.estoque = e ? e.importadoEm || e.em : null; detalhe.estoque = e && e.itens ? `${e.itens.length} produtos` : ''; } catch { em.estoque = null; }
  { const c = lerJson(path.join(P, 'pedido', 'catalogo.json')); em.catalogo = c ? c.em || mtime(path.join(P, 'pedido', 'catalogo.json')) : null; detalhe.catalogo = c && c.itens ? `${c.itens.length} produtos` : ''; }
  em.compras = mtime(path.join(P, 'estoque', 'compras.json'));
  try { const x = require('./xmlbase').resumo(id); em.xml = (x.importacoes && x.importacoes[0] && x.importacoes[0].em) || null; detalhe.xml = x.ate ? `notas até ${x.ate.slice(8, 10)}/${x.ate.slice(5, 7)}` : ''; } catch { em.xml = null; }
  try { const f = require('./fidelidade').resumo(id); em.fixe = f ? f.em : null; } catch { em.fixe = null; }
  { const j = CX.ler(id); em.caixa = j.atualizado || null; const u = (j.fechamentos || []).reduce((m, f) => (f.fechamento && f.dia > m ? f.dia : m), ''); detalhe.caixa = u ? `último caixa fechado em ${u.slice(8, 10)}/${u.slice(5, 7)}` : ''; }
  return FONTES.map(([k, nome, oque, fazer]) => ({ id: k, nome, oque, fazer, em: em[k] || null, detalhe: detalhe[k] || '', ...CF.sinalFonte({ em: em[k] }, agora) }));
}

// ---------- a resposta da tela ----------
/**
 * Monta a conferência a partir dos dados já lidos (conta pura: a rota real e a apresentação chamam a mesma).
 *   vendas        linhas de venda da loja (já sem os cancelados, se a loja escolheu tirar)
 *   fechamentos   { atualizado, fechamentos: […] } como o coletor grava
 *   notas         notas canceladas (notasCanceladas().notas)
 *   fora          linhas tiradas das vendas por serem de cupom cancelado
 */
function montar({ vendas, fechamentos, notas, temXml, fora, hoje, cfg: cf, dias = DIAS }) {
  const de = CT.isoDe(CT.diaDe(hoje) - dias), ate = hoje;
  const painel = CF.painelPorDia(vendas, de, ate);
  const j = fechamentos || { fechamentos: [] };
  const caixas = new Map(), diasCaixa = [];
  const diasComFech = new Set((j.fechamentos || []).filter((f) => f.fechamento && f.dia >= de && f.dia <= ate).map((f) => f.dia));
  // cancelado, desconto e serviço que o próprio caixa registrou (somados por dia e por operador)
  const pdv = { total: 0, porDia: new Map(), porOperador: new Map() };
  for (const f of j.fechamentos || []) {
    if (!f.fechamento || f.dia < de || f.dia > ate || !(f.cancelado > 0)) continue;
    pdv.total += f.cancelado;
    pdv.porDia.set(f.dia, r2((pdv.porDia.get(f.dia) || 0) + f.cancelado));
    const op = f.opFechamento || f.opAbertura || '(sem operador)';
    pdv.porOperador.set(op, r2((pdv.porOperador.get(op) || 0) + f.cancelado));
  }
  for (const dia of [...diasComFech].sort()) {
    const c = CX.resumir(j, dia);
    if (c.vazio) continue;
    const linha = { dia, total: c.totalVendas, formas: c.formas.map((x) => ({ k: x.k, rot: x.rot, valor: x.valor })), diferenca: c.diferenca, sangria: c.sangria, operadores: c.caixas.map((x) => x.operador).filter(Boolean) };
    caixas.set(dia, linha); diasCaixa.push(linha);
  }
  const canc = CF.cancelados({ notas, vendas, de, ate });
  const canceladosDia = new Map(canc.porDia.filter((d) => d.aindaConta).map((d) => [d.dia, d.aindaConta]));
  const lista = CF.conferir({ de, ate, painel, caixas, canceladosDia, tolerancia: cf.tolerancia, hoje }).map((x) => {
    const c = caixas.get(x.dia);
    return { ...x, gaveta: c ? c.diferenca : null, operador: c ? [...new Set(c.operadores)].join(' + ') : '', canceladoPdv: pdv.porDia.get(x.dia) || 0 };
  });
  const neg = CF.negativas(vendas, de, ate);
  // o que já foi tirado das vendas (loja com "tirar das vendas")
  const fr = (fora || []).filter((v) => v.data >= de && v.data <= ate && CT.contaFat(v.descricao, v.vu));
  const excluidos = { cupons: new Set(fr.map((v) => v.cupom + '|' + v.data)).size, valor: r2(fr.reduce((s, v) => s + (v.vt || 0), 0)) };
  return {
    cfg: cf, hoje, de, ate, dias,
    caixaLido: j.atualizado || null, temCaixa: (j.fechamentos || []).length > 0,
    lista, resumo: CF.resumo(lista), recentes: CF.recentesQueNaoBatem(lista, hoje).map((x) => ({ dia: x.dia, dif: x.dif })),
    formas: CF.formasPeriodo(diasCaixa), sobras: CF.sobrasFaltas(diasCaixa, cf.tolerancia),
    cancelados: { ...canc, temXml: !!temXml, negativas: neg, excluidos,
      pdv: { total: r2(pdv.total), porDia: [...pdv.porDia].map(([dia, valor]) => ({ dia, valor })).sort((a, b) => (a.dia < b.dia ? 1 : -1)), porOperador: [...pdv.porOperador].map(([operador, valor]) => ({ operador, valor })).sort((a, b) => b.valor - a.valor) } },
  };
}

/** conferência de uma loja de verdade */
function daLoja(loja, vendas, fora, hoje) {
  const atual = C.get().lojas.find((l) => l.id === loja.id) || loja;
  const nc = notasCanceladas(loja.id);
  return { ...montar({ vendas, fechamentos: CX.ler(loja.id), notas: nc.notas, temXml: nc.temXml, fora, hoje, cfg: cfg(atual) }), fontes: fontes(loja.id) };
}

// ---------- apresentação: caixa e cancelados fictícios, coerentes com as vendas fictícias ----------
function demo(parte, hoje) {
  const de = CT.isoDe(CT.diaDe(hoje) - DIAS);
  const painel = CF.painelPorDia(parte.vendas, de, hoje);
  const dias = [...painel.keys()].filter((d) => d < hoje).sort();
  const OPS = ['Operadora Ana', 'Operadora Bia', 'Operador Caio'];
  const fechamentos = [];
  dias.forEach((dia, k) => {
    const p = painel.get(dia), n = dias.length - 1 - k; // n = há quantos dias de venda
    if (n === 0) return; // ontem: o caixa ainda não foi lido
    let total = r2(p.fat + p.taxas + p.centavos);
    if (n === 4) total = r2(total + 37.9); // um dia que não bate
    if (n === 11) total = r2(total - 120); // caixa fechado depois da meia-noite: parte cai no dia seguinte
    if (n === 10) total = r2(total + 120);
    if (n === 17) total = r2(total - 15.5);
    const gaveta = n === 6 ? -12 : n === 13 ? 5 : n === 20 ? -8.5 : n === 27 ? -20 : n === 34 ? 3 : 0;
    const formas = [['Cartão de Crédito', 0.5], ['Cartão de Débito', 0.22], ['Pix', 0.22]].map(([forma, x]) => ({ forma, venda: r2(total * x), informado: r2(total * x), dif: 0 }));
    formas.push({ forma: 'Dinheiro', venda: r2(total - formas.reduce((s, f) => s + f.venda, 0)), informado: 0, dif: 0 });
    const dinheiro = formas[3].venda;
    fechamentos.push({ id: 'd' + k, numero: k + 1, dia, pdv: 1, turno: 'Único', abertura: dia + 'T10:00:00', fechamento: dia + 'T22:05:00', opAbertura: OPS[k % 3], opFechamento: OPS[(k + (n % 2)) % 3],
      fundoInicial: 300, reserva: r2(300 + dinheiro - 50 + gaveta), cancelado: n % 9 === 2 ? 42.9 : 0, desconto: 0, servico: p.taxas,
      recebimentos: formas, sangrias: [{ hora: dia + 'T21:50:00', valor: 50, motivo: 'Depósito', reserva: false }], suprimentos: [] });
  });
  // cancelados: dois cupons que continuam nas vendas e um que não aparece
  const recentes = parte.vendas.filter((v) => v.data >= CT.isoDe(CT.diaDe(hoje) - 25) && v.data < hoje && CT.contaFat(v.descricao, v.vu));
  const porCupom = new Map();
  for (const v of recentes) { const k = v.cupom + '|' + v.data; const a = porCupom.get(k) || { numero: v.cupom, dia: v.data, valor: 0 }; a.valor += v.vt || 0; porCupom.set(k, a); }
  const cups = [...porCupom.values()];
  const notas = [cups[Math.floor(cups.length * 0.2)], cups[Math.floor(cups.length * 0.7)]].filter(Boolean).map((c) => ({ dia: c.dia, numero: c.numero, mod: '65', serie: '1', valor: r2(c.valor), chave: null }));
  if (cups.length) notas.push({ dia: cups[Math.floor(cups.length / 2)].dia, numero: 990001, mod: '65', serie: '1', valor: 89.9, chave: null });
  const agora = Date.now(), ha = (h) => new Date(agora - h * 3600e3).toISOString();
  const idade = { vendas: 2, estoque: 2, catalogo: 14, compras: 20, xml: 50, fixe: 110, caixa: 2 };
  return { ...montar({ vendas: parte.vendas, fechamentos: { atualizado: ha(2), fechamentos }, notas, temXml: true, fora: [], hoje, cfg: cfg(null) }), demo: true,
    fontes: FONTES.map(([k, nome, oque, fazer]) => ({ id: k, nome, oque, fazer, em: ha(idade[k]), detalhe: '', ...CF.sinalFonte({ em: ha(idade[k]) }, agora) })) };
}

module.exports = { cfg, validarCfg, notasCanceladas, aplicarCancelados, fontes, montar, daLoja, demo, DIAS };
