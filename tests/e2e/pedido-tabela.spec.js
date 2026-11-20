const { test, expect } = require('@playwright/test');

// Estoque → Pedido, tabela de Produtos (apresentação): a página não volta ao mudar uma quantidade, a linha que muda de aba não some
// na hora, filtro por subgrupo, margem bruta do pacote, classe como ícone no nome e sem a coluna "Lucro sem fixos/dia".
async function abrir(page) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#pedido'; });
  await expect(page.locator('.seg button', { hasText: /^Todos \(/ })).toBeVisible({ timeout: 40000 });
}
const aba = (page, nome) => page.locator('.seg button', { hasText: nome }).first();

test('Pedido: colunas novas (margem bruta do pacote, classe em ícone) e filtro por subgrupo', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  await aba(page, /^Todos \(/).click();
  const linhas = await page.evaluate(async () => {
    // as mesmas linhas da tela: pega do cadastro o que a tabela deve mostrar
    const e = await (await fetch(`/api/demo/estoque?loja=${encodeURIComponent(TS.state.loja)}`)).json();
    return { grupos: TS.db.D.grupoC.filter(Boolean), tipos: TS.db.D.grupo.filter(Boolean), subs: [...new Set(e.tabela.itens.map((t) => t.sub).filter(Boolean))].sort(), cha50: e.tabela.itens.filter((t) => / 50G$/.test(t.desc)).length, cha100: e.tabela.itens.filter((t) => / 100G$/.test(t.desc)).length };
  });
  expect(linhas.subs.length).toBeGreaterThan(1);
  expect(linhas.cha50).toBeGreaterThan(0);
  if (info.project.name === 'computador') {
    const cab = page.locator('.ped-t thead');
    await expect(cab).toContainText('Margem bruta');
    await expect(cab).not.toContainText('Lucro sem fixos');
    await expect(cab).not.toContainText('Classe');
  }
  if (info.project.name === 'celular') { // no celular a lista é em cartões e os filtros ficam recolhidos: confere só o ícone da classe e a largura
    const ic = page.locator('.ped-cl-ico').first();
    await expect(ic).toHaveText(/^(⭐|👍|📦|💤)$/);
    // sem a coluna Grupo, o subgrupo aparece ao lado do código
    const sub = page.locator('.ped-card .est-tam .ped-cod-sub').first();
    await expect(sub).toBeVisible();
    expect(linhas.subs).toContain(await sub.innerText());
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
    expect(erros).toEqual([]);
    return;
  }
  // filtro Grupo: os mesmos grupos do filtro das Vendas, não as partes do pedido (essas ficam em "Parte do pedido");
  // a coluna mostra o grupo do AppNext como sai na venda (ex.: CHÁ VERDE AROMATIZADO)
  const selGrupo = page.locator('select.ped-fx[aria-label="Grupo"]');
  const gruposTela = (await selGrupo.locator('option').allInnerTexts()).slice(1).map((t) => t.replace(/^Grupo: /, '').replace(/ \(\d+\)$/, ''));
  expect(gruposTela.length).toBeGreaterThan(1);
  expect(gruposTela.some((g) => linhas.grupos.includes(g)), gruposTela.join(', ')).toBe(true);
  expect(gruposTela).not.toContain('Chás a granel');
  await expect(page.locator('select.ped-fx[aria-label="Parte do pedido"]')).toContainText('Chás a granel');
  const gAlvo = gruposTela.find((g) => linhas.grupos.includes(g));
  await selGrupo.selectOption(gAlvo);
  expect(+(await page.locator('.ped-fx-n').innerText()).replace(/\D/g, '')).toBeGreaterThan(0);
  if (info.project.name === 'computador') {
    const cel = (await page.locator('.ped-t tbody tr').first().locator('td').nth(1).innerText()).split('\n')[0].trim();
    expect(linhas.tipos, cel).toContain(cel);
  }
  await page.locator('.ped-fx-limpa').click();
  // filtro por subgrupo: aparece, filtra e conta
  const selSub = page.locator('select.ped-fx[aria-label="Subgrupo"]');
  await expect(selSub).toBeVisible();
  const total = +(await page.locator('.ped-fx-n').innerText()).replace(/\D/g, '');
  await selSub.selectOption(linhas.subs[0]);
  const filtrado = +(await page.locator('.ped-fx-n').innerText()).replace(/\D/g, '');
  expect(filtrado).toBeGreaterThan(0);
  expect(filtrado).toBeLessThan(total);
  await expect(page.locator('.ped-sub').first()).toHaveText(linhas.subs[0]);
  // chá a granel: margem bruta = média dos pacotes de 50 g e 100 g, com a conta na dica; classe como ícone com explicação
  if (info.project.name === 'computador') {
    const m = page.locator('.ped-t tbody .est-dica[title*="Média dos pacotes de 50 g e 100 g"]').first();
    await expect(m).toHaveText(/^-?\d+,\d%$/);
    const t = await m.getAttribute('title');
    const ps = [...t.matchAll(/= (-?\d+,\d)%/g)].map((x) => +x[1].replace(',', '.'));
    expect(ps.length).toBe(2);
    expect(Math.abs((ps[0] + ps[1]) / 2 - +(await m.innerText()).replace('%', '').replace(',', '.'))).toBeLessThanOrEqual(0.11);
  }
  await page.locator('.ped-fx-limpa').click();
  const ico = page.locator('.ped-cl-ico').first();
  await expect(ico).toHaveText(/^(⭐|👍|📦|💤)$/);
  await expect(ico).toHaveAttribute('title', /^(Estrela|Joia|Volume|Peso morto): /);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado da página').toBeLessThanOrEqual(1);
  if (process.env.PRINTS) await page.screenshot({ path: `${process.env.PRINTS}/pedido-${info.project.name}.png` });
  expect(erros).toEqual([]);
});

test('Pedido: adicionar na 2ª página não volta para a 1ª; a linha que muda de aba fica até trocar de aba', async ({ page }, info) => {
  test.skip(info.project.name === 'celular', 'no celular a lista é em cartões, sem páginas');
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  await aba(page, /^Todos \(/).click();
  const pager = page.locator('.card', { has: page.locator('.ped-t') }).getByRole('button', { name: 'Próxima ›' });
  await expect(pager).toBeVisible();
  await pager.click();
  const faixa = page.locator('.card', { has: page.locator('.ped-t') }).locator('text=/\\d+–\\d+ de \\d+/').first();
  const antes = await faixa.innerText();
  expect(antes).not.toMatch(/^1–/);
  // adiciona o primeiro produto da 2ª página que tem o ＋
  const mais = page.locator('.ped-t tbody .ped-ab.poe').first();
  const nome = (await mais.locator('xpath=ancestor::tr').locator('td').first().innerText()).match(/cód\. \S+/)[0];
  await mais.click();
  await expect(page.locator('.ped-t tbody tr', { hasText: nome }).first().locator('.ped-ab.tira')).toBeVisible();
  expect(await faixa.innerText(), 'continua na mesma página').toBe(antes);
  // numa aba de onde a linha sai ("Ficou de fora" ou "Resto do catálogo"): ela fica, marcada, até trocar de aba
  for (const rot of [/^Ficou de fora \(/, /^Resto do catálogo \(/]) {
    await aba(page, rot).click();
    if (await page.locator('.ped-t tbody .ped-ab.poe').count()) break;
  }
  const b = page.locator('.ped-t tbody .ped-ab.poe').first();
  const tr = b.locator('xpath=ancestor::tr');
  const prod = (await tr.locator('td').first().innerText()).match(/cód\. \S+/)[0]; // o código identifica a linha
  await b.click();
  const ficou = page.locator('.ped-t tbody tr', { has: page.locator('.ped-ficou') });
  await expect(ficou).toHaveCount(1);
  await expect(ficou).toContainText(prod);
  await expect(ficou.locator('.ped-ficou')).toContainText('foi para "No pedido"');
  await page.waitForTimeout(700); // não some sozinha depois
  await expect(ficou).toHaveCount(1);
  // trocou de aba e voltou: aí sim ela não está mais aqui; está em "No pedido"
  await aba(page, /^No pedido \(/).click();
  await expect(page.locator('.ped-t tbody tr', { hasText: prod }).first()).toBeVisible();
  await expect(page.locator('.ped-ficou')).toHaveCount(0);
  expect(erros).toEqual([]);
});
