'use strict';
/**
 * sessoes.js — a situação de cada loja no WhatsApp e as regras do serviço:
 * conectar, desconectar, um envio por vez, id que não reenvia, respostas de "parar".
 *
 * Não conhece o WhatsApp de verdade: recebe uma FÁBRICA de cliente (wa.js na vida real,
 * um cliente de mentira nos testes). O serviço é "burro" de propósito — quem decide para
 * quem, quando e quantas mensagens é o painel.
 *
 * O cliente que a fábrica devolve é um EventEmitter com:
 *   eventos  'qr' (dataURL png) · 'codigo' (8 caracteres) · 'pronto' ({ numero })
 *            'caiu' ({ tipo: 'logout'|'qr_expirou'|'queda', detalhe })
 *            'mensagem' ({ de, texto, grupo, minha })
 *            'conversa' ({ id, chat, deMim, em, tipo, texto, nome }) — toda mensagem de conversa individual, enviada ou
 *                       recebida (Clientes → Conversas do painel; decisão do dono: o texto fica guardado, nunca no log)
 *   métodos  iniciar() · pedirCodigo(numero) · temWhatsapp(numero) → destino|null
 *            historico(dias) → [conversa…] (as mensagens das conversas individuais dos últimos dias)
 *            midia(id, limite) → { dados: Buffer, mimetype, nome } | { grande: true } | null (baixada na hora; nada em disco)
 *            digitando(destino) · enviar(destino, texto) → idMsg · vivo() → bool
 *            sair() (sai do WhatsApp) · fechar() (fecha o navegador)
 */
const fs = require('fs');
const path = require('path');

const RE_LOJA = /^[a-z0-9_-]{1,40}$/;
const DIA_MS = 24 * 60 * 60 * 1000;
const GUARDA_OPTOUT_MS = 180 * DIA_MS;
const MAX_TEXTO = 4096;
// Conversas (Clientes → Conversas): o painel busca de tempos em tempos e guarda do lado dele; aqui fica só um intervalo curto
const CONV_GUARDA_MS = 7 * DIA_MS, CONV_MAX = 20000, CONV_LOTE = 500;
const MIDIA_MAX = 16 * 1024 * 1024;               // mídia maior que isso não passa (o painel mostra "arquivo grande demais")
const RE_ID_MSG = /^[A-Za-z0-9_@.:-]{5,200}$/;
const CONV_TIPOS = ['texto', 'imagem', 'video', 'audio', 'documento', 'figurinha', 'local', 'contato'];
const RE_CHAT = /^(\d{10,15}|lid:\d{5,25})$/;

// Palavras de saída (decisão do dono), já sem acento e em minúsculas.
const SAIDAS = ['parar', 'sair', 'nao quero', 'remover', 'descadastrar'];
// Mensagem comprida não é pedido de saída ("não quero perder a promoção, me manda o endereço…").
const MAX_SAIDA = 60;

function normalizar(t) {
  return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** O texto é um pedido para não receber mais? (palavra inteira, mensagem curta) */
function ehSaida(texto) {
  const n = normalizar(texto);
  if (!n || n.length > MAX_SAIDA) return false;
  const alvo = ' ' + n + ' ';
  return SAIDAS.some((p) => alvo.includes(' ' + p + ' '));
}

const soDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const numeroValido = (n) => /^\d{10,15}$/.test(n);
/** Para o log: só os 4 últimos dígitos. */
const fim4 = (n) => { const d = soDigitos(n); return d ? '***' + d.slice(-4) : '***'; };
/** Mensagem de erro curta, sem número completo (a biblioteca às vezes cita o destino). */
function erroCurto(e) {
  const m = String((e && e.message) || e || 'erro').replace(/\s+/g, ' ');
  return m.replace(/\d{8,}/g, (d) => '***' + d.slice(-4)).slice(0, 200);
}

class ErroPedido extends Error {
  constructor(msg) { super(msg); this.pedidoInvalido = true; }
}

function criarSessoes(opcoes = {}) {
  const fabrica = opcoes.fabrica;
  if (typeof fabrica !== 'function') throw new Error('faltou a fábrica do cliente do WhatsApp');
  const workDir = opcoes.workDir || null;                    // null = nada em disco (testes)
  const agora = opcoes.agora || (() => Date.now());
  const espera = opcoes.espera || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const agendar = opcoes.agendar || ((fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; });
  const digitandoMs = opcoes.digitandoMs || [3000, 7000];    // "digitando…" antes de cada envio
  const limiteEnvioMs = opcoes.limiteEnvioMs || 120000;      // envio que não responde vira falha
  const reconexoes = opcoes.reconexoes || [5000, 30000, 120000, 600000];
  const log = opcoes.log || ((m) => console.log('[zap] ' + m));

  const lojas = new Map();

  // ---------- disco (fora do Git: zap-work/<loja>/) ----------
  const pastaDe = (loja) => (workDir ? path.join(workDir, loja) : null);
  const arq = (loja, nome) => path.join(pastaDe(loja), nome);
  function lerJson(loja, nome, padrao) {
    if (!workDir) return padrao;
    try { return JSON.parse(fs.readFileSync(arq(loja, nome), 'utf8')); } catch (_) { return padrao; }
  }
  function gravarJson(loja, nome, dado) {
    if (!workDir) return;
    try {
      fs.mkdirSync(pastaDe(loja), { recursive: true });
      const tmp = arq(loja, nome + '.tmp');
      fs.writeFileSync(tmp, JSON.stringify(dado));
      fs.renameSync(tmp, arq(loja, nome));
    } catch (e) { log(`loja=${loja} não consegui gravar ${nome}: ${erroCurto(e)}`); }
  }
  // Marca de "esta loja já conectou": é o que faz reconectar sozinho ao subir.
  function marcar(loja, sim) {
    if (!workDir) return;
    try {
      if (sim) { fs.mkdirSync(pastaDe(loja), { recursive: true }); fs.writeFileSync(arq(loja, 'conectado'), new Date(agora()).toISOString()); }
      else fs.rmSync(arq(loja, 'conectado'), { force: true });
    } catch (_) { /* melhor esforço */ }
  }
  const temMarca = (loja) => !!workDir && fs.existsSync(arq(loja, 'conectado'));
  function apagarSessao(loja) {
    if (!workDir) return;
    try {
      for (const nome of fs.readdirSync(pastaDe(loja))) {
        if (nome.startsWith('session')) fs.rmSync(arq(loja, nome), { recursive: true, force: true });
      }
    } catch (_) { /* pasta ainda não existe */ }
  }

  function obter(loja) {
    let s = lojas.get(loja);
    if (s) return s;
    s = {
      loja, estado: 'desligado', qr: null, codigo: null, numeroFim: null, desde: null, erro: null,
      cli: null, geracao: 0, tentativas: 0, jaConectou: temMarca(loja),
      numero: null, pediuCodigo: false, falhasCodigo: 0,
      fila: Promise.resolve(), emVoo: new Map(),
      enviados: new Map(Object.entries(lerJson(loja, 'enviados.json', {}))),
      optouts: lerJson(loja, 'optouts.json', []),
      conv: lerJson(loja, 'conversas.json', { seq: 0, itens: [] }), convIds: null, convGravar: null, hist: null,
    };
    if (!Array.isArray(s.optouts)) s.optouts = [];
    if (!s.conv || !Array.isArray(s.conv.itens) || !Number.isInteger(s.conv.seq)) s.conv = { seq: 0, itens: [] };
    s.convIds = new Set(s.conv.itens.map((x) => x.id));
    lojas.set(loja, s);
    return s;
  }

  function validarLoja(loja) {
    if (typeof loja !== 'string' || !RE_LOJA.test(loja)) throw new ErroPedido('Loja inválida.');
  }

  function status(loja) {
    validarLoja(loja);
    const s = lojas.get(loja);
    if (!s) return { estado: 'desligado', qr: null, codigo: null, numeroFim: null, desde: null, erro: null };
    return { estado: s.estado, qr: s.qr, codigo: s.codigo, numeroFim: s.numeroFim, desde: s.desde, erro: s.erro, ...(s.hist ? { historico: s.hist } : {}) };
  }

  async function largarCliente(s, sair) {
    const cli = s.cli;
    s.cli = null;
    s.geracao++;                                  // eventos do cliente antigo passam a ser ignorados
    if (!cli) return;
    // navegador travado não pode segurar o desligamento: espera no máximo 20 s por passo
    const tentar = (fn) => comLimite(Promise.resolve().then(fn), 20000).catch(() => {});
    if (sair) await tentar(() => cli.sair());
    await tentar(() => cli.fechar());
  }

  function parar(s, estado, erro) {
    s.estado = estado; s.erro = erro || null;
    s.qr = null; s.codigo = null; s.numeroFim = null; s.desde = null;
    s.numero = null; s.pediuCodigo = false; s.falhasCodigo = 0;
  }

  function iniciar(s) {
    const g = ++s.geracao;
    const vale = () => s.geracao === g;
    s.estado = 'iniciando'; s.qr = null; s.codigo = null; s.numeroFim = null; s.desde = null;
    s.pediuCodigo = false; s.falhasCodigo = 0;
    let cli;
    try { cli = fabrica(s.loja, { pasta: pastaDe(s.loja) }); }
    catch (e) { parar(s, 'caiu', 'Não foi possível abrir o WhatsApp: ' + erroCurto(e)); return; }
    s.cli = cli;

    const mostrarCodigo = (c) => {
      if (!vale() || s.estado === 'conectado' || !c) return;
      s.estado = 'codigo'; s.codigo = String(c); s.qr = null; s.erro = null;
    };
    cli.on('qr', (dataUrl) => {
      if (!vale() || s.estado === 'conectado') return;
      if (s.numero) {                             // pareamento por código: não mostra o QR
        if (!s.pediuCodigo) {
          s.pediuCodigo = true;
          Promise.resolve().then(() => cli.pedirCodigo(s.numero)).then(mostrarCodigo).catch((e) => {
            if (!vale()) return;
            s.falhasCodigo++;
            log(`loja=${s.loja} o WhatsApp recusou o código (${s.falhasCodigo}/3): ${erroCurto(e)}`);
            if (s.falhasCodigo >= 3) { s.numero = null; s.erro = 'O WhatsApp não gerou o código; use o QR.'; }
            s.pediuCodigo = false;                // tenta de novo no próximo QR
          });
        }
        return;
      }
      s.estado = 'qr'; s.qr = dataUrl || null; s.codigo = null;
    });
    cli.on('codigo', mostrarCodigo);              // o WhatsApp troca o código a cada 3 minutos
    cli.on('pronto', (info) => {
      if (!vale()) return;
      const num = soDigitos(info && info.numero);
      s.estado = 'conectado'; s.qr = null; s.codigo = null; s.erro = null;
      s.numeroFim = num ? num.slice(-4) : null;
      s.desde = new Date(agora()).toISOString();
      s.tentativas = 0; s.jaConectou = true; s.numero = null;
      marcar(s.loja, true);
      log(`loja=${s.loja} conectado (número ${fim4(num)})`);
    });
    cli.on('caiu', (info) => {
      if (!vale()) return;
      const tipo = (info && info.tipo) || 'queda';
      log(`loja=${s.loja} caiu (${tipo}): ${erroCurto(info && info.detalhe)}`);
      if (tipo === 'logout') {
        marcar(s.loja, false); s.jaConectou = false;
        largarCliente(s, false).then(() => apagarSessao(s.loja));
        parar(s, 'caiu', 'O WhatsApp encerrou a conexão deste aparelho. Conecte de novo.');
      } else if (tipo === 'qr_expirou') {
        const tinha = s.jaConectou;
        marcar(s.loja, false); s.jaConectou = false;
        largarCliente(s, false);
        if (tinha) parar(s, 'caiu', 'A conexão salva não vale mais. Conecte de novo.');
        else parar(s, 'desligado', 'O código não foi lido a tempo. Clique em conectar de novo.');
      } else {
        reconectar(s, 'A conexão com o WhatsApp caiu.');
      }
    });
    cli.on('mensagem', (m) => { if (vale()) recebida(s, m); });
    cli.on('conversa', (m) => { if (vale()) guardarConversa(s, m); });
    cli.on('error', (e) => log(`loja=${s.loja} erro do cliente: ${erroCurto(e)}`));

    Promise.resolve().then(() => cli.iniciar()).catch((e) => {
      if (!vale()) return;
      log(`loja=${s.loja} não iniciou: ${erroCurto(e)}`);
      if (s.jaConectou) reconectar(s, 'Não foi possível abrir o WhatsApp.');
      else { largarCliente(s, false); parar(s, 'caiu', 'Não foi possível abrir o WhatsApp: ' + erroCurto(e)); }
    });
  }

  // Queda sem logout: tenta voltar sozinho com a sessão salva, algumas vezes, cada vez mais devagar.
  function reconectar(s, motivo) {
    const n = s.tentativas++;
    const p = largarCliente(s, false);
    if (n >= reconexoes.length) {
      parar(s, 'caiu', motivo + ' Não voltou sozinho: conecte de novo.');
      return;
    }
    parar(s, 'iniciando', motivo + ' Reconectando…');
    const g = s.geracao;
    p.then(() => agendar(() => { if (s.geracao === g && s.estado === 'iniciando') { const e = s.erro; iniciar(s); s.erro = e; } }, reconexoes[n]));
  }

  async function conectar(loja, dados) {
    validarLoja(loja);
    let numero = null;
    if (dados && dados.numero != null && dados.numero !== '') {
      numero = soDigitos(dados.numero);
      if (!numeroValido(numero)) throw new ErroPedido('Número inválido: use DDI + DDD + número, só dígitos.');
    }
    const s = obter(loja);
    if (s.estado === 'conectado') return { ok: true };
    await largarCliente(s, false);                // recomeça a tentativa (ex.: trocar QR por código)
    s.tentativas = 0; s.erro = null;
    s.numero = numero;
    iniciar(s);
    log(`loja=${loja} conectar (${numero ? 'por código, número ' + fim4(numero) : 'por QR'})`);
    return { ok: true };
  }

  async function desconectar(loja) {
    validarLoja(loja);
    const s = obter(loja);
    await largarCliente(s, true);
    marcar(loja, false); s.jaConectou = false; s.tentativas = 0;
    apagarSessao(loja);
    // as conversas guardadas aqui saem junto (o painel apaga as dele ao desconectar); o número da sequência continua
    s.conv = { seq: s.conv.seq, itens: [] }; s.convIds = new Set(); s.hist = null;
    gravarJson(loja, 'conversas.json', s.conv);
    parar(s, 'desligado', null);
    log(`loja=${loja} desconectado e sessão apagada`);
    return { ok: true };
  }

  // ---------- envio ----------
  function limparEnviados(s) {
    const corte = agora() - DIA_MS;
    for (const [id, v] of s.enviados) if (!v || v.em < corte) s.enviados.delete(id);
  }
  function guardar(s, id, res) {
    s.enviados.set(id, { em: agora(), res });
    gravarJson(s.loja, 'enviados.json', Object.fromEntries(s.enviados));   // só id e resultado: sem texto, sem número
    return res;
  }
  function comLimite(p, ms) {
    let t;
    const limite = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('o WhatsApp não respondeu a tempo')), ms); });
    return Promise.race([Promise.resolve(p), limite]).finally(() => clearTimeout(t));
  }

  async function executar(s, id, para, texto) {
    const desconectado = { ok: false, motivo: 'desconectado', erro: 'O WhatsApp desta loja não está conectado.' };
    if (s.estado !== 'conectado' || !s.cli) return desconectado;
    const cli = s.cli;
    let destino;
    try { destino = await comLimite(cli.temWhatsapp(para), limiteEnvioMs); }
    catch (e) {                                   // nada saiu: não guarda, o painel pode tentar de novo
      log(`loja=${s.loja} envio ${fim4(para)}: falha ao conferir o número: ${erroCurto(e)}`);
      return { ok: false, motivo: 'falha', erro: erroCurto(e) };
    }
    if (!destino) {
      log(`loja=${s.loja} envio ${fim4(para)}: sem WhatsApp`);
      return guardar(s, id, { ok: false, motivo: 'sem_whatsapp', erro: 'Este número não tem WhatsApp.' });
    }
    try { await comLimite(cli.digitando(destino), 15000); } catch (_) { /* enfeite: não impede o envio */ }
    const [de, ate] = digitandoMs;
    await espera(Math.round(de + Math.random() * Math.max(0, ate - de)));
    if (s.cli !== cli || s.estado !== 'conectado') return desconectado;
    try {
      const idMsg = await comLimite(cli.enviar(destino, texto), limiteEnvioMs);
      log(`loja=${s.loja} envio ${fim4(para)}: ok`);
      return guardar(s, id, { ok: true, idMsg: idMsg == null ? null : String(idMsg) });
    } catch (e) {
      // Daqui em diante a mensagem PODE ter saído: guarda a falha para o mesmo id nunca reenviar.
      log(`loja=${s.loja} envio ${fim4(para)}: falha: ${erroCurto(e)}`);
      return guardar(s, id, { ok: false, motivo: 'falha', erro: erroCurto(e) });
    }
  }

  function enviar(loja, dados) {
    validarLoja(loja);
    const d = dados || {};
    const id = typeof d.id === 'string' ? d.id.trim() : '';
    if (!id || id.length > 200) return Promise.reject(new ErroPedido('Faltou o id do envio.'));
    const para = typeof d.para === 'string' || typeof d.para === 'number' ? soDigitos(d.para) : '';
    if (!numeroValido(para)) return Promise.reject(new ErroPedido('Número de destino inválido.'));
    if (typeof d.texto !== 'string' || !d.texto.trim()) return Promise.reject(new ErroPedido('Faltou o texto da mensagem.'));
    if (d.texto.length > MAX_TEXTO) return Promise.reject(new ErroPedido('Texto grande demais.'));
    const s = obter(loja);
    limparEnviados(s);
    const antes = s.enviados.get(id);
    if (antes) return Promise.resolve(antes.res);             // mesmo id em 24 h: não reenvia
    if (s.emVoo.has(id)) return s.emVoo.get(id);              // mesmo id ainda saindo: espera o mesmo resultado
    const p = s.fila.then(() => {                             // um envio por vez por loja
      const ja = s.enviados.get(id);
      return ja ? ja.res : executar(s, id, para, d.texto);
    });
    s.fila = p.catch(() => {});
    s.emVoo.set(id, p);
    const soltar = () => { if (s.emVoo.get(id) === p) s.emVoo.delete(id); };
    p.then(soltar, soltar);
    return p;
  }

  // ---------- respostas de "parar" ----------
  function recebida(s, m) {
    if (!m || m.minha || m.grupo) return;                     // só RECEBIDA em conversa individual
    const de = soDigitos(m.de);
    if (!numeroValido(de) || !ehSaida(m.texto)) return;       // o texto não é guardado nem vai para o log
    const corte = agora() - GUARDA_OPTOUT_MS;
    s.optouts = s.optouts.filter((o) => o && o.de !== de && Date.parse(o.em) >= corte);
    s.optouts.push({ de, em: new Date(agora()).toISOString() });
    gravarJson(s.loja, 'optouts.json', s.optouts);
    log(`loja=${s.loja} pedido para não receber mais (${fim4(de)})`);
  }

  function optouts(loja, desde) {
    validarLoja(loja);
    let corte = null;
    if (desde != null && desde !== '') {
      corte = Date.parse(desde);
      if (Number.isNaN(corte)) throw new ErroPedido('Data inválida em "desde".');
    }
    const s = obter(loja);
    const itens = s.optouts.filter((o) => corte == null || Date.parse(o.em) >= corte).map((o) => ({ de: o.de, em: o.em }));
    return { itens };
  }

  // ---------- conversas (Clientes → Conversas do painel) ----------
  /** guarda uma mensagem de conversa individual (sem repetir o id); o texto nunca vai para o log */
  function guardarConversa(s, m) {
    if (!m || typeof m.id !== 'string' || !m.id || m.id.length > 200 || s.convIds.has(m.id)) return false;
    const chat = String(m.chat || '');
    const em = Date.parse(m.em);
    if (!RE_CHAT.test(chat) || !Number.isFinite(em) || !CONV_TIPOS.includes(m.tipo)) return false;
    const item = { seq: ++s.conv.seq, id: m.id, chat, deMim: m.deMim === true, em: new Date(em).toISOString(), tipo: m.tipo,
      texto: typeof m.texto === 'string' ? m.texto.slice(0, MAX_TEXTO) : '', ...(m.nome && !m.deMim ? { nome: String(m.nome).slice(0, 80) } : {}) };
    s.conv.itens.push(item); s.convIds.add(item.id);
    // guarda só uns dias e um tanto (o painel já buscou): o mais antigo sai primeiro
    const corte = agora() - CONV_GUARDA_MS;
    if (s.conv.itens.length > CONV_MAX || Date.parse(s.conv.itens[0].em) < corte) {
      s.conv.itens = s.conv.itens.filter((x) => Date.parse(x.em) >= corte || x.seq > s.conv.seq - 1000).slice(-CONV_MAX);
      s.convIds = new Set(s.conv.itens.map((x) => x.id));
    }
    if (!s.convGravar) s.convGravar = agendar(() => { s.convGravar = null; gravarJson(s.loja, 'conversas.json', s.conv); }, 1000);
    return true;
  }
  /** as mensagens depois do número `desde` (o painel guarda o último que recebeu); de 500 em 500 */
  function conversas(loja, desde) {
    validarLoja(loja);
    const d = desde == null || desde === '' ? 0 : Number(desde);
    if (!Number.isInteger(d) || d < 0) throw new ErroPedido('"desde" inválido.');
    const s = obter(loja);
    const novos = s.conv.itens.filter((x) => x.seq > d);
    return { ultimo: s.conv.seq, itens: novos.slice(0, CONV_LOTE), mais: novos.length > CONV_LOTE };
  }
  /**
   * Mídia de uma mensagem, baixada na hora do WhatsApp e devolvida ao painel sem gravar nada aqui (decisão do dono).
   * → { ok: true, dados, mimetype, nome } · { ok: false, codigo, erro } (404 não está mais disponível, 413 grande demais,
   * 409 desconectado, 502 o WhatsApp não respondeu). O nome do arquivo nunca vai para o log.
   */
  async function midia(loja, id) {
    validarLoja(loja);
    if (typeof id !== 'string' || !RE_ID_MSG.test(id)) throw new ErroPedido('Mensagem inválida.');
    const s = obter(loja);
    if (s.estado !== 'conectado' || !s.cli) return { ok: false, codigo: 409, erro: 'O WhatsApp desta loja não está conectado.' };
    if (typeof s.cli.midia !== 'function') return { ok: false, codigo: 501, erro: 'Este serviço do WhatsApp não busca mídia.' };
    let r;
    try { r = await comLimite(s.cli.midia(id, MIDIA_MAX), limiteEnvioMs); }
    catch (e) { log(`loja=${loja} mídia: o WhatsApp não respondeu (${erroCurto(e)})`); return { ok: false, codigo: 502, erro: 'O WhatsApp não respondeu agora. Tente de novo.' }; }
    if (!r) return { ok: false, codigo: 404, erro: 'Esta mídia não está mais disponível no WhatsApp.' };
    if (r.grande || (r.dados && r.dados.length > MIDIA_MAX)) return { ok: false, codigo: 413, erro: 'Arquivo grande demais para abrir pelo painel (mais de 16 MB).' };
    if (!Buffer.isBuffer(r.dados)) return { ok: false, codigo: 404, erro: 'Esta mídia não está mais disponível no WhatsApp.' };
    return { ok: true, dados: r.dados, mimetype: String(r.mimetype || 'application/octet-stream').slice(0, 100), nome: r.nome ? String(r.nome).slice(0, 120) : null };
  }
  /** importa as conversas dos últimos dias (botão "Reimportar histórico"); roda sozinho e a situação sai no status */
  function historico(loja, dados) {
    validarLoja(loja);
    const dias = Math.round(Number((dados && dados.dias) || 30));
    if (!(dias >= 1 && dias <= 90)) throw new ErroPedido('Dias do histórico: de 1 a 90.');
    const s = obter(loja);
    if (s.estado !== 'conectado' || !s.cli || typeof s.cli.historico !== 'function') return { ok: false, erro: 'O WhatsApp desta loja não está conectado.' };
    if (s.hist && s.hist.estado === 'rodando') return { ok: true, jaRodando: true };
    const cli = s.cli, g = s.geracao;
    s.hist = { estado: 'rodando', em: new Date(agora()).toISOString(), dias };
    comLimite(cli.historico(dias), 15 * 60000).then((lista) => {
      if (s.geracao !== g) return;
      let n = 0;
      for (const m of Array.isArray(lista) ? lista : []) if (guardarConversa(s, m)) n++;
      s.hist = { estado: 'ok', em: new Date(agora()).toISOString(), dias, mensagens: n };
      log(`loja=${loja} histórico de ${dias} dias importado (${n} mensagens)`);
    }).catch((e) => {
      if (s.geracao !== g) return;
      s.hist = { estado: 'erro', em: new Date(agora()).toISOString(), dias, erro: erroCurto(e) };
      log(`loja=${loja} histórico falhou: ${erroCurto(e)}`);
    });
    log(`loja=${loja} importando o histórico de ${dias} dias`);
    return { ok: true };
  }

  // ---------- ao subir, de tempos em tempos e ao derrubar ----------
  /** Reconecta só as lojas que já estavam conectadas (têm a marca). Nunca abre sessão nova sozinho. */
  function retomar() {
    if (!workDir) return [];
    let nomes = [];
    try { nomes = fs.readdirSync(workDir); } catch (_) { return []; }
    const voltaram = [];
    for (const loja of nomes) {
      if (!RE_LOJA.test(loja) || !temMarca(loja)) continue;
      const s = obter(loja);
      if (s.cli) continue;
      iniciar(s);
      voltaram.push(loja);
      log(`loja=${loja} reconectando com a sessão salva`);
    }
    return voltaram;
  }

  /** Confere se as lojas conectadas continuam vivas; a que travou é religada com a sessão salva. */
  async function vigiar() {
    for (const s of lojas.values()) {
      if (s.estado !== 'conectado' || !s.cli) continue;
      const cli = s.cli;
      let ok = false;
      try { ok = await comLimite(cli.vivo(), 30000); } catch (_) { ok = false; }
      if (!ok && s.cli === cli && s.estado === 'conectado') {
        log(`loja=${s.loja} não respondeu à conferência: religando`);
        reconectar(s, 'O WhatsApp parou de responder.');
      }
    }
  }

  async function fechar() {
    await Promise.all([...lojas.values()].map((s) => largarCliente(s, false)));
  }

  return { status, conectar, desconectar, enviar, optouts, conversas, historico, midia, retomar, vigiar, fechar };
}

module.exports = { criarSessoes, ehSaida, normalizar, fim4, erroCurto, soDigitos, RE_LOJA, ErroPedido, MIDIA_MAX };
