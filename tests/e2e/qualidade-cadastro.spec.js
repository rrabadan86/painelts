// QUAL-CAD-01 e QUAL-CAD-05: Clientes → Indicadores → Qualidade do cadastro (só admin e franqueado), na apresentação
const { test, expect } = require('./_base');

test('QUAL-CAD-01: herói, tabela dos problemas e a lista que abre ao tocar (computador e celular)', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#clientes'; });
  await expect(page.locator('.section-label', { hasText: 'Qualidade do cadastro' })).toBeVisible({ timeout: 20000 });
  const her = page.locator('.heroi-col', { hasText: 'Cadastro completo' });
  await expect(her).toBeVisible();
  // a mesma conta pura da tela
  const conta = await page.evaluate(() => {
    const base = [...TS.cli.cad.values()];
    return { total: TS.cli.cad.size + [...(TS.cli.fxPorCpf || new Map()).keys()].filter((c) => !TS.cli.cad.has(c)).length };
  });
  await expect(her).toContainText(`de ${new Intl.NumberFormat('pt-BR').format(conta.total)} clientes`);
  const linha = page.locator('[data-qc="nasc"]:visible').first();
  await expect(linha).toBeVisible();
  await linha.click();
  const lista = page.locator('[data-qc-lista="nasc"]');
  await expect(lista).toBeVisible();
  await expect(lista).toContainText('Sem data de nascimento');
  await expect(lista.getByRole('button', { name: 'Baixar lista (CSV)' })).toBeVisible();
  await lista.getByRole('button', { name: 'Fechar' }).click();
  await expect(page.locator('[data-qc-lista]')).toHaveCount(0);
  const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(d).toBeLessThanOrEqual(1);
  expect(erros).toEqual([]);
});
