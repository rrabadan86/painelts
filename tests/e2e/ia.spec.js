const { test, expect } = require('@playwright/test');

test('IA: Pergunte ao painel abre, consulta as vendas e responde (simulada na apresentação)', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  const b = page.locator('#btnIA');
  await expect(b).toBeVisible();
  await b.click();
  const g = page.locator('.ia-gaveta');
  await expect(g).toBeVisible();
  await g.locator('.ia-sug').first().click();
  await expect(g.locator('.ia-ela')).toContainText('consultando as vendas');
  await expect(g.locator('.ia-ela .ia-md')).toContainText('simulada');
  await expect(g.locator('.ia-ela .ia-md li').first()).toContainText('R$');
  // pergunta digitada (Enter envia) e conversa continua
  await g.locator('textarea').fill('E nos últimos 90 dias?');
  await g.locator('textarea').press('Enter');
  await expect(g.locator('.ia-eu')).toHaveCount(2);
  await expect(g.locator('.ia-ela .ia-md')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(g).toHaveCount(0);
});

test('IA: revisão do pedido sugere ajuste e aplica na quantidade', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#pedido'; });
  const card = page.locator('.ped-ia');
  await expect(card).toBeVisible({ timeout: 30000 });
  await card.getByRole('button', { name: 'Revisar este pedido' }).click();
  await expect(card.locator('.ped-ia-t')).toBeVisible();
  await expect(card).toContainText('simulada');
  await card.getByRole('button', { name: 'Aplicar' }).first().click();
  await expect(page.locator('.ped-ia')).toContainText('aplicado ✓');
  await expect(page.locator('.kpi-label', { hasText: 'Seu pedido (com alterações)' })).toBeVisible();
});

test('IA: Configurações mostra a aba Inteligência artificial com o passo a passo', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#config'; });
  await page.getByRole('button', { name: 'Inteligência artificial' }).click();
  await expect(page.locator('.ia-form')).toBeVisible();
  await expect(page.locator('.ia-passo summary')).toContainText('Como criar a chave');
  await expect(page.locator('.ia-form input[type=password]')).toHaveAttribute('autocomplete', 'off');
  await page.locator('.ia-form input[type=password]').fill('sk-ant-api03-' + 'y'.repeat(40));
  await page.getByRole('button', { name: 'Testar e salvar' }).click();
  await expect(page.locator('.ia-form')).toContainText('Na apresentação nada é salvo');
});
