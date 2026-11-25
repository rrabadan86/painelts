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
  // grupos do AppNext dos chás envasados (TEA MOMENTS e FOREST FRIENDLY TEAS entram como CHÁS ENVASADOS nas vendas): definição
  // única, usada também por src/tipoprod.js (validade e unidade)
  const GRUPO_ENVASADO = /ENVASAD|TEA\s*MOMENTS?|FOREST\s*FRIENDLY/i;
  /** parte da receita da LOJA no Resultado (pedido do dono, 25/11/2026; RES-PARTES-01), pelo grupo com que o produto sai na venda:
   *  'granel' (os grupos de chá do "Chá vendido", CHA_TOTAL) · 'envasado' · 'acess' (ACESSÓRIOS) · 'outros' (o resto) */
  function parteLoja(grupo) {
    const g = String(grupo || '').trim();
    if (GRUPO_ENVASADO.test(g)) return 'envasado';
    if (CHA_SET.has(g)) return 'granel';
    if (/^ACESS[OÓ]RIOS?$/i.test(g)) return 'acess';
    return 'outros';
  }
  const PARTES_LOJA = [['granel', 'Chás a granel'], ['envasado', 'Envasados'], ['acess', 'Acessórios'], ['outros', 'Outros']];
  /** categoria das despesas que acompanham as vendas no Resultado (aprovado pelo dono, 25/11/2026; DESP-CAT-01): Simples, maquininha e
   *  comissões escolhem uma das categorias da loja ou Impostos / Taxas e tarifas; royalties e marketing ficam sempre em Franquia;
   *  os custos em % usam a categoria deles. As mesmas categorias agrupam os custos fixos, no bloco de baixo. */
  const CAT_VAR_PADRAO = { simples: 'impostos', cartao: 'taxas', comissao: 'func' };
  const CAT_EXTRAS = [{ id: 'impostos', nome: 'Impostos' }, { id: 'taxas', nome: 'Taxas e tarifas' }];
  const CAT_FRANQUIA = { id: 'franquia', nome: 'Franquia' };
  /** categorias que Simples, maquininha e comissões podem escolher: as da loja + Impostos e Taxas (quando a loja não tem igual) */
  const catsEscolha = (cats) => [...(cats || []), ...CAT_EXTRAS.filter((e) => !(cats || []).some((c) => c.id === e.id))];
  /** catVar da loja completo: o salvo ou o padrão; categoria que deixou de existir volta ao padrão (comissão sem "func": Outros) */
  function catVarDe(catVar, cats) {
    const ok = new Set(catsEscolha(cats).map((c) => c.id));
    const out = {};
    for (const [k, pad] of Object.entries(CAT_VAR_PADRAO)) {
      const v = catVar && catVar[k];
      out[k] = v && ok.has(v) ? v : ok.has(pad) ? pad : k === 'comissao' ? 'outros' : pad;
    }
    return out;
  }
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

  /**
   * Custo fixo de um mês (pedido do dono, 23/11/2026: "a despesa fixa acaba variando; manter o histórico com exatidão").
   * O valor de Configurações é o PADRÃO (estimativa): vale para todo mês sem valor lançado — inclusive os meses passados,
   * que acompanham o padrão quando ele muda. O valor REAL lançado no Resultado para um mês fica fixo naquele mês.
   *   despesa  { nome, valor } (custo em R$ por mês de Configurações)
   *   lancados { '<nome>': { 'AAAA-MM': { valor, por, em } } } (dados/<loja>/fixos-mes.json, src/fixosmes.js)
   * → { valor, padrao, lancado: { valor, por, em } | null }  (DRE-MES-01)
   */
  function fixoDoMes(despesa, ym, lancados) {
    const meses = lancados && despesa && lancados[despesa.nome];
    // padrão daquele mês: o de Configurações ou, se o padrão mudou "daquele mês em diante", o que valia na época (FIXO-ESC-01)
    const ep = padraoDaEpoca(meses, ym);
    const padrao = ep ? ep.valor : +(despesa && despesa.valor) || 0;
    const l = meses && meses[ym];
    const e = ep ? { epoca: ep } : {};
    return l && Number.isFinite(+l.valor) && +l.valor >= 0 ? { valor: +l.valor, padrao, lancado: l, ...e } : { valor: padrao, padrao, lancado: null, ...e };
  }
  /** padrões antigos de um custo: [{ ate: 'AAAA-MM', valor }] — o valor que valia até aquele mês (o primeiro com ate ≥ ym) */
  function padraoDaEpoca(meses, ym) {
    const lista = meses && Array.isArray(meses[EPOCAS]) ? meses[EPOCAS] : [];
    let melhor = null;
    for (const e of lista) if (e && e.ate >= ym && Number.isFinite(+e.valor) && +e.valor >= 0 && (!melhor || e.ate < melhor.ate)) melhor = e;
    return melhor ? { ate: melhor.ate, valor: +melhor.valor } : null;
  }
  const EPOCAS = '@ate';
  /**
   * % (ou fator) de uma linha calculada num mês (PCT-ESC-01, pedido do dono de 25/11/2026: "deve ser possível em todos"):
   * o que valia na época ('@ate', depois de um "daqui para frente") ou o atual — o de Configurações (`padrao`) ou, nos royalties e
   * marketing (fator sobre os % das regras), o guardado em '@padrao'. chave: '@simples', '@maquininha', '@royalties', '@marketing'
   * ou o nome do custo em %.
   */
  function pctDoMes(chave, ym, padrao, lancados) {
    const meses = lancados && lancados[chave];
    const ep = padraoDaEpoca(meses, ym);
    if (ep) return ep.valor;
    return meses && Number.isFinite(+meses['@padrao']) ? +meses['@padrao'] : padrao;
  }
  const YM_RE = /^\d{4}-\d{2}$/;
  const ymMenos1 = (ym) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 1)); return d.toISOString().slice(0, 7); };
  /**
   * Novo valor de um custo fixo, perguntando onde vale (pedido do dono, 25/11/2026; FIXO-ESC-01):
   *   'mes'    só aquele mês (o valor real lançado; os outros meses não mudam)
   *   'diante' daquele mês em diante: o padrão passa a ser o novo valor; os meses antes ficam com o padrão que valia
   *            (guardado em '@ate') e os valores lançados daquele mês em diante dão lugar ao novo
   *   'todos'  todos os meses: o padrão passa a ser o novo valor, sem padrões antigos nem valores lançados
   * despesa { nome, valor } (valor = padrão de Configurações hoje); lancados = fixosMes da loja (não é alterado).
   * → { lancados (cópia nova), padrao (novo valor de Configurações), mudam: ['AAAA-MM'...] entre os meses dados }
   */
  function aplicarFixo(despesa, lancados, ym, valor, escopo, mesesVer) {
    const nome = despesa.nome;
    const novo = JSON.parse(JSON.stringify(lancados || {}));
    const antes = (m) => fixoDoMes(despesa, m, lancados).valor;
    let padrao = +despesa.valor || 0;
    const meses = novo[nome] || {};
    if (escopo === 'mes') meses[ym] = { valor };
    else if (escopo === 'diante') {
      const ateAntes = ymMenos1(ym);
      const valeAntes = (padraoDaEpoca(meses, ateAntes) || { valor: padrao }).valor;
      const epocas = (Array.isArray(meses[EPOCAS]) ? meses[EPOCAS] : []).filter((e) => e && e.ate < ym);
      if (valeAntes !== valor && !epocas.some((e) => e.ate === ateAntes)) epocas.push({ ate: ateAntes, valor: valeAntes });
      epocas.sort((a, b) => (a.ate < b.ate ? -1 : 1));
      for (const k of Object.keys(meses)) if (YM_RE.test(k) && k >= ym) delete meses[k];
      if (epocas.length) meses[EPOCAS] = epocas; else delete meses[EPOCAS];
      padrao = valor;
    } else if (escopo === 'todos') {
      for (const k of Object.keys(meses)) delete meses[k];
      padrao = valor;
    } else throw new Error('Escolha onde o novo valor vale.');
    if (Object.keys(meses).length) novo[nome] = meses; else delete novo[nome];
    const depois = { ...despesa, valor: padrao };
    const mudam = (mesesVer || []).filter((m) => Math.abs(fixoDoMes(depois, m, novo).valor - antes(m)) > 0.004);
    return { lancados: novo, padrao, mudam };
  }
  /** histórico de um custo fixo nos meses dados: [{ ym, valor, lancado }] e a média (DRE-MES-02) */
  function historicoFixo(despesa, meses, lancados) {
    const itens = (meses || []).map((ym) => { const f = fixoDoMes(despesa, ym, lancados); return { ym, valor: f.valor, lancado: f.lancado }; });
    return { itens, media: itens.length ? itens.reduce((a, x) => a + x.valor, 0) / itens.length : null, nLancados: itens.filter((x) => x.lancado).length };
  }

  const API = { EG, GRUPOS_META, CHA_TOTAL, GRUPO_ENVASADO, parteLoja, PARTES_LOJA, CAT_VAR_PADRAO, CAT_EXTRAS, CAT_FRANQUIA, catsEscolha, catVarDe, TAXAS, PISO_DIAS_META, MIN_ATEND_PREMIACAO, ehTaxa, ehCentavo, contaFat, classeMeta, semItem, resumo, projecaoMes, metasIndividuais, divisoresMeta, pontoEquilibrio, fixoDoMes, historicoFixo, aplicarFixo, padraoDaEpoca, pctDoMes, diaDe, isoDe, diasNoMes };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  TS.contas = API;
})();
