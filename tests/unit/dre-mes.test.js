'use strict';
/* Valor real de cada custo fixo por mês no Resultado (pedido do dono, 23/11/2026): o valor de Configurações é o padrão,
   o lançado num mês fica só naquele mês e não muda quando o padrão muda. Conta única em public/js/contas.js
   (fixoDoMes, historicoFixo), guarda em src/fixosmes.js, rota POST /api/resultado/fixo-mes.
   Sobe o painel de verdade com um usuário de cada perfil. */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const CT = require('../../public/js/contas');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dre-mes-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = require('./_porta')(5400, 150); // faixa só deste arquivo
const BASE = `http://127.0.0.1:${PORTA}`;
let srv;
const cookies = {};
const LUZ = { nome: 'Luz', tipo: 'mes', valor: 400, aplica: 'tudo', cat: 'imovel' };
const ALUGUEL = { nome: 'Aluguel', tipo: 'mes', valor: 5000, aplica: 'tudo', cat: 'imovel' };

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  const C = require('../../src/config');
  const senha = await C.hashSenhaAsync('senha-teste-123');
  const u = (perfil, extra) => ({ senha, perfil, lojas: ['l1'], ativo: true, ...extra });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    lojas: [{ id: 'l1', nome: 'Loja 1', estoqueCfg: { outros: [LUZ, ALUGUEL] } }, { id: 'l2', nome: 'Loja 2 (de outro franqueado)', estoqueCfg: { outros: [LUZ] } }],
    usuarios: {
      dono: u('franqueado'),
      ger_dre: u('gerente', { telas: ['resumo', 'dre'], telasV: 8 }),
      ger_sem: u('gerente', { telas: ['resumo', 'estoque'], telasV: 8 }),
      vend: u('vendedor', { vendedor: 'ANA' }),
    },
  }));
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-dre-mes', NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'pipe'] });
  await require('./_subir')(srv, BASE);
  for (const nome of ['dono', 'ger_dre', 'ger_sem', 'vend']) {
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

const lancar = (nome, corpo, painel = true) => fetch(BASE + '/api/resultado/fixo-mes', { method: 'POST',
  headers: { Cookie: cookies[nome], 'Content-Type': 'application/json', ...(painel ? { 'X-Painel': '1' } : {}) }, body: JSON.stringify(corpo) });
const lancados = async (nome = 'dono') => { const r = await fetch(BASE + '/api/estoque?loja=l1', { headers: { Cookie: cookies[nome] } }); assert.strictEqual(r.status, 200); return (await r.json()).cfg.fixosMes; };

// ---------- a conta (função pura) ----------
test('DRE-MES-01: fixoDoMes usa o valor lançado do mês e, sem ele, o padrão de Configurações', () => {
  const L = { Luz: { '2026-10': { valor: 460, por: 'dono', em: '2026-11-02T10:00:00Z' } } };
  assert.deepStrictEqual(CT.fixoDoMes(LUZ, '2026-10', L), { valor: 460, padrao: 400, lancado: L.Luz['2026-10'] });
  assert.deepStrictEqual(CT.fixoDoMes(LUZ, '2026-09', L), { valor: 400, padrao: 400, lancado: null });
  assert.strictEqual(CT.fixoDoMes(ALUGUEL, '2026-10', L).valor, 5000, 'outro custo com o mesmo mês não é afetado');
  assert.strictEqual(CT.fixoDoMes(LUZ, '2026-10', null).valor, 400);
  // zero lançado vale (a loja não pagou naquele mês)
  assert.strictEqual(CT.fixoDoMes(LUZ, '2026-08', { Luz: { '2026-08': { valor: 0 } } }).valor, 0);
  // mudar o padrão muda o mês sem lançamento e não muda o lançado
  const luz500 = { ...LUZ, valor: 500 };
  assert.strictEqual(CT.fixoDoMes(luz500, '2026-09', L).valor, 500);
  assert.strictEqual(CT.fixoDoMes(luz500, '2026-10', L).valor, 460);
});

test('DRE-MES-02: historicoFixo mostra cada mês (lançado ou padrão) e a média', () => {
  const L = { Luz: { '2026-09': { valor: 380 }, '2026-10': { valor: 460 } } };
  const h = CT.historicoFixo(LUZ, ['2026-08', '2026-09', '2026-10'], L);
  assert.deepStrictEqual(h.itens.map((x) => [x.ym, x.valor, !!x.lancado]), [['2026-08', 400, false], ['2026-09', 380, true], ['2026-10', 460, true]]);
  assert.strictEqual(h.media, (400 + 380 + 460) / 3);
  assert.strictEqual(h.nLancados, 2);
  assert.strictEqual(CT.historicoFixo(LUZ, [], L).media, null);
});

// ---------- a rota ----------
test('DRE-MES-03: lança o valor real do mês, devolve na config da loja e guarda quem e quando', async () => {
  const r = await lancar('dono', { loja: 'l1', nome: 'Luz', ym: '2026-10', valor: 460.5 });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.fixosMes.Luz['2026-10'].valor, 460.5);
  const L = await lancados();
  assert.strictEqual(L.Luz['2026-10'].valor, 460.5);
  assert.strictEqual(L.Luz['2026-10'].por, 'dono');
  assert.ok(L.Luz['2026-10'].em);
  // gerente com a tela Resultado também lança
  assert.strictEqual((await lancar('ger_dre', { loja: 'l1', nome: 'Luz', ym: '2026-09', valor: 380 })).status, 200);
  assert.strictEqual((await lancados()).Luz['2026-09'].por, 'ger_dre');
  // auditado, sem o valor de outra coisa
  const aud = fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8').split('\n').filter((l) => l.includes('custo fixo'));
  assert.ok(aud.length >= 2, 'lançamento na auditoria');
});

test('DRE-MES-04: permissão — vendedora e gerente sem a tela Resultado recebem 403; outra loja é recusada', async () => {
  assert.strictEqual((await lancar('vend', { loja: 'l1', nome: 'Luz', ym: '2026-10', valor: 1 })).status, 403);
  assert.strictEqual((await lancar('ger_sem', { loja: 'l1', nome: 'Luz', ym: '2026-10', valor: 1 })).status, 403);
  assert.strictEqual((await lancar('dono', { loja: 'l2', nome: 'Luz', ym: '2026-10', valor: 1 })).status, 400, 'loja de outro franqueado');
  assert.strictEqual((await lancados()).Luz['2026-10'].valor, 460.5, 'nada mudou');
});

test('DRE-MES-05: sem o cabeçalho X-Painel não grava; valor, mês e custo são conferidos', async () => {
  assert.strictEqual((await lancar('dono', { loja: 'l1', nome: 'Luz', ym: '2026-10', valor: 1 }, false)).status, 403);
  for (const ruim of [{ valor: -1 }, { valor: 'abc' }, { valor: '' }, { ym: '2026-13' }, { ym: '26-10' }, { nome: 'Não existe' }, { ym: '2099-01' }]) {
    const r = await lancar('dono', { loja: 'l1', nome: 'Luz', ym: '2026-10', valor: 1, ...ruim });
    assert.strictEqual(r.status, 400, JSON.stringify(ruim));
    assert.ok((await r.json()).erro);
  }
  assert.strictEqual((await lancados()).Luz['2026-10'].valor, 460.5);
  // GET nunca muda estado
  assert.strictEqual((await fetch(BASE + '/api/resultado/fixo-mes', { headers: { Cookie: cookies.dono } })).status >= 400, true);
});

test('DRE-MES-06: voltar ao padrão apaga só o valor daquele mês', async () => {
  assert.strictEqual((await lancar('dono', { loja: 'l1', nome: 'Luz', ym: '2026-09', padrao: true })).status, 200);
  const L = await lancados();
  assert.strictEqual(L.Luz['2026-09'], undefined);
  assert.strictEqual(L.Luz['2026-10'].valor, 460.5);
  assert.strictEqual(CT.fixoDoMes(LUZ, '2026-09', L).valor, 400);
});

test('DRE-MES-07: mudar o padrão em Configurações não muda o mês lançado', async () => {
  const r = await fetch(BASE + '/api/estoque/cfg?loja=l1', { method: 'PUT', headers: { Cookie: cookies.dono, 'Content-Type': 'application/json', 'X-Painel': '1' },
    body: JSON.stringify({ entregaDias: 10, coberturaDias: 30, paradoDias: 60, simplesPct: 0, cartaoPct: 0, outros: [{ ...LUZ, valor: 520 }, ALUGUEL] }) });
  assert.strictEqual(r.status, 200);
  const j = await (await fetch(BASE + '/api/estoque?loja=l1', { headers: { Cookie: cookies.dono } })).json();
  const luz = j.cfg.outros.find((x) => x.nome === 'Luz');
  assert.strictEqual(luz.valor, 520);
  assert.strictEqual(CT.fixoDoMes(luz, '2026-10', j.cfg.fixosMes).valor, 460.5, 'o lançado fica');
  assert.strictEqual(CT.fixoDoMes(luz, '2026-08', j.cfg.fixosMes).valor, 520, 'mês sem lançamento segue o padrão novo');
});

test('DRE-MES-08: apresentação só confere e responde, sem gravar nada', async () => {
  const r = await fetch(BASE + '/api/demo/resultado/fixo-mes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ loja: 'x', nome: 'Sistemas', ym: '2026-10', valor: 700 }) });
  assert.strictEqual(r.status, 400, 'loja que não é da apresentação');
  const ok = await fetch(BASE + '/api/demo/resultado/fixo-mes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ loja: 'demo-centro', nome: 'Sistemas', ym: '2026-10', valor: 700 }) });
  assert.strictEqual(ok.status, 200);
  const j = await ok.json();
  assert.strictEqual(j.simulado, true);
  assert.strictEqual(j.fixosMes, undefined, 'nada gravado: a tela troca na memória');
  assert.ok(!fs.existsSync(path.join(tmp, 'demo-centro', 'fixos-mes.json')));
});
