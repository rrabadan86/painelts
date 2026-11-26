// Ajuda do painel (pedido do dono, 25/11/2026): AJUDA-01 (menu do nome → lista, busca e ficha), AJUDA-02 (? ao lado do
// título de cada tela abre a ficha dela por cima, sem sair do lugar).
const { test, expect } = require('./_base');

const abrir = async (page) => { await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.ajuda); };
const semLixo = async (loc) => expect(await loc.innerText()).not.toMatch(/(^|[\s>(\d])(null|undefined|NaN|\[object Object\])(?=$|[\s<).,])/m);
const semRolagem = async (page) => expect(await page.locator('.aj-painel').evaluate((p) => p.scrollWidth - p.clientWidth)).toBeLessThanOrEqual(1);

test('AJUDA-01: menu do nome → Ajuda — perguntas, as telas da pessoa, busca e a ficha', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  await page.locator('#btnUsuario').click();
  await page.locator('#btnAjuda').click();
  const aj = page.locator('.aj-camada');
  await expect(aj.locator('.page-title').first()).toHaveText('Ajuda');
  await expect(aj.locator('.aj-faq').first()).toBeVisible();
  // uma linha por tela do menu da pessoa (a apresentação entra como admin: todas as fichas das telas que ela tem)
  const n = await page.evaluate(() => TS.ajuda.fichas().length);
  expect(n).toBeGreaterThan(25);
  await expect(aj.locator('.aj-grupos .aj-row')).toHaveCount(n);
  await semLixo(aj); await semRolagem(page);
  // busca sem acento acha a pergunta e as telas
  await aj.locator('.aj-busca-in').fill('preco cheio');
  await expect(aj.locator('.aj-faq').first()).toContainText('faturamento do Resumo');
  await expect(aj.locator('.aj-row', { hasText: 'Resumo' })).toBeVisible();
  await aj.locator('.aj-busca-in').fill('palavra que não existe');
  await expect(aj).toContainText('Nada encontrado');
  await aj.locator('.aj-busca-in').fill('');
  // a ficha: os números com a conta, as perguntas e "‹ Ajuda" volta para a lista
  await aj.locator('.aj-row', { hasText: 'Resultado (DRE)' }).click();
  await expect(aj.locator('.page-title').first()).toHaveText('Resultado (DRE)');
  await expect(aj.locator('.aj-num', { hasText: 'Receita líquida' })).toContainText('Simples');
  await expect(aj.locator('.aj-meta a', { hasText: 'Abrir a tela' })).toHaveAttribute('href', '#dre');
  await semLixo(aj); await semRolagem(page);
  await aj.locator('.aj-voltar').click();
  await expect(aj.locator('.page-title').first()).toHaveText('Ajuda');
  // Esc fecha
  await page.keyboard.press('Escape');
  await expect(page.locator('.aj-camada')).toHaveCount(0);
  expect(erros).toEqual([]);
});

test('AJUDA-02: o ? ao lado do título de toda tela abre a ficha dela e "Voltar para a tela" fecha sem mudar de lugar', async ({ page }, info) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  const pags = await page.evaluate(() => TS.paginas().filter((p) => TS.ajuda.ficha(p)));
  expect(pags.length).toBeGreaterThan(25);
  // no celular, uma amostra (no computador, todas)
  const lista = info.project.name === 'computador' ? pags : ['inicio', 'resumo', 'clientes', 'pedido', 'dre'];
  for (const p of lista) {
    await page.evaluate((x) => { location.hash = '#' + x; }, p);
    const bt = page.locator(`#content .page-title .aj-tit[data-pag="${p}"]`).first();
    await expect(bt, `tela ${p} sem o ? da ajuda`).toBeVisible({ timeout: 20000 });
    const nome = await page.evaluate((x) => TS.ajuda.ficha(x).nome, p);
    await bt.click();
    await expect(page.locator('.aj-camada .page-title').first()).toHaveText(nome);
    await page.locator('.aj-camada .aj-voltar').click();
    await expect(page.locator('.aj-camada')).toHaveCount(0);
    // fechar a camada tira do histórico a entrada que ela criou (o "voltar" do celular fecha): espera assentar antes de trocar de tela
    await page.waitForFunction(() => !(history.state && history.state.camada));
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => location.hash)).toBe('#' + p);
  }
  expect(erros).toEqual([]);
});
