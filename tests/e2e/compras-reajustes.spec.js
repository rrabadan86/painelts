const { test, expect } = require('@playwright/test');

const abrir = async (page, tela, antes) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(([t, a]) => { if (a) TS.state.precoFil = a; location.hash = '#' + t; }, [tela, antes || '']);
};
const semRolagem = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
const semLixo = async (loc) => expect(await loc.innerText()).not.toMatch(/(^|[\s>(\d])(null|undefined|NaN|\[object Object\])(?=$|[\s<).,])/m);

// Compras × vendas no Pedido: quadros do mês com o pedido da tela somado; mudar o pedido refaz a conta
test('Pedido: compras do mês × teto, com o pedido somado', async ({ page }) => {
  await abrir(page, 'pedido');
  const q = page.locator('.cv-pedido');
  await expect(q.locator('.kpi')).toHaveCount(4);
  await expect(q).toContainText('Comprado em');
  await expect(q).toContainText('Este pedido');
  await expect(q).toContainText('Teto de compras do mês');
  await expect(q).toContainText(/32,0% de R\$/);
  await semLixo(q);
  // a conta fecha: teto − comprado − pedido = cabe (ou passou)
  const r = await page.evaluate(async () => { const e = await TS.estoqueBuscar(TS.state.loja), M = await TS.custosLoja(); const m = TS.comprasVendas.montar(M, e, 1000).mes; return { ok: Math.abs(m.teto - m.compras - 1000 - m.cabe) < 0.01, soma: m.soma, compras: m.compras }; });
  expect(r.ok).toBe(true); expect(r.soma).toBeCloseTo(r.compras + 1000, 2);
  await semRolagem(page);
});

// Resultado: quadros, abas com contagem e a tabela mês a mês; o quadro "Meses acima do teto" filtra
test('Resultado: compras × vendas mês a mês', async ({ page }) => {
  await abrir(page, 'dre');
  const c = page.locator('.cv-resultado');
  await expect(c.locator('.kpi').first()).toBeVisible();
  await expect(c).toContainText('Compras × vendas mês a mês');
  await expect(c.locator('.seg button').first()).toHaveText(/Todos os meses \(\d+\)/);
  const n = await c.locator('.badge').count();
  expect(n).toBeGreaterThan(5);
  await c.locator('.kpi', { hasText: 'Meses acima do teto' }).click();
  await expect(c.locator('.seg button.on')).toHaveText(/Acima do teto/);
  await expect(c.locator('.badge.ok')).toHaveCount(0);
  await semLixo(c);
  await semRolagem(page);
});

// Preços: aba "Reajustes (N)" com o efeito de cada reajuste e o detalhe no painel lateral do produto
test('Preços: efeito dos reajustes de venda', async ({ page }) => {
  await abrir(page, 'precos');
  const k = page.locator('.kpi', { hasText: 'Reajustes de venda avaliados' });
  await expect(k).toBeVisible();
  await k.click();
  await expect(page.locator('.seg button.on').first()).toHaveText(/Reajustes \(\d+\)/);
  await expect(page.locator('.card-title', { hasText: 'Efeito dos reajustes de venda' })).toBeVisible();
  await expect(page.locator('.efp-fil .seg button.on')).toHaveText(/(Avaliados|Todos) \(\d+\)/);
  const nome = page.locator('.efp-t a.prc-nome').first();
  await expect(nome).toBeVisible();
  await semLixo(page.locator('.efp-t'));
  // os avaliados têm etiqueta Bom, Ruim ou Igual, nunca "cedo demais"
  await expect(page.locator('.efp-t .badge.warn')).toHaveCount(0);
  await nome.evaluate((a) => a.click());
  const det = page.locator('.prc-drawer .efp-detalhe');
  await expect(det).toBeVisible();
  await expect(det).toContainText('Efeito dos reajustes de venda');
  await expect(det).toContainText(/comparou \d+ dias? antes × \d+ depois/);
  await semLixo(det);
  await page.keyboard.press('Escape');
  // voltar para a lista de produtos continua funcionando
  await page.locator('.seg button', { hasText: 'Todos os itens' }).first().click();
  await expect(page.locator('.card-title', { hasText: 'Produtos' })).toBeVisible();
  await semRolagem(page);
});
