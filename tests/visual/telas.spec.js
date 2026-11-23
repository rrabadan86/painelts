// PRINTS-01: prints de referência das telas principais (computador e celular). Uma mudança de layout que ninguém pediu
// (cartão que corta, coluna que some, buraco branco, botão sozinho numa linha) aparece aqui como diferença de imagem.
// Mudança de propósito: atualize as referências pelo GitHub (veja playwright.visual.config.js).
const { test, expect } = require('@playwright/test');
const RELOGIO = require('./_relogio');

const TELAS = ['inicio', 'resumo', 'comparativos', 'cupons', 'estoque', 'validade', 'pedido', 'notas', 'hoje', 'campanhas', 'comissionamento', 'dre', 'config'];

// o que muda sozinho e não é layout: a hora do "Atualizado" e o ✨ flutuante (some e volta ao rolar)
const CSS_ESTAVEL = `
  .ia-fab { display: none !important; }
  *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
`;

test.beforeEach(async ({ page }) => {
  // o navegador no mesmo dia e hora do servidor (relogio-fixo.js), com o tempo andando (esperas e animações continuam)
  await page.clock.install({ time: new Date(RELOGIO) });
  await page.clock.resume();
  // gráficos: a animação dura 250 ms (components.js) e o toHaveScreenshot só aceita duas fotos iguais seguidas,
  // então o print sai do desenho final (desligar a animação do Chart.js quebra o components.js)
});

/** a tela terminou de montar: nada de "Carregando…", "Conferindo…", "Escolhendo as ações…" nem roda girando, e o tamanho
 *  da página parado por 1,5 s (avisos, lotes, ações e o pedido chegam depois da primeira pintura) */
async function pronta(page) {
  await page.evaluate(() => { window.__sigPrint = null; });
  await page.waitForFunction(() => {
    const main = document.querySelector('main') || document.body;
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const carregando = [...main.querySelectorAll('.spinner, .loading')].some(vis)
      || /(Carregando|Conferindo|Escolhendo|Montando|Calculando|Buscando)[^.\n]{0,40}(…|\.\.\.)/.test(main.innerText);
    const sig = document.documentElement.scrollHeight + '|' + main.innerText.length;
    const w = window; const agora = performance.now();
    if (carregando || w.__sigPrint !== sig) { w.__sigPrint = sig; w.__desdePrint = agora; return false; }
    return agora - w.__desdePrint > 1500;
  }, null, { timeout: 60000, polling: 200 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

for (const tela of TELAS) {
  test(`PRINTS-01: ${tela}`, async ({ page }) => {
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    const largura0 = page.viewportSize().width;
    await page.goto('/apresentacao');
    await page.waitForFunction(() => window.TS && TS.db && TS.state && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
    await page.evaluate((h) => { location.hash = '#' + h; }, tela);
    await expect(page.locator('.page-title, .cfg-lojas, .cfg-loja-nome').first()).toBeVisible({ timeout: 30000 });
    await page.addStyleTag({ content: CSS_ESTAVEL });
    await page.waitForLoadState('networkidle');
    await page.evaluate(async () => { await document.fonts.ready; await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))); });
    // desce a página até o fim e volta: blocos que só carregam quando aparecem (ex.: "Sua loja × rede") ficam prontos
    // em toda rodada, não só quando deu tempo
    await page.evaluate(async () => {
      const passo = Math.max(300, innerHeight - 100);
      for (let y = 0; y < document.documentElement.scrollHeight; y += passo) { window.scrollTo(0, y); await new Promise((ok) => setTimeout(ok, 60)); }
      window.scrollTo(0, 0);
    });
    await page.waitForLoadState('networkidle');
    // a página inteira, cortada no começo (computador 3.000 px, celular 4.500 px): pega o topo, o herói e o começo
    // das listas sem guardar imagens de 13.000 px no Git. Se a tela se redesenhar no meio (ela às vezes volta a
    // "Carregando…" um instante), espera ficar pronta de novo e tira outra vez; diferença de verdade continua falhando.
    await expect(async () => {
      await pronta(page);
      // sem fullPage: o print de página inteira do Chromium muda a largura da janela por um instante, cruza o limite de
      // 860 px (computador × celular) e o painel redesenha a tela no meio do print ("Lendo as notas…" na referência).
      // Em vez disso a janela cresce só na altura (não dispara redesenho) e o print é da janela.
      const larg = largura0, alto = await page.evaluate(() => document.documentElement.scrollHeight);
      const altura = Math.min(alto, larg > 600 ? 3000 : 4500);
      if (page.viewportSize().height !== altura) { await page.setViewportSize({ width: larg, height: altura }); await pronta(page); }
      expect(await page.evaluate(() => !!document.querySelector('main .loading, main .spinner')), 'tela ainda carregando no print').toBe(false);
      await expect(page).toHaveScreenshot(`${tela}.png`, { mask: [page.locator('#updated')], timeout: 10000 });
    }).toPass({ timeout: 60000, intervals: [1000, 2000, 3000] });
    expect(erros, 'erro de JavaScript na tela').toEqual([]);
  });
}
