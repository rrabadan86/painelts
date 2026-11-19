const { test, expect } = require('@playwright/test');

// Nota de entrada com custo maior → "Enviar para a franquia": marca os produtos, edita para/assunto/mensagem e envia
// (na apresentação nada é enviado: a resposta é simulada)
test('Nota de entrada: enviar reclamação de reajuste para a franquia, escolhendo os produtos', async ({ page }) => {
  let enviado = null;
  page.on('request', (r) => { if (r.url().includes('/reajuste/enviar')) enviado = JSON.parse(r.postData()); });
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#notas'; });
  const links = page.locator('a.prc-nome');
  await expect(links.first()).toBeVisible();
  let achou = false;
  for (let k = 0; k < Math.min(await links.count(), 30) && !achou; k++) {
    await page.evaluate(() => document.querySelector('.prc-drawer-camada')?.remove());
    await links.nth(k).evaluate((a) => a.click());
    achou = await page.locator('.nf-impacto .nf-fr-btn').waitFor({ timeout: 2500 }).then(() => true, () => false);
  }
  expect(achou).toBe(true);
  await page.locator('.nf-fr-btn').evaluate((b) => b.click());
  const pop = page.locator('.nf-fr-pop');
  await expect(pop).toBeVisible();
  // destinatários e assunto vêm preenchidos e dá para editar
  await expect(pop.getByLabel('Para')).toHaveValue('compras@franquia-exemplo.com.br');
  await expect(pop.getByLabel('Assunto')).toHaveValue(/^Reajuste de custo — NF /);
  await pop.getByLabel('Assunto').fill('Reajuste fora do combinado');
  await pop.getByLabel('Para').fill('compras@franquia-exemplo.com.br, gerente@franquia-exemplo.com.br');
  await expect(pop.getByLabel('Mensagem')).toHaveValue(/custo maior do que na compra anterior/);
  await pop.getByLabel('Mensagem').fill('Olá, podem conferir estes itens?');
  // todos marcados; desmarca o primeiro (se houver mais de um)
  const caixas = pop.locator('.nf-fr-item input[type=checkbox]');
  const n = await caixas.count();
  expect(n).toBeGreaterThan(0);
  await expect(pop.locator('.nf-fr-item').first()).toContainText('→');
  if (n > 1) await caixas.first().uncheck();
  page.once('dialog', (d) => d.accept());
  await pop.getByRole('button', { name: '✉ Enviar' }).click();
  await expect(pop.locator('.nf-fr-st')).toContainText('Na apresentação o e-mail não é enviado');
  expect(enviado.assunto).toBe('Reajuste fora do combinado');
  expect(enviado.para).toContain('gerente@franquia-exemplo.com.br');
  expect(enviado.mensagem).toBe('Olá, podem conferir estes itens?');
  expect(enviado.itens.length).toBe(n > 1 ? n - 1 : 1);
  expect(enviado.itens[0].depois).toBeGreaterThan(enviado.itens[0].antes);
  // gráfico do histórico de compras de cada produto marcado vai junto (imagem PNG)
  expect(enviado.graficos.length).toBe(enviado.itens.length);
  expect(enviado.graficos[0].png).toMatch(/^data:image\/png;base64,/);
  expect(enviado.itens.map((i) => i.cod)).toContain(enviado.graficos[0].cod);
  const larga = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(larga).toBeLessThanOrEqual(1);
});
