'use strict';
/**
 * Validade e lotes do chá a granel (só o chá em kg tem validade; envasado e acessório não).
 *  - cada entrada de chá a granel (nota de compra concluída no AppNext) é um lote;
 *  - validade padrão = 12 meses da data de entrada; a equipe digita o nº do lote (vem "0") e pode corrigir a validade;
 *  - saldo de cada lote: o estoque atual do AppNext distribuído de trás para frente (a entrada mais nova fica com o
 *    que sobrou primeiro: o mais antigo foi vendido antes, regra PEPS). Assim o saldo nunca diverge do estoque real;
 *  - o que o estoque tem a mais do que as entradas conhecidas vira "saldo sem nota" (sem data: a equipe informa).
 * Edições em dados/<loja>/validade/lotes.json: { lotes: { chave: { lote, validade, por, em } } }
 * chave do lote = "<nº da NF>|<código>|<AAAA-MM-DD da entrada>"; saldo sem nota = "inicial|<código>".
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');
const ES = require('./estoque');

const MESES_VALIDADE = 12;
// faixas por dias para vencer: vencido < 0 ≤ crítica < 30 ≤ ação < 60 ≤ atenção < 90 ≤ saudável
const FAIXAS = [
  { id: 'vencido', nome: 'Vencido', ate: 0 },
  { id: 'critica', nome: 'Crítica', ate: 30 },
  { id: 'acao', nome: 'Ação', ate: 60 },
  { id: 'atencao', nome: 'Atenção', ate: 90 },
  { id: 'ok', nome: 'Saudável', ate: Infinity },
];
const RISCO_DIAS = 60; // valor em risco: o que vence em menos de 60 dias (inclui vencido)
const DIA = /^\d{4}-\d{2}-\d{2}$/;
// envasado cadastrado em kg por engano: pelo nome (lata, minitin, sachê, caixa, kit ou com o tamanho "20G")
const ENVASADO = /\b(LATA|MINITIN|MINI TIN|SACH[EÊ]S?|CAIXA|KIT)(?![A-Z0-9])|\b\d+\s*G\b/i;

const arq = (id) => path.join(C.pastaLoja(id), 'validade', 'lotes.json');
function ler(id) {
  try { const j = JSON.parse(fs.readFileSync(arq(id), 'utf8')); return j && typeof j.lotes === 'object' ? j : { lotes: {} }; } catch { return { lotes: {} }; }
}
function gravar(id, d) { fs.mkdirSync(path.dirname(arq(id)), { recursive: true }); C.gravarAtomico(arq(id), JSON.stringify(d), 0o640); }

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const ms = (d) => Date.parse(d + 'T00:00:00Z');
function somarMeses(d, n) {
  const [a, m, dd] = d.split('-').map(Number);
  const x = new Date(Date.UTC(a, m - 1 + n, 1));
  const ult = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); // 29/02 → 28/02
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), Math.min(dd, ult))).toISOString().slice(0, 10);
}
const dias = (de, ate) => Math.round((ms(ate) - ms(de)) / 864e5);
function faixa(d) {
  if (d == null) return 'sem';
  return FAIXAS.find((f) => d < f.ate).id;
}

/** preço de venda por kg do chá a granel: o pacote (100 g de preferência) da tabela de preços → R$/kg */
const TAM_G = /(\d{2,4})\s*(g|gr|grs|gramas)\b/i;
const cachePrecos = new WeakMap(); // tabela → (itens do estoque → preços)
function precosKg(tabela, estoque) {
  if (!tabela || !estoque || !Array.isArray(estoque.itens)) return new Map();
  let porTab = cachePrecos.get(tabela);
  if (!porTab) { porTab = new WeakMap(); cachePrecos.set(tabela, porTab); }
  const hit = porTab.get(estoque.itens);
  if (hit) return hit;
  const ESP = require('./espera');
  const porCod = new Map(estoque.itens.map((x) => [String(x.cod), x]));
  const out = new Map(); // cod do estoque → { g, preco }
  for (const t of (tabela && tabela.itens) || []) {
    const m = TAM_G.exec(t.desc || '');
    if (!m || !(t.preco > 0)) continue;
    const g = +m[1];
    for (const c of ESP.codsEstoque({ cod: t.cod, desc: t.desc }, estoque)) {
      const it = porCod.get(c);
      if (!it || it.un !== 'Kg') continue;
      const atual = out.get(c);
      // 100 g primeiro; senão o menor pacote (preço por kg mais alto, o da prateleira)
      if (!atual || (g === 100 && atual.g !== 100) || (atual.g !== 100 && g < atual.g)) out.set(c, { g, preco: t.preco });
    }
  }
  const r = new Map();
  for (const [c, x] of out) r.set(c, Math.round((x.preco / x.g) * 1000 * 100) / 100);
  porTab.set(estoque.itens, r);
  return r;
}

/**
 * Lotes em aberto do chá a granel.
 * estoque = ES.atual; compras = ES.compras; tabela = TAB.resumo; edits = ler(id); hoje = AAAA-MM-DD
 * → { em, lotes: [{ chave, cod, desc, nf, entrada, qtdEntrada, saldo, lote, validade, padrao, dias, faixa, custoKg, precoKg }] }
 */
function calcular({ estoque, compras, tabela, edits, hoje = hojeSP() }) {
  if (!estoque || !Array.isArray(estoque.itens)) return { em: null, lotes: [] };
  const dEst = String(estoque.em || '').slice(0, 10);
  const ed = (edits && edits.lotes) || {};
  const precos = precosKg(tabela, estoque);
  const ent = (compras && compras.itens) || {};
  const lotes = [];
  for (const it of estoque.itens) {
    if (it.un !== 'Kg' || ENVASADO.test(it.desc || '')) continue; // só o chá a granel tem validade (lata, minitin, sachê… não)
    const cod = String(it.cod);
    let resta = Math.max(0, Math.round((Number(it.qtd) || 0) * 1000) / 1000);
    if (!(resta > 0)) continue;
    // entradas que já estavam no estoque exportado (as de depois ainda não contam no saldo), da mais nova para a mais antiga
    const lista = (ent[cod] || []).filter(([dia]) => DIA.test(dia) && (!DIA.test(dEst) || dia <= dEst)).slice().sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
    const vistos = new Set();
    for (const [dia, , nf, qtd] of lista) {
      if (!(resta > 1e-9)) break;
      let chave = `${nf}|${cod}|${dia}`;
      for (let k = 2; vistos.has(chave); k++) chave = `${nf}|${cod}|${dia}|${k}`; // o mesmo chá duas vezes na mesma nota
      vistos.add(chave);
      const saldo = Math.min(resta, Number(qtd) || 0);
      resta = Math.round((resta - saldo) * 1000) / 1000;
      if (saldo > 0) lotes.push(montar(chave, it, { nf: String(nf ?? ''), entrada: dia, qtdEntrada: Number(qtd) || 0, saldo }, ed[chave], hoje, precos));
    }
    if (resta > 1e-9) lotes.push(montar(`inicial|${cod}`, it, { nf: '', entrada: null, qtdEntrada: null, saldo: resta }, ed[`inicial|${cod}`], hoje, precos));
  }
  lotes.sort((a, b) => (a.dias ?? -1e9) - (b.dias ?? -1e9) || a.desc.localeCompare(b.desc, 'pt-BR'));
  return { em: estoque.em || null, lotes };
}
function montar(chave, it, base, e, hoje, precos) {
  const padrao = base.entrada ? somarMeses(base.entrada, MESES_VALIDADE) : null;
  const validade = e && DIA.test(e.validade || '') ? e.validade : padrao;
  const d = validade ? dias(hoje, validade) : null;
  return {
    chave, cod: String(it.cod), desc: it.desc || '', ...base, saldo: Math.round(base.saldo * 1000) / 1000,
    lote: (e && e.lote) || '0', validade, padrao: !(e && DIA.test(e.validade || '')), validadePadrao: padrao,
    dias: d, faixa: faixa(d), custoKg: it.custo ?? null, precoKg: precos.get(String(it.cod)) ?? null,
    editadoPor: (e && e.por) || null, editadoEm: (e && e.em) || null,
  };
}

/** totais por faixa (kg, nº de lotes, valor a custo e a venda) e o valor em risco (< 60 dias, inclui vencidos) */
function resumo(lotes) {
  const porFaixa = {};
  for (const f of [...FAIXAS.map((x) => x.id), 'sem']) porFaixa[f] = { lotes: 0, kg: 0, custo: 0, venda: 0 };
  const risco = { lotes: 0, kg: 0, custo: 0, venda: 0, semCusto: 0, semPreco: 0 };
  const r2 = (v) => Math.round(v * 100) / 100;
  for (const l of lotes) {
    const p = porFaixa[l.faixa];
    p.lotes++; p.kg += l.saldo; p.custo += l.saldo * (l.custoKg || 0); p.venda += l.saldo * (l.precoKg || 0);
    if (l.dias != null && l.dias < RISCO_DIAS) {
      risco.lotes++; risco.kg += l.saldo; risco.custo += l.saldo * (l.custoKg || 0); risco.venda += l.saldo * (l.precoKg || 0);
      if (!l.custoKg) risco.semCusto++;
      if (!l.precoKg) risco.semPreco++;
    }
  }
  for (const p of [...Object.values(porFaixa), risco]) { p.kg = Math.round(p.kg * 1000) / 1000; p.custo = r2(p.custo); p.venda = r2(p.venda); }
  return { porFaixa, risco, semLote: lotes.filter((l) => l.lote === '0').length };
}

/** a equipe informa o nº do lote e/ou corrige a validade (validade vazia = volta para 12 meses da entrada) */
function editar(id, b, por, lotesAtuais) {
  const chave = String(b.chave || '');
  const l = lotesAtuais.find((x) => x.chave === chave);
  if (!l) return { erro: 'Lote não encontrado (o estoque pode ter mudado): atualize a tela.' };
  const d = ler(id);
  const atual = d.lotes[chave] || {};
  const novo = { ...atual };
  if (b.lote !== undefined) {
    const lote = String(b.lote ?? '').trim().toUpperCase();
    if (lote && !/^[A-Z0-9][A-Z0-9 ./_-]{0,29}$/.test(lote)) return { erro: 'Lote: use letras, números, ponto, barra ou hífen (até 30).' };
    novo.lote = lote && lote !== '0' ? lote : undefined;
  }
  if (b.validade !== undefined) {
    const v = String(b.validade ?? '').trim();
    if (v === '') novo.validade = undefined;
    else {
      if (!DIA.test(v) || Number.isNaN(ms(v))) return { erro: 'Validade: data inválida.' };
      const min = l.entrada || '2020-01-01', max = somarMeses(l.entrada || hojeSP(), 60);
      if (v < min || v > max) return { erro: `Validade: entre ${min.split('-').reverse().join('/')} e ${max.split('-').reverse().join('/')}.` };
      novo.validade = v;
    }
  }
  if (!novo.lote && !novo.validade) delete d.lotes[chave];
  else d.lotes[chave] = { ...(novo.lote ? { lote: novo.lote } : {}), ...(novo.validade ? { validade: novo.validade } : {}), por: String(por || ''), em: new Date().toISOString() };
  // limpa edições de lotes que já acabaram há mais de 2 anos (o arquivo não cresce sem fim)
  const corte = somarMeses(hojeSP(), -24), vivos = new Set(lotesAtuais.map((x) => x.chave));
  for (const [k, x] of Object.entries(d.lotes)) if (!vivos.has(k) && String(x.em || '').slice(0, 10) < corte) delete d.lotes[k];
  gravar(id, d);
  return { ok: d.lotes[chave] || null, antes: atual };
}

/** lotes da loja já calculados (arquivos do estoque, das compras e da tabela) */
function daLoja(id, hoje) {
  const TAB = require('./tabela');
  return calcular({ estoque: ES.atual(id), compras: ES.compras(id), tabela: TAB.resumo(id), edits: ler(id), hoje });
}

/** bloco do resumo diário (Telegram/e-mail): só quantidades e valor a preço de venda (o custo não sai do painel) */
function linhasResumo(id) {
  const { lotes } = daLoja(id);
  if (!lotes.length) return [];
  const r = resumo(lotes), pf = r.porFaixa;
  if (!pf.vencido.lotes && !pf.critica.lotes && !pf.acao.lotes) return [];
  const kg = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' kg';
  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const top = lotes.filter((l) => l.dias != null && l.dias < 30).slice(0, 5)
    .map((l) => `• ${l.desc}: ${kg(l.saldo)} · ${l.dias < 0 ? `venceu há ${-l.dias} d` : `vence em ${l.dias} d`}`);
  return ['', '🍃 Validade do chá a granel:',
    ...(pf.vencido.lotes ? [`⚫ Vencidos: ${pf.vencido.lotes} lote(s), ${kg(pf.vencido.kg)} — retirar da venda`] : []),
    ...(pf.critica.lotes ? [`🔴 Menos de 30 dias: ${pf.critica.lotes} lote(s), ${kg(pf.critica.kg)}`] : []),
    ...(pf.acao.lotes ? [`🟠 30 a 60 dias: ${pf.acao.lotes} lote(s), ${kg(pf.acao.kg)}`] : []),
    ...(r.risco.venda > 0 ? [`Valor em risco (preço de venda): ${brl(r.risco.venda)}`] : []),
    ...top];
}

module.exports = { MESES_VALIDADE, FAIXAS, RISCO_DIAS, ler, calcular, resumo, editar, daLoja, linhasResumo, somarMeses, precosKg, faixa, hojeSP };
