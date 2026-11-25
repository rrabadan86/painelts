'use strict';
/* CMV pelo estoque (decisão do dono, 25/11/2026; CMV-EST-01): foto do estoque a custo na virada do mês e a conta
   estoque inicial + compras − devoluções − estoque final (src/cmvestoque.js). */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmvest-'));
let CE;
before(() => { process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = path.join(tmp, 'lojas.json'); CE = require('../../src/cmvestoque'); });
after(() => fs.rmSync(tmp, { recursive: true, force: true })); // dados temporários do teste: apaga

const itens = (v) => [{ cod: '1', qtd: 2, custo: v / 2 }, { cod: '2', qtd: 0, custo: 50 }, { cod: '3', qtd: 4, custo: 0 }];

test('CMV-EST-01: guarda a primeira foto de cada dia só perto da virada do mês, com o valor a custo', () => {
  assert.strictEqual(CE.registrarFoto('l1', { em: '2026-10-15T09:00:00Z', itens: itens(100) }), null, 'meio do mês: não guarda');
  const f = CE.registrarFoto('l1', { em: '2026-11-01T09:00:00Z', itens: itens(1000) });
  assert.deepStrictEqual({ valor: f.valor, itens: f.itens, semCusto: f.semCusto }, { valor: 1000, itens: 2, semCusto: 1 });
  assert.strictEqual(CE.registrarFoto('l1', { em: '2026-11-01T15:00:00Z', itens: itens(5) }), null, 'a segunda do dia não troca a primeira');
  assert.strictEqual(CE.ler('l1')['2026-11-01'].valor, 1000);
});

test('CMV-EST-01: estoque final = foto do dia 1 do mês seguinte; sem ela, a mais próxima (aprox.); a conta do mês', () => {
  CE.registrarFoto('l1', { em: '2026-11-30T09:00:00Z', itens: itens(1200) }); // sem dia 1 de dezembro
  const fotos = CE.ler('l1');
  assert.deepStrictEqual(CE.fotoFim(fotos, '2026-10'), { dia: '2026-11-01', valor: 1000, aprox: false });
  assert.deepStrictEqual(CE.fotoFim(fotos, '2026-11'), { dia: '2026-11-30', valor: 1200, aprox: true });
  const notas = [
    { entrada: '2026-11-10', motivo: 'Compra', status: 'Concluída', itens: [{ qtd: 3, custo: 100 }, { qtd: 1, custo: 50 }] },
    { entrada: '2026-11-12', motivo: 'Bonificação', status: 'Concluída', itens: [{ qtd: 9, custo: 10 }] },
    { entrada: '2026-11-15', motivo: 'Compra', status: 'Pendente', itens: [{ qtd: 9, custo: 10 }] },
  ];
  const saidas = [{ data: '2026-11-20', finalidade: 'Devolução', valor: 80, situacao: 'autorizada' }, { data: '2026-11-21', finalidade: 'Devolução', valor: 999, situacao: 'cancelada' }];
  const r = CE.resumo('l1', { notas, saidas });
  assert.deepStrictEqual(r['2026-11'], { ini: { dia: '2026-11-01', valor: 1000, aprox: false }, fim: { dia: '2026-11-30', valor: 1200, aprox: true }, compras: 350, comprasFranquia: 0, comprasOutros: 350, fornecedores: [{ nome: 'sem fornecedor', valor: 350 }], devolucoes: 80 });
  assert.strictEqual(r['2026-10'], undefined, 'outubro sem a foto do começo: fica de fora');
});

// CMV-REC-01 (pedido do dono, 25/11/2026: reconstruir o estoque desde jun/2025 pelo Extrato de estoque do AppNext)
test('CMV-REC-01: volta da planilha de agora pelos movimentos até o dia 1 de cada mês, com o custo de cada data', () => {
  const atual = { em: '2026-11-25T06:00:00-03:00', itens: [{ cod: '0010', qtd: 5, custo: 20 }, { cod: '20', qtd: 1, custo: 8 }, { cod: '30', qtd: -2, custo: 3 }] };
  const extrato = { em: '2026-11-25T17:00:00-03:00', desde: '2026-09-01', completo: true, itens: [
    { d: '2026-11-25T10:00:00-03:00', c: '10', q: -1 },          // depois da planilha: não entra
    { d: '2026-11-10T12:00:00-03:00', c: '10', q: -2 },          // vendeu 2 em nov → em 01/11 tinha 7
    { d: '2026-10-20T12:00:00-03:00', c: '10', q: 10 },          // chegou 10 em out → em 01/10 tinha -3 (não conta)
    { d: '2026-10-05T12:00:00-03:00', c: '20', q: -4 },          // em 01/10 o 20 tinha 5
    { d: '2026-09-15T12:00:00-03:00', c: '99', q: -1 },          // produto que saiu da planilha: em 01/09 tinha 1
    { d: '2026-11-01T00:00:00-03:00', c: '20', q: 0 },
  ] };
  // custo: o 10 custava 15 até 31/10 e 20 depois; o 99 não tem custo
  const custo = (cod, dia) => (cod === '0010' ? { v: dia < Math.floor(Date.UTC(2026, 10, 1) / 864e5) ? 15 : 20, est: false } : cod === '20' ? { v: 8, est: true } : { v: null, est: true });
  const r = CE.reconstruir(atual, extrato, custo);
  assert.deepStrictEqual(Object.keys(r.fotos), ['2026-11-01', '2026-10-01', '2026-09-01']);
  assert.strictEqual(r.fotos['2026-11-01'].valor, 7 * 20 + 1 * 8);
  assert.strictEqual(r.fotos['2026-10-01'].valor, 5 * 8); // o 10 estava negativo: fica de fora
  assert.deepStrictEqual({ v: r.fotos['2026-09-01'].valor, n: r.fotos['2026-09-01'].itens, sem: r.fotos['2026-09-01'].semCusto }, { v: 5 * 8, n: 2, sem: 1 });
  assert.strictEqual(r.fotos['2026-10-01'].origem, 'extrato');
  assert.strictEqual(r.fotos['2026-10-01'].estimados, 1);
  // travas: extrato lido antes da planilha, incompleto ou vazio não reconstrói
  assert.match(CE.reconstruir(atual, { ...extrato, em: '2026-11-25T05:00:00-03:00' }, custo).motivo, /leia o extrato de novo/);
  assert.match(CE.reconstruir(atual, { ...extrato, completo: false }, custo).motivo, /incompleto/);
  assert.match(CE.reconstruir(atual, { ...extrato, itens: [] }, custo).motivo, /sem o extrato/);
});

test('CMV-REC-01: a foto reconstruída entra no resumo marcada e a foto de verdade toma o lugar dela', () => {
  const pasta = path.join(tmp, 'lojas', 'lrec', 'estoque');
  fs.mkdirSync(pasta, { recursive: true });
  const C = require('../../src/config');
  const orig = C.pastaLoja; C.pastaLoja = (id) => path.join(tmp, 'lojas', id);
  try {
    fs.writeFileSync(path.join(pasta, 'extrato.json'), JSON.stringify({ em: '2026-11-25T17:00:00-03:00', desde: '2026-10-01', completo: true, itens: [{ d: '2026-11-10T12:00:00-03:00', c: '1', q: -1 }] }));
    const ES = { atualCru: () => ({ em: '2026-11-25T06:00:00-03:00', itens: [{ cod: '1', qtd: 3, custo: 10 }] }), compras: () => ({ itens: {} }), historico: () => ({}) };
    const r = CE.aplicarExtrato('lrec', { estoque: ES });
    assert.deepStrictEqual(r.meses, ['2026-10-01', '2026-11-01']);
    assert.strictEqual(CE.lerReconstrucao('lrec').meses.length, 2);
    const res = CE.resumo('lrec');
    assert.strictEqual(res['2026-10'].ini.rec, true);
    assert.strictEqual(res['2026-10'].fim.valor, 40); // 4 × 10 (custo de hoje, sem histórico)
    assert.strictEqual(CE.resumo('lrec', { notasDesde: '2026-10-15' })['2026-10'], undefined, 'notas que não cobrem o mês: sem a conta');
    // a mesma leitura não refaz; a foto de verdade do dia 1 toma o lugar
    assert.strictEqual(CE.aplicarExtrato('lrec', { estoque: ES }).meses.length, 2);
    CE.registrarFoto('lrec', { em: '2026-11-01T09:00:00Z', itens: [{ cod: '1', qtd: 4, custo: 11 }] });
    assert.strictEqual(CE.ler('lrec')['2026-11-01'].origem, undefined);
    assert.strictEqual(CE.ler('lrec')['2026-11-01'].valor, 44);
  } finally { C.pastaLoja = orig; }
});

test('CMV-REC-01: produto "sem controle de estoque" (saldo negativo sem fim) fica fora das fotos', () => {
  const atual = { em: '2026-11-25T06:00:00-03:00', itens: [{ cod: '81010', qtd: -500, custo: 0.1 }, { cod: '1', qtd: 2, custo: 10 }] };
  // voltando 600 etiquetas vendidas, o saldo de antes seria +100: não pode virar estoque a custo
  const extrato = { em: '2026-11-25T17:00:00-03:00', desde: '2026-11-01', itens: [{ d: '2026-11-10T12:00:00-03:00', c: '81010', q: -600 }] };
  const ign = new Set(['81010']);
  assert.strictEqual(CE.reconstruir(atual, extrato, null).fotos['2026-11-01'].valor, 30);
  assert.strictEqual(CE.reconstruir(atual, extrato, null, ign).fotos['2026-11-01'].valor, 20);
  assert.strictEqual(CE.valorDe([{ cod: '81010', qtd: 3, custo: 1 }, { cod: '1', qtd: 1, custo: 5 }], ign).valor, 5);
  // o grupo vem do estoque do painel
  assert.deepStrictEqual([...CE.semControle('x', { atual: () => ({ itens: [{ cod: '081010', grupo: 'CONSUMÍVEIS - SEM CONTROLE DE ESTOQUE' }, { cod: '1', grupo: 'CHÁ VERDE' }] }) })], ['81010']);
});

// CMV-FORN-01 (pedido do dono, 25/11/2026): compras da franquia (TSB) e de outros fornecedores separadas no Resultado
test('CMV-FORN-01: compras do mês separadas em TSB e outros fornecedores (com o nome e o valor de cada um)', () => {
  CE.registrarFoto('lf', { em: '2026-10-01T09:00:00Z', itens: itens(100) });
  CE.registrarFoto('lf', { em: '2026-11-01T09:00:00Z', itens: itens(100) });
  const notas = [
    { entrada: '2026-10-03', motivo: 'Compra', status: 'Concluída', fornecedor: 'TSB FRANQUIAS LTDA', itens: [{ qtd: 10, custo: 50 }] },
    { entrada: '2026-10-08', motivo: 'Compra', status: 'Concluída', fornecedor: 'Embalagens Goiás', itens: [{ qtd: 2, custo: 40 }] },
    { entrada: '2026-10-09', motivo: 'Compra', status: 'Concluída', fornecedor: 'Padaria Boa', itens: [{ qtd: 1, custo: 120 }] },
    { entrada: '2026-10-20', motivo: 'Compra', status: 'Concluída', fornecedor: 'Embalagens Goiás', itens: [{ qtd: 1, custo: 20 }] },
  ];
  const m = CE.resumo('lf', { notas })['2026-10'];
  assert.strictEqual(m.compras, 720);
  assert.strictEqual(m.comprasFranquia, 500);
  assert.strictEqual(m.comprasOutros, 220);
  assert.deepStrictEqual(m.fornecedores, [{ nome: 'Padaria Boa', valor: 120 }, { nome: 'Embalagens Goiás', valor: 100 }]);
  assert.strictEqual(CE.ehFranquia('TSB FRANQUIAS'), true);
  assert.strictEqual(CE.ehFranquia('Padaria Boa'), false);
});
