const { test, expect } = require('@playwright/test');

// Faixas que rolam para o lado no celular (abas e submenu) são refeitas a cada clique: a opção escolhida continua à vista
// (antes a faixa voltava para o começo e a última opção sumia).
async function abrir(page, hash) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate((x) => { location.hash = x; }, hash);
}
// a opção marcada está inteira dentro da faixa?
const dentro = (loc) => loc.evaluate((a) => { const c = a.parentElement.getBoundingClientRect(), r = a.getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1; });

test('Pedido no celular: clicar na última aba mantém a aba à vista depois de a tela se refazer', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'no computador as abas cabem na tela');
  await abrir(page, '#pedido');
  const seg = page.locator('.seg').filter({ has: page.locator('button', { hasText: /^Todos \(/ }) }).first();
  await expect(seg).toBeVisible({ timeout: 40000 });
  expect(await seg.evaluate((el) => el.scrollWidth > el.clientWidth), 'a faixa precisa rolar para o teste valer').toBe(true);
  const ultima = seg.locator('button', { hasText: /^Todos \(/ });
  await ultima.scrollIntoViewIfNeeded();
  await ultima.click();
  const marcada = page.locator('.seg').filter({ has: page.locator('button', { hasText: /^Todos \(/ }) }).first().locator('button.on');
  await expect(marcada).toHaveText(/^Todos \(/);
  await expect.poll(() => dentro(marcada)).toBe(true);
  expect(await marcada.evaluate((a) => a.parentElement.scrollLeft)).toBeGreaterThan(0);
  // mudar uma quantidade refaz a tela de novo: a aba continua à vista
  await page.locator('.ped-card .ped-step[aria-label="Mais"]').first().click();
  await expect.poll(() => dentro(page.locator('.seg').filter({ has: page.locator('button', { hasText: /^Todos \(/ }) }).first().locator('button.on'))).toBe(true);
});

test('submenu no celular: abrir a última tela do grupo mantém o item marcado à vista', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'no computador o submenu cabe na tela');
  await abrir(page, '#estoque');
  const sub = page.locator('nav.submenu');
  await expect(sub).toBeVisible({ timeout: 40000 });
  test.skip(!(await sub.evaluate((el) => el.scrollWidth > el.clientWidth)), 'o submenu deste grupo cabe na tela');
  const ultimo = sub.locator('a').last();
  const nome = await ultimo.innerText();
  await ultimo.scrollIntoViewIfNeeded();
  await ultimo.click();
  const marcado = page.locator('nav.submenu a.on');
  await expect(marcado).toHaveText(nome, { timeout: 40000 });
  await expect.poll(() => dentro(marcado)).toBe(true);
});
