// Visão do dono: "Sua semana" e aviso de validade no Início, lojas lado a lado com "Todas as lojas",
// linha de perdas no Resultado e meta de hoje dividida pelas horas da escala.
const { test, expect } = require('./_base');

const abrir = async (page) => { await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas' && TS.visaoDono); };
const ir = (page, tela) => page.evaluate((t) => { location.hash = '#' + t; }, tela);
const semRolagemLateral = async (page) => { const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); expect(d).toBeLessThanOrEqual(1); };
const num = (t) => +String(t).replace(/[^\d,-]/g, '').replace(',', '.');
const semLixo = async (loc) => { expect(await loc.innerText()).not.toMatch(/\b(null|undefined|NaN)\b/); };
const print = async (page, info, nome) => { if (process.env.PRINTS) await page.screenshot({ path: `${process.env.PRINTS}/${nome}-${info.project.name}.png`, fullPage: true }); };

test('INI-HEROI: Início responde "como estou indo" num herói (meta com a marca do esperado, ritmo, semana) e "o que fazer agora" com um botão por ação', async ({ page }, info) => {
  await abrir(page);
  await ir(page, 'inicio');
  const her = page.locator('main .ini-heroi');
  await expect(her).toBeVisible();
  // a grade de quadros com barra saiu do Início (redesenho de 22/11/2026)
  await expect(page.locator('main .g-kpi')).toHaveCount(0);
  await expect(page.locator('main details.vd-semana')).toHaveCount(0);
  // meta do mês: % pelas vendas da meta e a marca do esperado = dias de loja aberta completos ÷ dias de loja aberta do mês
  const esp = await page.evaluate(() => {
    const db = TS.db, ym = TS.dayToIso(db.maxDay).slice(0, 7), ini = TS.isoToDay(ym + '-01'), hoje = TS.todayDay();
    const cfg = db.metas.find((m) => m.id === TS.state.loja) || null, fim = TS.isoToDay(`${ym}-${String(TS.contas.diasNoMes(ym)).padStart(2, '0')}`);
    const u = db.maxDay >= hoje ? hoje - 1 : db.maxDay;
    let ab = 0, pas = 0;
    for (let d = ini; d <= fim; d++) if (TS.lojaAberta(cfg, TS.dayToIso(d))) { ab++; if (d <= u) pas++; }
    const idx = TS.filtrar({ de: ini, ate: db.maxDay, mesLivre: true });
    return { esperado: pas / ab, pct: TS.rules.vendasMeta(idx) / TS.metaCalc(ym).valor };
  });
  const k = her.locator('.heroi-pri');
  expect(Math.abs(+(await k.getAttribute('data-esperado')) - esp.esperado)).toBeLessThan(0.0002);
  expect(Math.abs(+(await k.getAttribute('data-pct-meta')) - esp.pct)).toBeLessThan(0.0002);
  expect((await k.locator('.heroi-num').evaluate((el) => el.firstChild.textContent)).trim()).toMatch(new RegExp(`^${Math.round(esp.pct * 100)}\\s?%$`));
  const marca = k.locator('.heroi-barra .heroi-barra-marca');
  await expect(marca).toHaveCount(1);
  const [bx, mx] = [await k.locator('.heroi-barra').boundingBox(), await marca.boundingBox()];
  expect(Math.abs((mx.x + mx.width / 2 - bx.x) / bx.width - esp.esperado)).toBeLessThan(0.02);
  await expect(k).toContainText(/R\$\s[\d.]+ de R\$\s[\d.]+/);
  // para bater a meta + ritmo; a semana contra a anterior; cada coluna com ⓘ
  await expect(her).toContainText(/PARA BATER A META|Para bater a meta/i);
  await expect(her).toContainText(/ESTA SEMANA|Esta semana/i);
  await expect(her.locator('.heroi-col').nth(2)).toContainText(/contra a semana passada|sem a semana anterior/);
  expect(await her.locator('.dica-i').count()).toBe(await her.locator('.heroi-col').count());
  // o que fazer agora: até 3 ações numeradas, cada uma com o próprio botão; a 1ª é a principal
  const acoes = page.locator('main .ini-acoes .acao');
  await expect(acoes.first()).toBeVisible({ timeout: 30000 });
  const n = await acoes.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(3);
  expect(await page.locator('main .ini-acoes .acao .acao-btn').count()).toBe(n);
  await expect(acoes.first().locator('.acao-btn')).toHaveClass(/primary/);
  for (let i = 1; i < n; i++) await expect(acoes.nth(i).locator('.acao-btn')).not.toHaveClass(/primary/);
  await expect(acoes.first().locator('.acao-n')).toHaveText('1');
  const alto = await acoes.first().locator('.acao-btn').boundingBox();
  expect(alto.height).toBeGreaterThanOrEqual(43);
  await semLixo(page.locator('main'));
  await semRolagemLateral(page);
  await print(page, info, 'inicio-heroi');
  // a ação leva à tela dela
  const tipo = await acoes.first().getAttribute('data-acao');
  await acoes.first().locator('.acao-btn').click();
  const destino = { zerados: /#(pedido|estoque)/, vencidos: /#validade/, criticos: /#validade/, franquia: /#creditos/, parado: /#estoque/, meta: /#inicio/ }[tipo];
  await expect(page).toHaveURL(destino);
});

test('INI-AVISOS: só os 4 avisos mais importantes com a etiqueta de prazo; a linha dos dados sempre à vista; "Ver todos" abre a lista completa', async ({ page }) => {
  await abrir(page);
  await ir(page, 'inicio');
  await expect(page.locator('.ini-pend')).toHaveCount(0, { timeout: 30000 });
  const lin = page.locator('.ini-resumo .ini-resumo-i');
  const dados = page.locator('.ini-resumo .ini-resumo-i[data-area="dados"]');
  const nDados = await dados.count();
  expect(nDados).toBeGreaterThan(0); // a apresentação tem a configuração guiada pendente: linha de dados
  // linhas dos dados primeiro, depois no máximo 4
  expect(await lin.count() - nDados).toBeLessThanOrEqual(4);
  const areas = await lin.evaluateAll((ls) => ls.map((l) => l.dataset.area));
  expect(areas.slice(0, nDados).every((a) => a === 'dados')).toBe(true);
  // etiqueta de prazo em texto, pela gravidade (vermelho = Agora, amarelo = Esta semana, azul = Para saber)
  const etq = await lin.evaluateAll((ls) => ls.map((l) => [l.className.match(/ini-(erro|warn|info|ok)/)[1], l.querySelector('.etq-prazo').textContent]));
  for (const [nivel, t] of etq) expect(t).toBe({ erro: 'Agora', warn: 'Esta semana', info: 'Para saber', ok: 'Ok' }[nivel]);
  const ordem = etq.slice(nDados).map(([n]) => ({ erro: 0, warn: 1, info: 2, ok: 3 }[n]));
  expect(ordem).toEqual([...ordem].sort((a, b) => a - b));
  // contraste da etiqueta ≥ 4,5:1
  const ctr = await page.locator('.ini-resumo .etq-prazo').evaluateAll((es) => es.map((e) => { const cs = getComputedStyle(e); const rgb = (c) => c.match(/\d+/g).slice(0, 3).map(Number); const L = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }; const a = L(cs.color), b = L(cs.backgroundColor); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }));
  for (const c of ctr) expect(c).toBeGreaterThanOrEqual(4.5);
  // "Ver todos os N avisos" abre a lista completa agrupada (com "lembrar depois"), e fecha de novo
  const ver = page.locator('.ini-ver-todos');
  await expect(ver).toHaveText(/^Ver todos os \d+ avisos ›$/);
  const total = num(await ver.textContent());
  await expect(page.locator('.ini-todos')).toBeHidden();
  await ver.click();
  await expect(page.locator('.ini-todos')).toBeVisible();
  await expect(page.locator('.ini-todos .ini-grupo').first()).toBeVisible();
  expect(await page.locator('.ini-todos .ini-aviso').count()).toBe(total);
  await expect(page.locator('.ini-todos .ini-grupo').first()).toHaveAttribute('data-area', 'dados');
  await expect(ver).toHaveText('Fechar a lista completa');
  await ver.click();
  await expect(page.locator('.ini-todos')).toBeHidden();
  // gerente: sem ações (como antes), mas com o herói
  const g = await page.evaluate(() => { const p = TS.eu.perfil; TS.eu.perfil = 'gerente'; const r = { acoes: TS.visaoDono.mostraSemana(), heroi: TS.visaoDono.mostraHeroi() }; TS.eu.perfil = 'vendedor'; r.vend = TS.visaoDono.mostraHeroi() || TS.visaoDono.mostraLojas(); TS.eu.perfil = p; return r; });
  expect(g).toEqual({ acoes: false, heroi: true, vend: false });
});

test('Início: aviso de validade no grupo Estoque (vencidos em vermelho, até 30 dias em amarelo) abre a Validade já filtrada', async ({ page }) => {
  await abrir(page);
  // os números do aviso são os da tela Validade
  const pf = await page.evaluate(async () => (await TS.validade.dados(TS.state.loja)).resumo.porFaixa);
  test.skip(!pf.vencido.lotes && !pf.critica.lotes, 'a loja da apresentação não tem lote vencido nem perto de vencer hoje');
  await ir(page, 'inicio');
  await page.locator('.ini-ver-todos').click(); // a lista completa fica em "Ver todos" (redesenho de 22/11/2026)
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
  await expect(page.locator('.ini-resumo-i', { hasText: 'Os avisos de estoque, inventário e franquia são de cada loja' })).toBeVisible();
  // com "Todas as lojas" o herói mostra a rede e as lojas lado a lado vêm logo abaixo dele
  const yH = await page.locator('main .ini-heroi').boundingBox();
  expect((await card.boundingBox()).y).toBeGreaterThan(yH.y + yH.height - 1);
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
  const q = page.locator('main .est-p2-heroi .heroi-col', { hasText: 'Perdendo por falta' });
  await expect(q).toBeVisible({ timeout: 30000 });
  const zer = /(\d+) produtos? zerados?/.exec(await q.innerText());
  const par = /([\d.]+) produtos sem venda/.exec(await page.locator('main .est-p2-heroi .linhas-num-a', { hasText: 'Parado' }).innerText());
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

test('Resultado: linha "− Perdas" depois do lucro sem fixos (três degraus, LUCRO-01), reduz o resultado e a tela diz quanto', async ({ page }, info) => {
  await abrir(page);
  const perdas = await page.evaluate(async () => (await (await fetch(TS.api('perdas?loja=' + TS.state.loja))).json()).meses);
  await ir(page, 'dre');
  const t = page.locator('main .dre-t').first();
  await expect(t).toBeVisible({ timeout: 30000 });
  const rotulos = await t.locator('tbody tr td.l').allInnerTexts();
  const iS = rotulos.findIndex((x) => x.includes('Lucro sem fixos')), iP = rotulos.findIndex((x) => x.includes('Perdas'));
  expect(iS).toBeGreaterThan(0);
  expect(iP).toBe(iS + 1); // as perdas não são custo do que foi vendido: vêm depois do lucro sem fixos, antes dos custos fixos
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
  expect(r.bruto).toBeCloseTo(0, 2); // o lucro bruto e o lucro sem fixos não levam as perdas
  expect(r.contrib).toBeCloseTo(0, 2);
  expect(r.projIgual).toBe(true); // na projeção as perdas não crescem com as vendas
  // o mês com perdas: a linha discreta diz quanto e como seria sem elas
  await page.locator('.dre-topo select').selectOption(r.ym);
  const linha = page.locator('main .dre-perdas');
  await expect(linha).toContainText('inclui R$');
  await expect(linha).toContainText('Sem as perdas seria');
  expect(Math.abs(num(/inclui (R\$\s?[\d.]+)/.exec(await linha.innerText())[1]) - Math.round(r.total))).toBeLessThanOrEqual(1);
  await expect(page.locator('main .heroi-col', { hasText: /Resultado (do mês|até hoje)/ })).toContainText('de perdas');
  await expect(linha.locator('.dica-i')).toHaveCount(1);
  await semLixo(page.locator('main'));
  await semRolagemLateral(page);
  await print(page, info, 'resultado-perdas');
});

test('Início: a meta de hoje (saiu de Clientes → Hoje) é dividida pelas horas da escala; sem escala, partes iguais (e a tela diz)', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await abrir(page);
  // escolhe uma loja da apresentação com a escala ligada aos nomes dos vendedores
  const loja = await page.evaluate(() => { const hoje = TS.dayToIso(TS.todayDay()); for (const l of TS.lojas) { if (l.id !== TS.state.loja) continue; const e = TS.escalaTurnos(hoje, hoje); return e ? { n: e.turnos.length } : null; } return null; });
  await ir(page, 'inicio');
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

// META-DIA-01 (decisão do dono, 25/11/2026, opção A): "Para bater a meta" por dia é a mesma conta da Meta de hoje
// (falta até ontem ÷ dias de loja aberta com hoje) — antes descontava as vendas de hoje e ainda contava hoje como dia que falta
test('META-DIA-01: no Início, "Para bater a meta" por dia = o número do cartão Meta de hoje', async ({ page }) => {
  await abrir(page);
  await ir(page, 'inicio');
  const her = page.locator('main .heroi').first();
  await expect(her).toBeVisible();
  const dh = await page.evaluate(() => { const d = TS.visaoDono.dadosHeroi(); return d && { meta: d.meta, mes: d.mes.meta, hoje: d.hojeMeta, restam: d.restam, porDia: d.porDia }; });
  test.skip(!dh || !dh.meta || dh.mes >= dh.meta || !dh.restam, 'na apresentação de hoje a meta já foi batida ou não há meta');
  // a conta: (meta − vendas da meta até ontem) ÷ dias com hoje
  expect(Math.abs(dh.porDia - (dh.meta - (dh.mes - dh.hoje)) / dh.restam)).toBeLessThan(0.01);
  const col = her.locator('.heroi-col', { hasText: /Para bater a meta/i });
  const md = page.locator('.md-card .md-num b').first();
  await expect(md).toBeVisible();
  expect(num(await col.locator('.heroi-num').first().innerText())).toBe(num(await md.innerText()));
  await expect(col).toContainText('com hoje');
  if (dh.hoje > 0) await expect(col).toContainText('hoje:');
});
