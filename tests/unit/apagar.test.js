'use strict';
// Caixa a pagar (Resultado → A pagar): calendário de vencimentos, vencimento estimado das notas, entrada prevista,
// saldo por semana, marcar como pago e os campos novos da configuração.
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apagar-'));
process.env.DATA_DIR = tmp;
const AP = require('../../public/js/apagar');
const APG = require('../../src/apagar');
const ES = require('../../src/estoque');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const HOJE = '2026-11-20'; // sexta-feira
const fixos = [{ nome: 'Aluguel', valor: 8000, dia: 10 }, { nome: 'Energia', valor: 600 }];
const pontuaisDoMes = (ym) => (ym === '2026-12' ? [{ nome: '13º salário', valor: 5000, dia: 18 }] : []);
const notas = [
  { id: 7, nf: 501, fornecedor: 'TSB FRANQUIAS', entrada: '2026-11-01', total: 3000, motivo: 'Compra', status: 'Concluída' },
  { id: 8, nf: 502, fornecedor: 'TSB FRANQUIAS', entrada: '2026-11-03', total: 900, motivo: 'Devolução', status: 'Concluída' }, // não é compra
  { id: 9, nf: 503, fornecedor: 'TSB FRANQUIAS', entrada: '2026-11-04', total: 700, motivo: 'Compra', status: 'Em aberto' }, // não concluída
  { id: 6, nf: 400, fornecedor: 'TSB FRANQUIAS', entrada: '2026-09-01', total: 1200, motivo: 'Compra', status: 'Concluída' }, // venceu há mais de 15 dias
];
const competencias = [
  { origem: 'royalties', nome: 'Royalties + marketing de out/26', ym: '2026-10', valor: 2500, estimado: false, dia: 10 },
  { origem: 'royalties', nome: 'Royalties + marketing de nov/26', ym: '2026-11', valor: 2600, estimado: true, dia: 10 },
  { origem: 'simples', nome: 'Simples Nacional de nov/26', ym: '2026-11', valor: 1800, estimado: true, dia: 20 }, // 20/12: fora dos 30 dias
];
const lista = (o = {}) => AP.vencimentos({ hoje: HOJE, dias: 30, fixos, pontuaisDoMes, notas, prazoNotas: 28, competencias, ...o });

test('CXP-01 calendário: custo fixo no dia cadastrado (sem dia = fim do mês), despesa do mês, royalties no mês seguinte, em ordem de data', () => {
  const l = lista();
  assert.deepEqual(l.map((x) => [x.vence, x.nome, x.valor]), [
    ['2026-11-10', 'Aluguel', 8000],
    ['2026-11-10', 'Royalties + marketing de out/26', 2500],
    ['2026-11-29', 'NF 501 · TSB FRANQUIAS', 3000],
    ['2026-11-30', 'Energia', 600],
    ['2026-12-10', 'Aluguel', 8000],
    ['2026-12-10', 'Royalties + marketing de nov/26', 2600],
    ['2026-12-18', '13º salário', 5000],
  ]);
  const energia = l.find((x) => x.nome === 'Energia');
  assert.equal(energia.semDia, true, 'sem dia cadastrado: último dia do mês');
  assert.equal(l[0].atrasado, true, 'venceu antes de hoje');
  assert.equal(l[4].atrasado, false);
  assert.equal(l.find((x) => x.origem === 'royalties' && x.ym === '2026-11').estimado, true);
  // 60 dias: entram o Simples (20/12), a energia de dezembro e o aluguel de janeiro
  const l60 = lista({ dias: 60 });
  assert.ok(l60.some((x) => x.origem === 'simples' && x.vence === '2026-12-20'));
  assert.ok(l60.some((x) => x.nome === 'Energia' && x.vence === '2026-12-31'));
  assert.ok(l60.some((x) => x.nome === 'Aluguel' && x.vence === '2027-01-10'));
});

test('CXP-01 bordas: dia que o mês não tem vai para o último dia; valor zero e lista vazia não quebram; nomes repetidos ganham id próprio', () => {
  assert.equal(AP.dataNoMes('2027-02', 31), '2027-02-28');
  assert.equal(AP.dataNoMes('2028-02', 30), '2028-02-29');
  assert.equal(AP.dataNoMes('2026-11', null), '2026-11-30');
  assert.deepEqual(AP.vencimentos({ hoje: HOJE }), []);
  assert.deepEqual(AP.vencimentos({ hoje: HOJE, fixos: [{ nome: 'Zerado', valor: 0, dia: 25 }] }), []);
  const dup = AP.vencimentos({ hoje: HOJE, dias: 10, atras: 0, fixos: [{ nome: 'Internet', valor: 100, dia: 25 }, { nome: 'Internet', valor: 150, dia: 25 }] });
  assert.equal(dup.length, 2);
  assert.notEqual(dup[0].id, dup[1].id);
});

test('CXP-02 nota de compra: vencimento ESTIMADO = entrada + prazo; só compra concluída; prazo zero vence na entrada', () => {
  const n = lista().filter((x) => x.origem === 'nota');
  assert.equal(n.length, 1, 'devolução, nota em aberto e nota antiga ficam de fora');
  assert.equal(n[0].vence, '2026-11-29'); // 01/11 + 28 dias
  assert.equal(n[0].estimado, true);
  assert.equal(n[0].entrada, '2026-11-01');
  assert.equal(n[0].prazo, 28);
  // com 45 dias de prazo a nota de setembro (01/09 + 45 = 16/10) continua fora; a de 01/11 vai para 16/12
  assert.deepEqual(lista({ prazoNotas: 45 }).filter((x) => x.origem === 'nota').map((x) => x.vence), ['2026-12-16']);
  const hoje0 = AP.vencimentos({ hoje: '2026-11-01', dias: 5, atras: 0, notas, prazoNotas: 0 });
  assert.deepEqual(hoje0.map((x) => x.vence), ['2026-11-01']);
});

test('CXP-03 entrada prevista: dinheiro e Pix entram no dia; o cartão cai N dias depois, já sem a taxa da maquininha', () => {
  const vendaDia = (iso) => (iso < HOJE ? 500 : 1000); // 500 por dia até ontem (real), 1.000 de hoje em diante (previsto)
  const e = AP.entradas({ hoje: HOJE, dias: 3, vendaDia, parteCartao: 0.6, diasCartao: 2, taxaMaq: 0.02 });
  const r = (iso) => { const x = e.get(iso); return [Math.round(x.vista * 100) / 100, Math.round(x.cartao * 100) / 100]; };
  assert.deepEqual(r('2026-11-20'), [392, 294]); // à vista de hoje + cartão vendido no dia 18
  assert.deepEqual(r('2026-11-21'), [392, 294]); // cartão do dia 19
  assert.deepEqual(r('2026-11-22'), [392, 588]); // cartão de hoje
  assert.equal(e.size, 3, 'o cartão vendido nos dias 21 e 22 cai depois do período');
  // sem prazo e sem taxa: tudo entra no dia; sem a parte em cartão informada, tudo é tratado como cartão
  const tudo = AP.entradas({ hoje: HOJE, dias: 2, vendaDia: () => 100, parteCartao: 0.5, diasCartao: 0 });
  assert.equal(tudo.get(HOJE).total, 100);
  const cons = AP.entradas({ hoje: HOJE, dias: 2, vendaDia: (iso) => (iso < HOJE ? 0 : 100), parteCartao: null, diasCartao: 1 });
  assert.equal(cons.has(HOJE), false, 'hoje não entra nada: tudo cai amanhã');
  assert.deepEqual(cons.get('2026-11-21'), { vista: 0, cartao: 100, total: 100 });
  // loja sem vendas: nada entra
  assert.equal(AP.entradas({ hoje: HOJE, dias: 30, vendaDia: () => 0 }).size, 0);
});

test('CXP-04 saldo por semana (segunda a domingo) e aviso "na semana de dd/mm faltam R$ X"', () => {
  const ent = AP.entradas({ hoje: HOJE, dias: 30, vendaDia: (iso) => (iso < HOJE ? 0 : 300), parteCartao: 0, diasCartao: 0 });
  const s = AP.semanas({ hoje: HOJE, dias: 30, itens: lista(), entradas: ent });
  assert.deepEqual(s.map((x) => [x.de, x.ate]), [['2026-11-20', '2026-11-22'], ['2026-11-23', '2026-11-29'], ['2026-11-30', '2026-12-06'], ['2026-12-07', '2026-12-13'], ['2026-12-14', '2026-12-19']]);
  assert.deepEqual(s.map((x) => x.entra), [900, 2100, 2100, 2100, 1800]);
  assert.deepEqual(s.map((x) => x.sai), [0, 3000, 600, 10600, 5000], 'o que venceu antes de hoje não entra no saldo');
  assert.deepEqual(s.map((x) => x.saldo), [900, -900, 1500, -8500, -3200]);
  assert.deepEqual(s.map((x) => x.acumulado), [900, 0, 1500, -7000, -10200]);
  assert.deepEqual(AP.alerta(s), { de: '2026-12-07', ate: '2026-12-13', falta: 7000 });
  // com R$ 7.000 em conta hoje a semana de 07/12 fecha no zero e o aviso passa para a de 14/12
  const s2 = AP.semanas({ hoje: HOJE, dias: 30, itens: lista(), entradas: ent, saldoInicial: 7000 });
  assert.equal(s2[3].acumulado, 0);
  assert.deepEqual(AP.alerta(s2), { de: '2026-12-14', ate: '2026-12-19', falta: 3200 });
  // sem previsão de entrada: mostra só o que sai, sem saldo nem aviso
  const s3 = AP.semanas({ hoje: HOJE, dias: 30, itens: lista(), entradas: null });
  assert.equal(s3[3].sai, 10600);
  assert.equal(s3[3].saldo, null);
  assert.equal(AP.alerta(s3), null);
  // sobra dinheiro em todas as semanas: sem aviso
  const farto = AP.entradas({ hoje: HOJE, dias: 30, vendaDia: () => 5000, parteCartao: 0, diasCartao: 0 });
  assert.equal(AP.alerta(AP.semanas({ hoje: HOJE, dias: 30, itens: lista(), entradas: farto })), null);
});

test('CXP-05 conta marcada como paga sai do saldo e das somas; vencida sem baixa aparece à parte', () => {
  const pagos = { 'fixo|aluguel|2026-12': { em: '2026-12-01T12:00:00.000Z', por: 'dono' } };
  const l = lista({ pagos });
  const al = l.find((x) => x.id === 'fixo|aluguel|2026-12');
  assert.equal(al.pago, true);
  assert.equal(al.pagoPor, 'dono');
  const ent = AP.entradas({ hoje: HOJE, dias: 30, vendaDia: (iso) => (iso < HOJE ? 0 : 300), parteCartao: 0, diasCartao: 0 });
  const s = AP.semanas({ hoje: HOJE, dias: 30, itens: l, entradas: ent });
  assert.equal(s[3].sai, 2600, 'na semana de 07/12 sobra só o royalties');
  const t = AP.totais(l);
  assert.deepEqual([t.nAPagar, t.aPagar], [4, 11200]); // nota 3.000 + energia 600 + royalties 2.600 + 13º 5.000
  assert.deepEqual([t.nVencidos, t.vencidos], [2, 10500]); // aluguel e royalties de 10/11, sem baixa
  assert.deepEqual([t.nPagos, t.pagos], [1, 8000]);
  assert.equal(t.estimado, 5600); // nota (data estimada) + royalties do mês em andamento
});

test('CXP-05 servidor: marcar e desfazer gravam por loja; id e valores inválidos são recusados', () => {
  const b = { id: 'fixo|aluguel|2026-12', pago: true, nome: 'Aluguel', valor: 8000, vence: '2026-12-10' };
  const r = APG.marcar('l1', b, 'dono', HOJE);
  assert.equal(r.ok.pagos[b.id].por, 'dono');
  assert.equal(APG.ler('l1').pagos[b.id].valor, 8000);
  assert.deepEqual(APG.ler('l2').pagos, {}, 'a marca é da loja');
  assert.ok(APG.marcar('l1', { ...b, id: '../../etc/passwd' }, 'dono', HOJE).erro);
  assert.ok(APG.marcar('l1', { ...b, id: 'outra|coisa' }, 'dono', HOJE).erro);
  assert.ok(APG.marcar('l1', { ...b, valor: -1 }, 'dono', HOJE).erro);
  assert.ok(APG.marcar('l1', { ...b, vence: 'amanhã' }, 'dono', HOJE).erro);
  // marca de conta vencida há mais de 400 dias sai sozinha na gravação seguinte
  APG.marcar('l1', { id: 'nota|77', pago: true, nome: 'NF 77', valor: 10, vence: '2025-01-05' }, 'dono', '2025-01-10');
  assert.ok(APG.ler('l1').pagos['nota|77']);
  const d = APG.marcar('l1', { id: b.id, pago: false }, 'dono', HOJE);
  assert.deepEqual(d.ok.pagos, {});
});

test('CXP-03 parte das vendas em cartão: crédito + débito ÷ total dos fechamentos de caixa do período', () => {
  const f = (dia, rec, fechamento = dia + 'T22:00:00') => ({ dia, fechamento, recebimentos: rec });
  const fech = [
    f('2026-11-18', [{ forma: 'Cartão de Crédito', venda: 500 }, { forma: 'Cartão de Débito', venda: 200 }, { forma: 'Dinheiro', venda: 100 }, { forma: 'PIX', venda: 200 }]),
    f('2026-11-19', [{ forma: 'Cartão de crédito', venda: 300 }, { forma: 'Pix', venda: 700 }]),
    f('2026-08-01', [{ forma: 'Dinheiro', venda: 9999 }]), // fora dos 60 dias
    f('2026-11-20', [{ forma: 'Dinheiro', venda: 9999 }], null), // caixa ainda aberto
  ];
  assert.deepEqual(APG.parteCartao(fech, HOJE), { pct: 0.5, dias: 2, total: 2000 });
  assert.equal(APG.parteCartao([], HOJE), null);
  assert.equal(APG.parteCartao(null, HOJE), null);
});

test('CXP-06 configuração: prazo das notas, dias do cartão, dia dos royalties e dia de vencimento de cada custo', () => {
  const base = { entregaDias: 10, coberturaDias: 30, paradoDias: 60, segurancaPct: 50 };
  const p = ES.validarCfg(base).ok;
  assert.deepEqual([p.prazoNotasDias, p.cartaoDias, p.royaltiesDia], [30, 1, 10], 'quem salva sem os campos fica com o padrão');
  const v = ES.validarCfg({ ...base, prazoNotasDias: '28', cartaoDias: 30, royaltiesDia: '15',
    outros: [{ nome: 'Aluguel', tipo: 'mes', valor: 8000, aplica: 'tudo', dia: '10' }, { nome: 'Energia', tipo: 'mes', valor: 600, aplica: 'tudo', dia: '' }, { nome: 'Fundo', tipo: 'pct', valor: 1, aplica: 'loja', dia: 5 }, { nome: 'Dia ruim', tipo: 'mes', valor: 10, aplica: 'tudo', dia: 40 }],
    pontuais: [{ nome: 'IPTU', valor: 2400, ym: '2027-02', dia: 15 }, { nome: '13º', valor: 5000, ym: '2026-12' }] }).ok;
  assert.deepEqual([v.prazoNotasDias, v.cartaoDias, v.royaltiesDia], [28, 30, 15]);
  assert.equal(v.outros[0].dia, 10);
  assert.ok(!('dia' in v.outros[1]), 'vazio = sem dia (fim do mês)');
  assert.ok(!('dia' in v.outros[2]), 'custo em % das vendas não tem vencimento');
  assert.ok(!('dia' in v.outros[3]), 'dia fora de 1 a 31 é ignorado');
  assert.equal(v.pontuais[0].dia, 15);
  assert.ok(!('dia' in v.pontuais[1]));
  assert.ok(ES.validarCfg({ ...base, prazoNotasDias: 400 }).erro);
  assert.ok(ES.validarCfg({ ...base, cartaoDias: -1 }).erro);
  assert.ok(ES.validarCfg({ ...base, royaltiesDia: 0 }).erro);
  // leitura: loja que nunca salvou usa o padrão e avisa que o prazo ainda não foi informado
  const c0 = ES.cfg({});
  assert.deepEqual([c0.prazoNotasDias, c0.prazoNotasInformado, c0.cartaoDias, c0.royaltiesDia], [30, false, 1, 10]);
  const c1 = ES.cfg({ estoqueCfg: v });
  assert.deepEqual([c1.prazoNotasDias, c1.prazoNotasInformado, c1.cartaoDias, c1.royaltiesDia, c1.outros[0].dia], [28, true, 30, 15, 10]);
});
