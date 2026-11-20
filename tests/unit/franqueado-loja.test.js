// Franqueado = admin da loja dele (decisão do dono): sobe o painel de verdade (dados temporários + coletor de mentira)
// e confere, pelo que o servidor responde, que ele faz tudo na loja dele, nada na loja dos outros,
// e que gerente e vendedora continuam barrados. Também: não recebe destinatários nem segredos de outras lojas.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frq-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const NOTIF_ARQ = path.join(tmp, 'notificacoes.json');
const PORTA = 4600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'senha-teste-123';
const TOKEN_TG = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
let srv, col, C;
const chamadas = []; // o que chegou ao coletor de mentira: "POST /rodar/l1"
const cookies = {};
let ipSeq = 10;

const pedir = (nome, url, opt = {}) => fetch(BASE + url, { ...opt, headers: { Cookie: cookies[nome] || '', 'X-Painel': '1', 'Content-Type': 'application/json', ...(opt.headers || {}) } });
const status = async (nome, url, opt) => (await pedir(nome, url, opt)).status;
const post = (nome, url, corpo) => pedir(nome, url, { method: 'POST', body: JSON.stringify(corpo || {}) });
const lerNotif = () => JSON.parse(fs.readFileSync(NOTIF_ARQ, 'utf8'));

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  C = require('../../src/config');
  const senha = await C.hashSenhaAsync(SENHA);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    lojas: [{ id: 'l1', nome: 'Loja Um' }, { id: 'l2', nome: 'Loja Dois' }],
    usuarios: {
      chefe: { senha, perfil: 'admin', lojas: ['*'], ativo: true },
      dono1: { senha, perfil: 'franqueado', lojas: ['l1'], ativo: true },
      ger1: { senha, perfil: 'gerente', lojas: ['l1'], ativo: true, telas: ['pedido', 'notas', 'estoque'], telasV: 8 },
      vend1: { senha, perfil: 'vendedor', lojas: ['l1'], ativo: true, vendedor: 'ANA' },
    },
  }));
  // acesso ao AppNext e ao FIXE das duas lojas (valores de mentira)
  fs.mkdirSync(C.COLETOR_DIR, { recursive: true });
  for (const id of ['l1', 'l2']) fs.writeFileSync(path.join(C.COLETOR_DIR, `${id}.env`), 'APPNEXT_REDE=rede\nAPPNEXT_USER=u\nAPPNEXT_PASS=x\nFIXE_URL=https://fixe.exemplo.com.br\nFIXE_USER=u\nFIXE_PASS=x\n');
  fs.writeFileSync(NOTIF_ARQ, JSON.stringify({
    ativo: true, horario: '08:00',
    telegram: { token: TOKEN_TG, destinos: [{ chatId: '111111', nome: 'Rede TG', lojas: ['*'] }, { chatId: '222222', nome: 'TG da loja dois', lojas: ['l2'] }, { chatId: '333333', nome: 'TG da loja um', lojas: ['l1'] }] },
    email: { host: 'smtp.rede.exemplo.com.br', port: 587, user: 'rede@exemplo.com.br', pass: 'segredo-smtp', from: 'Rede <rede@exemplo.com.br>',
      destinos: [{ email: 'todas@exemplo.com.br', nome: 'Franqueador', lojas: ['*'] }, { email: 'dois@exemplo.com.br', nome: 'Da dois', lojas: ['l2'] }, { email: 'ambas@exemplo.com.br', nome: 'Das duas', lojas: ['l1', 'l2'] }, { email: 'um@exemplo.com.br', nome: 'Da um', lojas: ['l1'] }] },
    avisos: { email: 'avisos-rede@exemplo.com.br' },
  }));
  // coletor de mentira: aceita tudo e anota o que foi pedido
  col = http.createServer((req, res) => {
    if (req.method !== 'GET') chamadas.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url.startsWith('/status/') ? { configurada: true, horarios: [], estado: 'parado', temPedido: true } : { ok: true }));
  });
  await new Promise((ok) => col.listen(0, '127.0.0.1', ok)); // porta livre escolhida pelo sistema: sorteio fixo já colidiu no GitHub
  const PORTA_COL = col.address().port;
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), stdio: 'ignore',
    env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-franqueado', NODE_ENV: 'test', IA_FALSO: '1', COLETOR_URL: `http://127.0.0.1:${PORTA_COL}`, COLETOR_TOKEN: 'token-de-teste', GITHUB_TOKEN: '' } });
  for (let k = 0; k < 100; k++) { try { const r = await fetch(BASE + '/login'); if (r.status < 500) break; } catch { /* subindo */ } await new Promise((ok) => setTimeout(ok, 100)); }
  for (const nome of ['chefe', 'dono1', 'ger1', 'vend1']) {
    const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': `203.0.113.${ipSeq++}` }, body: `usuario=${nome}&senha=${encodeURIComponent(SENHA)}` });
    const c = (r.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(c.startsWith('ts_sess='), `login de ${nome}`);
    cookies[nome] = c;
  }
});
after(async () => {
  if (srv) { const fim = new Promise((ok) => srv.once('exit', ok)); srv.kill(); await fim; }
  if (col) await new Promise((ok) => col.close(ok));
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // dados temporários do teste: apaga
});

// ---------- coletor por loja (Configurações) ----------
const ROTAS_COLETOR = [
  ['rodar', 'POST /rodar/', {}],
  ['historico', 'POST /historico/', { de: '2025-01', ate: '2025-02' }],
  ['cancelar', 'POST /cancelar/', {}],
  ['fixe/rodar', 'POST /fixe/', {}],
  ['fixe/saldos', 'POST /fixe-saldos/', {}],
];
for (const [rota, noColetor, corpo] of ROTAS_COLETOR) {
  test(`coletor · ${rota}: franqueado só na loja dele; gerente e vendedora barrados`, async () => {
    chamadas.length = 0;
    assert.strictEqual(await status('ger1', `/api/admin/lojas/l1/${rota}`, { method: 'POST', body: JSON.stringify(corpo) }), 403, 'gerente');
    assert.strictEqual(await status('vend1', `/api/admin/lojas/l1/${rota}`, { method: 'POST', body: JSON.stringify(corpo) }), 403, 'vendedora');
    assert.strictEqual((await post('dono1', `/api/admin/lojas/l2/${rota}`, corpo)).status, 404, 'franqueado na loja dos outros');
    assert.deepStrictEqual(chamadas, [], 'nada chegou ao coletor');
    assert.strictEqual((await post('dono1', `/api/admin/lojas/l1/${rota}`, corpo)).status, 200, 'franqueado na loja dele');
    assert.deepStrictEqual(chamadas, [noColetor + 'l1']);
    chamadas.length = 0;
    assert.strictEqual((await post('chefe', `/api/admin/lojas/l2/${rota}`, corpo)).status, 200, 'admin em qualquer loja');
    assert.deepStrictEqual(chamadas, [noColetor + 'l2']);
  });
}
test('coletor: sem o cabeçalho X-Painel o franqueado não dispara nada', async () => {
  chamadas.length = 0;
  assert.strictEqual(await status('dono1', '/api/admin/lojas/l1/rodar', { method: 'POST', headers: { 'X-Painel': '' } }), 403);
  assert.deepStrictEqual(chamadas, []);
});

// ---------- botões fora das Configurações ----------
test('Sincronizar agora (notas de entrada): franqueado só na loja dele', async () => {
  chamadas.length = 0;
  const corpo = (loja) => ({ method: 'POST', body: JSON.stringify({ loja }) });
  assert.strictEqual(await status('ger1', '/api/estoque/notas/sincronizar', corpo('l1')), 403);
  assert.strictEqual(await status('vend1', '/api/estoque/notas/sincronizar', corpo('l1')), 403);
  assert.strictEqual(await status('dono1', '/api/estoque/notas/sincronizar', corpo('l2')), 400);
  assert.strictEqual(await status('ger1', '/api/estoque/notas/sincronizar?loja=l1'), 403);
  assert.strictEqual(await status('dono1', '/api/estoque/notas/sincronizar?loja=l2'), 400);
  assert.deepStrictEqual(chamadas, []);
  assert.strictEqual(await status('dono1', '/api/estoque/notas/sincronizar?loja=l1'), 200);
  assert.strictEqual(await status('dono1', '/api/estoque/notas/sincronizar', corpo('l1')), 200);
  assert.deepStrictEqual(chamadas, ['POST /rodar/l1']);
});
test('Buscar dados (topo) e Atualizar estoque (Pedido): franqueado só na loja dele', async () => {
  chamadas.length = 0;
  const corpo = { method: 'POST', body: JSON.stringify({ itens: ['estoque'] }) };
  assert.strictEqual(await status('ger1', '/api/script?loja=l1', corpo), 403);
  assert.strictEqual(await status('vend1', '/api/script?loja=l1', corpo), 403);
  assert.strictEqual(await status('dono1', '/api/script?loja=l2', corpo), 400);
  assert.deepStrictEqual(chamadas, []);
  assert.strictEqual(await status('dono1', '/api/script?loja=l1', corpo), 200);
  assert.deepStrictEqual(chamadas, ['POST /rodar/l1']);
});
test('robô do Sistema de Pedidos: franqueado só na loja dele', async () => {
  chamadas.length = 0;
  const corpo = { method: 'POST', body: JSON.stringify({ acao: 'catalogo' }) };
  assert.strictEqual(await status('ger1', '/api/pedido/robo?loja=l1', corpo), 403);
  assert.strictEqual(await status('vend1', '/api/pedido/robo?loja=l1', corpo), 403);
  assert.strictEqual(await status('dono1', '/api/pedido/robo?loja=l2', corpo), 400);
  assert.deepStrictEqual(chamadas, []);
  const r = await pedir('dono1', '/api/pedido/robo?loja=l1', corpo);
  assert.notStrictEqual(r.status, 403);
  assert.ok(chamadas.every((c) => c.endsWith('/l1')), 'só a loja dele chega ao coletor: ' + chamadas.join(', '));
  // a tela do Pedido avisa quem pode acionar o robô
  assert.strictEqual((await (await pedir('dono1', '/api/pedido?loja=l1')).json()).podeRobo, true);
  assert.strictEqual((await (await pedir('ger1', '/api/pedido?loja=l1')).json()).podeRobo, false);
});

// ---------- o que continua só do admin (é da rede) ----------
test('da rede continua só do admin: lojas, horários e janela da rede, sistema, backup, SMTP/token/horário do resumo, classificação', async () => {
  const put = (corpo) => ({ method: 'PUT', body: JSON.stringify(corpo) });
  assert.strictEqual(await status('dono1', '/api/admin/lojas', { method: 'POST', body: JSON.stringify({ id: 'nova', nome: 'Nova' }) }), 403);
  assert.strictEqual(await status('dono1', '/api/admin/lojas/l1', { method: 'DELETE' }), 403);
  assert.strictEqual(await status('dono1', '/api/admin/horarios', put({ semana: { 1: ['10:00'] } })), 403);
  assert.strictEqual(await status('dono1', '/api/admin/janela', put({ dias: 3 })), 403);
  assert.strictEqual(await status('dono1', '/api/admin/sistema'), 403);
  assert.strictEqual(await status('dono1', '/api/admin/backup'), 403);
  assert.strictEqual(await status('dono1', '/api/admin/backup', { method: 'POST' }), 403);
  assert.strictEqual(await status('dono1', '/api/admin/notif/telegram/conversas'), 403);
  assert.strictEqual(await status('dono1', '/api/classificacao', put({ produto: 'X', classe: 'fora' })), 403);
  for (const corpo of [{ horario: '05:00' }, { ativo: false }, { telegram: { token: '' } }, { email: { host: 'smtp.outro.exemplo.com.br' } }, { avisos: { email: 'x@exemplo.com.br' } }]) {
    assert.strictEqual(await status('dono1', '/api/admin/notif', put(corpo)), 403, JSON.stringify(corpo));
  }
  const c = lerNotif();
  assert.strictEqual(c.horario, '08:00'); assert.strictEqual(c.ativo, true); assert.strictEqual(c.telegram.token, TOKEN_TG); assert.strictEqual(c.email.host, 'smtp.rede.exemplo.com.br');
});

// ---------- resumo diário ----------
test('resumo diário: o franqueado abre a tela e recebe só os destinatários das lojas dele, sem SMTP, token nem e-mail dos avisos', async () => {
  assert.strictEqual(await status('ger1', '/api/admin/notif'), 403);
  assert.strictEqual(await status('vend1', '/api/admin/notif'), 403);
  const r = await pedir('dono1', '/api/admin/notif');
  assert.strictEqual(r.status, 200);
  const txt = await r.text(), j = JSON.parse(txt);
  assert.strictEqual(j.restrito, true);
  assert.deepStrictEqual(j.email.destinos.map((d) => d.email), ['um@exemplo.com.br']);
  assert.deepStrictEqual(j.telegram.destinos.map((d) => d.chatId), ['333333']);
  assert.deepStrictEqual(Object.keys(j.email).sort(), ['configurado', 'destinos']);
  for (const proibido of ['todas@', 'dois@', 'ambas@', '111111', '222222', 'smtp.rede', 'rede@exemplo', 'segredo-smtp', TOKEN_TG, 'avisos-rede', 'l2', 'Loja Dois']) assert.ok(!txt.includes(proibido), 'vazou: ' + proibido);
  // o admin continua vendo tudo (menos a senha e o token)
  const a = await (await pedir('chefe', '/api/admin/notif')).text();
  assert.ok(a.includes('dois@exemplo.com.br') && a.includes('smtp.rede') && !a.includes('segredo-smtp') && !a.includes(TOKEN_TG));
  // /estado: lojas, usuários e seletor só com as lojas dele
  const e = await (await pedir('dono1', '/api/admin/estado')).json();
  assert.deepStrictEqual(e.lojas.map((l) => l.id), ['l1']);
  assert.deepStrictEqual(e.todasLojas.map((l) => l.id), ['l1']);
  assert.ok(!e.usuarios.some((u) => u.nome === 'chefe'));
});
test('resumo diário · destinatários: o franqueado cria, edita e remove só os das lojas dele', async () => {
  const dest = (nome, corpo) => post(nome, '/api/admin/notif/destinos', corpo);
  assert.strictEqual((await dest('ger1', { canal: 'email', id: 'g@exemplo.com.br', lojas: ['l1'] })).status, 403);
  assert.strictEqual((await dest('vend1', { canal: 'email', id: 'g@exemplo.com.br', lojas: ['l1'] })).status, 403);
  // loja alheia, '*', lista vazia (viraria '*') e mistura: recusados
  for (const lojas of [['l2'], ['*'], [], undefined, ['l1', 'l2'], ['l1', '*']]) assert.strictEqual((await dest('dono1', { canal: 'email', id: 'novo@exemplo.com.br', nome: 'Novo', lojas })).status, 403, JSON.stringify(lojas));
  // não sobrescreve nem remove destinatário da rede ou de outra loja
  for (const id of ['todas@exemplo.com.br', 'dois@exemplo.com.br', 'ambas@exemplo.com.br']) {
    assert.strictEqual((await dest('dono1', { canal: 'email', id, nome: 'Meu', lojas: ['l1'] })).status, 403, 'sobrescrever ' + id);
    assert.strictEqual((await dest('dono1', { canal: 'email', id, remover: true })).status, 403, 'remover ' + id);
  }
  assert.strictEqual((await dest('dono1', { canal: 'telegram', id: '222222', remover: true })).status, 403);
  assert.strictEqual((await dest('dono1', { canal: 'telegram', id: '111111', nome: 'x', lojas: ['l1'] })).status, 403);
  assert.strictEqual((await dest('dono1', { canal: 'telegram', id: '999999', nome: 'conversa nova', lojas: ['l1'] })).status, 403, 'conversa nova do Telegram é do admin');
  assert.strictEqual((await dest('dono1', { canal: 'email', id: 'nao-existe@exemplo.com.br', remover: true })).status, 404);
  let c = lerNotif();
  assert.deepStrictEqual(c.email.destinos.map((d) => d.email), ['todas@exemplo.com.br', 'dois@exemplo.com.br', 'ambas@exemplo.com.br', 'um@exemplo.com.br']);
  assert.strictEqual(c.telegram.destinos.length, 3);
  // os dele: cria, edita, remove
  assert.strictEqual((await dest('dono1', { canal: 'email', id: 'novo@exemplo.com.br', nome: 'Novo', lojas: ['l1'] })).status, 200);
  assert.strictEqual((await dest('dono1', { canal: 'email', id: 'novo@exemplo.com.br', nome: 'Novo nome', lojas: ['l1'] })).status, 200);
  assert.strictEqual((await dest('dono1', { canal: 'email', id: 'novo@exemplo.com.br', nome: 'Fuga', lojas: ['l2'] })).status, 403, 'não leva o dele para a loja dos outros');
  assert.strictEqual((await dest('dono1', { canal: 'telegram', id: '333333', nome: 'TG renomeado', lojas: ['l1'] })).status, 200);
  c = lerNotif();
  assert.deepStrictEqual(c.email.destinos.find((d) => d.email === 'novo@exemplo.com.br'), { email: 'novo@exemplo.com.br', nome: 'Novo nome', lojas: ['l1'] });
  assert.strictEqual(c.telegram.destinos.find((d) => d.chatId === '333333').nome, 'TG renomeado');
  assert.strictEqual((await dest('dono1', { canal: 'email', id: 'novo@exemplo.com.br', remover: true })).status, 200);
  assert.ok(!lerNotif().email.destinos.some((d) => d.email === 'novo@exemplo.com.br'));
});
test('resumo diário · teste, prévia e "enviar fechamento agora": só para as lojas do franqueado', async () => {
  // teste: destinatário de outra loja ou da rede "não existe" para ele (nada é enviado)
  for (const [canal, id] of [['email', 'dois@exemplo.com.br'], ['email', 'todas@exemplo.com.br'], ['email', 'ambas@exemplo.com.br'], ['telegram', '222222'], ['telegram', '111111']]) {
    assert.strictEqual((await post('dono1', '/api/admin/notif/teste', { canal, id })).status, 404, `${canal} ${id}`);
    assert.strictEqual((await post('dono1', '/api/admin/notif/teste', { canal, id, tipo: 'fechamento' })).status, 404, `fechamento ${canal} ${id}`);
  }
  assert.strictEqual((await post('ger1', '/api/admin/notif/teste', { canal: 'email', id: 'um@exemplo.com.br' })).status, 403);
  assert.strictEqual((await post('vend1', '/api/admin/notif/fechamento/enviar')).status, 403);
  assert.strictEqual((await post('ger1', '/api/admin/notif/fechamento/enviar')).status, 403);
  // prévia
  assert.strictEqual(await status('ger1', '/api/admin/notif/previa?loja=l1'), 403);
  assert.strictEqual(await status('dono1', '/api/admin/notif/previa?loja=l2'), 404);
  for (const q of ['*', 'l1', '']) {
    const r = await pedir('dono1', '/api/admin/notif/previa?loja=' + q);
    assert.strictEqual(r.status, 200);
    const t = (await r.json()).texto;
    assert.ok(!/l2|Loja Dois/.test(t), 'prévia com a loja dos outros: ' + t);
  }
  // enviar agora: só o fechamento da loja dele (sem servidor de e-mail nem robô aqui: nada sai de verdade, cada envio volta como falha)
  const c = lerNotif(); c.telegram.token = ''; c.email.host = ''; fs.writeFileSync(NOTIF_ARQ, JSON.stringify(c));
  const r = await post('dono1', '/api/admin/notif/fechamento/enviar');
  assert.strictEqual(r.status, 200);
  const envios = (await r.json()).envios;
  assert.ok(envios.length && envios.every((x) => x.loja === 'Loja Um' && !x.ok), JSON.stringify(envios));
  assert.ok(!envios.some((x) => x.para === 'dois@exemplo.com.br'));
  const todos = (await (await post('chefe', '/api/admin/notif/fechamento/enviar')).json()).envios;
  assert.ok(todos.some((x) => x.loja === 'Loja Dois'), 'o admin continua enviando o de todas');
});
test('NOTIF.enviarFechamento({ lojas }): só monta o fechamento das lojas pedidas', async () => {
  const NOTIF = require('../../src/notificacoes');
  const vistas = [];
  await NOTIF.enviarFechamento(async (id) => { vistas.push(id); return null; }, { lojas: ['l1'] });
  assert.deepStrictEqual(vistas, ['l1']);
  vistas.length = 0;
  await NOTIF.enviarFechamento(async (id) => { vistas.push(id); return null; });
  assert.deepStrictEqual(vistas, ['l1', 'l2']);
});

// ---------- configuração guiada (os 4 acessos da loja no primeiro uso) ----------
test('configuração guiada: abre sozinha uma vez para o franqueado, só na loja dele; gerente e vendedora barrados; nunca devolve usuário nem senha', async () => {
  assert.strictEqual(await status('ger1', '/api/admin/guia'), 403, 'gerente');
  assert.strictEqual(await status('vend1', '/api/admin/guia'), 403, 'vendedora');
  const ler = async (nome) => (await pedir(nome, '/api/admin/guia')).json();
  let g = await ler('dono1');
  assert.deepStrictEqual(g.lojas.map((l) => l.id), ['l1'], 'só a loja dele');
  assert.deepStrictEqual(Object.keys(g.lojas[0].passos), ['appnext', 'pedido', 'fixe', 'email']);
  assert.ok(Object.values(g.lojas[0].passos).some((v) => v === false), 'tem acesso faltando');
  assert.strictEqual(g.lojas[0].abrir, true, 'primeira vez: abre sozinha');
  assert.deepStrictEqual(Object.keys(g.lojas[0]).sort(), ['abrir', 'id', 'nome', 'passos', 'visto'], 'só sim/não: nenhum usuário nem senha');
  assert.ok(Object.values(g.lojas[0].passos).every((v) => typeof v === 'boolean'));
  // marcar como vista: só na loja dele e só com X-Painel
  assert.strictEqual((await post('dono1', '/api/admin/lojas/l2/guia/visto')).status, 404, 'loja dos outros');
  assert.strictEqual(await status('dono1', '/api/admin/lojas/l1/guia/visto', { method: 'POST', headers: { 'X-Painel': '' } }), 403, 'sem X-Painel');
  assert.strictEqual(await status('ger1', '/api/admin/lojas/l1/guia/visto', { method: 'POST' }), 403, 'gerente');
  assert.strictEqual((await post('dono1', '/api/admin/lojas/l1/guia/visto')).status, 200);
  g = await ler('dono1');
  assert.strictEqual(g.lojas[0].visto, true);
  assert.strictEqual(g.lojas[0].abrir, false, 'não abre de novo sozinha');
  // admin: vê todas as lojas, mas a janela nunca abre sozinha para ele
  g = await ler('chefe');
  assert.ok(g.lojas.length >= 2 && g.lojas.every((l) => l.abrir === false));
});

// ---------- carrinho salvo do Pedido ----------
test('carrinho salvo: quem tem a tela Pedido salva e descarta, só na loja dele; vendedora barrada; X-Painel obrigatório', async () => {
  const corpo = JSON.stringify({ itens: { 100: 2, 200: 0 } });
  assert.strictEqual(await status('vend1', '/api/pedido/rascunho?loja=l1', { method: 'PUT', body: corpo }), 403, 'vendedora');
  assert.strictEqual(await status('dono1', '/api/pedido/rascunho?loja=l2', { method: 'PUT', body: corpo }), 400, 'loja dos outros');
  assert.strictEqual(await status('dono1', '/api/pedido/rascunho?loja=l1', { method: 'PUT', body: corpo, headers: { 'X-Painel': '' } }), 403, 'sem X-Painel');
  assert.strictEqual(await status('dono1', '/api/pedido/rascunho?loja=l1', { method: 'PUT', body: JSON.stringify({ itens: {} }) }), 400, 'vazio');
  const r = await pedir('dono1', '/api/pedido/rascunho?loja=l1', { method: 'PUT', body: corpo });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.deepStrictEqual(j.rascunho.itens, { 100: 2, 200: 0 }); assert.strictEqual(j.rascunho.por, 'dono1');
  // a tela do Pedido recebe o carrinho salvo; o admin também vê (é da loja, não da pessoa)
  assert.deepStrictEqual((await (await pedir('chefe', '/api/pedido?loja=l1')).json()).rascunho.itens, { 100: 2, 200: 0 });
  assert.strictEqual((await (await pedir('chefe', '/api/pedido?loja=l2')).json()).rascunho, null);
  assert.strictEqual(await status('vend1', '/api/pedido/rascunho?loja=l1', { method: 'DELETE' }), 403);
  assert.strictEqual(await status('dono1', '/api/pedido/rascunho?loja=l1', { method: 'DELETE' }), 200);
  assert.strictEqual((await (await pedir('dono1', '/api/pedido?loja=l1')).json()).rascunho, null);
});

test('carrinho montado: confirmar e excluir só para quem tem a tela Pedido, na loja dele e com X-Painel', async () => {
  for (const rota of ['confirmar', 'excluir']) {
    assert.strictEqual(await status('vend1', `/api/pedido/carrinho/${rota}?loja=l1`, { method: 'POST' }), 403, 'vendedora');
    assert.strictEqual(await status('dono1', `/api/pedido/carrinho/${rota}?loja=l2`, { method: 'POST' }), 400, 'loja dos outros');
    assert.strictEqual(await status('dono1', `/api/pedido/carrinho/${rota}?loja=l1`, { method: 'POST', headers: { 'X-Painel': '' } }), 403, 'sem X-Painel');
    const r = await pedir('dono1', `/api/pedido/carrinho/${rota}?loja=l1`, { method: 'POST' });
    assert.strictEqual(r.status, 400); assert.match((await r.json()).erro, /Não há carrinho montado/);
  }
});

