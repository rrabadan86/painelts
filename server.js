'use strict';
// arquivos novos sem leitura para outros usuários da VPS (dados de clientes)
process.umask(0o027);
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const gzipAsync = promisify(zlib.gzip);
const BR = require('./src/brasilapi');
const brotliAsync = promisify(zlib.brotliCompress);
const express = require('express');
const compression = require('compression');
const C = require('./src/config');
const { loadLoja, juntar, pack, assinatura, resolverFontes } = require('./src/sources');
const CLS = require('./src/classificacao');
const GH = require('./src/github');
const COL = require('./src/coletor');
const DEMO = require('./src/demo');
const B = require('./src/base');
const XB = require('./src/xmlbase');
const ADMIN = require('./src/admin-api');
const IND = require('./src/indicadores');
const NOTIF = require('./src/notificacoes');

// ---------- configuração ----------
const PORT = +process.env.PORT || 3000;
const CACHE_MIN = +process.env.CACHE_MINUTES || 10;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_HOURS = +process.env.SESSION_HOURS || 12;
const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true';
const MAX_UPLOAD_MB = +process.env.MAX_UPLOAD_MB || 80;
if (!process.env.SESSION_SECRET) console.warn('⚠️  SESSION_SECRET não definido: as sessões caem a cada reinício.');
if (!SECURE_COOKIE && process.env.NODE_ENV !== 'test') console.warn('⚠️  COOKIE_SECURE não está "true": o cookie da sessão também viaja por http. Em produção (https) defina COOKIE_SECURE=true no .env.');
{
  const cfg = C.get();
  console.log(`[config] ${fs.existsSync(C.CONFIG_FILE) ? C.CONFIG_FILE : 'sem lojas.json — usando o .env (uma loja)'}; dados em ${C.DATA_DIR}`);
  if (!Object.keys(cfg.usuarios).length) console.warn('\n⚠️  Nenhum usuário configurado: o painel fica bloqueado até você criar um (scripts/admin.js usuario).\n');
}

// ---------- sessão (cookie assinado) ----------
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + SESSION_HOURS * 3600e3, k: C.chaveSessao(C.get().usuarios[user]) })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
// cookies de quem clicou em "Sair" (valem até expirar; a lista se limpa sozinha)
// ficam também no disco: depois de um reinício o cookie de quem saiu continua sem valer (só a assinatura e a validade; nada do usuário)
const encerrados = new Map(); // assinatura -> exp
const ARQ_ENCERRADOS = path.join(C.DATA_DIR, 'sessoes-encerradas.json');
try { for (const [s, exp] of JSON.parse(fs.readFileSync(ARQ_ENCERRADOS, 'utf8'))) if (typeof s === 'string' && exp > Date.now()) encerrados.set(s, exp); } catch { /* ainda não tem */ }
function gravarEncerrados() {
  try { fs.mkdirSync(C.DATA_DIR, { recursive: true }); C.gravarAtomico(ARQ_ENCERRADOS, JSON.stringify([...encerrados].filter(([, exp]) => exp > Date.now()).slice(-5000)), 0o600); } catch (e) { console.error('[sessão] não consegui guardar a saída:', e.message); }
}
function readToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [payload, sig] = tok.split('.');
  const good = sign(payload);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  if (encerrados.has(sig)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!(p.exp > Date.now())) return null;
    // senha trocada, sessões encerradas pelo admin ou usuário recriado: o cookie antigo não vale mais
    const u = C.get().usuarios[p.u];
    if (!u || p.k !== C.chaveSessao(u)) return null;
    return { ...p, sig };
  } catch { return null; }
}
const decCookie = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decCookie(v.join('='))]));
const safeEq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
function mesmaOrigemForm(req) {
  const ref = req.get('Origin') || req.get('Referer');
  if (!ref) return true;
  try { return new URL(ref).host === req.get('Host'); } catch { return false; }
}
function lruGet(map, k) {
  if (!map.has(k)) return undefined;
  const v = map.get(k);
  map.delete(k);
  map.set(k, v);
  return v;
}
function lruSet(map, k, v, max) {
  if (map.has(k)) map.delete(k);
  else if (map.size >= max) map.delete(map.keys().next().value);
  map.set(k, v);
}

// tentativas de login erradas: por IP (10 em 15 min) e por IP+usuário (8 em 15 min) bloqueiam.
// Por usuário somando todos os IPs NÃO bloqueia (senão qualquer um travaria a conta de outra pessoa errando a senha de
// propósito): a partir de 10 erros cada tentativa espera cada vez mais (até 5 s) e só 4 ficam na espera ao mesmo tempo.
const attempts = new Map();
const JANELA = 15 * 60e3;
function tooMany(chave, limite = 10, janela = JANELA) {
  const now = Date.now();
  const prev = attempts.get(chave);
  if (!prev) return false;
  const a = prev.filter((t) => now - t < janela);
  if (a.length) attempts.set(chave, a); else attempts.delete(chave);
  return a.length >= limite;
}
function falhou(chave) {
  if (!attempts.has(chave) && attempts.size >= 10000) attempts.delete(attempts.keys().next().value);
  const a = attempts.get(chave) || [];
  a.push(Date.now());
  attempts.set(chave, a);
}
const errosRecentes = (chave) => { tooMany(chave, Infinity); return (attempts.get(chave) || []).length; }; // já sem os antigos
/** espera (ms) antes de conferir a senha de um usuário que está levando muitos erros, venham de onde vierem */
const LOGIN_ESPERA_MAX = +process.env.LOGIN_ESPERA_MAX_MS || 5000;
function atrasoLogin(erros) { return erros < 10 ? 0 : Math.min(LOGIN_ESPERA_MAX, 500 * 2 ** Math.min(4, Math.floor((erros - 10) / 5))); }
const esperandoLogin = new Map(); // usuário -> quantas tentativas estão na espera agora
const MAX_ESPERA_LOGIN = 4;
const ataqueAud = new Map(); // usuário -> último aviso na auditoria
setInterval(() => {
  const now = Date.now();
  for (const [k, t] of ataqueAud) if (now - t > 3600e3) ataqueAud.delete(k);
  for (const [k, a] of attempts) if (!a.length || now - a[a.length - 1] > JANELA) attempts.delete(k);
  let saiu = false;
  for (const [s, exp] of encerrados) if (exp < now) { encerrados.delete(s); saiu = true; }
  if (saiu) gravarEncerrados();
}, 5 * 60e3).unref();

// ---------- cache por loja ----------
const cacheLoja = new Map(); // id -> { sig, at, raw, loading, reload }
async function dadosLoja(loja, force) {
  let e = cacheLoja.get(loja.id);
  const sig = assinatura(loja);
  const temDrive = resolverFontes(loja).some((f) => f.origem === 'drive');
  const fresco = e && e.raw && e.sig === sig && (!temDrive || Date.now() - e.at < CACHE_MIN * 60e3);
  if (fresco && !force) return e;
  if (!e) cacheLoja.set(loja.id, (e = {}));
  if (e.loading) {
    if (force) e.reload = true;
    try { await e.loading; } catch (err) {
      if (!force) {
        if (e.raw) return { ...e, stale: err.message };
        throw err;
      }
    }
    if (!force && e.raw && e.sig === assinatura(loja)) return e;
  }
  if (!e.loading) {
    e.loading = (async () => {
      do {
        e.reload = false;
        const sigAgora = assinatura(loja);
        const raw = await loadLoja(loja);
        raw.lojaNome = loja.nome;
        CLS.aplicar(raw.vendas); // produtos reclassificados pelo painel (contam na meta, comissão e royalties)
        // cupons cancelados: só saem das vendas se a loja escolheu "tirar das vendas" em Vendas → Conferência (padrão: só avisar)
        { const x = require('./src/conferencia').aplicarCancelados(loja, raw.vendas); raw.vendas = x.vendas; raw.canceladosFora = x.fora; }
        Object.assign(e, { sig: sigAgora, at: Date.now(), raw, erro: null });
        console.log(`[dados] ${loja.id}: ${raw.vendas.length} vendas, ${raw.xml.length} cupons c/ CPF, ${raw.clientes.length} clientes em ${raw.ms} ms`);
        if (raw.avisos.length) console.warn(`[dados] ${loja.id} avisos:`, raw.avisos.join(' | '));
      } while (e.reload);
    })().finally(() => { e.loading = null; });
  }
  try { await e.loading; return e; }
  catch (err) {
    if (e.raw) { console.error(`[dados] ${loja.id}: falha, servindo cópia anterior:`, err.message); return { ...e, stale: err.message }; }
    throw err;
  }
}
/** dados de clientes (CPF, telefone): admin, franqueado e gerente com a tela Clientes liberada */
function podeClientes(req) {
  if (req.perfil === 'admin' || req.perfil === 'franqueado') return true;
  if (req.perfil !== 'gerente') return false;
  return (C.telasDo(C.usuario(req.user)) || []).includes('clientes');
}
/** o que cada perfil recebe: gerente e vendedor não recebem dados de clientes; vendedor não vê o nome nem dados dos colegas */
function filtrarPorPerfil(data, perfilDados) {
  if (perfilDados === 'completo') return data;
  const out = { ...data, xml: [], clientes: [], fidelidade: [] };
  if (perfilDados.startsWith('vendedor:')) {
    const eu = perfilDados.slice(9).trim().toUpperCase();
    const chaveOrd = (n) => crypto.createHmac('sha256', SECRET).update('vend:' + String(n).trim().toUpperCase()).digest('hex');
    const nomesVendas = [...new Set(data.vendas.map((v) => v.vendedor))].filter((n) => n && n.trim().toUpperCase() !== eu);
    const nomesExtras = (data.metaCfgs || []).flatMap((m) => [
      ...((m.ferias || []).map((f) => f && f.vendedor)),
      // listas do modelo da loja + regras gravadas (loja sem regras usa o modelo, que também tem nomes)
      ...Object.values(require('./src/regrasvend').listasEfetivas(m)).flat(),
    ]).filter((n) => n && String(n).trim().toUpperCase() !== eu && !/^SEM VENDEDOR$/i.test(String(n).trim()));
    const todosOutros = new Map();
    for (const n of [...nomesVendas, ...nomesExtras]) {
      const k = String(n).trim().toUpperCase();
      if (k && k !== eu && !todosOutros.has(k)) todosOutros.set(k, n);
    }
    const ordenados = [...todosOutros.keys()].filter((k) => k !== 'SEM VENDEDOR').sort((a, b) => chaveOrd(a).localeCompare(chaveOrd(b)));
    const apelidoUpper = new Map(ordenados.map((k, i) => [k, `COLEGA ${i + 1}`]));
    apelidoUpper.set('SEM VENDEDOR', 'SEM VENDEDOR');
    const mapearNome = (n) => {
      if (!n) return n;
      const k = String(n).trim().toUpperCase();
      if (k === eu) return n;
      return apelidoUpper.get(k) || 'COLEGA';
    };
    out.vendas = data.vendas.map((v) => {
      const k = v.vendedor ? String(v.vendedor).trim().toUpperCase() : '';
      return k && k !== eu && apelidoUpper.has(k) ? { ...v, vendedor: apelidoUpper.get(k) } : v;
    });
    if (Array.isArray(data.metaCfgs)) {
      out.metaCfgs = data.metaCfgs.map((m) => ({
        ...m,
        contabilidade: [],
        escalaAjustes: {},
        feriadosHoras: Object.fromEntries(Object.entries(m.feriadosHoras || {}).map(([ym, dias]) => [
          ym,
          Object.fromEntries(Object.entries(dias || {}).map(([dt, pp]) => [
            dt,
            Object.fromEntries(Object.entries(pp || {}).filter(([nm]) => String(nm).trim().toUpperCase() === eu)),
          ])),
        ])),
        operacao: m.operacao ? {
          ...m.operacao,
          equipe: m.operacao.equipe ? { ...m.operacao.equipe, nomes: undefined, pessoas: undefined } : m.operacao.equipe,
        } : null,
        ferias: (m.ferias || []).map((f) => ({ ...f, vendedor: mapearNome(f.vendedor) })),
        regras: require('./src/regrasvend').regrasAnonimas(m, mapearNome),
      }));
    }
  }
  return out;
}
const packCache = new Map(); // chave -> { k, gz, br, etag } (sem a cópia sem compressão: quase nenhum navegador pede; sai do gzip quando precisa)
async function pacote(lojas, force, perfilDados = 'completo', desde = null) {
  const entradas = await Promise.all(lojas.map((l) => dadosLoja(l, force)));
  // metas vêm sempre da configuração atual (mudam pelo painel sem recarregar as planilhas)
  const cfgLojas = C.get().lojas;
  const metaCfgs = lojas.map((l, i) => {
    const atual = cfgLojas.find((x) => x.id === l.id) || l;
    const r = entradas[i].raw;
    return { id: l.id, nome: atual.nome, nomesVenda: r.metaCfg?.nomesVenda || [], padrao: atual.meta ?? r.metaPlanilha ?? null, meses: atual.metas || {}, metaAuto: atual.metaAuto || null, regras: atual.regras || null, operacao: atual.operacao || null, ferias: atual.ferias || [], feriadosLocais: atual.feriadosLocais || [], feriadosHoras: atual.feriadosHoras || {}, feriadosHorario: atual.feriadosHorario || {}, escalaAjustes: atual.escalaAjustes || {}, wpp: atual.wppModelos || null, wppApres: atual.wppApresentacao || null, wppIntervalo: atual.wppIntervalo || 21, contabilidade: atual.contabilidade || [] };
  });
  // celular trocado pelo painel (vínculo da conversa do WhatsApp, src/celulares.js): entra na chave para o pacote mudar junto
  const CEL = require('./src/celulares');
  const k = entradas.map((e, i) => `${lojas[i].id}@${e.at}:${e.sig}:${CEL.sig(lojas[i].id)}`).join('|') + '#' + JSON.stringify(metaCfgs) + '#' + perfilDados + '#' + (desde || '');
  const chave = lojas.map((l) => l.id).join(',') + '|' + perfilDados + '|' + (desde || '');
  const pc = lruGet(packCache, chave);
  const stale = entradas.map((e) => e.stale).filter(Boolean).join(' | ') || null;
  const at = Math.min(...entradas.map((e) => e.at));
  if (pc && pc.k === k) return { buf: pc.buf || null, gz: pc.gz, br: pc.br, etag: pc.etag, at, stale };
  let data = lojas.length === 1 ? { ...entradas[0].raw } : juntar(entradas.map((e) => e.raw));
  // o número vinculado pelo painel substitui o do FIXE: tela, robô (zapauto) e Lista de espera leem daqui
  data.clientes = CEL.aplicar(data.clientes, Object.assign({}, ...lojas.map((l) => CEL.ler(l.id))));
  data.metaCfgs = metaCfgs;
  data.meta = metaCfgs.some((m) => m.padrao != null) ? metaCfgs.reduce((s, m) => s + (m.padrao || 0), 0) : null;
  data = filtrarPorPerfil(data, perfilDados);
  // histórico parcial (mais leve): só as vendas a partir de "desde"; o painel pede o resto quando precisa
  let inicio = null;
  for (const v of data.vendas) if (v.data && (!inicio || v.data < inicio)) inicio = v.data;
  if (desde) {
    data = { ...data, vendas: data.vendas.filter((v) => v.data >= desde), xml: (data.xml || []).filter((x) => !x.data || x.data >= desde) };
  }
  const buf = Buffer.from(JSON.stringify(pack(data, { lojas: lojas.map((l) => ({ id: l.id, nome: l.nome })), perfil: perfilDados.split(':')[0], desde: desde && inicio && inicio < desde ? desde : null, inicio })));
  // brotli (qualidade 5) sai ~15% menor que o gzip e é tão rápido quanto; o gzip fica para navegador sem brotli
  const [gz, br] = buf.length >= 1024
    ? await Promise.all([gzipAsync(buf, { level: 6 }), brotliAsync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } })])
    : [null, null];
  const etag = '"' + crypto.createHash('sha1').update(buf).digest('base64').slice(0, 27) + '"';
  lruSet(packCache, chave, { k, buf: gz ? null : buf, gz, br, etag }, 120);
  return { buf, gz, br, etag, at, stale };
}

// fotos de produto vêm direto do site da Tea Shop: só imagens (img-src) e só destes servidores (src/site.js)
const { HOSTS_FOTO } = require('./src/site');

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(compression());
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': `default-src 'self'; img-src 'self' data: blob: ${HOSTS_FOTO.map((x) => 'https://' + x).join(' ')}; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`,
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // HTTPS sempre (só quando o painel roda atrás do HTTPS, COOKIE_SECURE=true)
    ...(SECURE_COOKIE ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  });
  next();
});

const pub = path.join(__dirname, 'public');

// ---------- pacote único de JS/CSS da tela (pré-comprimido em Brotli + Gzip, cache imutável por hash) ----------
const APP_SCRIPTS = [
  'core.js', 'errostela.js', 'contas.js', 'metadia.js', 'components.js', 'dicas.js', 'rules.js', 'pages.js', 'fidelidade.js',
  'msgwpp.js', 'recompra.js', 'clientes.js', 'campretorno.js', 'campanhas.js', 'conversas.js', 'zap.js', 'espera.js', 'extras.js', 'contabilidade.js',
  'ruptura.js', 'visaodono.js', 'classeprod.js', 'grupoprod.js', 'fotoprod.js', 'custodata.js', 'estoque.js', 'devolucao.js', 'precos.js', 'inventario.js', 'sugestoes.js', 'validade.js', 'nfsaida.js', 'creditos.js', 'orcamento.js', 'checklist.js',
  'sitedia.js', 'site.js', 'conferencia.js', 'conferencia-tela.js', 'inicio.js', 'pedido.js', 'ia.js', 'dre.js', 'apagar.js', 'comprasvendas.js', 'efeitopreco.js', 'equipe.js', 'mapa.js', 'feriados.js', 'fidretorno.js',
  'guia.js', 'notificacoes.js', 'config.js', 'script.js', 'fechamento.js', 'sistema.js', 'main.js',
];
let bundleMem = null, bundleCheckEm = 0;
function comprimirAsset(buf) {
  return {
    raw: buf,
    gz: zlib.gzipSync(buf, { level: 6 }),
    br: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }),
  };
}
function obterBundle() {
  const agora = Date.now();
  if (bundleMem && agora - bundleCheckEm < 1500) return bundleMem;
  bundleCheckEm = agora;
  const arqs = [path.join(pub, 'index.html'), path.join(pub, 'styles.css'), ...APP_SCRIPTS.map((f) => path.join(pub, 'js', f))];
  const mtimes = arqs.map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }).join(',');
  if (bundleMem && bundleMem.mtimes === mtimes) return bundleMem;
  const cssBuf = fs.readFileSync(path.join(pub, 'styles.css'));
  const jsPartes = ['"use strict";'];
  const mapa = []; // em que linha do pacote começa cada arquivo (erros de tela: linha do pacote → arquivo:linha)
  let linha = 2;
  for (const f of APP_SCRIPTS) {
    const txt = fs.readFileSync(path.join(pub, 'js', f), 'utf8');
    mapa.push([f, linha + 1]);
    jsPartes.push(`/* === ${f} === */\n;` + txt + '\n;');
    linha += 2 + txt.split('\n').length; // cabeçalho, o arquivo e o ';' do fim
  }
  const jsBuf = Buffer.from(jsPartes.join('\n'), 'utf8');
  const htmlCru = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  const v = crypto.createHash('sha256').update(cssBuf).update(jsBuf).update(htmlCru).digest('hex').slice(0, 12);
  const html = htmlCru
    .replace(/\/styles\.css(\?v=[^"']*)?/g, `/styles.css?v=${v}`)
    .replace(/\/app\.js(\?v=[^"']*)?/g, `/app.js?v=${v}`);
  bundleMem = { mtimes, v, mapa, html: comprimirAsset(Buffer.from(html, 'utf8')), css: comprimirAsset(cssBuf), js: comprimirAsset(jsBuf) };
  return bundleMem;
}
function responderAsset(req, res, asset, contentType, imutavel, etag) {
  if (etag) {
    res.set('ETag', etag);
    if (req.get('If-None-Match') === etag) return res.status(304).end();
  }
  res.set({
    'Content-Type': contentType,
    'Cache-Control': imutavel ? 'public, max-age=31536000, immutable' : 'no-cache',
    Vary: 'Accept-Encoding',
  });
  const ae = String(req.headers['accept-encoding'] || '');
  if (/\bbr\b/.test(ae) && asset.br) { res.set('Content-Encoding', 'br'); return res.end(asset.br); }
  if (/\bgzip\b/.test(ae) && asset.gz) { res.set('Content-Encoding', 'gzip'); return res.end(asset.gz); }
  return res.end(asset.raw);
}
obterBundle(); // aquece na subida

// sem login: só diz que está de pé (nada de ids de loja nem horários)
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/login', (req, res) => res.sendFile(path.join(pub, 'login.html')));
['login.css', 'login.js', 'favicon.svg', 'trocar-senha.js'].forEach((f) => app.get('/' + f, (req, res) => res.sendFile(path.join(pub, f))));
// aplicativo instalável e notificações: o navegador busca o manifesto, o service worker e os ícones sem login
app.get('/manifest.webmanifest', (req, res) => res.sendFile(path.join(pub, 'manifest.webmanifest'), { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } }));
app.get('/sw.js', (req, res) => res.sendFile(path.join(pub, 'sw.js'), { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' } }));
['icone-192.png', 'icone-512.png', 'icone-mascara-512.png', 'apple-touch-icon.png', 'selo-96.png'].forEach((f) => app.get('/icones/' + f, (req, res) => res.sendFile(path.join(pub, 'icones', f), { maxAge: '7d' })));
// ---------- site público do painel (/site e /site/tecnico): páginas fixas, sem login, sem JavaScript e sem dado nenhum da instalação ----------
// SITE_CONTATO (opcional, no .env): link do botão "Falar com a gente" — só https:// ou mailto: (o contato não fica no código)
const SITE_DIR = path.join(pub, 'site');
const siteContato = () => { const c = String(process.env.SITE_CONTATO || '').trim(); return /^(https:\/\/|mailto:)[^\s"'<>]{3,300}$/.test(c) ? c : ''; };
const sitePagina = (arq) => (req, res) => {
  let html;
  try { html = fs.readFileSync(path.join(SITE_DIR, arq), 'utf8'); } catch { return res.status(404).type('text/plain; charset=utf-8').send('Página não encontrada.'); }
  const c = siteContato();
  html = html.replace(/<!--CONTATO-->/g, c ? `<a class="bt claro" href="${c.replace(/&/g, '&amp;')}" rel="noopener">Falar com a gente</a>` : '');
  res.set({ 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex' }).type('html').send(html);
};
app.get(['/site', '/site/'], sitePagina('index.html'));
app.get('/site/tecnico', sitePagina('tecnico.html'));
app.get('/site/site.css', (req, res) => res.sendFile(path.join(SITE_DIR, 'site.css'), { maxAge: '5m' }));
['cel-inicio.jpg', 'cel-hoje.jpg', 'cel-pedido.jpg', 'cel-estoque.jpg', 'cel-conversas.jpg', 'pc-resumo.jpg'].forEach((f) => app.get('/site/img/' + f, (req, res) => res.sendFile(path.join(SITE_DIR, 'img', f), { maxAge: '7d' })));
const CHART_JS = path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.min.js');
app.get('/vendor/chart.umd.js', (req, res) => res.sendFile(CHART_JS, { maxAge: '7d' }));
// PDF no navegador (fechamento do mês que vai anexado ao e-mail da contabilidade)
const H2C_JS = path.join(path.dirname(require.resolve('html2canvas/package.json')), 'dist', 'html2canvas.min.js');
const JSPDF_JS = path.join(path.dirname(require.resolve('jspdf/package.json')), 'dist', 'jspdf.umd.min.js');
app.get('/vendor/html2canvas.js', (req, res) => res.sendFile(H2C_JS, { maxAge: '7d' }));
app.get('/vendor/jspdf.js', (req, res) => res.sendFile(JSPDF_JS, { maxAge: '7d' }));

app.post('/login', express.urlencoded({ extended: false }), async (req, res) => {
  if (!mesmaOrigemForm(req)) return res.status(403).type('text/plain; charset=utf-8').send('Origem inválida.');
  const ip = req.ip;
  const cfg = C.get();
  const user = String(req.body.usuario || '').trim().toLowerCase().slice(0, 80);
  const pass = String(req.body.senha || '').slice(0, 200);
  const chaveU = `u:${ip}:${user}`, chaveUG = `ug:${user}`;
  if (tooMany(ip) || (user && tooMany(chaveU, 8))) return res.redirect('/login?e=limite');
  const u = user && user !== '*' ? cfg.usuarios[user] : null;
  // muitos erros neste usuário (de qualquer lugar): não bloqueia a conta, só atrasa cada tentativa — a senha certa continua entrando
  const espera = user ? atrasoLogin(errosRecentes(chaveUG)) : 0;
  if (espera) {
    if ((esperandoLogin.get(user) || 0) >= MAX_ESPERA_LOGIN) return res.redirect('/login?e=limite');
    if (u && Date.now() - (ataqueAud.get(user) || 0) > 3600e3) { ataqueAud.set(user, Date.now()); C.auditar('sistema', 'muitas senhas erradas para um usuário (o login dele ficou mais lento, sem bloquear)', 'login', { usuario: user, erros: errosRecentes(chaveUG) }); }
    esperandoLogin.set(user, (esperandoLogin.get(user) || 0) + 1);
    try { await new Promise((ok) => setTimeout(ok, espera)); } finally { const n = (esperandoLogin.get(user) || 1) - 1; if (n > 0) esperandoLogin.set(user, n); else esperandoLogin.delete(user); }
  }
  // verifica sempre com scrypt assíncrono em tempo constante (mesmo se o usuário não existir ou estiver inativo)
  const senhaOk = await C.confereSenhaAsync(pass, u && u.ativo ? u.senha : null);
  if (u && u.ativo && senhaOk) {
    if (C.expirado(u)) { attempts.delete(ip); attempts.delete(chaveU); return res.redirect('/login?e=expirou&ate=' + u.acessoAte); }
    if (C.lojasDoUsuario(user).length || u.perfil === 'admin') {
      attempts.delete(ip); attempts.delete(chaveU);
      // senha antiga ainda em texto puro: passa a ser guardada com scrypt
      if (String(u.senha).startsWith('plain$')) {
        const novoHash = await C.hashSenhaAsync(pass);
        C.alterar((c) => { if (c.usuarios[user]) c.usuarios[user].senha = novoHash; });
      }
      C.registrarAcesso(user);
      res.cookie('ts_sess', makeToken(user), { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIE, maxAge: SESSION_HOURS * 3600e3 });
      return res.redirect(u.trocarSenha ? '/trocar-senha?primeiro=1' : '/');
    }
  }
  falhou(ip);
  if (user) { falhou(chaveU); falhou(chaveUG); }
  const lojaQ = String(req.body.loja || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  res.redirect('/login?e=1' + (lojaQ ? '&loja=' + lojaQ : ''));
});
app.post('/logout', (req, res) => {
  if (!mesmaOrigemForm(req)) return res.status(403).type('text/plain; charset=utf-8').send('Origem inválida.');
  const s = readToken(cookies(req).ts_sess);
  if (s) { encerrados.set(s.sig, s.exp); gravarEncerrados(); }
  res.clearCookie('ts_sess', { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIE });
  res.redirect('/login');
});

// ---------- upload do script diário (token verificado ANTES de ler o corpo de até 80 MB) ----------
const tokenRuimAud = new Map();
function autenticarUpload(req, res, next) {
  const cfg = C.get();
  const loja = cfg.lojas.find((l) => l.id === String(req.params.loja).toLowerCase());
  const tokens = [cfg.uploadToken, loja && loja.uploadToken].filter(Boolean);
  const dado = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tokens.length) return res.status(403).json({ erro: 'Upload desativado: defina "uploadToken" no lojas.json ou UPLOAD_TOKEN no .env.' });
  if (!dado || !tokens.some((t) => safeEq(dado, t))) {
    // no máximo um registro a cada 10 min por loja (tentativas repetidas não enchem o histórico)
    if (loja && Date.now() - (tokenRuimAud.get(loja.id) || 0) > 600e3) { tokenRuimAud.set(loja.id, Date.now()); C.auditar('api', 'tentativa de envio com token inválido', loja.id, { loja: loja.id, ip: req.ip }); }
    return res.status(401).json({ erro: 'Token inválido.' });
  }
  req.tokenUpload = loja && loja.uploadToken && safeEq(dado, loja.uploadToken) ? 'loja' : 'geral';
  if (!loja) return res.status(404).json({ erro: `Loja "${req.params.loja}" não existe no lojas.json.` });
  const nome = String(req.params.arquivo).replace(/\.xlsx$/i, '');
  if (!Object.hasOwn(C.ARQUIVOS, nome)) return res.status(400).json({ erro: `Arquivo inválido. Use um destes: ${Object.keys(C.ARQUIVOS).join(', ')}` });
  req.lojaUpload = loja;
  req.nomeUpload = nome;
  next();
}
app.post('/api/upload/:loja/:arquivo', autenticarUpload, express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` }), async (req, res) => {
  const loja = req.lojaUpload, nome = req.nomeUpload;
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 100 || buf[0] !== 0x50 || buf[1] !== 0x4b) return res.status(400).json({ erro: 'O conteúdo enviado não é um .xlsx.' });
  try {
    if (C.ARQUIVOS[nome].tipo === 'vendas') {
      B.receber(loja.id, buf, { origem: 'api-' + nome }); // entra na base mês a mês (período = datas da planilha)
    } else {
      C.gravarAtomico(path.join(C.pastaLoja(loja.id), `${nome}.xlsx`), buf, 0o640); // troca atômica
    }
    console.log(`[upload] ${loja.id}/${nome}.xlsx (${(buf.length / 1024).toFixed(0)} KB)`);
    // fica no histórico de auditoria: qual planilha chegou, para qual loja, por qual token (o geral ou o da loja) e o tamanho
    C.auditar(req.tokenUpload === 'loja' ? `api:${loja.id}` : 'api', 'recebeu planilha pela API', loja.id, { loja: loja.id, arquivo: `${nome}.xlsx`, kb: Math.round(buf.length / 1024), ip: req.ip });
    // já processa em segundo plano para o próximo acesso ser rápido
    dadosLoja(loja, true).catch((e) => console.error(`[upload] ${loja.id}: erro ao processar:`, e.message));
    res.json({ ok: true, loja: loja.id, arquivo: `${nome}.xlsx`, bytes: buf.length });
  } catch (e) {
    console.error('[upload] erro:', e.message);
    res.status(500).json({ erro: C.msgErro(e) });
  }
});

// ---------- apresentação pública (dados FICTÍCIOS, sem login) ----------
// só arquivos estáticos (js/css) e os dados inventados; nada da configuração real é lido aqui
app.get('/app.js', (req, res) => {
  const b = obterBundle();
  responderAsset(req, res, b.js, 'application/javascript; charset=utf-8', req.query.v === b.v, `"js-${b.v}"`);
});
app.get('/styles.css', (req, res) => {
  const b = obterBundle();
  responderAsset(req, res, b.css, 'text/css; charset=utf-8', req.query.v === b.v, `"css-${b.v}"`);
});
app.use('/js', express.static(path.join(pub, 'js'), { index: false, maxAge: 0 }));
app.get(['/apresentacao', '/apresentacao/'], (req, res) => {
  if (!DEMO.disponivel()) return res.status(404).type('text/plain; charset=utf-8').send('Apresentação indisponível.');
  res.set('X-Robots-Tag', 'noindex');
  const b = obterBundle();
  responderAsset(req, res, b.html, 'text/html; charset=utf-8', false, `"html-${b.v}"`);
});
// a apresentação é pública: as rotas que aceitam corpo (POST/PUT/DELETE) têm um limite simples por IP (240 por minuto)
app.use('/api/demo', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const k = 'demo:' + req.ip;
  if (tooMany(k, 240, 60e3)) return res.status(429).json({ erro: 'Muitos pedidos seguidos na apresentação. Espere um minuto.' });
  falhou(k);
  next();
});
// a apresentação entra como administrador (tudo visível, nada é salvo: o navegador barra qualquer alteração)
app.get('/api/demo/eu', (req, res) => res.json({ usuario: 'apresentacao', nome: 'Visitante', demo: true, perfil: 'admin', vendedor: '',
  pode: { configurar: true, admin: true, clientes: true, custos: true }, telas: null, lojas: DEMO.lojasDemo().map((l) => ({ ...l, marca: { nome: l.nome, logo: false } })) }));
// ---------- IA na apresentação: respostas simuladas (nada vai para a Anthropic, nada é salvo) ----------
const IAd = require('./src/ia'), IAPd = require('./src/iaprompts');
app.get('/api/demo/ia/estado', (req, res) => res.json({ ativa: true, demo: true, pode: true, podeConfigurar: true }));
app.get('/api/demo/ia/config', (req, res) => res.json({ demo: true, chave: null, uso: { pedidos: 0, usd: 0 }, preco: { entrada: 3, saida: 15 }, tetoPadrao: IAd.TETO_PADRAO }));
app.put('/api/demo/ia/chave', (req, res) => res.status(400).json({ erro: 'Na apresentação nada é salvo.' }));
app.post('/api/demo/ia/perguntar', express.json({ limit: '300kb' }), (req, res) => {
  const b = req.body || {};
  const e = IAPd.conferirMensagens(b.mensagens);
  if (e) return res.status(400).json({ erro: e });
  const j = IAd.simular({ messages: b.mensagens, tools: IAPd.ferramentas({ clientes: true, custos: true }) });
  res.json({ content: j.content, stop_reason: j.stop_reason, simulada: true });
});
// histórico na apresentação: só na memória do navegador (nada é gravado)
app.get('/api/demo/ia/conversas', (req, res) => res.json({ conversas: [], demo: true }));
app.put('/api/demo/ia/conversas/:id', (req, res) => res.json({ id: req.params.id, demo: true }));
app.delete('/api/demo/ia/conversas/:id', (req, res) => res.json({ ok: true }));
app.post('/api/demo/ia/diagnostico', express.json({ limit: '150kb' }), (req, res) => {
  const j = IAd.simular({ messages: [{ role: 'user', content: 'Dados: ' + JSON.stringify((req.body && req.body.fatos) || {}) }], tool_choice: { type: 'tool', name: 'diagnostico' } });
  res.json({ diagnostico: j.content[0].input, em: new Date().toISOString(), simulada: true });
});
app.post('/api/demo/ia/pedido', express.json({ limit: '200kb' }), (req, res) => {
  const j = IAd.simular({ messages: [{ role: 'user', content: 'Dados: ' + JSON.stringify((req.body && req.body.dados) || {}) }], tool_choice: { type: 'tool', name: 'revisar_pedido' } });
  res.json({ revisao: j.content[0].input, simulada: true });
});
// consulta de CNPJ/CEP na apresentação: dados fictícios (nada sai para a internet)
app.get('/api/demo/brasil/cnpj/:doc', (req, res) => {
  if (!BR.cnpjValido(req.params.doc)) return res.status(400).json({ erro: 'CNPJ inválido: confira os números.' });
  res.json({ empresa: { cnpj: BR.limparCnpj(req.params.doc), razaoSocial: 'EMPÓRIO EXEMPLO COMÉRCIO DE PRESENTES LTDA', nomeFantasia: 'Empório Exemplo', situacao: 'ATIVA', ativa: true,
    cep: '01310100', rua: 'Avenida Paulista', numero: '1000', complemento: 'Loja 2', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP', telefone: '1130000000', email: 'contato@exemplo.com.br' }, demo: true });
});
app.get('/api/demo/brasil/cep/:cep', (req, res) => {
  const c = String(req.params.cep).replace(/\D/g, '');
  if (c.length !== 8) return res.status(400).json({ erro: 'CEP inválido: são 8 números.' });
  res.json({ endereco: { cep: c, rua: 'Rua de Exemplo', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP' }, demo: true });
});
const ESd = require('./src/estoque'), PEDd = require('./src/pedido');
const lojaDemo = (req) => DEMO.lojasDemo().find((l) => l.id === String(req.query.loja || ''));
app.get('/api/demo/estoque', (req, res) => {
  if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try {
    const e = DEMO.estoqueDemo(req.query.loja);
    // tabela de preço fictícia (para o Orçamento): acessórios a ~2,2× o custo; chá a granel em pacote de 100 g
    const its = (e.estoque.itens || []).filter((i) => i.custo > 0);
    const tabela = { itens: [
      ...its.filter((i) => i.un !== 'Kg').map((i) => ({ cod: String(i.cod), desc: i.desc, grupo: 'ACESSÓRIOS', preco: Math.round(i.custo * 2.2 * 10) / 10 })),
      // chá a granel: pacotes de 50 g e 100 g, com subgrupo fictício (o Pedido filtra por ele e mostra a margem bruta do pacote)
      ...its.filter((i) => i.un === 'Kg' && /^\d{4,6}$/.test(String(i.cod))).flatMap((i, k) => { const s = ['CHÁ VERDE', 'CHÁ PRETO', 'ROOIBOS', 'INFUSÕES'][k % 4], g = k % 4 === 3 ? 'INFUSÕES' : k % 2 ? 'CHÁ PURO' : 'CHÁ AROMATIZADO'; return [
        { cod: String(i.cod) + '1', desc: `${i.desc} 50G`, grupo: g, sub: s, preco: Math.round(i.custo * 0.05 * 2.9 * 10) / 10 },
        { cod: String(i.cod) + '2', desc: `${i.desc} 100G`, grupo: g, sub: s, preco: Math.round(i.custo * 0.1 * 2.6 * 10) / 10 }]; }),
    ] };
    // fora de linha fictício: 3 acessórios com saldo indisponíveis no Sistema de Pedidos há ~4 meses e 1 há 20 dias
    const comSaldo = its.filter((i) => i.un !== 'Kg' && i.qtd > 0);
    const dia = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    const foraDeLinha = { desde: dia(200), dias: 90, indisp: Object.fromEntries(comSaldo.slice(2, 6).map((i, k) => [String(i.cod), dia(k < 3 ? 120 + k * 10 : 20)])) };
    // lista de espera fictícia: clientes aguardando dois produtos zerados que venderam há pouco (têm nota de compra recente)
    const espera = Object.fromEntries((e.estoque.itens || []).filter((i) => !(i.qtd > 0) && i.custo > 0 && e.compras.itens[i.cod]).slice(0, 2).map((i, k) => [String(i.cod), k + 1]));
    res.json({ estoque: e.estoque, cfg: { ...ESd.cfg({ estoqueCfg: e.estoqueCfg }), fixosMes: {} }, classe: ESd.classeCfg({}), historico: e.historico,
      compras: require('./src/demo-compras').comprasDoAno(e.compras, e.estoque, e.historico, (DEMO.partes().find((x) => x.id === req.query.loja) || {}).vendas), tabela, foraDeLinha, espera });
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
// inventário na apresentação: o catálogo fictício (a contagem fica só no navegador; nada é salvo)
app.get('/api/demo/inventario/catalogo', (req, res) => {
  if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const e = DEMO.estoqueDemo(req.query.loja);
  const p = DEMO.partes().find((x) => x.id === req.query.loja);
  const cat = require('./src/inventario').catalogo(e.estoque, null, p ? p.vendas : null)
    .map((i) => ({ ...i, grupo: i.un === 'Kg' ? 'MATÉRIA PRIMA' : 'ACESSÓRIOS', sub: i.un === 'Kg' ? 'Matéria Prima' : '' }));
  res.json({ itens: cat, estoqueEm: e.estoque.em });
});
app.get('/api/demo/estoque/disponivel', (req, res) => {
  if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const e = DEMO.estoqueDemo(req.query.loja);
  res.json(require('./src/lotes').disponivel({ estoque: e.estoque, compras: e.compras }));
});
// validade na apresentação: as entradas fictícias "envelhecidas" para mostrar todas as faixas (nada é salvo)
/** lotes fictícios da loja (entradas "envelhecidas" de 0 a 13 meses): os mesmos na Validade, no Início e nas perdas do Resultado */
function lotesDemo(lojaId) {
  const LOTd = require('./src/lotes');
  const e = DEMO.estoqueDemo(lojaId);
  const comp = { itens: {} };
  for (const [cod, l] of Object.entries((e.compras && e.compras.itens) || {})) {
    const k = [...cod].reduce((a, c) => a + c.charCodeAt(0), 0) % 14; // 0 a 13 meses para trás
    comp.itens[cod] = l.map(([d, ...r]) => [LOTd.somarMeses(d, -k), ...r]);
  }
  // sempre um chá com pacotes fechados (a janela dos lotes mostra "Abrir lote"): uma chegada de 2 kg três dias antes do estoque,
  // intocada. Sem isso, dependia da hora em que a apresentação era gerada (de madrugada, a loja ficava sem pacote fechado).
  const grs = e.estoque.itens.filter((i) => i.tipoProd === 'granel' && comp.itens[i.cod]).sort((a, b) => (a.cod < b.cod ? -1 : 1));
  const gr = grs.find((i) => !(i.qtd > 0.0005)) || grs[0]; // de preferência um chá zerado: não mexe no que já está na lata
  let estoque = e.estoque;
  if (gr && e.estoque.em) {
    const dia = new Date(Date.parse(e.estoque.em.slice(0, 10) + 'T12:00:00Z') - 3 * 864e5).toISOString().slice(0, 10);
    const ult = comp.itens[gr.cod][comp.itens[gr.cod].length - 1];
    comp.itens[gr.cod] = [...comp.itens[gr.cod], [dia, ult[1], 9100, 2, ult[4]]];
    estoque = { ...e.estoque, itens: e.estoque.itens.map((i) => (i === gr ? { ...i, qtd: Math.round((i.qtd + 2) * 1000) / 1000 } : i)) };
  }
  const { em, lotes, outros } = LOTd.calcular({ estoque, compras: comp, tabela: null, edits: { lotes: {} } });
  for (const l of lotes) if (l.precoKg == null && l.custoKg) l.precoKg = Math.round(l.custoKg * 2.6);
  for (const l of outros) if (l.precoKg == null && l.custoKg) l.precoKg = Math.round(l.custoKg * 2.2 * 10) / 10; // a unidade, como a tabela fictícia
  return { LOTd, e: { ...e, estoque }, comp, em, lotes, outros };
}
app.get('/api/demo/validade', (req, res) => {
  if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const { LOTd, e, comp, em, lotes, outros } = lotesDemo(req.query.loja);
  const { resumo, resumoOutros } = LOTd.paraTela({ lotes, outros }, true);
  res.json({ em, hoje: LOTd.hojeSP(), meses: LOTd.MESES_VALIDADE, mesesAberto: LOTd.MESES_ABERTO, pacoteKg: LOTd.PACOTE_KG, riscoDias: LOTd.RISCO_DIAS, custos: true, faixas: LOTd.FAIXAS.map((f) => ({ id: f.id, nome: f.nome, ate: Number.isFinite(f.ate) ? f.ate : null })),
    // histórico fictício: os dois primeiros chás abertos já tiveram um pacote anterior que acabou
    historico: lotes.filter((l) => l.pacoteN > 0 && l.entrada).slice(0, 2).map((l, k) => { const ab = LOTd.somarMeses(l.entrada, -4 - k), fim = LOTd.somarMeses(l.entrada, -1); return { cod: l.cod, nf: String(9000 + k), entrada: LOTd.somarMeses(l.entrada, -5 - k), lote: '', n: 1, abertoEm: ab, estimado: k === 0, por: k === 0 ? '' : 'gerente', validade: LOTd.somarMeses(ab, LOTd.MESES_ABERTO), acabouEm: fim }; }),
    resumo, resumoOutros, lotes: lotes.map((l) => ({ ...l, tipo: '', familia: '' })), outros, granel: LOTd.granelEstoque({ estoque: e.estoque, compras: e.compras }), entradas: LOTd.entradasRecentes({ estoque: e.estoque, compras: comp, edits: { lotes: {} } }) });
});
// perdas do mês para o Resultado (apresentação): chá vencido dos lotes fictícios + faltas de inventário inventadas
app.get('/api/demo/perdas', (req, res) => {
  if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const PERd = require('./src/perdas'), { LOTd, lotes, outros } = lotesDemo(req.query.loja);
  res.json({ hoje: LOTd.hojeSP(), meses: PERd.porMes({ lotes: [...lotes, ...outros], contagens: PERd.contagensDemo(req.query.loja, LOTd.hojeSP()) }) });
});
// NF-e de saída fictícias (vendas com nota, transferência, devolução), montadas com os produtos da apresentação
const NFSd = require('./src/nfsaida');
function nfsDemo(lojaId) {
  const e = DEMO.estoqueDemo(lojaId), it = e.estoque.itens.filter((i) => i.desc).slice(0, 40);
  const hoje = new Date(), dia = (n) => new Date(hoje.getTime() - n * 864e5).toISOString().slice(0, 10);
  const lj = DEMO.lojasDemo().find((l) => l.id === lojaId) || { nome: 'Tea Shop' };
  let refDemo = null;
  for (const l of Object.values(e.compras.itens || {})) for (const [dEnt, , nfEnt] of l) {
    if (!refDemo || dEnt > refDemo.d) refDemo = { d: dEnt, nf: nfEnt };
  }
  const chaveRefDemo = refDemo ? ('35' + refDemo.d.slice(2, 4) + refDemo.d.slice(5, 7) + '11222333000144' + '55' + '001' + String(Number(refDemo.nf) || 1).padStart(9, '0') + '1' + '10000001').padEnd(44, '0').slice(0, 44) : null;
  const base = [
    [5, 'Venda de mercadoria', 'Saída', 'Normal', '5102', { nome: 'Empresa Fictícia de Eventos Ltda', doc: '12345678000190', tipoDoc: 'CNPJ' }, [[0, 25, 7.9], [1, 25, 7.9], [2, 25, 7.9]], 'autorizada'],
    [12, 'Venda de mercadoria', 'Saída', 'Normal', '5102', { nome: 'Maria Exemplo da Silva', doc: '12345678909', tipoDoc: 'CPF' }, [[3, 2, 54.9], [4, 1, 129.9]], 'autorizada'],
    [20, 'Transferência entre filiais', 'Saída', 'Normal', '5152', { nome: 'Tea Shop Filial (fictícia)', doc: '98765432000110', tipoDoc: 'CNPJ' }, [[5, 6, 32.5], [6, 4, 41.2], [7, 3, 18.0]], 'autorizada'],
    [27, 'Devolução de compra', 'Saída', 'Devolução', '5202', { nome: 'Fornecedor Fictício S.A.', doc: '11222333000144', tipoDoc: 'CNPJ' }, [[8, 2, 22.4]], 'autorizada'],
    [33, 'Venda de mercadoria', 'Saída', 'Normal', '5102', { nome: 'João Exemplo Pereira', doc: '98765432100', tipoDoc: 'CPF' }, [[9, 3, 39.9]], 'cancelada'],
  ];
  return base.map(([d, natOp, tipo, fin, cfop, dest, its, sit], k) => {
    const numero = 70 + k * 3, data = dia(d);
    const itens = its.map(([ix, qtd, vUn], j) => { const p = it[ix % it.length] || { cod: String(ix), desc: 'Produto' }; return { n: j + 1, cod: p.cod, desc: p.desc, ncm: '09021000', cfop, un: p.un || 'UN', qtd, vUn, vProd: Math.round(qtd * vUn * 100) / 100, vDesc: 0 }; });
    const vNF = Math.round(itens.reduce((t, i) => t + i.vProd, 0) * 100) / 100;
    const chave = ('52' + data.slice(2, 4) + data.slice(5, 7) + '00000000000191' + '55' + '001' + String(numero).padStart(9, '0') + '1' + String(10000000 + numero).slice(-8)).padEnd(44, '0').slice(0, 44);
    const refs = fin === 'Devolução' && chaveRefDemo ? [chaveRefDemo] : [];
    return { chave, situacao: sit, numero, serie: '1', mod: '55', emissao: data + 'T14:47:00-03:00', data, natOp, tipo, finalidade: fin, refs,
      emit: { nome: lj.nome + ' (fictícia)', fantasia: lj.nome, cnpj: '00000000000191', ie: '000000000', end: { linha: 'Rua Exemplo, 100 · Centro', mun: 'Cidade Exemplo', uf: 'GO', cep: '74000000' } },
      dest: { ...dest, end: { linha: 'Av. Fictícia, 200 · Bairro Exemplo', mun: 'Cidade Exemplo', uf: 'GO', cep: '74000000' } },
      total: { vNF, vProd: vNF, vDesc: 0 }, pagamentos: [], infCpl: 'Nota fictícia da apresentação.', protocolo: sit === 'autorizada' || sit === 'cancelada' ? '152260000000' + numero : null, autorizadaEm: data + 'T14:48:00-03:00', itens };
  });
}
const cabNfs = (n) => ({ chave: n.chave, numero: n.numero, serie: n.serie, data: n.data, emissao: n.emissao, natOp: n.natOp, tipo: n.tipo, finalidade: n.finalidade, situacao: n.situacao, refs: n.refs || [],
  dest: n.dest ? { nome: n.dest.nome, doc: n.dest.doc, tipoDoc: n.dest.tipoDoc, mun: n.dest.end && n.dest.end.mun, uf: n.dest.end && n.dest.end.uf } : null,
  valor: n.total.vNF, itens: n.itens.length, qtd: n.itens.reduce((t, i) => t + (i.qtd || 0), 0), cfops: [...new Set(n.itens.map((i) => i.cfop))] });
// apresentação: conta com a franquia de exemplo (nada é salvo)
function contaDemo() {
  const CFd = require('./src/contafranquia');
  const d = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const forn = 'TSB FRANQUIAS E COMERCIO LTDA ME';
  const ent = (id, nf, dias, desconto) => ({ id, nf, chave: String(nf).padStart(44, '3'), emissao: d(dias), entrada: d(dias), fornecedor: forn, total: 2500, desconto, itens: [] });
  const compras = [ent('e1', 19001, 70, 0), ent('e2', 19050, 55, 0), ent('e3', 19120, 22, 350), ent('e4', 19180, 8, 120),
    // notas sem desconto (para escolher em "Compensada em nota fiscal de entrada"): mais da franquia e de outros fornecedores
    ent('e5', 19210, 4, 0), ent('e6', 19095, 35, 0), ent('e7', 18950, 90, 0),
    { ...ent('e8', 4471, 15, 0), fornecedor: 'EMBALAGENS EXEMPLO LTDA', total: 380 }, { ...ent('e9', 902, 40, 0), fornecedor: 'DOCES FICTÍCIOS ME', total: 640 }];
  const dev = (n, dias, valor, ref) => ({ chave: String(n).padStart(44, '4'), numero: n, serie: 1, emissao: d(dias), finalidade: 'Devolução', situacao: 'autorizada', valor, refs: [ref], dest: { nome: forn } });
  const saidas = [dev(512, 60, 200, compras[0].chave), dev(518, 48, 150, compras[1].chave), dev(531, 41, 60.9, compras[1].chave), dev(540, 12, 87.4, compras[2].chave)];
  const ym = (k) => { const x = new Date(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() - k); return x.toISOString().slice(0, 7); };
  const estoqueD = { itens: [{ cod: '1', desc: 'MEDIDA INOX', un: 'Un', custo: 18.4 }, { cod: '2', desc: 'CANECA DE VIDRO DUPLO', un: 'Un', custo: 31.31 }, { cod: '3', desc: 'ROOIBOS ORIGINAL', un: 'Kg', custo: 210 }] };
  const ev = [];
  for (const [k, n] of [[3, 6], [2, 5], [1, 7], [0, 2]]) for (let i = 0; i < n; i++) ev.push({ tipo: 'resgate', data: `${ym(k)}-${String(3 + i * 3).padStart(2, '0')}`, pontos: 10, produtos: [['Medida Inox', 'Caneca De Vidro Duplo', 'Rooibos Original 50G'][i % 3]] });
  const codsDe = (nome) => (/medida/i.test(nome) ? ['1'] : /caneca/i.test(nome) ? ['2'] : /rooibos/i.test(nome) ? ['3'] : []);
  const fidelidade = CFd.contaPremios('__demo__', { eventos: ev, estoque: estoqueD, compras: [], codsDe });
  // royalties de exemplo: o mês de 3 meses atrás veio certo; o de 2 meses atrás veio a menos
  for (const x of fidelidade.meses) {
    if (x.mes === ym(3)) Object.assign(x, { lancamentos: [{ id: 'd1', ref: ym(2), premios: x.mes, valor: x.devido, obs: 'boleto de royalties', por: 'apresentacao' }], recebido: x.devido, diferenca: 0, situacao: 'ok' });
    if (x.mes === ym(2)) { const v = Math.round(x.devido * 70) / 100; Object.assign(x, { lancamentos: [{ id: 'd2', ref: ym(1), premios: x.mes, valor: v, obs: '', por: 'apresentacao' }], recebido: v, diferenca: Math.round((x.devido - v) * 100) / 100, situacao: 'faltou' }); }
  }
  { const ls = fidelidade.meses, soma = (f, k) => Math.round(ls.filter(f).reduce((a, x) => a + x[k], 0) * 100) / 100;
    Object.assign(fidelidade.resumo, { atrasado: soma((x) => x.situacao === 'atrasado', 'devido'), nAtrasado: ls.filter((x) => x.situacao === 'atrasado').length, faltou: soma((x) => x.situacao === 'faltou', 'diferenca'), nFaltou: ls.filter((x) => x.situacao === 'faltou').length, recebido: soma(() => true, 'recebido') }); }
  return { ...CFd.conta('__demo__', { saidas, compras, devsPainel: [] }), fidelidade };
}

app.get('/api/demo/conta-franquia', (req, res) => { if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' }); res.json(contaDemo()); });
app.post('/api/demo/conta-franquia/email/previa', express.json({ limit: '10kb' }), (req, res) => {
  const conta = contaDemo();
  const r = require('./src/cobranca').montar(req.body.tipo === 'fidelidade' ? 'fidelidade' : 'devolucoes', { conta, fid: conta.fidelidade, ids: req.body.ids, meses: req.body.meses, nomeLoja: 'Tea Shop Centro' });
  res.json({ ...r, para: ['franquia@exemplo.com'], ultima: null, anexos: req.body.tipo === 'fidelidade' ? ['planilha com a relação dos resgates (.xlsx)'] : ['XML de cada nota de devolução'] });
});
// apresentação: "compensada" só confere e responde (a tela troca na memória); nada é salvo
app.post('/api/demo/conta-franquia/acao', express.json({ limit: '5kb' }), (req, res) => {
  const b = req.body || {};
  if (b.tipo !== 'compensar' && b.tipo !== 'cancelar') return res.status(400).json({ erro: 'Na apresentação nada é salvo.' });
  const CFd = require('./src/contafranquia'), conta = contaDemo();
  if (!conta.creditos.some((c) => c.id === b.credito)) return res.status(400).json({ erro: 'Crédito inválido.' });
  const obs = String(b.obs || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
  if (b.tipo === 'cancelar') return res.json({ ok: true, simulado: true, compensado: { como: 'cancelado', nota: null, nf: null, mes: null, obs } });
  const r = CFd.compensacao(b, { compras: conta.entradas });
  if (r.erro) return res.status(400).json({ erro: r.erro });
  const n = r.reg.nota ? conta.entradas.find((x) => x.id === r.reg.nota) : null;
  res.json({ ok: true, simulado: true, compensado: { como: r.reg.como, nota: n ? { id: n.id, nf: n.nf, emissao: n.emissao } : null, nf: r.reg.nf || null, mes: r.reg.mes || null, obs } });
});
app.post('/api/demo/conta-franquia/royalties', (req, res) => res.status(400).json({ erro: 'Na apresentação nada é salvo.' }));
app.get('/api/demo/reajuste/para', (req, res) => res.json({ para: ['compras@franquia-exemplo.com.br'], loja: 'Tea Shop Centro' }));
app.post('/api/demo/reajuste/enviar', express.json({ limit: '2mb' }), (req, res) => {
  const it = COB.conferirItensReajuste((req.body || {}).itens);
  if (it.erro) return res.status(400).json({ erro: it.erro });
  res.json({ ok: true, simulado: true, para: ['compras@franquia-exemplo.com.br'], graficos: COB.conferirGraficos((req.body || {}).graficos, it.ok).length }); // apresentação: nada é enviado
});
app.post('/api/demo/conta-franquia/email/enviar', (req, res) => res.status(400).json({ erro: 'Na apresentação nenhum e-mail é enviado.' }));
app.get('/api/demo/nfsaida', (req, res) => { if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' }); res.json({ notas: nfsDemo(req.query.loja).map(cabNfs), temXml: true }); });
app.get('/api/demo/nfsaida/nota', (req, res) => { const n = lojaDemo(req) && nfsDemo(req.query.loja).find((x) => x.chave === req.query.chave); if (!n) return res.status(404).json({ erro: 'Nota não encontrada.' }); res.json(n); });
app.get('/api/demo/nfsaida/danfe', (req, res) => { const n = lojaDemo(req) && nfsDemo(req.query.loja).find((x) => x.chave === req.query.chave); if (!n) return res.status(404).send('Nota não encontrada.'); res.set('X-Robots-Tag', 'noindex').type('html').send(NFSd.danfe(n)); });
app.get('/api/demo/nfsaida/xml', (req, res) => res.status(404).type('text/plain; charset=utf-8').send('Na apresentação as notas são fictícias e não têm XML.'));
// lotes das notas de entrada na apresentação (nada é salvo: o navegador só mostra)
app.get('/api/demo/validade/notas', (req, res) => {
  if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const LOTd = require('./src/lotes');
  const e = DEMO.estoqueDemo(req.query.loja);
  const porNf = new Map();
  for (const [cod, l] of Object.entries(e.compras.itens || {})) for (const [dia, custo, nf, qtd, forn] of l) {
    const n = porNf.get(nf) || porNf.set(nf, { id: nf, nf, entrada: dia, fornecedor: forn, itens: [] }).get(nf);
    const it = e.estoque.itens.find((i) => i.cod === cod) || {};
    n.itens.push({ cod, nome: it.desc || cod, un: it.un || 'Un', qtd, custo });
  }
  const notas = [...porNf.values()];
  const ctxN = { estoque: e.estoque, compras: e.compras, edits: { lotes: {} } };
  const so = String(req.query.nota || '');
  res.json({ pendentes: LOTd.pendentesNotas({ notas, ...ctxN }), notas: notas.filter((n) => !so || String(n.id) === so).sort((a, b) => b.entrada.localeCompare(a.entrada))
    .map((n) => ({ id: n.id, nf: n.nf, entrada: n.entrada, fornecedor: n.fornecedor, itens: LOTd.daNota({ nota: n, ...ctxN }) })).filter((n) => n.itens.length).slice(0, 15) });
});
// devolução na apresentação: o formulário abre com os itens da nota, mas nada é registrado nem enviado
app.get('/api/demo/devolucoes', (req, res) => { if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' }); res.json({ devolucoes: [], destinatarios: ['compras@franquia-exemplo.com.br'], assunto: '' }); });
app.post('/api/demo/devolucoes', (req, res) => res.status(400).json({ erro: 'Na apresentação nenhuma devolução é registrada nem enviada.' }));
// notas fictícias: as entradas da apresentação agrupadas pelo número da nota
function notasEntradaDemo(lojaId) {
    const e = DEMO.estoqueDemo(lojaId);
    const nome = new Map(e.estoque.itens.map((i) => [i.cod, i]));
    const porNf = new Map();
    for (const [cod, l] of Object.entries(e.compras.itens || {})) for (const [dia, custo, nf, qtd, forn] of l) {
      const n = porNf.get(nf) || porNf.set(nf, { id: nf, nf, serie: '1', emissao: dia, entrada: dia, status: 'Concluída', motivo: 'Compra', cfop: '1102', fornecedor: forn, total: 0, itens: [] }).get(nf);
      const it = nome.get(cod) || {};
      n.itens.push({ cod, nome: it.desc || cod, un: it.un || 'Un', qtd, vu: custo, custo, grupo: '' });
      n.total = Math.round((n.total + custo * qtd) * 100) / 100;
    }
    return { atualizado: e.compras.atualizado, notas: [...porNf.values()].sort((a, b) => (a.entrada < b.entrada ? -1 : 1)) };
}
app.get('/api/demo/estoque/notas', (req, res) => {
  if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try { res.json(notasEntradaDemo(req.query.loja)); } catch (err) { res.status(500).json({ erro: C.msgErro(err) }); }
});
// caixa a pagar e planilha do contador na apresentação: nada é gravado; a planilha sai com os dados fictícios
const APGd = require('./src/apagar'), CTDd = require('./src/contador');
app.get('/api/demo/apagar', (req, res) => { if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' }); res.json({ pagos: {}, cartao: { pct: 0.73, dias: 60 }, demo: true }); });
app.post('/api/demo/apagar/pago', express.json({ limit: '4kb' }), (req, res) => {
  if (!APGd.ID_OK.test(String((req.body || {}).id || ''))) return res.status(400).json({ erro: 'Conta inválida.' });
  res.json({ ok: true, simulado: true });
});
// valor real de um custo fixo no mês na apresentação: só confere e responde; a tela troca na memória (nada é gravado)
// apresentação: um mês com desconto da franquia nos royalties (devolução e prêmios de fidelidade), para a linha aparecer
app.get('/api/demo/resultado/descontos-royalties', (req, res) => {
  if (!DEMO.lojasDemo().some((l) => l.id === String(req.query.loja || ''))) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  const ym = d.toISOString().slice(0, 7);
  res.json({ porMes: { [ym]: [{ origem: 'devolucao', valor: 184.5, texto: 'devolução NF 1234' }, { origem: 'fidelidade', valor: 96.2, texto: 'prêmios de fidelidade do mês anterior' }] }, semMes: [] });
});
app.post('/api/demo/resultado/fixo-mes', express.json({ limit: '4kb' }), (req, res) => {
  const b = req.body || {};
  if (!DEMO.lojasDemo().some((l) => l.id === String(b.loja || ''))) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const v = require('./src/fixosmes').validar(b, ESd.cfg({ estoqueCfg: DEMO.estoqueDemo(b.loja).estoqueCfg }).outros, IND.hojeSP().iso);
  if (v.erro) return res.status(400).json({ erro: v.erro });
  res.json({ ok: true, simulado: true });
});
app.post('/api/demo/resultado/exportar', express.json({ limit: '200kb' }), async (req, res) => {
  const b = req.body || {};
  const p = DEMO.partes().find((x) => x.id === String(b.loja || '')), lj = DEMO.lojasDemo().find((l) => l.id === String(b.loja || ''));
  if (!p || !lj) return res.status(400).json({ erro: 'Escolha uma loja.' });
  if (!CTDd.mesFechado(b.ym, IND.hojeSP().iso)) return res.status(400).json({ erro: 'A exportação é do mês fechado: escolha um mês que já terminou.' });
  try {
    // caixa fictício: as vendas do dia repartidas nas formas de pagamento (as mesmas proporções do fechamento da apresentação)
    const fatDia = new Map(CTDd.vendasPorDia(p.vendas, b.ym, null).map((d) => [d.dia, d.fat]));
    const caixa = (dia) => { const t = fatDia.get(dia) || 0, x = (k) => Math.round(t * k * 100) / 100; return { vazio: false, totalVendas: t, formas: [{ k: 'credito', valor: x(0.52) }, { k: 'debito', valor: x(0.21) }, { k: 'dinheiro', valor: x(0.05) }, { k: 'pix', valor: Math.round((t - x(0.52) - x(0.21) - x(0.05)) * 100) / 100 }] }; };
    const buf = await CTDd.planilha({ loja: lj, ym: b.ym, geradoEm: IND.hojeSP().iso, resumo: b.resumo, despesas: b.despesas, vendas: p.vendas, caixa, notasEntrada: notasEntradaDemo(lj.id).notas, notasSaida: nfsDemo(lj.id).map(cabNfs) });
    res.set('Content-Disposition', `attachment; filename="contador-${lj.id}-${b.ym}.xlsx"`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf);
  } catch (e) { console.error('[contador demo]', e); res.status(500).json({ erro: 'Não deu para montar a planilha. Tente de novo.' }); }
});
app.get('/api/demo/pedido', (req, res) => {
  if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try { const e = DEMO.estoqueDemo(req.query.loja); // pedido obrigatório fictício: 6 produtos do catálogo
    const disp = e.catalogo.itens.filter((c) => c.disp).slice(5, 11);
    const ate = new Date(Date.now() + 20 * 86400e3).toISOString().slice(0, 10);
    const obrigatorio = { lista: [{ id: 'demo', nome: 'Pedido obrigatório de dezembro (exemplo)', ate, ativo: true, por: 'franquia', em: new Date().toISOString(), itens: disp.map((c, k) => ({ cod: c.cod, nome: c.nome, qtd: k % 2 ? 2 : 6, preco: c.preco })) }] };
    // carrinho salvo fictício (ontem, por outra pessoa): 4 produtos do catálogo que não estão no obrigatório
    const salvo = e.catalogo.itens.filter((c) => c.disp).slice(20, 24), emR = Date.now() - 26 * 3600e3;
    const rascunho = { itens: Object.fromEntries(salvo.map((c, k) => [String(c.cod), (k + 1) * (c.mult > 1 ? c.mult : 1)])), por: 'gerente', em: new Date(emR).toISOString(), expira: new Date(emR + PEDd.RASCUNHO_DIAS * 864e5).toISOString(), dias: PEDd.RASCUNHO_DIAS };
    // carrinho montado fictício (anteontem, ainda sem confirmar): mostra o "Confirmar / Excluir" do registro
    const montado = e.catalogo.itens.filter((c) => c.disp).slice(30, 35), iniC = Date.now() - 50 * 3600e3;
    const carrinho = { modo: 'navegador', inicio: new Date(iniC).toISOString(), fim: new Date(iniC + 4 * 60e3).toISOString(), por: 'gerente', total: montado.length, ok: true, site: 'https://exemplo.invalid/Pedidos/', carrinhoDepois: { texto: `(${montado.length - 1}) Itens` },
      itens: montado.map((c, k) => ({ cod: String(c.cod), nome: c.nome, pedido: 1, qtd: 1, preco: c.preco, status: k === 4 ? 'sem_confirmacao' : 'ok' })) };
    res.json({ rascunho, catalogo: e.catalogo, carrinho, cfg: PEDd.cfg({}), obrigatorio, robo: { disponivel: false }, podeRobo: false }); } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
// ⭐ sugestões fictícias da equipe (a tela guarda as mudanças só no navegador)
function sugestoesDemo(lojaId) {
  const SUGd = require('./src/sugestoes');
  const e = DEMO.estoqueDemo(lojaId);
  const its = (e.estoque.itens || []).filter((i) => i.desc);
  const kg = its.filter((i) => /^kg$/i.test(i.un)), un = its.filter((i) => !/^kg$/i.test(i.un));
  const dia = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const mk = (k, it, nome, x) => ({ id: 'dsug' + k, cod: String(it.cod), desc: it.desc, un: it.un || '', por: nome.toLowerCase(), nome, em: dia(x.dias || 2), recado: x.recado || '', justificativa: x.just || '',
    situacao: SUGd.situacao(it), st: x.st || 'aberta', hist: x.hist || [], decisao: null, fimEm: x.st && x.st !== 'aberta' ? dia(1) : undefined });
  const pick = (arr, k) => arr[k % Math.max(1, arr.length)];
  if (!its.length) return [];
  return [
    mk(1, pick(kg, 3), 'Lyandra', { recado: 'Cliente pergunta toda semana', dias: 3 }),
    mk(2, pick(kg, 3), 'Camila', { recado: '', dias: 1 }),
    mk(3, pick(un, 5), 'Gabrielly', { just: 'Só tem 1 e a cliente leva 3 de presente', dias: 4 }),
    mk(4, pick(kg, 8), 'Lyandra', { dias: 9, hist: [{ em: dia(6), res: 'nao', motivo: 'Fica para o próximo pedido', por: 'gerente' }] }),
    { ...mk(5, pick(un, 9), 'Camila', { dias: 12, st: 'atendida', hist: [{ em: dia(9), res: 'pedido', motivo: '', por: 'gerente' }, { em: dia(1), res: 'chegou', motivo: `NF 19218/1 de ${dia(2).slice(8, 10)}/${dia(2).slice(5, 7)}`, por: 'gerente' }] }), chegou: { nf: '19218/1', dia: dia(2).slice(0, 10) } },
    { ...mk(7, pick(un, 17), 'Lyandra', { dias: 6, hist: [{ em: dia(3), res: 'pedido', motivo: '', por: 'gerente' }] }), aguardando: { em: dia(3), qtd: 2 } },
    mk(8, pick(un, 21), 'Camila', { dias: 20, hist: [{ em: dia(16), res: 'pedido', motivo: '', por: 'gerente' }, { em: dia(8), res: 'naoveio', motivo: 'Não veio na NF 19171/1 de 11/11 (indisponível no fornecedor)', por: 'gerente' }] }),
    mk(6, pick(un, 13), 'Gabrielly', { dias: 8, hist: [{ em: dia(5), res: 'semsite', motivo: 'Sem estoque no site da franquia (automático)', por: 'gerente' }] }),
  ];
}
app.get('/api/demo/sugestoes', (req, res) => {
  if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try { const SUGd = require('./src/sugestoes'); res.json({ itens: SUGd.comEstoque(sugestoesDemo(req.query.loja).reverse(), DEMO.estoqueDemo(req.query.loja).estoque, true), todos: true, motivos: SUGd.MOTIVOS }); } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
app.get('/api/demo/sugestoes/produtos', (req, res) => {
  if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try { res.json({ produtos: require('./src/sugestoes').buscar(DEMO.estoqueDemo(req.query.loja).estoque, String(req.query.q || '').slice(0, 60)) }); } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
app.get('/api/demo/pedido/acesso', (req, res) => res.json({ temLogin: false, usuario: '' }));
// configuração guiada na apresentação: uma loja com o FIXE por fazer; a janela não abre sozinha e nada é gravado
app.get('/api/demo/admin/guia', (req, res) => { try { res.json({ lojas: DEMO.estadoDemo().lojas.map((l, i) => ({ id: l.id, nome: l.nome, passos: { appnext: true, pedido: true, fixe: i !== 0, email: true, nfe: false }, visto: true, abrir: false })) }); } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); } });
// CFOP das notas na apresentação: automático, com a lista que o robô leria do AppNext
const CFOPS_DEMO = [['5102', 'Venda de mercadoria adquirida de terceiros'], ['5405', 'Venda de mercadoria com ST (substituído)'], ['5202', 'Devolução de compra para comercialização'], ['5411', 'Devolução de compra com ST'], ['6202', 'Devolução de compra para comercialização (fora do estado)']].map(([codigo, descricao]) => ({ codigo, descricao }));
// regras fiscais de exemplo (como no AppNext do dono: com ST e sem ST na venda; devolução normal e com ST)
const REGRAS_DEMO = { venda: [{ id: 'r1', descricao: 'VENDA SEM ST', cfop: '5102', produtos: 2553, motivo: '1', motivoNome: 'Venda' }, { id: 'r2', descricao: 'VENDA COM ST', cfop: '5405', produtos: 312, motivo: '1', motivoNome: 'Venda' }],
  devolucao: [{ id: 'r3', descricao: 'DEVOLUÇÃO AO FORNECEDOR', cfop: '5202', produtos: 2217, motivo: '19', motivoNome: 'Devolução ao Fornecedor' }, { id: 'r4', descricao: 'DEVOLUÇÃO COM ST', cfop: '5411', produtos: 140, motivo: '19', motivoNome: 'Devolução ao Fornecedor' }] };
app.get('/api/demo/admin/estado', (req, res) => { try { const e = DEMO.estadoDemo(); res.json({ ...e, lojas: (e.lojas || []).map((l) => ({ nfeCfop: { venda: '', devolucao: '' }, cfopsAppNext: { em: new Date().toISOString(), lista: CFOPS_DEMO, regras: REGRAS_DEMO }, ...l })) }); } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); } });
app.get('/api/demo/admin/notif', (req, res) => res.json({ ativo: true, horario: '08:00', ultimoEnvio: null, alertas: true, fechamento: { ativo: true, horario: '23:30', ultimoEnvio: null }, avisos: { email: 'admin@exemplo.com' },
  telegram: { configurado: false, destinos: [] }, email: { host: 'smtp.exemplo.com', port: 587, secure: false, user: 'painel@exemplo.com', from: 'Painel <painel@exemplo.com>', temSenha: true, configurado: true,
    destinos: [{ email: 'franqueado@exemplo.com', nome: 'Franqueado(a)', lojas: ['*'] }] } }));
app.get('/api/demo/classificacao', (req, res) => res.json({ produtos: {} }));
// fotos fictícias (desenho com a "estampa" de cada produto) para os acessórios da apresentação
app.get('/api/demo/site/fotos', (req, res) => {
  try {
    const CORES = [['#F3E3D8', '#D9716A', '#6E9A6B'], ['#DCE9F2', '#3F6FA3', '#9DB9D4'], ['#F7EFD2', '#C9A227', '#2C5234'], ['#EDE3F2', '#8A5FA8', '#D9A7C7'], ['#E2F0E4', '#2C7A4B', '#F6C94B']];
    const svg = ([f, a, b], k) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#FAF8F3"/><path d="M70 40h8a12 12 0 010 24h-8" fill="none" stroke="#b9b2a2" stroke-width="5"/><rect x="24" y="26" width="48" height="52" rx="8" fill="${f}"/>${[0, 1, 2, 3].map((n) => `<circle cx="${36 + (n % 2) * 24}" cy="${42 + Math.floor(n / 2) * 22}" r="${k ? 4 : 6}" fill="${n % 2 ? a : b}"/>`).join('')}</svg>`);
    const itens = ((DEMO.estoqueDemo(req.query.loja).estoque.itens) || []).filter((i) => i.un !== 'Kg').slice(0, 1500)
      .map((i, k) => ({ s: String(i.cod), n: i.desc, v: '', u: '#', i: [svg(CORES[k % CORES.length], 0), svg(CORES[(k + 2) % CORES.length], 1)] }));
    res.json({ demo: true, em: new Date().toISOString(), itens });
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
app.get('/api/demo/site', (req, res) => res.json({ demo: true, em: new Date().toISOString(), origem: 'agendada', itens: [] }));
app.get('/api/demo/contatos', (req, res) => res.json({ contatos: {} }));
// apresentação: a conferência do link responde "pode" (nada é aberto nem gravado; o desfazer é só no navegador)
app.post('/api/demo/contatos/conferir', (req, res) => res.json({ ok: true }));
require('./src/push-api').demo(app); // notificações na apresentação: aparelho fictício, nada é ativado nem enviado
require('./src/errostela').demo(app); // erros de tela na apresentação: aceita sem gravar e mostra um exemplo
require('./src/zap-api').demo(app); // robô do WhatsApp na apresentação: tudo simulado, nada é conectado nem enviado
app.get('/api/demo/xmls/resumo', (req, res) => res.json({ meses: [] }));
const demoComp = new Map(); // corpo da apresentação já comprimido (br/gz), por loja: refeito quando o corpo muda (a cada hora)
app.get('/api/demo/dados', async (req, res) => {
  try {
    const d = DEMO.pacoteDemo(String(req.query.loja || ''));
    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-Dados-Em', new Date(d.at).toISOString());
    let c = demoComp.get(d.chave);
    if (!c || c.body !== d.body) {
      const buf = Buffer.from(d.body);
      const [gz, br] = await Promise.all([gzipAsync(buf, { level: 6 }), brotliAsync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } })]);
      c = { body: d.body, gz, br, etag: 'W/"' + crypto.createHash('sha1').update(buf).digest('base64').slice(0, 27) + '"' };
      demoComp.set(d.chave, c);
    }
    // nada mudou desde o último pedido (o painel guarda os dados no aparelho e confere pelo ETag)
    res.set({ ETag: c.etag, Vary: 'Accept-Encoding' });
    if (req.get('If-None-Match') === c.etag) return res.status(304).end();
    const aceita = String(req.headers['accept-encoding'] || '');
    const querBr = /\bbr\b/.test(aceita), querGz = /\bgzip\b/.test(aceita);
    res.set('Content-Type', 'application/json; charset=utf-8');
    if (!querBr && !querGz) return res.end(d.body);
    // já vai comprimido (o compression() não comprime de novo o que tem Content-Encoding)
    res.set('Content-Encoding', querBr ? 'br' : 'gzip');
    res.end(querBr ? c.br : c.gz);
  } catch (e) {
    console.error('[demo] erro:', e.message);
    res.status(500).json({ erro: 'Apresentação indisponível no momento.' });
  }
});

// dados fictícios também para o comparativo com a rede e os alertas da apresentação
app.get('/api/demo/rede', (req, res) => {
  try { res.json(IND.rede(DEMO.partes(), String(req.query.ym || ''), String(req.query.loja || ''), 3)); } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
app.get('/api/demo/fechamento', (req, res) => {
  const p = DEMO.partes().find((x) => x.id === String(req.query.loja || ''));
  if (!p) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const F2 = require('./src/fechamento');
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dia || '')) ? req.query.dia : F2.ultimoDia(p.vendas, IND.hojeSP().iso);
  if (!dia) return res.json({ vazio: true });
  const f = F2.calcular(p, dia);
  // caixa fictício: as vendas do dia repartidas nas formas de pagamento
  const t = Math.round((f.total.hoje || 0) * 100) / 100, parte = (x) => Math.round(t * x * 100) / 100;
  const formas = [['credito', 'Cartão de crédito', parte(0.52)], ['debito', 'Cartão de débito', parte(0.21)], ['dinheiro', 'Dinheiro', parte(0.05)], ['ecommerce', 'Ecommerce', 0], ['troca', 'Troca', 0]];
  formas.push(['pix', 'Pix', Math.round((t - formas.reduce((s, x) => s + x[2], 0)) * 100) / 100]);
  const din = formas[2][2], deveria = Math.round((300 + din - 20) * 100) / 100;
  f.caixa = { dia, vazio: false, caixas: [{ numero: 1, pdv: 1, turno: 'Manhã', abertura: dia + 'T10:00:00', fechamento: dia + 'T22:02:00', operador: 'Vendedora fictícia' }],
    formas: formas.map(([k, rot, valor]) => ({ k, rot, valor, informado: valor, dif: 0 })), totalVendas: t, suprimento: 0, sangria: 20, abertura: 300, fechamento: deveria + 1, deveria, diferenca: 1, movimentos: [] };
  res.json({ ...f, html: F2.html(f) });
});
app.get('/api/demo/conferencia', (req, res) => {
  const p = DEMO.partes().find((x) => x.id === String(req.query.loja || ''));
  if (!p) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try { res.json({ ...require('./src/conferencia').demo(p, IND.hojeSP().iso), podeCfg: true }); } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
app.put('/api/demo/conferencia/cfg', (req, res) => res.status(400).json({ erro: 'Na apresentação nada é salvo.' }));
app.get('/api/demo/alertas', (req, res) => {
  const p = DEMO.partes().find((x) => x.id === String(req.query.loja || ''));
  res.json({ alertas: p ? IND.alertas(p) : [] });
});
// apresentação: conversas de mentira para os celulares (fictícios) que a tela manda; nada é lido nem gravado.
// A lista e a conversa aberta saem da mesma conta (demoConversa): a prévia da lista é sempre a última mensagem da conversa.
const DEMO_CONV = [
  { cli: 'Oi! Vocês ainda têm o chá de hibisco com morango?', loja: 'Temos sim! Quer que eu separe 100 g para você? 😊' },
  { cli: 'Bom dia, que horas vocês abrem no domingo?', loja: 'Bom dia! Domingo abrimos das 14h às 20h. 🍵' },
  { robo: 'Oi! Aqui é a equipe da Tea Shop 😊 Você tem pontos no programa de fidelidade, e parte deles vence este mês. Que tal usar numa visita? 🍵', cli: 'Recebi a mensagem dos pontos, valeu! Passo aí sábado.' },
  { cli: 'Qual o preço da caneca de vidro?', loja: 'A caneca de vidro sai por R$ 89,90. Tem nas cores transparente e fumê.' },
  { robo: 'Oi! Aqui é a equipe da Tea Shop 😊 Seu chá favorito chegou fresquinho. Quer que a gente separe?' },
  { cli: 'Vocês entregam?', loja: 'Entregamos pelo app de entregas da loja e também separamos para retirar.' },
];
const DEMO_SEMCAD = '5500911112222';
// qual exemplo cada celular recebe: pelo próprio número. Os celulares que a tela manda mudam com o dia (clientes recentes), então,
// se nenhum caiu no exemplo que termina com o robô, o último da lista passa a ser ele (sem isso a apresentação ficava, em
// alguns dias, sem conversa com 🤖 — teste CONV-08 falhava de madrugada). Guardado na memória, para a conversa aberta bater com a lista.
const DEMO_K_ROBO = DEMO_CONV.findIndex((t) => t.robo && !t.cli && !t.loja);
const demoForcado = new Map();
const demoIndice = (chave) => (demoForcado.has(chave) ? demoForcado.get(chave) : [...chave].reduce((x, c, i) => x + c.charCodeAt(0) * (i + 3) * 31, 0) % DEMO_CONV.length);
function demoConversa(chave, ag) {
  const min = 60e3, em = (ms) => new Date(ms).toISOString();
  if (chave === DEMO_SEMCAD) return [{ id: 'd-s0', deMim: false, em: em(ag - 30 * 3600e3 - 2 * min), tipo: 'audio', texto: '', nome: 'Contato sem cadastro' }, { id: 'd-s1', deMim: false, em: em(ag - 30 * 3600e3), tipo: 'texto', texto: 'Oi, vi o anúncio de vocês. Têm chá para dormir?', nome: 'Contato sem cadastro' }];
  const k = demoIndice(chave);
  const t = DEMO_CONV[k], fim = ag - ((k * 95) + 12) * min;
  const msgs = [
    { id: 'd1', deMim: false, em: em(fim - 3 * 864e5), tipo: 'texto', texto: 'Oi! Passei aí semana passada e gostei muito do atendimento.' },
    { id: 'd2', deMim: true, em: em(fim - 3 * 864e5 + 25 * min), tipo: 'texto', texto: 'Que bom! Volte sempre 😊' },
  ];
  msgs.push({ id: 'd1f', deMim: false, em: em(fim - 3 * 864e5 + 2 * min), tipo: 'imagem', texto: '' }); // a foto (fictícia) que o cliente mandou
  if (t.robo) msgs.push({ id: 'd3', deMim: true, em: em(fim - (t.cli ? 40 : 0) * min), tipo: 'texto', texto: t.robo, robo: 'Campanha Resumo diário' });
  if (t.cli) msgs.push({ id: 'd4', deMim: false, em: em(fim - (t.loja ? 18 : 0) * min), tipo: 'texto', texto: t.cli });
  if (t.loja) msgs.push({ id: 'd5', deMim: true, em: em(fim), tipo: 'texto', texto: t.loja });
  return msgs;
}
app.get('/api/demo/conversas', (req, res) => {
  const fones = String(req.query.fones || '').split(',').map((x) => x.replace(/\D/g, '')).filter((x) => /^\d{12,13}$/.test(x)).slice(0, 8);
  if (fones.length && !fones.some((f) => demoIndice(f) === DEMO_K_ROBO)) { if (demoForcado.size > 200) demoForcado.clear(); demoForcado.set(fones[fones.length - 1], DEMO_K_ROBO); }
  const ag = Date.now();
  const conversas = [...fones, DEMO_SEMCAD].map((chave) => {
    const msgs = demoConversa(chave, ag), u = msgs[msgs.length - 1];
    return { chave, nome: chave === DEMO_SEMCAD ? 'Contato sem cadastro' : '', n: msgs.length, ult: { em: u.em, texto: u.texto, deMim: u.deMim, tipo: u.tipo, robo: u.robo || null },
      semResposta: CONV.semRespostaDe(msgs) };
  });
  res.json({ conversas, buscadoEm: new Date(ag - 60e3).toISOString(), servico: true, conectado: true, conexao: 'conectado', historico: null, meses: 12, demo: true });
});
app.get('/api/demo/conversas/mensagens', (req, res) => {
  const chave = String(req.query.chave || '');
  if (!/^\d{12,13}$/.test(chave)) return res.status(400).json({ erro: 'Conversa inválida.' });
  const ag = Date.now(), msgs = demoConversa(chave, ag);
  // exemplo da trava "em conversa" do robô: nas conversas de exemplo em que o cliente perguntou e a loja respondeu (a 1ª e a 2ª de DEMO_CONV)
  const k = demoIndice(chave), ult = [...msgs].reverse().find((x) => !x.robo);
  const adiada = chave !== DEMO_SEMCAD && (k === 0 || k === 1) && ult ? { campanha: 'Pontos vencendo', aPartir: new Date(Date.parse(ult.em) + 3 * 864e5).toISOString() } : null;
  res.json({ mensagens: msgs, adiada });
});
app.post('/api/demo/conversas/lida', (req, res) => res.json({ ok: true }));
app.post('/api/demo/conversas/responder', express.json({ limit: '8kb' }), (req, res) => {
  const texto = String((req.body && req.body.texto) || '').trim();
  if (!texto) return res.status(400).json({ erro: 'Escreva a mensagem.' });
  if (texto.length > 2000) return res.status(400).json({ erro: 'Mensagem grande demais (até 2.000 caracteres).' });
  res.json({ ok: true, em: new Date().toISOString(), simulado: true }); // na apresentação nada sai: a tela mostra a mensagem só na memória
});
// mídia da conversa na apresentação: uma imagem desenhada aqui (sem foto real) e meio segundo de silêncio
app.get('/api/demo/conversas/midia', (req, res) => {
  const chave = String(req.query.chave || ''), idm = String(req.query.id || '');
  if (!/^\d{12,13}$/.test(chave)) return res.status(400).json({ erro: 'Conversa inválida.' });
  const m = demoConversa(chave, Date.now()).find((x) => x.id === idm);
  if (!m || !CONV.TIPOS_MIDIA.includes(m.tipo)) return res.status(404).json({ erro: 'Mensagem não encontrada nesta conversa.' });
  const r = m.tipo === 'audio' ? { ok: true, dados: CONV.demoSilencio(), mimetype: 'audio/wav', nome: null } : { ok: true, dados: CONV.demoImagem(), mimetype: 'image/png', nome: null };
  CONV.responderMidia(res, { ...r, tipo: m.tipo, em: m.em });
});
// vínculo da conversa com o cliente: na apresentação só responde (nada é gravado; a tela troca o número na memória)
app.post('/api/demo/clientes/celular', express.json({ limit: '2kb' }), (req, res) => {
  const l = require('./src/celulares').local((req.body || {}).cel);
  if (!l) return res.status(400).json({ erro: 'Número inválido: precisa do DDD e do número.' });
  res.json({ ok: true, vinculo: { cel: '55' + l, em: new Date().toISOString(), por: 'Visitante', antigo: '' }, tirouDe: 0 });
});
app.post('/api/demo/clientes/celular/desfazer', (req, res) => res.json({ ok: true }));
app.post('/api/demo/clientes/celular/nome', express.json({ limit: '2kb' }), (req, res) => {
  const n = require('./src/celulares').nomeValido((req.body || {}).nome);
  if (n == null) return res.status(400).json({ erro: 'Nome inválido: só letras, até 40.' });
  res.json({ ok: true, nome: n });
});
// Meta de hoje da vendedora (Minha comissão): resposta fictícia, nada gravado (a apresentação roda como admin)
app.get('/api/demo/meta-hoje', (req, res) => res.json({ minhaParte: 412, vendiHoje: 268.5, temHoje: true, modo: 'igual', restam: 8, semParte: null }));
app.all('/api/demo/*', (req, res) => res.status(404).json({ erro: 'Isto não está disponível na apresentação.' }));

// ---------- marca da loja (pública: usada na tela de login com ?loja=) ----------
const LOGO_EXT = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
function arquivoLogo(id) {
  for (const e of Object.keys(LOGO_EXT)) { const f = path.join(C.pastaLoja(id), `logo.${e}`); if (fs.existsSync(f)) return { f, tipo: LOGO_EXT[e] }; }
  return null;
}
app.get('/marca/:id.json', (req, res) => {
  const l = C.get().lojas.find((x) => x.id === String(req.params.id).toLowerCase());
  if (!l) return res.status(404).json({});
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ nome: (l.marca && l.marca.nome) || l.nome, logo: !!arquivoLogo(l.id) });
});
app.get('/marca/:id/logo', (req, res) => {
  const l = C.get().lojas.find((x) => x.id === String(req.params.id).toLowerCase());
  const a = l && arquivoLogo(l.id);
  if (!a) return res.status(404).end();
  res.set({ 'Content-Type': a.tipo, 'Cache-Control': 'public, max-age=300', 'Content-Security-Policy': "default-src 'none'" });
  fs.createReadStream(a.f).pipe(res);
});

// ---------- carrinho do Sistema de Pedidos montado no navegador (favorito "Carrinho Tea Shop") ----------
// sem login: só com o código de uso único que o painel gerou; responde apenas ao site de pedidos (CORS)
{
  const PEDx = require('./src/pedido');
  const cors = (req, res) => {
    const o = req.get('Origin');
    if (o && PEDx.ORIGENS.has(o)) res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin' });
    res.set('Cache-Control', 'no-store');
  };
  app.get('/api/pedido-site/lista', (req, res) => {
    cors(req, res);
    const x = PEDx.lerCodigo(req.query.c);
    if (!x) return res.status(404).json({ erro: 'Este link venceu. Volte ao painel e clique em "Montar carrinho no site" de novo.' });
    const loja = C.get().lojas.find((l) => l.id === x.loja);
    res.json({ loja: loja ? loja.nome : x.loja, itens: x.itens });
  });
  // corpo em text/plain (sem pré-requisição CORS)
  app.post('/api/pedido-site/progresso', express.text({ limit: '200kb', type: '*/*' }), (req, res) => {
    cors(req, res);
    let b; try { b = JSON.parse(req.body || '{}'); } catch { return res.status(400).json({ erro: 'inválido' }); }
    const r = PEDx.progresso(req.query.c, b);
    // ⭐ sugestões: o que o site recusou no carrinho volta para o próximo pedido
    if (!r.erro && r._fim) { try { require('./src/sugestoes').resultadoCarrinho(r._loja, r._itens); } catch (e) { console.error('[sugestões] carrinho:', e.message); } }
    res.status(r.erro ? 404 : 200).json(r.erro ? r : { ok: true });
  });
}

// ---------- tudo abaixo exige login ----------
app.use((req, res, next) => {
  const cfg = C.get();
  if (!Object.keys(cfg.usuarios).length) {
    // sem usuários o painel fica BLOQUEADO (nunca aberto)
    if (req.path.startsWith('/api/')) return res.status(503).json({ erro: 'Nenhum usuário configurado.' });
    return res.status(503).type('text/plain; charset=utf-8').send('Painel ainda não configurado: crie um usuário com "node scripts/admin.js usuario <nome> <loja>".');
  }
  const s = readToken(cookies(req).ts_sess);
  const lojas = s ? C.lojasDoUsuario(s.u) : [];
  const uS = s ? C.usuario(s.u) : null;
  if (s && (lojas.length || (uS && uS.ativo && !C.expirado(uS) && uS.perfil === 'admin'))) {
    req.user = s.u; req.lojas = lojas;
    const u = C.usuario(s.u);
    req.perfil = u ? u.perfil : 'admin';
    req.vendedor = u ? u.vendedor : '';
    // senha provisória: só pode trocar a senha (ou sair) até criar a própria
    if (u && u.trocarSenha && !['/trocar-senha', '/logout'].includes(req.path)) {
      if (req.path.startsWith('/api/')) return res.status(403).json({ erro: 'trocar-senha' });
      return res.redirect('/trocar-senha?primeiro=1');
    }
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ erro: 'login' });
  res.redirect('/login');
});

// ---------- trocar a própria senha ----------
app.get('/trocar-senha', (req, res) => res.sendFile(path.join(pub, 'trocar-senha.html')));
app.post('/trocar-senha', express.urlencoded({ extended: false }), async (req, res) => {
  if (!mesmaOrigemForm(req)) return res.status(403).type('text/plain; charset=utf-8').send('Origem inválida.');
  const ip = req.ip;
  const volta = (e) => res.redirect('/trocar-senha?e=' + e + (C.usuario(req.user)?.trocarSenha ? '&primeiro=1' : ''));
  if (req.user === '*' || !C.get().usuarios[req.user]) return volta('usuario');
  if (tooMany(ip)) return volta('limite');
  const u = C.get().usuarios[req.user];
  const atual = String(req.body.atual || '').slice(0, 200), nova = String(req.body.nova || ''), confirma = String(req.body.confirma || '');
  if (!(await C.confereSenhaAsync(atual, u.senha))) { falhou(ip); return volta('atual'); }
  if (nova.length < 8 || nova.length > 200) return volta('curta');
  if (nova !== confirma) return volta('confirma');
  if (nova === atual) return volta('igual');
  if (nova.toLowerCase().includes(req.user.toLowerCase())) return volta('usuario-na-senha');
  const novoHash = await C.hashSenhaAsync(nova);
  C.alterar((cfg) => {
    const x = cfg.usuarios[req.user];
    if (!x) return;
    x.senha = novoHash; x.sessao = (x.sessao || 0) + 1; x.trocarSenha = false; x.senhaTrocadaEm = new Date().toISOString();
  });
  C.auditar(req.user, 'trocou a própria senha', req.user, { obrigatoria: !!u.trocarSenha });
  // a senha nova encerra as outras sessões; esta continua com um cookie novo
  res.cookie('ts_sess', makeToken(req.user), { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIE, maxAge: SESSION_HOURS * 3600e3 });
  res.redirect('/?senha=ok');
});

// ---------- contatos com clientes (lista do dia, "contatado", não quer receber mensagens) ----------
// dados/<loja>/contatos.json = { <cpf>: { em, por, motivo, optout, optoutEm } }
const CPF_OK = /^\d{11}(\d{3})?$/;
const arqContatos = (id) => path.join(C.pastaLoja(id), 'contatos.json');
function lerContatos(id) { try { return JSON.parse(fs.readFileSync(arqContatos(id), 'utf8')); } catch { return {}; } }
app.get('/api/contatos', (req, res) => {
  if (!podeClientes(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const ids = String(req.query.loja || '') === 'todas' ? req.lojas.map((l) => l.id) : [String(req.query.loja || '')];
  const out = {};
  for (const id of ids) {
    if (!req.lojas.some((l) => l.id === id)) continue;
    for (const [cpf, c0] of Object.entries(lerContatos(id))) {
      const { desfazer, ...c } = c0; // a marca de antes do "Desfazer" fica só no servidor
      const a = out[cpf];
      out[cpf] = !a ? { ...c, loja: id } : { ...a, ...(c.em > (a.em || '') ? { em: c.em, por: c.por, motivo: c.motivo } : {}), optout: a.optout || c.optout };
    }
  }
  res.json({ contatos: out });
});
/**
 * Regra forte também no link que abre a conversa vazia (Clientes, ficha, janelas): só confere, não marca contatado.
 * espera: true = Lista de espera (avisar que chegou é pedido do cliente) → só "não quer mensagens" trava.
 */
app.post('/api/contatos/conferir', express.json({ limit: '2kb' }), (req, res) => {
  if (!podeClientes(req) && !(req.body && req.body.espera === true)) return res.status(403).json({ erro: 'Sem permissão.' });
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const { loja, cpf } = req.body || {};
  if (!req.lojas.some((l) => l.id === loja)) return res.status(400).json({ erro: 'Loja inválida.' });
  if (!CPF_OK.test(String(cpf || ''))) return res.status(400).json({ erro: 'CPF inválido.' });
  const b = require('./src/zapfila').envioManualBloqueado({ lojaId: loja, cpf, contato: lerContatos(loja)[cpf], campanha: '', agora: Date.now(), soOptout: req.body.espera === true, para: String(req.body.para || '') });
  if (b) return res.status(409).json({ erro: b.replace(/^Mensagem não enviada: /, 'O WhatsApp não foi aberto: '), bloqueado: true });
  res.json({ ok: true });
});
/** "Desfazer" logo depois de abrir o WhatsApp (Hoje): volta a marca de antes — só o último envio, da mesma pessoa, até 2 minutos depois */
const DESFAZER_MS = 2 * 60e3;
app.post('/api/contatos/desfazer', express.json({ limit: '2kb' }), (req, res) => {
  if (!podeClientes(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const { loja, cpf } = req.body || {};
  if (!req.lojas.some((l) => l.id === loja)) return res.status(400).json({ erro: 'Loja inválida.' });
  if (!CPF_OK.test(String(cpf || ''))) return res.status(400).json({ erro: 'CPF inválido.' });
  const todos = lerContatos(loja);
  const c = todos[cpf];
  const d = c && c.desfazer;
  if (!d || d.por !== req.user || c.por !== req.user || Date.now() - Date.parse(c.em) > DESFAZER_MS) return res.status(409).json({ erro: 'Não dá mais para desfazer: passou o tempo ou outra pessoa mexeu neste cliente.' });
  delete c.em; delete c.por; delete c.motivo; delete c.desfazer;
  if (d.antes) Object.assign(c, d.antes);
  if (Object.keys(c).length) todos[cpf] = c; else delete todos[cpf];
  C.gravarAtomico(arqContatos(loja), JSON.stringify(todos), 0o640);
  C.auditar(req.user, 'desfez a marca de contatado (não enviou a mensagem)', loja, { loja, cpf: cpf.slice(0, 3) + '…' + cpf.slice(-2) });
  res.json({ ok: true, contato: todos[cpf] || null });
});
app.post('/api/contatos', express.json({ limit: '4kb' }), (req, res) => {
  if (!podeClientes(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const { loja, cpf, acao, motivo } = req.body || {};
  if (!req.lojas.some((l) => l.id === loja)) return res.status(400).json({ erro: 'Loja inválida.' });
  if (!CPF_OK.test(String(cpf || ''))) return res.status(400).json({ erro: 'CPF inválido.' });
  if (!['contatado', 'optout', 'aceita', 'limpar'].includes(acao)) return res.status(400).json({ erro: 'Ação inválida.' });
  const todos = lerContatos(loja);
  const c = todos[cpf] || {};
  const agora = new Date().toISOString();
  // regra forte (decisão do dono): mensagem pelo painel (Hoje, ficha, Campanhas) é conferida AQUI, antes de o WhatsApp abrir —
  // nunca para quem não quer, para quem já recebeu dentro do intervalo da loja nem para quem o robô vai mandar hoje
  if (acao === 'contatado' && req.body.envio === true) {
    const b = require('./src/zapfila').envioManualBloqueado({ lojaId: loja, cpf, contato: c, campanha: String(req.body.campanha || ''), agora: Date.now(), para: String(req.body.para || '') });
    if (b) return res.status(409).json({ erro: b, bloqueado: true });
    require('./src/zapfila').registrarEnvioNumero(loja, String(req.body.para || ''), cpf, req.user);
  }
  if (acao === 'contatado') {
    // envio pelo painel: guarda a marca anterior para o "Desfazer" (2 minutos, só quem enviou)
    const antes = c.em ? { em: c.em, por: c.por, motivo: c.motivo } : null;
    delete c.desfazer;
    Object.assign(c, { em: agora, por: req.user, motivo: String(motivo || '').slice(0, 40) });
    if (req.body.envio === true) c.desfazer = { por: req.user, antes };
  }
  else if (acao === 'optout') Object.assign(c, { optout: true, optoutEm: agora, optoutPor: req.user });
  else if (acao === 'aceita') { delete c.optout; delete c.optoutEm; delete c.optoutPor; delete c.optoutOrigem; require('./src/zapfila').voltouAAceitar(loja, cpf); }
  else { delete c.em; delete c.por; delete c.motivo; delete c.desfazer; }
  if (Object.keys(c).length) todos[cpf] = c; else delete todos[cpf];
  C.gravarAtomico(arqContatos(loja), JSON.stringify(todos), 0o640);
  if (acao === 'optout' || acao === 'aceita') C.auditar(req.user, acao === 'optout' ? 'cliente não quer contato' : 'cliente voltou a aceitar contato', loja, { loja, cpf: cpf.slice(0, 3) + '…' + cpf.slice(-2) });
  // não quer mensagens: sai na hora dos pendentes das campanhas e a tela diz de quais (pedido do dono, 23/11/2026; NAOQUER-01)
  let campanhas;
  if (acao === 'optout') { try { campanhas = require('./src/campanhas').tirarNaoQuer(loja, cpf, req.user); } catch (e) { console.error('[contatos] tirar das campanhas:', e.message); campanhas = []; } }
  const { desfazer: _d, ...sai } = todos[cpf] || {};
  res.json({ ok: true, contato: todos[cpf] ? sai : null, desfazerAte: _d ? new Date(Date.now() + DESFAZER_MS).toISOString() : null, ...(campanhas ? { campanhas } : {}) });
});

// ---------- Clientes → Conversas (decisão do dono): conversas do WhatsApp da loja; só admin e franqueado da loja ----------
const CONV = require('./src/conversas');
const lojaConv = (req, res) => {
  if (!C.podeConversas(req)) { res.status(403).json({ erro: 'Sem permissão.' }); return null; } // admin, e franqueado até o admin tirar (ZAP-PERM-02)
  const id = String((req.body && req.body.loja) || req.query.loja || '');
  if (!req.lojas.some((l) => l.id === id)) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  return id;
};
app.get('/api/conversas', async (req, res) => {
  const id = lojaConv(req, res); if (!id) return;
  const ZAPc = require('./src/zap'), ZFc = require('./src/zapfila');
  let historico = null, conexao = null;
  if (ZAPc.ativo() && ZFc.temEstado(id) && ZFc.lerEstado(id).sessao) {
    try { const st = await ZAPc.status(id); conexao = st.estado; historico = st.historico || null; } catch { conexao = 'sem_resposta'; }
  }
  res.json({ conversas: CONV.lista(id), buscadoEm: CONV.lerEstado(id).em || null, servico: ZAPc.ativo(), conectado: conexao === 'conectado', conexao, historico, meses: CONV.MESES });
});
app.get('/api/conversas/mensagens', (req, res) => {
  const id = lojaConv(req, res); if (!id) return;
  const chave = String(req.query.chave || '');
  const m = CONV.mensagens(id, chave);
  if (!m) return res.status(400).json({ erro: 'Conversa inválida.' });
  // trava "em conversa" do robô (decisão do dono, 23/11/2026): a mensagem de campanha pendente para este número espera a conversa parar
  let adiada = null;
  try { adiada = require('./src/zapfila').adiadaDaConversa(id, chave); } catch { /* só o aviso na conversa */ }
  res.json({ mensagens: m, adiada });
});
// mídia da conversa (foto, áudio, vídeo, documento), decisão do dono: baixada do WhatsApp na hora e repassada ao navegador,
// sem gravar nada na VPS (nem em dados/, nem cache); nada em log nem auditoria (nem o nome do arquivo)
app.get('/api/conversas/midia', async (req, res) => {
  const id = lojaConv(req, res); if (!id) return;
  const r = await CONV.midiaDe(id, String(req.query.chave || ''), String(req.query.id || ''), require('./src/zap'));
  if (!r.ok) return res.status(r.codigo || 502).json({ erro: r.erro });
  CONV.responderMidia(res, r);
});
app.use('/api/conversas', (req, res, next) => (req.method === 'GET' || req.get('X-Painel') === '1' ? next() : res.status(403).json({ erro: 'Pedido inválido.' })));
// responder pela conversa (fase 2, aprovada pelo dono em 23/11/2026): só admin e franqueado da loja (lojaConv), com X-Painel.
// Sai pelo número da loja, pelo mesmo serviço do robô. Responder a quem escreveu não é campanha: não passa pelo intervalo da loja,
// mas quem "não quer mensagens" (ficha ou "parar") pede confirmação. O texto nunca vai para log nem auditoria (só os 4 últimos dígitos)
app.post('/api/conversas/responder', express.json({ limit: '8kb' }), async (req, res) => {
  const id = lojaConv(req, res); if (!id) return;
  const b = req.body || {};
  const texto = String(b.texto || '').replace(/\r\n/g, '\n').trim();
  if (!texto) return res.status(400).json({ erro: 'Escreva a mensagem.' });
  if (texto.length > 2000) return res.status(400).json({ erro: 'Mensagem grande demais (até 2.000 caracteres).' });
  const para = CONV.numeroDaConversa(id, String(b.chave || ''));
  if (!para) return res.status(400).json({ erro: 'Esta conversa não tem um número de telefone para responder (o WhatsApp não informou o número).' });
  const ZF = require('./src/zapfila'), ZAPc = require('./src/zap');
  if (!ZAPc.ativo()) return res.status(503).json({ erro: 'O robô do WhatsApp não está instalado neste servidor: responda pelo WhatsApp da loja.' });
  const cpf = CPF_OK.test(String(b.cpf || '')) ? String(b.cpf) : null;
  const nq = ZF.porChave(ZF.lerJson(id, 'naoquer'));
  const naoQuer = (cpf && (lerContatos(id)[cpf] || {}).optout) || !!nq[ZF.foneChave(para)];
  if (naoQuer && b.confirmado !== true) return res.status(409).json({ erro: 'Este cliente pediu para não receber mensagens. Responder mesmo assim? (Por exemplo, se ele mesmo escreveu pedindo algo.)', confirmar: true });
  let r;
  try { r = await ZAPc.enviar(id, { id: 'resp-' + crypto.randomBytes(8).toString('hex'), para, texto }); } catch (e) { r = { ok: false, erro: C.msgErro(e) }; }
  if (!r || !r.ok) {
    console.error(`[conversas] ${id}: resposta para ···${ZF.fim4(para)} não saiu: ${(r && (r.motivo || r.erro)) || 'falha'}`);
    return res.status(502).json({ erro: r && r.motivo === 'desconectado' ? 'O WhatsApp da loja não está conectado agora: a mensagem não saiu.' : r && r.motivo === 'sem_whatsapp' ? 'Este número não tem WhatsApp.' : 'A mensagem não saiu. Tente de novo em instantes.' });
  }
  CONV.marcarResposta(id, r.idMsg, req.user);
  C.auditar(req.user, 'respondeu uma conversa do WhatsApp', id, { loja: id, fim: ZF.fim4(para), naoQuer: naoQuer || undefined });
  res.json({ ok: true, em: new Date().toISOString() });
});
app.post('/api/conversas/lida', express.json({ limit: '2kb' }), (req, res) => {
  const id = lojaConv(req, res); if (!id) return;
  res.json({ ok: CONV.marcarLida(id, String((req.body || {}).chave || '')) });
});
app.post('/api/conversas/historico', express.json({ limit: '2kb' }), async (req, res) => {
  const id = lojaConv(req, res); if (!id) return;
  const ZAPc = require('./src/zap');
  if (!ZAPc.ativo()) return res.status(400).json({ erro: 'O robô do WhatsApp não está instalado neste servidor.' });
  const dias = Math.round(Number((req.body || {}).dias) || 30);
  try {
    const r = await ZAPc.historico(id, dias);
    if (!r.ok) return res.status(400).json({ erro: r.erro || 'O WhatsApp desta loja não está conectado.' });
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ erro: 'Não consegui falar com o robô do WhatsApp: ' + C.msgErro(e) }); }
});

// ---------- celular trocado pelo painel (vínculo da conversa com o cliente; src/celulares.js) ----------
// Só admin e franqueado da loja (quem vê as Conversas). O número passa a ser o do cliente em todo o painel e no robô.
const celAudit = (cpf) => String(cpf).slice(0, 3) + '…' + String(cpf).slice(-2);
app.post('/api/clientes/celular', express.json({ limit: '2kb' }), async (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const id = lojaConv(req, res); if (!id) return;
  const CEL = require('./src/celulares');
  const b = req.body || {};
  const cpf = String(b.cpf || '').replace(/\D/g, '');
  const loja = req.lojas.find((l) => l.id === id);
  let cl = [];
  try { cl = (await dadosLoja(loja)).raw.clientes || []; } catch (e) { return res.status(503).json({ erro: 'Os dados da loja não carregaram: ' + C.msgErro(e) }); }
  const c = cl.find((x) => x.cpf === cpf);
  if (!c) return res.status(400).json({ erro: 'Cliente não encontrado nesta loja.' });
  const r = CEL.vincular(id, { cpf, cel: b.cel, antigo: c.celular }, req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'trocou o celular do cliente pela conversa do WhatsApp', id, { loja: id, cpf: celAudit(cpf), fim: r.ok.cel.slice(-4), ...(r.tirouDe.length ? { tirouDe: r.tirouDe.map(celAudit) } : {}) });
  res.json({ ok: true, vinculo: { cel: r.ok.cel, em: r.ok.em, por: r.ok.por, antigo: r.ok.antigo }, tirouDe: r.tirouDe.length });
});
// nome de quem usa o número (o cadastro é da esposa, o WhatsApp é do marido): {nome} das mensagens e sem aniversário
app.post('/api/clientes/celular/nome', express.json({ limit: '2kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const id = lojaConv(req, res); if (!id) return;
  const b = req.body || {};
  const cpf = String(b.cpf || '').replace(/\D/g, '');
  const r = require('./src/celulares').nomear(id, cpf, b.nome);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, r.ok ? 'definiu o nome nas mensagens do número trocado pelo painel' : 'tirou o nome nas mensagens do número trocado pelo painel', id, { loja: id, cpf: celAudit(cpf) });
  res.json({ ok: true, nome: r.ok });
});
app.post('/api/clientes/celular/desfazer', express.json({ limit: '2kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const id = lojaConv(req, res); if (!id) return;
  const cpf = String((req.body || {}).cpf || '').replace(/\D/g, '');
  if (!require('./src/celulares').desfazer(id, cpf)) return res.status(400).json({ erro: 'Este cliente não tem número trocado pelo painel.' });
  C.auditar(req.user, 'desfez a troca de celular do cliente (volta o do FIXE)', id, { loja: id, cpf: celAudit(cpf) });
  res.json({ ok: true });
});

// ---------- campanhas de WhatsApp (Clientes → Campanhas): admin, franqueado e gerente com a tela Clientes ----------
const CAMP = require('./src/campanhas');
const lojaCamp = (req) => { const id = String((req.body && req.body.loja) || req.query.loja || ''); return req.lojas.some((l) => l.id === id) ? id : null; };
const respCamp = (res, r) => (r.erro ? res.status(400).json({ erro: r.erro }) : res.json({ ok: true, campanha: r.ok }));
app.get('/api/campanhas', (req, res) => {
  if (!podeClientes(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const id = lojaCamp(req);
  if (!id) return res.status(400).json({ erro: 'Escolha uma loja.' });
  res.json({ campanhas: CAMP.ler(id), copias: CAMP.lerCopias(id) });
});
app.use('/api/campanhas', (req, res, next) => {
  if (req.method === 'GET') return next();
  if (!podeClientes(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  next();
});
// "Enviar pelo robô": só admin e franqueado ligam; numa campanha do robô o gerente só pausa a repetição ou tira do robô
const ZF = require('./src/zapfila');
const gestorCamp = (req) => ['admin', 'franqueado', 'gerente'].includes(req.perfil) && C.podeRobo(req); // só quem o admin liberou para o robô (ZAP-PERM-01); a vendedora nem chega a estas rotas
const SO_GESTOR_ROBO = 'Sem permissão para ligar ou alterar uma campanha enviada pelo robô do WhatsApp.';
app.post('/api/campanhas', express.json({ limit: '600kb' }), (req, res) => {
  const id = lojaCamp(req);
  if (!id) return res.status(400).json({ erro: 'Escolha uma loja.' });
  if ((req.body || {}).robo && !gestorCamp(req)) return res.status(403).json({ erro: SO_GESTOR_ROBO });
  const r = CAMP.criar(id, req.body || {}, req.user);
  if (r.ok) C.auditar(req.user, 'criou campanha', id, { loja: id, nome: r.ok.nome, clientes: r.ok.rodadas[0].lista.length, semMensagemParaComparar: r.ok.rodadas[0].lista.filter((x) => x.st === 'c').length });
  respCamp(res, r);
});
app.put('/api/campanhas/:id', express.json({ limit: '40kb' }), (req, res) => {
  const id = lojaCamp(req);
  if (!id) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const b = req.body || {};
  const antes = CAMP.ler(id).find((x) => x.id === req.params.id);
  if (!gestorCamp(req) && (b.robo || (antes && antes.robo && Object.keys(b).some((k) => !['loja', 'ativa', 'robo'].includes(k))))) return res.status(403).json({ erro: SO_GESTOR_ROBO });
  const r = CAMP.alterar(id, req.params.id, b);
  if (r.ok) {
    // mensagem ou critérios mudaram: a lista conferida para o robô deixa de valer (a tela confere de novo ao abrir a campanha)
    if (['mensagem', 'variacoes', 'filtros', 'porMotivo'].some((k) => k in b)) ZF.limparPreparo(id, req.params.id);
    // clientes tirados à mão: auditoria só com quantos (nunca o CPF)
    const nFora = (x) => ((x && x.filtros && x.filtros.fora) || []).length;
    if (antes && nFora(antes) !== nFora(r.ok)) C.auditar(req.user, 'campanha: mudou os clientes tirados à mão', id, { loja: id, nome: r.ok.nome, tirados: nFora(r.ok), saiuDosPendentes: r.tirados || 0 });
    if (antes && !!antes.robo !== !!r.ok.robo) C.auditar(req.user, r.ok.robo ? 'campanha: ligou o envio pelo robô' : 'campanha: tirou do robô', id, { loja: id, nome: r.ok.nome });
    if (antes && !!antes.comparar !== !!r.ok.comparar) C.auditar(req.user, r.ok.comparar ? 'campanha: ligou o grupo de comparação (10% sem mensagem)' : 'campanha: desligou o grupo de comparação', id, { loja: id, nome: r.ok.nome });
  }
  respCamp(res, r);
});
app.post('/api/campanhas/:id/rodadas', express.json({ limit: '600kb' }), (req, res) => {
  const id = lojaCamp(req);
  if (!id) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const r = CAMP.novaRodada(id, req.params.id, (req.body || {}).lista, req.user);
  if (r.repetida) return res.json({ ok: true, campanha: r.ok, repetida: true }); // a lista deste período já existia
  respCamp(res, r);
});
app.put('/api/campanhas/:id/rodadas/:rid', express.json({ limit: '600kb' }), (req, res) => {
  const id = lojaCamp(req);
  if (!id) return res.status(400).json({ erro: 'Escolha uma loja.' });
  respCamp(res, CAMP.refazerLista(id, req.params.id, req.params.rid, (req.body || {}).lista));
});
app.post('/api/campanhas/:id/marcar', express.json({ limit: '4kb' }), (req, res) => {
  const id = lojaCamp(req);
  if (!id) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const b = req.body || {};
  const r = CAMP.marcar(id, req.params.id, String(b.rodada || ''), String(b.cpf || ''), String(b.st || ''), req.user, b.motivo ? String(b.motivo) : null, b.v == null ? null : Number(b.v));
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json({ ok: true, item: r.ok });
});
// copiar para outras lojas (só as que a pessoa acessa): chega lá como "campanha recebida" para montar a lista
app.post('/api/campanhas/:id/copiar', express.json({ limit: '4kb' }), (req, res) => {
  const id = lojaCamp(req);
  if (!id) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const destinos = Array.isArray((req.body || {}).destinos) ? req.body.destinos.map(String) : [];
  if (destinos.some((d) => !req.lojas.some((l) => l.id === d))) return res.status(403).json({ erro: 'Você não tem acesso a uma das lojas escolhidas.' });
  const origem = req.lojas.find((l) => l.id === id);
  const r = CAMP.copiar(id, origem && origem.nome, req.params.id, destinos, req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'copiou campanha para outras lojas', id, { loja: id, destinos: r.ok });
  res.json({ ok: true, destinos: r.ok });
});
app.delete('/api/campanhas/copias/:cid', (req, res) => {
  const id = lojaCamp(req);
  if (!id) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const r = CAMP.descartarCopia(id, req.params.cid);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json({ ok: true });
});
app.delete('/api/campanhas/:id', (req, res) => {
  const id = lojaCamp(req);
  if (!id) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const r = CAMP.apagar(id, req.params.id);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'apagou campanha', id, { loja: id });
  res.json({ ok: true });
});

// ---------- robô do WhatsApp das campanhas: rotas /api/zap/* e o laço de envio (a cada ~30 s; sem ZAP_URL/ZAP_TOKEN nada roda) ----------
require('./src/zap-api').registrar(app, { podeClientes });
require('./src/push-api').registrar(app); // notificações no aparelho: cada pessoa só mexe nos próprios aparelhos
require('./src/errostela').registrar(app, { mapear: (ln) => { const m = obterBundle().mapa; let a = null; for (const x of m) { if (x[1] <= ln) a = x; else break; } return a ? { arq: a[0], ln: ln - a[1] + 1 } : null; } }); // erros de JavaScript das telas da loja (sem dado pessoal); admin e franqueado das lojas dele veem
const PUSH = require('./src/push');
require('./src/zaplaco').iniciar();
require('./src/conversas').iniciar(); // Clientes → Conversas: busca no serviço a cada 30 s (só loja com o WhatsApp conectado)
// o robô não depende de alguém abrir a tela Campanhas: o servidor refaz a lista conferida e cria a lista nova das
// recorrentes (src/zapauto.js roda a conta da própria tela com o mesmo pacote de dados de /api/dados de quem vê tudo)
require('./src/zapauto').iniciar({
  corpo: async (loja) => { const d = await pacote([loja], false, 'completo'); return { sig: d.etag, json: () => (d.buf || zlib.gunzipSync(d.gz)).toString('utf8') }; },
  disponivel: (id) => LOT.disponivel({ estoque: ES.atual(id), compras: ES.compras(id) }),
  // Campanha Resumo diário: os lotes de chá perto da validade (motivo "Chá dele perto da validade"), só nome e dias
  validade: (id) => ({ lotes: LOT.daLoja(id).lotes.map((l) => ({ desc: l.desc, dias: l.dias })) }),
});

// versão dos arquivos da tela (o hash automático do bundle): a aba aberta compara e oferece recarregar depois de uma atualização
app.get('/api/versao', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ v: obterBundle().v });
});
app.get('/api/eu', (req, res) => {
  const u = C.get().usuarios[req.user];
  res.json({
    usuario: req.user === '*' ? '' : req.user, nome: u?.nome || req.user, perfil: req.perfil, vendedor: req.vendedor || '',
    ambiente: C.homolog() ? 'homologacao' : 'producao', // HOMOLOG-01: a tela mostra a faixa amarela
    pode: { configurar: req.perfil === 'admin' || req.perfil === 'franqueado', admin: req.perfil === 'admin', clientes: podeClientes(req), robo: C.podeRobo(req), conversas: C.podeConversas(req), custos: podeTela(req, 'rentab', 'estoque', 'precos', 'notas', 'pedido', 'dre') },
    telas: C.telasDo(u),
    lojas: req.lojas.map((l) => ({ id: l.id, nome: l.nome, marca: { nome: (l.marca && l.marca.nome) || l.nome, logo: !!arquivoLogo(l.id) } })),
  });
});

app.get('/api/dados', async (req, res) => {
  // de quem são estes dados: o navegador só guarda/mostra se for a mesma pessoa da aba (outra pessoa pode ter entrado em outra aba)
  res.set('X-Painel-Usuario', req.user === '*' ? '' : String(req.user || ''));
  const pedido = String(req.query.loja || '');
  let lojas;
  if (pedido === 'todas') lojas = req.lojas;
  else lojas = req.lojas.filter((l) => l.id === pedido);
  if (!lojas.length) lojas = req.lojas.slice(0, 1);
  if (!lojas.length) return res.status(404).json({ erro: 'Nenhuma loja cadastrada ainda. Crie a primeira em Configurações.', semLojas: true });
  try {
    const perfilDados = req.perfil === 'vendedor' ? `vendedor:${req.vendedor}` : podeClientes(req) ? 'completo' : 'gerente';
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.desde || '')) ? String(req.query.desde) : null;
    // reler as planilhas na hora (atualizar=1) é pesado: a vendedora recebe o que já está carregado
    const d = await pacote(lojas, req.query.atualizar === '1' && req.perfil !== 'vendedor', perfilDados, desde);
    res.set('Cache-Control', 'no-store');
    res.set('ETag', d.etag);
    // nada mudou desde o último pedido: não manda tudo de novo
    if (req.get('If-None-Match') === d.etag) { res.set('X-Dados-Em', new Date(d.at).toISOString()); return res.status(304).end(); }
    res.set('X-Dados-Em', new Date(d.at).toISOString());
    if (d.stale) res.set('X-Dados-Aviso', encodeURIComponent(d.stale));
    res.set({ 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding' });
    const aceita = String(req.headers['accept-encoding'] || '');
    if (d.br && /\bbr\b/.test(aceita)) {
      res.set('Content-Encoding', 'br');
      return res.end(d.br);
    }
    if (d.gz && /\bgzip\b/.test(aceita)) {
      res.set('Content-Encoding', 'gzip');
      return res.end(d.gz);
    }
    res.end(d.buf || zlib.gunzipSync(d.gz));
  } catch (e) {
    console.error('[dados] erro:', e.message);
    res.status(502).json({ erro: C.msgErro(e) });
  }
});

// ---------- comparativo com a rede (anônimo) e alertas ----------
async function dadosParaIndicadores(loja) {
  const e = await dadosLoja(loja);
  return { id: loja.id, loja, vendas: e.raw.vendas, metaPlanilha: e.raw.metaPlanilha, xml: e.raw.xml, sig: e.sig };
}
const redeCache = new Map();
app.get('/api/rede', async (req, res) => {
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Sem permissão.' });
  const ym = String(req.query.ym || '');
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!/^\d{4}-\d{2}$/.test(ym) || !loja) return res.status(400).json({ erro: 'Escolha uma loja e um mês.' });
  try {
    const todas = C.get().lojas;
    const partes = [];
    for (const l of todas) { try { partes.push(await dadosParaIndicadores(l)); } catch { /* loja sem dados */ } }
    const chave = ym + '|' + loja.id + '|' + partes.map((p) => p.id + ':' + p.sig + ':' + JSON.stringify(p.loja.metas || {}) + (p.loja.meta ?? '')).join(',');
    let r = lruGet(redeCache, chave);
    if (!r) { r = IND.rede(partes, ym, loja.id); lruSet(redeCache, chave, r, 40); }
    res.set('Cache-Control', 'no-store');
    res.json(r);
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
// média da franquia nos gráficos de Vendas → Comparativos (anônima; mesmas regras do navegador)
const RCOMP = require('./src/redecomp');
const redeCompCache = new Map();
app.get('/api/rede/comparativos', async (req, res) => {
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  const de = Number(req.query.de), ate = Number(req.query.ate), tipo = String(req.query.tipo || '');
  if (!loja || !Number.isInteger(de) || !Number.isInteger(ate) || ate < de || ate - de > 4000 || !['dia', 'semana', 'mes'].includes(tipo)) return res.status(400).json({ erro: 'Pedido inválido.' });
  try {
    const partes = [];
    for (const l of C.get().lojas) { try { partes.push(await dadosParaIndicadores(l)); } catch { /* loja sem dados */ } }
    const chave = `${de}|${ate}|${tipo}|` + partes.map((p) => p.id + ':' + p.sig).join(',');
    let r = lruGet(redeCompCache, chave);
    if (!r) { r = RCOMP.comparativos(partes, de, ate, tipo); lruSet(redeCompCache, chave, r, 40); }
    res.set('Cache-Control', 'no-store');
    res.json(r);
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
app.get('/api/alertas', async (req, res) => {
  if (req.perfil === 'vendedor') return res.json({ alertas: [] });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.json({ alertas: [] });
  try { res.json({ alertas: IND.alertas(await dadosParaIndicadores(loja)) }); } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});

// ---------- meta de hoje (a vendedora vê a parte dela em Minha comissão; decisão do dono, 22/11/2026) ----------
// A conta é a da tela (src/metahoje.js, com contas.js e metadia.js). Só leitura. A vendedora recebe só a parte dela,
// nunca a meta da loja, o faturamento nem as colegas. Cache por loja, pela assinatura dos dados e pelo dia.
const MH = require('./src/metahoje');
const metaHojeCache = new Map();
app.get('/api/meta-hoje', async (req, res) => {
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(403).json({ erro: 'Sem permissão para esta loja.' });
  try {
    const d = await dadosParaIndicadores(loja);
    const hoje = IND.hojeSP().iso, chave = `${loja.id}|${d.sig}|${hoje}`;
    let r = lruGet(metaHojeCache, chave);
    if (r === undefined) { r = MH.calcular({ ...d, hoje }); lruSet(metaHojeCache, chave, r, 40); }
    res.set('Cache-Control', 'no-store');
    if (req.perfil === 'vendedor') return res.json(MH.daVendedora(r, req.vendedor));
    res.json(MH.completa(r));
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});

// ---------- fechamento do dia (substitui a planilha preenchida à mão) ----------
const FECH = require('./src/fechamento');
const DIA_OK = /^\d{4}-\d{2}-\d{2}$/;
app.get('/api/fechamento', async (req, res) => {
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try {
    const d = await dadosParaIndicadores(loja);
    const dia = DIA_OK.test(String(req.query.dia || '')) ? req.query.dia : FECH.ultimoDia(d.vendas, IND.hojeSP().iso);
    if (!dia) return res.json({ vazio: true });
    const f = FECH.calcular(d, dia);
    res.json({ ...f, html: FECH.html(f) });
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});

// ---------- confiança nos dados: conferência com o caixa, cupons cancelados e saúde das fontes ----------
// admin, franqueado e gerente com a tela Conferência; a vendedora nunca (mostra o faturamento da loja e o caixa por operador)
const CONF = require('./src/conferencia');
app.get('/api/conferencia', async (req, res) => {
  if (!podeTela(req, 'conferencia')) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try {
    const e = await dadosLoja(loja);
    res.set('Cache-Control', 'no-store');
    res.json({ ...CONF.daLoja(loja, e.raw.vendas, e.raw.canceladosFora || [], IND.hojeSP().iso), podeCfg: podeContabilidade(req) });
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
// tolerância da conferência e o que fazer com cupom cancelado (tirar das vendas muda a comissão): só admin e franqueado da loja
app.put('/api/conferencia/cfg', express.json({ limit: '2kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!podeContabilidade(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const antes = CONF.cfg(C.get().lojas.find((l) => l.id === loja.id));
  const v = CONF.validarCfg(req.body || {}, antes);
  if (v.erro) return res.status(400).json({ erro: v.erro });
  C.alterar((cfg) => { cfg.lojas.find((l) => l.id === loja.id).conferencia = v.ok; });
  if (antes.cancelados !== v.ok.cancelados) cacheLoja.delete(loja.id); // as vendas são relidas com (ou sem) os cupons cancelados
  C.auditar(req.user, v.ok.cancelados !== antes.cancelados ? (v.ok.cancelados === 'excluir' ? 'passou a TIRAR das vendas os cupons cancelados (muda meta e comissão)' : 'voltou a só avisar sobre cupons cancelados (continuam nas vendas)') : 'alterou a tolerância da conferência do caixa', loja.id, { loja: loja.id, antes, depois: v.ok });
  res.json({ ok: true, cfg: v.ok });
});

// ---------- estoque e custo (só admin e franqueado) ----------
const podeContabilidade = (req) => req.perfil === 'admin' || req.perfil === 'franqueado';
/** gerente com a tela liberada em Configurações → Usuários (Estoque e margem, Pedido, Resultado) */
const podeTela = (req, ...telas) => podeContabilidade(req) || (req.perfil === 'gerente' && (C.telasDo(C.usuario(req.user)) || []).some((t) => telas.includes(t)));
const ES = require('./src/estoque');
const TAB = require('./src/tabela'), FXM = require('./src/fixosmes');
app.get('/api/estoque', (req, res) => {
  if (!podeTela(req, 'rentab', 'estoque', 'precos', 'notas', 'pedido', 'dre')) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const lc = C.get().lojas.find((l) => l.id === loja.id);
  const est = ES.atual(loja.id);
  let foraDeLinha = null;
  try { foraDeLinha = PED.foraDeLinha(loja.id); } catch (e) { console.error('[fora de linha]', e.message); }
  // lista de espera: só a contagem por produto (sem nome de cliente), para o Estoque mostrar quem está zerado com cliente aguardando
  let espera = {};
  try { espera = Object.fromEntries(Object.entries(ESP.resumoPorCod(loja.id)).map(([c, x]) => [c, x.pedidos])); } catch (e) { console.error('[espera no estoque]', e.message); }
  // fixosMes: o valor real de cada custo fixo por mês, lançado no Resultado (src/fixosmes.js; a conta é TS.contas.fixoDoMes)
  res.json({ estoque: est, cfg: { ...ES.cfg(lc), fixosMes: FXM.ler(loja.id).despesas }, classe: ES.classeCfg(lc), tabela: TAB.resumo(loja.id), historico: ES.historico(loja.id), compras: ES.compras(loja.id), foraDeLinha, espera });
});
// notas de entrada (compras) do AppNext, inteiras: lista e detalhe na tela Preços
// NF-e emitidas pela loja (saída): lista, nota completa, XML original e DANFE para imprimir
const NFS = require('./src/nfsaida');
const lojaNfs = (req, res) => {
  if (!podeTela(req, 'notas')) { res.status(403).json({ erro: 'Sem permissão.' }); return null; }
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  return loja;
};
// ---------- devolução ao fornecedor (a partir de uma nota de entrada): planilha, fotos e e-mail ----------
const DEV = require('./src/devolucao');
const lojaDev = (req, res) => {
  if (!podeTela(req, 'notas', 'precos')) { res.status(403).json({ erro: 'Sem permissão.' }); return null; }
  const loja = req.lojas.find((l) => l.id === String((req.body && req.body.loja) || req.query.loja || ''));
  if (!loja) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  return loja;
};
/** sincroniza a devolução com o XML da NF-e de saída (autorizada ou cancelada no AppNext) */
function sincronizarNfDevolucao(loja, d) {
  if (!d || !d.nfe) return d;
  if (d.nfe.chave) {
    const arq = NFS.achar(loja.id, d.nfe.chave);
    if (!arq) return d;
    const sit = arq.sit === 'cancelados' ? 'cancelada' : 'autorizada';
    const est = sit === 'cancelada' ? 'cancelada' : (d.nfe.estado === 'cancelada' ? 'ok' : d.nfe.estado);
    if (d.nfe.situacao !== sit || d.nfe.estado !== est) {
      return DEV.atualizar(loja.id, d.id, (x) => { x.nfe = { ...x.nfe, situacao: sit, estado: est }; }) || d;
    }
    return d;
  }
  const ref = d.nfe.chaveRef || (d.nota && d.nota.chave) || '';
  if (!ref) return d;
  const qtdDev = new Map();
  for (const i of d.itens || []) qtdDev.set(String(i.cod).toUpperCase(), (qtdDev.get(String(i.cod).toUpperCase()) || 0) + Number(i.qtd));
  const todas = NFS.lista(loja.id).notas.filter((n) => n.finalidade === 'Devolução' && (n.data || '') >= d.em.slice(0, 10) && (n.refs || []).includes(ref));
  // prioriza NF-e autorizada; se só houver cancelada para os mesmos itens, marca como cancelada
  const ordenada = [...todas.filter((n) => n.situacao !== 'cancelada'), ...todas.filter((n) => n.situacao === 'cancelada')];
  for (const c of ordenada) {
    const n = NFS.nota(loja.id, c.chave);
    const qtdNf = new Map();
    for (const i of (n && n.itens) || []) qtdNf.set(String(i.cod).toUpperCase(), (qtdNf.get(String(i.cod).toUpperCase()) || 0) + Number(i.qtd));
    const mesmosItens = qtdDev.size === qtdNf.size && [...qtdDev].every(([k, q]) => Math.abs((qtdNf.get(k) ?? -1) - q) < 1e-6);
    if (n && (n.refs || []).includes(ref) && mesmosItens) {
      const sit = c.situacao === 'cancelada' ? 'cancelada' : 'autorizada';
      return DEV.atualizar(loja.id, d.id, (x) => {
        x.nfe = { ...x.nfe, chaveRef: x.nfe.chaveRef || ref, chave: c.chave, numero: n.numero, serie: n.serie, situacao: sit, estado: sit === 'cancelada' ? 'cancelada' : 'ok', autorizadaEm: n.autorizadaEm || n.emissao };
      }) || d;
    }
  }
  return d;
}
/** NF-e de devolução já autorizada (o XML chegou pelo coletor): a que referencia a nota de entrada */
function acharNfDevolucao(loja, d) {
  const s = sincronizarNfDevolucao(loja, d);
  return s && s.nfe && s.nfe.chave && s.nfe.situacao !== 'cancelada' ? s.nfe.chave : null;
}
/** anexos da NF-e de devolução: XML original e DANFE em PDF (pelo Chromium do coletor; sem ele, o DANFE em HTML) */
async function anexosNf(loja, d) {
  const chave = acharNfDevolucao(loja, d);
  if (!chave) return [];
  const a = NFS.achar(loja.id, chave), n = NFS.nota(loja.id, chave);
  if (!a || !n) return [];
  const out = [{ filename: `NFe-devolucao-${n.numero}.xml`, path: a.arq }];
  const dir = DEV.pastaDev(loja.id, d.id);
  try {
    fs.writeFileSync(path.join(dir, 'danfe.html'), NFS.danfe(n));
    try { fs.unlinkSync(path.join(dir, 'danfe.pdf')); } catch { /* ok */ }
    const x = COL.ativo() ? await COL.pdf(loja.id, d.id) : { status: 0 };
    if (x.status === 200 && fs.existsSync(path.join(dir, 'danfe.pdf'))) out.push({ filename: `DANFE-devolucao-${n.numero}.pdf`, path: path.join(dir, 'danfe.pdf') });
    else out.push({ filename: `DANFE-devolucao-${n.numero}.html`, path: path.join(dir, 'danfe.html') });
  } catch (e) { console.error('[devolução] DANFE:', e.message); }
  return out;
}
const devEnviando = new Set();
/** manda o e-mail da devolução pelo Gmail da loja (ou o servidor geral), com a NF-e (PDF e XML), a planilha e as fotos */
async function enviarDevolucao(loja, d, forcarReenvio = false) {
  if (!d) return d;
  const chaveLock = `${loja.id}:${d.id}`;
  if (devEnviando.has(chaveLock)) return DEV.ler(loja.id, d.id) || d;
  devEnviando.add(chaveLock);
  try {
    const fresco = DEV.ler(loja.id, d.id) || d;
    if (!forcarReenvio && fresco.email && fresco.email.estado === 'enviado') return fresco;
    d = fresco;
    const para = DEV.destinatarios(loja.id);
    if (!para.length) return DEV.atualizar(loja.id, d.id, (x) => { x.email = { estado: 'sem_destinatarios' }; });
    const NOTIF = require('./src/notificacoes');
    const cfg = NOTIF.ler();
    const lc = (cfg.lojas || {})[loja.id];
    const smtp = lc && lc.email && lc.email.host ? lc.email : cfg.email;
    const nome = (loja.marca && loja.marca.nome) || loja.nome;
    try {
      const xlsx = await DEV.planilha(loja.id, d, nome);
      const anexos = [...await anexosNf(loja, d), { filename: `devolucao-NF${d.nota.nf}.xlsx`, content: xlsx }];
      d = DEV.ler(loja.id, d.id) || d; // acharNfDevolucao pode ter guardado o número da nota
      d.itens.forEach((it, n) => { for (let k = 0; k < it.fotos; k++) anexos.push({ filename: `NF${d.nota.nf}-${it.cod}-foto${k + 1}.jpg`, path: DEV.arqFoto(loja.id, d.id, n, k) }); });
      await NOTIF.enviarEmail(para.join(', '), DEV.montarAssunto(loja.id, d, nome), DEV.textoEmail(d, nome), null, smtp, anexos);
      return DEV.atualizar(loja.id, d.id, (x) => { x.email = { estado: 'enviado', em: new Date().toISOString(), para, comNota: !!(x.nfe && x.nfe.chave && x.nfe.situacao !== 'cancelada') }; });
    } catch (e) {
      return DEV.atualizar(loja.id, d.id, (x) => { x.email = { estado: 'erro', erro: String(e.message || e).slice(0, 300), em: new Date().toISOString() }; });
    }
  } finally {
    devEnviando.delete(chaveLock);
  }
}
/** pede ao robô a NF-e de devolução (gravada no AppNext sem concluir) */
async function nfeDevolucao(loja, d, por, simular, emitir) {
  if (!COL.ativo()) return DEV.erroNfe(loja.id, d.id, 'o coletor não está ligado nesta VPS');
  const p = DEV.pedirNfe(loja.id, d, simular, emitir);
  if (p.erro && emitir) return { erroPedido: p.erro };
  if (p.erro) return DEV.erroNfe(loja.id, d.id, p.erro);
  try {
    const x = await COL.nfe(loja.id, d.id, 'devolucao', por);
    if (x.status >= 400) return DEV.erroNfe(loja.id, d.id, (x.json && x.json.erro) || 'o coletor recusou');
  } catch (e) { return DEV.erroNfe(loja.id, d.id, 'sem resposta do coletor'); }
  C.auditar(por, emitir ? 'mandou EMITIR a NF-e de devolução (concluir e transmitir à SEFAZ)' : simular ? 'pediu teste da NF-e de devolução (sem salvar)' : 'pediu a NF-e de devolução no AppNext', loja.id, { loja: loja.id, nf: d.nota.nf, total: emitir ? d.nfe && d.nfe.total : undefined });
  return DEV.ler(loja.id, d.id);
}
app.get('/api/devolucoes', async (req, res) => {
  const loja = lojaDev(req, res); if (!loja) return;
  let ds = DEV.lista(loja.id).slice(0, 50).map((d) => sincronizarNfDevolucao(loja, DEV.conferirNfe(loja.id, d)));
  // pedido perdido (o coletor reiniciou com ele na fila): vira erro
  if (ds.some((d) => d.nfe && d.nfe.estado === 'na_fila') && COL.ativo()) {
    let robo = null; try { robo = (await COL.status(loja.id)).nfe; } catch { /* ok */ }
    const parado = !robo || (robo.estado !== 'na_fila' && robo.estado !== 'rodando');
    ds = ds.map((d) => (d && d.nfe && d.nfe.estado === 'na_fila' && parado && Date.now() - Date.parse(d.nfe.em) > 20000
      ? DEV.erroNfe(loja.id, d.id, robo && robo.ultima && robo.ultima.id === d.id ? `o robô terminou sem confirmar (código ${robo.ultima.codigo})` : 'o pedido se perdeu (o coletor reiniciou); peça de novo') : d));
    ds.forEach((d) => { if (d.nfe && d.nfe.estado === 'na_fila' && robo && robo.id === d.id) d.nfe.robo = { estado: robo.estado, aoVivo: robo.aoVivo || null }; });
  }
  // erro: o log do robô da última vez (se foi desta devolução)
  if (ds.some((d) => d && d.nfe && d.nfe.estado === 'erro') && COL.ativo()) {
    let robo = null; try { robo = (await COL.status(loja.id)).nfe; } catch { /* ok */ }
    const u = robo && robo.ultima;
    if (u && u.log) ds.forEach((d) => { if (d && d.nfe && (d.nfe.estado === 'erro' || d.nfe.estado === 'concluida') && u.id === d.id) d.nfe.log = u.log; });
  }
  // a NF-e de devolução foi autorizada (o XML chegou)? manda o e-mail que estava esperando
  for (let k = 0; k < ds.length; k++) if (ds[k] && ds[k].email && ds[k].email.estado === 'aguardando_nf' && ds[k].nfe && ds[k].nfe.estado === 'ok' && acharNfDevolucao(loja, ds[k])) ds[k] = await enviarDevolucao(loja, DEV.ler(loja.id, ds[k].id));
  res.json({ devolucoes: ds, destinatarios: DEV.destinatarios(loja.id), assunto: DEV.assunto(loja.id) });
});
// de tempos em tempos: devoluções esperando a NF-e autorizada para mandar o e-mail
let devCiclo = false;
setInterval(async () => {
  if (devCiclo) return;
  devCiclo = true;
  try {
    for (const loja of C.get().lojas) {
      try {
        for (const d of DEV.lista(loja.id).slice(0, 30)) {
          const s = sincronizarNfDevolucao(loja, d);
          if (s.email && s.email.estado === 'aguardando_nf' && s.nfe && s.nfe.estado === 'ok' && acharNfDevolucao(loja, s)) await enviarDevolucao(loja, DEV.ler(loja.id, s.id));
        }
      } catch (e) { console.error(`[devolução] ${loja.id}:`, e.message); }
    }
  } finally { devCiclo = false; }
}, 10 * 60e3).unref();
app.get('/api/devolucoes/:id/planilha', async (req, res) => {
  const loja = lojaDev(req, res); if (!loja) return;
  const d = DEV.ler(loja.id, String(req.params.id));
  if (!d) return res.status(404).json({ erro: 'Devolução não encontrada.' });
  const buf = await DEV.planilha(loja.id, d, (loja.marca && loja.marca.nome) || loja.nome);
  res.set('Content-Disposition', `attachment; filename="devolucao-NF${String(d.nota.nf).replace(/\W/g, '')}.xlsx"`);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf);
});
app.get('/api/devolucoes/:id/foto/:n/:k', (req, res) => {
  const loja = lojaDev(req, res); if (!loja) return;
  const f = DEV.arqFoto(loja.id, String(req.params.id), req.params.n, req.params.k);
  if (!f || !fs.existsSync(f)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=3600');
  res.type('image/jpeg').sendFile(f);
});
app.use('/api/devolucoes', (req, res, next) => (req.method === 'GET' || req.get('X-Painel') === '1' ? next() : res.status(403).json({ erro: 'Pedido inválido.' })));
app.put('/api/devolucoes/destinatarios', express.json({ limit: '4kb' }), (req, res) => {
  // para quem vai o e-mail da franquia/fornecedor: só admin e franqueado (o gerente registra a devolução, mas não muda o destino)
  if (!(req.perfil === 'admin' || req.perfil === 'franqueado')) return res.status(403).json({ erro: 'Só o admin ou o franqueado muda os destinatários.' });
  const loja = lojaDev(req, res); if (!loja) return;
  const b = req.body || {};
  const r = DEV.salvarDestinatarios(loja.id, b.emails);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  const assunto = b.assunto != null ? DEV.salvarAssunto(loja.id, b.assunto) : DEV.assunto(loja.id);
  C.auditar(req.user, 'alterou o e-mail das devoluções', loja.id, { loja: loja.id, emails: r.ok.length });
  res.json({ ok: true, destinatarios: r.ok, assunto });
});
app.post('/api/devolucoes', express.json({ limit: '12mb' }), async (req, res) => {
  const loja = lojaDev(req, res); if (!loja) return;
  const b = req.body || {};
  const nota = ((ES.notas(loja.id) || {}).notas || []).find((n) => String(n.id) === String(b.notaId) && String(n.nf) === String(b.nf));
  const r = DEV.criar(loja.id, nota, b, req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'registrou devolução ao fornecedor', loja.id, { loja: loja.id, nf: r.ok.nota.nf, itens: r.ok.itens.length });
  // o e-mail espera a NF-e de devolução ser autorizada (vai com o PDF e o XML); o robô grava a nota agora
  DEV.atualizar(loja.id, r.ok.id, (x) => { x.email = { estado: 'aguardando_nf' }; });
  const d = await nfeDevolucao(loja, DEV.ler(loja.id, r.ok.id), req.user, false);
  res.json({ ok: true, devolucao: d });
});
app.post('/api/devolucoes/:id/nfe', express.json({ limit: '1kb' }), async (req, res) => {
  const loja = lojaDev(req, res); if (!loja) return;
  const d = DEV.ler(loja.id, String(req.params.id));
  if (!d) return res.status(404).json({ erro: 'Devolução não encontrada.' });
  if (d.nfe && (d.nfe.estado === 'na_fila' || d.nfe.estado === 'concluida' || (d.nfe.estado === 'ok' && d.nfe.situacao !== 'cancelada'))) return res.status(409).json({ erro: d.nfe.estado === 'ok' ? 'A NF-e desta devolução já foi gravada no AppNext.' : d.nfe.estado === 'concluida' ? 'A saída já foi concluída no AppNext: homologue lá.' : 'O robô já está cuidando desta devolução.' });
  const b = req.body || {};
  const r = await nfeDevolucao(loja, d, req.user, !!b.simular, !!b.emitir);
  if (r && r.erroPedido) return res.status(400).json({ erro: r.erroPedido });
  res.json({ ok: true, devolucao: r });
});
app.post('/api/devolucoes/:id/reenviar', express.json({ limit: '1kb' }), async (req, res) => {
  const loja = lojaDev(req, res); if (!loja) return;
  const d = DEV.ler(loja.id, String(req.params.id));
  if (!d) return res.status(404).json({ erro: 'Devolução não encontrada.' });
  res.json({ ok: true, devolucao: await enviarDevolucao(loja, d, true) });
});
app.delete('/api/devolucoes/:id', (req, res) => {
  const loja = lojaDev(req, res); if (!loja) return;
  const d = DEV.ler(loja.id, String(req.params.id));
  if (!d) return res.status(404).json({ erro: 'Devolução não encontrada.' });
  if (d.nfe && d.nfe.estado === 'na_fila') return res.status(409).json({ erro: 'O robô está gravando esta devolução agora; aguarde terminar antes de excluir.' });
  DEV.excluir(loja.id, d.id);
  C.auditar(req.user, 'excluiu registro de devolução', loja.id, { loja: loja.id, id: d.id, nf: d.nota && d.nota.nf });
  res.json({ ok: true });
});
// ---------- nova NF-e de saída: o robô preenche no AppNext e salva como RASCUNHO (a loja confere e transmite) ----------
const NFE = require('./src/nfe');
const lojaNfe = (req, res) => {
  if (!podeTela(req, 'notas')) { res.status(403).json({ erro: 'Sem permissão.' }); return null; }
  const loja = req.lojas.find((l) => l.id === String((req.body && req.body.loja) || req.query.loja || ''));
  if (!loja) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  return loja;
};
app.get('/api/nfe', async (req, res) => {
  const loja = lojaNfe(req, res); if (!loja) return;
  const { lista, mudou } = NFE.conferir(loja.id);
  for (const r of mudou) C.auditar(r.por || 'sistema', r.estado === 'ok' ? 'robô salvou rascunho de NF-e no AppNext' : r.estado === 'teste' ? 'robô testou uma NF-e (nada salvo)' : r.estado === 'autorizada' ? 'robô emitiu NF-e (autorizada pela SEFAZ)' : r.estado === 'concluida' ? 'robô concluiu a NF-e mas ela não foi autorizada' : 'robô não conseguiu salvar o rascunho de NF-e', loja.id, { loja: loja.id, parceiro: r.parceiro.nome, total: r.total, nfe: r.nfe || null, erro: r.erro || null });
  // NF-e autorizada: pede ao coletor o XML do dia para ela aparecer em Notas de saída (DANFE e XML); ocupado → vem na próxima coleta
  for (const r of mudou) if (r.estado === 'autorizada' && COL.ativo()) {
    const hoje = C.hojeBR();
    try { const x = await COL.historico(loja.id, [{ de: hoje, ate: hoje }], r.por || 'sistema', 'xml'); NFE.marcarXml(loja.id, r.id, x.status === 200 ? 'pedido' : 'proxima'); } catch { NFE.marcarXml(loja.id, r.id, 'proxima'); }
  }
  let robo = null;
  if (COL.ativo()) { try { robo = (await COL.status(loja.id)).nfe; } catch { /* ok */ } }
  // pedido perdido (o coletor reiniciou com ele na fila): vira erro
  const parado = !robo || (robo.estado !== 'na_fila' && robo.estado !== 'rodando');
  for (const r of lista) if (r.estado === 'na_fila' && parado && Date.now() - Date.parse(r.em) > 20000) { NFE.erro(loja.id, r.id, robo && robo.ultima && robo.ultima.id === r.id ? `o robô terminou sem confirmar (código ${robo.ultima.codigo})` : 'o pedido se perdeu (o coletor reiniciou); crie de novo'); }
  const cp = NFE.conferirParceiros(loja.id);
  for (const r of cp.mudou) C.auditar(r.por || 'sistema', r.estado === 'ok' ? 'robô cadastrou parceiro no AppNext' : r.estado === 'teste' ? 'robô testou o cadastro de parceiro (nada salvo)' : 'robô não conseguiu cadastrar o parceiro', loja.id, { loja: loja.id, tipo: r.tipo, nome: r.nome, erro: r.erro || null });
  for (const r of cp.lista) if (r.estado === 'na_fila' && parado && Date.now() - Date.parse(r.em) > 20000) NFE.erroParceiro(loja.id, r.id, robo && robo.ultima && robo.ultima.id === r.id ? `o robô terminou sem confirmar (código ${robo.ultima.codigo})` : 'o pedido se perdeu (o coletor reiniciou); peça de novo');
  const cad = NFE.cadastros(loja.id);
  // estoque da última planilha do AppNext: a tela avisa na hora o produto da nota sem estoque suficiente (o AppNext recusa ao concluir)
  const est = ES.atual(loja.id);
  const estoque = est && est.itens ? { em: est.em, qtd: Object.fromEntries(est.itens.map((i) => [String(i.cod), Number(i.qtd) || 0])) } : null;
  // a nota emitida já tem XML guardado? (então a linha mostra DANFE e XML)
  let rascunhos = NFE.lista(loja.id).slice(0, 100);
  if (rascunhos.some((r) => r.nfe && r.nfe.chave)) { const tem = NFS.chaves(loja.id); rascunhos = rascunhos.map((r) => (r.nfe && r.nfe.chave ? { ...r, temXml: tem.has(r.nfe.chave) } : r)); }
  res.json({ cadastros: cad, erroCadastros: NFE.erroCadastros(loja.id), rascunhos, parceiros: NFE.listaParceiros(loja.id).slice(0, 10), robo, podeRobo: COL.ativo(), estoque });
});
app.use('/api/nfe', (req, res, next) => (req.method === 'GET' || req.get('X-Painel') === '1' ? next() : res.status(403).json({ erro: 'Pedido inválido.' })));
app.post('/api/nfe/cadastros', express.json({ limit: '2kb' }), async (req, res) => {
  const loja = lojaNfe(req, res); if (!loja) return;
  if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS.' });
  NFE.prepararCadastros(loja.id);
  try {
    const x = await COL.nfe(loja.id, 'cadastros', 'cadastros', req.user);
    if (x.status >= 400) return res.status(x.status === 409 ? 409 : 400).json({ erro: (x.json && x.json.erro) || 'O coletor recusou.' });
  } catch (e) { return res.status(502).json({ erro: 'Não consegui falar com o coletor: ' + C.msgErro(e) }); }
  res.json({ ok: true });
});
// emitir a NF-e de venda: a partir de um teste conferido (o robô conclui e homologa; confere se o total é o do teste)
app.post('/api/nfe/emitir', express.json({ limit: '2kb' }), async (req, res) => {
  const loja = lojaNfe(req, res); if (!loja) return;
  if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS.' });
  const r = NFE.emitir(loja.id, String((req.body || {}).id || ''), req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  try {
    const x = await COL.nfe(loja.id, r.ok.id, 'rascunho', req.user);
    if (x.status >= 400) { const erro = (x.json && x.json.erro) || 'O coletor recusou.'; NFE.erro(loja.id, r.ok.id, erro); return res.status(x.status === 409 ? 409 : 400).json({ erro }); }
  } catch (e) { NFE.erro(loja.id, r.ok.id, 'sem resposta do coletor'); return res.status(502).json({ erro: 'Não consegui falar com o coletor: ' + C.msgErro(e) }); }
  C.auditar(req.user, 'mandou EMITIR NF-e de venda (concluir e transmitir à SEFAZ)', loja.id, { loja: loja.id, parceiro: r.ok.parceiro.nome, itens: r.ok.itens.length, total: r.ok.totalAppNext ?? r.ok.total });
  res.json({ ok: true, rascunho: r.ok });
});
// parceiro novo: o robô cadastra em Parceiros → Cadastrar do AppNext (só com o clique e a confirmação de quem pediu)
// consulta pública de CNPJ e CEP (BrasilAPI) para preencher parceiro e cliente do orçamento; vendedora não usa
async function consultaBR(req, res, fn, chaveResp) {
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Sem permissão.' });
  if (tooMany('br:' + req.user, 60)) return res.status(429).json({ erro: 'Muitas consultas em pouco tempo. Espere alguns minutos.' });
  falhou('br:' + req.user);
  try {
    const r = await fn();
    if (!r) return res.status(404).json({ erro: chaveResp === 'empresa' ? 'CNPJ não encontrado na Receita.' : 'CEP não encontrado.' });
    res.json({ [chaveResp]: r });
  } catch (e) { res.status(e instanceof BR.ErroBR ? e.status : 502).json({ erro: e instanceof BR.ErroBR ? e.message : 'Falha na consulta.' }); }
}
app.get('/api/brasil/cnpj/:doc', (req, res) => consultaBR(req, res, () => BR.cnpj(req.params.doc), 'empresa'));
app.get('/api/brasil/cep/:cep', (req, res) => consultaBR(req, res, () => BR.cep(req.params.cep), 'endereco'));

app.post('/api/nfe/parceiro', express.json({ limit: '4kb' }), async (req, res) => {
  const loja = lojaNfe(req, res); if (!loja) return;
  if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS.' });
  const r = NFE.criarParceiro(loja.id, req.body || {}, req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  try {
    const x = await COL.nfe(loja.id, r.ok.id, 'parceiro', req.user);
    if (x.status >= 400) { const erro = (x.json && x.json.erro) || 'O coletor recusou.'; NFE.erroParceiro(loja.id, r.ok.id, erro); return res.status(x.status === 409 ? 409 : 400).json({ erro }); }
  } catch (e) { NFE.erroParceiro(loja.id, r.ok.id, 'sem resposta do coletor'); return res.status(502).json({ erro: 'Não consegui falar com o coletor: ' + C.msgErro(e) }); }
  C.auditar(req.user, r.ok.simular ? 'pediu teste de cadastro de parceiro no AppNext (sem salvar)' : 'pediu cadastro de parceiro no AppNext', loja.id, { loja: loja.id, tipo: r.ok.tipo, nome: r.ok.nome });
  res.json({ ok: true, parceiro: r.ok });
});
app.post('/api/nfe/rascunho', express.json({ limit: '30kb' }), async (req, res) => {
  const loja = lojaNfe(req, res); if (!loja) return;
  if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS.' });
  const r = NFE.criar(loja.id, req.body || {}, req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  try {
    const x = await COL.nfe(loja.id, r.ok.id, 'rascunho', req.user);
    if (x.status >= 400) { const erro = (x.json && x.json.erro) || 'O coletor recusou.'; NFE.erro(loja.id, r.ok.id, erro); return res.status(x.status === 409 ? 409 : 400).json({ erro }); }
  } catch (e) { NFE.erro(loja.id, r.ok.id, 'sem resposta do coletor'); return res.status(502).json({ erro: 'Não consegui falar com o coletor: ' + C.msgErro(e) }); }
  C.auditar(req.user, r.ok.simular ? 'pediu teste de NF-e no AppNext (sem salvar)' : 'pediu rascunho de NF-e no AppNext', loja.id, { loja: loja.id, parceiro: r.ok.parceiro.nome, itens: r.ok.itens.length, total: r.ok.total });
  res.json({ ok: true, rascunho: r.ok });
});
app.get('/api/nfsaida', (req, res) => { const l = lojaNfs(req, res); if (l) res.json(NFS.lista(l.id)); });
app.get('/api/nfsaida/nota', (req, res) => { const l = lojaNfs(req, res); if (!l) return; const n = NFS.nota(l.id, String(req.query.chave || '')); if (!n) return res.status(404).json({ erro: 'Nota não encontrada.' }); res.json(n); });
app.get('/api/nfsaida/xml', (req, res) => {
  const l = lojaNfs(req, res); if (!l) return;
  const a = NFS.achar(l.id, String(req.query.chave || ''));
  if (!a) return res.status(404).json({ erro: 'Nota não encontrada.' });
  res.set('Content-Disposition', `attachment; filename="NFe${a.chave}.xml"`).type('application/xml').sendFile(a.arq);
});
app.get('/api/nfsaida/danfe', (req, res) => {
  const l = lojaNfs(req, res); if (!l) return;
  const n = NFS.nota(l.id, String(req.query.chave || ''));
  if (!n) return res.status(404).type('text/plain; charset=utf-8').send('Nota não encontrada.');
  res.type('html').send(NFS.danfe(n));
});
app.get('/api/estoque/notas', (req, res) => {
  if (!podeTela(req, 'rentab', 'estoque', 'precos', 'notas', 'pedido', 'dre')) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  res.json(ES.notas(loja.id) || { notas: [] });
});
// conta com a franquia: devoluções a receber × desconto nas notas de compra (admin, franqueado e gerente com Notas fiscais)
const CF = require('./src/contafranquia');
const lojaCF = (req, res, corpo) => {
  if (!podeTela(req, 'notas')) { res.status(403).json({ erro: 'Sem permissão.' }); return null; }
  const id = String((corpo && req.body && req.body.loja) || req.query.loja || ''); // corpo ou endereço
  const loja = req.lojas.find((l) => l.id === id);
  if (!loja) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  return loja;
};
const premiosDaLoja = (loja, compras) => {
  const FIn = require('./src/fidelidade'), ESPn = require('./src/espera');
  const fx = FIn.eventos(loja.id); // { em, eventos, cadastros }
  const evs = (fx && Array.isArray(fx.eventos) ? fx.eventos : Array.isArray(fx) ? fx : []);
  const proprios = FIn.nomesProprios(evs);
  const estoque = ES.atual(loja.id);
  return CF.contaPremios(loja.id, { eventos: evs.filter((e) => e.tipo === 'resgate' && (!e.loja || proprios.has(e.loja))), estoque, compras, codsDe: (nome) => ESPn.codsEstoque({ desc: nome }, estoque) });
};
const contaDaLoja = (loja) => {
  const compras = (ES.notas(loja.id) || { notas: [] }).notas;
  // os prêmios de fidelidade nunca derrubam a tela das devoluções
  let fidelidade = null;
  try { fidelidade = premiosDaLoja(loja, compras); } catch (e) { console.error('[conta-franquia] prêmios:', e.message); fidelidade = { erro: 'Não deu para calcular os prêmios de fidelidade.', meses: [], resumo: {} }; }
  return { ...CF.conta(loja.id, { saidas: NFS.lista(loja.id).notas, compras, devsPainel: DEV.lista(loja.id) }), fidelidade };
};
app.post('/api/conta-franquia/royalties', express.json({ limit: '5kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const loja = lojaCF(req, res, true); if (!loja) return;
  const r = CF.royalties(loja.id, req.body || {}, req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, req.body.tipo === 'apagar' ? 'apagou desconto nos royalties (fidelidade)' : 'lançou desconto nos royalties (fidelidade)', loja.id, { loja: loja.id, ref: req.body.ref || null, premios: req.body.premios || null, valor: req.body.valor || null });
  res.json(contaDaLoja(loja));
});
// cobrança à franquia por e-mail: rascunho (para revisar) e envio (só com clique e confirmação; fica registrado)
const COB = require('./src/cobranca');
const nomeLojaCF = (loja) => (loja.marca && loja.marca.nome) || loja.nome;
const rascunhoCob = (loja, b) => {
  const conta = contaDaLoja(loja);
  const r = COB.montar(b.tipo === 'fidelidade' ? 'fidelidade' : 'devolucoes', { conta, fid: conta.fidelidade, ids: Array.isArray(b.ids) ? b.ids : null, meses: Array.isArray(b.meses) ? b.meses : null, nomeLoja: nomeLojaCF(loja) });
  return { conta, r };
};
app.post('/api/conta-franquia/email/previa', express.json({ limit: '10kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!(req.perfil === 'admin' || req.perfil === 'franqueado')) return res.status(403).json({ erro: 'Só o admin ou o franqueado fala com a franquia.' }); // D-06
  const loja = lojaCF(req, res, true); if (!loja) return;
  const tipo = req.body.tipo === 'fidelidade' ? 'fidelidade' : 'devolucoes';
  const { r } = rascunhoCob(loja, req.body);
  const para = COB.emails(loja.id, tipo) || DEV.destinatarios(loja.id);
  const ult = COB.historico(loja.id).find((x) => x.tipo === tipo) || null;
  res.json({ ...r, para, ultima: ult, anexos: tipo === 'fidelidade' ? ['planilha com a relação dos resgates (.xlsx)'] : r.itens.map(() => null).length ? ['XML de cada nota de devolução'] : [] });
});
/** monta e envia a cobrança (pela tela ou pelo agendamento); devolve { ok, itens, total } ou { erro } */
async function enviarCobranca(loja, tipo, b, por) {
  const p = COB.validarPara(b.para);
  if (p.erro) return { erro: p.erro };
  const { conta, r } = rascunhoCob(loja, { ...b, tipo });
  if (!r.itens.length) return { erro: 'Nada para cobrar.', vazio: true };
  const assunto = String(b.assunto || r.assunto).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  const mensagem = String(b.mensagem ?? r.mensagem).slice(0, 5000);
  const NOTIF = require('./src/notificacoes');
  const cfgN = NOTIF.ler();
  const lc = (cfgN.lojas || {})[loja.id];
  const smtp = lc && lc.email && lc.email.host ? lc.email : cfgN.email;
  const anexos = [];
  try {
    if (tipo === 'fidelidade') {
      anexos.push({ filename: `premios-fidelidade-${loja.id}.xlsx`, content: Buffer.from(await COB.planilhaFidelidade(conta.fidelidade, r.itens, nomeLojaCF(loja))) });
    } else {
      for (const c of conta.creditos.filter((x) => r.itens.includes(x.id) && x.xml)) {
        const a = NFS.achar(loja.id, c.id);
        if (a) anexos.push({ filename: `NFe-devolucao-${c.numero}.xml`, path: a.arq });
      }
    }
    await NOTIF.enviarEmail(p.ok.join(', '), assunto, `${mensagem}\n\n${r.tabelaTexto}`, COB.html(mensagem, r.tabelaHtml), smtp, anexos);
  } catch (e) { return { erro: 'O e-mail não saiu: ' + (e.message || e) }; }
  COB.registrar(loja.id, tipo, p.ok, r.itens, r.total, por);
  C.auditar(por, (tipo === 'fidelidade' ? 'enviou cobrança à franquia (prêmios de fidelidade)' : 'enviou cobrança à franquia (devoluções)') + (por === 'agendado' ? ' — automático' : ''), loja.id, { loja: loja.id, para: p.ok, itens: r.itens, total: r.total });
  return { ok: true, para: p.ok, itens: r.itens, total: r.total };
}
app.post('/api/conta-franquia/email/enviar', express.json({ limit: '20kb' }), async (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!(req.perfil === 'admin' || req.perfil === 'franqueado')) return res.status(403).json({ erro: 'Só o admin ou o franqueado fala com a franquia.' }); // D-06
  const loja = lojaCF(req, res, true); if (!loja) return;
  const tipo = req.body.tipo === 'fidelidade' ? 'fidelidade' : 'devolucoes';
  let x;
  try { x = await enviarCobranca(loja, tipo, req.body, req.user); } catch (e) { console.error('[cobrança]', e); return res.status(500).json({ erro: 'Erro ao montar a cobrança: ' + C.msgErro(e) }); }
  if (x.erro) return res.status(x.vazio ? 400 : 502).json({ erro: x.erro });
  res.json({ ok: true, para: x.para, historico: COB.historico(loja.id).slice(0, 20) });
});
// reajuste de custo numa nota de entrada → e-mail para a franquia (admin e franqueado; revisado e enviado com um clique)
const podeReajuste = (req) => req.perfil === 'admin' || req.perfil === 'franqueado';
app.get('/api/reajuste/para', (req, res) => {
  if (!podeReajuste(req)) return res.status(403).json({ erro: 'Só o admin ou o franqueado fala com a franquia.' });
  const loja = lojaCF(req, res); if (!loja) return;
  res.json({ para: COB.emails(loja.id, 'reajuste') || DEV.destinatarios(loja.id) || [], loja: nomeLojaCF(loja) });
});
app.post('/api/reajuste/enviar', express.json({ limit: '16mb' }), async (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!podeReajuste(req)) return res.status(403).json({ erro: 'Só o admin ou o franqueado fala com a franquia.' });
  const loja = lojaCF(req, res, true); if (!loja) return;
  const b = req.body || {};
  const p = COB.validarPara(b.para);
  if (p.erro) return res.status(400).json({ erro: p.erro });
  const it = COB.conferirItensReajuste(b.itens);
  if (it.erro) return res.status(400).json({ erro: it.erro });
  const assunto = String(b.assunto || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (!assunto) return res.status(400).json({ erro: 'Escreva o assunto.' });
  const mensagem = String(b.mensagem || '').slice(0, 5000);
  const graficos = COB.conferirGraficos(b.graficos, it.ok);
  const t = COB.tabelaReajuste(it.ok, graficos);
  const anexos = graficos.map((g) => ({ filename: `historico-${g.cod || 'produto'}.png`, content: g.buf, contentType: 'image/png', cid: g.cid }));
  const NOTIF = require('./src/notificacoes');
  const cfgN = NOTIF.ler();
  const lc = (cfgN.lojas || {})[loja.id];
  const smtp = lc && lc.email && lc.email.host ? lc.email : cfgN.email;
  if (!smtp || !smtp.host) return res.status(400).json({ erro: 'A loja ainda não tem o e-mail configurado (Configurações → Lojas).' });
  try { await NOTIF.enviarEmail(p.ok.join(', '), assunto, `${mensagem}\n\n${t.tabelaTexto}`, COB.html(mensagem, t.tabelaHtml), smtp, anexos.length ? anexos : null); } catch (e) { return res.status(502).json({ erro: 'O e-mail não saiu: ' + (e.message || e) }); }
  const nf = String(b.nf || '').slice(0, 30);
  COB.registrar(loja.id, 'reajuste', p.ok, it.ok.map((x) => x.cod || x.nome), 0, req.user);
  C.auditar(req.user, 'enviou à franquia reclamação de reajuste de custo', loja.id, { loja: loja.id, nf, para: p.ok, graficos: graficos.length, itens: it.ok.map((x) => `${x.nome}: ${x.antes} → ${x.depois}`) });
  res.json({ ok: true, para: p.ok });
});
// envio automático todo mês (ligado em Configurações → Mensagens)
app.get('/api/conta-franquia/auto', (req, res) => {
  if (!(req.perfil === 'admin' || req.perfil === 'franqueado')) return res.status(403).json({ erro: 'Só o admin ou o franqueado fala com a franquia.' }); // D-06
  const loja = lojaCF(req, res); if (!loja) return;
  res.json({ ...COB.auto(loja.id), para: { devolucoes: COB.emails(loja.id, 'devolucoes') || DEV.destinatarios(loja.id), fidelidade: COB.emails(loja.id, 'fidelidade') || DEV.destinatarios(loja.id) } });
});
app.put('/api/conta-franquia/auto', express.json({ limit: '5kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!(req.perfil === 'admin' || req.perfil === 'franqueado')) return res.status(403).json({ erro: 'Só o admin ou o franqueado liga o envio automático.' });
  const loja = lojaCF(req, res, true); if (!loja) return;
  const r = COB.salvarAuto(loja.id, req.body || {});
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'configurou a cobrança automática à franquia', loja.id, { loja: loja.id, devolucoes: r.ok.devolucoes, fidelidade: r.ok.fidelidade, dia: r.ok.dia, hora: r.ok.hora });
  res.json(r.ok);
});
let cobCiclo = false; // uma rodada por vez: SMTP lento não pode fazer a cobrança do mês sair duas vezes
setInterval(async () => {
  if (cobCiclo) return;
  cobCiclo = true;
  try {
  const agora = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T');
  for (const loja of C.get().lojas || []) {
    for (const tipo of ['devolucoes', 'fidelidade']) {
      try {
        if (!COB.devidoAgora(loja.id, tipo, agora)) continue;
        COB.marcarAuto(loja.id, tipo, agora.slice(0, 7), { ok: false, erro: 'enviando…', andamento: true }); // marca o mês antes: se cair no meio, não reenvia sozinha
        const para = COB.emails(loja.id, tipo) || DEV.destinatarios(loja.id);
        const x = await enviarCobranca(loja, tipo, { para }, 'agendado');
        COB.marcarAuto(loja.id, tipo, agora.slice(0, 7), x.erro ? (x.vazio ? { ok: true, nada: true } : { ok: false, erro: x.erro }) : { ok: true, itens: x.itens.length, total: x.total });
        console.log(`[cobrança] ${loja.id} ${tipo}: ${x.erro || 'enviada'}`);
      } catch (e) { console.error('[cobrança]', loja.id, tipo, e.message); }
    }
  }
  } finally { cobCiclo = false; }
}, 5 * 60 * 1000).unref();
app.get('/api/conta-franquia', (req, res) => {
  const loja = lojaCF(req, res); if (!loja) return;
  try { res.json(contaDaLoja(loja)); } catch (e) { console.error('[conta-franquia]', e); res.status(500).json({ erro: 'Erro ao montar a conta com a franquia: ' + C.msgErro(e) }); }
});
app.post('/api/conta-franquia/acao', express.json({ limit: '5kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const loja = lojaCF(req, res, true); if (!loja) return;
  let r;
  try {
    const b = req.body || {};
    const ctx = {};
    if (b.tipo === 'compensar') {
      // compensada em nota de entrada: a nota precisa ser desta loja; as devoluções que o painel já ligou sozinho a ela continuam lá
      ctx.compras = (ES.notas(loja.id) || { notas: [] }).notas;
      if (b.como === 'nota') { const antes = contaDaLoja(loja); ctx.jaNaNota = (nid) => { const n = antes.notas.find((x) => x.id === nid); return n && n.situacao === 'compensou' ? n.creditos : []; }; }
    }
    r = CF.acao(loja.id, b, req.user, ctx);
  } catch (e) { console.error('[conta-franquia] ação:', e); return res.status(500).json({ erro: 'Não deu para salvar: ' + C.msgErro(e) }); }
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'conta com a franquia: ' + String(req.body.tipo), loja.id, { loja: loja.id, nota: req.body.nota || null, creditos: req.body.creditos || (req.body.credito ? [req.body.credito] : []), ...(req.body.tipo === 'compensar' ? { como: String(req.body.como || ''), nf: req.body.nf ? String(req.body.nf).slice(0, 20) : undefined, mes: req.body.mes ? String(req.body.mes).slice(0, 7) : undefined } : {}) });
  res.json(contaDaLoja(loja));
});
// checklist de abertura e fechamento: qualquer pessoa da loja marca (com nome e hora); a lista muda em Configurações
const CK = require('./src/checklist');
const hojeSPiso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const lojaCk = (req, res, corpo) => {
  const id = String((corpo ? req.body && req.body.loja : req.query.loja) || '');
  const loja = req.lojas.find((l) => l.id === id);
  if (!loja) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  return loja;
};
app.get('/api/checklist', (req, res) => {
  const loja = lojaCk(req, res); if (!loja) return;
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dia || '')) ? String(req.query.dia) : hojeSPiso();
  let marcados = CK.doDia(loja.id, dia), historico = CK.historico(loja.id);
  // vendedora não vê o login das colegas (PERF-08): "você" ou "equipe"
  if (req.perfil === 'vendedor') {
    const quem = (x) => (x && x.por ? { ...x, por: x.por === req.user ? 'você' : 'equipe' } : x);
    const doTipo = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) && 'em' in v ? quem(v) : v]));
    marcados = Object.fromEntries(Object.entries(marcados || {}).map(([t, o]) => [t, o && typeof o === 'object' ? doTipo(o) : o]));
    historico = (historico || []).map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v && typeof v === 'object' && v.ultima ? { ...v, ultima: quem(v.ultima) } : v])));
  }
  res.json({ dia, hoje: hojeSPiso(), itens: CK.itens(loja.id), marcados, historico, podeEditar: req.perfil !== 'vendedor' });
});
app.post('/api/checklist/marcar', express.json({ limit: '5kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const loja = lojaCk(req, res, true); if (!loja) return;
  const dia = String(req.body.dia || '');
  const hoje = hojeSPiso(), ontem = new Date(Date.parse(hoje + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
  if (dia !== hoje && dia !== ontem) return res.status(400).json({ erro: 'Só dá para marcar o checklist de hoje (ou de ontem, para o fechamento depois da meia-noite).' });
  const r = CK.marcar(loja.id, dia, String(req.body.tipo || ''), String(req.body.item || ''), !!req.body.feito, req.user, req.body.obs);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json({ ok: true, marcados: r.ok });
});
app.put('/api/checklist/itens', express.json({ limit: '20kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Peça para a gerente.' });
  const loja = lojaCk(req, res, true); if (!loja) return;
  const r = CK.salvarItens(loja.id, req.body || {});
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'alterou o checklist de abertura e fechamento', loja.id, { loja: loja.id });
  res.json({ ok: r.ok });
});
// orçamentos para empresas (só admin e franqueado: mostram custo e margem)
const ORC = require('./src/orcamentos');
const lojaOrc = (req, res, corpo) => {
  if (!podeContabilidade(req)) { res.status(403).json({ erro: 'Só o admin e o franqueado fazem orçamento.' }); return null; }
  const id = String((corpo ? req.body && req.body.loja : req.query.loja) || '');
  const loja = req.lojas.find((l) => l.id === id);
  if (!loja) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  return loja;
};
app.get('/api/orcamentos', (req, res) => { const loja = lojaOrc(req, res); if (loja) res.json({ orcamentos: ORC.lista(loja.id).map((o) => ({ ...o, totais: ORC.totais(o) })) }); });
app.post('/api/orcamentos', express.json({ limit: '200kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const loja = lojaOrc(req, res, true); if (!loja) return;
  const r = ORC.salvar(loja.id, req.body || {}, req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, req.body.id ? 'alterou um orçamento' : 'criou um orçamento', loja.id, { loja: loja.id, numero: r.ok.numero, cliente: r.ok.cliente.empresa || r.ok.cliente.contato, total: ORC.totais(r.ok).total });
  res.json({ ok: { ...r.ok, totais: ORC.totais(r.ok) } });
});
app.post('/api/orcamentos/:id/situacao', express.json({ limit: '5kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const loja = lojaOrc(req, res, true); if (!loja) return;
  const r = ORC.situacao(loja.id, String(req.params.id), String(req.body.situacao || ''), req.body.motivo, req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, `orçamento ${r.ok.numero}: ${r.ok.situacao}`, loja.id, { loja: loja.id, numero: r.ok.numero, motivo: r.ok.motivoPerda || null });
  res.json({ ok: { ...r.ok, totais: ORC.totais(r.ok) } });
});
app.delete('/api/orcamentos/:id', (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const loja = lojaOrc(req, res); if (!loja) return;
  const r = ORC.excluir(loja.id, String(req.params.id));
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json({ ok: true });
});
// ======================= Inteligência artificial (chave da Anthropic de cada franqueado) =======================
const IA = require('./src/ia'), IAP = require('./src/iaprompts');
const podeIA = (req) => IA.podeUsar(req.perfil); // só admin e franqueado
/** loja da conversa: a escolhida (ou, em "todas", a primeira das lojas da pessoa que tem chave) */
const lojaIA = (req, res, id) => {
  if (!podeIA(req)) { res.status(403).json({ erro: 'A IA é só para o admin e o franqueado.' }); return null; }
  id = String(id || '');
  const loja = id === 'todas' ? req.lojas.find((l) => IA.chaveAtiva(l.id)) || req.lojas[0] : req.lojas.find((l) => l.id === id);
  if (!loja) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  return loja;
};
const iaErro = (res, e) => (e instanceof IA.ErroIA ? res.status(e.status).json({ erro: C.msgErro(e) }) : (console.error('[ia]', e), res.status(500).json({ erro: 'Falha na IA: ' + C.msgErro(e) })));
app.get('/api/ia/estado', (req, res) => {
  if (!podeIA(req)) return res.json({ ativa: false, pode: false });
  const id = String(req.query.loja || '');
  const lojas = id === 'todas' ? req.lojas : req.lojas.filter((l) => l.id === id);
  const k = lojas.map((l) => IA.chaveAtiva(l.id)).find(Boolean); // IA desligada conta como sem IA: o ✨ some
  res.json({ ativa: !!k, desligada: !k && lojas.some((l) => { const c = IA.chaveDaLoja(l.id); return !!(c && c.desligada); }), pode: true, podeConfigurar: podeContabilidade(req) });
});
const lojaCfgIA = (req, res, id) => {
  if (!podeContabilidade(req)) { res.status(403).json({ erro: 'Só o admin e o franqueado configuram a IA.' }); return null; }
  const loja = req.lojas.find((l) => l.id === String(id || ''));
  if (!loja) { res.status(400).json({ erro: 'Escolha a loja.' }); return null; }
  return loja;
};
app.get('/api/ia/config', (req, res) => { const loja = lojaCfgIA(req, res, req.query.loja); if (loja) res.json(IA.situacao(loja.id)); });
app.use('/api/ia', (req, res, next) => (req.method === 'GET' || req.get('X-Painel') === '1' ? next() : res.status(403).json({ erro: 'Pedido inválido.' })));
app.put('/api/ia/chave', express.json({ limit: '4kb' }), async (req, res) => {
  const b = req.body || {};
  const loja = lojaCfgIA(req, res, b.loja); if (!loja) return;
  if (tooMany('iachave:' + req.user, 10)) return res.status(429).json({ erro: 'Muitas tentativas. Espere alguns minutos.' });
  falhou('iachave:' + req.user);
  if (!IA.formatoOk(b.chave)) return res.status(400).json({ erro: 'Essa não parece uma chave da API da Anthropic (começa com "sk-ant-").' });
  const t = await IA.testar(b.chave);
  if (t.erro) return res.status(400).json({ erro: t.erro });
  const r = IA.salvar({ chave: b.chave, loja: loja.id, teto: b.teto, user: req.user });
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'cadastrou a chave da IA', loja.id, { loja: loja.id, final: r.ok.fim });
  res.json({ ok: true, fim: r.ok.fim });
});
app.patch('/api/ia/chave', express.json({ limit: '4kb' }), (req, res) => {
  const b = req.body || {};
  const loja = lojaCfgIA(req, res, b.loja); if (!loja) return;
  const r = IA.alterar(loja.id, b);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  if (b.ligada !== undefined) C.auditar(req.user, b.ligada ? 'ligou a IA' : 'desligou a IA', loja.id, { loja: loja.id });
  if (b.teto !== undefined) C.auditar(req.user, 'alterou o teto da IA', loja.id, { loja: loja.id, teto: b.teto ?? null });
  res.json({ ok: true });
});
app.delete('/api/ia/chave', (req, res) => {
  const loja = lojaCfgIA(req, res, req.query.loja); if (!loja) return;
  const r = IA.remover(loja.id);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'removeu a chave da IA', loja.id, { loja: loja.id });
  res.json({ ok: true });
});
// "Pergunte ao painel": o navegador roda as ferramentas sobre os dados que a pessoa já vê; aqui só a chamada à IA
app.post('/api/ia/perguntar', express.json({ limit: '300kb' }), async (req, res) => {
  const b = req.body || {};
  const loja = lojaIA(req, res, b.loja); if (!loja) return;
  if (tooMany('ia:' + req.user, 150)) return res.status(429).json({ erro: 'Muitas perguntas em pouco tempo. Espere alguns minutos.' });
  falhou('ia:' + req.user);
  const e = IAP.conferirMensagens(b.mensagens);
  if (e) return res.status(400).json({ erro: e });
  const pode = { clientes: podeClientes(req), custos: podeCustos(req) && b.loja !== 'todas', perfil: req.perfil };
  try {
    const j = await IA.mensagens(loja.id, {
      max_tokens: 12000,
      system: [{ type: 'text', text: IAP.sistemaPergunta(b.contexto, pode), cache_control: { type: 'ephemeral' } }],
      tools: IAP.ferramentas(pode),
      messages: b.mensagens,
    });
    if (b.mensagens.length === 1) C.auditar(req.user, 'perguntou à IA', loja.id, { loja: loja.id });
    res.json({ content: j.content, stop_reason: j.stop_reason });
  } catch (err) { iaErro(res, err); }
});
// histórico do "Pergunte ao painel": só as conversas da própria pessoa
const IAC = require('./src/iaconversas');
app.get('/api/ia/conversas', (req, res) => {
  if (!podeIA(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = String(req.query.loja || '');
  if (loja !== 'todas' && !req.lojas.some((l) => l.id === loja)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  res.json({ conversas: IAC.lista(req.user, loja) });
});
app.get('/api/ia/conversas/:id', (req, res) => {
  if (!podeIA(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const c = IAC.abrir(req.user, req.params.id);
  if (!c || (c.loja !== 'todas' && !req.lojas.some((l) => l.id === c.loja))) return res.status(404).json({ erro: 'Conversa não encontrada.' });
  res.json(c);
});
app.put('/api/ia/conversas/:id', express.json({ limit: '800kb' }), (req, res) => {
  if (!podeIA(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const b = req.body || {};
  const loja = String(b.loja || '');
  if (loja !== 'todas' && !req.lojas.some((l) => l.id === loja)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const r = IAC.salvar(req.user, req.params.id, { loja, vis: b.vis, mensagens: b.mensagens });
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json(r.ok);
});
app.delete('/api/ia/conversas/:id', (req, res) => {
  if (!podeIA(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const r = IAC.apagar(req.user, req.params.id);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json({ ok: true });
});
// "Por que isso está acontecendo" (Início): a mesma situação (mesmos números e avisos) não é cobrada de novo
app.post('/api/ia/diagnostico', express.json({ limit: '150kb' }), async (req, res) => {
  const b = req.body || {};
  const loja = lojaIA(req, res, b.loja); if (!loja) return;
  const fatos = b.fatos && typeof b.fatos === 'object' ? b.fatos : null;
  if (!fatos) return res.status(400).json({ erro: 'Sem dados.' });
  const txt = JSON.stringify(fatos);
  if (txt.length > 120000) return res.status(400).json({ erro: 'Dados demais.' });
  // UMA análise por loja por dia, a mesma para admin e franqueado (só eles veem a IA): quem abrir primeiro gera,
  // os outros leem a guardada. Os números que vão para a IA são só de vendas.
  const pasta = path.join(C.pastaLoja(loja.id), 'ia');
  const dia = C.hojeBR();
  const qual = String(b.loja) === 'todas' ? 'todas-' + crypto.createHash('sha256').update(req.lojas.map((l) => l.id).sort().join(',')).digest('hex').slice(0, 10) : 'loja';
  const arq = path.join(pasta, `diag-${dia}-${qual}.json`);
  let jaTem = false;
  try { fs.accessSync(arq); jaTem = true; } catch { /* ainda não tem */ }
  if (!jaTem) {
    if (tooMany('ia:' + req.user, 150)) return res.status(429).json({ erro: 'Muitos pedidos à IA em pouco tempo. Espere alguns minutos.' });
    falhou('ia:' + req.user);
  }
  try {
    const out = await IA.umaVez(arq, async () => {
      const diag = await IA.comFerramenta(loja.id, { max_tokens: 6000, system: IAP.SISTEMA_DIAG, ferramenta: IAP.FERR_DIAG, conteudo: 'Números do painel (JSON):\n' + txt });
      if (!diag) return null;
      // guarda só os últimos 7 dias
      try { for (const f of fs.readdirSync(pasta)) { const m = /^diag-(\d{4}-\d{2}-\d{2})-/.exec(f); if (m && Date.parse(dia) - Date.parse(m[1]) > 7 * 864e5) fs.unlinkSync(path.join(pasta, f)); } } catch { /* ok */ }
      // os números vêm do navegador de quem abriu primeiro: fica registrado quem gerou (aparece na tela e na auditoria)
      const quem = C.usuario(req.user);
      C.auditar(req.user, 'gerou a análise do dia (IA)', loja.id, { loja: loja.id, dia });
      return { diagnostico: diag, em: new Date().toISOString(), dia, por: String((quem && quem.nome) || req.user).slice(0, 60) };
    });
    if (!out) return res.status(502).json({ erro: 'A IA não devolveu a explicação. Tente de novo.' });
    res.json(out);
  } catch (err) { iaErro(res, err); }
});
// revisão do pedido sugerido (aba Pedido)
app.post('/api/ia/pedido', express.json({ limit: '200kb' }), async (req, res) => {
  const b = req.body || {};
  if (!podeTela(req, 'pedido') || !podeIA(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(b.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  if (tooMany('ia:' + req.user, 150)) return res.status(429).json({ erro: 'Muitos pedidos à IA em pouco tempo. Espere alguns minutos.' });
  falhou('ia:' + req.user);
  const dados = b.dados && typeof b.dados === 'object' ? b.dados : null;
  if (!dados || !Array.isArray(dados.itens) || !dados.itens.length) return res.status(400).json({ erro: 'Pedido vazio.' });
  try {
    const revisao = await IA.comFerramenta(loja.id, { max_tokens: 10000, system: IAP.SISTEMA_PEDIDO, ferramenta: IAP.FERR_PEDIDO, conteudo: 'Dados do pedido (JSON):\n' + JSON.stringify(dados) });
    if (!revisao) return res.status(502).json({ erro: 'A IA não devolveu a revisão. Tente de novo.' });
    C.auditar(req.user, 'pediu à IA a revisão do pedido', loja.id, { loja: loja.id });
    res.json({ revisao });
  } catch (err) { iaErro(res, err); }
});

// "Sincronizar agora" nas notas de entrada: o coletor busca só o estoque + notas de compra do AppNext (admin ou franqueado da loja)
app.get('/api/estoque/notas/sincronizar', async (req, res) => {
  if (req.perfil !== 'admin' && req.perfil !== 'franqueado') return res.status(403).json({ erro: 'Só o admin ou o franqueado da loja sincroniza.' }); // req.lojas: só as lojas dele
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  if (!COL.ativo()) return res.json({ estado: 'sem_coletor' });
  try {
    const s = await COL.status(loja.id, true);
    const x = s.execucao || {};
    const r = s.robo || {};
    // log: ao vivo enquanto roda; senão, o final da última execução. "robo": o que o robô está fazendo agora (outra loja não aparece pelo nome)
    res.json({ estado: x.estado || 'parado', itens: x.itens || null, gatilho: x.gatilho || null, por: x.por || null, criado: x.criado || null, inicio: x.inicio || null, fim: x.fim || null, fila: s.fila || 0,
      log: (x.estado === 'rodando' ? x.aoVivo : x.log) || [], robo: r.livre ? null : { gatilho: r.gatilho || null, inicio: r.inicio || null, outraLoja: !!r.outraLoja },
      atualizado: (ES.notas(loja.id) || {}).atualizado || null });
  } catch (e) { res.status(502).json({ erro: C.msgErro(e) }); }
});
app.post('/api/estoque/notas/sincronizar', express.json({ limit: '1kb' }), async (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (req.perfil !== 'admin' && req.perfil !== 'franqueado') return res.status(403).json({ erro: 'Só o admin ou o franqueado da loja sincroniza.' }); // req.lojas: só as lojas dele
  const loja = req.lojas.find((l) => l.id === String((req.body && req.body.loja) || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS.' });
  try {
    const x = await COL.rodar(loja.id, req.user, ['estoque']);
    if (x.status !== 200) return res.status(x.status).json({ erro: (x.json && x.json.erro) || 'Falha no coletor.' });
    C.auditar(req.user, 'sincronizou as notas de entrada (estoque) com o AppNext', loja.id, { loja: loja.id });
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ erro: C.msgErro(e) }); }
});
// classe oficial (Estrela, Volume…): janela de 3, 6 ou 12 meses e classes travadas à mão (admin e franqueado)
app.put('/api/estoque/classe', express.json({ limit: '5kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!podeContabilidade(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const b = req.body || {};
  const lc = C.get().lojas.find((l) => l.id === loja.id);
  const v = ES.alterarClasse(lc && lc.classeCfg, b, req.user);
  if (v.erro) return res.status(400).json({ erro: v.erro });
  C.alterar((cfg) => { cfg.lojas.find((l) => l.id === loja.id).classeCfg = v.ok; });
  C.auditar(req.user, b.cod != null ? (b.classe ? 'travou a classe de um produto' : 'destravou a classe de um produto') : 'mudou a janela da classe oficial', loja.id,
    b.cod != null ? { loja: loja.id, produto: String(b.nome || b.cod).slice(0, 80), cod: String(b.cod), classe: b.classe || 'automática' } : { loja: loja.id, meses: v.ok.meses });
  res.json({ ok: true, classe: v.ok });
});
app.put('/api/estoque/cfg', express.json({ limit: '20kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!podeContabilidade(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const v = ES.validarCfg(req.body || {});
  if (v.erro) return res.status(400).json({ erro: v.erro });
  C.alterar((cfg) => { cfg.lojas.find((l) => l.id === loja.id).estoqueCfg = v.ok; });
  C.auditar(req.user, 'alterou configuração de estoque', loja.id, { loja: loja.id, entregaDias: v.ok.entregaDias, coberturaDias: v.ok.coberturaDias, comprasTetoPct: v.ok.comprasTetoPct, prazoNotasDias: v.ok.prazoNotasDias, cartaoDias: v.ok.cartaoDias, royaltiesDia: v.ok.royaltiesDia });
  res.json({ ok: true, cfg: v.ok });
});

// ---------- caixa a pagar e planilha para o contador (Resultado): admin, franqueado e gerente com a tela Resultado ----------
// o calendário é montado na tela; aqui ficam o que foi marcado como pago (por loja), a parte das vendas em cartão e a planilha do mês fechado
const APG = require('./src/apagar'), CTD = require('./src/contador'), CXA = require('./src/caixa');
const lojaDre = (req, res, id) => {
  if (!podeTela(req, 'dre')) { res.status(403).json({ erro: 'Sem permissão.' }); return null; }
  const loja = req.lojas.find((l) => l.id === String(id || ''));
  if (!loja) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  return loja;
};
app.get('/api/apagar', (req, res) => {
  const loja = lojaDre(req, res, req.query.loja); if (!loja) return;
  let cartao = null;
  try { cartao = APG.parteCartao(CXA.ler(loja.id).fechamentos, C.diaSP()); } catch (e) { console.error('[a pagar] caixa:', e.message); }
  res.json({ pagos: APG.ler(loja.id).pagos, cartao });
});
app.post('/api/apagar/pago', express.json({ limit: '4kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const b = req.body || {};
  const loja = lojaDre(req, res, b.loja); if (!loja) return;
  try {
    const r = APG.marcar(loja.id, b, req.user);
    if (r.erro) return res.status(400).json({ erro: r.erro });
    C.auditar(req.user, b.pago ? 'marcou conta como paga (A pagar)' : 'desfez conta paga (A pagar)', loja.id, { loja: loja.id, conta: String(b.nome || b.id).slice(0, 80), vence: b.pago ? b.vence : undefined, valor: b.pago ? Math.round(Number(b.valor) * 100) / 100 : undefined });
    res.json({ ok: true, pagos: r.ok.pagos });
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
// valor real de um custo fixo num mês (Resultado → clicar no valor do custo): grava ou volta ao padrão de Configurações
// descontos da franquia nos royalties por mês de referência (Resultado: royalties calculados − descontos = pagos; RES-ROY-01). GET só lê
app.get('/api/resultado/descontos-royalties', (req, res) => {
  const loja = lojaDre(req, res, String(req.query.loja || '')); if (!loja) return;
  try {
    const compras = (ES.notas(loja.id) || { notas: [] }).notas;
    const conta = CF.conta(loja.id, { saidas: NFS.lista(loja.id).notas, compras, devsPainel: DEV.lista(loja.id) });
    res.json(CF.descontosRoyalties(loja.id, conta.creditos));
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
app.post('/api/resultado/fixo-mes', express.json({ limit: '4kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const b = req.body || {};
  const loja = lojaDre(req, res, b.loja); if (!loja) return;
  try {
    const lc = C.get().lojas.find((l) => l.id === loja.id);
    const r = FXM.lancar(loja.id, b, ES.cfg(lc).outros, req.user, C.diaSP());
    if (r.erro) return res.status(400).json({ erro: r.erro });
    C.auditar(req.user, r.valor == null ? 'voltou um custo fixo ao padrão no mês (Resultado)' : 'lançou o valor real de um custo fixo no mês (Resultado)', loja.id,
      { loja: loja.id, custo: String(b.nome).slice(0, 40), ym: String(b.ym), valor: r.valor == null ? undefined : r.valor });
    res.json({ ok: true, fixosMes: r.ok.despesas });
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
// planilha do mês fechado: POST porque fica na auditoria e leva as linhas do Resultado que a tela calculou
app.post('/api/resultado/exportar', express.json({ limit: '200kb' }), async (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const b = req.body || {};
  const loja = lojaDre(req, res, b.loja); if (!loja) return;
  if (!CTD.mesFechado(b.ym, C.diaSP())) return res.status(400).json({ erro: 'A exportação é do mês fechado: escolha um mês que já terminou.' });
  try {
    const d = await dadosParaIndicadores(loja);
    const buf = await CTD.planilha({ loja, ym: b.ym, geradoEm: C.diaSP(), resumo: b.resumo, despesas: b.despesas, vendas: d.vendas, caixa: (dia) => CXA.doDia(loja.id, dia),
      notasEntrada: (ES.notas(loja.id) || { notas: [] }).notas, notasSaida: NFS.lista(loja.id).notas,
      comDestinatario: podeTela(req, 'notas') }); // nome e documento do destinatário da NF-e: só quem já vê as Notas fiscais
    C.auditar(req.user, 'exportou o mês para o contador', loja.id, { loja: loja.id, ym: b.ym, kb: Math.round(buf.length / 1024) });
    res.set('Content-Disposition', `attachment; filename="contador-${loja.id}-${b.ym}.xlsx"`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf);
  } catch (e) { console.error('[contador]', e); res.status(500).json({ erro: 'Não deu para montar a planilha. Tente de novo.' }); }
});

// ---------- preços do e-commerce (www.teashop.com.br): consulta às 10h e "Consultar agora" ----------
const SITE = require('./src/site');
app.get('/api/site', (req, res) => {
  if (!podeTela(req, 'site')) return res.status(403).json({ erro: 'Sem permissão.' });
  const d = SITE.ler();
  // preço de tabela do cadastro da loja escolhida (sem custos): é o "nosso preço"
  const lojaT = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  const tabela = lojaT ? TAB.resumo(lojaT.id) : null;
  let hist = SITE.lerHist();
  // ainda sem histórico (consultas de antes desta versão): começa pela consulta atual
  if (!hist) hist = SITE.semear(d);
  res.json({ ...(d || { itens: [] }), historico: hist || {}, ...SITE.consultasTela(d), tabela: tabela ? tabela.itens.filter((t) => t.preco > 0.011).map((t) => ({ cod: t.cod, desc: t.desc, preco: t.preco })) : null, rodando: SITE.rodando(), podeConsultar: podeContabilidade(req) });
});
// fotos dos produtos (públicas no site): para a miniatura nas listas (Pedido, ⭐ Sugestões). Qualquer pessoa logada; sem preço nem custo
app.get('/api/site/fotos', (req, res) => {
  try { res.json(SITE.fotos()); } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
let siteUltimoManual = 0;
app.post('/api/site/consultar', async (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!podeContabilidade(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  if (!SITE.rodando() && Date.now() - siteUltimoManual < 60e3) return res.status(429).json({ erro: 'Acabou de consultar: espere um minuto.' });
  siteUltimoManual = Date.now();
  const r = await SITE.atualizar('manual', req.user);
  if (!r.ok) return res.status(502).json({ erro: 'Não consegui ler o site: ' + r.erro });
  res.json(r);
});

// ---------- pedido sugerido e Sistema de Pedidos da franqueadora (só admin e franqueado; robô só admin) ----------
const PED = require('./src/pedido');
app.get('/api/pedido', async (req, res) => {
  if (!podeTela(req, 'pedido')) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  let robo = { disponivel: false };
  if (COL.ativo()) {
    try {
      const s = await COL.status(loja.id);
      if (s.configurada) {
        const p = s.pedido || {};
        const u = p.ultima ? { ...p.ultima, log: req.perfil === 'admin' || req.perfil === 'franqueado' ? p.ultima.log : undefined } : null;
        robo = { disponivel: true, temLogin: s.temPedido, estado: p.estado || 'parado', acao: p.acao || null, ultima: u };
      }
    } catch (e) { robo = { disponivel: false, erro: e.message }; }
  }
  res.json({ rascunho: PED.rascunho(loja.id), catalogo: PED.catalogo(loja.id), carrinho: PED.carrinho(loja.id), cfg: PED.cfg(C.get().lojas.find((l) => l.id === loja.id)), obrigatorio: PED.obrigatorios(loja.id), espera: ESP.resumoPorCod(loja.id), sugestoes: (() => { const S = require('./src/sugestoes'); try { S.avaliarNotas(loja.id, ES.notas(loja.id)); } catch { /* segue */ } return S.paraPedido(loja.id); })(), robo, podeRobo: req.perfil === 'admin' || req.perfil === 'franqueado' });
});
// carrinho montado no site: "Confirmar" (o pedido foi feito) ou "Excluir" (montou e não pediu: o registro some e as ⭐ sugestões voltam)
const lojaCarrinho = (req, res) => {
  if (req.get('X-Painel') !== '1') { res.status(403).json({ erro: 'Pedido inválido.' }); return null; }
  if (!podeTela(req, 'pedido')) { res.status(403).json({ erro: 'Sem permissão.' }); return null; }
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  return loja;
};
app.post('/api/pedido/carrinho/confirmar', (req, res) => {
  const loja = lojaCarrinho(req, res); if (!loja) return;
  try {
    const r = PED.confirmarCarrinho(loja.id, req.user);
    if (r.erro) return res.status(400).json({ erro: r.erro });
    try { require('./src/sugestoes').confirmarPedido(loja.id, r.ok.inicio); } catch (e) { console.error('[sugestões] carrinho confirmado:', e.message); }
    C.auditar(req.user, 'confirmou que o pedido do carrinho foi feito', loja.id, { loja: loja.id, montadoEm: r.ok.inicio });
    res.json({ ok: true, carrinho: r.ok });
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
app.post('/api/pedido/carrinho/excluir', (req, res) => {
  const loja = lojaCarrinho(req, res); if (!loja) return;
  try {
    const r = PED.excluirCarrinho(loja.id);
    if (r.erro) return res.status(400).json({ erro: r.erro });
    let voltaram = 0;
    try { voltaram = require('./src/sugestoes').desfazerPedido(loja.id, r.ok.inicio, req.user, r.ok.confirmado).ok; } catch (e) { console.error('[sugestões] carrinho excluído:', e.message); }
    C.auditar(req.user, 'excluiu o registro do carrinho montado (pedido não feito)', loja.id, { loja: loja.id, montadoEm: r.ok.inicio, montadoPor: r.ok.por, produtos: r.ok.produtos, jaConfirmado: r.ok.confirmado, sugestoesDevolvidas: voltaram });
    res.json({ ok: true, sugestoesDevolvidas: voltaram });
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
// carrinho salvo: guarda as quantidades do pedido por 5 dias, para terminar depois (um por loja; quem tem a tela Pedido)
app.put('/api/pedido/rascunho', express.json({ limit: '200kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!podeTela(req, 'pedido')) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try {
    const r = PED.salvarRascunho(loja.id, (req.body || {}).itens, req.user);
    if (r.erro) return res.status(400).json({ erro: r.erro });
    C.auditar(req.user, 'salvou o carrinho do pedido', loja.id, { loja: loja.id, produtos: Object.values(r.ok.itens).filter((q) => q > 0).length });
    res.json({ ok: true, rascunho: r.ok });
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
app.delete('/api/pedido/rascunho', (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!podeTela(req, 'pedido')) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  PED.apagarRascunho(loja.id);
  C.auditar(req.user, 'descartou o carrinho salvo do pedido', loja.id, { loja: loja.id });
  res.json({ ok: true });
});
// ---------- inventário (Estoque → Inventário): contar pelo celular e gerar a planilha do AppNext ----------
const INV = require('./src/inventario');
const podeInv = (req) => req.perfil === 'vendedor' || podeTela(req, 'inventario');
const lojaInv = (req, res) => {
  if (!podeInv(req)) { res.status(403).json({ erro: 'Sem permissão.' }); return null; }
  const loja = req.lojas.find((l) => l.id === String((req.body && req.body.loja) || req.query.loja || ''));
  if (!loja) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  return loja;
};
async function catInv(loja) {
  let vendas = null;
  try { vendas = (await dadosLoja(loja)).raw.vendas; } catch { /* sem vendas: sem o tipo de chá */ }
  return INV.catalogo(ES.atual(loja.id), TAB.resumo(loja.id), vendas);
}
app.use('/api/inventario', (req, res, next) => {
  if (req.method === 'GET') return next();
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  next();
});
app.get('/api/inventario', async (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  const est = ES.atual(loja.id);
  const cat = await catInv(loja);
  const conta = (k) => { const m = new Map(); for (const i of cat) if (i[k]) m.set(i[k], (m.get(i[k]) || 0) + 1); return [...m].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')); };
  const subs = new Map();
  for (const i of cat) if (i.grupo && i.sub) { const k = i.grupo + '|' + i.sub; subs.set(k, (subs.get(k) || 0) + 1); }
  const fams = new Map();
  for (const i of cat) { const f = INV.familia(i.tipo); if (f) fams.set(f, (fams.get(f) || 0) + 1); }
  const todas = INV.lista(loja.id);
  const contagens = req.perfil === 'vendedor' ? todas.map((x) => ({ ...x, ajuste: null })) : todas;
  res.json({
    contagens, estoqueEm: est && est.em, perfil: req.perfil,
    grupos: conta('grupo'), subs: [...subs].map(([k, n]) => [...k.split('|'), n]), tipos: conta('tipo'), familias: [...fams].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')),
    kg: cat.filter(INV.ehChaGranel).length,
    cobertura: INV.cobertura(loja.id, cat, todas),
  });
});
// busca de itens (para escolher ou incluir): nome, código ou código de barras
app.get('/api/inventario/itens', async (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  const q = ESP.ESQ(req.query.q || ''), d = String(req.query.q || '').replace(/\D/g, '');
  if (q.length < 2 && d.length < 2) return res.json({ itens: [] });
  const cat = await catInv(loja);
  const vend = req.perfil === 'vendedor';
  const achou = cat.filter((i) => ESP.ESQ(i.desc).includes(q) || (d.length >= 2 && (i.cod === d || i.cod.startsWith(d) || (i.barras && i.barras === d)))).slice(0, 15)
    .map((i) => ({ cod: i.cod, desc: i.desc, un: i.un, grupo: i.grupo, sub: i.sub, tipo: i.tipo, barras: i.barras, qtd: vend ? null : i.qtd }));
  res.json({ itens: achou });
});
// prévia: quantos itens entram com a escolha
app.post('/api/inventario/previa', express.json({ limit: '50kb' }), async (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  const cat = await catInv(loja);
  const b = req.body || {}, cods = new Set((b.cods || []).map(String)), f = b.filtro || {};
  const n = cat.filter((i) => cods.has(i.cod) || (f.grupo && i.grupo === f.grupo && (!f.sub || i.sub === f.sub)) || (f.tipo && i.tipo === f.tipo) || (f.familia && INV.familia(i.tipo) === f.familia) || (f.tudoKg && INV.ehChaGranel(i))).length;
  res.json({ itens: n });
});
app.get('/api/inventario/contagem', async (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  // envio pelo robô: quando terminou, a contagem vira importada e o estoque é buscado de novo para conferir
  const cf = INV.conferirEnvio(loja.id, String(req.query.id || ''));
  if (cf.mudou && cf.ok && cf.c.envio.tipo && COL.ativo()) COL.rodar(loja.id, 'inventário', ['estoque']).catch(() => null);
  if (cf.mudou) C.auditar(cf.c.envio.por || 'sistema', cf.ok ? (cf.c.envio.tipo === 'importar' ? 'inventário importado no AppNext pelo robô' : 'inventário desfeito no AppNext pelo robô') : 'o robô não conseguiu importar o inventário', loja.id, { loja: loja.id, nome: cf.c.nome, erro: cf.c.envio.erro || null });
  const c = INV.ler(loja.id, String(req.query.id || ''));
  if (!c) return res.status(404).json({ erro: 'Contagem não encontrada.' });
  const est = ES.atual(loja.id);
  if (req.perfil === 'vendedor') { const { planilha, desfazer, zerar, ...resto } = INV.paraUsuario(c, req.perfil); return res.json({ ...resto, estoqueEm: est && est.em, agora: null, podeRevisar: false }); }
  // depois de importada: a quantidade de agora no estoque do painel, para conferir se o AppNext recebeu
  const cods = new Set([...c.itens.map((x) => x.cod), ...((c.planilha && c.planilha.itens) || []).map((x) => x.cod)]);
  const agora = Object.fromEntries(((est && est.itens) || []).filter((i) => cods.has(String(i.cod))).map((i) => [String(i.cod), i.qtd]));
  // "zerar os não listados": o que ficaria zero, por grupo
  const r = INV.resto(c, est, await catInv(loja));
  let robo = null;
  if (c.envio && COL.ativo()) {
    try {
      const st = await COL.status(loja.id);
      robo = st.inventario || {};
      // na fila: o robô espera a coleta que já está rodando terminar
      if (robo.esperando) robo.ocupado = { gatilho: robo.esperando.gatilho, inicio: robo.esperando.inicio };
      // o robô não tem mais este envio (terminou sem resultado ou o coletor reiniciou): mostra como erro, com o log
      const u = robo.ultima;
      const desteEnvio = u && u.id === c.id && Date.parse(u.fim) >= Date.parse(c.envio.em) - 1000;
      if (c.envio.estado === 'na_fila' && robo.estado !== 'na_fila' && robo.estado !== 'rodando' && (desteEnvio || Date.now() - Date.parse(c.envio.em) > 15000)) {
        const again = INV.conferirEnvio(loja.id, c.id);
        if (!again.mudou) {
          INV.erroEnvio(loja.id, c.id, desteEnvio ? `o robô terminou sem confirmar (código ${u.codigo})` : 'o pedido se perdeu (o coletor foi reiniciado, provavelmente por uma atualização); envie de novo');
          Object.assign(c, INV.ler(loja.id, c.id));
        } else Object.assign(c, again.c);
      }
    } catch { /* ok */ }
  }
  res.json({ ...c, estoqueEm: est && est.em, agora, podeRevisar: true, resto: r, restoFora: [...INV.gruposFora(c, r)], podeEnviar: COL.ativo(), robo });
});
// enviar direto para o AppNext: o robô importa a planilha (confere item a item o que o AppNext leu antes de salvar)
app.post('/api/inventario/contagem/:id/enviar', express.json({ limit: '2kb' }), async (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Peça para a gerente enviar.' });
  if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS: baixe a planilha e importe no AppNext.' });
  const tipo = (req.body || {}).tipo === 'desfazer' ? 'desfazer' : 'importar';
  const c = INV.ler(loja.id, String(req.params.id));
  if (!c) return res.status(404).json({ erro: 'Contagem não encontrada.' });
  if (c.envio && c.envio.estado === 'na_fila') return res.status(409).json({ erro: 'Esta contagem já está sendo enviada.' });
  let linhas;
  if (tipo === 'importar') {
    if (['importado', 'revertido', 'cancelado'].includes(c.st)) return res.status(400).json({ erro: 'Esta contagem não pode ser enviada.' });
    if (!c.itens.some((i) => i.cont != null)) return res.status(400).json({ erro: 'Nenhum item contado.' });
    linhas = INV.linhasPlanilha(c, ES.atual(loja.id), await catInv(loja));
  } else {
    if (c.st !== 'importado' || !c.planilha) return res.status(400).json({ erro: 'Só dá para desfazer uma contagem importada.' });
    linhas = INV.linhasDesfazer(c, ES.atual(loja.id));
  }
  const p = await INV.prepararEnvio(loja.id, c.id, tipo, linhas, req.user);
  if (p.erro) return res.status(400).json({ erro: p.erro });
  try {
    const x = await COL.inventario(loja.id, c.id, tipo, req.user);
    if (x.status >= 400) { const erro = (x.json && x.json.erro) || 'O coletor recusou.'; INV.erroEnvio(loja.id, c.id, erro); return res.status(x.status === 409 ? 409 : 400).json({ erro }); }
  } catch (e) { INV.erroEnvio(loja.id, c.id, 'sem resposta do coletor'); return res.status(502).json({ erro: 'Não consegui falar com o coletor: ' + C.msgErro(e) }); }
  C.auditar(req.user, tipo === 'importar' ? 'mandou o robô importar um inventário no AppNext' : 'mandou o robô desfazer um inventário no AppNext', loja.id, { loja: loja.id, nome: c.nome, itens: linhas.length, zerados: linhas.filter((l) => l.zerado).length });
  res.json({ ok: true });
});
app.put('/api/inventario/contagem/:id/zerar', express.json({ limit: '20kb' }), (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Peça para a gerente.' });
  const r = INV.zerar(loja.id, String(req.params.id), req.body || {});
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json({ ok: true, zerar: r.ok });
});
app.post('/api/inventario', express.json({ limit: '200kb' }), async (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  const r = INV.criar(loja.id, req.body || {}, req.user, await catInv(loja), req.perfil);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'abriu uma contagem de estoque', loja.id, { loja: loja.id, nome: r.ok.nome, itens: r.ok.itens.length });
  res.json({ ok: true, id: r.ok.id });
});
app.put('/api/inventario/contagem/:id/item/:cod', express.json({ limit: '8kb' }), (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  const r = INV.contar(loja.id, String(req.params.id), String(req.params.cod), (req.body || {}).cont, req.user, (req.body || {}).lotes);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json({ ok: true, item: req.perfil === 'vendedor' ? { ...r.ok, sis: null, custo: null } : r.ok });
});
app.post('/api/inventario/contagem/:id/itens', express.json({ limit: '50kb' }), async (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  const r = INV.adicionar(loja.id, String(req.params.id), (req.body || {}).cods || [], await catInv(loja));
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json({ ok: true });
});
// gerar a planilha fecha a contagem (st "gerado") e guarda o que foi para o AppNext: por isso é POST com X-Painel, nunca GET
app.post('/api/inventario/contagem/:id/planilha', async (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const loja = lojaInv(req, res); if (!loja) return;
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Peça para a gerente gerar a planilha.' });
  const c = INV.ler(loja.id, String(req.params.id));
  if (!c) return res.status(404).json({ erro: 'Contagem não encontrada.' });
  if (!c.itens.some((i) => i.cont != null)) return res.status(400).json({ erro: 'Nenhum item contado.' });
  if (c.st === 'importado' || c.st === 'revertido') return res.status(400).json({ erro: 'Esta contagem já foi importada; o que foi enviado está no histórico.' });
  try {
    const linhas = INV.linhasPlanilha(c, ES.atual(loja.id), await catInv(loja));
    const buf = await INV.planilha(linhas);
    INV.marcarGerado(loja.id, c.id, req.user, linhas);
    C.auditar(req.user, 'gerou a planilha de inventário', loja.id, { loja: loja.id, nome: c.nome, itens: linhas.length, zerados: linhas.filter((l) => l.zerado).length });
    const nome = `Inventario_${String(loja.nome).normalize('NFD').replace(/[^\w]+/g, '_')}_${C.hojeBR()}.xlsx`;
    res.set('Content-Disposition', `attachment; filename="${nome}"`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buf));
  } catch (e) { console.error('[inventário] planilha:', e); res.status(500).json({ erro: 'Não deu para montar a planilha. Tente de novo.' }); }
});
app.post('/api/inventario/contagem/:id/desfazer', async (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const loja = lojaInv(req, res); if (!loja) return;
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Sem permissão.' });
  const c = INV.ler(loja.id, String(req.params.id));
  if (!c || c.st !== 'importado' || !c.planilha) return res.status(400).json({ erro: 'Só dá para desfazer uma contagem importada.' });
  try {
    const linhas = INV.linhasDesfazer(c, ES.atual(loja.id));
    const buf = await INV.planilha(linhas);
    INV.marcarDesfazer(loja.id, c.id, req.user, 'gerado');
    C.auditar(req.user, 'gerou a planilha para desfazer um inventário', loja.id, { loja: loja.id, nome: c.nome, itens: linhas.length });
    res.set('Content-Disposition', `attachment; filename="Desfazer_inventario_${C.hojeBR()}.xlsx"`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buf));
  } catch (e) { console.error('[inventário] desfazer:', e); res.status(500).json({ erro: 'Não deu para montar a planilha. Tente de novo.' }); }
});
app.post('/api/inventario/contagem/:id/:acao', express.json({ limit: '2kb' }), (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  const a = String(req.params.acao);
  if (req.perfil === 'vendedor' && a !== 'revisar') return res.status(403).json({ erro: 'Peça para a gerente.' });
  if (a === 'desfeito') {
    const d = INV.marcarDesfazer(loja.id, String(req.params.id), req.user, 'importado');
    if (d.erro) return res.status(400).json({ erro: d.erro });
    C.auditar(req.user, 'desfez um inventário no AppNext', loja.id, { loja: loja.id, nome: d.ok.nome });
    return res.json({ ok: true });
  }
  const r = INV.acao(loja.id, String(req.params.id), a, req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  if (a === 'importado' || a === 'cancelar') C.auditar(req.user, a === 'importado' ? 'marcou a contagem como importada no AppNext' : 'cancelou uma contagem de estoque', loja.id, { loja: loja.id, nome: r.ok.nome });
  res.json({ ok: true });
});
// planilha no modelo do AppNext (Estoque → Auditoria/Inventário → Novo → Por Excel)
// GET só relê a planilha já gerada (não muda nada); quem gera e fecha a contagem é o POST acima (X-Painel)
app.get('/api/inventario/contagem/:id/planilha', async (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Peça para a gerente gerar a planilha.' });
  const c = INV.ler(loja.id, String(req.params.id));
  if (!c) return res.status(404).json({ erro: 'Contagem não encontrada.' });
  if (!c.planilha || !Array.isArray(c.planilha.itens)) return res.status(409).json({ erro: 'A planilha ainda não foi gerada. Gere pelo botão na tela do Inventário.' });
  try {
    const buf = await INV.planilha(c.planilha.itens);
    const nome = `Inventario_${String(loja.nome).normalize('NFD').replace(/[^\w]+/g, '_')}_${C.hojeBR()}.xlsx`;
    res.set('Content-Disposition', `attachment; filename="${nome}"`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buf));
  } catch (e) { console.error('[inventário] planilha:', e); res.status(500).json({ erro: 'Não deu para montar a planilha. Tente de novo.' }); }
});

// desfazer: GET só relê (depois de gerada pelo POST); nada muda de estado aqui
app.get('/api/inventario/contagem/:id/desfazer', (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Sem permissão.' });
  const c = INV.ler(loja.id, String(req.params.id));
  if (!c || c.st !== 'importado' || !c.planilha) return res.status(400).json({ erro: 'Só dá para desfazer uma contagem importada.' });
  if (!c.desfazer) return res.status(409).json({ erro: 'A planilha de desfazer ainda não foi gerada. Gere pelo botão na tela do Inventário.' });
  INV.planilha(INV.linhasDesfazer(c, ES.atual(loja.id))).then((buf) => {
    res.set('Content-Disposition', `attachment; filename="Desfazer_inventario_${C.hojeBR()}.xlsx"`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buf));
  }).catch((e) => { console.error('[inventário] desfazer:', e); res.status(500).json({ erro: 'Não deu para montar a planilha. Tente de novo.' }); });
});

// ---------- validade e lotes do chá a granel (Estoque → Validade): a equipe informa o lote; o painel faz o resto ----------
const LOT = require('./src/lotes');
const podeValidade = (req) => req.perfil === 'vendedor' || podeTela(req, 'validade', 'notas', 'precos', 'estoque'); // no Estoque dá para informar a abertura do pacote // quem abre a nota de entrada também informa o lote
const podeCustos = (req) => podeTela(req, 'rentab', 'estoque', 'precos', 'notas', 'pedido', 'dre');
const lojaVal = (req, res) => {
  if (!podeValidade(req)) { res.status(403).json({ erro: 'Sem permissão.' }); return null; }
  const loja = req.lojas.find((l) => l.id === String((req.body && req.body.loja) || req.query.loja || ''));
  if (!loja) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  return loja;
};
/** o custo não sai para quem não vê custos (vendedora e gerente sem as telas de estoque) */
const semCusto = (req, x) => (podeCustos(req) ? x : { ...x, custoKg: null });
app.get('/api/validade', async (req, res) => {
  const loja = lojaVal(req, res); if (!loja) return;
  const ctx = LOT.daLoja(loja.id), { em, lotes } = ctx;
  // tipo de chá (Rooibos, Chá verde…) para o filtro: vem das vendas dos pacotes
  let tipos = new Map();
  try { tipos = new Map((await catInv(loja)).map((i) => [i.cod, i.tipo])); } catch { /* sem o tipo */ }
  const custos = podeCustos(req);
  const { resumo: r, outros, resumoOutros } = LOT.paraTela(ctx, custos);
  res.json({
    em, hoje: LOT.hojeSP(), meses: LOT.MESES_VALIDADE, mesesAberto: LOT.MESES_ABERTO, pacoteKg: LOT.PACOTE_KG, riscoDias: LOT.RISCO_DIAS, custos, faixas: LOT.FAIXAS.map((f) => ({ id: f.id, nome: f.nome, ate: Number.isFinite(f.ate) ? f.ate : null })),
    resumo: r, lotes: lotes.map((l) => semCusto(req, { ...l, tipo: tipos.get(l.cod) || '', familia: INV.familia(tipos.get(l.cod) || '') })),
    outros: outros.map((l) => semCusto(req, l)), resumoOutros, // chás envasados e alimentação: só lote e validade, em unidade
    historico: LOT.historicoAberturas(loja.id), // pacotes de chá que já acabaram: quando abriram, até quando valiam e quando acabaram
    entradas: LOT.entradasRecentes(ctx), // para contar por lote no inventário
    granel: LOT.granelEstoque(ctx), // chá a granel com/sem estoque (Clientes → Hoje não oferece chá que a loja não tem)
  });
});
// perdas do mês para o Resultado (linha "− Perdas"): chá vencido ainda no estoque + faltas do inventário, a custo.
// Só quem vê custo (admin, franqueado, gerente com tela de custo) e só da loja da pessoa.
app.get('/api/perdas', (req, res) => {
  if (!podeCustos(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try {
    const ctx = LOT.daLoja(loja.id);
    res.json({ hoje: LOT.hojeSP(), meses: require('./src/perdas').porMes({ lotes: [...ctx.lotes, ...ctx.outros], contagens: INV.lista(loja.id) }) });
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
// "deste lote ainda tem X" (ou voltar para a regra automática neste chá)
app.put('/api/validade/saldo', express.json({ limit: '4kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const loja = lojaVal(req, res); if (!loja) return;
  const ctx = LOT.daLoja(loja.id);
  const r = LOT.editarSaldo(loja.id, req.body || {}, req.user, ctx);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  const l = ctx.lotes.find((x) => x.chave === String(req.body.chave)) || ctx.lotes.find((x) => x.cod === String(req.body.cod)) || {};
  C.auditar(req.user, req.body.automatico ? 'voltou o saldo dos lotes para o automático' : 'ajustou o saldo de um lote', loja.id,
    { loja: loja.id, cod: l.cod, nf: l.nf, entrada: l.entrada, ...(req.body.automatico ? {} : { antes: r.antes, depois: Number(req.body.saldo), lotes: r.ok.fix }) });
  res.json({ ok: true });
});
// o que tem em estoque (sem quantidade nem custo): toda mensagem que oferece produto só sai se a loja tiver
app.get('/api/estoque/disponivel', (req, res) => {
  if (!(podeClientes(req) || (req.perfil !== 'vendedor' && podeValidade(req)))) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  res.json(LOT.disponivel({ estoque: ES.atual(loja.id), compras: ES.compras(loja.id) }));
});
app.put('/api/validade/lote', express.json({ limit: '4kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const loja = lojaVal(req, res); if (!loja) return;
  const { lotes, outros, compras } = LOT.daLoja(loja.id);
  const r = LOT.editar(loja.id, req.body || {}, req.user, [...lotes, ...outros], compras);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  const [nf, cod, entrada] = String(req.body.chave).split('|');
  C.auditar(req.user, 'alterou lote/validade', loja.id, { loja: loja.id, cod, nf, entrada, antes: r.antes, depois: r.ok });
  const depois = LOT.daLoja(loja.id), novo = [...depois.lotes, ...depois.outros].find((x) => x.chave === String(req.body.chave));
  res.json({ ok: true, lote: novo ? semCusto(req, novo) : null, editado: r.ok });
});
// "+ outra validade": a mesma linha da nota com validades diferentes (envasado e alimentação); partes vazio desfaz
app.put('/api/validade/partes', express.json({ limit: '8kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const loja = lojaVal(req, res); if (!loja) return;
  try {
    const r = LOT.repartir(loja.id, req.body || {}, req.user, LOT.daLoja(loja.id));
    if (r.erro) return res.status(400).json({ erro: r.erro });
    const [nf, cod, entrada] = r.ok.chave.split('|');
    C.auditar(req.user, r.ok.partes.length ? 'repartiu a validade de uma linha da nota' : 'desfez a repartição da validade', loja.id, { loja: loja.id, cod, nf, entrada, antes: r.antes, depois: r.ok.partes });
    res.json({ ok: true, ...r.ok });
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
// a equipe corrige a data em que o pacote aberto foi para a lata (vazio = volta para a estimativa do painel)
app.put('/api/validade/abertura', express.json({ limit: '4kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const loja = lojaVal(req, res); if (!loja) return;
  try {
    const r = LOT.editarAbertura(loja.id, req.body || {}, req.user);
    if (r.erro) return res.status(400).json({ erro: r.erro });
    const [nf, cod, entrada] = String(req.body.chave).split('|');
    C.auditar(req.user, r.ok.ate !== undefined ? 'alterou o vencimento do chá aberto' : 'alterou a data de abertura do chá', loja.id, { loja: loja.id, cod, nf, entrada, antes: r.antes, depois: r.ok.ate !== undefined ? r.ok.ate : r.ok.dia });
    const novo = LOT.daLoja(loja.id).lotes.find((x) => x.chave === String(req.body.chave));
    res.json({ ok: true, lote: novo ? semCusto(req, novo) : null });
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});
// lotes das notas de entrada (Estoque → Notas fiscais e Validade → "Notas que chegaram"): sem esperar o estoque
app.get('/api/validade/notas', (req, res) => {
  const loja = lojaVal(req, res); if (!loja) return;
  const ctx = LOT.daLoja(loja.id), ns = ES.notas(loja.id);
  const notas = (ns && ns.notas) || [];
  const ctxN = { estoque: ctx.estoque, compras: ctx.compras, edits: ctx.edits };
  const pendentes = LOT.pendentesNotas({ notas, ...ctxN, abertos: new Set([...ctx.lotes, ...ctx.outros].map((l) => l.chaveNota || l.chave)) });
  // uma nota (o detalhe aberto) ou as recentes que têm chá a granel, envasado ou alimentação (até 15)
  const so = String(req.query.nota || '');
  const recentes = (so ? notas.filter((n) => String(n.id) === so) : notas.slice().sort((a, b) => String(b.entrada || b.emissao || '').localeCompare(String(a.entrada || a.emissao || ''))))
    .map((n) => ({ id: n.id, nf: n.nf, entrada: String(n.entrada || n.emissao || '').slice(0, 10), fornecedor: n.fornecedor || '', itens: LOT.daNota({ nota: n, ...ctxN }) }))
    .filter((n) => n.itens.length).slice(0, 15);
  res.json({ pendentes, notas: recentes });
});

// ---------- lista de espera (Clientes → Lista de espera): todos os perfis da loja anotam e avisam ----------
const ESP = require('./src/espera');
const FIx = require('./src/fidelidade');
const lojaEsp = (req) => req.lojas.find((l) => l.id === String((req.body && req.body.loja) || req.query.loja || ''));
const esperaAvaliando = new Set();
/** confere chegadas e compras com os dados da loja; avisa no Telegram quando algo chegou */
async function avaliarEspera(loja) {
  if (esperaAvaliando.has(loja.id)) return [];
  esperaAvaliando.add(loja.id);
  try {
    let raw = null;
    try { raw = (await dadosLoja(loja)).raw; } catch { /* sem vendas: confere só a chegada */ }
    const fx = FIx.eventos(loja.id);
    try { require('./src/sugestoes').avaliarNotas(loja.id, ES.notas(loja.id)); } catch (e) { console.error('[sugestões] notas:', e.message); }
    // chá a granel: guarda a data dos pacotes que o painel vê abertos pela primeira vez e avisa os que entraram nos últimos 30 dias do prazo
    try {
      for (const p of LOT.observarAberturas(loja.id)) PUSH.avisarDepois({ tipo: 'validade', loja: loja.id, chave: `aberto:${loja.id}:${p.chave}#${p.n}`.slice(0, 400), titulo: `Chá aberto perto do prazo · ${loja.nome}`,
        texto: `${p.desc}: ${p.dias < 0 ? 'passou dos 6 meses depois de aberto' : `faltam ${p.dias} dias para completar 6 meses aberto`}. Venda primeiro.`, link: '/#validade' });
    } catch (e) { console.error('[validade] abertura:', C.msgErro(e)); }
    const novos = ESP.avaliar(loja.id, { notas: ES.notas(loja.id), estoque: ES.atual(loja.id), xml: raw ? raw.xml : [], vendas: raw ? raw.vendas : null, fixe: fx ? fx.eventos : [] });
    if (novos.length) {
      const porProd = new Map();
      for (const p of novos) for (const i of p.itens) porProd.set(i.desc, (porProd.get(i.desc) || 0) + 1);
      const txt = `⏳ Lista de espera · ${loja.nome}\nChegou:\n` + [...porProd].map(([d, n]) => `• ${d}: ${n} ${n === 1 ? 'cliente esperando' : 'clientes esperando'}`).join('\n') + '\nAbra Clientes → Lista de espera para avisar.';
      NOTIF.avisarLoja(loja.id, txt).catch((e) => console.error('[espera] aviso:', e.message));
      // no aparelho de quem usa a Lista de espera (uma vez por chegada: a chave são os pedidos que chegaram)
      PUSH.avisarDepois({ tipo: 'espera', loja: loja.id, chave: `espera:${loja.id}:${novos.map((p) => p.id).sort().join(',')}`.slice(0, 400), titulo: `Lista de espera · ${loja.nome}`,
        texto: 'Chegou: ' + [...porProd].map(([d, n]) => `${d} (${n} ${n === 1 ? 'cliente' : 'clientes'})`).join(', '), link: '/#espera' });
    }
    return novos;
  } finally {
    esperaAvaliando.delete(loja.id);
  }
}
setInterval(() => { for (const l of C.get().lojas) avaliarEspera(l).catch((e) => console.error(`[espera] ${l.id}:`, e.message)); }, 15 * 60e3).unref();
// fora de linha: confere o catálogo do Sistema de Pedidos a cada hora (o coletor lê toda noite), mesmo sem ninguém abrir o Estoque
setInterval(() => { for (const l of C.get().lojas) { try { require('./src/pedido').atualizarDisp(l.id); } catch (e) { console.error(`[fora de linha] ${l.id}:`, e.message); } } }, 60 * 60e3).unref();
// lista de espera: vendedoras sempre; gerente só com a tela liberada em Configurações → Usuários
app.use('/api/espera', (req, res, next) => (req.perfil === 'vendedor' || podeTela(req, 'espera') ? next() : res.status(403).json({ erro: 'Sem permissão.' })));
app.get('/api/espera', async (req, res) => {
  const loja = lojaEsp(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  let raw = null;
  try { raw = (await dadosLoja(loja)).raw; } catch { /* ok */ }
  try { await avaliarEspera(loja); } catch (e) { console.error('[espera]', e.message); }
  const d = ESP.ler(loja.id);
  const vMap = new Map();
  const addV = (n) => {
    const s = String(n || '').trim();
    if (!s || /^SEM VENDEDOR$|^COLEGA \d+$/i.test(s)) return;
    const k = ESP.ESQ(s);
    if (!k) return;
    if (!vMap.has(k) || (vMap.get(k) === vMap.get(k).toLowerCase() && s !== s.toLowerCase())) vMap.set(k, s);
  };
  const corte = C.diaSP(Date.now() - 120 * 864e5);
  if (raw && Array.isArray(raw.vendas)) for (const v of raw.vendas) if (!v.data || v.data >= corte) addV(v.vendedor);
  for (const p of d.pedidos) addV(p.vendedora);
  const vendedoras = [...vMap.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  res.json({ pedidos: d.pedidos, modelo: d.modelo, dias: ESP.DIAS_COMPRA, podeModelo: req.perfil !== 'vendedor', lojaNome: loja.nome, vendedoras });
});
// produtos para escolher: o cadastro do AppNext (com o tamanho) e o que já foi vendido; marca o que está em falta
const espProdCache = new Map(); // loja -> { tab, raw, m }
app.get('/api/espera/produtos', async (req, res) => {
  const loja = lojaEsp(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const q = ESP.ESQ(req.query.q || '');
  if (q.length < 2) return res.json({ produtos: [] });
  // o mapa descrição → vendidos só é refeito quando as vendas ou o cadastro da loja mudam (a busca roda a cada tecla)
  const tab = TAB.resumo(loja.id);
  let dl = null;
  try { dl = await dadosLoja(loja); } catch { /* ok */ }
  const raw = dl ? dl.raw : null; // objeto novo a cada recarga das vendas da loja
  let memo = espProdCache.get(loja.id);
  if (!memo || memo.tab !== tab || memo.raw !== raw || !raw) {
    const novo = new Map();
    for (const i of (tab || { itens: [] }).itens || []) if (i.desc && i.preco !== 0.01) novo.set(ESP.ESQ(i.desc), { desc: i.desc, cod: String(i.cod), vendidos: 0 });
    try { for (const v of raw.vendas) { const k = ESP.ESQ(v.descricao); const a = novo.get(k) || novo.set(k, { desc: v.descricao, cod: v.cod != null ? String(v.cod) : null, vendidos: 0 }).get(k); a.vendidos += v.qtd || 0; if (!a.cod && v.cod != null) a.cod = String(v.cod); } } catch { /* ok */ }
    memo = { tab, raw, m: novo };
    if (raw) espProdCache.set(loja.id, memo); else espProdCache.delete(loja.id);
  }
  const m = memo.m;
  const est = ES.atual(loja.id);
  // chá a granel sem o pacote ("valeriana"): o item do estoque em kg, que vale para qualquer tamanho
  const gen = ((est && est.itens) || []).filter((i) => i.un === 'Kg' && ESP.ESQ(i.desc).includes(q)).slice(0, 4)
    .map((i) => ({ desc: i.desc, cod: String(i.cod), generico: true, vendidos: 0, falta: !(i.qtd > 0) }));
  const achou0 = [...m.entries()].filter(([k]) => k.includes(q)).map(([, x]) => x).sort((a, b) => b.vendidos - a.vendidos).slice(0, 12).map((x) => {
    const cods = ESP.codsEstoque(x, est);
    const qtd = cods.length ? cods.reduce((s, c) => { const i = ((est && est.itens) || []).find((y) => String(y.cod) === c); return s + (i ? Math.max(0, i.qtd || 0) : 0); }, 0) : null;
    return { desc: x.desc, cod: x.cod, vendidos: Math.round(x.vendidos), falta: qtd == null ? null : qtd <= 0 };
  });
  res.json({ produtos: [...gen, ...achou0.filter((x) => !gen.some((g) => ESP.ESQ(g.desc) === ESP.ESQ(x.desc)))] });
});
const ESPERA_BUSCAS_DIA = +process.env.ESPERA_BUSCAS_DIA || 300, ESPERA_BUSCAS_AVISO = Math.ceil(ESPERA_BUSCAS_DIA / 2);
const buscasEspera = new Map(); // usuário -> { dia, n }
// clientes para escolher (nome, CPF ou celular): no máximo 8; sem acesso a Clientes exige 6+ dígitos para CPF/celular e aplica limite de consultas
app.get('/api/espera/clientes', async (req, res) => {
  const loja = lojaEsp(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const amplo = podeClientes(req);
  const minDig = amplo ? 3 : 6;
  const q = String(req.query.q || '').trim(), qn = ESP.ESQ(q), qd = q.replace(/\D/g, '');
  // sem acesso a Clientes (vendedora): o nome precisa de 4 letras ou mais, para a busca não virar uma lista da base
  const letras = qn.replace(/[^a-z]/g, '').length;
  const temNome = letras >= (amplo ? 3 : 4);
  const temDig = qd.length >= minDig;
  if (!temNome && !temDig) return res.json({ clientes: [], ...(!amplo && letras === 3 ? { dica: 'Digite pelo menos 4 letras do nome (ou o CPF/celular).' } : {}) });
  if (!amplo) {
    const kEsp = 'espcli:' + req.user;
    if (tooMany(kEsp, 45, 60e3)) return res.status(429).json({ erro: 'Muitas buscas seguidas. Aguarde um instante.' });
    // teto do dia por pessoa (300) e registro na auditoria quando o volume foge do normal (150 e 300)
    const dia = C.hojeBR();
    let d = buscasEspera.get(req.user);
    if (!d || d.dia !== dia) { d = { dia, n: 0 }; buscasEspera.set(req.user, d); }
    if (d.n >= ESPERA_BUSCAS_DIA) {
      if (!d.avisouTeto) { d.avisouTeto = true; C.auditar(req.user, 'chegou ao limite diário de buscas de clientes na Lista de espera', loja.id, { loja: loja.id, buscas: d.n }); }
      return res.status(429).json({ erro: 'Você chegou ao limite de buscas de clientes de hoje. Fale com a gerente.' });
    }
    d.n++;
    if (d.n === ESPERA_BUSCAS_AVISO) C.auditar(req.user, 'fez muitas buscas de clientes na Lista de espera hoje', loja.id, { loja: loja.id, buscas: d.n });
    falhou(kEsp);
  }
  let cl = [];
  try { cl = require('./src/celulares').aplicar((await dadosLoja(loja)).raw.clientes || [], require('./src/celulares').ler(loja.id)); } catch { /* ok */ }
  const out = [];
  for (const c of cl) {
    const cel = String(c.celular || '').replace(/\D/g, '');
    const ok = (temDig && (String(c.cpf).startsWith(qd) || cel.includes(qd))) || (temNome && ESP.ESQ(c.nome).includes(qn));
    if (ok) out.push({ cpf: c.cpf, nome: c.nome || '', celular: cel });
    if (out.length >= 8) break;
  }
  res.json({ clientes: out });
});
app.use('/api/espera', (req, res, next) => {
  if (req.method === 'GET') return next();
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  next();
});
app.post('/api/espera', express.json({ limit: '20kb' }), (req, res) => {
  const loja = lojaEsp(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const r = ESP.criar(loja.id, req.body || {}, req.user, ES.atual(loja.id));
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'anotou na lista de espera', loja.id, { loja: loja.id, itens: r.ok.itens.map((i) => i.desc).join(', ').slice(0, 200) });
  res.json({ ok: true, pedido: r.ok });
});
app.post('/api/espera/:id/:acao', express.json({ limit: '2kb' }), (req, res) => {
  const loja = lojaEsp(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const r = ESP.acao(loja.id, String(req.params.id), String(req.params.acao), req.user, req.body || {});
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json({ ok: true, pedido: r.ok });
});
app.put('/api/espera/modelo', express.json({ limit: '4kb' }), (req, res) => {
  const loja = lojaEsp(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Sem permissão.' });
  const r = ESP.salvarModelo(loja.id, (req.body || {}).modelo);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json({ ok: true, modelo: r.ok });
});

// ---------- ⭐ sugestões da equipe para o pedido (Estoque → Sugestões): todos os perfis da loja marcam; quem faz o pedido decide ----------
const SUG = require('./src/sugestoes');
const lojaSug = (req) => req.lojas.find((l) => l.id === String((req.body && req.body.loja) || req.query.loja || ''));
const decidePedido = (req) => podeTela(req, 'pedido');
// vendedora sempre; gerente só com a tela ⭐ Sugestões marcada em Configurações → Usuários
const podeSugestoes = (req) => req.perfil === 'vendedor' || podeTela(req, 'sugestoes');
app.use('/api/sugestoes', (req, res, next) => {
  if (!podeSugestoes(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  if (req.method !== 'GET' && req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  next();
});
app.get('/api/sugestoes', (req, res) => {
  const loja = lojaSug(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try { SUG.avaliarNotas(loja.id, ES.notas(loja.id)); } catch (e) { console.error('[sugestões] notas:', e.message); }
  const todos = decidePedido(req);
  res.json({ itens: SUG.comEstoque(SUG.lista(loja.id, req.user, todos), ES.atual(loja.id), todos), todos, motivos: SUG.MOTIVOS });
});
// produtos para marcar: só nome e situação (tem / pouco / acabou) — nunca quantidade nem custo
app.get('/api/sugestoes/produtos', (req, res) => {
  const loja = lojaSug(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  res.json({ produtos: SUG.buscar(ES.atual(loja.id), String(req.query.q || '').slice(0, 60)) });
});
app.post('/api/sugestoes', express.json({ limit: '4kb' }), (req, res) => {
  const loja = lojaSug(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const u = C.usuario(req.user) || {};
  const r = SUG.criar(loja.id, req.body || {}, req.user, u.vendedor || u.nome || req.user, ES.atual(loja.id));
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'sugeriu produto para o pedido', loja.id, { loja: loja.id, produto: r.ok.desc });
  // quem decide o pedido fica sabendo (menos quem sugeriu)
  PUSH.avisarDepois({ tipo: 'sugestao', loja: loja.id, chave: `sugestao:${loja.id}:${r.ok.id}`, menos: req.user, titulo: `⭐ Sugestão para o pedido · ${loja.nome}`, texto: `${u.vendedor || u.nome || req.user} sugeriu ${r.ok.desc}.`, link: '/#pedido' });
  res.json({ ok: true, sugestao: SUG.comEstoque([r.ok], ES.atual(loja.id), decidePedido(req))[0] });
});
app.post('/api/sugestoes/visto', express.json({ limit: '2kb' }), (req, res) => {
  const loja = lojaSug(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  res.json(SUG.visto(loja.id, req.user));
});
app.post('/api/sugestoes/:id/retirar', express.json({ limit: '2kb' }), (req, res) => {
  const loja = lojaSug(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const r = SUG.retirar(loja.id, String(req.params.id), req.user, decidePedido(req));
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'tirou a estrela de um produto', loja.id, { loja: loja.id, produto: r.ok.desc });
  res.json({ ok: true, sugestao: r.ok });
});
// no Pedido: "Não agora" (com motivo) e registrar o pedido nas sugestões
app.put('/api/pedido/sugestoes/decisao', express.json({ limit: '4kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!decidePedido(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = lojaSug(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const r = SUG.decidir(loja.id, String((req.body || {}).cod || ''), req.body || {}, req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json({ ok: true, decisao: r.ok });
});
app.post('/api/pedido/sugestoes/fechar', express.json({ limit: '300kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!decidePedido(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = lojaSug(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const r = SUG.fechar(loja.id, (req.body || {}).itens, req.user);
  C.auditar(req.user, 'respondeu as sugestões da equipe no pedido', loja.id, { loja: loja.id, ...r.ok });
  res.json({ ok: true, ...r.ok });
});

// "Não fiz este pedido": o que estava "aguardando entrega" volta para o próximo pedido (um produto, ou tudo o que não foi confirmado)
app.post('/api/pedido/sugestoes/devolver', express.json({ limit: '100kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!decidePedido(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = lojaSug(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try {
    const cods = Array.isArray((req.body || {}).cods) ? req.body.cods.slice(0, 500).map(String) : null;
    const r = SUG.devolver(loja.id, cods, req.user);
    C.auditar(req.user, 'marcou sugestões da equipe como não pedidas', loja.id, { loja: loja.id, devolvidas: r.ok, ...(cods ? { produtos: cods.slice(0, 30) } : { todas: true }) });
    res.json({ ok: true, devolvidas: r.ok });
  } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
});

// pedido obrigatório da franquia: criar, alterar, encerrar, reabrir, apagar
app.put('/api/pedido/obrigatorio', express.json({ limit: '100kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!podeTela(req, 'pedido')) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const b = req.body || {};
  const r = PED.alterarObrig(loja.id, b, req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  const o = r.item || {};
  C.auditar(req.user, b.apagar ? 'apagou pedido obrigatório' : b.encerrar ? 'encerrou pedido obrigatório' : b.reabrir ? 'reabriu pedido obrigatório' : b.id ? 'alterou pedido obrigatório' : 'cadastrou pedido obrigatório', loja.id,
    { loja: loja.id, nome: o.nome, itens: o.itens ? o.itens.length : undefined, valor: o.itens ? Math.round(o.itens.reduce((s, x) => s + (x.preco || 0) * x.qtd, 0)) : undefined });
  res.json({ ok: true, obrigatorio: r.ok });
});
app.put('/api/pedido/cfg', express.json({ limit: '20kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!podeTela(req, 'pedido')) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const v = PED.validarCfg(req.body || {});
  if (v.erro) return res.status(400).json({ erro: v.erro });
  C.alterar((cfg) => { cfg.lojas.find((l) => l.id === loja.id).pedidoCfg = v.ok; });
  C.auditar(req.user, 'alterou configuração do pedido', loja.id, { loja: loja.id, cmvPct: v.ok.cmvPct, dias: v.ok.dias, proporcao: v.ok.proporcao ? `${v.ok.proporcao.cha}/${v.ok.proporcao.env}/${v.ok.proporcao.acess}%` : 'pelas vendas' });
  res.json({ ok: true, cfg: v.ok });
});
app.get('/api/pedido/acesso', (req, res) => {
  if (req.perfil !== 'admin' && req.perfil !== 'franqueado') return res.status(403).json({ erro: 'Só o administrador ou o franqueado da loja.' }); // req.lojas: só as lojas dele
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  res.json(PED.acesso(loja.id));
});
app.put('/api/pedido/acesso', express.json({ limit: '4kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (req.perfil !== 'admin' && req.perfil !== 'franqueado') return res.status(403).json({ erro: 'Só o administrador ou o franqueado da loja.' }); // req.lojas: só as lojas dele
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const b = req.body || {};
  const r = PED.gravarAcesso(loja.id, { usuario: b.usuario, senha: b.senha, apagar: !!b.apagar }, req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, b.apagar ? 'removeu o login do Sistema de Pedidos' : 'alterou o login do Sistema de Pedidos', loja.id, { loja: loja.id });
  res.json(PED.acesso(loja.id));
});
// carrinho no navegador: gera o código e o link do site (admin e franqueado)
app.post('/api/pedido/carrinho', express.json({ limit: '200kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (!podeTela(req, 'pedido')) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const v = PED.validarItens(loja.id, (req.body || {}).itens);
  if (v.erro) return res.status(400).json({ erro: v.erro });
  const r = PED.criarCodigo(loja.id, v.ok, req.user);
  C.auditar(req.user, 'gerou o carrinho do Sistema de Pedidos', loja.id, { loja: loja.id, itens: v.ok.length });
  res.json({ ok: true, ...r, fora: v.fora });
});
app.post('/api/pedido/robo', express.json({ limit: '200kb' }), async (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (req.perfil !== 'admin' && req.perfil !== 'franqueado') return res.status(403).json({ erro: 'Só o administrador ou o franqueado da loja aciona o robô do Sistema de Pedidos.' }); // req.lojas: só as lojas dele
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor da VPS não está ativo.' });
  const b = req.body || {};
  let fora = [];
  if (b.acao === 'carrinho') {
    const v = PED.validarItens(loja.id, b.itens);
    if (v.erro) return res.status(400).json({ erro: v.erro });
    fora = v.fora;
    PED.gravarEntrada(loja.id, v.ok, req.user, !!b.refazer);
  } else if (b.acao !== 'catalogo') return res.status(400).json({ erro: 'Ação inválida.' });
  try {
    const r = await COL.pedido(loja.id, req.user, { acao: b.acao, somar: !!(b.somar || b.refazer) });
    if (r.status !== 200) return res.status(r.status).json({ erro: r.json.erro || 'Falha no coletor.' });
    C.auditar(req.user, b.acao === 'carrinho' ? 'mandou montar o carrinho do pedido' : 'pediu o catálogo do Sistema de Pedidos', loja.id, { loja: loja.id, itens: Array.isArray(b.itens) ? b.itens.length : 0 });
    res.json({ ok: true, fora });
  } catch (e) { res.status(502).json({ erro: C.msgErro(e) }); }
});

// ---------- cadastro de clientes do FIXE: lê o e-mail da exportação (Gmail da loja) e importa ----------
const FX = require('./src/fixemail');
const CADX = require('./src/cadastro');
const fixeOcupado = new Set(), fixeUltimo = new Map();
const emailBaseFixe = (s) => String(s || '').trim().toLowerCase().replace(/\+[^@]+@/, '@');
async function verificarFixe(l) {
  fixeOcupado.add(l.id); fixeUltimo.set(l.id, Date.now());
  try {
    const NOTIF = require('./src/notificacoes');
    const nc = NOTIF.ler(), x = NOTIF.cfgLoja(nc, l.id);
    const { pedido } = FX.situacao(l.id);
    const globalCompativel = nc.email && nc.email.user && nc.email.pass && pedido && pedido.email && emailBaseFixe(nc.email.user) === emailBaseFixe(pedido.email);
    const smtp = x.email && x.email.user && x.email.pass ? x.email : globalCompativel ? nc.email : null;
    const r = await FX.verificar(l.id, smtp, async (buf) => {
      // Logs (movimentos do programa de fidelidade) ou Base de leads (cadastro): decide pelo conteúdo
      const FI = require('./src/fidelidade');
      const { linhasDeBuffer } = require('./src/sources');
      let res;
      if (FI.ehLogs(await linhasDeBuffer(buf))) {
        res = await FI.importar(l.id, buf);
        C.auditar('coletor', 'importou logs do FIXE', l.id, { loja: l.id, movimentos: res.movimentos, clientes: res.clientes });
      } else {
        res = { tipo: 'leads', ...(await CADX.importar(l.id, buf)) };
        C.auditar('coletor', 'importou cadastro de clientes do FIXE', l.id, { loja: l.id, novos: res.novos, atualizados: res.atualizados, total: res.total });
      }
      packCache.clear(); dadosLoja(l, true).catch(() => {});
      return res;
    });
    if (r) console.log(`[fixe] ${l.id}: ${r.ok ? 'importado' : r.erro}`);
  } catch (e) { console.error(`[fixe] ${l.id}:`, e.message); }
  finally { fixeOcupado.delete(l.id); }
}

// ---------- envios para a contabilidade (só admin e franqueado; saem do Gmail da loja) ----------
// 1) fechamento do mês (comissões) com o PDF anexado  2) faturamento do mês com os XMLs das notas
const XA = require('./src/xmlarquivos');
const EMAIL_OK = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
/** confere o pedido; devolve { loja, lista, sub, corpo, smtp, ym } ou responde o erro */
function pedidoContabilidade(req, res) {
  if (req.get('X-Painel') !== '1') { res.status(403).json({ erro: 'Pedido inválido.' }); return null; }
  if (!podeContabilidade(req)) { res.status(403).json({ erro: 'Só admin e franqueado enviam para a contabilidade.' }); return null; }
  const b = req.body || {};
  const loja = req.lojas.find((l) => l.id === String(b.loja || ''));
  if (!loja) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  const lista = [...new Set((Array.isArray(b.para) ? b.para : String(b.para || '').split(/[,;\s]+/)).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (!lista.length) { res.status(400).json({ erro: 'Informe o e-mail da contabilidade.' }); return null; }
  if (lista.length > 10) { res.status(400).json({ erro: 'No máximo 10 destinatários.' }); return null; }
  const ruim = lista.find((e) => !EMAIL_OK.test(e) || e.length > 120);
  if (ruim) { res.status(400).json({ erro: `E-mail inválido: ${ruim}` }); return null; }
  const sub = String(b.assunto || '').replace(/[\r\n]/g, ' ').trim().slice(0, 200);
  if (!sub) { res.status(400).json({ erro: 'Informe o assunto.' }); return null; }
  if (typeof b.html !== 'string' || !b.html || b.html.length > 400000) { res.status(400).json({ erro: 'Corpo do e-mail inválido.' }); return null; }
  const ym = /^\d{4}-\d{2}$/.test(b.ym || '') ? b.ym : null;
  const NOTIF = require('./src/notificacoes');
  const nc = NOTIF.ler();
  const x = NOTIF.cfgLoja(nc, loja.id);
  const smtp = x.email && x.email.host && x.email.from ? x.email : (req.perfil === 'admin' && nc.email && nc.email.host && nc.email.from ? nc.email : null);
  if (!smtp) { res.status(400).json({ erro: 'A loja ainda não tem o Gmail configurado (Configurações → Lojas → Fechamento do dia).' }); return null; }
  // tira scripts e eventos do corpo (vai como e-mail; nada disso funciona lá)
  const corpo = b.html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return { loja, lista, sub, corpo, smtp, ym, NOTIF };
}
async function enviarContabilidade(req, res, p, anexos, acao) {
  try { await p.NOTIF.enviarEmail(p.lista.join(', '), p.sub, p.sub, p.corpo, p.smtp, anexos); }
  catch (e) { return res.status(502).json({ erro: `Não foi possível enviar: ${C.msgErro(e)}` }); }
  C.alterar((cfg) => { const l = cfg.lojas.find((y) => y.id === p.loja.id); if (l) l.contabilidade = p.lista; });
  C.auditar(req.user, acao, p.loja.id, { loja: p.loja.id, ym: p.ym || undefined, para: p.lista });
  res.json({ ok: true, para: p.lista });
}
const nomeArq = (n, ext) => String(n || 'arquivo').replace(/[^\w.\-]+/g, '_').replace(new RegExp(`(\\.${ext})?$`, 'i'), '').slice(0, 80) + '.' + ext;
app.post('/api/contabilidade/enviar', express.json({ limit: '16mb' }), async (req, res) => {
  const p = pedidoContabilidade(req, res);
  if (!p) return;
  let anexos = null;
  if (req.body.pdf) {
    const buf = Buffer.from(String(req.body.pdf), 'base64');
    if (buf.length > 12 * 1024 * 1024 || buf.subarray(0, 5).toString() !== '%PDF-') return res.status(400).json({ erro: 'PDF inválido.' });
    anexos = [{ filename: nomeArq(req.body.nomePdf || 'fechamento', 'pdf'), content: buf, contentType: 'application/pdf' }];
  }
  await enviarContabilidade(req, res, p, anexos, 'enviou fechamento do mês para a contabilidade');
});
// faturamento: resumo dos XMLs guardados e envio com o .zip
app.get('/api/xmls/resumo', (req, res) => {
  if (!podeContabilidade(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try { res.json(XA.resumo(loja.id, String(req.query.ym || ''))); } catch (e) { res.status(400).json({ erro: C.msgErro(e) }); }
});
app.post('/api/faturamento/enviar', express.json({ limit: '1mb' }), async (req, res) => {
  const p = pedidoContabilidade(req, res);
  if (!p) return;
  if (!p.ym) return res.status(400).json({ erro: 'Mês inválido.' });
  const r = XA.resumo(p.loja.id, p.ym);
  if (!r.ativos.notas && !r.cancelados.notas) return res.status(400).json({ erro: 'Ainda não há XMLs guardados deste mês. Importe o XML do mês em Configurações → Coletor → Histórico ("Só XML").' });
  const zip = await XA.zipar(p.loja.id, p.ym);
  if (zip.length > 24 * 1024 * 1024) return res.status(400).json({ erro: `O .zip ficou com ${Math.round(zip.length / 1024 / 1024)} MB; o Gmail aceita até 25 MB.` });
  await enviarContabilidade(req, res, p, [{ filename: nomeArq(req.body.nomeZip || `xml-${p.loja.id}-${p.ym}`, 'zip'), content: zip, contentType: 'application/zip' }], 'enviou faturamento do mês (XML) para a contabilidade');
});

// ---------- feriados trabalhados (horas por pessoa; vão para o PDF do fechamento) ----------
// admin, franqueado e gerente com a tela Comissionamento
// classificação de produtos (rede): todos veem; só o administrador muda
app.get('/api/classificacao', (req, res) => res.json({ produtos: CLS.ler().produtos }));
app.put('/api/classificacao', express.json({ limit: '20kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (req.perfil !== 'admin') return res.status(403).json({ erro: 'Só o administrador muda a classificação dos produtos.' });
  const { produto, classe } = req.body || {};
  try {
    const r = CLS.definir(produto, classe || null, req.user);
    C.auditar(req.user, r ? 'classificou produto' : 'tirou classificação de produto', 'produtos', { produto: CLS.chave(produto), classe: classe || null });
    packCache.clear();
    res.json({ ok: true, item: r });
  } catch (e) { res.status(400).json({ erro: C.msgErro(e) }); }
});
app.put('/api/feriados', express.json({ limit: '200kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const telas = C.telasDo(C.usuario(req.user));
  const pode = req.perfil === 'admin' || req.perfil === 'franqueado' || (req.perfil === 'gerente' && (telas || []).includes('comissionamento'));
  if (!pode) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(404).json({ erro: 'Loja não encontrada.' });
  const { ym, horas, locais, horarios } = req.body || {};
  const DATA = /^\d{4}-\d{2}-\d{2}$/;
  if (!/^\d{4}-\d{2}$/.test(ym || '')) return res.status(400).json({ erro: 'Mês inválido.' });
  if (!horas || typeof horas !== 'object') return res.status(400).json({ erro: 'Horas inválidas.' });
  const limpo = {};
  for (const [data, porPessoa] of Object.entries(horas)) {
    if (!DATA.test(data) || !data.startsWith(ym) || !porPessoa || typeof porPessoa !== 'object') return res.status(400).json({ erro: `Data inválida: ${data}` });
    for (const [nome, min] of Object.entries(porPessoa)) {
      if (min == null || min === '') continue;
      const m = Number(min);
      if (!Number.isInteger(m) || m < 0 || m > 24 * 60) return res.status(400).json({ erro: `Horas inválidas para ${nome} em ${data}.` });
      (limpo[data] ||= {})[String(nome).trim().toUpperCase().slice(0, 60)] = m; // 0 = editado para "não trabalhou" (não volta o automático)
    }
  }
  let locaisLimpos = null;
  if (Array.isArray(locais)) {
    if (locais.length > 60) return res.status(400).json({ erro: 'Feriados locais demais.' });
    locaisLimpos = [];
    for (const f of locais) {
      const nome = String((f && f.nome) || '').replace(/[\r\n]/g, '').trim().slice(0, 60);
      if (!nome || !DATA.test((f && f.data) || '')) return res.status(400).json({ erro: 'Confira data e nome dos feriados locais.' });
      locaisLimpos.push({ data: f.data, nome, anual: f.anual !== false });
    }
  }
  // horário de abertura de cada feriado do mês: { data: { abre, fecha, fechado } } (vazio = padrão da loja)
  const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const horLimpos = {};
  if (horarios && typeof horarios === 'object') {
    for (const [data, hr] of Object.entries(horarios)) {
      if (!DATA.test(data) || !data.startsWith(ym) || !hr || typeof hr !== 'object') return res.status(400).json({ erro: `Horário inválido em ${data}.` });
      if (hr.fechado) { horLimpos[data] = { fechado: true }; continue; }
      if (!HM.test(hr.abre || '') || !HM.test(hr.fecha || '') || hr.abre >= hr.fecha) return res.status(400).json({ erro: `Confira o horário do feriado de ${data} (abertura antes do fechamento).` });
      horLimpos[data] = { abre: hr.abre, fecha: hr.fecha, fechado: false };
    }
  }
  C.alterar((cfg) => {
    const l = cfg.lojas.find((x) => x.id === loja.id);
    if (horarios && typeof horarios === 'object') {
      l.feriadosHorario = Object.fromEntries(Object.entries(l.feriadosHorario || {}).filter(([d]) => !d.startsWith(ym)));
      Object.assign(l.feriadosHorario, horLimpos);
    }
    l.feriadosHoras = l.feriadosHoras || {};
    if (Object.keys(limpo).length) l.feriadosHoras[ym] = limpo; else delete l.feriadosHoras[ym];
    if (locaisLimpos) l.feriadosLocais = locaisLimpos;
  });
  C.auditar(req.user, 'alterou feriados trabalhados', loja.id, { loja: loja.id, mes: ym, dias: Object.keys(limpo).length });
  packCache.clear();
  res.json({ ok: true });
});

// ---------- ajustes manuais na escala do mês ----------
// admin, franqueado e gerente com o Mapa de calor
app.put('/api/escala-ajustes', express.json({ limit: '200kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const telas = C.telasDo(C.usuario(req.user));
  const pode = req.perfil === 'admin' || req.perfil === 'franqueado' || (req.perfil === 'gerente' && (telas || []).includes('mapa'));
  if (!pode) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  const ym = String(req.query.ym || '');
  if (!loja || !/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ erro: 'Escolha a loja e o mês.' });
  const aj = (req.body && req.body.ajustes) || {};
  if (!aj || typeof aj !== 'object') return res.status(400).json({ erro: 'Ajustes inválidos.' });
  const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const limpo = {};
  for (const [data, porPessoa] of Object.entries(aj)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !data.startsWith(ym) || !porPessoa || typeof porPessoa !== 'object') return res.status(400).json({ erro: `Data inválida: ${data}` });
    for (const [nome, a] of Object.entries(porPessoa)) {
      const n = String(nome).trim().toUpperCase().slice(0, 40);
      if (!a || !['folga', 'trab'].includes(a.tipo)) return res.status(400).json({ erro: `Ajuste inválido de ${nome} em ${data}.` });
      if (a.tipo === 'trab' && (!HM.test(a.ini || '') || !HM.test(a.fim || '') || a.ini >= a.fim)) return res.status(400).json({ erro: `Confira o horário de ${nome} em ${data} (entrada antes da saída).` });
      (limpo[data] ||= {})[n] = { ...(a.tipo === 'trab' ? { tipo: 'trab', ini: a.ini, fim: a.fim } : { tipo: 'folga' }), ...(a.repete === true ? { repete: true } : {}) }; // repete: vai para os próximos meses ao replicar
    }
  }
  C.alterar((cfg) => {
    const l = cfg.lojas.find((x) => x.id === loja.id);
    l.escalaAjustes = l.escalaAjustes || {};
    if (Object.keys(limpo).length) l.escalaAjustes[ym] = limpo; else delete l.escalaAjustes[ym];
  });
  C.auditar(req.user, 'ajustou escala do mês', loja.id, { loja: loja.id, mes: ym, dias: Object.keys(limpo).length });
  packCache.clear();
  res.json({ ok: true });
});

// ---------- configurações (lojas, usuários, coletor) ----------
ADMIN.registrar(app, {
  dadosLoja, MAX_UPLOAD_MB, NOTIF, arquivoLogo, LOGO_EXT,
  obterIndicadores: async (id) => { const l = C.get().lojas.find((x) => x.id === id); return l ? dadosParaIndicadores(l) : null; },
  pacoteLimpar: () => packCache.clear(),
  rawDe: (id) => cacheLoja.get(id)?.raw || null,
  totaisSemEG: (id) => { const raw = cacheLoja.get(id)?.raw; return raw ? IND.totaisSemEG(raw.vendas) : {}; },
  // nomes de vendedores que aparecem nas vendas (para ligar o usuário "vendedor" ao nome no sistema)
  vendedoresDe: (id) => {
    const raw = cacheLoja.get(id)?.raw;
    if (!raw) return [];
    const ult = new Map();
    for (const v of raw.vendas) if (v.vendedor && !/^SEM VENDEDOR$/i.test(v.vendedor.trim())) ult.set(v.vendedor, v.data);
    return [...ult].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([nome, ultima]) => ({ nome, ultima }));
  },
});

// ---------- script da loja no GitHub Actions ----------
const scriptCache = new Map(); // loja -> { at, execucao }
const disparos = new Map();    // loja -> { em, por }
const COOLDOWN_MS = 2 * 60e3;

function lojaDoPedido(req) {
  return req.lojas.find((l) => l.id === String(req.query.loja || ''));
}

app.get('/api/script', async (req, res) => {
  // andamento do coletor (horários, janela, execução): não é da vendedora
  if (req.perfil === 'vendedor') return res.status(403).json({ disponivel: false, motivo: 'Sem permissão.' });
  const loja = lojaDoPedido(req);
  if (!loja) return res.json({ disponivel: false, motivo: 'Selecione uma loja.' });
  const admin = (C.get().usuarios[req.user]?.lojas || []).includes('*') || req.user === '*' || req.perfil === 'franqueado'; // log da coleta: admin ou franqueado da loja (a loja já veio de req.lojas)
  // 1º) script rodando na própria VPS (coletor)
  if (COL.ativo()) {
    try {
      const s = await COL.status(loja.id, admin);
      if (s.configurada) return res.json({ disponivel: true, origem: 'vps', horarios: s.horarios, janela: s.janela, temFixe: s.temFixe, execucao: s.execucao });
    } catch (e) {
      console.error(`[script] coletor: ${e.message}`);
      return res.json({ disponivel: true, origem: 'vps', erro: C.msgErro(e) });
    }
  }
  // 2º) GitHub Actions
  if (!loja.github) return res.json({ disponivel: false, motivo: 'O script desta loja ainda não foi ligado ao painel.' });
  if (!process.env.GITHUB_TOKEN) return res.json({ disponivel: false, motivo: 'Falta configurar o acesso ao GitHub no servidor.' });
  const c = scriptCache.get(loja.id);
  const d = disparos.get(loja.id);
  try {
    const valido = c && Date.now() - c.at < 10e3;
    let execucao = valido ? c.execucao : null;
    if (!valido) {
      execucao = await GH.ultimaExecucao(loja.github);
      scriptCache.set(loja.id, { at: Date.now(), execucao });
    }
    // logo após o disparo o GitHub leva alguns segundos para criar a execução
    const aguardando = d && Date.now() - d.em < 90e3 && (!execucao || new Date(execucao.criado).getTime() < d.em - 5e3);
    res.json({ disponivel: true, origem: 'github', execucao, aguardando: !!aguardando, disparo: d ? { em: new Date(d.em).toISOString(), por: d.por } : null });
  } catch (e) {
    console.error(`[script] ${loja.id}: ${e.message}`);
    res.json({ disponivel: true, origem: 'github', erro: C.msgErro(e).replace(/Bearer\s+\S+/g, '') });
  }
});

app.post('/api/script', express.json({ limit: '2kb' }), async (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (req.perfil !== 'admin' && req.perfil !== 'franqueado') return res.status(403).json({ erro: 'Só o administrador ou o franqueado da loja pode rodar a coleta.' }); // lojaDoPedido: só as lojas dele
  const loja = lojaDoPedido(req);
  if (!loja) return res.status(400).json({ erro: 'Loja inválida.' });
  if (COL.ativo()) {
    try {
      const s = await COL.status(loja.id);
      if (s.configurada) {
        const ITENS = ['vendas', 'xml', 'estoque', 'fixe'];
        const itens = Array.isArray(req.body && req.body.itens) ? req.body.itens.filter((i) => ITENS.includes(i)) : null;
        if (itens && !itens.length) return res.status(400).json({ erro: 'Marque pelo menos um item para buscar.' });
        const r = await COL.rodar(loja.id, req.user, itens);
        if (r.status === 200) console.log(`[script] ${req.user} acionou o script de ${loja.id} (VPS)`);
        return res.status(r.status === 200 ? 200 : r.status).json(r.status === 200 ? { ok: true } : { erro: r.json.erro || 'Falha no coletor.' });
      }
    } catch (e) {
      return res.status(502).json({ erro: C.msgErro(e) });
    }
  }
  if (!loja.github) return res.status(400).json({ erro: 'Loja sem script configurado.' });
  const d = disparos.get(loja.id);
  if (d && Date.now() - d.em < COOLDOWN_MS) return res.status(429).json({ erro: 'O script desta loja acabou de ser acionado. Aguarde alguns minutos.' });
  try {
    const atual = await GH.ultimaExecucao(loja.github);
    if (atual && (atual.estado === 'rodando' || atual.estado === 'na_fila')) {
      scriptCache.set(loja.id, { at: Date.now(), execucao: atual });
      return res.status(409).json({ erro: 'O script já está rodando.', execucao: atual });
    }
    await GH.disparar(loja.github);
    disparos.set(loja.id, { em: Date.now(), por: req.user });
    scriptCache.delete(loja.id);
    console.log(`[script] ${req.user} acionou o script de ${loja.id} (${loja.github.repo})`);
    res.json({ ok: true });
  } catch (e) {
    console.error(`[script] ${loja.id}: ${e.message}`);
    res.status(502).json({ erro: C.msgErro(e) });
  }
});

app.get(['/', '/index.html'], (req, res) => {
  const b = obterBundle();
  responderAsset(req, res, b.html, 'text/html; charset=utf-8', false, `"html-${b.v}"`);
});
app.use(express.static(pub, { index: false, maxAge: 0 }));

// processa planilhas que chegam na entrada (coletor) sem esperar alguém abrir o painel
const tabOcupado = new Set(), estOcupado = new Set();
setInterval(() => {
  for (const l of C.get().lojas) {
    if (B.pendentes(l.id).length || XB.pendentes(l.id).length) dadosLoja(l, true).catch((e) => console.error(`[base] ${l.id}:`, e.message));
    if (FX.situacao(l.id).pedido && !fixeOcupado.has(l.id) && Date.now() - (fixeUltimo.get(l.id) || 0) > 110e3) verificarFixe(l);
    if (!tabOcupado.has(l.id) && TAB.pendentes(l.id).length) {
      tabOcupado.add(l.id);
      TAB.processar(l.id).then((r) => r.length && console.log(`[tabela] ${l.id}: ${r.map((x) => `${x.tipo} ${x.itens}`).join(', ')}`)).catch((e) => console.error(`[tabela] ${l.id}:`, e.message)).finally(() => tabOcupado.delete(l.id));
    }
    if (!estOcupado.has(l.id) && ES.pendentes(l.id).length) {
      estOcupado.add(l.id);
      ES.processar(l.id).then((r) => r && console.log(`[estoque] ${l.id}: ${r.itens} itens (${r.zerados} zerados)`)).catch((e) => console.error(`[estoque] ${l.id}:`, e.message)).finally(() => estOcupado.delete(l.id));
    }
  }
}, 30e3).unref();

// histórico das atualizações de cada loja (coletas, estoque, caixa, FIXE): a cada minuto
let eventosRodando = false;
setInterval(async () => {
  if (eventosRodando) return;
  eventosRodando = true;
  try {
    const EV = require('./src/eventos');
    for (const l of C.get().lojas) {
      try {
        const s = COL.ativo() ? await COL.status(l.id, true).catch(() => null) : null;
        EV.registrar(l.id, { execucao: s && s.configurada ? s.execucao : null, saldos: s && s.configurada && s.saldos ? s.saldos.ultima : null, fixeUltimo: FX.situacao(l.id).ultimo });
      } catch (e) { console.error(`[eventos] ${l.id}:`, e.message); }
    }
  } finally {
    eventosRodando = false;
  }
}, 60e3).unref();

// limpeza dos pedidos antigos ao robô (NF-e e inventário): 10 min depois de ligar e uma vez por dia.
// Só arquivos de envio (pedido/resultado/planilha); XML de nota, contagens e vendas nunca são apagados.
function limparEnviosAntigos() {
  for (const l of C.get().lojas) {
    try {
      const n = NFE.limparEnvios(l.id, DEV.lista(l.id).map((d) => d.id)) + INV.limparEnvios(l.id);
      if (n) console.log(`[limpeza] ${l.id}: ${n} arquivo(s) de envio antigos apagados`);
    } catch (e) { console.error(`[limpeza] ${l.id}:`, e.message); }
  }
}
setTimeout(limparEnviosAntigos, 10 * 60e3).unref();
setInterval(limparEnviosAntigos, 24 * 3600e3).unref();

// avisos de falha para o administrador (coleta, FIXE, loja sem vendas de ontem): a cada 5 minutos
if (!C.homolog()) setInterval(() => { // homologação: sem avisos por Telegram/e-mail (HOMOLOG-01)
  require('./src/avisos').verificar({ COL, FX, B, NOTIF: require('./src/notificacoes') }).catch((e) => console.error('[avisos]', e.message));
}, 5 * 60e3).unref();

// resumo diário (Telegram / e-mail) no horário configurado
if (!C.homolog()) NOTIF.agendar(async (id) => { const l = C.get().lojas.find((x) => x.id === id); return l ? dadosParaIndicadores(l) : null; });

/**
 * "Todas as lojas" pronto antes de alguém pedir (pedido do dono: demorava ao escolher). Junta as lojas, monta e comprime o
 * pacote do admin (o mesmo pedido que a tela faz: histórico parcial de 24 meses) e guarda no packCache. Quando nada mudou,
 * pacote() só compara a chave e sai na hora. Roda na subida e a cada 5 min; nunca em teste nem na apresentação.
 */
function desdeParcialSrv() {
  const h0 = C.diaSP(Date.now());
  return new Date(Date.UTC(+h0.slice(0, 4), +h0.slice(5, 7) - 1 - 24, 1)).toISOString().slice(0, 10);
}
let aquecendoTodas = false;
async function aquecerTodas() {
  if (aquecendoTodas) return;
  const lojas = (C.get().lojas || []);
  if (lojas.length < 2) return;
  aquecendoTodas = true;
  try { await pacote(lojas, false, 'completo', desdeParcialSrv()); } catch (e) { console.error('[dados] não aqueci "todas as lojas":', C.msgErro(e)); } finally { aquecendoTodas = false; }
}
if (process.env.NODE_ENV !== 'test') { setTimeout(aquecerTodas, 20e3).unref(); setInterval(aquecerTodas, 5 * 60e3).unref(); }

const srv = app.listen(PORT, () => {
  console.log(`Tea Shop painel em http://localhost:${PORT}`);
  if (!C.homolog()) SITE.agendar(); // preços do e-commerce: todo dia às 10h (a homologação não consulta: HOMOLOG-01)
  // Google Drive desativado: tira os IDs antigos do lojas.json (uma vez; fica cópia em config/backups)
  try {
    const tinham = [];
    C.alterar((cfg) => { for (const l of cfg.lojas) if (l.drive && Object.keys(l.drive).length) { tinham.push(l.id); l.drive = {}; } });
    if (tinham.length) { C.auditar('sistema', 'desativou o Google Drive', 'lojas', { lojas: tinham }); console.log(`[config] Google Drive desativado em: ${tinham.join(', ')}`); }
  } catch (e) { console.error('[config] não consegui limpar o Google Drive:', e.message); }
  // Robô do WhatsApp por pessoa (decisão do dono, 23/11/2026; ZAP-PERM-01): quem já usava (franqueado, ou gerente com Clientes,
  // de loja que já tinha o robô) continua liberado; os outros ficam desligados. Grava uma vez: depois só o admin muda.
  try {
    const lib = [];
    const atual = C.get();
    C.alterar((cfg) => {
      for (const [nome, u] of Object.entries(cfg.usuarios || {})) {
        if (typeof u.robo === 'boolean' || !['franqueado', 'gerente'].includes(u.perfil)) continue;
        const un = atual.usuarios[nome.toLowerCase()];
        u.robo = !!(un && C.roboLegado(un, atual));
        if (u.robo) lib.push(nome);
      }
    });
    if (lib.length) { C.auditar('sistema', 'manteve o robô do WhatsApp liberado (quem já usava)', 'usuarios', { usuarios: lib }); console.log(`[config] robô do WhatsApp: continuam liberados ${lib.join(', ')}`); }
  } catch (e) { console.error('[config] não consegui marcar o robô do WhatsApp por pessoa:', e.message); }
  // Preços e Site viraram telas próprias: o gerente que já via o Estoque e margem continua vendo as duas (uma vez)
  try {
    const mig = [];
    C.alterar((cfg) => {
      for (const [nome, u] of Object.entries(cfg.usuarios || {})) {
        if (u.telasV >= 8) continue;
        // v8: ⭐ Sugestões para o pedido virou tela que se libera: o gerente que já tinha telas escolhidas continua com ela
        if (u.perfil === 'gerente' && Array.isArray(u.telas) && !u.telas.includes('sugestoes')) { u.telas.push('sugestoes'); mig.push(nome); }
        if (u.telasV >= 7) { u.telasV = 8; continue; }
        // v7: Estoque → Validade (lotes do chá a granel): todo gerente acompanha
        if (u.perfil === 'gerente' && Array.isArray(u.telas) && !u.telas.includes('validade')) { u.telas.push('validade'); mig.push(nome); }
        if (u.telasV >= 6) { u.telasV = 8; continue; }
        // v6: Lista de espera virou uma tela que se libera: quem já tinha (todos os gerentes) continua com ela
        if (u.perfil === 'gerente' && Array.isArray(u.telas) && !u.telas.includes('espera')) { u.telas.push('espera'); mig.push(nome); }
        if (u.telasV >= 5) { u.telasV = 8; continue; }
        // v5: Estoque → Inventário (contagem pelo celular): quem vê o Estoque passa a ver o Inventário
        if (u.perfil === 'gerente' && Array.isArray(u.telas) && u.telas.includes('estoque') && !u.telas.includes('inventario')) { u.telas.push('inventario'); mig.push(nome); }
        if (u.telasV >= 4) { u.telasV = 8; continue; }
        // v4: o detalhamento de cupons saiu do Comissionamento e virou Vendas → Cupons
        if (u.perfil === 'gerente' && Array.isArray(u.telas) && u.telas.includes('comissionamento') && !u.telas.includes('cupons')) { u.telas.push('cupons'); mig.push(nome); }
        if (u.telasV >= 3) { u.telasV = 8; continue; }
        // v2: Preços e Site saíram do Estoque e margem; v3: o Estoque e margem virou Rentabilidade + Estoque (+ Notas fiscais)
        if (u.perfil === 'gerente' && Array.isArray(u.telas) && u.telas.includes('estoque')) {
          for (const t of [...(u.telasV >= 2 ? [] : ['precos', 'site']), 'rentab', 'notas']) if (!u.telas.includes(t)) u.telas.push(t);
          mig.push(nome);
        }
        u.telasV = 8;
      }
    });
    if (mig.length) C.auditar('sistema', 'organizou as telas no menu novo (Vendas → Cupons; Produtos, Estoque, Resultado)', 'usuarios', { usuarios: [...new Set(mig)] });
  } catch (e) { console.error('[config] telas do menu novo:', e.message); }
  for (const l of C.get().lojas) dadosLoja(l).catch((e) => console.error(`[dados] ${l.id}: primeira carga falhou:`, e.message));
});

let encerrando = false;
function desligar(sinal) {
  if (encerrando) return;
  encerrando = true;
  console.log(`[sistema] ${sinal}: encerrando com segurança…`);
  try { C.flushAcessos && C.flushAcessos(); } catch { /* ok */ }
  const t = setTimeout(() => process.exit(0), 8000);
  t.unref();
  srv.close(() => process.exit(0));
}
// rota assíncrona que falhar sem tratamento não derruba o painel para todo mundo: registra e segue
process.on('unhandledRejection', (e) => console.error('[erro sem tratamento]', e && e.stack ? e.stack : e));
process.on('SIGTERM', () => desligar('SIGTERM'));
process.on('SIGINT', () => desligar('SIGINT'));
