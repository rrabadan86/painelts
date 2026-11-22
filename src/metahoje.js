'use strict';
/**
 * Meta de hoje no servidor (para a vendedora, em Minha comissão — decisão do dono de 22/11/2026).
 * A vendedora recebe só as vendas dela em /api/dados, então a conta da loja não fecha na tela dela: o servidor faz a conta
 * com as MESMAS definições da tela (cartão "Meta de hoje", TS.cartaoMetaDia em public/js/clientes.js):
 *  - meta do mês: IND.metaMes (a mesma regra de TS.metaCalc: digitada no mês → automática → padrão);
 *  - vendas da meta: CT.classeMeta (public/js/contas.js; chá aromatizado, chá puro e acessórios, sem Espaço Gourmet);
 *  - meta de hoje = (meta do mês − vendas da meta até ontem) ÷ dias de loja aberta que faltam, contando hoje (IND.lojaAberta);
 *  - divisão: TS.metaDia.dividir (public/js/metadia.js) em partes iguais entre quem teve ≥ 3% das vendas da meta nos
 *    últimos 30 dias e não está de férias — o mesmo modo que a tela já usa para a vendedora ('sem-acesso': ela não
 *    recebe a escala dos colegas). A escala por horas só existe na tela de quem tem acesso a ela (Início).
 * A resposta para a vendedora traz só a parte dela (rota em server.js); nunca a meta da loja, o faturamento ou as colegas.
 */
const CT = require('../public/js/contas');
const MD = require('../public/js/metadia');
const IND = require('./indicadores');

const DIA = 86400000;
const isoDia = (d) => new Date(d * DIA).toISOString().slice(0, 10);
const diaIso = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / DIA);
const semV = (v) => /^SEM VENDEDOR$/i.test(String(v || '').trim());

/** valor da linha nas vendas da meta (0 quando não conta) */
const naMeta = (v) => (CT.contaFat(v.descricao, v.vu) && CT.classeMeta(v.grupoC, v.cat) ? v.vt || 0 : 0);

/**
 * { loja (config da loja), vendas, metaPlanilha, hoje (AAAA-MM-DD, padrão: hoje em São Paulo) }
 * → null (sem meta no mês) ou { meta, ateOntem, falta, restam, metaHoje, temHoje, vendHoje, porVend: Map(nome → vendas de hoje), divisao }
 */
function calcular({ loja, vendas, metaPlanilha, hoje }) {
  const hojeIso = hoje || IND.hojeSP().iso, ym = hojeIso.slice(0, 7);
  const meta = IND.metaMes(loja, ym, metaPlanilha, vendas);
  if (!meta) return null;
  const d30 = isoDia(diaIso(hojeIso) - 30);
  let ateOntem = 0, vendHoje = 0, ultimo = '';
  const porVend = new Map(), part = new Map();
  for (const v of vendas || []) {
    if (!v.data) continue;
    if (v.data > ultimo) ultimo = v.data;
    const x = naMeta(v);
    if (!x) continue;
    if (v.data >= ym + '-01' && v.data < hojeIso) ateOntem += x;
    if (v.data === hojeIso) { vendHoje += x; if (v.vendedor) porVend.set(v.vendedor, (porVend.get(v.vendedor) || 0) + x); }
    if (v.data >= d30 && v.data < hojeIso && v.vendedor) part.set(v.vendedor, (part.get(v.vendedor) || 0) + x);
  }
  const fim = isoDia(diaIso(ym + '-01') + new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate() - 1);
  let restam = 0;
  for (let d = diaIso(hojeIso); d <= diaIso(fim); d++) if (IND.lojaAberta(loja, isoDia(d))) restam++;
  const falta = Math.max(0, meta - ateOntem);
  const metaHoje = restam ? falta / restam : falta;
  const tot30 = [...part.values()].reduce((a, b) => a + b, 0);
  const quemVende = [...part].filter(([v, x]) => !semV(v) && tot30 && x / tot30 >= 0.03).map(([v]) => v);
  const divisao = MD.dividir({ meta: metaHoje, pessoas: quemVende, horas: null, semEscala: 'sem-acesso', ferias: loja.ferias || [], hoje: hojeIso });
  return { meta, ateOntem, falta, restam, metaHoje, temHoje: ultimo >= hojeIso, vendHoje, porVend, divisao };
}

/** só o que a vendedora pode ver: a parte dela, o que ela vendeu hoje, o modo e os dias que faltam */
function daVendedora(r, nome) {
  const eu = String(nome || '').trim().toUpperCase();
  if (!r || !eu) return { minhaParte: null, vendiHoje: null, temHoje: !!(r && r.temHoje), modo: r ? r.divisao.modo : null, restam: r ? r.restam : null };
  const p = r.divisao.partes.find((x) => String(x.nome).trim().toUpperCase() === eu);
  const vendi = [...r.porVend].filter(([n]) => String(n).trim().toUpperCase() === eu).reduce((s, [, x]) => s + x, 0);
  const deFerias = (r.divisao.fora || []).some((n) => String(n).trim().toUpperCase() === eu);
  return {
    minhaParte: p ? Math.round(p.alvo * 100) / 100 : null,
    vendiHoje: r.temHoje ? Math.round(vendi * 100) / 100 : null,
    temHoje: r.temHoje,
    modo: r.divisao.modo,
    restam: r.restam,
    // sem parte: de férias hoje, ou sem venda da meta suficiente nos últimos 30 dias (ainda não entra na divisão)
    semParte: p ? null : deFerias ? 'ferias' : 'sem-vendas',
  };
}

/** completa (admin, franqueado, gerente): a loja e as partes de cada pessoa */
function completa(r) {
  if (!r) return { meta: null };
  return {
    meta: r.meta, falta: r.falta, restam: r.restam, metaHoje: Math.round(r.metaHoje * 100) / 100, temHoje: r.temHoje,
    vendHoje: r.temHoje ? Math.round(r.vendHoje * 100) / 100 : null, modo: r.divisao.modo,
    partes: r.divisao.partes.map((p) => ({ nome: p.nome, alvo: Math.round(p.alvo * 100) / 100, fez: r.temHoje ? Math.round((r.porVend.get(p.nome) || 0) * 100) / 100 : null })),
  };
}

module.exports = { calcular, daVendedora, completa };
