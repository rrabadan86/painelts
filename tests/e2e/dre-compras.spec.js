// DRE-DICA-01 e DRE-COMPRAS-01: no Resultado, cada linha tem o ⓘ (o celular não tem "passar o mouse") e o ⓘ das compras
// do mês lista as notas que entraram e as que ficaram fora, com o porquê.
const { test, expect } = require('./_base');

test('DRE-COMPRAS-01: ⓘ em cada linha e as notas das compras do mês', async ({ page }) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); TS.state.dreMes = d.toISOString().slice(0, 7); location.hash = '#dre'; });
  const lin = page.locator('main tr', { hasText: '(+) Compras do mês' }).first();
  await expect(lin).toBeVisible({ timeout: 20000 });
  // toda linha da DRE do mês com nome tem o ⓘ
  const semDica = await page.locator('main table.dre-t').first().locator('tbody tr').evaluateAll((trs) => trs.filter((tr) => tr.title && !tr.querySelector('.dica-i')).length);
  expect(semDica).toBe(0);
  const i = lin.locator('.dica-i').first();
  await expect(i).toHaveAttribute('aria-label', /CONCLUÍDAS no AppNext com ENTRADA no mês/);
  await expect(i).toHaveAttribute('aria-label', /Entraram 2 notas/);
  await expect(i).toHaveAttribute('aria-label', /Ficaram fora 1:[\s\S]*não concluída no AppNext/);
});
