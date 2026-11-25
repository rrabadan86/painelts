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

// ---------- FIXO-ESC-01: onde o novo valor vale (pedido do dono, 25/11/2026) ----------
test('FIXO-ESC-01: aplicarFixo — só o mês, deste mês em diante (os meses antes ficam com o padrão da época) e todos os meses', () => {
  const D = { nome: 'Sist', valor: 285 };
  const L = { Sist: { '2026-03': { valor: 290 }, '2025-10': { valor: 280 } } };
  const meses = ['2025-10', '2025-12', '2026-01', '2026-03', '2026-06'];
  // só o mês
  let r = CT.aplicarFixo(D, L, '2026-01', 300, 'mes', meses);
  assert.deepStrictEqual(r.mudam, ['2026-01']);
  assert.strictEqual(r.padrao, 285);
  assert.strictEqual(L.Sist['2026-01'], undefined, 'não altera o objeto recebido');
  // deste mês em diante
  r = CT.aplicarFixo(D, L, '2026-01', 300, 'diante', meses);
  assert.strictEqual(r.padrao, 300);
  assert.deepStrictEqual(r.mudam, ['2026-01', '2026-03', '2026-06']);
  const D2 = { ...D, valor: r.padrao };
  assert.strictEqual(CT.fixoDoMes(D2, '2025-12', r.lancados).valor, 285, 'mês antes: o padrão que valia');
  assert.strictEqual(CT.fixoDoMes(D2, '2025-10', r.lancados).valor, 280, 'lançado antes do mês continua');
  assert.strictEqual(CT.fixoDoMes(D2, '2026-03', r.lancados).valor, 300, 'lançado do mês em diante dá lugar ao novo');
  // e de novo, mais para trás: o padrão de antes continua guardado
  const r2 = CT.aplicarFixo(D2, r.lancados, '2025-12', 310, 'diante', meses);
  const D3 = { ...D, valor: r2.padrao };
  assert.deepStrictEqual(meses.map((m) => CT.fixoDoMes(D3, m, r2.lancados).valor), [280, 310, 310, 310, 310]);
  // todos os meses
  r = CT.aplicarFixo(D3, r2.lancados, '2026-06', 250, 'todos', meses);
  assert.strictEqual(r.padrao, 250);
  assert.deepStrictEqual(r.lancados, {});
  assert.throws(() => CT.aplicarFixo(D, L, '2026-01', 1, 'outro'));
});

test('FIXO-ESC-01: rota — "deste mês em diante" e "todos os meses" mudam o padrão da loja, guardam o antigo e vão para a auditoria', async () => {
  let r = await lancar('ger_dre', { loja: 'l1', nome: 'Aluguel', ym: '2026-06', valor: 5500, escopo: 'diante' });
  assert.strictEqual(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.strictEqual(j.padrao, 5500);
  const est = await (await fetch(BASE + '/api/estoque?loja=l1', { headers: { Cookie: cookies.dono } })).json();
  const alu = est.cfg.outros.find((x) => x.nome === 'Aluguel');
  assert.strictEqual(alu.valor, 5500, 'o padrão de Configurações mudou');
  assert.strictEqual(CT.fixoDoMes(alu, '2026-05', est.cfg.fixosMes).valor, 5000, 'maio continua com o padrão antigo');
  assert.strictEqual(CT.fixoDoMes(alu, '2026-06', est.cfg.fixosMes).valor, 5500);
  assert.ok(est.cfg.fixosMes.Aluguel['@ate'][0].por, 'quem mudou fica guardado');
  r = await lancar('dono', { loja: 'l1', nome: 'Aluguel', ym: '2026-06', valor: 5200, escopo: 'todos' });
  assert.strictEqual(r.status, 200);
  const est2 = await (await fetch(BASE + '/api/estoque?loja=l1', { headers: { Cookie: cookies.dono } })).json();
  assert.strictEqual(est2.cfg.outros.find((x) => x.nome === 'Aluguel').valor, 5200);
  assert.strictEqual(est2.cfg.fixosMes.Aluguel, undefined);
  // recusas: escopo inválido, linha calculada só no mês, vendedora sem permissão
  assert.strictEqual((await lancar('dono', { loja: 'l1', nome: 'Aluguel', ym: '2026-06', valor: 1, escopo: 'xyz' })).status, 400);
  assert.strictEqual((await lancar('dono', { loja: 'l1', nome: '@simples', ym: '2026-06', valor: 1, escopo: 'todos' })).status, 400);
  assert.strictEqual((await lancar('vend', { loja: 'l1', nome: 'Aluguel', ym: '2026-06', valor: 1, escopo: 'todos' })).status, 403);
  const aud = fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8');
  assert.match(aud, /mudou o valor de um custo fixo \(deste mês em diante/);
  assert.match(aud, /mudou o valor de um custo fixo \(todos os meses/);
});

test('DESP-CAT-01: categoria de Simples, maquininha e comissões — padrão, escolha guardada e categoria que sumiu', () => {
  const ES = require('../../src/estoque');
  const cats = [{ id: 'func', nome: 'Funcionários' }, { id: 'outros', nome: 'Outros' }];
  assert.deepStrictEqual(CT.catVarDe(null, cats), { simples: 'impostos', cartao: 'taxas', comissao: 'func' });
  assert.deepStrictEqual(CT.catVarDe({ simples: 'func', cartao: 'naoexiste' }, cats), { simples: 'func', cartao: 'taxas', comissao: 'func' });
  assert.strictEqual(CT.catVarDe(null, [{ id: 'outros', nome: 'Outros' }]).comissao, 'outros', 'sem Funcionários, comissão vai para Outros');
  assert.deepStrictEqual(CT.catsEscolha(cats).map((c) => c.id), ['func', 'outros', 'impostos', 'taxas']);
  const base = { simplesPct: 6, cartaoPct: 2, entregaDias: 10, coberturaDias: 30, paradoDias: 60, segurancaPct: 50 };
  assert.deepStrictEqual(ES.validarCfg({ ...base, categorias: cats, catVar: { simples: 'func', comissao: 'x' } }).ok.catVar, { simples: 'func', cartao: 'taxas', comissao: 'func' });
  assert.deepStrictEqual(ES.cfg({ estoqueCfg: {} }).catVar, { simples: 'impostos', cartao: 'taxas', comissao: 'func' });
});

test('DRE-FIN-01: resultado financeiro aceita negativo (juros, tarifas) e positivo (rendimentos); as outras linhas não', async () => {
  const F = require('../../src/fixosmes');
  assert.deepStrictEqual(F.validar({ nome: '@financeiro', ym: '2026-10', valor: -85.4 }, [], '2026-11-25').ok, { nome: '@financeiro', ym: '2026-10', valor: -85.4 });
  assert.ok(F.validar({ nome: '@financeiro', ym: '2026-10', valor: 120 }, [], '2026-11-25').ok);
  assert.ok(F.validar({ nome: '@simples', ym: '2026-10', valor: -1 }, [], '2026-11-25').erro);
  const r = await lancar('dono', { loja: 'l1', nome: '@financeiro', ym: '2026-10', valor: -85.4 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await lancados())['@financeiro']['2026-10'].valor, -85.4);
});
