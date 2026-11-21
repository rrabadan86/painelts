const { test, expect } = require('@playwright/test');

// Grupo do produto no AppNext (definição única: public/js/grupoprod.js) embaixo do nome nas telas que listam produtos.
async function abrir(page, hash) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate((x) => { location.hash = x; }, hash);
}
for (const [nome, hash] of [['Estoque', '#estoque'], ['Rentabilidade', '#rentab'], ['Preços', '#precos'], ['Pedido', '#pedido']]) {
  test(`grupo do produto aparece em ${nome}`, async ({ page }) => {
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await abrir(page, hash);
    const marca = page.locator(hash === '#pedido' ? '.ped-t tbody td:nth-child(2), .ped-card-meta' : '.grp-prod').first();
    await expect(marca).toBeVisible({ timeout: 40000 });
    // é um grupo que existe nas vendas ou no cadastro (nunca "Chás a granel", que é parte do pedido)
    const grupos = await page.evaluate(() => TS.db.D.grupo.filter(Boolean));
    const txt = (await marca.innerText()).split(/\n| · /)[0].trim();
    expect(txt).not.toBe('');
    expect(txt).not.toBe('Chás a granel');
    if (hash !== '#pedido') expect(grupos.concat(['ACESSÓRIOS', 'CHÁ AROMATIZADO', 'CHÁ PURO', 'INFUSÕES']), txt).toContain(txt);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
    expect(erros).toEqual([]);
  });
}
