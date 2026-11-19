'use strict';
/**
 * ⭐ Sugestões da equipe para o pedido (Estoque → Sugestões): a vendedora marca com uma estrela o produto que quer
 * que venha no próximo pedido. Não muda a conta do pedido sugerido: quem faz o pedido revisa e decide.
 *   dados/<loja>/sugestoes.json = { itens: [...] }
 * Sugestão: { id, cod, desc, un, por, nome, em, recado, justificativa, situacao: tem | pouco | acabou,
 *             st: aberta | atendida | retirada, hist: [{ em, res: entrou | nao | semsite, motivo, por }],
 *             decisao: { res: 'nao', motivo, por, em } | null, fimEm, vistoEm }
 * Se o produto ainda tem na loja, a vendedora justifica (chá a granel com menos de 700 g não precisa).
 * Ao registrar o pedido (montar o carrinho ou "Registrar o pedido"): no pedido → "aguardando entrega" (a estrela continua);
 * indisponível no site → "sem estoque no site" (automático); não entrou → motivo. As duas últimas continuam para o próximo.
 * O site recusou no carrinho (favorito) → "não foi possível pedir" e volta para o próximo.
 * Entrega: valem só notas da franquia (TSB FRANQUIAS) emitidas a partir do dia do pedido. A primeira delas a entrar no
 * AppNext e as que entrarem até 5 dias depois (pela data de entrada) formam a entrega. Produto nelas → "chegou na loja" e a
 * estrela sai; passou a janela sem ele → "não veio no pedido" e volta para o próximo. Se chegar depois, em qualquer nota da
 * franquia posterior ao pedido, também vira "chegou". Sem nota da franquia em 30 dias → volta. O histórico fica guardado.
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
  // o produto já foi pedido e está aguardando entrega: esta estrela segue junto (sai quando ele chegar)
  const junto = d.itens.find((x) => x.st === 'aberta' && x.cod === cod && x.aguardando);
  if (junto) { s.aguardando = { ...junto.aguardando }; s.hist.push({ em: junto.aguardando.em, res: 'pedido', motivo: 'já estava no pedido', por: junto.aguardando.por }); }
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
  const abertas = d.itens.filter((s) => s.st === 'aberta' && s.cod === String(cod) && !s.aguardando);
  if (!abertas.length) return { erro: 'Nenhuma sugestão aberta para este produto (ou ele já está aguardando entrega).' };
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
  // o mesmo produto pode vir em mais de uma linha (ex.: no pedido obrigatório e a mais no carrinho): soma e vale a melhor situação
  const porCod = new Map();
  for (const x of (Array.isArray(itens) ? itens : []).slice(0, 5000)) {
    if (!x) continue;
    const k = String(x.cod), a = porCod.get(k), pedir = Number(x.pedir) || 0;
    const vai = pedir > 0 && ['ok', 'sem', 'obrig'].includes(x.site);
    if (!a) porCod.set(k, { cod: k, pedir: vai ? pedir : 0, site: vai ? 'ok' : x.site });
    else if (vai) { a.pedir += pedir; a.site = 'ok'; }
  }
  const em = new Date().toISOString(), hoje = C.diaSP();
  const n = { pedido: 0, semsite: 0, nao: 0 };
  const aguardam = new Set(d.itens.filter((s) => s.st === 'aberta' && s.aguardando).map((s) => s.cod));
  for (const s of d.itens) {
    if (s.st !== 'aberta' || s.aguardando || aguardam.has(s.cod)) continue; // já pedido: espera a nota
    const ult = (s.hist || [])[(s.hist || []).length - 1];
    const x = porCod.get(s.cod);
    const vai = x && x.pedir > 0 && x.site === 'ok';
    // registrar de novo no mesmo dia (montar o carrinho e depois "Registrar"): só muda quem passou a ir no pedido
    if (ult && ['nao', 'semsite'].includes(ult.res) && C.diaSP(ult.em) === hoje && !vai) continue;
    let h;
    if (vai) { h = { em, res: 'pedido', motivo: '', por }; s.aguardando = { em, por, qtd: x.pedir }; }
    else if (x && (x.site === 'indisp' || x.site === 'fora')) h = { em, res: 'semsite', motivo: 'Sem estoque no site da franquia (automático)', por };
    else h = { em, res: 'nao', motivo: (s.decisao && s.decisao.motivo) || 'Não entrou desta vez', por };
    (s.hist = s.hist || []).push(h);
    s.decisao = null;
    n[h.res]++;
  }
  gravar(id, d);
  return { ok: n };
}

const FRANQUIA = /TSB\s*FRANQUIAS/i;
const JANELA_DIAS = 5, SEM_NOTA_DIAS = 30;
const somaDias = (dia, n) => new Date(Date.parse(dia + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const diaBR = (iso) => C.diaSP(iso);
const dm = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const STATUS_CARRINHO = { erro: 'erro ao pôr no carrinho', sem_estoque: 'sem estoque no fornecedor', recusado: 'o site recusou', indisponivel: 'indisponível no site', nao_encontrado: 'o site não achou o produto', acima_do_maximo: 'acima do máximo do site' };

/** fim do carrinho montado pelo favorito: o que o site não aceitou volta para o próximo pedido */
function resultadoCarrinho(id, itens) {
  const d = ler(id);
  const ruim = new Map((Array.isArray(itens) ? itens : []).filter((i) => STATUS_CARRINHO[i.status]).map((i) => [String(i.cod), i]));
  if (!ruim.size) return { ok: 0 };
  const em = new Date().toISOString();
  let n = 0;
  for (const s of d.itens) {
    const x = ruim.get(s.cod);
    if (s.st !== 'aberta' || !s.aguardando || !x || Date.now() - Date.parse(s.aguardando.em) > 3 * 864e5) continue;
    (s.hist = s.hist || []).push({ em, res: 'naopediu', motivo: `Não foi possível pedir: ${STATUS_CARRINHO[x.status]}` });
    delete s.aguardando; s.decisao = null; n++;
  }
  if (n) gravar(id, d);
  return { ok: n };
}

/**
 * Batimento com as notas de entrada (ES.notas): só notas da franquia emitidas a partir do dia do pedido.
 * A entrega = a primeira delas + as que chegarem até JANELA_DIAS depois. hoje: AAAA-MM-DD (testes).
 */
function avaliarNotas(id, notas, hoje = C.diaSP()) {
  const d = ler(id);
  // pedidas: aguardando entrega, ou que já foram num pedido e voltaram (o produto ainda pode chegar depois)
  const pedidas = d.itens.filter((s) => s.st === 'aberta' && (s.aguardando || (s.hist || []).some((x) => x.res === 'pedido')));
  if (!pedidas.length) return { mudou: 0 };
  // emi = emissão (vale só a partir do dia do pedido); ent = entrada no AppNext (quando chegou na loja: a janela conta daqui)
  const dia10 = (v) => String(v || '').slice(0, 10);
  const fr = ((notas && notas.notas) || [])
    .filter((n) => FRANQUIA.test(String(n.fornecedor || '')) && !/devolu|troca/i.test(n.motivo || '') && /^conclu/i.test(n.status || ''))
    .map((n) => ({ nf: `${n.nf ?? ''}${n.serie ? '/' + n.serie : ''}`, emi: dia10(n.emissao || n.entrada), ent: dia10(n.entrada || n.emissao), cods: new Set((n.itens || []).map((i) => String(i.cod))) }))
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n.emi) && /^\d{4}-\d{2}-\d{2}$/.test(n.ent))
    .sort((a, b) => (a.ent < b.ent ? -1 : a.ent > b.ent ? 1 : 0));
  const em = new Date().toISOString();
  let mudou = 0;
  const chegou = (s, n) => {
    s.hist.push({ em, res: 'chegou', motivo: `NF ${n.nf} de ${dm(n.ent)}`, nf: n.nf, dia: n.ent });
    Object.assign(s, { st: 'atendida', fimEm: em, chegou: { nf: n.nf, dia: n.ent } });
    delete s.aguardando; mudou++;
  };
  for (const s of pedidas) {
    if (!s.aguardando) {
      // já voltou para o próximo pedido, mas o produto chegou depois numa nota da franquia emitida a partir do 1º pedido
      const ped1 = diaBR(s.hist.find((x) => x.res === 'pedido').em);
      const tarde = fr.find((n) => n.emi > ped1 && n.cods.has(s.cod));
      if (tarde) chegou(s, tarde);
      continue;
    }
    const pedDia = diaBR(s.aguardando.em);
    const depois = fr.filter((n) => n.emi > pedDia); // emitida DEPOIS do dia do pedido: a nota da manhã do pedido é do pedido anterior
    if (!depois.length) {
      if (hoje > somaDias(pedDia, SEM_NOTA_DIAS)) { s.hist.push({ em, res: 'naoveio', motivo: `Nenhuma nota da franquia em ${SEM_NOTA_DIAS} dias depois do pedido` }); delete s.aguardando; s.decisao = null; mudou++; }
      continue;
    }
    const fimJanela = somaDias(depois[0].ent, JANELA_DIAS);
    const achou = depois.find((n) => n.ent <= fimJanela && n.cods.has(s.cod));
    if (achou) chegou(s, achou);
    else if (hoje > fimJanela) {
      const entrega = depois.filter((n) => n.ent <= fimJanela);
      s.hist.push({ em, res: 'naoveio', motivo: `Não veio na entrega de ${dm(depois[0].ent)} (NF ${entrega.map((n) => n.nf).join(', ')}): indisponível no fornecedor` });
      delete s.aguardando; s.decisao = null; mudou++;
    }
  }
  if (mudou) gravar(id, d);
  return { mudou };
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
  const semLogin = (x) => (x ? { ...x, por: undefined } : x);
  return xs.map((s) => {
    const base = { ...s, novo: s.por === por && novo(s), equipe: s.st === 'aberta' ? abertasPorCod.get(s.cod) || 1 : null };
    if (todos) return base;
    // quem só sugere vê o andamento, sem quantidade pedida nem o login de quem decidiu
    return { ...base, por: undefined, aguardando: s.aguardando ? { em: s.aguardando.em } : undefined, decisao: undefined, hist: (s.hist || []).map(semLogin) };
  });
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
    if (s.aguardando) g.aguardando = s.aguardando;
  }
  return [...m.values()].sort((a, b) => b.pessoas.length - a.pessoas.length || a.desde.localeCompare(b.desde));
}

/** estoque de agora para a tela: quem decide o pedido vê a quantidade; quem só sugere, a situação (tem / pouco / acabou) */
function comEstoque(itens, estoque, todos) {
  const porCod = new Map(((estoque && estoque.itens) || []).map((i) => [String(i.cod), i]));
  return itens.map((s) => {
    const it = porCod.get(String(s.cod));
    return { ...s, agora: it ? { situacao: situacao(it), un: it.un || '', ...(todos ? { qtd: Number(it.qtd) || 0 } : {}) } : null };
  });
}

module.exports = { comEstoque, ler, situacao, precisaJustificar, buscar, criar, retirar, decidir, fechar, resultadoCarrinho, avaliarNotas, visto, lista, paraPedido, MOTIVOS, POUCO_KG };
