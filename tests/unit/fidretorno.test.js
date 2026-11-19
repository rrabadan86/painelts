'use strict';
// Retorno do programa de fidelidade (public/js/fidretorno.js): comparações e limites
const { test } = require('node:test');
const assert = require('node:assert');
const F = require('../../public/js/fidretorno.js');

const c = (day, vt) => ({ day, vt });

test('janela: conta só as compras entre os dois dias (inclusive)', () => {
  const cs = [c(10, 50), c(20, 70), c(30, 90)];
  assert.deepStrictEqual(F.janela(cs, 10, 20), { n: 2, vt: 120 });
  assert.deepStrictEqual(F.janela(cs, 21, 29), { n: 0, vt: 0 });
  assert.deepStrictEqual(F.janela(null, 0, 99), { n: 0, vt: 0 });
});

test('resumo: frequência, ticket, gasto e quem voltou; grupo pequeno não vira número', () => {
  const r = F.resumo([{ n: 2, vt: 200 }, { n: 0, vt: 0 }, { n: 1, vt: 100 }, { n: 1, vt: 100 }], 3);
  assert.strictEqual(r.clientes, 4);
  assert.strictEqual(r.comprasPorCliente, 1);
  assert.strictEqual(r.ticket, 100);
  assert.strictEqual(r.gastoPorCliente, 100);
  assert.strictEqual(r.voltaram, 0.75);
  const p = F.resumo([{ n: 2, vt: 200 }], 3);
  assert.strictEqual(p.pouco, true);
  assert.deepStrictEqual([p.comprasPorCliente, p.ticket, p.gastoPorCliente, p.voltaram], [null, null, null, null]);
  // ninguém comprou: ticket sem divisão por zero
  assert.strictEqual(F.resumo([{ n: 0, vt: 0 }, { n: 0, vt: 0 }], 2).ticket, null);
  assert.strictEqual(F.resumo([]).pouco, true);
});

test('programa × fora: só quem comprou nos últimos 12 meses', () => {
  const clientes = [
    { membro: true, compras: [c(900, 100), c(950, 300)] },
    { membro: true, compras: [c(100, 999)] },               // comprou há mais de 12 meses: fora da conta
    { membro: false, compras: [c(990, 80)] },
    { membro: false, compras: [c(1000, 120), c(636, 50)] },  // dia 636 = primeiro dia da janela (1000 − 364)
    { membro: false, compras: [c(635, 500)] },               // um dia antes da janela
  ];
  const r = F.programa(clientes, 1000, 365, 1);
  assert.strictEqual(r.dentro.clientes, 1);
  assert.strictEqual(r.dentro.gastoPorCliente, 400);
  assert.strictEqual(r.fora.clientes, 2);
  assert.strictEqual(r.fora.gastoPorCliente, 125);
  assert.strictEqual(F.programa([], 1000).dentro.pouco, true);
});

test('resgatou × não resgatou: 90 dias depois, só com a janela completa e o primeiro ciclo de cada cliente', () => {
  const compras = new Map([
    ['a', [c(105, 100), c(150, 60), c(300, 999)]], // resgatou no dia 110: vale a compra do dia 150 (janela 111 a 200)
    ['b', [c(100, 50), c(101, 40)]],               // não resgatou; chegou ao mínimo no dia 100: vale o dia 101
    ['c', [c(960, 70)]],                           // janela incompleta (fim = 1000)
  ]);
  const ciclos = [{ cpf: 'a', E: 100, res: 'sim', dias: 10 }, { cpf: 'a', E: 400, res: 'nao', dias: null }, { cpf: 'b', E: 100, res: 'nao', dias: null },
    { cpf: 'c', E: 950, res: 'sim', dias: 5 }, { cpf: 'd', E: 990, res: 'aberto', dias: null }];
  const r = F.resgatou(ciclos, (cpf) => compras.get(cpf) || [], 1000, 90, 1);
  assert.strictEqual(r.sim.clientes, 1);
  assert.strictEqual(r.sim.gastoPorCliente, 60);
  assert.strictEqual(r.sim.voltaram, 1);
  assert.strictEqual(r.nao.clientes, 1);
  assert.strictEqual(r.nao.gastoPorCliente, 40);
  assert.strictEqual(r.semJanela, 1);
  // resgate no último dia que ainda cabe (âncora + 90 = fim)
  assert.strictEqual(F.resgatou([{ cpf: 'x', E: 910, res: 'sim', dias: 0 }], () => [c(1000, 30)], 1000, 90, 1).sim.gasto, 30);
});

test('antes × depois do primeiro resgate: o mesmo cliente, sem o dia do resgate, só com as duas janelas completas', () => {
  const compras = new Map([
    ['a', [c(120, 100), c(199, 50), c(200, 300), c(201, 80), c(290, 20), c(291, 999)]], // resgate no dia 200
    ['b', [c(150, 60), c(260, 60)]],
    ['c', [c(40, 10)]],   // resgatou no dia 50: não tem 90 dias antes (os dados começam no dia 0)
    ['d', [c(940, 10)]],  // resgatou no dia 950: não tem 90 dias depois
  ]);
  const prim = new Map([['a', 200], ['b', 200], ['c', 50], ['d', 950]]);
  const r = F.antesDepois(prim, (cpf) => compras.get(cpf) || [], 0, 1000, 90, 1);
  assert.strictEqual(r.clientes, 2);
  assert.strictEqual(r.semJanela, 2);
  assert.strictEqual(r.antes.gasto, 210);   // a: 100 + 50; b: 60
  assert.strictEqual(r.depois.gasto, 160);  // a: 80 + 20; b: 60 (o dia do resgate e o dia 291 ficam fora)
  assert.strictEqual(r.adicional, -50);
  assert.ok(Math.abs(r.variacao - (160 / 210 - 1)) < 1e-9);
  assert.deepStrictEqual([r.de, r.ate], [200, 200]);
  // pouca gente: sem "venda a mais"
  const p = F.antesDepois(prim, (cpf) => compras.get(cpf) || [], 0, 1000, 90);
  assert.strictEqual(p.adicional, null);
  assert.strictEqual(p.variacao, null);
  assert.strictEqual(F.antesDepois(new Map(), () => [], 0, 1000).clientes, 0);
});

test('prêmios × venda a mais: custo médio por resgate × clientes analisados; sem custo não inventa', () => {
  const ad = { clientes: 10, adicional: 900 };
  const r = F.retorno(ad, 400, 20); // R$ 20 por resgate
  assert.strictEqual(r.custoMedio, 20);
  assert.strictEqual(r.custo, 200);
  assert.strictEqual(r.saldo, 700);
  assert.strictEqual(r.porReal, 4.5);
  assert.strictEqual(F.retorno(ad, null, 20).custo, null);
  assert.strictEqual(F.retorno(ad, 400, 0).custo, null);
  assert.strictEqual(F.retorno({ clientes: 3, adicional: null }, 400, 20).saldo, null);
  assert.strictEqual(F.retorno(null, 400, 20).adicional, null);
});
