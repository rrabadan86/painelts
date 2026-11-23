// CLIQUE-VISTA-02: todo teste de tela usa a base comum (tests/e2e/_base.js), que confere se o clique foi num elemento à vista.
// Um spec novo que importe direto do '@playwright/test' passaria sem essa conferência.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
// aplicativo.spec abre o Chromium completo com perfil próprio (notificações) e não usa a página de cada teste
const FORA = new Set(['e2e/aplicativo.spec.js']);

test('CLIQUE-VISTA-02: todo spec de tela (e2e, perfis, datas) importa test/expect de tests/e2e/_base.js', () => {
  const ruins = [];
  for (const pasta of ['e2e', 'perfis', 'datas']) {
    for (const f of fs.readdirSync(path.join(RAIZ, pasta)).filter((x) => x.endsWith('.spec.js'))) {
      const rel = `${pasta}/${f}`;
      if (FORA.has(rel)) continue;
      const txt = fs.readFileSync(path.join(RAIZ, pasta, f), 'utf8');
      if (/require\(['"]@playwright\/test['"]\)/.test(txt) || !/require\(['"](\.\/|\.\.\/e2e\/)_base['"]\)/.test(txt)) ruins.push(rel);
    }
  }
  assert.deepStrictEqual(ruins, [], 'importe de tests/e2e/_base.js (veja o comentário no topo dele)');
});
