const { test, expect } = require('@playwright/test');

// Configurações → Lojas: nenhuma seção pode escrever "null"/"undefined" na tela (ex.: linha opcional vazia em replaceChildren)
test('Configurações: todas as seções das lojas abrem sem "null" ou "undefined" escrito na tela', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#config'; });
  await expect(page.locator('.cfg-loja-cab').first()).toBeVisible();
  const cards = await page.locator('.cfg-loja-cab').count();
  for (let c = 0; c < cards; c++) {
    // abre a loja (as lojas começam fechadas) e passa por todas as seções
    const cab = page.locator('.cfg-loja-cab').nth(c);
    if ((await cab.getAttribute('aria-expanded')) !== 'true') await cab.evaluate((b) => b.click());
    const card = page.locator('.cfg-loja').nth(c);
    await expect(card.locator('.cfg-sub')).toBeVisible();
    const links = card.locator('.cfg-sub a');
    const n = await links.count();
    for (let k = 0; k < n; k++) {
      await links.nth(k).evaluate((a) => a.click());
      await page.waitForTimeout(150);
      const texto = await card.locator('.cfg-loja-corpo').innerText();
      expect(texto, `seção ${k + 1} da loja ${c + 1}`).not.toMatch(/(^|\s)(null|undefined)(\s|$)/m);
    }
  }
  expect(erros).toEqual([]);
});
