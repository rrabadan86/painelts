const { test, expect } = require('@playwright/test');

// Campanhas (pedidos do dono de 23/11/2026, apresentação, computador e celular):
// CAMP-FORA-04 tirar um cliente à mão da lista e trazer de volta; AVISO-SALVAR-01 erro ao salvar abre a janela "Não foi salvo"
async function abrirCriar(page) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#campanhas'; });
  await expect(page.getByRole('button', { name: '+ Criar campanha' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ Criar campanha' }).click();
}
const total = (page) => async () => +(await page.locator('.cp-contagem b').innerText()).replace(/\D/g, '');

test('CAMP-FORA-04: "✕ Tirar" tira o cliente da lista da campanha, ele aparece em "Tirados à mão" e volta pelo botão', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrirCriar(page);
  await expect.poll(total(page)).toBeGreaterThan(1);
  const antes = await total(page)();
  const botao = page.locator('.cp-tirar').first();
  const rotulo = await botao.getAttribute('aria-label');
  const nomeCli = rotulo.replace(/^Tirar /, '').replace(/ da campanha$/, '');
  await botao.click();
  await expect.poll(total(page)).toBe(antes - 1);
  const fora = page.locator('.cp-fora');
  await expect(fora).toContainText('Tirados à mão (1)');
  await expect(fora).toContainText(nomeCli);
  await expect(fora.locator('.dica-i')).toHaveCount(1);
  await expect(page.locator(`.cp-tirar[aria-label="${rotulo}"]`)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
  if (process.env.PRINTS) { await fora.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.PRINTS}/tirados-${info.project.name}.png` }); }
  await fora.getByRole('button', { name: 'Voltar para a campanha' }).click();
  await expect.poll(total(page)).toBe(antes);
  await expect(page.locator('.cp-fora')).toHaveCount(0);
  expect(erros).toEqual([]);
});

test('AVISO-SALVAR-01: salvar a campanha sem nome abre a janela "Não foi salvo"; "Corrigir" fecha e marca o campo', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrirCriar(page);
  await expect.poll(total(page)).toBeGreaterThan(0);
  const nome = page.locator('input.f-input[placeholder^="Ex.: Pontos"]');
  await nome.fill('');
  await page.getByRole('button', { name: 'Salvar campanha' }).click();
  const janela = page.getByRole('alertdialog').filter({ hasText: 'Não foi salvo' });
  await expect(janela).toBeVisible();
  await expect(janela).toContainText('Dê um nome à campanha.');
  await expect(janela).toHaveClass(/ts-perg-erro/);
  if (process.env.PRINTS) await page.screenshot({ path: `${process.env.PRINTS}/naosalvo-${info.project.name}.png` });
  await janela.getByRole('button', { name: 'Corrigir' }).click();
  await expect(janela).toHaveCount(0);
  await expect(nome).toHaveAttribute('aria-invalid', 'true');
  await expect(nome).toBeFocused();
  await expect(page.locator('.campo-erro-msg')).toHaveText('Dê um nome à campanha.');
  if (process.env.PRINTS) await page.screenshot({ path: `${process.env.PRINTS}/corrigir-${info.project.name}.png` });
  // ao digitar, a marca some
  await nome.fill('Pontos de dezembro');
  await expect(nome).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.campo-erro-msg')).toHaveCount(0);
  expect(erros).toEqual([]);
});
