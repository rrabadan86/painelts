'use strict';
/**
 * CMV pelo estoque (decisão do dono, 25/11/2026; CMV-EST-01): estoque inicial + compras − devoluções à franquia − estoque final.
 * A diferença para o custo das vendas (o que saiu vendido) são as perdas e os acertos do mês (inventário, vencidos, erros).
 *
 * Foto do estoque a custo: a cada planilha de estoque importada (src/estoque.js → importar) o painel guarda, nos dias perto da
 * virada do mês (26 em diante e 1 a 3), a PRIMEIRA foto do dia (o relatório do AppNext sai de madrugada, antes das vendas):
 *   dados/<loja>/estoque/fotos.json  { 'AAAA-MM-DD': { em, valor, itens, semCusto } }
 * Estoque final de um mês = a foto do dia 1 do mês seguinte; sem ela, a mais próxima (marcada "aprox."). Estoque inicial = o final
 * do mês anterior. Só leitura de planilha: nada é gravado no AppNext.
 *
 * Fotos reconstruídas pelo extrato (CMV-REC-01, pedido do dono de 25/11/2026: "só partir de junho/2025"): o Extrato de estoque do
 * AppNext (estoque/extrato.json, robô EXTRATO-02) traz cada movimento com a quantidade, sem custo. A quantidade de cada produto
 * no começo do dia 1 de cada mês = a quantidade da planilha de estoque de agora − tudo o que entrou e saiu desde aquele
 * momento até a hora da planilha. O valor usa o custo de cada produto NAQUELA data (public/js/custodata.js: notas de compra
 * e fotos do custo). Só vale com o extrato lido DEPOIS da planilha (senão faltariam movimentos) e nunca troca uma foto
 * de verdade: fica marcada `origem: 'extrato'` e a tela diz "reconstruído pelo extrato".
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const arq = (id) => path.join(C.pastaLoja(id), 'estoque', 'fotos.json');
const GUARDA_DIAS = 800;
const ymMais = (ym, n) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);

function ler(id) {
  try { const j = JSON.parse(fs.readFileSync(arq(id), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}

/** produtos do grupo "… SEM CONTROLE DE ESTOQUE" (sacos, etiquetas, copos): o AppNext deixa o saldo negativo sem fim, então
 *  ficam fora do estoque a custo (nas fotos de verdade e nas reconstruídas, para as duas contas baterem) */
const SEM_CONTROLE = /SEM CONTROLE/i;
function semControle(id, ES) {
  try { return new Set((((ES || require('./estoque')).atual(id) || {}).itens || []).filter((i) => SEM_CONTROLE.test(i.grupo || '')).map((i) => codN(i.cod))); } catch { return new Set(); }
}

/** valor a custo de um estoque (itens do AppNext): só saldo positivo com custo; `ignorar` = códigos fora da conta */
function valorDe(itens, ignorar) {
  let valor = 0, n = 0, semCusto = 0;
  for (const it of itens || []) {
    if (ignorar && ignorar.has(codN(it.cod))) continue;
    const q = +it.qtd;
    if (!(q > 0)) continue;
    n++;
    if (+it.custo > 0) valor += q * +it.custo; else semCusto++;
  }
  return { valor: Math.round(valor * 100) / 100, itens: n, semCusto };
}

/** perto da virada? (26 em diante ou 1 a 3) */
const pertoDaVirada = (dia) => { const d = +dia.slice(8, 10); return d >= 26 || d <= 3; };

/** guarda a foto do estoque recém-importado (a primeira de cada dia perto da virada). dados: { em, itens } */
function registrarFoto(id, dados, opts = {}) {
  const ms = Date.parse((dados && dados.em) || '');
  if (!Number.isFinite(ms) || !dados.itens || !dados.itens.length) return null;
  const dia = C.diaSP(ms);
  if (!opts.sempre && !pertoDaVirada(dia)) return null;
  const f = ler(id);
  if (f[dia] && f[dia].origem !== 'extrato' && Date.parse(f[dia].em) <= ms) return null; // já tem a primeira do dia (a reconstruída pelo extrato dá lugar à de verdade)
  f[dia] = { em: new Date(ms).toISOString(), ...valorDe(dados.itens, opts.ignorar || semControle(id)) };
  const corte = C.diaSP(Date.now() - GUARDA_DIAS * 864e5);
  for (const k of Object.keys(f)) if (k < corte) delete f[k];
  fs.mkdirSync(path.dirname(arq(id)), { recursive: true });
  C.gravarAtomico(arq(id), JSON.stringify(f), 0o640);
  return f[dia];
}

/** a foto da virada para o mês ym (estoque no FIM de ym): dia 1 do mês seguinte; senão a mais próxima entre o dia 26 de ym e o dia 3 do seguinte */
function fotoFim(fotos, ym) {
  const prox = ymMais(ym, 1);
  const exato = fotos[`${prox}-01`];
  if (exato) return { dia: `${prox}-01`, valor: exato.valor, aprox: false, ...(exato.origem === 'extrato' ? { rec: true } : {}) };
  const alvo = Date.parse(`${prox}-01T03:00:00Z`);
  let best = null;
  for (const [dia, f] of Object.entries(fotos)) {
    if (!(dia >= `${ym}-26` && dia <= `${prox}-03`)) continue;
    const d = Math.abs(Date.parse(`${dia}T12:00:00Z`) - alvo);
    if (!best || d < best.d) best = { d, dia, valor: f.valor, rec: f.origem === 'extrato' };
  }
  return best ? { dia: best.dia, valor: best.valor, aprox: true, ...(best.rec ? { rec: true } : {}) } : null;
}

/**
 * Os meses com a conta pelo estoque: { 'AAAA-MM': { ini, fim, compras, comprasFranquia, comprasOutros, fornecedores: [{ nome, valor }], devolucoes } }
 * (só meses com as duas fotos). As devoluções NÃO entram na conta (CMV-DEV-01): só aparecem na explicação das perdas e acertos.
 * notas: as notas de entrada do coletor (compras.json: { entrada, motivo, status, itens: [{ qtd, custo }] });
 * saidas: as NF-e de saída do painel (nfsaida: { data, finalidade, valor, situacao, dest }) — devoluções à franquia.
 * notasDesde: desde quando o coletor guarda as notas de compra (mês que começa antes fica fora).
 */
function resumo(id, { notas = [], saidas = [], notasDesde = null } = {}) {
  const fotos = ler(id);
  const compras = {}, devol = {}, franq = {}, outros = {};
  for (const n of notas) {
    if (!/compra/i.test(n.motivo || '') || !/^conclu/i.test(n.status || '')) continue;
    const ym = String(n.entrada || n.emissao || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const v = (n.itens || []).reduce((a, i) => a + ((+i.qtd > 0 && +i.custo > 0) ? +i.qtd * +i.custo : 0), 0);
    compras[ym] = (compras[ym] || 0) + v;
    // compras da franquia (TSB) × outros fornecedores (pedido do dono, 25/11/2026; CMV-FORN-01)
    if (ehFranquia(n.fornecedor)) franq[ym] = (franq[ym] || 0) + v;
    else { const m = outros[ym] || (outros[ym] = new Map()); const nome = String(n.fornecedor || 'sem fornecedor').trim(); m.set(nome, (m.get(nome) || 0) + v); }
  }
  for (const s of saidas) {
    if (s.situacao === 'cancelada' || !/devolu/i.test(s.finalidade || '')) continue;
    const ym = String(s.data || s.emissao || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) devol[ym] = (devol[ym] || 0) + (+s.valor || 0);
  }
  const meses = new Set(Object.keys(fotos).map((d) => d.slice(0, 7)).flatMap((ym) => [ym, ymMais(ym, -1)]));
  const out = {};
  for (const ym of meses) {
    const fim = fotoFim(fotos, ym), ini = fotoFim(fotos, ymMais(ym, -1));
    if (!fim || !ini) continue;
    if (notasDesde && `${ym}-01` < String(notasDesde).slice(0, 10)) continue; // as notas de compra guardadas não cobrem o mês inteiro: sem as compras a conta sairia errada
    const r2 = (v) => Math.round((v || 0) * 100) / 100;
    const outs = [...((outros[ym] && outros[ym].entries()) || [])].map(([nome, valor]) => ({ nome, valor: r2(valor) })).sort((a, b) => b.valor - a.valor);
    out[ym] = { ini, fim, compras: r2(compras[ym]), comprasFranquia: r2(franq[ym]), comprasOutros: r2(outs.reduce((a, x) => a + x.valor, 0)), fornecedores: outs.slice(0, 20), devolucoes: r2(devol[ym]) };
  }
  return out;
}

/** nota da franquia: fornecedor TSB Franquias (a mesma regra de Créditos com a franquia) */
const ehFranquia = (forn) => /TSB|FRANQUIA/i.test(String(forn || ''));
const codN = (c) => String(c == null ? '' : c).trim().replace(/^0+(?=\d)/, '');
const inicioDoDia = (dia) => Date.parse(`${dia}T00:00:00-03:00`);

/**
 * conta pura: as fotos do dia 1 de cada mês desde `desde`, voltando da planilha de agora pelos movimentos do extrato.
 * atual: { em, itens: [{ cod, qtd, custo }] } (a planilha como veio do AppNext) · extrato: { em, desde, itens: [{ d, c, q }] }
 * custoNaData(cod, dia1970, custoHoje) → { v, est } · ignorar: códigos fora da conta (sem controle de estoque) · → { fotos: { 'AAAA-MM-01': { em, valor, itens, semCusto, estimados, origem } }, motivo? }
 */
function reconstruir(atual, extrato, custoNaData, ignorar) {
  const base = Date.parse((atual && atual.em) || '');
  if (!Number.isFinite(base) || !atual.itens || !atual.itens.length) return { fotos: {}, motivo: 'sem a planilha de estoque' };
  if (!extrato || !Array.isArray(extrato.itens) || !extrato.itens.length) return { fotos: {}, motivo: 'sem o extrato' };
  if (extrato.completo === false) return { fotos: {}, motivo: 'o extrato ficou incompleto' };
  const lido = Date.parse(extrato.em || '');
  if (!(lido >= base)) return { fotos: {}, motivo: 'a planilha de estoque é mais nova que o extrato: leia o extrato de novo' };
  const desde = String(extrato.desde || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(desde)) return { fotos: {}, motivo: 'extrato sem a data de início' };
  // movimentos até a hora da planilha, do mais novo para o mais antigo
  const movs = [];
  for (const m of extrato.itens) {
    const t = Date.parse(m.d || '');
    if (!Number.isFinite(t) || t >= base || !Number.isFinite(+m.q)) continue;
    movs.push({ t, c: codN(m.c), q: +m.q });
  }
  movs.sort((a, b) => b.t - a.t);
  const qtd = new Map(), custoHoje = new Map(), codOrig = new Map();
  for (const it of atual.itens) { const c = codN(it.cod); qtd.set(c, (qtd.get(c) || 0) + (+it.qtd || 0)); if (+it.custo > 0) custoHoje.set(c, +it.custo); codOrig.set(c, it.cod); }
  // os dias 1 de cada mês, do mais novo (antes da planilha) ao mais antigo (o mês de `desde`)
  const dias = [];
  for (let ym = C.diaSP(base).slice(0, 7); ym >= desde; ym = ymMais(ym, -1)) if (inicioDoDia(`${ym}-01`) < base) dias.push(`${ym}-01`);
  const fotos = {};
  let k = 0;
  for (const dia of dias) {
    const t0 = inicioDoDia(dia);
    for (; k < movs.length && movs[k].t >= t0; k++) qtd.set(movs[k].c, (qtd.get(movs[k].c) || 0) - movs[k].q); // desfaz o movimento
    const d1970 = Math.floor(Date.UTC(+dia.slice(0, 4), +dia.slice(5, 7) - 1, 1) / 864e5);
    let valor = 0, n = 0, semCusto = 0, estimados = 0;
    for (const [c, q] of qtd) {
      if (!(q > 1e-9) || (ignorar && ignorar.has(c))) continue;
      n++;
      const r = custoNaData ? custoNaData(codOrig.get(c) || c, d1970, custoHoje.get(c)) : { v: custoHoje.get(c), est: true };
      if (!(r && r.v > 0)) { semCusto++; continue; }
      if (r.est) estimados++;
      valor += q * r.v;
    }
    fotos[dia] = { em: new Date(t0).toISOString(), valor: Math.round(valor * 100) / 100, itens: n, semCusto, estimados, origem: 'extrato' };
  }
  return { fotos };
}

const arqRec = (id) => path.join(C.pastaLoja(id), 'estoque', 'fotos-extrato.json');
/**
 * aplica a reconstrução quando o extrato é novo (uma vez por leitura do extrato): grava as fotos do dia 1 de cada mês que
 * ainda não têm foto de verdade e guarda o resumo em estoque/fotos-extrato.json. → o resumo (ou null sem extrato).
 */
function aplicarExtrato(id, deps = {}) {
  const fExt = path.join(C.pastaLoja(id), 'estoque', 'extrato.json');
  let st; try { st = fs.statSync(fExt); } catch { return null; }
  let feito = null; try { feito = JSON.parse(fs.readFileSync(arqRec(id), 'utf8')); } catch { /* primeira vez */ }
  if (feito && feito.mtimeMs === st.mtimeMs && feito.size === st.size) return feito;
  let ext; try { ext = JSON.parse(fs.readFileSync(fExt, 'utf8')); } catch { return null; }
  const ES = deps.estoque || require('./estoque');
  const atual = ES.atualCru(id);
  const CD = require('../public/js/custodata');
  const cc = ES.compras(id);
  const motor = CD.montar(ES.historico(id), (cc && cc.itens) || {});
  const r = reconstruir(atual, ext, motor.custoNaData, semControle(id, ES));
  const f = ler(id);
  const gravadas = [];
  for (const [dia, x] of Object.entries(r.fotos)) {
    if (f[dia] && f[dia].origem !== 'extrato') continue; // foto de verdade vale mais
    f[dia] = x; gravadas.push(dia);
  }
  if (gravadas.length) {
    fs.mkdirSync(path.dirname(arq(id)), { recursive: true });
    C.gravarAtomico(arq(id), JSON.stringify(f), 0o640);
  }
  const res = { mtimeMs: st.mtimeMs, size: st.size, em: new Date().toISOString(), extratoEm: ext.em || null, planilhaEm: (atual && atual.em) || null,
    meses: gravadas.sort(), motivo: r.motivo || null };
  C.gravarAtomico(arqRec(id), JSON.stringify(res), 0o640);
  return res;
}

/** o resumo da última reconstrução (só leitura) */
function lerReconstrucao(id) { try { return JSON.parse(fs.readFileSync(arqRec(id), 'utf8')); } catch { return null; } }

module.exports = { ehFranquia, ler, valorDe, semControle, registrarFoto, fotoFim, resumo, pertoDaVirada, reconstruir, aplicarExtrato, lerReconstrucao };
