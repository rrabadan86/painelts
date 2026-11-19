'use strict';
/* Correções de conta: comissão sem meta, regras da vendedora, ajuste de lote, lista de espera, planilha
   parcial do estoque, dia do preço de tabela, campanha recorrente, pedido obrigatório, devolução e retenção. */
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bugs-'));
process.env.DATA_DIR = tmp;
const C = require('../../src/config');
C.pastaLoja = (id) => path.join(tmp, 'lojas', id);

const RV = require('../../src/regrasvend');

test('comissão: sem meta cadastrada (0) vale a taxa mínima, nunca "acima de 120%"', () => {
  const R = RV.regrasNavegador();
  const f = { acima120: 0.05, bate: 0.04, abaixo: 0.02 };
  for (const meta of [0, null, undefined, NaN, -5]) {
    assert.strictEqual(R.comissaoFaixa(1000, meta, 'faixas', f), 20);
    assert.strictEqual(R.comissaoFaixa(1000, meta, 'simples', f), 20);
  }
  // com meta continua igual
  assert.strictEqual(R.comissaoFaixa(1200, 1000, 'faixas', f), 60);
  assert.strictEqual(R.comissaoFaixa(1000, 1000, 'faixas', f), 40);
  assert.strictEqual(R.comissaoFaixa(999, 1000, 'faixas', f), 999 * 0.02);
  assert.strictEqual(R.comissaoFaixa(1000, 1000, 'simples', f), 40);
});

test('bônus sobre os outros vendedores: sem meta da loja fica na menor faixa', () => {
  const R = RV.regrasNavegador();
  const b = { abaixo: 0.005, bate: 0.01, acima120: 0.015 };
  assert.strictEqual(R.aliquotaBonus(50000, 0, b), 0.005);
  assert.strictEqual(R.aliquotaBonus(50000, null, b), 0.005);
  assert.strictEqual(R.aliquotaBonus(120000, 100000, b), 0.015);
  assert.strictEqual(R.aliquotaBonus(100000, 100000, b), 0.01);
  assert.strictEqual(R.aliquotaBonus(90000, 100000, b), 0.005);
});

test('vendedora: listas do modelo da loja chegam traduzidas mesmo sem regras gravadas', () => {
  const R = RV.regrasNavegador();
  const apelido = (n) => ({ 'ADRIANE PUCCINI': 'COLEGA 1', 'AMANDA OLIVEIRA': 'COLEGA 2', CORPORATIVO: 'COLEGA 3', FULANA: 'COLEGA 4' }[String(n).trim().toUpperCase()] || n);
  // loja Vila sem regras: o modelo tem rateio que exclui uma pessoa e três nomes sem meta
  const vila = { nomesVenda: ['SÃO PAULO - TEA SHOP VILA MADALENA'], regras: null };
  assert.strictEqual(RV.modeloDe(vila), 'vila');
  const rv = RV.regrasAnonimas(vila, apelido);
  assert.deepStrictEqual(rv.semMeta, ['COLEGA 2', 'COLEGA 3', 'COLEGA 1']);
  assert.deepStrictEqual(rv.rateio.exclui, ['COLEGA 1']);
  assert.deepStrictEqual(rv.semComissao, []);
  // no navegador, fundir(modelo, regras recebidas) mantém o rateio ligado e usa os apelidos
  const ef = R.fundir(R.MODELOS.vila.regras, rv);
  assert.strictEqual(ef.rateio.ativo, true);
  assert.deepStrictEqual(ef.rateio.exclui, ['COLEGA 1']);
  assert.deepStrictEqual(ef.semMeta, ['COLEGA 2', 'COLEGA 3', 'COLEGA 1']);
  assert.strictEqual(ef.comissao.modo, 'simples');
  // regras gravadas só com parte das listas: o que falta vem do modelo; o que foi gravado substitui
  const parc = RV.regrasAnonimas({ nomesVenda: ['OUTRA LOJA'], regras: { modelo: 'padrao', semComissao: ['Fulana'], bonus: { bate: 0.02 } } }, apelido);
  assert.deepStrictEqual(parc.semComissao, ['COLEGA 4']);
  assert.deepStrictEqual(parc.semMeta, ['COLEGA 2', 'COLEGA 3', 'COLEGA 1']);
  assert.deepStrictEqual(parc.rateio.exclui, []);
  assert.deepStrictEqual(parc.bonus, { bate: 0.02 });
  assert.deepStrictEqual(RV.regrasAnonimas({ regras: { semMeta: [] } }, apelido).semMeta, []);
  // os nomes do modelo entram na lista de quem ganha apelido
  assert.ok(Object.values(RV.listasEfetivas(vila)).flat().includes('adriane puccini'));
});

test('validade: dois ajustes manuais no mesmo estoque — vale o último', () => {
  const L = require('../../src/lotes');
  const em = '2026-11-19T09:00:00.000Z';
  const a1 = { em, fix: { A: 0.2 }, tipo: 'manual', feitoEm: '2026-11-19T12:00:00.000Z' };
  const a2 = { em, fix: { A: 0.2, B: 0.3 }, tipo: 'manual', feitoEm: '2026-11-19T12:05:00.000Z' };
  assert.strictEqual(L.escolherAjuste([a1, a2], em), a2);
  assert.strictEqual(L.escolherAjuste([a2, a1], em), a2);
  // sem feitoEm (ajustes antigos): o último da lista
  const s1 = { em, fix: { A: 1 } }, s2 = { em, fix: { A: 2 } };
  assert.strictEqual(L.escolherAjuste([s1, s2], em), s2);
  // "em" mais novo continua ganhando; ajuste de estoque posterior não vale
  const novo = { em: '2026-11-20T09:00:00.000Z', fix: {}, feitoEm: '2026-11-20T09:01:00.000Z' };
  assert.strictEqual(L.escolherAjuste([a1, a2, novo], '2026-11-21T00:00:00Z'), novo);
  assert.strictEqual(L.escolherAjuste([a1, a2, novo], em), a2);

  // de ponta a ponta: três lotes, a pessoa acerta dois deles no mesmo estoque
  const comp = { itens: { 9: [['2026-01-10', 100, 1, 2, 'T'], ['2026-06-10', 100, 2, 2, 'T'], ['2026-11-17', 100, 3, 2, 'T']] } };
  const est = { em, itens: [{ cod: '9', desc: 'VALERIANA', un: 'Kg', qtd: 1.5, custo: 100 }] };
  const A = '1|9|2026-01-10', B = '2|9|2026-06-10', Cc = '3|9|2026-11-17';
  const calc = () => L.calcular({ estoque: est, compras: comp, tabela: null, edits: L.ler('aj2'), hoje: '2026-11-19' });
  const dist = () => Object.fromEntries(calc().lotes.map((l) => [l.chave, l.saldo]));
  assert.deepStrictEqual(dist(), { [Cc]: 1.5 });
  const ctx = () => ({ estoque: est, compras: comp, lotes: [...calc().lotes, ...[A, B].filter((k) => !calc().lotes.some((l) => l.chave === k)).map((k) => ({ chave: k, cod: '9', saldo: 0, qtdEntrada: 2 }))] });
  assert.ok(L.editarSaldo('aj2', { chave: A, saldo: 0.2 }, 'v', ctx()).ok);
  assert.deepStrictEqual(dist(), { [Cc]: 1.3, [A]: 0.2 });
  assert.ok(L.editarSaldo('aj2', { chave: B, saldo: 0.3 }, 'v', ctx()).ok);
  assert.deepStrictEqual(dist(), { [Cc]: 1, [B]: 0.3, [A]: 0.2 }); // antes o 2º ajuste era ignorado
  // o 2º ajuste tira a diferença do lote que não foi acertado à mão (C), não do A
  assert.deepStrictEqual(L.ler('aj2').ajustes['9'].map((a) => a.lotes), [[A], [A, B]]);
});

test('lista de espera: nota em digitação ou de devolução/troca não marca "chegou"', () => {
  const E = require('../../src/espera');
  const estoque = { em: new Date(Date.now() - 864e5).toISOString(), itens: [{ cod: '31020', desc: 'VALERIANA GARDEN', un: 'Kg', qtd: 0, custo: 100 }] };
  const a = E.criar('esp', { cliente: { nome: 'Cris', celular: '62977776666', cpf: '11122233344' }, itens: [{ desc: 'valeriana', generico: true }] }, 'gabi', estoque);
  assert.ok(a.ok, JSON.stringify(a));
  const hoje = C.diaSP();
  const nota = (extra) => ({ notas: [{ nf: 99, entrada: hoje, itens: [{ cod: '31020', nome: 'Valeriana Garden', un: 'Kg', qtd: 2 }], ...extra }] });
  const st = () => E.ler('esp').pedidos.find((p) => p.id === a.ok.id).st;
  const ctx = (n) => ({ notas: n, estoque, xml: [], fixe: [], vendas: [] });
  E.avaliar('esp', ctx(nota({ status: 'Em digitação', motivo: 'Compra' })));
  assert.strictEqual(st(), 'esperando');
  E.avaliar('esp', ctx(nota({ status: 'Concluída', motivo: 'Devolução de compra' })));
  assert.strictEqual(st(), 'esperando');
  E.avaliar('esp', ctx(nota({ status: 'Concluída', motivo: 'Troca' })));
  assert.strictEqual(st(), 'esperando');
  E.avaliar('esp', ctx(nota({ status: 'Concluída', motivo: 'Compra' })));
  assert.strictEqual(st(), 'chegou');
});

test('estoque: planilha com menos da metade dos produtos com saldo é recusada (dá para forçar)', () => {
  const ES = require('../../src/estoque');
  const itens = (n, q = 1) => Array.from({ length: n }, (_, i) => ({ cod: String(i), qtd: q }));
  assert.match(ES.travaParcial({ itens: itens(100) }, { itens: itens(49) }), /só 49 produtos.*100 com estoque.*Nada foi gravado/);
  assert.strictEqual(ES.travaParcial({ itens: itens(100) }, { itens: itens(50) }), null);
  assert.strictEqual(ES.travaParcial({ itens: itens(100) }, { itens: itens(120) }), null);
  // quem já estava zerado não conta; loja pequena e primeira importação ficam de fora
  assert.strictEqual(ES.travaParcial({ itens: [...itens(30), ...itens(200, 0)] }, { itens: itens(16) }), null);
  assert.strictEqual(ES.travaParcial({ itens: itens(19) }, { itens: itens(1) }), null);
  assert.strictEqual(ES.travaParcial(null, { itens: itens(1) }), null);
});

test('estoque: importar recusa a planilha parcial sem gravar; com forcar grava', async () => {
  const ES = require('../../src/estoque');
  const ExcelJS = require('exceljs');
  const planilha = async (n) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Estoque');
    ws.addRow(['NextSoft - Estoque Atual ( 18/11/2026, 10:00:00 )']);
    ws.addRow(['Código', 'Descrição', 'Unidade', 'Quantidade', 'Custo Unitário']);
    for (let i = 0; i < n; i++) ws.addRow([String(1000 + i), 'PRODUTO ' + i, 'UN', 5000, 10]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  const primeira = await ES.importar('trv', await planilha(40));
  assert.strictEqual(primeira.itens, 40);
  await assert.rejects(ES.importar('trv', await planilha(10)), (e) => e.parcial === true && /Nada foi gravado/.test(e.message));
  assert.strictEqual(ES.atual('trv').itens.filter((i) => i.qtd > 0).length, 40);
  const r = await ES.importar('trv', await planilha(10), 'painel', { forcar: true });
  assert.strictEqual(r.itens, 10);
  assert.strictEqual(r.zerados, 30);
});

test('preço de tabela: o dia do histórico é o de Brasília (22:40 não vira o dia seguinte)', () => {
  const TAB = require('../../src/tabela');
  assert.strictEqual(TAB.diaBrasilia('2026-11-19T01:40:00.000Z'), '2026-11-18'); // 22:40 de 18/11 em Brasília
  assert.strictEqual(TAB.diaBrasilia('2026-11-18T15:00:00.000Z'), '2026-11-18');
  assert.strictEqual(TAB.diaBrasilia(''), '');
});

test('campanha recorrente: a lista do período não é criada em dobro', () => {
  const CAMP = require('../../src/campanhas');
  const lista = [{ cpf: '11122233344', nome: 'Ana' }];
  const nova = (rec) => CAMP.criar('cmp', { nome: 'Volta ' + rec, mensagem: 'Oi {nome}', recorrente: rec, lista }, 'adm');
  const sem = nova('semanal'); assert.ok(sem.ok, JSON.stringify(sem));
  const t0 = Date.parse(sem.ok.rodadas[0].em);
  // duas abas pedem a rodada na mesma hora: a segunda recebe a que existe
  const rep = CAMP.novaRodada('cmp', sem.ok.id, lista, 'adm', t0 + 6 * 864e5);
  assert.strictEqual(rep.repetida, true);
  assert.strictEqual(rep.ok.rodadas.length, 1);
  const ok = CAMP.novaRodada('cmp', sem.ok.id, lista, 'adm', t0 + 7 * 864e5);
  assert.ok(!ok.repetida);
  assert.strictEqual(ok.ok.rodadas.length, 2);
  assert.strictEqual(CAMP.novaRodada('cmp', sem.ok.id, lista, 'adm', t0 + 7 * 864e5 + 1000).repetida, true);
  assert.strictEqual(CAMP.ler('cmp').find((c) => c.id === sem.ok.id).rodadas.length, 2);
  // mensal: uma por mês (mês de Brasília)
  const c = { recorrente: 'mensal', rodadas: [{ em: '2026-11-10T15:00:00.000Z' }] };
  assert.strictEqual(CAMP.rodadaEmDia(c, Date.parse('2026-11-30T23:00:00-03:00')), true);
  assert.strictEqual(CAMP.rodadaEmDia(c, Date.parse('2026-12-01T00:30:00-03:00')), false);
  // sem repetição ou sem rodada: nunca "em dia"
  assert.strictEqual(CAMP.rodadaEmDia({ recorrente: '', rodadas: [{ em: new Date().toISOString() }] }), false);
  assert.strictEqual(CAMP.rodadaEmDia({ recorrente: 'semanal', rodadas: [] }), false);
});

test('pedido obrigatório: encerrar, reabrir ou apagar sem id devolve erro (não derruba)', () => {
  const PED = require('../../src/pedido');
  for (const b of [{ encerrar: true }, { reabrir: true }, { apagar: true }]) assert.match(PED.alterarObrig('ped', b, 'adm').erro, /id/);
  assert.match(PED.alterarObrig('ped', { id: 'nao-existe', encerrar: true }, 'adm').erro, /não encontrado/);
  const r = PED.alterarObrig('ped', { nome: 'Natal', itens: [{ cod: '406', nome: 'Top Tea', qtd: 2, preco: 10 }] }, 'adm');
  assert.ok(r.item && r.item.id);
  assert.strictEqual(PED.alterarObrig('ped', { id: r.item.id, encerrar: true }, 'adm').item.encerrado, true);
});

test('devolução: o que está em outra devolução da nota (pendente, na fila) também conta', () => {
  const DEV = require('../../src/devolucao');
  const nota = { id: 'nt-9', nf: 500, serie: 1, emissao: '2026-10-15', entrada: '2026-10-20', fornecedor: 'TSB', total: 100, itens: [{ cod: '406', nome: 'Top Tea', un: 'UN', qtd: 10, vu: 10 }] };
  const cria = (q) => DEV.criar('dv', nota, { itens: [{ cod: '406', tipo: 'faltou', qtd: q }] }, 'adm');
  const d1 = cria(6).ok;
  assert.strictEqual(d1.nfe.estado, 'pendente');
  assert.match(cria(5).erro, /6 já devolvidos em outra devolução/); // antes passava: 11 de 10
  DEV.atualizar('dv', d1.id, (x) => { x.nfe = { estado: 'na_fila' }; });
  assert.match(cria(5).erro, /passa da quantidade/);
  // NF-e que deu erro ou foi cancelada libera a quantidade
  DEV.atualizar('dv', d1.id, (x) => { x.nfe = { estado: 'erro', erro: 'x' }; });
  const d2 = cria(4);
  assert.ok(d2.ok, JSON.stringify(d2));
  DEV.atualizar('dv', d1.id, (x) => { x.nfe = { estado: 'ok', situacao: 'cancelada' }; });
  assert.match(cria(7).erro, /4 já devolvidos/);
  assert.ok(cria(6).ok);
});

test('retenção em 90 dias: cupom casado por número + dia (numeração que recomeça não confunde)', () => {
  const I = require('../../src/indicadores');
  const v = [], x = [];
  // 30 clientes novos em março, cupons 1..30; a numeração recomeça e os mesmos números voltam em abril com OUTROS clientes
  for (let k = 0; k < 30; k++) {
    v.push({ cupom: k + 1, data: '2026-03-01' }); x.push({ cpf: 'a' + k, cupom: k + 1, data: '2026-03-01' });
    v.push({ cupom: k + 1, data: '2025-01-05' }); x.push({ cpf: 'velho' + k, cupom: k + 1, data: '2025-01-05' });
  }
  for (let k = 0; k < 9; k++) { v.push({ cupom: 100 + k, data: '2026-04-10' }); x.push({ cpf: 'a' + k, cupom: 100 + k, data: '2026-04-10' }); }
  // só pelo número, os 30 de março cairiam em 2025 (ou o contrário) e a conta sairia errada
  assert.strictEqual(I.retencao90(v, x, '2026-11-18'), 9 / 30);
  // XML sem data: vale o número quando ele só aparece num dia
  const v2 = [], x2 = [];
  for (let k = 0; k < 20; k++) { v2.push({ cupom: k + 1, data: '2026-03-01' }); x2.push({ cpf: 'b' + k, cupom: k + 1 }); }
  for (let k = 0; k < 5; k++) { v2.push({ cupom: 50 + k, data: '2026-03-20' }); x2.push({ cpf: 'b' + k, cupom: 50 + k }); }
  assert.strictEqual(I.retencao90(v2, x2, '2026-11-18'), 5 / 20);
});
