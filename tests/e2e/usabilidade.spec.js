// Usabilidade: janelas no lugar do prompt()/alert(), "lembrar depois" no Início, abas da Rentabilidade,
// brindes a R$ 0,01 fora da margem por produto, taxas fora do "compre antes" e telas sem a lateral de filtros.
const { test, expect } = require('./_base');

const abrir = async (page) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
};
const ir = async (page, tela) => {
  await page.evaluate((t) => { location.hash = '#' + t; }, tela);
  await page.waitForFunction(() => !document.querySelector('main .loading .spinner'));
};

test('TS.perguntar: chips de motivo, campo obrigatório com erro em português e cancelar', async ({ page }) => {
  let nativo = 0;
  page.on('dialog', (d) => { nativo++; d.dismiss(); });
  await abrir(page);
  await page.evaluate(() => { window.__r = 'esperando'; TS.perguntar('Por que perdemos?', { chips: ['Preço', 'Prazo'], obrigatorio: true }).then((v) => { window.__r = v; }); });
  const j = page.locator('.cp-modal-bg .ts-perg');
  await expect(j).toBeVisible();
  await j.getByRole('button', { name: 'Confirmar' }).click();
  await expect(j.locator('[role=alert]')).toHaveText('Escolha um motivo ou escreva no campo.');
  expect(await page.evaluate(() => window.__r)).toBe('esperando');
  await j.locator('.chip', { hasText: 'Prazo' }).click();
  await expect(j.locator('input')).toHaveValue('Prazo');
  await expect(j.locator('[role=alert]')).toBeHidden();
  await j.locator('input').fill('Prazo de entrega');
  await j.getByRole('button', { name: 'Confirmar' }).click();
  await expect(j).toHaveCount(0);
  expect(await page.evaluate(() => window.__r)).toBe('Prazo de entrega');
  // opcional: vazio vale; cancelar devolve null
  await page.evaluate(() => { window.__r = 'esperando'; TS.perguntar('Observação?').then((v) => { window.__r = v; }); });
  await page.locator('.ts-perg').getByRole('button', { name: 'Confirmar' }).click();
  expect(await page.evaluate(() => window.__r)).toBe('');
  await page.evaluate(() => { window.__r = 'esperando'; TS.perguntar('Observação?').then((v) => { window.__r = v; }); });
  await page.locator('.ts-perg').getByRole('button', { name: 'Cancelar' }).click();
  expect(await page.evaluate(() => window.__r)).toBe(null);
  // aviso e erro de rede em português
  await page.evaluate(() => { TS.avisarErro(new TypeError('Failed to fetch')); });
  await expect(page.locator('.ts-perg')).toContainText('Sem conexão com o painel agora');
  await expect(page.locator('.ts-perg')).not.toContainText('Failed to fetch');
  await page.locator('.ts-perg').getByRole('button', { name: 'Entendi' }).click();
  await expect(page.locator('.cp-modal-bg')).toHaveCount(0);
  expect(nativo).toBe(0);
});

test('Lista de espera na apresentação: o aviso abre na janela do painel, não no alert() do navegador', async ({ page }) => {
  let nativo = 0;
  page.on('dialog', (d) => { nativo++; d.accept(); });
  await abrir(page);
  await ir(page, 'espera');
  const bt = page.locator('.esp-item.esp-chegou a.esp-wpp').first();
  await bt.scrollIntoViewIfNeeded();
  await bt.click();
  await expect(page.locator('.ts-perg')).toContainText('Na apresentação nada é salvo.');
  await page.locator('.ts-perg').getByRole('button', { name: 'Entendi' }).click();
  expect(nativo).toBe(0);
});

test('Início: plural certo, "lembrar depois" por 7 dias e aviso vermelho sem adiar', async ({ page }) => {
  await abrir(page);
  await ir(page, 'inicio');
  await expect(page.locator('.ini-pend')).toHaveCount(0, { timeout: 30000 });
  await page.locator('.ini-ver-todos').click(); // a lista completa fica em "Ver todos" (redesenho de 22/11/2026)
  const avisos = page.locator('.ini-aviso');
  const antes = await avisos.count();
  expect(antes).toBeGreaterThan(1);
  expect(await page.locator('.ini-avisos').innerText()).not.toMatch(/\(s\)|\(es\)|\(ões\)/);
  // vermelho nunca é escondido: não tem o botão
  await expect(page.locator('.ini-aviso.ini-erro .ini-adiar')).toHaveCount(0);
  const alvo = page.locator('.ini-aviso:has(.ini-adiar)').first();
  const titulo = await alvo.locator('b').innerText();
  const hash = await page.evaluate(() => location.hash);
  await alvo.locator('.ini-adiar').click();
  expect(await page.evaluate(() => location.hash)).toBe(hash); // adiar não abre a tela do aviso
  await expect(avisos).toHaveCount(antes - 1);
  await expect(page.locator('.ini-adiados')).toContainText('1 aviso adiado');
  // no aparelho fica só o código do aviso e a data: nada do texto
  const guardado = await page.evaluate(() => localStorage.getItem('teashop.ini.adiar'));
  expect(Object.keys(JSON.parse(guardado))).toHaveLength(1);
  expect(guardado).not.toContain(titulo.slice(0, 12));
  // continua adiado ao recarregar
  await page.reload();
  await page.waitForFunction(() => window.TS && TS.db);
  await ir(page, 'inicio');
  await expect(page.locator('.ini-pend')).toHaveCount(0, { timeout: 30000 });
  if (!(await page.locator('.ini-todos').isVisible())) await page.locator('.ini-ver-todos').click(); // a lista aberta fica aberta na mesma visita
  await expect(page.locator('.ini-aviso b', { hasText: titulo })).toHaveCount(0);
  await page.locator('.ini-adiados button').click();
  await expect(page.locator('.ini-aviso b', { hasText: titulo })).toHaveCount(1);
  // vencido (7 dias) volta sozinho
  await page.evaluate(() => { const j = {}; j[Object.keys(JSON.parse(localStorage.getItem('teashop.ini.adiar') || '{}'))[0] || 'x|y|z'] = Date.now() - 1000; localStorage.setItem('teashop.ini.adiar', JSON.stringify(j)); });
});

test('Início com todas as lojas: uma linha explica que os avisos de cada loja aparecem ao abrir a loja (tabela lado a lado)', async ({ page }) => {
  await abrir(page);
  const tem = await page.evaluate(() => [...document.querySelectorAll('header select option')].some((o) => o.value === 'todas'));
  test.skip(!tem, 'a apresentação não tem "Todas as lojas"');
  await page.locator('header select').first().selectOption('todas');
  await page.waitForFunction(() => TS.state.loja === 'todas' && TS.db && TS.db.n);
  await ir(page, 'inicio');
  await expect(page.locator('.ini-resumo-i', { hasText: 'Os avisos de estoque, inventário e franquia são de cada loja' })).toBeVisible();
  await expect(page.locator('main .vd-lojas')).toBeVisible();
});

test('Início e Resultado não mostram a lateral de filtros; Estoque continua mostrando', async ({ page }, info) => {
  await abrir(page);
  const lateral = () => page.evaluate(() => [getComputedStyle(document.getElementById('sidebar')).display, getComputedStyle(document.getElementById('btnFiltros')).display]);
  for (const t of ['inicio', 'dre']) { await ir(page, t); expect(await lateral()).toEqual(['none', 'none']); }
  await ir(page, 'estoque');
  const [s, b] = await lateral();
  expect(s).not.toBe('none');
  if (info.project.name === 'celular') expect(b).not.toBe('none');
});

test('Rentabilidade: abas internas lembradas e brinde a R$ 0,01 fora da margem de cada produto', async ({ page }) => {
  await abrir(page);
  await ir(page, 'rentab');
  const abas = page.locator('.est-abas button');
  await expect(abas).toHaveText(['Visão geral', 'Produtos', 'Margem de tabela', 'Pacotes', 'Vendedoras', 'Kits']);
  await expect(page.locator('.card-title', { hasText: 'Giro × margem' })).toBeVisible();
  await expect(page.locator('.est-t-lucro')).toHaveCount(0);
  // o gráfico não estica: nenhum ponto abaixo de −50% e o eixo para aí
  const eixo = await page.evaluate(async () => {
    for (let k = 0; k < 40 && !Chart.getChart(document.querySelector('main canvas')); k++) await new Promise((r) => setTimeout(r, 100));
    const c = Chart.getChart(document.querySelector('main canvas'));
    return { min: c.scales.y.min, menor: Math.min(...c.data.datasets.flatMap((d) => d.data.map((p) => p.y))) };
  });
  expect(eixo.min).toBeGreaterThanOrEqual(-51);
  expect(eixo.menor).toBeGreaterThanOrEqual(-50);
  // a apresentação tem itens que saíram a R$ 0,01 com o preço cheio e desconto de quase 100% (prêmios e brindes)
  const brindes = await page.evaluate(() => { const db = TS.db; let n = 0; for (const i of TS.filtrar()) if (db.qtd[i] > 0 && db.vt[i] / db.qtd[i] < 0.05 && !(Math.abs(db.vu[i] - 0.01) < 1e-7)) n++; return n; });
  if (brindes) await expect(page.locator('.est-origem', { hasText: 'a R$ 0,01' })).toContainText('fora da margem de cada produto');
  await abas.filter({ hasText: 'Produtos' }).click();
  await expect(page.locator('.est-t-lucro')).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'Giro × margem' })).toHaveCount(0);
  // a aba fica lembrada ao sair e voltar
  await ir(page, 'estoque');
  await ir(page, 'rentab');
  await expect(page.locator('.est-abas button.on')).toHaveText('Produtos');
  for (const [aba, titulo] of [['Margem de tabela', 'Margem de tabela'], ['Pacotes', 'Qual pacote oferecer'], ['Vendedoras', 'Lucro por vendedora'], ['Kits', 'Kits sugeridos']]) {
    await page.locator('.est-abas button', { hasText: aba }).click();
    await expect(page.locator('main .card-title', { hasText: titulo })).toBeVisible();
  }
  await page.locator('.est-abas button', { hasText: 'Visão geral' }).click();
});

test('Estoque → Próximas semanas: taxa, serviço e consumo do Espaço Gourmet não entram no "compre antes"', async ({ page }) => {
  await abrir(page);
  await ir(page, 'estoque');
  await expect(page.locator('.card-title', { hasText: 'Próximas semanas' })).toBeVisible();
  const itens = await page.locator('.est-saz-g li').allInnerTexts();
  for (const t of itens) expect(t).not.toMatch(/^Taxa\b|Servi[cç]o|Consumo Eg/i);
});

test('Textos longos recolhidos em "Como funciona ▸": cabeçalho do Estoque e quadro ⭐ Sugestões do Pedido', async ({ page }) => {
  await abrir(page);
  await ir(page, 'estoque');
  expect(await page.locator('.est-origem').first().innerText()).not.toContain('casamento');
  await ir(page, 'pedido');
  const quadro = page.locator('.sug-ped-card');
  await expect(quadro).toBeVisible({ timeout: 30000 });
  const det = quadro.locator('details.est-como');
  await expect(det.locator('p')).toBeHidden();
  await det.locator('summary').click();
  await expect(det.locator('p')).toContainText('aguardando entrega');
});

test('Estoque: o seletor acompanha a aba clicada e cada opção tem explicação', async ({ page }) => {
  await abrir(page); await ir(page, 'estoque');
  const folha = page.locator('#est-tabela .seg-folha');
  if (await folha.count()) { // celular (FOLHA-01): o botão mostra a opção escolhida; na folha, cada opção tem a explicação embaixo
    await expect(folha.locator('b')).toContainText('O que repor');
    await folha.click();
    const ops = page.locator('.folha .folha-op');
    await expect(ops).toHaveCount(7);
    for (const o of await ops.all()) expect((await o.locator('.folha-t small').innerText()).trim()).not.toBe('');
    await expect(page.locator('.folha .folha-op.on')).toHaveCount(1);
    await ops.filter({ hasText: 'Parados' }).click();
    await expect(folha.locator('b')).toContainText('Parados');
    await folha.click();
    await expect(page.locator('.folha .folha-op.on')).toContainText('Parados');
    await page.locator('.folha .folha-op', { hasText: 'Perdendo venda' }).click();
    await expect(folha.locator('b')).toContainText('Perdendo venda');
    return;
  }
  const seg = page.locator('.seg', { hasText: 'O que repor' }).first();
  await expect(seg.locator('button.on')).toContainText('O que repor');
  for (const b of await seg.locator('button').all()) expect((await b.getAttribute('title')) || '').not.toBe('');
  await seg.getByRole('button', { name: /Parados/ }).click();
  await expect(seg.locator('button.on')).toHaveCount(1);
  await expect(seg.locator('button.on')).toContainText('Parados');
  await seg.getByRole('button', { name: /Perdendo venda/ }).click();
  await expect(seg.locator('button.on')).toContainText('Perdendo venda');
});

test('Margem de tabela: clicar no produto abre o histórico de compras (a janela da nota de entrada)', async ({ page }) => {
  await abrir(page); await ir(page, 'rentab');
  await page.locator('.est-abas .seg').getByRole('button', { name: 'Margem de tabela' }).click();
  const prod = page.locator('.nf-hist-btn').first();
  await expect(prod).toBeVisible();
  await prod.evaluate((b) => b.click());
  const pop = page.locator('.nf-hist-pop');
  await expect(pop).toContainText('Histórico de compras');
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
});
