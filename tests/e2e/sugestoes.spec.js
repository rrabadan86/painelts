const { test, expect } = require('@playwright/test');

// ⭐ Sugestões da equipe: marcar na tela própria, revisar no Pedido ("Não agora" com motivo, registrar) e a resposta voltar
test('Sugestões: marcar produto, justificar quando tem na loja e revisar no Pedido', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.sug && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#sugestoes'; });
  await expect(page.locator('.page-title')).toContainText('Sugestões para o pedido');
  // a apresentação já traz sugestões da equipe
  await expect(page.locator('.sug-t tbody tr').first()).toBeVisible();
  // um produto que ainda tem na loja (pede justificativa)
  const prod = await page.evaluate(async () => {
    const loja = TS.state.loja;
    const e = await (await fetch(`/api/demo/estoque?loja=${encodeURIComponent(loja)}`)).json();
    const it = e.estoque.itens.find((i) => i.qtd > 1 && i.un !== 'Kg' && i.desc.length > 5);
    return { desc: it.desc };
  });
  await page.locator('.sug-busca').fill(prod.desc.slice(0, 12));
  const linha = page.locator('.sug-prod', { hasText: prod.desc }).first();
  await expect(linha).toBeVisible();
  await expect(linha.locator('.badge')).toHaveText('Tem na loja');
  await expect(linha).not.toContainText(/R\$/);
  await linha.getByRole('button', { name: '☆ Sugerir' }).click();
  await linha.getByRole('button', { name: '⭐ Confirmar sugestão' }).click();
  await expect(linha.locator('.neg')).toContainText('ainda tem na loja');
  await linha.locator('.sug-just').fill('Cliente leva sempre 3 de presente');
  await linha.getByRole('button', { name: '⭐ Confirmar sugestão' }).click();
  await expect(page.locator('.sug-t tbody tr', { hasText: prod.desc })).toContainText('Aguardando o próximo pedido');

  // no Pedido: quadro com as sugestões, "Não agora" com motivo e registrar
  await page.evaluate(() => { location.hash = '#pedido'; });
  const quadro = page.locator('.sug-ped-card');
  await expect(quadro).toBeVisible({ timeout: 20000 });
  const minha = quadro.locator('.sug-ped', { hasText: prod.desc });
  await expect(minha).toContainText('Cliente leva sempre 3 de presente');
  await minha.getByRole('button', { name: 'Não agora ▾' }).click();
  await minha.getByRole('button', { name: 'Vende pouco' }).click();
  await expect(quadro.locator('.sug-ped', { hasText: prod.desc })).toContainText('Não agora: Vende pouco');
  await quadro.getByRole('button', { name: 'Registrar o pedido nas sugestões' }).click();
  await expect(page.locator('.sug-ped-msg').first()).toContainText('Sugestões respondidas');

  // a resposta volta para a tela de sugestões e o produto continua marcado para o próximo pedido
  await page.evaluate(() => { location.hash = '#sugestoes'; });
  await expect(page.locator('.sug-t tbody tr', { hasText: prod.desc })).toContainText('Não entrou');
  await expect(page.locator('.sug-t tbody tr', { hasText: prod.desc })).toContainText('continua marcada para o próximo');
});
