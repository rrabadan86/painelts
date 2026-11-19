'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cob-'));
process.env.DATA_DIR = tmp;
const COB = require('../../src/cobranca');
const ExcelJS = require('exceljs');

const conta = { creditos: [
  { id: 'a', numero: 1170, emissao: '2026-03-10', valor: 181.2, situacao: 'atrasado', dias: 254, notaOrigem: { nf: 17378 } },
  { id: 'b', numero: 1269, emissao: '2026-08-31', valor: 84, situacao: 'confirmar' },
] };
const fid = { pct: 0.5, meses: [
  { mes: '2026-09', resgates: [{ data: '2026-09-10', min: 620, cpf: '12345678909', cliente: 'Ana <b>', pontos: 10, produtos: [{ nome: 'Medida Inox', custo: 16 }] }], custo: 16, devido: 8, recebido: 5, lancamentos: [{ ref: '2026-10' }], situacao: 'faltou' },
  { mes: '2026-10', resgates: [], custo: 0, devido: 0, recebido: 0, lancamentos: [], situacao: 'ok' },
] };

test('cobrança de devoluções: por padrão as atrasadas; tabela escapada; total', () => {
  const r = COB.montar('devolucoes', { conta, nomeLoja: 'Tea Shop RJ' });
  assert.deepEqual(r.itens, ['a']);
  assert.equal(r.total, 181.2);
  assert.match(r.assunto, /R\$ 181,20/);
  assert.match(r.tabelaHtml, /NF-e 1170/);
  assert.deepEqual(COB.montar('devolucoes', { conta, ids: ['a', 'b'], nomeLoja: 'X' }).itens, ['a', 'b']);
});

test('cobrança de fidelidade: o que falta nos meses atrasados/a menos; planilha sem o cupom e com CPF parcial', async () => {
  const r = COB.montar('fidelidade', { fid, nomeLoja: 'Tea Shop RJ' });
  assert.deepEqual([r.itens, r.total], [['2026-09'], 3]);
  assert.match(r.tabelaHtml, /royalty de outubro\/2026/);
  assert.doesNotMatch(r.mensagem, /cupom/i);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await COB.planilhaFidelidade(fid, r.itens, 'RJ'));
  const ws = wb.worksheets[0];
  const cab = ws.getRow(1).values.join('|');
  assert.doesNotMatch(cab, /Cupom/);
  assert.equal(ws.getRow(2).getCell(5).value, '***.456.789-**');
  assert.equal(ws.getRow(2).getCell(4).value, 'Ana <b>');
  assert.match(COB.html('Oi <x>', r.tabelaHtml), /Oi &lt;x&gt;/);
});

test('destinatários e histórico', () => {
  assert.match(COB.validarPara('ok@x.com, ruim').erro, /ruim/);
  assert.deepEqual(COB.validarPara('A@X.com; b@y.com.br').ok, ['a@x.com', 'b@y.com.br']);
  COB.registrar('lj', 'devolucoes', ['a@x.com'], ['a'], 181.2, 'ger');
  assert.deepEqual(COB.emails('lj', 'devolucoes'), ['a@x.com']);
  assert.equal(COB.historico('lj')[0].tipo, 'devolucoes');
});

test('envio automático: dia 2 a partir do horário, uma vez por mês e por tipo', () => {
  assert.equal(COB.devidoAgora('la', 'devolucoes', '2026-12-02T10:00'), false, 'desligado');
  assert.match(COB.salvarAuto('la', { dia: 31 }).erro, /1 e 28/);
  assert.match(COB.salvarAuto('la', { para: { fidelidade: 'ruim' } }).erro, /ruim/);
  const a = COB.salvarAuto('la', { devolucoes: true, fidelidade: true, dia: 2, hora: '09:00', para: { fidelidade: 'fin@x.com' } }).ok;
  assert.deepEqual([a.devolucoes, a.dia, a.hora], [true, 2, '09:00']);
  assert.deepEqual(COB.emails('la', 'fidelidade'), ['fin@x.com']);
  assert.equal(COB.devidoAgora('la', 'devolucoes', '2026-12-02T08:59'), false);
  assert.equal(COB.devidoAgora('la', 'devolucoes', '2026-12-02T09:05'), true);
  assert.equal(COB.devidoAgora('la', 'devolucoes', '2026-12-03T09:05'), false);
  COB.marcarAuto('la', 'devolucoes', '2026-12', { ok: true, itens: 2, total: 100 });
  assert.equal(COB.devidoAgora('la', 'devolucoes', '2026-12-02T15:00'), false, 'já foi neste mês');
  assert.equal(COB.devidoAgora('la', 'fidelidade', '2026-12-02T15:00'), true, 'o outro tipo ainda não');
  assert.equal(COB.devidoAgora('la', 'devolucoes', '2027-01-02T09:00'), true, 'mês seguinte');
  fs.rmSync(tmp, { recursive: true, force: true });
});
