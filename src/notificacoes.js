'use strict';
/**
 * Resumo diário por Telegram e/ou e-mail (config/notificacoes.json, editado em Configurações).
 * {
 *   ativo, horario: "08:00", ultimoEnvio: "2026-11-11",
 *   telegram: { token, destinos: [{ chatId, nome, lojas: ["*"] | [ids] }] },
 *   email:    { host, port, secure, user, pass, from, destinos: [{ email, nome, lojas }] }
 * }
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');
const I = require('./indicadores');

const ARQ = path.join(C.CONFIG_DIR, 'notificacoes.json');
const PADRAO = { ativo: false, horario: '08:00', ultimoEnvio: null, alertas: true, telegram: { token: '', destinos: [] }, email: { host: '', port: 587, secure: false, user: '', pass: '', from: '', destinos: [] } };

function ler() {
  try { const j = JSON.parse(fs.readFileSync(ARQ, 'utf8')); return { ...PADRAO, ...j, telegram: { ...PADRAO.telegram, ...(j.telegram || {}) }, email: { ...PADRAO.email, ...(j.email || {}) } }; } catch { return JSON.parse(JSON.stringify(PADRAO)); }
}
function gravar(cfg) { C.gravarAtomico(ARQ, JSON.stringify(cfg, null, 2), 0o600); }

/** visão para a tela (sem segredos) */
function publico() {
  const c = ler();
  return {
    ativo: c.ativo, horario: c.horario, ultimoEnvio: c.ultimoEnvio, alertas: c.alertas,
    telegram: { configurado: !!c.telegram.token, destinos: c.telegram.destinos },
    email: { host: c.email.host, port: c.email.port, secure: c.email.secure, user: c.email.user, from: c.email.from, temSenha: !!c.email.pass, configurado: !!(c.email.host && c.email.from), destinos: c.email.destinos },
  };
}

// ---------- Telegram ----------
async function tg(token, metodo, corpo) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description || `Telegram HTTP ${r.status}`);
    return j.result;
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'o Telegram não respondeu' : e.message === 'fetch failed' ? 'sem conexão com o Telegram (a VPS consegue acessar api.telegram.org?)' : String(e.message).replace(token, '***');
    throw new Error(msg);
  } finally { clearTimeout(t); }
}
/** pessoas que mandaram mensagem para o robô (para vincular) */
async function conversasTelegram() {
  const c = ler();
  if (!c.telegram.token) throw new Error('Cadastre o token do robô primeiro.');
  const ups = await tg(c.telegram.token, 'getUpdates', { limit: 100, allowed_updates: ['message'] });
  const m = new Map();
  for (const u of ups) {
    const ch = u.message && u.message.chat;
    if (!ch) continue;
    m.set(String(ch.id), { chatId: String(ch.id), nome: [ch.first_name, ch.last_name].filter(Boolean).join(' ') || ch.title || '', usuario: ch.username || '', texto: (u.message.text || '').slice(0, 40), em: new Date(u.message.date * 1000).toISOString() });
  }
  const ja = new Set(c.telegram.destinos.map((d) => String(d.chatId)));
  return [...m.values()].filter((x) => !ja.has(x.chatId));
}
async function enviarTelegram(chatId, texto) {
  const c = ler();
  // Telegram limita 4096 caracteres por mensagem
  for (let i = 0; i < texto.length; i += 3900) await tg(c.telegram.token, 'sendMessage', { chat_id: chatId, text: texto.slice(i, i + 3900), disable_web_page_preview: true });
}

// ---------- e-mail ----------
async function enviarEmail(para, assunto, texto) {
  const c = ler().email;
  if (!c.host || !c.from) throw new Error('Configure o servidor de e-mail.');
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ host: c.host, port: +c.port || 587, secure: !!c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined, connectionTimeout: 15000 });
  const esc = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1d2b22">${texto.split('\n').map((l) => (l.startsWith('━') ? '<hr style="border:0;border-top:2px solid #2C5234">' : l ? `<div>${esc(l)}</div>` : '<br>')).join('')}</div>`;
  await t.sendMail({ from: c.from, to: para, subject: assunto, text: texto, html });
}

// ---------- montagem ----------
/** obter(lojaId) → { loja, vendas, metaPlanilha } */
async function montarTexto(lojasIds, obter, comAlertas = true) {
  const cfg = C.get();
  const ids = lojasIds.includes('*') ? cfg.lojas.map((l) => l.id) : lojasIds;
  const blocos = [];
  for (const id of ids) {
    try {
      const d = await obter(id);
      if (!d) continue;
      const r = I.resumoDiario(d);
      const al = comAlertas ? r.alertas.filter((a) => a.tipo !== 'alta').slice(0, 4) : [];
      const bons = comAlertas ? r.alertas.filter((a) => a.tipo === 'alta').slice(0, 2) : [];
      blocos.push([`━━ ${r.titulo} ━━`, ...r.linhas,
        ...(al.length ? ['', '⚠️ Atenção:', ...al.map((a) => '• ' + a.texto)] : []),
        ...(bons.length ? ['', '👏 Destaques:', ...bons.map((a) => '• ' + a.texto)] : [])].join('\n'));
    } catch (e) { blocos.push(`━━ ${id} ━━\nNão foi possível montar o resumo: ${e.message}`); }
  }
  if (!blocos.length) return null;
  return `☕ Tea Shop · resumo diário\n\n${blocos.join('\n\n')}`;
}

/** envia para todos (ou só para um destino, no teste) */
async function enviarTodos(obter, { soDestino } = {}) {
  const c = ler();
  const res = [];
  const assunto = `Tea Shop · resumo de ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
  if (c.telegram.token) {
    for (const d of c.telegram.destinos) {
      if (soDestino && !(soDestino.canal === 'telegram' && String(soDestino.id) === String(d.chatId))) continue;
      try { const txt = await montarTexto(d.lojas, obter, c.alertas); if (txt) { await enviarTelegram(d.chatId, txt); res.push({ canal: 'telegram', para: d.nome || d.chatId, ok: true }); } } catch (e) { res.push({ canal: 'telegram', para: d.nome || d.chatId, ok: false, erro: e.message }); }
    }
  }
  if (c.email.host) {
    for (const d of c.email.destinos) {
      if (soDestino && !(soDestino.canal === 'email' && soDestino.id === d.email)) continue;
      try { const txt = await montarTexto(d.lojas, obter, c.alertas); if (txt) { await enviarEmail(d.email, assunto, txt); res.push({ canal: 'email', para: d.email, ok: true }); } } catch (e) { res.push({ canal: 'email', para: d.email, ok: false, erro: e.message }); }
    }
  }
  return res;
}

/** agenda: confere a cada 30 s se chegou o horário (Brasília) */
function agendar(obter) {
  setInterval(async () => {
    const c = ler();
    if (!c.ativo) return;
    const { iso, hhmm } = I.hojeSP();
    if (c.ultimoEnvio === iso || hhmm < c.horario) return;
    c.ultimoEnvio = iso; gravar(c); // marca antes: nunca envia duas vezes no mesmo dia
    try {
      const r = await enviarTodos(obter);
      C.auditar('sistema', 'enviou resumo diário', 'notificações', { envios: r.length, falhas: r.filter((x) => !x.ok).map((x) => `${x.para}: ${x.erro}`) });
      console.log(`[resumo] enviado: ${r.filter((x) => x.ok).length} ok, ${r.filter((x) => !x.ok).length} falha(s)`);
    } catch (e) { console.error('[resumo] erro:', e.message); }
  }, 30e3);
}

module.exports = { ler, gravar, publico, conversasTelegram, enviarTodos, montarTexto, agendar };
