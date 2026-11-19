'use strict';
// Estoque: venda perdida por falta (zerado que vendia) e excesso (vende, mas o saldo passa muito do necessário)
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../../public/js/ruptura');

const perto = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('venda perdida: média de R$ por dia nos 60 dias antes de zerar × dias zerado', () => {
  // vendeu 2 un. a R$ 30 em 6 dias diferentes; última venda no dia 1000; hoje 1010
  const vendas = [950, 960, 970, 980, 990, 1000].map((d) => ({ d, q: 2, v: 60 }));
  const x = R.perda({ vendas, qtd: 0, un: 'Un', hoje: 1010, inicio: 100 });
  assert.strictEqual(x.desde, 1000);
  assert.strictEqual(x.diasZerado, 10);
  assert.strictEqual(x.diasBase, 60);
  assert.strictEqual(x.diasVenda, 6);
  perto(x.perdaDia, 360 / 60);
  perto(x.qtdDia, 12 / 60);
  perto(x.acumulado, 6 * 10);
  assert.strictEqual(x.motivo, null);
});

test('venda perdida: venda fora da janela de 60 dias não entra na média', () => {
  const vendas = [{ d: 900, q: 50, v: 5000 }, { d: 990, q: 1, v: 30 }, { d: 1000, q: 1, v: 30 }];
  perto(R.perda({ vendas, qtd: 0, un: 'Un', hoje: 1000, inicio: 0 }).perdaDia, 1);
});

test('venda perdida: com saldo, sem venda ou com a última venda antiga demais não aparece', () => {
  const vendas = [{ d: 990, q: 1, v: 30 }, { d: 1000, q: 1, v: 30 }];
  assert.strictEqual(R.perda({ vendas, qtd: 3, un: 'Un', hoje: 1005, inicio: 0 }), null); // tem saldo
  assert.strictEqual(R.perda({ vendas: [], qtd: 0, un: 'Un', hoje: 1005, inicio: 0 }), null); // nunca vendeu
  assert.strictEqual(R.perda({ vendas: null, qtd: 0, un: 'Un', hoje: 1005, inicio: 0 }), null);
  assert.strictEqual(R.perda({ vendas, qtd: 0, un: 'Un', hoje: 1000 + R.MAX_DIAS + 1, inicio: 0 }), null); // 91 dias
  assert.ok(R.perda({ vendas, qtd: 0, un: 'Un', hoje: 1000 + R.MAX_DIAS, inicio: 0 })); // 90 ainda entra
});

test('venda perdida: pouco histórico (1 dia com venda) → sem número, com o motivo', () => {
  const x = R.perda({ vendas: [{ d: 1000, q: 5, v: 500 }], qtd: 0, un: 'Un', hoje: 1003, inicio: 0 });
  assert.strictEqual(x.perdaDia, null);
  assert.strictEqual(x.acumulado, null);
  assert.strictEqual(x.motivo, 'pouco');
  assert.strictEqual(x.diasZerado, 3);
});

test('venda perdida: loja com menos de 60 dias de dados divide só pelos dias que existem', () => {
  const vendas = [{ d: 995, q: 1, v: 40 }, { d: 1000, q: 1, v: 40 }];
  const x = R.perda({ vendas, qtd: 0, un: 'Un', hoje: 1002, inicio: 991 });
  assert.strictEqual(x.diasBase, 10);
  perto(x.perdaDia, 8);
});

test('venda perdida: zerou hoje (última venda hoje) → perde por dia, mas nada acumulado ainda', () => {
  const x = R.perda({ vendas: [{ d: 999, q: 1, v: 30 }, { d: 1000, q: 1, v: 30 }], qtd: 0, un: 'Un', hoje: 1000, inicio: 0 });
  assert.strictEqual(x.diasZerado, 0);
  assert.strictEqual(x.acumulado, 0);
  assert.ok(x.perdaDia > 0);
});

test('venda perdida: devolução (quantidade negativa) não vira "última venda"; chá a granel abaixo de 50 g conta como zerado', () => {
  const vendas = [{ d: 990, q: 0.1, v: 30 }, { d: 1000, q: 0.1, v: 30 }, { d: 1004, q: -0.1, v: -30 }];
  const x = R.perda({ vendas, qtd: 0.03, un: 'Kg', hoje: 1005, inicio: 0 });
  assert.strictEqual(x.desde, 1000);
  assert.strictEqual(R.perda({ vendas, qtd: 0.05, un: 'Kg', hoje: 1005, inicio: 0 }), null); // 50 g ainda dá um pacote
  assert.strictEqual(R.zerado(-2, 'Un'), true);
  assert.strictEqual(R.zerado(null, 'Un'), true);
  assert.strictEqual(R.zerado(1, 'Un'), false);
});

test('excesso: só quando dura mais que 2× (entrega + pedido); sobra = saldo − o necessário, a custo', () => {
  // vende 1 por dia, H = 40 dias: até 80 un. não é excesso
  assert.strictEqual(R.excesso({ qtd: 80, prev: 1, H: 40, custo: 10, un: 'Un' }), null);
  const x = R.excesso({ qtd: 100, prev: 1, H: 40, custo: 10, un: 'Un' });
  assert.strictEqual(x.dias, 100);
  assert.strictEqual(x.alvo, 40);
  assert.strictEqual(x.sobraQtd, 60);
  assert.strictEqual(x.sobraValor, 600);
});

test('excesso: produto que não vende (parado), sem saldo ou sem prazo não entra; sem custo mostra só a quantidade', () => {
  assert.strictEqual(R.excesso({ qtd: 100, prev: 0, H: 40, custo: 10, un: 'Un' }), null);
  assert.strictEqual(R.excesso({ qtd: 0, prev: 1, H: 40, custo: 10, un: 'Un' }), null);
  assert.strictEqual(R.excesso({ qtd: 100, prev: 1, H: 0, custo: 10, un: 'Un' }), null);
  assert.strictEqual(R.excesso({ qtd: 100, prev: 1, H: 40, custo: null, un: 'Un' }).sobraValor, null);
});

test('excesso: respeita o mínimo do AppNext e arredonda (unidade inteira, kg com 3 casas)', () => {
  assert.strictEqual(R.excesso({ qtd: 100, prev: 1, H: 40, min: 70, custo: 2, un: 'Un' }).sobraQtd, 30);
  assert.strictEqual(R.excesso({ qtd: 100, prev: 1, H: 40, min: 100, custo: 2, un: 'Un' }), null); // o mínimo pede tudo
  assert.strictEqual(R.excesso({ qtd: 10, prev: 0.03, H: 40, custo: 2, un: 'Un' }).sobraQtd, 8); // 10 − 1,2 = 8,8 → 8
  const kg = R.excesso({ qtd: 5, prev: 0.01, H: 40, custo: 100, un: 'Kg' });
  assert.strictEqual(kg.sobraQtd, 4.6);
  perto(kg.sobraValor, 460);
});

test('totais dos quadros: soma só o que tem conta e conta os produtos', () => {
  const T = R.totais([
    { rup: { perdaDia: 10, acumulado: 50 }, esperando: 2 }, { rup: { perdaDia: null, acumulado: null } }, { rup: null, exc: { sobraValor: 200 } },
    { exc: { sobraValor: null } }, {},
  ]);
  assert.deepStrictEqual(T.falta, { n: 2, comConta: 1, perdaDia: 10, acumulado: 50, esperando: 1 });
  assert.deepStrictEqual(T.sobra, { n: 2, valor: 200, semCusto: 1 });
});
