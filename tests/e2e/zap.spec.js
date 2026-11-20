// Robô do WhatsApp das campanhas na apresentação: o cartão em Configurações → loja → Mensagens e a faixa em Campanhas
// aparecem, respondem aos botões com respostas simuladas e NADA sai para as rotas de verdade (nada é conectado nem enviado).
const { test, expect } = require('@playwright/test');

test.describe('robô do WhatsApp', () => {
  let erros, pedidos;
  test.beforeEach(async ({ page }) => {
    erros = []; pedidos = [];
    page.on('pageerror', (e) => erros.push(e.message));
    page.on('request', (r) => { const u = new URL(r.url()); if (/\/zap\//.test(u.pathname)) pedidos.push(`${r.method()} ${u.pathname}`); });
    await page.goto('/apresentacao');
    await page.waitForFunction(() => window.TS && TS.db);
  });
  const semVazar = async (page, alvo) => {
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw - cw, 'sem rolagem para o lado').toBeLessThanOrEqual(2);
    expect(await alvo.innerText()).not.toMatch(/(^|\s)(null|undefined|NaN)(\s|$)/m);
  };

  test('Configurações → loja → Mensagens: cartão com conexão, ligar/pausar, ritmo, horário, dias, máximo e falhas', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#config'; });
    await page.locator('table.cfg-lojas-t .cfg-abrir').first().click();
    await page.locator('.cfg-loja .cfg-sub a', { hasText: 'Mensagens' }).evaluate((a) => a.click());
    const card = page.locator('.zap-cfg');
    await expect(card.locator('h3')).toContainText('Robô do WhatsApp');
    await expect(card.locator('.zap-risco')).toContainText('O WhatsApp pode bloquear o número');
    await expect(card).toContainText('número final 8888');
    await expect(card).toContainText('Hoje: 12 de 30');
    // cada campo com a explicação (ⓘ) e os padrões do dono
    expect(await card.locator('.zap-campos .dica-i').count()).toBeGreaterThanOrEqual(5);
    const nums = card.locator('.zap-campos input[type=number]');
    await expect(nums.nth(0)).toHaveValue('900'); await expect(nums.nth(1)).toHaveValue('1200');
    await expect(card.locator('input[type=time]').nth(0)).toHaveValue('09:00'); await expect(card.locator('input[type=time]').nth(1)).toHaveValue('18:30');
    await expect(nums.nth(2)).toHaveValue('30'); await expect(nums.nth(3)).toHaveValue('3');
    await expect(card.locator('.zap-dias input:checked')).toHaveCount(6);
    // ritmo abaixo de 300 s: aviso ⚠ ao sair do campo (não a cada dígito)
    const aviso = card.locator('.zap-aviso');
    await expect(aviso).toBeHidden();
    await nums.nth(0).fill('120'); await nums.nth(1).focus();
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('risco de bloqueio');
    await semVazar(page, card);
    // valor fora do limite: o servidor recusa com a explicação
    await nums.nth(0).fill('30');
    await card.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(card.locator('.notice.err')).toContainText('de 60 a 7200 segundos');
    // pausar: resposta simulada
    await card.getByRole('button', { name: 'Pausar', exact: true }).click();
    await expect(card.locator('.badge', { hasText: 'Pausado' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Ligar de novo', exact: true })).toBeVisible();
    await semVazar(page, card);
    expect(pedidos.length).toBeGreaterThan(0);
    expect(pedidos.filter((p) => !p.includes('/api/demo/zap/')), 'só as rotas da apresentação').toEqual([]);
    expect(erros).toEqual([]);
  });

  test('Campanhas: faixa de situação do robô com Pausar; campanha ganha a opção "Enviar pelo robô"', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#campanhas'; });
    const faixa = page.locator('.zap-faixa');
    await expect(faixa).toBeVisible();
    await expect(faixa).toContainText('Robô do WhatsApp');
    await expect(faixa.locator('.badge', { hasText: 'Ligado' })).toBeVisible();
    await expect(faixa).toContainText('Hoje: 12 de 30');
    await expect(faixa).toContainText('próxima mensagem por volta de');
    await semVazar(page, faixa);
    // uma campanha de exemplo (fica só na memória do navegador)
    await page.getByRole('button', { name: 'Criar campanha' }).click();
    await page.locator('.cp-nome input').fill('Teste do robô');
    await expect.poll(async () => +(await page.locator('.cp-contagem b').innerText()).replace(/\D/g, '')).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Salvar campanha' }).click();
    const opcao = page.locator('.zap-opcao');
    await expect(opcao).toContainText('Enviar pelo robô');
    await expect(opcao.locator('input')).not.toBeChecked();
    page.once('dialog', (d) => { expect(d.message()).toContain('pode bloquear o número'); d.accept(); });
    await opcao.locator('input').check();
    await expect(page.locator('.zap-opcao input')).toBeChecked();
    await expect(page.locator('.zap-opcao')).toContainText('O robô envia os pendentes desta lista');
    await semVazar(page, page.locator('#content, main').first());
    await page.getByRole('button', { name: '‹ Voltar às campanhas' }).click();
    await expect(page.locator('.cp-card .cli-tag', { hasText: 'robô' })).toBeVisible();
    // pausar pela faixa
    await faixa.getByRole('button', { name: 'Pausar o robô' }).click();
    await expect(faixa.locator('.badge', { hasText: 'Pausado' })).toBeVisible();
    await expect(faixa).toContainText('Nada é enviado até alguém ligar de novo');
    expect(pedidos.filter((p) => !p.includes('/api/demo/zap/')), 'só as rotas da apresentação').toEqual([]);
    expect(erros).toEqual([]);
  });
});
