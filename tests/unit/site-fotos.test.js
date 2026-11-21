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
