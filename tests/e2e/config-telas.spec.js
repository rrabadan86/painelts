const { test, expect } = require('./_base');

// Configurações → Usuários: todas as telas agrupadas como no menu, padrão de cada perfil e regras fixas travadas
test('Usuários: telas agrupadas como no menu, regras fixas travadas e padrão do gerente', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#config'; });
  await page.locator('.cfg-abas button', { hasText: 'Usuários' }).click();
  await page.locator('tr', { hasText: 'gerente.centro' }).getByRole('button', { name: 'Editar' }).click();
  const form = page.locator('.cfg-user-form');
  await expect(form.locator('.cfg-campo:not(.cfg-campo-wpp) .cfg-telas-g legend')).toHaveText(['Início', 'Vendas', 'Clientes', 'Equipe', 'Produtos', 'Estoque', 'Resultado', 'Configurações']);
  const cb = (id) => form.locator(`input[data-tela="${id}"]`);
  // gerente: marcações dele; Sugestões existe e é editável; Orçamento e Configurações travados desmarcados; Checklist travado marcado
  await expect(cb('sugestoes')).toBeEnabled();
  await expect(cb('clientes')).toBeChecked();
  await expect(cb('orcamento')).toBeDisabled(); await expect(cb('orcamento')).not.toBeChecked();
  await expect(cb('config')).toBeDisabled();
  await expect(cb('checklist')).toBeDisabled(); await expect(cb('checklist')).toBeChecked();
  // voltar ao padrão: Clientes e custos desmarcados; Sugestões e Lista de espera marcadas
  await form.getByRole('button', { name: 'Voltar ao padrão do gerente' }).click();
  await expect(cb('clientes')).not.toBeChecked();
  await expect(cb('pedido')).not.toBeChecked();
  await expect(cb('sugestoes')).toBeChecked();
  await expect(cb('espera')).toBeChecked();
  // vendedora: tudo travado; fixas marcadas; custo e Clientes desmarcados com o motivo
  await form.locator('select').first().selectOption('vendedor');
  await expect(form.locator('.cfg-tela input:not([disabled])')).toHaveCount(0);
  await expect(form.locator('input[data-perm]')).toHaveCount(0); // a vendedora não tem robô nem Conversas
  for (const id of ['sugestoes', 'espera', 'inventario', 'validade', 'minha', 'checklist']) await expect(cb(id)).toBeChecked();
  for (const id of ['estoque', 'pedido', 'clientes', 'dre']) await expect(cb(id)).not.toBeChecked();
  await expect(form.locator('.cfg-tela:has(input[data-tela="pedido"])')).toContainText('Custo e margem nunca aparecem para a vendedora');
  // franqueado: telas todas marcadas e travadas
  await form.locator('select').first().selectOption('franqueado');
  await expect(form.locator('.cfg-tela input[data-tela]:not(:checked)')).toHaveCount(0);
  // ZAP-PERM-01/02: WhatsApp — o robô vem desligado e as Conversas liberadas; o admin muda os dois
  const robo = form.locator('input[data-perm="robo"]'), conv = form.locator('input[data-perm="conversas"]');
  await expect(form.locator('.cfg-campo-wpp legend')).toHaveText('WhatsApp da loja');
  await expect(robo).not.toBeChecked(); await expect(robo).toBeEnabled();
  await expect(conv).toBeChecked(); await expect(conv).toBeEnabled();
  await robo.check(); await conv.uncheck();
  await expect(robo).toBeChecked(); await expect(conv).not.toBeChecked();
  // gerente: só o robô (as Conversas nunca são da gerente)
  await form.locator('select').first().selectOption('gerente');
  await expect(robo).toBeVisible(); await expect(conv).toHaveCount(0);
  expect(erros).toEqual([]);
});
