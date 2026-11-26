// NF-PER-01 (pedido do dono, 26/11/2026): Notas fiscais de entrada abre em "Todas"; "No período" inclui a nota que chegou
// depois do último dia com venda (o período dos filtros termina na última venda importada, e a nota de hoje ficava de fora)
const { test, expect } = require('./_base');

test('NF-PER-01: Notas fiscais abre com "Todas" marcado', async ({ page }, info) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#notas'; });
  await expect(page.locator('main')).toContainText('Notas fiscais de entrada', { timeout: 30000 });
  if (info.project.name === 'celular') {
    // no celular o seletor é um botão com a opção escolhida (TS.segFolha)
    await expect(page.locator('main .prc-notas').getByRole('button', { name: /Todas/ }).first()).toBeVisible();
  } else {
    const seg = page.locator('main .seg').filter({ hasText: 'No período' }).first();
    await expect(seg.locator('button.on').first()).toContainText('Todas');
  }
});
