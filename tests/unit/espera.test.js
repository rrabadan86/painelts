// Lista de espera: produto → item do estoque, chegada pela nota de entrada, compra e "não comprou"
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'espera-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1' }], usuarios: {} }));
const E = require('../../src/espera');

const estoque = { em: '2026-11-01T10:00:00Z', itens: [{ cod: '27010', desc: 'African Sunset', un: 'Kg', qtd: 0 }, { cod: '5001', desc: 'Caneca Uki', un: 'Un', qtd: 0 },
  { cod: '31020', desc: 'Valeriana Garden', un: 'Kg', qtd: 0 }, { cod: '31029', desc: 'Valeriana Garden - Sache Piramidal', un: 'Un', qtd: 4 }] };

test('pacote de chá liga ao chá do estoque em kg (código + tamanho, ou pelo nome)', () => {
  assert.deepStrictEqual(E.codsEstoque({ cod: '270102', desc: 'African Sunset 100G' }, estoque), ['27010']);
  assert.deepStrictEqual(E.codsEstoque({ cod: null, desc: 'African Sunset 250G' }, estoque), ['27010']);
  assert.deepStrictEqual(E.codsEstoque({ cod: '5001', desc: 'Caneca Uki' }, estoque), ['5001']);
});

test('cliente sem o pacote ("valeriana") ou com o tamanho e sem código ("Valeriana 500g"): liga ao chá em kg', () => {
  assert.deepStrictEqual(E.codsEstoque({ desc: 'valeriana' }, estoque), ['31020']);
  assert.deepStrictEqual(E.codsEstoque({ desc: 'Valeriana 500g' }, estoque), ['31020']);
  assert.deepStrictEqual(E.codsEstoque({ desc: 'Valeriana Garden 500G' }, estoque), ['31020']);
});

test('pediu "valeriana" e comprou Valeriana Garden 100G: conta como levou o produto', () => {
  const a = E.criar('l1', { cliente: { nome: 'Cris', celular: '62977776666', cpf: '11122233344' }, itens: [{ desc: 'valeriana', generico: true }] }, 'gabi', estoque);
  assert.deepStrictEqual(a.ok.estoqueNomes, ['Valeriana Garden (kg)']);
  const hoje = new Date().toISOString().slice(0, 10);
  const notas = { notas: [{ nf: 99, entrada: hoje, itens: [{ cod: '31020', nome: 'Valeriana Garden', un: 'Kg', qtd: 2 }] }] };
  E.avaliar('l1', { notas, estoque, xml: [], fixe: [], vendas: [] });
  const p1 = E.ler('l1').pedidos.find((p) => p.id === a.ok.id);
  assert.strictEqual(p1.st, 'chegou');
  assert.match(p1.chegou.veio, /2 kg de Valeriana Garden/);
  E.avaliar('l1', { notas, estoque, xml: [{ cpf: '11122233344', cupom: 9001, data: hoje }], fixe: [], vendas: [{ cupom: 9001, data: hoje, descricao: 'Valeriana Garden 100G' }] });
  const p2 = E.ler('l1').pedidos.find((p) => p.id === a.ok.id);
  assert.deepStrictEqual([p2.st, p2.compra.levou], ['comprou', true]);
});

test('ciclo: esperando → chegou (NF) → avisado → comprou; e "não comprou" depois de 7 dias', () => {
  const a = E.criar('l1', { cliente: { nome: 'Ana Teste', celular: '62999998888', cpf: '12345678909' }, itens: [{ desc: 'African Sunset 100G', cod: '270102', qtd: 1 }] }, 'gabi', estoque);
  const b = E.criar('l1', { cliente: { nome: 'Bia Teste', celular: '62988887777', cpf: '98765432100' }, itens: [{ desc: 'African Sunset 50G', qtd: 2 }] }, 'gabi', estoque);
  assert.ok(a.ok && b.ok);
  assert.strictEqual(a.ok.zerado, true);
  const hoje = new Date().toISOString().slice(0, 10);
  const notas = { notas: [{ nf: 4512, serie: '1', entrada: hoje, fornecedor: 'Franquia', itens: [{ cod: '27010', nome: 'African Sunset' }] }] };
  const novos = E.avaliar('l1', { notas, estoque, xml: [], fixe: [], vendas: [] });
  assert.strictEqual(novos.length, 2);
  assert.strictEqual(E.ler('l1').pedidos.find((p) => p.id === a.ok.id).chegou.nf, '4512/1');
  E.acao('l1', a.ok.id, 'avisado', 'lya');
  E.acao('l1', b.ok.id, 'avisado', 'lya');
  // Ana comprou o produto; o aviso da Bia foi há 8 dias
  const d = E.ler('l1');
  d.pedidos.find((p) => p.id === b.ok.id).avisado.em = new Date(Date.now() - 8 * 864e5).toISOString();
  fs.writeFileSync(path.join(tmp, 'l1', 'espera.json'), JSON.stringify(d));
  E.avaliar('l1', { notas, estoque, xml: [{ cpf: '12345678909', cupom: 8770, data: hoje }], fixe: [], vendas: [{ cupom: 8770, data: hoje, descricao: 'African Sunset 100G' }] });
  const fim = E.ler('l1').pedidos;
  const pa = fim.find((p) => p.id === a.ok.id), pb = fim.find((p) => p.id === b.ok.id);
  assert.strictEqual(pa.st, 'comprou');
  assert.deepStrictEqual([pa.compra.cupom, pa.compra.levou], [8770, true]);
  assert.strictEqual(pb.st, 'naocomprou');
});

test('sem celular ou sem produto não salva', () => {
  assert.match(E.criar('l1', { cliente: { nome: 'X', celular: '123' }, itens: [{ desc: 'A' }] }, 'u', estoque).erro, /celular/);
  assert.match(E.criar('l1', { cliente: { nome: 'X', celular: '62999998888' }, itens: [] }, 'u', estoque).erro, /produto/);
});

test('trocar vendedora do pedido e registrar vendedora ao avisar', () => {
  const c = E.criar('l1', { cliente: { nome: 'Dani', celular: '62991112222' }, itens: [{ desc: 'Caneca Uki', cod: '5001' }] }, 'vendedora', estoque);
  assert.strictEqual(c.ok.vendedora, null);
  const r1 = E.acao('l1', c.ok.id, 'vendedora', 'vendedora', { vendedora: 'Lyandra' });
  assert.strictEqual(r1.ok.vendedora, 'Lyandra');
  const r2 = E.acao('l1', c.ok.id, 'avisado', 'vendedora', { vendedora: 'Gabrielly' });
  assert.strictEqual(r2.ok.avisado.vendedora, 'Gabrielly');
  assert.strictEqual(r2.ok.vendedora, 'Lyandra');
});

