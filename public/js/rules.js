/* Regras de negócio — tradução das medidas DAX do relatório Power BI */
'use strict';
(function () {
  const LOJA_VILA = 'SÃO PAULO - TEA SHOP VILA MADALENA';
  const LOJA_GOIANIA = 'GOIANIA - TEA SHOP FLAMBOYANT';
  const LOJA_TORRES = 'TORRES - TEA SHOP TORRES';
  const EG = 'ESPAÇO GOURMET';
  const TAXA_SERVICO = 'Taxa de Serviço';

  // os grupos que contam para a meta (chá aromatizado, chá puro, acessórios) e os que somam no kg de chá ficam em
  // public/js/contas.js (TS.contas): a mesma lista vale para as telas e para o servidor
  // vendedores que não recebem meta individual (comparação sem diferenciar maiúsculas, como no DAX)
  const SEM_META = ['amanda oliveira', 'corporativo', 'adriane puccini', 'sem vendedor'];

  // tipos de chá (medidas Qtd Chá X) — por [Grupo]
  const TIPOS_CHA = [
    ['Infusões', ['INFUSÕES']],
    ['Rooibos', ['ROOIBOS PURO', 'ROOIBOS AROMATIZADO']],
    ['Branco', ['CHÁ BRANCO PURO', 'CHÁ BRANCO AROMATIZADO']],
    ['Oolong', ['CHÁ OOLONG PURO', 'CHÁ OOLONG AROMATIZADO']],
    ['Preto', ['CHÁ PRETO PURO', 'CHÁ PRETO AROMATIZADO']],
    ['Verde', ['CHÁ VERDE PURO', 'CHÁ VERDE AROMATIZADO']],
    ['Vermelho', ['CHÁ VERMELHO PURO', 'CHÁ VERMELHO AROMATIZADO']],
    ['Amarelo', ['CHÁ AMARELO PURO', 'CHÁ AMARELO']],
  ];
  // categorias usadas no "mix" (% aromatizado / % puro) e nos gráficos de kg
  const CAT_AROM_PCT = ['Chás aromatizados, Chás, Rooibos e Infusões Aromatizados, LOJA', 'Chás aromatizados, Chás Envasados Aromatizados, LOJA', 'Chás aromatizados, LOJA, SACHÊS PIRAMIDAIS'];
  const CAT_PURO_PCT = ['Chás Envasados Puros, Chás Puros, LOJA', 'Chás Puros, Chás, Rooibos e Infusões Puros, LOJA'];
  const CAT_CHA_KG = ['Chás aromatizados, Chás, Rooibos e Infusões Aromatizados, LOJA', 'Chás Puros, Chás, Rooibos e Infusões Puros, LOJA'];

  const R = (TS.rules = { LOJA_VILA, LOJA_GOIANIA, LOJA_TORRES, EG, TAXA_SERVICO, TIPOS_CHA, CAT_CHA_KG });

  // ---------- regras de comissão por loja (configuráveis em Configurações → Lojas) ----------
  // modelos = regras que estavam no relatório original; cada loja parte de um e pode ajustar
  const PADRAO = {
    divisaoMeta: { arom: 0.55, puro: 0.15, acess: 0.30 },
    comissao: { modo: 'faixas', arom: { acima120: 0.05, bate: 0.04, abaixo: 0.02 }, puro: { acima120: 0.06, bate: 0.05, abaixo: 0.025 }, acess: { acima120: 0.025, bate: 0.02, abaixo: 0.01 } },
    // minAtend: mínimo de atendimentos no mês para concorrer à premiação (com poucos cupons o TKM/IPA/PMA é sorte)
    premiacao: { ativa: true, valor: 50, tkm: 260, ipa: 3, pma: 86.66, minimo: 2, minAtend: 20 },
    // divide a meta da loja quem tem pelo menos N dias com venda no mês (1 = qualquer venda, como era antes)
    pisoDiasMeta: 4,
    bonus: { abaixo: 0.005, bate: 0.01, acima120: 0.015 },
    rateio: { ativo: false, exclui: [] },
    gorjeta: { modo: 'proporcional', percentual: 0.8 },
    royalties: { loja: 0.06, mkt: 0.02, eg: 0.02, egMkt: 0.02 },
    semMeta: ['amanda oliveira', 'corporativo', 'adriane puccini'],
    semComissao: [], // vendedores que não recebem comissão (nem premiação)
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fundir = (a, b) => {
    const out = clone(a);
    for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? fundir(out[k], v) : v;
    return out;
  };
  R.MODELOS = {
    padrao: { nome: 'Padrão da rede', regras: PADRAO },
    torres: { nome: 'Torres', regras: fundir(PADRAO, { bonus: { abaixo: 0.01, bate: 0.01, acima120: 0.01 }, gorjeta: { modo: 'igual', percentual: 1 }, royalties: { loja: 0.04 } }) },
    vila: { nome: 'Vila Madalena', regras: fundir(PADRAO, {
      comissao: { modo: 'simples', arom: { acima120: 0.05, bate: 0.05, abaixo: 0.04 }, puro: { acima120: 0.06, bate: 0.06, abaixo: 0.05 }, acess: { acima120: 0.025, bate: 0.025, abaixo: 0.02 } },
      premiacao: { ativa: false }, rateio: { ativo: true, exclui: ['adriane puccini'] }, gorjeta: { modo: 'proporcional', percentual: 1 },
    }) },
    goiania: { nome: 'Goiânia', regras: fundir(PADRAO, { divisaoMeta: { arom: 0.55, puro: 0.10, acess: 0.35 } }) },
  };
  R.fundir = fundir;
  const modeloPorNome = (nome) => (nome === LOJA_TORRES ? 'torres' : nome === LOJA_VILA ? 'vila' : nome === LOJA_GOIANIA ? 'goiania' : 'padrao');
  R.modeloPorNome = modeloPorNome;
  /** regras efetivas de uma loja (pelo nome que aparece nas vendas) */
  R.regrasDe = function (nomeLoja) {
    const cfg = nomeLoja && TS.db && (TS.db.metas || []).find((m) => (m.nomesVenda || []).includes(nomeLoja));
    const r = cfg && cfg.regras;
    const modelo = (r && R.MODELOS[r.modelo]) ? r.modelo : modeloPorNome(nomeLoja);
    return r ? fundir(R.MODELOS[modelo].regras, r) : R.MODELOS[modelo].regras;
  };

  /** Converte listas de textos em conjuntos de ids do dicionário */
  R.prepare = function () {
    const D = TS.db.D;
    const ids = (field, list, ci = false) => {
      const s = new Set();
      const want = ci ? list.map((x) => x.toLowerCase()) : list;
      D[field].forEach((t, i) => { if ((ci ? want.includes(t.toLowerCase()) : want.includes(t))) s.add(i); });
      return s;
    };
    const GM = TS.contas.GRUPOS_META;
    R.ids = {
      arom: ids('grupoC', GM.arom), puro: ids('grupoC', GM.puro), acess: ids('grupoC', GM.acess),
      semMeta: ids('vendedor', [...new Set([...SEM_META, 'sem vendedor', ...(TS.db.metas || []).flatMap((m) => (m.regras && m.regras.semMeta) || [])])], true),
      semVendedor: ids('vendedor', ['SEM VENDEDOR', ''], true),
      excluiComparativos: ids('vendedor', ['', 'Adriane Puccini', 'SEM VENDEDOR'], true),
      excluiVila: ids('vendedor', ['SEM VENDEDOR', 'ADRIANE PUCCINI'], true),
      eg: ids('cat', [EG]),
      egGrupoC: ids('grupoC', [EG]),
      taxaServico: ids('descricao', [TAXA_SERVICO]),
      taxas: new Set(D.descricao.map((t, i) => (TS.contas.ehTaxa(t) ? i : -1)).filter((i) => i >= 0)),
      tipos: TIPOS_CHA.map(([n, gs]) => [n, ids('grupo', gs)]),
      chaTotal: ids('grupo', TS.contas.CHA_TOTAL),
      catAromPct: ids('cat', CAT_AROM_PCT),
      catPuroPct: ids('cat', CAT_PURO_PCT),
      grupoAcessPct: ids('grupo', ['ACESSÓRIOS', 'ALIMENTAÇÃO']),
      catChaKg: ids('cat', CAT_CHA_KG),
      grupoAcessQtd: ids('grupo', ['ACESSÓRIOS', 'ALIMENTAÇÃO']),
      lojaVila: ids('loja', [LOJA_VILA]), lojaGoiania: ids('loja', [LOJA_GOIANIA]), lojaTorres: ids('loja', [LOJA_TORRES]),
    };
  };

  const lojaNome = (id) => (id == null ? null : TS.db.D.loja[id]);

  /** [ChaAromatizado], [ChaPuro], [Acessorio] e [Total] */
  R.mix = function (idx) {
    const db = TS.db, I = R.ids;
    let arom = 0, puro = 0, acess = 0, nA = 0, nP = 0, nC = 0;
    for (const i of idx) {
      if (!TS.contaFat(i)) continue; // linha de taxa e item a R$ 0,01 não são venda (definição única)
      const g = db.grupoC[i], v = db.vt[i] || 0;
      if (I.arom.has(g)) { arom += v; nA++; } else if (I.puro.has(g)) { puro += v; nP++; } else if (I.acess.has(g)) { acess += v; nC++; }
    }
    const tem = nA + nP + nC > 0;
    return { arom, puro, acess, total: arom + puro + acess, tem };
  };
  /** "Vendas da meta": só os grupos que contam para a meta e a comissão (chá aromatizado, chá puro e acessórios),
   *  sem Espaço Gourmet — a base do "% da meta" em todas as telas (a mesma do Comissionamento) */
  R.semEG = (idx) => idx.filter((i) => !R.ids.eg.has(TS.db.cat[i]));
  R.vendasMeta = (idx) => R.mix(R.semEG(idx)).total;

  // ---------- comissões ($) ----------
  /** faixas: ≥120% da meta / ≥100% / abaixo; modo "simples": bateu ou não bateu */
  function comissao(valor, meta, modo, f) {
    // sem meta cadastrada (0, vazia) não existe "bateu a meta": vale a taxa mínima
    if (!(meta > 0)) return valor * f.abaixo;
    if (modo === 'simples') return valor >= meta ? valor * f.bate : valor * f.abaixo;
    if (valor >= meta * 1.2) return valor * f.acima120;
    if (valor >= meta) return valor * f.bate;
    return valor * f.abaixo;
  }

  R.comissaoFaixa = comissao;
  /** alíquota do bônus sobre os outros vendedores; sem meta da loja (> 0) fica na menor faixa */
  R.aliquotaBonus = function (totLoja, metaLoja, bonus) {
    if (!(metaLoja > 0)) return bonus.abaixo;
    return totLoja >= metaLoja * 1.2 ? bonus.acima120 : totLoja >= metaLoja ? bonus.bate : bonus.abaixo;
  };

  /** mínimo de atendimentos no mês para concorrer à premiação (regras da loja; padrão 20; 0 = sem mínimo) */
  R.minAtendPremiacao = (rg) => { const v = rg && rg.premiacao && rg.premiacao.minAtend; return v == null ? TS.contas.MIN_ATEND_PREMIACAO : Math.max(0, +v || 0); };
  /** poucos atendimentos para concorrer à premiação? */
  R.poucosAtend = (ind, rg) => !!(rg && rg.premiacao && rg.premiacao.ativa) && (ind.cupons || 0) < R.minAtendPremiacao(rg);
  /** [PremiacaoFuncionario] — só concorre quem tem o mínimo de atendimentos no mês */
  R.premiacao = function (ind, rg) {
    const p = rg.premiacao;
    if (!p || !p.ativa) return 0;
    if (R.poucosAtend(ind, rg)) return 0;
    const tkm = ind.tkm >= p.tkm ? p.valor : 0, ipa = ind.ipa >= p.ipa ? p.valor : 0, pma = ind.pma >= p.pma ? p.valor : 0;
    const ok = (tkm > 0) + (ipa > 0) + (pma > 0);
    return ok >= p.minimo ? tkm + ipa + pma : 0;
  };

  /** Loja do contexto: só existe quando há exatamente uma (como SELECTEDVALUE) */
  function lojaUnica(idx) {
    const db = TS.db;
    let l = null;
    for (const i of idx) {
      if (l === null) l = db.loja[i];
      else if (l !== db.loja[i]) return null;
    }
    return lojaNome(l);
  }
  R.lojaUnica = lojaUnica;

  /**
   * Página Comissionamento — tabela principal.
   * base: vendas com todos os filtros; baseSemVend: idem, sem o filtro de vendedor.
   * O visual do Power BI exclui a categoria ESPAÇO GOURMET.
   */
  /** férias cadastradas para a loja (pelo nome nas vendas) */
  R.feriasDe = function (nomeLoja) {
    const cfg = nomeLoja && TS.db && (TS.db.metas || []).find((m) => (m.nomesVenda || []).includes(nomeLoja));
    return (cfg && cfg.ferias) || [];
  };
  /**
   * Meta individual com férias: meta diária (meta ÷ dias do mês) dividida, em cada dia, só entre quem
   * está trabalhando. Sem férias no mês = meta ÷ quantidade de vendedores.
   * nomes: vendedores que dividem a meta; devolve Map(nomeMaiúsculo → meta) e as férias do mês.
   */
  R.metasIndividuais = (metaLoja, ym, nomes, ferias) => TS.contas.metasIndividuais(metaLoja, ym, nomes, ferias);

  /** vendedores sem meta individual da loja (lista configurada nas regras + "sem vendedor") */
  const semMetaDe = (rg) => new Set([...((rg && rg.semMeta) || []), 'sem vendedor', ''].map((x) => String(x).trim().toLowerCase()));
  R.semMetaDe = semMetaDe;

  /**
   * ate: último dia considerado (dia do painel) — define o piso de quem divide a meta no mês em andamento; sem ele, o
   *      último dia com vendas (ou o fim do mês, se já fechou).
   * projFator: multiplica as vendas de cada pessoa antes de achar a faixa (comissão do mês PROJETADO, usada no Resultado).
   */
  R.comissionamento = function ({ base, baseSemVend, metaLoja, vendBonus, ym, ate, projFator }) {
    const db = TS.db, I = R.ids;
    const K = projFator > 0 ? projFator : 1;
    const semEG = (idx) => idx.filter((i) => !I.eg.has(db.cat[i]));
    const b = semEG(base), bAll = semEG(baseSemVend);
    const nomeV = (v) => String(db.D.vendedor[v] || '').trim().toLowerCase();
    // regras da loja do contexto (a lista "sem meta" e o rateio são da loja, não da rede inteira)
    const lojaCtx = lojaUnica(bAll.length ? bAll : b);
    const rgCtx = R.regrasDe(lojaCtx);
    const SM = semMetaDe(rgCtx);
    const semMeta = (v) => SM.has(nomeV(v));

    // quem divide a meta: quem tem pelo menos N dias com venda no mês (regras da loja → pisoDiasMeta; padrão 4).
    // Quem fica abaixo do piso não aumenta o número de divisores, mas continua com a comissão pela faixa
    // (a venda dela contra a meta individual dos demais).
    const diasVenda = new Map();
    for (const i of bAll) {
      if (!((db.vt[i] || 0) > 0) || semMeta(db.vend[i])) continue;
      let s = diasVenda.get(db.vend[i]);
      if (!s) diasVenda.set(db.vend[i], (s = new Set()));
      s.add(db.day[i]);
    }
    let ultimoDia = null;
    if (ym) {
      const fimMes = TS.isoToDay(`${ym}-${String(TS.contas.diasNoMes(ym)).padStart(2, '0')}`);
      // mês que já acabou (pelo calendário ou pelas vendas): vale o piso inteiro, ou o fim do período escolhido
      const lim = Math.min(ate ?? fimMes, fimMes);
      const mesAcabou = Math.max(db.maxDay, TS.todayDay() - 1) >= fimMes;
      ultimoDia = TS.dayToIso(mesAcabou ? lim : Math.min(lim, db.maxDay));
    }
    // quem tem férias lançadas no mês divide a meta mesmo abaixo do piso (decisão do dono): é da equipe, não folguista
    const comFerias = new Set();
    if (ym && lojaCtx) {
      const ini = ym + '-01', fim = `${ym}-${String(TS.contas.diasNoMes(ym)).padStart(2, '0')}`;
      const nomes = new Set(R.feriasDe(lojaCtx).filter((f) => f.de <= fim && f.ate >= ini).map((f) => String(f.vendedor).trim().toUpperCase()));
      for (const v of diasVenda.keys()) if (nomes.has(String(db.D.vendedor[v] || '').trim().toUpperCase())) comFerias.add(v);
    }
    const div = TS.contas.divisoresMeta({ dias: [...diasVenda].map(([v, s]) => [v, s.size]), piso: rgCtx.pisoDiasMeta, ym: ym || null, ultimoDia, sempre: comFerias });
    const elegiveis = new Set(div.dentro);
    const qtdVend = elegiveis.size;

    // calcula TODOS os vendedores (o rateio precisa do total da loja) e depois mostra só os do filtro
    const porVend = TS.agrupar(bAll, (i) => db.vend[i]);
    const noFiltro = new Set(b.map((i) => db.vend[i]));
    const vendBonusId = vendBonus === '' ? null : db.D.vendedor.indexOf(vendBonus);
    const mInd = R.metasIndividuais(metaLoja, ym || '', [...elegiveis].map((v) => db.D.vendedor[v]), lojaCtx ? R.feriasDe(lojaCtx) : []);

    const todas = [];
    for (const [v, idx] of porVend) {
      const m = R.mix(idx);
      if (!m.tem) continue; // visual filtra [Total] em branco
      if (K !== 1) { m.arom *= K; m.puro *= K; m.acess *= K; m.total *= K; }
      const loja = lojaUnica(idx);
      const rg = R.regrasDe(loja);
      const mi = semMeta(v) ? 0 : (mInd.metas.get(String(db.D.vendedor[v]).trim().toUpperCase()) ?? (qtdVend ? metaLoja / qtdVend : 0));
      const metaArom = mi * rg.divisaoMeta.arom;
      const metaPuro = mi * rg.divisaoMeta.puro;
      const metaAcess = mi * rg.divisaoMeta.acess;
      const cm = rg.comissao;
      // sem meta individual: recebe a comissão mínima (taxa "abaixo da meta") sobre o que vendeu;
      // em "Não recebem comissão": não recebe comissão nem premiação
      const SC = new Set((rg.semComissao || []).map((x) => String(x).trim().toLowerCase()));
      const naoRecebe = SC.has(nomeV(v));
      const comV = (valor, meta, f) => (naoRecebe ? 0 : semMeta(v) ? valor * f.abaixo : comissao(valor, meta, cm.modo, f));
      const cArom = comV(m.arom, metaArom, cm.arom);
      const cPuro = comV(m.puro, metaPuro, cm.puro);
      const cAcess = comV(m.acess, metaAcess, cm.acess);
      const ind = TS.indicadores(idx);
      // no mês projetado (projFator) os atendimentos também crescem: o mínimo é conferido com os projetados
      const indP = K !== 1 ? { ...ind, cupons: (ind.cupons || 0) * K } : ind;
      const prem = naoRecebe ? 0 : R.premiacao(indP, rg);
      const poucos = !naoRecebe && R.poucosAtend(indP, rg);

      // [BonusSobreOutrosVendedores] — só na linha do vendedor escolhido
      let bonus = null;
      if (vendBonusId !== null && v === vendBonusId) {
        const lojaId = loja == null ? null : db.D.loja.indexOf(loja);
        // FAIXA do bônus: a mesma base do "% da meta" (só as vendas da meta: chá aromatizado, chá puro e acessórios) — o quadro
        // e a faixa não podem discordar. VALOR pago: continua sobre as vendas dos outros vendedores da loja como sempre foi
        // (tudo menos a taxa de serviço): mudar a base paga é decisão do dono, não correção.
        let metaLojaVend = 0, totLoja = 0, totVend = 0;
        if (lojaId !== null) {
          for (const i of bAll) {
            if (db.loja[i] !== lojaId) continue;
            const g = db.grupoC[i], vt = (db.vt[i] || 0) * K;
            if (I.arom.has(g) || I.puro.has(g) || I.acess.has(g)) metaLojaVend += vt;
            if (I.taxaServico.has(db.desc[i])) continue;
            totLoja += vt;
            if (db.vend[i] === v) totVend += vt;
          }
        }
        const aliq = R.aliquotaBonus(metaLojaVend, metaLoja, rg.bonus);
        bonus = Math.max(0, totLoja - totVend) * aliq;
      }
      todas.push({
        vendedorId: v, vendedor: db.D.vendedor[v] || '(sem nome)', loja,
        metaInd: mi, total: m.total, semMeta: semMeta(v), naoRecebe,
        divide: elegiveis.has(v), diasVenda: (diasVenda.get(v) || { size: 0 }).size, atend: ind.cupons, poucosAtend: poucos,
        metaArom, arom: m.arom, cArom, metaPuro, puro: m.puro, cPuro, metaAcess, acess: m.acess, cAcess,
        tkm: ind.tkm, pma: ind.pma, ipa: ind.ipa, premiacao: prem, bonus,
        base: cArom + cPuro + cAcess + (bonus || 0),
      });
    }

    // [TotalAPagar] — rateio: o total de comissões da loja dividido igualmente entre quem recebe
    if (rgCtx.rateio && rgCtx.rateio.ativo) {
      const exclui = new Set((rgCtx.rateio.exclui || []).map((x) => String(x).trim().toLowerCase()));
      const SCc = new Set((rgCtx.semComissao || []).map((x) => String(x).trim().toLowerCase()));
      const fora = (v) => I.semVendedor.has(v) || exclui.has(nomeV(v)) || SCc.has(nomeV(v));
      const montante = todas.reduce((s, r) => s + r.base + r.premiacao, 0);
      // só quem aparece na tabela: assim a soma do que cada um recebe é igual ao montante
      const recebedores = todas.filter((r) => !fora(r.vendedorId)).length;
      todas.forEach((r) => { r.aPagar = fora(r.vendedorId) ? 0 : (recebedores ? montante / recebedores : 0); });
    } else {
      todas.forEach((r) => { r.aPagar = r.base; });
    }
    const rows = todas.filter((r) => noFiltro.has(r.vendedorId));
    const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
    const total = {
      vendedor: 'Total', metaInd: metaLoja, total: sum('total'), arom: sum('arom'), cArom: sum('cArom'), puro: sum('puro'), cPuro: sum('cPuro'),
      acess: sum('acess'), cAcess: sum('cAcess'), premiacao: sum('premiacao'), bonus: sum('bonus'), aPagar: sum('aPagar'),
      metaArom: metaLoja * rgCtx.divisaoMeta.arom, metaPuro: metaLoja * rgCtx.divisaoMeta.puro, metaAcess: metaLoja * rgCtx.divisaoMeta.acess,
      ...(() => { const ind = TS.indicadores(b); return { tkm: ind.tkm, pma: ind.pma, ipa: ind.ipa }; })(),
    };
    // quem ficou fora da divisão da meta e por quê (só nomes que aparecem na tabela desta pessoa)
    const foraDaMeta = div.fora.map((x) => ({ vendedor: db.D.vendedor[x.nome] || '(sem nome)', dias: x.dias }));
    return { rows, total, qtdVend, piso: { dias: div.piso, aplicado: div.pisoAplicado, fechado: div.fechado, dia: div.dia, todosAbaixo: div.todosAbaixo }, foraDaMeta,
      feriasMes: mInd.feriasMes, loja: lojaCtx, regras: rgCtx, lojasNoPeriodo: new Set(b.map((i) => db.loja[i])).size };
  };

  /** Página Comissionamento — Espaço Gourmet (gorjeta/taxa de serviço) */
  R.espacoGourmet = function ({ base, baseSemVend }) {
    const db = TS.db, I = R.ids;
    const lojas = [...new Set(base.map((i) => db.loja[i]))];
    // por loja: faturamento EG por vendedor, total EG, taxa de serviço, vendedores ativos
    const L = new Map();
    // quem está em "Não entram no rateio" também não recebe gorjeta: a parte dele fica com os outros
    const foraDe = (l) => { const rt = R.regrasDe(lojaNome(l)).rateio; return rt && rt.ativo ? new Set((rt.exclui || []).map((x) => String(x).trim().toLowerCase())) : new Set(); };
    for (const l of lojas) L.set(l, { fatEG: new Map(), fatEGTot: 0, gorjeta: 0, vendAtivos: new Set(), fora: foraDe(l) });
    // "sem vendedor" também fica de fora: a gorjeta dele seria perdida (ninguém recebe)
    const ehFora = (st, v) => I.semVendedor.has(v) || st.fora.has(String(db.D.vendedor[v] || '').trim().toLowerCase());
    for (const i of baseSemVend) {
      const st = L.get(db.loja[i]);
      if (!st) continue;
      const v = db.vend[i];
      if (!I.semVendedor.has(v) && !ehFora(st, v)) st.vendAtivos.add(v);
      if (I.taxaServico.has(db.desc[i])) { st.gorjeta += db.vt[i] || 0; continue; }
      if (I.eg.has(db.cat[i])) {
        st.fatEG.set(v, (st.fatEG.get(v) || 0) + (db.vt[i] || 0));
        if (!ehFora(st, v)) st.fatEGTot += db.vt[i] || 0; // base da divisão proporcional, sem quem está fora
      }
    }
    const porVend = TS.agrupar(baseSemVend, (i) => db.vend[i]);
    const rows = [];
    for (const [v, idx] of porVend) {
      if (I.semVendedor.has(v)) continue;
      let fat = 0, gorjeta = 0, temEG = false;
      for (const [l, st] of L) {
        const f = st.fatEG.get(v);
        if (f !== undefined) { fat += f; temEG = true; }
        if (ehFora(st, v)) continue; // fora do rateio: sem gorjeta
        const prop = st.fatEGTot ? (f || 0) / st.fatEGTot : 0;
        const gj = R.regrasDe(lojaNome(l)).gorjeta;
        // igual: divide entre todos os vendedores ativos da loja no período (vendeu algo), com ou sem venda no EG
        if (gj.modo === 'igual') gorjeta += st.vendAtivos.has(v) && st.vendAtivos.size ? (st.gorjeta * gj.percentual) / st.vendAtivos.size : 0;
        else gorjeta += prop * st.gorjeta * gj.percentual;
      }
      if (!temEG && !(gorjeta > 0)) continue;
      // indicadores só com as vendas do Espaço Gourmet (sem a taxa de serviço)
      const ind = TS.indicadores(idx.filter((i) => I.eg.has(db.cat[i]) && !I.taxaServico.has(db.desc[i])));
      rows.push({ vendedor: db.D.vendedor[v], gorjeta, fatEG: fat, tkmEG: ind.cupons ? fat / ind.cupons : null, pmaEG: ind.pma, ipaEG: ind.ipa });
    }
    let gTot = 0, fTot = 0;
    for (const [l, st] of L) {
      gTot += st.gorjeta * R.regrasDe(lojaNome(l)).gorjeta.percentual;
      fTot += [...st.fatEG.values()].reduce((a, b) => a + b, 0);
    }
    return { rows, total: { vendedor: 'Total', gorjeta: gTot, fatEG: fTot } };
  };

  /** Royalties por loja */
  R.royalties = function (base) {
    const db = TS.db, I = R.ids;
    const porLoja = TS.agrupar(base, (i) => db.loja[i]);
    const rows = [];
    for (const [l, idx] of porLoja) {
      const nome = lojaNome(l);
      const m = R.mix(idx);
      let fatEG = 0;
      for (const i of idx) if (I.eg.has(db.cat[i]) && !I.taxaServico.has(db.desc[i])) fatEG += db.vt[i] || 0;
      const ry = R.regrasDe(nome).royalties;
      const taxa = ry.loja;
      const r = { loja: nome, total: m.total, royLoja: m.total * taxa, royMkt: m.total * ry.mkt, fatEG, royEG: fatEG * ry.eg, royEGMkt: fatEG * ry.egMkt, taxa };
      r.royTotal = r.royLoja + r.royMkt + r.royEG + r.royEGMkt;
      rows.push(r);
    }
    return rows;
  };

  /** % EG e mix de vendas */
  R.pctEG = function (idx) {
    const db = TS.db, I = R.ids;
    let eg = 0, tot = 0;
    for (const i of idx) { tot += db.vt[i] || 0; if (I.egGrupoC.has(db.grupoC[i])) eg += db.vt[i] || 0; }
    return tot > 0 ? eg / tot : null;
  };
  R.mixPct = function (idx) {
    const db = TS.db, I = R.ids;
    let a = 0, p = 0, c = 0;
    for (const i of idx) {
      const v = db.vt[i] || 0;
      if (I.catAromPct.has(db.cat[i])) a += v;
      if (I.catPuroPct.has(db.cat[i])) p += v;
      if (I.grupoAcessPct.has(db.grupo[i])) c += v;
    }
    const t = R.mix(idx).total;
    return t ? { arom: a / t, puro: p / t, acess: c / t } : { arom: null, puro: null, acess: null };
  };
})();
