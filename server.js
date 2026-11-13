'use strict';
// arquivos novos sem leitura para outros usuários da VPS (dados de clientes)
process.umask(0o027);
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const C = require('./src/config');
const { loadLoja, juntar, pack, assinatura, resolverFontes } = require('./src/sources');
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
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const safeEq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

// tentativas de login erradas: por IP (10 em 15 min) e por usuário (8 em 15 min, de qualquer IP)
const attempts = new Map();
const JANELA = 15 * 60e3;
function tooMany(chave, limite = 10) {
  const now = Date.now();
  const a = (attempts.get(chave) || []).filter((t) => now - t < JANELA);
  attempts.set(chave, a);
  return a.length >= limite;
}
const falhou = (chave) => { const a = attempts.get(chave) || []; a.push(Date.now()); attempts.set(chave, a); };
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of attempts) if (!a.length || now - a[a.length - 1] > JANELA) attempts.delete(k);
  for (const [s, exp] of encerrados) if (exp < now) encerrados.delete(s);
}, 5 * 60e3).unref();

// ---------- cache por loja ----------
const cacheLoja = new Map(); // id -> { sig, at, raw, loading }
async function dadosLoja(loja, force) {
  let e = cacheLoja.get(loja.id);
  const sig = assinatura(loja);
  const temDrive = resolverFontes(loja).some((f) => f.origem === 'drive');
  const fresco = e && e.raw && e.sig === sig && (!temDrive || Date.now() - e.at < CACHE_MIN * 60e3);
  if (fresco && !force) return e;
  if (!e) cacheLoja.set(loja.id, (e = {}));
  if (!e.loading) {
    e.loading = (async () => {
      try {
        const raw = await loadLoja(loja);
        raw.lojaNome = loja.nome;
        Object.assign(e, { sig, at: Date.now(), raw, erro: null });
        console.log(`[dados] ${loja.id}: ${raw.vendas.length} vendas, ${raw.xml.length} cupons c/ CPF, ${raw.clientes.length} clientes em ${raw.ms} ms`);
        if (raw.avisos.length) console.warn(`[dados] ${loja.id} avisos:`, raw.avisos.join(' | '));
      } finally { e.loading = null; }
    })();
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
/** o que cada perfil recebe: gerente e vendedor não recebem dados de clientes; vendedor não vê o nome dos colegas */
function filtrarPorPerfil(data, perfilDados) {
  if (perfilDados === 'completo') return data;
  const out = { ...data, xml: [], clientes: [], fidelidade: [] };
  if (perfilDados.startsWith('vendedor:')) {
    const eu = perfilDados.slice(9).trim().toUpperCase();
    const outros = [...new Set(data.vendas.map((v) => v.vendedor))].filter((n) => n && n.trim().toUpperCase() !== eu).sort();
    const apelido = new Map(outros.map((n, i) => [n, /^SEM VENDEDOR$/i.test(n.trim()) ? n : `COLEGA ${i + 1}`]));
    out.vendas = data.vendas.map((v) => (apelido.has(v.vendedor) ? { ...v, vendedor: apelido.get(v.vendedor) } : v));
  }
  return out;
}
const packCache = new Map(); // chave -> { k, body }
async function pacote(lojas, force, perfilDados = 'completo') {
  const entradas = await Promise.all(lojas.map((l) => dadosLoja(l, force)));
  // metas vêm sempre da configuração atual (mudam pelo painel sem recarregar as planilhas)
  const cfgLojas = C.get().lojas;
  const metaCfgs = lojas.map((l, i) => {
    const atual = cfgLojas.find((x) => x.id === l.id) || l;
    const r = entradas[i].raw;
    return { id: l.id, nome: atual.nome, nomesVenda: r.metaCfg?.nomesVenda || [], padrao: atual.meta ?? r.metaPlanilha ?? null, meses: atual.metas || {}, metaAuto: atual.metaAuto || null, regras: atual.regras || null, operacao: atual.operacao || null, ferias: atual.ferias || [], feriadosLocais: atual.feriadosLocais || [], feriadosHoras: atual.feriadosHoras || {}, feriadosHorario: atual.feriadosHorario || {}, escalaAjustes: atual.escalaAjustes || {}, wpp: atual.wppModelos || null, contabilidade: atual.contabilidade || [] };
  });
  const k = entradas.map((e, i) => `${lojas[i].id}@${e.at}`).join('|') + '#' + JSON.stringify(metaCfgs) + '#' + perfilDados;
  const chave = lojas.map((l) => l.id).join(',') + '|' + perfilDados;
  const pc = packCache.get(chave);
  const stale = entradas.map((e) => e.stale).filter(Boolean).join(' | ') || null;
  const at = Math.min(...entradas.map((e) => e.at));
  if (pc && pc.k === k) return { body: pc.body, at, stale };
  let data = lojas.length === 1 ? { ...entradas[0].raw } : juntar(entradas.map((e) => e.raw));
  data.metaCfgs = metaCfgs;
  data.meta = metaCfgs.some((m) => m.padrao != null) ? metaCfgs.reduce((s, m) => s + (m.padrao || 0), 0) : null;
  data = filtrarPorPerfil(data, perfilDados);
  const body = JSON.stringify(pack(data, { lojas: lojas.map((l) => ({ id: l.id, nome: l.nome })), perfil: perfilDados.split(':')[0] }));
  packCache.set(chave, { k, body });
  return { body, at, stale };
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
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // HTTPS sempre (só quando o painel roda atrás do HTTPS, COOKIE_SECURE=true)
    ...(SECURE_COOKIE ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  });
  next();
});

const pub = path.join(__dirname, 'public');
app.get('/health', (req, res) => res.json({ ok: true, lojasEmCache: [...cacheLoja.entries()].filter(([, e]) => e.at).map(([id, e]) => ({ id, em: new Date(e.at).toISOString() })) }));
app.get('/login', (req, res) => res.sendFile(path.join(pub, 'login.html')));
['login.css', 'login.js', 'favicon.svg', 'trocar-senha.js'].forEach((f) => app.get('/' + f, (req, res) => res.sendFile(path.join(pub, f))));
const CHART_JS = path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.min.js');
app.get('/vendor/chart.umd.js', (req, res) => res.sendFile(CHART_JS));
// PDF no navegador (fechamento do mês que vai anexado ao e-mail da contabilidade)
const H2C_JS = path.join(path.dirname(require.resolve('html2canvas/package.json')), 'dist', 'html2canvas.min.js');
const JSPDF_JS = path.join(path.dirname(require.resolve('jspdf/package.json')), 'dist', 'jspdf.umd.min.js');
app.get('/vendor/html2canvas.js', (req, res) => res.sendFile(H2C_JS));
app.get('/vendor/jspdf.js', (req, res) => res.sendFile(JSPDF_JS));

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const ip = req.ip;
  const cfg = C.get();
  const user = String(req.body.usuario || '').trim().toLowerCase().slice(0, 80);
  const pass = String(req.body.senha || '').slice(0, 200);
  const chaveU = 'u:' + user;
  if (tooMany(ip) || tooMany(chaveU, 8)) return res.redirect('/login?e=limite');
  const u = user && user !== '*' ? cfg.usuarios[user] : null;
  if (u && u.ativo && C.confereSenha(pass, u.senha)) {
    if (C.expirado(u)) { attempts.delete(ip); attempts.delete(chaveU); return res.redirect('/login?e=expirou&ate=' + u.acessoAte); }
    if (C.lojasDoUsuario(user).length || u.perfil === 'admin') {
      attempts.delete(ip); attempts.delete(chaveU);
      // senha antiga ainda em texto puro: passa a ser guardada com scrypt
      if (String(u.senha).startsWith('plain$')) C.alterar((c) => { c.usuarios[user].senha = C.hashSenha(pass); });
      C.registrarAcesso(user);
      res.cookie('ts_sess', makeToken(user), { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIE, maxAge: SESSION_HOURS * 3600e3 });
      return res.redirect(u.trocarSenha ? '/trocar-senha?primeiro=1' : '/');
    }
  }
  falhou(ip); falhou(chaveU);
  const lojaQ = String(req.body.loja || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  res.redirect('/login?e=1' + (lojaQ ? '&loja=' + lojaQ : ''));
});
app.post('/logout', (req, res) => {
  const s = readToken(cookies(req).ts_sess);
  if (s) encerrados.set(s.sig, s.exp);
  res.clearCookie('ts_sess', { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIE });
  res.redirect('/login');
});

// ---------- upload do script diário (token, sem login) ----------
app.post('/api/upload/:loja/:arquivo', express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` }), async (req, res) => {
  const cfg = C.get();
  const loja = cfg.lojas.find((l) => l.id === String(req.params.loja).toLowerCase());
  const tokens = [cfg.uploadToken, loja && loja.uploadToken].filter(Boolean);
  const dado = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tokens.length) return res.status(403).json({ erro: 'Upload desativado: defina "uploadToken" no lojas.json ou UPLOAD_TOKEN no .env.' });
  if (!dado || !tokens.some((t) => safeEq(dado, t))) return res.status(401).json({ erro: 'Token inválido.' });
  if (!loja) return res.status(404).json({ erro: `Loja "${req.params.loja}" não existe no lojas.json.` });
  const nome = String(req.params.arquivo).replace(/\.xlsx$/i, '');
  if (!C.ARQUIVOS[nome]) return res.status(400).json({ erro: `Arquivo inválido. Use um destes: ${Object.keys(C.ARQUIVOS).join(', ')}` });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 100 || buf[0] !== 0x50 || buf[1] !== 0x4b) return res.status(400).json({ erro: 'O conteúdo enviado não é um .xlsx.' });
  try {
    if (C.ARQUIVOS[nome].tipo === 'vendas') {
      B.receber(loja.id, buf, { origem: 'api-' + nome }); // entra na base mês a mês (período = datas da planilha)
    } else {
      C.gravarAtomico(path.join(C.pastaLoja(loja.id), `${nome}.xlsx`), buf, 0o640); // troca atômica
    }
    console.log(`[upload] ${loja.id}/${nome}.xlsx (${(buf.length / 1024).toFixed(0)} KB)`);
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
app.use('/js', express.static(path.join(pub, 'js'), { index: false, maxAge: 0 }));
app.get('/styles.css', (req, res) => res.sendFile(path.join(pub, 'styles.css')));
app.get(['/apresentacao', '/apresentacao/'], (req, res) => {
  if (!DEMO.disponivel()) return res.status(404).type('text/plain; charset=utf-8').send('Apresentação indisponível.');
  res.set('X-Robots-Tag', 'noindex');
  res.sendFile(path.join(pub, 'index.html'));
});
app.get('/api/demo/eu', (req, res) => res.json({ usuario: '', nome: 'Visitante', demo: true, lojas: DEMO.lojasDemo() }));
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
  res.json({ ...f, html: F2.html(f) });
});
app.get('/api/demo/alertas', (req, res) => {
  const p = DEMO.partes().find((x) => x.id === String(req.query.loja || ''));
  res.json({ alertas: p ? IND.alertas(p) : [] });
});

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
app.post('/trocar-senha', express.urlencoded({ extended: false }), (req, res) => {
  const ip = req.ip;
  const volta = (e) => res.redirect('/trocar-senha?e=' + e + (C.usuario(req.user)?.trocarSenha ? '&primeiro=1' : ''));
  if (req.user === '*' || !C.get().usuarios[req.user]) return volta('usuario');
  if (tooMany(ip)) return volta('limite');
  const u = C.get().usuarios[req.user];
  const atual = String(req.body.atual || ''), nova = String(req.body.nova || ''), confirma = String(req.body.confirma || '');
  if (!C.confereSenha(atual, u.senha)) { falhou(ip); return volta('atual'); }
  if (nova.length < 8) return volta('curta');
  if (nova !== confirma) return volta('confirma');
  if (nova === atual) return volta('igual');
  if (nova.toLowerCase().includes(req.user.toLowerCase())) return volta('usuario-na-senha');
  C.alterar((cfg) => { const x = cfg.usuarios[req.user]; x.senha = C.hashSenha(nova); x.trocarSenha = false; x.senhaTrocadaEm = new Date().toISOString(); });
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

app.get('/api/eu', (req, res) => {
  const u = C.get().usuarios[req.user];
  res.json({
    usuario: req.user === '*' ? '' : req.user, nome: u?.nome || req.user, perfil: req.perfil, vendedor: req.vendedor || '',
    pode: { configurar: req.perfil === 'admin' || req.perfil === 'franqueado', admin: req.perfil === 'admin', clientes: podeClientes(req) },
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
    const d = await pacote(lojas, req.query.atualizar === '1', perfilDados);
    res.set('Cache-Control', 'no-store');
    res.set('X-Dados-Em', new Date(d.at).toISOString());
    if (d.stale) res.set('X-Dados-Aviso', encodeURIComponent(d.stale));
    res.type('application/json').send(d.body);
  } catch (e) {
    console.error('[dados] erro:', e.message);
    res.status(502).json({ erro: e.message });
  }
});

// ---------- comparativo com a rede (anônimo) e alertas ----------
async function dadosParaIndicadores(loja) {
  const e = await dadosLoja(loja);
  return { id: loja.id, loja, vendas: e.raw.vendas, metaPlanilha: e.raw.metaPlanilha };
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
    const chave = ym + '|' + loja.id + '|' + partes.map((p) => p.id + ':' + p.vendas.length + ':' + JSON.stringify(p.loja.metas || {}) + (p.loja.meta ?? '')).join(',');
    let r = redeCache.get(chave);
    if (!r) { r = IND.rede(partes, ym, loja.id); redeCache.clear(); redeCache.set(chave, r); }
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
const ES = require('./src/estoque');
app.get('/api/estoque', (req, res) => {
  if (!podeContabilidade(req)) return res.status(403).json({ erro: 'Sem permissão.' });
  const loja = req.lojas.find((l) => l.id === String(req.query.loja || ''));
  if (!loja) return res.status(400).json({ erro: 'Escolha uma loja.' });
  res.json({ estoque: ES.atual(loja.id), cfg: ES.cfg(C.get().lojas.find((l) => l.id === loja.id)), historico: ES.historico(loja.id) });
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

// ---------- cadastro de clientes do FIXE: lê o e-mail da exportação (Gmail da loja) e importa ----------
const FX = require('./src/fixemail');
const CADX = require('./src/cadastro');
const fixeOcupado = new Set(), fixeUltimo = new Map();
async function verificarFixe(l) {
  fixeOcupado.add(l.id); fixeUltimo.set(l.id, Date.now());
  try {
    const NOTIF = require('./src/notificacoes');
    const nc = NOTIF.ler(), x = NOTIF.cfgLoja(nc, l.id);
    const smtp = x.email && x.email.user && x.email.pass ? x.email : nc.email;
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
  const smtp = x.email && x.email.host && x.email.from ? x.email : nc.email && nc.email.host && nc.email.from ? nc.email : null;
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
      if (m > 0) (limpo[data] ||= {})[String(nome).trim().toUpperCase().slice(0, 60)] = m;
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
    let execucao = c && Date.now() - c.at < 10e3 ? c.execucao : null;
    if (!execucao) {
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

app.use(express.static(pub, { index: 'index.html', maxAge: 0 }));

// processa planilhas que chegam na entrada (coletor) sem esperar alguém abrir o painel
setInterval(() => {
  for (const l of C.get().lojas) {
    if (B.pendentes(l.id).length || XB.pendentes(l.id).length) dadosLoja(l, true).catch((e) => console.error(`[base] ${l.id}:`, e.message));
    if (FX.situacao(l.id).pedido && !fixeOcupado.has(l.id) && Date.now() - (fixeUltimo.get(l.id) || 0) > 110e3) verificarFixe(l);
    if (ES.pendentes(l.id).length) ES.processar(l.id).then((r) => r && console.log(`[estoque] ${l.id}: ${r.itens} itens (${r.zerados} zerados)`)).catch((e) => console.error(`[estoque] ${l.id}:`, e.message));
  }
}, 30e3);

// resumo diário (Telegram / e-mail) no horário configurado
NOTIF.agendar(async (id) => { const l = C.get().lojas.find((x) => x.id === id); return l ? dadosParaIndicadores(l) : null; });

app.listen(PORT, () => {
  console.log(`Tea Shop painel em http://localhost:${PORT}`);
  for (const l of C.get().lojas) dadosLoja(l).catch((e) => console.error(`[dados] ${l.id}: primeira carga falhou:`, e.message));
});
