'use strict';
/**
 * Configuração de lojas e usuários (config/lojas.json).
 * O arquivo é relido automaticamente quando muda — não precisa reiniciar o painel
 * para criar usuário, trocar senha ou incluir loja.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_FILE = path.resolve(process.env.CONFIG_FILE || path.join(__dirname, '..', 'config', 'lojas.json'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'dados'));

// Arquivos que cada loja pode ter (nome do arquivo na pasta da loja → aba lida)
const ARQUIVOS = {
  importacaoA: { aba: 'Sheet1', tipo: 'vendas', desc: 'Vendas do período atual (relatório diário)' },
  importacaoB: { aba: 'Sheet1', tipo: 'vendas', desc: 'Histórico de vendas' },
  NFA: { aba: 'Sheet1', tipo: 'vendas', desc: 'Vendas NF-e' },
  Xml: { aba: 'Xml', tipo: 'xml', desc: 'Cupons com CPF' },
  Dados_Clientes: { aba: 'Planilha1', tipo: 'clientes', desc: 'Cadastro de clientes' },
  Meta: { aba: null, tipo: 'meta', desc: 'Meta mensal da loja' },
};

const PERFIS = ['admin', 'franqueado', 'gerente', 'vendedor'];
// telas que podem ser liberadas para o gerente (padrão: todas menos Clientes)
// estoque, pedido e dre mostram custo e margem: para gerente só quando liberadas uma a uma
const TELAS = ['resumo', 'comparativos', 'comissionamento', 'promocao', 'cupons', 'mapa', 'clientes', 'minha', 'rentab', 'precos', 'site', 'estoque', 'pedido', 'notas', 'dre'];
const TELAS_GERENTE_PADRAO = ['resumo', 'comparativos', 'comissionamento', 'promocao', 'cupons', 'mapa', 'minha'];
/** telas que o usuário vê (null = todas as do perfil) */
function telasDo(u) {
  if (!u) return null;
  if (u.perfil === 'vendedor') return ['minha'];
  if (u.perfil === 'gerente') return u.telas || TELAS_GERENTE_PADRAO;
  return null;
}
let cache = { mtime: 0, cfg: null };

/** Configuração padrão quando não existe lojas.json: uma loja só, usando o .env (modo da versão 1) */
function fromEnv() {
  const e = process.env;
  // IDs das planilhas no Google Drive vêm só do .env (nunca deixe IDs reais no código)
  // Google Drive desativado: as vendas vêm do robô do AppNext (FILE_* do .env não são mais lidos)
  const drive = {};
  // usuários e senhas nunca vêm do .env (o antigo APP_USERS/APP_PASSWORD guardava senha em texto):
  // crie com "node scripts/admin.js usuario <nome> <loja>"
  if (e.APP_USERS || e.APP_PASSWORD) console.warn('⚠️  APP_USERS/APP_PASSWORD no .env não são mais usados: crie os usuários com scripts/admin.js.');
  return { lojas: [{ id: 'loja', nome: 'Tea Shop', drive, meta: null }], usuarios: {}, uploadToken: e.UPLOAD_TOKEN || null };
}

function normalizar(cfg) {
  const lojas = (cfg.lojas || []).map((l) => ({
    id: String(l.id).toLowerCase().replace(/[^a-z0-9_-]/g, ''),
    nome: l.nome || l.id,
    drive: {}, // Google Drive desativado em todas as lojas: o painel não lê mais planilhas de lá
    meta: l.meta ?? null,
    metas: l.metas && typeof l.metas === 'object' ? l.metas : {},
    metaAuto: l.metaAuto && typeof l.metaAuto === 'object' ? { ativo: !!l.metaAuto.ativo, pct: +l.metaAuto.pct || 0 } : null,
    appnext: l.appnext || '',
    regras: l.regras && typeof l.regras === 'object' ? l.regras : null,
    marca: l.marca && typeof l.marca === 'object' ? l.marca : null,
    operacao: l.operacao && typeof l.operacao === 'object' ? l.operacao : null,
    ferias: Array.isArray(l.ferias) ? l.ferias : [],
    feriadosLocais: Array.isArray(l.feriadosLocais) ? l.feriadosLocais : [],
    feriadosHoras: l.feriadosHoras && typeof l.feriadosHoras === 'object' ? l.feriadosHoras : {},
    feriadosHorario: l.feriadosHorario && typeof l.feriadosHorario === 'object' ? l.feriadosHorario : {},
    escalaAjustes: l.escalaAjustes && typeof l.escalaAjustes === 'object' ? l.escalaAjustes : {},
    wppModelos: Array.isArray(l.wppModelos) ? l.wppModelos : null,
    estoqueCfg: l.estoqueCfg && typeof l.estoqueCfg === 'object' ? l.estoqueCfg : null,
    pedidoCfg: l.pedidoCfg && typeof l.pedidoCfg === 'object' ? l.pedidoCfg : null,
    classeCfg: l.classeCfg && typeof l.classeCfg === 'object' ? l.classeCfg : null,
    contabilidade: Array.isArray(l.contabilidade) ? l.contabilidade.map(String).slice(0, 10) : [],
    criadaEm: l.criadaEm || null,
    uploadToken: l.uploadToken || null,
    github: l.github && l.github.repo ? { repo: l.github.repo, workflow: l.github.workflow || 'run.yml', ref: l.github.ref || 'main' } : null,
  })).filter((l) => l.id);
  const usuarios = {};
  for (const [u, v] of Object.entries(cfg.usuarios || {})) {
    const lojas = (v.lojas || []).map(String);
    usuarios[u.toLowerCase()] = {
      senha: v.senha, lojas, nome: v.nome || u,
      // perfil: admin (tudo), franqueado (suas lojas + usuários delas), gerente (sem dados de clientes), vendedor (só a própria comissão)
      perfil: PERFIS.includes(v.perfil) ? v.perfil : (lojas.includes('*') ? 'admin' : 'franqueado'),
      vendedor: v.vendedor || '',
      // telas liberadas (só gerente); null = padrão do perfil
      telas: Array.isArray(v.telas) && v.telas.length ? v.telas.filter((t) => TELAS.includes(t)) : null,
      ativo: v.ativo !== false,
      criadoEm: v.criadoEm || null,
      // último dia de acesso (AAAA-MM-DD, horário de Brasília); null = sem prazo
      acessoAte: /^\d{4}-\d{2}-\d{2}$/.test(v.acessoAte || '') ? v.acessoAte : null,
      // senha provisória: no próximo login a pessoa cria a própria senha antes de usar o painel
      trocarSenha: v.trocarSenha === true,
      senhaTrocadaEm: typeof v.senhaTrocadaEm === 'string' ? v.senhaTrocadaEm : null,
      // aumenta quando a senha muda ou o admin encerra as sessões: os cookies antigos deixam de valer
      sessao: Number.isInteger(v.sessao) && v.sessao >= 0 ? v.sessao : 0,
    };
  }
  return { lojas, usuarios, uploadToken: cfg.uploadToken || process.env.UPLOAD_TOKEN || null };
}

function get() {
  let st = null;
  try { st = fs.statSync(CONFIG_FILE); } catch { /* sem arquivo */ }
  if (!st) {
    if (!cache.cfg || cache.mtime !== -1) cache = { mtime: -1, cfg: fromEnv() };
    return cache.cfg;
  }
  if (st.mtimeMs !== cache.mtime) {
    try {
      cache = { mtime: st.mtimeMs, cfg: normalizar(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))) };
      console.log(`[config] ${cache.cfg.lojas.length} loja(s), ${Object.keys(cache.cfg.usuarios).length} usuário(s)`);
    } catch (e) {
      console.error('[config] lojas.json inválido, mantendo a versão anterior:', e.message);
      if (!cache.cfg) throw e;
    }
  }
  return cache.cfg;
}

// ---------- senhas (scrypt) ----------
function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(senha), salt, 32);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
function confereSenha(senha, guardada) {
  if (!guardada) return false;
  if (guardada.startsWith('plain$')) {
    const a = crypto.createHash('sha256').update(String(senha)).digest();
    const b = crypto.createHash('sha256').update(guardada.slice(6)).digest();
    return crypto.timingSafeEqual(a, b);
  }
  const [alg, salt, hash] = guardada.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const h = crypto.scryptSync(String(senha), Buffer.from(salt, 'base64'), 32);
  const ref = Buffer.from(hash, 'base64');
  return ref.length === h.length && crypto.timingSafeEqual(h, ref);
}

/** Lojas que um usuário pode ver */
/** hoje no horário de Brasília (AAAA-MM-DD) */
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
/** o prazo de acesso do usuário já passou? (o último dia ainda vale) */
const expirado = (u) => !!(u && u.acessoAte && hojeBR() > u.acessoAte);
/** hoje + n meses (o dia é ajustado no fim do mês: 31/01 + 1 = 28/02) */
function somaMeses(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ult = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ult));
  return alvo.toISOString().slice(0, 10);
}

/** chave da sessão: muda quando a senha muda, o admin encerra as sessões ou o usuário é recriado */
function chaveSessao(u) {
  return u ? crypto.createHash('sha256').update(`${u.criadoEm || ''}|${u.sessao || 0}|${u.senha || ''}`).digest('base64url').slice(0, 16) : '';
}

function lojasDoUsuario(user) {
  const cfg = get();
  const u = cfg.usuarios[user];
  if (!u || !u.ativo || expirado(u)) return [];
  if (u.lojas.includes('*')) return cfg.lojas;
  return cfg.lojas.filter((l) => u.lojas.includes(l.id));
}

const pastaLoja = (id) => path.join(DATA_DIR, id);
const CONFIG_DIR = path.dirname(CONFIG_FILE);
const COLETOR_DIR = path.resolve(process.env.COLETOR_CONFIG_DIR || path.join(CONFIG_DIR, 'coletor'));

function usuario(user) {
  const cfg = get();
  return cfg.usuarios[user] || (user === '*' ? cfg.usuarios['*'] : null) || null;
}

/** grava arquivo de forma atômica (tmp + rename) */
function gravarAtomico(file, conteudo, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, conteudo, { mode });
  fs.renameSync(tmp, file);
}

/**
 * Altera o lojas.json: lê o arquivo cru (preserva campos desconhecidos), aplica fn e grava.
 * Guarda uma cópia de segurança das últimas 30 versões em config/backups/.
 */
function alterar(fn) {
  let cru = { lojas: [], usuarios: {} };
  if (fs.existsSync(CONFIG_FILE)) cru = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  cru.lojas = cru.lojas || []; cru.usuarios = cru.usuarios || {};
  const antes = JSON.stringify(cru);
  const r = fn(cru);
  const depois = JSON.stringify(cru, null, 2) + '\n';
  if (JSON.stringify(cru) === antes) return r;
  normalizar(cru); // valida antes de gravar
  try {
    const bk = path.join(CONFIG_DIR, 'backups');
    fs.mkdirSync(bk, { recursive: true });
    if (fs.existsSync(CONFIG_FILE)) fs.copyFileSync(CONFIG_FILE, path.join(bk, `lojas-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    const velhos = fs.readdirSync(bk).filter((f) => f.startsWith('lojas-')).sort();
    velhos.slice(0, Math.max(0, velhos.length - 30)).forEach((f) => fs.unlinkSync(path.join(bk, f)));
  } catch (e) { console.warn('[config] backup falhou:', e.message); }
  gravarAtomico(CONFIG_FILE, depois);
  cache.mtime = 0; // força releitura
  return r;
}

// ---------- auditoria (quem mudou o quê) ----------
const AUDITORIA = path.join(CONFIG_DIR, 'auditoria.jsonl');
function auditar(por, acao, alvo, detalhe) {
  const linha = JSON.stringify({ em: new Date().toISOString(), por, acao, alvo, detalhe: detalhe || undefined });
  try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); fs.appendFileSync(AUDITORIA, linha + '\n', { mode: 0o600 }); } catch (e) { console.warn('[auditoria]', e.message); }
}
function lerAuditoria(limite = 300) {
  try {
    const t = fs.readFileSync(AUDITORIA, 'utf8').trim().split('\n').filter(Boolean);
    return t.slice(-limite).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ---------- último acesso (arquivo separado: login não reescreve o lojas.json) ----------
const ACESSOS = path.join(CONFIG_DIR, 'acessos.json');
let acessos = null, acessosTimer = null;
function lerAcessos() {
  if (!acessos) { try { acessos = JSON.parse(fs.readFileSync(ACESSOS, 'utf8')); } catch { acessos = {}; } }
  return acessos;
}
function registrarAcesso(user) {
  lerAcessos()[user] = new Date().toISOString();
  clearTimeout(acessosTimer);
  acessosTimer = setTimeout(() => { try { gravarAtomico(ACESSOS, JSON.stringify(acessos)); } catch (e) { console.warn('[acessos]', e.message); } }, 2000);
}

/** meta da loja num mês (AAAA-MM): meta do mês, senão a padrão */
function metaDoMes(loja, ym) {
  return (loja.metas && loja.metas[ym] != null ? loja.metas[ym] : loja.meta) ?? null;
}

module.exports = {
  get, hashSenha, confereSenha, chaveSessao, lojasDoUsuario, pastaLoja, usuario, alterar, gravarAtomico, auditar, lerAuditoria,
  registrarAcesso, lerAcessos, expirado, hojeBR, somaMeses, metaDoMes, PERFIS, TELAS, TELAS_GERENTE_PADRAO, telasDo, ARQUIVOS, CONFIG_FILE, CONFIG_DIR, COLETOR_DIR, DATA_DIR,
};
