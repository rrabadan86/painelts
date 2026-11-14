/* Estoque e Margem → Preços: histórico de reajustes de custo e de venda de cada produto vendido e o efeito na margem bruta.
 * - Custo: histórico do custo do AppNext que o painel guarda a cada importação de estoque (custos.json). Para os chás,
 *   custo do pacote = kg do chá × tamanho + embalagem (a mesma conta do Estoque e margem). Antes do primeiro registro,
 *   o custo é "estimado" (o mais antigo que se conhece).
 * - Venda: preço praticado nas vendas (preço de tabela da linha, sem desconto): o preço mais comum de cada semana; uma
 *   mudança conta quando o preço novo se mantém (aparece de novo depois) ou é o da última semana.
 * - Período: o filtro de período da lateral. "Anterior" = antes do período; "Atual" = no fim do período.
 * Só para quem vê o Estoque e margem. */
(function () {
  const { h, fmt, state } = TS;

  const quando = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '—');
  const pctTxt = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmt.n1(v * 100)}%`);

  /** monta o histórico de cada produto vendido */
  function calcular(M, historico) {
    const db = TS.db;
    const semana = (d) => Math.floor((d + 3) / 7); // semanas começando na segunda
    // ---- custo de cada item do estoque ao longo do tempo
    const hist = new Map(Object.entries(historico || {}).map(([cod, l]) => [cod, [...l].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, v]) => [TS.isoToDay(d), v])]));
    const custoEm = (it, dia) => {
      const l = hist.get(String(it.cod));
      if (!l || !l.length) return { v: it.custo || null, est: true };
      let v = null;
      for (const [d, c] of l) { if (d <= dia) v = c; else break; }
      return v == null ? { v: l[0][1], est: true } : { v, est: false };
    };
    // ---- vendas: por produto vendido (descrição), preço de tabela mais comum de cada semana + composição do custo
    const prods = new Map();
    for (let i = 0; i < db.n; i++) {
      if (M.taxa(i) || !(db.qtd[i] > 0) || !(db.vu[i] > 0)) continue;
      const nome = db.D.descricao[db.desc[i]];
      let p = prods.get(nome);
      if (!p) { p = { nome, cat: String(db.D.cat[db.cat[i]] || '').split(',')[0].trim(), semanas: new Map(), ult: i, vt: 0, qtd: 0 }; prods.set(nome, p); }
      const w = semana(db.day[i]);
      const s = p.semanas.get(w) || p.semanas.set(w, new Map()).get(w);
      const k = Math.round(db.vu[i] * 100) / 100;
      const x = s.get(k) || s.set(k, { n: 0, dia: db.day[i] }).get(k);
      x.n += db.qtd[i]; if (db.day[i] < x.dia) x.dia = db.day[i];
      if (db.day[i] >= db.day[p.ult]) p.ult = i;
      p.vt += db.vt[i]; p.qtd += db.qtd[i];
    }
    const lista = [];
    for (const p of prods.values()) {
      // composição do custo de 1 unidade vendida (linha mais recente): [[item, quantidade por unidade]]
      const cs = M.consumo(p.ult);
      if (!cs.length) continue;
      const comp = cs.map(([it, q]) => [it, q / db.qtd[p.ult]]);
      const custoNoDia = (dia) => { let v = 0, est = false; for (const [it, q] of comp) { const c = custoEm(it, dia); if (c.v == null) return { v: null, est: true }; v += c.v * q; est = est || c.est; } return { v: Math.round(v * 100) / 100, est }; };
      // eventos de venda
      const ws = [...p.semanas.keys()].sort((a, b) => a - b);
      const modas = ws.map((w) => { let best = null; for (const [preco, x] of p.semanas.get(w)) if (!best || x.n > best.n) best = { preco, ...x }; return { w, ...best }; });
      const vendaEv = [];
      let atualV = modas.length ? modas[0].preco : null;
      if (atualV != null) vendaEv.push({ dia: modas[0].dia, v: atualV, inicio: true });
      for (let k = 1; k < modas.length; k++) {
        const m = modas[k];
        if (Math.abs(m.preco - atualV) < 0.005) continue;
        const prox = modas.slice(k + 1, k + 4);
        const segue = k === modas.length - 1 || prox.filter((x) => Math.abs(x.preco - m.preco) < 0.005).length >= Math.min(2, prox.length);
        if (!segue) continue;
        vendaEv.push({ dia: p.semanas.get(m.w).get(m.preco).dia, v: m.preco, de: atualV });
        atualV = m.preco;
      }
      // eventos de custo: datas em que algum componente mudou
      const dias = new Set();
      for (const [it] of comp) for (const [d] of hist.get(String(it.cod)) || []) dias.add(d);
      const custoEv = [];
      let antC = null;
      for (const d of [...dias].sort((a, b) => a - b)) {
        const c = custoNoDia(d);
        if (c.v == null) continue;
        if (antC == null) { custoEv.push({ dia: d, v: c.v, inicio: true }); antC = c.v; continue; }
        if (Math.abs(c.v - antC) < 0.005) continue;
        custoEv.push({ dia: d, v: c.v, de: antC });
        antC = c.v;
      }
      if (!custoEv.length) { const c = custoNoDia(TS.todayDay()); if (c.v != null) custoEv.push({ dia: null, v: c.v, inicio: true, est: true }); }
      lista.push({ nome: p.nome, cat: p.cat, comp, custoNoDia, vendaEv, custoEv, vt: p.vt, qtd: p.qtd, kg: comp.some(([it]) => it.un === 'Kg') });
    }
    return { lista, inicioCusto: Math.min(...[...hist.values()].map((l) => (l.length ? l[0][0] : Infinity))) };
  }

  /** valores antes do período e no fim dele */
  function noPeriodo(p, de, ate) {
    const valorEm = (ev, dia) => { let v = null; for (const e of ev) { if (e.dia == null || e.dia <= dia) v = e.v; else break; } return v; };
    const fim = ate;
    const vAt = valorEm(p.vendaEv, fim), cAt = valorEm(p.custoEv, fim);
    const vAnt = de != null ? valorEm(p.vendaEv, de - 1) ?? p.vendaEv[0]?.v : p.vendaEv[0]?.v;
    const cAnt = de != null ? valorEm(p.custoEv, de - 1) ?? p.custoEv[0]?.v : p.custoEv[0]?.v;
    const dentro = (e) => !e.inicio && e.dia != null && (de == null || e.dia >= de) && e.dia <= fim;
    const vMud = p.vendaEv.filter(dentro), cMud = p.custoEv.filter(dentro);
    const mg = (v, c) => (v > 0 && c != null ? (v - c) / v : null);
    return {
      vAnt, vAt, cAnt, cAt,
      vVar: vMud.length && vAnt ? vAt / vAnt - 1 : null, cVar: cMud.length && cAnt ? cAt / cAnt - 1 : null,
      vDia: vMud.length ? vMud[vMud.length - 1].dia : null, cDia: cMud.length ? cMud[cMud.length - 1].dia : null,
      mAnt: mg(vAnt, cAnt), mAt: mg(vAt, cAt), nV: vMud.length, nC: cMud.length,
    };
  }

  TS.pages.precos = function (root) {
    if (TS.subEstoque) root.append(TS.subEstoque('precos'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Preços'),
      h('div', { class: 'page-sub' }, 'Reajustes de custo e de venda de cada produto e o efeito na margem bruta · período do filtro da lateral'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'Escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Montando o histórico de preços…'))));
    root.append(corpo);
    const loja = state.loja;
    Promise.all([TS.estoqueBuscar(loja), TS.custosLoja()]).then(([e, M]) => {
      if (!corpo.isConnected) return;
      if (!M || !e.estoque) { corpo.replaceChildren(h('div', { class: 'notice' }, 'Ainda não há estoque e custos desta loja no painel.')); return; }
      pintar(corpo, calcular(M, e.historico));
    }).catch((err) => corpo.replaceChildren(h('div', { class: 'notice err' }, err.message)));
  };

  function pintar(corpo, D) {
    const f = state.f, db = TS.db;
    const de = f.de ?? null, ate = Math.min(f.ate ?? db.maxDay, TS.todayDay());
    const linhas = D.lista.map((p) => ({ ...p, ...noPeriodo(p, de, ate) })).filter((r) => r.vAt != null);
    for (const r of linhas) {
      r.status = r.nC && r.nV ? 'ambos' : r.nC ? 'custo' : r.nV ? 'venda' : 'nada';
      r.perdeu = r.mAnt != null && r.mAt != null && r.mAt < r.mAnt - 0.0005;
      r.difMargem = r.mAnt != null && r.mAt != null ? r.mAt - r.mAnt : null;
    }
    const FIL = {
      todos: ['Todos os itens', () => true],
      custo: ['Custo alterado', (r) => r.nC > 0],
      venda: ['Venda alterada', (r) => r.nV > 0],
      margem: ['Margem reduzida', (r) => r.perdeu],
      sem: ['Sem reajuste', (r) => r.status === 'nada'],
    };
    const filtro = state.precoFil || 'todos';
    const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const comC = linhas.filter((r) => r.nC), comV = linhas.filter((r) => r.nV), perda = linhas.filter((r) => r.perdeu);
    const inicioCusto = Number.isFinite(D.inicioCusto) ? TS.dayToIso(D.inicioCusto) : null;
    corpo.replaceChildren(
      h('div', { class: 'grid g-kpi' },
        TS.kpi('Custo alterado', fmt.int(comC.length), comC.length ? h('span', null, 'variação média ', h('b', { class: media(comC.map((r) => r.cVar)) > 0 ? 'neg' : 'pos' }, pctTxt(media(comC.map((r) => r.cVar))))) : 'nenhum no período',
          'Produtos vendidos cujo custo mudou no período (para chá a granel, o custo do pacote: kg × tamanho + embalagem).'),
        TS.kpi('Venda alterada', fmt.int(comV.length), comV.length ? h('span', null, 'variação média ', h('b', null, pctTxt(media(comV.map((r) => r.vVar))))) : 'nenhum no período',
          'Preço de tabela praticado nas vendas (sem desconto): conta quando o preço novo se mantém.'),
        TS.kpi('Perderam margem', fmt.int(perda.length), perda.length ? h('span', { class: 'neg' }, 'custo subiu mais que a venda') : 'nenhum no período',
          'Margem bruta no fim do período menor que antes dele.'),
        TS.kpi('Histórico de custo desde', inicioCusto ? quando(inicioCusto) : '—', 'o painel guarda o custo a cada importação de estoque',
          'O AppNext só informa o custo de hoje. Antes desta data, o custo é estimado pelo mais antigo conhecido.')),
      h('div', { class: 'mt' }, tabela(linhas, FIL, filtro, corpo, D)));
  }

  function variacao(ant, at, v, dia, ehCusto, kg) {
    if (at == null) return h('span', { class: 'muted' }, '—');
    const cor = v == null ? '' : (ehCusto ? v > 0 : v < 0) ? 'prc-ruim' : 'prc-bom';
    return h('div', { class: 'prc-v' },
      v != null ? h('s', { class: 'muted' }, fmt.brl(ant)) : null,
      h('b', null, fmt.brl(at)),
      v != null ? h('span', { class: 'prc-badge ' + cor }, pctTxt(v)) : null,
      dia != null ? h('small', { class: 'muted' }, quando(TS.dayToIso(dia))) : null);
  }

  function tabela(linhas, FIL, filtro, corpo, D) {
    const rows = linhas.filter(FIL[filtro][1]);
    const STATUS = { ambos: ['Custo + Venda', 'prc-st-a'], custo: ['Só custo', 'prc-st-c'], venda: ['Só venda', 'prc-st-v'], nada: ['Sem reajuste', 'prc-st-n'] };
    const tab = TS.table({
      cols: [
        { key: 'nome', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => h('a', { href: '#', class: 'prc-nome', onclick: (e) => { e.preventDefault(); abrirProduto(r); } }, r.nome, h('small', { class: 'est-tam' }, r.cat)) },
        { key: 'cVar', label: 'Custo (antes → agora)', title: 'Custo de 1 unidade vendida: antes do período → no fim dele. Vermelho = subiu', render: (r) => variacao(r.cAnt, r.cAt, r.cVar, r.cDia, true), sortVal: (r) => r.cVar ?? -99 },
        { key: 'vVar', label: 'Venda (antes → agora)', title: 'Preço de tabela praticado: antes do período → no fim dele', render: (r) => variacao(r.vAnt, r.vAt, r.vVar, r.vDia, false), sortVal: (r) => r.vVar ?? -99 },
        { key: 'status', label: 'O que mudou', align: 'l', render: (r) => { const [t, c] = STATUS[r.status]; return h('span', { class: 'prc-st ' + c }, t); }, sortVal: (r) => ({ ambos: 3, custo: 2, venda: 1, nada: 0 })[r.status] },
        { key: 'difMargem', label: 'Margem bruta (antes → agora)', title: 'Margem bruta = (venda − custo) ÷ venda', render: (r) => (r.mAt == null ? '—' : h('div', { class: 'prc-v' },
          r.difMargem != null && Math.abs(r.difMargem) >= 0.0005 ? h('s', { class: 'muted' }, fmt.pct(r.mAnt)) : null, h('b', { class: r.perdeu ? 'neg' : null }, fmt.pct(r.mAt)),
          r.difMargem != null && Math.abs(r.difMargem) >= 0.0005 ? h('span', { class: 'prc-badge ' + (r.difMargem < 0 ? 'prc-ruim' : 'prc-bom') }, `${r.difMargem > 0 ? '+' : ''}${fmt.n1(r.difMargem * 100)} p.p.`) : null)),
          sortVal: (r) => r.difMargem ?? 0 },
        { key: 'acoes', label: '', align: 'l', render: (r) => h('button', { type: 'button', class: 'btn prc-ver', onclick: () => abrirProduto(r) }, 'Histórico'), sortVal: () => 0 },
      ],
      rows, sortKey: filtro === 'margem' ? 'difMargem' : 'cVar', sortDir: filtro === 'margem' ? 'asc' : 'desc', maxHeight: '640px', search: 'Buscar produto…', searchKeys: ['nome', 'cat'], cls: 'est-t prc-t',
      empty: 'Nenhum produto neste filtro no período.',
    });
    const cont = (k) => linhas.filter(FIL[k][1]).length;
    return TS.cardWithTools('Produtos', 'Clique no produto para ver o gráfico de custo × venda e todos os reajustes. Custo e venda são de 1 unidade vendida (pacote, lata, caneca…).',
      h('div', { class: 'est-tools' }, tab.searchBox && (tab.searchBox.classList.add('est-busca'), tab.searchBox),
        TS.seg(Object.entries(FIL).map(([k, [t]]) => [`${t} (${cont(k)})`, k]), filtro, (v) => { state.precoFil = v; pintar(corpo, D); })),
      tab);
  }

  // ---------- painel lateral: gráfico + linha do tempo + simulador ----------
  function abrirProduto(r) {
    document.querySelector('.prc-drawer-camada')?.remove();
    const fechar = () => { camada.remove(); document.body.classList.remove('com-camada'); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    // pontos do gráfico: todas as datas com evento + hoje (linhas em degrau)
    const hoje = TS.todayDay();
    const dias = [...new Set([...r.vendaEv.map((e) => e.dia), ...r.custoEv.map((e) => e.dia).filter((d) => d != null), hoje])].sort((a, b) => a - b);
    const valorEm = (ev, dia) => { let v = null; for (const e of ev) { if (e.dia == null || e.dia <= dia) v = e.v; else break; } return v; };
    const serieV = dias.map((d) => valorEm(r.vendaEv, d)), serieC = dias.map((d) => valorEm(r.custoEv, d) ?? r.custoEv[0]?.v ?? null);
    const graf = TS.chart({
      type: 'line',
      data: { labels: dias.map((d) => quando(TS.dayToIso(d))), datasets: [
        { label: 'Venda', data: serieV, borderColor: '#2C5234', backgroundColor: '#2C5234', stepped: 'before', pointRadius: 3, borderWidth: 2 },
        { label: 'Custo', data: serieC, borderColor: '#C77F12', backgroundColor: '#C77F12', stepped: 'before', pointRadius: 3, borderWidth: 2 },
      ] },
      options: { plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.brl(c.raw)}`, afterBody: (it) => { const v = serieV[it[0].dataIndex], c = serieC[it[0].dataIndex]; return v && c != null ? `Margem bruta: ${fmt.pct((v - c) / v)}` : ''; } } } },
        scales: { y: { ...TS.axisNum((v) => fmt.brl0(v)), beginAtZero: true }, x: TS.axisCat } },
    }, 'short');
    // linha do tempo (mais recente primeiro)
    const ev = [
      ...r.vendaEv.filter((e) => !e.inicio).map((e) => ({ dia: e.dia, tipo: 'venda', de: e.de, v: e.v })),
      ...r.custoEv.filter((e) => !e.inicio).map((e) => ({ dia: e.dia, tipo: 'custo', de: e.de, v: e.v })),
    ];
    const porDia = new Map();
    for (const e of ev) (porDia.get(e.dia) || porDia.set(e.dia, []).get(e.dia)).push(e);
    const itens = [...porDia.entries()].sort((a, b) => b[0] - a[0]).map(([dia, es]) => {
      const v = valorEm(r.vendaEv, dia), cR = valorEm(r.custoEv, dia), c = cR ?? r.custoEv[0]?.v ?? null;
      const tipo = es.length > 1 ? 'Custo e venda' : es[0].tipo === 'custo' ? 'Custo' : 'Venda';
      return h('li', { class: 'prc-tl-i' },
        h('div', { class: 'prc-tl-d' }, quando(TS.dayToIso(dia)), h('span', { class: 'prc-st ' + (es.length > 1 ? 'prc-st-a' : es[0].tipo === 'custo' ? 'prc-st-c' : 'prc-st-v') }, tipo)),
        ...es.map((x) => h('div', { class: 'prc-tl-l' }, h('b', null, x.tipo === 'custo' ? 'Custo ' : 'Venda '), `${fmt.brl(x.de)} → ${fmt.brl(x.v)} `,
          h('span', { class: 'prc-badge ' + ((x.tipo === 'custo' ? x.v > x.de : x.v < x.de) ? 'prc-ruim' : 'prc-bom') }, pctTxt(x.v / x.de - 1)))),
        h('div', { class: 'prc-tl-m muted' }, `Margem bruta depois: ${v && c != null ? fmt.pct((v - c) / v) : '—'}${cR == null && c != null ? ' (custo estimado)' : ''}`),
        h('div', { class: 'prc-tl-o muted' }, es.map((x) => (x.tipo === 'custo' ? 'Origem: custo do estoque do AppNext (coletor)' : `Origem: preço praticado nas vendas (primeira venda a ${fmt.brl(x.v)})`)).join(' · ')));
    });
    if (!itens.length) itens.push(h('li', { class: 'muted' }, 'Nenhum reajuste registrado. O histórico de custo cresce a cada importação de estoque; o de venda vem das vendas desde o início da base.'));
    // simulador rápido: novo preço → margem bruta (o preço é alterado no AppNext)
    const custo = r.cAt, venda = r.vAt;
    const inp = h('input', { class: 'f-input', type: 'number', min: 0, step: '0.10', value: venda, style: { maxWidth: '120px' } });
    const out = h('div', { class: 'prc-sim-o' });
    const manter = r.mAnt != null && r.mAnt < 1 ? custo / (1 - r.mAnt) : null;
    const sim = () => {
      const p = +inp.value;
      out.replaceChildren(p > 0 && custo != null ? h('span', null, 'Margem bruta: ', h('b', { class: (p - custo) / p < (r.mAt ?? 0) ? 'neg' : 'pos' }, fmt.pct((p - custo) / p)), ` (hoje ${fmt.pct(r.mAt)}) · lucro bruto ${fmt.brl(p - custo)} por unidade`) : '');
    };
    inp.addEventListener('input', sim); sim();
    const card = h('aside', { class: 'card prc-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': r.nome },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      h('div', { class: 'card-title' }, r.nome), h('div', { class: 'card-sub' }, r.cat),
      h('div', { class: 'prc-resumo' },
        h('div', null, h('small', null, 'Custo hoje'), h('b', null, fmt.brl(custo))),
        h('div', null, h('small', null, 'Venda hoje'), h('b', null, fmt.brl(venda))),
        h('div', null, h('small', null, 'Margem bruta'), h('b', { class: r.perdeu ? 'neg' : null }, fmt.pct(r.mAt)))),
      h('div', { class: 'f-label mt' }, 'Evolução: custo × venda'),
      h('div', { class: 'prc-graf' }, graf),
      h('div', { class: 'muted prc-nota' }, r.custoEv.some((e) => e.est) || !r.custoEv.some((e) => !e.inicio) ? 'O histórico de custo começa na primeira importação de estoque guardada pelo painel; antes disso a linha de custo é estimada.' : ''),
      h('div', { class: 'f-label mt' }, 'Simular preço de venda'),
      h('div', { class: 'prc-sim' }, h('span', null, 'R$ '), inp, manter && Math.abs(manter - venda) > 0.01 ? h('button', { type: 'button', class: 'btn', onclick: () => { inp.value = (Math.ceil(manter * 10) / 10).toFixed(2); sim(); } }, `Voltar à margem de antes (${fmt.pct(r.mAnt)}): ${fmt.brl(Math.ceil(manter * 10) / 10)}`) : null),
      out, h('small', { class: 'muted' }, 'O painel só simula: o preço é alterado no AppNext.'),
      h('div', { class: 'f-label mt' }, 'Reajustes (mais recente primeiro)'),
      h('ul', { class: 'prc-tl' }, itens));
    const camada = h('div', { class: 'prc-drawer-camada', onmousedown: (e) => { if (e.target === camada) fechar(); } }, card);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', esc);
  }
})();
