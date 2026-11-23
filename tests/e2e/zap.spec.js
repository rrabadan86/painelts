// Robô do WhatsApp das campanhas na apresentação: o cartão em Configurações → loja → Mensagens e a faixa em Campanhas
// aparecem, respondem aos botões com respostas simuladas e NADA sai para as rotas de verdade (nada é conectado nem enviado).
const { test, expect } = require('@playwright/test');

test.describe('robô do WhatsApp', () => {
  let erros, pedidos;
  test.beforeEach(async ({ page }) => {
    erros = []; pedidos = [];
    page.on('pageerror', (e) => erros.push(e.message));
    page.on('request', (r) => { const u = new URL(r.url()); if (/\/zap\//.test(u.pathname)) pedidos.push(`${r.method()} ${u.pathname}`); });
    await page.goto('/apresentacao');
    await page.waitForFunction(() => window.TS && TS.db);
  });
  const semVazar = async (page, alvo) => {
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw - cw, 'sem rolagem para o lado').toBeLessThanOrEqual(2);
    expect(await alvo.innerText()).not.toMatch(/(^|\s)(null|undefined|NaN)(\s|$)/m);
  };

  test('Configurações → loja → Mensagens: cartão com conexão, ligar/pausar, ritmo, horário, dias, máximo e falhas', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#config'; });
    await page.locator('table.cfg-lojas-t .cfg-abrir').first().click();
    await page.locator('.cfg-loja .cfg-sub a', { hasText: 'Mensagens' }).evaluate((a) => a.click());
    const card = page.locator('.zap-cfg');
    await expect(card.locator('h3')).toContainText('Robô do WhatsApp');
    await expect(card.locator('.zap-risco')).toContainText('O WhatsApp pode bloquear o número');
    await expect(card).toContainText('número final 8888');
    await expect(card).toContainText('Hoje: 12 de 30');
    // cada campo com a explicação (ⓘ) e os padrões do dono
    expect(await card.locator('.zap-campos .dica-i').count()).toBeGreaterThanOrEqual(5);
    const nums = card.locator('.zap-campos input[type=number]');
    await expect(nums.nth(0)).toHaveValue('900'); await expect(nums.nth(1)).toHaveValue('1200');
    await expect(card.locator('input[type=time]').nth(0)).toHaveValue('09:00'); await expect(card.locator('input[type=time]').nth(1)).toHaveValue('18:30');
    await expect(nums.nth(2)).toHaveValue('30'); await expect(nums.nth(3)).toHaveValue('3');
    await expect(card.locator('.zap-dias input:checked')).toHaveCount(6);
    // ZAP-HORA-LOJA: horário de envio igual ao funcionamento da loja (padrão), dia a dia, de 30 min antes de abrir até 30 min antes de fechar
    await expect(card.getByRole('radio', { name: 'Igual ao funcionamento da loja' })).toBeChecked();
    const tab = card.locator('.zap-tab-hora');
    await expect(tab).toBeVisible();
    await expect(tab.locator('tr', { hasText: 'seg' })).toContainText('08:30 às 18:30');
    await expect(tab.locator('tr', { hasText: 'sáb' })).toContainText('08:30 às 16:30');
    await expect(tab.locator('tr', { hasText: 'dom' })).toContainText('fechada');
    await expect(card).toContainText('Envia de 30 min antes de abrir até 30 min antes de fechar');
    await expect(card.locator('.zap-hora-proprio')).toBeHidden();
    // horário próprio: aparecem das/às e os dias
    await card.getByRole('radio', { name: 'Horário próprio' }).check();
    await expect(card.locator('.zap-hora-proprio')).toBeVisible();
    await expect(tab).toBeHidden();
    await semVazar(page, card);
    await card.getByRole('radio', { name: 'Igual ao funcionamento da loja' }).check();
    // ritmo abaixo de 300 s: aviso ⚠ ao sair do campo (não a cada dígito)
    const aviso = card.locator('.zap-aviso');
    await expect(aviso).toBeHidden();
    await nums.nth(0).fill('120'); await nums.nth(1).focus();
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('risco de bloqueio');
    await semVazar(page, card);
    // valor fora do limite: o servidor recusa com a explicação
    await nums.nth(0).fill('30');
    await card.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(card.locator('.notice.err')).toContainText('de 60 a 7200 segundos');
    // pausar: resposta simulada
    await card.getByRole('button', { name: 'Pausar', exact: true }).click();
    await expect(card.locator('.badge', { hasText: 'Pausado' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Ligar de novo', exact: true })).toBeVisible();
    await semVazar(page, card);
    expect(pedidos.length).toBeGreaterThan(0);
    expect(pedidos.filter((p) => !p.includes('/api/demo/zap/')), 'só as rotas da apresentação').toEqual([]);
    expect(erros).toEqual([]);
  });

  test('Campanhas: faixa de situação do robô com Pausar; ligar o robô na campanha mostra antes quantos recebem, limites e término (ZAP-LIGAR)', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#campanhas'; });
    const faixa = page.locator('.zap-faixa');
    await expect(faixa).toBeVisible();
    await expect(faixa).toContainText('Robô do WhatsApp');
    await expect(faixa.locator('.badge', { hasText: 'Ligado' })).toBeVisible();
    // 2ª passada (23/11/2026): a faixa virou o herói da tela — robô · enviadas hoje · não enviadas (que leva à aba)
    await expect(faixa.locator('.heroi-col', { hasText: 'Enviadas hoje' }).locator('.heroi-num')).toContainText('12 de 30');
    // dentro do horário: "próxima mensagem por volta de HH:MM"; quando a próxima cairia depois do horário (ou num dia sem envio), diz quando volta
    await expect(faixa).toContainText(/próxima mensagem por volta de \d\d:\d\d|hoje não sai mais nenhuma .* volta .* às \d\d:\d\d/i);
    const ne = faixa.locator('.heroi-col', { hasText: 'Não enviadas' });
    await expect(ne.locator('.heroi-num')).toHaveText(/^\d+$/);
    await ne.getByRole('button', { name: 'Ver quem e por quê ›' }).click();
    await expect(page.locator('.cp-visao [aria-pressed="true"], .cp-visao .on').first()).toContainText('Não enviadas');
    await page.locator('.cp-visao').getByText('Campanhas', { exact: true }).click();
    await semVazar(page, faixa);
    // uma campanha de exemplo (fica só na memória do navegador)
    await page.getByRole('button', { name: 'Criar campanha' }).click();
    await page.locator('.cp-nome input').fill('Teste do robô');
    await expect.poll(async () => +(await page.locator('.cp-contagem b').innerText()).replace(/\D/g, '')).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Salvar campanha' }).click();
    // sem critério a lista pega quase a base inteira: aviso e confirmação (decisão do dono)
    const conf = page.locator('.ts-conf');
    await expect(conf).toContainText('quase todos os clientes');
    await conf.getByRole('button', { name: 'Salvar assim mesmo' }).click();
    const opcao = page.locator('.zap-opcao');
    await expect(opcao).toContainText('Desligado: só o envio manual');
    // ligar: a janela do painel (não o confirm do navegador) diz o que vai acontecer antes
    let dialogo = false;
    page.on('dialog', (d) => { dialogo = true; d.dismiss(); });
    await opcao.getByRole('button', { name: '🤖 Ligar o robô para esta campanha' }).click();
    await expect(conf).toBeVisible();
    await expect(conf).toContainText(/Vai enviar para: [\d.]+ clientes/);
    await expect(conf).toContainText('ficam sem mensagem, para comparar');
    await expect(conf).toContainText(/Por dia: até 20 desta campanha · 30 no número da loja/);
    await expect(conf).toContainText(/Quando: seg a sex 08:30–18:30, sáb 08:30–16:30, dom fechado \(horário de Brasília, o mesmo do funcionamento da loja\)/);
    await expect(conf).toContainText(/Termina: por volta de \d\d\/\d\d\/\d{4} \([\d.]+ dias de envio/);
    await expect(conf).toContainText('A primeira sai');
    await expect(conf).toContainText('Exemplo da mensagem');
    await expect(conf).toContainText('pode bloquear o número');
    await semVazar(page, conf);
    // cancelar não liga
    await conf.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('.zap-opcao')).toContainText('Desligado');
    await opcao.getByRole('button', { name: '🤖 Ligar o robô para esta campanha' }).click();
    await conf.getByRole('button', { name: 'Ligar o robô' }).click();
    await expect(page.locator('.zap-opcao')).toContainText('Robô ligado nesta campanha');
    await expect(page.locator('.zap-opcao')).toContainText('O robô envia os pendentes desta lista');
    expect(dialogo, 'sem confirm() do navegador').toBe(false);
    // com o robô ligado, o envio manual deixa de ser o botão principal
    await expect(page.locator('.cp-enviar')).not.toHaveClass(/primary/);
    await semVazar(page, page.locator('#content, main').first());
    await page.getByRole('button', { name: '‹ Voltar às campanhas' }).click();
    await expect(page.locator('.cp-lin .cli-tag', { hasText: 'robô' }).first()).toBeVisible();
    // pausar pela faixa
    await faixa.getByRole('button', { name: 'Pausar o robô' }).click();
    await expect(faixa.locator('.badge', { hasText: 'Pausado' })).toBeVisible();
    await expect(faixa).toContainText('Nada é enviado até alguém ligar de novo');
    expect(pedidos.filter((p) => !p.includes('/api/demo/zap/')), 'só as rotas da apresentação').toEqual([]);
    expect(erros).toEqual([]);
  });
  test('Campanhas: ao criar, "Quem envia" = robô já abre a janela de ligar com os números (pedido do dono)', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#campanhas'; });
    await expect(page.locator('.zap-faixa')).toBeVisible();
    await page.getByRole('button', { name: 'Criar campanha' }).click();
    await page.locator('.cp-nome input').fill('Teste quem envia');
    await expect.poll(async () => +(await page.locator('.cp-contagem b').innerText()).replace(/\D/g, '')).toBeGreaterThan(0);
    await page.getByLabel('Quem envia').selectOption('robo');
    await page.getByRole('button', { name: 'Salvar campanha' }).click();
    const conf = page.locator('.ts-conf');
    await expect(conf).toContainText('quase todos os clientes');
    await conf.getByRole('button', { name: 'Salvar assim mesmo' }).click();
    // a janela de ligar abre sozinha; o robô só liga se confirmar
    await expect(conf).toContainText('Ligar o robô para "Teste quem envia"?');
    await expect(conf).toContainText(/Vai enviar para: [\d.]+ clientes/);
    await conf.getByRole('button', { name: 'Ligar o robô' }).click();
    await expect(page.locator('.zap-opcao')).toContainText('Robô ligado nesta campanha');
    expect(erros).toEqual([]);
  });
  test('ZAP-SEMWPP: pausa por "sem WhatsApp" seguidos aparece como alerta na faixa, com o caminho para os pulados', async ({ page }) => {
    await page.route('**/api/demo/zap/situacao*', async (route) => {
      const r = await route.fetch(); const j = await r.json();
      if (!j.cfg) return route.fulfill({ response: r });
      j.pausa = { auto: true, semWpp: true, em: new Date().toISOString(), por: 'robô', motivo: '5 clientes seguidos sem WhatsApp — confira se a conferência do número está funcionando (abra um desses números no WhatsApp do celular)' };
      j.proximoEm = null;
      route.fulfill({ json: j });
    });
    await page.evaluate(() => { location.hash = '#campanhas'; });
    const alerta = page.locator('.zap-faixa .zap-alerta');
    await expect(alerta).toBeVisible();
    await expect(alerta).toContainText('Robô pausado: 5 clientes seguidos sem WhatsApp');
    await expect(alerta.getByRole('link', { name: 'Ver os pulados ›' })).toBeVisible();
    await expect(page.locator('.zap-faixa .badge', { hasText: 'Pausou sozinho' })).toBeVisible();
    await semVazar(page, page.locator('.zap-faixa'));
    expect(erros).toEqual([]);
  });
  // O robô não depende da tela: o servidor roda a conta dos MESMOS arquivos da tela (src/zapauto.js). Aqui a prova de
  // que dá o mesmo resultado: o navegador e o servidor, com os mesmos dados fictícios, montam a mesma lista e os mesmos valores.
  test('lista e valores da campanha: o servidor calcula igual ao navegador', async ({ page }) => {
    const ZA = require('../../src/zapauto');
    await page.evaluate(() => { location.hash = '#campanhas'; });
    await page.waitForFunction(() => TS.cli && TS.campanhasCalc && TS.db && !TS.db.desde && TS.state.loja && TS.state.loja !== 'todas');
    const FILTROS = [{ ptsMin: 5 }, { venceDias: 60 }, { segs: ['sumido', 'repor'] }, { rfm: ['campeao', 'risco'] }, { ausMin: 30, ausMax: 120, visMin: 2 }, { aniv: 'proximo' }, { lojaPref: 'nossa', compraDias: 90 }];
    const camp = (lista) => ({ id: 'c', mensagem: '{saudacao}, {nome}! Seu {cha} acabou? Você tem {pontos} pontos.', variacoes: ['Oi, {nome}: que tal o {ultimocha}?'], filtros: {}, rodadas: [{ id: 'r', lista: lista.slice(0, 400).map((x) => ({ ...x, st: 'p' })) }] });
    const naTela = await page.evaluate(async ({ FILTROS, campTxt }) => {
      const camp = new Function('return ' + campTxt)();
      const disp = await TS.estoqueDisp(TS.state.loja);
      const listas = FILTROS.map((f) => TS.campanhasCalc.listaDe(f));
      return { loja: TS.state.loja, nome: (TS.lojas.find((l) => l.id === TS.state.loja) || {}).nome, geradoEm: TS.db.geradoEm, listas, itens: TS.campanhasCalc.itensPreparo(camp(listas[0]), disp) };
    }, { FILTROS, campTxt: camp.toString() });
    const dados = await page.request.get('/api/demo/dados?loja=' + encodeURIComponent(naTela.loja));
    const corpo = await dados.text();
    test.skip(JSON.parse(corpo).geradoEm !== naTela.geradoEm, 'os dados fictícios foram refeitos entre as duas leituras (virada da hora)');
    const estoque = await (await page.request.get('/api/demo/estoque/disponivel?loja=' + encodeURIComponent(naTela.loja))).json();
    const t = ZA.tela({ loja: { id: naTela.loja, nome: naTela.nome }, corpo, contatos: {}, disponivel: () => estoque });
    const noServidor = { listas: FILTROS.map((f) => t.listaDe(f)), itens: await t.itens(camp(naTela.listas[0])) };
    expect(naTela.listas.reduce((n, l) => n + l.length, 0), 'os critérios de exemplo trazem clientes').toBeGreaterThan(50);
    expect(noServidor.listas).toEqual(naTela.listas);
    // na apresentação o link do WhatsApp é de mentira (sem número): compara os valores dos campos e a trava de estoque.
    // A {saudacao} fica de fora: o servidor não guarda (ZF.gravarPreparo) e refaz na hora do envio, no horário de Brasília.
    const semNumero = (l) => l.map(({ para, v: { saudacao, ...v }, ...x }) => JSON.parse(JSON.stringify({ ...x, v })));
    expect(naTela.itens.length).toBeGreaterThan(10);
    expect(naTela.itens.every((x) => x.para === null), 'apresentação: nenhum número de verdade').toBe(true);
    expect(semNumero(noServidor.itens)).toEqual(semNumero(naTela.itens));
    expect(pedidos.filter((p) => !/\/api\/demo\//.test(p))).toEqual([]);
    expect(erros).toEqual([]);
  });
});

test('Campanhas: "Configurar" abre o cartão do robô numa janela (é por aqui que a gerente conecta e ajusta)', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas');
  await page.evaluate(() => { location.hash = '#campanhas'; });
  const bt = page.getByRole('button', { name: /Configurar ›|Conectar e configurar ›/ }).first();
  await expect(bt).toBeVisible();
  await bt.evaluate((b) => b.click());
  const j = page.locator('.zap-janela');
  await expect(j).toBeVisible();
  await expect(j).toContainText('Robô do WhatsApp');
  await expect(j).toContainText('Ritmo');
  expect(await j.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(j).toHaveCount(0);
});
