// Leiaute de base: quadros de número com estado, cartões sem sombra, texto de apoio numa frase,
// avisos do Início em lista agrupada, ajustes do Pedido em linha e topo do Resultado.
const { test, expect } = require('./_base');

const abrir = async (page) => { await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas'); };
const ir = (page, tela) => page.evaluate((t) => { location.hash = '#' + t; }, tela);
const semRolagemLateral = async (page) => { const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); expect(d).toBeLessThanOrEqual(1); };
const barra = (loc) => loc.evaluate((el) => getComputedStyle(el, '::before').content);
const token = (page, nome) => page.evaluate((n) => { const x = document.createElement('i'); x.style.color = `var(${n})`; document.body.append(x); const c = getComputedStyle(x).color; x.remove(); return c; }, nome);

test('Quadros: sem barra lateral (estado só na cor do texto e na marca kpi-bom/kpi-ruim); cartão sem sombra', async ({ page }) => {
  await abrir(page);
  // 2ª passada (23/11/2026): o Estoque abre com o cartão-herói; os quadros de apoio que sobraram no grupo são os de
  // compras × teto do Pedido (abrem em "ver a conta"). O quadro "ruim" é montado com o próprio TS.kpi na tela.
  await ir(page, 'pedido');
  const cv = page.locator('.cv-pedido');
  await expect(cv).toBeVisible({ timeout: 30000 });
  if (!(await cv.evaluate((el) => el.open))) await cv.locator('summary').click();
  const [bad, good] = [await token(page, '--bad'), await token(page, '--good')];
  await page.evaluate(() => { const k = TS.kpi('Quadro de teste', '10', TS.h('span', { class: 'down' }, '3 urgentes')); k.id = 'kpi-teste'; document.querySelector('.cv-pedido .g-kpi').append(k); });
  const repor = page.locator('#kpi-teste');
  // decisão do dono, 22/11/2026 (visual limpo do protótipo do Início): nenhum quadro tem barra lateral; o estado fica na
  // marca kpi-bom/kpi-ruim e na cor do texto da comparação. Comparação em vermelho = ruim; "Teto de compras" = neutro.
  await expect(repor).toHaveClass(/kpi-ruim/);
  expect(await barra(repor)).toBe('none');
  expect(await repor.locator('.kpi-foot .down, .kpi-foot .neg').first().evaluate((el) => getComputedStyle(el).color)).toBe(bad);
  const neutro = page.locator('.cv-pedido .kpi', { hasText: 'Teto de compras' });
  await expect(neutro).not.toHaveClass(/kpi-(bom|ruim)/);
  expect(await barra(neutro)).toBe('none');
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

  // Início (redesenho de 22/11/2026): sem quadros com barra; no herói o "no ritmo de agora" é texto verde (bate a meta) ou vermelho
  await ir(page, 'inicio');
  const her = page.locator('.ini-heroi');
  await expect(her).toBeVisible();
  await expect(page.locator('main .g-kpi')).toHaveCount(0);
  const ritmo = her.locator('.heroi-linha', { hasText: 'No ritmo de agora' });
  if (await ritmo.count()) {
    const bate = +(await her.getAttribute('data-proj-meta')) >= (await page.evaluate(() => TS.metaCalc(TS.dayToIso(TS.db.maxDay).slice(0, 7)).valor));
    await expect(ritmo).toHaveClass(bate ? /\bpos\b/ : /\bneg\b/);
    expect(await ritmo.evaluate((el) => getComputedStyle(el).color)).toBe(bate ? good : bad);
  }
  expect(await her.evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe('1px');
  expect(await her.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
});

test('Vendas → Resumo: variações curtas com a frase completa no title e nenhum quadro sozinho na última linha', async ({ page }, info) => {
  await abrir(page);
  await ir(page, 'resumo');
  // redesenho: faturamento no cartão-herói; os indicadores de venda (TKM, PMA, IPA, chá, EG) na grade de apoio
  const fat = page.locator('.heroi-col', { hasText: 'Faturamento' }).first();
  await expect(fat.locator('.kpi-vars')).toBeVisible({ timeout: 20000 });
  const linhas = await fat.locator('.kpi-vars > span').evaluateAll((xs) => xs.map((x) => [x.textContent, x.title]));
  expect(linhas.some(([t, dica]) => /· \d+ dias$/.test(t) && /^vs\. \d+ dias anteriores$/.test(dica))).toBe(true);
  // "· ano" = os mesmos dias da semana, 364 dias antes (a frase completa diz isso)
  expect(linhas.some(([t, dica]) => /· ano$/.test(t) && /^vs\. ano anterior: o mesmo período 364 dias antes/.test(dica))).toBe(true);
  // 2ª passada (23/11/2026): os 5 indicadores de apoio (TKM, PMA, IPA, chá, EG) são linhas dentro do herói, sem quadros soltos;
  // cada um com o número e a variação curta embaixo do rótulo (a frase completa no title)
  const apoio = page.locator('.heroi .vp2-apoio .linhas-num li');
  await expect(apoio).toHaveCount(5);
  await expect(page.locator('main .g-kpi')).toHaveCount(0);
  const tkm = apoio.filter({ hasText: 'Ticket médio (TKM)' });
  await expect(tkm.locator('.linhas-num-v')).toContainText('R$');
  expect(await tkm.locator('.kpi-vars > span').evaluateAll((xs) => xs.some((x) => /· ano$/.test(x.textContent) && /^vs\. ano anterior/.test(x.title)))).toBe(true);
  // tabela por vendedor sem rolar para o lado: os tipos de chá ficam embaixo do total, na mesma célula
  await expect(page.locator('#rs-vend')).toContainText('Chá (kg) por tipo');
  if (info.project.name === 'computador') expect(await page.locator('#rs-vend .table-wrap').first().evaluate((w) => w.scrollWidth - w.clientWidth)).toBeLessThanOrEqual(1);
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

test('Início: avisos numa lista só, agrupados por área; "Dados e configuração" primeiro e os grupos pela gravidade', async ({ page }) => {
  await abrir(page);
  await ir(page, 'inicio');
  await expect(page.locator('.ini-pend')).toHaveCount(0, { timeout: 30000 });
  await page.locator('.ini-ver-todos').click(); // a lista completa fica em "Ver todos" (redesenho de 22/11/2026)
  const grupos = page.locator('.ini-avisos .ini-grupo');
  expect(await grupos.count()).toBeGreaterThan(1);
  // todo aviso está dentro de um grupo; o cabeçalho traz o nome da área e a contagem certa
  await expect(page.locator('.ini-avisos > .ini-aviso')).toHaveCount(0);
  const dados = await grupos.evaluateAll((gs) => gs.map((g) => ({ area: g.dataset.area, n: +g.querySelector('.ini-grupo-t span').textContent, niveis: [...g.querySelectorAll('.ini-aviso')].map((a) => (a.classList.contains('ini-erro') ? 0 : 1)), niveis3: [...g.querySelectorAll('.ini-aviso')].map((a) => (a.classList.contains('ini-erro') ? 0 : a.classList.contains('ini-warn') ? 1 : 2)) })));
  for (const d of dados) expect(d.niveis3).toEqual([...d.niveis3].sort((a, b) => a - b));
  // ordem dos grupos (decisão do dono, 22/11/2026): Dados e configuração sempre primeiro; depois pelo pior aviso de cada
  // grupo (vermelho > amarelo > azul); no empate, a ordem fixa das áreas
  const ORDEM = ['dados', 'estoque', 'inventario', 'franquia', 'vendas', 'outros'];
  const chave = (d) => [d.area === 'dados' ? -1 : Math.min(...d.niveis3), ORDEM.indexOf(d.area)];
  const ks = dados.map(chave);
  expect(ks).toEqual([...ks].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  for (const d of dados) { expect(d.niveis.length).toBe(d.n); expect(d.niveis).toEqual([...d.niveis].sort((a, b) => a - b)); }
  // a área vem da origem: inventário e franquia nos grupos deles
  await expect(page.locator('.ini-grupo[data-area="inventario"]')).toContainText(/sem contagem/);
  await expect(page.locator('.ini-grupo[data-area="franquia"]')).toContainText(/Franquia:/);
  // sem caixa dentro de caixa: a linha não tem borda dos lados
  expect(await page.locator('.ini-grupo .ini-aviso').first().evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe('0px');
  await semRolagemLateral(page);
});

test('Início: a conta da ordem dos grupos e uma fonte que falha aparece (nunca "nada pedindo atenção")', async ({ page }) => {
  await abrir(page);
  await ir(page, 'inicio');
  await expect(page.locator('.ini-pend')).toHaveCount(0, { timeout: 30000 });
  const ord = await page.evaluate(() => TS.inicioCalc.ordemGrupos([
    { area: 'estoque', nivel: 'warn' }, { area: 'vendas', nivel: 'erro' }, { area: 'outros', nivel: 'info' },
    { area: 'dados', nivel: 'info' }, { area: 'franquia', nivel: 'warn' }, { area: 'xyz', nivel: 'warn' },
  ]).map((g) => g.area + ':' + g.avisos.length));
  // dados primeiro; o vermelho de Vendas sobe; estoque e franquia (amarelos) na ordem fixa; Outros junta o desconhecido
  expect(ord).toEqual(['dados:1', 'vendas:1', 'estoque:1', 'franquia:1', 'outros:2']);
  // saudação pelo relógio de São Paulo
  expect(await page.evaluate(() => TS.inicioCalc.horaSP(new Date('2026-11-22T12:30:00Z')))).toBe(9);
  // uma fonte quebra: a tela diz que não conferiu e oferece tentar de novo
  await page.evaluate(() => { TS.estoqueBuscar = () => Promise.reject(new Error('falhou')); TS.render(); });
  await expect(page.locator('.ini-falhou')).toContainText('Não consegui conferir');
  await expect(page.locator('.ini-falhou')).toContainText('o estoque');
  await expect(page.locator('.ini-avisos')).not.toContainText('Nada pedindo atenção');
});

test('Pedido: ajustes numa linha só no computador e empilhados no celular', async ({ page }, info) => {
  await abrir(page);
  await ir(page, 'pedido');
  if (info.project.name === 'celular') {
    // no celular os ajustes abrem recolhidos numa linha de resumo; tocar mostra os campos
    const rec = page.locator('.ped-ctl .ped-ctl-rec > summary');
    await expect(rec).toContainText(/Reposição · .* das vendas · \d+ dias/, { timeout: 30000 });
    await expect(page.locator('.ped-ctl .ped-ctl-linha')).toBeHidden();
    await rec.click();
  }
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
  // redesenho de 22/11: o resultado do mês é o cartão-herói (resultado, projeção, faturamento com as margens)
  const quadros = page.locator('main .heroi').first();
  await expect(quadros.locator('.heroi-col').first()).toContainText(/Resultado (do mês|até hoje)/);
  await expect(quadros).toContainText('Faturamento');
  expect((await quadros.boundingBox()).y).toBeLessThan((await eq.boundingBox()).y);
  // uma frase (falta ou já passou) + a barra; os quatro números e a conta ficam no ⓘ / title
  await expect(eq.locator('.est-eq-frase')).toContainText(/Faltam R\$\s.* para pagar os custos fixos .* equilíbrio em R\$|Custos fixos do mês.* pagos/);
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
  expect(c.x + c.width - (p.x + p.width)).toBeLessThan(32); // encostados na direita (padding do cartão: 24 px)
});
