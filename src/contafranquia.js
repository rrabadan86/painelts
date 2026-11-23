'use strict';
/**
 * Conta com a franquia: créditos que a loja tem a receber do fornecedor (franquia) e onde foram compensados.
 *
 * Créditos: cada NF-e de DEVOLUÇÃO autorizada (XML da loja, finalidade "Devolução"), ligada à nota de entrada
 *           que ela devolve (refNFe) — o fornecedor do crédito é o fornecedor dessa nota.
 * Baixas:   o DESCONTO das notas de entrada seguintes do mesmo fornecedor. Regra da franquia: cada devolução é
 *           descontada INTEIRA numa única nota; uma nota pode trazer o desconto de várias devoluções.
 *           O painel procura, entre os créditos em aberto emitidos antes da nota, a combinação que fecha o desconto
 *           (tolerância de centavos). Achou uma só combinação → compensa sozinho. Não fechou → fica para conferir.
 * À mão:    ligar uma nota a créditos, marcar crédito como compensado de outro jeito (boleto) ou cancelado,
 *           e marcar um desconto como "não é de devolução" (promoção etc.).
 *   dados/<loja>/conta-franquia.json  { manual: { credito: {nota|como, obs, por, em} }, ignorar: { notaId: {por, em, obs} } }
 *   compensada à mão (FRQ-COMP): em nota de entrada → {nota: id} (igual ao "ligar"; sem a nota no painel, {como:'nota', nf: texto});
 *   nos royalties → {como:'royalties', mes:'AAAA-MM'}; de outro jeito → {como:'outro'}. Registros antigos (boleto, texto livre) continuam valendo.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const PRAZO_DIAS = 30;       // sem desconto depois disso = atrasado
const TOL = 0.06;            // diferença aceita por crédito (arredondamento do rateio)
const MAX_COMB = 18;         // créditos em aberto testados por nota (combinações)

const arq = (id) => path.join(C.pastaLoja(id), 'conta-franquia.json');
const ler = (id) => { try { const j = JSON.parse(fs.readFileSync(arq(id), 'utf8')); return { manual: j.manual || {}, ignorar: j.ignorar || {}, recusar: j.recusar || {}, royalties: j.royalties || [] }; } catch { return { manual: {}, ignorar: {}, recusar: {}, royalties: [] }; } };
const gravar = (id, d) => { fs.mkdirSync(C.pastaLoja(id), { recursive: true }); C.gravarAtomico(arq(id), JSON.stringify(d), 0o640); };
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const dia = (iso) => String(iso || '').slice(0, 10);
const dias = (a, b) => Math.round((Date.parse(dia(b) + 'T12:00:00Z') - Date.parse(dia(a) + 'T12:00:00Z')) / 864e5);

/** desconto da nota de entrada (lido pelo robô); null = o AppNext não informou */
function descontoDaNota(n) {
  const cab = n.desconto != null && Number.isFinite(+n.desconto) ? r2(n.desconto) : null;
  const itens = (n.itens || []).filter((i) => i.desc != null);
  const nosItens = itens.length ? r2(itens.reduce((s, i) => s + (+i.desc || 0), 0)) : null;
  // a franquia às vezes manda 0 no cabeçalho e o desconto diluído nos itens: vale o maior dos dois
  if (cab == null) return nosItens;
  return nosItens != null ? Math.max(cab, nosItens) : cab;
}

/** créditos: NF-e de devolução autorizadas (XML) + as emitidas pelo painel cujo XML ainda não chegou */
function creditos(saidas, compras, devsPainel) {
  const porChave = new Map((compras || []).filter((n) => n.chave).map((n) => [n.chave, n]));
  const out = [], vistas = new Set();
  // devolução do painel pelo número da NF-e: quando o XML chega, o crédito troca de id (dev-<id> → chave); o apelido leva o que foi feito à mão
  const devPorNum = new Map();
  for (const d of devsPainel || []) { const e = d.nfe && (d.nfe.emitida || (d.nfe.numero ? d.nfe : null)); if (e && e.numero) devPorNum.set(String(e.numero), 'dev-' + d.id); }
  for (const s of saidas || []) {
    if (s.finalidade !== 'Devolução') continue;
    vistas.add(String(s.numero)); // cancelada também: a do painel com esse número não volta como crédito
    if (s.situacao === 'cancelada') continue;
    const origem = (s.refs || []).map((k) => porChave.get(k)).find(Boolean) || null;
    out.push({ id: s.chave, apelido: devPorNum.get(String(s.numero)) || null, numero: s.numero, serie: s.serie, emissao: dia(s.emissao), valor: r2(s.valor), fornecedor: origem ? origem.fornecedor : (s.dest && s.dest.nome) || '', notaOrigem: origem ? { id: origem.id, nf: origem.nf } : null, xml: true });
  }
  for (const d of devsPainel || []) {
    const e = d.nfe && (d.nfe.emitida || (d.nfe.numero ? d.nfe : null));
    if (!e || !e.numero || vistas.has(String(e.numero)) || (d.nfe && (d.nfe.estado === 'cancelada' || d.nfe.situacao === 'cancelada'))) continue;
    vistas.add(String(e.numero));
    out.push({ id: 'dev-' + d.id, numero: e.numero, serie: e.serie || 1, emissao: dia(d.nfe.fim || d.nfe.autorizadaEm || d.em), valor: r2(d.nfe.total ?? d.total), fornecedor: (d.nota && d.nota.fornecedor) || '', notaOrigem: d.nota ? { id: d.nota.id, nf: d.nota.nf } : null, xml: false });
  }
  return out.sort((a, b) => a.emissao.localeCompare(b.emissao) || (a.numero || 0) - (b.numero || 0));
}

/** a combinação de créditos que soma o alvo; [] = nenhuma; mais de uma → devolve a primeira e marca "ambígua" */
function combinar(cands, alvo) {
  const n = Math.min(cands.length, MAX_COMB);
  const achadas = [];
  const buscar = (k, soma, usados) => {
    if (achadas.length > 1) return;
    // tolerância: arredondamento do rateio, no máximo 10 centavos
    if (Math.abs(soma - alvo) <= Math.min(TOL * Math.max(1, usados.length), 0.10)) { if (usados.length) achadas.push(usados.slice()); return; }
    if (k >= n || soma > alvo + TOL * n) return;
    usados.push(cands[k]); buscar(k + 1, soma + cands[k].valor, usados); usados.pop();
    buscar(k + 1, soma, usados);
  };
  buscar(0, 0, []);
  return { comb: achadas[0] || [], ambigua: achadas.length > 1 };
}

/**
 * sem combinação exata: as devoluções mais antigas cuja soma chega mais perto do desconto SEM passar
 * (o desconto pode ter outra coisa junto). Empate → as mais antigas.
 */
function parcial(cands, alvo) {
  const n = Math.min(cands.length, MAX_COMB);
  let melhor = [], somaM = 0;
  const buscar = (k, soma, usados) => {
    if (soma > alvo + TOL * Math.max(1, usados.length)) return;
    if (soma > somaM + 0.005) { somaM = soma; melhor = usados.slice(); }
    if (k >= n) return;
    usados.push(cands[k]); buscar(k + 1, soma + cands[k].valor, usados); usados.pop();
    buscar(k + 1, soma, usados);
  };
  buscar(0, 0, []);
  return melhor;
}

/**
 * a conta: { creditos: [{…, situacao: aberto|atrasado|compensado|manual, compensadoEm?: {nota, como}}], notas: [notas com desconto e o que compensaram],
 *            resumo: { aberto, atrasado, compensado, semPar } }
 */
function conta(id, { saidas, compras, devsPainel, hoje = C.diaSP() }) {
  const m = ler(id);
  const cr = creditos(saidas, compras, devsPainel);
  const porId = new Map(cr.map((c) => [c.id, c]));
  const doApelido = new Map(cr.filter((c) => c.apelido).map((c) => [c.apelido, c.id]));
  const usado = new Map(); // crédito → { nota, auto }
  // 1) à mão primeiro (o que foi marcado antes do XML chegar, pelo id antigo dev-<id>, continua valendo)
  for (const [cid0, x] of Object.entries(m.manual)) {
    const cid = porId.has(cid0) ? cid0 : doApelido.get(cid0);
    if (!cid || usado.has(cid)) continue;
    usado.set(cid, x.nota ? { nota: x.nota, como: 'nota', manual: true, por: x.por, em: x.em, obs: x.obs || '' } : { como: x.como || 'outro', manual: true, por: x.por, em: x.em, obs: x.obs || '', nf: x.nf || null, mes: x.mes || null });
  }
  // 2) notas de entrada com desconto, da mais antiga para a mais nova
  const comDesc = (compras || []).map((n) => ({ n, desc: descontoDaNota(n), quando: dia(n.emissao || n.entrada) }))
    .filter((x) => x.desc != null && x.desc > 0.5).sort((a, b) => a.quando.localeCompare(b.quando));
  const notas = [];
  for (const { n, desc, quando } of comDesc) {
    const ref = { id: n.id, nf: n.nf, emissao: dia(n.emissao), entrada: dia(n.entrada), fornecedor: n.fornecedor, desconto: desc, total: n.total };
    if (m.ignorar[n.id]) { notas.push({ ...ref, situacao: 'ignorada', obs: m.ignorar[n.id].obs || '', creditos: [] }); continue; }
    const manuais = [...usado].filter(([, u]) => u.nota === n.id).map(([cid]) => porId.get(cid)).filter(Boolean);
    if (manuais.length) { notas.push({ ...ref, situacao: 'manual', creditos: manuais.map((c) => c.id), soma: r2(manuais.reduce((s, c) => s + c.valor, 0)) }); continue; }
    const cands = cr.filter((c) => !usado.has(c.id) && c.emissao <= quando && (!c.fornecedor || !n.fornecedor || c.fornecedor === n.fornecedor));
    const recusada = !!m.recusar[n.id];
    const { comb, ambigua } = combinar(cands, desc);
    const reservar = (cs, situ) => {
      for (const c of cs) usado.set(c.id, { nota: n.id, como: 'nota', auto: true, confirmar: situ !== 'compensou' });
      const soma = r2(cs.reduce((s, c) => s + c.valor, 0));
      notas.push({ ...ref, situacao: situ, ambigua: situ === 'conferir', creditos: cs.map((c) => c.id), soma, sobra: r2(desc - soma) });
    };
    if (comb.length && !ambigua) reservar(comb, 'compensou');               // fecha certinho, uma combinação só
    else if (recusada) notas.push({ ...ref, situacao: cands.length ? 'sem_par' : 'sem_credito', recusada: true, creditos: [] });
    else if (comb.length) reservar(comb, 'conferir');                      // fecha, mas há mais de uma combinação: as mais antigas
    else {
      const p = parcial(cands, desc);
      if (p.length) reservar(p, 'sugestao');                               // não fecha: as mais antigas que cabem no desconto
      else notas.push({ ...ref, situacao: cands.length ? 'sem_par' : 'sem_credito', creditos: [] });
    }
  }
  const notaPorId = new Map(notas.map((x) => [x.id, x]));
  const lista = cr.map((c) => {
    const u = usado.get(c.id);
    if (u) {
      const nt = u.nota ? notaPorId.get(u.nota) || (compras || []).find((x) => x.id === u.nota) : null;
      return { ...c, situacao: u.manual ? 'manual' : u.confirmar ? 'confirmar' : 'compensado', compensado: { como: u.como, nota: nt ? { id: nt.id, nf: nt.nf, emissao: dia(nt.emissao) } : null, nf: u.nf || null, mes: u.mes || null, obs: u.obs || '', por: u.por || null, em: u.em || null, auto: !!u.auto, ambigua: !!(nt && nt.ambigua) } };
    }
    const d = dias(c.emissao, hoje);
    return { ...c, situacao: d > PRAZO_DIAS ? 'atrasado' : 'aberto', dias: d };
  });
  const soma = (f) => r2(lista.filter(f).reduce((s, c) => s + c.valor, 0));
  return {
    creditos: lista.reverse(), notas: notas.reverse(), prazo: PRAZO_DIAS, entradas: entradas(compras), mesesRoyalties: mesesRoyalties(hoje),
    descontoLido: (compras || []).some((n) => descontoDaNota(n) != null),
    resumo: {
      aberto: soma((c) => c.situacao === 'aberto'), atrasado: soma((c) => c.situacao === 'atrasado'),
      compensado: soma((c) => c.situacao === 'compensado' || c.situacao === 'manual'), confirmar: soma((c) => c.situacao === 'confirmar'),
      nAtrasado: lista.filter((c) => c.situacao === 'atrasado').length, nAberto: lista.filter((c) => c.situacao === 'aberto').length,
      nConfirmar: lista.filter((c) => c.situacao === 'confirmar').length,
      conferir: notas.filter((x) => x.situacao === 'sem_par' || x.situacao === 'conferir' || x.situacao === 'sugestao').length,
    },
  };
}

/**
 * notas de entrada para a pessoa escolher em qual a devolução foi descontada ("Compensada em nota fiscal de entrada"):
 * as mais recentes primeiro, só o cabeçalho (sem itens nem custo de produto)
 */
const MAX_ENTRADAS = 500;
function entradas(compras) {
  return (compras || []).filter((n) => n && n.id && n.nf != null)
    .map((n) => ({ id: String(n.id), nf: n.nf, emissao: dia(n.emissao || n.entrada), entrada: dia(n.entrada || n.emissao), fornecedor: n.fornecedor || '', total: n.total != null ? r2(n.total) : null, desconto: descontoDaNota(n) }))
    .sort((a, b) => (b.emissao || '').localeCompare(a.emissao || '') || String(b.nf).localeCompare(String(a.nf)))
    .slice(0, MAX_ENTRADAS);
}

/** os 12 meses que a pessoa pode escolher em "Compensada nos royalties": o atual e os 11 anteriores (AAAA-MM, o mais novo primeiro) */
const MESES_ROYALTIES = 12;
function mesesRoyalties(hoje = C.diaSP()) {
  const atual = dia(hoje).slice(0, 7);
  return YM.test(atual) ? Array.from({ length: MESES_ROYALTIES }, (_, k) => somaMes(atual, -k)) : [];
}

/** número da NF só com os dígitos, sem zeros à esquerda (para achar "000019120" = 19120) */
const nfChave = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/**
 * Como a devolução foi compensada (FRQ-FRQ-COMP-01…04): confere o que chega da tela e devolve o registro a gravar.
 *  nota:      { nota: id } de uma nota de entrada da loja (o mesmo vínculo de "ligar" e do automático) ou,
 *             se a nota não está no painel, { nf } digitado (até 20 caracteres, com algum número) — se esse número
 *             for de uma nota da loja, liga à nota.
 *  royalties: { mes: 'AAAA-MM' } entre o mês atual e os 11 anteriores.
 *  outro:     só a observação.
 * → { reg } ou { erro }
 */
function compensacao(b, { compras = [], hoje = C.diaSP() } = {}) {
  const como = String(b.como || '');
  if (como === 'nota') {
    if (b.nota != null && b.nota !== '') {
      const n = (compras || []).find((x) => x && String(x.id) === String(b.nota));
      if (!n) return { erro: 'Essa nota de entrada não está no painel desta loja. Escolha outra ou digite o número da NF.' };
      return { reg: { como: 'nota', nota: String(n.id) } };
    }
    const nf = String(b.nf ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!nf) return { erro: 'Escolha a nota fiscal de entrada ou digite o número da NF.' };
    if (nf.length > 20 || !/^[0-9A-Za-z.\/ -]+$/.test(nf) || !/\d/.test(nf)) return { erro: 'Número da NF inválido: use só o número (até 20 caracteres).' };
    const ch = nfChave(nf);
    const iguais = (compras || []).filter((x) => x && x.id && nfChave(x.nf) === ch);
    if (iguais.length === 1) return { reg: { como: 'nota', nota: String(iguais[0].id) } };
    return { reg: { como: 'nota', nf } };
  }
  if (como === 'royalties') {
    const mes = String(b.mes || '');
    if (!YM.test(mes) || !mesesRoyalties(hoje).includes(mes)) return { erro: 'Escolha o mês de referência dos royalties (um dos últimos 12 meses).' };
    return { reg: { como: 'royalties', mes } };
  }
  if (como === 'outro') return { reg: { como: 'outro' } };
  return { erro: 'Escolha como a devolução foi compensada.' };
}

/**
 * ações à mão: ligar (nota + créditos), compensar (como: nota/royalties/outro — ver `compensacao`), cancelar, desfazer (crédito),
 * ignorar/considerar (nota). ctx: { compras, hoje, jaNaNota(id) → créditos que o painel já tinha compensado sozinho naquela nota }
 */
function acao(id, b, por, ctx = {}) {
  const m = ler(id);
  const em = new Date().toISOString();
  const obs = String(b.obs || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
  const cid = (x) => /^[\w-]{3,60}$/.test(String(x || ''));
  if (b.tipo === 'ligar') {
    if (!b.nota || !Array.isArray(b.creditos) || !b.creditos.length || !b.creditos.every(cid)) return { erro: 'Escolha a nota e os créditos.' };
    for (const [c, x] of Object.entries(m.manual)) if (x.nota === b.nota) delete m.manual[c]; // a nova escolha substitui a anterior
    for (const c of b.creditos) m.manual[c] = { nota: String(b.nota).slice(0, 60), obs, por, em };
    delete m.ignorar[b.nota]; delete m.recusar[b.nota];
  } else if (b.tipo === 'compensar') {
    if (!cid(b.credito)) return { erro: 'Crédito inválido.' };
    const r = compensacao(b, ctx);
    if (r.erro) return r;
    // ligar a uma nota que já tinha devoluções compensadas sozinhas (valor exato): elas continuam nessa nota
    if (r.reg.nota && ctx.jaNaNota) for (const c of ctx.jaNaNota(r.reg.nota) || []) if (c !== b.credito && !m.manual[c] && cid(c)) m.manual[c] = { nota: r.reg.nota, obs: 'automático', por, em };
    m.manual[b.credito] = { ...r.reg, obs, por, em };
  } else if (b.tipo === 'cancelar') {
    if (!cid(b.credito)) return { erro: 'Crédito inválido.' };
    m.manual[b.credito] = { como: 'cancelado', obs, por, em };
  } else if (b.tipo === 'desfazer') {
    if (!cid(b.credito)) return { erro: 'Crédito inválido.' };
    delete m.manual[b.credito];
  } else if (b.tipo === 'confirmar') {
    if (!b.nota || !Array.isArray(b.creditos) || !b.creditos.length || !b.creditos.every(cid)) return { erro: 'Nada para confirmar.' };
    for (const c of b.creditos) m.manual[c] = { nota: String(b.nota).slice(0, 60), obs: obs || 'confirmado', por, em };
    delete m.recusar[b.nota];
  } else if (b.tipo === 'recusar') {
    if (!b.nota) return { erro: 'Nota inválida.' };
    m.recusar[String(b.nota).slice(0, 60)] = { obs, por, em };
  } else if (b.tipo === 'ignorar') {
    if (!b.nota) return { erro: 'Nota inválida.' };
    m.ignorar[String(b.nota).slice(0, 60)] = { obs, por, em };
    for (const [c, x] of Object.entries(m.manual)) if (x.nota === b.nota) delete m.manual[c];
  } else if (b.tipo === 'considerar') {
    delete m.ignorar[String(b.nota || '')]; delete m.recusar[String(b.nota || '')];
    for (const [c, x] of Object.entries(m.manual)) if (x.nota === b.nota) delete m.manual[c];
  } else return { erro: 'Ação inválida.' };
  gravar(id, m);
  return { ok: true };
}

// ---------- prêmios de fidelidade: a franquia devolve PCT_PREMIO do custo dos produtos resgatados, como desconto nos royalties ----------
const PCT_PREMIO = 0.5;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const somaMes = (ym, k) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + k, 1)); return d.toISOString().slice(0, 7); };
const gramas = (nome) => { const m = /(\d+(?:[.,]\d+)?)\s*(G|GR|GRS|KG)\b/i.exec(String(nome || '')); if (!m) return null; const v = +m[1].replace(',', '.'); return /KG/i.test(m[2]) ? v * 1000 : v; };

/**
 * resgates do mês com o custo de cada produto: custo da última nota de compra antes do resgate; senão o custo do estoque.
 * Chá a granel (kg): custo do kg × gramas do nome ("… 50G"). Produto que o painel não achou: custo null (aparece para conferir).
 */
function premios({ eventos, estoque, compras, codsDe }) {
  const itens = (estoque && estoque.itens) || [];
  const porCod = new Map(itens.map((i) => [String(i.cod), i]));
  const hist = new Map(); // cod → [[data, custo]] das notas de compra
  for (const n of compras || []) for (const i of n.itens || []) {
    const k = String(i.cod); if (!hist.has(k)) hist.set(k, []);
    hist.get(k).push([dia(n.entrada || n.emissao), i.custo]);
  }
  for (const l of hist.values()) l.sort((a, b) => a[0].localeCompare(b[0]));
  const custoEm = (cod, data) => {
    const l = hist.get(cod) || []; let c = null;
    for (const [d, v] of l) { if (d <= data) c = v; else break; }
    if (c == null) { const e = porCod.get(cod); c = e && e.custo != null ? e.custo : null; }
    return c;
  };
  const meses = new Map();
  for (const e of eventos || []) {
    if (e.tipo !== 'resgate' || !e.data) continue;
    const ym = e.data.slice(0, 7);
    if (!meses.has(ym)) meses.set(ym, { mes: ym, resgates: [], custo: 0, semCusto: 0 });
    const m = meses.get(ym);
    const prods = (e.produtos || []).map((nome) => {
      const cods = codsDe ? codsDe(nome) : [];
      const cod = cods[0] || null, it = cod && porCod.get(cod);
      let custo = cod ? custoEm(cod, e.data) : null;
      if (custo != null && it && /^kg$/i.test(it.un || '')) { const g = gramas(nome); custo = g ? custo * g / 1000 : null; }
      if (custo == null) m.semCusto++; else m.custo += r2(custo); // soma o que aparece na planilha (centavos batem)
      return { nome, cod, custo: custo == null ? null : r2(custo) };
    });
    m.resgates.push({ data: e.data, min: e.min ?? null, cpf: e.cpf || '', pontos: e.pontos || 0, cliente: e.nome || '', produtos: prods });
  }
  return [...meses.values()].map((m) => ({ ...m, custo: r2(m.custo), devido: r2(m.custo * PCT_PREMIO) })).sort((a, b) => b.mes.localeCompare(a.mes));
}

/** os prêmios de cada mês × os descontos lançados nos royalties (cada lançamento diz o mês de referência do royalty) */
function contaPremios(id, entrada, hoje = C.diaSP()) {
  const m = ler(id);
  const ms = premios(entrada);
  const mesHoje = hoje.slice(0, 7);
  const linhas = ms.map((x) => {
    const lanc = m.royalties.filter((r) => r.premios === x.mes);
    const recebido = r2(lanc.reduce((s, r) => s + r.valor, 0));
    const dif = r2(x.devido - recebido);
    // os prêmios do mês M vêm no royalty de M+1: depois do fim de M+1 sem desconto = atrasado
    const situacao = x.mes >= mesHoje ? 'mes_aberto' : Math.abs(dif) <= 0.5 ? 'ok' : recebido > 0 ? (dif > 0 ? 'faltou' : 'veio_mais') : somaMes(x.mes, 1) < mesHoje ? 'atrasado' : 'aguardando';
    return { ...x, lancamentos: lanc, recebido, diferenca: dif, situacao };
  });
  const soma = (f, k) => r2(linhas.filter(f).reduce((s, x) => s + x[k], 0));
  return {
    pct: PCT_PREMIO, meses: linhas,
    resumo: {
      atrasado: soma((x) => x.situacao === 'atrasado', 'devido'), nAtrasado: linhas.filter((x) => x.situacao === 'atrasado').length,
      faltou: soma((x) => x.situacao === 'faltou', 'diferenca'), nFaltou: linhas.filter((x) => x.situacao === 'faltou').length,
      aguardando: soma((x) => x.situacao === 'aguardando' || x.situacao === 'mes_aberto', 'devido'),
      recebido: soma(() => true, 'recebido'),
    },
  };
}

/** lançar / apagar desconto nos royalties: { ref: mês do royalty (AAAA-MM), premios: mês dos prêmios, valor, obs } */
function royalties(id, b, por) {
  const m = ler(id);
  if (b.tipo === 'apagar') {
    m.royalties = m.royalties.filter((r) => r.id !== String(b.id || ''));
  } else {
    const vs = String(b.valor ?? '').trim();
    // "1.234,56" (milhar com ponto) ou "123.45" (teclado do celular com ponto decimal)
    const valor = Math.round(Number(vs.includes(',') ? vs.replace(/\./g, '').replace(',', '.') : /^\d+\.\d{1,2}$/.test(vs) ? vs : vs.replace(/\./g, '')) * 100) / 100;
    if (!YM.test(String(b.ref || ''))) return { erro: 'Informe o mês de referência do royalty.' };
    const premiosMes = YM.test(String(b.premios || '')) ? b.premios : somaMes(b.ref, -1);
    if (!Number.isFinite(valor) || valor <= 0 || valor > 1e6) return { erro: 'Valor do desconto inválido.' };
    m.royalties.push({ id: require('crypto').randomBytes(6).toString('hex'), ref: b.ref, premios: premiosMes, valor, obs: String(b.obs || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200), por, em: new Date().toISOString() });
  }
  gravar(id, m);
  return { ok: true };
}

/** descontos que a franquia deu nos royalties, por mês de referência (Resultado, RES-ROY-01): devoluções compensadas nos
 *  royalties com o mês escolhido e prêmios de fidelidade lançados como desconto nos royalties. Compensação antiga, de texto
 *  livre e sem mês, fica em semMes (não entra na conta: o mês não é confiável). */
function descontosRoyalties(id, creditos) {
  const porMes = {}, semMes = [];
  const add = (ym, x) => (porMes[ym] = porMes[ym] || []).push(x);
  for (const c of creditos || []) {
    const cp = c.compensado;
    if (!cp || cp.como !== 'royalties') continue;
    const x = { origem: 'devolucao', valor: r2(c.valor), texto: `devolução NF ${c.numero}` };
    if (cp.mes && YM.test(cp.mes)) add(cp.mes, x); else semMes.push({ ...x, obs: cp.obs || '' });
  }
  for (const r of ler(id).royalties) if (YM.test(String(r.ref || ''))) add(r.ref, { origem: 'fidelidade', valor: r2(r.valor), texto: `prêmios de fidelidade de ${r.premios}` });
  return { porMes, semMes };
}
module.exports = { descontosRoyalties, premios, contaPremios, royalties, PCT_PREMIO, conta, acao, compensacao, entradas, mesesRoyalties, MESES_ROYALTIES, creditos, combinar, parcial, descontoDaNota, PRAZO_DIAS };
