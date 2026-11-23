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
  // à mão: a 531 foi paga de outro jeito; o desconto da 19180 não é de devolução
  assert.ok(CF.acao('lj', { tipo: 'compensar', credito: por[531].id, como: 'outro', obs: 'pix 12/11' }, 'ger').ok);
  assert.ok(CF.acao('lj', { tipo: 'ignorar', nota: 'e4', obs: 'promoção' }, 'ger').ok);
  const y = CF.conta('lj', { saidas, compras, devsPainel: [], hoje: '2026-11-18T12:00:00Z' });
  const p2 = Object.fromEntries(y.creditos.map((c) => [c.numero, c]));
  assert.equal(p2[531].situacao, 'manual'); assert.equal(p2[531].compensado.como, 'outro');
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

test('revisão: desconto zerado no cabeçalho não esconde o dos itens; tolerância da combinação no máximo 10 centavos', () => {
  assert.strictEqual(CF.descontoDaNota({ desconto: 0, itens: [{ desc: 10.5 }, { desc: 4.5 }] }), 15);
  assert.strictEqual(CF.descontoDaNota({ desconto: 20, itens: [{ desc: 5 }] }), 20);
  assert.strictEqual(CF.descontoDaNota({ itens: [] }), null);
  const c = (id, valor) => ({ id, valor });
  const dez = Array.from({ length: 10 }, (_, k) => c('d' + k, 49.945));
  assert.deepEqual(CF.combinar(dez, 500).comb, [], '10 devoluções somando 499,45 não fecham sozinhas um desconto de 500,00');
  assert.strictEqual(CF.combinar([c('a', 99.97), c('b', 100)], 199.99).comb.length, 2, 'arredondamento de centavos ainda fecha');
});

test('revisão: devolução cancelada sai da conta; o que foi marcado à mão antes do XML continua valendo', () => {
  const devPainel = (id, numero) => ({ id, em: '2026-09-01', total: 100, nfe: { emitida: { numero, serie: 1 }, total: 100 }, nota: { id: 'e1', nf: '10', fornecedor: forn } });
  // XML cancelado com o número da devolução do painel: não volta como crédito
  const canc = { ...dev(901, '2026-09-01', 100, 'x'), situacao: 'cancelada' };
  assert.deepEqual(CF.creditos([canc], [], [devPainel('p1', 901)]), []);
  // marcado "compensado de outro jeito" antes do XML (id dev-p2); o XML chega e troca o id: segue compensado
  assert.ok(!CF.acao('lj', { tipo: 'compensar', credito: 'dev-p2', como: 'outro' }, 'dono').erro);
  const xml = dev(902, '2026-09-01', 100, 'x');
  const r = CF.conta('lj', { saidas: [xml], compras: [], devsPainel: [devPainel('p2', 902)], hoje: '2026-11-19' });
  const cr = r.creditos.find((x) => x.numero === 902);
  assert.strictEqual(cr.situacao, 'manual');
});

test('revisão: desconto nos royalties aceita "123.45" (teclado do celular) e "1.234,56"', () => {
  CF.royalties('lr', { ref: '2026-10', valor: '123.45' }, 'dono');
  CF.royalties('lr', { ref: '2026-10', valor: '1.234,56' }, 'dono');
  const j = JSON.parse(fs.readFileSync(path.join(tmp, 'lr', 'conta-franquia.json'), 'utf8'));
  assert.deepEqual(j.royalties.map((x) => x.valor), [123.45, 1234.56]);
});

// ---------- compensada à mão: em nota fiscal de entrada, nos royalties (mês da lista de 12) ou de outro jeito ----------
const HOJE_C = '2026-11-23';
const comprasC = () => [ent('c1', 19001, '2026-09-01', 0), ent('c2', 19050, '2026-09-20', 0), ent('c3', 19300, '2026-11-10', 0), { ...ent('c4', 4471, '2026-11-12', 0), fornecedor: 'EMBALAGENS LTDA' }];
const saidasC = (cs) => [dev(611, '2026-09-25', 80, cs[0].chave), dev(612, '2026-10-02', 45.5, cs[1].chave)];
const idsC = (loja, compras, saidas) => Object.fromEntries(CF.conta(loja, { saidas, compras, devsPainel: [], hoje: HOJE_C }).creditos.map((c) => [c.numero, c.id]));

test('FRQ-COMP-01: compensada em nota de entrada grava a ligação com a nota (como o vínculo automático) e as contas batem', () => {
  const compras = comprasC(), saidas = saidasC(compras);
  const antes = CF.conta('lc1', { saidas, compras, devsPainel: [], hoje: HOJE_C });
  const c611 = antes.creditos.find((c) => c.numero === 611);
  assert.equal(c611.situacao, 'atrasado');
  // a lista de notas para escolher vem na conta: as mais recentes primeiro, só o cabeçalho (sem itens)
  assert.deepEqual(antes.entradas.map((n) => n.id), ['c4', 'c3', 'c2', 'c1']);
  assert.deepEqual(Object.keys(antes.entradas[0]).sort(), ['desconto', 'emissao', 'entrada', 'fornecedor', 'id', 'nf', 'total']);
  assert.equal(antes.mesesRoyalties.length, 12);
  assert.ok(CF.acao('lc1', { tipo: 'compensar', credito: c611.id, como: 'nota', nota: 'c3', obs: 'conferido' }, 'dono', { compras, hoje: HOJE_C }).ok);
  const j = JSON.parse(fs.readFileSync(path.join(tmp, 'lc1', 'conta-franquia.json'), 'utf8'));
  assert.equal(j.manual[c611.id].nota, 'c3', 'grava o id da nota, igual ao "ligar"');
  const x = CF.conta('lc1', { saidas, compras, devsPainel: [], hoje: HOJE_C });
  const c = x.creditos.find((y) => y.numero === 611);
  assert.equal(c.situacao, 'manual');
  assert.deepEqual([c.compensado.como, c.compensado.nota.id, c.compensado.nota.nf], ['nota', 'c3', 19300]);
  assert.equal(x.resumo.compensado, 80);
  assert.equal(x.resumo.atrasado, 45.5);
  assert.equal(x.resumo.compensado + x.resumo.atrasado + x.resumo.aberto + x.resumo.confirmar, 125.5, 'compensado × aberto somam o total');
});

test('FRQ-COMP-01: nota fora do painel — o número digitado fica guardado; se for de uma nota da loja, liga à nota', () => {
  const compras = comprasC(), saidas = saidasC(compras), ids = idsC('lc2', compras, saidas);
  assert.ok(CF.acao('lc2', { tipo: 'compensar', credito: ids[611], como: 'nota', nf: ' 20.555 ' }, 'dono', { compras, hoje: HOJE_C }).ok);
  assert.ok(CF.acao('lc2', { tipo: 'compensar', credito: ids[612], como: 'nota', nf: '000019300' }, 'dono', { compras, hoje: HOJE_C }).ok);
  const x = CF.conta('lc2', { saidas, compras, devsPainel: [], hoje: HOJE_C });
  const por = Object.fromEntries(x.creditos.map((c) => [c.numero, c]));
  assert.deepEqual([por[611].situacao, por[611].compensado.como, por[611].compensado.nf, por[611].compensado.nota], ['manual', 'nota', '20.555', null]);
  assert.equal(por[612].compensado.nota.id, 'c3', '"000019300" é a NF 19300 da loja');
  assert.equal(x.resumo.compensado, 125.5);
});

test('FRQ-COMP-02: compensada nos royalties grava o mês AAAA-MM, só entre o mês atual e os 11 anteriores', () => {
  assert.deepEqual(CF.mesesRoyalties('2026-11-23'), ['2026-11', '2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01', '2025-12']);
  assert.equal(CF.mesesRoyalties('2026-01-05')[11], '2025-02');
  const compras = comprasC(), saidas = saidasC(compras), ids = idsC('lc3', compras, saidas), ctx = { compras, hoje: HOJE_C };
  for (const mes of ['2025-11', '2026-12', '2026-13', '2026-1', '', 'novembro']) assert.match(CF.acao('lc3', { tipo: 'compensar', credito: ids[611], como: 'royalties', mes }, 'dono', ctx).erro || '', /últimos 12 meses/, mes);
  assert.ok(CF.acao('lc3', { tipo: 'compensar', credito: ids[611], como: 'royalties', mes: '2025-12' }, 'dono', ctx).ok);
  assert.ok(CF.acao('lc3', { tipo: 'compensar', credito: ids[612], como: 'royalties', mes: '2026-11' }, 'dono', ctx).ok);
  const x = CF.conta('lc3', { saidas, compras, devsPainel: [], hoje: HOJE_C });
  const por = Object.fromEntries(x.creditos.map((c) => [c.numero, c]));
  assert.deepEqual([por[611].situacao, por[611].compensado.como, por[611].compensado.mes], ['manual', 'royalties', '2025-12']);
  assert.equal(por[612].compensado.mes, '2026-11');
  assert.equal(x.resumo.compensado, 125.5);
});

test('FRQ-COMP-03: o servidor recusa o que não confere (nota que não é da loja, NF longa ou sem número, jeito desconhecido) e não grava', () => {
  const compras = comprasC(), ctx = { compras, hoje: HOJE_C };
  const e = (b) => CF.acao('lc4', { tipo: 'compensar', credito: 'dev-abc', ...b }, 'dono', ctx).erro || '';
  assert.match(e({ como: 'nota', nota: 'outra-loja' }), /não está no painel/);
  assert.match(e({ como: 'nota' }), /Escolha a nota/);
  assert.match(e({ como: 'nota', nf: '1'.repeat(21) }), /inválido/);
  assert.match(e({ como: 'nota', nf: 'sem número' }), /inválido/);
  assert.match(e({ como: 'nota', nf: '<b>12</b>' }), /inválido/);
  assert.match(e({ como: 'boleto' }), /como a devolução foi compensada/, '"no boleto" saiu (agora é "em nota fiscal de entrada")');
  assert.match(CF.acao('lc4', { tipo: 'compensar', credito: '../x', como: 'outro' }, 'dono', ctx).erro, /inválido/);
  assert.ok(!fs.existsSync(path.join(tmp, 'lc4', 'conta-franquia.json')), 'nada gravado');
  // de outro jeito continua como estava
  assert.ok(CF.acao('lc4', { tipo: 'compensar', credito: 'dev-abc', como: 'outro', obs: 'Depósito / Pix' }, 'dono', ctx).ok);
});

test('FRQ-COMP-05: registros antigos (boleto e royalties em texto livre) continuam aparecendo como compensados, com o texto', () => {
  const compras = comprasC(), saidas = saidasC(compras), ids = idsC('lc5', compras, saidas);
  fs.mkdirSync(path.join(tmp, 'lc5'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'lc5', 'conta-franquia.json'), JSON.stringify({ manual: {
    [ids[611]]: { como: 'boleto', obs: 'boleto 12/11', por: 'dono', em: '2026-11-12T10:00:00Z' },
    [ids[612]]: { como: 'royalties', obs: 'outubro', por: 'dono', em: '2026-11-12T10:00:00Z' } } }));
  const x = CF.conta('lc5', { saidas, compras, devsPainel: [], hoje: HOJE_C });
  const por = Object.fromEntries(x.creditos.map((c) => [c.numero, c]));
  assert.deepEqual([por[611].situacao, por[611].compensado.como, por[611].compensado.obs, por[611].compensado.mes], ['manual', 'boleto', 'boleto 12/11', null]);
  assert.deepEqual([por[612].compensado.como, por[612].compensado.obs, por[612].compensado.mes], ['royalties', 'outubro', null]);
  assert.equal(x.resumo.compensado, 125.5);
});

test('FRQ-COMP-06: marcar em nota que já tinha devolução compensada sozinha (valor exato) mantém a outra nela', () => {
  const compras = comprasC(); compras[2].desconto = 80; // a 19300 trouxe o desconto exato da 611
  const saidas = saidasC(compras);
  const antes = CF.conta('lc6', { saidas, compras, devsPainel: [], hoje: HOJE_C });
  assert.equal(antes.notas.find((y) => y.id === 'c3').situacao, 'compensou');
  const c612 = antes.creditos.find((c) => c.numero === 612);
  const jaNaNota = (id) => { const k = antes.notas.find((y) => y.id === id); return k && k.situacao === 'compensou' ? k.creditos : []; };
  assert.ok(CF.acao('lc6', { tipo: 'compensar', credito: c612.id, como: 'nota', nota: 'c3' }, 'dono', { compras, hoje: HOJE_C, jaNaNota }).ok);
  const x = CF.conta('lc6', { saidas, compras, devsPainel: [], hoje: HOJE_C });
  assert.deepEqual(x.creditos.map((c) => [c.numero, c.situacao, c.compensado && c.compensado.nota.id]).sort(), [[611, 'manual', 'c3'], [612, 'manual', 'c3']]);
  assert.equal(x.notas.find((y) => y.id === 'c3').creditos.length, 2);
});

test('RES-ROY-01: descontos da franquia nos royalties por mês de referência (devolução com mês + prêmios de fidelidade); texto antigo sem mês fica de fora', () => {
  CF.royalties('rr', { ref: '2026-10', premios: '2026-09', valor: '96.20' }, 'dono');
  const creditos = [
    { id: 'a', numero: 1234, valor: 184.5, compensado: { como: 'royalties', mes: '2026-10' } },
    { id: 'b', numero: 1300, valor: 50, compensado: { como: 'royalties', mes: null, obs: 'royalties de outubro' } }, // antigo, sem mês
    { id: 'c', numero: 1301, valor: 70, compensado: { como: 'nota', nota: { id: 'x', nf: 9 } } }, // em nota de entrada: não mexe nos royalties
    { id: 'd', numero: 1302, valor: 30, compensado: null },
  ];
  const r = CF.descontosRoyalties('rr', creditos);
  assert.deepStrictEqual(Object.keys(r.porMes), ['2026-10']);
  assert.deepStrictEqual(r.porMes['2026-10'].map((x) => [x.origem, x.valor]), [['devolucao', 184.5], ['fidelidade', 96.2]]);
  assert.match(r.porMes['2026-10'][0].texto, /devolução NF 1234/);
  assert.match(r.porMes['2026-10'][1].texto, /prêmios de fidelidade de 2026-09/);
  assert.deepStrictEqual(r.semMes.map((x) => x.valor), [50]);
});
