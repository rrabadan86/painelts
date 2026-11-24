// "O que mudou no painel" (NOV-01…03): cada pessoa vê, uma vez, só as novidades que valem para o perfil e as telas dela;
// o servidor guarda até onde ela viu e só anda para a frente.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'novidades-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = require('./_porta')(6600, 60); // faixa só deste arquivo
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'senha-teste-123';
let srv, NOV;
const cookies = {};

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  const C = require('../../src/config');
  NOV = require('../../src/novidades');
  const senha = await C.hashSenhaAsync(SENHA);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja Um' }], usuarios: {
    dono1: { senha, perfil: 'franqueado', lojas: ['l1'], ativo: true },
    vend1: { senha, perfil: 'vendedor', lojas: ['l1'], ativo: true, vendedor: 'ANA' },
  } }));
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-novidades', NODE_ENV: 'test', COLETOR_URL: '', ZAP_URL: '' } });
  await require('./_subir')(srv, BASE);
  for (const n of ['dono1', 'vend1']) {
    const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `usuario=${n}&senha=${encodeURIComponent(SENHA)}` });
    cookies[n] = (r.headers.get('set-cookie') || '').split(';')[0];
  }
});
after(async () => {
  if (srv) { const fim = new Promise((ok) => srv.once('exit', ok)); srv.kill(); await fim; }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // dados temporários do teste: apaga
});

test('NOV-01: a lista é bem formada — ids únicos e em ordem, perfis válidos, tela que existe, sem custo nem dado de cliente', () => {
  const TELAS = require('../../src/telas').TODAS.map((t) => t.id);
  const ids = NOV.NOVIDADES.map((n) => n.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'ids únicos');
  const datas = NOV.NOVIDADES.map((n) => n.data);
  assert.deepStrictEqual([...datas].sort(), datas, 'em ordem de data (a nova sempre no fim)');
  for (const n of NOV.NOVIDADES) {
    assert.match(n.id, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
    assert.ok(n.id.startsWith(n.data), n.id);
    assert.ok(n.para === 'todos' || (Array.isArray(n.para) && n.para.every((p) => ['admin', 'franqueado', 'gerente', 'vendedor'].includes(p))), n.id);
    if (n.tela) assert.ok(TELAS.includes(n.tela), `${n.id}: tela ${n.tela}`);
    assert.ok(n.titulo && n.texto && n.texto.length <= 300, n.id);
    assert.doesNotMatch(n.texto + n.titulo, /custo|margem|\d{3}\.\d{3}\.\d{3}-\d{2}/i, `${n.id}: sem custo, margem nem CPF`);
  }
});

test('NOV-01: cada um vê só o seu — vendedora não vê o que é da gestão; gerente sem a tela não vê a novidade dela', () => {
  const ult = NOV.NOVIDADES[NOV.NOVIDADES.length - 1];
  const todasVend = NOV.paraPessoa({ perfil: 'vendedor' }, { todas: true });
  assert.ok(todasVend.every((n) => n.para === 'todos' || n.para.includes('vendedor')));
  assert.ok(!todasVend.some((n) => n.tela === 'clientes'));
  const ger = NOV.paraPessoa({ perfil: 'gerente' }, { todas: true, podeTela: (t) => t === 'site' });
  assert.ok(!ger.some((n) => n.tela === 'cupons'), 'gerente sem Cupons não vê a novidade dos cupons');
  assert.ok(ger.some((n) => n.tela === 'site'));
  // já viu a última: nada novo; sem registro: só os últimos dias
  assert.deepStrictEqual(NOV.paraPessoa({ perfil: 'franqueado', novidadesVisto: ult.id }), []);
  const longe = NOV.paraPessoa({ perfil: 'franqueado' }, { hoje: '2030-01-01' });
  assert.deepStrictEqual(longe, [], 'pessoa sem registro não recebe novidade antiga');
});

test('NOV-02: pelo servidor — a janela traz as da pessoa, "visto" guarda até onde viu (com X-Painel) e não volta para trás', async () => {
  const pedir = (n, url, opt = {}) => fetch(BASE + url, { ...opt, headers: { Cookie: cookies[n], 'Content-Type': 'application/json', ...(opt.headers || {}) } });
  const vend = await (await pedir('vend1', '/api/novidades')).json();
  assert.ok(vend.itens.every((n) => !/robô|campanha|cupons|site/i.test(n.titulo)), 'vendedora só vê o que vale para ela');
  const dono = await (await pedir('dono1', '/api/novidades?todas=1')).json();
  assert.ok(dono.itens.length >= 3);
  assert.strictEqual(dono.ultimo, NOV.ultimoId());
  assert.strictEqual((await pedir('dono1', '/api/novidades/visto', { method: 'POST', body: JSON.stringify({ ate: dono.ultimo }) })).status, 403, 'sem X-Painel');
  assert.strictEqual((await pedir('dono1', '/api/novidades/visto', { method: 'POST', headers: { 'X-Painel': '1' }, body: JSON.stringify({ ate: 'nao-existe' }) })).status, 400);
  assert.strictEqual((await pedir('dono1', '/api/novidades/visto', { method: 'POST', headers: { 'X-Painel': '1' }, body: JSON.stringify({ ate: dono.ultimo }) })).status, 200);
  assert.deepStrictEqual((await (await pedir('dono1', '/api/novidades')).json()).itens, [], 'depois de ver, a janela não abre de novo');
  // pedir para "voltar" a uma novidade antiga não desfaz
  await pedir('dono1', '/api/novidades/visto', { method: 'POST', headers: { 'X-Painel': '1' }, body: JSON.stringify({ ate: NOV.NOVIDADES[0].id }) });
  assert.strictEqual(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).usuarios.dono1.novidadesVisto, dono.ultimo);
  // pelo menu, as últimas continuam lá
  assert.ok((await (await pedir('dono1', '/api/novidades?todas=1')).json()).itens.length >= 3);
});
