'use strict';
/**
 * Fala com o serviço "coletor" (script das lojas rodando na própria VPS).
 * O coletor só é acessível dentro do docker compose; COLETOR_TOKEN é compartilhado entre os dois.
 */
const URL_BASE = (process.env.COLETOR_URL || '').replace(/\/$/, '');
const TOKEN = process.env.COLETOR_TOKEN || '';

const ativo = () => Boolean(URL_BASE && TOKEN);

async function chamar(path, { method = 'GET', por, body } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
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
  if (s.estado === 'na_fila' && s.atual) return { estado: 'na_fila', criado: s.atual.criado, gatilho: s.atual.gatilho, por: s.atual.por, de: s.atual.de, ate: s.atual.ate };
  if (s.estado === 'rodando' && s.atual) return { estado: 'rodando', inicio: s.atual.inicio, criado: s.atual.criado, gatilho: s.atual.gatilho, por: s.atual.por, de: s.atual.de, ate: s.atual.ate };
  const u = s.ultima;
  if (!u) return null;
  return {
    estado: u.ok ? 'ok' : 'falhou', conclusao: u.ok ? 'success' : String(u.codigo), gatilho: u.gatilho, por: u.por,
    inicio: u.inicio, criado: u.criado, fim: u.fim, duracao: u.duracao_s, de: u.de, ate: u.ate, tipo: u.tipo, xml: u.xml || null,
    log: (!u.ok || (u.xml && !u.xml.ok)) && comLog ? u.log : undefined,
  };
}

async function status(lojaId, comLog) {
  const { status: st, json } = await chamar(`/status/${encodeURIComponent(lojaId)}`);
  if (st === 401) throw new Error('COLETOR_TOKEN diferente entre o painel e o coletor');
  if (!json.configurada) return { configurada: false };
  return { configurada: true, horarios: json.horarios, janela: json.janela, fila: json.fila || 0, lote: json.lote || null, execucao: execucao(json, comLog) };
}

async function rodar(lojaId, por) {
  return chamar(`/rodar/${encodeURIComponent(lojaId)}`, { method: 'POST', por });
}

async function historico(lojaId, partes, por, tipo = 'ambos') {
  return chamar(`/historico/${encodeURIComponent(lojaId)}`, { method: 'POST', por, body: { partes, tipo } });
}
async function cancelar(lojaId, por) {
  return chamar(`/cancelar/${encodeURIComponent(lojaId)}`, { method: 'POST', por });
}
async function saude() {
  try { const r = await chamar('/saude'); return r.json; } catch (e) { return { ok: false, erro: e.message }; }
}

module.exports = { ativo, status, rodar, historico, cancelar, saude };
