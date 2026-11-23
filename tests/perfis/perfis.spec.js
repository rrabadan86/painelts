// PERFIL-TELA-01…05: o painel de verdade (não a apresentação) visto por cada perfil, NA TELA. O servidor sobe com dados
// fictícios (tests/perfis/preparar.js) e o teste entra pelo /login. Confere o menu contra a lista única de telas
// (src/telas.js), que a vendedora não vê custo, margem nem dados de clientes (exceto a Lista de espera), que Minha comissão
// é só dela, que o gerente sem tela de custo não vê custo e que o franqueado só tem a loja dele no seletor.
// Os testes de servidor (tests/unit/permissoes-telas.test.js, seguranca.test.js) conferem as mesmas regras nas rotas.
const { test, expect } = require('../e2e/_base');
const fs = require('fs');
const path = require('path');
const T = require('../../src/telas');

const SENHA = 'senha-perfis-123';
const info = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../.dados-perfis/perfis.json'), 'utf8'));
// as mesmas telas do tests/perfis/preparar.js
const TELAS = {
  ger_custo: ['resumo', 'comparativos', 'estoque', 'validade', 'inventario', 'sugestoes', 'espera', 'mapa', 'checklist'],
  ger_sem: ['resumo', 'validade', 'inventario', 'sugestoes', 'espera', 'checklist'],
};
const CUSTO = /\bcusto\b|\bcustos\b|margem|\blucro\b|\bCMV\b/i;
const QUEBRADO = /(^|\s)(null|undefined|NaN)(\s|$)/;
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
// telas que mostram dados de clientes (a vendedora só usa a Lista de espera)
const PAGS_CLIENTES = ['hoje', 'clilista', 'clientes', 'campanhas', 'conversas'];

async function entrar(page, usuario) {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/login');
  await page.locator('input[name=usuario]').fill(usuario);
  await page.locator('input[name=senha]').fill(SENHA);
  await Promise.all([page.waitForURL((u) => !/\/login/.test(u.pathname)), page.locator('form[action="/login"] button, form[action="/login"] [type=submit]').first().click()]);
  await page.waitForFunction(() => window.TS && TS.eu && TS.db && TS.GRUPOS && TS.GRUPOS.length, null, { timeout: 60000 });
  return erros;
}
const menu = (page) => page.evaluate(() => TS.GRUPOS.flatMap(([, ps]) => ps));
/** as páginas que a lista única (src/telas.js) libera para o perfil */
function liberadas(perfil, telas) {
  const s = new Set();
  for (const t of T.TODAS) {
    const r = t[perfil];
    if (r === 'sempre' || (r === 'escolha' && (telas || T.PADRAO_GERENTE).includes(t.id))) for (const p of T.PAGINAS[t.id]) s.add(p);
  }
  return s;
}
async function abrirPagina(page, p) {
  await page.evaluate((h) => { location.hash = '#' + h; }, p);
  await expect(page.locator('.page-title').first()).toBeVisible({ timeout: 30000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(500);
  return page.evaluate(() => TS.state.page);
}
const texto = (page) => page.locator('main').innerText();

test('PERFIL-TELA-01: vendedora — só as telas dela, sem custo, margem nem dados de clientes', async ({ page }) => {
  const erros = await entrar(page, 'vend');
  const ps = await menu(page);
  const ok = liberadas('vendedor');
  expect(ps.filter((p) => !ok.has(p)), 'telas fora da regra da vendedora').toEqual([]);
  for (const p of ['minha', 'checklist', 'espera', 'sugestoes', 'validade', 'inventario']) expect(ps, `falta ${p}`).toContain(p);
  for (const p of ps) {
    expect(await abrirPagina(page, p)).toBe(p);
    const t = await texto(page);
    expect(t, `#${p}: custo/margem para a vendedora`).not.toMatch(CUSTO);
    expect(t, `#${p}: texto quebrado`).not.toMatch(QUEBRADO);
    if (p !== 'espera') expect(t, `#${p}: CPF na tela da vendedora`).not.toMatch(CPF);
    if (p === 'sugestoes') expect(t, '⭐ Sugestões: a vendedora não vê valor').not.toMatch(/R\$\s?\d/);
  }
  // telas proibidas pelo endereço: o painel não abre (volta para a primeira tela dela)
  for (const p of ['inicio', 'resumo', 'estoque', 'pedido', 'notas', 'rentab', 'precos', 'dre', 'orcamento', 'config', ...PAGS_CLIENTES]) {
    expect(await abrirPagina(page, p), `#${p} abriu para a vendedora`).not.toBe(p);
  }
  expect(erros).toEqual([]);
});

test('PERFIL-TELA-02: vendedora — Minha comissão só com os números dela (nenhuma colega aparece)', async ({ page }) => {
  const { vendedora, colegas } = info();
  const erros = await entrar(page, 'vend');
  expect(await abrirPagina(page, 'minha')).toBe('minha');
  // o cartão "Sua meta de hoje" vem da rota /api/meta-hoje (a parte dela): espera montar
  await expect(page.locator('main .md-minha .md-num, main .md-minha p').first()).toBeVisible({ timeout: 30000 });
  const t = await texto(page);
  expect(t, 'texto quebrado').not.toMatch(QUEBRADO);
  expect(vendedora).toBeTruthy();
  for (const c of colegas) expect(t.toUpperCase(), `colega ${c} na Minha comissão`).not.toContain(c);
  // não há seletor de vendedor nem tabela da equipe para ela
  expect(await page.locator('main select').evaluateAll((ss) => ss.filter((s) => [...s.options].some((o) => /[A-Z]{3,} [A-Z]{3,}/.test(o.text))).length)).toBe(0);
  expect(erros).toEqual([]);
});

test('PERFIL-TELA-03: gerente sem tela de custo — menu pela regra e nada de custo (Inventário, Validade, Resumo)', async ({ page }) => {
  const erros = await entrar(page, 'ger_sem');
  const ps = await menu(page);
  const ok = liberadas('gerente', TELAS.ger_sem);
  expect(ps.filter((p) => !ok.has(p)), 'telas fora da regra').toEqual([]);
  for (const p of ok) if (!['nfsaida', 'creditos', 'minha'].includes(p)) expect(ps, `falta ${p}`).toContain(p);
  for (const p of ['inventario', 'validade', 'resumo', 'sugestoes']) {
    expect(await abrirPagina(page, p)).toBe(p);
    const t = await texto(page);
    expect(t, `#${p}: custo para gerente sem tela de custo`).not.toMatch(/\bcusto\b|\bcustos\b|margem/i);
    expect(t, `#${p}: texto quebrado`).not.toMatch(QUEBRADO);
  }
  for (const p of ['estoque', 'pedido', 'notas', 'rentab', 'precos', 'dre', 'orcamento', 'config', 'conversas', ...PAGS_CLIENTES]) {
    expect(await abrirPagina(page, p), `#${p} abriu para o gerente sem a tela`).not.toBe(p);
  }
  expect(erros).toEqual([]);
});

test('PERFIL-TELA-04: gerente com a tela Estoque — vê o custo no Estoque e no Inventário (controle do teste anterior)', async ({ page }) => {
  const erros = await entrar(page, 'ger_custo');
  const ps = await menu(page);
  const ok = liberadas('gerente', TELAS.ger_custo);
  expect(ps.filter((p) => !ok.has(p)), 'telas fora da regra').toEqual([]);
  expect(await abrirPagina(page, 'estoque')).toBe('estoque');
  await expect(page.locator('main .heroi-col', { hasText: /estoque a custo/i }).first()).toBeVisible({ timeout: 30000 });
  for (const p of ['pedido', 'notas', 'rentab', 'dre', 'config']) expect(await abrirPagina(page, p), `#${p} abriu sem estar liberada`).not.toBe(p);
  expect(erros).toEqual([]);
});

test('PERFIL-TELA-05: franqueado — só a loja dele no seletor e as telas da regra do franqueado', async ({ page }) => {
  const erros = await entrar(page, 'dono');
  const ps = await menu(page);
  const ok = liberadas('franqueado');
  expect(ps.filter((p) => !ok.has(p)), 'telas fora da regra').toEqual([]);
  const opcoes = await page.locator('#lojaSel option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent })));
  expect(opcoes.map((o) => o.v).filter(Boolean).filter((v) => v !== 'l1'), 'outra loja no seletor').toEqual([]);
  expect(opcoes.map((o) => o.t).join('|')).not.toMatch(/Outro Franqueado/);
  expect(await page.evaluate(() => TS.state.loja)).toBe('l1');
  expect(erros).toEqual([]);
});
