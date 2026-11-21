// Confiança nos dados: conferência do faturamento com o fechamento do caixa, cupons cancelados e saúde dos dados.
const { test } = require('node:test');
const assert = require('node:assert');
const CF = require('../../public/js/conferencia');
const CT = require('../../public/js/contas');

const v = (data, cupom, vt, o = {}) => ({ data, cupom, loja: 'L', vendedor: 'ANA', descricao: 'Chá X 50G', vu: vt, vt, qtd: 1, grupoC: 'CHÁ AROMATIZADO', cat: '', ...o });

test('painel por dia usa a definição oficial: taxa e item a R$ 0,01 ficam fora do faturamento, sem vendedor fica dentro', () => {
  const vendas = [v('2026-05-10', 1, 100), v('2026-05-10', 1, 12, { descricao: 'Taxa de Serviço' }), v('2026-05-10', 2, 0.01, { vu: 0.01 }),
    v('2026-05-10', 3, 40, { vendedor: '' }), v('2026-05-10', 4, 60, { vendedor: 'CORPORATIVO' }), v('2026-05-11', 5, 30)];
  const p = CF.painelPorDia(vendas, '2026-05-10', '2026-05-10');
  assert.strictEqual(p.size, 1);
  const d = p.get('2026-05-10');
  assert.deepStrictEqual(d, { fat: 200, taxas: 12, centavos: 0.01, semVendedor: 40, foraLoja: 60, cupons: 3 });
  assert.strictEqual(d.fat, CT.resumo(vendas.filter((x) => x.data === '2026-05-10')).fat, 'o mesmo faturamento de TS.contas');
});

test('conferência do dia: bate dentro da tolerância (padrão R$ 1,00) e não bate fora dela', () => {
  const painel = { fat: 1000, taxas: 0, centavos: 0, semVendedor: 0, foraLoja: 0 };
  const a = CF.conferirDia({ dia: '2026-05-10', painel, caixa: { total: 1000.8 }, hoje: '2026-05-12' });
  assert.strictEqual(a.estado, 'bate'); assert.strictEqual(a.dif, 0.8);
  const b = CF.conferirDia({ dia: '2026-05-10', painel, caixa: { total: 1037.9 }, hoje: '2026-05-12' });
  assert.strictEqual(b.estado, 'naobate'); assert.strictEqual(b.dif, 37.9); assert.strictEqual(b.cod, 'caixamaior');
  assert.ok(Math.abs(b.pct - 0.0379) < 1e-9);
  const c = CF.conferirDia({ dia: '2026-05-10', painel, caixa: { total: 950 }, hoje: '2026-05-12' });
  assert.strictEqual(c.estado, 'naobate'); assert.strictEqual(c.cod, 'painelmaior'); assert.strictEqual(c.dif, -50);
  // tolerância configurável
  assert.strictEqual(CF.conferirDia({ dia: '2026-05-10', painel, caixa: { total: 1037.9 }, tolerancia: 40 }).estado, 'bate');
  assert.strictEqual(CF.conferirDia({ dia: '2026-05-10', painel, caixa: { total: 1000.8 }, tolerancia: 0.5 }).estado, 'naobate');
});

test('classificação da diferença: taxa de serviço, itens a R$ 0,01, venda fora do caixa e cancelado explicam; a menor combinação vale', () => {
  const base = { fat: 1000, taxas: 55, centavos: 0.03, semVendedor: 120, foraLoja: 300, cancelados: 80 };
  const c = (total, extra) => CF.conferirDia({ dia: '2026-05-10', painel: { ...base, ...extra }, caixa: { total } });
  let r = c(1055);
  assert.strictEqual(r.estado, 'explicado'); assert.strictEqual(r.cod, 'taxa'); assert.match(r.motivo, /taxa de serviço/);
  r = c(1055.03, {});
  assert.strictEqual(r.estado, 'explicado'); assert.strictEqual(r.cod, 'taxa', 'os centavos cabem na tolerância: a explicação mais simples vale');
  r = c(880);
  assert.strictEqual(r.cod, 'semvendedor'); assert.match(r.motivo, /sem vendedor/);
  r = c(700);
  assert.strictEqual(r.cod, 'fora');
  r = c(920);
  assert.strictEqual(r.cod, 'cancelado'); assert.match(r.motivo, /cancelados/);
  r = c(1000 + 55 - 300);
  assert.strictEqual(r.estado, 'explicado'); assert.strictEqual(r.cod, 'taxa+fora');
  r = c(1000 + 23);
  assert.strictEqual(r.estado, 'naobate', 'diferença que nenhuma parte explica continua "não bate"');
  // centavos acima da tolerância explicam sozinhos
  r = CF.conferirDia({ dia: '2026-05-10', painel: { fat: 500, taxas: 0, centavos: 0.3 }, caixa: { total: 500.3 }, tolerancia: 0.1 });
  assert.strictEqual(r.cod, 'centavo');
});

test('casos de borda: dia sem fechamento (hoje × dia passado), caixa sem vendas no painel e dia zerado', () => {
  const p = { fat: 500, taxas: 0, centavos: 0 };
  const hoje = CF.conferirDia({ dia: '2026-05-12', painel: p, caixa: null, hoje: '2026-05-12' });
  assert.strictEqual(hoje.estado, 'semfechamento'); assert.strictEqual(hoje.cod, 'hoje'); assert.strictEqual(hoje.dif, null);
  const passado = CF.conferirDia({ dia: '2026-05-10', painel: p, caixa: null, hoje: '2026-05-12' });
  assert.strictEqual(passado.cod, 'semleitura');
  const semVendas = CF.conferirDia({ dia: '2026-05-10', painel: null, caixa: { total: 800 }, hoje: '2026-05-12' });
  assert.strictEqual(semVendas.estado, 'naobate'); assert.strictEqual(semVendas.cod, 'semvendas'); assert.strictEqual(semVendas.pct, null);
  assert.strictEqual(CF.conferirDia({ dia: '2026-05-10', painel: null, caixa: { total: 0 } }).estado, 'bate');
  // faturamento zero com caixa: sem divisão por zero
  const z = CF.conferirDia({ dia: '2026-05-10', painel: { fat: 0, taxas: 0, centavos: 0 }, caixa: { total: 50 } });
  assert.strictEqual(z.pct, null); assert.strictEqual(z.estado, 'naobate');
});

test('período: só dias com venda ou caixa; caixa fechado depois da meia-noite vira "bate com explicação" nos dois dias', () => {
  const painel = new Map([['2026-05-01', { fat: 1000, taxas: 0, centavos: 0, cupons: 10 }], ['2026-05-02', { fat: 800, taxas: 0, centavos: 0, cupons: 8 }],
    ['2026-05-04', { fat: 600, taxas: 0, centavos: 0, cupons: 6 }], ['2026-05-05', { fat: 700, taxas: 0, centavos: 0, cupons: 7 }], ['2026-05-06', { fat: 300, taxas: 0, centavos: 0, cupons: 3 }]]);
  const caixas = new Map([['2026-05-01', { total: 880 }], ['2026-05-02', { total: 920 }], ['2026-05-04', { total: 640 }], ['2026-05-05', { total: 700 }]]);
  const l = CF.conferir({ de: '2026-04-28', ate: '2026-05-06', painel, caixas, hoje: '2026-05-06' });
  assert.deepStrictEqual(l.map((x) => x.dia), ['2026-05-06', '2026-05-05', '2026-05-04', '2026-05-02', '2026-05-01'], 'do mais novo para o mais antigo, sem o dia 3 (nada)');
  const por = Object.fromEntries(l.map((x) => [x.dia, x]));
  assert.strictEqual(por['2026-05-01'].estado, 'explicado'); assert.strictEqual(por['2026-05-01'].cod, 'virada');
  assert.strictEqual(por['2026-05-02'].estado, 'explicado'); assert.match(por['2026-05-02'].motivo, /depois da meia-noite/);
  assert.strictEqual(por['2026-05-04'].estado, 'naobate', '+40 sem par: não bate');
  assert.strictEqual(por['2026-05-05'].estado, 'bate');
  assert.strictEqual(por['2026-05-06'].estado, 'semfechamento');
  const r = CF.resumo(l);
  assert.deepStrictEqual({ bate: r.bate, explicado: r.explicado, naobate: r.naobate, semfechamento: r.semfechamento, total: r.total }, { bate: 1, explicado: 2, naobate: 1, semfechamento: 1, total: 5 });
  assert.strictEqual(r.somaNaoBate, 40); assert.deepStrictEqual(r.maior, { dia: '2026-05-04', dif: 40 });
  // aviso do Início: só dias dos últimos 7, sem contar hoje
  assert.deepStrictEqual(CF.recentesQueNaoBatem(l, '2026-05-06').map((x) => x.dia), ['2026-05-04']);
  assert.deepStrictEqual(CF.recentesQueNaoBatem(l, '2026-05-20'), []);
  // dia sem fechamento + dia seguinte com o caixa dos dois = virada
  const l2 = CF.conferir({ de: '2026-05-01', ate: '2026-05-03', hoje: '2026-05-09',
    painel: new Map([['2026-05-01', { fat: 500, taxas: 0, centavos: 0 }], ['2026-05-02', { fat: 400, taxas: 0, centavos: 0 }]]), caixas: new Map([['2026-05-02', { total: 900 }]]) });
  assert.deepStrictEqual(l2.map((x) => x.cod), ['virada', 'virada']);
  assert.deepStrictEqual(CF.conferir({ de: '2026-05-01', ate: '2026-05-03', painel: new Map(), caixas: new Map(), hoje: '2026-05-09' }), []);
});

test('formas de pagamento e sobras/faltas de caixa por operador e dia da semana', () => {
  const caixas = [
    { dia: '2026-05-04', diferenca: -12, operadores: ['Ana'], formas: [{ rot: 'Pix', valor: 300 }, { rot: 'Dinheiro', valor: 100 }] }, // segunda
    { dia: '2026-05-05', diferenca: 0.5, operadores: ['Ana'], formas: [{ rot: 'Pix', valor: 200 }, { rot: 'Troca', valor: 0 }] },
    { dia: '2026-05-11', diferenca: -8, operadores: ['Ana'], formas: [{ rot: 'Pix', valor: 100 }] }, // segunda
    { dia: '2026-05-12', diferenca: 5, operadores: ['Bia', 'Bia'], formas: [] },
    { dia: '2026-05-18', diferenca: -20, operadores: ['Ana'], formas: [] }, // segunda
  ];
  const f = CF.formasPeriodo(caixas);
  assert.deepStrictEqual(f.map((x) => [x.rot, x.valor]), [['Pix', 600], ['Dinheiro', 100]]);
  assert.ok(Math.abs(f[0].pct - 600 / 700) < 1e-9);
  assert.deepStrictEqual(CF.formasPeriodo([]), []);
  const s = CF.sobrasFaltas(caixas, 1);
  assert.deepStrictEqual({ dias: s.dias, sobras: s.sobras, faltas: s.faltas, saldo: s.saldo }, { dias: 5, sobras: { n: 1, valor: 5 }, faltas: { n: 3, valor: -40 }, saldo: -35 });
  const ana = s.porOperador.find((x) => x.nome === 'Ana');
  assert.deepStrictEqual({ dias: ana.dias, faltas: ana.faltas, vFaltas: ana.vFaltas, saldo: ana.saldo, recorrente: ana.recorrente }, { dias: 4, faltas: 3, vFaltas: -40, saldo: -40, recorrente: true });
  assert.strictEqual(s.porOperador.find((x) => x.nome === 'Bia').recorrente, false);
  assert.strictEqual(s.porSemana[1].faltas, 3, 'as três faltas caem na segunda');
  assert.strictEqual(s.porSemana[2].sobras, 1);
  assert.strictEqual(CF.sobrasFaltas([], 1).saldo, 0);
});

test('cupons cancelados: marca o que ainda está nas vendas, soma o impacto (faturamento e base da comissão) por dia e por vendedor', () => {
  const vendas = [
    v('2026-05-10', 501, 100), v('2026-05-10', 501, 30, { grupoC: 'ESPAÇO GOURMET' }), v('2026-05-10', 501, 10, { descricao: 'Taxa de Serviço' }),
    v('2026-05-11', 502, 80, { vendedor: 'BIA' }), // nota do dia 10 (venda perto da meia-noite): casa pelo dia vizinho
    v('2026-05-20', 501, 999, { vendedor: 'CAIO' }), // o mesmo número em outro dia: não é o cancelado
    v('2026-05-10', 600, 50),
  ];
  const notas = [{ dia: '2026-05-10', numero: 501, mod: '65', valor: 140 }, { dia: '2026-05-10', numero: 502, mod: '65', valor: 80 }, { dia: '2026-05-12', numero: 777, mod: '65', valor: 45.5 },
    { dia: '2026-01-01', numero: 600, mod: '65', valor: 50 }];
  const c = CF.cancelados({ notas, vendas, de: '2026-05-01', ate: '2026-05-31' });
  assert.strictEqual(c.lista.length, 3, 'a nota de janeiro está fora do período');
  assert.deepStrictEqual(c.total, { cupons: 3, valor: 265.5 });
  assert.deepStrictEqual(c.impacto, { cupons: 2, valor: 210, valorMeta: 180 }, '130 (sem a taxa) + 80; na comissão só o que conta para a meta');
  const n501 = c.lista.find((x) => x.numero === 501);
  assert.deepStrictEqual({ nasVendas: n501.nasVendas, valorVendas: n501.valorVendas, valorMeta: n501.valorMeta, vendedores: n501.vendedores }, { nasVendas: true, valorVendas: 130, valorMeta: 100, vendedores: ['ANA'] });
  assert.strictEqual(c.lista.find((x) => x.numero === 777).nasVendas, false);
  assert.deepStrictEqual(c.porDia.find((d) => d.dia === '2026-05-10'), { dia: '2026-05-10', cupons: 2, valor: 220, aindaConta: 210, cuponsConta: 2 });
  assert.deepStrictEqual(c.porVendedor.map((x) => [x.vendedor, x.cupons, x.aindaConta, x.valorMeta]), [['ANA', 1, 130, 100], ['BIA', 1, 80, 80], ['(fora da planilha de vendas)', 1, 0, 0]]);
  // nada cancelado
  const z = CF.cancelados({ notas: [], vendas, de: '2026-05-01', ate: '2026-05-31' });
  assert.deepStrictEqual([z.lista, z.impacto], [[], { cupons: 0, valor: 0, valorMeta: 0 }]);
});

test('tirar cancelados das vendas (opção da loja): só NFC-e, mesmo número e dia (ou vizinho); o resto fica igual', () => {
  const vendas = [v('2026-05-10', 501, 100), v('2026-05-10', 501, 30), v('2026-05-11', 502, 80), v('2026-05-20', 501, 999), v('2026-05-10', 600, 50), v('2026-05-10', 700, 70)];
  const notas = [{ dia: '2026-05-10', numero: 501, mod: '65' }, { dia: '2026-05-10', numero: 502, mod: '65' }, { dia: '2026-05-10', numero: 700, mod: '55' }, { dia: '2026-05-12', numero: 777, mod: '65' }];
  const r = CF.semCancelados(vendas, notas);
  assert.deepStrictEqual(r.fora.map((x) => [x.data, x.cupom, x.vt]), [['2026-05-10', 501, 100], ['2026-05-10', 501, 30], ['2026-05-11', 502, 80]]);
  assert.deepStrictEqual(r.vendas.map((x) => x.cupom), [501, 600, 700], 'o 501 de outro dia e a NF-e (55) continuam');
  // antes × depois no faturamento
  assert.strictEqual(CT.resumo(vendas).fat, 1329); assert.strictEqual(CT.resumo(r.vendas).fat, 1119);
  const igual = CF.semCancelados(vendas, []);
  assert.strictEqual(igual.vendas, vendas); assert.deepStrictEqual(igual.fora, []);
});

test('linhas negativas da planilha (estornos) por dia e por vendedor', () => {
  const n = CF.negativas([v('2026-05-10', 1, 100), v('2026-05-10', 2, -40), v('2026-05-11', 3, -10, { vendedor: '' }), v('2026-04-01', 4, -99)], '2026-05-01', '2026-05-31');
  assert.deepStrictEqual({ linhas: n.linhas, valor: n.valor }, { linhas: 2, valor: -50 });
  assert.deepStrictEqual(n.porVendedor, [{ vendedor: 'ANA', valor: -40 }, { vendedor: '(sem vendedor)', valor: -10 }]);
  assert.strictEqual(CF.negativas([], '2026-05-01', '2026-05-31').linhas, 0);
});

test('saúde dos dados: casamento por código × nome × não casado, vendas sem custo e sinal das fontes', () => {
  const s = CF.casamento([
    { vt: 600, via: 'código', temCusto: true, nome: 'A', cod: '1' }, { vt: 200, via: 'nome', temCusto: true, nome: 'B', cod: '' },
    { vt: 100, via: 'nome', temCusto: false, nome: 'C', cod: '' }, { vt: 60, via: null, temCusto: false, nome: 'D', cod: '9' }, { vt: 40, via: null, temCusto: false, nome: 'D', cod: '9' }]);
  assert.deepStrictEqual({ fat: s.fat, codigo: s.codigo, nome: s.nome, semProduto: s.semProduto, semCusto: s.semCusto }, { fat: 1000, codigo: 600, nome: 300, semProduto: 100, semCusto: 200 });
  assert.deepStrictEqual([s.pctCodigo, s.pctNome, s.pctSemProduto, s.pctSemCusto], [0.6, 0.3, 0.1, 0.2]);
  assert.deepStrictEqual(s.naoCasados, [{ nome: 'D', cod: '9', vt: 100, linhas: 2 }]);
  assert.deepStrictEqual(s.semCustoLista, [{ nome: 'C', cod: '', vt: 100, linhas: 1 }]);
  const vazio = CF.casamento([]);
  assert.strictEqual(vazio.pctCodigo, null); assert.deepStrictEqual(vazio.naoCasados, []);
  const agora = Date.parse('2026-05-10T12:00:00Z');
  assert.strictEqual(CF.sinalFonte({ em: '2026-05-10T02:00:00Z' }, agora).sinal, 'verde');
  assert.strictEqual(CF.sinalFonte({ em: '2026-05-08T10:00:00Z' }, agora).sinal, 'amarelo');
  const velho = CF.sinalFonte({ em: '2026-05-01T12:00:00Z' }, agora);
  assert.deepStrictEqual([velho.sinal, velho.idade], ['vermelho', 'há 9 dias']);
  assert.deepStrictEqual(CF.sinalFonte({ em: null }, agora), { sinal: 'cinza', horas: null, idade: 'nunca' });
  assert.strictEqual(CF.sinalFonte({ em: 'data ruim' }, agora).sinal, 'cinza');
});

test('CONF-DEMO-01: na apresentação o exemplo de caixa fechado depois da meia-noite aparece em qualquer data (dois dias seguidos, sem taxa)', () => {
  // já falhou na virada do dia: o exemplo usava sempre o 10º e o 11º dia de venda, que em certas datas não eram vizinhos ou tinham taxa
  const DEMO = require('../../src/demo'), CF = require('../../src/conferencia'), IND = require('../../src/indicadores');
  const partes = DEMO.partes(), base = Date.parse(IND.hojeSP().iso + 'T12:00:00Z');
  const ruins = [];
  for (let i = 0; i < 60; i++) {
    const hoje = new Date(base - i * 864e5).toISOString().slice(0, 10);
    for (const p of partes) {
      const v = CF.demo(p, hoje).lista.filter((x) => x.cod === 'virada');
      if (v.length !== 2 || !/depois da meia-noite/.test(v[0].motivo)) ruins.push(`${hoje} ${p.id}`);
    }
  }
  assert.deepStrictEqual(ruins, []);
});
