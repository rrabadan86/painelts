'use strict';
/**
 * Clientes → Conversas (decisão do dono): as conversas do WhatsApp da loja, lidas pelo serviço "zap" e guardadas aqui.
 * Só admin e franqueado da loja veem (server.js). O texto fica só nesta pasta: nunca vai para log nem auditoria.
 *
 *   dados/<loja>/conversas/estado.json   { desde (último número que o serviço entregou), em, limpoEm }
 *   dados/<loja>/conversas/indice.json   { <chave>: { chave, nome, ult: { id, em, texto, deMim, tipo }, n, semResposta, naoLidas, lidaEm } }
 *     semResposta (decisão do dono): mensagens do cliente depois da última resposta da loja — é a marca "N sem resposta" da lista
 *     (não depende de alguém abrir a conversa no painel; a loja respondeu pelo celular, some).
 *   dados/<loja>/conversas/c/<chave>.json [ { id, deMim, em, tipo, texto, nome? } ] (em ordem de data)
 *   dados/<loja>/conversas/robo.json     { <id da mensagem>: { camp, em } } — o que o robô mandou (marca 🤖 na conversa)
 * chave = o telefone (só dígitos, com o 55) ou "lid:<número interno>" quando o WhatsApp não diz o telefone.
 * Guarda 12 meses (decisão do dono); desconectar o WhatsApp da loja apaga tudo.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const MESES = 12;
const GUARDA_MS = MESES * 31 * 864e5;
const MAX_POR_CONVERSA = 5000;
const RE_CHAVE = /^(\d{10,15}|lid:\d{5,25})$/;
const TIPOS = ['texto', 'imagem', 'video', 'audio', 'documento', 'figurinha', 'local', 'contato'];

const pasta = (id) => path.join(C.pastaLoja(id), 'conversas');
const arqChat = (id, chave) => path.join(pasta(id), 'c', chave.replace(':', '-') + '.json');
function ler(arq, padrao) { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; } }
function gravar(arq, dado) { fs.mkdirSync(path.dirname(arq), { recursive: true }); C.gravarAtomico(arq, JSON.stringify(dado), 0o640); }
const lerEstado = (id) => ler(path.join(pasta(id), 'estado.json'), { desde: 0 });
const lerIndice = (id) => ler(path.join(pasta(id), 'indice.json'), {});
const lerRobo = (id) => ler(path.join(pasta(id), 'robo.json'), {});

/** quantas mensagens do cliente chegaram depois da última da loja (a conversa está esperando resposta) */
function semRespostaDe(msgs) {
  let n = 0;
  for (let i = (msgs || []).length - 1; i >= 0 && !msgs[i].deMim; i--) n++;
  return n;
}

/** grava as mensagens que chegaram do serviço (sem repetir o id). → quantas entraram */
function aplicar(id, itens, agora = Date.now()) {
  const porChat = new Map();
  for (const m of itens || []) {
    const chave = String((m && m.chat) || '');
    const em = Date.parse(m && m.em);
    if (!RE_CHAVE.test(chave) || !m.id || !Number.isFinite(em) || !TIPOS.includes(m.tipo) || agora - em > GUARDA_MS) continue;
    if (!porChat.has(chave)) porChat.set(chave, []);
    porChat.get(chave).push({ id: String(m.id).slice(0, 200), deMim: m.deMim === true, em: new Date(em).toISOString(), tipo: m.tipo, texto: String(m.texto || '').slice(0, 4096), ...(m.nome && !m.deMim ? { nome: String(m.nome).slice(0, 80) } : {}) });
  }
  if (!porChat.size) return 0;
  const ind = lerIndice(id);
  let novas = 0;
  for (const [chave, msgs] of porChat) {
    const lista = ler(arqChat(id, chave), []);
    const ids = new Set(lista.map((x) => x.id));
    const entram = msgs.filter((x) => !ids.has(x.id) && (ids.add(x.id), true));
    if (!entram.length) continue;
    novas += entram.length;
    const todas = [...lista, ...entram].sort((a, b) => a.em.localeCompare(b.em)).slice(-MAX_POR_CONVERSA);
    gravar(arqChat(id, chave), todas);
    const e = ind[chave] || { chave, n: 0, naoLidas: 0, lidaEm: null };
    const ult = todas[todas.length - 1];
    const nome = [...todas].reverse().find((x) => x.nome);
    e.n = todas.length;
    e.ult = { id: ult.id, em: ult.em, texto: ult.texto.slice(0, 140), deMim: ult.deMim, tipo: ult.tipo };
    e.semResposta = semRespostaDe(todas);
    if (nome) e.nome = nome.nome;
    // não lidas: as recebidas depois da última vez que alguém abriu a conversa
    e.naoLidas = todas.filter((x) => !x.deMim && (!e.lidaEm || x.em > e.lidaEm)).length;
    ind[chave] = e;
  }
  gravar(path.join(pasta(id), 'indice.json'), ind);
  return novas;
}

/** apaga o que passou de 12 meses (uma vez por dia) */
function limpar(id, agora = Date.now()) {
  const est = lerEstado(id);
  const dia = C.diaSP(agora);
  if (est.limpoEm === dia) return;
  const corte = new Date(agora - GUARDA_MS).toISOString();
  const ind = lerIndice(id);
  for (const chave of Object.keys(ind)) {
    const lista = ler(arqChat(id, chave), []);
    const fica = lista.filter((x) => x.em >= corte);
    if (fica.length === lista.length) continue;
    if (!fica.length) { delete ind[chave]; fs.rmSync(arqChat(id, chave), { force: true }); continue; }
    gravar(arqChat(id, chave), fica);
    ind[chave].n = fica.length;
  }
  gravar(path.join(pasta(id), 'indice.json'), ind);
  const robo = lerRobo(id);
  for (const k of Object.keys(robo)) if (!(robo[k] && robo[k].em >= corte)) delete robo[k];
  gravar(path.join(pasta(id), 'robo.json'), robo);
  gravar(path.join(pasta(id), 'estado.json'), { ...lerEstado(id), limpoEm: dia });
}

/** busca no serviço o que chegou desde a última vez (de 500 em 500). zap = src/zap.js */
async function buscar(id, zap, agora = Date.now()) {
  let est = lerEstado(id), novas = 0;
  for (let volta = 0; volta < 40; volta++) {
    const r = await zap.conversas(id, est.desde || 0);
    // o serviço recomeçou a contagem (perdeu o arquivo): busca tudo de novo; o id não deixa repetir
    if (Number(r.ultimo) < (est.desde || 0)) { est = { ...est, desde: 0 }; continue; }
    novas += aplicar(id, r.itens, agora);
    const ult = (r.itens || []).reduce((mx, x) => Math.max(mx, Number(x.seq) || 0), est.desde || 0);
    est = { ...est, desde: r.mais ? ult : Math.max(ult, Number(r.ultimo) || 0), em: new Date(agora).toISOString() };
    gravar(path.join(pasta(id), 'estado.json'), est);
    if (!r.mais) break;
  }
  limpar(id, agora);
  return novas;
}

/** a lista de conversas (mais recentes primeiro), com a marca do robô quando a última mensagem foi dele */
function lista(id) {
  const ind = lerIndice(id);
  // índice gravado antes da marca "sem resposta": calcula uma vez pelas mensagens e guarda
  let mudou = false;
  for (const e of Object.values(ind)) if (e.ult && e.semResposta == null) { e.semResposta = semRespostaDe(ler(arqChat(id, e.chave), [])); mudou = true; }
  if (mudou) gravar(path.join(pasta(id), 'indice.json'), ind);
  const robo = lerRobo(id);
  return Object.values(ind).filter((e) => e.ult).map((e) => (e.ult.id && robo[e.ult.id] ? { ...e, ult: { ...e.ult, robo: robo[e.ult.id].camp || 'campanha' } } : e))
    .sort((a, b) => b.ult.em.localeCompare(a.ult.em));
}
/** as mensagens de uma conversa, com a marca do robô (nome da campanha) nas que ele mandou e de quem respondeu pelo painel */
function mensagens(id, chave) {
  if (!RE_CHAVE.test(String(chave || ''))) return null;
  const robo = lerRobo(id), resp = lerRespostas(id);
  return ler(arqChat(id, chave), []).map((m) => (robo[m.id] ? { ...m, robo: robo[m.id].camp || 'campanha' } : resp[m.id] ? { ...m, por: resp[m.id].por } : m));
}
const lerRespostas = (id) => ler(path.join(pasta(id), 'respostas.json'), {});
/** resposta enviada pelo painel (Conversas, fase 2): na conversa aparece "Loja · <quem respondeu>". Só o id da mensagem e quem; nunca o texto */
function marcarResposta(id, idMsg, por, agora = Date.now()) {
  if (!idMsg) return;
  const r = lerRespostas(id);
  const corte = agora - 400 * 864e5; // um pouco mais que os 12 meses das conversas
  for (const [k, v] of Object.entries(r)) if (!v || Date.parse(v.em) < corte) delete r[k];
  r[String(idMsg).slice(0, 200)] = { por: String(por || '').slice(0, 60), em: new Date(agora).toISOString() };
  gravar(path.join(pasta(id), 'respostas.json'), r);
}
/** a conversa existe e é de um número (não "lid:"): → o número para responder, ou null */
function numeroDaConversa(id, chave) {
  if (!/^\d{10,15}$/.test(String(chave || ''))) return null;
  return lerIndice(id)[chave] ? String(chave) : null;
}
/** alguém abriu a conversa: zera as não lidas */
function marcarLida(id, chave, agora = Date.now()) {
  const ind = lerIndice(id);
  if (!ind[chave]) return false;
  ind[chave].lidaEm = new Date(agora).toISOString();
  ind[chave].naoLidas = 0;
  gravar(path.join(pasta(id), 'indice.json'), ind);
  return true;
}
/**
 * Trava "em conversa" do robô (decisão do dono, 23/11/2026): { <número na chave única ZF.foneChave>: ISO da última mensagem
 * que NÃO é do robô } — do cliente ou da loja escrita por gente (celular da loja ou resposta pelo painel). Só conversas com
 * número (as "lid:" ficam de fora) e com mensagem nos últimos `dias` (o máximo aceito na configuração é 30).
 * O laço do robô chama a cada ~30 s: guarda a conta e só refaz quando o índice ou o robo.json mudam (data e tamanho).
 */
const cacheConv = new Map();
const marca = (arq) => { try { const s = fs.statSync(arq); return `${s.mtimeMs}:${s.size}`; } catch { return '-'; } };
function ultimaConversa(id, agora = Date.now(), dias = 30) {
  const chaveCache = `${marca(path.join(pasta(id), 'indice.json'))}|${marca(path.join(pasta(id), 'robo.json'))}|${dias}|${C.diaSP(agora)}`;
  const c = cacheConv.get(id);
  if (c && c.k === chaveCache) return c.v;
  const { foneChave } = require('./zapfila');
  const corte = new Date(agora - dias * 864e5).toISOString();
  const ind = lerIndice(id), robo = lerRobo(id), out = {};
  for (const e of Object.values(ind)) {
    // só abre o arquivo da conversa que teve mensagem (de quem for) dentro do prazo
    if (!e || !e.ult || !/^\d{10,15}$/.test(String(e.chave || '')) || !(e.ult.em >= corte)) continue;
    const msgs = ler(arqChat(id, e.chave), []);
    for (let i = msgs.length - 1; i >= 0 && msgs[i].em >= corte; i--) {
      if (robo[msgs[i].id]) continue; // mensagem do robô não conta
      const k = foneChave(e.chave);
      if (!out[k] || out[k] < msgs[i].em) out[k] = msgs[i].em;
      break;
    }
  }
  cacheConv.set(id, { k: chaveCache, v: out });
  return out;
}

/** o robô mandou esta mensagem (src/zaplaco.js): na conversa ela aparece com 🤖 e o nome da campanha */
function marcarRobo(id, idMsg, camp, agora = Date.now()) {
  if (!idMsg) return;
  const robo = lerRobo(id);
  robo[String(idMsg).slice(0, 200)] = { camp: String(camp || '').slice(0, 60), em: new Date(agora).toISOString() };
  gravar(path.join(pasta(id), 'robo.json'), robo);
}
// ---------- mídia (foto, áudio, vídeo, documento): decisão do dono, "baixar no computador e não armazenar na VPS" ----------
const TIPOS_MIDIA = ['imagem', 'video', 'audio', 'documento', 'figurinha'];
// só estes abrem na própria página; o resto (PDF, planilha…) só como download
const INLINE = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|aac|wav)|video\/mp4)(;.*)?$/i;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'video/mp4': 'mp4', 'application/pdf': 'pdf' };
const NOME_TIPO = { imagem: 'foto', figurinha: 'figurinha', audio: 'audio', video: 'video', documento: 'documento' };
/**
 * Confere que a mensagem é desta conversa guardada e é mídia, e busca no serviço do WhatsApp (src/zap.js → midia).
 * → { ok, dados, mimetype, nome, tipo, em } ou { ok: false, codigo, erro }. Nada é gravado.
 */
async function midiaDe(id, chave, idMsg, zap) {
  const msgs = mensagens(id, chave);
  if (!msgs) return { ok: false, codigo: 400, erro: 'Conversa inválida.' };
  const m = msgs.find((x) => x.id === idMsg);
  if (!m) return { ok: false, codigo: 404, erro: 'Mensagem não encontrada nesta conversa.' };
  if (!TIPOS_MIDIA.includes(m.tipo)) return { ok: false, codigo: 400, erro: 'Esta mensagem não tem foto, áudio, vídeo nem documento.' };
  const r = await zap.midia(id, idMsg);
  return r && r.ok ? { ...r, tipo: m.tipo, em: m.em } : r || { ok: false, codigo: 502, erro: 'O WhatsApp não respondeu agora.' };
}
/** nome do arquivo para salvar no computador: foto-22-11-2031.jpg (documento: o nome original, limpo) */
function nomeArquivo(r) {
  const tipo = String(r.mimetype || '').split(';')[0].trim().toLowerCase();
  if (r.tipo === 'documento' && r.nome) { const n = String(r.nome).replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').slice(0, 80); if (n) return n; }
  const d = r.em ? new Date(r.em) : new Date();
  const parte = (o) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', ...o }).format(d);
  const quando = `${parte({ day: '2-digit' })}-${parte({ month: '2-digit' })}-${parte({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(':', '')}`;
  return `${NOME_TIPO[r.tipo] || 'arquivo'}-${quando}.${EXT[tipo] || 'bin'}`.replace(/\s/g, '');
}
/** repassa o arquivo ao navegador: sem cache, sem adivinhar tipo; só imagem/áudio/vídeo seguros abrem na página */
function responderMidia(res, r) {
  const tipo = String(r.mimetype || 'application/octet-stream').slice(0, 100);
  const inline = INLINE.test(tipo);
  const nome = nomeArquivo(r);
  res.set({
    'Content-Type': inline ? tipo : 'application/octet-stream',
    'Content-Length': String(r.dados.length),
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${nome.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
    'X-Midia-Nome': encodeURIComponent(nome),
  });
  res.status(200).end(r.dados);
}
/** apresentação: uma imagem desenhada (sem foto de ninguém) — um PNG 240×160 com faixas nas cores do painel */
function demoImagem() {
  const zlib = require('zlib');
  const L = 240, A = 160, linhas = [];
  for (let y = 0; y < A; y++) {
    const l = Buffer.alloc(1 + L * 3);
    for (let x = 0; x < L; x++) {
      const xadrez = ((x >> 4) + (y >> 4)) % 2;
      const [r, g, b] = y < 40 ? [44, 82, 52] : y > 120 ? [201, 162, 39] : xadrez ? [230, 238, 227] : [244, 241, 234];
      l[1 + x * 3] = r; l[2 + x * 3] = g; l[3 + x * 3] = b;
    }
    linhas.push(l);
  }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const bloco = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(L, 0); ihdr.writeUInt32BE(A, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(Buffer.concat(linhas))), bloco('IEND', Buffer.alloc(0))]);
}
/** apresentação: meio segundo de silêncio (WAV) */
function demoSilencio() {
  const taxa = 8000, n = taxa / 2, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(taxa, 24); b.writeUInt32LE(taxa, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

/** o WhatsApp da loja foi desconectado: as conversas guardadas saem junto (decisão do dono) */
function apagar(id) { fs.rmSync(pasta(id), { recursive: true, force: true }); }

// ---------- a tarefa: a cada 30 s, para as lojas com o WhatsApp conectado ----------
let rodando = false;
const avisado = new Map(); // loja → quando avisou no log (uma vez por hora: serviço antigo sem /conversas, fora do ar…)
async function rodada(zap, lojas) {
  if (rodando) return;
  rodando = true;
  try {
    for (const l of lojas()) {
      try { await buscar(l, zap); avisado.delete(l); } catch (e) {
        if (Date.now() - (avisado.get(l) || 0) < 3600e3) continue;
        avisado.set(l, Date.now());
        const velho = /respondeu 404/.test(e.message) ? ' (o serviço do WhatsApp é de uma versão antiga: reconstrua com docker compose --profile zap up -d --build zap)' : '';
        console.error(`[conversas] ${l}: ${C.msgErro(e)}${velho}`);
      }
    }
  } finally { rodando = false; }
}
function iniciar() {
  const zap = require('./zap');
  if (!zap.ativo()) return null;
  const ZF = require('./zapfila');
  const lojas = () => (C.get().lojas || []).map((l) => l.id).filter((id) => ZF.temEstado(id) && ZF.lerEstado(id).sessao);
  const t = setInterval(() => rodada(zap, lojas), 30e3);
  t.unref();
  return t;
}

module.exports = { ultimaConversa, marcarResposta, numeroDaConversa, TIPOS_MIDIA, midiaDe, responderMidia, nomeArquivo, demoImagem, demoSilencio, MESES, semRespostaDe, aplicar, limpar, buscar, lista, mensagens, marcarLida, marcarRobo, apagar, lerEstado, iniciar, RE_CHAVE };
