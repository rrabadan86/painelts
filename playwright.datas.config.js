// Testes de tela em DATAS DIFÍCEIS: a apresentação com o "hoje" fixo (1º do mês, último dia do mês, domingo com a loja
// fechada, 1º de janeiro). Um servidor por data (PAINEL_HOJE_TESTE, só vale com NODE_ENV=test) e o relógio do navegador
// parado no mesmo instante (page.clock), nos tamanhos de computador (1100 px) e celular (390 px).
// Local: npx playwright test -c playwright.datas.config.js
const { defineConfig, devices } = require('@playwright/test');
const launchOptions = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
// [nome, PAINEL_HOJE_TESTE (dia e hora de Brasília), porta] — portas fora da lista que o fetch recusa (tests/unit/_porta.js)
const DATAS = [
  ['1o-do-mes', '2026-12-01T10', 3521],
  ['ultimo-dia', '2026-11-30T20', 3522],
  ['domingo-fechada', '2026-11-29T15', 3523],
  ['1o-de-janeiro', '2027-01-01T11', 3524],
];
const DADOS = (n) => `tests/.dados-datas/${n}`;
module.exports = defineConfig({
  testDir: 'tests/datas',
  timeout: 120000,
  expect: { timeout: 20000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-datas' }]] : 'list',
  use: { locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', launchOptions },
  projects: DATAS.flatMap(([nome, hoje, porta]) => [
    { name: `${nome} · computador`, metadata: { hoje }, use: { baseURL: `http://127.0.0.1:${porta}`, viewport: { width: 1100, height: 900 } } },
    { name: `${nome} · celular`, metadata: { hoje }, use: { ...devices['Pixel 7'], baseURL: `http://127.0.0.1:${porta}`, viewport: { width: 390, height: 844 }, launchOptions } },
  ]),
  webServer: DATAS.map(([nome, hoje, porta]) => ({
    command: `node -e "require('fs').mkdirSync('${DADOS(nome)}',{recursive:true});require('fs').copyFileSync('tests/fixtures/lojas.json','${DADOS(nome)}/lojas.json')" && node server.js`,
    url: `http://127.0.0.1:${porta}/apresentacao`,
    reuseExistingServer: false,
    timeout: 90000,
    env: { PORT: String(porta), CONFIG_FILE: `${DADOS(nome)}/lojas.json`, DATA_DIR: DADOS(nome), SESSION_SECRET: 'teste-datas', NODE_ENV: 'test', PAINEL_HOJE_TESTE: hoje },
  })),
});
