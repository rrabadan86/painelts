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

test('GRP-05: grupo do cadastro vira o grupo do filtro das Vendas pela relação que as vendas mostram; grupo que nunca vendeu fica sem', () => {
  const idx = G.montar(base(VENDAS));
  assert.strictEqual(idx.vendasDe('CHÁ VERDE AROMATIZADO'), 'CHÁ AROMATIZADO');
  assert.strictEqual(idx.vendasDe(' chá verde aromatizado '), 'CHÁ AROMATIZADO', 'sem diferenciar maiúsculas nem espaços');
  assert.strictEqual(idx.vendasDe('ACESSÓRIOS'), 'ACESSÓRIOS');
  assert.strictEqual(idx.vendasDe('GRUPO QUE NUNCA VENDEU'), '');
  assert.strictEqual(idx.vendasDe(''), '');
  assert.strictEqual(G.montar(null).vendasDe('ACESSÓRIOS'), '');
});

test('GRP-06: o grupo do chá a granel vem só dos pacotes DE CHÁ — sachê, caixa de sachês e Tea Moments com o mesmo código não contam (29114 em Torres)', () => {
  // Torres: vende mais sachê do African Sunset do que pacote; o grupo certo do 29114 é ROOIBOS AROMATIZADO
  const linhas = [
    ['291141', 'African Sunset 50G', 'African Sunset', 'ROOIBOS AROMATIZADO', 'CHÁ AROMATIZADO', 0.05],
    ['29114.I', 'African Sunset - Sachê Piramidal', 'African Sunset Sachê', 'SACHÊS PIRAMIDAIS', 'SACHÊS', 0],
    ['29114.I', 'African Sunset - Sachê Piramidal', 'African Sunset Sachê', 'SACHÊS PIRAMIDAIS', 'SACHÊS', 0],
    ['29114.I', 'African Sunset - Sachê Piramidal', 'African Sunset Sachê', 'SACHÊS PIRAMIDAIS', 'SACHÊS', 0],
    ['29114.CX', 'African Sunset - Caixa Sachês', 'African Sunset Caixa', 'SACHÊS PIRAMIDAIS', 'SACHÊS', 0],
    ['29114.40G', 'Tea Moments - African Sunset - Lata 40G', 'Tea Moments African Sunset', 'TEA MOMENTS', 'TEA MOMENTS', 0],
  ];
  const db = base(linhas.map((l) => l.slice(0, 5)));
  db.cha = linhas.map((l) => l[5]);
  assert.strictEqual(G.montar(db).de('29114', 'African Sunset', true).grupo, 'ROOIBOS AROMATIZADO');
  // o sachê continua com o grupo dele pelo próprio código
  assert.strictEqual(G.montar(db).de('29114.I', 'African Sunset - Sachê Piramidal', false).grupo, 'SACHÊS PIRAMIDAIS');
});
