// Retorno das campanhas (CAMP-TOT-01): cartão-herói em Clientes → Campanhas e em Indicadores, com a mesma conta
// (TS.campRetorno.geral: cada cliente e cada compra contam uma vez, mesmo com duas campanhas no mesmo prazo).
const { test, expect } = require('./_base');

const abrir = async (page, tela) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate((t) => { location.hash = '#' + t; }, tela);
};
const semLixo = async (loc) => expect(await loc.innerText()).not.toMatch(/(^|[\s>(\d])(null|undefined|NaN|\[object Object\])(?=$|[\s<).,])/m);

test('CAMP-TOT-01 Campanhas e Indicadores mostram o mesmo retorno, sem repetir compra', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page, 'campanhas');
  const heroi = page.locator('.heroi[aria-label="Retorno das campanhas"]');
  await expect(heroi).toBeVisible();
  await expect(heroi.locator('.heroi-col')).toHaveCount(3);
  // os números são os da conta única
  const conta = await page.evaluate(async () => {
    const l = await TS.campanhasDaLoja();
    const cup = (cpf) => { const c = TS.cli.porCPF.get(cpf); return c ? c.cupons : []; };
    const g = TS.campRetorno.geral(l, cup, TS.todayDay(), TS.cliApi.noPeriodo());
    return { fat: TS.fmt.brl0(g.rec.vt), volt: TS.fmt.int(g.rec.volt), n: g.rec.n };
  });
  expect(conta.n).toBeGreaterThan(0);
  await expect(heroi.locator('.heroi-col').nth(0).locator('.heroi-num')).toHaveText(conta.fat);
  await expect(heroi.locator('.heroi-col').nth(1).locator('.heroi-num')).toHaveText(conta.volt);
  await expect(heroi.locator('.heroi-col').nth(1)).toContainText(`de ${conta.n}`);
  await semLixo(heroi);
  // Indicadores: o mesmo cartão, com o caminho para as campanhas
  await page.evaluate(() => { location.hash = '#clientes'; });
  const ind = page.locator('.heroi[aria-label="Retorno das campanhas"]');
  await expect(ind.locator('.heroi-col').nth(0).locator('.heroi-num')).toHaveText(conta.fat);
  await ind.getByRole('link', { name: 'Ver campanhas ›' }).click();
  await expect(page).toHaveURL(/#campanhas/);
  expect(erros).toEqual([]);
});
