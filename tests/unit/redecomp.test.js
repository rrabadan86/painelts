'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const RC = require('../../src/redecomp');

test('listas iguais às do navegador (grupos da meta em contas.js; categorias em rules.js)', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../public/js/rules.js'), 'utf8');
  // os grupos que contam para a meta têm uma lista só (public/js/contas.js), usada pelas telas e pelo servidor
  const CT = require('../../public/js/contas');
  assert.deepStrictEqual(RC.LISTAS.G_AROM, CT.GRUPOS_META.arom);
  assert.deepStrictEqual(RC.LISTAS.G_PURO, CT.GRUPOS_META.puro);
  assert.deepStrictEqual(RC.LISTAS.G_ACESS, CT.GRUPOS_META.acess);
  assert.ok(!/const G_AROM =/.test(js), 'rules.js não pode ter cópia da lista de grupos da meta');
  for (const [nome, lista] of Object.entries(RC.LISTAS)) {
    if (/^G_/.test(nome)) continue;
    const m = js.match(new RegExp(`const ${nome} = (\\[[^\\]]*\\]);`));
    assert.ok(m, nome + ' não encontrado em rules.js');
    assert.deepStrictEqual(JSON.parse(m[1].replace(/'/g, '"')), lista, nome + ' mudou em rules.js: atualize src/redecomp.js');
  }
});

test('média da franquia: anônima com 4+ lojas, valores por balde', () => {
  const dia = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 864e5);
  const venda = (data, cupom, vend, vt, extra = {}) => ({ data, cupom, vendedor: vend, vt, qtd: 1, grupoC: 'CHÁ AROMATIZADO', grupo: 'CHÁ PRETO AROMATIZADO', cat: 'Chás aromatizados, Chás, Rooibos e Infusões Aromatizados, LOJA', soNumeros: 100, ...extra });
  const partes = [1, 2, 3].map((n) => ({ id: 'l' + n, vendas: [venda('2026-11-02', 1, 'ANA', 100 * n), venda('2026-11-02', 2, 'BIA', 100 * n, { grupoC: 'ACESSÓRIOS', grupo: 'ACESSÓRIOS', cat: 'x', soNumeros: null })] }));
  assert.ok(RC.comparativos(partes, dia('2026-11-01'), dia('2026-11-30'), 'dia').minimo, 'com 3 lojas não mostra');
  partes.push({ id: 'l4', vendas: [venda('2026-11-02', 1, 'CAU', 400), venda('2026-11-02', 2, 'SEM VENDEDOR', 999)] });
  const r = RC.comparativos(partes, dia('2026-11-01'), dia('2026-11-30'), 'dia');
  assert.equal(r.lojas, 4);
  const k = String(dia('2026-11-02'));
  // faturamento da loja conta as vendas SEM VENDEDOR (definição única): a loja 4 entra com 400 + 999
  assert.equal(r.hist[k], (200 + 400 + 600 + 1399) / 4);
  assert.equal(r.met[k].tkm, (200 + 400 + 600 + 400) / 7); // 7 cupons (vendedora, cupom)
  assert.equal(r.met[k].cupons, 1); // 7 vendedoras, 1 cupom cada
  assert.equal(r.pacotes[100], 1); // 4 vendedoras com pacote, 1 cada
  assert.equal(r.mix.arom, (0.5 * 3 + 1) / 4);
});
