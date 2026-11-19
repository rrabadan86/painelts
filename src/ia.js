'use strict';
/**
 * Inteligência artificial (Claude, da Anthropic) com a chave de cada franqueado.
 *   config/ia.json         chaves (criptografadas, AES-256-GCM), lojas de cada chave, teto e uso por mês
 *   config/ia-mestra.key   chave mestra que criptografa as chaves (gerada na 1ª vez; ou IA_SEGREDO no .env)
 * A chave da API nunca volta para a tela, para log ou para e-mail: só os 4 últimos caracteres.
 * Cada loja usa no máximo uma chave; quem salva escolhe as lojas (as suas). Sem chave, a IA fica desligada na loja.
 * IA_FALSO=1 (testes) e a apresentação usam respostas simuladas: nada vai para a Anthropic.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');

const ARQ = () => path.join(C.CONFIG_DIR, 'ia.json');
const ARQ_MESTRA = () => path.join(C.CONFIG_DIR, 'ia-mestra.key');
const API = 'https://api.anthropic.com/v1';
const MODELO = () => process.env.IA_MODELO || 'claude-sonnet-5-5';
// preço estimado (US$ por milhão de tokens): o valor exato é o da fatura no console da Anthropic
const PRECO = () => ({ entrada: +process.env.IA_PRECO_ENTRADA || 3, saida: +process.env.IA_PRECO_SAIDA || 15 });
const TETO_PADRAO = 10; // US$ por mês

// ---------- chave mestra e criptografia ----------
let mestraMem = null;
function mestra() {
  if (mestraMem) return mestraMem;
  if (process.env.IA_SEGREDO) return (mestraMem = crypto.createHash('sha256').update(process.env.IA_SEGREDO).digest());
  try { mestraMem = Buffer.from(fs.readFileSync(ARQ_MESTRA(), 'utf8').trim(), 'base64'); if (mestraMem.length === 32) return mestraMem; } catch { /* ainda não existe */ }
  mestraMem = crypto.randomBytes(32);
  C.gravarAtomico(ARQ_MESTRA(), mestraMem.toString('base64'), 0o600);
  return mestraMem;
}
function cifrar(txt) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', mestra(), iv);
  const enc = Buffer.concat([c.update(String(txt), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function decifrar(s) {
  const [iv, tag, enc] = String(s).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', mestra(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ---------- arquivo ----------
function ler() {
  try { const j = JSON.parse(fs.readFileSync(ARQ(), 'utf8')); return { chaves: j.chaves || {}, uso: j.uso || {} }; } catch { return { chaves: {}, uso: {} }; }
}
const gravar = (d) => C.gravarAtomico(ARQ(), JSON.stringify(d, null, 1), 0o600);
const mesAtual = () => C.hojeBR().slice(0, 7);
const formatoOk = (k) => /^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(String(k || '').trim());

/** chave que vale para a loja: { id, ...registro } ou null */
function chaveDaLoja(lojaId, d = ler()) {
  for (const [id, r] of Object.entries(d.chaves)) if ((r.lojas || []).includes(lojaId)) return { id, ...r };
  return null;
}
function usoDoMes(id, d = ler(), ym = mesAtual()) {
  const u = (d.uso[id] || {})[ym] || {};
  return { pedidos: u.pedidos || 0, entrada: u.entrada || 0, saida: u.saida || 0, usd: u.usd || 0 };
}

/** situação para a tela (nunca devolve a chave) */
function situacao(lojas, user, perfil) {
  const d = ler();
  const nomeDe = (u) => (C.usuario(u) || {}).nome || u;
  const vistas = new Map();
  const porLoja = lojas.map((l) => {
    const k = chaveDaLoja(l.id, d);
    if (k && !vistas.has(k.id)) vistas.set(k.id, k);
    return { loja: l.id, nome: l.nome, chave: k ? k.id : null };
  });
  const chaves = [...vistas.values()].map((k) => ({
    id: k.id, fim: k.fim, dono: nomeDe(k.dono), minha: k.dono === user, teto: k.teto, criadaEm: k.criadaEm, testadaEm: k.testadaEm || null,
    lojas: (k.lojas || []).filter((x) => lojas.some((l) => l.id === x)), outrasLojas: (k.lojas || []).filter((x) => !lojas.some((l) => l.id === x)).length,
    podeMexer: perfil === 'admin' || k.dono === user, uso: usoDoMes(k.id, d), modelo: MODELO(),
  }));
  return { porLoja, chaves, preco: PRECO(), tetoPadrao: TETO_PADRAO };
}

/** grava a chave para as lojas (tira essas lojas das outras chaves). Devolve { ok:{id, fim} } ou { erro } */
function salvar({ chave, lojas, teto, user }) {
  chave = String(chave || '').trim();
  if (!formatoOk(chave)) return { erro: 'Essa não parece uma chave da API da Anthropic (começa com "sk-ant-").' };
  if (!Array.isArray(lojas) || !lojas.length) return { erro: 'Escolha pelo menos uma loja.' };
  const d = ler();
  // mesma chave já guardada por esta pessoa: reaproveita o registro (mantém o uso do mês)
  let id = Object.keys(d.chaves).find((x) => d.chaves[x].dono === user && (() => { try { return decifrar(d.chaves[x].enc) === chave; } catch { return false; } })());
  if (!id) id = crypto.randomBytes(6).toString('hex');
  for (const [x, r] of Object.entries(d.chaves)) if (x !== id) r.lojas = (r.lojas || []).filter((l) => !lojas.includes(l));
  const ant = d.chaves[id] || {};
  d.chaves[id] = {
    enc: cifrar(chave), fim: chave.slice(-4), dono: user, lojas: [...new Set([...(ant.lojas || []), ...lojas])],
    teto: tetoValido(teto, ant.teto), criadaEm: ant.criadaEm || new Date().toISOString(), testadaEm: new Date().toISOString(),
  };
  for (const [x, r] of Object.entries(d.chaves)) if (!r.lojas.length) delete d.chaves[x];
  gravar(d);
  return { ok: { id, fim: chave.slice(-4) } };
}
function tetoValido(t, ant) {
  if (t === null || t === '') return null; // sem teto
  const n = Number(t);
  if (Number.isFinite(n) && n >= 1 && n <= 1000) return Math.round(n * 100) / 100;
  return ant !== undefined ? ant : TETO_PADRAO;
}
function alterar(id, { teto, lojas }, user, perfil, lojasPermitidas) {
  const d = ler();
  const r = d.chaves[id];
  if (!r) return { erro: 'Chave não encontrada.' };
  if (perfil !== 'admin' && r.dono !== user) return { erro: 'Só quem cadastrou a chave pode mudar.' };
  if (teto !== undefined) r.teto = tetoValido(teto, r.teto);
  if (Array.isArray(lojas)) {
    const minhas = new Set(lojasPermitidas);
    const novas = lojas.filter((l) => minhas.has(l));
    for (const [x, o] of Object.entries(d.chaves)) if (x !== id) o.lojas = (o.lojas || []).filter((l) => !novas.includes(l));
    r.lojas = [...(r.lojas || []).filter((l) => !minhas.has(l)), ...novas];
  }
  for (const [x, o] of Object.entries(d.chaves)) if (!o.lojas.length) delete d.chaves[x];
  gravar(d);
  return { ok: true };
}
function remover(id, user, perfil) {
  const d = ler();
  const r = d.chaves[id];
  if (!r) return { erro: 'Chave não encontrada.' };
  if (perfil !== 'admin' && r.dono !== user) return { erro: 'Só quem cadastrou a chave pode remover.' };
  delete d.chaves[id];
  gravar(d);
  return { ok: true };
}

/** custo estimado em US$ de uma resposta da API */
function custo(u) {
  const p = PRECO();
  const ent = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1;
  return (ent * p.entrada + (u.output_tokens || 0) * p.saida) / 1e6;
}
function registrarUso(id, u) {
  const d = ler();
  if (!d.chaves[id]) return;
  const ym = mesAtual();
  const m = ((d.uso[id] = d.uso[id] || {})[ym] = d.uso[id][ym] || { pedidos: 0, entrada: 0, saida: 0, usd: 0 });
  m.pedidos++;
  m.entrada += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  m.saida += u.output_tokens || 0;
  m.usd = Math.round((m.usd + custo(u)) * 1e6) / 1e6;
  // guarda só 13 meses
  for (const k of Object.keys(d.uso[id]).sort().slice(0, -13)) delete d.uso[id][k];
  gravar(d);
}

/** confere a chave na Anthropic (lista de modelos: não gasta nada) */
async function testar(chave) {
  if (process.env.IA_FALSO === '1') return formatoOk(chave) ? { ok: true } : { erro: 'Chave inválida.' };
  try {
    const r = await fetch(`${API}/models?limit=1`, { headers: { 'x-api-key': String(chave).trim(), 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15000) });
    if (r.ok) return { ok: true };
    return { erro: r.status === 401 ? 'A Anthropic recusou a chave: confira se copiou inteira e se ela não foi desativada no console.' : r.status === 403 ? 'A chave não tem permissão para usar a API.' : `A Anthropic respondeu ${r.status}. Tente de novo em instantes.` };
  } catch (e) { return { erro: 'Não consegui falar com a Anthropic agora (' + (e.name === 'TimeoutError' ? 'demorou demais' : e.message) + ').' }; }
}

class ErroIA extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

/** chama a API de mensagens com a chave da loja (confere teto antes; registra o uso depois) */
async function mensagens(lojaId, corpo) {
  const d = ler();
  const k = chaveDaLoja(lojaId, d);
  if (!k) throw new ErroIA('A IA não está configurada nesta loja: o franqueado cadastra a chave em Configurações → Inteligência artificial.', 409);
  const uso = usoDoMes(k.id, d);
  if (k.teto != null && uso.usd >= k.teto) throw new ErroIA(`O teto de US$ ${k.teto.toFixed(2)} deste mês foi atingido. Aumente em Configurações → Inteligência artificial ou espere o mês virar.`, 429);
  const req = { model: MODELO(), max_tokens: corpo.max_tokens || 2048, ...corpo };
  let j;
  if (process.env.IA_FALSO === '1') j = simular(req);
  else {
    let chave;
    try { chave = decifrar(k.enc); } catch { throw new ErroIA('Não consegui abrir a chave guardada (a chave mestra mudou?). Cadastre a chave de novo.', 500); }
    let r;
    try {
      r = await fetch(`${API}/messages`, { method: 'POST', headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(120000) });
    } catch (e) { throw new ErroIA('Não consegui falar com a Anthropic agora (' + (e.name === 'TimeoutError' ? 'demorou demais' : e.message) + ').', 502); }
    j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = (j.error && j.error.message) || '';
      if (r.status === 401) throw new ErroIA('A Anthropic recusou a chave desta loja (foi desativada?). Cadastre de novo em Configurações → Inteligência artificial.', 409);
      if (/credit balance/i.test(m)) throw new ErroIA('Acabaram os créditos da conta na Anthropic: o franqueado precisa adicionar créditos em console.anthropic.com (Billing).', 402);
      if (r.status === 429) throw new ErroIA('Muitos pedidos à IA em pouco tempo. Espere um minuto.', 429);
      if (r.status === 529 || r.status >= 500) throw new ErroIA('A IA está sobrecarregada agora. Tente de novo em instantes.', 503);
      throw new ErroIA('A IA recusou o pedido: ' + (m || r.status), 400);
    }
  }
  registrarUso(k.id, j.usage || {});
  return j;
}

// ---------- respostas simuladas (testes e apresentação) ----------
function simular(req) {
  const usage = { input_tokens: 1200, output_tokens: 150 };
  const ultima = req.messages[req.messages.length - 1];
  const forcada = req.tool_choice && req.tool_choice.type === 'tool' ? req.tool_choice.name : null;
  if (forcada === 'revisar_pedido') {
    let dados = {};
    try { dados = JSON.parse(String(ultima.content).replace(/^[^{]*/, '')); } catch { /* ok */ }
    const it = (dados.itens || []).find((x) => x.pedir > 0) || (dados.itens || [])[0];
    return { stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 'sim1', name: 'revisar_pedido', input: {
      resumo: 'Revisão simulada: o pedido está equilibrado com as vendas recentes. Na loja de verdade, a IA compara com a mesma época do ano passado, a validade e o giro de cada produto.',
      alertas: ['Exemplo de alerta: confira os chás que vencem nos próximos 60 dias antes de pedir mais.'],
      ajustes: it ? [{ cod: String(it.cod), qtd: (it.pedir || 0) + (it.un === 'Kg' ? 1 : 2), motivo: 'Exemplo: vendeu acima da média nas últimas semanas e a época que vem costuma ser mais forte.' }] : [],
    } }] };
  }
  const resultados = Array.isArray(ultima.content) ? ultima.content.filter((b) => b.type === 'tool_result') : [];
  if (!resultados.length && req.tools && req.tools.some((t) => t.name === 'consultar_vendas')) {
    return { stop_reason: 'tool_use', usage, content: [{ type: 'text', text: 'Vou consultar as vendas.' }, { type: 'tool_use', id: 'sim-v', name: 'consultar_vendas', input: { periodo: { ultimos_dias: 90 }, agrupar_por: 'mes' } }] };
  }
  let txt = 'Resposta simulada.';
  try {
    const r = JSON.parse(resultados[0].content);
    const linhas = (r.grupos || []).map((g) => `- **${g.chave}**: ${g.faturamento.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em ${g.cupons} atendimentos`).join('\n');
    txt = `Nos últimos 90 dias, mês a mês:\n\n${linhas}\n\n*Na apresentação a resposta é simulada: na loja de verdade a IA responde à sua pergunta com os números da loja.*`;
  } catch { /* ok */ }
  return { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: txt }] };
}

module.exports = { situacao, salvar, alterar, remover, testar, mensagens, chaveDaLoja, usoDoMes, custo, formatoOk, simular, ErroIA, cifrar, decifrar, MODELO, TETO_PADRAO };
