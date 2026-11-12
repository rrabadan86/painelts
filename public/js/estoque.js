/* Estoque e margem: custo de cada venda (planilha "Estoque Atual" do AppNext), rentabilidade e reposição.
 * Só admin e franqueado (o servidor não entrega custo para os outros perfis). */
(function () {
  const { h, fmt, state } = TS;
  const ESQ = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cache = new Map(); // loja → { at, estoque, cfg }
  const DIA = 86400e3;

  async function buscar(loja, forcar) {
    const c = cache.get(loja);
    if (c && !forcar && Date.now() - c.at < 120e3) return c;
    const r = await fetch(TS.api(`estoque?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha ao ler o estoque.');
    const x = { at: Date.now(), estoque: j.estoque, cfg: j.cfg };
    cache.set(loja, x);
    return x;
  }

  /** casa cada linha de venda com o item do estoque e calcula o custo */
  function motor(estoque, cfg) {
    const db = TS.db, I = TS.rules.ids;
    const porCod = new Map(), porNome = new Map(), porNomeKg = new Map();
    for (const it of estoque.itens) {
      porCod.set(String(it.cod), it);
      const n = ESQ(it.desc);
      if (it.un === 'Kg') { if (!porNomeKg.has(n)) porNomeKg.set(n, it); } else if (!porNome.has(n)) porNome.set(n, it);
    }
    const emb = {};
    for (const [g, lista] of Object.entries(cfg.embalagens || {})) emb[g] = lista.map((x) => ({ it: porCod.get(String(x.cod)), qtd: x.qtd })).filter((x) => x.it);
    const custoEmb = (g) => (emb[g] || []).reduce((s, x) => s + (x.it.custo || 0) * x.qtd, 0);
    const memo = new Map();
    const gramasDoCod = (cod) => { const m = /\.(\d+)\s*g$/i.exec(cod || ''); return m ? +m[1] : null; };
    /** { it, kg:boolean, g, via } ou null */
    function casar(i) {
      const k = db.cod[i] + '|' + db.desc[i];
      if (memo.has(k)) return memo.get(k);
      const cod = db.D.cod ? String(db.D.cod[db.cod[i]] ?? '') : '';
      const g = db.so[i] || gramasDoCod(cod);
      let r = null, it = cod && porCod.get(cod);
      if (it) r = { it, kg: it.un === 'Kg', g, via: 'código' };
      if (!r && cod && cod.includes('.')) { it = porCod.get(cod.split('.')[0]); if (it && it.un === 'Kg' && g) r = { it, kg: true, g, via: 'código' }; }
      if (!r) {
        const nP = ESQ(db.D.produto[db.prod[i]]), nD = ESQ(db.D.descricao[db.desc[i]]);
        it = g ? porNomeKg.get(nP) : null;
        if (it) r = { it, kg: true, g, via: 'nome' };
        else if ((it = porNome.get(nD) || porNome.get(nP))) r = { it, kg: false, g, via: 'nome' };
      }
      if (r && r.kg && !r.g) r = null; // granel sem saber os gramas: não dá para custear
      memo.set(k, r);
      return r;
    }
    const taxa = (i) => I.taxas.has(db.desc[i]) || (db.vu[i] != null && Math.abs(db.vu[i] - 0.01) < 1e-7);
    /** custo da linha (R$) ou null */
    function custo(i) {
      const c = casar(i);
      if (!c || !c.it.custo) return null;
      const q = db.qtd[i] || 0;
      return c.kg ? q * ((c.g / 1000) * c.it.custo + custoEmb(c.g)) : q * c.it.custo;
    }
    /** consumo de estoque da linha: [[item, quantidade na unidade do item]] */
    function consumo(i) {
      const c = casar(i);
      if (!c) return [];
      const q = db.qtd[i] || 0;
      if (!c.kg) return [[c.it, q]];
      return [[c.it, (q * c.g) / 1000], ...(emb[c.g] || []).map((x) => [x.it, q * x.qtd])];
    }
    return { casar, custo, consumo, taxa, porCod };
  }

  const TIPO_ITEM = (it) => (it.un === 'Kg' && it.tipo === 'IN' ? 'Chá a granel' : it.tipo === 'PN' ? 'Produto' : 'Insumo / embalagem');
  const qtdTxt = (v, it) => (v == null ? '—' : it.un === 'Kg' ? `${fmt.kg(v)} kg` : `${fmt.int(v)} ${it.un ? it.un.toLowerCase() : ''}`);

  TS.pages.estoque = function (root) {
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Estoque e margem'),
      h('div', { class: 'page-sub' }, 'Custo de cada venda, produtos mais rentáveis, o que repor e o que está parado')),
      h('div', { class: 'active-filters' }, h('span', { class: 'af' }, TS.periodoTexto()))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'O estoque é de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Lendo o estoque…'))));
    root.append(corpo);
    buscar(state.loja).then((x) => { if (corpo.isConnected) pintar(corpo, x); }).catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  };

  function pintar(corpo, { estoque, cfg }) {
    corpo.replaceChildren();
    if (!estoque || !estoque.itens || !estoque.itens.length) {
      corpo.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Ainda não há estoque desta loja'),
        h('p', null, 'No AppNext: Estoque → Estoque Atual → botão verde "Exportar para Excel". Envie o arquivo em Configurações → Lojas → Enviar planilha → "Estoque atual e custos". Depois disso o coletor baixa sozinho em cada atualização.')));
      return;
    }
    const db = TS.db;
    const M = motor(estoque, cfg);
    const temCod = db.D.cod && db.D.cod.some((c) => c);
    corpo.append(h('div', { class: 'muted est-origem' }, `Estoque e custos do AppNext de ${new Date(estoque.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${fmt.int(estoque.itens.length)} produtos`,
      temCod ? '' : ' · as vendas ainda não têm o código do produto: o casamento está sendo feito pelo nome (veja "Vendas sem custo" no fim)'));

    // ---------- rentabilidade no período e filtros escolhidos ----------
    const base = TS.filtrar();
    let fat = 0, fatCusto = 0, custoTot = 0;
    const porProd = new Map(), porVend = new Map(), semCusto = new Map();
    for (const i of base) {
      if (M.taxa(i)) continue;
      const vt = db.vt[i] || 0;
      fat += vt;
      const c = M.custo(i);
      const d = db.D.descricao[db.desc[i]];
      if (c == null) {
        const s = semCusto.get(d) || { produto: d, cod: db.D.cod ? db.D.cod[db.cod[i]] : '', vt: 0, qtd: 0, motivo: M.casar(i) ? 'custo zero no AppNext' : 'não achado no estoque' };
        s.vt += vt; s.qtd += db.qtd[i] || 0; semCusto.set(d, s);
        continue;
      }
      fatCusto += vt; custoTot += c;
      const cs = M.casar(i);
      const granel = cs.kg;
      const chave = granel ? 'kg:' + cs.it.cod : d;
      const p = porProd.get(chave) || { produto: granel ? cs.it.desc : d, granel, qtd: 0, kg: 0, tam: new Map(), vt: 0, custo: 0 };
      const q = db.qtd[i] || 0;
      p.qtd += q; p.vt += vt; p.custo += c;
      if (granel) { p.kg += (q * cs.g) / 1000; p.tam.set(cs.g, (p.tam.get(cs.g) || 0) + q); }
      porProd.set(chave, p);
      const vn = db.D.vendedor[db.vend[i]] || '—';
      const v = porVend.get(vn) || { vendedor: vn, vt: 0, custo: 0, fat: 0 };
      v.vt += vt; v.custo += c; porVend.set(vn, v);
    }
    for (const i of base) { if (M.taxa(i)) continue; const v = porVend.get(db.D.vendedor[db.vend[i]] || '—'); if (v) v.fat += db.vt[i] || 0; }
    const lucro = fatCusto - custoTot;
    const tamTxt = (m) => [...m].sort((a, b) => a[0] - b[0]).map(([g, q]) => `${fmt.int(q)}× ${g >= 1000 ? g / 1000 + ' kg' : g + 'g'}`).join(' · ');
    const prods = [...porProd.values()].filter((p) => p.vt > 0).map((p) => ({ ...p, lucro: p.vt - p.custo, margem: (p.vt - p.custo) / p.vt, giro: p.granel ? p.kg : p.qtd, tamanhos: p.granel ? tamTxt(p.tam) : '' }));

    // ---------- reposição: últimos 30 dias da loja, sem os filtros ----------
    const fim = db.maxDay, ini = fim - 29;
    const cons = new Map(), ultimaVenda = new Map();
    for (let i = 0; i < db.n; i++) {
      for (const [it, q] of M.consumo(i)) {
        if (db.day[i] >= ini) cons.set(it.cod, (cons.get(it.cod) || 0) + q);
        if (!ultimaVenda.has(it.cod) || db.day[i] > ultimaVenda.get(it.cod)) ultimaVenda.set(it.cod, db.day[i]);
      }
    }
    const ent = cfg.entregaDias, cob = cfg.coberturaDias, seg = cfg.segurancaPct ?? 50;
    const repo = [];
    let valorEstoque = 0, valorParado = 0;
    const parados = [];
    for (const it of estoque.itens) {
      const vel = (cons.get(it.cod) || 0) / 30;
      const qtd = Math.max(0, it.qtd || 0);
      if (it.custo && qtd > 0) valorEstoque += qtd * it.custo;
      const dias = vel > 0 ? qtd / vel : null;
      let pedir = Math.max(0, vel * (ent + cob) - qtd, (it.min || 0) - qtd);
      pedir = it.un === 'Kg' ? Math.ceil(pedir * 10) / 10 : Math.ceil(pedir);
      let sit = 'ok';
      if (vel > 0 && qtd <= 0) sit = 'acabou';
      else if (dias != null && dias < ent) sit = 'falta';
      else if (it.min && qtd < it.min) sit = 'minimo';
      else if (dias != null && dias < ent + cob) sit = 'pedir';
      const ult = ultimaVenda.get(it.cod);
      const vendeuAlgumaVez = ult != null;
      if (qtd > 0 && it.custo && (vendeuAlgumaVez || (temCod && it.tipo === 'PN')) && (!vendeuAlgumaVez || fim - ult >= cfg.paradoDias)) {
        const v = qtd * it.custo; valorParado += v;
        parados.push({ cod: it.cod, produto: it.desc, tipo: TIPO_ITEM(it), qtd, it, valor: v, ultima: vendeuAlgumaVez ? TS.dayToIso(ult) : null, dias: vendeuAlgumaVez ? fim - ult : null });
      }
      // mínimo sugerido: o que vende durante a entrega + margem de segurança
      let sug = vel * ent * (1 + seg / 100);
      sug = sug <= 0 ? null : it.un === 'Kg' ? Math.ceil(sug * 10) / 10 : Math.ceil(sug);
      const minSit = sug == null ? null : !it.min ? 'sem' : it.min > sug * 2 ? 'alto' : it.min < sug * 0.7 ? 'baixo' : 'ok';
      if (vel > 0 || (it.min && qtd < it.min)) repo.push({ cod: it.cod, produto: it.desc, tipo: TIPO_ITEM(it), it, qtd, min: it.min, sug, minSit, vel, dias, pedir, custoPedido: pedir * (it.custo || 0), sit });
    }
    const diasTxt = (d) => (d == null ? '—' : `${fmt.int(d)} ${Math.round(d) === 1 ? 'dia' : 'dias'}`);
    const porque = (r) => ({
      acabou: `Estoque zerado e o produto vende ${qtdTxt(r.vel, r.it)} por dia.`,
      falta: `O estoque dura ${diasTxt(r.dias)} e a entrega leva ${ent} dias: acaba antes de o pedido chegar.`,
      minimo: `Estoque de ${qtdTxt(r.qtd, r.it)} abaixo do mínimo de ${qtdTxt(r.min, r.it)} cadastrado no AppNext.`,
      pedir: `O estoque dura ${diasTxt(r.dias)}: menos que a entrega (${ent} dias) + o período do pedido (${cob} dias). Hora de pedir.`,
      ok: `O estoque dura ${diasTxt(r.dias)}: dá para a entrega e o período do pedido.`,
    })[r.sit];
    const sugTxt = (r) => {
      const base = `Venda/dia ${qtdTxt(r.vel, r.it)} × ${ent} dias de entrega = ${qtdTxt(r.vel * ent, r.it)}, + ${seg}% de segurança = ${qtdTxt(r.sug, r.it)}.`;
      return base + ({
        sem: ' Este produto não tem mínimo no AppNext: vale cadastrar.',
        alto: ` O mínimo do AppNext (${qtdTxt(r.min, r.it)}) está bem acima: prende dinheiro em estoque.`,
        baixo: ` O mínimo do AppNext (${qtdTxt(r.min, r.it)}) está baixo: o produto pode acabar antes do pedido chegar.`,
        ok: ` O mínimo do AppNext (${qtdTxt(r.min, r.it)}) está adequado.`,
      })[r.minSit];
    };
    const contaPedido = (r) => {
      const precisa = r.vel * (ent + cob);
      const pelaVenda = `Venda/dia ${qtdTxt(r.vel, r.it)} × (${ent} dias de entrega + ${cob} dias de pedido) = ${qtdTxt(precisa, r.it)} − estoque ${qtdTxt(r.qtd, r.it)}`;
      const peloMin = r.min && r.min - r.qtd > precisa - r.qtd ? ` · o mínimo do AppNext pede mais: ${qtdTxt(r.min, r.it)} − estoque = ${qtdTxt(r.min - r.qtd, r.it)}` : '';
      return `${pelaVenda}${peloMin}. Arredondado para ${qtdTxt(r.pedir, r.it)}.`;
    };
    const SIT = { acabou: ['Acabou', 'erro', 0], falta: ['Falta antes da entrega', 'erro', 1], minimo: ['Abaixo do mínimo', 'erro', 2], pedir: ['Pedir', 'warn', 3], ok: ['OK', 'ok', 4] };
    const repor = repo.filter((r) => r.sit !== 'ok' && r.pedir > 0);
    const urgentes = repor.filter((r) => r.sit === 'acabou' || r.sit === 'falta').length;

    // ---------- KPIs ----------
    corpo.append(h('div', { class: 'grid g-kpi' },
      TS.kpi('Lucro bruto', fmt.brl0(lucro), h('span', null, `margem de ${fmt.pct(fatCusto ? lucro / fatCusto : null)}`), 'Faturamento − custo dos produtos (com embalagem nos chás a granel), só das vendas que têm custo'),
      TS.kpi('Vendas com custo', fmt.pct(fat ? fatCusto / fat : null, 0), `${fmt.brl0(fatCusto)} de ${fmt.brl0(fat)}`, 'Parte do faturamento (sem taxas) cujo custo o painel encontrou'),
      TS.kpi('Estoque a custo', fmt.brl0(valorEstoque), `${fmt.int(estoque.itens.filter((i) => i.qtd > 0).length)} produtos com saldo`),
      TS.kpi('Para repor', fmt.int(repor.length), h('span', { class: urgentes ? 'down' : '' }, `${fmt.int(urgentes)} ${urgentes === 1 ? 'urgente' : 'urgentes'} · pedido ${fmt.brl0(repor.reduce((s, r) => s + r.custoPedido, 0))}`), 'Urgente = acabou ou acaba antes de o pedido chegar'),
      TS.kpi('Estoque parado', fmt.brl0(valorParado), `${fmt.int(parados.length)} produtos sem venda há ${cfg.paradoDias}+ dias`)));

    // ---------- matriz giro × margem ----------
    const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const CLASSE = { estrela: ['Estrela', '#1F5FBF'], volume: ['Volume', '#C9A227'], joia: ['Joia', '#2C5234'], peso: ['Peso morto', '#B5452B'] };
    // chá a granel compara com chá (kg, somando 50g, 100g, 250g…); acessórios e envasados entre si (unidades)
    const MED = {};
    for (const gr of [true, false]) {
      const xs = prods.filter((p) => p.granel === gr);
      MED[gr] = { q: med(xs.map((p) => p.giro)), m: med(xs.map((p) => p.margem)) };
      for (const p of xs) p.classe = p.giro >= MED[gr].q ? (p.margem >= MED[gr].m ? 'estrela' : 'volume') : (p.margem >= MED[gr].m ? 'joia' : 'peso');
    }
    const grSel = state.estGrupo === 'un' ? false : true;
    const prodsG = prods.filter((p) => p.granel === grSel);
    // curva ABC por lucro
    const ord = [...prods].sort((a, b) => b.lucro - a.lucro);
    const lucroPos = ord.reduce((s, p) => s + Math.max(0, p.lucro), 0);
    let ac = 0;
    for (const p of ord) { ac += Math.max(0, p.lucro); p.abc = !lucroPos ? 'C' : ac / lucroPos <= 0.8 ? 'A' : ac / lucroPos <= 0.95 ? 'B' : 'C'; }

    corpo.append(TS.section('Rentabilidade'));
    const conta = Object.fromEntries(Object.keys(CLASSE).map((k) => [k, prodsG.filter((p) => p.classe === k).length]));
    const un = grSel ? 'kg' : 'un.';
    const fq = (v) => (grSel ? `${fmt.kg(v)} kg` : `${fmt.int(v)} un.`);
    const DESC = {
      estrela: 'Vende muito e tem margem boa. Não pode faltar.',
      volume: 'Vende muito, mas a margem é menor. Vale rever preço ou custo.',
      joia: 'Margem boa, mas vende pouco. Merece vitrine, degustação e indicação.',
      peso: 'Vende pouco e a margem é menor. Candidato a promoção ou a sair do mix.',
    };
    const sel = CLASSE[state.estClasse] ? state.estClasse : null;
    const mq = MED[grSel];
    const legenda = h('div', { class: 'est-classes' }, Object.entries(CLASSE).map(([k, [n, c]]) => h('button', {
      type: 'button', class: 'est-classe' + (sel === k ? ' on' : sel ? ' off' : ''), style: { '--cor': c }, 'aria-pressed': sel === k ? 'true' : 'false',
      title: sel === k ? 'Clique de novo para ver todos' : `Mostrar só ${n}`,
      onclick: () => { state.estClasse = sel === k ? null : k; TS.render(); },
    }, h('span', { class: 'est-classe-tit' }, h('i'), h('b', null, n), h('em', null, conta[k])), h('span', { class: 'est-classe-txt' }, DESC[k]))));
    const linhaMed = (pts) => ({ type: 'line', data: pts, borderColor: '#9AA59D', borderDash: [5, 4], borderWidth: 1, pointRadius: 0, pointHoverRadius: 0, fill: false, showLine: true });
    const ys = prodsG.map((p) => p.margem * 100), xs = prodsG.map((p) => Math.max(grSel ? 0.01 : 1, p.giro));
    const yMin = Math.min(...ys, mq.m * 100) - 1, yMax = Math.max(...ys, mq.m * 100) + 1, xMin = Math.min(...xs, mq.q), xMax = Math.max(...xs, mq.q);
    corpo.append(h('div', { class: 'mt' }, TS.cardWithTools('Giro × margem', grSel
      ? `Cada ponto é um chá a granel, somando todos os tamanhos (50g, 100g, 250g…). Quanto mais à direita, mais kg vendidos no período; quanto mais alto, maior a margem. As linhas tracejadas dividem os chás ao meio: metade vendeu mais de ${fq(mq.q)} e metade tem margem acima de ${fmt.pct(mq.m, 0)}. Chá é comparado só com chá.`
      : `Cada ponto é um acessório ou envasado. Quanto mais à direita, mais unidades vendidas no período; quanto mais alto, maior a margem. As linhas tracejadas dividem os produtos ao meio: metade vendeu mais de ${fq(mq.q)} e metade tem margem acima de ${fmt.pct(mq.m, 0)}.`,
      TS.seg([['Chás a granel', 'kg'], ['Acessórios e envasados', 'un']], grSel ? 'kg' : 'un', (v) => { state.estGrupo = v; TS.render(); }),
      legenda,
      sel ? h('div', { class: 'est-filtro' }, `Mostrando só ${CLASSE[sel][0]} no gráfico e na tabela abaixo. `, h('button', { type: 'button', class: 'link-btn', onclick: () => { state.estClasse = null; TS.render(); } }, 'Ver todos')) : null,
      prodsG.length ? TS.chart({
        type: 'scatter',
        data: { datasets: [
          ...Object.entries(CLASSE).filter(([k]) => !sel || k === sel).map(([k, [n, c]]) => ({ label: n, data: prodsG.filter((p) => p.classe === k).map((p) => ({ x: Math.max(grSel ? 0.01 : 1, p.giro), y: p.margem * 100, p })), backgroundColor: c + 'CC', pointRadius: 5, pointHoverRadius: 7 })),
          linhaMed([{ x: mq.q, y: yMin }, { x: mq.q, y: yMax }]), linhaMed([{ x: xMin, y: mq.m * 100 }, { x: xMax, y: mq.m * 100 }]),
        ] },
        options: { plugins: { legend: { display: false }, tooltip: { filter: (c) => !!c.raw.p, callbacks: { label: (c) => `${c.raw.p.produto}: ${fq(c.raw.p.giro)}${c.raw.p.tamanhos ? ' (' + c.raw.p.tamanhos + ')' : ''} · margem ${fmt.pct(c.raw.p.margem)} · lucro ${fmt.brl(c.raw.p.lucro)}` } } },
          scales: { x: { type: 'logarithmic', title: { display: true, text: `${grSel ? 'Kg vendidos' : 'Unidades vendidas'} no período` }, ticks: { callback: (v) => (Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9 ? (v < 1 ? String(v).replace('.', ',') : fmt.int(v)) : '') } }, y: { min: Math.floor(yMin), max: Math.ceil(yMax), title: { display: true, text: 'Margem (%)' }, ticks: { callback: (v) => v + '%' } } } },
      }, 'tall') : TS.empty())));
    corpo.append(h('div', { class: 'mt' }, TS.card('Produtos por lucro', 'Curva ABC: A = produtos que fazem 80% do lucro (nunca podem faltar). Chá a granel aparece uma vez só, somando todas as gramaturas. O grupo (Estrela, Volume…) compara chá com chá e acessório com acessório.', TS.table({
      cols: [
        { key: 'produto', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => (r.granel ? h('span', null, r.produto, h('small', { class: 'est-tam' }, r.tamanhos)) : r.produto) },
        { key: 'abc', label: 'ABC', title: 'Curva ABC pelo lucro: A = produtos que somam 80% do lucro do período; B = os próximos 15%; C = o resto', cls: (r) => (r.abc === 'A' ? 'hit' : '') },
        { key: 'classe', label: 'Grupo', align: 'l', render: (r) => h('span', { class: 'est-tag', style: { '--cor': CLASSE[r.classe][1] } }, CLASSE[r.classe][0]), sortVal: (r) => r.classe },
        { key: 'giro', label: 'Vendido', title: 'Quanto saiu no período. Chá a granel em kg, somando todos os tamanhos; os outros em unidades', render: (r) => (r.granel ? `${fmt.kg(r.giro)} kg` : `${fmt.int(r.giro)} un.`), sortVal: (r) => r.giro },
        { key: 'vt', label: 'Faturamento', title: 'Valor vendido no período (sem taxa de serviço)', fmt: fmt.brl },
        { key: 'custo', label: 'Custo', title: 'Custo do AppNext × quantidade vendida. No chá a granel: kg × custo do kg + saco kraft e etiquetas de cada pacote', fmt: fmt.brl },
        { key: 'lucro', label: 'Lucro', title: 'Faturamento − custo', fmt: fmt.brl, cls: (r) => (r.lucro < 0 ? 'miss' : '') },
        { key: 'margem', label: 'Margem', title: 'Lucro ÷ faturamento. Em vermelho quando fica abaixo de 30%', fmt: (v) => fmt.pct(v), cls: (r) => (r.margem < 0.3 ? 'miss' : '') },
      ],
      rows: sel ? prods.filter((p) => p.classe === sel) : prods, sortKey: 'lucro', maxHeight: '520px', search: 'Buscar produto…', searchKeys: ['produto'], cls: 'est-t',
      total: { produto: 'Total', vt: fatCusto, custo: custoTot, lucro, margem: fatCusto ? lucro / fatCusto : null },
    }))));

    const vends = [...porVend.values()].filter((v) => v.vt > 0).map((v) => ({ ...v, lucro: v.vt - v.custo, margem: (v.vt - v.custo) / v.vt, cobre: v.fat ? v.vt / v.fat : null }));
    corpo.append(h('div', { class: 'mt' }, TS.card('Lucro por vendedora', 'Quem vende mais nem sempre é quem deixa mais lucro.', TS.table({
      cols: [
        { key: 'vendedor', label: 'Vendedora', align: 'l', sticky: true },
        { key: 'fat', label: 'Faturamento', title: 'Tudo que a vendedora vendeu no período (sem taxa de serviço)', fmt: fmt.brl },
        { key: 'lucro', label: 'Lucro bruto', title: 'Faturamento − custo, só das vendas que têm custo', fmt: fmt.brl },
        { key: 'margem', label: 'Margem', title: 'Lucro ÷ faturamento das vendas com custo', fmt: (v) => fmt.pct(v) },
        { key: 'cobre', label: 'Com custo', fmt: (v) => fmt.pct(v, 0), title: 'Parte das vendas da vendedora cujo custo foi encontrado' },
      ],
      rows: vends, sortKey: 'lucro', maxHeight: 'free',
    }))));

    // ---------- reposição ----------
    corpo.append(TS.section('Reposição'));
    const sitSel = state.estSit || 'repor';
    const linhasRepo = sitSel === 'repor' ? repor : repo;
    const csv = h('button', { type: 'button', class: 'btn', onclick: () => baixarPedido(repor) }, '⬇ Baixar pedido (CSV)');
    corpo.append(h('div', { class: 'mt' }, TS.cardWithTools('O que repor',
      h('span', null, `Ritmo de venda dos últimos 30 dias · entrega em ${ent} dias · pedido para ${cob} dias de venda. Chás a granel em kg (inclui o consumo de saco kraft e etiquetas).`,
        h('span', { class: 'est-minres' }, ` Mínimo do AppNext comparado com o sugerido (em "Tudo que vende"): `,
          h('b', { class: 'est-sug est-sug-baixo' }, `${fmt.int(repo.filter((r) => r.minSit === 'baixo').length)} baixos`), ' · ',
          h('b', { class: 'est-sug est-sug-alto' }, `${fmt.int(repo.filter((r) => r.minSit === 'alto').length)} altos`), ' · ',
          h('b', { class: 'est-sug est-sug-sem' }, `${fmt.int(repo.filter((r) => r.minSit === 'sem').length)} sem mínimo`))),
      h('div', { class: 'est-tools' }, TS.seg([['Só o que repor', 'repor'], ['Tudo que vende', 'todos']], sitSel, (v) => { state.estSit = v; TS.render(); }), csv),
      TS.table({
        cols: [
          { key: 'produto', label: 'Produto', align: 'l', sticky: true, wrap: true },
          { key: 'tipo', label: 'Tipo', align: 'l', title: 'Chá a granel (em kg, vendido em pacotes de vários tamanhos), produto pronto ou insumo/embalagem (saco kraft, etiqueta…)' },
          { key: 'sit', label: 'Situação', align: 'l', title: 'Passe o mouse na etiqueta de cada linha para ver o motivo', render: (r) => h('span', { class: 'badge ' + SIT[r.sit][1], title: porque(r) }, SIT[r.sit][0]), sortVal: (r) => -SIT[r.sit][2] },
          { key: 'qtd', label: 'Estoque', title: 'Saldo de agora, da última planilha de estoque do AppNext', render: (r) => qtdTxt(r.qtd, r.it) },
          { key: 'min', label: 'Mínimo', title: 'Estoque mínimo cadastrado no AppNext (— = sem mínimo)', render: (r) => (r.min ? qtdTxt(r.min, r.it) : '—') },
          { key: 'sug', label: 'Mín. sugerido', title: `Mínimo calculado pela venda: venda por dia × ${ent} dias de entrega + ${seg}% de segurança. Azul = o mínimo do AppNext está bom; vermelho = muito baixo (vai faltar); amarelo = muito alto (dinheiro parado). Use para corrigir o cadastro no AppNext`,
            render: (r) => (r.sug == null ? '—' : h('span', { class: 'est-sug est-sug-' + r.minSit, title: sugTxt(r) }, qtdTxt(r.sug, r.it))), sortVal: (r) => r.sug },
          { key: 'vel', label: 'Venda/dia', title: 'Média por dia nos últimos 30 dias. No chá a granel soma todos os tamanhos; em saco kraft e etiqueta, o que os pacotes de chá consumiram', render: (r) => (r.it.un === 'Kg' ? `${fmt.kg(r.vel)} kg` : fmt.n1(r.vel)) },
          { key: 'dias', label: 'Dura', title: 'Quantos dias o estoque atual aguenta no ritmo de venda (estoque ÷ venda por dia)', fmt: (v) => (v == null ? '—' : v > 365 ? '+1 ano' : `${fmt.int(v)} ${Math.round(v) === 1 ? "dia" : "dias"}`) },
          { key: 'pedir', label: 'Pedir', title: 'Quanto pedir para chegar em tempo e durar o período escolhido. Passe o mouse no número para ver a conta', render: (r) => (r.pedir > 0 ? h('b', { title: contaPedido(r), class: 'est-dica' }, qtdTxt(r.pedir, r.it)) : '—') },
          { key: 'custoPedido', label: 'Custo', title: 'Quantidade a pedir × custo unitário do AppNext', fmt: (v) => (v ? fmt.brl(v) : '—') },
        ],
        rows: linhasRepo, sortKey: 'sit', maxHeight: '560px', search: 'Buscar…', searchKeys: ['produto', 'cod'], cls: 'est-t', empty: 'Nada para repor agora.',
      }))));

    corpo.append(h('div', { class: 'mt' }, TS.card('Estoque parado', `Produtos com saldo e sem venda há ${cfg.paradoDias} dias ou mais: dinheiro empatado. Pense em vitrine, degustação, kit ou promoção.`, TS.table({
      cols: [
        { key: 'produto', label: 'Produto', align: 'l', sticky: true, wrap: true },
        { key: 'tipo', label: 'Tipo', align: 'l' },
        { key: 'qtd', label: 'Estoque', title: 'Saldo de agora no AppNext', render: (r) => qtdTxt(r.qtd, r.it) },
        { key: 'valor', label: 'Valor a custo', title: 'Dinheiro parado: estoque × custo unitário', fmt: fmt.brl },
        { key: 'ultima', label: 'Última venda', title: 'Última vez que este produto vendeu no histórico do painel', fmt: (v) => (v ? fmt.date(v) : 'sem venda no histórico'), sortVal: (r) => r.dias ?? 1e9 },
      ],
      rows: parados, sortKey: 'valor', maxHeight: '420px', cls: 'est-t', empty: 'Nada parado. 👏',
    }))));

    // ---------- conferência ----------
    const sc = [...semCusto.values()].sort((a, b) => b.vt - a.vt);
    if (sc.length) corpo.append(h('details', { class: 'card est-sem' }, h('summary', null, `Vendas sem custo: ${fmt.brl0(sc.reduce((s, x) => s + x.vt, 0))} em ${fmt.int(sc.length)} produtos (ficam fora da margem)`),
      h('p', { class: 'muted' }, 'Corrija no AppNext o custo dos itens com "custo zero". Os "não achados" ficam certos quando as vendas trazem o código do produto (Configurações → Atualização automática → Importar histórico, "Só vendas", para refazer os meses). Itens do Espaço Gourmet preparados na loja não têm custo no estoque.'),
      TS.table({ cols: [{ key: 'produto', label: 'Produto vendido', align: 'l', wrap: true }, { key: 'cod', label: 'Código', align: 'l' }, { key: 'motivo', label: 'Motivo', align: 'l', title: '"custo zero no AppNext": o produto existe mas está sem custo lá. "não achado no estoque": o painel não encontrou o produto na planilha de estoque' }, { key: 'qtd', label: 'Unid.', fmt: fmt.int }, { key: 'vt', label: 'Faturamento', fmt: fmt.brl }], rows: sc, sortKey: 'vt', maxHeight: '360px', cls: 'est-t' })));

    corpo.append(cartaoCfg(cfg, M.porCod));
  }

  function baixarPedido(lista) {
    if (!lista.length) { alert('Nada para repor agora.'); return; }
    const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const num = (v, d) => v.toFixed(d).replace('.', ',');
    const linhas = [['Código', 'Produto', 'Unidade', 'Estoque', 'Pedir', 'Custo unitário', 'Custo do pedido', 'Situação'].join(';'),
      ...lista.map((r) => [r.cod, r.produto, r.it.un, num(r.qtd, r.it.un === 'Kg' ? 3 : 0), num(r.pedir, r.it.un === 'Kg' ? 1 : 0), num(r.it.custo || 0, 2), num(r.custoPedido, 2), r.sit].map(esc).join(';'))];
    const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `pedido-${state.loja}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function cartaoCfg(cfg, porCod) {
    const num = (v, min, max) => h('input', { class: 'f-input', type: 'number', min, max, value: v, style: { maxWidth: '110px' } });
    const ent = num(cfg.entregaDias, 0, 120), cob = num(cfg.coberturaDias, 1, 365), par = num(cfg.paradoDias, 7, 730), seg = num(cfg.segurancaPct ?? 50, 0, 300);
    const tams = ['50', '100', '250', '500', '1000'];
    const txtEmb = (l) => (l || []).map((x) => `${x.cod}×${x.qtd}`).join(', ');
    const nomeEmb = (l) => (l || []).map((x) => `${x.qtd}× ${porCod.get(String(x.cod))?.desc || '(código ' + x.cod + ' não está no estoque)'}`).join(' + ');
    const embs = tams.map((g) => { const i = h('input', { class: 'f-input', value: txtEmb(cfg.embalagens[g]), placeholder: 'código×quantidade, ...' }); return [g, i]; });
    const msg = h('span', { class: 'muted' });
    const salvar = h('button', { type: 'button', class: 'btn primary' }, 'Salvar');
    salvar.addEventListener('click', async () => {
      salvar.disabled = true; msg.textContent = 'Salvando…';
      try {
        const embalagens = Object.fromEntries(embs.map(([g, i]) => [g, i.value.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [cod, q] = s.split(/[×x*]/i); return { cod: (cod || '').trim(), qtd: +(q || 1) }; })]));
        const r = await fetch(`/api/estoque/cfg?loja=${encodeURIComponent(state.loja)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ entregaDias: +ent.value, coberturaDias: +cob.value, paradoDias: +par.value, segurancaPct: +seg.value, embalagens }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
        cache.delete(state.loja); TS.render();
      } catch (e) { msg.textContent = e.message; salvar.disabled = false; }
    });
    return h('details', { class: 'card est-cfg' }, h('summary', null, 'Ajustes: prazo de entrega, período do pedido, segurança do mínimo e embalagem dos chás'),
      h('div', { class: 'est-cfg-g' },
        h('label', null, h('span', null, 'Entrega do fornecedor'), h('div', null, ent, ' dias')),
        h('label', null, h('span', null, 'Pedir para'), h('div', null, cob, ' dias de venda')),
        h('label', null, h('span', null, 'Parado depois de'), h('div', null, par, ' dias sem venda')),
        h('label', null, h('span', null, 'Segurança do mínimo sugerido'), h('div', null, seg, ' %'))),
      h('div', { class: 'f-label', style: { marginTop: '10px' } }, 'Embalagem de cada pacote de chá a granel (entra no custo e no consumo)'),
      h('div', { class: 'est-emb' }, embs.map(([g, i]) => h('label', null, h('span', null, g === '1000' ? '1 kg' : g + ' g'), i, h('small', { class: 'muted' }, nomeEmb(cfg.embalagens[g]))))),
      h('div', { class: 'cfg-acoes' }, salvar, msg));
  }
})();
