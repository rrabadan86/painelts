// META-VEND-01 — a vendedora vê a parte DELA da meta de hoje (Minha comissão), com a conta feita no servidor pelas mesmas
// definições da tela (contas.js + metadia.js), sem receber a meta da loja, o faturamento nem as colegas.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const MH = require('../../src/metahoje');

// ---------- a conta (pura) ----------
const HOJE = '2026-11-20'; // sexta
const linha = (data, vendedor, vt, grupoC = 'CHÁ AROMATIZADO', cat = 'CHÁ') => ({ data, vendedor, vt, grupoC, cat, descricao: 'Chá', vu: vt, qtd: 1, cupom: data + vendedor });
function vendasExemplo() {
  const v = [];
  // últimos 30 dias: ANA, BIA e CAROL vendem; DUDA vendeu pouco (< 3%) e não entra
  for (let d = 1; d <= 19; d++) {
    const iso = `2026-11-${String(d).padStart(2, '0')}`;
    v.push(linha(iso, 'ANA', 100), linha(iso, 'BIA', 100), linha(iso, 'CAROL', 100));
  }
  v.push(linha('2026-11-05', 'DUDA', 10));
  v.push(linha('2026-11-10', 'ANA', 500, 'ESPAÇO GOURMET', 'ESPAÇO GOURMET')); // Espaço Gourmet não conta para a meta
  v.push(linha(HOJE, 'ANA', 80), linha(HOJE, 'BIA', 50));
  return v;
}
const LOJA = { id: 'l1', nome: 'Loja Um', metas: { '2026-11': 10000 }, ferias: [{ vendedor: 'CAROL', de: '2026-11-18', ate: '2026-11-25' }] };

test('META-VEND-01: a meta de hoje usa as vendas da meta até ontem e os dias de loja aberta que faltam', () => {
  const r = MH.calcular({ loja: LOJA, vendas: vendasExemplo(), metaPlanilha: null, hoje: HOJE });
  // até ontem: 19 dias × 300 + DUDA 10 = 5.710 (o Espaço Gourmet fica de fora)
  assert.strictEqual(r.ateOntem, 5710);
  assert.strictEqual(r.falta, 4290);
  assert.strictEqual(r.restam, 11); // 20 a 30 de novembro, sem horário cadastrado = todos abertos
  assert.ok(Math.abs(r.metaHoje - 4290 / 11) < 1e-9);
  assert.strictEqual(r.temHoje, true);
  assert.strictEqual(r.vendHoje, 130);
  // partes iguais entre quem vendeu ≥ 3% e não está de férias: ANA e BIA (CAROL de férias, DUDA abaixo de 3%)
  assert.deepStrictEqual(r.divisao.partes.map((p) => p.nome), ['ANA', 'BIA']);
  assert.strictEqual(r.divisao.modo, 'igual');
});

test('META-VEND-01: a vendedora recebe só a parte dela (sem a meta da loja, o faturamento nem as colegas)', () => {
  const r = MH.calcular({ loja: LOJA, vendas: vendasExemplo(), metaPlanilha: null, hoje: HOJE });
  const ana = MH.daVendedora(r, 'ana');
  assert.deepStrictEqual(Object.keys(ana).sort(), ['minhaParte', 'modo', 'restam', 'semParte', 'temHoje', 'vendiHoje']);
  assert.strictEqual(ana.minhaParte, Math.round((4290 / 11 / 2) * 100) / 100);
  assert.strictEqual(ana.vendiHoje, 80);
  const texto = JSON.stringify(ana);
  for (const proibido of ['BIA', 'CAROL', 'DUDA', '10000', '4290', '130']) assert.ok(!texto.includes(proibido), `não pode trazer ${proibido}`);
  assert.strictEqual(MH.daVendedora(r, 'CAROL').semParte, 'ferias');
  assert.strictEqual(MH.daVendedora(r, 'DUDA').semParte, 'sem-vendas');
  assert.strictEqual(MH.daVendedora(r, 'DUDA').minhaParte, null);
});

test('META-VEND-01: sem as vendas de hoje, não diz quanto ela vendeu; sem meta no mês, não há conta', () => {
  const semHoje = vendasExemplo().filter((v) => v.data !== HOJE);
  const r = MH.calcular({ loja: LOJA, vendas: semHoje, metaPlanilha: null, hoje: HOJE });
  assert.strictEqual(r.temHoje, false);
  assert.strictEqual(MH.daVendedora(r, 'ANA').vendiHoje, null);
  assert.strictEqual(MH.calcular({ loja: { id: 'x' }, vendas: semHoje, metaPlanilha: null, hoje: HOJE }), null);
});

// ---------- a rota ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mhj-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = 4900 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'senha-teste-123';
let srv;
const cookies = {};
let ipSeq = 40;
const pedir = (nome, url) => fetch(BASE + url, { headers: { Cookie: cookies[nome] || '' } });

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  const C = require('../../src/config');
  const senha = await C.hashSenhaAsync(SENHA);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    lojas: [{ id: 'l1', nome: 'Loja Um', meta: 9000 }, { id: 'l2', nome: 'Loja Dois', meta: 9000 }],
    usuarios: {
      dono1: { senha, perfil: 'franqueado', lojas: ['l1'], ativo: true },
      ger1: { senha, perfil: 'gerente', lojas: ['l1'], ativo: true, telas: [], telasV: 8 },
      vend1: { senha, perfil: 'vendedor', lojas: ['l1'], ativo: true, vendedor: 'ANA' },
    },
  }));
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-meta-hoje', NODE_ENV: 'test', IA_FALSO: '1', GITHUB_TOKEN: '' } });
  await require('./_subir')(srv, BASE);
  for (const nome of ['dono1', 'ger1', 'vend1']) {
    const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': `203.0.113.${ipSeq++}` }, body: `usuario=${nome}&senha=${encodeURIComponent(SENHA)}` });
    const c = (r.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(c.startsWith('ts_sess='), `login de ${nome}`);
    cookies[nome] = c;
  }
});
after(async () => {
  if (srv) { const fim = new Promise((ok) => srv.once('exit', ok)); srv.kill(); await fim; }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // dados temporários do teste: apaga
});

test('META-VEND-01 (rota): loja de fora → 403; vendedora só com as chaves dela; GET não grava nada', async () => {
  assert.strictEqual((await pedir('ger1', '/api/meta-hoje?loja=l2')).status, 403, 'gerente na loja dos outros');
  assert.strictEqual((await pedir('vend1', '/api/meta-hoje?loja=l2')).status, 403, 'vendedora na loja dos outros');
  assert.strictEqual((await pedir('dono1', '/api/meta-hoje?loja=l2')).status, 403, 'franqueado na loja dos outros');
  const antes = fs.readdirSync(tmp).sort();
  const rv = await pedir('vend1', '/api/meta-hoje?loja=l1');
  assert.strictEqual(rv.status, 200);
  const v = await rv.json();
  assert.deepStrictEqual(Object.keys(v).sort(), ['minhaParte', 'modo', 'restam', 'semParte', 'temHoje', 'vendiHoje']);
  assert.ok(!('meta' in v) && !('partes' in v) && !('vendHoje' in v), 'nada da loja para a vendedora');
  const rg = await (await pedir('ger1', '/api/meta-hoje?loja=l1')).json();
  assert.strictEqual(rg.meta, 9000, 'gerente recebe a conta da loja');
  assert.deepStrictEqual(fs.readdirSync(tmp).sort(), antes, 'GET não grava nada');
});

test('META-VEND-01 (apresentação): a rota fictícia responde sem login e só com as chaves da vendedora', async () => {
  const r = await fetch(BASE + '/api/demo/meta-hoje');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(Object.keys(await r.json()).sort(), ['minhaParte', 'modo', 'restam', 'semParte', 'temHoje', 'vendiHoje']);
});
