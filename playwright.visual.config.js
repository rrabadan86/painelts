// Prints de referência (regressão visual): as telas principais da apresentação, no computador e no celular, com o
// relógio parado (servidor e navegador no mesmo dia e hora). Compara com as imagens de tests/visual/__prints__.
//   Rodar:     npx playwright test -c playwright.visual.config.js
//   Atualizar (mudança de layout de propósito): GitHub → Actions → "Prints de referência" → Run workflow, no ramo do PR,
//   com "atualizar" marcado: gera as imagens no mesmo Ubuntu do GitHub e sobe no ramo. As referências SEMPRE vêm do
//   GitHub (a fonte de outra máquina desenha diferente). Para conferir só aqui: PRINTS_LOCAL=1 (pasta __prints-local__,
//   fora do Git) com --update-snapshots na primeira vez.
const { defineConfig, devices } = require('@playwright/test');
const RELOGIO = require('./tests/visual/_relogio');
const PORTA = 3311;
const launchOptions = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const pasta = process.env.PRINTS_LOCAL ? '__prints-local__' : '__prints__';
module.exports = defineConfig({
  testDir: 'tests/visual',
  timeout: 120000,
  expect: { timeout: 20000, toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide', scale: 'css' } },
  snapshotPathTemplate: `{testDir}/${pasta}/{projectName}/{arg}{ext}`,
  outputDir: 'test-results-prints',
  retries: 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'prints-report' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${PORTA}`, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', launchOptions },
  projects: [
    { name: 'computador', use: { viewport: { width: 1366, height: 900 } } },
    { name: 'celular', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, launchOptions } },
  ],
  webServer: {
    command: 'node -e "require(\'fs\').mkdirSync(\'tests/.dados-prints\',{recursive:true});require(\'fs\').copyFileSync(\'tests/fixtures/lojas.json\',\'tests/.dados-prints/lojas.json\')" && node server.js',
    url: `http://127.0.0.1:${PORTA}/apresentacao`,
    reuseExistingServer: false,
    timeout: 60000,
    env: { PORT: String(PORTA), CONFIG_FILE: 'tests/.dados-prints/lojas.json', DATA_DIR: 'tests/.dados-prints', SESSION_SECRET: 'teste-prints', NODE_ENV: 'test',
      RELOGIO_FIXO: RELOGIO, NODE_OPTIONS: '--require ./tests/visual/relogio-fixo.js' },
  },
});
