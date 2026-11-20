/* Equipe → Movimento e escala → Rendimento da equipe: venda por hora trabalhada e ficha de cada pessoa.
 * Só para a gestão (admin, franqueado e gerente com a tela): a vendedora não abre esta aba e o servidor não manda
 * para ela a escala, os nomes dos colegas, os clientes nem os custos (filtrarPorPerfil em server.js).
 * As contas ficam no começo do arquivo, sem depender da tela (testadas em tests/unit/equipe.test.js). */
'use strict';
(function () {
  // ======================= contas =======================
  const chave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const div = (a, b) => (b > 0 && a != null && isFinite(a) ? a / b : null);

  /**
   * Liga o nome da pessoa na escala ao nome dela nas vendas (AppNext): igual (sem acento/maiúsculas) ou, se não houver,
   * quando um é o começo do outro ("Lívia" ↔ "LIVIA SOUZA") e só existe um par possível. Na dúvida, não liga.
   * → Map(nome na escala → nome nas vendas)
   */
  function casarNomes(escala, venda) {
    const out = new Map(), usados = new Set();
    const es = (escala || []).map((n) => ({ n, k: chave(n) })).filter((x) => x.k);
    const vs = (venda || []).map((n) => ({ n, k: chave(n) })).filter((x) => x.k);
    for (const e of es) {
      const v = vs.find((x) => x.k === e.k && !usados.has(x.n));
      if (v) { out.set(e.n, v.n); usados.add(v.n); }
    }
    const comeca = (a, b) => a.startsWith(b + ' ') || b.startsWith(a + ' ');
    const livresE = es.filter((e) => !out.has(e.n)), livresV = vs.filter((v) => !usados.has(v.n));
    for (const e of livresE) {
      const cands = livresV.filter((v) => comeca(v.k, e.k));
      if (cands.length !== 1) continue;
      if (livresE.some((x) => x !== e && comeca(cands[0].k, x.k))) continue; // o nome de venda serviria para duas pessoas
      out.set(e.n, cands[0].n);
    }
    return out;
  }

  /** minutos trabalhados do turno (sem o intervalo) */
  const liquido = (t) => Math.max(0, (t.fim - t.ini) - (t.pausa ? Math.max(0, t.pausa[1] - t.pausa[0]) : 0));
  /** minutos trabalhados do turno dentro da faixa [a, b) do dia (sem o intervalo) */
  function minutosNaFaixa(t, a, b) {
    const sobra = (x0, x1) => Math.max(0, Math.min(x1, b) - Math.max(x0, a));
    return Math.max(0, sobra(t.ini, t.fim) - (t.pausa ? sobra(Math.max(t.pausa[0], t.ini), Math.min(t.pausa[1], t.fim)) : 0));
  }

  /**
   * Venda por hora trabalhada.
   *   turnos: [{ nome, day, wd, ini, fim, pausa }]  — escala (minutos do dia); nome = o nome da pessoa nas vendas
   *   cupons: [{ vend, day, wd, min, vt }]          — um por cupom e vendedor (min = minuto da venda ou null)
   * Por pessoa: todas as vendas dela ÷ horas líquidas escaladas no período (vtFora = vendido em dia sem turno na escala).
   * Por hora do dia e por dia da semana: só as vendas de quem está na escala ÷ horas de pessoa escaladas naquela faixa.
   * Sem hora escalada → null (a tela mostra "—"), nunca zero nem número inventado.
   */
  function rendimento(turnos, cupons) {
    const P = new Map();
    const pes = (n) => { let p = P.get(n); if (!p) P.set(n, (p = { nome: n, naEscala: false, min: 0, dias: new Set(), vt: 0, cupons: 0, vtFora: 0 })); return p; };
    const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, min: 0, vt: 0, cupons: 0 }));
    const dias = Array.from({ length: 7 }, (_, wd) => ({ wd, min: 0, vt: 0, cupons: 0 }));
    for (const t of turnos || []) {
      const m = liquido(t);
      const p = pes(t.nome);
      p.naEscala = true;
      if (!m) continue;
      p.min += m; p.dias.add(t.day);
      if (dias[t.wd]) dias[t.wd].min += m;
      for (let hr = Math.max(0, Math.floor(t.ini / 60)); hr < 24 && hr * 60 < t.fim; hr++) horas[hr].min += minutosNaFaixa(t, hr * 60, hr * 60 + 60);
    }
    let semHora = 0, comHora = 0;
    for (const c of cupons || []) {
      const p = pes(c.vend);
      p.vt += c.vt || 0; p.cupons++;
      if (!p.dias.has(c.day)) p.vtFora += c.vt || 0;
      if (!p.naEscala) continue;
      if (dias[c.wd]) { dias[c.wd].vt += c.vt || 0; dias[c.wd].cupons++; }
      if (c.min == null) { semHora++; continue; }
      comHora++;
      const hr = Math.min(23, Math.max(0, Math.floor(c.min / 60)));
      horas[hr].vt += c.vt || 0; horas[hr].cupons++;
    }
    const fecha = (x) => { const hTrab = x.min / 60; return { ...x, horas: hTrab, rph: div(x.vt, hTrab), cph: div(x.cupons, hTrab) }; };
    const porPessoa = [...P.values()].map((p) => ({ ...fecha(p), diasEscala: p.dias.size, dias: undefined, pctFora: p.naEscala ? div(p.vtFora, p.vt) : null }));
    const naEsc = porPessoa.filter((p) => p.naEscala);
    const total = fecha({ min: naEsc.reduce((s, p) => s + p.min, 0), vt: naEsc.reduce((s, p) => s + p.vt, 0), cupons: naEsc.reduce((s, p) => s + p.cupons, 0) });
    return { porPessoa, porHora: horas.filter((x) => x.min > 0 || x.cupons > 0).map(fecha), porDia: dias.map(fecha), total, semHora, comHora };
  }

  /**
   * Indicadores de venda de uma pessoa no período.
   *   a: { vt, qtd, desc, cupons, comCpf (null = sem acesso a clientes), custo, vtCusto (null = sem acesso a custo) }
   * desconto médio = desconto ÷ preço cheio (vendido + desconto); lucro = vendido − custo, só nas linhas que têm custo.
   */
  function indicadores(a) {
    const temCusto = a.vtCusto != null && a.custo != null;
    return {
      vendas: a.vt || 0, cupons: a.cupons || 0,
      ticket: div(a.vt, a.cupons), ipa: div(a.qtd, a.cupons),
      pctCpf: a.comCpf == null ? null : div(a.comCpf, a.cupons),
      descPct: div(a.desc || 0, (a.vt || 0) + (a.desc || 0)),
      lucro: temCusto && a.vtCusto > 0 ? a.vtCusto - a.custo : null,
      parteCusto: temCusto ? div(a.vtCusto, a.vt) : null,
    };
  }

  /**
   * Lista de espera: dos pedidos que a pessoa anotou e já tiveram desfecho (cliente avisado: comprou ou não comprou em 7 dias),
   * quantos viraram venda. Menos de 3 desfechos → taxa null (pouco dado). → Map(nome nas vendas → { comprou, fechados, taxa })
   */
  function conversaoEspera(pedidos, nomesVenda, deIso, ateIso) {
    const cont = new Map();
    for (const p of pedidos || []) {
      if (!p || !p.vendedora || (p.st !== 'comprou' && p.st !== 'naocomprou')) continue;
      const dia = String(p.fim || p.criadoEm || '').slice(0, 10);
      if ((deIso && dia < deIso) || (ateIso && dia > ateIso)) continue;
      let c = cont.get(p.vendedora); if (!c) cont.set(p.vendedora, (c = { comprou: 0, fechados: 0 }));
      c.fechados++; if (p.st === 'comprou') c.comprou++;
    }
    const par = casarNomes([...cont.keys()], nomesVenda);
    const out = new Map();
    for (const [n, c] of cont) if (par.has(n)) out.set(par.get(n), { ...c, taxa: c.fechados >= 3 ? c.comprou / c.fechados : null });
    return out;
  }

  const CALC = { chave, casarNomes, liquido, minutosNaFaixa, rendimento, indicadores, conversaoEspera };
  if (typeof module !== 'undefined' && module.exports) { module.exports = CALC; return; }

  // ======================= tela =======================
  const { h, fmt, state } = TS;
  const hTxt = (hs) => (hs > 0 ? `${fmt.int(Math.floor(hs + 1e-9))}h${Math.round((hs % 1) * 60) ? String(Math.round((hs % 1) * 60)).padStart(2, '0') : ''}` : '—');
  const ehGestao = () => !!(TS.eu && ['admin', 'franqueado', 'gerente'].includes(TS.eu.perfil));
  const SEM_VEND = /^SEM VENDEDOR$/i;

  // custo dos produtos (só quem vê custo) e lista de espera: chegam depois e redesenham a aba uma vez
  let extra = { db: null, loja: null };
  TS.aoLimparCache && TS.aoLimparCache(() => { extra = { db: null, loja: null }; });
  function extras() {
    if (extra.db === TS.db && extra.loja === state.loja) return extra;
    const meu = (extra = { db: TS.db, loja: state.loja, M: undefined, espera: undefined });
    const custos = TS.custosLoja ? TS.custosLoja().catch(() => null) : Promise.resolve(null);
    const espera = TS.esperaDados && state.loja && state.loja !== 'todas' ? TS.esperaDados(state.loja).catch(() => null) : Promise.resolve(null);
    Promise.all([custos, espera]).then(([M, e]) => {
      meu.M = M || null; meu.espera = e && Array.isArray(e.pedidos) ? e.pedidos : null;
      if (extra === meu && state.page === 'mapa' && state.mapaAba === 'rendimento') TS.render();
    });
    return extra;
  }

  /** cupons com CPF na nota: "cupom|loja|dia" (só para quem tem acesso a clientes) */
  function cuponsComCpf() {
    if (!(TS.eu && TS.eu.pode && TS.eu.pode.clientes) || !TS.db.xml || !TS.db.xml.length) return null;
    const cli = TS.garantirClientes && TS.garantirClientes();
    if (!cli || !cli.porCPF) return null;
    const s = new Set();
    for (const c of cli.porCPF.values()) for (const k of c.cupons || []) if (k.origem !== 'fixe') s.add(k.cupom + '|' + k.lojaId + '|' + k.day);
    return s;
  }

  /** soma as vendas por pessoa (sem taxas e sem prêmios de fidelidade a R$ 0,01) */
  function porVendedor(idx, M, cpfs) {
    const db = TS.db, taxas = TS.rules.ids.taxas, un = TS.descontoPorUnidade();
    const m = new Map();
    for (const i of idx) {
      if (taxas.has(db.desc[i]) || TS.ehResgate(i)) continue;
      const nome = String(db.D.vendedor[db.vend[i]] || '').trim();
      if (!nome || SEM_VEND.test(nome)) continue;
      let a = m.get(nome);
      if (!a) m.set(nome, (a = { nome, vt: 0, qtd: 0, desc: 0, cup: new Map(), custo: M ? 0 : null, vtCusto: M ? 0 : null }));
      const vt = db.vt[i] || 0;
      a.vt += vt; a.qtd += TS.qtdItem(i); a.desc += (db.du[i] || 0) * (un ? db.qtd[i] || 0 : 1);
      const k = TS.chaveCupom(i);
      let c = a.cup.get(k);
      if (!c) a.cup.set(k, (c = { vend: nome, day: db.day[i], wd: db.wd[i], min: null, vt: 0, cpf: cpfs ? cpfs.has(db.cupom[i] + '|' + db.loja[i] + '|' + db.day[i]) : null }));
      c.vt += vt;
      if (c.min == null && db.min[i] != null) c.min = db.min[i];
      if (M) { const x = M.custo(i); if (x != null) { a.custo += x; a.vtCusto += vt; } }
    }
    for (const a of m.values()) {
      a.cupons = a.cup.size;
      a.comCpf = cpfs ? [...a.cup.values()].filter((c) => c.cpf).length : null;
    }
    return m;
  }

  /** turnos da escala no período, já com o nome de venda de cada pessoa; quem não tem par fica de fora (e é avisado) */
  function turnosComNome(ctx, de, ate, soMes, nomesVenda) {
    const brutos = ctx.turnos(TS.dayToIso(de), TS.dayToIso(ate));
    const pessoas = ctx.pessoas();
    const par = casarNomes(pessoas, nomesVenda);
    const out = [];
    for (const t of brutos) {
      if (soMes && t.iso.slice(5, 7) !== soMes) continue;
      const nome = par.get(t.nome);
      if (!nome) continue;
      const day = TS.isoToDay(t.iso);
      out.push({ nome, day, wd: (new Date(day * 864e5).getUTCDay() + 6) % 7, ini: t.ini, fim: t.fim, pausa: t.pausa });
    }
    return { turnos: out, par, semPar: pessoas.filter((p) => !par.has(p)) };
  }

  const kpiClique = (el, vis) => {
    el.classList.add('est-kpi-click'); el.setAttribute('role', 'button'); el.tabIndex = 0;
    const ir = (e) => { if (e.target.closest && e.target.closest('.dica-i')) return; state.eqVis = vis; state.eqPessoa = null; TS.render(); };
    el.addEventListener('click', ir);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(e); } });
    return el;
  };
  const LIMITES = 'As horas vêm da escala do painel (regras de hoje + ajustes salvos de cada mês), não do ponto: troca de turno, falta ou hora extra que não foi lançada como ajuste não aparece.';

  function render(root, ctx) {
    if (!ehGestao()) { root.append(h('div', { class: 'notice' }, 'Esta parte é só para a gestão da loja.')); return; }
    const db = TS.db, f = state.f;
    const de = Math.max(f.de ?? db.minDay, db.minDay), ate = Math.min(f.ate ?? db.maxDay, db.maxDay);
    const soMes = f.mes && !f.ano ? String(f.mes).padStart(2, '0') : null;
    const X = extras();
    const M = X.M || null;
    const cpfs = cuponsComCpf();
    const base = TS.filtrar();
    const vend = porVendedor(base, M, cpfs);
    const nomesVenda = [...vend.keys()];
    const T = ctx.salva ? turnosComNome(ctx, de, ate, soMes, nomesVenda) : { turnos: [], par: new Map(), semPar: [] };
    const cupons = [...vend.values()].flatMap((a) => [...a.cup.values()]);
    const R = rendimento(T.turnos, cupons);
    const rPes = new Map(R.porPessoa.map((p) => [p.nome, p]));

    // ---- avisos (só o que pede ação)
    if (!ctx.salva) root.append(h('div', { class: 'notice warn' }, h('b', null, 'Sem escala lançada para esta loja. '), 'A venda por hora fica em "—" até a equipe e o horário serem salvos em ',
      h('button', { type: 'button', class: 'link-btn', onclick: () => { state.mapaAba = 'equipe'; TS.render(); } }, 'Equipe e regras ›'), ' (com o nome de cada pessoa como aparece nas vendas).'));
    else if (!T.turnos.length) root.append(h('div', { class: 'notice warn' }, h('b', null, 'Nenhuma pessoa da escala foi encontrada nas vendas deste período. '),
      `Na escala: ${ctx.pessoas().join(', ') || '(sem nomes)'}. Escreva em Equipe e regras o nome (ou o primeiro nome) igual ao do vendedor no AppNext. Até lá a venda por hora fica em "—".`));
    else if (T.semPar.length) root.append(h('div', { class: 'notice' }, `Na escala, mas sem venda com esse nome no período: ${T.semPar.join(', ')}. As horas dessas pessoas não entram na conta.`));

    // ---- detalhe de uma pessoa (a lista some, com "‹ Voltar")
    if (state.eqPessoa && vend.has(state.eqPessoa)) { detalhe(root, ctx, state.eqPessoa, M, cpfs, ate); return; }
    state.eqPessoa = null;

    // ---- meta individual (só quando o período cabe num mês: a meta é mensal)
    const umMes = TS.dayToIso(de).slice(0, 7) === TS.dayToIso(ate).slice(0, 7) && !soMes;
    const metas = new Map();
    if (umMes && base.length) {
      try {
        const res = TS.rules.comissionamento({ base, baseSemVend: TS.filtrar({ ignorar: ['vendedores'] }), metaLoja: state.com.meta ?? TS.metaPeriodo().valor ?? 0, vendBonus: '', ym: TS.metaPeriodo().ym });
        if (res.lojasNoPeriodo <= 1) for (const r of res.rows) if (r.metaInd > 0) metas.set(String(r.vendedor).trim(), r.total / r.metaInd);
      } catch { /* sem regra de meta: a coluna fica em "—" */ }
    }
    const esp = X.espera ? conversaoEspera(X.espera, nomesVenda, TS.dayToIso(de), TS.dayToIso(ate)) : new Map();

    const linhas = [...vend.values()].map((a) => {
      const I = indicadores(a), r = rPes.get(a.nome) || {};
      const e = esp.get(a.nome);
      return { nome: a.nome, ...I, naEscala: !!r.naEscala, horas: r.naEscala ? r.horas : null, rph: r.naEscala ? r.rph : null, cph: r.naEscala ? r.cph : null, pctFora: r.pctFora ?? null,
        pctMeta: metas.has(a.nome) ? metas.get(a.nome) : null, espera: e ? e.taxa : null, esperaN: e ? e.fechados : 0 };
    }).filter((l) => l.vendas > 0 || l.horas > 0);

    // ---- quadros
    const comRph = linhas.filter((l) => l.rph != null);
    const melhor = comRph.slice().sort((a, b) => b.rph - a.rph)[0] || null;
    const hrs = R.porHora.filter((x) => x.rph != null && x.horas >= 4);
    const melhorHora = hrs.slice().sort((a, b) => b.rph - a.rph)[0] || null, piorHora = hrs.slice().sort((a, b) => a.rph - b.rph)[0] || null;
    const ds = R.porDia.filter((x) => x.rph != null);
    const melhorDia = ds.slice().sort((a, b) => b.rph - a.rph)[0] || null;
    const vis = ['ficha', 'hora', 'dia'].includes(state.eqVis) ? state.eqVis : 'ficha';
    root.append(h('div', { class: 'grid g-kpi' },
      kpiClique(TS.kpi('Venda por hora trabalhada', R.total.rph == null ? '—' : fmt.brl(R.total.rph), R.total.rph == null ? 'sem escala no período' : `${fmt.n1(R.total.cph)} atendimentos por hora · ${hTxt(R.total.horas)} escaladas`,
        'Vendas de quem está na escala ÷ horas líquidas escaladas no período (sem o intervalo, sem folga, férias e loja fechada). Sem taxas e sem prêmios de fidelidade. ' + LIMITES), 'ficha'),
      kpiClique(TS.kpi('Quem rende mais por hora', melhor ? melhor.nome : '—', melhor ? `${fmt.brl(melhor.rph)} por hora escalada` : 'sem escala no período',
        'A pessoa com a maior venda por hora escalada no período. Compare com cuidado: quem pega os horários de mais movimento vende mais por hora. Clique para ver a ficha de todos.'), 'ficha'),
      kpiClique(TS.kpi('Horário que mais rende', melhorHora ? `${melhorHora.hora}h–${melhorHora.hora + 1}h` : '—', melhorHora ? `${fmt.brl(melhorHora.rph)} por hora de pessoa${piorHora && piorHora !== melhorHora ? ` · o mais fraco: ${piorHora.hora}h (${fmt.brl(piorHora.rph)})` : ''}` : 'sem escala ou sem hora nas vendas',
        'Vendas feitas naquela hora ÷ horas de pessoa escaladas naquela hora (só horários com 4 horas escaladas ou mais no período). Horário fraco com muita gente = dá para enxugar; horário forte com pouca gente = vale reforçar. Clique para ver todos.'), 'hora'),
      kpiClique(TS.kpi('Dia que mais rende', melhorDia ? TS.DIAS_SEMANA[melhorDia.wd] : '—', melhorDia ? `${fmt.brl(melhorDia.rph)} por hora de pessoa` : 'sem escala no período',
        'Vendas do dia da semana ÷ horas de pessoa escaladas nesses dias. Clique para ver os sete dias.'), 'dia')));

    // ---- a lista
    const semEscala = linhas.filter((l) => !l.naEscala).length;
    const seg = TS.seg([[`Ficha da equipe (${linhas.length})`, 'ficha'], [`Por horário (${R.porHora.length})`, 'hora'], ['Por dia da semana (7)', 'dia']], vis, (v) => { state.eqVis = v; TS.render(); });
    const como = h('details', { class: 'mapa-como' }, h('summary', null, 'Como a conta é feita e o que ela não vê'),
      h('ul', null,
        h('li', null, h('b', null, 'Horas: '), 'horas líquidas da escala do mês (entrada–saída menos o intervalo), dia a dia, do período escolhido. Folga, férias, feriado fechado e dia sem turno contam zero. ', LIMITES),
        h('li', null, h('b', null, 'Vendas: '), 'tudo o que a pessoa vendeu no período com os filtros escolhidos, sem taxa de serviço/entrega e sem os prêmios de fidelidade (R$ 0,01).'),
        h('li', null, h('b', null, 'R$ por hora = '), 'vendas ÷ horas. ', h('b', null, 'Atendimentos por hora = '), 'cupons ÷ horas. Sem hora escalada no período a conta não é feita ("—").'),
        h('li', null, h('b', null, 'Por horário e por dia: '), 'só as vendas de quem está na escala ÷ as horas de pessoa escaladas naquela faixa. Cupom sem hora registrada fica fora da visão por horário', R.semHora ? ` (${fmt.int(R.semHora)} neste período).` : '.'),
        h('li', null, h('b', null, 'Nomes: '), 'a pessoa da escala é ligada ao vendedor pelo nome igual ou pelo primeiro nome, quando só há um par possível.')));
    let tab;
    if (vis === 'ficha') {
      tab = TS.table({
        cols: [
          { key: 'nome', label: 'Pessoa', align: 'l', sticky: true, wrap: true, render: (r) => h('div', null, h('b', null, r.nome), r.naEscala ? null : h('span', { class: 'badge cinza', style: { marginLeft: '6px' } }, 'fora da escala'),
            r.naEscala && r.pctFora > 0.1 ? h('small', { class: 'muted', style: { display: 'block' } }, `${fmt.pct(r.pctFora, 0)} das vendas em dia sem turno na escala`) : null) },
          { key: 'vendas', label: 'Vendas', fmt: fmt.brl, title: 'Tudo o que a pessoa vendeu no período (com os filtros escolhidos), sem taxas e sem prêmios de fidelidade a R$ 0,01.' },
          { key: 'pctMeta', label: '% da meta', fmt: (v) => fmt.pct(v, 0), cls: (r) => (r.pctMeta == null ? '' : r.pctMeta >= 1 ? 'pos' : 'neg'), title: 'Vendido em chás e acessórios ÷ meta individual do mês (a mesma conta do Comissionamento). Só aparece quando o período escolhido cabe num mês, porque a meta é mensal; quem não tem meta fica em "—".' },
          { key: 'ticket', label: 'Ticket médio', fmt: fmt.brl, title: 'Vendas ÷ número de atendimentos (cupons).' },
          { key: 'ipa', label: 'Itens por atendimento', fmt: fmt.n2, title: 'Itens vendidos ÷ atendimentos. Mostra quem oferece mais um produto.' },
          { key: 'pctCpf', label: 'Cupons com CPF', fmt: (v) => fmt.pct(v, 0), title: cpfs ? 'Atendimentos com CPF na nota ÷ atendimentos. Sem CPF o cliente não entra na base nem nas campanhas: vale cobrar de quem está baixo.' : 'Precisa da tela Clientes liberada (os cupons com CPF são dados de clientes). Sem ela fica em "—".' },
          { key: 'descPct', label: 'Desconto médio', fmt: (v) => fmt.pct(v, 1), title: 'Desconto dado ÷ preço cheio (vendido + desconto). Desconto alto com ticket baixo é sinal de vender no desconto.' },
          { key: 'rph', label: 'R$ por hora', fmt: fmt.brl, title: 'Vendas ÷ horas líquidas escaladas no período. "—" = a pessoa não está na escala ou não tem hora escalada no período. ' + LIMITES },
          { key: 'cph', label: 'Atend. por hora', fmt: fmt.n1, title: 'Atendimentos (cupons) ÷ horas líquidas escaladas no período.' },
          { key: 'horas', label: 'Horas', fmt: (v) => (v == null ? '—' : hTxt(v)), title: 'Horas líquidas escaladas no período (sem intervalo, folga e férias).' },
          { key: 'espera', label: 'Lista de espera', fmt: (v) => fmt.pct(v, 0), render: (r) => (r.espera == null ? '—' : h('span', { title: `${r.esperaN} pedidos com desfecho` }, fmt.pct(r.espera, 0))), title: 'Dos pedidos da lista de espera que a pessoa anotou e que terminaram no período (cliente avisado), quantos viraram compra em até 7 dias. Com menos de 3 pedidos encerrados fica em "—".' },
          ...(M ? [{ key: 'lucro', label: 'Lucro gerado', fmt: fmt.brl, title: 'Vendido − custo dos produtos (custo médio do estoque), só nos itens que têm custo cadastrado. É lucro bruto: não desconta imposto, comissão nem custo fixo. Só aparece para quem vê custo.' }] : []),
        ],
        rows: linhas, sortKey: 'vendas', cls: 'eq-t', onRowClick: (r) => { state.eqPessoa = r.nome; TS.render(); },
        empty: 'Nenhuma venda com vendedor no período.',
        imprimir: ['nome', 'vendas', 'pctMeta', 'ticket', 'ipa', 'rph', 'cph', 'horas'],
      });
    } else {
      const faixa = vis === 'hora';
      const rows = (faixa ? R.porHora : R.porDia).map((x) => ({ ...x, rot: faixa ? `${String(x.hora).padStart(2, '0')}h–${String(x.hora + 1).padStart(2, '0')}h` : TS.DIAS_SEMANA[x.wd], ord: faixa ? x.hora : x.wd, ticket: div(x.vt, x.cupons) }));
      tab = TS.table({
        cols: [
          { key: 'ord', label: faixa ? 'Horário' : 'Dia da semana', align: 'l', sticky: true, render: (r) => h('b', null, r.rot), csv: (r) => r.rot },
          { key: 'rph', label: 'R$ por hora de pessoa', fmt: fmt.brl, title: `Vendas ${faixa ? 'feitas nesse horário' : 'do dia'} ÷ horas de pessoa escaladas ${faixa ? 'nesse horário' : 'nesses dias'}. Alto = cada pessoa rende muito (pode faltar gente); baixo = sobra gente para o movimento.` },
          { key: 'cph', label: 'Atend. por hora de pessoa', fmt: fmt.n1, title: 'Atendimentos (cupons) ÷ horas de pessoa escaladas.' },
          { key: 'horas', label: 'Horas de pessoa', fmt: (v) => hTxt(v), title: 'Soma das horas líquidas de todos que estavam escalados nessa faixa, no período.' },
          { key: 'vt', label: 'Vendas', fmt: fmt.brl, title: 'Vendas de quem está na escala (sem taxas e sem prêmios de fidelidade).' },
          { key: 'cupons', label: 'Atendimentos', fmt: fmt.int },
          { key: 'ticket', label: 'Ticket médio', fmt: fmt.brl },
        ],
        rows, sortKey: 'ord', sortDir: 'asc', cls: 'eq-t',
        empty: faixa ? 'Sem escala ou sem hora registrada nas vendas deste período.' : 'Sem escala no período.',
      });
    }
    const sub = vis === 'ficha'
      ? `Uma linha por pessoa, com o que hoje fica espalhado em várias telas. Clique na linha para ver a evolução mês a mês.${semEscala ? ` ${semEscala} fora da escala: sem venda por hora.` : ''}${X.M === undefined ? ' Calculando o lucro…' : ''}`
      : vis === 'hora' ? 'Em que horário cada hora de pessoa rende mais. Compare com Movimento da loja antes de mexer na escala.'
        : 'Em que dia da semana cada hora de pessoa rende mais.';
    root.append(h('div', { class: 'mt' }, TS.cardWithTools('Rendimento da equipe', `${sub} Período: ${TS.periodoTexto()}.`, seg, tab, como)));
  }

  /** evolução mês a mês de uma pessoa (últimos 12 meses até o fim do período) */
  function detalhe(root, ctx, nome, M, cpfs, ate) {
    const db = TS.db;
    const fimIso = TS.dayToIso(ate);
    const meses = [];
    for (let k = 11; k >= 0; k--) { const d = new Date(Date.UTC(+fimIso.slice(0, 4), +fimIso.slice(5, 7) - 1 - k, 1)); meses.push(d.toISOString().slice(0, 7)); }
    const nomesSel = state.f.lojas.size ? new Set([...state.f.lojas].map((i) => db.D.loja[i])) : null;
    const rows = [];
    for (const ym of meses) {
      const d0 = TS.isoToDay(ym + '-01');
      const d1 = Math.min(TS.isoToDay(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10)), db.maxDay);
      if (d1 < db.minDay || d0 > db.maxDay) continue;
      const idx = TS.filtrar({ de: d0, ate: d1, mesLivre: true, ignorar: ['vendedores'] });
      const vend = porVendedor(idx, M, cpfs);
      const a = vend.get(nome);
      if (!a) continue;
      const I = indicadores(a);
      let rph = null, horas = null;
      if (ctx.salva) {
        const T = turnosComNome(ctx, Math.max(d0, db.minDay), d1, null, [...vend.keys()]);
        const p = rendimento(T.turnos, [...a.cup.values()]).porPessoa.find((x) => x.nome === nome);
        if (p && p.naEscala) { rph = p.rph; horas = p.horas; }
      }
      let pctMeta = null;
      try {
        const res = TS.rules.comissionamento({ base: idx, baseSemVend: idx, metaLoja: TS.metaCalc(ym, nomesSel).valor ?? 0, vendBonus: '', ym });
        const r = res.lojasNoPeriodo <= 1 ? res.rows.find((x) => String(x.vendedor).trim() === nome) : null;
        if (r && r.metaInd > 0) pctMeta = r.total / r.metaInd;
      } catch { /* sem regra de meta */ }
      const parcial = d1 === db.maxDay && TS.dayToIso(d1) !== new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);
      rows.push({ ym, parcial, ...I, rph, horas, pctMeta });
    }
    const cheios = rows.filter((r) => !r.parcial);
    const ult = cheios[cheios.length - 1] || null, ant = cheios[cheios.length - 2] || null;
    const varia = (k) => (ult && ant && ant[k] > 0 && ult[k] != null ? ult[k] / ant[k] - 1 : null);
    const pe = (k, f2) => (ult ? f2(ult[k]) : '—');
    const rodape = (k) => { const v = varia(k); return v == null ? (ult ? TS.ymLabel(ult.ym) : 'sem mês fechado') : h('span', null, `${TS.ymLabel(ult.ym)} · `, TS.deltaSpan(v), ` sobre ${TS.ymLabel(ant.ym)}`); };
    root.append(
      h('div', { class: 'acoes-pagina' }, h('button', { type: 'button', class: 'btn', onclick: () => { state.eqPessoa = null; TS.render(); } }, '‹ Voltar para a equipe')),
      h('div', { class: 'grid g-kpi' },
        TS.kpi('Vendas no último mês fechado', pe('vendas', fmt.brl0), rodape('vendas'), 'Último mês completo dos dados, comparado com o mês anterior.'),
        TS.kpi('Ticket médio', pe('ticket', fmt.brl), rodape('ticket'), 'Vendas ÷ atendimentos no último mês fechado.'),
        TS.kpi('R$ por hora', pe('rph', fmt.brl), rodape('rph'), 'Vendas ÷ horas líquidas escaladas no último mês fechado. ' + LIMITES),
        TS.kpi('% da meta', pe('pctMeta', (v) => fmt.pct(v, 0)), ult ? TS.ymLabel(ult.ym) : 'sem mês fechado', 'Vendido em chás e acessórios ÷ meta individual do mês (mesma conta do Comissionamento).')),
      h('div', { class: 'mt' }, TS.card(`${nome}: mês a mês`, 'Os últimos 12 meses até o fim do período escolhido. O mês em andamento vem marcado e não entra nas comparações dos quadros.',
        TS.table({
          cols: [
            { key: 'ym', label: 'Mês', align: 'l', sticky: true, render: (r) => h('div', null, h('b', null, TS.ymLabel(r.ym)), r.parcial ? h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, 'em andamento') : null), csv: (r) => r.ym },
            { key: 'vendas', label: 'Vendas', fmt: fmt.brl },
            { key: 'pctMeta', label: '% da meta', fmt: (v) => fmt.pct(v, 0), cls: (r) => (r.pctMeta == null ? '' : r.pctMeta >= 1 ? 'pos' : 'neg'), title: 'Vendido em chás e acessórios ÷ meta individual do mês, com as regras de hoje. No mês em andamento é o quanto já fez da meta inteira.' },
            { key: 'ticket', label: 'Ticket médio', fmt: fmt.brl },
            { key: 'ipa', label: 'Itens por atendimento', fmt: fmt.n2 },
            { key: 'pctCpf', label: 'Cupons com CPF', fmt: (v) => fmt.pct(v, 0), title: cpfs ? 'Atendimentos com CPF na nota ÷ atendimentos.' : 'Precisa da tela Clientes liberada.' },
            { key: 'descPct', label: 'Desconto médio', fmt: (v) => fmt.pct(v, 1), title: 'Desconto dado ÷ preço cheio.' },
            { key: 'rph', label: 'R$ por hora', fmt: fmt.brl, title: 'Vendas ÷ horas líquidas escaladas no mês. ' + LIMITES },
            { key: 'horas', label: 'Horas', fmt: (v) => (v == null ? '—' : hTxt(v)), title: 'Horas líquidas escaladas no mês.' },
            ...(M ? [{ key: 'lucro', label: 'Lucro gerado', fmt: fmt.brl, title: 'Vendido − custo dos produtos (o custo da data da venda nos meses passados; o de hoje no mês em andamento), nos itens com custo. Lucro bruto. Só para quem vê custo.' }] : []),
          ],
          rows, sortKey: 'ym', sortDir: 'desc', cls: 'eq-t', maxHeight: 'free',
          empty: 'Sem vendas desta pessoa nos últimos 12 meses.',
        }))));
  }

  TS.equipe = { render, calc: CALC };
})();
