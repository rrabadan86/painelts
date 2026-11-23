// VAL-NF-01: na Validade, o "NF nº" do lote abre a janela da nota de entrada por cima da tela (a mesma de Estoque → Notas fiscais)
const { test, expect } = require('@playwright/test');

test('VAL-NF-01: Validade → clicar no "NF …" do lote abre a nota de entrada sem sair da tela', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#validade'; });
  const bt = page.locator('main .vl-nf').first();
  await expect(bt).toBeVisible({ timeout: 30000 });
  const nf = (await bt.innerText()).replace(/\D/g, '');
  await bt.click();
  const janela = page.locator('.prc-drawer');
  await expect(janela).toBeVisible({ timeout: 30000 });
  await expect(janela).toContainText('NF ' + nf);
  expect(await page.evaluate(() => location.hash)).toBe('#validade'); // continua na Validade
  await page.keyboard.press('Escape');
  await expect(janela).toHaveCount(0);
  await expect(page.locator('main .vl-nf').first()).toBeVisible();
  expect(erros).toEqual([]);
});
