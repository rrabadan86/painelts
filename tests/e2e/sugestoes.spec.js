const { test, expect } = require('@playwright/test');

// ⭐ Sugestões da equipe: marcar na tela própria, revisar no Pedido ("Não pedir" com motivo, registrar) e a resposta voltar
test('Sugestões: marcar produto, justificar quando tem na loja e revisar no Pedido', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.sug && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#sugestoes'; });
  await expect(page.locator('.page-title')).toContainText('Sugestões para o pedido');
  // a apresentação já traz sugestões da equipe
  await expect(page.locator('.sug-t tbody tr').first()).toBeVisible();
  // um produto que ainda tem na loja (pede justificativa)
  const prod = await page.evaluate(async () => {
    const loja = TS.state.loja;
    const e = await (await fetch(`/api/demo/estoque?loja=${encodeURIComponent(loja)}`)).json();
    const it = e.estoque.itens.find((i) => i.qtd > 1 && i.un !== 'Kg' && i.desc.length > 5);
    return { desc: it.desc };
  });
  await page.locator('.sug-busca').fill(prod.desc.slice(0, 12));
  const linha = page.locator('.sug-prod', { hasText: prod.desc }).first();
  await expect(linha).toBeVisible();
  await expect(linha.locator('.badge')).toHaveText('Tem na loja');
  await expect(linha).not.toContainText(/R\$/);
  await linha.getByRole('button', { name: '☆ Sugerir' }).click();
  await linha.getByRole('button', { name: '⭐ Confirmar sugestão' }).click();
  await expect(linha.locator('.neg')).toContainText('ainda tem na loja');
  await linha.locator('.sug-just').fill('Cliente leva sempre 3 de presente');
  await linha.getByRole('button', { name: '⭐ Confirmar sugestão' }).click();
  await expect(page.locator('.sug-t tbody tr', { hasText: prod.desc })).toContainText('Aguardando o próximo pedido');

  // no Pedido: quadro em tabela com abas, "Não pedir" com motivo (janela com escolhas rápidas) e registrar
  await page.evaluate(() => { location.hash = '#pedido'; });
  const quadro = page.locator('.sug-ped-card');
  await expect(quadro).toBeVisible({ timeout: 20000 });
  await quadro.locator('.seg button', { hasText: 'Todas' }).click();
  const minha = quadro.locator('.sug-ped-t tbody tr', { hasText: prod.desc });
  await expect(minha).toContainText('Cliente leva sempre 3 de presente');
  await minha.getByRole('button', { name: 'Não pedir', exact: true }).click();
  const perg = page.locator('.cp-modal-bg .ts-perg');
  await perg.locator('.chip', { hasText: 'Vende pouco' }).click();
  await perg.getByRole('button', { name: 'Não pedir' }).click();
  await expect(quadro.locator('.sug-ped-t tbody tr', { hasText: prod.desc })).toContainText('Não pedir: Vende pouco');
  await expect(quadro.locator('.seg button', { hasText: 'Não pedir (1)' })).toBeVisible();
  await quadro.getByRole('button', { name: 'Registrar o pedido nas sugestões' }).click();
  await expect(page.locator('.sug-ped-msg').first()).toContainText('Sugestões respondidas');

  // a resposta volta para a tela de sugestões e o produto continua marcado para o próximo pedido
  await page.evaluate(() => { location.hash = '#sugestoes'; });
  await expect(page.locator('.sug-t tbody tr', { hasText: prod.desc })).toContainText('Não entrou');
  await expect(page.locator('.sug-t tbody tr', { hasText: prod.desc })).toContainText('continua marcada para o próximo');
});

// Pedido: o quadro é uma tabela com abas; cada linha tem "+ Adicionar ao pedido"; 🛒 no quadro e ⭐ na tabela do pedido
test('Pedido: adicionar a sugestão pela linha, 🛒 "no pedido" no quadro e ⭐ da equipe na tabela do pedido', async ({ page }, info) => {
  const celular = info.project.name === 'celular';
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.sug && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#pedido'; });
  const quadro = page.locator('.sug-ped-card');
  await expect(quadro).toBeVisible({ timeout: 30000 });
  // tabela (não pilha de cartões), com abas com contagem; no celular a lista grande começa recolhida
  await expect(quadro.locator('.seg button', { hasText: /^Todas \(\d+\)$/ })).toBeVisible();
  await quadro.locator('.seg button', { hasText: 'Dá para pedir' }).click();
  await expect(quadro.locator('.seg').first().locator('button.on')).toContainText('Dá para pedir'); // o 2º seletor do quadro é "Classe pelos últimos 3/6/12 meses"
  await expect(quadro.locator('.sug-ped-cl')).toContainText(/[Cc]lasse pelos últimos/);
  await expect(quadro.locator('table thead')).toContainText('Classe');
  const linha = quadro.locator('.sug-ped-t tbody tr').filter({ has: page.locator('.sug-ped-add') }).first();
  await expect(linha).toBeVisible();
  const nome = (await linha.locator('b').first().innerText()).trim();
  const antes = await quadro.locator('.sug-ped-t tbody tr').count();
  await linha.locator('.sug-ped-add').click();
  // saiu de "Dá para pedir" e foi para "Já no pedido", com o ícone 🛒 e a quantidade
  await expect(quadro.locator('.sug-ped-t tbody tr').filter({ has: page.locator('.sug-ped-add') })).toHaveCount(antes - 1);
  await quadro.locator('.seg button', { hasText: 'Já no pedido' }).click();
  const no = quadro.locator('.sug-ped-t tbody tr', { hasText: nome }).first();
  await expect(no.locator('.sug-ped-ico')).toBeVisible();
  await expect(no.locator('.sug-ped-no')).toContainText('no pedido:');
  const txt = await no.locator('.sug-ped-no').innerText();
  // na tabela do pedido o produto ganhou o ⭐ da equipe, com quem pediu no tooltip
  if (celular) await page.locator('.ped-cards-busca').fill(nome);
  const prodLinha = page.locator(celular ? '.ped-card' : '.ped-t tbody tr', { hasText: nome }).first();
  await expect(prodLinha.locator('.ped-sug')).toHaveAttribute('title', /^Pedido da equipe: \S/);
  // mexer na quantidade do pedido atualiza o "no pedido: X" do quadro
  if (celular) await prodLinha.getByRole('button', { name: 'Mais' }).click();
  else { const q = prodLinha.locator('input.ped-q'); const v = +(await q.inputValue()), passo = +(await q.getAttribute('step')) || 1; await q.fill(String(v + passo)); await q.blur(); }
  await expect(quadro.locator('.sug-ped-t tbody tr', { hasText: nome }).first().locator('.sug-ped-no')).not.toHaveText(txt);
  // "Tirar" devolve a sugestão para "Dá para pedir"
  await quadro.locator('.sug-ped-t tbody tr', { hasText: nome }).first().getByRole('button', { name: 'Tirar' }).click();
  await expect(quadro.locator('.sug-ped-t tbody tr', { hasText: nome }).locator('.sug-ped-no')).toHaveCount(0);
});

test('Pedido: ordem da tela — ajustes, Proporção, quadros, Pedido obrigatório, Sugestões, Produtos e Revisão com a IA', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#pedido'; });
  await expect(page.locator('.sug-ped-card')).toBeVisible();
  // os blocos da tela, de cima para baixo, pelo título de cada um
  const blocos = await page.evaluate(() => [...document.querySelector('.sug-ped-card').parentElement.children]
    .map((e) => (e.classList.contains('ped-ctl') ? 'Ajustes' : e.classList.contains('cv-pedido') ? 'Compras × teto' : (e.querySelector('.card-title, .section-label')?.textContent || '')))
    .map((t) => ['Ajustes', 'Proporção do pedido', 'Compras × teto', 'Pedido obrigatório', 'Sugestões da equipe', 'Produtos', 'Revisão com IA'].find((n) => t.includes(n))).filter(Boolean));
  expect(blocos).toEqual(['Ajustes', 'Proporção do pedido', 'Compras × teto', 'Pedido obrigatório', 'Sugestões da equipe', 'Produtos', 'Revisão com IA']);
});
