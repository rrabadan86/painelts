const { test, expect } = require('@playwright/test');

// Campanhas → "O que comprou": mínimo de compras do produto escolhido (apresentação, computador e celular)
test('Campanha: "pelo menos N compras" do produto escolhido diminui a lista e aparece no resumo do critério', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#campanhas'; });
  await expect(page.getByRole('button', { name: '+ Criar campanha' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ Criar campanha' }).click();
  const total = async () => +(await page.locator('.cp-contagem b').innerText()).replace(/\D/g, '');
  await expect.poll(total).toBeGreaterThan(0);
  const semProduto = await total();
  const b = page.locator('.cp-bloco', { hasText: 'O que comprou' });
  if (!(await b.locator('.cp-prod-campo input').isVisible())) await b.locator('summary').click();
  // escolhe o primeiro produto sugerido
  await b.locator('.cp-prod-campo input').fill('cha');
  await b.locator('.cp-sug-it').first().dispatchEvent('mousedown');
  await expect(b.locator('.cp-bloco-res')).toContainText('1 produto');
  // espera a contagem refletir o produto escolhido (a lista é refeita depois do clique; ler na hora pegava a contagem antiga)
  await expect.poll(total).toBeLessThan(semProduto);
  await expect.poll(total).toBeGreaterThan(0);
  const comUma = await total();
  const linha = b.locator('.cp-linha', { hasText: 'pelo menos' });
  await expect(linha.locator('.dica-i')).toHaveCount(1); // explicação (ⓘ) do critério
  // mínimo 1 = igual a não preencher; mínimo alto = ninguém
  await linha.locator('input').fill('1'); await linha.locator('input').blur();
  await expect.poll(total).toBe(comUma);
  await linha.locator('input').fill('2'); await linha.locator('input').blur();
  await expect(b.locator('.cp-bloco-res')).toContainText('2+ vezes');
  await expect.poll(total).toBeLessThanOrEqual(comUma);
  await linha.locator('input').fill('500'); await linha.locator('input').blur();
  await expect.poll(total).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
  if (process.env.PRINTS) { await b.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.PRINTS}/compras-${info.project.name}.png` }); }
  expect(erros).toEqual([]);
});
