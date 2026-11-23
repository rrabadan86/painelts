// Revisão visual de 22/11/2026 (impeccable, aprovada pelo dono): regras globais de CSS e teclado.
// VIS-01 barra do topo fixa · VIS-02 texto de exemplo legível · VIS-03 janela dos lotes com Esc e foco
// VIS-04 Estoque no celular enxuto e "no pedido ›" fora do nome · VIS-05 ⭐ Sugestões sem filtros · VIS-06 ✨ some ao rolar
const { test, expect } = require('./_base');

async function abrir(page, hash) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await expect(page.locator('.page-title').first()).toBeVisible({ timeout: 30000 });
}
// contraste WCAG entre duas cores rgb()
const contraste = (a, b) => {
  const lum = (c) => { const v = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('VIS-01: a barra do topo continua fixa depois de rolar bastante', async ({ page }) => {
  await abrir(page, '#estoque');
  await expect(page.locator('#est-tabela')).toBeVisible({ timeout: 30000 });
  // 2ª passada: "Próximas semanas" vem recolhido; aberto, a página fica comprida o bastante para rolar
  const verGraf = page.locator('.est-p2-saz-btn');
  if (await verGraf.count()) await verGraf.click();
  await page.evaluate(() => window.scrollTo(0, 2500));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  const topo = await page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().top);
  expect(Math.abs(topo)).toBeLessThanOrEqual(1);
});

test('VIS-02: texto de exemplo dos campos com contraste de pelo menos 4,5:1', async ({ page }) => {
  await abrir(page, '#estoque');
  const busca = page.locator('.est-busca');
  await expect(busca).toBeVisible({ timeout: 30000 });
  const [cor, fundo] = await busca.evaluate((el) => [getComputedStyle(el, '::placeholder').color, getComputedStyle(el).backgroundColor]);
  expect(contraste(cor, fundo)).toBeGreaterThanOrEqual(4.5);
});

test('VIS-03: janela dos lotes do chá — foco entra, Esc fecha e o foco volta ao nome', async ({ page }) => {
  await abrir(page, '#estoque');
  await expect(page.locator('#est-tabela')).toBeVisible({ timeout: 30000 });
  await page.locator('#est-tabela .seg button[data-val="todos"]').click();
  const nome = page.locator('.est-nome-cha').first();
  await expect(nome).toBeVisible({ timeout: 30000 });
  await nome.focus();
  await page.keyboard.press('Enter');
  const janela = page.locator('.vl-pac');
  await expect(janela).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement.closest('.vl-pac'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(janela).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!(document.activeElement && document.activeElement.classList.contains('est-nome-cha')))).toBe(true);
});

test('VIS-04: Estoque — quadro clicável com Espaço; no celular, cartão enxuto e "no pedido ›" fora do nome', async ({ page }, info) => {
  await abrir(page, '#estoque');
  await expect(page.locator('#est-tabela')).toBeVisible({ timeout: 30000 });
  const quadro = page.locator('.est-p2-heroi .est-p2-ir').first(); // 2ª passada: os números do herói levam à aba (eram quadros clicáveis)
  if (await quadro.count()) {
    await page.locator('#est-tabela .seg button[data-val="todos"]').click();
    await quadro.focus();
    await page.keyboard.press(' ');
    // Espaço aciona o quadro (troca a aba da tabela), não só rola a página
    await expect(page.locator('#est-tabela .seg button[data-val="todos"]')).not.toHaveClass(/\bon\b/);
  }
  if (info.project.name !== 'celular') return;
  await page.locator('#est-tabela .seg button[data-val="repor"]').click();
  const rotulos = await page.locator('#est-tabela tbody tr').first().locator('td[data-l]').evaluateAll((tds) => tds.map((t) => t.dataset.l).filter(Boolean));
  expect(rotulos.length, `rótulos no cartão: ${rotulos.join(', ')}`).toBeLessThanOrEqual(5);
  const ir = page.locator('#est-tabela .est-ir').first();
  if (await ir.count()) expect(await ir.evaluate((el) => getComputedStyle(el).display)).toBe('block');
});

test('VIS-05: ⭐ Sugestões não mostra filtros que não valem na tela', async ({ page }) => {
  await abrir(page, '#sugestoes');
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('pg-semfiltros'))).toBe(true);
});

test('VIS-06: celular — o ✨ some enquanto rola para baixo e o fim da página tem folga para ele', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular');
  await abrir(page, '#estoque');
  const fab = page.locator('#fabIA');
  await expect(fab).toBeVisible({ timeout: 30000 });
  // a lista do Estoque precisa estar na página: com a página ainda curta, 1200 px já é o fim (e no fim o ✨ volta)
  await page.waitForFunction(() => document.documentElement.scrollHeight > window.innerHeight + 2500, null, { timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 1200));
  await expect(fab).toHaveClass(/ia-fab-some/);
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(fab).not.toHaveClass(/ia-fab-some/);
  const folga = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.content')).paddingBottom));
  expect(folga).toBeGreaterThanOrEqual(80);
});
