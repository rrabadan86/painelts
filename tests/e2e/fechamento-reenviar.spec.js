const { test, expect } = require('./_base');

// FECH-REENV-01 (pedido do dono, 25/11/2026): em Vendas → Conferência → Caixa × painel → Dia a dia, cada dia tem
// "✉ Reenviar" o fechamento (admin e franqueado); pede confirmação e manda o dia escolhido (na apresentação nada sai)
test('FECH-REENV-01: reenviar o fechamento de um dia pela Conferência', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  let corpo = null;
  page.on('request', (r) => { if (r.url().includes('/api/demo/fechamento/reenviar')) corpo = JSON.parse(r.postData() || '{}'); });
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#conferencia'; });
  const bt = page.locator('.conf-reenv').first();
  await expect(bt).toBeVisible({ timeout: 30000 });
  const rotulo = await bt.getAttribute('aria-label');
  const dm = rotulo.match(/(\d\d)\/(\d\d)/);
  await bt.click();
  const jan = page.locator('.ts-aviso-bg').last();
  await expect(jan).toContainText('Reenviar o fechamento de');
  await jan.getByRole('button', { name: 'Reenviar' }).click();
  await expect.poll(() => corpo && corpo.dia).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(corpo.dia.slice(8, 10) + '/' + corpo.dia.slice(5, 7)).toBe(`${dm[1]}/${dm[2]}`);
  await expect(page.locator('.ts-aviso-bg').last()).toContainText('reenviado para 2 destinatários');
  await expect(page.locator('.ts-aviso-bg').last()).toContainText('nada foi enviado');
  expect(erros).toEqual([]);
});

// FECH-DIA-01 (pedido do dono, 25/11/2026): tocar no dia abre o fechamento daquele dia (o mesmo do e-mail)
test('FECH-DIA-01: tocar no dia da Conferência abre o fechamento daquele dia', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#conferencia'; });
  const bt = page.locator('.conf-reenv').nth(1); // o 2º dia (ontem)
  await expect(bt).toBeVisible({ timeout: 30000 });
  const m = (await bt.getAttribute('aria-label')).match(/(\d\d)\/(\d\d)/);
  await bt.evaluate((b) => (b.closest('tr') || b.closest('.lmob-it')).click()); // toca na linha, fora do botão
  const jan = page.locator('.camada-fech');
  await expect(jan).toBeVisible();
  await expect(jan.locator('.fech-data')).toHaveValue(new RegExp(`-${m[2]}-${m[1]}$`));
  await expect(jan.locator('.fech-tabela')).not.toBeEmpty();
  expect(erros).toEqual([]);
});

// ACESSO-DIAS-01 (decisão do dono, 25/11/2026): o prazo de acesso do usuário é em dias, com atalhos (14 dias de teste)
test('ACESSO-DIAS-01: Configurações → Usuários → Editar: acesso por dias', async ({ page }) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja, null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#config'; });
  await page.getByRole('button', { name: /^Usuários/ }).first().click();
  await page.getByRole('button', { name: 'Editar' }).nth(1).click();
  await expect(page.getByText('Acesso por (dias)')).toBeVisible();
  await page.locator('.cfg-meses .chip', { hasText: '14 dias' }).click();
  const esperado = await page.evaluate(() => { const d = new Date(TS.hojeSP() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 14); const i = d.toISOString().slice(0, 10); return `${i.slice(8, 10)}/${i.slice(5, 7)}/${i.slice(0, 4)}`; });
  await expect(page.getByText(`Acesso até ${esperado} (último dia).`)).toBeVisible();
});
