'use strict';
/* Regras da montagem da escala (Equipe → Movimento e escala, public/js/mapa.js) que só tinham teste de tela:
   ESC-06, ESC-08, ESC-09, ESC-13, ESC-14, ESC-15, ESC-17, ESC-20, ESC-22, ESC-23 e ESC-24.
   Sem mudar código de produção: core.js, feriados.js e mapa.js rodam no Node (vm) como em margem-resultado.test.js, com as
   peças de tela (TS.h, TS.card, TS.table…) trocadas por um desenho em memória. Entradas usadas:
   - TS._escala.montarRodizio / montarEscala / ajustesQueRepetem (expostas para teste);
   - TS._intervalo.pausaDoTurno;
   - TS.escalaTurnos(de, até): a mesma conta da aba Escala do mês (vendas → grade → necessidade → escala → escalaDoMes);
   - TS.pages.mapa(raiz): a tela inteira desenhada em memória (tabela "Pessoas necessárias por hora", semanas do mês,
     resumo do mês, editor do ajuste e os botões Replicar/Trazer).
   O relógio do contexto fica parado (a Escala do mês abre no mês de "hoje"). */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '../../public/js');

// peças de tela trocadas por nós em memória (nenhuma toca em document)
const PECAS = `
class N {
  constructor(tag, attrs, kids) { this.tag = tag; this.attrs = attrs || {}; this.kids = []; this.isConnected = true; this.value = this.attrs.value ?? '';
    this.style = {}; this.dataset = {}; this.classList = { toggle() {}, add() {}, remove() {}, contains() { return false; } }; this.append(...kids); }
  append(...k) { for (const x of k.flat(Infinity)) if (x != null && x !== false) this.kids.push(x); }
  replaceChildren(...k) { this.kids = []; this.append(...k); }
  remove() {} after() {} addEventListener() {} setAttribute() {} replaceWith() {} querySelector() { return null; }
  get textContent() { return this.kids.map((k) => (k && typeof k === 'object' && 'kids' in k ? k.textContent : String(k))).join(''); }
  set textContent(v) { this.kids = [String(v)]; }
}
TS.h = (tag, attrs, ...kids) => new N(tag, attrs, kids);
TS.card = (titulo, sub, ...k) => new N('card', { titulo, sub }, k);
TS.cardWithTools = TS.card;
TS.table = (o) => new N('table', { o }, []);
for (const k of ['heroi', 'seg', 'segFolha', 'dica', 'chart', 'empty', 'linhasNum', 'subEstoque', 'subGrupo', 'etqPrazo']) TS[k] = (...a) => new N(k, { a }, []);
TS.ativoVisivel = (x) => x; TS.aoConfirmar = () => {};
TS.ehCelular = () => false; TS.teclado = () => {}; TS.render = () => {}; TS.periodoTexto = () => '';
TS.pages = {};
TS.MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
TS.eu = { perfil: 'admin', pode: { configurar: true } };
`;

/** core, feriados e mapa num contexto novo, com o relógio parado em `hoje` */
function painel(hoje = '2026-09-10T15:00:00Z') {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout });
  ctx.__hoje = Date.parse(hoje);
  vm.runInContext(`var window = globalThis; var location = { pathname: '/', hash: '' };
    Date = class extends Date { constructor(...a) { if (a.length) super(...a); else super(__hoje); } static now() { return __hoje; } };`, ctx);
  const run = (f) => vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), ctx, { filename: f });
  run('core.js');
  vm.runInContext(PECAS, ctx);
  run('feriados.js');
  run('mapa.js');
  const TS = vm.runInContext('TS', ctx);
  /** vendas (um cupom por linha: [data, minuto do dia]) e a loja com a operação e os ajustes */
  TS.carregar = (cupons, cfg) => {
    const dict = { loja: ['L'], vendedor: ['ANA'], descricao: ['X'], produto: ['X'], grupo: ['ACESSÓRIOS'], grupoC: ['ACESSÓRIOS'], cat: ['Acessórios, LOJA'], cod: [''] };
    const v = { data: [], cupom: [], min: [], qtd: [], soNumeros: [], qtdCha: [], vu: [], du: [], vt: [], loja: [], vendedor: [], cod: [], descricao: [], produto: [], grupo: [], grupoC: [], cat: [] };
    cupons.forEach(([data, min], k) => {
      v.data.push(data); v.cupom.push(k + 1); v.min.push(min); v.qtd.push(1); v.soNumeros.push(null); v.qtdCha.push(0); v.vu.push(10); v.du.push(0); v.vt.push(10);
      for (const c of ['loja', 'vendedor', 'cod', 'descricao', 'produto', 'grupo', 'grupoC', 'cat']) v[c].push(0);
    });
    ctx.__raw = JSON.stringify({ vendas: v, dict, metas: [cfg] });
    vm.runInContext(`TS.db = TS.decode(JSON.parse(__raw)); TS.state.loja = ${JSON.stringify(cfg.id)}; TS.state.mapaOp = null; TS.state.escAj = null;`, ctx);
    return TS.db.metas[0];
  };
  return TS;
}
/** todos os nós do desenho em memória que passam no teste */
function achar(no, ok, out = []) {
  if (!no || typeof no !== 'object' || !('kids' in no)) return out;
  if (ok(no)) out.push(no);
  for (const k of no.kids) achar(k, ok, out);
  return out;
}
/** cópia no contexto do teste (arrays e objetos do vm têm outro protótipo) */
const js = (x) => JSON.parse(JSON.stringify(x));
const desenhar = (TS, aba) => { TS.state.mapaAba = aba; const raiz = TS.h('div'); TS.pages.mapa(raiz); return raiz; };
const botao = (raiz, re) => achar(raiz, (n) => n.tag === 'button' && re.test(n.textContent))[0];

const hm = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
const hTxt = (m) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;
const H = (abre, fecha) => ({ abre, fecha, fechado: false });
const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom']; // como no painel: 0 = segunda
const func = (abre = '10:00', fecha = '18:00') => Object.fromEntries(DIAS.map((d) => [d, H(abre, fecha)]));
/** necessidade (pessoas por hora, [dia 0=seg][hora]) com `n` pessoas nas horas abertas */
const needDe = (f, n = 1) => DIAS.map((d) => Array.from({ length: 24 }, (_, hr) => (f[d].fechado || hr * 60 + 60 <= hm(f[d].abre) || hr * 60 >= hm(f[d].fecha) ? 0 : n)));
const P = (nome, x = {}) => ({ nome, folga: 'auto', folga2: 'auto', turno: 'tanto', ...x });
const isoAdd = (iso, n) => { const d = new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5); return d.toISOString().slice(0, 10); };
/** um cupom por dia às 14h de `de` até `ate`: a escala sai com 1 pessoa por hora (o mínimo) */
const vendasCalmas = (de = '2026-08-03', ate = '2026-08-30') => { const out = []; for (let d = de; d <= ate; d = isoAdd(d, 1)) out.push([d, 14 * 60]); return out; };
const loja = (op, x = {}) => ({ id: 'l1', nome: 'Loja', nomesVenda: ['L'], operacao: op, ...x });
const equipe3 = (x = {}) => ({ funcionarios: 3, cargaSemanal: 44, escala: '6x1', intervalo: 60, capacidade: 4, pessoas: [{ nome: 'ANA' }, { nome: 'BIA' }, { nome: 'CAU' }], ...x });
const turnosDe = (r, iso) => r.turnos.filter((t) => t.iso === iso);

// ======================= ESC-08: pessoas por hora =======================
test('ESC-08: pessoas por hora = pico (80% dos dias) ÷ atendimentos por pessoa, arredondado para cima, nunca abaixo do mínimo do dia', () => {
  const TS = painel();
  // agosto/2026 (sem feriado nacional): 4 de cada dia da semana
  const cs = [];
  for (let d = '2026-08-03'; d <= '2026-08-30'; d = isoAdd(d, 1)) {
    const wd = (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7;
    for (let k = 0; k < 9; k++) cs.push([d, 14 * 60 + k]);                      // 14h: 9 atendimentos todo dia → 9 ÷ 4 = 2,25 → 3
    if (wd === 1 && d === '2026-08-25') for (let k = 0; k < 40; k++) cs.push([d, 15 * 60 + k]); // terça 15h: 0, 0, 0, 40 → pico (80%) 16 → 4
    if (wd === 3) for (let k = 0; k < (d === '2026-08-27' ? 5 : 4); k++) cs.push([d, 11 * 60 + k]); // quinta 11h: 4, 4, 4, 5 → pico 4,4 → 1,1
  }
  TS.carregar(cs, loja({ funcionamento: func(), equipe: equipe3({ minimoDia: { qua: 2 } }) }));
  const raiz = desenhar(TS, 'movimento');
  const tab = achar(raiz, (n) => n.tag === 'table' && /\bneed\b/.test(n.attrs.class || ''))[0];
  assert.ok(tab, 'a tabela "Pessoas necessárias por hora" foi desenhada');
  const cel = (dia, hr) => { const td = achar(tab, (n) => n.tag === 'td' && String(n.attrs.title || '').startsWith(`${dia} ${hr}h:`))[0]; return td ? +td.textContent : 0; };
  for (const dia of ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']) assert.strictEqual(cel(dia, 14), 3, `${dia} 14h: 9 atendimentos ÷ 4 por pessoa = 3`);
  assert.strictEqual(cel('Terça', 15), 4, 'terça 15h: o pico é o percentil 80 (16), não o máximo (40 → 10) nem a média (10 → 3)');
  assert.strictEqual(cel('Segunda', 15), 1, 'hora sem movimento: 1 pessoa (o mínimo de sempre)');
  // tolerância da conta: ceil(pico ÷ capacidade − 0,15) — 4,4 ÷ 4 = 1,1 fica em 1 pessoa (sem a folga, seriam 2)
  assert.strictEqual(cel('Quinta', 11), 1, 'pico 4,4 com 4 por pessoa: 1 pessoa (tolerância de 0,15)');
  // mínimo do dia (quarta = 2): vale nas horas calmas e não reduz o pico
  assert.strictEqual(cel('Quarta', 10), 2, 'quarta tem mínimo de 2 pessoas');
  assert.strictEqual(cel('Quarta', 14), 3, 'o pico acima do mínimo continua');
  // fora do horário: nada
  const fechado = achar(tab, (n) => n.tag === 'td' && /^Segunda 9h:/.test(String(n.attrs.title || '')));
  assert.strictEqual(fechado.length, 0, 'antes da abertura não pede ninguém');
});

// ======================= ESC-09: feriados fora do mapa de calor =======================
test('ESC-09: feriados (nacional e local) ficam fora do movimento que dimensiona a equipe', () => {
  const cs = [];
  for (let d = '2026-09-01'; d <= '2026-09-30'; d = isoAdd(d, 1)) cs.push([d, 14 * 60]);
  for (let k = 0; k < 40; k++) cs.push(['2026-09-07', 11 * 60 + k]); // Independência (segunda): movimento enorme
  for (let k = 0; k < 40; k++) cs.push(['2026-09-15', 11 * 60 + k]); // feriado local (terça)
  const local = { feriadosLocais: [{ data: '2026-09-15', nome: 'Aniversário da cidade', anual: true }] };
  const need11 = (cfgX) => {
    const TS = painel();
    TS.carregar(cs, loja({ funcionamento: func(), equipe: equipe3() }, cfgX));
    const raiz = desenhar(TS, 'movimento');
    const tab = achar(raiz, (n) => n.tag === 'table' && /\bneed\b/.test(n.attrs.class || ''))[0];
    const v = (dia) => +achar(tab, (n) => n.tag === 'td' && String(n.attrs.title || '').startsWith(`${dia} 11h:`))[0].textContent;
    const mov = achar(raiz, (n) => n.tag === 'card' && n.attrs.titulo === 'Movimento médio por hora')[0];
    return { seg: v('Segunda'), ter: v('Terça'), sub: mov.attrs.sub };
  };
  const com = need11(local);
  assert.strictEqual(com.seg, 1, 'o 7 de setembro não pesa na segunda');
  assert.strictEqual(com.ter, 1, 'o feriado local não pesa na terça');
  assert.match(com.sub, /\(28 dias, sem os feriados/, '30 dias − 2 feriados');
  // sem o feriado local cadastrado, o mesmo dia entra na conta (o teste enxerga a diferença)
  const sem = need11({});
  assert.ok(sem.ter > 1, `sem o feriado local a terça 11h pede mais gente (veio ${sem.ter})`);
  assert.strictEqual(sem.seg, 1, 'o nacional continua fora');
  assert.match(sem.sub, /\(29 dias, sem os feriados/);
});

// ======================= ESC-13: folga fixa =======================
test('ESC-13: folga fixa vale nas semanas em que a pessoa trabalha no domingo (motivo "Folga fixa")', () => {
  const TS = painel();
  const f = func();
  const op = { funcionamento: f, equipe: { funcionarios: 4, cargaSemanal: 44, escala: '6x1', intervalo: 60, capacidade: 4, modelo: 'rodizio' } };
  const r = js(TS._escala.montarRodizio(needDe(f), op, [P('A', { folga: 'qua' }), P('B'), P('C'), P('D')]));
  assert.strictEqual(r.L, 4);
  assert.deepStrictEqual(r.fixos[0], [2, null, null], 'a fixa de A é a quarta');
  let vistas = 0;
  for (const s of r.semanas) {
    if (!s.turnosP[0][6]) continue; // semana em que A folga no domingo
    vistas++;
    assert.strictEqual(s.turnosP[0][2], null, 'A não trabalha na quarta');
    assert.strictEqual(s.motivos[0][2], 'Folga fixa');
    assert.strictEqual(s.turnosP[0].filter(Boolean).length, 6, '6x1: os outros 6 dias trabalhados');
  }
  assert.strictEqual(vistas, 3, 'A trabalha em 3 dos 4 domingos do ciclo');
});

test('ESC-13: domingo não pode ser folga fixa — o servidor recusa e a escala segue o rodízio no domingo', () => {
  // validarOperacao não é exportada por src/admin-api.js (só registrar e validarRegras): lemos o texto da função
  const src = fs.readFileSync(path.join(__dirname, '../../src/admin-api.js'), 'utf8');
  const ini = src.indexOf('const DIAS_SEMANA'), fim = src.indexOf('function validarRegras');
  assert.ok(ini > 0 && fim > ini, 'achei validarOperacao em src/admin-api.js');
  const validarOperacao = new Function(src.slice(ini, fim) + '; return validarOperacao;')();
  const f = Object.fromEntries(DIAS.map((d) => [d, { abre: '10:00', fecha: '18:00', fechado: false }]));
  const op = (pessoas) => ({ funcionamento: f, equipe: { funcionarios: 2, cargaSemanal: 44, escala: '5x2', intervalo: 60, capacidade: 4, modelo: 'rodizio', pessoas } });
  assert.strictEqual(validarOperacao(op([{ nome: 'A', folga: 'qua', folga2: 'sex' }, { nome: 'B', folga: 'auto' }])), null);
  assert.match(validarOperacao(op([{ nome: 'A', folga: 'dom' }])), /domingo segue o rodízio/);
  assert.match(validarOperacao(op([{ nome: 'A', folga: 'qua', folga2: 'dom' }])), /domingo segue o rodízio/);
  // e, se chegasse, a tela não transforma o domingo em folga fixa: o domingo continua girando
  const TS = painel();
  const fx = func();
  const r = js(TS._escala.montarRodizio(needDe(fx), { funcionamento: fx, equipe: { funcionarios: 4, cargaSemanal: 44, escala: '6x1', intervalo: 60, capacidade: 4, modelo: 'rodizio' } },
    [P('A', { folga: 'dom' }), P('B'), P('C'), P('D')]));
  const domTrab = r.semanas.filter((s) => s.turnosP[0][6]).length;
  assert.strictEqual(domTrab, r.L - 1, 'A trabalha em todos os domingos menos o do rodízio');
  for (const s of r.semanas) assert.notStrictEqual(s.motivos[0][6], 'Folga fixa');
});

test('ESC-13: sem folga fixa, o painel escolhe os dias de menor movimento (de terça a sábado)', () => {
  const TS = painel();
  const f = func();
  const need = needDe(f, 2);
  for (let hr = 10; hr < 18; hr++) need[3][hr] = 1; // quinta: o dia mais calmo
  const r = js(TS._escala.montarRodizio(need, { funcionamento: f, equipe: { funcionarios: 5, cargaSemanal: 44, escala: '5x2', intervalo: 60, capacidade: 4, modelo: 'rodizio', maxFolgaDia: 2 } },
    ['A', 'B', 'C', 'D', 'E'].map((n) => P(n))));
  const todos = r.fixos.flatMap((x) => x.filter((d) => d != null));
  assert.strictEqual(r.fixos[0][0], 3, 'a primeira fixa automática cai na quinta');
  const conta = (wd) => todos.filter((d) => d === wd).length;
  assert.ok([1, 2, 4, 5].every((wd) => conta(3) >= conta(wd)), `a quinta é o dia mais usado (${JSON.stringify(todos)})`);
  assert.ok(!todos.includes(0) && !todos.includes(6), 'segunda (já é do rodízio) e domingo nunca são fixa automática');
  // e não repete o mesmo dia para as duas folgas da pessoa
  for (const [a, b] of r.fixos) assert.notStrictEqual(a, b);
});

// ======================= ESC-14: preferência manhã/noite =======================
test('ESC-14: preferência manhã/noite respeitada no rodízio sem deixar a loja sozinha', () => {
  const TS = painel();
  const f = func('10:00', '22:00');
  const op = { funcionamento: f, equipe: { funcionarios: 4, cargaSemanal: 44, escala: '6x1', intervalo: 60, capacidade: 4, modelo: 'rodizio' } };
  const r = js(TS._escala.montarRodizio(needDe(f), op, [P('A', { turno: 'noite' }), P('B', { turno: 'manha' }), P('C', { turno: 'manha' }), P('D', { turno: 'manha' })]));
  for (const [w, s] of r.semanas.entries()) {
    assert.strictEqual(s.descoberto, 0, `semana ${w + 1}: a loja nunca fica sozinha`);
    for (let wd = 0; wd < 7; wd++) {
      const a = s.turnosP[0][wd];
      if (!a) continue;
      assert.strictEqual(a.fim, 22 * 60, `A (noite) fecha a loja (semana ${w + 1}, dia ${wd})`);
      for (const i of [1, 2, 3]) { const t = s.turnosP[i][wd]; if (t) assert.strictEqual(t.ini, 10 * 60, `com A fechando, quem prefere manhã abre (semana ${w + 1}, dia ${wd})`); }
    }
  }
  // todos preferem manhã: a preferência cede e alguém fecha (a loja continua coberta)
  const r2 = js(TS._escala.montarRodizio(needDe(f), op, ['A', 'B', 'C', 'D'].map((n) => P(n, { turno: 'manha' }))));
  for (const s of r2.semanas) {
    assert.strictEqual(s.descoberto, 0);
    for (let wd = 0; wd < 7; wd++) assert.ok(s.turnosP.some((p) => p[wd] && p[wd].fim === 22 * 60), `alguém fecha no dia ${wd}`);
  }
});

test('ESC-14: escala livre — a preferência troca turnos entre as pessoas sem aumentar o tempo de loja sozinha', () => {
  const TS = painel();
  const f = func('10:00', '22:00');
  const montar = (prefs) => js(TS._escala.montarEscala(needDe(f), { funcionamento: f, equipe: { funcionarios: 3, cargaSemanal: 44, escala: '6x1', intervalo: 60, capacidade: 4, pessoas: prefs.map((turno) => ({ turno })) } }, 3));
  const base = montar(['tanto', 'tanto', 'tanto']);
  const pref = montar(['noite', 'manha', 'tanto']);
  assert.ok(pref.descoberto <= base.descoberto, `com preferência: ${pref.descoberto} h sozinha; sem: ${base.descoberto} h`);
  // A (noite) fecha e B (manhã) abre em todos os dias em que os dois trabalham
  for (let wd = 0; wd < 7; wd++) {
    const a = pref.pessoas[0][wd], b = pref.pessoas[1][wd];
    if (a && b) { assert.strictEqual(a.fim, 22 * 60, `A fecha no dia ${wd}`); assert.strictEqual(b.ini, 10 * 60, `B abre no dia ${wd}`); }
  }
});

test('ESC-14: escala livre com 3 pessoas cobre 10h–22h todos os dias (dá: uma abre, outra fecha)', () => {
  const TS = painel();
  const f = func('10:00', '22:00');
  const es = js(TS._escala.montarEscala(needDe(f), { funcionamento: f, equipe: { funcionarios: 3, cargaSemanal: 44, escala: '6x1', intervalo: 60, capacidade: 4 } }, 3));
  assert.strictEqual(es.descoberto, 0, `a loja ficou ${es.descoberto} h por semana sozinha`);
});

// ======================= ESC-15: dia fechado =======================
test('ESC-15: dia fechado — ninguém trabalha (escala livre e rodízio) e a escala do mês mostra Fechado', () => {
  const TS = painel();
  const f = func(); f.qua = { abre: '10:00', fecha: '18:00', fechado: true };
  const need = needDe(f);
  assert.deepStrictEqual(need[2], Array(24).fill(0), 'quarta fechada não pede ninguém');
  const es = js(TS._escala.montarEscala(need, { funcionamento: f, equipe: equipe3() }, 3));
  for (const p of es.pessoas) assert.strictEqual(p[2], null, 'livre: ninguém na quarta');
  const r = js(TS._escala.montarRodizio(need, { funcionamento: f, equipe: { funcionarios: 4, cargaSemanal: 44, escala: '6x1', intervalo: 60, capacidade: 4, modelo: 'rodizio' } }, ['A', 'B', 'C', 'D'].map((n) => P(n))));
  for (const s of r.semanas) for (const p of s.turnosP) assert.strictEqual(p[2], null, 'rodízio: ninguém na quarta');
  // escala do mês (datas reais): nenhuma quarta com turno
  TS.carregar(vendasCalmas(), loja({ funcionamento: f, equipe: equipe3() }));
  const out = js(TS.escalaTurnos('2026-09-01', '2026-09-30'));
  assert.ok(out.turnos.length > 0);
  assert.ok(out.turnos.every((t) => new Date(t.iso + 'T12:00:00Z').getUTCDay() !== 3), 'nenhuma quarta de setembro tem turno');
  const raiz = desenhar(TS, 'escala');
  const fechados = achar(raiz, (n) => n.tag === 'td' && /^fechado\b/.test(n.attrs.class || '') && n.textContent === 'Fechado');
  assert.strictEqual(fechados.length, 5 * 3, 'as 5 quartas de setembro × 3 pessoas aparecem "Fechado"');
});

test('ESC-15: domingo fechado — sem rodízio (ciclo de 1 semana, ninguém com "Folga (rodízio)"), a segunda não é puxada', () => {
  const TS = painel();
  const f = func(); f.dom = { abre: '10:00', fecha: '18:00', fechado: true };
  for (const modelo of ['rodizio', 'rodizio-dom']) for (const escala of ['6x1', '5x2']) {
    const r = js(TS._escala.montarRodizio(needDe(f), { funcionamento: f, equipe: { funcionarios: 4, cargaSemanal: 44, escala, intervalo: 60, capacidade: 4, modelo } }, ['A', 'B', 'C', 'D'].map((n) => P(n))));
    const ctxt = `${modelo} ${escala}`;
    assert.strictEqual(r.kDom, 0, `${ctxt}: ninguém no domingo`);
    assert.strictEqual(r.L, 1, `${ctxt}: sem ciclo de rodízio`);
    for (const s of r.semanas) s.turnosP.forEach((p, i) => {
      assert.strictEqual(p[6], null);
      assert.strictEqual(s.motivos[i][6], 'Fechado', `${ctxt}: domingo aparece como Fechado`);
      assert.ok(!s.motivos[i].some((m) => /rodízio|após domingo/.test(m)), `${ctxt}: nada de folga do rodízio (${s.motivos[i]})`);
      // o domingo fechado já é o descanso da semana: 6x1 → 6 dias; 5x2 → 5 dias
      assert.strictEqual(p.filter(Boolean).length, escala === '6x1' ? 6 : 5, `${ctxt}: dias trabalhados de ${r.semanas.length} semana`);
    });
  }
});

// ======================= ESC-17: "Semana 1" do rodízio =======================
test('ESC-17: a "Semana 1" do rodízio começa na data escolhida (Pessoa 1 folga nesse domingo; qualquer dia da semana vale)', () => {
  const op = (x = {}) => ({ funcionamento: func(), equipe: { funcionarios: 4, cargaSemanal: 44, escala: '6x1', intervalo: 60, capacidade: 4, modelo: 'rodizio', pessoas: ['ANA', 'BIA', 'CAU', 'DAN'].map((nome) => ({ nome })), ...x } });
  const folgamNoDomingo = (opX, domingos) => {
    const TS = painel();
    TS.carregar(vendasCalmas(), loja(opX));
    const out = js(TS.escalaTurnos('2026-09-01', '2026-10-31'));
    return domingos.map((d) => out.pessoas.filter((p) => !out.turnos.some((t) => t.iso === d && t.nome === p)).join(','));
  };
  const DOMS = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11'];
  // semana de domingo a sábado, começando no domingo 13/09
  assert.deepStrictEqual(folgamNoDomingo(op({ inicioRodizio: '2026-09-13' }), DOMS), ['DAN', 'ANA', 'BIA', 'CAU', 'DAN', 'ANA']);
  // data no meio da semana (quarta 16/09): conta a partir do domingo daquela semana — o mesmo resultado
  assert.deepStrictEqual(folgamNoDomingo(op({ inicioRodizio: '2026-09-16' }), DOMS), ['DAN', 'ANA', 'BIA', 'CAU', 'DAN', 'ANA']);
  // uma semana depois: tudo anda uma semana
  assert.deepStrictEqual(folgamNoDomingo(op({ inicioRodizio: '2026-09-20' }), DOMS), ['CAU', 'DAN', 'ANA', 'BIA', 'CAU', 'DAN']);
  // quem folga no domingo folga também na segunda seguinte (rodízio com a segunda)
  const TS = painel();
  TS.carregar(vendasCalmas(), loja(op({ inicioRodizio: '2026-09-13' })));
  const out = js(TS.escalaTurnos('2026-09-13', '2026-09-14'));
  assert.ok(!out.turnos.some((t) => t.nome === 'ANA'), 'ANA folga no domingo 13/09 e na segunda 14/09');
  // semana de segunda a domingo: a data escolhida (quarta 16/09) leva à semana de 14/09 a 20/09 → ANA folga no domingo 20/09
  assert.deepStrictEqual(folgamNoDomingo(op({ inicioRodizio: '2026-09-16', inicioSemana: 'seg' }), DOMS).slice(1, 4), ['DAN', 'ANA', 'BIA']);
});

// ======================= ESC-20 e ESC-06: feriado =======================
test('ESC-20: feriado fechado = ninguém trabalha; com horário = turno cortado; menos de 1h = folga; "mesmo do dia" = dia normal', () => {
  const FER = '2026-09-16', NORMAL = '2026-09-23'; // duas quartas
  const rodar = (x, funcX = {}) => {
    const TS = painel();
    TS.carregar(vendasCalmas(), loja({ funcionamento: { ...func(), ...funcX }, equipe: equipe3() }, { feriadosLocais: [{ data: FER, nome: 'Padroeira', anual: true }], ...x }));
    return js(TS.escalaTurnos('2026-09-14', '2026-09-27'));
  };
  const sem = rodar({});
  const normal = turnosDe(sem, NORMAL);
  assert.ok(normal.length >= 2, 'na quarta normal trabalham pelo menos 2');
  assert.deepStrictEqual(turnosDe(sem, FER).map((t) => [t.nome, t.ini, t.fim]), normal.map((t) => [t.nome, t.ini, t.fim]), 'feriado sem horário próprio: horário do dia da semana');
  // fechado
  assert.deepStrictEqual(turnosDe(rodar({ feriadosHorario: { [FER]: { fechado: true } } }), FER), [], 'loja fechada: ninguém trabalha');
  // com horário (12h–16h): os mesmos turnos, cortados no horário do feriado
  const cortado = turnosDe(rodar({ feriadosHorario: { [FER]: { abre: '12:00', fecha: '16:00', fechado: false } } }), FER);
  assert.deepStrictEqual(cortado.map((t) => [t.nome, t.ini, t.fim]), normal.map((t) => [t.nome, Math.max(t.ini, 720), Math.min(t.fim, 960)]));
  for (const t of cortado) assert.strictEqual(t.pausa, null, 'turno de 4h: sem intervalo (ESC-06)');
  // horário que deixa menos de 1h no turno: folga
  assert.deepStrictEqual(turnosDe(rodar({ feriadosHorario: { [FER]: { abre: '17:20', fecha: '18:00', fechado: false } } }), FER), [], '40 min: vira folga');
  // padrão de feriados (Horário e equipe) vale quando a data não tem horário próprio; o da data vale mais
  const pad = { feriado: { mesmoDoDia: false, fechado: false, abre: '10:00', fecha: '15:00' } };
  assert.ok(turnosDe(rodar({}, pad), FER).every((t) => t.fim <= 15 * 60), 'padrão de feriados: até as 15h');
  assert.deepStrictEqual(turnosDe(rodar({ feriadosHorario: { [FER]: { fechado: true } } }, pad), FER), [], 'o horário da data vale mais que o padrão');
  assert.deepStrictEqual(turnosDe(rodar({}, { feriado: { mesmoDoDia: true, fechado: true } }), FER).map((t) => [t.ini, t.fim]), normal.map((t) => [t.ini, t.fim]), '"mesmo horário do dia"');
});

test('ESC-06: turno cortado por feriado ou digitado no ajuste — intervalo pela jornada real, no meio do turno', () => {
  const FER = '2026-09-16';
  const TS = painel();
  TS.carregar(vendasCalmas(), loja({ funcionamento: func(), equipe: equipe3() }, {
    feriadosLocais: [{ data: FER, nome: 'Padroeira', anual: true }], feriadosHorario: { [FER]: { abre: '10:00', fecha: '15:00', fechado: false } },
    escalaAjustes: { '2026-09': { '2026-09-17': { ANA: { tipo: 'trab', ini: '10:00', fim: '14:00' }, BIA: { tipo: 'trab', ini: '11:00', fim: '18:00' } }, '2026-09-18': { ANA: { tipo: 'trab', ini: '10:00', fim: '15:00' } } } },
  }));
  const out = js(TS.escalaTurnos('2026-09-14', '2026-09-20'));
  // feriado 10h–15h (5h): 30 min (faixa de 4h a 6h), no meio
  for (const t of turnosDe(out, FER)) { assert.deepStrictEqual([t.ini, t.fim], [600, 900]); assert.deepStrictEqual(t.pausa, [740, 770]); }
  const de = (iso, nome) => turnosDe(out, iso).find((t) => t.nome === nome);
  assert.strictEqual(de('2026-09-17', 'ANA').pausa, null, 'ajuste de 4h: sem intervalo');
  assert.deepStrictEqual(de('2026-09-17', 'BIA').pausa, [11 * 60 + 180, 11 * 60 + 240], 'ajuste de 7h: 1h (6h de trabalho), no meio');
  assert.deepStrictEqual(de('2026-09-18', 'ANA').pausa, [740, 770], 'ajuste de 5h: 30 min');
  // a conta direta: o intervalo que já existia continua quando ainda cabe; senão vai para o meio
  const { pausaDoTurno } = TS._intervalo;
  const e = { intervalo: 60 };
  assert.deepStrictEqual(js(pausaDoTurno(600, 1020, e, [780, 840])), [780, 840], 'turno 10h–17h: o intervalo de antes (13h–14h) serve');
  assert.deepStrictEqual(js(pausaDoTurno(600, 1020, e, [600, 660])), [780, 840], 'intervalo de antes colado na entrada: vai para o meio');
  assert.deepStrictEqual(js(pausaDoTurno(600, 1140, { intervalo: 90, intervaloAte8: 30 })), [830, 920], '9h com 90/30: 90 min (com 30 seriam 8h30 de trabalho, acima de 8h)');
});

// ======================= ESC-22: repetir ajustes =======================
test('ESC-22: ajustesQueRepetem — só os marcados para repetir, em todos os mesmos dias da semana, sem os feriados; vale o mais recente', () => {
  const TS = painel();
  const src = {
    '2026-09-02': { ANA: { tipo: 'folga', repete: true } },                                 // quarta
    '2026-09-03': { BIA: { tipo: 'trab', ini: '10:00', fim: '14:00' } },                     // pontual: não vai
    '2026-09-01': { CAU: { tipo: 'trab', ini: '10:00', fim: '14:00', repete: true } },       // terça…
    '2026-09-08': { CAU: { tipo: 'trab', ini: '12:00', fim: '18:00', repete: true } },       // …e a terça seguinte: vale esta
    '2026-08-26': { DAN: { tipo: 'folga', repete: true } },                                 // outro mês: fora
  };
  const out = js(TS._escala.ajustesQueRepetem('2026-09', '2026-10', src, new Set(['2026-10-14'])));
  const dias = (nome) => Object.keys(out).filter((d) => out[d][nome]).sort();
  assert.deepStrictEqual(dias('ANA'), ['2026-10-07', '2026-10-21', '2026-10-28'], 'quartas de outubro, sem o feriado de 14/10');
  assert.deepStrictEqual(dias('CAU'), ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']);
  assert.ok(dias('CAU').every((d) => out[d].CAU.ini === '12:00'), 'o ajuste mais recente da terça');
  assert.deepStrictEqual(dias('BIA'), [], 'pontual fica só no dia dele');
  assert.deepStrictEqual(dias('DAN'), [], 'só os ajustes do mês de origem');
});

test('ESC-22: no editor do dia, "Neste e nos próximos" aplica nos mesmos dias da semana do mês, pulando feriados e férias', () => {
  const TS = painel('2026-09-10T15:00:00Z');
  TS.carregar(vendasCalmas(), loja({ funcionamento: func(), equipe: equipe3() }, {
    feriadosLocais: [{ data: '2026-09-16', nome: 'Padroeira', anual: true }], ferias: [{ vendedor: 'Ana', de: '2026-09-23', ate: '2026-09-25' }],
  }));
  const aplicar = (vale) => {
    TS.state.escAj = { chave: 'l1|2026-09', dados: {}, sujo: false, sel: { iso: '2026-09-02', i: 0 } };
    const raiz = desenhar(TS, 'escala');
    const ed = achar(raiz, (n) => n.attrs.class === 'aj-editor')[0];
    assert.ok(ed, 'o editor do dia abriu');
    const sels = achar(ed, (n) => n.tag === 'select');
    sels[0].value = 'folga';
    achar(ed, (n) => n.tag === 'select' && /aj-vale/.test(n.attrs.class || ''))[0].value = vale;
    botao(ed, /^Aplicar$/).attrs.onclick();
    return js(TS.state.escAj);
  };
  const rep = aplicar('repete');
  assert.deepStrictEqual(Object.keys(rep.dados).sort(), ['2026-09-02', '2026-09-09', '2026-09-30'], 'quartas de setembro sem o feriado (16) e sem as férias (23)');
  for (const d of Object.values(rep.dados)) assert.deepStrictEqual(d.ANA, { tipo: 'folga', repete: true });
  assert.strictEqual(rep.sujo, true, 'fica para salvar');
  const pont = aplicar('dia');
  assert.deepStrictEqual(pont.dados, { '2026-09-02': { ANA: { tipo: 'folga' } } }, 'pontual: só o dia');
});

// ======================= ESC-23: replicar / trazer =======================
test('ESC-23: "Replicar para outubro" e "Trazer de setembro" levam só os que repetem, sem feriados, férias e quem saiu da equipe; os ajustes de lá ficam', () => {
  const setembro = {
    '2026-09-02': { ANA: { tipo: 'folga', repete: true } },                                  // quartas
    '2026-09-14': { BIA: { tipo: 'trab', ini: '12:00', fim: '18:00', repete: true } },        // segundas (12/10 é feriado)
    '2026-09-01': { CAU: { tipo: 'folga', repete: true } },                                  // terças (CAU de férias 13/10)
    '2026-09-03': { BIA: { tipo: 'folga' } },                                                // pontual
    '2026-09-04': { ZE: { tipo: 'folga', repete: true } },                                   // não está na equipe
  };
  const outubro = { '2026-10-07': { ANA: { tipo: 'trab', ini: '10:00', fim: '14:00' } } };  // já lançado em outubro: fica
  const cfgX = { escalaAjustes: { '2026-09': setembro, '2026-10': outubro }, ferias: [{ vendedor: 'CAU', de: '2026-10-13', ate: '2026-10-14' }] };
  const esperado = (d) => {
    const dias = (nome) => Object.keys(d).filter((x) => d[x][nome]).sort();
    assert.deepStrictEqual(dias('ANA'), ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28']);
    assert.deepStrictEqual(d['2026-10-07'].ANA, { tipo: 'trab', ini: '10:00', fim: '14:00' }, 'o ajuste que já existia em outubro não é trocado');
    assert.deepStrictEqual(d['2026-10-14'].ANA, { tipo: 'folga', repete: true });
    assert.deepStrictEqual(dias('BIA'), ['2026-10-05', '2026-10-19', '2026-10-26'], 'segundas sem o feriado de 12/10; o pontual de 03/09 não vem');
    assert.deepStrictEqual(dias('CAU'), ['2026-10-06', '2026-10-20', '2026-10-27'], 'terças sem as férias');
    assert.deepStrictEqual(dias('ZE'), [], 'quem não está na equipe não vem');
  };
  // Replicar (em setembro)
  let TS = painel('2026-09-10T15:00:00Z');
  TS.carregar(vendasCalmas(), loja({ funcionamento: func(), equipe: equipe3() }, cfgX));
  let raiz = desenhar(TS, 'escala');
  const rep = botao(raiz, /^Replicar para outubro/);
  assert.ok(rep, 'botão "Replicar para outubro"');
  rep.attrs.onclick();
  assert.strictEqual(TS.state.escMesYm, '2026-10');
  assert.strictEqual(TS.state.escAj.chave, 'l1|2026-10');
  esperado(js(TS.state.escAj.dados));
  // Trazer (em outubro)
  TS = painel('2026-09-10T15:00:00Z');
  TS.carregar(vendasCalmas(), loja({ funcionamento: func(), equipe: equipe3() }, cfgX));
  TS.state.escMesYm = '2026-10';
  raiz = desenhar(TS, 'escala');
  const tra = botao(raiz, /Trazer de setembro/);
  assert.ok(tra, 'botão "‹ Trazer de setembro"');
  tra.attrs.onclick();
  esperado(js(TS.state.escAj.dados));
});

test('ESC-23: no rodízio, replicar leva para TODOS os mesmos dias da semana (não segue a semana do rodízio)', () => {
  // A matriz diz "seguindo o rodízio" e o comentário de `replicar` (mapa.js ~l. 1197) fala em "mesma semana do rodízio",
  // mas `semR`/`ancoraR` não são usados: vale a decisão do dono do `ajustesQueRepetem` (todos os mesmos dias da semana).
  const op = { funcionamento: func(), equipe: { funcionarios: 4, cargaSemanal: 44, escala: '6x1', intervalo: 60, capacidade: 4, modelo: 'rodizio', inicioRodizio: '2026-09-06', pessoas: ['ANA', 'BIA', 'CAU', 'DAN'].map((nome) => ({ nome })) } };
  const TS = painel('2026-09-10T15:00:00Z');
  TS.carregar(vendasCalmas(), loja(op, { escalaAjustes: { '2026-09': { '2026-09-03': { ANA: { tipo: 'folga', repete: true } } } } }));
  const raiz = desenhar(TS, 'escala');
  botao(raiz, /^Replicar para outubro/).attrs.onclick();
  const dias = Object.keys(js(TS.state.escAj.dados)).sort();
  assert.deepStrictEqual(dias, ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29'], 'todas as quintas de outubro, de qualquer semana do rodízio');
});

// ======================= ESC-24: horas líquidas =======================
test('ESC-24: horas líquidas = total − intervalo no dia, na semana e no mês (iguais à escala do período)', () => {
  const TS = painel('2026-09-10T15:00:00Z');
  TS.carregar(vendasCalmas(), loja({ funcionamento: func(), equipe: equipe3() }, {
    escalaAjustes: { '2026-09': { '2026-09-03': { BIA: { tipo: 'trab', ini: '10:00', fim: '14:00' } }, '2026-09-04': { CAU: { tipo: 'trab', ini: '10:00', fim: '15:00' } } } },
  }));
  const turnos = js(TS.escalaTurnos('2026-09-01', '2026-09-30')).turnos;
  const bruto = (t) => t.fim - t.ini, pausa = (t) => (t.pausa ? t.pausa[1] - t.pausa[0] : 0);
  const raiz = desenhar(TS, 'escala');
  const tabelas = achar(raiz, (n) => n.tag === 'table' && /\bsem-t\b/.test(n.attrs.class || ''));
  const resumo = tabelas.find((t) => /resumo/.test(t.attrs.class));
  const semanas = tabelas.filter((t) => !/resumo/.test(t.attrs.class));
  assert.strictEqual(semanas.length, 5, 'setembro/2026: 5 semanas de domingo a sábado');
  // dia: "Xh líquidas" em cada célula de trabalho
  const celulas = achar(raiz, (n) => n.tag === 'small' && n.attrs.class === 'liq-dia').map((n) => n.textContent);
  assert.strictEqual(celulas.length, turnos.length, 'uma por turno do mês');
  assert.deepStrictEqual(celulas.slice().sort(), turnos.map((t) => `${hTxt(bruto(t) - pausa(t))} líquidas`).sort());
  assert.ok(celulas.includes('4h líquidas'), 'ajuste de 4h: sem intervalo, 4h líquidas');
  assert.ok(celulas.includes('4h30 líquidas'), 'ajuste de 5h: 30 min de intervalo, 4h30 líquidas');
  // semana: colunas Total e Líquida por pessoa
  for (const tab of semanas) {
    const datas = achar(achar(tab, (n) => n.tag === 'thead')[0], (n) => n.tag === 'b').map((n) => n.textContent).filter((t) => /^\d\d\/09$/.test(t)).map((t) => `2026-09-${t.slice(0, 2)}`);
    for (const tr of achar(tab, (n) => n.tag === 'tr').slice(1, 4)) {
      const nome = tr.kids[0].textContent;
      const tot = tr.kids[tr.kids.length - 2].textContent, liq = tr.kids[tr.kids.length - 1].textContent;
      const ts = turnos.filter((t) => t.nome === nome && datas.includes(t.iso));
      assert.strictEqual(tot, hTxt(ts.reduce((s, t) => s + bruto(t), 0)), `${nome}: total da semana`);
      assert.strictEqual(liq, hTxt(ts.reduce((s, t) => s + bruto(t) - pausa(t), 0)), `${nome}: líquida da semana`);
    }
  }
  // mês: Horas totais e Horas líquidas do resumo
  for (const tr of achar(resumo, (n) => n.tag === 'tr').slice(1)) {
    const nome = tr.kids[0].textContent;
    const ts = turnos.filter((t) => t.nome === nome);
    assert.strictEqual(tr.kids[5].textContent, hTxt(ts.reduce((s, t) => s + bruto(t), 0)), `${nome}: horas totais do mês`);
    assert.strictEqual(tr.kids[6].kids[0], hTxt(ts.reduce((s, t) => s + bruto(t) - pausa(t), 0)), `${nome}: horas líquidas do mês`);
  }
});
