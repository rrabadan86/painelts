'use strict';
/**
 * Tipo do produto para a validade e para a unidade — a definição única (servidor; a tela recebe pronto no estoque e nos lotes).
 *  - 'granel'   chá a granel: item em kg do AppNext que não é envasado. Tem lote, validade, abertura (6 meses) e trava de 100 g.
 *  - 'envasado' chá envasado (pacote fechado, lata, minitin, sachê, kit…): vendido sempre em pacote fechado. Tem lote e validade
 *               (sem abertura) e é contado em UNIDADE, mesmo quando o AppNext o cadastra em "Kg" (decisão do dono: "9,000 kg" = 9 pacotes).
 *  - 'alimento' alimentação (geleia, bubble tea, kombucha, mel…): lote e validade, sem abertura, na unidade do AppNext.
 *  - null       o resto (acessório, insumo, embalagem…): sem lote.
 * Como decide: pelo grupo do produto no AppNext (o mesmo com que ele sai nas vendas; no servidor vem da nota de entrada e do
 * cadastro de preços) e, quando o grupo não vem, pelo nome — só para o item em kg (lata, minitin, sachê, caixa, kit ou com o
 * tamanho "30G" no nome não é chá a granel). Conta pura (tests/unit/tipoprod.test.js).
 */
const ENVASADO_NOME = /\b(LATA|MINITIN|MINI TIN|SACH[EÊ]S?|CAIXA|KIT)(?![A-Z0-9])|\b\d+\s*G\b/i;
// grupos do AppNext dos chás envasados (TEA MOMENTS e FOREST FRIENDLY TEAS entram como CHÁS ENVASADOS nas vendas) e da alimentação
const GRUPO_ENVASADO = /ENVASAD|TEA\s*MOMENTS?|FOREST\s*FRIENDLY/i;
const GRUPO_ALIMENTO = /ALIMENTA/i;
const ehKg = (un) => /^kg$/i.test(String(un || '').trim());

/** { un, desc, grupo } → 'granel' | 'envasado' | 'alimento' | null */
function tipo({ un, desc, grupo } = {}) {
  const g = String(grupo || '');
  if (GRUPO_ALIMENTO.test(g)) return 'alimento';
  if (GRUPO_ENVASADO.test(g)) return 'envasado';
  if (ehKg(un)) return ENVASADO_NOME.test(String(desc || '')) ? 'envasado' : 'granel';
  return null;
}
/** tipo de um item do estoque já normalizado (usa o que veio marcado; item cru é classificado na hora) */
const de = (it) => (it ? (it.tipoProd !== undefined ? it.tipoProd : tipo(it)) : null);

/**
 * O ponto único da unidade: o estoque do AppNext como o painel usa. Envasado cadastrado em "Kg" passa a "Un" (a quantidade já é o
 * número de pacotes; o custo é o do pacote) e guarda a unidade do AppNext em `unAppNext` (a planilha do inventário devolve a dele).
 * Todo item ganha `tipoProd`. grupoDe(cod) → grupo do AppNext (ou ''). Devolve um estoque novo (não mexe no original).
 */
function normalizar(estoque, grupoDe) {
  if (!estoque || !Array.isArray(estoque.itens)) return estoque;
  const itens = estoque.itens.map((it) => {
    const t = tipo({ un: it.un, desc: it.desc, grupo: grupoDe ? grupoDe(String(it.cod)) : '' });
    if (t === 'envasado' && ehKg(it.un)) return { ...it, un: 'Un', unAppNext: it.un, tipoProd: t };
    return { ...it, tipoProd: t };
  });
  return { ...estoque, itens };
}

/** unidade para mostrar: 'kg' ou 'un' */
const unidade = (un) => (ehKg(un) ? 'kg' : 'un');
const NOMES = { granel: 'Chá a granel', envasado: 'Chás envasados', alimento: 'Alimentação' };

module.exports = { tipo, de, normalizar, unidade, ehKg, ENVASADO_NOME, GRUPO_ENVASADO, GRUPO_ALIMENTO, NOMES, TIPOS: ['granel', 'envasado', 'alimento'] };
