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

test('Reajuste para a franquia: gráficos só PNG de verdade, ligados aos itens e no corpo do e-mail', () => {
  const itens = [{ cod: '12106', nome: 'Spicy Strawberry', antes: 275.1, depois: 291.1 }];
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]).toString('base64');
  const g = COB.conferirGraficos([
    { cod: '12106', png: 'data:image/png;base64,' + png },
    { cod: '99999', png: 'data:image/png;base64,' + png }, // não é item marcado
    { cod: '12106', png: 'data:image/png;base64,' + Buffer.from('<svg>').toString('base64') }, // não é PNG
    { cod: '12106', png: 'data:text/html;base64,' + png },
  ], itens);
  assert.equal(g.length, 1);
  assert.equal(g[0].cid, 'hist-0@painel');
  const t = COB.tabelaReajuste(itens, g);
  assert.match(t.tabelaHtml, /<img src="cid:hist-0@painel"/);
  assert.match(t.tabelaHtml, /Spicy Strawberry — histórico de compras/);
});
