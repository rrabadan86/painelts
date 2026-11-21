const { test, expect } = require('@playwright/test');

// Lista vazia: a frase ocupa a largura da tabela em qualquer tela (no celular saía uma letra por linha na tabela de
// devoluções dos Créditos, porque a regra "última coluna estreita" também pegava a célula da frase)
const TELAS = [['#creditos', 'Buscar NF'], ['#estoque', 'Buscar qualquer produto'], ['#sugestoes', 'Buscar produto, pessoa']];
for (const [hash, busca] of TELAS) {
  test(`lista vazia ocupa a largura toda em ${hash}`, async ({ page }) => {
    await page.goto('/apresentacao');
    await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
    await page.evaluate((x) => { location.hash = x; }, hash);
    const campo = page.locator(`input[placeholder^="${busca}"]`).first();
    await expect(campo).toBeVisible({ timeout: 40000 });
    await campo.fill('zzzz-nada-assim-zzzz');
    const vazio = page.locator('td.t-vazio').first();
    await expect(vazio).toBeVisible({ timeout: 20000 });
    await vazio.scrollIntoViewIfNeeded();
    const larguraTabela = await vazio.evaluate((td) => td.closest('table').getBoundingClientRect().width);
    const caixa = await vazio.boundingBox();
    expect(caixa.width, 'a frase usa a largura da tabela').toBeGreaterThan(larguraTabela * 0.8);
    expect(caixa.height, 'sem uma letra por linha').toBeLessThan(120);
  });
}
