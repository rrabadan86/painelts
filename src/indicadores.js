'use strict';
/**
 * Indicadores calculados no servidor (mesmas definições do painel):
 *  - comparativo anônimo com a rede
 *  - alertas inteligentes
 *  - resumo diário (Telegram / e-mail)
 */
// Definições oficiais (faturamento, vendas da meta, atendimentos, projeção, divisão da meta): as MESMAS das telas
const CT = require('../public/js/contas');
const EG = CT.EG;
const SEM_META_PADRAO = ['amanda oliveira', 'corporativo', 'adriane puccini', 'sem vendedor', ''];

const DIA = 86400000;
const isoDia = (d) => new Date(d * DIA).toISOString().slice(0, 10);
const diaIso = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / DIA);
const diasNoMes = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
function hojeSP() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

/**
 * Indicadores de um conjunto de vendas pela definição única (public/js/contas.js):
 * vt = faturamento da loja (com Espaço Gourmet e vendas sem vendedor; sem taxas e sem itens a R$ 0,01);
 * metaLoja = vendas da meta (chá aromatizado, chá puro e acessórios, sem Espaço Gourmet); cupons = cupons únicos.
 */
function metricas(vendas) {
  const r = CT.resumo(vendas);
  const lv = r.vendasMeta;
  return { vt: r.fat, cupons: r.cupons, qtd: r.itens, tkm: r.tkm, pma: r.pma, ipa: r.ipa, kg: r.kg, pctEG: r.fat ? r.eg / r.fat : null, arom: r.arom, puro: r.puro, acess: r.acess,
    lojaVend: lv, pctPuro: lv ? r.puro / lv : null, pctAcess: lv ? r.acess / lv : null, metaLoja: lv };
}
/** a loja abre neste dia? Dia da semana fechado no horário de funcionamento ou data marcada como fechada.
 *  (Os feriados nacionais sem horário próprio só existem na tela; aqui contam como dia normal.) */
const DIAS_OP = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
function lojaAberta(loja, iso) {
  const esp = loja && loja.feriadosHorario && loja.feriadosHorario[iso];
  if (esp) return !esp.fechado;
  const func = loja && loja.operacao && loja.operacao.funcionamento;
  const f = func && func[DIAS_OP[new Date(iso + 'T12:00:00Z').getUTCDay()]];
  return !(f && f.fechado);
}
/**
 * Projeção do mês pela conta única (CT.projecaoMes): vendas até `ate` (último dia COMPLETO) + cada dia que falta pela média
 * do mesmo dia da semana nas últimas 8 semanas. base: 'meta' (vendas da meta) | 'loja' (faturamento da loja).
 */
function projecaoMes({ loja, vendas, ym, ate, base = 'meta' }) {
  const de = isoDia(diaIso(ate) - 62), porDia = new Map();
  let inicio = null;
  for (const v of vendas) {
    if (!v.data) continue;
    if (!inicio || v.data < inicio) inicio = v.data;
    if (v.data < de || v.data > ate || !CT.contaFat(v.descricao, v.vu)) continue;
    const x = base === 'loja' ? v.vt || 0 : CT.classeMeta(v.grupoC, v.cat) ? v.vt || 0 : 0;
    if (x) porDia.set(v.data, (porDia.get(v.data) || 0) + x);
  }
  if (!inicio) return null;
  return CT.projecaoMes({ ym, ate, valorDia: (iso) => porDia.get(iso) || 0, aberto: (iso) => lojaAberta(loja, iso), inicio });
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
/** vendas da meta por mês (aromatizado + puro + acessórios, sem Espaço Gourmet: CT.resumo) — Configurações → Metas (META-CFG-01) */
const cacheVM = new WeakMap();
function vendasMetaPorMes(vendas) {
  let t = cacheVM.get(vendas);
  if (!t) {
    const por = new Map();
    for (const v of vendas) { if (!v.data) continue; const ym = v.data.slice(0, 7); let a = por.get(ym); if (!a) por.set(ym, (a = [])); a.push(v); }
    t = {};
    for (const [ym, a] of por) t[ym] = Math.round(CT.resumo(a).vendasMeta * 100) / 100;
    cacheVM.set(vendas, t);
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

/** meta individual com férias: a mesma função das telas (public/js/contas.js) → Map(NOME → meta) */
const metasIndividuais = (metaLoja, ym, nomes, ferias) => CT.metasIndividuais(metaLoja, ym, nomes, ferias).metas;

// ======================= REDE (anônimo) =======================
const METRICAS_REDE = [
  ['vt', 'Faturamento', 'brl0'], ['cupons', 'Atendimentos (cupons)', 'int'], ['tkm', 'Ticket médio (TKM)', 'brl'], ['pma', 'Preço médio (PMA)', 'brl'],
  ['ipa', 'Itens por atendimento (IPA)', 'n2'], ['kg', 'Chá vendido (kg)', 'kg'], ['pctPuro', 'Chá puro (% da loja)', 'pct'], ['pctAcess', 'Acessórios (% da loja)', 'pct'], ['pctEG', 'Espaço Gourmet (% do faturamento)', 'pct'],
  ['cresc', 'Crescimento vs. mesmo mês do ano anterior', 'delta'], ['pctMeta', 'Ritmo da meta', 'pct'],
  ['ret90', 'Clientes novos que voltaram em 90 dias', 'pct'],
];
/**
 * Retenção: dos clientes (CPF na nota) que compraram pela 1ª vez nos 12 meses que terminam 90 dias antes de "ate",
 * quantos % voltaram a comprar em até 90 dias. A data de cada cupom com CPF vem das vendas (pelo nº do cupom).
 * Com menos de 20 clientes novos, não calcula (o número não diria nada).
 */
function retencao90(vendas, xml, ate) {
  if (!Array.isArray(xml) || !xml.length) return null;
  const DIAms = 864e5;
  // o número do cupom se repete (a numeração do caixa recomeça): a chave é cupom|dia, como no navegador (chaveCupom).
  // Só quando o XML não traz a data, ou ela não bate com nenhuma venda, vale o número — e só se ele aparece num dia só.
  const diaDe = (s) => Math.floor(Date.parse(String(s).slice(0, 10) + 'T00:00:00Z') / DIAms);
  const chaves = new Set(), diasCupom = new Map();
  for (const v of vendas) {
    if (v.cupom == null) continue;
    const d = diaDe(v.data);
    if (!Number.isFinite(d)) continue;
    chaves.add(v.cupom + '|' + d);
    (diasCupom.get(v.cupom) || diasCupom.set(v.cupom, new Set()).get(v.cupom)).add(d);
  }
  const porCpf = new Map();
  for (const x of xml) {
    if (!x.cpf) continue;
    const dx = x.data ? diaDe(x.data) : NaN;
    let d = null;
    if (Number.isFinite(dx) && chaves.has(x.cupom + '|' + dx)) d = dx;
    else { const ds = diasCupom.get(x.cupom); if (ds && ds.size === 1) d = [...ds][0]; }
    if (d == null || !Number.isFinite(d)) continue;
    (porCpf.get(x.cpf) || porCpf.set(x.cpf, []).get(x.cpf)).push(d);
  }
  const fim = Math.floor(Date.parse(String(ate).slice(0, 10) + 'T00:00:00Z') / DIAms);
  let n = 0, voltaram = 0;
  for (const ds of porCpf.values()) {
    const p = Math.min(...ds);
    if (p > fim - 90 || p <= fim - 455) continue;
    n++;
    if (ds.some((d) => d > p && d <= p + 90)) voltaram++;
  }
  return n >= 20 ? voltaram / n : null;
}
const MIN_LOJAS_REDE = 4; // com menos lojas, a média revelaria demais sobre cada uma

/**
 * partes: [{ id, loja (config), vendas, metaPlanilha }]
 * Devolve média, mediana e "melhores 25%" de cada indicador, e a posição da loja pedida.
 * Nunca devolve valores de outra loja isoladamente.
 */
/** REDE-02 (pedido do dono, 25/11/2026: "não leva em conta os filtros"): per = { de, ate } (AAAA-MM-DD) compara o período
 *  do filtro; sem per, o mês ym inteiro. O crescimento é contra os mesmos dias do ano anterior; o ritmo da meta só existe
 *  quando o período fica dentro de um mês (a meta é mensal). */
function rede(partes, ym, lojaId, minimo = MIN_LOJAS_REDE, per = null) {
  if (per && per.de && per.ate) ym = per.ate.slice(0, 7);
  const de = per && per.de ? per.de : ym + '-01', ate = per && per.ate ? per.ate : `${ym}-${String(diasNoMes(ym)).padStart(2, '0')}`;
  const umMes = de.slice(0, 7) === ate.slice(0, 7);
  const anoAnt = (iso) => `${+iso.slice(0, 4) - 1}${iso.slice(4)}`;
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
    const ant = metricas(entre(p.vendas, anoAnt(de), anoAnt(corte)));
    m.cresc = ant.vt ? m.vt / ant.vt - 1 : null;
    const meta = umMes ? metaMes(p.loja, ym, p.metaPlanilha, p.vendas) : null;
    // ritmo da meta: mês fechado = vendas da meta ÷ meta; mês em andamento = projeção das vendas da meta ÷ meta
    // (a mesma projeção das telas, com todas as lojas cortadas no mesmo dia)
    const pj = corte < ate ? projecaoMes({ loja: p.loja, vendas: p.vendas, ym, ate: corte, base: 'meta' }) : null;
    m.pctMeta = !meta ? null : pj && pj.proj != null ? pj.proj / meta : m.metaLoja / meta;
    m.ret90 = retencao90(p.vendas, p.xml, corte);
    return { id: p.id, m };
  });
  const out = { ym, de, ate: corte, periodo: !!per, parcial: corte < ate, lojas: vals.length, minimo, indicadores: [] };
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
function alertas({ loja, vendas, metaPlanilha, hoje }) {
  if (!vendas.length) return [];
  const ultimoDado = vendas.reduce((m, v) => (v.data > m ? v.data : m), '');
  // o dia de hoje ainda está acontecendo: as comparações fecham no último dia COMPLETO (não misturam dia parcial com dia cheio)
  const hj = hoje || hojeSP().iso;
  const primeiro = vendas.reduce((m, v) => (v.data && v.data < m ? v.data : m), ultimoDado);
  const ultimo = ultimoDado >= hj && primeiro < hj ? isoDia(diaIso(hj) - 1) : ultimoDado;
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
  // 2) indicadores dos últimos 28 dias vs. 28 anteriores (4 semanas inteiras: a mesma quantidade de cada dia da semana)
  const m30 = metricas(entre(vendas, isoDia(u - 27), ultimo)), p30 = metricas(entre(vendas, isoDia(u - 55), isoDia(u - 28)));
  for (const [k, nome] of [['tkm', 'O ticket médio (TKM)'], ['ipa', 'Os itens por atendimento (IPA)']]) {
    if (!m30[k] || !p30[k] || m30.cupons < 30) continue;
    const d = m30[k] / p30[k] - 1;
    if (d <= -0.15) out.push({ tipo: 'queda', gravidade: 1, texto: `${nome} caiu ${Math.round(Math.abs(d) * 100)}% nos últimos 28 dias em relação aos 28 anteriores.` });
  }
  // 3) ritmo da meta no mês
  const ym = ultimo.slice(0, 7);
  const meta = metaMes(loja, ym, metaPlanilha, vendas);
  const diaMes = +ultimo.slice(8, 10), n = diasNoMes(ym);
  if (meta && diaMes >= 5) {
    const mes = metricas(entre(vendas, ym + '-01', ultimo));
    // projeção única (vendas da meta até o último dia completo + cada dia que falta pela média do dia da semana)
    const pj = diaMes < n ? projecaoMes({ loja, vendas, ym, ate: ultimo, base: 'meta' }) : null;
    const proj = pj && pj.proj != null ? pj.proj : mes.metaLoja;
    if (proj < meta * 0.9) {
      const falta = Math.max(0, meta - mes.metaLoja), rest = pj ? pj.restantes : 0;
      out.push({ tipo: 'meta', gravidade: proj < meta * 0.75 ? 2 : 1, texto: `No ritmo atual as vendas da meta fecham o mês em ${brl(proj)} (${Math.round((proj / meta) * 100)}% da meta de ${brl(meta)}).${rest ? ` Para bater, são ${brl(falta / rest)} por dia nos ${rest} dias de loja aberta que faltam.` : ''}` });
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
    const fimFm = `${fm}-${String(diasNoMes(fm)).padStart(2, '0')}`;
    const mv = entre(vendas, fm + '-01', fimFm).filter((v) => v.grupoC !== EG && v.cat !== EG);
    const porV = new Map(), diasV = new Map();
    for (const v of mv) {
      // dias com venda (qualquer produto da loja, sem Espaço Gourmet): o piso de quem divide a meta, como no Comissionamento
      if ((v.vt || 0) > 0) (diasV.get(v.vendedor) || diasV.set(v.vendedor, new Set()).get(v.vendedor)).add(v.data);
      if (!CT.classeMeta(v.grupoC, v.cat)) continue;
      porV.set(v.vendedor, (porV.get(v.vendedor) || 0) + (v.vt || 0));
    }
    const comMeta = (n) => !semMeta.has(String(n).trim().toLowerCase());
    const eleg = [...porV].filter(([n, x]) => x > 0 && comMeta(n));
    if (!eleg.length) { abaixo.clear(); break; }
    // quem divide a meta: a mesma regra das telas (piso de dias com venda; mês fechado = piso inteiro)
    const div = CT.divisoresMeta({ dias: [...diasV].filter(([n]) => comMeta(n)).map(([n, d]) => [n, d.size]), piso: loja.regras && loja.regras.pisoDiasMeta, ym: fm, ultimoDia: fimFm });
    const mis = metasIndividuais(mt, fm, div.dentro, loja.ferias || []);
    const metaDosDemais = div.dentro.length ? mt / div.dentro.length : 0;
    for (const [nome, x] of eleg) if (x < (mis.get(String(nome).trim().toUpperCase()) ?? metaDosDemais)) abaixo.set(nome, (abaixo.get(nome) || 0) + 1);
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
  // projeção única: vendas da meta até o dia do resumo (dia completo) + cada dia que falta pela média do dia da semana
  const pj = diaMes < n ? projecaoMes({ loja, vendas, ym, ate: dia, base: 'meta' }) : null;
  const proj = pj && pj.proj != null ? pj.proj : mes.metaLoja;
  const nomeDia = new Date(dia + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  const linhas = [
    `📅 ${nomeDia}${dia !== ontem ? ' (último dia com vendas)' : ''}`,
    `💰 Faturamento: ${brl(d.vt)} (${pct(sem.vt ? d.vt / sem.vt - 1 : null)} vs. mesma dia da semana passada)`.replace('mesma dia', 'mesmo dia'),
    `🧾 ${d.cupons} atendimentos · TKM ${br2(d.tkm)} · IPA ${d.ipa == null ? '—' : d.ipa.toFixed(2).replace('.', ',')}`,
    `🍵 Chá: ${d.kg.toFixed(2).replace('.', ',')} kg`,
    '',
    `📈 Mês até agora: faturamento ${brl(mes.vt)} · vendas da meta (chás e acessórios) ${brl(mes.metaLoja)}${meta ? ` = ${Math.round((mes.metaLoja / meta) * 100)}% da meta de ${brl(meta)}` : ''}`,
    meta && pj ? `🔮 Projeção das vendas da meta: ${brl(proj)} (${Math.round((proj / meta) * 100)}% da meta)${proj < meta && pj.restantes ? ` · faltam ${brl((meta - mes.metaLoja) / pj.restantes)}/dia nos ${pj.restantes} dias de loja aberta` : ''}` : null,
  ].filter((x) => x != null);
  return { titulo: loja.nome, dia, linhas, alertas: alertas({ loja, vendas, metaPlanilha }) };
}

module.exports = { retencao90, metaMes, totaisSemEG, vendasMetaPorMes, metricas, projecaoMes, lojaAberta, rede, alertas, resumoDiario, hojeSP, MIN_LOJAS_REDE };
