'use strict';
/**
 * Histórico das atualizações de cada loja (o que o robô fez e o que o painel importou), para a tabela
 * "Histórico das atualizações" em Configurações → Dados e atualização.
 *   dados/<loja>/eventos.json  [{ em, parte, ok, gatilho, por, de, ate, detalhe, erro }]  (mais recente primeiro, até 300)
 * Vendas e XML importados já têm o próprio histórico (base e xml); aqui ficam as coletas (inclusive as que falharam),
 * o estoque, as notas de compra, o caixa, o pedido ao FIXE e a importação do e-mail do FIXE.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const arq = (id) => path.join(C.pastaLoja(id), 'eventos.json');
function ler(id) { try { const j = JSON.parse(fs.readFileSync(arq(id), 'utf8')); return Array.isArray(j.eventos) ? j : { eventos: [], marcas: {} }; } catch { return { eventos: [], marcas: {} }; } }
function gravar(id, j) { fs.mkdirSync(path.dirname(arq(id)), { recursive: true }); j.eventos = j.eventos.slice(0, 300); C.gravarAtomico(arq(id), JSON.stringify(j), 0o640); }

/** motivo curto do log (última linha com erro) */
const ASSUNTO = { estoque: /estoque/i, compras: /compra|entrada|nota/i, caixa: /caixa|fechamento|pdv/i, fixe: /fixe|leads|logs|exporta/i };
function motivo(log, parte) {
  const l = (log || []).map(String).filter((t) => /erro|falh|não consegui|RuntimeError|Exception|timeout|recus/i.test(t) && !/^#+|###/.test(t.replace(/^\[[\d:]+\]\s*/, ''))
    && (!ASSUNTO[parte] || ASSUNTO[parte].test(t)));
  return l.length ? l[l.length - 1].replace(/^\[[\d:]+\]\s*/, '').replace(/^RuntimeError:\s*/, '').slice(0, 300) : null;
}

/** registra uma execução do coletor (uma vez por fim) e o resultado do e-mail do FIXE (uma vez por em) */
function registrar(id, { execucao, fixeUltimo }) {
  const j = ler(id);
  j.marcas = j.marcas || {};
  let mudou = false;
  const e = execucao;
  if (e && e.fim && ['ok', 'falhou'].includes(e.estado) && j.marcas.coleta !== e.fim) {
    j.marcas.coleta = e.fim; mudou = true;
    const base = { em: new Date(e.fim).toISOString(), gatilho: e.gatilho, por: e.por || null, de: e.de || null, ate: e.ate || null, duracao: e.duracao || null };
    const erro = motivo(e.log);
    const erroDe = (parte) => motivo(e.log, parte) || 'falhou (veja o log técnico)';
    const novos = [];
    // vendas e XML que deram certo já aparecem pelas importações; aqui só as falhas
    if (!['xml', 'fixe', 'saldos', 'nada'].includes(e.tipo) && e.estado !== 'ok') novos.push({ ...base, parte: 'vendas', ok: false, erro });
    if (e.xml && !e.xml.ok) novos.push({ ...base, parte: 'xml', ok: false, erro });
    if (e.estoque) {
      novos.push({ ...base, parte: 'estoque', ok: !!e.estoque.ok, erro: e.estoque.ok ? null : erroDe('estoque') });
      if (e.estoque.compras != null) novos.push({ ...base, parte: 'compras', ok: !!e.estoque.compras, erro: e.estoque.compras ? null : erroDe('compras') });
    }
    if (e.caixa) novos.push({ ...base, parte: 'caixa', ok: !!e.caixa.ok, erro: e.caixa.ok ? null : erroDe('caixa') });
    if (e.fixe) novos.push({ ...base, parte: 'fixe', ok: !!e.fixe.ok, detalhe: e.fixe.ok ? 'exportação pedida ao FIXE' : null, erro: e.fixe.ok ? null : erroDe('fixe') });
    if (e.saldos) novos.push({ ...base, parte: 'saldos', ok: !!e.saldos.ok, detalhe: e.saldos.ok ? 'saldos de pontos lidos no FIXE' : null, erro: e.saldos.ok ? null : erroDe('saldos') });
    j.eventos.unshift(...novos.reverse());
  }
  const u = fixeUltimo;
  if (u && u.em && j.marcas.fixeEmail !== u.em) {
    j.marcas.fixeEmail = u.em; mudou = true;
    const r = u.resultado || {};
    const det = [r.noArquivo != null ? `Base de leads: ${r.noArquivo} clientes (${r.novos || 0} novos)` : null, u.logs && u.logs.resultado ? `Logs: ${u.logs.resultado.movimentos ?? '?'} movimentos` : null, u.doSpam ? 'e-mail estava no spam' : null].filter(Boolean).join(' · ');
    j.eventos.unshift({ em: new Date(u.em).toISOString(), parte: 'fixeEmail', ok: !!u.ok, gatilho: 'automatico', detalhe: det || null, erro: u.ok ? (u.erro || null) : u.erro || 'falhou' });
  }
  if (mudou) { j.eventos.sort((a, b) => (a.em < b.em ? 1 : -1)); gravar(id, j); }
}

const lista = (id, n = 120) => ler(id).eventos.slice(0, n);
module.exports = { registrar, lista };
