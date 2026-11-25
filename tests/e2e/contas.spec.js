// Contas oficiais: o mesmo faturamento em todas as telas, vendas da meta, projeção única, comissão só dentro de um mês,
// quem divide a meta, premiação com mínimo de atendimentos e comparações justas (28 dias, ano anterior = 364 dias).
const { test, expect } = require('./_base');

const abrir = async (page) => { await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas' && TS.contas); };
const ir = (page, tela) => page.evaluate((t) => { location.hash = '#' + t; }, tela);
const semRolagemLateral = async (page) => { const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); expect(d).toBeLessThanOrEqual(1); };
/** "R$ 12.345" → 12345 */
const num = (t) => +String(t).replace(/[^\d,-]/g, '').replace(',', '.');

test('Faturamento do mês: o mesmo número no Resumo, no Início e no Resultado', async ({ page }) => {
  await abrir(page);
  // a conta única, direto nos dados da apresentação
  const oficial = await page.evaluate(() => {
    const db = TS.db, ym = TS.dayToIso(db.maxDay).slice(0, 7);
    let s = 0;
    for (let i = 0; i < db.n; i++) if (db.ym[i] === ym && TS.contas.contaFat(db.D.descricao[db.desc[i]], db.vu[i])) s += db.vt[i] || 0;
    return Math.round(s);
  });
  expect(oficial).toBeGreaterThan(0);
  // Resumo, mês atual
  await page.evaluate(() => { TS.aplicarPreset('mes'); location.hash = '#resumo'; });
  // redesenho: o faturamento fica no cartão-herói do Resumo
  const fatResumo = page.locator('main .heroi-col', { hasText: 'Faturamento' }).first().locator('.heroi-num');
  await expect(fatResumo).toBeVisible({ timeout: 20000 });
  expect(Math.abs(num(await fatResumo.textContent()) - oficial)).toBeLessThanOrEqual(1);
  // Início (redesenho de 22/11/2026): o herói mostra o % da meta pelas VENDAS DA META (chás e acessórios, sem Espaço Gourmet),
  // a mesma base do Comissionamento; o faturamento do mês fica no Resumo e no Resultado (um número por fato)
  await ir(page, 'inicio');
  const her = page.locator('main .ini-heroi .heroi-pri');
  await expect(her).toBeVisible();
  const pct = await her.getAttribute('data-pct-meta');
  const esperado = await page.evaluate(() => { const db = TS.db, ym = TS.dayToIso(db.maxDay).slice(0, 7); const idx = TS.filtrar({ de: TS.isoToDay(ym + '-01'), ate: db.maxDay, mesLivre: true }); return TS.rules.vendasMeta(idx) / TS.metaCalc(ym).valor; });
  expect(Math.abs(+pct - esperado)).toBeLessThan(0.0002);
  // o número grande é o primeiro texto do .heroi-num (o "R$ x de R$ y" vem junto, em .heroi-sub)
  expect(+(await her.locator('.heroi-num').evaluate((el) => el.firstChild.textContent)).replace(/[^\d]/g, '')).toBe(Math.round(esperado * 100));
  await expect(her.locator('.dica-i').first()).toHaveAttribute('aria-label', /vendas da meta do mês|Vendas da meta do mês/i);
  // a projeção ("no ritmo de agora") abre a conta no ⓘ
  await expect(page.locator('main .ini-heroi .heroi-col').nth(1).locator('.dica-i')).toHaveAttribute('aria-label', /média do mesmo dia da semana|média simples por dia aberto/);
  await semRolagemLateral(page);
  // Resultado
  await ir(page, 'dre');
  const fatDre = page.locator('main .heroi .heroi-col', { hasText: 'Faturamento' }).first().locator('.heroi-num');
  await expect(fatDre).toBeVisible({ timeout: 30000 });
  expect(Math.abs(num(await fatDre.textContent()) - oficial)).toBeLessThanOrEqual(1);
  // a coluna da variação diz com o que compara (o mês inteiro do ano anterior)
  const cab = page.locator('.dre-t thead th.dre-var').first();
  if (await page.evaluate(() => TS.ehCelular())) await expect(cab).toHaveAttribute('title', /inteiro|INTEIRO/); // celular (LMOB-05): a variação vai embaixo do valor; o cabeçalho diz com o que compara
  else await expect(cab).toHaveText(/^(Projeção × \w{3}\/\d{2} inteiro|Variação)$/);
  await semRolagemLateral(page);
});

test('Projeção: uma conta só no Início, no Resumo, no Resultado e no equilíbrio', async ({ page }) => {
  await abrir(page);
  const p = await page.evaluate(() => { const ym = TS.dayToIso(TS.db.maxDay).slice(0, 7); const P = TS.projecaoMes(ym, { base: 'loja' }); return P ? { proj: Math.round(P.proj), real: P.realizado, hoje: P.hoje, feitos: P.feitos, n: P.n } : null; });
  test.skip(!p, 'a apresentação está com o mês fechado');
  // Início: o herói compara com a meta a projeção das VENDAS DA META, pela mesma conta (TS.projecaoMes)
  const pm = await page.evaluate(() => { const ym = TS.dayToIso(TS.db.maxDay).slice(0, 7); const P = TS.projecaoMes(ym, { base: 'meta' }); return P ? Math.round(P.proj) : null; });
  await ir(page, 'inicio');
  const her = page.locator('main .ini-heroi');
  await expect(her).toBeVisible();
  expect(Math.abs(+(await her.getAttribute('data-proj-loja')) - p.proj)).toBeLessThanOrEqual(1);
  if (pm != null) {
    expect(Math.abs(+(await her.getAttribute('data-proj-meta')) - pm)).toBeLessThanOrEqual(1);
    await expect(her).toContainText(/No ritmo de agora, fecha em \d+% \(R\$\s[\d.]+\)|Meta batida/);
  }
  await page.evaluate(() => { TS.aplicarPreset('mes'); location.hash = '#resumo'; });
  const res = page.locator('main .heroi-col', { hasText: 'Projeção do faturamento' }).locator('.heroi-num');
  await expect(res).toBeVisible({ timeout: 20000 });
  expect(Math.abs(num(await res.textContent()) - p.proj)).toBeLessThanOrEqual(1);
  // PROJ-CMP-01: a projeção comparada com o mês anterior inteiro e com o mesmo mês do ano passado inteiro
  const cmp = await page.evaluate(() => { const ym = TS.dayToIso(TS.db.maxDay).slice(0, 7); const P = TS.projecaoMes(ym, { base: 'loja' }); const ant = TS.fatMesInteiro(`${ym.slice(0, 4)}-${String(+ym.slice(5, 7) - 1 || 12).padStart(2, '0')}`.replace(/^(\d{4})-12$/, (x, y) => (+ym.slice(5, 7) === 1 ? `${+y - 1}-12` : x)), { base: 'loja' }); return { pct: ant ? Math.round((P.proj / ant - 1) * 100) : null }; });
  const linhaCmp = page.locator('main .heroi-col', { hasText: 'Projeção do faturamento' }).locator('.proj-cmp');
  await expect(linhaCmp).toContainText(/vs \w{3}\/\d{2}/);
  if (cmp.pct != null) await expect(linhaCmp).toContainText(`${cmp.pct >= 0 ? '+' : ''}${cmp.pct}%`);
  // Resultado: "vendendo R$ X no mês" é a mesma projeção; e a barra do equilíbrio também
  await ir(page, 'dre');
  const dre = page.locator('main .heroi .heroi-col', { hasText: 'Projeção do mês' }).locator('.dre-h-proj');
  await expect(dre).toBeVisible({ timeout: 30000 });
  expect(Math.abs(num((await dre.textContent()).replace(/no mês.*$/, '')) - p.proj)).toBeLessThanOrEqual(1);
  const barra = page.locator('.est-eq .est-eq-barra u');
  if (await barra.count()) expect(Math.abs(num(await barra.getAttribute('title')) - p.proj)).toBeLessThanOrEqual(1);
});

test('Comissionamento: só calcula dentro de um mês; meta dividida, vendas da meta e etiqueta de mês parcial', async ({ page }, info) => {
  await abrir(page);
  // período padrão (28 dias) passa de um mês: aviso "escolha um mês" em vez de somar dois meses contra uma meta
  await page.evaluate(() => { TS.aplicarPreset('30d'); location.hash = '#comissionamento'; });
  const passaDeUmMes = await page.evaluate(() => !TS.periodoUmMes());
  const aviso = page.locator('.notice[data-aviso="escolha-um-mes"]');
  if (passaDeUmMes) {
    await expect(aviso).toContainText('Escolha um mês');
    await expect(page.locator('main table.t')).toHaveCount(0);
    await aviso.getByRole('button', { name: 'Ver o mês atual' }).click();
  } else await page.evaluate(() => { TS.aplicarPreset('mes'); TS.render(); });
  await expect(aviso).toHaveCount(0);
  // redesenho: meta da loja e a divisão ficam na linha da coluna "Vendas da meta" do cartão-herói (o ⓘ dela tem a regra do piso)
  const meta = page.locator('main .heroi-col', { hasText: 'Vendas da meta' }).locator('.com-meta-loja');
  await expect(meta).toContainText(/Meta da loja R\$\s[\d.]+ · Meta dividida entre \d+ pessoas?/);
  await expect(meta.locator('.dica-i')).toHaveAttribute('aria-label', /dias? com venda no mês/);
  await expect(page.locator('main .heroi-col', { hasText: 'Vendas da meta' }).locator('.heroi-num')).toBeVisible();
  // o que a tela mostra é o que a regra devolve: divisores e quem ficou de fora
  const r = await page.evaluate(() => { const b = TS.filtrar(); const x = TS.rules.comissionamento({ base: b, baseSemVend: b, metaLoja: TS.metaPeriodo().valor || 0, vendBonus: '', ym: TS.metaPeriodo().ym, ate: TS.db.maxDay }); return { n: x.qtdVend, fora: x.foraDaMeta.length, poucos: x.rows.filter((y) => y.poucosAtend).length, piso: x.piso }; });
  await expect(meta.locator('[data-meta-div]')).toHaveAttribute('data-meta-div', String(r.n));
  await expect(page.locator('[data-fora-meta]')).toHaveCount(r.fora ? 1 : 0);
  // mês em andamento: etiqueta avisa que a faixa ainda pode mudar
  const parcial = await page.evaluate(() => TS.metaPeriodo().ym === TS.hojeSP().slice(0, 7));
  if (parcial) await expect(page.locator('.com-parcial')).toContainText('parcial: a faixa pode mudar até o fim do mês');
  // premiação: quem tem poucos atendimentos aparece com o motivo
  if (r.poucos) await expect(page.locator('main', { hasText: 'poucos atendimentos (' }).first()).toBeVisible();
  // período personalizado dentro do mês continua valendo; passando de um mês, volta o aviso
  await page.evaluate(() => { const f = TS.state.f, d = new Date(TS.db.maxDay * 864e5); f.preset = 'custom'; f.ano = null; f.mes = null; f.ate = TS.db.maxDay; f.de = TS.db.maxDay - d.getUTCDate() - 3; TS.render(); });
  await expect(aviso).toContainText('Escolha um mês');
  if (info.project.name === 'celular') await semRolagemLateral(page);
});

test('Período "28 dias" e "vs. ano anterior" pelos mesmos dias da semana', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(() => {
    TS.aplicarPreset('30d');
    const f = TS.state.f, pi = TS.periodosIguais(f.de, f.ate);
    return { dias: f.ate - f.de + 1, preset: f.preset, ano: f.de - pi.ano.de, rotulo: TS.PRESETS.find((p) => p[1] === '30d')[0] };
  });
  expect(r).toEqual({ dias: 28, preset: '30d', ano: 364, rotulo: '28 dias' });
  await ir(page, 'resumo');
  const fat = page.locator('main .heroi-col', { hasText: 'Faturamento' }).first();
  await expect(fat.locator('.kpi-vars')).toBeVisible({ timeout: 20000 });
  const linhas = await fat.locator('.kpi-vars > span').evaluateAll((xs) => xs.map((x) => [x.textContent, x.title]));
  expect(linhas.some(([t, d]) => /· 28 dias$/.test(t) && /^vs\. 28 dias anteriores · comparado com \d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}$/.test(d))).toBe(true);
});

test('Regras da loja: piso de dias da meta e mínimo de atendimentos da premiação aparecem com explicação', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'só no computador');
  await abrir(page);
  const padrao = await page.evaluate(() => { const rg = TS.rules.MODELOS.padrao.regras; return { piso: rg.pisoDiasMeta, min: rg.premiacao.minAtend, c: [TS.contas.PISO_DIAS_META, TS.contas.MIN_ATEND_PREMIACAO] }; });
  expect(padrao).toEqual({ piso: 4, min: 20, c: [4, 20] });
  // Configurações → loja → Regras de comissão: os dois campos novos, com o padrão e a explicação
  await page.evaluate(() => { location.hash = '#config'; });
  await page.locator('table.cfg-lojas-t .cfg-abrir').first().click();
  const card = page.locator('.cfg-loja');
  const links = card.locator('.cfg-sub a');
  const n = await links.count();
  const piso = card.locator('input[data-regra="pisoDiasMeta"]');
  for (let k = 0; k < n && !(await piso.count()); k++) { await links.nth(k).evaluate((el) => el.click()); await page.waitForTimeout(150); }
  await expect(piso).toHaveValue('4');
  await expect(card.locator('input[data-regra="minAtend"]')).toHaveValue('20');
  await expect(card.locator('.cfg-loja-corpo')).toContainText('Divide a meta quem tem pelo menos');
  await expect(card.locator('.cfg-loja-corpo')).toContainText('Mínimo de atendimentos no mês');
});

test('CUP-01: Cupons usa a conta oficial — cupons e itens iguais aos do Resumo e ao total da lista', async ({ page }) => {
  await abrir(page);
  // a conta oficial do período (a mesma do Resumo, do TKM, do PMA e do IPA)
  const of = await page.evaluate(() => { const m = TS.metricas(TS.filtrar()); return { cupons: m.cupons, itens: m.qtd, vt: m.vt }; });
  expect(of.cupons).toBeGreaterThan(0);
  await ir(page, 'cupons');
  const heroi = page.locator('main .heroi-col').first();
  await expect(heroi).toContainText(new Intl.NumberFormat('pt-BR').format(of.cupons));
  await expect(heroi).toContainText(new Intl.NumberFormat('pt-BR').format(of.itens) + ' ite');
  // total da árvore (por dia e cupom) = os mesmos cupons e itens
  const tot = page.locator('.cupons-t tfoot td');
  const txt = await tot.allInnerTexts();
  const nums = txt.slice(-3).map(num);
  expect(nums[0]).toBe(of.cupons);
  expect(nums[1]).toBe(of.itens);
  expect(Math.abs(nums[2] - of.vt)).toBeLessThan(0.05);
  // lista de itens: o total também
  await page.locator('main .seg button', { hasText: 'Lista de itens' }).click();
  const tf = await page.locator('main table tfoot, main .lmob-total').first().innerText(); // no celular, o total da lista em linhas (LMOB-03)
  expect(tf).toContain(new Intl.NumberFormat('pt-BR').format(of.cupons) + ' cupons');
  expect(tf).toContain(new Intl.NumberFormat('pt-BR').format(of.itens));
});

// ---------- NUM-01…03: um número por fato entre telas (mesmo período, mesma conta oficial: TS.metricas / TS.contas) ----------
/** número da coluna do herói pelo rótulo */
const heroiNum = (page, rot) => page.locator('main .heroi-col', { hasText: rot }).first().locator('.heroi-num').first();
/** número de apoio dentro do herói (TKM, PMA, IPA… em linhas) */
const apoioNum = (page, rot) => page.locator('main .vp2-apoio li', { hasText: rot }).first().locator('.linhas-num-v');
/** primeira linha de cada célula do total (tfoot) da tabela dentro do cartão pelo título */
const totalDe = async (page, sel) => (await page.locator(sel).first().locator('tfoot td').allInnerTexts()).map((t) => t.split('\n')[0].trim());
const perto = (a, b, tol, rot) => expect(Math.abs(a - b), `${rot}: tela ${a} × conta ${b}`).toBeLessThanOrEqual(tol);
const oficial = (page) => page.evaluate(() => { const m = TS.metricas(TS.filtrar()); return { vt: m.vt, cupons: m.cupons, itens: m.qtd, tkm: m.vt / m.cupons, pma: m.vt / m.qtd, ipa: m.qtd / m.cupons }; });

for (const preset of ['28d', 'mes']) {
  test(`NUM-01 (${preset}): faturamento, atendimentos, itens, TKM, PMA e IPA iguais no Resumo, Cupons, Comparativos e Promoção`, async ({ page }, info) => {
    test.skip(info.project.name !== 'computador', 'conta igual nos dois tamanhos; os totais das tabelas são lidos no computador');
    await abrir(page);
    await page.evaluate((p) => TS.aplicarPreset(p), preset);
    const of = await oficial(page);
    expect(of.cupons).toBeGreaterThan(0);
    // Resumo: herói, linhas de apoio e o total da tabela por vendedor
    await ir(page, 'resumo');
    await expect(heroiNum(page, 'Faturamento')).toBeVisible({ timeout: 20000 });
    perto(num(await heroiNum(page, 'Faturamento').textContent()), of.vt, 1, 'Resumo · faturamento');
    perto(num(await heroiNum(page, 'Atendimentos').textContent()), of.cupons, 0, 'Resumo · atendimentos');
    perto(num(await apoioNum(page, 'TKM').textContent()), of.tkm, 0.01, 'Resumo · TKM');
    perto(num(await apoioNum(page, 'PMA').textContent()), of.pma, 0.01, 'Resumo · PMA');
    perto(num(await apoioNum(page, 'IPA').textContent()), of.ipa, 0.006, 'Resumo · IPA');
    const tv = await totalDe(page, 'main .card:has(.card-title:text("Desempenho por vendedor")) table');
    perto(num(tv[1]), of.vt, 0.05, 'Resumo · total por vendedor'); perto(num(tv[2]), of.cupons, 0, 'Resumo · cupons por vendedor');
    perto(num(tv[3]), of.tkm, 0.01, 'Resumo · TKM por vendedor'); perto(num(tv[4]), of.pma, 0.01, 'Resumo · PMA por vendedor'); perto(num(tv[5]), of.ipa, 0.006, 'Resumo · IPA por vendedor');
    // Cupons
    await ir(page, 'cupons');
    const hc = page.locator('main .heroi-col').first();
    await expect(hc).toBeVisible();
    perto(num(await hc.locator('.heroi-num').first().textContent()), of.cupons, 0, 'Cupons · cupons');
    await expect(hc).toContainText(new Intl.NumberFormat('pt-BR').format(of.itens) + ' ite');
    // Comparativos: herói e o Total da Evolução mensal
    await ir(page, 'comparativos');
    await expect(heroiNum(page, 'Faturamento')).toBeVisible({ timeout: 20000 });
    perto(num(await heroiNum(page, 'Faturamento').textContent()), of.vt, 1, 'Comparativos · faturamento');
    perto(num(await heroiNum(page, 'Cupons').textContent()), of.cupons, 0, 'Comparativos · cupons');
    perto(num(await apoioNum(page, 'TKM').textContent()), of.tkm, 0.01, 'Comparativos · TKM');
    perto(num(await apoioNum(page, 'PMA').textContent()), of.pma, 0.01, 'Comparativos · PMA');
    perto(num(await apoioNum(page, 'IPA').textContent()), of.ipa, 0.006, 'Comparativos · IPA');
    const te = await totalDe(page, '#cp-evol table');
    perto(num(te[1]), of.vt, 0.05, 'Evolução · total'); perto(num(te[2]), of.cupons, 0, 'Evolução · cupons');
    perto(num(te[3]), of.tkm, 0.01, 'Evolução · TKM'); perto(num(te[4]), of.pma, 0.01, 'Evolução · PMA'); perto(num(te[5]), of.ipa, 0.006, 'Evolução · IPA');
    // Promoção (o "período" é o mesmo do filtro)
    await ir(page, 'promocao');
    await expect(heroiNum(page, 'Faturamento')).toBeVisible({ timeout: 20000 });
    perto(num(await heroiNum(page, 'Faturamento').textContent()), of.vt, 1, 'Promoção · faturamento');
    perto(num(await heroiNum(page, 'Atendimentos').textContent()), of.cupons, 0, 'Promoção · atendimentos');
    perto(num(await heroiNum(page, 'TKM').textContent()), of.tkm, 0.01, 'Promoção · TKM');
    perto(num(await apoioNum(page, 'PMA').textContent()), of.pma, 0.01, 'Promoção · PMA');
    perto(num(await apoioNum(page, 'IPA').textContent()), of.ipa, 0.006, 'Promoção · IPA');
  });
}

test('NUM-02: Vendas por produto (Resumo) fecha com o topo — itens, chá vendido (kg) e faturamento', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'total da tabela lido no computador');
  await abrir(page);
  await page.evaluate(() => TS.aplicarPreset('28d'));
  const of = await oficial(page);
  await ir(page, 'resumo');
  await expect(heroiNum(page, 'Faturamento')).toBeVisible({ timeout: 20000 });
  const kgHeroi = num(await apoioNum(page, 'Chá vendido').textContent());
  const tp = await totalDe(page, 'main .card:has(.card-title:text("Vendas por produto")) table');
  perto(num(tp[1]), of.itens, 0, 'Vendas por produto · itens (sem R$ 0,01 e sem consumível sem controle)');
  perto(num(tp[2]), kgHeroi, 0.001, 'Vendas por produto · kg × Chá vendido do herói');
  perto(num(tp[3]), of.vt, 0.05, 'Vendas por produto · faturamento');
});

test('NUM-03: Comissionamento — vendas da meta iguais à conta oficial; TKM da equipe explica que é sem o Espaço Gourmet', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'tabela lida no computador');
  await abrir(page);
  const r = await page.evaluate(() => {
    const db = TS.db, ym = TS.dayToIso(db.maxDay).slice(0, 7);
    const idx = TS.filtrar({ de: TS.isoToDay(ym + '-01'), ate: db.maxDay, mesLivre: true });
    const semEG = idx.filter((i) => db.D.cat[db.cat[i]] !== TS.contas.EG);
    return { vendasMeta: TS.rules.vendasMeta(idx), eg: TS.indicadores(semEG) };
  });
  await page.evaluate(() => TS.aplicarPreset('mes'));
  await ir(page, 'comissionamento');
  await expect(heroiNum(page, 'Vendas da meta')).toBeVisible({ timeout: 20000 });
  perto(num(await heroiNum(page, 'Vendas da meta').textContent()), r.vendasMeta, 1, 'Comissionamento · vendas da meta');
  // Início: o "R$ x de R$ y" do herói usa as mesmas vendas da meta
  const tabCom = 'main table:has(th:has-text("TKM · PMA · IPA"))';
  await expect(page.locator(tabCom).first()).toBeVisible();
  const t = await totalDe(page, tabCom);
  const linhaInd = t.find((x) => /^R\$/.test(x) && Math.abs(num(x) - r.eg.tkm) < 0.01);
  expect(linhaInd, `TKM da equipe (sem EG) ${r.eg.tkm} no total: ${t.join(' | ')}`).toBeTruthy();
  const th = page.locator(tabCom + ' thead th', { hasText: 'TKM' }).first();
  await expect(th.locator('.dica-i')).toHaveAttribute('aria-label', /Espaço Gourmet/);
  await ir(page, 'inicio');
  const sub = await page.locator('main .ini-heroi .heroi-pri').innerText();
  expect(sub.replace(/\s+/g, ' ')).toContain(new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.round(r.vendasMeta)));
});

test('DRE-ESTR-01: Resultado como na contabilidade — receita líquida = faturamento − Simples; lucro bruto = receita líquida − CMV (custo + perdas); margem de contribuição = bruto − variáveis; resultado = margem − fixos ± financeiro; o lucro bruto bate com a Rentabilidade', async ({ page }) => {
  await abrir(page);
  const r = await page.evaluate(async () => {
    const M = await TS.custosLoja();
    const meses = TS.dreCalcular(M, {});
    const m = meses[meses.length - 2] || meses[meses.length - 1]; // último mês fechado
    return { ym: m.ym, fat: m.fat, cmv: m.cmv, lb: m.lucroBruto, imp: m.imp, maq: m.maq, roy: m.roy, com: m.com, varPct: m.varPct, contrib: m.contrib, perdas: m.perdas || 0, fixo: m.fixoTot, fin: m.fin, res: m.resultado, cmvTot: m.cmvTot, acertos: m.acertos, difal: m.difal, est: m.est, cmvEst: m.cmvEst, cobre: m.cobre, custo: m.custo, fatCusto: m.fatCusto };
  });
  const perto = (a, b, msg) => expect(Math.abs(a - b), msg).toBeLessThan(0.05);
  perto(r.lb, r.fat - r.imp - r.cmvTot, 'lucro bruto = receita líquida − CMV');
  perto(r.cmvTot, r.cmv + r.acertos + r.difal, 'CMV = custo das vendas + perdas e acertos + DIFAL');
  if (r.est) perto(r.cmvEst, r.est.ini.valor + r.est.compras - r.est.devolucoes - r.est.fim.valor, 'CMV pelo estoque (CMV-EST-01)');
  else perto(r.acertos, r.perdas, 'sem foto do estoque: as perdas conhecidas');
  perto(r.contrib, r.lb - r.maq - r.roy - r.com - r.varPct, 'margem de contribuição');
  perto(r.res, r.contrib - r.fixo + (r.fin || 0), 'resultado');
  // a parte com custo cadastrado é a mesma conta da Rentabilidade (venda − custo, só das vendas com custo)
  perto(r.fatCusto - r.custo, (r.lb + r.imp + r.acertos + r.difal) * (r.fatCusto / r.fat) + 0, 'mesma margem nas vendas com custo');
  // a tela do Resultado mostra os três degraus com estes nomes, na ordem
  await ir(page, 'dre');
  const t = page.locator('main');
  await expect(t).toContainText('= Lucro bruto', { timeout: 30000 });
  const txt = await t.innerText();
  const ordem = ['Receita bruta', 'Simples Nacional', '= Receita líquida', 'CMV', '= Lucro bruto', '= Margem de contribuição', '= Resultado operacional', 'Resultado financeiro', '= Resultado líquido'].map((x) => txt.indexOf(x));
  expect(ordem.every((v) => v >= 0), 'todas as linhas aparecem').toBe(true);
  expect([...ordem].sort((a, b) => a - b), 'na ordem dos três degraus').toEqual(ordem);
});

// FAT-DESC-01 e CMP-MES-01 (pedido do dono, 25/11/2026): o Faturamento do Resumo mostra a conta preço cheio − descontos;
// com um mês inteiro no filtro, todos os quadros comparam com o mês anterior inteiro e o mesmo mês do ano anterior inteiro
test('FAT-DESC-01, CMP-MES-01: Resumo do mês inteiro — conta dos descontos e comparação com os meses inteiros (com as datas)', async ({ page }) => {
  await abrir(page);
  const ref = await page.evaluate(() => {
    TS.aplicarPreset('mesAnt');
    const f = TS.state.f, pi = TS.periodosIguais(f.de, f.ate);
    const idx = TS.filtrar().filter((i) => TS.contaFat(i));
    const vt = idx.reduce((a, i) => a + (TS.db.vt[i] || 0), 0), desc = TS.descontos(idx);
    const soma = (de, ate) => TS.filtrar({ de, ate }).filter((i) => TS.contaFat(i)).reduce((a, i) => a + (TS.db.vt[i] || 0), 0);
    const ano = soma(pi.ano.de, pi.ano.ate);
    return { ym: pi.mesInteiro, de: TS.dayToIso(f.de), ano: { de: TS.dayToIso(pi.ano.de), ate: TS.dayToIso(pi.ano.ate), txt: pi.ano.txt }, mes: { de: TS.dayToIso(pi.mes.de), ate: TS.dayToIso(pi.mes.ate), txt: pi.mes.txt },
      vt: Math.round(vt), cheio: Math.round(vt + desc), desc: Math.round(desc), varAno: ano ? Math.round((vt / ano - 1) * 1000) / 10 : null };
  });
  // o mês inteiro do filtro → mês anterior inteiro e o mesmo mês do ano anterior inteiro
  expect(ref.ym).toBe(ref.de.slice(0, 7));
  expect(ref.ano.de).toBe(`${+ref.de.slice(0, 4) - 1}${ref.de.slice(4, 7)}-01`);
  expect(ref.mes.ate < ref.de && ref.mes.de.slice(8)).toBe('01');
  expect(ref.ano.txt).toMatch(/^vs\. [a-z]{3}\/\d{2}$/);
  await ir(page, 'resumo');
  const fat = page.locator('main .heroi-col', { hasText: 'Faturamento' }).first();
  await expect(fat.locator('.heroi-num')).toBeVisible({ timeout: 20000 });
  const conta = fat.locator('.fat-conta');
  await expect(conta).toBeVisible();
  const vals = await conta.locator('.fat-conta-l b').allTextContents();
  expect(Math.abs(num(vals[0]) - ref.cheio)).toBeLessThanOrEqual(1);
  expect(Math.abs(num(vals[1]) - ref.desc)).toBeLessThanOrEqual(1);
  expect(Math.abs(num(vals[2]) - ref.vt)).toBeLessThanOrEqual(1);
  expect(Math.abs(num(await fat.locator('.heroi-num').textContent()) - ref.vt)).toBeLessThanOrEqual(1);
  // os rótulos e as datas da comparação; o % do ano é o do mês inteiro (a base do Resultado)
  const linhas = await fat.locator('.kpi-vars > span').evaluateAll((xs) => xs.map((x) => [x.textContent, x.title]));
  const lAno = linhas.find(([t]) => t.endsWith(ref.ano.txt));
  expect(lAno).toBeTruthy();
  expect(lAno[1]).toContain(`${ref.ano.de.slice(8)}/${ref.ano.de.slice(5, 7)}/${ref.ano.de.slice(0, 4)}`);
  expect(Math.abs(parseFloat(lAno[0].replace(',', '.')) - ref.varAno)).toBeLessThanOrEqual(0.1);
  expect(linhas.some(([t, d]) => t.endsWith(ref.mes.txt) && /comparado com/.test(d))).toBe(true);
  // todos os quadros usam a mesma régua: Faturamento, Atendimentos, TKM, PMA, IPA e Chá vendido
  const her = await page.locator('main .heroi').first().innerText();
  expect(her.split(ref.ano.txt).length - 1).toBe(6);
  expect(her.split(ref.mes.txt).length - 1).toBe(6);
  await semRolagemLateral(page);
});
