// Testes de tela POR PERFIL no painel de verdade (não a apresentação, que entra sempre como admin): o servidor sobe com uma
// pasta de dados temporária preparada por tests/perfis/preparar.js (vendas e estoque fictícios da apresentação, um usuário
// de cada perfil) e o teste entra pelo /login como franqueado, gerente (com e sem tela de custo) e vendedora.
// Local: npx playwright test -c playwright.perfis.config.js
const { defineConfig, devices } = require('@playwright/test');
const PORTA = 3541; // fora das portas que o fetch recusa (tests/unit/_porta.js)
const DADOS = 'tests/.dados-perfis';
const launchOptions = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
module.exports = defineConfig({
  testDir: 'tests/perfis',
  timeout: 90000,
  expect: { timeout: 20000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-perfis' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${PORTA}`, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', launchOptions },
  projects: [
    { name: 'computador', use: { viewport: { width: 1366, height: 900 } } },
    { name: 'celular', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, launchOptions } },
  ],
  webServer: {
    command: 'node tests/perfis/preparar.js && node server.js',
    url: `http://127.0.0.1:${PORTA}/login`,
    reuseExistingServer: false,
    timeout: 90000,
    env: { PORT: String(PORTA), CONFIG_FILE: `${DADOS}/lojas.json`, DATA_DIR: DADOS, SESSION_SECRET: 'teste-perfis', NODE_ENV: 'test' },
  },
});
