'use strict';
/**
 * Dados FICTÍCIOS para a página pública /apresentacao.
 * Usa o perfil (catálogo + cestas de compra + sazonalidade) de demo/perfil.json e inventa
 * lojas, vendedores, cupons e clientes. Mesma semente = mesmo histórico todo dia;
 * só o dia de hoje cresce ao longo do expediente.
 */
const fs = require('fs');
const path = require('path');
const { juntar, pack } = require('./sources');

const PERFIL = path.join(__dirname, '..', 'demo', 'perfil.json');
const TZ = 'America/Sao_Paulo';

const LOJAS = [
  { id: 'demo-centro', nome: 'Tea Shop Centro', loja: 'VALE DO SOL - TEA SHOP CENTRO', cidade: 'Vale do Sol', escala: 1.0, sazonal: 0.45, cresc: 1.09, abre: 0, semente: 11 },
  { id: 'demo-parque', nome: 'Tea Shop Shopping Parque', loja: 'VALE DO SOL - TEA SHOP SHOPPING PARQUE', cidade: 'Vale do Sol', escala: 1.65, sazonal: 0.3, cresc: 1.06, abre: 0, semente: 23 },
  { id: 'demo-orla', nome: 'Tea Shop Orla', loja: 'PRAIA SERENA - TEA SHOP ORLA', cidade: 'Praia Serena', escala: 0.95, sazonal: 1.0, cresc: 1.14, abre: 120, semente: 37 },
];

// horário de funcionamento e equipe das lojas fictícias (seg..dom)
const H = (abre, fecha) => ({ abre, fecha, fechado: false });
const FECHADO = { abre: '09:00', fecha: '18:00', fechado: true };
const OPERACAO = {
  'demo-centro': { funcionamento: { seg: H('09:00', '19:00'), ter: H('09:00', '19:00'), qua: H('09:00', '19:00'), qui: H('09:00', '19:00'), sex: H('09:00', '19:00'), sab: H('09:00', '17:00'), dom: FECHADO, feriado: { mesmoDoDia: false, fechado: true, abre: '10:00', fecha: '14:00' } }, equipe: { funcionarios: 3, cargaSemanal: 44, escala: '5x2', intervalo: 60, capacidade: 3 } },
  'demo-parque': { funcionamento: { seg: H('10:00', '22:00'), ter: H('10:00', '22:00'), qua: H('10:00', '22:00'), qui: H('10:00', '22:00'), sex: H('10:00', '22:00'), sab: H('10:00', '22:00'), dom: H('14:00', '20:00'), feriado: { mesmoDoDia: false, fechado: false, abre: '14:00', fecha: '20:00' } }, equipe: { funcionarios: 4, cargaSemanal: 44, escala: '6x1', intervalo: 60, capacidade: 3, modelo: 'rodizio', minimoDia: { dom: 2 },
    pessoas: [{ nome: 'Lívia', folga: 'qua', folga2: 'auto', turno: 'noite' }, { nome: 'Gabi', folga: 'qui', folga2: 'auto', turno: 'manha' }, { nome: 'Renata', folga: 'sex', folga2: 'auto', turno: 'tanto' }, { nome: 'Bia', folga: 'ter', folga2: 'auto', turno: 'manha' }] } },
  'demo-orla': { funcionamento: { seg: H('10:00', '20:00'), ter: H('10:00', '20:00'), qua: H('10:00', '20:00'), qui: H('10:00', '20:00'), sex: H('10:00', '22:00'), sab: H('09:00', '22:00'), dom: H('09:00', '21:00') }, equipe: { funcionarios: 3, cargaSemanal: 44, escala: '5x2', intervalo: 60, capacidade: 3 } },
};
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']; // getUTCDay()
const hm = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
/** sorteia o minuto do cupom: picos no almoço e no fim da tarde (e à noite no shopping) */
function minutoVenda(r, L, dow) {
  const f = OPERACAO[L.id].funcionamento[DIAS[dow]];
  if (!f || f.fechado) return null;
  const a = hm(f.abre), b = hm(f.fecha);
  const fimDeSemana = dow === 0 || dow === 6;
  const picos = L.id === 'demo-parque' ? [[12.8, 1.1, 1.0], [16.5, 1.6, fimDeSemana ? 1.6 : 0.9], [19.6, 1.2, 1.3]]
    : L.id === 'demo-orla' ? [[11.5, 1.4, 0.8], [16.5, 2.0, fimDeSemana ? 1.8 : 1.1], [20, 1.0, 0.6]]
      : [[12.5, 0.9, 1.4], [17.3, 1.1, 1.1]];
  for (let t = 0; t < 50; t++) {
    const x = a + r() * (b - a), hh = x / 60;
    const w = 0.35 + picos.reduce((s, [c, sd, amp]) => s + amp * Math.exp(-((hh - c) ** 2) / (2 * sd * sd)), 0);
    if (r() * 2.6 < w) return Math.min(b - 1, Math.floor(x));
  }
  return Math.floor(a + r() * (b - a));
}

const NOMES = ['ANA', 'BRUNA', 'CAMILA', 'DANIELA', 'ELISA', 'FERNANDA', 'GABRIELA', 'HELENA', 'ISABELA', 'JULIANA', 'LARISSA', 'MARINA', 'NATALIA', 'PATRICIA', 'RAFAELA', 'SOFIA', 'TALITA', 'VANESSA', 'BEATRIZ', 'CAROLINA',
  'LUCAS', 'MATEUS', 'PEDRO', 'RAFAEL', 'THIAGO', 'GUSTAVO', 'BRUNO', 'DIEGO', 'FELIPE', 'LEONARDO', 'VINICIUS', 'ANDRE', 'RENATO', 'CAIO', 'EDUARDO', 'MARCELO'];
const SOBRENOMES = ['ALMEIDA', 'BARBOSA', 'CARDOSO', 'CASTRO', 'DIAS', 'FARIAS', 'FERREIRA', 'GOMES', 'LIMA', 'MACHADO', 'MARTINS', 'MELO', 'MONTEIRO', 'MOREIRA', 'NUNES', 'OLIVEIRA', 'PEREIRA', 'PINTO', 'RAMOS',
  'RIBEIRO', 'ROCHA', 'SANTOS', 'SILVA', 'SOUZA', 'TEIXEIRA', 'VIEIRA', 'CAVALCANTI', 'DUARTE', 'FREITAS', 'MENDES', 'AZEVEDO', 'CORREIA', 'LOPES', 'MOURA', 'PIRES', 'REIS'];
const CIDADES_EXTRA = ['Vale do Sol', 'Praia Serena', 'Campo Alegre do Norte', 'Serra Azul do Leste', 'Lagoa Clara'];

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
function poisson(r, l) {
  if (l <= 0) return 0;
  if (l > 40) return Math.max(0, Math.round(l + Math.sqrt(l) * gauss(r)));
  let k = 0, p = 1; const L = Math.exp(-l);
  do { k++; p *= r(); } while (p > L);
  return k - 1;
}
function gauss(r) { return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }
const DAY = 86400000;
const iso = (d) => new Date(d * DAY).toISOString().slice(0, 10);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

/** data e hora "agora" em São Paulo */
function agoraSP() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hora: +p.hour % 24 };
}

/** CPF fictício: 11 dígitos com dígito verificador propositalmente INVÁLIDO (não pertence a ninguém) */
function cpfFalso(r) {
  const n = Array.from({ length: 9 }, () => Math.floor(r() * 10));
  const dv = (arr, peso) => { const s = arr.reduce((t, x, i) => t + x * (peso - i), 0) % 11; return s < 2 ? 0 : 11 - s; };
  const d1 = dv(n, 10), d2 = dv([...n, d1], 11);
  return n.join('') + d1 + ((d2 + 1 + Math.floor(r() * 8)) % 10);
}
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let perfil = null;
function carregarPerfil() {
  if (!perfil) {
    const p = JSON.parse(fs.readFileSync(PERFIL, 'utf8'));
    // cestas por mês do ano, para manter o mix sazonal (gelados no verão etc.)
    p.porMes = Array.from({ length: 12 }, () => []);
    p.cestas.forEach((c) => p.porMes[+c[0].slice(5, 7) - 1].push(c));
    p.receitaMedia = p.cestas.reduce((s, c) => s + c[1].reduce((t, it) => t + (it[4] || 0), 0), 0) / p.cestas.length;
    perfil = p;
  }
  return perfil;
}

function gerarLoja(L, ini, fim, horaHoje) {
  const P = carregarPerfil();
  const r = rng(L.semente * 7919);
  const abre = ini + L.abre;
  // equipe com rotatividade: 2 a 3 fixos + entradas e saídas
  const equipe = [];
  const usados = new Set();
  const novoNome = () => { let n; do n = `${pick(r, NOMES)} ${pick(r, SOBRENOMES)}`; while (usados.has(n)); usados.add(n); return n; };
  for (let k = 0; k < 3; k++) equipe.push({ nome: novoNome(), de: abre, ate: fim + 1, peso: 1 + r() });
  for (let d = abre + 40 + Math.floor(r() * 60); d < fim; d += 110 + Math.floor(r() * 140)) {
    const dur = 150 + Math.floor(r() * 420);
    equipe.push({ nome: novoNome(), de: d, ate: Math.min(fim + 1, d + dur), peso: 0.6 + r() });
  }
  const vendas = [], xml = [], clientes = [], bilhetes = [];
  let cupom = 1000 + Math.floor(r() * 4000);
  const anos = (fim - ini) / 365;
  for (let d = abre; d <= fim; d++) {
    const dt = new Date(d * DAY), m = dt.getUTCMonth(), md = iso(d).slice(5);
    if (md === '12-25' || md === '01-01') continue;
    if (OPERACAO[L.id].funcionamento[DIAS[dt.getUTCDay()]].fechado) continue;
    const saz = Math.pow(P.sazonalidade[m], L.sazonal);
    const tend = Math.pow(L.cresc, (d - fim) / 365) * (d - abre < 60 ? 0.6 + 0.4 * (d - abre) / 60 : 1);
    let lam = P.cuponsPorDia * L.escala * saz * P.semana[dt.getUTCDay()] * tend * Math.exp(0.18 * gauss(r));
    if (d === fim) lam *= Math.max(0, Math.min(1, (horaHoje - 9) / 13));
    const n = poisson(r, lam);
    const ativos = equipe.filter((v) => v.de <= d && d < v.ate);
    const pesoTot = ativos.reduce((s, v) => s + v.peso, 0);
    for (let k = 0; k < n; k++) {
      const cesta = pick(r, P.porMes[m].length ? P.porMes[m] : P.cestas);
      const fator = Math.pow(1.065, (d - Date.parse(cesta[0] + 'T00:00:00Z') / DAY) / 365);
      let x = r() * pesoTot, vend = ativos[0];
      for (const v of ativos) { x -= v.peso; if (x <= 0) { vend = v; break; } }
      cupom++;
      const data = iso(d);
      let min = minutoVenda(r, L, dt.getUTCDay());
      if (d === fim && min != null) min = Math.min(min, horaHoje * 60 + 59); // hoje: só até a hora atual
      for (const [pi, qtd, vu, du, vt, qtdCha] of cesta[1]) {
        const p = P.produtos[pi];
        const f = vu != null && vu < 0.05 ? 1 : fator; // brindes de fidelidade (R$ 0,01) ficam iguais
        vendas.push({ data, cupom, loja: L.loja, vendedor: vend ? vend.nome : '', descricao: p[0], produto: p[1], grupo: p[2], grupoC: p[3], cat: p[4], subgrupo: p[5],
          qtd, soNumeros: p[6], qtdCha, vu: r2(vu * f), du: r2(du * f), vt: r2(vt * f), min });
      }
      // ~38% dos cupons com CPF; clientes fiéis voltam mais
      if (r() < 0.38) {
        let c;
        if (bilhetes.length && r() < 0.58) c = clientes[pick(r, bilhetes)];
        else {
          const fem = r() < 0.68;
          const nome = `${pick(r, fem ? NOMES.slice(0, 20) : NOMES.slice(20))} ${pick(r, SOBRENOMES)} ${pick(r, SOBRENOMES)}`;
          const ano = 1955 + Math.floor(r() * 52);
          const nasc = r() < 0.85 ? `${ano}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}` : null;
          const partes = semAcento(nome).split(' ');
          c = { cpf: cpfFalso(r), nome, celular: `00 9${String(Math.floor(r() * 1e8)).padStart(8, '0')}`, nascimento: nasc,
            email: r() < 0.55 ? `${partes[0]}.${partes[1]}@exemplo.com` : '', cidade: r() < 0.8 ? L.cidade : pick(r, CIDADES_EXTRA) };
          const idx = clientes.push(c) - 1;
          const fidel = Math.floor(Math.pow(r(), 3) * 12) + 1;
          for (let t = 0; t < fidel; t++) bilhetes.push(idx);
        }
        xml.push({ cpf: c.cpf, cupom, loja: L.loja });
      }
    }
  }
  const meses = Math.max(1, (fim - abre) / 30.4);
  const receitaMes = vendas.filter((v) => v.data >= iso(fim - 365)).reduce((s, v) => s + (v.vt || 0), 0) / Math.min(12, meses);
  const meta = Math.round((receitaMes * 1.08) / 5000) * 5000;
  void anos;
  return { vendas, xml, clientes, meta, avisos: [], fontes: [{ nome: 'Dados fictícios', desc: 'demonstração', origem: null, ok: true }], lojaNome: L.nome };
}

let cache = { chave: null, partes: null, corpos: new Map() };
/** devolve { body, at } do pacote da loja pedida ('todas' = rede inteira) */
function pacoteDemo(id) {
  const { data, hora } = agoraSP();
  const chave = `${data}|${hora}`;
  if (cache.chave !== chave) {
    const fim = Math.floor(Date.parse(data + 'T00:00:00Z') / DAY);
    const ini = Math.floor(Date.UTC(+data.slice(0, 4) - 2, 0, 1) / DAY); // 1º de janeiro de 2 anos atrás → 3 anos no filtro
    const t0 = Date.now();
    const partes = LOJAS.map((L) => gerarLoja(L, ini, fim, hora));
    cache = { chave, partes, corpos: new Map(), at: Date.now() };
    console.log(`[demo] gerado ${data} ${hora}h: ${partes.reduce((s, p) => s + p.vendas.length, 0)} linhas em ${Date.now() - t0} ms`);
  }
  const k = LOJAS.some((L) => L.id === id) ? id : 'todas';
  if (!cache.corpos.has(k)) {
    const sel = k === 'todas' ? cache.partes : [cache.partes[LOJAS.findIndex((L) => L.id === k)]];
    const dados = sel.length === 1 ? { ...sel[0] } : juntar(sel);
    const idx = k === 'todas' ? LOJAS.map((_, i) => i) : [LOJAS.findIndex((L) => L.id === k)];
    // férias de exemplo: uma vendedora de cada loja tirou 10 dias no mês passado
    const feriasDemo = (i) => {
      const hoje = new Date(); const ant = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
      const nomes = [...new Set(cache.partes[i].vendas.filter((v) => v.data.startsWith(ant)).map((v) => v.vendedor))].filter(Boolean).sort();
      return nomes.length > 1 ? [{ vendedor: nomes[0], de: `${ant}-05`, ate: `${ant}-14` }] : [];
    };
    dados.metaCfgs = idx.map((i) => ({ id: LOJAS[i].id, nome: LOJAS[i].nome, nomesVenda: [LOJAS[i].loja], padrao: cache.partes[i].meta, meses: {}, metaAuto: { ativo: true, pct: 10 }, regras: null, operacao: OPERACAO[LOJAS[i].id], ferias: feriasDemo(i) }));
    dados.meta = dados.metaCfgs.reduce((s, m) => s + (m.padrao || 0), 0);
    cache.corpos.set(k, JSON.stringify(pack(dados, { loja: k, demo: true })));
  }
  return { body: cache.corpos.get(k), at: cache.at };
}

/** lojas fictícias no formato dos indicadores (rede/alertas) */
function partes() {
  pacoteDemo('todas');
  return cache.partes.map((p, i) => ({ id: LOJAS[i].id, loja: { id: LOJAS[i].id, nome: LOJAS[i].nome, meta: p.meta, metas: {}, metaAuto: { ativo: true, pct: 10 }, operacao: OPERACAO[LOJAS[i].id] }, vendas: p.vendas, metaPlanilha: null }));
}

const lojasDemo = () => LOJAS.map(({ id, nome }) => ({ id, nome }));
const disponivel = () => fs.existsSync(PERFIL);

module.exports = { pacoteDemo, lojasDemo, disponivel, partes };
