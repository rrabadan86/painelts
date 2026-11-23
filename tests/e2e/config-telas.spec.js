const { test, expect } = require('./_base');

// Configurações → Usuários: todas as telas agrupadas como no menu, padrão de cada perfil e regras fixas travadas
test('Usuários: telas agrupadas como no menu, regras fixas travadas e padrão do gerente', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#config'; });
  await page.locator('.cfg-abas button', { hasText: 'Usuários' }).click();
  await page.locator('tr', { hasText: 'gerente.centro' }).getByRole('button', { name: 'Editar' }).click();
  const form = page.locator('.cfg-user-form');
  await expect(form.locator('.cfg-telas-g legend')).toHaveText(['Início', 'Vendas', 'Clientes', 'Equipe', 'Produtos', 'Estoque', 'Resultado', 'Configurações']);
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
  for (const id of ['sugestoes', 'espera', 'inventario', 'validade', 'minha', 'checklist']) await expect(cb(id)).toBeChecked();
  for (const id of ['estoque', 'pedido', 'clientes', 'dre']) await expect(cb(id)).not.toBeChecked();
  await expect(form.locator('.cfg-tela:has(input[data-tela="pedido"])')).toContainText('Custo e margem nunca aparecem para a vendedora');
  // franqueado: tudo marcado e travado
  await form.locator('select').first().selectOption('franqueado');
  await expect(form.locator('.cfg-tela input:not(:checked)')).toHaveCount(0);
  expect(erros).toEqual([]);
});
