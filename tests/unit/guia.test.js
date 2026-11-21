// Configuração guiada: o que conta como "pronto" em cada um dos 4 acessos e quando a janela abre sozinha
const { test } = require('node:test');
const assert = require('node:assert');
const G = require('../../src/guia');

test('situação: cada acesso só fica pronto com tudo o que ele precisa', () => {
  assert.deepStrictEqual(G.situacao({}), { appnext: false, pedido: false, fixe: false, email: false, nfe: false });
  assert.strictEqual(G.situacao({ env: { APPNEXT_USER: 'u' } }).appnext, false, 'sem senha não está pronto');
  assert.strictEqual(G.situacao({ env: { APPNEXT_USER: 'u', APPNEXT_PASS: 's' } }).appnext, true);
  assert.strictEqual(G.situacao({ pedido: { usuario: 'u', temSenha: false } }).pedido, false);
  assert.strictEqual(G.situacao({ pedido: { usuario: 'u', temSenha: true } }).pedido, true);
  const fx = { FIXE_URL: 'https://x', FIXE_USER: 'u', FIXE_PASS: 's' };
  assert.strictEqual(G.situacao({ env: fx }).fixe, false, 'falta o e-mail que recebe a exportação');
  assert.strictEqual(G.situacao({ env: { ...fx, FIXE_EMAIL: 'loja@gmail.com' } }).fixe, true);
  assert.strictEqual(G.situacao({ fechEmail: { email: { configurado: false } } }).email, false);
  assert.strictEqual(G.situacao({ fechEmail: { email: { configurado: true } } }).email, true);
});

test('abre sozinha: só franqueado, só se falta algo e só enquanto não viu', () => {
  const falta = { appnext: true, pedido: true, fixe: false, email: true }, pronto = { appnext: true, pedido: true, fixe: true, email: true };
  assert.deepStrictEqual(G.pendentes(falta), ['fixe']);
  assert.strictEqual(G.abreSozinha('franqueado', falta, false), true);
  assert.strictEqual(G.abreSozinha('franqueado', falta, true), false, 'já viu');
  assert.strictEqual(G.abreSozinha('franqueado', pronto, false), false, 'nada faltando');
  assert.strictEqual(G.abreSozinha('admin', falta, false), false);
  assert.strictEqual(G.abreSozinha('gerente', falta, false), false);
});

test('passo 5 (CFOP das notas) é opcional: pronto depois de salvo, mas nunca conta como pendente nem abre a janela', () => {
  const tudo = { env: { APPNEXT_USER: 'u', APPNEXT_PASS: 'p', FIXE_URL: 'x', FIXE_USER: 'u', FIXE_PASS: 'p', FIXE_EMAIL: 'e' }, pedido: { usuario: 'u', temSenha: true }, fechEmail: { email: { configurado: true } } };
  const sem = G.situacao(tudo);
  assert.strictEqual(sem.nfe, false);
  assert.deepStrictEqual(G.pendentes(sem), [], 'sem o CFOP não fica nada pendente');
  assert.strictEqual(G.abreSozinha('franqueado', sem, false), false, 'não abre a janela por causa dele');
  assert.strictEqual(G.situacao({ ...tudo, nfeCfop: { venda: '', devolucao: '' } }).nfe, true, 'salvo como automático já conta');
  assert.deepStrictEqual(G.OPCIONAIS, ['nfe']);
});
