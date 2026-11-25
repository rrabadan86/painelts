const { test, expect } = require('./_base');

// CUP-FIXE-01 (pedido do dono, 25/11/2026): na lista de Cupons a marca do FIXE ao lado do CPF é a mesma da ficha do cliente
test('CUP-FIXE-01: Cupons mostra FIXE ✓ / CPF pelo FIXE / Sem FIXE como a ficha do cliente', async ({ page }) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.cli && TS.cli.porCPF && TS.cli.porCPF.size, null, { timeout: 60000 });
  // o que a ficha diz de cada cupom (mesma fonte: TS.cli)
  const esperado = await page.evaluate(() => {
    const m = {};
    for (const c of TS.cli.porCPF.values()) for (const k of c.cupons || []) {
      const t = k.origem === 'fixe' ? 'CPF pelo FIXE' : k.cpfFixe ? 'CPF diferente no FIXE' : (k.fixeOk || (k.fxMov && k.fxMov.cpf === c.cpf && k.fxMov.tipo === 'pontos' && !k.fxMov.anulado)) ? 'FIXE ✓' : k.semFixe ? 'Sem FIXE' : '';
      if (t) m[t] = (m[t] || 0) + 1;
    }
    return m;
  });
  expect(Object.keys(esperado).length).toBeGreaterThan(0);
  await page.evaluate(() => { location.hash = '#cupons'; });
  const card = page.locator('.card', { hasText: 'Cupons do período' }).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Abrir dias' }).click();
  const marcas = card.locator('.cpf-link .cli-tag:visible'); // os cupons dos dias fechados ficam montados, mas escondidos
  await expect(marcas.first()).toBeVisible();
  const txt = await marcas.allInnerTexts();
  // só as quatro marcas da ficha; nunca o "FIXE" solto de antes
  for (const t of txt) expect(['FIXE ✓', 'CPF pelo FIXE', 'CPF diferente no FIXE', 'Sem FIXE']).toContain(t.trim());
  expect(txt.some((t) => t.trim() === 'FIXE ✓')).toBe(esperado['FIXE ✓'] > 0);
  // a marca explica o que quer dizer
  await expect(marcas.first()).toHaveAttribute('title', /FIXE/);
  expect(erros).toEqual([]);
});
