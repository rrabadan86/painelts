const { test, expect } = require('./_base');
const path = require('path');

// Resultado: valor real de um custo fixo num mês (pedido do dono, 23/11/2026). Na apresentação nada é gravado:
// a tela troca na memória. Clicar no valor abre a janela (campo + Salvar), o mês fica com ✎ e o total muda;
// "Voltar ao padrão" desfaz. O nome do custo abre o histórico mês a mês.
const abrir = async (page) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#dre'; });
  await expect(page.locator('.dre-abas')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.dre-t').first()).toBeVisible({ timeout: 20000 });
};
const print = async (page, nome) => { if (process.env.PRINTS_DIR) await page.screenshot({ path: path.join(process.env.PRINTS_DIR, nome), fullPage: true }); };
// o que a conta do Resultado dá para o mês (a mesma função da tela)
const conta = (page, ym) => page.evaluate(async (ym) => {
  const M = await TS.custosLoja();
  const m = TS.dreCalcular(M).find((x) => x.ym === ym);
  return { fixoTot: m.fixoTot, resultado: m.resultado, sistemas: m.fixosMes.find((x) => x.nome === 'Sistemas' && !x.pontual).valor };
}, ym);

test('DRE-MES-09: lançar o valor real de um custo fixo num mês marca ✎, muda o total e "Voltar ao padrão" desfaz', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  // abre a categoria Sistemas no quadro "Mês a mês"
  const mesAMes = page.locator('.card', { has: page.locator('.card-title, h2, h3', { hasText: /^Mês a mês/ }) }).last();
  await mesAMes.locator('tr.dre-grupo', { hasText: 'Sistemas' }).locator('td').first().click();
  const cel = mesAMes.locator('td.dre-edit[data-fixo="Sistemas"]').first();
  await expect(cel).toBeVisible();
  const ym = await cel.getAttribute('data-ym');
  const antes = await conta(page, ym);
  expect(antes.sistemas).toBe(650);
  await expect(cel).not.toContainText('✎');

  await cel.click();
  const jan = page.locator('.dre-fixo-jan');
  await expect(jan).toBeVisible();
  await expect(jan).toContainText('Sem valor lançado');
  // valor inválido não grava: janela "Não foi salvo"
  await jan.locator('.dre-fixo-campo').fill('abc');
  await jan.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.locator('.ts-perg-erro')).toContainText('Não foi salvo');
  await page.locator('.ts-perg-erro').getByRole('button', { name: 'Corrigir', exact: true }).click();
  await jan.locator('.dre-fixo-campo').fill('777,50');
  await jan.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(jan).toHaveCount(0);

  const celDepois = page.locator('.card', { has: page.locator('.card-title, h2, h3', { hasText: /^Mês a mês/ }) }).last().locator(`td.dre-edit[data-fixo="Sistemas"][data-ym="${ym}"]`);
  await expect(celDepois).toContainText('✎');
  await expect(celDepois).toHaveClass(/dre-lanc/);
  await expect(celDepois).toContainText('778');
  const depois = await conta(page, ym);
  expect(depois.sistemas).toBe(777.5);
  expect(Math.round((depois.fixoTot - antes.fixoTot) * 100) / 100).toBe(127.5);
  expect(Math.round((antes.resultado - depois.resultado) * 100) / 100).toBe(127.5);

  // histórico: o nome do custo abre a janela com o mês a mês e a média
  await page.locator('.card', { has: page.locator('.card-title, h2, h3', { hasText: /^Mês a mês/ }) }).last().locator('.dre-fixo-nome', { hasText: 'Sistemas' }).click();
  const hist = page.locator('.dre-fixo-jan');
  await expect(hist.locator('.dre-hist')).toContainText('Média');
  await expect(hist.locator('.dre-hist')).toContainText('✎ lançado');
  expect(await hist.locator('.dre-hist tbody tr').count()).toBeGreaterThanOrEqual(2);
  if (process.env.PRINTS_DIR) await page.screenshot({ path: path.join(process.env.PRINTS_DIR, `dre-mes-historico-${info.project.name}.png`) }); // a janela por cima da tela
  await hist.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(hist).toHaveCount(0);
  await celDepois.scrollIntoViewIfNeeded();
  await print(page, `dre-mes-editado-${info.project.name}.png`);
  if (process.env.PRINTS_DIR) await page.locator('.card', { has: page.locator('.card-title', { hasText: /^Mês a mês/ }) }).last().screenshot({ path: path.join(process.env.PRINTS_DIR, `dre-mes-editado-quadro-${info.project.name}.png`) });

  // voltar ao padrão
  await celDepois.click();
  await expect(page.locator('.dre-fixo-jan')).toContainText('Valor real lançado');
  await page.locator('.dre-fixo-jan').getByRole('button', { name: 'Voltar ao padrão', exact: true }).click();
  await expect(page.locator('.dre-fixo-jan')).toHaveCount(0);
  await expect(page.locator(`td.dre-edit[data-fixo="Sistemas"][data-ym="${ym}"]`).first()).not.toContainText('✎');
  const volta = await conta(page, ym);
  expect(volta.sistemas).toBe(650);
  expect(volta.fixoTot).toBe(antes.fixoTot);
  expect(erros).toEqual([]);
});
