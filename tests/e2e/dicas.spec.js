const { test, expect } = require('@playwright/test');

// Preços: cada coluna tem ⓘ que explica o campo — no cabeçalho (computador) e no rótulo do cartão (celular)
test('Preços: ⓘ explica a coluna "No caixa" no computador e no celular', async ({ page }, info) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#precos'; });
  const tab = page.locator('table.prc-t');
  await expect(tab).toBeVisible();
  const celular = info.project.name === 'celular';
  const alvo = celular ? tab.locator('tbody td.com-dica .mob-rot', { hasText: 'No caixa' }).first() : tab.locator('thead th', { hasText: 'No caixa' });
  await expect(alvo).toBeVisible();
  if (celular) await alvo.locator('.dica-i').tap(); else await alvo.locator('.dica-i').click();
  await expect(page.locator('.dica-balao')).toContainText('a margem usa o preço do sistema');
  // ⓘ no cabeçalho não reordena a tabela
  if (!celular) await expect(tab.locator('thead th.sorted')).not.toContainText('No caixa');
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

// Venda e margem pelo CADASTRO (não pelo caixa); o "antes" vem do histórico do cadastro
test('Preços: venda e margem pelo preço do cadastro, com o histórico de reajustes do cadastro', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.precoVendaPeloCadastro);
  const r = await page.evaluate(() => {
    const d = (iso) => TS.isoToDay(iso);
    const f = TS.precoVendaPeloCadastro;
    const D = { tabHist: { A: [['2026-01-10', 600], ['2026-10-05', 680.1]], B: [] } };
    const a = { cod: 'A', tab: 680.1, vAt: 556, cAnt: 198.58, cAt: 198.58 }; f(a, D, d('2026-10-01'), d('2026-10-31'));
    const b = { cod: 'B', tab: 50, vAt: 45, cAnt: 20, cAt: 20 }; f(b, D, d('2026-10-01'), d('2026-10-31'));
    const c = { cod: 'A', tab: 680.1, vAt: 556, cAnt: 198.58, cAt: 198.58 }; f(c, D, d('2026-11-01'), d('2026-11-18'));
    return { a, b, c };
  });
  // reajuste do cadastro dentro do período: 600 → 680,10, margem pelo cadastro (não pelos 556 do caixa)
  expect(r.a.vAnt).toBe(600); expect(r.a.vAt).toBe(680.1); expect(r.a.nV).toBe(1);
  expect(r.a.mAt).toBeCloseTo((680.1 - 198.58) / 680.1, 6);
  // sem histórico: preço atual do cadastro, sem reajuste
  expect(r.b.vAnt).toBe(50); expect(r.b.vAt).toBe(50); expect(r.b.nV).toBe(0); expect(r.b.mAt).toBeCloseTo(0.6, 6);
  // período depois do reajuste: sem mudança
  expect(r.c.vAnt).toBe(680.1); expect(r.c.nV).toBe(0);
});

// Preço do sistema (cadastro) e do caixa em colunas separadas: produto sem cadastro mostra "sem cadastro" no sistema e o caixa com antes → agora
test('Preços: colunas "No sistema" e "No caixa" lado a lado', async ({ page }, info) => {
  test.skip(info.project.name === 'celular', 'cabeçalho só no computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#precos'; });
  const tab = page.locator('table.prc-t');
  await expect(tab).toBeVisible();
  const ths = await tab.locator('thead th').allInnerTexts();
  const iSis = ths.findIndex((t) => t.includes('No sistema')), iCx = ths.findIndex((t) => t.includes('No caixa'));
  expect(iSis).toBeGreaterThan(0); expect(iCx).toBe(iSis + 1);
  expect(ths.some((t) => t.includes('Venda (antes'))).toBe(false);
  // a apresentação não tem códigos de produto: tudo "sem cadastro", margem pelo caixa
  const linha = tab.locator('tbody tr').first();
  await expect(linha.locator('td').nth(iSis)).toContainText('sem cadastro');
  await expect(linha.locator('td').nth(iCx)).toContainText('margem pelo caixa');
  await expect(linha.locator('td').nth(iCx)).toContainText('R$');
});
