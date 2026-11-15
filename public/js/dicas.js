/* Explicações (ⓘ) dos cartões e indicadores: o que mostram e como são calculados.
 * A chave é o título do cartão; títulos que mudam (ex.: "Quem leva …") usam o começo do título.
 * Um cartão que já recebe a explicação no próprio código (4º argumento do TS.kpi) usa aquela. */
'use strict';
TS.DICAS = {
  // ---------- Resumo ----------
  'Faturamento': 'Soma do valor das vendas no período (com desconto, sem taxa de serviço e de entrega), sem as vendas "SEM VENDEDOR". Abaixo do número: a variação contra o período equivalente e contra as mesmas datas do ano anterior.',
  'Atendimentos (cupons)': 'Quantidade de cupons diferentes no período. Um cupom com vários itens conta uma vez.',
  'Ticket médio (TKM)': 'Faturamento ÷ cupons: quanto, em média, cada cliente gastou por atendimento.',
  'TKM': 'Ticket médio = faturamento ÷ cupons. Comparado com as mesmas datas do ano anterior e do mês anterior.',
  'PMA': 'Preço médio por item = faturamento ÷ itens (consumíveis sem controle de estoque não contam como item). Comparado com as mesmas datas do ano anterior e do mês anterior.',
  'Preço médio (PMA)': 'Faturamento ÷ itens vendidos: preço médio de cada item. Consumíveis sem controle de estoque (ex.: sacos de amostra) não contam como item.',
  'Itens por atendimento (IPA)': 'Itens ÷ cupons: quantos itens cada cliente leva, em média. Consumíveis sem controle de estoque não contam como item.',
  'IPA': 'Itens por atendimento = itens ÷ cupons (consumíveis sem controle de estoque não contam como item). Comparado com as mesmas datas do ano anterior e do mês anterior.',
  'Chá vendido': 'Quilos de chá vendidos no período: gramatura do pacote × quantidade (granel, envasados e sachês).',
  'Espaço Gourmet': 'Parte do faturamento que veio do Espaço Gourmet (tea room) no período.',
  'Loja (sem EG)': 'Parte do faturamento que veio da loja (chás, acessórios e alimentação), sem o Espaço Gourmet.',
  'Projeção do faturamento': 'Faturamento até agora ÷ dias que já passaram × dias do mês. Considera o ritmo atual; feriados e datas fortes no fim do mês mudam o resultado.',
  'Desempenho por vendedor': 'Indicadores de cada vendedor no período. Cupons de mais de um vendedor contam para cada um. Clique no título de uma coluna para ordenar.',
  'Faturamento por dia da semana': 'Total: soma do faturamento de cada dia da semana no período. Média por dia: o total dividido pelo número daquele dia da semana com venda no período (ex.: 4 sextas). A média corrige períodos que têm mais segundas que sábados, por exemplo.',
  'Vendas por produto': 'Quantidade, quilos e faturamento de cada produto no período, sem as taxas de serviço e entrega.',
  'Chá em kg': 'Os chás que mais venderam em quilos no período.',
  'Acessórios e alimentação': 'Os acessórios e itens de alimentação que mais venderam em unidades no período.',
  'Kg por tipo': 'Quilos de chá por tipo (preto, verde, rooibos…) e a parte de cada um no total. Clique numa barra para ver os produtos.',
  // ---------- Comparativos ----------
  'Evolução mensal': 'Cada mês comparado com o mesmo mês do ano anterior. Mês em andamento: compara os mesmos dias (ex.: 1 a 13 com 1 a 13). Abra o mês para ver os anos e os vendedores.',
  'Mix de vendas por vendedor': 'Como o faturamento de cada vendedor se divide entre chá aromatizado, chá puro e acessórios. A última barra é a média da loja.',
  'Histórico de faturamento': 'Faturamento ao longo do período do filtro: por dia (até 45 dias), por semana (até ~6 meses) ou por mês. A linha tracejada é a média.',
  'Mês a mês por vendedor': 'O indicador escolhido para cada vendedor, agrupado pelo período do filtro (até 45 dias: por dia; até ~6 meses: por semana; mais: por mês). A linha tracejada é a média da loja.',
  'Semana a semana por vendedor': 'O indicador escolhido para cada vendedor, semana a semana (segunda a domingo), no período do filtro. A linha tracejada é a média da loja.',
  'Dia a dia por vendedor': 'O indicador escolhido para cada vendedor, dia a dia, no período do filtro. A linha tracejada é a média da loja.',
  'Pacotes por tamanho': 'Quantos pacotes de cada gramatura cada vendedor vendeu. A última coluna é a média da loja por vendedor.',
  // ---------- Comissionamento ----------
  'Comissão por vendedor': 'Comissão calculada pelas regras da loja (Configurações → Lojas → Metas e comissão) sobre as vendas de cada vendedor no período.',
  'Espaço Gourmet: gorjetas': 'Taxa de serviço do Espaço Gourmet no período, dividida entre a equipe conforme a regra da loja.',
  'Royalties': 'Base dos royalties: vendas da loja (chás + acessórios), sem o Espaço Gourmet.',
  'Premiações': 'Valor pago aos vendedores que atingiram o mínimo dos indicadores (TKM, IPA, PMA) definidos nas regras da loja.',
  'Meta da loja': 'Meta do período cadastrada para a loja (ou simulada nos filtros), dividida entre os vendedores.',
  'Total a pagar': 'Comissões + bônus do período (ou rateio igual entre a equipe, se a loja usa rateio).',
  'Na meta individual': 'Vendedores que atingiram a própria meta no período.',
  'Premiação': 'Valor por indicador quando o mínimo de indicadores é atingido no mês.',
  'Indicadores': 'Seus indicadores no mês comparados com o mínimo da premiação.',
  'Sua meta': 'Sua meta individual do mês e quanto falta.',
  'Você vendeu': 'Suas vendas no período.',
  'A receber (estimado)': 'Comissão e premiação estimadas pelo que foi vendido até agora. O valor final sai no fechamento do mês.',
  'Sua loja × rede': 'Seus indicadores comparados com a média das outras lojas da rede, sem identificar nenhuma.',
  // ---------- Promoção ----------
  'Período atual × anterior': 'Compara o período escolhido com os mesmos dias imediatamente antes dele (quantidade de dias em Filtros → Promoção).',
  'TKM antes e durante': 'Ticket médio de cada vendedor antes e durante o período. A última coluna é o TKM da loja.',
  'Lucro da promoção': 'Lucro bruto por dia antes e durante o período, com o custo de cada produto da planilha de estoque do AppNext.',
  // ---------- Mapa de calor ----------
  'Movimento médio por hora': 'Média de cupons (ou faturamento) por hora e dia da semana no período, sem feriados. Cores mais fortes = mais movimento.',
  'Pessoas necessárias por hora': 'Pelo pico de cada horário (80% dos dias ficam abaixo) e pela capacidade de atendimentos por pessoa por hora.',
  'Escala do mês': 'Escala dia a dia, com feriados e férias, pela necessidade de pessoas por hora.',
  'Escala sugerida': 'Turnos sugeridos para cobrir o movimento com a equipe disponível.',
  'Próximas semanas': 'Movimento previsto pelas mesmas semanas do ano passado, corrigido pelo crescimento atual da loja.',
  'Equipe ideal': 'Pessoas para cobrir todos os horários e também os picos de movimento.',
  'Equipe mínima': 'Menor equipe que garante ao menos uma pessoa na loja em todos os horários de funcionamento.',
  'Horas de trabalho necessárias': 'Soma das pessoas necessárias em cada hora da semana.',
  'Horas da equipe atual': 'Funcionários × carga semanal cadastrados na loja, comparado com as horas necessárias.',
  // ---------- Clientes ----------
  'Vendas com CPF': 'Cupons do período em que o cliente informou o CPF na nota. Quanto maior, mais a base de clientes cresce.',
  'Ticket do cliente identificado': 'Ticket médio dos cupons com CPF, comparado com o ticket geral.',
  'Recompra': 'Clientes da lista que compraram 2 vezes ou mais no período.',
  'Clientes novos no período': 'Clientes cuja primeira compra identificada (com CPF) foi no período.',
  'Clientes': 'Clientes identificados por CPF que aparecem com os filtros escolhidos.',
  'Com WhatsApp': 'Clientes da lista com celular cadastrado, para contato pelo WhatsApp.',
  'Faturamento desses clientes': 'Soma do que os clientes da lista compraram no período.',
  'Visitas por cliente': 'Média de cupons por cliente no período.',
  'Aniversariantes do mês': 'Clientes que fazem aniversário no mês atual.',
  'Lista de clientes': 'Clientes identificados por CPF com compras no período. Clique num cliente para ver a ficha, os cupons e os itens.',
  'Faixa etária': 'Clientes por faixa de idade, entre os que têm data de nascimento no cadastro.',
  'Quem leva': 'Produtos que mais aparecem no mesmo cupom do produto buscado, em % dos cupons com ele.',
  'Clientes por mês': 'Clientes novos (primeira compra) e recorrentes (já tinham comprado antes), identificados por CPF. Agrupado pelo período: por dia, por semana ou por mês.',
  'Clientes por dia': 'Clientes novos (primeira compra no dia) e recorrentes, identificados por CPF.',
  'Clientes por semana': 'Clientes novos (primeira compra na semana) e recorrentes, identificados por CPF.',
  'Vendedoras e clientes': 'Por vendedora: % das vendas com CPF, clientes novos que ela atendeu na primeira compra e quantos voltaram depois.',
  'Resgate de pontos': 'Dos clientes que chegaram ao mínimo de pontos para resgatar no período, quantos resgataram dentro do prazo. Quem ainda está no prazo fica fora do %. Retorno do programa: valor e custo dos prêmios entregues (saem no caixa a R$ 0,01 com o mesmo nome do produto vendido normalmente; R$ 0,01 com outro nome, como brinde de promoção, fica fora) sobre as compras que geraram pontos e sobre o faturamento.',
  'Fidelidade (FIXE)': 'Liga as compras lançadas no FIXE aos cupons de venda (mesmo dia, hora próxima e mesmos produtos) e mostra o que precisa ser conferido: CPF diferente, vendas sem pontos e clientes fora do programa.',
  // ---------- Estoque e margem ----------
  'Estoque a custo': 'Quantidade em estoque × custo de cada produto (planilha Estoque Atual do AppNext).',
  'Estoque parado': 'Produtos com saldo e sem venda há mais dias que o limite da loja: dinheiro parado.',
  'Para repor': 'Produtos que vão acabar antes do próximo pedido chegar, pelo ritmo de venda.',
  'Vendas com custo': 'Parte do faturamento cujos produtos têm custo no estoque do AppNext. O que não tem custo fica fora da margem.',
  'Lucro bruto': 'Faturamento − custo dos produtos vendidos (CMV).',
  'Lucro sem fixos': 'Lucro bruto − deduções que acompanham a venda (comissão, royalties, Simples, maquininha e custos em %), antes do aluguel e outros fixos.',
  'Lucro com fixos': 'Lucro sem fixos − custos fixos do mês (aluguel, salários…) rateados pelo faturamento.',
  'O que repor': 'Sugestão de reposição pelo consumo médio, prazo de entrega e cobertura configurados na loja.',
  'Giro × margem': 'Cada produto pela quantidade vendida (giro) e pela margem. Estrela = vende muito e com boa margem; Peso morto = pouco das duas.',
  'Margem sem fixos abaixo de': 'Produtos que deixam menos que a margem mínima depois do custo e das deduções variáveis.',
  'Qual pacote oferecer': 'Lucro sem fixos a cada 100 g de chá em cada tamanho de pacote, para saber quando vale oferecer o maior.',
  'Produtos por lucro': 'Curva ABC: A = produtos que somam 80% do lucro, B = os próximos 15%, C = o resto.',
  'Lucro por vendedora': 'Lucro sem fixos das vendas de cada vendedora. Quem vende mais nem sempre deixa mais lucro.',
  'Kits sugeridos': 'Pares de produtos que saem juntos no mesmo cupom mais do que o acaso explicaria: bons candidatos a kit.',
  'Custos que mudaram': 'Produtos cujo custo no AppNext mudou no período.',
  // ---------- Preços ----------
  'Custo alterado': 'Produtos vendidos cujo custo mudou no período (chá a granel: custo do pacote = kg × tamanho + embalagem).',
  'Venda alterada': 'Produtos cujo preço praticado mudou no período (o preço novo precisa se manter nas semanas seguintes).',
  'Perderam margem': 'Produtos com margem bruta menor no fim do período do que antes dele.',
  'Histórico de custo desde': 'Data do primeiro custo conhecido: notas de compra do AppNext e importações de estoque. Antes dela o custo é estimado.',
  'Produtos': 'Custo e preço de venda de 1 unidade antes e no fim do período, e a margem bruta. Clique no produto para ver a composição, as vendas por mês e os reajustes.',
  // ---------- Pedido ----------
  'Limite do pedido': 'Valor máximo do pedido: % das vendas da loja (sem Espaço Gourmet) nos últimos dias, pelo CMV.',
  'Referência pelo CMV': 'CMV real dos últimos 3 meses fechados: custo das vendas ÷ faturamento.',
  'Tudo que precisa': 'Valor de tudo que a sugestão indica, sem o limite do pedido.',
  'Vendas no ano passado': 'O que a loja vendeu no mesmo período do ano passado, base das datas comemorativas.',
  'Vendido (chás + acessórios)': 'Vendas que contam para a meta (chás e acessórios, sem Espaço Gourmet) e a % da meta atingida.',
  'Proporção do pedido': 'Parte de cada grupo nas vendas (cinza) e no pedido (verde). Embalagens e insumos entram antes, fora da proporção.',
  'Carrinho no Sistema de Pedidos': 'Monta o carrinho no site da franqueadora pelo seu navegador, item a item. O pedido nunca é finalizado pelo painel.',
  // ---------- Resultado ----------
  'Resultado do mês': 'Faturamento − custo dos produtos − deduções − custos fixos do mês.',
  'Resultado mês a mês': 'Resultado de cada mês (verde lucro, vermelho prejuízo) e a margem de contribuição.',
  'Mês a mês': 'Resultado de cada mês. Mês em andamento: custos fixos proporcionais aos dias que já passaram.',
  'Resultado de': 'Demonstrativo do mês: faturamento, custos, deduções e resultado. Clique nos grupos para ver os itens.',
  'Mês': 'Situação do mês: em andamento ou fechado (aí a comissão é definitiva).',
  // ---------- Configurações ----------
  'Histórico de alterações': 'Quem mudou o quê e quando nas configurações do painel.',
};

/** explicação de um título (exata ou pelo começo) */
TS.dicaDe = function (titulo) {
  if (!titulo || typeof titulo !== 'string') return null;
  if (TS.DICAS[titulo]) return TS.DICAS[titulo];
  const t = titulo.trim();
  for (const k of Object.keys(TS.DICAS)) if (k.length >= 6 && t.startsWith(k)) return TS.DICAS[k];
  return null;
};
