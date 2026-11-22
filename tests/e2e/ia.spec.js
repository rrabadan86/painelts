const { test, expect } = require('@playwright/test');

test('IA: Pergunte ao painel abre, consulta as vendas e responde (simulada na apresentação)', async ({ page }, info) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  const b = page.locator(info.project.name === 'celular' ? '#fabIA' : '#btnIA');
  await expect(b).toBeVisible();
  if (info.project.name === 'celular') await expect(page.locator('#btnIA')).toBeHidden();
  await b.click();
  const g = page.locator('.ia-gaveta');
  await expect(g).toBeVisible();
  // com análise do dia ainda não lida o ✨ abre nela: vai para Perguntar
  await g.locator('.ia-abas .seg button', { hasText: 'Perguntar' }).click();
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
  await expect(page.locator('.ped-heroi .heroi-rot', { hasText: 'Seu pedido (com alterações)' })).toBeVisible();
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

test('IA: análise do dia — manchete no topo do Início, completa no ✨ (aba), pontinho some depois de ler; ✨ não quebra o topo no celular', async ({ page }, info) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { try { localStorage.removeItem('teashop.ia.lida'); } catch { /* ok */ } location.hash = '#inicio'; });
  const faixa = page.locator('.ini-faixa-btn');
  await expect(faixa).toBeVisible({ timeout: 30000 });
  await expect(faixa).toContainText('últimos 7 dias');
  await expect(faixa).toContainText('ler ›');
  // redesenho de 22/11/2026: uma linha discreta logo abaixo do herói ("como estou indo") e antes das ações e dos avisos
  const yH = (await page.locator('.ini-heroi').boundingBox()), yF = (await faixa.boundingBox()).y, yC = (await page.locator('.ini-corpo').boundingBox()).y;
  expect(yF).toBeGreaterThan(yH.y + yH.height - 1);
  expect(yF).toBeLessThan(yC);
  const bt = page.locator(info.project.name === 'celular' ? '#fabIA' : '#btnIA');
  await expect(bt).toHaveClass(/ia-novidade/);
  await faixa.click();
  const g = page.locator('.ia-gaveta');
  await expect(g.locator('.ia-abas .seg button.on')).toHaveText('Análise do dia');
  await expect(g.locator('.ia-an-m')).toContainText('últimos 7 dias');
  await expect(g).toContainText('movimento (atendimentos)');
  await expect(g.locator('.ia-an')).not.toContainText('null');
  await expect(g.locator('.ia-rodape')).toBeHidden(); // na análise não tem caixa de pergunta
  await expect(bt).not.toHaveClass(/ia-novidade/);
  // "Perguntar mais sobre isso" vai para a aba Perguntar já com a pergunta
  await g.locator('.ia-an-perg').first().click();
  await expect(g.locator('.ia-abas .seg button.on')).toHaveText('Perguntar');
  await expect(g.locator('.ia-eu').first()).toContainText('Sobre a análise do dia');
  await page.keyboard.press('Escape');
  // aberta de novo depois de lida: começa em Perguntar
  await bt.click();
  await expect(page.locator('.ia-gaveta .ia-abas .seg button.on')).toHaveText('Perguntar');
  await page.keyboard.press('Escape');
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
  await g.locator('.ia-abas .seg button', { hasText: 'Perguntar' }).click();
  await g.locator('textarea').fill('Teste de limite');
  await g.locator('textarea').press('Enter');
  await expect(g.locator('.ia-erro')).toContainText('limite de tamanho');
  await g.getByRole('button', { name: '↻ Tentar de novo' }).click();
  await expect(g.locator('.ia-eu')).toHaveCount(1);
  await expect(g.locator('.ia-ela .ia-md')).toContainText('simulada');
});

test('IA: margem de produto ao longo do tempo vem das notas de entrada (não das vendas) e lista o que não teve compra', async ({ page }, info) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.iaAbrir);
  await page.evaluate(() => TS.iaAbrir('Quais produtos tiveram a margem bruta maior nas últimas compras?'));
  const g = page.locator('.ia-gaveta');
  await expect(g.locator('.ia-ela')).toContainText('consultando as notas de entrada', { timeout: 20000 });
  await expect(g.locator('.ia-ela')).not.toContainText('consultando as vendas');
  await expect(g.locator('.ia-ela .ia-md')).toContainText('Pelas notas de entrada');
  await expect(g.locator('.ia-ela .ia-md')).toContainText(/\d+ itens tiveram compra e \d+ não tiveram/);
  await expect(g.locator('.ia-ela .ia-md li').first()).toContainText('R$');
  void info;
});

test('IA: conexão que cai no meio da pergunta tenta de novo sozinha; se continuar caída, mostra aviso em português', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.iaAbrir);
  let falhas = 1;
  await page.route('**/api/demo/ia/perguntar*', (route) => (falhas-- > 0 ? route.abort('internetdisconnected') : route.continue()));
  await page.evaluate(() => TS.iaAbrir('Quanto vendemos?'));
  const g = page.locator('.ia-gaveta');
  await expect(g.locator('.ia-ela .ia-md')).toContainText('simulada', { timeout: 20000 });
  await g.getByRole('button', { name: 'Nova conversa' }).click();
  falhas = 99;
  await g.locator('textarea').fill('Quanto vendemos ontem?');
  await g.locator('textarea').press('Enter');
  await expect(g.locator('.ia-erro')).toContainText('A conexão com o painel caiu', { timeout: 20000 });
  await expect(g.locator('.ia-erro')).not.toContainText(/fetch/i);
  await expect(g.getByRole('button', { name: /Tentar de novo/ })).toBeVisible();
});
