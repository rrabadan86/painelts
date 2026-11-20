'use strict';
// Meta de hoje dividida pelas horas da escala (public/js/metadia.js): a conta e as quedas para a divisão igual
const { test } = require('node:test');
const assert = require('node:assert');
const MD = require('../../public/js/metadia.js');

const alvo = (r, nome) => { const p = r.partes.find((x) => x.nome === nome); return p ? Math.round(p.alvo * 100) / 100 : null; };

test('com escala: cada pessoa recebe a parte das horas dela (antes era a participação nas vendas)', () => {
  // meta de hoje R$ 1.200; Ana 8 h, Bia 4 h → 800 e 400 (pela participação 70/30 seria 840 e 360)
  const r = MD.dividir({ meta: 1200, pessoas: ['ANA', 'BIA'], horas: [['ANA', 480], ['BIA', 240]], hoje: '2026-05-12' });
  assert.strictEqual(r.modo, 'escala');
  assert.strictEqual(r.total, 720);
  assert.strictEqual(alvo(r, 'ANA'), 800);
  assert.strictEqual(alvo(r, 'BIA'), 400);
  assert.strictEqual(Math.round(r.partes.reduce((s, p) => s + p.alvo, 0)), 1200); // a soma é a meta do dia
  assert.deepStrictEqual(r.partes.map((p) => p.nome), ['ANA', 'BIA']); // maior alvo primeiro
});

test('com escala: folga e férias ficam sem meta no dia e aparecem em "fora"; dois turnos da mesma pessoa somam', () => {
  const r = MD.dividir({ meta: 900, pessoas: ['ANA', 'BIA', 'CAROL'], horas: [['ANA', 240], ['ANA', 240], ['BIA', 480], ['CAROL', 0]], hoje: '2026-05-12' });
  assert.strictEqual(alvo(r, 'ANA'), 450);
  assert.strictEqual(alvo(r, 'BIA'), 450);
  assert.strictEqual(alvo(r, 'CAROL'), null);
  assert.deepStrictEqual(r.fora, ['CAROL']);
  assert.strictEqual(r.foraPorque, 'folga');
});

test('com escala: quem está na escala entra mesmo sem estar entre as que mais vendem (pessoa nova)', () => {
  const r = MD.dividir({ meta: 600, pessoas: ['ANA'], horas: [['ANA', 300], ['NOVA', 300]], hoje: '2026-05-12' });
  assert.strictEqual(alvo(r, 'NOVA'), 300);
  assert.deepStrictEqual(r.fora, []);
});

test('sem escala lançada: partes iguais entre quem não está de férias hoje, e diz o motivo', () => {
  const ferias = [{ vendedor: 'carol', de: '2026-05-10', ate: '2026-05-20' }, { vendedor: 'BIA', de: '2026-04-01', ate: '2026-04-10' }];
  const r = MD.dividir({ meta: 1000, pessoas: ['ANA', 'BIA', 'CAROL'], horas: null, ferias, hoje: '2026-05-12' });
  assert.strictEqual(r.modo, 'igual');
  assert.strictEqual(r.motivo, 'nao-lancada');
  assert.strictEqual(alvo(r, 'ANA'), 500);
  assert.strictEqual(alvo(r, 'BIA'), 500); // as férias dela já acabaram
  assert.deepStrictEqual(r.fora, ['CAROL']);
  assert.strictEqual(r.foraPorque, 'ferias');
  assert.match(MD.comoDividiu(r), /Sem escala lançada/);
});

test('escala sem ninguém ligado às vendas (ou loja sem turno hoje): cai para a divisão igual, com outro motivo', () => {
  const r = MD.dividir({ meta: 1000, pessoas: ['ANA', 'BIA'], horas: [], hoje: '2026-05-12' });
  assert.strictEqual(r.modo, 'igual');
  assert.strictEqual(r.motivo, 'ninguem-na-escala');
  assert.strictEqual(alvo(r, 'ANA'), 500);
  assert.match(MD.comoDividiu(r), /Ninguém da escala/);
});

test('vendedora (não recebe a escala): partes iguais, sem falar da escala dos colegas', () => {
  const r = MD.dividir({ meta: 900, pessoas: ['EU', 'COLEGA 1', 'COLEGA 2'], horas: null, semEscala: 'sem-acesso', hoje: '2026-05-12' });
  assert.strictEqual(r.motivo, 'sem-acesso');
  assert.strictEqual(alvo(r, 'EU'), 300);
  assert.doesNotMatch(MD.comoDividiu(r), /escala/i);
});

test('bordas: sem ninguém, meta zero e todos de férias não geram NaN', () => {
  assert.deepStrictEqual(MD.dividir({ meta: 500, pessoas: [], horas: null, hoje: '2026-05-12' }).partes, []);
  const z = MD.dividir({ meta: 0, pessoas: ['ANA'], horas: [['ANA', 480]], hoje: '2026-05-12' });
  assert.strictEqual(alvo(z, 'ANA'), 0);
  // todos de férias (cadastro errado): a meta não fica sem divisor
  const f = MD.dividir({ meta: 400, pessoas: ['ANA', 'BIA'], horas: null, ferias: [{ vendedor: 'ANA', de: '2026-05-01', ate: '2026-05-31' }, { vendedor: 'BIA', de: '2026-05-01', ate: '2026-05-31' }], hoje: '2026-05-12' });
  assert.strictEqual(alvo(f, 'ANA'), 200);
  assert.deepStrictEqual(f.fora, []);
});
