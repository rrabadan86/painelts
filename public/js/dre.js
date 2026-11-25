/* Resultado do mês (DRE simplificada): faturamento → impostos e taxas → custo dos produtos → comissões →
 * custos fixos → resultado. Só admin e franqueado (usa custos do estoque). */
'use strict';
(function () {
  const { h, fmt, state } = TS;

  const novo = () => ({ fat: 0, fatCusto: 0, custo: 0, imp: 0, maq: 0, roy: 0, com: 0, varPct: 0, gorjeta: 0, gorjImp: 0, gorjRoy: 0, royEg: 0, royS: 0, mkt: 0, desc: 0, dias: new Set(), eg: 0, partes: { granel: 0, envasado: 0, acess: 0, outros: 0 }, outrosGr: new Map(), pctPor: [] });
  // parte da loja de cada grupo da base (guardada por grupo; refeita quando os dados mudam)
  let partesCache = { db: null, porGrupo: [] };
  function parteDoGrupo(db, gi) {
    if (partesCache.db !== db) partesCache = { db, porGrupo: [] };
    if (gi == null) return 'outros';
    let k = partesCache.porGrupo[gi];
    if (k === undefined) k = partesCache.porGrupo[gi] = TS.contas.parteLoja(db.D && db.D.grupo ? db.D.grupo[gi] : '');
    return k;
  }
  /** dica da linha Outros: os grupos que caíram nela no mês */
  const dicaOutros = (m) => {
    const l = [...(m.outrosGr || new Map())].sort((a, b) => b[1] - a[1]);
    return 'Vendas da loja que não são chá a granel, envasado nem acessório (pelo grupo do AppNext com que o produto saiu na venda).' + (l.length ? '\n\nNeste mês:\n' + l.map(([g, v]) => `· ${g}: ${fmt.brl(v)}`).join('\n') : '');
  };
  /** soma uma linha de venda nas contas do Resultado (a mesma regra para o mês e para um intervalo de dias) */
  function somarLinha(m, i, M) {
    const db = TS.db, I = TS.rules.ids, D = M.ded;
    if (I.taxaServico.has(db.desc[i])) {
      // taxa de serviço (os 10% do Espaço Gourmet): fica fora da base, mas guarda o que pagaria se entrasse (ⓘ do Faturamento total)
      m.gorjeta += db.vt[i] || 0;
      const dg = D.deducoes(i); m.gorjImp += dg.imp;
      return;
    }
    if (M.taxa(i)) return;
    const vt = db.vt[i] || 0;
    m.fat += vt; m.dias.add(db.day[i]);
    const ehEg = I.eg.has(db.cat[i]);
    if (ehEg) m.eg += vt;
    else { // a receita da loja aberta em partes pelo grupo da venda (RES-PARTES-01, TS.contas.parteLoja)
      const gi = db.grupo ? db.grupo[i] : null, k = parteDoGrupo(db, gi);
      m.partes[k] += vt;
      if (k === 'outros') { const g = (db.D && db.D.grupo && db.D.grupo[gi]) || 'sem grupo'; m.outrosGr.set(g, (m.outrosGr.get(g) || 0) + vt); }
    }
    m.desc += TS.descontos([i]);
    const dd = D.deducoes(i);
    if (ehEg) m.royEg += dd.roy;
    m.imp += dd.imp; m.maq += dd.maq; m.roy += dd.roy; m.com += dd.com; m.royS += dd.royS || 0; m.mkt += dd.mkt || 0;
    m.varPct += dd.outros.reduce((a, v, k) => a + (D.OUTROS[k].tipo === 'pct' ? v : 0), 0);
    dd.outros.forEach((v, k) => { if (D.OUTROS[k].tipo === 'pct') m.pctPor[k] = (m.pctPor[k] || 0) + v; }); // cada custo em %, na categoria dele (DESP-CAT-01)
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
      // custos fixos do mês (valor cheio, também no mês em andamento: o valor real lançado no mês ou o padrão de Configurações,
      // TS.contas.fixoDoMes, DRE-MES-01) + despesas de um mês só (cheias no mês delas)
      const fixosMes = [...fixos.map((x) => { const f = D.fixoDoMes ? D.fixoDoMes(x, ym) : { valor: x.valor, padrao: x.valor, lancado: null }; return { nome: x.nome, cat: D.catDe ? D.catDe(x) : 'outros', valor: f.valor, padrao: f.padrao, lancado: f.lancado }; }),
        ...(D.pontuaisDoMes ? D.pontuaisDoMes(ym) : []).map((x) => ({ nome: x.nome, cat: D.catDe(x), valor: x.valor, pontual: true }))];
      const fixoTot = fixosMes.reduce((a, x) => a + x.valor, 0);
      // royalties: o calculado sobre as vendas − os descontos que a franquia deu neste mês de referência (devoluções compensadas
      // nos royalties e prêmios de fidelidade, tela Créditos com a franquia) = o que a loja pagou (pedido do dono, 23/11/2026; RES-ROY-01)
      // royalties que a taxa de serviço pagaria se entrasse na base: o mesmo % do Espaço Gourmet (sem EG no mês, o % da loja)
      m.gorjRoy = m.gorjeta * (m.eg ? m.royEg / m.eg : m.fat ? m.roy / m.fat : 0);
      const royItens = (opts.descRoy && opts.descRoy[ym]) || [];
      m.royCalc = m.roy; m.royDesc = royItens.reduce((a, x) => a + (+x.valor || 0), 0); m.royItens = royItens;
      // valor REAL do mês lançado no Resultado para as linhas calculadas (DAS, extrato, boleto): substitui o calculado (DRE-CALC-01)
      m.lanc = lancCalc(D, ym);
      m.impCalc = m.imp; m.maqCalc = m.maq;
      if (m.lanc.simples) m.imp = m.lanc.simples.valor;
      if (m.lanc.maquininha) m.maq = m.lanc.maquininha.valor;
      // royalties: o boleto lançado já vem com os descontos da franquia; sem ele, calculado − descontos do mês
      m.royPago = m.lanc.royalties ? m.lanc.royalties.valor : m.royS - m.royDesc;
      m.mktPago = m.lanc.marketing ? m.lanc.marketing.valor : m.mkt;
      m.roy = m.royPago + m.mktPago;
      const impostos = m.imp + m.maq + m.roy;
      const recLiq = m.fat - impostos;
      // perdas do mês (chá vencido ainda no estoque + faltas do inventário, a custo): entram depois do custo dos produtos
      const perdasDet = opts.perdas ? opts.perdas[ym] || { total: 0, vencidos: 0, inventario: 0, nVencidos: 0, nContagens: 0 } : null;
      const perdas = perdasDet ? perdasDet.total : null;
      // três degraus, a mesma definição da Rentabilidade (decisão do dono, 23/11/2026):
      // lucro bruto = venda − custo dos produtos; lucro sem fixos = lucro bruto − Simples, maquininha, royalties,
      // comissão e custos em %; resultado = lucro sem fixos − perdas − custos fixos
      const lucroBruto = cmv == null ? null : m.fat - cmv;
      const contrib = lucroBruto == null ? null : lucroBruto - impostos - m.com - m.varPct;
      const resultado = contrib == null ? null : contrib - (perdas || 0) - fixoTot;
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
    const p = { ...m, parcial: false, projecao: true, fat: m.fat * k, fatCusto: m.fatCusto * k, custo: m.custo * k, imp: m.lanc && m.lanc.simples ? m.imp : m.imp * k, maq: m.lanc && m.lanc.maquininha ? m.maq : m.maq * k, impCalc: (m.impCalc ?? m.imp) * k, maqCalc: (m.maqCalc ?? m.maq) * k, royCalc: (m.royCalc ?? m.roy) * k, royS: (m.royS || 0) * k, mkt: (m.mkt || 0) * k, com: comP != null ? comP : m.com * k, varPct: m.varPct * k, projMes: PM, fator: k,
      gorjeta: m.gorjeta * k, gorjImp: m.gorjImp * k, gorjRoy: m.gorjRoy * k, desc: m.desc * k, eg: m.eg * k, cmv: x(m.cmv), partes: Object.fromEntries(Object.entries(m.partes || {}).map(([q, v]) => [q, v * k])), pctPor: (m.pctPor || []).map((v) => (v == null ? v : v * k)) };
    // o lançado vale como está (não cresce com as vendas); o calculado acompanha a projeção
    p.royPago = m.lanc && m.lanc.royalties ? m.royPago : p.royS - (m.royDesc || 0);
    p.mktPago = m.lanc && m.lanc.marketing ? m.mktPago : p.mkt;
    p.roy = p.royPago + p.mktPago;
    p.impostos = p.imp + p.maq + p.roy;
    p.recLiq = p.fat - p.impostos;
    p.lucroBruto = p.cmv == null ? null : p.fat - p.cmv;
    p.contrib = p.lucroBruto == null ? null : p.lucroBruto - p.impostos - p.com - p.varPct;
    p.resultado = p.contrib == null ? null : p.contrib - (p.perdas || 0) - p.fixoTot; // as perdas não crescem com as vendas: ficam as de agora
    return p;
  }

  /** ⓘ do Faturamento total: a conta com e sem a taxa de serviço (pedido do dono: investigar royalties e imposto) */
  function dicaTotal(m) {
    if (!m.gorjeta) return 'Tudo o que o cliente pagou no mês. Neste mês não houve taxa de serviço.';
    const b = fmt.brl;
    return `Tudo o que o cliente pagou no mês: loja + Espaço Gourmet + taxa de serviço (${b(m.gorjeta)}).\n\n`
      + `Hoje a taxa fica FORA da base (repassada à equipe): faturamento ${b(m.fat)} · Simples ${b(m.imp)} · royalties calculados ${b(m.royCalc ?? m.roy)}.\n\n`
      + `Se a taxa entrasse na base: faturamento ${b(m.fat + m.gorjeta)} · Simples ${b(m.imp + m.gorjImp)} (+${b(m.gorjImp)}) · royalties calculados ${b((m.royCalc ?? m.roy) + m.gorjRoy)} (+${b(m.gorjRoy)}).\n\n`
      + 'Compare os royalties com o boleto da franquia. Sobre o imposto, confirme com o contador como a loja registra a taxa.';
  }
  /** linhas calculadas que aceitam o valor real do mês (DRE-CALC-01): chave → rótulo e o calculado do mês */
  const CALC = { simples: ['Simples Nacional', (m) => m.impCalc], maquininha: ['Maquininha', (m) => m.maqCalc], royalties: ['Royalties', (m) => (m.royS || 0) - (m.royDesc || 0)], marketing: ['Marketing', (m) => m.mkt] };
  function lancCalc(D, ym) {
    const out = {};
    for (const k of Object.keys(CALC)) { const l = D && D.LANC && D.LANC['@' + k] && D.LANC['@' + k][ym]; out[k] = l && Number.isFinite(+l.valor) && +l.valor >= 0 ? { valor: +l.valor, por: l.por, em: l.em } : null; }
    return out;
  }
  /** ⓘ da linha calculada: a regra, o calculado e o lançado (com a diferença, para conferir com o DAS, o extrato e o boleto) */
  function dicaCalc(m, k, base) {
    const l = m.lanc && m.lanc[k], calc = CALC[k][1](m);
    let t = base + '.';
    if (k === 'royalties' && m.royDesc) t += `\n\nCalculado ${fmt.brl(m.royS)} − descontos da franquia ${fmt.brl(m.royDesc)}:\n` + m.royItens.map((x) => `  · ${x.texto}: ${fmt.brl(x.valor)}`).join('\n');
    if (l) t += `\n\n✎ Valor real lançado: ${fmt.brl(l.valor)}${l.por ? ` por ${l.por}` : ''}. Calculado pelo %: ${fmt.brl(calc)} (diferença ${fmt.brl(l.valor - calc)}).`;
    return t + '\n\nClique no valor de um mês para lançar o valor real (DAS, extrato da maquininha, boleto da franquia).';
  }
  /** ⓘ dos royalties: calculado − descontos da franquia = pago, com a origem de cada desconto */
  function dicaRoy(m) {
    const base = 'Pelas regras da loja: loja + marketing; Espaço Gourmet: EG + marketing EG, sobre o faturamento sem a taxa de serviço.';
    if (!m.royDesc && !(m.lanc && (m.lanc.royalties || m.lanc.marketing))) return base + ' Royalties e marketing estão separados nas duas linhas de baixo: clique no valor de um mês para lançar o valor real do boleto.';
    const b = fmt.brl;
    return `${base}\n\nCalculado sobre as vendas: ${b(m.royCalc)}${m.royDesc ? `\nDescontos da franquia neste mês: −${b(m.royDesc)}\n` + m.royItens.map((x) => `  · ${x.texto}: ${b(x.valor)}`).join('\n') : ''}`
      + `${m.lanc && m.lanc.royalties ? `\nRoyalties: valor real lançado ${b(m.royPago)}` : ''}${m.lanc && m.lanc.marketing ? `\nMarketing: valor real lançado ${b(m.mktPago)}` : ''}\nPago: ${b(m.roy)}`;
  }
  /** ⓘ das categorias: o total do mês somando as despesas que acompanham as vendas e as fixas da mesma categoria (DESP-CAT-01) */
  function totalCat(vgrupos, id, m) {
    const vg = vgrupos.find((g) => g.id === id);
    const fixo = (m.fixosMes || []).filter((x) => x.cat === id).reduce((a, x) => a + x.valor, 0);
    if (!vg || !fixo) return '';
    const v = vg.soma(m) || 0;
    return `\n\nTotal de ${vg.nome} no mês: ${fmt.brl(v + fixo)} (${fmt.brl(v)} que acompanham as vendas + ${fmt.brl(fixo)} fixas).`;
  }
  /** grupos das despesas que acompanham as vendas: [{ id, nome, itens: [{ nome, f, dica, cc }], soma, dica }] */
  function gruposVar(M, cats) {
    const D = M.ded, CT = TS.contas;
    const CV = D.CATVAR || CT.catVarDe(null, cats);
    const todas = [...CT.catsEscolha(cats), CT.CAT_FRANQUIA];
    const nomeDe = (id) => (todas.find((c) => c.id === id) || { nome: 'Outros' }).nome;
    const itens = [
      { nome: 'Simples Nacional', cat: CV.simples, f: (m) => m.imp, cc: 'simples', dica: (m) => dicaCalc(m, 'simples', '% do Simples (Configurações → Lojas → Estoque e margem) sobre as vendas') },
      { nome: 'Maquininha', cat: CV.cartao, f: (m) => m.maq, cc: 'maquininha', dica: (m) => dicaCalc(m, 'maquininha', 'Taxa média da maquininha sobre as vendas') },
      { nome: 'Royalties', cat: 'franquia', f: (m) => m.royPago, cc: 'royalties', dica: (m) => dicaCalc(m, 'royalties', 'Royalties pelas regras da loja (loja; Espaço Gourmet: EG) sobre o faturamento sem a taxa de serviço, menos os descontos da franquia do mês (devoluções compensadas nos royalties e prêmios de fidelidade)') },
      { nome: 'Marketing', cat: 'franquia', f: (m) => m.mktPago, cc: 'marketing', dica: (m) => dicaCalc(m, 'marketing', 'Fundo de marketing pelas regras da loja (loja; Espaço Gourmet: marketing EG) sobre o faturamento sem a taxa de serviço') },
      { nome: 'Comissões e premiações', cat: CV.comissao, f: (m) => m.com, dica: 'O que a loja pagou no mês (comissões, premiação e bônus), como no Comissionamento. Na projeção do mês em andamento: a comissão que cada pessoa receberia com a venda projetada dela contra a meta (na faixa em que fecharia), não a comissão de agora multiplicada' },
      ...D.OUTROS.map((x, k) => (x.tipo !== 'pct' ? null : { nome: x.nome, cat: D.catDe ? D.catDe(x) : 'outros', f: (m) => (m.pctPor && m.pctPor[k]) || 0, dica: `Custo cadastrado como ${fmt.n1(+x.valor || 0)}% das vendas (${D.ONDE_FAT ? D.ONDE_FAT[x.aplica] || 'loja + Espaço Gourmet' : ''})` })),
    ].filter(Boolean);
    const ordem = ['impostos', 'taxas', 'franquia', ...cats.map((c) => c.id)];
    const ids = [...new Set([...ordem, ...itens.map((x) => x.cat)])].filter((id) => itens.some((x) => x.cat === id));
    return ids.map((id) => {
      const l = itens.filter((x) => x.cat === id);
      const g = { id, nome: nomeDe(id), itens: l, soma: (m) => l.reduce((a, x) => a + (x.f(m) || 0), 0) };
      g.dica = (m) => (id === 'franquia' ? dicaRoy(m) : `${l.map((x) => x.nome).join(', ')}: despesas que acompanham as vendas.`) + totalCat([g], id, m);
      return g;
    });
  }
  // linhas da DRE: [rótulo, chave/função, tipo] tipo: 'sub' (subtotal), 'tot' (resultado), 'menos', 'info'
  /** grupos: [{ id, nome, itens:[índice em fixosMes] }] — cada categoria vira uma linha com o subtotal, que abre os custos */
  const LINHAS = (grupos, abertos, vgrupos = []) => [
    // receita separada em Loja e Espaço Gourmet, com a taxa de serviço (os 10%) identificada (pedido do dono, 23/11/2026; RES-TAXA-01)
    ['Faturamento total', (m) => m.fat + m.gorjeta, 'bruto', (m) => dicaTotal(m)],
    ['Loja', (m) => m.fat - m.eg, 'parte', 'Vendas da loja, sem o Espaço Gourmet (com os descontos, sem entrega e sem itens a R$ 0,01). Clique para abrir em chás a granel, envasados, acessórios e outros.', 'loja'],
    // a loja aberta pelo grupo da venda (pedido do dono, 25/11/2026; RES-PARTES-01)
    ...(abertos.has('loja') ? TS.contas.PARTES_LOJA.map(([k, nome]) => [nome, (m) => (m.partes ? m.partes[k] : null), 'lojaparte', k === 'outros' ? dicaOutros
      : k === 'granel' ? 'Chás a granel: as vendas dos grupos de chá do AppNext (os mesmos do "Chá vendido"), como saíram no caixa' : k === 'envasado' ? 'Chás envasados (pacote fechado, lata, minitin, sachê, Tea Moments): o grupo de envasados do AppNext' : 'Acessórios: o grupo ACESSÓRIOS do AppNext']) : []),
    ['Espaço Gourmet', (m) => m.eg, 'parte', 'Consumo do Espaço Gourmet, sem a taxa de serviço'],
    ['Taxa de serviço (10%)', (m) => m.gorjeta, 'taxa', 'Taxa de serviço (os 10% do Espaço Gourmet) que o cliente pagou. Fica identificada aqui (em destaque), mas FORA da base: não entra no faturamento da loja: é repassada à equipe. Passe o mouse em "Faturamento total" para ver quanto seriam o Simples e os royalties se ela entrasse na base'],
    ['− Repassada à equipe', (m) => m.gorjeta, 'repasse', 'A taxa de serviço sai do faturamento: vai para a equipe. Por isso o Simples e os royalties do painel são calculados sem ela (confirme com o contador como a loja registra)'],
    ['= Faturamento', (m) => m.fat, 'base', 'Faturamento da loja: tudo o que foi vendido, com Espaço Gourmet e vendas sem vendedor, já com os descontos; sem taxa de serviço e entrega e sem itens a R$ 0,01 (resgates e brindes). É o mesmo número do Resumo e do Início'],
    ['− Custo dos produtos', (m) => m.cmv, 'menos', 'Custo dos produtos vendidos (chá pelo kg + saco e etiquetas). Mês passado: o custo que cada produto tinha na data da venda (notas de compra e histórico de custos do painel; antes do primeiro custo conhecido vale o mais antigo, estimado). Mês em andamento: o custo de hoje do AppNext. Vendas sem custo no estoque entram pelo mesmo % das outras (estimado)'],
    ['= Lucro bruto', (m) => m.lucroBruto, 'sub', 'Faturamento − custo dos produtos vendidos. A mesma conta da Rentabilidade (aqui as vendas sem custo cadastrado entram pelo mesmo % de custo das outras).'],
    // despesas que acompanham as vendas, agrupadas pela categoria (aprovado pelo dono, 25/11/2026; DESP-CAT-01)
    ['Despesas que acompanham as vendas', () => null, 'secao', 'Sobem e descem com as vendas (vendeu mais, paga mais): Simples, maquininha, royalties e marketing, comissões e os custos em % das vendas. Cada uma aparece na categoria escolhida em Configurações → Lojas → Estoque e margem.'],
    ...vgrupos.flatMap((g) => (g.itens.length === 1
      ? [[`−\u00a0${g.nome}: ${g.itens[0].nome}`, g.itens[0].f, 'menos', g.itens[0].dica, null, null, g.itens[0].cc]]
      : [[`−\u00a0${g.nome}${g.id === 'franquia' ? ' (royalties + marketing)' : ''}`, g.soma, 'vgrupo', g.dica, 'v:' + g.id],
        ...(abertos.has('v:' + g.id) ? g.itens.map((x) => [x.nome, x.f, x.cc ? 'calc' : 'filho', x.dica, null, null, x.cc]) : [])])),
    ['= Lucro sem fixos', (m) => m.contrib, 'sub', 'Lucro bruto − Simples, maquininha, royalties, comissões e custos em %: o que as vendas deixam para pagar as perdas e os custos fixos. É o "Lucro sem fixos" da Rentabilidade (antes chamado de margem de contribuição).'],
    ['− Perdas (vencidos e inventário)', (m) => m.perdas, 'menos', 'O que a loja pagou e não vai vender, a custo: (1) lote VENCIDO que ainda está no estoque (chá a granel, envasados e alimentação), no mês em que a validade venceu (saldo do lote × custo do kg ou da unidade, os lotes da tela Validade); (2) faltas do INVENTÁRIO: contagens aplicadas no AppNext no mês, pelo saldo dos ajustes (contado − sistema) × custo — sobra compensa falta, e só o saldo negativo do mês entra. Na projeção ficam as perdas de agora (não crescem com as vendas). "—" = o painel não conseguiu ler as perdas'],
    ['Despesas fixas do mês', () => null, 'secao', 'O mesmo valor todo mês, venda muito ou pouco: salários, aluguel fixo, sistemas… (o valor de Configurações ou o valor real lançado no mês).'],
    ...grupos.flatMap((g) => [
      [`− ${g.nome}`, (m) => m.fixosMes.filter((x) => x.cat === g.id).reduce((a, x) => a + x.valor, 0), 'grupo', (m) => `${g.nomes.length} ${g.nomes.length === 1 ? 'custo' : 'custos'}: ${g.nomes.map((n) => n.nome + (n.pontual ? ' (pontual)' : '')).join(', ')}. Clique para ${abertos.has(g.id) ? 'fechar' : 'abrir'}.${totalCat(vgrupos, g.id, m)}`, g.id],
      ...(abertos.has(g.id) ? g.nomes.map((n) => [n.pontual ? `${n.nome} · pontual` : n.nome, (m) => { const l = m.fixosMes.filter((x) => x.cat === g.id && x.nome === n.nome && !!x.pontual === n.pontual); return l.length ? l.reduce((a, x) => a + x.valor, 0) : null; }, 'filho',
        n.pontual ? 'Despesa de um mês só: entra cheia no mês dela' : 'Custo fixo: entra pelo valor cheio do mês, também no mês em andamento. Clique no valor de um mês para lançar o valor real daquele mês (✎); clique no nome para ver o histórico mês a mês', null, n.pontual ? null : n.nome]) : []),
    ]),
    ['= Resultado do mês', (m) => m.resultado, 'tot', 'Lucro sem fixos − perdas − custos fixos'],
  ];

  TS.dreCalcular = calcular; // o caixa a pagar usa os mesmos royalties e impostos do Resultado
  TS.pages.dre = function (root) {
    if (TS.subEstoque) root.append(TS.subEstoque('dre'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Resultado do mês'),
      h('div', { class: 'page-sub' }, 'Do faturamento ao lucro: impostos, custo dos produtos, comissões e custos fixos, mês a mês'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'O resultado é de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Calculando…'))));
    // abas da tela: o resultado (lucro) e o caixa a pagar (o que vence, com a previsão do que entra — apagar.js)
    const aba = TS.aPagar && state.dreAba === 'apagar' ? 'apagar' : 'resultado';
    if (TS.aPagar) root.append(h('div', { class: 'dre-abas' }, TS.seg([['Resultado do mês', 'resultado', 'Do faturamento ao lucro, mês a mês.'], ['A pagar', 'apagar', 'O que vence nos próximos 30 ou 60 dias, com a previsão do que entra: lucro no papel não paga boleto.']], aba, (v) => { state.dreAba = v; TS.render(); })));
    root.append(corpo);
    Promise.all([TS.custosLoja(), buscarPerdas(state.loja), buscarDescRoy(state.loja)]).then(([M, perdas, descRoy]) => {
      if (!corpo.isConnected) return;
      if (!M) { corpo.replaceChildren(h('div', { class: 'notice' }, 'Ainda não há estoque desta loja: o resultado precisa do custo dos produtos. Envie a planilha de estoque em Configurações → Lojas.')); return; }
      if (aba === 'apagar') { TS.aPagar.pagina(corpo, M); return; }
      pintar(corpo, M, perdas, descRoy);
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
  /** descontos da franquia nos royalties por mês de referência (/api/resultado/descontos-royalties; 2 min em memória). Sem eles, os royalties ficam só os calculados */
  const descRoyCache = new Map();
  async function buscarDescRoy(loja) {
    const c = descRoyCache.get(loja);
    if (c && Date.now() - c.at < 120e3) return c.porMes;
    try {
      const r = await fetch(TS.api(`resultado/descontos-royalties?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' });
      if (!r.ok) return null;
      const j = await r.json();
      descRoyCache.set(loja, { at: Date.now(), porMes: j.porMes || {} });
      return j.porMes || {};
    } catch { return null; }
  }
  TS.dreCalcular = calcular; // testes de tela

  function pintar(corpo, M, perdas, descRoy) {
    corpo.replaceChildren();
    const meses = calcular(M, { perdas, descRoy });
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
    const vgrupos = gruposVar(M, cats);
    // as categorias das despesas que acompanham as vendas começam abertas (as de baixo, fechadas)
    if (!state.dreVIni) { state.dreVIni = true; for (const g of vgrupos) abertos.add('v:' + g.id); }
    const linhas = LINHAS(grupos, abertos, vgrupos);
    const sel = state.dreMes && meses.some((m) => m.ym === state.dreMes) ? state.dreMes : meses[meses.length - 1].ym;
    const m = meses.find((x) => x.ym === sel);
    const ymAnt = `${+sel.slice(0, 4) - 1}${sel.slice(4)}`;
    // mês em andamento: "até hoje" (vendas até hoje, custos fixos cheios) e "projeção" (no ritmo atual), comparada com o mesmo mês inteiro do ano anterior;
    // o faturamento do topo também se compara com os mesmos dias do ano anterior
    const diaAte = +TS.dayToIso(m.ultimo).slice(8, 10);
    const a = meses.find((x) => x.ym === ymAnt) || null;
    const aDias = m.parcial ? (calcular(M, { soYm: ymAnt, ateDia: diaAte, perdas, descRoy })[0] || null) : a;
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
    const varA = (k) => (aDias && aDias[k] ? h('span', null, TS.deltaSpan(m[k] / aDias[k] - 1), ` vs. ${m.parcial ? `${rotAnt} (dias 1 a ${diaAte})` : rotAnt}`) : null);
    corpo.append(h('div', { class: 'dre-topo' }, h('label', null, 'Mês ', opMes), h('span', { class: 'muted' }, 'Todos os dias do mês, sem os filtros do topo. Custos fixos e % com os valores cadastrados hoje.'),
      TS.aPagar ? TS.aPagar.botaoExportar(m, LINHAS(grupos, new Set(), vgrupos).filter((l) => !['bruto', 'parte', 'lojaparte', 'taxa', 'repasse', 'calc', 'secao'].includes(l[2])).map((l) => (l[2] === 'base' ? ['Faturamento', ...l.slice(1)] : l)), cats, vgrupos) : null),
      ...avisos.map((t) => h('div', { class: 'notice' }, t)),
      // herói (redesenho de 22/11): o resultado em primeiro, a projeção (mês em andamento) e o faturamento com as margens
      TS.heroi([
        { rot: m.parcial ? 'Resultado até hoje' : 'Resultado do mês', num: m.resultado == null ? '—' : fmt.brl0(m.resultado), estado: m.resultado == null ? null : m.resultado >= 0 ? 'bom' : 'ruim',
          linhas: [m.parcial ? (m.resultado == null ? '' : m.resultado >= 0 ? 'custos fixos do mês já cobertos' : `falta cobrir ${fmt.brl0(-m.resultado)} dos custos fixos`) : `${pc(m.resultado, m.fat)} do faturamento`,
            m.perdas > 0 ? `inclui ${fmt.brl0(m.perdas)} de perdas` : null],
          dica: m.parcial ? 'Lucro sem fixos até hoje − perdas do mês (chá vencido e faltas do inventário) − custos fixos do mês inteiro.' : 'Lucro sem fixos − perdas do mês (chá vencido e faltas do inventário) − custos fixos.' },
        P ? { rot: 'Projeção do mês', num: P.resultado == null ? '—' : fmt.brl0(P.resultado), estado: P.resultado == null ? null : P.resultado >= 0 ? 'bom' : 'ruim',
          linhas: [h('span', { class: 'dre-h-proj' }, `vendendo ${fmt.brl0(P.fat)} no mês (ritmo atual)`)],
          dica: `Resultado se as vendas seguirem o ritmo de agora até o fim do mês. Impostos, custo dos produtos e custos em % acompanham as vendas; a comissão é recalculada com a venda projetada de cada pessoa contra a meta; os custos fixos ficam iguais.${P.projMes ? '\n\nFaturamento projetado:\n' + TS.comoProjecao(P.projMes) : ''}` } : null,
        { rot: 'Faturamento', num: m.fat == null ? '—' : fmt.brl0(m.fat), linhas: [varA('fat'),
          h('span', { class: 'dre-h-lb' }, `Lucro bruto ${m.lucroBruto == null ? '—' : fmt.brl0(m.lucroBruto)} · margem ${pc(m.lucroBruto, m.fat)}`, TS.dica('Faturamento − custo dos produtos vendidos: a mesma conta da Rentabilidade. Impostos, maquininha, royalties, comissão e perdas vêm depois, nas linhas de baixo.')),
          h('span', { class: 'dre-h-mc' }, `Lucro sem fixos ${m.contrib == null ? '—' : fmt.brl0(m.contrib)} · ${pc(m.contrib, m.fat)} do faturamento`, TS.dica('Lucro bruto − Simples, maquininha, royalties, comissões e custos em %: o que as vendas deixam para pagar as perdas e os custos fixos.'))],
          dica: 'Faturamento do mês (todos os dias do mês, sem os filtros do topo), comparado com o mesmo período do ano anterior.' },
      ], { titulo: m.parcial ? `${TS.ymLabel(sel)} até agora` : `Fechamento de ${TS.ymLabel(sel)}` }),
      linhaPerdas(m, sel),
      andamento ? h('p', { class: 'dre-andamento muted' }, `Mês em andamento: ${m.decorridos} de ${m.diasMes} dias. "Até hoje" usa as vendas até agora e os custos fixos inteiros.`, TS.dica(andamento)) : null,
      h('div', { class: 'dre-eq-aqui' }));

    // DRE do mês × mesmo mês do ano anterior
    // celular (LMOB-05, lote 3): 3 colunas — o valor com o % embaixo e, ao lado, a projeção (mês em andamento) ou o ano
    // anterior com a variação embaixo; as 8 colunas do computador rolavam de lado
    const MOB = TS.ehCelular();
    const sub = (td, txt, cls) => { if (td && txt != null && txt !== '') td.append(h('small', { class: 'dre-sub ' + (cls || 'muted') }, txt)); return td; };
    const linhaMob = (tr, celRot, cV, pV, cP, pP, cA, d, clsD) => {
      // com projeção, a variação contra o ano anterior inteiro vai embaixo dela (nenhum número sai da tela)
      if (P && cP) { sub(cP, pP); if (d != null) cP.append(h('small', { class: 'dre-sub ' + clsD }, `${fmt.delta(d)} × ${rotAnt}`)); }
      tr.append(celRot, sub(cV, pV), P ? cP : sub(cA, d == null ? '' : fmt.delta(d), clsD)); return tr;
    };
    const tb = h('table', { class: 't dre-t' + (MOB ? ' dre-mob' : '') });
    if (MOB) tb.append(h('thead', null, h('tr', null, h('th', { class: 'l' }, ''), h('th', null, P ? `Até hoje (dia ${diaAte})` : TS.ymLabel(sel)),
      h('th', { class: 'dre-var', title: P ? `Projeção do mês e, embaixo, o % e a variação contra ${rotAnt} INTEIRO (o mês fechado do ano anterior)` : `${a ? rotAnt : 'Ano anterior'} e, embaixo, a variação de ${TS.ymLabel(sel)} contra ele (os dois meses inteiros)` }, P ? 'Projeção do mês' : (a ? rotAnt : 'Ano anterior')))));
    else
    tb.append(h('thead', null, h('tr', null, h('th', { class: 'l' }, ''),
      h('th', null, P ? `Até hoje (dia ${diaAte})` : TS.ymLabel(sel)), h('th', null, '%'),
      P ? h('th', { class: 'dre-proj' }, 'Projeção do mês') : null, P ? h('th', { class: 'dre-proj' }, '%') : null,
      h('th', null, a ? `${rotAnt}${P ? ' (mês inteiro)' : ''}` : 'Ano anterior'), h('th', null, '%'),
      h('th', { class: 'dre-var', title: P ? `Projeção do mês de ${TS.ymLabel(sel)} contra ${rotAnt} INTEIRO (o mês fechado do ano anterior, não só os mesmos dias)` : `${TS.ymLabel(sel)} contra ${rotAnt}, os dois meses inteiros` }, P ? `Projeção × ${rotAnt} inteiro` : 'Variação'))));
    const body = h('tbody');
    const alternar = (id) => { if (abertos.has(id)) abertos.delete(id); else abertos.add(id); TS.render(); };
    const abrir = (nome, ym) => janelaFixo(M, meses, nome, ym);
    const abrirCalc = (k, ym) => janelaCalc(M, meses, k, ym);
    const nColMes = tb.querySelector('thead tr') ? tb.querySelector('thead tr').children.length : 3;
    for (const [rot, f, tipo, dica, gid, fx, cc] of linhas) {
      if (tipo === 'secao') { body.append(h('tr', { class: 'dre-secao', title: dica }, h('td', { class: 'l', colspan: nColMes }, rot))); continue; }
      const v = f(m), vp = P ? f(P) : null, va = a ? f(a) : null, vb = f(base);
      if (cc) { // linha calculada que aceita o valor real do mês (Simples, maquininha, royalties, marketing)
        const d2 = vb != null && va ? vb / va - 1 : null;
        if (MOB) { body.append(linhaMob(h('tr', { class: 'dre-' + tipo, title: typeof dica === 'function' ? dica(m) : dica }), h('td', { class: 'l' }, rot),
          celCalc(m, cc, v == null ? '—' : fmt.brl(v), null, abrirCalc), pc(v, m.fat), P ? celCalc(P, cc, vp == null ? '—' : fmt.brl(vp), 'dre-proj', abrirCalc, m.ym) : null, P ? pc(vp, P.fat) : '',
          a ? celCalc(a, cc, va == null ? '—' : fmt.brl(va), null, abrirCalc) : h('td', null, '—'), d2, d2 == null || Math.abs(d2) < 0.0005 ? 'muted' : d2 < 0 ? 'pos' : 'neg')); continue; }
        body.append(h('tr', { class: 'dre-' + tipo, title: typeof dica === 'function' ? dica(m) : dica },
          h('td', { class: 'l' }, rot), celCalc(m, cc, v == null ? '—' : fmt.brl(v), null, abrirCalc), h('td', { class: 'muted' }, pc(v, m.fat)),
          P ? celCalc(P, cc, vp == null ? '—' : fmt.brl(vp), 'dre-proj', abrirCalc, m.ym) : null, P ? h('td', { class: 'muted dre-proj' }, pc(vp, P.fat)) : null,
          a ? celCalc(a, cc, va == null ? '—' : fmt.brl(va), null, abrirCalc) : h('td', null, '—'), h('td', { class: 'muted' }, a ? pc(va, a.fat) : '—'),
          h('td', { class: d2 == null || Math.abs(d2) < 0.0005 ? 'muted' : d2 < 0 ? 'pos' : 'neg' }, d2 == null ? '—' : fmt.delta(d2))));
        continue;
      }
      const d = vb != null && va ? vb / va - 1 : null;
      const bom = tipo === 'menos' || tipo === 'grupo' || tipo === 'vgrupo' || tipo === 'filho' || tipo === 'calc' ? d < 0 : d > 0;
      const rotL = tipo === 'tot' && P ? '= Resultado' : rot;
      if (MOB) {
        body.append(linhaMob(h('tr', { class: 'dre-' + tipo, title: typeof dica === 'function' ? dica(m) : dica, onclick: gid ? () => alternar(gid) : null }),
          h('td', { class: 'l' }, gid ? h('span', { class: 'dre-seta' }, abertos.has(gid) ? '▾ ' : '▸ ') : null, fx ? nomeFixo(rotL, () => abrir(fx, sel)) : rotL),
          fx ? celFixo(m, fx, v == null ? '—' : fmt.brl(v), null, abrir) : h('td', { class: tipo === 'tot' && v < 0 ? 'neg' : null }, v == null ? '—' : fmt.brl(v)), pc(v, m.fat),
          P ? (fx ? celFixo(P, fx, vp == null ? '—' : fmt.brl(vp), 'dre-proj', abrir) : h('td', { class: 'dre-proj' + (tipo === 'tot' && vp < 0 ? ' neg' : '') }, vp == null ? '—' : fmt.brl(vp))) : null, P ? pc(vp, P.fat) : '',
          fx && a ? celFixo(a, fx, va == null ? '—' : fmt.brl(va), null, abrir) : h('td', null, va == null ? '—' : fmt.brl(va)), d, d == null || Math.abs(d) < 0.0005 ? 'muted' : bom ? 'pos' : 'neg'));
        continue;
      }
      body.append(h('tr', { class: 'dre-' + tipo, title: typeof dica === 'function' ? dica(m) : dica, onclick: gid ? () => alternar(gid) : null },
        h('td', { class: 'l' }, gid ? h('span', { class: 'dre-seta' }, abertos.has(gid) ? '▾ ' : '▸ ') : null, fx ? nomeFixo(rotL, () => abrir(fx, sel)) : rotL),
        fx ? celFixo(m, fx, v == null ? '—' : fmt.brl(v), null, abrir) : h('td', { class: tipo === 'tot' && v < 0 ? 'neg' : null }, v == null ? '—' : fmt.brl(v)), h('td', { class: 'muted' }, pc(v, m.fat)),
        P ? (fx ? celFixo(P, fx, vp == null ? '—' : fmt.brl(vp), 'dre-proj', abrir) : h('td', { class: 'dre-proj' + (tipo === 'tot' && vp < 0 ? ' neg' : '') }, vp == null ? '—' : fmt.brl(vp))) : null, P ? h('td', { class: 'muted dre-proj' }, pc(vp, P.fat)) : null,
        fx && a ? celFixo(a, fx, va == null ? '—' : fmt.brl(va), null, abrir) : h('td', null, va == null ? '—' : fmt.brl(va)), h('td', { class: 'muted' }, a ? pc(va, a.fat) : '—'),
        h('td', { class: d == null || Math.abs(d) < 0.0005 ? 'muted' : bom ? 'pos' : 'neg' }, d == null ? '—' : fmt.delta(d))));
    }
    if (P && m.resultado != null && m.resultado < 0) body.append(MOB ? h('tr', { class: 'dre-info' }, h('td', { class: 'l' }, 'Falta cobrir dos custos fixos'), h('td', { class: 'neg' }, fmt.brl(-m.resultado)),
      h('td', { class: 'dre-proj muted' }, P.resultado >= 0 ? 'no ritmo atual, fecha no azul' : 'no ritmo atual, fecha no vermelho'))
      : h('tr', { class: 'dre-info' }, h('td', { class: 'l' }, 'Falta cobrir dos custos fixos'), h('td', { class: 'neg' }, fmt.brl(-m.resultado)), h('td', { class: 'muted' }, ''),
        h('td', { class: 'dre-proj muted', colspan: 2 }, P.resultado >= 0 ? 'no ritmo atual, fecha no azul' : 'no ritmo atual, fecha no vermelho'), h('td', { colspan: 3 }, '')));
    tb.append(body);
    const linkCustos = !(TS.eu && TS.eu.pode && TS.eu.pode.configurar) ? null : h('div', { class: 'dre-links' },
      h('a', { href: '#config', onclick: (e) => { e.preventDefault(); TS.editarCustos(state.loja); } }, '+ Adicionar ou editar custos da loja'),
      h('a', { href: '#config', onclick: (e) => { e.preventDefault(); TS.editarCustos(state.loja, 'cfg-pontuais'); } }, '+ Despesa de um mês só (ex.: IPTU, 13º)'));
    const memo = h('div', { class: 'dre-memo muted' },
      `Fora do resultado (informativo): taxa de serviço recebida ${fmt.brl(m.gorjeta)} (repassada à equipe) · descontos dados ${fmt.brl(m.desc)} · Espaço Gourmet ${fmt.brl(m.eg)} (${pc(m.eg, m.fat)} do faturamento). Passe o mouse em cada linha para ver de onde vem o valor.`);
    corpo.append(h('div', { class: 'mt' }, TS.card(`Resultado de ${TS.ymLabel(sel)}`, a ? (P ? `Até hoje e projeção no ritmo atual; a variação compara a projeção com ${rotAnt} inteiro` : `Comparado com ${rotAnt}`) : 'Sem o mesmo mês do ano anterior para comparar', DICA_EDITAR(), h('div', { class: 'table-wrap free' }, tb), memo, linkCustos)));

    // gráfico: resultado mês a mês
    const comoMes = (x) => x.proj || x; // mês em andamento entra pela projeção, para comparar com os meses fechados
    const ult = meses.slice(-13).map(comoMes);
    corpo.append(h('div', { class: 'mt' }, TS.card('Resultado mês a mês', 'Barras = resultado do mês (verde lucro, vermelho prejuízo) · linha = lucro sem fixos · * mês em andamento pela projeção (cor clara)', TS.chart({
      type: 'bar',
      data: { labels: ult.map((x) => TS.ymLabel(x.ym) + (x.projecao ? '*' : '')),
        datasets: [
          { type: 'bar', label: 'Resultado', data: ult.map((x) => x.resultado), backgroundColor: ult.map((x) => (x.resultado >= 0 ? (x.projecao ? '#8FB39A' : '#2C5234') : x.projecao ? '#E3A595' : '#B5452B')), borderRadius: 4, order: 2 },
          { type: 'line', label: 'Lucro sem fixos', data: ult.map((x) => x.contrib), borderColor: '#C9A227', backgroundColor: '#C9A227', tension: 0.3, pointRadius: 3, order: 1 },
        ] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.brl0(c.raw)}` } } }, scales: { y: TS.axisNum(fmt.brl0), x: TS.axisCat } },
    }))));

    // tabela mês a mês (12 meses)
    const ult12all = meses.slice(-12).map(comoMes);
    // celular (LMOB-05): 3 meses por vez, com ‹ › (12 colunas rolavam de lado)
    const off = MOB ? Math.min(Math.max(0, state.dreMesOff || 0), Math.max(0, ult12all.length - 3)) : 0;
    const ult12 = MOB ? ult12all.slice(Math.max(0, ult12all.length - 3 - off), ult12all.length - off) : ult12all;
    const navMes = !MOB ? null : h('div', { class: 'dre-nav' },
      h('button', { type: 'button', class: 'escm-seta', 'aria-label': 'Meses anteriores', disabled: off >= ult12all.length - 3 || null, onclick: () => { state.dreMesOff = off + 3; TS.render(); } }, '‹'),
      h('b', null, ult12.length ? `${TS.ymLabel(ult12[0].ym)} a ${TS.ymLabel(ult12[ult12.length - 1].ym)}` : ''),
      h('button', { type: 'button', class: 'escm-seta', 'aria-label': 'Meses seguintes', disabled: off <= 0 || null, onclick: () => { state.dreMesOff = Math.max(0, off - 3); TS.render(); } }, '›'));
    const t2 = h('table', { class: 't dre-t' + (MOB ? ' dre-mob' : '') });
    t2.append(h('thead', null, h('tr', null, h('th', { class: 'l sticky-col' }, ''), ult12.map((x) => h('th', { class: x.projecao ? 'dre-proj' : null }, TS.ymLabel(x.ym) + (x.projecao ? '*' : ''))))));
    const b2 = h('tbody');
    for (const [rot, f, tipo, dica, gid, fx, cc] of linhas) if (tipo === 'secao') b2.append(h('tr', { class: 'dre-secao', title: dica }, h('td', { class: 'l sticky-col' }, rot), ult12.map(() => h('td')))); else b2.append(h('tr', { class: 'dre-' + tipo, title: typeof dica === 'function' ? dica(m) : dica, onclick: gid ? () => alternar(gid) : null }, h('td', { class: 'l sticky-col' }, gid ? h('span', { class: 'dre-seta' }, abertos.has(gid) ? '▾ ' : '▸ ') : null, fx ? nomeFixo(rot, () => abrir(fx, sel)) : rot),
      ult12.map((x) => { const v = f(x); return cc ? celCalc(x, cc, v == null ? '—' : fmt.brl0(v), x.projecao ? 'dre-proj' : null, abrirCalc) : fx ? celFixo(x, fx, v == null ? '—' : fmt.brl0(v), x.projecao ? 'dre-proj' : null, abrir) : h('td', { class: tipo === 'tot' && v < 0 ? 'neg' : null }, v == null ? '—' : fmt.brl0(v)); })));
    b2.append(h('tr', { class: 'dre-info' }, h('td', { class: 'l sticky-col' }, 'Resultado em % do faturamento'), ult12.map((x) => h('td', { class: x.resultado < 0 ? 'neg' : null }, pc(x.resultado, x.fat)))));
    t2.append(b2);
    corpo.append(h('div', { class: 'mt' }, TS.card('Mês a mês', '* mês em andamento: projeção no ritmo atual, com os custos fixos inteiros', DICA_EDITAR(), navMes, h('div', { class: 'table-wrap' }, t2))));
    // compras × vendas do mês: estou comprando mais do que vendo? (comprasvendas.js)
    if (TS.comprasVendas) corpo.append(TS.comprasVendas.cartaoResultado(M));
  }

  // ---------- valor real de cada custo fixo por mês (pedido do dono, 23/11/2026; DRE-MES) ----------
  const quando = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };
  const COMO_FIXO = 'O valor de Configurações é o PADRÃO (a estimativa de todo mês). Clique no valor de um mês, digite o novo valor e escolha onde ele vale: só naquele mês (o valor REAL, a conta de luz que chegou — fica marcado com ✎), daquele mês em diante (a mensalidade aumentou: os meses antes continuam como estavam) ou em todos os meses (o padrão estava errado). O valor entra no Resultado, na Rentabilidade, no A pagar, no ponto de equilíbrio e na planilha do contador.\n\nMudar o padrão direto em Configurações muda todos os meses SEM valor lançado e sem padrão antigo guardado — inclusive os que já passaram; os meses com valor lançado ficam como estão. "Voltar ao padrão" apaga o valor lançado daquele mês.\n\nO histórico usa o nome do custo: se renomear o custo em Configurações, os valores lançados com o nome antigo deixam de aparecer.';
  /** nome do custo fixo na tabela: abre a janela do mês escolhido, com o histórico */
  function nomeFixo(rot, fn) {
    const b = h('span', { class: 'dre-fixo-nome', role: 'button', tabindex: '0', title: 'Ver o histórico deste custo mês a mês', onclick: (e) => { e.stopPropagation(); fn(); } }, rot);
    return TS.teclado(b, fn);
  }
  /** célula do valor de um custo fixo num mês: ✎ quando o mês tem valor lançado; clicar abre a janela para lançar */
  function celFixo(x, nome, texto, cls, abrir) {
    const f = x && x.fixosMes.find((y) => !y.pontual && y.nome === nome);
    if (!f) return h('td', { class: cls }, texto);
    const l = f.lancado;
    const dica = l ? `Valor real de ${TS.ymLabel(x.ym)}${l.por ? `, lançado por ${l.por}` : ''}${l.em ? ` em ${quando(l.em)}` : ''}. Padrão de Configurações: ${fmt.brl(f.padrao)}. Clique para mudar ou voltar ao padrão.`
      : `Padrão de Configurações (${fmt.brl(f.padrao)}). Clique para lançar o valor real de ${TS.ymLabel(x.ym)}.`;
    const ir = () => abrir(nome, x.ym);
    const td = h('td', { class: ['dre-edit', l ? 'dre-lanc' : null, cls].filter(Boolean).join(' '), title: dica, role: 'button', tabindex: '0', 'data-fixo': nome, 'data-ym': x.ym, onclick: (e) => { e.stopPropagation(); ir(); } },
      l ? h('span', { class: 'dre-lanc-ico', 'aria-label': 'valor lançado' }, '✎ ') : null, texto);
    return TS.teclado(td, ir);
  }
  /** onde se lança o valor real do mês (pedido do dono: "onde edito o mês?") — uma linha discreta embaixo do título */
  const DICA_EDITAR = () => h('p', { class: 'muted dre-dica-edit' }, '✎ Para lançar o valor real de um mês, clique no valor: Simples, maquininha, royalties, marketing ou um custo fixo (abra a categoria ▸ para ver os custos).');
  /** célula de uma linha calculada (Simples, maquininha, royalties, marketing) num mês: ✎ quando lançado; clicar abre a janela.
   *  ymReal: na coluna da projeção, o mês é o do próprio mês em andamento */
  function celCalc(x, k, texto, cls, abrir, ymReal) {
    const ym = ymReal || x.ym, l = x.lanc && x.lanc[k];
    const calc = CALC[k][1](x);
    const dica = l ? `Valor real de ${TS.ymLabel(ym)}${l.por ? `, lançado por ${l.por}` : ''}${l.em ? ` em ${quando(l.em)}` : ''}. Calculado pelo %: ${fmt.brl(calc)}. Clique para mudar ou voltar ao calculado.`
      : `Calculado pelo % das regras da loja. Clique para lançar o valor real de ${TS.ymLabel(ym)} (DAS, extrato, boleto).`;
    const ir = () => abrir(k, ym);
    const td = h('td', { class: ['dre-edit', l ? 'dre-lanc' : null, cls].filter(Boolean).join(' '), title: dica, role: 'button', tabindex: '0', 'data-calc': k, 'data-ym': ym, onclick: (e) => { e.stopPropagation(); ir(); } },
      l ? h('span', { class: 'dre-lanc-ico', 'aria-label': 'valor lançado' }, '✎ ') : null, texto);
    return TS.teclado(td, ir);
  }
  /** janela de uma linha calculada: o valor real do mês, "Voltar ao calculado" e o histórico (lançado × calculado) */
  function janelaCalc(M, meses, k, ym) {
    const [nome, calcDe] = CALC[k];
    const mm = meses.find((x) => x.ym === ym);
    const l = mm && mm.lanc && mm.lanc[k];
    const calc = mm ? calcDe(mm) : null;
    const fundo = h('div', { class: 'cp-modal-bg' });
    const sair = () => fundo.remove();
    const campo = h('input', { class: 'f-input dre-fixo-campo', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: l ? String(l.valor).replace('.', ',') : '', placeholder: calc == null ? '' : fmt.brl(calc), 'aria-label': `Valor real de ${nome} em ${TS.ymLabel(ym)} (R$)` });
    const botoes = [];
    const fazer = async (valor) => {
      botoes.forEach((b) => { b.disabled = true; });
      try { await salvarFixo(M, '@' + k, ym, valor); sair(); TS.render(); }
      catch (e) { botoes.forEach((b) => { b.disabled = false; }); TS.naoSalvo(e, valor == null ? null : campo); }
    };
    const salvar = () => {
      const v = lerValor(campo.value);
      if (!(v >= 0) || v > 10000000) { TS.naoSalvo('Digite o valor do mês em reais (zero ou mais), por exemplo 4.978,90.', campo); return; }
      fazer(Math.round(v * 100) / 100);
    };
    campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); salvar(); } });
    const bSalvar = h('button', { type: 'button', class: 'btn primary', onclick: salvar }, 'Salvar');
    const bVoltar = l ? h('button', { type: 'button', class: 'btn ghost-danger', onclick: () => fazer(null) }, 'Voltar ao calculado') : null;
    const bCancelar = h('button', { type: 'button', class: 'btn', onclick: sair }, 'Cancelar');
    botoes.push(bSalvar, bCancelar); if (bVoltar) botoes.push(bVoltar);
    const hist = meses.slice(-12).map((x) => ({ ym: x.ym, parcial: x.parcial, calc: calcDe(x), l: x.lanc && x.lanc[k] }));
    const tab = h('table', { class: 't dre-hist' },
      h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Mês'), h('th', { title: 'Pelo % das regras da loja' }, 'Calculado'), h('th', { title: 'O valor real lançado (DAS, extrato, boleto)' }, 'Lançado'), h('th', { title: 'Lançado − calculado' }, 'Diferença'))),
      h('tbody', null, hist.map((it) => h('tr', { class: it.ym === ym ? 'dre-hist-sel' : null },
        h('td', { class: 'l' }, TS.ymLabel(it.ym), it.parcial ? h('small', { class: 'muted' }, ' (até hoje)') : null), h('td', null, it.calc == null ? '—' : fmt.brl(it.calc)), h('td', null, it.l ? fmt.brl(it.l.valor) : h('span', { class: 'muted' }, '—')),
        h('td', { class: it.l && it.calc != null && Math.abs(it.l.valor - it.calc) >= 0.01 ? (it.l.valor > it.calc ? 'neg' : 'pos') : 'muted' }, it.l && it.calc != null ? fmt.brl(it.l.valor - it.calc) : '—')))));
    fundo.addEventListener('click', (e) => { if (e.target === fundo) sair(); });
    fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') sair(); });
    fundo.append(h('div', { class: 'card cp-copiar ts-perg dre-fixo-jan', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${nome} · ${TS.ymLabel(ym)}` },
      h('h3', null, `${nome} · ${TS.ymLabel(ym)} `, TS.dica('O Resultado calcula esta linha pelo % das regras da loja. Lance o valor REAL do mês (o DAS do Simples, o extrato da maquininha, o boleto de royalties e marketing): ele substitui o calculado só naquele mês, fica marcado com ✎ e entra no Resultado e na planilha do contador. Nos royalties, o boleto lançado já vem com os descontos da franquia. "Voltar ao calculado" apaga o valor lançado.')),
      h('div', { class: 'muted' }, l ? `Valor real lançado: ${fmt.brl(l.valor)}${l.por ? `, por ${l.por}` : ''}${l.em ? ` em ${quando(l.em)}` : ''}. Calculado pelo %: ${calc == null ? '—' : fmt.brl(calc)}.` : `Sem valor lançado: o mês usa o calculado pelo % (${calc == null ? '—' : fmt.brl(calc)}).`),
      h('label', { class: 'ts-perg-campo' }, h('span', { class: 'f-label' }, `Valor real de ${TS.ymLabel(ym)} (R$)`), campo),
      h('div', { class: 'ts-perg-acoes' }, bVoltar, bCancelar, bSalvar),
      h('div', { class: 'dre-hist-tit' }, h('b', null, 'Histórico: calculado × lançado')),
      h('div', { class: 'table-wrap free' }, tab)));
    document.body.append(fundo);
    campo.focus();
  }
  /** grava (ou volta ao padrão, valor null) e troca na memória; na apresentação nada é gravado.
   *  escopo (FIXO-ESC-01): 'mes' só o mês · 'diante' daquele mês em diante · 'todos' todos os meses */
  async function salvarFixo(M, nome, ym, valor, escopo = 'mes') {
    const corpo = valor == null ? { loja: state.loja, nome, ym, padrao: true } : { loja: state.loja, nome, ym, valor, escopo };
    const r = await fetch(TS.api('resultado/fixo-mes'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não consegui gravar.');
    let novo = j.fixosMes, padrao = j.padrao;
    if (!novo) { // apresentação: só nesta página, com a mesma conta do servidor
      const x = (M.ded.OUTROS || []).find((o) => o.tipo === 'mes' && o.nome === nome);
      if (valor == null) { novo = JSON.parse(JSON.stringify(M.ded.LANC || {})); if (novo[nome]) delete novo[nome][ym]; }
      else {
        const a = TS.contas.aplicarFixo(x || { nome, valor: 0 }, M.ded.LANC || {}, ym, valor, escopo);
        novo = a.lancados;
        if (escopo === 'mes') novo[nome][ym] = { valor, por: (TS.eu && TS.eu.nome) || '', em: new Date().toISOString() };
        else padrao = a.padrao;
      }
    }
    if (TS.estoqueFixosMes) TS.estoqueFixosMes(state.loja, novo, padrao != null ? { nome, valor: padrao } : null);
  }
  /** "1.234,56", "380", "R$ 412,5" → número; vazio ou inválido → NaN */
  const lerValor = (t) => {
    let s = String(t || '').replace(/R\$|\s/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    return /^\d+(\.\d+)?$/.test(s) ? +s : NaN;
  };
  /** janela de um custo fixo: o valor real do mês (campo + Salvar, sem gravar a cada dígito), voltar ao padrão e o histórico */
  function janelaFixo(M, meses, nome, ym) {
    const x = (M.ded.OUTROS || []).find((o) => o.tipo === 'mes' && o.nome === nome);
    if (!x) return;
    const atual = TS.contas.fixoDoMes(x, ym, M.ded.LANC);
    const yms = [...new Set([...meses.slice(-12).map((mm) => mm.ym), ym])].sort();
    const hist = TS.contas.historicoFixo(x, yms, M.ded.LANC);
    const fundo = h('div', { class: 'cp-modal-bg' });
    const sair = () => fundo.remove();
    const campo = h('input', { class: 'f-input dre-fixo-campo', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: atual.lancado ? String(atual.valor).replace('.', ',') : '', placeholder: fmt.brl(atual.padrao), 'aria-label': `Novo valor de ${nome} (R$)` });
    const botoes = [];
    const ocupado = (sim) => botoes.forEach((b) => { b.disabled = sim; });
    const fazer = async (valor, escopo) => {
      ocupado(true);
      try { await salvarFixo(M, nome, ym, valor, escopo); sair(); TS.render(); }
      catch (e) { ocupado(false); TS.naoSalvo(e, valor == null ? null : campo); }
    };
    // onde o novo valor vale (pedido do dono, 25/11/2026; FIXO-ESC-01): a pessoa escolhe sempre, nada vem marcado
    const mesTxt = TS.ymLabel(ym);
    const ESC = [
      ['mes', `Só ${mesTxt}`, 'O valor real deste mês (a conta que chegou). Os outros meses não mudam.'],
      ['diante', `De ${mesTxt} em diante`, `O padrão passa a ser este valor a partir de ${mesTxt} (ex.: a mensalidade aumentou). Os meses antes continuam como estão.`],
      ['todos', 'Todos os meses', 'O padrão passa a ser este valor em todos os meses, inclusive os passados (ex.: o valor cadastrado estava errado).'],
    ];
    let escopo = null;
    const radios = ESC.map(([v, rot, dica]) => {
      const r = h('input', { type: 'radio', name: 'dre-fixo-esc', value: v, onchange: () => { escopo = v; previa(); } });
      return h('label', { class: 'dre-esc-op' }, r, h('span', null, h('b', null, rot), h('small', { class: 'muted' }, dica)));
    });
    const previaEl = h('div', { class: 'dre-esc-previa muted', 'aria-live': 'polite' });
    const linhasHist = new Map();
    function previa() {
      const v = lerValor(campo.value);
      for (const [m, tr] of linhasHist) { tr.classList.remove('dre-hist-muda'); tr.querySelector('.dre-hist-novo').textContent = ''; }
      if (!escopo || !(v >= 0)) { previaEl.textContent = escopo ? 'Digite o valor para ver os meses que mudam.' : ''; return; }
      const a = TS.contas.aplicarFixo(x, M.ded.LANC || {}, ym, Math.round(v * 100) / 100, escopo, [...linhasHist.keys()]);
      for (const m of a.mudam) { const tr = linhasHist.get(m); tr.classList.add('dre-hist-muda'); tr.querySelector('.dre-hist-novo').textContent = `→ ${fmt.brl(v)}`; }
      const lanc = escopo === 'mes' ? 0 : hist.itens.filter((it) => it.lancado && (escopo === 'todos' || it.ym >= ym)).length;
      previaEl.textContent = (a.mudam.length ? `Mudam ${a.mudam.length} ${a.mudam.length === 1 ? 'mês' : 'meses'} do histórico abaixo${escopo === 'mes' ? '' : ' (e os próximos)'}.` : 'Nenhum mês do histórico muda.')
        + (lanc ? ` ${lanc === 1 ? 'O mês com valor lançado (✎) também passa' : `Os ${lanc} meses com valor lançado (✎) também passam`} a este valor.` : '');
    }
    campo.addEventListener('input', previa);
    const salvar = () => {
      const v = lerValor(campo.value);
      if (!(v >= 0) || v > 10000000) { TS.naoSalvo('Digite o valor do mês em reais (zero ou mais), por exemplo 412,50.', campo); return; }
      if (!escopo) { TS.naoSalvo('Escolha onde o novo valor vale: só este mês, deste mês em diante ou todos os meses.', radios[0].querySelector('input')); return; }
      fazer(Math.round(v * 100) / 100, escopo);
    };
    campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); salvar(); } });
    const bSalvar = h('button', { type: 'button', class: 'btn primary', onclick: salvar }, 'Salvar');
    const bPadrao = atual.lancado ? h('button', { type: 'button', class: 'btn ghost-danger', onclick: () => fazer(null) }, 'Voltar ao padrão') : null;
    const bCancelar = h('button', { type: 'button', class: 'btn', onclick: sair }, 'Cancelar');
    botoes.push(bSalvar, bCancelar); if (bPadrao) botoes.push(bPadrao);
    const l = atual.lancado;
    const tab = h('table', { class: 't dre-hist' },
      h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Mês'), h('th', null, 'Valor'), h('th', { class: 'l', title: '✎ lançado = o valor real lançado no Resultado; padrão = o valor de Configurações (muda junto quando o padrão muda)' }, 'Origem'))),
      h('tbody', null, hist.itens.map((it) => { const ep = TS.contas.fixoDoMes(x, it.ym, M.ded.LANC).epoca; const tr = h('tr', { class: it.ym === ym ? 'dre-hist-sel' : null, title: it.lancado ? `Lançado${it.lancado.por ? ` por ${it.lancado.por}` : ''}${it.lancado.em ? ` em ${quando(it.lancado.em)}` : ''}` : ep ? `O padrão que valia até ${TS.ymLabel(ep.ate)} (depois mudou)` : null },
        h('td', { class: 'l' }, TS.ymLabel(it.ym)), h('td', null, fmt.brl(it.valor), h('small', { class: 'dre-hist-novo' })), h('td', { class: 'l' }, it.lancado ? h('span', { class: 'badge ok' }, '✎ lançado') : h('span', { class: 'muted' }, ep ? 'padrão da época' : 'padrão'))); linhasHist.set(it.ym, tr); return tr; })),
      h('tfoot', null, h('tr', null, h('td', { class: 'l' }, h('b', null, 'Média')), h('td', null, h('b', null, fmt.brl(hist.media))), h('td', { class: 'l muted' }, `${hist.nLancados} de ${hist.itens.length} lançados`))));
    const resumo = `${nome}: ${hist.itens.map((it) => `${TS.ymLabel(it.ym)} ${fmt.brl0(it.valor)}${it.lancado ? ' ✎' : ''}`).join(' · ')} · média ${fmt.brl0(hist.media)}`;
    fundo.addEventListener('click', (e) => { if (e.target === fundo) sair(); });
    fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') sair(); });
    fundo.append(h('div', { class: 'card cp-copiar ts-perg dre-fixo-jan', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${nome} · ${TS.ymLabel(ym)}` },
      h('h3', null, `${nome} · ${TS.ymLabel(ym)} `, TS.dica(COMO_FIXO)),
      h('div', { class: 'muted' }, l ? `Valor real lançado: ${fmt.brl(l.valor)}${l.por ? `, por ${l.por}` : ''}${l.em ? ` em ${quando(l.em)}` : ''}. Padrão de Configurações: ${fmt.brl(atual.padrao)}.` : `Sem valor lançado: o mês usa o padrão de Configurações (${fmt.brl(atual.padrao)}).`),
      h('label', { class: 'ts-perg-campo' }, h('span', { class: 'f-label' }, `Novo valor (R$)`), campo),
      h('fieldset', { class: 'dre-esc' }, h('legend', { class: 'f-label' }, 'Onde este valor vale? ', TS.dica('Só o mês: o valor real daquele mês (fica marcado ✎). Deste mês em diante: muda o padrão de Configurações a partir do mês e guarda o padrão antigo nos meses de antes. Todos os meses: muda o padrão em todos os meses, inclusive os passados. Os meses que vão mudar ficam marcados no histórico.')), ...radios, previaEl),
      h('div', { class: 'ts-perg-acoes' }, bPadrao, bCancelar, bSalvar),
      h('div', { class: 'dre-hist-tit' }, h('b', null, 'Histórico '), TS.dica(resumo)),
      h('div', { class: 'table-wrap free' }, tab)));
    document.body.append(fundo);
    campo.focus();
  }
})();
