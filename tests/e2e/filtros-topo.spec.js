// Filtros em faixa no topo (computador): período na faixa, o resto em "Mais filtros", com etiqueta e contador do que está valendo.
// No celular os filtros continuam na gaveta aberta pelo botão de filtros.
const { test, expect } = require('@playwright/test');

const abrir = async (page) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
};
const ir = async (page, tela) => {
  await page.evaluate((t) => { location.hash = '#' + t; }, tela);
  await page.waitForFunction((t) => TS.state.page === t && !document.querySelector('main .loading .spinner'), tela);
};
const caixa = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height }; }, sel);

test('computador: a faixa de filtros fica no topo e o conteúdo usa a largura toda', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'só no computador');
  await abrir(page);
  for (const largura of [1366, 1100]) {
    await page.setViewportSize({ width: largura, height: 900 });
    await ir(page, 'estoque'); // redesenha a tela já na largura nova (os gráficos acompanham)
    await ir(page, 'resumo');
    const faixa = await caixa(page, '#sidebar'), conteudo = await caixa(page, '#content');
    expect(faixa.bottom).toBeLessThanOrEqual(conteudo.top + 1); // em cima, não ao lado
    expect(faixa.height).toBeLessThan(140);
    expect(conteudo.left).toBe(0);
    expect(conteudo.width).toBeGreaterThan(largura - 20);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: 'a página não rola para o lado em ' + largura + ' px' }).toBeLessThanOrEqual(0);
  }
  const faixa = page.locator('#sidebar');
  await expect(faixa.locator('.chip', { hasText: '30 dias' })).toBeVisible();
  await expect(faixa.locator('input[type=date]')).toHaveCount(2);
  await expect(page.locator('#btnMaisFiltros')).toBeVisible();
  await expect(page.locator('#btnMaisFiltros')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#maisFiltros')).toBeHidden();
  await expect(page.locator('#btnFiltros')).toBeHidden(); // o botão da gaveta é só do celular
});

test('computador: "Mais filtros" abre, filtra, mostra a etiqueta e o contador, e "Limpar" volta', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'só no computador');
  await abrir(page);
  await ir(page, 'resumo');
  const bt = page.locator('#btnMaisFiltros'), pop = page.locator('#maisFiltros');
  await bt.click();
  await expect(pop).toBeVisible();
  await expect(pop).toHaveAttribute('role', 'dialog');
  await expect(bt).toHaveAttribute('aria-expanded', 'true');
  for (const rotulo of ['Ano e mês', 'Vendedor', 'Grupo', 'Categoria', 'Produto contém']) await expect(pop.locator('.f-label', { hasText: rotulo })).toBeVisible();
  // escolhe um vendedor: o painel continua aberto, a etiqueta e o contador aparecem na faixa
  const vend = pop.locator('.f-group', { has: page.locator('.f-label', { hasText: 'Vendedor' }) });
  await vend.locator('.ms-btn').click();
  await vend.locator('.ms-actions button', { hasText: 'Limpar' }).click(); // desmarca todos para escolher um só
  const nome = (await vend.locator('.ms-item').first().innerText()).trim();
  await vend.locator('.ms-item').first().click();
  await page.waitForFunction(() => TS.state.f.vendedores.size === 1);
  await expect(page.locator('#maisFiltros')).toBeVisible();
  await expect(page.locator('.fx-tag')).toHaveText(new RegExp('Vendedor: ' + nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  await expect(page.locator('#btnMaisFiltros .fx-n')).toHaveText('1');
  // digitar no painel não perde o campo quando a tela é redesenhada
  await page.locator('#maisFiltros input[placeholder="Ex.: earl grey"]').pressSequentially('cha', { delay: 200 });
  await page.waitForFunction(() => TS.state.f.produto === 'cha');
  await expect(page.locator('#maisFiltros input[placeholder="Ex.: earl grey"]')).toBeFocused();
  await expect(page.locator('#btnMaisFiltros .fx-n')).toHaveText('2');
  await expect(page.locator('.fx-tag', { hasText: 'Produto: cha' })).toBeVisible();
  // Esc fecha e devolve o foco ao botão
  await page.keyboard.press('Escape');
  await expect(page.locator('#maisFiltros')).toBeHidden();
  await expect(page.locator('#btnMaisFiltros')).toBeFocused();
  // o ✕ da etiqueta tira só aquele filtro
  await page.locator('.fx-tag', { hasText: 'Produto: cha' }).getByRole('button').click();
  await page.waitForFunction(() => TS.state.f.produto === '' && TS.state.f.vendedores.size === 1);
  await expect(page.locator('#btnMaisFiltros .fx-n')).toHaveText('1');
  // clique fora fecha
  await page.locator('#btnMaisFiltros').click();
  await expect(page.locator('#maisFiltros')).toBeVisible();
  await page.locator('h1.page-title').click();
  await expect(page.locator('#maisFiltros')).toBeHidden();
  // Limpar volta ao começo
  await page.locator('#btnLimpar').click();
  await page.waitForFunction(() => TS.state.f.vendedores.size === 0);
  await expect(page.locator('.fx-tag')).toHaveCount(0);
  await expect(page.locator('#btnMaisFiltros .fx-n')).toHaveCount(0);
});

test('computador: tela de um filtro só não tem coluna nem "Mais filtros"; tela sem filtro não tem faixa', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'só no computador');
  await abrir(page);
  for (const tela of ['estoque', 'pedido']) {
    await ir(page, tela);
    const faixa = await caixa(page, '#sidebar'), conteudo = await caixa(page, '#content');
    expect(faixa.height).toBeGreaterThan(0);
    expect(faixa.height).toBeLessThan(70);
    expect(conteudo.left).toBe(0);
    await expect(page.locator('#sidebar input[placeholder="Ex.: earl grey"]')).toBeVisible();
    await expect(page.locator('#btnMaisFiltros')).toHaveCount(0);
    await expect(page.locator('#sidebar .f-uso')).toHaveCount(0); // o aviso de contexto virou o ⓘ ao lado do rótulo
    await expect(page.locator('#sidebar .f-label .dica-i')).toHaveCount(1);
  }
  for (const tela of ['inventario', 'campanhas', 'inicio']) {
    await ir(page, tela);
    await expect(page.locator('#sidebar')).toBeHidden();
    expect((await caixa(page, '#content')).width).toBeGreaterThan(1340);
  }
});

test('celular: os filtros continuam na gaveta, sem faixa nem "Mais filtros"', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'só no celular');
  await abrir(page);
  await ir(page, 'resumo');
  await expect(page.locator('#btnMaisFiltros')).toHaveCount(0);
  await expect(page.locator('.fx-tags')).toHaveCount(0);
  expect((await caixa(page, '#sidebar')).left).toBeLessThan(0); // gaveta fechada, fora da tela
  await page.locator('#btnFiltros').click();
  await expect(page.locator('#sidebar .f-label', { hasText: 'Vendedor' })).toBeVisible();
  await expect(page.locator('#sidebar .f-label', { hasText: 'Produto contém' })).toBeVisible();
  await expect(page.locator('#sidebar .chip', { hasText: '30 dias' })).toBeVisible();
  await page.locator('#btnFecharFiltros').click();
  await expect(page.locator('body')).not.toHaveClass(/filters-open/);
});
