const { test, expect } = require('@playwright/test');
const path = require('path');

// Resultado → A pagar (calendário de vencimentos com previsão de entrada) e "Exportar para o contador" (planilha do mês fechado).
const abrir = async (page) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#dre'; });
  await expect(page.locator('.dre-abas')).toBeVisible({ timeout: 20000 });
};
const print = async (page, nome) => { if (process.env.PRINTS_DIR) await page.screenshot({ path: path.join(process.env.PRINTS_DIR, nome), fullPage: true }); };

test('Resultado → A pagar: quadros, saldo por semana, lista com abas e marcar como pago', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  await page.locator('.dre-abas').getByRole('button', { name: 'A pagar' }).click();
  await expect(page.locator('.dre-abas').getByRole('button', { name: 'A pagar' })).toHaveClass(/on/);

  // quadros e a frase "não é contabilidade"
  // redesenho de 22/11: cartão-herói (saldo previsto decide; a pagar com a linha dos vencidos; entrada prevista)
  const kPagar = page.locator('.ap-heroi .heroi-col', { hasText: 'A pagar · próximos 30 dias' });
  await expect(kPagar.locator('.heroi-num')).toContainText('R$');
  await expect(kPagar.locator('.ap-h-pagar')).toContainText(/\d+ contas?/);
  await expect(page.locator('.ap-heroi .heroi-col', { hasText: 'Entrada prevista · 30 dias' }).locator('.heroi-num')).toContainText('R$');
  await expect(page.locator('.ap-heroi .heroi-col', { hasText: 'Saldo previsto em' }).locator('.heroi-num')).toContainText('R$');
  await expect(page.locator('.ap-h-venc')).toContainText('Vencidos sem baixa');
  await expect(page.locator('#content')).toContainText('Não é contabilidade');

  // saldo por semana: uma linha por semana, com entrada, saída e acumulado
  const semanas = page.locator('.ap-semanas');
  await expect(semanas).toContainText('Saldo acumulado');
  expect(await semanas.locator('tbody tr').count()).toBeGreaterThanOrEqual(4);

  // a conta bate com as funções puras: o quadro mostra a soma do que está "a pagar"
  const conta = await page.evaluate(async () => {
    const M = await TS.custosLoja();
    const e = await TS.estoqueBuscar(TS.state.loja);
    const notas = await (await fetch(TS.api('estoque/notas?loja=' + TS.state.loja))).json();
    const R = TS.aPagar.montar(M, { e, notas: notas.notas, extra: { pagos: {}, cartao: { pct: 0.73, dias: 60 } } }, 30);
    return { n: R.tot.nAPagar, origens: [...new Set(R.itens.map((x) => x.origem))], estimadas: R.itens.filter((x) => x.origem === 'nota').every((x) => x.estimado), sems: R.sems.length, entra: R.entTotal };
  });
  expect(conta.n).toBeGreaterThan(0);
  expect(conta.origens).toEqual(expect.arrayContaining(['fixo', 'royalties']));
  expect(conta.estimadas).toBe(true);
  expect(conta.entra).toBeGreaterThan(0);
  await expect(kPagar.locator('.ap-h-pagar')).toContainText(new RegExp(`^${conta.n} contas?`));

  // lista: abas com contagem; marcar como pago passa a conta para "Pagos" (na apresentação fica só na página)
  const lista = page.locator('.ap-vence');
  const abaAbertos = lista.getByRole('button', { name: /^A pagar \(\d+\)/ });
  await expect(abaAbertos).toHaveClass(/on/);
  const antes = +(await abaAbertos.textContent()).match(/\((\d+)\)/)[1];
  expect(antes).toBe(conta.n);
  await expect(lista).toContainText('Nota de compra');
  await print(page, `apagar-${info.project.name}.png`);
  await lista.getByRole('button', { name: 'Marcar pago' }).first().click();
  await expect(lista.getByRole('button', { name: /^A pagar \(\d+\)/ })).toContainText(`(${antes - 1})`);
  await expect(lista.getByRole('button', { name: /^Pagos \(\d+\)/ })).toContainText('(1)');
  await lista.getByRole('button', { name: /^Pagos \(\d+\)/ }).click();
  await expect(lista).toContainText(/pago em \d\d\/\d\d/);
  await lista.getByRole('button', { name: 'Desfazer' }).first().click();
  await expect(lista.getByRole('button', { name: /^Pagos \(\d+\)/ })).toContainText('(0)');

  // a linha "Vencidos sem baixa" do herói marca a aba dele
  await page.locator('.ap-h-venc').click();
  await expect(lista.getByRole('button', { name: /^Vencidos sem baixa \(\d+\)/ })).toHaveClass(/on/);

  // 60 dias: os quadros e as semanas acompanham
  await page.getByRole('button', { name: 'Próximos 60 dias' }).click();
  await expect(page.locator('.ap-heroi .heroi-col', { hasText: 'A pagar · próximos 60 dias' })).toBeVisible();
  expect(await page.locator('.ap-semanas').locator('tbody tr').count()).toBeGreaterThanOrEqual(8);

  // o atalho abre os custos da loja com o dia de vencimento de cada custo e os prazos do caixa a pagar
  await page.getByRole('link', { name: 'Ajustar dias de vencimento, prazo das notas e do cartão' }).click();
  const popup = page.locator('.camada-custos');
  await expect(popup).toContainText('Caixa a pagar (Resultado → A pagar)');
  await expect(popup).toContainText('Prazo das notas de compra');
  await expect(popup).toContainText('Dias para receber do cartão');
  await expect(popup.locator('th', { hasText: 'Vence no dia' })).toHaveCount(2);
  await expect(popup.locator('input.est-dia').first()).toHaveValue(/^(5|10)$/);
  await print(page, `custos-${info.project.name}.png`);
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);

  // nada de "null/undefined/NaN" nem rolagem para o lado
  const txt = await page.locator('#content').innerText();
  expect(txt).not.toMatch(/\b(null|undefined|NaN)\b/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(erros).toEqual([]);
});

test('Resultado: "Exportar para o contador" baixa a planilha do mês fechado com as cinco abas', async ({ page }, info) => {
  await abrir(page);
  const botao = page.getByRole('button', { name: 'Exportar para o contador' });
  await expect(botao).toBeVisible();
  // o mês em andamento não exporta
  await expect(botao).toBeDisabled();
  const fechado = await page.locator('.dre-topo select option').evaluateAll((os) => (os.find((o) => !/andamento/.test(o.textContent)) || {}).value);
  expect(fechado).toMatch(/^\d{4}-\d{2}$/);
  await page.locator('.dre-topo select').selectOption(fechado);
  const botao2 = page.getByRole('button', { name: 'Exportar para o contador' });
  await expect(botao2).toBeEnabled();
  await print(page, `resultado-${info.project.name}.png`);
  const [baixou] = await Promise.all([page.waitForEvent('download'), botao2.click()]);
  expect(baixou.suggestedFilename()).toBe(`contador-${await page.evaluate(() => TS.state.loja)}-${fechado}.xlsx`);
  const arq = await baixou.path();
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arq);
  expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumo do mês', 'Vendas por dia', 'Notas de entrada', 'Notas de saída (NF-e)', 'Despesas']);
  const res = wb.getWorksheet('Resumo do mês');
  expect(res.getCell('A5').value).toBe('Faturamento');
  expect(res.getCell('B5').value).toBeGreaterThan(0);
  const linhas = []; res.eachRow((r) => linhas.push(String(r.getCell(1).value)));
  expect(linhas).toEqual(expect.arrayContaining(['= Receita líquida', '= Resultado do mês']));
  expect(wb.getWorksheet('Vendas por dia').getCell('D4').value).toBe('Cartão de crédito');
  expect(wb.getWorksheet('Vendas por dia').rowCount).toBeGreaterThan(20);
  expect(String(wb.getWorksheet('Despesas').getCell('A5').value)).not.toBe('Nada neste mês.');
});
