'use strict';
// Visão do dono no Início (public/js/visaodono.js): estoque por loja, semana, pontos de atenção e ordem das ações
const { test } = require('node:test');
const assert = require('node:assert');
const V = require('../../public/js/visaodono.js');

const DIA = 86400000;
const dia = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / DIA);

test('parado: tem saldo e custo, não vende há N dias; fora de linha e sem custo ficam de fora', () => {
  const b = { qtd: 3, custo: 10, foraLinha: false, ult: 100, fim: 160, paradoDias: 60, novoPN: false };
  assert.strictEqual(V.ehParado(b), true);                         // 60 dias sem venda
  assert.strictEqual(V.ehParado({ ...b, fim: 159 }), false);       // 59 dias: ainda não
  assert.strictEqual(V.ehParado({ ...b, qtd: 0 }), false);
  assert.strictEqual(V.ehParado({ ...b, custo: 0 }), false);
  assert.strictEqual(V.ehParado({ ...b, foraLinha: true }), false); // fora de linha é "liquidar", conta à parte
  assert.strictEqual(V.ehParado({ ...b, ult: null }), false);       // nunca vendeu e não é produto de revenda
  assert.strictEqual(V.ehParado({ ...b, ult: null, novoPN: true }), true);
});

test('fora de linha: indisponível no Sistema de Pedidos há 90 dias ou mais (ou o prazo da loja)', () => {
  const fl = { dias: 90, indisp: { 10: '2026-01-01', 20: '2026-03-20' } };
  const hoje = dia('2026-04-01');
  assert.strictEqual(V.foraLinhaDe(fl, '10', hoje), '2026-01-01'); // 90 dias
  assert.strictEqual(V.foraLinhaDe(fl, 20, hoje), null);            // 12 dias
  assert.strictEqual(V.foraLinhaDe(fl, '99', hoje), null);
  assert.strictEqual(V.foraLinhaDe(null, '10', hoje), null);
  assert.strictEqual(V.foraLinhaDe({ indisp: { 10: '2026-01-01' } }, '10', dia('2026-03-31')), null); // sem prazo: 90
});

test('estoque da loja: zerado que vende usa a conta do Estoque (ruptura.js); parado e valor a custo', () => {
  const hoje = 1000;
  const itens = [
    { cod: 'A', un: 'UN', qtd: 0, custo: 5 },   // zerado, vendeu em 2 dias nos últimos 60: R$ 120 em 20 dias = R$ 6/dia
    { cod: 'B', un: 'UN', qtd: 0, custo: 5 },   // zerado, vendeu um dia só: sem conta (pouco histórico), mas conta como zerado
    { cod: 'C', un: 'UN', qtd: 0, custo: 5 },   // zerado, nunca vendeu: não é venda perdida
    { cod: 'D', un: 'Kg', qtd: 0.03, custo: 100 }, // chá com menos de 50 g = zerado; fora de linha: fica de fora
    { cod: 'E', un: 'UN', qtd: 4, custo: 25 },  // parado: última venda há 70 dias
    { cod: 'F', un: 'UN', qtd: 2, custo: 10 },  // vendeu há 5 dias: não é parado
    { cod: 'G', un: 'UN', qtd: 10, custo: 0 },  // sem custo: não entra no valor
  ];
  const vendas = new Map([['A', [{ d: 981, q: 2, v: 60 }, { d: 990, q: 2, v: 60 }]], ['B', [{ d: 995, q: 1, v: 30 }]], ['D', [{ d: 990, q: 1, v: 50 }, { d: 991, q: 1, v: 50 }]]]);
  const ultima = new Map([['A', 990], ['B', 995], ['D', 991], ['E', 930], ['F', 995]]);
  const r = V.estoqueLoja({ itens, vendas, ultima, hoje, inicio: 971, paradoDias: 60, foraLinha: (c) => c === 'D', temCod: true });
  assert.strictEqual(r.zerados.n, 2);
  assert.strictEqual(r.zerados.comConta, 1);
  assert.strictEqual(Math.round(r.zerados.perdaDia * 100) / 100, 6);
  assert.deepStrictEqual(r.parado, { n: 1, valor: 100 });
  assert.strictEqual(r.valorEstoque, 4 * 25 + 2 * 10 + 0.03 * 100);
});

test('estoque da loja: sem itens e sem vendas não quebra', () => {
  assert.deepStrictEqual(V.estoqueLoja({ itens: [], hoje: 10, inicio: 1, paradoDias: 60 }), { zerados: { n: 0, comConta: 0, perdaDia: 0 }, parado: { n: 0, valor: 0 }, valorEstoque: 0 });
  const r = V.estoqueLoja({ itens: [{ cod: 1, un: 'UN', qtd: 0, custo: 3 }], vendas: null, ultima: null, hoje: 10, inicio: 1, paradoDias: 60 });
  assert.strictEqual(r.zerados.n, 0);
});

test('semana: de segunda até o último dia completo, contra os mesmos dias da semana anterior', () => {
  // quinta 14/05/2026, com vendas até hoje: semana = seg 11 a qua 13 (3 dias) × seg 4 a qua 6
  let s = V.semana(dia('2026-05-14'), dia('2026-05-14'), dia('2025-01-01'));
  assert.deepStrictEqual([s.de, s.ate, s.n, s.antDe, s.antAte], [dia('2026-05-11'), dia('2026-05-13'), 3, dia('2026-05-04'), dia('2026-05-06')]);
  // segunda de manhã: o último dia completo é o domingo → a semana passada inteira (7 dias) × a anterior
  s = V.semana(dia('2026-05-18'), dia('2026-05-18'), dia('2025-01-01'));
  assert.deepStrictEqual([s.de, s.ate, s.n, s.antDe, s.antAte], [dia('2026-05-11'), dia('2026-05-17'), 7, dia('2026-05-04'), dia('2026-05-10')]);
  // terça: 1 dia (a segunda) contra a segunda anterior
  s = V.semana(dia('2026-05-19'), dia('2026-05-19'), dia('2025-01-01'));
  assert.deepStrictEqual([s.de, s.n, s.antDe, s.antAte], [dia('2026-05-18'), 1, dia('2026-05-11'), dia('2026-05-11')]);
  // vendas atrasadas (painel até sábado 09/05): usa o último dia que tem
  s = V.semana(dia('2026-05-14'), dia('2026-05-09'), dia('2025-01-01'));
  assert.deepStrictEqual([s.de, s.ate, s.n], [dia('2026-05-04'), dia('2026-05-09'), 6]);
  // loja que começou hoje: sem dia completo
  assert.strictEqual(V.semana(dia('2026-05-14'), dia('2026-05-14'), dia('2026-05-14')), null);
});

test('atenção: cada ponto vira um aviso; os graves pesam mais; o que a pessoa não vê não pontua', () => {
  const ok = V.atencao({ pctProj: 1.05, var28: 0.02, vendaDia: 1000, zerados: { n: 0, perdaDia: 0 }, risco: { vencidos: 0, criticos: 0 }, parado: { valor: 100 }, valorEstoque: 10000 });
  assert.deepStrictEqual(ok, { pontos: 0, motivos: [] });
  const ruim = V.atencao({ pctProj: 0.82, var28: -0.25, vendaDia: 1000, zerados: { n: 12, perdaDia: 233 }, risco: { vencidos: 2, criticos: 3 }, parado: { valor: 3000 }, valorEstoque: 10000 });
  assert.strictEqual(ruim.pontos, 3 + 3 + 3 + 3 + 1 + 1);
  assert.strictEqual(ruim.motivos.length, 6);
  assert.match(ruim.motivos[0], /projeção em 82% da meta/);
  assert.match(ruim.motivos[2], /12 produtos zerados que vendem/);
  const leve = V.atencao({ pctProj: 0.95, var28: -0.12, vendaDia: 1000, zerados: { n: 1, perdaDia: 5 }, risco: null, parado: null, valorEstoque: null });
  assert.strictEqual(leve.pontos, 2 + 2 + 2);
  // gerente sem custo / loja sem meta: tudo null
  assert.deepStrictEqual(V.atencao({ pctProj: null, var28: null, zerados: null, risco: null, parado: null }), { pontos: 0, motivos: [] });
});

test('ordem das lojas: mais pontos primeiro; no empate, a que mais caiu', () => {
  const l = (nome, pontos, var28) => ({ nome, var28, at: { pontos, motivos: [] } });
  assert.deepStrictEqual(V.ordenar([l('B', 2, -0.05), l('A', 2, -0.3), l('C', 7, 0.1), l('D', 0, null)]).map((x) => x.nome), ['C', 'A', 'B', 'D']);
});

test('ações da semana: até 3, pela ordem do dinheiro em jogo; a meta só completa a lista', () => {
  const c = { zerados: { n: 12, perdaDia: 233 }, vencidos: { lotes: 2, valor: 180 }, criticos: { lotes: 3, valor: 900 }, franquia: { n: 1, valor: 60 }, parado: { n: 40, valor: 5000 }, meta: { falta: 8000, porDia: 800, dias: 10 } };
  const a = V.acoes(c);
  // zerados 233 × 30 = 6.990 · críticos 900 · vencidos 180 × 3 = 540 · parado 5.000 × 0,1 = 500 · franquia 60
  assert.deepStrictEqual(a.map((x) => x.tipo), ['zerados', 'criticos', 'vencidos']);
  assert.strictEqual(a[0].n, 12);
  assert.strictEqual(a[0].porDia, 233);
  // só a franquia e a meta: a meta entra para completar
  const b = V.acoes({ zerados: { n: 0, perdaDia: 0 }, vencidos: null, criticos: null, franquia: { n: 1, valor: 60 }, parado: { n: 0, valor: 0 }, meta: { falta: 500, porDia: 100, dias: 5 } });
  assert.deepStrictEqual(b.map((x) => x.tipo), ['franquia', 'meta']);
  assert.strictEqual(b[1].porDia, 100);
  // vencido sem custo visível continua aparecendo (peso mínimo)
  assert.deepStrictEqual(V.acoes({ vencidos: { lotes: 1, valor: 0 } }).map((x) => x.tipo), ['vencidos']);
  // nada para fazer
  assert.deepStrictEqual(V.acoes({}), []);
});
