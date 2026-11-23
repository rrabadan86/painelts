// O servidor respeita a marcação de telas de Configurações → Usuários (não basta esconder no menu).
// Sobe o painel de verdade com usuários de cada perfil e confere o que cada um recebe.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = require('./_porta')(3200, 600);
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
      ger_sem: u('gerente', { telas: ['resumo', 'mapa'], telasV: 8 }),
      ger_com: u('gerente', { telas: ['resumo', 'sugestoes', 'espera'], telasV: 8 }),
      ger_pad: u('gerente', { telasV: 8 }),
      ger_notas: u('gerente', { telas: ['notas'], telasV: 8 }),
      vend2: u('vendedor', { vendedor: 'BIA' }),
      vend: u('vendedor', { vendedor: 'ANA' }),
    },
  }));
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-permissoes', NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'pipe'] });
  await require('./_subir')(srv, BASE); // até 90 s, e mostra o erro do servidor se ele cair
  for (const nome of ['dono', 'ger_sem', 'ger_com', 'ger_pad', 'ger_notas', 'vend', 'vend2']) {
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

const status = async (nome, url, opt = {}) => (await fetch(BASE + url, { ...opt, headers: { Cookie: cookies[nome], 'X-Painel': '1', 'Content-Type': 'application/json', ...(opt.headers || {}) } })).status;

test('⭐ Sugestões: vendedora sempre; gerente só com a tela marcada (sem escolha = padrão, que inclui)', async () => {
  assert.strictEqual(await status('vend', '/api/sugestoes?loja=l1'), 200);
  assert.strictEqual(await status('dono', '/api/sugestoes?loja=l1'), 200);
  assert.strictEqual(await status('ger_com', '/api/sugestoes?loja=l1'), 200);
  assert.strictEqual(await status('ger_pad', '/api/sugestoes?loja=l1'), 200);
  assert.strictEqual(await status('ger_sem', '/api/sugestoes?loja=l1'), 403);
  assert.strictEqual(await status('ger_sem', '/api/sugestoes?loja=l1', { method: 'POST', body: JSON.stringify({ cod: '1' }) }), 403);
});

test('decidir as sugestões no Pedido exige a tela Pedido', async () => {
  assert.strictEqual(await status('ger_com', '/api/pedido/sugestoes/decisao?loja=l1', { method: 'PUT', body: JSON.stringify({ cod: '1', res: 'nao' }) }), 403);
  assert.strictEqual(await status('vend', '/api/pedido/sugestoes/fechar?loja=l1', { method: 'POST', body: JSON.stringify({ itens: [] }) }), 403);
});

test('Lista de espera: vendedora sempre; gerente só com a tela marcada (o padrão inclui)', async () => {
  assert.strictEqual(await status('vend', '/api/espera?loja=l1'), 200);
  assert.strictEqual(await status('ger_com', '/api/espera?loja=l1'), 200);
  assert.strictEqual(await status('ger_pad', '/api/espera?loja=l1'), 200);
  assert.strictEqual(await status('ger_sem', '/api/espera?loja=l1'), 403);
});

test('telas de custo: gerente sem a tela e vendedora não recebem; escala só com Movimento e escala', async () => {
  for (const nome of ['ger_sem', 'ger_com', 'ger_pad', 'vend']) assert.strictEqual(await status(nome, '/api/estoque?loja=l1'), 403, nome);
  assert.strictEqual(await status('dono', '/api/estoque?loja=l1'), 200);
  assert.strictEqual(await status('vend', '/api/pedido?loja=l1'), 403);
  assert.strictEqual(await status('ger_com', '/api/escala-ajustes?loja=l1&ym=2026-11', { method: 'PUT', body: JSON.stringify({ ajustes: {} }) }), 403);
  assert.strictEqual(await status('ger_sem', '/api/escala-ajustes?loja=l1&ym=2026-11', { method: 'PUT', body: JSON.stringify({ ajustes: {} }) }), 200);
});

test('Configurações → Usuários recebe a lista de telas agrupada como no menu (só quem configura)', async () => {
  const r = await fetch(BASE + '/api/admin/estado', { headers: { Cookie: cookies.dono } });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.deepStrictEqual(j.telas.map((g) => g.grupo), ['Início', 'Vendas', 'Clientes', 'Equipe', 'Produtos', 'Estoque', 'Resultado', 'Configurações']);
  assert.ok(j.telas.find((g) => g.grupo === 'Estoque').telas.some((t) => t.id === 'sugestoes'));
  assert.strictEqual((await fetch(BASE + '/api/admin/estado', { headers: { Cookie: cookies.ger_pad } })).status, 403);
});

test('falar com a franquia por e-mail (cobrança): só admin e franqueado, mesmo para gerente com Notas fiscais (D-06)', async () => {
  for (const url of ['/api/conta-franquia/email/previa?loja=l1', '/api/conta-franquia/email/enviar?loja=l1']) {
    assert.strictEqual(await status('ger_notas', url, { method: 'POST', body: JSON.stringify({ tipo: 'devolucoes' }) }), 403, url);
  }
  assert.strictEqual(await status('ger_notas', '/api/conta-franquia/auto?loja=l1'), 403);
  assert.notStrictEqual(await status('dono', '/api/conta-franquia/email/previa?loja=l1', { method: 'POST', body: JSON.stringify({ tipo: 'devolucoes' }) }), 403);
});

test('checklist: a vendedora vê "você" ou "equipe", nunca o login da colega', async () => {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const r0 = await (await fetch(BASE + '/api/checklist?loja=l1', { headers: { Cookie: cookies.dono } })).json();
  const item = r0.itens.abertura[0];
  const marcar = (nome) => fetch(BASE + '/api/checklist/marcar?loja=l1', { method: 'POST', headers: { Cookie: cookies[nome], 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ loja: 'l1', dia: hoje, tipo: 'abertura', item: item.id, feito: true }) });
  assert.strictEqual((await marcar('vend2')).status, 200);
  const j = await (await fetch(BASE + '/api/checklist?loja=l1', { headers: { Cookie: cookies.vend } })).json();
  assert.strictEqual(j.marcados.abertura[item.id].por, 'equipe');
  assert.ok(!JSON.stringify(j).includes('vend2'));
  const jd = await (await fetch(BASE + '/api/checklist?loja=l1', { headers: { Cookie: cookies.dono } })).json();
  assert.strictEqual(jd.marcados.abertura[item.id].por, 'vend2');
});

test('franqueado configura tudo da loja dele (login do Sistema de Pedidos, regras de comissão); não a loja dos outros; gerente não', async () => {
  assert.strictEqual(await status('dono', '/api/pedido/acesso?loja=l1'), 200);
  assert.strictEqual(await status('dono', '/api/pedido/acesso?loja=l2'), 400, 'loja de outro franqueado');
  assert.strictEqual(await status('ger_pad', '/api/pedido/acesso?loja=l1'), 403);
  assert.strictEqual(await status('dono', '/api/admin/lojas/l1/regras', { method: 'PUT', body: JSON.stringify({ regras: null }) }), 200);
  assert.strictEqual(await status('dono', '/api/admin/lojas/l2/regras', { method: 'PUT', body: JSON.stringify({ regras: null }) }), 404);
  assert.strictEqual(await status('ger_pad', '/api/admin/lojas/l1/regras', { method: 'PUT', body: JSON.stringify({ regras: null }) }), 403);
  // disparar o coletor: o franqueado também, só na loja dele (aqui o coletor está desligado: passa da permissão e para no 400); detalhes em franqueado-loja.test.js
  assert.strictEqual(await status('dono', '/api/admin/lojas/l1/rodar', { method: 'POST', body: '{}' }), 400);
  assert.strictEqual(await status('dono', '/api/admin/lojas/l2/rodar', { method: 'POST', body: '{}' }), 404);
  assert.strictEqual(await status('ger_pad', '/api/admin/lojas/l1/rodar', { method: 'POST', body: '{}' }), 403);
  // continua só do admin: remover a loja
  assert.strictEqual(await status('dono', '/api/admin/lojas/l1', { method: 'DELETE' }), 403);
});

test('caixa a pagar e planilha do contador: só quem tem a tela Resultado; gravar exige X-Painel; nunca a loja dos outros', async () => {
  const pago = (o = {}) => ({ method: 'POST', body: JSON.stringify({ loja: 'l1', id: 'fixo|aluguel|2026-12', pago: true, nome: 'Aluguel', valor: 8000, vence: '2026-12-10', ...o }) });
  const exp = (o = {}) => ({ method: 'POST', body: JSON.stringify({ loja: 'l1', ym: '2020-01', resumo: [{ rot: 'Faturamento', valor: 0 }], despesas: [], ...o }) });
  for (const quem of ['vend', 'ger_sem', 'ger_notas', 'ger_pad']) {
    assert.strictEqual(await status(quem, '/api/apagar?loja=l1'), 403, `${quem} não lê o caixa a pagar`);
    assert.strictEqual(await status(quem, '/api/apagar/pago', pago()), 403, `${quem} não marca conta paga`);
    assert.strictEqual(await status(quem, '/api/resultado/exportar', exp()), 403, `${quem} não exporta`);
  }
  assert.strictEqual(await status('dono', '/api/apagar?loja=l1'), 200);
  assert.strictEqual(await status('dono', '/api/apagar?loja=l2'), 400, 'loja de outro franqueado');
  assert.strictEqual(await status('dono', '/api/apagar/pago', { ...pago(), headers: { 'X-Painel': '0' } }), 403, 'sem o cabeçalho do painel não grava');
  assert.strictEqual(await status('dono', '/api/apagar/pago', pago({ loja: 'l2' })), 400);
  assert.strictEqual(await status('dono', '/api/apagar/pago', pago({ id: '../x' })), 400);
  assert.strictEqual(await status('dono', '/api/apagar/pago', pago()), 200);
  const j = await (await fetch(BASE + '/api/apagar?loja=l1', { headers: { Cookie: cookies.dono } })).json();
  assert.strictEqual(j.pagos['fixo|aluguel|2026-12'].por, 'dono');
  assert.strictEqual(await status('dono', '/api/apagar/pago', pago({ pago: false })), 200);
  // planilha: só mês fechado, com o cabeçalho do painel, só da loja dele
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  assert.strictEqual(await status('dono', '/api/resultado/exportar', exp({ ym: hoje.slice(0, 7) })), 400, 'mês em andamento');
  assert.strictEqual(await status('dono', '/api/resultado/exportar', { ...exp(), headers: { 'X-Painel': '0' } }), 403);
  assert.strictEqual(await status('dono', '/api/resultado/exportar', exp({ loja: 'l2' })), 400);
  const r = await fetch(BASE + '/api/resultado/exportar', { ...exp(), headers: { Cookie: cookies.dono, 'X-Painel': '1', 'Content-Type': 'application/json' } });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /spreadsheetml/);
  assert.strictEqual(Buffer.from(await r.arrayBuffer()).subarray(0, 2).toString(), 'PK');
});
