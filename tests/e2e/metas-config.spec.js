// META-CFG-01: Configurações → loja → Metas em tabela por ano (meta, de onde vem, vendas da meta e % atingido).
const { test, expect } = require('./_base');

test('META-CFG-01: metas numa tabela por ano, com o vendido e o % da mesma conta da Evolução mensal', async ({ page }) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#config'; });
  await page.locator('table.cfg-lojas-t .cfg-abrir').first().click();
  await page.locator('.cfg-loja .cfg-sub a', { hasText: 'Metas e Comissão' }).evaluate((a) => a.click());
  const t = page.locator('table.cfg-metas-t');
  await expect(t).toBeVisible();
  // um botão por ano, o ano de agora marcado
  const anoAtual = await page.evaluate(() => String(new Date().getFullYear()));
  await expect(page.locator('.cfg-metas-ano.on')).toHaveText(anoAtual);
  // o mês com venda mostra o % igual ao da Evolução mensal
  const ym = await page.evaluate(() => TS.dayToIso(TS.db.maxDay).slice(0, 7));
  const linha = t.locator(`tr[data-ym="${ym}"]`);
  await expect(linha).toBeVisible();
  const pct = await page.evaluate((y) => { const m = TS.metaMes(y); return m && m.pct; }, ym);
  if (pct != null) {
    const txt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(pct * 100) + '%';
    await expect(linha.locator('.cfg-metas-at b')).toHaveText(txt);
  }
  // digitar a meta muda a origem para "digitada" e o % ao sair do campo
  const campo = linha.locator('input');
  await campo.fill('1000');
  await campo.blur();
  await expect(t.locator(`tr[data-ym="${ym}"]`).locator('.cfg-metas-et.dig')).toBeVisible();
  await t.locator(`tr[data-ym="${ym}"]`).getByRole('button', { name: /usar a/ }).click();
  await expect(t.locator(`tr[data-ym="${ym}"]`).locator('.cfg-metas-et.dig')).toHaveCount(0);
  // anos anteriores: a tabela troca
  const anos = await page.locator('.cfg-metas-ano').allTextContents();
  if (anos.length > 1) {
    await page.locator('.cfg-metas-ano', { hasText: anos[0] }).click();
    await expect(t.locator('tbody tr').first()).toHaveAttribute('data-ym', new RegExp('^' + anos[0]));
  }
  await expect(t.locator('tfoot')).toContainText('Total');
  const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(d).toBeLessThanOrEqual(1);
  expect(erros).toEqual([]);
});
