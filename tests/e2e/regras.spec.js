// Contas que já deram problema: saldo de pontos (sincronização + Logs), cupom ↔ nota fiscal, DANFE
const { test, expect } = require('@playwright/test');

test.describe('regras', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'computador', 'só no computador');
    await page.goto('/apresentacao');
    await page.waitForFunction(() => window.TS && TS.db && TS.fx);
  });

  test('saldo do FIXE = saldo sincronizado + movimentos dos Logs depois da leitura', async ({ page }) => {
    const r = await page.evaluate(() => {
      TS.db.fidelidade = [{ id: 't', regras: { validadeMeses: 12, minResgate: 6, prazoResgate: 90 }, nomes: ['Ana'], lojas: ['L1'], propria: [true], vendaLoja: null, em: '2026-11-17T01:00:00Z',
        membrosEm: '2026-10-01T12:00:00Z', membros: [['11111111111', null, 10]],
        saldosFixe: { em: '2026-11-10T20:17:00-03:00', s: [['11111111111', 34], ['22222222222', 5]] },
        ev: [['11111111111', 0, 0, '2026-11-05', 600, 'pontos', 3, ''], ['11111111111', 0, 0, '2026-11-10', 1200, 'pontos', 2, ''],
          ['11111111111', 0, 0, '2026-11-10', 1250, 'pontos', 4, ''], ['11111111111', 0, 0, '2026-11-12', 700, 'resgate', 6, '']] }];
      const x = TS.fx.preparar(), a = x.porCpf.get('11111111111'), c = x.porCpf.get('22222222222');
      return { saldo: a.saldo, lido: a.saldoFixeLido, depois: a.saldoFixeDepois, orig: a.saldoFixeOrigem, outro: c && c.saldo };
    });
    // 34 lidos às 20:17 do dia 10; depois: +4 (20:50) e −6 (dia 12). O +2 das 20:00 já estava nos 34.
    expect(r).toEqual({ saldo: 32, lido: 34, depois: -2, orig: 'sinc', outro: 5 });
  });

  test('cupom com NF-e do mesmo número (até 3 dias depois) vira "Nota fiscal" e abre a nota', async ({ page }) => {
    const cup = await page.evaluate(() => { const db = TS.db, i = db.n - 1; return { num: db.cupom[i], d: db.iso[i] }; });
    await page.route('**/api/demo/nfsaida?*', async (route) => {
      const res = await route.fetch(); const j = await res.json();
      const d = new Date(cup.d + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
      const dia = d.toISOString().slice(0, 10);
      Object.assign(j.notas[0], { numero: cup.num, data: dia, emissao: dia + 'T10:21:00-03:00' });
      await route.fulfill({ response: res, json: j });
    });
    await page.evaluate(() => { location.hash = '#cupons'; });
    await page.getByRole('button', { name: 'Abrir dias' }).click();
    const link = page.locator('.cupons-t button.cpf-link', { hasText: new RegExp('^' + cup.num + '$') });
    await expect(link).toBeVisible();
    await expect(page.locator('.cupons-t')).toContainText('Nota fiscal ' + cup.num);
    await link.click();
    await expect(page.locator('.prc-drawer')).toContainText('NF-e');
    expect(await page.locator('.prc-drawer').innerText(), 'texto "null" na nota').not.toMatch(/(^|\s)(null|undefined|NaN)(\s|$)/);
  });

  test('DANFE abre com o código de barras da chave', async ({ page, context }) => {
    await page.evaluate(() => { location.hash = '#nfsaida'; });
    const href = await page.locator('.nf-saida a', { hasText: 'DANFE' }).first().getAttribute('href');
    const d = await context.newPage();
    await d.goto(href);
    await expect(d.locator('text=DANFE').first()).toBeVisible();
    expect(await d.locator('svg.barras rect').count()).toBeGreaterThan(60);
  });

  test('Clientes: Lista só com a lista; Indicadores sem os segmentos', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#clilista'; });
    await expect(page.locator('main')).toContainText('Segmentos:');
    await expect(page.locator('main')).not.toContainText('Top 5 em faturamento');
    await page.evaluate(() => { location.hash = '#clientes'; });
    await expect(page.locator('main')).toContainText('Top 5 em faturamento');
    await expect(page.locator('main')).not.toContainText('Segmentos:');
  });

  test('Produtos por lucro: visão Resumo cabe sem rolar para o lado', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#rentab'; });
    const t = page.locator('.est-t-lucro');
    await expect(t).toBeVisible();
    await page.locator('.est-vis button', { hasText: 'Resumo' }).click();
    const [sw, cw] = await page.locator('.est-t-lucro').evaluate((el) => { const w = el.closest('.table-wrap'); return [w.scrollWidth, w.clientWidth]; });
    expect(sw - cw).toBeLessThanOrEqual(2);
  });

  test('Campanha: escolher mais de um produto exato e citar no {produto}', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#campanhas'; });
    await page.getByRole('button', { name: 'Criar campanha' }).click();
    const antes = await page.locator('.cp-contagem b').innerText();
    await page.locator('summary', { hasText: 'O que comprou' }).click();
    for (let k = 0; k < 2; k++) {
      await page.locator('.cp-prod-busca').fill('african');
      await page.locator('.cp-sug-it').first().dispatchEvent('mousedown');
    }
    await expect(page.locator('.cp-prod-chip')).toHaveCount(2);
    await expect(page.locator('.cp-sug')).not.toContainText('null');
    await expect.poll(async () => page.locator('.cp-contagem b').innerText()).not.toBe(antes);
    await page.locator('textarea.cp-msg').fill('Chegou {produto}!');
    await expect(page.locator('.cp-exemplo')).toContainText(/Chegou .+ e .+!/);
  });

  test('Lista de espera: abas, mensagem pronta e formulário com cliente e produto', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#espera'; });
    await expect(page.locator('.esp-abas')).toContainText('Chegaram · avisar');
    await expect(page.locator('.esp-item.esp-chegou').first()).toBeVisible();
    await expect(page.locator('.esp-item.esp-chegou textarea.esp-msg').first()).toHaveValue(/chegou/);
    await page.getByRole('button', { name: '+ Anotar pedido' }).click();
    await page.locator('.esp-form input[type=search]').first().fill('ana');
    await page.locator('.esp-form .cp-sug-it').first().dispatchEvent('mousedown');
    await expect(page.locator('.esp-cli-esc')).toBeVisible();
    await page.locator('.esp-form input[type=search]').nth(1).fill('african');
    await page.locator('.esp-sug-p .cp-sug-it').first().dispatchEvent('mousedown');
    await expect(page.locator('.esp-chip')).toHaveCount(1);
  });
});
