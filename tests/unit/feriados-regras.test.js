'use strict';
/* Feriados, horário especial e simulação da escala (docs/rastreabilidade.md, Movimento e escala):
   ESC-29 feriados nacionais (Páscoa móvel: Carnaval, Sexta-feira Santa, Corpus Christi) e locais — public/js/feriados.js;
   ESC-30 horas de feriado trabalhadas para o fechamento — horasAuto (por TS.horasFeriados) em feriados.js;
   ESC-18 horário do feriado: data especial > padrão de feriados > dia da semana — TS.horarioFeriado;
   ESC-28 simular horário e equipe; só admin/franqueado salva; validado no servidor — validarOperacao e a rota
   PUT /api/admin/lojas/:id/operacao (src/admin-api.js), sem subir o servidor.
   Sem mudar código de produção: os arquivos do navegador rodam no Node (vm), como em margem-resultado.test.js. */
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '../..');
const JS = path.join(RAIZ, 'public/js');

/** core.js + feriados.js (e, com escala, mapa.js — que traz TS._intervalo e TS.diasDaEscala) num contexto novo */
function painel({ escala = true } = {}) {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout });
  vm.runInContext("var window = globalThis; var location = { pathname: '/', hash: '' };", ctx);
  const run = (f) => vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctx, { filename: f });
  run('core.js');
  vm.runInContext('TS.pages = TS.pages || {};', ctx);
  run('feriados.js');
  if (escala) run('mapa.js');
  return ctx.TS;
}
const TS = painel();
const datasDe = (lista) => lista.map((f) => f.data);
const achar = (lista, nome) => lista.find((f) => f.nome === nome);
const H = (abre, fecha) => ({ abre, fecha, fechado: false });
const SEMANA = { seg: H('10:00', '22:00'), ter: H('10:00', '22:00'), qua: H('10:00', '22:00'), qui: H('10:00', '22:00'), sex: H('10:00', '22:00'), sab: H('10:00', '22:00'), dom: H('12:00', '18:00') };

// ======================= ESC-29 feriados nacionais e locais =======================
test('ESC-29: Páscoa móvel — Carnaval, Sexta-feira Santa e Corpus Christi em anos conhecidos', () => {
  // Páscoa: 2024 = 31/03, 2025 = 20/04, 2026 = 05/04, 2027 = 28/03, 2030 = 21/04
  const esperado = {
    2024: { seg: '2024-02-12', ter: '2024-02-13', sexta: '2024-03-29', corpus: '2024-05-30' },
    2025: { seg: '2025-03-03', ter: '2025-03-04', sexta: '2025-04-18', corpus: '2025-06-19' },
    2026: { seg: '2026-02-16', ter: '2026-02-17', sexta: '2026-04-03', corpus: '2026-06-04' },
    2027: { seg: '2027-02-08', ter: '2027-02-09', sexta: '2027-03-26', corpus: '2027-05-27' },
    2030: { seg: '2030-03-04', ter: '2030-03-05', sexta: '2030-04-19', corpus: '2030-06-20' },
  };
  for (const [ano, e] of Object.entries(esperado)) {
    const l = TS.feriadosNacionais(+ano);
    assert.equal(achar(l, 'Carnaval (segunda)').data, e.seg, `Carnaval (segunda) ${ano}`);
    assert.equal(achar(l, 'Carnaval (terça)').data, e.ter, `Carnaval (terça) ${ano}`);
    assert.equal(achar(l, 'Sexta-feira Santa').data, e.sexta, `Sexta-feira Santa ${ano}`);
    assert.equal(achar(l, 'Corpus Christi').data, e.corpus, `Corpus Christi ${ano}`);
  }
  // os dias da semana batem (segunda, terça, sexta, quinta)
  const l = TS.feriadosNacionais(2026);
  const wd = (n) => new Date(achar(l, n).data + 'T12:00:00Z').getUTCDay();
  assert.equal(wd('Carnaval (segunda)'), 1); assert.equal(wd('Carnaval (terça)'), 2);
  assert.equal(wd('Sexta-feira Santa'), 5); assert.equal(wd('Corpus Christi'), 4);
});

test('ESC-29: feriados fixos nacionais, tipos (nacional × ponto facultativo) e lista em ordem de data', () => {
  const l = TS.feriadosNacionais(2026);
  assert.equal(l.length, 13);
  for (const d of ['2026-01-01', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25']) {
    const f = l.find((x) => x.data === d);
    assert.ok(f, `feriado fixo ${d}`); assert.equal(f.tipo, 'nacional', d);
  }
  assert.equal(achar(l, 'Sexta-feira Santa').tipo, 'nacional');
  for (const n of ['Carnaval (segunda)', 'Carnaval (terça)', 'Corpus Christi']) assert.equal(achar(l, n).tipo, 'facultativo', n);
  assert.deepEqual(datasDe(l), [...datasDe(l)].sort(), 'ordem de data');
});

test('ESC-29: feriados do mês juntam nacionais e locais (anual repete todo ano; sem "anual" só no ano dele)', () => {
  const cfg = { feriadosLocais: [
    { data: '2020-10-24', nome: 'Aniversário de Goiânia', anual: true },
    { data: '2026-11-27', nome: 'Ponto da prefeitura', anual: false },
    { data: '2021-06-13', nome: 'Santo Antônio' }, // sem o campo: anual (padrão)
  ] };
  const out = TS.feriadosDoMes(cfg, '2026-10');
  assert.deepEqual(out.map((f) => [f.data, f.tipo]), [['2026-10-12', 'nacional'], ['2026-10-24', 'local']]);
  assert.equal(out[1].orig, cfg.feriadosLocais[0], 'guarda o original para remover');
  assert.deepEqual(datasDe(TS.feriadosDoMes(cfg, '2026-11')), ['2026-11-02', '2026-11-15', '2026-11-20', '2026-11-27']);
  assert.deepEqual(datasDe(TS.feriadosDoMes(cfg, '2027-11')), ['2027-11-02', '2027-11-15', '2027-11-20'], 'o local de um ano só não volta');
  assert.ok(datasDe(TS.feriadosDoMes(cfg, '2030-06')).includes('2030-06-13'), 'sem o campo "anual" repete');
  assert.deepEqual(TS.feriadosDoMes(null, '2026-03'), [], 'mês sem feriado (2026: Carnaval em fevereiro)');
});

test('ESC-29: mesma data duas vezes vira um feriado só (o nacional fica; Sexta-feira Santa = Tiradentes em 2000)', () => {
  const cfg = { feriadosLocais: [{ data: '2019-11-20', nome: 'Consciência Negra municipal', anual: true }] };
  const nov = TS.feriadosDoMes(cfg, '2026-11').filter((f) => f.data === '2026-11-20');
  assert.equal(nov.length, 1); assert.equal(nov[0].tipo, 'nacional');
  // Páscoa de 2000 = 23/04: a Sexta-feira Santa cai em 21/04 (Tiradentes)
  const abr = TS.feriadosDoMes({}, '2000-04');
  assert.deepEqual(datasDe(abr), ['2000-04-21']);
});

test('ESC-29: datas de feriado para tirar do Mapa de calor cobrem os anos pedidos, com os locais', () => {
  const s = TS.datasFeriado({ feriadosLocais: [{ data: '2020-10-24', nome: 'Cidade', anual: true }, { data: '2025-03-19', nome: 'Só 2025', anual: false }] }, 2025, 2026);
  for (const d of ['2025-04-18', '2026-04-03', '2025-10-24', '2026-10-24', '2025-03-19', '2025-12-25', '2026-02-17']) assert.ok(s.has(d), d);
  assert.ok(!s.has('2024-12-25') && !s.has('2027-01-01'), 'fora dos anos pedidos');
  assert.ok(!s.has('2026-03-19'), 'local de um ano só não repete');
});

test('ESC-29: feriado local anual em 29/02 não vira data que não existe nos anos comuns', () => {
  const out = TS.feriadosDoMes({ feriadosLocais: [{ data: '2024-02-29', nome: 'Bissexto', anual: true }] }, '2027-02');
  for (const f of out) assert.ok(!Number.isNaN(Date.parse(f.data + 'T12:00:00Z')) && new Date(f.data + 'T12:00:00Z').toISOString().startsWith(f.data), `data válida: ${f.data}`);
});

// ======================= ESC-18 horário do feriado =======================
test('ESC-18: horário do feriado — data especial > padrão de feriados > dia da semana', () => {
  const op = { funcionamento: { ...SEMANA, feriado: { abre: '12:00', fecha: '18:00', fechado: false, mesmoDoDia: false } }, equipe: {} };
  // 20/11/2026 é sexta; 02/11/2026 é segunda; 15/11/2026 é domingo
  const cfg = { operacao: op, feriadosHorario: { '2026-11-20': { abre: '09:00', fecha: '15:00', fechado: false }, '2026-12-25': { fechado: true } } };
  assert.deepEqual(TS.horarioFeriado(cfg, '2026-11-20'), { abre: '09:00', fecha: '15:00', fechado: false, origem: 'data' });
  assert.deepEqual(TS.horarioFeriado(cfg, '2026-12-25'), { fechado: true, origem: 'data' });
  assert.deepEqual(TS.horarioFeriado(cfg, '2026-11-02'), { abre: '12:00', fecha: '18:00', fechado: false, origem: 'feriados' });
  // "mesmo do dia": cai no horário do dia da semana
  const mesmo = { operacao: { funcionamento: { ...SEMANA, feriado: { fechado: false, mesmoDoDia: true } } } };
  assert.deepEqual(TS.horarioFeriado(mesmo, '2026-11-02'), { abre: '10:00', fecha: '22:00', fechado: false, origem: 'semana' });
  assert.deepEqual(TS.horarioFeriado(mesmo, '2026-11-15'), { abre: '12:00', fecha: '18:00', fechado: false, origem: 'semana' }, 'domingo');
  // padrão de feriados "fechada"
  const fechada = { operacao: { funcionamento: { ...SEMANA, feriado: { fechado: true, mesmoDoDia: false } } } };
  assert.equal(TS.horarioFeriado(fechada, '2026-11-02').fechado, true);
  assert.equal(TS.horarioFeriado(fechada, '2026-11-02').origem, 'feriados');
  // sem padrão de feriados: dia da semana; sem horário nenhum: null
  assert.equal(TS.horarioFeriado({ operacao: { funcionamento: SEMANA } }, '2026-11-02').origem, 'semana');
  assert.equal(TS.horarioFeriado({}, '2026-11-02'), null);
  assert.equal(TS.horarioFeriado(null, '2026-11-02'), null);
  // dia da semana fechado
  const domFechado = { operacao: { funcionamento: { ...SEMANA, dom: { abre: '00:00', fecha: '00:00', fechado: true } } } };
  assert.equal(TS.horarioFeriado(domFechado, '2026-11-15').fechado, true);
});

// ======================= ESC-30 horas de feriado (horasAuto) =======================
const EQ6x1 = { cargaSemanal: 44, escala: '6x1', intervalo: 60 }; // jornada 7h20 (440 min)
const cfgHoras = (horario, extra = {}) => ({ operacao: { funcionamento: SEMANA, equipe: EQ6x1 }, feriadosHorario: { '2026-11-20': horario }, ...extra });
const vendeu = (o) => new Map(Object.entries(o).map(([d, ns]) => [d, new Set(ns)]));
const autoDe = (T, cfg, nome = 'ANA') => (T.horasFeriados(cfg, '2026-11', vendeu({ '2026-11-20': [nome] })).horas['2026-11-20'] || {})[nome];

test('ESC-30: horas automáticas = horário da loja no feriado, menos o intervalo da escala, até a jornada', () => {
  assert.equal(autoDe(TS, cfgHoras(H('10:00', '13:00'))), 180, 'até 4h: sem intervalo');
  assert.equal(autoDe(TS, cfgHoras(H('10:00', '16:00'))), 330, '6h: intervalo de 30 min (faixa de 4h a 8h)');
  assert.equal(autoDe(TS, cfgHoras(H('10:00', '17:00'))), 360, '7h: 7h − 1h = 6h (intervalo de 1h: sobram mais de 6h de trabalho)');
  assert.equal(autoDe(TS, cfgHoras(H('10:00', '22:00'))), 440, '12h: limitado à jornada de 7h20 (44h em 6x1)');
  assert.equal(autoDe(TS, cfgHoras({ fechado: true })), undefined, 'loja fechada: 0 (não entra)');
  // 5x2: jornada de 8h48; 4x3: 11h
  const c5x2 = cfgHoras(H('08:00', '22:00')); c5x2.operacao.equipe = { ...EQ6x1, escala: '5x2' };
  assert.equal(autoDe(TS, c5x2), 528);
  const c4x3 = cfgHoras(H('08:00', '22:00')); c4x3.operacao.equipe = { ...EQ6x1, escala: '4x3' };
  assert.equal(autoDe(TS, c4x3), 660);
});

test('ESC-30: sem a escala carregada vale a regra antiga (acima de 6h desconta o intervalo da equipe)', () => {
  const T = painel({ escala: false });
  assert.equal(autoDe(T, cfgHoras(H('10:00', '16:00'))), 360, '6h exatas: sem desconto');
  assert.equal(autoDe(T, cfgHoras(H('10:00', '17:00'))), 360, '7h − 60 min');
  assert.equal(autoDe(T, cfgHoras(H('10:00', '22:00'))), 528, 'sem TS.diasDaEscala a jornada é carga ÷ 5 (8h48)');
});

test('ESC-30: o que foi editado vale (inclusive 0); quem vendeu e não foi editado entra no automático, marcado', () => {
  const cfg = cfgHoras(H('10:00', '17:00'), { feriadosHoras: { '2026-11': { '2026-11-20': { ANA: 0, CAU: 300 }, '2026-11-02': { BIA: 120 } } } });
  const r = TS.horasFeriados(cfg, '2026-11', vendeu({ '2026-11-20': ['ANA', 'BIA', 'DUDA'], '2026-11-02': ['BIA'] }));
  assert.deepEqual(r.horas['2026-11-20'], { CAU: 300, BIA: 360, DUDA: 360 }, 'ANA editada com 0 = não trabalhou');
  assert.deepEqual(r.auto['2026-11-20'], { BIA: true, DUDA: true });
  assert.deepEqual(r.horas['2026-11-02'], { BIA: 120 }, 'editado vence o automático');
  assert.equal(r.auto['2026-11-02'], undefined);
  // venda num dia que não é feriado não entra
  const r2 = TS.horasFeriados(cfg, '2026-11', vendeu({ '2026-11-21': ['ANA'] }));
  assert.equal(r2.horas['2026-11-21'], undefined);
  // feriado local entra; editado de outro mês não
  const loc = TS.horasFeriados({ ...cfg, feriadosLocais: [{ data: '2026-11-27', nome: 'Cidade', anual: false }] }, '2026-11', vendeu({ '2026-11-27': ['ANA'] }));
  assert.equal(loc.horas['2026-11-27'].ANA, 440, 'sexta 10h–22h, limitado à jornada');
});

test('ESC-30: o PDF do fechamento recebe a lista do mês e as horas que valem (sem banco antes de nov/2026: pagar)', () => {
  const cfg = cfgHoras(H('10:00', '17:00'), { feriadosHoras: { '2026-10': { '2026-10-12': { ANA: 360 } } } });
  const p = TS.feriadosParaPdf(cfg, '2026-10'); // sem TS.db e sem bancohoras.js: só as editadas
  assert.deepEqual(datasDe(p.lista), ['2026-10-12']);
  assert.deepEqual(p.horas, { '2026-10-12': { ANA: 360 } });
  assert.equal(p.comBanco, false);
  assert.equal(p.acerto('2026-10-12', 'ANA'), 'pagar');
  assert.equal(p.bancoMes('ANA'), null);
});

test('ESC-30: sem horário cadastrado as horas automáticas usam o intervalo padrão da tela Equipe e regras (60 min)', () => {
    assert.equal(autoDe(TS, {}), 468);
  });

// ======================= ESC-28 validação no servidor =======================
/** validarOperacao não é exportada: o trecho de src/admin-api.js roda à parte (sem subir o servidor) */
const validarOperacao = (() => {
  const src = fs.readFileSync(path.join(RAIZ, 'src/admin-api.js'), 'utf8');
  const ini = src.indexOf('const DIAS_SEMANA');
  const fim = src.indexOf('/** valida a estrutura das regras');
  assert.ok(ini > 0 && fim > ini, 'trecho de validarOperacao achado em src/admin-api.js');
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(ini, fim) + '\nthis.validarOperacao = validarOperacao;', ctx, { filename: 'admin-api.js#validarOperacao' });
  return ctx.validarOperacao;
})();
const opValida = () => ({
  funcionamento: { ...JSON.parse(JSON.stringify(SEMANA)), feriado: { abre: '12:00', fecha: '18:00', fechado: false, mesmoDoDia: false } },
  equipe: { funcionarios: 3, cargaSemanal: 44, escala: '6x1', intervalo: 60, capacidade: 4, nomes: [], modelo: 'rodizio', inicioSemana: 'dom', maxFolgaDia: 1,
    minimoDia: { seg: 1, dom: 2 }, pessoas: [{ nome: 'ANA', folga: 'seg', folga2: 'auto', turno: 'manha' }] },
});
const com = (fn) => { const o = opValida(); fn(o); return validarOperacao(o); };

test('ESC-28: validarOperacao aceita a operação válida e os limites de cada campo', () => {
  assert.equal(validarOperacao(opValida()), null);
  for (const [campo, ok] of [['funcionarios', [1, 40]], ['cargaSemanal', [4, 60]], ['intervalo', [0, 180]], ['intervaloAte8', [0, 180]], ['maxFolgaDia', [1, 10]]]) {
    for (const v of ok) assert.equal(com((o) => { o.equipe[campo] = v; }), null, `${campo}=${v} passa`);
  }
  for (const esc of ['5x2', '6x1', '4x3']) assert.equal(com((o) => { o.equipe.escala = esc; }), null, esc);
  for (const m of ['livre', 'rodizio', 'rodizio-dom']) assert.equal(com((o) => { o.equipe.modelo = m; }), null, m);
  assert.equal(com((o) => { o.equipe.capacidade = 100; }), null);
  assert.equal(com((o) => { o.equipe.capacidade = 0.5; }), null);
  assert.equal(com((o) => { o.funcionamento.seg = { fechado: true }; }), null, 'dia fechado não precisa de horário');
  assert.equal(com((o) => { o.funcionamento.feriado = { fechado: false, mesmoDoDia: true }; }), null, 'feriado "mesmo do dia"');
  assert.equal(com((o) => { o.funcionamento.feriado = { fechado: true, mesmoDoDia: false }; }), null, 'feriado fechado');
  assert.equal(com((o) => { delete o.funcionamento.feriado; }), null, 'sem padrão de feriados');
  assert.equal(com((o) => { o.equipe.minimoDia = { seg: 0, sab: 20 }; }), null);
  assert.equal(com((o) => { o.equipe.pessoas = Array.from({ length: 40 }, (_, i) => ({ nome: 'P' + i })); }), null, '40 pessoas');
});

test('ESC-28: validarOperacao recusa fora dos limites, horário invertido e folga fixa no domingo', () => {
  const recusas = [
    [(o) => { o.equipe.funcionarios = 0; }, /funcionários/], [(o) => { o.equipe.funcionarios = 41; }, /funcionários/], [(o) => { o.equipe.funcionarios = 2.5; }, /funcionários/],
    [(o) => { o.equipe.cargaSemanal = 3; }, /Carga/], [(o) => { o.equipe.cargaSemanal = 61; }, /Carga/],
    [(o) => { o.equipe.escala = '12x36'; }, /Escala/],
    [(o) => { o.equipe.intervalo = -1; }, /Intervalo/], [(o) => { o.equipe.intervalo = 181; }, /Intervalo/],
    [(o) => { o.equipe.intervaloAte8 = 181; }, /até 8h/],
    [(o) => { o.equipe.capacidade = 0; }, /Atendimentos/], [(o) => { o.equipe.capacidade = 101; }, /Atendimentos/], [(o) => { o.equipe.capacidade = '4'; }, /Atendimentos/],
    [(o) => { o.equipe.nomes = Array(41).fill('x'); }, /Nomes/], [(o) => { o.equipe.nomes = ['x'.repeat(41)]; }, /Nomes/],
    [(o) => { o.equipe.modelo = 'outro'; }, /Modelo/],
    [(o) => { o.equipe.inicioRodizio = '01/11/2026'; }, /rodízio/],
    [(o) => { o.equipe.inicioSemana = 'ter'; }, /início da semana/],
    [(o) => { o.equipe.minimoDia = { seg: 21 }; }, /seg/], [(o) => { o.equipe.minimoDia = 3; }, /Mínimo/],
    [(o) => { o.equipe.maxFolgaDia = 0; }, /folgas/], [(o) => { o.equipe.maxFolgaDia = 11; }, /folgas/],
    [(o) => { o.equipe.pessoas = Array.from({ length: 41 }, (_, i) => ({ nome: 'P' + i })); }, /Equipe/],
    [(o) => { o.equipe.pessoas = [{ nome: 'x'.repeat(41) }]; }, /Nome de pessoa/],
    [(o) => { o.equipe.pessoas = [{ nome: 'ANA', folga: 'domingo' }]; }, /ANA/],
    [(o) => { o.equipe.pessoas = [{ nome: 'ANA', turno: 'tarde' }]; }, /turno/],
    [(o) => { o.equipe.pessoas = [{ nome: 'ANA', folga: 'dom' }]; }, /domingo segue o rodízio/],
    [(o) => { o.equipe.pessoas = [{ nome: 'ANA', folga2: 'dom' }]; }, /domingo segue o rodízio/],
    [(o) => { o.funcionamento.seg = { abre: '22:00', fecha: '10:00', fechado: false }; }, /seg/],
    [(o) => { o.funcionamento.ter = { abre: '10:00', fecha: '10:00', fechado: false }; }, /ter/],
    [(o) => { o.funcionamento.qua = { abre: '9:00', fecha: '18:00', fechado: false }; }, /qua/],
    [(o) => { o.funcionamento.qui = { abre: '10:00', fecha: '24:00', fechado: false }; }, /qui/],
    [(o) => { o.funcionamento.sex = { abre: '10:00', fecha: '18:00' }; }, /sex/],
    [(o) => { delete o.funcionamento.dom; }, /dom/],
    [(o) => { o.funcionamento.feriado = { abre: '18:00', fecha: '12:00', fechado: false, mesmoDoDia: false }; }, /feriados/],
    [(o) => { o.funcionamento.feriado = { abre: '12:00', fecha: '18:00', fechado: false }; }, /feriados/],
    [(o) => { o.funcionamento.feriado = 'fechado'; }, /feriados/],
  ];
  for (const [fn, msg] of recusas) {
    const erro = com(fn);
    assert.ok(erro, `recusa: ${fn.toString().slice(7, 90)}`);
    assert.match(erro, msg, fn.toString().slice(7, 90));
  }
  for (const ruim of [null, undefined, 'x', {}, { funcionamento: SEMANA }, { equipe: {} }]) assert.equal(validarOperacao(ruim), 'Dados inválidos.');
});

/** a rota PUT /lojas/:id/operacao num app de mentira (o mesmo jeito do comissao-regras.test.js), sem subir o servidor */
let tmpDir = null;
after(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });
function rotaOperacao() {
  if (!process.env.DATA_DIR) process.env.DATA_DIR = tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feriados-regras-'));
  process.env.CONFIG_FILE = process.env.CONFIG_FILE || path.join(process.env.DATA_DIR, 'lojas.json');
  const C = require('../../src/config');
  const ADMIN = require('../../src/admin-api');
  let router = null;
  const app = { use: (p, r) => { if (p === '/api/admin') router = r; } };
  ADMIN.registrar(app, { dadosLoja: async () => ({}), pacoteLimpar: () => {}, vendedoresDe: () => [], rawDe: () => null, totaisSemEG: () => ({}), vendasMetaMes: () => ({}), MAX_UPLOAD_MB: 1, NOTIF: {}, obterIndicadores: async () => null, arquivoLogo: () => null, LOGO_EXT: [] });
  assert.ok(router, 'admin-api registra o roteador em /api/admin');
  const guarda = router.stack.find((l) => !l.route).handle; // r.use: só admin/franqueado e X-Painel
  const layer = router.stack.find((l) => l.route && l.route.path === '/lojas/:id/operacao' && l.route.methods.put);
  assert.ok(layer, 'rota PUT /lojas/:id/operacao existe');
  const pilha = layer.route.stack.map((s) => s.handle);
  const lojaPermitida = pilha[0], handler = pilha[pilha.length - 1];
  return (body, { perfil = 'admin', lojaId = 'teste', lojasDele = [], xPainel = '1' } = {}) => {
    const cfg = { lojas: [{ id: 'teste', nome: 'Loja Teste' }, { id: 'outra', nome: 'Outra' }] };
    const auditoria = [];
    const orig = { get: C.get, alterar: C.alterar, auditar: C.auditar };
    C.get = () => cfg; C.alterar = (fn) => fn(cfg); C.auditar = (...a) => auditoria.push(a);
    const out = { status: 200, json: null };
    const res = { status(s) { out.status = s; return res; }, json(j) { out.json = j; return res; } };
    const req = { method: 'PUT', perfil, user: 'dono', params: { id: lojaId }, body, get: (h) => (h === 'X-Painel' ? xPainel : undefined),
      lojas: lojasDele.map((id) => cfg.lojas.find((l) => l.id === id)) };
    try {
      let passou = false;
      guarda(req, res, () => { passou = true; });
      if (passou) { passou = false; lojaPermitida(req, res, () => { passou = true; }); }
      if (passou) handler(req, res);
    } finally { Object.assign(C, orig); }
    return { ...out, auditoria, operacao: cfg.lojas[0].operacao };
  };
}

test('ESC-28: só admin e franqueado da loja salvam o horário e a equipe; o servidor valida e audita', () => {
  const put = rotaOperacao();
  const ok = put({ operacao: opValida() });
  assert.equal(ok.status, 200); assert.deepEqual(ok.json, { ok: true });
  assert.equal(ok.operacao.equipe.escala, '6x1');
  assert.equal(ok.auditoria.length, 1);
  assert.equal(ok.auditoria[0][1], 'alterou horário e equipe');
  assert.deepEqual(ok.auditoria[0][3], { loja: 'teste', funcionarios: 3, carga: 44, escala: '6x1' });
  // simular na tela não grava: gerente e vendedora não salvam (403), nem pedido sem X-Painel
  for (const perfil of ['gerente', 'vendedor']) {
    const r = put({ operacao: opValida() }, { perfil, lojasDele: ['teste'] });
    assert.equal(r.status, 403, perfil); assert.equal(r.operacao, undefined); assert.equal(r.auditoria.length, 0);
  }
  const semCab = put({ operacao: opValida() }, { xPainel: null });
  assert.equal(semCab.status, 403); assert.equal(semCab.operacao, undefined);
  // franqueado: só a loja dele
  assert.equal(put({ operacao: opValida() }, { perfil: 'franqueado', lojasDele: ['outra'] }).status, 404);
  assert.equal(put({ operacao: opValida() }, { perfil: 'franqueado', lojasDele: ['teste'] }).status, 200);
  // inválido: 400, nada gravado nem auditado
  const ruim = opValida(); ruim.equipe.funcionarios = 99;
  const r = put({ operacao: ruim });
  assert.equal(r.status, 400); assert.match(r.json.erro, /funcionários/); assert.equal(r.operacao, undefined); assert.equal(r.auditoria.length, 0);
});
