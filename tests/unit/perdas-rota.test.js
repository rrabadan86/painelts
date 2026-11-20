// /api/perdas (linha "− Perdas" do Resultado) traz valores a custo: só para quem vê custo e só da loja da pessoa.
// Sobe o painel de verdade com um usuário de cada perfil.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perdas-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = 4300 + Math.floor(Math.random() * 200); // faixa só deste arquivo
const BASE = `http://127.0.0.1:${PORTA}`;
let srv;
const cookies = {};

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  const C = require('../../src/config');
  const senha = await C.hashSenhaAsync('senha-teste-123');
  const u = (perfil, extra) => ({ senha, perfil, lojas: ['l1'], ativo: true, ...extra });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    lojas: [{ id: 'l1', nome: 'Loja 1' }, { id: 'l2', nome: 'Loja 2 (de outro franqueado)' }],
    usuarios: {
      dono: u('franqueado'),
      ger_custo: u('gerente', { telas: ['resumo', 'estoque'], telasV: 8 }),
      ger_sem: u('gerente', { telas: ['resumo', 'mapa', 'validade', 'inventario'], telasV: 8 }),
      vend: u('vendedor', { vendedor: 'ANA' }),
    },
  }));
  // uma contagem aplicada com falta de R$ 50 a custo (2 un. a R$ 25) na loja 1
  const pasta = path.join(C.pastaLoja('l1'), 'inventario');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'abcdef012345.json'), JSON.stringify({ id: 'abcdef012345', nome: 'Acessórios', criadoEm: '2026-05-10T12:00:00.000Z', por: 'dono', cega: false, st: 'importado', importadoEm: '2026-05-10T15:00:00.000Z', itens: [],
    planilha: { em: '2026-05-10T14:00:00.000Z', por: 'dono', itens: [{ cod: '1', desc: 'Infusor', un: 'UN', antes: 5, nova: 3, custo: 25, zerado: false }] } }));
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-perdas', NODE_ENV: 'test' }, stdio: 'ignore' });
  for (let k = 0; k < 100; k++) { try { const r = await fetch(BASE + '/login'); if (r.status < 500) break; } catch { /* subindo */ } await new Promise((ok) => setTimeout(ok, 100)); }
  for (const nome of ['dono', 'ger_custo', 'ger_sem', 'vend']) {
    const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `usuario=${nome}&senha=senha-teste-123` });
    const c = (r.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(c.startsWith('ts_sess='), `login de ${nome}`);
    cookies[nome] = c;
  }
});
after(async () => {
  if (srv) { const fim = new Promise((ok) => srv.once('exit', ok)); srv.kill(); await fim; }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // dados temporários do teste: apaga
});

const pedir = (nome, url) => fetch(BASE + url, { headers: { Cookie: cookies[nome] } });

test('perdas a custo: franqueado e gerente com tela de custo recebem; gerente sem tela de custo e vendedora não', async () => {
  assert.strictEqual((await pedir('dono', '/api/perdas?loja=l1')).status, 200);
  assert.strictEqual((await pedir('ger_custo', '/api/perdas?loja=l1')).status, 200);
  assert.strictEqual((await pedir('ger_sem', '/api/perdas?loja=l1')).status, 403);
  assert.strictEqual((await pedir('vend', '/api/perdas?loja=l1')).status, 403);
});

test('perdas: só da loja da pessoa, e a falta do inventário aplicado entra no mês da contagem', async () => {
  assert.strictEqual((await pedir('dono', '/api/perdas?loja=l2')).status, 400, 'loja de outro franqueado');
  assert.strictEqual((await pedir('dono', '/api/perdas?loja=todas')).status, 400);
  const j = await (await pedir('dono', '/api/perdas?loja=l1')).json();
  assert.strictEqual(j.meses['2026-05'].inventario, 50);
  assert.strictEqual(j.meses['2026-05'].total, 50);
  assert.strictEqual(j.meses['2026-05'].nContagens, 1);
});
