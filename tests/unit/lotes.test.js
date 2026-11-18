'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lot-'));
process.env.DATA_DIR = tmp;
const L = require('../../src/lotes');

const estoque = { em: '2026-11-18T10:00:00Z', itens: [
  { cod: '80149', desc: 'VALERIANA', un: 'Kg', qtd: 2.5, custo: 120 },
  { cod: '80200', desc: 'EARL GREY', un: 'Kg', qtd: 0.4, custo: 100 },
  { cod: '406', desc: 'LATA TOP TEA', un: 'UN', qtd: 10, custo: 20 }, // envasado: sem validade
  { cod: '80300', desc: 'HIBISCO', un: 'Kg', qtd: 0, custo: 90 }, // sem estoque: sem lote
] };
const compras = { itens: {
  '80149': [['2025-12-01', 118, 100, 1, 'TSB'], ['2026-03-10', 120, 200, 2, 'TSB'], ['2026-11-19', 125, 300, 3, 'TSB']], // a de 19/11 é depois do estoque
  '80200': [['2025-11-10', 100, 150, 1, 'TSB']],
  '406': [['2026-01-01', 20, 100, 10, 'TSB']],
} };
const tabela = { itens: [{ cod: '801491', desc: 'VALERIANA 100G', preco: 30 }, { cod: '801492', desc: 'VALERIANA 50G', preco: 18 }] };

test('lotes: só chá a granel, estoque distribuído da entrada mais nova para a mais antiga', () => {
  const { lotes } = L.calcular({ estoque, compras, tabela, edits: { lotes: {} }, hoje: '2026-11-18' });
  const val = lotes.filter((l) => l.cod === '80149');
  // 2,5 kg: 2 kg do lote de março e 0,5 kg do de dezembro; a entrada de 19/11 ainda não está no estoque exportado
  assert.deepEqual(val.map((l) => [l.entrada, l.saldo]).sort(), [['2025-12-01', 0.5], ['2026-03-10', 2]]);
  assert.ok(!lotes.some((l) => l.cod === '406' || l.cod === '80300'));
  const dez = val.find((l) => l.entrada === '2025-12-01');
  assert.equal(dez.validade, '2026-12-01');
  assert.equal(dez.dias, 13);
  assert.equal(dez.faixa, 'critica');
  assert.equal(dez.lote, '0');
  assert.equal(dez.precoKg, 300); // pacote de 100 g a R$ 30 → R$ 300/kg
  const eg = lotes.find((l) => l.cod === '80200');
  assert.equal(eg.validade, '2026-11-10');
  assert.equal(eg.faixa, 'vencido');
  assert.equal(lotes[0].cod, '80200'); // o mais urgente primeiro
});

test('lotes: saldo sem nota e faixas', () => {
  const est = { em: '2026-11-18', itens: [{ cod: '1', desc: 'X', un: 'Kg', qtd: 3, custo: 10 }] };
  const { lotes } = L.calcular({ estoque: est, compras: { itens: { 1: [['2026-10-01', 10, 9, 1, 'T']] } }, tabela: null, edits: { lotes: {} }, hoje: '2026-11-18' });
  assert.deepEqual(lotes.map((l) => [l.chave, l.saldo, l.faixa]).sort(), [['9|1|2026-10-01', 1, 'ok'], ['inicial|1', 2, 'sem']]);
  assert.equal(L.faixa(-1), 'vencido'); assert.equal(L.faixa(0), 'critica'); assert.equal(L.faixa(29), 'critica');
  assert.equal(L.faixa(30), 'acao'); assert.equal(L.faixa(59), 'acao'); assert.equal(L.faixa(60), 'atencao'); assert.equal(L.faixa(90), 'ok');
  assert.equal(L.somarMeses('2024-02-29', 12), '2025-02-28');
});

test('lotes: edição do nº do lote e da validade, resumo e valor em risco', () => {
  const calc = () => L.calcular({ estoque, compras, tabela, edits: L.ler('lj'), hoje: '2026-11-18' }).lotes;
  let lotes = calc();
  const ch = lotes.find((l) => l.cod === '80149' && l.entrada === '2026-03-10').chave;
  assert.match(L.editar('lj', { chave: ch, lote: 'a<b' }, 'v', lotes).erro, /Lote/);
  assert.match(L.editar('lj', { chave: ch, validade: '2020-01-01' }, 'v', lotes).erro, /Validade/);
  assert.match(L.editar('lj', { chave: 'nada', lote: '1' }, 'v', lotes).erro, /não encontrado/);
  assert.ok(L.editar('lj', { chave: ch, lote: 'l2603-a', validade: '2026-12-20' }, 'vendedora', lotes).ok);
  lotes = calc();
  const l = lotes.find((x) => x.chave === ch);
  assert.deepEqual([l.lote, l.validade, l.padrao, l.faixa, l.editadoPor], ['L2603-A', '2026-12-20', false, 'acao', 'vendedora']);
  const r = L.resumo(lotes);
  // em risco (< 60 dias): EG vencido 0,4 kg + valeriana dez 0,5 kg + valeriana março 2 kg
  assert.equal(r.risco.kg, 2.9);
  assert.equal(r.risco.custo, 0.4 * 100 + 0.5 * 120 + 2 * 120);
  assert.equal(r.porFaixa.vencido.lotes, 1);
  assert.equal(r.semLote, lotes.length - 1);
  // validade vazia volta para 12 meses da entrada; lote "0" apaga o número
  assert.ok(L.editar('lj', { chave: ch, lote: '0', validade: '' }, 'v', lotes));
  assert.equal(calc().find((x) => x.chave === ch).validade, '2027-03-10');
  assert.deepEqual(L.ler('lj').lotes, {});
});
