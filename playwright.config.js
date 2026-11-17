// Testes de tela: abrem a apresentação (dados fictícios) no computador e no celular.
// Local: npm run test:e2e  (CHROME_PATH aponta para um Chromium já instalado, se precisar)
const { defineConfig, devices } = require('@playwright/test');
const PORTA = 3099;
const launchOptions = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${PORTA}`, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', launchOptions },
  projects: [
    { name: 'computador', use: { viewport: { width: 1366, height: 900 } } },
    { name: 'celular', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, launchOptions } },
  ],
  webServer: {
    command: 'node -e "require(\'fs\').mkdirSync(\'tests/.dados\',{recursive:true});require(\'fs\').copyFileSync(\'tests/fixtures/lojas.json\',\'tests/.dados/lojas.json\')" && node server.js',
    url: `http://127.0.0.1:${PORTA}/apresentacao`,
    reuseExistingServer: false,
    timeout: 60000,
    env: { PORT: String(PORTA), CONFIG_FILE: 'tests/.dados/lojas.json', DATA_DIR: 'tests/.dados', SESSION_SECRET: 'teste-automatico', NODE_ENV: 'test' },
  },
});
