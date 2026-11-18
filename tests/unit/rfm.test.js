'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const I = require('../../src/indicadores');

test('retenção em 90 dias: clientes novos que voltaram (precisa de 20 ou mais)', () => {
  const v = [], x = []; let c = 1;
  for (let k = 0; k < 30; k++) {
    v.push({ cupom: c, data: '2026-03-01' }); x.push({ cpf: 'c' + k, cupom: c++ });
    if (k < 12) { v.push({ cupom: c, data: '2026-04-10' }); x.push({ cpf: 'c' + k, cupom: c++ }); }
    if (k >= 25) { v.push({ cupom: c, data: '2026-08-10' }); x.push({ cpf: 'c' + k, cupom: c++ }); } // voltou depois de 90 dias: não conta
  }
  assert.strictEqual(I.retencao90(v, x, '2026-11-18'), 12 / 30);
  assert.strictEqual(I.retencao90(v.slice(0, 10), x.slice(0, 10), '2026-11-18'), null);
  assert.strictEqual(I.retencao90(v, [], '2026-11-18'), null);
});
