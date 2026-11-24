const { test, expect } = require('./_base');

// COM-PER-01 (bug visto pelo dono em 24/11/2026): Equipe → Comissionamento com "Hoje" comparava as vendas do dia com a meta
// do mês inteiro (3% da meta). Agora, com período menor que o mês, o topo compara as vendas do período com a meta do período
// (para "Hoje", a mesma Meta de hoje do Início) e a comissão continua sendo do mês, contra a meta do mês.
const abrir = async (page) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
};

test('COM-PER-01: "Hoje" no Comissionamento usa a meta de hoje (a mesma do Início); a comissão segue do mês', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  // a Meta de hoje do Início (cartão da coluna da direita)
  await page.evaluate(() => { location.hash = '#inicio'; });
  const metaInicio = (await page.locator('.md-card .md-num b').first().innerText()).trim();
  // Comissionamento com o mês atual: o topo é o do mês (sem a linha do período)
  await page.evaluate(() => { TS.aplicarPreset('mes'); location.hash = '#comissionamento'; TS.render(); });
  await expect(page.locator('.heroi-col').first()).toContainText('Vendas da meta');
  await expect(page.locator('[data-aviso="periodo-parcial"]')).toHaveCount(0);
  const aPagarMes = (await page.locator('.heroi-col', { hasText: 'Total a pagar' }).locator('.heroi-num').innerText()).trim();
  // "Hoje": a meta do período é a Meta de hoje do Início; a comissão (total a pagar) não muda — é do mês
  await page.evaluate(() => { TS.aplicarPreset('hoje'); TS.render(); });
  const col = page.locator('.heroi-col', { hasText: 'Vendas da meta no período' });
  await expect(col).toBeVisible();
  await expect(col.locator('.com-meta-per')).toContainText(`Meta do período ${metaInicio}`);
  await expect(page.locator('[data-aviso="periodo-parcial"]')).toContainText('A comissão, o total a pagar e a tabela abaixo são do mês');
  await expect(page.locator('.heroi-col', { hasText: 'Total a pagar' }).locator('.heroi-num')).toHaveText(aPagarMes);
  // "Semana atual" também é período parcial (a menos que a semana comece no dia 1)
  const inicioMes = await page.evaluate(() => { TS.aplicarPreset('semana'); TS.render(); return TS.dayToIso(TS.state.f.de).slice(8) === '01'; });
  if (!inicioMes) await expect(page.locator('.heroi-col', { hasText: 'Vendas da meta no período' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
  expect(erros).toEqual([]);
});
