// Notificações e aplicativo, pelo painel de verdade: o que é público (manifesto, service worker, ícones), as tags em todas as telas
// e as rotas /api/push (cada pessoa só vê e mexe nos próprios aparelhos; nada de chave nem endereço na resposta).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'push-rotas-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = 6000 + Math.floor(Math.random() * 200); // faixa só deste arquivo
const BASE = `http://127.0.0.1:${PORTA}`;
let srv;
const cookies = {};
const pedir = (nome, url, opt = {}) => fetch(BASE + url, { redirect: 'manual', ...opt, headers: { Cookie: cookies[nome] || '', 'X-Painel': '1', 'Content-Type': 'application/json', ...(opt.headers || {}) } });
const aparelho = (n) => { const e = crypto.createECDH('prime256v1'); e.generateKeys(); return { endpoint: `https://fcm.googleapis.com/fcm/send/rota-${n}`, keys: { p256dh: e.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } }; };

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  const C = require('../../src/config');
  const senha = await C.hashSenhaAsync('senha-teste-123');
  const u = (perfil, extra) => ({ senha, perfil, lojas: ['l1'], ativo: true, ...extra });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1' }], usuarios: { dono: u('franqueado'), vend: u('vendedor', { vendedor: 'ANA' }), novo: u('gerente', { trocarSenha: true }) } }));
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-push', NODE_ENV: 'test', SITE_CONTATO: 'https://exemplo.com/contato?a=1&b=2', COLETOR_URL: '', GITHUB_TOKEN: '' }, stdio: ['ignore', 'ignore', 'pipe'] });
  // no GitHub, com os outros arquivos subindo servidor ao mesmo tempo, já passou de 30 s: espera até 90 s, para na hora se o
  // servidor cair e mostra o erro dele (antes ficava só "fetch failed", sem pista)
  let saida = '', caiu = null, subiu = false;
  srv.stderr.on('data', (d) => { saida = (saida + d).slice(-4000); });
  srv.once('exit', (c) => { caiu = c; });
  for (let k = 0; k < 900 && caiu === null; k++) { try { const r = await fetch(BASE + '/login'); if (r.status < 500) { subiu = true; break; } } catch { /* subindo */ } await new Promise((ok) => setTimeout(ok, 100)); }
  assert.ok(subiu, `o servidor de teste não subiu na porta ${PORTA}${caiu !== null ? ` (saiu com código ${caiu})` : ' em 90 s'}:\n${saida}`);
  let ip = 10;
  for (const nome of ['dono', 'vend', 'novo']) {
    const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': `203.0.113.${ip++}` }, body: `usuario=${nome}&senha=senha-teste-123` });
    cookies[nome] = (r.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookies[nome].startsWith('ts_sess='), `login de ${nome}`);
  }
});
after(async () => {
  if (srv) { const fim = new Promise((ok) => srv.once('exit', ok)); srv.kill(); await fim; }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // dados temporários do teste: apaga
});

test('sem login: manifesto, service worker e ícones são públicos; o resto continua fechado', async () => {
  const m = await fetch(BASE + '/manifest.webmanifest');
  assert.strictEqual(m.status, 200);
  assert.match(m.headers.get('content-type'), /application\/manifest\+json/);
  const j = await m.json();
  assert.deepStrictEqual({ start_url: j.start_url, scope: j.scope, display: j.display }, { start_url: '/', scope: '/', display: 'standalone' });
  assert.ok(j.name && j.short_name && /^#[0-9A-F]{6}$/i.test(j.theme_color) && /^#[0-9A-F]{6}$/i.test(j.background_color));
  assert.deepStrictEqual(j.icons.map((i) => `${i.sizes} ${i.purpose} ${i.type}`), ['192x192 any image/png', '512x512 any image/png', '512x512 maskable image/png']);
  // cada ícone existe, é PNG e tem o tamanho declarado (largura e altura ficam no cabeçalho IHDR)
  const tamanho = async (url) => { const r = await fetch(BASE + url); assert.strictEqual(r.status, 200, url); assert.match(r.headers.get('content-type'), /image\/png/); const b = Buffer.from(await r.arrayBuffer()); assert.strictEqual(b.subarray(1, 4).toString(), 'PNG'); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; };
  for (const i of j.icons) assert.strictEqual(await tamanho(i.src), i.sizes, i.src);
  assert.strictEqual(await tamanho('/icones/apple-touch-icon.png'), '180x180');
  assert.strictEqual(await tamanho('/icones/selo-96.png'), '96x96');
  const sw = await fetch(BASE + '/sw.js');
  assert.strictEqual(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
  assert.match(sw.headers.get('cache-control'), /no-cache/);
  assert.match(await sw.text(), /addEventListener\('push'/);
  // fechado: as rotas das notificações, outros arquivos da pasta e os arquivos de configuração
  assert.strictEqual((await fetch(BASE + '/api/push')).status, 401);
  for (const url of ['/icones/outro.png', '/icones/../server.js', '/config/push-vapid.json', '/push-vapid.json', '/config/push.json']) assert.notStrictEqual((await fetch(BASE + url, { redirect: 'manual' })).status, 200, url);
});

test('todas as telas trazem o manifesto, a cor do tema e o ícone do iPhone (login, troca de senha e painel)', async () => {
  for (const [nome, url] of [['', '/login'], ['dono', '/'], ['novo', '/trocar-senha?primeiro=1'], ['', '/apresentacao']]) {
    const r = await pedir(nome, url);
    assert.strictEqual(r.status, 200, url);
    const h = await r.text();
    assert.match(h, /<link rel="manifest" href="\/manifest\.webmanifest">/, url);
    assert.match(h, /<meta name="theme-color" content="#1F3D2B">/, url);
    assert.match(h, /<link rel="apple-touch-icon" href="\/icones\/apple-touch-icon\.png">/, url);
  }
});

test('rotas: só os próprios aparelhos; resposta sem chave nem endereço; X-Painel obrigatório; endereço desconhecido recusado', async () => {
  let r = await pedir('dono', '/api/push');
  let j = await r.json();
  assert.strictEqual(Buffer.from(j.chave, 'base64url').length, 65, 'só a parte pública da chave VAPID');
  assert.deepStrictEqual(j.tipos.map((t) => t.id), ['espera', 'validade', 'sugestao', 'zap']);
  assert.deepStrictEqual(j.aparelhos, []);
  assert.deepStrictEqual((await (await pedir('vend', '/api/push')).json()).tipos.map((t) => t.id), ['espera', 'validade'], 'vendedora: só as telas fixas dela');
  // a chave privada fica no arquivo, fora do git, e nunca na resposta
  const v = JSON.parse(fs.readFileSync(path.join(tmp, 'push-vapid.json'), 'utf8'));
  assert.strictEqual(v.publica, j.chave);
  assert.ok(v.privada && !JSON.stringify(j).includes(v.privada));
  const a = aparelho(1);
  assert.strictEqual((await pedir('dono', '/api/push/aparelhos', { method: 'POST', body: JSON.stringify(a), headers: { 'X-Painel': '' } })).status, 403, 'sem X-Painel');
  r = await pedir('dono', '/api/push/aparelhos', { method: 'POST', body: JSON.stringify({ ...a, endpoint: 'https://painel.interno/admin' }) });
  assert.strictEqual(r.status, 400); assert.match((await r.json()).erro, /não conhece/);
  assert.strictEqual((await pedir('dono', '/api/push/aparelhos', { method: 'POST', body: JSON.stringify({ endpoint: a.endpoint, keys: { p256dh: 'x', auth: 'y' } }) })).status, 400);
  r = await pedir('dono', '/api/push/aparelhos', { method: 'POST', body: JSON.stringify(a), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36' } });
  assert.strictEqual(r.status, 200);
  j = await r.json();
  assert.strictEqual(j.aparelhos.length, 1); assert.strictEqual(j.aparelhos[0].nome, 'Chrome no Windows');
  const txt = JSON.stringify(j) + JSON.stringify(await (await pedir('dono', '/api/push')).json());
  assert.ok(!txt.includes('fcm.googleapis') && !txt.includes(a.keys.p256dh) && !txt.includes(a.keys.auth) && !txt.includes('endpoint'), 'a tela não recebe endereço nem chave');
  const id = j.aparelhos[0].id;
  // a vendedora não vê, não muda, não testa e não remove o aparelho do dono
  assert.deepStrictEqual((await (await pedir('vend', '/api/push')).json()).aparelhos, []);
  assert.strictEqual((await pedir('vend', `/api/push/aparelhos/${id}`, { method: 'PUT', body: JSON.stringify({ tipos: [] }) })).status, 404);
  assert.strictEqual((await pedir('vend', `/api/push/aparelhos/${id}`, { method: 'DELETE' })).status, 404);
  assert.notStrictEqual((await pedir('vend', '/api/push/teste', { method: 'POST', body: JSON.stringify({ id }) })).status, 200);
  assert.strictEqual((await (await pedir('dono', '/api/push')).json()).aparelhos.length, 1);
  // o dono muda os tipos e remove
  j = await (await pedir('dono', `/api/push/aparelhos/${id}`, { method: 'PUT', body: JSON.stringify({ tipos: ['zap', 'inventado'] }) })).json();
  assert.deepStrictEqual(j.aparelhos[0].tipos, ['zap']);
  assert.strictEqual((await pedir('dono', `/api/push/aparelhos/${id}`, { method: 'DELETE' })).status, 200);
  assert.deepStrictEqual((await (await pedir('dono', '/api/push')).json()).aparelhos, []);
  // quem ainda está com a senha provisória não ativa nada
  assert.strictEqual((await pedir('novo', '/api/push')).status, 403);
  // ativar e remover ficam na auditoria, sem endereço nem chave
  const aud = fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8');
  assert.match(aud, /ativou as notificações num aparelho/);
  assert.ok(!aud.includes('fcm.googleapis') && !aud.includes(a.keys.auth));
});

test('SITE-01: site público (/site e /site/tecnico) abre sem login, sem script, com o botão de contato do .env e o link da apresentação', async () => {
  for (const url of ['/site', '/site/', '/site/tecnico']) {
    const r = await fetch(BASE + url, { redirect: 'manual' });
    assert.strictEqual(r.status, 200, url);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.strictEqual(r.headers.get('x-robots-tag'), 'noindex');
    const h = await r.text();
    assert.ok(!/<script/i.test(h), url + ': página fixa, sem JavaScript');
    assert.ok(h.includes('href="/apresentacao"'), url + ': leva à apresentação');
    assert.ok(h.includes('href="https://exemplo.com/contato?a=1&amp;b=2"'), url + ': contato do SITE_CONTATO');
    assert.ok(!h.includes('<!--CONTATO-->'));
    assert.ok(!/@(gmail|hotmail|outlook)\./i.test(h), url + ': sem e-mail pessoal');
  }
  assert.match((await fetch(BASE + '/site/site.css')).headers.get('content-type'), /text\/css/);
  const img = await fetch(BASE + '/site/img/cel-inicio.jpg');
  assert.strictEqual(img.status, 200);
  assert.match(img.headers.get('content-type'), /image\/jpeg/);
  // só os arquivos do site: nada mais da pasta fica público
  assert.notStrictEqual((await fetch(BASE + '/site/img/../../index.html', { redirect: 'manual' })).status, 200);
  assert.strictEqual((await fetch(BASE + '/site/outra', { redirect: 'manual' })).status, 302, 'o resto continua pedindo login');
  assert.ok((await (await fetch(BASE + '/login')).text()).includes('href="/site"'), 'a tela de entrar leva ao site');
});
