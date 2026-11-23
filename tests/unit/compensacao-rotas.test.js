// Créditos com a franquia → "Compensada em nota fiscal de entrada" e "Compensada nos royalties" pela rota de verdade:
// X-Painel, mesma permissão de antes (tela Notas fiscais e loja da pessoa), nota só desta loja, mês da lista de 12,
// auditoria. Sobe o painel com um usuário de cada perfil.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = require('./_porta')(6200, 100); // faixa só deste arquivo
const BASE = `http://127.0.0.1:${PORTA}`;
let srv;
const cookies = {};
const mesAtual = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
const somaMes = (ym, k) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + k, 1)).toISOString().slice(0, 7);

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  const C = require('../../src/config');
  const senha = await C.hashSenhaAsync('senha-teste-123');
  const u = (perfil, extra) => ({ senha, perfil, lojas: ['l1'], ativo: true, ...extra });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    lojas: [{ id: 'l1', nome: 'Loja 1' }, { id: 'l2', nome: 'Loja 2 (de outro franqueado)' }],
    usuarios: {
      dono: u('franqueado'),
      ger_notas: u('gerente', { telas: ['resumo', 'notas'], telasV: 8 }),
      ger_sem: u('gerente', { telas: ['resumo', 'estoque'], telasV: 8 }),
      vend: u('vendedor', { vendedor: 'ANA' }),
    },
  }));
  // notas de entrada: a da loja 1 (n1) e uma da loja 2 (n2), que a loja 1 não pode usar
  const nota = (id, nf) => ({ id, nf, chave: String(nf).padStart(44, '3'), emissao: '2026-11-10', entrada: '2026-11-10', fornecedor: 'TSB FRANQUIAS', total: 900, itens: [] });
  for (const [loja, n] of [['l1', nota('n1', 19300)], ['l2', nota('n2', 55001)]]) {
    const p = path.join(C.pastaLoja(loja), 'estoque');
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'compras.json'), JSON.stringify({ atualizado: '2026-11-10T12:00:00Z', notas: [n] }));
  }
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-comp', NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'pipe'] });
  await require('./_subir')(srv, BASE);
  for (const nome of ['dono', 'ger_notas', 'ger_sem', 'vend']) {
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

const marcar = (nome, corpo, painel = true) => fetch(BASE + '/api/conta-franquia/acao', { method: 'POST', headers: { Cookie: cookies[nome], 'Content-Type': 'application/json', ...(painel ? { 'X-Painel': '1' } : {}) }, body: JSON.stringify({ loja: 'l1', tipo: 'compensar', ...corpo }) });
const gravado = () => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'l1', 'conta-franquia.json'), 'utf8')).manual; } catch { return {}; } };

test('FRQ-COMP-04: rota exige X-Painel e a mesma permissão de antes (tela Notas fiscais, loja da pessoa)', async () => {
  assert.strictEqual((await marcar('dono', { credito: 'dev-a1', como: 'nota', nota: 'n1' }, false)).status, 403, 'sem X-Painel');
  assert.strictEqual((await marcar('vend', { credito: 'dev-a1', como: 'nota', nota: 'n1' })).status, 403, 'vendedora');
  assert.strictEqual((await marcar('ger_sem', { credito: 'dev-a1', como: 'nota', nota: 'n1' })).status, 403, 'gerente sem Notas fiscais');
  assert.strictEqual((await marcar('dono', { loja: 'l2', credito: 'dev-a1', como: 'nota', nota: 'n2' })).status, 400, 'loja de outro franqueado');
  assert.deepEqual(gravado(), {}, 'nada gravado');
});

test('FRQ-COMP-04: nota só desta loja; NF digitada curta; mês da lista de 12; grava, audita e devolve a conta', async () => {
  let r = await marcar('dono', { credito: 'dev-a1', como: 'nota', nota: 'n2' });
  assert.strictEqual(r.status, 400, 'nota da outra loja');
  assert.match((await r.json()).erro, /não está no painel/);
  r = await marcar('dono', { credito: 'dev-a1', como: 'nota', nota: 'n1', obs: 'conferido' });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.creditos) && Array.isArray(j.entradas), 'devolve a conta, com as notas para escolher');
  assert.deepEqual(j.entradas.map((n) => n.id), ['n1']);
  assert.strictEqual(j.mesesRoyalties[0], mesAtual);
  assert.strictEqual(gravado()['dev-a1'].nota, 'n1');
  assert.strictEqual((await marcar('ger_notas', { credito: 'dev-a2', como: 'nota', nf: '77.123' })).status, 200, 'gerente com Notas fiscais, como hoje');
  assert.strictEqual(gravado()['dev-a2'].nf, '77.123');
  assert.strictEqual((await marcar('dono', { credito: 'dev-a3', como: 'nota', nf: 'x'.repeat(30) })).status, 400);
  assert.strictEqual((await marcar('dono', { credito: 'dev-a3', como: 'royalties', mes: somaMes(mesAtual, -12) })).status, 400, '13 meses atrás');
  assert.strictEqual((await marcar('dono', { credito: 'dev-a3', como: 'royalties', mes: somaMes(mesAtual, 1) })).status, 400, 'mês que vem');
  assert.strictEqual((await marcar('dono', { credito: 'dev-a3', como: 'royalties', mes: somaMes(mesAtual, -11) })).status, 200);
  assert.strictEqual(gravado()['dev-a3'].mes, somaMes(mesAtual, -11));
  const aud = fs.readFileSync(path.join(path.dirname(CONFIG_FILE), 'auditoria.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((a) => a.acao === 'conta com a franquia: compensar');
  assert.strictEqual(aud.length, 3);
  assert.deepEqual(aud.map((a) => a.detalhe.como), ['nota', 'nota', 'royalties']);
});
