'use strict';
// Testes do serviço do WhatsApp com um cliente DE MENTIRA: nada conecta, nada é enviado.
// Não precisam da biblioteca do WhatsApp nem do Chromium (rodam no CI só com o Node).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { criarServidor } = require('../server');
const { criarSessoes, ehSaida, fim4, erroCurto } = require('../sessoes');

const TOKEN = 'token-de-teste';
const NUM = '5562999998888';
const tique = () => new Promise((r) => setImmediate(r));

/** Fábrica de clientes de mentira; `clientes[loja]` é o último criado para a loja. */
function fabricaDeMentira() {
  const clientes = {};
  const todos = [];
  const fabrica = (loja) => {
    const c = new EventEmitter();
    Object.assign(c, {
      loja, enviadas: [], digitou: [], iniciou: 0, saiu: 0, fechou: 0, emEnvio: 0, maxJuntos: 0,
      semWhatsapp: new Set(), erroConferir: null, erroEnviar: null, erroIniciar: null, erroCodigo: null,
      vivoResp: true, segurar: null,
      async iniciar() { c.iniciou++; if (c.erroIniciar) throw c.erroIniciar; },
      async pedirCodigo() { if (c.erroCodigo) throw c.erroCodigo; return 'ABCD1234'; },
      async temWhatsapp(n) { if (c.erroConferir) throw c.erroConferir; return c.semWhatsapp.has(n) ? null : n + '@c.us'; },
      async digitando(d) { c.digitou.push(d); },
      async enviar(d, texto) {
        c.emEnvio++; c.maxJuntos = Math.max(c.maxJuntos, c.emEnvio);
        try {
          if (c.segurar) await c.segurar;
          await tique();
          if (c.erroEnviar) throw c.erroEnviar;
          c.enviadas.push({ d, texto });
          return 'msg' + c.enviadas.length;
        } finally { c.emEnvio--; }
      },
      midias: new Map(), erroMidia: null,
      async midia(id, limite) { if (c.erroMidia) throw c.erroMidia; const m = c.midias.get(id); if (!m) return null; return limite && m.dados.length > limite ? { grande: true } : m; },
      aliviou: 0, async aliviar() { c.aliviou++; },
      async vivo() { return c.vivoResp; },
      async sair() { c.saiu++; },
      async fechar() { c.fechou++; },
    });
    clientes[loja] = c; todos.push(c);
    return c;
  };
  return { fabrica, clientes, todos };
}

function montar(extra = {}) {
  const f = fabricaDeMentira();
  const logs = [];
  const agendados = [];
  const sessoes = criarSessoes({
    fabrica: f.fabrica, espera: async () => {}, digitandoMs: [0, 0], log: (m) => logs.push(m),
    agendar: (fn, ms) => { agendados.push({ fn, ms }); }, ...extra,
  });
  return { ...f, sessoes, logs, agendados };
}

async function conectado(m, loja = 'loja1') {
  await m.sessoes.conectar(loja, {});
  m.clientes[loja].emit('pronto', { numero: '5562911112222' });
  return m.clientes[loja];
}

async function comServidor(fn, extra = {}) {
  const m = montar(extra);
  const { servidor } = criarServidor({ token: TOKEN, sessoes: m.sessoes, log: (x) => m.logs.push(x) });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + servidor.address().port;
  const chamar = async (metodo, caminho, corpo, token = TOKEN) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { ...(token ? { 'X-Zap-Token': token } : {}), ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)),
    });
    return { status: r.status, json: await r.json() };
  };
  try { await fn({ ...m, chamar }); } finally { await new Promise((r) => servidor.close(r)); }
}

// ---------- token ----------
test('sem o token certo, toda rota responde 401 (até /saude)', async () => {
  await comServidor(async ({ chamar, todos }) => {
    for (const t of [null, 'errado', TOKEN + 'x']) {
      assert.strictEqual((await chamar('GET', '/saude', undefined, t)).status, 401);
      assert.strictEqual((await chamar('GET', '/status/loja1', undefined, t)).status, 401);
      assert.strictEqual((await chamar('POST', '/conectar/loja1', {}, t)).status, 401);
      assert.strictEqual((await chamar('POST', '/enviar/loja1', { id: 'a', para: NUM, texto: 'oi' }, t)).status, 401);
    }
    assert.strictEqual(todos.length, 0, 'nenhum cliente pode ter sido criado');
    const ok = await chamar('GET', '/saude');
    assert.deepStrictEqual([ok.status, ok.json], [200, { ok: true }]);
  });
});

test('serviço sem ZAP_TOKEN configurado recusa tudo, mesmo com cabeçalho vazio', async () => {
  const m = montar();
  const { servidor } = criarServidor({ token: '', sessoes: m.sessoes, log: () => {} });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  try {
    const base = 'http://127.0.0.1:' + servidor.address().port;
    assert.strictEqual((await fetch(base + '/saude')).status, 401);
    assert.strictEqual((await fetch(base + '/saude', { headers: { 'X-Zap-Token': '' } })).status, 401);
  } finally { await new Promise((r) => servidor.close(r)); }
});

// ---------- id da loja e rotas ----------
test('id de loja inválido é recusado (400) e não cria cliente', async () => {
  await comServidor(async ({ chamar, todos }) => {
    for (const loja of ['Loja1', 'loja.1', 'a%20b', 'x'.repeat(41), 'loja%2Foutra']) {
      assert.strictEqual((await chamar('GET', '/status/' + loja)).status, 400, loja);
      assert.strictEqual((await chamar('POST', '/conectar/' + loja, {})).status, 400, loja);
      assert.strictEqual((await chamar('POST', '/enviar/' + loja, { id: 'a', para: NUM, texto: 'oi' })).status, 400, loja);
      assert.strictEqual((await chamar('GET', '/optouts/' + loja)).status, 400, loja);
    }
    assert.strictEqual(todos.length, 0);
    assert.strictEqual((await chamar('GET', '/status/..')).status, 404);
    assert.strictEqual((await chamar('GET', '/status/%2e%2e%2Fx')).status, 400);
    assert.strictEqual((await chamar('GET', '/status/loja1/extra')).status, 404);
    assert.strictEqual((await chamar('GET', '/nada/loja1')).status, 404);
    assert.strictEqual((await chamar('GET', '/enviar/loja1')).status, 405);
    assert.strictEqual((await chamar('POST', '/status/loja1', {})).status, 405);
    assert.strictEqual((await chamar('POST', '/enviar/loja1', '{quebrado')).status, 400);
  });
});

// ---------- situações do /status ----------
test('status: desligado → iniciando → qr → conectado → desligado', async () => {
  await comServidor(async ({ chamar, clientes }) => {
    const vazio = { estado: 'desligado', qr: null, codigo: null, numeroFim: null, desde: null, erro: null };
    assert.deepStrictEqual((await chamar('GET', '/status/loja1')).json, vazio);

    assert.deepStrictEqual((await chamar('POST', '/conectar/loja1', {})).json, { ok: true });
    assert.strictEqual((await chamar('GET', '/status/loja1')).json.estado, 'iniciando');
    const c = clientes.loja1;
    assert.strictEqual(c.iniciou, 1);

    c.emit('qr', 'data:image/png;base64,AAAA');
    let st = (await chamar('GET', '/status/loja1')).json;
    assert.deepStrictEqual([st.estado, st.qr, st.codigo], ['qr', 'data:image/png;base64,AAAA', null]);

    c.emit('pronto', { numero: '5562911112222' });
    st = (await chamar('GET', '/status/loja1')).json;
    assert.deepStrictEqual([st.estado, st.qr, st.codigo, st.numeroFim, st.erro], ['conectado', null, null, '2222', null]);
    assert.ok(!Number.isNaN(Date.parse(st.desde)));
    assert.ok(!JSON.stringify(st).includes('5562911112222'), 'o número inteiro nunca sai no status');

    // conectar de novo já conectado não abre outro navegador
    await chamar('POST', '/conectar/loja1', {});
    assert.strictEqual(clientes.loja1, c);

    assert.deepStrictEqual((await chamar('POST', '/desconectar/loja1')).json, { ok: true });
    assert.deepStrictEqual([c.saiu, c.fechou], [1, 1]);
    assert.deepStrictEqual((await chamar('GET', '/status/loja1')).json, vazio);
    // outra loja não é afetada
    assert.strictEqual((await chamar('GET', '/status/loja2')).json.estado, 'desligado');
  });
});

test('status: pareamento por código mostra o código (e não o QR); número inválido é recusado', async () => {
  await comServidor(async ({ chamar, clientes }) => {
    assert.strictEqual((await chamar('POST', '/conectar/loja1', { numero: '123' })).status, 400);
    assert.strictEqual(clientes.loja1, undefined);
    await chamar('POST', '/conectar/loja1', { numero: '+55 (62) 99999-8888' });
    clientes.loja1.emit('qr', 'data:image/png;base64,AAAA');
    await tique();
    let st = (await chamar('GET', '/status/loja1')).json;
    assert.deepStrictEqual([st.estado, st.codigo, st.qr], ['codigo', 'ABCD1234', null]);
    clientes.loja1.emit('qr', 'data:image/png;base64,BBBB');       // o QR continua trocando por baixo
    clientes.loja1.emit('codigo', 'WXYZ9876');                     // o WhatsApp renova o código
    await tique();
    st = (await chamar('GET', '/status/loja1')).json;
    assert.deepStrictEqual([st.estado, st.codigo, st.qr], ['codigo', 'WXYZ9876', null]);
  });
});

test('código recusado 3 vezes volta para o QR', async () => {
  const m = montar();
  await m.sessoes.conectar('loja1', { numero: NUM });
  const c = m.clientes.loja1;
  c.erroCodigo = new Error('t');
  for (let i = 0; i < 3; i++) { c.emit('qr', 'data:qr' + i); await tique(); }
  assert.strictEqual(m.sessoes.status('loja1').estado, 'iniciando');
  c.emit('qr', 'data:qr-final');
  const st = m.sessoes.status('loja1');
  assert.deepStrictEqual([st.estado, st.qr], ['qr', 'data:qr-final']);
});

test('status: caiu por logout, QR que ninguém leu e falha ao abrir', async () => {
  const m = montar();
  const c = await conectado(m);
  c.emit('caiu', { tipo: 'logout', detalhe: 'LOGOUT' });
  await tique();
  let st = m.sessoes.status('loja1');
  assert.strictEqual(st.estado, 'caiu');
  assert.match(st.erro, /Conecte de novo/);
  assert.strictEqual(st.numeroFim, null);
  assert.strictEqual(c.fechou, 1);
  c.emit('pronto', { numero: '1' });                                // evento de cliente antigo é ignorado
  assert.strictEqual(m.sessoes.status('loja1').estado, 'caiu');

  await m.sessoes.conectar('loja2', {});
  m.clientes.loja2.emit('qr', 'data:x');
  m.clientes.loja2.emit('caiu', { tipo: 'qr_expirou', detalhe: 'Max qrcode retries reached' });
  st = m.sessoes.status('loja2');
  assert.strictEqual(st.estado, 'desligado');
  assert.match(st.erro, /não foi lido a tempo/);
  assert.strictEqual(st.qr, null);

  const m2 = montar();
  const original = m2.fabrica;
  const s2 = criarSessoes({ fabrica: (l, o) => { const cli = original(l, o); cli.erroIniciar = new Error('Failed to launch the browser process'); return cli; }, log: () => {} });
  await s2.conectar('loja3', {});
  await tique();
  st = s2.status('loja3');
  assert.strictEqual(st.estado, 'caiu');
  assert.match(st.erro, /Não foi possível abrir o WhatsApp/);
});

test('queda sem logout: religa sozinho com espera crescente e desiste depois das tentativas', async () => {
  const m = montar({ reconexoes: [10, 20] });
  let c = await conectado(m);
  c.emit('caiu', { tipo: 'queda', detalhe: 'CONFLICT' });
  await tique();
  let st = m.sessoes.status('loja1');
  assert.strictEqual(st.estado, 'iniciando');
  assert.match(st.erro, /Reconectando/);
  assert.deepStrictEqual(m.agendados.map((a) => a.ms), [10]);
  m.agendados[0].fn();
  assert.notStrictEqual(m.clientes.loja1, c);
  c = m.clientes.loja1;
  c.emit('pronto', { numero: '5562911112222' });
  assert.strictEqual(m.sessoes.status('loja1').estado, 'conectado');

  // agora cai e não volta mais
  c.emit('caiu', { tipo: 'queda' }); await tique();
  m.agendados[1].fn(); m.clientes.loja1.emit('caiu', { tipo: 'queda' }); await tique();
  assert.strictEqual(m.agendados[2].ms, 20);
  m.agendados[2].fn(); m.clientes.loja1.emit('caiu', { tipo: 'queda' }); await tique();
  st = m.sessoes.status('loja1');
  assert.strictEqual(st.estado, 'caiu');
  assert.match(st.erro, /Não voltou sozinho/);
  assert.strictEqual(m.agendados.length, 3);
});

test('conferência periódica: cliente que não responde é religado', async () => {
  const m = montar();
  const c = await conectado(m);
  await m.sessoes.vigiar();
  assert.strictEqual(m.sessoes.status('loja1').estado, 'conectado');
  c.vivoResp = false;
  await m.sessoes.vigiar();
  assert.strictEqual(m.sessoes.status('loja1').estado, 'iniciando');
  assert.strictEqual(c.fechou, 1);
});

test('ZAP-MEM-02: a conferência periódica alivia a memória só de quem respondeu', async () => {
  const m = montar();
  const c = await conectado(m);
  await m.sessoes.vigiar();
  assert.strictEqual(c.aliviou, 1);
  c.aliviar = async () => { throw new Error('Protocol error'); };
  await m.sessoes.vigiar();
  assert.strictEqual(m.sessoes.status('loja1').estado, 'conectado', 'falha ao aliviar não religa');
  c.vivoResp = false; c.aliviar = async () => { c.aliviou++; };
  await m.sessoes.vigiar();
  assert.strictEqual(c.aliviou, 1, 'quem não respondeu não é aliviado (é religado)');
});

test('ZAP-MEM-01: Chromium econômico por padrão; ZAP_ECONOMIA=0 volta ao antigo; ZAP_CHROMIUM_ARGS acrescenta', () => {
  const { argsChromium } = require('../sessoes');
  const padrao = argsChromium({});
  assert.ok(padrao.includes('--no-sandbox') && padrao.includes('--blink-settings=imagesEnabled=false'));
  assert.ok(padrao.some((a) => a.startsWith('--disable-features=')));
  const antigo = argsChromium({ ZAP_ECONOMIA: '0' });
  assert.deepStrictEqual(antigo, ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']);
  const extra = argsChromium({ ZAP_ECONOMIA: '0', ZAP_CHROMIUM_ARGS: '--foo=1  rm -rf --bar ;x' });
  assert.deepStrictEqual(extra.slice(4), ['--foo=1', '--bar'], 'só opções no formato --nome[=valor]');
});

// ---------- envio ----------
test('enviar: ok, sem_whatsapp, desconectado e falha', async () => {
  await comServidor(async ({ chamar, clientes, sessoes }) => {
    let r = await chamar('POST', '/enviar/loja1', { id: 'a1', para: NUM, texto: 'Olá!' });
    assert.deepStrictEqual([r.status, r.json.ok, r.json.motivo], [200, false, 'desconectado']);
    assert.strictEqual(clientes.loja1, undefined, 'enviar não liga o WhatsApp sozinho');

    await sessoes.conectar('loja1', {});
    r = await chamar('POST', '/enviar/loja1', { id: 'a2', para: NUM, texto: 'Olá!' });
    assert.strictEqual(r.json.motivo, 'desconectado', 'ainda mostrando o QR não envia');
    const c = clientes.loja1;
    c.emit('pronto', { numero: '5562911112222' });

    r = await chamar('POST', '/enviar/loja1', { id: 'a3', para: '(62) 99999-8888 55'.replace(/\D/g, '').replace(/^(\d{11})55$/, '55$1'), texto: 'Olá!' });
    assert.deepStrictEqual([r.status, r.json], [200, { ok: true, idMsg: 'msg1' }]);
    assert.deepStrictEqual(c.enviadas, [{ d: NUM + '@c.us', texto: 'Olá!' }]);
    assert.deepStrictEqual(c.digitou, [NUM + '@c.us'], 'simula "digitando" antes de enviar');

    c.semWhatsapp.add('5562988887777');
    r = await chamar('POST', '/enviar/loja1', { id: 'a4', para: '5562988887777', texto: 'Olá!' });
    assert.deepStrictEqual([r.status, r.json.ok, r.json.motivo], [200, false, 'sem_whatsapp']);
    assert.strictEqual(c.enviadas.length, 1);

    c.erroEnviar = new Error('Evaluation failed para 5562977776666@c.us');
    r = await chamar('POST', '/enviar/loja1', { id: 'a5', para: '5562977776666', texto: 'Olá!' });
    assert.deepStrictEqual([r.status, r.json.ok, r.json.motivo], [200, false, 'falha']);
    assert.ok(!r.json.erro.includes('5562977776666'), 'o erro não devolve o número inteiro');

    for (const corpo of [{ para: NUM, texto: 'x' }, { id: 'b', para: '12', texto: 'x' }, { id: 'b', para: NUM }, { id: 'b', para: NUM, texto: '   ' }, { id: 'b', para: NUM, texto: 'x'.repeat(5000) }]) {
      assert.strictEqual((await chamar('POST', '/enviar/loja1', corpo)).status, 400);
    }
  });
});

test('enviar: o mesmo id em 24 h devolve o resultado anterior sem reenviar', async () => {
  let relogio = Date.parse('2026-01-10T12:00:00Z');
  const m = montar({ agora: () => relogio });
  const c = await conectado(m);
  const a = await m.sessoes.enviar('loja1', { id: 'c1:cli9', para: NUM, texto: 'Promoção' });
  const b = await m.sessoes.enviar('loja1', { id: 'c1:cli9', para: NUM, texto: 'Promoção' });
  assert.deepStrictEqual(a, { ok: true, idMsg: 'msg1' });
  assert.deepStrictEqual(b, a);
  assert.strictEqual(c.enviadas.length, 1);

  // sem WhatsApp também é lembrado (não confere de novo)
  c.semWhatsapp.add('5562988887777');
  await m.sessoes.enviar('loja1', { id: 'c1:cli2', para: '5562988887777', texto: 'x' });
  c.semWhatsapp.clear();
  assert.strictEqual((await m.sessoes.enviar('loja1', { id: 'c1:cli2', para: '5562988887777', texto: 'x' })).motivo, 'sem_whatsapp');

  // falha DEPOIS de mandar para o WhatsApp pode ter saído: o mesmo id nunca reenvia
  c.erroEnviar = new Error('timeout');
  assert.strictEqual((await m.sessoes.enviar('loja1', { id: 'c1:cli3', para: NUM, texto: 'x' })).motivo, 'falha');
  c.erroEnviar = null;
  assert.strictEqual((await m.sessoes.enviar('loja1', { id: 'c1:cli3', para: NUM, texto: 'x' })).motivo, 'falha');
  assert.strictEqual(c.enviadas.length, 1);

  // falha ANTES de enviar (não conseguiu conferir o número) e "desconectado" não ficam presos ao id
  c.erroConferir = new Error('detached Frame');
  assert.strictEqual((await m.sessoes.enviar('loja1', { id: 'c1:cli4', para: NUM, texto: 'x' })).motivo, 'falha');
  c.erroConferir = null;
  assert.strictEqual((await m.sessoes.enviar('loja1', { id: 'c1:cli4', para: NUM, texto: 'x' })).ok, true);
  assert.strictEqual(c.enviadas.length, 2);

  // passadas 24 h o id volta a valer
  relogio += 24 * 60 * 60 * 1000 + 1000;
  assert.strictEqual((await m.sessoes.enviar('loja1', { id: 'c1:cli9', para: NUM, texto: 'Promoção' })).ok, true);
  assert.strictEqual(c.enviadas.length, 3);
});

test('enviar: mesmo id chegando duas vezes ao mesmo tempo sai uma vez só', async () => {
  const m = montar();
  const c = await conectado(m);
  const [a, b] = await Promise.all([
    m.sessoes.enviar('loja1', { id: 'dup', para: NUM, texto: 'x' }),
    m.sessoes.enviar('loja1', { id: 'dup', para: NUM, texto: 'x' }),
  ]);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(c.enviadas.length, 1);
});

test('enviar: um envio por vez por loja (o segundo espera o primeiro), lojas diferentes não se travam', async () => {
  const m = montar();
  const c1 = await conectado(m, 'loja1');
  const c2 = await conectado(m, 'loja2');
  let soltar;
  c1.segurar = new Promise((r) => { soltar = r; });
  const p1 = m.sessoes.enviar('loja1', { id: 'e1', para: NUM, texto: 'um' });
  const p2 = m.sessoes.enviar('loja1', { id: 'e2', para: '5562988887777', texto: 'dois' });
  const p3 = m.sessoes.enviar('loja1', { id: 'e3', para: '5562977776666', texto: 'três' });
  for (let i = 0; i < 20; i++) await tique();
  assert.strictEqual(c1.emEnvio, 1);
  assert.strictEqual(c1.digitou.length, 1, 'o segundo nem começou');
  assert.strictEqual((await m.sessoes.enviar('loja2', { id: 'e1', para: NUM, texto: 'outra loja' })).ok, true);
  assert.strictEqual(c2.enviadas.length, 1);
  soltar();
  await Promise.all([p1, p2, p3]);
  assert.strictEqual(c1.maxJuntos, 1);
  assert.deepStrictEqual(c1.enviadas.map((e) => e.texto), ['um', 'dois', 'três']);
});

test('enviar: WhatsApp que não responde vira falha (não trava a fila)', async () => {
  const m = montar({ limiteEnvioMs: 30 });
  const c = await conectado(m);
  c.segurar = new Promise(() => {});
  const r = await m.sessoes.enviar('loja1', { id: 'lento', para: NUM, texto: 'x' });
  assert.deepStrictEqual([r.ok, r.motivo], [false, 'falha']);
});

// ---------- respostas de "parar" ----------
test('palavras de saída: sem acento/maiúsculas, palavra inteira, mensagem curta', () => {
  for (const t of ['parar', 'PARAR!', ' Sair ', 'não quero', 'NAO QUERO mais', 'Remover', 'descadastrar.', 'quero sair', 'pode parar por favor', 'Não quero receber mensagens']) {
    assert.strictEqual(ehSaida(t), true, t);
  }
  for (const t of ['', null, 'oi', 'obrigada!', 'separar', 'saira', 'quero', 'preparar o chá', 'qual o preço?',
    'Oi, tudo bem? Eu queria saber se vocês ainda têm aquele chá de hibisco, porque não quero ficar sem ele no fim do mês']) {
    assert.strictEqual(ehSaida(t), false, String(t));
  }
});

test('optouts: só recebidas em conversa individual com palavra de saída; o texto não é guardado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-teste-'));
  try {
    let relogio = Date.parse('2026-01-10T12:00:00Z');
    await comServidor(async ({ chamar, clientes, sessoes, logs }) => {
      await sessoes.conectar('loja1', {});
      const c = clientes.loja1;
      c.emit('pronto', { numero: '5562911112222' });
      c.emit('mensagem', { de: '5562999990001', texto: 'PARAR', grupo: false, minha: false });
      c.emit('mensagem', { de: '5562999990002', texto: 'Oi, quero comprar o chá verde SEGREDO-123', grupo: false, minha: false });
      c.emit('mensagem', { de: '5562999990003', texto: 'sair', grupo: true, minha: false });      // grupo
      c.emit('mensagem', { de: '5562999990004', texto: 'parar', grupo: false, minha: true });     // enviada por nós
      c.emit('mensagem', { de: 'abc', texto: 'parar', grupo: false, minha: false });              // sem número
      relogio += 60000;
      c.emit('mensagem', { de: '5562999990005', texto: 'Não quero', grupo: false, minha: false });
      relogio += 60000;
      c.emit('mensagem', { de: '5562999990001', texto: 'parar', grupo: false, minha: false });    // repetiu: fica só a última

      let r = await chamar('GET', '/optouts/loja1');
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.json.itens, [
        { de: '5562999990005', em: '2026-01-10T12:01:00.000Z' },
        { de: '5562999990001', em: '2026-01-10T12:02:00.000Z' },
      ]);
      r = await chamar('GET', '/optouts/loja1?desde=' + encodeURIComponent('2026-01-10T12:01:30.000Z'));
      assert.deepStrictEqual(r.json.itens.map((i) => i.de), ['5562999990001']);
      assert.strictEqual((await chamar('GET', '/optouts/loja1?desde=ontem')).status, 400);
      assert.deepStrictEqual((await chamar('GET', '/optouts/loja2')).json, { itens: [] });

      // nada do texto recebido nem número inteiro: nem na resposta, nem no disco, nem no log
      await chamar('POST', '/enviar/loja1', { id: 'z1', para: NUM, texto: 'Texto da campanha SEGREDO-456' });
      const disco = fs.readdirSync(path.join(dir, 'loja1')).map((n) => fs.readFileSync(path.join(dir, 'loja1', n), 'utf8')).join('\n');
      const tudoLog = logs.join('\n');
      for (const proibido of ['SEGREDO', 'PARAR', 'Não quero']) {
        assert.ok(!disco.includes(proibido), 'disco: ' + proibido);
        assert.ok(!tudoLog.includes(proibido), 'log: ' + proibido);
      }
      assert.ok(!/\d{8,}/.test(tudoLog), 'log só com os 4 últimos dígitos: ' + tudoLog);
      assert.match(tudoLog, /\*\*\*0001/);
      assert.match(tudoLog, /\*\*\*8888/);
    }, { workDir: dir, agora: () => relogio });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fim4 e erroCurto escondem o número', () => {
  assert.strictEqual(fim4('5562999998888'), '***8888');
  assert.strictEqual(fim4(''), '***');
  assert.strictEqual(erroCurto(new Error('No LID for user 5562999998888@c.us')), 'No LID for user ***8888@c.us');
});

// ---------- disco: reconexão ao subir, sessão apagada, id lembrado depois de reiniciar ----------
test('ao subir reconecta só as lojas que já estavam conectadas; desconectar apaga a sessão', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-teste-'));
  try {
    const m = montar({ workDir: dir });
    const c = await conectado(m, 'loja1');
    fs.mkdirSync(path.join(dir, 'loja1', 'session', 'Default'), { recursive: true });   // o que o navegador gravaria
    await m.sessoes.conectar('loja2', {});                                              // só mostrou o QR, nunca conectou
    fs.mkdirSync(path.join(dir, 'loja2', 'session'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'Pasta Estranha'), { recursive: true });
    assert.strictEqual((await m.sessoes.enviar('loja1', { id: 'k1', para: NUM, texto: 'x' })).ok, true);
    await m.sessoes.fechar();                                                           // SIGTERM
    assert.strictEqual(c.fechou, 1);
    assert.strictEqual(c.saiu, 0, 'derrubar o serviço não sai do WhatsApp');

    // serviço novo, mesma pasta
    const n = montar({ workDir: dir });
    assert.deepStrictEqual(n.sessoes.retomar(), ['loja1']);
    assert.strictEqual(n.sessoes.status('loja1').estado, 'iniciando');
    assert.strictEqual(n.sessoes.status('loja2').estado, 'desligado');
    assert.strictEqual(n.clientes.loja2, undefined);
    n.clientes.loja1.emit('pronto', { numero: '5562911112222' });
    // o id enviado antes de reiniciar continua lembrado
    assert.deepStrictEqual(await n.sessoes.enviar('loja1', { id: 'k1', para: NUM, texto: 'x' }), { ok: true, idMsg: 'msg1' });
    assert.strictEqual(n.clientes.loja1.enviadas.length, 0);

    await n.sessoes.desconectar('loja1');
    assert.strictEqual(fs.existsSync(path.join(dir, 'loja1', 'session')), false);
    assert.strictEqual(n.clientes.loja1.saiu, 1);
    assert.deepStrictEqual(montar({ workDir: dir }).sessoes.retomar(), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ao subir, reabre uma loja por vez (a segunda espera a vez): duas juntas deixavam a primeira lenta demais', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-teste-'));
  try {
    const m = montar({ workDir: dir });
    await conectado(m, 'goiania'); await conectado(m, 'torres');
    await m.sessoes.fechar();
    const n = montar({ workDir: dir, espacoRetomar: 45000 });
    const voltaram = n.sessoes.retomar();
    assert.strictEqual(voltaram.length, 2);
    const [primeira, segunda] = voltaram;
    assert.ok(n.clientes[primeira], 'a primeira abre na hora');
    assert.strictEqual(n.clientes[segunda], undefined, 'a segunda ainda não abriu');
    assert.strictEqual(n.sessoes.status(segunda).estado, 'iniciando');
    const vez = n.agendados.find((a) => a.ms === 45000);
    assert.ok(vez, 'a vez da segunda foi agendada para 45 s');
    vez.fn();
    assert.ok(n.clientes[segunda], 'na vez dela, abre');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sessão salva que o WhatsApp não aceita mais (pediu QR e ninguém leu) fica como "caiu" e não insiste ao subir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-teste-'));
  try {
    const m = montar({ workDir: dir });
    await conectado(m, 'loja1');
    await m.sessoes.fechar();
    const n = montar({ workDir: dir });
    n.sessoes.retomar();
    n.clientes.loja1.emit('qr', 'data:x');
    assert.strictEqual(n.sessoes.status('loja1').estado, 'qr');
    n.clientes.loja1.emit('caiu', { tipo: 'qr_expirou' });
    const st = n.sessoes.status('loja1');
    assert.strictEqual(st.estado, 'caiu');
    assert.match(st.erro, /não vale mais/);
    assert.deepStrictEqual(montar({ workDir: dir }).sessoes.retomar(), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('os testes não carregam a biblioteca do WhatsApp', () => {
  assert.ok(!Object.keys(require.cache).some((f) => /whatsapp-web\.js|puppeteer|[\\/]qrcode[\\/]/.test(f)));
  assert.ok(!Object.keys(require.cache).some((f) => f.endsWith(path.join('zap', 'wa.js'))));
});

// ---------- conversas (Clientes → Conversas do painel) ----------
test('CONV-01: conversas — guarda as mensagens individuais (sem repetir), o painel busca de 500 em 500 e o texto não vai para o log', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-teste-'));
  try {
    await comServidor(async ({ chamar, clientes, sessoes, logs }) => {
      await sessoes.conectar('loja1', {});
      const c = clientes.loja1;
      c.emit('pronto', { numero: '5562911112222' });
      const m = (k, o = {}) => ({ id: 'm' + k, chat: '5562999990001', deMim: false, em: '2026-01-10T12:0' + k + ':00Z', tipo: 'texto', texto: 'Oi SEGREDO-' + k, nome: 'Ana', ...o });
      c.emit('conversa', m(1));
      c.emit('conversa', m(2, { deMim: true, nome: 'não guarda' }));
      c.emit('conversa', m(1));                                          // repetida: ignora
      c.emit('conversa', m(3, { chat: 'lid:123456789', tipo: 'audio', texto: '' }));
      c.emit('conversa', m(4, { chat: '120363@g.us' }));                 // grupo: não
      c.emit('conversa', m(5, { tipo: 'chamada' }));                     // tipo desconhecido: não
      let r = await chamar('GET', '/conversas/loja1');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.ultimo, 3);
      assert.deepStrictEqual(r.json.itens.map((x) => [x.seq, x.id, x.chat, x.deMim, x.tipo, x.nome || '']), [[1, 'm1', '5562999990001', false, 'texto', 'Ana'], [2, 'm2', '5562999990001', true, 'texto', ''], [3, 'm3', 'lid:123456789', false, 'audio', 'Ana']]);
      r = await chamar('GET', '/conversas/loja1?desde=2');
      assert.deepStrictEqual(r.json.itens.map((x) => x.id), ['m3']);
      assert.strictEqual((await chamar('GET', '/conversas/loja1?desde=-1')).status, 400);
      assert.ok(!logs.join('\n').includes('SEGREDO'), 'o texto das conversas nunca vai para o log');
      // desconectar apaga as conversas daqui; a sequência continua (o painel não recebe de novo o que já tem)
      await sessoes.desconectar('loja1');
      r = await chamar('GET', '/conversas/loja1?desde=0');
      assert.deepStrictEqual(r.json, { ultimo: 3, itens: [], mais: false });
    }, { workDir: dir, agendar: (fn) => fn() });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CONV-02: histórico — só com o WhatsApp conectado; importa os últimos dias sem repetir e diz a situação no status', async () => {
  await comServidor(async ({ chamar, clientes, sessoes, logs }) => {
    assert.deepStrictEqual((await chamar('POST', '/historico/loja1', { dias: 30 })).json, { ok: false, erro: 'O WhatsApp desta loja não está conectado.' });
    await sessoes.conectar('loja1', {});
    const c = clientes.loja1;
    let pediu = null;
    c.historico = async (dias) => { pediu = dias; return [{ id: 'h1', chat: '5562999990001', deMim: false, em: '2026-01-01T10:00:00Z', tipo: 'texto', texto: 'antiga' }, { id: 'h1', chat: '5562999990001', deMim: false, em: '2026-01-01T10:00:00Z', tipo: 'texto', texto: 'antiga' }, { id: 'h2', chat: 'x', deMim: false, em: '2026-01-01T10:00:00Z', tipo: 'texto' }]; };
    c.emit('pronto', { numero: '5562911112222' });
    assert.strictEqual((await chamar('POST', '/historico/loja1', { dias: 200 })).status, 400, 'no máximo 90 dias');
    assert.deepStrictEqual((await chamar('POST', '/historico/loja1', { dias: 30 })).json, { ok: true });
    await tique(); await tique();
    assert.strictEqual(pediu, 30);
    const st = (await chamar('GET', '/status/loja1')).json;
    assert.strictEqual(st.historico.estado, 'ok');
    assert.strictEqual(st.historico.mensagens, 1, 'repetida e conversa sem número válido ficam de fora');
    assert.deepStrictEqual((await chamar('GET', '/conversas/loja1')).json.itens.map((x) => x.id), ['h1']);
    assert.match(logs.join('\n'), /histórico de 30 dias importado \(1 mensagens\)/);
  });
});

test('CONV-14: mídia sob demanda — devolve o arquivo da memória (nada em disco), 404 quando o WhatsApp não tem mais, 413 grande demais, 409 desconectado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-midia-'));
  try {
    await comServidor(async ({ clientes, sessoes, logs }) => {
      const { MIDIA_MAX } = require('../sessoes');
      // desconectado
      let r = await sessoes.midia('loja1', 'false_5562999990001@c.us_ABC123');
      assert.deepStrictEqual([r.ok, r.codigo], [false, 409]);
      await sessoes.conectar('loja1', {});
      const c = clientes.loja1;
      c.emit('pronto', { numero: '5562911112222' });
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      c.midias.set('false_5562999990001@c.us_ABC123', { dados: png, mimetype: 'image/png', nome: 'SEGREDO-nome.png' });
      c.midias.set('false_5562999990001@c.us_GRANDE', { dados: Buffer.alloc(MIDIA_MAX + 1), mimetype: 'video/mp4', nome: null });
      r = await sessoes.midia('loja1', 'false_5562999990001@c.us_ABC123');
      assert.strictEqual(r.ok, true);
      assert.ok(r.dados.equals(png));
      assert.strictEqual(r.mimetype, 'image/png');
      assert.deepStrictEqual([(await sessoes.midia('loja1', 'false_5562999990001@c.us_SUMIU')).codigo], [404]);
      assert.deepStrictEqual([(await sessoes.midia('loja1', 'false_5562999990001@c.us_GRANDE')).codigo], [413]);
      await assert.rejects(() => sessoes.midia('loja1', '../etc/passwd'), /Mensagem inválida/);
      c.erroMidia = new Error('Evaluation failed');
      assert.strictEqual((await sessoes.midia('loja1', 'false_5562999990001@c.us_ABC123')).codigo, 502);
      c.erroMidia = null;
      // nada gravado na pasta do serviço; o nome do arquivo nunca no log
      const arquivos = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String) : [];
      assert.ok(!arquivos.some((x) => /png|mp4|midia/i.test(x)), 'nenhum arquivo de mídia em disco: ' + arquivos.join(','));
      assert.ok(!logs.join('\n').includes('SEGREDO'), 'o nome do arquivo não vai para o log');
    }, { workDir: dir });
    // pela API (binário, com o token)
    await comServidor(async ({ clientes, sessoes }) => {
      await sessoes.conectar('loja1', {});
      const c = clientes.loja1;
      c.emit('pronto', { numero: '5562911112222' });
      c.midias.set('false_5562999990001@c.us_ABC123', { dados: Buffer.from('OGG!'), mimetype: 'audio/ogg; codecs=opus', nome: null });
      const { criarServidor: cs } = require('../server');
      const { servidor } = cs({ token: TOKEN, sessoes, log: () => {} });
      await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
      try {
        const url = 'http://127.0.0.1:' + servidor.address().port + '/midia/loja1?id=';
        let r = await fetch(url + encodeURIComponent('false_5562999990001@c.us_ABC123'), { headers: { 'X-Zap-Token': TOKEN } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.headers.get('content-type'), 'audio/ogg; codecs=opus');
        assert.strictEqual(r.headers.get('cache-control'), 'no-store');
        assert.strictEqual(Buffer.from(await r.arrayBuffer()).toString(), 'OGG!');
        r = await fetch(url + 'false_x@c.us_SUMIU', { headers: { 'X-Zap-Token': TOKEN } });
        assert.strictEqual(r.status, 404);
        r = await fetch(url + 'false_x@c.us_SUMIU');
        assert.strictEqual(r.status, 401, 'sem o token não entra');
      } finally { await new Promise((ok) => servidor.close(ok)); }
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
