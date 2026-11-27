const { test, expect } = require('./_base');
// ESC-25: Movimento e escala → Escala do mês → "⎙ Exportar PDF" monta a página de impressão (#impressao) com o cabeçalho,
// a tabela do mês, a legenda inteira, os feriados do mês e as assinaturas, e chama a janela de impressão do navegador
// (que é onde a pessoa salva em PDF). Na apresentação: window.print é trocado por um contador para o teste não travar.

test('ESC-25: Exportar PDF da escala monta a página de impressão e abre a janela de imprimir', async ({ page }) => {
  await page.addInitScript(() => {
    window.__impressoes = [];
    window.print = () => {
      const el = document.getElementById('impressao');
      window.__impressoes.push({ temPagina: !!el, classe: document.body.classList.contains('imprimindo-doc'), texto: el ? el.innerText : '',
        linhas: el ? el.querySelectorAll('table.sem-t.pdf tbody tr').length : 0, ass: el ? el.querySelectorAll('.imp-ass > div').length : 0 });
    };
  });
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.selectOption('#lojaSel', 'demo-parque');
  await page.evaluate(() => { TS.state.escMesYm = '2026-11'; TS.state.mapaAba = 'escala'; location.hash = '#mapa'; });
  const botao = page.getByRole('button', { name: /Exportar PDF/ });
  await expect(botao).toBeVisible();
  await botao.click();
  await page.waitForFunction(() => window.__impressoes.length === 1);
  const imp = await page.evaluate(() => window.__impressoes[0]);
  expect(imp.temPagina, 'a página de impressão existe quando a janela abre').toBe(true);
  expect(imp.classe, 'o corpo entra no modo de impressão de documento').toBe(true);
  expect(imp.texto).toContain('Escala de trabalho');
  expect(imp.texto).toContain('Novembro de 2026');
  expect(imp.texto).toMatch(/Escala (5x2|6x1|4x3)/);
  expect(imp.texto).toContain('Feriados: 02/11 Finados'); // feriados do mês no rodapé
  expect(imp.texto).toContain('Responsável pela loja');
  expect(imp.texto).toContain('Ciente da equipe');
  expect(imp.texto).toMatch(/Emitido em \d\d\/\d\d\/\d{4}/);
  expect(imp.texto).not.toMatch(/undefined|null|NaN/);
  expect(imp.linhas, 'uma linha por pessoa na tabela do PDF (também no celular, que na tela mostra por dia)').toBeGreaterThan(0);
  expect(imp.ass).toBe(2);
  // depois de imprimir, a página de impressão some e o painel volta ao normal
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('#impressao')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.classList.contains('imprimindo-doc'))).toBe(false);
  // exportar de novo não duplica a página
  await botao.click();
  await page.waitForFunction(() => window.__impressoes.length === 2);
  await expect(page.locator('#impressao')).toHaveCount(1);
});
