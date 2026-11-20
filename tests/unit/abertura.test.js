// Segunda validade do chá a granel: depois que o pacote de 1 kg vai para a lata, 6 meses para consumir.
// O painel deduz o pacote aberto pelo saldo, estima a data pelo ritmo de compra e guarda a primeira observação.
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abertura-'));
process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
const L = require('../../src/lotes');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const HOJE = '2026-11-20';
const estoque = (qtd, extra = []) => ({ em: HOJE + 'T08:00:00.000Z', itens: [{ cod: '10', desc: 'BERRY FIELD', un: 'Kg', qtd, custo: 100 }, ...extra] });
// compras.itens = { cod: [[dia, custo, nf, qtd]] }
const compras = (...ents) => ({ itens: { 10: ents.map(([dia, nf, qtd]) => [dia, 100, nf, qtd]) } });
const calc = (qtd, comp, edits = { lotes: {} }, extra) => L.calcular({ estoque: estoque(qtd, extra), compras: comp, edits, hoje: HOJE }).lotes;
const do_ = (ls, nf) => ls.find((l) => l.nf === String(nf));

test('pacotes: o que falta para um número inteiro de quilos está na lata; lote intocado fica todo fechado', () => {
  assert.deepStrictEqual(L.pacotesDoLote({ qtdEntrada: 3, saldo: 3 }), { n: 0, aberto: 0, fechado: 3 });
  assert.deepStrictEqual(L.pacotesDoLote({ qtdEntrada: 3, saldo: 2.4 }), { n: 1, aberto: 0.4, fechado: 2 });
  assert.deepStrictEqual(L.pacotesDoLote({ qtdEntrada: 3, saldo: 2 }), { n: 0, aberto: 0, fechado: 2 }, 'o 1º acabou e o 2º ainda não foi aberto');
  assert.deepStrictEqual(L.pacotesDoLote({ qtdEntrada: 3, saldo: 1.25 }), { n: 2, aberto: 0.25, fechado: 1 });
  assert.deepStrictEqual(L.pacotesDoLote({ qtdEntrada: 1, saldo: 0.05 }), { n: 1, aberto: 0.05, fechado: 0 });
  assert.strictEqual(L.pacotesDoLote({ qtdEntrada: null, saldo: 0.7 }).semNota, true);
});

test('três quilos do mesmo chá, de notas diferentes: o mais antigo é o aberto e os outros ganham a ordem de abertura', () => {
  // 3 notas de 1 kg; estoque 2,3 kg → saiu 0,7 kg do mais antigo
  const ls = calc(2.3, compras(['2026-06-10', 101, 1], ['2026-08-15', 102, 1], ['2026-10-20', 103, 1]));
  assert.strictEqual(ls.length, 3);
  const a = do_(ls, 101), b = do_(ls, 102), c = do_(ls, 103);
  assert.deepStrictEqual([a.pacoteN, a.aberto, a.fechado, a.abrirOrdem], [1, 0.3, 0, null]);
  assert.deepStrictEqual([b.pacoteN, b.fechado, b.abrirOrdem], [0, 1, 1], 'próximo a abrir');
  assert.deepStrictEqual([c.pacoteN, c.fechado, c.abrirOrdem], [0, 1, 2]);
  assert.strictEqual(b.abertoEm, null); assert.strictEqual(b.motivo, 'pacote');
  // uma nota com 3 pacotes: 1 na lata, 2 fechados no mesmo lote
  const um = calc(2.6, compras(['2026-09-01', 200, 3]))[0];
  assert.deepStrictEqual([um.pacoteN, um.aberto, um.fechado, um.abrirOrdem], [1, 0.6, 2, 1]);
});

test('data de abertura estimada pelo ritmo de compra; vale a data que chegar primeiro (pacote ou abertura + 6 meses)', () => {
  // compra 3 kg em 12 meses → 3/365 kg por dia; saíram 0,6 kg do pacote aberto → aberto há 73 dias
  const comp = compras(['2026-03-01', 101, 1], ['2026-05-01', 102, 1], ['2026-06-01', 103, 1]);
  const a = do_(calc(2.4, comp), 101);
  assert.strictEqual(a.abertoEm, '2026-09-08');
  assert.strictEqual(a.abertoEstimado, true);
  assert.strictEqual(a.validadeAberto, '2027-03-08');
  assert.strictEqual(a.validadePacote, '2027-03-01', 'pacote: 12 meses da entrada');
  // depois de aberto vale o "consumir até" (abertura + 6 meses), no lugar da validade da chegada (que é só o palpite de 12 meses)
  assert.deepStrictEqual([a.venceEm, a.motivo, a.kgVence, a.validadeAbertoEditada], ['2027-03-08', 'aberto', 0.4, false]);
  assert.strictEqual(a.dias, 108); assert.strictEqual(a.faixa, 'ok');
  // a validade digitada na chegada (mais curta ou mais longa) continua guardada, mas no chá aberto vale sempre abertura + 6 meses
  const b = do_(calc(2.4, comp, { lotes: { '101|10|2026-03-01': { validade: '2027-01-15' } } }), 101);
  assert.deepStrictEqual([b.validade, b.validadePacote, b.validadeAbertoPadrao, b.venceEm, b.motivo], ['2027-01-15', '2027-01-15', '2027-03-08', '2027-03-08', 'aberto']);
  assert.strictEqual(do_(calc(2.4, comp, { lotes: { '101|10|2026-03-01': { validade: '2028-01-01' } } }), 101).venceEm, '2027-03-08');
  // a equipe troca o "consumir até": vale o que ela digitou, mesmo depois da validade do pacote
  const c = do_(calc(2.4, comp, { lotes: {}, aberturas: { '101|10|2026-03-01#1': { dia: '2026-09-08', auto: true, ate: '2027-06-30', atePor: 'ana' } } }), 101);
  assert.deepStrictEqual([c.validadeAberto, c.validadeAbertoEditada, c.validadeAbertoPadrao, c.venceEm, c.abertoEstimado], ['2027-06-30', true, '2027-03-08', '2027-06-30', true]);
  // a estimativa nunca é anterior à chegada do pacote; sem histórico de compra, usa a chegada (pior caso)
  const novo = calc(0.2, compras(['2026-11-10', 300, 1]))[0];
  assert.strictEqual(novo.abertoEm, '2026-11-10');
});

test('chá parado: aberto há mais de 6 meses vence pela abertura mesmo com o pacote no prazo; o resumo conta só o que está na lata', () => {
  const comp = compras(['2026-02-01', 500, 2]);
  const edits = { lotes: {}, aberturas: { '500|10|2026-02-01#1': { dia: '2026-04-10', por: 'ana' } } };
  const l = calc(1.3, comp, edits)[0];
  assert.deepStrictEqual([l.abertoEm, l.abertoEstimado, l.abertoPor], ['2026-04-10', false, 'ana']);
  assert.deepStrictEqual([l.validadeAberto, l.motivo, l.faixa], ['2026-10-10', 'aberto', 'vencido']);
  assert.ok(l.dias < 0);
  assert.strictEqual(l.validade, '2027-02-01', 'a validade do pacote continua a mesma (os fechados seguem ela)');
  // lote com lata e pacote fechado: a validade mostrada é a do chá que está aberto
  const m = calc(1.3, comp, { lotes: { '500|10|2026-02-01': { validade: '2026-12-05' } }, aberturas: { '500|10|2026-02-01#1': { dia: '2026-11-01', por: 'ana' } } })[0];
  assert.deepStrictEqual([m.validadeAberto, m.venceEm, m.motivo, m.kgVence, m.fechado], ['2027-05-01', '2027-05-01', 'aberto', 0.3, 1]);
  const r = L.resumo([l]);
  assert.strictEqual(r.porFaixa.vencido.kg, 0.3, 'só os 300 g da lata; o pacote fechado não está vencido');
  assert.strictEqual(r.risco.custo, 30);
});

test('entrada e saída pelo AppNext: saída sai do mais antigo e abre o próximo; entrada sem nota vira saldo sem data', () => {
  const comp = compras(['2026-06-10', 101, 1], ['2026-08-15', 102, 1], ['2026-10-20', 103, 1]);
  // saída de 0,5 kg (perda ou ajuste): o estoque cai de 2,3 para 1,8 → o pacote da nota 101 acabou e o da 102 passa a ser o aberto
  let ls = calc(1.8, comp);
  assert.strictEqual(do_(ls, 101), undefined);
  assert.deepStrictEqual([do_(ls, 102).pacoteN, do_(ls, 102).aberto], [1, 0.8]);
  assert.deepStrictEqual([do_(ls, 103).abrirOrdem], [1]);
  // entrada sem nota (ajuste para cima): o que passa das notas vira "saldo sem nota", sem data de abertura
  ls = calc(3.5, comp);
  const semNota = ls.find((l) => l.chave === 'inicial|10');
  assert.strictEqual(semNota.saldo, 0.5); assert.strictEqual(semNota.abertoEm, null); assert.strictEqual(semNota.pacoteN, 0);
  assert.ok(ls.filter((l) => l.nf).every((l) => l.pacoteN === 0), 'os pacotes das notas voltam a contar como fechados');
});

test('a primeira observação guarda a data (não fica mudando); pacote que acabou é esquecido; a equipe pode corrigir', () => {
  const ES = require('../../src/estoque');
  const orig = { atual: ES.atual, compras: ES.compras };
  const comp = compras(['2026-03-01', 101, 1], ['2026-05-01', 102, 1], ['2026-06-01', 103, 1]);
  let qtd = 2.4;
  ES.atual = () => estoque(qtd); ES.compras = () => comp;
  try {
    assert.deepStrictEqual(L.observarAberturas('l1', HOJE), []);
    const arq = path.join(tmp, 'l1', 'validade', 'lotes.json');
    let reg = JSON.parse(fs.readFileSync(arq, 'utf8')).aberturas;
    assert.deepStrictEqual(Object.keys(reg), ['101|10|2026-03-01#1']);
    assert.strictEqual(reg['101|10|2026-03-01#1'].dia, '2026-09-08');
    // vendeu mais: a estimativa mudaria, mas a data guardada fica
    qtd = 2.1;
    L.observarAberturas('l1', HOJE);
    assert.strictEqual(L.daLoja('l1', HOJE).lotes.find((l) => l.nf === '101').abertoEm, '2026-09-08');
    // a equipe corrige: abriu em outra data
    assert.match(L.editarAbertura('l1', { chave: '101|10|2026-03-01', dia: '2027-01-01' }, 'ana', HOJE).erro, /futuro/);
    assert.match(L.editarAbertura('l1', { chave: '101|10|2026-03-01', dia: '2026-01-01' }, 'ana', HOJE).erro, /chegou em 01\/03\/2026/);
    assert.deepStrictEqual(L.editarAbertura('l1', { chave: '101|10|2026-03-01', dia: '2026-10-01' }, 'ana', HOJE).ok, { dia: '2026-10-01' });
    const l = L.daLoja('l1', HOJE).lotes.find((x) => x.nf === '101');
    assert.deepStrictEqual([l.abertoEm, l.abertoEstimado, l.abertoPor], ['2026-10-01', false, 'ana']);
    // o pacote acabou: o registro some e o próximo é observado
    qtd = 1.7;
    L.observarAberturas('l1', HOJE);
    reg = JSON.parse(fs.readFileSync(arq, 'utf8')).aberturas;
    assert.deepStrictEqual(Object.keys(reg), ['102|10|2026-05-01#1']);
    // aviso: pacote aberto que entrou nos últimos 30 dias do prazo sai uma vez só
    qtd = 1.7;
    L.editarAbertura('l1', { chave: '102|10|2026-05-01', dia: '2026-06-01' }, 'ana', HOJE); // aberto há 5 meses e 19 dias; pacote vale até 05/2027
    const perto = L.observarAberturas('l1', HOJE);
    assert.deepStrictEqual(perto.map((p) => [p.chave, p.n, p.desc, p.dias]), [['102|10|2026-05-01', 1, 'BERRY FIELD', 11]]);
    assert.deepStrictEqual(L.observarAberturas('l1', HOJE), [], 'não repete');
  } finally { ES.atual = orig.atual; ES.compras = orig.compras; }
});

test('"abri um pacote hoje": pacote aberto que ainda não vendeu nada (ou aberto fora da ordem) passa a contar na lata desde a data informada', () => {
  const ES = require('../../src/estoque');
  const orig = { atual: ES.atual, compras: ES.compras };
  const comp = compras(['2026-06-10', 101, 1], ['2026-08-15', 102, 2]);
  let qtd = 2; // o pacote da nota 101 acabou; os 2 da nota 102 estão fechados pelo estoque
  ES.atual = () => estoque(qtd); ES.compras = () => comp;
  try {
    let l = L.daLoja('l2', HOJE).lotes.find((x) => x.nf === '102');
    assert.deepStrictEqual([l.pacoteN, l.aberto, l.fechado, l.abrirOrdem], [0, 0, 2, 1]);
    // a loja abriu um pacote hoje
    assert.deepStrictEqual(L.editarAbertura('l2', { chave: l.chave, dia: HOJE }, 'ana', HOJE).ok, { dia: HOJE });
    l = L.daLoja('l2', HOJE).lotes.find((x) => x.nf === '102');
    assert.deepStrictEqual([l.pacoteN, l.aberto, l.fechado, l.abrirOrdem], [1, 1, 1, 1], '1 kg na lata, 1 pacote fechado');
    assert.deepStrictEqual([l.abertoEm, l.abertoEstimado, l.abertoPor, l.validadeAberto], [HOJE, false, 'ana', '2027-05-20']);
    assert.strictEqual(l.motivo, 'aberto', 'o pacote vale até 08/2027, mas aberto hoje vence em 05/2027');
    assert.strictEqual(l.kgVence, 1);
    // a data de vencimento depois de aberto também pode ser trocada (e voltar para a sugerida); a data de abertura continua a informada
    assert.match(L.editarAbertura('l2', { chave: l.chave, ate: '2026-01-01' }, 'bia', HOJE).erro, /Consumir até: entre 20\/11\/2026/);
    assert.deepStrictEqual(L.editarAbertura('l2', { chave: l.chave, ate: '2027-04-10' }, 'bia', HOJE).ok, { dia: HOJE, ate: '2027-04-10' });
    l = L.daLoja('l2', HOJE).lotes.find((x) => x.nf === '102');
    assert.deepStrictEqual([l.validadeAberto, l.validadeAbertoEditada, l.venceEm, l.abertoEm, l.abertoPor], ['2027-04-10', true, '2027-04-10', HOJE, 'ana']);
    L.editarAbertura('l2', { chave: l.chave, ate: '' }, 'bia', HOJE);
    l = L.daLoja('l2', HOJE).lotes.find((x) => x.nf === '102');
    assert.deepStrictEqual([l.validadeAberto, l.validadeAbertoEditada], ['2027-05-20', false]);
    // a atualização dos dados não apaga o que a equipe informou; quando vender, a data continua a mesma
    L.observarAberturas('l2', HOJE);
    qtd = 1.8;
    L.observarAberturas('l2', HOJE);
    l = L.daLoja('l2', HOJE).lotes.find((x) => x.nf === '102');
    assert.deepStrictEqual([l.pacoteN, l.aberto, l.fechado, l.abertoEm, l.abertoEstimado], [1, 0.8, 1, HOJE, false]);
    // desfazer a data informada com o pacote ainda inteiro: volta a contar como fechado
    qtd = 2;
    L.editarAbertura('l2', { chave: l.chave, dia: '' }, 'ana', HOJE);
    l = L.daLoja('l2', HOJE).lotes.find((x) => x.nf === '102');
    assert.deepStrictEqual([l.pacoteN, l.fechado], [0, 2]);
    // saldo sem nota não tem pacote para abrir
    qtd = 3.5;
    assert.match(L.editarAbertura('l2', { chave: 'inicial|10', dia: HOJE }, 'ana', HOJE).erro, /não tem pacote fechado para abrir/);
  } finally { ES.atual = orig.atual; ES.compras = orig.compras; }
});

test('"Abrir lote" com outro pacote do mesmo lote ainda na lata: os dois contam como abertos, cada um com a sua data e o seu vencimento', () => {
  const ES = require('../../src/estoque');
  const orig = { atual: ES.atual, compras: ES.compras };
  const comp = compras(['2026-11-18', 19218, 4]);
  let qtd = 3.45; // 450 g na lata + 3 pacotes fechados, tudo da mesma nota
  ES.atual = () => estoque(qtd); ES.compras = () => comp;
  try {
    let l = L.daLoja('l3', HOJE).lotes[0];
    assert.deepStrictEqual([l.abertos.length, l.abertos[0].n, l.abertos[0].kg, l.fechado, l.abrirOrdem], [1, 1, 0.45, 3, 1]);
    assert.deepStrictEqual([l.abertos[0].abertoEm, l.abertos[0].estimado, l.abertos[0].validade], ['2026-11-18', true, '2027-05-18']);
    // botão "Abrir lote": sem data = hoje; vencimento 6 meses depois
    assert.deepStrictEqual(L.editarAbertura('l3', { chave: l.chave, abrir: true }, 'ana', HOJE).ok, { dia: HOJE });
    l = L.daLoja('l3', HOJE).lotes[0];
    assert.deepStrictEqual(l.abertos.map((a) => [a.n, a.kg, a.abertoEm, a.estimado, a.por, a.validade]), [[1, 0.45, '2026-11-18', true, null, '2027-05-18'], [2, 1, HOJE, false, 'ana', '2027-05-20']]);
    assert.deepStrictEqual([l.aberto, l.fechado, l.saldo], [1.45, 2, 3.45]);
    assert.deepStrictEqual([l.venceEm, l.kgVence], ['2027-05-18', 0.45], 'o lote mostra o aberto que vence primeiro');
    // corrigir a data e o vencimento do 2º pacote aberto (pelo número dele), sem mexer no 1º
    assert.deepStrictEqual(L.editarAbertura('l3', { chave: l.chave, n: 2, dia: '2026-11-19' }, 'ana', HOJE).ok, { dia: '2026-11-19' });
    assert.deepStrictEqual(L.editarAbertura('l3', { chave: l.chave, n: 2, ate: '2027-04-30' }, 'ana', HOJE).ok, { dia: '2026-11-19', ate: '2027-04-30' });
    l = L.daLoja('l3', HOJE).lotes[0];
    assert.deepStrictEqual(l.abertos.map((a) => [a.n, a.abertoEm, a.validade, a.editada]), [[1, '2026-11-18', '2027-05-18', false], [2, '2026-11-19', '2027-04-30', true]]);
    assert.deepStrictEqual([l.venceEm, l.kgVence], ['2027-04-30', 1]);
    assert.match(L.editarAbertura('l3', { chave: l.chave, n: 9, dia: HOJE }, 'ana', HOJE).erro, /Pacote não encontrado/);
    // o 1º pacote acaba: o 2º continua aberto com a data que foi informada (não vira estimativa)
    L.observarAberturas('l3', HOJE);
    qtd = 2.8;
    L.observarAberturas('l3', HOJE);
    l = L.daLoja('l3', HOJE).lotes[0];
    assert.deepStrictEqual(l.abertos.map((a) => [a.n, a.kg, a.abertoEm, a.estimado]), [[2, 0.8, '2026-11-19', false]]);
    assert.strictEqual(l.fechado, 2);
    // abrir todos os que restam e tentar mais um
    L.editarAbertura('l3', { chave: l.chave, abrir: true }, 'ana', HOJE);
    L.editarAbertura('l3', { chave: l.chave, abrir: true }, 'ana', HOJE);
    l = L.daLoja('l3', HOJE).lotes[0];
    assert.deepStrictEqual([l.abertos.length, l.fechado, l.abrirOrdem], [3, 0, null]);
    assert.match(L.editarAbertura('l3', { chave: l.chave, abrir: true }, 'ana', HOJE).erro, /não tem pacote fechado para abrir/);
  } finally { ES.atual = orig.atual; ES.compras = orig.compras; }
});

