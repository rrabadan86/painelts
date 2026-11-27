'use strict';
/* Regras de comissão e equipe (docs/rastreabilidade.md, seção 8):
   EQP-03 comissão por categoria e faixa (≥120%, ≥100%, abaixo) e o modo simples (public/js/rules.js);
   EQP-04 "sem meta", "não recebem comissão" e "sem vendedor";
   EQP-07 rateio igual do total de comissões;
   EQP-09 férias: datas válidas, até 300 períodos, auditadas (rota PUT /api/admin/lojas/:id/ferias, sem subir o servidor);
   EQP-10 vendedora não recebe escala, equipe nem horas das colegas (filtrarPorPerfil do server.js, sem subir o servidor). */
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '../..');
const LOJA = 'LOJA TESTE';
const CAT_AROM = 'Chás aromatizados, Chás, Rooibos e Infusões Aromatizados, LOJA';
const PURO = { descricao: 'Chá Verde Sencha', produto: 'Chá Verde Sencha', grupo: 'CHÁ VERDE PURO', grupoC: 'CHÁ PURO', cat: 'Chás Puros, Chás, Rooibos e Infusões Puros, LOJA' };
const ACESS = { descricao: 'Infusor', produto: 'Infusor', grupo: 'ACESSÓRIOS', grupoC: 'ACESSÓRIOS', cat: 'Acessórios, LOJA' };

/** linha de venda como o servidor guarda (chá aromatizado por padrão) */
const venda = (data, cupom, vendedor, vt, x = {}) => ({
  data, cupom, loja: LOJA, vendedor, vt, qtd: 1, vu: vt, du: 0, qtdCha: 0, soNumeros: null, min: null, cod: '',
  descricao: 'Chá Preto 50G', produto: 'Chá Preto', grupo: 'CHÁ PRETO AROMATIZADO', grupoC: 'CHÁ AROMATIZADO', cat: CAT_AROM, ...x,
});

/** as telas no Node: os mesmos arquivos do navegador (core.js, contas.js, rules.js) sobre um pacote montado das linhas
 *  (o mesmo jeito do tests/unit/contas.test.js) */
function tela(linhas, { regras } = {}) {
  const dict = { loja: [], vendedor: [], descricao: [], produto: [], grupo: [], grupoC: [], cat: [] };
  const id = (campo, t) => { let i = dict[campo].indexOf(t); if (i < 0) { dict[campo].push(t); i = dict[campo].length - 1; } return i; };
  const v = { data: [], cupom: [], min: [], qtd: [], soNumeros: [], qtdCha: [], vu: [], du: [], vt: [], loja: [], vendedor: [], cod: [], descricao: [], produto: [], grupo: [], grupoC: [], cat: [] };
  for (const l of linhas) {
    for (const k of ['data', 'cupom', 'min', 'qtd', 'soNumeros', 'qtdCha', 'vu', 'du', 'vt', 'cod']) v[k].push(l[k]);
    for (const k of ['loja', 'vendedor', 'descricao', 'produto', 'grupo', 'grupoC', 'cat']) v[k].push(id(k, l[k]));
  }
  const ctx = vm.createContext({ console });
  vm.runInContext("var window = globalThis; var location = { pathname: '/', hash: '' };", ctx);
  for (const f of ['core.js', 'contas.js', 'rules.js']) vm.runInContext(fs.readFileSync(path.join(RAIZ, 'public/js', f), 'utf8'), ctx, { filename: f });
  ctx.__raw = JSON.stringify({ vendas: v, dict, metas: [{ id: 'teste', nomesVenda: [LOJA], padrao: 0, ...(regras ? { regras } : {}) }] });
  vm.runInContext('TS.db = TS.decode(JSON.parse(__raw)); TS.rules.prepare();', ctx);
  return vm.runInContext('TS', ctx);
}
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg || ''} esperado ${b}, veio ${a}`);

/** outubro/2026 (mês fechado): cada vendedora vende em 10 dias (passa do piso de 4 dias da meta).
 *  vendas: { NOME: { arom, puro, acess } } — total do mês de cada categoria, dividido pelos 10 dias */
let cupom = 0;
function mes(vendas) {
  const l = [];
  for (const [nome, cats] of Object.entries(vendas)) {
    for (let d = 0; d < 10; d++) {
      const iso = `2026-10-${String(d + 5).padStart(2, '0')}`;
      const c = ++cupom;
      if (cats.arom) l.push(venda(iso, c, nome, cats.arom / 10));
      if (cats.puro) l.push(venda(iso, c, nome, cats.puro / 10, PURO));
      if (cats.acess) l.push(venda(iso, c, nome, cats.acess / 10, ACESS));
    }
  }
  return l;
}
function calc(linhas, { regras, metaLoja = 20000, base } = {}) {
  const TS = tela(linhas, { regras });
  const todas = TS.filtrar();
  const b = base ? todas.filter((i) => base(TS.db.D.vendedor[TS.db.vend[i]])) : todas;
  const res = TS.rules.comissionamento({ base: b, baseSemVend: todas, metaLoja, vendBonus: '', ym: '2026-10' });
  res.linha = (n) => res.rows.find((r) => r.vendedor === n);
  return res;
}

// ======================= EQP-03 comissão por categoria e faixa =======================
test('EQP-03: faixas da comissão — ≥120% da meta, ≥100% e abaixo; sem meta vale a taxa mínima', () => {
  const R = tela(mes({ ANA: { arom: 1 } })).rules;
  const f = R.MODELOS.padrao.regras.comissao.arom; // 5% / 4% / 2%
  perto(R.comissaoFaixa(1200, 1000, 'faixas', f), 60, '120% exato → acima120');
  perto(R.comissaoFaixa(1500, 1000, 'faixas', f), 75);
  perto(R.comissaoFaixa(1199.99, 1000, 'faixas', f), 1199.99 * 0.04, 'logo abaixo de 120% → bate');
  perto(R.comissaoFaixa(1000, 1000, 'faixas', f), 40, '100% exato → bate');
  perto(R.comissaoFaixa(999.99, 1000, 'faixas', f), 999.99 * 0.02, 'abaixo da meta');
  perto(R.comissaoFaixa(1000, 0, 'faixas', f), 20, 'meta 0: taxa mínima');
  perto(R.comissaoFaixa(1000, null, 'faixas', f), 20, 'meta vazia: taxa mínima');
  perto(R.comissaoFaixa(0, 1000, 'faixas', f), 0);
});

test('EQP-03: modo simples — bateu (≥100%) ou não bateu; ≥120% não muda a taxa', () => {
  const R = tela(mes({ ANA: { arom: 1 } })).rules;
  const f = { acima120: 0.09, bate: 0.05, abaixo: 0.01 };
  perto(R.comissaoFaixa(1500, 1000, 'simples', f), 75, 'acima de 120% no simples paga a taxa "bate"');
  perto(R.comissaoFaixa(1000, 1000, 'simples', f), 50);
  perto(R.comissaoFaixa(999, 1000, 'simples', f), 9.99);
  perto(R.comissaoFaixa(1000, 0, 'simples', f), 10, 'sem meta: taxa mínima também no simples');
});

test('EQP-03: comissionamento por categoria — cada categoria contra a sua parte da meta (55% / 15% / 30%)', () => {
  // meta da loja 20.000 ÷ 2 = 10.000 cada → aromatizado 5.500, puro 1.500, acessórios 3.000
  const res = calc(mes({
    ANA: { arom: 6600, puro: 1500, acess: 1000 }, // 120% / 100% / 33%
    BIA: { arom: 5000, puro: 1800, acess: 3300 }, // 91% / 120% / 110%
  }));
  assert.equal(res.qtdVend, 2);
  const ana = res.linha('ANA'), bia = res.linha('BIA');
  perto(ana.metaInd, 10000);
  perto(ana.metaArom, 5500); perto(ana.metaPuro, 1500); perto(ana.metaAcess, 3000);
  perto(ana.cArom, 6600 * 0.05, 'aromatizado ≥120% → 5%');
  perto(ana.cPuro, 1500 * 0.05, 'puro ≥100% → 5%');
  perto(ana.cAcess, 1000 * 0.01, 'acessórios abaixo → 1%');
  perto(bia.cArom, 5000 * 0.02, 'aromatizado abaixo → 2%');
  perto(bia.cPuro, 1800 * 0.06, 'puro ≥120% → 6%');
  perto(bia.cAcess, 3300 * 0.02, 'acessórios ≥100% → 2%');
  // sem premiação (menos de 20 atendimentos) e sem rateio: a pagar = soma das três comissões
  perto(ana.aPagar, 330 + 75 + 10);
  perto(bia.aPagar, 100 + 108 + 66);
  perto(res.total.aPagar, 415 + 274);
  perto(res.total.cArom, 330 + 100);
  perto(res.total.metaArom, 20000 * 0.55);
});

test('EQP-03: divisão da meta e taxas vêm das regras da loja (modelo e ajustes)', () => {
  // Goiânia divide 55% / 10% / 35%: puro 1.000 e acessórios 3.500 de meta individual
  const res = calc(mes({ ANA: { arom: 5500, puro: 1200, acess: 3500 }, BIA: { arom: 100 } }), { regras: { modelo: 'goiania' } });
  const ana = res.linha('ANA');
  perto(ana.metaPuro, 1000); perto(ana.metaAcess, 3500);
  perto(ana.cPuro, 1200 * 0.06, 'puro 120% da meta de Goiânia → 6%');
  perto(ana.cAcess, 3500 * 0.02, 'acessórios 100% → 2%');
  perto(ana.cArom, 5500 * 0.04);
  // taxa ajustada nas regras da loja
  const aj = calc(mes({ ANA: { arom: 6600 }, BIA: { arom: 100 } }), { regras: { comissao: { arom: { acima120: 0.1 } } } });
  perto(aj.linha('ANA').cArom, 660);
});

test('EQP-03: comissionamento no modo simples (modelo Vila Madalena) — bateu paga "bate" mesmo acima de 120%', () => {
  const vendas = mes({ ANA: { arom: 6600, puro: 1400, acess: 1000 }, BIA: { arom: 100 } });
  const vila = calc(vendas, { regras: { modelo: 'vila', rateio: { ativo: false } } });
  const ana = vila.linha('ANA');
  assert.equal(vila.regras.comissao.modo, 'simples');
  perto(ana.cArom, 6600 * 0.05, 'aromatizado bateu → 5% (simples)');
  perto(ana.cPuro, 1400 * 0.05, 'puro não bateu (93%) → 5% abaixo da Vila');
  perto(ana.cAcess, 1000 * 0.02, 'acessórios não bateu → 2%');
  // o modo simples sobre as taxas do padrão: aromatizado a 120% paga 4% ("bate"), não 5%
  const simples = calc(vendas, { regras: { comissao: { modo: 'simples' } } });
  perto(simples.linha('ANA').cArom, 6600 * 0.04);
  const faixas = calc(vendas);
  perto(faixas.linha('ANA').cArom, 6600 * 0.05, 'no modo faixas o mesmo valor paga 5%');
});

// ======================= EQP-04 sem meta, não recebem comissão, sem vendedor =======================
test('EQP-04: "sem meta" — meta individual 0, não divide a meta e recebe a taxa "abaixo" sobre o que vendeu', () => {
  const vendas = mes({ ANA: { arom: 5500 }, BIA: { arom: 5500 }, CAU: { arom: 20000, puro: 1000, acess: 1000 } });
  const sem = calc(vendas, { regras: { semMeta: ['  Cau '] } }); // nome comparado sem maiúsculas nem espaços
  const cau = sem.linha('CAU');
  assert.equal(cau.semMeta, true);
  assert.equal(cau.metaInd, 0);
  assert.equal(cau.divide, false);
  assert.equal(sem.qtdVend, 2, 'quem não tem meta não aumenta o número de divisores');
  perto(sem.linha('ANA').metaInd, 10000);
  perto(cau.cArom, 20000 * 0.02, 'mesmo vendendo muito, só a taxa "abaixo"');
  perto(cau.cPuro, 1000 * 0.025);
  perto(cau.cAcess, 1000 * 0.01);
  perto(cau.aPagar, 400 + 25 + 10);
  // sem a lista: CAU divide a meta (3 pessoas) e entra na faixa
  const com = calc(vendas);
  assert.equal(com.linha('CAU').semMeta, false);
  assert.equal(com.qtdVend, 3);
  perto(com.linha('CAU').cArom, 20000 * 0.05);
});

test('EQP-04: "não recebem comissão" — comissão, premiação e a pagar zerados', () => {
  // BIA concorre à premiação: 25 atendimentos de 3 itens de R$ 100 (TKM 300, IPA 3, PMA 100) → 3 × R$ 50
  const linhas = mes({ ANA: { arom: 5000, puro: 1000, acess: 1000 } });
  for (let c = 0; c < 25; c++) {
    const iso = `2026-10-${String(5 + (c % 10)).padStart(2, '0')}`;
    linhas.push(venda(iso, 5000 + c, 'BIA', 100), venda(iso, 5000 + c, 'BIA', 100, PURO), venda(iso, 5000 + c, 'BIA', 100, ACESS));
  }
  const normal = calc(linhas).linha('BIA');
  assert.equal(normal.premiacao, 150, 'controle: sem a lista, BIA ganha a premiação');
  assert.ok(normal.cArom > 0);
  const res = calc(linhas, { regras: { semComissao: ['bia'] } });
  const bia = res.linha('BIA');
  assert.equal(bia.naoRecebe, true);
  assert.equal(bia.cArom, 0); assert.equal(bia.cPuro, 0); assert.equal(bia.cAcess, 0);
  assert.equal(bia.premiacao, 0);
  assert.equal(bia.poucosAtend, false);
  assert.equal(bia.aPagar, 0);
  assert.equal(bia.total, 7500, 'as vendas dela continuam na tabela');
  assert.ok(res.linha('ANA').aPagar > 0, 'os outros continuam recebendo');
  perto(res.total.aPagar, res.linha('ANA').aPagar);
});

test('EQP-04: "SEM VENDEDOR" — sempre sem meta (mesmo fora da lista da loja) e não divide a meta', () => {
  const res = calc(mes({ ANA: { arom: 5500 }, BIA: { arom: 5500 }, 'SEM VENDEDOR': { arom: 3000 } }), { regras: { semMeta: [] } });
  const sv = res.linha('SEM VENDEDOR');
  assert.ok(sv, 'a linha aparece na tabela');
  assert.equal(sv.semMeta, true);
  assert.equal(sv.metaInd, 0);
  assert.equal(sv.divide, false);
  assert.equal(res.qtdVend, 2);
  perto(res.linha('ANA').metaInd, 10000);
  // fora do rateio a linha "SEM VENDEDOR" sai pela taxa "abaixo" (comportamento atual; ver o relatório)
  perto(sv.cArom, 3000 * 0.02);
  assert.equal(tela(mes({ ANA: { arom: 1 } })).rules.semMetaDe({ semMeta: [] }).has('sem vendedor'), true);
});

// ======================= EQP-07 rateio igual =======================
const EQUIPE_RATEIO = () => mes({
  ANA: { arom: 6600, puro: 1500, acess: 1000 },
  BIA: { arom: 5000, puro: 1800, acess: 3300 },
  CAU: { arom: 4000 },
  DUDA: { arom: 2000, acess: 500 },
  'SEM VENDEDOR': { arom: 1000 },
});

test('EQP-07: rateio — o total de comissões dividido igualmente entre quem recebe; a soma = montante', () => {
  const res = calc(EQUIPE_RATEIO(), { metaLoja: 40000, regras: { rateio: { ativo: true, exclui: [' Bia '] }, semComissao: ['cau'] } });
  const montante = res.rows.reduce((s, r) => s + r.base + r.premiacao, 0);
  assert.ok(montante > 0);
  // fora do rateio: BIA (excluída), CAU (não recebe comissão) e SEM VENDEDOR
  for (const n of ['BIA', 'CAU', 'SEM VENDEDOR']) assert.equal(res.linha(n).aPagar, 0, n + ' fica fora e recebe 0');
  // a comissão da BIA (excluída do rateio) continua no montante dividido
  assert.ok(res.linha('BIA').base > 0);
  perto(res.linha('ANA').aPagar, montante / 2);
  perto(res.linha('DUDA').aPagar, montante / 2);
  perto(res.rows.reduce((s, r) => s + r.aPagar, 0), montante, 'soma do que cada um recebe = montante');
  perto(res.total.aPagar, montante);
});

test('EQP-07: rateio com o filtro de uma vendedora — a parte dela continua sendo o montante da loja ÷ quem recebe', () => {
  const regras = { rateio: { ativo: true, exclui: [] } };
  const loja = calc(EQUIPE_RATEIO(), { metaLoja: 40000, regras });
  const montante = loja.rows.reduce((s, r) => s + r.base + r.premiacao, 0);
  const recebem = loja.rows.filter((r) => r.vendedor !== 'SEM VENDEDOR').length;
  assert.equal(recebem, 4);
  const so = calc(EQUIPE_RATEIO(), { metaLoja: 40000, regras, base: (n) => n === 'DUDA' });
  assert.deepEqual(so.rows.map((r) => r.vendedor), ['DUDA']);
  perto(so.linha('DUDA').aPagar, montante / recebem);
  perto(so.total.aPagar, montante / recebem);
});

test('EQP-07: sem rateio cada um recebe a própria comissão; o modelo Vila vem com rateio ligado', () => {
  const sem = calc(EQUIPE_RATEIO(), { metaLoja: 40000 });
  for (const r of sem.rows) perto(r.aPagar, r.base, r.vendedor);
  const vila = calc(EQUIPE_RATEIO(), { metaLoja: 40000, regras: { modelo: 'vila' } });
  assert.equal(vila.regras.rateio.ativo, true);
  const montante = vila.rows.reduce((s, r) => s + r.base + r.premiacao, 0);
  perto(vila.linha('ANA').aPagar, montante / 4, 'ANA, BIA, CAU e DUDA dividem; SEM VENDEDOR fora');
  assert.equal(vila.linha('SEM VENDEDOR').aPagar, 0);
});

// ======================= EQP-09 férias (rota do admin, sem subir o servidor) =======================
/** registra as rotas do admin num app de mentira e devolve o handler da rota de férias (lojaPermitida + handler) */
let tmpDir = null;
after(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });
function rotaFerias() {
  if (!process.env.DATA_DIR) process.env.DATA_DIR = tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comissao-regras-'));
  process.env.CONFIG_FILE = process.env.CONFIG_FILE || path.join(process.env.DATA_DIR, 'lojas.json');
  const C = require('../../src/config');
  const ADMIN = require('../../src/admin-api');
  let router = null;
  const app = { use: (p, r) => { if (p === '/api/admin') router = r; } };
  ADMIN.registrar(app, { dadosLoja: async () => ({}), pacoteLimpar: () => {}, vendedoresDe: () => [], rawDe: () => null, totaisSemEG: () => ({}), vendasMetaMes: () => ({}), MAX_UPLOAD_MB: 1, NOTIF: {}, obterIndicadores: async () => null, arquivoLogo: () => null, LOGO_EXT: [] });
  assert.ok(router, 'admin-api registra o roteador em /api/admin');
  const layer = router.stack.find((l) => l.route && l.route.path === '/lojas/:id/ferias' && l.route.methods.put);
  assert.ok(layer, 'rota PUT /lojas/:id/ferias existe');
  const pilha = layer.route.stack.map((s) => s.handle);
  // [lojaPermitida, express.json, handler]: o corpo já vem pronto, o json é pulado
  const lojaPermitida = pilha[0], handler = pilha[pilha.length - 1];
  return (body, { perfil = 'admin', lojaId = 'teste', lojasDele = [] } = {}) => {
    const cfg = { lojas: [{ id: 'teste', nome: 'Loja Teste', ferias: [] }, { id: 'outra', nome: 'Outra', ferias: [] }] };
    const auditoria = [];
    const orig = { get: C.get, alterar: C.alterar, auditar: C.auditar };
    C.get = () => cfg;
    C.alterar = (fn) => fn(cfg);
    C.auditar = (...a) => auditoria.push(a);
    const out = { status: 200, json: null };
    const res = { status(s) { out.status = s; return res; }, json(j) { out.json = j; return res; } };
    const req = { perfil, user: 'dono', params: { id: lojaId }, body, lojas: lojasDele.map((id) => cfg.lojas.find((l) => l.id === id)) };
    try {
      let seguiu = false;
      lojaPermitida(req, res, () => { seguiu = true; });
      if (seguiu) handler(req, res);
    } finally { Object.assign(C, orig); }
    return { ...out, cfg, auditoria, ferias: cfg.lojas[0].ferias };
  };
}

test('EQP-09: férias válidas são gravadas (nome em maiúsculas, ordenadas pelo início) e auditadas', () => {
  const put = rotaFerias();
  const r = put({ ferias: [
    { vendedor: ' bia\n', de: '2026-12-01', ate: '2026-12-20' },
    { vendedor: 'Ana', de: '2026-11-03', ate: '2026-11-03', extra: 'some' },
  ] });
  assert.equal(r.status, 200); assert.deepEqual(r.json, { ok: true });
  assert.deepEqual(r.ferias, [
    { vendedor: 'ANA', de: '2026-11-03', ate: '2026-11-03' },
    { vendedor: 'BIA', de: '2026-12-01', ate: '2026-12-20' },
  ]);
  assert.equal(r.auditoria.length, 1);
  const [user, acao, alvo, det] = r.auditoria[0];
  assert.equal(user, 'dono'); assert.equal(acao, 'alterou férias'); assert.equal(alvo, 'teste');
  assert.deepEqual(det, { loja: 'teste', periodos: ['ANA 2026-11-03→2026-11-03', 'BIA 2026-12-01→2026-12-20'] });
  // lista vazia apaga as férias
  const vazio = put({ ferias: [] });
  assert.equal(vazio.status, 200); assert.deepEqual(vazio.ferias, []);
});

test('EQP-09: até 300 períodos; lista inválida, sem vendedora ou com datas trocadas é recusada sem gravar nem auditar', () => {
  const put = rotaFerias();
  const p = (n) => Array.from({ length: n }, (_, i) => ({ vendedor: 'ANA', de: '2026-01-01', ate: '2026-01-0' + ((i % 9) + 1) }));
  assert.equal(put({ ferias: p(300) }).status, 200, '300 períodos passam');
  const recusas = [
    [{ ferias: p(301) }, /inválida/],
    [{ ferias: 'x' }, /inválida/],
    [{}, /inválida/],
    [null, /inválida/],
    [{ ferias: [{ vendedor: '  ', de: '2026-01-01', ate: '2026-01-02' }] }, /vendedora/],
    [{ ferias: [null] }, /vendedora/],
    [{ ferias: [{ vendedor: 'ANA', de: '2026-01-10', ate: '2026-01-09' }] }, /início antes do fim/],
    [{ ferias: [{ vendedor: 'ANA', de: '2026-1-10', ate: '2026-01-19' }] }, /datas/],
    [{ ferias: [{ vendedor: 'ANA', de: '10/01/2026', ate: '2026-01-19' }] }, /datas/],
    [{ ferias: [{ vendedor: 'ANA', de: '2026-01-10' }] }, /datas/],
    // um período ruim no meio recusa a lista toda
    [{ ferias: [{ vendedor: 'ANA', de: '2026-01-01', ate: '2026-01-02' }, { vendedor: 'BIA', de: '2026-02-05', ate: '2026-02-01' }] }, /BIA/],
  ];
  for (const [body, msg] of recusas) {
    const r = put(body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    assert.match(r.json.erro, msg);
    assert.deepEqual(r.ferias, [], 'nada gravado');
    assert.equal(r.auditoria.length, 0, 'nada auditado');
  }
});

test('EQP-09: franqueado só mexe nas férias das lojas dele', () => {
  const put = rotaFerias();
  const corpo = { ferias: [{ vendedor: 'ANA', de: '2026-01-01', ate: '2026-01-02' }] };
  const alheia = put(corpo, { perfil: 'franqueado', lojaId: 'teste', lojasDele: ['outra'] });
  assert.equal(alheia.status, 404); assert.deepEqual(alheia.ferias, []); assert.equal(alheia.auditoria.length, 0);
  const dele = put(corpo, { perfil: 'franqueado', lojaId: 'teste', lojasDele: ['teste'] });
  assert.equal(dele.status, 200); assert.equal(dele.ferias.length, 1);
});

test('EQP-09: data que não existe no calendário (mês 13, 31/02) é recusada', () => {
  const put = rotaFerias();
  for (const [de, ate] of [['2026-13-01', '2026-13-45'], ['2026-02-31', '2026-03-05'], ['2026-00-10', '2026-01-10']]) {
    assert.equal(put({ ferias: [{ vendedor: 'ANA', de, ate }] }).status, 400, `${de} → ${ate}`);
  }
});

// ======================= EQP-10 o que a vendedora recebe (filtrarPorPerfil, sem subir o servidor) =======================
/** filtrarPorPerfil tirada do texto do server.js (não é exportada e o server.js sobe o servidor ao carregar) */
function filtrarPorPerfil() {
  const src = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const ini = src.indexOf('function filtrarPorPerfil(');
  assert.ok(ini >= 0, 'filtrarPorPerfil não encontrada no server.js: atualize este teste');
  // a função termina na primeira linha "}" sem recuo depois do início
  const fim = src.indexOf('\n}\n', ini);
  assert.ok(fim > ini);
  const corpo = src.slice(ini, fim + 2);
  const req = (p) => require(path.join(RAIZ, p));
  // eslint-disable-next-line no-new-func
  return new Function('crypto', 'SECRET', 'require', corpo + '\nreturn filtrarPorPerfil;')(require('crypto'), 'segredo-de-teste', req);
}
const PACOTE = () => ({
  vendas: [
    { vendedor: 'ANA', vt: 10 }, { vendedor: 'BIA', vt: 20 }, { vendedor: 'cau ', vt: 5 }, { vendedor: 'SEM VENDEDOR', vt: 1 },
  ],
  xml: [{ cpf: '1' }], clientes: [{ nome: 'Cliente' }], fidelidade: [{ x: 1 }],
  metaCfgs: [{
    id: 'teste', nomesVenda: [LOJA],
    contabilidade: [{ valor: 1 }],
    escalaAjustes: { '2026-11': { BIA: { '2026-11-03': 'folga' } } },
    feriadosAcerto: { '2026-11-15': { BIA: 'pagar' } },
    bancoHoras: { BIA: [{ horas: 12 }] },
    feriadosHoras: { '2026-11': { '2026-11-15': { ANA: 6, BIA: 6, Cau: 4 } } },
    operacao: { funcionamento: { dom: { fechado: true } }, equipe: { funcionarios: 3, cargaSemanal: 44, nomes: ['ANA', 'BIA'], pessoas: [{ nome: 'BIA' }] } },
    ferias: [{ vendedor: 'BIA', de: '2026-12-01', ate: '2026-12-10' }, { vendedor: 'ana', de: '2026-11-01', ate: '2026-11-02' }],
    regras: { modelo: 'padrao', semMeta: ['bia'], semComissao: ['DUDA'], rateio: { ativo: true, exclui: ['cau'] } },
  }],
});

test('EQP-10: vendedora não recebe escala, banco de horas, horas de feriado nem a equipe das colegas', () => {
  const f = filtrarPorPerfil();
  const out = f(PACOTE(), 'vendedor:Ana');
  const m = out.metaCfgs[0];
  assert.deepEqual(m.escalaAjustes, {}, 'escala (ajustes) das colegas');
  assert.deepEqual(m.feriadosAcerto, {});
  assert.equal(m.bancoHoras, null, 'banco de horas: só gestão');
  assert.deepEqual(m.contabilidade, []);
  assert.deepEqual(m.feriadosHoras, { '2026-11': { '2026-11-15': { ANA: 6 } } }, 'só as próprias horas de feriado');
  assert.equal(m.operacao.equipe.nomes, undefined, 'nomes da equipe');
  assert.equal(m.operacao.equipe.pessoas, undefined);
  assert.equal(m.operacao.equipe.cargaSemanal, 44, 'o horário da loja continua');
  assert.deepEqual(m.operacao.funcionamento, { dom: { fechado: true } });
  // sem dados de clientes
  assert.deepEqual(out.clientes, []); assert.deepEqual(out.xml, []); assert.deepEqual(out.fidelidade, []);
});

test('EQP-10: vendedora vê as colegas só como "COLEGA n" (vendas, férias e listas das regras); o nome dela e SEM VENDEDOR ficam', () => {
  const f = filtrarPorPerfil();
  const out = f(PACOTE(), 'vendedor: ana ');
  const nomes = out.vendas.map((v) => v.vendedor);
  assert.equal(nomes[0], 'ANA');
  assert.equal(nomes[3], 'SEM VENDEDOR');
  for (const n of nomes.slice(1, 3)) assert.match(n, /^COLEGA \d+$/);
  assert.notEqual(nomes[1], nomes[2], 'cada colega tem o seu apelido');
  const texto = JSON.stringify(out);
  for (const n of ['BIA', 'CAU', 'Cau', 'DUDA']) assert.ok(!texto.includes(`"${n}`), `${n} não pode aparecer`);
  const m = out.metaCfgs[0];
  assert.equal(m.ferias[0].vendedor, nomes[1], 'férias da BIA com o mesmo apelido das vendas');
  assert.equal(m.ferias[1].vendedor, 'ana', 'as próprias férias ficam com o nome');
  assert.deepEqual(m.regras.semMeta, [nomes[1]]);
  assert.deepEqual(m.regras.rateio.exclui, [nomes[2]]);
  assert.match(m.regras.semComissao[0], /^COLEGA \d+$/, 'quem só aparece nas regras também vira colega');
  // o pacote original não é alterado
  const orig = PACOTE();
  f(orig, 'vendedor:ANA');
  assert.equal(orig.vendas[1].vendedor, 'BIA');
  assert.ok(orig.metaCfgs[0].bancoHoras);
});

test('EQP-10: gestão recebe a escala e a equipe; gerente (dados sem clientes) também, só sem clientes', () => {
  const f = filtrarPorPerfil();
  const p = PACOTE();
  assert.strictEqual(f(p, 'completo'), p, 'completo: o pacote inteiro');
  const ger = f(PACOTE(), 'gerente');
  assert.deepEqual(ger.clientes, []); assert.deepEqual(ger.xml, []);
  assert.deepEqual(ger.vendas.map((v) => v.vendedor), ['ANA', 'BIA', 'cau ', 'SEM VENDEDOR']);
  assert.ok(ger.metaCfgs[0].bancoHoras);
  assert.deepEqual(ger.metaCfgs[0].operacao.equipe.nomes, ['ANA', 'BIA']);
});
