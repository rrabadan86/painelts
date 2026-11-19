'use strict';
/**
 * ⭐ Sugestões da equipe para o pedido (Estoque → Sugestões): a vendedora marca com uma estrela o produto que quer
 * que venha no próximo pedido. Não muda a conta do pedido sugerido: quem faz o pedido revisa e decide.
 *   dados/<loja>/sugestoes.json = { itens: [...] }
 * Sugestão: { id, cod, desc, un, por, nome, em, recado, justificativa, situacao: tem | pouco | acabou,
 *             st: aberta | atendida | retirada, hist: [{ em, res: entrou | nao | semsite, motivo, por }],
 *             decisao: { res: 'nao', motivo, por, em } | null, fimEm, vistoEm }
 * Se o produto ainda tem na loja, a vendedora justifica (chá a granel com menos de 700 g não precisa).
 * Ao registrar o pedido (montar o carrinho ou "Registrar o pedido"): entrou → atendida; indisponível no site →
 * "sem estoque no site" (automático) e continua aberta; não entrou → motivo e continua aberta para o próximo pedido.
 * O histórico de cada pedido fica guardado.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');

const arq = (id) => path.join(C.pastaLoja(id), 'sugestoes.json');
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const ESQ = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const MAX = 3000;
const POUCO_KG = 0.7; // chá a granel abaixo disso não precisa justificar
const MOTIVOS = ['Ainda temos estoque', 'Vende pouco', 'Fica para o próximo pedido', 'Passou do valor do pedido'];

function ler(id) {
  try { const j = JSON.parse(fs.readFileSync(arq(id), 'utf8')); return { itens: Array.isArray(j.itens) ? j.itens : [] }; } catch { return { itens: [] }; }
}
function gravar(id, d) {
  if (d.itens.length > MAX) { const abertas = d.itens.filter((s) => s.st === 'aberta'); const outras = d.itens.filter((s) => s.st !== 'aberta'); d.itens = [...outras.slice(-(MAX - abertas.length)), ...abertas]; }
  fs.mkdirSync(path.dirname(arq(id)), { recursive: true });
  C.gravarAtomico(arq(id), JSON.stringify(d), 0o640);
}

const ehKg = (un) => /^kg$/i.test(String(un || ''));
/** tem / pouco (chá a granel abaixo de 700 g) / acabou — a vendedora vê só isso, nunca a quantidade nem o custo */
function situacao(it) {
  const q = Number(it && it.qtd) || 0;
  if (q <= 0) return 'acabou';
  if (ehKg(it.un) && q < POUCO_KG) return 'pouco';
  return 'tem';
}
const precisaJustificar = (sit) => sit === 'tem';

/** busca no estoque da loja (o que se compra no pedido): nome ou código */
function buscar(estoque, q) {
  const qn = ESQ(q), qd = String(q || '').trim();
  if (qn.length < 2) return [];
  return ((estoque && estoque.itens) || [])
    .filter((i) => i.desc && (ESQ(i.desc).includes(qn) || (qd.length >= 3 && String(i.cod).startsWith(qd))))
    .slice(0, 15)
    .map((i) => { const s = situacao(i); return { cod: String(i.cod), desc: i.desc, un: i.un || '', situacao: s, justificar: precisaJustificar(s) }; });
}

function criar(id, b, por, nome, estoque) {
  const cod = txt(b && b.cod, 30);
  const it = ((estoque && estoque.itens) || []).find((i) => String(i.cod) === cod);
  if (!it) return { erro: 'Produto não encontrado no estoque da loja.' };
  const d = ler(id);
  if (d.itens.some((s) => s.st === 'aberta' && s.cod === cod && s.por === por)) return { erro: 'Você já marcou este produto: ele está esperando o próximo pedido.' };
  const sit = situacao(it);
  const justificativa = txt(b.justificativa, 300);
  if (precisaJustificar(sit) && justificativa.length < 5) return { erro: 'Este produto ainda tem na loja: conte por que pedir mais (ex.: "cliente leva sempre 3").' };
  const s = { id: crypto.randomBytes(6).toString('hex'), cod, desc: it.desc, un: it.un || '', por, nome: txt(nome || por, 60), em: new Date().toISOString(),
    recado: txt(b.recado, 300), justificativa: precisaJustificar(sit) ? justificativa : '', situacao: sit, st: 'aberta', hist: [], decisao: null };
  d.itens.push(s);
  gravar(id, d);
  return { ok: s };
}

function retirar(id, sid, por, podeTodos) {
  const d = ler(id);
  const s = d.itens.find((x) => x.id === sid);
  if (!s) return { erro: 'Sugestão não encontrada.' };
  if (s.por !== por && !podeTodos) return { erro: 'Só quem marcou pode tirar a estrela.' };
  if (s.st !== 'aberta') return { erro: 'Esta sugestão já foi encerrada.' };
  Object.assign(s, { st: 'retirada', fimEm: new Date().toISOString(), retiradaPor: por });
  gravar(id, d);
  return { ok: s };
}

/** decisão de quem faz o pedido para um produto: "Não agora" com motivo (res 'nao') ou volta a ficar sem decisão (res null) */
function decidir(id, cod, b, por) {
  const d = ler(id);
  const abertas = d.itens.filter((s) => s.st === 'aberta' && s.cod === String(cod));
  if (!abertas.length) return { erro: 'Nenhuma sugestão aberta para este produto.' };
  const dec = b && b.res === 'nao' ? { res: 'nao', motivo: txt(b.motivo, 120) || 'Não entrou desta vez', por, em: new Date().toISOString() } : null;
  for (const s of abertas) s.decisao = dec;
  gravar(id, d);
  return { ok: dec };
}

/**
 * Registra o pedido nas sugestões abertas. itens: [{ cod, pedir, site }] do pedido como está na tela
 * (site: ok | sem | indisp | fora). Devolve quantas entraram, ficaram sem estoque no site e não entraram.
 */
function fechar(id, itens, por) {
  const d = ler(id);
  const porCod = new Map((Array.isArray(itens) ? itens : []).slice(0, 5000).map((x) => [String(x && x.cod), x || {}]));
  const em = new Date().toISOString();
  const n = { entrou: 0, semsite: 0, nao: 0 };
  for (const s of d.itens) {
    if (s.st !== 'aberta') continue;
    const x = porCod.get(s.cod);
    let h;
    if (x && Number(x.pedir) > 0 && (x.site === 'ok' || x.site === 'sem')) { h = { em, res: 'entrou', motivo: '', por }; s.st = 'atendida'; s.fimEm = em; }
    else if (x && (x.site === 'indisp' || x.site === 'fora')) h = { em, res: 'semsite', motivo: 'Sem estoque no site da franquia (automático)', por };
    else h = { em, res: 'nao', motivo: (s.decisao && s.decisao.motivo) || 'Não entrou desta vez', por };
    (s.hist = s.hist || []).push(h);
    s.decisao = null;
    n[h.res]++;
  }
  gravar(id, d);
  return { ok: n };
}

/** a vendedora viu as respostas */
function visto(id, por) {
  const d = ler(id);
  const em = new Date().toISOString();
  let mudou = false;
  for (const s of d.itens) if (s.por === por && novo(s)) { s.vistoEm = em; mudou = true; }
  if (mudou) gravar(id, d);
  return { ok: true };
}
const ultima = (s) => (s.hist && s.hist.length ? s.hist[s.hist.length - 1] : null);
const novo = (s) => { const u = ultima(s); return !!u && (!s.vistoEm || u.em > s.vistoEm); };

/** lista para a tela: quem não decide o pedido vê só as próprias (e quantas pessoas da equipe marcaram o mesmo produto) */
function lista(id, por, todos) {
  const d = ler(id);
  const abertasPorCod = new Map();
  for (const s of d.itens) if (s.st === 'aberta') abertasPorCod.set(s.cod, (abertasPorCod.get(s.cod) || 0) + 1);
  const xs = (todos ? d.itens : d.itens.filter((s) => s.por === por)).slice(-500).reverse();
  return xs.map((s) => ({ ...s, novo: s.por === por && novo(s), equipe: s.st === 'aberta' ? abertasPorCod.get(s.cod) || 1 : null, ...(todos ? {} : { por: undefined }) }));
}

/** para o Pedido: as abertas agrupadas por produto */
function paraPedido(id) {
  const m = new Map();
  for (const s of ler(id).itens) {
    if (s.st !== 'aberta') continue;
    const g = m.get(s.cod) || m.set(s.cod, { cod: s.cod, desc: s.desc, un: s.un, pessoas: [], notas: [], desde: s.em, pedidos: 0, decisao: null }).get(s.cod);
    g.pessoas.push(s.nome || s.por);
    g.notas.push({ nome: s.nome || s.por, recado: s.recado, justificativa: s.justificativa, situacao: s.situacao, em: s.em });
    if (s.em < g.desde) g.desde = s.em;
    g.pedidos = Math.max(g.pedidos, (s.hist || []).length);
    if (s.decisao) g.decisao = s.decisao;
  }
  return [...m.values()].sort((a, b) => b.pessoas.length - a.pessoas.length || a.desde.localeCompare(b.desde));
}

module.exports = { ler, situacao, precisaJustificar, buscar, criar, retirar, decidir, fechar, visto, lista, paraPedido, MOTIVOS, POUCO_KG };
