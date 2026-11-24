// HOMOLOG-01: no painel de homologação (PAINEL_AMBIENTE=homologacao) nada sai do painel — sem coletor (AppNext/FIXE),
// sem robô do WhatsApp, sem e-mail, Telegram, notificação no aparelho, IA, GitHub nem leitura do e-mail da FIXE —,
// e a tela recebe o ambiente para mostrar a faixa amarela. Na produção, nada disso muda.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'homolog-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = require('./_porta')(6500, 80); // faixa só deste arquivo
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'senha-teste-123';
let srv, C;

const homolog = (sim) => { if (sim) process.env.PAINEL_AMBIENTE = 'homologacao'; else delete process.env.PAINEL_AMBIENTE; };
const ehHomolog = (e) => e && e.homolog === true && /homologação/.test(e.message);

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  C = require('../../src/config');
  const senha = await C.hashSenhaAsync(SENHA);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja Um' }], usuarios: { chefe: { senha, perfil: 'admin', lojas: ['*'], ativo: true } } }));
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-homolog', NODE_ENV: 'test', PAINEL_AMBIENTE: 'homologacao',
      COLETOR_URL: 'http://127.0.0.1:9', COLETOR_TOKEN: 'x', ZAP_URL: 'http://127.0.0.1:9', ZAP_TOKEN: 'x', GITHUB_TOKEN: '' } });
  await require('./_subir')(srv, BASE);
});
after(async () => {
  homolog(false);
  if (srv) { const fim = new Promise((ok) => srv.once('exit', ok)); srv.kill(); await fim; }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // dados temporários do teste: apaga
});

test('HOMOLOG-01: coletor e robô do WhatsApp ficam desligados mesmo com endereço e chave configurados', () => {
  process.env.COLETOR_URL = 'http://127.0.0.1:9'; process.env.COLETOR_TOKEN = 'x';
  process.env.ZAP_URL = 'http://127.0.0.1:9'; process.env.ZAP_TOKEN = 'x';
  const ZAP = require('../../src/zap');
  homolog(false);
  assert.strictEqual(ZAP.ativo(), true, 'produção: o robô funciona');
  homolog(true);
  assert.strictEqual(ZAP.ativo(), false, 'homologação: o robô nunca liga');
  // o coletor lê o endereço ao carregar: na homologação ele também fica desligado
  delete require.cache[require.resolve('../../src/coletor')];
  assert.strictEqual(require('../../src/coletor').ativo(), false);
  homolog(false);
  assert.strictEqual(require('../../src/coletor').ativo(), true, 'produção: o coletor funciona');
});

test('HOMOLOG-01: e-mail, Telegram, notificação no aparelho, IA, GitHub e e-mail da FIXE são recusados com a explicação', async () => {
  homolog(true);
  try {
    const NOTIF = require('../../src/notificacoes');
    await assert.rejects(NOTIF.enviarEmail('a@b.c', 'x', 'x', null, { host: 'smtp.exemplo', from: 'a@b.c' }), ehHomolog, 'e-mail');
    await assert.rejects(require('../../src/webpush').enviar({ endpoint: 'https://fcm.googleapis.com/x', keys: {} }, {}), ehHomolog, 'notificação');
    const IA = require('../../src/ia');
    await assert.rejects(IA.testar('sk-ant-teste'), ehHomolog, 'IA (teste da chave)');
    await assert.rejects(IA.mensagens('l1', {}), ehHomolog, 'IA');
    await assert.rejects(require('../../src/github').disparar({ repo: 'a/b', workflow: 'run.yml', ref: 'main' }), ehHomolog, 'GitHub');
    await assert.rejects(require('../../src/fixemail').verificar('l1', {}, async () => {}), ehHomolog, 'e-mail da FIXE');
    const r = await require('../../src/push').avisar({ tipo: 'zap', loja: 'l1', chave: 'teste-homolog', titulo: 't', texto: 't' });
    assert.strictEqual(r.homolog, true, 'aviso no aparelho: não envia nem marca a chave');
  } finally { homolog(false); }
  assert.doesNotThrow(() => C.travaHomolog('e-mail'), 'na produção a trava não faz nada');
});

test('HOMOLOG-01: o servidor de homologação avisa a tela (faixa amarela) e não mostra o coletor ligado', async () => {
  const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `usuario=chefe&senha=${encodeURIComponent(SENHA)}` });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('ts_sess='));
  const eu = await (await fetch(BASE + '/api/eu', { headers: { Cookie: cookie } })).json();
  assert.strictEqual(eu.ambiente, 'homologacao');
  const zap = await (await fetch(BASE + '/api/zap/situacao?loja=l1', { headers: { Cookie: cookie } })).json();
  assert.strictEqual(zap.servico, false, 'o robô do WhatsApp aparece como não instalado');
  // o admin pede a cópia da loja; o atualizador da VPS é quem copia (o painel só deixa o pedido)
  const cp = await fetch(BASE + '/api/admin/homolog/copiar', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ loja: 'goiania' }) });
  assert.strictEqual(cp.status, 200);
  assert.strictEqual(fs.readFileSync(path.join(tmp, '_sistema', 'copiar.pedido'), 'utf8'), 'goiania\n');
  assert.strictEqual((await fetch(BASE + '/api/admin/homolog/copiar', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ loja: '../x' }) })).status, 400);
  // HOMOLOG-03: liberar para a produção só a versão instalada aqui (o atualizador confere os testes e anota na produção)
  fs.writeFileSync(path.join(tmp, '_sistema', 'versao.txt'), `verificado\t${new Date().toISOString()}\natual\tabc1234\t2026-11-24T10:00:00-03:00\tCupons no celular\nambiente\thomologacao\n`);
  const lib = (corpo) => fetch(BASE + '/api/admin/homolog/liberar', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify(corpo) });
  assert.strictEqual((await lib({ sha: 'def5678' })).status, 409, 'outra versão: recusada');
  assert.ok(!fs.existsSync(path.join(tmp, '_sistema', 'liberar.pedido')));
  assert.strictEqual((await lib({ sha: 'abc1234' })).status, 200);
  assert.strictEqual(fs.readFileSync(path.join(tmp, '_sistema', 'liberar.pedido'), 'utf8'), 'chefe abc1234\n');
  // a tela mostra "liberação pedida" enquanto o atualizador não anota (pedido do dono: "clico e nada acontece")
  const sis = await (await fetch(BASE + '/api/admin/sistema', { headers: { Cookie: cookie } })).json();
  assert.strictEqual(sis.liberando, true);
  const sisJs = fs.readFileSync(path.join(__dirname, '../../public/js/sistema.js'), 'utf8');
  assert.match(sisJs, /Liberação da versão \$\{atual\.sha\} pedida/, 'o cartão mostra a liberação pedida');
  assert.match(sisJs, /liberada para a produção/, 'e depois a versão liberada, com o que fazer na produção');
  assert.strictEqual((await lib({ sha: 'abc1234' })).status, 409, 'pedido já feito');
  assert.ok(fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8').includes('liberou a versão da homologação para a produção'));
  const main = fs.readFileSync(path.join(__dirname, '../../public/js/main.js'), 'utf8');
  assert.match(main, /faixa-homolog/, 'a tela tem a faixa da homologação');
});
