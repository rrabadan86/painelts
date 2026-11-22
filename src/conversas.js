'use strict';
/**
 * Clientes → Conversas (decisão do dono): as conversas do WhatsApp da loja, lidas pelo serviço "zap" e guardadas aqui.
 * Só admin e franqueado da loja veem (server.js). O texto fica só nesta pasta: nunca vai para log nem auditoria.
 *
 *   dados/<loja>/conversas/estado.json   { desde (último número que o serviço entregou), em, limpoEm }
 *   dados/<loja>/conversas/indice.json   { <chave>: { chave, nome, ult: { em, texto, deMim, tipo }, n, naoLidas, lidaEm } }
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
    e.ult = { em: ult.em, texto: ult.texto.slice(0, 140), deMim: ult.deMim, tipo: ult.tipo };
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

/** a lista de conversas (mais recentes primeiro) */
function lista(id) {
  return Object.values(lerIndice(id)).filter((e) => e.ult).sort((a, b) => b.ult.em.localeCompare(a.ult.em));
}
/** as mensagens de uma conversa, com a marca do robô (nome da campanha) nas que ele mandou */
function mensagens(id, chave) {
  if (!RE_CHAVE.test(String(chave || ''))) return null;
  const robo = lerRobo(id);
  return ler(arqChat(id, chave), []).map((m) => (robo[m.id] ? { ...m, robo: robo[m.id].camp || 'campanha' } : m));
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
/** o robô mandou esta mensagem (src/zaplaco.js): na conversa ela aparece com 🤖 e o nome da campanha */
function marcarRobo(id, idMsg, camp, agora = Date.now()) {
  if (!idMsg) return;
  const robo = lerRobo(id);
  robo[String(idMsg).slice(0, 200)] = { camp: String(camp || '').slice(0, 60), em: new Date(agora).toISOString() };
  gravar(path.join(pasta(id), 'robo.json'), robo);
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

module.exports = { MESES, aplicar, limpar, buscar, lista, mensagens, marcarLida, marcarRobo, apagar, lerEstado, iniciar, RE_CHAVE };
