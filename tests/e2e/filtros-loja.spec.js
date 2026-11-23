// Pedido do dono (23/11/2026): os filtros não se perdiam só por trocar de loja ou de tela. Trocar de loja mantém o período
// e os filtros que existem na loja nova (grupo, categoria, produto); trocar de tela também.
const { test, expect } = require('@playwright/test');

test('FILTROS-LOJA: trocar de loja e de tela mantém o período e o grupo escolhidos', async ({ page }) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.lojas && TS.lojas.length > 1);
  await page.evaluate(() => { location.hash = '#resumo'; });
  await page.waitForFunction(() => TS.state.page === 'resumo');
  // período "Mês anterior" e um grupo
  const grupo = await page.evaluate(() => {
    TS.aplicarPreset('mesAnt');
    const i = TS.db.D.grupoC.findIndex((g) => /AROMATIZADO/.test(g || ''));
    TS.state.f.grupos.add(i);
    TS.render();
    return TS.db.D.grupoC[i];
  });
  const outra = await page.evaluate(() => TS.lojas.find((l) => l.id !== TS.state.loja).id);
  await page.selectOption('#lojaSel', outra);
  await page.waitForFunction((id) => TS.lojaCarregada === id && TS.db, outra);
  const depois = await page.evaluate(() => ({ preset: TS.state.f.preset, grupos: [...TS.state.f.grupos].map((i) => TS.db.D.grupoC[i]) }));
  expect(depois.preset).toBe('mesAnt');
  expect(depois.grupos).toContain(grupo);
  // trocar de tela também mantém
  await page.evaluate(() => { location.hash = '#comparativos'; });
  await page.waitForFunction(() => TS.state.page === 'comparativos');
  expect(await page.evaluate(() => TS.state.f.preset)).toBe('mesAnt');
  expect(await page.evaluate(() => TS.state.f.grupos.size)).toBe(1);
});
