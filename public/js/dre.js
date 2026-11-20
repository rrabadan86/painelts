/* Resultado do mês (DRE simplificada): faturamento → impostos e taxas → custo dos produtos → comissões →
 * custos fixos → resultado. Só admin e franqueado (usa custos do estoque). */
'use strict';
(function () {
  const { h, fmt, state } = TS;

  const novo = () => ({ fat: 0, fatCusto: 0, custo: 0, imp: 0, maq: 0, roy: 0, com: 0, varPct: 0, gorjeta: 0, desc: 0, dias: new Set(), eg: 0 });
  /** soma uma linha de venda nas contas do Resultado (a mesma regra para o mês e para um intervalo de dias) */
  function somarLinha(m, i, M) {
    const db = TS.db, I = TS.rules.ids, D = M.ded;
    if (I.taxaServico.has(db.desc[i])) { m.gorjeta += db.vt[i] || 0; return; }
    if (M.taxa(i)) return;
    const vt = db.vt[i] || 0;
    m.fat += vt; m.dias.add(db.day[i]);
    if (I.eg.has(db.cat[i])) m.eg += vt;
    m.desc += TS.descontos([i]);
    const dd = D.deducoes(i);
    m.imp += dd.imp; m.maq += dd.maq; m.roy += dd.roy; m.com += dd.com;
    m.varPct += dd.outros.reduce((a, v, k) => a + (D.OUTROS[k].tipo === 'pct' ? v : 0), 0);
    const c = M.custo(i);
    if (c != null) { m.fatCusto += vt; m.custo += c; }
  }
  /** Margem de contribuição de um intervalo de dias (Início → "Sua semana"): as mesmas linhas do Resultado até a margem de
   *  contribuição — faturamento − Simples, maquininha e royalties − custo dos produtos (vendas sem custo pelo mesmo %) −
   *  comissões (% efetivo do mês) − custos em %. Sem perdas e sem custos fixos, que são do mês. Todos os dias, sem os filtros.
   *  → { fat, contrib (null sem custo nenhum), cobre } */
  TS.dreContribDias = function (M, de, ate) {
    const db = TS.db, m = novo();
    for (let i = 0; i < db.n; i++) { const d = db.day[i]; if (d >= de && d <= ate) somarLinha(m, i, M); }
    const cmv = m.fatCusto ? m.custo + (m.fat - m.fatCusto) * (m.custo / m.fatCusto) : null;
    return { fat: m.fat, contrib: cmv == null ? null : m.fat - m.imp - m.maq - m.roy - cmv - m.com - m.varPct, cobre: m.fat ? m.fatCusto / m.fat : 0 };
  };

  /** números de cada mês da loja (todos os dias do mês, sem os filtros do topo) */
  /** opts: { soYm, ateDia, frac } — um mês só, até o dia ateDia (comparação do mês em andamento com os mesmos dias)
   *  opts.perdas: { 'AAAA-MM': { total, vencidos, inventario, … } } de /api/perdas (src/perdas.js); sem ele a linha fica "—" e não desconta */
  function calcular(M, opts = {}) {
    const db = TS.db, D = M.ded;
    const porMes = new Map();
    for (let i = 0; i < db.n; i++) {
      const ym = db.ym[i];
      if (opts.soYm && (ym !== opts.soYm || +db.iso[i].slice(8, 10) > opts.ateDia)) continue;
      let m = porMes.get(ym);
      if (!m) porMes.set(ym, (m = novo()));
      somarLinha(m, i, M);
    }
    const fixos = D.OUTROS.filter((x) => x.tipo === 'mes');
    const hoje = TS.todayDay(), ymHoje = TS.dayToIso(hoje).slice(0, 7);
    const out = [];
    for (const [ym, m] of [...porMes].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!m.fat) continue;
      const diasMes = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
      const ini = TS.isoToDay(ym + '-01');
      const parcial = !opts.soYm && (ym === ymHoje || ym > ymHoje);
      const ultimo = Math.max(...m.dias);
      // dias que já passaram (mês em andamento): base da projeção. Custos fixos entram sempre pelo valor cheio do mês
      const decorridos = Math.min(diasMes, Math.max(1, ultimo - ini + 1));
      const frac = parcial ? decorridos / diasMes : 1;
      // custo dos produtos: o das vendas com custo + as sem custo pelo mesmo % (estimado)
      const cmvPct = m.fatCusto ? m.custo / m.fatCusto : null;
      const cmv = cmvPct == null ? null : m.custo + (m.fat - m.fatCusto) * cmvPct;
      // custos fixos do mês (valor cheio, também no mês em andamento) + despesas de um mês só (cheias no mês delas)
      const fixosMes = [...fixos.map((x) => ({ nome: x.nome, cat: D.catDe ? D.catDe(x) : 'outros', valor: x.valor })),
        ...(D.pontuaisDoMes ? D.pontuaisDoMes(ym) : []).map((x) => ({ nome: x.nome, cat: D.catDe(x), valor: x.valor, pontual: true }))];
      const fixoTot = fixosMes.reduce((a, x) => a + x.valor, 0);
      const impostos = m.imp + m.maq + m.roy;
      const recLiq = m.fat - impostos;
      // perdas do mês (chá vencido ainda no estoque + faltas do inventário, a custo): entram depois do custo dos produtos
      const perdasDet = opts.perdas ? opts.perdas[ym] || { total: 0, vencidos: 0, inventario: 0, nVencidos: 0, nContagens: 0 } : null;
      const perdas = perdasDet ? perdasDet.total : null;
      const lucroBruto = cmv == null ? null : recLiq - cmv - (perdas || 0);
      const contrib = lucroBruto == null ? null : lucroBruto - m.com - m.varPct;
      const resultado = contrib == null ? null : contrib - fixoTot;
      const r = { ym, parcial, frac, ultimo, diasMes, decorridos, ...m, dias: m.dias.size, cmv, cmvPct, perdas, perdasDet, cobre: m.fat ? m.fatCusto / m.fat : 0, fixosMes, fixoTot, impostos, recLiq, lucroBruto, contrib, resultado };
      if (parcial) r.proj = projetar(r, D);
      out.push(r);
    }
    return out;
  }
  /** mês em andamento projetado: o faturamento vem da projeção única (TS.projecaoMes: vendas até ontem + cada dia que falta
   *  pela média do dia da semana); o que depende das vendas cresce na mesma proporção; os custos fixos ficam iguais (já são
   *  cheios). A comissão NÃO é a parcial multiplicada: é recalculada com a venda projetada de cada pessoa contra a meta. */
  function projetar(m, D) {
    const PM = TS.projecaoMes ? TS.projecaoMes(m.ym, { base: 'loja', todas: true }) : null;
    const k = PM && m.fat > 0 ? PM.proj / m.fat : m.diasMes / m.decorridos;
    const x = (v) => (v == null ? null : v * k);
    const comP = D && D.comProjetada ? D.comProjetada(m.ym, k) : null;
    const p = { ...m, parcial: false, projecao: true, fat: m.fat * k, fatCusto: m.fatCusto * k, custo: m.custo * k, imp: m.imp * k, maq: m.maq * k, roy: m.roy * k, com: comP != null ? comP : m.com * k, varPct: m.varPct * k, projMes: PM, fator: k,
      gorjeta: m.gorjeta * k, desc: m.desc * k, eg: m.eg * k, cmv: x(m.cmv) };
    p.impostos = p.imp + p.maq + p.roy;
    p.recLiq = p.fat - p.impostos;
    p.lucroBruto = p.cmv == null ? null : p.recLiq - p.cmv - (p.perdas || 0); // as perdas não crescem com as vendas: ficam as de agora
    p.contrib = p.lucroBruto == null ? null : p.lucroBruto - p.com - p.varPct;
    p.resultado = p.contrib == null ? null : p.contrib - p.fixoTot;
    return p;
  }

  // linhas da DRE: [rótulo, chave/função, tipo] tipo: 'sub' (subtotal), 'tot' (resultado), 'menos', 'info'
  /** grupos: [{ id, nome, itens:[índice em fixosMes] }] — cada categoria vira uma linha com o subtotal, que abre os custos */
  const LINHAS = (grupos, abertos) => [
    ['Faturamento', (m) => m.fat, 'base', 'Faturamento da loja: tudo o que foi vendido, com Espaço Gourmet e vendas sem vendedor, já com os descontos; sem taxa de serviço e entrega e sem itens a R$ 0,01 (resgates e brindes). É o mesmo número do Resumo e do Início'],
    ['− Simples Nacional', (m) => m.imp, 'menos', '% do Simples (Configurações → Lojas → Estoque e margem) sobre as vendas'],
    ['− Maquininha', (m) => m.maq, 'menos', 'Taxa média da maquininha sobre as vendas'],
    ['− Royalties + marketing', (m) => m.roy, 'menos', 'Pelas regras da loja: loja + marketing; Espaço Gourmet: EG + marketing EG'],
    ['= Receita líquida', (m) => m.recLiq, 'sub', 'Faturamento − impostos e taxas sobre a venda'],
    ['− Custo dos produtos', (m) => m.cmv, 'menos', 'Custo do AppNext das vendas (chá pelo kg + saco e etiquetas). Vendas sem custo no estoque entram pelo mesmo % das outras (estimado)'],
    ['− Perdas (vencidos e inventário)', (m) => m.perdas, 'menos', 'O que a loja pagou e não vai vender, a custo: (1) chá a granel VENCIDO que ainda está no estoque, no mês em que a validade venceu (saldo do lote × custo do kg, os lotes da tela Validade); (2) faltas do INVENTÁRIO: contagens aplicadas no AppNext no mês, pelo saldo dos ajustes (contado − sistema) × custo — sobra compensa falta, e só o saldo negativo do mês entra. Na projeção ficam as perdas de agora (não crescem com as vendas). "—" = o painel não conseguiu ler as perdas'],
    ['= Lucro bruto', (m) => m.lucroBruto, 'sub', 'Receita líquida − custo dos produtos − perdas'],
    ['− Comissões e premiações', (m) => m.com, 'menos', 'O que a loja pagou no mês (comissões, premiação e bônus), como no Comissionamento. Na projeção do mês em andamento: a comissão que cada pessoa receberia com a venda projetada dela contra a meta (na faixa em que fecharia), não a comissão de agora multiplicada'],
    ['− Outros custos em %', (m) => m.varPct, 'menos', 'Custos da loja cadastrados como % das vendas'],
    ['= Margem de contribuição', (m) => m.contrib, 'sub', 'O que sobra para pagar os custos fixos'],
    ...grupos.flatMap((g) => [
      [`− ${g.nome}`, (m) => m.fixosMes.filter((x) => x.cat === g.id).reduce((a, x) => a + x.valor, 0), 'grupo', `${g.nomes.length} ${g.nomes.length === 1 ? 'custo' : 'custos'}: ${g.nomes.map((n) => n.nome + (n.pontual ? ' (pontual)' : '')).join(', ')}. Clique para ${abertos.has(g.id) ? 'fechar' : 'abrir'}.`, g.id],
      ...(abertos.has(g.id) ? g.nomes.map((n) => [n.pontual ? `${n.nome} · pontual` : n.nome, (m) => { const l = m.fixosMes.filter((x) => x.cat === g.id && x.nome === n.nome && !!x.pontual === n.pontual); return l.length ? l.reduce((a, x) => a + x.valor, 0) : null; }, 'filho',
        n.pontual ? 'Despesa de um mês só: entra cheia no mês dela' : 'Custo fixo cadastrado: entra pelo valor cheio do mês, também no mês em andamento']) : []),
    ]),
    ['= Resultado do mês', (m) => m.resultado, 'tot', 'Margem de contribuição − custos fixos'],
  ];

  TS.pages.dre = function (root) {
    if (TS.subEstoque) root.append(TS.subEstoque('dre'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Resultado do mês'),
      h('div', { class: 'page-sub' }, 'Do faturamento ao lucro: impostos, custo dos produtos, comissões e custos fixos, mês a mês'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'O resultado é de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Calculando…'))));
    root.append(corpo);
    Promise.all([TS.custosLoja(), buscarPerdas(state.loja)]).then(([M, perdas]) => {
      if (!corpo.isConnected) return;
      if (!M) { corpo.replaceChildren(h('div', { class: 'notice' }, 'Ainda não há estoque desta loja: o resultado precisa do custo dos produtos. Envie a planilha de estoque em Configurações → Lojas.')); return; }
      pintar(corpo, M, perdas);
      // ponto de equilíbrio do mês (quanto vender para pagar os fixos) logo depois dos quadros do mês
      if (TS.cartaoEquilibrio) { const eq = TS.cartaoEquilibrio(state.loja); const ref = corpo.querySelector('.dre-eq-aqui'); ref ? ref.replaceWith(eq) : corpo.append(eq); }
    }).catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  };

  /** linha discreta depois dos quadros: quanto de perdas o resultado do mês já inclui e como seria sem elas */
  function linhaPerdas(m, sel) {
    const d = m.perdasDet;
    if (!d || m.resultado == null) return null;
    const partes = [d.vencidos > 0 ? `${fmt.brl0(d.vencidos)} de chá vencido (${fmt.int(d.nVencidos)} ${d.nVencidos === 1 ? 'lote' : 'lotes'})` : null, d.inventario > 0 ? `${fmt.brl0(d.inventario)} de faltas no inventário (${fmt.int(d.nContagens)} ${d.nContagens === 1 ? 'contagem' : 'contagens'})` : null].filter(Boolean);
    const como = `Perdas = o que a loja pagou e não vai vender, a custo.\n\n1. Chá a granel vencido que ainda está no estoque: saldo do lote × custo do kg, no mês em que a validade venceu (os lotes de Estoque → Validade).${d.semCusto ? ` ${fmt.int(d.semCusto)} lote(s) vencido(s) sem custo no AppNext entraram com zero.` : ''}\n\n2. Faltas do inventário: contagens aplicadas no AppNext no mês, (contado − sistema) × custo. As contagens do mês são somadas: sobra compensa falta, e só o saldo negativo vira perda${d.nContagens ? ` (faltas ${fmt.brl0(d.faltasInv || 0)} − sobras ${fmt.brl0(d.sobrasInv || 0)})` : ''}.\n\nLimites: o painel só conhece o chá vencido que ainda está no estoque de hoje — quando ele é jogado fora e o inventário zera o saldo, a perda passa a aparecer nas faltas do inventário, no mês da contagem. Produto que não é chá a granel só entra pelo inventário.`;
    if (!partes.length) return h('p', { class: 'dre-perdas muted', 'data-perdas': '0' }, `Sem perdas em ${TS.ymLabel(sel)}: nenhum lote venceu no estoque e o inventário não teve falta.`, TS.dica(como));
    return h('p', { class: 'dre-perdas muted', 'data-perdas': String(m.perdas) }, h('b', null, `O resultado de ${TS.ymLabel(sel)} inclui ${fmt.brl0(m.perdas)} de perdas`), `: ${partes.join(' + ')}. Sem as perdas seria ${fmt.brl0(m.resultado + m.perdas)}. `,
      d.vencidos > 0 ? h('a', { href: '#validade' }, 'ver a validade ›') : h('a', { href: '#inventario' }, 'ver o inventário ›'), TS.dica(como));
  }

  /** perdas por mês da loja (/api/perdas; 2 min em memória). null se o painel não conseguiu ler: a linha fica "—" */
  const perdasCache = new Map();
  TS.aoLimparCache && TS.aoLimparCache(() => perdasCache.clear());
  async function buscarPerdas(loja) {
    const c = perdasCache.get(loja);
    if (c && Date.now() - c.at < 120e3) return c.meses;
    try {
      const r = await fetch(TS.api(`perdas?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' });
      if (!r.ok) return null;
      const j = await r.json();
      perdasCache.set(loja, { at: Date.now(), meses: j.meses || {} });
      return j.meses || {};
    } catch { return null; }
  }
  TS.dreCalcular = calcular; // testes de tela

  function pintar(corpo, M, perdas) {
    corpo.replaceChildren();
    const meses = calcular(M, { perdas });
    if (!meses.length) { corpo.append(TS.empty()); return; }
    const fixos = M.ded.OUTROS.filter((x) => x.tipo === 'mes');
    const fixosNomes = fixos.map((x) => x.nome);
    const cats = M.ded.CATS || [{ id: 'outros', nome: 'Outros' }];
    // cada categoria lista os custos que aparecem em algum mês (fixos e pontuais)
    const grupos = cats.map((c) => {
      const vistos = new Map();
      for (const mm of meses) for (const x of mm.fixosMes) if (x.cat === c.id) vistos.set(`${x.pontual ? 'p' : 'f'}|${x.nome}`, { nome: x.nome, pontual: !!x.pontual });
      return { id: c.id, nome: c.nome, nomes: [...vistos.values()].sort((a, b) => a.pontual - b.pontual) };
    }).filter((g) => g.nomes.length);
    const abertos = state.dreAbertos || (state.dreAbertos = new Set());
    const linhas = LINHAS(grupos, abertos);
    const sel = state.dreMes && meses.some((m) => m.ym === state.dreMes) ? state.dreMes : meses[meses.length - 1].ym;
    const m = meses.find((x) => x.ym === sel);
    const ymAnt = `${+sel.slice(0, 4) - 1}${sel.slice(4)}`;
    // mês em andamento: "até hoje" (vendas até hoje, custos fixos cheios) e "projeção" (no ritmo atual), comparada com o mesmo mês inteiro do ano anterior;
    // o faturamento do topo também se compara com os mesmos dias do ano anterior
    const diaAte = +TS.dayToIso(m.ultimo).slice(8, 10);
    const a = meses.find((x) => x.ym === ymAnt) || null;
    const aDias = m.parcial ? (calcular(M, { soYm: ymAnt, ateDia: diaAte, perdas })[0] || null) : a;
    const rotAnt = TS.ymLabel(ymAnt);
    const P = m.proj || null;
    const base = P || m; // o que a coluna "Variação" compara com o ano anterior
    const pc = (v, base) => (v == null || !base ? '—' : fmt.pct(v / base));

    // seletor de mês e avisos
    const opMes = h('select', { class: 'f-input', style: { width: 'auto' } }, [...meses].reverse().map((x) => h('option', { value: x.ym, selected: x.ym === sel || null }, `${TS.ymLabel(x.ym)}${x.parcial ? ' (em andamento)' : ''}`)));
    opMes.addEventListener('change', () => { state.dreMes = opMes.value; TS.render(); });
    const avisos = [];
    if (!fixosNomes.length && !(M.ded.PONTUAIS || []).length) avisos.push('Cadastre os custos fixos (aluguel, salários, energia…) pelo link "+ Adicionar ou editar custos da loja", logo abaixo da tabela, para o resultado ficar completo.');
    if (!perdas) avisos.push('O painel não conseguiu ler as perdas (chá vencido e faltas do inventário): o resultado abaixo está SEM esse desconto.');
    if (m.cobre < 0.95) avisos.push(`${fmt.pct(1 - m.cobre, 0)} das vendas de ${TS.ymLabel(sel)} não têm custo no estoque: o custo delas foi estimado pelo mesmo % das outras (${fmt.pct(m.cmvPct)}).`);
    // mês em andamento: uma linha discreta depois dos quadros, com a explicação completa no ⓘ
    const andamento = !m.parcial ? null : `${TS.ymLabel(sel)} está em andamento (vendas até ${fmt.date(TS.dayToIso(m.ultimo))}, ${m.decorridos} de ${m.diasMes} dias). "Até hoje" usa as vendas até agora e os custos fixos inteiros: enquanto der negativo, é o que ainda falta cobrir. "Projeção do mês" leva as vendas no ritmo atual até o fim do mês (impostos, custo dos produtos, comissões e custos em % acompanham as vendas; os fixos ficam iguais).`;

    // cartões do topo
    const kp = (rot, v, sub, cls) => TS.kpi(rot, v == null ? '—' : fmt.brl0(v), sub, null);
    const varA = (k) => (aDias && aDias[k] ? h('span', null, TS.deltaSpan(m[k] / aDias[k] - 1), ` vs. ${m.parcial ? `${rotAnt} (dias 1 a ${diaAte})` : rotAnt}`) : null);
    corpo.append(h('div', { class: 'dre-topo' }, h('label', null, 'Mês ', opMes), h('span', { class: 'muted' }, 'Todos os dias do mês, sem os filtros do topo. Custos fixos e % com os valores cadastrados hoje.')),
      ...avisos.map((t) => h('div', { class: 'notice' }, t)),
      h('div', { class: 'grid g-kpi' },
        kp('Faturamento', m.fat, varA('fat')),
        TS.kpi('Lucro bruto', m.lucroBruto == null ? '—' : fmt.brl0(m.lucroBruto), h('span', null, `margem ${pc(m.lucroBruto, m.fat)}${m.perdas > 0 ? ` · já sem ${fmt.brl0(m.perdas)} de perdas` : ''}`), 'Receita líquida − custo dos produtos − perdas (chá vencido ainda no estoque e faltas do inventário, a custo).'),
        kp('Margem de contribuição', m.contrib, h('span', null, `${pc(m.contrib, m.fat)} do faturamento`)),
        m.parcial
          ? TS.kpi('Resultado até hoje', m.resultado == null ? '—' : fmt.brl0(m.resultado), h('span', { class: m.resultado >= 0 ? 'up' : 'down' }, m.resultado == null ? '' : m.resultado >= 0 ? 'custos fixos do mês já cobertos' : `falta cobrir ${fmt.brl0(-m.resultado)} dos custos fixos`, m.perdas > 0 ? ` · inclui ${fmt.brl0(m.perdas)} de perdas` : ''), 'Margem de contribuição até hoje − custos fixos do mês inteiro. As perdas do mês (chá vencido e faltas do inventário) já foram descontadas no lucro bruto.')
          : TS.kpi('Resultado do mês', m.resultado == null ? '—' : fmt.brl0(m.resultado), h('span', { class: m.resultado >= 0 ? 'up' : 'down' }, `${pc(m.resultado, m.fat)} do faturamento${m.perdas > 0 ? ` · inclui ${fmt.brl0(m.perdas)} de perdas` : ''}`), 'Margem de contribuição − custos fixos. As perdas do mês (chá vencido e faltas do inventário) já foram descontadas no lucro bruto.'),
        P ? TS.kpi('Projeção do mês', P.resultado == null ? '—' : fmt.brl0(P.resultado), h('span', { class: P.resultado >= 0 ? 'up' : 'down' }, `vendendo ${fmt.brl0(P.fat)} no mês (ritmo atual)`),
          `Resultado se as vendas seguirem o ritmo de agora até o fim do mês. Impostos, custo dos produtos e custos em % acompanham as vendas; a comissão é recalculada com a venda projetada de cada pessoa contra a meta; os custos fixos ficam iguais.${P.projMes ? '\n\nFaturamento projetado:\n' + TS.comoProjecao(P.projMes) : ''}`) : null),
      linhaPerdas(m, sel),
      andamento ? h('p', { class: 'dre-andamento muted' }, `Mês em andamento: ${m.decorridos} de ${m.diasMes} dias. "Até hoje" usa as vendas até agora e os custos fixos inteiros.`, TS.dica(andamento)) : null,
      h('div', { class: 'dre-eq-aqui' }));

    // DRE do mês × mesmo mês do ano anterior
    const tb = h('table', { class: 't dre-t' });
    tb.append(h('thead', null, h('tr', null, h('th', { class: 'l' }, ''),
      h('th', null, P ? `Até hoje (dia ${diaAte})` : TS.ymLabel(sel)), h('th', null, '%'),
      P ? h('th', { class: 'dre-proj' }, 'Projeção do mês') : null, P ? h('th', { class: 'dre-proj' }, '%') : null,
      h('th', null, a ? `${rotAnt}${P ? ' (mês inteiro)' : ''}` : 'Ano anterior'), h('th', null, '%'),
      h('th', { class: 'dre-var', title: P ? `Projeção do mês de ${TS.ymLabel(sel)} contra ${rotAnt} INTEIRO (o mês fechado do ano anterior, não só os mesmos dias)` : `${TS.ymLabel(sel)} contra ${rotAnt}, os dois meses inteiros` }, P ? `Projeção × ${rotAnt} inteiro` : 'Variação'))));
    const body = h('tbody');
    const alternar = (id) => { if (abertos.has(id)) abertos.delete(id); else abertos.add(id); TS.render(); };
    for (const [rot, f, tipo, dica, gid] of linhas) {
      const v = f(m), vp = P ? f(P) : null, va = a ? f(a) : null, vb = f(base);
      const d = vb != null && va ? vb / va - 1 : null;
      const bom = tipo === 'menos' || tipo === 'grupo' || tipo === 'filho' ? d < 0 : d > 0;
      const rotL = tipo === 'tot' && P ? '= Resultado' : rot;
      body.append(h('tr', { class: 'dre-' + tipo, title: dica, onclick: gid ? () => alternar(gid) : null },
        h('td', { class: 'l' }, gid ? h('span', { class: 'dre-seta' }, abertos.has(gid) ? '▾ ' : '▸ ') : null, rotL),
        h('td', { class: tipo === 'tot' && v < 0 ? 'neg' : null }, v == null ? '—' : fmt.brl(v)), h('td', { class: 'muted' }, pc(v, m.fat)),
        P ? h('td', { class: 'dre-proj' + (tipo === 'tot' && vp < 0 ? ' neg' : '') }, vp == null ? '—' : fmt.brl(vp)) : null, P ? h('td', { class: 'muted dre-proj' }, pc(vp, P.fat)) : null,
        h('td', null, va == null ? '—' : fmt.brl(va)), h('td', { class: 'muted' }, a ? pc(va, a.fat) : '—'),
        h('td', { class: d == null || Math.abs(d) < 0.0005 ? 'muted' : bom ? 'pos' : 'neg' }, d == null ? '—' : fmt.delta(d))));
    }
    if (P && m.resultado != null && m.resultado < 0) body.append(h('tr', { class: 'dre-info' }, h('td', { class: 'l' }, 'Falta cobrir dos custos fixos'), h('td', { class: 'neg' }, fmt.brl(-m.resultado)), h('td', { class: 'muted' }, ''),
      h('td', { class: 'dre-proj muted', colspan: 2 }, P.resultado >= 0 ? 'no ritmo atual, fecha no azul' : 'no ritmo atual, fecha no vermelho'), h('td', { colspan: 3 }, '')));
    tb.append(body);
    const linkCustos = !(TS.eu && TS.eu.pode && TS.eu.pode.configurar) ? null : h('div', { class: 'dre-links' },
      h('a', { href: '#config', onclick: (e) => { e.preventDefault(); TS.editarCustos(state.loja); } }, '+ Adicionar ou editar custos da loja'),
      h('a', { href: '#config', onclick: (e) => { e.preventDefault(); TS.editarCustos(state.loja, 'cfg-pontuais'); } }, '+ Despesa de um mês só (ex.: IPTU, 13º)'));
    const memo = h('div', { class: 'dre-memo muted' },
      `Fora do resultado (informativo): taxa de serviço recebida ${fmt.brl(m.gorjeta)} (repassada à equipe) · descontos dados ${fmt.brl(m.desc)} · Espaço Gourmet ${fmt.brl(m.eg)} (${pc(m.eg, m.fat)} do faturamento). Passe o mouse em cada linha para ver de onde vem o valor.`);
    corpo.append(h('div', { class: 'mt' }, TS.card(`Resultado de ${TS.ymLabel(sel)}`, a ? (P ? `Até hoje e projeção no ritmo atual; a variação compara a projeção com ${rotAnt} inteiro` : `Comparado com ${rotAnt}`) : 'Sem o mesmo mês do ano anterior para comparar', h('div', { class: 'table-wrap free' }, tb), memo, linkCustos)));

    // gráfico: resultado mês a mês
    const comoMes = (x) => x.proj || x; // mês em andamento entra pela projeção, para comparar com os meses fechados
    const ult = meses.slice(-13).map(comoMes);
    corpo.append(h('div', { class: 'mt' }, TS.card('Resultado mês a mês', 'Barras = resultado do mês (verde lucro, vermelho prejuízo) · linha = margem de contribuição · * mês em andamento pela projeção (cor clara)', TS.chart({
      type: 'bar',
      data: { labels: ult.map((x) => TS.ymLabel(x.ym) + (x.projecao ? '*' : '')),
        datasets: [
          { type: 'bar', label: 'Resultado', data: ult.map((x) => x.resultado), backgroundColor: ult.map((x) => (x.resultado >= 0 ? (x.projecao ? '#8FB39A' : '#2C5234') : x.projecao ? '#E3A595' : '#B5452B')), borderRadius: 4, order: 2 },
          { type: 'line', label: 'Margem de contribuição', data: ult.map((x) => x.contrib), borderColor: '#C9A227', backgroundColor: '#C9A227', tension: 0.3, pointRadius: 3, order: 1 },
        ] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.brl0(c.raw)}` } } }, scales: { y: TS.axisNum(fmt.brl0), x: TS.axisCat } },
    }))));

    // tabela mês a mês (12 meses)
    const ult12 = meses.slice(-12).map(comoMes);
    const t2 = h('table', { class: 't dre-t' });
    t2.append(h('thead', null, h('tr', null, h('th', { class: 'l sticky-col' }, ''), ult12.map((x) => h('th', { class: x.projecao ? 'dre-proj' : null }, TS.ymLabel(x.ym) + (x.projecao ? '*' : ''))))));
    const b2 = h('tbody');
    for (const [rot, f, tipo, dica, gid] of linhas) b2.append(h('tr', { class: 'dre-' + tipo, title: dica, onclick: gid ? () => alternar(gid) : null }, h('td', { class: 'l sticky-col' }, gid ? h('span', { class: 'dre-seta' }, abertos.has(gid) ? '▾ ' : '▸ ') : null, rot), ult12.map((x) => { const v = f(x); return h('td', { class: tipo === 'tot' && v < 0 ? 'neg' : null }, v == null ? '—' : fmt.brl0(v)); })));
    b2.append(h('tr', { class: 'dre-info' }, h('td', { class: 'l sticky-col' }, 'Resultado em % do faturamento'), ult12.map((x) => h('td', { class: x.resultado < 0 ? 'neg' : null }, pc(x.resultado, x.fat)))));
    t2.append(b2);
    corpo.append(h('div', { class: 'mt' }, TS.card('Mês a mês', '* mês em andamento: projeção no ritmo atual, com os custos fixos inteiros', h('div', { class: 'table-wrap' }, t2))));
    // compras × vendas do mês: estou comprando mais do que vendo? (comprasvendas.js)
    if (TS.comprasVendas) corpo.append(TS.comprasVendas.cartaoResultado(M));
  }
})();
