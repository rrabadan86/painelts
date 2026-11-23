// NAOQUER-01: cliente marcado como "não quer mensagens" sai na hora dos pendentes de todas as listas de campanha
// (quem já recebeu continua no histórico; grupo de comparação não muda), e a resposta diz de quais campanhas saiu.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'naoquer-'));
process.env.DATA_DIR = pasta;
process.env.CONFIG_FILE = path.join(pasta, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'teste', nome: 'Loja teste' }], usuarios: {} }));
const C = require('../../src/config');
const CAMP = require('../../src/campanhas');

test('NAOQUER-01: tirarNaoQuer marca st "o" só nos pendentes do cliente e devolve os nomes das campanhas', () => {
  const loja = 'teste';
  const arq = path.join(C.pastaLoja(loja), 'campanhas.json');
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const cpf = '11122233344', outro = '55566677788';
  fs.writeFileSync(arq, JSON.stringify([
    { id: 'a', nome: 'Black Friday', rodadas: [{ id: 'r1', lista: [{ cpf, st: 'p' }, { cpf: outro, st: 'p' }] }] },
    { id: 'b', nome: 'Aniversário', rodadas: [{ id: 'r2', lista: [{ cpf, st: 'e', em: '2026-11-01T10:00:00Z' }] }] },
    { id: 'c', nome: 'Pontos', rodadas: [{ id: 'r3', lista: [{ cpf, st: 'c' }] }, { id: 'r4', lista: [{ cpf, st: 'p' }] }] },
  ]));
  const nomes = CAMP.tirarNaoQuer(loja, cpf, 'dono');
  assert.deepStrictEqual(nomes, ['Black Friday', 'Pontos']);
  const j = JSON.parse(fs.readFileSync(arq, 'utf8'));
  assert.strictEqual(j[0].rodadas[0].lista[0].st, 'o');
  assert.strictEqual(j[0].rodadas[0].lista[0].por, 'dono');
  assert.strictEqual(j[0].rodadas[0].lista[1].st, 'p', 'outro cliente não muda');
  assert.strictEqual(j[1].rodadas[0].lista[0].st, 'e', 'quem já recebeu fica no histórico');
  assert.strictEqual(j[2].rodadas[0].lista[0].st, 'c', 'grupo de comparação não muda');
  assert.strictEqual(j[2].rodadas[1].lista[0].st, 'o');
  assert.deepStrictEqual(CAMP.tirarNaoQuer(loja, cpf, 'dono'), [], 'de novo: não estava mais em nenhuma');
  fs.rmSync(pasta, { recursive: true, force: true });
});
