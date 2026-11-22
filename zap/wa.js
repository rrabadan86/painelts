'use strict';
/**
 * wa.js — o cliente do WhatsApp DE VERDADE de uma loja (whatsapp-web.js + Chromium).
 *
 * Adaptado do robô do outro projeto do dono (wa-client.js): sessão salva em disco (LocalAuth) para
 * ler o QR uma vez só, QR entregue como imagem (dataURL, gerada aqui mesmo — o QR é uma chave e
 * nunca vai para serviço de fora), pareamento por código, limpeza da trava do Chromium, conferência
 * do 9º dígito e o "pronto" confirmado pelo estado real quando o evento não chega.
 *
 * Aqui é uma sessão por loja, em /work/<loja>/session. Envia só texto. Lê as conversas individuais (Clientes → Conversas
 * do painel): o texto e o tipo de cada mensagem (foto, áudio… só a marca, sem baixar a mídia); grupos, status e canais não.
 * Este arquivo só traduz a biblioteca para o formato que o sessoes.js espera; nenhuma regra mora
 * aqui. A biblioteca é carregada dentro da fábrica, para os testes não precisarem dela.
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { ehSaida, soDigitos, erroCurto } = require('./sessoes');

// O Chrome sem tela se anuncia como "HeadlessChrome" e o WhatsApp Web responde "atualize o navegador".
const USER_AGENT = process.env.ZAP_USER_AGENT
  || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const CHROMIUM = process.env.CHROMIUM_PATH || undefined;
// O QR troca a cada ~20 s; depois de tantas trocas sem ninguém ler, fecha o navegador (uns 5 minutos).
const QR_TENTATIVAS = parseInt(process.env.ZAP_QR_TENTATIVAS || '15', 10);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Erros passageiros do navegador quando o WhatsApp Web recarrega a página: vale esperar e repetir.
function ehPassageiro(e) {
  return /detached Frame|Execution context was destroyed|Target closed|Cannot find context|Session closed|Protocol error|Node is detached|Cannot read properties of undefined|Evaluation failed/i
    .test((e && e.message) || '');
}
async function comRepeticao(fn, tentativas = 4, pausaMs = 4000) {
  let ultimo;
  for (let i = 1; i <= tentativas; i++) {
    try { return await fn(); }
    catch (e) { ultimo = e; if (!ehPassageiro(e) || i === tentativas) throw e; await espera(pausaMs); }
  }
  throw ultimo;
}

/** O mesmo celular com e sem o 9º dígito (contas antigas ficaram registradas sem o 9). */
function variantesBR(n) {
  const out = [n];
  const m = /^55(\d{2})(\d+)$/.exec(n);
  if (m) {
    const [, ddd, local] = m;
    if (local.length === 9 && local[0] === '9') out.push(`55${ddd}${local.slice(1)}`);
    else if (local.length === 8 && '6789'.includes(local[0])) out.push(`55${ddd}9${local}`);
  }
  return out;
}

// O Chromium deixa uma trava no perfil com o nome da máquina; se o contêiner cair ou for recriado,
// ele se recusa a abrir ("perfil em uso em outro computador"). Apagar é seguro: não é o login.
function limparTrava(pasta) {
  try {
    for (const nome of fs.readdirSync(pasta)) {
      if (!nome.startsWith('session')) continue;
      for (const trava of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        try { fs.rmSync(path.join(pasta, nome, trava), { force: true }); } catch (_) { /* segue */ }
      }
    }
  } catch (_) { /* primeira vez: a pasta ainda não existe */ }
}

function fabricaReal(loja, { pasta }) {
  const { Client, LocalAuth } = require('whatsapp-web.js');
  const QRCode = require('qrcode');
  const ev = new EventEmitter();
  let client = null;
  let pronto = false;
  let fechado = false;
  let conferencia = null;

  const pararConferencia = () => { if (conferencia) { clearInterval(conferencia); conferencia = null; } };
  function marcarPronto() {
    if (pronto || fechado) return;
    pronto = true;
    pararConferencia();
    const numero = client && client.info && client.info.wid ? client.info.wid.user : null;
    ev.emit('pronto', { numero });
  }
  // Às vezes carrega 100 % e autentica, mas o evento "ready" não vem: confere o estado real.
  function conferirEstado() {
    if (conferencia || pronto || fechado) return;
    conferencia = setInterval(async () => {
      if (pronto || fechado) return pararConferencia();
      try { if ((await client.getState()) === 'CONNECTED') marcarPronto(); } catch (_) { /* ainda carregando */ }
    }, 5000);
    if (conferencia.unref) conferencia.unref();
  }

  // De quem veio: conversa nova chega como "@lid" (sem o telefone); pede o número ao WhatsApp.
  async function telefoneDe(msg) {
    const de = String(msg.from || '');
    if (de.endsWith('@c.us')) return soDigitos(de.split('@')[0]);
    if (!de.endsWith('@lid')) return '';
    try {
      const r = await client.getContactLidAndPhone([de]);
      const pn = r && r[0] && r[0].pn;
      if (pn) return soDigitos(String(pn).split('@')[0]);
    } catch (_) { /* tenta pelo contato */ }
    try { const c = await msg.getContact(); return soDigitos(c && c.number); } catch (_) { return ''; }
  }

  // ---------- conversas (Clientes → Conversas do painel) ----------
  const TIPO = { chat: 'texto', image: 'imagem', video: 'video', ptt: 'audio', audio: 'audio', document: 'documento', sticker: 'figurinha', location: 'local', vcard: 'contato', multi_vcard: 'contato' };
  const individual = (jid) => /@(c\.us|lid)$/.test(String(jid || ''));
  const lidTel = new Map(); // "@lid" → telefone (ou a própria chave), para não perguntar ao WhatsApp a cada mensagem
  /** a chave da conversa: o telefone (só dígitos) ou, quando o WhatsApp não diz, "lid:<número interno>" */
  async function chaveDe(jid) {
    const j = String(jid || '');
    if (j.endsWith('@c.us')) return soDigitos(j.split('@')[0]);
    if (lidTel.has(j)) return lidTel.get(j);
    let tel = '';
    try { const r = await client.getContactLidAndPhone([j]); const pn = r && r[0] && r[0].pn; if (pn) tel = soDigitos(String(pn).split('@')[0]); } catch (_) { /* sem o telefone */ }
    const chave = tel || 'lid:' + soDigitos(j.split('@')[0]);
    lidTel.set(j, chave);
    return chave;
  }
  /** a mensagem no formato do serviço (ou null: tipo que não interessa, como aviso de segurança ou chamada) */
  async function paraConversa(msg, chave) {
    const tipo = TIPO[msg && msg.type];
    if (!tipo || !msg.id) return null;
    const jid = msg.fromMe ? msg.to : msg.from;
    if (!individual(jid)) return null;
    const chat = chave || (await chaveDe(jid));
    return {
      id: msg.id._serialized || String(msg.id.id || ''), chat, deMim: !!msg.fromMe, em: new Date((Number(msg.timestamp) || 0) * 1000).toISOString(), tipo,
      texto: tipo === 'texto' || tipo === 'imagem' || tipo === 'video' || tipo === 'documento' ? String(msg.body || '') : '',
      nome: msg.fromMe ? '' : String((msg._data && msg._data.notifyName) || ''),
    };
  }

  /** mensagens das conversas individuais dos últimos `dias` (até 300 por conversa, até 1000 conversas) */
  ev.historico = async (dias) => {
    const corte = Date.now() - dias * 864e5;
    const chats = await comRepeticao(() => client.getChats());
    const out = [];
    for (const chat of chats.slice(0, 1000)) {
      const jid = chat && chat.id && chat.id._serialized;
      if (!jid || chat.isGroup || !individual(jid) || (Number(chat.timestamp) || 0) * 1000 < corte) continue;
      let msgs = [];
      try { msgs = await comRepeticao(() => chat.fetchMessages({ limit: 300 })); } catch (_) { continue; }
      const chave = await chaveDe(jid);
      for (const m of msgs) {
        if ((Number(m.timestamp) || 0) * 1000 < corte) continue;
        try { const c = await paraConversa(m, chave); if (c) out.push(c); } catch (_) { /* mensagem que não deu para ler */ }
      }
    }
    return out;
  };

  ev.iniciar = async () => {
    fs.mkdirSync(pasta, { recursive: true });
    limparTrava(pasta);
    client = new Client({
      authStrategy: new LocalAuth({ dataPath: pasta }),
      webVersionCache: { type: 'none' },          // versão do WhatsApp Web ao vivo (a "fixa" some do ar)
      userAgent: USER_AGENT,
      qrMaxRetries: QR_TENTATIVAS,
      puppeteer: {
        headless: true,
        executablePath: CHROMIUM,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      },
    });
    client.on('qr', (qr) => {
      QRCode.toDataURL(qr, { margin: 1, width: 320 }).then((u) => ev.emit('qr', u)).catch(() => ev.emit('qr', null));
    });
    client.on('code', (codigo) => ev.emit('codigo', codigo));
    client.on('authenticated', conferirEstado);
    client.on('loading_screen', (pct) => { if (Number(pct) >= 100) conferirEstado(); });
    client.on('change_state', (s) => { if (s === 'CONNECTED') marcarPronto(); });
    client.on('ready', marcarPronto);
    client.on('auth_failure', (m) => { pronto = false; ev.emit('caiu', { tipo: 'logout', detalhe: 'auth_failure ' + erroCurto(m) }); });
    client.on('disconnected', (motivo) => {
      pronto = false;
      pararConferencia();
      const m = String(motivo || '');
      const tipo = /LOGOUT/i.test(m) ? 'logout' : (/Max qrcode retries/i.test(m) ? 'qr_expirou' : 'queda');
      ev.emit('caiu', { tipo, detalhe: m });
    });
    client.on('message', async (msg) => {
      try {
        // Só texto recebido em conversa individual, e só se for pedido de saída: o resto nem sai daqui.
        if (!msg || msg.fromMe || msg.type !== 'chat') return;
        const de = String(msg.from || '');
        if (!de.endsWith('@c.us') && !de.endsWith('@lid')) return;     // grupo, status, canal
        if (!ehSaida(msg.body)) return;
        const fone = await telefoneDe(msg);
        if (fone) ev.emit('mensagem', { de: fone, texto: msg.body, grupo: false, minha: false });
      } catch (_) { /* resposta que não deu para ler não derruba nada */ }
    });
    // toda mensagem de conversa individual, recebida ou enviada (pelo robô, pelo celular ou pelo WhatsApp Web)
    client.on('message_create', async (msg) => {
      try { const c = await paraConversa(msg); if (c) ev.emit('conversa', c); } catch (_) { /* não derruba nada */ }
    });
    await client.initialize();
  };

  ev.pedirCodigo = (numero) => client.requestPairingCode(numero);

  /**
   * Mídia de uma mensagem (foto, áudio, vídeo, documento), baixada na hora do WhatsApp: nada é gravado em disco
   * (decisão do dono: "baixar no computador e não armazenar na VPS"). → { dados: Buffer, mimetype, nome } ou null
   * quando o WhatsApp não tem mais a mídia. `limite` em bytes: acima dele devolve { grande: true } sem baixar de novo.
   */
  ev.midia = async (id, limite) => {
    const msg = await comRepeticao(() => client.getMessageById(id));
    if (!msg || !msg.hasMedia) return null;
    const m = await msg.downloadMedia();
    if (!m || !m.data) return null;
    if (limite && Math.floor(m.data.length * 3 / 4) > limite) return { grande: true };
    return { dados: Buffer.from(m.data, 'base64'), mimetype: String(m.mimetype || 'application/octet-stream'), nome: m.filename ? String(m.filename) : null };
  };

  /** Devolve o destino certo no WhatsApp, ou null quando o número não tem WhatsApp. */
  ev.temWhatsapp = async (numero) => {
    let n = soDigitos(numero);
    if (n.length <= 11) n = '55' + n;
    let erro = null;
    for (const cand of variantesBR(n)) {
      try {
        const id = await comRepeticao(() => client.getNumberId(cand));
        if (id && id._serialized) return id._serialized;
      } catch (e) { erro = e; }
    }
    if (erro) throw erro;                         // instabilidade não é "sem WhatsApp"
    return null;
  };

  ev.digitando = async (destino) => {
    await client.pupPage.evaluate(async (chatId) => {
      if (window.WWebJS && window.WWebJS.sendChatstate) await window.WWebJS.sendChatstate('typing', chatId);
    }, destino);
  };

  // Sem repetição de propósito: se o erro vier depois de a mensagem ter saído, repetir mandaria duas.
  ev.enviar = async (destino, texto) => {
    const msg = await client.sendMessage(destino, texto);
    try { await client.pupPage.evaluate((chatId) => window.WWebJS.sendChatstate('stop', chatId), destino); } catch (_) { /* enfeite */ }
    return msg && msg.id ? (msg.id._serialized || msg.id.id || null) : null;
  };

  ev.vivo = async () => (await client.getState()) === 'CONNECTED';

  ev.sair = async () => { if (client) await client.logout(); };

  ev.fechar = async () => {
    fechado = true;
    pararConferencia();
    try { if (client) await client.destroy(); } catch (_) { /* já fechado */ }
  };

  return ev;
}

module.exports = { fabricaReal, variantesBR, limparTrava };
