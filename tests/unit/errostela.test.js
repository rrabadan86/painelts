// Erros de tela da loja (src/errostela.js): o que o navegador manda é saneado (sem dado pessoal), limitado e agrupado;
// pelo painel de verdade: todo perfil envia, só admin vê tudo, franqueado só as lojas dele, gerente e vendedora nada.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erros-tela-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = require('./_porta')(5200, 200); // faixa só deste arquivo
const BASE = `http://127.0.0.1:${PORTA}`;
process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
const E = require('../../src/errostela');

test('ERRTELA-01: a mensagem sai sem dado pessoal (e-mail, CPF, telefone, número longo, texto digitado entre aspas, parâmetros do endereço)', () => {
  const s = E.sanear('Falhou para maria.silva@gmail.com cpf 123.456.789-09 tel (62) 98171-8205 pedido 202611230001 em https://painel.loja/x?cpf=12345678909&t=abc "Rua das Flores, 123, apto 45 - Centro" fim');
  assert.ok(!/maria|@gmail/.test(s), s);
  assert.ok(!/123\.456|98171|8205|202611230001|12345678909/.test(s), s);
  assert.ok(!/Rua das Flores/.test(s), 'texto entre aspas longo (o que a pessoa digitou) sai');
  assert.ok(!/cpf=|\?/.test(s), 'endereço sem os parâmetros');
  assert.ok(/\[e-mail\]/.test(s) && /\[número\]/.test(s));
  assert.strictEqual(E.sanear("Cannot read properties of undefined (reading 'qtd')"), "Cannot read properties of undefined (reading 'qtd')", 'mensagem técnica comum fica inteira');
  assert.ok(E.sanear('x'.repeat(500)).length <= 200, 'mensagem curta');
});

test('ERRTELA-02: registro só com os campos conhecidos; loja só se a pessoa tem; extensão do navegador e "Script error" ficam de fora; linha do pacote vira arquivo:linha', () => {
  const lojas = [{ id: 'l1' }];
  const r = E.registro({ msg: 'boom', arq: '/app.js?v=abc', ln: 120, col: 4, tela: '#pedido', loja: 'l1', usuario: 'ana', valor: 'segredo' }, { perfil: 'gerente', lojas, ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/131.0 Mobile', mapear: (ln) => ({ arq: 'pedido.js', ln: ln - 100 }) });
  assert.deepStrictEqual(Object.keys(r).sort(), ['arq', 'ass', 'col', 'em', 'ln', 'loja', 'msg', 'nav', 'perfil', 'tela', 'tipo'].sort(), 'nada além dos campos conhecidos (sem usuário nem valor)');
  assert.strictEqual(r.arq, 'pedido.js'); assert.strictEqual(r.ln, 20);
  assert.strictEqual(r.tela, 'pedido'); assert.strictEqual(r.loja, 'l1'); assert.strictEqual(r.perfil, 'gerente');
  assert.match(r.nav, /Chrome 131 · celular/);
  assert.strictEqual(E.registro({ msg: 'x', loja: 'l9' }, { lojas }).loja, null, 'loja que a pessoa não tem não entra');
  assert.strictEqual(E.registro({ msg: 'x', arq: 'chrome-extension://abc/content.js' }, { lojas }), null, 'erro de extensão do navegador');
  assert.strictEqual(E.registro({ msg: 'Script error.' }, { lojas }), null);
  assert.strictEqual(E.registro({ msg: '' }, { lojas }), null);
});

test('ERRTELA-03: limite por pessoa (10 por minuto) e o mesmo erro da mesma pessoa só a cada 10 minutos', () => {
  const t = Date.UTC(2026, 10, 20, 12, 0, 0);
  assert.strictEqual(E.podeGravar('a', 'x1', t), true);
  assert.strictEqual(E.podeGravar('a', 'x1', t + 1000), false, 'repetido');
  assert.strictEqual(E.podeGravar('b', 'x1', t + 1000), true, 'outra pessoa conta');
  assert.strictEqual(E.podeGravar('a', 'x1', t + 11 * 60000), true, 'depois de 10 min grava de novo');
  let ok = 0;
  for (let i = 0; i < 20; i++) if (E.podeGravar('c', 'z' + i, t + 30 * 60000)) ok++;
  assert.strictEqual(ok, E.POR_MINUTO, 'no máximo 10 por minuto');
});

test('ERRTELA-04: resumo agrupa os repetidos, filtra por loja e marca os novos; arquivo limitado a 30 dias e 2 MB', () => {
  const agora = Date.parse('2026-11-20T15:00:00Z');
  const em = (d) => new Date(agora - d * 864e5).toISOString();
  const regs = [
    { em: em(10), ass: 'a', msg: 'velho', tela: 'resumo', perfil: 'admin', loja: 'l1', nav: 'Chrome 1' },
    { em: em(3), ass: 'a', msg: 'velho', tela: 'resumo', perfil: 'gerente', loja: 'l1', nav: 'Chrome 1' },
    { em: em(1), ass: 'b', msg: 'novo', tela: 'pedido', perfil: 'gerente', loja: 'l2', nav: 'Safari 17' },
    { em: em(0.5), ass: 'b', msg: 'novo', tela: 'estoque', perfil: 'franqueado', loja: 'l2', nav: 'Safari 17' },
  ];
  const r = E.resumo(regs, { dias: 7, agora });
  assert.strictEqual(r.length, 2);
  const b = r.find((g) => g.ass === 'b'), a = r.find((g) => g.ass === 'a');
  assert.strictEqual(b.vezes, 2); assert.deepStrictEqual(b.telas, ['estoque', 'pedido']);
  assert.strictEqual(a.vezes, 1, 'só os últimos 7 dias contam');
  assert.deepStrictEqual(E.novos(r, agora).map((g) => g.ass), ['b'], 'novo = 1ª vez nos últimos 2 dias');
  assert.deepStrictEqual(E.resumo(regs, { dias: 7, agora, lojas: new Set(['l1']) }).map((g) => g.ass), ['a'], 'franqueado: só as lojas dele');
  // rotação: grava 2,5 MB e o arquivo volta a menos de 2 MB, sem os de mais de 30 dias
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(E.ARQ(), JSON.stringify({ em: new Date(Date.now() - 40 * 864e5).toISOString(), ass: 'antigo', msg: 'x' }) + '\n');
  const grande = 'y'.repeat(180);
  for (let i = 0; i < 12000; i++) fs.appendFileSync(E.ARQ(), JSON.stringify({ em: new Date().toISOString(), ass: 'g' + i, msg: grande }) + '\n');
  E.gravar({ em: new Date().toISOString(), ass: 'ultimo', msg: 'último' });
  assert.ok(fs.statSync(E.ARQ()).size <= E.MAX_BYTES, 'cabe no limite');
  const lidos = E.ler();
  assert.ok(!lidos.some((x) => x.ass === 'antigo'), 'mais de 30 dias sai');
  assert.ok(lidos.some((x) => x.ass === 'ultimo'), 'o mais novo fica');
  fs.rmSync(E.ARQ(), { force: true });
});

// ---------- pelo painel de verdade ----------
let srv;
const cookies = {};
const pedir = (nome, url, opt = {}) => fetch(BASE + url, { redirect: 'manual', ...opt, headers: { Cookie: cookies[nome] || '', 'X-Painel': '1', 'Content-Type': 'application/json', ...(opt.headers || {}) } });
before(async () => {
  const C = require('../../src/config');
  const senha = await C.hashSenhaAsync('senha-teste-123');
  const u = (perfil, lojas, extra) => ({ senha, perfil, lojas, ativo: true, ...extra });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1' }, { id: 'l2', nome: 'Loja 2' }],
    usuarios: { adm: u('admin', ['l1', 'l2']), fr1: u('franqueado', ['l1']), ger: u('gerente', ['l2'], { telasV: 8 }), vend: u('vendedor', ['l2'], { vendedor: 'ANA' }) } }));
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-erros', NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'pipe'] });
  await require('./_subir')(srv, BASE);
  let ip = 10;
  for (const nome of ['adm', 'fr1', 'ger', 'vend']) {
    const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': `203.0.113.${ip++}` }, body: `usuario=${nome}&senha=senha-teste-123` });
    cookies[nome] = (r.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookies[nome].startsWith('ts_sess='), `login de ${nome}`);
  }
});
after(async () => {
  if (srv) { const fim = new Promise((ok) => srv.once('exit', ok)); srv.kill(); await fim; }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // dados temporários do teste: apaga
});

test('ERRTELA-05: todo perfil envia (com X-Painel); só admin vê tudo, franqueado só a loja dele, gerente e vendedora não veem; arquivo sem usuário nem dado pessoal', async () => {
  const corpo = (msg, loja) => JSON.stringify({ msg, arq: '/app.js?v=1', ln: 5, tela: '#pedido', loja });
  assert.strictEqual((await pedir('ger', '/api/erros-tela', { method: 'POST', body: corpo('x', 'l2'), headers: { 'X-Painel': '' } })).status, 403, 'sem X-Painel');
  assert.strictEqual((await fetch(BASE + '/api/erros-tela', { method: 'POST', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: corpo('x', 'l2'), redirect: 'manual' })).status !== 200, true, 'sem login não grava');
  for (const [quem, msg, loja] of [['ger', 'erro da gerente maria@x.com.br', 'l2'], ['vend', 'erro da vendedora 62981718205', 'l2'], ['fr1', 'erro do franqueado', 'l1'], ['adm', 'erro do admin', 'l1']]) {
    const r = await pedir(quem, '/api/erros-tela', { method: 'POST', body: corpo(msg, loja) });
    assert.strictEqual(r.status, 200, `${quem} envia`);
  }
  assert.strictEqual((await pedir('ger', '/api/erros-tela', { method: 'POST', body: 'x'.repeat(6000) })).status >= 400, true, 'corpo grande recusado');
  const txt = fs.readFileSync(E.ARQ(), 'utf8');
  assert.ok(!/maria@|62981718205|"ger"|"vend"|"fr1"|"adm"/.test(txt), 'sem e-mail, telefone nem nome de usuário no arquivo');
  const ver = async (quem) => { const r = await pedir(quem, '/api/erros-tela?dias=7'); return { st: r.status, j: r.status === 200 ? await r.json() : null }; };
  const adm = await ver('adm'); assert.strictEqual(adm.st, 200); assert.strictEqual(adm.j.itens.length, 4, 'admin vê os 4');
  assert.ok(adm.j.itens.every((g) => g.arq !== 'app.js'), 'linha do pacote traduzida para o arquivo do painel');
  const fr = await ver('fr1'); assert.strictEqual(fr.st, 200);
  assert.deepStrictEqual(fr.j.itens.map((g) => g.lojas).flat().sort(), ['l1', 'l1'], 'franqueado: só os da loja dele');
  assert.strictEqual((await ver('ger')).st, 403); assert.strictEqual((await ver('vend')).st, 403);
});

test('ERRTELA-06: na apresentação o aviso é aceito sem gravar nada', async () => {
  const antes = fs.readFileSync(E.ARQ(), 'utf8');
  const r = await fetch(BASE + '/api/demo/erros-tela', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ msg: 'demo' }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(fs.readFileSync(E.ARQ(), 'utf8'), antes);
  const d = await (await fetch(BASE + '/api/demo/erros-tela')).json();
  assert.ok(d.itens.length && d.demo);
});
