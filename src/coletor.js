'use strict';
/**
 * Fala com o serviço "coletor" (script das lojas rodando na própria VPS).
 * O coletor só é acessível dentro do docker compose; COLETOR_TOKEN é compartilhado entre os dois.
 */
const URL_BASE = (process.env.COLETOR_URL || '').replace(/\/$/, '');
const TOKEN = process.env.COLETOR_TOKEN || '';

const ativo = () => Boolean(URL_BASE && TOKEN) && !require('./config').homolog(); // homologação: nunca entra no AppNext/FIXE (HOMOLOG-01)

async function chamar(path, { method = 'GET', por, body, espera = 10000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), espera);
  try {
    const res = await fetch(URL_BASE + path, {
      method, signal: ctrl.signal,
      headers: { 'X-Coletor-Token': TOKEN, ...(por ? { 'X-Coletor-Por': por } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'o coletor não respondeu' : `coletor indisponível (${e.message})`);
  } finally { clearTimeout(t); }
}

/** Converte o estado do coletor no mesmo formato usado para o GitHub */
function execucao(s, comLog) {
  if (s.estado === 'na_fila' && s.atual) return { estado: 'na_fila', itens: s.atual.itens || null, tipo: s.atual.tipo || null, criado: s.atual.criado, gatilho: s.atual.gatilho, por: s.atual.por, de: s.atual.de, ate: s.atual.ate };
  if (s.estado === 'rodando' && s.atual) return { estado: 'rodando', itens: s.atual.itens || null, tipo: s.atual.tipo || null, inicio: s.atual.inicio, criado: s.atual.criado, gatilho: s.atual.gatilho, por: s.atual.por, de: s.atual.de, ate: s.atual.ate, aoVivo: s.ao_vivo || null };
  const u = s.ultima;
  if (!u) return null;
  return {
    estado: u.ok ? 'ok' : 'falhou', conclusao: u.ok ? 'success' : String(u.codigo), gatilho: u.gatilho, por: u.por,
    inicio: u.inicio, criado: u.criado, fim: u.fim, duracao: u.duracao_s, ultimaDoDia: u.ultimaDoDia || null, de: u.de, ate: u.ate, tipo: u.tipo, xml: u.xml || null, estoque: u.estoque || null, fixe: u.fixe || null, saldos: u.saldos || null, caixa: u.caixa || null,
    log: comLog ? u.log : undefined,
  };
}

async function status(lojaId, comLog) {
  const { status: st, json } = await chamar(`/status/${encodeURIComponent(lojaId)}`);
  if (st === 401) throw new Error('COLETOR_TOKEN diferente entre o painel e o coletor');
  if (!json.configurada) return { configurada: false };
  return { configurada: true, horarios: json.horarios, janela: json.janela, temFixe: !!json.temFixe, temPedido: !!json.temPedido, pedido: json.pedido || null, saldos: json.saldos || null, inventario: json.inventario || null, nfe: json.nfe || null, robo: json.robo || null, fila: json.fila || 0, lote: json.lote || null, execucao: execucao(json, comLog) };
}

async function rodar(lojaId, por, itens) {
  return chamar(`/rodar/${encodeURIComponent(lojaId)}`, { method: 'POST', por, body: itens ? { itens } : undefined });
}

async function historico(lojaId, partes, por, tipo = 'ambos', extras = []) {
  return chamar(`/historico/${encodeURIComponent(lojaId)}`, { method: 'POST', por, body: { partes, tipo, extras } });
}
/** Extrato de estoque do AppNext, só leitura (EXTRATO-01) */
async function extrato(lojaId, por, desde) {
  return chamar(`/extrato/${encodeURIComponent(lojaId)}`, { method: 'POST', por, body: { desde } });
}
async function fixe(lojaId, por) {
  return chamar(`/fixe/${encodeURIComponent(lojaId)}`, { method: 'POST', por });
}
/** saldo oficial de pontos dos clientes (só leitura no FIXE) */
async function fixeSaldos(lojaId, por) {
  return chamar(`/fixe-saldos/${encodeURIComponent(lojaId)}`, { method: 'POST', por });
}
/** Sistema de Pedidos: { acao: 'catalogo' | 'carrinho', somar } */
async function pedido(lojaId, por, body) {
  return chamar(`/pedido/${encodeURIComponent(lojaId)}`, { method: 'POST', por, body });
}
/** importar no AppNext a planilha de inventário (ou a que desfaz) que o painel deixou em dados/<loja>/inventario/envio */
async function inventario(lojaId, id, tipo, por) {
  return chamar(`/inventario/${encodeURIComponent(lojaId)}`, { method: 'POST', por, body: { id, tipo } });
}
/** NF-e de saída: ler os cadastros da tela ou salvar um rascunho (arquivo em dados/<loja>/nfe/envio) */
async function nfe(lojaId, id, acao, por) {
  return chamar(`/nfe/${encodeURIComponent(lojaId)}`, { method: 'POST', por, body: { id, acao } });
}
/** DANFE (HTML deixado em dados/<loja>/devolucoes/<id>/danfe.html) em PDF, pelo Chromium do coletor */
async function pdf(lojaId, id) {
  return chamar(`/pdf/${encodeURIComponent(lojaId)}`, { method: 'POST', body: { id }, espera: 60000 });
}
async function cancelar(lojaId, por) {
  return chamar(`/cancelar/${encodeURIComponent(lojaId)}`, { method: 'POST', por });
}
async function saude() {
  try { const r = await chamar('/saude'); return r.json; } catch (e) { return { ok: false, erro: e.message }; }
}

module.exports = { pdf, nfe, inventario, pedido, fixe, fixeSaldos, extrato, ativo, status, rodar, historico, cancelar, saude };
