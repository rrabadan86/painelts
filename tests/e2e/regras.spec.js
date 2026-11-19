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
    await page.locator('.est-abas button', { hasText: 'Produtos' }).click();
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

  test('Lista de espera: separação por vendedora, modos, mensagem pronta e formulário', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#espera'; });
    await expect(page.locator('.esp-abas')).toContainText('Chegaram · avisar');
    await expect(page.locator('.esp-grupo').first()).toBeVisible();
    await expect(page.locator('.esp-pilulas .esp-pil').first()).toContainText('Todas');
    await expect(page.locator('.esp-item.esp-chegou').first()).toBeVisible();
    await expect(page.locator('.esp-item.esp-chegou textarea.esp-msg').first()).toHaveValue(/chegou/);
    await page.locator('.esp-modo button', { hasText: 'Por produto' }).click();
    await expect(page.locator('.esp-grupo-prod').first()).toBeVisible();
    await page.locator('.esp-modo button', { hasText: 'Por vendedora' }).click();
    await page.getByRole('button', { name: '+ Anotar pedido' }).click();
    await page.locator('.esp-form input[type=search]').first().fill('ana');
    await page.locator('.esp-form .cp-sug-it').first().dispatchEvent('mousedown');
    await expect(page.locator('.esp-cli-esc')).toBeVisible();
    await expect(page.locator('.esp-cli-novo')).toBeHidden();
    expect(await page.locator('.esp-cli-esc').innerText()).not.toMatch(/(^|\s)null(\s|$)/);
    await expect(page.locator('.esp-form select')).toBeVisible();
    await page.locator('.esp-form input[type=search]').nth(1).fill('african');
    await page.locator('.esp-sug-p .cp-sug-it').first().dispatchEvent('mousedown');
    await expect(page.locator('.esp-chip')).toHaveCount(1);
  });

  test('Configurações: a atualização automática não leva a tela para o início', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#config'; });
    await expect(page.locator('.cfg-abas')).toBeVisible();
    await page.setViewportSize({ width: 1366, height: 360 });
    await page.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2));
    const antes = await page.evaluate(() => window.scrollY);
    expect(antes).toBeGreaterThan(50);
    await page.evaluate(() => TS.cfgRepintar());
    expect(await page.evaluate(() => window.scrollY)).toBe(antes);
  });

  test('Validade: faixas, valor em risco, lote editável e "vender primeiro" na Promoção', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#validade'; });
    await expect(page.locator('.vl-resumo .vl-risco')).toContainText('a custo');
    await expect(page.locator('.vl-alerta')).toContainText('vencido');
    await page.locator('.vl-chip', { hasText: 'Todos' }).click();
    const lote = page.locator('.vl-tabela input.vl-lote').first();
    await lote.fill('l2611-a');
    await lote.press('Enter');
    await expect(page.locator('.vl-tabela input.vl-lote.vl-salvo')).toHaveCount(1);
    await expect(lote).toHaveValue('L2611-A');
    expect(await page.locator('main').innerText(), 'texto "null" na tela').not.toMatch(/(^|\s)(null|undefined|NaN)(\s|$)/);
    // ajustar os lotes de um chá: a soma tem de ser o estoque
    await page.locator('.vl-ajustar').first().click();
    await expect(page.locator('.vl-modal')).toBeVisible();
    await expect(page.locator('.vl-modal .vl-okk')).toBeVisible();
    await page.locator('.vl-modal input.vl-g').first().fill('99999');
    await expect(page.locator('.vl-modal .vl-dif')).toContainText('sobram');
    await expect(page.locator('.vl-modal button.primary')).toBeDisabled();
    await page.locator('.vl-modal button', { hasText: 'Cancelar' }).click();
    await page.locator('.vl-chip.vl-critica').click();
    await expect(page.locator('.vl-tabela').first()).toContainText('< 30 dias');
    await page.evaluate(() => { location.hash = '#promocao'; });
    await expect(page.locator('main')).toContainText('Vender primeiro');
  });

  test('Clientes: RFM (grupos, filtro, indicadores), retenção por safra e tela Hoje', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#clientes'; });
    await expect(page.locator('.rfm-t')).toContainText('Campeões');
    await expect(page.locator('.safra-t')).toContainText('Novos');
    await page.locator('.rfm-t tr.rfm-linha', { hasText: 'Leais' }).click();
    await expect(page).toHaveURL(/#clilista/);
    await expect(page.locator('.rfm-chip.on')).toContainText('Leais');
    await expect(page.locator('.cli-tag.rfm-leal').first()).toBeVisible();
    await page.evaluate(() => { location.hash = '#hoje'; });
    await expect(page.locator('.hj-item').first()).toBeVisible();
    expect(await page.locator('main').innerText(), 'texto "null" na tela').not.toMatch(/(^|\s)(null|undefined|NaN)(\s|$)/);
    await page.evaluate(() => { location.hash = '#campanhas'; });
    await page.getByRole('button', { name: '+ Criar campanha' }).click();
    await expect(page.locator('main')).toContainText('Grupo do cliente (RFM)');
    await expect(page.locator('main')).toContainText('Tipo de chá que compra');
  });

  test('Trava de estoque: mensagem que oferece produto sem estoque não sai', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const d = await TS.estoqueDisp(TS.state.loja);
      const c = { chaFavorito: 'Produto Que Nao Existe', chaUltimo: null };
      const zero = (await (await fetch('/api/demo/estoque/disponivel?loja=' + encodeURIComponent(TS.state.loja))).json()).itens.find((x) => !x[2]);
      return {
        desconhecido: d.tem('Produto Que Nao Existe'),
        semEstoque: zero ? d.tem(zero[0]) : false,
        bloqueia: zero ? TS.semEstoqueNaMensagem(d, 'Seu {cha} acabou?', { chaFavorito: zero[0] }) : zero,
        semTag: zero ? TS.semEstoqueNaMensagem(d, 'Oi, {nome}!', { chaFavorito: zero[0] }) : null,
        produto: zero ? TS.semEstoqueNaMensagem(d, 'Chegou {produto}', c, { produtos: [zero[0]] }) : zero,
      };
    });
    expect(r.desconhecido).toBeNull();
    expect(r.semEstoque).toBe(false);
    expect(r.bloqueia).toBeTruthy();
    expect(r.semTag).toBeNull();
    expect(r.produto).toBeTruthy();
  });

  test('Inventário: nova contagem de um tipo de chá, contar em gramas, revisar', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#inventario'; });
    await page.getByRole('button', { name: '+ Nova contagem' }).click();
    await page.locator('.inv-modos button', { hasText: 'Um tipo de chá' }).click();
    const sel = page.locator('.inv-modo-corpo select');
    const op = await sel.locator('option').nth(1).getAttribute('value');
    await sel.selectOption(op);
    await expect(page.locator('.inv-previa b')).not.toHaveText('0');
    await page.getByRole('button', { name: 'Começar a contar' }).click();
    const campo = page.locator('input.inv-qtd').first();
    await campo.fill('375');
    await campo.press('Enter');
    await expect(page.locator('.inv-salvo.ok').first()).toBeVisible();
    await expect(page.locator('.inv-prog')).toContainText('1 de');
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Terminar contagem' }).click();
    await expect(page.locator('.inv-revfil')).toBeVisible();
    await page.locator('.inv-revfil button', { hasText: /^Todos \(/ }).click();
    await expect(page.locator('.inv-revfil').locator('..')).toContainText('375 g');
    await expect(page.locator('.inv-revfil button', { hasText: /^Iguais \(\d+\)/ })).toBeVisible();
    const z = page.locator('.inv-revfil button', { hasText: /^Zerados \(\d+\)/ });
    const nz = Number((await z.textContent()).match(/\d+/)[0]);
    await z.click();
    if (nz) await expect(page.locator('.inv-revfil').locator('..')).toContainText('não contado: vai como 0');
    else await expect(page.locator('.inv-revfil').locator('..')).toContainText('Nenhum item zerado');
  });

  test('Inventário: cancelar na tela de contagem; histórico com situação, período e busca', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#inventario'; });
    for (const nome of ['Teste cancelar', 'Outra contagem']) {
      await page.getByRole('button', { name: '+ Nova contagem' }).click();
      await page.locator('.inv-modos button', { hasText: 'Um tipo de chá' }).click();
      const sel = page.locator('.inv-modo-corpo select');
      await sel.selectOption(await sel.locator('option').nth(1).getAttribute('value'));
      await page.getByPlaceholder(/Nome \(opcional\)/).fill(nome);
      await page.getByRole('button', { name: 'Começar a contar' }).click();
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: 'Cancelar contagem' }).click();
      await expect(page.locator('.inv-antigas')).toContainText(nome);
    }
    const hist = page.locator('.inv-antigas');
    await expect(hist.locator('.inv-hist-ferr button', { hasText: 'Canceladas (2)' })).toBeVisible();
    await hist.locator('.inv-hist-ferr button', { hasText: 'Importadas' }).click();
    await expect(hist).toContainText('Nenhuma contagem com esses filtros');
    await hist.locator('.inv-hist-ferr button', { hasText: 'Todas' }).click();
    await hist.locator('input[type=date]').first().fill('2099-01-01');
    await hist.locator('input[type=date]').first().dispatchEvent('change');
    await expect(hist).toContainText('Nenhuma contagem com esses filtros');
    await hist.getByRole('button', { name: 'tudo' }).click();
    await hist.locator('input[type=search], .inv-hist-ferr input:not([type=date])').first().fill('outra');
    await expect(hist.locator('tbody tr')).toHaveCount(1);
    await hist.locator('tbody tr').first().click();
    await expect(page.locator('.inv-cab')).toContainText('Outra contagem');
  });

  test('Inventário: reabrir para contar só no mesmo dia em que a contagem foi aberta', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#inventario'; });
    await page.getByRole('button', { name: '+ Nova contagem' }).click();
    await page.locator('.inv-modos button', { hasText: 'Um tipo de chá' }).click();
    const sel = page.locator('.inv-modo-corpo select');
    await sel.selectOption(await sel.locator('option').nth(1).getAttribute('value'));
    await page.getByPlaceholder(/Nome \(opcional\)/).fill('Teste reabrir');
    await page.getByRole('button', { name: 'Começar a contar' }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Cancelar contagem' }).click();
    const hist = page.locator('.inv-antigas');
    await hist.locator('tbody tr', { hasText: 'Teste reabrir' }).first().click();
    // aberta hoje: o botão aparece e avisa que é só hoje
    await expect(page.getByRole('button', { name: 'Reabrir para contar' })).toBeVisible();
    await expect(page.locator('.inv-reabrir')).toContainText('só hoje');
    // aberta ontem: sem botão, com o motivo
    await page.evaluate(() => { const c = TS._invDemo.cont.find((x) => x.nome === 'Teste reabrir'); c.criadoEm = new Date(Date.now() - 864e5 * 1.5).toISOString(); });
    await page.getByRole('button', { name: '‹ Contagens' }).click();
    await hist.locator('tbody tr', { hasText: 'Teste reabrir' }).first().click();
    await expect(page.locator('.inv-cab')).toContainText('Teste reabrir');
    await expect(page.getByRole('button', { name: 'Reabrir para contar' })).toHaveCount(0);
    await expect(page.locator('.inv-reabrir')).toContainText('não dá mais para reabrir');
  });

  test('Início avisa grupo/tipo de chá sem inventário há 25 dias; tipo de chá une puro e aromatizado', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#inicio'; });
    await expect(page.locator('.ini-avisos')).toContainText(/tipos? de chá (está|estão) há 25 dias ou mais sem contagem/);
    await page.evaluate(() => { location.hash = '#inventario'; });
    await page.getByRole('button', { name: '+ Nova contagem' }).click();
    await page.locator('.inv-modos button', { hasText: 'Um tipo de chá' }).click();
    const ops = await page.locator('.inv-modo-corpo select option').allTextContents();
    expect(ops.some((o) => /aromatizado|puro/i.test(o))).toBe(false);
    expect(await page.locator('.inv-modo-corpo select optgroup').count()).toBe(0);
  });

  test('Inventário: chá a granel contado por lote (o total é a soma)', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#inventario'; });
    await page.getByRole('button', { name: '+ Nova contagem' }).click();
    await page.locator('.inv-modos button', { hasText: 'Todos os chás a granel' }).click();
    await page.getByRole('button', { name: 'Começar a contar' }).click();
    const item = page.locator('.inv-item.inv-kg', { has: page.locator('.inv-porlote') }).first();
    await item.locator('.inv-porlote').click();
    const campos = item.locator('input.vl-g');
    await expect(campos.first()).toBeVisible();
    await campos.first().fill('150');
    if (await campos.count() > 1) await campos.nth(1).fill('50');
    const total = (await campos.count()) > 1 ? '200' : '150';
    await expect(item.locator('input.inv-qtd')).toHaveValue(total);
    await expect(item.locator('.inv-salvo.ok')).toContainText('por lote');
  });

  test('Inventário: "zerar os não listados" mostra o que vai ficar 0 e deixa desmarcar grupos', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#inventario'; });
    await page.getByRole('button', { name: '+ Nova contagem' }).click();
    await page.locator('.inv-modo-corpo input[type=search]').fill('a');
    await page.locator('.inv-modo-corpo input[type=search]').fill('ar');
    await page.locator('.cp-sug-it').first().dispatchEvent('mousedown');
    await page.locator('.inv-check', { hasText: 'Zerar os produtos' }).locator('input').check();
    await page.getByRole('button', { name: 'Começar a contar' }).click();
    await page.locator('input.inv-qtd').first().fill('2');
    await page.locator('input.inv-qtd').first().press('Enter');
    await expect(page.locator('.inv-salvo.ok').first()).toBeVisible();
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Terminar contagem' }).click();
    await expect(page.locator('.inv-zerar.on')).toBeVisible();
    const antes = await page.locator('.inv-zerar-res b').innerText();
    await page.locator('.inv-zerar-g input').first().uncheck();
    await expect(page.locator('.inv-zerar-res b')).not.toHaveText(antes);
  });

  test('NF de entrada mostra NF-e de saída vinculada e abre pop-up sobreposto sem fechar a entrada', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#notas'; });
    const abaDev = page.locator('.prc-notas .seg button', { hasText: 'Com devolução' });
    await expect(abaDev).toBeVisible();
    await abaDev.click();
    await expect(page.locator('.prc-notas .nf-dev').first()).toContainText('devolução');
    await page.locator('.prc-notas a.prc-nome').first().click();
    await expect(page.locator('.prc-drawer')).toBeVisible();
    const btnSaida = page.locator('.prc-drawer .nf-vinculo-btn').first();
    await expect(btnSaida).toContainText('NF-e nº 79');
    await btnSaida.click();
    await expect(page.locator('.prc-popup-camada .prc-popup')).toContainText('NF-e 79');
    await expect(page.locator('.prc-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.prc-popup-camada')).toHaveCount(0);
    await expect(page.locator('.prc-drawer')).toBeVisible();
  });

  test('Nota de saída: clicar na linha abre o detalhamento com custo e margem', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#nfsaida'; });
    await page.locator('.prc-notas .seg button, .seg button', { hasText: 'Todas' }).first().click();
    await page.locator('.est-t tbody tr').first().locator('td').nth(2).click();
    const gaveta = page.locator('.prc-drawer');
    await expect(gaveta).toContainText('Produtos da nota');
    await expect(gaveta).toContainText('Margem');
    expect(await gaveta.innerText(), 'texto "null" na nota').not.toMatch(/(^|\s)(null|undefined|NaN)(\s|$)/);
  });

  test('Nota de entrada: lote do chá a granel junto da devolução, etiqueta e filtro "lote pendente"', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#notas'; });
    const aba = page.locator('.prc-notas .seg button', { hasText: 'Lote pendente' });
    await expect(aba).toBeVisible();
    await aba.click();
    await expect(page.locator('.prc-notas .vl-pend').first()).toContainText('lote pendente');
    await page.locator('.prc-notas a.prc-nome').first().click();
    const bloco = page.locator('.prc-drawer');
    await expect(bloco).toContainText('Lote · validade');
    await expect(bloco.locator('.vl-falta')).toContainText('sem lote');
    await expect(bloco.locator('.vl-nota')).toHaveCount(0); // sem o cartão separado
    const lote = bloco.locator('input.vl-lote').first();
    await lote.fill('r2611');
    await lote.press('Enter');
    await expect(bloco.locator('input.vl-lote.vl-salvo')).toHaveCount(1);
    await expect(lote).toHaveValue('R2611');
    await expect(bloco.locator('input.vl-val').first()).not.toHaveValue('');
  });
});
