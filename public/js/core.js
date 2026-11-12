/* Núcleo: dados, filtros, agregação e formatação */
'use strict';

const TS = (window.TS = {
  db: null,          // dados decodificados
  state: {
    page: 'resumo',
    f: {             // filtros gerais
      lojas: new Set(), vendedores: new Set(), grupos: new Set(), cats: new Set(),
      de: null, ate: null, preset: '30d', ano: null, mes: null, produto: '', tamanhos: new Set(),
    },
    com: { meta: null, vendBonus: '', cupom: '' },
    promo: { dias: 30 },
    cli: { nome: '', cpf: '', cupom: '', produto: '', aniv: '', cidade: new Set(), grupos: new Set(), lojas: new Set(), visMin: '', visMax: '', ausMin: '', ausMax: '', de: '', ate: '', seg: '', ordem: 'recente' },
  },
});

// ---------- modo apresentação (/apresentacao: dados fictícios, sem login) ----------
TS.demo = /^\/apresentacao\/?$/.test(location.pathname);
TS.api = (p) => (TS.demo ? '/api/demo/' : '/api/') + p;

// ---------- formatação ----------
const nf = (d) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const NF0 = nf(0), NF1 = nf(1), NF2 = nf(2), NF3 = nf(3);
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BRL0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
TS.fmt = {
  int: (v) => (v == null || !isFinite(v) ? '—' : NF0.format(v)),
  n1: (v) => (v == null || !isFinite(v) ? '—' : NF1.format(v)),
  n2: (v) => (v == null || !isFinite(v) ? '—' : NF2.format(v)),
  kg: (v) => (v == null || !isFinite(v) ? '—' : NF3.format(v)),
  brl: (v) => (v == null || !isFinite(v) ? '—' : BRL.format(v)),
  brl0: (v) => (v == null || !isFinite(v) ? '—' : BRL0.format(v)),
  pct: (v, d = 1) => (v == null || !isFinite(v) ? '—' : nf(d).format(v * 100) + '%'),
  delta: (v) => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + NF1.format(v * 100) + '%'),
  date: (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'),
  compact: (v) => {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e6) return NF1.format(v / 1e6) + ' mi';
    if (a >= 1e3) return NF1.format(v / 1e3) + ' mil';
    return NF0.format(v);
  },
};
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS_SEMANA = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
TS.MESES = MESES;
TS.DIAS_SEMANA = DIAS_SEMANA;
TS.ymLabel = (ym) => `${MESES[+ym.slice(5, 7) - 1]}/${ym.slice(2, 4)}`;

// ---------- datas (dias desde 1970, em UTC) ----------
const DAY = 86400000;
TS.isoToDay = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);
TS.dayToIso = (d) => new Date(d * DAY).toISOString().slice(0, 10);
TS.todayDay = () => { const n = new Date(); return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY); };

// ---------- decodificação ----------
TS.decode = function (raw) {
  const v = raw.vendas, dict = raw.dict;
  const n = v.data.length;
  const day = new Int32Array(n), ym = new Array(n), year = new Int16Array(n), wd = new Int8Array(n);
  const ymIndex = new Map();
  for (let i = 0; i < n; i++) {
    const iso = v.data[i];
    const d = TS.isoToDay(iso);
    day[i] = d;
    year[i] = +iso.slice(0, 4);
    ym[i] = iso.slice(0, 7);
    wd[i] = (new Date(d * DAY).getUTCDay() + 6) % 7; // 0 = segunda
  }
  const db = {
    n, iso: v.data, day, ym, year, wd,
    cupom: v.cupom, min: v.min || [], qtd: v.qtd, so: v.soNumeros, cha: v.qtdCha, vu: v.vu, du: v.du, vt: v.vt,
    loja: v.loja, vend: v.vendedor, cod: v.cod || [], desc: v.descricao, prod: v.produto, grupo: v.grupo, grupoC: v.grupoC, cat: v.cat,
    D: dict,
    meta: raw.meta,
    metas: raw.metas || [],
    perfil: raw.perfil || 'completo',
    avisos: raw.avisos || [],
    geradoEm: raw.geradoEm,
    xml: raw.xml,
    clientes: raw.clientes,
  };
  // laço em vez de Math.min(...day): com muitas vendas (todas as lojas) o "..." estoura a pilha
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) { const d = day[i]; if (d < mn) mn = d; if (d > mx) mx = d; }
  db.minDay = n ? mn : TS.todayDay();
  db.maxDay = n ? mx : TS.todayDay();
  // índices de texto -> listas ordenadas para os filtros
  const sortedIdx = (name, skipEmpty = true) => dict[name].map((s, i) => [s, i]).filter(([s]) => !skipEmpty || s !== '').sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  db.opts = {
    lojas: sortedIdx('loja'),
    vendedores: sortedIdx('vendedor'),
    grupos: sortedIdx('grupoC'),
    cats: sortedIdx('cat').filter(([s]) => s !== '-'),
  };
  // id do texto "SEM VENDEDOR" etc.
  db.idOf = (name, text) => dict[name].indexOf(text);
  return db;
};

// ---------- meta do mês ----------
/** meta das lojas do filtro no mês do fim do período (meta do mês cadastrada, senão a padrão) */
TS.metaPeriodo = function () {
  const db = TS.db, f = TS.state.f;
  const fim = Math.min(f.ate ?? db.maxDay, db.maxDay);
  const ym = TS.dayToIso(fim).slice(0, 7);
  const nomesSel = f.lojas.size ? new Set([...f.lojas].map((i) => db.D.loja[i])) : null;
  const r = TS.metaCalc(ym, nomesSel);
  return { valor: r.valor, ym, doMes: r.origem === 'mes', origem: r.origem };
};

/** vendas sem o grupo Espaço Gourmet por loja (nome nas vendas) e mês */
TS.totaisSemEG = function () {
  const db = TS.db;
  if (db._totSemEG) return db._totSemEG;
  const eg = db.D.grupoC.indexOf('ESPAÇO GOURMET');
  const m = new Map();
  for (let i = 0; i < db.n; i++) {
    if (db.grupoC[i] === eg) continue;
    const l = db.D.loja[db.loja[i]];
    let t = m.get(l); if (!t) m.set(l, (t = {}));
    t[db.ym[i]] = (t[db.ym[i]] || 0) + (db.vt[i] || 0);
  }
  return (db._totSemEG = m);
};
/**
 * meta de um mês somando as lojas: 1º) digitada no mês; 2º) automática (mesmo mês do ano anterior
 * sem Espaço Gourmet + %); 3º) padrão. origem = 'mes' | 'auto' | 'padrao' | 'misto'
 */
TS.metaCalc = function (ym, nomes) {
  const db = TS.db;
  const ymAnt = `${+ym.slice(0, 4) - 1}${ym.slice(4)}`;
  let valor = null; const origens = new Set();
  for (const m of db.metas) {
    if (nomes && !m.nomesVenda.some((n) => nomes.has(n))) continue;
    let v = null, o = 'padrao';
    if (m.meses && m.meses[ym] != null) { v = m.meses[ym]; o = 'mes'; }
    else if (m.metaAuto && m.metaAuto.ativo) {
      const tot = TS.totaisSemEG();
      const base = m.nomesVenda.reduce((s, n) => s + ((tot.get(n) || {})[ymAnt] || 0), 0);
      if (base > 0) { v = Math.round(base * (1 + (m.metaAuto.pct || 0) / 100)); o = 'auto'; }
    }
    if (v == null) v = m.padrao;
    if (v != null) { valor = (valor || 0) + v; origens.add(o); }
  }
  if (!db.metas.length && db.meta != null) { valor = db.meta; origens.add('padrao'); }
  return { valor, origem: origens.size === 1 ? [...origens][0] : origens.size ? 'misto' : null };
};

// ---------- filtros ----------
/**
 * Devolve os índices das vendas que passam nos filtros gerais.
 * opts: { ignorar: ['vendedores', 'datas', ...], de, ate (dias), extra: (i) => bool }
 */
TS.filtrar = function (opts = {}) {
  const db = TS.db, f = TS.state.f, ign = new Set(opts.ignorar || []);
  const de = opts.de ?? f.de, ate = opts.ate ?? f.ate;
  const useDates = !ign.has('datas');
  // só o mês escolhido (sem ano) = aquele mês em todos os anos (também nas comparações deslocadas em 1 ano)
  const soMes = useDates && !opts.mesLivre && f.mes && !f.ano ? String(f.mes).padStart(2, '0') : null;
  const sets = {
    loja: !ign.has('lojas') && f.lojas.size ? f.lojas : null,
    vend: !ign.has('vendedores') && f.vendedores.size ? f.vendedores : null,
    grupoC: !ign.has('grupos') && f.grupos.size ? f.grupos : null,
    cat: !ign.has('cats') && f.cats.size ? f.cats : null,
  };
  const tamanhos = opts.usarTamanho && f.tamanhos.size ? f.tamanhos : null;
  const prod = !ign.has('produto') && f.produto ? f.produto.toLowerCase() : null;
  let prodOk = null;
  if (prod) {
    prodOk = new Uint8Array(db.D.descricao.length);
    db.D.descricao.forEach((s, i) => { if (s.toLowerCase().includes(prod)) prodOk[i] = 1; });
  }
  const extra = opts.extra;
  const out = [];
  for (let i = 0; i < db.n; i++) {
    if (useDates && ((de != null && db.day[i] < de) || (ate != null && db.day[i] > ate))) continue;
    if (soMes && db.iso[i].slice(5, 7) !== soMes) continue;
    if (sets.loja && !sets.loja.has(db.loja[i])) continue;
    if (sets.vend && !sets.vend.has(db.vend[i])) continue;
    if (sets.grupoC && !sets.grupoC.has(db.grupoC[i])) continue;
    if (sets.cat && !sets.cat.has(db.cat[i])) continue;
    if (prodOk && !prodOk[db.desc[i]]) continue;
    if (tamanhos && !tamanhos.has(db.so[i])) continue;
    if (extra && !extra(i)) continue;
    out.push(i);
  }
  return out;
};

/** Agrupa índices por chave e calcula as métricas básicas */
TS.metricas = function (idx) {
  const db = TS.db;
  let vt = 0, qtd = 0, cha = 0, du = 0;
  const cupons = new Set();
  for (const i of idx) {
    vt += db.vt[i] || 0;
    qtd += db.qtd[i] || 0;
    cha += db.cha[i] || 0;
    du += db.du[i] || 0;
    cupons.add(TS.chaveCupom(i));
  }
  return { vt, qtd, cha, du, cupons: cupons.size, linhas: idx.length };
};

TS.agrupar = function (idx, keyFn) {
  const m = new Map();
  for (const i of idx) {
    const k = keyFn(i);
    if (k === undefined) continue;
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(i);
  }
  return m;
};

/**
 * Cupons únicos como no DAX [CuponsUnicos]: quando há vários vendedores,
 * soma os cupons distintos de cada vendedor (um cupom com 2 vendedores conta 2x).
 */
TS.cuponsUnicos = function (idx) {
  const db = TS.db;
  const porVend = new Map();
  for (const i of idx) {
    let s = porVend.get(db.vend[i]);
    if (!s) porVend.set(db.vend[i], (s = new Set()));
    s.add(TS.chaveCupom(i));
  }
  let t = 0;
  for (const s of porVend.values()) t += s.size;
  return t;
};

/** TKM, PMA e IPA como no relatório */
TS.indicadores = function (idx) {
  const db = TS.db;
  let vt = 0, qtd = 0;
  for (const i of idx) { vt += db.vt[i] || 0; qtd += db.qtd[i] || 0; }
  const cup = TS.cuponsUnicos(idx);
  return { vt, qtd, cupons: cup, tkm: cup ? vt / cup : null, pma: qtd ? vt / qtd : null, ipa: cup ? qtd / cup : null };
};

/** cupom + loja: o número do cupom pode se repetir entre lojas */
TS.chaveCupom = (i) => TS.db.cupom[i] * 64 + TS.db.loja[i];

TS.soma = (idx, col) => { let s = 0; const a = TS.db[col]; for (const i of idx) s += a[i] || 0; return s; };

// ---------- utilidades de DOM ----------
TS.h = function (tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
};
TS.debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
TS.norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
