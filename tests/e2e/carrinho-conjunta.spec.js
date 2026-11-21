const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Favorito "Carrinho Tea Shop": a janela "Venda Conjunta" do Sistema de Pedidos (mug + infusor) precisa ser reconhecida e aceita
// em "Colocar Todos no Carrinho", qualquer que seja o tipo do botão, dentro do quadro invisível em que o favorito trabalha.
// O teste roda as funções de verdade do favorito (tiradas do arquivo) em páginas de mentira; não abre o site da franquia.
const fonte = fs.readFileSync(path.join(__dirname, '../../public/js/carrinho-site.js'), 'utf8');
const trecho = fonte.slice(fonte.indexOf('  const RE_TODOS ='), fonte.indexOf('  const ajustar = (qtd, c) =>'));
const TABELA = '<table><tr><th>Código</th><th>Produto</th><th>Unidade</th><th>Quantidade</th><th>Preço Unitário</th></tr><tr><td>79161</td><td>Infusor Mug Royal Horse</td><td>Un</td><td>2,00</td><td>33,00</td></tr></table>';
const janela = (botao, estilo = 'display:block') => `<body><div id="modalVendaConjunta" class="modal fade in" style="${estilo}"><div class="modal-body"><h4>Venda Conjunta</h4>${TABELA}<button type="button">Não adicionar</button>${botao}</div></div></body>`;

async function rodar(page, html, acao) {
  await page.setContent('<body></body>');
  return page.evaluate(async ({ html, trecho, acao }) => {
    // o mesmo quadro invisível do favorito
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:-3000px;top:0;width:1300px;height:900px;border:0;visibility:hidden';
    document.body.append(fr);
    fr.srcdoc = html;
    await new Promise((r) => { fr.onload = r; });
    const d = fr.contentDocument;
    const num = (s) => { const m = /-?[\d.]*\d(?:,\d+)?/.exec(String(s || '')); return m ? +m[0].replace(/\./g, '').replace(',', '.') : null; };
    const f = new Function('num', `${trecho}; return { vendaConjunta, clicar, seguirLink, diagnostico };`)(num);
    const vc = f.vendaConjunta(d);
    if (vc && acao === 'clicar') f.clicar(vc.botao);
    if (vc && acao === 'link') f.seguirLink(vc.botao);
    await new Promise((r) => setTimeout(r, 50));
    return { achou: !!vc, tag: vc ? vc.botao.tagName : null, itens: vc ? vc.itens : null, aceito: d.defaultView.aceito || 0, diag: f.diagnostico(d) };
  }, { html, trecho, acao });
}

test('venda conjunta: reconhece e aceita o botão, seja link, botão, campo ou texto dentro de um bloco clicável', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'não depende do tamanho da tela');
  expect(trecho.length).toBeGreaterThan(500);
  const botoes = {
    A: '<a class="btn" href="javascript:void(window.aceito=(window.aceito||0)+1)">Colocar Todos no Carrinho</a>',
    BUTTON: '<button type="button" onclick="window.aceito=(window.aceito||0)+1"><span>Colocar Todos no Carrinho</span></button>',
    INPUT: '<input type="submit" value="Colocar Todos no Carrinho" onclick="window.aceito=(window.aceito||0)+1;return false">',
    DIV: '<div onclick="window.aceito=(window.aceito||0)+1"><span>  Colocar Todos no\n Carrinho </span></div>',
  };
  for (const [tag, botao] of Object.entries(botoes)) {
    const r = await rodar(page, janela(botao), 'clicar');
    expect(r.achou, tag).toBe(true);
    expect(r.tag, tag).toBe(tag);
    expect(r.aceito, `${tag}: um clique aceita`).toBe(1);
    expect(r.itens, tag).toEqual([{ cod: '79161', nome: 'Infusor Mug Royal Horse', qtd: 2, preco: 33 }]);
  }
  // segunda tentativa: segue o link do botão direto
  expect((await rodar(page, janela(botoes.A), 'link')).aceito).toBe(1);
});

test('venda conjunta: janela fechada não conta, outro botão não é confundido e o diagnóstico diz o que havia na página', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'não depende do tamanho da tela');
  const link = '<a href="javascript:void(window.aceito=1)">Colocar Todos no Carrinho</a>';
  const fechada = await rodar(page, janela(link, 'display:none'), 'clicar');
  expect(fechada.achou).toBe(false);
  expect(fechada.aceito).toBe(0);
  expect(fechada.diag).toContain('modalVendaConjunta=none');
  expect(fechada.diag).toContain('texto "Venda Conjunta": sim');
  const outra = await rodar(page, '<body><div class="modal" style="display:block"><a href="javascript:void(window.aceito=1)">Colocar no Carrinho</a><a href="#">Finalizar Pedido</a></div></body>', 'clicar');
  expect(outra.achou).toBe(false);
  expect(outra.aceito).toBe(0);
  expect(outra.diag).toContain('botão "Colocar Todos": não achei');
  const aberta = await rodar(page, janela(link), null);
  expect(aberta.diag).toContain('modalVendaConjunta=block');
  expect(aberta.diag).toContain('a');
});
