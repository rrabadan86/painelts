// Configurações → loja → Metas e Comissão: "Não entram no rateio", "Vendedores sem meta individual" e "Não recebem comissão"
// escolhem entre os vendedores ativos da loja (pedido do dono, 23/11/2026), nunca texto livre. Na apresentação, sem gravar.
const { test, expect } = require('@playwright/test');

test('VEND-REGRAS-01: as três listas de vendedores são escolha entre os vendedores ativos, com ⓘ e "inativo" para nome antigo', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#config'; });
  await page.locator('table.cfg-lojas-t .cfg-abrir').first().click();
  await page.locator('.cfg-loja .cfg-sub a', { hasText: 'Metas e Comissão' }).evaluate((a) => a.click());
  const sel = page.locator('fieldset.cfg-vend-sel');
  await expect(sel).toHaveCount(3);
  for (const t of ['Não entram no rateio', 'Vendedores sem meta individual', 'Não recebem comissão']) {
    const f = sel.filter({ has: page.locator('legend', { hasText: t }) });
    await expect(f).toHaveCount(1);
    await expect(f.locator('legend .dica, legend [title], legend button').first()).toBeVisible(); // ⓘ
    await expect(f.locator('input[type="text"], textarea')).toHaveCount(0); // não é mais texto livre
  }
  // adicionar um vendedor ativo e tirar de novo
  const semCom = sel.filter({ has: page.locator('legend', { hasText: 'Não recebem comissão' }) });
  const add = semCom.locator('select.cfg-vend-add');
  const opcoes = await add.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  expect(opcoes.length, 'a apresentação tem vendedores ativos').toBeGreaterThan(0);
  const antes = await semCom.locator('.cfg-vend-chip').count();
  await add.selectOption(opcoes[0]);
  await expect(semCom.locator('.cfg-vend-chip')).toHaveCount(antes + 1);
  await expect(add.locator(`option[value="${opcoes[0]}"]`)).toHaveCount(0); // quem já está escolhido sai da lista
  await semCom.locator('.cfg-vend-chip').last().locator('.cfg-vend-x').click();
  await expect(semCom.locator('.cfg-vend-chip')).toHaveCount(antes);
  // nome salvo que não vende mais continua escolhido, marcado "inativo"
  const inativos = await page.locator('.cfg-vend-inativo').count();
  if (inativos) await expect(page.locator('.cfg-vend-inativo').first()).toHaveText('inativo');
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw - cw, 'sem rolagem para o lado').toBeLessThanOrEqual(2);
  expect(await page.locator('.cfg-loja').innerText()).not.toMatch(/(^|\s)(null|undefined|NaN)(\s|$)/m);
  expect(erros).toEqual([]);
});
