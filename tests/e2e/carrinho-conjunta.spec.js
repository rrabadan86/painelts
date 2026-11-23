const { test, expect } = require('./_base');
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

// Aviso de estoque (loja real, 22/11/2026): "Atenção — O produto Happy Pumpkin não possui estoque suficiente." numa janela que não é o
// .modal de sempre e que às vezes chega atrasada, já durante o produto seguinte. O favorito (avisoDoSite + donoDoAviso) e o robô
// (AVISO_JS em nextsoft_pedido.py, a mesma regra) precisam achar, fechar e marcar "fora de estoque" o produto CERTO.
const py = fs.readFileSync(path.join(__dirname, '../../coletor/nextsoft_pedido.py'), 'utf8');
const AVISO_PY = (() => { const i = py.indexOf('AVISO_JS = """') + 'AVISO_JS = """'.length; return py.slice(i, py.indexOf('"""', i)).replace(/\\\\/g, '\\'); })();
const ATENCAO = (atraso, nome = 'Happy Pumpkin') => `<body><div id="ModalDeErro" class="modal" style="display:none"><div class="modal-body">x</div></div>
  <div id="lista"><div class="card">Calm Moment<br>Pedido Mínimo: Livre<br><button>Colocar no Carrinho</button></div></div>
  <script>setTimeout(() => { const j = document.createElement('div'); j.id = 'atencao'; j.style.cssText = 'position:fixed;top:30px;left:30%;width:480px;background:#fff';
    j.innerHTML = '<div class="tit">Atenção</div><div class="txt">O produto ${nome} não possui estoque suficiente.</div><div><span class="btn" onclick="document.getElementById(\\'atencao\\').remove()">Fechar</span></div>';
    document.body.append(j); }, ${atraso});</script></body>`;

async function avisos(page, html, esperaMs) {
  await page.setContent('<body></body>');
  return page.evaluate(async ({ html, trecho, esperaMs, AVISO_PY }) => {
    const quadro = async () => {
      const fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;left:-3000px;top:0;width:1300px;height:900px;border:0;visibility:hidden';
      document.body.append(fr);
      fr.srcdoc = html;
      await new Promise((r) => { fr.onload = r; });
      return fr;
    };
    const num = (s) => { const m = /-?[\d.]*\d(?:,\d+)?/.exec(String(s || '')); return m ? +m[0].replace(/\./g, '').replace(',', '.') : null; };
    const esq = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const f = new Function('num', 'esq', `${trecho}; return { avisoDoSite, donoDoAviso };`)(num, esq);
    // favorito
    const fr = await quadro(), d = fr.contentDocument;
    const antes = f.avisoDoSite(d); // o aviso ainda não chegou
    await new Promise((r) => setTimeout(r, esperaMs));
    const fav = f.avisoDoSite(d);
    const fechou = !d.getElementById('atencao');
    const deNovo = f.avisoDoSite(d);
    // robô: o mesmo JS rodando dentro da página (é o que o page.evaluate do Playwright faz)
    const fr2 = await quadro();
    await new Promise((r) => setTimeout(r, esperaMs));
    const rob = fr2.contentWindow.eval(`(${AVISO_PY})`)();
    return { antes, fav, fechou, deNovo, rob, roboFechou: !fr2.contentDocument.getElementById('atencao'),
      dono: [f.donoDoAviso(fav, 'Top E Tea 1Un', ['Calm Moment', 'Happy Pumpkin']), f.donoDoAviso(fav, 'Happy Pumpkin', ['Calm Moment']),
        f.donoDoAviso('Não foi possível adicionar.', 'Top E Tea 1Un', ['Happy Pumpkin']), f.donoDoAviso(fav, null, ['Calm Moment', 'Happy Pumpkin'])] };
  }, { html, trecho, esperaMs, AVISO_PY });
}

test('aviso de estoque atrasado fora do .modal: o favorito e o robô acham, fecham e o aviso vai para o produto certo', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'não depende do tamanho da tela');
  const r = await avisos(page, ATENCAO(300), 600);
  expect(r.antes, 'antes de o aviso chegar não há aviso').toBeNull();
  expect(r.fav).toBe('O produto Happy Pumpkin não possui estoque suficiente.');
  expect(r.fechou, 'fecha pelo "Fechar"').toBe(true);
  expect(r.deNovo, 'fechado não conta de novo').toBeNull();
  expect(r.rob, 'o robô acha o mesmo aviso').toBe('O produto Happy Pumpkin não possui estoque suficiente.');
  expect(r.roboFechou).toBe(true);
  // aviso do produto A (Happy Pumpkin) chegando durante o produto B (Top E Tea): é de A, nunca de B
  expect(r.dono).toEqual(['Happy Pumpkin', 'Happy Pumpkin', 'Top E Tea 1Un', 'Happy Pumpkin']);
});

test('aviso de estoque: bloco sem botão de fechar não esconde a página e não conta duas vezes; janela de venda conjunta não é aviso', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'não depende do tamanho da tela');
  const r = await avisos(page, '<body><main id="pagina"><section>Catálogo<p id="av">O produto Calm Moment não possui estoque suficiente.</p></section></main></body>', 0);
  expect(r.antes).toBe('O produto Calm Moment não possui estoque suficiente.');
  expect(r.fav, 'o mesmo bloco não volta a contar no produto seguinte').toBeNull();
  const conj = await avisos(page, janela('<a href="#">Colocar Todos no Carrinho</a>'), 0);
  expect(conj.antes).toBeNull();
});
