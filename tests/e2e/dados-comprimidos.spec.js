// Dados da apresentação: saem já comprimidos (brotli ou gzip) e iguais ao original; sem compressão para quem não aceita
const { test, expect } = require('@playwright/test');

test('dados da apresentação: brotli, gzip e sem compressão trazem o mesmo conteúdo', async ({ request }) => {
  const pedir = async (aceita) => {
    const r = await request.get('/api/demo/dados?loja=todas', { headers: { 'Accept-Encoding': aceita } });
    expect(r.status()).toBe(200);
    return { enc: r.headers()['content-encoding'] || '', tipo: r.headers()['content-type'] || '', corpo: await r.text() };
  };
  const puro = await pedir('identity');
  expect(puro.enc).toBe('');
  expect(puro.corpo.length).toBeGreaterThan(1000);
  expect(() => JSON.parse(puro.corpo)).not.toThrow();
  for (const [aceita, esperado] of [['br', 'br'], ['gzip', 'gzip'], ['gzip, deflate, br', 'br']]) {
    // duas vezes: a primeira comprime, a segunda sai da memória
    for (let k = 0; k < 2; k++) {
      const c = await pedir(aceita);
      expect(c.enc).toBe(esperado);
      expect(c.tipo).toContain('application/json');
      expect(c.corpo === puro.corpo).toBe(true);
    }
  }
  // outra loja não recebe o corpo da rede inteira
  const a = await request.get('/api/demo/dados?loja=demo-centro', { headers: { 'Accept-Encoding': 'br' } });
  const b = await request.get('/api/demo/dados?loja=demo-centro', { headers: { 'Accept-Encoding': 'identity' } });
  expect(a.headers()['content-encoding']).toBe('br');
  expect((await a.text()) === (await b.text())).toBe(true);
  expect((await a.text()) === puro.corpo).toBe(false);
  // o painel guarda os dados no aparelho e confere pelo ETag: nada mudou = 304, sem mandar tudo de novo
  const etag = a.headers().etag;
  expect(etag).toBeTruthy();
  const igual = await request.get('/api/demo/dados?loja=demo-centro', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': etag } });
  expect(igual.status()).toBe(304);
});
