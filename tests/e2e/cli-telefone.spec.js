// Clientes → filtro "Telefone" (pedido do dono): acha o cliente pelo celular inteiro ou por parte dele,
// com ou sem o 55, com ou sem o 9 da frente do celular.
const { test, expect } = require('./_base');

test('CLI-TEL: filtro por telefone (inteiro ou parte) na Lista de clientes', async ({ page }) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.cli && TS.cli.lista && TS.cli.lista.some((c) => c.celular));
  // regra da conta: parte do número, com 55, sem o 9
  const r = await page.evaluate(() => {
    const f = TS.cliApi.telConfere;
    return [f('62984159578', '8415'), f('62984159578', '+55 (62) 98415-9578'), f('62984159578', '6284159578'), f('6284159578', '62984159578'), f('62984159578', '7777'), f('', '8415')];
  });
  expect(r).toEqual([true, true, true, true, false, false]);
  // na tela: um celular de cliente da apresentação, só os 4 últimos dígitos
  const alvo = await page.evaluate(() => { const c = TS.cli.lista.find((x) => x.celular && x.celular.length >= 10); return { fim: c.celular.slice(-4), total: TS.cli.lista.filter((x) => TS.cliApi.telConfere(x.celular, c.celular.slice(-4))).length }; });
  await page.evaluate(() => { location.hash = '#clilista'; });
  const btMais = page.locator('#btnMaisFiltros');
  if (await btMais.isVisible()) await btMais.click(); else await page.locator('#btnFiltros').click();
  const campo = page.getByPlaceholder('Número ou parte dele');
  await campo.fill(alvo.fim);
  await expect(page.locator('main')).toContainText(`${alvo.total} cliente`, { timeout: 15000 });
});
