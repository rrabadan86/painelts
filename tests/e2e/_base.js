// Base dos testes de tela: o mesmo `test`/`expect` do Playwright, com uma conferência a mais em todo teste.
// CLIQUE-VISTA-01: todo clique do teste tem de ser num elemento que a pessoa enxerga sem rolar nada para o lado.
// O Playwright rola sozinho até o elemento antes de clicar, inclusive dentro de uma tabela que rola de lado;
// por isso o "✕ Tirar" da campanha, escondido à direita, passava no teste e o dono não achava o botão (23/11/2026).
// Aqui, cada clique de verdade (isTrusted) é conferido no navegador: se a página ou algum bloco dela
// (fora as faixas de abas e o submenu, que rolam de propósito) precisou rolar para o lado, o teste falha.
const base = require('@playwright/test');

/** roda no navegador: anota os cliques em elemento que só aparece rolando para o lado */
function vigiarCliques() {
  window.__cliquesEscondidos = [];
  const PODE_ROLAR = '.seg, .submenu, #tabs';
  document.addEventListener('click', (ev) => {
    if (!ev.isTrusted) return;
    const alvo = ev.target instanceof Element ? ev.target : null;
    if (!alvo) return;
    const nome = (alvo.closest('button, a, [role="button"], input, select, label, tr') || alvo);
    const txt = ((nome.getAttribute && (nome.getAttribute('aria-label') || nome.getAttribute('title'))) || nome.textContent || nome.tagName).trim().replace(/\s+/g, ' ').slice(0, 50);
    if (window.scrollX > 2) { window.__cliquesEscondidos.push(`"${txt}": a página rolou ${Math.round(window.scrollX)}px para o lado`); return; }
    for (let e = alvo.parentElement; e && e !== document.body; e = e.parentElement) {
      if (e.scrollLeft > 2 && !e.matches(PODE_ROLAR) && !e.closest(PODE_ROLAR)) {
        const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        window.__cliquesEscondidos.push(`"${txt}": só aparece rolando ${Math.round(e.scrollLeft)}px para o lado dentro de ${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}`);
        return;
      }
    }
  }, true);
}

const test = base.test.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(vigiarCliques);
    await use(page);
    const escondidos = await page.evaluate(() => window.__cliquesEscondidos || []).catch(() => []);
    base.expect(escondidos, 'CLIQUE-VISTA-01: o teste clicou em algo que a pessoa não enxerga sem rolar para o lado').toEqual([]);
  },
});

module.exports = { ...base, test, expect: base.expect };
