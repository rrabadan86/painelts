// Testes do favorito do carrinho em páginas de mentira (usado pelo hook testar-favorito): não sobe o servidor do painel.
const { defineConfig } = require('@playwright/test');
const exe = process.env.CHROME_PATH || (require('fs').existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
module.exports = defineConfig({
  testDir: '../../tests/e2e',
  testMatch: /carrinho-conjunta\.spec\.js$/,
  retries: 0,
  reporter: 'line',
  use: { trace: 'off', ...(exe ? { launchOptions: { executablePath: exe, args: ['--no-sandbox'] } } : {}) },
  projects: [{ name: 'computador', use: { viewport: { width: 1280, height: 900 } } }],
});
