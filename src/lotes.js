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
const r3 = (v) => Math.round(v * 1000) / 1000;
/** todas as entradas do chá, da mais nova para a mais antiga, com a chave do lote */
function entradasDoCod(cod, ent) {
  const lista = (ent[cod] || []).filter(([dia]) => DIA.test(dia)).slice().sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  const vistos = new Set();
  return lista.map(([dia, , nf, qtd]) => {
    let chave = `${nf}|${cod}|${dia}`;
    for (let k = 2; vistos.has(chave); k++) chave = `${nf}|${cod}|${dia}|${k}`; // o mesmo chá duas vezes na mesma nota
    vistos.add(chave);
    return { chave, nf: String(nf ?? ''), entrada: dia, qtdEntrada: Number(qtd) || 0 };
  });
}
/** regra automática: o estoque fica nas entradas mais novas (cada uma até o que chegou); o resto é "saldo sem nota" */
function distribuir(S, entradas, inicial) {
  const dist = new Map();
  let resta = S;
  for (const e of entradas) {
    if (!(resta > 1e-9)) break;
    const q = Math.min(resta, e.qtdEntrada);
    if (q > 0) { dist.set(e.chave, q); resta = r3(resta - q); }
  }
  if (resta > 1e-9) dist.set(inicial, resta);
  return dist;
}
/**
 * Com um ajuste (a equipe disse quanto tem de cada lote, na tela ou na contagem do inventário): parte dessa foto,
 * soma as entradas que chegaram depois e tira a diferença para o estoque atual do AppNext do lote mais antigo
 * (venda e perda saem do mais antigo; sobra vai para o mais novo). O total continua sendo o do AppNext.
 */
function aPartirDoAjuste(S, anc, todas, dEst, inicial) {
  const info = new Map(todas.map((e) => [e.chave, e]));
  const dist = new Map(Object.entries(anc.fix || {}).filter(([, v]) => v > 0).map(([k, v]) => [k, +v]));
  for (const e of todas) if (e.entrada > anc.dia && (!DIA.test(dEst) || e.entrada <= dEst)) dist.set(e.chave, r3((dist.get(e.chave) || 0) + e.qtdEntrada));
  let D = r3([...dist.values()].reduce((x, v) => x + v, 0) - S);
  const dataDe = (k) => (info.get(k) ? info.get(k).entrada : '');
  if (D > 0) {
    for (const k of [...dist.keys()].sort((a, b) => (dataDe(a) < dataDe(b) ? -1 : dataDe(a) > dataDe(b) ? 1 : 0))) {
      if (!(D > 1e-9)) break;
      const q = Math.min(D, dist.get(k));
      dist.set(k, r3(dist.get(k) - q)); D = r3(D - q);
    }
  } else if (D < 0) {
    const novo = todas.find((e) => !DIA.test(dEst) || e.entrada <= dEst);
    const k = novo ? novo.chave : inicial;
    dist.set(k, r3((dist.get(k) || 0) - D));
  }
  for (const [k, v] of dist) if (!(v > 1e-9)) dist.delete(k);
  return dist;
}
/** o ajuste que vale para este estoque: o mais recente feito até a data do estoque exportado */
function escolherAjuste(lista, estEm) {
  const t = Date.parse(estEm || '') || Infinity;
  return (lista || []).filter((a) => (Date.parse(a.em) || 0) <= t).sort((a, b) => (Date.parse(b.em) || 0) - (Date.parse(a.em) || 0))[0] || null;
}

/**
 * Lotes em aberto do chá a granel.
 * estoque = ES.atual; compras = ES.compras; tabela = TAB.resumo; edits = ler(id); ajustes = { cod: [ajuste] }; hoje = AAAA-MM-DD
 * → { em, lotes: [{ chave, cod, desc, nf, entrada, qtdEntrada, saldo, lote, validade, padrao, dias, faixa, custoKg, precoKg, ajuste }] }
 */
function calcular({ estoque, compras, tabela, edits, ajustes, hoje = hojeSP() }) {
  if (!estoque || !Array.isArray(estoque.itens)) return { em: null, lotes: [] };
  const dEst = String(estoque.em || '').slice(0, 10);
  const ed = (edits && edits.lotes) || {};
  const ajs = ajustes || (edits && edits.ajustes) || {};
  const precos = precosKg(tabela, estoque);
  const ent = (compras && compras.itens) || {};
  const lotes = [];
  for (const it of estoque.itens) {
    if (it.un !== 'Kg' || ENVASADO.test(it.desc || '')) continue; // só o chá a granel tem validade (lata, minitin, sachê… não)
    const cod = String(it.cod);
    const S = Math.max(0, r3(Number(it.qtd) || 0));
    if (!(S > 0)) continue;
    const todas = entradasDoCod(cod, ent), inicial = `inicial|${cod}`;
    const anc = escolherAjuste(ajs[cod], estoque.em);
    // sem ajuste: só as entradas que já estavam no estoque exportado (as de depois ainda não contam no saldo)
    const dist = anc ? aPartirDoAjuste(S, anc, todas, dEst, inicial) : distribuir(S, todas.filter((e) => !DIA.test(dEst) || e.entrada <= dEst), inicial);
    const info = new Map(todas.map((e) => [e.chave, e]));
    const aj = anc ? { tipo: anc.tipo, por: anc.por || '', em: anc.feitoEm || anc.em } : null;
    for (const [chave, saldo] of dist) {
      const e = info.get(chave);
      const base = e ? { nf: e.nf, entrada: e.entrada, qtdEntrada: e.qtdEntrada, saldo } : { nf: '', entrada: null, qtdEntrada: null, saldo };
      lotes.push({ ...montar(chave, it, base, ed[chave], hoje, precos), ajuste: aj });
    }
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
function editar(id, b, por, lotesAtuais, compras) {
  const chave = String(b.chave || '');
  // o lote em aberto ou, vindo da nota de entrada, qualquer entrada conhecida (mesmo antes do estoque ser atualizado)
  let l = lotesAtuais.find((x) => x.chave === chave);
  if (!l && compras) { const cod = chave.split('|')[1] || ''; l = entradasDoCod(cod, compras.itens || {}).find((e) => e.chave === chave); }
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
  const corte = somarMeses(hojeSP(), -24), vivos = new Set([...lotesAtuais.map((x) => x.chave), chave]);
  for (const [k, x] of Object.entries(d.lotes)) if (!vivos.has(k) && String(x.em || '').slice(0, 10) < corte) delete d.lotes[k];
  gravar(id, d);
  return { ok: d.lotes[chave] || null, antes: atual };
}

/**
 * "Deste lote ainda tem X": a equipe corrige o saldo de um lote (ex.: abriram o pacote novo antes do antigo).
 * O total continua o do AppNext: a diferença sai (ou vai) para os outros lotes — o que sobra vai para os mais novos,
 * o que falta sai dos mais antigos. Fica guardado como uma foto (ajuste) e as vendas seguintes saem do mais antigo.
 * b = { chave, saldo (kg) } ou { chave, automatico: true } (volta para a regra automática neste chá)
 */
function editarSaldo(id, b, por, ctx) {
  const { estoque, compras, lotes } = ctx;
  if (b.lotes && typeof b.lotes === 'object') return editarSaldos(id, b, por, ctx);
  const l = lotes.find((x) => x.chave === String(b.chave || ''));
  if (!l) return { erro: 'Lote não encontrado (o estoque pode ter mudado): atualize a tela.' };
  const d = ler(id);
  d.ajustes = d.ajustes || {};
  if (b.automatico) {
    d.ajustes[l.cod] = (d.ajustes[l.cod] || []).filter((a) => a.tipo !== 'manual');
    if (!d.ajustes[l.cod].length) delete d.ajustes[l.cod];
    gravar(id, d);
    return { ok: true };
  }
  const v = r3(Number(String(b.saldo ?? '').replace(',', '.')));
  const doCod = lotes.filter((x) => x.cod === l.cod);
  const S = r3(doCod.reduce((x, y) => x + y.saldo, 0));
  if (!Number.isFinite(v) || v < 0) return { erro: 'Saldo inválido.' };
  if (v > S + 1e-9) return { erro: `O estoque deste chá no AppNext é ${String(S).replace('.', ',')} kg: o lote não pode ter mais que isso. Se tem mais, ajuste o estoque pelo inventário.` };
  if (l.qtdEntrada != null && v > l.qtdEntrada + 1e-9) return { erro: `Neste lote chegaram ${String(l.qtdEntrada).replace('.', ',')} kg.` };
  const dEst = String(estoque.em || '').slice(0, 10);
  const todas = entradasDoCod(l.cod, (compras && compras.itens) || {}).filter((e) => !DIA.test(dEst) || e.entrada <= dEst);
  const cur = new Map(doCod.map((x) => [x.chave, x.saldo]));
  let dif = r3((cur.get(l.chave) || 0) - v);
  cur.set(l.chave, v);
  if (dif > 0) { // o lote tem menos do que o painel achava: o resto está nos mais novos (até o que chegou em cada um)
    for (const e of todas) {
      if (!(dif > 1e-9)) break;
      if (e.chave === l.chave) continue;
      const q = Math.min(dif, Math.max(0, r3(e.qtdEntrada - (cur.get(e.chave) || 0))));
      if (q > 0) { cur.set(e.chave, r3((cur.get(e.chave) || 0) + q)); dif = r3(dif - q); }
    }
    if (dif > 1e-9) { const k = `inicial|${l.cod}`; cur.set(k, r3((cur.get(k) || 0) + dif)); }
  } else if (dif < 0) { // tem mais: sai dos outros, do mais antigo para o mais novo
    let falta = -dif;
    const data = (k) => { const e = todas.find((x) => x.chave === k); return e ? e.entrada : ''; };
    for (const k of [...cur.keys()].filter((k) => k !== l.chave).sort((a, b2) => (data(a) < data(b2) ? -1 : 1))) {
      if (!(falta > 1e-9)) break;
      const q = Math.min(falta, cur.get(k)); cur.set(k, r3(cur.get(k) - q)); falta = r3(falta - q);
    }
  }
  const fix = {};
  for (const [k, x] of cur) if (x > 1e-9) fix[k] = x;
  const aj = { em: estoque.em || new Date().toISOString(), dia: dEst, fix, tipo: 'manual', por: String(por || ''), feitoEm: new Date().toISOString() };
  d.ajustes[l.cod] = [...(d.ajustes[l.cod] || []), aj].slice(-3);
  gravar(id, d);
  return { ok: aj, antes: l.saldo };
}

/** todos os lotes de um chá de uma vez ({ cod, lotes: { chave: kg } }): a soma tem de ser o estoque do AppNext */
function editarSaldos(id, b, por, ctx) {
  const { estoque, compras, lotes } = ctx;
  const cod = String(b.cod || '');
  const doCod = lotes.filter((x) => x.cod === cod);
  if (!doCod.length) return { erro: 'Este chá não tem estoque no AppNext.' };
  const S = r3(doCod.reduce((x, y) => x + y.saldo, 0));
  const dEst = String(estoque.em || '').slice(0, 10);
  const todas = new Map(entradasDoCod(cod, (compras && compras.itens) || {}).filter((e) => !DIA.test(dEst) || e.entrada <= dEst).map((e) => [e.chave, e]));
  const fix = {};
  for (const [k, q] of Object.entries(b.lotes).slice(0, 30)) {
    const e = todas.get(k);
    if (!e && k !== `inicial|${cod}`) return { erro: 'Lote inválido: atualize a tela.' };
    const v = r3(Number(q));
    if (!Number.isFinite(v) || v < 0) return { erro: 'Quantidade inválida.' };
    if (e && v > e.qtdEntrada + 1e-9) return { erro: `No lote de ${e.entrada.split('-').reverse().join('/')} chegaram ${String(e.qtdEntrada).replace('.', ',')} kg.` };
    if (v > 0) fix[k] = v;
  }
  const soma = r3(Object.values(fix).reduce((x, v) => x + v, 0));
  if (Math.abs(soma - S) > 0.0015) return { erro: `A soma dos lotes (${String(soma).replace('.', ',')} kg) tem de ser o estoque do AppNext (${String(S).replace('.', ',')} kg). Se o total está errado, corrija pelo Inventário (contando por lote).` };
  const d = ler(id);
  d.ajustes = d.ajustes || {};
  const aj = { em: estoque.em || new Date().toISOString(), dia: dEst, fix, tipo: 'manual', por: String(por || ''), feitoEm: new Date().toISOString() };
  d.ajustes[cod] = [...(d.ajustes[cod] || []), aj].slice(-3);
  gravar(id, d);
  return { ok: aj, antes: Object.fromEntries(doCod.map((x) => [x.chave, x.saldo])) };
}

/** contagem por lote no inventário: depois que a contagem foi importada no AppNext, vira o ponto de partida do chá */
function ajustesInventario(id) {
  const out = {};
  let INV;
  try { INV = require('./inventario'); } catch { return out; }
  const corte = Date.now() - 400 * 864e5;
  for (const c of INV.lista(id)) {
    if (c.st !== 'importado' || !c.importadoEm || !(Date.parse(c.importadoEm) > corte)) continue;
    const cc = INV.ler(id, c.id);
    for (const it of (cc && cc.itens) || []) {
      if (it.cont == null || !it.lotes || !Object.keys(it.lotes).length) continue;
      const dia = new Date(c.importadoEm).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      (out[it.cod] || (out[it.cod] = [])).push({ em: c.importadoEm, dia, fix: it.lotes, tipo: 'inventario', por: it.por || '', feitoEm: c.importadoEm });
    }
  }
  return out;
}

/** para a contagem por lote: as entradas dos últimos 14 meses de cada chá a granel (mesmo as que o painel acha que acabaram) */
function entradasRecentes({ estoque, compras, edits, hoje = hojeSP() }) {
  const out = {};
  const ed = (edits && edits.lotes) || {}, corte = somarMeses(hoje, -14);
  for (const it of (estoque && estoque.itens) || []) {
    if (it.un !== 'Kg' || ENVASADO.test(it.desc || '')) continue;
    const cod = String(it.cod);
    const l = entradasDoCod(cod, (compras && compras.itens) || {}).filter((e) => e.entrada >= corte).slice(0, 8)
      .map((e) => ({ chave: e.chave, nf: e.nf, entrada: e.entrada, lote: (ed[e.chave] && ed[e.chave].lote) || '0', validade: (ed[e.chave] && ed[e.chave].validade) || somarMeses(e.entrada, MESES_VALIDADE) }));
    if (l.length) out[cod] = l;
  }
  return out;
}

/**
 * Lotes de uma nota de entrada (Estoque → Notas fiscais e Validade → notas recentes): os chás a granel da nota,
 * com o nº do lote e a validade, mesmo antes do estoque do AppNext ser atualizado. nota = ES.notas().notas[k]
 */
function daNota({ nota, estoque, compras, edits }) {
  const porCod = new Map(((estoque && estoque.itens) || []).map((i) => [String(i.cod), i]));
  const dia = String(nota.entrada || nota.emissao || '').slice(0, 10);
  const ed = (edits && edits.lotes) || {};
  const usados = new Set(), out = [];
  for (const it of nota.itens || []) {
    const cod = String(it.cod || ''), est = porCod.get(cod);
    const granel = est ? est.un === 'Kg' : /^kg$/i.test(String(it.un || ''));
    if (!granel || ENVASADO.test((est && est.desc) || it.nome || '')) continue;
    const e = entradasDoCod(cod, (compras && compras.itens) || {}).find((x) => x.nf === String(nota.nf) && x.entrada === dia && !usados.has(x.chave));
    if (!e) continue; // nota que não é compra concluída (o painel não conta como lote)
    usados.add(e.chave);
    const x = ed[e.chave] || {}, padrao = somarMeses(e.entrada, MESES_VALIDADE);
    out.push({ chave: e.chave, cod, desc: (est && est.desc) || it.nome || cod, qtd: e.qtdEntrada, lote: x.lote || '0', validade: DIA.test(x.validade || '') ? x.validade : padrao, padrao: !DIA.test(x.validade || ''), validadePadrao: padrao, entrada: e.entrada });
  }
  return out;
}
/** notas recentes (60 dias) com chá a granel ainda sem nº de lote: { id da nota: quantos faltam } */
function pendentesNotas({ notas, estoque, compras, edits, abertos, hoje = hojeSP() }) {
  const out = {}, corte = somarMeses(hoje, -2), dEst = String((estoque && estoque.em) || '').slice(0, 10);
  // lote que já acabou (o estoque exportado já tem a nota e o lote não tem saldo) não fica pendente
  const acabou = (x) => abertos && DIA.test(dEst) && x.entrada <= dEst && !abertos.has(x.chave);
  for (const n of notas || []) {
    if (String(n.entrada || n.emissao || '').slice(0, 10) < corte) continue;
    const f = daNota({ nota: n, estoque, compras, edits }).filter((x) => x.lote === '0' && !acabou(x)).length;
    if (f) out[n.id] = f;
  }
  return out;
}

/** chá a granel do estoque: [nome, kg no AppNext, chegou nota depois do estoque exportado] (para não oferecer o que não tem) */
function granelEstoque({ estoque, compras }) {
  const dEst = String((estoque && estoque.em) || '').slice(0, 10);
  const ent = (compras && compras.itens) || {};
  return ((estoque && estoque.itens) || []).filter((i) => i.un === 'Kg' && !ENVASADO.test(i.desc || ''))
    .map((i) => [i.desc || '', Math.round((Number(i.qtd) || 0) * 1000) / 1000, (ent[String(i.cod)] || []).some(([dia]) => DIA.test(dEst) && dia > dEst) ? 1 : 0]);
}

/** lotes da loja já calculados (arquivos do estoque, das compras e da tabela, ajustes da tela e do inventário) */
function daLoja(id, hoje) {
  const TAB = require('./tabela');
  const edits = ler(id);
  const ajustes = {};
  for (const [cod, l] of Object.entries(edits.ajustes || {})) ajustes[cod] = [...l];
  for (const [cod, l] of Object.entries(ajustesInventario(id))) ajustes[cod] = [...(ajustes[cod] || []), ...l];
  const estoque = ES.atual(id), compras = ES.compras(id);
  return { ...calcular({ estoque, compras, tabela: TAB.resumo(id), edits, ajustes, hoje }), estoque, compras, edits };
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

module.exports = { MESES_VALIDADE, FAIXAS, RISCO_DIAS, ler, calcular, resumo, editar, editarSaldo, daLoja, daNota, granelEstoque, pendentesNotas, entradasDoCod, entradasRecentes, linhasResumo, somarMeses, precosKg, faixa, hojeSP };
