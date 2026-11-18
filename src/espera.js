'use strict';
/**
 * Lista de espera: cliente pede um produto que acabou; quando chega (nota de entrada ou estoque voltando),
 * o pedido vira "chegou", alguém avisa pelo WhatsApp e o painel confere se o cliente comprou em até 7 dias.
 *   dados/<loja>/espera.json = { pedidos: [...], modelo }
 * Pedido: { id, criadoEm, por, cliente: { cpf, nome, celular }, itens: [{ desc, cod, qtd }], obs, estoqueCods, zerado,
 *           st: esperando | chegou | avisado | comprou | naocomprou | cancelado,
 *           chegou: { em, nf, origem }, avisado: { em, por }, compra: { data, cupom, levou }, fim, cancelado: { em, por } }
 * Nada é descontado do estoque (o cliente nem sempre compra).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');

const DIAS_COMPRA = 7;
const MODELO_PADRAO = 'Oi, {nome}! Tudo bem? Aqui é da {loja} 😊 O {produto} que você pediu chegou! Quando quiser, é só passar aqui que separamos para você.';
const arq = (id) => path.join(C.pastaLoja(id), 'espera.json');
const ESQ = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const soDig = (v) => String(v ?? '').replace(/\D/g, '');

function ler(id) {
  try { const j = JSON.parse(fs.readFileSync(arq(id), 'utf8')); return { pedidos: Array.isArray(j.pedidos) ? j.pedidos : [], modelo: j.modelo || MODELO_PADRAO }; } catch { return { pedidos: [], modelo: MODELO_PADRAO }; }
}
function gravar(id, d) { fs.mkdirSync(path.dirname(arq(id)), { recursive: true }); C.gravarAtomico(arq(id), JSON.stringify(d), 0o640); }

// ---------- produto pedido → item do estoque (mesmas regras do custo: código, código do chá + tamanho, nome) ----------
const TAM = /\s*[-–]?\s*\d+\s*(g|gr|grs|gramas)\s*$/i;
const base = (desc) => String(desc || '').replace(TAM, '').trim();
function codsEstoque(item, estoque) {
  const itens = (estoque && estoque.itens) || [];
  const porCod = new Map(itens.map((i) => [String(i.cod), i]));
  const cod = String(item.cod || '');
  const out = new Set();
  if (cod && porCod.has(cod)) out.add(cod);
  if (cod.includes('.') && porCod.has(cod.split('.')[0])) out.add(cod.split('.')[0]);
  if (/^\d{6,}$/.test(cod) && porCod.has(cod.slice(0, -1)) && porCod.get(cod.slice(0, -1)).un === 'Kg') out.add(cod.slice(0, -1));
  if (!out.size) {
    const nD = ESQ(item.desc), nB = ESQ(base(item.desc));
    for (const i of itens) { const n = ESQ(i.desc); if ((i.un === 'Kg' && n === nB) || n === nD) out.add(String(i.cod)); }
  }
  // pelo nome solto ("valeriana", "valeriana 500g"): todas as palavras no nome do item; chá a granel (kg) primeiro
  if (!out.size) {
    const pal = ESQ(base(item.desc)).split(' ').filter((w) => w.length >= 3 && !/^(cha|chas|de|da|do|com)$/.test(w));
    if (pal.length) {
      const cand = itens.filter((i) => { const n = ' ' + ESQ(i.desc) + ' '; return pal.every((w) => n.includes(' ' + w + ' ') || n.includes(' ' + w)); });
      const kg = cand.filter((i) => i.un === 'Kg');
      for (const i of (kg.length ? kg : cand).slice(0, 3)) out.add(String(i.cod));
    }
  }
  return [...out];
}
const qtdEstoque = (cods, estoque) => cods.reduce((s, c) => { const i = ((estoque && estoque.itens) || []).find((x) => String(x.cod) === c); return s + (i ? Math.max(0, i.qtd || 0) : 0); }, 0);

// ---------- validação ----------
function validarNovo(b, estoque) {
  const cli = b && b.cliente;
  if (!cli || typeof cli !== 'object') return { erro: 'Escolha o cliente.' };
  const nome = txt(cli.nome, 80), cel = soDig(cli.celular).slice(0, 13), cpf = soDig(cli.cpf);
  if (!nome) return { erro: 'Informe o nome do cliente.' };
  if (cel.length < 10) return { erro: 'Informe o celular com DDD (para avisar pelo WhatsApp).' };
  if (cpf && cpf.length !== 11 && cpf.length !== 14) return { erro: 'CPF inválido.' };
  const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 10).map((i) => ({ desc: txt(i && i.desc, 120), cod: txt(i && i.cod, 30) || null, qtd: Math.max(1, Math.min(99, Math.round(+(i && i.qtd) || 1))), generico: !!(i && i.generico) })).filter((i) => i.desc);
  if (!itens.length) return { erro: 'Escolha pelo menos um produto.' };
  const cods = [...new Set(itens.flatMap((i) => codsEstoque(i, estoque)))];
  const nomes = cods.map((c) => { const i = ((estoque && estoque.itens) || []).find((x) => String(x.cod) === c); return i ? `${i.desc}${i.un === 'Kg' ? ' (kg)' : ''}` : c; });
  return { ok: { cliente: { cpf: cpf || null, nome, celular: cel }, itens, obs: txt(b.obs, 300), vendedora: txt(b.vendedora, 60) || null, estoqueCods: cods, estoqueNomes: nomes, zerado: cods.length ? qtdEstoque(cods, estoque) <= 0 : null } };
}

function criar(id, b, por, estoque) {
  const v = validarNovo(b, estoque);
  if (v.erro) return v;
  const d = ler(id);
  const p = { id: crypto.randomBytes(6).toString('hex'), criadoEm: new Date().toISOString(), por, ...v.ok, st: 'esperando' };
  d.pedidos.unshift(p);
  d.pedidos = d.pedidos.slice(0, 3000);
  gravar(id, d);
  return { ok: p };
}

/** ações: avisado, chegou (à mão), cancelar, reabrir, vendedora */
function acao(id, pid, a, por, extra) {
  const d = ler(id);
  const p = d.pedidos.find((x) => x.id === pid);
  if (!p) return { erro: 'Pedido não encontrado.' };
  const agora = new Date().toISOString();
  const vend = txt(extra && extra.vendedora, 60) || null;
  if (a === 'avisado') {
    if (['comprou', 'naocomprou', 'cancelado'].includes(p.st)) return { erro: 'Este pedido já foi encerrado.' };
    if (!p.chegou) p.chegou = { em: agora, origem: 'manual', por };
    const vFinal = vend || p.vendedora || null;
    p.avisado = { em: agora, por, ...(vFinal ? { vendedora: vFinal } : {}) };
    if (!p.vendedora && vFinal) p.vendedora = vFinal;
    p.st = 'avisado';
  }
  else if (a === 'chegou') { if (p.st !== 'esperando') return { erro: 'Só pedidos esperando.' }; p.chegou = { em: agora, origem: 'manual', por }; p.st = 'chegou'; }
  else if (a === 'cancelar') { if (['comprou', 'cancelado'].includes(p.st)) return { erro: 'Este pedido já foi encerrado.' }; p.cancelado = { em: agora, por }; p.antes = p.st; p.st = 'cancelado'; }
  else if (a === 'reabrir') { if (p.st !== 'cancelado' && p.st !== 'naocomprou') return { erro: 'Só pedidos cancelados ou sem compra.' }; p.st = p.avisado && p.st === 'naocomprou' ? 'avisado' : p.antes || (p.chegou ? 'chegou' : 'esperando'); if (p.st === 'avisado') p.avisado.em = agora; delete p.cancelado; delete p.fim; }
  else if (a === 'vendedora') { p.vendedora = vend; }
  else return { erro: 'Ação inválida.' };
  gravar(id, d);
  return { ok: p };
}

function salvarModelo(id, modelo) {
  const m = txt(modelo, 600);
  if (!m) return { erro: 'A mensagem está vazia.' };
  const d = ler(id); d.modelo = m; gravar(id, d);
  return { ok: m };
}

/**
 * Atualiza o andamento: chegada (nota de entrada com o produto, ou estoque que voltou), compra (cupom com CPF ou
 * pontos no FIXE desde a chegada) e "não comprou" (7 dias depois do aviso). Devolve os pedidos que acabaram de chegar.
 *   ctx: { notas (ES.notas), estoque (ES.atual), xml: [{ cpf, cupom, data }], fixe: [{ cpf, data, tipo }], vendas: [{ cupom, data, descricao }] }
 */
function avaliar(id, ctx) {
  const d = ler(id);
  if (!d.pedidos.length) return [];
  const novos = [];
  let mudou = false;
  const notas = ((ctx.notas && ctx.notas.notas) || []).map((n) => ({ ...n, dia: String(n.entrada || n.emissao || '').slice(0, 10) }));
  const estEm = ctx.estoque && ctx.estoque.em ? Date.parse(ctx.estoque.em) : 0;
  // compras por CPF: cupons com CPF na nota e compras no FIXE
  const compras = new Map();
  const add = (cpf, c) => { if (!cpf) return; (compras.get(cpf) || compras.set(cpf, []).get(cpf)).push(c); };
  for (const x of ctx.xml || []) add(x.cpf, { data: x.data, cupom: x.cupom });
  for (const e of ctx.fixe || []) if (e.tipo === 'pontos' || e.tipo === 'compra') add(e.cpf, { data: e.data, cupom: null, fixe: true });
  const itensCupom = new Map();
  if (ctx.vendas) for (const v of ctx.vendas) { const k = v.cupom + '|' + v.data; (itensCupom.get(k) || itensCupom.set(k, []).get(k)).push(ESQ(v.descricao)); }
  const agora = Date.now();
  for (const p of d.pedidos) {
    if (p.st === 'esperando') {
      const desde = p.criadoEm.slice(0, 10);
      const nf = notas.filter((n) => n.dia >= desde && n.itens.some((i) => (p.estoqueCods || []).includes(String(i.cod)))).sort((a, b) => (a.dia < b.dia ? -1 : 1))[0];
      if (nf) {
        const vi = nf.itens.filter((i) => (p.estoqueCods || []).includes(String(i.cod)));
        const veio = vi.map((i) => `${String(i.un || '').toLowerCase() === 'kg' ? String(i.qtd).replace('.', ',') + ' kg' : (i.qtd ?? '') + ' ' + String(i.un || 'un').toLowerCase()} de ${i.nome}`).join(', ');
        p.chegou = { em: new Date(nf.dia + 'T12:00:00-03:00').toISOString(), nf: `${nf.nf ?? ''}${nf.serie ? '/' + nf.serie : ''}`, fornecedor: nf.fornecedor || '', origem: 'nota', veio };
      }
      else if (p.zerado && estEm > Date.parse(p.criadoEm) && (p.estoqueCods || []).length && qtdEstoque(p.estoqueCods, ctx.estoque) > 0) p.chegou = { em: new Date(estEm).toISOString(), origem: 'estoque' };
      if (p.chegou) { p.st = 'chegou'; mudou = true; novos.push(p); }
    }
    if ((p.st === 'chegou' || p.st === 'avisado') && p.cliente.cpf) {
      const desde = String((p.chegou && p.chegou.em) || p.criadoEm).slice(0, 10);
      const cs = (compras.get(p.cliente.cpf) || []).filter((c) => c.data >= desde).sort((a, b) => (a.data < b.data ? -1 : 1));
      if (cs.length) {
        const nomes = p.itens.map((i) => ESQ(i.desc)), bases = p.itens.map((i) => ESQ(base(i.desc)));
        const casa = (n) => nomes.includes(n) || bases.some((b) => b && (ESQ(base(n)) === b || (' ' + n + ' ').includes(' ' + b + ' ')));
        const levouEm = cs.find((c) => c.cupom != null && (itensCupom.get(c.cupom + '|' + c.data) || []).some(casa));
        const c = levouEm || cs[0];
        p.compra = { data: c.data, cupom: c.cupom, levou: !!levouEm, fixe: !!c.fixe };
        p.st = 'comprou'; p.fim = new Date().toISOString(); mudou = true;
        continue;
      }
    }
    if (p.st === 'avisado' && agora - Date.parse(p.avisado.em) > DIAS_COMPRA * 864e5) { p.st = 'naocomprou'; p.fim = new Date().toISOString(); mudou = true; }
  }
  if (mudou) gravar(id, d);
  return novos;
}

/** para o Pedido: por item do estoque, quantos pedidos esperando (e a soma pedida) */
function resumoPorCod(id) {
  const out = {};
  for (const p of ler(id).pedidos) {
    if (p.st !== 'esperando') continue;
    for (const c of p.estoqueCods || []) { const a = out[c] || (out[c] = { pedidos: 0, clientes: [] }); a.pedidos++; if (a.clientes.length < 5) a.clientes.push(p.cliente.nome.split(' ')[0]); }
  }
  return out;
}

module.exports = { ler, criar, acao, salvarModelo, avaliar, resumoPorCod, codsEstoque, MODELO_PADRAO, DIAS_COMPRA, ESQ };
