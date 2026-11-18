'use strict';
/**
 * Avisos de falha para o administrador (e-mail).
 *  - coleta (vendas, XML, estoque, pedido ao FIXE) que falhou duas vezes seguidas;
 *  - importação do e-mail do FIXE que falhou duas vezes seguidas;
 *  - loja que chegou às 10h sem as vendas de ontem (quando ela costuma vender nesse dia da semana).
 * Um aviso por problema; quando volta a dar certo, o painel manda "voltou ao normal".
 * Estado em dados/_sistema/avisos.json. O e-mail de destino fica em notificacoes.json (avisos.email).
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const ARQ = () => path.join(C.pastaLoja('_sistema'), 'avisos.json');
const ler = () => { try { return JSON.parse(fs.readFileSync(ARQ(), 'utf8')); } catch { return { partes: {}, semVenda: {} }; } };
const gravar = (s) => { fs.mkdirSync(path.dirname(ARQ()), { recursive: true }); C.gravarAtomico(ARQ(), JSON.stringify(s, null, 1), 0o640); };

const NOME_PARTE = { vendas: 'vendas', xml: 'XML das notas', estoque: 'estoque e custos', fixe: 'pedido ao FIXE', fixeEmail: 'importação do e-mail do FIXE' };

/** SMTP para mandar o aviso do sistema: apenas o servidor geral do painel (não usa Gmail particular de franqueado) */
function smtpAviso(NOTIF) {
  const nc = NOTIF.ler();
  if (nc.email && nc.email.host && nc.email.from) return nc.email;
  return null;
}

/**
 * Registra um resultado (ok / falhou) de uma parte de uma loja; devolve 'falhou' na 2ª falha seguida,
 * 'voltou' quando dá certo depois de um aviso, ou null.
 */
function registrar(st, chave, marca, ok, erro) {
  const p = st.partes[chave] || (st.partes[chave] = { falhas: 0, avisado: false, marca: null });
  if (p.marca === marca) return null; // já contado
  p.marca = marca;
  if (ok) {
    const voltou = p.avisado;
    p.falhas = 0; p.avisado = false; p.erro = null;
    return voltou ? 'voltou' : null;
  }
  p.falhas++; p.erro = erro || null;
  if (p.falhas >= 2 && !p.avisado) { p.avisado = true; return 'falhou'; }
  return null;
}

/**
 * Roda de tempos em tempos (servidor). deps: { COL, FX, B, NOTIF, base: (lojaId) => vendas }
 */
let verificando = false;
async function verificar({ COL, FX, B, NOTIF }) {
  if (verificando) return;
  verificando = true;
  try {
    const nc = NOTIF.ler();
    const para = nc.avisos && nc.avisos.email;
    const smtp = smtpAviso(NOTIF);
    if (!para || !smtp) return;
    const st = ler();
    const msgs = [];
    const agora = new Date();
    const partesHora = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(agora).map((p) => [p.type, p.value]));
    const hoje = `${partesHora.year}-${partesHora.month}-${partesHora.day}`;
    const hora = Number(partesHora.hour) % 24;
    const addDias = (isoD, delta) => new Date(Date.parse(isoD + 'T12:00:00Z') + delta * 86400e3).toISOString().slice(0, 10);
    for (const l of C.get().lojas) {
      // coleta
      if (COL && COL.ativo()) {
        try {
          const s = await COL.status(l.id, true);
          const e = s.configurada && s.execucao;
          if (e && e.fim && e.gatilho !== 'historico' && (e.estado === 'ok' || e.estado === 'falhou')) {
            const partes = [];
            if (!['xml', 'fixe', 'saldos', 'nada'].includes(e.tipo)) partes.push(['vendas', e.estado === 'ok']);
            if (e.xml) partes.push(['xml', e.xml.ok]);
            if (e.estoque) partes.push(['estoque', e.estoque.ok]);
            if (e.fixe) partes.push(['fixe', e.fixe.ok]);
            for (const [parte, ok] of partes) {
              const chave = `${l.id}|${parte}`;
              const r = registrar(st, chave, e.fim, ok, ok ? null : (e.log || []).slice(-6).join('\n'));
              if (r) msgs.push({ loja: l.nome, lojaId: l.id, chave, parte, r, quando: e.fim, log: ok ? null : (e.log || []).slice(-12) });
            }
          }
        } catch { /* coletor fora do ar: o próprio painel mostra */ }
      }
      // e-mail do FIXE
      try {
        const u = FX.situacao(l.id).ultimo;
        if (u && u.em) {
          const chave = `${l.id}|fixeEmail`;
          const r = registrar(st, chave, u.em, !!u.ok, u.erro);
          if (r) msgs.push({ loja: l.nome, lojaId: l.id, chave, parte: 'fixeEmail', r, quando: u.em, log: u.erro ? [u.erro] : null });
        }
      } catch { /* sem FIXE */ }
      // sem as vendas de ontem às 10h
      if (hora >= 10 && B.existe(l.id) && st.semVenda[l.id] !== hoje) {
        const ontem = addDias(hoje, -1);
        const ult = (B.resumo(l.id) || {}).ultimaVenda;
        if (ult && ult < ontem) {
          // só avisa se a loja costuma vender nesse dia da semana (últimas 8 semanas)
          const desde8s = addDias(ontem, -60);
          const vendas = B.lerDesde ? B.lerDesde(l.id, desde8s) : B.ler(l.id);
          const dias = new Set(vendas.map((v) => v.data));
          let costuma = 0;
          for (let k = 1; k <= 8; k++) if (dias.has(addDias(ontem, -7 * k))) costuma++;
          if (costuma >= 5) msgs.push({ loja: l.nome, lojaId: l.id, parte: 'semVenda', r: 'falhou', quando: agora.toISOString(), ult, hoje });
          else st.semVenda[l.id] = hoje;
        } else {
          st.semVenda[l.id] = hoje;
        }
      }
    }
    if (!msgs.length) { gravar(st); return; }
    const br = (iso_) => new Date(iso_).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
    for (const m of msgs) {
      let assunto, texto;
      if (m.parte === 'semVenda') {
        assunto = `⚠ ${m.loja}: sem as vendas de ontem`;
        texto = `${m.loja} chegou às 10h sem as vendas de ontem no painel (última venda: ${m.ult.split('-').reverse().join('/')}).\nA loja costuma vender nesse dia da semana. Veja em Configurações → Lojas → Dados e atualização se a coleta rodou, ou rode "Atualizar dados" no topo do painel.`;
      } else if (m.r === 'falhou') {
        assunto = `⚠ ${m.loja}: ${NOME_PARTE[m.parte]} falhou duas vezes seguidas`;
        texto = `${m.loja}: ${NOME_PARTE[m.parte]} falhou duas vezes seguidas (última em ${br(m.quando)}).\nO que já estava no painel continua valendo. Veja o motivo em Configurações → Lojas → Dados e atualização → Log técnico.${m.log && m.log.length ? `\n\nFinal do log:\n${m.log.join('\n')}` : ''}`;
      } else {
        assunto = `✓ ${m.loja}: ${NOME_PARTE[m.parte]} voltou ao normal`;
        texto = `${m.loja}: ${NOME_PARTE[m.parte]} voltou a funcionar em ${br(m.quando)}.`;
      }
      try {
        await NOTIF.enviarEmail(para, assunto, texto + '\n\n— Painel Tea Shop (aviso automático)', null, smtp);
        if (m.parte === 'semVenda') st.semVenda[m.lojaId] = m.hoje;
        console.log(`[avisos] ${assunto}`);
      } catch (e) {
        if (m.chave && st.partes[m.chave]) { st.partes[m.chave].marca = null; if (m.r === 'falhou') st.partes[m.chave].avisado = false; }
        console.error('[avisos] e-mail falhou:', e.message);
      }
    }
    gravar(st);
  } finally { verificando = false; }
}

module.exports = { verificar, registrar, smtpAviso };
