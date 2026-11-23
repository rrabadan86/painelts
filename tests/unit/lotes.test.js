'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lot-'));
process.env.DATA_DIR = tmp;
const L = require('../../src/lotes');

const estoque = { em: '2026-11-18T10:00:00Z', itens: [
  { cod: '80149', desc: 'VALERIANA', un: 'Kg', qtd: 2.5, custo: 120 },
  { cod: '80200', desc: 'EARL GREY', un: 'Kg', qtd: 0.4, custo: 100 },
  { cod: '406', desc: 'LATA TOP TEA', un: 'UN', qtd: 10, custo: 20 }, // envasado: sem validade
  { cod: '80300', desc: 'HIBISCO', un: 'Kg', qtd: 0, custo: 90 }, // sem estoque: sem lote
] };
const compras = { itens: {
  '80149': [['2025-12-01', 118, 100, 1, 'TSB'], ['2026-03-10', 120, 200, 2, 'TSB'], ['2026-11-19', 125, 300, 3, 'TSB']], // a de 19/11 é depois do estoque
  '80200': [['2025-11-10', 100, 150, 1, 'TSB']],
  '406': [['2026-01-01', 20, 100, 10, 'TSB']],
} };
const tabela = { itens: [{ cod: '801491', desc: 'VALERIANA 100G', preco: 30 }, { cod: '801492', desc: 'VALERIANA 50G', preco: 18 }] };

test('lotes: só chá a granel, estoque distribuído da entrada mais nova para a mais antiga', () => {
  const { lotes } = L.calcular({ estoque, compras, tabela, edits: { lotes: {} }, hoje: '2026-11-18' });
  const val = lotes.filter((l) => l.cod === '80149');
  // 2,5 kg: 2 kg do lote de março e 0,5 kg do de dezembro; a entrada de 19/11 ainda não está no estoque exportado
  assert.deepEqual(val.map((l) => [l.entrada, l.saldo]).sort(), [['2025-12-01', 0.5], ['2026-03-10', 2]]);
  assert.ok(!lotes.some((l) => l.cod === '406' || l.cod === '80300'));
  const dez = val.find((l) => l.entrada === '2025-12-01');
  assert.equal(dez.validade, '2026-12-01');
  // o pacote de dezembro está aberto (0,5 kg na lata): depois de aberto vale o "consumir até" (abertura estimada + 6 meses),
  // no lugar dos 12 meses da chegada (decisão do dono: a data de abertura sobrepõe a da chegada)
  assert.deepEqual([dez.pacoteN, dez.aberto, dez.abertoEm, dez.validadeAberto, dez.motivo], [1, 0.5, '2026-09-18', '2027-03-18', 'aberto']);
  assert.equal(dez.dias, 120);
  assert.equal(dez.faixa, 'ok');
  assert.equal(dez.lote, '0');
  assert.equal(dez.precoKg, 300); // pacote de 100 g a R$ 30 → R$ 300/kg
  const eg = lotes.find((l) => l.cod === '80200');
  assert.equal(eg.validade, '2026-11-10');
  assert.equal(eg.faixa, 'vencido');
  assert.equal(lotes[0].cod, '80200'); // o mais urgente primeiro
});

test('lotes: saldo sem nota e faixas', () => {
  const est = { em: '2026-11-18', itens: [{ cod: '1', desc: 'X', un: 'Kg', qtd: 3, custo: 10 }] };
  const { lotes } = L.calcular({ estoque: est, compras: { itens: { 1: [['2026-10-01', 10, 9, 1, 'T']] } }, tabela: null, edits: { lotes: {} }, hoje: '2026-11-18' });
  assert.deepEqual(lotes.map((l) => [l.chave, l.saldo, l.faixa]).sort(), [['9|1|2026-10-01', 1, 'ok'], ['inicial|1', 2, 'sem']]);
  assert.equal(L.faixa(-1), 'vencido'); assert.equal(L.faixa(0), 'critica'); assert.equal(L.faixa(29), 'critica');
  assert.equal(L.faixa(30), 'acao'); assert.equal(L.faixa(59), 'acao'); assert.equal(L.faixa(60), 'atencao'); assert.equal(L.faixa(90), 'ok');
  assert.equal(L.somarMeses('2024-02-29', 12), '2025-02-28');
});

test('lotes: edição do nº do lote e da validade, resumo e valor em risco', () => {
  const calc = () => L.calcular({ estoque, compras, tabela, edits: L.ler('lj'), hoje: '2026-11-18' }).lotes;
  let lotes = calc();
  const ch = lotes.find((l) => l.cod === '80149' && l.entrada === '2026-03-10').chave;
  assert.match(L.editar('lj', { chave: ch, lote: 'a<b' }, 'v', lotes).erro, /Lote/);
  assert.match(L.editar('lj', { chave: ch, validade: '2020-01-01' }, 'v', lotes).erro, /Validade/);
  assert.match(L.editar('lj', { chave: 'nada', lote: '1' }, 'v', lotes).erro, /não encontrado/);
  assert.ok(L.editar('lj', { chave: ch, lote: 'l2603-a', validade: '2026-12-20' }, 'vendedora', lotes).ok);
  lotes = calc();
  const l = lotes.find((x) => x.chave === ch);
  assert.deepEqual([l.lote, l.validade, l.padrao, l.faixa, l.editadoPor], ['L2603-A', '2026-12-20', false, 'acao', 'vendedora']);
  const r = L.resumo(lotes);
  // em risco (< 60 dias): EG vencido 0,4 kg + valeriana março 2 kg (a de dezembro está aberta e vale até março pelo "consumir até")
  assert.equal(r.risco.kg, 2.4);
  assert.equal(r.risco.custo, 0.4 * 100 + 2 * 120);
  assert.equal(r.porFaixa.vencido.lotes, 1);
  assert.equal(r.semLote, lotes.length - 1);
  // validade vazia volta para 12 meses da entrada; lote "0" apaga o número
  assert.ok(L.editar('lj', { chave: ch, lote: '0', validade: '' }, 'v', lotes));
  assert.equal(calc().find((x) => x.chave === ch).validade, '2027-03-10');
  assert.deepEqual(L.ler('lj').lotes, {});
});

test('lotes: "deste lote ainda tem X" e as vendas seguintes saindo do mais antigo', () => {
  // valeriana: 200 g do lote antigo (A) e 1 kg do novo (B); estoque 1,2 kg
  const comp = { itens: { 9: [['2026-01-10', 100, 1, 2, 'T'], ['2026-11-17', 100, 2, 1, 'T']] } };
  const est = (q, em) => ({ em, itens: [{ cod: '9', desc: 'VALERIANA', un: 'Kg', qtd: q, custo: 100 }] });
  const A = '1|9|2026-01-10', B = '2|9|2026-11-17';
  const dist = (r) => Object.fromEntries(r.lotes.map((l) => [l.chave, l.saldo]));
  const calc = (e) => L.calcular({ estoque: e, compras: comp, tabela: null, edits: L.ler('aj'), hoje: '2026-11-18' });
  assert.deepEqual(dist(calc(est(1.2, '2026-11-18T09:00:00Z'))), { [B]: 1, [A]: 0.2 });
  // venderam 300 g do pacote novo por engano: o AppNext fica com 0,9 kg; a regra automática acharia A = 0
  let ctx = { estoque: est(0.9, '2026-11-19T09:00:00Z'), compras: comp };
  ctx.lotes = calc(ctx.estoque).lotes;
  assert.deepEqual(dist({ lotes: ctx.lotes }), { [B]: 0.9 });
  // a vendedora diz: do lote A ainda tem 200 g
  assert.match(L.editarSaldo('aj', { chave: B, saldo: 1.5 }, 'v', ctx).erro, /AppNext/);
  ctx.lotes = [...ctx.lotes, { chave: A, cod: '9', saldo: 0, qtdEntrada: 2 }]; // a tela manda o lote que ela vê
  assert.ok(L.editarSaldo('aj', { chave: A, saldo: 0.2 }, 'vendedora', ctx).ok);
  assert.deepEqual(dist(calc(est(0.9, '2026-11-19T09:00:00Z'))), { [B]: 0.7, [A]: 0.2 });
  // vendeu mais 250 g: sai primeiro do lote A
  const d2 = calc(est(0.65, '2026-11-20T09:00:00Z'));
  assert.deepEqual(dist(d2), { [B]: 0.65 });
  assert.equal(d2.lotes[0].ajuste.tipo, 'manual');
  // chegou mais 1 kg (lote C) e vendeu 100 g
  comp.itens[9].push(['2026-11-21', 100, 3, 1, 'T']);
  assert.deepEqual(dist(calc(est(1.55, '2026-11-22T09:00:00Z'))), { [B]: 0.55, '3|9|2026-11-21': 1 });
  // um estoque exportado antes do ajuste não usa o ajuste
  assert.deepEqual(dist(calc(est(1.2, '2026-11-18T09:00:00Z'))), { [B]: 1, [A]: 0.2 });
  // voltar ao automático
  assert.ok(L.editarSaldo('aj', { chave: B, automatico: true }, 'g', { ...ctx, lotes: calc(est(0.9, '2026-11-19T09:00:00Z')).lotes }).ok);
  assert.deepEqual(dist(calc(est(0.9, '2026-11-19T09:00:00Z'))), { [B]: 0.9 });
});

test('lotes: todos os lotes do chá de uma vez (a soma tem de ser o estoque)', () => {
  const comp = { itens: { 7: [['2026-02-01', 100, 11, 2, 'T'], ['2026-10-01', 100, 12, 1, 'T']] } };
  const estoque = { em: '2026-11-18T09:00:00Z', itens: [{ cod: '7', desc: 'CHAI', un: 'Kg', qtd: 1.2, custo: 100 }] };
  const ctx = { estoque, compras: comp, lotes: L.calcular({ estoque, compras: comp, tabela: null, edits: L.ler('mx'), hoje: '2026-11-18' }).lotes };
  assert.match(L.editarSaldo('mx', { cod: '7', lotes: { '11|7|2026-02-01': 0.5, '12|7|2026-10-01': 0.5 } }, 'v', ctx).erro, /soma/);
  assert.match(L.editarSaldo('mx', { cod: '7', lotes: { 'x|7|2026-02-01': 1.2 } }, 'v', ctx).erro, /inválido/);
  assert.ok(L.editarSaldo('mx', { cod: '7', lotes: { '11|7|2026-02-01': 0.5, '12|7|2026-10-01': 0.7 } }, 'v', ctx).ok);
  const r = L.calcular({ estoque, compras: comp, tabela: null, edits: L.ler('mx'), hoje: '2026-11-18' });
  assert.deepEqual(Object.fromEntries(r.lotes.map((l) => [l.chave, l.saldo])), { '11|7|2026-02-01': 0.5, '12|7|2026-10-01': 0.7 });
});

test('lotes: chás a granel da nota de entrada (antes do estoque) e notas com lote pendente', () => {
  const estoque = { em: '2026-11-10T09:00:00Z', itens: [{ cod: '5', desc: 'ROOIBOS', un: 'Kg', qtd: 0.3, custo: 90 }, { cod: '6', desc: 'LATA X', un: 'UN', qtd: 4, custo: 20 }] };
  const compras = { itens: { 5: [['2026-11-17', 90, 777, 2, 'TSB']], 6: [['2026-11-17', 20, 777, 6, 'TSB']] } };
  const nota = { id: 'n777', nf: 777, entrada: '2026-11-17T10:00:00', itens: [{ cod: '5', nome: 'ROOIBOS', un: 'KG', qtd: 2 }, { cod: '6', nome: 'LATA X', un: 'UN', qtd: 6 }] };
  const its = L.daNota({ nota, estoque, compras, edits: L.ler('nt') });
  assert.deepEqual(its.map((x) => [x.chave, x.lote, x.validade, x.qtd]), [['777|5|2026-11-17', '0', '2027-11-17', 2]]);
  assert.deepEqual(L.pendentesNotas({ notas: [nota], estoque, compras, edits: L.ler('nt'), hoje: '2026-11-18' }), { n777: 1 });
  // o estoque ainda é de antes da nota: o lote não está em aberto, mas dá para informar pela nota
  const abertos = L.calcular({ estoque, compras, tabela: null, edits: L.ler('nt'), hoje: '2026-11-18' }).lotes;
  assert.ok(!abertos.some((l) => l.chave === '777|5|2026-11-17'));
  assert.match(L.editar('nt', { chave: '777|5|2026-11-17', lote: 'R1' }, 'v', abertos).erro, /não encontrado/);
  assert.ok(L.editar('nt', { chave: '777|5|2026-11-17', lote: 'R1' }, 'v', abertos, compras).ok);
  assert.deepEqual(L.pendentesNotas({ notas: [nota], estoque, compras, edits: L.ler('nt'), hoje: '2026-11-18' }), {});
  // quando o estoque é atualizado, o lote aparece com o nº já preenchido
  const depois = L.calcular({ estoque: { ...estoque, em: '2026-11-18T09:00:00Z', itens: [{ ...estoque.itens[0], qtd: 2.3 }] }, compras, tabela: null, edits: L.ler('nt'), hoje: '2026-11-18' }).lotes;
  assert.equal(depois.find((l) => l.chave === '777|5|2026-11-17').lote, 'R1');
});

test('lotes: lote que já acabou não fica como "lote pendente" na nota', () => {
  const estoque = { em: '2026-11-18T09:00:00Z', itens: [{ cod: '5', desc: 'ROOIBOS', un: 'Kg', qtd: 1, custo: 90 }, { cod: '8', desc: 'MATE', un: 'Kg', qtd: 0, custo: 50 }] };
  const compras = { itens: { 5: [['2026-11-10', 90, 900, 2, 'TSB']], 8: [['2026-11-10', 50, 900, 1, 'TSB']] } };
  const nota = { id: 'n900', nf: 900, entrada: '2026-11-10', itens: [{ cod: '5', un: 'KG', qtd: 2 }, { cod: '8', un: 'KG', qtd: 1 }] };
  const abertos = new Set(L.calcular({ estoque, compras, tabela: null, edits: { lotes: {} }, hoje: '2026-11-18' }).lotes.map((l) => l.chave));
  assert.deepEqual(L.pendentesNotas({ notas: [nota], estoque, compras, edits: { lotes: {} }, abertos, hoje: '2026-11-18' }), { n900: 1 });
});

test('lotes: chá a granel com e sem estoque (e nota que chegou depois do estoque)', () => {
  const estoque = { em: '2026-11-18T09:00:00Z', itens: [{ cod: '1', desc: 'VALERIANA', un: 'Kg', qtd: 0 }, { cod: '2', desc: 'CHAI', un: 'Kg', qtd: 0.4 }, { cod: '3', desc: 'MATE', un: 'Kg', qtd: 0 }, { cod: '4', desc: 'LATA X', un: 'Kg', qtd: 2 }] };
  const compras = { itens: { 3: [['2026-11-19', 10, 5, 1, 'T']] } };
  assert.deepEqual(L.granelEstoque({ estoque, compras }), [['VALERIANA', 0, 0], ['CHAI', 0.4, 0], ['MATE', 0, 1]]);
});

test('lotes: disponível (sem quantidade nem custo) para a trava das mensagens', () => {
  const estoque = { em: '2026-11-18T09:00:00Z', itens: [{ cod: '1', desc: 'VALERIANA', un: 'Kg', qtd: 0, custo: 9 }, { cod: '2', desc: 'CANECA', un: 'Un', qtd: 3, custo: 9 }, { cod: '3', desc: 'MATE', un: 'Kg', qtd: 0 }] };
  const r = L.disponivel({ estoque, compras: { itens: { 3: [['2026-11-19', 1, 1, 1, 'T']] } } });
  assert.deepEqual(r.itens, [['VALERIANA', 'Kg', 0], ['CANECA', 'Un', 1], ['MATE', 'Kg', 1]]);
  assert.ok(!JSON.stringify(r).includes('custo'));
});

test('lotes: chá a granel só conta como disponível para as mensagens com pelo menos 100 g (decisão do dono)', () => {
  const estoque = { em: '2026-11-18T09:00:00Z', itens: [{ cod: '1', desc: 'CHAI', un: 'Kg', qtd: 0.099 }, { cod: '2', desc: 'ROOIBOS', un: 'Kg', qtd: 0.1 }, { cod: '3', desc: 'MATE', un: 'Kg', qtd: 0.03 }, { cod: '4', desc: 'CANECA', un: 'Un', qtd: 1 }] };
  const r = L.disponivel({ estoque, compras: { itens: { 3: [['2026-11-19', 1, 1, 1, 'T']] } } });
  assert.deepEqual(r.itens.map((x) => x[2]), [0, 1, 1, 1], '99 g não; 100 g sim; com nota nova depois do estoque, sim; outro produto, com 1 já tem');
  assert.strictEqual(L.MINIMO_GRANEL_KG, 0.1);
});

// ---------- chás envasados e alimentação: só lote e validade, em unidade (LOTE-ENV-01, UN-ENV-01) ----------
const TP = require('../../src/tipoprod');
const estEnv = TP.normalizar({ em: '2026-11-18T10:00:00Z', itens: [
  { cod: '700', desc: 'Matcha 30G Pacote', un: 'Kg', qtd: 9, custo: 38.5 }, // o AppNext diz "9,000 kg": são 9 pacotes
  { cod: '701', desc: 'Geleia Wild Peach 200G', un: 'Un', qtd: 20, custo: 15 },
  { cod: '702', desc: 'CAMOMILA', un: 'Kg', qtd: 1.5, custo: 90 },
  { cod: '703', desc: 'Caneca', un: 'Un', qtd: 5, custo: 30 },
] }, (c) => ({ 700: 'CHÁS ENVASADOS', 701: 'ALIMENTAÇÃO', 703: 'ACESSÓRIOS' })[c] || '');
const compEnv = { itens: {
  700: [['2026-09-01', 37, 501, 6, 'TSB'], ['2026-10-20', 38.5, 502, 6, 'TSB']],
  701: [['2026-08-10', 15, 601, 30, 'TSB']],
  702: [['2026-10-01', 90, 701, 2, 'TSB']],
} };

test('UN-ENV-01: envasado em "Kg" no AppNext vira unidade (9,000 kg = 9 un); granel continua kg; o tipo vem do grupo e, sem grupo, do nome', () => {
  const m = Object.fromEntries(estEnv.itens.map((i) => [i.cod, [i.un, i.qtd, i.tipoProd, i.unAppNext]]));
  assert.deepEqual(m['700'], ['Un', 9, 'envasado', 'Kg']);
  assert.deepEqual(m['701'], ['Un', 20, 'alimento', undefined]);
  assert.deepEqual(m['702'], ['Kg', 1.5, 'granel', undefined]);
  assert.deepEqual(m['703'], ['Un', 5, null, undefined]);
  assert.equal(TP.tipo({ un: 'Kg', desc: 'African Sunset 20G Minitin' }), 'envasado', 'sem grupo: pelo nome (tamanho em gramas, minitin)');
  assert.equal(TP.tipo({ un: 'Un', desc: 'Tea Moments Pack', grupo: 'TEA MOMENTS' }), 'envasado');
  assert.equal(TP.tipo({ un: 'Un', desc: 'Set Detox', grupo: 'FOREST FRIENDLY TEAS' }), 'envasado');
  // a trava de 100 g é só do granel: 1 pacote de envasado já "tem"
  const disp = L.disponivel({ estoque: TP.normalizar({ em: estEnv.em, itens: [{ cod: '9', desc: 'Matcha 30G Pacote', un: 'Kg', qtd: 0.05 }] }, () => 'CHÁS ENVASADOS'), compras: { itens: {} } });
  assert.deepEqual(disp.itens, [['Matcha 30G Pacote', 'Un', 1]]);
});

test('LOTE-ENV-01: envasado e alimentação têm lote por nota, PEPS em unidade, validade padrão de 12 meses e digitada; sem abertura', () => {
  const r = L.calcular({ estoque: estEnv, compras: compEnv, tabela: { itens: [{ cod: '700', desc: 'Matcha 30G Pacote', preco: 89.9 }] }, edits: { lotes: { '501|700|2026-09-01': { lote: 'M1', validade: '2027-02-10' } } }, hoje: '2026-11-18' });
  assert.deepEqual(r.lotes.map((l) => l.cod), ['702'], 'os lotes de sempre continuam só os do chá a granel');
  const mt = r.outros.filter((l) => l.cod === '700').sort((a, b) => (a.entrada < b.entrada ? -1 : 1));
  // 9 pacotes: 6 da nota mais nova e 3 da mais antiga (o mais antigo saiu primeiro)
  assert.deepEqual(mt.map((l) => [l.nf, l.saldo, l.un, l.tipoProd]), [['501', 3, 'un', 'envasado'], ['502', 6, 'un', 'envasado']]);
  assert.deepEqual([mt[0].lote, mt[0].validade, mt[0].padrao], ['M1', '2027-02-10', false], 'validade digitada');
  assert.deepEqual([mt[1].lote, mt[1].validade, mt[1].padrao], ['0', '2027-10-20', true], 'padrão: 12 meses da chegada');
  for (const l of r.outros) assert.ok(!('abertos' in l) && !l.abertoEm && !l.motivo, 'sem abertura, sem "na lata"');
  assert.equal(mt[1].precoKg, 89.9, 'preço da unidade (o próprio código na tabela)');
  const ge = r.outros.find((l) => l.cod === '701');
  assert.deepEqual([ge.saldo, ge.tipoProd, ge.un, ge.validade], [20, 'alimento', 'un', '2027-08-10']);
  assert.ok(!r.outros.some((l) => l.cod === '703'), 'acessório não tem lote');
  // resumo em unidade (não soma com kg) e perdas: unidade × custo
  const rs = L.resumo(r.outros);
  assert.deepEqual([rs.porFaixa.ok.un, rs.porFaixa.atencao.un, rs.porFaixa.ok.kg], [26, 3, 0]); // o lote M1 vence em 84 dias
  const venc = L.calcular({ estoque: estEnv, compras: compEnv, tabela: null, edits: { lotes: { '601|701|2026-08-10': { validade: '2026-11-01' } } }, hoje: '2026-11-18' }).outros.find((l) => l.cod === '701');
  const pm = require('../../src/perdas').porMes({ lotes: [venc], contagens: [] })['2026-11'];
  assert.deepEqual([pm.unVencidos, pm.kgVencidos, pm.vencidos], [20, 0, 300]);
});

test('LOTE-ENV-02: validades diferentes na mesma linha da nota — repartir, a soma não passa, PEPS pela validade mais curta, desfazer', () => {
  const id = 'lenv';
  const ctx = () => L.calcular({ estoque: estEnv, compras: compEnv, tabela: null, edits: L.ler(id), hoje: '2026-11-18' });
  const k = '601|701|2026-08-10'; // 30 geleias na nota, 20 no estoque
  assert.match(L.repartir(id, { chave: k, partes: [{ qtd: 30, validade: '2027-04-20' }] }, 'ana', { estoque: estEnv, compras: compEnv }).erro, /menor/);
  assert.match(L.repartir(id, { chave: k, partes: [{ qtd: 1.5, validade: '2027-04-20' }] }, 'ana', { estoque: estEnv, compras: compEnv }).erro, /inteiro/);
  assert.match(L.repartir(id, { chave: '702|702|2026-10-01'.replace('702|702', '701|702'), partes: [{ qtd: 1, validade: '2027-04-20' }] }, 'ana', { estoque: estEnv, compras: compEnv }).erro, /envasados e alimentação|não encontrada/);
  assert.match(L.repartir(id, { chave: '701|702|2026-10-01', partes: [{ qtd: 1, validade: '2027-04-20' }] }, 'ana', { estoque: estEnv, compras: compEnv }).erro, /Só chás envasados e alimentação/, 'granel não reparte');
  // 18 vencem 10/03 e 12 vencem 20/04: a 1ª parte fica com o resto (18) e a validade do lote
  L.editar(id, { chave: k, validade: '2027-03-10' }, 'ana', ctx().outros, compEnv);
  const r = L.repartir(id, { chave: k, partes: [{ qtd: 12, validade: '2027-04-20' }] }, 'ana', { estoque: estEnv, compras: compEnv });
  assert.deepEqual(r.ok.primeira, 18);
  const ps = ctx().outros.filter((l) => l.cod === '701').sort((a, b) => a.parte - b.parte);
  // 20 no estoque: saíram 10 — todos da validade mais curta (10/03): sobram 8 dela e as 12 de 20/04
  assert.deepEqual(ps.map((l) => [l.parte, l.validade, l.qtdEntrada, l.saldo, l.chaveNota]), [[1, '2027-03-10', 18, 8, k], [2, '2027-04-20', 12, 12, k]]);
  const nota = { nf: '601', entrada: '2026-08-10', itens: [{ cod: '701', nome: 'Geleia', un: 'Un', qtd: 30 }] };
  const dn = L.daNota({ nota, estoque: estEnv, compras: compEnv, edits: L.ler(id) })[0];
  assert.deepEqual([dn.primeira, dn.partes, dn.podeRepartir], [18, [{ qtd: 12, validade: '2027-04-20' }], true]);
  // a validade de uma parte a mais não muda pelo lote (só em "+ outra validade"); o nº do lote é o da linha
  assert.match(L.editar(id, { chave: k + '~2', validade: '2027-05-01' }, 'ana', ctx().outros, compEnv).erro, /outra validade/);
  L.editar(id, { chave: k + '~2', lote: 'G7' }, 'ana', ctx().outros, compEnv);
  assert.ok(ctx().outros.filter((l) => l.cod === '701').every((l) => l.lote === 'G7'));
  // desfazer: volta para uma data só
  L.repartir(id, { chave: k, partes: [] }, 'ana', { estoque: estEnv, compras: compEnv });
  const um = ctx().outros.filter((l) => l.cod === '701');
  assert.deepEqual(um.map((l) => [l.chave, l.validade, l.saldo, l.parte]), [[k, '2027-03-10', 20, undefined]]);
});

test('DEV-VAL-01: validade curta na chegada — granel 6 meses, envasado e alimentação 30 dias (uma regra por tipo)', () => {
  assert.deepEqual(L.VALIDADE_MIN, { granel: { meses: 6 }, envasado: { dias: 30 }, alimento: { dias: 30 } });
  assert.equal(L.VALIDADE_MIN_DIAS, 30);
  assert.deepEqual(L.limiteValidade('granel', '2026-11-10'), { data: '2027-05-10', texto: 'menos de 6 meses da chegada' });
  assert.deepEqual(L.limiteValidade('envasado', '2026-11-10'), { data: '2026-12-10', texto: 'menos de 30 dias da chegada' });
  assert.equal(L.limiteValidade(null, '2026-11-10'), null);
  assert.equal(L.validadeCurta('alimento', '2026-11-10', '2026-12-09'), true);
  assert.equal(L.validadeCurta('alimento', '2026-11-10', '2026-12-10'), false);
  assert.equal(L.validadeCurta('envasado', '2026-11-10', '2026-12-01'), true);
  assert.equal(L.validadeCurta('granel', '2026-11-10', '2027-05-09'), true);
  assert.equal(L.validadeCurta('granel', '2026-11-10', '2027-05-10'), false);
  // na nota: o limite vem pronto para a tela comparar (granel: a validade do PACOTE)
  const nota = { nf: '701', entrada: '2026-10-01', itens: [{ cod: '702', nome: 'CAMOMILA', un: 'Kg', qtd: 2 }] };
  const it = L.daNota({ nota, estoque: estEnv, compras: compEnv, edits: { lotes: {} } })[0];
  assert.deepEqual([it.tipoProd, it.minValidade, it.prazoCurto, it.podeRepartir], ['granel', '2027-04-01', 'menos de 6 meses da chegada', false]);
});
