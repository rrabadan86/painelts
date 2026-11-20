// Visão do dono: "Sua semana" e aviso de validade no Início, lojas lado a lado com "Todas as lojas",
// linha de perdas no Resultado e meta de hoje dividida pelas horas da escala.
const { test, expect } = require('@playwright/test');

const abrir = async (page) => { await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas' && TS.visaoDono); };
const ir = (page, tela) => page.evaluate((t) => { location.hash = '#' + t; }, tela);
const semRolagemLateral = async (page) => { const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); expect(d).toBeLessThanOrEqual(1); };
const num = (t) => +String(t).replace(/[^\d,-]/g, '').replace(',', '.');
const semLixo = async (loc) => { expect(await loc.innerText()).not.toMatch(/\b(null|undefined|NaN)\b/); };
const print = async (page, info, nome) => { if (process.env.PRINTS) await page.screenshot({ path: `${process.env.PRINTS}/${nome}-${info.project.name}.png`, fullPage: true }); };

test('Início: "Sua semana" vem primeiro, com 5 números explicados e até 3 ações que levam à tela certa', async ({ page }, info) => {
  await abrir(page);
  await ir(page, 'inicio');
  const s = page.locator('main details.vd-semana');
  await expect(s).toBeVisible();
  // vem antes dos quadros de vendas do Início
  const antes = await page.evaluate(() => { const a = document.querySelector('main details.vd-semana'), b = [...document.querySelectorAll('main > * .kpi, main .grid.g-kpi')].find((x) => !a.contains(x)); return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); });
  expect(antes).toBe(true);
  for (const rot of ['Vendas da semana', 'Meta do mês', 'Margem de contribuição da semana', 'Zerados que vendem', 'Validade em risco']) await expect(s.locator('.kpi', { hasText: rot })).toBeVisible();
  // os três quadros que dependem do estoque terminam de calcular
  await expect(s.locator('.kpi', { hasText: 'Margem de contribuição da semana' }).locator('.kpi-value')).not.toHaveText('…', { timeout: 30000 });
  await expect(s.locator('.kpi', { hasText: 'Validade em risco' }).locator('.kpi-value')).toHaveText(/R\$/);
  expect(await s.locator('.kpi .dica-i').count()).toBeGreaterThanOrEqual(5); // todo quadro tem ⓘ
  const acoes = s.locator('.vd-acao');
  await expect(acoes.first()).toBeVisible();
  expect(await acoes.count()).toBeLessThanOrEqual(3);
  await semLixo(s);
  await semRolagemLateral(page);
  await print(page, info, 'inicio-semana');
  // a ação leva à tela dela
  const tipo = await acoes.first().getAttribute('data-acao');
  await acoes.first().click();
  const destino = { zerados: /#(pedido|estoque)/, vencidos: /#validade/, criticos: /#validade/, franquia: /#creditos/, parado: /#estoque/, meta: /#hoje/ }[tipo];
  await expect(page).toHaveURL(destino);
});

test('Início: "Sua semana" recolhe e continua recolhida ao voltar; a vendedora e "Todas as lojas" não mostram', async ({ page }) => {
  await abrir(page);
  await ir(page, 'inicio');
  const s = page.locator('main details.vd-semana');
  await expect(s).toBeVisible();
  await s.locator('summary').click();
  await expect(s.locator('.kpi').first()).toBeHidden();
  await ir(page, 'resumo'); await ir(page, 'inicio');
  await expect(page.locator('main details.vd-semana')).toBeVisible();
  expect(await page.locator('main details.vd-semana').evaluate((d) => d.open)).toBe(false);
  await page.locator('main details.vd-semana summary').click();
  // só admin e franqueado
  const vend = await page.evaluate(() => { const p = TS.eu.perfil; TS.eu.perfil = 'vendedor'; const r = TS.visaoDono.mostraSemana() || TS.visaoDono.mostraLojas(); TS.eu.perfil = 'gerente'; const g = TS.visaoDono.mostraSemana(); TS.eu.perfil = p; return { r, g }; });
  expect(vend).toEqual({ r: false, g: false });
});

test('Início: aviso de validade no grupo Estoque (vencidos em vermelho, até 30 dias em amarelo) abre a Validade já filtrada', async ({ page }) => {
  await abrir(page);
  // os números do aviso são os da tela Validade
  const pf = await page.evaluate(async () => (await TS.validade.dados(TS.state.loja)).resumo.porFaixa);
  test.skip(!pf.vencido.lotes && !pf.critica.lotes, 'a loja da apresentação não tem lote vencido nem perto de vencer hoje');
  await ir(page, 'inicio');
  const grupo = page.locator('.ini-grupo[data-area=estoque]');
  const aviso = grupo.locator('.ini-aviso', { hasText: /^.*Validade: / }).first();
  await expect(aviso).toBeVisible({ timeout: 20000 });
  if (pf.vencido.lotes) {
    const v = grupo.locator('.ini-aviso.ini-erro', { hasText: 'Validade:' });
    await expect(v).toContainText(new RegExp(`Validade: ${pf.vencido.lotes} lote`));
    await expect(v).toContainText('a custo'); // a apresentação vê custo
    await expect(v.locator('.ini-adiar')).toHaveCount(0); // vermelho não é adiado
  }
  if (pf.critica.lotes) await expect(grupo.locator('.ini-aviso.ini-warn', { hasText: 'em até 30 dias' })).toContainText(new RegExp(`Validade: ${pf.critica.lotes} lote`));
  const faixa = pf.vencido.lotes ? 'vencido' : 'critica';
  await aviso.click();
  await expect(page).toHaveURL(/#validade/);
  await expect(page.locator(`.vl-chip.on`)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.querySelector('.vl-chip.on').className)).toMatch(faixa === 'vencido' ? /vl-chip/ : /vl-chip/);
  const n = await page.locator('.vl-chip.on b').textContent();
  expect(num(n)).toBe(pf[faixa].lotes);
});

test('Início com "Todas as lojas": uma linha por loja, com os mesmos números de cada loja, e o clique troca de loja', async ({ page }, info) => {
  await abrir(page);
  const tem = await page.evaluate(() => (TS.lojas || []).length > 1);
  test.skip(!tem, 'a apresentação tem uma loja só');
  // faturamento do mês de cada loja pela conta oficial, direto nos dados de todas as lojas
  await page.locator('#lojaSel').selectOption('todas');
  await page.waitForFunction(() => TS.state.loja === 'todas' && TS.db && TS.db.n && TS.db.metas.length > 1);
  await ir(page, 'inicio');
  const card = page.locator('main .vd-lojas');
  await expect(card).toBeVisible();
  await expect(card.locator('.vd-loja').first()).toBeVisible({ timeout: 40000 });
  const lojas = await page.evaluate(() => TS.lojas.map((l) => ({ id: l.id, nome: l.nome })));
  await expect(card.locator('.vd-loja')).toHaveCount(lojas.length);
  const oficial = await page.evaluate(() => {
    const db = TS.db, ym = TS.dayToIso(db.maxDay).slice(0, 7), out = {};
    for (const m of db.metas) {
      let s = 0;
      for (let i = 0; i < db.n; i++) if (db.ym[i] === ym && m.nomesVenda.includes(db.D.loja[db.loja[i]]) && TS.contas.contaFat(db.D.descricao[db.desc[i]], db.vu[i])) s += db.vt[i] || 0;
      out[m.nome] = Math.round(s);
    }
    return out;
  });
  const celular = info.project.name === 'celular';
  for (const l of lojas) {
    const linha = card.locator(celular ? '.t-mob tbody tr, .t-mob .tm-card' : 'tbody tr', { hasText: l.nome }).first();
    await expect(linha).toBeVisible();
    const txt = await linha.innerText();
    const m = /R\$\s?[\d.]+/.exec(txt.slice(txt.indexOf(l.nome) + l.nome.length));
    expect(Math.abs(num(m[0]) - oficial[l.nome])).toBeLessThanOrEqual(1);
  }
  // explicação em toda coluna, sem rolagem para o lado, sem lixo
  if (!celular) expect(await card.locator('thead th .dica-i').count()).toBe(await card.locator('thead th').count());
  await semLixo(card);
  await semRolagemLateral(page);
  if (!celular) expect(await card.locator('.table-wrap').evaluate((w) => w.scrollWidth - w.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator('.ini-aviso b', { hasText: 'Os avisos de estoque, inventário e franquia são de cada loja' })).toBeVisible();
  await print(page, info, 'inicio-lojas');
  // clicar na loja troca o seletor do topo e o Início passa a ser o dela
  const primeira = await card.locator('.vd-loja').first().innerText();
  await card.locator('.vd-loja').first().click();
  const id = lojas.find((l) => l.nome === primeira.trim()).id;
  await page.waitForFunction((x) => TS.state.loja === x && TS.db && TS.db.n, id);
  expect(await page.locator('#lojaSel').inputValue()).toBe(id);
  await expect(page.locator('main .vd-lojas')).toHaveCount(0);
});

test('Lojas lado a lado: projeção e zerados de cada loja batem com os da própria loja', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await abrir(page);
  const tem = await page.evaluate(() => (TS.lojas || []).length > 1);
  test.skip(!tem, 'a apresentação tem uma loja só');
  const loja = await page.evaluate(() => TS.state.loja);
  // na loja: projeção do mês (a conta única) e o quadro "Perdendo por falta" do Estoque
  const naLoja = await page.evaluate(() => { const ym = TS.dayToIso(TS.db.maxDay).slice(0, 7); const P = TS.projecaoMes(ym, { base: 'loja' }); return P ? Math.round(P.proj) : null; });
  await ir(page, 'estoque');
  const q = page.locator('main .kpi', { hasText: 'Perdendo por falta' });
  await expect(q).toBeVisible({ timeout: 30000 });
  const zer = /(\d+) produtos? zerados?/.exec(await q.innerText());
  const par = /([\d.]+) produtos sem venda/.exec(await page.locator('main .kpi', { hasText: 'Estoque parado' }).innerText());
  // com todas as lojas: a linha dessa loja
  await page.locator('#lojaSel').selectOption('todas');
  await page.waitForFunction(() => TS.state.loja === 'todas' && TS.db && TS.db.n && TS.db.metas.length > 1);
  const r = await page.evaluate(async (id) => {
    const ym = TS.dayToIso(TS.db.maxDay).slice(0, 7);
    const P = TS.projecaoMes(ym, { base: 'loja', lojaId: id });
    return { proj: P ? Math.round(P.proj) : null };
  }, loja);
  expect(r.proj).toBe(naLoja);
  await ir(page, 'inicio');
  const nome = await page.evaluate((id) => TS.lojas.find((l) => l.id === id).nome, loja);
  const linha = page.locator('main .vd-lojas tbody tr', { hasText: nome });
  await expect(linha).toBeVisible({ timeout: 40000 });
  const cel = (rot) => page.evaluate(([n, rotulo]) => {
    const t = document.querySelector('main .vd-lojas table'); const k = [...t.querySelectorAll('thead th')].findIndex((th) => th.textContent.includes(rotulo));
    const tr = [...t.querySelectorAll('tbody tr')].find((x) => x.textContent.includes(n)); return tr.children[k].innerText;
  }, [nome, rot]);
  expect(num((await cel('Zerados que vendem')).split('\n')[0])).toBe(zer ? +zer[1] : 0);
  if (par) expect((await cel('Estoque parado'))).toContain(`${par[1]} produto`);
});

test('Resultado: linha "− Perdas" depois do custo dos produtos, reduz o resultado e a tela diz quanto', async ({ page }, info) => {
  await abrir(page);
  const perdas = await page.evaluate(async () => (await (await fetch(TS.api('perdas?loja=' + TS.state.loja))).json()).meses);
  await ir(page, 'dre');
  const t = page.locator('main .dre-t').first();
  await expect(t).toBeVisible({ timeout: 30000 });
  const rotulos = await t.locator('tbody tr td.l').allInnerTexts();
  const iC = rotulos.findIndex((x) => x.includes('Custo dos produtos')), iP = rotulos.findIndex((x) => x.includes('Perdas')), iL = rotulos.findIndex((x) => x.includes('Lucro bruto'));
  expect(iP).toBe(iC + 1);
  expect(iL).toBe(iP + 1);
  // a conta: com as perdas o resultado é menor exatamente no valor delas
  const r = await page.evaluate(async (pd) => {
    const M = await TS.custosLoja();
    const com = TS.dreCalcular(M, { perdas: pd }), sem = TS.dreCalcular(M, { perdas: {} });
    const ym = Object.keys(pd).filter((k) => pd[k].total > 0 && com.some((m) => m.ym === k)).sort().pop();
    const a = com.find((m) => m.ym === ym), b = sem.find((m) => m.ym === ym);
    return ym ? { ym, total: pd[ym].total, com: a.resultado, sem: b.resultado, bruto: b.lucroBruto - a.lucroBruto, contrib: b.contrib - a.contrib, projIgual: !a.proj || Math.abs((b.proj.resultado - a.proj.resultado) - pd[ym].total) < 0.01 } : null;
  }, perdas);
  expect(r, 'a apresentação tem perdas em algum mês').not.toBeNull();
  expect(r.sem - r.com).toBeCloseTo(r.total, 2);
  expect(r.bruto).toBeCloseTo(r.total, 2);
  expect(r.contrib).toBeCloseTo(r.total, 2);
  expect(r.projIgual).toBe(true); // na projeção as perdas não crescem com as vendas
  // o mês com perdas: a linha discreta diz quanto e como seria sem elas
  await page.locator('.dre-topo select').selectOption(r.ym);
  const linha = page.locator('main .dre-perdas');
  await expect(linha).toContainText('inclui R$');
  await expect(linha).toContainText('Sem as perdas seria');
  expect(Math.abs(num(/inclui (R\$\s?[\d.]+)/.exec(await linha.innerText())[1]) - Math.round(r.total))).toBeLessThanOrEqual(1);
  await expect(page.locator('main .kpi', { hasText: /Resultado (do mês|até hoje)/ })).toContainText('de perdas');
  await expect(linha.locator('.dica-i')).toHaveCount(1);
  await semLixo(page.locator('main'));
  await semRolagemLateral(page);
  await print(page, info, 'resultado-perdas');
});

test('Hoje: a meta de hoje é dividida pelas horas da escala; sem escala, partes iguais (e a tela diz)', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await abrir(page);
  // escolhe uma loja da apresentação com a escala ligada aos nomes dos vendedores
  const loja = await page.evaluate(() => { const hoje = TS.dayToIso(TS.todayDay()); for (const l of TS.lojas) { if (l.id !== TS.state.loja) continue; const e = TS.escalaTurnos(hoje, hoje); return e ? { n: e.turnos.length } : null; } return null; });
  await ir(page, 'hoje');
  const c = page.locator('.md-card');
  await expect(c).toContainText('Meta de hoje');
  const r = await page.evaluate(() => {
    const hoje = TS.dayToIso(TS.todayDay()), e = TS.escalaTurnos(hoje, hoje);
    const card = document.querySelector('.md-card');
    const alvos = [...card.querySelectorAll('.md-v .md-alvo b')].map((b) => +b.textContent.replace(/[^\d,-]/g, '').replace(',', '.'));
    const metaHoje = +card.querySelector('.md-num b').textContent.replace(/[^\d,-]/g, '').replace(',', '.');
    return { modo: card.querySelector('.md-nota').dataset.divisao, turnos: e ? e.turnos.map((t) => [t.nome, TS.equipe.calc.liquido(t)]) : null, alvos, metaHoje, nota: card.querySelector('.md-nota').textContent, horas: [...card.querySelectorAll('.md-nome small')].map((x) => x.textContent) };
  });
  expect(loja === null ? r.turnos === null : true).toBe(true);
  if (r.modo === 'escala') {
    expect(r.nota).toContain('horas dela na escala de hoje');
    expect(r.horas.length).toBe(r.alvos.length);
    // a soma das partes é a meta de hoje, e quem tem mais horas não fica com menos
    expect(Math.abs(r.alvos.reduce((a, b) => a + b, 0) - r.metaHoje)).toBeLessThanOrEqual(r.alvos.length);
  } else {
    expect(r.nota).toMatch(/partes iguais/);
    if (r.alvos.length > 1) expect(Math.max(...r.alvos) - Math.min(...r.alvos)).toBeLessThanOrEqual(1);
  }
  // força a queda para a divisão igual (escala sem nomes = como a vendedora recebe) e confere o aviso
  await page.evaluate(() => { const m = TS.db.metas.find((x) => x.id === TS.state.loja); m.operacao = null; TS.render(); });
  await expect(page.locator('.md-card .md-nota')).toHaveAttribute('data-divisao', 'igual');
  await expect(page.locator('.md-card .md-nota')).toContainText('Sem escala lançada');
  const iguais = await page.evaluate(() => [...document.querySelectorAll('.md-card .md-v .md-alvo b')].map((b) => +b.textContent.replace(/[^\d,-]/g, '').replace(',', '.')));
  if (iguais.length > 1) expect(Math.max(...iguais) - Math.min(...iguais)).toBeLessThanOrEqual(1);
  await semLixo(page.locator('.md-card'));
});
