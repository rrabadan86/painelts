const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Aplicativo instalável e notificações, em navegador de verdade.
// O Chromium "sem tela" enxuto vem com as notificações bloqueadas: os testes do service worker usam o Chromium completo (channel).
const PIXEL = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

// Perfil normal de navegador (pasta temporária, apagada no fim): numa janela anônima o Chrome não instala nem assina notificações.
async function comChromiumCompleto(info, fn) {
  const base = info.project.use.baseURL;
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-perfil-'));
  const ctx = await chromium.launchPersistentContext(perfil, { channel: 'chromium', headless: true, baseURL: base, locale: 'pt-BR', ...(info.project.name === 'celular' ? PIXEL : { viewport: { width: 1366, height: 900 } }) });
  try {
    await ctx.grantPermissions(['notifications'], { origin: new URL(base).origin });
    const page = ctx.pages()[0] || await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await fn({ page, cdp, ctx, origem: new URL(base).origin });
  } finally { await ctx.close(); fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

test('aplicativo: manifesto e ícones no tamanho declarado; o Chrome diz que o painel é instalável', async ({}, info) => {
  await comChromiumCompleto(info, async ({ page, cdp }) => {
    await page.goto('/login');
    // as tags estão na tela de login
    expect(await page.locator('link[rel=manifest]').getAttribute('href')).toBe('/manifest.webmanifest');
    expect(await page.locator('meta[name=theme-color]').getAttribute('content')).toBe('#1F3D2B');
    expect(await page.locator('link[rel=apple-touch-icon]').getAttribute('href')).toBe('/icones/apple-touch-icon.png');
    // o navegador lê o manifesto sem erro
    const m = await cdp.send('Page.getAppManifest');
    expect(m.errors, JSON.stringify(m.errors)).toEqual([]);
    const man = JSON.parse(m.data);
    expect(man).toMatchObject({ start_url: '/', scope: '/', display: 'standalone', theme_color: '#1F3D2B' });
    // cada ícone abre como imagem e tem o tamanho que o manifesto declara
    const medidas = await page.evaluate(async (icones) => Promise.all(icones.map(async (src) => { const b = await createImageBitmap(await (await fetch(src)).blob()); return `${b.width}x${b.height}`; })),
      [...man.icons.map((i) => i.src), '/icones/apple-touch-icon.png', '/icones/selo-96.png']);
    expect(medidas).toEqual([...man.icons.map((i) => i.sizes), '180x180', '96x96']);
    expect(man.icons.map((i) => i.purpose)).toEqual(['any', 'any', 'maskable']);
    // ícone "maskable": o desenho fica dentro do círculo seguro (80% do lado) — os cantos e as bordas são só fundo
    const fora = await page.evaluate(async () => {
      const b = await createImageBitmap(await (await fetch('/icones/icone-mascara-512.png')).blob());
      const c = new OffscreenCanvas(512, 512), x = c.getContext('2d'); x.drawImage(b, 0, 0);
      const d = x.getImageData(0, 0, 512, 512).data; let n = 0;
      for (let yy = 0; yy < 512; yy++) for (let xx = 0; xx < 512; xx++) { const i = (yy * 512 + xx) * 4; const fundo = d[i] === 0x1F && d[i + 1] === 0x3D && d[i + 2] === 0x2B && d[i + 3] === 255; if (!fundo && Math.hypot(xx - 255.5, yy - 255.5) > 0.4 * 512) n++; }
      return n;
    });
    expect(fora, 'pontos do desenho fora da área segura').toBe(0);
    // selo da barra de status: uma cor só (branco) sobre fundo transparente
    const selo = await page.evaluate(async () => {
      const b = await createImageBitmap(await (await fetch('/icones/selo-96.png')).blob());
      const c = new OffscreenCanvas(96, 96), x = c.getContext('2d'); x.drawImage(b, 0, 0);
      const d = x.getImageData(0, 0, 96, 96).data; let cor = 0, transp = 0, outra = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] === 0) transp++; else if (d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250) cor++; else outra++; }
      return { cor: cor > 500, transp: transp > 2000, outra };
    });
    expect(selo).toEqual({ cor: true, transp: true, outra: 0 });
    // o painel registra o service worker; depois disso o Chrome não aponta nenhum impedimento para instalar
    await page.goto('/apresentacao');
    await page.waitForFunction(() => window.TS && TS.notif, null, { timeout: 60000 });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    const erros = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors;
    expect(erros.map((e) => e.errorId), 'impedimentos para instalar').toEqual([]);
  });
});

test('notificação: o service worker fica ativo e mostra o que o painel manda, com título, texto e link; mensagem quebrada vira aviso genérico', async ({}, info) => {
  await comChromiumCompleto(info, async ({ page, cdp, origem }) => {
    const regs = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
    await cdp.send('ServiceWorker.enable');
    await page.goto('/apresentacao');
    await page.waitForFunction(() => window.TS && TS.notif, null, { timeout: 60000 });
    const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; await new Promise((ok) => { if (r.active.state === 'activated') ok(); else r.active.addEventListener('statechange', () => r.active.state === 'activated' && ok()); }); return { estado: r.active.state, escopo: r.scope, url: r.active.scriptURL }; });
    expect(sw).toEqual({ estado: 'activated', escopo: origem + '/', url: origem + '/sw.js' });
    expect(await page.evaluate(() => Notification.permission)).toBe('granted');
    // o service worker não guarda página nenhuma
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    await expect.poll(() => regs.find((r) => r.scopeURL === origem + '/')).toBeTruthy();
    const registrationId = regs.find((r) => r.scopeURL === origem + '/').registrationId;
    const entregar = async (data) => {
      await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; (await r.getNotifications()).forEach((n) => n.close()); });
      await expect.poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length)).toBe(0); // a anterior fechou de fato
      await cdp.send('ServiceWorker.deliverPushMessage', { origin: origem, registrationId, data });
      await expect.poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length)).toBe(1);
      return page.evaluate(async () => { const n = (await (await navigator.serviceWorker.ready).getNotifications())[0]; return { titulo: n.title, texto: n.body, link: n.data && n.data.link, icone: new URL(n.icon).pathname, selo: n.badge ? new URL(n.badge).pathname : '', tag: n.tag }; });
    };
    // aviso de verdade, no formato que o servidor manda
    expect(await entregar(JSON.stringify({ titulo: 'Lista de espera · Tea Shop Centro', texto: 'Chegou: Rooibos Lemon Pie (2 clientes)', link: '/#espera', tag: 'espera' })))
      .toEqual({ titulo: 'Lista de espera · Tea Shop Centro', texto: 'Chegou: Rooibos Lemon Pie (2 clientes)', link: '/#espera', icone: '/icones/icone-192.png', selo: '/icones/selo-96.png', tag: 'espera' });
    // link para fora do painel nunca é aceito: vira a entrada do painel
    for (const ruim of ['https://evil.example/roubo', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', 42])
      expect((await entregar(JSON.stringify({ titulo: 'x', texto: 'y', link: ruim }))).link, String(ruim)).toBe('/');
    // mensagem quebrada (não é JSON), vazia ou com tipos errados: aviso genérico, sem erro
    for (const quebrada of ['isto não é json {', '', 'null', '[1,2]', JSON.stringify({ titulo: 7, texto: { a: 1 } })]) {
      const n = await entregar(quebrada);
      expect(n, quebrada).toMatchObject({ titulo: 'Tea Shop · Painel', texto: 'Há uma novidade no painel. Toque para abrir.', link: '/' });
    }
  });
});

test('tela "Notificações e aplicativo": abre pelo menu da pessoa, explica como instalar e lista os aparelhos (apresentação: nada é ativado)', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  const saiu = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && /\/api\//.test(r.url()) && !/\/api\/demo\//.test(r.url())) saiu.push(r.url()); });
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.notif, null, { timeout: 60000 });
  await page.locator('#btnUsuario').click();
  await page.locator('#btnNotif').click();
  const n = page.locator('.notif');
  await expect(n.locator('h2')).toHaveText('Notificações e aplicativo');
  await expect(n.locator('.notif-sec h3')).toHaveText([/Aplicativo/, /Notificações neste aparelho/, /Seus aparelhos/]);
  // toda seção e todo tipo de aviso têm a explicação (ⓘ)
  await expect(n.locator('.notif-sec h3 .dica-i')).toHaveCount(3);
  await n.locator('.notif-como summary').click();
  await expect(n.locator('.notif-como li')).toHaveText([/Android/, /iPhone e iPad.*Tela de Início/, /Computador/]);
  // aparelho fictício: nome, datas e tipos; nada de endereço nem chave
  const ap = n.locator('.notif-ap');
  await expect(ap).toHaveCount(1);
  await expect(ap).toContainText('Chrome no Android');
  await expect(ap).toContainText('Lista de espera: produto chegou');
  expect(await n.innerText()).not.toMatch(/https?:\/\/|googleapis|p256dh|endpoint/i);
  await ap.getByRole('button', { name: 'Remover' }).click();
  await expect(page.locator('.toast')).toContainText('nada é salvo');
  await expect(ap).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
  if (process.env.PRINTS) await page.screenshot({ path: `${process.env.PRINTS}/notif-${info.project.name}.png` });
  await n.getByRole('button', { name: 'Fechar' }).click();
  await expect(page.locator('.notif')).toHaveCount(0);
  expect(saiu, 'nada sai do navegador na apresentação').toEqual([]);
  expect(erros).toEqual([]);
});
