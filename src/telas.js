'use strict';
/**
 * Lista única das telas do painel, agrupadas como no menu, com a regra de cada perfil.
 * É a fonte de Configurações → Usuários (o que mostrar, o que travar) e do que o gerente pode receber (C.TELAS).
 * Regra por perfil: 'sempre' (fixa, vem marcada e travada), 'nunca' (fixa, desmarcada e travada) ou 'escolha'
 * (só para o gerente: liberada uma a uma; `padrao` diz se vem marcada). Admin e franqueado veem todas.
 * Tela nova no painel precisa entrar aqui (o teste tests/unit/telas.test.js avisa).
 *
 * `paginas`: as páginas (#hash) que a tela libera no menu (ex.: Clientes libera Hoje, Lista, Indicadores e Campanhas).
 * Não exige nada no servidor: este arquivo não carrega config.js (é carregado por ele).
 */
const S = 'sempre', N = 'nunca', E = 'escolha';
const ADM = { admin: S, franqueado: S };

const GRUPOS = [
  ['Início', [
    { id: 'inicio', nome: 'Início', ...ADM, gerente: S, vendedor: N, fixa: 'Toda a equipe da gestão abre o painel pelo Início (mostra só o que a pessoa pode ver).' },
  ]],
  ['Vendas', [
    { id: 'resumo', nome: 'Resumo', ...ADM, gerente: E, padrao: true, vendedor: N },
    { id: 'comparativos', nome: 'Comparativos', ...ADM, gerente: E, padrao: true, vendedor: N },
    { id: 'promocao', nome: 'Promoção', ...ADM, gerente: E, padrao: true, vendedor: N },
    { id: 'cupons', nome: 'Cupons (itens de cada venda)', ...ADM, gerente: E, padrao: true, vendedor: N },
    { id: 'conferencia', nome: 'Conferência (caixa × painel, cancelados, saúde dos dados)', ...ADM, gerente: E, padrao: false, vendedor: N,
      dica: 'Mostra o faturamento da loja, o fechamento do caixa por operador e os cupons cancelados por vendedor. A parte de custo só aparece para quem tem uma tela de custo.' },
    { id: 'orcamento', nome: 'Orçamento', ...ADM, gerente: N, vendedor: N, fixa: 'Orçamento mostra custo e margem: só admin e franqueado.' },
  ]],
  ['Clientes', [
    { id: 'clientes', nome: 'Clientes (Hoje, Lista de clientes, Indicadores, Campanhas)', paginas: ['hoje', 'clilista', 'clientes', 'campanhas'], ...ADM, gerente: E, padrao: false, vendedor: N,
      dica: 'Mostra CPF, telefone e histórico de compras. A vendedora nunca recebe dados de clientes.' },
    { id: 'conversas', nome: 'Conversas do WhatsApp', ...ADM, gerente: N, vendedor: N, fixa: 'As conversas do WhatsApp da loja: só admin e franqueado, por segurança (decisão do dono). O admin pode tirar de um franqueado em "WhatsApp", mais abaixo.' },
    { id: 'espera', nome: 'Lista de espera', ...ADM, gerente: E, padrao: true, vendedor: S, fixa: 'A vendedora sempre usa a Lista de espera (vê nome, CPF e celular do cliente para anotar e avisar — decisão do dono).' },
  ]],
  ['Equipe', [
    { id: 'comissionamento', nome: 'Comissionamento', ...ADM, gerente: E, padrao: true, vendedor: N },
    { id: 'minha', nome: 'Comissão de cada vendedor (para a vendedora: Minha comissão)', ...ADM, gerente: E, padrao: true, vendedor: S, fixa: 'A vendedora sempre vê a própria comissão (só a dela).' },
    { id: 'mapa', nome: 'Movimento e escala', ...ADM, gerente: E, padrao: true, vendedor: N, dica: 'Com ela, o gerente também ajusta a escala do mês.' },
    { id: 'checklist', nome: 'Checklist de abertura e fechamento', ...ADM, gerente: S, vendedor: S, fixa: 'Toda a equipe da loja marca o checklist.' },
  ]],
  ['Produtos', [
    { id: 'rentab', nome: 'Rentabilidade', ...ADM, gerente: E, padrao: false, vendedor: N, custo: true },
    { id: 'precos', nome: 'Preços', ...ADM, gerente: E, padrao: false, vendedor: N, custo: true },
    { id: 'site', nome: 'Site (preços do e-commerce)', ...ADM, gerente: E, padrao: false, vendedor: N, dica: 'Só os preços do e-commerce comparados com os da loja (sem custos).' },
  ]],
  ['Estoque', [
    { id: 'estoque', nome: 'Estoque', ...ADM, gerente: E, padrao: false, vendedor: N, custo: true },
    { id: 'validade', nome: 'Validade (lotes do chá a granel)', ...ADM, gerente: E, padrao: true, vendedor: S, fixa: 'A vendedora sempre acompanha a validade dos lotes (sem custo).' },
    { id: 'pedido', nome: 'Pedido', ...ADM, gerente: E, padrao: false, vendedor: N, custo: true, dica: 'Quem tem o Pedido também decide as ⭐ sugestões da equipe.' },
    { id: 'notas', nome: 'Notas fiscais (entrada e saída)', paginas: ['notas', 'nfsaida', 'creditos'], ...ADM, gerente: E, padrao: false, vendedor: N, custo: true },
    { id: 'inventario', nome: 'Inventário', ...ADM, gerente: E, padrao: false, vendedor: S, fixa: 'A vendedora sempre conta o estoque (contagem sem custo).' },
    { id: 'sugestoes', nome: '⭐ Sugestões para o pedido', ...ADM, gerente: E, padrao: true, vendedor: S, fixa: 'A vendedora sempre sugere produtos para o pedido (vê só nome e situação, nunca quantidade nem custo).' },
  ]],
  ['Resultado', [
    { id: 'dre', nome: 'Resultado (DRE)', ...ADM, gerente: E, padrao: false, vendedor: N, custo: true },
  ]],
  ['Configurações', [
    { id: 'config', nome: 'Configurações (lojas, usuários, mensagens)', ...ADM, gerente: N, vendedor: N, fixa: 'Configurações e usuários: só admin e franqueado.' },
  ]],
];
for (const [, xs] of GRUPOS) for (const t of xs) {
  if (t.custo) t.dica = t.dica || 'Mostra custo, margem e lucro. A vendedora nunca vê custo.';
  if (t.custo && !t.fixa) t.fixaVendedor = 'Custo e margem nunca aparecem para a vendedora.';
}
const TODAS = GRUPOS.flatMap(([g, xs]) => xs.map((t) => ({ ...t, grupo: g })));
/** telas que se liberam uma a uma para o gerente (o que vale em usuarios[].telas) */
const ESCOLHA_GERENTE = TODAS.filter((t) => t.gerente === E).map((t) => t.id);
const PADRAO_GERENTE = TODAS.filter((t) => t.gerente === E && t.padrao).map((t) => t.id);
/** páginas (#hash) de cada tela */
const PAGINAS = Object.fromEntries(TODAS.map((t) => [t.id, t.paginas || [t.id]]));

/** a regra de uma tela para um perfil */
const regra = (id, perfil) => { const t = TODAS.find((x) => x.id === id); return t ? t[perfil] || N : N; };

/** a lista que vai para a tela de Usuários (sem nada além do que já está aqui) */
const paraTela = () => GRUPOS.map(([g, xs]) => ({ grupo: g, telas: xs.map(({ id, nome, admin, franqueado, gerente, vendedor, padrao, fixa, fixaVendedor, dica }) => ({ id, nome, admin, franqueado, gerente, vendedor, padrao: !!padrao, fixa: fixa || null, fixaVendedor: fixaVendedor || null, dica: dica || null })) }));

module.exports = { GRUPOS, TODAS, ESCOLHA_GERENTE, PADRAO_GERENTE, PAGINAS, regra, paraTela };
