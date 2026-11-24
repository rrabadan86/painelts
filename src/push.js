'use strict';
/**
 * Notificações no aparelho (Web Push): quem ativou, em quais aparelhos, quais tipos de aviso, e o envio de cada evento.
 *   config/push.json = { usuarios: { <usuário>: [{ id, endpoint, keys, nome, tipos, criadoEm, ultimoEm }] }, avisados: { <chave>: ms } }
 * Regras:
 *   - a permissão é conferida A CADA ENVIO (usuário ativo, com acesso à loja e com a tela do aviso): quem perde a permissão para de receber;
 *     usuário excluído tem os aparelhos apagados no envio seguinte;
 *   - cada evento tem uma chave e é marcado como avisado ANTES do envio: nunca repete;
 *   - o serviço respondeu 404/410: o aparelho sai da lista;
 *   - avisar() nunca lança nem atrasa quem chamou (o envio corre por fora, com espera limitada);
 *   - a tela nunca recebe chave nem endereço de entrega: só id, nome do aparelho, tipos e datas.
 * A cifra e a entrega ficam em webpush.js.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const C = require('./config');
const W = require('./webpush');
const TELAS = require('./telas');

const ARQ = () => path.join(C.CONFIG_DIR, 'push.json');
const MAX_APARELHOS = 10, DIAS_AVISADO = 45;

/** a pessoa tem a tela? (admin e franqueado: todas; gerente: as marcadas; vendedora: só as fixas dela) */
function temTela(u, id) {
  if (!u) return false;
  if (u.perfil === 'admin' || u.perfil === 'franqueado') return true;
  if (u.perfil === 'gerente') return (C.telasDo(u) || []).includes(id) || TELAS.regra(id, 'gerente') === 'sempre';
  return TELAS.regra(id, 'vendedor') === 'sempre';
}
/** tipos de aviso: quem pode receber cada um (a mesma regra de quem vê a tela do assunto) */
const TIPOS = [
  { id: 'espera', nome: 'Lista de espera: produto chegou', dica: 'Quando chega um produto que tem cliente esperando. Para quem usa a Lista de espera.', pode: (u) => temTela(u, 'espera') },
  { id: 'validade', nome: 'Chá aberto perto dos 6 meses', dica: 'Quando um chá a granel que já foi para a lata entra nos últimos 30 dias do prazo de 6 meses depois de aberto. Para quem usa a tela Validade.', pode: (u) => temTela(u, 'validade') },
  { id: 'sugestao', nome: '⭐ Nova sugestão da equipe para o pedido', dica: 'Quando alguém da equipe sugere um produto para o pedido. Para quem tem a tela Pedido (é quem decide).', pode: (u) => u.perfil !== 'vendedor' && temTela(u, 'pedido') },
  { id: 'zap', nome: 'Robô do WhatsApp parou', dica: 'Quando o robô das campanhas pausa sozinho depois de falhas ou a conexão com o WhatsApp da loja cai. Para admin, franqueado e gerente com a tela Clientes.', pode: (u) => u.perfil !== 'vendedor' && temTela(u, 'clientes') },
];
const porId = (id) => TIPOS.find((t) => t.id === id);

function ler() {
  try { const j = JSON.parse(fs.readFileSync(ARQ(), 'utf8')); return { usuarios: j.usuarios && typeof j.usuarios === 'object' ? j.usuarios : {}, avisados: j.avisados && typeof j.avisados === 'object' ? j.avisados : {} }; }
  catch { return { usuarios: {}, avisados: {} }; }
}
const gravar = (s) => C.gravarAtomico(ARQ(), JSON.stringify(s));
const idDe = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 16);

/** usuário de verdade, ativo e dentro do prazo (o cadastro é lido na hora) */
function usuarioVivo(nome) {
  const u = C.get().usuarios[nome];
  return u && u.ativo && !C.expirado(u) ? u : null;
}
const acessaLoja = (u, lojaId) => !lojaId || u.perfil === 'admin' || (u.lojas || []).includes('*') || (u.lojas || []).includes(lojaId);
/** pode receber este tipo de aviso desta loja AGORA? */
function podeReceber(nome, tipo, lojaId) {
  const u = usuarioVivo(nome), t = porId(tipo);
  return !!(u && t && !u.trocarSenha && acessaLoja(u, lojaId) && t.pode(u));
}
/** tipos que a pessoa pode escolher (em qualquer loja dela) */
const tiposDe = (nome) => { const u = usuarioVivo(nome); return u ? TIPOS.filter((t) => t.pode(u)).map(({ id, nome: n, dica }) => ({ id, nome: n, dica })) : []; };

/** nome do aparelho pelo navegador (nada que identifique a pessoa) */
function nomeAparelho(ua) {
  const s = String(ua || '');
  const nav = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Navegador';
  const so = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'aparelho';
  return `${nav} no ${so}`;
}
const publico = (a) => ({ id: a.id, nome: a.nome, tipos: a.tipos, criadoEm: a.criadoEm, ultimoEm: a.ultimoEm || null });
const tiposOk = (nome, tipos) => { const pode = new Set(tiposDe(nome).map((t) => t.id)); return [...new Set(Array.isArray(tipos) ? tipos : [])].filter((t) => pode.has(t)); };

/** aparelhos da pessoa (sem chave nem endereço) */
const aparelhos = (nome) => (ler().usuarios[nome] || []).map(publico);
/** ativa (ou atualiza) este aparelho para a pessoa. Um aparelho pertence a uma pessoa só: quem ativou por último. */
function ativar(nome, b, ua) {
  if (!usuarioVivo(nome)) return { erro: 'Usuário sem acesso.' };
  const endpoint = b && b.endpoint, keys = b && b.keys;
  if (!W.enderecoOk(endpoint)) return { erro: 'Este navegador usa um serviço de notificações que o painel não conhece.' };
  if (!W.chavesOk(keys)) return { erro: 'O navegador mandou uma chave inválida. Desative e ative de novo.' };
  const s = ler(), id = idDe(endpoint);
  for (const [outro, l] of Object.entries(s.usuarios)) if (outro !== nome) { s.usuarios[outro] = l.filter((a) => a.id !== id); if (!s.usuarios[outro].length) delete s.usuarios[outro]; }
  const l = s.usuarios[nome] || (s.usuarios[nome] = []);
  const antes = l.find((a) => a.id === id);
  if (!antes && l.length >= MAX_APARELHOS) return { erro: `Máximo de ${MAX_APARELHOS} aparelhos por pessoa. Remova um que não usa mais.` };
  const tipos = b.tipos == null ? (antes ? antes.tipos : tiposDe(nome).map((t) => t.id)) : tiposOk(nome, b.tipos);
  const ap = { id, endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, nome: nomeAparelho(ua), tipos, criadoEm: antes ? antes.criadoEm : new Date().toISOString(), ultimoEm: antes ? antes.ultimoEm : null };
  s.usuarios[nome] = [...l.filter((a) => a.id !== id), ap];
  gravar(s);
  return { ok: publico(ap), novo: !antes };
}
function mudarTipos(nome, id, tipos) {
  const s = ler(), ap = (s.usuarios[nome] || []).find((a) => a.id === id);
  if (!ap) return { erro: 'Aparelho não encontrado.' };
  ap.tipos = tiposOk(nome, tipos);
  gravar(s);
  return { ok: publico(ap) };
}
function remover(nome, id) {
  const s = ler(), l = s.usuarios[nome] || [];
  if (!l.some((a) => a.id === id)) return { erro: 'Aparelho não encontrado.' };
  s.usuarios[nome] = l.filter((a) => a.id !== id);
  if (!s.usuarios[nome].length) delete s.usuarios[nome];
  gravar(s);
  return { ok: true };
}
/** tira da lista os aparelhos que o serviço disse que não existem mais */
function tirarSumidos(ids) {
  if (!ids.length) return;
  const s = ler(), fora = new Set(ids);
  for (const [n, l] of Object.entries(s.usuarios)) { s.usuarios[n] = l.filter((a) => !fora.has(a.id)); if (!s.usuarios[n].length) delete s.usuarios[n]; }
  gravar(s);
}
const corpoDe = (e) => ({ titulo: String(e.titulo || 'Tea Shop · Painel').slice(0, 80), texto: String(e.texto || '').slice(0, 300), link: /^\/(?!\/)/.test(e.link || '') ? e.link : '/', tag: e.tipo || 'painel' });

/** mensagem de teste para um aparelho da própria pessoa */
async function testar(nome, id, opt = {}) {
  const ap = (ler().usuarios[nome] || []).find((a) => a.id === id);
  if (!ap || !usuarioVivo(nome)) return { erro: 'Aparelho não encontrado.' };
  const r = await W.enviar(ap, corpoDe({ titulo: 'Tea Shop · teste', texto: 'As notificações deste aparelho estão funcionando. ✅', link: '/', tipo: 'teste' }), { ...opt, urgencia: 'high' });
  if (r.sumiu) { tirarSumidos([id]); return { erro: 'Este aparelho não está mais registrado no serviço de notificações. Ative de novo.', sumiu: true }; }
  return r.ok ? { ok: true } : { erro: r.erro || `O serviço de notificações recusou (código ${r.status}). Tente de novo em instantes.` };
}

/**
 * Evento do painel → notificação para quem pode e escolheu receber.
 *   e = { tipo, loja, chave, titulo, texto, link, menos }   (menos = usuário que causou o evento: não recebe o próprio aviso)
 * Marca `chave` como avisada antes de enviar. Nunca lança. → { repetido } ou { enviados, falhas, removidos, pessoas }
 */
async function avisar(e, opt = {}) {
  try {
    if (require('./config').homolog()) return { enviados: 0, falhas: 0, removidos: 0, pessoas: [], homolog: true }; // HOMOLOG-01
    if (!e || !porId(e.tipo)) return { enviados: 0, falhas: 0, removidos: 0, pessoas: [] };
    const s = ler(), agora = Date.now();
    if (e.chave) {
      if (s.avisados[e.chave]) return { repetido: true };
      for (const [k, t] of Object.entries(s.avisados)) if (agora - t > DIAS_AVISADO * 864e5) delete s.avisados[k];
      s.avisados[e.chave] = agora;
    }
    // quem foi excluído do painel perde os aparelhos aqui
    const cfg = C.get().usuarios;
    for (const n of Object.keys(s.usuarios)) if (!cfg[n]) delete s.usuarios[n];
    gravar(s);
    const corpo = corpoDe(e), alvos = [], pessoas = [];
    for (const [n, l] of Object.entries(s.usuarios)) {
      if (n === e.menos || !podeReceber(n, e.tipo, e.loja)) continue;
      const aps = l.filter((a) => (a.tipos || []).includes(e.tipo));
      if (aps.length) { pessoas.push(n); alvos.push(...aps); }
    }
    const rs = await Promise.all(alvos.map((a) => W.enviar(a, corpo, opt).then((r) => ({ a, r }))));
    const sumidos = rs.filter((x) => x.r.sumiu).map((x) => x.a.id), ok = rs.filter((x) => x.r.ok).map((x) => x.a.id);
    if (sumidos.length || ok.length) {
      const s2 = ler(), fora = new Set(sumidos), foi = new Set(ok), quando = new Date(agora).toISOString();
      for (const [n, l] of Object.entries(s2.usuarios)) { s2.usuarios[n] = l.filter((a) => !fora.has(a.id)); s2.usuarios[n].forEach((a) => { if (foi.has(a.id)) a.ultimoEm = quando; }); if (!s2.usuarios[n].length) delete s2.usuarios[n]; }
      gravar(s2);
    }
    return { enviados: ok.length, falhas: rs.length - ok.length, removidos: sumidos.length, pessoas };
  } catch (err) { console.error('[push] aviso:', C.msgErro(err)); return { enviados: 0, falhas: 0, removidos: 0, pessoas: [], erro: true }; }
}
/** o mesmo, sem esperar: para chamar no meio de uma rota ou do laço do robô */
function avisarDepois(e) { setImmediate(() => { avisar(e).catch(() => null); }); }

module.exports = { TIPOS, tiposDe, podeReceber, aparelhos, ativar, mudarTipos, remover, testar, avisar, avisarDepois, idDe, nomeAparelho, ARQ };
