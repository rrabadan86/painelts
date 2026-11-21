const { test } = require('node:test');
const assert = require('node:assert');
const G = require('../../public/js/grupoprod');

// base mínima no formato do painel: colunas com o índice no dicionário
function base(linhas) {
  const D = { cod: [], descricao: [], produto: [], grupo: [], grupoC: [] };
  const ix = (k, v) => { let i = D[k].indexOf(v); if (i < 0) { D[k].push(v); i = D[k].length - 1; } return i; };
  const db = { n: linhas.length, D, cod: [], desc: [], prod: [], grupo: [], grupoC: [] };
  for (const [cod, desc, prod, grupo, grupoC] of linhas) {
    db.cod.push(ix('cod', cod)); db.desc.push(ix('descricao', desc)); db.prod.push(ix('produto', prod));
    db.grupo.push(ix('grupo', grupo)); db.grupoC.push(ix('grupoC', grupoC));
  }
  return db;
}
const VENDAS = [
  ['270101', 'Valeriana Garden 50G', 'Valeriana Garden', 'CHÁ VERDE AROMATIZADO', 'CHÁ AROMATIZADO'],
  ['270102', 'Valeriana Garden 100G', 'Valeriana Garden', 'CHÁ VERDE AROMATIZADO', 'CHÁ AROMATIZADO'],
  ['270102', 'Valeriana Garden 100G', 'Valeriana Garden', 'CHÁ VERDE AROMATIZADO', 'CHÁ AROMATIZADO'],
  ['27010.20g', 'Minitin Valeriana Garden', 'Minitin Valeriana Garden', 'CHÁS PARA MINITINS', 'CHÁS PARA MINITINS'],
  ['20431', 'Lata Circular Turquoise', 'Lata Circular Turquoise', 'ACESSÓRIOS', 'ACESSÓRIOS'],
  ['', 'Caneca Sem Código', 'Caneca Sem Código', 'ACESSÓRIOS', 'ACESSÓRIOS'],
];

test('GRP-01: chá a granel pega o grupo dos pacotes dele (o que mais aparece), não o do minitin', () => {
  const idx = G.montar(base(VENDAS));
  assert.deepStrictEqual(idx.de('27010', 'Valeriana Garden', true), { grupo: 'CHÁ VERDE AROMATIZADO', grupoVendas: 'CHÁ AROMATIZADO' });
});
test('GRP-02: produto pronto pelo código vendido; sem código, pelo nome (sem acento e sem maiúscula)', () => {
  const idx = G.montar(base(VENDAS));
  assert.strictEqual(idx.de('20431', 'qualquer nome', false).grupo, 'ACESSÓRIOS');
  assert.strictEqual(idx.de(null, 'caneca sem codigo', false).grupo, 'ACESSÓRIOS');
});
test('GRP-03: produto pronto não pega grupo de pacote por coincidência de código; sem saber se é granel, tenta os pacotes', () => {
  const idx = G.montar(base(VENDAS));
  assert.strictEqual(idx.de('27010', 'Outro Nome', false), null);
  assert.strictEqual(idx.de('27010', 'Outro Nome').grupo, 'CHÁ VERDE AROMATIZADO');
});
test('GRP-04: sem venda devolve null; base vazia ou ausente não quebra', () => {
  assert.strictEqual(G.montar(base(VENDAS)).de('99999', 'Nunca Vendeu', false), null);
  assert.strictEqual(G.montar(null).de('1', 'x', true), null);
  assert.strictEqual(G.montar({ n: 0, D: {} }).de('1', 'x'), null);
});
