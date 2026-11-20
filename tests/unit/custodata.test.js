'use strict';
// Custo na data da venda (public/js/custodata.js): a conta única de Preços e do motor de custos (Resultado, Rentabilidade)
const { test } = require('node:test');
const assert = require('node:assert');
const CD = require('../../public/js/custodata');

const d = CD.paraDia;
// produto 100: custava R$ 10 em junho, a nota de 10/08 trouxe R$ 11 e a planilha de 01/09 mostrou R$ 12 (o custo de hoje)
const H = { 100: [['2026-06-01', 10], ['2026-09-01', 12]] };
const N = { 100: [['2026-08-10', 11, 5501, 5, 'TSB FRANQUIAS']] };

test('CUSTO-01 custo na data: a venda de julho usa R$ 10 (antes: o custo de hoje, R$ 12)', () => {
  const c = CD.montar(H, N);
  // venda de 15/07 a R$ 20: margem de 50% com o custo da data; com o custo de hoje (R$ 12) aparecia 40%
  assert.deepStrictEqual(c.custoNaData('100', d('2026-07-15'), 12), { v: 10, est: false });
  assert.deepStrictEqual(c.custoNaData(100, d('2026-08-09'), 12), { v: 10, est: false });
  assert.deepStrictEqual(c.custoNaData('100', d('2026-08-10'), 12), { v: 11, est: false }); // no dia da nota já vale a nota
  assert.deepStrictEqual(c.custoNaData('100', d('2026-08-31'), 12), { v: 11, est: false });
  assert.deepStrictEqual(c.custoNaData('100', d('2026-11-20'), 12), { v: 12, est: false });
  assert.deepStrictEqual(c.custoEm({ cod: 100, custo: 12 }, d('2026-07-15')), { v: 10, est: false });
  assert.strictEqual(c.inicio, d('2026-06-01'));
});

test('CUSTO-02 sem histórico antes da data: o custo mais antigo conhecido, marcado como estimado', () => {
  const c = CD.montar(H, N);
  assert.deepStrictEqual(c.custoNaData('100', d('2026-03-10'), 12), { v: 10, est: true });
  // produto sem histórico nenhum: o custo de hoje, estimado; sem custo de hoje: null
  assert.deepStrictEqual(c.custoNaData('999', d('2026-03-10'), 7.5), { v: 7.5, est: true });
  assert.deepStrictEqual(c.custoNaData('999', d('2026-03-10'), 0), { v: null, est: true });
  assert.strictEqual(CD.montar(null, null).inicio, Infinity);
});

test('CUSTO-03 como os pontos se juntam: na mesma data vale a nota; foto do estoque com menos de 1% de diferença não vira ponto', () => {
  const c = CD.montar(
    { 7: [['2026-05-01', 20], ['2026-06-01', 20.1], ['2026-07-01', 25], ['2026-08-01', 30], ['data-ruim', 99], ['2026-09-01', 0]] },
    { 7: [['2026-07-01', 24, 81, 2, 'F'], ['2026-08-15', 30.2, 82, 1, 'F']] });
  assert.deepStrictEqual(c.hist.get('7').map(([dia, v]) => [dia, v]), [[d('2026-05-01'), 20], [d('2026-07-01'), 24], [d('2026-08-01'), 30], [d('2026-08-15'), 30.2]]);
  assert.strictEqual(c.custoNaData('7', d('2026-06-15'), 30).v, 20); // a foto de 20,10 (0,5%) não virou ponto
  assert.strictEqual(c.custoNaData('7', d('2026-07-01'), 30).v, 24); // nota e foto no mesmo dia: vale a nota
  assert.strictEqual(c.origemEm({ cod: 7 }, d('2026-07-10')).nf, 81);
  assert.strictEqual(c.origemEm({ cod: 7 }, d('2026-08-05')), null); // o custo desse dia veio da foto do estoque
  assert.strictEqual(c.origemEm({ cod: 7 }, d('2026-04-01')), null);
});
