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
    // fechado: validade do pacote; aberto: o "consumir até" (com pacote fechado no mesmo lote, o que chegar primeiro)
    expect(l.venceEm, l.desc).toBe(l.pacoteN > 0 && !(l.fechado > 0.0005 && l.validadePacote < l.validadeAberto) ? l.validadeAberto : l.validadePacote);
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
  // "corrigir" abre os pacotes do chá: a data de abertura (até hoje) e o "consumir até" vêm preenchidos e podem ser trocados
  await page.locator('.vl-lata').first().locator('.vl-abriu').click();
  const j = page.locator('.vl-pac');
  await expect(j.locator('h3')).toHaveText(`Pacotes de ${abertos[0].desc}`);
  const aberto = d.lotes.filter((l) => l.cod === abertos[0].cod && l.pacoteN > 0)[0];
  const sit = j.locator('.vl-pac-sit', { hasText: 'Na lata' }).first();
  const [dAbriu, dAte] = [sit.locator('input[type=date]').nth(0), sit.locator('input[type=date].vl-ate')];
  await expect(dAbriu).toHaveValue(aberto.abertoEm);
  await expect(dAbriu).toHaveAttribute('max', d.hoje);
  await expect(dAte).toHaveValue(aberto.validadeAberto);
  await expect(dAte).toHaveAttribute('min', aberto.abertoEm);
  await expect(sit.locator('.dica-i')).toHaveCount(1);
  // trocar o vencimento na apresentação: avisa e nada muda
  await dAte.fill('2030-01-01'); await dAte.blur();
  await expect(page.locator('.toast')).toContainText('nada é salvo');
  await j.getByRole('button', { name: 'Fechar' }).click();
  await expect(page.locator('.vl-pac')).toHaveCount(0);
  // a explicação está na tela
  await page.locator('.vl-ajuda summary').click();
  await expect(page.locator('.vl-ajuda')).toContainText('Depois de aberto');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
  if (process.env.PRINTS) { await page.locator('.vl-ajuda summary').click(); await page.locator('.vl-lata').first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.PRINTS}/abertura-${info.project.name}.png` }); }
  expect(erros).toEqual([]);
});

test('Estoque: "🫙 pacotes" no chá a granel abre os lotes do chá na ordem; dá para informar que abriu um pacote (apresentação: nada é gravado)', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  const saiu = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && /\/api\//.test(r.url()) && !/\/api\/demo\//.test(r.url())) saiu.push(r.url()); });
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  // um chá com pacote fechado, para a janela ter o botão "Abri um pacote hoje"
  const d = await page.evaluate(async () => (await fetch(`/api/demo/validade?loja=${encodeURIComponent(TS.state.loja)}`)).json());
  const alvo = d.lotes.find((l) => l.entrada && l.pacoteN === 0 && l.fechado > 0.0005);
  expect(alvo, 'a apresentação tem chá com pacote fechado').toBeTruthy();
  const doCha = d.lotes.filter((l) => l.cod === alvo.cod);
  await page.evaluate(([cod, desc]) => TS.validade.janelaPacotes(TS.state.loja, cod, desc), [alvo.cod, alvo.desc]);
  const j = page.locator('.vl-pac');
  await expect(j.locator('h3')).toHaveText(`Pacotes de ${alvo.desc}`);
  await expect(j.locator('.vl-pac-lote')).toHaveCount(doCha.length);
  // do mais antigo para o mais novo
  const datas = (await j.locator('.vl-pac-cab b').allTextContents()).filter((t) => /chegou em/.test(t)).map((t) => t.match(/(\d{2})\/(\d{2})\/(\d{4})/).slice(1).reverse().join('-'));
  expect(datas).toEqual([...datas].sort());
  const botao = j.getByRole('button', { name: 'Abri um pacote hoje' }).first();
  await expect(botao).toHaveAttribute('title', /6 meses/);
  await botao.click();
  await expect(page.locator('.toast')).toContainText('nada é salvo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
  if (process.env.PRINTS) await page.screenshot({ path: `${process.env.PRINTS}/pacotes-${info.project.name}.png` });
  await j.getByRole('button', { name: 'Fechar' }).click();
  await expect(page.locator('.vl-pac')).toHaveCount(0);
  // no Estoque, o chá a granel com saldo tem o atalho na célula do estoque
  await page.waitForFunction(() => !(history.state && history.state.camada));
  await page.evaluate(() => { location.hash = '#estoque'; });
  await expect(page.locator('.page-title')).toContainText('Estoque');
  // a tabela é paginada (no celular, 40 por vez): mostra todos os produtos e procura o chá pelo nome
  await page.locator('.seg button', { hasText: /^Todos/ }).first().click();
  await page.locator('.est-t').first().waitFor();
  await page.getByPlaceholder(/Buscar/).first().fill(alvo.desc);
  await expect.poll(async () => page.locator('.est-pac').count(), { timeout: 30000 }).toBeGreaterThan(0);
  await expect(page.locator('.est-pac').first()).toHaveAttribute('title', /Abriu um pacote hoje/);
  await page.locator('.est-pac').first().click();
  await expect(page.locator('.vl-pac h3')).toContainText('Pacotes de ');
  expect(saiu, 'nada sai do navegador na apresentação').toEqual([]);
  expect(erros).toEqual([]);
});
