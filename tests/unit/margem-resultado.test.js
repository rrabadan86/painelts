'use strict';
/* Margem, preços e resultado (PRC-12…18, RES-02, RES-03, RES-07, RES-08): as contas que vivem dentro das telas
   Rentabilidade, Resultado e Promoção (public/js/estoque.js e public/js/dre.js).
   Sem mudar código de produção: os arquivos do navegador rodam no Node (vm) como em contas.test.js, com o TS.db montado
   das linhas de venda, o /api/estoque respondido por um fetch falso e as peças de tela (TS.h, TS.card, TS.table…)
   trocadas por um desenho em memória — o teste lê os números do que a tela montaria. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '../../public/js');
const LOJA = 'LOJA TESTE';
const HOJE = '2026-11-20';
const CAT_AROM = 'Chás aromatizados, Chás, Rooibos e Infusões Aromatizados, LOJA';

// peças de tela trocadas por nós em memória (nenhuma toca em document)
const PECAS = `
class N {
  constructor(tag, attrs, kids) { this.tag = tag; this.attrs = attrs || {}; this.kids = []; this.isConnected = true; this.value = this.attrs.value ?? '';
    this.style = {}; this.dataset = {}; this.classList = { toggle() {}, add() {}, remove() {}, contains() { return false; } }; this.append(...kids); }
  append(...k) { for (const x of k.flat(Infinity)) if (x != null && x !== false) this.kids.push(x); }
  replaceChildren(...k) { this.kids = []; this.append(...k); }
  remove() {} after() {} addEventListener() {} setAttribute() {} replaceWith() {} querySelector() { return null; }
  get textContent() { return this.kids.map((k) => (k && typeof k === 'object' && 'kids' in k ? k.textContent : String(k))).join(''); }
}
TS.h = (tag, attrs, ...kids) => new N(tag, attrs, kids);
TS.card = (titulo, sub, ...k) => new N('card', { titulo, sub }, k);
TS.cardWithTools = TS.card;
TS.table = (o) => new N('table', { o }, []);
for (const k of ['heroi', 'seg', 'segFolha', 'dica', 'chart', 'empty', 'linhasNum', 'subEstoque', 'subGrupo', 'botoesExpandir', 'deltaSpan']) TS[k] = (...a) => new N(k, { a }, []);
TS.ehCelular = () => false; TS.teclado = () => {}; TS.render = () => {}; TS.telasEstoque = []; TS.periodoTexto = () => '';
TS.axisNum = () => ({}); TS.axisCat = () => ({}); TS.pages = {};
TS.eu = { pode: { configurar: true, custos: true } };
TS.hojeSP = () => '${HOJE}';
`;

/** linha de venda como o servidor guarda */
const venda = (data, x) => ({ data, cupom: 1, vendedor: 'ANA', qtd: 1, du: 0, soNumeros: null, qtdCha: 0, min: null, cod: '', grupo: 'ACESSÓRIOS', grupoC: 'ACESSÓRIOS', cat: 'Acessórios, LOJA', ...x, vt: x.vt ?? (x.vu - (x.du || 0)) * (x.qtd ?? 1) });
const cha50 = (data, qtd, x = {}) => venda(data, { qtd, vu: 25, cod: '270101', soNumeros: 50, qtdCha: 0.05 * qtd, descricao: 'Chá Preto 50G', produto: 'Chá Preto', grupo: 'CHÁ PRETO AROMATIZADO', grupoC: 'CHÁ AROMATIZADO', cat: CAT_AROM, ...x });
const infusor = (data, qtd, x = {}) => venda(data, { qtd, vu: 50, cod: '500', descricao: 'Infusor', produto: 'Infusor', vendedor: 'BIA', ...x });
const bule = (data, qtd, x = {}) => venda(data, { qtd, vu: 50, cod: '502', descricao: 'Bule', produto: 'Bule', ...x });
const xicara = (data, qtd, x = {}) => venda(data, { qtd, vu: 50, du: 30, cod: '503', descricao: 'Xícara', produto: 'Xícara', ...x });
const EG = { grupo: 'ESPAÇO GOURMET', grupoC: 'ESPAÇO GOURMET', cat: 'ESPAÇO GOURMET' };
const taxaServico = (data, vt) => venda(data, { vu: vt, descricao: 'Taxa de Serviço', produto: 'Taxa de Serviço', ...EG });
const taxaDelivery = (data, vt) => venda(data, { vu: vt, descricao: 'Taxa Delivery', produto: 'Taxa Delivery', grupo: 'OUTROS', grupoC: 'OUTROS', cat: 'x' });

const ESTOQUE = { em: `${HOJE}T10:00:00Z`, itens: [
  { cod: '27010', desc: 'Chá Preto', un: 'Kg', tipo: 'IN', custo: 200, qtd: 2 },
  { cod: '900', desc: 'Saco kraft', un: 'UN', tipo: 'IN', custo: 1, qtd: 100 },
  { cod: '500', desc: 'Infusor', un: 'UN', tipo: 'PN', custo: 20, qtd: 5 },
  { cod: '501', desc: 'Caneca', un: 'UN', tipo: 'PN', custo: 0, qtd: 5 },
  { cod: '502', desc: 'Bule', un: 'UN', tipo: 'PN', custo: 45, qtd: 5 },
  { cod: '503', desc: 'Xícara', un: 'UN', tipo: 'PN', custo: 15, qtd: 5 },
] };
const CFG = { simplesPct: 6, cartaoPct: 2, margemMin: 15, margemAlvo: 30, entregaDias: 7, coberturaDias: 14, paradoDias: 60,
  embalagens: { 50: [{ cod: '900', qtd: 1 }], 100: [{ cod: '900', qtd: 1 }] },
  outros: [{ nome: 'Aluguel', tipo: 'mes', valor: 1000, aplica: 'tudo', cat: 'imovel' }, { nome: 'Sistema', tipo: 'pct', valor: 1, aplica: 'tudo', cat: 'outros' }] };
// comissão fixa por tipo (5% aromatizado, 6% puro, 2% acessórios), sem premiação nem bônus: a conta fica legível
const REGRAS = { comissao: { modo: 'simples', arom: { acima120: 0.05, bate: 0.05, abaixo: 0.05 }, puro: { acima120: 0.06, bate: 0.06, abaixo: 0.06 }, acess: { acima120: 0.02, bate: 0.02, abaixo: 0.02 } },
  premiacao: { ativa: false }, bonus: { abaixo: 0, bate: 0, acima120: 0 } };

/** os arquivos do navegador (core, contas, rules, classeprod, custodata, grupoprod, ruptura, visaodono, estoque, dre) num contexto novo */
function painel(linhas, { cfg = CFG, estoque = ESTOQUE, tabela = null, regras = REGRAS, classe = { meses: 6, fixas: {} } } = {}) {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout });
  vm.runInContext("var window = globalThis; var location = { pathname: '/', hash: '' };", ctx);
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
  ctx.__estoque = JSON.parse(JSON.stringify({ estoque, cfg, tabela, classe, historico: null, compras: null }));
  vm.runInContext(`TS.db = TS.decode(JSON.parse(__raw)); TS.rules.prepare(); TS.state.loja = 'l1';
    globalThis.fetch = async (u) => ({ ok: true, json: async () => (String(u).includes('estoque?') ? __estoque : {}) });`, ctx);
  return vm.runInContext('TS', ctx);
}
const espera = () => new Promise((ok) => setTimeout(ok, 30));
/** todos os nós do desenho em memória que passam no teste */
function achar(no, ok, out = []) {
  if (!no || typeof no !== 'object' || !('kids' in no)) return out;
  if (ok(no)) out.push(no);
  for (const k of no.kids) achar(k, ok, out);
  return out;
}
const cartao = (raiz, ini) => achar(raiz, (n) => n.tag === 'card' && String(n.attrs.titulo || '').startsWith(ini))[0];
const tabelaDe = (no) => achar(no, (n) => n.tag === 'table')[0].attrs.o;
const perto = (a, b, msg, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${msg || ''} esperado ${b}, veio ${a}`);
const dia = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400e3);
/** cópia no contexto do teste (arrays e objetos do vm têm outro protótipo) */
const js = (x) => JSON.parse(JSON.stringify(x));
/** texto exato numa expressão regular; espaço vale qualquer espaço (o Intl põe espaço inseparável em "R$ 1.234") */
const re = (t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s'));

/** Rentabilidade da loja em outubro/2026 (mês fechado) */
const OUT = [
  cha50('2026-10-05', 4),                    // 100, custo 4 × (50 g × 200/kg + saco 1) = 44
  infusor('2026-10-06', 2),                  // 100, custo 40
  bule('2026-10-07', 2),                     // 100, custo 90: contribuição negativa pelo custo
  xicara('2026-10-08', 2),                   // preço cheio 100, desconto 60 → 40; custo 30: contribuição baixa pelo desconto
  venda('2026-10-09', { vu: 80, cod: '999', descricao: 'Livro Raro', produto: 'Livro Raro', grupo: 'LIVROS', grupoC: 'LIVROS', cat: 'Livros, LOJA' }), // fora do estoque
  venda('2026-10-09', { vu: 30, cod: '501', descricao: 'Caneca', produto: 'Caneca' }), // custo zero no AppNext
  venda('2026-10-10', { qtd: 2, vu: 25, cod: '280101', soNumeros: 50, qtdCha: 0.1, descricao: 'Chá Verde 50G', produto: 'Chá Verde', grupo: 'CHÁ VERDE AROMATIZADO', grupoC: 'CHÁ AROMATIZADO', cat: CAT_AROM }), // matéria-prima fora da planilha
  venda('2026-10-11', { vu: 40, descricao: 'Chá da casa', produto: 'Chá da casa', ...EG }),
  taxaServico('2026-10-11', 4),
  taxaDelivery('2026-10-12', 12),
  infusor('2026-10-12', 1, { vu: 0.01 }),   // prêmio de fidelidade a R$ 0,01
];
const OUTUBRO = (TS) => { TS.state.f.de = dia('2026-10-01'); TS.state.f.ate = dia('2026-10-31'); };

async function rentab(linhas, opts, antes) {
  const TS = painel(linhas, opts);
  OUTUBRO(TS);
  if (antes) antes(TS);
  const raiz = TS.h('div');
  TS.pages.rentab(raiz);
  await espera();
  const erro = achar(raiz, (n) => n.tag === 'div' && /notice err/.test(n.attrs.class || ''))[0];
  assert.ok(!erro, 'a tela montou sem erro: ' + (erro && erro.textContent));
  return { TS, raiz };
}

// ======================= PRC-15: deduções da margem líquida =======================
test('PRC-15: deduções de cada venda — comissão pelo tipo, royalties + marketing, Simples, maquininha e custos em % e em R$ por mês', async () => {
  const TS = painel(OUT);
  const M = await TS.custosLoja();
  assert.ok(M && M.ded, 'o motor da loja vem com as deduções');
  const db = TS.db, D = M.ded;
  const linha = (desc) => { for (let i = 0; i < db.n; i++) if (db.D.descricao[db.desc[i]] === desc) return i; return -1; };
  // média do faturamento dos meses fechados (só outubro): sem taxas e sem o item a R$ 0,01, com o Espaço Gourmet (aplica "tudo")
  const fatOut = 100 + 100 + 100 + 40 + 80 + 30 + 50 + 40;
  perto(D.mediaFat('tudo').media, fatOut, 'base do rateio do aluguel');
  assert.deepStrictEqual(js(D.mediaFat('tudo').meses), ['2026-10']);
  perto(D.taxaOutro(CFG.outros[0]), 1000 / fatOut, 'aluguel vira % pela média do faturamento');
  perto(D.taxaOutro(CFG.outros[1]), 0.01, 'custo em % é o próprio %');

  // chá aromatizado (R$ 100): comissão 5%, royalties 6% + marketing 2%, Simples 6%, maquininha 2%, sistema 1%, aluguel rateado
  const c = D.deducoes(linha('Chá Preto 50G'));
  perto(c.com, 5, 'comissão do aromatizado'); perto(c.roy, 8, 'royalties + marketing'); perto(c.royS, 6); perto(c.mkt, 2);
  perto(c.imp, 6, 'Simples'); perto(c.maq, 2, 'maquininha');
  perto(c.outros[1], 1, 'custo em %'); perto(c.outros[0], 100 * 1000 / fatOut, 'aluguel rateado');
  perto(c.var, 5 + 8 + 6 + 2 + 1, 'variáveis = comissão + royalties + Simples + maquininha + custos em %');
  perto(c.fix, 100 * 1000 / fatOut, 'fixos = custos em R$ por mês rateados');
  // acessório: comissão de 2%
  perto(D.deducoes(linha('Infusor')).com, 2, 'comissão do acessório');
  // Espaço Gourmet: sem comissão; royalties do EG (2% + 2% de marketing)
  const eg = D.deducoes(linha('Chá da casa'));
  perto(eg.com, 0, 'EG não tem comissão'); perto(eg.roy, 40 * 0.04, 'royalties do EG'); perto(eg.imp, 40 * 0.06);
  // grupo fora da meta (livro): sem comissão e sem royalties (a mesma base do R.royalties, só os grupos da meta)
  const lv = D.deducoes(linha('Livro Raro'));
  perto(lv.com, 0); perto(lv.roy, 0); perto(lv.imp, 80 * 0.06);
  // comissão do mês = o que a loja pagou ÷ vendas de cada tipo
  const cm = D.comDoMes('2026-10');
  perto(cm.arom, 0.05); perto(cm.acess, 0.02);
  // % para o Orçamento (taxasVenda): comissão média do mês fechado anterior
  const tv = D.taxasVenda();
  assert.strictEqual(tv.mesCom, '2026-10');
  perto(tv.roy, 0.08); perto(tv.imp, 0.06); perto(tv.maq, 0.02); perto(tv.outrosPct, 0.01); perto(tv.outrosFix, 1000 / fatOut);
});

test('PRC-15: custo só da loja não pesa no Espaço Gourmet; % de royalties e Simples de cada mês (PCT-ESC-01)', async () => {
  const cfg = { ...CFG, outros: [{ nome: 'Vitrine', tipo: 'pct', valor: 3, aplica: 'loja' }],
    // royalties com fator 0,5 em outubro ("o % valia isto até outubro") e Simples de 4% até outubro
    fixosMes: { '@royalties': { '@ate': [{ ate: '2026-10', valor: 0.5 }] }, '@simples': { '@ate': [{ ate: '2026-10', valor: 4 }] } } };
  const TS = painel([...OUT, cha50('2026-11-05', 4)], { cfg });
  const M = await TS.custosLoja();
  const db = TS.db;
  const idx = (desc, ym) => { for (let i = 0; i < db.n; i++) if (db.D.descricao[db.desc[i]] === desc && db.ym[i] === ym) return i; return -1; };
  const egOut = M.ded.deducoes(idx('Chá da casa', '2026-10'));
  perto(egOut.outros[0], 0, 'custo "só loja" não entra no EG');
  const chaOut = M.ded.deducoes(idx('Chá Preto 50G', '2026-10'));
  perto(chaOut.outros[0], 3, 'custo "só loja" entra na loja');
  perto(chaOut.royS, 100 * 0.06 * 0.5, 'royalties de outubro com o fator da época');
  perto(chaOut.imp, 4, 'Simples de outubro com o % da época');
  const chaNov = M.ded.deducoes(idx('Chá Preto 50G', '2026-11'));
  perto(chaNov.royS, 6, 'novembro com o % atual'); perto(chaNov.imp, 6);
});

// ======================= PRC-13: taxas fora do faturamento e da margem =======================
test('PRC-13: taxa de serviço, taxa de entrega e item a R$ 0,01 ficam fora do faturamento, da margem e da base do rateio', async () => {
  const { TS, raiz } = await rentab(OUT);
  const M = await TS.custosLoja();
  const db = TS.db;
  const taxas = [];
  for (let i = 0; i < db.n; i++) if (M.taxa(i)) taxas.push(db.D.descricao[db.desc[i]] + '|' + db.vu[i]);
  assert.deepStrictEqual(js(taxas.sort()), ['Infusor|0.01', 'Taxa Delivery|12', 'Taxa de Serviço|4']);
  // Rentabilidade: o faturamento do herói não tem as taxas (540, não 556)
  const heroi = achar(raiz, (n) => n.tag === 'heroi')[0];
  const lb = heroi.attrs.a[0].find((c) => c.rot === 'Lucro bruto');
  assert.match(lb.linhas[1].textContent, re('(R$ 340 de R$ 540)'), 'vendas com custo / faturamento sem taxas');
  // nenhum produto da tabela é taxa
  TS.state.rentAba = 'produtos';
  const r2 = TS.h('div'); TS.pages.rentab(r2); await espera();
  const prods = tabelaDe(cartao(r2, 'Produtos por lucro')).rows.map((p) => p.produto).sort();
  assert.deepStrictEqual(js(prods), ['Bule', 'Chá Preto', 'Infusor', 'Xícara']);
  // Resultado: a taxa de serviço fica fora da receita (informativa), a de entrega some
  const out = TS.dreCalcular(M, {}).find((m) => m.ym === '2026-10');
  perto(out.fat, 540, 'faturamento do Resultado'); perto(out.gorjeta, 4, 'taxa de serviço guardada à parte');
  perto(out.gorjImp, 4 * 0.06, 'o Simples que a taxa pagaria (ⓘ)');
  perto(out.imp, 540 * 0.06, 'Simples só sobre a receita');
});

// ======================= PRC-12: venda sem custo =======================
test('PRC-12: venda sem custo fica fora da margem e é listada com o motivo (chá a granel pela matéria-prima, uma linha)', async () => {
  const { TS, raiz } = await rentab(OUT);
  const sem = achar(raiz, (n) => n.tag === 'details' && /est-sem/.test(n.attrs.class || ''))[0];
  assert.ok(sem, 'a lista "Vendas sem custo" aparece na Rentabilidade');
  assert.match(sem.kids[0].textContent, re('Vendas sem custo: R$ 200 em 4 produtos (ficam fora da margem)'));
  const rows = js(tabelaDe(sem).rows.map((r) => [r.produto, r.motivo, r.vt])).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepStrictEqual(rows, [
    ['Caneca', 'custo zero no AppNext', 30],
    ['Chá da casa', 'não achado no estoque', 40],
    ['Chá Verde', 'matéria-prima (cód. 28010) não está na planilha de estoque', 50],
    ['Livro Raro', 'não achado no estoque', 80],
  ]);
  const verde = tabelaDe(sem).rows.find((r) => r.produto === 'Chá Verde');
  assert.strictEqual(verde.granel, true); assert.strictEqual(verde.tamanhos, '2× 50g');
  // a margem do herói é só das vendas com custo: lucro bruto = 340 − Simples 6% − custo (44 + 40 + 90 + 30)
  const heroi = achar(raiz, (n) => n.tag === 'heroi')[0];
  const lb = heroi.attrs.a[0].find((c) => c.rot === 'Lucro bruto');
  assert.strictEqual(lb.num, TS.fmt.brl0(115.6)); // 340 − 20,40 − 204 = 115,60
  assert.match(lb.linhas[0].textContent, /margem de 34,0%/);
});

test('PRC-12: com custo em todas as vendas, a lista "Vendas sem custo" não aparece', async () => {
  const { raiz } = await rentab(OUT.filter((l) => !['Caneca', 'Livro Raro', 'Chá Verde 50G', 'Chá da casa'].includes(l.descricao)));
  assert.strictEqual(achar(raiz, (n) => n.tag === 'details' && /est-sem/.test(n.attrs.class || '')).length, 0);
});

// ======================= PRC-16: ponto de equilíbrio =======================
const NOV = [cha50('2026-11-05', 4), infusor('2026-11-06', 2), taxaDelivery('2026-11-06', 50)];
async function equilibrio(cfg) {
  const TS = painel([...OUT, ...NOV], { cfg });
  const box = TS.cartaoEquilibrio('l1');
  await espera();
  return { TS, card: cartao(box, 'Ponto de equilíbrio') };
}
test('PRC-16: ponto de equilíbrio = (fixos do mês + despesas só do mês) ÷ margem de contribuição das vendas com custo do mês', async () => {
  const cfg = { ...CFG, fixosMes: { Aluguel: { '2026-11': { valor: 1200 } } }, pontuais: [{ nome: 'IPTU', valor: 300, ym: '2026-11', cat: 'imovel' }, { nome: 'Outro mês', valor: 999, ym: '2026-09' }] };
  const { TS, card } = await equilibrio(cfg);
  assert.ok(card, 'o cartão aparece');
  assert.strictEqual(card.attrs.titulo, 'Ponto de equilíbrio de nov/26');
  // novembro: vendas 200 (a taxa de entrega fica fora), custo 44 + 40, variáveis 22 + 19 → contribuição 37,5%
  // fixos: aluguel LANÇADO no mês (1200, não o padrão 1000) + IPTU só deste mês (300) = 1500 → equilíbrio 4000
  const texto = card.textContent;
  const f = TS.fmt;
  assert.match(texto, re(`Faltam ${f.brl0(3800)} para pagar os custos fixos · ${f.brl0(3800 / 24)} por dia nos 24 dias que faltam`));
  assert.match(texto, re(`equilíbrio em ${f.brl0(4000)} · inclui ${f.brl0(300)} de despesas só deste mês`));
  const dica = achar(card, (n) => n.tag === 'dica')[0].attrs.a[0];
  assert.match(dica, re('Custos fixos R$ 1.500 (Aluguel, IPTU; R$ 300 são despesas só deste mês: IPTU) ÷ margem de contribuição 37,5% = R$ 4.000'));
  // a conta é a mesma de TS.contas.pontoEquilibrio
  assert.strictEqual(TS.contas.pontoEquilibrio({ fixos: [{ valor: 1200 }], pontuais: [{ valor: 300 }], margem: 0.375 }).equilibrio, 4000);
});

test('PRC-16: passou do equilíbrio mostra o dia em que os fixos foram pagos; sem fixos pede o cadastro', async () => {
  const { card } = await equilibrio({ ...CFG, outros: [{ nome: 'Aluguel', tipo: 'mes', valor: 50, aplica: 'tudo' }] });
  // equilíbrio 50 ÷ 37,5% = 133,33: dia 5 vendeu 100, dia 6 chega a 200
  assert.match(card.textContent, /Custos fixos do mês pagos desde 06\/11: daqui para frente é lucro/);
  const { card: vazio } = await equilibrio({ ...CFG, outros: [] });
  assert.match(vazio.textContent, /Cadastre os custos fixos/);
});

// ======================= PRC-17: classe oficial =======================
test('PRC-17: classe oficial — meses fechados da janela, sem o mês em andamento, sem Espaço Gourmet; chá só com chá; travada vale acima da conta', async () => {
  const linhas = [];
  for (const ym of ['2026-08', '2026-09', '2026-10']) linhas.push(cha50(`${ym}-05`, 4), infusor(`${ym}-06`, 3), bule(`${ym}-07`, 1));
  linhas.push(xicara('2026-08-08', 30, { du: 0, vt: 1500 }));     // 30 xícaras num mês só (promoção): mediana 0 por mês
  linhas.push(xicara('2026-11-08', 99, { du: 0, vt: 4950 }));     // mês em andamento: não entra
  linhas.push(infusor('2026-05-08', 50));                           // antes da janela de 3 meses: não entra
  linhas.push(venda('2026-10-11', { vu: 40, cod: '500', descricao: 'Infusor EG', produto: 'Infusor EG', ...EG })); // EG fora
  const TS = painel(linhas);
  const M = await TS.custosLoja();
  const CO = TS.classeOficial(M, { meses: 3, fixas: { 502: { classe: 'estrela', por: 'dono' }, 777: { classe: 'joia' } } });
  assert.strictEqual(CO.meses, 3); assert.strictEqual(CO.de, '2026-08'); assert.strictEqual(CO.ate, '2026-10');
  perto(CO.min, 0.15); perto(CO.alvo, 0.30);
  const ch = CO.get('27010'), inf = CO.get('500'), bu = CO.get('502'), xi = CO.get('503');
  // chá a granel: giro em kg (4 × 50 g por mês = 0,2 kg), comparado só com chá → Estrela mesmo vendendo "menos" que o infusor
  perto(ch.giro, 0.2); assert.strictEqual(ch.kg, true); assert.strictEqual(ch.classe, 'estrela');
  perto(ch.margem, (300 - 132) / 300, 'margem bruta = (venda − custo) ÷ venda');
  perto(ch.margemSf, (300 - 132 - 300 * 0.22) / 300, 'margem sem fixos = − variáveis');
  perto(inf.giro, 3, 'mediana de 3, 3, 3 (a venda de maio está fora da janela; a do EG não conta)');
  perto(inf.margem, 0.6);
  perto(xi.giro, 0, 'mediana de 30, 0, 0: um mês de promoção pesa pouco');
  // bule: vende 1 por mês (a mediana dos 3 produtos: conta como "vende muito") com margem de 10% (abaixo da mínima de 15%)
  // → Volume pela conta; travado à mão como Estrela, vale a travada
  assert.strictEqual(bu.auto, 'volume'); assert.strictEqual(bu.acimaMin, false); assert.strictEqual(bu.classe, 'estrela'); assert.strictEqual(bu.fixa.por, 'dono');
  // travado sem venda na janela também aparece
  assert.deepStrictEqual(js([CO.get('777').classe, CO.get('777').auto]), ['joia', null]);
  // janela inválida volta para 6 meses
  assert.strictEqual(TS.classeOficial(M, { meses: 5, fixas: {} }).meses, 6);
});

// ======================= PRC-18: margem de tabela =======================
const TABELA = { simples: { em: '2026-11-19T00:00:00Z' }, compostos: { em: '2026-11-19T00:00:00Z' }, itens: [
  { cod: '270101', desc: 'Chá Preto 50G', preco: 25, grupo: 'CHÁ' },
  { cod: '270102', desc: 'Chá Preto 100G', preco: 45, grupo: 'CHÁ' },  // não vendido no período
  { cod: '500', desc: 'Infusor', preco: 50, grupo: 'ACESSÓRIOS' },
  { cod: '502', desc: 'Bule', preco: 50, grupo: 'ACESSÓRIOS' },
  { cod: '503', desc: 'Xícara', preco: 50, grupo: 'ACESSÓRIOS' },
  { cod: '999', desc: 'Livro Raro', preco: 80, grupo: 'LIVROS' },    // sem custo
  { cod: '777', desc: 'Brinde', preco: 0.01, grupo: 'ACESSÓRIOS' },  // preço simbólico: fica de fora
] };
test('PRC-18: margem de tabela — todo o cadastro, vendido ou não: preço de tabela × custo atual (chá com saco), contribuição e desconto praticado', async () => {
  const { TS, raiz } = await rentab(OUT, { tabela: TABELA }, (T) => { T.state.rentAba = 'tabela'; });
  const card = cartao(raiz, 'Margem de tabela');
  assert.ok(card, 'o cartão aparece na aba Margem de tabela');
  const rows = tabelaDe(card).rows;
  const r = Object.fromEntries(rows.map((x) => [x.cod, x]));
  assert.deepStrictEqual(js(Object.keys(r).sort()), ['270101', '270102', '500', '502', '503'], 'aba "Todos com custo": sem o livro (sem custo) e sem o brinde a R$ 0,01');
  // chá: gramas × custo do kg + saco kraft
  perto(r['270101'].custo, 11); perto(r['270101'].margem, (25 - 11) / 25);
  perto(r['270102'].custo, 21); perto(r['270102'].margem, (45 - 21) / 45);
  assert.strictEqual(r['270102'].vendido, 0, 'sem venda no período também aparece'); assert.strictEqual(r['270102'].mReal, null);
  // contribuição de tabela = margem de tabela − deduções variáveis médias do período (22% no chá, 19% no resto)
  perto(r['270101'].mSf, (25 - 11) / 25 - 0.22); perto(r['500'].mSf, 0.6 - 0.19);
  // praticada e desconto: xícara de tabela 70%, vendida com desconto a 25% → 45 pontos
  perto(r['503'].margem, 0.7); perto(r['503'].mReal, (40 - 30) / 40); perto(r['503'].desconto, 0.7 - 0.25);
  perto(r['500'].desconto, 0, 'vendido pelo preço de tabela');
  // abaixo da mínima (15%): bule (10% − 19%)
  assert.deepStrictEqual(js(rows.filter((x) => x.abaixo).map((x) => x.cod)), ['502']);
  assert.match(card.attrs.sub, /22,0% nos chás a granel, 19,0% no resto/);
  // aba "Sem custo": o livro
  TS.state.estTabF = 'semcusto';
  const r2 = TS.h('div'); TS.pages.rentab(r2); await espera();
  assert.deepStrictEqual(js(tabelaDe(cartao(r2, 'Margem de tabela')).rows.map((x) => x.cod)), ['999']);
});

// ======================= RES-07: margem abaixo da mínima, com o motivo =======================
test('RES-07: margem de contribuição abaixo da mínima, com o motivo (o que mais pesa no preço contra a média da loja, ou o desconto)', async () => {
  const { TS, raiz } = await rentab(OUT, {}, (T) => { T.state.rentAba = 'geral'; });
  const card = cartao(raiz, 'Margem de contribuição abaixo de 15%');
  assert.ok(card, 'o cartão aparece na visão geral');
  const rows = tabelaDe(card).rows;
  assert.deepStrictEqual(js(rows.map((x) => x.produto)), ['Bule', 'Xícara'], 'só os abaixo de 15%, do pior para o melhor');
  const f = TS.fmt;
  // custo médio da loja (sem embalagem) = (40 + 40 + 90 + 30) ÷ 340
  const media = (40 + 40 + 90 + 30) / 340;
  const bu = rows[0];
  perto(bu.margemContrib, (100 - 90 - 19) / 100);
  assert.strictEqual(bu.motivo, `Custo do produto: ${f.pct(0.9)} do preço (média da loja ${f.pct(media)})`);
  perto(bu.pv, 50); perto(bu.pc, 45);
  const xi = rows[1];
  perto(xi.margemContrib, (40 - 30 - 40 * 0.19) / 40);
  assert.strictEqual(xi.motivo, `Desconto: ${f.pct(0.6)} do preço cheio`, 'desconto de 60% pesa mais que o custo acima da média');
  // sem nenhum abaixo: a frase de parabéns
  const { raiz: r2 } = await rentab(OUT.filter((l) => !['Bule', 'Xícara'].includes(l.descricao)), {}, (T) => { T.state.rentAba = 'geral'; });
  assert.match(cartao(r2, 'Margem de contribuição abaixo').textContent, /Nenhum produto abaixo da margem mínima/);
});

// ======================= RES-08: lucro da promoção =======================
async function promo(antes, durante, extra = []) {
  const linhas = [...antes, ...durante, ...extra];
  const TS = painel(linhas);
  const idx = (de, ate) => { const o = []; for (let i = 0; i < TS.db.n; i++) if (TS.db.iso[i] >= de && TS.db.iso[i] <= ate) o.push(i); return o; };
  const card = TS.cartaoLucroPromo({ antes: idx('2026-09-01', '2026-09-10'), durante: idx('2026-10-01', '2026-10-10'), depois: [], diasAntes: 10, diasDurante: 10, diasDepois: 0 });
  await espera();
  return { TS, card };
}
test('RES-08: lucro da promoção — lucro bruto por dia antes × durante, veredito e produtos que mais mudaram (taxas fora)', async () => {
  // antes: 10 infusores a 50 (lucro 300 em 10 dias = 30/dia); durante: 30 com desconto de 15 (venda 1050, custo 600 → 45/dia)
  const { card } = await promo([infusor('2026-09-05', 10)], [infusor('2026-10-05', 30, { du: 15 })], [taxaDelivery('2026-10-06', 500)]);
  const corpo = card.kids[0];
  const t = corpo.textContent;
  assert.match(t, re('A promoção se pagou: o lucro por dia subiu 50% em relação aos 10 dias antes, mesmo com R$ 450 em descontos.'));
  assert.match(t, /Ainda não há dias depois da promoção\./);
  const rows = tabelaDe(corpo).rows;
  assert.deepStrictEqual(js(rows.map((r) => [r.produto, r.antes, r.durante, r.dif])), [['Infusor', 30, 45, 15]]);
  // empate (±3%) e prejuízo
  const { card: c2 } = await promo([infusor('2026-09-05', 10)], [infusor('2026-10-05', 10)]);
  assert.match(c2.kids[0].textContent, /Empate: o lucro por dia ficou praticamente igual/);
  const { card: c3 } = await promo([infusor('2026-09-05', 10)], [infusor('2026-10-05', 10, { du: 20 })]);
  assert.match(c3.kids[0].textContent, /A promoção não se pagou: o lucro por dia caiu 67%/);
});

test('RES-08: lucro antes negativo — subir de −R$ 2,50/dia para +R$ 2,00/dia é melhora, não "não se pagou"', async () => {
  // antes: 2 bules vendidos a 32,50 (custo 90): lucro −25 em 10 dias = −2,5/dia; durante: 2 bules a 55 → +20/10 = +2/dia
  const { card } = await promo([bule('2026-09-05', 2, { vu: 32.5 })], [bule('2026-10-05', 2, { vu: 55 })]);
  assert.match(card.kids[0].textContent, /A promoção se pagou/);
});

// ======================= RES-02: projeção do mês em andamento =======================
test('RES-02: projeção do mês em andamento — vendas e o que depende delas crescem pelo fator; fixos, perdas e valores lançados ficam', async () => {
  const cfg = { ...CFG, fixosMes: { '@simples': { '2026-11': { valor: 50 } } } };
  const TS = painel([...OUT, ...NOV], { cfg });
  const M = await TS.custosLoja();
  const meses = TS.dreCalcular(M, {});
  assert.deepStrictEqual(js(meses.map((m) => [m.ym, m.parcial])), [['2026-10', false], ['2026-11', true]]);
  assert.strictEqual(meses[0].proj, undefined, 'mês fechado não tem projeção');
  const m = meses[1], P = m.proj;
  // sem a projeção única (TS.projecaoMes): dias do mês ÷ dias decorridos (vendas até o dia 6 de 30) = 5
  assert.strictEqual(m.decorridos, 6); assert.strictEqual(m.diasMes, 30);
  perto(P.fator, 5); assert.strictEqual(P.projecao, true); assert.strictEqual(P.parcial, false);
  perto(P.fat, m.fat * 5); perto(P.cmv, m.cmv * 5); perto(P.maq, m.maq * 5); perto(P.varPct, m.varPct * 5);
  perto(P.royPago, m.royS * 5, 'royalties calculados acompanham as vendas');
  perto(m.imp, 50, 'Simples lançado no mês substitui o calculado'); perto(P.imp, 50, 'e não cresce com a projeção');
  perto(P.impCalc, m.impCalc * 5);
  perto(P.fixoTot, m.fixoTot, 'custos fixos já são do mês inteiro'); perto(P.fixoTot, 1000);
  perto(P.com, M.ded.comProjetada('2026-11', 5), 'comissão recalculada com a venda projetada contra a meta');
  perto(P.resultado, P.contrib - P.fixoTot + P.fin, 'resultado pelos mesmos degraus');
  // com a projeção única do painel (dia da semana, loja aberta), o fator é projeção ÷ vendido
  TS.projecaoMes = () => ({ proj: 600 });
  const P2 = TS.dreCalcular(M, {})[1].proj;
  perto(P2.fator, 3); perto(P2.fat, 600);
});

test('RES-02: custo em % com o valor real lançado no mês em andamento não cresce com a projeção', async () => {
  const cfg = { ...CFG, fixosMes: { Sistema: { '2026-11': { valor: 10 } } } };
  const TS = painel([...OUT, ...NOV], { cfg });
  const M = await TS.custosLoja();
  const m = TS.dreCalcular(M, {})[1];
  perto(m.varPct, 10, 'o lançado substitui o calculado no mês');
  perto(m.proj.varPct, 10, 'o lançado não cresce com as vendas');
});

// ======================= RES-03: comparação com o ano anterior =======================
const ANOS = [infusor('2025-10-05', 2), infusor('2026-10-05', 3), infusor('2025-11-03', 2), infusor('2025-11-25', 4), infusor('2026-11-05', 2), infusor('2026-11-06', 2)];
const CFG_ANOS = { ...CFG, outros: [{ nome: 'Aluguel', tipo: 'mes', valor: 100, aplica: 'tudo' }] };
const linhaDre = (raiz, rot) => achar(raiz, (n) => n.tag === 'tr' && n.kids[0] && String(n.kids[0].textContent).startsWith(rot))[0];
test('RES-03: mês em andamento — o faturamento do topo compara com os MESMOS dias do ano anterior; a tabela, a projeção com o mês inteiro', async () => {
  const TS = painel(ANOS, { cfg: CFG_ANOS });
  const M = await TS.custosLoja();
  // a conta dos mesmos dias: nov/25 só até o dia 6
  const mesmosDias = TS.dreCalcular(M, { soYm: '2025-11', ateDia: 6 });
  assert.strictEqual(mesmosDias.length, 1); perto(mesmosDias[0].fat, 100); assert.strictEqual(mesmosDias[0].parcial, false);
  const raiz = TS.h('div');
  TS.pages.dre(raiz);
  await espera();
  const col = achar(raiz, (n) => n.tag === 'heroi')[0].attrs.a[0].find((c) => c && c.rot === 'Faturamento');
  const v = col.linhas[0];
  perto(achar(v, (n) => n.tag === 'deltaSpan')[0].attrs.a[0], 200 / 100 - 1, 'nov/26 até o dia 6 (200) × nov/25 até o dia 6 (100)');
  assert.match(v.textContent, /vs\. nov\/25 \(dias 1 a 6\)/);
  // tabela: projeção (200 × 30/6 = 1000) contra nov/25 inteiro (300)
  const th = achar(raiz, (n) => n.tag === 'th' && /dre-var/.test(n.attrs.class || ''))[0];
  assert.strictEqual(th.textContent, 'Projeção × nov/25 inteiro');
  const rb = linhaDre(raiz, 'Receita bruta');
  assert.strictEqual(rb.kids[rb.kids.length - 1].textContent, TS.fmt.delta(1000 / 300 - 1));
});

test('RES-03: mês fechado — compara com o mesmo mês inteiro do ano anterior; sem ele, "—"', async () => {
  const TS = painel(ANOS, { cfg: CFG_ANOS });
  TS.state.dreMes = '2026-10';
  const raiz = TS.h('div');
  TS.pages.dre(raiz);
  await espera();
  const th = achar(raiz, (n) => n.tag === 'th' && /dre-var/.test(n.attrs.class || ''))[0];
  assert.strictEqual(th.textContent, 'Variação');
  const rb = linhaDre(raiz, 'Receita bruta');
  assert.strictEqual(rb.kids[rb.kids.length - 1].textContent, TS.fmt.delta(150 / 100 - 1), 'out/26 (150) × out/25 (100)');
  const col = achar(raiz, (n) => n.tag === 'heroi')[0].attrs.a[0].find((c) => c && c.rot === 'Faturamento');
  assert.match(col.linhas[0].textContent, /vs\. out\/25$/);
  // sem o ano anterior
  const T2 = painel(ANOS.filter((l) => l.data >= '2026-01-01'), { cfg: CFG_ANOS });
  T2.state.dreMes = '2026-10';
  const r2 = T2.h('div'); T2.pages.dre(r2); await espera();
  const rb2 = linhaDre(r2, 'Receita bruta');
  assert.strictEqual(rb2.kids[rb2.kids.length - 1].textContent, '—');
  assert.strictEqual(cartao(r2, 'Resultado de out/26').attrs.sub, 'Sem o mesmo mês do ano anterior para comparar');
});
