'use strict';
/**
 * Erros de tela da loja: o navegador de quem usa o painel avisa quando um erro de JavaScript acontece
 * (public/js/errostela.js) e o servidor guarda em dados/erros-tela.jsonl, para o admin ver em Configurações →
 * Erros nas telas e no aviso do Início. Antes, um erro na loja só chegava quando o dono mandava print.
 *
 * Sem dado pessoal: só a mensagem do erro (curta e saneada: sem e-mail, CPF, telefone, número longo nem texto entre
 * aspas — que pode ser o que a pessoa digitou), a tela, o arquivo:linha do painel, o navegador, o perfil e a loja.
 * Nunca o usuário, o texto de conversa nem valor digitado. O saneamento roda aqui de novo (não confia na tela).
 *
 * Quem vê: admin, tudo; franqueado, só os erros das lojas dele (é o admin das lojas dele e é quem conta ao dono que
 * algo quebrou na loja; erro sem loja — ex.: tela de login — fica só para o admin). Gerente e vendedora só enviam.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const C = require('./config');

const ARQ = () => path.join(C.DATA_DIR, 'erros-tela.jsonl');
const DIAS = 30; // guarda 30 dias
const MAX_BYTES = 2 * 1024 * 1024; // e no máximo 2 MB
const POR_MINUTO = 10; // por pessoa
const REPETIDO_MIN = 10; // o mesmo erro da mesma pessoa só é gravado de novo depois de 10 min (os repetidos viram contagem)

/** mensagem de erro sem dado pessoal: tira e-mail, CPF/CNPJ, telefone, número longo, endereço com parâmetros e texto entre aspas longo */
function sanear(t, max = 200) {
  let s = String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]+/g, ' ');
  s = s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail]')
    .replace(/https?:\/\/[^\s'"]+/g, (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return '[endereço]'; } })
    .replace(/(["'`“”])([^"'`“”]{25,})\1/g, '$1…$1') // texto entre aspas longo: pode ser o que a pessoa digitou
    .replace(/\d[\d.\-/() ]{6,}\d/g, '[número]') // CPF, CNPJ, telefone, cartão, chave de nota
    .replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
/** "/js/pages.js?v=abc" → "pages.js"; só arquivo do painel (extensão do navegador e outros sites ficam de fora) */
function arquivo(a) {
  // só endereço do próprio painel (a tela manda sem o domínio): /app.js, /js/<arquivo>.js, /login.js, /trocar-senha.js
  const m = String(a || '').match(/^\/(?:js\/)?([a-z0-9_-]{1,40}\.js)(?:[?#].*)?$/i);
  return m ? m[1].toLowerCase() : '';
}
const tela = (t) => String(t || '').replace(/^#/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
const inteiro = (n) => (Number.isInteger(+n) && +n >= 0 && +n < 1e7 ? +n : null);
/** navegador pelo User-Agent: só a família, a versão principal e se é celular */
function navegador(ua) {
  const u = String(ua || '');
  const m = u.match(/(Edg|OPR|SamsungBrowser|Firefox|Chrome|CriOS|Version)\/(\d+)/);
  let nome = m ? ({ Edg: 'Edge', OPR: 'Opera', SamsungBrowser: 'Samsung', Firefox: 'Firefox', Chrome: 'Chrome', CriOS: 'Chrome', Version: 'Safari' })[m[1]] + ' ' + m[2] : 'outro';
  if (/iPhone|iPad/.test(u) && !/CriOS/.test(u)) nome = 'Safari ' + ((u.match(/Version\/(\d+)/) || [])[1] || '');
  return (nome.trim() + (/Mobi|Android|iPhone|iPad/.test(u) ? ' · celular' : ' · computador')).slice(0, 40);
}
const assinatura = (r) => crypto.createHash('sha1').update([r.msg, r.arq, r.ln, r.tela].join('|')).digest('hex').slice(0, 12);

/** monta o registro a partir do que o navegador mandou (só os campos conhecidos, saneados) */
function registro(body, { perfil, lojas, ua, agora = Date.now(), mapear = null }) {
  const b = body && typeof body === 'object' ? body : {};
  const msg = sanear(b.msg);
  if (!msg || /^script error\.?$/i.test(msg) || /ResizeObserver loop/i.test(msg)) return null; // sem informação ou aviso inofensivo do navegador
  const arq = arquivo(b.arq);
  if (b.arq && !arq) return null; // erro de extensão do navegador ou de outro site: não é do painel
  const loja = (lojas || []).some((l) => l.id === b.loja) ? String(b.loja) : null; // só loja que a pessoa tem
  const r = { em: new Date(agora).toISOString(), tipo: b.tipo === 'promessa' ? 'promessa' : 'erro', msg, tela: tela(b.tela), arq, ln: inteiro(b.ln), col: inteiro(b.col), nav: navegador(ua), perfil: String(perfil || ''), loja };
  // a tela roda o pacote único (app.js): a linha do pacote vira arquivo:linha do código (public/js/<arquivo>)
  if (r.arq === 'app.js' && r.ln && mapear) { const m = mapear(r.ln); if (m) { r.arq = m.arq; r.ln = m.ln; } }
  r.ass = assinatura(r);
  return r;
}

const ritmo = new Map(); // pessoa -> { min, n }
const vistos = new Map(); // pessoa|assinatura -> quando gravou
function podeGravar(quem, ass, agora = Date.now()) {
  const min = Math.floor(agora / 60000);
  const r = ritmo.get(quem);
  if (!r || r.min !== min) ritmo.set(quem, { min, n: 1 });
  else if (++r.n > POR_MINUTO) return false;
  const k = quem + '|' + ass;
  if (agora - (vistos.get(k) || 0) < REPETIDO_MIN * 60000) return false;
  vistos.set(k, agora);
  if (vistos.size > 5000) for (const [kk, t] of vistos) if (agora - t > REPETIDO_MIN * 60000) vistos.delete(kk);
  if (ritmo.size > 2000) ritmo.clear();
  return true;
}

function ler() {
  let txt = '';
  try { txt = fs.readFileSync(ARQ(), 'utf8'); } catch { return []; }
  const out = [];
  for (const l of txt.split('\n')) { if (!l) continue; try { out.push(JSON.parse(l)); } catch { /* linha quebrada */ } }
  return out;
}
/** grava e limpa: mais de 30 dias ou acima de 2 MB, refaz o arquivo só com o que vale (os mais novos) */
function gravar(r, agora = Date.now()) {
  fs.mkdirSync(C.DATA_DIR, { recursive: true });
  fs.appendFileSync(ARQ(), JSON.stringify(r) + '\n', { mode: 0o640 });
  let tam = 0;
  try { tam = fs.statSync(ARQ()).size; } catch { return; }
  const limite = new Date(agora - DIAS * 864e5).toISOString();
  const todos = ler();
  if (tam <= MAX_BYTES && !(todos[0] && todos[0].em < limite)) return;
  let ficam = todos.filter((x) => x.em >= limite);
  while (ficam.length && Buffer.byteLength(ficam.map((x) => JSON.stringify(x)).join('\n')) > MAX_BYTES / 2) ficam = ficam.slice(Math.ceil(ficam.length / 4));
  C.gravarAtomico(ARQ(), ficam.map((x) => JSON.stringify(x) + '\n').join(''), 0o640);
}

/** resumo dos últimos N dias, um item por erro (assinatura): quantas vezes, telas, perfis, lojas, navegadores, primeira e última vez */
function resumo(regs, { dias = 7, lojas = null, agora = Date.now() } = {}) {
  const desde = new Date(agora - dias * 864e5).toISOString();
  const primeira = new Map(); // primeira vez de cada erro em todo o arquivo (para saber se é novo)
  for (const r of regs) if (!primeira.has(r.ass) || r.em < primeira.get(r.ass)) primeira.set(r.ass, r.em);
  const m = new Map();
  for (const r of regs) {
    if (r.em < desde) continue;
    if (lojas && !(r.loja && lojas.has(r.loja))) continue;
    let g = m.get(r.ass);
    if (!g) m.set(r.ass, (g = { ass: r.ass, msg: r.msg, arq: r.arq, ln: r.ln, tipo: r.tipo, vezes: 0, telas: new Set(), perfis: new Set(), lojas: new Set(), navs: new Set(), primeira: primeira.get(r.ass), ultima: r.em }));
    g.vezes++;
    if (r.tela) g.telas.add(r.tela);
    if (r.perfil) g.perfis.add(r.perfil);
    if (r.loja) g.lojas.add(r.loja);
    if (r.nav) g.navs.add(r.nav);
    if (r.em > g.ultima) g.ultima = r.em;
  }
  const arr = (s) => [...s].sort();
  return [...m.values()].map((g) => ({ ...g, telas: arr(g.telas), perfis: arr(g.perfis), lojas: arr(g.lojas), navs: arr(g.navs) }))
    .sort((a, b) => (a.ultima < b.ultima ? 1 : -1));
}
/** erro "novo": apareceu pela primeira vez nos últimos 2 dias */
const novos = (itens, agora = Date.now()) => itens.filter((g) => g.primeira >= new Date(agora - 2 * 864e5).toISOString());

const lojasVisiveis = (req) => (req.perfil === 'admin' ? null : new Set((req.lojas || []).map((l) => l.id)));

function registrar(app, { mapear = null } = {}) {
  const r = express.Router();
  const json = express.json({ limit: '4kb' });
  r.post('/', json, (req, res) => {
    if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
    try {
      const reg = registro(req.body, { perfil: req.perfil, lojas: req.lojas, ua: req.get('User-Agent'), mapear });
      if (!reg) return res.json({ ok: true, ignorado: true });
      if (!podeGravar(req.user || '?', reg.ass)) return res.json({ ok: true, repetido: true });
      gravar(reg);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
  });
  r.get('/', (req, res) => {
    if (req.perfil !== 'admin' && req.perfil !== 'franqueado') return res.status(403).json({ erro: 'Só o administrador ou o franqueado vê os erros das telas.' });
    try {
      const dias = Math.min(30, Math.max(1, +req.query.dias || 7));
      const itens = resumo(ler(), { dias, lojas: lojasVisiveis(req) });
      res.set('Cache-Control', 'no-store');
      res.json({ dias, itens, novos: novos(itens).length });
    } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
  });
  app.use('/api/erros-tela', r);
}

/** apresentação: aceita o aviso sem gravar nada e mostra uma lista de exemplo */
function demo(app) {
  app.post('/api/demo/erros-tela', (req, res) => res.json({ ok: true, demo: true }));
  app.get('/api/demo/erros-tela', (req, res) => {
    const agora = Date.now(), h = (x) => new Date(agora - x * 3600e3).toISOString();
    const itens = [
      { ass: 'demo00000001', msg: "Cannot read properties of undefined (reading 'qtd')", arq: 'pedido.js', ln: 812, tipo: 'erro', vezes: 3, telas: ['pedido'], perfis: ['gerente'], lojas: ['demo-centro'], navs: ['Chrome 131 · celular'], primeira: h(20), ultima: h(2) },
      { ass: 'demo00000002', msg: 'Falha ao carregar o gráfico', arq: 'pages.js', ln: 377, tipo: 'promessa', vezes: 1, telas: ['comparativos'], perfis: ['franqueado'], lojas: ['demo-parque'], navs: ['Safari 17 · celular'], primeira: h(120), ultima: h(120) },
    ];
    res.json({ dias: 7, itens, novos: 1, demo: true });
  });
}

module.exports = { registrar, demo, sanear, arquivo, navegador, registro, podeGravar, resumo, novos, gravar, ler, ARQ, POR_MINUTO, MAX_BYTES, DIAS };
