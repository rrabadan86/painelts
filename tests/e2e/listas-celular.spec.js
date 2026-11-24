const { test, expect } = require('./_base');

// LMOB-01…02 (padrão de listas no celular, aprovado pelo dono em 24/11/2026): no celular, Resumo por vendedor, Comparativos
// (Evolução mensal) e Campanhas → Não enviadas são linhas com divisória (nome + o número que decide; o resto pequeno embaixo),
// não cartões de "rótulo: valor". No computador as tabelas continuam iguais.
const abrir = async (page) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
};
const semRolarDeLado = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);

test('LMOB-01: Resumo → Desempenho por vendedor em linhas no celular (tabela no computador)', async ({ page }, info) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  await page.evaluate(() => { location.hash = '#resumo'; });
  const card = page.locator('#rs-vend');
  await expect(card).toBeVisible();
  if (info.project.name === 'celular') {
    await expect(card.locator('.lmob-it').first()).toBeVisible();
    await expect(card.locator('table')).toHaveCount(0);
    const l = card.locator('.lmob-it').first();
    await expect(l.locator('.lmob-val')).toContainText('R$');
    await expect(l.locator('.lmob-l2').first()).toContainText(/cupons? · |TKM/);
    await expect(l.locator('.lmob-nome')).not.toHaveText(/^[A-ZÀ-Ú ]{6,}$/); // nome com só a 1ª letra maiúscula
  } else {
    await expect(card.locator('table.t')).toBeVisible();
    await expect(card.locator('.lmob')).toHaveCount(0);
  }
  await semRolarDeLado(page);
  expect(erros).toEqual([]);
});

test('LMOB-02: Comparativos → Evolução mensal: uma linha por mês; tocar abre os indicadores e as vendedoras', async ({ page }, info) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  await page.evaluate(() => { location.hash = '#comparativos'; });
  const evol = page.locator('#cp-evol');
  await expect(evol).toBeVisible();
  if (info.project.name !== 'celular') { await expect(evol.locator('table.tree')).toBeVisible(); return; }
  const mes = evol.locator('.evm-mes').first();
  await expect(mes.locator('.lmob-val')).toContainText('R$');
  await expect(mes.locator('.evm-mini')).toHaveCount(0);
  await mes.click();
  await expect(evol.locator('.evm-mes').first().locator('.evm-mini')).toContainText('TKM');
  await expect(evol.locator('.evm-mes').first().locator('.evm-sub').first()).toContainText(/cupons?/);
  await expect(evol.locator('.lmob-total')).toContainText('Total do período');
  await semRolarDeLado(page);
  expect(erros).toEqual([]);
});

test('LMOB-01: Campanhas → Não enviadas em linhas no celular, com o motivo à direita e as ações como links', async ({ page }, info) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  await page.evaluate(() => { TS.state.cpVisao = 'naoenv'; location.hash = '#campanhas'; });
  const box = page.locator('.cp-ne');
  if (info.project.name !== 'celular') { await expect(box.locator('table.t')).toBeVisible(); return; }
  const l = box.locator('.lmob-it').first();
  await expect(l).toBeVisible();
  await expect(l.locator('.lmob-l1 .etq-prazo').first()).toBeVisible();
  await expect(l.locator('.lmob-acoes')).toContainText('Ver cliente');
  await semRolarDeLado(page);
  expect(erros).toEqual([]);
});
