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

/** link "Baixar agora" do e-mail */
function linkDoEmail(html) {
  const as = [...String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const txt = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const a = as.find((m) => /baixar/.test(txt(m[2]))) || as.find((m) => /download|export|\.xlsx|\.csv/i.test(m[1]));
  return a ? a[1].replace(/&amp;/g, '&') : null;
}

async function baixar(url) {
  if (!/^https:\/\//i.test(url)) throw new Error('o link do e-mail não é https');
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120e3) });
  if (!r.ok) throw new Error(`o link do FIXE respondeu ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 40 * 1024 * 1024) throw new Error('arquivo grande demais');
  return buf;
}

/**
 * Procura o e-mail do FIXE e importa. Devolve null se ainda não chegou.
 * importar(buf) → resultado do CAD.importar; smtp = { host, user, pass } da loja
 */
async function verificar(id, smtp, importar) {
  const { pedido } = situacao(id);
  if (!pedido) return null;
  const desde = new Date(Date.parse(pedido.em) - 10 * 60e3);
  const fim = (r) => { gravar(id, 'ultimo.json', { em: new Date().toISOString(), pedidoEm: pedido.em, ...r }); try { fs.unlinkSync(arq(id, 'pedido.json')); } catch { /* ok */ } return r; };
  if (Date.now() - Date.parse(pedido.em) > ESPERA_MAX) return fim({ ok: false, erro: 'O e-mail do FIXE não chegou em 3 horas (procurei na caixa de entrada e no spam).' });
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
    let achado = null;
    for (const cx of [inbox, spam].filter(Boolean)) {
      const lock = await cli.getMailboxLock(cx.path);
      try {
        const uids = (await cli.search({ from: REMETENTE, since: desde }, { uid: true })) || [];
        for (const uid of uids.slice(-10).reverse()) {
          const msg = await cli.fetchOne(uid, { source: true, envelope: true, internalDate: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const mid = (msg.envelope && msg.envelope.messageId) || `${cx.path}:${uid}`;
          if (vistos.has(mid) || new Date(msg.internalDate) < desde) continue;
          const p = await simpleParser(msg.source);
          if (!/export/i.test(p.subject || '')) continue;
          const link = linkDoEmail(p.html || p.textAsHtml || '');
          if (!link) continue;
          achado = { uid, caixa: cx.path, spam: cx === spam, mid, link, recebido: msg.internalDate };
          break;
        }
        if (achado) {
          await cli.messageFlagsAdd(String(achado.uid), ['\\Seen'], { uid: true });
          if (achado.spam && inbox) await cli.messageMove(String(achado.uid), inbox.path, { uid: true }).catch(() => {}); // tira do spam
        }
      } finally { lock.release(); }
      if (achado) break;
    }
    if (!achado) return null; // ainda não chegou: tenta de novo daqui a pouco
    vistos.add(achado.mid);
    gravar(id, 'vistos.json', [...vistos].slice(-200));
    const buf = await baixar(achado.link);
    const r = await importar(buf);
    return fim({ ok: true, recebido: new Date(achado.recebido).toISOString(), doSpam: achado.spam, resultado: r });
  } catch (e) {
    const m = String(e && (e.responseText || e.message) || e);
    if (/auth|credentials|login/i.test(m)) return fim({ ok: false, erro: 'O Gmail recusou o acesso para ler e-mails. Confira a senha de app em Configurações → Lojas → Fechamento do dia.' });
    if (/planilha|cliente|arquivo|link|respondeu|grande/i.test(m)) return fim({ ok: false, erro: m });
    console.error(`[fixe] ${id}: ${m}`);
    return null; // falha de rede: tenta de novo
  } finally {
    try { await cli.logout(); } catch { /* ok */ }
  }
}

module.exports = { verificar, situacao, linkDoEmail };
