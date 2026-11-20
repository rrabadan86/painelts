'use strict';
/* Contas oficiais (public/js/contas.js) e as regras que definem comissão e resultado:
   definição única de faturamento e atendimento, base da meta, projeção do mês, quem divide a meta (piso),
   bônus, comissão projetada, ponto de equilíbrio e mínimo de atendimentos da premiação.
   Cada teste traz o exemplo numérico do "antes × depois". */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CT = require('../../public/js/contas');
const I = require('../../src/indicadores');

const LOJA = 'LOJA TESTE';
const CAT_AROM = 'Chás aromatizados, Chás, Rooibos e Infusões Aromatizados, LOJA';
/** linha de venda como o servidor guarda */
const venda = (data, cupom, vendedor, vt, x = {}) => ({
  data, cupom, loja: LOJA, vendedor, vt, qtd: 1, vu: vt, du: 0, qtdCha: 0, soNumeros: null, min: null, cod: '',
  descricao: 'Chá Preto 50G', produto: 'Chá Preto', grupo: 'CHÁ PRETO AROMATIZADO', grupoC: 'CHÁ AROMATIZADO', cat: CAT_AROM, ...x,
});
const ACESS = { descricao: 'Infusor', produto: 'Infusor', grupo: 'ACESSÓRIOS', grupoC: 'ACESSÓRIOS', cat: 'Acessórios, LOJA' };
const EG = { descricao: 'Chá da casa', produto: 'Chá da casa', grupo: 'ESPAÇO GOURMET', grupoC: 'ESPAÇO GOURMET', cat: 'ESPAÇO GOURMET' };
const OUTRO = { descricao: 'Livro', produto: 'Livro', grupo: 'LIVROS', grupoC: 'LIVROS', cat: 'Livros, LOJA' };

/** as telas no Node: os mesmos arquivos do navegador (core.js, contas.js, rules.js) sobre um pacote de dados montado das linhas */
function tela(linhas, { regras, ferias } = {}) {
  const dict = { loja: [], vendedor: [], descricao: [], produto: [], grupo: [], grupoC: [], cat: [] };
  const id = (campo, t) => { let i = dict[campo].indexOf(t); if (i < 0) { dict[campo].push(t); i = dict[campo].length - 1; } return i; };
  const v = { data: [], cupom: [], min: [], qtd: [], soNumeros: [], qtdCha: [], vu: [], du: [], vt: [], loja: [], vendedor: [], cod: [], descricao: [], produto: [], grupo: [], grupoC: [], cat: [] };
  for (const l of linhas) {
    for (const k of ['data', 'cupom', 'min', 'qtd', 'soNumeros', 'qtdCha', 'vu', 'du', 'vt', 'cod']) v[k].push(l[k]);
    for (const k of ['loja', 'vendedor', 'descricao', 'produto', 'grupo', 'grupoC', 'cat']) v[k].push(id(k, l[k]));
  }
  const ctx = vm.createContext({ console });
  vm.runInContext("var window = globalThis; var location = { pathname: '/', hash: '' };", ctx);
  for (const f of ['core.js', 'contas.js', 'rules.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/js', f), 'utf8'), ctx, { filename: f });
  ctx.__raw = JSON.stringify({ vendas: v, dict, metas: [{ id: 'teste', nomesVenda: [LOJA], padrao: 0, ...(regras ? { regras } : {}), ...(ferias ? { ferias } : {}) }] });
  vm.runInContext('TS.db = TS.decode(JSON.parse(__raw)); TS.rules.prepare();', ctx);
  return vm.runInContext('TS', ctx);
}
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg || ''} esperado ${b}, veio ${a}`);

// ======================= definição única de faturamento e atendimento =======================
const DIA1 = [
  venda('2026-10-05', 1, 'ANA', 100, { qtdCha: 0.05 }),
  venda('2026-10-05', 1, 'BIA', 60, ACESS),                                  // o MESMO cupom, outra vendedora
  venda('2026-10-05', 2, 'ANA', 40, EG),                                     // Espaço Gourmet: entra no faturamento
  venda('2026-10-05', 2, 'ANA', 4, { ...EG, descricao: 'Taxa de Serviço' }), // taxa: fora
  venda('2026-10-05', 3, 'SEM VENDEDOR', 30, ACESS),                         // sem vendedor: entra
  venda('2026-10-05', 3, 'SEM VENDEDOR', 0.01, { vu: 0.01, descricao: 'Chá Preto 50G Fidelidade' }), // resgate a R$ 0,01: fora
  venda('2026-10-05', 4, 'BIA', 50, { grupo: 'CHÁ AMARELO', qtdCha: 0.1 }),  // chá amarelo: conta no kg
  venda('2026-10-05', 5, 'BIA', 12, { descricao: 'Taxa Delivery', grupoC: 'OUTROS', grupo: 'OUTROS', cat: 'x' }), // só taxa: nem atendimento
];

test('FAT-01 faturamento da loja: com Espaço Gourmet e sem vendedor, sem taxas e sem itens a R$ 0,01', () => {
  const r = CT.resumo(DIA1);
  // antes: Resumo 100+60+40+4+50+12 = 266 (com taxas, sem "sem vendedor"); Início 280,01; Resultado 280. Agora todos 280.
  assert.equal(r.fat, 280);
  assert.equal(r.vendasMeta, 240, 'vendas da meta = chás + acessórios, sem Espaço Gourmet (100 + 60 + 30 + 50)');
  assert.equal(r.eg, 40);
  assert.equal(r.cupons, 4, 'cupons únicos: o cupom 1 (duas vendedoras) conta uma vez; o cupom só de taxa não conta');
  assert.equal(r.itens, 5, 'linha de taxa e item a R$ 0,01 não são item');
  assert.equal(r.tkm, 70); assert.equal(r.pma, 56); assert.equal(r.ipa, 1.25);
  perto(r.kg, 0.15, 'chá vendido inclui o chá amarelo');
});

test('FAT-02 Resumo, Início, Resultado e resumo do servidor dão o MESMO faturamento para o mesmo dia e loja', () => {
  const TS = tela(DIA1);
  const idx = TS.filtrar();
  const resumoTela = TS.indicadores(idx);            // Resumo (TS.pages.resumo) e Início (somaDias) usam TS.indicadores
  let resultado = 0;                                  // Resultado (dre.js): soma do que não é M.taxa = TS.contaFat
  for (const i of idx) if (TS.contaFat(i)) resultado += TS.db.vt[i];
  const servidor = I.metricas(DIA1);                  // resumo diário e comparação com a rede
  assert.equal(resumoTela.vt, 280);
  assert.equal(resultado, 280);
  assert.equal(servidor.vt, 280);
  assert.equal(TS.metricas(idx).vt, 280, 'consultas do ✨ (TS.metricas) na mesma base');
  // atendimentos, TKM, PMA e IPA iguais na tela e no servidor
  for (const k of ['cupons', 'tkm', 'pma', 'ipa']) assert.equal(resumoTela[k], servidor[k], k);
  assert.equal(resumoTela.cupons, 4);
  // vendas da meta: a mesma base no Comissionamento (R.mix sem EG), no Início e no servidor
  assert.equal(TS.rules.vendasMeta(idx), 240);
  assert.equal(servidor.metaLoja, 240);
  // chá vendido (kg) com o amarelo: tela (ids.chaTotal) e servidor
  const kgTela = idx.reduce((s, i) => s + (TS.rules.ids.chaTotal.has(TS.db.grupo[i]) ? TS.db.cha[i] || 0 : 0), 0);
  perto(kgTela, 0.15); perto(servidor.kg, 0.15);
});

test('ATD-01 atendimentos: por vendedor o cupom conta para cada um; o total da loja nunca soma duas vezes', () => {
  const TS = tela(DIA1);
  const idx = TS.filtrar();
  const porVend = TS.agrupar(idx, (i) => TS.db.D.vendedor[TS.db.vend[i]]);
  const n = (v) => TS.indicadores(porVend.get(v)).cupons;
  assert.equal(n('ANA'), 2); assert.equal(n('BIA'), 2); assert.equal(n('SEM VENDEDOR'), 1);
  // antes o total do Resumo era a soma por vendedor (o cupom 1 contava 2×); agora 4 cupons únicos
  assert.equal(TS.indicadores(idx).cupons, 4);
  assert.equal(TS.cuponsUnicos(idx), 4);
});

// ======================= projeção do mês =======================
/** histórico: seg a sex R$ 1.000, sábado R$ 3.000, domingo fechado (0) */
const padraoSemana = (iso) => { const w = new Date(iso + 'T12:00:00Z').getUTCDay(); return w === 0 ? 0 : w === 6 ? 3000 : 1000; };
const semDomingo = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay() !== 0;

test('PROJ-01 projeção pesa pelo dia da semana e deixa o dia em andamento de fora', () => {
  // novembro/2026 começa num domingo; hoje = sexta 20/11 (em andamento) → último dia completo = quinta 19/11
  const P = CT.projecaoMes({ ym: '2026-11', ate: '2026-11-19', valorDia: padraoSemana, aberto: semDomingo, inicio: '2026-01-01' });
  // vendido até 19/11: 14 dias úteis × 1.000 + 2 sábados × 3.000 = 20.000
  assert.equal(P.realizado, 20000);
  assert.equal(P.feitos, 19);
  // faltam: sex 20, sáb 21, (dom 22), seg–sex 23–27, sáb 28, (dom 29), seg 30 = 7 úteis × 1.000 + 2 sábados × 3.000 = 13.000
  assert.equal(P.estimado, 13000);
  assert.equal(P.restantes, 9, 'dias de loja aberta que faltam, contando hoje');
  assert.equal(P.proj, 33000);
  assert.equal(P.metodo, 'semana');
  // antes (linear): 20.000 ÷ 19 dias × 30 = 31.579 — ignorava que ainda faltam 2 sábados
  assert.equal(Math.round((20000 / 19) * 30), 31579);
  // o dia em andamento não muda a projeção: mesmo que hoje já tenha R$ 5.000, a conta para em 19/11
  const comHoje = CT.projecaoMes({ ym: '2026-11', ate: '2026-11-19', valorDia: (iso) => (iso === '2026-11-20' ? 5000 : padraoSemana(iso)), aberto: semDomingo, inicio: '2026-01-01' });
  assert.equal(comHoje.proj, 33000);
});

test('PROJ-02 feriado ou dia fechado conta zero; mês fechado devolve o realizado', () => {
  const fechado28 = (iso) => semDomingo(iso) && iso !== '2026-11-28';
  const P = CT.projecaoMes({ ym: '2026-11', ate: '2026-11-19', valorDia: padraoSemana, aberto: fechado28, inicio: '2026-01-01' });
  assert.equal(P.proj, 30000, 'sem o sábado 28 (fechado): 33.000 − 3.000');
  assert.equal(P.restantes, 8);
  const F = CT.projecaoMes({ ym: '2026-10', ate: '2026-11-19', valorDia: padraoSemana, aberto: semDomingo, inicio: '2026-01-01' });
  assert.equal(F.fechado, true);
  assert.equal(F.proj, F.realizado);
});

test('PROJ-03 menos de 4 semanas de histórico: média simples por dia de loja aberta', () => {
  // loja abriu em 02/11 (segunda): 16 dias abertos até 19/11, R$ 20.000 → R$ 1.250 por dia aberto
  const P = CT.projecaoMes({ ym: '2026-11', ate: '2026-11-19', valorDia: (iso) => (iso < '2026-11-02' ? 0 : padraoSemana(iso)), aberto: semDomingo, inicio: '2026-11-02' });
  assert.equal(P.metodo, 'simples');
  assert.equal(P.mediaSimples, 1250);
  assert.equal(P.proj, 20000 + 9 * 1250);
  // sem histórico nenhum: não inventa número
  assert.equal(CT.projecaoMes({ ym: '2026-11', ate: '2026-11-19', valorDia: () => 0, inicio: '2026-11-25' }).proj, null);
});

test('PROJ-04 período personalizado: a projeção parte do fim do PERÍODO, não do dia de hoje', () => {
  // período 01 a 10/11 (hoje é dia 20): vendido 10.000; antes dividia por 20 dias (10.000 ÷ 20 × 30 = 15.000)
  const P = CT.projecaoMes({ ym: '2026-11', ate: '2026-11-10', valorDia: padraoSemana, aberto: semDomingo, inicio: '2026-01-01' });
  assert.equal(P.realizado, 10000);          // 7 dias úteis + 1 sábado
  assert.equal(P.proj, 10000 + 23000);       // 11 a 30/11: 14 úteis + 3 sábados
});

test('PROJ-05 servidor (resumo diário, alertas, rede) usa a mesma conta da tela', () => {
  const vendas = [];
  for (let d = Date.UTC(2026, 8, 1); d <= Date.UTC(2026, 10, 19); d += 864e5) {
    const iso = new Date(d).toISOString().slice(0, 10), v = padraoSemana(iso);
    if (v) vendas.push(venda(iso, 1, 'ANA', v));
  }
  vendas.push(venda('2026-11-19', 9, 'ANA', 500, EG)); // Espaço Gourmet: fora das vendas da meta, dentro do faturamento
  const loja = { nome: 'L', operacao: { funcionamento: { dom: { fechado: true } } } };
  const pm = I.projecaoMes({ loja, vendas, ym: '2026-11', ate: '2026-11-19', base: 'meta' });
  assert.equal(pm.proj, 33000);
  // faturamento da loja: + R$ 500 do Espaço Gourmet de quinta 19/11, que também entra na média das quintas (500 ÷ 8 = 62,50 na quinta 26)
  assert.equal(I.projecaoMes({ loja, vendas, ym: '2026-11', ate: '2026-11-19', base: 'loja' }).proj, 33562.5);
  // alerta do ritmo da meta: meta 40.000 → projeção 33.000 = 83% (antes, linear: 31.579 = 79%)
  const al = I.alertas({ loja: { ...loja, meta: 40000 }, vendas, hoje: '2026-11-20' }).find((a) => a.tipo === 'meta');
  assert.match(al.texto, /fecham o mês em R\$ 33\.000 \(83% da meta/);
  assert.match(al.texto, /nos 9 dias de loja aberta/);
  // dia em andamento não entra nas comparações: com vendas parciais de "hoje" o alerta é o mesmo
  const comHoje = [...vendas, venda('2026-11-20', 1, 'ANA', 50)];
  const al2 = I.alertas({ loja: { ...loja, meta: 40000 }, vendas: comHoje, hoje: '2026-11-20' }).find((a) => a.tipo === 'meta');
  assert.equal(al2.texto, al.texto);
});

test('REDE-01 comparação com a rede: "Ritmo da meta" (projeção ÷ meta), não "Meta atingida"', () => {
  const partes = [1, 2, 3, 4].map((n) => {
    const vendas = [];
    for (let d = Date.UTC(2026, 8, 1); d <= Date.UTC(2026, 10, 19); d += 864e5) { const iso = new Date(d).toISOString().slice(0, 10), v = padraoSemana(iso); if (v) vendas.push(venda(iso, 1, 'ANA', v * n)); }
    return { id: 'l' + n, loja: { meta: 33000 * n, operacao: { funcionamento: { dom: { fechado: true } } } }, vendas };
  });
  const r = I.rede(partes, '2026-11', 'l2', 4);
  const x = r.indicadores.find((k) => k.k === 'pctMeta');
  assert.equal(x.nome, 'Ritmo da meta');
  perto(x.minha, 1, 'projeção 66.000 ÷ meta 66.000');
  assert.ok(!r.indicadores.some((k) => k.nome === 'Meta atingida'));
});

// ======================= quem divide a meta (piso) =======================
test('META-01 piso de dias com venda: mês fechado usa o piso inteiro; em andamento é proporcional (até o dia 7 todos dividem)', () => {
  const dias = [['ANA', 20], ['BIA', 12], ['CAU', 2]];
  const f = CT.divisoresMeta({ dias, piso: 4, ym: '2026-10', ultimoDia: '2026-10-31' });
  assert.deepEqual(f.dentro, ['ANA', 'BIA']);
  assert.deepEqual(f.fora, [{ nome: 'CAU', dias: 2 }]);
  assert.equal(f.pisoAplicado, 4);
  // mês em andamento (novembro, 30 dias): dia 7 → 1; dia 8 → 1; dia 15 → 2; dia 23 → 3; dia 30 → fechado (4)
  const ap = (d) => CT.divisoresMeta({ dias, piso: 4, ym: '2026-11', ultimoDia: `2026-11-${String(d).padStart(2, '0')}` }).pisoAplicado;
  assert.deepEqual([3, 7, 8, 15, 22, 23, 29, 30].map(ap), [1, 1, 1, 2, 2, 3, 3, 4]);
  assert.deepEqual(CT.divisoresMeta({ dias, piso: 4, ym: '2026-11', ultimoDia: '2026-11-05' }).fora, [], 'começo do mês: a pessoa nova não fica de fora');
  // piso 1 = regra antiga (qualquer venda divide); sem o parâmetro vale o padrão 4
  assert.equal(CT.divisoresMeta({ dias, piso: 1, ym: '2026-10', ultimoDia: '2026-10-31' }).dentro.length, 3);
  assert.equal(CT.divisoresMeta({ dias, ym: '2026-10', ultimoDia: '2026-10-31' }).piso, 4);
  // ninguém alcança o piso: todos dividem (a meta nunca fica sem divisor)
  const t = CT.divisoresMeta({ dias: [['ANA', 2], ['BIA', 1]], piso: 4, ym: '2026-10', ultimoDia: '2026-10-31' });
  assert.equal(t.todosAbaixo, true); assert.equal(t.dentro.length, 2);
});

/** outubro/2026 fechado: ANA e BIA vendem em 10 dias; CAU cobre 1 dia */
function mesOutubro(extra = []) {
  const l = [];
  for (let d = 1; d <= 10; d++) {
    const iso = `2026-10-${String(d + 4).padStart(2, '0')}`;
    l.push(venda(iso, d, 'ANA', 600), venda(iso, 100 + d, 'BIA', 400));
  }
  l.push(venda('2026-10-20', 900, 'CAU', 300), ...extra);
  return l;
}

test('META-02 comissão: quem cobriu um dia não diminui a meta dos outros (antes × depois)', () => {
  const linhas = mesOutubro();
  const calc = (regras) => { const TS = tela(linhas, { regras }); const b = TS.filtrar(); return TS.rules.comissionamento({ base: b, baseSemVend: b, metaLoja: 30000, vendBonus: '', ym: '2026-10' }); };
  const row = (res, n) => res.rows.find((r) => r.vendedor === n);
  // ANTES (piso 1 = qualquer venda divide): meta ÷ 3 = 10.000 → meta de aromatizado 5.500; ANA vendeu 6.000 → bateu → 4% = 240
  const antes = calc({ modelo: 'padrao', pisoDiasMeta: 1 });
  assert.equal(antes.qtdVend, 3);
  perto(row(antes, 'ANA').metaInd, 10000);
  perto(row(antes, 'ANA').cArom, 240);
  // DEPOIS (padrão 4 dias): meta ÷ 2 = 15.000 → meta de aromatizado 8.250; ANA com 6.000 fica abaixo → 2% = 120
  const depois = calc(null);
  assert.equal(depois.qtdVend, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(depois.foraDaMeta)), [{ vendedor: 'CAU', dias: 1 }]);
  assert.equal(depois.piso.aplicado, 4);
  perto(row(depois, 'ANA').metaInd, 15000);
  perto(row(depois, 'ANA').cArom, 120);
  // CAU (fora da divisão) continua com comissão pela faixa, contra a mesma meta individual dos demais
  assert.equal(row(depois, 'CAU').divide, false);
  perto(row(depois, 'CAU').metaInd, 15000);
  perto(row(depois, 'CAU').cArom, 300 * 0.02);
  // a meta da loja no total não muda
  assert.equal(depois.total.metaInd, 30000);
});

test('META-03 mês em andamento: até o dia 7 todos com venda dividem; depois o piso sobe com os dias', () => {
  const linhas = [];
  for (let d = 1; d <= 20; d++) { const iso = `2026-11-${String(d).padStart(2, '0')}`; linhas.push(venda(iso, d, 'ANA', 500), venda(iso, 100 + d, 'BIA', 500)); }
  linhas.push(venda('2026-11-03', 900, 'NOVA', 200));
  const TS = tela(linhas);
  const calc = (ate) => { const b = TS.filtrar({ de: TS.isoToDay('2026-11-01'), ate: TS.isoToDay(ate) }); return TS.rules.comissionamento({ base: b, baseSemVend: b, metaLoja: 30000, vendBonus: '', ym: '2026-11', ate: TS.isoToDay(ate) }); };
  assert.equal(calc('2026-11-06').qtdVend, 3, 'dia 6: a pessoa nova (1 dia) ainda divide');
  const d20 = calc('2026-11-20'); // dia 20 de 30: piso 4 × 20 ÷ 30 = 2 dias
  assert.equal(d20.piso.aplicado, 2);
  assert.equal(d20.qtdVend, 2);
  assert.equal(d20.piso.fechado, false);
});

// ======================= bônus sobre os outros vendedores =======================
test('BON-01 bônus: a FAIXA usa as vendas da meta (igual ao "% da meta"); o valor pago continua sobre as vendas dos outros', () => {
  // vendas da meta: ANA 6.000 + BIA 4.000 + CAU 300 = 10.300; fora da meta: livros R$ 3.000 (SEM VENDEDOR)
  const linhas = mesOutubro([venda('2026-10-21', 950, 'SEM VENDEDOR', 3000, OUTRO)]);
  const TS = tela(linhas);
  const b = TS.filtrar();
  const res = TS.rules.comissionamento({ base: b, baseSemVend: b, metaLoja: 11000, vendBonus: 'ANA', ym: '2026-10' });
  const ana = res.rows.find((r) => r.vendedor === 'ANA');
  // ANTES: total da loja 13.300 ≥ 120% de 11.000 (13.200) → faixa de 1,5% com a loja a 94% da meta: 1,5% × 7.300 = 109,50
  perto((13300 - 6000) * 0.015, 109.5);
  // DEPOIS: a faixa segue as vendas da meta (10.300 < 11.000 → 0,5%); a base paga não mudou (13.300 − 6.000): 0,5% × 7.300 = 36,50
  perto(ana.bonus, 36.5);
  // batendo a meta pelas vendas da meta, a faixa sobe: meta 10.000 → 1% × 7.300 = 73
  const r2 = TS.rules.comissionamento({ base: b, baseSemVend: b, metaLoja: 10000, vendBonus: 'ANA', ym: '2026-10' });
  perto(r2.rows.find((r) => r.vendedor === 'ANA').bonus, 73);
});

// ======================= premiação: mínimo de atendimentos =======================
test('PREM-01 premiação por TKM/IPA/PMA só para quem tem o mínimo de atendimentos (padrão 20)', () => {
  const TS = tela(DIA1);
  const R = TS.rules, rg = R.MODELOS.padrao.regras;
  const bom = { tkm: 300, ipa: 4, pma: 90 };
  // ANTES: 3 cupons bons no mês já davam 3 × R$ 50 = R$ 150
  assert.equal(R.premiacao({ ...bom, cupons: 3 }, R.fundir(rg, { premiacao: { minAtend: 0 } })), 150);
  // DEPOIS: abaixo de 20 atendimentos não concorre
  assert.equal(R.premiacao({ ...bom, cupons: 3 }, rg), 0);
  assert.equal(R.poucosAtend({ ...bom, cupons: 19 }, rg), true);
  assert.equal(R.premiacao({ ...bom, cupons: 20 }, rg), 150);
  assert.equal(R.minAtendPremiacao(rg), 20);
  assert.equal(R.minAtendPremiacao(R.fundir(rg, { premiacao: { minAtend: 35 } })), 35);
  // regras antigas (sem o campo): vale o padrão
  const antiga = JSON.parse(JSON.stringify(rg)); delete antiga.premiacao.minAtend;
  assert.equal(R.minAtendPremiacao(antiga), 20);
  // na tabela: a linha diz "poucos atendimentos" (ANA tem 10 cupons em outubro)
  const T2 = tela(mesOutubro());
  const b = T2.filtrar();
  const ana = T2.rules.comissionamento({ base: b, baseSemVend: b, metaLoja: 30000, vendBonus: '', ym: '2026-10' }).rows.find((r) => r.vendedor === 'ANA');
  assert.equal(ana.poucosAtend, true); assert.equal(ana.atend, 10); assert.equal(ana.premiacao, 0);
});

// ======================= comissão do mês projetado (Resultado) =======================
test('COM-PROJ-01 comissão projetada: a venda projetada de cada pessoa na faixa certa, não a comissão parcial × fator', () => {
  // dia 20 de novembro: ANA vendeu 10.000 de aromatizado; meta da loja 30.000 → individual 15.000 → aromatizado 8.250... usa só ANA e BIA
  const linhas = [];
  for (let d = 1; d <= 20; d++) { const iso = `2026-11-${String(d).padStart(2, '0')}`; linhas.push(venda(iso, d, 'ANA', 350), venda(iso, 100 + d, 'BIA', 350)); }
  const TS = tela(linhas);
  const b = TS.filtrar();
  const args = { base: b, baseSemVend: b, metaLoja: 30000, vendBonus: '', ym: '2026-11', ate: TS.isoToDay('2026-11-20') };
  const hoje = TS.rules.comissionamento(args);
  // até hoje: 7.000 cada, abaixo da meta de aromatizado (8.250) → 2% = 140 cada → 280
  perto(hoje.total.aPagar, 280);
  // projeção com fator 1,5 (mês fecha em 10.500 cada): passa de 120% da meta (9.900) → 5% × 10.500 = 525 cada → 1.050
  const proj = TS.rules.comissionamento({ ...args, projFator: 1.5 });
  perto(proj.total.aPagar, 1050);
  // ANTES o Resultado multiplicava a comissão parcial: 280 × 1,5 = 420 (faixa errada)
  perto(hoje.total.aPagar * 1.5, 420);
});

// ======================= ponto de equilíbrio =======================
test('EQ-01 ponto de equilíbrio inclui as despesas só deste mês (as mesmas do Resultado)', () => {
  const fixos = [{ nome: 'Aluguel', valor: 8000 }, { nome: 'Salários', valor: 12000 }];
  const pontuais = [{ nome: '13º', valor: 6000 }];
  // ANTES: 20.000 ÷ 40% = 50.000; DEPOIS: (20.000 + 6.000) ÷ 40% = 65.000
  assert.equal(CT.pontoEquilibrio({ fixos, pontuais: [], margem: 0.4 }).equilibrio, 50000);
  const r = CT.pontoEquilibrio({ fixos, pontuais, margem: 0.4 });
  assert.equal(r.equilibrio, 65000); assert.equal(r.pontuais, 6000); assert.equal(r.total, 26000);
  assert.equal(CT.pontoEquilibrio({ fixos, pontuais, margem: 0 }).equilibrio, null);
});

// ======================= parâmetros novos das regras da loja =======================
test('CFG-01 regras da loja: piso de dias da meta (1 a 31) e mínimo de atendimentos (0 a 2000) validados no servidor', () => {
  const os = require('os');
  process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'contas-'));
  const { validarRegras } = require('../../src/admin-api');
  const RV = require('../../src/regrasvend');
  const base = () => ({ ...JSON.parse(JSON.stringify(RV.regrasNavegador().MODELOS.padrao.regras)), modelo: 'padrao' });
  assert.equal(validarRegras(base()), null, 'o modelo padrão (piso 4, mínimo 20) é válido');
  const semCampos = base(); delete semCampos.pisoDiasMeta; delete semCampos.premiacao.minAtend;
  assert.equal(validarRegras(semCampos), null, 'regras antigas, sem os campos, continuam válidas');
  for (const v of [0, 32, 2.5, '4']) assert.match(validarRegras({ ...base(), pisoDiasMeta: v }), /dividir a meta/);
  for (const v of [-1, 2001, 1.5]) { const g = base(); g.premiacao.minAtend = v; assert.match(validarRegras(g), /atendimentos/); }
  const ok = base(); ok.pisoDiasMeta = 1; ok.premiacao.minAtend = 0;
  assert.equal(validarRegras(ok), null);
});

test('META-04 férias lançadas: quem volta de férias divide a meta mesmo abaixo do piso (é da equipe, não folguista)', () => {
  // mês fechado, piso 4: ANA 20 dias, BIA (férias até o dia 27) 3 dias, CAU (folguista) 1 dia
  const dias = [['ANA', 20], ['BIA', 3], ['CAU', 1]];
  const sem = CT.divisoresMeta({ dias, piso: 4, ym: '2026-10', ultimoDia: '2026-10-31' });
  assert.deepEqual(sem.dentro, ['ANA']);
  assert.deepEqual(sem.fora.map((x) => x.nome), ['BIA', 'CAU']);
  const com = CT.divisoresMeta({ dias, piso: 4, ym: '2026-10', ultimoDia: '2026-10-31', sempre: ['BIA'] });
  assert.deepEqual(com.dentro, ['ANA', 'BIA']);
  assert.deepEqual(com.fora.map((x) => x.nome), ['CAU'], 'a folguista continua fora');
  assert.deepEqual(com.porFerias, ['BIA']);
  // a meta da BIA é só a dos dias trabalhados: meta 31.000 em outubro (1.000/dia), férias de 01 a 27 → 4 dias × 500 = 2.000
  const m = CT.metasIndividuais(31000, '2026-10', ['ANA', 'BIA'], [{ vendedor: 'BIA', de: '2026-10-01', ate: '2026-10-27' }]).metas;
  assert.equal(Math.round(m.get('BIA')), 2000); assert.equal(Math.round(m.get('ANA')), 29000);
});
