'use strict';
/**
 * O que o painel manda para a IA: instruções, ferramentas e a conferência das mensagens.
 * As ferramentas de "Pergunte ao painel" rodam NO NAVEGADOR (public/js/ia.js), sobre os dados que a pessoa já
 * pode ver: o servidor só decide quais ferramentas oferecer conforme o perfil (clientes, custos).
 */

const PERIODO = {
  type: 'object',
  description: 'Período. Use de/ate (AAAA-MM-DD) OU ultimos_dias (termina no último dia com vendas). Sem período = últimos 30 dias.',
  properties: { de: { type: 'string' }, ate: { type: 'string' }, ultimos_dias: { type: 'integer', minimum: 1, maximum: 1500 } },
};
const FILTROS = {
  type: 'object',
  description: 'Filtros opcionais. Nomes como aparecem no painel (use listar_valores para achar o nome certo). Produto = texto contido no nome.',
  properties: {
    lojas: { type: 'array', items: { type: 'string' } }, vendedores: { type: 'array', items: { type: 'string' } },
    grupos: { type: 'array', items: { type: 'string' } }, categorias: { type: 'array', items: { type: 'string' } }, produto: { type: 'string' },
  },
};

function ferramentas({ clientes, custos }) {
  const t = [
    {
      name: 'consultar_vendas',
      description: 'Soma as vendas do painel (cupons fiscais). Devolve faturamento (R$), itens, atendimentos (cupons), ticket médio, itens por atendimento, kg de chá e desconto, '
        + 'no total e por grupo. "SEM VENDEDOR" e Espaço Gourmet entram como estão nos dados. Para comparar períodos, chame uma vez por período.'
        + (custos ? ' Com incluir_lucro=true devolve também custo, lucro bruto e margem bruta.' : ''),
      input_schema: {
        type: 'object',
        properties: {
          periodo: PERIODO, filtros: FILTROS,
          agrupar_por: { type: 'string', enum: ['nenhum', 'dia', 'semana', 'mes', 'ano', 'dia_semana', 'hora', 'loja', 'vendedor', 'grupo', 'categoria', 'produto'] },
          ordenar_por: { type: 'string', enum: ['chave', 'faturamento', 'itens', 'cupons', 'kg_cha'], description: 'Padrão: chave para tempo, faturamento para o resto.' },
          limite: { type: 'integer', minimum: 1, maximum: 100, description: 'Máximo de grupos (padrão 30).' },
          ...(custos ? { incluir_lucro: { type: 'boolean' } } : {}),
        },
      },
    },
    {
      name: 'listar_valores',
      description: 'Lista os nomes existentes nos dados (lojas, vendedores, grupos, categorias ou produtos), para usar nos filtros. Busca opcional por texto.',
      input_schema: { type: 'object', properties: { campo: { type: 'string', enum: ['lojas', 'vendedores', 'grupos', 'categorias', 'produtos'] }, busca: { type: 'string' } }, required: ['campo'] },
    },
  ];
  if (clientes) {
    t.push({
      name: 'consultar_clientes',
      description: 'Clientes identificados por CPF nas compras. Devolve quantos passam no filtro e uma lista com primeiro nome + inicial, gasto em 12 meses, número de compras, '
        + 'última compra, dias sem comprar, chá favorito, cidade e o grupo de comportamento (RFM). Não devolve CPF, telefone nem e-mail. '
        + 'A tela mostra um botão para abrir a lista completa no painel.',
      input_schema: {
        type: 'object',
        properties: {
          sem_comprar_ha_dias_min: { type: 'integer' }, sem_comprar_ha_dias_max: { type: 'integer' }, gasto_12m_min: { type: 'number' }, compras_min: { type: 'integer' },
          segmento: { type: 'string', enum: ['vip', 'fiel', 'sumido', 'novo', 'uma_compra', 'hora_de_repor', 'aniversario', 'pontos_vencendo'] },
          cha: { type: 'string', description: 'Texto no nome do chá favorito.' }, cidade: { type: 'string' },
          ordenar_por: { type: 'string', enum: ['gasto_12m', 'ultima_compra', 'compras', 'dias_sem_comprar'] },
          limite: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    });
  }
  if (custos) {
    t.push({
      name: 'consultar_estoque',
      description: 'Estoque atual da loja escolhida (lido do AppNext): quantidade, venda média por dia nos últimos 30 dias, para quantos dias dá (cobertura), custo e valor parado em estoque.',
      input_schema: {
        type: 'object',
        properties: {
          busca: { type: 'string', description: 'Texto no nome ou código.' }, cobertura_max_dias: { type: 'number', description: 'Só o que acaba antes disso.' },
          sem_venda_30d: { type: 'boolean', description: 'Só o que não vendeu nada em 30 dias (estoque parado).' },
          ordenar_por: { type: 'string', enum: ['cobertura', 'valor_estoque', 'venda_dia', 'produto'] }, limite: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    });
  }
  t.push({
    name: 'mostrar_grafico',
    description: 'Desenha um gráfico na resposta (use quando ajudar: evolução no tempo = linha; comparação entre poucos itens = barra). Os valores vêm das consultas.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['barra', 'linha'] }, titulo: { type: 'string' }, rotulos: { type: 'array', items: { type: 'string' }, maxItems: 60 },
        series: { type: 'array', maxItems: 5, items: { type: 'object', properties: { nome: { type: 'string' }, valores: { type: 'array', items: { type: ['number', 'null'] }, maxItems: 60 } }, required: ['nome', 'valores'] } },
        formato: { type: 'string', enum: ['moeda', 'numero', 'percentual'] },
      },
      required: ['tipo', 'rotulos', 'series'],
    },
  });
  // cache: as ferramentas e as instruções são iguais em toda a conversa
  t[t.length - 1].cache_control = { type: 'ephemeral' };
  return t;
}

const limpa = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, n);

function sistemaPergunta(ctx, { clientes, custos, perfil }) {
  const c = ctx || {};
  return [
    'Você é o assistente do painel de vendas de lojas Tea Shop (franquia de chás) no Brasil. Responda em português do Brasil, direto e curto, como um analista que conhece a loja.',
    'Regras:',
    '- Todo número vem das ferramentas. Nunca invente, estime de cabeça nem arredonde de forma que mude o sentido. Se os dados não permitem responder, diga o que falta.',
    '- Diga sempre o período que usou (ex.: "de 01/10 a 31/10"). Datas no formato DD/MM/AAAA; dinheiro em R$ com vírgula decimal.',
    '- Comparações: faça as duas consultas e mostre a variação em %. Mês corrente está incompleto: compare com o mesmo número de dias do outro período quando fizer sentido.',
    '- Termine com 1 ou 2 sugestões práticas só quando os números apontarem algo claro.',
    '- Use mostrar_grafico quando uma evolução ou comparação ficar mais clara em gráfico. Não repita no texto todos os números do gráfico.',
    '- Formato: Markdown simples (negrito, listas, tabelas pequenas). Sem títulos grandes.',
    clientes ? '- Dados de clientes: use só o primeiro nome. Nunca peça nem mostre CPF, telefone ou e-mail.' : '- Esta pessoa não vê dados de clientes: se perguntarem, diga que o perfil dela não tem acesso.',
    custos ? '' : '- Esta pessoa não vê custo, margem nem estoque: se perguntarem, diga que o perfil dela não tem acesso.',
    '- Não altere nada em sistema nenhum: você só consulta.',
    '',
    `Hoje: ${limpa(c.hoje, 10)} (${limpa(c.diaSemana, 15)}). Perfil de quem pergunta: ${limpa(perfil, 15)}.`,
    `Loja escolhida no painel: ${limpa(c.loja, 80)}. Lojas nos dados: ${(c.lojas || []).slice(0, 30).map((x) => limpa(x, 60)).join(', ')}.`,
    `Vendas disponíveis de ${limpa(c.desde, 10)} a ${limpa(c.ate, 10)}${c.parcial ? ' (histórico parcial carregado no painel)' : ''}.`,
    c.meta ? `Meta do mês da loja: ${limpa(c.meta, 60)}.` : '',
  ].filter((x) => x !== '').join('\n');
}

/** confere as mensagens que vêm do navegador (formato da API; tamanho limitado) */
function conferirMensagens(ms) {
  if (!Array.isArray(ms) || !ms.length || ms.length > 80) return 'Conversa inválida (tamanho).';
  if (JSON.stringify(ms).length > 400000) return 'A conversa ficou longa demais: clique em "Nova conversa".';
  for (let k = 0; k < ms.length; k++) {
    const m = ms[k];
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return `Conversa inválida (mensagem ${k + 1}).`;
    if ((k % 2 === 0) !== (m.role === 'user')) return `Conversa inválida (ordem na mensagem ${k + 1}).`;
    if (typeof m.content === 'string') {
      if (m.role === 'user' && (!m.content.trim() || m.content.length > 4000)) return 'Pergunta vazia ou longa demais.';
      continue;
    }
    if (!Array.isArray(m.content) || !m.content.length) return `Conversa inválida (mensagem ${k + 1} vazia).`;
    for (const b of m.content) {
      if (!b || typeof b.type !== 'string') return `Conversa inválida (bloco na mensagem ${k + 1}).`;
      // do navegador só sai texto e resultado das consultas; o que a IA devolveu (texto, ferramenta, raciocínio…) volta como veio
      if (m.role === 'user' && !['text', 'tool_result'].includes(b.type)) return `Conversa inválida (bloco ${b.type}).`;
      if (b.type === 'tool_result' && (typeof b.content !== 'string' || b.content.length > 60000)) return 'Resultado de consulta grande demais.';
    }
  }
  return null;
}

// ---------- revisão do pedido ----------
const FERR_PEDIDO = {
  name: 'revisar_pedido',
  description: 'Entrega a revisão do pedido sugerido.',
  input_schema: {
    type: 'object',
    properties: {
      resumo: { type: 'string', description: '2 a 4 frases: o pedido faz sentido? o que mais pesa?' },
      alertas: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'Riscos concretos (validade, estoque parado, ruptura de produto que vende muito, data comemorativa).' },
      ajustes: {
        type: 'array', maxItems: 20,
        items: {
          type: 'object',
          properties: { cod: { type: 'string' }, qtd: { type: 'number', description: 'Nova quantidade a pedir (na unidade do item; granel em kg inteiro; respeite o múltiplo).' }, motivo: { type: 'string', description: 'Uma frase, com o número que justifica.' } },
          required: ['cod', 'qtd', 'motivo'],
        },
      },
    },
    required: ['resumo', 'alertas', 'ajustes'],
  },
};

const SISTEMA_PEDIDO = [
  'Você revisa o pedido de reposição de uma loja Tea Shop (franquia de chás) para a franqueadora. Responda em português do Brasil.',
  'O painel já calculou o pedido sugerido: previsão de venda por dia × (dias de entrega + dias até o próximo pedido) − estoque, dentro de um limite de valor (o CMV), priorizando quem dá mais lucro.',
  'Seu papel é o olhar de um comprador experiente sobre o que a conta não vê:',
  '- sazonalidade: compare a venda dos próximos 30 dias do ano passado com os últimos 30 dias do ano passado (campo sazonal) e com a tendência recente (vd30 × vd90);',
  '- validade: não peça mais do que vence em breve (campo vence);',
  '- clientes esperando (espera) e produtos Estrela sem estoque são prioridade; Peso morto com estoque alto não deve ser pedido;',
  '- itens sem venda há muito tempo, estoque parado, quantidades estranhas (unidade errada).',
  'Proponha no máximo 20 ajustes, só os que mudam o resultado; explique cada um com o número que justifica. Mantenha o total perto do limite: se aumentar algo, diga o que reduzir.',
  'Granel (un = Kg) só em kg inteiro; respeite o múltiplo de compra (mult). Use só códigos (cod) que estão na lista. Se o pedido estiver bom, diga isso e proponha poucos ou nenhum ajuste.',
  'Entregue chamando a ferramenta revisar_pedido.',
].join('\n');


// ---------- por que as vendas mudaram (Início) ----------
const FERR_DIAG = {
  name: 'diagnostico',
  description: 'Entrega a explicação para o Início do painel.',
  input_schema: {
    type: 'object',
    properties: {
      manchete: { type: 'string', description: 'Uma frase com o principal (ex.: "A semana caiu 12% porque vieram menos clientes; quem veio comprou igual.").' },
      explicacoes: {
        type: 'array', maxItems: 4,
        items: { type: 'object', properties: { titulo: { type: 'string' }, porque: { type: 'string', description: '1 a 3 frases com os números que explicam.' }, o_que_fazer: { type: 'string', description: 'Uma ação prática e concreta (opcional).' } }, required: ['titulo', 'porque'] },
      },
      fora_do_padrao: {
        type: 'array', maxItems: 5,
        items: { type: 'object', properties: { titulo: { type: 'string' }, detalhe: { type: 'string' } }, required: ['titulo'] },
      },
    },
    required: ['manchete', 'explicacoes', 'fora_do_padrao'],
  },
};
const SISTEMA_DIAG = [
  'Você é o analista de uma loja Tea Shop (franquia de chás) no Brasil e escreve o "porquê" do Início do painel, em português do Brasil, curto e direto.',
  'Recebe: a comparação dos últimos 7 dias com a média das 4 semanas anteriores, do mês até agora com o mês anterior e com o ano passado (mesmos dias),',
  'cada uma com a diferença em R$ explicada por: movimento (número de atendimentos), itens por atendimento e preço médio por item; e por onde mudou (grupos, vendedoras, dias da semana).',
  'Recebe também o que está fora do padrão (cupons com desconto alto, vendedora com desconto médio alto, dias muito abaixo do normal, inventário com ajuste grande) e os avisos que a tela já mostra.',
  'Regras:',
  '- Use só os números recebidos; não invente. Dinheiro em R$ sem centavos, porcentagem com no máximo 1 casa.',
  '- Explique a CAUSA: "o movimento está igual, o que caiu foi o ticket: menos itens por atendimento" é o tipo de frase que ajuda. Diga qual parte pesa mais.',
  '- Não repita o texto dos avisos: explique o que está por trás deles ou como se ligam.',
  '- Fora do padrão: diga por que chama atenção e o que conferir, sem acusar ninguém ("vale conferir", "pode ser…").',
  '- Se está tudo bem, diga isso na manchete e traga só o que vale acompanhar. No máximo 4 explicações.',
  '- A ação sugerida precisa ser concreta e possível numa loja (ex.: oferecer o 2º item, revisar a escala do sábado, conferir o cupom X com a vendedora).',
  'Entregue chamando a ferramenta diagnostico.',
].join('\n');

module.exports = { FERR_DIAG, SISTEMA_DIAG, ferramentas, sistemaPergunta, conferirMensagens, FERR_PEDIDO, SISTEMA_PEDIDO };
