/* Compras × vendas do mês: "estou comprando mais do que vendo?"
 * - Compras: notas de entrada do AppNext que o coletor guarda (só compra concluída, sem devolução/troca): soma de
 *   custo × quantidade de cada item, pelo dia de entrada da nota.
 * - Vendas: faturamento da loja no mês (com Espaço Gourmet, sem taxas e sem itens a R$ 0,01), como no Resultado.
 * - Teto: % das vendas que a loja aceita gastar em compras (Configurações → Lojas → Estoque e margem; padrão 32%).
 *   No mês em andamento o teto usa a projeção das vendas no ritmo atual (vendas ÷ dias que passaram × dias do mês).
 * Aparece no Pedido (quadros antes da lista, com o valor do pedido somado) e no Resultado (mês a mês).
 * Só para quem vê custo: os dados vêm de /api/estoque, que o servidor só entrega a quem tem tela de custo. */
(function () {
  'use strict';
  const TETO_PADRAO = 32;
  const diasDoMes = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  const ymMais = (ym, n) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);

  /** notas de compra por mês: itens = { cod: [[AAAA-MM-DD, custo unitário, nº da NF, quantidade, fornecedor], …] }
   *  → { 'AAAA-MM': { valor, notas } } */
  function comprasPorMes(itens) {
    const out = {};
    for (const lista of Object.values(itens || {})) {
      for (const [dia, custo, nf, qtd] of lista || []) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia)) || !(custo > 0) || !(qtd > 0)) continue;
        const m = out[dia.slice(0, 7)] || (out[dia.slice(0, 7)] = { valor: 0, nfs: new Set() });
        m.valor += custo * qtd;
        m.nfs.add(String(nf));
      }
    }
    for (const m of Object.values(out)) { m.valor = Math.round(m.valor * 100) / 100; m.notas = m.nfs.size; delete m.nfs; }
    return out;
  }

  /**
   * vendas: { 'AAAA-MM': { fat, fatCusto, custo, ultimo: 'AAAA-MM-DD' } } (fatCusto = vendas que têm custo no estoque)
   * compras: resultado de comprasPorMes, ou null se o painel não tem as notas
   * desde: data em que as notas começam (antes disso as compras são desconhecidas: "—")
   * hoje: 'AAAA-MM-DD'; tetoPct: % das vendas; pedido: valor do pedido que está na tela (soma às compras do mês)
   */
  function resumo({ vendas = {}, compras = null, desde = null, hoje, tetoPct = TETO_PADRAO, meses = 12, pedido = 0 }) {
    const pct = (tetoPct > 0 ? tetoPct : TETO_PADRAO) / 100;
    const ymHoje = String(hoje).slice(0, 7);
    const yC = Object.keys(compras || {}).sort(), yV = Object.keys(vendas).filter((k) => vendas[k] && vendas[k].fat > 0).sort();
    // as notas começam em "desde"; sem essa data, na primeira compra que existe
    const dDesde = /^\d{4}-\d{2}-\d{2}/.test(String(desde || '')) ? String(desde).slice(0, 10) : null;
    const inicioCompras = !compras ? null : dDesde ? dDesde.slice(0, 7) : yC[0] || null;
    const primeiro = [yC[0], yV[0]].filter(Boolean).sort()[0];
    const lista = [];
    if (primeiro) {
      let ym = ymMais(ymHoje, -(Math.max(1, meses) - 1));
      if (ym < primeiro) ym = primeiro;
      for (; ym <= ymHoje; ym = ymMais(ym, 1)) {
        const v = vendas[ym] || {}, fat = v.fat || 0, parcial = ym === ymHoje, dm = diasDoMes(ym);
        const sabe = inicioCompras != null && ym >= inicioCompras;
        const c = sabe ? ((compras[ym] && compras[ym].valor) || 0) : null;
        const cmvPct = v.fatCusto > 0 ? v.custo / v.fatCusto : null;
        const cmv = cmvPct == null ? null : v.custo + (fat - v.fatCusto) * cmvPct; // vendas sem custo entram pelo mesmo %
        const decorridos = parcial && v.ultimo && v.ultimo.slice(0, 7) === ym ? Math.min(dm, Math.max(1, +v.ultimo.slice(8, 10))) : null;
        const projecao = parcial ? (decorridos && fat > 0 ? (fat * dm) / decorridos : null) : null;
        const base = parcial ? projecao : fat; // o teto do mês em andamento usa a projeção
        const teto = base > 0 ? base * pct : null;
        lista.push({
          ym, parcial, diasMes: dm, decorridos, vendas: fat, projecao, base: base > 0 ? base : null,
          compras: c, notas: sabe ? ((compras[ym] && compras[ym].notas) || 0) : null,
          comprasParcial: sabe && ym === inicioCompras && !!dDesde && dDesde.slice(8, 10) !== '01',
          pct: c != null && base > 0 ? c / base : null, teto, folga: teto != null && c != null ? teto - c : null,
          acima: teto != null && c != null ? c > teto + 0.005 : null,
          cmv, cmvPct, saldo: c != null && cmv != null ? c - cmv : null,
        });
      }
    }
    const m = lista.find((x) => x.ym === ymHoje) || null;
    const ped = pedido > 0 ? pedido : 0;
    let mes = null;
    if (m) {
      const soma = m.compras == null ? null : m.compras + ped;
      const cabe = m.teto != null && soma != null ? m.teto - soma : null;
      mes = { ...m, pedido: ped, soma, cabe, pctSoma: soma != null && m.base ? soma / m.base : null, ritmoCurto: m.decorridos != null && m.decorridos < 5,
        estado: cabe == null ? 'sem' : cabe < -0.005 ? 'acima' : soma > m.teto * 0.9 ? 'perto' : 'ok' };
    }
    // meses fechados com compras conhecidas: o retrato do período
    const fechados = lista.filter((x) => !x.parcial && x.compras != null && x.vendas > 0);
    const s = (k) => fechados.reduce((a, x) => a + (x[k] || 0), 0);
    const comCmv = fechados.filter((x) => x.cmv != null);
    const total = { meses: fechados.length, vendas: s('vendas'), compras: s('compras'), pct: s('vendas') > 0 ? s('compras') / s('vendas') : null,
      cmvPct: comCmv.length ? comCmv.reduce((a, x) => a + x.cmv, 0) / comCmv.reduce((a, x) => a + x.vendas, 0) : null,
      acima: fechados.filter((x) => x.acima).length };
    return { tetoPct: pct * 100, meses: lista, mes, total, inicioCompras, desde: dDesde, temCompras: !!compras };
  }

  const API = { comprasPorMes, resumo, TETO_PADRAO };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }

  // ---------------------------------------------------------------- tela ----------------------------------------------------------------
  const { h, fmt, state } = TS;

  /** vendas de cada mês da loja (todos os dias, sem os filtros da lateral), com as mesmas regras do Resultado */
  const memo = new WeakMap();
  function vendasPorMes(M) {
    const db = TS.db;
    const hit = memo.get(db);
    if (hit && hit.M === M) return hit.out;
    const out = {};
    for (let i = 0; i < db.n; i++) {
      if (M.taxa(i)) continue; // taxa de serviço, entrega e itens a R$ 0,01 (resgates da fidelidade)
      const ym = db.ym[i];
      const m = out[ym] || (out[ym] = { fat: 0, fatCusto: 0, custo: 0, ultimo: '' });
      const vt = db.vt[i] || 0;
      m.fat += vt;
      if (db.iso[i] > m.ultimo) m.ultimo = db.iso[i];
      const c = M.custo(i);
      if (c != null) { m.fatCusto += vt; m.custo += c; }
    }
    memo.set(db, { M, out });
    return out;
  }

  /** junta o que o painel já tem (vendas, custos e notas de compra) → resumo */
  function montar(M, e, pedido) {
    const c = e && e.compras;
    return resumo({ vendas: vendasPorMes(M), compras: c ? comprasPorMes(c.itens) : null, desde: c ? c.desde : null, hoje: TS.hojeSP(),
      tetoPct: e && e.cfg ? e.cfg.comprasTetoPct : TETO_PADRAO, pedido });
  }

  const ONDE = 'Mude o teto em Configurações → Lojas → Estoque e margem → Reposição.';
  const comoTeto = (R) => {
    const m = R.mes;
    if (!m) return '';
    return m.projecao != null
      ? `Teto = ${fmt.n1(R.tetoPct)}% das vendas previstas para o mês. Previsão no ritmo atual: ${fmt.brl0(m.vendas)} vendidos em ${m.decorridos} ${m.decorridos === 1 ? 'dia' : 'dias'} ÷ ${m.decorridos} × ${m.diasMes} dias = ${fmt.brl0(m.projecao)}.${m.ritmoCurto ? ' Com poucos dias de venda, a previsão ainda balança muito.' : ''} ${ONDE}`
      : `Teto = ${fmt.n1(R.tetoPct)}% das vendas previstas para o mês. Ainda não há vendas neste mês para prever. ${ONDE}`;
  };
  const semNotas = () => h('div', { class: 'notice' }, 'Compras × vendas: o painel ainda não tem as notas de compra desta loja (o robô traz do AppNext, em Entrada de Produtos).');

  /** os quadros do mês em andamento; comPedido: mostra o quadro "Este pedido" (tela Pedido) */
  function quadrosMes(R, comPedido) {
    const m = R.mes, rot = m ? TS.ymLabel(m.ym) : '';
    if (!m) return [];
    const kComprado = TS.kpi(`Comprado em ${rot}`, m.compras == null ? '—' : fmt.brl0(m.compras),
      m.compras == null ? 'sem notas de compra deste mês' : `${fmt.int(m.notas)} ${m.notas === 1 ? 'nota' : 'notas'}${m.pct != null ? ` · ${fmt.pct(m.pct)} das vendas previstas` : ''}`,
      'Soma das notas de compra do mês que já entraram no AppNext (custo × quantidade de cada item; só compra concluída, sem devolução nem troca). Nota que ainda não deu entrada não conta.');
    const kPedido = comPedido ? TS.kpi('Este pedido', fmt.brl0(m.pedido), m.soma == null ? 'soma às compras do mês' : h('span', null, 'com ele, o mês vai a ', h('b', null, fmt.brl0(m.soma))),
      'O valor do pedido que está na tela agora (carrinho + pedido obrigatório). Ele só vira compra quando a nota chegar: se a entrega cair no mês que vem, a nota entra no outro mês.') : null;
    const kTeto = TS.kpi('Teto de compras do mês', m.teto == null ? '—' : fmt.brl0(m.teto),
      m.teto == null ? 'sem vendas no mês para prever' : `${fmt.n1(R.tetoPct)}% de ${fmt.brl0(m.projecao)} previstos${m.ritmoCurto ? ' · poucos dias, ainda instável' : ''}`, comoTeto(R));
    const vCabe = m.cabe == null ? '—' : h('span', { class: m.estado === 'acima' ? 'neg' : m.estado === 'perto' ? 'warn-t' : 'pos' }, fmt.brl0(Math.abs(m.cabe)));
    const kCabe = TS.kpi(m.estado === 'acima' ? 'Passou do teto' : 'Ainda cabe comprar', vCabe,
      m.cabe == null ? (m.compras == null ? 'faltam as notas de compra' : 'falta a previsão de vendas')
        : m.estado === 'acima' ? `compras${comPedido ? ' + pedido' : ''} = ${fmt.pct(m.pctSoma)} das vendas previstas`
          : `${comPedido ? 'depois deste pedido' : 'até o fim do mês'} · usado ${fmt.pct(m.soma / m.teto, 0)} do teto`,
      `Teto − o que já foi comprado no mês${comPedido ? ' − este pedido' : ''}. Verde: cabe com folga; amarelo: passou de 90% do teto; vermelho: passou do teto (a loja está comprando mais do que o combinado para o que vende).`);
    return [kComprado, kPedido, kTeto, kCabe].filter(Boolean);
  }

  /** Pedido: "já comprado no mês × teto", com o valor do pedido da tela somado. el.atualizar(valor) refaz quando o pedido muda */
  function quadroPedido(M, e, pedido) {
    const el = h('div', { class: 'cv-pedido mt' });
    el.atualizar = (valor) => {
      if (!e || !e.compras) { el.replaceChildren(semNotas()); return; }
      const R = montar(M, e, valor);
      const m = R.mes;
      el.replaceChildren(...[
        h('div', { class: 'section-label' }, `Compras do mês × teto${m ? ` · ${TS.ymLabel(m.ym)}` : ''} `, h('a', { href: '#dre', class: 'cv-link' }, 'ver mês a mês no Resultado')),
        m && m.estado === 'acima' ? h('div', { class: 'notice warn' }, `Com este pedido, as compras de ${TS.ymLabel(m.ym)} passam o teto em ${fmt.brl0(-m.cabe)} (${fmt.pct(m.pctSoma)} das vendas previstas; o teto é ${fmt.n1(R.tetoPct)}%). Veja se dá para tirar o que tem estoque sobrando.`) : null,
        h('div', { class: 'grid g-kpi' }, quadrosMes(R, true)),
      ].filter(Boolean));
    };
    el.atualizar(pedido);
    return el;
  }

  /** Resultado: quadros do mês, gráfico e tabela mês a mês (compras × vendas × custo do que vendeu) */
  function cartaoResultado(M) {
    const el = h('div', { class: 'cv-resultado mt' });
    const loja = state.loja;
    TS.estoqueBuscar(loja).then((e) => {
      if (!el.isConnected) return;
      if (!e || !e.compras) { el.replaceChildren(semNotas()); return; }
      pintarResultado(el, montar(M, e, 0));
    }).catch(() => el.remove());
    return el;
  }

  function pintarResultado(el, R) {
    const fil = state.cvFil || 'todos';
    const comCompras = R.meses.filter((x) => x.compras != null);
    const FIL = { todos: ['Todos os meses', () => true], acima: ['Acima do teto', (x) => x.acima === true], dentro: ['Dentro do teto', (x) => x.acima === false] };
    const cont = (k) => R.meses.filter(FIL[k][1]).length;
    const ir = (k) => { state.cvFil = k; pintarResultado(el, R); };
    const T = R.total;
    const kPer = TS.kpi(`Compras ÷ vendas · ${T.meses} ${T.meses === 1 ? 'mês fechado' : 'meses fechados'}`, T.pct == null ? '—' : h('span', { class: T.pct > R.tetoPct / 100 ? 'neg' : 'pos' }, fmt.pct(T.pct)),
      T.pct == null ? 'ainda sem mês fechado com notas' : `teto ${fmt.n1(R.tetoPct)}%${T.cmvPct != null ? ` · custo do que vendeu ${fmt.pct(T.cmvPct)}` : ''}`,
      'Tudo o que a loja comprou ÷ tudo o que vendeu nos meses fechados da tabela (só os meses em que o painel tem as notas de compra). Se ficar acima do custo do que vendeu, o estoque está crescendo.');
    const kAcima = TS.kpi('Meses acima do teto', fmt.int(cont('acima')), cont('acima') ? 'clique para ver quais' : 'nenhum no período',
      `Meses em que as compras passaram de ${fmt.n1(R.tetoPct)}% das vendas. Um mês acima não é problema se o seguinte compensar (ex.: compra grande antes do Natal).`);
    kAcima.classList.add('est-kpi-click'); kAcima.setAttribute('role', 'button'); kAcima.tabIndex = 0;
    kAcima.addEventListener('click', (ev) => { if (!ev.target.closest('.dica-i')) ir(fil === 'acima' ? 'todos' : 'acima'); });
    kAcima.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ir(fil === 'acima' ? 'todos' : 'acima'); });

    const cor = TS.cores || [];
    const graf = comCompras.length ? TS.chart({
      type: 'bar',
      data: { labels: R.meses.map((x) => TS.ymLabel(x.ym) + (x.parcial ? '*' : '')),
        datasets: [
          { type: 'bar', label: 'Compras', data: R.meses.map((x) => x.compras), backgroundColor: cor[0], borderRadius: 4, order: 2 },
          { type: 'bar', label: 'Custo do que vendeu', data: R.meses.map((x) => x.cmv), backgroundColor: cor[2], borderRadius: 4, order: 3 },
          { type: 'line', label: `Teto (${fmt.n1(R.tetoPct)}% das vendas)`, data: R.meses.map((x) => x.teto), borderColor: cor[1], backgroundColor: cor[1], tension: 0.3, pointRadius: 3, order: 1 },
        ] },
      options: { plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? '—' : fmt.brl0(c.raw)}` } } }, scales: { y: TS.axisNum(fmt.brl0), x: TS.axisCat } },
    }) : null;

    const tab = TS.table({
      cols: [
        { key: 'ym', label: 'Mês', align: 'l', sticky: true, wrap: true, render: (x) => h('span', null, h('b', null, TS.ymLabel(x.ym)), ' ',
          x.acima === true ? h('span', { class: 'badge erro' }, 'acima do teto') : x.acima === false ? h('span', { class: 'badge ok' }, 'dentro do teto') : h('span', { class: 'badge cinza' }, 'sem notas'),
          x.parcial ? h('small', { class: 'muted cv-det' }, `em andamento · ${x.decorridos || 0} de ${x.diasMes} dias`) : x.comprasParcial ? h('small', { class: 'muted cv-det' }, `notas só a partir de ${fmt.date(R.desde)}`) : null) },
        { key: 'vendas', label: 'Vendas', title: 'Faturamento da loja no mês (com Espaço Gourmet, sem taxa de serviço, entrega e itens a R$ 0,01), igual ao Resultado. No mês em andamento: o vendido até agora e, embaixo, a previsão no ritmo atual.',
          render: (x) => h('div', null, fmt.brl0(x.vendas), x.parcial && x.projecao != null ? h('small', { class: 'muted cv-det' }, `previsão ${fmt.brl0(x.projecao)}`) : null) },
        { key: 'compras', label: 'Compras', title: 'Notas de compra que deram entrada no mês (custo × quantidade de cada item; só compra concluída, sem devolução nem troca). "—" = o painel não tem as notas daquele mês.',
          render: (x) => (x.compras == null ? '—' : h('div', null, fmt.brl0(x.compras), h('small', { class: 'muted cv-det' }, `${fmt.int(x.notas)} ${x.notas === 1 ? 'nota' : 'notas'}`))), sortVal: (x) => x.compras ?? -1 },
        { key: 'pct', label: 'Compras ÷ vendas', title: `Quanto das vendas virou compra. Vermelho = passou do teto de ${fmt.n1(R.tetoPct)}%. No mês em andamento a conta usa a previsão de vendas do mês.`,
          render: (x) => (x.pct == null ? '—' : h('b', { class: x.acima ? 'neg' : 'pos' }, fmt.pct(x.pct))), sortVal: (x) => x.pct ?? -1 },
        { key: 'folga', label: 'Folga no teto', title: `Teto (${fmt.n1(R.tetoPct)}% das vendas) − compras. Positivo: ainda cabia comprar; negativo: comprou além do teto.`,
          render: (x) => (x.folga == null ? '—' : h('div', null, h('span', { class: x.folga < 0 ? 'neg' : null }, fmt.brl0(x.folga)), h('small', { class: 'muted cv-det' }, `teto ${fmt.brl0(x.teto)}`))), sortVal: (x) => x.folga ?? -1e12 },
        { key: 'cmv', label: 'Custo do que vendeu', title: 'CMV: custo dos produtos vendidos no mês, pelo custo de hoje do estoque (o mesmo do Resultado; vendas sem custo entram pelo mesmo % das outras). É o que a loja precisaria comprar só para repor o que saiu.',
          render: (x) => (x.cmv == null ? '—' : h('div', null, fmt.brl0(x.cmv), h('small', { class: 'muted cv-det' }, `${fmt.pct(x.cmvPct)} das vendas`))), sortVal: (x) => x.cmv ?? -1 },
        { key: 'saldo', label: 'Compras − custo', title: 'Positivo: comprou mais do que saiu (o estoque cresceu, dinheiro parado). Negativo: vendeu estoque que já tinha. No mês em andamento ainda está incompleto.',
          render: (x) => (x.saldo == null ? '—' : h('span', { class: x.saldo > 0 ? 'warn-t' : null }, `${x.saldo > 0 ? '+' : ''}${fmt.brl0(x.saldo)}`)), sortVal: (x) => x.saldo ?? -1e12 },
      ],
      rows: R.meses.filter(FIL[fil] ? FIL[fil][1] : FIL.todos[1]), sortKey: 'ym', sortDir: 'desc', cls: 'cv-t',
      empty: fil === 'acima' ? 'Nenhum mês acima do teto. 👏' : 'Sem meses para mostrar.',
    });
    el.replaceChildren(
      h('div', { class: 'section-label' }, 'Compras × vendas'),
      h('div', { class: 'grid g-kpi' }, ...quadrosMes(R, false), kPer, kAcima),
      h('div', { class: 'mt' }, TS.cardWithTools('Compras × vendas mês a mês',
        `Estou comprando mais do que vendo? Compras = notas de compra que entraram no AppNext; teto = ${fmt.n1(R.tetoPct)}% das vendas. * mês em andamento: teto pela previsão de vendas.${R.inicioCompras ? ` Notas de compra desde ${R.desde ? fmt.date(R.desde) : TS.ymLabel(R.inicioCompras)}.` : ''}`,
        TS.seg(Object.entries(FIL).map(([k, [t]]) => [`${t} (${cont(k)})`, k]), FIL[fil] ? fil : 'todos', ir),
        graf, tab)));
  }

  TS.comprasVendas = { ...API, vendasPorMes, montar, quadroPedido, cartaoResultado };
})();
