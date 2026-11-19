'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
process.env.DATA_DIR = tmp;
const CF = require('../../src/contafranquia');

const forn = 'TSB FRANQUIAS';
const d = (iso) => iso;
const ent = (id, nf, emissao, desconto) => ({ id, nf, chave: String(nf).padStart(44, '3'), emissao, entrada: emissao, fornecedor: forn, total: 1000, desconto, itens: [] });
const dev = (n, emissao, valor, ref) => ({ chave: String(n).padStart(44, '4'), numero: n, emissao, finalidade: 'Devolução', situacao: 'autorizada', valor, refs: [ref] });

test('parcial: as devoluções mais antigas que cabem no desconto, sem passar', () => {
  const c = (id, valor) => ({ id, valor });
  assert.deepEqual(CF.parcial([c('a', 42), c('b', 42), c('c', 181.2)], 287.3).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(CF.parcial([c('a', 300)], 287.3), []);
});

test('combinar: acha a combinação exata de devoluções (cada uma inteira) e marca quando há mais de uma', () => {
  const c = (id, valor) => ({ id, valor });
  assert.deepEqual(CF.combinar([c('a', 200), c('b', 150), c('c', 87.4)], 350).comb.map((x) => x.id), ['a', 'b']);
  assert.equal(CF.combinar([c('a', 200), c('b', 150)], 120).comb.length, 0);
  assert.equal(CF.combinar([c('a', 100), c('b', 100)], 100).ambigua, true);
  assert.deepEqual(CF.combinar([c('a', 99.98)], 100).comb.map((x) => x.id), ['a']); // centavos do rateio
});

test('conta: desconto da nota compensa as devoluções; o que sobra fica em aberto/atrasado; à mão e "não é de devolução"', () => {
  const compras = [ent('e1', 19001, d('2026-09-01'), 0), ent('e2', 19050, d('2026-09-20'), 0), ent('e3', 19120, d('2026-10-28'), 350), ent('e4', 19180, d('2026-11-10'), 75)];
  compras[3].desconto = null; compras[3].itens = [{ cod: '1', desc: 50 }, { cod: '2', desc: 25 }]; // desconto só nos itens
  const saidas = [dev(512, '2026-09-10', 200, compras[0].chave), dev(518, '2026-10-01', 150, compras[1].chave), dev(531, '2026-10-05', 60.9, compras[1].chave), dev(540, '2026-11-01', 87.4, compras[2].chave),
    { ...dev(541, '2026-11-02', 10, compras[2].chave), situacao: 'cancelada' }];
  const x = CF.conta('lj', { saidas, compras, devsPainel: [], hoje: '2026-11-18T12:00:00Z' });
  const por = Object.fromEntries(x.creditos.map((c) => [c.numero, c]));
  assert.equal(x.creditos.length, 4, 'a cancelada não conta');
  assert.equal(por[512].situacao, 'compensado'); assert.equal(por[512].compensado.nota.nf, 19120);
  assert.equal(por[518].situacao, 'compensado');
  // 19180: desconto de R$ 75 não fecha → sugere a devolução mais antiga que cabe (531, R$ 60,90), sobra R$ 14,10
  const n4 = x.notas.find((n) => n.nf === 19180);
  assert.deepEqual([n4.situacao, n4.sobra], ['sugestao', 14.1]);
  assert.equal(por[531].situacao, 'confirmar');
  assert.equal(por[540].situacao, 'aberto');
  assert.equal(por[512].fornecedor, forn);
  assert.equal(x.resumo.conferir, 1);
  // "não é isso": a 531 volta a ficar atrasada
  assert.ok(CF.acao('lj', { tipo: 'recusar', nota: 'e4' }, 'ger').ok);
  const xr = CF.conta('lj', { saidas, compras, devsPainel: [], hoje: '2026-11-18T12:00:00Z' });
  assert.equal(xr.creditos.find((c) => c.numero === 531).situacao, 'atrasado');
  assert.equal(xr.notas.find((n) => n.nf === 19180).situacao, 'sem_par');
  assert.ok(CF.acao('lj', { tipo: 'considerar', nota: 'e4' }, 'ger').ok);
  // à mão: a 531 foi paga no boleto; o desconto da 19180 não é de devolução
  assert.ok(CF.acao('lj', { tipo: 'compensar', credito: por[531].id, como: 'boleto', obs: 'boleto 12/11' }, 'ger').ok);
  assert.ok(CF.acao('lj', { tipo: 'ignorar', nota: 'e4', obs: 'promoção' }, 'ger').ok);
  const y = CF.conta('lj', { saidas, compras, devsPainel: [], hoje: '2026-11-18T12:00:00Z' });
  const p2 = Object.fromEntries(y.creditos.map((c) => [c.numero, c]));
  assert.equal(p2[531].situacao, 'manual'); assert.equal(p2[531].compensado.como, 'boleto');
  assert.equal(y.notas.find((n) => n.nf === 19180).situacao, 'ignorada');
  assert.equal(y.resumo.conferir, 0);
  // ligar à mão a 540 numa nota
  assert.ok(CF.acao('lj', { tipo: 'considerar', nota: 'e4' }, 'ger').ok);
  assert.ok(CF.acao('lj', { tipo: 'ligar', nota: 'e4', creditos: [p2[540].id] }, 'ger').ok);
  const z = CF.conta('lj', { saidas, compras, devsPainel: [], hoje: '2026-11-18T12:00:00Z' });
  assert.equal(z.creditos.find((c) => c.numero === 540).compensado.nota.nf, 19180);
  assert.equal(z.notas.find((n) => n.nf === 19180).situacao, 'manual');
  assert.match(CF.acao('lj', { tipo: 'xyz' }, 'g').erro, /inválida/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('prêmios de fidelidade: 50% do custo dos resgates do mês; desconto lançado no royalty de referência; atrasado/veio a menos', () => {
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cf2-'));
  process.env.DATA_DIR = tmp2;
  delete require.cache[require.resolve('../../src/config')]; delete require.cache[require.resolve('../../src/contafranquia')];
  const CF2 = require('../../src/contafranquia');
  const estoque = { itens: [{ cod: '1', desc: 'MEDIDA INOX', un: 'Un', custo: 20 }, { cod: '3', desc: 'ROOIBOS ORIGINAL', un: 'Kg', custo: 200 }] };
  const compras = [{ entrada: '2026-08-01', itens: [{ cod: '1', custo: 16 }] }, { entrada: '2026-10-15', itens: [{ cod: '1', custo: 18 }] }];
  const codsDe = (n) => (/medida/i.test(n) ? ['1'] : /rooibos/i.test(n) ? ['3'] : []);
  const eventos = [
    { tipo: 'resgate', data: '2026-09-10', produtos: ['Medida Inox'] },            // custo da nota de 01/08: 16
    { tipo: 'resgate', data: '2026-09-20', produtos: ['Rooibos Original 50G'] },   // 200/kg × 50 g = 10
    { tipo: 'resgate', data: '2026-10-20', produtos: ['Medida Inox', 'Xícara X'] }, // 18 + sem custo
    { tipo: 'pontos', data: '2026-10-21', produtos: ['Medida Inox'] },
  ];
  const ent = { eventos, estoque, compras, codsDe };
  const x = CF2.contaPremios('lf', ent, '2026-11-18T12:00:00Z');
  const set = x.meses.find((m) => m.mes === '2026-09'), out = x.meses.find((m) => m.mes === '2026-10');
  assert.deepEqual([set.custo, set.devido, set.situacao], [26, 13, 'atrasado']);
  assert.deepEqual([out.custo, out.devido, out.semCusto, out.situacao], [18, 9, 1, 'aguardando']);
  assert.match(CF2.royalties('lf', { ref: '2026-13', valor: '10' }, 'g').erro, /mês/);
  assert.ok(CF2.royalties('lf', { ref: '2026-10', valor: '10,00', obs: 'boleto' }, 'g').ok); // prêmios = mês anterior (setembro)
  const y = CF2.contaPremios('lf', ent, '2026-11-18T12:00:00Z');
  const s2 = y.meses.find((m) => m.mes === '2026-09');
  assert.deepEqual([s2.recebido, s2.diferenca, s2.situacao, s2.lancamentos[0].ref], [10, 3, 'faltou', '2026-10']);
  assert.ok(CF2.royalties('lf', { ref: '2026-11', premios: '2026-09', valor: '3' }, 'g').ok);
  assert.equal(CF2.contaPremios('lf', ent, '2026-11-18T12:00:00Z').meses.find((m) => m.mes === '2026-09').situacao, 'ok');
  const id = CF2.contaPremios('lf', ent, '2026-11-18T12:00:00Z').meses.find((m) => m.mes === '2026-09').lancamentos[0].id;
  assert.ok(CF2.royalties('lf', { tipo: 'apagar', id }, 'g').ok);
  assert.equal(CF2.contaPremios('lf', ent, '2026-11-18T12:00:00Z').meses.find((m) => m.mes === '2026-09').recebido, 3);
  fs.rmSync(tmp2, { recursive: true, force: true });
});
