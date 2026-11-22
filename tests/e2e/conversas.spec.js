// Clientes → Conversas na apresentação: lista ligada aos clientes, abas com contagem, conversa com a marca do robô e
// só leitura. Nada é lido do WhatsApp nem gravado (rotas /api/demo/conversas).
const { test, expect } = require('@playwright/test');

test('CONV-08: Conversas — lista ligada aos clientes, abre a conversa (🤖 do robô, ficha do cliente) e volta', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.cli && TS.cli.lista);
  await page.evaluate(() => { location.hash = '#conversas'; });
  await expect(page.locator('.page-title')).toHaveText('Conversas');
  await expect(page.locator('.submenu a.on')).toHaveText('Conversas');
  const card = page.locator('.card', { hasText: 'Conversas do WhatsApp' });
  await expect(card.locator('.seg button, .seg a').first()).toContainText('Todas (7)');
  await expect(card).toContainText('sem cadastro');
  // cliente do painel: o nome do cadastro no lugar do número
  const nomes = await page.evaluate(() => TS.cli.lista.filter((c) => TS.foneConversa(c).length >= 12).slice(0, 6).map((c) => c.nome));
  await expect(card).toContainText(nomes[0]);
  // abre a primeira conversa: ficha do cliente, marca do robô e só leitura
  await card.getByText(nomes[0]).first().click();
  const conv = page.locator('.cv-conversa');
  await expect(conv.locator('.cv-nome')).toHaveText(nomes[0]);
  await expect(conv.getByRole('button', { name: 'Ver cliente' })).toBeVisible();
  await expect(conv).toContainText('Só leitura por enquanto');
  // a prévia da lista é a última mensagem da conversa (a apresentação monta as duas da mesma conta)
  const ultMsg = (await conv.locator('.cv-msg .cv-txt').last().textContent()).trim();
  expect(ultMsg.length).toBeGreaterThan(5);
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw - cw, 'sem rolagem para o lado').toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: '‹ Voltar' }).click();
  await expect(card.locator('table, .t-cards').first()).toBeVisible();
  // volta para o mesmo lugar da lista, com a conversa aberta marcada
  await expect(page.locator('.cv-ultima')).toHaveCount(1);
  await expect(page.locator('.cv-ultima')).toContainText(nomes[0]);
  await expect(page.locator('.cv-ultima')).toContainText(ultMsg.slice(0, 30));
  // conversa cuja última mensagem foi do robô: 🤖 na lista e na conversa, com o nome da campanha
  const comRobo = card.locator('tbody tr', { hasText: '🤖' }).first();
  await expect(comRobo).toBeVisible();
  await comRobo.click();
  await expect(page.locator('.cv-conversa .cv-msg.robo .cv-meta').first()).toContainText('🤖 robô · Campanha Resumo diário');
  await page.getByRole('button', { name: '‹ Voltar' }).click();
  await expect(card.locator('table, .t-cards').first()).toBeVisible();
  // rolou até a última conversa, abriu e voltou: a lista continua onde estava
  const ultima = card.getByText('Contato sem cadastro').first();
  await ultima.scrollIntoViewIfNeeded();
  const antes = await page.evaluate(() => window.scrollY);
  await ultima.click();
  await expect(page.locator('.cv-conversa')).toBeVisible();
  await page.getByRole('button', { name: '‹ Voltar' }).click();
  await expect(page.locator('.cv-ultima')).toContainText('Contato sem cadastro');
  await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - antes), { message: 'volta perto de onde estava (não para o começo)' }).toBeLessThanOrEqual(100);
  // a lista também rola dentro do próprio quadro (barra interna): com muitas conversas, volta no mesmo ponto dela
  await page.addStyleTag({ content: '.table-wrap { max-height: 160px !important; }' }); // quadro baixo: a lista rola dentro dele
  await page.evaluate(() => { document.querySelector('.table-wrap').scrollTop = 120; });
  const dentro = await page.evaluate(() => document.querySelector('.table-wrap').scrollTop);
  expect(dentro).toBeGreaterThan(50);
  const alvo = await page.evaluate(() => { const t = document.querySelector('.table-wrap'); const r = t.getBoundingClientRect(); const el = document.elementFromPoint(r.left + 40, r.top + r.height / 2); return el && el.closest('tr, .tcard') ? el.closest('tr, .tcard').textContent.slice(0, 40) : null; });
  expect(alvo).toBeTruthy();
  await page.evaluate(() => { const t = document.querySelector('.table-wrap'); const r = t.getBoundingClientRect(); document.elementFromPoint(r.left + 40, r.top + r.height / 2).click(); });
  await expect(page.locator('.cv-conversa')).toBeVisible();
  await page.getByRole('button', { name: '‹ Voltar' }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector('.table-wrap').scrollTop), { message: 'a barra interna da lista volta onde estava' }).toBeGreaterThan(dentro - 30);
  // a atualização automática (a cada 30 s, ou ao voltar para a página) também não leva a lista para o topo
  const agora = await page.evaluate(() => document.querySelector('.table-wrap').scrollTop);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => document.querySelector('.table-wrap').scrollTop)).toBeGreaterThan(agora - 30);
  expect(erros).toEqual([]);
});

test('CONV-09: sem internet por um momento — a lista continua na tela, sem "Failed to fetch", e atualiza quando a conexão volta', async ({ page, context }) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.cli && TS.cli.lista);
  await page.evaluate(() => { location.hash = '#conversas'; });
  const card = page.locator('.card', { hasText: 'Conversas do WhatsApp' });
  await expect(card).toContainText('Contato sem cadastro');
  let pedidos = 0;
  page.on('request', (r) => { if (/\/api\/demo\/conversas\?/.test(r.url())) pedidos++; });
  await context.setOffline(true);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // a página "voltou": tenta atualizar
  await page.waitForTimeout(1500);
  await expect(card).toContainText('Contato sem cadastro');
  await expect(page.locator('#content')).not.toContainText(/failed to fetch/i);
  await context.setOffline(false); // a internet voltou: tenta de novo sozinha
  await expect.poll(() => pedidos).toBeGreaterThan(0);
  await expect(card).toContainText('Contato sem cadastro');
  await expect(page.locator('#content')).not.toContainText(/failed to fetch/i);
});

test('CONV-11: "sem resposta" na lista, voltar do celular fecha a conversa, a atualização não tira a leitura do lugar e sem Imprimir', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.cli && TS.cli.lista);
  await page.evaluate(() => { location.hash = '#conversas'; });
  const card = page.locator('.card', { hasText: 'Conversas do WhatsApp' });
  await expect(card).toContainText('Contato sem cadastro');
  // a marca é "sem resposta da loja" (não "não lida"), a aba também; sem quadros de número antes da lista; sem 🖨
  await expect(card.locator('.seg button', { hasText: 'Sem resposta' })).toBeVisible();
  await expect(card).toContainText('sem resposta');
  await expect(page.locator('#content .g-kpi')).toHaveCount(0);
  await expect(card.locator('.prt-btn')).toHaveCount(0);
  await expect(page.locator('.cv-priv')).toContainText('Só o franqueado e o admin veem');
  await expect(card.getByRole('button', { name: /Reimportar histórico/ })).toBeVisible();
  // a linha abre pelo teclado
  await card.locator('tbody tr', { hasText: 'Contato sem cadastro' }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cv-conversa')).toBeVisible();
  await expect(page.locator('.cv-conversa')).toContainText('vi o anúncio');
  await expect(page.locator('.cv-conversa .cv-msg.robo')).toHaveCount(0); // o robô nunca escreve para quem não tem cadastro
  // "voltar" do navegador/celular fecha a conversa e continua na tela
  await expect.poll(() => page.evaluate(() => !!(history.state && history.state.conversa))).toBe(true);
  await page.goBack();
  await expect(page.locator('.cv-conversa')).toHaveCount(0);
  await expect(card.locator('tbody tr').first()).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#conversas');
  // abre uma conversa, sobe a leitura e a atualização automática não a leva para o fim
  await card.locator('tbody tr').first().click();
  await expect(page.locator('.cv-msgs')).toBeVisible();
  await page.addStyleTag({ content: '.cv-msgs { max-height: 120px !important; }' });
  await page.evaluate(() => { document.querySelector('.cv-msgs').scrollTop = 0; });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => document.querySelector('.cv-msgs').scrollTop)).toBeLessThan(10);
  // "‹ Voltar" consome a entrada do histórico: o voltar seguinte sai da tela (não reabre a conversa)
  await page.getByRole('button', { name: '‹ Voltar' }).click();
  await expect(page.locator('.cv-conversa')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !(history.state && history.state.conversa))).toBe(true);
  expect(erros).toEqual([]);
});
