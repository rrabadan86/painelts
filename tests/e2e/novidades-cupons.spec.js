const { test, expect } = require('./_base');

// NOV-03: "O que mudou no painel" pelo menu do nome (na apresentação a janela não abre sozinha)
test('NOV-03: menu do nome → "O que mudou no painel" abre as novidades e "Entendi" fecha', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja);
  await expect(page.locator('.nov-caixa')).toHaveCount(0); // não abre sozinha na apresentação
  await page.locator('#btnUsuario').click();
  await page.locator('#btnNovidades').click();
  const j = page.locator('.nov-caixa');
  await expect(j.locator('h2')).toContainText('O que mudou no painel');
  expect(await j.locator('.nov-item').count()).toBeGreaterThan(2);
  // a mais recente para o administrador (a apresentação entra como admin) aparece; antes era um título fixo, que saía
  // da janela quando chegavam mais de 12 novidades depois dele
  const { NOVIDADES } = require('../../src/novidades');
  const ultima = NOVIDADES.filter((n) => !n.para || n.para.includes('admin')).pop();
  await expect(j).toContainText(ultima.titulo);
  await j.getByRole('button', { name: 'Entendi' }).click();
  await expect(page.locator('.nov-caixa')).toHaveCount(0);
  expect(erros).toEqual([]);
});

// CUP-MOB-01 (pedido do dono, 24/11/2026): no celular, Cupons em uma coluna — cupom com hora, vendedora, CPF e itens
// embaixo e o valor à direita; o item com o nome inteiro; nada sai da tela. No computador, a tabela continua com as colunas.
test('CUP-MOB-01: Cupons — no celular, cupom em duas linhas com o valor à direita e o item com o nome inteiro', async ({ page }, info) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja);
  await page.evaluate(() => { location.hash = '#cupons'; });
  const t = page.locator('.cupons-t');
  await expect(t).toBeVisible();
  await t.locator('tr.lv0 .tree-btn').first().click();
  const cup = t.locator('tr.lv1').first();
  await cup.locator('.tree-btn').click();
  const item = t.locator('tr.lv2').first();
  if (info.project.name === 'celular') {
    await expect(cup.locator('.cup-mob')).toBeVisible();
    await expect(cup.locator('.cup-mob-v')).toContainText('R$');
    await expect(cup.locator('.cup-mob-l')).toContainText(/\d{2}:\d{2}/);
    await expect(item.locator('.cup-mob-v')).toContainText(/\d+ × R\$/);
    await expect(t.locator('thead th').nth(1)).toBeHidden();
    // o nome do item não é cortado: cabe inteiro na largura da linha
    const corte = await item.evaluate((tr) => { const s = tr.querySelector('.tree-cell > span:last-child'); return s.scrollWidth - s.clientWidth; });
    expect(corte).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  } else {
    await expect(cup.locator('.cup-mob')).toBeHidden();
    await expect(t.locator('thead th').nth(1)).toBeVisible();
  }
  expect(erros).toEqual([]);
});
