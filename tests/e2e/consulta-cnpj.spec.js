const { test, expect } = require('@playwright/test');

// Consulta pública de CNPJ/CEP (BrasilAPI). Na apresentação a resposta é fictícia: nada sai para a internet.
test('Orçamento: CNPJ novo busca a empresa na Receita e preenche o que está vazio', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#orcamento'; });
  await page.getByRole('button', { name: '+ Novo orçamento' }).click();
  const email = page.locator('.cfr-campo', { hasText: 'E-mail' }).locator('input');
  await email.fill('meu@cliente.com');
  await page.locator('.cfr-campo', { hasText: 'CNPJ / CPF' }).locator('input').fill('11.222.333/0001-81');
  await expect(page.locator('.orc-rec-info')).toContainText('Receita: empresa ativa');
  await expect(page.locator('.cfr-campo', { hasText: 'Empresa' }).locator('input')).toHaveValue('EMPÓRIO EXEMPLO COMÉRCIO DE PRESENTES LTDA');
  await expect(page.locator('.cfr-campo', { hasText: 'Telefone' }).locator('input')).toHaveValue('(11) 3000-0000');
  await expect(email).toHaveValue('meu@cliente.com'); // o que a pessoa digitou fica
});

test('Cadastrar parceiro: CNPJ preenche razão social e CEP, e o CEP mostra o endereço', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.abrirFormParceiro);
  await page.evaluate(() => TS.abrirFormParceiro('demo-centro', () => {}));
  const modal = page.locator('.np-modal');
  await modal.locator('.np-campo', { hasText: 'CNPJ' }).locator('input').fill('11222333000181');
  await expect(modal.locator('.np-consulta').first()).toContainText('Achado na Receita');
  await expect(modal.locator('.np-campo', { hasText: 'Razão social' }).locator('input')).toHaveValue('EMPÓRIO EXEMPLO COMÉRCIO DE PRESENTES LTDA');
  await expect(modal.locator('.np-campo', { hasText: 'CEP' }).locator('input')).toHaveValue('01310100');
  await expect(modal.locator('.np-consulta').nth(1)).toContainText('Rua de Exemplo');
  // CNPJ com dígito errado: avisa e não preenche nada
  await modal.locator('.np-campo', { hasText: 'Razão social' }).locator('input').fill('');
  await modal.locator('.np-campo', { hasText: 'CNPJ' }).locator('input').fill('11222333000182');
  await expect(modal.locator('.np-consulta').first()).toContainText('inválido');
  await expect(modal.locator('.np-campo', { hasText: 'Razão social' }).locator('input')).toHaveValue('');
  const larga = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(larga).toBeLessThanOrEqual(1);
});
