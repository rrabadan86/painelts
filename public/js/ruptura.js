/* Estoque: venda perdida por falta (produto zerado que vendia) e excesso (produto que vende, mas com saldo muito acima
 * do que o pedido precisa). As contas são funções puras (testadas em tests/unit/ruptura.test.js); a tela Estoque
 * (estoque.js) só junta os dados e mostra. O painel não guarda o saldo dia a dia: "zerado desde" é o dia da última venda. */
(function () {
  const JANELA = 60; // dias antes de zerar usados na média
  const MAX_DIAS = 90; // última venda mais antiga que isso: a procura já não diz nada (fica de fora, como o fora de linha)
  const MIN_DIAS_VENDA = 2; // dias diferentes com venda na janela para a média valer
  const KG_MIN = 0.05; // chá a granel: menos que um pacote de 50 g não dá para vender
  const FATOR_EXCESSO = 2; // sobrando = dura mais que 2× (entrega + período do pedido)

  /** saldo que não dá mais para vender: zero (ou menos de 50 g no chá a granel) */
  const zerado = (qtd, un) => (un === 'Kg' ? !(qtd >= KG_MIN) : !(qtd > 0));

  /** Venda perdida de UM produto zerado.
   *  vendas: [{ d: dia (número), q: quantidade na unidade do estoque, v: R$ vendidos }] — já sem taxas e resgates.
   *  hoje: último dia com dados; inicio: primeiro dia com dados da loja (para não dividir por dias que o painel não tem).
   *  Devolve null (não está zerado, nunca vendeu ou a última venda é antiga demais) ou
   *  { desde, diasZerado, diasBase, diasVenda, qtdDia, perdaDia, acumulado, motivo }.
   *  Sem histórico suficiente: perdaDia/acumulado = null e motivo = 'pouco'. */
  function perda({ vendas, qtd, un, hoje, inicio, janela = JANELA, maxDias = MAX_DIAS }) {
    if (!zerado(qtd, un) || !vendas || !vendas.length) return null;
    let ult = -Infinity;
    for (const x of vendas) if (x.q > 0 && x.d <= hoje && x.d > ult) ult = x.d;
    if (!Number.isFinite(ult)) return null;
    const diasZerado = hoje - ult;
    if (diasZerado > maxDias) return null;
    const de = Math.max(ult - janela + 1, Number.isFinite(inicio) ? inicio : -Infinity);
    const diasBase = ult - de + 1;
    let q = 0, v = 0;
    const dias = new Set();
    for (const x of vendas) {
      if (x.d < de || x.d > ult) continue;
      q += x.q || 0; v += x.v || 0;
      if (x.q > 0) dias.add(x.d);
    }
    const base = { desde: ult, diasZerado, diasBase, diasVenda: dias.size };
    if (dias.size < MIN_DIAS_VENDA || !(v > 0) || diasBase < 1) return { ...base, qtdDia: null, perdaDia: null, acumulado: null, motivo: 'pouco' };
    const perdaDia = v / diasBase;
    return { ...base, qtdDia: q / diasBase, perdaDia, acumulado: perdaDia * diasZerado, motivo: null };
  }

  /** Excesso de UM produto que vende: saldo que dura mais que `fator` × (entrega + período do pedido).
   *  prev = venda por dia prevista (a mesma do "Dura"); H = entrega + período do pedido, em dias; min = mínimo do AppNext.
   *  Devolve null (não vende, sem saldo ou dentro do limite) ou { dias, alvo, sobraQtd, sobraValor (null sem custo) }. */
  function excesso({ qtd, prev, H, min, custo, un, fator = FATOR_EXCESSO }) {
    if (!(qtd > 0) || !(prev > 0) || !(H > 0)) return null;
    const dias = qtd / prev;
    if (!(dias > fator * H)) return null;
    const alvo = Math.max(prev * H, min || 0);
    let sobra = qtd - alvo;
    sobra = un === 'Kg' ? Math.floor(sobra * 1000) / 1000 : Math.floor(sobra);
    if (!(sobra > 0)) return null;
    return { dias, alvo, sobraQtd: sobra, sobraValor: custo > 0 ? sobra * custo : null };
  }

  /** totais para os quadros: { n, comConta, perdaDia, acumulado, esperando (com cliente na lista de espera) } das linhas com r.rup; { n, valor } das com r.exc */
  function totais(linhas) {
    const falta = { n: 0, comConta: 0, perdaDia: 0, acumulado: 0, esperando: 0 }, sobra = { n: 0, valor: 0, semCusto: 0 };
    for (const r of linhas) {
      if (r.rup) { falta.n++; if (r.esperando > 0) falta.esperando++; if (r.rup.perdaDia != null) { falta.comConta++; falta.perdaDia += r.rup.perdaDia; falta.acumulado += r.rup.acumulado; } }
      if (r.exc) { sobra.n++; if (r.exc.sobraValor != null) sobra.valor += r.exc.sobraValor; else sobra.semCusto++; }
    }
    return { falta, sobra };
  }

  const API = { perda, excesso, zerado, totais, JANELA, MAX_DIAS, MIN_DIAS_VENDA, KG_MIN, FATOR_EXCESSO };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }

  // ---------- tela (só no navegador) ----------
  const { h, fmt } = TS;
  const diasTxt = (d) => `${fmt.int(d)} ${Math.round(d) === 1 ? 'dia' : 'dias'}`;

  /** junta as vendas por produto do estoque e marca em cada linha r.rup (falta) e r.exc (sobrando).
   *  M = motor de custos do Estoque (casar/taxa); linhas = todos os produtos da tabela do Estoque. */
  API.marcar = function ({ linhas, M, H, espera }) {
    const db = TS.db, hoje = db.maxDay;
    const alvo = new Map();
    for (const r of linhas) if (!r.foraLinha && zerado(r.qtd, r.it.un)) alvo.set(String(r.cod), []);
    if (alvo.size) for (let i = 0; i < db.n; i++) {
      if (M.taxa(i)) continue; // taxas, serviços e resgates de fidelidade a R$ 0,01
      const c = M.casar(i);
      const l = c && alvo.get(String(c.it.cod));
      if (!l) continue;
      const q = db.qtd[i] || 0;
      l.push({ d: db.day[i], q: c.kg ? (q * c.g) / 1000 : q, v: db.vt[i] || 0 });
    }
    for (const r of linhas) {
      const v = alvo.get(String(r.cod));
      r.rup = v ? perda({ vendas: v, qtd: r.qtd, un: r.it.un, hoje, inicio: db.minDay }) : null;
      r.perdaDia = r.rup ? r.rup.perdaDia : null;
      r.esperando = (espera && espera[String(r.cod)]) || 0;
      r.exc = r.foraLinha || r.parado ? null : excesso({ qtd: r.qtd, prev: r.prev, H, min: r.min, custo: r.it.custo, un: r.it.un });
      r.sobraValor = r.exc ? r.exc.sobraValor : null;
    }
    return totais(linhas);
  };

  const contaPerda = (r) => {
    const x = r.rup;
    if (x.motivo === 'pouco') return `Zerado e a última venda foi em ${fmt.date(TS.dayToIso(x.desde))}, mas vendeu em menos de ${MIN_DIAS_VENDA} dias diferentes nos ${fmt.int(x.diasBase)} dias antes: pouco para estimar quanto se perde.`;
    return `Estimativa: nos ${fmt.int(x.diasBase)} dias antes de zerar vendeu ${fmt.brl(x.perdaDia * x.diasBase)} (em ${fmt.int(x.diasVenda)} dias com venda) = ${fmt.brl(x.perdaDia)} por dia. Zerado há ${diasTxt(x.diasZerado)} (última venda em ${fmt.date(TS.dayToIso(x.desde))}).`;
  };
  const LIMITES = `O painel não guarda o saldo de cada dia: considera que o produto zerou no dia da última venda. É uma estimativa pelo preço de venda (não é lucro) e não desconta o cliente que levou outro produto no lugar.`;

  /** quadros "Perdendo por falta" e "Dinheiro sobrando" (o Estoque torna clicáveis) */
  API.quadros = function (T, { H }) {
    const f = T.falta, s = T.sobra;
    return {
      falta: TS.kpi('Perdendo por falta', f.comConta ? `${fmt.brl0(f.perdaDia)}/dia` : '—',
        h('span', { class: f.n ? 'down' : '' }, f.n ? `${fmt.int(f.n)} ${f.n === 1 ? 'produto zerado' : 'produtos zerados'}${f.comConta ? ` · ${fmt.brl0(f.acumulado)} até agora` : ''}${f.esperando ? ` · ⏳ ${fmt.int(f.esperando)} com cliente esperando` : ''}` : 'nenhum produto zerado que vendia'),
        `Quanto a loja deixa de vender por dia em produto zerado: média de venda por dia nos ${JANELA} dias antes de zerar, em R$. ${LIMITES} Só entra quem vendeu nos últimos ${MAX_DIAS} dias; fora de linha, taxas e resgates ficam de fora.${f.n && !f.comConta ? ' Os produtos zerados têm pouco histórico para estimar.' : ''} Toque para ver na tabela e priorizar o pedido.`),
      sobra: TS.kpi('Dinheiro sobrando', s.n ? fmt.brl0(s.valor) : '—',
        s.n ? `${fmt.int(s.n)} ${s.n === 1 ? 'produto que vende devagar' : 'produtos que vendem devagar'}` : 'nenhum produto com saldo demais',
        `Produto que vende, mas tem saldo para mais de ${fmt.int(FATOR_EXCESSO * H)} dias (${FATOR_EXCESSO}× a entrega + o período do pedido, ${fmt.int(H)} dias). O valor é o que passa do necessário para ${fmt.int(H)} dias, a custo. Diferente de "parado", que não vende. Toque para ver na tabela: segure a compra desses produtos.`),
    };
  };

  /** colunas novas da tabela do Estoque; qtdTxt = o formatador de quantidade do Estoque */
  API.colunas = function ({ qtdTxt, H }) {
    const semConta = (r) => h('span', { class: 'muted est-dica', title: contaPerda(r) }, '—');
    return {
      perdaDia: { key: 'perdaDia', label: 'Perdendo R$/dia', title: `Só para produto zerado que vendia: quanto ele vendia por dia, em R$, nos ${JANELA} dias antes de zerar. Quanto maior, mais urgente pedir. "—" = não está zerado ou tem pouco histórico. ${LIMITES} Passe o mouse (ou toque) no número para ver a conta`,
        render: (r) => (!r.rup ? '—' : r.rup.perdaDia == null ? semConta(r) : h('b', { class: 'neg est-dica', title: contaPerda(r) }, fmt.brl(r.rup.perdaDia))), sortVal: (r) => (r.rup ? (r.rup.perdaDia == null ? 0 : r.rup.perdaDia) : -1) },
      zeradoHa: { key: 'zeradoHa', label: 'Zerado há', title: 'Dias desde a última venda (o painel considera que o produto zerou nesse dia). A data é a da última venda',
        render: (r) => (r.rup ? h('span', null, diasTxt(r.rup.diasZerado), h('small', { class: 'est-tam' }, `desde ${fmt.date(TS.dayToIso(r.rup.desde))}`)) : '—'), sortVal: (r) => (r.rup ? r.rup.diasZerado : -1) },
      acumulado: { key: 'acumulado', label: 'Perdido até agora', title: 'Perdendo R$/dia × dias zerado. Estimativa: quanto mais tempo zerado, menos certa (a procura muda com a época do ano)',
        render: (r) => (r.rup && r.rup.acumulado != null ? fmt.brl(r.rup.acumulado) : '—'), sortVal: (r) => (r.rup && r.rup.acumulado != null ? r.rup.acumulado : -1) },
      vendiaDia: { key: 'vendiaDia', label: 'Vendia/dia', title: `Quantidade média por dia nos ${JANELA} dias antes de zerar (chá a granel em kg, somando os tamanhos)`,
        render: (r) => (r.rup && r.rup.qtdDia != null ? (r.it.un === 'Kg' ? `${fmt.kg(r.rup.qtdDia)} kg` : fmt.n2(r.rup.qtdDia)) : '—'), sortVal: (r) => (r.rup && r.rup.qtdDia != null ? r.rup.qtdDia : -1) },
      esperando: { key: 'esperando', label: 'Na lista de espera', title: 'Clientes aguardando este produto em Clientes → Lista de espera. Com cliente esperando, a venda é quase certa quando o produto chegar',
        render: (r) => (r.esperando ? h('a', { href: '#espera', class: 'badge warn' }, `⏳ ${fmt.int(r.esperando)} ${r.esperando === 1 ? 'cliente' : 'clientes'}`) : '—'), sortVal: (r) => r.esperando || 0 },
      alvo: { key: 'alvo', label: 'Precisa ter', title: `Quanto basta para ${fmt.int(H)} dias (entrega + período do pedido) no ritmo previsto de venda — ou o mínimo do AppNext, se for maior`,
        render: (r) => (r.exc ? qtdTxt(r.exc.alvo, r.it) : '—'), sortVal: (r) => (r.exc ? r.exc.alvo : -1) },
      sobraQtd: { key: 'sobraQtd', label: 'Sobrando', title: 'Estoque − o que precisa ter. É o que está a mais na prateleira',
        render: (r) => (r.exc ? h('b', null, qtdTxt(r.exc.sobraQtd, r.it)) : '—'), sortVal: (r) => (r.exc ? r.exc.sobraQtd : -1) },
      sobraValor: { key: 'sobraValor', label: 'Sobrando R$ (custo)', title: 'Quantidade sobrando × custo unitário do AppNext: dinheiro que podia estar em produto que gira mais. "—" = produto sem custo no AppNext',
        render: (r) => (r.exc && r.exc.sobraValor != null ? h('b', { class: 'warn-t' }, fmt.brl(r.exc.sobraValor)) : '—'), sortVal: (r) => (r.exc && r.exc.sobraValor != null ? r.exc.sobraValor : -1) },
    };
  };
  TS.ruptura = API;
})();
