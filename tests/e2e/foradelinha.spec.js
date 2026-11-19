const { test, expect } = require('@playwright/test');

// Estoque: produto indisponível no Sistema de Pedidos há 90+ dias vira "Fora de linha · liquidar" (não "parado" nem "repor")
test('Estoque: fora de linha há 3 meses aparece para liquidar, com o motivo', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#estoque'; });
  const botao = page.getByRole('button', { name: /Fora de linha · liquidar \(3\)/ });
  await expect(botao).toBeVisible({ timeout: 20000 });
  await botao.click();
  const tab = page.locator('table.est-t').last();
  await expect(tab.locator('tbody tr')).toHaveCount(3);
  await expect(tab.locator('tbody tr').first()).toContainText('Fora de linha');
  // o 4º produto (indisponível há só 20 dias) não entra: por isso são 3
});
