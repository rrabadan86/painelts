/* Contas oficiais do painel: UMA definição por indicador, usada pelas telas (TS.contas) e pelo servidor
 * (require em src/indicadores.js). Arquivo de conta pura: não toca na página nem em TS.db.
 *
 * - Faturamento da loja = tudo o que foi vendido, COM Espaço Gourmet e COM vendas sem vendedor, SEM as linhas de taxa
 *   (serviço e entrega) e SEM itens a R$ 0,01 (resgates do programa de pontos e brindes). É a conta do Resultado.
 * - Vendas da meta = só os grupos que contam para a meta e a comissão (chá aromatizado, chá puro e acessórios), sem Espaço Gourmet.
 * - Atendimentos = cupons únicos (cupom + loja + dia). Linha de taxa ou a R$ 0,01 não é venda: não conta item nem atendimento.
 * - TKM = faturamento ÷ atendimentos; PMA = faturamento ÷ itens; IPA = itens ÷ atendimentos, sempre na mesma base.
 * - Chá vendido (kg) = todos os tipos de chá, inclusive o amarelo.
 * - Projeção do mês: vendas até o último dia completo + o que falta estimado pela média de cada dia da semana (8 semanas).
 * - Quem divide a meta da loja: quem tem pelo menos N dias com venda no mês (piso proporcional no mês em andamento). */
(function () {
  'use strict';
  const EG = 'ESPAÇO GOURMET';
  const GRUPOS_META = {
    arom: ['CHÁ AROMATIZADO', 'CHÁS ENVASADOS', 'INFUSÕES', 'ROOIBOS AROMATIZADO', 'SACHÊS PIRAMIDAIS', 'TEA MOMENTS'],
    puro: ['CHÁ PURO', 'CHÁS ENVASADOS PUROS'],
    acess: ['ACESSÓRIOS', 'ALIMENTAÇÃO', 'CONSUMÍVEIS - COM CONTROLE DE ESTOQUE', 'COSMÉTICOS'],
  };
  const CLASSE = new Map(Object.entries(GRUPOS_META).flatMap(([k, gs]) => gs.map((g) => [g, k])));
  // grupos (coluna Grupo) que somam no "Chá vendido (kg)": os mesmos do gráfico por tipo, com o chá amarelo
  const CHA_TOTAL = ['CHÁS PARA MINITINS', 'ROOIBOS PURO', 'ROOIBOS AROMATIZADO', 'CHÁ BRANCO PURO', 'CHÁ BRANCO AROMATIZADO', 'INFUSÕES', 'CHÁ OOLONG PURO', 'CHÁ OOLONG AROMATIZADO',
    'CHÁ PRETO PURO', 'CHÁ PRETO AROMATIZADO', 'CHÁ VERDE PURO', 'CHÁ VERDE AROMATIZADO', 'CHÁ VERMELHO PURO', 'CHÁ VERMELHO AROMATIZADO', 'CHÁ AMARELO PURO', 'CHÁ AMARELO'];
  const CHA_SET = new Set(CHA_TOTAL);
  const TAXAS = ['Taxa de Serviço', 'Taxa Delivery'];
  const nrm = (s) => String(s == null ? '' : s).trim().toLowerCase();
  const TAXAS_N = new Set(TAXAS.map(nrm));

  /** linha de taxa (serviço ou entrega): não é venda */
  const ehTaxa = (descricao) => TAXAS_N.has(nrm(descricao));
  /** item a R$ 0,01 (resgate do programa de pontos ou brinde): não é venda */
  const ehCentavo = (vu) => vu != null && Math.abs(vu - 0.01) < 1e-7;
  /** a linha entra no faturamento da loja? */
  const contaFat = (descricao, vu) => !ehTaxa(descricao) && !ehCentavo(vu);
  /** 'arom' | 'puro' | 'acess' quando a linha conta para a meta e a comissão; null quando não conta (Espaço Gourmet e outros grupos) */
  const classeMeta = (grupoC, cat) => (cat === EG ? null : CLASSE.get(grupoC) || null);
  /** "CONSUMÍVEIS - SEM CONTROLE DE ESTOQUE" (ex.: sacos de amostra) entra no faturamento, mas não conta como item */
  const semItem = (grupoC) => /^CONSUM[IÍ]VEIS\b.*SEM CONTROLE/i.test(String(grupoC || '').trim());

  /**
   * Indicadores oficiais de uma lista de vendas (linhas como o servidor guarda:
   * { data, cupom, loja, descricao, vu, vt, qtd, qtdCha, grupo, grupoC, cat }).
   * fat = faturamento da loja; vendasMeta = base da meta e da comissão.
   */
  function resumo(linhas) {
    let fat = 0, itens = 0, kg = 0, eg = 0, arom = 0, puro = 0, acess = 0;
    const cupons = new Set();
    for (const v of linhas || []) {
      if (!contaFat(v.descricao, v.vu)) continue;
      const x = v.vt || 0;
      fat += x;
      itens += semItem(v.grupoC || v.grupo) ? 0 : v.qtd || 0;
      cupons.add((v.data || '') + '|' + v.cupom + '|' + v.loja);
      if (CHA_SET.has(v.grupo)) kg += v.qtdCha || 0;
      if (v.grupoC === EG) eg += x;
      const c = classeMeta(v.grupoC, v.cat);
      if (c === 'arom') arom += x; else if (c === 'puro') puro += x; else if (c === 'acess') acess += x;
    }
    const c = cupons.size, vendasMeta = arom + puro + acess;
    return { fat, vendasMeta, arom, puro, acess, eg, cupons: c, itens, kg, tkm: c ? fat / c : null, pma: itens ? fat / itens : null, ipa: c ? itens / c : null };
  }

  // ---------- datas (texto AAAA-MM-DD) ----------
  const DIA = 86400000;
  const diaDe = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DIA);
  const isoDe = (d) => new Date(d * DIA).toISOString().slice(0, 10);
  const diasNoMes = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  const semanaDe = (d) => new Date(d * DIA).getUTCDay(); // 0 = domingo

  /**
   * Projeção do mês — a mesma em todas as telas e no servidor.
   *   ym        mês ('AAAA-MM')
   *   ate       último dia COMPLETO com vendas (AAAA-MM-DD): o dia em andamento fica de fora e é mostrado à parte por quem chama
   *   valorDia  (iso) → vendas do dia (0 quando não vendeu)
   *   aberto    (iso) → a loja abre nesse dia? (dia fechado ou feriado fechado conta zero); sem a função, todo dia é aberto
   *   inicio    primeiro dia com vendas no histórico (AAAA-MM-DD); sem ele, considera 8 semanas de histórico
   * Regra: vendas do dia 1 até `ate` + para cada dia que falta, a média do mesmo dia da semana nas últimas 8 semanas
   * (até `ate`; dia sem venda entra como zero). Com menos de 4 semanas de histórico: média simples por dia de loja aberta.
   * → { proj, realizado, estimado, ate, feitos, n, faltam, restantes, metodo: 'semana' | 'simples', medias[7] (0 = domingo),
   *     mediaSimples, fechado } — fechado = o mês já acabou (proj = realizado). proj = null quando não há histórico nenhum.
   */
  function projecaoMes({ ym, ate, valorDia, aberto, inicio }) {
    const n = diasNoMes(ym), ini = diaDe(ym + '-01'), fim = ini + n - 1;
    const abre = (d) => (aberto ? !!aberto(isoDe(d)) : true);
    const val = (d) => +valorDia(isoDe(d)) || 0;
    const A = diaDe(ate);
    const a = Math.min(A, fim); // último dia completo dentro do mês (antes do dia 1 = nenhum)
    let realizado = 0;
    for (let d = ini; d <= a; d++) realizado += val(d);
    const feitos = Math.max(0, a - ini + 1);
    const base = { ym, n, ate: a >= ini ? isoDe(a) : null, feitos, realizado, faltam: Math.max(0, fim - Math.max(a, ini - 1)), medias: null, mediaSimples: null, restantes: 0, estimado: 0 };
    if (A >= fim) return { ...base, proj: realizado, metodo: null, fechado: true };
    const I0 = inicio ? diaDe(inicio) : A - 55;
    if (I0 > A) return { ...base, proj: null, metodo: null, fechado: false };
    const semanas = Math.floor((A - I0 + 1) / 7);
    const metodo = semanas >= 4 ? 'semana' : 'simples';
    const medias = [0, 0, 0, 0, 0, 0, 0];
    let mediaSimples = 0;
    if (metodo === 'semana') {
      for (let w = 0; w < 7; w++) {
        let d = A; while (semanaDe(d) !== w) d--;
        let s = 0, k = 0;
        for (; k < 8 && d >= I0; k++, d -= 7) s += val(d);
        medias[w] = k ? s / k : 0;
      }
    } else {
      let s = 0, k = 0;
      for (let d = Math.max(I0, A - 55); d <= A; d++) { if (!abre(d)) continue; s += val(d); k++; }
      mediaSimples = k ? s / k : 0;
    }
    let estimado = 0, restantes = 0;
    for (let d = Math.max(a + 1, ini); d <= fim; d++) {
      if (!abre(d)) continue;
      restantes++;
      estimado += metodo === 'semana' ? medias[semanaDe(d)] : mediaSimples;
    }
    return { ...base, proj: realizado + estimado, estimado, restantes, metodo, medias: metodo === 'semana' ? medias : null, mediaSimples: metodo === 'simples' ? mediaSimples : null, semanas: Math.min(8, semanas), fechado: false };
  }

  /**
   * Meta individual com férias: meta diária (meta ÷ dias do mês) dividida, em cada dia, só entre quem está trabalhando.
   * Sem férias no mês = meta ÷ quantidade de pessoas. nomes: quem divide a meta.
   * → { metas: Map(NOME EM MAIÚSCULAS → meta), feriasMes }
   */
  function metasIndividuais(metaLoja, ym, nomes, ferias) {
    const out = new Map();
    const N = (nomes || []).map((x) => String(x).trim().toUpperCase());
    if (!N.length) return { metas: out, feriasMes: [] };
    if (!ym) { N.forEach((x) => out.set(x, metaLoja / N.length)); return { metas: out, feriasMes: [] }; }
    const nDias = diasNoMes(ym);
    const ini = ym + '-01', fim = `${ym}-${String(nDias).padStart(2, '0')}`;
    const fm = (ferias || []).filter((f) => f.de <= fim && f.ate >= ini && N.includes(String(f.vendedor).trim().toUpperCase()));
    if (!fm.length) { N.forEach((x) => out.set(x, metaLoja / N.length)); return { metas: out, feriasMes: [] }; }
    const diaria = metaLoja / nDias;
    N.forEach((x) => out.set(x, 0));
    for (let d = 1; d <= nDias; d++) {
      const iso = `${ym}-${String(d).padStart(2, '0')}`;
      const fora = new Set(fm.filter((f) => f.de <= iso && f.ate >= iso).map((f) => String(f.vendedor).trim().toUpperCase()));
      const ativos = N.filter((x) => !fora.has(x));
      if (!ativos.length) continue;
      ativos.forEach((x) => out.set(x, out.get(x) + diaria / ativos.length));
    }
    return { metas: out, feriasMes: fm };
  }

  const PISO_DIAS_META = 4;
  /**
   * Quem divide a meta da loja: quem tem pelo menos `piso` dias com venda no mês (padrão 4; 1 = qualquer venda).
   * Mês em andamento: o piso acompanha os dias corridos — até o dia 7 todos com venda dividem; depois vale
   * piso × dia do mês ÷ dias do mês, arredondado para baixo (mínimo 1). Mês fechado: o piso inteiro.
   *   dias       [[nome, nº de dias com venda], …] (só quem pode ter meta individual)
   *   ultimoDia  último dia considerado (AAAA-MM-DD): o último com vendas, ou o fim do período escolhido
   * → { piso, pisoAplicado, fechado, dia, dentro: [nome], fora: [{ nome, dias }], todosAbaixo }
   * Se ninguém alcança o piso, todos com venda dividem (a meta nunca fica sem divisor).
   */
  /* sempre: quem tem férias lançadas no mês — é da equipe (não é folguista), então divide a meta mesmo abaixo do piso;
     a meta dela já é proporcional aos dias trabalhados (metasIndividuais) */
  function divisoresMeta({ dias, piso, ym, ultimoDia, sempre }) {
    const S = new Set(sempre || []);
    const P = Math.max(1, Math.round(+piso) || PISO_DIAS_META);
    const lista = [...(dias || [])].filter(([, k]) => k > 0);
    let aplicado = P, fechado = true, dia = null;
    if (ym && ultimoDia) {
      const n = diasNoMes(ym), fim = `${ym}-${String(n).padStart(2, '0')}`;
      fechado = ultimoDia >= fim;
      dia = fechado ? n : ultimoDia < ym + '-01' ? 0 : +ultimoDia.slice(8, 10);
      if (!fechado) aplicado = dia <= 7 ? 1 : Math.max(1, Math.floor((P * dia) / n));
    }
    let dentro = lista.filter(([x, k]) => k >= aplicado || S.has(x)).map(([x]) => x);
    let fora = lista.filter(([x, k]) => k < aplicado && !S.has(x)).map(([x, k]) => ({ nome: x, dias: k }));
    const todosAbaixo = !dentro.length && lista.length > 0;
    if (todosAbaixo) { dentro = lista.map(([x]) => x); fora = []; }
    return { piso: P, pisoAplicado: aplicado, fechado, dia, dentro, fora, todosAbaixo, porFerias: lista.filter(([x, k]) => k < aplicado && S.has(x)).map(([x]) => x) };
  }

  const MIN_ATEND_PREMIACAO = 20;

  /**
   * Ponto de equilíbrio do mês: quanto a loja precisa vender para pagar os custos fixos do mês — os de todo mês MAIS as
   * despesas só deste mês (IPTU, 13º…), as mesmas que o Resultado soma. margem = margem de contribuição (0 a 1).
   * → { fixos, pontuais, total, equilibrio } (equilibrio = null sem margem positiva)
   */
  function pontoEquilibrio({ fixos, pontuais, margem }) {
    const soma = (l) => (l || []).reduce((a, x) => a + (+x.valor || 0), 0);
    const f = soma(fixos), p = soma(pontuais), total = f + p;
    return { fixos: f, pontuais: p, total, equilibrio: margem > 0 ? total / margem : null };
  }

  const API = { EG, GRUPOS_META, CHA_TOTAL, TAXAS, PISO_DIAS_META, MIN_ATEND_PREMIACAO, ehTaxa, ehCentavo, contaFat, classeMeta, semItem, resumo, projecaoMes, metasIndividuais, divisoresMeta, pontoEquilibrio, diaDe, isoDe, diasNoMes };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  TS.contas = API;
})();
