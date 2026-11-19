'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const BR = require('../../src/brasilapi');

test('BrasilAPI: CNPJ válido (numérico e alfanumérico de 2026) e inválido', () => {
  assert.ok(BR.cnpjValido('11.222.333/0001-81'));
  assert.ok(BR.cnpjValido('12.ABC.345/01DE-35'), 'exemplo oficial do CNPJ alfanumérico');
  assert.ok(BR.cnpjValido('12abc34501de35'), 'minúsculas viram maiúsculas');
  assert.ok(!BR.cnpjValido('11.222.333/0001-82'));
  assert.ok(!BR.cnpjValido('00000000000000'));
  assert.ok(!BR.cnpjValido('123'));
});

test('BrasilAPI: lê CNPJ e CEP só com o que o painel usa', () => {
  const e = BR.deCnpj({
    cnpj: '11222333000181', razao_social: 'EMPRESA TESTE LTDA', nome_fantasia: 'Teste', descricao_situacao_cadastral: 'ATIVA',
    cep: '01310-100', descricao_tipo_de_logradouro: 'AVENIDA', logradouro: 'PAULISTA', numero: '1000', complemento: 'LOJA 2',
    bairro: 'BELA VISTA', municipio: 'SAO PAULO', uf: 'sp', ddd_telefone_1: '1130000000', email: 'Contato@Teste.com.br', qsa: [{ nome_socio: 'FULANO' }],
  });
  assert.equal(e.razaoSocial, 'EMPRESA TESTE LTDA');
  assert.equal(e.ativa, true);
  assert.equal(e.cep, '01310100');
  assert.equal(e.rua, 'AVENIDA PAULISTA');
  assert.equal(e.uf, 'SP');
  assert.equal(e.telefone, '1130000000');
  assert.equal(e.email, 'contato@teste.com.br');
  assert.ok(!('qsa' in e), 'sócios não vêm para o painel');
  assert.equal(BR.deCnpj({ descricao_situacao_cadastral: 'BAIXADA' }).ativa, false);
  assert.deepEqual(BR.deCep({ cep: '01001000', state: 'SP', city: 'São Paulo', neighborhood: 'Sé', street: 'Praça da Sé' }),
    { cep: '01001000', rua: 'Praça da Sé', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' });
});

test('BrasilAPI: consulta com cache, não encontrado e serviço fora do ar', async () => {
  const antes = global.fetch;
  const pedidos = [];
  let resposta = { status: 200, body: { cnpj: '11222333000181', razao_social: 'X LTDA', descricao_situacao_cadastral: 'ATIVA' } };
  global.fetch = async (url) => { pedidos.push(url); return { ok: resposta.status < 300, status: resposta.status, json: async () => resposta.body }; };
  try {
    BR._cache.clear();
    const a = await BR.cnpj('11.222.333/0001-81');
    assert.equal(a.razaoSocial, 'X LTDA');
    assert.match(pedidos[0], /\/cnpj\/v1\/11222333000181$/);
    await BR.cnpj('11222333000181');
    assert.equal(pedidos.length, 1, 'a segunda consulta vem do cache');
    await assert.rejects(BR.cnpj('11222333000182'), /inválido/);
    assert.equal(pedidos.length, 1, 'CNPJ inválido nem sai do servidor');
    resposta = { status: 404, body: { message: 'not found' } };
    assert.equal(await BR.cep('99999-999'), null);
    resposta = { status: 500, body: {} };
    await assert.rejects(BR.cep('01001000'), (e) => e.status === 502);
    await assert.rejects(BR.cep('123'), /8 números/);
  } finally { global.fetch = antes; BR._cache.clear(); }
});
