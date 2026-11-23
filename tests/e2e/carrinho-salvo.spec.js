const { test, expect } = require('./_base');
const fs = require('fs');
const path = require('path');

// Estoque → Pedido: carrinho salvo (5 dias) e venda conjunta do site (a mug com o infusor dela)
test('Pedido: aviso do carrinho salvo, "Continuar de onde parei" troca as quantidades pelas salvas; salvar na apresentação não grava', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  const saiu = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && /\/api\//.test(r.url()) && !/\/api\/demo\//.test(r.url())) saiu.push(r.url()); });
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#pedido'; });
  const aviso = page.locator('.ped-rasc');
  await expect(aviso).toBeVisible({ timeout: 40000 });
  await expect(aviso).toContainText(/Tem um carrinho salvo por gerente em \d{2}\/\d{2}/);
  await expect(aviso).toContainText('4 produtos');
  await expect(aviso).toContainText('Fica guardado até');
  // "tem um carrinho salvo" fica no topo da tela, antes dos ajustes
  expect(await aviso.evaluate((el) => !!el.closest('.ped-pend'))).toBe(true);
  const salvo = await page.evaluate(async () => (await (await fetch(`/api/demo/pedido?loja=${encodeURIComponent(TS.state.loja)}`)).json()).rascunho);
  expect(Math.round((Date.parse(salvo.expira) - Date.parse(salvo.em)) / 864e5)).toBe(5);
  if (process.env.PRINTS) { await aviso.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.PRINTS}/carrinho-salvo-${info.project.name}.png` }); }
  // continuar: o pedido da tela passa a ser exatamente o salvo
  await aviso.getByRole('button', { name: 'Continuar de onde parei' }).click();
  await expect(page.locator('.toast')).toContainText('Carrinho salvo carregado');
  await expect(page.locator('.ped-rasc')).toHaveCount(0);
  await expect(page.locator('.ped-rasc-ok')).toContainText('Carrinho salvo em');
  await expect(page.locator('.seg button', { hasText: /^Complemento \(/ })).toHaveText(`Complemento (${Object.values(salvo.itens).filter((q) => q > 0).length})`);
  // salvar na apresentação: avisa e nada sai do navegador
  const salvar = page.locator('.ped-salvar');
  await expect(salvar).toHaveAttribute('title', /5 dias/);
  await salvar.click();
  await expect(page.locator('.toast')).toContainText('nada é salvo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
  expect(saiu).toEqual([]);
  expect(erros).toEqual([]);
});

test('Favorito do carrinho: reconhece a janela "Venda Conjunta", lê o que vem junto e clica em "Colocar Todos no Carrinho"', async ({ page }) => {
  // a função do favorito, tirada do arquivo, rodando numa página igual à janela do site
  const fonte = fs.readFileSync(path.join(__dirname, '../../public/js/carrinho-site.js'), 'utf8');
  const fn = fonte.slice(fonte.indexOf('const RE_TODOS ='), fonte.indexOf('const ajustar = '));
  const num = /const num = [^\n]+/.exec(fonte)[0];
  await page.setContent(`<div class="modal" style="display:block"><div class="modal-content"><h4>Venda Conjunta</h4>
    <div class="modal-body"><p>Na compra de <b>Mug Harmony Royal Horse</b>, também devem ser adicionados no carrinho os produtos da lista abaixo.</p>
    <table><tr><th>Código</th><th>Produto</th><th>Unidade</th><th>Quantidade</th><th>Preço Unitário</th></tr>
    <tr><td>79161</td><td>Infusor Mug Royal Horse</td><td>Un</td><td>4,00</td><td>33,00</td></tr></table></div>
    <button id="nao" onclick="window.clicou='nao'">Não adicionar</button><a id="sim" href="#" onclick="window.clicou='sim';return false">  Colocar Todos
      no Carrinho </a></div></div>
    <div class="modal" style="display:none"><a onclick="window.clicou='escondido'">Colocar Todos no Carrinho</a></div>`);
  const r = await page.evaluate(`(() => { ${num}; ${fn}; const v = vendaConjunta(document); if (!v) return null; v.botao.click(); return { itens: v.itens, id: v.botao.id, clicou: window.clicou }; })()`);
  expect(r).toEqual({ itens: [{ cod: '79161', nome: 'Infusor Mug Royal Horse', qtd: 4, preco: 33 }], id: 'sim', clicou: 'sim' });
  // sem a janela (ou com ela escondida): nada a fazer
  await page.setContent('<div class="modal" style="display:none"><a>Colocar Todos no Carrinho</a></div><button>Colocar no Carrinho</button>');
  expect(await page.evaluate(`(() => { ${num}; ${fn}; return vendaConjunta(document); })()`)).toBeNull();
});

test('Pedido: o registro do carrinho montado pergunta se o pedido foi feito, com "Confirmar" e "Excluir" (apresentação: nada é gravado)', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  const saiu = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && /\/api\//.test(r.url()) && !/\/api\/demo\//.test(r.url())) saiu.push(r.url()); });
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#pedido'; });
  const reg = page.locator('.ped-ult');
  await expect(reg).toBeVisible({ timeout: 40000 });
  // a pendência também aparece numa linha no topo da tela (revisão de 22/11/2026), com as mesmas duas respostas
  const topo = page.locator('.ped-pend .ped-pend-car');
  await expect(topo).toContainText(/Carrinho de \d{2}\/\d{2}.* ainda sem confirmar/);
  await expect(topo.getByRole('button', { name: '✓ Sim, foi feito' })).toBeVisible();
  await expect(topo.getByRole('button', { name: 'Não fiz' })).toBeVisible();
  expect(await topo.evaluate((el) => el.getBoundingClientRect().top < document.querySelector('.ped-ctl').getBoundingClientRect().top)).toBe(true);
  await expect(reg.locator('summary')).toContainText('carrinho montado em');
  await expect(reg.locator('.ped-conf-sit')).toHaveText('falta confirmar');
  const perg = reg.locator('.ped-conf');
  await expect(perg).toContainText('Este pedido foi finalizado no site?');
  const sim = perg.getByRole('button', { name: '✓ Sim, o pedido foi feito' }), nao = perg.getByRole('button', { name: 'Não fiz: excluir' });
  await expect(nao).toHaveAttribute('title', /como se o carrinho não tivesse sido montado/);
  await perg.scrollIntoViewIfNeeded();
  if (process.env.PRINTS) await page.screenshot({ path: `${process.env.PRINTS}/carrinho-confirmar-${info.project.name}.png` });
  await sim.click();
  await expect(page.locator('.toast')).toContainText('nada é salvo');
  page.once('dialog', (d) => d.accept());
  await nao.click();
  await expect(page.locator('.toast')).toContainText('nada é salvo');
  await expect(reg).toBeVisible(); // na apresentação o registro continua
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
  expect(saiu).toEqual([]);
  expect(erros).toEqual([]);
});

