// Logs do FIXE: cada tipo de movimento do "Histórico"
const { test } = require('node:test');
const assert = require('node:assert');
const FI = require('../../src/fidelidade');

const CAB = ['Nome', 'Data Cadastro', 'Email', 'CPF', 'Loja', 'RESGATE', 'DATA TRANSAÇÃO', 'Histórico'];
const linha = (hist, cpf = '123.456.789-09') => ['Ana', '10/03/2025', '', cpf, 'GOIANIA - TEA SHOP FLAMBOYANT.', '', '', hist];

test('reconhece compra antiga, pontos, resgate, expiração, cancelamento e boas-vindas', () => {
  const ev = FI.ler([CAB,
    linha('02/07/2025 00:00:00 - Compra feita em 09/09/2023Produto: Earl Grey 100G\n'),
    linha('15/09/2025 15:19:58 - Adicionado 6 pontos\nProduto: X 250G\nProduto: Y 50G\n'),
    linha('13/07/2026 20:15:02 - Resgate de 10 pontos\nProduto: Medida Inox\n'),
    linha('15/09/2026 20:20:20 - 6 pontos removidos(expirados).\n'),
    linha('19/08/2025 12:18:32 Operação cancelada via PDV.Produto: Z\n'),
    linha('22/09/2025 21:59:49 - Bem vindo(a), você ganhou 1 ponto.\n'),
  ]);
  const t = Object.fromEntries(ev.map((e) => [e.tipo, e]));
  assert.deepStrictEqual(Object.keys(t).sort(), ['boasvindas', 'cancelado', 'compra', 'expirou', 'pontos', 'resgate']);
  assert.strictEqual(t.pontos.pontos, 6);
  assert.strictEqual(t.pontos.data, '2025-09-15');
  assert.deepStrictEqual(t.pontos.produtos, ['X 250G', 'Y 50G']);
  assert.strictEqual(t.resgate.pontos, 10);
  assert.strictEqual(t.expirou.pontos, 6);
  assert.strictEqual(t.pontos.cpf, '12345678909');
  assert.strictEqual(t.pontos.loja, 'GOIANIA - TEA SHOP FLAMBOYANT');
});

test('o mesmo movimento em duas linhas conta uma vez', () => {
  const h = '15/09/2025 15:19:58 - Adicionado 6 pontos\nProduto: X 250G\n';
  const ev = FI.ler([CAB, linha(h), linha(h)]);
  assert.strictEqual(ev.length, 1);
});

test('planilha sem a coluna Histórico é recusada', () => {
  assert.throws(() => FI.ler([['Nome', 'CPF'], ['Ana', '12345678909']]), /Histórico/);
});
