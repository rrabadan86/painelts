// ⭐ Sugestões da equipe para o pedido: justificar quando tem na loja, decidir no pedido, histórico e retorno
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sug-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1' }], usuarios: {} }));
const SUG = require('../../src/sugestoes');

const estoque = { itens: [
  { cod: '31020', desc: 'Valeriana Garden', un: 'Kg', qtd: 0.5, custo: 180 },
  { cod: '31030', desc: 'Rooibos Paradise', un: 'Kg', qtd: 1.2, custo: 150 },
  { cod: '71194', desc: 'Lata Ginko 100G', un: 'Un', qtd: 4, custo: 22.5 },
  { cod: '80001', desc: 'Caneca Tea', un: 'Un', qtd: 0, custo: 30 },
] };

test('situação: chá abaixo de 700 g é "pouco" e não pede justificativa; com estoque pede; a busca não devolve quantidade nem custo', () => {
  assert.strictEqual(SUG.situacao(estoque.itens[0]), 'pouco');
  assert.strictEqual(SUG.situacao(estoque.itens[1]), 'tem');
  assert.strictEqual(SUG.situacao(estoque.itens[3]), 'acabou');
  const b = SUG.buscar(estoque, 'rooibos');
  assert.deepStrictEqual(b, [{ cod: '31030', desc: 'Rooibos Paradise', un: 'Kg', situacao: 'tem', justificar: true }]);
  assert.ok(!('qtd' in b[0]) && !('custo' in b[0]));
});

test('criar: justificativa obrigatória quando tem na loja; não repete a mesma pessoa no mesmo produto', () => {
  assert.match(SUG.criar('l1', { cod: '31030' }, 'ana', 'Ana', estoque).erro, /ainda tem na loja/);
  assert.ok(SUG.criar('l1', { cod: '31030', justificativa: 'cliente leva 1 kg por mês' }, 'ana', 'Ana', estoque).ok);
  assert.ok(SUG.criar('l1', { cod: '31020' }, 'ana', 'Ana', estoque).ok, 'chá com menos de 700 g não justifica');
  assert.match(SUG.criar('l1', { cod: '31020' }, 'ana', 'Ana', estoque).erro, /já marcou/);
  assert.ok(SUG.criar('l1', { cod: '31020', recado: 'pedem muito' }, 'bia', 'Bia', estoque).ok);
  assert.ok(SUG.criar('l1', { cod: '80001' }, 'bia', 'Bia', estoque).ok);
  assert.match(SUG.criar('l1', { cod: '99999' }, 'bia', 'Bia', estoque).erro, /não encontrado/);
  const g = SUG.paraPedido('l1');
  assert.deepStrictEqual(g.find((x) => x.cod === '31020').pessoas, ['Ana', 'Bia']);
});

test('pedido: entrou fecha; sem estoque no site é automático e continua; "não agora" guarda o motivo e continua; histórico e aviso de novo', () => {
  assert.ok(SUG.decidir('l1', '31030', { res: 'nao', motivo: 'Vende pouco' }, 'ger').ok);
  const r = SUG.fechar('l1', [{ cod: '31020', pedir: 1, site: 'ok' }, { cod: '80001', pedir: 0, site: 'indisp' }, { cod: '31030', pedir: 0, site: 'ok' }], 'ger').ok;
  assert.deepStrictEqual(r, { entrou: 2, semsite: 1, nao: 1 });
  const ana = SUG.lista('l1', 'ana', false);
  assert.ok(ana.every((s) => s.por === undefined), 'a vendedora não recebe o login de ninguém');
  const roo = ana.find((s) => s.cod === '31030');
  assert.strictEqual(roo.st, 'aberta');
  assert.deepStrictEqual([roo.hist[0].res, roo.hist[0].motivo, roo.novo], ['nao', 'Vende pouco', true]);
  assert.strictEqual(ana.find((s) => s.cod === '31020').st, 'atendida');
  const cx = SUG.lista('l1', 'bia', false).find((s) => s.cod === '80001');
  assert.deepStrictEqual([cx.st, cx.hist[0].res], ['aberta', 'semsite']);
  // próximo pedido: o rooibos continua lá, sem a decisão anterior; agora entra
  assert.strictEqual(SUG.paraPedido('l1').find((x) => x.cod === '31030').decisao, null);
  SUG.fechar('l1', [{ cod: '31030', pedir: 1, site: 'ok' }], 'ger');
  const roo2 = SUG.lista('l1', 'ana', false).find((s) => s.cod === '31030');
  assert.deepStrictEqual([roo2.st, roo2.hist.map((x) => x.res)], ['atendida', ['nao', 'entrou']]);
  SUG.visto('l1', 'ana');
  assert.ok(SUG.lista('l1', 'ana', false).every((s) => !s.novo));
});

test('tirar a estrela: só quem marcou (ou quem faz o pedido)', () => {
  const s = SUG.criar('l1', { cod: '71194', justificativa: 'presente de natal' }, 'ana', 'Ana', estoque).ok;
  assert.match(SUG.retirar('l1', s.id, 'bia', false).erro, /Só quem marcou/);
  assert.strictEqual(SUG.retirar('l1', s.id, 'ger', true).ok.st, 'retirada');
});
