// CFOP das NF-e que o robô emite: validação, o que vale para a loja, opções lidas do AppNext e o que chega ao robô
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfop-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1', nfeCfop: { venda: '5405', devolucao: '6202' } }, { id: 'l2', nome: 'Loja 2' }, { id: 'l3', nome: 'Loja 3', nfeCfop: { venda: '1102', devolucao: 'x' } }], usuarios: {} }));
const F = require('../../src/nfecfop');

test('NFE-CFOP-01: só CFOP de saída de 4 números (5 dentro do estado, 6 fora) ou vazio = automático', () => {
  assert.deepStrictEqual(F.validar({ venda: '5102', devolucao: '' }), { ok: { venda: '5102', devolucao: '' } });
  assert.deepStrictEqual(F.validar({ venda: '5.102', devolucao: '6202' }), { ok: { venda: '5102', devolucao: '6202' } }, 'aceita com ponto');
  assert.deepStrictEqual(F.validar({}), { ok: { venda: '', devolucao: '' } });
  for (const ruim of ['1102', '2202', '510', '51020', 'abc', '7102']) assert.match(F.validar({ venda: ruim }).erro || '', /inválido/, ruim);
  assert.match(F.validar({ devolucao: '1202' }).erro, /devolução/);
});

test('NFE-CFOP-02: o que vale para a loja (sem configuração = automático; valor estranho gravado à mão = automático)', () => {
  assert.deepStrictEqual(F.daLoja('l1'), { venda: '5405', devolucao: '6202' });
  assert.deepStrictEqual(F.daLoja('l2'), { venda: '', devolucao: '' });
  assert.deepStrictEqual(F.daLoja('l3'), { venda: '', devolucao: '' });
  assert.deepStrictEqual(F.daLoja('nao-existe'), { venda: '', devolucao: '' });
});

test('NFE-CFOP-03: as opções são os CFOPs de saída que o robô leu do AppNext, sem repetir e em ordem', () => {
  const op = F.opcoes({ cfops: [{ codigo: '6202', descricao: 'Devolução fora' }, { codigo: '5102', descricao: 'Venda' }, { codigo: '1102', descricao: 'Compra' }, { codigo: '5102', descricao: 'dup' }, null] });
  assert.deepStrictEqual(op, [{ codigo: '5102', descricao: 'Venda' }, { codigo: '6202', descricao: 'Devolução fora' }]);
  assert.deepStrictEqual(F.opcoes(null), []);
});

test('NFE-CFOP-04: o robô recebe o CFOP e usa só ele (venda e devolução); sem escolha, continua 5102 / regra da loja', () => {
  const py = fs.readFileSync(path.join(__dirname, '../../coletor/nextsoft_nfe.py'), 'utf8');
  assert.match(py, /const cfopCod = p\.cfop \|\| '5102';/, 'venda: o escolhido ou 5102');
  assert.match(py, /if \(p\.cfop\) \{[\s\S]{0,400}nunca usa outro[\s\S]{0,400}cfopEscolhido = so\[0\];\s*\} else if \(cfops\.length > 1\)/, 'devolução: só o escolhido; sem escolha, a regra de antes');
  assert.match(py, /cfops: \(sl\.cfops \|\| \[\]\)/, 'cadastros trazem os CFOPs');
  const nfe = fs.readFileSync(path.join(__dirname, '../../src/nfe.js'), 'utf8'), dev = fs.readFileSync(path.join(__dirname, '../../src/devolucao.js'), 'utf8');
  assert.match(nfe, /cfop: require\('\.\/nfecfop'\)\.daLoja\(id\)\.venda \|\| undefined/);
  assert.match(dev, /cfop: require\('\.\/nfecfop'\)\.daLoja\(id\)\.devolucao \|\| undefined/);
});
