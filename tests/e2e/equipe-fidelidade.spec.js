const { test, expect } = require('@playwright/test');

// Rendimento da equipe (venda por hora trabalhada + ficha de cada pessoa) e retorno do programa de fidelidade, na apresentação
const TEXTO_RUIM = /(^|[\s>(\d])(null|undefined|NaN|\[object Object\])(?=$|[\s<).,])/m;
async function abrir(page, hash) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.equipe && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate((h) => { location.hash = '#' + h; }, hash);
}
async function semSobra(page, info) {
  if (info.project.name !== 'celular') return;
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'página mais larga que a tela do celular').toBeLessThanOrEqual(1);
}

test('Rendimento da equipe: venda por hora, por horário e a ficha com a evolução mês a mês', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page, 'mapa');
  await page.getByRole('tab', { name: 'Rendimento da equipe' }).click();
  const aba = page.locator('.mapa-aba');
  await expect(aba.locator('.kpi').first()).toContainText('Venda por hora trabalhada');
  // a escala da apresentação tem as vendedoras fixas da loja: o quadro traz um valor em R$ por hora
  await expect(aba.locator('.kpi').first().locator('.kpi-value')).toContainText('R$');
  await expect(aba.getByRole('button', { name: /Ficha da equipe \(\d+\)/ })).toBeVisible();
  const linhas = aba.locator('.eq-t tbody tr');
  await expect(linhas.first()).toBeVisible();
  // quem está na escala tem R$ por hora; quem não está fica em "—" com a etiqueta (nunca um número inventado)
  const ficha = await page.evaluate(() => {
    const X = TS.equipe.calc, st = TS.state;
    return { vis: st.eqVis || 'ficha', pessoas: TS.pessoasEquipe(st.mapaOp.op.equipe).map((p) => p.nome), calc: Object.keys(X).length };
  });
  expect(ficha.pessoas.length).toBeGreaterThan(0);
  await expect(aba.locator('.eq-t')).toContainText('fora da escala');
  await expect(aba.locator('.eq-t')).toContainText('Lucro gerado'); // a apresentação entra como administrador (vê custo)
  expect(await aba.innerText()).not.toMatch(TEXTO_RUIM);
  await semSobra(page, info);

  // por horário: clicar no quadro troca a visão
  await aba.locator('.kpi', { hasText: 'Horário que mais rende' }).click();
  await expect(aba.locator('.eq-t')).toContainText('R$ por hora de pessoa');
  await expect(aba.locator('.eq-t tbody tr').first()).toContainText(/\d{2}h–\d{2}h/);
  await aba.getByRole('button', { name: 'Por dia da semana (7)' }).click();
  await expect(aba.locator('.eq-t tbody tr')).toHaveCount(7);
  expect(await aba.innerText()).not.toMatch(TEXTO_RUIM);
  await semSobra(page, info);

  // ficha → detalhe de uma pessoa da escala, com "‹ Voltar"
  await aba.getByRole('button', { name: /Ficha da equipe/ }).click();
  await aba.locator('.eq-t tbody tr', { hasText: ficha.pessoas[0] }).first().click();
  await expect(aba.getByRole('button', { name: '‹ Voltar para a equipe' })).toBeVisible();
  await expect(aba.locator('.card', { hasText: 'mês a mês' })).toBeVisible();
  await expect(aba.locator('.eq-t tbody tr').first()).toContainText('em andamento');
  expect(await aba.innerText()).not.toMatch(TEXTO_RUIM);
  await semSobra(page, info);
  await aba.getByRole('button', { name: '‹ Voltar para a equipe' }).click();
  await expect(aba.getByRole('button', { name: /Ficha da equipe \(\d+\)/ })).toBeVisible();
  expect(erros).toEqual([]);
});

test('Rendimento da equipe: a vendedora não tem a aba', async ({ page }) => {
  await abrir(page, 'mapa');
  await expect(page.getByRole('tab', { name: 'Rendimento da equipe' })).toBeVisible();
  // mesmo que alguém force o perfil na tela, a aba some e a parte da gestão se recusa a desenhar
  await page.evaluate(() => { TS.eu.perfil = 'vendedor'; TS.state.mapaAba = 'rendimento'; TS.render(); });
  await expect(page.getByRole('tab', { name: 'Rendimento da equipe' })).toHaveCount(0);
  await expect(page.locator('.eq-t')).toHaveCount(0);
  const recusa = await page.evaluate(() => { const d = document.createElement('div'); TS.equipe.render(d, { salva: true, pessoas: () => [], turnos: () => [] }); return d.textContent; });
  expect(recusa).toContain('só para a gestão');
});

test('Fidelidade: retorno do programa (programa × fora, resgatou × não, antes × depois)', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page, 'clientes');
  const bloco = page.locator('.fidret-bloco');
  await expect(bloco).toBeVisible({ timeout: 30000 });
  await expect(bloco.locator('.kpi')).toHaveCount(4);
  await expect(bloco.locator('.kpi').first()).toContainText('Cliente do programa gasta');
  const card = bloco.locator('.fidret');
  await expect(card.locator('tbody tr')).toHaveCount(2);
  await expect(card).toContainText('No programa de fidelidade');
  // nenhum CPF listado: só grupos
  expect(await bloco.innerText()).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}|\b\d{11}\b/);
  await bloco.locator('.kpi', { hasText: 'Quem resgatou voltou' }).click();
  await expect(page.locator('.fidret')).toContainText('Compraram na janela');
  await expect(page.locator('.fidret tbody tr').first()).toContainText('Resgatou');
  await page.locator('.fidret').getByRole('button', { name: /Antes × depois do 1º resgate/ }).click();
  await expect(page.locator('.fidret tbody tr').first()).toContainText('90 dias antes do 1º resgate');
  // o custo dos prêmios termina de calcular (ou explica por que não tem número)
  await expect(page.locator('.fidret-bloco .kpi', { hasText: 'Prêmios × venda a mais' }).locator('.kpi-foot')).not.toContainText('calculando');
  await page.locator('.fidret summary').click();
  await expect(page.locator('.fidret .rs-conta')).toContainText('É correlação, não prova.');
  expect(await page.locator('.fidret-bloco').innerText()).not.toMatch(TEXTO_RUIM);
  await semSobra(page, info);
  expect(erros).toEqual([]);
});
