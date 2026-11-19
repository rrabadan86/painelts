const { test, expect } = require('@playwright/test');

const guardadas = (page) => page.evaluate(() => new Promise((ok) => {
  const r = indexedDB.open('teashop-painel', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('dados');
  r.onsuccess = () => {
    const db = r.result, q = db.transaction('dados').objectStore('dados').getAllKeys();
    q.onsuccess = () => { db.close(); ok(q.result); };
  };
}));

// Melhoria de abertura: os dados ficam guardados no aparelho e o painel abre na hora; o servidor confere em seguida
test('Painel abre na hora com os dados guardados no aparelho e a tela de entrar apaga tudo', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await expect.poll(() => guardadas(page)).toEqual([expect.stringMatching(/^demo\|/)]);

  // reabre com o servidor lento: a tela aparece antes da resposta, com os dados guardados
  let liberar;
  const lento = new Promise((ok) => { liberar = ok; });
  await page.route('**/api/demo/dados*', async (route) => { await lento; await route.continue(); });
  await page.reload();
  await page.waitForFunction(() => window.TS && TS.db && TS.dadosGuardados === true, null, { timeout: 5000 });
  await expect(page.locator('#content .kpi').first()).toBeVisible();
  await expect(page.locator('#updated')).toHaveClass(/carregando/);
  liberar();
  await expect(page.locator('#updated')).not.toHaveClass(/carregando/);
  await page.waitForFunction(() => TS.dadosGuardados === false);
  await page.unroute('**/api/demo/dados*');

  // sem conexão com o painel: continua mostrando o que estava guardado, com aviso
  await page.route('**/api/demo/dados*', (route) => route.abort());
  await page.reload();
  await page.waitForFunction(() => window.TS && TS.db && TS.aviso && /guardados neste aparelho/.test(TS.aviso));
  await expect(page.locator('#content .kpi').first()).toBeVisible();
  await page.unroute('**/api/demo/dados*');

  // tela de entrar (sair ou sessão expirada): nada fica guardado
  await page.goto('/login');
  await expect.poll(() => guardadas(page)).toEqual([]);
});
