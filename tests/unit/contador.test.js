'use strict';
// Exportação do mês fechado para o contador: conteúdo de cada aba e a planilha .xlsx.
const { test } = require('node:test');
const assert = require('node:assert');
const CTD = require('../../src/contador');

const v = (data, cupom, vt, o = {}) => ({ data, cupom, loja: 'L1', descricao: 'Chá verde 100G', vu: vt, vt, qtd: 1, grupo: 'CHÁ VERDE PURO', grupoC: 'CHÁ PURO', cat: 'LOJA', ...o });
const vendas = [
  v('2026-10-01', 1, 100), v('2026-10-01', 1, 50), v('2026-10-01', 2, 30),
  v('2026-10-01', 2, 9, { descricao: 'Taxa de Serviço' }), // taxa: fora do faturamento
  v('2026-10-01', 3, 0.01, { vu: 0.01 }), // resgate a R$ 0,01: fora
  v('2026-10-02', 4, 200),
  v('2026-11-01', 5, 999), // outro mês
];
const caixa = (dia) => (dia === '2026-10-01'
  ? { vazio: false, totalVendas: 189, formas: [{ k: 'credito', valor: 100 }, { k: 'debito', valor: 40 }, { k: 'dinheiro', valor: 20 }, { k: 'pix', valor: 20 }, { k: 'x', rot: 'Vale', valor: 9 }] }
  : { vazio: true });
const notasEntrada = [
  { id: 1, nf: 501, serie: '1', fornecedor: 'TSB FRANQUIAS', fornecedorDoc: '11222333000144', emissao: '2026-09-29', entrada: '2026-10-03', motivo: 'Compra', status: 'Concluída', cfop: '1102', total: 3000, desconto: 120, chave: '3'.repeat(44) },
  { id: 2, nf: 480, serie: '1', fornecedor: 'TSB FRANQUIAS', emissao: '2026-09-10', entrada: '2026-09-12', motivo: 'Compra', status: 'Concluída', total: 500 }, // setembro
];
const notasSaida = [
  { numero: 12, serie: '1', data: '2026-10-05', emissao: '2026-10-05T10:00:00-03:00', natOp: 'Venda de mercadoria', finalidade: 'Normal', dest: { nome: 'Empresa Fictícia Ltda', doc: '12345678000190' }, valor: 800, situacao: 'autorizada', chave: '4'.repeat(44) },
  { numero: 13, serie: '1', data: '2026-10-09', emissao: '2026-10-09T10:00:00-03:00', natOp: 'Devolução', finalidade: 'Devolução', dest: { nome: 'TSB FRANQUIAS', doc: '11222333000144' }, valor: 150, situacao: 'cancelada', chave: '5'.repeat(44) },
  { numero: 14, serie: '1', data: '2026-11-02', emissao: '2026-11-02T10:00:00-03:00', natOp: 'Venda', dest: { nome: 'Outro mês', doc: '1' }, valor: 1, situacao: 'autorizada' },
];
const entrada = (o = {}) => ({ loja: { nome: 'Tea Shop Centro' }, ym: '2026-10', geradoEm: '2026-11-20', vendas, caixa, notasEntrada, notasSaida,
  resumo: [{ rot: 'Faturamento', valor: 380, pct: 1, tipo: 'base' }, { rot: '− Simples Nacional', valor: 22.8, pct: 0.06, tipo: 'menos' }, { rot: '= Resultado do mês', valor: -50.129, pct: -0.1319, tipo: 'tot' }, { rot: '', valor: 1 }, { rot: 'Sem custo', valor: null, pct: null, tipo: 'menos' }],
  despesas: [{ nome: 'Aluguel', cat: 'Imóvel', tipo: 'fixa', valor: 8000 }, { nome: 'IPTU', cat: 'Imóvel', tipo: 'pontual', valor: 2400 }, { nome: 'sem valor', valor: 'x' }], ...o });

test('CTD-01 abas da planilha: Resumo, Vendas por dia, Notas de entrada, Notas de saída e Despesas', () => {
  const abas = CTD.montar(entrada());
  assert.deepEqual(abas.map((a) => a.nome), ['Resumo do mês', 'Vendas por dia', 'Notas de entrada', 'Notas de saída (NF-e)', 'Despesas']);
  assert.ok(abas.every((a) => a.titulo.includes('Tea Shop Centro') && a.titulo.includes('outubro de 2026')));
  // Resumo: as linhas do Resultado, como vieram da tela (linha sem rótulo cai; valor nulo fica vazio; centavos arredondados)
  const res = abas[0];
  assert.deepEqual(res.linhas, [['Faturamento', 380, 1], ['− Simples Nacional', 22.8, 0.06], ['= Resultado do mês', -50.13, -0.1319], ['Sem custo', null, null]]);
  assert.deepEqual(res.negrito, [true, false, true, false]);
  assert.match(res.obs, /não é balancete/);
});

test('CTD-02 vendas por dia: faturamento oficial (sem taxa e sem item a R$ 0,01), atendimentos e formas de pagamento do fechamento de caixa', () => {
  const dias = CTD.montar(entrada())[1];
  assert.deepEqual(dias.cab, ['Dia', 'Faturamento (R$)', 'Atendimentos', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro', 'Pix', 'Ecommerce', 'Troca', 'Outras formas', 'Total do caixa']);
  assert.deepEqual(dias.linhas[0], ['01/10/2026', 180, 2, 100, 40, 20, 20, 0, 0, 9, 189]);
  assert.deepEqual(dias.linhas[1], ['02/10/2026', 200, 1, null, null, null, null, null, null, null, null], 'dia sem fechamento: formas em branco');
  assert.deepEqual(dias.total.slice(0, 4), ['Total', 380, 3, 100]);
  // loja sem fechamento de caixa: só faturamento e atendimentos, com o aviso
  const sem = CTD.montar(entrada({ caixa: null }))[1];
  assert.deepEqual(sem.cab, ['Dia', 'Faturamento (R$)', 'Atendimentos']);
  assert.deepEqual(sem.linhas, [['01/10/2026', 180, 2], ['02/10/2026', 200, 1]]);
  assert.match(sem.obs, /não tem o fechamento de caixa/);
});

test('CTD-03 notas do mês: entrada pelo dia de entrada; saída com destinatário e situação; cancelada fora do total', () => {
  const [, , ent, sai, desp] = CTD.montar(entrada());
  assert.equal(ent.linhas.length, 1);
  assert.deepEqual(ent.linhas[0].slice(0, 11), ['501', '1', 'TSB FRANQUIAS', '11222333000144', '29/09/2026', '03/10/2026', 'Compra', 'Concluída', '1102', 120, 3000]);
  assert.equal(ent.total[10], 3000);
  assert.deepEqual(sai.linhas.map((l) => [l[0], l[5], l[6], l[7], l[8]]), [['12', 'Empresa Fictícia Ltda', '12345678000190', 'Autorizada', 800], ['13', 'TSB FRANQUIAS', '11222333000144', 'Cancelada', 150]]);
  assert.equal(sai.total[8], 800);
  assert.deepEqual(desp.linhas, [['Aluguel', 'Imóvel', 'Todo mês', 8000], ['IPTU', 'Imóvel', 'Só deste mês', 2400]]);
  assert.equal(desp.total[3], 10400);
  // quem não vê as Notas fiscais recebe a aba sem nome nem documento do destinatário
  const semDest = CTD.montar(entrada({ comDestinatario: false }))[3];
  assert.deepEqual(semDest.linhas.map((l) => [l[5], l[6]]), [['', ''], ['', '']]);
  assert.ok(!JSON.stringify(semDest).includes('Empresa Fictícia'));
});

test('CTD-04 mês sem nada e só mês fechado', () => {
  const abas = CTD.montar({ loja: { nome: 'L' }, ym: '2026-10' });
  assert.deepEqual(abas.map((a) => a.linhas.length), [0, 0, 0, 0, 0]);
  assert.ok(abas.every((a) => !a.total));
  assert.equal(CTD.mesFechado('2026-10', '2026-11-20'), true);
  assert.equal(CTD.mesFechado('2026-11', '2026-11-20'), false, 'mês em andamento não exporta');
  assert.equal(CTD.mesFechado('2026-12', '2026-11-20'), false);
  assert.equal(CTD.mesFechado('2026-13', '2027-03-01'), false);
  assert.equal(CTD.mesFechado(null, '2026-11-20'), false);
});

test('CTD-05 a planilha .xlsx abre com as cinco abas, cabeçalhos e totais', async () => {
  const buf = await CTD.planilha(entrada());
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Resumo do mês', 'Vendas por dia', 'Notas de entrada', 'Notas de saída (NF-e)', 'Despesas']);
  const res = wb.getWorksheet('Resumo do mês');
  assert.match(String(res.getCell('A1').value), /Resultado do mês · Tea Shop Centro · outubro de 2026/);
  assert.equal(res.getCell('A4').value, 'Linha');
  assert.equal(res.getCell('A5').value, 'Faturamento');
  assert.equal(res.getCell('B5').value, 380);
  const dias = wb.getWorksheet('Vendas por dia');
  assert.equal(dias.getCell('A5').value, '01/10/2026');
  assert.equal(dias.getCell('B7').value, 380, 'linha de total');
  // texto que parece fórmula fica como texto (a planilha não executa nada que veio da tela)
  const buf2 = await CTD.planilha(entrada({ resumo: [{ rot: '=1+1', valor: 1 }] }));
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf2);
  assert.strictEqual(wb2.getWorksheet('Resumo do mês').getCell('A5').value, '=1+1');
  // mês vazio também abre
  const vazio = await CTD.planilha({ loja: { nome: 'L' }, ym: '2026-10' });
  const wb3 = new ExcelJS.Workbook();
  await wb3.xlsx.load(vazio);
  assert.equal(wb3.getWorksheet('Despesas').getCell('A5').value, 'Nada neste mês.');
});

test('DESP-CAT-01: despesas que acompanham as vendas entram na aba Despesas com a categoria escolhida', () => {
  const abas = CTD.montar(entrada({ despesas: [{ nome: 'Simples Nacional', cat: 'Impostos', tipo: 'vendas', valor: 22.8 }, { nome: 'Aluguel', cat: 'Imóvel', tipo: 'fixa', valor: 8000 }] }));
  const desp = abas.find((a) => a.nome === 'Despesas');
  assert.deepEqual(desp.linhas.slice(0, 2), [['Simples Nacional', 'Impostos', 'Acompanha as vendas', 22.8], ['Aluguel', 'Imóvel', 'Todo mês', 8000]]);
});
