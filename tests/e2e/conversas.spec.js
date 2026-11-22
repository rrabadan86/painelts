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
  // volta para o mesmo lugar da lista, com a conversa aberta marcada
  await expect(page.locator('.cv-ultima')).toHaveCount(1);
  await expect(page.locator('.cv-ultima')).toContainText(nomes[0]);
  // rolou até a última conversa, abriu e voltou: a lista continua onde estava
  const ultima = card.getByText('Contato sem cadastro').first();
  await ultima.scrollIntoViewIfNeeded();
  const antes = await page.evaluate(() => window.scrollY);
  await ultima.click();
  await expect(page.locator('.cv-conversa')).toBeVisible();
  await page.getByRole('button', { name: '‹ Voltar' }).click();
  await expect(page.locator('.cv-ultima')).toContainText('Contato sem cadastro');
  await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - antes), { message: 'volta perto de onde estava (não para o começo)' }).toBeLessThanOrEqual(100);
  expect(erros).toEqual([]);
});

test('CONV-09: sem internet por um momento — a lista continua na tela, sem "Failed to fetch", e atualiza quando a conexão volta', async ({ page, context }) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.cli && TS.cli.lista);
  await page.evaluate(() => { location.hash = '#conversas'; });
  const card = page.locator('.card', { hasText: 'Conversas do WhatsApp' });
  await expect(card).toContainText('Contato sem cadastro');
  let pedidos = 0;
  page.on('request', (r) => { if (/\/api\/demo\/conversas\?/.test(r.url())) pedidos++; });
  await context.setOffline(true);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // a página "voltou": tenta atualizar
  await page.waitForTimeout(1500);
  await expect(card).toContainText('Contato sem cadastro');
  await expect(page.locator('#content')).not.toContainText(/failed to fetch/i);
  await context.setOffline(false); // a internet voltou: tenta de novo sozinha
  await expect.poll(() => pedidos).toBeGreaterThan(0);
  await expect(card).toContainText('Contato sem cadastro');
  await expect(page.locator('#content')).not.toContainText(/failed to fetch/i);
});
