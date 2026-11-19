/* Clientes → Indicadores → Fidelidade: retorno do programa — quem resgata volta e gasta mais?
 * Usa só o que o painel já tem: movimentos do FIXE, cupons identificados (CPF na nota ou ligados pelo FIXE) e o custo do estoque.
 * Só chega a quem recebe dados de clientes (o servidor não manda cupons com CPF nem o FIXE para os outros perfis); o custo dos
 * prêmios só aparece para quem vê custo. Tudo agregado: nenhum CPF é listado aqui.
 * As contas ficam no começo do arquivo, sem depender da tela (testadas em tests/unit/fidretorno.test.js). */
'use strict';
(function () {
  // ======================= contas =======================
  const MIN_GRUPO = 20; // grupo com menos clientes que isso não vira número (oscila demais)
  const div = (a, b) => (b > 0 ? a / b : null);

  /** compras do cliente entre dois dias (inclusive): { n, vt } */
  function janela(compras, de, ate) {
    let n = 0, vt = 0;
    for (const k of compras || []) if (k.day >= de && k.day <= ate) { n++; vt += k.vt || 0; }
    return { n, vt };
  }

  /** resumo de um grupo: lista com { n, vt } de cada cliente na janela. Menos de MIN_GRUPO clientes → sem médias (pouco: true) */
  function resumo(lista, min = MIN_GRUPO) {
    const clientes = lista.length;
    const compras = lista.reduce((s, x) => s + x.n, 0), gasto = lista.reduce((s, x) => s + x.vt, 0);
    const base = { clientes, compras, gasto, pouco: clientes < min };
    if (base.pouco) return { ...base, comprasPorCliente: null, ticket: null, gastoPorCliente: null, voltaram: null };
    return { ...base, comprasPorCliente: compras / clientes, ticket: div(gasto, compras), gastoPorCliente: gasto / clientes, voltaram: lista.filter((x) => x.n > 0).length / clientes };
  }

  /**
   * Clientes do programa × fora do programa, nos últimos `dias` dias até `fim`.
   * clientes: [{ membro, compras: [{ day, vt }] }] — só entra quem comprou na janela.
   */
  function programa(clientes, fim, dias = 365, min = MIN_GRUPO) {
    const dentro = [], fora = [];
    for (const c of clientes || []) {
      const j = janela(c.compras, fim - dias + 1, fim);
      if (!j.n) continue;
      (c.membro ? dentro : fora).push(j);
    }
    return { dentro: resumo(dentro, min), fora: resumo(fora, min), dias };
  }

  /**
   * Quem resgatou × quem não resgatou, nos `jan` dias seguintes.
   * ciclos: [{ cpf, E (dia em que chegou ao mínimo), res: 'sim'|'nao'|'aberto', dias }] — vale o primeiro ciclo encerrado de cada cliente.
   * Resgatou: conta a partir do dia seguinte ao resgate. Não resgatou: a partir do dia seguinte ao que chegou ao mínimo.
   * Só entra quem já tem a janela inteira dentro dos dados (até `fim`).
   */
  function resgatou(ciclos, comprasDe, fim, jan = 90, min = MIN_GRUPO) {
    const vistos = new Set(), sim = [], nao = [];
    let semJanela = 0;
    for (const c of (ciclos || []).slice().sort((a, b) => a.E - b.E)) {
      if ((c.res !== 'sim' && c.res !== 'nao') || vistos.has(c.cpf)) continue;
      vistos.add(c.cpf);
      const ancora = c.res === 'sim' ? c.E + (c.dias || 0) : c.E;
      if (ancora + jan > fim) { semJanela++; continue; }
      (c.res === 'sim' ? sim : nao).push(janela(comprasDe(c.cpf), ancora + 1, ancora + jan));
    }
    return { sim: resumo(sim, min), nao: resumo(nao, min), semJanela, jan };
  }

  /**
   * O mesmo cliente antes × depois do primeiro resgate: `jan` dias antes e `jan` dias depois (o dia do resgate fica fora dos dois).
   * primeiros: Map(cpf → dia do primeiro resgate). Só entra quem tem as duas janelas inteiras nos dados (de `ini` a `fim`).
   * adicional = soma (gasto depois − gasto antes) desses clientes: estimativa, não prova.
   */
  function antesDepois(primeiros, comprasDe, ini, fim, jan = 90, min = MIN_GRUPO) {
    const antes = [], depois = [];
    let semJanela = 0, de = null, ate = null;
    for (const [cpf, day] of primeiros || []) {
      if (day - jan < ini || day + jan > fim) { semJanela++; continue; }
      const cs = comprasDe(cpf);
      antes.push(janela(cs, day - jan, day - 1));
      depois.push(janela(cs, day + 1, day + jan));
      if (de == null || day < de) de = day;
      if (ate == null || day > ate) ate = day;
    }
    const a = resumo(antes, min), d = resumo(depois, min);
    return { antes: a, depois: d, clientes: antes.length, semJanela, jan, de, ate, adicional: a.pouco ? null : d.gasto - a.gasto, variacao: a.pouco || !(a.gasto > 0) ? null : d.gasto / a.gasto - 1 };
  }

  /**
   * Custo dos prêmios × venda adicional estimada. custoTotal e resgates são da loja no mesmo intervalo dos primeiros resgates
   * analisados: custo médio por resgate × clientes analisados (um resgate de cada: o primeiro).
   */
  function retorno(ad, custoTotal, resgates) {
    if (!ad || ad.adicional == null || custoTotal == null || !(resgates > 0)) return { custoMedio: null, custo: null, adicional: ad ? ad.adicional : null, saldo: null, porReal: null };
    const custoMedio = custoTotal / resgates, custo = custoMedio * ad.clientes;
    return { custoMedio, custo, adicional: ad.adicional, saldo: ad.adicional - custo, porReal: custo > 0 ? ad.adicional / custo : null };
  }

  const CALC = { MIN_GRUPO, janela, resumo, programa, resgatou, antesDepois, retorno };
  if (typeof module !== 'undefined' && module.exports) { module.exports = CALC; return; }

  // ======================= tela =======================
  const { h, fmt, state } = TS;
  const vezes = (v) => (v == null || !isFinite(v) ? '—' : `${fmt.n1(v)}×`);

  /** cartão "Retorno do programa" da seção Fidelidade (Clientes → Indicadores). fx = TS.cli.fixe */
  TS.cartaoRetornoFid = function (fx) {
    if (!fx || !fx.movs || !fx.movs.length || !TS.cli || !TS.cli.porCPF) return null;
    if (!(TS.eu && TS.eu.pode && TS.eu.pode.clientes)) return null;
    const db = TS.db;
    const rg = ((fx.bases || []).find((b) => b.ev && b.ev.length) || {}).regras || {};
    const min = rg.minResgate || 6, prazo = rg.prazoResgate || 90, JAN = 90;
    const fim = Math.min(db.maxDay, fx.logsAte ?? db.maxDay);
    // compras identificadas de cada cliente (cupom só com o prêmio, abaixo de R$ 1, não é compra)
    const compras = new Map(), clientes = [];
    let ini = null;
    for (const c of TS.cli.porCPF.values()) {
      if (c.empresa) continue;
      const cs = (c.cupons || []).filter((k) => k.day != null && k.vt >= 1).map((k) => ({ day: k.day, vt: k.vt }));
      if (!cs.length) continue;
      compras.set(c.cpf, cs);
      clientes.push({ membro: !!c.membroFixe, compras: cs });
      for (const k of cs) if (ini == null || k.day < ini) ini = k.day;
    }
    if (ini == null) return null;
    const comprasDe = (cpf) => compras.get(cpf) || [];
    const P = programa(clientes, fim, 365);
    const RS = resgatou(TS.fx.resgates(fx.movs, { min, prazo, ate: fx.logsAte ?? TS.todayDay() }).filter((c) => compras.has(c.cpf)), comprasDe, fim, JAN);
    // primeiro resgate de cada cliente nesta loja (o prêmio dado em outra loja da rede não é custo daqui)
    const primeiros = new Map();
    const diasResgate = [];
    for (const m of fx.movs) {
      if (m.anulado || m.tipo !== 'resgate' || !m.propria) continue;
      diasResgate.push(m.day);
      if (!compras.has(m.cpf)) continue;
      if (!primeiros.has(m.cpf) || m.day < primeiros.get(m.cpf)) primeiros.set(m.cpf, m.day);
    }
    const AD = antesDepois(primeiros, comprasDe, ini, fim, JAN);

    const vis = ['programa', 'resgate', 'antesdepois'].includes(state.fidRetVis) ? state.fidRetVis : 'programa';
    const ir = (v) => { state.fidRetVis = v; TS.render(); };
    const kpi = (el, v) => {
      el.classList.add('est-kpi-click'); el.setAttribute('role', 'button'); el.tabIndex = 0;
      el.addEventListener('click', (e) => { if (!(e.target.closest && e.target.closest('.dica-i'))) ir(v); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(v); } });
      return el;
    };
    const pouco = (n) => `menos de ${MIN_GRUPO} clientes (${fmt.int(n)}): pouco para comparar`;
    const razaoProg = P.dentro.pouco || P.fora.pouco || !(P.fora.gastoPorCliente > 0) ? null : P.dentro.gastoPorCliente / P.fora.gastoPorCliente;
    const custoVal = h('span', null, '…'), custoPe = h('span', null, 'calculando o custo dos prêmios');
    const linhaCusto = h('li', null, h('b', null, 'Prêmios × venda a mais: '), 'calculando…');
    const quadros = h('div', { class: 'grid g-kpi' },
      kpi(TS.kpi('Cliente do programa gasta', vezes(razaoProg), razaoProg == null ? pouco(Math.min(P.dentro.clientes, P.fora.clientes)) : `${fmt.brl0(P.dentro.gastoPorCliente)} × ${fmt.brl0(P.fora.gastoPorCliente)} por cliente em 12 meses`,
        'Gasto médio em 12 meses de quem está no programa ÷ o de quem deu o CPF mas não está no programa. Maior que 1 = o cliente do programa gasta mais. Não prova que é o programa: cliente frequente entra mais no programa.'), 'programa'),
      kpi(TS.kpi(`Quem resgatou voltou em ${JAN} dias`, RS.sim.pouco ? '—' : fmt.pct(RS.sim.voltaram, 0), RS.sim.pouco ? pouco(RS.sim.clientes) : RS.nao.pouco ? 'sem grupo de comparação suficiente' : `contra ${fmt.pct(RS.nao.voltaram, 0)} de quem não resgatou`,
        `Dos clientes que resgataram, quantos compraram de novo nos ${JAN} dias depois do resgate; comparado com quem chegou a ${min} pontos e não resgatou (nos ${JAN} dias depois de chegar ao mínimo).`), 'resgate'),
      kpi(TS.kpi('Gasto depois do 1º resgate', AD.variacao == null ? '—' : fmt.delta(AD.variacao), AD.antes.pouco ? pouco(AD.clientes) : `${fmt.brl0(AD.antes.gastoPorCliente)} → ${fmt.brl0(AD.depois.gastoPorCliente)} por cliente (${fmt.int(AD.clientes)} clientes)`,
        `O mesmo cliente: gasto nos ${JAN} dias antes × nos ${JAN} dias depois do primeiro resgate. Negativo é comum: antes do resgate o cliente estava juntando pontos (comprando mais que o normal).`), 'antesdepois'),
      kpi(TS.kpi('Prêmios × venda a mais', custoVal, custoPe,
        'Custo dos prêmios dos primeiros resgates analisados × a venda a mais (ou a menos) desses clientes nos 90 dias seguintes. Estimativa: é correlação, não prova. O custo só aparece para quem vê custo.'), 'antesdepois'));

    const G = { programa: [['No programa de fidelidade', P.dentro, 'ok'], ['Fora do programa (deu o CPF na nota)', P.fora, 'cinza']],
      resgate: [['Resgatou', RS.sim, 'ok'], [`Não resgatou em ${prazo} dias`, RS.nao, 'cinza']],
      antesdepois: [[`${JAN} dias antes do 1º resgate`, AD.antes, 'cinza'], [`${JAN} dias depois do 1º resgate`, AD.depois, 'ok']] }[vis];
    const janTxt = vis === 'programa' ? 'nos últimos 12 meses' : `na janela de ${JAN} dias`;
    const tab = TS.table({
      cols: [
        { key: 'ord', label: 'Grupo', align: 'l', sticky: true, wrap: true, render: (r) => h('div', null, h('b', null, r.rot), r.pouco ? h('small', { class: 'muted', style: { display: 'block' } }, pouco(r.clientes)) : null), csv: (r) => r.rot },
        { key: 'clientes', label: 'Clientes', fmt: fmt.int, title: 'Quantos clientes entram no grupo. Cada cliente conta uma vez.' },
        { key: 'comprasPorCliente', label: 'Compras por cliente', fmt: fmt.n2, title: `Frequência: compras identificadas ${janTxt} ÷ clientes do grupo.` },
        { key: 'ticket', label: 'Ticket médio', fmt: fmt.brl, title: 'Gasto ÷ número de compras do grupo.' },
        { key: 'gastoPorCliente', label: 'Gasto por cliente', fmt: fmt.brl, title: `Tudo o que o grupo gastou ${janTxt} ÷ clientes do grupo (quem não comprou conta como zero).` },
        ...(vis === 'programa' ? [] : [{ key: 'voltaram', label: 'Compraram na janela', fmt: (v) => fmt.pct(v, 0), title: `Parte dos clientes do grupo com pelo menos uma compra ${janTxt}.` }]),
      ],
      rows: G.map(([rot, r], k) => ({ ord: k, rot, ...r })), sortKey: 'ord', sortDir: 'asc', maxHeight: 'free', cartao: true,
      empty: 'Sem clientes para comparar.',
    });
    const seg = TS.seg([[`Programa × fora (${fmt.int(P.dentro.clientes + P.fora.clientes)})`, 'programa'], [`Resgatou × não resgatou (${fmt.int(RS.sim.clientes + RS.nao.clientes)})`, 'resgate'], [`Antes × depois do 1º resgate (${fmt.int(AD.clientes)})`, 'antesdepois']], vis, ir);
    const frase = { programa: 'Quem está no programa compra mais vezes e gasta mais que os outros clientes identificados?',
      resgate: `Depois do prêmio, o cliente volta? Compara quem resgatou com quem chegou a ${min} pontos e deixou passar.`,
      antesdepois: 'A comparação mais justa: o mesmo cliente, antes e depois do primeiro prêmio.' }[vis];
    const conta = h('details', { class: 'rs-conta' }, h('summary', null, 'Como a conta é feita e o que ela não prova'),
      h('ul', null,
        h('li', null, h('b', null, 'É correlação, não prova. '), 'Quem resgata já é cliente frequente: ele gastaria mais que a média mesmo sem o prêmio. Por isso a comparação "antes × depois" do mesmo cliente pesa mais que as outras duas.'),
        h('li', null, h('b', null, 'Compras: '), 'só as identificadas (CPF na nota ou ligadas pelo FIXE), desta loja, acima de R$ 1. Compra sem CPF não aparece; a do cliente do programa é identificada mais vezes (o FIXE ajuda), o que favorece um pouco o grupo do programa.'),
        h('li', null, h('b', null, 'Programa × fora: '), `clientes com compra nos últimos 12 meses (até ${fmt.date(TS.dayToIso(fim))}); no programa = está na base do FIXE.`),
        h('li', null, h('b', null, 'Resgatou × não resgatou: '), `primeira vez que o cliente chegou a ${fmt.int(min)} pontos. Resgatou: os ${JAN} dias depois do resgate. Não resgatou em ${fmt.int(prazo)} dias: os ${JAN} dias depois de chegar ao mínimo. ${fmt.int(RS.semJanela)} clientes ainda sem os ${JAN} dias completos ficaram fora.`),
        h('li', null, h('b', null, 'Antes × depois: '), `primeiro resgate de cada cliente nesta loja; ${JAN} dias antes × ${JAN} dias depois, sem o dia do resgate. ${fmt.int(AD.semJanela)} clientes sem as duas janelas completas nos dados ficaram fora. Antes do resgate o cliente estava juntando pontos, então uma queda depois é esperada.`),
        linhaCusto,
        h('li', null, `Grupo com menos de ${MIN_GRUPO} clientes fica em "—": com tão pouca gente o número muda a cada compra. Não segue o período dos filtros: usa todo o histórico.`)));
    const card = TS.cardWithTools('Retorno do programa: quem resgata volta e gasta mais?', frase, seg, tab, conta);
    card.classList.add('fx-card', 'fidret');

    // custo dos prêmios (só quem vê custo): custo médio por resgate da loja no intervalo analisado × clientes analisados
    const semCusto = (motivo) => { custoVal.textContent = '—'; custoPe.textContent = motivo; linhaCusto.replaceChildren(h('b', null, 'Prêmios × venda a mais: '), motivo + '.'); };
    const comCusto = (M) => {
      if (!M) return semCusto('o custo dos prêmios aparece para quem vê custo (Estoque e margem), com uma loja escolhida');
      if (AD.adicional == null) return semCusto(pouco(AD.clientes));
      let custo = 0, sem = 0, n = 0;
      for (let i = 0; i < db.n; i++) {
        if (db.day[i] < AD.de || db.day[i] > AD.ate || !(db.qtd[i] > 0) || !TS.ehResgate(i)) continue;
        const x = M.custo(i);
        if (x == null) sem += db.qtd[i]; else { custo += x; n += db.qtd[i]; }
      }
      const resg = diasResgate.filter((d) => d >= AD.de && d <= AD.ate).length;
      if (!n || !resg) return semCusto('sem prêmios com custo cadastrado no intervalo analisado');
      const R = retorno(AD, custo, resg);
      custoVal.textContent = fmt.brl0(R.adicional);
      custoVal.className = R.adicional >= 0 ? 'pos' : 'neg';
      custoPe.textContent = `${R.adicional >= 0 ? 'venda a mais' : 'venda a menos'} (estimativa) · prêmios custaram ${fmt.brl0(R.custo)}`;
      linhaCusto.replaceChildren(h('b', null, 'Prêmios × venda a mais: '),
        `os ${fmt.int(AD.clientes)} clientes gastaram ${fmt.brl0(AD.depois.gasto)} nos ${JAN} dias depois do primeiro resgate e ${fmt.brl0(AD.antes.gasto)} nos ${JAN} dias antes: diferença de ${fmt.brl0(R.adicional)} (a "venda a mais" estimada; negativa quando gastaram menos). `
        + `Custo dos prêmios: ${fmt.brl0(custo)} em prêmios (custo do estoque) ÷ ${fmt.int(resg)} resgates da loja entre ${fmt.date(TS.dayToIso(AD.de))} e ${fmt.date(TS.dayToIso(AD.ate))} = ${fmt.brl(R.custoMedio)} por resgate × ${fmt.int(AD.clientes)} = ${fmt.brl0(R.custo)}`
        + `${sem ? ` (${fmt.int(sem)} prêmios sem custo ficaram fora)` : ''}. Conta só o primeiro resgate de cada cliente e é venda, não lucro.`);
    };
    if (TS.custosLoja) TS.custosLoja().then(comCusto).catch(() => semCusto('não deu para ler o custo dos prêmios')); else semCusto('o custo dos prêmios aparece para quem vê custo');
    return h('div', { class: 'fidret-bloco' }, quadros, h('div', { class: 'mt' }, card));
  };
  TS.fidRetorno = CALC;
})();
