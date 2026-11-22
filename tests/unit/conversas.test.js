'use strict';
// Clientes → Conversas (decisão do dono): o que o painel guarda das conversas do WhatsApp da loja (src/conversas.js).
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conversas-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja Um' }], usuarios: {} }));
const CONV = require('../../src/conversas');
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const AGORA = Date.parse('2026-11-22T15:00:00Z');
const m = (id, o = {}) => ({ seq: 0, id, chat: '5562999990001', deMim: false, em: '2026-11-22T14:00:00Z', tipo: 'texto', texto: 'oi ' + id, nome: 'Ana', ...o });

test('CONV-03: guarda por conversa, sem repetir; índice com a última mensagem, o nome e as não lidas', () => {
  assert.strictEqual(CONV.aplicar('l1', [m('a1'), m('a2', { em: '2026-11-22T14:05:00Z' }), m('a1'), m('b1', { chat: 'lid:777777', em: '2026-11-22T13:00:00Z', tipo: 'audio', texto: '' }), m('x', { chat: '120@g.us' }), m('y', { tipo: 'chamada' })], AGORA), 3);
  assert.strictEqual(CONV.aplicar('l1', [m('a1')], AGORA), 0, 'o mesmo id de novo não entra');
  // a loja respondeu (pelo celular ou pelo robô): conta na conversa, não nas não lidas
  CONV.aplicar('l1', [m('a3', { deMim: true, em: '2026-11-22T14:10:00Z', texto: 'Temos sim!', nome: 'ignora' })], AGORA);
  const l = CONV.lista('l1');
  assert.deepStrictEqual(l.map((x) => x.chave), ['5562999990001', 'lid:777777'], 'mais recente primeiro');
  assert.deepStrictEqual({ n: l[0].n, nome: l[0].nome, naoLidas: l[0].naoLidas, ult: l[0].ult }, { n: 3, nome: 'Ana', naoLidas: 2, ult: { em: '2026-11-22T14:10:00.000Z', texto: 'Temos sim!', deMim: true, tipo: 'texto' } });
  assert.deepStrictEqual(CONV.mensagens('l1', '5562999990001').map((x) => x.id), ['a1', 'a2', 'a3'], 'em ordem de data');
  assert.strictEqual(CONV.mensagens('l1', '../../etc'), null, 'chave inválida não lê arquivo nenhum');
});

test('CONV-04: abrir marca como lida; mensagem nova do cliente volta a contar; o robô aparece com o nome da campanha', () => {
  assert.strictEqual(CONV.marcarLida('l1', '5562999990001', AGORA), true);
  assert.strictEqual(CONV.lista('l1')[0].naoLidas, 0);
  CONV.marcarRobo('l1', 'r1', 'Campanha Resumo diário', AGORA);
  CONV.aplicar('l1', [m('r1', { deMim: true, em: '2026-11-22T15:01:00Z', texto: 'Oi! Aqui é a Gabrielly' }), m('a4', { em: '2026-11-22T15:02:00Z' })], AGORA + 3 * 60e3);
  assert.strictEqual(CONV.lista('l1')[0].naoLidas, 1);
  const r = CONV.mensagens('l1', '5562999990001').find((x) => x.id === 'r1');
  assert.strictEqual(r.robo, 'Campanha Resumo diário');
});

test('CONV-05: busca no serviço de 500 em 500, recomeça se o serviço zerou a contagem, e guarda 12 meses', async () => {
  const lotes = { 0: { ultimo: 3, itens: [{ ...m('s1', { chat: '5562988887777' }), seq: 1 }, { ...m('s2', { chat: '5562988887777' }), seq: 2 }], mais: true }, 2: { ultimo: 3, itens: [{ ...m('s3', { chat: '5562988887777' }), seq: 3 }], mais: false } };
  const pedidos = [];
  const zap = { conversas: async (id, desde) => { pedidos.push(desde); return lotes[desde] || { ultimo: 3, itens: [], mais: false }; } };
  assert.strictEqual(await CONV.buscar('l1', zap, AGORA), 3);
  assert.deepStrictEqual(pedidos, [0, 2]);
  assert.strictEqual(CONV.lerEstado('l1').desde, 3);
  // o serviço perdeu a contagem (ultimo < desde): pede tudo de novo; os ids não deixam repetir
  pedidos.length = 0;
  const zap2 = { conversas: async (id, desde) => { pedidos.push(desde); return { ultimo: 1, itens: desde === 0 ? [{ ...m('s1', { chat: '5562988887777' }), seq: 1 }] : [], mais: false }; } };
  assert.strictEqual(await CONV.buscar('l1', zap2, AGORA + 1), 0);
  assert.deepStrictEqual(pedidos, [3, 0]);
  // passou de 12 meses: sai (a limpeza roda uma vez por dia)
  const daquiUmAno = AGORA + 380 * 864e5;
  await CONV.buscar('l1', { conversas: async () => ({ ultimo: 1, itens: [], mais: false }) }, daquiUmAno);
  assert.deepStrictEqual(CONV.lista('l1'), []);
});

test('CONV-06: desconectar apaga tudo da loja', () => {
  CONV.aplicar('l1', [m('z1')], AGORA);
  assert.ok(CONV.lista('l1').length);
  CONV.apagar('l1');
  assert.deepStrictEqual(CONV.lista('l1'), []);
  assert.strictEqual(fs.existsSync(path.join(tmp, 'l1', 'conversas')), false);
});
