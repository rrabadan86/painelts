// Trava "em conversa" do robô do WhatsApp (decisão do dono, 23/11/2026), na apresentação: o campo no cartão do robô,
// a linha "N adiados porque estão conversando com a loja" na faixa de Campanhas e o chip da mensagem adiada na conversa.
// Nada é enviado nem gravado (rotas /api/demo/...).
const { test, expect } = require('./_base');

const semVazar = async (page, alvo) => {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw - cw, 'sem rolagem para o lado').toBeLessThanOrEqual(2);
  expect(await alvo.innerText()).not.toMatch(/(^|\s)(null|undefined|NaN)(\s|$)/m);
};

test('ZAP-CONVERSA-08: cartão do robô tem "Em conversa com a loja" (padrão 3, com ⓘ) e a faixa de Campanhas conta os adiados', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db);
  // Configurações → loja → Mensagens → cartão do robô
  await page.evaluate(() => { location.hash = '#config'; });
  await page.locator('table.cfg-lojas-t .cfg-abrir').first().click();
  await page.locator('.cfg-loja .cfg-sub a', { hasText: 'Mensagens' }).evaluate((a) => a.click());
  const card = page.locator('.zap-cfg');
  const linha = card.locator('.zap-linha', { hasText: 'Em conversa com a loja' });
  await expect(linha).toBeVisible();
  await expect(linha.locator('.dica-i')).toHaveCount(1);
  const campo = linha.locator('input.zap-espera');
  await expect(campo).toHaveValue('3');
  await expect(campo).toHaveAttribute('min', '0');
  await expect(campo).toHaveAttribute('max', '30');
  // fora do limite: o servidor recusa com a explicação
  await campo.fill('31');
  await card.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(card.locator('.notice.err')).toContainText('de 0 a 30 dias');
  await card.locator('input.zap-espera').fill('5');
  await card.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(card.locator('input.zap-espera')).toHaveValue('5');
  await semVazar(page, card);
  // Clientes → Campanhas: linha discreta na faixa do robô
  await page.evaluate(() => { location.hash = '#campanhas'; });
  const faixa = page.locator('.zap-faixa');
  const adiados = faixa.locator('.zap-emconversa');
  await expect(adiados).toContainText('2 adiados porque estão conversando com a loja');
  await expect(adiados.locator('.dica-i')).toHaveCount(1);
  await semVazar(page, faixa);
  expect(erros).toEqual([]);
});

test('ZAP-CONVERSA-09: na conversa, o chip "🤖 mensagem do robô adiada" com a campanha e a data em que sai', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.cli && TS.cli.lista);
  await page.evaluate(() => { location.hash = '#conversas'; });
  const lista = page.locator('.cv-col-lista');
  await expect(lista).toContainText('Contato sem cadastro');
  // qual conversa de exemplo tem a mensagem adiada (a apresentação devolve em algumas, pela mesma conta da lista)
  const nome = await page.evaluate(async () => {
    for (const c of TS.cli.lista.filter((x) => TS.foneConversa(x).length >= 12).slice(0, 6)) {
      const j = await (await fetch('/api/demo/conversas/mensagens?chave=' + TS.foneConversa(c))).json();
      if (j.adiada) return c.nome;
    }
    return null;
  });
  expect(nome, 'alguma conversa de exemplo tem a mensagem adiada').toBeTruthy();
  await lista.locator('.cv-item', { hasText: nome }).first().click();
  const conv = page.locator('.cv-conversa');
  await expect(conv.locator('.cv-nome')).toHaveText(nome);
  const chip = conv.locator('.cv-adiada');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(/🤖 mensagem do robô adiada \(Pontos vencendo\) · sai a partir de \d\d\/\d\d se a conversa parar/);
  expect(await chip.getAttribute('title')).toContain('continua na fila');
  // conversa sem adiada não mostra o chip
  if (test.info().project.name === 'celular') await page.getByRole('button', { name: '‹ Voltar' }).click();
  await lista.locator('.cv-item', { hasText: 'Contato sem cadastro' }).first().click();
  await expect(conv.locator('.cv-nome')).toHaveText('Contato sem cadastro');
  await expect(conv.locator('.cv-adiada')).toHaveCount(0);
  await semVazar(page, conv);
  expect(erros).toEqual([]);
});
