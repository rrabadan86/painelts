'use strict';
// NFE-REGRA-02…03: regras fiscais pelo nome (pedido do dono, 23/11/2026). Venda: cada produto usa a regra vinculada a ele no
// AppNext (com ST ou sem ST) — o painel só mostra; devolução: escolhe a regra pelo nome (a nota tem o CFOP dela).
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-regras-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1' }], usuarios: {} }));
const N = require('../../src/nfecfop');

const CAD = { regras: [
  { id: 'a', descricao: 'VENDA SEM ST', motivo: '1', motivoNome: 'Venda', cfop: '5102', produtos: 2553 },
  { id: 'b', descricao: 'VENDA COM ST', motivo: '1', motivoNome: 'Venda', cfop: '5405', produtos: 312 },
  { id: 'c', descricao: 'DEVOLUÇÃO AO FORNECEDOR', motivo: '19', motivoNome: 'Devolução ao Fornecedor', cfop: '5202', produtos: 2217 },
  { id: 'd', descricao: 'PERDAS LOJA', motivo: '7', motivoNome: 'Perdas', cfop: '5927', produtos: 2103 },
] };

test('NFE-REGRA-02: separa as regras de venda (com e sem ST) e as de devolução pelo motivo; as outras (perdas…) ficam de fora', () => {
  const r = N.regrasDe('l1', CAD);
  assert.deepStrictEqual(r.venda.map((q) => [q.descricao, q.cfop, q.produtos]), [['VENDA SEM ST', '5102', 2553], ['VENDA COM ST', '5405', 312]]);
  assert.deepStrictEqual(r.devolucao.map((q) => [q.descricao, q.cfop]), [['DEVOLUÇÃO AO FORNECEDOR', '5202']]);
});

test('NFE-REGRA-03: sem regras de devolução na leitura dos cadastros, usa as que o robô viu na última devolução', () => {
  assert.deepStrictEqual(N.regrasDe('l1', { regras: [] }).devolucao, []);
  N.guardarRegrasDev('l1', [{ id: 'x', descricao: 'DEVOLUÇÃO COM ST', cfop: '5411', produtos: 140 }], '2026-11-23T10:00:00Z');
  assert.deepStrictEqual(N.regrasDe('l1', { regras: [] }).devolucao.map((q) => [q.descricao, q.cfop]), [['DEVOLUÇÃO COM ST', '5411']]);
  // a leitura dos cadastros, quando traz, vale mais
  assert.deepStrictEqual(N.regrasDe('l1', CAD).devolucao.map((q) => q.cfop), ['5202']);
  fs.rmSync(tmp, { recursive: true, force: true });
});
