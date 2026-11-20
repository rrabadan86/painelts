'use strict';
// Perdas do mês para o Resultado (src/perdas.js): chá vencido ainda no estoque + faltas do inventário, a custo
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../../src/perdas');

const lote = (validade, dias, saldo, custoKg) => ({ validade, dias, saldo, custoKg });
const cont = (importadoEm, ajuste, extra = {}) => ({ st: 'importado', importadoEm, revertidoEm: null, ajuste, ...extra });

test('chá vencido: saldo × custo do kg, no mês em que a validade venceu; o que ainda não venceu não é perda', () => {
  const r = P.porMes({ lotes: [lote('2026-04-20', -22, 0.8, 150), lote('2026-04-02', -40, 0.2, 100), lote('2026-05-03', -9, 1, 90), lote('2026-06-30', 49, 5, 200), lote(null, null, 3, 100)], contagens: [] });
  assert.deepStrictEqual(Object.keys(r).sort(), ['2026-04', '2026-05']);
  assert.strictEqual(r['2026-04'].vencidos, 140); // 0,8 × 150 + 0,2 × 100
  assert.strictEqual(r['2026-04'].nVencidos, 2);
  assert.strictEqual(r['2026-04'].kgVencidos, 1);
  assert.strictEqual(r['2026-05'].total, 90);
});

test('inventário: as contagens aplicadas no mês somam; só o saldo negativo vira perda', () => {
  // maio: −300 e +80 → perda 220 (sem descontar a sobra seriam 300); junho: +50 → perda zero
  const r = P.porMes({ lotes: [], contagens: [cont('2026-05-10T15:00:00Z', -300), cont('2026-05-20T15:00:00Z', 80), cont('2026-06-05T15:00:00Z', 50)] });
  assert.strictEqual(r['2026-05'].inventario, 220);
  assert.strictEqual(r['2026-05'].faltasInv, 300);
  assert.strictEqual(r['2026-05'].sobrasInv, 80);
  assert.strictEqual(r['2026-05'].nContagens, 2);
  assert.strictEqual(r['2026-06'].inventario, 0);
  assert.strictEqual(r['2026-06'].total, 0);
});

test('inventário: contagem não aplicada, desfeita, cancelada ou sem planilha fica de fora', () => {
  const r = P.porMes({ lotes: [], contagens: [
    cont('2026-05-10T15:00:00Z', -100, { st: 'gerado' }), cont('2026-05-10T15:00:00Z', -100, { revertidoEm: '2026-05-11T10:00:00Z' }),
    cont('2026-05-10T15:00:00Z', -100, { st: 'cancelado' }), cont('2026-05-10T15:00:00Z', null), cont(null, -100), cont('2026-05-12T15:00:00Z', -40)] });
  assert.strictEqual(r['2026-05'].inventario, 40);
  assert.strictEqual(r['2026-05'].nContagens, 1);
});

test('o mês da contagem é o do horário de São Paulo (aplicada às 23h do dia 31 não vai para o mês seguinte)', () => {
  const r = P.porMes({ lotes: [], contagens: [cont('2026-06-01T02:00:00Z', -70)] }); // 31/05 às 23h em São Paulo
  assert.strictEqual(r['2026-05'].inventario, 70);
  assert.strictEqual(r['2026-06'], undefined);
});

test('as duas perdas somam no total do mês; lote vencido sem custo entra com zero e é contado', () => {
  const r = P.porMes({ lotes: [lote('2026-05-03', -9, 1, 90), lote('2026-05-04', -8, 2, null)], contagens: [cont('2026-05-10T15:00:00Z', -60)] });
  assert.strictEqual(r['2026-05'].total, 150);
  assert.strictEqual(r['2026-05'].semCusto, 1);
  assert.strictEqual(r['2026-05'].nVencidos, 2);
});

test('bordas: sem dados não quebra; apresentação tem contagens fictícias só no passado', () => {
  assert.deepStrictEqual(P.porMes({}), {});
  assert.deepStrictEqual(P.porMes({ lotes: null, contagens: null }), {});
  const cs = P.contagensDemo('demo-centro', '2026-05-04');
  assert.ok(cs.length >= 4);
  assert.ok(cs.every((c) => c.importadoEm.slice(0, 10) <= '2026-05-04'));
  assert.ok(P.porMes({ lotes: [], contagens: cs })['2026-05'].inventario > 0);
});
