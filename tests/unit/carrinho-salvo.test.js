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
  assert.match(fav, /const vc = aceitou < 2 \? vendaConjunta\(doc\(\)\) : null/, 'no máximo duas tentativas por produto');
  assert.match(fav, /function diagnostico\(d\)/, 'quando o site não confirma, diz o que havia na página');
  assert.match(robo, /def venda_conjunta\(page\)/);
  assert.match(robo, /junto = venda_conjunta\(page\)/);
  // nenhum dos dois clica em finalizar/fechar pedido
  for (const [nome, t] of [['favorito', fav], ['robô', robo]]) assert.ok(!/(click|clicar)[^\n]{0,80}(finalizar|fechar pedido|concluir pedido)/i.test(t), nome);
});

test('robô: aviso de estoque atrasado vai para o produto citado (nunca o seguinte) e vira "sem_estoque"', (t) => {
  const { spawnSync } = require('child_process');
  if (spawnSync('python3', ['--version']).status !== 0) { t.skip('sem python3'); return; }
  const raiz = path.join(__dirname, '../..');
  // o robô importa o Playwright no topo: aqui um módulo de mentira (só as funções puras são testadas)
  const prog = `
import sys, types, json
pw = types.ModuleType('playwright'); api = types.ModuleType('playwright.sync_api'); api.sync_playwright = None
sys.modules['playwright'] = pw; sys.modules['playwright.sync_api'] = api
sys.path.insert(0, ${JSON.stringify(path.join(raiz, 'coletor'))})
import nextsoft_pedido as N
av = 'O produto Happy Pumpkin não possui estoque suficiente.'
print(json.dumps([
  N.dono_do_aviso(av, 'Top E Tea 1Un', ['Calm Moment', 'Happy Pumpkin']),
  N.dono_do_aviso(av, 'Happy Pumpkin', ['Calm Moment']),
  N.dono_do_aviso('Não foi possível adicionar.', 'Top E Tea 1Un', ['Happy Pumpkin']),
  N.dono_do_aviso(av, None, ['Calm Moment', 'Happy Pumpkin']),
  N.status_do_aviso(av), N.status_do_aviso('Quantidade acima do permitido'),
]))`;
  const r = spawnSync('python3', ['-c', prog], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()), ['Happy Pumpkin', 'Happy Pumpkin', 'Top E Tea 1Un', 'Happy Pumpkin', 'sem_estoque', 'recusado']);
});

test('carrinho montado: confirmar marca quem e quando; excluir apaga o registro, invalida o código do favorito e devolve as sugestões da equipe', () => {
  const S = require('../../src/sugestoes');
  assert.match(P.confirmarCarrinho('l9', 'ana').erro, /Não há carrinho/);
  assert.match(P.excluirCarrinho('l9').erro, /Não há carrinho/);
  const { codigo } = P.criarCodigo('l9', [{ cod: '500', nome: 'Chá X', qtd: 2 }, { cod: '600', nome: 'Chá Y', qtd: 1 }], 'ana');
  assert.match(P.confirmarCarrinho('l9', 'ana').erro, /ainda está sendo montado/);
  P.progresso(codigo, { fim: true, itens: [{ cod: '500', nome: 'Chá X', pedido: 2, qtd: 2, preco: 10, status: 'ok' }, { cod: '600', nome: 'Chá Y', pedido: 1, status: 'sem_confirmacao' }] });
  assert.strictEqual(P.carrinho('l9').confirmado, undefined, 'montar não é confirmar');
  // confirmar
  const c = P.confirmarCarrinho('l9', 'bia').ok;
  assert.strictEqual(c.confirmado.por, 'bia'); assert.ok(Date.parse(c.confirmado.em));
  assert.strictEqual(P.carrinho('l9').confirmado.por, 'bia');
  // sugestões da equipe que foram para "aguardando entrega" neste carrinho e uma antiga, de outro pedido
  const ini = P.carrinho('l9').inicio, arq = path.join(tmp, 'l9', 'sugestoes.json');
  const sug = (id, cod, em) => ({ id, cod, desc: 'Chá ' + cod, st: 'aberta', por: 'vend', em: '2026-11-01T10:00:00.000Z', hist: [{ em, res: 'pedido', motivo: '', por: 'ana' }], aguardando: { em, por: 'ana', qtd: 1 } });
  const dSug = S.ler('l9');
  dSug.itens = [sug('a1', '500', new Date(Date.parse(ini) + 5000).toISOString()), sug('a2', '700', '2026-10-01T10:00:00.000Z')];
  fs.mkdirSync(path.dirname(arq), { recursive: true }); fs.writeFileSync(arq, JSON.stringify(dSug));
  // excluir: some o registro, o código do favorito deixa de valer e só a sugestão deste carrinho volta
  const x = P.excluirCarrinho('l9').ok;
  assert.deepStrictEqual([x.produtos, x.confirmado, x.por], [1, true, 'ana']);
  assert.strictEqual(P.carrinho('l9'), null);
  assert.match(P.progresso(codigo, { itens: [] }).erro, /Código vencido/);
  assert.deepStrictEqual(S.desfazerPedido('l9', x.inicio, 'bia'), { ok: 1 });
  const depois = S.ler('l9').itens;
  assert.strictEqual(depois.find((i) => i.id === 'a1').aguardando, undefined);
  assert.match(depois.find((i) => i.id === 'a1').hist.slice(-1)[0].motivo, /carrinho foi excluído/);
  assert.ok(depois.find((i) => i.id === 'a2').aguardando, 'a de outro pedido continua aguardando entrega');
  assert.deepStrictEqual(S.desfazerPedido('l9', x.inicio, 'bia'), { ok: 0 }, 'não repete');
});

