'use strict';
/**
 * Indicadores calculados no servidor (mesmas definições do painel):
 *  - comparativo anônimo com a rede
 *  - alertas inteligentes
 *  - resumo diário (Telegram / e-mail)
 */
const G_AROM = new Set(['CHÁ AROMATIZADO', 'CHÁS ENVASADOS', 'INFUSÕES', 'ROOIBOS AROMATIZADO', 'SACHÊS PIRAMIDAIS', 'TEA MOMENTS']);
const G_PURO = new Set(['CHÁ PURO', 'CHÁS ENVASADOS PUROS']);
const G_ACESS = new Set(['ACESSÓRIOS', 'ALIMENTAÇÃO', 'CONSUMÍVEIS - COM CONTROLE DE ESTOQUE', 'COSMÉTICOS']);
const EG = 'ESPAÇO GOURMET';
const CHA_TOTAL = new Set(['CHÁS PARA MINITINS', 'ROOIBOS PURO', 'ROOIBOS AROMATIZADO', 'CHÁ BRANCO PURO', 'CHÁ BRANCO AROMATIZADO', 'INFUSÕES', 'CHÁ OOLONG PURO', 'CHÁ OOLONG AROMATIZADO', 'CHÁ PRETO PURO', 'CHÁ PRETO AROMATIZADO', 'CHÁ VERDE PURO', 'CHÁ VERDE AROMATIZADO', 'CHÁ VERMELHO PURO', 'CHÁ VERMELHO AROMATIZADO']);
const SEM_META_PADRAO = ['amanda oliveira', 'corporativo', 'adriane puccini', 'sem vendedor', ''];
const semVendedor = (v) => !v || /^sem vendedor$/i.test(String(v).trim());

const DIA = 86400000;
const isoDia = (d) => new Date(d * DIA).toISOString().slice(0, 10);
const diaIso = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / DIA);
const diasNoMes = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
function hojeSP() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

/** "CONSUMÍVEIS - SEM CONTROLE DE ESTOQUE" (ex.: sacos de amostra) entra no faturamento, mas não conta como item (PMA/IPA) */
const semItem = (v) => /^CONSUM[IÍ]VEIS\b.*SEM CONTROLE/i.test(String(v.grupoC || v.grupo || '').trim());

/** indicadores de um conjunto de vendas (sem "SEM VENDEDOR", como no Resumo) */
function metricas(vendas) {
  let vt = 0, qtd = 0, kg = 0, eg = 0, arom = 0, puro = 0, acess = 0, metaLoja = 0;
  const cupons = new Set();
  for (const v of vendas) {
    // meta da loja (gerente): chás e acessórios de TODAS as vendas, inclusive "SEM VENDEDOR" — igual ao Comissionamento
    if (G_AROM.has(v.grupoC) || G_PURO.has(v.grupoC) || G_ACESS.has(v.grupoC)) metaLoja += v.vt || 0;
    if (semVendedor(v.vendedor)) continue;
    const x = v.vt || 0;
    vt += x; qtd += semItem(v) ? 0 : v.qtd || 0;
    cupons.add((v.data || '') + '|' + v.cupom + '|' + v.loja);
    if (CHA_TOTAL.has(v.grupo)) kg += v.qtdCha || 0;
    if (v.grupoC === EG) eg += x;
    if (G_AROM.has(v.grupoC)) arom += x; else if (G_PURO.has(v.grupoC)) puro += x; else if (G_ACESS.has(v.grupoC)) acess += x;
  }
  const c = cupons.size;
  return { vt, cupons: c, qtd, tkm: c ? vt / c : null, pma: qtd ? vt / qtd : null, ipa: c ? qtd / c : null, kg, pctEG: vt ? eg / vt : null, arom, puro, acess, lojaVend: arom + puro + acess, pctPuro: arom + puro + acess ? puro / (arom + puro + acess) : null, pctAcess: arom + puro + acess ? acess / (arom + puro + acess) : null, metaLoja };
}
const entre = (vendas, de, ate) => vendas.filter((v) => v.data >= de && v.data <= ate);

/** vendas por mês sem o grupo Espaço Gourmet e sem taxas (base da meta automática) */
const cacheTotais = new WeakMap();
function totaisSemEG(vendas) {
  let t = cacheTotais.get(vendas);
  if (!t) {
    t = {};
    for (const v of vendas) {
      if (v.grupoC === EG || v.cat === EG || !v.data || /^taxa /i.test(String(v.descricao || '').trim())) continue;
      const ym = v.data.slice(0, 7);
      t[ym] = (t[ym] || 0) + (v.vt || 0);
    }
    cacheTotais.set(vendas, t);
  }
  return t;
}
const ymAnterior = (ym) => `${+ym.slice(0, 4) - 1}${ym.slice(4)}`;
/**
 * meta da loja no mês: 1º) digitada para o mês; 2º) automática = mesmo mês do ano anterior
 * (sem Espaço Gourmet) + %; 3º) meta padrão (lojas.json ou planilha Meta)
 */
function metaMes(loja, ym, metaPlanilha, vendas) {
  if (loja.metas && loja.metas[ym] != null) return loja.metas[ym];
  const a = loja.metaAuto;
  if (a && a.ativo && vendas) {
    const base = totaisSemEG(vendas)[ymAnterior(ym)];
    if (base > 0) return Math.round(base * (1 + (a.pct || 0) / 100));
  }
  return loja.meta ?? metaPlanilha ?? null;
}

/** meta individual com férias (mesma regra do painel): meta diária dividida entre quem trabalha no dia */
function metasIndividuais(metaLoja, ym, nomes, ferias) {
  const N = nomes.map((n) => String(n).trim().toUpperCase());
  const out = new Map(N.map((n) => [n, 0]));
  if (!N.length) return out;
  const nDias = diasNoMes(ym), ini = ym + '-01', fim = `${ym}-${String(nDias).padStart(2, '0')}`;
  const fm = (ferias || []).filter((f) => f.de <= fim && f.ate >= ini && N.includes(String(f.vendedor).trim().toUpperCase()));
  if (!fm.length) { N.forEach((n) => out.set(n, metaLoja / N.length)); return out; }
  for (let d = 1; d <= nDias; d++) {
    const iso = `${ym}-${String(d).padStart(2, '0')}`;
    const fora = new Set(fm.filter((f) => f.de <= iso && f.ate >= iso).map((f) => String(f.vendedor).trim().toUpperCase()));
    const ativos = N.filter((n) => !fora.has(n));
    ativos.forEach((n) => out.set(n, out.get(n) + metaLoja / nDias / ativos.length));
  }
  return out;
}

// ======================= REDE (anônimo) =======================
const METRICAS_REDE = [
  ['vt', 'Faturamento', 'brl0'], ['cupons', 'Atendimentos (cupons)', 'int'], ['tkm', 'Ticket médio (TKM)', 'brl'], ['pma', 'Preço médio (PMA)', 'brl'],
  ['ipa', 'Itens por atendimento (IPA)', 'n2'], ['kg', 'Chá vendido (kg)', 'kg'], ['pctPuro', 'Chá puro (% da loja)', 'pct'], ['pctAcess', 'Acessórios (% da loja)', 'pct'], ['pctEG', 'Espaço Gourmet (% do faturamento)', 'pct'],
  ['cresc', 'Crescimento vs. mesmo mês do ano anterior', 'delta'], ['pctMeta', 'Meta atingida', 'pct'],
];
const MIN_LOJAS_REDE = 4; // com menos lojas, a média revelaria demais sobre cada uma

/**
 * partes: [{ id, loja (config), vendas, metaPlanilha }]
 * Devolve média, mediana e "melhores 25%" de cada indicador, e a posição da loja pedida.
 * Nunca devolve valores de outra loja isoladamente.
 */
function rede(partes, ym, lojaId, minimo = MIN_LOJAS_REDE) {
  const de = ym + '-01', ate = `${ym}-${String(diasNoMes(ym)).padStart(2, '0')}`;
  const ymAnt = `${+ym.slice(0, 4) - 1}${ym.slice(4)}`;
  const linhas = [];
  let fimDados = null;
  for (const p of partes) {
    const mes = entre(p.vendas, de, ate);
    if (!mes.length) continue;
    const ult = mes.reduce((m, v) => (v.data > m ? v.data : m), '');
    fimDados = !fimDados || ult < fimDados ? ult : fimDados;
    linhas.push({ p, mes, ult });
  }
  // mês em andamento: compara todas as lojas até o mesmo dia (o menor "último dia" entre elas)
  const corte = linhas.length && fimDados < ate ? fimDados : ate;
  const vals = linhas.map(({ p, mes }) => {
    const m = metricas(mes.filter((v) => v.data <= corte));
    const antDe = ymAnt + '-01', antAte = ymAnt + corte.slice(7);
    const ant = metricas(entre(p.vendas, antDe, antAte));
    m.cresc = ant.vt ? m.vt / ant.vt - 1 : null;
    const meta = metaMes(p.loja, ym, p.metaPlanilha, p.vendas);
    const prop = corte < ate ? +corte.slice(8, 10) / diasNoMes(ym) : 1;
    m.pctMeta = meta ? m.metaLoja / (meta * prop) : null;
    return { id: p.id, m };
  });
  const out = { ym, ate: corte, parcial: corte < ate, lojas: vals.length, minimo, indicadores: [] };
  if (vals.length < minimo) return out;
  const minha = vals.find((v) => v.id === lojaId);
  for (const [k, nome, formato] of METRICAS_REDE) {
    const xs = vals.map((v) => v.m[k]).filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    if (xs.length < minimo) continue;
    const q = (f) => { const pos = (xs.length - 1) * f, b = Math.floor(pos); return xs[b] + (xs[Math.min(b + 1, xs.length - 1)] - xs[b]) * (pos - b); };
    const eu = minha ? minha.m[k] : null;
    out.indicadores.push({
      k, nome, formato, media: xs.reduce((s, x) => s + x, 0) / xs.length, mediana: q(0.5), top25: q(0.75),
      minha: eu, posicao: eu == null ? null : Math.round((xs.filter((x) => x < eu).length / (xs.length - 1 || 1)) * 100),
    });
  }
  return out;
}

// ======================= ALERTAS =======================
/**
 * Alertas da loja, olhando até "hoje" (último dia com vendas).
 * tipo: 'queda' | 'alta' | 'meta' | 'vendedor'
 */
function alertas({ loja, vendas, metaPlanilha }) {
  if (!vendas.length) return [];
  const ultimo = vendas.reduce((m, v) => (v.data > m ? v.data : m), '');
  const u = diaIso(ultimo);
  const out = [];
  const brl = (x) => 'R$ ' + Math.round(x).toLocaleString('pt-BR');

  // 1) última semana vs. média das 4 anteriores, por grupo
  const sem = metricas(entre(vendas, isoDia(u - 6), ultimo));
  const ant4 = metricas(entre(vendas, isoDia(u - 34), isoDia(u - 7)));
  const grupos = [['lojaVend', 'Vendas de chás e acessórios'], ['arom', 'Chá aromatizado'], ['puro', 'Chá puro'], ['acess', 'Acessórios'], ['vt', 'Faturamento total']];
  const disparou = new Set();
  for (const [k, nome] of grupos) {
    const base = ant4[k] / 4;
    if (base < 300) continue; // pouco movimento: não alarma
    const d = sem[k] / base - 1;
    const dir = d <= -0.25 ? 'queda' : d >= 0.3 ? 'alta' : null;
    if (!dir || (k === 'vt' && disparou.has(dir))) continue;
    disparou.add(dir);
    const p = `${Math.round(Math.abs(d) * 100)}%`;
    if (dir === 'queda') out.push({ tipo: 'queda', gravidade: d <= -0.4 ? 2 : 1, texto: `${nome}: queda de ${p} nos últimos 7 dias em relação à média das 4 semanas anteriores (${brl(sem[k])} contra ${brl(base)} por semana).` });
    else out.push({ tipo: 'alta', gravidade: 0, texto: `${nome}: alta de ${p} nos últimos 7 dias em relação à média das 4 semanas anteriores.` });
  }
  // 2) indicadores dos últimos 30 dias vs. 30 anteriores
  const m30 = metricas(entre(vendas, isoDia(u - 29), ultimo)), p30 = metricas(entre(vendas, isoDia(u - 59), isoDia(u - 30)));
  for (const [k, nome] of [['tkm', 'O ticket médio (TKM)'], ['ipa', 'Os itens por atendimento (IPA)']]) {
    if (!m30[k] || !p30[k] || m30.cupons < 30) continue;
    const d = m30[k] / p30[k] - 1;
    if (d <= -0.15) out.push({ tipo: 'queda', gravidade: 1, texto: `${nome} caiu ${Math.round(Math.abs(d) * 100)}% nos últimos 30 dias em relação aos 30 anteriores.` });
  }
  // 3) ritmo da meta no mês
  const ym = ultimo.slice(0, 7);
  const meta = metaMes(loja, ym, metaPlanilha, vendas);
  const diaMes = +ultimo.slice(8, 10), n = diasNoMes(ym);
  if (meta && diaMes >= 5) {
    const mes = metricas(entre(vendas, ym + '-01', ultimo));
    const proj = (mes.metaLoja / diaMes) * n;
    if (proj < meta * 0.9) {
      const falta = Math.max(0, meta - mes.metaLoja), rest = n - diaMes;
      out.push({ tipo: 'meta', gravidade: proj < meta * 0.75 ? 2 : 1, texto: `No ritmo atual o mês fecha em ${brl(proj)} (${Math.round((proj / meta) * 100)}% da meta de ${brl(meta)}).${rest ? ` Para bater, são ${brl(falta / rest)} por dia nos ${rest} dias restantes.` : ''}` });
    } else if (mes.metaLoja >= meta) out.push({ tipo: 'alta', gravidade: 0, texto: `Meta do mês batida: ${brl(mes.metaLoja)} de ${brl(meta)}.` });
  }
  // 4) vendedores abaixo da meta individual nos 3 últimos meses fechados
  const semMeta = new Set([...(loja.regras && Array.isArray(loja.regras.semMeta) ? loja.regras.semMeta : SEM_META_PADRAO), 'sem vendedor'].map((x) => x.toLowerCase()));
  const fechados = [];
  for (let k = 1; k <= 3; k++) { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 - k, 1)); fechados.push(d.toISOString().slice(0, 7)); }
  const abaixo = new Map();
  for (const fm of fechados) {
    const mt = metaMes(loja, fm, metaPlanilha, vendas);
    if (!mt) { abaixo.clear(); break; }
    const mv = entre(vendas, fm + '-01', `${fm}-${diasNoMes(fm)}`).filter((v) => v.grupoC !== EG && v.cat !== EG);
    const porV = new Map();
    for (const v of mv) {
      if (!(G_AROM.has(v.grupoC) || G_PURO.has(v.grupoC) || G_ACESS.has(v.grupoC))) continue;
      porV.set(v.vendedor, (porV.get(v.vendedor) || 0) + (v.vt || 0));
    }
    const eleg = [...porV].filter(([n, x]) => x > 0 && !semMeta.has(String(n).toLowerCase()));
    if (!eleg.length) { abaixo.clear(); break; }
    const mis = metasIndividuais(mt, fm, eleg.map(([n]) => n), loja.ferias || []);
    for (const [nome, x] of eleg) if (x < (mis.get(String(nome).trim().toUpperCase()) || 0)) abaixo.set(nome, (abaixo.get(nome) || 0) + 1);
  }
  for (const [nome, c] of abaixo) if (c === 3) out.push({ tipo: 'vendedor', gravidade: 1, texto: `${nome} ficou abaixo da meta individual nos últimos 3 meses (${fechados.slice().reverse().map((x) => x.slice(5) + '/' + x.slice(2, 4)).join(', ')}).` });
  return out.sort((a, b) => b.gravidade - a.gravidade);
}

// ======================= RESUMO DIÁRIO =======================
function resumoDiario({ loja, vendas, metaPlanilha }) {
  const brl = (x) => 'R$ ' + Math.round(x || 0).toLocaleString('pt-BR');
  const br2 = (x) => (x == null ? '—' : 'R$ ' + x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pct = (x) => (x == null || !isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`);
  if (!vendas.length) return { titulo: loja.nome, linhas: ['Ainda sem vendas registradas.'], alertas: [] };
  const hoje = hojeSP().iso;
  const ontem = isoDia(diaIso(hoje) - 1);
  const ultimo = vendas.reduce((m, v) => (v.data > m ? v.data : m), '');
  const dia = ultimo >= ontem ? ontem : ultimo; // resumo do dia anterior (ou do último com vendas)
  const d = metricas(entre(vendas, dia, dia));
  const sem = metricas(entre(vendas, isoDia(diaIso(dia) - 7), isoDia(diaIso(dia) - 7)));
  const ym = dia.slice(0, 7);
  const mes = metricas(entre(vendas, ym + '-01', dia));
  const meta = metaMes(loja, ym, metaPlanilha, vendas);
  const diaMes = +dia.slice(8, 10), n = diasNoMes(ym);
  const proj = (mes.metaLoja / diaMes) * n;
  const nomeDia = new Date(dia + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  const linhas = [
    `📅 ${nomeDia}${dia !== ontem ? ' (último dia com vendas)' : ''}`,
    `💰 Faturamento: ${brl(d.vt)} (${pct(sem.vt ? d.vt / sem.vt - 1 : null)} vs. mesma dia da semana passada)`.replace('mesma dia', 'mesmo dia'),
    `🧾 ${d.cupons} atendimentos · TKM ${br2(d.tkm)} · IPA ${d.ipa == null ? '—' : d.ipa.toFixed(2).replace('.', ',')}`,
    `🍵 Chá: ${d.kg.toFixed(2).replace('.', ',')} kg`,
    '',
    `📈 Mês até agora: ${brl(mes.metaLoja)} em chás e acessórios${meta ? ` (${Math.round((mes.metaLoja / meta) * 100)}% da meta de ${brl(meta)})` : ''}`,
    meta && diaMes < n ? `🔮 Projeção: ${brl(proj)} (${Math.round((proj / meta) * 100)}% da meta)${proj < meta ? ` · faltam ${brl((meta - mes.metaLoja) / (n - diaMes))}/dia` : ''}` : null,
  ].filter((x) => x != null);
  return { titulo: loja.nome, dia, linhas, alertas: alertas({ loja, vendas, metaPlanilha }) };
}

module.exports = { metaMes, totaisSemEG, metricas, rede, alertas, resumoDiario, hojeSP, MIN_LOJAS_REDE };
