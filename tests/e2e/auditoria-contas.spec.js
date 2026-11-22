// Indicadores que não prometem mais do que medem: grupo de comparação das campanhas, classe com as margens da loja,
// custo na data da venda, recompra com prazo inteiro e "até agora" no mês em andamento.
const { test, expect } = require('@playwright/test');

const abrir = async (page, tela) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate((t) => { location.hash = '#' + t; }, tela);
};
const semRolagem = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
const semLixo = async (loc) => expect(await loc.innerText()).not.toMatch(/(^|[\s>(\d])(null|undefined|NaN|\[object Object\])(?=$|[\s<).,])/m);

test('Campanha: guarda 10% da lista sem mensagem e mostra o efeito ao lado de quem recebeu', async ({ page }, info) => {
  await abrir(page, 'campanhas');
  // a tela de campanhas pede o histórico completo e se redesenha quando ele chega: espera assentar antes de mexer
  await expect(page.getByRole('button', { name: '+ Criar campanha' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ Criar campanha' }).click();
  const opcao = page.locator('label.cp-check', { hasText: 'sem mensagem para comparar' });
  await expect(opcao.locator('input')).toBeChecked(); // campanha nova: padrão ligado
  await expect.poll(async () => +(await page.locator('.cp-contagem b').innerText()).replace(/\D/g, '')).toBeGreaterThan(0);
  const n = +(await page.locator('.cp-contagem b').innerText()).replace(/\D/g, '');
  await expect(page.locator('.cp-comp-n')).toContainText(n >= 50 ? 'ficam sem mensagem, para comparar' : 'sem grupo de comparação');
  await page.getByPlaceholder('Ex.: Pontos vencendo em dezembro').fill('Teste de comparação');
  await page.getByRole('button', { name: 'Salvar campanha' }).click();
  // sem critério a lista pega quase a base inteira: o painel avisa e pede confirmação (decisão do dono)
  await page.locator('.ts-conf').getByRole('button', { name: 'Salvar assim mesmo' }).click();
  await expect(page.locator('.kpi', { hasText: 'Voltaram' })).toBeVisible();
  const r = await page.evaluate(() => {
    const R = TS.campRetorno;
    // a conta da tela é a do módulo: quem é do grupo nunca é pendente e o sorteio é o do CPF + campanha
    return { min: R.MIN_LISTA, pct: R.PCT };
  });
  expect(r).toEqual({ min: 50, pct: 10 });
  const main = page.locator('main');
  if (n >= 50) {
    await expect(page.locator('.kpi', { hasText: 'Na lista' })).toContainText('sem mensagem (comparação)');
    await expect(main).toContainText('Efeito da campanha');
    await expect(main).toContainText('Não receberam');
    if (info.project.name === 'computador') {
      // ordena pela situação ao contrário: os da comparação sobem; eles não têm "voltar para a fila"
      await page.locator('th', { hasText: 'Situação' }).click();
      const cmp = page.locator('tbody tr', { hasText: 'Comparação (sem mensagem)' }).first();
      await expect(cmp).toBeVisible();
      await expect(cmp.locator('button', { hasText: 'voltar para a fila' })).toHaveCount(0);
      await expect(cmp).toContainText('ainda no prazo');
    }
  } else {
    await expect(main).toContainText('Sem comparação');
  }
  // enviar o primeiro: continua sem % (ninguém com o prazo fechado ainda) e sem número inventado
  await page.locator('.cp-enviar').click();
  await expect(page.locator('.kpi', { hasText: 'Enviadas' }).locator('.kpi-value, .kpi-v, b').first()).toBeVisible();
  await expect(page.locator('.kpi', { hasText: 'Voltaram' })).toContainText('ainda no prazo');
  await semLixo(main);
  await semRolagem(page);
});

test('Rentabilidade: classe pelas margens da loja e custo da data da venda', async ({ page }) => {
  await abrir(page, 'rentab');
  await expect(page.locator('.est-classes')).toBeVisible();
  await expect(page.locator('.est-classes')).toContainText('abaixo do alvo da loja');
  const r = await page.evaluate(async () => {
    const e = await TS.estoqueBuscar(TS.state.loja), M = await TS.custosLoja(), db = TS.db;
    const CO = TS.classeOficial(M, e.classe);
    const ymHoje = TS.hojeSP().slice(0, 7);
    let passado = null, atual = null, estimadas = 0, naData = 0;
    for (let i = 0; i < db.n; i++) {
      const d = M.custoDet(i);
      if (!d) continue;
      if (d.naData) { naData++; if (d.est) estimadas++; }
      const c = M.casar(i);
      if (db.ym[i] < ymHoje && !c.kg && !passado) passado = { det: d, esperado: (db.qtd[i] || 0) * M.custoNaData(c.it.cod, db.day[i], c.it.custo).v, custo: M.custo(i) };
      if (db.ym[i] === ymHoje && !atual) atual = { det: d, hoje: M.custoHoje(i) };
    }
    // a classe de cada produto segue a regra única (classeprod.js), com as margens da loja
    let fora = 0, comSf = 0;
    for (const x of CO.values()) {
      if (!x.auto) continue;
      if (x.margemSf != null) comSf++;
      const abs = x.margemSf != null ? x.margemSf : x.margem;
      const boa = x.margem >= x.medMargem && abs >= CO.min;
      const esperado = x.giro > 0 && x.giro >= x.medGiro ? (boa ? 'estrela' : 'volume') : (boa || abs >= CO.alvo ? 'joia' : 'peso');
      if (esperado !== x.auto) fora++;
    }
    return { min: CO.min, alvo: CO.alvo, n: CO.size, fora, comSf, passado, atual, naData, estimadas };
  });
  expect(r.min).toBeGreaterThan(0); expect(r.alvo).toBeGreaterThan(r.min);
  expect(r.n).toBeGreaterThan(5); expect(r.fora).toBe(0); expect(r.comSf).toBeGreaterThan(0);
  expect(r.passado.det.naData).toBe(true);
  expect(Math.abs(r.passado.det.v - r.passado.esperado)).toBeLessThan(0.005);
  expect(r.passado.custo).toBe(r.passado.det.v);
  if (r.atual) { expect(r.atual.det.naData).toBe(false); expect(r.atual.det.v).toBe(r.atual.hoje); }
  expect(r.naData).toBeGreaterThan(0);
  await semLixo(page.locator('main'));
  await semRolagem(page);
});

test('Indicadores de clientes: recompra só de quem já teve o prazo e "% voltaram" com poucos dados', async ({ page }) => {
  await abrir(page, 'clientes');
  // redesenho: recompra e clientes novos ficam numa coluna do cartão-herói "Saúde da base"
  const k = page.locator('.heroi-col', { hasText: 'Recompra em 90 dias' });
  await expect(k).toBeVisible();
  await expect(k).toContainText(/clientes|poucos dados/);
  await expect(k.locator('.cli-novos')).toContainText('no período (primeira compra com CPF)');
  const card = page.locator('.card', { hasText: 'Vendedoras e clientes' });
  await expect(card).toContainText('% voltaram');
  await expect(card).toContainText(/\d+ de \d+/);
  const r = await page.evaluate(() => {
    // a mesma conta da tela, com os clientes da apresentação: ninguém "no prazo" entra no %
    const hoje = Math.min(TS.db.maxDay, TS.todayDay());
    const x = TS.recompra.recompra(TS.cli.lista.filter((c) => c.primeira != null).map((c) => ({ ref: c.primeira, dias: c.cupons.map((q) => q.day) })), hoje);
    return { soma: x.elegiveis + x.semPrazo === x.clientes, ok: x.voltaram <= x.elegiveis, pct: x.pct };
  });
  expect(r.soma).toBe(true); expect(r.ok).toBe(true);
  await semLixo(card);
  await semRolagem(page);
});

test('Resultado: o mês em andamento mostra "até agora" e o % usa as vendas até hoje', async ({ page }) => {
  await abrir(page, 'dre');
  const c = page.locator('.cv-resultado');
  await expect(c).toContainText('Compras × vendas mês a mês');
  const r = await page.evaluate(async () => {
    const e = await TS.estoqueBuscar(TS.state.loja), M = await TS.custosLoja();
    const R = TS.comprasVendas.montar(M, e, 0), m = R.meses.find((x) => x.parcial);
    return m ? { pct: m.pct, esperado: m.compras != null && m.vendas > 0 ? m.compras / m.vendas : null, acima: m.acima, teto: R.tetoPct / 100 } : null;
  });
  if (r && r.esperado != null) {
    expect(Math.abs(r.pct - r.esperado)).toBeLessThan(1e-9);
    expect(r.acima).toBe(r.pct > r.teto + 1e-9);
    await expect(c.locator('.cv-t')).toContainText(/até agora (dentro|acima) do teto/);
  }
  await semLixo(c);
});
