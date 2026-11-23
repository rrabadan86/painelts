'use strict';
// CONV-RESP-01…04: responder pela conversa (fase 2, aprovada pelo dono em 23/11/2026). Só admin e franqueado da loja, com
// X-Painel; sai pelo número da loja (serviço do WhatsApp, /enviar); quem "não quer mensagens" pede confirmação; o texto nunca
// vai para log nem auditoria; a resposta aparece na conversa com quem respondeu.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resp-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = require('./_porta')(6400, 100); // faixa só deste arquivo
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'senha-teste-123';
const TOKEN = 'token-zap-teste';
const CHAVE = '5562999990001';
const CPF = '12345678909';
const TEXTO = 'Oi! Temos sim, separo para você? SEGREDO-DO-TEXTO';
let srv, zap;
const enviados = [];
const cookies = {};
let ipSeq = 60;
const postar = (nome, corpo, xp = true) => fetch(BASE + '/api/conversas/responder', { method: 'POST', headers: { Cookie: cookies[nome] || '', 'Content-Type': 'application/json', ...(xp ? { 'X-Painel': '1' } : {}) }, body: JSON.stringify(corpo) });

before(async () => {
  // serviço do WhatsApp de mentira: /enviar guarda o pedido e devolve o id da mensagem
  zap = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      if (req.headers['x-zap-token'] !== TOKEN) { res.writeHead(401); return res.end('{}'); }
      if (req.method === 'POST' && req.url === '/enviar/l1') { const j = JSON.parse(b || '{}'); enviados.push(j); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, idMsg: 'resp-msg-' + enviados.length })); }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}');
    });
  });
  await new Promise((ok) => zap.listen(0, '127.0.0.1', ok));
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  const C = require('../../src/config');
  const senha = await C.hashSenhaAsync(SENHA);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    lojas: [{ id: 'l1', nome: 'Loja Um', drive: {} }, { id: 'l2', nome: 'Loja Dois', drive: {} }],
    usuarios: {
      dono1: { senha, perfil: 'franqueado', lojas: ['l1'], ativo: true },
      dono2: { senha, perfil: 'franqueado', lojas: ['l2'], ativo: true },
      gercli: { senha, perfil: 'gerente', lojas: ['l1'], ativo: true, telas: ['clientes'], telasV: 8 },
      vend1: { senha, perfil: 'vendedor', lojas: ['l1'], ativo: true, vendedor: 'ANA' },
    },
  }));
  const pasta = path.join(tmp, 'l1', 'conversas');
  fs.mkdirSync(path.join(pasta, 'c'), { recursive: true });
  fs.writeFileSync(path.join(pasta, 'c', CHAVE + '.json'), JSON.stringify([
    { id: 'm1', deMim: false, em: '2026-11-23T10:00:00.000Z', tipo: 'texto', texto: 'tem jasmin?' },
    { id: 'resp-msg-1', deMim: true, em: '2026-11-23T10:05:00.000Z', tipo: 'texto', texto: TEXTO },
  ]));
  fs.writeFileSync(path.join(pasta, 'indice.json'), JSON.stringify({ [CHAVE]: { chave: CHAVE, n: 2, ult: { em: '2026-11-23T10:05:00.000Z', texto: 'x', deMim: true, tipo: 'texto' } }, 'lid:123456': { chave: 'lid:123456', n: 1, ult: { em: '2026-11-23T10:00:00.000Z', texto: 'x', deMim: false, tipo: 'texto' } } }));
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-resp', NODE_ENV: 'test', IA_FALSO: '1', ZAP_URL: `http://127.0.0.1:${zap.address().port}`, ZAP_TOKEN: TOKEN, COLETOR_URL: '', COLETOR_TOKEN: '', GITHUB_TOKEN: '' } });
  await require('./_subir')(srv, BASE);
  for (const nome of ['dono1', 'dono2', 'gercli', 'vend1']) {
    const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': `203.0.113.${ipSeq++}` }, body: `usuario=${nome}&senha=${encodeURIComponent(SENHA)}` });
    cookies[nome] = (r.headers.get('set-cookie') || '').split(';')[0];
  }
});
after(async () => {
  if (srv) { const fim = new Promise((ok) => srv.once('exit', ok)); srv.kill(); await fim; }
  if (zap) await new Promise((ok) => zap.close(ok));
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // dados temporários do teste: apaga
});

test('CONV-RESP-01: só admin e franqueado da loja, com X-Painel; nada chega ao WhatsApp sem permissão', async () => {
  assert.strictEqual((await postar('gercli', { loja: 'l1', chave: CHAVE, texto: TEXTO })).status, 403);
  assert.strictEqual((await postar('vend1', { loja: 'l1', chave: CHAVE, texto: TEXTO })).status, 403);
  assert.strictEqual((await postar('dono2', { loja: 'l1', chave: CHAVE, texto: TEXTO })).status, 400);
  assert.strictEqual((await postar('dono1', { loja: 'l1', chave: CHAVE, texto: TEXTO }, false)).status, 403, 'sem X-Painel');
  assert.strictEqual((await postar('dono1', { loja: 'l1', chave: CHAVE, texto: '   ' })).status, 400, 'texto vazio');
  assert.strictEqual((await postar('dono1', { loja: 'l1', chave: CHAVE, texto: 'x'.repeat(2001) })).status, 400, 'grande demais');
  assert.strictEqual((await postar('dono1', { loja: 'l1', chave: '5562999990009', texto: TEXTO })).status, 400, 'conversa que não existe');
  assert.strictEqual((await postar('dono1', { loja: 'l1', chave: 'lid:123456', texto: TEXTO })).status, 400, 'conversa sem número');
  assert.strictEqual(enviados.length, 0);
});

test('CONV-RESP-02: a resposta sai pelo número da conversa e aparece com quem respondeu; o texto não vai para a auditoria', async () => {
  const r = await postar('dono1', { loja: 'l1', chave: CHAVE, texto: TEXTO });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].para, CHAVE);
  assert.strictEqual(enviados[0].texto, TEXTO);
  assert.match(enviados[0].id, /^resp-[0-9a-f]{16}$/);
  const m = await (await fetch(BASE + `/api/conversas/mensagens?loja=l1&chave=${CHAVE}`, { headers: { Cookie: cookies.dono1 } })).json();
  assert.strictEqual(m.mensagens.find((x) => x.id === 'resp-msg-1').por, 'dono1');
  const aud = fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8');
  assert.match(aud, /respondeu uma conversa do WhatsApp/);
  assert.match(aud, /0001/);
  assert.ok(!aud.includes('SEGREDO-DO-TEXTO'), 'o texto não vai para a auditoria');
  assert.ok(!aud.includes(CHAVE), 'nem o número completo');
});

test('CONV-RESP-03: cliente que não quer mensagens pede confirmação antes de sair', async () => {
  fs.writeFileSync(path.join(tmp, 'l1', 'contatos.json'), JSON.stringify({ [CPF]: { optout: true } }));
  const antes = enviados.length;
  const r = await postar('dono1', { loja: 'l1', chave: CHAVE, texto: 'oi', cpf: CPF });
  assert.strictEqual(r.status, 409);
  assert.ok((await r.json()).confirmar);
  assert.strictEqual(enviados.length, antes, 'não saiu sem confirmar');
  assert.strictEqual((await postar('dono1', { loja: 'l1', chave: CHAVE, texto: 'oi', cpf: CPF, confirmado: true })).status, 200);
  assert.strictEqual(enviados.length, antes + 1);
});

test('CONV-RESP-04: apresentação responde sem enviar nada', async () => {
  const r = await fetch(BASE + '/api/demo/conversas/responder', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ chave: '5500999990001', texto: 'oi' }) });
  assert.strictEqual(r.status, 200);
  assert.ok((await r.json()).simulado);
});
