// GRAF-01: gráfico sempre do tamanho do cartão. Print do dono (23/11/2026): às vezes o gráfico ficava pequeno no canto e o
// resto do cartão em branco — ele nascia quando o cartão ainda não tinha largura (painel voltando do segundo plano).
const { test, expect } = require('@playwright/test');

const abrir = async (page) => { await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas'); };
const larguras = (page) => page.evaluate(() => [...document.querySelectorAll('main .chart-box canvas')].filter((c) => c.offsetParent).map((c) => ({ c: c.clientWidth, b: c.parentNode.clientWidth })));

test('GRAF-01: os gráficos das telas ocupam a largura do cartão', async ({ page }) => {
  await abrir(page);
  for (const t of ['resumo', 'comparativos']) {
    await page.evaluate((h) => { location.hash = '#' + h; }, t);
    await expect(page.locator('main .chart-box canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(800);
    const l = await larguras(page);
    expect(l.length, t).toBeGreaterThan(0);
    for (const x of l) expect(Math.abs(x.c - x.b), `${t}: gráfico ${x.c}px num cartão de ${x.b}px`).toBeLessThanOrEqual(2);
  }
});

test('GRAF-01: gráfico criado num cartão ainda sem largura cresce quando o cartão aparece; volta ao tamanho ao reabrir o painel', async ({ page }) => {
  await abrir(page);
  await page.evaluate(() => { location.hash = '#resumo'; });
  await expect(page.locator('main .chart-box canvas').first()).toBeVisible({ timeout: 30000 });
  // 1) cartão escondido (largura 0) na hora de criar o gráfico
  await page.evaluate(() => {
    const caixa = document.createElement('div'); caixa.id = 'g-teste'; caixa.style.display = 'none';
    caixa.append(TS.chart({ type: 'bar', data: { labels: ['a', 'b'], datasets: [{ label: 'x', data: [1, 2] }] }, options: { responsive: true, maintainAspectRatio: false } }));
    document.querySelector('main').append(caixa);
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.getElementById('g-teste').style.display = 'block'; });
  await expect.poll(() => page.evaluate(() => { const c = document.querySelector('#g-teste canvas'); return c && Math.abs(c.clientWidth - c.parentNode.clientWidth); }), { timeout: 5000 }).toBeLessThanOrEqual(2);
});

test('GRAF-02: gráfico desenhado com a densidade de pixels errada se refaz quando o painel volta a aparecer', async ({ page }) => {
  await abrir(page);
  await page.evaluate(() => { location.hash = '#resumo'; });
  await expect(page.locator('main .chart-box canvas').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(800);
  // simula o defeito do print: o gráfico fica com a densidade de outra tela (só um canto desenhado)
  const errado = await page.evaluate(() => {
    const c = document.querySelector('main .chart-box canvas'), ch = Chart.getChart(c);
    ch.options.devicePixelRatio = 0.4; ch.resize(); const w = c.width; delete ch.options.devicePixelRatio; return w;
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(500);
  const certo = await page.evaluate(() => { const c = document.querySelector('main .chart-box canvas'); return { w: c.width, css: c.clientWidth, dpr: devicePixelRatio }; });
  expect(errado).toBeLessThan(certo.css);
  expect(Math.abs(certo.w - certo.css * certo.dpr), 'o quadro voltou à densidade da tela').toBeLessThanOrEqual(2);
});
