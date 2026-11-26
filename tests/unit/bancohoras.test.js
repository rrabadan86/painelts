'use strict';
// Banco de horas dos feriados (decisão do dono, 26/11/2026): feriado no banco vale o dobro, folga pelo banco desconta a jornada,
// a hora devida pela pessoa vence no prazo (some) e o crédito dela não vence (vira aviso).
const test = require('node:test');
const assert = require('node:assert');
const BH = require('../../public/js/bancohoras.js');

const eq = { operacao: { equipe: { cargaSemanal: 44, escala: '6x1' } } }; // 44h ÷ 6 = 7h20
const fer = (lista) => (ym) => lista.filter((f) => f.data.startsWith(ym));

test('BANCO-01: feriado no banco vale o dobro; "pagar" não mexe no saldo; antes de "desde" é sempre pagar', () => {
  const cfg = { ...eq, bancoHoras: { desde: '2026-11', prazo: 6 },
    feriadosAcerto: { '2026-12': { '2026-12-08': { d: 'banco', p: { BIA: 'pagar' } } } } };
  const r = BH.calcular(cfg, { ate: '2026-12-31', feriadosDoMes: fer([
    { data: '2026-10-12', nome: 'Aparecida', horas: { ANA: 360 } }, // antes de desde: não entra
    { data: '2026-12-08', nome: 'N. Sra.', horas: { ANA: 360, BIA: 360 } },
  ]) });
  assert.strictEqual(r.pessoas.get('ANA').saldo, 720);
  assert.ok(!r.pessoas.has('BIA'), 'quem recebe o feriado em dinheiro não tem movimento no banco');
  assert.strictEqual(BH.acertoDe(cfg, '2026-12-08', 'Bia'), 'pagar');
  assert.strictEqual(BH.acertoDe(cfg, '2026-10-12', 'ana'), 'pagar');
  assert.strictEqual(BH.acertoDe({ ...cfg, bancoHoras: { desde: '2026-11', padrao: 'pagar' } }, '2026-11-20', 'ana'), 'pagar');
});

test('BANCO-02: exemplo do dono — devia 20h, trabalhou 6h no feriado, fica devendo 8h', () => {
  const cfg = { ...eq, bancoHoras: { desde: '2026-12', lanc: [{ id: 'a', nome: 'ANA', data: '2026-12-01', min: -1200, motivo: 'saldo' }] } };
  const r = BH.calcular(cfg, { ate: '2026-12-31', feriadosDoMes: fer([{ data: '2026-12-08', nome: 'N. Sra.', horas: { ANA: 360 } }]) });
  assert.strictEqual(r.pessoas.get('ANA').saldo, -480);
});

test('BANCO-03: folga pelo banco desconta a jornada (carga ÷ dias da escala); folga futura ainda não conta', () => {
  const cfg = { ...eq, escalaAjustes: { '2026-12': { '2026-12-10': { ANA: { tipo: 'folga', banco: true } }, '2026-12-28': { ANA: { tipo: 'folga', banco: true } }, '2026-12-11': { BIA: { tipo: 'folga' } } } } };
  const r = BH.calcular(cfg, { ate: '2026-12-20', feriadosDoMes: fer([]) });
  assert.strictEqual(BH.jornadaMin(cfg), 440);
  assert.strictEqual(r.pessoas.get('ANA').saldo, -440);
  assert.ok(!r.pessoas.has('BIA'), 'folga normal não é do banco');
  assert.strictEqual(BH.jornadaMin({ operacao: { equipe: { cargaSemanal: 44, escala: '4x3' } } }), 660);
});

test('BANCO-04: hora devida vence no prazo e some; crédito não vence e vira aviso', () => {
  const lanc = [{ id: '1', nome: 'ANA', data: '2026-01-10', min: -300, motivo: 'saiu cedo' }, { id: '2', nome: 'BIA', data: '2026-01-10', min: 300, motivo: 'ficou' }];
  const r = BH.calcular({ ...eq, bancoHoras: { prazo: 6, lanc } }, { ate: '2026-08-01', feriadosDoMes: null });
  const ana = r.pessoas.get('ANA'), bia = r.pessoas.get('BIA');
  assert.strictEqual(ana.saldo, 0, 'a dívida de 10/01 venceu em 10/07');
  assert.strictEqual(ana.ext.at(-1).tipo, 'venceu');
  assert.strictEqual(ana.ext.at(-1).data, '2026-07-10');
  assert.strictEqual(bia.saldo, 300, 'o crédito continua');
  assert.deepStrictEqual(bia.creditoAtrasado.map((x) => x.prazo), ['2026-07-10']);
  // 12 meses: ainda não venceu
  const r12 = BH.calcular({ ...eq, bancoHoras: { prazo: 12, lanc } }, { ate: '2026-08-01', feriadosDoMes: null });
  assert.strictEqual(r12.pessoas.get('ANA').saldo, -300);
  assert.strictEqual(r12.pessoas.get('BIA').creditoAtrasado.length, 0);
});

test('BANCO-05: compensa do mais antigo; crédito paga a dívida antes de virar crédito', () => {
  const lanc = [
    { id: '1', nome: 'ANA', data: '2026-01-10', min: -300 },
    { id: '2', nome: 'ANA', data: '2026-03-01', min: -200 },
    { id: '3', nome: 'ANA', data: '2026-04-01', min: 400 }, // paga os 300 de jan e 100 de mar
  ];
  const r = BH.calcular({ ...eq, bancoHoras: { prazo: 6, lanc } }, { ate: '2026-09-15', feriadosDoMes: null });
  const ana = r.pessoas.get('ANA');
  assert.strictEqual(ana.saldo, 0, 'sobravam 100 de 01/03, que venceram em 01/09');
  const m = BH.resumoMes(ana, '2026-09');
  assert.deepStrictEqual({ inicio: m.inicio, venceu: m.venceu, fim: m.fim }, { inicio: -100, venceu: 100, fim: 0 });
});

test('BANCO-06: resumo do mês para o fechamento (saldo anterior, entrou, saiu, saldo final)', () => {
  const cfg = { ...eq, bancoHoras: { desde: '2026-12', lanc: [{ id: 'a', nome: 'ANA', data: '2026-11-30', min: -1200 }] } };
  const r = BH.calcular(cfg, { ate: '2026-12-31', feriadosDoMes: fer([{ data: '2026-12-08', nome: 'N. Sra.', horas: { ANA: 360 } }]) });
  const m = BH.resumoMes(r.pessoas.get('ANA'), '2026-12');
  assert.deepStrictEqual({ inicio: m.inicio, entrou: m.entrou, saiu: m.saiu, venceu: m.venceu, fim: m.fim }, { inicio: -1200, entrou: 720, saiu: 0, venceu: 0, fim: -480 });
  assert.strictEqual(BH.sinal(-480), '−8h00');
});
