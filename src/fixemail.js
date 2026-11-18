'use strict';
/**
 * Cadastro de clientes pelo FIXE:
 *   1) o coletor pede a exportação da "Base de leads" no FIXE e deixa dados/<loja>/fixe/pedido.json;
 *   2) aqui o painel entra no Gmail da loja (IMAP, mesma senha de app do envio), acha o e-mail
 *      "[Tea Shop] Arquivo Exportado" de fixe@fixecrm.com.br — na caixa de entrada OU no spam —,
 *      baixa a planilha pelo link "Baixar agora" e importa no cadastro (junta com o que já existe).
 * O resultado fica em dados/<loja>/fixe/ultimo.json; os e-mails já usados, em vistos.json.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const REMETENTE = 'fixe@fixecrm.com.br';
const ESPERA_MAX = 3 * 3600e3; // depois de 3 h sem e-mail, desiste e avisa
const pasta = (id) => path.join(C.pastaLoja(id), 'fixe');
const arq = (id, n) => path.join(pasta(id), n);
const lerJson = (f, padrao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; } };
const gravar = (id, n, obj) => { fs.mkdirSync(pasta(id), { recursive: true }); C.gravarAtomico(arq(id, n), JSON.stringify(obj), 0o640); };

/** IMAP a partir do SMTP da loja (Gmail: imap.gmail.com) */
function imapDe(smtp) {
  if (!smtp || !smtp.user || !smtp.pass) return null;
  const host = /gmail\.com$/i.test(smtp.host || '') || /@gmail\.com$/i.test(smtp.user) ? 'imap.gmail.com' : String(smtp.host || '').replace(/^smtp\./i, 'imap.');
  return host ? { host, port: 993, secure: true, auth: { user: smtp.user, pass: smtp.pass }, logger: false } : null;
}

function situacao(id) {
  return { pedido: lerJson(arq(id, 'pedido.json'), null), ultimo: lerJson(arq(id, 'ultimo.json'), null) };
}

/** todos os endereços a quem o e-mail foi mandado (Para, Cc e os cabeçalhos de entrega do Gmail) */
function destinatarios(p) {
  const out = [];
  for (const k of ['to', 'cc']) for (const g of [].concat(p[k] || [])) for (const v of g.value || []) if (v.address) out.push(v.address.toLowerCase());
  for (const k of ['delivered-to', 'x-original-to']) for (const v of [].concat(p.headers && p.headers.get(k) || [])) {
    const t = typeof v === 'string' ? v : (v && (v.text || (v.value || []).map((x) => x.address).join(' '))) || '';
    for (const m of t.matchAll(/[^\s<>,;"]+@[^\s<>,;"]+/g)) out.push(m[0].toLowerCase());
  }
  return out;
}

/** endereço que o robô usa no FIXE para a loja (igual ao do coletor): Gmail ganha o apelido +loja */
function comApelido(email, lojaId) {
  const e = String(email || '').trim().toLowerCase(), tag = String(lojaId || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
  const [u, d] = e.split('@');
  if (!tag || !d || u.includes('+') || !['gmail.com', 'googlemail.com'].includes(d)) return e;
  return `${u}+${tag}@${d}`;
}

/** link "Baixar agora" do e-mail */
function linkDoEmail(html) {
  const as = [...String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const txt = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const a = as.find((m) => /baixar/.test(txt(m[2]))) || as.find((m) => /download|export|\.xlsx|\.csv/i.test(m[1]));
  return a ? a[1].replace(/&amp;/g, '&') : null;
}

const dns = require('dns').promises;
const net = require('net');

function ipPrivado(ip) {
  if (!ip) return true;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const s = ip.toLowerCase();
  return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80:');
}

async function validarUrlExterna(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error('link inválido no e-mail do FIXE'); }
  if (u.protocol !== 'https:') throw new Error('o link do e-mail não é https');
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) throw new Error('endereço do link bloqueado');
  if (net.isIP(h)) {
    if (ipPrivado(h)) throw new Error('endereço privado bloqueado');
    return u.toString();
  }
  const addrs = await dns.lookup(h, { all: true });
  if (!addrs.length || addrs.some((a) => ipPrivado(a.address))) throw new Error('endereço interno bloqueado');
  return u.toString();
}

async function baixar(url) {
  let atual = url;
  for (let hop = 0; hop < 5; hop++) {
    const seguro = await validarUrlExterna(atual);
    const r = await fetch(seguro, { redirect: 'manual', signal: AbortSignal.timeout(120e3) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      atual = new URL(r.headers.get('location'), seguro).toString();
      continue;
    }
    if (!r.ok) throw new Error(`o link do FIXE respondeu ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 40 * 1024 * 1024) throw new Error('arquivo grande demais');
    return buf;
  }
  throw new Error('redirecionamentos demais no link do FIXE');
}

function remetenteAutenticado(p, ehSpam) {
  const de = ((p.from && p.from.value) || []).map((x) => String(x.address || '').toLowerCase());
  if (!de.includes(REMETENTE)) return false;
  const ar = [].concat((p.headers && p.headers.get('authentication-results')) || []).map((x) => (typeof x === 'string' ? x : x && x.text) || '').join(' ');
  if (!ar) return !ehSpam;
  if (/\bdkim=pass\b/i.test(ar) || /\bspf=pass\b/i.test(ar)) return true;
  if (ehSpam || (/\bdkim=(fail|none)\b/i.test(ar) && /\bspf=(fail|softfail|none)\b/i.test(ar))) return false;
  return true;
}

/**
 * Procura os e-mails do FIXE (Base de leads e Logs) e importa cada um. Devolve null enquanto falta algum.
 * importar(buf) → { tipo: 'leads' | 'logs', ... } (quem chama decide pelo conteúdo da planilha)
 * smtp = { host, user, pass } da loja
 */
async function verificar(id, smtp, importar) {
  const { pedido } = situacao(id);
  if (!pedido) return null;
  const esperados = Array.isArray(pedido.tipos) && pedido.tipos.length ? pedido.tipos : ['leads'];
  const feitos = pedido.feitos || {};
  const desde = new Date(Date.parse(pedido.em) - 10 * 60e3);
  const fim = (r) => { gravar(id, 'ultimo.json', { em: new Date().toISOString(), pedidoEm: pedido.em, ...r }); try { fs.unlinkSync(arq(id, 'pedido.json')); } catch { /* ok */ } return r; };
  const resumo = () => ({ ok: !!feitos.leads, resultado: feitos.leads ? feitos.leads.resultado : null, recebido: feitos.leads ? feitos.leads.recebido : null, doSpam: !!(feitos.leads && feitos.leads.doSpam), logs: feitos.logs || null });
  if (Date.now() - Date.parse(pedido.em) > ESPERA_MAX) {
    const falta = esperados.filter((t) => !feitos[t]).map((t) => (t === 'logs' ? 'dos Logs' : 'da Base de leads'));
    return fim({ ...resumo(), ok: !!feitos.leads, erro: `O e-mail ${falta.join(' e ')} do FIXE não chegou em 3 horas (procurei na caixa de entrada e no spam).` });
  }
  const apelido = /\+[^@]+@/.test(pedido.email || '') ? String(pedido.email).toLowerCase() : null;
  const cfg = imapDe(smtp);
  if (!cfg) return fim({ ok: false, erro: 'A loja não tem o Gmail configurado (Configurações → Lojas → Fechamento do dia): é por ele que o painel lê o e-mail do FIXE.' });
  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');
  const cli = new ImapFlow(cfg);
  const vistos = new Set(lerJson(arq(id, 'vistos.json'), []));
  try {
    await cli.connect();
    // caixa de entrada e spam (o nome do spam muda com o idioma: usa a marca \Junk do servidor)
    const caixas = await cli.list();
    const spam = caixas.find((c) => c.specialUse === '\\Junk');
    const inbox = caixas.find((c) => c.specialUse === '\\Inbox' || c.path.toUpperCase() === 'INBOX');
    const achados = [];
    for (const cx of [inbox, spam].filter(Boolean)) {
      const lock = await cli.getMailboxLock(cx.path);
      try {
        const uids = (await cli.search({ from: REMETENTE, since: desde }, { uid: true })) || [];
        const daCaixa = [];
        for (const uid of uids.slice(-10)) {
          const msg = await cli.fetchOne(uid, { source: true, envelope: true, internalDate: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const mid = (msg.envelope && msg.envelope.messageId) || `${cx.path}:${uid}`;
          if (vistos.has(mid) || new Date(msg.internalDate) < desde) continue;
          const p = await simpleParser(msg.source);
          if (!/export/i.test(p.subject || '')) continue;
          if (!remetenteAutenticado(p, cx === spam)) continue;
          // pedido para o apelido da loja (usuario+loja@gmail.com): só vale o e-mail endereçado a ele — outra loja pode usar o mesmo Gmail
          if (apelido && !destinatarios(p).includes(apelido)) continue;
          // pedido para o endereço normal: ignora o que foi mandado ao apelido de outra loja (usuario+outra@gmail.com)
          if (!apelido) { const ds = destinatarios(p); if (ds.length && ds.every((x) => /\+[^@]+@/.test(x))) continue; }
          const link = linkDoEmail(p.html || p.textAsHtml || '');
          if (link) daCaixa.push({ uid, spam: cx === spam, mid, link, recebido: msg.internalDate });
        }
        for (const x of daCaixa) {
          await cli.messageFlagsAdd(String(x.uid), ['\\Seen'], { uid: true });
          if (x.spam && inbox) await cli.messageMove(String(x.uid), inbox.path, { uid: true }).catch(() => {}); // tira do spam
        }
        achados.push(...daCaixa);
      } finally { lock.release(); }
    }
    for (const x of achados.sort((a, b) => new Date(a.recebido) - new Date(b.recebido))) {
      vistos.add(x.mid);
      gravar(id, 'vistos.json', [...vistos].slice(-200));
      const buf = await baixar(x.link);
      const r = await importar(buf);
      feitos[r.tipo || 'leads'] = { recebido: new Date(x.recebido).toISOString(), doSpam: x.spam, resultado: r };
    }
    if (esperados.every((t) => feitos[t])) return fim(resumo());
    if (achados.length) gravar(id, 'pedido.json', { ...pedido, feitos }); // chegou um, falta o outro
    return null;
  } catch (e) {
    const m = String(e && (e.responseText || e.message) || e);
    if (/auth|credentials|login/i.test(m)) return fim({ ok: false, erro: 'O Gmail recusou o acesso para ler e-mails. Confira a senha de app em Configurações → Lojas → Fechamento do dia.' });
    if (/planilha|cliente|arquivo|link|respondeu|grande|Logs|movimento/i.test(m)) return fim({ ...resumo(), ok: false, erro: m });
    console.error(`[fixe] ${id}: ${m}`);
    return null; // falha de rede: tenta de novo
  } finally {
    try { await cli.logout(); } catch { /* ok */ }
  }
}

module.exports = { verificar, situacao, linkDoEmail, destinatarios, comApelido };
