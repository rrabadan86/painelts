/* Extras: projeção do mês, "Minha comissão", fechamento em PDF e aviso de dados atrasados */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  const R = () => TS.rules;
  const dia = (iso) => TS.isoToDay(iso);
  const ymDe = (day) => TS.dayToIso(day).slice(0, 7);
  const diasNoMes = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();

  // ======================= META E PROJEÇÃO =======================
  /** meta das lojas (nomes de venda) num mês */
  TS.metaDoMes = function (ym, nomes) { return TS.metaCalc(ym, nomes).valor; };

  // ---------- dia de loja aberta: o mesmo critério da "Meta de hoje", da escala e da projeção ----------
  const DIAS_OP = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  const ferCache = new Map();
  /** a loja abre neste dia? Horário de funcionamento do dia da semana e feriado marcado como fechado. Sem cadastro: abre. */
  TS.lojaAberta = function (cfg, iso) {
    const func = cfg && cfg.operacao && cfg.operacao.funcionamento;
    const f = func && func[DIAS_OP[new Date(iso + 'T12:00:00Z').getUTCDay()]];
    if (f && f.fechado) return false;
    if (!cfg || !TS.feriadosDoMes || !TS.horarioFeriado) return true;
    const k = `${cfg.id || ''}|${iso.slice(0, 7)}`;
    let fer = ferCache.get(k);
    if (!fer) { if (ferCache.size > 60) ferCache.clear(); ferCache.set(k, (fer = new Set(TS.feriadosDoMes(cfg, iso.slice(0, 7)).map((x) => x.data)))); }
    return !(fer.has(iso) && (TS.horarioFeriado(cfg, iso) || {}).fechado);
  };
  TS.aoLimparCache && TS.aoLimparCache(() => ferCache.clear());

  /**
   * Projeção do mês — UMA conta para todas as telas (TS.contas.projecaoMes, a mesma do servidor).
   * Vendas até o último dia COMPLETO (o dia de hoje fica de fora e vem à parte em `hoje`) + cada dia que falta pela média
   * do mesmo dia da semana nas últimas 8 semanas (dia de loja fechada conta zero).
   * opts: base 'loja' (faturamento da loja) | 'meta' (vendas da meta); ate = fim do período da tela (dia do painel);
   *       todas = ignora também o filtro de loja (Resultado e equilíbrio: a loja escolhida no topo, sem filtros);
   *       lojaId = só essa loja, com o horário dela (Início com "Todas as lojas": uma projeção por loja).
   * Segue só o filtro de loja: vendedor, grupo e produto não mudam a projeção.
   * → null se o mês já fechou ou não há histórico; senão o resultado da conta + { hoje, acumulado, proj (nunca abaixo do já vendido) }
   */
  TS.projecaoMes = function (ym, opts = {}) {
    const db = TS.db;
    if (!db || !db.n) return null;
    const base = opts.base === 'meta' ? 'meta' : 'loja';
    const hojeD = TS.todayDay();
    const iniMes = dia(ym + '-01'), fimMes = iniMes + diasNoMes(ym) - 1;
    const limite = Math.min(opts.ate ?? db.maxDay, db.maxDay);
    const completo = Math.min(limite, hojeD - 1); // hoje ainda está acontecendo
    if (completo >= fimMes || limite < iniMes) return null;
    const metaLoja = opts.lojaId ? (db.metas || []).find((m) => m.id === opts.lojaId) || null : null;
    const soLoja = metaLoja ? new Set((metaLoja.nomesVenda || []).map((n) => db.D.loja.indexOf(n)).filter((x) => x >= 0)) : null;
    const ign = ['vendedores', 'grupos', 'cats', 'produto', ...(opts.todas || soLoja ? ['lojas'] : [])];
    const chave = `${ym}|${base}|${limite}|${hojeD}|${soLoja ? '#' + opts.lojaId : opts.todas ? '*' : [...state.f.lojas].sort().join(',')}|${state.loja || ''}`;
    const cache = db._projMes || (db._projMes = new Map());
    if (cache.has(chave)) return cache.get(chave);
    const I = R().ids, porDia = new Map();
    for (const i of TS.filtrar({ de: completo - 62, ate: Math.min(limite, fimMes), ignorar: ign, mesLivre: true, extra: soLoja ? (k) => soLoja.has(db.loja[k]) : null })) {
      let v = 0;
      if (base === 'loja') v = TS.contaFat(i) ? db.vt[i] || 0 : 0;
      else { const g = db.grupoC[i]; v = !I.eg.has(db.cat[i]) && (I.arom.has(g) || I.puro.has(g) || I.acess.has(g)) ? db.vt[i] || 0 : 0; }
      if (v) porDia.set(db.day[i], (porDia.get(db.day[i]) || 0) + v);
    }
    const cfg = metaLoja || (state.loja && state.loja !== 'todas' ? (db.metas || []).find((m) => m.id === state.loja) || null : null);
    const P = TS.contas.projecaoMes({ ym, ate: TS.dayToIso(completo), valorDia: (iso) => porDia.get(dia(iso)) || 0, aberto: (iso) => TS.lojaAberta(cfg, iso), inicio: TS.dayToIso(db.minDay) });
    let out = null;
    if (P && !P.fechado && P.proj != null) {
      // o dia em andamento (se o período da tela chega até ele) é mostrado à parte
      const temHoje = limite >= hojeD && hojeD >= iniMes && hojeD <= fimMes;
      const hoje = temHoje ? porDia.get(hojeD) || 0 : null;
      const acumulado = P.realizado + (hoje || 0);
      out = { ...P, base, hoje, acumulado, projPura: P.proj, proj: Math.max(P.proj, acumulado) };
    }
    cache.set(chave, out);
    return out;
  };

  /** a conta da projeção, passo a passo, com os números da loja (vai no ⓘ) */
  TS.comoProjecao = function (P) {
    if (!P) return '';
    const NOMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const oQue = P.base === 'meta' ? 'Vendas da meta (chás e acessórios, sem Espaço Gourmet)' : 'Faturamento da loja (com Espaço Gourmet, sem taxas e sem itens a R$ 0,01)';
    const p1 = P.ate ? `${oQue} do dia 1 até ${fmt.date(P.ate).slice(0, 5)} (${P.feitos} ${P.feitos === 1 ? 'dia completo' : 'dias completos'}): ${fmt.brl0(P.realizado)}.` : `${oQue}: o mês ainda não tem um dia completo.`;
    const p2 = P.metodo === 'semana'
      ? `Dias que faltam: ${P.restantes} de loja aberta. Cada um entra pela média do mesmo dia da semana nas últimas ${P.semanas} semanas (${[1, 2, 3, 4, 5, 6, 0].map((w) => `${NOMES[w]} ${fmt.brl0(P.medias[w])}`).join(' · ')}); dia de loja fechada conta zero. Soma: ${fmt.brl0(P.estimado)}.`
      : `Dias que faltam: ${P.restantes} de loja aberta. A loja tem menos de 4 semanas de vendas no painel, então cada dia entra pela média simples por dia aberto (${fmt.brl0(P.mediaSimples)}). Soma: ${fmt.brl0(P.estimado)}.`;
    const p3 = `Projeção = ${fmt.brl0(P.realizado)} + ${fmt.brl0(P.estimado)} = ${fmt.brl0(P.projPura)}.`;
    const p4 = P.hoje != null ? `O dia de hoje ainda está acontecendo: fica de fora da conta e entra pela média do dia da semana (hoje até agora: ${fmt.brl0(P.hoje)}).${P.proj > P.projPura ? ' Como o que já foi vendido passou dessa conta, a projeção mostra o já vendido.' : ''}` : '';
    return [p1, p2, p3, p4].filter(Boolean).join('\n\n');
  };

  /**
   * Projeção de um valor da tela no mês em andamento. `valor` é o que a tela mostra (até o último dia com vendas);
   * com filtro de vendedor/grupo, o valor é levado na mesma proporção da projeção da loja. Devolve null se o mês já fechou.
   */
  TS.projecao = function (valor, meta, ym, opts = {}) {
    const P = TS.projecaoMes(ym, opts);
    if (!P) return null;
    const parte = P.acumulado > 0 ? Math.min(1, Math.max(0, valor / P.acumulado)) : null;
    const proj = parte == null ? null : P.proj * parte;
    const restantes = P.restantes; // dias de loja aberta que faltam (com hoje)
    const falta = meta != null ? Math.max(0, meta - valor) : null;
    // META-DIA-01: os dias que faltam contam hoje, então o "por dia" parte do que faltava até ONTEM (a mesma conta da Meta de hoje)
    const hojeParte = (P.hoje || 0) * (parte == null ? 1 : parte);
    const faltaOntem = meta != null ? Math.max(0, meta - (valor - hojeParte)) : null;
    return { proj, d: P.feitos, n: P.n, restantes, falta, porDia: falta != null && falta > 0 && restantes ? faltaOntem / restantes : null, pctProj: meta && proj != null ? proj / meta : null, P, parte };
  };

  /** cartão de projeção (usado no Resumo, Comissionamento e Minha comissão) */
  TS.kpiProjecao = function (valor, meta, ym, rotulo = 'Projeção do mês', opts = {}) {
    const p = TS.projecao(valor, meta, ym, opts);
    if (!p || p.proj == null) return null;
    const foot = meta
      ? h('span', null, h('span', { class: p.pctProj >= 1 ? 'up' : 'down' }, `${fmt.pct(p.pctProj, 0)} da meta`),
        p.falta > 0 && p.restantes ? ` · faltam ${fmt.brl0(p.porDia)}/dia nos ${p.restantes} dias de loja aberta` : p.falta === 0 ? ' · meta já batida' : '')
      : `${p.d} de ${p.n} dias completos · faltam ${p.restantes} de loja aberta`;
    const filtro = p.parte != null && p.parte < 0.999 ? `\n\nA tela está com filtro (vendedor, grupo ou produto): o valor mostrado é ${fmt.pct(p.parte, 0)} do total e a projeção segue essa mesma proporção.` : '';
    return TS.kpi(rotulo, fmt.brl0(p.proj), foot, TS.comoProjecao(p.P) + filtro);
  };

  /**
   * A mesma projeção do TS.kpiProjecao, como coluna do cartão-herói (TS.heroi): o número projetado, a linha da meta
   * (ou dos dias) e a conta aberta no ⓘ. → coluna ou null (sem projeção).
   */
  /** faturamento (ou vendas da meta) de um mês INTEIRO, com a mesma escolha de lojas da projeção e sem os outros filtros (PROJ-CMP-01) */
  TS.fatMesInteiro = function (ym, opts = {}) {
    const db = TS.db;
    if (!db || !db.n) return null;
    const ini = dia(ym + '-01'), fim = ini + diasNoMes(ym) - 1;
    if (ini < db.minDay || fim > db.maxDay) return null; // mês sem todos os dias na base
    const base = opts.base === 'meta' ? 'meta' : 'loja';
    const chave = `${ym}|${base}|${opts.todas ? '*' : [...state.f.lojas].sort().join(',')}|${state.loja || ''}`;
    const cache = db._fatMes || (db._fatMes = new Map());
    if (cache.has(chave)) return cache.get(chave);
    const I = R().ids;
    let t = 0;
    for (const i of TS.filtrar({ de: ini, ate: fim, ignorar: ['vendedores', 'grupos', 'cats', 'produto', ...(opts.todas ? ['lojas'] : [])], mesLivre: true })) {
      if (base === 'loja') t += TS.contaFat(i) ? db.vt[i] || 0 : 0;
      else { const g = db.grupoC[i]; t += !I.eg.has(db.cat[i]) && (I.arom.has(g) || I.puro.has(g) || I.acess.has(g)) ? db.vt[i] || 0 : 0; }
    }
    cache.set(chave, t);
    return t;
  };
  /**
   * Meta de um mês INTEIRO para a Evolução mensal (META-EVO-01, pedido do dono de 26/11/2026): a meta da loja (TS.metaCalc,
   * a mesma do Início e do Comissionamento) contra as vendas da meta do mês (R.comissionamento: aromatizado + puro + acessórios,
   * sem Espaço Gourmet), com as lojas do filtro e sem os outros filtros. Cada loja com a meta e as regras dela; a meta
   * individual de cada vendedor vem da mesma conta da comissão.
   * → null (mês sem meta) | { ym, meta, vendas, fat, pct, fechado, esperado, pctProj, porDia, restantes, lojas: [{ nome, meta, vendas, pct }],
   *   vend: Map(vendedorId → { meta, vendas, pct }), naMeta, comMeta }
   */
  TS.metaMes = function (ym, opts = {}) {
    const db = TS.db;
    if (!db || !db.n || !/^\d{4}-\d{2}$/.test(ym || '')) return null;
    const ini = dia(ym + '-01'), fim = ini + diasNoMes(ym) - 1;
    if (ini > db.maxDay) return null;
    const lojasF = opts.loja != null ? new Set([opts.loja]) : state.f.lojas.size ? state.f.lojas : null;
    const chave = `${ym}|${lojasF ? [...lojasF].sort().join(',') : '*'}|${state.loja || ''}|${db.maxDay}`;
    const cache = db._metaMes || (db._metaMes = new Map());
    if (cache.has(chave)) return cache.get(chave);
    const idxMes = TS.filtrar({ de: ini, ate: Math.min(fim, db.maxDay), ignorar: ['vendedores', 'grupos', 'cats', 'produto', 'lojas'], mesLivre: true })
      .filter((i) => !lojasF || lojasF.has(db.loja[i]));
    // grupos = configurações de loja (uma loja pode vender com mais de um nome); sem configuração, a meta única do painel
    const cfgs = (db.metas || []).length ? db.metas : [{ nome: '', nomesVenda: null }];
    let meta = 0, vendas = 0, fat = 0, temMeta = false;
    const lojas = [], vend = new Map();
    for (const c of cfgs) {
      const nomes = c.nomesVenda ? new Set(c.nomesVenda) : null;
      const idx = nomes ? idxMes.filter((i) => nomes.has(db.D.loja[db.loja[i]])) : idxMes;
      if (!idx.length) continue;
      const m = nomes ? TS.metaCalc(ym, nomes).valor : db.meta;
      if (!(m > 0)) continue;
      const res = R().comissionamento({ base: idx, baseSemVend: idx, metaLoja: m, vendBonus: '', ym });
      const v = res.total.total || 0;
      temMeta = true; meta += m; vendas += v;
      fat += idx.reduce((s, i) => s + (TS.contaFat(i) ? db.vt[i] || 0 : 0), 0);
      lojas.push({ nome: c.nome || (nomes ? [...nomes][0] : ''), meta: m, vendas: v, pct: v / m });
      for (const r of res.rows) if (r.metaInd > 0 && !r.semMeta) vend.set(r.vendedorId, { meta: r.metaInd, vendas: r.total || 0, pct: (r.total || 0) / r.metaInd });
    }
    if (!temMeta) { cache.set(chave, null); return null; }
    const fechado = Math.max(db.maxDay, TS.todayDay() - 1) >= fim;
    let esperado = null, pctProj = null, porDia = null, restantes = null;
    if (!fechado) {
      const p = TS.projecao(vendas, meta, ym, { base: 'meta' });
      if (p) { esperado = p.n ? p.d / p.n : null; pctProj = p.pctProj; porDia = p.porDia; restantes = p.restantes; }
    }
    const vs = [...vend.values()];
    const out = { ym, meta, vendas, fat, pct: vendas / meta, fechado, esperado, pctProj, porDia, restantes, lojas, vend, naMeta: vs.filter((x) => x.pct >= 1).length, comMeta: vs.length };
    cache.set(chave, out);
    return out;
  };
  TS.heroiProjecao = function (valor, meta, ym, rotulo = 'Projeção do mês', opts = {}) {
    const p = TS.projecao(valor, meta, ym, opts);
    if (!p || p.proj == null) return null;
    const linha = meta
      ? h('span', null, h('span', { class: p.pctProj >= 1 ? 'up' : 'down' }, `${fmt.pct(p.pctProj, 0)} da meta`),
        p.falta > 0 && p.restantes ? ` · faltam ${fmt.brl0(p.porDia)}/dia nos ${p.restantes} dias de loja aberta` : p.falta === 0 ? ' · meta já batida' : '')
      : `${p.d} de ${p.n} dias completos · faltam ${p.restantes} de loja aberta`;
    const filtro = p.parte != null && p.parte < 0.999 ? `\n\nA tela está com filtro (vendedor, grupo ou produto): o valor mostrado é ${fmt.pct(p.parte, 0)} do total e a projeção segue essa mesma proporção.` : '';
    // comparação da projeção com o mês anterior inteiro e com o mesmo mês do ano passado inteiro (pedido do dono, 25/11/2026; PROJ-CMP-01).
    // A projeção do total da loja (sem os filtros de vendedor/grupo/produto) contra o total daqueles meses: o % vale também com filtro.
    let cmp = null, dicaCmp = '';
    if (opts.comparar && p.P && p.P.proj > 0) {
      const mais = (n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
      const ref = [[mais(-1), 'mês anterior'], [mais(-12), 'ano passado']].map(([y, nome]) => ({ y, nome, t: TS.fatMesInteiro(y, opts) })).filter((r) => r.t > 0);
      if (ref.length) {
        cmp = h('span', { class: 'proj-cmp' }, ...ref.flatMap((r, i) => { const v = p.P.proj / r.t - 1; return [i ? ' · ' : '', h('span', { class: v >= 0 ? 'up' : 'down' }, `${v >= 0 ? '+' : ''}${fmt.pct(v, 0)}`), ` vs ${TS.ymLabel(r.y)}`]; }));
        dicaCmp = '\n\nComparação: a projeção do mês contra ' + ref.map((r) => `${TS.ymLabel(r.y)} inteiro (${r.nome}: ${fmt.brl0(r.t)})`).join(' e ') + '.';
      }
    }
    return { rot: rotulo, num: fmt.brl0(p.proj), linhas: [linha, cmp].filter(Boolean), dica: TS.comoProjecao(p.P) + filtro + dicaCmp, estado: meta ? (p.pctProj >= 1 ? 'bom' : 'ruim') : null };
  };

  // ======================= AVISO DE DADOS ATRASADOS =======================
  /** lojas cuja última venda tem mais de 2 dias */
  TS.lojasAtrasadas = function () {
    const db = TS.db;
    if (!db || !db.n || TS.demo) return [];
    if (!db.ultimaPorLoja) {
      const m = new Map();
      for (let i = 0; i < db.n; i++) { const l = db.loja[i]; if (!(m.get(l) >= db.day[i])) m.set(l, db.day[i]); }
      db.ultimaPorLoja = m;
    }
    const hoje = TS.todayDay();
    return [...db.ultimaPorLoja].filter(([, d]) => hoje - d > 2).map(([l, d]) => ({ loja: db.D.loja[l], dia: d, dias: hoje - d }));
  };
  TS.avisoAtraso = function () {
    const at = TS.lojasAtrasadas();
    if (!at.length || TS.eu?.perfil === 'vendedor') return null;
    const txt = at.map((a) => `${a.loja}: última venda em ${fmt.date(TS.dayToIso(a.dia))} (há ${a.dias} dias)`).join(' · ');
    return h('div', { class: 'notice warn' }, h('b', null, 'Dados atrasados. '), txt, '. A atualização automática pode estar com problema',
      TS.eu?.pode?.configurar ? h('span', null, ' — veja em ', h('a', { href: '#config' }, 'Configurações'), '.') : '.');
  };

  // ======================= MINHA COMISSÃO =======================
  TS.PAGINAS_VENDEDOR = ['minha'];
  /**
   * "Sua meta de hoje" (Minha comissão, só para a vendedora; decisão do dono de 22/11/2026). A vendedora recebe só as
   * vendas dela, então a conta da loja é feita no servidor (GET /api/meta-hoje, src/metahoje.js, a mesma do cartão do
   * Início): ela recebe só a parte dela e o que ela vendeu hoje — nunca a meta da loja, o faturamento nem as colegas.
   */
  function cartaoMinhaMetaHoje() {
    const lojaId = state.loja && state.loja !== 'todas' ? state.loja : ((TS.eu && TS.eu.lojas) || [])[0]?.id;
    const card = h('div', { class: 'card md-card md-minha' }, h('div', { class: 'card-title' }, 'Sua meta de hoje'), h('small', { class: 'muted' }, 'Calculando…'));
    if (!lojaId) return h('span');
    fetch(TS.api('meta-hoje?loja=' + encodeURIComponent(lojaId)), { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!card.isConnected) return; // a pessoa já saiu da tela
        if (!m || (m.minhaParte == null && !m.semParte)) { card.remove(); return; } // sem meta no mês: sem cartão
        const dica = TS.dica('A meta de hoje da loja é o que falta para a meta do mês dividido pelos dias de loja aberta que ainda faltam (contando hoje).\n\n'
          + 'Ela é dividida em partes iguais entre quem vendeu nos últimos 30 dias e não está de férias hoje. Conta só as vendas da meta: chás e acessórios, sem o Espaço Gourmet — a mesma base da sua comissão.\n\n'
          + 'É só o alvo do dia: a meta do mês e a comissão continuam como abaixo.');
        if (m.minhaParte == null) {
          card.replaceChildren(h('div', { class: 'card-title' }, 'Sua meta de hoje', dica),
            h('p', { class: 'muted' }, m.semParte === 'ferias' ? 'Você está de férias hoje: sem meta do dia. 🌴' : 'Você ainda não entra na divisão da meta de hoje (conta quem vendeu nos últimos 30 dias).'));
          return;
        }
        const pct = m.vendiHoje != null && m.minhaParte ? Math.min(100, (m.vendiHoje / m.minhaParte) * 100) : 0;
        // sem a barra (vendas de hoje ainda não chegaram): .filter(Boolean), senão o replaceChildren escreve "null" na tela
        // (achado pelo teste de tela da vendedora no painel de verdade, PERFIL-TELA-02)
        card.replaceChildren(...[
          h('div', { class: 'md-topo' },
            h('div', null, h('div', { class: 'card-title' }, 'Sua meta de hoje', dica),
              h('div', { class: 'card-sub' }, `Faltam ${m.restam} ${m.restam === 1 ? 'dia' : 'dias'} de loja aberta no mês, contando hoje.`)),
            h('div', { class: 'md-num' }, h('b', null, fmt.brl0(m.minhaParte)),
              m.temHoje ? h('small', null, `você vendeu hoje: ${fmt.brl0(m.vendiHoje)}${m.vendiHoje >= m.minhaParte ? ' ✓' : ''}`) : h('small', null, 'as vendas de hoje chegam na próxima atualização'))),
          m.temHoje ? h('div', { class: 'md-barra' }, h('i', { style: { width: pct + '%' } })) : null].filter(Boolean));
      })
      .catch(() => card.remove());
    return card;
  }

  TS.pages.minha = function (root) {
    const db = TS.db;
    const souVendedor = TS.eu?.perfil === 'vendedor';
    const meses = [...new Set(db.ym)].sort().reverse();
    if (!state.minhaYm || !meses.includes(state.minhaYm)) state.minhaYm = meses[0];
    const ym = state.minhaYm;
    const de = dia(ym + '-01'), ate = dia(`${ym}-${String(diasNoMes(ym)).padStart(2, '0')}`);
    const base = TS.filtrar({ de, ate, mesLivre: true, ignorar: ['vendedores', 'grupos', 'cats', 'produto'] });
    const vendNoMes = [...new Set(base.map((i) => db.D.vendedor[db.vend[i]]))].filter((n) => n && !/^SEM VENDEDOR$|^COLEGA \d+$/i.test(n)).sort();
    let nome = souVendedor ? String(TS.eu.vendedor || '').toUpperCase() : (state.minhaVend || vendNoMes[0] || '');
    if (!souVendedor && !vendNoMes.includes(nome)) nome = vendNoMes[0] || '';
    if (souVendedor) nome = vendNoMes.find((n) => n.trim().toUpperCase() === nome) || nome;

    const selMes = h('select', { class: 'f-input' }, meses.map((m) => h('option', { value: m, selected: m === ym || null }, `${TS.MESES_LONGOS[+m.slice(5, 7) - 1]} de ${m.slice(0, 4)}`)));
    selMes.addEventListener('change', () => { state.minhaYm = selMes.value; TS.render(); });
    const ferramentas = h('div', { class: 'minha-sel' }, selMes);
    if (!souVendedor) {
      const selV = h('select', { class: 'f-input' }, vendNoMes.map((n) => h('option', { value: n, selected: n === nome || null }, n)));
      selV.addEventListener('change', () => { state.minhaVend = selV.value; TS.render(); });
      ferramentas.prepend(selV);
    }
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, souVendedor ? 'Minha comissão' : `Comissão de ${nome || '—'}`),
      h('div', { class: 'page-sub' }, souVendedor ? `Olá! Acompanhe sua meta e quanto vai receber em ${TS.MESES_LONGOS[+ym.slice(5, 7) - 1].toLowerCase()}.` : 'Como o vendedor vê a própria comissão')), ferramentas));
    if (souVendedor) root.append(cartaoMinhaMetaHoje()); // a parte dela da meta de hoje (o servidor faz a conta da loja)
    const NOME = nome.trim().toUpperCase(); // comparação sem diferenciar maiúsculas ("Gabrielly" = "GABRIELLY")
    if (!nome) { root.append(TS.card(null, null, TS.empty(souVendedor ? 'Seu usuário ainda não está ligado a um vendedor. Fale com o gerente.' : 'Nenhum vendedor com vendas neste mês.'))); return; }

    const nomesLoja = new Set(base.filter((i) => db.D.vendedor[db.vend[i]].trim().toUpperCase() === NOME).map((i) => db.D.loja[db.loja[i]]));
    const baseLoja = nomesLoja.size ? base.filter((i) => nomesLoja.has(db.D.loja[db.loja[i]])) : base;
    const metaLoja = TS.metaDoMes(ym, nomesLoja.size ? nomesLoja : null) || 0;
    const res = R().comissionamento({ base: baseLoja, baseSemVend: baseLoja, metaLoja, vendBonus: '', ym });
    const row = res.rows.find((r) => r.vendedor.trim().toUpperCase() === NOME);
    if (!row) { root.append(TS.card(null, null, TS.empty(`Sem vendas de ${souVendedor ? 'você' : nome} em ${TS.ymLabel(ym)}.`))); return; }
    const rg = res.regras;
    const eg = R().espacoGourmet({ base: baseLoja, baseSemVend: baseLoja });
    const gorjeta = (eg.rows.find((r) => r.vendedor.trim().toUpperCase() === NOME) || {}).gorjeta || 0;
    const premio = rg.rateio && rg.rateio.ativo ? 0 : row.premiacao; // no rateio a premiação já entra no montante
    const totalReceber = (row.aPagar || 0) + premio + gorjeta;

    // redesenho: herói com o que importa para quem vende — quanto vai receber, quanto vendeu (barra até a meta) e o ritmo
    const metaTxt = (() => {
      const minhas = res.feriasMes.filter((f) => String(f.vendedor).trim().toUpperCase() === NOME);
      if (minhas.length) return `menor por causa das férias (${minhas.map((f) => `${fmt.date(f.de).slice(0, 5)} a ${fmt.date(f.ate).slice(0, 5)}`).join(', ')})`;
      if (res.feriasMes.length) return 'inclui a parte de quem está de férias';
      if (!row.divide && !row.semMeta) return `a mesma dos colegas (meta da loja ÷ ${res.qtdVend}); você ainda não entra na divisão: ${row.diasVenda} de ${res.piso.aplicado} dias com venda`;
      return `meta da loja ${fmt.brl0(metaLoja)} ÷ ${res.qtdVend} ${res.qtdVend === 1 ? 'pessoa' : 'pessoas'}`;
    })();
    const dicaMeta = `A meta da loja é dividida entre quem tem pelo menos ${res.piso.dias} dias com venda no mês${res.piso.fechado ? '' : ` (mês em andamento: por enquanto ${res.piso.aplicado})`}. Quem está de férias não divide a meta dos dias de férias.`;
    const pctInd = row.metaInd ? row.total / row.metaInd : null;
    const pEsp = row.metaInd ? TS.projecao(row.total, row.metaInd, ym, { base: 'meta' }) : null;
    const esperado = pEsp && pEsp.n ? (pEsp.d / pEsp.n) * 100 : null; // marca: a parte do mês já passada
    root.append(TS.heroi([
      { rot: 'A receber (estimado)', num: fmt.brl(totalReceber), linhas: [h('span', null, `comissão ${fmt.brl(row.aPagar)}`, premio ? ` + premiação ${fmt.brl0(premio)}` : '', gorjeta ? ` + gorjeta ${fmt.brl(gorjeta)}` : '')],
        dica: 'Comissão das três categorias (abaixo) + premiação dos indicadores + gorjeta do Espaço Gourmet, com as vendas até agora. O valor final é fechado pela loja no fim do mês.' },
      { rot: 'Você vendeu', num: fmt.brl0(row.total), estado: pctInd != null && pctInd >= 1 ? 'bom' : null,
        barra: pctInd != null ? { pct: pctInd * 100, esperado, rotulo: `${fmt.pct(pctInd, 0)} da sua meta${esperado != null ? `; o esperado até agora era ${Math.round(esperado)}%` : ''}` } : null,
        linhas: [row.metaInd ? h('span', { class: row.total >= row.metaInd ? 'up' : 'down' }, `${fmt.pct(pctInd, 0)} da sua meta`) : 'sem meta individual',
          h('span', { class: 'minha-meta' }, `Sua meta: ${row.metaInd ? fmt.brl0(row.metaInd) : '—'} · ${metaTxt}`, TS.dica(dicaMeta))],
        dica: 'Suas vendas que contam para a meta: chá aromatizado, chá puro e acessórios, sem o Espaço Gourmet.' },
      TS.heroiProjecao(row.total, row.metaInd || null, ym, 'Se continuar neste ritmo', { base: 'meta' }) || { rot: 'Mês', num: 'Fechado', linhas: [TS.ymLabel(ym)] },
    ], { titulo: souVendedor ? 'Seu mês' : `O mês de ${nome}` }));

    // por categoria
    const proj = TS.projecao(1, 1, ym, { base: 'meta' });
    const cats = [['arom', 'Chá aromatizado', 'metaArom', 'cArom'], ['puro', 'Chá puro', 'metaPuro', 'cPuro'], ['acess', 'Acessórios', 'metaAcess', 'cAcess']];
    const blocos = cats.map(([k, nomeCat, mk, ck]) => {
      const v = row[k] || 0, m = row[mk] || 0, f = rg.comissao[k];
      const pct = m ? v / m : null;
      const simples = rg.comissao.modo === 'simples';
      const faixa = !m ? null : simples ? (v >= m ? 'bate' : 'abaixo') : v >= m * 1.2 ? 'acima120' : v >= m ? 'bate' : 'abaixo';
      const prox = !m ? null : faixa === 'abaixo' ? { alvo: m, taxa: f.bate, txt: 'bater a meta' } : faixa === 'bate' && !simples ? { alvo: m * 1.2, taxa: f.acima120, txt: 'chegar a 120%' } : null;
      const larg = Math.min(100, ((pct || 0) / (simples ? 1.1 : 1.3)) * 100);
      return h('div', { class: 'card minha-cat' },
        h('div', { class: 'minha-cat-top' }, h('div', { class: 'card-title' }, nomeCat), h('div', { class: 'minha-com' }, fmt.brl(row[ck]), h('small', null, faixa ? ` (${fmt.pct(f[faixa], 1)})` : ''))),
        h('div', { class: 'minha-val' }, h('b', null, fmt.brl0(v)), ` de ${fmt.brl0(m)}`, pct != null ? h('span', { class: pct >= 1 ? 'up' : 'down' }, ` · ${fmt.pct(pct, 0)}`) : null),
        h('div', { class: 'minha-barra' }, h('div', { class: 'fill' + (pct >= 1 ? ' ok' : ''), style: { width: larg + '%' } }),
          h('span', { class: 'marca', style: { left: (100 / (simples ? 1.1 : 1.3)) + '%' }, title: 'meta' }),
          simples ? null : h('span', { class: 'marca m120', style: { left: (120 / 1.3) + '%' }, title: '120% da meta' })),
        prox ? h('div', { class: 'minha-dica' }, `Faltam ${fmt.brl0(prox.alvo - v)} para ${prox.txt} e a comissão subir para ${fmt.pct(prox.taxa, 1)}`,
          proj && proj.restantes ? ` (${fmt.brl0((prox.alvo - v) / proj.restantes)}/dia)` : '', '.') : m ? h('div', { class: 'minha-dica ok' }, simples ? 'Meta batida!' : 'Acima de 120% da meta: faixa máxima!') : null);
    });
    root.append(TS.section('Por categoria'), h('div', { class: 'grid g-3' }, blocos));

    // indicadores e premiação
    const pr = rg.premiacao;
    const ind = (rot, val, alvo, fm) => h('div', { class: 'minha-ind' + (val >= alvo ? ' ok' : '') }, h('span', null, rot), h('b', null, fm(val)), h('small', null, `mínimo ${fm(alvo)}`), h('i', null, val >= alvo ? '✓' : '—'));
    const nOk = (row.tkm >= pr.tkm) + (row.ipa >= pr.ipa) + (row.pma >= pr.pma);
    root.append(h('div', { class: 'grid g-2 mt' },
      pr.ativa ? TS.card('Premiação', `${fmt.brl0(pr.valor)} por indicador quando ${pr.minimo} ou mais estão no mínimo · você está com ${nOk} de 3`,
        h('div', { class: 'minha-inds' }, ind('Ticket médio (TKM)', row.tkm, pr.tkm, fmt.brl), ind('Itens por atendimento (IPA)', row.ipa, pr.ipa, fmt.n2), ind('Preço médio (PMA)', row.pma, pr.pma, fmt.brl)),
        h('div', { class: 'minha-dica' + (row.premiacao ? ' ok' : '') }, row.premiacao ? `Premiação garantida até agora: ${fmt.brl0(row.premiacao)}`
          : row.poucosAtend ? `Poucos atendimentos (${fmt.int(row.atend)} de ${fmt.int(R().minAtendPremiacao(rg))}): a premiação vale para quem tem pelo menos ${fmt.int(R().minAtendPremiacao(rg))} atendimentos no mês.`
            : `Falta${pr.minimo - nOk > 1 ? 'm' : ''} ${Math.max(0, pr.minimo - nOk)} indicador(es) para a premiação.`))
        : TS.card('Indicadores', 'Seu desempenho no mês', h('div', { class: 'minha-inds' }, ind('TKM', row.tkm, 0, fmt.brl), ind('IPA', row.ipa, 0, fmt.n2), ind('PMA', row.pma, 0, fmt.brl))),
      graficoAcumulado(baseLoja, NOME, ym, row.metaInd)));
    root.append(h('p', { class: 'muted minha-obs' }, 'Valores estimados com as vendas até ', fmt.date(TS.dayToIso(Math.min(db.maxDay, ate))), '. O valor final é fechado pela loja no fim do mês.'));
  };

  function graficoAcumulado(base, nome, ym, meta) {
    const db = TS.db, n = diasNoMes(ym);
    const porDia = new Array(n).fill(0);
    const I = R().ids;
    for (const i of base) {
      if (db.D.vendedor[db.vend[i]].trim().toUpperCase() !== nome) continue;
      const g = db.grupoC[i];
      if (I.eg.has(db.cat[i]) || !(I.arom.has(g) || I.puro.has(g) || I.acess.has(g))) continue;
      porDia[+db.iso[i].slice(8, 10) - 1] += db.vt[i] || 0;
    }
    const ultimo = ym === ymDe(db.maxDay) ? +TS.dayToIso(db.maxDay).slice(8, 10) : n;
    let acc = 0;
    const real = porDia.map((v, k) => (k < ultimo ? (acc += v) : null));
    const labels = porDia.map((_, k) => String(k + 1));
    return TS.card('Vendas acumuladas no mês', meta ? 'Linha tracejada = ritmo para bater a meta' : 'Chás e acessórios', TS.chart({
      type: 'line',
      data: { labels, datasets: [
        { label: 'Você', data: real, borderColor: '#2C5234', backgroundColor: 'rgba(44,82,52,.12)', fill: true, tension: 0.25, pointRadius: 0 },
        meta ? { label: 'Ritmo da meta', data: labels.map((_, k) => (meta / n) * (k + 1)), borderColor: '#C9A227', borderDash: [6, 4], pointRadius: 0, fill: false } : null,
      ].filter(Boolean) },
      options: { plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.brl0(c.raw)}` } } },
        scales: { y: { ticks: { callback: (v) => fmt.compact(v) }, grid: { color: '#EEE9DF' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } } } },
    }, 'short'));
  }

  // ======================= FECHAMENTO EM PDF =======================
  /** monta as páginas de impressão (Salvar como PDF no navegador) */
  TS.paginasFechamento = function ({ res, eg, meta, periodo, loja, feriados }) {
    const rg = res.regras;
    const gorj = new Map(eg.rows.map((r) => [r.vendedor, r.gorjeta]));
    // quem está em "Não entram no rateio" não aparece no fechamento (sem comissão e sem gorjeta)
    const fora = new Set(rg.rateio && rg.rateio.ativo ? (rg.rateio.exclui || []).map((x) => String(x).trim().toLowerCase()) : []);
    const linhas = res.rows.filter((r) => (r.total > 0 || r.aPagar > 0) && !/^SEM VENDEDOR$/i.test(String(r.vendedor).trim()) && !fora.has(String(r.vendedor).trim().toLowerCase())).sort((a, b) => a.vendedor.localeCompare(b.vendedor, 'pt-BR'));
    const totalDe = (r) => (r.aPagar || 0) + (rg.rateio && rg.rateio.ativo ? 0 : r.premiacao || 0) + (gorj.get(r.vendedor) || 0);
    const emitido = new Date().toLocaleString('pt-BR');
    // feriados trabalhados: { NOME: [{ data, nome, min }] }
    const fer = new Map();
    if (feriados) for (const f of feriados.lista) for (const [nome, min] of Object.entries(feriados.horas[f.data] || {})) {
      if (!fer.has(nome)) fer.set(nome, []);
      fer.get(nome).push({ data: f.data, nome: f.nome, min, acerto: feriados.acerto ? feriados.acerto(f.data, nome) : 'pagar' });
    }
    // banco de horas (BANCO-06): feriado "banco" entra em dobro no saldo; "pagar" segue para o fechamento como antes
    const comBanco = !!(feriados && feriados.comBanco);
    // feriado pago também vale o dobro (decisão do dono, 26/11/2026): minPagar já é a hora a pagar (2 × a trabalhada)
    const minPagar = (vend) => ferDe(vend).filter((x) => x.acerto !== 'banco').reduce((s, x) => s + 2 * x.min, 0);
    const bancoMes = (vend) => (comBanco && feriados.bancoMes ? feriados.bancoMes(vend) : null);
    const sinalH = (m) => (TS.bancoHoras ? TS.bancoHoras.sinal(m) : TS.horasTxt(m));
    const ferDe = (vend) => fer.get(String(vend).trim().toUpperCase()) || [];
    const minTot = (vend) => ferDe(vend).reduce((s, x) => s + x.min, 0);
    const temFeriado = feriados && feriados.lista.length;
    const DSEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const cab = (sub) => h('div', { class: 'imp-cab' }, h('div', null, h('div', { class: 'imp-marca' }, 'Tea Shop'), h('div', null, loja)), h('div', { class: 'imp-dir' }, h('div', { class: 'imp-tit' }, 'Fechamento de comissão'), h('div', null, periodo), sub ? h('div', null, sub) : null));
    const pg = [];
    // resumo
    pg.push(h('section', { class: 'imp-pag' }, cab('Resumo'),
      h('table', { class: 'imp-t' }, h('thead', null, h('tr', null, ['Vendedor', 'Vendido', 'Meta ind.', 'Comissão', 'Premiação', 'Gorjeta', 'Total', ...(temFeriado ? ['Horas em feriados'] : []), ...(comBanco ? ['Banco de horas'] : [])].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
        h('tbody', null, linhas.map((r) => h('tr', null, h('td', null, r.vendedor), h('td', { class: 'r' }, fmt.brl(r.total)), h('td', { class: 'r' }, fmt.brl0(r.metaInd)), h('td', { class: 'r' }, fmt.brl(r.aPagar)),
          h('td', { class: 'r' }, fmt.brl(rg.rateio && rg.rateio.ativo ? 0 : r.premiacao)), h('td', { class: 'r' }, fmt.brl(gorj.get(r.vendedor) || 0)), h('td', { class: 'r b' }, fmt.brl(totalDe(r))), temFeriado ? h('td', { class: 'r' }, TS.horasTxt(minTot(r.vendedor)), comBanco && minPagar(r.vendedor) ? h('small', { class: 'imp-sub-cel' }, ` (pagar ${TS.horasTxt(minPagar(r.vendedor))})`) : null) : null,
          comBanco ? h('td', { class: 'r' }, (() => { const b = bancoMes(r.vendedor); return b ? sinalH(b.fim) : '0h00'; })()) : null))),
        h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', { class: 'r' }, fmt.brl(res.total.total)), h('td', { class: 'r' }, fmt.brl0(meta)), h('td', { class: 'r' }, fmt.brl(res.total.aPagar)),
          h('td', { class: 'r' }, fmt.brl(rg.rateio && rg.rateio.ativo ? 0 : res.total.premiacao)), h('td', { class: 'r' }, fmt.brl(linhas.reduce((s, r) => s + (gorj.get(r.vendedor) || 0), 0))), h('td', { class: 'r b' }, fmt.brl(linhas.reduce((s, r) => s + totalDe(r), 0))), temFeriado ? h('td', { class: 'r' }, TS.horasTxt(linhas.reduce((s, r) => s + minTot(r.vendedor), 0))) : null, comBanco ? h('td') : null))),
      h('p', { class: 'imp-obs' }, `Meta da loja: ${fmt.brl0(meta)} · meta dividida entre ${res.qtdVend} ${res.qtdVend === 1 ? 'pessoa' : 'pessoas'} (quem tem pelo menos ${res.piso ? res.piso.aplicado : 1} ${res.piso && res.piso.aplicado === 1 ? 'dia' : 'dias'} com venda no mês)${res.foraDaMeta && res.foraDaMeta.length ? ` · fora da divisão: ${res.foraDaMeta.map((x) => `${x.vendedor} (${x.dias} ${x.dias === 1 ? 'dia' : 'dias'})`).join(', ')}` : ''}${res.feriasMes && res.feriasMes.length ? ` · férias no mês: ${res.feriasMes.map((f) => `${f.vendedor} (${fmt.date(f.de)} a ${fmt.date(f.ate)})`).join(', ')} — nesses dias a meta diária foi dividida entre quem estava trabalhando` : ''}. Vendas sem Espaço Gourmet. Emitido em ${emitido}.`)));
    // um por vendedor
    for (const r of linhas) {
      const cat = (rot, v, m, c) => h('tr', null, h('td', null, rot), h('td', { class: 'r' }, fmt.brl0(m)), h('td', { class: 'r' }, fmt.brl(v)), h('td', { class: 'r' }, m ? fmt.pct(v / m, 0) : '—'), h('td', { class: 'r' }, fmt.brl(c)));
      pg.push(h('section', { class: 'imp-pag' }, cab(r.vendedor),
        h('h2', { class: 'imp-nome' }, r.vendedor),
        h('table', { class: 'imp-t' }, h('thead', null, h('tr', null, ['Categoria', 'Meta', 'Vendido', '% da meta', 'Comissão'].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
          h('tbody', null, cat('Chá aromatizado', r.arom, r.metaArom, r.cArom), cat('Chá puro', r.puro, r.metaPuro, r.cPuro), cat('Acessórios', r.acess, r.metaAcess, r.cAcess),
            r.bonus ? h('tr', null, h('td', null, 'Bônus sobre outros vendedores'), h('td'), h('td'), h('td'), h('td', { class: 'r' }, fmt.brl(r.bonus))) : null),
          h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', { class: 'r' }, fmt.brl0(r.metaInd)), h('td', { class: 'r' }, fmt.brl(r.total)), h('td', { class: 'r' }, r.metaInd ? fmt.pct(r.total / r.metaInd, 0) : '—'), h('td', { class: 'r' }, fmt.brl(r.base))))),
        h('table', { class: 'imp-t imp-res' }, h('tbody', null,
          h('tr', null, h('td', null, rg.rateio && rg.rateio.ativo ? 'Comissão (rateio igual entre a equipe)' : 'Comissão'), h('td', { class: 'r' }, fmt.brl(r.aPagar))),
          rg.rateio && rg.rateio.ativo ? null : h('tr', null, h('td', null, `Premiação (TKM ${fmt.brl(r.tkm)} · IPA ${fmt.n2(r.ipa)} · PMA ${fmt.brl(r.pma)})`), h('td', { class: 'r' }, fmt.brl(r.premiacao))),
          h('tr', null, h('td', null, 'Gorjeta (taxa de serviço)'), h('td', { class: 'r' }, fmt.brl(gorj.get(r.vendedor) || 0))),
          h('tr', { class: 'tot' }, h('td', null, 'Total a receber'), h('td', { class: 'r' }, fmt.brl(totalDe(r)))))),
        temFeriado ? h('div', { class: 'imp-fer' }, h('div', { class: 'imp-sub' }, 'Feriados trabalhados'),
          ferDe(r.vendedor).length ? h('table', { class: 'imp-t' }, h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'Feriado'), h('th', { class: 'r' }, 'Horas'), comBanco ? h('th', null, 'Acerto') : null, comBanco ? h('th', { class: 'r' }, 'Vale (×2)') : null)),
            h('tbody', null, ferDe(r.vendedor).map((x) => h('tr', null, h('td', null, `${fmt.date(x.data)} (${DSEM[new Date(x.data + 'T12:00:00Z').getUTCDay()]})`), h('td', null, x.nome), h('td', { class: 'r' }, TS.horasTxt(x.min)),
              comBanco ? h('td', null, x.acerto === 'banco' ? 'Banco (×2)' : 'Pagar') : null, comBanco ? h('td', { class: 'r' }, x.acerto === 'banco' ? `+${TS.horasTxt(2 * x.min)} no banco` : `${TS.horasTxt(2 * x.min)} a pagar`) : null))),
            h('tfoot', null, h('tr', null, h('td', { colspan: 2 }, 'Total em feriados'), h('td', { class: 'r' }, TS.horasTxt(minTot(r.vendedor))),
              comBanco ? h('td', null, `a pagar: ${TS.horasTxt(minPagar(r.vendedor)) === '—' ? '0h00' : TS.horasTxt(minPagar(r.vendedor))}`) : null,
              comBanco ? h('td', { class: 'r' }, (() => { const b = ferDe(r.vendedor).filter((x) => x.acerto === 'banco').reduce((s2, x) => s2 + 2 * x.min, 0); return b ? `+${TS.horasTxt(b)} no banco` : '—'; })()) : null)))
            : h('p', { class: 'imp-obs' }, 'Não trabalhou em feriados neste período.')) : null,
        comBanco ? (() => {
          const b = bancoMes(r.vendedor) || { inicio: 0, entrou: 0, saiu: 0, venceu: 0, fim: 0 };
          return h('div', { class: 'imp-fer imp-banco' }, h('div', { class: 'imp-sub' }, 'Banco de horas no mês'),
            h('table', { class: 'imp-t' }, h('thead', null, h('tr', null, ['Saldo no início', 'Entrou', 'Saiu', 'Venceu', 'Saldo no fim'].map((t) => h('th', { class: 'r' }, t)))),
              h('tbody', null, h('tr', null, [b.inicio, b.entrou, b.saiu, b.venceu, b.fim].map((v, i) => h('td', { class: 'r' + (i === 4 ? ' b' : '') }, sinalH(v)))))),
            h('p', { class: 'imp-obs' }, 'Positivo = a loja deve folga ou pagamento à pessoa; negativo = a pessoa deve horas. Feriado vale o dobro, no banco ou pago; folga pelo banco desconta a jornada; hora devida vence no prazo e some.'));
        })() : null,
        h('div', { class: 'imp-ass' }, h('div', null, h('span'), r.vendedor), h('div', null, h('span'), 'Responsável pela loja')),
        h('p', { class: 'imp-obs' }, `Emitido em ${emitido}.`)));
    }
    // dados usados também no e-mail da contabilidade
    pg.dados = { rg, gorj, linhas, totalDe, ferDe, minTot, temFeriado: !!temFeriado, emitido, comBanco, minPagar, bancoMes };
    return pg;
  };
  TS.imprimirFechamento = function (args) {
    document.getElementById('impressao')?.remove();
    const el = h('div', { id: 'impressao' }, TS.paginasFechamento(args));
    document.body.append(el);
    document.body.classList.add('imprimindo-doc');
    const limpar = () => { document.body.classList.remove('imprimindo-doc'); el.remove(); window.removeEventListener('afterprint', limpar); };
    window.addEventListener('afterprint', limpar);
    setTimeout(() => { window.print(); setTimeout(() => { if (document.body.classList.contains('imprimindo-doc') && !window.matchMedia('print').matches) limpar(); }, 1000); }, 100);
  };
})();

/* ======================= REDE, ALERTAS E MARCA ======================= */
(function () {
  const { h, fmt, state } = TS;
  const FMT = { brl0: fmt.brl0, brl: fmt.brl, int: fmt.int, n2: fmt.n2, kg: (v) => fmt.kg(v) + ' kg', pct: (v) => fmt.pct(v), delta: (v) => fmt.delta(v) };
  const lojaUnicaSel = () => (state.loja && state.loja !== 'todas' ? state.loja : null);

  /** cartão "Sua loja × rede" (preenchido quando a resposta chega) */
  TS.cartaoRede = function () {
    const loja = lojaUnicaSel();
    const ym = TS.metaPeriodo().ym;
    // REDE-02 (pedido do dono, 25/11/2026): segue o período do filtro (as outras lojas cortadas nos mesmos dias); vendedor,
    // grupo e produto não entram: a comparação é de loja inteira com loja inteira
    const db = TS.db, f = state.f;
    const deD = f.de != null ? Math.max(f.de, db.minDay) : db.minDay, ateD = f.ate != null ? Math.min(f.ate, db.maxDay) : db.maxDay;
    const de = TS.dayToIso(deD), ate = TS.dayToIso(ateD);
    const perTxt = de.slice(0, 7) === ate.slice(0, 7) && de.slice(8) === '01' ? `${TS.MESES_LONGOS[+ate.slice(5, 7) - 1]} de ${ate.slice(0, 4)}${+ate.slice(8) < TS.contas.diasNoMes(ate.slice(0, 7)) ? ` até ${fmt.date(ate)}` : ''}` : `${fmt.date(de)} a ${fmt.date(ate)}`;
    const corpo = h('div', { class: 'rede-corpo' }, h('div', { class: 'muted' }, 'Carregando…'));
    const card = TS.card('Sua loja × rede', `${perTxt} (o período do filtro) · comparação anônima: nenhuma outra loja é identificada`, corpo);
    card.classList.add('rede-card');
    if (!loja) { corpo.replaceChildren(h('div', { class: 'muted' }, 'Escolha uma loja no seletor do topo para comparar com a rede.')); return card; }
    fetch(TS.api(`rede?ym=${ate.slice(0, 7)}&de=${de}&ate=${ate}&loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }).then((r) => r.json()).then((r) => {
      if (r.erro) throw new Error(r.erro);
      if (r.lojas < r.minimo) { corpo.replaceChildren(h('div', { class: 'muted' }, `A comparação aparece quando pelo menos ${r.minimo} lojas têm vendas no mês (hoje: ${r.lojas}). Assim nenhuma loja pode ser identificada.`)); return; }
      const neutro = new Set(['pctEG', 'pctPuro', 'pctAcess']); // mix: nem melhor nem pior
      const linhas = r.indicadores.map((x) => {
        const f = FMT[x.formato] || fmt.n2;
        const acima = x.minha != null && x.minha >= x.media;
        const barra = x.posicao == null ? null : h('div', { class: 'rede-pos' }, h('div', { class: 'rede-pos-fill', style: { width: Math.max(4, x.posicao) + '%' } }));
        return h('tr', null, h('td', { class: 'l' }, x.nome), h('td', { class: 'b ' + (x.minha == null ? 'muted' : neutro.has(x.k) ? '' : acima ? 'pos' : 'neg') }, x.minha == null ? '—' : f(x.minha)),
          h('td', null, f(x.media)), h('td', null, f(x.top25)), h('td', { class: 'l', title: x.posicao == null ? '' : `Sua loja está acima de ${x.posicao}% das lojas da rede` }, barra, x.posicao == null ? '' : h('small', null, ` acima de ${x.posicao}%`)));
      });
      // celular (LMOB-05, lote 3): um indicador por linha — sua loja à direita; média, melhores 25% e a posição embaixo
      const linhasMob = () => h('div', { class: 'lmob rede-lmob' }, r.indicadores.map((x) => {
        const f = FMT[x.formato] || fmt.n2;
        const acima = x.minha != null && x.minha >= x.media;
        return h('div', { class: 'lmob-it' },
          h('div', { class: 'lmob-l1' }, h('span', { class: 'lmob-nome' }, x.nome), h('span', { class: 'lmob-val ' + (x.minha == null ? 'muted' : neutro.has(x.k) ? '' : acima ? 'pos' : 'neg') }, x.minha == null ? '—' : f(x.minha))),
          h('div', { class: 'lmob-l2' }, h('span', null, `média ${f(x.media)}`), h('span', null, `melhores 25% ${f(x.top25)}`), x.posicao == null ? null : h('span', null, `acima de ${x.posicao}% das lojas`)),
          x.posicao == null ? null : h('div', { class: 'lmob-barra' }, h('i', { style: { width: Math.max(4, x.posicao) + '%' } })));
      }));
      corpo.replaceChildren(
        r.parcial ? h('div', { class: 'muted', style: { marginBottom: '8px', fontSize: '12px' } }, `Todas as lojas comparadas de ${fmt.date(r.de || de)} até ${fmt.date(r.ate)} (o último dia com vendas de todas). ${r.lojas} lojas na comparação.${de.slice(0, 7) !== ate.slice(0, 7) ? ' Ritmo da meta só aparece com o período dentro de um mês.' : ''}`) : h('div', { class: 'muted', style: { marginBottom: '8px', fontSize: '12px' } }, `${r.lojas} lojas na comparação.${de.slice(0, 7) !== ate.slice(0, 7) ? ' Ritmo da meta só aparece com o período dentro de um mês.' : ''}`),
        TS.ehCelular() ? linhasMob() : h('div', { class: 'table-wrap free' }, h('table', { class: 't rede-t' }, h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Indicador'), h('th', null, 'Sua loja'), h('th', null, 'Média da rede'), h('th', null, 'Melhores 25%'), h('th', { class: 'l' }, 'Posição'))), h('tbody', null, linhas))));
    }).catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
    return card;
  };

  /** alertas da loja (Resumo) */
  TS.cartaoAlertas = function () {
    const loja = lojaUnicaSel();
    if (!loja || TS.eu?.perfil === 'vendedor') return null;
    const box = h('div', { class: 'alertas', hidden: true });
    fetch(TS.api(`alertas?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }).then((r) => r.json()).then((r) => {
      const al = (r.alertas || []).slice(0, 6);
      if (!al.length) return;
      // etiqueta de prazo em texto (redesenho): queda grave = agora; queda e meta = esta semana; alta = ok; o resto = para saber
      const nivel = (a) => (a.tipo === 'alta' ? 'ok' : a.tipo === 'queda' && a.gravidade >= 2 ? 'agora' : a.tipo === 'queda' || a.tipo === 'meta' ? 'semana' : 'saber');
      const ROT = { ok: 'Destaque' };
      box.replaceChildren(TS.cardSec('Alertas e destaques', { dica: 'O que mudou nas vendas da loja: quedas e altas fortes, a meta e os vendedores fora do ritmo. A etiqueta diz a urgência.' },
        h('ul', { class: 'alertas-l' }, al.map((a) => h('li', { class: 'al-' + a.tipo + (a.gravidade >= 2 ? ' grave' : '') }, TS.etqPrazo(nivel(a), ROT[nivel(a)]), h('span', null, a.texto))))));
      box.hidden = false;
    }).catch(() => {});
    return box;
  };

  /** logo e nome da loja no topo */
  TS.aplicarMarca = function () {
    const brand = document.querySelector('.brand');
    if (!brand || TS.demo) return;
    const l = (TS.lojas || []).find((x) => x.id === state.loja);
    const mark = brand.querySelector('.brand-mark');
    brand.querySelector('.brand-logo')?.remove();
    if (l && l.marca && l.marca.logo) {
      mark.hidden = true;
      mark.after(h('img', { class: 'brand-logo', src: `/marca/${encodeURIComponent(l.id)}/logo?v=${Date.now() % 1e6}`, alt: '' }));
    } else mark.hidden = false;
    const sub = brand.querySelector('.brand-sub');
    if (sub) sub.textContent = l ? l.marca?.nome || l.nome : (TS.lojas || []).length > 1 ? 'Todas as lojas' : 'Painel de vendas';
  };
})();
