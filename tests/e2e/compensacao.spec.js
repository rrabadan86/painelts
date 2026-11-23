// Créditos com a franquia: marcar a devolução como compensada em nota fiscal de entrada (escolhendo a nota)
// ou nos royalties (escolhendo o mês numa lista de 12). Na apresentação: a rota só confere e a tela troca na memória.
const { test, expect } = require('./_base');

const abrirCreditos = async (page) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#creditos'; });
  await page.locator('.seg button', { hasText: 'Todas' }).first().click();
};
const linhaDev = (page, num) => page.locator('.cf-tab tr', { hasText: `NF-e ${num}` }).first();
const menuDa = async (page, num, opcao) => {
  await linhaDev(page, num).locator('.cf-mais').click();
  await page.locator('.cf-menu-lista:visible button', { hasText: opcao }).click();
};
/** nada da janela rola para o lado (computador e celular) */
const semRolarDeLado = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(`${s}, ${s} *`)].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible' && !e.closest('.seg')).map((e) => e.className || e.tagName), sel);

test('FRQ-COMP-01: compensada em nota fiscal de entrada — procura a nota, escolhe e a devolução fica "na NF x"', async ({ page }) => {
  await abrirCreditos(page);
  await expect(linhaDev(page, 540)).toContainText('A confirmar'); // a única da apresentação ainda sem compensação (sugerida na NF 19180)
  // o menu não tem mais "no boleto"
  await linhaDev(page, 540).locator('.cf-mais').click();
  await expect(page.locator('.cf-menu-lista:visible')).not.toContainText('boleto');
  await page.locator('.cf-menu-lista:visible button', { hasText: 'Compensada em nota fiscal de entrada' }).click();
  const jan = page.locator('.cfn');
  await expect(jan).toBeVisible();
  await expect(jan).toContainText('Em qual nota de entrada a NF-e 540 foi descontada?');
  // abre nas notas da franquia, as mais recentes primeiro
  await expect(jan.locator('.seg button.on, .seg button[aria-pressed="true"]').first()).toContainText('Da franquia');
  await expect(jan.locator('tbody tr').first()).toContainText('NF 19210');
  await expect(jan).not.toContainText('EMBALAGENS EXEMPLO');
  expect(await semRolarDeLado(page, '.cfn')).toEqual([]);
  // busca pelo número
  await jan.locator('.tab-busca').fill('19180');
  await expect(jan.locator('tbody tr')).toHaveCount(1);
  const ok = jan.getByRole('button', { name: 'Marcar compensada' });
  await expect(ok).toBeDisabled();
  await jan.locator('tbody tr').first().getByRole('button', { name: 'Escolher' }).click();
  await expect(jan.locator('.cfn-escolha')).toContainText('NF 19180');
  await ok.click();
  await expect(jan).toHaveCount(0);
  await expect(linhaDev(page, 540)).toContainText('Compensado (confirmado)');
  await expect(linhaDev(page, 540)).toContainText('na NF 19180');
});

test('FRQ-COMP-01: a nota não está no painel — digita o número da NF; número inválido abre "Não foi salvo"', async ({ page }) => {
  await abrirCreditos(page);
  await menuDa(page, 540, 'Compensada em nota fiscal de entrada');
  const jan = page.locator('.cfn');
  await jan.locator('.cfn-digitar summary').click();
  const nf = jan.getByLabel('Número da NF de entrada');
  await nf.fill('sem número');
  await jan.getByRole('button', { name: 'Marcar compensada' }).click();
  await expect(page.locator('.ts-perg-erro')).toContainText('Não foi salvo');
  await page.locator('.ts-perg-erro').getByRole('button', { name: 'Corrigir' }).click();
  await expect(nf).toHaveAttribute('aria-invalid', 'true');
  await nf.fill('20555');
  await jan.getByRole('button', { name: 'Marcar compensada' }).click();
  await expect(jan).toHaveCount(0);
  await expect(linhaDev(page, 540)).toContainText('na NF 20555');
});

test('FRQ-COMP-02: compensada nos royalties — escolhe o mês numa lista dos últimos 12 meses', async ({ page }) => {
  await abrirCreditos(page);
  await menuDa(page, 540, 'Compensada nos royalties');
  const jan = page.locator('.ts-conf');
  await expect(jan).toBeVisible();
  const sel = jan.getByLabel('Mês de referência dos royalties');
  const opcoes = await sel.locator('option').allTextContents();
  expect(opcoes).toHaveLength(12);
  const M = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const hoje = await page.evaluate(() => TS.hojeSP());
  expect(opcoes[0]).toBe(`${M[+hoje.slice(5, 7) - 1]}/${hoje.slice(0, 4)} (este mês)`);
  for (const o of opcoes) expect(o).toMatch(/^[a-z]{3}\/\d{4}/);
  expect(await semRolarDeLado(page, '.ts-conf')).toEqual([]);
  const valor = await sel.locator('option').nth(2).getAttribute('value');
  await sel.selectOption(valor);
  await jan.getByRole('button', { name: 'Marcar compensada' }).click();
  await expect(jan).toHaveCount(0);
  await expect(linhaDev(page, 540)).toContainText(`nos royalties de ${M[+valor.slice(5, 7) - 1]}/${valor.slice(0, 4)}`);
  // os números do topo acompanham: a 540 saiu de "a confirmar"
  await expect(page.locator('.heroi')).toContainText('a confirmar: R$ 0,00');
});
