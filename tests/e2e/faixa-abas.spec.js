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

test('Pedido: 5 abas na ordem do pedido, cada uma com explicação; no celular quebram em linhas, sem rolar para o lado', async ({ page }, info) => {
  await abrir(page, '#pedido');
  const seg = page.locator('.ped-tools .seg').first();
  await expect(seg).toBeVisible({ timeout: 40000 });
  const rotulos = (await seg.locator('button').allInnerTexts()).map((t) => t.replace(/ \(\d+\)$/, ''));
  expect(rotulos).toEqual(['Carrinho completo', 'Pedido obrigatório', 'Complemento', 'Verificar', 'Site de pedidos completo']);
  for (const b of await seg.locator('button').all()) expect((await b.getAttribute('title')) || '').not.toBe('');
  await expect(seg.locator('button.on')).toHaveText(/^Complemento \(/); // abre no que vai para o carrinho
  // a faixa não rola para o lado e todas as abas estão dentro da tela
  expect(await seg.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'a faixa das abas não rola para o lado').toBe(true);
  const vw = page.viewportSize().width;
  for (const b of await seg.locator('button').all()) { const r = await b.boundingBox(); expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(vw + 1); }
  // contas: carrinho completo = obrigatório + complemento
  const n = async (rot) => +(await seg.locator('button', { hasText: rot }).innerText()).match(/\((\d+)\)$/)[1];
  expect(await n(/^Carrinho completo/)).toBe((await n(/^Pedido obrigatório/)) + (await n(/^Complemento/)));
  // "Verificar": só o que dá para pedir agora; o resto fica numa linha discreta com "Mostrar"
  await seg.locator('button', { hasText: /^Verificar/ }).click();
  const seg2 = page.locator('.ped-tools .seg').first();
  await expect(seg2.locator('button.on')).toHaveText(/^Verificar \(/);
  const antes = await page.evaluate(() => document.querySelectorAll('.ped-t tbody tr .badge, .ped-card').length);
  expect(antes).toBeGreaterThan(0);
  const nota = page.locator('.ped-ver-nota');
  if (await nota.count()) {
    await expect(nota).toContainText('não dá para pedir agora');
    const nVer = +(await seg2.locator('button.on').innerText()).match(/\((\d+)\)$/)[1];
    await nota.getByRole('button', { name: 'Mostrar' }).click();
    await expect.poll(async () => +(await page.locator('.ped-tools .seg').first().locator('button.on').innerText()).match(/\((\d+)\)$/)[1]).toBeGreaterThan(nVer);
    await page.locator('.ped-ver-nota').getByRole('button', { name: 'Esconder' }).click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
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
