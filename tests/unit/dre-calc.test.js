'use strict';
// DRE-CALC-01: o valor real do mês também vale para as linhas calculadas do Resultado — Simples, maquininha, royalties e
// marketing (pedido do dono, 23/11/2026). O servidor aceita só essas quatro chaves além dos custos fixos de Configurações.
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dre-calc-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1' }], usuarios: {} }));
const FXM = require('../../src/fixosmes');

test('DRE-CALC-01: Simples, maquininha, royalties e marketing aceitam o valor real do mês; chave inventada não', () => {
  const fixos = [{ nome: 'Aluguel', tipo: 'mes', valor: 4000 }];
  for (const k of ['@simples', '@maquininha', '@royalties', '@marketing']) {
    const v = FXM.validar({ nome: k, ym: '2026-10', valor: '4978.9' }, fixos, '2026-11-23');
    assert.deepStrictEqual(v.ok, { nome: k, ym: '2026-10', valor: 4978.9 }, k);
  }
  assert.ok(FXM.validar({ nome: '@outra', ym: '2026-10', valor: 1 }, fixos, '2026-11-23').erro, 'chave que não existe');
  assert.ok(FXM.validar({ nome: '@simples', ym: '2026-10', valor: -1 }, fixos, '2026-11-23').erro, 'negativo');
  // grava e volta ao calculado
  const r = FXM.lancar('l1', { nome: '@royalties', ym: '2026-10', valor: 1500 }, fixos, 'dono', '2026-11-23');
  assert.strictEqual(r.ok.despesas['@royalties']['2026-10'].valor, 1500);
  assert.strictEqual(r.ok.despesas['@royalties']['2026-10'].por, 'dono');
  const r2 = FXM.lancar('l1', { nome: '@royalties', ym: '2026-10', padrao: true }, fixos, 'dono', '2026-11-23');
  assert.strictEqual(r2.ok.despesas['@royalties'], undefined);
  fs.rmSync(tmp, { recursive: true, force: true });
});
