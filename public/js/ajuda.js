/* Ajuda do painel (pedido do dono, 25/11/2026; AJUDA-01…03): uma ficha por página do menu — para que serve, quem vê, os
 * números e como cada um é calculado, e as perguntas daquela tela — mais as perguntas frequentes.
 * - Abre pelo menu do nome ("❓ Ajuda": a lista) e pelo ⓘ ao lado do título de cada tela (a ficha daquela tela, por cima,
 *   sem sair do lugar). É uma camada (`camada-cheia`): o "voltar" do celular fecha.
 * - Cada pessoa vê só as fichas das telas do menu dela (TS.paginas()); linha marcada `custo` só para quem vê custo.
 * - Toda página do menu (src/telas.js → PAGINAS) tem ficha: o teste tests/unit/ajuda.test.js avisa quando falta.
 * Os textos seguem as contas do painel (contas.js, dre.js, campretorno.js…): mudou a conta, mude a ficha no mesmo PR. */
'use strict';
(function () {
  const C = 'custo'; // linha que só aparece para quem vê custo (nunca para a vendedora)

  /** [página, grupo, nome, para que serve, quem vê, números [[nome, conta, só?]], perguntas [[pergunta, resposta, só?]]] */
  const FICHAS = [
    ['inicio', 'Início', 'Início', 'Como está o mês da loja e o que fazer agora.', 'Admin, franqueado e gerente', [
      ['Meta do mês', 'Vendas da meta do mês ÷ meta da loja. A marca na barra é onde a loja deveria estar hoje: dias de loja aberta já completos ÷ dias de loja aberta do mês.'],
      ['Para bater a meta', 'O que falta da meta ÷ dias de loja aberta que faltam (com hoje). Com a meta batida, mostra quanto passou.'],
      ['No ritmo de agora', 'Projeção das vendas da meta até o fim do mês, pelo ritmo dos dias que já passaram. O ⓘ mostra a conta.'],
      ['Esta semana', 'Vendas da semana contra a semana passada, nos mesmos dias, e o que mais pesou na diferença.'],
      ['O que fazer agora', 'As ações mais importantes do momento, cada uma com o botão que leva à tela certa.'],
      ['Também pede atenção', 'Os avisos por área. "Dados e configuração" vem sempre primeiro: diz se os números estão em dia.'],
      ['Meta de hoje', 'A parte de hoje da meta do mês, dividida pelas horas da escala.'],
      ['Margem da semana', 'Lucro bruto ÷ vendas da semana.', C],
    ], [
      ['O que entra nas "vendas da meta"?', 'Chás e acessórios, sem o Espaço Gourmet. O faturamento (Resumo e Resultado) inclui tudo o que a loja vendeu.'],
      ['A pílula ao lado do título ficou amarela ou vermelha. E agora?', 'Amarela: as vendas chegaram só até uma data antiga. Vermelha: a última atualização falhou. Toque nela para ver o motivo.'],
    ]],
    ['resumo', 'Vendas', 'Resumo', 'Como estão as vendas no período escolhido nos filtros.', 'Admin, franqueado e gerente com a tela', [
      ['Faturamento', 'O que os clientes pagaram: preço cheio − descontos dados no caixa. Com o Espaço Gourmet, sem a taxa de serviço e sem itens a R$ 0,01 (resgates e brindes). A conta aparece embaixo do número.'],
      ['Atendimentos', 'Cupons únicos: cada venda conta uma vez, mesmo com vários itens.'],
      ['Ticket médio (TKM)', 'Faturamento ÷ atendimentos.'],
      ['Preço médio (PMA)', 'Faturamento ÷ itens vendidos.'],
      ['Itens por atendimento (IPA)', 'Itens ÷ atendimentos.'],
      ['Chá vendido', 'Quilos dos grupos de chá; brinde e resgate não contam.'],
      ['Espaço Gourmet', 'Parte do faturamento que veio do Espaço Gourmet.'],
      ['Projeção do faturamento', 'Só no mês em andamento: quanto o mês fecha no ritmo de agora, comparado com o mês anterior inteiro e o mesmo mês do ano passado.'],
      ['Comparações', 'Com um mês inteiro no filtro: o mês anterior inteiro e o mesmo mês do ano passado ("vs. out/25"). Em outros períodos: os mesmos dias da semana do ano passado e as mesmas datas do mês anterior. Toque na comparação para ver as datas.'],
    ], [
      ['O ticket subiu e o faturamento caiu. Como?', 'Menos clientes compraram, mas cada um gastou mais. Olhe os atendimentos.'],
      ['Por que a projeção só aparece às vezes?', 'Ela só existe no mês em andamento, com o período começando no dia 1.'],
    ]],
    ['comparativos', 'Vendas', 'Comparativos', 'Evolução mês a mês, ano contra ano e por vendedora.', 'Admin, franqueado e gerente com a tela', [
      ['Faturamento e cupons', 'Do período, com as mesmas comparações do Resumo.'],
      ['Espaço Gourmet', 'A divisão entre o Espaço Gourmet e a loja.'],
      ['TKM, PMA e IPA', 'As mesmas contas do Resumo.'],
      ['Evolução mensal', 'Cada mês com a variação contra o mesmo mês do ano anterior. Toque no mês para ver os indicadores e as vendedoras.'],
      ['% da meta', 'Embaixo do faturamento de cada mês: vendas da meta (chá aromatizado, chá puro e acessórios, sem Espaço Gourmet) ÷ meta do mês, a mesma conta do Início. Verde bateu, vermelho não bateu, amarelo mês em andamento. No vendedor, contra a meta individual da comissão. Toque no % para ver a conta.'],
    ], [
      ['Por que a evolução mensal compara mês com mês e os quadros não?', 'Os quadros seguem o período dos filtros; a tabela é sempre por mês do calendário.'],
      ['Por que o % da meta não bate com faturamento ÷ meta?', 'A meta é contra as vendas da meta, que deixam de fora o Espaço Gourmet e as taxas. A janela do % mostra as duas linhas.'],
    ]],
    ['promocao', 'Vendas', 'Promoção', 'Compara o período escolhido com os dias imediatamente anteriores.', 'Admin, franqueado e gerente com a tela', [
      ['Faturamento, atendimentos e TKM', 'Do período contra o mesmo número de dias logo antes. O rodapé diz de quando a quando.'],
      ['Por vendedora', 'Cada indicador com o valor, a variação e o "antes".'],
    ], [
      ['Como meço uma promoção?', 'Escolha nos filtros exatamente os dias da promoção: a tela compara com os dias logo antes.'],
    ]],
    ['cupons', 'Vendas', 'Cupons', 'Cada venda do período, por dia e cupom, com os itens, a vendedora e o cliente.', 'Admin, franqueado e gerente com a tela', [
      ['Cupons no período', 'Cupons únicos, a mesma conta do Resumo.'],
      ['Com cliente identificado', 'Cupons com CPF ou CNPJ na nota.'],
      ['"não conta"', 'Taxa de serviço, item a R$ 0,01 e consumível sem controle aparecem marcados e ficam fora dos totais.'],
    ], [
      ['A soma dos cupons não bate com o faturamento. Por quê?', 'As linhas marcadas "não conta" ficam fora; com elas fora, o total é o mesmo do Resumo.'],
    ]],
    ['conferencia', 'Vendas', 'Conferência', 'Dá para confiar nos números? O painel contra o caixa, os cancelados e a situação dos dados.', 'Admin, franqueado e gerente com a tela marcada', [
      ['Por dia', 'O faturamento do painel contra o fechamento do caixa de cada dia. Toque no dia para ver o fechamento completo.'],
      ['Cancelados', 'Cupons cancelados por vendedora. Só saem das vendas se a loja escolher isso.'],
      ['Saúde dos dados', 'Quando chegou a última atualização de cada fonte (vendas, estoque, notas, fidelidade).'],
    ], [
      ['Dá para mandar o fechamento do dia de novo?', 'Sim: no dia, "✉ Reenviar" (admin e franqueado).'],
    ]],
    ['orcamento', 'Vendas', 'Orçamento', 'Pedidos de empresas: monte, imprima ou mande pelo WhatsApp e acompanhe até virar venda.', 'Só admin e franqueado', [
      ['Em aberto', 'Orçamentos enviados que ainda não foram aprovados nem perdidos.'],
      ['Aprovados', 'Orçamentos que viraram venda.'],
      ['Taxa de conversão', 'Aprovados ÷ (aprovados + perdidos).'],
      ['Margem bruta e líquida', 'Na montagem do orçamento, pelo custo de hoje.', C],
    ], []],
    ['hoje', 'Clientes', 'Hoje', 'Quem contatar hoje e por quê: uma mensagem por cliente, pelo WhatsApp da loja.', 'Admin, franqueado e gerente com a tela Clientes', [
      ['Lista do dia', 'Clientes com um motivo para contatar hoje (sumindo, aniversário, hora de repor…). Cada um aparece uma vez, com o motivo mais importante.'],
      ['WhatsApp', 'Abre a conversa com a mensagem pronta. Antes, o painel confere se o cliente pode receber.'],
      ['Desfazer', 'Tocou sem querer? Dá para desfazer em até 10 segundos.'],
    ], [
      ['Por que não consigo mandar para um cliente?', 'Ele já recebeu dentro do intervalo da loja, pediu para não receber ou está na fila do robô. O painel explica qual.'],
      ['De onde vem essa lista?', 'É a mesma conta da Campanha Resumo diário do robô do WhatsApp.'],
    ]],
    ['clilista', 'Clientes', 'Lista de clientes', 'Cada cliente com a ficha, os cupons e os itens; segmentos para saber quem contatar.', 'Admin, franqueado e gerente com a tela Clientes', [
      ['Segmentos', 'Atalhos como "Contatar hoje" e "VIP", cada um com a explicação ao tocar.'],
      ['Grupos (RFM)', 'Nota de 1 a 5 em recência (há quanto tempo veio), frequência e valor nos últimos 12 meses, comparados com os outros clientes da loja.'],
      ['Ficha do cliente', 'Compras, cupons, itens, celular e o histórico de mensagens.'],
    ], [
      ['Como a compra é ligada ao cliente?', 'Pelo CPF na nota. Sem CPF na nota, pela compra lançada no programa de fidelidade naquele dia.'],
    ]],
    ['clientes', 'Clientes', 'Indicadores de clientes', 'A base de clientes, o retorno das ações e o perfil de quem compra.', 'Admin, franqueado e gerente com a tela Clientes', [
      ['Clientes identificados', 'Clientes com compra identificada no período, o faturamento deles e as visitas por cliente.'],
      ['Clientes bons sumindo', 'Grupos "Não pode perder" e "Em risco": compravam bem e estão sumindo.'],
      ['Vendas com CPF', 'Cupons com o CPF do cliente ÷ todos os cupons.'],
      ['Recompra em 90 dias', 'Dos clientes do período, quantos compraram de novo em até 90 dias (só quem já teve o prazo inteiro).'],
      ['Retorno das campanhas', 'O mesmo número da tela Campanhas.'],
      ['Fidelidade', 'Quantos resgataram, quem resgatou voltou e prêmios × venda a mais.'],
      ['Qualidade do cadastro', 'Só admin e franqueado. Todos os clientes do cadastro: completo = celular que recebe WhatsApp, nascimento de verdade, cidade, e-mail e nome completo. Cada problema abre a lista para corrigir no FIXE.'],
      ['Conferência dos dados', 'No fim, recolhida: a ligação das compras do programa de fidelidade com os cupons.'],
    ], [
      ['Corrigi o cadastro e o cliente continua na lista. Por quê?', 'O painel lê o cadastro do FIXE: o cliente sai da lista depois da próxima importação do FIXE.'],
      ['Cada quadro segue os mesmos filtros?', 'Não: a linha embaixo de cada seção diz a quais filtros ela responde.'],
    ]],
    ['campanhas', 'Clientes', 'Campanhas', 'Monte uma lista de clientes, escreva a mensagem, envie e veja quem voltou a comprar.', 'Admin, franqueado e gerente com a tela Clientes', [
      ['Faturamento do retorno', 'Compras de quem recebeu a mensagem, do dia seguinte ao envio até o fim do prazo da campanha. Cada compra conta uma vez, mesmo se a pessoa recebeu duas campanhas.'],
      ['Voltaram', 'Clientes que receberam e compraram dentro do prazo.'],
      ['Taxa de retorno', 'Voltaram ÷ receberam, só com quem já teve o prazo inteiro. Comparada com quem ficou sem mensagem.'],
      ['Grupo de comparação', 'Nas listas com 50 clientes ou mais, 10% ficam sem mensagem: mostra quanto a mensagem fez diferença.'],
      ['Não enviadas', 'Quem saiu da fila sem receber, com o motivo (sem WhatsApp, já recebeu, não quer…).'],
    ], [
      ['O robô manda sozinho?', 'Só nas campanhas marcadas "Enviar pelo robô", no horário e no ritmo das configurações, com as mesmas travas do envio manual.'],
      ['Compra no mesmo dia do envio conta?', 'Não: o painel não sabe se foi antes ou depois da mensagem.'],
    ]],
    ['conversas', 'Clientes', 'Conversas', 'As conversas do WhatsApp da loja, ligadas aos clientes.', 'Só admin e franqueado', [
      ['N sem resposta', 'Mensagens do cliente depois da última resposta da loja. Agradecimento, "ok", emoji, figurinha e pedido para parar não contam.'],
      ['Responder', 'Só texto, pelo número da loja.'],
      ['Fotos e áudios', 'Buscados no WhatsApp só ao tocar; não ficam guardados no painel.'],
      ['Este número é de…', 'Liga o número a um cliente que trocou de celular: passa a valer em todo o painel.'],
    ], []],
    ['espera', 'Clientes', 'Lista de espera', 'Cliente pediu um produto que acabou? Anote aqui e avise quando chegar.', 'Toda a equipe (gerente com a tela)', [
      ['Chegaram · avisar', 'Pedidos cujo produto chegou numa nota de entrada: a mensagem já vem pronta.'],
      ['Esperando', 'Pedidos anotados que ainda não chegaram.'],
      ['Voltaram para comprar', 'Clientes avisados que compraram depois.'],
    ], [
      ['Posso avisar quem já recebeu outra mensagem?', 'Sim: o aviso de chegada foi pedido pelo cliente. Só "não quer mensagens" trava.'],
    ]],
    ['comissionamento', 'Equipe', 'Comissionamento', 'Metas, comissões, premiações e royalties do mês.', 'Admin, franqueado e gerente com a tela', [
      ['Vendas da meta', 'Chás e acessórios do mês, sem o Espaço Gourmet, com a barra até a meta e a marca de onde deveria estar hoje.'],
      ['Projeção do mês', 'Onde as vendas da meta fecham no ritmo de agora.'],
      ['Total a pagar', 'Comissões + premiações + quem bateu a meta individual.'],
      ['Comissão por vendedora', 'Cada categoria com o vendido, a meta e a comissão.'],
      ['Feriados do mês', 'Horas de cada pessoa em cada feriado. "Acerto": banco de horas (entra em dobro no saldo: 6h = +12h) ou pagar no fechamento (também em dobro: 6h = 12h a pagar); tocar no selo da pessoa troca só para ela.'],
    ], [
      ['E se eu escolher só uma semana?', 'A comissão continua pela meta do mês; a tela mostra a meta daquele período.'],
      ['A venda sem vendedor gera comissão?', 'Não. A linha SEM VENDEDOR aparece só para conferir: não gera comissão nem premiação, com ou sem rateio.'],
      ['O feriado vai para o banco ou é pago?', 'O padrão está em Movimento e escala → Equipe e regras. No cartão de feriados dá para mudar o dia todo ou só uma pessoa. O e-mail e o PDF do fechamento mostram o que foi para o banco e o que é para pagar.'],
    ]],
    ['minha', 'Equipe', 'Minha comissão', 'A meta e a comissão de cada vendedora (a vendedora vê só a dela).', 'Toda a equipe', [
      ['Sua meta de hoje', 'A sua parte da meta de hoje.'],
      ['A receber', 'A comissão estimada até agora.'],
      ['Você vendeu', 'Suas vendas da meta, com a barra até a sua meta individual.'],
      ['Se continuar neste ritmo', 'Onde você fecha o mês no ritmo de agora.'],
    ], []],
    ['mapa', 'Equipe', 'Movimento e escala', 'A escala do mês, o movimento da loja por hora e as regras que montam a escala.', 'Admin, franqueado e gerente com a tela', [
      ['Horas necessárias', 'Horas de atendimento que o movimento da loja pede.'],
      ['Horas da equipe', 'Horas que a escala do mês cobre.'],
      ['Equipe', 'Quantas pessoas: o ideal e o mínimo.'],
      ['Movimento por hora', 'Cupons de cada hora de cada dia da semana.'],
      ['Jornada por dia', 'Carga da semana ÷ dias de trabalho da escala (6x1: 6, 5x2: 5, 4x3: 4). Ex.: 44h na 6x1 = 7h20 por dia.'],
      ['Intervalo', 'Acima de 6h por dia: 1h; de 4h a 6h: 15 min (CLT). A pessoa fica na loja a jornada + o intervalo.'],
      ['Deveria trabalhar', 'No resumo do mês da escala: carga semanal ÷ 7 × dias do mês, sem férias e feriados com a loja fechada. Embaixo das horas líquidas, quanto falta ou sobra; ao lado, o saldo do banco.'],
      ['Banco de horas', 'Saldo de cada pessoa: + feriados no banco (×2) e lançamentos a crédito; − folgas pelo banco (a jornada) e horas devidas. Positivo = a loja deve; negativo = a pessoa deve.'],
    ], [
      ['Quais modelos de escala existem?', 'Livre (uma semana que se repete), Rodízio de domingo com a segunda (quem folga no domingo folga também na segunda) e Rodízio só do domingo (o domingo gira e a outra folga da semana é escolhida pelas regras). Fica em Equipe e regras → Modelo.'],
      ['Alguém pode trabalhar 7 dias seguidos?', 'Não: o painel monta a escala com no máximo 6 dias seguidos, também na virada da semana. Isso vale mais que o máximo de folgas por dia; quando não cabe, a escala avisa (com 3 pessoas e o rodízio de domingo, a semana começando na segunda costuma resolver).'],
      ['Por que a folga fixa mudou de dia?', 'O máximo de pessoas de folga no mesmo dia e o mínimo de pessoas na loja valem mais que a folga fixa. Se o dia já está cheio, a folga vai para outro dia da semana, e a escala mostra o motivo ao passar o dedo na folga.'],
      ['Como funciona o banco de horas?', 'Aba Banco de horas: feriado no banco entra em dobro; "Folga pelo banco" na escala desconta a jornada do dia; lançamentos com motivo valem para o resto. Compensa do mais antigo. A hora que a pessoa deve vence em 6 meses (ou 12, nas regras) e some; o crédito dela não vence: o painel avisa para dar a folga ou pagar.'],
      ['Posso usar a escala 4x3?', 'Pode: 4 dias de trabalho e 3 folgas. A jornada passa de 8h por dia e precisa de acordo de compensação; o painel avisa se passar de 10h, o máximo da CLT.'],
    ]],
    ['checklist', 'Equipe', 'Checklist', 'Abertura e fechamento: marque cada item quando fizer.', 'Toda a equipe', [
      ['Itens', 'Cada item marcado guarda o nome e a hora.'],
      ['Últimos dias', 'Como foram os checklists dos dias anteriores; o resumo vai no e-mail de fechamento.'],
    ], []],
    ['rentab', 'Produtos', 'Rentabilidade', 'Quanto cada produto deixa depois do custo e das despesas.', 'Admin, franqueado e gerente com a tela', [
      ['Lucro bruto', 'Venda − Simples − custo do que foi vendido.', C],
      ['Margem de contribuição', 'Lucro bruto − despesas variáveis (maquininha, royalties, comissões).', C],
      ['Lucro com fixos', 'Margem de contribuição − a parte das despesas fixas.', C],
      ['Classe', '⭐ Estrela, 👍 Joia, 📦 Volume e 💤 Peso morto, pelas margens mínima e alvo da loja.', C],
    ], []],
    ['precos', 'Produtos', 'Preços', 'Reajustes de custo e de venda de cada produto e o efeito.', 'Admin, franqueado e gerente com a tela', [
      ['Perderam margem', 'Produtos cujo custo subiu mais que o preço.', C],
      ['Custo alterado e venda alterada', 'Produtos com reajuste no período dos filtros.', C],
      ['Caixa ≠ sistema', 'Produtos vendidos no caixa por um preço diferente do cadastro.'],
    ], []],
    ['site', 'Produtos', 'Site', 'Preços do e-commerce comparados com os da loja. Consulta todo dia às 10h.', 'Admin, franqueado e gerente com a tela', [
      ['Produtos no site', 'Produtos do e-commerce ligados aos da loja.'],
      ['Em promoção no site', 'Com preço promocional hoje.'],
      ['Preço diferente', 'Preço do site diferente do preço da loja.'],
      ['Mudou em', 'Escolha um dia para ver só o que mudou nele.'],
    ], []],
    ['estoque', 'Estoque', 'Estoque', 'O que falta, o que sobra e o dinheiro parado.', 'Admin, franqueado e gerente com a tela', [
      ['Perdendo por falta', 'Quanto a loja deixa de vender por dia com produtos zerados que vendiam.'],
      ['Para repor', 'Produtos abaixo do mínimo.'],
      ['Estoque a custo', 'Valor do estoque, com o parado e o que sobra.', C],
      ['Abas', 'O que repor, Perdendo venda, Parados, Sobrando, Com saldo e Todos.'],
      ['Fora de linha', 'Indisponível no site de pedidos há 90 dias ou mais: liquidar.'],
    ], []],
    ['validade', 'Estoque', 'Validade', 'Lotes, datas e o que vence primeiro.', 'Toda a equipe (gerente com a tela)', [
      ['Lotes por validade', 'Lotes vencidos, vencendo em 30 dias e o resto.'],
      ['Chá aberto', 'Vale 6 meses a partir da abertura. Pacote fechado: a validade do pacote.'],
      ['Abas', 'Chá a granel, Envasados e Alimentação.'],
      ['Valor em risco', 'Valor a custo do que vence em breve.', C],
    ], [
      ['Abri um pacote hoje. Como registro?', 'No nome do chá, "Abrir lote".'],
    ]],
    ['pedido', 'Estoque', 'Pedido', 'O pedido sugerido para a franquia e o robô que monta o carrinho no Sistema de Pedidos.', 'Admin, franqueado e gerente com a tela', [
      ['Seu pedido desta semana', 'O valor do pedido com a barra do limite.', C],
      ['Tudo que precisa', 'O que a loja precisa para os próximos dias, pelo ritmo de venda.'],
      ['Compras × teto', 'Quanto ainda cabe de compras no mês.', C],
      ['Abas', 'Carrinho completo, Pedido obrigatório, Complemento, Verificar e Site de pedidos completo.'],
      ['Montar carrinho no site', 'O robô só coloca no carrinho; quem finaliza o pedido é você, no site.'],
    ], []],
    ['notas', 'Estoque', 'Notas de entrada', 'Notas de entrada do AppNext: produtos, quantidades, valores e o que mudou no custo.', 'Admin, franqueado e gerente com a tela', [
      ['Lote e validade', 'Digitados na chegada; validade curta mostra "Incluir na devolução".'],
      ['Sincronizar agora', 'Busca no AppNext o estoque e as notas de entrada da loja (leva alguns minutos). Admin, franqueado e a gerente com esta tela.'],
      ['Custo subiu', 'Produtos mais caros que na compra anterior.', C],
      ['Devolução', 'Itens quebrados, faltando ou com validade curta, direto da nota.'],
    ], []],
    ['nfsaida', 'Estoque', 'Notas de saída', 'NF-e emitidas pela loja (vendas com nota, transferências, devoluções), com o XML e o DANFE.', 'Admin, franqueado e gerente com a tela', [
      ['Situação', 'Rascunho, autorizada ou cancelada.'],
      ['Emitir', 'O robô conclui e homologa a NF-e só depois da revisão.'],
    ], []],
    ['creditos', 'Estoque', 'Créditos com a franquia', 'Cada devolução e onde ela foi descontada.', 'Admin, franqueado e gerente com a tela', [
      ['A receber, atrasado', 'Devoluções sem desconto há mais tempo que o combinado.'],
      ['A receber, no prazo', 'Devoluções que ainda podem vir no próximo desconto.'],
      ['Já compensado', 'Descontadas numa nota de compra ou nos royalties.'],
    ], []],
    ['inventario', 'Estoque', 'Inventário', 'Conte o estoque pelo celular ou pelo computador e envie para o AppNext.', 'Toda a equipe (gerente com a tela)', [
      ['Itens contados', 'Quantos itens a contagem já tem.'],
      ['Com diferença', 'Itens em que a contagem difere do sistema.'],
      ['Faltou', 'Valor a custo do que faltou.', C],
    ], []],
    ['sugestoes', 'Estoque', '⭐ Sugestões', 'Marque com uma estrela o produto que você quer no próximo pedido.', 'Toda a equipe (gerente com a tela)', [
      ['Situação', 'Tem, pouco ou acabou.'],
      ['Resposta', 'Quem faz o pedido decide; a resposta aparece aqui.'],
    ], []],
    ['dre', 'Resultado', 'Resultado (DRE)', 'A DRE da loja mês a mês: da receita bruta ao resultado líquido.', 'Admin, franqueado e gerente com a tela', [
      ['Receita bruta', 'Vendas pelo preço cheio (Loja e Espaço Gourmet). A taxa de serviço aparece à parte e fica fora.'],
      ['Receita líquida', 'Receita bruta − descontos − Simples. Os % das linhas são sobre ela.'],
      ['CMV', 'Com as fotos do estoque: estoque inicial + compras − estoque final. Sem elas: custo do que foi vendido + perdas conhecidas.', C],
      ['Perdas e acertos', 'A diferença entre o CMV pelo estoque e o custo do que foi vendido.', C],
      ['Compras', 'Notas de compra concluídas no AppNext com entrada no mês (não a emissão), a custo, abertas em "Da franquia (TSB)" e "Outros fornecedores". O ⓘ lista cada nota que entrou e as que ficaram fora, com o porquê. Só aparece com o mês fechado.', C],
      ['Margem de contribuição', 'Lucro bruto − despesas variáveis.', C],
      ['Resultado líquido', 'Margem de contribuição − despesas fixas ± resultado financeiro.', C],
      ['✎ Valor real do mês', 'Toque no valor de uma despesa para lançar o valor real daquele mês.', C],
    ], [
      ['A receita bruta é maior que o faturamento do Resumo. Por quê?', 'A receita bruta é o preço cheio; tirando os descontos, chega ao faturamento do Resumo.'],
      ['Por que as compras do mês em andamento aparecem com "—"?', 'A conta pelo estoque precisa da foto do estoque do fim do mês. Até a virada, o CMV é o custo do que foi vendido + as perdas conhecidas.', C],
      ['A devolução entra na conta?', 'Não é descontada no CMV: o crédito dela volta uma vez, nos royalties ou no desconto da nota.', C],
    ]],
    ['config', 'Configurações', 'Configurações', 'Lojas, usuários, mensagens, metas e os acessos da loja.', 'Só admin e franqueado', [
      ['Configuração guiada', 'Os acessos que faltam para a loja, passo a passo.'],
      ['Usuários', 'Quem entra no painel e quais telas cada um vê.'],
      ['Dados e atualização', 'Quando os dados chegaram e o botão para atualizar agora.'],
      ['Metas', 'Uma tabela por ano: a meta de cada mês, de onde vem (digitada, automática ou padrão), as vendas da meta e o % atingido, a mesma conta da Evolução mensal. Digite na linha do mês para mudar só aquele mês.'],
    ], []],
  ].map(([pag, grupo, nome, serve, quem, nums, perg]) => ({ pag, grupo, nome, serve, quem, nums, perg }));

  /** perguntas frequentes: `pags` = aparece para quem tem alguma dessas telas (vazio = para todos) */
  const FAQ = [
    { p: 'O faturamento do Resumo e a receita bruta do Resultado são diferentes. Por quê?', r: 'São o mesmo dinheiro. A receita bruta é o preço cheio; tirando os descontos dados no caixa, chega ao faturamento do Resumo. A conta aparece embaixo do faturamento.', pags: ['resumo', 'dre'] },
    { p: 'Por que a comparação com o ano passado muda de uma tela para outra?', r: 'Com um mês inteiro no filtro, as telas comparam com o mesmo mês do ano passado inteiro. Em outros períodos, com os mesmos dias da semana do ano passado (sábado com sábado). Toque na comparação para ver as datas.', pags: ['resumo', 'comparativos', 'dre'] },
    { p: 'O que entra na meta e o que entra no faturamento?', r: 'Vendas da meta: chás e acessórios, sem o Espaço Gourmet. Faturamento: tudo o que a loja vendeu, com o Espaço Gourmet, sem a taxa de serviço e sem itens a R$ 0,01.', pags: ['inicio', 'resumo', 'comissionamento', 'minha'] },
    { p: 'Os números estão atualizados?', r: 'A pílula ao lado do título do Início diz até quando chegaram as vendas. Amarela ou vermelha: os números podem estar velhos; toque nela para ver o motivo.', pags: ['inicio'] },
    { p: 'O que é o ⓘ ao lado dos números?', r: 'A explicação daquele número: o que é, de onde vem e a conta. O ⓘ ao lado do título da tela abre a ajuda da tela.', pags: [] },
    { p: 'Por que não vejo uma tela que outra pessoa vê?', r: 'Cada pessoa vê as telas liberadas para ela em Configurações → Usuários.', pags: [] },
  ];

  const API = { FICHAS, FAQ, C };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }

  // ======================= tela =======================
  const { h } = TS;
  const A = (TS.ajuda = API);
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const veCusto = () => !!(TS.demo || (TS.eu && TS.eu.pode && TS.eu.pode.custos && TS.eu.perfil !== 'vendedor'));
  const paginas = () => new Set(TS.paginas ? TS.paginas() : []);
  /** as fichas que a pessoa vê (só as telas do menu dela), sem as linhas de custo para quem não vê custo */
  A.fichas = function () {
    const ps = paginas(), c = veCusto();
    return FICHAS.filter((f) => ps.has(f.pag)).map((f) => ({ ...f, nums: f.nums.filter((x) => c || x[2] !== C), perg: f.perg.filter((x) => c || x[2] !== C) }));
  };
  A.faq = function () { const ps = paginas(); return FAQ.filter((q) => !q.pags.length || q.pags.some((p) => ps.has(p))); };
  A.ficha = (pag) => A.fichas().find((f) => f.pag === pag) || null;

  let camada = null;
  function fechar() {
    if (!camada) return;
    camada.remove(); camada = null;
    if (!document.querySelector('.camada-cheia')) document.body.classList.remove('com-camada');
    document.removeEventListener('keydown', esc);
  }
  const esc = (e) => { if (e.key === 'Escape') fechar(); };
  const chev = () => h('span', { class: 'aj-chev', 'aria-hidden': 'true' }, '›');
  const pergunta = (p, r, aberta) => h('details', { class: 'aj-faq', open: aberta || null }, h('summary', null, h('span', null, p), chev()), h('p', null, r));

  /** abre a ajuda: sem página = a lista; com página = a ficha dela (o "‹" fecha e volta para a tela) */
  A.abrir = function (pag) {
    fechar();
    const corpo = h('div', { class: 'aj-corpo' });
    const fecharBt = h('button', { type: 'button', class: 'icon-btn aj-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar a ajuda', onclick: fechar }, '✕');
    const painel = h('div', { class: 'aj-painel' }, fecharBt, corpo);
    camada = h('div', { class: 'camada-cheia aj-camada', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ajuda', onclick: (e) => { if (e.target === camada) fechar(); } }, painel);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', esc);
    const f = pag ? A.ficha(pag) : null;
    if (f) mostrarFicha(corpo, f, true); else mostrarLista(corpo);
    painel.focus && painel.setAttribute('tabindex', '-1');
    painel.focus && painel.focus();
  };

  function linhaTela(f, aoAbrir) {
    return h('button', { type: 'button', class: 'aj-row', onclick: aoAbrir }, h('span', { class: 'aj-row-t' }, h('b', null, f.nome), h('span', null, f.serve)), chev());
  }

  function mostrarLista(corpo, busca = '') {
    const fichas = A.fichas(), faq = A.faq();
    const campo = h('input', { type: 'search', class: 'aj-busca-in', placeholder: 'Procurar na ajuda (ex.: meta)', 'aria-label': 'Procurar na ajuda', value: busca });
    const res = h('div', { class: 'aj-res' });
    const abrirFicha = (f) => () => { mostrarFicha(corpo, f, false, campo.value); corpo.closest('.aj-painel').scrollTop = 0; };
    const pintar = () => {
      const q = semAcento(campo.value.trim());
      if (!q) {
        const grupos = [];
        for (const f of fichas) { let g = grupos.find((x) => x[0] === f.grupo); if (!g) grupos.push((g = [f.grupo, []])); g[1].push(f); }
        res.replaceChildren(...[
          faq.length ? TS.cardSec('Perguntas frequentes', {}, ...faq.map((x, i) => pergunta(x.p, x.r, i === 0))) : null,
          TS.cardSec('Telas', { sub: `${fichas.length} ${fichas.length === 1 ? 'tela' : 'telas'} · toque para ver os números e as perguntas` },
            h('div', { class: 'aj-grupos' }, ...grupos.map(([g, fs]) => h('section', { class: 'aj-grupo' }, h('div', { class: 'aj-g' }, g), ...fs.map((f) => linhaTela(f, abrirFicha(f))))))),
        ].filter(Boolean));
        return;
      }
      const casa = (...t) => semAcento(t.join(' ')).includes(q);
      const qs = faq.filter((x) => casa(x.p, x.r));
      const fs = fichas.filter((f) => casa(f.nome, f.serve, f.grupo, ...f.nums.flat(), ...f.perg.flat()));
      res.replaceChildren(...[
        !qs.length && !fs.length ? TS.cardSec('Nada encontrado', {}, h('p', { class: 'muted' }, 'Tente outra palavra, como "meta", "desconto" ou o nome da tela.')) : null,
        qs.length ? TS.cardSec('Perguntas', {}, ...qs.map((x) => pergunta(x.p, x.r, qs.length === 1))) : null,
        fs.length ? TS.cardSec('Telas', { sub: `${fs.length} ${fs.length === 1 ? 'tela fala' : 'telas falam'} disso` }, h('div', { class: 'aj-lista1' }, ...fs.map((f) => linhaTela(f, abrirFicha(f))))) : null,
      ].filter(Boolean));
    };
    campo.addEventListener('input', pintar);
    corpo.replaceChildren(
      h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Ajuda'), h('div', { class: 'page-sub' }, 'O que cada tela mostra e como cada número é calculado.'))),
      h('div', { class: 'aj-busca' }, h('span', { class: 'aj-lupa', 'aria-hidden': 'true' }, '⌕'), campo), res);
    pintar();
    if (busca) campo.focus();
  }

  /** a ficha de uma tela; daTela = aberta pelo ⓘ do título (o "‹" fecha e volta para a tela) */
  function mostrarFicha(corpo, f, daTela, busca) {
    const voltar = daTela
      ? h('button', { type: 'button', class: 'aj-voltar', onclick: fechar }, '‹ Voltar para a tela')
      : h('button', { type: 'button', class: 'aj-voltar', onclick: () => mostrarLista(corpo, busca || '') }, '‹ Ajuda');
    const irTela = TS.state && TS.state.page === f.pag && daTela ? null
      : h('a', { href: '#' + f.pag, class: 'link-btn', onclick: () => fechar() }, 'Abrir a tela ›');
    corpo.replaceChildren(...[
      voltar,
      h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, f.nome), h('div', { class: 'page-sub' }, f.serve))),
      h('div', { class: 'aj-meta' }, ...[h('span', null, f.grupo), h('span', null, f.quem), irTela, daTela ? h('button', { type: 'button', class: 'link-btn', onclick: () => mostrarLista(corpo) }, 'Toda a ajuda ›') : null].filter(Boolean)),
      f.nums.length ? TS.cardSec('Os números', {}, ...f.nums.map(([n, d]) => h('div', { class: 'aj-num' }, h('b', null, n), h('span', null, d)))) : null,
      f.perg.length ? TS.cardSec('Perguntas', {}, ...f.perg.map(([p, r]) => pergunta(p, r))) : null,
    ].filter(Boolean));
  }

  /** ⓘ ao lado do título da tela: abre a ficha dela por cima (chamado pelo main.js depois de cada desenho) */
  A.marcarTitulo = function (content, pag) {
    const t = content && content.querySelector('.page-title');
    if (!t || t.querySelector('.aj-q') || !A.ficha(pag)) return;
    t.append(h('button', { type: 'button', class: 'aj-q', 'data-pag': pag, title: 'Ajuda desta tela: os números e as perguntas', 'aria-label': 'Ajuda desta tela', onclick: (e) => { e.preventDefault(); A.abrir(pag); } })); // o "?" vem do CSS: o texto do título não muda
  };

  /** tela que se redesenha sozinha (ex.: Indicadores quando os clientes chegam) também ganha o ?: observa o conteúdo */
  let obs = null;
  function observar() {
    const content = document.getElementById('content');
    if (!content || obs || typeof MutationObserver === 'undefined') return;
    let agendado = false;
    obs = new MutationObserver(() => {
      if (agendado) return;
      agendado = true;
      requestAnimationFrame(() => { agendado = false; if (TS.state) A.marcarTitulo(content, TS.state.page); });
    });
    obs.observe(content, { childList: true, subtree: true });
  }

  A.iniciar = function () {
    observar();
    const b = document.getElementById('btnAjuda');
    if (b && !b._ligado) { b._ligado = true; b.addEventListener('click', () => { const pop = document.getElementById('userPop'); if (pop) pop.hidden = true; A.abrir(); }); }
  };
})();
