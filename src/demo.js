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
  return { vendas, xml, clientes, meta, avisos: [], fontes: [{ nome: 'Dados fictícios', desc: 'demonstração', origem: null, ok: true }], lojaNome: L.nome, fixos: equipe.slice(0, 3).map((v) => v.nome) };
}

/**
 * Programa de fidelidade FICTÍCIO (para a seção Fidelidade da apresentação): ~2/3 dos clientes com CPF estão no programa,
 * ganham 1 ponto a cada R$ 50 e parte deles troca 6 pontos por um prêmio na visita seguinte. Mesmo formato que o painel
 * recebe dos Logs do FIXE (src/fidelidade.js → paraPainel).
 */
function fidelidadeDemo(L, parte) {
  const FI = require('./fidelidade');
  const cup = new Map();
  for (const v of parte.vendas) {
    let c = cup.get(v.cupom);
    if (!c) cup.set(v.cupom, (c = { data: v.data, min: v.min, vt: 0, prods: [] }));
    c.vt += v.vt || 0;
    if (c.prods.length < 2 && v.vu >= 0.05) c.prods.push(v.descricao);
  }
  const nome = new Map(parte.clientes.map((c) => [c.cpf, c.nome]));
  const porCpf = new Map();
  for (const x of parte.xml) { const c = cup.get(x.cupom); if (c) (porCpf.get(x.cpf) || porCpf.set(x.cpf, []).get(x.cpf)).push(c); }
  const premios = [...new Set(parte.vendas.filter((v) => / 50G$/i.test(v.descricao) && v.vu >= 0.05).map((v) => v.descricao))].slice(0, 6);
  const eventos = [], membros = [], cadastros = {};
  for (const [cpf, cs] of porCpf) {
    const hsh = hashTxt(cpf);
    if (hsh % 3 === 0) continue; // fora do programa
    cs.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (a.min || 0) - (b.min || 0)));
    membros.push([cpf, cs[0].data]); cadastros[cpf] = cs[0].data;
    let saldo = 0, k = 0;
    for (const c of cs) {
      const base = { cpf, nome: nome.get(cpf) || '', loja: L.loja, data: c.data, min: c.min == null ? 720 : Math.min(1439, c.min + 2) };
      if (saldo >= 6 && (hsh + k++) % 5 < 3 && premios.length) { eventos.push({ ...base, tipo: 'resgate', pontos: 6, produtos: [premios[(hsh + k) % premios.length]] }); saldo -= 6; }
      const pts = Math.floor(c.vt / 50);
      if (pts > 0) { eventos.push({ ...base, min: Math.min(1439, base.min + 1), tipo: 'pontos', pontos: pts, produtos: c.prods }); saldo += pts; }
    }
  }
  const em = new Date().toISOString();
  return FI.paraPainel({ em, eventos, cadastros }, { id: L.id, nome: L.nome }, [L.loja], { em, membros }, null);
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
    dados.fidelidade = idx.map((i) => fidelidadeDemo(LOJAS[i], cache.partes[i]));
    // a escala fictícia usa o nome das vendedoras fixas da loja (para a venda por hora trabalhada); a loja com apelidos na escala fica como está
    const operacaoDemo = (i) => { const o = OPERACAO[LOJAS[i].id]; return o.equipe.pessoas ? o : { ...o, equipe: { ...o.equipe, nomes: cache.partes[i].fixos } }; };
    // férias de exemplo: uma vendedora de cada loja tirou 10 dias no mês passado
    const feriasDemo = (i) => {
      const hoje = new Date(); const ant = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
      const nomes = [...new Set(cache.partes[i].vendas.filter((v) => v.data.startsWith(ant)).map((v) => v.vendedor))].filter(Boolean).sort();
      return nomes.length > 1 ? [{ vendedor: nomes[0], de: `${ant}-05`, ate: `${ant}-14` }] : [];
    };
    dados.metaCfgs = idx.map((i) => ({ id: LOJAS[i].id, nome: LOJAS[i].nome, nomesVenda: [LOJAS[i].loja], padrao: cache.partes[i].meta, meses: {}, metaAuto: { ativo: true, pct: 10 }, regras: null, operacao: operacaoDemo(i), ferias: feriasDemo(i) }));
    dados.meta = dados.metaCfgs.reduce((s, m) => s + (m.padrao || 0), 0);
    cache.corpos.set(k, JSON.stringify(pack(dados, { loja: k, demo: true })));
  }
  return { body: cache.corpos.get(k), at: cache.at, chave: k };
}

/** lojas fictícias no formato dos indicadores (rede/alertas) */
function partes() {
  pacoteDemo('todas');
  return cache.partes.map((p, i) => ({ id: LOJAS[i].id, loja: { id: LOJAS[i].id, nome: LOJAS[i].nome, meta: p.meta, metas: {}, metaAuto: { ativo: true, pct: 10 }, operacao: OPERACAO[LOJAS[i].id] }, vendas: p.vendas, metaPlanilha: null }));
}


// ---------- estoque, custos, compras e catálogo de pedidos FICTÍCIOS (para a apresentação como administrador) ----------
const hashTxt = (t) => { let x = 2166136261; for (const ch of String(t)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
const FORNECEDORES = ['Distribuidora Fictícia de Chás', 'Embalagens Exemplo Ltda', 'Acessórios Modelo S.A.'];
const cacheEst = new Map();
function estoqueDemo(id) {
  const i = LOJAS.findIndex((L) => L.id === id);
  if (i < 0) return null;
  pacoteDemo('todas');
  const chave = cache.chave + '|' + id;
  if (cacheEst.has(chave)) return cacheEst.get(chave);
  const vendas = cache.partes[i].vendas;
  const hojeIso = vendas.length ? vendas[vendas.length - 1].data : new Date().toISOString().slice(0, 10);
  const ini90 = new Date(Date.parse(hojeIso + 'T00:00:00Z') - 90 * DAY).toISOString().slice(0, 10);
  // por item do estoque: chá a granel (kg, pelo nome do produto) ou unidade (pela descrição)
  const mapa = new Map();
  const TP = require('./tipoprod');
  for (const v of vendas) {
    if (v.vu != null && v.vu < 0.05) continue;
    // em kg só o chá a granel (pelos pacotes vendidos); minitin, envasado e alimentação com "100g" no nome são unidade
    const kg = !!v.soNumeros && TP.tipo({ un: 'Kg', desc: v.produto, grupo: v.grupo }) === 'granel';
    const nome = kg ? v.produto : v.descricao;
    const k = (kg ? 'kg|' : 'un|') + nome;
    let m = mapa.get(k);
    if (!m) mapa.set(k, (m = { nome, kg, grupo: v.grupo, precos: [], q90: 0 }));
    if (m.precos.length < 60) m.precos.push(kg ? (v.vu / v.soNumeros) * 1000 : v.vu);
    if (v.data >= ini90) m.q90 += kg ? (v.qtd * v.soNumeros) / 1000 : v.qtd;
  }
  const itens = [], hist = {}, comp = {}, grupos = new Map();
  let cod = 20000 + i * 3000;
  const dia = (n) => new Date(Date.parse(hojeIso + 'T00:00:00Z') - n * DAY).toISOString().slice(0, 10);
  const notas = [];
  for (const m of [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome))) {
    const r = rng(hashTxt(id + m.nome));
    const pr = m.precos.sort((a, b) => a - b)[Math.floor(m.precos.length / 2)] || 10;
    const eg = /GOURMET|CAF/i.test(m.grupo || '');
    const custo = r2(pr * (m.kg ? 0.22 + r() * 0.1 : eg ? 0.2 + r() * 0.1 : 0.32 + r() * 0.14));
    const porDia = m.q90 / 90;
    const qtd = r() < 0.05 ? 0 : m.kg ? Math.round(porDia * (8 + r() * 70) * 1000) / 1000 : Math.max(0, Math.round(porDia * (6 + r() * 80)));
    const c = String(cod++);
    grupos.set(c, m.grupo || '');
    itens.push({ cod: c, tipo: m.kg ? 'MP' : 'PN', desc: m.nome, un: m.kg ? 'Kg' : 'Un', min: null, custo, qtd });
    // custo de antes: um ou dois reajustes no último ano (para Preços e para o histórico)
    const antes = r2(custo / (1.04 + r() * 0.12)), d1 = 120 + Math.floor(r() * 220);
    hist[c] = [[dia(400), r2(antes / 1.05)], [dia(d1), antes], ...(r() < 0.6 ? [[dia(Math.floor(r() * 90) + 5), custo]] : [])];
    if (hist[c][hist[c].length - 1][1] !== custo) hist[c].push([dia(3), custo]);
    // notas de compra: última entrada com o custo atual
    if (porDia > 0 && r() < 0.7) {
      const nf = 1000 + (hashTxt(c) % 9000);
      comp[c] = [[dia(10 + Math.floor(r() * 50)), custo, nf, m.kg ? Math.max(0.5, Math.round(porDia * 30 * 2) / 2) : Math.max(1, Math.round(porDia * 30)), FORNECEDORES[hashTxt(m.grupo) % FORNECEDORES.length]]];
      notas.push(nf);
    }
  }
  // chá envasado cadastrado em "Kg" como no AppNext (9,000 kg = 9 pacotes): o painel mostra 9 un (src/tipoprod.js)
  {
    const c = String(cod++), nf1 = 1000 + (hashTxt(c) % 9000);
    grupos.set(c, 'CHÁS ENVASADOS');
    itens.push({ cod: c, tipo: 'PN', desc: 'Matcha Cerimonial 30G Pacote', un: 'Kg', min: null, custo: 38.5, qtd: 9 });
    hist[c] = [[dia(400), 35.9], [dia(120), 38.5]];
    comp[c] = [[dia(20), 38.5, nf1, 6, FORNECEDORES[0]], [dia(75), 37.9, nf1 + 7, 6, FORNECEDORES[0]]];
    notas.push(nf1, nf1 + 7);
  }
  // embalagens do chá a granel (os códigos que a configuração usa)
  for (const [c, desc, custo, qtd] of [['80149', 'Saco kraft pequeno', 0.62, 900], ['80150', 'Saco kraft médio', 0.85, 300], ['80151', 'Saco kraft grande', 1.1, 120], ['80152', 'Saco kraft 1 kg', 1.6, 60], ['81010', 'Etiqueta Sato', 0.09, 5000]]) {
    itens.push({ cod: c, tipo: 'MC', desc, un: 'Un', min: null, custo, qtd });
    hist[c] = [[dia(400), r2(custo * 0.93)], [dia(150), custo]];
  }
  // catálogo do Sistema de Pedidos: preço ≈ custo; alguns indisponíveis; uns poucos fora do catálogo
  const catalogo = { em: new Date(Date.parse(hojeIso + 'T00:00:00Z') - 3 * 3600e3).toISOString(), fornecedor: 'FRANQUIAS (fictício)', itens: [] };
  for (const it of itens) {
    const r = rng(hashTxt('cat' + id + it.cod));
    if (r() < 0.06) continue;
    const disp = r() > 0.1;
    const mult = it.un === 'Kg' ? (r() < 0.5 ? 0.5 : 1) : r() < 0.25 ? 6 : 1;
    const preco = r2(it.custo * (0.97 + r() * 0.08));
    catalogo.itens.push({ cod: it.cod, nome: it.desc, preco: disp ? preco : 0.01, disp, mult, min: null, max: 50, precoPedido: disp ? preco : 0.01 });
  }
  const em = new Date(Date.parse(hojeIso + 'T00:00:00Z') + 9 * 3600e3).toISOString();
  const out = {
    estoque: TP.normalizar({ em, importadoEm: em, origem: 'fictício', itens }, (c) => grupos.get(c) || ''),
    historico: hist,
    compras: { atualizado: em, notas: notas.length, itens: comp },
    catalogo,
    estoqueCfg: {
      simplesPct: 6, cartaoPct: 2.2, segurancaPct: 50,
      outros: [
        { nome: 'Aluguel e condomínio', tipo: 'mes', valor: Math.round((cache.partes[i].meta * 0.13) / 100) * 100, aplica: 'tudo', cat: 'imovel', dia: 10 },
        { nome: 'Salários e encargos (fixo)', tipo: 'mes', valor: Math.round((cache.partes[i].meta * 0.16) / 100) * 100, aplica: 'tudo', cat: 'func', dia: 5 },
        { nome: 'Sistemas', tipo: 'mes', valor: 650, aplica: 'tudo', cat: 'sistemas' },
        { nome: 'Fundo de propaganda', tipo: 'pct', valor: 1, aplica: 'loja', cat: 'outros' },
      ],
      pontuais: [{ nome: 'IPTU', valor: 2400, ym: hojeIso.slice(0, 4) + '-02', anual: true, cat: 'imovel' }],
    },
  };
  if (cacheEst.size > 6) cacheEst.clear();
  cacheEst.set(chave, out);
  return out;
}

/** tela de Configurações da apresentação: lojas fictícias, sem nenhum dado real (nada é salvo) */
function estadoDemo() {
  pacoteDemo('todas');
  const agora = new Date();
  const ha = (h) => new Date(agora.getTime() - h * 3600e3).toISOString();
  const lojas = LOJAS.map((L, i) => {
    const vendas = cache.partes[i].vendas;
    const porMes = {};
    const cup = new Set();
    for (const v of vendas) { const k = v.data.slice(0, 7) + '|' + v.cupom; if (!cup.has(k)) { cup.add(k); porMes[v.data.slice(0, 7)] = (porMes[v.data.slice(0, 7)] || 0) + 1; } }
    const meses = Object.keys(porMes).sort();
    const ult = vendas.length ? vendas[vendas.length - 1].data : null;
    const ultV = new Map();
    for (const v of vendas) if (v.vendedor) ultV.set(v.vendedor, v.data);
    const nomes = [...ultV].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([nome, ultima]) => ({ nome, ultima }));
    const est = estoqueDemo(L.id);
    return {
      logo: false, operacao: OPERACAO[L.id], ferias: [], metaAuto: { ativo: true, pct: 10 }, totaisSemEG: null,
      id: L.id, nome: L.nome, appnext: L.loja, meta: cache.partes[i].meta, metas: {}, criadaEm: '2024-01-01T12:00:00.000Z', regras: null, marca: { nome: L.nome }, wppModelos: null,
      nomesVenda: [L.loja],
      base: { existe: true, meses, porMes, linhas: vendas.length, ultimaVenda: ult, de: meses[0], ate: meses[meses.length - 1], importacoes: [{ em: ha(2), origem: 'robô (fictício)', por: 'sistema', de: vendas[0]?.data, ate: ult, linhas: vendas.length }], pendentes: 0 },
      xml: { existe: true, notas: cup.size, de: meses[0] + '-01', ate: ult, importacoes: [{ em: ha(2), origem: 'robô (fictício)', por: 'sistema', notas: 40 }], pendentes: 0, erros: [] },
      estoque: { em: est.estoque.em, itens: est.estoque.itens.length, origem: 'fictício' },
      fechEmail: { email: { host: 'smtp.exemplo.com', port: 587, secure: false, user: 'loja@exemplo.com', from: `${L.nome} <loja@exemplo.com>`, temSenha: true, configurado: true },
        destinos: [{ email: 'franqueado@exemplo.com', nome: 'Franqueado(a)', caixa: true }, { email: 'gerente@exemplo.com', nome: 'Gerente', caixa: false }],
        fechamento: { ativo: true, horario: '23:30', ultimoEnvio: ha(20).slice(0, 10) }, gerais: [], servidorGeral: false },
      fontes: [], vendedores: nomes,
      fixe: { url: 'https://fidelidade.exemplo.com', usuario: 'loja', email: 'fidelidade@exemplo.com', temSenha: true, pedido: null, ultimo: { em: ha(5), ok: true }, logs: null, fidelidade: { reaisPorPonto: 50, validadeMeses: 12, minResgate: 6, prazoResgate: 90 } },
      coletor: { configurado: true, rede: 'exemplo', usuario: 'robo@exemplo.com', temSenha: true, lojaDestino: L.loja, lojaIdDestino: '' },
      status: null,
    };
  });
  const usuarios = [
    { nome: 'apresentacao', perfil: 'admin', lojas: ['*'], ativo: true, criadoEm: '2024-01-01T12:00:00.000Z', ultimoAcesso: agora.toISOString() },
    { nome: 'franqueado.exemplo', perfil: 'franqueado', lojas: LOJAS.map((L) => L.id), ativo: true, criadoEm: '2024-01-01T12:00:00.000Z', ultimoAcesso: ha(30) },
    { nome: 'gerente.centro', perfil: 'gerente', lojas: ['demo-centro'], telas: ['resumo', 'comparativos', 'clientes', 'mapa', 'pedido'], ativo: true, criadoEm: '2024-03-01T12:00:00.000Z', ultimoAcesso: ha(4) },
    { nome: 'vendedora.parque', perfil: 'vendedor', lojas: ['demo-parque'], vendedor: (lojas[1].vendedores[0] || {}).nome || '', ativo: true, criadoEm: '2024-05-01T12:00:00.000Z', ultimoAcesso: ha(50) },
  ].map((u) => ({ telas: undefined, vendedor: undefined, acessoAte: null, expirado: false, trocarSenha: false, senhaTrocadaEm: null, ...u }));
  const auditoria = [
    { em: ha(3), por: 'apresentacao', acao: 'alterou a meta', alvo: 'demo-centro', detalhe: { loja: 'demo-centro' } },
    { em: ha(26), por: 'franqueado.exemplo', acao: 'adicionou destinatário do fechamento', alvo: 'demo-parque', detalhe: { loja: 'demo-parque' } },
    { em: ha(72), por: 'apresentacao', acao: 'criou usuário', alvo: 'gerente.centro', detalhe: {} },
  ];
  return { perfil: 'admin', usuario: 'apresentacao', coletorAtivo: false, horarios: ['13:30', '23:00'], janela: null, coletorOk: null, lojas, usuarios, auditoria, todasLojas: LOJAS.map((L) => ({ id: L.id, nome: L.nome })), telas: require('./telas').paraTela(), demo: true };
}

const lojasDemo = () => LOJAS.map(({ id, nome }) => ({ id, nome }));
const disponivel = () => fs.existsSync(PERFIL);

module.exports = { pacoteDemo, lojasDemo, disponivel, partes, estoqueDemo, estadoDemo, LOJAS, OPERACAO };
