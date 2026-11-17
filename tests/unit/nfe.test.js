'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-'));
process.env.DATA_DIR = tmp;
const NFE = require('../../src/nfe');
const C = require('../../src/config');

test('rascunho de NF-e: confere contra os cadastros, grava o pedido e lê o resultado do robô', () => {
  const env = path.join(C.pastaLoja('lj'), 'nfe', 'envio');
  assert.ok(NFE.criar('lj', {}, 'ger').erro, 'sem cadastros não cria');
  fs.mkdirSync(env, { recursive: true });
  fs.writeFileSync(path.join(env, 'cadastros.resultado.json'), JSON.stringify({ ok: true, em: new Date().toISOString(), cadastros: {
    parceiros: [{ id: 'p1', nome: 'Cliente', doc: '123' }], vendedores: [{ id: 'v1', nome: 'ANA' }], produtos: [{ id: 'x1', codigo: '10', nome: 'Xícara', preco: 18.9 }], pagamentos: [{ codigo: '1', descricao: 'Dinheiro' }] } }));
  const base = { parceiroId: 'p1', vendedorId: 'v1', pagamento: '1', itens: [{ produtoId: 'x1', qtd: 3, preco: 18.9 }] };
  assert.match(NFE.criar('lj', { ...base, parceiroId: 'zz' }, 'ger').erro, /parceiro/);
  assert.match(NFE.criar('lj', { ...base, itens: [{ produtoId: 'x1', qtd: 0, preco: 1 }] }, 'ger').erro, /Quantidade/);
  const r = NFE.criar('lj', base, 'ger').ok;
  assert.equal(r.total, 56.7);
  const pedido = JSON.parse(fs.readFileSync(path.join(env, r.id + '.json'), 'utf8'));
  assert.deepEqual(pedido.itens, [{ produtoId: 'x1', codigo: '10', qtd: 3, preco: 18.9 }]);
  assert.equal(pedido.simular, false);
  assert.equal(NFE.conferir('lj').mudou.length, 0);
  fs.writeFileSync(path.join(env, r.id + '.resultado.json'), JSON.stringify({ ok: true, em: new Date(Date.now() + 1000).toISOString(), nota: { total: 56.7 } }));
  assert.equal(NFE.conferir('lj').lista[0].estado, 'ok');
  const t = NFE.criar('lj', { ...base, simular: true }, 'ger').ok;
  fs.writeFileSync(path.join(env, t.id + '.resultado.json'), JSON.stringify({ ok: true, simulado: true, em: new Date(Date.now() + 1000).toISOString() }));
  assert.equal(NFE.conferir('lj').lista[0].estado, 'teste');
  fs.rmSync(tmp, { recursive: true, force: true });
});
