// Site público do painel (/site e /site/tecnico): abre sem login, sem rolagem para o lado, com as imagens carregadas,
// e o botão leva à apresentação.
const { test, expect } = require('@playwright/test');

test('SITE-04: site público — as duas páginas abrem inteiras e "Testar agora" leva à apresentação', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  for (const [url, titulo] of [['/site', 'A sua loja Tea Shop inteira num painel só'], ['/site/tecnico', 'Como o painel é construído']]) {
    await page.goto(url);
    await expect(page.locator('h1')).toHaveText(titulo);
    // rola a página toda (as imagens carregam ao aparecer) e confere que nenhuma quebrou nem passou da borda
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } });
    await expect.poll(() => page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).length)).toBe(0);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw - cw, url + ': sem rolagem para o lado').toBeLessThanOrEqual(2);
  }
  await page.goto('/site');
  await page.locator('header').getByRole('link', { name: 'Testar agora' }).click();
  await page.waitForFunction(() => window.TS && TS.db);
  expect(new URL(page.url()).pathname).toBe('/apresentacao');
  expect(erros).toEqual([]);
});
