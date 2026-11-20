'use strict';
/**
 * Inteligência artificial (Claude, da Anthropic) com a chave de cada franqueado.
 *   config/ia.json         chave de cada loja (criptografada, AES-256-GCM), teto e uso por mês
 *   config/ia-mestra.key   chave mestra que criptografa as chaves (gerada na 1ª vez; ou IA_SEGREDO no .env)
 * A chave da API nunca volta para a tela, para log ou para e-mail: só os 4 últimos caracteres.
 * Cada loja tem a própria chave, teto e uso (Configurações → loja → Inteligência artificial). Sem chave, a IA fica desligada na loja.
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
// { chaves: { <loja>: { enc, fim, dono, teto, criadaEm, testadaEm } }, uso: { <loja>: { 'AAAA-MM': {...} } } }
function ler() {
  let j;
  try { j = JSON.parse(fs.readFileSync(ARQ(), 'utf8')); } catch { return { chaves: {}, uso: {} }; }
  const d = { chaves: j.chaves || {}, uso: j.uso || {} };
  // formato antigo (uma chave para várias lojas): cada loja vira dona do próprio registro
  for (const [id, r] of Object.entries(d.chaves)) {
    if (!Array.isArray(r.lojas)) continue;
    delete d.chaves[id];
    const { lojas, ...resto } = r;
    lojas.forEach((l, k) => { d.chaves[l] = { ...resto }; if (k === 0 && d.uso[id]) d.uso[l] = d.uso[id]; });
    delete d.uso[id];
  }
  return d;
}
const gravar = (d) => C.gravarAtomico(ARQ(), JSON.stringify(d, null, 1), 0o600);
const mesAtual = () => C.hojeBR().slice(0, 7);
const formatoOk = (k) => /^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(String(k || '').trim());

/** chave da loja: { id (= loja), ...registro } ou null */
function chaveDaLoja(lojaId, d = ler()) {
  const r = d.chaves[lojaId];
  return r ? { id: lojaId, ...r } : null;
}
/** chave em uso: a loja tem chave E a IA está ligada (dá para desligar sem remover a chave) */
function chaveAtiva(lojaId, d = ler()) { const k = chaveDaLoja(lojaId, d); return k && !k.desligada ? k : null; }
function usoDoMes(lojaId, d = ler(), ym = mesAtual()) {
  const u = (d.uso[lojaId] || {})[ym] || {};
  return { pedidos: u.pedidos || 0, entrada: u.entrada || 0, saida: u.saida || 0, usd: u.usd || 0 };
}

/** situação da loja para a tela (nunca devolve a chave) */
function situacao(lojaId) {
  const d = ler();
  const k = d.chaves[lojaId];
  return {
    chave: k ? { fim: k.fim, dono: (C.usuario(k.dono) || {}).nome || k.dono, teto: k.teto ?? null, ligada: !k.desligada, criadaEm: k.criadaEm || null, testadaEm: k.testadaEm || null } : null,
    uso: usoDoMes(lojaId, d), modelo: MODELO(), preco: PRECO(), tetoPadrao: TETO_PADRAO,
  };
}

/** grava a chave da loja (troca a anterior; o uso do mês continua sendo da loja) */
function salvar({ chave, loja, teto, user }) {
  chave = String(chave || '').trim();
  if (!formatoOk(chave)) return { erro: 'Essa não parece uma chave da API da Anthropic (começa com "sk-ant-").' };
  if (!loja) return { erro: 'Escolha a loja.' };
  const d = ler();
  const ant = d.chaves[loja] || {};
  d.chaves[loja] = { enc: cifrar(chave), fim: chave.slice(-4), dono: user, teto: tetoValido(teto, ant.teto), criadaEm: new Date().toISOString(), testadaEm: new Date().toISOString() };
  gravar(d);
  return { ok: { fim: chave.slice(-4) } };
}
function tetoValido(t, ant) {
  if (t === null || t === '') return null; // sem teto
  const n = Number(t);
  if (Number.isFinite(n) && n >= 1 && n <= 1000) return Math.round(n * 100) / 100;
  return ant !== undefined ? ant : TETO_PADRAO;
}
function alterar(loja, { teto, ligada }) {
  const d = ler();
  const r = d.chaves[loja];
  if (!r) return { erro: 'Esta loja não tem chave.' };
  if (teto !== undefined) {
    const n = teto === null || teto === '' ? null : Number(teto);
    if (n !== null && !(Number.isFinite(n) && n >= 1 && n <= 1000)) return { erro: 'O teto por mês vai de US$ 1 a US$ 1.000 (ou em branco, sem teto).' };
    r.teto = tetoValido(teto, r.teto);
  }
  if (ligada !== undefined) { if (ligada) delete r.desligada; else r.desligada = true; } // desligar guarda a chave; nada é cobrado enquanto desligada
  gravar(d);
  return { ok: true };
}
function remover(loja) {
  const d = ler();
  if (!d.chaves[loja]) return { erro: 'Esta loja não tem chave.' };
  delete d.chaves[loja];
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
  const onde = `Configurações → Lojas → ${(C.get().lojas.find((l) => l.id === lojaId) || {}).nome || lojaId} → Inteligência artificial`;
  const k = chaveDaLoja(lojaId, d);
  if (!k) throw new ErroIA(`A IA não está ligada nesta loja: o franqueado cadastra a chave em ${onde}.`, 409);
  if (k.desligada) throw new ErroIA(`A IA está desligada nesta loja. Para voltar a usar, ligue em ${onde}.`, 409);
  const uso = usoDoMes(k.id, d);
  if (k.teto != null && uso.usd >= k.teto) throw new ErroIA(`O teto de US$ ${k.teto.toFixed(2)} deste mês foi atingido. Aumente em ${onde} ou espere o mês virar.`, 429);
  const req = { model: MODELO(), max_tokens: corpo.max_tokens || 2048, ...corpo };
  let j;
  if (process.env.IA_FALSO === '1') j = simular(req);
  else {
    let chave;
    try { chave = decifrar(k.enc); } catch { throw new ErroIA('Não consegui abrir a chave guardada (a chave mestra mudou?). Cadastre a chave de novo.', 500); }
    let r;
    try {
      r = await fetch(`${API}/messages`, { method: 'POST', headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(240000) });
    } catch (e) { throw new ErroIA('Não consegui falar com a Anthropic agora (' + (e.name === 'TimeoutError' ? 'demorou demais' : e.message) + ').', 502); }
    j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = (j.error && j.error.message) || '';
      if (r.status === 401) throw new ErroIA(`A Anthropic recusou a chave desta loja (foi desativada?). Cadastre de novo em ${onde}.`, 409);
      if (/credit balance/i.test(m)) throw new ErroIA('Acabaram os créditos da conta na Anthropic: o franqueado precisa adicionar créditos em console.anthropic.com (Billing).', 402);
      if (r.status === 429) throw new ErroIA('Muitos pedidos à IA em pouco tempo. Espere um minuto.', 429);
      if (r.status === 529 || r.status >= 500) throw new ErroIA('A IA está sobrecarregada agora. Tente de novo em instantes.', 503);
      throw new ErroIA('A IA recusou o pedido: ' + (m || r.status), 400);
    }
  }
  registrarUso(k.id, j.usage || {});
  return j;
}

/**
 * pede uma resposta que vem por uma ferramenta (diagnóstico, revisão do pedido).
 * Os modelos novos não aceitam forçar a ferramenta (tool_choice "tool"/"any" dá erro 400): vai com "auto", a instrução
 * pede a ferramenta e, se a IA responder só com texto, pede de novo uma vez. Devolve o input da ferramenta (ou null).
 */
async function comFerramenta(lojaId, { max_tokens, system, ferramenta, conteudo }) {
  const nome = ferramenta.name;
  const messages = [{ role: 'user', content: conteudo }];
  const achar = (j) => (j.content || []).find((x) => x.type === 'tool_use' && x.name === nome);
  let j = await mensagens(lojaId, { max_tokens, system, tools: [ferramenta], tool_choice: { type: 'auto' }, messages });
  let t = achar(j);
  if (!t && j.stop_reason === 'end_turn') {
    messages.push({ role: 'assistant', content: j.content }, { role: 'user', content: `Entregue a resposta chamando a ferramenta ${nome}, como nas instruções.` });
    j = await mensagens(lojaId, { max_tokens, system, tools: [ferramenta], tool_choice: { type: 'auto' }, messages });
    t = achar(j);
  }
  return t ? t.input : null;
}

/**
 * uma resposta por arquivo (ex.: o diagnóstico do Início, um por loja por dia): se o arquivo existe, devolve o que está nele
 * sem chamar a IA; se alguém já está gerando, espera a mesma geração (duas pessoas abrindo juntas não pagam duas vezes).
 * gerar() devolve o objeto a guardar (ou null = não guarda e devolve null).
 */
const gerando = new Map();
async function umaVez(arq, gerar) {
  try { return { ...JSON.parse(require('fs').readFileSync(arq, 'utf8')), guardada: true }; } catch { /* ainda não tem */ }
  if (gerando.has(arq)) return gerando.get(arq);
  const p = (async () => {
    const out = await gerar();
    if (out) { require('fs').mkdirSync(require('path').dirname(arq), { recursive: true }); C.gravarAtomico(arq, JSON.stringify(out), 0o640); }
    return out;
  })().finally(() => gerando.delete(arq));
  gerando.set(arq, p);
  return p;
}

// ---------- respostas simuladas (testes e apresentação) ----------
function simular(req) {
  const usage = { input_tokens: 1200, output_tokens: 150 };
  const ultima = req.messages[req.messages.length - 1];
  const unica = Array.isArray(req.tools) && req.tools.length === 1 && ['diagnostico', 'revisar_pedido'].includes(req.tools[0].name) ? req.tools[0].name : null;
  const forcada = req.tool_choice && req.tool_choice.type === 'tool' ? req.tool_choice.name : unica;
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
  if (forcada === 'diagnostico') {
    let f = {};
    try { f = JSON.parse(String(ultima.content).replace(/^[^{]*/, '')); } catch { /* ok */ }
    const sm = f.semana || {}, e = sm.explicado_por_reais || {};
    const partes = [['movimento (atendimentos)', e.movimento_atendimentos], ['itens por atendimento', e.itens_por_atendimento], ['preço médio por item', e.preco_medio_por_item]].filter((x) => x[1] != null).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const brl = (v) => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
    return { stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 'sim2', name: 'diagnostico', input: {
      manchete: sm.variacao_pct != null ? `Os últimos 7 dias estão ${sm.variacao_pct >= 0 ? '+' : ''}${String(sm.variacao_pct).replace('.', ',')}% contra a média das 4 semanas anteriores; o que mais pesou foi ${partes.length ? partes[0][0] : 'o movimento'}.` : 'Sem base suficiente para comparar.',
      explicacoes: partes.length ? [{ titulo: 'De onde vem a diferença', porque: partes.map(([n, v]) => `${n}: ${v >= 0 ? '+' : '−'}${brl(Math.abs(v))}`).join(' · ') + '.', o_que_fazer: 'Exemplo simulado: na loja de verdade, a IA sugere a ação conforme a causa.' }] : [],
      fora_do_padrao: ((f.desconto && f.desconto.altos) || []).slice(0, 2).map((c) => ({ titulo: `Cupom ${c.cupom}: ${c.pct}% de desconto`, detalhe: 'Exemplo simulado: vale conferir o motivo com a vendedora.' })),
    } }] };
  }
  const resultados = Array.isArray(ultima.content) ? ultima.content.filter((b) => b.type === 'tool_result') : [];
  // pergunta sobre compras / notas de entrada / margem: consulta as notas (não as vendas)
  const pergunta = String((req.messages.slice().reverse().find((m) => m.role === 'user' && typeof m.content === 'string') || {}).content || '');
  if (/compra|nota de entrada|margem/i.test(pergunta) && req.tools && req.tools.some((t) => t.name === 'consultar_compras')) {
    const rc = resultados.find((b) => b.tool_use_id === 'sim-c');
    if (!rc) return { stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 'sim-c', name: 'consultar_compras', input: { periodo: { ultimos_dias: 90 }, filtro: 'todos' } }] };
    let r = {};
    try { r = JSON.parse(rc.content); } catch { /* ok */ }
    const linhas = (r.itens || []).slice(0, 5).map((x) => `- **${x.item}**: ${x.meses.map((m) => `${m.mes} R$ ${String(m.custo_medio).replace('.', ',')}`).join(' → ')} (margem ${x.margem})`).join('\n');
    return { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: `Pelas notas de entrada de ${r.periodo ? r.periodo.de : '?'} a ${r.periodo ? r.periodo.ate : '?'}: ${r.itens_com_compra || 0} itens tiveram compra e ${r.itens_sem_compra || 0} não tiveram.\n\n${linhas}\n\n*Resposta simulada na apresentação.*` }] };
  }
  if (!resultados.length && req.tools && req.tools.some((t) => t.name === 'consultar_vendas')) {
    return { stop_reason: 'tool_use', usage, content: [{ type: 'text', text: 'Vou consultar as vendas.' }, { type: 'tool_use', id: 'sim-v', name: 'consultar_vendas', input: { periodo: { ultimos_dias: 90 }, agrupar_por: 'mes' } }] };
  }
  const usouGrafico = req.messages.some((m) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_use' && b.name === 'mostrar_grafico'));
  if (!usouGrafico && req.tools && req.tools.some((t) => t.name === 'mostrar_grafico')) {
    let r = {};
    try { r = JSON.parse(resultados[0].content); } catch { /* ok */ }
    return { stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 'sim-g', name: 'mostrar_grafico', input: { tipo: 'barra', titulo: 'Faturamento por mês', formato: 'moeda', rotulos: (r.grupos || []).map((g) => g.chave), series: [{ nome: 'Faturamento', valores: (r.grupos || []).map((g) => g.faturamento) }] } }] };
  }
  let txt = 'Resposta simulada.';
  try {
    const consulta = req.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.type === 'tool_result' && b.tool_use_id === 'sim-v');
    const r = JSON.parse(consulta.content);
    const linhas = (r.grupos || []).map((g) => `- **${g.chave}**: ${g.faturamento.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em ${g.cupons} atendimentos`).join('\n');
    txt = `Nos últimos 90 dias, mês a mês:\n\n{{grafico}}\n\n${linhas}\n  - exemplo de subitem\n\n*Na apresentação a resposta é simulada: na loja de verdade a IA responde à sua pergunta com os números da loja.*`;
  } catch { /* ok */ }
  return { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: txt }] };
}

/** quem usa a IA (✨, análise do Início, revisão do pedido): só admin e franqueado (decisão do dono) */
const PERFIS_IA = ['admin', 'franqueado'];
const podeUsar = (perfil) => PERFIS_IA.includes(perfil);

module.exports = { PERFIS_IA, podeUsar, comFerramenta, umaVez, situacao, salvar, alterar, remover, testar, mensagens, chaveDaLoja, chaveAtiva, usoDoMes, custo, formatoOk, simular, ErroIA, cifrar, decifrar, MODELO, TETO_PADRAO };
