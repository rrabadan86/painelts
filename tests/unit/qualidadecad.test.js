'use strict';
// QUAL-CAD-01…05: Qualidade do cadastro (Clientes → Indicadores) — a conta pura
const { test } = require('node:test');
const assert = require('node:assert');
const Q = require('../../public/js/qualidadecad.js');

test('QUAL-CAD-02: celular — fixo, faltando dígito, DDD que não existe, número de mentira; celular antigo de 8 dígitos vale', () => {
  assert.strictEqual(Q.motivoCelular(''), 'vazio');
  assert.strictEqual(Q.motivoCelular('62 3241-0000'), 'telefone fixo');
  assert.strictEqual(Q.motivoCelular('62 9981-772'), 'faltando dígito');
  assert.strictEqual(Q.motivoCelular('(20) 99999-1234'), 'DDD que não existe');
  assert.strictEqual(Q.motivoCelular('(62) 99999-9999'), 'número de mentira');
  assert.strictEqual(Q.motivoCelular('5562981718205'), null);
  assert.strictEqual(Q.motivoCelular('6281718205'), null, 'sem o 9º dígito é o mesmo celular');
  assert.strictEqual(Q.chaveCel('6281718205'), Q.chaveCel('62981718205'));
  assert.strictEqual(Q.motivoCelular('(00) 98785-6612', true), null, 'a apresentação usa o DDD 00');
});

test('QUAL-CAD-01: completo, recebem WhatsApp, problemas e mesmo celular em vários CPFs', () => {
  const ok = { nome: 'Ana Souza', celular: '62981110001', nascimento: '1990-05-10', cidade: 'Goiânia', email: 'a@x.com' };
  const clientes = [
    { cpf: '1', ...ok },
    { cpf: '2', ...ok, celular: '62981110002', nascimento: '1900-01-01' },
    { cpf: '3', ...ok, celular: '6232410000', cidade: '' },
    { cpf: '4', ...ok, celular: '62981110004', email: '' },
    { cpf: '5', ...ok, celular: '6281110001', nome: 'Bia' }, // mesmo celular do 1 (sem o 9)
    { cpf: '6', ...ok, celular: '62981110006' },
  ];
  const r = Q.calcular({ clientes, semwpp: new Set(['6']), hoje: '2026-11-27', cadDe: (cpf) => ({ 1: '2026-11-20', 2: '2026-11-01', 3: '2026-06-10' }[cpf] || null) });
  assert.strictEqual(r.total, 6);
  assert.deepStrictEqual(r.por.nasc, ['2']);
  assert.deepStrictEqual(r.por.celinv, ['3']);
  assert.deepStrictEqual(r.por.cidade, ['3']);
  assert.deepStrictEqual(r.por.email, ['4']);
  assert.deepStrictEqual(r.por.nome, ['5']);
  assert.deepStrictEqual(r.por.semwpp, ['6']);
  assert.deepStrictEqual(r.por.repetido.sort(), ['1', '5']);
  assert.strictEqual(r.completos, 1, 'só o 1: o mesmo celular em outro CPF não tira do completo');
  assert.strictEqual(r.recebem, 4, 'fixo e sem WhatsApp não recebem');
  assert.strictEqual(r.motivoCel.get('3'), 'telefone fixo');
  assert.deepStrictEqual(r.novos, { n: 2, falha: 1 }, 'entraram em 30 dias: 1 (completo) e 2 (sem nascimento)');
  assert.strictEqual(r.porMes.length, 12);
  assert.deepStrictEqual(r.porMes[11], { ym: '2026-11', n: 2, ok: 1 });
  assert.deepStrictEqual(r.porMes.find((x) => x.ym === '2026-06'), { ym: '2026-06', n: 1, ok: 0 });
});

test('QUAL-CAD-03: nascimento só conta com ano de verdade (idade entre 12 e 105)', () => {
  assert.strictEqual(Q.nascOk('1990-05-10', '2026-11-27'), true);
  assert.strictEqual(Q.nascOk('1900-01-01', '2026-11-27'), false);
  assert.strictEqual(Q.nascOk('2026-01-01', '2026-11-27'), false, 'data do cadastro no lugar do nascimento');
  assert.strictEqual(Q.nascOk(null, '2026-11-27'), false);
});
