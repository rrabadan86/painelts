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
});

test('NAOQUER-03: quem responde "sair" no WhatsApp também sai na hora dos pendentes das listas (com a origem), sem esperar o robô chegar nele', async () => {
  const ZF = require('../../src/zapfila');
  const ZL = require('../../src/zaplaco');
  const loja = 'teste', cpf = '99988877766', outro = '12312312399';
  fs.writeFileSync(path.join(C.pastaLoja(loja), 'campanhas.json'), JSON.stringify([
    { id: 'd', nome: 'Resumo diário', rodadas: [{ id: 'r5', lista: [{ cpf, st: 'p' }, { cpf: outro, st: 'p' }] }] },
    { id: 'e', nome: 'Natal', rodadas: [{ id: 'r6', lista: [{ cpf, st: 'p' }] }] },
  ]));
  // o robô já mandou para esse número: é assim que o painel sabe de quem ele é
  ZF.gravarJson(loja, 'enviados', { '5562992763874': { cpf, em: '2026-11-23T19:42:00Z' } });
  const zap = { optouts: async () => ({ itens: [{ de: '5562992763874', em: '2026-11-23T20:35:00Z' }] }) };
  await ZL.lerOptouts(loja, Date.parse('2026-11-23T20:36:00Z'), zap);
  const j = JSON.parse(fs.readFileSync(path.join(C.pastaLoja(loja), 'campanhas.json'), 'utf8'));
  assert.deepStrictEqual([j[0].rodadas[0].lista[0].st, j[1].rodadas[0].lista[0].st], ['o', 'o']);
  assert.match(j[0].rodadas[0].lista[0].motivo, /respondeu parar pelo WhatsApp/);
  assert.strictEqual(j[0].rodadas[0].lista[0].por, 'robô');
  assert.strictEqual(j[0].rodadas[0].lista[1].st, 'p', 'outro cliente não muda');
  assert.strictEqual(ZF.lerContatos(loja)[cpf].optout, true, 'e fica "não quer mensagens" no cadastro');
  const aud = fs.readFileSync(path.join(pasta, 'auditoria.jsonl'), 'utf8');
  assert.ok(!aud.includes(cpf), 'auditoria sem o CPF completo');
  assert.ok(!aud.includes('5562992763874'), 'auditoria sem o número completo');
  fs.rmSync(pasta, { recursive: true, force: true });
});
