// Produtos → Site, filtro "Mudou em" (pedido do dono, 23/11/2026): "Hoje" mostra só os produtos que mudaram hoje, com a
// mudança do dia; um dia sem consulta diz isso (não "nenhuma mudança"); "Qualquer dia" volta à lista inteira.
// A apresentação tem mudanças hoje, ontem, há 3, 4 e 12 dias e fica sem consulta há 6 e 7 dias (site.js, demoHistorico).
const { test, expect, escolherOpcao, nomesOpcoes } = require('./_base');

async function abrirSite(page) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#site'; });
  await expect(page.locator('.site-dia')).toBeVisible({ timeout: 30000 });
}
// as abas da lista: no computador, a faixa de botões; no celular, o botão da folha de opções (FOLHA-01)
const ehFolha = async (page) => (await page.locator('main .seg-folha').count()) > 0;
const abaClicar = async (page, nome) => { if (await ehFolha(page)) await escolherOpcao(page, null, nome); else await page.locator('.card .seg').first().locator('button', { hasText: nome }).click(); };
const numAba = async (page, nome) => {
  const t = (await ehFolha(page)) ? (await nomesOpcoes(page, null)).find((x) => x.startsWith(nome)) : await page.locator('.card .seg').first().locator('button', { hasText: nome }).textContent();
  return +(((t || '').match(/\(([\d.]+)\)/) || [])[1] || '').replace(/\./g, '');
};
const LISTA = '.site-t, .site-t-lmob'; // tabela no computador, linhas no celular (LMOB-04)

test('SITE-DATA-05: "Hoje" filtra a tabela, conta nas abas e mostra a mudança do dia; "Qualquer dia" restaura', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrirSite(page);
  const filtro = page.locator('.site-dia');
  await expect(filtro).toContainText('Mudou em');
  await expect(filtro.locator('.seg button.on')).toHaveText('Qualquer dia');
  const total = await numAba(page, 'Todos');
  expect(total).toBeGreaterThan(5);

  await filtro.getByRole('button', { name: 'Hoje' }).click();
  await expect(filtro.locator('.seg button.on')).toHaveText('Hoje');
  const hoje = await page.evaluate(() => TS.hojeSP());
  await expect(filtro.locator('input[type=date]')).toHaveValue(hoje);
  const nHoje = await numAba(page, 'Todos');
  expect(nHoje).toBeGreaterThan(0);
  expect(nHoje).toBeLessThan(total);
  // a coluna passa a ser a mudança do dia, com o "de → para"
  const dd = hoje.slice(8, 10) + '/' + hoje.slice(5, 7);
  await expect(page.locator(LISTA).first()).toContainText(`Mudança em ${dd}`);
  await expect(page.locator(LISTA).first().locator('.site-dia-mud').first()).toContainText(/→|Esgotou|Voltou|Entrou|Saiu/);
  // sem rolagem para o lado (no computador também a 1100 px, com a letra mais larga do servidor)
  const rola = () => page.evaluate(() => [...document.querySelectorAll('main .table-wrap, main .site-busca, main .card')].filter((e) => e.scrollWidth - e.clientWidth > 2).length);
  expect(await rola()).toBe(0);
  if ((page.viewportSize() || {}).width > 900) {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.addStyleTag({ content: '* { letter-spacing: 1.2px }' });
    expect(await rola()).toBe(0);
    await page.setViewportSize({ width: 1366, height: 900 });
  }
  // as abas valem junto: a soma das abas do dia nunca passa do total do dia
  expect(await numAba(page, 'Preço diferente')).toBeLessThanOrEqual(nHoje);
  // o filtro fica durante a visita (trocar de aba não perde o dia)
  await abaClicar(page, 'Preço diferente');
  await expect(filtro.locator('.seg button.on')).toHaveText('Hoje');
  await abaClicar(page, 'Todos');

  await page.locator('.site-dia').getByRole('button', { name: 'Qualquer dia' }).click();
  await expect(page.locator('.site-dia input[type=date]')).toHaveValue('');
  expect(await numAba(page, 'Todos')).toBe(total);
  await expect(page.locator(LISTA).first()).toContainText('Última mudança no site');
  expect(erros).toEqual([]);
});

test('SITE-DATA-06: dia sem consulta diz "sem consulta do site neste dia"; dia consultado sem mudança diz "nenhuma mudança"', async ({ page }) => {
  await abrirSite(page);
  const [semConsulta, semMudanca] = await page.evaluate(() => {
    const SD = TS.siteDia; let d = TS.hojeSP(); const out = [];
    for (let k = 1; k <= 6; k++) { d = SD.diaAntes(d); if (k === 2) out[1] = d; if (k === 6) out[0] = d; }
    return out;
  });
  const data = page.locator('.site-dia input[type=date]');
  await data.fill(semConsulta);
  await data.press('Enter');
  await expect(page.locator('.t-vazio').first()).toContainText('Sem consulta do site neste dia');
  expect(await numAba(page, 'Todos')).toBe(0);
  await expect(page.locator('.site-dia .seg button.on')).toHaveCount(0);

  await page.locator('.site-dia input[type=date]').fill(semMudanca);
  await page.locator('.site-dia input[type=date]').press('Enter');
  await expect(page.locator('.t-vazio').first()).toContainText('Nenhuma mudança no site em');

  await page.locator('.site-dia').getByRole('button', { name: 'Ontem' }).click();
  expect(await numAba(page, 'Todos')).toBeGreaterThan(0);
});
