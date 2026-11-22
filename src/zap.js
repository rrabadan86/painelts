'use strict';
/**
 * Fala com o serviço "zap" (robô do WhatsApp das campanhas, rodando na própria VPS, sem porta publicada).
 * O serviço só conecta, envia o que o painel manda e informa a situação: quem, quando e quanto é decidido
 * aqui no painel (src/zapfila.js e src/zaplaco.js). ZAP_TOKEN é compartilhado entre os dois.
 */
const base = () => (process.env.ZAP_URL || '').replace(/\/$/, '');
const token = () => process.env.ZAP_TOKEN || '';

const ativo = () => Boolean(base() && token());
const loja = (id) => encodeURIComponent(String(id || '').toLowerCase().replace(/[^a-z0-9_-]/g, ''));

async function chamar(caminho, { method = 'GET', body, espera = 8000 } = {}) {
  if (!ativo()) throw new Error('o robô do WhatsApp não está instalado neste servidor');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), espera);
  try {
    const res = await fetch(base() + caminho, {
      method, signal: ctrl.signal,
      headers: { 'X-Zap-Token': token(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('ZAP_TOKEN diferente entre o painel e o robô do WhatsApp');
    if (!res.ok) throw new Error(`o robô do WhatsApp respondeu ${res.status}`);
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('o robô do WhatsApp não respondeu');
    if (/^o robô|^ZAP_TOKEN/.test(e.message)) throw e;
    throw new Error('robô do WhatsApp indisponível');
  } finally { clearTimeout(t); }
}

const saude = async () => { try { return await chamar('/saude'); } catch (e) { return { ok: false, erro: e.message }; } };
/** { estado: 'desligado'|'iniciando'|'qr'|'codigo'|'conectado'|'caiu', qr, codigo, numeroFim, desde, erro } */
const status = (id) => chamar(`/status/${loja(id)}`);
/** com número → pareamento por código; sem → QR */
const conectar = (id, numero) => chamar(`/conectar/${loja(id)}`, { method: 'POST', body: numero ? { numero } : {}, espera: 20000 });
const desconectar = (id) => chamar(`/desconectar/${loja(id)}`, { method: 'POST', body: {}, espera: 20000 });
/** uma mensagem; o mesmo id repetido em 24 h devolve o resultado anterior sem reenviar */
const enviar = (id, msg) => chamar(`/enviar/${loja(id)}`, { method: 'POST', body: { id: msg.id, para: msg.para, texto: msg.texto }, espera: 90000 });
/** quem respondeu "parar", "sair"… desde a data (só o número e a hora; o texto não vem) */
const optouts = (id, desde) => chamar(`/optouts/${loja(id)}?desde=${encodeURIComponent(desde)}`);

/** Clientes → Conversas: as mensagens das conversas individuais depois do número `desde` → { ultimo, itens, mais } */
const conversas = (id, desde) => chamar(`/conversas/${loja(id)}?desde=${encodeURIComponent(desde || 0)}`, { espera: 20000 });
/** importa as conversas dos últimos `dias` (roda no serviço; a situação vem em status().historico) */
const historico = (id, dias) => chamar(`/historico/${loja(id)}`, { method: 'POST', body: { dias }, espera: 20000 });

module.exports = { ativo, saude, status, conectar, desconectar, enviar, optouts, conversas, historico };
