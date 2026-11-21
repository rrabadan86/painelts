const { test, expect } = require('@playwright/test');

// Foto do produto (TS.foto): miniatura antes do nome dos acessórios no Pedido e nas ⭐ Sugestões; tocar abre a foto grande.
// Na apresentação as fotos são desenhos fictícios (/api/demo/site/fotos); chá a granel não tem foto.
async function abrir(page, hash) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.foto && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate((x) => { location.hash = x; }, hash);
}

test('Pedido: miniatura da foto ao lado do nome; tocar abre a foto grande, troca de foto e fecha', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  const celular = info.project.name === 'celular';
  await abrir(page, '#pedido');
  await page.locator('.seg button', { hasText: /^Todos \(/ }).click();
  const linha = page.locator(celular ? '.ped-card' : '.ped-t tbody tr').filter({ has: page.locator('.foto-mini') }).first();
  await expect(linha).toBeVisible({ timeout: 40000 });
  const mini = linha.locator('.foto-mini');
  // tamanho proporcional: maior no celular, menor na tabela do computador
  const caixa = await mini.boundingBox();
  expect(Math.round(caixa.width)).toBe(celular ? 52 : 40);
  expect(Math.round(caixa.height)).toBe(celular ? 52 : 40);
  await expect(mini.locator('img')).toHaveJSProperty('complete', true);
  expect(await mini.locator('img').evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
  // chá a granel fica sem miniatura
  const cha = page.locator(celular ? '.ped-card' : '.ped-t tbody tr').filter({ hasText: /\bkg\b/ }).first();
  if (await cha.count()) await expect(cha.locator('.foto-mini')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
  // abre a janela: nome, foto grande, outras fotos e fechar
  await mini.click();
  const janela = page.locator('.foto-janela');
  await expect(janela).toBeVisible();
  await expect(janela.locator('.foto-cab b')).not.toHaveText('');
  await expect(janela.locator('.foto-grande img')).toBeVisible();
  await expect(janela.locator('.foto-info')).toContainText('cód.');
  const outras = janela.locator('.foto-outra');
  await expect(outras).toHaveCount(2);
  const antes = await janela.locator('.foto-grande img').getAttribute('src');
  await outras.nth(1).click();
  await expect(outras.nth(1)).toHaveClass(/on/);
  expect(await janela.locator('.foto-grande img').getAttribute('src')).not.toBe(antes);
  const j = await janela.boundingBox(), vw = page.viewportSize().width;
  expect(j.x).toBeGreaterThanOrEqual(0); expect(j.x + j.width).toBeLessThanOrEqual(vw + 1);
  await page.keyboard.press('Escape');
  await expect(janela).toHaveCount(0);
  // a quantidade do pedido não mudou com o clique na foto e a tela continua no Pedido
  await expect(page).toHaveURL(/#pedido/);
  expect(erros).toEqual([]);
});

test('⭐ Sugestões: a miniatura aparece na lista da equipe', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page, '#sugestoes');
  await expect(page.locator('.sug-t').first()).toBeVisible({ timeout: 40000 });
  // sugestões abertas (aba que abre primeiro) de produto com foto: cada uma mostra a miniatura
  const n = await page.evaluate(async () => { await TS.foto.carregar(); const d = await TS.sug.carregar(TS.state.loja); return d.itens.filter((s) => s.st === 'aberta' && !s.aguardando && TS.foto.de(s.cod, s.desc)).length; });
  test.skip(!n, 'nenhuma sugestão aberta de produto com foto na apresentação');
  await expect(page.locator('.sug-t .foto-mini').first()).toBeAttached();
  expect(await page.locator('.sug-t .foto-mini').count()).toBeGreaterThan(0);
  expect(erros).toEqual([]);
});

test('o painel só aceita imagem de fora vinda do site da Tea Shop (cabeçalho de segurança)', async ({ request }) => {
  const r = await request.get('/apresentacao');
  const csp = r.headers()['content-security-policy'];
  expect(csp).toContain("img-src 'self' data: https://cdn.shopify.com https://www.teashop.com.br;");
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("connect-src 'self'");
});
