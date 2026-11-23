// ERRTELA-07: erro de JavaScript numa tela vira aviso para o servidor (sem dado pessoal), aparece em
// Configurações → Erros nas telas e no Início do admin (apresentação: rota de mentira, nada gravado).
const { test, expect } = require('@playwright/test');

const abrir = async (page) => { await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state && TS.state.loja && TS.state.loja !== 'todas'); };

test('ERRTELA-07: erro na tela manda o aviso sem dado pessoal, só uma vez', async ({ page }) => {
  const avisos = [];
  page.on('request', (r) => { if (r.url().includes('/erros-tela') && r.method() === 'POST') avisos.push({ url: r.url(), corpo: JSON.parse(r.postData() || '{}'), painel: r.headers()['x-painel'] }); });
  await abrir(page);
  await page.evaluate(() => { location.hash = '#resumo'; });
  await expect(page.locator('.page-title').first()).toBeVisible();
  // um erro de código "do painel" (o arquivo vem do pacote da tela) com CPF, e-mail e telefone na mensagem
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) TS.avisarErroTela('erro', 'Falhou com 123.456.789-09 e ana@exemplo.com tel 62981718205', location.origin + '/app.js?v=1', 77, 3);
  });
  await expect.poll(() => avisos.length).toBe(1);
  const a = avisos[0];
  expect(a.url).toContain('/api/demo/erros-tela'); // apresentação: nada é gravado
  expect(a.painel).toBe('1');
  expect(a.corpo.tela).toBe('resumo');
  expect(a.corpo.arq).toBe('/app.js?v=1');
  expect(JSON.stringify(a.corpo)).not.toMatch(/123\.456|ana@|62981718205/);
  // erro de extensão do navegador não vai
  await page.evaluate(() => TS.avisarErroTela('erro', 'outra coisa', 'chrome-extension://abc/x.js', 1, 1));
  await page.waitForTimeout(300);
  expect(avisos.length).toBe(1);
});

test('ERRTELA-07: Configurações → Erros nas telas lista os erros; o Início do admin avisa o erro novo', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  await page.evaluate(() => { location.hash = '#inicio'; });
  // o aviso entra na lista do Início (área Outros): abre "Ver todos" e confere
  await expect(page.locator('main').getByText(/erro novo nas telas/).first()).toBeAttached({ timeout: 20000 });
  await page.getByRole('button', { name: /Ver todos os \d+ avisos/ }).first().click();
  const linha = page.locator('main').getByText(/1 erro novo nas telas nos últimos 2 dias/).first();
  await expect(linha).toBeVisible();
  await page.evaluate(() => { TS.state.cfgAba = 'erros'; location.hash = '#config'; });
  const card = page.locator('.card', { hasText: 'Erros nas telas (últimos 7 dias)' });
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card).toContainText("Cannot read properties of undefined (reading 'qtd')");
  await expect(card).toContainText('pedido.js:812');
  await expect(card).toContainText('novo');
  const sobra = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('main .table-wrap')].map((w) => w.scrollWidth - w.clientWidth)));
  expect(sobra, 'tabela sem rolar para o lado').toBeLessThanOrEqual(2);
  expect(erros).toEqual([]);
});
