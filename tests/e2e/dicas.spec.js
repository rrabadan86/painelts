const { test, expect } = require('@playwright/test');

// Preços: cada coluna tem ⓘ que explica o campo — no cabeçalho (computador) e no rótulo do cartão (celular)
test('Preços: ⓘ explica Cadastro e "vendas −X%" no computador e no celular', async ({ page }, info) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#precos'; });
  const tab = page.locator('table.prc-t');
  await expect(tab).toBeVisible();
  const celular = info.project.name === 'celular';
  const alvo = celular ? tab.locator('tbody td.com-dica .mob-rot', { hasText: 'Cadastro' }).first() : tab.locator('thead th', { hasText: 'Cadastro' });
  await expect(alvo).toBeVisible();
  if (celular) await alvo.locator('.dica-i').tap(); else await alvo.locator('.dica-i').click();
  await expect(page.locator('.dica-balao')).toContainText('vendas −X%');
  // ⓘ no cabeçalho não reordena a tabela
  if (!celular) await expect(tab.locator('thead th.sorted')).not.toContainText('Cadastro');
  // o rótulo do cartão continua um só (sem o rótulo do CSS repetido)
  if (celular) {
    const antes = await tab.locator('tbody td.com-dica').first().evaluate((td) => getComputedStyle(td, '::before').content);
    expect(antes).toBe('none');
  }
  const larga = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(larga).toBeLessThanOrEqual(1);
});

test('Preços: motivo provável da diferença entre vendas e cadastro (preço antigo, promoção ou PDV)', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.precoPorQueDifere);
  const r = await page.evaluate(() => {
    const ate = TS.todayDay(), sem = (d) => Math.floor((d + 3) / 7);
    const semanas = (lista) => new Map(lista.map(([d, precos]) => [sem(d), new Map(precos.map(([p, n]) => [p, { n, dia: d }]))]));
    const f = TS.precoPorQueDifere;
    return {
      // vendeu a 556 há 3 meses e nunca mais: preço antigo
      parado: f({ tab: 680.1, vAt: 556, ultDia: ate - 90, semanas: semanas([[ate - 90, [[556, 3]]]]), vendaEv: [{ dia: ate - 200, v: 556 }] }, ate),
      // nas últimas semanas, parte a 680,10 e parte a 556: promoção em parte das vendas
      misto: f({ tab: 680.1, vAt: 556, ultDia: ate - 2, semanas: semanas([[ate - 20, [[680.1, 2]]], [ate - 3, [[556, 4]]]]), vendaEv: [] }, ate),
      // vendia a 680,10 até 15 dias atrás; desde então tudo a 556
      desde: f({ tab: 680.1, vAt: 556, ultDia: ate - 1, semanas: semanas([[ate - 10, [[556, 5]]]]), vendaEv: [{ dia: ate - 100, v: 680.1 }, { dia: ate - 15, v: 556, de: 680.1 }] }, ate),
      // sempre vendeu a 556, cadastro diz 680,10
      pdv: f({ tab: 680.1, vAt: 556, ultDia: ate - 1, semanas: semanas([[ate - 10, [[556, 5]]]]), vendaEv: [{ dia: ate - 300, v: 556 }] }, ate),
    };
  });
  expect(r.parado.tipo).toBe('parado'); expect(r.parado.curto).toMatch(/^última venda \d\d\/\d\d/); expect(r.parado.longo).toMatch(/Não vende desde/);
  expect(r.misto.tipo).toBe('misto'); expect(r.misto.curto).toBe('promoção?'); expect(r.misto.longo).toMatch(/2 un\. no preço do cadastro .* 4 un\. a outro preço/);
  expect(r.desde.tipo).toBe('pdv'); expect(r.desde.curto).toMatch(/^desde \d\d\/\d\d/); expect(r.desde.longo).toMatch(/vendia no preço do cadastro/);
  expect(r.pdv.tipo).toBe('pdv'); expect(r.pdv.curto).toBe('PDV ≠ cadastro');
});
