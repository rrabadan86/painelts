'use strict';
/* Regras das contas do Pedido (Estoque → Pedido): EST-50 (valor = % do faturamento pelo CMV real), EST-52 (prioridades),
   EST-53 (divisão do valor entre os grupos), EST-54 (data comemorativa) e EST-59 (aviso de validade).
   A conta vive dentro da tela (public/js/pedido.js, função `calcular`, sem export): o arquivo roda no Node (vm) como os
   outros testes de tela, e só NA MEMÓRIA do teste ganha uma linha que expõe `calcular` (o arquivo de produção não muda).
   O TS.db, o motor de custos (M) e a classe oficial são montados à mão, pequenos, para a conta ficar legível. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '../../public/js');
const FIM = '2026-11-20'; // último dia com venda; "hoje" do pedido = 21/11/2026

/** core.js + pedido.js num contexto novo; `calcular` exposto só aqui */
function carregar() {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout });
  vm.runInContext("var window = globalThis; var location = { pathname: '/', hash: '' }; var document = { addEventListener() {}, title: 'Painel', hidden: false };", ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'core.js'), 'utf8'), ctx, { filename: 'core.js' });
  vm.runInContext('TS.pages = TS.pages || {};', ctx);
  const src = fs.readFileSync(path.join(JS, 'pedido.js'), 'utf8');
  const marca = '  // ---------- tela ----------';
  assert.ok(src.includes(marca), 'pedido.js mudou: o teste procura a marca "// ---------- tela ----------" depois de calcular()');
  vm.runInContext(src.replace(marca, '  TS.__ped = { calcular, setVal: (v) => { VAL = v; } };\n' + marca), ctx, { filename: 'pedido.js' });
  return vm.runInContext('TS', ctx);
}
const TS = carregar();
const dia = (iso) => TS.isoToDay(iso);
const antes = (n) => TS.dayToIso(dia(FIM) - n); // n dias antes do último dia
const js = (x) => JSON.parse(JSON.stringify(x));

// categorias e grupos do TS.db de mentira
const CAT = ['LOJA', 'ESPAÇO GOURMET', 'Envasados'];
const GRP = { cha: 0, acess: 1, env: 2 };

/**
 * Monta TS.db, TS.rules.ids, TS.classeOficial e o motor M a partir de linhas de venda simples:
 *   { d: 'AAAA-MM-DD', vt, g: 'cha'|'acess'|'env', eg, taxa, custo, custoHoje, cons: [[cod, q], …] }
 */
function cenario(vendas, estoque, { classes = {}, minDay } = {}) {
  const itens = new Map(estoque.map((it) => [String(it.cod), it]));
  const db = { n: vendas.length, day: [], vt: [], cat: [], grupo: [], ym: [], D: { cat: CAT } };
  for (const v of vendas) {
    db.day.push(dia(v.d)); db.vt.push(v.vt || 0); db.ym.push(v.d.slice(0, 7));
    db.cat.push(v.eg ? 1 : v.g === 'env' ? 2 : 0); db.grupo.push(GRP[v.g || 'acess']);
  }
  db.maxDay = dia(FIM);
  db.minDay = minDay != null ? dia(minDay) : Math.min(dia(FIM) - 100, ...db.day);
  TS.db = db;
  TS.rules = { ids: { eg: new Set([1]), chaTotal: new Set([GRP.cha]) } };
  TS.classeOficial = () => ({ get: (cod) => (classes[cod] ? { classe: classes[cod], fixa: false } : undefined), meses: 6 });
  const M = {
    ded: null,
    taxa: (i) => !!vendas[i].taxa,
    casar: () => null,
    custo: (i) => (vendas[i].custo === undefined ? null : vendas[i].custo),
    custoHoje: (i) => (vendas[i].custoHoje === undefined ? null : vendas[i].custoHoje),
    consumo: (i) => (vendas[i].cons || []).map(([cod, q]) => [itens.get(String(cod)) || { cod: String(cod), un: 'UN' }, q]),
    porCod: itens,
  };
  return M;
}
const PCFG = { dias: 14, folgaPct: 10, cmvPct: null, crescimentoPct: null, proporcao: null };
const ECFG = { entregaDias: 7 };
/** roda a conta: calcular(M, estoque, ecfg, catalogo, pcfg, modo, ev, editados, ccfg, obrig, espera) */
function calc(M, estoque, { pcfg = {}, catalogo = null, modo = 'reposicao', ev = null, obrig = null, espera = {}, val = new Map() } = {}) {
  TS.__ped.setVal(val);
  return TS.__ped.calcular(M, { itens: estoque }, ECFG, catalogo, { ...PCFG, ...pcfg }, modo, ev, null, {}, obrig, espera);
}
const linha = (R, cod) => R.linhas.find((r) => String(r.cod) === String(cod) && !r.obrig);
/** n vendas de 1 unidade (ou q) do produto, espalhadas nos últimos `dias` dias, sem valor (só consumo) */
const consumo = (cod, n, { q = 1, g = 'acess', dias = 25, vt = 0, extra = [] } = {}) =>
  Array.from({ length: n }, (_, k) => ({ d: antes(k % dias), vt, g, cons: [[cod, q], ...extra] }));

// ======================================= EST-50: valor do pedido =======================================
const VENDAS_CMV = [
  { d: '2026-10-10', vt: 1000, custoHoje: 400, custo: 999 },       // conta: custo de HOJE (o de repor), não o da data
  { d: '2026-09-10', vt: 1000, custoHoje: 200 },                    // conta
  { d: '2026-08-10', vt: 500, custoHoje: null },                    // sem custo: fora do numerador e do denominador
  { d: '2026-10-11', vt: 5000, custoHoje: 100, eg: true },          // Espaço Gourmet: fora
  { d: '2026-10-12', vt: 300, custoHoje: 0, taxa: true },           // taxa: fora
  { d: '2026-11-05', vt: 700, custoHoje: 700 },                     // mês em andamento: fora do CMV (e fora dos 14 dias)
  { d: '2026-07-10', vt: 1000, custoHoje: 1000 },                   // 4 meses atrás: fora dos 3 meses fechados
  { d: '2026-11-10', vt: 2000 },                                    // vendas dos últimos 14 dias (só loja)
  { d: '2026-11-12', vt: 999, eg: true },                           // EG nos 14 dias: fora
  { d: '2026-11-15', vt: 50, taxa: true },                          // taxa nos 14 dias: fora
];

test('EST-50: valor do pedido = vendas da loja nos últimos N dias × CMV real dos 3 meses fechados (custo de hoje, sem EG nem taxa)', () => {
  const R = calc(cenario(VENDAS_CMV, []), []);
  assert.deepStrictEqual(js(R.cmvMeses), ['2026-08', '2026-09', '2026-10'], 'os 3 meses fechados antes do mês do último dia');
  assert.strictEqual(R.cmvVt, 2000, 'faturamento só das linhas da loja com custo, nos 3 meses');
  assert.strictEqual(R.cmvCusto, 600, 'custo de hoje (400 + 200), não o da data da venda (999)');
  assert.strictEqual(R.cmvReal, 0.3);
  assert.strictEqual(R.pct, 0.3, 'sem % configurado vale o CMV real');
  assert.strictEqual(R.vendasN, 2000, 'só a loja, sem Espaço Gourmet nem taxa, nos últimos 14 dias');
  assert.strictEqual(R.orcamento, 600);
});

test('EST-50: % configurado vale acima do CMV real; o nº de dias muda a base; sem CMV nem % não há limite', () => {
  const M = cenario(VENDAS_CMV, []);
  const R = calc(M, [], { pcfg: { cmvPct: 25 } });
  assert.strictEqual(R.cmvReal, 0.3, 'o CMV real continua calculado (para a referência)');
  assert.strictEqual(R.pct, 0.25);
  assert.strictEqual(R.orcamento, 500);
  // 7 dias: a venda de 10/11 sai da base (fica antes de 14/11)
  assert.strictEqual(calc(M, [], { pcfg: { dias: 7 } }).vendasN, 0);
  // sem nenhuma venda com custo e sem % → sem limite: tudo que precisa entra completo
  const est = [{ cod: 'A1', desc: 'Bule', un: 'UN', custo: 10, qtd: 0 }];
  const R2 = calc(cenario([...consumo('A1', 30), { d: antes(2), vt: 1000 }], est), est);
  assert.strictEqual(R2.cmvReal, null);
  assert.strictEqual(R2.orcamento, null);
  assert.strictEqual(linha(R2, 'A1').pedir, linha(R2, 'A1').sugerido);
  assert.strictEqual(linha(R2, 'A1').motivo, 'completo');
});

test('EST-50: data comemorativa não tem limite de valor (o pedido é o que o evento precisa)', () => {
  const R = calc(cenario(VENDAS_CMV, []), [], { modo: 'evento', ev: { id: 'natal', nome: 'Natal', de: '12-01', ate: '12-24' } });
  assert.strictEqual(R.orcamento, null);
});

// ======================================= EST-52: prioridades =======================================
test('EST-52: chá a granel abaixo de 500 g (2), Estrela abaixo de 700 g (1) e cliente na lista de espera com estoque zerado (3)', () => {
  const est = [
    { cod: '1', desc: 'Chá A', un: 'Kg', custo: 100, qtd: 0.3 },
    { cod: '2', desc: 'Chá B (Estrela)', un: 'Kg', custo: 100, qtd: 0.6 },
    { cod: '3', desc: 'Chá C', un: 'Kg', custo: 100, qtd: 0.6 },
    { cod: '4', desc: 'Bule esperado', un: 'UN', custo: 50, qtd: 0 },
    { cod: '5', desc: 'Chá parado', un: 'Kg', custo: 100, qtd: 0.2 },
    { cod: '6', desc: 'Chá F (vem no obrigatório)', un: 'Kg', custo: 100, qtd: 0.3 },
    { cod: '7', desc: 'Caneca esperada com estoque', un: 'UN', custo: 20, qtd: 2 },
  ];
  const vendas = [...consumo('1', 30, { q: 0.1, g: 'cha' }), ...consumo('2', 30, { q: 0.1, g: 'cha' }), ...consumo('3', 30, { q: 0.1, g: 'cha' }),
    ...consumo('6', 30, { q: 0.1, g: 'cha' }), ...consumo('7', 3)];
  const obrig = { lista: [{ ativo: true, nome: 'Lançamento', itens: [{ cod: '6', qtd: 1, preco: 100 }] }] };
  const espera = { 4: { pedidos: 2, clientes: ['ANA', 'BIA'] }, 7: { pedidos: 1, clientes: ['CAIO'] } };
  const R = calc(cenario(vendas, est, { classes: { 2: 'estrela', 3: 'joia' } }), est, { obrig, espera });
  assert.strictEqual(linha(R, '1').prior, 2);
  assert.match(linha(R, '1').conta, /Prioridade: estoque abaixo de 500 g\./);
  assert.strictEqual(linha(R, '2').prior, 1);
  assert.match(linha(R, '2').conta, /Prioridade: Estrela com estoque abaixo de 700 g\./);
  assert.strictEqual(linha(R, '3').prior, 0, '600 g sem ser Estrela não é prioridade');
  assert.strictEqual(linha(R, '4').prior, 3, 'cliente esperando e estoque zerado: na frente de tudo');
  assert.strictEqual(linha(R, '4').sugerido, 1, 'entra mesmo sem venda recente (1 unidade)');
  assert.match(linha(R, '4').conta, /2 clientes esperando na lista de espera/);
  assert.strictEqual(linha(R, '5'), undefined, 'chá que não vendeu em 90 dias não vira prioridade (nem entra)');
  assert.strictEqual(linha(R, '6').prior, 0, 'o que vem no pedido obrigatório conta como estoque chegando (0,3 + 1 kg)');
  assert.strictEqual(linha(R, '6').chega, 1);
  assert.strictEqual(linha(R, '7').prior, 0, 'lista de espera com estoque na loja não é prioridade');
  // chá a granel só em quilo inteiro
  for (const c of ['1', '2', '3']) assert.strictEqual(linha(R, c).sugerido % 1, 0, `chá ${c} em quilo inteiro`);
});

test('EST-52: com o valor curto, a prioridade decide quem entra (prioridade > urgência > lucro sem fixos por dia)', () => {
  const est = [
    { cod: '1', desc: 'Chá A < 500 g', un: 'Kg', custo: 100, qtd: 0.3 },
    { cod: '2', desc: 'Chá B Estrela < 700 g', un: 'Kg', custo: 100, qtd: 0.6 },
    { cod: '3', desc: 'Chá C', un: 'Kg', custo: 100, qtd: 0.6 },
  ];
  const vendas = [...consumo('3', 30, { q: 0.1, g: 'cha' }), ...consumo('2', 30, { q: 0.1, g: 'cha' }), ...consumo('1', 30, { q: 0.1, g: 'cha' }),
    { d: antes(1), vt: 1000, g: 'cha' }];
  // 40% de R$ 1.000 = R$ 400: cabem 2 kg de dois chás (R$ 200 cada); o terceiro fica de fora
  const R = calc(cenario(vendas, est, { classes: { 2: 'estrela' } }), est, { pcfg: { cmvPct: 40, folgaPct: 0, proporcao: { cha: 100, env: 0, acess: 0 } } });
  assert.strictEqual(R.orcamento, 400);
  assert.deepStrictEqual(['1', '2', '3'].map((c) => linha(R, c).sugerido), [2, 2, 2]);
  assert.deepStrictEqual(['1', '2', '3'].map((c) => [linha(R, c).pedir, linha(R, c).motivo]), [[2, 'completo'], [2, 'completo'], [0, 'fora do valor']]);

  // mesma prioridade e sem urgência: vai primeiro quem deixa mais lucro sem fixos por dia (venda − custo, 30 dias)
  const est2 = [{ cod: 'X', desc: 'Bule X', un: 'UN', custo: 10, qtd: 100 }, { cod: 'Y', desc: 'Bule Y', un: 'UN', custo: 10, qtd: 100 }];
  const v2 = [];
  for (let k = 0; k < 30; k++) { v2.push({ d: antes(k), vt: 300, custo: 250, cons: [['Y', 10]] }); v2.push({ d: antes(k), vt: 300, custo: 50, cons: [['X', 10]] }); }
  // previsão 10/dia × 21 dias − 100 = 110 un de cada (R$ 1.100); 20% de R$ 8.400 (14 dias × 600) = R$ 1.680: um completo e o resto no outro
  const R2 = calc(cenario(v2, est2), est2, { pcfg: { cmvPct: 20, folgaPct: 0 } });
  assert.strictEqual(R2.orcamento, 1680);
  assert.ok(linha(R2, 'X').lucroDia > linha(R2, 'Y').lucroDia);
  assert.deepStrictEqual([linha(R2, 'X').pedir, linha(R2, 'X').motivo], [110, 'completo'], 'o de mais lucro vem primeiro');
  assert.deepStrictEqual([linha(R2, 'Y').pedir, linha(R2, 'Y').motivo], [58, 'parcial']);
});

// ======================================= EST-53: divisão entre grupos =======================================
const EST_G = [
  { cod: 'C1', desc: 'Chá granel', un: 'Kg', custo: 60, qtd: 0 },
  { cod: 'A1', desc: 'Bule', un: 'UN', custo: 20, qtd: 0 },
];
/** 60 kg e 60 un vendidos nos últimos 30 dias (fora da base de 14 dias) + faturamento dos 14 dias: chá 600, acessórios 400 */
const VENDAS_G = [
  ...Array.from({ length: 30 }, (_, k) => ({ d: antes(15 + (k % 14)), vt: 0, g: 'cha', cons: [['C1', 2]] })),
  ...Array.from({ length: 30 }, (_, k) => ({ d: antes(15 + (k % 14)), vt: 0, g: 'acess', cons: [['A1', 2]] })),
  { d: antes(2), vt: 600, g: 'cha' }, { d: antes(3), vt: 400, g: 'acess' },
];

test('EST-53: pela proporção das vendas — cada grupo até a sua parte (+ folga) e o último fica com o que sobra do valor', () => {
  const R = calc(cenario(VENDAS_G, EST_G), EST_G, { pcfg: { cmvPct: 100 } });
  assert.strictEqual(R.orcamento, 1000);
  assert.deepStrictEqual(js(R.shareVendas), { cha: 0.6, env: 0, acess: 0.4 });
  assert.strictEqual(R.propManual, false);
  // chá: até 60% × 1,10 = R$ 660 → 11 kg a R$ 60; acessórios: o que sobra do valor (R$ 340) → 17 un a R$ 20
  assert.deepStrictEqual([linha(R, 'C1').sugerido, linha(R, 'C1').pedir, linha(R, 'C1').motivo], [42, 11, 'parcial']);
  assert.deepStrictEqual([linha(R, 'A1').sugerido, linha(R, 'A1').pedir, linha(R, 'A1').motivo], [42, 17, 'parcial']);
  const total = R.linhas.reduce((s, r) => s + r.pedir * (r.preco || 0), 0);
  assert.ok(total <= R.orcamento + 0.01, `o pedido (${total}) não passa do valor`);
});

test('EST-53: 2ª passada — o que um grupo não usa vai para quem ainda precisa', () => {
  const est = [{ ...EST_G[0] }, { ...EST_G[1], qtd: 37 }]; // acessórios: precisa só de 42 − 37 = 5 un (R$ 100)
  const R = calc(cenario(VENDAS_G, est), est, { pcfg: { cmvPct: 100, folgaPct: 0 } });
  assert.deepStrictEqual([linha(R, 'A1').pedir, linha(R, 'A1').motivo], [5, 'completo']);
  // chá: 600 na 1ª passada + os 300 que os acessórios não usaram
  assert.strictEqual(linha(R, 'C1').pedir, 15);
});

test('EST-53: proporção definida à mão — grupo com 0% não entra, nem com sobra no valor', () => {
  const R = calc(cenario(VENDAS_G, EST_G), EST_G, { pcfg: { cmvPct: 100, proporcao: { cha: 0, env: 0, acess: 100 } } });
  assert.strictEqual(R.propManual, true);
  assert.deepStrictEqual(js(R.share), { cha: 0, env: 0, acess: 1 });
  assert.deepStrictEqual([linha(R, 'A1').pedir, linha(R, 'A1').motivo], [42, 'completo']);
  assert.deepStrictEqual([linha(R, 'C1').pedir, linha(R, 'C1').motivo], [0, 'fora do valor'], 'sobram R$ 160, mas chá está em 0%');
});

test('EST-53: embalagens entram primeiro, fora da proporção; o pedido obrigatório ocupa a parte do grupo dele e não vai ao carrinho', () => {
  const est = [...EST_G.map((x) => ({ ...x })), { cod: 'E1', desc: 'Saco kraft', un: 'UN', custo: 10, qtd: 0 }, { cod: 'O1', desc: 'Mug lançamento', un: 'UN', tipo: 'PN', custo: 50, qtd: 0 }];
  // cada venda de chá leva um saco (2º componente do consumo → embalagem): 30 sacos em 30 dias → 1/dia × 21 = 21 un = R$ 210
  const vendas = VENDAS_G.map((v) => (v.cons && v.cons[0][0] === 'C1' ? { ...v, cons: [...v.cons, ['E1', 1]] } : v));
  const obrig = { lista: [{ ativo: true, nome: 'Obrigatório de Natal', itens: [{ cod: 'O1', qtd: 4, preco: 50 }] }, { ativo: false, nome: 'Encerrado', itens: [{ cod: 'A1', qtd: 99, preco: 1 }] }] };
  const R = calc(cenario(vendas, est), est, { pcfg: { cmvPct: 100, folgaPct: 0 }, obrig });
  const e1 = linha(R, 'E1');
  assert.strictEqual(e1.grupo, 'insumo');
  assert.deepStrictEqual([e1.pedir, e1.motivo], [21, 'completo']);
  const ob = R.linhas.find((r) => r.obrig);
  assert.deepStrictEqual([ob.cod, ob.grupo, ob.pedir, ob.site], ['O1', 'acess', 4, 'obrig'], 'obrigatório: travado, não vai ao carrinho');
  assert.strictEqual(R.obTotal, 200, 'só o obrigatório ativo entra no valor');
  // resto = 1000 − 210 (sacos) = 790; chá 60% = 474 → 7 kg (420); acessórios 40% = 316 − 200 do obrigatório = 116 → 5 un (100)
  assert.strictEqual(linha(R, 'C1').pedir, 7 + Math.floor((790 - 420 - 200 - 100) / 60), 'chá: 7 kg na 1ª passada + a sobra na 2ª');
  assert.strictEqual(linha(R, 'A1').pedir, 5 + Math.floor((790 - 420 - 200 - 100 - 60) / 20));
  const carrinho = R.linhas.filter((r) => !r.obrig).reduce((s, r) => s + r.pedir * (r.preco || 0), 0);
  assert.ok(carrinho + R.obTotal <= R.orcamento + 0.01, 'carrinho + obrigatório cabem no valor');
});

// ======================================= EST-54: data comemorativa =======================================
const EVENTOS = require('../../src/pedido').EVENTOS;
const nomeEv = (iso) => TS.pedidoCalc.eventoPadrao(EVENTOS, dia(iso)).nome;
const janelaIso = (j) => [...j].map((d) => TS.dayToIso(d));

test('EST-54: sem escolha, abre na PRÓXIMA data comemorativa (nunca na primeira da lista)', () => {
  assert.strictEqual(nomeEv('2026-11-27'), 'Natal', 'em novembro abre o Natal, não o Dia das Mães');
  assert.strictEqual(nomeEv('2026-12-24'), 'Natal', 'no último dia o Natal ainda vale');
  assert.strictEqual(nomeEv('2026-12-25'), 'Férias de janeiro');
  assert.strictEqual(nomeEv('2027-02-01'), 'Dia das Mães');
  assert.strictEqual(nomeEv('2027-05-20'), 'Férias de julho');
  assert.strictEqual(nomeEv('2027-08-01'), 'Natal');
  assert.strictEqual(TS.pedidoCalc.eventoPadrao([], dia('2026-11-27')), null);
});

test('EST-54: janela da data — Dia das Mães = 2º domingo de maio menos os dias antes; a do ano anterior para comparar', () => {
  const maes = EVENTOS.find((e) => e.regra === 'maes');
  const p = TS.pedidoCalc.proximo(maes, dia('2026-11-27'));
  assert.deepStrictEqual(janelaIso(p.atual), ['2027-04-25', '2027-05-09']);
  assert.deepStrictEqual(janelaIso(p.anterior), ['2026-04-26', '2026-05-10']);
  const natal = EVENTOS.find((e) => e.id === 'natal');
  assert.deepStrictEqual(janelaIso(TS.pedidoCalc.proximo(natal, dia('2026-12-10')).atual), ['2026-12-01', '2026-12-24'], 'durante a data vale a deste ano');
  assert.deepStrictEqual(janelaIso(TS.pedidoCalc.proximo(natal, dia('2026-12-10')).anterior), ['2025-12-01', '2025-12-24']);
});

test('EST-54: data que vira o ano (ex.: 20/12 a 10/01) — em janeiro, a data em andamento é a que começou em dezembro', () => {
    const verao = { id: 'verao', nome: 'Verão', de: '12-20', ate: '01-10' };
    const p = TS.pedidoCalc.proximo(verao, dia('2027-01-05'));
    assert.deepStrictEqual(janelaIso(p.atual), ['2026-12-20', '2027-01-10']);
    assert.deepStrictEqual(janelaIso(p.anterior), ['2025-12-20', '2026-01-10']);
  });

test('EST-54: pedido do evento = vendido na mesma data do ano passado × crescimento + consumo até lá − estoque', () => {
  const est = [{ cod: 'N1', desc: 'Lata de Natal', un: 'UN', custo: 30, qtd: 5 }, { cod: 'N2', desc: 'Bule sem Natal', un: 'UN', custo: 30, qtd: 0 }];
  const vendas = [
    { d: '2025-12-10', vt: 300, cons: [['N1', 10]] },            // Natal do ano passado: 10 un
    { d: '2025-11-30', vt: 999, cons: [['N1', 50]] },            // um dia antes da janela: não conta
    ...consumo('N1', 30), ...consumo('N2', 30),                   // 1 un/dia de cada nos últimos 30 dias
  ];
  const natal = EVENTOS.find((e) => e.id === 'natal');
  const R = calc(cenario(vendas, est), est, { modo: 'evento', ev: natal, pcfg: { crescimentoPct: 10 } });
  const n1 = linha(R, 'N1');
  // 10 × 1,10 = 11; até começar (01/12) faltam 10 dias × 1/dia = 10; − 5 em estoque = 16
  assert.strictEqual(n1.precisa, 16);
  assert.deepStrictEqual([n1.sugerido, n1.pedir], [16, 16]);
  assert.match(n1.conta, /No Natal do ano passado: 10 un × crescimento 1,10/);
  assert.strictEqual(linha(R, 'N2'), undefined, 'o que não vendeu na data do ano passado não entra no pedido do evento');
  assert.strictEqual(R.evLyVt, 300, 'faturamento da loja na data do ano passado');
  // data longe: o consumo até lá para em entrega + intervalo (7 + 14 = 21 dias); o resto as reposições cobrem
  const maes = EVENTOS.find((e) => e.regra === 'maes');
  const vMaes = [{ d: '2026-05-01', vt: 100, cons: [['N1', 10]] }, ...consumo('N1', 30)];
  const RM = calc(cenario(vMaes, est), est, { modo: 'evento', ev: maes, pcfg: { crescimentoPct: 0 } });
  assert.strictEqual(linha(RM, 'N1').precisa, 10 + 21 - 5);
});

test('EST-54: crescimento da loja = últimas 8 semanas × as mesmas do ano passado, entre 0,5 e 2', () => {
  const est = [{ cod: 'N1', desc: 'Lata', un: 'UN', custo: 30, qtd: 0 }];
  const base = [{ d: '2025-12-10', vt: 0, cons: [['N1', 10]] }];
  const cresc = (agora, anoPassado) => calc(cenario([...base, { d: antes(10), vt: agora }, { d: TS.dayToIso(dia(FIM) - 364 - 10), vt: anoPassado }], est), est,
    { modo: 'evento', ev: EVENTOS.find((e) => e.id === 'natal') });
  assert.strictEqual(cresc(1200, 1000).cresc, 1.2);
  assert.strictEqual(cresc(5000, 1000).cresc, 2, 'teto 2×');
  assert.strictEqual(cresc(100, 1000).cresc, 0.5, 'piso 0,5×');
  assert.strictEqual(cresc(100, 0).cresc, 1, 'sem ano passado: 1');
});

// ======================================= EST-59: aviso de validade =======================================
test('EST-59: lote perto de vencer aparece na conta do produto ("venda antes de comprar mais"), sem mudar a quantidade sugerida', () => {
  const est = [{ cod: '1', desc: 'Chá A', un: 'Kg', custo: 100, qtd: 0.3 }, { cod: '2', desc: 'Chá B', un: 'Kg', custo: 100, qtd: 0.3 }];
  const vendas = [...consumo('1', 30, { q: 0.1, g: 'cha' }), ...consumo('2', 30, { q: 0.1, g: 'cha' })];
  const M = cenario(vendas, est);
  const sem = calc(M, est);
  const com = calc(M, est, { val: new Map([['1', { dias: 20, faixa: 'f30', kg: 0.8 }], ['2', { dias: -3, faixa: 'vencido', kg: 0.25 }]]) });
  assert.match(linha(com, '1').conta, /Atenção: 0,800 kg deste chá vencem em 20 dias: venda antes de comprar mais\./);
  assert.match(linha(com, '2').conta, /Atenção: 0,250 kg deste chá estão em lote já vencido/);
  assert.doesNotMatch(linha(sem, '1').conta, /Atenção/);
  for (const c of ['1', '2']) assert.strictEqual(linha(com, c).sugerido, linha(sem, c).sugerido, 'só avisa; a conta da quantidade não muda');
});
