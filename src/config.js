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
// telas que podem ser liberadas para o gerente e o padrão dele: vêm da lista única (src/telas.js, a mesma de Configurações → Usuários)
const TELAS_CAT = require('./telas');
const TELAS = TELAS_CAT.ESCOLHA_GERENTE;
const TELAS_GERENTE_PADRAO = TELAS_CAT.PADRAO_GERENTE;
/** telas que o usuário vê (null = todas as do perfil) */
function telasDo(u) {
  if (!u) return null;
  if (u.perfil === 'vendedor') return ['minha'];
  if (u.perfil === 'gerente') return u.telas || TELAS_GERENTE_PADRAO;
  return null;
}
let cache = { mtime: 0, cfg: null, verificadoEm: 0 };
const scryptAsync = require('util').promisify(crypto.scrypt);
const FMT_DIA_SP = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });

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
    fidelidade: l.fidelidade && typeof l.fidelidade === 'object' ? l.fidelidade : null,
    marca: l.marca && typeof l.marca === 'object' ? l.marca : null,
    operacao: l.operacao && typeof l.operacao === 'object' ? l.operacao : null,
    ferias: Array.isArray(l.ferias) ? l.ferias : [],
    feriadosLocais: Array.isArray(l.feriadosLocais) ? l.feriadosLocais : [],
    feriadosHoras: l.feriadosHoras && typeof l.feriadosHoras === 'object' ? l.feriadosHoras : {},
    feriadosHorario: l.feriadosHorario && typeof l.feriadosHorario === 'object' ? l.feriadosHorario : {},
    escalaAjustes: l.escalaAjustes && typeof l.escalaAjustes === 'object' ? l.escalaAjustes : {},
    wppModelos: Array.isArray(l.wppModelos) ? l.wppModelos : null,
    wppApresentacao: l.wppApresentacao && typeof l.wppApresentacao === 'object' ? { com: String(l.wppApresentacao.com || '').slice(0, 120), sem: String(l.wppApresentacao.sem || '').slice(0, 120), ...(l.wppApresentacao.equipe === true ? { equipe: true } : {}) } : null, // {apresentacao} das mensagens
    wppIntervalo: Number.isInteger(l.wppIntervalo) ? l.wppIntervalo : null, // dias mínimos entre duas mensagens para o mesmo cliente
    zap: l.zap && typeof l.zap === 'object' ? l.zap : null, // robô do WhatsApp das campanhas: ritmo, horário, dias, teto e falhas (src/zapfila.js)
    estoqueCfg: l.estoqueCfg && typeof l.estoqueCfg === 'object' ? l.estoqueCfg : null,
    pedidoCfg: l.pedidoCfg && typeof l.pedidoCfg === 'object' ? l.pedidoCfg : null,
    classeCfg: l.classeCfg && typeof l.classeCfg === 'object' ? l.classeCfg : null,
    // Vendas → Conferência: tolerância (R$) e o que fazer com cupom cancelado ('avisar' | 'excluir')
    conferencia: l.conferencia && typeof l.conferencia === 'object' ? l.conferencia : null,
    // CFOP das NF-e emitidas pelo robô ('' = automático): src/nfecfop.js
    nfeCfop: l.nfeCfop && typeof l.nfeCfop === 'object' ? { venda: /^[56]\d{3}$/.test(String(l.nfeCfop.venda || '')) ? String(l.nfeCfop.venda) : '', devolucao: /^[56]\d{3}$/.test(String(l.nfeCfop.devolucao || '')) ? String(l.nfeCfop.devolucao) : '' } : null,
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
      telasV: v.telasV || undefined,
      ativo: v.ativo !== false,
      criadoEm: v.criadoEm || null,
      // último dia de acesso (AAAA-MM-DD, horário de Brasília); null = sem prazo
      acessoAte: /^\d{4}-\d{2}-\d{2}$/.test(v.acessoAte || '') ? v.acessoAte : null,
      // senha provisória: no próximo login a pessoa cria a própria senha antes de usar o painel
      trocarSenha: v.trocarSenha === true,
      senhaTrocadaEm: typeof v.senhaTrocadaEm === 'string' ? v.senhaTrocadaEm : null,
      // aumenta quando a senha muda ou o admin encerra as sessões: os cookies antigos deixam de valer
      sessao: Number.isInteger(v.sessao) && v.sessao >= 0 ? v.sessao : 0,
      // lojas em que a pessoa já viu a configuração guiada (a janela abre sozinha só uma vez por loja)
      // robô do WhatsApp (decisão do dono, 23/11/2026; ZAP-PERM-01): só o admin libera, pessoa a pessoa (franqueado e gerente);
      // ausente = usuário de antes da regra (vale quem tinha loja com o robô: `roboLegado`, gravado uma vez na subida)
      robo: typeof v.robo === 'boolean' ? v.robo : undefined,
      // Conversas do WhatsApp: vem liberada para o franqueado; só o admin tira (false)
      conversas: v.conversas === false ? false : undefined,
      guiaVisto: Array.isArray(v.guiaVisto) && v.guiaVisto.length ? v.guiaVisto.filter((x) => typeof x === 'string').slice(-200) : undefined,
    };
  }
  return { lojas, usuarios, uploadToken: cfg.uploadToken || process.env.UPLOAD_TOKEN || null };
}

function get() {
  const agora = Date.now();
  if (cache.cfg && cache.mtime !== 0 && agora - cache.verificadoEm < 400) return cache.cfg;
  let st = null;
  try { st = fs.statSync(CONFIG_FILE); } catch { /* sem arquivo */ }
  if (!st) {
    if (!cache.cfg || cache.mtime !== -1) cache = { mtime: -1, cfg: fromEnv(), verificadoEm: agora };
    else cache.verificadoEm = agora;
    return cache.cfg;
  }
  if (st.mtimeMs !== cache.mtime) {
    try {
      cache = { mtime: st.mtimeMs, cfg: normalizar(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))), verificadoEm: agora };
      console.log(`[config] ${cache.cfg.lojas.length} loja(s), ${Object.keys(cache.cfg.usuarios).length} usuário(s)`);
    } catch (e) {
      console.error('[config] lojas.json inválido, mantendo a versão anterior:', e.message);
      if (!cache.cfg) throw e;
      cache.verificadoEm = agora;
    }
  } else {
    cache.verificadoEm = agora;
  }
  return cache.cfg;
}

// ---------- senhas (scrypt) ----------
const HASH_FANTASMA = (() => {
  const s = Buffer.alloc(16, 7);
  return `scrypt$${s.toString('base64')}$${crypto.scryptSync('__painelts_fantasma__', s, 32).toString('base64')}`;
})();

function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(senha), salt, 32);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
async function hashSenhaAsync(senha) {
  const salt = crypto.randomBytes(16);
  const h = await scryptAsync(String(senha), salt, 32);
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
async function confereSenhaAsync(senha, guardada) {
  const alvo = guardada || HASH_FANTASMA;
  if (alvo.startsWith('plain$')) {
    const a = crypto.createHash('sha256').update(String(senha)).digest();
    const b = crypto.createHash('sha256').update(alvo.slice(6)).digest();
    return !!guardada && crypto.timingSafeEqual(a, b);
  }
  const [alg, salt, hash] = alvo.split('$');
  if (alg !== 'scrypt' || !salt || !hash) {
    await scryptAsync(String(senha), Buffer.alloc(16, 7), 32);
    return false;
  }
  const h = await scryptAsync(String(senha), Buffer.from(salt, 'base64'), 32);
  const ref = Buffer.from(hash, 'base64');
  const ok = ref.length === h.length && crypto.timingSafeEqual(h, ref);
  return !!guardada && ok;
}

/** Lojas que um usuário pode ver */
/** data AAAA-MM-DD no fuso de Brasília */
const diaSP = (v) => {
  const d = v == null ? new Date() : new Date(v);
  return Number.isNaN(d.getTime()) ? FMT_DIA_SP.format(new Date()) : FMT_DIA_SP.format(d);
};
/** hoje no horário de Brasília (AAAA-MM-DD) */
const hojeBR = () => diaSP();
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

const pastaLoja = (id) => path.join(DATA_DIR, String(id || '').toLowerCase().replace(/[^a-z0-9_-]/g, ''));
const CONFIG_DIR = path.dirname(CONFIG_FILE);
const COLETOR_DIR = path.resolve(process.env.COLETOR_CONFIG_DIR || path.join(CONFIG_DIR, 'coletor'));

function usuario(user) {
  const cfg = get();
  return cfg.usuarios[user] || (user === '*' ? cfg.usuarios['*'] : null) || null;
}

/** grava arquivo de forma atômica (tmp + rename) */
function gravarAtomico(file, conteudo, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
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
  cru.lojas = (cru.lojas || []).map((l) => (l && l.id ? { ...l, id: String(l.id).toLowerCase().replace(/[^a-z0-9_-]/g, '') } : l));
  const usNorm = {};
  for (const [k, v] of Object.entries(cru.usuarios || {})) usNorm[String(k).toLowerCase()] = v;
  cru.usuarios = usNorm;
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
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.appendFileSync(AUDITORIA, linha + '\n', { mode: 0o600 });
    const st = fs.statSync(AUDITORIA);
    if (st.size > 6 * 1024 * 1024) {
      const cauda = lerCauda(AUDITORIA, 3 * 1024 * 1024).split('\n').slice(1).join('\n');
      gravarAtomico(AUDITORIA, cauda ? cauda + '\n' : '', 0o600);
    }
  } catch (e) { console.warn('[auditoria]', e.message); }
}
function lerCauda(arq, maxBytes) {
  const st = fs.statSync(arq);
  if (st.size <= maxBytes) return fs.readFileSync(arq, 'utf8');
  const fd = fs.openSync(arq, 'r');
  try {
    const buf = Buffer.allocUnsafe(maxBytes);
    const lidos = fs.readSync(fd, buf, 0, maxBytes, st.size - maxBytes);
    const txt = buf.subarray(0, lidos).toString('utf8');
    const nl = txt.indexOf('\n');
    return nl >= 0 ? txt.slice(nl + 1) : txt;
  } finally { fs.closeSync(fd); }
}
function lerAuditoria(limite = 300) {
  try {
    const t = lerCauda(AUDITORIA, Math.max(262144, limite * 600)).trim().split('\n').filter(Boolean);
    return t.slice(-limite).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ---------- último acesso (arquivo separado: login não reescreve o lojas.json) ----------
const ACESSOS = path.join(CONFIG_DIR, 'acessos.json');
let acessos = null, acessosTimer = null, acessosSujo = false;
function lerAcessos() {
  if (!acessos) { try { acessos = JSON.parse(fs.readFileSync(ACESSOS, 'utf8')); } catch { acessos = {}; } }
  return acessos;
}
function flushAcessos() {
  if (!acessosSujo || !acessos) return;
  clearTimeout(acessosTimer); acessosTimer = null; acessosSujo = false;
  try { gravarAtomico(ACESSOS, JSON.stringify(acessos)); } catch (e) { console.warn('[acessos]', e.message); }
}
function registrarAcesso(user) {
  lerAcessos()[user] = new Date().toISOString();
  acessosSujo = true;
  clearTimeout(acessosTimer);
  acessosTimer = setTimeout(flushAcessos, 2000);
  if (acessosTimer.unref) acessosTimer.unref();
}

/**
 * Texto de um erro para devolver à tela. Erro do sistema (arquivo/pasta: ENOENT, EACCES… ou mensagem com caminho do
 * servidor) vira uma frase genérica e o detalhe fica só no log; mensagem escrita à mão (validação) passa como está.
 */
const MSG_ERRO_INTERNO = 'Erro interno no painel. Tente de novo; se continuar, avise o suporte (o detalhe ficou no registro do servidor).';
function erroDeSistema(e) {
  if (!e || typeof e !== 'object') return false;
  if (typeof e.code === 'string' && /^E[A-Z0-9_]+$/.test(e.code) && e.path != null) return true; // erro de arquivo/pasta (os de rede não trazem caminho)
  const m = String(e.message || '');
  return [DATA_DIR, CONFIG_DIR, process.cwd()].some((d) => d && d.length > 3 && m.includes(d)) || /\b(ENOENT|EACCES|EPERM|EISDIR|ENOTDIR|EMFILE|ENOSPC|EEXIST|EROFS)\b/.test(m);
}
function msgErro(e, onde) {
  if (erroDeSistema(e)) { console.error(`[erro interno]${onde ? ' ' + onde : ''}:`, e); return MSG_ERRO_INTERNO; }
  return String((e && e.message) || e || 'Erro.');
}

/** a loja já usava o robô do WhatsApp antes da permissão por pessoa (configurou ou conectou) */
function lojaComRobo(lojaId, cfg) {
  const l = (cfg.lojas || []).find((x) => x.id === lojaId);
  if (l && l.zap && typeof l.zap === 'object') return true;
  try { return fs.existsSync(path.join(DATA_DIR, lojaId, 'zap', 'estado.json')); } catch { return false; }
}
/** usuário de antes da regra: franqueado, ou gerente com a tela Clientes, numa loja que já usava o robô */
function roboLegado(u, cfg) {
  if (!u || !['franqueado', 'gerente'].includes(u.perfil)) return false;
  if (u.perfil === 'gerente' && !(telasDo(u) || []).includes('clientes')) return false;
  return (u.lojas || []).some((id) => id !== '*' && lojaComRobo(id, cfg));
}
/** ZAP-PERM-01: pode conectar, ligar e configurar o robô do WhatsApp? admin sempre; franqueado e gerente só liberados pelo admin */
function podeRoboU(u, cfg = get()) {
  if (!u) return false;
  if (u.perfil === 'admin') return true;
  if (!['franqueado', 'gerente'].includes(u.perfil)) return false;
  return typeof u.robo === 'boolean' ? u.robo : roboLegado(u, cfg);
}
/** ZAP-PERM-02: pode ver e responder as Conversas do WhatsApp? admin sempre; franqueado até o admin tirar; os outros nunca */
function podeConversasU(u) {
  if (!u) return false;
  if (u.perfil === 'admin') return true;
  return u.perfil === 'franqueado' && u.conversas !== false;
}
/** a pessoa do pedido (sem usuário cadastrado, o painel roda como admin) */
const doPedido = (req) => { const u = get().usuarios[req.user]; return u || (req.perfil === 'admin' ? { perfil: 'admin' } : null); };
const podeRobo = (req) => podeRoboU(doPedido(req));
const podeConversas = (req) => podeConversasU(doPedido(req));

/** meta da loja num mês (AAAA-MM): meta do mês, senão a padrão */
function metaDoMes(loja, ym) {
  return (loja.metas && loja.metas[ym] != null ? loja.metas[ym] : loja.meta) ?? null;
}

module.exports = {
  get, hashSenha, hashSenhaAsync, confereSenha, confereSenhaAsync, chaveSessao, lojasDoUsuario, pastaLoja, usuario, alterar, gravarAtomico, auditar, lerAuditoria,
  registrarAcesso, flushAcessos, lerAcessos, msgErro, erroDeSistema, MSG_ERRO_INTERNO, expirado, hojeBR, diaSP, somaMeses, metaDoMes, PERFIS, TELAS, TELAS_GERENTE_PADRAO, telasDo, podeRobo, podeRoboU, podeConversas, podeConversasU, roboLegado, ARQUIVOS, CONFIG_FILE, CONFIG_DIR, COLETOR_DIR, DATA_DIR,
};
