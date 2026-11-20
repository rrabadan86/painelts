// Contas oficiais: o mesmo faturamento em todas as telas, vendas da meta, projeção única, comissão só dentro de um mês,
// quem divide a meta, premiação com mínimo de atendimentos e comparações justas (28 dias, ano anterior = 364 dias).
const { test, expect } = require('@playwright/test');

const abrir = async (page) => { await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas' && TS.contas); };
const ir = (page, tela) => page.evaluate((t) => { location.hash = '#' + t; }, tela);
const semRolagemLateral = async (page) => { const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); expect(d).toBeLessThanOrEqual(1); };
/** "R$ 12.345" → 12345 */
const num = (t) => +String(t).replace(/[^\d,-]/g, '').replace(',', '.');

test('Faturamento do mês: o mesmo número no Resumo, no Início e no Resultado', async ({ page }) => {
  await abrir(page);
  // a conta única, direto nos dados da apresentação
  const oficial = await page.evaluate(() => {
    const db = TS.db, ym = TS.dayToIso(db.maxDay).slice(0, 7);
    let s = 0;
    for (let i = 0; i < db.n; i++) if (db.ym[i] === ym && TS.contas.contaFat(db.D.descricao[db.desc[i]], db.vu[i])) s += db.vt[i] || 0;
    return Math.round(s);
  });
  expect(oficial).toBeGreaterThan(0);
  // Resumo, mês atual
  await page.evaluate(() => { TS.aplicarPreset('mes'); location.hash = '#resumo'; });
  const fatResumo = page.locator('main .kpi', { hasText: 'Faturamento' }).first().locator('.kpi-value');
  await expect(fatResumo).toBeVisible({ timeout: 20000 });
  expect(Math.abs(num(await fatResumo.textContent()) - oficial)).toBeLessThanOrEqual(1);
  // Início
  await ir(page, 'inicio');
  const mes = page.locator('main .kpi', { hasText: 'Mês até agora' });
  await expect(mes).toBeVisible();
  expect(Math.abs(num(await mes.locator('.kpi-value').textContent()) - oficial)).toBeLessThanOrEqual(1);
  // o "% da meta" usa as vendas da meta (chás e acessórios, sem Espaço Gourmet), e o texto diz isso
  await expect(mes.locator('.kpi-foot')).toContainText(/vendas da meta R\$\s[\d.]+ = \d+% da meta de R\$/);
  const pct = await mes.locator('[data-pct-meta]').getAttribute('data-pct-meta');
  const esperado = await page.evaluate(() => { const db = TS.db, ym = TS.dayToIso(db.maxDay).slice(0, 7); const idx = TS.filtrar({ de: TS.isoToDay(ym + '-01'), ate: db.maxDay, mesLivre: true }); return TS.rules.vendasMeta(idx) / TS.metaCalc(ym).valor; });
  expect(Math.abs(+pct - esperado)).toBeLessThan(0.0002);
  // o dia em andamento fica fora da comparação e da projeção; a projeção abre a conta no ⓘ
  const proj = page.locator('main .kpi', { hasText: 'Projeção do mês' });
  await expect(proj.locator('.dica-i')).toHaveAttribute('aria-label', /média do mesmo dia da semana|média simples por dia aberto/);
  await semRolagemLateral(page);
  // Resultado
  await ir(page, 'dre');
  const fatDre = page.locator('main .g-kpi .kpi', { hasText: 'Faturamento' }).first().locator('.kpi-value');
  await expect(fatDre).toBeVisible({ timeout: 30000 });
  expect(Math.abs(num(await fatDre.textContent()) - oficial)).toBeLessThanOrEqual(1);
  // a coluna da variação diz com o que compara (o mês inteiro do ano anterior)
  const cab = page.locator('.dre-t thead th.dre-var').first();
  await expect(cab).toHaveText(/^(Projeção × \w{3}\/\d{2} inteiro|Variação)$/);
  await semRolagemLateral(page);
});

test('Projeção: uma conta só no Início, no Resumo, no Resultado e no equilíbrio', async ({ page }) => {
  await abrir(page);
  const p = await page.evaluate(() => { const ym = TS.dayToIso(TS.db.maxDay).slice(0, 7); const P = TS.projecaoMes(ym, { base: 'loja' }); return P ? { proj: Math.round(P.proj), real: P.realizado, hoje: P.hoje, feitos: P.feitos, n: P.n } : null; });
  test.skip(!p, 'a apresentação está com o mês fechado');
  await ir(page, 'inicio');
  const ini = page.locator('main .kpi', { hasText: 'Projeção do mês' }).locator('.kpi-value');
  await expect(ini).toBeVisible();
  expect(Math.abs(num(await ini.textContent()) - p.proj)).toBeLessThanOrEqual(1);
  await page.evaluate(() => { TS.aplicarPreset('mes'); location.hash = '#resumo'; });
  const res = page.locator('main .kpi', { hasText: 'Projeção do faturamento' }).locator('.kpi-value');
  await expect(res).toBeVisible({ timeout: 20000 });
  expect(Math.abs(num(await res.textContent()) - p.proj)).toBeLessThanOrEqual(1);
  // Resultado: "vendendo R$ X no mês" é a mesma projeção; e a barra do equilíbrio também
  await ir(page, 'dre');
  const dre = page.locator('main .g-kpi .kpi', { hasText: 'Projeção do mês' }).locator('.kpi-foot');
  await expect(dre).toBeVisible({ timeout: 30000 });
  expect(Math.abs(num((await dre.textContent()).replace(/no mês.*$/, '')) - p.proj)).toBeLessThanOrEqual(1);
  const barra = page.locator('.est-eq .est-eq-barra u');
  if (await barra.count()) expect(Math.abs(num(await barra.getAttribute('title')) - p.proj)).toBeLessThanOrEqual(1);
});

test('Comissionamento: só calcula dentro de um mês; meta dividida, vendas da meta e etiqueta de mês parcial', async ({ page }, info) => {
  await abrir(page);
  // período padrão (28 dias) passa de um mês: aviso "escolha um mês" em vez de somar dois meses contra uma meta
  await page.evaluate(() => { TS.aplicarPreset('30d'); location.hash = '#comissionamento'; });
  const passaDeUmMes = await page.evaluate(() => !TS.periodoUmMes());
  const aviso = page.locator('.notice[data-aviso="escolha-um-mes"]');
  if (passaDeUmMes) {
    await expect(aviso).toContainText('Escolha um mês');
    await expect(page.locator('main table.t')).toHaveCount(0);
    await aviso.getByRole('button', { name: 'Ver o mês atual' }).click();
  } else await page.evaluate(() => { TS.aplicarPreset('mes'); TS.render(); });
  await expect(aviso).toHaveCount(0);
  const meta = page.locator('main .kpi', { hasText: 'Meta da loja' });
  await expect(meta.locator('.kpi-foot')).toContainText(/Meta dividida entre \d+ pessoas?/);
  await expect(meta.locator('.dica-i')).toHaveAttribute('aria-label', /dias? com venda no mês/);
  await expect(page.locator('main .kpi', { hasText: 'Vendas da meta' })).toBeVisible();
  // o que a tela mostra é o que a regra devolve: divisores e quem ficou de fora
  const r = await page.evaluate(() => { const b = TS.filtrar(); const x = TS.rules.comissionamento({ base: b, baseSemVend: b, metaLoja: TS.metaPeriodo().valor || 0, vendBonus: '', ym: TS.metaPeriodo().ym, ate: TS.db.maxDay }); return { n: x.qtdVend, fora: x.foraDaMeta.length, poucos: x.rows.filter((y) => y.poucosAtend).length, piso: x.piso }; });
  await expect(meta.locator('[data-meta-div]')).toHaveAttribute('data-meta-div', String(r.n));
  await expect(page.locator('[data-fora-meta]')).toHaveCount(r.fora ? 1 : 0);
  // mês em andamento: etiqueta avisa que a faixa ainda pode mudar
  const parcial = await page.evaluate(() => TS.metaPeriodo().ym === TS.hojeSP().slice(0, 7));
  if (parcial) await expect(page.locator('.com-parcial')).toContainText('parcial: a faixa pode mudar até o fim do mês');
  // premiação: quem tem poucos atendimentos aparece com o motivo
  if (r.poucos) await expect(page.locator('main', { hasText: 'poucos atendimentos (' }).first()).toBeVisible();
  // período personalizado dentro do mês continua valendo; passando de um mês, volta o aviso
  await page.evaluate(() => { const f = TS.state.f, d = new Date(TS.db.maxDay * 864e5); f.preset = 'custom'; f.ano = null; f.mes = null; f.ate = TS.db.maxDay; f.de = TS.db.maxDay - d.getUTCDate() - 3; TS.render(); });
  await expect(aviso).toContainText('Escolha um mês');
  if (info.project.name === 'celular') await semRolagemLateral(page);
});

test('Período "28 dias" e "vs. ano anterior" pelos mesmos dias da semana', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(() => {
    TS.aplicarPreset('30d');
    const f = TS.state.f, pi = TS.periodosIguais(f.de, f.ate);
    return { dias: f.ate - f.de + 1, preset: f.preset, ano: f.de - pi.ano.de, rotulo: TS.PRESETS.find((p) => p[1] === '30d')[0] };
  });
  expect(r).toEqual({ dias: 28, preset: '30d', ano: 364, rotulo: '28 dias' });
  await ir(page, 'resumo');
  const fat = page.locator('main .kpi', { hasText: 'Faturamento' }).first();
  await expect(fat.locator('.kpi-vars')).toBeVisible({ timeout: 20000 });
  const linhas = await fat.locator('.kpi-vars > span').evaluateAll((xs) => xs.map((x) => [x.textContent, x.title]));
  expect(linhas.some(([t, d]) => /· 28 dias$/.test(t) && d === 'vs. 28 dias anteriores')).toBe(true);
});

test('Regras da loja: piso de dias da meta e mínimo de atendimentos da premiação aparecem com explicação', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'só no computador');
  await abrir(page);
  const padrao = await page.evaluate(() => { const rg = TS.rules.MODELOS.padrao.regras; return { piso: rg.pisoDiasMeta, min: rg.premiacao.minAtend, c: [TS.contas.PISO_DIAS_META, TS.contas.MIN_ATEND_PREMIACAO] }; });
  expect(padrao).toEqual({ piso: 4, min: 20, c: [4, 20] });
  // Configurações → loja → Regras de comissão: os dois campos novos, com o padrão e a explicação
  await page.evaluate(() => { location.hash = '#config'; });
  await page.locator('table.cfg-lojas-t .cfg-abrir').first().click();
  const card = page.locator('.cfg-loja');
  const links = card.locator('.cfg-sub a');
  const n = await links.count();
  const piso = card.locator('input[data-regra="pisoDiasMeta"]');
  for (let k = 0; k < n && !(await piso.count()); k++) { await links.nth(k).evaluate((el) => el.click()); await page.waitForTimeout(150); }
  await expect(piso).toHaveValue('4');
  await expect(card.locator('input[data-regra="minAtend"]')).toHaveValue('20');
  await expect(card.locator('.cfg-loja-corpo')).toContainText('Divide a meta quem tem pelo menos');
  await expect(card.locator('.cfg-loja-corpo')).toContainText('Mínimo de atendimentos no mês');
});
