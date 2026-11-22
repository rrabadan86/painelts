// Clientes → Hoje depois da revisão de 22/11 (decisões do dono): a lista vem no topo (a Meta de hoje foi para o Início),
// a contagem fica no cabeçalho, tocar em WhatsApp mostra "Desfazer" por alguns segundos e o link que abre a conversa vazia
// passa pela regra forte (na apresentação só avisa: nada abre nem é gravado).
const { test, expect } = require('@playwright/test');

test.describe('Clientes → Hoje', () => {
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

  test('HOJE-01: lista no topo, contagem no cabeçalho, sem a Meta de hoje; nome com toque de 24 px; mensagem com reticências', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#hoje'; });
    const card = page.locator('.hj-card');
    await expect(card.locator('.hj-item').first()).toBeVisible();
    await expect(page.locator('main .md-card')).toHaveCount(0);
    await expect(page.locator('main .g-kpi')).toHaveCount(0);
    await expect(card.locator('.hj-conta')).toContainText(/[\d.]+ para contatar · \d+ contatados? hoje/);
    // o primeiro WhatsApp aparece logo (antes eram ~1.450 px no celular; o título e os cartões do redesenho de 22/11 têm folga maior)
    const topo = await card.locator('.hj-wpp, .hj-robo').first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(topo).toBeLessThan(960);
    const alt = await card.locator('.hj-nome').first().evaluate((el) => el.getBoundingClientRect().height);
    expect(alt).toBeGreaterThanOrEqual(24);
    // chips com dica e estado anunciado
    await expect(card.locator('.hj-chips .chip').first()).toHaveAttribute('aria-pressed', 'true');
    await expect(card.locator('.hj-chips .chip').nth(1)).toHaveAttribute('title', /.+/);
    // a mensagem abre inteira ao tocar
    const msg = card.locator('.hj-msg').first();
    await msg.click();
    await expect(msg).toHaveAttribute('aria-expanded', 'true');
    await semVazar(page, card);
    expect(erros).toEqual([]);
  });

  test('HOJE-02: tocar em WhatsApp marca o cliente e mostra "Desfazer"; desfazer põe de volta na lista', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#hoje'; });
    const card = page.locator('.hj-card');
    const bt = card.locator('.hj-wpp').first();
    await expect(bt).toBeVisible();
    const item = bt.locator('xpath=ancestor::div[contains(@class,"hj-item")]');
    const nome = await item.locator('.hj-nome').innerText();
    const contados = async () => +(await card.locator('.hj-conta b').nth(1).innerText()).replace(/\D/g, '');
    const antes = await contados();
    await bt.click();
    // na apresentação a mensagem aparece numa janela do painel (sem alert do navegador)
    await page.locator('.ts-perg').getByRole('button', { name: 'Entendi' }).click();
    const faixa = page.locator('.hj-desfazer');
    await expect(faixa).toContainText('marcada como contatada');
    await expect(page.locator('.hj-card .hj-nome', { hasText: nome })).toHaveCount(0);
    expect(await contados()).toBe(antes + 1);
    await faixa.getByRole('button', { name: 'Desfazer' }).click();
    await expect(faixa).toHaveCount(0);
    await expect(page.locator('.hj-card .hj-nome', { hasText: nome }).first()).toBeVisible();
    expect(await contados()).toBe(antes);
    expect(erros).toEqual([]);
  });

  test('RESUMO-07 (tela): o "● WhatsApp" que abre a conversa vazia passa pela conferência — na apresentação só avisa', async ({ page }) => {
    let abriu = false;
    page.on('popup', () => { abriu = true; });
    await page.evaluate(() => { location.hash = '#clilista'; });
    const link = page.locator('.cli-list a.wpp').first();
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href')).toBe('#');
    const alt = await link.evaluate((el) => el.getBoundingClientRect().height);
    expect(alt).toBeGreaterThanOrEqual(24);
    await link.click();
    await expect(page.locator('.ts-perg')).toContainText('o servidor confere antes');
    expect(abriu).toBe(false);
    expect(erros).toEqual([]);
  });

  test('Indicadores: "Saúde da base" no topo com o caminho para agir e o alcance dos filtros em cada seção', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#clientes'; });
    // redesenho: o "como está" num cartão-herói (clientes bons sumindo · vendas com CPF · recompra) e o "o que fazer" em ações numeradas
    const saude = page.locator('.heroi', { hasText: 'Saúde da base' });
    await expect(saude).toBeVisible();
    await expect(saude.locator('.heroi-col')).toHaveCount(3);
    await expect(saude).toContainText('Clientes bons sumindo');
    await expect(saude).toContainText('Vendas com CPF');
    await expect(saude).toContainText('Recompra em 90 dias');
    await expect(page.locator('.acoes-num').getByRole('link', { name: 'Contatar → Hoje ›' })).toBeVisible();
    await expect(page.locator('.cli-alcance').first()).toContainText('Clientes sumindo: a loja toda');
    await expect(page.locator('.cli-alcance', { hasText: 'Período e loja dos filtros (o gráfico' })).toBeVisible();
    await expect(page.locator('.cli-alcance', { hasText: 'não seguem o período nem os filtros de cliente' })).toBeVisible();
    // a lista de cartões não é montada nos Indicadores
    await expect(page.locator('.cli-list .cli-card, .cli-list > *')).toHaveCount(0);
    await semVazar(page, page.locator('main'));
    expect(erros).toEqual([]);
  });
});
