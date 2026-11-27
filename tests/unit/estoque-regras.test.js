'use strict';
/* Regras do Estoque (EST-02…EST-11, EST-40): reposição, situação, mínimo sugerido, valor a custo, consumo de embalagem,
   CSV do pedido, parado, limites da configuração e do inventário.
   Sem mudar código de produção. A tela Estoque (public/js/estoque.js) roda no Node (vm) como em margem-resultado.test.js:
   TS.db montado das linhas de venda, /api/estoque respondido por um fetch falso e as peças de tela (TS.h, TS.card,
   TS.table…) trocadas por um desenho em memória — o teste lê as linhas que a TS.table receberia.
   O harness é uma CÓPIA do de margem-resultado.test.js (de propósito, para não acoplar os dois arquivos). */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

// o servidor (src/estoque.js e src/inventario.js) grava numa pasta de rascunho, nunca em dados/
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'est-regras-'));
process.env.DATA_DIR = TMP;
process.env.CONFIG_FILE = path.join(TMP, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1' }], usuarios: {} }));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* nada */ } });

const JS = path.join(__dirname, '../../public/js');
const LOJA = 'LOJA TESTE';
const HOJE = '2026-11-20';
const CAT_AROM = 'Chás aromatizados, Chás, Rooibos e Infusões Aromatizados, LOJA';

// peças de tela trocadas por nós em memória (nenhuma toca em document); click/scrollIntoView e TS.segMarcar para o CSV e os quadros
const PECAS = `
class N {
  constructor(tag, attrs, kids) { this.tag = tag; this.attrs = attrs || {}; this.kids = []; this.isConnected = true; this.value = this.attrs.value ?? '';
    this.style = {}; this.dataset = {}; this.classList = { toggle() {}, add() {}, remove() {}, contains() { return false; } }; this.append(...kids); }
  append(...k) { for (const x of k.flat(Infinity)) if (x != null && x !== false) this.kids.push(x); }
  replaceChildren(...k) { this.kids = []; this.append(...k); }
  remove() {} after() {} addEventListener() {} setAttribute() {} replaceWith() {} querySelector() { return null; } scrollIntoView() {}
  click() { (globalThis.__cliques = globalThis.__cliques || []).push(this); }
  get href() { return this.attrs.href; }
  get textContent() { return this.kids.map((k) => (k && typeof k === 'object' && 'kids' in k ? k.textContent : String(k))).join(''); }
}
TS.h = (tag, attrs, ...kids) => new N(tag, attrs, kids);
TS.card = (titulo, sub, ...k) => new N('card', { titulo, sub }, k);
TS.cardWithTools = TS.card;
TS.table = (o) => new N('table', { o }, []);
for (const k of ['heroi', 'seg', 'segFolha', 'dica', 'chart', 'empty', 'linhasNum', 'subEstoque', 'subGrupo', 'botoesExpandir', 'deltaSpan']) TS[k] = (...a) => new N(k, { a }, []);
TS.segMarcar = (seg, v) => { seg.marcado = v; };
TS.ehCelular = () => false; TS.teclado = () => {}; TS.render = () => {}; TS.telasEstoque = []; TS.periodoTexto = () => '';
TS.axisNum = () => ({}); TS.axisCat = () => ({}); TS.pages = {};
TS.eu = { pode: { configurar: true, custos: true } };
TS.hojeSP = () => '${HOJE}';
`;

/** linha de venda como o servidor guarda */
const venda = (data, x) => ({ data, cupom: 1, vendedor: 'ANA', qtd: 1, du: 0, soNumeros: null, qtdCha: 0, min: null, cod: '', grupo: 'ACESSÓRIOS', grupoC: 'ACESSÓRIOS', cat: 'Acessórios, LOJA', ...x, vt: x.vt ?? (x.vu - (x.du || 0)) * (x.qtd ?? 1) });
const prod = (cod, nome) => (data, qtd = 1) => venda(data, { qtd, vu: 50, cod, descricao: nome, produto: nome });
const cha50 = (data, qtd = 1) => venda(data, { qtd, vu: 25, cod: '270101', soNumeros: 50, qtdCha: 0.05 * qtd, descricao: 'Chá Preto 50G', produto: 'Chá Preto', grupo: 'CHÁ PRETO AROMATIZADO', grupoC: 'CHÁ AROMATIZADO', cat: CAT_AROM });
const infusor = prod('500', 'Infusor'), bule = prod('502', 'Bule'), caneca = prod('504', 'Caneca; azul'), prato = prod('505', 'Prato');
const vaso = prod('506', 'Vaso'), jarra = prod('508', 'Jarra');

/** os arquivos do navegador num contexto novo (cópia do harness de margem-resultado.test.js, com Blob/URL/document de espião) */
function painel(linhas, { cfg, estoque, tabela = null, regras = null, classe = { meses: 6, fixas: {} }, foraDeLinha = null } = {}) {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout });
  vm.runInContext("var window = globalThis; var location = { pathname: '/', hash: '' };", ctx);
  // espiões do download do CSV: o arquivo vira o Blob guardado em __blob
  ctx.Blob = class { constructor(partes, o) { this.partes = partes; this.tipo = o && o.type; } };
  ctx.URL = { createObjectURL: (b) => { ctx.__blob = b; return 'blob:teste'; }, revokeObjectURL: () => {} };
  ctx.document = { body: { append: (a) => { ctx.__anchor = a; } }, documentElement: {} };
  ctx.getComputedStyle = () => ({ getPropertyValue: () => '' }); // cores dos tokens do gráfico "Próximas semanas"
  ctx.alert = (m) => { ctx.__alerta = m; };
  const run = (f) => vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctx, { filename: f });
  for (const f of ['core.js', 'contas.js', 'rules.js', 'classeprod.js', 'custodata.js']) run(f);
  vm.runInContext(PECAS, ctx);
  for (const f of ['grupoprod.js', 'ruptura.js', 'visaodono.js', 'estoque.js', 'dre.js']) run(f);
  const dict = { loja: [], vendedor: [], descricao: [], produto: [], grupo: [], grupoC: [], cat: [], cod: [] };
  const id = (c, t) => { let i = dict[c].indexOf(t); if (i < 0) { dict[c].push(t); i = dict[c].length - 1; } return i; };
  const v = { data: [], cupom: [], min: [], qtd: [], soNumeros: [], qtdCha: [], vu: [], du: [], vt: [], loja: [], vendedor: [], cod: [], descricao: [], produto: [], grupo: [], grupoC: [], cat: [] };
  linhas.forEach((l, k) => {
    for (const c of ['data', 'min', 'qtd', 'soNumeros', 'qtdCha', 'vu', 'du', 'vt']) v[c].push(l[c] ?? null);
    v.cupom.push(k + 1);
    for (const c of ['vendedor', 'descricao', 'produto', 'grupo', 'grupoC', 'cat', 'cod']) v[c].push(id(c, l[c] ?? ''));
    v.loja.push(id('loja', LOJA));
  });
  ctx.__raw = JSON.stringify({ vendas: v, dict, metas: [{ id: 'l1', nomesVenda: [LOJA], padrao: 0, ...(regras ? { regras } : {}) }] });
  ctx.__estoque = JSON.parse(JSON.stringify({ estoque, cfg, tabela, classe, historico: null, compras: null, foraDeLinha }));
  vm.runInContext(`TS.db = TS.decode(JSON.parse(__raw)); TS.rules.prepare(); TS.state.loja = 'l1';
    globalThis.fetch = async (u) => ({ ok: true, json: async () => (String(u).includes('estoque?') ? __estoque : {}) });`, ctx);
  const TS = vm.runInContext('TS', ctx);
  TS.__ctx = ctx;
  return TS;
}
const espera = () => new Promise((ok) => setTimeout(ok, 30));
function achar(no, ok, out = []) {
  if (!no || typeof no !== 'object' || !('kids' in no)) return out;
  if (ok(no)) out.push(no);
  for (const k of no.kids) achar(k, ok, out);
  return out;
}
const cartaoExato = (raiz, t) => achar(raiz, (n) => n.tag === 'card' && n.attrs.titulo === t)[0];
const tabelaDe = (no) => achar(no, (n) => n.tag === 'table')[0].attrs.o;
const perto = (a, b, msg, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${msg || ''} esperado ${b}, veio ${a}`);
const dia = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400e3);
const iso = (d) => new Date(d * 86400e3).toISOString().slice(0, 10);
const js = (x) => JSON.parse(JSON.stringify(x));
const FIM = dia(HOJE);

// ---------- cenário base: 30 dias de venda até HOJE, sem um ano de histórico ----------
const CFG = { simplesPct: 6, cartaoPct: 2, margemMin: 15, margemAlvo: 30, entregaDias: 7, coberturaDias: 14, paradoDias: 60, segurancaPct: 50,
  embalagens: { 50: [{ cod: '900', qtd: 1 }, { cod: '901', qtd: 2 }] }, outros: [] };
const ITENS = [
  { cod: '27010', desc: 'Chá Preto', un: 'Kg', tipo: 'IN', custo: 200, qtd: 0.5 },     // 0,05 kg/dia → dura 10 dias → pedir
  { cod: '900', desc: 'Saco kraft', un: 'UN', tipo: 'IN', custo: 1, qtd: 100 },        // 1 por pacote de 50 g → 1/dia → OK
  { cod: '901', desc: 'Etiqueta', un: 'UN', tipo: 'IN', custo: 0.1, qtd: 30 },         // 2 por pacote → 2/dia → dura 15 dias → pedir
  { cod: '500', desc: 'Infusor', un: 'UN', tipo: 'PN', custo: 20, qtd: 5, min: 5 },    // 1/dia → dura 5 < 7 → falta; mín. 5 < sugerido 11 × 0,7 → baixo
  { cod: '502', desc: 'Bule', un: 'UN', tipo: 'PN', custo: 45, qtd: 0 },               // 0,5/dia e zerado → acabou
  { cod: '503', desc: 'Xícara', un: 'UN', tipo: 'PN', custo: 15, qtd: 3, min: 5 },     // sem venda, abaixo do mínimo
  { cod: '504', desc: 'Caneca; azul', un: 'UN', tipo: 'PN', custo: 10, qtd: 15, min: 12 }, // 1/dia → dura 15 → pedir; mín. OK
  { cod: '505', desc: 'Prato', un: 'UN', tipo: 'PN', custo: 8, qtd: 100, min: 30 },    // dura 100 → OK; mín. 30 > 2 × 11 → alto
  { cod: '506', desc: 'Vaso', un: 'UN', tipo: 'PN', custo: 10, qtd: 4 },               // última venda há 60 dias → parado
  { cod: '508', desc: 'Jarra', un: 'UN', tipo: 'PN', custo: 10, qtd: 4 },              // última venda há 59 dias → não é parado
  { cod: '509', desc: 'Coador', un: 'UN', tipo: 'PN', custo: 5, qtd: 2 },              // PN que nunca vendeu → parado
  { cod: '510', desc: 'Filtro', un: 'UN', tipo: 'IN', custo: 2, qtd: 7 },              // insumo que nunca vendeu → novo, não parado
  { cod: '507', desc: 'Brinde', un: 'UN', tipo: 'PN', custo: 0, qtd: 10 },             // sem custo: fora do valor a custo
  { cod: '511', desc: 'Negativo', un: 'UN', tipo: 'PN', custo: 10, qtd: -3 },          // saldo negativo: fora do valor
];
const ESTOQUE = { em: `${HOJE}T10:00:00Z`, itens: ITENS };
function vendasBase() {
  const l = [];
  for (let k = 0; k < 30; k++) {
    const d = iso(FIM - 29 + k);
    l.push(infusor(d), caneca(d), prato(d), cha50(d));
    if (k % 2 === 0) l.push(bule(d));
  }
  l.push(vaso(iso(FIM - 60)), jarra(iso(FIM - 59)));
  return l;
}

/** monta a tela Estoque e devolve { TS, raiz, card (Produtos), rows (aba Todos), heroi } */
async function telaEstoque(linhas, { cfg = CFG, estoque = ESTOQUE, aba = 'todos', foraDeLinha = null } = {}) {
  const TS = painel(linhas, { cfg, estoque, foraDeLinha });
  TS.state.estSit = aba;
  const raiz = TS.h('div');
  TS.pages.estoque(raiz);
  await espera();
  const erro = achar(raiz, (n) => n.tag === 'div' && /notice err/.test(n.attrs.class || ''))[0];
  assert.ok(!erro, 'a tela montou sem erro: ' + (erro && erro.textContent));
  const card = cartaoExato(raiz, 'Produtos');
  assert.ok(card, 'o cartão Produtos aparece');
  const heroi = achar(raiz, (n) => n.tag === 'heroi' && n.attrs.a[0].some((c) => c && c.rot === 'Para repor'))[0];
  return { TS, raiz, card, rows: tabelaDe(card).rows, heroi: heroi.attrs.a[0] };
}
const porCod = (rows) => Object.fromEntries(rows.map((r) => [String(r.cod), r]));

// ======================= EST-03: quanto repor =======================
test('EST-03: quanto repor = previsão × (entrega + cobertura) − estoque, arredondado (un para cima; kg em 0,1 kg); o mínimo do AppNext pede mais quando maior', async () => {
  const { rows } = await telaEstoque(vendasBase());
  const r = porCod(rows);
  // sem um ano de histórico: previsão = ritmo dos últimos 30 dias, fator 1
  for (const c of ['500', '504', '27010']) { assert.strictEqual(r[c].origem, 'sem'); perto(r[c].fator, 1); }
  perto(r['500'].vel, 1); perto(r['500'].prev, 1);
  assert.strictEqual(r['500'].pedir, 16, 'infusor: 1/dia × (7 + 14) − 5 = 16');
  perto(r['500'].custoPedido, 16 * 20);
  assert.strictEqual(r['502'].pedir, 11, 'bule: 0,5/dia × 21 − 0 = 10,5 → 11 (para cima)');
  assert.strictEqual(r['504'].pedir, 6, 'caneca: 1 × 21 − 15 = 6');
  perto(r['27010'].vel, 0.05, 'chá: 30 pacotes de 50 g em 30 dias = 0,05 kg/dia');
  perto(r['27010'].pedir, 0.6, '0,05 × 21 − 0,5 = 0,55 kg → 0,6 kg (décimo para cima)');
  perto(r['27010'].custoPedido, 0.6 * 200);
  // sem venda, só o mínimo do AppNext: 5 − 3 = 2
  assert.strictEqual(r['503'].pedir, 2);
  // estoque de sobra: nada a pedir (mesmo com mínimo 30 < 100)
  assert.strictEqual(r['505'].pedir, 0);
  // o mínimo pede mais que a venda: Prato com 12 em estoque e mínimo 30 → 18 (a venda pediria 21 − 12 = 9)
  const est2 = { ...ESTOQUE, itens: ITENS.map((i) => (i.cod === '505' ? { ...i, qtd: 12 } : i)) };
  const r2 = porCod((await telaEstoque(vendasBase(), { estoque: est2 })).rows);
  assert.strictEqual(r2['505'].pedir, 18);
  // saldo negativo conta como zero
  assert.strictEqual(r['511'].qtd, 0);
});

test('EST-03: época do ano — fator do próprio item (6+ dias de venda no ano passado), senão o da loja; limitado entre 0,4 e 3', async () => {
  const lyB0 = FIM - 364 - 29, lyB1 = FIM - 364, lyN0 = FIM - 363, H = 21;
  const l = vendasBase();
  for (let d = lyB0; d <= lyB1; d++) l.push(infusor(iso(d)), prato(iso(d)));               // ano passado, 30 dias "de agora": 1/dia
  for (let d = lyN0; d < lyN0 + H; d++) l.push(infusor(iso(d), 2));                         // e 2/dia nos 21 dias seguintes; prato: nada
  for (let k = 0; k < 5; k++) l.push(caneca(iso(lyB0 + k)));                                // caneca: só 5 dias → usa o fator da loja
  const { rows } = await telaEstoque(l);
  const r = porCod(rows);
  // infusor: (42 ÷ 21) ÷ (30 ÷ 30) = 2 → previsão 2/dia
  assert.strictEqual(r['500'].origem, 'item'); perto(r['500'].fator, 2); perto(r['500'].prev, 2);
  assert.strictEqual(r['500'].pedir, 2 * 21 - 5);
  // prato: vendeu 0 nos 21 dias seguintes → fator 0 limitado a 0,4
  assert.strictEqual(r['505'].origem, 'item'); perto(r['505'].fator, 0.4); perto(r['505'].prev, 0.4);
  // caneca: fator da loja nas unidades = (n ÷ 21) ÷ (b ÷ 30) com b = 30 + 30 + 5 e n = 42
  assert.strictEqual(r['504'].origem, 'loja');
  const fl = (42 / 21) / (65 / 30);
  perto(r['504'].fator, fl); perto(r['504'].prev, fl);
  assert.strictEqual(r['504'].pedir, Math.ceil(fl * 21 - 15));
  // chá (kg): fator da loja nos kg; sem venda de chá no ano passado → 1
  assert.strictEqual(r['27010'].origem, 'loja'); perto(r['27010'].fator, 1);
  // limite de cima: 10/dia no ano passado → fator 3
  const l3 = vendasBase();
  for (let d = lyB0; d <= lyB1; d++) l3.push(infusor(iso(d)));
  for (let d = lyN0; d < lyN0 + H; d++) l3.push(infusor(iso(d), 10));
  const r3 = porCod((await telaEstoque(l3)).rows);
  perto(r3['500'].fator, 3); perto(r3['500'].prev, 3);
});

// ======================= EST-04: situação =======================
test('EST-04: situação do item — acabou / falta antes da entrega / abaixo do mínimo / pedir / OK, nessa ordem de prioridade', async () => {
  const { rows } = await telaEstoque(vendasBase());
  const r = porCod(rows);
  assert.deepStrictEqual(js(['502', '500', '503', '504', '27010', '901', '505', '900'].map((c) => [c, r[c].sit])), [
    ['502', 'acabou'], ['500', 'falta'], ['503', 'minimo'], ['504', 'pedir'], ['27010', 'pedir'], ['901', 'pedir'], ['505', 'ok'], ['900', 'ok']]);
  // falta vence o mínimo: infusor com saldo 5 e mínimo 6 continua "falta" (dura 5 dias < 7 de entrega)
  const est = { ...ESTOQUE, itens: ITENS.map((i) => (i.cod === '500' ? { ...i, min: 6 } : i)) };
  assert.strictEqual(porCod((await telaEstoque(vendasBase(), { estoque: est })).rows)['500'].sit, 'falta');
  // abaixo do mínimo vence "pedir": caneca (dura 15 dias) com mínimo 20
  const est2 = { ...ESTOQUE, itens: ITENS.map((i) => (i.cod === '504' ? { ...i, min: 20 } : i)) };
  assert.strictEqual(porCod((await telaEstoque(vendasBase(), { estoque: est2 })).rows)['504'].sit, 'minimo');
  // na tabela: etiqueta da situação (est); quem não está para repor vira parado / novo / sem saldo / ok
  assert.deepStrictEqual(js(['502', '500', '503', '504', '505', '506', '508', '510', '511'].map((c) => [c, r[c].est])), [
    ['502', 'acabou'], ['500', 'falta'], ['503', 'minimo'], ['504', 'pedir'], ['505', 'ok'], ['506', 'parado'], ['508', 'ok'], ['510', 'novo'], ['511', 'semsaldo']]);
});

test('EST-04: "O que repor" = situação diferente de OK com algo a pedir; fora de linha (90+ dias indisponível) não se repõe', async () => {
  const { heroi, TS, card } = await telaEstoque(vendasBase(), { aba: 'repor' });
  const rep = tabelaDe(card).rows.map((x) => x.cod).sort();
  assert.deepStrictEqual(js(rep), ['27010', '500', '502', '503', '504', '901']);
  const col = heroi.find((c) => c.rot === 'Para repor');
  assert.strictEqual(col.num, TS.fmt.int(6));
  // urgentes = acabou + falta (bule e infusor); pedido sugerido = soma de pedir × custo
  const pedido = 0.6 * 200 + 12 * 0.1 + 16 * 20 + 11 * 45 + 2 * 15 + 6 * 10;
  assert.strictEqual(col.linhas[0].el, `2 urgentes · pedido sugerido ${TS.fmt.brl0(pedido)}`);
  // infusor fora de linha há 100 dias: sai do "repor" e vira "liquidar"
  const fl = { indisp: { 500: iso(FIM - 100) }, dias: 90 };
  const t2 = await telaEstoque(vendasBase(), { aba: 'repor', foraDeLinha: fl });
  assert.ok(!tabelaDe(t2.card).rows.some((x) => x.cod === '500'), 'fora de linha não aparece em O que repor');
  t2.TS.estFiltrar('todos');
  assert.strictEqual(porCod(tabelaDe(t2.card).rows)['500'].est, 'liquidar');
  // indisponível há só 30 dias: ainda se repõe
  const t3 = await telaEstoque(vendasBase(), { aba: 'repor', foraDeLinha: { indisp: { 500: iso(FIM - 30) }, dias: 90 } });
  assert.ok(tabelaDe(t3.card).rows.some((x) => x.cod === '500'));
});

// ======================= EST-06: mínimo sugerido =======================
test('EST-06: mínimo sugerido = previsão × entrega × (1 + segurança) e a comparação com o mínimo do AppNext (baixo < 70%, alto > 2×, sem)', async () => {
  const { rows, raiz } = await telaEstoque(vendasBase());
  const r = porCod(rows);
  assert.strictEqual(r['500'].sug, 11, '1/dia × 7 × 1,5 = 10,5 → 11');
  assert.strictEqual(r['500'].minSit, 'baixo', 'mínimo 5 < 11 × 0,7');
  assert.strictEqual(r['504'].minSit, 'ok', 'mínimo 12 entre 7,7 e 22');
  assert.strictEqual(r['505'].minSit, 'alto', 'mínimo 30 > 22');
  assert.strictEqual(r['502'].sug, 6, '0,5 × 7 × 1,5 = 5,25 → 6'); assert.strictEqual(r['502'].minSit, 'sem');
  perto(r['27010'].sug, 0.6, 'chá: 0,05 × 7 × 1,5 = 0,525 kg → 0,6 kg');
  assert.strictEqual(r['503'].sug, null, 'sem venda: sem sugestão'); assert.strictEqual(r['503'].minSit, null);
  // segurança configurável: 0% → 7
  const r0 = porCod((await telaEstoque(vendasBase(), { cfg: { ...CFG, segurancaPct: 0 } })).rows);
  assert.strictEqual(r0['500'].sug, 7);
  // resumo embaixo da tabela: conta só os itens da reposição (vendem ou abaixo do mínimo)
  const res = achar(raiz, (n) => /est-minres/.test(n.attrs.class || ''))[0].textContent;
  // baixo: infusor; alto: prato; sem mínimo: chá, saco, etiqueta, bule
  assert.match(res, /1 baixos · 1 altos · 4 sem mínimo/);
});

// ======================= EST-08: valor do estoque a custo =======================
test('EST-08: estoque a custo = Σ saldo × custo, só itens com saldo positivo e custo', async () => {
  const { rows, heroi, TS } = await telaEstoque(vendasBase());
  const r = porCod(rows);
  const total = 0.5 * 200 + 100 * 1 + 30 * 0.1 + 5 * 20 + 3 * 15 + 15 * 10 + 100 * 8 + 4 * 10 + 4 * 10 + 2 * 5 + 7 * 2;
  const col = heroi.find((c) => c.rot === 'Estoque a custo');
  assert.ok(col, 'com custo, o quadro é "Estoque a custo"');
  assert.strictEqual(col.num, TS.fmt.brl0(total));
  perto(rows.reduce((s, x) => s + x.valor, 0), total, 'a soma da coluna Valor a custo bate com o quadro');
  assert.strictEqual(r['507'].valor, 0, 'custo zero'); assert.strictEqual(r['511'].valor, 0, 'saldo negativo'); assert.strictEqual(r['502'].valor, 0, 'zerado');
  perto(r['27010'].valor, 100);
  // sem custo em nada: o quadro vira "Com saldo" (quantos produtos têm saldo)
  const semCusto = { ...ESTOQUE, itens: ITENS.map((i) => ({ ...i, custo: 0 })) };
  const t2 = await telaEstoque(vendasBase(), { estoque: semCusto });
  const c2 = t2.heroi.find((c) => c.rot === 'Com saldo');
  assert.ok(c2); assert.strictEqual(c2.num, TS.fmt.int(ITENS.filter((i) => i.qtd > 0).length));
});

// ======================= EST-09: consumo de saco e etiqueta =======================
test('EST-09: pacote de chá consome matéria-prima (g ÷ 1000 kg) e as embalagens do tamanho; produto pronto consome ele mesmo', async () => {
  const TS = painel(vendasBase(), { cfg: CFG, estoque: ESTOQUE });
  const M = await TS.custosLoja();
  const db = TS.db;
  const linha = (desc) => { for (let i = 0; i < db.n; i++) if (db.D.descricao[db.desc[i]] === desc) return i; return -1; };
  const i = linha('Chá Preto 50G');
  db.qtd[i] = 3; // 3 pacotes de 50 g
  assert.deepStrictEqual(js(M.consumo(i).map(([it, q]) => [it.cod, Math.round(q * 1000) / 1000])), [['27010', 0.15], ['900', 3], ['901', 6]]);
  assert.deepStrictEqual(js(M.consumo(linha('Infusor')).map(([it, q]) => [it.cod, q])), [['500', 1]]);
  // tamanho sem embalagem configurada: só a matéria-prima
  const T2 = painel([venda(HOJE, { qtd: 2, vu: 45, cod: '270102', soNumeros: 100, qtdCha: 0.2, descricao: 'Chá Preto 100G', produto: 'Chá Preto', grupo: 'CHÁ PRETO AROMATIZADO', grupoC: 'CHÁ AROMATIZADO', cat: CAT_AROM })], { cfg: CFG, estoque: ESTOQUE });
  const M2 = await T2.custosLoja();
  assert.deepStrictEqual(js(M2.consumo(0).map(([it, q]) => [it.cod, q])), [['27010', 0.2]]);
  // produto fora da planilha: não consome nada
  const T3 = painel([venda(HOJE, { vu: 10, cod: '999', descricao: 'Livro', produto: 'Livro' })], { cfg: CFG, estoque: ESTOQUE });
  assert.deepStrictEqual(js((await T3.custosLoja()).consumo(0)), []);
  // na tela: a venda/dia do saco e da etiqueta é o que os pacotes consumiram (30 pacotes em 30 dias)
  const r = porCod((await telaEstoque(vendasBase())).rows);
  perto(r['900'].vel, 1); perto(r['901'].vel, 2);
});

// ======================= EST-10: baixar pedido em CSV =======================
test('EST-10: "Baixar pedido (CSV)" — a lista do O que repor, com ; , vírgula decimal, BOM e campo com ; entre aspas', async () => {
  const { raiz, TS } = await telaEstoque(vendasBase());
  const ctx = TS.__ctx;
  const bot = achar(raiz, (n) => n.tag === 'button' && /est-p2-csv/.test(n.attrs.class || ''))[0];
  assert.ok(bot, 'o botão aparece');
  bot.attrs.onclick();
  assert.ok(ctx.__blob, 'gerou o arquivo');
  assert.strictEqual(ctx.__blob.tipo, 'text/csv;charset=utf-8');
  const texto = ctx.__blob.partes.join('');
  assert.strictEqual(texto[0], '﻿', 'com BOM para o Excel abrir os acentos');
  const linhas = texto.slice(1).split('\r\n');
  assert.deepStrictEqual(js(linhas), [
    'Código;Produto;Unidade;Estoque;Pedir;Custo unitário;Custo do pedido;Situação',
    '27010;Chá Preto;Kg;0,500;0,6;200,00;120,00;Pedir',
    '901;Etiqueta;UN;30;12;0,10;1,20;Pedir',
    '500;Infusor;UN;5;16;20,00;320,00;Falta antes da entrega',
    '502;Bule;UN;0;11;45,00;495,00;Acabou',
    '503;Xícara;UN;3;2;15,00;30,00;Abaixo do mínimo',
    '504;"Caneca; azul";UN;15;6;10,00;60,00;Pedir',
  ]);
  assert.strictEqual(ctx.__anchor.attrs.download, `pedido-l1-${HOJE}.csv`);
  assert.ok(ctx.__cliques && ctx.__cliques.includes(ctx.__anchor), 'o link foi clicado (download)');
  // nada para repor: avisa e não gera arquivo
  const tudo = { ...ESTOQUE, itens: ITENS.map((i) => ({ ...i, qtd: 1000, min: 0 })) };
  const t2 = await telaEstoque(vendasBase(), { estoque: tudo });
  achar(t2.raiz, (n) => n.tag === 'button' && /est-p2-csv/.test(n.attrs.class || ''))[0].attrs.onclick();
  assert.strictEqual(t2.TS.__ctx.__alerta, 'Nada para repor agora.');
  assert.strictEqual(t2.TS.__ctx.__blob, undefined);
});

// ======================= EST-05: estoque parado =======================
test('EST-05: parado = com saldo e custo, sem venda há paradoDias ou mais (limite incluído); PN que nunca vendeu também; insumo novo não', async () => {
  const { rows, heroi, TS } = await telaEstoque(vendasBase());
  const r = porCod(rows);
  assert.strictEqual(r['506'].parado, true, 'última venda há exatamente 60 dias'); assert.strictEqual(r['506'].semVenda, 60);
  assert.strictEqual(r['508'].parado, false, 'há 59 dias ainda não');
  assert.strictEqual(r['509'].parado, true, 'produto de revenda sem venda nenhuma'); assert.strictEqual(r['509'].ultima, null);
  assert.strictEqual(r['510'].parado, false, 'insumo sem venda é "novo"');
  assert.strictEqual(r['507'].parado, false, 'sem custo não é dinheiro parado');
  assert.strictEqual(r['502'].parado, false, 'sem saldo não é parado');
  const linhas = heroi.find((c) => c.rot === 'Estoque a custo').linhas[1].attrs.a[0];
  const p = linhas.find((x) => x.rot.startsWith('Parado'));
  // a xícara (PN sem venda, abaixo do mínimo) conta como parada E fica em "O que repor" pelo mínimo (ver o relatório)
  assert.strictEqual(r['503'].parado, true); assert.strictEqual(r['503'].est, 'minimo');
  assert.strictEqual(p.rot, 'Parado · 3 produtos sem venda há 60+ dias');
  assert.strictEqual(p.num, TS.fmt.brl0(3 * 15 + 4 * 10 + 2 * 5));
  // paradoDias configurável: 30 → a jarra (59 dias) também
  const r2 = porCod((await telaEstoque(vendasBase(), { cfg: { ...CFG, paradoDias: 30 } })).rows);
  assert.strictEqual(r2['508'].parado, true);
  // a regra é a mesma do Início (visaodono.ehParado)
  assert.strictEqual(TS.visaoDono.ehParado({ qtd: 4, custo: 10, foraLinha: null, ult: FIM - 60, fim: FIM, paradoDias: 60, novoPN: false }), true);
  assert.strictEqual(TS.visaoDono.ehParado({ qtd: 4, custo: 10, foraLinha: '2026-01-01', ult: FIM - 90, fim: FIM, paradoDias: 60, novoPN: false }), false, 'fora de linha é "liquidar"');
});

// ======================= EST-02: quadros do topo filtram a tabela =======================
test('EST-02: os números do herói levam à aba da tabela (TS.estFiltrar) e a aba marcada acompanha; contagem das abas = linhas da aba', async () => {
  const { TS, card, heroi } = await telaEstoque(vendasBase(), { aba: 'repor' });
  const segs = achar(card, (n) => n.tag === 'segFolha');
  assert.strictEqual(segs.length, 1);
  const abas = Object.fromEntries(segs[0].attrs.a[0].map(([rot, k]) => [k, rot]));
  assert.strictEqual(abas.repor, 'O que repor (6)'); assert.strictEqual(abas.parados, 'Parados (3)');
  assert.strictEqual(abas.saldo, `Com saldo (${ITENS.filter((i) => i.qtd > 0).length})`); assert.strictEqual(abas.todos, `Todos (${ITENS.length})`);
  assert.strictEqual(segs[0].attrs.a[1], 'repor', 'abre na aba pedida');
  // "Parado" no herói → aba Parados
  const parado = heroi.find((c) => c.rot === 'Estoque a custo').linhas[1].attrs.a[0].find((x) => x.rot.startsWith('Parado'));
  parado.onclick();
  assert.strictEqual(TS.state.estSit, 'parados'); assert.strictEqual(segs[0].marcado, 'parados', 'o seletor marca a aba');
  assert.deepStrictEqual(js(tabelaDe(card).rows.map((x) => x.cod).sort()), ['503', '506', '509']);
  // "N produtos com saldo ›" → aba Com saldo
  const comSaldo = heroi.find((c) => c.rot === 'Estoque a custo').linhas[0];
  comSaldo.attrs.onclick();
  assert.strictEqual(segs[0].marcado, 'saldo');
  assert.ok(tabelaDe(card).rows.every((x) => x.qtd > 0));
  assert.strictEqual(tabelaDe(card).rows.length, ITENS.filter((i) => i.qtd > 0).length);
  // "ver na tabela ›" do Para repor → aba O que repor
  const ver = achar(heroi.find((c) => c.rot === 'Para repor').linhas[1], (n) => n.attrs['data-aba'] === 'repor')[0];
  ver.attrs.onclick();
  assert.strictEqual(segs[0].marcado, 'repor');
  assert.strictEqual(tabelaDe(card).rows.length, 6);
});

// ======================= EST-11: limites da configuração (servidor) =======================
const ES = require('../../src/estoque');
test('EST-11: validarCfg — entrega 0–120, pedido 1–365, parado 7–730, segurança 0–300, % 0–50, margens −50–95, teto 1–90, caixa', () => {
  const ok = (b) => { const r = ES.validarCfg(b); assert.ok(r.ok, 'deveria aceitar: ' + JSON.stringify(b) + ' → ' + r.erro); return r.ok; };
  const erro = (b, re) => { const r = ES.validarCfg(b); assert.ok(r.erro, 'deveria recusar: ' + JSON.stringify(b)); if (re) assert.match(r.erro, re); };
  const B = { entregaDias: 7, coberturaDias: 14, paradoDias: 60, segurancaPct: 50, simplesPct: 6, cartaoPct: 2 };
  const o = ok(B);
  assert.deepStrictEqual([o.entregaDias, o.coberturaDias, o.paradoDias, o.segurancaPct], [7, 14, 60, 50]);
  // padrões quando o campo não vem
  assert.deepStrictEqual([o.margemMin, o.margemAlvo, o.comprasTetoPct, o.prazoNotasDias, o.cartaoDias, o.royaltiesDia], [15, 30, 32, 30, 1, 10]);
  assert.strictEqual(ok({ ...B, segurancaPct: undefined }).segurancaPct, ES.PADRAO.segurancaPct);
  // limites, nas duas pontas
  for (const [k, a, z] of [['entregaDias', 0, 120], ['coberturaDias', 1, 365], ['paradoDias', 7, 730], ['segurancaPct', 0, 300]]) {
    assert.strictEqual(ok({ ...B, [k]: a })[k], a); assert.strictEqual(ok({ ...B, [k]: z })[k], z);
    erro({ ...B, [k]: a - 1 }, /Confira os números/); erro({ ...B, [k]: z + 1 }, /Confira os números/);
  }
  erro({ ...B, entregaDias: 'abc' }, /Confira os números/);
  assert.strictEqual(ok({ ...B, entregaDias: 6.6 }).entregaDias, 7, 'arredonda');
  for (const k of ['simplesPct', 'cartaoPct']) {
    assert.strictEqual(ok({ ...B, [k]: '6,5' })[k], 6.5, 'aceita vírgula');
    assert.strictEqual(ok({ ...B, [k]: 50 })[k], 50); erro({ ...B, [k]: 50.01 }, /entre 0 e 50/); erro({ ...B, [k]: -1 }, /entre 0 e 50/); erro({ ...B, [k]: 'x' }, /entre 0 e 50/);
  }
  assert.strictEqual(ok({ ...B, margemMin: -50 }).margemMin, -50); erro({ ...B, margemMin: -50.1 }, /Margens/);
  assert.strictEqual(ok({ ...B, margemAlvo: 95 }).margemAlvo, 95); erro({ ...B, margemAlvo: 96 }, /Margens/);
  assert.strictEqual(ok({ ...B, comprasTetoPct: 1 }).comprasTetoPct, 1); assert.strictEqual(ok({ ...B, comprasTetoPct: 90 }).comprasTetoPct, 90);
  erro({ ...B, comprasTetoPct: 0.9 }, /Teto de compras/); erro({ ...B, comprasTetoPct: 91 }, /Teto de compras/);
  erro({ ...B, prazoNotasDias: 181 }, /Caixa a pagar/); erro({ ...B, cartaoDias: 61 }, /Caixa a pagar/);
  erro({ ...B, royaltiesDia: 0 }, /Caixa a pagar/); erro({ ...B, royaltiesDia: 32 }, /Caixa a pagar/);
  assert.strictEqual(ok({ ...B, prazoNotasDias: '' }).prazoNotasDias, 30, 'vazio = padrão');
  // listas: 12 categorias, 40 custos, 60 despesas pontuais, 6 embalagens por tamanho
  const cats = (n) => Array.from({ length: n }, (_, i) => ({ id: 'c' + i, nome: 'Cat ' + i }));
  assert.strictEqual(ok({ ...B, categorias: cats(11) }).categorias.length, 12, '"outros" sempre entra');
  erro({ ...B, categorias: cats(13) }, /12 categorias/);
  const custo = (i) => ({ nome: 'C' + i, tipo: 'mes', valor: 10, aplica: 'tudo' });
  assert.strictEqual(ok({ ...B, outros: Array.from({ length: 40 }, (_, i) => custo(i)) }).outros.length, 40);
  erro({ ...B, outros: Array.from({ length: 41 }, (_, i) => custo(i)) }, /40 custos/);
  erro({ ...B, outros: [{ ...custo(1), tipo: 'x' }] }, /escolha % das vendas/);
  erro({ ...B, outros: [{ ...custo(1), aplica: 'x' }] }, /onde se aplica/);
  erro({ ...B, outros: [{ ...custo(1), tipo: 'pct', valor: 101 }] }, /valor inválido/);
  erro({ ...B, outros: [{ ...custo(1), valor: 10000001 }] }, /valor inválido/);
  erro({ ...B, outros: [{ nome: '', tipo: 'mes', valor: 5, aplica: 'tudo' }] }, /nome a cada custo/);
  assert.strictEqual(ok({ ...B, outros: [{ nome: '', valor: '' }] }).outros.length, 0, 'linha vazia é ignorada');
  assert.strictEqual(ok({ ...B, outros: [{ ...custo(1), cat: 'inexistente' }] }).outros[0].cat, 'outros');
  const pont = (i) => ({ nome: 'P' + i, valor: 5, ym: '2026-11' });
  assert.strictEqual(ok({ ...B, pontuais: Array.from({ length: 60 }, (_, i) => pont(i)) }).pontuais.length, 60);
  erro({ ...B, pontuais: Array.from({ length: 61 }, (_, i) => pont(i)) }, /60 despesas/);
  erro({ ...B, pontuais: [{ ...pont(1), ym: '2026-13' }] }, /escolha o mês/);
  erro({ ...B, pontuais: [{ ...pont(1), valor: 0 }] }, /valor inválido/);
  const emb6 = Array.from({ length: 6 }, (_, i) => ({ cod: 'e' + i, qtd: 1 }));
  assert.strictEqual(ok({ ...B, embalagens: { 50: emb6 } }).embalagens['50'].length, 6);
  erro({ ...B, embalagens: { 50: [...emb6, { cod: 'x', qtd: 1 }] } }, /Embalagens/);
  erro({ ...B, embalagens: { '50g': emb6 } }, /Embalagens/);
  assert.deepStrictEqual(ok({ ...B, embalagens: { 50: [{ cod: 'a', qtd: 21 }, { cod: 'b', qtd: 0 }, { cod: '', qtd: 1 }, { cod: 'c', qtd: 2 }] } }).embalagens['50'], [{ cod: 'c', qtd: 2 }], 'quantidade de 0 a 20 e código obrigatório');
  assert.deepStrictEqual(ok(B).embalagens, ok({ ...B, embalagens: {} }).embalagens, 'sem embalagens: o padrão (saco + 2 etiquetas)');
});

// ======================= EST-40: limites do inventário =======================
const INV = require('../../src/inventario');
const catN = (n) => Array.from({ length: n }, (_, i) => ({ cod: String(10000 + i), desc: 'Item ' + i, un: 'UN', qtd: 1, custo: 1, grupo: 'G' }));
test('EST-40: contagem com até 2.000 itens; 2.001 é recusada; nenhum item também', () => {
  const c = INV.criar('l1', { filtro: { grupo: 'G' } }, 'ger', catN(2000), 'gerente');
  assert.ok(c.ok, c.erro); assert.strictEqual(c.ok.itens.length, 2000);
  const x = INV.criar('l1', { filtro: { grupo: 'G' } }, 'ger', catN(2001), 'gerente');
  assert.strictEqual(x.erro, 'Itens demais numa contagem só (máximo 2.000).');
  assert.match(INV.criar('l1', { cods: ['nada'] }, 'ger', catN(3), 'gerente').erro, /pelo menos um item/);
});

test('EST-40: quantidade contada — 0 a 1.000.000, até 3 casas, inteiro fora do kg; lote até 10.000 kg', () => {
  const cat = [{ cod: '1', desc: 'Caneca', un: 'UN', qtd: 5, custo: 2 }, { cod: '2', desc: 'Chá', un: 'Kg', qtd: 1, custo: 100 }];
  const c = INV.criar('l1', { cods: ['1', '2'] }, 'ger', cat, 'gerente').ok;
  assert.strictEqual(INV.contar('l1', c.id, '1', 1e6, 'ger').ok.cont, 1e6);
  assert.match(INV.contar('l1', c.id, '1', 1e6 + 1, 'ger').erro, /inválida/);
  assert.match(INV.contar('l1', c.id, '1', -1, 'ger').erro, /inválida/);
  assert.match(INV.contar('l1', c.id, '1', 1.5, 'ger').erro, /número inteiro/);
  assert.strictEqual(INV.contar('l1', c.id, '2', '1,23456', 'ger').ok.cont, 1.235, 'kg com 3 casas');
  assert.strictEqual(INV.contar('l1', c.id, '2', null, 'ger', { 'L1-abc': 1e4 }).ok.cont, 1e4);
  assert.match(INV.contar('l1', c.id, '2', null, 'ger', { 'L1-abc': 1e4 + 1 }).erro, /inválida no lote/);
  assert.match(INV.contar('l1', c.id, '1', null, 'ger', { 'L1-abc': 1 }).erro, /Só o chá a granel/);
});

test('EST-40: "+ incluir itens" numa contagem aberta respeita o máximo de 2.000', () => {
  const cat = catN(2001);
  const c = INV.criar('l1', { cods: cat.slice(0, 2000).map((i) => i.cod) }, 'ger', cat, 'gerente').ok;
  const r = INV.adicionar('l1', c.id, [cat[2000].cod], cat);
  assert.ok(r.erro, 'deveria recusar passar de 2.000 itens');
});
