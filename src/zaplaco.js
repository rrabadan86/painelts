'use strict';
/**
 * Laço do robô do WhatsApp: a cada ~30 s, por loja com o robô ligado e o WhatsApp conectado, manda UMA mensagem
 * (se a fila em src/zapfila.js disser que é hora), grava o resultado na campanha como o envio manual (por: 'robô'),
 * sorteia o próximo horário dentro do ritmo, conta as falhas seguidas e pausa sozinho no limite.
 * Também lê quem respondeu "parar" e tira a pessoa de todas as campanhas.
 * Nunca vai para o log: o texto das mensagens e o número completo (só os 4 últimos dígitos).
 */
const C = require('./config');
const CAMP = require('./campanhas');
const ZF = require('./zapfila');
const M = require('../public/js/msgwpp');

const POR = 'robô';
const mascara = (cpf) => String(cpf).slice(0, 3) + '…' + String(cpf).slice(-2);
/** "não quer mensagens" vindo de uma resposta no WhatsApp: fica a origem, para a loja poder desfazer na ficha do cliente
 *  (uma frase curta como "vou sair agora" pode ser entendida errado) */
const naoQuer = (lojaId, cpf, agora) => ZF.mudarContato(lojaId, cpf, (c) => { if (!c.optout) Object.assign(c, { optout: true, optoutEm: new Date(agora).toISOString(), optoutPor: POR, optoutOrigem: ZF.ORIGEM_RESPOSTA }); });

/** respostas "parar", "sair"…: o número entra em "não quer mensagens" e o cliente dono dele também */
async function lerOptouts(lojaId, agora, zap) {
  const e = ZF.lerEstado(lojaId);
  const desde = e.optoutsDesde || new Date(agora - 864e5).toISOString();
  const r = await zap.optouts(lojaId, desde);
  const itens = (r && Array.isArray(r.itens) ? r.itens : []).filter((x) => x && ZF.NUMERO.test(String(x.de || '')));
  if (itens.length) {
    const naoquer = ZF.lerJson(lojaId, 'naoquer');
    const novos = itens.filter((x) => !naoquer[x.de]);
    if (novos.length) {
      // de quem é o número: pelo que o robô já enviou e pelas listas conferidas
      const enviados = ZF.lerJson(lojaId, 'enviados'), preparo = ZF.lerPreparo(lojaId);
      for (const x of novos) {
        const cpfs = new Set();
        if (enviados[x.de] && enviados[x.de].cpf) cpfs.add(enviados[x.de].cpf);
        for (const p of Object.values(preparo)) for (const [cpf, it] of Object.entries((p && p.itens) || {})) if (it.para === x.de) cpfs.add(cpf);
        naoquer[x.de] = { em: String(x.em || new Date(agora).toISOString()).slice(0, 30), cpfs: [...cpfs] };
        for (const cpf of cpfs) {
          naoQuer(lojaId, cpf, agora);
          C.auditar(POR, 'cliente não quer contato', lojaId, { loja: lojaId, cpf: mascara(cpf), origem: ZF.ORIGEM_RESPOSTA });
        }
        if (!cpfs.size) C.auditar(POR, 'número pediu para não receber mensagens', lojaId, { loja: lojaId, fim: ZF.fim4(x.de) });
      }
      ZF.gravarJson(lojaId, 'naoquer', naoquer);
    }
  }
  ZF.mudarEstado(lojaId, (s) => { s.optoutsDesde = new Date(agora - 60e3).toISOString(); }); // um minuto de folga: repetido não faz mal
}

/** notificação no aparelho de quem cuida do robô (sem texto de mensagem nem número de cliente) */
function avisarAparelhos(lojaId, chave, texto) {
  try {
    const l = C.get().lojas.find((x) => x.id === lojaId);
    require('./push').avisarDepois({ tipo: 'zap', loja: lojaId, chave: `zap:${lojaId}:${chave}`, titulo: `Robô do WhatsApp · ${l ? l.nome : lojaId}`, texto, link: '/#campanhas' });
  } catch (e) { console.error('[zap] aviso no aparelho:', C.msgErro(e)); }
}
/** a conexão caiu com o robô ligado: marca para a tela e o Início avisarem (uma vez na auditoria) */
function marcarQueda(lojaId, estadoZap, agora) {
  const antes = ZF.lerEstado(lojaId).conexao;
  if (antes && antes.estado === estadoZap) return;
  ZF.mudarEstado(lojaId, (s) => { s.conexao = { estado: estadoZap, desde: new Date(agora).toISOString() }; });
  if (!antes) C.auditar(POR, 'robô do WhatsApp: a conexão caiu', lojaId, { loja: lojaId, situacao: estadoZap });
  if (!antes) avisarAparelhos(lojaId, `queda:${new Date(agora).toISOString()}`, 'A conexão com o WhatsApp da loja caiu. As campanhas do robô estão paradas até conectar de novo.');
}

/**
 * Um passo do laço para uma loja. → { enviou?, motivo?, pausou? } (para os testes e o log)
 * `zap` = cliente do serviço (src/zap.js; de mentira nos testes) · `rnd` = gerador do sorteio do ritmo
 */
async function passo(lojaId, agora = Date.now(), { zap = require('./zap'), rnd = Math.random } = {}) {
  if (!zap.ativo()) return { motivo: 'sem_servico' };
  const loja = C.get().lojas.find((l) => l.id === lojaId);
  if (!loja || !ZF.temEstado(lojaId)) return { motivo: 'desligado' };
  const e0 = ZF.lerEstado(lojaId);
  if (!e0.ligado && !e0.sessao) return { motivo: 'desligado' };
  let st;
  try { st = await zap.status(lojaId); } catch { if (e0.ligado && !e0.pausa) marcarQueda(lojaId, 'indisponivel', agora); return { motivo: 'desconectado' }; }
  if (!st || st.estado !== 'conectado') {
    // "iniciando" é passageiro (o serviço acabou de subir): só avisa quando caiu de fato ou pede QR/código de novo
    if (e0.ligado && !e0.pausa && st && st.estado !== 'iniciando') marcarQueda(lojaId, st.estado || 'caiu', agora);
    return { motivo: 'desconectado' };
  }
  if (e0.conexao) ZF.mudarEstado(lojaId, (s) => { s.conexao = null; });
  try { await lerOptouts(lojaId, agora, zap); } catch (err) { console.error(`[zap] ${lojaId}: não li as respostas de saída:`, err.message); }

  // a partir daqui nada assíncrono até o envio: decide com o estado de agora (um "Pausar" de segundos atrás vale)
  const d = ZF.proxima(lojaId, agora);
  for (const m of d.marcar) {
    CAMP.marcar(lojaId, m.campanha, m.rodada, m.cpf, m.st, POR, m.motivo);
    if (m.optout) { naoQuer(lojaId, m.cpf, agora); ZF.ligarNumeroAoCliente(lojaId, m.para, m.cpf); }
  }
  if (!d.msg) return { motivo: d.motivo };
  const cfg = ZF.cfgDe(loja), msg = d.msg;
  const dia = ZF.relogio(agora).dia;
  let r;
  try { r = await zap.enviar(lojaId, msg); } catch (err) { r = { ok: false, motivo: 'falha', erro: err.message }; }
  const proximoEm = new Date(ZF.sortear(cfg, agora, rnd)).toISOString();
  if (r && r.ok) {
    CAMP.marcar(lojaId, msg.campanha, msg.rodada, msg.cliente.cpf, 'e', POR, null, msg.v);
    try { require('./conversas').marcarRobo(lojaId, r.idMsg, msg.nome, agora); } catch { /* só a marca 🤖 na conversa */ }
    const quando = new Date(agora).toISOString();
    ZF.mudarContato(lojaId, msg.cliente.cpf, (c) => Object.assign(c, { em: quando, por: POR, motivo: M.motivoCampanha(msg.nome) }));
    const env = ZF.lerJson(lojaId, 'enviados');
    for (const k of Object.keys(env)) if (agora - Date.parse(env[k].em) > 120 * 864e5) delete env[k];
    env[msg.para] = { em: quando, cpf: msg.cliente.cpf };
    ZF.gravarJson(lojaId, 'enviados', env);
    ZF.mudarEstado(lojaId, (s) => { s.enviadosDia = (s.dia === dia ? s.enviadosDia || 0 : 0) + 1; s.dia = dia; s.falhas = 0; s.proximoEm = proximoEm; s.ultimo = { em: quando, ok: true }; });
    console.log(`[zap] ${lojaId}: mensagem enviada para ···${ZF.fim4(msg.para)} (campanha ${msg.campanha})`);
    return { enviou: true, msg };
  }
  const motivo = (r && r.motivo) || 'falha';
  if (motivo === 'sem_whatsapp') {
    // número sem WhatsApp: sai da fila com o motivo e o robô segue (não conta como falha nem no teto)
    CAMP.marcar(lojaId, msg.campanha, msg.rodada, msg.cliente.cpf, 'x', POR, 'sem WhatsApp');
    ZF.mudarEstado(lojaId, (s) => { s.proximoEm = proximoEm; });
    return { motivo: 'sem_whatsapp', msg };
  }
  if (motivo === 'desconectado') { marcarQueda(lojaId, 'caiu', agora); return { motivo: 'desconectado' }; }
  let pausou = false, falhas = 0;
  ZF.mudarEstado(lojaId, (s) => {
    s.falhas = falhas = (s.falhas || 0) + 1; s.proximoEm = proximoEm; s.ultimo = { em: new Date(agora).toISOString(), ok: false };
    if (s.falhas >= cfg.falhas && !s.pausa) { pausou = true; s.pausa = { auto: true, em: new Date(agora).toISOString(), por: POR, motivo: `${s.falhas} ${s.falhas === 1 ? 'falha' : 'falhas seguidas'} ao enviar` }; }
  });
  console.error(`[zap] ${lojaId}: falha ao enviar para ···${ZF.fim4(msg.para)} (${falhas} seguidas)`);
  if (pausou) C.auditar(POR, 'robô do WhatsApp pausou sozinho', lojaId, { loja: lojaId, falhas });
  if (pausou) avisarAparelhos(lojaId, `pausa:${new Date(agora).toISOString()}`, `O robô pausou sozinho depois de ${falhas} ${falhas === 1 ? 'falha' : 'falhas seguidas'} ao enviar. Nada mais é enviado até alguém religar.`);
  return { motivo: 'falha', pausou, msg };
}

// ---------- o laço ----------
let rodando = false;
async function rodada(opcoes) {
  if (rodando) return; // trava contra sobreposição: um envio demora (o serviço simula "digitando")
  rodando = true;
  try {
    for (const l of C.get().lojas) { try { await passo(l.id, Date.now(), opcoes); } catch (e) { console.error(`[zap] ${l.id}:`, C.msgErro(e)); } }
  } finally { rodando = false; }
}
function iniciar() {
  if (!require('./zap').ativo()) return null; // sem ZAP_URL/ZAP_TOKEN nada roda (a tela explica)
  const t = setInterval(() => { rodada(); }, 30e3);
  t.unref();
  return t;
}

module.exports = { passo, rodada, iniciar };
