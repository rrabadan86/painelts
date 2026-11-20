const { test, expect } = require('@playwright/test');

// Estoque → Validade: segunda validade do chá a granel (6 meses depois que o pacote vai para a lata), na apresentação
test('Validade: mostra o que está na lata com a data de abertura e os pacotes fechados na ordem de abrir; a data pode ser corrigida', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#validade'; });
  await expect(page.locator('.vl-chips')).toBeVisible({ timeout: 30000 });
  const d = await page.evaluate(async () => (await fetch(`/api/demo/validade?loja=${encodeURIComponent(TS.state.loja)}`)).json());
  expect(d.mesesAberto).toBe(6); expect(d.pacoteKg).toBe(1);
  const abertos = d.lotes.filter((l) => l.pacoteN > 0), fechados = d.lotes.filter((l) => l.fechado > 0.0005);
  expect(abertos.length).toBeGreaterThan(0);
  expect(fechados.length).toBeGreaterThan(0);
  // a conta fecha: lata + fechado = saldo; abertura nunca antes da chegada; prazo = abertura + 6 meses; vale a data que chega primeiro
  for (const l of d.lotes.filter((x) => x.entrada)) {
    expect(Math.abs(l.aberto + l.fechado - l.saldo), l.desc).toBeLessThan(0.002);
    if (l.pacoteN > 0) {
      expect(l.abertoEm >= l.entrada, l.desc).toBe(true);
      const [a, m, dd] = l.abertoEm.split('-').map(Number);
      expect(l.validadeAberto.slice(0, 7), l.desc).toBe(new Date(Date.UTC(a, m - 1 + 6, 1)).toISOString().slice(0, 7));
      void dd;
    }
    expect(l.venceEm, l.desc).toBe(l.validadeAberto && l.validadeAberto < l.validadePacote ? l.validadeAberto : l.validadePacote);
  }
  // por chá, a ordem de abrir segue a chegada (1 = o mais antigo com pacote fechado)
  const porCha = new Map();
  for (const l of fechados) porCha.set(l.cod, [...(porCha.get(l.cod) || []), l]);
  for (const ls of porCha.values()) { const o = ls.slice().sort((x, y) => (x.entrada < y.entrada ? -1 : 1)).map((l) => l.abrirOrdem); expect(o).toEqual(o.map((_, i) => i + 1)); }
  // na tela: todos os lotes, com as duas marcas
  await page.locator('.vl-chip', { hasText: 'Todos' }).click();
  await expect(page.locator('.vl-lata').first()).toContainText(/na lata .* aberto em \d{2}\/\d{2}\/\d{4}.*consumir até/);
  // a tabela é paginada: procura pelo nome um chá que tem pacote fechado
  const busca = page.locator('input.vl-busca, .vl-busca input').first();
  await busca.fill(fechados[0].desc);
  await expect(page.locator('.vl-fechado').first()).toContainText(/(pacotes? fechados?|fechado) · (o próximo a abrir|abrir em \dº)/);
  await busca.fill(abertos[0].desc);
  // corrigir a data: campo de data limitado entre a chegada e hoje; na apresentação muda só na tela
  const lata = page.locator('.vl-lata').first();
  await lata.locator('.vl-abriu').click();
  const campo = lata.locator('input[type=date]');
  await expect(campo).toHaveAttribute('max', d.hoje);
  await lata.getByRole('button', { name: 'hoje' }).click();
  await expect(page.locator('.toast')).toContainText('nada é salvo');
  await expect(lata).toContainText('consumir até'); // volta a mostrar a linha, sem mudar nada
  // a explicação está na tela
  await page.locator('.vl-ajuda summary').click();
  await expect(page.locator('.vl-ajuda')).toContainText('Depois de aberto');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
  if (process.env.PRINTS) { await page.locator('.vl-ajuda summary').click(); await page.locator('.vl-lata').first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.PRINTS}/abertura-${info.project.name}.png` }); }
  expect(erros).toEqual([]);
});
