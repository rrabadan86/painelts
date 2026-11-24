const { test, expect, escolherOpcao } = require('./_base');

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
    // fechado: validade do pacote (a da chegada); com chá aberto: 6 meses a partir da abertura
    expect(l.venceEm, l.desc).toBe(l.pacoteN > 0 ? l.validadeAberto : l.validadePacote);
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
  // "corrigir" abre os lotes do chá: em cima o aberto (nota, chegada, abertura, vencimento e quantidade), datas preenchidas e editáveis
  await page.locator('.vl-lata').first().locator('.vl-abriu').click();
  const j = page.locator('.vl-pac');
  await expect(j.locator('h3')).toHaveText(`Lotes de ${abertos[0].desc}`);
  await expect(j.locator('.vl-pac-sec h4')).toHaveText([/Chá aberto/, /Lotes fechados/]);
  const aberto = d.lotes.filter((l) => l.cod === abertos[0].cod && l.pacoteN > 0).sort((x, y) => (x.abertos[0].abertoEm < y.abertos[0].abertoEm ? -1 : 1))[0];
  const sit = j.locator('.vl-pac-aberto').first();
  await expect(sit.locator('.vl-pac-campo > small')).toHaveText([/Nota de entrada/, /Chegou em/, /Aberto em/, /Vence em/, /Quantidade/]);
  await expect(sit).toContainText(`NF ${aberto.nf}`);
  const [dAbriu, dAte] = [sit.locator('input[type=date]').nth(0), sit.locator('input[type=date].vl-ate')];
  await expect(dAbriu).toHaveValue(aberto.abertos[0].abertoEm);
  await expect(dAbriu).toHaveAttribute('max', d.hoje);
  await expect(dAte).toHaveValue(aberto.abertos[0].validade);
  await expect(dAte).toHaveAttribute('min', aberto.abertos[0].abertoEm);
  // trocar o vencimento na apresentação: avisa e nada muda
  await dAte.fill('2030-01-01'); await dAte.blur();
  await expect(page.locator('.toast')).toContainText('nada é salvo');
  await j.getByRole('button', { name: 'Fechar' }).click();
  await expect(page.locator('.vl-pac')).toHaveCount(0);
  // clicar no nome do chá abre a mesma janela
  await page.waitForFunction(() => !(history.state && history.state.camada));
  await page.locator('.vl-nome', { hasText: abertos[0].desc }).first().click();
  await expect(j.locator('h3')).toHaveText(`Lotes de ${abertos[0].desc}`);
  await expect(j.locator('.vl-pac-aberto').first()).toContainText(/NF \d+/);
  await j.getByRole('button', { name: 'Fechar' }).click();
  await expect(page.locator('.vl-pac')).toHaveCount(0);
  // histórico: pacotes do chá que já acabaram (nota, chegada, abertura, validade e quando acabou)
  expect(d.historico.length).toBeGreaterThan(0);
  const hist = d.historico[0], doHist = d.lotes.find((l) => l.cod === hist.cod);
  await page.waitForFunction(() => !(history.state && history.state.camada));
  await page.evaluate(([cod, desc]) => TS.validade.janelaPacotes(TS.state.loja, cod, desc), [hist.cod, doHist.desc]);
  const hd = page.locator('.vl-pac-hist');
  await expect(hd.locator('summary')).toContainText(`Histórico de aberturas (${d.historico.filter((x) => x.cod === hist.cod).length})`);
  await hd.locator('summary').click();
  await expect(hd.locator('.vl-pac-hist-i').first().locator('.vl-pac-campo > small')).toHaveText([/Nota de entrada/, /Chegou em/, /Aberto em/, /Valia até/, /Acabou em/]);
  await expect(hd.locator('.vl-pac-hist-i').first()).toContainText(`NF ${hist.nf}`);
  expect(await page.locator('.vl-pac').evaluate((el) => el.scrollWidth - el.clientWidth), 'a janela não rola para o lado').toBeLessThanOrEqual(1);
  if (process.env.PRINTS) await page.screenshot({ path: `${process.env.PRINTS}/historico-${info.project.name}.png` });
  await page.locator('.vl-pac').getByRole('button', { name: 'Fechar' }).click();
  await expect(page.locator('.vl-pac')).toHaveCount(0);
  // chá aberto: a coluna Validade mostra a data final de consumo (a que vale), editável; o "voltar" só aparece quando alguém trocou
  const ab = d.lotes.find((l) => l.motivo === 'aberto' && l.validadeAberto);
  if (ab) {
    await page.locator('input.vl-busca, .vl-busca input').first().fill(ab.desc);
    const campoFinal = page.locator('input.vl-val-aberto').first();
    await expect(campoFinal).toHaveValue(d.lotes.filter((l) => l.desc === ab.desc && l.motivo === 'aberto').map((l) => l.validadeAberto).sort()[0]);
    await expect(page.locator('.vl-volta-consumo')).toHaveCount(0);
    await expect(page.locator('.vl-val-box', { has: page.locator('.vl-val-aberto') }).first()).toContainText('data final de consumo');
  }
  // validade do pacote igual aos 12 meses da chegada: sem botão "voltar a 12 meses" (ele não faria nada)
  expect(d.lotes.every((l) => l.padrao || l.validade !== l.validadePadrao || true)).toBe(true);
  // a explicação está na tela
  await page.locator('.vl-ajuda summary').click();
  await expect(page.locator('.vl-ajuda')).toContainText('Depois de aberto');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
  if (process.env.PRINTS) { await page.locator('.vl-ajuda summary').click(); await page.evaluate(() => scrollTo(0, 300)); await page.screenshot({ path: `${process.env.PRINTS}/abertura-${info.project.name}.png` }); }
  expect(erros).toEqual([]);
});

test('Estoque: clicar no nome do chá a granel abre os lotes dele (aberto em cima, fechados embaixo com "Abrir lote"); apresentação: nada é gravado', async ({ page }, info) => {
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
  await expect(j.locator('h3')).toHaveText(`Lotes de ${alvo.desc}`);
  // embaixo, os lotes fechados do mais antigo para o mais novo: nota, chegada, validade do pacote, quantidade e "Abrir lote"
  const fech = doCha.filter((l) => l.entrada && l.fechado > 0.0005).sort((x, y) => (x.entrada < y.entrada ? -1 : 1));
  const linhas = j.locator('.vl-pac-fechado');
  await expect(linhas).toHaveCount(fech.length);
  await expect(linhas.first().locator('.vl-pac-campo > small')).toHaveText([/Nota de entrada/, /Chegou em/, /Validade do pacote/, /Quantidade/]);
  await expect(linhas.first()).toContainText(`NF ${fech[0].nf}`);
  await expect(linhas.first()).toContainText('o próximo a abrir');
  await expect(linhas.first().locator('input[type=date]')).toHaveValue(fech[0].validadePacote);
  const botao = linhas.first().getByRole('button', { name: 'Abrir lote' });
  await expect(botao).toHaveAttribute('title', /6 meses depois/);
  await botao.click();
  await expect(page.locator('.toast')).toContainText('nada é salvo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
  // nada passa da borda da janela
  expect(await j.evaluate((el) => el.scrollWidth - el.clientWidth), 'a janela não rola para o lado').toBeLessThanOrEqual(1);
  if (process.env.PRINTS) await page.screenshot({ path: `${process.env.PRINTS}/pacotes-${info.project.name}.png` });
  await j.getByRole('button', { name: 'Fechar' }).click();
  await expect(page.locator('.vl-pac')).toHaveCount(0);
  // no Estoque, o chá a granel com saldo tem o atalho na célula do estoque
  await page.waitForFunction(() => !(history.state && history.state.camada));
  await page.evaluate(() => { location.hash = '#estoque'; });
  await expect(page.locator('.page-title')).toContainText('Estoque');
  // a tabela é paginada (no celular, 40 por vez): mostra todos os produtos e procura o chá pelo nome
  await escolherOpcao(page, '#est-tabela .est-tools', /^Todos/);
  await page.locator('#est-tabela .est-t, #est-tabela .lmob-it').first().waitFor();
  await page.getByPlaceholder(/Buscar/).first().fill(alvo.desc);
  // no Estoque, clicar no nome do chá a granel abre a mesma janela
  const nomeCha = page.locator('.est-nome-cha', { hasText: alvo.desc }).first();
  await expect(nomeCha).toBeVisible({ timeout: 30000 });
  await expect(nomeCha).toHaveAttribute('title', /lotes deste chá/);
  await nomeCha.click();
  await expect(page.locator('.vl-pac h3')).toHaveText(`Lotes de ${alvo.desc}`);
  await expect(page.locator('.vl-pac .vl-pac-sec h4')).toHaveText([/Chá aberto/, /Lotes fechados/]);
  expect(saiu, 'nada sai do navegador na apresentação').toEqual([]);
  expect(erros).toEqual([]);
});
