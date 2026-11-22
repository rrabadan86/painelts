const { test, expect } = require('@playwright/test');

// Vendas → Conferência (apresentação): caixa × painel, cancelados e saúde dos dados, no computador e no celular
async function abrir(page) {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.conferencia && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#conferencia'; });
  await expect(page.locator('.page-title')).toHaveText('Conferência');
  await expect(page.locator('.conf-abas')).toBeVisible({ timeout: 20000 });
}
const semRolagem = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'rolagem para o lado').toBeLessThanOrEqual(1);
const print = async (page, info, nome) => { if (process.env.PRINTS) await page.screenshot({ path: `${process.env.PRINTS}/conferencia-${nome}-${info.project.name}.png`, fullPage: true }); };

test('Conferência: quadros clicáveis filtram a tabela do dia a dia e o motivo provável aparece', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  // está no menu de Vendas
  await expect(page.locator('nav.submenu a.on')).toHaveText('Conferência');
  const d = await page.evaluate(async () => (await fetch(`/api/demo/conferencia?loja=${encodeURIComponent(TS.state.loja)}`)).json());
  expect(d.resumo.naobate).toBeGreaterThan(0);
  expect(d.resumo.explicado).toBeGreaterThan(0);
  // os quadros mostram os mesmos números da resposta
  const quadro = (rot) => page.locator('.kpi', { hasText: rot });
  await expect(quadro('Não batem').locator('.kpi-value')).toHaveText(String(d.resumo.naobate));
  await expect(quadro('Dias que batem').locator('.kpi-value')).toHaveText(String(d.resumo.bate + d.resumo.explicado));
  // começa na aba "Não batem" (é o que pede ação) e o aviso do topo aponta o dia
  const seg = page.locator('.card', { hasText: 'Dia a dia' }).locator('.seg');
  await expect(seg.locator('button.on')).toContainText('Não batem');
  await expect(page.locator('.conf-t').first().locator('tbody tr')).toHaveCount(d.resumo.naobate);
  await expect(page.locator('.conf-t').first().locator('tbody tr').first()).toContainText('Não bate');
  await expect(page.locator('.conf-t').first().locator('tbody tr').first()).toContainText(/O caixa recebeu|As vendas do painel/);
  // clicar no quadro muda a aba marcada e a tabela (o seletor reflete a tela)
  await quadro('Dias que batem').click();
  await expect(seg.locator('button.on')).toContainText('Batem');
  await expect(page.locator('.conf-t').first().locator('tbody')).toContainText('Bate com explicação');
  await expect(page.locator('.conf-t').first().locator('tbody')).toContainText('depois da meia-noite');
  await quadro('Sem fechamento').click();
  await expect(seg.locator('button.on')).toContainText('Sem fechamento');
  // formas de pagamento e sobras/faltas por operador e por dia da semana
  await expect(page.locator('.card', { hasText: 'Formas de pagamento no período' })).toContainText('Pix');
  const sf = page.locator('.card', { hasText: 'Sobras e faltas de caixa' });
  await expect(sf).toContainText('Operador');
  await sf.locator('.seg button', { hasText: 'Por dia da semana' }).click();
  await expect(sf.locator('tbody')).toContainText(/Segunda|Terça|Quarta|Quinta|Sexta|Sábado|Domingo/);
  // ajustes: tolerância e o que fazer com cupom cancelado (na apresentação nada é salvo)
  const aj = page.locator('.conf-ajustes');
  await expect(aj.locator('.conf-tol')).toHaveValue('1');
  await expect(aj.locator('select')).toHaveValue('avisar');
  await aj.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('.toast')).toContainText(/apresentação/i);
  await quadro('Não batem').click();
  await print(page, info, 'caixa');
  if (info.project.name === 'computador') {
    // sem rolagem horizontal na tabela
    const sobra = await page.locator('.conf-t').first().evaluate((t) => t.parentElement.scrollWidth - t.parentElement.clientWidth);
    expect(sobra, 'tabela rolando para o lado').toBeLessThanOrEqual(1);
  }
  await semRolagem(page);
  expect(erros).toEqual([]);
});

test('Conferência: cancelados mostram o impacto nas vendas e a saúde dos dados casa vendas com o estoque', async ({ page }, info) => {
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await abrir(page);
  const d = await page.evaluate(async () => (await fetch(`/api/demo/conferencia?loja=${encodeURIComponent(TS.state.loja)}`)).json());
  expect(d.cancelados.impacto.cupons).toBe(2);
  await page.locator('.conf-abas button', { hasText: 'Cancelados' }).click();
  await expect(page.locator('.notice.warn')).toContainText('ainda contam nas vendas');
  await expect(page.locator('.kpi', { hasText: 'Ainda contam nas vendas' })).toHaveClass(/kpi-ruim/);
  const t = page.locator('.conf-t').first();
  await expect(t.locator('tbody tr')).toHaveCount(3);
  await expect(t.locator('tbody tr.conf-conta')).toHaveCount(2);
  await expect(t.locator('tbody')).toContainText('Fora das vendas');
  await print(page, info, 'cancelados');
  await page.locator('.seg button', { hasText: 'Por vendedor' }).click();
  await expect(page.locator('.conf-t').first().locator('tbody')).toContainText('(fora da planilha de vendas)');
  await page.locator('.seg button', { hasText: 'Por dia' }).click();
  await expect(page.locator('.conf-t').first().locator('thead')).toContainText('Cancelado no caixa');
  await semRolagem(page);

  // saúde dos dados
  await page.locator('.conf-abas button', { hasText: 'Saúde dos dados' }).click();
  await expect(page.locator('.kpi', { hasText: 'Casado pelo código' })).toBeVisible({ timeout: 20000 });
  for (const q of ['Casado pelo nome', 'Sem produto no estoque', 'Vendas sem custo']) await expect(page.locator('.kpi', { hasText: q }).locator('.kpi-value')).toHaveText(/%$/);
  const fontes = page.locator('.card', { hasText: 'Fontes dos dados' });
  await expect(fontes.locator('tbody tr')).toHaveCount(7);
  await expect(fontes).toContainText('Em dia');
  await expect(fontes).toContainText('Atrasada');
  await expect(fontes).toContainText('Parada');
  await expect(page.locator('.card', { hasText: 'Produtos vendidos sem ligação ou sem custo' })).toBeVisible();
  await print(page, info, 'saude');
  await semRolagem(page);
  expect(await page.locator('main').innerText()).not.toMatch(/\bnull\b|undefined|NaN/);
  expect(erros).toEqual([]);
});

test('Início avisa quando um dia recente não bate com o caixa e leva à aba certa', async ({ page }) => {
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.db && TS.conferencia && TS.state.loja && TS.state.loja !== 'todas', null, { timeout: 60000 });
  await page.evaluate(() => { location.hash = '#inicio'; });
  await page.locator('.ini-ver-todos').click(); // a lista completa fica em "Ver todos" (redesenho de 22/11/2026)
  const aviso = page.locator('.ini-grupo[data-area="vendas"]', { hasText: 'Caixa × painel' });
  await expect(aviso).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.ini-avisos')).toContainText('ainda contam nas vendas');
  await page.locator('.ini-avisos').getByText('Caixa × painel', { exact: false }).first().click();
  await expect(page.locator('.page-title')).toHaveText('Conferência');
  await expect(page.locator('.card', { hasText: 'Dia a dia' }).locator('.seg button.on')).toContainText('Não batem');
});
