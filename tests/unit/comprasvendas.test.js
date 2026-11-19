'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const CV = require('../../public/js/comprasvendas');
const ES = require('../../src/estoque');

test('COMP-01 compras por mês: soma custo × quantidade pelo dia de entrada e conta as notas', () => {
  const m = CV.comprasPorMes({
    100: [['2026-10-05', 10, 501, 3, 'F'], ['2026-11-02', 12.5, 502, 2, 'F']],
    200: [['2026-11-02', 4, 502, 10, 'F'], ['2026-11-20', 4, 503, 1, 'F'], ['data-ruim', 4, 9, 1, 'F'], ['2026-11-21', 0, 9, 1, 'F']],
  });
  assert.deepEqual(m['2026-10'], { valor: 30, notas: 1 });
  assert.deepEqual(m['2026-11'], { valor: 69, notas: 2 });
  assert.deepEqual(CV.comprasPorMes(null), {});
});

test('COMP-02 mês em andamento: teto pela projeção das vendas, pedido somado e quanto ainda cabe', () => {
  const vendas = { '2026-10': { fat: 30000, fatCusto: 24000, custo: 8400, ultimo: '2026-10-31' }, '2026-11': { fat: 10000, fatCusto: 10000, custo: 3300, ultimo: '2026-11-10' } };
  const compras = { '2026-10': { valor: 12000, notas: 3 }, '2026-11': { valor: 6000, notas: 2 } };
  const R = CV.resumo({ vendas, compras, desde: '2026-10-01', hoje: '2026-11-11', tetoPct: 32, pedido: 2000 });
  const m = R.mes;
  assert.equal(m.decorridos, 10);
  assert.equal(m.projecao, 30000); // 10.000 em 10 dias × 30 dias
  assert.equal(Math.round(m.teto), 9600);
  assert.equal(m.soma, 8000);
  assert.equal(Math.round(m.cabe), 1600);
  assert.equal(m.estado, 'ok');
  // pedido maior: perto (acima de 90% do teto) e depois acima
  assert.equal(CV.resumo({ vendas, compras, desde: '2026-10-01', hoje: '2026-11-11', pedido: 3000 }).mes.estado, 'perto');
  const ac = CV.resumo({ vendas, compras, desde: '2026-10-01', hoje: '2026-11-11', pedido: 5000 }).mes;
  assert.equal(ac.estado, 'acima'); assert.equal(Math.round(ac.cabe), -1400);
  // mês fechado: 12.000 ÷ 30.000 = 40% > 32% → acima; CMV com as vendas sem custo pelo mesmo % (35%)
  const out = R.meses.find((x) => x.ym === '2026-10');
  assert.equal(out.acima, true); assert.equal(out.pct, 0.4);
  assert.equal(Math.round(out.cmv), 10500); assert.equal(Math.round(out.saldo), 1500);
  assert.equal(R.total.meses, 1); assert.equal(R.total.acima, 1); assert.equal(R.total.pct, 0.4);
});

test('COMP-03 sem dado não inventa número: sem notas, antes do início das notas, mês sem vendas', () => {
  const vendas = { '2026-08': { fat: 20000, fatCusto: 0, custo: 0, ultimo: '2026-08-31' }, '2026-09': { fat: 20000, fatCusto: 20000, custo: 7000, ultimo: '2026-09-30' } };
  // o painel não tem as notas: compras "—" em todos os meses e nada de teto usado
  const s = CV.resumo({ vendas, compras: null, hoje: '2026-10-01' });
  assert.equal(s.temCompras, false);
  assert.ok(s.meses.every((x) => x.compras == null && x.acima == null));
  // mês em andamento ainda sem venda: sem projeção, sem teto, "sem"
  assert.equal(s.mes.projecao, null); assert.equal(s.mes.teto, null); assert.equal(s.mes.estado, 'sem');
  // notas começam em 15/09: agosto é desconhecido (não é zero) e setembro fica marcado como parcial
  const r = CV.resumo({ vendas, compras: { '2026-09': { valor: 5000, notas: 1 } }, desde: '2026-09-15', hoje: '2026-10-01' });
  const ago = r.meses.find((x) => x.ym === '2026-08'), set = r.meses.find((x) => x.ym === '2026-09');
  assert.equal(ago.compras, null); assert.equal(ago.cmv, null); // sem custo no estoque: CMV desconhecido
  assert.equal(set.compras, 5000); assert.equal(set.comprasParcial, true); assert.equal(set.acima, false);
  // depois do início, mês sem nota é zero de verdade
  const z = CV.resumo({ vendas, compras: {}, desde: '2026-01-01', hoje: '2026-10-01' });
  assert.equal(z.meses.find((x) => x.ym === '2026-09').compras, 0);
  // sem a data de início: vale a primeira compra que existe
  const p = CV.resumo({ vendas, compras: { '2026-09': { valor: 1, notas: 1 } }, hoje: '2026-10-01' });
  assert.equal(p.meses.find((x) => x.ym === '2026-08').compras, null);
  // nada de nada
  assert.deepEqual(CV.resumo({ hoje: '2026-10-01' }).meses, []);
});

test('COMP-04 janela de 12 meses e teto configurável por loja (padrão 32%, entre 1 e 90)', () => {
  const vendas = {};
  for (let k = 0; k < 20; k++) { const ym = new Date(Date.UTC(2025, k, 1)).toISOString().slice(0, 7); vendas[ym] = { fat: 1000, fatCusto: 1000, custo: 300, ultimo: ym + '-28' }; }
  const R = CV.resumo({ vendas, compras: {}, desde: '2020-01-01', hoje: '2026-08-15', tetoPct: 25 });
  assert.equal(R.meses.length, 12); assert.equal(R.meses[0].ym, '2025-09'); assert.equal(R.meses[11].ym, '2026-08');
  assert.equal(R.meses[0].teto, 250);
  assert.equal(ES.cfg({}).comprasTetoPct, 32);
  assert.equal(ES.cfg({ estoqueCfg: { comprasTetoPct: 28.5 } }).comprasTetoPct, 28.5);
  assert.equal(ES.cfg({ estoqueCfg: { comprasTetoPct: 500 } }).comprasTetoPct, 32);
  const base = { entregaDias: 10, coberturaDias: 30, paradoDias: 60 };
  assert.equal(ES.validarCfg(base).ok.comprasTetoPct, 32); // quem salva sem o campo fica com o padrão
  assert.equal(ES.validarCfg({ ...base, comprasTetoPct: '27,5' }).ok.comprasTetoPct, 27.5);
  assert.ok(ES.validarCfg({ ...base, comprasTetoPct: 0 }).erro);
  assert.ok(ES.validarCfg({ ...base, comprasTetoPct: 95 }).erro);
});

test('COMP-05 apresentação: compras fictícias dos meses anteriores sem mexer nas recentes', () => {
  const D = require('../../src/demo-compras');
  const compras = { atualizado: 'x', notas: 1, itens: { 1: [['2026-10-20', 5, 900, 10, 'F']] } };
  const estoque = { itens: [{ cod: '1', desc: 'Caneca', un: 'Un', custo: 5 }, { cod: '2', desc: 'Chá Verde', un: 'Kg', custo: 100 }] };
  const vendas = [
    { data: '2026-08-03', descricao: 'Caneca', qtd: 10, vu: 20 },
    { data: '2026-08-04', descricao: 'Chá Verde 100G', produto: 'Chá Verde', soNumeros: 100, qtd: 20, vu: 30 },
    { data: '2026-10-25', descricao: 'Caneca', qtd: 3, vu: 20 }, // mês que já tem compra: não mexe
    { data: '2026-11-02', descricao: 'Caneca', qtd: 1, vu: 20 },
  ];
  const r = D.comprasDoAno(compras, estoque, { 1: [['2026-01-01', 4], ['2026-09-01', 5]] }, vendas);
  assert.equal(r.itens['1'].length, 2);
  assert.equal(r.itens['1'][0][0], '2026-08-08'); assert.equal(r.itens['1'][0][1], 4); // custo da época
  assert.equal(r.itens['2'][0][3], 1.8); // 2 kg vendidos × 0,92 (agosto)
  assert.deepEqual(compras.itens['1'], [['2026-10-20', 5, 900, 10, 'F']]); // o original não muda
  assert.equal(r.desde, '2025-12-01');
  assert.equal(D.comprasDoAno({ itens: {} }, estoque, {}, vendas).desde, undefined);
});
