const { test, expect } = require('./_base');
// Banco de horas dos feriados (decisão do dono, 26/11/2026): aba em Movimento e escala, acerto no cartão de feriados,
// regras em Equipe e regras e as linhas do e-mail do fechamento. Na apresentação nada é gravado.

async function abrir(page, hash) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.bancoHoras);
  await page.evaluate((h) => { TS.state.loja = TS.db.metas[0].id; location.hash = h; }, hash);
  await page.waitForFunction(() => !document.querySelector('main .loading .spinner') && document.querySelector('main h1'));
}

test('BANCO-08: aba Banco de horas — lançamento entra no saldo e no extrato; regras em Equipe e regras', async ({ page }) => {
  await abrir(page, '#mapa');
  await page.getByRole('tab', { name: 'Banco de horas' }).click();
  await expect(page.locator('.heroi')).toContainText('Saldo da equipe');
  await page.locator('[data-bh=novo]').click();
  await page.fill('#bh-horas', '2:30');
  await page.fill('#bh-motivo', 'Saiu mais cedo');
  await page.locator('[data-bh=form] .btn.primary').click();
  await expect(page.locator('.bh-ext')).toContainText('Saiu mais cedo');
  await expect(page.locator('.bh-ext')).toContainText('−2h30');
  await expect(page.locator('.heroi')).toContainText('−2h30');
  await page.getByRole('tab', { name: 'Equipe e regras' }).click();
  const regras = page.locator('[data-bh=regras]');
  await expect(regras).toContainText('Banco de horas (×2)');
  await expect(regras).toContainText('12 meses');
});

test('BANCO-09: cartão de feriados com o acerto — banco e pago em dobro, tocar no selo troca só para a pessoa', async ({ page }) => {
  await abrir(page, '#comissionamento');
  await page.evaluate(() => { const d = TS.isoToDay(TS.hojeSP().slice(0, 8) + '01'); TS.state.f.de = d; TS.state.f.ate = TS.db.maxDay; TS.render(); });
  const card = page.locator('.feriados-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.linha-acerto')).toContainText('Acerto');
  const inp = card.locator('input.hora-in').first();
  await inp.fill('6:00'); await inp.press('Tab');
  const selo = card.locator('.bh-selo').first();
  await expect(selo).toHaveText(/banco \+12h00/);
  await selo.click();
  await expect(card.locator('.bh-selo').first()).toHaveText(/pagar 12h00/); // pago também vale o dobro (decisão do dono)
});

test('BANCO-10: e-mail do fechamento mostra o destino do feriado, o que pagar e o saldo do banco', async ({ page }) => {
  await abrir(page, '#inicio');
  const html = await page.evaluate(() => TS.emailContabilidade({ loja: 'Loja', ym: '2026-12', mensagem: '', dados: {
    rg: {}, gorj: new Map(), linhas: [{ vendedor: 'ANA', aPagar: 100, premiacao: 0 }, { vendedor: 'BIA', aPagar: 50, premiacao: 0 }], totalDe: (r) => r.aPagar,
    ferDe: (v) => (v === 'ANA' ? [{ data: '2026-12-08', min: 360, acerto: 'banco' }] : [{ data: '2026-12-08', min: 360, acerto: 'pagar' }]), temFeriado: true, comBanco: true,
    minPagar: (v) => (v === 'ANA' ? 0 : 720), bancoMes: (v) => (v === 'ANA' ? { inicio: -1200, entrou: 720, saiu: 0, venceu: 0, fim: -480 } : { inicio: 0, entrou: 0, saiu: 0, venceu: 0, fim: 0 }) } }));
  expect(html).toContain('08/12 (6h00) → banco');
  expect(html).toContain('08/12 (6h00) → pagar');
  expect(html).toContain('−8h00 (devendo)');
  expect(html).toContain('era −20h00');
  expect(html).toContain('Horas de feriado a pagar');
  expect(html).toContain('12h00 (BIA)');
  expect(html).toContain('Feriados a pagar (em dobro)');
});

test('BANCO-03 (tela): escala — "Folga pelo banco de horas" marca o dia e entra no banco (desconta a jornada)', async ({ page }) => {
  await abrir(page, '#mapa');
  await page.getByRole('tab', { name: 'Escala do mês' }).click();
  const cel = page.locator('td.trab.clicavel, .escm-p.clicavel:not(:has(.escm-h.folga))').first();
  await cel.click();
  const ed = page.locator('.aj-editor');
  await ed.locator('select').first().selectOption('banco');
  await expect(ed.locator('.aj-vale')).toBeHidden();
  await ed.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.locator('td.bh-folga, .escm-h.folga').filter({ hasText: 'Folga (banco)' }).first()).toBeVisible();
  // a conta do banco lê o ajuste (mesmo sem salvar, na memória da tela) depois de salvo; aqui conferimos a conta direto
  const saldo = await page.evaluate(() => {
    const cfg = { ...TS.db.metas[0], escalaAjustes: { [TS.hojeSP().slice(0, 7)]: { [TS.hojeSP()]: { ANA: { tipo: 'folga', banco: true } } } } };
    return TS.bancoHoras.daLoja(cfg).pessoas.get('ANA').saldo === -TS.bancoHoras.jornadaMin(cfg);
  });
  expect(saldo).toBe(true);
});
