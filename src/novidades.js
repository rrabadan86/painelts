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
