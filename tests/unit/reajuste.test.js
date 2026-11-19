'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const COB = require('../../src/cobranca');

test('Reajuste para a franquia: confere os itens e monta a tabela do e-mail', () => {
  assert.ok(COB.conferirItensReajuste([]).erro);
  assert.ok(COB.conferirItensReajuste([{ nome: 'Chá', antes: 0, depois: 10 }]).erro, 'custo antes precisa ser positivo');
  assert.ok(COB.conferirItensReajuste(Array.from({ length: 101 }, () => ({ nome: 'x', antes: 1, depois: 2 }))).erro);
  const r = COB.conferirItensReajuste([{ cod: '200<script>1', nome: 'Fruit\nExplosion', antes: 198.584, depois: 214.3 }]);
  assert.deepEqual(r.ok, [{ cod: '200script1', nome: 'Fruit Explosion', antes: 198.58, depois: 214.3 }]);
  const t = COB.tabelaReajuste(r.ok);
  assert.match(t.tabelaTexto, /Fruit Explosion \(cód\. 200script1\) \| R\$ 198,58 \| R\$ 214,30 \| \+7,9%/);
  assert.match(t.tabelaHtml, /Custo nesta nota/);
  assert.ok(!/<script/.test(t.tabelaHtml));
});
