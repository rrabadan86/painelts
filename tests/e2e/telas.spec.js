// Abre todas as telas da apresentação e procura problemas que já apareceram antes:
// erro de JavaScript, "null"/"undefined"/"NaN" na tela, aviso de erro, página mais larga que a tela (celular)
const { test, expect } = require('@playwright/test');

const TELAS = ['inicio', 'resumo', 'comparativos', 'promocao', 'cupons', 'clilista', 'clientes', 'campanhas', 'espera', 'comissionamento', 'mapa',
  'rentab', 'precos', 'site', 'estoque', 'pedido', 'notas', 'nfsaida', 'dre', 'config'];

/** carrega a apresentação uma vez por página do navegador */
async function abrirApresentacao(page) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && document.querySelector('#tabs a'), null, { timeout: 60000 });
}
async function irPara(page, tela) {
  await page.evaluate((t) => { location.hash = '#' + t; }, tela);
  // a tela terminou de desenhar: sem "carregando" e com o título
  await page.waitForFunction(() => !document.querySelector('main .loading .spinner') && document.querySelector('main h1, main .page-title, main .card'), null, { timeout: 30000 });
  await page.waitForTimeout(400);
}
const TEXTO_RUIM = /(^|[\s>(\d])(null|undefined|NaN|\[object Object\])(?=$|[\s<).,])/m;

for (const tela of TELAS) {
  test(`tela ${tela}`, async ({ page }, info) => {
    const erros = [];
    page.on('pageerror', (e) => erros.push('JS: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) erros.push('console: ' + m.text()); });
    await abrirApresentacao(page);
    await irPara(page, tela);
    const main = page.locator('main');
    const texto = await main.innerText();
    expect(texto, 'texto quebrado na tela').not.toMatch(TEXTO_RUIM);
    // avisos vermelhos de falha (os vermelhos de negócio, como "a promoção não se pagou", são normais)
    const avisosErro = (await page.locator('main .notice.err').allInnerTexts()).filter((t) => /falha|erro|failed|não foi possível|sem permissão/i.test(t));
    expect(avisosErro, 'aviso de falha na tela').toEqual([]);
    if (info.project.name === 'celular') {
      const sobra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(sobra, 'página mais larga que a tela do celular').toBeLessThanOrEqual(1);
    }
    expect(erros, 'erros no navegador').toEqual([]);
  });
}

test('menu: cada grupo abre e o submenu marca a tela', async ({ page }) => {
  await abrirApresentacao(page);
  const grupos = await page.locator('#tabs a').count();
  expect(grupos).toBeGreaterThanOrEqual(6);
  for (let i = 0; i < grupos; i++) {
    const a = page.locator('#tabs a').nth(i);
    await a.click();
    await expect(a).toHaveClass(/active/);
  }
});
