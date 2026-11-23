const { test, expect } = require('./_base');

// Configurações → Lojas: nenhuma seção pode escrever "null"/"undefined" na tela (ex.: linha opcional vazia em replaceChildren)
test('Configurações: lojas em tabela; cada loja abre e todas as seções aparecem sem "null" ou "undefined"', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#config'; });
  // lista de lojas em tabela (padrão do painel); "Abrir ›" mostra a loja e "‹ Lojas" volta
  const tab = page.locator('table.cfg-lojas-t');
  await expect(tab).toBeVisible();
  const total = await tab.locator('tbody tr').count();
  expect(total).toBeGreaterThan(1);
  for (let c = 0; c < total; c++) {
    if (await page.locator('.cfg-voltar button').count()) await page.locator('.cfg-voltar button').click();
    await tab.locator('.cfg-abrir').nth(c).click();
    const card = page.locator('.cfg-loja');
    await expect(card).toHaveCount(1);
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
