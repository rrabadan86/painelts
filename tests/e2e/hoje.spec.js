// Clientes → Hoje depois da revisão de 22/11 (decisões do dono): a lista vem no topo (a Meta de hoje foi para o Início),
// a contagem fica no cabeçalho, tocar em WhatsApp mostra "Desfazer" por alguns segundos e o link que abre a conversa vazia
// passa pela regra forte (na apresentação só avisa: nada abre nem é gravado).
const { test, expect } = require('./_base');

test.describe('Clientes → Hoje', () => {
  let erros;
  test.beforeEach(async ({ page }) => {
    erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await page.goto('/apresentacao');
    await page.waitForFunction(() => window.TS && TS.db && TS.cli && TS.cli.lista);
  });
  const semVazar = async (page, alvo) => {
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw - cw, 'sem rolagem para o lado').toBeLessThanOrEqual(2);
    expect(await alvo.innerText()).not.toMatch(/(^|\s)(null|undefined|NaN)(\s|$)/m);
  };

  test('HOJE-01: lista no topo, contagem no cabeçalho, sem a Meta de hoje; nome com toque de 24 px; mensagem com reticências', async ({ page }, info) => {
    await page.evaluate(() => { location.hash = '#hoje'; });
    const card = page.locator('.hj-card');
    await expect(card.locator('.hj-item').first()).toBeVisible();
    await expect(page.locator('main .md-card')).toHaveCount(0);
    await expect(page.locator('main .g-kpi')).toHaveCount(0);
    await expect(card.locator('.hj-conta')).toContainText(/[\d.]+ para contatar · \d+ contatados? hoje/);
    // o primeiro WhatsApp aparece logo (antes eram ~1.450 px no celular; o título e os cartões do redesenho de 22/11 têm folga maior)
    const topo = await card.locator('.hj-wpp, .hj-robo').first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(topo).toBeLessThan(960);
    const alt = await card.locator('.hj-nome').first().evaluate((el) => el.getBoundingClientRect().height);
    expect(alt).toBeGreaterThanOrEqual(24);
    if (info.project.name === 'celular') {
      // HOJE-MOB-01: Motivo e Vendedora em botões com a folha (cada opção com explicação e contagem); a mensagem fica
      // fora da lista e aparece inteira ao tocar no nome, com "Ver ficha ›"
      await expect(card.locator('.hj-chips')).toHaveCount(0);
      await card.locator('.hj-bt-mot').click();
      const folha = page.locator('.folha');
      await expect(folha.locator('.folha-op.on')).toContainText('Todos');
      await expect(folha.locator('.folha-op').nth(1).locator('small')).not.toBeEmpty();
      const op = folha.locator('.folha-op').nth(1);
      const nOp = +(await op.locator('.folha-n').innerText()).replace(/\D/g, '');
      await op.click();
      await expect(folha).toHaveCount(0);
      await expect(card.locator('.hj-bt-mot')).toHaveClass(/on/);
      await expect(card.locator('.hj-item')).toHaveCount(Math.min(nOp, 30));
      const it = card.locator('.hj-item').first();
      await expect(it.locator('.hj-abre')).toBeHidden();
      await it.locator('.hj-nome').click();
      await expect(it.locator('.hj-nome')).toHaveAttribute('aria-expanded', 'true');
      await expect(it.locator('.hj-abre .hj-msg')).toBeVisible();
      await expect(it.locator('.hj-ficha')).toBeVisible();
    } else {
      // chips com dica e estado anunciado
      await expect(card.locator('.hj-chips .chip').first()).toHaveAttribute('aria-pressed', 'true');
      await expect(card.locator('.hj-chips .chip').nth(1)).toHaveAttribute('title', /.+/);
      // a mensagem abre inteira ao tocar
      const msg = card.locator('.hj-msg').first();
      await msg.click();
      await expect(msg).toHaveAttribute('aria-expanded', 'true');
    }
    await semVazar(page, card);
    expect(erros).toEqual([]);
  });

  test('HOJE-02: tocar em WhatsApp marca o cliente e mostra "Desfazer"; desfazer põe de volta na lista', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#hoje'; });
    const card = page.locator('.hj-card');
    const bt = card.locator('.hj-wpp').first();
    await expect(bt).toBeVisible();
    const item = bt.locator('xpath=ancestor::div[contains(@class,"hj-item")]');
    const nome = await item.locator('.hj-nome').innerText();
    const contados = async () => +(await card.locator('.hj-conta b').nth(1).innerText()).replace(/\D/g, '');
    const antes = await contados();
    await bt.click();
    // na apresentação a mensagem aparece numa janela do painel (sem alert do navegador)
    await page.locator('.ts-perg').getByRole('button', { name: 'Entendi' }).click();
    const faixa = page.locator('.hj-desfazer');
    await expect(faixa).toContainText('marcada como contatada');
    await expect(page.locator('.hj-card .hj-nome', { hasText: nome })).toHaveCount(0);
    expect(await contados()).toBe(antes + 1);
    await faixa.getByRole('button', { name: 'Desfazer' }).click();
    await expect(faixa).toHaveCount(0);
    await expect(page.locator('.hj-card .hj-nome', { hasText: nome }).first()).toBeVisible();
    expect(await contados()).toBe(antes);
    expect(erros).toEqual([]);
  });

  test('RESUMO-07 (tela): o "● WhatsApp" que abre a conversa vazia passa pela conferência — na apresentação só avisa', async ({ page }) => {
    let abriu = false;
    page.on('popup', () => { abriu = true; });
    await page.evaluate(() => { location.hash = '#clilista'; });
    const link = page.locator('.cli-list a.wpp, .clm-lista a.wpp').first(); // no celular a lista é em linhas (CLI-MOB-01)
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href')).toBe('#');
    const alt = await link.evaluate((el) => el.getBoundingClientRect().height);
    expect(alt).toBeGreaterThanOrEqual(24);
    await link.click();
    await expect(page.locator('.ts-perg')).toContainText('o servidor confere antes');
    expect(abriu).toBe(false);
    expect(erros).toEqual([]);
  });

  test('CLI-IND-01 Indicadores: o que decide no topo, "O que fazer agora" fora e a conferência dos dados recolhida no fim', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#clientes'; });
    // herói com 4 colunas: clientes identificados na frente; os atalhos para a lista ficam na coluna dos sumindo
    const saude = page.locator('.heroi', { hasText: 'Saúde da base' });
    await expect(saude).toBeVisible();
    await expect(saude.locator('.heroi-col')).toHaveCount(4);
    await expect(saude.locator('.heroi-col').first()).toContainText('Clientes identificados');
    await expect(saude.locator('.heroi-col').first()).toContainText('Faturamento deles');
    await expect(saude).toContainText('Clientes bons sumindo');
    await expect(saude).toContainText('Vendas com CPF');
    await expect(saude).toContainText('Recompra em 90 dias');
    await expect(saude.locator('.cli-saude-link').first()).toContainText('na lista');
    await expect(page.locator('.acoes-num')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('O que fazer agora');
    // a ordem das seções
    const secoes = await page.locator('main .section-label').allInnerTexts();
    expect(secoes.map((t) => t.trim().toUpperCase())).toEqual(['RETORNO DAS AÇÕES', 'COMPORTAMENTO DOS CLIENTES', 'EQUIPE E BASE', 'PERFIL DOS CLIENTES', 'PROGRAMA DE FIDELIDADE EM DETALHE', 'QUALIDADE DO CADASTRO', 'CONFERÊNCIA DOS DADOS']); // Qualidade do cadastro: só admin e franqueado (QUAL-CAD-01)
    await expect(page.locator('.heroi[aria-label="Retorno das campanhas"]')).toBeVisible();
    // clientes, faturamento e visitas subiram para o herói: não repetem no Perfil
    await expect(page.locator('.cli-perfil-kpi .kpi')).toHaveCount(2);
    // conferência: recolhida, com o resumo na linha; abre e mostra a ligação do FIXE
    const conf = page.locator('details.cli-conf');
    await expect(conf).not.toHaveAttribute('open', '');
    await expect(conf.locator('summary')).toContainText('vendas sem FIXE');
    await conf.locator('summary').click();
    await expect(conf).toContainText('Ligação das compras do FIXE aos cupons');
    await expect(page.locator('.cli-alcance').first()).toContainText('Clientes sumindo: a loja toda');
    await expect(page.locator('.cli-alcance', { hasText: 'Período e loja dos filtros (o gráfico' })).toBeVisible();
    await expect(page.locator('.cli-alcance', { hasText: 'não seguem o período nem os filtros de cliente' })).toBeVisible();
    // a lista de cartões não é montada nos Indicadores
    await expect(page.locator('.cli-list .cli-card, .cli-list > *')).toHaveCount(0);
    await semVazar(page, page.locator('main'));
    expect(erros).toEqual([]);
  });
});
