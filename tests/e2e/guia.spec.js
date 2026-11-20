const { test, expect } = require('@playwright/test');

// Configuração guiada da loja (apresentação): os 4 acessos em passos, atalho nas Configurações e lembrete no Início. Nada é gravado.
async function abrir(page, hash) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.guia && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate((x) => { location.hash = x; }, hash);
}
const semRolagem = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
const print = async (page, info, nome) => { if (process.env.PRINTS) await page.screenshot({ path: `${process.env.PRINTS}/guia-${nome}-${info.project.name}.png` }); };

test('Configuração guiada: não abre sozinha na apresentação; o atalho das Configurações abre no passo que falta e percorre até o fim', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  const gravou = [];
  // só o que iria para o painel de verdade: as rotas /api/demo/ são as respostas simuladas da apresentação (ex.: a análise do Início) e não gravam nada
  page.on('request', (r) => { if (r.method() !== 'GET' && /\/api\//.test(r.url()) && !/\/api\/demo\//.test(r.url())) gravou.push(r.url()); });
  await abrir(page, '#config');
  await expect(page.locator('.page-title')).toHaveText('Configurações');
  await expect(page.locator('.guia')).toHaveCount(0);
  const botao = page.locator('.cfg-guia-btn');
  await expect(botao).toBeVisible();
  await expect(botao).toHaveAttribute('title', /um passo de cada vez/);
  await botao.click();
  const g = page.locator('.guia');
  await expect(g.locator('.guia-trilha .guia-p')).toHaveCount(4);
  // a primeira loja da apresentação tem só o FIXE faltando: abre nele
  await expect(g.locator('.guia-p.at b')).toHaveText('3. FIXE');
  await expect(g.locator('.guia-p.ok')).toHaveCount(3);
  await expect(g.locator('.guia-mesmo')).toContainText('mesmo Gmail do próximo passo (4. E-mail)');
  // todo campo tem a explicação (ⓘ)
  const campos = await g.locator('.cfg-campo').count();
  expect(campos).toBeGreaterThanOrEqual(4);
  await expect(g.locator('.cfg-campo .dica-i')).toHaveCount(campos);
  // e-mail diferente do Gmail da loja: avisa na hora
  await g.locator('input[type=email]').fill('outro@gmail.com');
  await expect(g.locator('.guia-confere')).toContainText('Diferente do Gmail da loja');
  await semRolagem(page);
  await print(page, info, 'fixe');
  // pular vai para o e-mail; voltar e ir pela trilha funcionam
  await g.locator('.guia-pular').click();
  await expect(g.locator('.guia-p.at b')).toHaveText('4. E-mail');
  await expect(g.locator('.guia-p.pu b')).toHaveText('3. FIXE');
  await expect(g.locator('.guia-mesmo')).toContainText('mesmo e-mail do passo 3');
  await print(page, info, 'email');
  await g.locator('.guia-p').first().click();
  await expect(g.locator('h3')).toHaveText('Acesso ao AppNext');
  await expect(g.locator('input[type=password]')).toHaveValue(''); // a senha guardada nunca volta para a tela
  // salvar na apresentação: avisa que nada é gravado e segue
  await g.locator('.guia-pe .btn.primary').click();
  await expect(page.locator('.toast')).toContainText('nada é salvo');
  await expect(g.locator('h3')).toHaveText('Acesso ao Sistema de Pedidos');
  await g.locator('.guia-pular').click();
  await g.locator('.guia-pular').click();
  await g.locator('.guia-pular').click();
  // tela final: o que ficou pronto e o que falta, com o caminho para concluir
  await expect(g.locator('.guia-li')).toHaveCount(4);
  await expect(g.locator('.guia-li.pu')).toContainText('FIXE');
  await expect(g.locator('.guia-nota')).toContainText('Configurações → Integrações');
  await semRolagem(page);
  await print(page, info, 'fim');
  await g.locator('.guia-li.pu .btn').click();
  await expect(g.locator('.guia-p.at b')).toHaveText('3. FIXE');
  await g.locator('.guia-x').click();
  await expect(page.locator('.guia')).toHaveCount(0);
  expect(gravou, 'nada sai do navegador na apresentação').toEqual([]);
  expect(erros).toEqual([]);
});

test('Configuração guiada: o Início lembra o que falta e a aba Integrações tem o atalho da loja', async ({ page }) => {
  await abrir(page, '#inicio');
  const aviso = page.locator('.ini-aviso', { hasText: 'Falta configurar FIXE' });
  await expect(aviso).toBeVisible({ timeout: 30000 });
  await aviso.click();
  await expect(page.locator('.guia .guia-p.at b')).toHaveText('3. FIXE');
  await page.locator('.guia-x').click();
  await expect(page.locator('.guia')).toHaveCount(0);
  // fechar a janela desfaz a entrada que ela pôs no histórico (o "voltar" do celular): espera assentar antes de trocar de tela
  await page.waitForFunction(() => !(history.state && history.state.camada));
  await page.evaluate(() => { location.hash = '#config'; });
  await expect(page.locator('.page-title')).toHaveText('Configurações');
  const loja = page.locator('.cfg-lojas-t tbody tr').first();
  if (await loja.count()) await loja.click();
  await page.locator('nav.cfg-sub a', { hasText: 'Integrações' }).click();
  const bloco = page.locator('.guia-cfg');
  await expect(bloco).toContainText('Falta configurar: FIXE');
  await bloco.locator('.btn').click();
  await expect(page.locator('.guia .guia-p.at b')).toHaveText('3. FIXE');
  await semRolagem(page);
});
