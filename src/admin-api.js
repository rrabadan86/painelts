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
const XB = require('./xmlbase');
const CAD = require('./cadastro');
const ES = require('./estoque');
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
function hostSmtpInvalido(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (!/^[a-z0-9.:-]+$/.test(h) || !h.includes('.')) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h === 'coletor' || h === 'teashop-painel') return true;
  if (h.includes(':')) return true; // bloqueia IPv6 literal em SMTP configurável
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return true;
  }
  return false;
}

const DIAS_SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
function validarOperacao(o) {
  if (!o || typeof o !== 'object' || !o.funcionamento || !o.equipe) return 'Dados inválidos.';
  const hm = (x) => typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
  for (const d of DIAS_SEMANA) {
    const f = o.funcionamento[d];
    if (!f || typeof f.fechado !== 'boolean') return `Horário de ${d} inválido.`;
    if (!f.fechado && (!hm(f.abre) || !hm(f.fecha) || f.abre >= f.fecha)) return `Confira o horário de ${d} (abertura antes do fechamento).`;
  }
  const fer = o.funcionamento.feriado;
  if (fer != null) {
    if (typeof fer !== 'object' || typeof fer.fechado !== 'boolean' || typeof fer.mesmoDoDia !== 'boolean') return 'Horário de feriados inválido.';
    if (!fer.mesmoDoDia && !fer.fechado && (!hm(fer.abre) || !hm(fer.fecha) || fer.abre >= fer.fecha)) return 'Confira o horário dos feriados (abertura antes do fechamento).';
  }
  const e = o.equipe;
  const int = (x, a, b) => Number.isInteger(x) && x >= a && x <= b;
  if (!int(e.funcionarios, 1, 40)) return 'Quantidade de funcionários inválida (1 a 40).';
  if (!int(e.cargaSemanal, 4, 60)) return 'Carga horária semanal inválida.';
  if (!['5x2', '6x1'].includes(e.escala)) return 'Escala inválida.';
  if (!int(e.intervalo, 0, 180)) return 'Intervalo inválido.';
  if (e.intervaloAte8 != null && !int(e.intervaloAte8, 0, 180)) return 'Intervalo da jornada de até 8h inválido (0 a 180 min).';
  if (!(typeof e.capacidade === 'number' && e.capacidade > 0 && e.capacidade <= 100)) return 'Atendimentos por pessoa por hora inválido.';
  if (e.nomes != null && (!Array.isArray(e.nomes) || e.nomes.length > 40 || e.nomes.some((n) => typeof n !== 'string' || n.length > 40))) return 'Nomes inválidos.';
  if (e.modelo != null && !['livre', 'rodizio'].includes(e.modelo)) return 'Modelo de escala inválido.';
  if (e.inicioRodizio != null && !/^\d{4}-\d{2}-\d{2}$/.test(e.inicioRodizio)) return 'Data de início do rodízio inválida.';
  if (e.inicioSemana != null && !['dom', 'seg'].includes(e.inicioSemana)) return 'Dia de início da semana inválido.';
  if (e.minimoDia != null) {
    if (typeof e.minimoDia !== 'object') return 'Mínimo por dia inválido.';
    for (const d of DIAS_SEMANA) if (e.minimoDia[d] != null && !int(e.minimoDia[d], 0, 20)) return `Mínimo de pessoas de ${d} inválido.`;
  }
  if (e.maxFolgaDia != null && !int(e.maxFolgaDia, 1, 10)) return 'Máximo de folgas no mesmo dia inválido (1 a 10).';
  if (e.pessoas != null) {
    if (!Array.isArray(e.pessoas) || e.pessoas.length > 40) return 'Equipe inválida.';
    const dia = (x) => x === 'auto' || DIAS_SEMANA.includes(x);
    for (const p of e.pessoas) {
      if (!p || typeof p.nome !== 'string' || p.nome.length > 40) return 'Nome de pessoa inválido.';
      if (!dia(p.folga || 'auto') || !dia(p.folga2 || 'auto')) return `Folga fixa de ${p.nome || 'uma pessoa'} inválida.`;
      if (p.turno != null && !['tanto', 'manha', 'noite'].includes(p.turno)) return `Preferência de turno de ${p.nome || 'uma pessoa'} inválida.`;
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
  // mínimo de atendimentos no mês para concorrer à premiação (0 = sem mínimo; sem o campo vale o padrão, 20)
  if (p.minAtend != null && !(Number.isInteger(p.minAtend) && p.minAtend >= 0 && p.minAtend <= 2000)) return 'Mínimo de atendimentos da premiação inválido (0 a 2000).';
  // divide a meta quem tem pelo menos N dias com venda no mês (1 = qualquer venda; sem o campo vale o padrão, 4)
  if (g.pisoDiasMeta != null && !(Number.isInteger(g.pisoDiasMeta) && g.pisoDiasMeta >= 1 && g.pisoDiasMeta <= 31)) return 'Dias com venda para dividir a meta: de 1 a 31.';
  const b = g.bonus;
  if (!b || ![b.abaixo, b.bate, b.acima120].every(pct)) return 'Bônus inválido.';
  if (!g.rateio || typeof g.rateio.ativo !== 'boolean' || !Array.isArray(g.rateio.exclui)) return 'Rateio inválido.';
  if (!g.gorjeta || !['igual', 'proporcional'].includes(g.gorjeta.modo) || !pct(g.gorjeta.percentual)) return 'Gorjeta inválida.';
  const ry = g.royalties;
  if (!ry || ![ry.loja, ry.mkt, ry.eg, ry.egMkt].every(pct)) return 'Royalties inválidos.';
  if (!Array.isArray(g.semMeta) || g.semMeta.some((x) => typeof x !== 'string' || x.length > 60) || g.semMeta.length > 50) return 'Lista de vendedores sem meta inválida.';
  if (g.semComissao != null && (!Array.isArray(g.semComissao) || g.semComissao.some((x) => typeof x !== 'string' || x.length > 60) || g.semComissao.length > 50)) return 'Lista de quem não recebe comissão inválida.';
  return null;
}

const AG = require('./agenda');
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
  // franqueado: tudo da configuração das lojas DELE (o lojaPermitida limita); o coletor e o que é da rede toda continuam só do admin
  const soGestor = (req, res, next) => (req.perfil === 'admin' || req.perfil === 'franqueado' ? next() : res.status(403).json({ erro: 'Só o administrador ou o franqueado pode fazer isso.' }));
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
    }).map(([nome, u]) => ({ nome, perfil: u.perfil, lojas: u.lojas, vendedor: u.vendedor, telas: u.telas, ativo: u.ativo, acessoAte: u.acessoAte || null, expirado: C.expirado(u), trocarSenha: !!u.trocarSenha, senhaTrocadaEm: u.senhaTrocadaEm || null, criadoEm: u.criadoEm, ultimoAcesso: acessos[nome] || null }))
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
        return { nome, desc: d.desc, origem: st ? 'vps' : null, modificado: st ? st.mtime.toISOString() : null };
      });
      return {
        logo: !!arquivoLogo(l.id), operacao: l.operacao, ferias: l.ferias,
        metaAuto: l.metaAuto, totaisSemEG: totaisSemEG(l.id),
        // CFOP das NF-e (escolhido e os que o robô leu do AppNext)
        nfeCfop: require('./nfecfop').daLoja(l.id), cfopsAppNext: require('./nfecfop').listaAppNext(l.id),
        id: l.id, nome: l.nome, appnext: l.appnext, meta: l.meta, metas: l.metas, criadaEm: l.criadaEm, regras: l.regras, marca: l.marca, wppModelos: l.wppModelos, wppApresentacao: l.wppApresentacao || null, wppIntervalo: l.wppIntervalo ?? null,
        nomesVenda: (() => { const raw = rawDe(l.id); return raw ? [...new Set(raw.vendas.slice(-500).map((v) => v.loja).filter(Boolean))] : []; })(),
        base: B.resumo(l.id), xml: XB.resumo(l.id), estoque: (() => { const e = ES.atual(l.id); return e ? { em: e.em, itens: e.itens.length, origem: e.origem || '' } : null; })(), fechEmail: NOTIF.publicoLoja(l.id), eventos: require('./eventos').lista(l.id), horarios: (() => { const a = AG.ler(); return { propria: !!a.lojas[l.id], semana: a.lojas[l.id] || a.padrao, hoje: AG.doDia(l.id) }; })(), fontes, vendedores: vendedoresDe(l.id),
        fixe: { url: (env && env.FIXE_URL) || '', usuario: (env && env.FIXE_USER) || '', email: (env && env.FIXE_EMAIL) || '', temSenha: !!(env && env.FIXE_PASS), apelido: !(env && env.FIXE_APELIDO_USAR === '0'), enderecoPedido: env && env.FIXE_EMAIL ? (env.FIXE_APELIDO_USAR === '0' ? env.FIXE_EMAIL : require('./fixemail').comApelido(env.FIXE_EMAIL, l.id)) : '', ...require('./fixemail').situacao(l.id), logs: require('./fidelidade').resumo(l.id), saldos: require('./fidelidade').resumoSaldos(l.id), fidelidade: require('./fidelidade').regrasDe(l) },
        coletor: env ? { configurado: true, rede: env.APPNEXT_REDE || '', usuario: env.APPNEXT_USER || '', temSenha: !!env.APPNEXT_PASS, lojaDestino: env.APPNEXT_LOJA_DESTINO || '', lojaIdDestino: env.APPNEXT_LOJA_ID_DESTINO || '' } : { configurado: false },
        status,
      };
    }));
    const minhas = new Set(lojas.map((l) => l.id));
    const auditoria = C.lerAuditoria(4000).filter((e) => req.perfil === 'admin' || e.por === req.user || (e.detalhe && minhas.has(e.detalhe.loja)) || minhas.has(e.alvo)).slice(0, 3000);
    res.json({
      perfil: req.perfil, usuario: req.user, coletorAtivo: COL.ativo(), horarios: saude?.horarios || [], agenda: AG.ler().padrao, janela: saude?.janela || null, coletorOk: saude ? saude.ok !== false : null,
      lojas: itens, usuarios: usuariosVisiveis(req), auditoria, telas: require('./telas').paraTela(),
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
    } catch (e) { return res.status(400).json({ erro: C.msgErro(e) }); }
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
    if (mud.appnext !== undefined && lerEnv(req.loja.id)) gravarEnv(req.loja.id, { APPNEXT_LOJA_DESTINO: mud.appnext });
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
    try { AG.gravarLoja(id, null); } catch { /* ok */ }
    try { NOTIF.alterarPontual((nc) => { if (nc.lojas) delete nc.lojas[id]; }); } catch { /* ok */ }
    try {
      const fPed = path.join(C.CONFIG_DIR, 'acesso-pedido', `${id}.json`);
      if (fs.existsSync(fPed)) fs.renameSync(fPed, `${fPed}.removida-${Date.now()}`);
    } catch { /* ok */ }
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
  r.put('/lojas/:id/regras', soGestor, lojaPermitida, json, (req, res) => {
    const g = req.body && req.body.regras;
    if (g === null) {
      C.alterar((cfg) => { delete cfg.lojas.find((x) => x.id === req.loja.id).regras; });
      aud(req, 'voltou regras ao modelo', req.loja.id, { loja: req.loja.id });
      depois(); return res.json({ ok: true });
    }
    const erro = validarRegras(g);
    if (erro) return res.status(400).json({ erro });
    const antes = req.loja.regras || {};
    C.alterar((cfg) => { cfg.lojas.find((x) => x.id === req.loja.id).regras = g; });
    // pisos que mudam quem divide a meta e quem concorre à premiação: ficam na auditoria com o valor de antes
    aud(req, 'alterou regras de comissão', req.loja.id, { loja: req.loja.id, modelo: g.modelo,
      pisoDiasMeta: g.pisoDiasMeta ?? null, pisoDiasMetaAntes: antes.pisoDiasMeta ?? null,
      minAtendPremiacao: g.premiacao.minAtend ?? null, minAtendPremiacaoAntes: (antes.premiacao && antes.premiacao.minAtend) ?? null });
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
  r.put('/lojas/:id/appnext', soGestor, lojaPermitida, json, (req, res) => {
    const b = req.body || {};
    const rede = semQuebra(b.rede), usuario = semQuebra(b.usuario);
    if (!rede || !usuario) return res.status(400).json({ erro: 'Informe a rede e o usuário do AppNext.' });
    const atual = lerEnv(req.loja.id);
    if (!b.senha && !(atual && atual.APPNEXT_PASS)) return res.status(400).json({ erro: 'Informe a senha do AppNext.' });
    if (!b.senha && atual && atual.APPNEXT_PASS && ((atual.APPNEXT_USER && atual.APPNEXT_USER !== usuario) || (atual.APPNEXT_REDE && atual.APPNEXT_REDE !== rede))) {
      return res.status(400).json({ erro: 'Informe a senha novamente ao trocar a rede ou o usuário do AppNext.' });
    }
    const valores = {
      APPNEXT_REDE: rede, APPNEXT_USER: usuario,
      APPNEXT_LOJA_DESTINO: semQuebra(b.lojaDestino), APPNEXT_LOJA_ID_DESTINO: semQuebra(b.lojaIdDestino),
      MAX_RUNTIME_SECONDS: (atual && atual.MAX_RUNTIME_SECONDS) || '600',
      DATA_INICIO: null, DATA_FIM: null, DIAS_JANELA: null, // o período agora é controlado pelo coletor
    };
    if (b.senha) valores.APPNEXT_PASS = String(b.senha).replace(/[\r\n]/g, '');
    gravarEnv(req.loja.id, valores);
    // o mesmo nome aparece em "Dados da loja": ficam sempre iguais (inclusive quando apagado)
    C.alterar((cfg) => { const l = cfg.lojas.find((x) => x.id === req.loja.id); l.appnext = valores.APPNEXT_LOJA_DESTINO; });
    aud(req, 'alterou acesso ao AppNext', req.loja.id, { loja: req.loja.id, rede, usuario, senha: b.senha ? 'trocada' : 'mantida', lojaDestino: valores.APPNEXT_LOJA_DESTINO });
    res.json({ ok: true });
  });

  // ---------- configuração guiada (os 4 acessos da loja no primeiro uso) ----------
  // só diz o que está pronto e se a pessoa já viu a janela; cada acesso é gravado pela rota dele
  const GUIA = require('./guia');
  const guiaDe = (req) => {
    const u = C.get().usuarios[req.user] || {}, vistos = Array.isArray(u.guiaVisto) ? u.guiaVisto : [];
    return minhasLojas(req).map((l) => {
      let pedido = null; try { pedido = require('./pedido').acesso(l.id); } catch { /* sem login salvo */ }
      const passos = GUIA.situacao({ env: lerEnv(l.id), pedido, fechEmail: NOTIF.publicoLoja(l.id), nfeCfop: l.nfeCfop });
      const visto = vistos.includes(l.id);
      return { id: l.id, nome: l.nome, passos, visto, abrir: GUIA.abreSozinha(req.perfil, passos, visto) };
    });
  };
  r.get('/guia', soGestor, (req, res) => { try { res.json({ lojas: guiaDe(req) }); } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); } });
  r.post('/lojas/:id/guia/visto', soGestor, lojaPermitida, (req, res) => {
    try {
      C.alterar((cfg) => { const u = cfg.usuarios[req.user]; if (!u) return; u.guiaVisto = [...new Set([...(Array.isArray(u.guiaVisto) ? u.guiaVisto : []), req.loja.id])].slice(-200); });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
  });

  // ---------- CFOP das NF-e de venda e de devolução (Integrações → Notas fiscais e passo 5 da configuração guiada) ----------
  // o que está escolhido e a lista lida do AppNext (a tela relê depois do "Buscar no AppNext")
  r.get('/lojas/:id/nfe-cfop', soGestor, lojaPermitida, (req, res) => {
    const N = require('./nfecfop');
    res.json({ nfeCfop: N.daLoja(req.loja.id), cfopsAppNext: N.listaAppNext(req.loja.id) });
  });
  r.put('/lojas/:id/nfe-cfop', soGestor, lojaPermitida, json, (req, res) => {
    const v = require('./nfecfop').validar(req.body);
    if (v.erro) return res.status(400).json({ erro: v.erro });
    try {
      C.alterar((cfg) => { cfg.lojas.find((l) => l.id === req.loja.id).nfeCfop = v.ok; });
      C.auditar(req.user, 'mudou o CFOP das NF-e emitidas pelo robô', req.loja.id, { loja: req.loja.id, venda: v.ok.venda || 'automático (5102)', devolucao: v.ok.devolucao || 'automático' });
      res.json({ ok: true, nfeCfop: v.ok });
    } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
  });

  // ---------- acesso ao FIXE (cadastro de clientes) ----------
  r.put('/lojas/:id/fixe', lojaPermitida, json, (req, res) => {
    const b = req.body || {};
    const url = semQuebra(b.url), usuario = semQuebra(b.usuario), email = semQuebra(b.email).toLowerCase();
    if (!/^https:\/\/([a-z0-9-]+\.)*epossible\.com\.br\/loja\/[a-z0-9]+\/leads\/?$/i.test(url)) return res.status(400).json({ erro: 'Cole o endereço da página de Leads do FIXE (https://dash.epossible.com.br/loja/…/leads).' });
    if (!usuario) return res.status(400).json({ erro: 'Informe o usuário (e-mail) do FIXE.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: 'Informe o e-mail que recebe a exportação (o Gmail da loja).' });
    const atual = lerEnv(req.loja.id);
    if (!atual) return res.status(400).json({ erro: 'Cadastre primeiro o acesso ao AppNext desta loja (o coletor usa o mesmo arquivo).' });
    if (!b.senha && !atual.FIXE_PASS) return res.status(400).json({ erro: 'Informe a senha do FIXE.' });
    if (!b.senha && atual.FIXE_PASS && ((atual.FIXE_USER && atual.FIXE_USER !== usuario) || (atual.FIXE_URL && atual.FIXE_URL !== url))) {
      return res.status(400).json({ erro: 'Informe a senha do FIXE novamente ao trocar o endereço ou o usuário.' });
    }
    const valores = { FIXE_URL: url, FIXE_USER: usuario, FIXE_EMAIL: email };
    if (b.apelido != null) valores.FIXE_APELIDO_USAR = b.apelido ? null : '0'; // padrão: usa o apelido +loja no Gmail
    if (b.senha) valores.FIXE_PASS = String(b.senha).replace(/[\r\n]/g, '');
    gravarEnv(req.loja.id, valores);
    aud(req, 'alterou acesso ao FIXE', req.loja.id, { loja: req.loja.id, usuario, email, apelido: b.apelido == null ? undefined : !!b.apelido, senha: b.senha ? 'trocada' : 'mantida' });
    res.json({ ok: true });
  });
  r.delete('/lojas/:id/fixe', lojaPermitida, (req, res) => {
    if (!lerEnv(req.loja.id)) return res.json({ ok: true });
    gravarEnv(req.loja.id, { FIXE_URL: null, FIXE_USER: null, FIXE_EMAIL: null, FIXE_PASS: null, FIXE_APELIDO_USAR: null });
    aud(req, 'removeu acesso ao FIXE', req.loja.id, { loja: req.loja.id });
    res.json({ ok: true });
  });
  // regras do programa de fidelidade (hoje a franquia usa R$ 50 = 1 ponto, validade de 12 meses)
  r.put('/lojas/:id/fidelidade', lojaPermitida, json, (req, res) => {
    if (req.perfil !== 'admin' && req.perfil !== 'franqueado') return res.status(403).json({ erro: 'Só o administrador ou o franqueado pode alterar.' });
    const b = req.body || {};
    const rpp = Number(String(b.reaisPorPonto ?? '').replace(',', '.')), val = Number(b.validadeMeses);
    if (!(rpp > 0 && rpp <= 10000)) return res.status(400).json({ erro: 'Informe quantos reais valem 1 ponto.' });
    if (!(Number.isInteger(val) && val >= 1 && val <= 120)) return res.status(400).json({ erro: 'Informe a validade dos pontos em meses (1 a 120).' });
    const atual = require('./fidelidade').regrasDe(req.loja);
    const minR = b.minResgate == null || b.minResgate === '' ? atual.minResgate : Number(b.minResgate), prazo = b.prazoResgate == null || b.prazoResgate === '' ? atual.prazoResgate : Number(b.prazoResgate);
    if (!(Number.isInteger(minR) && minR >= 1 && minR <= 1000)) return res.status(400).json({ erro: 'Mínimo para resgatar: de 1 a 1000 pontos.' });
    if (!(Number.isInteger(prazo) && prazo >= 7 && prazo <= 730)) return res.status(400).json({ erro: 'Prazo para resgatar: de 7 a 730 dias.' });
    C.alterar((cfg) => { const l = cfg.lojas.find((x) => x.id === req.loja.id); l.fidelidade = { reaisPorPonto: Math.round(rpp * 100) / 100, validadeMeses: val, minResgate: minR, prazoResgate: prazo }; });
    aud(req, 'alterou regras da fidelidade', req.loja.id, { loja: req.loja.id, reaisPorPonto: rpp, validadeMeses: val, minResgate: minR, prazoResgate: prazo });
    depois(req.loja.id);
    res.json({ ok: true });
  });
  r.post('/lojas/:id/fixe/rodar', soGestor, lojaPermitida, async (req, res) => {
    if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS.' });
    const env = lerEnv(req.loja.id);
    if (!env || !env.FIXE_URL || !env.FIXE_PASS) return res.status(400).json({ erro: 'Cadastre primeiro o acesso ao FIXE desta loja.' });
    try {
      const x = await COL.fixe(req.loja.id, req.user);
      if (x.status === 409) return res.status(409).json({ erro: (x.json && x.json.erro) || 'Já tem uma coleta na fila ou rodando.' });
      if (x.status >= 400) return res.status(400).json({ erro: (x.json && x.json.erro) || 'Falha ao pedir.' });
      aud(req, 'pediu cadastro de clientes do FIXE', req.loja.id, { loja: req.loja.id });
      res.json({ ok: true });
    } catch (e) { res.status(502).json({ erro: C.msgErro(e) }); }
  });

  r.post('/lojas/:id/fixe/saldos', soGestor, lojaPermitida, async (req, res) => {
    if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS.' });
    const env = lerEnv(req.loja.id);
    if (!env || !env.FIXE_URL || !env.FIXE_PASS) return res.status(400).json({ erro: 'Cadastre primeiro o acesso ao FIXE desta loja.' });
    try {
      const x = await COL.fixeSaldos(req.loja.id, req.user);
      if (x.status === 409) return res.status(409).json({ erro: (x.json && x.json.erro) || 'Já tem uma coleta na fila ou rodando.' });
      if (x.status >= 400) return res.status(400).json({ erro: (x.json && x.json.erro) || 'Falha ao pedir.' });
      aud(req, 'sincronizou saldos de pontos com o FIXE', req.loja.id, { loja: req.loja.id });
      res.json({ ok: true });
    } catch (e) { res.status(502).json({ erro: C.msgErro(e) }); }
  });

  r.post('/lojas/:id/rodar', soGestor, lojaPermitida, async (req, res) => {
    if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS.' });
    if (!lerEnv(req.loja.id)) return res.status(400).json({ erro: 'Cadastre primeiro o acesso ao AppNext desta loja.' });
    try {
      const x = await COL.rodar(req.loja.id, req.user);
      if (x.status !== 200) return res.status(x.status).json({ erro: x.json.erro || 'Falha no coletor.' });
      aud(req, 'rodou atualização', req.loja.id, { loja: req.loja.id });
      res.json({ ok: true });
    } catch (e) { res.status(502).json({ erro: C.msgErro(e) }); }
  });

  r.post('/lojas/:id/historico', soGestor, lojaPermitida, json, async (req, res) => {
    if (!COL.ativo()) return res.status(400).json({ erro: 'O coletor não está ligado nesta VPS.' });
    if (!lerEnv(req.loja.id)) return res.status(400).json({ erro: 'Cadastre primeiro o acesso ao AppNext desta loja.' });
    const { de, ate } = req.body || {};
    const passo = Math.max(1, Math.min(12, +req.body.mesesPorParte || 3));
    const tipo = ['ambos', 'vendas', 'xml'].includes(req.body.tipo) ? req.body.tipo : 'ambos';
    if (!YM_OK.test(de || '') || !YM_OK.test(ate || '') || de > ate) return res.status(400).json({ erro: 'Período inválido.' });
    const meses = B.mesesEntre(de + '-01', ate + '-01');
    if (meses.length > 120) return res.status(400).json({ erro: 'Período longo demais (máximo 10 anos).' });
    const hoje = C.hojeBR();
    const partes = [];
    for (let i = 0; i < meses.length; i += passo) {
      const ini = meses[i], fim = meses[Math.min(meses.length - 1, i + passo - 1)];
      const [y, m] = fim.split('-').map(Number);
      let ult = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      if (ult > hoje) ult = hoje;
      if (`${ini}-01` <= ult) partes.push({ de: `${ini}-01`, ate: ult });
    }
    try {
      const extras = (Array.isArray(req.body.extras) ? req.body.extras : []).filter((x) => ['estoque', 'fixe'].includes(x));
      const x = await COL.historico(req.loja.id, partes, req.user, tipo, extras);
      if (x.status !== 200) return res.status(x.status).json({ erro: x.json.erro || 'Falha no coletor.' });
      aud(req, 'importou histórico', req.loja.id, { loja: req.loja.id, de, ate, partes: partes.length, tipo, extras: req.body.extras || undefined });
      res.json({ ok: true, partes: partes.length });
    } catch (e) { res.status(502).json({ erro: C.msgErro(e) }); }
  });

  r.post('/lojas/:id/cancelar', soGestor, lojaPermitida, async (req, res) => {
    try {
      const x = await COL.cancelar(req.loja.id, req.user);
      aud(req, 'cancelou coleta', req.loja.id, { loja: req.loja.id });
      res.status(x.status).json(x.json);
    } catch (e) { res.status(502).json({ erro: C.msgErro(e) }); }
  });

  // ---------- envio de planilhas ----------
  const TIPOS = { vendas: null, historico: null, Xml: 'Xml', Dados_Clientes: 'Dados_Clientes', Meta: 'Meta', Estoque: null, Produtos: null };
  r.post('/lojas/:id/upload/:tipo', lojaPermitida, express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` }), async (req, res) => {
    const tipo = req.params.tipo;
    if (!Object.hasOwn(TIPOS, tipo)) return res.status(400).json({ erro: 'Tipo de planilha inválido.' });
    const buf = req.body;
    if (tipo === 'Estoque') {
      if (req.perfil !== 'admin' && req.perfil !== 'franqueado') return res.status(403).json({ erro: 'Só admin e franqueado.' });
      try {
        // planilha com menos da metade dos produtos com saldo é recusada; quem enviou pode confirmar (?forcar=1)
        const forcar = req.query.forcar === '1';
        const r = await ES.importar(req.loja.id, buf, 'painel', { forcar });
        aud(req, 'enviou estoque', req.loja.id, { loja: req.loja.id, arquivo: semQuebra(req.get('X-Arquivo') || '').slice(0, 80), itens: r.itens, ...(forcar ? { forcado: true } : {}) });
        return res.json({ ok: true, estoque: r });
      } catch (e) { return res.status(400).json({ erro: C.msgErro(e), ...(e.parcial ? { podeForcar: true } : {}) }); }
    }
    if (tipo === 'Produtos') {
      // preço de tabela: Produtos ou Produtos Compostos do AppNext (o painel reconhece pelo título)
      if (req.perfil !== 'admin' && req.perfil !== 'franqueado') return res.status(403).json({ erro: 'Só admin e franqueado.' });
      try {
        const r = await require('./tabela').importar(req.loja.id, buf);
        aud(req, 'enviou preço de tabela', req.loja.id, { loja: req.loja.id, tipo: r.tipo, arquivo: semQuebra(req.get('X-Arquivo') || '').slice(0, 80), itens: r.itens });
        return res.json({ ok: true, tabela: r });
      } catch (e) { return res.status(400).json({ erro: C.msgErro(e) }); }
    }
    if (tipo === 'Dados_Clientes' && Buffer.isBuffer(buf) && buf.length >= 100) {
      // cadastro: modelo do painel ou exportação do FIXE; junta com o que já existe
      try {
        const FI = require('./fidelidade');
        const { linhasDeBuffer } = require('./sources');
        if (FI.ehLogs(await linhasDeBuffer(buf))) { // Logs do FIXE (compras, pontos e resgates)
          const r = await FI.importar(req.loja.id, buf);
          aud(req, 'enviou logs do FIXE', req.loja.id, { loja: req.loja.id, movimentos: r.movimentos, clientes: r.clientes });
          depois(req.loja.id);
          return res.json({ ok: true, logs: r });
        }
        const r = await CAD.importar(req.loja.id, buf);
        aud(req, 'enviou cadastro de clientes', req.loja.id, { loja: req.loja.id, formato: r.formato, arquivo: semQuebra(req.get('X-Arquivo') || '').slice(0, 80), novos: r.novos, atualizados: r.atualizados, total: r.total });
        depois(req.loja.id);
        return res.json({ ok: true, cadastro: r });
      } catch (e) { return res.status(400).json({ erro: C.msgErro(e) }); }
    }
    if (!Buffer.isBuffer(buf) || buf.length < 100 || buf[0] !== 0x50 || buf[1] !== 0x4b) return res.status(400).json({ erro: 'O arquivo não é uma planilha .xlsx.' });
    if (tipo === 'historico') {
      // vendas do sistema antigo (antes do AppNext): só os dias anteriores à primeira venda que o painel já tem
      if (req.perfil !== 'admin' && req.perfil !== 'franqueado') return res.status(403).json({ erro: 'Só admin e franqueado.' });
      try {
        const T = require('./transform');
        const { linhasDeBuffer } = require('./sources');
        const vendas = T.transformVendas(await linhasDeBuffer(buf, 'Sheet1'), 'historico');
        if (!vendas.length) throw new Error('Não achei vendas na planilha (ela precisa ter as colunas Data, Número Cupom, Descrição… como o relatório de vendas).');
        const r = B.completarAntes(req.loja.id, vendas, { origem: 'histórico do sistema antigo', por: req.user });
        aud(req, 'enviou histórico antigo de vendas', req.loja.id, { loja: req.loja.id, arquivo: semQuebra(req.get('X-Arquivo') || '').slice(0, 80), linhas: r.linhas, de: r.de, ate: r.ate });
        depois(req.loja.id);
        return res.json({ ok: true, historico: r });
      } catch (e) { return res.status(400).json({ erro: C.msgErro(e) }); }
    }
    const nomeOrig = semQuebra(req.get('X-Arquivo') || '').slice(0, 80);
    if (tipo === 'vendas') B.receber(req.loja.id, buf, { origem: 'painel' });
    else C.gravarAtomico(path.join(C.pastaLoja(req.loja.id), `${TIPOS[tipo]}.xlsx`), buf, 0o640);
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

  // ---------- modelos de mensagem de WhatsApp (tela Clientes) ----------
  r.put('/lojas/:id/wpp-modelos', lojaPermitida, json, (req, res) => {
    const lista = Array.isArray(req.body.modelos) ? req.body.modelos : null;
    if (!lista || lista.length > 12) return res.status(400).json({ erro: 'Lista de modelos inválida (até 12).' });
    const limpos = lista.map((m) => ({ nome: semQuebra(m.nome).slice(0, 40), texto: String(m.texto || '').replace(/\r/g, '').slice(0, 700) })).filter((m) => m.nome && m.texto);
    // intervalo mínimo entre duas mensagens para o mesmo cliente (Hoje, ficha e campanhas): 7 a 90 dias
    const iv = req.body.intervalo == null ? null : Math.round(Number(req.body.intervalo));
    if (iv != null && !(iv >= 7 && iv <= 90)) return res.status(400).json({ erro: 'Intervalo entre mensagens: de 7 a 90 dias.' });
    // {apresentacao}: dois modelos (com e sem vendedora), só com {vendedora} e {loja}, até 120 caracteres; vazio = padrão
    let apres;
    if (req.body.apresentacao != null) {
      const MW = require('../public/js/msgwpp.js');
      const com = MW.apresentacaoValida(req.body.apresentacao.com), sem = MW.apresentacaoValida(req.body.apresentacao.sem);
      if (com == null || sem == null) return res.status(400).json({ erro: 'Apresentação: até 120 caracteres e só os campos {vendedora} e {loja}.' });
      apres = com || sem ? { com, sem } : null;
    }
    C.alterar((cfg) => { const l = cfg.lojas.find((x) => x.id === req.loja.id); l.wppModelos = limpos; if (iv != null) l.wppIntervalo = iv; if (apres !== undefined) l.wppApresentacao = apres; });
    aud(req, 'alterou modelos de WhatsApp', req.loja.id, { loja: req.loja.id, modelos: limpos.length, intervalo: iv, apresentacao: apres !== undefined });
    pacoteLimpar();
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
  // Franqueado: abre a tela e cuida só do que é das lojas dele. Horário, ativação, token do Telegram, SMTP e
  // e-mail dos avisos são da rede (só o admin); destinatário "dele" = todas as lojas do destinatário são dele (nunca '*').
  const idsMeus = (req) => new Set(minhasLojas(req).map((l) => l.id));
  const destinoMeu = (req, d) => req.perfil === 'admin' || (Array.isArray(d.lojas) && d.lojas.length > 0 && d.lojas.every((x) => x !== '*' && idsMeus(req).has(x)));
  r.get('/notif', (req, res) => {
    const p = NOTIF.publico();
    if (req.perfil === 'admin') return res.json(p);
    res.json({
      restrito: true, ativo: p.ativo, horario: p.horario, ultimoEnvio: p.ultimoEnvio, alertas: p.alertas, fechamento: p.fechamento,
      telegram: { configurado: p.telegram.configurado, destinos: p.telegram.destinos.filter((d) => destinoMeu(req, d)) },
      email: { configurado: p.email.configurado, destinos: p.email.destinos.filter((d) => destinoMeu(req, d)) },
    });
  });
  r.put('/notif', soAdmin, json, (req, res) => {
    const b = req.body || {};
    const c = NOTIF.ler();
    if (b.horario != null) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.horario)) return res.status(400).json({ erro: 'Horário inválido.' }); c.horario = b.horario; }
    if (b.ativo != null) c.ativo = !!b.ativo;
    if (b.fechamento) {
      if (b.fechamento.horario != null) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.fechamento.horario)) return res.status(400).json({ erro: 'Horário do fechamento inválido.' }); c.fechamento.horario = b.fechamento.horario; }
      if (b.fechamento.ativo != null) c.fechamento.ativo = !!b.fechamento.ativo;
    }
    if (b.alertas != null) c.alertas = !!b.alertas;
    if (b.avisos && b.avisos.email != null) {
      const em = semQuebra(b.avisos.email).toLowerCase();
      if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ erro: 'E-mail dos avisos inválido.' });
      c.avisos = { ...(c.avisos || {}), email: em };
    }
    if (b.telegram && b.telegram.token != null) {
      const t = semQuebra(b.telegram.token);
      if (t && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(t)) return res.status(400).json({ erro: 'Token do robô inválido (formato 123456789:ABC...).' });
      c.telegram.token = t;
    }
    if (b.email) {
      const e = b.email;
      const hNovo = e.host != null ? semQuebra(e.host) : c.email.host;
      const uNovo = e.user != null ? semQuebra(e.user) : c.email.user;
      if (hostSmtpInvalido(hNovo)) return res.status(400).json({ erro: 'Servidor SMTP inválido.' });
      if (!e.pass && c.email.pass && ((c.email.host && hNovo !== c.email.host) || (c.email.user && uNovo !== c.email.user))) {
        return res.status(400).json({ erro: 'Informe a senha novamente ao trocar o servidor ou o usuário de e-mail.' });
      }
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
    try { res.json({ conversas: await NOTIF.conversasTelegram() }); } catch (e) { res.status(400).json({ erro: C.msgErro(e) }); }
  });
  r.post('/notif/destinos', json, (req, res) => {
    const { canal, id, nome, lojas, remover } = req.body || {};
    const c = NOTIF.ler();
    const lista = canal === 'telegram' ? c.telegram.destinos : canal === 'email' ? c.email.destinos : null;
    if (!lista) return res.status(400).json({ erro: 'Canal inválido.' });
    const chave = canal === 'telegram' ? 'chatId' : 'email';
    const ident = semQuebra(id);
    if (canal === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ident)) return res.status(400).json({ erro: 'E-mail inválido.' });
    if (canal === 'telegram' && !/^-?\d{3,20}$/.test(ident)) return res.status(400).json({ erro: 'Conversa inválida.' });
    const i = lista.findIndex((d) => String(d[chave]) === ident);
    if (req.perfil !== 'admin') {
      // franqueado: só mexe em destinatário das lojas dele; o que é da rede ou de outra loja ele nem altera nem sobrescreve
      if (i >= 0 && !destinoMeu(req, lista[i])) return res.status(403).json({ erro: 'Este destinatário é da rede: peça ao administrador.' });
      if (remover && i < 0) return res.status(404).json({ erro: 'Destinatário não encontrado.' });
      if (!remover) {
        if (i < 0 && canal === 'telegram') return res.status(403).json({ erro: 'Só o administrador vincula uma conversa nova do Telegram.' });
        if (!Array.isArray(lojas) || !lojas.length || !destinoMeu(req, { lojas: lojas.map(String) })) return res.status(403).json({ erro: 'Escolha só lojas suas.' });
      }
    }
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
  r.post('/notif/teste', json, async (req, res) => {
    try {
      const soDestino = { canal: req.body.canal, id: String(req.body.id || '') };
      if (req.perfil !== 'admin') { // franqueado: só testa destinatário das lojas dele
        const c = NOTIF.ler();
        const d = soDestino.canal === 'telegram' ? c.telegram.destinos.find((y) => String(y.chatId) === soDestino.id) : soDestino.canal === 'email' ? c.email.destinos.find((y) => y.email === soDestino.id) : null;
        if (!d || !destinoMeu(req, d)) return res.status(404).json({ erro: 'Destinatário não encontrado.' });
      }
      const r2 = req.body.tipo === 'fechamento' ? await NOTIF.enviarFechamento(obterIndicadores, { soDestino }) : await NOTIF.enviarTodos(obterIndicadores, { soDestino });
      if (!r2.length) return res.status(400).json({ erro: 'Destinatário não encontrado ou canal não configurado.' });
      if (!r2[0].ok) return res.status(502).json({ erro: r2[0].erro });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
  });
  // ---------- fechamento do dia por loja (Gmail e destinatários da própria franquia) ----------
  const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  r.put('/lojas/:id/fechamento-email', lojaPermitida, json, (req, res) => {
    const b = req.body || {};
    const c = NOTIF.ler();
    const x = NOTIF.cfgLoja(c, req.loja.id);
    if (b.email && b.email.remover) {
      x.email = { ...x.email, host: '', user: '', from: '', pass: '' };
    } else if (b.email) {
      const e = b.email;
      const hNovo = e.host != null ? semQuebra(e.host).slice(0, 200) : x.email.host;
      const uNovo = e.user != null ? semQuebra(e.user).slice(0, 200) : x.email.user;
      if (hostSmtpInvalido(hNovo)) return res.status(400).json({ erro: 'Servidor SMTP inválido.' });
      if (!e.pass && x.email.pass && ((x.email.host && hNovo !== x.email.host) || (x.email.user && uNovo !== x.email.user))) {
        return res.status(400).json({ erro: 'Informe a senha de aplicativo novamente ao trocar o servidor ou o usuário de e-mail.' });
      }
      for (const k of ['host', 'user', 'from']) if (e[k] != null) x.email[k] = semQuebra(e[k]).slice(0, 200);
      if (e.port != null) x.email.port = +e.port || 587;
      if (e.secure != null) x.email.secure = !!e.secure;
      if (e.pass) x.email.pass = String(e.pass).replace(/[\r\n]/g, '');
      if (x.email.user && !EMAIL_OK.test(x.email.user)) return res.status(400).json({ erro: 'Usuário: informe o endereço completo do Gmail.' });
    }
    if (b.fechamento) {
      if (b.fechamento.horario != null) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.fechamento.horario)) return res.status(400).json({ erro: 'Horário inválido.' }); x.fechamento.horario = b.fechamento.horario; }
      if (b.fechamento.ativo != null) x.fechamento.ativo = !!b.fechamento.ativo;
      if (b.fechamento.assunto != null) {
        const t = String(b.fechamento.assunto).replace(/[\r\n]+/g, ' ').trim().slice(0, 150);
        if (t && !NOTIF.assuntoValido(t)) return res.status(400).json({ erro: 'O assunto precisa ter a data do fechamento: use {data} (ou {dia}, {mes} e {ano}).' });
        x.fechamento.assunto = t || null;
      }
    }
    NOTIF.gravar(c);
    aud(req, 'alterou fechamento por e-mail', req.loja.id, { loja: req.loja.id, servidor: b.email ? x.email.host : undefined, usuario: b.email ? x.email.user : undefined, senha: b.email && b.email.pass ? 'trocada' : undefined, ativo: b.fechamento ? x.fechamento.ativo : undefined, horario: b.fechamento ? x.fechamento.horario : undefined, assunto: b.fechamento && b.fechamento.assunto != null ? x.fechamento.assunto : undefined });
    res.json({ ok: true, fechEmail: NOTIF.publicoLoja(req.loja.id) });
  });
  r.post('/lojas/:id/fechamento-email/destinos', lojaPermitida, json, (req, res) => {
    const { email, nome, remover, caixa } = req.body || {};
    const ident = semQuebra(email).toLowerCase();
    if (!EMAIL_OK.test(ident)) return res.status(400).json({ erro: 'E-mail inválido.' });
    const c = NOTIF.ler();
    const x = NOTIF.cfgLoja(c, req.loja.id);
    const i = x.destinos.findIndex((d) => d.email.toLowerCase() === ident);
    if (remover) { if (i >= 0) x.destinos.splice(i, 1); }
    else {
      if (x.destinos.length >= 30 && i < 0) return res.status(400).json({ erro: 'Máximo de 30 destinatários por loja.' });
      // só mudar o "recebe o caixa": mantém o nome que já estava
      const d = { email: ident, nome: nome == null && i >= 0 ? x.destinos[i].nome : semQuebra(nome).slice(0, 60), caixa: caixa == null ? (i >= 0 ? x.destinos[i].caixa !== false : true) : !!caixa };
      if (i >= 0) x.destinos[i] = d; else x.destinos.push(d);
    }
    NOTIF.gravar(c);
    aud(req, remover ? 'removeu destinatário do fechamento' : 'salvou destinatário do fechamento', req.loja.id, { loja: req.loja.id, para: ident });
    res.json({ ok: true, fechEmail: NOTIF.publicoLoja(req.loja.id) });
  });
  r.post('/lojas/:id/fechamento-email/enviar', lojaPermitida, json, async (req, res) => {
    try {
      const soPara = req.body && req.body.para ? String(req.body.para) : undefined;
      const r2 = await NOTIF.enviarFechamentoLoja(obterIndicadores, req.loja.id, { soPara });
      if (!r2.length) return res.status(400).json({ erro: soPara ? 'Destinatário não encontrado.' : 'Nenhum destinatário para esta loja (ou sem vendas para montar o fechamento).' });
      aud(req, soPara ? 'testou fechamento' : 'enviou fechamento do dia agora', req.loja.id, { loja: req.loja.id, envios: r2.length, falhas: r2.filter((y) => !y.ok).map((y) => `${y.para}: ${y.erro}`) });
      res.json({ ok: true, envios: r2 });
    } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
  });

  // fechamento do dia: enviar agora para todos os destinatários (com os dados de hoje); o franqueado envia só o das lojas dele
  r.post('/notif/fechamento/enviar', async (req, res) => {
    try {
      const soMinhas = req.perfil === 'admin' ? null : [...idsMeus(req)];
      const r2 = await NOTIF.enviarFechamento(obterIndicadores, soMinhas ? { lojas: soMinhas } : {});
      if (!r2.length) return res.status(400).json({ erro: 'Nenhum destinatário cadastrado (ou e-mail/Telegram não configurado).' });
      aud(req, 'enviou fechamento do dia agora', soMinhas && soMinhas.length === 1 ? soMinhas[0] : 'notificações', { ...(soMinhas && soMinhas.length === 1 ? { loja: soMinhas[0] } : {}), lojas: soMinhas || undefined, envios: r2.length, falhas: r2.filter((x) => !x.ok).map((x) => `${x.para}: ${x.erro}`) });
      res.json({ ok: true, envios: r2 });
    } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
  });
  r.get('/notif/previa', async (req, res) => {
    let ids = [String(req.query.loja || '*')];
    if (req.perfil !== 'admin') { // franqueado: prévia só das lojas dele ('*' = as dele)
      const meus = idsMeus(req);
      if (ids[0] === '*') ids = [...meus];
      else if (!meus.has(ids[0])) return res.status(404).json({ erro: 'Loja não encontrada.' });
      if (!ids.length) return res.json({ texto: 'Sem dados.' });
    }
    try { res.json({ texto: (await NOTIF.montarTexto(ids, obterIndicadores, NOTIF.ler().alertas)) || 'Sem dados.' }); } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
  });

  // ---------- horários do coletor ----------
  // horários da rede por dia da semana (só o administrador)
  r.put('/horarios', soAdmin, json, (req, res) => {
    try {
      const sem = AG.gravarPadrao(req.body.semana);
      if (!Object.values(sem).some((x) => x.length)) return res.status(400).json({ erro: 'Deixe pelo menos um dia com horário.' });
      aud(req, 'alterou horários da rede', 'coletor', { semana: sem });
      res.json({ ok: true, semana: sem });
    } catch (e) { res.status(400).json({ erro: C.msgErro(e) }); }
  });
  // horários próprios de uma loja (administrador ou franqueado da loja); { semana } ou { propria: false } para voltar aos da rede
  r.put('/lojas/:id/horarios', lojaPermitida, json, (req, res) => {
    if (req.perfil !== 'admin' && req.perfil !== 'franqueado') return res.status(403).json({ erro: 'Só o administrador ou o franqueado pode alterar.' });
    try {
      const sem = req.body.propria === false ? AG.gravarLoja(req.loja.id, null) : AG.gravarLoja(req.loja.id, req.body.semana);
      aud(req, sem ? 'alterou horários da loja' : 'voltou aos horários da rede', req.loja.id, { loja: req.loja.id, semana: sem || undefined });
      res.json({ ok: true, semana: sem });
    } catch (e) { res.status(400).json({ erro: C.msgErro(e) }); }
  });

  r.put('/janela', soAdmin, json, (req, res) => {
    const n = Math.round(+(req.body || {}).dias);
    if (!(n >= 1 && n <= 90)) return res.status(400).json({ erro: 'Informe de 1 a 90 dias.' });
    C.gravarAtomico(path.join(C.COLETOR_DIR, 'janela.txt'), n + '\n', 0o640);
    aud(req, 'alterou dias da atualização automática', 'coletor', { dias: n });
    res.json({ ok: true, dias: n });
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
    telasV: 8, // telas escolhidas uma a uma no menu novo (Produtos: Rentabilidade, Preços, Site; Estoque: Estoque, Pedido, Notas fiscais)
    ativo: b.ativo !== false,
    acessoAte: /^\d{4}-\d{2}-\d{2}$/.test(String(b.acessoAte || '')) ? String(b.acessoAte) : null,
  });
  /** acessoMeses: n ≥ 1 = acesso até hoje + n meses; 0 = sem prazo; ausente = mantém */
  function prazo(b, atual) {
    if (b.acessoMeses == null || b.acessoMeses === '') return { ok: atual || null };
    const n = Number(b.acessoMeses);
    if (!Number.isInteger(n) || n < 0 || n > 120) return { erro: 'Prazo de acesso inválido: informe de 1 a 120 meses (0 = sem prazo).' };
    return { ok: n === 0 ? null : C.somaMeses(C.hojeBR(), n) };
  }
  const lojaUnicaAud = (lojas) => (Array.isArray(lojas) && lojas.length === 1 && lojas[0] !== '*' ? lojas[0] : undefined);

  r.post('/usuarios', json, async (req, res) => {
    const nome = String(req.body.nome || '').trim().toLowerCase();
    if (!NOME_OK.test(nome)) return res.status(400).json({ erro: 'Usuário inválido: 2 a 30 caracteres, letras minúsculas, números, ponto, hífen ou _.' });
    const senha = String(req.body.senha || '');
    if (senha.length < 8) return res.status(400).json({ erro: 'A senha precisa de pelo menos 8 caracteres.' });
    if (senha.length > 200) return res.status(400).json({ erro: 'A senha deve ter no máximo 200 caracteres.' });
    const d = limparDados(req.body);
    const erro = validarUsuario(req, d, null);
    if (erro) return res.status(400).json({ erro });
    const pz = prazo(req.body, null);
    if (pz.erro) return res.status(400).json({ erro: pz.erro });
    d.acessoAte = pz.ok;
    const hash = await C.hashSenhaAsync(senha);
    try {
      C.alterar((cfg) => {
        if (cfg.usuarios[nome]) throw new Error(`O usuário "${nome}" já existe.`);
        cfg.usuarios[nome] = { senha: hash, ...d, trocarSenha: req.body.trocarSenha !== false, criadoEm: new Date().toISOString() };
      });
    } catch (e) { return res.status(400).json({ erro: C.msgErro(e) }); }
    aud(req, 'criou usuário', nome, { perfil: d.perfil, lojas: d.lojas, acessoAte: d.acessoAte || 'sem prazo', trocarSenha: req.body.trocarSenha !== false, loja: lojaUnicaAud(d.lojas) });
    res.json({ ok: true });
  });

  r.put('/usuarios/:nome', json, async (req, res) => {
    const nome = String(req.params.nome).toLowerCase();
    const alvo = C.get().usuarios[nome];
    if (!alvo || nome === '*') return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (!usuariosVisiveis(req).some((u) => u.nome === nome)) return res.status(403).json({ erro: 'Sem permissão para alterar este usuário.' });
    const d = limparDados({ ...alvo, ...req.body });
    if (req.body.acessoMeses != null && req.body.acessoMeses !== '') {
      const pz = prazo(req.body, alvo.acessoAte);
      if (pz.erro) return res.status(400).json({ erro: pz.erro });
      d.acessoAte = pz.ok;
    } else if (req.body.acessoAte === undefined) {
      d.acessoAte = alvo.acessoAte || null;
    }
    if (nome === req.user && (d.perfil !== alvo.perfil || !d.ativo)) return res.status(400).json({ erro: 'Você não pode mudar o próprio perfil nem se desativar.' });
    if (nome === req.user && (d.acessoAte || null) !== (alvo.acessoAte || null)) return res.status(400).json({ erro: 'Você não pode alterar o prazo do próprio acesso.' });
    const erro = validarUsuario(req, d, alvo);
    if (erro) return res.status(400).json({ erro });
    const senha = req.body.senha ? String(req.body.senha) : null;
    if (senha && senha.length < 8) return res.status(400).json({ erro: 'A senha precisa de pelo menos 8 caracteres.' });
    if (senha && senha.length > 200) return res.status(400).json({ erro: 'A senha deve ter no máximo 200 caracteres.' });
    const hash = senha ? await C.hashSenhaAsync(senha) : null;
    C.alterar((cfg) => {
      const u = cfg.usuarios[nome];
      if (!u) return;
      Object.assign(u, d);
      if (hash) { u.senha = hash; u.sessao = (u.sessao || 0) + 1; }
      if (typeof req.body.trocarSenha === 'boolean' && nome !== req.user) u.trocarSenha = req.body.trocarSenha;
    });
    aud(req, 'alterou usuário', nome, { perfil: d.perfil, lojas: d.lojas, telas: d.telas, ativo: d.ativo, acessoAte: d.acessoAte !== (alvo.acessoAte || null) ? d.acessoAte || 'sem prazo' : undefined, senha: senha ? 'redefinida' : undefined, trocarSenha: typeof req.body.trocarSenha === 'boolean' && req.body.trocarSenha !== !!alvo.trocarSenha ? req.body.trocarSenha : undefined, loja: lojaUnicaAud(d.lojas) });
    pacoteLimpar();
    res.json({ ok: true });
  });

  // derruba todos os logins abertos da pessoa (ex.: celular perdido, saiu da empresa)
  r.post('/usuarios/:nome/encerrar-sessoes', (req, res) => {
    const nome = String(req.params.nome).toLowerCase();
    if (!C.get().usuarios[nome]) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (!usuariosVisiveis(req).some((u) => u.nome === nome)) return res.status(403).json({ erro: 'Sem permissão.' });
    C.alterar((cfg) => { const u = cfg.usuarios[nome]; u.sessao = (u.sessao || 0) + 1; });
    aud(req, 'encerrou as sessões', nome, { loja: lojaUnicaAud(C.get().usuarios[nome].lojas) });
    res.json({ ok: true });
  });

  r.delete('/usuarios/:nome', (req, res) => {
    const nome = String(req.params.nome).toLowerCase();
    if (nome === req.user) return res.status(400).json({ erro: 'Você não pode excluir o próprio usuário.' });
    if (!usuariosVisiveis(req).some((u) => u.nome === nome)) return res.status(403).json({ erro: 'Sem permissão.' });
    const alvo = C.get().usuarios[nome];
    C.alterar((cfg) => { delete cfg.usuarios[nome]; });
    aud(req, 'excluiu usuário', nome, { loja: lojaUnicaAud(alvo?.lojas) });
    res.json({ ok: true });
  });

  // ---------- atualização do sistema (o atualizador roda na VPS, fora do container) ----------
  const SIS = path.join(C.DATA_DIR, '_sistema');
  const lerTxt = (f) => { try { return fs.readFileSync(path.join(SIS, f), 'utf8'); } catch { return null; } };
  function sistema() {
    const v = lerTxt('versao.txt');
    const st = lerTxt('status.txt');
    const testes = {};
    const out = { testes: false, alvo: null, instalado: false, verificado: null, atual: null, novidades: [], recentes: [], status: null, pedido: fs.existsSync(path.join(SIS, 'atualizar.pedido')) };
    if (v) {
      out.instalado = true;
      for (const linha of v.split('\n')) {
        const c = linha.split('\t');
        if (c[0] === 'verificado') out.verificado = c[1] || null;
        else if (c[0] === 'atual') out.atual = { sha: c[1], data: c[2], msg: (c.slice(3).join('\t') || '').slice(0, 300) };
        else if (c[0] === 'novo' && out.novidades.length < 60) out.novidades.push({ sha: c[1], data: c[2], msg: (c.slice(3).join('\t') || '').slice(0, 300) });
        else if (c[0] === 'recente' && out.recentes.length < 12) out.recentes.push({ sha: c[1], data: c[2], msg: (c.slice(3).join('\t') || '').slice(0, 300) });
        else if (c[0] === 'testes') out.testes = true;
        else if (c[0] === 'teste') testes[c[1]] = { res: c[2], url: /^https:\/\/github\.com\//.test(c[3] || '') ? c[3] : null };
        else if (c[0] === 'alvo') out.alvo = c[1];
      }
      // resultado dos testes automáticos de cada novidade: ok | falhou | testando (ainda sem resultado)
      if (out.testes) for (const n of out.novidades) {
        const t = testes[n.sha];
        n.teste = !t ? 'testando' : t.res === 'success' ? 'ok' : t.res === 'cancelled' ? 'pulado' : 'falhou';
        n.testeUrl = t && t.url;
      }
      // versões mais antigas que a última testada sem resultado próprio (puladas ou de antes dos testes): valem pela mais nova
      if (out.testes && out.alvo) { const i = out.novidades.findIndex((n) => n.sha === out.alvo); out.novidades.forEach((n, k) => { if (i >= 0 && k > i && n.teste === 'testando') n.teste = 'pulado'; }); }
      // sem verificação há mais de 20 min: o cron do atualizador parou
      out.parado = !out.verificado || Date.now() - Date.parse(out.verificado) > 20 * 60e3;
    }
    if (st) { const c = st.trim().split('\t'); out.status = { estado: c[0], em: c[1], msg: (c[2] || '').slice(0, 300) }; }
    return out;
  }
  r.get('/sistema', soAdmin, (req, res) => res.json(sistema()));
  // backup no Google Drive (scripts/backup.sh na VPS): situação e "fazer agora"
  function backup() {
    const st = (lerTxt('backup.txt') || '').trim().split('\t'), ok = (lerTxt('backup.ok') || '').trim().split('\t');
    let log = [];
    try { log = fs.readFileSync(path.join(SIS, 'backup.log'), 'utf8').split('\n').filter(Boolean).slice(-30); } catch { /* ok */ }
    const n = (x) => (x && /^\d+$/.test(x) ? +x : null);
    return {
      instalado: !!lerTxt('versao.txt'), estado: st[0] || null, em: st[1] || null, msg: st[4] || null,
      ultimoOk: ok[0] ? { em: ok[0], bytes: n(ok[1]), arquivos: n(ok[2]) } : null,
      pedido: fs.existsSync(path.join(SIS, 'backup.pedido')), log,
    };
  }
  r.get('/backup', soAdmin, (req, res) => res.json(backup()));
  r.post('/backup', soAdmin, (req, res) => {
    const b = backup();
    if (!b.instalado) return res.status(400).json({ erro: 'O atualizador ainda não foi instalado na VPS.' });
    if (b.estado === 'nao_configurado' || !b.estado) return res.status(400).json({ erro: 'O backup ainda não foi configurado na VPS (scripts/backup-configurar.sh).' });
    if (b.estado === 'rodando' || b.pedido) return res.status(409).json({ erro: 'Já tem um backup em andamento.' });
    try { fs.writeFileSync(path.join(SIS, 'backup.pedido'), `${req.user} ${new Date().toISOString()}\n`); } catch (e) { return res.status(500).json({ erro: 'Não consegui pedir: ' + C.msgErro(e) }); }
    aud(req, 'pediu backup no Google Drive', 'sistema', {});
    res.json({ ok: true });
  });
  r.post('/sistema/:acao', soAdmin, (req, res) => {
    const acao = req.params.acao;
    if (!['atualizar', 'verificar'].includes(acao)) return res.status(404).json({ erro: 'Ação inválida.' });
    const s = sistema();
    if (!s.instalado) return res.status(400).json({ erro: 'O atualizador ainda não foi instalado na VPS.' });
    if (acao === 'atualizar' && s.status && s.status.estado === 'atualizando') return res.status(409).json({ erro: 'Já tem uma atualização em andamento.' });
    const forcar = acao === 'atualizar' && req.query.forcar === '1';
    if (acao === 'atualizar' && s.testes && !s.alvo && !forcar) return res.status(409).json({ erro: 'Nenhuma novidade passou nos testes automáticos ainda.' });
    try { fs.writeFileSync(path.join(SIS, `${acao}.pedido`), `${req.user} ${new Date().toISOString()}${forcar ? ' forcar' : ''}\n`); } catch (e) { return res.status(500).json({ erro: 'Não consegui gravar o pedido: ' + C.msgErro(e) }); }
    if (acao === 'atualizar') aud(req, forcar ? 'pediu atualização do painel SEM esperar os testes' : 'pediu atualização do painel', 'sistema', { de: s.atual && s.atual.sha, para: forcar ? 'tudo' : s.alvo, novidades: s.novidades.length });
    res.json({ ok: true });
  });

  app.use('/api/admin', r);
}

module.exports = { registrar, validarRegras };
