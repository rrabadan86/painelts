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

/** SMTP para mandar o aviso: o geral do painel; se não houver, o Gmail de alguma loja */
function smtpAviso(NOTIF) {
  const nc = NOTIF.ler();
  if (nc.email && nc.email.host && nc.email.from) return nc.email;
  for (const l of C.get().lojas) {
    const x = NOTIF.cfgLoja(nc, l.id);
    if (x.email && x.email.user && x.email.pass) return x.email;
  }
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
async function verificar({ COL, FX, B, NOTIF }) {
  const nc = NOTIF.ler();
  const para = nc.avisos && nc.avisos.email;
  if (!para) return;
  const st = ler();
  const msgs = [];
  const agora = new Date();
  const hojeBR = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (const l of C.get().lojas) {
    // coleta
    if (COL && COL.ativo()) {
      try {
        const s = await COL.status(l.id, true);
        const e = s.configurada && s.execucao;
        if (e && e.fim && e.gatilho !== 'historico' && (e.estado === 'ok' || e.estado === 'falhou')) {
          const partes = [];
          if (!['xml', 'fixe', 'nada'].includes(e.tipo)) partes.push(['vendas', e.estado === 'ok']);
          if (e.xml) partes.push(['xml', e.xml.ok]);
          if (e.estoque) partes.push(['estoque', e.estoque.ok]);
          if (e.fixe) partes.push(['fixe', e.fixe.ok]);
          for (const [parte, ok] of partes) {
            const r = registrar(st, `${l.id}|${parte}`, e.fim, ok, ok ? null : (e.log || []).slice(-6).join('\n'));
            if (r) msgs.push({ loja: l.nome, parte, r, quando: e.fim, log: ok ? null : (e.log || []).slice(-12) });
          }
        }
      } catch { /* coletor fora do ar: o próprio painel mostra */ }
    }
    // e-mail do FIXE
    try {
      const u = FX.situacao(l.id).ultimo;
      if (u && u.em) {
        const r = registrar(st, `${l.id}|fixeEmail`, u.em, !!u.ok, u.erro);
        if (r) msgs.push({ loja: l.nome, parte: 'fixeEmail', r, quando: u.em, log: u.erro ? [u.erro] : null });
      }
    } catch { /* sem FIXE */ }
    // sem as vendas de ontem às 10h
    if (hojeBR.getHours() >= 10 && B.existe(l.id)) {
      const hoje = iso(hojeBR);
      if (st.semVenda[l.id] !== hoje) {
        const ontemD = new Date(hojeBR); ontemD.setDate(ontemD.getDate() - 1);
        const ontem = iso(ontemD);
        const ult = (B.resumo(l.id) || {}).ultimaVenda;
        if (ult && ult < ontem) {
          // só avisa se a loja costuma vender nesse dia da semana (últimas 8 semanas)
          const vendas = B.ler(l.id);
          const dias = new Set(vendas.map((v) => v.data));
          let costuma = 0;
          for (let k = 1; k <= 8; k++) { const d = new Date(ontemD); d.setDate(d.getDate() - 7 * k); if (dias.has(iso(d))) costuma++; }
          if (costuma >= 5) msgs.push({ loja: l.nome, parte: 'semVenda', r: 'falhou', quando: agora.toISOString(), ult });
        }
        st.semVenda[l.id] = hoje;
      }
    }
  }
  gravar(st);
  if (!msgs.length) return;
  const smtp = smtpAviso(NOTIF);
  if (!smtp) { console.error('[avisos] sem servidor de e-mail para mandar o aviso'); return; }
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
    try { await NOTIF.enviarEmail(para, assunto, texto + '\n\n— Painel Tea Shop (aviso automático)', null, smtp); console.log(`[avisos] ${assunto}`); }
    catch (e) { console.error('[avisos] e-mail falhou:', e.message); }
  }
}

module.exports = { verificar, registrar, smtpAviso };
