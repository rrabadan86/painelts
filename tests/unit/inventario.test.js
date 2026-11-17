// Inventário: catálogo (tipo de chá pelas vendas), contagem e a planilha no modelo do AppNext
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1' }], usuarios: {} }));
const INV = require('../../src/inventario');
const ExcelJS = require('exceljs');

const estoque = { em: '2026-11-17T08:00:00-03:00', itens: [
  { cod: '31020', desc: 'Valeriana Garden', un: 'Kg', qtd: 1.25, custo: 180 },
  { cod: '31030', desc: 'Rooibos Paradise', un: 'Kg', qtd: 0.4, custo: 150 },
  { cod: '003', desc: 'Material De Campanha', un: 'Un', qtd: 13, custo: 0.01 },
  { cod: '71194', desc: 'Lata Ginko 100G', un: 'Un', qtd: 4, custo: 22.5 },
] };
const tabela = { itens: [{ cod: '71194', grupo: 'ACESSÓRIOS', sub: 'Latas 100g', barras: '7890000000017' }, { cod: '31020', grupo: 'MATÉRIA PRIMA', sub: 'Matéria Prima' }] };
const vendas = [{ descricao: 'Valeriana Garden 100G', cod: '310202', grupo: 'INFUSÕES' }, { descricao: 'Rooibos Paradise 50G', cod: null, grupo: 'ROOIBOS AROMATIZADO' }];
const cat = INV.catalogo(estoque, tabela, vendas);

test('catálogo: grupo do cadastro, tipo de chá pelas vendas, código de barras', () => {
  const v = cat.find((i) => i.cod === '31020'), r = cat.find((i) => i.cod === '31030'), l = cat.find((i) => i.cod === '71194');
  assert.deepStrictEqual([v.grupo, v.tipo], ['MATÉRIA PRIMA', 'INFUSÕES']);
  assert.strictEqual(r.tipo, 'ROOIBOS AROMATIZADO');
  assert.strictEqual(INV.familia(r.tipo), 'Rooibos');
  assert.deepStrictEqual([l.sub, l.barras], ['Latas 100g', '7890000000017']);
});

test('contagem: por tipo de chá; kg com casas, unidade só inteiro; cega para vendedora', () => {
  const c = INV.criar('l1', { filtro: { familia: 'Rooibos' }, nome: 'Rooibos' }, 'gabi', cat, 'vendedor').ok;
  assert.deepStrictEqual(c.itens.map((i) => i.cod), ['31030']);
  assert.strictEqual(c.cega, true);
  assert.strictEqual(INV.paraUsuario(c, 'vendedor').itens[0].sis, null);
  assert.ok(INV.contar('l1', c.id, '31030', '0,375', 'gabi').ok);
  const c2 = INV.criar('l1', { cods: ['71194', '003', '31020'] }, 'ger', cat, 'gerente').ok;
  assert.match(INV.contar('l1', c2.id, '71194', 2.5, 'ger').erro, /inteiro/);
  assert.ok(INV.contar('l1', c2.id, '71194', 0, 'ger').ok);   // zero vale (zera no AppNext)
  assert.ok(INV.contar('l1', c2.id, '31020', 1.1, 'ger').ok);
  assert.match(INV.contar('l1', c2.id, '99999', 1, 'ger').erro, /fora/);
});

test('planilha: modelo do AppNext, só os itens contados, código como texto, custo atual', async () => {
  const c = INV.criar('l1', { cods: ['71194', '003', '31020'] }, 'ger', cat, 'gerente').ok;
  INV.contar('l1', c.id, '003', 0, 'ger');
  INV.contar('l1', c.id, '31020', 1.1, 'ger');
  const buf = await INV.planilha(INV.ler('l1', c.id), 'Loja 1', estoque);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  assert.strictEqual(ws.name, 'Inventário');
  assert.deepStrictEqual(ws.getRow(6).values.slice(1), ['Código', 'Descrição', 'Unidade', 'Grupo', 'Subgrupo', 'Qtd. Atual', 'Nova Qtd.', 'Preço de Custo']);
  const linhas = [];
  ws.eachRow((r, n) => { if (n >= 7) linhas.push(r.values.slice(1)); });
  assert.strictEqual(linhas.length, 2); // a lata não foi contada: fica de fora
  const m = Object.fromEntries(linhas.map((l) => [l[0], l]));
  assert.strictEqual(typeof m['003'][0], 'string');
  assert.deepStrictEqual([m['003'][6], m['31020'][6], m['31020'][7]], [0, 1.1, 180]);
});
