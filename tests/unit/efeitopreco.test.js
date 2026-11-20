'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const EF = require('../../public/js/efeitopreco');

// vendas constantes por dia: antes do dia D e a partir dele
const cenario = ({ D = 1000, qA = 2, qB = 2, pA = 10, pB = 12, custo = 4, lojaA = 1000, lojaB = 1000, inicio = 0, hoje = 2000 }) => ({
  serie: (a, b) => { let q = 0, v = 0, l = 0; for (let d = a; d <= b; d++) { const qq = d < D ? qA : qB, p = d < D ? pA : pB; q += qq; v += qq * p; l += custo == null ? 0 : qq * (p - custo); } return { q, v, l: custo == null ? null : l }; },
  loja: (a, b) => { let t = 0; for (let d = a; d <= b; d++) t += d < D ? lojaA : lojaB; return t; },
  inicio, hoje,
});
const perto = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('PRC-EF-01 30 dias antes × 30 depois, por dia: preço subiu, vendeu igual → lucro subiu (bom)', () => {
  const r = EF.avaliar({ dia: 1000, ant: null, prox: null }, cenario({}));
  assert.equal(r.dAntes, 30); assert.equal(r.dDepois, 30);
  assert.equal(r.antes.q, 2); assert.equal(r.depois.v, 24);
  perto(r.varQ, 0); perto(r.varV, 0.2); perto(r.varL, 16 / 12 - 1);
  perto(r.varLoja, 0); perto(r.adjL, r.varL);
  assert.equal(r.estado, 'bom'); assert.equal(r.parcial, false);
});

test('PRC-EF-02 preço subiu e a venda caiu demais → lucro caiu (ruim); quase igual → igual', () => {
  const r = EF.avaliar({ dia: 1000 }, cenario({ qB: 1 }));
  perto(r.varQ, -0.5); perto(r.varL, 8 / 12 - 1);
  assert.equal(r.estado, 'ruim');
  assert.equal(EF.avaliar({ dia: 1000 }, cenario({ pB: 10.05 })).estado, 'igual'); // lucro +0,8%
  // faixa de ±5%: lucro +4% (antes era "bom" com a faixa de 2%) agora é igual; +6% é bom; −6% é ruim
  assert.equal(EF.avaliar({ dia: 1000 }, cenario({ pB: 10.24 })).estado, 'igual');
  assert.equal(EF.avaliar({ dia: 1000 }, cenario({ pB: 10.36 })).estado, 'bom');
  assert.equal(EF.avaliar({ dia: 1000 }, cenario({ pB: 9.64 })).estado, 'ruim');
});

test('PRC-EF-03 desconta o movimento da loja: lucro subiu 10% mas a loja subiu 25% → ruim', () => {
  const r = EF.avaliar({ dia: 1000 }, cenario({ pB: 10.6, lojaB: 1250 }));
  perto(r.varL, 0.1); perto(r.varLoja, 0.25); perto(r.adjL, 1.1 / 1.25 - 1); perto(r.adjQ, 1 / 1.25 - 1);
  assert.equal(r.estado, 'ruim');
  // e o contrário: caiu 10% com a loja caindo 30% → bom
  const s = EF.avaliar({ dia: 1000 }, cenario({ pB: 9.4, lojaB: 700 }));
  perto(s.varL, -0.1); assert.equal(s.estado, 'bom');
});

test('PRC-EF-04 cedo demais: menos de 30 dias depois mostra prévia; menos de 7, nenhum número', () => {
  const r = EF.avaliar({ dia: 1000 }, cenario({ hoje: 1014 }));
  assert.equal(r.estado, 'cedo'); assert.equal(r.parcial, true); assert.equal(r.dDepois, 15); assert.equal(r.tendencia, 'bom');
  perto(r.depois.q, 2); // por dia: não encolhe por ter menos dias
  const s = EF.avaliar({ dia: 1000 }, cenario({ hoje: 1003 }));
  assert.equal(s.estado, 'cedo'); assert.equal(s.antes, null); assert.equal(s.varL, null); assert.match(s.motivo, /só 4 dias/);
  assert.equal(EF.avaliar({ dia: 1000 }, cenario({ hoje: 1029 })).estado, 'bom'); // 30 dias completos
});

test('PRC-EF-05 sem base não inventa: pouco histórico, não vendia antes, pouca venda, sem custo, outro reajuste colado', () => {
  let r = EF.avaliar({ dia: 1000 }, cenario({ inicio: 995 }));
  assert.equal(r.estado, 'sem'); assert.equal(r.antes, null); assert.match(r.motivo, /só 5 dias de vendas antes/);
  r = EF.avaliar({ dia: 1000 }, cenario({ qA: 0 }));
  assert.equal(r.estado, 'sem'); assert.equal(r.varQ, null); assert.match(r.motivo, /não vendeu/);
  r = EF.avaliar({ dia: 1000 }, cenario({ qA: 0.1, qB: 0.1 })); // 6 unidades em 60 dias
  assert.equal(r.estado, 'pouco'); assert.match(r.motivo, /vendeu só 6 un.*mínimo 30/);
  r = EF.avaliar({ dia: 1000 }, cenario({ custo: null }));
  assert.equal(r.estado, 'sem'); assert.equal(r.varL, null); perto(r.varV, 0.2); assert.match(r.motivo, /sem custo/);
  r = EF.avaliar({ dia: 1000, prox: 1005 }, cenario({}));
  assert.equal(r.estado, 'sem'); assert.match(r.motivo, /mudou de novo 5 dias depois/);
  r = EF.avaliar({ dia: 1000, ant: 990 }, cenario({}));
  assert.equal(r.estado, 'sem'); assert.match(r.motivo, /outro reajuste só 10 dias antes/);
  // outro reajuste 20 dias depois: compara só os 20 dias e avisa
  r = EF.avaliar({ dia: 1000, prox: 1020 }, cenario({}));
  assert.equal(r.estado, 'bom'); assert.equal(r.dDepois, 20); assert.match(r.motivo, /comparou 20 dias/);
  // lucro antes negativo: sem %, decide pela diferença em R$
  r = EF.avaliar({ dia: 1000 }, cenario({ pA: 3, pB: 6 }));
  assert.equal(r.varL, null); assert.equal(r.estado, 'bom');
});

test('PRC-EF-06 de onde vêm os reajustes: cadastro; caixa só antes do histórico do cadastro (ou sem cadastro)', () => {
  const caixa = [{ dia: 100, de: 10, v: 11 }, { dia: 300, de: 11, v: 12 }, { dia: null, de: 1, v: 2 }];
  // sem cadastro: todos os do caixa, com anterior e próximo
  let l = EF.reajustesDe(null, caixa, -Infinity);
  assert.deepEqual(l.map((e) => [e.dia, e.fonte, e.ant, e.prox]), [[100, 'caixa', null, 300], [300, 'caixa', 100, null]]);
  perto(l[0].variacao, 0.1);
  // com cadastro desde o dia 200: o do caixa no dia 300 sai (vale o cadastro), o do dia 100 fica
  l = EF.reajustesDe([[200, 11], [310, 12.5], [320, 12.5]], caixa, 200);
  assert.deepEqual(l.map((e) => [e.dia, e.fonte, e.de, e.para]), [[100, 'caixa', 10, 11], [310, 'cadastro', 11, 12.5]]);
  assert.deepEqual(EF.reajustesDe([[200, 11]], [], 200), []);
});

test('PRC-EF-07 amostra mínima: menos de 30 unidades nos dois períodos = "poucos dados", nunca Bom/Ruim/Igual', () => {
  assert.equal(EF.MIN_VENDAS, 30); assert.equal(EF.FAIXA, 0.05);
  // 12 un. antes + 12 depois = 24 (antes da mudança, com o mínimo de 10, isto saía "bom" com lucro +33%)
  let r = EF.avaliar({ dia: 1000 }, cenario({ qA: 0.4, qB: 0.4 }));
  assert.equal(r.estado, 'pouco'); assert.equal(r.poucas, true); perto(r.varL, 16 / 12 - 1); // os números continuam à mostra
  assert.match(r.motivo, /vendeu só 24 un/);
  // 24 un. com lucro praticamente igual: também "poucos dados" (não "igual")
  assert.equal(EF.avaliar({ dia: 1000 }, cenario({ qA: 0.4, qB: 0.4, pB: 10.05 })).estado, 'pouco');
  // exatamente 30 un. (15 + 15): já dá veredito
  r = EF.avaliar({ dia: 1000 }, cenario({ qA: 0.5, qB: 0.5 }));
  assert.equal(r.estado, 'bom'); assert.equal(r.poucas, false);
  // cedo demais continua "cedo" (sem tendência quando a venda é pouca)
  r = EF.avaliar({ dia: 1000 }, cenario({ qA: 0.4, qB: 0.4, hoje: 1014 }));
  assert.equal(r.estado, 'cedo'); assert.equal(r.tendencia, null);
});
