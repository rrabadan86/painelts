// Leiaute de base: quadros de número com estado, cartões sem sombra, texto de apoio numa frase,
// avisos do Início em lista agrupada, ajustes do Pedido em linha e topo do Resultado.
const { test, expect } = require('@playwright/test');

const abrir = async (page) => { await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas'); };
const ir = (page, tela) => page.evaluate((t) => { location.hash = '#' + t; }, tela);
const semRolagemLateral = async (page) => { const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); expect(d).toBeLessThanOrEqual(1); };
const corBarra = (loc) => loc.evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
const token = (page, nome) => page.evaluate((n) => { const x = document.createElement('i'); x.style.color = `var(${n})`; document.body.append(x); const c = getComputedStyle(x).color; x.remove(); return c; }, nome);

test('Quadros: barra vermelha/verde só com estado; neutro sem barra; cartão sem sombra', async ({ page }) => {
  await abrir(page);
  await ir(page, 'estoque');
  const repor = page.locator('.kpi', { hasText: 'Para repor' });
  await expect(repor).toBeVisible({ timeout: 20000 });
  const [bad, good] = [await token(page, '--bad'), await token(page, '--good')];
  // "Para repor" com urgentes = ruim (barra vermelha); "Estoque a custo" não compara nada = neutro (sem barra)
  await expect(repor).toHaveClass(/kpi-ruim/);
  expect(await corBarra(repor)).toBe(bad);
  const neutro = page.locator('.kpi', { hasText: 'Estoque a custo' });
  await expect(neutro).not.toHaveClass(/kpi-(bom|ruim)/);
  expect(await corBarra(neutro)).toBe('rgba(0, 0, 0, 0)');
  // o estado segue o primeiro sinal do rodapé (ou do valor): confere em todos os quadros da tela
  const incoerentes = await page.evaluate(() => [...document.querySelectorAll('.kpi')].filter((k) => {
    const s = (k.querySelector('.kpi-foot') || k).querySelector('.up, .pos, .down, .neg') || k.querySelector('.kpi-value .up, .kpi-value .pos, .kpi-value .down, .kpi-value .neg');
    const esperado = !s ? '' : /\b(down|neg)\b/.test(s.className) ? 'kpi-ruim' : 'kpi-bom';
    const tem = k.classList.contains('kpi-ruim') ? 'kpi-ruim' : k.classList.contains('kpi-bom') ? 'kpi-bom' : '';
    return esperado !== tem;
  }).map((k) => k.querySelector('.kpi-label').textContent));
  expect(incoerentes).toEqual([]);
  // cartão: só a borda fina separa os blocos
  expect(await page.locator('main .card').first().evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
  await semRolagemLateral(page);

  // Início: a projeção que bate a meta fica verde
  await ir(page, 'inicio');
  const proj = page.locator('.kpi', { hasText: 'Projeção do mês' });
  await expect(proj).toBeVisible();
  if (await proj.locator('.kpi-foot .up').count()) expect(await corBarra(proj)).toBe(good);
});

test('Vendas → Resumo: variações curtas com a frase completa no title e nenhum quadro sozinho na última linha', async ({ page }, info) => {
  await abrir(page);
  await ir(page, 'resumo');
  const fat = page.locator('.kpi', { hasText: 'Faturamento' }).first();
  await expect(fat.locator('.kpi-vars')).toBeVisible({ timeout: 20000 });
  const linhas = await fat.locator('.kpi-vars > span').evaluateAll((xs) => xs.map((x) => [x.textContent, x.title]));
  expect(linhas.some(([t, dica]) => /· \d+ dias$/.test(t) && /^vs\. \d+ dias anteriores$/.test(dica))).toBe(true);
  expect(linhas.some(([t, dica]) => /· ano$/.test(t) && dica === 'vs. ano anterior')).toBe(true);
  if (info.project.name === 'computador') {
    // 7 quadros: divididos em linhas parecidas, a última nunca com um só
    const porLinha = await page.locator('.g-kpi').first().evaluate((g) => { const m = new Map(); for (const k of g.children) { const y = Math.round(k.getBoundingClientRect().top); m.set(y, (m.get(y) || 0) + 1); } return [...m.values()]; });
    if (porLinha.length > 1) expect(porLinha[porLinha.length - 1]).toBeGreaterThan(1);
  }
  await semRolagemLateral(page);
});

test('Cartão: texto de apoio longo mostra a primeira frase e guarda o resto em "Como ler"', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(() => {
    const longo = 'Primeira frase do cartão, que explica em poucas palavras o que é o bloco. Segunda frase, com o detalhe de como a conta é feita e de onde vêm os números (R$ 1.234,56 vs. 30 dias). Terceira frase.';
    const a = TS.card('Título', longo), b = TS.card('Título', 'Subtítulo curto. Fica como está.');
    const sub = a.querySelector('.card-sub'), det = sub.querySelector('details.est-como');
    return { inteiro: sub.textContent.replace('Como ler ▸', '').replace(/\s+/g, ' ') === longo, frase: sub.firstChild.textContent, resumo: det && det.querySelector('summary').textContent, aberto: det && det.open, curto: !!b.querySelector('details') };
  });
  expect(r.inteiro).toBe(true); // o texto completo continua na página
  expect(r.frase).toBe('Primeira frase do cartão, que explica em poucas palavras o que é o bloco.');
  expect(r.resumo).toContain('Como ler');
  expect(r.aberto).toBe(false);
  expect(r.curto).toBe(false);
});

test('Início: avisos numa lista só, agrupados por área, vermelhos primeiro', async ({ page }) => {
  await abrir(page);
  await ir(page, 'inicio');
  await expect(page.locator('.ini-pend')).toHaveCount(0, { timeout: 30000 });
  const grupos = page.locator('.ini-avisos .ini-grupo');
  expect(await grupos.count()).toBeGreaterThan(1);
  // todo aviso está dentro de um grupo; o cabeçalho traz o nome da área e a contagem certa
  await expect(page.locator('.ini-avisos > .ini-aviso')).toHaveCount(0);
  const dados = await grupos.evaluateAll((gs) => gs.map((g) => ({ area: g.dataset.area, n: +g.querySelector('.ini-grupo-t span').textContent, niveis: [...g.querySelectorAll('.ini-aviso')].map((a) => (a.classList.contains('ini-erro') ? 0 : 1)) })));
  const ORDEM = ['estoque', 'inventario', 'franquia', 'vendas', 'outros'];
  expect(dados.map((d) => ORDEM.indexOf(d.area))).toEqual([...dados.map((d) => ORDEM.indexOf(d.area))].sort((a, b) => a - b));
  for (const d of dados) { expect(d.niveis.length).toBe(d.n); expect(d.niveis).toEqual([...d.niveis].sort((a, b) => a - b)); }
  // a área vem da origem: inventário e franquia nos grupos deles
  await expect(page.locator('.ini-grupo[data-area="inventario"]')).toContainText(/sem contagem/);
  await expect(page.locator('.ini-grupo[data-area="franquia"]')).toContainText(/Franquia:/);
  // sem caixa dentro de caixa: a linha não tem borda dos lados
  expect(await page.locator('.ini-grupo .ini-aviso').first().evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe('0px');
  await semRolagemLateral(page);
});

test('Pedido: ajustes numa linha só no computador e empilhados no celular', async ({ page }, info) => {
  await abrir(page);
  await ir(page, 'pedido');
  const linha = page.locator('.ped-ctl .ped-ctl-linha');
  await expect(linha).toBeVisible({ timeout: 30000 });
  const cx = async (sel) => page.locator(sel).first().boundingBox();
  const seg = await cx('.ped-ctl-linha .seg'), campo = await cx('.ped-ctl-linha .ped-ctl-g input'), salvar = await cx('.ped-ctl-salvar .btn'), sit = await cx('.ped-ctl .ped-cat');
  const meio = (b) => b.y + b.height / 2;
  if (info.project.name === 'computador') {
    // seletor, campos e "Salvar como padrão" na mesma linha, alinhados pelos campos; o salvar fica à direita
    expect(Math.abs(meio(seg) - meio(campo))).toBeLessThan(8);
    expect(Math.abs(meio(salvar) - meio(campo))).toBeLessThan(8);
    expect(salvar.x).toBeGreaterThan(campo.x + campo.width);
  } else {
    expect(campo.y).toBeGreaterThan(seg.y + seg.height - 1);
    expect(salvar.y).toBeGreaterThan(campo.y + campo.height - 1);
  }
  // a situação do estoque/catálogo vem embaixo, separada por uma divisória
  expect(sit.y).toBeGreaterThan(salvar.y + salvar.height - 1);
  await expect(page.locator('.ped-ctl .ped-cat')).toContainText('Estoque do AppNext');
  expect(await page.locator('.ped-ctl .ped-cat').evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
  await semRolagemLateral(page);
});

test('Resultado: quadros do mês primeiro; ponto de equilíbrio numa frase com a barra', async ({ page }) => {
  await abrir(page);
  await ir(page, 'dre');
  const eq = page.locator('.est-eq');
  await expect(eq).toBeVisible({ timeout: 30000 });
  const quadros = page.locator('main .g-kpi').first();
  await expect(quadros.locator('.kpi').first()).toContainText('Faturamento');
  expect((await quadros.boundingBox()).y).toBeLessThan((await eq.boundingBox()).y);
  // uma frase (falta ou já passou) + a barra; os quatro números e a conta ficam no ⓘ / title
  await expect(eq.locator('.est-eq-frase')).toContainText(/Faltam R\$\s.* para pagar os custos fixos .* equilíbrio em R\$|Custos fixos do mês .* pagos/);
  await expect(eq.locator('.est-eq-nums')).toHaveCount(0);
  await expect(eq.locator('.est-eq-barra')).toHaveAttribute('title', /Equilíbrio R\$\s.* vendido até .* no ritmo atual R\$/);
  await expect(eq.locator('.est-eq-frase .dica-i')).toHaveAttribute('aria-label', /Custos fixos R\$\s.* ÷ margem de contribuição/);
  // mês em andamento: uma linha discreta com ⓘ, não um aviso amarelo
  const and = page.locator('.dre-andamento');
  if (await and.count()) {
    await expect(and).toContainText(/Mês em andamento: \d+ de \d+ dias/);
    await expect(and.locator('.dica-i')).toHaveAttribute('aria-label', /Projeção do mês/);
    await expect(page.locator('main .notice', { hasText: 'está em andamento' })).toHaveCount(0);
  }
  await semRolagemLateral(page);
});

test('Estoque: Compartilhar e Imprimir juntos no canto direito do cabeçalho do gráfico', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'no celular o cabeçalho quebra a linha');
  await abrir(page);
  await ir(page, 'estoque');
  const card = page.locator('.card', { has: page.locator('.card-title', { hasText: 'Próximas semanas' }) }).first();
  await expect(card.locator('.shr-btn')).toBeVisible({ timeout: 30000 });
  const c = await card.boundingBox(), s = await card.locator('.shr-btn').boundingBox(), p = await card.locator('.card-head .prt-btn').boundingBox();
  expect(p.x - (s.x + s.width)).toBeLessThan(16); // lado a lado
  expect(Math.abs(p.y - s.y)).toBeLessThan(4);
  expect(c.x + c.width - (p.x + p.width)).toBeLessThan(24); // encostados na direita
});
