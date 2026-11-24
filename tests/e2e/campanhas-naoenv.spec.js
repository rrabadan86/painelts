// Clientes → Campanhas, aba "Não enviadas" (pedido do dono, 22/11/2026): quem ficou sem a mensagem em todas as campanhas,
// com o motivo, e "Voltar para a fila". Na apresentação há uma campanha de exemplo do robô com alguns pulados (nada é gravado).
const { test, expect } = require('./_base');

test('CAMP-NAOENV: lista de campanhas em tabela, aba "Não enviadas" com motivos e "Voltar para a fila"', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.cli && TS.cli.lista && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#campanhas'; });
  const linha = page.locator('tr, .t-card', { hasText: 'Exemplo: Sentimos sua falta' }).first();
  await expect(linha).toBeVisible();
  // a campanha mostra quantas não foram enviadas; o número abre a aba já filtrada
  const link = linha.locator('.cp-ne-link');
  await expect(link).toHaveText('6');
  await link.click();
  const card = page.locator('.card', { hasText: 'Quem ficou sem a mensagem e por quê' });
  await expect(card).toBeVisible();
  await expect(page.locator('.cp-ne-camp')).toHaveValue('Exemplo: Sentimos sua falta');
  await expect(card.getByRole('button', { name: /^Todas \(6\)$/ })).toBeVisible();
  await expect(card.getByRole('button', { name: /^Sem WhatsApp \(2\)$/ })).toBeVisible();
  await expect(card.getByRole('button', { name: /^Já recebeu \(2\)$/ })).toBeVisible();
  await expect(card.getByRole('button', { name: /^Não quer \(1\)$/ })).toBeVisible();
  await expect(card.getByRole('button', { name: /^Sem celular \(1\)$/ })).toBeVisible();
  // filtra por motivo
  await card.getByRole('button', { name: /^Sem WhatsApp \(2\)$/ }).click();
  await expect(card.getByRole('button', { name: 'Voltar para a fila', exact: true })).toHaveCount(2);
  // voltar para a fila: sai das não enviadas e volta a ser pendente na campanha
  await card.getByRole('button', { name: 'Voltar para a fila', exact: true }).first().click();
  await expect(page.locator('.card', { hasText: 'Quem ficou sem a mensagem e por quê' }).getByRole('button', { name: /^Sem WhatsApp \(1\)$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Não enviadas \(5\)$/ })).toBeVisible();
  const pend = await page.evaluate(() => TS.state.cpNE && document.querySelectorAll('.cp-ne-acoes, .lmob-acoes').length); // no celular as ações ficam na linha (LMOB-01)
  expect(pend).toBeGreaterThan(0);
  // sem rolagem para o lado
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw - cw).toBeLessThanOrEqual(2);
  // volta para a lista de campanhas
  await page.getByRole('button', { name: 'Campanhas', exact: true }).click();
  await expect(page.locator('tr, .t-card', { hasText: 'Exemplo: Sentimos sua falta' }).first().locator('.cp-ne-link')).toHaveText('5');
  expect(erros).toEqual([]);
});
