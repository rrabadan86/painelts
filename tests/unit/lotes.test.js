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

test('lotes: "deste lote ainda tem X" e as vendas seguintes saindo do mais antigo', () => {
  // valeriana: 200 g do lote antigo (A) e 1 kg do novo (B); estoque 1,2 kg
  const comp = { itens: { 9: [['2026-01-10', 100, 1, 2, 'T'], ['2026-11-17', 100, 2, 1, 'T']] } };
  const est = (q, em) => ({ em, itens: [{ cod: '9', desc: 'VALERIANA', un: 'Kg', qtd: q, custo: 100 }] });
  const A = '1|9|2026-01-10', B = '2|9|2026-11-17';
  const dist = (r) => Object.fromEntries(r.lotes.map((l) => [l.chave, l.saldo]));
  const calc = (e) => L.calcular({ estoque: e, compras: comp, tabela: null, edits: L.ler('aj'), hoje: '2026-11-18' });
  assert.deepEqual(dist(calc(est(1.2, '2026-11-18T09:00:00Z'))), { [B]: 1, [A]: 0.2 });
  // venderam 300 g do pacote novo por engano: o AppNext fica com 0,9 kg; a regra automática acharia A = 0
  let ctx = { estoque: est(0.9, '2026-11-19T09:00:00Z'), compras: comp };
  ctx.lotes = calc(ctx.estoque).lotes;
  assert.deepEqual(dist({ lotes: ctx.lotes }), { [B]: 0.9 });
  // a vendedora diz: do lote A ainda tem 200 g
  assert.match(L.editarSaldo('aj', { chave: B, saldo: 1.5 }, 'v', ctx).erro, /AppNext/);
  ctx.lotes = [...ctx.lotes, { chave: A, cod: '9', saldo: 0, qtdEntrada: 2 }]; // a tela manda o lote que ela vê
  assert.ok(L.editarSaldo('aj', { chave: A, saldo: 0.2 }, 'vendedora', ctx).ok);
  assert.deepEqual(dist(calc(est(0.9, '2026-11-19T09:00:00Z'))), { [B]: 0.7, [A]: 0.2 });
  // vendeu mais 250 g: sai primeiro do lote A
  const d2 = calc(est(0.65, '2026-11-20T09:00:00Z'));
  assert.deepEqual(dist(d2), { [B]: 0.65 });
  assert.equal(d2.lotes[0].ajuste.tipo, 'manual');
  // chegou mais 1 kg (lote C) e vendeu 100 g
  comp.itens[9].push(['2026-11-21', 100, 3, 1, 'T']);
  assert.deepEqual(dist(calc(est(1.55, '2026-11-22T09:00:00Z'))), { [B]: 0.55, '3|9|2026-11-21': 1 });
  // um estoque exportado antes do ajuste não usa o ajuste
  assert.deepEqual(dist(calc(est(1.2, '2026-11-18T09:00:00Z'))), { [B]: 1, [A]: 0.2 });
  // voltar ao automático
  assert.ok(L.editarSaldo('aj', { chave: B, automatico: true }, 'g', { ...ctx, lotes: calc(est(0.9, '2026-11-19T09:00:00Z')).lotes }).ok);
  assert.deepEqual(dist(calc(est(0.9, '2026-11-19T09:00:00Z'))), { [B]: 0.9 });
});

test('lotes: todos os lotes do chá de uma vez (a soma tem de ser o estoque)', () => {
  const comp = { itens: { 7: [['2026-02-01', 100, 11, 2, 'T'], ['2026-10-01', 100, 12, 1, 'T']] } };
  const estoque = { em: '2026-11-18T09:00:00Z', itens: [{ cod: '7', desc: 'CHAI', un: 'Kg', qtd: 1.2, custo: 100 }] };
  const ctx = { estoque, compras: comp, lotes: L.calcular({ estoque, compras: comp, tabela: null, edits: L.ler('mx'), hoje: '2026-11-18' }).lotes };
  assert.match(L.editarSaldo('mx', { cod: '7', lotes: { '11|7|2026-02-01': 0.5, '12|7|2026-10-01': 0.5 } }, 'v', ctx).erro, /soma/);
  assert.match(L.editarSaldo('mx', { cod: '7', lotes: { 'x|7|2026-02-01': 1.2 } }, 'v', ctx).erro, /inválido/);
  assert.ok(L.editarSaldo('mx', { cod: '7', lotes: { '11|7|2026-02-01': 0.5, '12|7|2026-10-01': 0.7 } }, 'v', ctx).ok);
  const r = L.calcular({ estoque, compras: comp, tabela: null, edits: L.ler('mx'), hoje: '2026-11-18' });
  assert.deepEqual(Object.fromEntries(r.lotes.map((l) => [l.chave, l.saldo])), { '11|7|2026-02-01': 0.5, '12|7|2026-10-01': 0.7 });
});

test('lotes: chás a granel da nota de entrada (antes do estoque) e notas com lote pendente', () => {
  const estoque = { em: '2026-11-10T09:00:00Z', itens: [{ cod: '5', desc: 'ROOIBOS', un: 'Kg', qtd: 0.3, custo: 90 }, { cod: '6', desc: 'LATA X', un: 'UN', qtd: 4, custo: 20 }] };
  const compras = { itens: { 5: [['2026-11-17', 90, 777, 2, 'TSB']], 6: [['2026-11-17', 20, 777, 6, 'TSB']] } };
  const nota = { id: 'n777', nf: 777, entrada: '2026-11-17T10:00:00', itens: [{ cod: '5', nome: 'ROOIBOS', un: 'KG', qtd: 2 }, { cod: '6', nome: 'LATA X', un: 'UN', qtd: 6 }] };
  const its = L.daNota({ nota, estoque, compras, edits: L.ler('nt') });
  assert.deepEqual(its.map((x) => [x.chave, x.lote, x.validade, x.qtd]), [['777|5|2026-11-17', '0', '2027-11-17', 2]]);
  assert.deepEqual(L.pendentesNotas({ notas: [nota], estoque, compras, edits: L.ler('nt'), hoje: '2026-11-18' }), { n777: 1 });
  // o estoque ainda é de antes da nota: o lote não está em aberto, mas dá para informar pela nota
  const abertos = L.calcular({ estoque, compras, tabela: null, edits: L.ler('nt'), hoje: '2026-11-18' }).lotes;
  assert.ok(!abertos.some((l) => l.chave === '777|5|2026-11-17'));
  assert.match(L.editar('nt', { chave: '777|5|2026-11-17', lote: 'R1' }, 'v', abertos).erro, /não encontrado/);
  assert.ok(L.editar('nt', { chave: '777|5|2026-11-17', lote: 'R1' }, 'v', abertos, compras).ok);
  assert.deepEqual(L.pendentesNotas({ notas: [nota], estoque, compras, edits: L.ler('nt'), hoje: '2026-11-18' }), {});
  // quando o estoque é atualizado, o lote aparece com o nº já preenchido
  const depois = L.calcular({ estoque: { ...estoque, em: '2026-11-18T09:00:00Z', itens: [{ ...estoque.itens[0], qtd: 2.3 }] }, compras, tabela: null, edits: L.ler('nt'), hoje: '2026-11-18' }).lotes;
  assert.equal(depois.find((l) => l.chave === '777|5|2026-11-17').lote, 'R1');
});
