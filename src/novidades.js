'use strict';
/**
 * "O que mudou no painel" (decisão do dono, 24/11/2026; NOV-01…03): ao entrar depois de uma mudança, cada pessoa vê uma
 * janela com as novidades — UMA VEZ, e só as que valem para ela (perfil e telas). O servidor guarda até onde a pessoa já
 * viu (`usuarios[].novidadesVisto` = id da última novidade vista), então ela não aparece de novo em outro aparelho.
 *
 * Toda mudança que a pessoa nota entra aqui, no mesmo PR, numa linha em português simples (o que mudou e onde), com:
 *   id    único e crescente (AAAA-MM-DD-assunto), na ordem em que entrou
 *   para  perfis que veem: 'todos' ou lista de 'admin' | 'franqueado' | 'gerente' | 'vendedor'
 *   tela  (opcional) só quem tem essa tela (src/telas.js) — ex.: 'clientes', 'cupons'
 * Como a produção só recebe versões liberadas, as novidades chegam a cada loja junto com a versão. Nunca escreva custo,
 * dado de cliente ou nome de cliente aqui (vale a mesma regra de perfil das telas).
 */
const C = require('./config');

const NOVIDADES = [
  { id: '2026-11-23-robo-conversa', data: '2026-11-23', titulo: 'Robô do WhatsApp espera a conversa terminar', texto: 'Quem está conversando com a loja não recebe campanha do robô naquele momento: fica na fila e recebe depois (Clientes → Campanhas).', para: ['admin', 'franqueado', 'gerente'], tela: 'clientes' },
  { id: '2026-11-23-site-mudou-em', data: '2026-11-23', titulo: 'Site: o que mudou em cada dia', texto: 'Na tela Site, o filtro "Mudou em" mostra os preços e promoções que mudaram hoje, ontem ou no dia que você escolher.', para: ['admin', 'franqueado', 'gerente'], tela: 'site' },
  { id: '2026-11-24-robo-permissao', data: '2026-11-24', titulo: 'Robô do WhatsApp liberado por pessoa', texto: 'Conectar, ligar e configurar o robô agora depende da liberação do administrador em Configurações → Usuários.', para: ['admin', 'franqueado', 'gerente'], tela: 'clientes' },
  { id: '2026-11-24-sair-campanhas', data: '2026-11-24', titulo: 'Quem responde "sair" sai das campanhas na hora', texto: 'Cliente que responde "sair" ou "parar" no WhatsApp sai na hora das listas de todas as campanhas e aparece como "Não quer".', para: ['admin', 'franqueado', 'gerente'], tela: 'clientes' },
  { id: '2026-11-24-cupons-celular', data: '2026-11-24', titulo: 'Cupons mais fáceis de ler no celular', texto: 'Em Vendas → Cupons, no celular, cada cupom mostra hora, vendedora, CPF e itens embaixo do número, o valor à direita e os produtos com o nome inteiro.', para: ['admin', 'franqueado', 'gerente'], tela: 'cupons' },
  { id: '2026-11-24-liberar-versao', data: '2026-11-24', titulo: 'Versões conferidas antes de chegar às lojas', texto: 'Cada atualização entra primeiro no painel de homologação; o administrador confere e libera para a produção pelo botão em Atualizações do painel.', para: ['admin'] },
  { id: '2026-11-24-novidades', data: '2026-11-24', titulo: 'Novidades do painel', texto: 'Depois de cada atualização aparece esta janela com o que mudou para você. Para ver de novo: menu do seu nome → "O que mudou no painel".', para: 'todos' },
  { id: '2026-11-24-robo-rodizio', data: '2026-11-24', titulo: 'Robô do WhatsApp em rodízio entre as campanhas', texto: 'Com mais de uma campanha no robô, ele envia 5 mensagens de cada uma e passa para a próxima, em ciclo: todas andam juntas, sem esperar a outra terminar. O número muda em Campanhas → Configurar → "Rodízio entre campanhas".', para: ['admin', 'franqueado', 'gerente'], tela: 'clientes' },
  { id: '2026-11-24-nome-cidade-periodo', data: '2026-11-24', titulo: 'Campanhas: cidade, período de compra e nomes certos', texto: 'Nas campanhas: quem mora numa cidade (ou está sem cidade no cadastro), quem comprou entre duas datas e quem só compra nesta loja. Na Lista de clientes, o filtro "Compra mais em". E o nome nas mensagens sai sempre com a primeira letra maiúscula.', para: ['admin', 'franqueado', 'gerente'], tela: 'clientes' },
  { id: '2026-11-24-comissao-periodo', data: '2026-11-24', titulo: 'Comissionamento com "Hoje" e outros períodos', texto: 'Com um período menor que o mês (Hoje, Ontem, Semana atual), o topo do Comissionamento compara as vendas com a meta desse período (em Hoje, a mesma Meta de hoje do Início). A comissão continua sendo do mês.', para: ['admin', 'franqueado', 'gerente'], tela: 'comissionamento' },
  { id: '2026-11-24-listas-celular', data: '2026-11-24', titulo: 'Listas mais leves no celular', texto: 'No celular, o desempenho por vendedor (Resumo), a Evolução mensal (Comparativos) e as Não enviadas (Campanhas) viraram linhas curtas: o número principal em cima e o resto embaixo. Na Evolução mensal, toque no mês para ver os detalhes.', para: ['admin', 'franqueado', 'gerente'] },
  { id: '2026-11-24-clientes-celular', data: '2026-11-24', titulo: 'Lista de clientes mais simples no celular', texto: 'No celular, a Lista de clientes tem uma busca só (nome, CPF ou celular), Segmento e Grupo em dois botões que mostram quantos clientes há em cada opção, os downloads no ícone ⤓ e cada cliente em três linhas curtas.', para: ['admin', 'franqueado', 'gerente'], tela: 'clientes' },
  { id: '2026-11-24-equipe-celular', data: '2026-11-24', titulo: 'Mais listas leves no celular', texto: 'No celular, a Comissão por vendedor, a Promoção por vendedor, o Rendimento da equipe, Vendedoras e clientes e a lista de itens dos Cupons também viraram linhas curtas: o número principal à direita e o resto embaixo.', para: ['admin', 'franqueado', 'gerente'] },
  { id: '2026-11-24-produtos-celular', data: '2026-11-24', titulo: 'Produtos e contas mais leves no celular', texto: 'No celular, Estoque, Preços, Site, Validade, Sugestões, Notas, Créditos, Resultado, Conferência e Rentabilidade mostram cada item em poucas linhas, e os filtros com muitas opções viraram um botão que abre a lista de opções.', para: ['admin', 'franqueado', 'gerente'] },
  { id: '2026-11-25-gmail-porta', data: '2026-11-25', titulo: 'Gmail da loja: erro mais claro', texto: 'Ao cadastrar o Gmail da loja, a "Conexão segura direta" agora segue a porta sozinha (587 desmarcada, 465 marcada), e quando o envio falha a mensagem diz em português o que corrigir.', para: ['admin', 'franqueado'], tela: 'config' },
  { id: '2026-11-25-cupons-fixe', data: '2026-11-25', titulo: 'Cupons: marca do FIXE igual à da ficha', texto: 'Na lista de Cupons, ao lado do CPF aparece a mesma marca da ficha do cliente: FIXE ✓ (pontos lançados), CPF pelo FIXE (a nota saiu sem CPF) ou Sem FIXE (cliente do programa que comprou sem lançar os pontos).', para: ['admin', 'franqueado', 'gerente'], tela: 'cupons' },
  { id: '2026-11-25-meta-por-dia', data: '2026-11-25', titulo: 'Para bater a meta = Meta de hoje', texto: 'O "Para bater a meta" do Início e o "faltam R$ X/dia" da projeção agora usam a mesma conta da Meta de hoje (o que faltava até ontem dividido pelos dias de loja aberta, com hoje), então os números batem. No Início aparece também quanto já foi vendido hoje.', para: ['admin', 'franqueado', 'gerente'] },
  { id: '2026-11-25-hoje-escala-celular', data: '2026-11-25', titulo: 'Hoje e Escala mais simples no celular', texto: 'No celular, Clientes → Hoje tem Motivo e Vendedora em dois botões e a mensagem aparece ao tocar no nome do cliente. A Escala do mês mostra um dia por vez: escolha o dia na semana e veja quem trabalha, o horário e as horas.', para: ['admin', 'franqueado', 'gerente'] },
  { id: '2026-11-25-tabelas-celular', data: '2026-11-25', titulo: 'Resultado e comparações sem rolar de lado no celular', texto: 'No celular, o Resultado do mês cabe na tela (valor com o % embaixo), o Mês a mês mostra 3 meses por vez, Sua loja × rede e os grupos de clientes viraram linhas e as barras de produto mostram o nome inteiro.', para: ['admin', 'franqueado', 'gerente'] },
  { id: '2026-11-25-rede-periodo', data: '2026-11-25', titulo: 'Sua loja × rede segue o período', texto: 'Em Comparativos, a comparação com a rede agora usa o período escolhido no filtro (hoje, semana, mês, 28 dias…), com todas as lojas nos mesmos dias. O ritmo da meta aparece quando o período fica dentro de um mês.', para: ['admin', 'franqueado', 'gerente'], tela: 'comparativos' },
  { id: '2026-11-25-ajustes-celular', data: '2026-11-25', titulo: 'Pequenos acertos no celular', texto: 'No celular, as abas de Movimento e escala, Conferência e Conversas ficam numa linha só, os botões Imprimir e Expandir ficam ao lado do título do quadro e a lista de usuários das Configurações não fica mais colada na borda.', para: ['admin', 'franqueado', 'gerente'] },
  { id: '2026-11-25-reenviar-fechamento', data: '2026-11-25', titulo: 'Reenviar o fechamento de um dia', texto: 'Em Vendas → Conferência → Caixa × painel, cada dia da lista tem "✉ Reenviar": manda de novo o fechamento daquele dia para quem recebe o e-mail da loja. Vale para os últimos 60 dias.', para: ['admin', 'franqueado'], tela: 'conferencia' },
  { id: '2026-11-25-fechamento-do-dia', data: '2026-11-25', titulo: 'Fechamento completo de cada dia', texto: 'Em Vendas → Conferência → Caixa × painel, toque num dia da lista para ver o fechamento completo daquele dia: formas de pagamento, abertura, fechamento, sangria e tudo o que vai no e-mail.', para: ['admin', 'franqueado', 'gerente'], tela: 'conferencia' },
  { id: '2026-11-25-acesso-dias', data: '2026-11-25', titulo: 'Acesso por dias', texto: 'Em Configurações → Usuários, o prazo de acesso agora é em dias (7, 14, 30, 60, 90 ou o número que quiser): dá para liberar, por exemplo, 14 dias de teste. Só o administrador define esse prazo.', para: ['admin', 'franqueado'], tela: 'config' },
  { id: '2026-11-25-custo-fixo-onde-vale', data: '2026-11-25', titulo: 'Despesa fixa: escolha onde o novo valor vale', texto: 'No Resultado, ao mudar o valor de uma despesa fixa (por exemplo, a mensalidade de um sistema), o painel pergunta: só aquele mês, daquele mês em diante (os meses antes não mudam) ou todos os meses.', para: ['admin', 'franqueado', 'gerente'], tela: 'dre' },
  { id: '2026-11-25-resultado-partes-loja', data: '2026-11-25', titulo: 'Resultado: vendas da loja por tipo', texto: 'No Resultado, clique na linha Loja para ver as vendas separadas em chás a granel, envasados, acessórios e outros.', para: ['admin', 'franqueado', 'gerente'], tela: 'dre' },
  { id: '2026-11-25-resultado-categorias', data: '2026-11-25', titulo: 'Resultado: despesas por categoria', texto: 'O Resultado separa as despesas que acompanham as vendas (Simples, maquininha, franquia, comissões) das despesas fixas do mês, as duas agrupadas por categoria. A categoria do Simples, da maquininha e das comissões se escolhe nas Configurações da loja.', para: ['admin', 'franqueado', 'gerente'], tela: 'dre' },
  { id: '2026-11-25-dre-contabil', data: '2026-11-25', titulo: 'Resultado no formato da contabilidade', texto: 'O Resultado agora segue a DRE da contabilidade, da receita bruta ao resultado líquido, com as deduções (descontos e Simples), a receita líquida, o lucro bruto, as despesas variáveis e fixas e o resultado financeiro, que se lança no mês.', para: ['admin', 'franqueado', 'gerente'], tela: 'dre' },
  { id: '2026-11-25-cmv-estoque', data: '2026-11-25', titulo: 'CMV pelo estoque', texto: 'O painel passa a guardar o estoque na virada de cada mês. Nos meses fechados com essa foto, o CMV do Resultado sai pela conta do contador (estoque inicial + compras − devoluções − estoque final), com a linha Perdas e acertos mostrando o que sumiu além do vendido.', para: ['admin', 'franqueado', 'gerente'], tela: 'dre' },
  { id: '2026-11-25-tela-nao-sobe', data: '2026-11-25', titulo: 'A tela não volta mais para o topo', texto: 'Abrir ou fechar uma linha (▸/▾), como as categorias do Resultado, não faz mais a página subir: ela fica onde você estava.', para: 'todos' },
  { id: '2026-11-25-pct-onde-vale', data: '2026-11-25', titulo: 'Simples, maquininha e royalties: o % daqui para frente', texto: 'No Resultado, ao lançar o valor do Simples, da maquininha, dos royalties, do marketing ou de uma despesa em %, o painel pergunta se vale só no mês ou se o % muda daqui para frente ou em todos os meses. Comissões também aceitam o valor real do mês.', para: ['admin', 'franqueado', 'gerente'], tela: 'dre' },
  { id: '2026-11-25-projecao-compara', data: '2026-11-25', titulo: 'Projeção comparada', texto: 'Na Projeção do faturamento do Resumo, o painel mostra quanto ela fica acima ou abaixo do mês anterior inteiro e do mesmo mês do ano passado.', para: ['admin', 'franqueado', 'gerente'], tela: 'resumo' },
  { id: '2026-11-25-extrato-estoque', data: '2026-11-25', titulo: 'Extrato de estoque do AppNext', texto: 'Em Configurações → loja → Dados e atualização, o quadro Extrato de estoque pede ao robô para ler o extrato do AppNext (só olhando) desde jun/2025. É o primeiro passo para o painel reconstruir o estoque dos meses passados.', para: ['admin', 'franqueado'], tela: 'config' },
  { id: '2026-11-25-indicadores-clientes', data: '2026-11-25', titulo: 'Indicadores de clientes reorganizados', texto: 'Os Indicadores de clientes abrem com o que mais importa: clientes identificados, quem está sumindo, vendas com CPF e recompra. Logo abaixo, o retorno das campanhas e da fidelidade. A conferência do FIXE fica recolhida no fim. "O que fazer agora" saiu: a lista do dia está no Hoje.', para: ['admin', 'franqueado', 'gerente'], tela: 'clientes' },
  { id: '2026-11-25-retorno-campanhas', data: '2026-11-25', titulo: 'Retorno das campanhas', texto: 'Em Clientes → Campanhas, um quadro soma todas as campanhas: quanto vendeu quem voltou, quantos voltaram e a taxa de retorno, comparada com quem ficou sem mensagem. Quem recebeu duas campanhas e voltou conta uma vez só.', para: ['admin', 'franqueado', 'gerente'], tela: 'clientes' },
  { id: '2026-11-25-estoque-passado', data: '2026-11-25', titulo: 'Estoque dos meses passados', texto: 'Com o Extrato de estoque do AppNext lido, o painel reconstrói o estoque do dia 1 de cada mês desde jun/2025. O Resultado passa a usar a conta pelo estoque (estoque inicial + compras − estoque final) também nesses meses.', para: ['admin', 'franqueado', 'gerente'], tela: 'dre' },
  { id: '2026-11-25-compras-fornecedor', data: '2026-11-25', titulo: 'Compras por fornecedor no Resultado', texto: 'No Resultado, nos meses com a conta pelo estoque, as compras aparecem separadas em "Da franquia (TSB)" e "Outros fornecedores" (o ⓘ mostra quais). A devolução à franquia não é mais descontada duas vezes: o crédito dela já volta nos royalties ou no desconto da nota.', para: ['admin', 'franqueado', 'gerente'], tela: 'dre' },
  { id: '2026-11-25-resumo-descontos', data: '2026-11-25', titulo: 'Faturamento com a conta dos descontos', texto: 'No Resumo, embaixo do faturamento aparece a conta: vendas pelo preço cheio − descontos dados = faturamento. Com um mês inteiro no filtro, todos os quadros comparam com o mês anterior inteiro e o mesmo mês do ano passado (como no Resultado); passe o dedo na comparação para ver as datas.', para: ['admin', 'franqueado', 'gerente'], tela: 'resumo' },
  { id: '2026-11-26-ajuda', data: '2026-11-26', titulo: 'Ajuda do painel', texto: 'No menu do seu nome, "❓ Ajuda" explica cada tela: para que serve, como cada número é calculado e as perguntas mais comuns, com busca. Em cada tela, o "?" ao lado do título abre a ajuda daquela tela sem sair do lugar.', para: 'todos' },
];
/** pessoa sem registro (de antes desta janela): só o que entrou nos últimos dias, para não abrir com a lista inteira */
const DIAS_SEM_REGISTRO = 14;

const ultimoId = () => (NOVIDADES.length ? NOVIDADES[NOVIDADES.length - 1].id : null);

/** a novidade vale para esta pessoa? (perfil e, quando tem, a tela) */
function valePara(n, u, podeTela) {
  if (!u) return false;
  const p = u.perfil;
  if (n.para !== 'todos' && !(Array.isArray(n.para) && n.para.includes(p))) return false;
  if (!n.tela) return true;
  if (p === 'admin' || p === 'franqueado') return true;
  return !!(podeTela && podeTela(n.tela));
}

/** novidades ainda não vistas pela pessoa (todas = as últimas dela, para o menu "O que mudou") */
function paraPessoa(u, { podeTela, todas = false, hoje = C.hojeBR() } = {}) {
  const minhas = NOVIDADES.filter((n) => valePara(n, u, podeTela));
  if (todas) return minhas.slice(-12).reverse();
  const visto = u && u.novidadesVisto;
  let novas;
  if (visto && NOVIDADES.some((n) => n.id === visto)) {
    const i = NOVIDADES.findIndex((n) => n.id === visto);
    const depois = new Set(NOVIDADES.slice(i + 1).map((n) => n.id));
    novas = minhas.filter((n) => depois.has(n.id));
  } else {
    const corte = new Date(Date.parse(hoje + 'T12:00:00Z') - DIAS_SEM_REGISTRO * 864e5).toISOString().slice(0, 10);
    novas = minhas.filter((n) => n.data >= corte);
  }
  return novas.reverse();
}

module.exports = { NOVIDADES, ultimoId, valePara, paraPessoa, DIAS_SEM_REGISTRO };
