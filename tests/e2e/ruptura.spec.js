const { test, expect, opcaoAtiva } = require('./_base');

// Estoque: quadros "Perdendo por falta" e "Dinheiro sobrando" filtram a tabela; abas com contagem e colunas com a conta
test('Estoque: perdendo venda por falta e dinheiro sobrando — quadros, abas e colunas', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#estoque'; });
  const card = page.locator('#est-tabela');
  await expect(card).toBeVisible({ timeout: 20000 });

  // "Perdendo por falta" (1ª coluna do cartão-herói, 2ª passada de 23/11/2026): R$ por dia e nº de produtos; o link filtra a tabela
  const kFalta = page.locator('.est-p2-heroi .heroi-col', { hasText: 'Perdendo por falta' });
  await expect(kFalta.locator('.heroi-num')).toContainText(/R\$.*por dia/);
  await kFalta.locator('.est-p2-ir[data-aba="falta"]').click();
  // a aba escolhida (abas no computador; o botão da folha no celular, FOLHA-01)
  await expect.poll(() => opcaoAtiva(page, card.locator('.est-tools'))).toMatch(/Perdendo venda \(\d+\)/);
  const nFalta = +(await opcaoAtiva(page, card.locator('.est-tools'))).match(/\((\d+)\)/)[1];
  expect(nFalta).toBeGreaterThan(0);
  await expect(kFalta).toContainText(String(nFalta));
  await expect(card).toContainText('Perdendo R$/dia');
  await expect(card).toContainText('Zerado há');
  await expect(card).toContainText('Na lista de espera');
  await expect(kFalta).toContainText(/⏳ \d+ com cliente esperando/); // a apresentação tem cliente aguardando produto zerado
  // só entra produto zerado, e a soma das linhas é o número do quadro
  const conta = await page.evaluate(async () => {
    const e = await TS.estoqueBuscar(TS.state.loja);
    return { zerados: e.estoque.itens.filter((i) => !(i.qtd > 0)).length, espera: Object.keys(e.espera).length };
  });
  expect(conta.zerados).toBeGreaterThanOrEqual(nFalta);
  expect(conta.espera).toBeGreaterThan(0);

  // linha "Sobrando" do herói (dinheiro sobrando) → aba "Sobrando (N)" com unidades e R$ a custo
  const kSobra = page.locator('.est-p2-heroi .linhas-num-a', { hasText: 'Sobrando' });
  await kSobra.click();
  await expect.poll(() => opcaoAtiva(page, card.locator('.est-tools'))).toMatch(/Sobrando \(\d+\)/);
  const nSobra = +(await opcaoAtiva(page, card.locator('.est-tools'))).match(/\((\d+)\)/)[1];
  if (nSobra) {
    await expect(kSobra.locator('.linhas-num-v')).toContainText('R$');
    await expect(card).toContainText('Sobrando R$ (custo)');
    await expect(card).toContainText('Precisa ter');
  } else await expect(card).toContainText('Nenhum produto com saldo demais');

  // nada de "null", "undefined" ou "NaN" na tela
  await expect(card).not.toContainText(/null|undefined|NaN/);
  await expect(page.locator('.est-p2-heroi')).not.toContainText(/null|undefined|NaN/);
});
