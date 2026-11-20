'use strict';
/**
 * Média da franquia para os gráficos de Vendas → Comparativos (anônima: só médias, nunca uma loja).
 * As regras são as mesmas do navegador: os grupos da meta e o que conta como faturamento vêm de public/js/contas.js
 * (a definição única); as listas de categoria continuam iguais às de rules.js (o teste unitário confere).
 *
 * Entra: partes = [{ id, vendas }] de todas as lojas; de/ate = dias (desde 1970) do filtro; tipo = 'dia' | 'semana' | 'mes'.
 * Sai: { lojas, mix, hist, met, pacotes } ou { lojas, minimo } quando há poucas lojas (a média revelaria cada uma).
 */
const CT = require('../public/js/contas');
const G_AROM = CT.GRUPOS_META.arom, G_PURO = CT.GRUPOS_META.puro, G_ACESS = CT.GRUPOS_META.acess;
const CAT_AROM_PCT = ['Chás aromatizados, Chás, Rooibos e Infusões Aromatizados, LOJA', 'Chás aromatizados, Chás Envasados Aromatizados, LOJA', 'Chás aromatizados, LOJA, SACHÊS PIRAMIDAIS'];
const CAT_PURO_PCT = ['Chás Envasados Puros, Chás Puros, LOJA', 'Chás Puros, Chás, Rooibos e Infusões Puros, LOJA'];
const CAT_CHA_KG = ['Chás aromatizados, Chás, Rooibos e Infusões Aromatizados, LOJA', 'Chás Puros, Chás, Rooibos e Infusões Puros, LOJA'];
const G_ACESS_PCT = ['ACESSÓRIOS', 'ALIMENTAÇÃO'];
const TAMS = [50, 100, 250, 500, 1000];
const MIN_LOJAS = 4;

const S = (l) => new Set(l);
const mixTotal = S([...G_AROM, ...G_PURO, ...G_ACESS]), catArom = S(CAT_AROM_PCT), catPuro = S(CAT_PURO_PCT), catKg = S(CAT_CHA_KG), gAcess = S(G_ACESS_PCT);
const semVend = (v) => /^(sem vendedor)?$/i.test(String(v || '').trim());
const foraComp = (v) => /^(sem vendedor|adriane puccini)?$/i.test(String(v || '').trim());
const semItem = (g) => /^CONSUM[IÍ]VEIS\b.*SEM CONTROLE/i.test(String(g || '').trim());
const DIA = 864e5;
const diaDe = (iso) => Math.floor(Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z') / DIA);
const isoDe = (d) => new Date(d * DIA).toISOString().slice(0, 10);

/** mesma divisão em baldes do navegador (TS.baldes) */
function chaveDe(tipo) {
  if (tipo === 'dia') return (d) => String(d);
  if (tipo === 'semana') return (d) => String(d - ((new Date(d * DIA).getUTCDay() + 6) % 7));
  return (d) => isoDe(d).slice(0, 7);
}

function comparativos(partes, de, ate, tipo) {
  const chave = chaveDe(tipo);
  const lojas = [];
  for (const p of partes) {
    // só o que conta no faturamento (sem linha de taxa e sem item a R$ 0,01); as vendas sem vendedor entram no
    // faturamento da loja (histórico) e ficam fora só dos recortes por vendedor (mix e indicadores)
    const vs = p.vendas.filter((v) => { const d = diaDe(v.data); return d >= de && d <= ate && CT.contaFat(v.descricao, v.vu); });
    if (vs.length) lojas.push({ id: p.id, vs });
  }
  if (lojas.length < MIN_LOJAS) return { lojas: lojas.length, minimo: MIN_LOJAS };

  // 1) mix (% do faturamento de chás e acessórios): média das lojas
  const mixes = lojas.map(({ vs }) => {
    let a = 0, p = 0, c = 0, t = 0;
    for (const v of vs) {
      if (semVend(v.vendedor)) continue;
      const x = v.vt || 0;
      if (mixTotal.has(v.grupoC)) t += x;
      if (v.grupoOrig !== undefined) {
        if (v.grupoC === 'CHÁ AROMATIZADO') a += x;
        else if (v.grupoC === 'CHÁ PURO') p += x;
        else if (v.grupoC === 'ACESSÓRIOS') c += x;
      } else {
        if (catArom.has(v.cat)) a += x;
        if (catPuro.has(v.cat)) p += x;
        if (gAcess.has(v.grupo)) c += x;
      }
    }
    return t ? { arom: a / t, puro: p / t, acess: c / t } : null;
  }).filter(Boolean);
  const med = (k) => mixes.reduce((s, m) => s + m[k], 0) / mixes.length;
  const mix = mixes.length >= MIN_LOJAS ? { arom: med('arom'), puro: med('puro'), acess: med('acess') } : null;

  // 2) histórico: faturamento médio por loja em cada balde (só lojas que venderam nele)
  const hs = new Map(); // chave → Map(loja → vt)
  for (const { id, vs } of lojas) for (const v of vs) {
    if (!v.grupoC) continue;
    const k = chave(diaDe(v.data));
    let m = hs.get(k); if (!m) hs.set(k, (m = new Map()));
    m.set(id, (m.get(id) || 0) + (v.vt || 0));
  }
  const hist = {};
  for (const [k, m] of hs) if (m.size >= MIN_LOJAS) hist[k] = [...m.values()].reduce((s, x) => s + x, 0) / m.size;

  // 3) indicadores por balde: TKM/PMA/IPA da rede; atendimentos e pacotes = média por vendedor
  const bs = new Map(); // chave → acumulado
  const pacVend = new Map(); // "loja|vendedor" → [un. por tamanho] no período
  for (const { id, vs } of lojas) for (const v of vs) {
    if (foraComp(v.vendedor)) continue;
    const k = chave(diaDe(v.data)), quem = id + '|' + v.vendedor;
    let b = bs.get(k);
    if (!b) bs.set(k, (b = { vt: 0, qtd: 0, cupons: new Set(), vend: new Map(), lojas: new Set() }));
    b.vt += v.vt || 0;
    if (!semItem(v.grupoC)) b.qtd += v.qtd || 0;
    b.cupons.add(quem + '|' + v.cupom + '|' + v.data.slice(0, 10));
    b.lojas.add(id);
    let w = b.vend.get(quem); if (!w) b.vend.set(quem, (w = { cupons: new Set(), p: {} }));
    w.cupons.add(v.cupom + '|' + v.data.slice(0, 10));
    const t = Number(v.soNumeros);
    if (catKg.has(v.cat) && TAMS.includes(t)) {
      w.p[t] = (w.p[t] || 0) + (v.qtd || 0);
      let pv = pacVend.get(quem); if (!pv) pacVend.set(quem, (pv = {}));
      pv[t] = (pv[t] || 0) + (v.qtd || 0);
    }
  }
  const met = {};
  for (const [k, b] of bs) {
    if (b.lojas.size < MIN_LOJAS) continue;
    const c = b.cupons.size, ws = [...b.vend.values()];
    const m = { tkm: c ? b.vt / c : null, pma: b.qtd ? b.vt / b.qtd : null, ipa: c ? b.qtd / c : null, cupons: ws.length ? ws.reduce((s, w) => s + w.cupons.size, 0) / ws.length : null };
    for (const t of TAMS) { const xs = ws.map((w) => w.p[t] || 0).filter((x) => x > 0); m['p' + t] = xs.length >= 3 ? xs.reduce((s, x) => s + x, 0) / xs.length : null; }
    met[k] = m;
  }
  // 4) pacotes por tamanho no período: média por vendedor (entre os que venderam pacotes)
  const pvs = [...pacVend.values()];
  const pacotes = pvs.length >= 3 ? Object.fromEntries(TAMS.map((t) => [t, pvs.reduce((s, pv) => s + (pv[t] || 0), 0) / pvs.length])) : null;
  return { lojas: lojas.length, de: isoDe(de), ate: isoDe(ate), tipo, mix, hist, met, pacotes };
}

module.exports = { comparativos, MIN_LOJAS, LISTAS: { G_AROM, G_PURO, G_ACESS, CAT_AROM_PCT, CAT_PURO_PCT, CAT_CHA_KG } };
