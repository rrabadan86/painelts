// Redesenho de 22/11/2026 (linguagem do protótipo do Início, decisão do dono) nas telas de Produtos e Estoque:
// RD-EST-01 cartão-herói em Rentabilidade, Preços, Site e Validade, com os números levando à aba deles
// RD-EST-02 sem rolagem para o lado nas tabelas do Estoque, Rentabilidade, Validade e Site (1100 px e letra mais larga)
const { test, expect } = require('./_base');

async function abrir(page, hash) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await expect(page.locator('.page-title').first()).toBeVisible({ timeout: 30000 });
}

test('RD-EST-01: Rentabilidade, Preços, Site e Validade abrem com o cartão-herói (sem a grade de quadros)', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page, '#rentab');
  const hr = page.locator('main .heroi').first();
  await expect(hr).toContainText('Lucro bruto');
  await expect(hr).toContainText('Lucro sem fixos');
  await expect(hr).toContainText('Lucro com fixos');
  await expect(hr).toContainText(/vendas com custo: \d+%/);
  // "ver a conta" abre a mesma janela da conta de antes
  await hr.getByRole('button', { name: 'ver a conta ›' }).first().click();
  await expect(page.locator('.est-pop')).toBeVisible();
  await page.keyboard.press('Escape');

  await abrir(page, '#precos');
  const hp = page.locator('main .heroi').first();
  await expect(hp).toContainText('Perderam margem');
  await expect(page.locator('main .g-kpi')).toHaveCount(0);
  await hp.getByRole('button', { name: 'ver os reajustes de custo ›' }).click();
  await expect(page.locator('.seg button.on').first()).toHaveText(/Custo alterado \(\d+\)/);

  await abrir(page, '#site');
  const hs = page.locator('main .heroi').first();
  await expect(hs).toContainText('Preço diferente');
  await expect(page.locator('main .g-kpi')).toHaveCount(0);
  const dif = hs.getByRole('button', { name: 'ver os diferentes ›' });
  if (await dif.count()) { await dif.click(); await expect(page.locator('.seg button.on').first()).toHaveText(/Preço diferente \(\d+\)/); }

  await abrir(page, '#validade');
  const hv = page.locator('main .heroi.vl-resumo');
  await expect(hv).toContainText('Valor em risco');
  await expect(hv.locator('.vl-chip').first()).toBeVisible();
  expect(erros).toEqual([]);
});

test('RD-EST-02: tabelas sem rolagem para o lado a 1100 px, mesmo com a letra mais larga', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.setViewportSize({ width: 1100, height: 900 });
  const sobra = () => page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('main .table-wrap')].map((w) => w.scrollWidth - w.clientWidth)));
  for (const [hash, abas] of [['#estoque', ['O que repor', 'Todos', 'Parados', 'Perdendo venda']], ['#rentab', ['Produtos', 'Margem de tabela', 'Vendedoras', 'Kits']], ['#validade', []], ['#site', []]]) {
    await abrir(page, hash);
    await page.addStyleTag({ content: '* { letter-spacing: 1.2px !important }' });
    await expect(page.locator('main .table-wrap').first()).toBeVisible({ timeout: 30000 });
    expect(await sobra(), `${hash}: rolagem para o lado`).toBeLessThanOrEqual(2);
    for (const a of abas) {
      await page.locator('main .seg button', { hasText: a }).first().click();
      await expect(page.locator('main .table-wrap').first()).toBeVisible();
      expect(await sobra(), `${hash} · ${a}: rolagem para o lado`).toBeLessThanOrEqual(2);
    }
  }
});
