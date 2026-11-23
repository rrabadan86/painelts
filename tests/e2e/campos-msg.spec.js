const { test, expect } = require('./_base');

// Pedidos do dono de 23/11/2026 (apresentação, computador e celular):
// CAMPOS-MSG-01 a lista única dos {campos} da mensagem: todo campo vira chip com explicação e "Ver todos os campos" mostra a tabela
// DESP-CAB-01 Configurações → loja → Estoque e margem: o cabeçalho das colunas dos custos fica preso no topo ao rolar

async function abrirCriar(page) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#campanhas'; });
  await expect(page.getByRole('button', { name: '+ Criar campanha' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ Criar campanha' }).click();
}
const semRolarDeLado = (page) => page.evaluate(() => {
  const out = [];
  if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('página');
  for (const w of document.querySelectorAll('.cp-campos-box, .cp-campos-box .table-wrap')) if (w.scrollWidth > w.clientWidth + 1) out.push(w.className);
  return out;
});

test('CAMPOS-MSG-01: Criar campanha mostra todos os campos da mensagem como chip com explicação, e "Ver todos os campos" abre a tabela', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrirCriar(page);
  const caixa = page.locator('.cp-campos-box').first();
  await expect(caixa.locator('.cp-tag').first()).toBeVisible();
  // a lista oficial tem todo campo que a montagem da mensagem aceita (msgwpp.js) e o {produto} das campanhas
  const { lista, aceitos } = await page.evaluate(() => ({
    lista: TS.CAMPOS_MSG.filter((x) => !x.so || x.so.includes('campanha')).map((x) => x.k),
    aceitos: [...TS.msgWpp.CAMPOS, 'produto'],
  }));
  expect(aceitos.filter((k) => !lista.includes(k)), 'campo que a mensagem aceita e não está na lista').toEqual([]);
  expect(lista).toContain('chaoferta');
  // cada campo é um chip com a explicação (o que vira, quando usar e o valor para o cliente de exemplo)
  await expect(caixa.locator('.cp-tag')).toHaveCount(lista.length);
  await expect.poll(() => caixa.locator('.cp-tag[data-campo="nome"]').getAttribute('title')).toMatch(/Para \S/);
  for (const k of lista) {
    const chip = caixa.locator(`.cp-tag[data-campo="${k}"]`);
    await expect(chip, `chip {${k}}`).toHaveText(`{${k}}`);
    const t = await chip.getAttribute('title');
    expect(t && t.trim(), `explicação de {${k}}`).toBeTruthy();
    expect(t).toContain('Quando usar');
    expect(t).not.toMatch(/undefined|null|NaN/);
  }
  // o chip põe o campo na mensagem
  const msg = page.locator('textarea.cp-msg').first();
  await msg.fill('Oi, ');
  await caixa.locator('.cp-tag[data-campo="saudacao"]').click();
  await expect(msg).toHaveValue('Oi, {saudacao}');
  // "Ver todos os campos": a tabela com uma linha por campo, sem rolar para o lado
  await caixa.locator('summary', { hasText: 'Ver todos os campos' }).click();
  const tab = caixa.locator('table.cp-campos-t');
  await expect(tab).toBeVisible();
  await expect(tab.locator('tbody tr')).toHaveCount(lista.length);
  const texto = await tab.evaluate((t) => t.textContent); // no celular os cartões fora da tela não desenham (content-visibility)
  for (const k of lista) expect(texto).toContain(`{${k}}`);
  expect(texto).not.toMatch(/(^|\s)(undefined|null|NaN)(\s|$)/m);
  expect(await semRolarDeLado(page), 'rolagem para o lado').toEqual([]);
  expect(erros).toEqual([]);
});

test('CAMPOS-MSG-01: Configurações → loja → Mensagens usa a mesma lista (sem os campos só de campanha)', async ({ page }) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#config'; });
  await page.locator('table.cfg-lojas-t .cfg-abrir').first().click();
  const links = page.locator('.cfg-loja .cfg-sub a');
  const k = (await links.allInnerTexts()).findIndex((t) => /Mensagens/.test(t));
  await links.nth(k).evaluate((a) => a.click());
  const caixa = page.locator('.cfg-loja .cp-campos-box').first();
  await expect(caixa.locator('.cp-tag').first()).toBeVisible();
  const lista = await page.evaluate(() => TS.CAMPOS_MSG.filter((x) => !x.so || x.so.includes('modelo')).map((x) => x.k));
  await expect(caixa.locator('.cp-tag')).toHaveCount(lista.length);
  await expect(caixa.locator('.cp-tag[data-campo="produto"]')).toHaveCount(0);
  await expect(caixa.locator('.cp-tag[data-campo="chaoferta"]')).toHaveCount(0);
  const txt = page.locator('.cfg-wpp textarea').first();
  await txt.fill('Oi, ');
  await caixa.locator('.cp-tag[data-campo="nome"]').click();
  await expect(txt).toHaveValue('Oi, {nome}');
});

test('DESP-CAB-01: custos da loja — o cabeçalho fica preso no topo ao rolar a lista (computador: nomes das colunas; celular: a faixa da categoria)', async ({ page }, info) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#config'; });
  await page.locator('table.cfg-lojas-t .cfg-abrir').first().click();
  const links = page.locator('.cfg-loja .cfg-sub a');
  const k = (await links.allInnerTexts()).findIndex((t) => /Estoque e margem/.test(t));
  await links.nth(k).evaluate((a) => a.click());
  const tab = page.locator('table.est-cat-fixos');
  await expect(tab).toBeVisible();
  // a apresentação tem poucos custos: acrescenta linhas na 1ª categoria (só na tela, nada é salvo) para a lista passar da altura da janela
  for (let i = 0; i < 14; i++) await tab.locator('.est-cat-add').first().evaluate((b) => b.click());
  await expect.poll(() => tab.locator('tbody tr.est-cat-item').count()).toBeGreaterThan(15);
  const celular = info.project.name === 'celular';
  const r = await tab.evaluate((t, cel) => {
    const itens = t.querySelectorAll('tbody tr.est-cat-item');
    const alvo = itens[13]; // perto do fim da 1ª categoria
    window.scrollTo(0, alvo.getBoundingClientRect().top + window.scrollY - 300);
    // computador: a linha com os nomes das colunas; celular: a faixa da 1ª categoria (cada campo do cartão já tem o nome em cima)
    const cab = cel ? t.querySelector('tbody tr.est-cat-cab') : t.querySelector('thead th');
    const c = cab.getBoundingClientRect();
    const barra = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const el = document.elementFromPoint(c.left + 12, c.top + c.height / 2);
    const w = t.closest('.table-wrap');
    return { cabTop: c.top, cabAlto: c.height, barra, primeiro: itens[0].getBoundingClientRect().top,
      noPonto: !!(el && el.closest(cel ? 'tr.est-cat-cab' : 'thead')), deLado: w.scrollWidth - w.clientWidth, pagina: document.documentElement.scrollWidth - window.innerWidth };
  }, celular);
  expect(r.primeiro, 'a lista rolou para baixo da barra do topo').toBeLessThan(r.barra);
  expect(Math.abs(r.cabTop - r.barra), 'cabeçalho preso logo abaixo da barra do topo').toBeLessThanOrEqual(8);
  expect(r.cabAlto).toBeGreaterThan(10);
  expect(r.noPonto, 'o cabeçalho fica por cima das linhas').toBe(true);
  expect(r.deLado, 'a lista não rola para o lado').toBeLessThanOrEqual(1);
  expect(r.pagina, 'a página não rola para o lado').toBeLessThanOrEqual(1);
});
