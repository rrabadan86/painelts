// Clientes → Conversas na apresentação: lista ligada aos clientes, abas com contagem, conversa com a marca do robô e
// só leitura. Computador: lista à esquerda e conversa à direita; celular: a conversa no lugar da lista com "‹ Voltar".
// Nada é lido do WhatsApp nem gravado (rotas /api/demo/conversas).
const { test, expect } = require('@playwright/test');

async function abrirTela(page) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.cli && TS.cli.lista);
  await page.evaluate(() => { location.hash = '#conversas'; });
  const lista = page.locator('.cv-col-lista');
  await expect(lista).toContainText('Contato sem cadastro');
  return lista;
}

test('CONV-08: Conversas — lista ligada aos clientes, abre a conversa (🤖 do robô, ficha do cliente) e volta para o mesmo lugar', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  const lista = await abrirTela(page);
  await expect(page.locator('.page-title')).toHaveText('Conversas');
  await expect(page.locator('.submenu a.on')).toHaveText('Conversas');
  await expect(lista.locator('.seg button, .seg a').first()).toContainText('Todas (7)');
  await expect(lista).toContainText('sem cadastro');
  // cliente do painel: o nome do cadastro no lugar do número
  const nomes = await page.evaluate(() => TS.cli.lista.filter((c) => TS.foneConversa(c).length >= 12).slice(0, 6).map((c) => c.nome));
  await expect(lista).toContainText(nomes[0]);
  // a mais recente em cima
  await expect(lista.locator('.cv-item')).toHaveCount(7);
  // abre a conversa: ficha do cliente, marca do robô e só leitura
  await lista.locator('.cv-item', { hasText: nomes[0] }).first().click();
  const conv = page.locator('.cv-conversa');
  await expect(conv.locator('.cv-nome')).toHaveText(nomes[0]);
  await expect(conv.getByRole('button', { name: 'Ver cliente' })).toBeVisible();
  await expect(conv).toContainText('Só leitura por enquanto');
  // a prévia da lista é a última mensagem da conversa (a apresentação monta as duas da mesma conta)
  const ultMsg = (await conv.locator('.cv-msg .cv-txt').last().textContent()).trim();
  expect(ultMsg.length).toBeGreaterThan(5);
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw - cw, 'sem rolagem para o lado').toBeLessThanOrEqual(2);
  if (info.project.name === 'celular') {
    await page.getByRole('button', { name: '‹ Voltar' }).click();
    await expect(lista.locator('.cv-item').first()).toBeVisible();
  } else {
    // computador: a lista continua ao lado da conversa (lado a lado, sem "‹ Voltar")
    await expect(lista).toBeVisible();
    await expect(page.getByRole('button', { name: '‹ Voltar' })).toHaveCount(0);
    const [bl, bc] = [await lista.boundingBox(), await conv.boundingBox()];
    expect(bc.x).toBeGreaterThan(bl.x + bl.width - 2);
    expect(Math.abs(bc.y - bl.y)).toBeLessThan(4);
  }
  // a conversa aberta fica marcada na lista
  await expect(page.locator('.cv-ultima')).toHaveCount(1);
  await expect(page.locator('.cv-ultima')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.cv-ultima')).toContainText(nomes[0]);
  await expect(page.locator('.cv-ultima')).toContainText(ultMsg.slice(0, 30));
  // conversa cuja última mensagem foi do robô: 🤖 na lista e na conversa, com o nome da campanha
  const comRobo = lista.locator('.cv-item', { hasText: '🤖' }).first();
  await expect(comRobo).toBeVisible();
  await comRobo.click();
  await expect(page.locator('.cv-conversa .cv-msg.robo .cv-meta').first()).toContainText('🤖 robô · Campanha Resumo diário');
  if (info.project.name === 'celular') {
    await page.getByRole('button', { name: '‹ Voltar' }).click();
    await expect(lista.locator('.cv-item').first()).toBeVisible();
    // rolou até a última conversa, abriu e voltou: a lista continua onde estava
    const ultima = lista.locator('.cv-item', { hasText: 'Contato sem cadastro' });
    await ultima.scrollIntoViewIfNeeded();
    const antes = await page.evaluate(() => window.scrollY);
    await ultima.click();
    await expect(page.locator('.cv-conversa')).toBeVisible();
    await page.getByRole('button', { name: '‹ Voltar' }).click();
    await expect(page.locator('.cv-ultima')).toContainText('Contato sem cadastro');
    await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - antes), { message: 'volta perto de onde estava (não para o começo)' }).toBeLessThanOrEqual(100);
  }
  expect(erros).toEqual([]);
});

test('CONV-12: computador — lista e conversa lado a lado; trocar de conversa não mexe na lista; cada coluna rola sozinha', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  const lista = await abrirTela(page);
  // sem conversa aberta: a direita diz o que fazer (nenhuma abre sozinha)
  await expect(page.locator('.cv-conversa')).toContainText('Escolha uma conversa à esquerda');
  await expect(page.locator('.cv-conversa')).toContainText('esperam resposta');
  // as duas colunas vão até o pé da janela e cabem nela (cada uma rola sozinha; a página não precisa rolar para ler)
  await expect.poll(() => page.evaluate(() => window.innerHeight - document.querySelector('.cv-split').getBoundingClientRect().bottom), { message: 'as colunas terminam no pé da janela' }).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => window.innerHeight - document.querySelector('.cv-split').getBoundingClientRect().bottom)).toBeLessThanOrEqual(40);
  // lista baixa: ela rola dentro da própria coluna
  await page.addStyleTag({ content: '.cv-split { height: 460px !important; min-height: 0 !important; }' });
  const ul = lista.locator('.cv-lista');
  await expect.poll(() => ul.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  await ul.evaluate((e) => { e.scrollTop = e.scrollHeight; });
  const dentro = await ul.evaluate((e) => e.scrollTop);
  expect(dentro).toBeGreaterThan(30);
  const y0 = await page.evaluate(() => window.scrollY);
  await lista.locator('.cv-item', { hasText: 'Contato sem cadastro' }).click();
  await expect(page.locator('.cv-conversa')).toContainText('vi o anúncio');
  // trocar de conversa: a lista não volta para o topo nem a página pula
  expect(await ul.evaluate((e) => e.scrollTop)).toBeGreaterThan(dentro - 30);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y0)).toBeLessThanOrEqual(4);
  await expect(page.locator('.cv-ultima')).toContainText('Contato sem cadastro');
  // pelo teclado: Espaço num item abre a conversa dele
  const marcada = await lista.locator('.cv-item').nth(1).getAttribute('data-chave');
  await lista.locator('.cv-item').nth(1).focus();
  await page.keyboard.press(' ');
  await expect(page.locator('.cv-ultima')).toHaveCount(1);
  await expect(page.locator('.cv-ultima')).toHaveAttribute('data-chave', marcada);
  await expect(page.locator(`.cv-conversa .cv-msgs[data-chave="${marcada}"]`)).toBeVisible();
  // a atualização automática não mexe na rolagem da lista nem na conversa marcada
  await ul.evaluate((e) => { e.scrollTop = e.scrollHeight; });
  const agora = await ul.evaluate((e) => e.scrollTop);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(1200);
  expect(await ul.evaluate((e) => e.scrollTop)).toBeGreaterThan(agora - 30);
  await expect(page.locator('.cv-ultima')).toHaveAttribute('data-chave', marcada);
  // busca: filtra a lista sem fechar a conversa aberta
  await lista.locator('.cv-busca').fill('anúncio');
  await expect(lista.locator('.cv-item')).toHaveCount(1);
  await expect(page.locator('.cv-conversa .cv-nome')).toBeVisible();
  expect(erros).toEqual([]);
});

test('CONV-09: sem internet por um momento — a lista continua na tela, sem "Failed to fetch", e atualiza quando a conexão volta', async ({ page, context }) => {
  const lista = await abrirTela(page);
  let pedidos = 0;
  page.on('request', (r) => { if (/\/api\/demo\/conversas\?/.test(r.url())) pedidos++; });
  await context.setOffline(true);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // a página "voltou": tenta atualizar
  await page.waitForTimeout(1500);
  await expect(lista).toContainText('Contato sem cadastro');
  await expect(page.locator('#content')).not.toContainText(/failed to fetch/i);
  await context.setOffline(false); // a internet voltou: tenta de novo sozinha
  await expect.poll(() => pedidos).toBeGreaterThan(0);
  await expect(lista).toContainText('Contato sem cadastro');
  await expect(page.locator('#content')).not.toContainText(/failed to fetch/i);
});

test('CONV-11: "sem resposta" na lista, abre pelo teclado, a atualização não tira a leitura do lugar, sem Imprimir; no celular o voltar fecha a conversa', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  const lista = await abrirTela(page);
  // a marca é "sem resposta da loja" (não "não lida"), a aba também; sem quadros de número antes da lista; sem 🖨
  await expect(lista.locator('.seg button', { hasText: 'Sem resposta' })).toBeVisible();
  await expect(lista).toContainText('sem resposta');
  await expect(page.locator('#content .g-kpi')).toHaveCount(0);
  await expect(page.locator('#content .prt-btn')).toHaveCount(0);
  await expect(page.locator('.cv-priv')).toContainText('Só o franqueado e o admin veem');
  await expect(lista.getByRole('button', { name: /Reimportar histórico/ })).toBeVisible();
  // o item abre pelo teclado
  await lista.locator('.cv-item', { hasText: 'Contato sem cadastro' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cv-conversa')).toContainText('vi o anúncio');
  await expect(page.locator('.cv-conversa .cv-msg.robo')).toHaveCount(0); // o robô nunca escreve para quem não tem cadastro
  if (info.project.name === 'celular') {
    // "voltar" do navegador/celular fecha a conversa e continua na tela
    await expect.poll(() => page.evaluate(() => !!(history.state && history.state.conversa))).toBe(true);
    await page.goBack();
    await expect(page.locator('.cv-conversa')).toHaveCount(0);
    await expect(lista.locator('.cv-item').first()).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe('#conversas');
    await lista.locator('.cv-item').first().click();
  } else {
    // computador: abrir não cria entrada no histórico (a lista está sempre ao lado)
    expect(await page.evaluate(() => !!(history.state && history.state.conversa))).toBe(false);
    await lista.locator('.cv-item').first().click();
  }
  // sobe a leitura e a atualização automática não a leva para o fim
  const primeira = await lista.locator('.cv-item').first().getAttribute('data-chave');
  await expect(page.locator(`.cv-msgs[data-chave="${primeira}"]`)).toBeVisible();
  await page.addStyleTag({ content: '.cv-msgs { max-height: 120px !important; } .cv-split .cv-msgs-w { flex: 0 0 auto !important; }' });
  await page.evaluate(() => { document.querySelector('.cv-msgs').scrollTop = 0; });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => document.querySelector('.cv-msgs').scrollTop)).toBeLessThan(10);
  if (info.project.name === 'celular') {
    // "‹ Voltar" consome a entrada do histórico: o voltar seguinte sai da tela (não reabre a conversa)
    await page.getByRole('button', { name: '‹ Voltar' }).click();
    await expect(page.locator('.cv-conversa')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => !(history.state && history.state.conversa))).toBe(true);
  }
  expect(erros).toEqual([]);
});
