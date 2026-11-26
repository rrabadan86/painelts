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
  /** Histórico de compras de um produto (todas as notas de compra que o painel tem): janela usada na nota de entrada
      e em qualquer tabela de produto (Margem de tabela…). r = { nome, cod, un, grupo }; nfAtual destaca "esta nota". */
  TS.histCompras = function (r, comprasItens, nfAtual) {
    const unTxt = (u) => String(u || 'un').toLowerCase();
    const kg = unTxt(r.un) === 'kg';
    const comp = ((comprasItens && comprasItens[r.cod]) || []).map(([dia, custo, nf, qtd, forn]) => ({ dia, custo, nf, qtd, forn }))
      .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
    comp.forEach((c, k) => { c.varC = k && comp[k - 1].custo ? c.custo / comp[k - 1].custo - 1 : null; c.esta = nfAtual != null && String(c.nf) === String(nfAtual); });
    const qtdF = (v) => (v == null ? '—' : kg ? `${fmt.kg(v)} kg` : `${fmt.n2(v).replace(/,00$/, '')} ${unTxt(r.un)}`);
    const doze = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const ano = comp.filter((c) => c.dia >= doze);
    const qAno = ano.reduce((a, c) => a + (c.qtd || 0), 0), vAno = ano.reduce((a, c) => a + (c.qtd || 0) * c.custo, 0);
    const primeiro = comp[0], ultimo = comp[comp.length - 1];
    const corpo = comp.length ? [
      h('div', { class: 'prc-resumo' },
        h('div', null, h('small', null, 'Compras em 12 meses'), h('b', null, `${fmt.int(ano.length)} ${ano.length === 1 ? 'nota' : 'notas'}`), h('small', { class: 'muted' }, qtdF(qAno))),
        h('div', null, h('small', null, 'Custo médio (12 meses)'), h('b', null, qAno ? fmt.brl(vAno / qAno) : '—')),
        h('div', null, h('small', null, 'Último custo'), h('b', null, fmt.brl(ultimo.custo)), comp.length > 1 ? h('small', { class: 'muted' }, `desde ${quando(primeiro.dia)}: `, h('span', { class: 'prc-badge ' + (ultimo.custo > primeiro.custo ? 'prc-ruim' : 'prc-bom') }, pctTxt(ultimo.custo / primeiro.custo - 1))) : null)),
      comp.length > 1 ? h('div', { class: 'prc-graf' }, TS.chart({
        type: 'line',
        data: { labels: comp.map((c) => quando(c.dia)), datasets: [{ label: kg ? 'Custo do kg' : 'Custo unitário', data: comp.map((c) => c.custo), borderColor: '#C77F12', backgroundColor: '#C77F12', pointRadius: comp.map((c) => (c.esta ? 6 : 3)), borderWidth: 2, tension: 0 }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt.brl(c.raw)} · NF ${comp[c.dataIndex].nf} · ${qtdF(comp[c.dataIndex].qtd)}` } } }, scales: { y: { ...TS.axisNum((v) => fmt.brl(v)) }, x: TS.axisCat } },
      }, 'short')) : null,
      TS.table({
        cols: [
          { key: 'dia', label: 'Entrada', align: 'l', render: (c) => h('span', null, quando(c.dia), c.esta ? h('small', { class: 'est-tam' }, 'esta nota') : null) },
          { key: 'nf', label: 'NF', align: 'l', render: (c) => String(c.nf ?? '—'), sortVal: (c) => +c.nf || 0 },
          { key: 'forn', label: 'Fornecedor', align: 'l', wrap: true, render: (c) => c.forn || '—' },
          { key: 'qtd', label: 'Qtd', render: (c) => qtdF(c.qtd) },
          { key: 'custo', label: kg ? 'Custo do kg' : 'Custo unit.', fmt: fmt.brl },
          { key: 'varC', label: 'Variação', title: 'Comparado com a compra anterior', render: (c) => (c.varC == null ? h('span', { class: 'muted' }, '—') : Math.abs(c.varC) < 0.0005 ? h('span', { class: 'muted' }, 'igual') : h('span', { class: 'prc-badge ' + (c.varC > 0 ? 'prc-ruim' : 'prc-bom') }, pctTxt(c.varC))), sortVal: (c) => c.varC ?? -99 },
        ],
        rows: comp, sortKey: 'dia', sortDir: 'desc', cls: 'est-t', rowClass: (c) => (c.esta ? 'nf-hist-esta' : ''),
      }),
    ] : [h('p', { class: 'muted' }, 'O painel ainda não tem outras compras deste produto. O histórico vem das notas de compra concluídas que o coletor lê do AppNext.')];
    document.querySelector('.prc-popup-camada')?.remove();
    const fecharP = () => { cam.remove(); document.removeEventListener('keydown', escP, true); };
    const escP = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fecharP(); } };
    const pop = h('aside', { class: 'card prc-popup nf-hist-pop', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Histórico de compras de ${r.nome}` },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fecharP }, '✕'),
      h('div', { class: 'card-title' }, r.nome),
      h('div', { class: 'card-sub' }, `Histórico de compras · cód. ${r.cod}${r.grupo ? ' · ' + r.grupo : ''}`),
      ...corpo.filter(Boolean));
    const cam = h('div', { class: 'prc-popup-camada', onmousedown: (e) => { if (e.target === cam) fecharP(); } }, pop);
    document.body.append(cam);
    document.addEventListener('keydown', escP, true);
  };
  const pctTxt = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmt.n1(v * 100)}%`);

  /** monta o histórico de cada produto vendido */
  function calcular(M, historico, compras) {
    const db = TS.db;
    const semana = (d) => Math.floor((d + 3) / 7); // semanas começando na segunda
    // ---- custo de cada item do estoque ao longo do tempo: a conta única de custodata.js (a mesma do motor de custos —
    // Resultado, Rentabilidade): notas de compra + fotos do estoque, em ordem de data; antes do primeiro ponto, o mais antigo (estimado)
    const { hist, origemEm, custoEm } = TS.custoData.montar(historico, compras && compras.itens);
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
      lista.push({ ultDia: db.day[p.ult], semanas: p.semanas, nome: p.nome, cat: p.cat, grp: (db.D.grupo && db.D.grupo[db.grupo[p.ult]]) || '', cod: db.D.cod ? String(db.D.cod[db.cod[p.ult]] ?? '') : '', comp, custoNoDia, custoEm, origemEm, vendaEv, custoEv, vt: p.vt, qtd: p.qtd, kg: comp.some(([it]) => it.un === 'Kg') });
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
      h('div', { class: 'page-sub' }, 'Reajustes de custo e de venda de cada produto e o efeito na margem bruta · período escolhido nos filtros'))));
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
      D.tabHist = (e.tabela && e.tabela.historico) || {}; D.tabHistDesde = (e.tabela && e.tabela.historicoDesde) || null;
      if (TS.efeitoPreco) D.efeito = TS.efeitoPreco.calcular(D, M); // efeito de cada reajuste de venda (efeitopreco.js)
      pintar(corpo, D);
    }).catch((err) => corpo.replaceChildren(h('div', { class: 'notice err' }, err.message)));
  };

  /**
   * Venda (antes → agora) e margem pelo preço do cadastro do AppNext. O "antes" vem do histórico do cadastro, que o
   * painel guarda a cada planilha de preços importada (D.tabHist: { cod: [[AAAA-MM-DD, preço], …] }); antes de existir
   * histórico, o preço é o atual (sem reajuste conhecido).
   */
  function vendaPeloCadastro(r, D, de, ate) {
    const hist = ((D.tabHist && D.tabHist[r.cod]) || []).map(([d, v]) => [TS.isoToDay(d), v]);
    const em = (dia) => { let v = null; for (const [d, x] of hist) { if (d <= dia) v = x; else break; } return v; };
    const vAt = hist.length && hist[hist.length - 1][0] > ate ? (em(ate) ?? r.tab) : r.tab;
    const vAnt = de != null ? (em(de - 1) ?? (hist.length ? hist[0][1] : vAt)) : (hist.length ? hist[0][1] : vAt);
    const mud = hist.slice(1).filter(([d]) => (de == null || d >= de) && d <= ate);
    const mg = (v, c) => (v > 0 && c != null ? (v - c) / v : null);
    Object.assign(r, { base: 'cadastro', vAnt, vAt, vVar: mud.length && vAnt ? vAt / vAnt - 1 : null, vDia: mud.length ? mud[mud.length - 1][0] : null, nV: mud.length, mAnt: mg(vAnt, r.cAnt), mAt: mg(vAt, r.cAt) });
  }
  TS.precoVendaPeloCadastro = vendaPeloCadastro; // testes

  /**
   * Por que o preço das vendas difere do cadastro? Olha as vendas das últimas 4 semanas do período:
   * - parado: não vendeu nelas (o preço mostrado é antigo; o cadastro pode ter mudado depois);
   * - misto: parte saiu no preço do cadastro e parte em outro (promoção / tabela especial em parte das vendas);
   * - pdv: tudo saiu fora do cadastro (preço do PDV diferente ou cadastro desatualizado; se antes vendia no cadastro, pode ser promoção em andamento).
   * O desconto dado no caixa não entra aqui: ele fica separado no cupom, o preço unitário continua o de tabela.
   */
  function porQueDifere(r, ate) {
    const semana = (d) => Math.floor((d + 3) / 7);
    const w0 = semana(ate - 27), w1 = semana(ate);
    let nTab = 0, nOutro = 0;
    for (const [w, precos] of r.semanas || []) {
      if (w < w0 || w > w1) continue;
      for (const [preco, x] of precos) { if (Math.abs(preco - r.tab) < 0.005) nTab += x.n; else nOutro += x.n; }
    }
    const un = (n) => `${fmt.int(Math.round(n))} un.`;
    const data = (d) => quando(TS.dayToIso(d));
    if (!nTab && !nOutro) return { tipo: 'parado', curto: `última venda ${data(Math.min(r.ultDia, ate))}`,
      longo: `Não vende desde ${data(Math.min(r.ultDia, ate))}: ${fmt.brl(r.vCx ?? r.vAt)} é o preço daquela época. Se o cadastro mudou depois, não há erro — confira só se o produto ainda está à venda.` };
    if (nTab && nOutro) return { tipo: 'misto', curto: 'promoção?',
      longo: `Nas últimas 4 semanas: ${un(nTab)} no preço do cadastro (${fmt.brl(r.tab)}) e ${un(nOutro)} a outro preço. Parece promoção ou tabela de preço especial em parte das vendas.` };
    const ult = r.vendaEv && r.vendaEv[r.vendaEv.length - 1];
    if (ult && ult.de != null && Math.abs(ult.de - r.tab) < 0.005) return { tipo: 'pdv', curto: `desde ${data(ult.dia)}`,
      longo: `Até ${data(ult.dia)} vendia no preço do cadastro (${fmt.brl(r.tab)}); desde então todas as vendas (${un(nOutro)} nas últimas 4 semanas) saíram a ${fmt.brl(r.vCx ?? r.vAt)}. Promoção em andamento ou preço trocado no PDV sem mudar o cadastro.` };
    return { tipo: 'pdv', curto: 'PDV ≠ cadastro',
      longo: `Nas últimas 4 semanas todas as vendas (${un(nOutro)}) saíram fora do preço do cadastro. O PDV está cobrando ${fmt.brl(r.vCx ?? r.vAt)} e o cadastro diz ${fmt.brl(r.tab)}: um dos dois está desatualizado.` };
  }

  TS.precoPorQueDifere = porQueDifere; // testes

  function pintar(corpo, D) {
    const f = state.f, db = TS.db;
    const de = f.de ?? null, ate = Math.min(f.ate ?? db.maxDay, TS.todayDay());
    const linhas = D.lista.map((p) => ({ ...p, de, ate, ...noPeriodo(p, de, ate) })).filter((r) => r.vAt != null);
    for (const r of linhas) {
      // preço de venda = o do CADASTRO do AppNext (não o que saiu no caixa); o do caixa fica só como informação
      r.vCx = r.vAt;
      r.cx = { vAnt: r.vAnt, vAt: r.vAt, vVar: r.vVar, vDia: r.vDia }; // o caixa antes → agora (fica na coluna "No caixa")
      r.tab = D.tabela && D.tabela.has(r.cod) ? D.tabela.get(r.cod) : null;
      if (r.tab != null) vendaPeloCadastro(r, D, de, ate); else r.base = 'caixa'; // sem cadastro: continua pelo caixa
      r.status = r.nC && r.nV ? 'ambos' : r.nC ? 'custo' : r.nV ? 'venda' : 'nada';
      r.perdeu = r.mAnt != null && r.mAt != null && r.mAt < r.mAnt - 0.0005;
      r.difMargem = r.mAnt != null && r.mAt != null ? r.mAt - r.mAnt : null;
      // o que saiu no caixa × o cadastro
      r.tabDif = r.tab != null && r.vCx != null && Math.abs(r.tab - r.vCx) >= 0.01 ? r.vCx / r.tab - 1 : null;
      if (r.tabDif != null) r.tabPor = porQueDifere(r, ate);
    }
    const FIL = {
      todos: ['Todos os itens', () => true],
      custo: ['Custo alterado', (r) => r.nC > 0],
      venda: ['Venda alterada', (r) => r.nV > 0],
      margem: ['Margem reduzida', (r) => r.perdeu],
      sem: ['Sem reajuste', (r) => r.status === 'nada'],
      ...(D.tabela && D.tabela.size ? { cad: ['Caixa ≠ sistema', (r) => r.tabDif != null] } : {}),
    };
    const filtro = FIL[state.precoFil] || (state.precoFil === 'efeito' && D.efeito) ? state.precoFil : 'todos';
    const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const comC = linhas.filter((r) => r.nC), comV = linhas.filter((r) => r.nV), perda = linhas.filter((r) => r.perdeu);
    const inicioCusto = Number.isFinite(D.inicioCusto) ? TS.dayToIso(D.inicioCusto) : null;
    const irP = (k, rot) => h('button', { type: 'button', class: 'link-btn est-heroi-conta', onclick: () => { state.precoFil = k; pintar(corpo, D); } }, rot);
    const mC = media(comC.map((r) => r.cVar)), mV = media(comV.map((r) => r.vVar));
    const E = D.efeito, julgados = E ? E.bons + E.ruins + E.iguais : 0;
    const heroiPrecos = () => TS.heroi([
      { rot: 'Perderam margem', num: fmt.int(perda.length), estado: perda.length ? 'ruim' : null, dica: 'Margem bruta no fim do período menor que antes dele.',
        linhas: [perda.length ? 'custo subiu mais que a venda' : 'nenhum no período', perda.length ? irP('margem', 'ver quais ›') : null] },
      { rot: 'Custo alterado', num: fmt.int(comC.length), dica: 'Produtos vendidos cujo custo mudou no período (para chá a granel, o custo do pacote: kg × tamanho + embalagem).',
        linhas: [comC.length ? h('span', null, 'variação média ', h('b', { class: mC > 0 ? 'neg' : 'pos' }, pctTxt(mC))) : 'nenhum no período', comC.length ? irP('custo', 'ver os reajustes de custo ›') : null] },
      { rot: 'Venda alterada', num: fmt.int(comV.length), dica: 'Preço de tabela praticado nas vendas (sem desconto): conta quando o preço novo se mantém.',
        linhas: [comV.length ? h('span', null, 'variação média ', h('b', null, pctTxt(mV))) : 'nenhum no período', comV.length ? irP('venda', 'ver os reajustes de venda ›') : null] },
    ], { titulo: 'Reajustes no período', extra: h('div', { class: 'prc-heroi-extra' },
      E ? TS.linhasNum([{ rot: 'Reajustes de venda avaliados', num: E.lista.length ? `${fmt.int(julgados)} · ${fmt.int(E.bons)} ${E.bons === 1 ? 'bom' : 'bons'} · ${fmt.int(E.ruins)} ${E.ruins === 1 ? 'ruim' : 'ruins'}` : 'nenhum',
        estado: E.ruins ? 'ruim' : null, onclick: () => { state.precoFil = 'efeito'; pintar(corpo, D); },
        dica: 'Depois que o preço mudou, vendeu menos? O lucro subiu? Cada reajuste de venda dos últimos 12 meses comparado nos 30 dias antes e depois, descontando o movimento da loja. Não segue o período dos filtros. Toque para ver a lista.' }]) : null,
      h('p', { class: 'muted prc-heroi-hist' }, `Histórico de custo desde ${inicioCusto ? quando(inicioCusto) : '—'} · ${D.temCompras ? 'notas de compra do AppNext + importações de estoque' : 'o painel guarda o custo a cada importação de estoque'}`,
        TS.dica('O AppNext só informa o custo de hoje. Antes desta data, o custo é estimado pelo mais antigo conhecido.'))) });
    corpo.replaceChildren(
      // revisão de 22/11: o "como está" num cartão-herói (quem perdeu margem primeiro); cada número leva à aba dele
      heroiPrecos(),
      h('div', { class: 'mt' }, tabela(linhas, FIL, filtro, corpo, D)),
      h('p', { class: 'muted mt' }, 'As notas de entrada, com os produtos e valores de cada uma, ficam em ', h('a', { href: '#notas' }, 'Estoque → Notas fiscais'), '.'));
  }

  // o que teve reajuste no período (etiqueta no nome do produto e no painel lateral)
  const ST_PROD = { ambos: ['Custo + Venda', 'prc-st-a'], custo: ['Só custo', 'prc-st-c'], venda: ['Só venda', 'prc-st-v'], nada: ['Sem reajuste', 'prc-st-n'] };

  /** célula "agora em destaque": valor do fim do período + etiqueta da variação; embaixo, em letra pequena, o de antes e a data (e as linhas extras) */
  function variacao(ant, at, v, dia, ehCusto, ...extras) {
    if (at == null) return h('span', { class: 'muted' }, '—');
    const cor = v == null ? '' : (ehCusto ? v > 0 : v < 0) ? 'prc-ruim' : 'prc-bom';
    return h('div', { class: 'prc-c' },
      h('span', { class: 'prc-c1' }, h('b', null, fmt.brl(at)), v != null ? h('span', { class: 'prc-badge ' + cor }, pctTxt(v)) : null),
      v != null ? h('small', null, `antes ${fmt.brl(ant)}${dia != null ? ` · ${quando(TS.dayToIso(dia))}` : ''}`) : null,
      ...extras.filter(Boolean));
  }

  function tabela(linhas, FIL, filtro, corpo, D) {
    const cont = (k) => linhas.filter(FIL[k][1]).length;
    // abas da tela: os filtros dos produtos + "Reajustes (N)" (efeito de cada reajuste de venda, em efeitopreco.js)
    const abas = () => TS.segFolha([...Object.entries(FIL).map(([k, [t]]) => [`${t} (${cont(k)})`, k]), ...(D.efeito ? [[`Reajustes (${D.efeito.lista.length})`, 'efeito']] : [])], filtro, (v) => { state.precoFil = v; pintar(corpo, D); });
    if (filtro === 'efeito') return TS.efeitoPreco.cartao(D.efeito, abas(), (nome) => { const r = linhas.find((x) => x.nome === nome); if (r) abrirProduto(r); }, () => pintar(corpo, D));
    const rows = linhas.filter(FIL[filtro][1]);
    const temCad = !!(D.tabela && D.tabela.size); // com a planilha de preços: o preço de venda é o do cadastro; o do caixa aparece quando difere
    // Sem rolagem para o lado: poucas colunas, cada uma com o valor de agora em destaque e o "antes" embaixo. O que mudou vira
    // etiqueta no nome; cada aba mostra só as colunas dela (Caixa ≠ sistema: sistema, caixa e motivo). O resto fica no painel do produto.
    const cNome = { key: 'nome', label: 'Produto', align: 'l', sticky: true, wrap: true,
      title: 'Clique no nome para abrir o histórico do produto: gráfico de custo × venda, composição do custo, vendas por mês e todos os reajustes. A etiqueta diz o que teve reajuste no período: Custo + Venda = os dois mudaram; Só custo = o custo mudou e o preço não (a margem mexeu); Só venda = o preço mudou e o custo não; Sem reajuste = nenhum dos dois mudou.',
      render: (r) => { const [t, c] = ST_PROD[r.status]; return h('span', null, h('a', { href: '#', class: 'prc-nome', onclick: (e) => { e.preventDefault(); abrirProduto(r); } }, r.nome), filtro === 'sem' ? null : ' ', filtro === 'sem' ? null : h('span', { class: 'prc-st ' + c }, t), h('small', { class: 'est-tam' }, r.grp ? h('span', { class: 'grp-prod', title: TS.grupoProd.DICA }, r.grp) : null, r.grp && r.cat && r.cat.toUpperCase() !== r.grp.toUpperCase() ? ' · ' + r.cat : r.grp ? null : r.cat)); } };
    const cCusto = { key: 'cVar', label: 'Custo', title: 'Quanto custa 1 unidade vendida (pacote, lata, caneca…) pelo custo do estoque/notas de entrada. Em negrito = custo no fim do período; a etiqueta é a variação no período (vermelho = subiu); embaixo, o custo de antes e a data em que mudou. Só um valor = o custo não mudou no período.', render: (r) => variacao(r.cAnt, r.cAt, r.cVar, r.cDia, true), sortVal: (r) => r.cVar ?? -99 };
    const cPreco = { key: 'vVar', label: 'Preço de venda', title: temCad ? 'Preço de venda CADASTRADO no AppNext (Produtos / Produtos Compostos) no fim do período: a margem usa o preço do sistema. A etiqueta é o reajuste no período (verde = subiu); embaixo, o preço de antes e a data — o "antes" vem do histórico que o painel guarda a cada planilha de preços importada. A linha "caixa R$ …" só aparece quando os cupons saíram a um preço diferente do sistema (− abaixo, + acima): o ⓘ ao lado diz o motivo provável e a aba "Caixa ≠ sistema" mostra todos. "Sem cadastro" = o produto não está na planilha de preços: vale o preço do caixa. Desconto dado no caixa não entra (fica separado no cupom).' : 'Preço de tabela que saiu nos cupons (sem desconto) no fim do período. A etiqueta é o reajuste no período (verde = subiu); embaixo, o preço de antes e a data. Conta como reajuste quando o preço novo se mantém.',
      render: (r) => variacao(r.vAnt, r.vAt, r.vVar, r.vDia, false,
        temCad && r.base === 'caixa' ? h('small', null, 'sem cadastro · margem pelo caixa') : null,
        r.base !== 'caixa' && r.tabDif != null ? h('small', { class: 'prc-cx' }, h('span', null, `caixa ${fmt.brl(r.vCx)} `, h('span', { class: r.tabPor && r.tabPor.tipo === 'parado' ? null : 'neg' }, `(${pctTxt(r.tabDif)})`)), r.tabPor ? TS.dica(r.tabPor.longo) : null) : null),
      sortVal: (r) => r.vVar ?? -99 };
    const cMargem = { key: 'difMargem', label: 'Margem bruta', title: 'Margem bruta = (preço de venda − custo) ÷ preço de venda, sem impostos, comissão nem royalties. Em negrito = no fim do período (vermelho = caiu); a etiqueta mostra quantos pontos percentuais (p.p.) ganhou ou perdeu; embaixo, a margem de antes.', render: (r) => { if (r.mAt == null) return '—'; const mudou = r.difMargem != null && Math.abs(r.difMargem) >= 0.0005; return h('div', { class: 'prc-c' },
        h('span', { class: 'prc-c1' }, h('b', { class: r.perdeu ? 'neg' : null }, fmt.pct(r.mAt)), mudou ? h('span', { class: 'prc-badge ' + (r.difMargem < 0 ? 'prc-ruim' : 'prc-bom') }, `${r.difMargem > 0 ? '+' : ''}${fmt.n1(r.difMargem * 100)} p.p.`) : null),
        mudou ? h('small', null, `antes ${fmt.pct(r.mAnt)}`) : null); },
      sortVal: (r) => r.difMargem ?? 0 };
    // aba "Caixa ≠ sistema": o preço do cadastro, o que saiu nos cupons e o motivo provável, por extenso
    const cSistema = { key: 'vAt', label: 'No sistema', title: 'Preço de venda CADASTRADO no AppNext no fim do período (é ele que entra na margem). Etiqueta e "antes" aparecem quando o cadastro mudou no período.', render: (r) => variacao(r.vAnt, r.vAt, r.vVar, r.vDia, false) };
    const cCaixa = { key: 'cx', label: 'No caixa', title: 'Preço que saiu nos cupons (o mais vendido nas últimas semanas). A etiqueta mostra quanto o caixa ficou abaixo (−) ou acima (+) do sistema; cinza = o produto não vende mais e o preço é antigo. Desconto dado no caixa não entra (fica separado no cupom).',
      render: (r) => h('div', { class: 'prc-c' }, h('span', { class: 'prc-c1' }, h('b', null, fmt.brl(r.vCx)), h('span', { class: 'prc-badge ' + (r.tabPor && r.tabPor.tipo === 'parado' ? 'prc-neutro' : 'prc-ruim') }, pctTxt(r.tabDif))), h('small', null, 'do sistema')), sortVal: (r) => (r.tabDif == null ? -99 : Math.abs(r.tabDif)) };
    const cMotivo = { key: 'tabPor', label: 'Motivo provável', align: 'l', wrap: true, title: 'Por que o caixa difere do sistema, olhando as vendas das últimas 4 semanas: "última venda dd/mm" = não vende mais e o preço é antigo; "promoção?" = parte das vendas no preço do sistema e parte em outro; "PDV ≠ cadastro" ou "desde dd/mm" = todas as vendas fora do preço do sistema (um dos dois está desatualizado).',
      render: (r) => (r.tabPor ? h('span', null, h('b', null, r.tabPor.curto), h('small', { class: 'muted efp-det' }, r.tabPor.longo)) : '—'), sortVal: (r) => (r.tabPor ? r.tabPor.tipo : '') };
    const ehCad = filtro === 'cad';
    const tab = TS.table({ linhaMob: { nome: 'nome', val: 'difMargem', l2: ['cVar', 'vVar'], l3: ['vAt', 'cx', 'tabPor'] }, // celular em linhas (LMOB-04)
        
      cols: ehCad ? [cNome, cSistema, cCaixa, cMotivo] : [cNome, cCusto, cPreco, cMargem],
      rows, sortKey: ehCad ? 'cx' : filtro === 'margem' ? 'difMargem' : 'cVar', sortDir: filtro === 'margem' ? 'asc' : 'desc', maxHeight: '640px', search: 'Buscar produto…', searchKeys: ['nome', 'cat', 'grp'], produto: 'nome', cls: 'est-t prc-t', cartao: true,
      empty: 'Nenhum produto neste filtro no período.',
    });
    return TS.cardWithTools('Produtos', `Clique no produto para ver o gráfico de custo × venda e todos os reajustes. Custo e preço são de 1 unidade vendida (pacote, lata, caneca…): o valor em destaque é o do fim do período e, embaixo, o de antes. ${temCad ? `O preço de venda é o cadastrado no AppNext (é ele que entra na margem); quando o caixa cobrou diferente, aparece embaixo${D.tabHistDesde ? ` (reajustes do cadastro desde ${quando(D.tabHistDesde)})` : ' (o histórico de reajustes do cadastro começa a ser guardado agora, a cada planilha de preços importada)'}.` : 'O preço de venda é o que saiu nos cupons.'}`,
      h('div', { class: 'est-tools' }, tab.searchBox && (tab.searchBox.classList.add('est-busca'), tab.searchBox),
        abas()),
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
      linha('Preço de venda', vAnt, vAt, fmt.brl, true, r.base === 'caixa' ? 'pelo caixa (produto sem cadastro)' : 'cadastro do AppNext'),
      r.tab != null ? h('tr', null, h('td', { class: 'l' }, h('div', null, 'Vendido no caixa'), h('small', { class: r.tabDif != null ? 'neg' : 'muted' }, r.tabDif != null ? `${pctTxt(r.tabDif)} do cadastro` : 'igual ao cadastro'), r.tabPor ? h('small', { class: 'muted', style: { display: 'block' } }, r.tabPor.longo) : null), h('td', null, h('span', { class: 'prc-aa' }, h('b', null, fmt.brl(r.vCx))))) : null,
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
      h('div', { class: 'card-title' }, r.nome), h('div', { class: 'card-sub' }, r.cat, r.status ? ' · no período: ' : null, r.status ? h('span', { class: 'prc-st ' + ST_PROD[r.status][1] }, ST_PROD[r.status][0]) : null),
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
      TS.efeitoPreco ? TS.efeitoPreco.detalhe(r) : null,
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
      corpo.replaceChildren(cartaoNotas({ loja, hist: e.historico || {}, comprasItens: (e.compras && e.compras.itens) || {}, tabela: (e.tabela && e.tabela.itens) || [] }));
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
  /**
   * abre a janela de uma nota de entrada por cima da tela em que a pessoa está (ex.: Estoque → Validade, "NF 3270"):
   * a mesma janela da tela Notas fiscais, com os mesmos dados (estoque, notas, devoluções, NF-e de saída e lotes).
   * Só para quem tem a tela Notas fiscais (o servidor também nega as notas a quem não tem). → Promise<boolean>
   */
  TS.abrirNotaEntrada = async function (loja, nf, entrada, cod) {
    const e = await TS.estoqueBuscar(loja);
    const D = { loja, hist: e.historico || {}, comprasItens: (e.compras && e.compras.itens) || {}, tabela: (e.tabela && e.tabela.itens) || [] };
    const p = cacheNotas.get(loja) || fetch(TS.api(`estoque/notas?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || 'Falha ao ler as notas.'); return j; });
    cacheNotas.set(loja, p);
    const buscarDevs = () => (TS.demo ? Promise.resolve([]) : fetch(TS.api(`devolucoes?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { devolucoes: [] })).then((x) => x.devolucoes || []).catch(() => []));
    const indexar = (j, devs) => { j.devs = new Map(); for (const d of devs) { const k = `${d.nota.id}|${d.nota.nf}`; (j.devs.get(k) || j.devs.set(k, []).get(k)).push(d); } };
    const devs = await buscarDevs();
    const saidas = await fetch(TS.api(`nfsaida?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { notas: [] })).then((x) => x.notas || []).catch(() => []);
    const j = await p.catch((err) => { cacheNotas.delete(loja); throw err; });
    j.saidas = saidas; j.lotesPend = (TS.validade ? await TS.validade.pendentes(loja) : {}) || {};
    indexar(j, devs);
    const cand = (j.notas || []).filter((x) => String(x.nf) === String(nf));
    // a nota certa: mesma entrada; senão a que tem o produto; senão só se houver uma com esse número (nunca abre uma nota qualquer)
    const dia10 = (v) => String(v || '').slice(0, 10);
    const n = (entrada && cand.find((x) => dia10(x.entrada) === dia10(entrada)))
      || (cod != null && cand.find((x) => (x.itens || []).some((i) => String(i.cod) === String(cod))))
      || (cand.length === 1 ? cand[0] : null);
    if (!n) return false;
    abrirNota(D, { ...n, dia: TS.isoToDay(n.entrada || n.emissao), nfTxt: `${n.nf ?? '—'}${n.serie ? ' / ' + n.serie : ''}` }, j, () => buscarDevs().then((d) => indexar(j, d)));
    return true;
  };
  function listaNotas(D, j, aoMudar) {
    const f = state.f;
    const todas = (j.notas || []).map((n) => {
      const dia = TS.isoToDay(n.entrada || n.emissao);
      // busca: também acha a nota pelo nome ou código de um produto dela
      const descItens = n.itens.some((i) => i.desc != null) ? n.itens.reduce((a, i) => a + (+i.desc || 0), 0) : null;
      const desconto = n.desconto != null ? n.desconto : descItens;
      return { ...n, desconto, dia, nfTxt: `${n.nf ?? '—'}${n.serie ? ' / ' + n.serie : ''}`, nItens: n.itens.length, compra: /compra/i.test(n.motivo || ''), busca: n.itens.map((i) => i.nome + ' ' + i.cod).join(' ') };
    });
    if (!todas.length) return TS.card('Notas fiscais de entrada', null, h('p', { class: 'muted' }, 'Nenhuma nota de entrada no painel ainda. O coletor lê as notas concluídas de Estoque → Entrada de Produtos do AppNext junto com o estoque.'));
    const noPer = (n) => (f.de == null || n.dia >= f.de) && (f.ate == null || n.dia <= f.ate);
    const temAlgumaDev = todas.some((n) => !!devAtivaDeNota(j, n));
    const temPend = Object.keys(j.lotesPend || {}).length > 0;
    const temDescLido = todas.some((n) => n.desconto != null);
    const subiuCusto = (n) => n.itens.some((i) => { const a = custoAntes(D, i.cod, n.dia, n.nf); return a && a.v > 0 && i.custo > a.v * 1.005; });
    const FIL = { per: ['No período', noPer, 'Notas com entrada dentro do período escolhido nos filtros'], todas: ['Todas', () => true, 'Todas as notas de entrada lidas do AppNext'],
      ...(todas.some((n) => n.desconto > 0.005) ? { desc: ['Com desconto', (n) => n.desconto > 0.005, 'Notas com desconto (a franquia desconta as devoluções diluindo nos produtos)'] } : {}),
      subiu: ['Custo subiu', subiuCusto, 'Notas com pelo menos um produto mais caro que na compra anterior'],
      ...(temAlgumaDev ? { dev: ['Com devolução', (n) => !!devAtivaDeNota(j, n), 'Notas com devolução à franquia (itens quebrados, faltando ou com validade curta)'] } : {}),
      ...(temPend ? { lote: ['Lote pendente', (n) => !!j.lotesPend[n.id], 'Notas com chá a granel, envasado ou alimentação sem o nº do lote: abra a nota e preencha'] } : {}) };
    const fil = FIL[state.prcNotasFil] ? state.prcNotasFil : 'per';
    const rows = todas.filter(FIL[fil][1]);
    const tab = TS.table({ linhaMob: { nome: 'nfTxt', val: 'total', l2: ['dia', 'fornecedor', 'nItens', 'desconto'] }, // celular em linhas (LMOB-04)
        
      cols: [
        // compacta: entrada + emissão numa coluna, tipo junto do fornecedor; a linha inteira abre a nota
        { key: 'dia', label: 'Entrada', align: 'l', render: (r) => h('span', null, r.entrada ? quando(r.entrada) : '—', h('small', { class: 'est-tam' }, r.emissao ? 'emissão ' + quando(r.emissao) : '')), sortVal: (r) => r.dia ?? 0 },
        { key: 'nfTxt', label: 'NF / série', align: 'l', render: (r) => h('a', { href: '#', class: 'prc-nome', onclick: (e) => { e.preventDefault(); e.stopPropagation(); abrirNota(D, r, j, aoMudar); } }, r.nfTxt), sortVal: (r) => +r.nf || 0 },
        { key: 'fornecedor', label: 'Fornecedor', align: 'l', wrap: true, render: (r) => { const dv = devAtivaDeNota(j, r); return h('span', null, r.fornecedor || '—', h('small', { class: 'est-tam' }, r.motivo ? h('span', { class: 'prc-st ' + (r.compra ? 'prc-st-v' : 'prc-st-n') }, r.motivo) : null,
          dv ? h('span', { class: 'prc-st nf-dev', title: dv.dica }, `↩ devolução${dv.total > 1 ? ` (${dv.total})` : ''}`) : null,
          j.lotesPend && j.lotesPend[r.id] ? h('span', { class: 'prc-st vl-pend', title: `${j.lotesPend[r.id]} produto(s) (chá a granel, envasado ou alimentação) sem o nº do lote: abra a nota e preencha` }, `🍃 lote pendente (${j.lotesPend[r.id]})`) : null)); } },
        { key: 'nItens', label: 'Itens', fmt: fmt.int },
        ...(temDescLido ? [{ key: 'desconto', label: 'Desconto', title: 'Desconto da nota (a franquia dá o desconto das devoluções diluído nos produtos)', render: (r) => (r.desconto == null ? h('span', { class: 'muted' }, '—') : r.desconto > 0.005 ? h('b', { class: 'nf-desc' }, fmt.brl(r.desconto)) : h('span', { class: 'muted' }, 'R$ 0,00')), sortVal: (r) => r.desconto ?? -1 }] : []),
        { key: 'total', label: 'Total da nota', fmt: (v) => (v == null ? '—' : fmt.brl(v)) },
      ],
      rows, sortKey: 'dia', maxHeight: '520px', search: 'Buscar NF, fornecedor ou produto…', searchKeys: ['nfTxt', 'fornecedor', 'motivo', 'busca'], cls: 'est-t', onRowClick: (r) => abrirNota(D, r, j, aoMudar),
      total: { nfTxt: `${fmt.int(rows.length)} notas`, nItens: rows.reduce((a, r) => a + r.nItens, 0), total: rows.reduce((a, r) => a + (r.total || 0), 0), ...(temDescLido ? { desconto: fmt.brl(rows.reduce((a, r) => a + (r.desconto || 0), 0)) } : {}) },
      imprimir: ['dia', 'nfTxt', 'fornecedor', 'nItens', 'desconto', 'total'],
      empty: fil === 'per' ? 'Nenhuma nota no período do filtro. Veja "Todas".' : 'Nenhuma nota.',
    });
    const sincEl = botaoSincronizar(D, j);
    return TS.cardWithTools('Notas fiscais de entrada', `Notas de entrada concluídas no AppNext (Estoque → Entrada de Produtos), lidas pelo coletor${j.atualizado ? ' · atualizado em ' + new Date(j.atualizado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}. Clique na nota para ver os produtos, quantidades, valores e o que mudou no custo.`,
      // 2ª passada (23/11/2026): no cabeçalho só a ação (Sincronizar), junto de Imprimir e Expandir; busca e abas em cima da tabela
      sincEl ? h('div', { class: 'est-p2-acoes-dir ped-p2-acoes' }, sincEl) : null,
      h('div', { class: 'est-tools est-p2-tools' }, tab.searchBox && (tab.searchBox.classList.add('est-busca'), tab.searchBox),
        TS.segFolha(Object.entries(FIL).map(([k, [t, fn, dica]]) => [`${t} (${fmt.int(todas.filter(fn).length)})`, k, dica]), fil, (v) => { state.prcNotasFil = v; const c = document.querySelector('.prc-notas > .mt'); if (c) c.replaceChildren(listaNotas(D, j, aoMudar)); })),
      sincEl && sincEl._log, tab);
  }
  /** "Sincronizar agora" (admin ou franqueado da loja): o coletor busca o estoque e as notas de compra do AppNext; acompanha até terminar */
  const sinc = {}; // loja -> timer
  function botaoSincronizar(D, j) {
    if (TS.demo || !TS.eu || !['admin', 'franqueado'].includes(TS.eu.perfil)) return null;
    const loja = D.loja;
    const st = h('small', { class: 'muted nf-sinc-st' });
    // log do robô, como nas outras telas: ao vivo enquanto roda; depois, o final da última execução
    const logPre = h('pre', { class: 'inv-log nf-sinc-log' });
    const logBox = h('details', { class: 'nf-sinc-logbox', hidden: true, open: state.nfSincLogAberto || null, ontoggle: (e) => { state.nfSincLogAberto = e.target.open; } },
      h('summary', null, h('span', { class: 'nf-sinc-logtit' }, 'Log do robô')), logPre);
    // "na fila": o número que o coletor devolve conta o próprio pedido desta loja (mostrava "1" esperando sem ninguém à frente);
    // o que segura a fila é o robô ocupado com outra tarefa — diz qual e desde quando (NF-FILA-01)
    const filaTxt = (s) => {
      if (s.roboParado) return '⚠ a fila do robô parou de andar (ninguém está rodando): reinicie o coletor na VPS (docker compose restart coletor) e clique de novo.';
      const r = s.robo;
      const desde = r && r.inicio ? ` desde ${new Date(r.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '';
      return r ? `⏳ na fila: o robô está ${r.outraLoja ? 'atualizando outra loja' : 'terminando outra tarefa desta loja'}${desde}; começa logo depois…` : '⏳ na fila: começa em instantes…';
    };
    const pintarLog = (s) => {
      const box = document.querySelector('.nf-sinc-logbox') || logBox, pre = box.querySelector('pre') || logPre, tit = box.querySelector('.nf-sinc-logtit');
      const linhas = (s.log || []).filter((l) => String(l).trim());
      const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
      const fazendo = s.robo && s.estado === 'na_fila' ? ` · o robô está ${s.robo.outraLoja ? 'atualizando outra loja' : 'ocupado nesta loja'}${s.robo.inicio ? ' desde ' + new Date(s.robo.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}` : '';
      if (tit) tit.textContent = s.estado === 'rodando' ? `Log do robô (ao vivo, desde ${quando(s.inicio)})`
        : s.estado === 'na_fila' ? `Na fila desde ${quando(s.criado)}${fazendo}`
        : s.fim ? `Log da última atualização (${quando(s.fim)} · ${s.estado === 'ok' ? 'concluída' : 'falhou'}${s.itens ? ' · ' + s.itens.join(', ') : ''})` : 'Log do robô';
      pre.textContent = linhas.length ? linhas.join('\n') : s.estado === 'na_fila' ? filaTxt(s).replace('⏳ ', '').replace(/^na fila: /, 'Aguardando: ') : 'Sem log.';
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
        let s; try { const r = await fetch(TS.api(url), { credentials: 'same-origin' }); s = r.ok ? await r.json() : null; } catch { s = null; }
        // sem resposta (o coletor reiniciando, a internet caindo): continua acompanhando — antes a tela congelava em "na fila" (NF-FILA-01)
        if (!s) { const v = document.querySelector('.nf-sinc-st') || st; v.textContent = '⏳ sem resposta do coletor agora; tentando de novo…'; sinc[loja] = setTimeout(passo, 8000); return; }
        const vivo = document.querySelector('.nf-sinc-st') || st;
        pintarLog(s);
        if (s.estado === 'na_fila' || s.estado === 'rodando') {
          vivo.textContent = s.estado === 'na_fila' ? filaTxt(s) : '⏳ buscando no AppNext…';
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
  /**
   * custo que subiu numa nota × preço de venda: para cada produto da tabela de preço feito com o item
   * (o próprio item, ou o pacote de chá feito com a matéria-prima), a margem bruta antes e agora e o preço
   * que mantém a margem de antes (arredondado para ,90). itens: [{ cod, nome, antes, depois }]
   */
  function impactoCusto(M, tabela, itens) {
    if (!M || !tabela || !tabela.length) return [];
    const subiu = new Map(itens.filter((i) => i.antes > 0 && i.depois > i.antes * 1.005).map((i) => [String(i.cod), i]));
    if (!subiu.size) return [];
    const out = [];
    for (const t of tabela) {
      if (!(t.preco > 0.011)) continue;
      const c = M.custoCadastro(t.cod, t.desc);
      if (!c || !c.it) continue;
      const it = subiu.get(String(c.it.cod));
      if (!it) continue;
      const parte = c.kg ? (c.g / 1000) : 1;          // quanto do item vai no produto
      const fixo = c.custo - parte * (c.it.custo || 0); // embalagem (pacote de chá)
      const cA = fixo + parte * it.antes, cD = fixo + parte * it.depois;
      const mA = (t.preco - cA) / t.preco, mD = (t.preco - cD) / t.preco;
      const sug = mA < 0.95 ? Math.ceil((cD / (1 - mA)) - 0.9) + 0.9 : null;
      out.push({ cod: t.cod, desc: t.desc, preco: t.preco, item: it.nome, itCod: String(it.cod), cA, cD, mA, mD, sug: sug && sug > t.preco ? sug : null });
    }
    return out.sort((a, b) => (a.mD - a.mA) - (b.mD - b.mA));
  }
  TS.impactoCusto = impactoCusto;
  TS.custoAntesNota = (D, cod, dia, nf) => custoAntes(D, cod, dia, nf);

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
  /**
   * Gráfico do histórico de compras de um item como imagem (PNG), para ir no e-mail à franquia.
   * pts: [{ dia: 'AAAA-MM-DD', custo, esta }] em ordem; o ponto desta nota fica maior.
   */
  function graficoComprasPng(nome, pts, unidade) {
    const W = 600, H = 280, esc = 2, mE = 86, mD = 40, mT = 44, mB = 44;
    const cv = document.createElement('canvas'); cv.width = W * esc; cv.height = H * esc;
    const g = cv.getContext('2d'); g.scale(esc, esc);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1d2b22'; g.font = 'bold 15px Arial, sans-serif'; g.textBaseline = 'alphabetic';
    g.fillText(`${nome} — custo ${unidade === 'kg' ? 'do kg' : 'da unidade'} nas compras`, 12, 22);
    const vs = pts.map((p) => p.custo);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 0.01) { lo -= 5; hi += 5; }
    const pad = (hi - lo) * 0.12; lo = Math.max(0, lo - pad); hi += pad;
    const x = (k) => (pts.length === 1 ? (mE + W - mD) / 2 : mE + (k * (W - mE - mD)) / (pts.length - 1));
    const y = (v) => mT + (1 - (v - lo) / (hi - lo)) * (H - mT - mB);
    g.font = '11px Arial, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4, yy = y(v);
      g.strokeStyle = '#ece7da'; g.lineWidth = 1; g.beginPath(); g.moveTo(mE, yy); g.lineTo(W - mD, yy); g.stroke();
      g.fillStyle = '#6b7a70'; g.fillText(fmt.brl(v), mE - 8, yy);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    const passo = Math.ceil(pts.length / 7);
    pts.forEach((p, k) => { if (k % passo === 0 || k === pts.length - 1) { g.fillStyle = p.esta ? '#1d2b22' : '#6b7a70'; g.fillText(quando(p.dia), x(k), H - mB + 10); } });
    g.strokeStyle = '#C98A1B'; g.lineWidth = 2.5; g.beginPath();
    pts.forEach((p, k) => (k ? g.lineTo(x(k), y(p.custo)) : g.moveTo(x(k), y(p.custo)))); g.stroke();
    pts.forEach((p, k) => {
      g.fillStyle = '#C98A1B'; g.beginPath(); g.arc(x(k), y(p.custo), p.esta ? 7 : 4.5, 0, Math.PI * 2); g.fill();
      if (p.esta || k === 0 || pts.length <= 8) { g.fillStyle = '#1d2b22'; g.font = (p.esta ? 'bold ' : '') + '11px Arial, sans-serif'; g.textBaseline = 'bottom'; g.fillText(fmt.brl(p.custo), Math.min(Math.max(x(k), mE + 30), W - mD - 30), y(p.custo) - 9); g.textBaseline = 'top'; g.font = '11px Arial, sans-serif'; }
    });
    return cv.toDataURL('image/png');
  }
  TS.graficoComprasPng = graficoComprasPng; // testes

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
    // chá a granel, envasados e alimentação: lote e validade na própria linha do produto (salvam sozinhos). O servidor diz
    // quais itens têm lote (src/tipoprod.js); a coluna aparece já com o chá em kg e quando chegam os outros
    let temGranel = !!TS.validade && n.itens.some((i) => unTxt(i.un) === 'kg');
    let lotesNota = null, lotesVieram = false;
    const faltaLote = h('span', { class: 'vl-falta' });
    const contarLotes = () => { if (!lotesNota) return; const f = lotesNota.itens.filter((x) => x.lote === '0').length; faltaLote.textContent = f ? `🍃 ${f} sem lote` : '🍃 lotes preenchidos ✓'; faltaLote.className = f ? 'vl-falta' : 'vl-falta ok'; };
    const aoSalvarLote = () => { contarLotes(); TS.validade.pendentes(D.loja).then((p) => { j.lotesPend = p; const c = document.querySelector('.prc-notas > .mt'); if (c) c.replaceChildren(listaNotas(D, j, aoMudar)); }); };
    const celLote = (r) => {
      const box = h('div', { class: 'vl-nota-cel', 'data-cod': r.cod });
      if (lotesNota) { const c = lotesNota.campos(r.cod); if (c) box.append(c); else box.append(h('span', { class: 'muted' }, '—')); }
      else if (unTxt(r.un) === 'kg' || !lotesVieram) box.append(h('span', { class: 'muted' }, '…'));
      else box.append(h('span', { class: 'muted' }, '—'));
      return box;
    };
    // margem menor por causa desta nota: { cod do item → produtos à venda afetados } (chega depois, com os custos)
    let impPorItem = new Map(), soImpacto = false;
    const celImpacto = (r) => {
      const ps = impPorItem.get(String(r.cod));
      if (!ps) return null;
      // o próprio produto é o que se vende (acessório): a informação vai na linha
      if (ps.length === 1 && String(ps[0].cod) === String(r.cod)) {
        const x = ps[0];
        return h('small', { class: 'nf-marg-info' }, `Margem ${fmt.pct(x.mA, 1)} → `, h('b', null, fmt.pct(x.mD, 1)), x.sug ? ` · p/ manter: ${fmt.brl(x.sug)}` : ' · o preço atual ainda mantém a margem');
      }
      // chá a granel e o que é feito com o item: os pacotes numa janela
      return h('button', { type: 'button', class: 'nf-marg-info nf-marg-btn', onclick: (e) => { e.stopPropagation(); abrirPacotes(r, ps); } },
        `Margem menor em ${ps.length} ${ps.length === 1 ? (r.un && unTxt(r.un) === 'kg' ? 'pacote' : 'produto') : (r.un && unTxt(r.un) === 'kg' ? 'pacotes' : 'produtos')} · ver ›`);
    };
    const abrirPacotes = (r, ps) => {
      document.querySelector('.prc-popup-camada')?.remove();
      const fecharP = () => { cam.remove(); document.removeEventListener('keydown', escP, true); };
      const escP = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fecharP(); } };
      const lista = [...ps].sort((a, b) => a.preco - b.preco);
      const pop = h('aside', { class: 'card prc-popup nf-marg-pop', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Margem de ${r.nome}` },
        h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fecharP }, '✕'),
        h('div', { class: 'card-title' }, r.nome),
        h('div', { class: 'card-sub' }, `Custo ${r.antes != null ? fmt.brl(r.antes) + ' → ' : ''}${fmt.brl(r.custo)}${r.varC != null ? ' (' + pctTxt(r.varC) + ')' : ''}. Produtos à venda feitos com este item:`),
        TS.table({
          cols: [
            { key: 'desc', label: 'Produto à venda', align: 'l', wrap: true },
            { key: 'preco', label: 'Preço atual', fmt: fmt.brl },
            { key: 'cD', label: 'Custo agora', render: (x) => h('span', null, fmt.brl(x.cD), h('small', { class: 'est-tam' }, `antes ${fmt.brl(x.cA)}`)), sortVal: (x) => x.cD },
            { key: 'mD', label: 'Margem bruta', render: (x) => h('span', null, h('b', { class: x.mD < x.mA - 0.02 ? 'neg' : '' }, fmt.pct(x.mD, 1)), h('small', { class: 'est-tam' }, `era ${fmt.pct(x.mA, 1)}`)), sortVal: (x) => x.mD - x.mA },
            { key: 'sug', label: 'Preço p/ manter a margem', render: (x) => (x.sug ? h('b', null, fmt.brl(x.sug)) : h('span', { class: 'muted' }, 'já mantém')), sortVal: (x) => x.sug || 0 },
          ],
          rows: lista, sortKey: 'preco', sortDir: 'asc', cls: 'est-t',
        }),
        h('small', { class: 'muted' }, 'Preço da tabela de preço do AppNext. "Preço p/ manter a margem" = custo novo ÷ (1 − margem de antes), arredondado para ,90. Mude o preço no AppNext se fizer sentido.'));
      const cam = h('div', { class: 'prc-popup-camada', onmousedown: (e) => { if (e.target === cam) fecharP(); } }, pop);
      document.body.append(cam);
      document.addEventListener('keydown', escP, true);
    };
    // reclamar do reajuste com a franquia: escolhe os itens, revisa destinatários/assunto/mensagem e envia (admin e franqueado)
    const abrirEnvioFranquia = () => {
      document.querySelector('.prc-popup-camada')?.remove();
      const fecharP = () => { cam.remove(); document.removeEventListener('keydown', escP, true); };
      const escP = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fecharP(); } };
      const vistos = new Set();
      const itens = linhas.filter((r) => r.varC != null && r.varC > 0.0005 && r.antes > 0 && !vistos.has(String(r.cod)) && vistos.add(String(r.cod)))
        .sort((a, b) => b.varC - a.varC).map((r) => ({ cod: String(r.cod), nome: r.nome, antes: r.antes, depois: r.custo, varC: r.varC, origem: r.origemAntes, on: true }));
      const nomeLoja = (TS.lojas || []).find((l) => l.id === D.loja)?.nome || '';
      const quem = String((TS.eu && TS.eu.nome) || '').trim().split(/\s+/)[0] || '';
      const iPara = h('input', { type: 'text', class: 'input', placeholder: 'e-mail da franquia (separe vários por vírgula)', 'aria-label': 'Para' });
      const iAssunto = h('input', { type: 'text', class: 'input', maxlength: 200, 'aria-label': 'Assunto',
        value: `Reajuste de custo — NF ${n.nfTxt}${n.fornecedor ? ' — ' + n.fornecedor : ''}${nomeLoja ? ' — ' + nomeLoja : ''}` });
      const iMsg = h('textarea', { class: 'input nf-fr-msg', rows: 6, maxlength: 5000, 'aria-label': 'Mensagem' });
      iMsg.value = `Olá,\n\nNa nota fiscal ${n.nfTxt}${n.entrada ? ` (entrada em ${quando(n.entrada)})` : ''}${n.fornecedor ? `, de ${n.fornecedor},` : ''} os produtos abaixo chegaram com custo maior do que na compra anterior. Podem conferir se o reajuste está correto?\n\nObrigado${quem ? ',\n' + quem : '.'}`;
      const status = h('div', { class: 'nf-fr-st', role: 'status' });
      const conta = h('span', { class: 'muted' });
      const cGraf = h('input', { type: 'checkbox', checked: true });
      // histórico de compras de cada item (das notas que o painel tem), com esta nota marcada
      const pontos = (x) => ((D.comprasItens && D.comprasItens[x.cod]) || []).map(([dia, custo, nf]) => ({ dia, custo, esta: String(nf) === String(n.nf) }))
        .filter((p) => p.custo > 0).sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0)).slice(-15);
      const btEnviar = h('button', { type: 'button', class: 'btn primary' }, '✉ Enviar');
      const pintarConta = () => { const k = itens.filter((x) => x.on).length; conta.textContent = `${k} de ${itens.length} ${itens.length === 1 ? 'produto marcado' : 'produtos marcados'}`; btEnviar.disabled = !k; };
      const marcarTodos = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Marcar todos', onchange: (e) => { for (const x of itens) x.on = e.target.checked; lista.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = e.target.checked; }); pintarConta(); } });
      const lista = h('div', { class: 'nf-fr-lista' }, ...itens.map((x) => h('label', { class: 'nf-fr-item' },
        h('input', { type: 'checkbox', checked: true, onchange: (e) => { x.on = e.target.checked; marcarTodos.checked = itens.every((y) => y.on); pintarConta(); } }),
        h('span', { class: 'nf-fr-nome' }, x.nome, h('small', { class: 'muted' }, `cód. ${x.cod}${x.origem ? ' · antes: ' + x.origem : ''}`)),
        h('span', { class: 'nf-fr-val' }, h('s', { class: 'muted' }, fmt.brl(x.antes)), ' → ', h('b', null, fmt.brl(x.depois)), h('span', { class: 'prc-badge prc-ruim' }, pctTxt(x.varC))))));
      btEnviar.addEventListener('click', async () => {
        const marcados = itens.filter((x) => x.on);
        if (!marcados.length) return;
        if (!iPara.value.trim()) { status.className = 'nf-fr-st neg'; status.textContent = 'Informe para quem enviar.'; iPara.focus(); return; }
        if (!confirm(`Enviar o e-mail para ${iPara.value.trim()} com ${marcados.length} ${marcados.length === 1 ? 'produto' : 'produtos'}?`)) return;
        btEnviar.disabled = true; status.className = 'nf-fr-st muted'; status.textContent = 'Enviando…';
        try {
          const graficos = cGraf.checked ? marcados.slice(0, 30).map((x) => { const pts = pontos(x); return pts.length ? { cod: x.cod, png: graficoComprasPng(x.nome, pts, unTxt(linhas.find((r) => String(r.cod) === x.cod)?.un)) } : null; }).filter(Boolean) : [];
          const r = await fetch(TS.api('reajuste/enviar'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' },
            body: JSON.stringify({ loja: D.loja, nf: n.nfTxt, para: iPara.value, assunto: iAssunto.value, mensagem: iMsg.value, graficos, itens: marcados.map(({ cod, nome, antes, depois }) => ({ cod, nome, antes, depois })) }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.erro || 'Falha ao enviar.');
          status.className = 'nf-fr-st ok';
          status.textContent = j.simulado ? '✓ Na apresentação o e-mail não é enviado — na loja de verdade ele sairia agora.' : `✓ Enviado para ${(j.para || []).join(', ')}.`;
        } catch (e) { status.className = 'nf-fr-st neg'; status.textContent = TS.erroDeRede && TS.erroDeRede(e) ? 'Sem conexão com o painel agora: tente de novo.' : e.message; btEnviar.disabled = false; }
      });
      pintarConta();
      const campo = (rot, el) => h('label', { class: 'nf-fr-campo' }, h('span', { class: 'f-label' }, rot), el);
      const pop = h('aside', { class: 'card prc-popup nf-fr-pop', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Enviar para a franquia' },
        h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fecharP }, '✕'),
        h('div', { class: 'card-title' }, '✉ Enviar para a franquia'),
        h('div', { class: 'card-sub' }, `NF ${n.nfTxt}${n.fornecedor ? ' · ' + n.fornecedor : ''}. Marque os produtos do reajuste que quer questionar; o e-mail leva a tabela com o custo antes, o desta nota e o aumento.`),
        campo('Para', iPara), campo('Assunto', iAssunto),
        h('div', { class: 'nf-fr-cab' }, h('label', { class: 'nf-fr-todos' }, marcarTodos, ' Produtos com custo maior'), conta),
        lista,
        h('label', { class: 'nf-fr-todos nf-fr-graf' }, cGraf, ' Incluir o gráfico do histórico de compras de cada produto marcado'),
        campo('Mensagem', iMsg),
        h('div', { class: 'nf-fr-acoes' }, h('button', { type: 'button', class: 'btn', onclick: fecharP }, 'Cancelar'), btEnviar),
        status);
      const cam = h('div', { class: 'prc-popup-camada', onmousedown: (e) => { if (e.target === cam) fecharP(); } }, pop);
      document.body.append(cam);
      document.addEventListener('keydown', escP, true);
      fetch(TS.api(`reajuste/para?loja=${encodeURIComponent(D.loja)}`), { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.para && !iPara.value) iPara.value = j.para.join(', '); }).catch(() => {});
      // o cursor vai para o "Para" só se a pessoa ainda não tocou em outro campo da janela (num aparelho lento o atraso
      // roubava o foco no meio da digitação do Assunto e o texto ia para o campo errado)
      setTimeout(() => { if (!pop.contains(document.activeElement)) iPara.focus(); }, 50);
    };
    TS.abrirEnvioFranquiaTeste = abrirEnvioFranquia; // testes
    // histórico de compras do item: todas as notas de compra que o painel tem (Estoque → Entrada de Produtos do AppNext)
    const abrirHistorico = (r) => TS.histCompras(r, D.comprasItens, n.nf);
    const tabBox = h('div');
    const montarTab = () => tabBox.replaceChildren(TS.table({ // itens da nota: campos de lote e validade (+ outra validade) ficam na tabela de sempre no celular
        
      rowClass: (r) => (impPorItem.has(String(r.cod)) ? 'nf-marg' : ''),
      cols: [
        { key: 'nome', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => h('span', null,
          h('button', { type: 'button', class: 'nf-hist-btn', title: 'Ver o histórico de compras deste produto', onclick: (e) => { e.stopPropagation(); abrirHistorico(r); } }, r.nome),
          h('small', { class: 'est-tam' }, `cód. ${r.cod}${r.grupo ? ' · ' + r.grupo : ''} · `, h('button', { type: 'button', class: 'nf-hist-lnk', onclick: (e) => { e.stopPropagation(); abrirHistorico(r); } }, 'histórico de compras ›')), celImpacto(r)) },
        { key: 'qtd', label: 'Qtd', render: (r) => `${unTxt(r.un) === 'kg' ? fmt.kg(r.qtd) : fmt.n2(r.qtd).replace(/,00$/, '')} ${unTxt(r.un)}` },
        { key: 'vu', label: 'Valor unit. (nota)', title: 'Valor unitário escrito na nota (sem IPI e rateios)', fmt: (v) => (v == null ? '—' : fmt.brl(v)) },
        { key: 'custo', label: 'Custo unit.', title: 'Valor líquido do item ÷ quantidade (com IPI e rateios): é o "custo último" que o AppNext usa', fmt: fmt.brl },
        { key: 'total', label: 'Total', fmt: fmt.brl },
        ...(n.itens.some((i) => i.desc > 0.005) ? [{ key: 'desc', label: 'Desconto', title: 'Desconto deste item na nota', fmt: (v) => (v ? fmt.brl(v) : '—') }] : []),
        { key: 'varC', label: 'Custo antes', title: 'Custo do mesmo produto antes desta nota (entrada anterior ou importação de estoque) e a variação', render: (r) => (r.antes == null ? h('span', { class: 'muted' }, 'primeira entrada') : h('div', { class: 'prc-v', title: r.origemAntes }, h('span', null, fmt.brl(r.antes)), r.varC != null && Math.abs(r.varC) >= 0.0005 ? h('span', { class: 'prc-badge ' + (r.varC > 0 ? 'prc-ruim' : 'prc-bom') }, pctTxt(r.varC)) : h('span', { class: 'muted' }, 'igual'))), sortVal: (r) => r.varC ?? -99 },
        ...(temGranel ? [{ key: 'lote', label: 'Lote · validade', align: 'l', title: 'Chá a granel, envasados e alimentação: digite o nº do lote e a validade do pacote (a nota não traz a validade). Vem com 12 meses da entrada; corrija pela data do pacote. Envasados e alimentação com duas datas na mesma linha: "+ outra validade". Validade curta na chegada mostra "Incluir na devolução". Salva sozinho.', render: celLote, sortVal: (r) => (lotesNota && lotesNota.porCod.has(String(r.cod)) ? (lotesNota.porCod.get(String(r.cod)).some((x) => x.lote === '0') ? 0 : 1) : 2) }] : []),
      ],
      rows: soImpacto ? linhas.filter((r) => impPorItem.has(String(r.cod))) : linhas, sortKey: 'total', maxHeight: '60vh', search: 'Buscar produto…', searchKeys: ['nome', 'cod'], cls: 'est-t est-t-larga nf-itens-t',
      total: { nome: `${fmt.int(linhas.length)} itens`, total: linhas.reduce((a, r) => a + r.total, 0), ...(n.itens.some((i) => i.desc > 0.005) ? { desc: linhas.reduce((a, r) => a + (r.desc || 0), 0) } : {}) },
    }));
    montarTab();
    const subiu = linhas.filter((r) => r.varC != null && r.varC > 0.0005).length, desceu = linhas.filter((r) => r.varC != null && r.varC < -0.0005).length;
    // preço de venda × custo novo (admin e franqueado): margem antes e agora e o preço que mantém a margem
    const blocoImpacto = h('div');
    if (subiu && TS.custosLoja) TS.custosLoja().then((M) => {
      const imp = impactoCusto(M, D.tabela, linhas.map((r) => ({ cod: r.cod, nome: r.nome, antes: r.antes, depois: r.custo })));
      if (!imp.length || !blocoImpacto.isConnected) return;
      impPorItem = new Map();
      for (const x of imp) { if (!impPorItem.has(x.itCod)) impPorItem.set(x.itCod, []); impPorItem.get(x.itCod).push(x); }
      // a mesma linha pode vir repetida na nota: a conta é uma vez por produto
      const nItens = linhas.filter((r, k) => impPorItem.has(String(r.cod)) && linhas.findIndex((y) => String(y.cod) === String(r.cod)) === k).length;
      const btSo = h('button', { type: 'button', class: 'btn nf-marg-filtro' });
      const pintarBt = () => { btSo.textContent = soImpacto ? 'Mostrar todos os produtos' : 'Mostrar só esses'; };
      btSo.addEventListener('click', () => { soImpacto = !soImpacto; pintarBt(); montarTab(); });
      pintarBt();
      blocoImpacto.replaceChildren(h('div', { class: 'nf-impacto' },
        h('div', { class: 'nf-impacto-l' },
          h('div', null,
            h('div', { class: 'f-label' }, `⚠ O custo subiu: ${imp.length} ${imp.length === 1 ? 'produto à venda ficou' : 'produtos à venda ficaram'} com margem menor`),
            h('small', { class: 'muted' }, `Em amarelo na lista abaixo (${fmt.int(nItens)} ${nItens === 1 ? 'item da nota' : 'itens da nota'}). Nos chás, toque em "ver" para os pacotes.`)),
          h('div', { class: 'nf-impacto-bts' }, btSo,
            TS.eu && ['admin', 'franqueado'].includes(TS.eu.perfil) ? h('button', { type: 'button', class: 'btn nf-fr-btn', onclick: abrirEnvioFranquia }, '✉ Enviar para a franquia') : null))));
      montarTab();
    }).catch(() => null);
    const vinculadas = saidasDeNota(j, n);
    const card = h('aside', { class: 'card prc-drawer prc-drawer-largo', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Nota ${n.nfTxt}` },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      h('div', { class: 'card-title' }, `NF ${n.nfTxt}`), h('div', { class: 'card-sub' }, n.fornecedor || 'Fornecedor não informado'),
      h('div', { class: 'prc-resumo' },
        h('div', null, h('small', null, 'Emissão'), h('b', null, n.emissao ? quando(n.emissao) : '—')),
        h('div', null, h('small', null, 'Entrada'), h('b', null, n.entrada ? quando(n.entrada) : '—')),
        h('div', null, h('small', null, 'Total da nota'), h('b', null, n.total != null ? fmt.brl(n.total) : '—')),
        n.desconto > 0.005 ? h('div', null, h('small', null, 'Desconto'), h('b', { class: 'nf-desc' }, fmt.brl(n.desconto))) : null),
      h('div', { class: 'prc-nota-info muted' }, [n.motivo && `Tipo: ${n.motivo}`, n.status && `Situação: ${n.status}`, n.cfop && `CFOP ${n.cfop}`, `${fmt.int(linhas.length)} itens`, subiu || desceu ? `custo subiu em ${fmt.int(subiu)} e caiu em ${fmt.int(desceu)}` : ''].filter(Boolean).join(' · ')),
      blocoSaidasVinculadas(D.loja, vinculadas),
      TS.devolucao ? TS.devolucao.barra(n, () => card, aoMudar) : null, // na apresentação o formulário abre, mas nada é registrado
      blocoImpacto,
      h('div', { class: 'f-label mt' }, 'Produtos da nota', TS.validade ? h('span', null, ' ', faltaLote) : null, h('button', { type: 'button', class: 'exp-btn prt-btn prc-nf-prt', title: 'Imprimir a nota', onclick: () => TS.imprimir(card) }, '🖨', h('span', null, 'Imprimir'))),
      tabBox);
    if (TS.validade) TS.validade.lotesDaNota(D.loja, n, aoSalvarLote).then((ln) => {
      lotesNota = ln; lotesVieram = true;
      contarLotes();
      if (ln && !temGranel) { temGranel = true; montarTab(); return; } // nota só com envasado/alimentação: a coluna entra agora
      // troca o "…" pelos campos nas linhas que já estão na tela
      for (const box of card.querySelectorAll('.vl-nota-cel')) { const c = ln && ln.campos(box.dataset.cod); box.replaceChildren(c || h('span', { class: 'muted' }, '—')); }
    });
    const camada = h('div', { class: 'prc-drawer-camada', onmousedown: (e) => { if (e.target === camada) fechar(); } }, card);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', esc);
  }
})();
