// Clientes → Conversas na apresentação: lista ligada aos clientes, abas com contagem, conversa com a marca do robô e
// só leitura. Nada é lido do WhatsApp nem gravado (rotas /api/demo/conversas).
const { test, expect } = require('@playwright/test');

test('CONV-08: Conversas — lista ligada aos clientes, abre a conversa (🤖 do robô, ficha do cliente) e volta', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.cli && TS.cli.lista);
  await page.evaluate(() => { location.hash = '#conversas'; });
  await expect(page.locator('.page-title')).toHaveText('Conversas');
  await expect(page.locator('.submenu a.on')).toHaveText('Conversas');
  const card = page.locator('.card', { hasText: 'Conversas do WhatsApp' });
  await expect(card.locator('.seg button, .seg a').first()).toContainText('Todas (7)');
  await expect(card).toContainText('sem cadastro');
  // cliente do painel: o nome do cadastro no lugar do número
  const nomes = await page.evaluate(() => TS.cli.lista.filter((c) => TS.foneConversa(c).length >= 12).slice(0, 6).map((c) => c.nome));
  await expect(card).toContainText(nomes[0]);
  // abre a primeira conversa: ficha do cliente, marca do robô e só leitura
  await card.getByText(nomes[0]).first().click();
  const conv = page.locator('.cv-conversa');
  await expect(conv.locator('.cv-nome')).toHaveText(nomes[0]);
  await expect(conv.getByRole('button', { name: 'Ver cliente' })).toBeVisible();
  await expect(conv.locator('.cv-msg.robo .cv-meta')).toContainText('🤖 robô · Campanha Resumo diário');
  await expect(conv).toContainText('Só leitura por enquanto');
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw - cw, 'sem rolagem para o lado').toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: '‹ Voltar' }).click();
  await expect(card.locator('table, .t-cards').first()).toBeVisible();
  expect(erros).toEqual([]);
});
