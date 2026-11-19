const { test, expect } = require('@playwright/test');

test('IA: Pergunte ao painel abre, consulta as vendas e responde (simulada na apresentação)', async ({ page }, info) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  const b = page.locator(info.project.name === 'celular' ? '#fabIA' : '#btnIA');
  await expect(b).toBeVisible();
  if (info.project.name === 'celular') await expect(page.locator('#btnIA')).toBeHidden();
  await b.click();
  const g = page.locator('.ia-gaveta');
  await expect(g).toBeVisible();
  await g.locator('.ia-sug').first().click();
  await expect(g.locator('.ia-ela')).toContainText('consultando as vendas');
  await expect(g.locator('.ia-ela .ia-md')).toContainText('simulada');
  await expect(g.locator('.ia-ela .ia-md li').first()).toContainText('R$');
  // gráfico no lugar marcado ({{grafico}}) e subitem dentro do item, não numerado à parte
  await expect(g.locator('.ia-ela .ia-md .ia-graf canvas')).toHaveCount(1);
  await expect(g.locator('.ia-ela .ia-md')).not.toContainText('{{');
  await expect(g.locator('.ia-ela .ia-md li ul li')).toContainText('exemplo de subitem');
  const altura = await g.locator('.ia-graf canvas').evaluate((c) => c.getBoundingClientRect().height);
  expect(altura).toBeGreaterThan(100);
  // pergunta digitada (Enter envia) e conversa continua
  await g.locator('textarea').fill('E nos últimos 90 dias?');
  await g.locator('textarea').press('Enter');
  await expect(g.locator('.ia-eu')).toHaveCount(2);
  await expect(g.locator('.ia-ela .ia-md')).toHaveCount(2, { timeout: 20000 });
  // histórico: a conversa fica gravada e reabre
  await g.getByRole('button', { name: 'Nova conversa' }).click();
  await expect(g.locator('.ia-sug').first()).toBeVisible();
  await g.getByRole('button', { name: 'Histórico' }).click();
  await expect(g.locator('.ia-hist-i')).toHaveCount(1);
  await g.locator('.ia-hist-abrir').first().click();
  await expect(g.locator('.ia-eu')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(g).toHaveCount(0);
});

test('IA: revisão do pedido sugere ajuste e aplica na quantidade', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#pedido'; });
  const card = page.locator('.ped-ia');
  await expect(card).toBeVisible({ timeout: 30000 });
  await card.getByRole('button', { name: 'Revisar este pedido' }).click();
  await expect(card.locator('.ped-ia-t')).toBeVisible();
  await expect(card).toContainText('simulada');
  await card.getByRole('button', { name: 'Aplicar' }).first().click();
  await expect(page.locator('.ped-ia')).toContainText('aplicado ✓');
  await expect(page.locator('.kpi-label', { hasText: 'Seu pedido (com alterações)' })).toBeVisible();
});

test('IA: chave fica em Configurações → Lojas → (loja) → Inteligência artificial', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => TS.cfgIrIA('demo-centro'));
  const b = page.locator('.ia-cfg');
  await expect(b).toBeVisible();
  await expect(page.locator('.cfg-abas')).not.toContainText('Inteligência artificial');
  await expect(b.locator('.ia-passo summary')).toContainText('Como criar a chave');
  await expect(b.locator('input[type=password]')).toHaveAttribute('autocomplete', 'off');
  await b.locator('input[type=password]').fill('sk-ant-api03-' + 'y'.repeat(40));
  await b.getByRole('button', { name: 'Testar e salvar' }).click();
  await expect(b).toContainText('Na apresentação nada é salvo');
});

test('IA: Início explica o porquê (decomposição + fora do padrão) e o ✨ não quebra o topo no celular', async ({ page }, info) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#inicio'; });
  const c = page.locator('.ini-porque');
  await expect(c).toBeVisible({ timeout: 30000 });
  await expect(c.locator('.ini-porque-m')).toContainText('últimos 7 dias');
  await expect(c).toContainText('movimento (atendimentos)');
  await expect(c).not.toContainText('null');
  if (info.project.name === 'celular') {
    const alt = await page.locator('.topbar').evaluate((el) => el.getBoundingClientRect().height);
    const sel = await page.locator('#lojaSel').boundingBox(), user = await page.locator('#btnUsuario').boundingBox();
    expect(Math.abs(sel.y - user.y)).toBeLessThan(20); // loja e conta na mesma linha
    expect(alt).toBeLessThan(200);
  }
});

test('IA: resposta que estoura o limite mostra aviso e "Tentar de novo" (sem quebrar a conversa)', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  let n = 0;
  await page.route('**/api/demo/ia/perguntar', (route) => {
    n++;
    if (n === 1) return route.fulfill({ json: { content: [{ type: 'thinking', thinking: '…', signature: 'x' }], stop_reason: 'max_tokens' } });
    return route.continue();
  });
  await page.locator('#btnIA').click();
  const g = page.locator('.ia-gaveta');
  await g.locator('textarea').fill('Teste de limite');
  await g.locator('textarea').press('Enter');
  await expect(g.locator('.ia-erro')).toContainText('limite de tamanho');
  await g.getByRole('button', { name: '↻ Tentar de novo' }).click();
  await expect(g.locator('.ia-eu')).toHaveCount(1);
  await expect(g.locator('.ia-ela .ia-md')).toContainText('simulada');
});
