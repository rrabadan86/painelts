/* Produtos → Preços: histórico de reajustes de custo e de venda de cada produto vendido e o efeito na margem bruta.
 * - Custo: notas de compra do AppNext (Entrada de Produtos, guardadas pelo coletor em compras.json) + o custo de cada
 *   importação de estoque (custos.json). Para os chás,
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
  function calcular(M, historico, compras) {
    const db = TS.db;
    const semana = (d) => Math.floor((d + 3) / 7); // semanas começando na segunda
    // ---- custo de cada item do estoque ao longo do tempo
    // notas de compra (Entrada de Produtos) + fotos do estoque (custos.json), em ordem de data. Na mesma data vale a nota;
    // uma foto do estoque só vira ponto se mudar o custo em 1% ou mais (o "custo último" do AppNext é o da última nota)
    const hist = new Map();
    const cods = new Set([...Object.keys(historico || {}), ...Object.keys(compras?.itens || {})]);
    for (const cod of cods) {
      const pts = [
        ...(compras?.itens?.[cod] || []).map(([d, v, nf, q, forn]) => ({ d: TS.isoToDay(d), v, o: { nf, q, forn, data: d } })),
        ...(historico?.[cod] || []).map(([d, v]) => ({ d: TS.isoToDay(d), v, o: null })),
      ].sort((a, b) => a.d - b.d || (a.o ? 1 : 0) - (b.o ? 1 : 0));
      const l = [];
      for (const x of pts) {
        const ult = l[l.length - 1];
        if (ult && ult[0] === x.d) { if (x.o || !ult[2]) { ult[1] = x.v; ult[2] = x.o || ult[2]; } continue; }
        if (!x.o && ult && Math.abs(x.v / ult[1] - 1) < 0.01) continue;
        l.push([x.d, x.v, x.o]);
      }
      hist.set(cod, l);
    }
    // nota de compra que valia num dia (o último ponto do histórico até o dia, se veio de uma NF)
    const origemEm = (it, dia) => { let o = null; for (const [d, , x] of hist.get(String(it.cod)) || []) { if (d <= dia) o = x; else break; } return o; };
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
        // de onde veio o custo do dia: notas de compra dos componentes que mudaram nessa data
        const nfs = comp.map(([it]) => (hist.get(String(it.cod)) || []).find((x) => x[0] === d)?.[2]).filter(Boolean);
        if (antC == null) { custoEv.push({ dia: d, v: c.v, inicio: true, nfs }); antC = c.v; continue; }
        if (Math.abs(c.v - antC) < 0.005) continue;
        custoEv.push({ dia: d, v: c.v, de: antC, nfs });
        antC = c.v;
      }
      if (!custoEv.length) { const c = custoNoDia(TS.todayDay()); if (c.v != null) custoEv.push({ dia: null, v: c.v, inicio: true, est: true }); }
      lista.push({ nome: p.nome, cat: p.cat, cod: db.D.cod ? String(db.D.cod[db.cod[p.ult]] ?? '') : '', comp, custoNoDia, custoEm, origemEm, vendaEv, custoEv, vt: p.vt, qtd: p.qtd, kg: comp.some(([it]) => it.un === 'Kg') });
    }
    return { lista, temCompras: !!(compras && Object.keys(compras.itens || {}).length), inicioCusto: Math.min(...[...hist.values()].map((l) => (l.length ? l[0][0] : Infinity))) };
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
      const D = calcular(M, e.historico, e.compras);
      D.loja = loja; D.hist = e.historico || {}; D.comprasItens = (e.compras && e.compras.itens) || {};
      D.tabela = new Map(((e.tabela && e.tabela.itens) || []).filter((t) => t.preco > 0.011).map((t) => [t.cod, t.preco]));
      pintar(corpo, D);
    }).catch((err) => corpo.replaceChildren(h('div', { class: 'notice err' }, err.message)));
  };

  function pintar(corpo, D) {
    const f = state.f, db = TS.db;
    const de = f.de ?? null, ate = Math.min(f.ate ?? db.maxDay, TS.todayDay());
    const linhas = D.lista.map((p) => ({ ...p, de, ate, ...noPeriodo(p, de, ate) })).filter((r) => r.vAt != null);
    for (const r of linhas) {
      r.status = r.nC && r.nV ? 'ambos' : r.nC ? 'custo' : r.nV ? 'venda' : 'nada';
      r.perdeu = r.mAnt != null && r.mAt != null && r.mAt < r.mAnt - 0.0005;
      r.difMargem = r.mAnt != null && r.mAt != null ? r.mAt - r.mAnt : null;
      // preço de tabela do cadastro do AppNext × o praticado nas vendas
      r.tab = D.tabela && D.tabela.has(r.cod) ? D.tabela.get(r.cod) : null;
      r.tabDif = r.tab != null && r.vAt != null && Math.abs(r.tab - r.vAt) >= 0.01 ? r.vAt / r.tab - 1 : null;
    }
    const FIL = {
      todos: ['Todos os itens', () => true],
      custo: ['Custo alterado', (r) => r.nC > 0],
      venda: ['Venda alterada', (r) => r.nV > 0],
      margem: ['Margem reduzida', (r) => r.perdeu],
      sem: ['Sem reajuste', (r) => r.status === 'nada'],
      ...(D.tabela && D.tabela.size ? { cad: ['Diferente do cadastro', (r) => r.tabDif != null] } : {}),
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
        TS.kpi('Histórico de custo desde', inicioCusto ? quando(inicioCusto) : '—', D.temCompras ? 'notas de compra do AppNext + importações de estoque' : 'o painel guarda o custo a cada importação de estoque',
          'O AppNext só informa o custo de hoje. Antes desta data, o custo é estimado pelo mais antigo conhecido.')),
      h('div', { class: 'mt' }, tabela(linhas, FIL, filtro, corpo, D)),
      h('p', { class: 'muted mt' }, 'As notas de entrada, com os produtos e valores de cada uma, ficam em ', h('a', { href: '#notas' }, 'Estoque → Notas fiscais'), '.'));
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
        D.tabela && D.tabela.size ? { key: 'tab', label: 'Cadastro', title: 'Preço de tabela no cadastro do AppNext (Produtos / Produtos Compostos). Em vermelho quando o preço praticado nas vendas é diferente', render: (r) => (r.tab == null ? h('span', { class: 'muted' }, '—') : h('div', { class: 'prc-v' }, h('b', null, fmt.brl(r.tab)), r.tabDif != null ? h('span', { class: 'prc-badge prc-ruim', title: `Vendido a ${fmt.brl(r.vAt)}` }, `vendas ${pctTxt(r.tabDif)}`) : null)), sortVal: (r) => (r.tabDif == null ? -99 : Math.abs(r.tabDif)) } : null,
        { key: 'status', label: 'O que mudou', align: 'l', render: (r) => { const [t, c] = STATUS[r.status]; return h('span', { class: 'prc-st ' + c }, t); }, sortVal: (r) => ({ ambos: 3, custo: 2, venda: 1, nada: 0 })[r.status] },
        { key: 'difMargem', label: 'Margem bruta (antes → agora)', title: 'Margem bruta = (venda − custo) ÷ venda', render: (r) => (r.mAt == null ? '—' : h('div', { class: 'prc-v' },
          r.difMargem != null && Math.abs(r.difMargem) >= 0.0005 ? h('s', { class: 'muted' }, fmt.pct(r.mAnt)) : null, h('b', { class: r.perdeu ? 'neg' : null }, fmt.pct(r.mAt)),
          r.difMargem != null && Math.abs(r.difMargem) >= 0.0005 ? h('span', { class: 'prc-badge ' + (r.difMargem < 0 ? 'prc-ruim' : 'prc-bom') }, `${r.difMargem > 0 ? '+' : ''}${fmt.n1(r.difMargem * 100)} p.p.`) : null)),
          sortVal: (r) => r.difMargem ?? 0 },
        { key: 'acoes', label: '', align: 'l', render: (r) => h('button', { type: 'button', class: 'btn prc-ver', onclick: () => abrirProduto(r) }, 'Histórico'), sortVal: () => 0 },
      ].filter(Boolean),
      rows, sortKey: filtro === 'margem' ? 'difMargem' : 'cVar', sortDir: filtro === 'margem' ? 'asc' : 'desc', maxHeight: '640px', search: 'Buscar produto…', searchKeys: ['nome', 'cat'], produto: 'nome', cls: 'est-t prc-t',
      empty: 'Nenhum produto neste filtro no período.',
    });
    const cont = (k) => linhas.filter(FIL[k][1]).length;
    return TS.cardWithTools('Produtos', 'Clique no produto para ver o gráfico de custo × venda e todos os reajustes. Custo e venda são de 1 unidade vendida (pacote, lata, caneca…).',
      h('div', { class: 'est-tools' }, tab.searchBox && (tab.searchBox.classList.add('est-busca'), tab.searchBox),
        TS.seg(Object.entries(FIL).map(([k, [t]]) => [`${t} (${cont(k)})`, k]), filtro, (v) => { state.precoFil = v; pintar(corpo, D); })),
      tab);
  }

  // ---------- composição: o que forma o custo de 1 unidade (chá: matéria-prima por kg + saco + etiquetas) ----------
  function composicao(r) {
    if (!r.comp || !r.comp.length) return null;
    const diaAt = r.ate, diaAnt = r.de != null ? r.de - 1 : r.custoEv[0]?.dia ?? diaAt; // sem início no filtro: desde o primeiro custo conhecido
    const un = (it) => String(it.un || '').toLowerCase();
    const qtdTxt = (it, q) => (un(it) === 'kg' ? (q < 1 ? `${fmt.int(Math.round(q * 1000))} g` : `${fmt.n2(q)} kg`) : `${Number.isInteger(q) ? fmt.int(q) : fmt.n2(q)} ${it.un || 'un'}`);
    const linhas = r.comp.map(([it, q]) => {
      const cAt = r.custoEm(it, diaAt).v, cAnt = r.custoEm(it, diaAnt).v;
      const o = r.origemEm(it, diaAt);
      return { it, q, cAnt, cAt, tAnt: cAnt != null ? cAnt * q : null, tAt: cAt != null ? cAt * q : null, o };
    });
    const totAt = linhas.reduce((a, l) => a + (l.tAt || 0), 0), totAnt = linhas.reduce((a, l) => a + (l.tAnt || 0), 0);
    const venda = r.vAt;
    const mudou = (a, b) => a != null && b != null && Math.abs(a - b) >= 0.005;
    // custo subindo = vermelho; venda subindo = verde
    const badge = (a, b, venda) => (mudou(a, b) && a ? h('span', { class: 'prc-badge ' + ((venda ? b < a : b > a) ? 'prc-ruim' : 'prc-bom') }, pctTxt(b / a - 1)) : null);
    const antesAgora = (a, b, sufixo = '', venda = false) => h('span', { class: 'prc-aa' }, mudou(a, b) ? h('s', { class: 'muted' }, fmt.brl(a) + sufixo) : null, h('b', null, b == null ? '—' : fmt.brl(b) + sufixo), badge(a, b, venda));
    const tb = h('tbody', null, ...linhas.map((l) => h('tr', null,
      h('td', { class: 'l' }, h('div', null, l.it.desc || l.it.cod), h('small', { class: 'muted' }, `${qtdTxt(l.it, l.q)} por unidade${l.o ? ` · NF ${l.o.nf}${l.o.data ? ` · entrada em ${fmt.date(String(l.o.data).slice(0, 10))}` : ''}${l.o.forn ? ` · ${l.o.forn}` : ''}` : ''}`)),
      h('td', null, antesAgora(l.cAnt, l.cAt, un(l.it) === 'kg' ? '/kg' : '')),
      h('td', null, antesAgora(l.tAnt, l.tAt)),
      h('td', null, totAt ? fmt.pct((l.tAt || 0) / totAt) : '—'),
      h('td', null, venda ? fmt.pct((l.tAt || 0) / venda) : '—'))));
    // a venda e a margem ficam no bloco Venda, logo abaixo (sem repetir aqui)
    const tf = h('tfoot', null, h('tr', null,
      h('td', { class: 'l' }, h('b', null, 'Custo da unidade')), h('td'), h('td', null, antesAgora(totAnt, totAt)), h('td', null, '100%'), h('td', null, venda ? fmt.pct(totAt / venda) : '—')));
    // quem explica a variação do custo
    const dif = totAt - totAnt;
    const maior = linhas.filter((l) => mudou(l.tAnt, l.tAt)).sort((a, b) => Math.abs(b.tAt - b.tAnt) - Math.abs(a.tAt - a.tAnt))[0];
    const resumo = Math.abs(dif) >= 0.005 && maior
      ? `No período o custo da unidade ${dif > 0 ? 'subiu' : 'caiu'} ${fmt.brl(Math.abs(dif))}; ${fmt.brl(Math.abs(maior.tAt - maior.tAnt))} disso por ${maior.it.desc || maior.it.cod}${un(maior.it) === 'kg' ? ` (${fmt.brl(maior.cAnt)} → ${fmt.brl(maior.cAt)} o kg)` : ''}.`
      : 'Nenhum componente mudou de custo no período.';
    return h('div', null,
      h('div', { class: 'f-label mt' }, r.kg ? 'Composição do custo (chá a granel)' : 'Composição do custo'),
      h('div', { class: 'muted prc-nota' }, `Antes = ${quando(TS.dayToIso(diaAnt))} · agora = ${quando(TS.dayToIso(r.ate))} (período do filtro). ${resumo}`),
      h('div', { class: 'prc-comp-w' }, h('table', { class: 'prc-comp' },
        h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Item'), h('th', null, 'Custo do item'), h('th', null, 'Na unidade'), h('th', { title: 'Parte do custo da unidade' }, '% custo'), h('th', { title: 'Parte do preço de venda' }, '% venda'))),
        tb, tf)));
  }

  // ---------- venda: as mesmas informações do custo (antes → agora) + vendas mês a mês ----------
  function blocoVenda(r) {
    const db = TS.db;
    const diaAt = r.ate, diaAnt = r.de != null ? r.de - 1 : r.custoEv[0]?.dia ?? diaAt;
    const cAnt = r.custoNoDia(diaAnt).v, cAt = r.custoNoDia(diaAt).v;
    const vAnt = r.vAnt ?? r.vAt, vAt = r.vAt;
    const kgUn = r.comp.filter(([it]) => String(it.un || '').toLowerCase() === 'kg').reduce((a, [, q]) => a + q, 0);
    const mudou = (a, b) => a != null && b != null && Math.abs(a - b) >= 0.005;
    const linha = (rot, a, b, f, bomSobe = true, dica) => h('tr', null,
      h('td', { class: 'l' }, h('div', null, rot), dica ? h('small', { class: 'muted' }, dica) : null),
      h('td', null, h('span', { class: 'prc-aa' }, mudou(a, b) ? h('s', { class: 'muted' }, f(a)) : null, h('b', null, b == null ? '—' : f(b)),
        mudou(a, b) && a ? h('span', { class: 'prc-badge ' + ((bomSobe ? b < a : b > a) ? 'prc-ruim' : 'prc-bom') }, f === fmt.pct ? `${b > a ? '+' : ''}${fmt.n1((b - a) * 100)} p.p.` : pctTxt(b / a - 1)) : null)));
    const lb = (v, c) => (v != null && c != null ? v - c : null), mg = (v, c) => (v > 0 && c != null ? (v - c) / v : null);
    const tab = h('table', { class: 'prc-comp' }, h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Venda (1 unidade)'), h('th', null, 'Antes → agora'))), h('tbody', null,
      linha('Preço de venda', vAnt, vAt, fmt.brl, true, 'preço de tabela praticado'),
      r.tab != null ? h('tr', null, h('td', { class: 'l' }, h('div', null, 'Preço no cadastro do AppNext'), h('small', { class: r.tabDif != null ? 'neg' : 'muted' }, r.tabDif != null ? `as vendas estão ${pctTxt(r.tabDif)} do cadastro` : 'igual ao praticado')), h('td', null, h('span', { class: 'prc-aa' }, h('b', null, fmt.brl(r.tab))))) : null,
      kgUn > 0 ? linha('Preço de venda do kg', vAnt / kgUn, vAt / kgUn, fmt.brl, true, `${fmt.int(Math.round(kgUn * 1000))} g por unidade`) : null,
      linha('Lucro bruto por unidade', lb(vAnt, cAnt), lb(vAt, cAt), fmt.brl, true, 'venda − custo'),
      linha('Margem bruta', mg(vAnt, cAnt), mg(vAt, cAt), fmt.pct, true)));
    // vendas mês a mês (últimos 6 meses com venda): unidades, preço médio pago, faturamento e margem bruta com o custo do mês
    const meses = new Map();
    for (let i = 0; i < db.n; i++) {
      if (db.D.descricao[db.desc[i]] !== r.nome || !(db.qtd[i] > 0)) continue;
      const m = meses.get(db.ym[i]) || meses.set(db.ym[i], { q: 0, vt: 0, ult: 0 }).get(db.ym[i]);
      m.q += db.qtd[i]; m.vt += db.vt[i] || 0; if (db.day[i] > m.ult) m.ult = db.day[i];
    }
    const ult6 = [...meses.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 6);
    const nomeMes = (ym) => `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+ym.slice(5) - 1]}/${ym.slice(2, 4)}`;
    const tabM = ult6.length ? h('table', { class: 'prc-comp' },
      h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Mês'), h('th', null, 'Unidades'), h('th', { title: 'Faturamento ÷ unidades (com desconto)' }, 'Preço médio'), h('th', null, 'Faturamento'), h('th', { title: 'Com o custo de cada mês' }, 'Margem'))),
      h('tbody', null, ...ult6.map(([ym, m]) => { const c = r.custoNoDia(m.ult).v; const pm = m.q ? m.vt / m.q : null; return h('tr', null,
        h('td', { class: 'l' }, nomeMes(ym)), h('td', null, Number.isInteger(m.q) ? fmt.int(m.q) : fmt.n2(m.q)), h('td', null, fmt.brl(pm)), h('td', null, fmt.brl(m.vt)),
        h('td', null, pm && c != null ? fmt.pct((pm - c) / pm) : '—')); }))) : null;
    return h('div', null,
      h('div', { class: 'f-label mt' }, 'Venda'),
      h('div', { class: 'prc-comp-w' }, tab),
      tabM ? h('div', { class: 'f-label mt' }, 'Vendas por mês') : null,
      tabM ? h('div', { class: 'muted prc-nota' }, 'Últimos 6 meses com venda deste produto. Preço médio = o que foi pago de fato (com desconto); margem com o custo de cada mês.') : null,
      tabM ? h('div', { class: 'prc-comp-w' }, tabM) : null);
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
        scales: { y: { ...TS.axisNum((v) => (Math.abs(v) < 20 ? fmt.brl(v) : fmt.brl0(v))), beginAtZero: true }, x: TS.axisCat } },
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
        h('div', { class: 'prc-tl-o muted' }, ...es.map((x, k) => [k ? ' · ' : '', x.tipo === 'custo' ? (x.nfs && x.nfs.length ? h('span', null, 'Origem: entrada NF nº ', ...[...new Set(x.nfs.map((o) => o.nf))].map((nf, j) => [j ? ', ' : '', h('a', { href: '#notas', title: 'Abrir a nota', onclick: () => { state.abrirNF = nf; } }, String(nf))]).flat(), x.nfs[0].forn ? ` (${x.nfs[0].forn})` : '') : 'Origem: custo do estoque do AppNext (coletor)') : `Origem: preço praticado nas vendas (primeira venda a ${fmt.brl(x.v)})`]).flat()));
    });
    if (!itens.length) itens.push(h('li', { class: 'muted' }, 'Nenhum reajuste registrado. O custo vem das notas de compra e das importações de estoque; a venda, das vendas desde o início da base.'));
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
      h('div', { class: 'muted prc-nota' }, r.custoEv.some((e) => e.est) || !r.custoEv.some((e) => !e.inicio) ? 'O histórico de custo começa na primeira nota de compra (ou importação de estoque) que o painel tem; antes disso a linha de custo é estimada.' : ''),
      composicao(r),
      blocoVenda(r),
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
  // ---------- Estoque → Notas fiscais: notas de entrada (Estoque → Entrada de Produtos do AppNext) ----------
  TS.pages.notas = function (root) {
    if (TS.subEstoque) root.append(TS.subEstoque('notas'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Notas fiscais'),
      h('div', { class: 'page-sub' }, 'Notas de entrada do AppNext: produtos, quantidades, valores e o que mudou no custo'))));
    if (TS.abasNotas) root.append(TS.abasNotas('notas'));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'As notas são de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', { class: 'prc-notas' }, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Lendo as notas…'))));
    root.append(corpo);
    const loja = state.loja;
    TS.estoqueBuscar(loja).then((e) => {
      if (!corpo.isConnected) return;
      corpo.replaceChildren(cartaoNotas({ loja, hist: e.historico || {}, comprasItens: (e.compras && e.compras.itens) || {} }));
    }).catch((err) => corpo.replaceChildren(h('div', { class: 'notice err' }, err.message)));
  };
  const cacheNotas = new Map();
  TS.aoLimparCache && TS.aoLimparCache(() => cacheNotas.clear());
  /** confere se uma chave de 44 dígitos referenciada (<refNFe>) aponta para esta nota de entrada */
  function refBateNota(ref, n) {
    if (!ref || ref.length !== 44 || !n) return false;
    if (n.chave && ref === n.chave) return true;
    if (Number(ref.slice(25, 34)) !== Number(n.nf)) return false;
    if (n.serie != null && String(n.serie) !== '' && Number(ref.slice(22, 25)) !== Number(n.serie)) return false;
    if (n.emissao && n.emissao.length >= 7 && ref.slice(2, 6) !== n.emissao.slice(2, 4) + n.emissao.slice(5, 7)) return false;
    return true;
  }
  function saidasDeNota(j, n) {
    const out = [], vistas = new Set();
    for (const s of (j && j.saidas) || []) {
      if ((s.refs || []).some((ref) => refBateNota(ref, n)) && !vistas.has(s.chave)) { vistas.add(s.chave); out.push(s); }
    }
    const devs = (j && j.devs && j.devs.get(`${n.id}|${n.nf}`)) || [];
    for (const d of devs) {
      const nf = d.nfe;
      if (nf && nf.chave && !vistas.has(nf.chave)) {
        vistas.add(nf.chave);
        out.push({ chave: nf.chave, numero: nf.numero, serie: nf.serie || '1', emissao: nf.autorizadaEm || d.em, natOp: 'Devolução ao fornecedor', finalidade: 'Devolução', situacao: nf.situacao === 'cancelada' || nf.estado === 'cancelada' ? 'cancelada' : 'autorizada', valor: nf.total ?? d.total, cfops: nf.cfop ? [nf.cfop] : [] });
      }
    }
    return out;
  }
  function devAtivaDeNota(j, n) {
    const devs = ((j && j.devs && j.devs.get(`${n.id}|${n.nf}`)) || []).filter((d) => !(d.nfe && (d.nfe.estado === 'cancelada' || d.nfe.situacao === 'cancelada')));
    const saidasDev = saidasDeNota(j, n).filter((s) => s.finalidade === 'Devolução' && s.situacao !== 'cancelada');
    if (!devs.length && !saidasDev.length) return null;
    const total = Math.max(devs.length, saidasDev.length);
    const dicas = [
      ...devs.map((d) => `${d.itens.length} ${d.itens.length === 1 ? 'item' : 'itens'} em ${new Date(d.em).toLocaleDateString('pt-BR')}${d.nfe && d.nfe.numero ? ` (NF-e nº ${d.nfe.numero})` : ''}`),
      ...(!devs.length ? saidasDev.map((s) => `NF-e de devolução nº ${s.numero ?? '—'}`) : []),
    ];
    return { total, dica: dicas.join(' · ') };
  }
  function cartaoNotas(D) {
    const box = h('div', { class: 'mt' }, h('div', { class: 'card' }, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Lendo as notas fiscais…')))));
    const loja = D.loja;
    const p = cacheNotas.get(loja) || fetch(TS.api(`estoque/notas?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || 'Falha ao ler as notas.'); return j; });
    cacheNotas.set(loja, p);
    const buscarDevs = () => (TS.demo ? Promise.resolve([]) : fetch(TS.api(`devolucoes?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { devolucoes: [] })).then((x) => x.devolucoes || []).catch(() => []));
    const ps = fetch(TS.api(`nfsaida?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { notas: [] })).then((x) => x.notas || []).catch(() => []);
    const indexarDevs = (j, devs) => {
      j.devs = new Map();
      for (const d of devs) { const k = `${d.nota.id}|${d.nota.nf}`; (j.devs.get(k) || j.devs.set(k, []).get(k)).push(d); }
    };
    const atualizarDevs = (j) => buscarDevs().then((devs) => {
      indexarDevs(j, devs);
      if (!devs.length && state.prcNotasFil === 'dev') state.prcNotasFil = 'per';
      if (box.isConnected) box.replaceChildren(listaNotas(D, j, () => atualizarDevs(j)));
    });
    Promise.all([p, buscarDevs(), ps, TS.validade ? TS.validade.pendentes(loja) : {}]).then(([j, devs, saidas, lotesPend]) => {
      j.saidas = saidas; j.lotesPend = lotesPend || {};
      indexarDevs(j, devs);
      const aoMudar = () => atualizarDevs(j);
      box.replaceChildren(listaNotas(D, j, aoMudar));
      // veio de um link ("NF nº …" no histórico de um produto): abre a nota
      if (state.abrirNF != null) { const n = (j.notas || []).find((x) => String(x.nf) === String(state.abrirNF)); state.abrirNF = null; if (n) abrirNota(D, { ...n, dia: TS.isoToDay(n.entrada || n.emissao), nfTxt: `${n.nf ?? '—'}${n.serie ? ' / ' + n.serie : ''}` }, j, aoMudar); }
    }).catch((e) => { cacheNotas.delete(loja); box.replaceChildren(h('div', { class: 'notice err' }, e.message)); });
    return box;
  }
  function listaNotas(D, j, aoMudar) {
    const f = state.f;
    const todas = (j.notas || []).map((n) => {
      const dia = TS.isoToDay(n.entrada || n.emissao);
      // busca: também acha a nota pelo nome ou código de um produto dela
      return { ...n, dia, nfTxt: `${n.nf ?? '—'}${n.serie ? ' / ' + n.serie : ''}`, nItens: n.itens.length, compra: /compra/i.test(n.motivo || ''), busca: n.itens.map((i) => i.nome + ' ' + i.cod).join(' ') };
    });
    if (!todas.length) return TS.card('Notas fiscais de entrada', null, h('p', { class: 'muted' }, 'Nenhuma nota de entrada no painel ainda. O coletor lê as notas concluídas de Estoque → Entrada de Produtos do AppNext junto com o estoque.'));
    const noPer = (n) => (f.de == null || n.dia >= f.de) && (f.ate == null || n.dia <= f.ate);
    const temAlgumaDev = todas.some((n) => !!devAtivaDeNota(j, n));
    const temPend = Object.keys(j.lotesPend || {}).length > 0;
    const FIL = { per: ['No período', noPer], todas: ['Todas', () => true], ...(temAlgumaDev ? { dev: ['Com devolução', (n) => !!devAtivaDeNota(j, n)] } : {}), ...(temPend ? { lote: ['Lote pendente', (n) => !!j.lotesPend[n.id]] } : {}) };
    const fil = FIL[state.prcNotasFil] ? state.prcNotasFil : 'per';
    const rows = todas.filter(FIL[fil][1]);
    const tab = TS.table({
      cols: [
        // compacta: entrada + emissão numa coluna, tipo junto do fornecedor; a linha inteira abre a nota
        { key: 'dia', label: 'Entrada', align: 'l', render: (r) => h('span', null, r.entrada ? quando(r.entrada) : '—', h('small', { class: 'est-tam' }, r.emissao ? 'emissão ' + quando(r.emissao) : '')), sortVal: (r) => r.dia ?? 0 },
        { key: 'nfTxt', label: 'NF / série', align: 'l', render: (r) => h('a', { href: '#', class: 'prc-nome', onclick: (e) => { e.preventDefault(); e.stopPropagation(); abrirNota(D, r, j, aoMudar); } }, r.nfTxt), sortVal: (r) => +r.nf || 0 },
        { key: 'fornecedor', label: 'Fornecedor', align: 'l', wrap: true, render: (r) => { const dv = devAtivaDeNota(j, r); return h('span', null, r.fornecedor || '—', h('small', { class: 'est-tam' }, r.motivo ? h('span', { class: 'prc-st ' + (r.compra ? 'prc-st-v' : 'prc-st-n') }, r.motivo) : null,
          dv ? h('span', { class: 'prc-st nf-dev', title: dv.dica }, `↩ devolução${dv.total > 1 ? ` (${dv.total})` : ''}`) : null,
          j.lotesPend && j.lotesPend[r.id] ? h('span', { class: 'prc-st vl-pend', title: `${j.lotesPend[r.id]} chá(s) a granel sem o nº do lote: abra a nota e preencha` }, `🍃 lote pendente (${j.lotesPend[r.id]})`) : null)); } },
        { key: 'nItens', label: 'Itens', fmt: fmt.int },
        { key: 'total', label: 'Total da nota', fmt: (v) => (v == null ? '—' : fmt.brl(v)) },
      ],
      rows, sortKey: 'dia', maxHeight: '520px', search: 'Buscar NF, fornecedor ou produto…', searchKeys: ['nfTxt', 'fornecedor', 'motivo', 'busca'], cls: 'est-t', onRowClick: (r) => abrirNota(D, r, j, aoMudar),
      total: { nfTxt: `${fmt.int(rows.length)} notas`, nItens: rows.reduce((a, r) => a + r.nItens, 0), total: rows.reduce((a, r) => a + (r.total || 0), 0) },
      imprimir: ['dia', 'nfTxt', 'fornecedor', 'nItens', 'total'],
      empty: fil === 'per' ? 'Nenhuma nota no período do filtro. Veja "Todas".' : 'Nenhuma nota.',
    });
    const sincEl = botaoSincronizar(D, j);
    return TS.cardWithTools('Notas fiscais de entrada', `Notas de entrada concluídas no AppNext (Estoque → Entrada de Produtos), lidas pelo coletor${j.atualizado ? ' · atualizado em ' + new Date(j.atualizado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}. Clique na nota para ver os produtos, quantidades, valores e o que mudou no custo.`,
      h('div', { class: 'est-tools' }, tab.searchBox && (tab.searchBox.classList.add('est-busca'), tab.searchBox), sincEl,
        TS.seg(Object.entries(FIL).map(([k, [t, fn]]) => [`${t} (${fmt.int(todas.filter(fn).length)})`, k]), fil, (v) => { state.prcNotasFil = v; const c = document.querySelector('.prc-notas > .mt'); if (c) c.replaceChildren(listaNotas(D, j, aoMudar)); })),
      sincEl && sincEl._log, tab);
  }
  /** "Sincronizar agora" (só admin): o coletor busca o estoque e as notas de compra do AppNext; acompanha até terminar */
  const sinc = {}; // loja -> timer
  function botaoSincronizar(D, j) {
    if (TS.demo || !TS.eu || TS.eu.perfil !== 'admin') return null;
    const loja = D.loja;
    const st = h('small', { class: 'muted nf-sinc-st' });
    // log do robô, como nas outras telas: ao vivo enquanto roda; depois, o final da última execução
    const logPre = h('pre', { class: 'inv-log nf-sinc-log' });
    const logBox = h('details', { class: 'nf-sinc-logbox', hidden: true, open: state.nfSincLogAberto || null, ontoggle: (e) => { state.nfSincLogAberto = e.target.open; } },
      h('summary', null, h('span', { class: 'nf-sinc-logtit' }, 'Log do robô')), logPre);
    const pintarLog = (s) => {
      const box = document.querySelector('.nf-sinc-logbox') || logBox, pre = box.querySelector('pre') || logPre, tit = box.querySelector('.nf-sinc-logtit');
      const linhas = (s.log || []).filter((l) => String(l).trim());
      const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
      const fazendo = s.robo && s.estado === 'na_fila' ? ` · o robô está ${s.robo.outraLoja ? 'atualizando outra loja' : 'ocupado nesta loja'}${s.robo.inicio ? ' desde ' + new Date(s.robo.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}` : '';
      if (tit) tit.textContent = s.estado === 'rodando' ? `Log do robô (ao vivo, desde ${quando(s.inicio)})`
        : s.estado === 'na_fila' ? `Na fila desde ${quando(s.criado)}${fazendo}`
        : s.fim ? `Log da última atualização (${quando(s.fim)} · ${s.estado === 'ok' ? 'concluída' : 'falhou'}${s.itens ? ' · ' + s.itens.join(', ') : ''})` : 'Log do robô';
      pre.textContent = linhas.length ? linhas.join('\n') : s.estado === 'na_fila' ? 'Aguardando a vez na fila…' : 'Sem log.';
      box.hidden = !(linhas.length || s.estado === 'na_fila' || s.estado === 'rodando');
      if (s.estado === 'rodando' && box.open) pre.scrollTop = pre.scrollHeight;
    };
    const btn = h('button', { type: 'button', class: 'btn nf-sinc', title: 'Busca agora no AppNext o estoque e as notas de entrada desta loja (leva alguns minutos)' }, '⟳ Sincronizar agora');
    const url = `estoque/notas/sincronizar?loja=${encodeURIComponent(loja)}`;
    const recarregar = async () => { cacheNotas.delete(loja); if (TS.estoqueBuscar) await TS.estoqueBuscar(loja, true).catch(() => null); TS.render(); };
    const acompanhar = (antes) => {
      clearTimeout(sinc[loja]);
      const passo = async () => {
        if (!btn.isConnected && !document.querySelector('.nf-sinc')) { delete sinc[loja]; return; }
        let s; try { s = await (await fetch(TS.api(url), { credentials: 'same-origin' })).json(); } catch { s = {}; }
        const vivo = document.querySelector('.nf-sinc-st') || st;
        pintarLog(s);
        if (s.estado === 'na_fila' || s.estado === 'rodando') {
          vivo.textContent = s.estado === 'na_fila' ? `⏳ na fila do robô${s.fila ? ` (${s.fila} na frente)` : ''}…` : '⏳ buscando no AppNext…';
          const b = document.querySelector('.nf-sinc'); if (b) b.disabled = true;
          sinc[loja] = setTimeout(passo, 5000); return;
        }
        delete sinc[loja];
        if ((s.atualizado && s.atualizado !== antes) || s.estado === 'ok') { vivo.textContent = '✓ sincronizado'; recarregar(); return; }
        vivo.textContent = s.estado === 'falhou' ? '✗ a busca no AppNext falhou (veja Configurações → Lojas)' : '';
        const b = document.querySelector('.nf-sinc'); if (b) b.disabled = false;
      };
      passo();
    };
    btn.onclick = async () => {
      btn.disabled = true; st.textContent = 'pedindo ao robô…';
      try {
        const r = await fetch(TS.api('estoque/notas/sincronizar'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ loja }) });
        const x = await r.json().catch(() => ({}));
        if (!r.ok && r.status !== 409) throw new Error(x.erro || 'Falha ao pedir a sincronização.');
        acompanhar(j.atualizado || null);
      } catch (e) { st.textContent = '✗ ' + e.message; btn.disabled = false; }
    };
    if (sinc[loja] === undefined) fetch(TS.api(url), { credentials: 'same-origin' }).then((r) => r.json()).then((s) => { pintarLog(s); if (s.estado === 'na_fila' || s.estado === 'rodando') acompanhar(j.atualizado || null); }).catch(() => {});
    const box = h('span', { class: 'nf-sinc-box' }, btn, st);
    box._log = logBox;
    return box;
  }

  /** custo de um item antes da nota: a entrada anterior (outra nota) ou a importação de estoque anterior */
  function custoAntes(D, cod, dia, nf) {
    let v = null, d0 = -Infinity, origem = '';
    for (const [d, c, n] of (D.comprasItens && D.comprasItens[cod]) || []) { const dd = TS.isoToDay(d); if ((dd < dia || (dd === dia && n !== nf)) && dd >= d0) { v = c; d0 = dd; origem = `NF ${n} de ${quando(d)}`; } }
    for (const [d, c] of (D.hist && D.hist[cod]) || []) { const dd = TS.isoToDay(d); if (dd < dia && dd > d0) { v = c; d0 = dd; origem = `estoque de ${quando(d)}`; } }
    return v == null ? null : { v, origem };
  }
  function blocoSaidasVinculadas(loja, vinculadas) {
    if (!vinculadas || !vinculadas.length) return null;
    return h('div', { class: 'nf-vinculos' },
      h('small', { class: 'nf-vinculos-tit' }, vinculadas.length === 1 ? 'Nota fiscal de saída vinculada a esta entrada' : `Notas fiscais de saída vinculadas (${vinculadas.length})`),
      ...vinculadas.map((s) => h('button', { type: 'button', class: 'nf-vinculo-btn' + (s.situacao === 'cancelada' ? ' canc' : ''), onclick: () => TS.abrirNFe && TS.abrirNFe(s.chave, loja, { sobrepor: true }) },
        h('span', { class: 'nf-vinculo-esq' },
          h('b', null, `↪ NF-e nº ${s.numero ?? '—'}${s.serie ? ' / série ' + s.serie : ''}`),
          h('span', { class: 'prc-st ' + (s.situacao === 'cancelada' ? 'prc-st-n nf-cancelada' : 'prc-st-v') }, s.situacao === 'cancelada' ? 'cancelada' : 'autorizada'),
          h('small', { class: 'muted' }, [s.natOp || s.finalidade, s.cfops && s.cfops.length ? 'CFOP ' + s.cfops.join(', ') : null, s.emissao ? quando(s.emissao.slice(0, 10)) : null, s.valor != null ? fmt.brl(s.valor) : null].filter(Boolean).join(' · '))),
        h('span', { class: 'nf-vinculo-ver' }, 'Ver NF-e ↗'))));
  }
  function abrirNota(D, n, j, aoMudar) {
    document.querySelector('.prc-popup-camada')?.remove();
    document.querySelector('.prc-drawer-camada')?.remove();
    const fechar = () => { camada.remove(); if (!document.querySelector('.prc-popup-camada, .camada-cheia')) document.body.classList.remove('com-camada'); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.prc-popup-camada')) fechar(); };
    const linhas = n.itens.map((i) => {
      const a = custoAntes(D, i.cod, n.dia, n.nf);
      return { ...i, total: Math.round(i.custo * i.qtd * 100) / 100, antes: a ? a.v : null, origemAntes: a ? a.origem : '', varC: a && a.v ? i.custo / a.v - 1 : null };
    });
    const unTxt = (u) => String(u || 'un').toLowerCase();
    const tab = TS.table({
      cols: [
        { key: 'nome', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => h('span', null, r.nome, h('small', { class: 'est-tam' }, `cód. ${r.cod}${r.grupo ? ' · ' + r.grupo : ''}`)) },
        { key: 'qtd', label: 'Qtd', render: (r) => `${unTxt(r.un) === 'kg' ? fmt.kg(r.qtd) : fmt.n2(r.qtd).replace(/,00$/, '')} ${unTxt(r.un)}` },
        { key: 'vu', label: 'Valor unit. (nota)', title: 'Valor unitário escrito na nota (sem IPI e rateios)', fmt: (v) => (v == null ? '—' : fmt.brl(v)) },
        { key: 'custo', label: 'Custo unit.', title: 'Valor líquido do item ÷ quantidade (com IPI e rateios): é o "custo último" que o AppNext usa', fmt: fmt.brl },
        { key: 'total', label: 'Total', fmt: fmt.brl },
        { key: 'varC', label: 'Custo antes', title: 'Custo do mesmo produto antes desta nota (entrada anterior ou importação de estoque) e a variação', render: (r) => (r.antes == null ? h('span', { class: 'muted' }, 'primeira entrada') : h('div', { class: 'prc-v', title: r.origemAntes }, h('span', null, fmt.brl(r.antes)), r.varC != null && Math.abs(r.varC) >= 0.0005 ? h('span', { class: 'prc-badge ' + (r.varC > 0 ? 'prc-ruim' : 'prc-bom') }, pctTxt(r.varC)) : h('span', { class: 'muted' }, 'igual'))), sortVal: (r) => r.varC ?? -99 },
      ],
      rows: linhas, sortKey: 'total', maxHeight: '60vh', search: 'Buscar produto…', searchKeys: ['nome', 'cod'], cls: 'est-t',
      total: { nome: `${fmt.int(linhas.length)} itens`, total: linhas.reduce((a, r) => a + r.total, 0) },
    });
    const subiu = linhas.filter((r) => r.varC != null && r.varC > 0.0005).length, desceu = linhas.filter((r) => r.varC != null && r.varC < -0.0005).length;
    const vinculadas = saidasDeNota(j, n);
    const card = h('aside', { class: 'card prc-drawer prc-drawer-largo', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Nota ${n.nfTxt}` },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      h('div', { class: 'card-title' }, `NF ${n.nfTxt}`), h('div', { class: 'card-sub' }, n.fornecedor || 'Fornecedor não informado'),
      h('div', { class: 'prc-resumo' },
        h('div', null, h('small', null, 'Emissão'), h('b', null, n.emissao ? quando(n.emissao) : '—')),
        h('div', null, h('small', null, 'Entrada'), h('b', null, n.entrada ? quando(n.entrada) : '—')),
        h('div', null, h('small', null, 'Total da nota'), h('b', null, n.total != null ? fmt.brl(n.total) : '—'))),
      h('div', { class: 'prc-nota-info muted' }, [n.motivo && `Tipo: ${n.motivo}`, n.status && `Situação: ${n.status}`, n.cfop && `CFOP ${n.cfop}`, `${fmt.int(linhas.length)} itens`, subiu || desceu ? `custo subiu em ${fmt.int(subiu)} e caiu em ${fmt.int(desceu)}` : ''].filter(Boolean).join(' · ')),
      blocoSaidasVinculadas(D.loja, vinculadas),
      TS.devolucao && !TS.demo ? TS.devolucao.barra(n, () => card, aoMudar) : null,
      h('div', { class: 'f-label mt' }, 'Produtos da nota', h('button', { type: 'button', class: 'exp-btn prt-btn prc-nf-prt', title: 'Imprimir a nota', onclick: () => TS.imprimir(card) }, '🖨', h('span', null, 'Imprimir'))),
      tab,
      TS.validade ? TS.validade.blocoNota(D.loja, n, () => TS.validade.pendentes(D.loja).then((p) => { j.lotesPend = p; const c = document.querySelector('.prc-notas > .mt'); if (c) c.replaceChildren(listaNotas(D, j, aoMudar)); })) : null);
    const camada = h('div', { class: 'prc-drawer-camada', onmousedown: (e) => { if (e.target === camada) fechar(); } }, card);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', esc);
  }
})();
