// DATA-01 e DATA-02: as telas principais em datas difíceis (1º do mês, último dia, domingo com a loja fechada, 1º de janeiro).
// O servidor da apresentação gera os dados fictícios até o "hoje" do projeto (PAINEL_HOJE_TESTE, playwright.datas.config.js)
// e o relógio do navegador fica parado no mesmo instante: nada de erro de JavaScript, "NaN/undefined/null/Infinity", rolagem
// para o lado ou projeção/meta absurda. Falha que só aparece num dia do calendário cai aqui (e na rodada noturna), não na loja.
const { test, expect } = require('../e2e/_base');

const TELAS = [
  ['inicio', 'Início'], ['resumo', 'Resumo'], ['comissionamento', 'Comissionamento'], ['estoque', 'Estoque'],
  ['validade', 'Validade'], ['pedido', 'Pedido'], ['hoje', 'Clientes → Hoje'],
];

async function abrir(page, info, erros) {
  const hoje = info.project.metadata.hoje; // "2026-12-01T10" (Brasília)
  await page.clock.setFixedTime(new Date(`${hoje}:05:00-03:00`));
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  return hoje;
}

/** o conteúdo da tela: sem texto quebrado, sem rolar para o lado, sem percentual absurdo */
async function conferirTela(page, rot) {
  const txt = await page.locator('main').innerText();
  expect(txt, `${rot}: texto quebrado`).not.toMatch(/(^|[\s(·:])(NaN|undefined|null|Infinity|-Infinity)([\s).,%·]|$)/);
  expect(txt, `${rot}: "Invalid Date"`).not.toMatch(/Invalid Date/);
  const lado = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(lado, `${rot}: a página rola para o lado`).toBeLessThanOrEqual(1);
  if ((page.viewportSize() || {}).width > 860) {
    const tab = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('main .table-wrap')].filter((w) => w.offsetParent).map((w) => w.scrollWidth - w.clientWidth)));
    expect(tab, `${rot}: tabela rola para o lado a 1100 px`).toBeLessThanOrEqual(2);
  }
  // percentuais absurdos (meta, projeção, variação) denunciam conta dividida por zero ou dia errado
  const pcts = [...txt.matchAll(/([-+]?\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s?%/g)].map((m) => Math.abs(+m[1].replace(/\./g, '').replace(',', '.')));
  expect(pcts.filter((p) => p > 100000), `${rot}: percentual absurdo`).toEqual([]);
}

for (const [hash, rot] of TELAS) {
  test(`DATA-01: ${rot} abre sem erro, sem "NaN/null" e sem rolar para o lado`, async ({ page }, info) => {
    const erros = [];
    await abrir(page, info, erros);
    await page.evaluate((h) => { location.hash = '#' + h; }, hash);
    await expect(page.locator('.page-title').first()).toBeVisible({ timeout: 60000 });
    // estoque, validade e pedido buscam dados depois de abrir: espera a tela terminar de montar
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);
    await conferirTela(page, `${info.project.name} · ${rot}`);
    expect(erros, `${rot}: erro de JavaScript`).toEqual([]);
  });
}

test('DATA-02: meta e projeção do mês com valores possíveis (sem divisão por zero no começo e no fim do mês)', async ({ page }, info) => {
  const erros = [];
  const hoje = await abrir(page, info, erros);
  const r = await page.evaluate(() => {
    const db = TS.db, ym = TS.dayToIso(db.maxDay).slice(0, 7);
    const P = TS.projecaoMes(ym, { base: 'loja' }), M = TS.projecaoMes(ym, { base: 'meta' });
    return { ultimo: TS.dayToIso(db.maxDay), hojeTela: TS.hojeSP(), proj: P && P.proj, real: P && P.realizado, projMeta: M && M.proj, meta: TS.metaCalc(ym).valor };
  });
  // o "hoje" da tela é o do relógio parado; os dados terminam nele ou antes (domingo com a loja fechada não tem venda)
  expect(r.hojeTela).toBe(hoje.slice(0, 10));
  expect(r.ultimo <= hoje.slice(0, 10), `último dia com venda ${r.ultimo}`).toBe(true);
  // e os dados fictícios terminam mesmo nesse dia (o servidor usou PAINEL_HOJE_TESTE): no máximo 2 dias antes (loja fechada)
  expect((Date.parse(hoje.slice(0, 10)) - Date.parse(r.ultimo)) / 864e5, `último dia com venda ${r.ultimo}`).toBeLessThanOrEqual(2);
  for (const [k, v] of Object.entries({ proj: r.proj, real: r.real, projMeta: r.projMeta, meta: r.meta })) if (v != null) expect(Number.isFinite(v), `${k} = ${v}`).toBe(true);
  if (r.proj != null && r.real != null) {
    expect(r.proj).toBeGreaterThanOrEqual(r.real - 1); // a projeção nunca fica abaixo do que já vendeu
    expect(r.proj).toBeLessThan(Math.max(r.real, 1) * 40); // nem 40× o realizado (dia 1 dividindo por quase zero)
  }
  await page.evaluate(() => { location.hash = '#inicio'; });
  const her = page.locator('main .ini-heroi .heroi-pri');
  await expect(her).toBeVisible({ timeout: 60000 });
  const pct = await her.getAttribute('data-pct-meta');
  if (pct != null && pct !== '') { expect(Number.isFinite(+pct)).toBe(true); expect(+pct).toBeGreaterThanOrEqual(0); expect(+pct).toBeLessThan(20); }
  expect(erros).toEqual([]);
});
