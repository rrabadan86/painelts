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
