const { test, expect } = require('./_base');

// Estoque: tabela única com todos os produtos da planilha do AppNext, busca em todos e aviso de nota lançada depois da planilha
test('Estoque: tabela única — filtros, busca em todos os produtos, quadros que filtram e nota ainda fora do saldo', async ({ page }) => {
  // nota fictícia lançada depois da planilha de estoque, com um produto que tem saldo
  await page.route('**/api/demo/estoque/notas*', async (route) => {
    const j = await (await route.fetch()).json();
    const e = await (await page.request.get('/api/demo/estoque?loja=demo-centro')).json();
    const it = (e.estoque || e).itens.find((x) => x.qtd > 0);
    const amanha = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    j.notas = [{ nf: 7777, serie: 1, entrada: amanha, emissao: amanha, status: 'Concluída', motivo: 'Compra', fornecedor: 'Teste', itens: [{ cod: it.cod, nome: it.desc, un: it.un, qtd: 3, custo: 10 }] }, ...(j.notas || [])];
    await route.fulfill({ json: j });
  });
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#estoque'; });
  const card = page.locator('#est-tabela');
  await expect(card).toBeVisible();
  const filtros = card.locator('.est-tools .seg button');
  await expect(filtros).toHaveText([/O que repor/, /Perdendo venda/, /Parados/, /Sobrando/, /Fora de linha · liquidar/, /Com saldo/, /Todos/]);
  await expect(filtros.first()).toHaveClass(/on/);

  // aviso da nota lançada depois da planilha
  await expect(card.locator('.est-notas-depois')).toContainText('NF 7777');

  // busca acha produto que NÃO está em "O que repor" (busca em todos)
  const fora = await page.evaluate(async () => {
    const e = await TS.estoqueBuscar(TS.state.loja);
    const nomes = new Set([...document.querySelectorAll('#est-tabela tbody tr')].map((tr) => tr.querySelector('td').textContent));
    return e.estoque.itens.find((i) => i.qtd > 0 && ![...nomes].some((n) => n.includes(i.desc))).desc;
  });
  await card.locator('.est-busca').fill(fora);
  await expect(card.locator('.est-busca-info')).toContainText('entre todos');
  await expect(card.locator('tbody')).toContainText(fora);
  await card.locator('.est-busca').fill('');

  // a linha "Parado" do cartão-herói filtra a tabela
  await page.locator('.est-p2-heroi .linhas-num-a', { hasText: 'Parado' }).click();
  await expect(card.locator('.est-tools .seg button.on')).toContainText('Parados');
  await expect(card.locator('tbody .badge').first()).toHaveText('Parado');

  // o produto da nota aparece marcado, com a quantidade que ainda não está no saldo
  const daNota = await page.evaluate(async () => (await TS.estoqueBuscar(TS.state.loja)).estoque.itens.find((x) => x.qtd > 0).desc);
  await card.locator('.est-busca').fill(daNota);
  await expect(card.locator('tr.est-tem-entrada').first()).toBeVisible();
  await expect(card.locator('.est-entrada').first()).toContainText('NF 7777');
  await expect(card.locator('.est-entrada').first()).toContainText('ainda não está no saldo');
  const larga = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(larga).toBeLessThanOrEqual(1);
});
