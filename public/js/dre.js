/* Resultado do mês (DRE simplificada): faturamento → impostos e taxas → custo dos produtos → comissões →
 * custos fixos → resultado. Só admin e franqueado (usa custos do estoque). */
'use strict';
(function () {
  const { h, fmt, state } = TS;

  /** números de cada mês da loja (todos os dias do mês, sem os filtros da lateral) */
  /** opts: { soYm, ateDia, frac } — um mês só, até o dia ateDia (comparação do mês em andamento com os mesmos dias) */
  function calcular(M, opts = {}) {
    const db = TS.db, I = TS.rules.ids, D = M.ded;
    const porMes = new Map();
    const novo = () => ({ fat: 0, fatCusto: 0, custo: 0, imp: 0, maq: 0, roy: 0, com: 0, varPct: 0, gorjeta: 0, desc: 0, dias: new Set(), eg: 0 });
    for (let i = 0; i < db.n; i++) {
      const ym = db.ym[i];
      if (opts.soYm && (ym !== opts.soYm || +db.iso[i].slice(8, 10) > opts.ateDia)) continue;
      let m = porMes.get(ym);
      if (!m) porMes.set(ym, (m = novo()));
      if (I.taxaServico.has(db.desc[i])) { m.gorjeta += db.vt[i] || 0; continue; }
      if (M.taxa(i)) continue;
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
    const fixos = D.OUTROS.filter((x) => x.tipo === 'mes');
    const hoje = TS.todayDay(), ymHoje = TS.dayToIso(hoje).slice(0, 7);
    const out = [];
    for (const [ym, m] of [...porMes].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!m.fat) continue;
      const diasMes = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
      const ini = TS.isoToDay(ym + '-01');
      const parcial = !opts.soYm && (ym === ymHoje || ym > ymHoje);
      const ultimo = Math.max(...m.dias);
      const frac = opts.frac != null ? opts.frac : parcial ? Math.min(1, Math.max(1, ultimo - ini + 1) / diasMes) : 1;
      // custo dos produtos: o das vendas com custo + as sem custo pelo mesmo % (estimado)
      const cmvPct = m.fatCusto ? m.custo / m.fatCusto : null;
      const cmv = cmvPct == null ? null : m.custo + (m.fat - m.fatCusto) * cmvPct;
      // custos fixos do mês (proporcionais no mês em andamento) + despesas de um mês só (valor cheio no mês delas)
      const fixosMes = [...fixos.map((x) => ({ nome: x.nome, cat: D.catDe ? D.catDe(x) : 'outros', valor: x.valor * frac })),
        ...(D.pontuaisDoMes ? D.pontuaisDoMes(ym) : []).map((x) => ({ nome: x.nome, cat: D.catDe(x), valor: x.valor, pontual: true }))];
      const fixoTot = fixosMes.reduce((a, x) => a + x.valor, 0);
      const impostos = m.imp + m.maq + m.roy;
      const recLiq = m.fat - impostos;
      const lucroBruto = cmv == null ? null : recLiq - cmv;
      const contrib = lucroBruto == null ? null : lucroBruto - m.com - m.varPct;
      const resultado = contrib == null ? null : contrib - fixoTot;
      out.push({ ym, parcial, frac, ultimo, ...m, dias: m.dias.size, cmv, cmvPct, cobre: m.fat ? m.fatCusto / m.fat : 0, fixosMes, fixoTot, impostos, recLiq, lucroBruto, contrib, resultado });
    }
    return out;
  }

  // linhas da DRE: [rótulo, chave/função, tipo] tipo: 'sub' (subtotal), 'tot' (resultado), 'menos', 'info'
  /** grupos: [{ id, nome, itens:[índice em fixosMes] }] — cada categoria vira uma linha com o subtotal, que abre os custos */
  const LINHAS = (grupos, abertos) => [
    ['Faturamento', (m) => m.fat, 'base', 'Vendas da loja (com Espaço Gourmet), já com os descontos, sem taxa de serviço e entrega'],
    ['− Simples Nacional', (m) => m.imp, 'menos', '% do Simples (Configurações → Lojas → Estoque e margem) sobre as vendas'],
    ['− Maquininha', (m) => m.maq, 'menos', 'Taxa média da maquininha sobre as vendas'],
    ['− Royalties + marketing', (m) => m.roy, 'menos', 'Pelas regras da loja: loja + marketing; Espaço Gourmet: EG + marketing EG'],
    ['= Receita líquida', (m) => m.recLiq, 'sub', 'Faturamento − impostos e taxas sobre a venda'],
    ['− Custo dos produtos', (m) => m.cmv, 'menos', 'Custo do AppNext das vendas (chá pelo kg + saco e etiquetas). Vendas sem custo no estoque entram pelo mesmo % das outras (estimado)'],
    ['= Lucro bruto', (m) => m.lucroBruto, 'sub', 'Receita líquida − custo dos produtos'],
    ['− Comissões e premiações', (m) => m.com, 'menos', 'O que a loja pagou no mês (comissões, premiação e bônus), como no Comissionamento'],
    ['− Outros custos em %', (m) => m.varPct, 'menos', 'Custos da loja cadastrados como % das vendas'],
    ['= Margem de contribuição', (m) => m.contrib, 'sub', 'O que sobra para pagar os custos fixos'],
    ...grupos.flatMap((g) => [
      [`− ${g.nome}`, (m) => m.fixosMes.filter((x) => x.cat === g.id).reduce((a, x) => a + x.valor, 0), 'grupo', `${g.nomes.length} ${g.nomes.length === 1 ? 'custo' : 'custos'}: ${g.nomes.map((n) => n.nome + (n.pontual ? ' (pontual)' : '')).join(', ')}. Clique para ${abertos.has(g.id) ? 'fechar' : 'abrir'}.`, g.id],
      ...(abertos.has(g.id) ? g.nomes.map((n) => [n.pontual ? `${n.nome} · pontual` : n.nome, (m) => { const l = m.fixosMes.filter((x) => x.cat === g.id && x.nome === n.nome && !!x.pontual === n.pontual); return l.length ? l.reduce((a, x) => a + x.valor, 0) : null; }, 'filho',
        n.pontual ? 'Despesa de um mês só: entra cheia no mês dela' : 'Custo fixo cadastrado (valor do mês; no mês em andamento, só a parte dos dias que já passaram)']) : []),
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
    TS.custosLoja().then((M) => {
      if (!corpo.isConnected) return;
      if (!M) { corpo.replaceChildren(h('div', { class: 'notice' }, 'Ainda não há estoque desta loja: o resultado precisa do custo dos produtos. Envie a planilha de estoque em Configurações → Lojas.')); return; }
      pintar(corpo, M);
    }).catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  };

  function pintar(corpo, M) {
    corpo.replaceChildren();
    const meses = calcular(M);
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
    // mês em andamento: compara com os mesmos dias do ano anterior (e a mesma parte dos custos fixos)
    const diaAte = +TS.dayToIso(m.ultimo).slice(8, 10);
    const a = m.parcial ? (calcular(M, { soYm: ymAnt, ateDia: diaAte, frac: m.frac })[0] || null) : (meses.find((x) => x.ym === ymAnt) || null);
    const rotAnt = m.parcial ? `${TS.ymLabel(ymAnt)} (dias 1 a ${diaAte})` : TS.ymLabel(ymAnt);
    const pc = (v, base) => (v == null || !base ? '—' : fmt.pct(v / base));

    // seletor de mês e avisos
    const opMes = h('select', { class: 'f-input', style: { width: 'auto' } }, [...meses].reverse().map((x) => h('option', { value: x.ym, selected: x.ym === sel || null }, `${TS.ymLabel(x.ym)}${x.parcial ? ' (em andamento)' : ''}`)));
    opMes.addEventListener('change', () => { state.dreMes = opMes.value; TS.render(); });
    const avisos = [];
    if (!fixosNomes.length && !(M.ded.PONTUAIS || []).length) avisos.push('Cadastre os custos fixos (aluguel, salários, energia…) pelo link "+ Adicionar ou editar custos da loja", logo abaixo da tabela, para o resultado ficar completo.');
    if (m.cobre < 0.95) avisos.push(`${fmt.pct(1 - m.cobre, 0)} das vendas de ${TS.ymLabel(sel)} não têm custo no estoque: o custo delas foi estimado pelo mesmo % das outras (${fmt.pct(m.cmvPct)}).`);
    if (m.parcial) avisos.push(`${TS.ymLabel(sel)} está em andamento (vendas até ${fmt.date(TS.dayToIso(m.ultimo))}): os custos fixos entram só pela parte dos dias que já passaram (${fmt.pct(m.frac, 0)} do mês).`);

    // cartões do topo
    const kp = (rot, v, sub, cls) => TS.kpi(rot, v == null ? '—' : fmt.brl0(v), sub, null);
    const varA = (k) => (a && a[k] ? h('span', null, TS.deltaSpan(m[k] / a[k] - 1), ` vs. ${rotAnt}`) : null);
    corpo.append(h('div', { class: 'dre-topo' }, h('label', null, 'Mês ', opMes), h('span', { class: 'muted' }, 'Todos os dias do mês, sem os filtros da lateral. Custos fixos e % com os valores cadastrados hoje.')),
      ...avisos.map((t) => h('div', { class: 'notice' }, t)),
      h('div', { class: 'grid g-kpi' },
        kp('Faturamento', m.fat, varA('fat')),
        kp('Lucro bruto', m.lucroBruto, h('span', null, `margem ${pc(m.lucroBruto, m.fat)}`)),
        kp('Margem de contribuição', m.contrib, h('span', null, `${pc(m.contrib, m.fat)} do faturamento`)),
        TS.kpi('Resultado do mês', m.resultado == null ? '—' : fmt.brl0(m.resultado), h('span', { class: m.resultado >= 0 ? 'up' : 'down' }, `${pc(m.resultado, m.fat)} do faturamento`), 'Margem de contribuição − custos fixos')));

    // DRE do mês × mesmo mês do ano anterior
    const tb = h('table', { class: 't dre-t' });
    tb.append(h('thead', null, h('tr', null, h('th', { class: 'l' }, ''), h('th', null, TS.ymLabel(sel)), h('th', null, '%'), h('th', null, a ? rotAnt : 'Ano anterior'), h('th', null, '%'), h('th', null, 'Variação'))));
    const body = h('tbody');
    const alternar = (id) => { if (abertos.has(id)) abertos.delete(id); else abertos.add(id); TS.render(); };
    for (const [rot, f, tipo, dica, gid] of linhas) {
      const v = f(m), va = a ? f(a) : null;
      const d = v != null && va ? v / va - 1 : null;
      const bom = tipo === 'menos' || tipo === 'grupo' || tipo === 'filho' ? d < 0 : d > 0;
      body.append(h('tr', { class: 'dre-' + tipo, title: dica, onclick: gid ? () => alternar(gid) : null },
        h('td', { class: 'l' }, gid ? h('span', { class: 'dre-seta' }, abertos.has(gid) ? '▾ ' : '▸ ') : null, rot), h('td', null, v == null ? '—' : fmt.brl(v)), h('td', { class: 'muted' }, pc(v, m.fat)),
        h('td', null, va == null ? '—' : fmt.brl(va)), h('td', { class: 'muted' }, a ? pc(va, a.fat) : '—'),
        h('td', { class: d == null || Math.abs(d) < 0.0005 ? 'muted' : bom ? 'pos' : 'neg' }, d == null ? '—' : fmt.delta(d))));
    }
    tb.append(body);
    const linkCustos = h('div', { class: 'dre-links' },
      h('a', { href: '#config', onclick: (e) => { e.preventDefault(); TS.abrirCfg(state.loja, 'estoque', 'cfg-custos'); } }, '+ Adicionar ou editar custos da loja'),
      h('a', { href: '#config', onclick: (e) => { e.preventDefault(); TS.abrirCfg(state.loja, 'estoque', 'cfg-pontuais'); } }, '+ Despesa de um mês só (ex.: IPTU, 13º)'));
    const memo = h('div', { class: 'dre-memo muted' },
      `Fora do resultado (informativo): taxa de serviço recebida ${fmt.brl(m.gorjeta)} (repassada à equipe) · descontos dados ${fmt.brl(m.desc)} · Espaço Gourmet ${fmt.brl(m.eg)} (${pc(m.eg, m.fat)} do faturamento). Passe o mouse em cada linha para ver de onde vem o valor.`);
    corpo.append(h('div', { class: 'mt' }, TS.card(`Resultado de ${TS.ymLabel(sel)}`, a ? `Comparado com ${rotAnt}${m.parcial ? ' (mesmos dias, mesma parte dos custos fixos)' : ''}` : 'Sem o mesmo mês do ano anterior para comparar', h('div', { class: 'table-wrap free' }, tb), memo, linkCustos)));

    // gráfico: resultado mês a mês
    const ult = meses.slice(-13);
    corpo.append(h('div', { class: 'mt' }, TS.card('Resultado mês a mês', 'Barras = resultado do mês (verde lucro, vermelho prejuízo) · linha = margem de contribuição', TS.chart({
      type: 'bar',
      data: { labels: ult.map((x) => TS.ymLabel(x.ym) + (x.parcial ? '*' : '')),
        datasets: [
          { type: 'bar', label: 'Resultado', data: ult.map((x) => x.resultado), backgroundColor: ult.map((x) => (x.resultado >= 0 ? '#2C5234' : '#B5452B')), borderRadius: 4, order: 2 },
          { type: 'line', label: 'Margem de contribuição', data: ult.map((x) => x.contrib), borderColor: '#C9A227', backgroundColor: '#C9A227', tension: 0.3, pointRadius: 3, order: 1 },
        ] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.brl0(c.raw)}` } } }, scales: { y: TS.axisNum(fmt.brl0), x: TS.axisCat } },
    }))));

    // tabela mês a mês (12 meses)
    const ult12 = meses.slice(-12);
    const t2 = h('table', { class: 't dre-t' });
    t2.append(h('thead', null, h('tr', null, h('th', { class: 'l sticky-col' }, ''), ult12.map((x) => h('th', null, TS.ymLabel(x.ym) + (x.parcial ? '*' : ''))))));
    const b2 = h('tbody');
    for (const [rot, f, tipo, dica, gid] of linhas) b2.append(h('tr', { class: 'dre-' + tipo, title: dica, onclick: gid ? () => alternar(gid) : null }, h('td', { class: 'l sticky-col' }, gid ? h('span', { class: 'dre-seta' }, abertos.has(gid) ? '▾ ' : '▸ ') : null, rot), ult12.map((x) => { const v = f(x); return h('td', { class: tipo === 'tot' && v < 0 ? 'neg' : null }, v == null ? '—' : fmt.brl0(v)); })));
    b2.append(h('tr', { class: 'dre-info' }, h('td', { class: 'l sticky-col' }, 'Resultado em % do faturamento'), ult12.map((x) => h('td', { class: x.resultado < 0 ? 'neg' : null }, pc(x.resultado, x.fat)))));
    t2.append(b2);
    corpo.append(h('div', { class: 'mt' }, TS.card('Mês a mês', '* mês em andamento (custos fixos proporcionais aos dias que já passaram)', h('div', { class: 'table-wrap' }, t2))));
  }
})();
