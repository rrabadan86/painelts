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

test('gráfico: botão Compartilhar gera a imagem (no computador, baixa o PNG)', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#resumo'; }); await page.waitForTimeout(1200);
  const b = page.locator('.shr-btn').first();
  await expect(b).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), b.click()]);
  expect(dl.suggestedFilename()).toMatch(/\.png$/);
  const p = await dl.path(); const fs = require('fs');
  expect(fs.statSync(p).size).toBeGreaterThan(5000);
  fs.copyFileSync(p, '/tmp/share.png');
});

test('Créditos com a franquia: devoluções compensadas pelo desconto das notas, atrasadas e aviso no Início', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#creditos'; });
  const corpo = page.locator('#app, main, body').first();
  await expect(page.locator('.nf-abas button', { hasText: 'Créditos com a franquia' })).toHaveClass(/on/);
  await page.locator('.seg button', { hasText: 'Todas' }).first().click();
  await expect(corpo).toContainText('na NF 19120');
  await expect(corpo).toContainText('Atrasado');
  await expect(corpo).toContainText('Para resolver (1)');
  await expect(corpo).toContainText('Sobram');
  await page.locator('.cff summary').click();
  await expect(page.locator('.cff')).toContainText('Compensou');
  await page.evaluate(() => { location.hash = '#inicio'; });
  await expect(page.locator('.ini-avisos')).toContainText(/Franquia: 1 devolução sem desconto/);
});

test('Créditos: botões da linha não abrem a nota; "ligar" lista também as devoluções só sugeridas', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#creditos'; });
  await page.locator('.seg button', { hasText: 'Todas' }).first().click();
  await page.locator('.cfp-item').getByRole('button', { name: 'Trocar' }).click();
  await expect(page.locator('.cf-ligar')).toBeVisible();
  await expect(page.locator('.cf-ligar .cfl-linha').first()).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#creditos');
  await expect(page.locator('.prc-drawer')).toHaveCount(0);
  await page.locator('.cf-ligar').getByRole('button', { name: 'Cancelar' }).click();
  // menu ⋯ abre sem abrir a NF-e
  await page.locator('.cf-tab .cf-mais').first().click();
  await expect(page.locator('.cf-menu-lista:visible')).toContainText('Compensada no boleto');
  await expect(page.locator('.camada-cheia, .prc-drawer-camada')).toHaveCount(0);
});
