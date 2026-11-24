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

// ---- seletores com muitas opções (TS.segFolha, FOLHA-01): no computador são as abas (.seg button); no celular, um
// botão (.seg-folha) que abre a folha de opções (.folha-op, com o "(N)" em .folha-n). Estes ajudantes fazem o mesmo nos dois.
const raizDe = (page, escopo) => (!escopo ? page.locator('main') : typeof escopo === 'string' ? page.locator(escopo) : escopo);
const casa = (txt, alvo) => (txt instanceof RegExp ? txt.test(alvo) : alvo.includes(txt));
/** escolhe a opção que contém `texto` (string ou RegExp contra o nome da opção, sem o "(N)") */
async function escolherOpcao(page, escopo, texto) {
  const raiz = raizDe(page, escopo);
  const folhas = raiz.locator('.seg-folha');
  const n = await folhas.count();
  if (!n) { await raiz.locator('.seg button', { hasText: texto }).first().click(); return; }
  for (let i = 0; i < n; i++) {
    await folhas.nth(i).click();
    const ops = page.locator('.folha .folha-op');
    await ops.first().waitFor();
    const nomes = await ops.locator('.folha-t b').allInnerTexts();
    const k = nomes.findIndex((x) => casa(texto, x.trim()));
    if (k >= 0) { await ops.nth(k).click(); await page.locator('.folha').waitFor({ state: 'detached' }); return; }
    await page.locator('.folha .folha-x').click();
    await page.locator('.folha').waitFor({ state: 'detached' });
  }
  throw new Error(`opção "${texto}" não encontrada`);
}
/** nomes das opções (com o "(N)" de volta, como no computador) — no celular abre e fecha a folha */
async function nomesOpcoes(page, escopo, qual = 0) {
  const raiz = raizDe(page, escopo);
  if (!(await raiz.locator('.seg-folha').count())) return (await raiz.locator('.seg').nth(qual).locator(':scope > button').allInnerTexts()).map((t) => t.trim());
  await raiz.locator('.seg-folha').nth(qual).click();
  const ops = page.locator('.folha .folha-op');
  await ops.first().waitFor();
  const out = [];
  for (const op of await ops.all()) {
    const nome = (await op.locator('.folha-t b').innerText()).trim();
    const n = await op.locator('.folha-n').count() ? (await op.locator('.folha-n').innerText()).trim() : null;
    out.push(n != null ? `${nome} (${n})` : nome);
  }
  await page.locator('.folha .folha-x').click();
  await page.locator('.folha').waitFor({ state: 'detached' });
  return out;
}
/** texto da opção escolhida */
async function opcaoAtiva(page, escopo, qual = 0) {
  const raiz = raizDe(page, escopo);
  if (await raiz.locator('.seg-folha').count()) return (await raiz.locator('.seg-folha').nth(qual).locator('b').innerText()).trim();
  return (await raiz.locator('.seg').nth(qual).locator(':scope > button.on').innerText()).trim();
}
/** linhas de tabela no computador ou linhas da lista no celular (LMOB) */
const LINHAS = 'tbody tr, .lmob-it';

module.exports = { ...base, test, expect: base.expect, escolherOpcao, nomesOpcoes, opcaoAtiva, LINHAS };
