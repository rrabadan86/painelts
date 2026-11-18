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

test('planilha: modelo do AppNext, contados e (contagem nova) os não contados como 0, código como texto, custo atual', async () => {
  const c = INV.criar('l1', { cods: ['71194', '003', '31020'] }, 'ger', cat, 'gerente').ok;
  INV.contar('l1', c.id, '003', 0, 'ger');
  INV.contar('l1', c.id, '31020', 1.1, 'ger');
  const buf = await INV.planilha(INV.linhasPlanilha(INV.ler('l1', c.id), estoque, cat));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  assert.strictEqual(ws.name, 'Inventário');
  assert.deepStrictEqual(ws.getRow(6).values.slice(1), ['Código', 'Descrição', 'Unidade', 'Grupo', 'Subgrupo', 'Qtd. Atual', 'Nova Qtd.', 'Preço de Custo']);
  const linhas = [];
  ws.eachRow((r, n) => { if (n >= 7) linhas.push(r.values.slice(1)); });
  assert.strictEqual(linhas.length, 3); // a lata não foi contada: vai como 0
  const m = Object.fromEntries(linhas.map((l) => [l[0], l]));
  assert.strictEqual(typeof m['003'][0], 'string');
  assert.deepStrictEqual([m['003'][6], m['31020'][6], m['31020'][7], m['71194'][6]], [0, 1.1, 180, 0]);
});

test('zerar os não listados: entram com Nova Qtd 0, menos os grupos desmarcados; desfazer volta ao de antes', async () => {
  const est2 = { ...estoque, itens: [...estoque.itens, { cod: '81985', desc: 'Jogo Americano', un: 'Un', qtd: 500, custo: 0.34 }] };
  const cat2 = INV.catalogo(est2, { itens: [...tabela.itens, { cod: '81985', grupo: 'CONSUMÍVEIS - SEM CONTROLE DE ESTOQUE' }] }, vendas);
  const c = INV.criar('l1', { cods: ['31020'], zerarResto: true }, 'ger', cat2, 'gerente').ok;
  INV.contar('l1', c.id, '31020', 1.0, 'ger');
  let l = INV.linhasPlanilha(INV.ler('l1', c.id), est2, cat2);
  // Rooibos (0,4), material (13) e lata (4) zerados; jogo americano (sem controle de estoque) fica de fora por padrão
  assert.deepStrictEqual(l.filter((x) => x.zerado).map((x) => x.cod).sort(), ['003', '31030', '71194']);
  assert.ok(l.every((x) => !x.zerado || x.nova === 0));
  INV.zerar('l1', c.id, { ativo: true, semGrupos: ['ACESSÓRIOS', 'CONSUMÍVEIS - SEM CONTROLE DE ESTOQUE'] });
  l = INV.linhasPlanilha(INV.ler('l1', c.id), est2, cat2);
  assert.ok(!l.some((x) => x.cod === '71194'));
  INV.marcarGerado('l1', c.id, 'ger', l);
  INV.acao('l1', c.id, 'importado', 'ger');
  // depois da importação vendeu 0,1 kg de valeriana: o desfazer volta a 1,25 − 0,1 = 1,15 e o rooibos a 0,4
  const depois = { em: new Date(Date.now() + 60e3).toISOString(), itens: [{ cod: '31020', qtd: 0.9, custo: 180 }, { cod: '31030', qtd: 0, custo: 150 }, { cod: '003', qtd: 0, custo: 0.01 }] };
  const d = Object.fromEntries(INV.linhasDesfazer(INV.ler('l1', c.id), depois).map((x) => [x.cod, x.nova]));
  assert.deepStrictEqual([d['31020'], d['31030'], d['003']], [1.15, 0.4, 13]);
  assert.ok(INV.marcarDesfazer('l1', c.id, 'ger', 'gerado').ok);
  assert.strictEqual(INV.marcarDesfazer('l1', c.id, 'ger', 'importado').ok.st, 'revertido');
});

test('envio ao AppNext: prepara arquivos e só marca importado com resultado do robô', async () => {
  const dir = tmp, INV2 = INV;
  const c = INV2.criar('lj', { cods: ['1'] }, 'ger', [{ cod: '1', desc: 'A', un: 'UN', qtd: 5, custo: 2 }], 'gerente').ok;
  INV2.contar('lj', c.id, '1', 3, 'ger');
  const linhas = [{ cod: '1', desc: 'A', un: 'UN', antes: 5, nova: 3, custo: 2 }];
  const p = await INV2.prepararEnvio('lj', c.id, 'importar', linhas, 'ger');
  assert.equal(p.ok.envio.estado, 'na_fila');
  const base = path.join(dir, 'lj', 'inventario', 'envio', `${c.id}-importar`);
  assert.ok(fs.statSync(base + '.xlsx').size > 1000);
  assert.deepEqual(JSON.parse(fs.readFileSync(base + '.json', 'utf8')), [{ cod: '1', nova: 3 }]);
  assert.equal(INV2.conferirEnvio('lj', c.id).mudou, false); // sem resultado ainda
  fs.writeFileSync(base + '.resultado.json', JSON.stringify({ ok: true, simulado: true, em: new Date(Date.now() + 1000).toISOString() }));
  let r = INV2.conferirEnvio('lj', c.id);
  assert.equal(r.c.envio.estado, 'erro'); assert.notEqual(r.c.st, 'importado'); // simulação não conta
  await INV2.prepararEnvio('lj', c.id, 'importar', linhas, 'ger');
  fs.writeFileSync(base + '.resultado.json', JSON.stringify({ ok: true, em: new Date(Date.now() + 1000).toISOString() }));
  r = INV2.conferirEnvio('lj', c.id);
  assert.equal(r.c.st, 'importado'); assert.equal(r.c.importadoPeloRobo, true);
});

test('todos os chás a granel: pega do estoque (mesmo sem venda) e o "zerar" só zera chá a granel', () => {
  const est3 = { ...estoque, itens: [...estoque.itens, { cod: '99001', desc: 'Chá Sem Venda', un: 'Kg', qtd: 0.7, custo: 100 }, { cod: '99002', desc: 'Caneca', un: 'Un', qtd: 3, custo: 20 }] };
  const cat3 = INV.catalogo(est3, tabela, vendas);
  const c = INV.criar('l3', { filtro: { tudoKg: true }, zerarResto: true }, 'ger', cat3, 'gerente').ok;
  assert.ok(c.itens.some((i) => i.cod === '99001'), 'chá a granel com estoque e sem venda entra na contagem');
  assert.ok(!c.itens.some((i) => i.un !== 'Kg'));
  assert.deepStrictEqual(c.zerar.escopo, { kg: true });
  const r = INV.resto(INV.ler('l3', c.id), est3, cat3);
  assert.ok(r.every((i) => i.un === 'Kg'), 'o zerar nunca pega acessório nem lata');
  // "Alguns produtos" continua valendo para a loja inteira
  const c2 = INV.criar('l3', { cods: ['99001'], zerarResto: true }, 'ger', cat3, 'gerente').ok;
  assert.ok(INV.resto(INV.ler('l3', c2.id), est3, cat3).some((i) => i.cod === '99002'));
});

test('item da contagem que ninguém contou vai como 0 (contagens novas)', () => {
  const cat4 = INV.catalogo(estoque, tabela, vendas);
  const c = INV.criar('l4', { cods: ['31020', '31030'] }, 'ger', cat4, 'gerente').ok;
  assert.strictEqual(c.semContarZero, true);
  INV.contar('l4', c.id, '31020', 1.1, 'ger');
  const l = INV.linhasPlanilha(INV.ler('l4', c.id), estoque, cat4);
  const r = l.find((x) => x.cod === '31030');
  assert.ok(r, 'o rooibos não contado entra na planilha');
  assert.deepStrictEqual([r.nova, r.naoContado], [0, true]);
  // contagem antiga (sem a regra): o não contado fica de fora
  const antiga = { ...INV.ler('l4', c.id), semContarZero: undefined };
  assert.ok(!INV.linhasPlanilha(antiga, estoque, cat4).some((x) => x.cod === '31030'));
});

test('contagem aberta antes da regra nova: item não contado também vai como 0', () => {
  const C2 = require('../../src/config');
  const dir = path.join(C2.pastaLoja('lv'), 'inventario');
  fs.mkdirSync(dir, { recursive: true });
  const base = { id: 'aaaaaaaaaaaa', nome: 'Velha', criadoEm: new Date().toISOString(), st: 'revisao', zerar: { ativo: false }, itens: [{ cod: '1', desc: 'A', un: 'Kg', sis: 2, cont: 1 }, { cod: '2', desc: 'B', un: 'Kg', sis: 3, cont: null }] };
  fs.writeFileSync(path.join(dir, 'aaaaaaaaaaaa.json'), JSON.stringify(base));
  fs.writeFileSync(path.join(dir, 'bbbbbbbbbbbb.json'), JSON.stringify({ ...base, id: 'bbbbbbbbbbbb', st: 'importado' }));
  assert.equal(INV.ler('lv', 'aaaaaaaaaaaa').semContarZero, true);
  assert.equal(INV.ler('lv', 'bbbbbbbbbbbb').semContarZero, undefined);
});
