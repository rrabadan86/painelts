'use strict';
/**
 * Rotas da tela Configurações (/api/admin/*).
 *   admin       → tudo: lojas, acesso ao AppNext, horários, usuários de qualquer perfil
 *   franqueado  → só as próprias lojas: metas, envio de planilhas, rodar/importar histórico,
 *                 e usuários gerente/vendedor dessas lojas
 * Toda alteração fica registrada em config/auditoria.jsonl.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const C = require('./config');
const B = require('./base');
const COL = require('./coletor');

const NOME_OK = /^[a-z0-9._-]{2,30}$/;
const ID_OK = /^[a-z0-9_-]{2,40}$/;
const YM_OK = /^\d{4}-\d{2}$/;

const envFile = (id) => path.join(C.COLETOR_DIR, `${id}.env`);
function lerEnv(id) {
  const out = {};
  try {
    for (const linha of fs.readFileSync(envFile(id), 'utf8').split(/\r?\n/)) {
      const t = linha.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      let v = t.slice(i + 1).trim();
      if (v.length >= 2 && v[0] === v[v.length - 1] && `"'`.includes(v[0])) v = v.slice(1, -1);
      out[t.slice(0, i).trim()] = v;
    }
  } catch { return null; }
  return out;
}
function gravarEnv(id, valores) {
  const atual = lerEnv(id) || {};
  const tudo = { ...atual, ...valores };
  const linhas = ['# Gerado pelo painel (Configurações → Lojas). Não compartilhe este arquivo.'];
  for (const [k, v] of Object.entries(tudo)) {
    if (v == null) continue;
    linhas.push(`${k}="${String(v)}"`);
  }
  C.gravarAtomico(envFile(id), linhas.join('\n') + '\n', 0o600);
}
const semQuebra = (v) => String(v ?? '').replace(/[\r\n]/g, '').trim();
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/^tea\s*shop\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

const DIAS_SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
function validarOperacao(o) {
  if (!o || typeof o !== 'object' || !o.funcionamento || !o.equipe) return 'Dados inválidos.';
  const hm = (x) => typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
  for (const d of DIAS_SEMANA) {
    const f = o.funcionamento[d];
    if (!f || typeof f.fechado !== 'boolean') return `Horário de ${d} inválido.`;
    if (!f.fechado && (!hm(f.abre) || !hm(f.fecha) || f.abre >= f.fecha)) return `Confira o horário de ${d} (abertura antes do fechamento).`;
  }
  const e = o.equipe;
  const int = (x, a, b) => Number.isInteger(x) && x >= a && x <= b;
  if (!int(e.funcionarios, 1, 40)) return 'Quantidade de funcionários inválida (1 a 40).';
  if (!int(e.cargaSemanal, 4, 60)) return 'Carga horária semanal inválida.';
  if (!['5x2', '6x1'].includes(e.escala)) return 'Escala inválida.';
  if (!int(e.intervalo, 0, 180)) return 'Intervalo inválido.';
  if (!(typeof e.capacidade === 'number' && e.capacidade > 0 && e.capacidade <= 100)) return 'Atendimentos por pessoa por hora inválido.';
  if (e.nomes != null && (!Array.isArray(e.nomes) || e.nomes.length > 40 || e.nomes.some((n) => typeof n !== 'string' || n.length > 40))) return 'Nomes inválidos.';
  if (e.modelo != null && !['livre', 'rodizio'].includes(e.modelo)) return 'Modelo de escala inválido.';
  if (e.minimoDia != null) {
    if (typeof e.minimoDia !== 'object') return 'Mínimo por dia inválido.';
    for (const d of DIAS_SEMANA) if (e.minimoDia[d] != null && !int(e.minimoDia[d], 0, 20)) return `Mínimo de pessoas de ${d} inválido.`;
  }
  if (e.pessoas != null) {
    if (!Array.isArray(e.pessoas) || e.pessoas.length > 40) return 'Equipe inválida.';
    const dia = (x) => x === 'auto' || DIAS_SEMANA.includes(x);
    for (const p of e.pessoas) {
      if (!p || typeof p.nome !== 'string' || p.nome.length > 40) return 'Nome de pessoa inválido.';
      if (!dia(p.folga || 'auto') || !dia(p.folga2 || 'auto')) return `Folga fixa de ${p.nome || 'uma pessoa'} inválida.`;
      if (p.folga === 'dom' || p.folga2 === 'dom') return 'O domingo segue o rodízio: escolha outro dia fixo.';
    }
  }
  return null;
}

/** valida a estrutura das regras de comissão (percentuais entre 0 e 1) */
function validarRegras(g) {
  if (!g || typeof g !== 'object') return 'Regras inválidas.';
  const pct = (v) => typeof v === 'number' && v >= 0 && v <= 1;
  const num = (v) => typeof v === 'number' && v >= 0 && v < 1e7;
  if (!['padrao', 'torres', 'vila', 'goiania'].includes(g.modelo)) return 'Modelo inválido.';
  const d = g.divisaoMeta;
  if (!d || ![d.arom, d.puro, d.acess].every(pct) || Math.abs(d.arom + d.puro + d.acess - 1) > 0.001) return 'A divisão da meta precisa somar 100%.';
  const c = g.comissao;
  if (!c || !['faixas', 'simples'].includes(c.modo)) return 'Tipo de comissão inválido.';
  for (const k of ['arom', 'puro', 'acess']) if (!c[k] || ![c[k].acima120, c[k].bate, c[k].abaixo].every(pct)) return 'Percentual de comissão inválido.';
  const p = g.premiacao;
  if (!p || typeof p.ativa !== 'boolean' || ![p.valor, p.tkm, p.ipa, p.pma].every(num) || ![1, 2, 3].includes(p.minimo)) return 'Premiação inválida.';
  const b = g.bonus;
  if (!b || ![b.abaixo, b.bate, b.acima120].every(pct)) return 'Bônus inválido.';
  if (!g.rateio || typeof g.rateio.ativo !== 'boolean' || !Array.isArray(g.rateio.exclui)) return 'Rateio inválido.';
  if (!g.gorjeta || !['igual', 'proporcional'].includes(g.gorjeta.modo) || !pct(g.gorjeta.percentual)) return 'Gorjeta inválida.';
  const ry = g.royalties;
  if (!ry || ![ry.loja, ry.mkt, ry.eg, ry.egMkt].every(pct)) return 'Royalties inválidos.';
  if (!Array.isArray(g.semMeta) || g.semMeta.some((x) => typeof x !== 'string' || x.length > 60) || g.semMeta.length > 50) return 'Lista de vendedores sem meta inválida.';
  return null;
}

function registrar(app, { dadosLoja, pacoteLimpar, vendedoresDe, rawDe, totaisSemEG, MAX_UPLOAD_MB, NOTIF, obterIndicadores, arquivoLogo, LOGO_EXT }) {
  const r = express.Router();
  const json = express.json({ limit: '200kb' });

  // só admin/franqueado; pedidos que alteram algo precisam do cabeçalho do painel (proteção contra sites de terceiros)
  r.use((req, res, next) => {
    if (req.perfil !== 'admin' && req.perfil !== 'franqueado') return res.status(403).json({ erro: 'Sem permissão.' });
    if (req.method !== 'GET' && req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
    next();
  });
  const soAdmin = (req, res, next) => (req.perfil === 'admin' ? next() : res.status(403).json({ erro: 'Só o administrador pode fazer isso.' }));
  const minhasLojas = (req) => (req.perfil === 'admin' ? C.get().lojas : req.lojas);
  const lojaPermitida = (req, res, next) => {
    const loja = minhasLojas(req).find((l) => l.id === req.params.id);
    if (!loja) return res.status(404).json({ erro: 'Loja não encontrada.' });
    req.loja = loja; next();
  };
  const aud = (req, acao, alvo, detalhe) => C.auditar(req.user, acao, alvo, detalhe);
  const depois = (lojaId) => { pacoteLimpar(); if (lojaId) { const l = C.get().lojas.find((x) => x.id === lojaId); if (l) dadosLoja(l, true).catch(() => {}); } };

  function usuariosVisiveis(req) {
    const cfg = C.get();
    const minhas = new Set(req.lojas.map((l) => l.id));
    const acessos = C.lerAcessos();
    return Object.entries(cfg.usuarios).filter(([nome, u]) => {
      if (nome === '*') return false;
      if (req.perfil === 'admin') return true;
      return ['gerente', 'vendedor'].includes(u.perfil) && u.lojas.length && u.lojas.every((l) => minhas.has(l));
    }).map(([nome, u]) => ({ nome, perfil: u.perfil, lojas: u.lojas, vendedor: u.vendedor, telas: u.telas, ativo: u.ativo, criadoEm: u.criadoEm, ultimoAcesso: acessos[nome] || null }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }

  // ---------- estado completo da tela ----------
  r.get('/estado', async (req, res) => {
    const lojas = minhasLojas(req);
    const saude = COL.ativo() ? await COL.saude() : null;
    const itens = await Promise.all(lojas.map(async (l) => {
      const env = lerEnv(l.id);
      let status = null;
      if (COL.ativo() && env) { try { status = await COL.status(l.id, true); } catch (e) { status = { erro: e.message }; } }
      const fontes = Object.entries(C.ARQUIVOS).filter(([, d]) => d.tipo !== 'vendas').map(([nome, d]) => {
        const f = path.join(C.pastaLoja(l.id), `${nome}.xlsx`);
        let st = null; try { st = fs.statSync(f); } catch { /* não existe */ }
        return { nome, desc: d.desc, origem: st ? 'vps' : l.drive[nome] ? 'drive' : null, modificado: st ? st.mtime.toISOString() : null };
      });
      return {
        logo: !!arquivoLogo(l.id), operacao: l.operacao, ferias: l.ferias,
        metaAuto: l.metaAuto, totaisSemEG: totaisSemEG(l.id),
        id: l.id, nome: l.nome, appnext: l.appnext, meta: l.meta, metas: l.metas, criadaEm: l.criadaEm, regras: l.regras, marca: l.marca,
        nomesVenda: (() => { const raw = rawDe(l.id); return raw ? [...new Set(raw.vendas.slice(-500).map((v) => v.loja).filter(Boolean))] : []; })(),
        base: B.resumo(l.id), fontes, vendedores: vendedoresDe(l.id),
        coletor: env ? { configurado: true, rede: env.APPNEXT_REDE || '', usuario: env.APPNEXT_USER || '', temSenha: !!env.APPNEXT_PASS, lojaDestino: env.APPNEXT_LOJA_DESTINO || '', lojaIdDestino: env.APPNEXT_LOJA_ID_DESTINO || '' } : { configurado: false },
        status,
      };
    }));
    const minhas = new Set(lojas.map((l) => l.id));
    const auditoria = C.lerAuditoria(400).filter((e) => req.perfil === 'admin' || e.por === req.user || (e.detalhe && minhas.has(e.detalhe.loja)) || minhas.has(e.alvo)).slice(0, 200);
    res.json({
      perfil: req.perfil, usuario: req.user, coletorAtivo: COL.ativo(), horarios: saude?.horarios || [], coletorOk: saude ? saude.ok !== false : null,
      lojas: itens, usuarios: usuariosVisiveis(req), auditoria,
      todasLojas: C.get().lojas.map((l) => ({ id: l.id, nome: l.nome })).filter((l) => req.perfil === 'admin' || minhas.has(l.id)),
    });
  });

  // ---------- lojas ----------
  r.post('/lojas', soAdmin, json, (req, res) => {
    const nome = semQuebra(req.body.nome);
    if (nome.length < 3) return res.status(400).json({ erro: 'Informe o nome da loja.' });
    let id = String(req.body.id || slug(nome)).toLowerCase();
    if (!ID_OK.test(id)) return res.status(400).json({ erro: 'Identificador inválido (use letras minúsculas, números e "-").' });
    const meta = req.body.meta === '' || req.body.meta == null ? null : Number(req.body.meta);
    if (meta != null && !(meta >= 0)) return res.status(400).json({ erro: 'Meta inválida.' });
    try {
      C.alterar((cfg) => {
        if (cfg.lojas.some((l) => l.id === id)) throw new Error(`Já existe uma loja com o identificador "${id}".`);
        cfg.lojas.push({ id, nome, appnext: semQuebra(req.body.appnext), meta, metas: {}, drive: {}, criadaEm: new Date().toISOString() });
        // o admin que cria passa a ver a loja (se não vê todas)
        const u = cfg.usuarios[req.user];
        if (u && !(u.lojas || []).includes('*') && !(u.lojas || []).includes(id)) u.lojas = [...(u.lojas || []), id];
      });
    } catch (e) { return res.status(400).json({ erro: e.message }); }
    fs.mkdirSync(C.pastaLoja(id), { recursive: true });
    aud(req, 'criou loja', id, { loja: id, nome });
    depois();
    res.json({ ok: true, id });
  });

  r.put('/lojas/:id', lojaPermitida, json, (req, res) => {
    const b = req.body || {};
    const mud = {};
    if (req.perfil === 'admin') {
      if (b.nome != null) { const n = semQuebra(b.nome); if (n.length < 3) return res.status(400).json({ erro: 'Nome muito curto.' }); mud.nome = n; }
      if (b.appnext != null) mud.appnext = semQuebra(b.appnext);
    }
    if (b.meta !== undefined) {
      const m = b.meta === '' || b.meta == null ? null : Number(b.meta);
      if (m != null && !(m >= 0)) return res.status(400).json({ erro: 'Meta inválida.' });
      mud.meta = m;
    }
    C.alterar((cfg) => { const l = cfg.lojas.find((x) => x.id === req.loja.id); Object.assign(l, mud); });
    aud(req, 'alterou loja', req.loja.id, { loja: req.loja.id, ...mud });
    depois();
    res.json({ ok: true });
  });

  r.delete('/lojas/:id', soAdmin, lojaPermitida, (req, res) => {
    const id = req.loja.id;
    C.alterar((cfg) => {
      cfg.lojas = cfg.lojas.filter((l) => l.id !== id);
      for (const u of Object.values(cfg.usuarios)) if (Array.isArray(u.lojas)) u.lojas = u.lojas.filter((x) => x !== id);
    });
    try { if (fs.existsSync(envFile(id))) fs.renameSync(envFile(id), envFile(id) + `.removida-${Date.now()}`); } catch { /* ok */ }
    aud(req, 'removeu loja', id, { loja: id, obs: 'dados mantidos na pasta da loja' });
    depois();
    res.json({ ok: true });
  });

  r.put('/lojas/:id/metas', lojaPermitida, json, (req, res) => {
    const metas = req.body && req.body.metas;
    if (!metas || typeof metas !== 'object') return res.status(400).json({ erro: 'Envie as metas.' });
    const limpas = {};
    for (const [ym, v] of Object.entries(metas)) {
      if (!YM_OK.test(ym)) return res.status(400).json({ erro: `Mês inválido: ${ym}` });
      if (v === '' || v == null) limpas[ym] = null;
      else { const n = Number(v); if (!(n >= 0)) return res.status(400).json({ erro: `Meta inválida em ${ym}` }); limpas[ym] = n; }
    }
    C.alterar((cfg) => {
      const l = cfg.lojas.find((x) => x.id === req.loja.id);
      l.metas = l.metas || {};
      for (const [ym, v] of Object.entries(limpas)) { if (v == null) delete l.metas[ym]; else l.metas[ym] = v; }
    });
    aud(req, 'alterou metas', req.loja.id, { loja: req.loja.id, metas: limpas });
    depois();
    res.json({ ok: true });
  });

  // ---------- regras de comissão ----------
  r.put('/lojas/:id/regras', soAdmin, lojaPermitida, json, (req, res) => {
    const g = req.body && req.body.regras;
    if (g === null) {
      C.alterar((cfg) => { delete cfg.lojas.find((x) => x.id === req.loja.id).regras; });
      aud(req, 'voltou regras ao modelo', req.loja.id, { loja: req.loja.id });
      depois(); return res.json({ ok: true });
    }
    const erro = validarRegras(g);
    if (erro) return res.status(400).json({ erro });
    C.alterar((cfg) => { cfg.lojas.find((x) => x.id === req.loja.id).regras = g; });
    aud(req, 'alterou regras de comissão', req.loja.id, { loja: req.loja.id, modelo: g.modelo });
    depois();
    res.json({ ok: true });
  });

  // ---------- meta automática: mesmo mês do ano anterior (sem Espaço Gourmet) + % ----------
  r.put('/lojas/:id/metaauto', lojaPermitida, json, (req, res) => {
    const ativo = !!(req.body && req.body.ativo);
    const pct = Number(req.body && req.body.pct);
    if (!(pct >= -90 && pct <= 500)) return res.status(400).json({ erro: 'Percentual inválido (entre -90% e 500%).' });
    C.alterar((cfg) => { cfg.lojas.find((x) => x.id === req.loja.id).metaAuto = { ativo, pct }; });
    aud(req, 'alterou meta automática', req.loja.id, { loja: req.loja.id, ativo, pct: pct + '%' });
    depois();
    res.json({ ok: true });
  });

  // ---------- acesso ao AppNext (coletor) ----------
  r.put('/lojas/:id/appnext', soAdmin, lojaPermitida, json, (req, res) => {
    const b = req.body || {};
    const rede = semQuebra(b.rede), usuario = semQuebra(b.usuario);
    if (!rede || !usuario) return res.status(400).json({ erro: 'Informe a rede e o usuário do AppNext.' });
    const atual = lerEnv(req.loja.id);
    if (!b.senha && !(atual && atual.APPNEXT_PASS)) return res.status(400).json({ erro: 'Informe a senha do AppNext.' });
    const valores = {
      APPNEXT_REDE: rede, APPNEXT_USER: usuario,
      APPNEXT_LOJA_DESTINO: semQuebra(b.lojaDestino), APPNEXT_LOJA_ID_DESTINO: semQuebra(b.lojaIdDestino),
      MAX_RUNTIME_SECONDS: (atual && atual.MAX_RUNTIME_SECONDS) || '600',
      DATA_INICIO: null, DATA_FIM: null, DIAS_JANELA: null, // o período agora é controlado pelo coletor
    };
    if (b.senha) valores.APPNEXT_PASS = String(b.senha).replace(/[\r\n]/g, '');
    gravarEnv(req.loja.id, valores);
    if (valores.APPNEXT_LOJA_DESTINO) C.alterar((cfg) => { const l = cfg.lojas.find((x) => x.id === req.loja.id); l.appnext = valores.APPNEXT_LOJA_DESTINO; });
    aud(req, 'alterou acesso ao AppNext', req.loja.id, { loja: req.loja.id, rede, usuario, senha: b.senha ? 'trocada' : 'mantida', lojaDestino: valores.APPNEXT_LOJA_DESTINO });
    res.json({ ok: true });
  });

  r.post('/lojas/:id/rodar', lojaPermitida, async (req, res) => {
    if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS.' });
    if (!lerEnv(req.loja.id)) return res.status(400).json({ erro: 'Cadastre primeiro o acesso ao AppNext desta loja.' });
    try {
      const x = await COL.rodar(req.loja.id, req.user);
      if (x.status !== 200) return res.status(x.status).json({ erro: x.json.erro || 'Falha no coletor.' });
      aud(req, 'rodou atualização', req.loja.id, { loja: req.loja.id });
      res.json({ ok: true });
    } catch (e) { res.status(502).json({ erro: e.message }); }
  });

  r.post('/lojas/:id/historico', lojaPermitida, json, async (req, res) => {
    if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS.' });
    if (!lerEnv(req.loja.id)) return res.status(400).json({ erro: 'Cadastre primeiro o acesso ao AppNext desta loja.' });
    const { de, ate } = req.body || {};
    const passo = Math.max(1, Math.min(12, +req.body.mesesPorParte || 3));
    if (!YM_OK.test(de || '') || !YM_OK.test(ate || '') || de > ate) return res.status(400).json({ erro: 'Período inválido.' });
    const meses = B.mesesEntre(de + '-01', ate + '-01');
    if (meses.length > 120) return res.status(400).json({ erro: 'Período longo demais (máximo 10 anos).' });
    const hoje = new Date().toISOString().slice(0, 10);
    const partes = [];
    for (let i = 0; i < meses.length; i += passo) {
      const ini = meses[i], fim = meses[Math.min(meses.length - 1, i + passo - 1)];
      const [y, m] = fim.split('-').map(Number);
      let ult = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      if (ult > hoje) ult = hoje;
      if (`${ini}-01` <= ult) partes.push({ de: `${ini}-01`, ate: ult });
    }
    try {
      const x = await COL.historico(req.loja.id, partes, req.user);
      if (x.status !== 200) return res.status(x.status).json({ erro: x.json.erro || 'Falha no coletor.' });
      aud(req, 'importou histórico', req.loja.id, { loja: req.loja.id, de, ate, partes: partes.length });
      res.json({ ok: true, partes: partes.length });
    } catch (e) { res.status(502).json({ erro: e.message }); }
  });

  r.post('/lojas/:id/cancelar', lojaPermitida, async (req, res) => {
    try {
      const x = await COL.cancelar(req.loja.id, req.user);
      aud(req, 'cancelou coleta', req.loja.id, { loja: req.loja.id });
      res.status(x.status).json(x.json);
    } catch (e) { res.status(502).json({ erro: e.message }); }
  });

  // ---------- envio de planilhas ----------
  const TIPOS = { vendas: null, Xml: 'Xml', Dados_Clientes: 'Dados_Clientes', Meta: 'Meta' };
  r.post('/lojas/:id/upload/:tipo', lojaPermitida, express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` }), (req, res) => {
    const tipo = req.params.tipo;
    if (!(tipo in TIPOS)) return res.status(400).json({ erro: 'Tipo de planilha inválido.' });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 100 || buf[0] !== 0x50 || buf[1] !== 0x4b) return res.status(400).json({ erro: 'O arquivo não é uma planilha .xlsx.' });
    const nomeOrig = semQuebra(req.get('X-Arquivo') || '').slice(0, 80);
    if (tipo === 'vendas') B.receber(req.loja.id, buf, { origem: 'painel' });
    else C.gravarAtomico(path.join(C.pastaLoja(req.loja.id), `${TIPOS[tipo]}.xlsx`), buf, 0o644);
    aud(req, 'enviou planilha', req.loja.id, { loja: req.loja.id, tipo, arquivo: nomeOrig, kb: Math.round(buf.length / 1024) });
    depois(req.loja.id);
    res.json({ ok: true });
  });

  // ---------- horário de funcionamento e equipe (Mapa de Calor / escala) ----------
  r.put('/lojas/:id/operacao', lojaPermitida, json, (req, res) => {
    const o = req.body && req.body.operacao;
    const erro = validarOperacao(o);
    if (erro) return res.status(400).json({ erro });
    C.alterar((cfg) => { cfg.lojas.find((x) => x.id === req.loja.id).operacao = o; });
    aud(req, 'alterou horário e equipe', req.loja.id, { loja: req.loja.id, funcionarios: o.equipe.funcionarios, carga: o.equipe.cargaSemanal, escala: o.equipe.escala });
    depois();
    res.json({ ok: true });
  });

  // ---------- férias (a meta diária é dividida só entre quem está trabalhando) ----------
  r.put('/lojas/:id/ferias', lojaPermitida, json, (req, res) => {
    const lista = req.body && req.body.ferias;
    if (!Array.isArray(lista) || lista.length > 300) return res.status(400).json({ erro: 'Lista de férias inválida.' });
    const DATA = /^\d{4}-\d{2}-\d{2}$/;
    const limpa = [];
    for (const f of lista) {
      const vendedor = semQuebra(f && f.vendedor).toUpperCase().slice(0, 60);
      if (!vendedor) return res.status(400).json({ erro: 'Escolha a vendedora de cada período de férias.' });
      if (!DATA.test(f.de || '') || !DATA.test(f.ate || '') || f.de > f.ate) return res.status(400).json({ erro: `Confira as datas das férias de ${vendedor} (início antes do fim).` });
      limpa.push({ vendedor, de: f.de, ate: f.ate });
    }
    limpa.sort((a, b) => (a.de < b.de ? -1 : 1));
    C.alterar((cfg) => { cfg.lojas.find((x) => x.id === req.loja.id).ferias = limpa; });
    aud(req, 'alterou férias', req.loja.id, { loja: req.loja.id, periodos: limpa.map((f) => `${f.vendedor} ${f.de}→${f.ate}`) });
    depois();
    res.json({ ok: true });
  });

  // ---------- marca (nome de exibição e logo) ----------
  r.put('/lojas/:id/marca', lojaPermitida, json, (req, res) => {
    const nome = semQuebra(req.body.nome).slice(0, 60);
    C.alterar((cfg) => { const l = cfg.lojas.find((x) => x.id === req.loja.id); l.marca = { ...(l.marca || {}), nome: nome || undefined }; });
    aud(req, 'alterou marca', req.loja.id, { loja: req.loja.id, nome });
    res.json({ ok: true });
  });
  r.post('/lojas/:id/logo', lojaPermitida, express.raw({ type: () => true, limit: '600kb' }), (req, res) => {
    const b = req.body;
    if (!Buffer.isBuffer(b) || b.length < 50) return res.status(400).json({ erro: 'Envie uma imagem.' });
    const ext = b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'webp' : null;
    if (!ext) return res.status(400).json({ erro: 'Use uma imagem PNG, JPG ou WEBP.' });
    for (const e of Object.keys(LOGO_EXT)) { try { fs.unlinkSync(path.join(C.pastaLoja(req.loja.id), `logo.${e}`)); } catch { /* ok */ } }
    C.gravarAtomico(path.join(C.pastaLoja(req.loja.id), `logo.${ext}`), b, 0o644);
    aud(req, 'trocou logo', req.loja.id, { loja: req.loja.id, kb: Math.round(b.length / 1024) });
    res.json({ ok: true });
  });
  r.delete('/lojas/:id/logo', lojaPermitida, (req, res) => {
    for (const e of Object.keys(LOGO_EXT)) { try { fs.unlinkSync(path.join(C.pastaLoja(req.loja.id), `logo.${e}`)); } catch { /* ok */ } }
    aud(req, 'removeu logo', req.loja.id, { loja: req.loja.id });
    res.json({ ok: true });
  });

  // ---------- resumo diário ----------
  r.get('/notif', soAdmin, (req, res) => res.json(NOTIF.publico()));
  r.put('/notif', soAdmin, json, (req, res) => {
    const b = req.body || {};
    const c = NOTIF.ler();
    if (b.horario != null) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.horario)) return res.status(400).json({ erro: 'Horário inválido.' }); c.horario = b.horario; }
    if (b.ativo != null) c.ativo = !!b.ativo;
    if (b.alertas != null) c.alertas = !!b.alertas;
    if (b.telegram && b.telegram.token != null) {
      const t = semQuebra(b.telegram.token);
      if (t && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(t)) return res.status(400).json({ erro: 'Token do robô inválido (formato 123456789:ABC...).' });
      c.telegram.token = t;
    }
    if (b.email) {
      const e = b.email;
      for (const k of ['host', 'user', 'from']) if (e[k] != null) c.email[k] = semQuebra(e[k]);
      if (e.port != null) c.email.port = +e.port || 587;
      if (e.secure != null) c.email.secure = !!e.secure;
      if (e.pass) c.email.pass = String(e.pass).replace(/[\r\n]/g, '');
    }
    NOTIF.gravar(c);
    aud(req, 'alterou resumo diário', 'notificações', { ativo: c.ativo, horario: c.horario, telegram: b.telegram && b.telegram.token != null ? 'token alterado' : undefined, email: b.email ? c.email.host : undefined });
    res.json({ ok: true });
  });
  r.get('/notif/telegram/conversas', soAdmin, async (req, res) => {
    try { res.json({ conversas: await NOTIF.conversasTelegram() }); } catch (e) { res.status(400).json({ erro: e.message }); }
  });
  r.post('/notif/destinos', soAdmin, json, (req, res) => {
    const { canal, id, nome, lojas, remover } = req.body || {};
    const c = NOTIF.ler();
    const lista = canal === 'telegram' ? c.telegram.destinos : canal === 'email' ? c.email.destinos : null;
    if (!lista) return res.status(400).json({ erro: 'Canal inválido.' });
    const chave = canal === 'telegram' ? 'chatId' : 'email';
    const ident = semQuebra(id);
    if (canal === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ident)) return res.status(400).json({ erro: 'E-mail inválido.' });
    if (canal === 'telegram' && !/^-?\d{3,20}$/.test(ident)) return res.status(400).json({ erro: 'Conversa inválida.' });
    const i = lista.findIndex((d) => String(d[chave]) === ident);
    if (remover) { if (i >= 0) lista.splice(i, 1); }
    else {
      const ls = Array.isArray(lojas) && lojas.length ? lojas.map(String) : ['*'];
      if (ls.some((x) => x !== '*' && !C.get().lojas.some((l) => l.id === x))) return res.status(400).json({ erro: 'Loja inexistente.' });
      const d = { [chave]: ident, nome: semQuebra(nome).slice(0, 60), lojas: ls };
      if (i >= 0) lista[i] = d; else lista.push(d);
    }
    NOTIF.gravar(c);
    aud(req, remover ? 'removeu destinatário' : 'salvou destinatário', 'notificações', { canal, para: nome || ident });
    res.json({ ok: true });
  });
  r.post('/notif/teste', soAdmin, json, async (req, res) => {
    try {
      const r2 = await NOTIF.enviarTodos(obterIndicadores, { soDestino: { canal: req.body.canal, id: String(req.body.id || '') } });
      if (!r2.length) return res.status(400).json({ erro: 'Destinatário não encontrado ou canal não configurado.' });
      if (!r2[0].ok) return res.status(502).json({ erro: r2[0].erro });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erro: e.message }); }
  });
  r.get('/notif/previa', soAdmin, async (req, res) => {
    try { res.json({ texto: (await NOTIF.montarTexto([String(req.query.loja || '*')], obterIndicadores, NOTIF.ler().alertas)) || 'Sem dados.' }); } catch (e) { res.status(500).json({ erro: e.message }); }
  });

  // ---------- horários do coletor ----------
  r.put('/horarios', soAdmin, json, (req, res) => {
    const hs = [...new Set((req.body.horarios || []).map((h) => String(h).trim()).filter((h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h)))].sort();
    if (!hs.length) return res.status(400).json({ erro: 'Informe pelo menos um horário (HH:MM).' });
    C.gravarAtomico(path.join(C.COLETOR_DIR, 'horarios.txt'), hs.join('\n') + '\n', 0o644);
    aud(req, 'alterou horários', 'coletor', { horarios: hs });
    res.json({ ok: true, horarios: hs });
  });

  // ---------- usuários ----------
  function validarUsuario(req, dados, alvoAtual) {
    const cfg = C.get();
    const perfil = dados.perfil;
    if (!C.PERFIS.includes(perfil)) return 'Perfil inválido.';
    if (req.perfil === 'franqueado') {
      if (!['gerente', 'vendedor'].includes(perfil)) return 'Você pode criar apenas gerentes e vendedores.';
      if (alvoAtual && !['gerente', 'vendedor'].includes(alvoAtual.perfil)) return 'Sem permissão para alterar este usuário.';
      const minhas = new Set(req.lojas.map((l) => l.id));
      if (!dados.lojas.length || !dados.lojas.every((l) => minhas.has(l))) return 'Escolha apenas lojas suas.';
    }
    if (perfil !== 'admin' && !dados.lojas.length) return 'Escolha pelo menos uma loja.';
    if (dados.lojas.some((l) => l !== '*' && !cfg.lojas.some((x) => x.id === l))) return 'Loja inexistente.';
    if (perfil === 'vendedor' && dados.lojas.length !== 1) return 'O vendedor fica em uma loja só.';
    if (perfil === 'vendedor' && !dados.vendedor) return 'Escolha qual vendedor (nome no sistema) é esta pessoa.';
    if (perfil === 'gerente' && dados.telas && !dados.telas.length) return 'Libere pelo menos uma tela para o gerente.';
    return null;
  }
  const limparDados = (b) => ({
    perfil: String(b.perfil || ''),
    lojas: b.perfil === 'admin' ? ['*'] : [...new Set((Array.isArray(b.lojas) ? b.lojas : []).map((x) => String(x).toLowerCase()))].filter((x) => x !== '*'),
    vendedor: b.perfil === 'vendedor' ? semQuebra(b.vendedor).toUpperCase() : '',
    telas: b.perfil === 'gerente' && Array.isArray(b.telas) ? [...new Set(b.telas.map(String))].filter((t) => C.TELAS.includes(t)) : undefined,
    ativo: b.ativo !== false,
  });

  r.post('/usuarios', json, (req, res) => {
    const nome = String(req.body.nome || '').trim().toLowerCase();
    if (!NOME_OK.test(nome)) return res.status(400).json({ erro: 'Usuário inválido: 2 a 30 caracteres, letras minúsculas, números, ponto, hífen ou _.' });
    const senha = String(req.body.senha || '');
    if (senha.length < 8) return res.status(400).json({ erro: 'A senha precisa de pelo menos 8 caracteres.' });
    const d = limparDados(req.body);
    const erro = validarUsuario(req, d, null);
    if (erro) return res.status(400).json({ erro });
    try {
      C.alterar((cfg) => {
        if (cfg.usuarios[nome]) throw new Error(`O usuário "${nome}" já existe.`);
        cfg.usuarios[nome] = { senha: C.hashSenha(senha), ...d, criadoEm: new Date().toISOString() };
      });
    } catch (e) { return res.status(400).json({ erro: e.message }); }
    aud(req, 'criou usuário', nome, { perfil: d.perfil, lojas: d.lojas, loja: d.lojas[0] });
    res.json({ ok: true });
  });

  r.put('/usuarios/:nome', json, (req, res) => {
    const nome = String(req.params.nome).toLowerCase();
    const alvo = C.get().usuarios[nome];
    if (!alvo || nome === '*') return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (!usuariosVisiveis(req).some((u) => u.nome === nome)) return res.status(403).json({ erro: 'Sem permissão para alterar este usuário.' });
    const d = limparDados({ ...alvo, ...req.body });
    if (nome === req.user && (d.perfil !== alvo.perfil || !d.ativo)) return res.status(400).json({ erro: 'Você não pode mudar o próprio perfil nem se desativar.' });
    const erro = validarUsuario(req, d, alvo);
    if (erro) return res.status(400).json({ erro });
    const senha = req.body.senha ? String(req.body.senha) : null;
    if (senha && senha.length < 8) return res.status(400).json({ erro: 'A senha precisa de pelo menos 8 caracteres.' });
    C.alterar((cfg) => {
      const u = cfg.usuarios[nome];
      Object.assign(u, d);
      if (senha) u.senha = C.hashSenha(senha);
    });
    aud(req, 'alterou usuário', nome, { perfil: d.perfil, lojas: d.lojas, telas: d.telas, ativo: d.ativo, senha: senha ? 'redefinida' : undefined, loja: d.lojas[0] });
    pacoteLimpar();
    res.json({ ok: true });
  });

  r.delete('/usuarios/:nome', (req, res) => {
    const nome = String(req.params.nome).toLowerCase();
    if (nome === req.user) return res.status(400).json({ erro: 'Você não pode excluir o próprio usuário.' });
    if (!usuariosVisiveis(req).some((u) => u.nome === nome)) return res.status(403).json({ erro: 'Sem permissão.' });
    const alvo = C.get().usuarios[nome];
    C.alterar((cfg) => { delete cfg.usuarios[nome]; });
    aud(req, 'excluiu usuário', nome, { loja: alvo?.lojas?.[0] });
    res.json({ ok: true });
  });

  app.use('/api/admin', r);
}

module.exports = { registrar };
