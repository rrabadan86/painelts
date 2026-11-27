'use strict';
// Regras do Pedido no servidor: EST-55 (pedido validado no servidor), EST-56 (carrinho no site por código, nunca finaliza)
// e EST-57 (robô e login do Sistema de Pedidos: quem pode; a senha nunca volta para a tela).
// Sobe o painel de verdade numa pasta temporária, com um coletor de mentira (listen(0)) — nada fala com o Sistema de
// Pedidos de verdade. Usuário e senha do Sistema de Pedidos abaixo são de mentira.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pedrotas-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = require('./_porta')(6800, 100); // faixa só deste arquivo (6800–6899)
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'senha-teste-123';
const SENHA_PED = 'senha-pedidos-falsa-QX7';
const SITE = 'https://grnteashop.nextsoft.com.br';

let srv, col;
const cookies = {};
const noColetor = []; // o que o painel mandou ao coletor de mentira
let ipSeq = 20;

const pedir = (nome, url, opt = {}) => fetch(BASE + url, { redirect: 'manual', ...opt, headers: { Cookie: cookies[nome] || '', 'X-Painel': '1', 'Content-Type': 'application/json', ...(opt.headers || {}) } });
const status = async (nome, url, opt) => (await pedir(nome, url, opt)).status;
const corpo = (method, b) => ({ method, body: JSON.stringify(b || {}) });
const lerAud = () => { try { return fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8'); } catch { return ''; } };
const pastaPed = (loja) => path.join(tmp, loja, 'pedido');
const CATALOGO = { em: '2026-11-20T03:00:00Z', itens: [
  { cod: '100', nome: 'Chá Verde Sencha', preco: 80, disp: true, mult: 1, min: null, max: null },
  { cod: '200', nome: 'Mug Royal Horse', preco: 99, disp: true, mult: 6, min: 6, max: 24 },
  { cod: '300', nome: 'Bule Indisponível', preco: 120, disp: false, mult: 1 },
] };

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  const C = require('../../src/config');
  const senha = await C.hashSenhaAsync(SENHA);
  const u = (perfil, lojas, extra) => ({ senha, perfil, lojas, ativo: true, ...extra });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    lojas: [{ id: 'l1', nome: 'Loja Um' }, { id: 'l2', nome: 'Loja Dois' }, { id: 'l3', nome: 'Loja Tres' }],
    usuarios: {
      chefe: u('admin', ['*']),
      dono: u('franqueado', ['l1']),
      dono2: u('franqueado', ['l2']),
      ger_ped: u('gerente', ['l1'], { telas: ['resumo', 'estoque', 'pedido'], telasV: 8 }),
      ger_sem: u('gerente', ['l1'], { telas: ['resumo', 'estoque'], telasV: 8 }),
      vend: u('vendedor', ['l1'], { vendedor: 'ANA' }),
    },
  }));
  fs.mkdirSync(pastaPed('l1'), { recursive: true });
  fs.writeFileSync(path.join(pastaPed('l1'), 'catalogo.json'), JSON.stringify(CATALOGO));
  // coletor de mentira: status com login do Sistema de Pedidos e o log da última execução; anota o que recebe
  col = http.createServer((req, res) => {
    let b = '';
    req.on('data', (x) => { b += x; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/pedido/')) noColetor.push({ url: req.url, corpo: b, cab: JSON.stringify(req.headers) });
      res.end(JSON.stringify(req.url.startsWith('/status/')
        ? { configurada: true, horarios: [], estado: 'parado', temPedido: true, pedido: { estado: 'parado', ultima: { ok: true, fim: '2026-11-20T10:00:00Z', log: 'linha do log do robô' } } }
        : { ok: true }));
    });
  });
  await new Promise((ok) => col.listen(0, '127.0.0.1', ok));
  srv = spawn(process.execPath, ['server.js'], { cwd: RAIZ, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-pedido-rotas', NODE_ENV: 'test', IA_FALSO: '1', UPLOAD_TOKEN: '', COOKIE_SECURE: '', PAINEL_AMBIENTE: '', PEDIDO_SITE: '',
      COLETOR_URL: `http://127.0.0.1:${col.address().port}`, COLETOR_TOKEN: 'token-coletor-de-teste', GITHUB_TOKEN: '' } });
  await require('./_subir')(srv, BASE);
  for (const nome of ['chefe', 'dono', 'dono2', 'ger_ped', 'ger_sem', 'vend']) {
    const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': `198.51.100.${ipSeq++}` }, body: new URLSearchParams({ usuario: nome, senha: SENHA }).toString() });
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

// =============================================== EST-55 ===============================================
test('EST-55: configuração do pedido validada no servidor (limites de %, dias, folga, crescimento, proporção e datas)', () => {
  const P = require('../../src/pedido');
  const ok = (b) => P.validarCfg({ dias: 14, ...b });
  assert.match(ok({ cmvPct: 0.5 }).erro, /entre 1 e 90/);
  assert.match(ok({ cmvPct: 91 }).erro, /entre 1 e 90/);
  assert.strictEqual(ok({ cmvPct: '33,5' }).ok.cmvPct, 33.5, 'aceita vírgula');
  assert.strictEqual(ok({ cmvPct: '' }).ok.cmvPct, null, 'vazio = CMV real');
  assert.match(P.validarCfg({ dias: 2 }).erro, /entre 3 e 60/);
  assert.match(P.validarCfg({ dias: 61 }).erro, /entre 3 e 60/);
  assert.match(P.validarCfg({}).erro, /Dias/, 'sem dias');
  assert.match(ok({ folgaPct: 101 }).erro, /Folga/);
  assert.strictEqual(ok({}).ok.folgaPct, 10, 'folga padrão 10%');
  assert.match(ok({ crescimentoPct: -81 }).erro, /Crescimento/);
  assert.match(ok({ crescimentoPct: 301 }).erro, /Crescimento/);
  assert.match(ok({ proporcao: { cha: 50, env: 20, acess: 20 } }).erro, /somar 100%/);
  assert.match(ok({ proporcao: { cha: 120, env: -20, acess: 0 } }).erro, /somar 100%/);
  assert.deepStrictEqual(ok({ proporcao: { cha: '70', env: 10, acess: 20 } }).ok.proporcao, { cha: 70, env: 10, acess: 20 });
  // datas comemorativas
  assert.strictEqual(ok({}).ok.eventos.length, P.EVENTOS.length, 'sem datas: as padrão');
  assert.match(ok({ eventos: Array.from({ length: 13 }, (_, k) => ({ nome: 'D' + k, de: '01-01', ate: '01-02' })) }).erro, /No máximo 12/);
  assert.match(ok({ eventos: [{ nome: '  ', de: '01-01', ate: '01-02' }] }).erro, /nome/);
  assert.match(ok({ eventos: [{ nome: 'X', de: '13-01', ate: '01-02' }] }).erro, /MM-DD/);
  assert.match(ok({ eventos: [{ nome: 'X', de: '02-30x', ate: '01-02' }] }).erro, /MM-DD/);
  assert.match(ok({ eventos: [{ nome: 'Mães', regra: 'maes', diasAntes: 0 }] }).erro, /entre 1 e 45/);
  assert.match(ok({ eventos: [{ nome: 'Mães', regra: 'maes', diasAntes: 46 }] }).erro, /entre 1 e 45/);
  const ev = ok({ eventos: [{ nome: 'Dia dos\nPais <b>', de: '08-01', ate: '08-10', extra: 'x' }] }).ok.eventos[0];
  assert.deepStrictEqual(ev, { id: 'dia-dos-pais-b-', nome: 'Dia dos Pais <b>', de: '08-01', ate: '08-10' }, 'só os campos conhecidos; nome numa linha; id simples');
});

test('EST-55: itens do carrinho validados pelo catálogo — só o que existe e está disponível; nome e código vêm do catálogo', () => {
  const P = require('../../src/pedido');
  assert.match(P.validarItens('l2', [{ cod: '100', qtd: 1 }]).erro, /Ainda não há catálogo/);
  assert.match(P.validarItens('l1', []).erro, /Nenhum produto/);
  assert.match(P.validarItens('l1', 'x').erro, /Nenhum produto/);
  assert.match(P.validarItens('l1', Array.from({ length: 401 }, () => ({ cod: '100', qtd: 1 }))).erro, /máximo 400/);
  const r = P.validarItens('l1', [
    { cod: '100', qtd: 2.12345, nome: '<script>outro nome</script>', preco: 0.01 },
    { cod: 100, qtd: 0 }, { cod: '100', qtd: -1 }, { cod: '100', qtd: 'abc' }, { cod: '100', qtd: 100001 }, // quantidade inválida: ignorada
    { cod: '300', qtd: 1 }, { cod: '999', qtd: 1 }, // indisponível e fora do catálogo
  ]);
  assert.deepStrictEqual(r.ok, [{ cod: '100', nome: 'Chá Verde Sencha', qtd: 2.123 }], 'nome do catálogo, quantidade em 3 casas, nada além de código/nome/quantidade');
  assert.deepStrictEqual(r.fora, ['300', '999']);
  assert.match(P.validarItens('l1', [{ cod: '300', qtd: 1 }]).erro, /Nenhum dos produtos está disponível/);
});

test('EST-55: rotas do pedido — perfil, tela, loja e X-Painel conferidos no servidor; cfg inválida não grava', async () => {
  const cfg = { dias: 21, cmvPct: 30, folgaPct: 5, proporcao: { cha: 60, env: 10, acess: 30 } };
  assert.strictEqual(await status('vend', '/api/pedido?loja=l1'), 403, 'vendedora');
  assert.strictEqual(await status('ger_sem', '/api/pedido?loja=l1'), 403, 'gerente sem a tela Pedido');
  assert.strictEqual(await status('dono', '/api/pedido?loja=l2'), 400, 'franqueado na loja dos outros');
  assert.strictEqual(await status('vend', '/api/pedido/cfg?loja=l1', corpo('PUT', cfg)), 403);
  assert.strictEqual(await status('ger_sem', '/api/pedido/cfg?loja=l1', corpo('PUT', cfg)), 403);
  assert.strictEqual(await status('dono2', '/api/pedido/cfg?loja=l1', corpo('PUT', cfg)), 400);
  assert.strictEqual(await status('dono', '/api/pedido/cfg?loja=l1', { ...corpo('PUT', cfg), headers: { 'X-Painel': '' } }), 403, 'sem X-Painel');
  const inval = await pedir('dono', '/api/pedido/cfg?loja=l1', corpo('PUT', { ...cfg, cmvPct: 95 }));
  assert.strictEqual(inval.status, 400);
  assert.match((await inval.json()).erro, /entre 1 e 90/);
  assert.strictEqual(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).lojas[0].pedidoCfg, undefined, 'recusada não grava');
  assert.strictEqual(await status('ger_ped', '/api/pedido/cfg?loja=l1', corpo('PUT', cfg)), 200, 'gerente com a tela Pedido ajusta');
  const p = await (await pedir('dono', '/api/pedido?loja=l1')).json();
  assert.deepStrictEqual([p.cfg.dias, p.cfg.cmvPct, p.cfg.folgaPct, p.cfg.proporcao], [21, 30, 5, { cha: 60, env: 10, acess: 30 }]);
  assert.match(lerAud(), /alterou configuração do pedido/);
  // pedido obrigatório: quantidade e valor conferidos
  assert.strictEqual(await status('dono', '/api/pedido/obrigatorio?loja=l1', corpo('PUT', { nome: 'X', itens: [{ cod: '100', qtd: 0 }] })), 400);
  assert.strictEqual(await status('dono', '/api/pedido/obrigatorio?loja=l1', corpo('PUT', { nome: 'X', itens: [{ cod: '100', qtd: 1, preco: -5 }] })), 400);
  assert.strictEqual(await status('dono', '/api/pedido/obrigatorio?loja=l1', corpo('PUT', { nome: 'X', ate: '31/12/2026', itens: [{ cod: '100', qtd: 1 }] })), 400);
  assert.strictEqual(await status('vend', '/api/pedido/obrigatorio?loja=l1', corpo('PUT', { nome: 'X', itens: [{ cod: '100', qtd: 1 }] })), 403);
});

// =============================================== EST-56 ===============================================
test('EST-56: "Montar carrinho no site" gera um código por loja (o anterior deixa de valer), 30 min, e só a lista validada', async () => {
  const gerar = (quem, itens) => pedir(quem, '/api/pedido/carrinho?loja=l1', corpo('POST', { itens }));
  assert.strictEqual((await gerar('vend', [{ cod: '100', qtd: 1 }])).status, 403);
  assert.strictEqual((await gerar('ger_sem', [{ cod: '100', qtd: 1 }])).status, 403);
  assert.strictEqual((await pedir('dono', '/api/pedido/carrinho?loja=l1', { ...corpo('POST', { itens: [{ cod: '100', qtd: 1 }] }), headers: { 'X-Painel': '' } })).status, 403, 'sem X-Painel');
  assert.strictEqual((await gerar('dono', [{ cod: '300', qtd: 1 }])).status, 400, 'nada disponível');
  const r1 = await (await gerar('dono', [{ cod: '100', qtd: 2, nome: 'outro' }, { cod: '200', qtd: 6 }, { cod: '300', qtd: 1 }])).json();
  assert.match(r1.codigo, /^[a-f0-9]{36}$/, 'código aleatório (18 bytes)');
  assert.strictEqual(r1.url, `${SITE}/Pedidos/Abertura.aspx#teashop=${r1.codigo}`, 'abre no site de pedidos, código no # (não vai ao servidor do site)');
  assert.deepStrictEqual(r1.fora, ['300']);
  const min = (Date.parse(r1.expira) - Date.now()) / 60e3;
  assert.ok(min > 28 && min <= 30, `vale 30 min (${min})`);
  // a lista que o favorito lê (sem login): só código, nome, quantidade e as regras do site; nada de preço, custo ou usuário
  const l = await fetch(`${BASE}/api/pedido-site/lista?c=${r1.codigo}`, { headers: { Origin: SITE } });
  assert.strictEqual(l.status, 200);
  assert.strictEqual(l.headers.get('access-control-allow-origin'), SITE, 'CORS só para o site de pedidos');
  assert.strictEqual(l.headers.get('cache-control'), 'no-store');
  const lista = await l.json();
  assert.strictEqual(lista.loja, 'Loja Um');
  assert.deepStrictEqual(lista.itens, [
    { cod: '100', nome: 'Chá Verde Sencha', qtd: 2, mult: 1, min: null, max: null },
    { cod: '200', nome: 'Mug Royal Horse', qtd: 6, mult: 6, min: 6, max: 24 },
  ]);
  const outro = await fetch(`${BASE}/api/pedido-site/lista?c=${r1.codigo}`, { headers: { Origin: 'https://atacante.exemplo.com' } });
  assert.strictEqual(outro.headers.get('access-control-allow-origin'), null, 'outro site não recebe a permissão de CORS');
  // código errado ou curto
  assert.strictEqual((await fetch(`${BASE}/api/pedido-site/lista?c=${'0'.repeat(36)}`)).status, 404);
  assert.strictEqual((await fetch(`${BASE}/api/pedido-site/lista`)).status, 404);
  // gerente com a tela Pedido também monta (podeTela), e o código novo derruba o anterior da mesma loja
  const r2 = await (await gerar('ger_ped', [{ cod: '100', qtd: 1 }])).json();
  assert.ok(r2.codigo && r2.codigo !== r1.codigo);
  assert.strictEqual((await fetch(`${BASE}/api/pedido-site/lista?c=${r1.codigo}`)).status, 404, 'um carrinho por loja: o código anterior venceu');
  assert.strictEqual((await fetch(`${BASE}/api/pedido-site/lista?c=${r2.codigo}`)).status, 200);
  assert.match(lerAud(), /gerou o carrinho do Sistema de Pedidos/);
  // o registro do carrinho fica "aguardando" (montar o carrinho não é fazer o pedido)
  const car = JSON.parse(fs.readFileSync(path.join(pastaPed('l1'), 'carrinho.json'), 'utf8'));
  assert.strictEqual(car.aguardando, true);
  assert.strictEqual(car.confirmado, undefined);
});

test('EST-56: andamento do favorito — só com o código; só os produtos da lista e status conhecidos; excluir o carrinho derruba o código', async () => {
  const r = await (await pedir('dono', '/api/pedido/carrinho?loja=l1', corpo('POST', { itens: [{ cod: '100', qtd: 2 }] }))).json();
  const prog = (c, b) => fetch(`${BASE}/api/pedido-site/progresso?c=${c}`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: SITE }, body: typeof b === 'string' ? b : JSON.stringify(b) });
  assert.strictEqual((await prog('f'.repeat(36), { itens: [] })).status, 404, 'código que não existe');
  assert.strictEqual((await prog(r.codigo, '{nao é json')).status, 400);
  const p = await prog(r.codigo, { fim: true, atual: 'x'.repeat(500), itens: [
    { cod: '100', nome: 'Chá Verde <img src=x>', pedido: 2, qtd: 2, preco: 80, status: 'ok' },
    { cod: '200', nome: 'Fora da lista', status: 'ok' },
    { cod: '100', nome: 'status inventado', status: 'finalizado' },
  ], carrinhoDepois: { texto: '1 Itens - R$ 160,00' } });
  assert.strictEqual(p.status, 200);
  assert.deepStrictEqual(await p.json(), { ok: true }, 'nada além de ok volta ao site');
  const car = JSON.parse(fs.readFileSync(path.join(pastaPed('l1'), 'carrinho.json'), 'utf8'));
  assert.deepStrictEqual(car.itens.map((i) => [i.cod, i.status]), [['100', 'ok']]);
  assert.strictEqual(car.itens[0].nome, 'Chá Verde  img src=x ', 'sem < > no nome');
  assert.ok(car.atual === undefined || car.atual.length <= 120);
  assert.strictEqual(car.ok, true);
  assert.strictEqual(car.confirmado, undefined, 'o fim do favorito não confirma o pedido: falta a pessoa confirmar');
  // excluir o registro: o código deixa de valer (o favorito não continua um carrinho excluído)
  assert.strictEqual(await status('dono', '/api/pedido/carrinho/excluir?loja=l1', { method: 'POST' }), 200);
  assert.strictEqual((await fetch(`${BASE}/api/pedido-site/lista?c=${r.codigo}`)).status, 404);
  assert.strictEqual((await prog(r.codigo, { itens: [] })).status, 404);
});

test('EST-56: código vence em 30 min sem uso; é aleatório e por loja (o de uma loja não derruba o da outra)', (t) => {
  const P = require('../../src/pedido');
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-20T12:00:00Z') });
  const a = P.criarCodigo('l1', [{ cod: '100', nome: 'Chá', qtd: 1 }], 'dono');
  const b = P.criarCodigo('l2', [{ cod: '100', nome: 'Chá', qtd: 1 }], 'dono2');
  assert.notStrictEqual(a.codigo, b.codigo);
  assert.ok(P.lerCodigo(a.codigo) && P.lerCodigo(b.codigo), 'um por loja: a outra loja não derruba');
  assert.strictEqual(P.lerCodigo(a.codigo).loja, 'l1');
  t.mock.timers.tick(29 * 60e3);
  assert.ok(P.lerCodigo(a.codigo), 'aos 29 min vale');
  t.mock.timers.tick(2 * 60e3);
  assert.strictEqual(P.lerCodigo(a.codigo), null, 'aos 31 min venceu');
  assert.match(P.progresso(a.codigo, { itens: [] }).erro, /vencido/);
  for (const c of [undefined, null, '', {}, 'xyz']) assert.strictEqual(P.lerCodigo(c), null);
});

test('EST-56: favorito e robô nunca finalizam — só abrem a tela de produtos, buscam, põem no carrinho e aceitam a venda conjunta', () => {
  const fav = fs.readFileSync(path.join(RAIZ, 'public/js/carrinho-site.js'), 'utf8');
  const robo = fs.readFileSync(path.join(RAIZ, 'coletor/nextsoft_pedido.py'), 'utf8');
  // tudo o que o favorito procura por id no site: login, novo pedido, fornecedor, busca e "Colocar no Carrinho"
  const idsFav = new Set([...fav.matchAll(/getElementById\(((?:[^()]|\([^()]*\))*)\)/g)].map((m) => m[1].replace(/\s+/g, ' ')));
  assert.deepStrictEqual([...idsFav].sort(), ["'UserName'", "'new-pedido'", "L + 'btnBuscar'", "L + 'txtBusca'", "P + 'ddlFornecedores'", "alvo.q.id.replace(/txtQtde_\\d+$/, 'lnkAddCart')"].sort(),
    'o favorito passou a procurar outro elemento do site: confira que não é de finalizar/pagar e atualize a lista');
  // páginas que o favorito abre: só a Abertura (o carrinho aparece no topo dela)
  assert.deepStrictEqual([...new Set([...fav.matchAll(/BASE \+ '([^']+)'/g)].map((m) => m[1]))], ['Abertura.aspx']);
  // robô: cliques, campos e páginas
  const sels = [...robo.matchAll(/page\.(?:click|fill|goto)\(([^,)]+)/g)].map((m) => m[1].trim());
  assert.deepStrictEqual([...new Set(sels)].sort(), ['"#LinkButton1"', '"#Password"', '"#UserName"', '"#new-pedido"', 'BASE + "Abertura.aspx"', 'BASE + "ConsultaProdutos.aspx"', 'BASE + "Login.aspx"',
    'f"#{L}btnBuscar"', 'f"#{L}txtBusca"', 'f"#{P}btnBuscar"', 'f"#{P}txtProduto"'].sort(), 'o robô passou a clicar/abrir outra coisa: confira que não é de finalizar/pagar');
  // nada com cara de etapa seguinte em nenhum dos dois (fora comentários e mensagens)
  const codigo = (t) => t.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|#|log\(|msg\()/.test(l)).join('\n');
  for (const [nome, t] of [['favorito', codigo(fav)], ['robô', codigo(robo)]]) {
    for (const re of [/btnFinaliz/i, /Finalizar(Pedido)?\.aspx/i, /lnkFinaliz/i, /Pagamento\.aspx/i, /btnConcluir/i, /lnkProximo|btnProximo|btnAvancar/i, /FecharPedido/i]) assert.doesNotMatch(t, re, `${nome}: ${re}`);
  }
  assert.match(fav, /O pedido <b>não foi finalizado<\/b>/, 'o favorito avisa que não finalizou');
  assert.match(robo, /O pedido NÃO foi finalizado/, 'o robô registra que não finalizou');
});

// =============================================== EST-57 ===============================================
test('EST-57: login do Sistema de Pedidos — admin e franqueado (só as lojas dele) gravam; gerente e vendedora não; a senha nunca volta', async () => {
  const put = (quem, loja, b, extra = {}) => pedir(quem, `/api/pedido/acesso?loja=${loja}`, { ...corpo('PUT', b), ...extra });
  for (const quem of ['ger_ped', 'ger_sem', 'vend']) {
    assert.strictEqual((await put(quem, 'l1', { usuario: 'loja1', senha: SENHA_PED })).status, 403, quem);
    assert.strictEqual(await status(quem, '/api/pedido/acesso?loja=l1'), 403, `${quem} lê`);
  }
  assert.strictEqual((await put('dono2', 'l1', { usuario: 'loja1', senha: SENHA_PED })).status, 400, 'franqueado na loja de outro');
  assert.strictEqual((await put('dono', 'l1', { usuario: 'loja1', senha: SENHA_PED }, { headers: { 'X-Painel': '' } })).status, 403, 'sem X-Painel');
  assert.strictEqual((await put('dono', 'l1', { usuario: 'loja1' })).status, 400, 'primeira vez sem senha');
  assert.strictEqual((await put('dono', 'l1', { usuario: '', senha: SENHA_PED })).status, 400, 'sem usuário');
  assert.strictEqual((await put('dono', 'l1', { usuario: 'loja1', senha: 'a\nb' })).status, 400, 'quebra de linha na senha');
  const r = await put('dono', 'l1', { usuario: 'loja1', senha: SENHA_PED });
  assert.strictEqual(r.status, 200);
  const txt = await r.text();
  assert.ok(!txt.includes(SENHA_PED), 'a resposta não traz a senha');
  assert.deepStrictEqual(Object.keys(JSON.parse(txt)).sort(), ['em', 'por', 'temSenha', 'usuario']);
  assert.strictEqual(JSON.parse(txt).temSenha, true);
  // trocar só o usuário mantém a senha guardada
  assert.strictEqual((await put('dono', 'l1', { usuario: 'loja1b', senha: '' })).status, 200);
  const f = path.join(tmp, '_sistema', 'acesso-pedido', 'l1.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).senha, SENHA_PED);
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600, 'arquivo só do dono');
  // admin também; e a senha não aparece em nenhuma leitura nem na auditoria
  assert.strictEqual((await put('chefe', 'l2', { usuario: 'loja2', senha: SENHA_PED + '2' })).status, 200);
  for (const [quem, url] of [['dono', '/api/pedido/acesso?loja=l1'], ['chefe', '/api/pedido/acesso?loja=l2'], ['dono', '/api/pedido?loja=l1'], ['ger_ped', '/api/pedido?loja=l1'],
    ['chefe', '/api/admin/estado'], ['dono', '/api/admin/estado'], ['chefe', '/api/admin/guia'], ['dono', '/api/admin/guia']]) {
    const resp = await pedir(quem, url);
    const t = await resp.text();
    assert.ok(!t.includes(SENHA_PED), `${quem} ${url} devolveu a senha`);
  }
  const a = await (await pedir('dono', '/api/pedido/acesso?loja=l1')).json();
  assert.deepStrictEqual([a.usuario, a.temSenha], ['loja1b', true]);
  assert.ok(lerAud().includes('alterou o login do Sistema de Pedidos'));
  assert.ok(!lerAud().includes(SENHA_PED), 'a auditoria não guarda a senha');
  // apagar
  assert.strictEqual((await put('chefe', 'l2', { apagar: true })).status, 200);
  assert.strictEqual((await (await pedir('chefe', '/api/pedido/acesso?loja=l2')).json()).temSenha, false);
});

test('EST-57: robô do Sistema de Pedidos — admin e franqueado da loja acionam; gerente (mesmo com Pedido) e vendedora não; a senha não vai ao coletor pelo painel', async () => {
  const robo = (quem, loja, b) => pedir(quem, `/api/pedido/robo?loja=${loja}`, corpo('POST', b));
  for (const quem of ['ger_ped', 'ger_sem', 'vend']) assert.strictEqual((await robo(quem, 'l1', { acao: 'catalogo' })).status, 403, quem);
  assert.strictEqual((await robo('dono2', 'l1', { acao: 'catalogo' })).status, 400, 'franqueado na loja de outro');
  assert.strictEqual((await robo('dono', 'l1', { acao: 'finalizar' })).status, 400, 'ação que não existe');
  assert.strictEqual((await robo('dono', 'l1', { acao: 'carrinho', itens: [{ cod: '300', qtd: 1 }] })).status, 400, 'carrinho sem nada disponível');
  const antes = noColetor.length;
  const r = await robo('dono', 'l1', { acao: 'carrinho', itens: [{ cod: '100', qtd: 3, nome: 'trocado' }, { cod: '999', qtd: 1 }] });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual((await r.json()).fora, ['999']);
  assert.strictEqual(noColetor.length, antes + 1);
  const ent = JSON.parse(fs.readFileSync(path.join(pastaPed('l1'), 'entrada.json'), 'utf8'));
  assert.deepStrictEqual(ent.itens, [{ cod: '100', nome: 'Chá Verde Sencha', qtd: 3 }], 'o robô recebe só a lista validada');
  assert.strictEqual(ent.por, 'dono');
  assert.strictEqual((await robo('chefe', 'l1', { acao: 'catalogo' })).status, 200, 'admin');
  for (const x of noColetor) {
    assert.deepStrictEqual(Object.keys(JSON.parse(x.corpo)).sort(), ['acao', 'somar'], 'ao coletor vai só a ação');
    assert.ok(!x.corpo.includes(SENHA_PED) && !x.cab.includes(SENHA_PED));
  }
  assert.match(lerAud(), /mandou montar o carrinho do pedido/);
  // GET /api/pedido: o log do robô só para admin e franqueado; podeRobo idem
  const g = await (await pedir('ger_ped', '/api/pedido?loja=l1')).json();
  assert.strictEqual(g.podeRobo, false);
  assert.strictEqual(g.robo.temLogin, true);
  assert.strictEqual(g.robo.ultima.log, undefined, 'gerente não recebe o log do robô');
  const d = await (await pedir('dono', '/api/pedido?loja=l1')).json();
  assert.strictEqual(d.podeRobo, true);
  assert.strictEqual(d.robo.ultima.log, 'linha do log do robô');
});

test('EST-57: remover a loja tira de uso o login do Sistema de Pedidos dela', async () => {
    assert.strictEqual((await pedir('chefe', '/api/pedido/acesso?loja=l3', corpo('PUT', { usuario: 'loja3', senha: SENHA_PED + '3' }))).status, 200);
    const f = path.join(tmp, '_sistema', 'acesso-pedido', 'l3.json');
    assert.ok(fs.existsSync(f));
    assert.strictEqual(await status('chefe', '/api/admin/lojas/l3', { method: 'DELETE' }), 200);
    assert.ok(!fs.existsSync(f), 'o login da loja removida continua no lugar onde o coletor lê');
  });
