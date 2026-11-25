const { test, expect } = require('./_base');

// REDE-02 (pedido do dono, 25/11/2026: "a tabela de comparação não leva em conta os filtros"): Sua loja × rede segue o
// período do filtro — o pedido vai com de/ate e o subtítulo diz qual período está comparando
test('REDE-02: Sua loja × rede segue o período do filtro', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  const pedidos = [];
  page.on('request', (r) => { if (/\/api\/demo\/rede\?/.test(r.url())) pedidos.push(r.url()); });
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { TS.aplicarPreset('mes'); location.hash = '#comparativos'; });
  const card = page.locator('.rede-card');
  await expect(card).toContainText('o período do filtro');
  await expect(card.locator('.rede-t tbody tr, .rede-lmob .lmob-it').first()).toBeVisible();
  await page.evaluate(() => { TS.aplicarPreset('semana'); TS.render(); });
  await expect.poll(() => pedidos.length).toBeGreaterThan(1);
  const u = new URL(pedidos[pedidos.length - 1]);
  const de = u.searchParams.get('de'), ate = u.searchParams.get('ate');
  expect(de).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(await page.evaluate(([d, a]) => d === TS.dayToIso(Math.max(TS.state.f.de, TS.db.minDay)) && a === TS.dayToIso(Math.min(TS.state.f.ate ?? TS.db.maxDay, TS.db.maxDay)), [de, ate])).toBe(true);
  await expect(page.locator('.rede-card .rede-t tbody tr, .rede-card .rede-lmob .lmob-it').first()).toBeVisible();
  expect(erros).toEqual([]);
});
