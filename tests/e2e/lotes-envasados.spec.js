const { test, expect } = require('./_base');

// Chás envasados e alimentação (decisão do dono, 23/11/2026): envasado em unidade (o AppNext manda "9,000 kg" = 9 pacotes),
// lote e validade também para envasados e alimentação (sem abertura), validades diferentes na mesma linha da nota e o aviso de
// validade curta que leva à devolução. E a pílula de situação do Início que abre os avisos de dados. Tudo na apresentação.
const abrir = async (page, hash) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  if (hash) await page.evaluate((h) => { location.hash = h; }, hash);
};
const semRolagemLado = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

test('UN-ENV-01: Estoque mostra o chá envasado em unidade ("9 un"), não em kg', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page, '#estoque');
  const card = page.locator('#est-tabela');
  await expect(card).toBeVisible({ timeout: 30000 });
  await card.locator('.est-busca').fill('Matcha Cerimonial 30G Pacote');
  const linha = card.locator('tbody tr', { hasText: 'Matcha Cerimonial 30G Pacote' }).first();
  await expect(linha).toBeVisible();
  await expect(linha).toContainText(/9 un/);
  await expect(linha).not.toContainText(/9,000 kg|9 kg/);
  await semRolagemLado(page);
  expect(erros).toEqual([]);
});

test('LOTE-ENV-01: Validade tem abas por tipo; Envasados mostra lote e validade em unidade, sem abertura', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page, '#validade');
  const abas = page.locator('.vl-abas button');
  await expect(abas).toHaveText([/Chá a granel \(\d+\)/, /Envasados \(\d+\)/, /Alimentação \(\d+\)/], { timeout: 30000 });
  await abas.nth(1).click();
  await expect(abas.nth(1)).toHaveClass(/on/);
  await expect(page.locator('.vl-resumo')).toContainText('Envasados');
  await page.locator('.vl-chip', { hasText: 'Todos' }).click();
  await page.locator('.vl-filtros input:not([type=checkbox])').first().fill('Matcha Cerimonial');
  const linhas = page.locator('.vl-lista-card tbody tr', { hasText: 'Matcha Cerimonial 30G Pacote' });
  await expect(linhas.first()).toBeVisible();
  // a busca redesenha a lista: espera o texto das linhas (lido cedo demais vinha vazio no celular)
  await expect.poll(async () => (await linhas.allInnerTexts()).join('\n')).toMatch(/\b[36] un\b/); // 9 pacotes: 6 da nota mais nova e 3 da mais antiga
  const txt = (await linhas.allInnerTexts()).join('\n');
  expect(txt).not.toMatch(/kg|na lata|aberto/);
  await expect(page.locator('.vl-lista-card .vl-ajustar')).toHaveCount(0); // "⚖ ajustar" é só do granel
  // Alimentação também tem lotes
  await page.locator('.vl-filtros input:not([type=checkbox])').first().fill('');
  await abas.nth(2).click();
  await page.locator('.vl-chip', { hasText: 'Todos' }).click();
  await expect(page.locator('.vl-lista-card tbody tr').first()).toContainText(/\d+ un/);
  await semRolagemLado(page);
  expect(erros).toEqual([]);
});

test('LOTE-ENV-02 e DEV-VAL-01: na nota de entrada, "+ outra validade" reparte a linha e a validade curta leva à devolução com o item', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  // a nota fictícia do Matcha Cerimonial 30G Pacote (envasado)
  const nf = await page.evaluate(async () => {
    const j = await (await fetch(`/api/demo/validade?loja=${encodeURIComponent(TS.state.loja)}`)).json();
    const l = j.outros.filter((x) => x.desc === 'Matcha Cerimonial 30G Pacote' && x.nf).sort((a, b) => b.qtdEntrada - a.qtdEntrada)[0];
    return l && l.nf;
  });
  expect(nf).toBeTruthy();
  await page.evaluate((x) => { TS.state.abrirNF = x; location.hash = '#notas'; }, nf);
  const gaveta = page.locator('.prc-drawer');
  await expect(gaveta).toBeVisible({ timeout: 30000 });
  const cel = gaveta.locator('.vl-nota-cel').filter({ has: page.locator('input.vl-lote') }).first();
  await expect(cel).toBeVisible();
  // validade curta: vence 10 dias depois da chegada (envasado: menos de 30 dias)
  const entrada = await page.evaluate(async (x) => { const j = await (await fetch(`/api/demo/validade/notas?loja=${encodeURIComponent(TS.state.loja)}&nota=${x}`)).json(); return j.notas[0].itens[0].entrada; }, nf);
  const curta = new Date(Date.parse(entrada + 'T12:00:00Z') + 10 * 864e5).toISOString().slice(0, 10);
  const val = cel.locator('input.vl-val').first();
  await val.fill(curta);
  await val.blur();
  const aviso = cel.locator('.vl-curta');
  await expect(aviso).toContainText('Validade curta (vence em');
  await expect(aviso).toContainText('menos de 30 dias da chegada');
  await expect(aviso).toContainText('inclua na incidência/devolução à franquia');
  // "+ outra validade": 2 com outra data → a 1ª fica com o resto
  await cel.locator('.vl-mais-val').click();
  const parte = cel.locator('.vl-parte').first();
  await parte.locator('.vl-parte-qtd').fill('2');
  await parte.locator('.vl-parte-qtd').blur();
  await parte.locator('.vl-parte-val').fill('2027-12-31');
  await parte.locator('.vl-parte-val').blur();
  await expect(cel.locator('.vl-primeira')).toContainText(/1ª validade \(acima\): 4 un de 6 un/);
  // "Incluir na devolução": abre a devolução desta nota com o item, a quantidade da parte e o motivo
  await cel.locator('.vl-curta .vl-dev-btn').first().click();
  const form = gaveta.locator('.dev-form');
  await expect(form).toBeVisible();
  const item = form.locator('.dev-item', { hasText: 'Matcha Cerimonial 30G Pacote' });
  await expect(item.locator('input[type=checkbox]')).toBeChecked();
  await expect(item.locator('input.dev-val')).toHaveValue('4');
  await expect(item.locator('input.dev-obs-val')).toHaveValue(/validade curta \(vence \d{2}\/\d{2}\/\d{4}\)/);
  await semRolagemLado(page);
  expect(erros).toEqual([]);
});

test('Início: a pílula "Vendas só até" é um botão que abre os avisos e leva ao grupo de dados', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  // vendas "atrasadas": hoje 3 dias depois da última venda da base
  await page.evaluate(() => { const m = TS.db.maxDay; TS.todayDay = () => m + 3; location.hash = '#inicio'; TS.render(); });
  const pil = page.locator('.ini-pilula button.pilula-sit');
  await expect(pil).toBeVisible({ timeout: 30000 });
  await expect(pil).toContainText('Vendas só até');
  await pil.click();
  await expect(page.locator('.ini-todos')).toBeVisible();
  await expect(page.locator('.ini-ver-todos')).toHaveAttribute('aria-expanded', 'true');
  const foco = await page.evaluate(() => { const a = document.activeElement; return a ? (a.dataset.area || a.className) : ''; });
  expect(foco).toMatch(/dados|ini-avisos-card/);
  expect(erros).toEqual([]);
});
