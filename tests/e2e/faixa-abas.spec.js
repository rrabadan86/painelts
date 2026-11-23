const { test, expect } = require('./_base');

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

// no celular a lista é em cartões e se refaz a cada toque: o cartão em que a pessoa está mexendo não pode mudar de lugar
test('Pedido no celular: apertar ＋ várias vezes mantém o cartão no mesmo lugar (não sobe para junto dos pedidos)', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'no computador é tabela, que já guarda a ordem');
  await abrir(page, '#pedido');
  await page.locator('.ped-tools .seg button', { hasText: /^Site de pedidos completo/ }).click();
  const cartoes = page.locator('.ped-cards .ped-card');
  await expect(cartoes.first()).toBeVisible({ timeout: 40000 });
  // um cartão ainda sem quantidade, lá no meio da lista (depois dos que já estão no pedido)
  const k = await cartoes.evaluateAll((els) => els.findIndex((el, i) => i >= 8 && el.querySelector('.ped-step[aria-label="Mais"]') && !el.classList.contains('on') && !el.classList.contains('obr')));
  expect(k).toBeGreaterThan(0);
  const cod = (await cartoes.nth(k).locator('.est-tam').first().innerText()).match(/cód\. \S+/)[0];
  const vizinhos = async () => (await cartoes.evaluateAll((els, i) => els.slice(i - 1, i + 2).map((el) => (el.querySelector('.est-tam') || el).textContent.match(/cód\. \S+/)[0]), k));
  const antes = await vizinhos();
  for (let n = 0; n < 3; n++) {
    await cartoes.nth(k).locator('.ped-step[aria-label="Mais"]').click();
    await expect(cartoes.nth(k)).toContainText(cod); // continua na mesma posição depois de cada toque
  }
  expect(await vizinhos(), 'os vizinhos do cartão são os mesmos').toEqual(antes);
  // o máximo por pedido do site aparece ao lado da quantidade e o painel não deixa passar dele
  const max = cartoes.nth(k).locator('.ped-max');
  await expect(max).toHaveText(/^máx\. \d/);
  const limite = +(await max.innerText()).replace(/[^\d,]/g, '').replace(',', '.');
  await cartoes.nth(k).locator('input.ped-q').fill(String(limite * 3));
  await cartoes.nth(k).locator('input.ped-q').blur();
  await expect(page.locator('.toast')).toContainText('só deixa pedir até');
  expect(+(await cartoes.nth(k).locator('input.ped-q').inputValue())).toBeLessThanOrEqual(limite);
  await expect(cartoes.nth(k)).toHaveClass(/\bon\b/);
  expect(+(await cartoes.nth(k).locator('input.ped-q').inputValue())).toBeGreaterThan(0);
  // trocar de aba e voltar: aí sim a lista se reorganiza (o que está no pedido vem primeiro)
  await page.locator('.ped-tools .seg button', { hasText: /^Complemento/ }).click();
  await page.locator('.ped-tools .seg button', { hasText: /^Site de pedidos completo/ }).click();
  const novo = await page.locator('.ped-cards .ped-card').evaluateAll((els, c) => els.findIndex((el) => el.textContent.includes(c)), cod);
  expect(novo).toBeGreaterThanOrEqual(0);
  expect(novo).toBeLessThan(k);
});
