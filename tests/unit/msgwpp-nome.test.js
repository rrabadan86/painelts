// NOME-MSG-01: o nome nas mensagens de WhatsApp (campanhas, robô, Lista de espera, Orçamento) sai com a 1ª letra de cada
// nome e sobrenome em maiúscula, mesmo com o cadastro do FIXE todo em minúscula ou maiúscula (pedido do dono, 24/11/2026).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const M = require('../../public/js/msgwpp');

test('NOME-MSG-01: nomeProprio e primeiroNome corrigem maiúsculas, partículas, hífen, apóstrofo e sujeira do começo', () => {
  const casos = [
    ['rodrigo rabadan', 'Rodrigo Rabadan', 'Rodrigo'],
    ['RODRIGO RABADAN', 'Rodrigo Rabadan', 'Rodrigo'],
    ['  .rodrigo  rabadan ', 'Rodrigo Rabadan', 'Rodrigo'],
    ['maria DA silva', 'Maria da Silva', 'Maria'],
    ['joão dos santos e souza', 'João dos Santos e Souza', 'João'],
    ['ana-paula d\'ávila', 'Ana-Paula D\'Ávila', 'Ana-Paula'],
    ['ÉRICA', 'Érica', 'Érica'],
    ['', '', ''],
    [null, '', ''],
  ];
  for (const [n, completo, primeiro] of casos) {
    assert.strictEqual(M.nomeProprio(n), completo, JSON.stringify(n));
    assert.strictEqual(M.primeiroNome(n), primeiro, JSON.stringify(n));
  }
});

test('NOME-MSG-01: a tela e o robô usam a mesma função (campanhas, Lista de espera e Orçamento)', () => {
  const ler = (f) => fs.readFileSync(path.join(__dirname, '../../public/js', f), 'utf8');
  assert.match(ler('clientes.js'), /const primeiroNome = \(n\) => TS\.msgWpp\.primeiroNome\(n\)/);
  assert.match(ler('clientes.js'), /const nomeBonito = \(n\) => TS\.msgWpp\.nomeProprio\(n\)/);
  assert.match(ler('espera.js'), /TS\.msgWpp\.primeiroNome\(nome\)/);
  assert.match(ler('orcamento.js'), /TS\.msgWpp\.primeiroNome\(o\.cliente\.contato\)/);
});
