const { test, expect, escolherOpcao, opcaoAtiva, LINHAS } = require('./_base');

// Estoque: produto indisponível no Sistema de Pedidos há 90+ dias vira "Fora de linha · liquidar" (não "parado" nem "repor")
test('Estoque: fora de linha há 3 meses aparece para liquidar, com o motivo', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#estoque'; });
  await expect(page.locator('#est-tabela')).toBeVisible({ timeout: 20000 });
  // a aba diz quantos são (no celular a contagem fica na folha de opções)
  await escolherOpcao(page, '#est-tabela .est-tools', /^Fora de linha · liquidar/);
  expect(await opcaoAtiva(page, '#est-tabela .est-tools')).toMatch(/Fora de linha · liquidar \(3\)/);
  const tab = page.locator('#est-tabela');
  await expect(tab.locator(LINHAS)).toHaveCount(3);
  await expect(tab.locator(LINHAS).first()).toContainText('Fora de linha');
  // o 4º produto (indisponível há só 20 dias) não entra: por isso são 3
});
