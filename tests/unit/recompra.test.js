'use strict';
// Recompra com prazo inteiro (public/js/recompra.js): quadro "Recompra" e "% voltaram" por vendedora
const { test } = require('node:test');
const assert = require('node:assert');
const RC = require('../../public/js/recompra');

test('REC-01 só entra quem já teve os 90 dias: 3 de 6 = 50% (antes: 6 de 10 "compraram 2 vezes ou mais" = 60%)', () => {
  const hoje = 1000;
  const cl = [
    // 6 clientes com a primeira compra há 90 dias ou mais
    { ref: 800, dias: [800, 830] }, { ref: 800, dias: [800, 890] }, { ref: 910, dias: [910, 1000] }, // voltaram dentro de 90 dias
    { ref: 800, dias: [800, 920] }, // voltou, mas só depois de 120 dias: não conta
    { ref: 850, dias: [850] }, { ref: 900, dias: [900] },
    // 4 clientes recentes (ainda no prazo): 2 já voltaram, mas ficam separados
    { ref: 950, dias: [950, 960] }, { ref: 990, dias: [990, 995] }, { ref: 980, dias: [980] }, { ref: 1000, dias: [1000] },
  ];
  const r = RC.recompra(cl, hoje);
  assert.deepStrictEqual([r.clientes, r.elegiveis, r.voltaram, r.semPrazo], [10, 6, 3, 4]);
  assert.strictEqual(r.pct, 0.5);
  assert.strictEqual(r.pouco, true); // 6 clientes com prazo completo: poucos dados (mínimo 20)
  assert.strictEqual(RC.MIN, 20); assert.strictEqual(RC.PRAZO, 90);
});

test('REC-02 bordas: exatamente 90 dias entra; compra no mesmo dia da partida não é volta; sem elegíveis não vira 0%', () => {
  assert.strictEqual(RC.recompra([{ ref: 910, dias: [910] }], 1000).elegiveis, 1);
  assert.strictEqual(RC.recompra([{ ref: 911, dias: [911] }], 1000).elegiveis, 0);
  assert.strictEqual(RC.recompra([{ ref: 800, dias: [800, 800] }], 1000).voltaram, 0);
  assert.strictEqual(RC.recompra([{ ref: 800, dias: [800, 890] }], 1000).voltaram, 1); // no 90º dia ainda vale
  assert.strictEqual(RC.recompra([{ ref: 800, dias: [800, 891] }], 1000).voltaram, 0);
  const vazio = RC.recompra([{ ref: 990, dias: [990, 995] }], 1000);
  assert.strictEqual(vazio.pct, null); assert.strictEqual(vazio.pouco, true); assert.strictEqual(vazio.semPrazo, 1);
  assert.strictEqual(RC.recompra([], 1000).pct, null);
  assert.strictEqual(RC.recompra([{ ref: null, dias: [] }, null], 1000).clientes, 0);
  // com 20 de prazo completo já não é "poucos dados"
  const vinte = Array.from({ length: 20 }, (_, k) => ({ ref: 800, dias: k < 5 ? [800, 820] : [800] }));
  const r = RC.recompra(vinte, 1000);
  assert.strictEqual(r.pouco, false); assert.strictEqual(r.pct, 0.25);
});
