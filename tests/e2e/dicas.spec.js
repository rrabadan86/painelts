const { test, expect } = require('@playwright/test');

// Preços: cada coluna tem ⓘ que explica o campo — no cabeçalho (computador) e no rótulo do cartão (celular)
test('Preços: ⓘ explica Cadastro e "vendas −X%" no computador e no celular', async ({ page }, info) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#precos'; });
  const tab = page.locator('table.prc-t');
  await expect(tab).toBeVisible();
  const celular = info.project.name === 'celular';
  const alvo = celular ? tab.locator('tbody td.com-dica .mob-rot', { hasText: 'Cadastro' }).first() : tab.locator('thead th', { hasText: 'Cadastro' });
  await expect(alvo).toBeVisible();
  if (celular) await alvo.locator('.dica-i').tap(); else await alvo.locator('.dica-i').click();
  await expect(page.locator('.dica-balao')).toContainText('vendas −X%');
  // ⓘ no cabeçalho não reordena a tabela
  if (!celular) await expect(tab.locator('thead th.sorted')).not.toContainText('Cadastro');
  // o rótulo do cartão continua um só (sem o rótulo do CSS repetido)
  if (celular) {
    const antes = await tab.locator('tbody td.com-dica').first().evaluate((td) => getComputedStyle(td, '::before').content);
    expect(antes).toBe('none');
  }
  const larga = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(larga).toBeLessThanOrEqual(1);
});
