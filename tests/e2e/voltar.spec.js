const { test, expect } = require('@playwright/test');
test('voltar do celular fecha a janela por cima e fica na mesma tela', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#inicio'; }); await page.waitForTimeout(800);
  await page.evaluate(() => { location.hash = '#cupons'; });
  await page.waitForTimeout(800);
  await page.locator('.exp-btn:not(.prt-btn)').first().click();
  await expect(page.locator('.camada-cheia')).toHaveCount(1);
  await page.goBack();
  await expect(page.locator('.camada-cheia')).toHaveCount(0);
  expect(await page.evaluate(() => location.hash)).toBe('#cupons');
  // fechando pelo X/fundo, o "voltar" seguinte já troca de tela (não sobra entrada)
  await page.locator('.exp-btn:not(.prt-btn)').first().click();
  await expect(page.locator('.camada-cheia')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.camada-cheia')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => location.hash)).toBe('#cupons');
  await page.goBack();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => location.hash)).toBe('#inicio');
});
