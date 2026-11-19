const { test, expect } = require('@playwright/test');
test('voltar do celular fecha a janela por cima e fica na mesma tela', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#inicio'; }); await page.waitForTimeout(800);
  await page.evaluate(() => { location.hash = '#cupons'; });
  await page.waitForTimeout(800);
  await page.locator('.exp-btn:not(.prt-btn)').first().click();
  await expect(page.locator('.camada-cheia')).toHaveCount(1);
  await page.goBack();
  await expect(page.locator('.camada-cheia')).toHaveCount(0);
  expect(await page.evaluate(() => location.hash)).toBe('#cupons');
  // fechando pelo X/fundo, o "voltar" seguinte já troca de tela (não sobra entrada)
  await page.locator('.exp-btn:not(.prt-btn)').first().click();
  await expect(page.locator('.camada-cheia')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.camada-cheia')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => location.hash)).toBe('#cupons');
  await page.goBack();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => location.hash)).toBe('#inicio');
});

test('gráfico: botão Compartilhar gera a imagem (no computador, baixa o PNG)', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#resumo'; }); await page.waitForTimeout(1200);
  const b = page.locator('.shr-btn').first();
  await expect(b).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), b.click()]);
  expect(dl.suggestedFilename()).toMatch(/\.png$/);
  const p = await dl.path(); const fs = require('fs');
  expect(fs.statSync(p).size).toBeGreaterThan(5000);
  fs.copyFileSync(p, '/tmp/share.png');
});

test('Créditos com a franquia: devoluções compensadas pelo desconto das notas, atrasadas e aviso no Início', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#creditos'; });
  const corpo = page.locator('#app, main, body').first();
  await expect(page.locator('.nf-abas button', { hasText: 'Créditos com a franquia' })).toHaveClass(/on/);
  await page.locator('.seg button', { hasText: 'Todas' }).first().click();
  await expect(corpo).toContainText('na NF 19120');
  await expect(corpo).toContainText('Atrasado');
  await expect(corpo).toContainText('Para resolver (1)');
  await expect(corpo).toContainText('Sobram');
  await page.locator('.cff summary').click();
  await expect(page.locator('.cff')).toContainText('Compensou');
  await page.evaluate(() => { location.hash = '#inicio'; });
  await expect(page.locator('.ini-avisos')).toContainText(/Franquia: 1 devolução sem desconto/);
});

test('Créditos: botões da linha não abrem a nota; "ligar" lista também as devoluções só sugeridas', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#creditos'; });
  await page.locator('.seg button', { hasText: 'Todas' }).first().click();
  await page.locator('.cfp-item').getByRole('button', { name: 'Trocar' }).click();
  await expect(page.locator('.cf-ligar')).toBeVisible();
  await expect(page.locator('.cf-ligar .cfl-linha').first()).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#creditos');
  await expect(page.locator('.prc-drawer')).toHaveCount(0);
  await page.locator('.cf-ligar').getByRole('button', { name: 'Cancelar' }).click();
  // menu ⋯ abre sem abrir a NF-e
  await page.locator('.cf-tab .cf-mais').first().click();
  await expect(page.locator('.cf-menu-lista:visible')).toContainText('Compensada no boleto');
  await expect(page.locator('.camada-cheia, .prc-drawer-camada')).toHaveCount(0);
});

test('Créditos: prêmios de fidelidade (50% do custo) × desconto nos royalties, com o mês de referência', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#creditos'; });
  const card = page.locator('.card', { hasText: 'Prêmios de fidelidade · desconto nos royalties' });
  await expect(card).toContainText('Veio a menos');
  await expect(card).toContainText('Recebido certo');
  await expect(card).toContainText(/royalty de /);
  await card.locator('tbody tr').first().click();
  await expect(page.locator('.cfr-mes')).toContainText('Prêmios de');
  await expect(page.locator('.cfr-mes .cfm-cab')).toContainText('Cupom da venda');
  await expect(page.locator('.cfr-mes .cfm-item').first()).toBeVisible();
  await page.locator('.cfr-mes').getByRole('button', { name: 'Fechar' }).click();
  await card.getByRole('button', { name: '+ Lançar desconto nos royalties' }).click();
  await expect(page.locator('.cf-ligar')).toContainText('Royalty de referência');
  await expect(page.locator('.cf-ligar')).toContainText('Referente aos prêmios de');
});

test('Prêmio de fidelidade: acha o cupom da venda em que o prêmio saiu (mesmo dia, hora perto, produto no cupom)', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.fx);
  const r = await page.evaluate(() => {
    const db = TS.db;
    let i = -1; for (let k = db.n - 1; k >= 0; k--) if (db.min[k] != null) { i = k; break; }
    db.fidelidade = [{ id: 'lojaX', vendaLoja: db.D.loja[db.loja[i]], nomes: [], lojas: [], propria: [], ev: [], regras: {} }];
    const res = TS.fx.cupomDosResgates('lojaX', [
      { data: TS.dayToIso(db.day[i]), min: db.min[i] + 5, produtos: [db.D.descricao[db.desc[i]]] },
      { data: TS.dayToIso(db.day[i]), min: db.min[i], produtos: ['PRODUTO QUE NAO EXISTE XYZ'] },
    ]);
    // o cliente do resgate está no FIXE: o CPF na nota acha o cupom mesmo sem o produto
    db.xml = [...(db.xml || []), { cpf: '12345678909', loja: db.D.loja[db.loja[i]], cupom: db.cupom[i], data: TS.dayToIso(db.day[i]) }];
    const pc = TS.fx.cupomDosResgates('lojaX', [{ cpf: '12345678909', data: TS.dayToIso(db.day[i]), min: db.min[i] + 60, produtos: ['PRÊMIO COM OUTRO NOME'] }]);
    return { esperado: db.cupom[i], achou: res[0] && res[0].cupom, nada: res[1], porCpf: pc[0] && pc[0].cupom, como: pc[0] && pc[0].como };
  });
  expect(r.achou).toBe(r.esperado);
  expect(r.nada).toBeNull();
  expect([r.porCpf, r.como]).toEqual([r.esperado, 'cpf']);
});

test('Cobrar a franquia: e-mail das devoluções e dos prêmios (revisar antes; sem coluna de cupom)', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#creditos'; });
  await page.locator('.card', { hasText: 'Devoluções' }).getByRole('button', { name: '✉ Cobrar a franquia' }).click();
  const m = page.locator('.cfe');
  await expect(m).toContainText('Cobrar a franquia · devoluções');
  await expect(m.locator('.cfe-prev')).toContainText('NF-e 531');
  await expect(m.locator('input').nth(0)).not.toHaveValue('');
  await m.getByRole('button', { name: 'Fechar' }).click();
  await page.locator('.card', { hasText: 'Prêmios de fidelidade' }).last().getByRole('button', { name: '✉ Cobrar a franquia' }).click();
  await expect(page.locator('.cfe .cfe-prev')).toContainText('Falta');
  await expect(page.locator('.cfe')).not.toContainText(/Cupom/);
});

test('Créditos no celular: o menu ⋯ abre dentro da tela', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#creditos'; });
  const b = page.locator('.cf-tab .cf-mais, .card .cf-mais').first();
  await b.scrollIntoViewIfNeeded();
  await b.click();
  const lista = page.locator('.cf-menu-lista:visible').first();
  await expect(lista).toBeVisible();
  const box = await lista.boundingBox(), vw = page.viewportSize().width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
});

test('Orçamento: monta com margem bruta e líquida, salva, aprova e o documento do cliente não mostra custo', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#orcamento'; });
  await page.getByRole('button', { name: '+ Novo orçamento' }).click();
  await page.locator('.cfr-campo', { hasText: 'Empresa' }).locator('input').fill('Empresa Exemplo Ltda');
  const busca = page.getByPlaceholder('Buscar produto: nome ou código…');
  await busca.fill('ch');
  await page.locator('.orc-sug').first().click();
  const vend = page.locator('.cfr-campo', { hasText: 'Vendedora' }).locator('select');
  await expect(vend.locator('option')).not.toHaveCount(1);
  await vend.selectOption({ index: 1 });
  await page.locator('.orc-linha input').first().fill('20');
  await page.locator('.orc-linha input').first().dispatchEvent('change');
  const painel = page.locator('.orc-painel');
  await expect(painel).toContainText('Margem bruta');
  await expect(painel).toContainText('Margem líquida');
  await expect(painel).toContainText('Royalties');
  expect(await page.locator('main').innerText(), 'texto "null" no orçamento').not.toMatch(/(^|\s)(null|undefined|NaN)(\s|$)/);
  await expect(page.getByRole('button', { name: '✓ Cliente aprovou' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '🖨 Imprimir / PDF para o cliente' })).toBeDisabled();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('.inv-titulo')).toContainText('Orçamento #1');
  await expect(page.getByRole('button', { name: '✓ Cliente aprovou' })).toBeEnabled();
  await page.locator('.cfr-campo', { hasText: 'Entrega' }).locator('input').fill('retirada');
  await expect(page.getByRole('button', { name: '✓ Cliente aprovou' })).toBeDisabled();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('button', { name: '✓ Cliente aprovou' })).toBeEnabled();
  await page.getByRole('button', { name: '✓ Cliente aprovou' }).click();
  await expect(page.locator('.cf-st', { hasText: 'Aprovado' })).toBeVisible();
  await expect(page.getByRole('button', { name: '🧾 Emitir NF-e de venda' })).toBeVisible();
  await page.getByRole('button', { name: '‹ Orçamentos' }).click();
  await expect(page.locator('.card', { hasText: 'Orçamentos' })).toContainText('Empresa Exemplo Ltda');
});

test('Custo subiu: margem antes × agora e preço sugerido para manter a margem', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#notas'; });
  await page.waitForFunction(() => TS.impactoCusto);
  const r = await page.evaluate(async () => {
    const M = await TS.custosLoja(); const e = await TS.estoqueBuscar(TS.state.loja);
    const t = e.tabela.itens.find((x) => !/100G/.test(x.desc));
    const it = M.porCod.get(String(t.cod));
    const imp = TS.impactoCusto(M, e.tabela.itens, [{ cod: t.cod, nome: t.desc, antes: it.custo, depois: it.custo * 1.2 }]);
    return { n: imp.length, x: imp[0], preco: t.preco, custo: it.custo };
  });
  expect(r.n).toBe(1);
  expect(r.x.mD).toBeLessThan(r.x.mA);
  expect(r.x.sug).toBeGreaterThan(r.preco);
  expect(Math.round((r.x.sug * 100)) % 100).toBe(90);
});

test('Hoje: meta do dia da loja e a parte de cada vendedora', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.cli);
  await page.evaluate(() => { location.hash = '#hoje'; });
  const c = page.locator('.md-card');
  await expect(c).toContainText('Meta de hoje');
  await expect(c).toContainText(/Falta R\$/);
  await expect(c.locator('.md-v').first()).toBeVisible();
});

test('Checklist: marcar item guarda quem e a hora; editar os itens', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#checklist'; });
  const ab = page.locator('.ck-parte').first();
  await expect(ab).toContainText('Abertura');
  await ab.locator('.ck-item input').first().check();
  await expect(page.locator('.ck-parte').first().locator('.ck-quem').first()).toContainText('apresentacao');
  await expect(page.locator('.ck-parte').first()).toContainText('1 de 4');
  await page.getByRole('button', { name: 'Editar os itens' }).click();
  await expect(page.locator('.ck-ed')).toContainText('Fechamento');
});

test('Orçamento: o cliente sai da base de clientes (nome ou CPF/CNPJ)', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#orcamento'; });
  await page.getByRole('button', { name: '+ Novo orçamento' }).click();
  await page.waitForFunction(() => TS.cli && TS.cli.lista && TS.cli.lista.length);
  const nome = await page.evaluate(() => TS.cli.lista.find((c) => c.nome && c.nome.length > 5).nome);
  const campo = page.locator('.cfr-campo', { hasText: 'Contato' }).locator('input');
  await campo.fill(nome.slice(0, 5));
  await page.locator('.orc-cli-sugs .orc-sug').first().click();
  await expect(page.locator('.cfr-campo', { hasText: 'CNPJ / CPF' }).locator('input')).not.toHaveValue('');
  await expect(page.locator('.orc-cli-info')).toContainText('Cliente da base');
});

test('Nota de entrada: custo que baixou a margem fica em amarelo na lista; chá abre os pacotes numa janela', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#notas'; });
  const links = page.locator('a.prc-nome');
  await expect(links.first()).toBeVisible();
  // acha uma nota fictícia em que o custo subiu
  let achou = false;
  for (let k = 0; k < Math.min(await links.count(), 30) && !achou; k++) {
    await page.evaluate(() => document.querySelector('.prc-drawer-camada')?.remove());
    await links.nth(k).evaluate((a) => a.click());
    achou = await page.locator('.nf-impacto').waitFor({ timeout: 2500 }).then(() => true, () => false);
  }
  expect(achou).toBe(true);
  const aviso = page.locator('.nf-impacto');
  await expect(aviso).toContainText('O custo subiu');
  await expect(aviso.locator('table')).toHaveCount(0); // só o aviso no topo; os produtos ficam na lista da nota
  await expect(page.locator('tr.nf-marg')).not.toHaveCount(0);
  await aviso.getByRole('button', { name: 'Mostrar só esses' }).click();
  await expect(page.locator('.prc-drawer tbody tr:not(.nf-marg)')).toHaveCount(0);
  await aviso.getByRole('button', { name: 'Mostrar todos os produtos' }).click();
  const ver = page.locator('.nf-marg-btn').first();
  if (await ver.count()) {
    await ver.evaluate((b) => b.click());
    const pop = page.locator('.nf-marg-pop');
    await expect(pop).toContainText('Preço p/ manter a margem');
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(page.locator('.prc-drawer')).toBeVisible(); // o Esc fecha só a janela dos pacotes
  }
});

test('Nota de entrada: tocar no produto abre o histórico de compras (gráfico e variação); Esc fecha só a janela', async ({ page }) => {
  // na apresentação cada item tem uma compra só: acrescenta uma 6 meses antes, 10% mais barata
  await page.route('**/api/demo/estoque?*', async (route) => {
    const j = await (await route.fetch()).json();
    const it = (j.compras && j.compras.itens) || {};
    for (const k of Object.keys(it)) { const [dia, custo, , qtd, forn] = it[k][0]; it[k].unshift([new Date(Date.parse(dia) - 180 * 864e5).toISOString().slice(0, 10), Math.round(custo * 90) / 100, 1111, qtd, forn]); }
    await route.fulfill({ json: j });
  });
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#notas'; });
  const link = page.locator('a.prc-nome').first();
  await expect(link).toBeVisible();
  await link.evaluate((a) => a.click());
  const nota = page.locator('.prc-drawer');
  await expect(nota).toBeVisible();
  await nota.locator('.nf-hist-lnk').first().evaluate((b) => b.click());
  const pop = page.locator('.nf-hist-pop');
  await expect(pop).toContainText('Histórico de compras');
  await expect(pop).toContainText('2 notas');
  await expect(pop.locator('canvas')).toHaveCount(1);
  await expect(pop.locator('.prc-badge').first()).toContainText('+');
  await expect(pop).toContainText('esta nota');
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(nota).toBeVisible();
});

test('Nota de entrada: no celular o amarelo vale também para os cartões em posição par', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#notas'; });
  await expect(page.locator('a.prc-nome').first()).toBeVisible();
  const cor = await page.evaluate(() => {
    const t = document.createElement('table'); t.className = 't t-mob';
    t.innerHTML = '<tbody><tr class="nf-marg"><td>a</td></tr><tr class="nf-marg"><td>b</td></tr></tbody>';
    document.body.append(t);
    const c = [...t.querySelectorAll('tr')].map((tr) => getComputedStyle(tr).backgroundColor);
    t.remove();
    return c;
  });
  expect(cor[1]).toBe(cor[0]);
  expect(cor[0]).not.toBe('rgb(255, 255, 255)');
});
