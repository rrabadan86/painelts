/* Efeito do reajuste de preço: "depois que mudei o preço, vendi menos? o lucro subiu?"
 * Para cada mudança do preço de venda de um produto compara os 30 dias antes × os 30 dias depois:
 * quantidade, receita e lucro bruto POR DIA (receita − custo do produto na data de cada venda).
 * - De onde vem a mudança: o histórico do preço do cadastro do AppNext (o painel guarda a cada planilha de preços);
 *   antes de esse histórico existir (ou para produto fora do cadastro), a mudança do preço praticado no caixa
 *   (a mesma detecção da tela Preços: o preço mais comum da semana mudou e se manteve).
 * - Época do ano: a receita da loja inteira nos mesmos dois períodos mostra se o movimento subiu ou caiu;
 *   "descontando a loja" = variação do produto ÷ variação da loja.
 * - Menos de 10 unidades vendidas nos dois períodos somados = sem comparação (seria sorte, não efeito do preço).
 * - Menos de 30 dias depois = "cedo demais" (parcial, com aviso). Menos de 14 dias antes (ou outro reajuste logo
 *   em seguida) = sem comparação: aparece "—" e o motivo, nunca um número inventado.
 * Fica em Preços (aba "Reajustes" e o painel lateral do produto): só para quem tem a tela Preços (vê custo). */
(function () {
  'use strict';
  const JANELA = 30;      // dias antes e depois
  const MIN_BASE = 14;    // mínimo de dias de cada lado para comparar
  const MIN_PARCIAL = 7;  // mínimo de dias depois para mostrar a prévia
  const MIN_VENDAS = 10;  // unidades vendidas (antes + depois) para a comparação não ser sorte
  const FAIXA = 0.02;     // até 2% para cima ou para baixo conta como "igual"

  /**
   * ev: { dia, ant, prox } — dia do reajuste, do reajuste anterior e do próximo do mesmo produto (dias desde 1970; null = não há)
   * serie(a, b) → { q, v, l } do produto nos dias a..b (quantidade, receita, lucro; l = null se faltar custo)
   * loja(a, b) → receita da loja inteira nos dias a..b
   * inicio: primeiro dia com vendas na base; hoje: último dia com vendas
   */
  function avaliar(ev, { serie, loja, inicio, hoje }) {
    const a1 = ev.dia - 1, a0 = Math.max(ev.dia - JANELA, inicio, ev.ant != null ? ev.ant : -Infinity);
    const b0 = ev.dia, fimCheio = ev.dia + JANELA - 1;
    const cortaProx = ev.prox != null && ev.prox - 1 < Math.min(fimCheio, hoje);
    const b1 = Math.min(fimCheio, hoje, ev.prox != null ? ev.prox - 1 : Infinity);
    const dAntes = Math.max(0, a1 - a0 + 1), dDepois = Math.max(0, b1 - b0 + 1);
    const r = { a0, a1, b0, b1, dAntes, dDepois, parcial: false, estado: 'sem', motivo: '', tendencia: null, antes: null, depois: null,
      varQ: null, varV: null, varL: null, varLoja: null, adjQ: null, adjV: null, adjL: null };
    if (dAntes < MIN_BASE) { r.motivo = ev.ant != null && a0 === ev.ant ? `outro reajuste só ${dAntes} ${dAntes === 1 ? 'dia' : 'dias'} antes` : `só ${dAntes} ${dAntes === 1 ? 'dia' : 'dias'} de vendas antes do reajuste`; return r; }
    if (cortaProx && dDepois < MIN_BASE) { r.motivo = `o preço mudou de novo ${dDepois} ${dDepois === 1 ? 'dia' : 'dias'} depois`; return r; }
    const cedo = !cortaProx && dDepois < JANELA;
    if (cedo && dDepois < MIN_PARCIAL) { r.estado = 'cedo'; r.parcial = true; r.motivo = `só ${dDepois} ${dDepois === 1 ? 'dia' : 'dias'} depois do reajuste: espere pelo menos ${MIN_PARCIAL}`; return r; }
    const A = serie(a0, a1), B = serie(b0, b1);
    const porDia = (s, d) => ({ q: s.q / d, v: s.v / d, l: s.l == null ? null : s.l / d });
    r.antes = porDia(A, dAntes); r.depois = porDia(B, dDepois);
    if (!(A.q > 0)) { r.motivo = 'não vendeu nos dias antes do reajuste'; return r; }
    r.poucas = A.q + B.q < MIN_VENDAS;
    const vr = (d, a) => (a > 0 && d != null ? d / a - 1 : null);
    r.varQ = vr(r.depois.q, r.antes.q); r.varV = vr(r.depois.v, r.antes.v);
    r.varL = r.antes.l != null && r.depois.l != null ? vr(r.depois.l, r.antes.l) : null;
    const lA = loja(a0, a1) / dAntes, lB = loja(b0, b1) / dDepois;
    r.varLoja = vr(lB, lA);
    const adj = (x) => (x == null || r.varLoja == null ? null : (1 + x) / (1 + r.varLoja) - 1);
    r.adjQ = adj(r.varQ); r.adjV = adj(r.varV); r.adjL = adj(r.varL);
    if (r.poucas) { r.estado = cedo ? 'cedo' : 'sem'; r.parcial = cedo; r.motivo = `vendeu só ${Math.round(A.q + B.q)} un. nos dois períodos: pouco para comparar (mínimo ${MIN_VENDAS})`; return r; }
    if (r.antes.l == null || r.depois.l == null) { r.motivo = 'produto sem custo no estoque: não dá para calcular o lucro'; return r; }
    // o veredito olha o lucro por dia já descontado o movimento da loja; sem isso (lucro antes ≤ 0), a diferença em R$
    const base = r.adjL != null ? r.adjL : r.varL;
    const sinal = base != null ? (base > FAIXA ? 'bom' : base < -FAIXA ? 'ruim' : 'igual') : (r.depois.l > r.antes.l ? 'bom' : r.depois.l < r.antes.l ? 'ruim' : 'igual');
    if (cedo) { r.estado = 'cedo'; r.parcial = true; r.tendencia = sinal; r.motivo = `só ${dDepois} de ${JANELA} dias depois do reajuste: é uma prévia`; return r; }
    r.estado = sinal;
    r.motivo = cortaProx ? `comparou ${dDepois} dias (o preço mudou de novo depois)` : '';
    return r;
  }

  /** reajustes de um produto, em ordem: os do cadastro + os do caixa de antes de o cadastro ter histórico (ou todos, sem cadastro)
   *  cadastro: [[dia, preço], …] ou null (produto fora do cadastro); caixa: [{ dia, de, v }] ; limite: dia a partir do qual vale o cadastro */
  function reajustesDe(cadastro, caixa, limite) {
    const out = [];
    if (cadastro) for (let k = 1; k < cadastro.length; k++) out.push({ dia: cadastro[k][0], de: cadastro[k - 1][1], para: cadastro[k][1], fonte: 'cadastro' });
    for (const e of caixa || []) {
      if (e.dia == null || e.de == null) continue;
      if (cadastro && !(e.dia < limite)) continue;
      out.push({ dia: e.dia, de: e.de, para: e.v, fonte: 'caixa' });
    }
    out.sort((a, b) => a.dia - b.dia);
    return out.filter((e) => e.de > 0 && Math.abs(e.para - e.de) >= 0.01)
      .map((e, k, l) => ({ ...e, ant: k ? l[k - 1].dia : null, prox: k < l.length - 1 ? l[k + 1].dia : null, variacao: e.para / e.de - 1 }));
  }

  const API = { avaliar, reajustesDe, JANELA, MIN_BASE, MIN_PARCIAL, MIN_VENDAS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }

  // ---------------------------------------------------------------- tela ----------------------------------------------------------------
  const { h, fmt, state } = TS;
  const quando = (d) => { const iso = TS.dayToIso(d); return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`; };
  const pctTxt = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmt.n1(v * 100)}%`);
  const ESTADO = {
    bom: ['Bom', 'ok', 'O lucro por dia subiu depois do reajuste, já descontado o movimento da loja.'],
    ruim: ['Ruim', 'erro', 'O lucro por dia caiu depois do reajuste, já descontado o movimento da loja.'],
    igual: ['Igual', 'cinza', 'O lucro por dia ficou praticamente igual (menos de 2% de diferença).'],
    cedo: ['Cedo demais', 'warn', 'Ainda não passaram 30 dias desde o reajuste.'],
    sem: ['Sem comparação', 'cinza', 'Não dá para comparar com honestidade.'],
  };

  /** todos os reajustes de venda dos últimos 12 meses, avaliados (D = dados da tela Preços; M = motor de custos) */
  function calcular(D, M) {
    const db = TS.db, hoje = Math.min(db.maxDay, TS.todayDay()), inicio = db.minDay, desde = hoje - 365;
    const limGeral = D.tabHistDesde ? TS.isoToDay(D.tabHistDesde) : -Infinity; // sem histórico do cadastro: só o caixa conta
    const comEv = new Map(); // nome do produto → { p, evs }
    for (const p of D.lista) {
      const noCad = !!(D.tabela && D.tabela.has(p.cod) && D.tabHistDesde);
      const hist = noCad ? ((D.tabHist && D.tabHist[p.cod]) || []).map(([d, v]) => [TS.isoToDay(d), v]) : null;
      const evs = reajustesDe(hist, p.vendaEv.filter((e) => !e.inicio), hist && hist.length ? hist[0][0] : limGeral);
      p.efeitos = [];
      if (evs.some((e) => e.dia >= desde && e.dia <= hoje)) comEv.set(p.nome, { p, evs, dias: new Map() });
    }
    // vendas por dia dos produtos com reajuste e da loja inteira (sem taxas e sem itens a R$ 0,01), numa passada
    const lojaDia = new Map();
    for (let i = 0; i < db.n; i++) {
      if (M.taxa(i)) continue;
      const d = db.day[i], vt = db.vt[i] || 0;
      lojaDia.set(d, (lojaDia.get(d) || 0) + vt);
      if (!(db.qtd[i] > 0) || !(db.vu[i] > 0)) continue;
      const x = comEv.get(db.D.descricao[db.desc[i]]);
      if (!x) continue;
      const s = x.dias.get(d) || x.dias.set(d, [0, 0]).get(d);
      s[0] += db.qtd[i]; s[1] += vt;
    }
    const loja = (a, b) => { let t = 0; for (let d = a; d <= b; d++) t += lojaDia.get(d) || 0; return t; };
    const lista = [];
    for (const { p, evs, dias } of comEv.values()) {
      const serie = (a, b) => {
        let q = 0, v = 0, l = 0, semCusto = false;
        for (let d = a; d <= b; d++) {
          const s = dias.get(d);
          if (!s) continue;
          q += s[0]; v += s[1];
          const c = p.custoNoDia(d).v; // custo de 1 unidade vendida naquele dia
          if (c == null) semCusto = true; else l += s[1] - s[0] * c;
        }
        return { q, v, l: semCusto ? null : l };
      };
      for (const e of evs) {
        if (e.dia < desde || e.dia > hoje) continue;
        const r = { nome: p.nome, cat: p.cat, cod: p.cod, kg: p.kg, ...e, ...avaliar(e, { serie, loja, inicio, hoje }) };
        p.efeitos.push(r); lista.push(r);
      }
      p.efeitos.sort((a, b) => b.dia - a.dia);
    }
    const n = (k) => lista.filter((r) => r.estado === k).length;
    return { lista, bons: n('bom'), ruins: n('ruim'), iguais: n('igual'), cedo: n('cedo'), sem: n('sem') };
  }

  const antesDepois = (a, d, v, f, bomSeSobe) => {
    if (a == null || d == null) return h('span', { class: 'muted' }, '—');
    return h('div', { class: 'prc-v' }, h('s', { class: 'muted' }, f(a)), h('b', null, f(d)),
      v != null ? h('span', { class: 'prc-badge ' + (Math.abs(v) < 0.0005 || bomSeSobe == null ? 'prc-neutro' : (v > 0) === bomSeSobe ? 'prc-bom' : 'prc-ruim') }, pctTxt(v)) : null);
  };
  const etiqueta = (r) => { const [t, c] = ESTADO[r.estado]; return h('span', { class: 'badge ' + c }, t); };
  const porque = (r) => {
    if (r.estado === 'cedo' && r.tendencia) return `${r.motivo} · por enquanto: ${ESTADO[r.tendencia][0].toLowerCase()}`;
    if (r.motivo) return r.motivo;
    if (r.estado === 'ruim' && r.varL > 0) return 'o lucro subiu, mas menos que o movimento da loja';
    if (r.estado === 'bom' && r.varL < 0) return 'o lucro caiu, mas menos que o movimento da loja';
    return r.estado === 'bom' ? 'o lucro por dia subiu' : r.estado === 'ruim' ? 'o lucro por dia caiu' : 'o lucro por dia quase não mudou';
  };
  const n2 = (v) => fmt.n2(v);

  /** quadro do topo da tela Preços: quantos reajustes já dá para julgar (clicável: abre a aba) */
  function kpi(E, abrir) {
    const julgados = E.bons + E.ruins + E.iguais;
    const k = TS.kpi('Reajustes de venda avaliados', fmt.int(julgados),
      E.lista.length ? h('span', null, h('b', { class: 'pos' }, `${fmt.int(E.bons)} ${E.bons === 1 ? 'bom' : 'bons'}`), ' · ', h('b', { class: E.ruins ? 'neg' : null }, `${fmt.int(E.ruins)} ${E.ruins === 1 ? 'ruim' : 'ruins'}`), E.cedo ? ` · ${fmt.int(E.cedo)} cedo demais` : '') : 'nenhum reajuste de venda em 12 meses',
      'Depois que o preço mudou, vendeu menos? O lucro subiu? Para cada reajuste de venda dos últimos 12 meses o painel compara os 30 dias antes com os 30 dias depois (quantidade, receita e lucro por dia) e desconta o movimento da loja no mesmo período. Clique para ver a lista. Não segue o período da lateral.');
    k.classList.add('est-kpi-click'); k.setAttribute('role', 'button'); k.tabIndex = 0;
    k.addEventListener('click', (ev) => { if (!ev.target.closest('.dica-i')) abrir(); });
    k.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') abrir(); });
    return k;
  }

  /** aba "Reajustes (N)" da tela Preços. segTela: as abas da tela; abrirProduto(nome): painel lateral; repintar() */
  function cartao(E, segTela, abrirProduto, repintar) {
    const FIL = {
      aval: ['Avaliados', (r) => r.estado === 'bom' || r.estado === 'ruim' || r.estado === 'igual'], bom: ['Bons', (r) => r.estado === 'bom'], ruim: ['Ruins', (r) => r.estado === 'ruim'], igual: ['Iguais', (r) => r.estado === 'igual'],
      cedo: ['Cedo demais', (r) => r.estado === 'cedo'], sem: ['Sem comparação', (r) => r.estado === 'sem'], todos: ['Todos', () => true],
    };
    const fil = FIL[state.efeitoFil] ? state.efeitoFil : E.lista.some(FIL.aval[1]) ? 'aval' : 'todos'; // começa pelos que já dá para julgar
    const tab = TS.table({
      cols: [
        { key: 'nome', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => h('span', null,
          h('a', { href: '#', class: 'prc-nome', onclick: (e) => { e.preventDefault(); abrirProduto(r.nome); } }, h('b', null, r.nome)), ' ', etiqueta(r),
          h('small', { class: 'muted efp-det' }, porque(r))) },
        { key: 'dia', label: 'Reajuste', title: 'Quando o preço de venda mudou e de quanto para quanto. "cadastro" = mudou o preço cadastrado no AppNext (histórico que o painel guarda a cada planilha de preços). "caixa" = o preço mais vendido nos cupons mudou e se manteve (usado antes de o painel ter o histórico do cadastro, ou para produto fora dele).',
          render: (r) => h('div', { class: 'prc-v' }, h('s', { class: 'muted' }, fmt.brl(r.de)), h('b', null, fmt.brl(r.para)), h('span', { class: 'prc-badge prc-neutro' }, pctTxt(r.variacao)),
            h('small', { class: 'muted' }, `${quando(r.dia)} · ${r.fonte}`)) },
        { key: 'varQ', label: 'Vendeu por dia', title: 'Unidades vendidas por dia: 30 dias antes (riscado) → 30 dias depois do reajuste, e a variação. Por dia, para comparar períodos de tamanhos diferentes. Resgates da fidelidade (R$ 0,01) ficam fora.',
          render: (r) => (r.antes ? antesDepois(r.antes.q, r.depois.q, r.varQ, n2, true) : '—'), sortVal: (r) => r.varQ ?? -99 },
        { key: 'varV', label: 'Receita por dia', title: 'Valor vendido do produto por dia (já com os descontos dados): antes → depois do reajuste.',
          render: (r) => (r.antes ? antesDepois(r.antes.v, r.depois.v, r.varV, fmt.brl, true) : '—'), sortVal: (r) => r.varV ?? -99 },
        { key: 'varL', label: 'Lucro por dia', title: 'Lucro bruto por dia = receita − custo do produto na data de cada venda (chá: kg × tamanho + embalagem). Sem impostos, comissão nem royalties. "—" = produto sem custo no estoque.',
          render: (r) => (r.antes && r.antes.l != null && r.depois.l != null ? antesDepois(r.antes.l, r.depois.l, r.varL, fmt.brl, true) : '—'), sortVal: (r) => r.varL ?? -99 },
        { key: 'varLoja', label: 'Loja no período', title: 'Quanto a receita da loja inteira (por dia) subiu ou caiu entre os mesmos dois períodos. Serve para separar o efeito do preço do efeito da época: se a loja toda caiu 10%, o produto cair 10% não é culpa do preço.',
          render: (r) => (r.varLoja == null ? '—' : h('span', { class: 'muted' }, pctTxt(r.varLoja))), sortVal: (r) => r.varLoja ?? -99 },
        { key: 'adjL', label: 'Lucro descontando a loja', title: 'Variação do lucro por dia do produto ÷ variação da receita da loja no mesmo período. É este número que decide Bom (acima de +2%), Ruim (abaixo de −2%) ou Igual. Embaixo, a quantidade na mesma conta. É uma comparação simples: promoção, falta de estoque ou campanha no período também mexem no resultado.',
          render: (r) => (r.adjL == null ? '—' : h('div', null, h('b', { class: r.adjL > FAIXA ? 'pos' : r.adjL < -FAIXA ? 'neg' : null }, pctTxt(r.adjL)), r.adjQ != null ? h('small', { class: 'muted efp-det' }, `quantidade ${pctTxt(r.adjQ)}`) : null)), sortVal: (r) => r.adjL ?? -99 },
      ],
      rows: E.lista.filter(FIL[fil][1]), sortKey: 'dia', sortDir: 'desc', maxHeight: '640px', search: 'Buscar produto…', searchKeys: ['nome', 'cat'], produto: 'nome', cls: 'est-t prc-t efp-t',
      empty: E.lista.length ? 'Nenhum reajuste neste filtro.' : 'Nenhum reajuste de preço de venda nos últimos 12 meses.',
    });
    const cont = (k) => E.lista.filter(FIL[k][1]).length;
    return TS.cardWithTools('Efeito dos reajustes de venda',
      'Depois que o preço mudou, vendeu menos? O lucro subiu? Cada linha é um reajuste dos últimos 12 meses (não segue o período da lateral): 30 dias antes × 30 dias depois, por dia, e o mesmo descontando o movimento da loja. Com menos de 30 dias depois é só uma prévia ("cedo demais").',
      h('div', { class: 'est-tools' }, tab.searchBox && (tab.searchBox.classList.add('est-busca'), tab.searchBox), segTela),
      h('div', { class: 'efp-fil' }, TS.seg(Object.entries(FIL).filter(([k]) => k === 'todos' || k === fil || cont(k)).map(([k, [t]]) => [`${t} (${cont(k)})`, k]), fil, (v) => { state.efeitoFil = v; repintar(); })),
      tab);
  }

  /** painel lateral do produto (Preços): o efeito de cada reajuste de venda dele */
  function detalhe(r) {
    const l = r.efeitos || [];
    if (!l.length) return null;
    return h('div', { class: 'efp-detalhe' },
      h('div', { class: 'f-label mt' }, 'Efeito dos reajustes de venda', TS.dica('30 dias antes × 30 dias depois de cada mudança do preço de venda, por dia. "Descontando a loja" tira o efeito da época: divide a variação do produto pela variação da receita da loja inteira no mesmo período.')),
      h('ul', { class: 'prc-tl' }, l.map((x) => h('li', { class: 'prc-tl-i' },
        h('div', { class: 'prc-tl-d' }, quando(x.dia), etiqueta(x)),
        h('div', { class: 'prc-tl-l' }, h('b', null, 'Venda '), `${fmt.brl(x.de)} → ${fmt.brl(x.para)} `, h('span', { class: 'prc-badge prc-neutro' }, pctTxt(x.variacao)), ` · pelo ${x.fonte}`),
        x.antes ? h('div', { class: 'prc-tl-l' }, `Vendeu por dia: ${n2(x.antes.q)} → ${n2(x.depois.q)} (${pctTxt(x.varQ)}) · receita por dia: ${fmt.brl(x.antes.v)} → ${fmt.brl(x.depois.v)} (${pctTxt(x.varV)})`) : null,
        x.antes && x.antes.l != null && x.depois.l != null ? h('div', { class: 'prc-tl-l' }, `Lucro por dia: ${fmt.brl(x.antes.l)} → ${fmt.brl(x.depois.l)} (${pctTxt(x.varL)})`) : null,
        x.varLoja != null ? h('div', { class: 'prc-tl-m muted' }, `Loja no período: ${pctTxt(x.varLoja)} · descontando a loja: quantidade ${pctTxt(x.adjQ)}, lucro ${pctTxt(x.adjL)}`) : null,
        h('div', { class: 'prc-tl-o muted' }, `${porque(x)} · comparou ${x.dAntes} ${x.dAntes === 1 ? 'dia' : 'dias'} antes × ${x.dDepois} depois`)))));
  }

  TS.efeitoPreco = { ...API, calcular, kpi, cartao, detalhe };
})();
