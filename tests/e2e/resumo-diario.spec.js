// Campanha Resumo diário na apresentação: a tela Hoje leva até ela, o formulário mostra os motivos (padrão: validade, pontos
// vencendo e hora de repor) com o texto de cada um, e a campanha criada tem um cliente por linha com o motivo dele.
const { test, expect } = require('@playwright/test');

test.describe('Campanha Resumo diário', () => {
  let erros;
  test.beforeEach(async ({ page }) => {
    erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await page.goto('/apresentacao');
    await page.waitForFunction(() => window.TS && TS.db && TS.cli && TS.cli.lista);
  });
  const semVazar = async (page, alvo) => {
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw - cw, 'sem rolagem para o lado').toBeLessThanOrEqual(2);
    expect(await alvo.innerText()).not.toMatch(/(^|\s)(null|undefined|NaN)(\s|$)/m);
  };

  test('RESUMO-06: Hoje → criar a campanha → um cliente por linha, com o motivo e o texto dele', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#hoje'; });
    const faixa = page.locator('.hj-resumo');
    await expect(faixa).toContainText('Quer que o robô do WhatsApp envie parte desta lista sozinho');
    await faixa.getByRole('button', { name: 'Criar a Campanha Resumo diário' }).click();
    const form = page.locator('.cp-resumo');
    await expect(form).toBeVisible();
    // os 7 motivos, na ordem de importância; marcados por padrão: validade, pontos vencendo e hora de repor
    await expect(form.locator('.cp-resumo-mot')).toHaveCount(7);
    await expect(form.locator('.cp-resumo-mot.on')).toHaveCount(3);
    await expect(form.locator('.cp-resumo-mot.on b')).toHaveText(['🍃 Chá dele perto da validade', '★ Pontos vencendo', '🍵 Hora de repor']);
    await expect(form.locator('.cp-resumo-mot.on textarea').first()).toHaveValue(/\{apresentacao\}/);
    await semVazar(page, form);
    // marca mais um motivo: aparece o texto dele
    await form.locator('.cp-resumo-mot').filter({ hasText: 'Aniversário' }).locator('input[type=checkbox]').check();
    await expect(form.locator('.cp-resumo-mot.on')).toHaveCount(4);
    await form.getByRole('button', { name: 'Criar a campanha' }).click();
    // a campanha abre: todo dia, e cada cliente com o motivo dele na tabela
    await expect(page.locator('.cp-head h2')).toHaveText('Campanha Resumo diário');
    await expect(page.locator('.cp-head .page-sub')).toContainText('Todo dia');
    const tabela = page.locator('.card', { hasText: 'Clientes da campanha' });
    const n = await tabela.locator('tbody tr').count();
    if (n && !(await tabela.locator('td.t-vazio').count())) await expect(tabela.locator('.cp-motivo').first()).toHaveText(/validade|Pontos|repor|Aniversário/);
    // editar volta para o formulário do Resumo (não o das campanhas comuns), com os motivos salvos
    await page.getByRole('button', { name: 'Editar campanha' }).click();
    await expect(page.locator('.cp-resumo-mot.on')).toHaveCount(4);
    expect(erros).toEqual([]);
  });
});
