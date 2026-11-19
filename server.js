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
const encerrados = new Map(); // assinatura -> exp
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

// tentativas de login erradas: por IP (10 em 15 min), por IP+usuário (8 em 15 min) e teto global por usuário (30 em 15 min)
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
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of attempts) if (!a.length || now - a[a.length - 1] > JANELA) attempts.delete(k);
  for (const [s, exp] of encerrados) if (exp < now) encerrados.delete(s);
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
      ...((m.regras && m.regras.semMeta) || []),
      ...((m.regras && m.regras.semComissao) || []),
      ...((m.regras && m.regras.rateio && m.regras.rateio.exclui) || []),
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
        regras: m.regras ? {
          ...m.regras,
          semMeta: Array.isArray(m.regras.semMeta) ? m.regras.semMeta.map(mapearNome) : m.regras.semMeta,
          semComissao: Array.isArray(m.regras.semComissao) ? m.regras.semComissao.map(mapearNome) : m.regras.semComissao,
          rateio: m.regras.rateio ? { ...m.regras.rateio, exclui: Array.isArray(m.regras.rateio.exclui) ? m.regras.rateio.exclui.map(mapearNome) : [] } : m.regras.rateio,
        } : null,
      }));
    }
  }
  return out;
}
const packCache = new Map(); // chave -> { k, buf, gz, etag }
async function pacote(lojas, force, perfilDados = 'completo', desde = null) {
  const entradas = await Promise.all(lojas.map((l) => dadosLoja(l, force)));
  // metas vêm sempre da configuração atual (mudam pelo painel sem recarregar as planilhas)
  const cfgLojas = C.get().lojas;
  const metaCfgs = lojas.map((l, i) => {
    const atual = cfgLojas.find((x) => x.id === l.id) || l;
    const r = entradas[i].raw;
    return { id: l.id, nome: atual.nome, nomesVenda: r.metaCfg?.nomesVenda || [], padrao: atual.meta ?? r.metaPlanilha ?? null, meses: atual.metas || {}, metaAuto: atual.metaAuto || null, regras: atual.regras || null, operacao: atual.operacao || null, ferias: atual.ferias || [], feriadosLocais: atual.feriadosLocais || [], feriadosHoras: atual.feriadosHoras || {}, feriadosHorario: atual.feriadosHorario || {}, escalaAjustes: atual.escalaAjustes || {}, wpp: atual.wppModelos || null, wppIntervalo: atual.wppIntervalo || 21, contabilidade: atual.contabilidade || [] };
  });
  const k = entradas.map((e, i) => `${lojas[i].id}@${e.at}:${e.sig}`).join('|') + '#' + JSON.stringify(metaCfgs) + '#' + perfilDados + '#' + (desde || '');
  const chave = lojas.map((l) => l.id).join(',') + '|' + perfilDados + '|' + (desde || '');
  const pc = lruGet(packCache, chave);
  const stale = entradas.map((e) => e.stale).filter(Boolean).join(' | ') || null;
  const at = Math.min(...entradas.map((e) => e.at));
  if (pc && pc.k === k) return { buf: pc.buf, gz: pc.gz, br: pc.br, etag: pc.etag, at, stale };
  let data = lojas.length === 1 ? { ...entradas[0].raw } : juntar(entradas.map((e) => e.raw));
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
  lruSet(packCache, chave, { k, buf, gz, br, etag }, 40);
  return { buf, gz, br, etag, at, stale };
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(compression());
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
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
  'core.js', 'components.js', 'dicas.js', 'rules.js', 'pages.js', 'fidelidade.js',
  'clientes.js', 'campanhas.js', 'espera.js', 'extras.js', 'contabilidade.js',
  'estoque.js', 'devolucao.js', 'precos.js', 'inventario.js', 'validade.js', 'nfsaida.js', 'creditos.js', 'orcamento.js', 'checklist.js',
  'site.js', 'inicio.js', 'pedido.js', 'ia.js', 'dre.js', 'mapa.js', 'feriados.js',
  'config.js', 'script.js', 'fechamento.js', 'sistema.js', 'main.js',
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
  for (const f of APP_SCRIPTS) jsPartes.push(`/* === ${f} === */\n;` + fs.readFileSync(path.join(pub, 'js', f), 'utf8') + '\n;');
  const jsBuf = Buffer.from(jsPartes.join('\n'), 'utf8');
  const htmlCru = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  const v = crypto.createHash('sha256').update(cssBuf).update(jsBuf).update(htmlCru).digest('hex').slice(0, 12);
  const html = htmlCru
    .replace(/\/styles\.css(\?v=[^"']*)?/g, `/styles.css?v=${v}`)
    .replace(/\/app\.js(\?v=[^"']*)?/g, `/app.js?v=${v}`);
  bundleMem = { mtimes, v, html: comprimirAsset(Buffer.from(html, 'utf8')), css: comprimirAsset(cssBuf), js: comprimirAsset(jsBuf) };
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

app.get('/health', (req, res) => res.json({ ok: true, lojasEmCache: [...cacheLoja.entries()].filter(([, e]) => e.at).map(([id, e]) => ({ id, em: new Date(e.at).toISOString() })) }));
app.get('/login', (req, res) => res.sendFile(path.join(pub, 'login.html')));
['login.css', 'login.js', 'favicon.svg', 'trocar-senha.js'].forEach((f) => app.get('/' + f, (req, res) => res.sendFile(path.join(pub, f))));
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
  if (tooMany(ip) || (user && (tooMany(chaveU, 8) || tooMany(chaveUG, 30)))) return res.redirect('/login?e=limite');
  const u = user && user !== '*' ? cfg.usuarios[user] : null;
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
  if (s) encerrados.set(s.sig, s.exp);
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
  if (!C.ARQUIVOS[nome]) return res.status(400).json({ erro: `Arquivo inválido. Use um destes: ${Object.keys(C.ARQUIVOS).join(', ')}` });
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
    res.status(500).json({ erro: e.message });
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
      ...its.filter((i) => i.un === 'Kg' && /^\d{4,6}$/.test(String(i.cod))).map((i) => ({ cod: String(i.cod) + '2', desc: `${i.desc} 100G`, grupo: 'CHÁS', preco: Math.round(i.custo * 0.1 * 2.6 * 10) / 10 })),
    ] };
    res.json({ estoque: e.estoque, cfg: ESd.cfg({ estoqueCfg: e.estoqueCfg }), classe: ESd.classeCfg({}), historico: e.historico, compras: e.compras, tabela });
  } catch (e) { res.status(500).json({ erro: e.message }); }
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
app.get('/api/demo/validade', (req, res) => {
  if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const LOTd = require('./src/lotes');
  const e = DEMO.estoqueDemo(req.query.loja);
  const comp = { itens: {} };
  for (const [cod, l] of Object.entries((e.compras && e.compras.itens) || {})) {
    const k = [...cod].reduce((a, c) => a + c.charCodeAt(0), 0) % 14; // 0 a 13 meses para trás
    comp.itens[cod] = l.map(([d, ...r]) => [LOTd.somarMeses(d, -k), ...r]);
  }
  const { em, lotes } = LOTd.calcular({ estoque: e.estoque, compras: comp, tabela: null, edits: { lotes: {} } });
  for (const l of lotes) if (l.precoKg == null && l.custoKg) l.precoKg = Math.round(l.custoKg * 2.6);
  res.json({ em, hoje: LOTd.hojeSP(), meses: LOTd.MESES_VALIDADE, riscoDias: LOTd.RISCO_DIAS, custos: true, faixas: LOTd.FAIXAS.map((f) => ({ id: f.id, nome: f.nome, ate: Number.isFinite(f.ate) ? f.ate : null })),
    resumo: LOTd.resumo(lotes), lotes: lotes.map((l) => ({ ...l, tipo: '', familia: '' })), granel: LOTd.granelEstoque({ estoque: e.estoque, compras: e.compras }), entradas: LOTd.entradasRecentes({ estoque: e.estoque, compras: comp, edits: { lotes: {} } }) });
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
  const compras = [ent('e1', 19001, 70, 0), ent('e2', 19050, 55, 0), ent('e3', 19120, 22, 350), ent('e4', 19180, 8, 120)];
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
app.post('/api/demo/conta-franquia/acao', (req, res) => res.status(400).json({ erro: 'Na apresentação nada é salvo.' }));
app.post('/api/demo/conta-franquia/royalties', (req, res) => res.status(400).json({ erro: 'Na apresentação nada é salvo.' }));
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
app.get('/api/demo/estoque/notas', (req, res) => {
  if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try {
    // notas fictícias: as entradas da apresentação agrupadas pelo número da nota
    const e = DEMO.estoqueDemo(req.query.loja);
    const nome = new Map(e.estoque.itens.map((i) => [i.cod, i]));
    const porNf = new Map();
    for (const [cod, l] of Object.entries(e.compras.itens || {})) for (const [dia, custo, nf, qtd, forn] of l) {
      const n = porNf.get(nf) || porNf.set(nf, { id: nf, nf, serie: '1', emissao: dia, entrada: dia, status: 'Concluída', motivo: 'Compra', cfop: '1102', fornecedor: forn, total: 0, itens: [] }).get(nf);
      const it = nome.get(cod) || {};
      n.itens.push({ cod, nome: it.desc || cod, un: it.un || 'Un', qtd, vu: custo, custo, grupo: '' });
      n.total = Math.round((n.total + custo * qtd) * 100) / 100;
    }
    res.json({ atualizado: e.compras.atualizado, notas: [...porNf.values()].sort((a, b) => (a.entrada < b.entrada ? -1 : 1)) });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});
app.get('/api/demo/pedido', (req, res) => {
  if (!lojaDemo(req)) return res.status(400).json({ erro: 'Escolha uma loja.' });
  try { const e = DEMO.estoqueDemo(req.query.loja); // pedido obrigatório fictício: 6 produtos do catálogo
    const disp = e.catalogo.itens.filter((c) => c.disp).slice(5, 11);
    const ate = new Date(Date.now() + 20 * 86400e3).toISOString().slice(0, 10);
    const obrigatorio = { lista: [{ id: 'demo', nome: 'Pedido obrigatório de dezembro (exemplo)', ate, ativo: true, por: 'franquia', em: new Date().toISOString(), itens: disp.map((c, k) => ({ cod: c.cod, nome: c.nome, qtd: k % 2 ? 2 : 6, preco: c.preco })) }] };
    res.json({ catalogo: e.catalogo, carrinho: null, cfg: PEDd.cfg({}), obrigatorio, robo: { disponivel: false }, podeRobo: false }); } catch (e) { res.status(500).json({ erro: e.message }); }
});
app.get('/api/demo/pedido/acesso', (req, res) => res.json({ temLogin: false, usuario: '' }));
app.get('/api/demo/admin/estado', (req, res) => { try { res.json(DEMO.estadoDemo()); } catch (e) { res.status(500).json({ erro: e.message }); } });
app.get('/api/demo/admin/notif', (req, res) => res.json({ ativo: true, horario: '08:00', ultimoEnvio: null, alertas: true, fechamento: { ativo: true, horario: '23:30', ultimoEnvio: null }, avisos: { email: 'admin@exemplo.com' },
  telegram: { configurado: false, destinos: [] }, email: { host: 'smtp.exemplo.com', port: 587, secure: false, user: 'painel@exemplo.com', from: 'Painel <painel@exemplo.com>', temSenha: true, configurado: true,
    destinos: [{ email: 'franqueado@exemplo.com', nome: 'Franqueado(a)', lojas: ['*'] }] } }));
app.get('/api/demo/classificacao', (req, res) => res.json({ produtos: {} }));
app.get('/api/demo/site', (req, res) => res.json({ demo: true, em: new Date().toISOString(), origem: 'agendada', itens: [] }));
app.get('/api/demo/contatos', (req, res) => res.json({ contatos: {} }));
app.get('/api/demo/xmls/resumo', (req, res) => res.json({ meses: [] }));
app.get('/api/demo/dados', (req, res) => {
  try {
    const d = DEMO.pacoteDemo(String(req.query.loja || ''));
    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-Dados-Em', new Date(d.at).toISOString());
    res.type('application/json').send(d.body);
  } catch (e) {
    console.error('[demo] erro:', e.message);
    res.status(500).json({ erro: 'Apresentação indisponível no momento.' });
  }
});

// dados fictícios também para o comparativo com a rede e os alertas da apresentação
app.get('/api/demo/rede', (req, res) => {
  try { res.json(IND.rede(DEMO.partes(), String(req.query.ym || ''), String(req.query.loja || ''), 3)); } catch (e) { res.status(500).json({ erro: e.message }); }
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
app.get('/api/demo/alertas', (req, res) => {
  const p = DEMO.partes().find((x) => x.id === String(req.query.loja || ''));
  res.json({ alertas: p ? IND.alertas(p) : [] });
});
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
    res.status(r.erro ? 404 : 200).json(r);
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
    for (const [cpf, c] of Object.entries(lerContatos(id))) {
      const a = out[cpf];
      out[cpf] = !a ? { ...c, loja: id } : { ...a, ...(c.em > (a.em || '') ? { em: c.em, por: c.por, motivo: c.motivo } : {}), optout: a.optout || c.optout };
    }
  }
  res.json({ contatos: out });
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
  if (acao === 'contatado') Object.assign(c, { em: agora, por: req.user, motivo: String(motivo || '').slice(0, 40) });
  else if (acao === 'optout') Object.assign(c, { optout: true, optoutEm: agora, optoutPor: req.user });
  else if (acao === 'aceita') { delete c.optout; delete c.optoutEm; delete c.optoutPor; }
  else { delete c.em; delete c.por; delete c.motivo; }
  if (Object.keys(c).length) todos[cpf] = c; else delete todos[cpf];
  C.gravarAtomico(arqContatos(loja), JSON.stringify(todos), 0o640);
  if (acao === 'optout' || acao === 'aceita') C.auditar(req.user, acao === 'optout' ? 'cliente não quer contato' : 'cliente voltou a aceitar contato', loja, { loja, cpf: cpf.slice(0, 3) + '…' + cpf.slice(-2) });
  res.json({ ok: true, contato: todos[cpf] || null });
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
app.post('/api/campanhas', express.json({ limit: '600kb' }), (req, res) => {
  const id = lojaCamp(req);
  if (!id) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const r = CAMP.criar(id, req.body || {}, req.user);
  if (r.ok) C.auditar(req.user, 'criou campanha', id, { loja: id, nome: r.ok.nome, clientes: r.ok.rodadas[0].lista.length });
  respCamp(res, r);
});
app.put('/api/campanhas/:id', express.json({ limit: '20kb' }), (req, res) => {
  const id = lojaCamp(req);
  if (!id) return res.status(400).json({ erro: 'Escolha uma loja.' });
  respCamp(res, CAMP.alterar(id, req.params.id, req.body || {}));
});
app.post('/api/campanhas/:id/rodadas', express.json({ limit: '600kb' }), (req, res) => {
  const id = lojaCamp(req);
  if (!id) return res.status(400).json({ erro: 'Escolha uma loja.' });
  respCamp(res, CAMP.novaRodada(id, req.params.id, (req.body || {}).lista, req.user));
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

// versão dos arquivos da tela (o hash automático do bundle): a aba aberta compara e oferece recarregar depois de uma atualização
app.get('/api/versao', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ v: obterBundle().v });
});
app.get('/api/eu', (req, res) => {
  const u = C.get().usuarios[req.user];
  res.json({
    usuario: req.user === '*' ? '' : req.user, nome: u?.nome || req.user, perfil: req.perfil, vendedor: req.vendedor || '',
    pode: { configurar: req.perfil === 'admin' || req.perfil === 'franqueado', admin: req.perfil === 'admin', clientes: podeClientes(req), custos: podeTela(req, 'rentab', 'estoque', 'precos', 'notas', 'pedido', 'dre') },
    telas: C.telasDo(u),
    lojas: req.lojas.map((l) => ({ id: l.id, nome: l.nome, marca: { nome: (l.marca && l.marca.nome) || l.nome, logo: !!arquivoLogo(l.id) } })),
  });
});

app.get('/api/dados', async (req, res) => {
  const pedido = String(req.query.loja || '');
  let lojas;
  if (pedido === 'todas') lojas = req.lojas;
  else lojas = req.lojas.filter((l) => l.id === pedido);
  if (!lojas.length) lojas = req.lojas.slice(0, 1);
  if (!lojas.length) return res.status(404).json({ erro: 'Nenhuma loja cadastrada ainda. Crie a primeira em Configurações.', semLojas: true });
  try {
    const perfilDados = req.perfil === 'vendedor' ? `vendedor:${req.vendedor}` : podeClientes(req) ? 'completo' : 'gerente';
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.desde || '')) ? String(req.query.desde) : null;
    const d = await pacote(lojas, req.query.atualizar === '1', perfilDados, desde);
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
    res.end(d.buf);
  } catch (e) {
    console.error('[dados] erro:', e.message);
    res.status(502).json({ erro: e.message });
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
  } catch (e) { res.status(500).json({ erro: e.message }); }
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
  } catch (e) { res.status(500).json({ erro: e.message }); }
});
app.get('/api/alertas', async (req, res) => {
  if (req.perfil === 'vendedor') return res.json({ alertas: [] });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.json({ alertas: [] });
  try { res.json({ alertas: IND.alertas(await dadosParaIndicadores(loja)) }); } catch (e) { res.status(500).json({ erro: e.message }); }
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
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ---------- estoque e custo (só admin e franqueado) ----------
const podeContabilidade = (req) => req.perfil === 'admin' || req.perfil === 'franqueado';
/** gerente com a tela liberada em Configurações → Usuários (Estoque e margem, Pedido, Resultado) */
const podeTela = (req, ...telas) => podeContabilidade(req) || (req.perfil === 'gerente' && (C.telasDo(C.usuario(req.user)) || []).some((t) => telas.includes(t)));
const ES = require('./src/estoque');
const TAB = require('./src/tabela');
app.get('/api/estoque', (req, res) => {
  if (!podeTela(req, 'rentab', 'estoque', 'precos', 'notas', 'pedido', 'dre')) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const lc = C.get().lojas.find((l) => l.id === loja.id);
  res.json({ estoque: ES.atual(loja.id), cfg: ES.cfg(lc), classe: ES.classeCfg(lc), tabela: TAB.resumo(loja.id), historico: ES.historico(loja.id), compras: ES.compras(loja.id) });
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
  let robo = null;
  if (COL.ativo()) { try { robo = (await COL.status(loja.id)).nfe; } catch { /* ok */ } }
  // pedido perdido (o coletor reiniciou com ele na fila): vira erro
  const parado = !robo || (robo.estado !== 'na_fila' && robo.estado !== 'rodando');
  for (const r of lista) if (r.estado === 'na_fila' && parado && Date.now() - Date.parse(r.em) > 20000) { NFE.erro(loja.id, r.id, robo && robo.ultima && robo.ultima.id === r.id ? `o robô terminou sem confirmar (código ${robo.ultima.codigo})` : 'o pedido se perdeu (o coletor reiniciou); crie de novo'); }
  const cp = NFE.conferirParceiros(loja.id);
  for (const r of cp.mudou) C.auditar(r.por || 'sistema', r.estado === 'ok' ? 'robô cadastrou parceiro no AppNext' : r.estado === 'teste' ? 'robô testou o cadastro de parceiro (nada salvo)' : 'robô não conseguiu cadastrar o parceiro', loja.id, { loja: loja.id, tipo: r.tipo, nome: r.nome, erro: r.erro || null });
  for (const r of cp.lista) if (r.estado === 'na_fila' && parado && Date.now() - Date.parse(r.em) > 20000) NFE.erroParceiro(loja.id, r.id, robo && robo.ultima && robo.ultima.id === r.id ? `o robô terminou sem confirmar (código ${robo.ultima.codigo})` : 'o pedido se perdeu (o coletor reiniciou); peça de novo');
  const cad = NFE.cadastros(loja.id);
  res.json({ cadastros: cad, erroCadastros: NFE.erroCadastros(loja.id), rascunhos: NFE.lista(loja.id).slice(0, 100), parceiros: NFE.listaParceiros(loja.id).slice(0, 10), robo, podeRobo: COL.ativo() });
});
app.use('/api/nfe', (req, res, next) => (req.method === 'GET' || req.get('X-Painel') === '1' ? next() : res.status(403).json({ erro: 'Pedido inválido.' })));
app.post('/api/nfe/cadastros', express.json({ limit: '2kb' }), async (req, res) => {
  const loja = lojaNfe(req, res); if (!loja) return;
  if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS.' });
  NFE.prepararCadastros(loja.id);
  try {
    const x = await COL.nfe(loja.id, 'cadastros', 'cadastros', req.user);
    if (x.status >= 400) return res.status(x.status === 409 ? 409 : 400).json({ erro: (x.json && x.json.erro) || 'O coletor recusou.' });
  } catch (e) { return res.status(502).json({ erro: 'Não consegui falar com o coletor: ' + e.message }); }
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
  } catch (e) { NFE.erro(loja.id, r.ok.id, 'sem resposta do coletor'); return res.status(502).json({ erro: 'Não consegui falar com o coletor: ' + e.message }); }
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
  } catch (e) { NFE.erroParceiro(loja.id, r.ok.id, 'sem resposta do coletor'); return res.status(502).json({ erro: 'Não consegui falar com o coletor: ' + e.message }); }
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
  } catch (e) { NFE.erro(loja.id, r.ok.id, 'sem resposta do coletor'); return res.status(502).json({ erro: 'Não consegui falar com o coletor: ' + e.message }); }
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
  const id = String((corpo ? req.body && req.body.loja : req.query.loja) || '');
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
  const loja = lojaCF(req, res, true); if (!loja) return;
  const tipo = req.body.tipo === 'fidelidade' ? 'fidelidade' : 'devolucoes';
  const x = await enviarCobranca(loja, tipo, req.body, req.user);
  if (x.erro) return res.status(x.vazio ? 400 : 502).json({ erro: x.erro });
  res.json({ ok: true, para: x.para, historico: COB.historico(loja.id).slice(0, 20) });
});
// envio automático todo mês (ligado em Configurações → Mensagens)
app.get('/api/conta-franquia/auto', (req, res) => {
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
setInterval(async () => {
  const agora = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T');
  for (const loja of C.get().lojas || []) {
    for (const tipo of ['devolucoes', 'fidelidade']) {
      try {
        if (!COB.devidoAgora(loja.id, tipo, agora)) continue;
        const para = COB.emails(loja.id, tipo) || DEV.destinatarios(loja.id);
        const x = await enviarCobranca(loja, tipo, { para }, 'agendado');
        COB.marcarAuto(loja.id, tipo, agora.slice(0, 7), x.erro ? (x.vazio ? { ok: true, nada: true } : { ok: false, erro: x.erro }) : { ok: true, itens: x.itens.length, total: x.total });
        console.log(`[cobrança] ${loja.id} ${tipo}: ${x.erro || 'enviada'}`);
      } catch (e) { console.error('[cobrança]', loja.id, tipo, e.message); }
    }
  }
}, 5 * 60 * 1000).unref();
app.get('/api/conta-franquia', (req, res) => {
  const loja = lojaCF(req, res); if (!loja) return;
  try { res.json(contaDaLoja(loja)); } catch (e) { console.error('[conta-franquia]', e); res.status(500).json({ erro: 'Erro ao montar a conta com a franquia: ' + e.message }); }
});
app.post('/api/conta-franquia/acao', express.json({ limit: '5kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  const loja = lojaCF(req, res, true); if (!loja) return;
  const r = CF.acao(loja.id, req.body || {}, req.user);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  C.auditar(req.user, 'conta com a franquia: ' + String(req.body.tipo), loja.id, { loja: loja.id, nota: req.body.nota || null, creditos: req.body.creditos || (req.body.credito ? [req.body.credito] : []) });
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
  res.json({ dia, hoje: hojeSPiso(), itens: CK.itens(loja.id), marcados: CK.doDia(loja.id, dia), historico: CK.historico(loja.id), podeEditar: req.perfil !== 'vendedor' });
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
const podeIA = (req) => req.perfil === 'admin' || req.perfil === 'franqueado' || req.perfil === 'gerente';
/** loja da conversa: a escolhida (ou, em "todas", a primeira das lojas da pessoa que tem chave) */
const lojaIA = (req, res, id) => {
  if (!podeIA(req)) { res.status(403).json({ erro: 'A IA é para o admin, o franqueado e o gerente.' }); return null; }
  id = String(id || '');
  const loja = id === 'todas' ? req.lojas.find((l) => IA.chaveDaLoja(l.id)) || req.lojas[0] : req.lojas.find((l) => l.id === id);
  if (!loja) { res.status(400).json({ erro: 'Escolha uma loja.' }); return null; }
  return loja;
};
const iaErro = (res, e) => (e instanceof IA.ErroIA ? res.status(e.status).json({ erro: e.message }) : (console.error('[ia]', e), res.status(500).json({ erro: 'Falha na IA: ' + e.message })));
app.get('/api/ia/estado', (req, res) => {
  if (!podeIA(req)) return res.json({ ativa: false, pode: false });
  const id = String(req.query.loja || '');
  const lojas = id === 'todas' ? req.lojas : req.lojas.filter((l) => l.id === id);
  const k = lojas.map((l) => IA.chaveDaLoja(l.id)).find(Boolean);
  res.json({ ativa: !!k, pode: true, podeConfigurar: podeContabilidade(req) });
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
  C.auditar(req.user, 'alterou o teto da IA', loja.id, { loja: loja.id, teto: b.teto ?? null });
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
  // UMA análise por loja por dia, a mesma para toda a equipe (admin, franqueado e gerente): quem abrir primeiro gera,
  // os outros leem a guardada. Os números que vão para a IA são só de vendas, que esses três perfis já veem.
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
      return { diagnostico: diag, em: new Date().toISOString(), dia };
    });
    if (!out) return res.status(502).json({ erro: 'A IA não devolveu a explicação. Tente de novo.' });
    res.json(out);
  } catch (err) { iaErro(res, err); }
});
// revisão do pedido sugerido (aba Pedido)
app.post('/api/ia/pedido', express.json({ limit: '200kb' }), async (req, res) => {
  const b = req.body || {};
  if (!podeTela(req, 'pedido')) return res.status(403).json({ erro: 'Sem permissão.' });
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

// "Sincronizar agora" nas notas de entrada: o coletor busca só o estoque + notas de compra do AppNext (só admin dispara)
app.get('/api/estoque/notas/sincronizar', async (req, res) => {
  if (req.perfil !== 'admin') return res.status(403).json({ erro: 'Só o admin sincroniza.' });
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
  } catch (e) { res.status(502).json({ erro: e.message }); }
});
app.post('/api/estoque/notas/sincronizar', express.json({ limit: '1kb' }), async (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (req.perfil !== 'admin') return res.status(403).json({ erro: 'Só o admin sincroniza.' });
  const loja = req.lojas.find((l) => l.id === String((req.body && req.body.loja) || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS.' });
  try {
    const x = await COL.rodar(loja.id, req.user, ['estoque']);
    if (x.status !== 200) return res.status(x.status).json({ erro: (x.json && x.json.erro) || 'Falha no coletor.' });
    C.auditar(req.user, 'sincronizou as notas de entrada (estoque) com o AppNext', loja.id, { loja: loja.id });
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ erro: e.message }); }
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
  C.auditar(req.user, 'alterou configuração de estoque', loja.id, { loja: loja.id, entregaDias: v.ok.entregaDias, coberturaDias: v.ok.coberturaDias });
  res.json({ ok: true, cfg: v.ok });
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
  res.json({ ...(d || { itens: [] }), historico: hist || {}, tabela: tabela ? tabela.itens.filter((t) => t.preco > 0.011).map((t) => ({ cod: t.cod, desc: t.desc, preco: t.preco })) : null, rodando: SITE.rodando(), podeConsultar: podeContabilidade(req) });
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
        const u = p.ultima ? { ...p.ultima, log: req.perfil === 'admin' ? p.ultima.log : undefined } : null;
        robo = { disponivel: true, temLogin: s.temPedido, estado: p.estado || 'parado', acao: p.acao || null, ultima: u };
      }
    } catch (e) { robo = { disponivel: false, erro: e.message }; }
  }
  res.json({ catalogo: PED.catalogo(loja.id), carrinho: PED.carrinho(loja.id), cfg: PED.cfg(C.get().lojas.find((l) => l.id === loja.id)), obrigatorio: PED.obrigatorios(loja.id), espera: ESP.resumoPorCod(loja.id), robo, podeRobo: req.perfil === 'admin' });
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
  const contagens = req.perfil === 'vendedor' ? INV.lista(loja.id).map((x) => ({ ...x, ajuste: null })) : INV.lista(loja.id);
  res.json({
    contagens, estoqueEm: est && est.em, perfil: req.perfil,
    grupos: conta('grupo'), subs: [...subs].map(([k, n]) => [...k.split('|'), n]), tipos: conta('tipo'), familias: [...fams].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')),
    kg: cat.filter(INV.ehChaGranel).length,
    cobertura: INV.cobertura(loja.id, cat, INV.lista(loja.id)),
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
  } catch (e) { INV.erroEnvio(loja.id, c.id, 'sem resposta do coletor'); return res.status(502).json({ erro: 'Não consegui falar com o coletor: ' + e.message }); }
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
app.get('/api/inventario/contagem/:id/planilha', async (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Peça para a gerente gerar a planilha.' });
  const c = INV.ler(loja.id, String(req.params.id));
  if (!c) return res.status(404).json({ erro: 'Contagem não encontrada.' });
  if (!c.itens.some((i) => i.cont != null)) return res.status(400).json({ erro: 'Nenhum item contado.' });
  if (c.st === 'importado' || c.st === 'revertido') return res.status(400).json({ erro: 'Esta contagem já foi importada; o que foi enviado está no histórico.' });
  const linhas = INV.linhasPlanilha(c, ES.atual(loja.id), await catInv(loja));
  const buf = await INV.planilha(linhas);
  INV.marcarGerado(loja.id, c.id, req.user, linhas);
  C.auditar(req.user, 'gerou a planilha de inventário', loja.id, { loja: loja.id, nome: c.nome, itens: linhas.length, zerados: linhas.filter((l) => l.zerado).length });
  const nome = `Inventario_${String(loja.nome).normalize('NFD').replace(/[^\w]+/g, '_')}_${C.hojeBR()}.xlsx`;
  res.set('Content-Disposition', `attachment; filename="${nome}"`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buf));
});

// desfazer: planilha que volta os itens da contagem importada ao que eram antes (mantendo o que vendeu/entrou depois)
app.get('/api/inventario/contagem/:id/desfazer', (req, res) => {
  const loja = lojaInv(req, res); if (!loja) return;
  if (req.perfil === 'vendedor') return res.status(403).json({ erro: 'Sem permissão.' });
  const c = INV.ler(loja.id, String(req.params.id));
  if (!c || c.st !== 'importado' || !c.planilha) return res.status(400).json({ erro: 'Só dá para desfazer uma contagem importada.' });
  const linhas = INV.linhasDesfazer(c, ES.atual(loja.id));
  INV.planilha(linhas).then((buf) => {
    INV.marcarDesfazer(loja.id, c.id, req.user, 'gerado');
    C.auditar(req.user, 'gerou a planilha para desfazer um inventário', loja.id, { loja: loja.id, nome: c.nome, itens: linhas.length });
    res.set('Content-Disposition', `attachment; filename="Desfazer_inventario_${C.hojeBR()}.xlsx"`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buf));
  }).catch((e) => res.status(500).json({ erro: e.message }));
});

// ---------- validade e lotes do chá a granel (Estoque → Validade): a equipe informa o lote; o painel faz o resto ----------
const LOT = require('./src/lotes');
const podeValidade = (req) => req.perfil === 'vendedor' || podeTela(req, 'validade', 'notas', 'precos'); // quem abre a nota de entrada também informa o lote
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
  const r = LOT.resumo(lotes);
  const custos = podeCustos(req);
  if (!custos) { for (const p of [...Object.values(r.porFaixa), r.risco]) { p.custo = null; delete p.semCusto; } }
  res.json({
    em, hoje: LOT.hojeSP(), meses: LOT.MESES_VALIDADE, riscoDias: LOT.RISCO_DIAS, custos, faixas: LOT.FAIXAS.map((f) => ({ id: f.id, nome: f.nome, ate: Number.isFinite(f.ate) ? f.ate : null })),
    resumo: r, lotes: lotes.map((l) => semCusto(req, { ...l, tipo: tipos.get(l.cod) || '', familia: INV.familia(tipos.get(l.cod) || '') })),
    entradas: LOT.entradasRecentes(ctx), // para contar por lote no inventário
    granel: LOT.granelEstoque(ctx), // chá a granel com/sem estoque (Clientes → Hoje não oferece chá que a loja não tem)
  });
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
  const { lotes, compras } = LOT.daLoja(loja.id);
  const r = LOT.editar(loja.id, req.body || {}, req.user, lotes, compras);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  const [nf, cod, entrada] = String(req.body.chave).split('|');
  C.auditar(req.user, 'alterou lote/validade', loja.id, { loja: loja.id, cod, nf, entrada, antes: r.antes, depois: r.ok });
  const novo = LOT.daLoja(loja.id).lotes.find((x) => x.chave === String(req.body.chave));
  res.json({ ok: true, lote: novo ? semCusto(req, novo) : null, editado: r.ok });
});
// lotes das notas de entrada (Estoque → Notas fiscais e Validade → "Notas que chegaram"): sem esperar o estoque
app.get('/api/validade/notas', (req, res) => {
  const loja = lojaVal(req, res); if (!loja) return;
  const ctx = LOT.daLoja(loja.id), ns = ES.notas(loja.id);
  const notas = (ns && ns.notas) || [];
  const ctxN = { estoque: ctx.estoque, compras: ctx.compras, edits: ctx.edits };
  const pendentes = LOT.pendentesNotas({ notas, ...ctxN, abertos: new Set(ctx.lotes.map((l) => l.chave)) });
  // uma nota (o detalhe aberto) ou as recentes que têm chá a granel (até 15)
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
    const novos = ESP.avaliar(loja.id, { notas: ES.notas(loja.id), estoque: ES.atual(loja.id), xml: raw ? raw.xml : [], vendas: raw ? raw.vendas : null, fixe: fx ? fx.eventos : [] });
    if (novos.length) {
      const porProd = new Map();
      for (const p of novos) for (const i of p.itens) porProd.set(i.desc, (porProd.get(i.desc) || 0) + 1);
      const txt = `⏳ Lista de espera · ${loja.nome}\nChegou:\n` + [...porProd].map(([d, n]) => `• ${d}: ${n} ${n === 1 ? 'cliente esperando' : 'clientes esperando'}`).join('\n') + '\nAbra Clientes → Lista de espera para avisar.';
      NOTIF.avisarLoja(loja.id, txt).catch((e) => console.error('[espera] aviso:', e.message));
    }
    return novos;
  } finally {
    esperaAvaliando.delete(loja.id);
  }
}
setInterval(() => { for (const l of C.get().lojas) avaliarEspera(l).catch((e) => console.error(`[espera] ${l.id}:`, e.message)); }, 15 * 60e3).unref();
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
app.get('/api/espera/produtos', async (req, res) => {
  const loja = lojaEsp(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const q = ESP.ESQ(req.query.q || '');
  if (q.length < 2) return res.json({ produtos: [] });
  const m = new Map();
  for (const i of (TAB.resumo(loja.id) || { itens: [] }).itens || []) if (i.desc && i.preco !== 0.01) m.set(ESP.ESQ(i.desc), { desc: i.desc, cod: String(i.cod), vendidos: 0 });
  try { for (const v of (await dadosLoja(loja)).raw.vendas) { const k = ESP.ESQ(v.descricao); const a = m.get(k) || m.set(k, { desc: v.descricao, cod: v.cod != null ? String(v.cod) : null, vendidos: 0 }).get(k); a.vendidos += v.qtd || 0; if (!a.cod && v.cod != null) a.cod = String(v.cod); } } catch { /* ok */ }
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
// clientes para escolher (nome, CPF ou celular): no máximo 8; sem acesso a Clientes exige 6+ dígitos para CPF/celular e aplica limite de consultas
app.get('/api/espera/clientes', async (req, res) => {
  const loja = lojaEsp(req);
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  const amplo = podeClientes(req);
  const minDig = amplo ? 3 : 6;
  const q = String(req.query.q || '').trim(), qn = ESP.ESQ(q), qd = q.replace(/\D/g, '');
  const temNome = qn.length >= 3 && /[a-z]/.test(qn);
  const temDig = qd.length >= minDig;
  if (!temNome && !temDig) return res.json({ clientes: [] });
  if (!amplo) {
    const kEsp = 'espcli:' + req.user;
    if (tooMany(kEsp, 45, 60e3)) return res.status(429).json({ erro: 'Muitas buscas seguidas. Aguarde um instante.' });
    falhou(kEsp);
  }
  let cl = [];
  try { cl = (await dadosLoja(loja)).raw.clientes || []; } catch { /* ok */ }
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
  if (req.perfil !== 'admin') return res.status(403).json({ erro: 'Só o administrador.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  res.json(PED.acesso(loja.id));
});
app.put('/api/pedido/acesso', express.json({ limit: '4kb' }), (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (req.perfil !== 'admin') return res.status(403).json({ erro: 'Só o administrador.' });
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
  if (req.perfil !== 'admin') return res.status(403).json({ erro: 'Só o administrador aciona o robô do Sistema de Pedidos.' });
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
  } catch (e) { res.status(502).json({ erro: e.message }); }
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
  catch (e) { return res.status(502).json({ erro: `Não foi possível enviar: ${e.message}` }); }
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
  try { res.json(XA.resumo(loja.id, String(req.query.ym || ''))); } catch (e) { res.status(400).json({ erro: e.message }); }
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
  } catch (e) { res.status(400).json({ erro: e.message }); }
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
    if (!DATA.test(data) || !data.startsWith(ym) || typeof porPessoa !== 'object') return res.status(400).json({ erro: `Data inválida: ${data}` });
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
  if (typeof aj !== 'object') return res.status(400).json({ erro: 'Ajustes inválidos.' });
  const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const limpo = {};
  for (const [data, porPessoa] of Object.entries(aj)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !data.startsWith(ym) || typeof porPessoa !== 'object') return res.status(400).json({ erro: `Data inválida: ${data}` });
    for (const [nome, a] of Object.entries(porPessoa)) {
      const n = String(nome).trim().toUpperCase().slice(0, 40);
      if (!a || !['folga', 'trab'].includes(a.tipo)) return res.status(400).json({ erro: `Ajuste inválido de ${nome} em ${data}.` });
      if (a.tipo === 'trab' && (!HM.test(a.ini || '') || !HM.test(a.fim || '') || a.ini >= a.fim)) return res.status(400).json({ erro: `Confira o horário de ${nome} em ${data} (entrada antes da saída).` });
      (limpo[data] ||= {})[n] = a.tipo === 'trab' ? { tipo: 'trab', ini: a.ini, fim: a.fim } : { tipo: 'folga' };
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
  const loja = lojaDoPedido(req);
  if (!loja) return res.json({ disponivel: false, motivo: 'Selecione uma loja.' });
  const admin = (C.get().usuarios[req.user]?.lojas || []).includes('*') || req.user === '*';
  // 1º) script rodando na própria VPS (coletor)
  if (COL.ativo()) {
    try {
      const s = await COL.status(loja.id, admin);
      if (s.configurada) return res.json({ disponivel: true, origem: 'vps', horarios: s.horarios, janela: s.janela, temFixe: s.temFixe, execucao: s.execucao });
    } catch (e) {
      console.error(`[script] coletor: ${e.message}`);
      return res.json({ disponivel: true, origem: 'vps', erro: e.message });
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
    res.json({ disponivel: true, origem: 'github', erro: e.message.replace(/Bearer\s+\S+/g, '') });
  }
});

app.post('/api/script', express.json({ limit: '2kb' }), async (req, res) => {
  if (req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
  if (req.perfil !== 'admin') return res.status(403).json({ erro: 'Só o administrador pode rodar a coleta.' });
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
      return res.status(502).json({ erro: e.message });
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
    res.status(502).json({ erro: e.message });
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

// avisos de falha para o administrador (coleta, FIXE, loja sem vendas de ontem): a cada 5 minutos
setInterval(() => {
  require('./src/avisos').verificar({ COL, FX, B, NOTIF: require('./src/notificacoes') }).catch((e) => console.error('[avisos]', e.message));
}, 5 * 60e3).unref();

// resumo diário (Telegram / e-mail) no horário configurado
NOTIF.agendar(async (id) => { const l = C.get().lojas.find((x) => x.id === id); return l ? dadosParaIndicadores(l) : null; });

const srv = app.listen(PORT, () => {
  console.log(`Tea Shop painel em http://localhost:${PORT}`);
  SITE.agendar(); // preços do e-commerce: todo dia às 10h
  // Google Drive desativado: tira os IDs antigos do lojas.json (uma vez; fica cópia em config/backups)
  try {
    const tinham = [];
    C.alterar((cfg) => { for (const l of cfg.lojas) if (l.drive && Object.keys(l.drive).length) { tinham.push(l.id); l.drive = {}; } });
    if (tinham.length) { C.auditar('sistema', 'desativou o Google Drive', 'lojas', { lojas: tinham }); console.log(`[config] Google Drive desativado em: ${tinham.join(', ')}`); }
  } catch (e) { console.error('[config] não consegui limpar o Google Drive:', e.message); }
  // Preços e Site viraram telas próprias: o gerente que já via o Estoque e margem continua vendo as duas (uma vez)
  try {
    const mig = [];
    C.alterar((cfg) => {
      for (const [nome, u] of Object.entries(cfg.usuarios || {})) {
        if (u.telasV >= 7) continue;
        // v7: Estoque → Validade (lotes do chá a granel): todo gerente acompanha
        if (u.perfil === 'gerente' && Array.isArray(u.telas) && !u.telas.includes('validade')) { u.telas.push('validade'); mig.push(nome); }
        if (u.telasV >= 6) { u.telasV = 7; continue; }
        // v6: Lista de espera virou uma tela que se libera: quem já tinha (todos os gerentes) continua com ela
        if (u.perfil === 'gerente' && Array.isArray(u.telas) && !u.telas.includes('espera')) { u.telas.push('espera'); mig.push(nome); }
        if (u.telasV >= 5) { u.telasV = 7; continue; }
        // v5: Estoque → Inventário (contagem pelo celular): quem vê o Estoque passa a ver o Inventário
        if (u.perfil === 'gerente' && Array.isArray(u.telas) && u.telas.includes('estoque') && !u.telas.includes('inventario')) { u.telas.push('inventario'); mig.push(nome); }
        if (u.telasV >= 4) { u.telasV = 7; continue; }
        // v4: o detalhamento de cupons saiu do Comissionamento e virou Vendas → Cupons
        if (u.perfil === 'gerente' && Array.isArray(u.telas) && u.telas.includes('comissionamento') && !u.telas.includes('cupons')) { u.telas.push('cupons'); mig.push(nome); }
        if (u.telasV >= 3) { u.telasV = 7; continue; }
        // v2: Preços e Site saíram do Estoque e margem; v3: o Estoque e margem virou Rentabilidade + Estoque (+ Notas fiscais)
        if (u.perfil === 'gerente' && Array.isArray(u.telas) && u.telas.includes('estoque')) {
          for (const t of [...(u.telasV >= 2 ? [] : ['precos', 'site']), 'rentab', 'notas']) if (!u.telas.includes(t)) u.telas.push(t);
          mig.push(nome);
        }
        u.telasV = 7;
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
process.on('SIGTERM', () => desligar('SIGTERM'));
process.on('SIGINT', () => desligar('SIGINT'));
