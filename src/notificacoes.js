'use strict';
/**
 * Resumo diário por Telegram e/ou e-mail (config/notificacoes.json, editado em Configurações).
 * {
 *   ativo, horario: "08:00", ultimoEnvio: "2026-11-11",
 *   telegram: { token, destinos: [{ chatId, nome, lojas: ["*"] | [ids] }] },
 *   email:    { host, port, secure, user, pass, from, destinos: [{ email, nome, lojas }] },
 *   lojas: { <id>: { email: { host, port, secure, user, pass, from }, destinos: [{ email, nome }],
 *                    fechamento: { ativo, horario, ultimoEnvio } } }   ← fechamento do dia de cada franquia
 * }
 * Fechamento do dia: cada loja envia pelo PRÓPRIO Gmail (SMTP da loja) para os destinatários dela
 * e também para os destinatários gerais (franqueador) que acompanham aquela loja — um e-mail por loja.
 * Sem SMTP próprio, a loja usa o servidor geral.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');
const I = require('./indicadores');
const F = require('./fechamento');

const ARQ = path.join(C.CONFIG_DIR, 'notificacoes.json');
const PADRAO_LOJA = { email: { host: '', port: 587, secure: false, user: '', pass: '', from: '' }, destinos: [], fechamento: { ativo: false, horario: '23:30', ultimoEnvio: null } };
const PADRAO = { lojas: {}, ativo: false, horario: '08:00', ultimoEnvio: null, alertas: true, fechamento: { ativo: false, horario: '23:30', ultimoEnvio: null }, telegram: { token: '', destinos: [] }, email: { host: '', port: 587, secure: false, user: '', pass: '', from: '', destinos: [] } };

function ler() {
  try { const j = JSON.parse(fs.readFileSync(ARQ, 'utf8')); return { ...PADRAO, ...j, fechamento: { ...PADRAO.fechamento, ...(j.fechamento || {}) }, telegram: { ...PADRAO.telegram, ...(j.telegram || {}) }, email: { ...PADRAO.email, ...(j.email || {}) } }; } catch { return JSON.parse(JSON.stringify(PADRAO)); }
}
/** configuração do fechamento de uma loja (com padrões) — altera o objeto c quando criar */
function cfgLoja(c, id) {
  const x = (c.lojas ||= {})[id] ||= {};
  x.email = { ...PADRAO_LOJA.email, ...(x.email || {}) };
  x.destinos = Array.isArray(x.destinos) ? x.destinos : [];
  x.fechamento = { ...PADRAO_LOJA.fechamento, ...(x.fechamento || {}) };
  return x;
}
const smtpOk = (e) => !!(e && e.host && e.from);
/** visão da loja para a tela (sem a senha) */
function publicoLoja(id) {
  const c = ler();
  const x = cfgLoja(c, id);
  const gerais = c.email.destinos.filter((d) => d.lojas.includes('*') || d.lojas.includes(id)).map((d) => ({ email: d.email, nome: d.nome }));
  return {
    email: { host: x.email.host, port: x.email.port, secure: x.email.secure, user: x.email.user, from: x.email.from, temSenha: !!x.email.pass, configurado: smtpOk(x.email) },
    destinos: x.destinos, fechamento: x.fechamento, gerais, servidorGeral: smtpOk(c.email),
  };
}
function gravar(cfg) { C.gravarAtomico(ARQ, JSON.stringify(cfg, null, 2), 0o600); }

/** visão para a tela (sem segredos) */
function publico() {
  const c = ler();
  return {
    ativo: c.ativo, horario: c.horario, ultimoEnvio: c.ultimoEnvio, alertas: c.alertas, fechamento: c.fechamento,
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
async function enviarEmail(para, assunto, texto, htmlPronto, smtp) {
  const c = smtp || ler().email;
  if (!c.host || !c.from) throw new Error('Configure o servidor de e-mail.');
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ host: c.host, port: +c.port || 587, secure: !!c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined, connectionTimeout: 15000 });
  const esc = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1d2b22">${texto.split('\n').map((l) => (l.startsWith('━') ? '<hr style="border:0;border-top:2px solid #2C5234">' : l ? `<div>${esc(l)}</div>` : '<br>')).join('')}</div>`;
  await t.sendMail({ from: c.from, to: para, subject: assunto, text: texto, html: htmlPronto || html });
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
  return `☕ Tea Shop · resumo diário\n\n${blocos.join('\n\n')}\n\n— Desenvolvido por Rodrigo Rabadan`;
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

// ---------- fechamento do dia (substitui a planilha preenchida à mão) ----------
/** fechamento de hoje de cada loja do destino → { texto, html } (null se nenhuma loja vendeu) */
async function montarFechamento(lojasIds, obter, dia) {
  const cfg = C.get();
  const ids = lojasIds.includes('*') ? cfg.lojas.map((l) => l.id) : lojasIds;
  const textos = [], htmls = [];
  for (const id of ids) {
    try {
      const d = await obter(id);
      if (!d) continue;
      const f = F.calcular(d, dia);
      if (!f.temVendas) { textos.push(`━━ ${f.loja.nome} ━━\nSem vendas registradas em ${dia.split('-').reverse().join('/')} (a coleta da noite já rodou?).`); htmls.push(`<p><b>${f.loja.nome}</b>: sem vendas registradas no dia.</p>`); continue; }
      textos.push(F.texto(f)); htmls.push(F.html(f));
    } catch (e) { textos.push(`━━ ${id} ━━\nNão foi possível montar o fechamento: ${e.message}`); }
  }
  if (!textos.length) return null;
  return {
    texto: `☕ Tea Shop · fechamento do dia\nGerado automaticamente pelo Painel Tea Shop com as vendas do AppNext · desenvolvido por Rodrigo Rabadan\n\n${textos.join('\n\n')}`,
    html: `<div style="font-family:Arial,sans-serif">${htmls.join('<div style="height:18px"></div>')}<p style="color:#7a857d;font-size:12px">Não precisa responder: este e-mail é enviado todo dia pelo painel, no horário configurado.</p></div>`,
  };
}
/**
 * envia o fechamento de UMA loja: pelo Gmail da loja (ou o servidor geral), para os destinatários
 * da loja + os gerais (franqueador) que acompanham a loja; Telegram geral também, se houver.
 * soPara: só este e-mail/chatId (teste).
 */
async function enviarFechamentoLoja(obter, lojaId, { dia, soPara } = {}) {
  const c = ler();
  const x = cfgLoja(c, lojaId);
  const d = dia || I.hojeSP().iso;
  const loja = C.get().lojas.find((l) => l.id === lojaId);
  const nomeLoja = loja ? loja.nome : lojaId;
  const res = [];
  const m = await montarFechamento([lojaId], obter, d);
  if (!m) return res;
  const smtp = smtpOk(x.email) ? x.email : smtpOk(c.email) ? c.email : null;
  const assunto = `${nomeLoja} · fechamento de ${d.split('-').reverse().join('/')}`;
  const cobre = (ls) => ls.includes('*') || ls.includes(lojaId);
  const emails = new Map();
  for (const y of x.destinos) emails.set(y.email.toLowerCase(), y.nome || y.email);
  for (const y of c.email.destinos) if (cobre(y.lojas)) emails.set(y.email.toLowerCase(), y.nome || y.email);
  for (const [email, nome] of emails) {
    if (soPara && soPara.toLowerCase() !== email) continue;
    if (!smtp) { res.push({ canal: 'email', loja: nomeLoja, para: email, ok: false, erro: 'a loja ainda não tem o Gmail configurado' }); continue; }
    try { await enviarEmail(email, assunto, m.texto, m.html, smtp); res.push({ canal: 'email', loja: nomeLoja, para: email, nome, ok: true }); } catch (e) { res.push({ canal: 'email', loja: nomeLoja, para: email, ok: false, erro: e.message }); }
  }
  if (c.telegram.token) {
    for (const y of c.telegram.destinos) {
      if (!cobre(y.lojas) || (soPara && String(soPara) !== String(y.chatId))) continue;
      try { await enviarTelegram(y.chatId, m.texto); res.push({ canal: 'telegram', loja: nomeLoja, para: y.nome || y.chatId, ok: true }); } catch (e) { res.push({ canal: 'telegram', loja: nomeLoja, para: y.nome || y.chatId, ok: false, erro: e.message }); }
    }
  }
  return res;
}
/** teste de um destinatário geral: um envio por loja que ele acompanha */
async function enviarFechamento(obter, { soDestino, dia } = {}) {
  const c = ler();
  const ids = C.get().lojas.map((l) => l.id);
  const res = [];
  for (const id of ids) {
    const lista = soDestino && soDestino.canal === 'telegram' ? c.telegram.destinos : c.email.destinos;
    const alvo = soDestino && lista.find((y) => String(y.chatId || y.email) === String(soDestino.id));
    if (soDestino && !(alvo && (alvo.lojas.includes('*') || alvo.lojas.includes(id)))) continue;
    res.push(...await enviarFechamentoLoja(obter, id, { dia, soPara: soDestino && soDestino.id }));
  }
  return res;
}

/** agenda: confere a cada 30 s se chegou o horário (Brasília) */
function agendar(obter) {
  setInterval(async () => {
    const c = ler();
    const { iso, hhmm } = I.hojeSP();
    // fechamento do dia de cada loja, no horário da loja
    for (const l of C.get().lojas) {
      const x = c.lojas && c.lojas[l.id] && cfgLoja(c, l.id);
      if (!x || !x.fechamento.ativo || x.fechamento.ultimoEnvio === iso || hhmm < x.fechamento.horario) continue;
      x.fechamento.ultimoEnvio = iso; gravar(c); // marca antes: nunca envia duas vezes no mesmo dia
      try {
        const r = await enviarFechamentoLoja(obter, l.id, { dia: iso });
        C.auditar('sistema', 'enviou fechamento do dia', l.id, { loja: l.id, envios: r.length, falhas: r.filter((y) => !y.ok).map((y) => `${y.para}: ${y.erro}`) });
      } catch (e) { console.error(`[fechamento] ${l.id}:`, e.message); }
    }
    if (!c.ativo) return;
    if (c.ultimoEnvio === iso || hhmm < c.horario) return;
    c.ultimoEnvio = iso; gravar(c); // marca antes: nunca envia duas vezes no mesmo dia
    try {
      const r = await enviarTodos(obter);
      C.auditar('sistema', 'enviou resumo diário', 'notificações', { envios: r.length, falhas: r.filter((x) => !x.ok).map((x) => `${x.para}: ${x.erro}`) });
      console.log(`[resumo] enviado: ${r.filter((x) => x.ok).length} ok, ${r.filter((x) => !x.ok).length} falha(s)`);
    } catch (e) { console.error('[resumo] erro:', e.message); }
  }, 30e3);
}

module.exports = { ler, gravar, publico, publicoLoja, cfgLoja, conversasTelegram, enviarTodos, montarTexto, agendar, montarFechamento, enviarFechamento, enviarFechamentoLoja };
