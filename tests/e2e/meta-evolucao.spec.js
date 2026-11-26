// META-EVO-01: % da meta na Evolução mensal (Comparativos) — etiqueta embaixo do faturamento, que abre a janela com a conta.
const { test, expect } = require('./_base');

const abrir = async (page) => { await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas' && TS.contas); };

test('META-EVO-01: o % da meta do mês é vendas da meta ÷ meta, e a janela mostra a conta', async ({ page }) => {
  await abrir(page);
  await page.evaluate(() => { TS.aplicarPreset('mes'); location.hash = '#comparativos'; });
  const ym = await page.evaluate(() => TS.dayToIso(TS.db.maxDay).slice(0, 7));
  // a conta oficial: as mesmas vendas da meta do Início, contra a meta do mês
  const esperado = await page.evaluate((y) => {
    const db = TS.db, ini = TS.isoToDay(y + '-01');
    const idx = TS.filtrar({ de: ini, ate: db.maxDay, mesLivre: true });
    return TS.rules.vendasMeta(idx) / TS.metaCalc(y).valor;
  }, ym);
  const mt = await page.evaluate((y) => { const m = TS.metaMes(y); return m && { pct: m.pct, fechado: m.fechado }; }, ym);
  expect(mt).not.toBeNull();
  expect(Math.abs(mt.pct - esperado)).toBeLessThan(0.0002);
  const selo = page.locator(`#cp-evol .meta-selo[data-meta="${ym}"]`).first();
  await expect(selo).toBeVisible({ timeout: 20000 });
  const txt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(esperado * 100) + '%';
  await expect(selo).toContainText(txt);
  await expect(selo).toHaveClass(mt.fechado ? /ok|nao/ : /ok|and/);
  await selo.click();
  const jan = page.locator('.meta-j');
  await expect(jan).toBeVisible();
  await expect(jan).toContainText('Meta da loja');
  await expect(jan).toContainText('Vendas da meta');
  await expect(jan).toContainText('Faturamento (com Espaço Gourmet)');
  await expect(jan.locator('.meta-j-pct')).toContainText(txt);
  await page.keyboard.press('Escape');
  await expect(jan).toHaveCount(0);
});

test('META-EVO-01: cada vendedor com o % da meta individual da comissão', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'árvore do computador');
  await abrir(page);
  await page.evaluate(() => { TS.aplicarPreset('mes'); location.hash = '#comparativos'; });
  await expect(page.locator('#cp-evol .meta-selo').first()).toBeVisible({ timeout: 20000 });
  await page.locator('#cp-evol').getByRole('button', { name: 'Expandir tudo' }).click();
  const sv = page.locator('#cp-evol .meta-selo[data-meta-vend]').first();
  await expect(sv).toBeVisible();
  const id = +(await sv.getAttribute('data-meta-vend'));
  const conf = await page.evaluate((v) => {
    const ym = TS.dayToIso(TS.db.maxDay).slice(0, 7), ini = TS.isoToDay(ym + '-01');
    const idx = TS.filtrar({ de: ini, ate: TS.db.maxDay, mesLivre: true, ignorar: ['vendedores'] });
    const r = TS.rules.comissionamento({ base: idx, baseSemVend: idx, metaLoja: TS.metaCalc(ym).valor, vendBonus: '', ym }).rows.find((x) => x.vendedorId === v);
    return r.total / r.metaInd;
  }, id);
  const txt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(conf * 100) + '%';
  await expect(sv).toContainText(txt);
  await sv.click();
  await expect(page.locator('.meta-j')).toContainText('Meta individual');
});
