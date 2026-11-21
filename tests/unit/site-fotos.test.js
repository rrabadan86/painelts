// Fotos dos produtos do site: só endereço https dos servidores conhecidos; a foto da variante vem primeiro
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sitefoto-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [], usuarios: {} }));
const S = require('../../src/site');

const CDN = 'https://cdn.shopify.com/s/files/1/0001/files/';
test('FOTO-01: só aceita foto https dos servidores conhecidos (nunca outro endereço, http, porta, usuário ou texto enorme)', () => {
  assert.ok(S.fotoOk(CDN + 'mug.jpg?v=1'));
  assert.ok(S.fotoOk('https://www.teashop.com.br/cdn/shop/files/mug.jpg'));
  for (const ruim of ['http://cdn.shopify.com/a.jpg', 'https://cdn.shopify.com.evil.com/a.jpg', 'https://evil.com/cdn.shopify.com/a.jpg', 'https://u:p@cdn.shopify.com/a.jpg',
    'https://cdn.shopify.com:8443/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//cdn.shopify.com/a.jpg', '', null, 42, CDN + 'a'.repeat(500)]) assert.strictEqual(S.fotoOk(ruim), false, String(ruim).slice(0, 60));
});

test('FOTO-02: cada variante leva a foto dela primeiro e depois as do produto (sem repetir, no máximo 4); endereço estranho fica de fora', () => {
  const itens = S.itensDe([{
    title: 'Mug Harmony', handle: 'mug-harmony', product_type: 'Mugs',
    images: [{ src: CDN + 'a.jpg' }, { src: CDN + 'b.jpg' }, { src: 'https://evil.com/x.jpg' }, { src: CDN + 'c.jpg' }, { src: CDN + 'd.jpg' }, { src: CDN + 'e.jpg' }],
    variants: [
      { id: 1, title: 'Rosae', sku: '20715', price: '99.90', featured_image: { src: CDN + 'b.jpg' } },
      { id: 2, title: 'Azure', sku: '20716', price: '99.90', featured_image: { src: 'http://cdn.shopify.com/inseguro.jpg' } },
      { id: 3, title: 'Sem preço', sku: '1', price: 'a combinar' },
    ],
  }, { title: 'Sem foto', handle: 'sem-foto', variants: [{ id: 9, title: 'Default Title', sku: '30000', price: '10' }] }]);
  assert.strictEqual(itens.length, 3);
  assert.deepStrictEqual(itens[0].imgs, [CDN + 'b.jpg', CDN + 'a.jpg', CDN + 'c.jpg', CDN + 'd.jpg']);
  assert.deepStrictEqual(itens[1].imgs, [CDN + 'a.jpg', CDN + 'b.jpg', CDN + 'c.jpg', CDN + 'd.jpg'], 'foto insegura da variante é ignorada');
  assert.ok(!('imgs' in itens[2]), 'produto sem foto não ganha o campo');
  assert.match(itens[0].url, /^https:\/\/www\.teashop\.com\.br\/products\/mug-harmony\?variant=1$/);
});

test('FOTO-03: a lista para as telas só traz quem tem foto, sem preço; refaz quando o arquivo muda e filtra de novo o endereço', () => {
  assert.deepStrictEqual(S.fotos(), { em: null, itens: [] }, 'sem consulta ainda');
  const arq = path.join(tmp, 'site', 'precos.json');
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify({ em: '2026-11-20T13:00:00.000Z', itens: [
    { id: '1', produto: 'Mug Harmony', variante: 'Rosae', sku: '20715', preco: 99.9, url: 'https://www.teashop.com.br/products/mug-harmony?variant=1', imgs: [CDN + 'b.jpg', 'https://evil.com/x.jpg'] },
    { id: '9', produto: 'Sem foto', variante: '', sku: '30000', preco: 10, url: 'https://www.teashop.com.br/products/sem-foto?variant=9' },
    { id: '8', produto: 'Só foto ruim', variante: '', sku: '30001', preco: 10, url: '#', imgs: ['https://evil.com/x.jpg'] },
  ] }));
  const f = S.fotos();
  assert.strictEqual(f.em, '2026-11-20T13:00:00.000Z');
  assert.deepStrictEqual(f.itens, [{ s: '20715', n: 'Mug Harmony', v: 'Rosae', u: 'https://www.teashop.com.br/products/mug-harmony?variant=1', i: [CDN + 'b.jpg'] }]);
  assert.ok(!JSON.stringify(f).includes('99.9'), 'sem preço');
});

test('FOTO-04: a tela liga a foto ao produto pelo código (sem zeros; com ou sem a letra que o site põe no fim) e pelo nome sem o " - Tea Shop"', () => {
  const F = require('../../public/js/fotoprod');
  const idx = F.montar([
    { s: '66367', n: 'Travel Tea Bambo Mystic Feathers', v: '', u: 'u1', i: [CDN + 'a.jpg'] },
    { s: '65404C', n: 'Caneca de Porcelana Mug Harmony Samurai - Tea Shop', v: '', u: 'u2', i: [CDN + 'b.jpg'] },
    { s: '065500', n: 'Infusor Color Filter Azul - Tea Shop', v: '', u: 'u3', i: [CDN + 'c.jpg'] },
    { s: '70001A', n: 'Lata A', v: '', u: 'u4', i: [CDN + 'd.jpg'] }, { s: '70001', n: 'Lata Sem Letra', v: '', u: 'u5', i: [CDN + 'e.jpg'] },
    { s: '', n: 'Kit Sem Código - Tea Shop', v: '', u: 'u6', i: [CDN + 'f.jpg'] },
    { s: '99999', n: 'Sem foto', v: '', u: 'u7', i: [] },
  ]);
  const de = (cod, nome) => idx.porCod.get(F.semZeros(cod)) || idx.porNome.get(F.norm(F.nomeSite(nome))) || null;
  assert.strictEqual(de('66367', 'qualquer').url, 'u1');
  assert.strictEqual(de('65404', 'Mug Harmony Samurai').url, 'u2', 'código do site com letra no fim');
  assert.strictEqual(de('65404C', 'x').url, 'u2');
  assert.strictEqual(de('65500', 'x').url, 'u3', 'zeros à esquerda não contam');
  assert.strictEqual(de('70001', 'x').url, 'u5', 'o código sem letra de outro produto não é trocado');
  assert.strictEqual(de('123', 'kit sem codigo').url, 'u6', 'pelo nome, sem acento e sem o " - Tea Shop"');
  assert.strictEqual(idx.porCod.get('65404').nome, 'Caneca de Porcelana Mug Harmony Samurai');
  assert.strictEqual(de('99999', 'Sem foto'), null);
  assert.strictEqual(F.montar([]).n, 0, 'lista vazia é reconhecida (a tela tenta de novo em seguida)');
});
