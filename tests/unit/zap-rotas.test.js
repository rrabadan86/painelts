'use strict';
// Robô do WhatsApp: quem pode o quê nas rotas /api/zap/* e na opção "Enviar pelo robô" das campanhas.
// Sobe o painel de verdade (dados temporários) e um robô de mentira em HTTP que só anota o que foi pedido.
//   admin, franqueado da loja e gerente com a tela Clientes → tudo (decisão do dono: a gerente lê o QR) · vendedora e gerente sem Clientes → nada
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapr-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = 5600 + Math.floor(Math.random() * 300); // faixa só deste arquivo (3200–3799 permissões, 3900–4099 segurança, 4100–4299 conferência, 4300–4499 perdas, 4600–4899 franqueado); serviço de mentira sempre em listen(0): faixas sobrepostas derrubam o vizinho quando o sorteio coincide
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'senha-teste-123';
const QR = 'data:image/png;base64,AAAA';
let srv, zap, C, portaZap;
const chamadas = []; // o que chegou ao robô de mentira: "POST /conectar/l1"
const robo = { estado: 'conectado' };
const cookies = {};
let ipSeq = 60;

const pedir = (nome, url, opt = {}) => fetch(BASE + url, { ...opt, headers: { Cookie: cookies[nome] || '', 'X-Painel': '1', 'Content-Type': 'application/json', ...(opt.headers || {}) } });
const post = (nome, url, corpo) => pedir(nome, url, { method: 'POST', body: JSON.stringify(corpo || {}) });
const put = (nome, url, corpo) => pedir(nome, url, { method: 'PUT', body: JSON.stringify(corpo || {}) });
const estado = (loja) => { try { return JSON.parse(fs.readFileSync(path.join(tmp, loja, 'zap', 'estado.json'), 'utf8')); } catch { return null; } };
const auditoria = () => fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const CFG = { min: 600, max: 900, das: '10:00', as: '17:00', dias: [1, 2, 3], teto: 12, falhas: 2 };

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  C = require('../../src/config');
  const senha = await C.hashSenhaAsync(SENHA);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    lojas: [{ id: 'l1', nome: 'Loja Um' }, { id: 'l2', nome: 'Loja Dois' }],
    usuarios: {
      chefe: { senha, perfil: 'admin', lojas: ['*'], ativo: true },
      dono1: { senha, perfil: 'franqueado', lojas: ['l1'], ativo: true },
      gercli: { senha, perfil: 'gerente', lojas: ['l1'], ativo: true, telas: ['clientes'], telasV: 8 },
      gersem: { senha, perfil: 'gerente', lojas: ['l1'], ativo: true, telas: ['estoque'], telasV: 8 },
      vend1: { senha, perfil: 'vendedor', lojas: ['l1'], ativo: true, vendedor: 'ANA' },
    },
  }));
  zap = http.createServer((req, res) => {
    if (req.method !== 'GET') chamadas.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.headers['x-zap-token'] !== 'token-zap-teste') { res.statusCode = 401; return res.end('{}'); }
    if (req.url.startsWith('/status/')) return res.end(JSON.stringify({ estado: robo.estado, qr: robo.estado === 'qr' ? QR : null, codigo: robo.estado === 'codigo' ? 'ABCD1234' : null, numeroFim: robo.estado === 'conectado' ? '5562999998888' : null, desde: null, erro: null }));
    if (req.url.startsWith('/optouts/')) return res.end(JSON.stringify({ itens: [] }));
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((ok) => zap.listen(0, '127.0.0.1', ok));
  portaZap = zap.address().port;
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), stdio: 'ignore',
    env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-zap', NODE_ENV: 'test', IA_FALSO: '1', ZAP_URL: `http://127.0.0.1:${portaZap}`, ZAP_TOKEN: 'token-zap-teste', COLETOR_URL: '', COLETOR_TOKEN: '', GITHUB_TOKEN: '' } });
  for (let k = 0; k < 300; k++) { try { const r = await fetch(BASE + '/login'); if (r.status < 500) break; } catch { /* subindo */ } await new Promise((ok) => setTimeout(ok, 100)); }
  for (const nome of ['chefe', 'dono1', 'gercli', 'gersem', 'vend1']) {
    const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': `203.0.113.${ipSeq++}` }, body: `usuario=${nome}&senha=${encodeURIComponent(SENHA)}` });
    const c = (r.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(c.startsWith('ts_sess='), `login de ${nome}`);
    cookies[nome] = c;
  }
});
after(async () => {
  if (srv) { const fim = new Promise((ok) => srv.once('exit', ok)); srv.kill(); await fim; }
  if (zap) await new Promise((ok) => zap.close(ok));
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // dados temporários do teste: apaga
});

test('situação: admin, franqueado da loja e gerente com Clientes veem; vendedora e gerente sem Clientes não', async () => {
  for (const [nome, st] of [['chefe', 200], ['dono1', 200], ['gercli', 200], ['gersem', 403], ['vend1', 403]]) assert.strictEqual((await pedir(nome, '/api/zap/situacao?loja=l1')).status, st, nome);
  assert.strictEqual((await pedir('dono1', '/api/zap/situacao?loja=l2')).status, 400, 'franqueado na loja dos outros');
  assert.strictEqual((await pedir('gercli', '/api/zap/situacao?loja=l2')).status, 400, 'gerente na loja dos outros');
  assert.strictEqual((await fetch(BASE + '/api/zap/situacao?loja=l1', { redirect: 'manual' })).status !== 200, true, 'sem entrar no painel');
  const s = await (await pedir('dono1', '/api/zap/situacao?loja=l1')).json();
  assert.strictEqual(s.servico, true);
  assert.strictEqual(s.conexao.numeroFim, '8888', 'só os 4 últimos dígitos do número');
  assert.ok(!JSON.stringify(s).includes('5562999998888'));
  assert.deepStrictEqual(s.cfg, { min: 900, max: 1200, das: '09:00', as: '18:30', dias: [1, 2, 3, 4, 5, 6], teto: 30, falhas: 3 }, 'padrões do dono');
  assert.strictEqual(s.ligado, false, 'começa desligado');
  assert.deepStrictEqual(s.pode, { configurar: true, pausar: true });
  assert.deepStrictEqual((await (await pedir('gercli', '/api/zap/situacao?loja=l1')).json()).pode, { configurar: true, pausar: true }, 'gerente com Clientes também configura');
});

test('QR e código de pareamento só chegam a quem conecta (admin, franqueado e gerente com Clientes); nunca à vendedora nem ao gerente sem Clientes', async () => {
  robo.estado = 'qr';
  try {
    assert.strictEqual((await (await pedir('dono1', '/api/zap/situacao?loja=l1')).json()).conexao.qr, QR);
    const g = await (await pedir('gercli', '/api/zap/situacao?loja=l1')).json();
    assert.strictEqual(g.conexao.estado, 'qr');
    assert.strictEqual(g.conexao.qr, QR, 'a gerente com Clientes lê o QR');
    for (const nome of ['gersem', 'vend1']) { const r = await pedir(nome, '/api/zap/situacao?loja=l1'); assert.strictEqual(r.status, 403, nome); assert.ok(!(await r.text()).includes(QR)); }
    robo.estado = 'codigo';
    assert.strictEqual((await (await pedir('chefe', '/api/zap/situacao?loja=l1')).json()).conexao.codigo, 'ABCD1234');
    assert.strictEqual((await (await pedir('gercli', '/api/zap/situacao?loja=l1')).json()).conexao.codigo, 'ABCD1234');
    for (const nome of ['gersem', 'vend1']) assert.ok(!(await (await pedir(nome, '/api/zap/situacao?loja=l1')).text()).includes('ABCD1234'), nome);
  } finally { robo.estado = 'conectado'; }
});

for (const [rota, noRobo] of [['conectar', 'POST /conectar/'], ['desconectar', 'POST /desconectar/']]) {
  test(`${rota}: admin, franqueado da loja e gerente com Clientes; nada chega ao robô para os outros`, async () => {
    chamadas.length = 0;
    assert.strictEqual((await post('gercli', `/api/zap/${rota}`, { loja: 'l2' })).status, 400, 'gerente na loja dos outros');
    for (const nome of ['gersem', 'vend1']) assert.strictEqual((await post(nome, `/api/zap/${rota}`, { loja: 'l1' })).status, 403, nome);
    assert.strictEqual((await post('dono1', `/api/zap/${rota}`, { loja: 'l2' })).status, 400, 'franqueado na loja dos outros');
    assert.strictEqual((await pedir('dono1', `/api/zap/${rota}`, { method: 'POST', body: JSON.stringify({ loja: 'l1' }), headers: { 'X-Painel': '' } })).status, 403, 'sem X-Painel');
    assert.deepStrictEqual(chamadas, []);
    assert.strictEqual((await post('dono1', `/api/zap/${rota}`, { loja: 'l1' })).status, 200, 'franqueado na loja dele');
    assert.strictEqual((await post('chefe', `/api/zap/${rota}`, { loja: 'l2' })).status, 200, 'admin em qualquer loja');
    assert.strictEqual((await post('gercli', `/api/zap/${rota}`, { loja: 'l1' })).status, 200, 'gerente com Clientes na loja dele');
    assert.deepStrictEqual(chamadas, [noRobo + 'l1', noRobo + 'l2', noRobo + 'l1']);
  });
}
test('conectar com código: valida o número e a auditoria guarda só os 4 últimos dígitos', async () => {
  assert.strictEqual((await post('dono1', '/api/zap/conectar', { loja: 'l1', numero: '123' })).status, 400);
  assert.strictEqual((await post('dono1', '/api/zap/conectar', { loja: 'l1', numero: '(62) 97777-1234' })).status, 200);
  const txt = fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8');
  assert.ok(!txt.includes('62977771234'), 'número completo fora da auditoria');
  assert.ok(auditoria().some((a) => a.acao === 'robô do WhatsApp: pediu para conectar' && a.detalhe.fim === '1234' && a.detalhe.modo === 'código'));
});

test('ligar e pausar: admin, franqueado e gerente com Clientes; ligar só com o WhatsApp conectado', async () => {
  for (const nome of ['gersem', 'vend1']) assert.strictEqual((await post(nome, '/api/zap/ligar', { loja: 'l1' })).status, 403, nome);
  assert.strictEqual((await post('dono1', '/api/zap/ligar', { loja: 'l2' })).status, 400);
  assert.ok(!(estado('l1') || {}).ligado);
  robo.estado = 'caiu';
  assert.strictEqual((await post('dono1', '/api/zap/ligar', { loja: 'l1' })).status, 400, 'desconectado não liga');
  robo.estado = 'conectado';
  const r = await post('dono1', '/api/zap/ligar', { loja: 'l1' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).ligado, true);
  assert.strictEqual(estado('l1').ligado, true);
  // pausar
  for (const nome of ['gersem', 'vend1']) assert.strictEqual((await post(nome, '/api/zap/pausar', { loja: 'l1' })).status, 403, nome);
  assert.strictEqual(estado('l1').pausa, null);
  assert.strictEqual((await post('gercli', '/api/zap/pausar', { loja: 'l2' })).status, 400, 'gerente na loja dos outros');
  assert.strictEqual((await pedir('gercli', '/api/zap/pausar', { method: 'POST', body: JSON.stringify({ loja: 'l1' }), headers: { 'X-Painel': '' } })).status, 403, 'sem X-Painel');
  const p = await post('gercli', '/api/zap/pausar', { loja: 'l1' });
  assert.strictEqual(p.status, 200);
  assert.strictEqual(estado('l1').pausa.por, 'gercli');
  assert.strictEqual((await p.json()).motivo.cod, 'pausado');
  // o gerente com Clientes também liga de novo (só na loja dele)
  assert.strictEqual((await post('gercli', '/api/zap/ligar', { loja: 'l2' })).status, 400);
  assert.ok(estado('l1').pausa);
  assert.strictEqual((await post('gercli', '/api/zap/ligar', { loja: 'l1' })).status, 200);
  assert.strictEqual(estado('l1').pausa, null);
  assert.strictEqual((await post('chefe', '/api/zap/ligar', { loja: 'l1' })).status, 200);
  const acoes = auditoria().map((a) => `${a.por}: ${a.acao}`);
  for (const a of ['dono1: robô do WhatsApp: ligou', 'gercli: robô do WhatsApp: pausou', 'gercli: robô do WhatsApp: ligou', 'chefe: robô do WhatsApp: ligou']) assert.ok(acoes.includes(a), a);
});

test('configuração: admin, franqueado da loja e gerente com Clientes; valores validados no servidor e auditados', async () => {
  assert.strictEqual((await put('gercli', '/api/zap/config', { loja: 'l2', ...CFG })).status, 400, 'gerente na loja dos outros');
  for (const nome of ['gersem', 'vend1']) assert.strictEqual((await put(nome, '/api/zap/config', { loja: 'l1', ...CFG })).status, 403, nome);
  assert.strictEqual((await put('dono1', '/api/zap/config', { loja: 'l2', ...CFG })).status, 400, 'franqueado na loja dos outros');
  for (const ruim of [{ min: 59 }, { min: 1000, max: 900 }, { max: 7201 }, { das: '18:00', as: '09:00' }, { das: '25:00' }, { dias: [] }, { dias: [9] }, { teto: 0 }, { teto: 201 }, { falhas: 0 }, { falhas: 11 }])
    assert.strictEqual((await put('dono1', '/api/zap/config', { loja: 'l1', ...CFG, ...ruim })).status, 400, JSON.stringify(ruim));
  assert.strictEqual(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).lojas[0].zap, undefined, 'nada gravado até aqui');
  const r = await put('dono1', '/api/zap/config', { loja: 'l1', ...CFG });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual((await r.json()).cfg, CFG);
  const lojas = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).lojas;
  assert.deepStrictEqual(lojas[0].zap, CFG);
  assert.strictEqual(lojas[1].zap, undefined, 'a outra loja não muda');
  assert.ok(auditoria().some((a) => a.por === 'dono1' && a.acao === 'robô do WhatsApp: mudou a configuração' && a.detalhe.teto === 12));
  assert.strictEqual((await put('gercli', '/api/zap/config', { loja: 'l1', ...CFG })).status, 200, 'gerente com Clientes configura a loja dele');
  assert.ok(auditoria().some((a) => a.por === 'gercli' && a.acao === 'robô do WhatsApp: mudou a configuração'));
});

test('campanha "Enviar pelo robô": admin, franqueado e gerente com Clientes ligam e alteram; vendedora e gerente sem Clientes não', async () => {
  const lista = [{ cpf: '11111111111', nome: 'Ana' }, { cpf: '22222222222', nome: 'Bia' }];
  const nova = (nome, extra) => post(nome, '/api/campanhas', { loja: 'l1', nome: 'Teste', mensagem: 'Oi, {nome}!', lista, ...extra });
  for (const nome of ['gersem', 'vend1']) assert.notStrictEqual((await nova(nome, { robo: true })).status, 200, nome);
  const c = (await (await nova('gercli')).json()).campanha;
  assert.strictEqual(c.robo, false, 'padrão desligado');
  const r = await put('gercli', `/api/campanhas/${c.id}`, { loja: 'l1', robo: true });
  assert.strictEqual(r.status, 200, 'gerente com Clientes liga o robô na campanha');
  assert.strictEqual((await r.json()).campanha.robo, true);
  // editar sem falar do robô não desliga
  assert.strictEqual((await (await put('dono1', `/api/campanhas/${c.id}`, { loja: 'l1', nome: 'Teste 2' })).json()).campanha.robo, true);
  // gerente com Clientes muda a mensagem de uma campanha do robô
  assert.strictEqual((await put('gercli', `/api/campanhas/${c.id}`, { loja: 'l1', mensagem: 'Outra coisa' })).status, 200);
  // quem não tem a tela Clientes não alcança a campanha
  for (const nome of ['gersem', 'vend1']) assert.notStrictEqual((await put(nome, `/api/campanhas/${c.id}`, { loja: 'l1', robo: false })).status, 200, nome);
  assert.strictEqual((await (await put('gercli', `/api/campanhas/${c.id}`, { loja: 'l1', robo: false })).json()).campanha.robo, false);
  const acoes = auditoria().map((a) => `${a.por}: ${a.acao}`);
  assert.ok(acoes.includes('gercli: campanha: ligou o envio pelo robô'));
  assert.ok(acoes.includes('gercli: campanha: tirou do robô'));
});

test('lista conferida (preparo): quem tem a tela Clientes manda; vendedora não; mudar a mensagem invalida', async () => {
  const c = (await (await post('dono1', '/api/campanhas', { loja: 'l1', nome: 'Prep', mensagem: 'Oi, {nome}!', robo: true, lista: [{ cpf: '33333333333', nome: 'Caio' }] })).json()).campanha;
  const corpo = { loja: 'l1', campanha: c.id, itens: [{ cpf: '33333333333', para: '5562933330000', v: { nome: 'Caio' } }, { cpf: '99999999999', para: '5562999990000', v: { nome: 'Intruso' } }] };
  assert.strictEqual((await put('vend1', '/api/zap/preparo', corpo)).status, 403);
  assert.strictEqual((await put('gersem', '/api/zap/preparo', corpo)).status, 403);
  assert.strictEqual((await put('dono1', '/api/zap/preparo', { ...corpo, loja: 'l2' })).status, 400);
  assert.strictEqual((await put('dono1', '/api/zap/preparo', { ...corpo, campanha: 'nao-existe' })).status, 400);
  const r = await put('gercli', '/api/zap/preparo', corpo);
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).clientes, 1, 'só quem está pendente na campanha');
  const arq = path.join(tmp, 'l1', 'zap', 'preparo.json');
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(arq, 'utf8'))[c.id].itens), ['33333333333']);
  await put('dono1', `/api/campanhas/${c.id}`, { loja: 'l1', mensagem: 'Texto novo, {nome}!' });
  assert.strictEqual(JSON.parse(fs.readFileSync(arq, 'utf8'))[c.id], undefined, 'mensagem mudou: precisa conferir de novo');
});

test('"Voltou a aceitar" na ficha desfaz o "parar" que veio pelo WhatsApp', async () => {
  const pasta = path.join(tmp, 'l1');
  fs.mkdirSync(path.join(pasta, 'zap'), { recursive: true });
  fs.writeFileSync(path.join(pasta, 'zap', 'naoquer.json'), JSON.stringify({ 5562944440000: { em: '2026-03-04T12:00:00.000Z', cpfs: ['44444444444'] }, 5562955550000: { em: '2026-03-04T12:00:00.000Z', cpfs: ['55555555555'] } }));
  const contatos = JSON.parse(fs.existsSync(path.join(pasta, 'contatos.json')) ? fs.readFileSync(path.join(pasta, 'contatos.json'), 'utf8') : '{}');
  contatos['44444444444'] = { optout: true, optoutEm: '2026-03-04T12:00:00.000Z', optoutPor: 'robô', optoutOrigem: 'respondeu parar pelo WhatsApp' };
  fs.writeFileSync(path.join(pasta, 'contatos.json'), JSON.stringify(contatos));
  const ct = (await (await pedir('dono1', '/api/contatos?loja=l1')).json()).contatos['44444444444'];
  assert.strictEqual(ct.optoutOrigem, 'respondeu parar pelo WhatsApp', 'a loja vê de onde veio');
  assert.strictEqual((await post('dono1', '/api/contatos', { loja: 'l1', cpf: '44444444444', acao: 'aceita' })).status, 200);
  assert.strictEqual((await (await pedir('dono1', '/api/contatos?loja=l1')).json()).contatos['44444444444'], undefined);
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(pasta, 'zap', 'naoquer.json'), 'utf8'))), ['5562955550000'], 'só o número desse cliente saiu');
});

test('RESUMO-05: envio manual (Hoje, ficha, Campanhas): o servidor recusa com 409 e a explicação quem já recebeu no intervalo; sem "envio" só registra', async () => {
  const cpf = '66666666666';
  const ok = await post('dono1', '/api/contatos', { loja: 'l1', cpf, acao: 'contatado', motivo: 'Hoje · Hora de repor', envio: true });
  assert.strictEqual(ok.status, 200, 'primeira mensagem: pode');
  const r = await post('dono1', '/api/contatos', { loja: 'l1', cpf, acao: 'contatado', motivo: 'Campanha: X', envio: true });
  assert.strictEqual(r.status, 409, 'segunda dentro do intervalo: não pode');
  const j = await r.json();
  assert.strictEqual(j.bloqueado, true);
  assert.match(j.erro, /já recebeu mensagem em .* \(Hoje · Hora de repor\)\. Regra da loja: uma mensagem a cada \d+ dias/);
  // "Marcar como contatado" (ligação) não é envio: só registra
  assert.strictEqual((await post('dono1', '/api/contatos', { loja: 'l1', cpf, acao: 'contatado', motivo: 'ligação/outro' })).status, 200);
});

test('apresentação: tudo simulado, nada chega ao robô nem é gravado', async () => {
  chamadas.length = 0;
  const antes = JSON.stringify(estado('l1'));
  const s = await (await fetch(BASE + '/api/demo/zap/situacao?loja=demo')).json();
  assert.strictEqual(s.demo, true); assert.strictEqual(s.conexao.estado, 'conectado'); assert.strictEqual(s.hoje.teto, 30);
  const sem = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
  assert.strictEqual((await (await fetch(BASE + '/api/demo/zap/pausar', sem)).json()).pausa.auto, false);
  assert.strictEqual((await (await fetch(BASE + '/api/demo/zap/ligar', sem)).json()).ligado, true);
  assert.strictEqual((await (await fetch(BASE + '/api/demo/zap/conectar', sem)).json()).conexao.estado, 'qr');
  assert.strictEqual((await (await fetch(BASE + '/api/demo/zap/desconectar', sem)).json()).conexao.estado, 'desligado');
  assert.strictEqual((await fetch(BASE + '/api/demo/zap/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...CFG, min: 10 }) })).status, 400);
  assert.strictEqual((await (await fetch(BASE + '/api/demo/zap/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...CFG, teto: 50 }) })).json()).cfg.teto, 50);
  assert.deepStrictEqual(chamadas, [], 'nada chegou ao robô');
  assert.strictEqual(JSON.stringify(estado('l1')), antes, 'nada gravado');
});
