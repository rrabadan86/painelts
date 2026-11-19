'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-'));
process.env.DATA_DIR = tmp;
const ORC = require('../../src/orcamentos');

test('orçamento: valida, numera, totaliza, muda situação e trava o aprovado', () => {
  assert.match(ORC.salvar('lj', { itens: [] }, 'g').erro, /empresa/);
  assert.match(ORC.salvar('lj', { cliente: { empresa: 'X' }, itens: [] }, 'g').erro, /produto/);
  const b = { cliente: { empresa: 'Empresa X' }, itens: [{ cod: '1', nome: 'Caneca', qtd: 10, preco: 50, desc: 10, custo: 20 }], descGeral: 5, frete: 30, custoExtra: 15 };
  const o = ORC.salvar('lj', b, 'franq').ok;
  assert.equal(o.numero, 1);
  const t = ORC.totais(o);
  // 10 × 50 = 500; −10% = 450; −5% geral = 427,50; + frete 30 = 457,50; custo 200 + 15
  assert.deepEqual([t.bruto, t.produtos, t.total, t.custo, t.lucroBruto], [500, 427.5, 457.5, 215, 212.5]);
  assert.equal(ORC.salvar('lj', b, 'franq').ok.numero, 2);
  assert.match(ORC.situacao('lj', o.id, 'perdido', '', 'g').erro, /motivo/);
  assert.ok(ORC.situacao('lj', o.id, 'aprovado', '', 'g').ok);
  assert.match(ORC.salvar('lj', { ...b, id: o.id }, 'g').erro, /aprovado/);
  assert.match(ORC.excluir('lj', o.id).erro, /rascunho/);
  assert.equal(ORC.lista('lj').length, 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});
