'use strict';
/**
 * Rotas do robô do WhatsApp das campanhas (/api/zap/*) e a versão da apresentação (/api/demo/zap/*).
 * Quem pode (conferido aqui, no servidor):
 *   admin, e franqueado da loja e gerente com a tela Clientes LIBERADOS pelo admin ("Robô do WhatsApp" em Usuários) → tudo
 *     (conectar, desconectar, ligar, pausar, configurar); sem a liberação, só veem a situação e pausam
 *     — decisão do dono: é a gerente quem está na loja com o celular para ler o QR;
 *   vendedora e gerente sem Clientes → nada (barrados antes, por podeClientes).
 * A loja vem sempre de req.lojas (franqueado nunca alcança a loja dos outros). Tudo o que muda vai para a auditoria.
 */
const express = require('express');
const C = require('./config');
const CAMP = require('./campanhas');
const ZAP = require('./zap');
const ZF = require('./zapfila');

// ZAP-PERM-01 (decisão do dono, 23/11/2026): conectar, ligar e configurar o robô só com a liberação do admin
// (Configurações → Usuários → "Robô do WhatsApp"); o gerente, além disso, só chega aqui com a tela Clientes (podeClientes)
const gestor = (req) => ['admin', 'franqueado', 'gerente'].includes(req.perfil) && C.podeRobo(req);
const lojaDe = (req) => { const id = String((req.body && req.body.loja) || req.query.loja || ''); return (req.lojas || []).some((l) => l.id === id) ? id : null; };
const motivoTxt = (cod) => ({ cod, texto: ZF.MOTIVOS[cod] || '' });

/** o que a tela mostra: conexão, ligado/pausado, "hoje N de T", próxima mensagem e o motivo quando está parado */
async function situacao(lojaId, ehGestor) {
  const loja = C.get().lojas.find((l) => l.id === lojaId);
  const cfg = ZF.cfgDe(loja), e = ZF.lerEstado(lojaId), agora = Date.now();
  const servico = ZAP.ativo();
  let conexao = { estado: 'sem_servico' };
  if (servico) {
    try {
      const s = await ZAP.status(lojaId);
      conexao = { estado: String(s.estado || 'desligado'), numeroFim: s.numeroFim ? String(s.numeroFim).slice(-4) : null, desde: s.desde || null, erro: s.erro ? String(s.erro).slice(0, 200) : null };
      // QR e código de pareamento dão acesso ao WhatsApp da loja: só para quem conecta
      if (ehGestor) { conexao.qr = typeof s.qr === 'string' && s.qr.startsWith('data:image/') ? s.qr : null; conexao.codigo = s.codigo ? String(s.codigo).slice(0, 12) : null; }
    } catch (err) { conexao = { estado: 'indisponivel', erro: err.message }; }
  }
  const robos = ZF.campanhasDoRobo(CAMP.ler(lojaId));
  const pendentes = robos.reduce((n, c) => n + c.rodadas[0].lista.filter((x) => x.st === 'p').length, 0);
  // rodízio entre campanhas (ZAP-RODIZIO): de quem é a vez agora, para a faixa do robô
  const vez = ZF.vezDoRodizio(robos, cfg.bloco);
  const daVez = robos.find((c) => c.id === vez.vez);
  const rodizio = { bloco: cfg.bloco, campanhas: robos.length, vez: daVez ? String(daVez.nome || '').slice(0, 80) : null, seguidas: vez.seguidas };
  let cod = null;
  if (!servico) cod = 'sem_servico';
  else if (e.ligado && !e.pausa && conexao.estado !== 'conectado') cod = 'desconectado';
  else { const d = ZF.proxima(lojaId, agora); cod = d.msg ? null : d.motivo; }
  return {
    servico, pode: { configurar: ehGestor, pausar: true }, ligado: !!e.ligado, pausa: e.pausa || null, conexao, cfg,
    hoje: { n: ZF.enviadosHoje(e, agora), teto: cfg.teto }, proximoEm: e.proximoEm && Date.parse(e.proximoEm) > agora ? e.proximoEm : null,
    motivo: cod ? motivoTxt(cod) : null, falhas: e.falhas || 0, fila: { campanhas: robos.length, pendentes, emConversa: ZF.adiadosDaLoja(lojaId, agora).length }, validadeLista: ZF.PREPARO_DIAS, rodizio,
    // horário de envio dia a dia (igual ao funcionamento da loja, ou o próprio): a tela mostra e estima por ele
    agenda: ZF.agenda(loja, cfg, agora), horarioLoja: horarioDaLoja(loja),
  };
}
/** o horário de funcionamento da loja por dia (só abre/fecha, para a tela mostrar) — null quando não está cadastrado */
function horarioDaLoja(loja) {
  if (!ZF.temFuncionamento(loja)) return null;
  const f = loja.operacao.funcionamento;
  // o horário de ENVIO de cada dia (abertura até 30 min antes de fechar), pela mesma função do robô
  const SEM = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
  return Object.fromEntries(Object.keys(SEM).map((d) => {
    const j = f[d].fechado ? null : ZF.janelaDoDia({ operacao: loja.operacao }, { horario: 'loja' }, '', SEM[d]);
    return [d, f[d].fechado ? null : { abre: f[d].abre, fecha: f[d].fecha, envia: j ? { das: j.das, as: j.as } : null }];
  }));
}

function registrar(app, { podeClientes }) {
  const json = express.json({ limit: '4kb' });
  app.use('/api/zap', (req, res, next) => {
    if (!podeClientes(req)) return res.status(403).json({ erro: 'Sem permissão.' });
    if (req.method !== 'GET' && req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
    next();
  });
  const soGestor = (req, res, next) => (gestor(req) ? next() : res.status(403).json({ erro: 'Sem permissão para mexer no robô do WhatsApp: peça ao administrador para liberar "Robô do WhatsApp" no seu usuário.' }));
  const comLoja = (req, res, next) => { const id = lojaDe(req); if (!id) return res.status(400).json({ erro: 'Escolha uma loja.' }); req.zapLoja = id; next(); };
  const responder = async (req, res) => { try { res.json({ ok: true, ...(await situacao(req.zapLoja, gestor(req))) }); } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); } };
  const semServico = (res) => res.status(400).json({ erro: ZF.MOTIVOS.sem_servico });

  app.get('/api/zap/situacao', comLoja, (req, res) => {
    // resumo para o aviso do Início: só o que está guardado, sem chamar o serviço
    if (req.query.leve === '1') { const e = ZF.lerEstado(req.zapLoja); return res.json({ servico: ZAP.ativo(), ligado: !!e.ligado, pausa: e.pausa || null, caiu: !!(e.ligado && e.conexao) }); }
    responder(req, res);
  });

  app.post('/api/zap/conectar', json, soGestor, comLoja, async (req, res) => {
    if (!ZAP.ativo()) return semServico(res);
    let numero = String((req.body || {}).numero || '').replace(/\D/g, '');
    if (numero && !numero.startsWith('55')) numero = '55' + numero;
    if (numero && !ZF.NUMERO.test(numero)) return res.status(400).json({ erro: 'Número inválido: use DDD + número (ex.: 62 99999-8888).' });
    try { await ZAP.conectar(req.zapLoja, numero || undefined); } catch (e) { return res.status(502).json({ erro: `Não consegui falar com o robô do WhatsApp: ${e.message}.` }); }
    ZF.mudarEstado(req.zapLoja, (s) => { s.sessao = true; });
    C.auditar(req.user, 'robô do WhatsApp: pediu para conectar', req.zapLoja, { loja: req.zapLoja, modo: numero ? 'código' : 'QR', ...(numero ? { fim: ZF.fim4(numero) } : {}) });
    responder(req, res);
  });
  app.post('/api/zap/desconectar', json, soGestor, comLoja, async (req, res) => {
    if (!ZAP.ativo()) return semServico(res);
    try { await ZAP.desconectar(req.zapLoja); } catch (e) { return res.status(502).json({ erro: `Não consegui falar com o robô do WhatsApp: ${e.message}.` }); }
    ZF.mudarEstado(req.zapLoja, (s) => { s.sessao = false; s.ligado = false; s.conexao = null; });
    require('./conversas').apagar(req.zapLoja); // as conversas guardadas saem junto (decisão do dono)
    C.auditar(req.user, 'robô do WhatsApp: desconectou o número', req.zapLoja, { loja: req.zapLoja });
    responder(req, res);
  });
  app.post('/api/zap/ligar', json, soGestor, comLoja, async (req, res) => {
    if (!ZAP.ativo()) return semServico(res);
    let st = null;
    try { st = await ZAP.status(req.zapLoja); } catch { /* cai na mensagem abaixo */ }
    if (!st || st.estado !== 'conectado') return res.status(400).json({ erro: 'Conecte o WhatsApp da loja antes de ligar o robô.' });
    // o próximo horário sorteado continua valendo: pausar e ligar de novo não fura o ritmo
    ZF.mudarEstado(req.zapLoja, (s) => { s.ligado = true; s.pausa = null; s.falhas = 0; s.semWppSeguidos = 0; s.conexao = null; s.sessao = true; });
    C.auditar(req.user, 'robô do WhatsApp: ligou', req.zapLoja, { loja: req.zapLoja });
    responder(req, res);
  });
  // pausar é a ação de segurança: quem vê a situação pode (admin, franqueado e gerente com a tela Clientes)
  app.post('/api/zap/pausar', json, comLoja, (req, res) => {
    ZF.mudarEstado(req.zapLoja, (s) => { s.pausa = { auto: false, em: new Date().toISOString(), por: req.user }; });
    C.auditar(req.user, 'robô do WhatsApp: pausou', req.zapLoja, { loja: req.zapLoja });
    responder(req, res);
  });
  app.put('/api/zap/config', json, soGestor, comLoja, (req, res) => {
    const v = ZF.validarCfg(req.body || {});
    if (v.erro) return res.status(400).json({ erro: v.erro });
    C.alterar((cfg) => { const l = cfg.lojas.find((x) => x.id === req.zapLoja); if (l) l.zap = v.ok; });
    C.auditar(req.user, 'robô do WhatsApp: mudou a configuração', req.zapLoja, { loja: req.zapLoja, ...v.ok });
    responder(req, res);
  });
  // valores dos campos da mensagem e número de cada cliente pendente (calculados no navegador, como no envio manual)
  app.put('/api/zap/preparo', express.json({ limit: '3mb' }), comLoja, (req, res) => {
    const b = req.body || {};
    const r = ZF.gravarPreparo(req.zapLoja, String(b.campanha || ''), b.itens, req.user);
    if (r.erro) return res.status(400).json({ erro: r.erro });
    res.json({ ok: true, ...r.ok });
  });
}

// ---------- apresentação: tudo simulado, nada é conectado nem enviado ----------
const QR_DEMO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect width="220" height="220" fill="#fff" stroke="#888"/><text x="110" y="104" font-size="15" text-anchor="middle" font-family="sans-serif" fill="#444">QR de exemplo</text><text x="110" y="128" font-size="12" text-anchor="middle" font-family="sans-serif" fill="#888">(apresentação)</text></svg>');
function situacaoDemo(o = {}) {
  const agora = Date.now();
  const lojaDemo = { operacao: require('./demo').OPERACAO['demo-centro'], feriadosHorario: {} }; // a loja fictícia: seg a sex 09–19, sáb 09–17, dom fechado
  const cfgD = o.cfg || { ...ZF.PADRAO };
  const base = {
    ok: true, demo: true, servico: true, pode: { configurar: true, pausar: true }, ligado: true, pausa: null,
    conexao: { estado: 'conectado', numeroFim: '8888', desde: new Date(agora - 5 * 864e5).toISOString(), erro: null, qr: null, codigo: null },
    cfg: cfgD, hoje: { n: 12, teto: ZF.PADRAO.teto }, proximoEm: new Date(agora + 9 * 60e3).toISOString(),
    motivo: motivoTxt('ritmo'), falhas: 0, fila: { campanhas: 2, pendentes: 18, emConversa: 2 }, validadeLista: ZF.PREPARO_DIAS,
    rodizio: { bloco: cfgD.bloco || ZF.PADRAO.bloco, campanhas: 2, vez: 'Exemplo: Sentimos sua falta', seguidas: 2 },
    agenda: ZF.agenda(lojaDemo, cfgD, agora), horarioLoja: horarioDaLoja(lojaDemo),
  };
  return { ...base, ...o };
}
function demo(app) {
  const json = express.json({ limit: '4kb' });
  app.get('/api/demo/zap/situacao', (req, res) => res.json(req.query.leve === '1' ? { servico: true, ligado: true, pausa: null, caiu: false } : situacaoDemo()));
  app.post('/api/demo/zap/pausar', (req, res) => res.json(situacaoDemo({ pausa: { auto: false, em: new Date().toISOString(), por: 'você' }, proximoEm: null, motivo: motivoTxt('pausado') })));
  app.post('/api/demo/zap/ligar', (req, res) => res.json(situacaoDemo()));
  app.post('/api/demo/zap/conectar', json, (req, res) => {
    const comNumero = !!String((req.body || {}).numero || '').replace(/\D/g, '');
    res.json(situacaoDemo({ ligado: false, proximoEm: null, motivo: motivoTxt('desligado'), conexao: { estado: comNumero ? 'codigo' : 'qr', numeroFim: null, desde: null, erro: null, qr: comNumero ? null : QR_DEMO, codigo: comNumero ? 'DEMO1234' : null } }));
  });
  app.post('/api/demo/zap/desconectar', (req, res) => res.json(situacaoDemo({ ligado: false, proximoEm: null, motivo: motivoTxt('desligado'), conexao: { estado: 'desligado', numeroFim: null, desde: null, erro: null, qr: null, codigo: null } })));
  app.put('/api/demo/zap/config', json, (req, res) => {
    const v = ZF.validarCfg(req.body || {});
    if (v.erro) return res.status(400).json({ erro: v.erro });
    res.json(situacaoDemo({ cfg: v.ok, hoje: { n: 12, teto: v.ok.teto } }));
  });
  app.put('/api/demo/zap/preparo', (req, res) => res.json({ ok: true, clientes: 0 }));
}

module.exports = { registrar, demo, situacao };
