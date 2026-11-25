'use strict';
// ACESSO-DIAS-01 (decisão do dono, 25/11/2026): o prazo de acesso do usuário é em dias (ex.: 14 dias de teste)
const test = require('node:test');
const assert = require('node:assert');
const C = require('../../src/config');

test('ACESSO-DIAS-01: hoje + n dias, atravessando mês e ano', () => {
  assert.equal(C.somaDias('2026-11-25', 14), '2026-12-09');
  assert.equal(C.somaDias('2026-12-25', 7), '2027-01-01');
  assert.equal(C.somaDias('2026-02-27', 2), '2026-03-01');
  assert.equal(C.somaDias('2026-11-25', 0), '2026-11-25');
});
