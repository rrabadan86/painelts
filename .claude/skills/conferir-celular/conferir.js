#!/usr/bin/env node
'use strict';
/**
 * Abre a apresentação como um celular (390 × 844) e tira um print de cada tela pedida.
 * Uso (na raiz do projeto):
 *   node .claude/skills/conferir-celular/conferir.js <tela> [<tela> ...] [--saida=pasta] [--largura=390] [--inteira]
 *   ex.: node .claude/skills/conferir-celular/conferir.js checklist orcamento
 * Sobe o servidor sozinho (porta 3098, dados de teste em tests/.dados) e no fim derruba o servidor e apaga tests/.dados.
 * Para cada tela informa: erro de JavaScript, "null/undefined/NaN" no texto e se a página ficou mais larga que a tela.
 * CHROME_PATH aponta para um Chromium já instalado, se precisar.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.resolve(__dirname, '../../..');
const args = process.argv.slice(2);
const opc = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const telas = args.filter((a) => !a.startsWith('--'));
if (!telas.length) { console.error('Diga quais telas: node .claude/skills/conferir-celular/conferir.js <tela> [<tela> ...]'); process.exit(1); }
const LARGURA = +opc.largura || 390;
const SAIDA = path.resolve(RAIZ, opc.saida || 'test-results/celular');
const PORTA = 3098;
const BASE = `http://127.0.0.1:${PORTA}`;
const TEXTO_RUIM = /(^|[\s>(\d])(null|undefined|NaN|\[object Object\])(?=$|[\s<).,])/m;

function carregarPlaywright() {
  for (const nome of ['@playwright/test', 'playwright']) {
    try { return require(require.resolve(nome, { paths: [RAIZ] })); } catch { /* tenta o próximo */ }
    try { return require(nome); } catch { /* tenta o próximo */ }
  }
  console.error('Playwright não encontrado: rode "npm ci" na raiz do projeto.'); process.exit(1);
}

async function esperarServidor(srv) {
  for (let k = 0; k < 120; k++) {
    if (srv.exitCode != null) throw new Error('o servidor parou ao iniciar');
    try { const r = await fetch(BASE + '/apresentacao'); if (r.ok) return; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('o servidor não respondeu em 60 s');
}

(async () => {
  const { chromium } = carregarPlaywright();
  fs.mkdirSync(path.join(RAIZ, 'tests/.dados'), { recursive: true });
  fs.copyFileSync(path.join(RAIZ, 'tests/fixtures/lojas.json'), path.join(RAIZ, 'tests/.dados/lojas.json'));
  fs.mkdirSync(SAIDA, { recursive: true });
  let log = '';
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(PORTA), CONFIG_FILE: 'tests/.dados/lojas.json', DATA_DIR: 'tests/.dados', SESSION_SECRET: 'teste-automatico', NODE_ENV: 'test', IA_FALSO: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  let browser, falhou = false;
  try {
    await esperarServidor(srv);
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
    const ctx = await browser.newContext({ viewport: { width: LARGURA, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push('JS: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) erros.push('console: ' + m.text()); });
    await page.goto(BASE + '/apresentacao');
    await page.waitForFunction(() => window.TS && TS.db && document.querySelector('#tabs a'), null, { timeout: 60000 });
    for (const tela of telas) {
      erros.length = 0;
      await page.evaluate((t) => { location.hash = '#' + t; }, tela);
      await page.waitForFunction(() => !document.querySelector('main .loading .spinner') && document.querySelector('main h1, main .page-title, main .card'), null, { timeout: 30000 }).catch(() => erros.push('a tela não terminou de carregar em 30 s'));
      await page.waitForTimeout(500);
      const larga = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const texto = await page.locator('main').innerText().catch(() => '');
      const ruim = texto.match(TEXTO_RUIM);
      const arq = path.join(SAIDA, `${tela}-${LARGURA}px.png`);
      await page.screenshot({ path: arq, fullPage: !!opc.inteira });
      const problemas = [...erros, ...(larga > 1 ? [`página ${larga}px mais larga que a tela (rolagem para o lado)`] : []), ...(ruim ? [`texto quebrado: "${ruim[2]}"`] : [])];
      if (problemas.length) falhou = true;
      const mostra = arq.startsWith(RAIZ + path.sep) ? path.relative(RAIZ, arq) : arq;
      console.log(`${problemas.length ? '✗' : '✓'} ${tela}: ${mostra}${problemas.map((p) => '\n    - ' + p).join('')}`);
    }
  } catch (e) {
    falhou = true;
    console.error('Falhou: ' + e.message + (log ? '\n--- servidor ---\n' + log.slice(-2000) : ''));
  } finally {
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(path.join(RAIZ, 'tests/.dados'), { recursive: true, force: true });
  }
  process.exit(falhou ? 1 : 0);
})();
