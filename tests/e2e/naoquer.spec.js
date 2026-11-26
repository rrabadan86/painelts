// "Não quer mensagens" marcado na ficha aberta pela conversa ("Ver cliente"): antes dava "Cannot set properties of null"
// (a lista de contatos da loja ainda não tinha vindo) — visto pelo dono em 23/11/2026. Agora avisa numa janela e a conversa
// mostra a marca "🚫 não quer mensagens" no topo e na lista.
const { test, expect } = require('./_base');

test('NAOQUER-02: conversa → Ver cliente → "Não quer mensagens": sem erro, janela explica, a conversa continua aberta e ganha a marca', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.cli && TS.cli.lista);
  await page.evaluate(() => { location.hash = '#conversas'; });
  const lista = page.locator('.cv-col-lista');
  await expect(lista).toContainText('Contato sem cadastro');
  const nome = await page.evaluate(() => TS.cli.lista.filter((c) => TS.foneConversa(c).length >= 12)[0].nome);
  await lista.locator('.cv-item', { hasText: nome }).first().click();
  const conv = page.locator('.cv-conversa');
  await expect(conv.locator('.cv-naoquer')).toHaveCount(0);
  await conv.getByRole('button', { name: 'Ver cliente' }).click();
  await page.getByRole('button', { name: 'Não quer mensagens' }).last().click();
  // a janela explica o que aconteceu (no lugar do erro)
  const janela = page.locator('.ts-perg, [role="dialog"]').filter({ hasText: 'não vai mais receber mensagens' });
  await expect(janela).toBeVisible();
  await expect(page.getByText(/Cannot set properties/)).toHaveCount(0);
  // fechar o aviso faz o painel tirar a entrada dele do histórico (history.back em seguida): espera isso antes do "voltar"
  await page.evaluate(() => { window.__pop = new Promise((ok) => { addEventListener('popstate', ok, { once: true }); setTimeout(ok, 3000); }); });
  await janela.getByRole('button').first().click();
  await page.evaluate(() => window.__pop);
  // a marca na conversa (por baixo da ficha, que continua aberta) e na lista
  await expect(page.locator('.cv-conversa .cv-naoquer')).toBeAttached();
  // no celular a conversa fica no lugar da lista: fechar o aviso NÃO fecha a conversa (antes fechava); fecha a ficha e volta
  if (info.project.name === 'celular') {
    await page.goBack(); // o "voltar" do celular fecha a ficha, não a conversa
    await expect(page.locator('.camada-cheia')).toHaveCount(0);
    await expect(page.locator('.cv-conversa .cv-naoquer')).toBeVisible();
    await page.getByRole('button', { name: '‹ Voltar' }).click();
  }
  await expect(lista.locator('.cv-item', { hasText: nome }).first()).toContainText('não quer');
  expect(erros).toEqual([]);
});
