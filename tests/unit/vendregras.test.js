// Configurações → Metas e Comissão: as três listas de vendedores só aceitam vendedores da loja (pedido do dono, 23/11/2026).
const { test } = require('node:test');
const assert = require('node:assert');
const V = require('../../src/vendregras');

test('VEND-REGRAS-01: só vendedores da loja, nomes já salvos ou do modelo; sem dados da loja não dá para conferir', () => {
  const vend = [{ nome: 'ANA SOUZA' }, { nome: 'Bia Lima' }];
  const g = (semMeta, exclui = [], semComissao = []) => ({ semMeta, rateio: { ativo: false, exclui }, semComissao });
  assert.deepStrictEqual(V.invalidos(g(['ana souza'], ['bia lima']), vend, null), [], 'vendedores da loja, em qualquer caixa');
  assert.deepStrictEqual(V.invalidos(g(['zeca'], [], ['zeca', 'outro']), vend, null), ['zeca', 'outro'], 'texto livre de quem não vende na loja');
  assert.deepStrictEqual(V.invalidos(g(['velho vendedor']), vend, g(['Velho Vendedor'])), [], 'nome já salvo continua (vira "inativo" na tela)');
  assert.deepStrictEqual(V.invalidos(g(['corporativo', 'amanda oliveira']), vend, null), [], 'nomes que o modelo de regras já traz');
  assert.deepStrictEqual(V.invalidos(g(['qualquer']), [], null), [], 'sem a lista de vendedores (dados não carregados) não bloqueia');
  assert.ok(V.nomesDosModelos().has('corporativo'));
});
