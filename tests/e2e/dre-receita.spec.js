// Resultado: receita separada em Loja e Espaço Gourmet, com a taxa de serviço (os 10%) identificada e fora da base
// (RES-TAXA-01), e os royalties com os descontos da franquia do mês de referência (RES-ROY-01). Pedido do dono, 23/11/2026.
const { test, expect } = require('./_base');

async function abrir(page) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#dre'; });
  await expect(page.locator('.dre-t').first()).toBeVisible({ timeout: 20000 });
}
const num = (t) => Number(String(t).replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.'));
// só o valor da célula: no celular (LMOB-05) o % e a variação ficam embaixo dele, em .dre-sub
const valor = (loc) => loc.evaluate((td) => { const c = td.cloneNode(true); c.querySelectorAll('.dre-sub').forEach((x) => x.remove()); return c.textContent; });

test('RES-TAXA-01: Receita bruta = Loja + Espaço Gourmet; a taxa de serviço fica identificada e fora da receita; o ⓘ mostra a conta com ela na base', async ({ page }) => {
  await abrir(page);
  const t = page.locator('.dre-t').first();
  const val = async (cls, i = 0) => num(await valor(t.locator(`tr.dre-${cls}`).nth(i).locator('td').nth(1)));
  const total = await val('bruto'), loja = await val('parte', 0), eg = await val('parte', 1), taxa = await val('taxa'), liq = await val('base');
  expect(Math.abs(total - (loja + eg))).toBeLessThan(1);
  expect(liq).toBeLessThan(total); // receita líquida = bruta − descontos − Simples
  expect(await val('repasse')).toBeCloseTo(taxa, 0);
  const dica = await t.locator('tr.dre-bruto').getAttribute('title');
  expect(dica).toMatch(/taxa de serviço/);
  if (taxa > 0) expect(dica).toMatch(/Se a taxa entrasse na base: faturamento .* Simples .* royalties/);
  await expect(t.locator('tr.dre-taxa td').first()).toContainText('Taxa de serviço (10%)');
});

test('RES-ROY-01: no mês com desconto da franquia, royalties = calculado − descontos, com a origem de cada um no ⓘ; royalties + marketing = as duas linhas de baixo', async ({ page }) => {
  await abrir(page);
  // a apresentação tem desconto no mês anterior ao atual
  const ym = await page.evaluate(() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); });
  await page.locator('.dre-topo select').selectOption(ym);
  const t = page.locator('.dre-t').first();
  const total = t.locator('tr', { hasText: 'Royalties + marketing' }).first();
  const roy = t.locator('tr.dre-calc', { hasText: 'royalties' }).first();
  const mkt = t.locator('tr.dre-calc', { hasText: 'marketing' }).first();
  await expect(roy).toHaveAttribute('title', /descontos da franquia R\$\s280,70/); // a tabela já está no mês escolhido
  const vTot = num(await valor(total.locator('td').nth(1))), vRoy = num(await valor(roy.locator('td').nth(1))), vMkt = num(await valor(mkt.locator('td').nth(1)));
  expect(Math.abs(vTot - (vRoy + vMkt))).toBeLessThan(1);
  const dica = await roy.getAttribute('title');
  expect(dica).toMatch(/descontos da franquia R\$\s280,70/);
  expect(dica).toMatch(/devolução NF 1234/);
  expect(dica).toMatch(/prêmios de fidelidade/);
  expect(await total.getAttribute('title')).toMatch(/Pago:/);
});

test('DRE-CALC-01: lançar o valor real do Simples num mês troca o calculado, marca ✎ e "Voltar ao calculado" desfaz', async ({ page }) => {
  await abrir(page);
  const t = page.locator('.dre-t').first();
  const cel = t.locator('td.dre-edit[data-calc="simples"]').first();
  await expect(cel).not.toContainText('✎');
  const antes = num(await valor(cel));
  await cel.click();
  const jan = page.locator('.dre-fixo-jan');
  await expect(jan).toContainText('Simples Nacional');
  await expect(jan).toContainText('Calculado');
  await jan.locator('.dre-fixo-campo').fill('1.234,56');
  await jan.locator('.dre-esc-op').first().click(); // só este mês (PCT-ESC-01)
  await jan.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(jan).toHaveCount(0);
  const depois = page.locator('.dre-t').first().locator('td.dre-edit[data-calc="simples"]').first();
  await expect(depois).toContainText('✎');
  expect(num(await valor(depois))).toBeCloseTo(1234.56, 1);
  await expect(page.locator('.dre-dica-edit').first()).toContainText('clique no valor');
  await depois.click();
  await page.locator('.dre-fixo-jan').getByRole('button', { name: 'Voltar ao calculado', exact: true }).click();
  const volta = page.locator('.dre-t').first().locator('td.dre-edit[data-calc="simples"]').first();
  await expect(volta).not.toContainText('✎');
  expect(num(await valor(volta))).toBeCloseTo(antes, 0);
});
