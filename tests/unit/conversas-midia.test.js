'use strict';
// CONV-14: mídia das conversas (foto, áudio, vídeo, documento) sob demanda — decisão do dono: "baixar no computador e não
// armazenar na VPS". O painel confere a permissão (só admin e franqueado da loja), que a mensagem é daquela conversa e é
// mídia, busca no serviço do WhatsApp na hora e repassa ao navegador sem gravar nada (no-store, nosniff); tipo que não é
// imagem/áudio/vídeo seguro só sai como download.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'midia-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = 6010 + Math.floor(Math.random() * 80); // faixa só deste arquivo
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'senha-teste-123';
const TOKEN = 'token-zap-teste';
const CHAVE = '5562999990001';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
let srv, zap, zapPorta;
const pedidosZap = [];
const cookies = {};
let ipSeq = 40;
const pedir = (nome, url) => fetch(BASE + url, { headers: { Cookie: cookies[nome] || '' } });
const arquivos = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String) : []);

before(async () => {
  // o serviço do WhatsApp de mentira: só responde /midia
  zap = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://zap');
    pedidosZap.push(u.pathname + u.search);
    if (req.headers['x-zap-token'] !== TOKEN) { res.writeHead(401); return res.end('{}'); }
    const id = u.searchParams.get('id');
    if (u.pathname !== '/midia/l1') { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ erro: 'Não existe.' })); }
    if (id === 'm-foto') { res.writeHead(200, { 'Content-Type': 'image/png', 'X-Zap-Nome': encodeURIComponent('SEGREDO.png') }); return res.end(PNG); }
    if (id === 'm-doc') { res.writeHead(200, { 'Content-Type': 'text/html', 'X-Zap-Nome': encodeURIComponent('boleto.html') }); return res.end('<script>alert(1)</script>'); }
    if (id === 'm-velha') { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ erro: 'Esta mídia não está mais disponível no WhatsApp.' })); }
    res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ erro: 'Esta mídia não está mais disponível no WhatsApp.' }));
  });
  await new Promise((ok) => zap.listen(0, '127.0.0.1', ok));
  zapPorta = zap.address().port;

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
  // uma conversa guardada (como src/conversas.js grava)
  const pasta = path.join(tmp, 'l1', 'conversas');
  fs.mkdirSync(path.join(pasta, 'c'), { recursive: true });
  const em = (h) => `2026-11-22T1${h}:00:00.000Z`;
  const msgs = [
    { id: 'm-texto', deMim: false, em: em(0), tipo: 'texto', texto: 'oi' },
    { id: 'm-foto', deMim: false, em: em(1), tipo: 'imagem', texto: '' },
    { id: 'm-doc', deMim: false, em: em(2), tipo: 'documento', texto: '' },
    { id: 'm-velha', deMim: false, em: em(3), tipo: 'audio', texto: '' },
  ];
  fs.writeFileSync(path.join(pasta, 'c', CHAVE + '.json'), JSON.stringify(msgs));
  fs.writeFileSync(path.join(pasta, 'indice.json'), JSON.stringify({ [CHAVE]: { chave: CHAVE, n: msgs.length, ult: { em: em(3), texto: '', deMim: false, tipo: 'audio' } } }));
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-midia', NODE_ENV: 'test', IA_FALSO: '1', ZAP_URL: `http://127.0.0.1:${zapPorta}`, ZAP_TOKEN: TOKEN, COLETOR_URL: '', COLETOR_TOKEN: '', GITHUB_TOKEN: '' } });
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

const url = (id, chave = CHAVE, loja = 'l1') => `/api/conversas/midia?loja=${loja}&chave=${chave}&id=${encodeURIComponent(id)}`;

test('CONV-14: só admin e franqueado da loja; gerente e vendedora 403, franqueado de outra loja 400 — e nem chega ao WhatsApp', async () => {
  const antes = pedidosZap.length;
  assert.strictEqual((await pedir('gercli', url('m-foto'))).status, 403);
  assert.strictEqual((await pedir('vend1', url('m-foto'))).status, 403);
  assert.strictEqual((await pedir('dono2', url('m-foto'))).status, 400);
  assert.strictEqual(pedidosZap.length, antes, 'sem permissão não pede nada ao serviço do WhatsApp');
});

test('CONV-14: a foto vem do WhatsApp na hora, sem cache e sem adivinhar tipo; nada fica gravado no painel', async () => {
  const antesArq = arquivos(tmp).sort();
  const r = await pedir('dono1', url('m-foto'));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/png');
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-disposition'), /^inline; filename="foto-\d\d-\d\d-\d{4}\.png"/);
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(PNG));
  assert.deepStrictEqual(arquivos(tmp).sort().filter((x) => !/auditoria|sessoes|\.log$/.test(x)), antesArq.filter((x) => !/auditoria|sessoes|\.log$/.test(x)), 'nenhum arquivo novo em dados/');
  assert.ok(!arquivos(tmp).some((x) => /png$|midia/i.test(x)), 'a mídia não é gravada');
  const aud = fs.existsSync(path.join(tmp, 'auditoria.jsonl')) ? fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8') : '';
  assert.ok(!aud.includes('SEGREDO') && !aud.includes('m-foto'), 'nada da mídia na auditoria');
});

test('CONV-14: tipo que não é imagem/áudio/vídeo seguro só sai como download (nunca abre como página)', async () => {
  const r = await pedir('dono1', url('m-doc'));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'application/octet-stream');
  assert.match(r.headers.get('content-disposition'), /^attachment;/);
});

test('CONV-14: mensagem de outra conversa, texto ou id inventado não chegam ao WhatsApp; mídia antiga devolve o motivo', async () => {
  const antes = pedidosZap.length;
  assert.strictEqual((await pedir('dono1', url('m-texto'))).status, 400, 'mensagem de texto não tem mídia');
  assert.strictEqual((await pedir('dono1', url('nao-existe'))).status, 404, 'id que não é desta conversa');
  assert.strictEqual((await pedir('dono1', url('m-foto', '5562999990002'))).status, 404, 'a mensagem não é de outra conversa');
  assert.strictEqual((await pedir('dono1', url('m-foto', '../etc'))).status, 400, 'chave inválida');
  assert.strictEqual(pedidosZap.length, antes, 'nenhum desses pedidos foi ao serviço do WhatsApp');
  const r = await pedir('dono1', url('m-velha'));
  assert.strictEqual(r.status, 404);
  assert.match((await r.json()).erro, /não está mais disponível no WhatsApp/);
});

test('CONV-14: apresentação devolve uma imagem desenhada (PNG) e áudio de silêncio, sem gravar nada', async () => {
  const fones = '5500999990001';
  let r = await fetch(BASE + `/api/demo/conversas/mensagens?chave=${fones}`);
  const msgs = (await r.json()).mensagens;
  const foto = msgs.find((m) => m.tipo === 'imagem');
  assert.ok(foto, 'a conversa de exemplo tem uma foto');
  r = await fetch(BASE + `/api/demo/conversas/midia?chave=${fones}&id=${foto.id}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/png');
  const b = Buffer.from(await r.arrayBuffer());
  assert.ok(b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
  r = await fetch(BASE + '/api/demo/conversas/midia?chave=5500911112222&id=d-s0');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'audio/wav');
});
