const { test, expect } = require('./_base');

// LMOB-01…02 (padrão de listas no celular, aprovado pelo dono em 24/11/2026): no celular, Resumo por vendedor, Comparativos
// (Evolução mensal) e Campanhas → Não enviadas são linhas com divisória (nome + o número que decide; o resto pequeno embaixo),
// não cartões de "rótulo: valor". No computador as tabelas continuam iguais.
const abrir = async (page) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
};
const semRolarDeLado = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);

test('LMOB-01: Resumo → Desempenho por vendedor em linhas no celular (tabela no computador)', async ({ page }, info) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  await page.evaluate(() => { location.hash = '#resumo'; });
  const card = page.locator('#rs-vend');
  await expect(card).toBeVisible();
  if (info.project.name === 'celular') {
    await expect(card.locator('.lmob-it').first()).toBeVisible();
    await expect(card.locator('table')).toHaveCount(0);
    const l = card.locator('.lmob-it').first();
    await expect(l.locator('.lmob-val')).toContainText('R$');
    await expect(l.locator('.lmob-l2').first()).toContainText(/cupons? · |TKM/);
    await expect(l.locator('.lmob-nome')).not.toHaveText(/^[A-ZÀ-Ú ]{6,}$/); // nome com só a 1ª letra maiúscula
  } else {
    await expect(card.locator('table.t')).toBeVisible();
    await expect(card.locator('.lmob')).toHaveCount(0);
  }
  await semRolarDeLado(page);
  expect(erros).toEqual([]);
});

test('LMOB-02: Comparativos → Evolução mensal: uma linha por mês; tocar abre os indicadores e as vendedoras', async ({ page }, info) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  await page.evaluate(() => { location.hash = '#comparativos'; });
  const evol = page.locator('#cp-evol');
  await expect(evol).toBeVisible();
  if (info.project.name !== 'celular') { await expect(evol.locator('table.tree')).toBeVisible(); return; }
  const mes = evol.locator('.evm-mes').first();
  await expect(mes.locator('.lmob-val')).toContainText('R$');
  await expect(mes.locator('.evm-mini')).toHaveCount(0);
  await mes.click();
  await expect(evol.locator('.evm-mes').first().locator('.evm-mini')).toContainText('TKM');
  await expect(evol.locator('.evm-mes').first().locator('.evm-sub').first()).toContainText(/cupons?/);
  await expect(evol.locator('.lmob-total')).toContainText('Total do período');
  await semRolarDeLado(page);
  expect(erros).toEqual([]);
});

test('LMOB-01: Campanhas → Não enviadas em linhas no celular, com o motivo à direita e as ações como links', async ({ page }, info) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  await page.evaluate(() => { TS.state.cpVisao = 'naoenv'; location.hash = '#campanhas'; });
  const box = page.locator('.cp-ne');
  if (info.project.name !== 'celular') { await expect(box.locator('table.t')).toBeVisible(); return; }
  const l = box.locator('.lmob-it').first();
  await expect(l).toBeVisible();
  await expect(l.locator('.lmob-l1 .etq-prazo').first()).toBeVisible();
  await expect(l.locator('.lmob-acoes')).toContainText('Ver cliente');
  await semRolarDeLado(page);
  expect(erros).toEqual([]);
});

// CLI-MOB-01 / FOLHA-01 (mockup aprovado pelo dono em 24/11/2026): Lista de clientes no celular com busca única,
// Segmento e Grupo em botões que abrem a folha de opções (com a contagem), downloads no menu ⤓ e cada cliente em linhas.
test('CLI-MOB-01: Lista de clientes no celular — busca, folha de Segmento/Grupo, menu ⤓ e linhas', async ({ page }, info) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  await page.waitForFunction(() => TS.cli && TS.cli.lista && TS.cli.lista.length);
  await page.evaluate(() => { location.hash = '#clilista'; });
  if (info.project.name !== 'celular') {
    await expect(page.locator('.cli-segs')).toBeVisible(); // no computador continua a faixa de segmentos e a lista de sempre
    await expect(page.locator('.clm')).toHaveCount(0);
    expect(erros).toEqual([]);
    return;
  }
  await expect(page.locator('.clm-lista .clm-it').first()).toBeVisible();
  await expect(page.locator('.cli-segs')).toHaveCount(0);
  const total = await page.evaluate(() => TS.cli.lista.length);
  const nTxt = async () => +(await page.locator('.clm-n').innerText()).replace(/\D/g, '');
  const antes = await nTxt();
  // nome com só a 1ª letra maiúscula, valor na 1ª linha e o WhatsApp do tamanho de um dedo
  const l = page.locator('.clm-it').first();
  await expect(l.locator('.lmob-val')).toContainText('R$');
  await expect(l.locator('.lmob-nome')).not.toHaveText(/^[A-ZÀ-Ú ]{6,}$/);
  await expect(l.locator('.lmob-l2')).toContainText(/visitas?/);
  // folha do Segmento: "Todos" com a contagem da lista; escolher aplica, fecha e mostra a explicação
  await page.locator('.clm-seg').click();
  const folha = page.locator('.folha');
  await expect(folha).toBeVisible();
  await expect(folha.locator('.folha-op.on')).toContainText('Todos');
  expect(+(await folha.locator('.folha-op').first().locator('.folha-n').innerText()).replace(/\D/g, '')).toBe(antes);
  const vip = folha.locator('.folha-op', { hasText: 'VIP' });
  const nVip = +(await vip.locator('.folha-n').innerText()).replace(/\D/g, '');
  await vip.click();
  await expect(folha).toHaveCount(0);
  await expect(page.locator('.clm-seg')).toContainText('VIP');
  await expect(page.locator('.clm-dica')).toContainText('10%');
  expect(await nTxt()).toBe(nVip);
  // o "voltar" do celular fecha a folha sem sair da tela
  await page.waitForFunction(() => !(history.state && history.state.camada)); // a entrada da folha anterior já saiu do histórico
  await page.locator('.clm-rfm').click();
  await expect(folha).toBeVisible();
  await page.waitForFunction(() => history.state && history.state.camada);
  await page.goBack();
  await expect(folha).toHaveCount(0);
  await expect(page).toHaveURL(/#clilista/);
  // limpar volta para todos
  await page.locator('.clm-dica .link-btn').click();
  await expect(page.locator('.clm-seg')).toContainText('Todos');
  expect(await nTxt()).toBe(antes);
  // menu ⤓ com os dois downloads
  await page.locator('.mbx-bt').click();
  await expect(page.locator('.mbx-it')).toHaveCount(2);
  await expect(page.locator('.mbx-menu')).toContainText('Lista para WhatsApp (CSV)');
  await page.locator('.mbx-bt').click();
  await expect(page.locator('.mbx-menu')).toBeHidden();
  // busca única: letras procuram no nome, números no CPF/celular; o campo não perde o foco
  const nome = await page.evaluate(() => TS.cli.lista.find((c) => c.nome && c.cupons.length).nome.split(' ')[0]);
  await page.locator('.clm-busca').fill(nome);
  await expect.poll(nTxt).toBeLessThan(total);
  expect(await page.evaluate(() => document.activeElement.classList.contains('clm-busca'))).toBe(true);
  const cpf = await page.evaluate(() => TS.cli.lista.find((c) => c.cupons.length).cpf);
  await page.locator('.clm-busca').fill(cpf);
  await expect.poll(nTxt).toBe(1);
  await page.locator('.clm-busca').fill('');
  await expect.poll(nTxt).toBe(antes);
  // tocar na linha abre a ficha
  await page.locator('.clm-it').first().click();
  await expect(page.locator('.cp-modal-bg, .camada-cheia').first()).toBeVisible();
  await semRolarDeLado(page);
  expect(erros).toEqual([]);
});

// LMOB-03 (lote 1 do pente-fino do celular, 24/11/2026): listas de pessoas e itens no padrão de linhas
test('LMOB-03: Comissionamento, Promoção, Rendimento, Vendedoras e clientes e Cupons em linhas no celular', async ({ page }, info) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  const cel = info.project.name === 'celular';
  const confere = async (sel, oQue) => {
    const card = page.locator(sel).first();
    await expect(card, oQue).toBeVisible();
    if (cel) {
      await expect(card.locator('.lmob-it').first(), oQue).toBeVisible();
      await expect(card.locator('table.t-mob'), oQue).toHaveCount(0);
    } else await expect(card.locator('.lmob'), oQue).toHaveCount(0);
    await semRolarDeLado(page);
  };
  await page.evaluate(() => { location.hash = '#comissionamento'; });
  await page.getByRole('button', { name: /Ver o mês atual/ }).first().click();
  await confere('.card:has-text("Comissão por vendedor")', 'Comissão por vendedor');
  if (cel) await expect(page.locator('.card:has-text("Comissão por vendedor") .lmob-total')).toContainText('Total a pagar');
  await page.evaluate(() => { location.hash = '#promocao'; });
  await confere('#pr-vend', 'Promoção por vendedor');
  await page.evaluate(() => { location.hash = '#mapa'; });
  await page.locator('button, [role=tab]', { hasText: 'Rendimento' }).first().click();
  await confere('.card:has-text("Rendimento da equipe")', 'Rendimento da equipe');
  if (cel) { // tocar na pessoa abre a evolução dela
    await page.locator('.card:has-text("Rendimento da equipe") .lmob-it').first().click();
    await expect.poll(() => page.evaluate(() => TS.state.eqPessoa)).toBeTruthy();
  }
  await page.evaluate(() => { TS.state.eqPessoa = null; location.hash = '#clientes'; });
  await confere('.card:has-text("Vendedoras e clientes")', 'Vendedoras e clientes');
  await page.evaluate(() => { location.hash = '#cupons'; });
  await page.locator('button, [role=tab]', { hasText: 'Lista de itens' }).first().click();
  await confere('.card:has-text("Cupons do período")', 'Cupons → Lista de itens');
  expect(erros).toEqual([]);
});

// LMOB-04 (lote 2 do pente-fino do celular, 24/11/2026): listas de produtos, notas e dinheiro em linhas e filtro em folha
test('LMOB-04: Estoque, Preços, Site, Validade, Notas e Rentabilidade em linhas; filtro do Estoque em folha', async ({ page }, info) => {
  const erros = []; page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  const cel = info.project.name === 'celular';
  for (const tela of ['estoque', 'precos', 'site', 'validade', 'notas', 'rentab']) { // o Pedido tem os cartões próprios com − / ＋ (.ped-card)
    await page.evaluate((t) => { location.hash = '#' + t; }, tela);
    await page.waitForFunction(() => !document.querySelector('main .loading .spinner') && document.querySelector('main .card'), null, { timeout: 30000 });
    if (cel) await expect(page.locator('main .lmob-it').first(), tela).toBeVisible({ timeout: 20000 });
    else await expect(page.locator('main table.t').first(), tela).toBeVisible({ timeout: 20000 });
    await semRolarDeLado(page);
  }
  // Estoque: o filtro de 7 opções é um botão que abre a folha (celular) ou a faixa de abas (computador)
  await page.evaluate(() => { location.hash = '#estoque'; });
  const tab = page.locator('#est-tabela');
  await expect(tab).toBeVisible();
  if (cel) {
    await tab.locator('.seg-folha').click();
    const folha = page.locator('.folha');
    await expect(folha.locator('.folha-op')).toHaveCount(7);
    await folha.locator('.folha-op', { hasText: 'Parados' }).click();
    await expect(folha).toHaveCount(0);
    await expect(tab.locator('.seg-folha')).toContainText('Parados');
    await expect(tab.locator('.lmob-it').first().locator('.lmob-val')).toContainText('R$');
  } else {
    await expect(tab.locator('.seg button')).toHaveCount(7);
  }
  expect(erros).toEqual([]);
});
