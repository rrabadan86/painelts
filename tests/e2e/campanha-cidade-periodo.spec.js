const { test, expect } = require('./_base');

// Pedido do dono (24/11/2026): nas Campanhas, "Comprou entre" (período de compra) em Frequência e, em Perfil, "Mora em" (cidade
// do cadastro, com "sem cidade no cadastro") e "Só nesta loja"; na Lista de clientes, cidade sem diferença de caixa/acento
// com "Sem cidade no cadastro" e "Compra mais em". Apresentação, computador e celular.
const abrirCampanhas = async (page) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#campanhas'; });
  await expect(page.getByRole('button', { name: '+ Criar campanha' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ Criar campanha' }).click();
};
const total = (page) => async () => +(await page.locator('.cp-contagem b').innerText()).replace(/\D/g, '');

test('CAMP-PER-01: "Comprou entre" filtra quem comprou no período e aparece no resumo da Frequência', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrirCampanhas(page);
  await expect.poll(total(page)).toBeGreaterThan(0);
  const tudo = await total(page)();
  const b = page.locator('details.cp-bloco').filter({ has: page.locator('summary b', { hasText: /^Frequência$/ }) });
  if (!(await b.locator('.cp-linha', { hasText: 'Comprou entre' }).isVisible())) await b.locator('summary').click();
  const linha = b.locator('.cp-linha', { hasText: 'Comprou entre' });
  await expect(linha.locator('.dica-i')).toHaveCount(1);
  const [de, ate] = [linha.locator('input[type=date]').nth(0), linha.locator('input[type=date]').nth(1)];
  // os últimos 30 dias (pela data da apresentação): menos gente que o total, e alguém
  const [d0, d1] = await page.evaluate(() => { const h = TS.hojeSP(); const t = Date.parse(h + 'T12:00:00Z'); return [new Date(t - 30 * 864e5).toISOString().slice(0, 10), h]; });
  await de.fill(d0); await de.blur(); await ate.fill(d1); await ate.blur();
  await expect.poll(total(page)).toBeLessThan(tudo);
  await expect.poll(total(page)).toBeGreaterThan(0);
  await expect(b.locator('.cp-bloco-res')).toContainText('comprou de');
  // um período em que ninguém comprou: ninguém entra
  await de.fill('2001-01-01'); await de.blur(); await ate.fill('2001-01-31'); await ate.blur();
  await expect.poll(total(page)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
  expect(erros).toEqual([]);
});

test('CID-01: Perfil tem "Mora em" (com "sem cidade no cadastro") e "Só nesta loja"; a cidade escolhida reduz a lista', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrirCampanhas(page);
  await expect.poll(total(page)).toBeGreaterThan(0);
  const tudo = await total(page)();
  const b = page.locator('.cp-bloco', { hasText: 'Perfil' });
  if (!(await b.locator('.cp-linha', { hasText: 'Mora em' }).isVisible())) await b.locator('summary').click();
  const mora = b.locator('.cp-linha', { hasText: 'Mora em' }).locator('select');
  const opcoes = await mora.locator('option').allInnerTexts();
  expect(opcoes[0]).toBe('qualquer cidade');
  expect(opcoes.length).toBeGreaterThan(1);
  const cidade = opcoes.find((o) => !/qualquer|sem cidade/.test(o));
  await mora.selectOption({ label: cidade });
  await expect.poll(total(page)).toBeLessThanOrEqual(tudo);
  await expect(b.locator('.cp-bloco-res')).toContainText(cidade.replace(/ \(\d+\)$/, ''));
  const loja = b.locator('.cp-linha', { hasText: 'Compra mais em' }).locator('select');
  expect((await loja.locator('option').allInnerTexts()).some((o) => /^Só nesta loja/.test(o))).toBe(true);
  expect(erros).toEqual([]);
});

test('CID-02: Lista de clientes — "Cidade (cadastro)" com contagem e "Compra mais em" nos filtros', async ({ page }, info) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#clilista'; });
  await page.waitForFunction(() => TS.cli && TS.cli.cidades);
  // a conta das cidades: mesma cidade com caixa/acento diferente é uma só; sem cidade fica à parte
  const conta = await page.evaluate(() => {
    const r = TS.cidadesDe([{ cidade: 'TORRES' }, { cidade: 'Torres ' }, { cidade: 'torres' }, { cidade: 'São Paulo' }, { cidade: 'SAO PAULO' }, { cidade: '' }, {}]);
    return { cidades: r.cidades, torres: r.cidadeQtd.get(TS.cidadeChave('Torres')), sem: r.semCidade };
  });
  expect(conta.cidades.map((x) => x[1])).toEqual(['São Paulo', 'Torres']);
  expect(conta.torres).toBe(3);
  expect(conta.sem).toBe(2);
  if (info.project.name === 'computador') await page.locator('#btnMaisFiltros').click();
  else await page.locator('#btnFiltros').click();
  await expect(page.getByText('Compra mais em', { exact: true }).first()).toBeVisible();
  expect(erros).toEqual([]);
});
