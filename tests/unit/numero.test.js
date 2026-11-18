'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { valorBR } = require('../../src/numero');
const T = require('../../src/transform');

test('valores em reais: todos os formatos dos relatórios, nunca NaN', () => {
  const casos = [
    ['R$ 1.234,56', 1234.56], ['R$ 1.234,56', 1234.56], [' 12,50', 12.5], ['1.234,56 ', 1234.56], [' R$ 0,99', 0.99],
    ['R$ -5,00', -5], ['-R$ 5,00', -5], ['(5,00)', -5], ['(R$ 1.234,56)', -1234.56], ['5,00-', -5], ['+12,50', 12.5],
    ['R$ 1.234', 1234], ['R$ 12.500', 12500], ['1.234.567', 1234567], ['1.234.567,89', 1234567.89],
    ['12.5', 12.5], ['1.500', 1.5], ['0.500', 0.5], ['42', 42], [42.7, 42.7], [{ result: 7 }, 7], [{ richText: [{ text: 'R$ 3,' }, { text: '50' }] }, 3.5],
    ['', null], [null, null], ['—', null], ['-', null], ['abc', null], ['1,2,3', null], ['1,234.56', null], ['1.2.3', null], [NaN, null], [Infinity, null],
  ];
  for (const [v, esp] of casos) assert.strictEqual(valorBR(v), esp, JSON.stringify(v));
  // a leitura das vendas usa a mesma regra
  assert.strictEqual(T.toNumber('(R$ 10,00)'), -10);
});
