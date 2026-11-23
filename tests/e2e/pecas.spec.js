// Peças do redesenho (decisão do dono, 22/11/2026: o visual limpo do protótipo do Início vale para o painel todo).
// Monta as peças compartilhadas (components.js) numa página da apresentação e confere: sem rolagem para o lado,
// etiquetas com contraste ≥ 4,5:1, botões com 44 px no celular, teclado e kpi sem barra lateral.
const { test, expect } = require('./_base');

const montar = (page) => page.evaluate(() => {
  const ir = (x) => { location.hash = x; };
  const box = document.createElement('div');
  box.id = 'pecas-teste';
  box.append(
    TS.heroi([
      { rot: 'Meta de novembro', num: '68%', sub: 'R$ 15.906 de R$ 23.456', barra: { pct: 68, esperado: 73, rotulo: '68% da meta; esperado 73%' }, dica: 'A meta do mês e quanto já foi vendido.' },
      { rot: 'Para bater a meta', num: 'R$ 1.082', sub: 'por dia', linhas: ['nos 7 dias de loja aberta que faltam'] },
      { rot: 'Esta semana', num: 'R$ 5.512', estado: 'ruim', linhas: ['−24,7% contra a semana passada'] },
    ], { titulo: 'Como está o mês' }),
    TS.duasColunas([
      TS.cardSec('O que fazer agora', { sub: 'em ordem de dinheiro em jogo' }, TS.acoesNum([
        { titulo: 'Repor 12 produtos zerados', texto: 'Perdendo R$ 238 por dia', acao: { rotulo: 'Ver no pedido', onclick: () => { window.__clicou = 'pedido'; } } },
        { titulo: 'Tirar 6 lotes vencidos', texto: 'R$ 159 a custo', acao: { rotulo: 'Ver os lotes', href: '#validade' } },
        { titulo: '18 clientes sumindo', acao: { rotulo: 'Abrir o Hoje', href: '#hoje' } },
      ])),
      TS.cardSec('Também pede atenção', { link: { rotulo: 'Ver todos os 16 avisos ›', onclick: () => { window.__clicou = 'todos'; } } },
        TS.etqPrazo('agora'), ' ', TS.etqPrazo('semana'), ' ', TS.etqPrazo('saber'), ' ', TS.etqPrazo('ok')),
    ], [
      TS.cardSec('Estoque em números', {}, TS.linhasNum([
        { rot: 'Zerados que vendem', num: '12', estado: 'ruim', onclick: () => { window.__clicou = 'zerados'; } },
        { rot: 'Lotes vencendo', num: '8', estado: 'atencao', href: '#validade' },
        { rot: 'Margem da semana', num: '44%' },
      ])),
      TS.pilulaSit('ok', 'Vendas atualizadas hoje às 14:32'),
      TS.kpi('Teste', 'R$ 10', TS.h('span', { class: 'down' }, '−5%')),
    ]),
  );
  void ir;
  const main = document.querySelector('main') || document.body;
  main.replaceChildren(box);
});

const contraste = (page, sel) => page.$$eval(sel, (els) => els.map((el) => {
  const rgb = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const s = getComputedStyle(el), a = lum(s.color), b = lum(s.backgroundColor);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}));

test('PECAS-01: herói, ações, etiquetas, linhas e duas colunas — sem rolagem, contraste, toque e teclado', async ({ page }, info) => {
  const celular = info.project.name === 'celular';
  await page.goto('/apresentacao');
  await page.waitForFunction(() => window.TS && TS.heroi && TS.db);
  await montar(page);
  const box = page.locator('#pecas-teste');
  await expect(box.locator('.heroi-col')).toHaveCount(3);
  // a marca do esperado fica onde deve (73%) e o número ruim fica vermelho
  expect(await box.locator('.heroi-barra-marca').evaluate((el) => el.style.left)).toBe('73%');
  await expect(box.locator('.heroi-num.neg')).toHaveText(/R\$ 5\.512/);
  // sem rolagem para o lado
  const lado = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(lado).toBeLessThanOrEqual(1);
  // etiquetas de prazo: contraste ≥ 4,5:1
  for (const c of await contraste(page, '#pecas-teste .etq-prazo')) expect(c).toBeGreaterThanOrEqual(4.5);
  await expect(box.locator('.etq-prazo')).toHaveText(['Agora', 'Esta semana', 'Para saber', 'Ok']);
  // ações: a 1ª é a principal; botões com 44 px de altura (no celular a principal ocupa a largura toda)
  const btns = box.locator('.acao-btn');
  await expect(btns.first()).toHaveClass(/primary/);
  for (const b of await btns.all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(celular ? 44 : 40);
  if (celular) {
    const [bb, li] = [await btns.first().boundingBox(), await box.locator('.acao').first().boundingBox()];
    expect(bb.width).toBeGreaterThan(li.width * 0.8);
  }
  // linhas de número: altura de toque e teclado (Enter e Espaço nos botões de verdade)
  for (const a of await box.locator('.linhas-num-a').all()) expect((await a.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await box.locator('button.linhas-num-a').focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__clicou)).toBe('zerados');
  await page.evaluate(() => { window.__clicou = null; });
  await box.locator('.acao-btn').first().focus();
  await page.keyboard.press(' ');
  expect(await page.evaluate(() => window.__clicou)).toBe('pedido');
  // kpi sem barra lateral; cartão sem sombra
  const kpi = box.locator('.kpi');
  await expect(kpi).toHaveClass(/kpi-ruim/);
  expect(await kpi.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
  expect(await box.locator('.card').first().evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
  // duas colunas: no computador lado a lado; no celular a lateral vem depois
  const [pri, lat] = [await box.locator('.tela-2col-pri').boundingBox(), await box.locator('.tela-2col-lat').boundingBox()];
  if (celular) expect(lat.y).toBeGreaterThan(pri.y + pri.height - 1);
  else expect(lat.x).toBeGreaterThan(pri.x + pri.width - 1);
});
