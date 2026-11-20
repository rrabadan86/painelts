// Pedido: carrinho salvo por 5 dias (terminar depois) e venda conjunta do site (a mug vem com o infusor dela)
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carrinho-'));
process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
const P = require('../../src/pedido');
after(() => fs.rmSync(tmp, { recursive: true, force: true })); // dados temporários do teste: apaga

test('carrinho salvo: guarda as quantidades, vale 5 dias, um por loja; vazio ou inválido não salva', () => {
  assert.strictEqual(P.rascunho('l1'), null);
  assert.match(P.salvarRascunho('l1', { 100: 0, 200: 0 }, 'ana').erro, /vazio/);
  assert.match(P.salvarRascunho('l1', [1, 2], 'ana').erro, /inválido/);
  const r = P.salvarRascunho('l1', { 100: 3, 200: 0, 300: 1.5, '<script>': 9, 400: -1, 500: 'abc', 600: 1e9 }, 'ana');
  assert.deepStrictEqual(r.ok.itens, { 100: 3, 200: 0, 300: 1.5 }, 'só código e quantidade válidos; o zero (tirado à mão) também fica');
  assert.strictEqual(r.ok.por, 'ana'); assert.strictEqual(r.ok.dias, 5);
  assert.strictEqual(Math.round((Date.parse(r.ok.expira) - Date.parse(r.ok.em)) / 864e5), 5);
  assert.strictEqual(P.rascunho('l2'), null, 'a outra loja não vê');
  // outra pessoa salva por cima: fica o último
  P.salvarRascunho('l1', { 100: 7 }, 'bia');
  assert.deepStrictEqual([P.rascunho('l1').itens, P.rascunho('l1').por], [{ 100: 7 }, 'bia']);
  // vale até o 5º dia; depois é como se não existisse
  const em = Date.parse(P.rascunho('l1').em);
  assert.ok(P.rascunho('l1', em + 5 * 864e5 - 1000));
  assert.strictEqual(P.rascunho('l1', em + 5 * 864e5 + 1000), null);
  // descartar
  P.apagarRascunho('l1');
  assert.strictEqual(P.rascunho('l1'), null);
  assert.deepStrictEqual(P.apagarRascunho('l1'), { ok: true }, 'descartar duas vezes não dá erro');
});

test('venda conjunta: o que o site exigiu colocar junto (infusor da mug) fica no resultado e na memória da loja, sem nada além de código, nome, quantidade e preço', () => {
  const { codigo } = P.criarCodigo('l1', [{ cod: '70100', nome: 'Mug Harmony Royal Horse', qtd: 4 }, { cod: '70200', nome: 'Infusor Avulso', qtd: 1 }], 'ana');
  const r = P.progresso(codigo, { fim: true, itens: [
    { cod: '70100', nome: 'Mug Harmony Royal Horse', pedido: 4, qtd: 4, preco: 99, status: 'ok',
      junto: [{ cod: '79161', nome: 'Infusor Mug Royal Horse', qtd: 4, preco: 33, extra: '<b>x</b>', senha: 'nao' }, { cod: '1', nome: '' }] },
    { cod: '70200', nome: 'Infusor Avulso', pedido: 1, qtd: 1, preco: 30, status: 'ok' },
    { cod: '99999', nome: 'Fora da lista', status: 'ok', junto: [{ cod: '1', nome: 'x' }] },
  ] });
  assert.strictEqual(r.ok, true);
  const c = P.carrinho('l1');
  assert.deepStrictEqual(c.itens.map((i) => i.cod), ['70100', '70200'], 'só o que estava na lista');
  assert.deepStrictEqual(c.itens[0].junto, [{ cod: '79161', nome: 'Infusor Mug Royal Horse', qtd: 4, preco: 33 }]);
  assert.strictEqual(c.itens[1].junto, undefined);
  // a loja passa a saber o par mug → infusor (1 infusor por mug)
  assert.deepStrictEqual(P.conjuntos('l1')['70100'].junto, [{ cod: '79161', nome: 'Infusor Mug Royal Horse', porUnidade: 1, preco: 33 }]);
  assert.strictEqual(P.conjuntos('l1')['70200'], undefined);
});

test('o favorito e o robô aceitam a venda conjunta em "Colocar Todos no Carrinho" e nunca finalizam o pedido', () => {
  const raiz = path.join(__dirname, '../..');
  const fav = fs.readFileSync(path.join(raiz, 'public/js/carrinho-site.js'), 'utf8'), robo = fs.readFileSync(path.join(raiz, 'coletor/nextsoft_pedido.py'), 'utf8');
  assert.match(fav, /function vendaConjunta\(d\)/);
  assert.match(fav, /colocar\\s\+todos\\s\+no\\s\+carrinho/);
  assert.match(fav, /const vc = junto \? null : vendaConjunta\(doc\(\)\)/, 'uma vez por produto');
  assert.match(robo, /def venda_conjunta\(page\)/);
  assert.match(robo, /junto = venda_conjunta\(page\)/);
  // nenhum dos dois clica em finalizar/fechar pedido
  for (const [nome, t] of [['favorito', fav], ['robô', robo]]) assert.ok(!/(click|clicar)[^\n]{0,80}(finalizar|fechar pedido|concluir pedido)/i.test(t), nome);
});
