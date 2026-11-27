const { test, expect } = require('./_base');
const { escolherOpcao, nomesOpcoes, opcaoAtiva } = require('./_base');

const abrir = async (page, tela, antes) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(([t, a]) => { if (a) TS.state.precoFil = a; location.hash = '#' + t; }, [tela, antes || '']);
};
const semRolagem = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
const semLixo = async (loc) => expect(await loc.innerText()).not.toMatch(/(^|[\s>(\d])(null|undefined|NaN|\[object Object\])(?=$|[\s<).,])/m);

// Compras × teto no Pedido: o teto olha para a frente (vendas previstas dos próximos dias); mudar o pedido refaz a conta
test('Pedido: compras × teto pela previsão dos próximos dias, com o pedido somado e a conta explicada', async ({ page }) => {
  await abrir(page, 'pedido');
  const q = page.locator('.cv-pedido');
  await expect(q.locator('.kpi')).toHaveCount(5);
  await expect(q).toContainText(/Vendas previstas[\s\S]*próximos \d+ dias/);
  await expect(q).toContainText(/Comprado nos últimos \d+ dias/);
  await expect(q).toContainText('Este pedido');
  await expect(q).toContainText('Teto de compras');
  await expect(q).toContainText('32,0% das vendas previstas');
  await semLixo(q);
  // todo quadro tem a explicação (ⓘ)
  expect(await q.locator('.kpi .dica-i').count()).toBe(5);
  // a conta fecha: teto = % × previsão; teto − comprado − pedido = cabe; a janela é entrega + período do pedido
  const r = await page.evaluate(async () => { const e = await TS.estoqueBuscar(TS.state.loja), M = await TS.custosLoja(); const J = TS.comprasVendas.montarJanela(M, e, 1000, { janela: 40 });
    return { teto: Math.abs(J.teto - J.previsao * 0.32) < 0.01, cabe: Math.abs(J.teto - J.compras - 1000 - J.cabe) < 0.01, janela: J.janela, fator: J.fator, prev: J.previsao }; });
  expect(r.teto).toBe(true); expect(r.cabe).toBe(true); expect(r.janela).toBe(40); expect(r.prev).toBeGreaterThan(0);
  expect(r.fator).toBeGreaterThanOrEqual(0.4); expect(r.fator).toBeLessThanOrEqual(3);
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
  // revisão de 22/11: o número fica numa linha do cartão-herói ("Reajustes de venda avaliados"), que abre a aba
  const k = page.locator('.heroi .linhas-num-a', { hasText: 'Reajustes de venda avaliados' });
  await expect(k).toBeVisible();
  await k.click();
  await expect.poll(() => opcaoAtiva(page)).toMatch(/Reajustes \(\d+\)/); // abas: no celular, o botão da folha (FOLHA-01)
  await expect(page.locator('.card-title', { hasText: 'Efeito dos reajustes de venda' })).toBeVisible();
  await expect.poll(() => opcaoAtiva(page, '.efp-fil')).toMatch(/(Avaliados|Todos) \(\d+\)/);
  const EFP = '.efp-t, .efp-t-lmob'; // tabela no computador, linhas no celular (LMOB-04)
  const nome = page.locator('.efp-t a.prc-nome, .efp-t-lmob a.prc-nome').first();
  await expect(nome).toBeVisible();
  await semLixo(page.locator(EFP).first());
  // os avaliados têm etiqueta Bom, Ruim ou Igual, nunca "cedo demais" (sem nenhum avaliado, a aba começa em "Todos")
  if (/Avaliados/.test(await opcaoAtiva(page, '.efp-fil'))) await expect(page.locator(EFP).first().locator('.badge.warn')).toHaveCount(0);
  // amostra mínima: quem vendeu menos de 30 unidades fica em "Poucos dados", sem veredito (nunca Bom/Ruim)
  if ((await nomesOpcoes(page, '.efp-fil')).some((t) => t.startsWith('Poucos dados'))) {
    await escolherOpcao(page, '.efp-fil', 'Poucos dados');
    await expect(page.locator(EFP).first().locator('.badge.cinza').first()).toHaveText('Poucos dados');
    await expect(page.locator(EFP).first().locator('.badge.ok, .badge.erro')).toHaveCount(0);
    await expect(page.locator(EFP).first()).toContainText('pouco para dizer se foi o preço');
  }
  await page.locator('.efp-t a.prc-nome, .efp-t-lmob a.prc-nome').first().evaluate((a) => a.click());
  const det = page.locator('.prc-drawer .efp-detalhe');
  await expect(det).toBeVisible();
  await expect(det).toContainText('Efeito dos reajustes de venda');
  await expect(det).toContainText(/comparou \d+ dias? antes × \d+ depois/);
  await semLixo(det);
  await page.keyboard.press('Escape');
  // voltar para a lista de produtos continua funcionando
  await escolherOpcao(page, null, 'Todos os itens');
  await expect(page.locator('.card-title', { hasText: 'Produtos' })).toBeVisible();
  await semRolagem(page);
});

// PRC-EFEITO-01 (decisão do dono, 27/11/2026): o "efeito em R$" do antigo quadro "Custos que mudaram" foi para Preços → Custo alterado
test('PRC-EFEITO-01: Preços → Custo alterado mostra o efeito em R$ de cada mudança de custo no período', async ({ page }) => {
  await abrir(page, 'precos', 'custo');
  await page.evaluate(() => TS.aplicarPreset && TS.aplicarPreset('ano'));
  const card = page.locator('main .card', { has: page.locator('.card-title', { hasText: 'Produtos' }) }).first();
  await expect(card).toBeVisible({ timeout: 20000 });
  if (await card.locator('.t-vazio, .lmob-vazio').count()) test.skip(true, 'a apresentação não tem custo alterado neste período');
  await expect(card).toContainText('Efeito');
  await semLixo(card);
  await semRolagem(page);
});
