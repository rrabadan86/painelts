'use strict';
/* EXTRATO-01 (pedido do dono, 25/11/2026): leitura do Extrato de estoque do AppNext — só admin e o franqueado da loja pedem
   e veem o diagnóstico; o robô (coletor/nextsoft_extrato.py) só lê e tira os campos pessoais. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('EXTRATO-01: o robô só abre a tela (nunca clica em Salvar/Concluir/Homologar) e tira os campos pessoais', () => {
  const py = fs.readFileSync(path.join(__dirname, '../../coletor/nextsoft_extrato.py'), 'utf8');
  const codigo = py.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(codigo, /\.click\(|\.fill\(|\.press\(/, 'o robô do extrato não clica nem digita nada (o login é o do robô do caixa)');
  assert.match(py, /PESSOAL = re\.compile\(r"usuario\|.*cpf\|cnpj\|cliente/);
});

test('EXTRATO-01: rota só para admin/franqueado da loja (soGestor + lojaPermitida), auditada e com X-Painel pelo router', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/admin-api.js'), 'utf8');
  assert.match(src, /r\.post\('\/lojas\/:id\/extrato', soGestor, lojaPermitida/);
  assert.match(src, /r\.get\('\/lojas\/:id\/extrato', soGestor, lojaPermitida/);
  assert.match(src, /aud\(req, 'pediu a leitura do extrato de estoque'/);
  const col = fs.readFileSync(path.join(__dirname, '../../coletor/coletor.py'), 'utf8');
  assert.match(col, /if self\.path\.startswith\("\/extrato\/"\)/);
  assert.match(col, /tipo not in \("fixe", "saldos", "extrato"\) and job\["gatilho"\]/, 'o extrato não baixa estoque nem vendas junto');
});
