/* Início: o que pede atenção hoje, numa tela só. Cada aviso leva à tela certa.
 * - Vendas: o último dia com venda × a média do mesmo dia da semana; o mês até agora × a meta.
 * - Estoque (quem vê Estoque ou Pedido, com uma loja escolhida): chás a granel abaixo de 500 g e Estrela abaixo de 700 g
 *   que venderam nos últimos 90 dias, e produtos que acabaram e venderam nos últimos 30 dias.
 * - Site (quem vê o Site): mudanças de preço e promoção desde a consulta anterior.
 * - Atualizações (admin e franqueado): coletas que falharam nas últimas 48 h; vendas atrasadas.
 * - Inventário (quem vê Inventário): Acessórios, Alimentação, Consumíveis, Sachês, Tea Moments e cada tipo de chá há 25 dias ou mais sem inventário (contagem do painel ou inventário feito direto no AppNext, lido toda madrugada). */
(function () {
  const { h, fmt, state } = TS;

  TS.pages.inicio = function (root) {
    const nome = String((TS.eu && (TS.eu.nome || TS.eu.usuario)) || '').split(' ')[0];
    const hora = new Date().getHours();
    root.append(h('div', { class: 'page-head' }, h('div', null,
      h('h1', { class: 'page-title' }, `${hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'}${nome ? ', ' + nome : ''}`),
      h('div', { class: 'page-sub' }, 'O que pede atenção hoje. Clique num aviso para ir à tela certa.'))));
    const avisos = h('div', { class: 'ini-avisos' });
    const pend = h('div', { class: 'muted ini-pend' }, 'Conferindo estoque, site e atualizações…');
    const diag = h('div');
    root.append(blocoVendas(), diag, h('div', { class: 'mt' }, h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Avisos'), avisos, pend)));
    const lista = [];
    const pintar = () => {
      const ord = { erro: 0, warn: 1, info: 2, ok: 3 };
      lista.sort((a, b) => ord[a.nivel] - ord[b.nivel]);
      avisos.replaceChildren(...(lista.length ? lista.map(item) : [h('p', { class: 'muted' }, 'Nada pedindo atenção por enquanto. 👏')]));
    };
    const analise = TS.db && TS.db.n && TS.eu && TS.eu.perfil !== 'vendedor' ? analisar() : null;
    const tarefas = [avisosEspera(lista), avisosVendas(lista), avisosEstoque(lista), avisosSite(lista), avisosAtualizacoes(lista), avisosInventario(lista, analise), avisosCreditos(lista), avisosCusto(lista), avisosPadrao(lista, analise)].map((p) => p.catch(() => null).then(() => { if (avisos.isConnected) pintar(); }));
    Promise.all(tarefas).then(() => { pend.remove(); if (analise && diag.isConnected) cartaoPorque(diag, lista, analise); });
  };

  // ======================= por que as vendas mudaram e o que está fora do padrão =======================
  // Sem IA: decompõe a variação em movimento (atendimentos) × itens por atendimento × preço médio por item,
  // mostra por onde mudou (grupos, vendedoras, dias da semana) e acha o que foge do padrão (desconto, dia atípico).
  // Com IA (chave do franqueado): a IA lê isso junto com os avisos e explica em poucas frases o porquê e o que fazer.
  function analisar() {
    const db = TS.db, taxas = TS.rules.ids.taxas, un = TS.descontoPorUnidade();
    const hoje = TS.todayDay();
    const u = db.maxDay === hoje && db.maxDay > db.minDay ? db.maxDay - 1 : db.maxDay; // hoje ainda está acontecendo: fecha em ontem
    const ini = Math.max(db.minDay, u - 400);
    const resg = (i) => TS.ehResgate(i);
    // por dia: vt, itens, cupons; e para os recortes
    const blocos = (de, ate) => {
      const r = { vt: 0, itens: 0, cup: new Set(), grupo: new Map(), vend: new Map(), wd: new Map(), dias: new Set() };
      for (let i = 0; i < db.n; i++) {
        const d = db.day[i];
        if (d < de || d > ate || taxas.has(db.desc[i])) continue;
        const v = db.vt[i] || 0, k = TS.chaveCupom(i);
        r.vt += v; r.itens += TS.qtdItem(i); r.cup.add(k); r.dias.add(d);
        const g = db.D.grupoC[db.grupoC[i]] || '—', vd = db.D.vendedor[db.vend[i]] || '(sem vendedor)', w = db.wd[i];
        r.grupo.set(g, (r.grupo.get(g) || 0) + v); r.vend.set(vd, (r.vend.get(vd) || 0) + v); r.wd.set(w, (r.wd.get(w) || 0) + v);
      }
      return r;
    };
    const ind = (r, f = 1) => ({ faturamento: Math.round(r.vt / f), atendimentos: Math.round(r.cup.size / f), itens_por_atendimento: r.cup.size ? +(r.itens / r.cup.size).toFixed(2) : null, preco_medio_item: r.itens ? +(r.vt / r.itens).toFixed(2) : null, ticket_medio: r.cup.size ? +(r.vt / r.cup.size).toFixed(2) : null });
    /** compara A com B (B dividido por f, ex.: média de 4 semanas) e decompõe a diferença em R$ */
    const comparar = (A, B, f, rotA, rotB) => {
      const a = ind(A), b = ind(B, f);
      const out = { periodo: rotA, base: rotB, atual: a, anterior: b };
      if (!(a.faturamento > 0 && b.faturamento > 0 && a.atendimentos && b.atendimentos)) return out;
      const dv = a.faturamento - b.faturamento, lv = Math.log(a.faturamento / b.faturamento);
      const lc = Math.log(a.atendimentos / b.atendimentos), li = Math.log(a.itens_por_atendimento / b.itens_por_atendimento), lp = Math.log(a.preco_medio_item / b.preco_medio_item);
      const parte = (x) => (Math.abs(lv) > 1e-9 ? Math.round((dv * x) / lv) : 0);
      out.variacao_pct = +((a.faturamento / b.faturamento - 1) * 100).toFixed(1);
      out.diferenca_reais = Math.round(dv);
      out.explicado_por_reais = { movimento_atendimentos: parte(lc), itens_por_atendimento: parte(li), preco_medio_por_item: parte(lp) };
      const mov = (mA, mB) => {
        const ks = new Set([...mA.keys(), ...mB.keys()]);
        const l = [...ks].map((k) => ({ k, d: Math.round((mA.get(k) || 0) - (mB.get(k) || 0) / f), atual: Math.round(mA.get(k) || 0) })).filter((x) => Math.abs(x.d) >= 50).sort((x, y) => x.d - y.d);
        return { caiu: l.slice(0, 5).filter((x) => x.d < 0).map((x) => ({ nome: x.k, diferenca: x.d, atual: x.atual })), subiu: l.slice(-5).reverse().filter((x) => x.d > 0).map((x) => ({ nome: x.k, diferenca: x.d, atual: x.atual })) };
      };
      out.por_grupo = mov(A.grupo, B.grupo);
      out.por_vendedora = mov(A.vend, B.vend);
      const w = mov(A.wd, B.wd);
      const nomeW = (x) => ({ ...x, nome: TS.DIAS_SEMANA[x.nome] });
      out.por_dia_semana = { caiu: w.caiu.map(nomeW), subiu: w.subiu.map(nomeW) };
      return out;
    };
    const iso = (d) => TS.dayToIso(d), br = (d) => fmt.date(iso(d)).slice(0, 5);
    const sem = comparar(blocos(u - 6, u), blocos(u - 34, u - 7), 4, `últimos 7 dias (${br(u - 6)} a ${br(u)})`, 'média das 4 semanas anteriores');
    const ym = iso(u).slice(0, 7), iniMes = TS.isoToDay(ym + '-01'), n = u - iniMes + 1;
    const mesAnt = TS.isoToDay(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 1)).toISOString().slice(0, 10));
    const anoAnt = TS.isoToDay(`${+ym.slice(0, 4) - 1}${ym.slice(4)}-01`);
    const mes = n >= 3 ? comparar(blocos(iniMes, u), blocos(mesAnt, mesAnt + n - 1), 1, `mês até ${br(u)} (${n} dias)`, `mesmos ${n} dias do mês anterior`) : null;
    const ano = n >= 3 && anoAnt >= db.minDay ? comparar(blocos(iniMes, u), blocos(anoAnt, anoAnt + n - 1), 1, `mês até ${br(u)} (${n} dias)`, `mesmos ${n} dias do ano passado`) : null;
    if (ano) { delete ano.por_vendedora; } // equipe de um ano atrás não ajuda

    // ---- fora do padrão ----
    // desconto por cupom (sem resgates do programa de pontos, que saem por R$ 0,01)
    const cupons = new Map();
    for (let i = 0; i < db.n; i++) {
      const d = db.day[i];
      if (d < u - 89 || d > db.maxDay || taxas.has(db.desc[i]) || resg(i)) continue;
      const k = TS.chaveCupom(i);
      let c = cupons.get(k);
      if (!c) cupons.set(k, (c = { d, cupom: db.cupom[i], vend: db.D.vendedor[db.vend[i]] || '(sem vendedor)', loja: db.D.loja[db.loja[i]], vt: 0, desc: 0 }));
      c.vt += db.vt[i] || 0; c.desc += (db.du[i] || 0) * (un ? db.qtd[i] || 0 : 1);
    }
    const todos = [...cupons.values()].filter((c) => c.vt + c.desc > 0);
    const pcts = todos.filter((c) => c.desc > 0).map((c) => c.desc / (c.vt + c.desc)).sort((a, b) => a - b);
    const p98 = pcts.length >= 30 ? pcts[Math.floor(pcts.length * 0.98)] : 0.3;
    const corte = Math.max(0.2, p98);
    const altos = todos.filter((c) => c.d >= u - 6 && c.desc >= 15 && c.desc / (c.vt + c.desc) >= corte).sort((a, b) => b.desc - a.desc)
      .map((c) => ({ dia: iso(c.d), cupom: String(c.cupom), vendedora: c.vend, loja: c.loja, desconto: Math.round(c.desc), pct: Math.round((c.desc / (c.vt + c.desc)) * 100), pago: Math.round(c.vt) }));
    // vendedora com desconto médio muito acima das outras (30 dias)
    const pv = new Map();
    let tB = 0, tD = 0;
    for (const c of todos) { if (c.d < u - 29) continue; const x = pv.get(c.vend) || pv.set(c.vend, { b: 0, d: 0 }).get(c.vend); x.b += c.vt + c.desc; x.d += c.desc; tB += c.vt + c.desc; tD += c.desc; }
    const media = tB ? tD / tB : 0;
    const vendDesc = [...pv].filter(([v, x]) => v !== '(sem vendedor)' && x.b >= 1500 && x.d / x.b >= 0.05 && x.d / x.b >= 2 * media)
      .map(([v, x]) => ({ vendedora: v, desconto_pct: +((x.d / x.b) * 100).toFixed(1), media_loja_pct: +(media * 100).toFixed(1), desconto_reais: Math.round(x.d) }));
    // dia muito abaixo do normal: menos de 40% da mediana do mesmo dia da semana nas 8 semanas anteriores
    const porDia = new Map();
    for (let i = 0; i < db.n; i++) { const d = db.day[i]; if (d < u - 13 - 56 || d > u || taxas.has(db.desc[i])) continue; porDia.set(d, (porDia.get(d) || 0) + (db.vt[i] || 0)); }
    const fracos = [];
    for (let d = u - 13; d <= u; d++) {
      const ant = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => porDia.get(d - 7 * k) || 0).filter((v) => v > 0).sort((a, b) => a - b);
      if (ant.length < 4) continue;
      const med = ant[Math.floor(ant.length / 2)];
      const v = porDia.get(d) || 0;
      if (med >= 400 && v < med * 0.4) fracos.push({ dia: iso(d), dia_semana: TS.DIAS_SEMANA[(new Date(d * 864e5).getUTCDay() + 6) % 7], vendido: Math.round(v), normal: Math.round(med) });
    }
    return { ultimoDia: iso(u), semana: sem, mes, ano, desconto: { corte_pct: Math.round(corte * 100), altos, vendedoras: vendDesc }, diasFracos: fracos };
  }

  async function avisosPadrao(lista, a) {
    if (!a) return;
    const ds = a.desconto.altos;
    if (ds.length) {
      const soma = ds.reduce((s, c) => s + c.desconto, 0);
      lista.push({ nivel: 'warn', padrao: true, titulo: `Desconto fora do padrão: ${fmt.int(ds.length)} ${ds.length === 1 ? 'cupom' : 'cupons'} nos últimos 7 dias (${fmt.brl0(soma)})`,
        texto: ds.slice(0, 3).map((c) => `cupom ${c.cupom} em ${fmt.date(c.dia).slice(0, 5)}, ${c.vendedora.split(' ')[0]}: ${c.pct}% (${fmt.brl0(c.desconto)})`).join(' · ') + `. Acima de ${a.desconto.corte_pct}% (o normal da loja).`,
        link: '#cupons', ir: 'ver cupons ›' });
    }
    for (const v of a.desconto.vendedoras) {
      lista.push({ nivel: 'info', padrao: true, titulo: `${v.vendedora}: desconto médio de ${fmt.n1(v.desconto_pct)}% nos últimos 30 dias`, texto: `A média da loja é ${fmt.n1(v.media_loja_pct)}% (${fmt.brl0(v.desconto_reais)} em descontos). Vale entender o motivo.`, link: '#cupons', ir: 'ver cupons ›' });
    }
    if (a.diasFracos.length) {
      lista.push({ nivel: 'info', padrao: true, titulo: `${a.diasFracos.length === 1 ? 'Um dia' : `${a.diasFracos.length} dias`} com venda muito abaixo do normal nas últimas 2 semanas`,
        texto: a.diasFracos.slice(0, 3).map((d) => `${fmt.date(d.dia).slice(0, 5)} (${d.dia_semana}): ${fmt.brl0(d.vendido)}, o normal é ${fmt.brl0(d.normal)}`).join(' · ') + '. Loja fechada, feriado ou venda que não chegou ao painel?',
        link: '#resumo', ir: 'ver vendas ›' });
    }
  }

  /** cartão "Por que isso está acontecendo" (IA). A resposta fica guardada no servidor: a mesma situação não é cobrada de novo. */
  async function cartaoPorque(box, lista, a) {
    if (!TS.iaApi || !TS.eu || !['admin', 'franqueado', 'gerente'].includes(TS.eu.perfil)) return;
    let st;
    try { st = await TS.iaApi('GET', `ia/estado?loja=${encodeURIComponent(state.loja || '')}`); } catch { return; }
    if (!st.ativa || !box.isConnected) return;
    const card = h('div', { class: 'card mt ini-porque' }, h('div', { class: 'card-title' }, '✨ Por que isso está acontecendo'),
      h('div', { class: 'ini-porque-c' }, h('span', { class: 'cfg-pulso' }), ' A IA está lendo os números e os avisos…'));
    box.replaceChildren(card);
    const fatos = { ...a, avisos: lista.filter((x) => x.nivel !== 'ok').map((x) => `${x.titulo}${x.texto ? ' — ' + x.texto : ''}`.slice(0, 400)) };
    const pintarRes = (j) => {
      const r = j.diagnostico || {};
      card.replaceChildren(...[
        h('div', { class: 'card-title' }, '✨ Por que isso está acontecendo', h('small', { class: 'muted' }, ` · ${j.em ? new Date(j.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}${j.simulada ? ' · simulado (apresentação)' : ''}`)),
        r.manchete ? h('p', { class: 'ini-porque-m' }, r.manchete) : null,
        ...(r.explicacoes || []).map((x) => h('div', { class: 'ini-porque-i' }, h('b', null, x.titulo), x.porque ? TS.iaMd(x.porque) : null, x.o_que_fazer ? h('div', { class: 'ini-porque-f' }, '👉 ', x.o_que_fazer) : null)),
        (r.fora_do_padrao || []).length ? h('div', { class: 'ini-porque-fp' }, h('div', { class: 'ini-porque-st' }, 'Fora do padrão'), ...(r.fora_do_padrao || []).map((x) => h('div', { class: 'ini-porque-i' }, h('b', null, '⚠️ ', x.titulo), x.detalhe ? h('div', { class: 'muted' }, x.detalhe) : null))) : null,
        h('small', { class: 'muted ini-porque-n' }, 'Explicação da IA a partir dos números do painel. Confira antes de tomar decisões importantes.')].filter(Boolean));
    };
    try { pintarRes(await TS.iaApi('POST', 'ia/diagnostico', { loja: state.loja, fatos })); }
    catch (e) { card.replaceChildren(h('div', { class: 'card-title' }, '✨ Por que isso está acontecendo'), h('p', { class: 'muted' }, e.message)); }
  }

  // ---------- lista de espera ----------
  async function avisosEspera(lista) {
    if (!TS.esperaResumo) return;
    const r = await TS.esperaResumo();
    if (r && r.chegou) lista.push({ nivel: 'warn', titulo: `Lista de espera: ${fmt.int(r.chegou)} ${r.chegou === 1 ? 'cliente para avisar' : 'clientes para avisar'}`, texto: 'O produto que eles pediram chegou. A mensagem do WhatsApp já está pronta.', link: '#espera', ir: 'avisar ›', antes: () => { state.espAba = 'avisar'; } });
  }

  function item(a) {
    const ir = () => { if (a.antes) a.antes(); if (a.link) location.hash = a.link; if (a.acao) a.acao(); };
    return h('div', { class: 'ini-aviso ini-' + a.nivel, role: a.link || a.acao ? 'button' : null, tabindex: a.link || a.acao ? '0' : null, onclick: a.link || a.acao ? ir : null, onkeydown: (e) => { if ((a.link || a.acao) && e.key === 'Enter') ir(); } },
      h('span', { class: 'ini-ico' }, { erro: '!', warn: '•', info: 'i', ok: '✓' }[a.nivel]),
      h('div', null, h('b', null, a.titulo), a.texto ? h('div', { class: 'muted' }, a.texto) : null),
      a.link || a.acao ? h('span', { class: 'ini-ir' }, a.ir || 'abrir ›') : null);
  }

  // ---------- vendas ----------
  function somaDias(de, ate) {
    const idx = TS.filtrar({ de, ate, ignorar: ['vendedores', 'grupos', 'cats', 'produto'], mesLivre: true });
    const taxas = TS.rules.ids.taxas;
    let vt = 0; const cup = new Set();
    for (const i of idx) { if (taxas.has(TS.db.desc[i])) continue; vt += TS.db.vt[i] || 0; cup.add(TS.chaveCupom(i)); }
    return { vt, cupons: cup.size };
  }
  function blocoVendas() {
    const db = TS.db;
    if (!db || !db.n) return h('div');
    const d = db.maxDay;
    const ult = somaDias(d, d);
    const ant = [7, 14, 21, 28].map((k) => somaDias(d - k, d - k)).filter((x) => x.vt > 0);
    const media = ant.length ? ant.reduce((a, x) => a + x.vt, 0) / ant.length : null;
    const ym = TS.dayToIso(d).slice(0, 7), ini = TS.isoToDay(ym + '-01');
    const mes = somaDias(ini, d);
    const meta = TS.metaCalc(ym).valor;
    const diasMes = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate(), feitos = d - ini + 1;
    const proj = feitos > 0 ? (mes.vt / feitos) * diasMes : null;
    const dia = TS.dayToIso(d);
    const nomeDia = new Date(dia + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' });
    return h('div', { class: 'grid g-kpi' },
      TS.kpi(`Vendas de ${d === TS.todayDay() ? 'hoje' : d === TS.todayDay() - 1 ? 'ontem' : fmt.date(dia)}`, fmt.brl0(ult.vt),
        media ? h('span', { class: ult.vt >= media ? 'up' : 'down' }, `${ult.vt >= media ? '+' : ''}${fmt.n1((ult.vt / media - 1) * 100)}% vs. média ${/sábado|domingo/.test(nomeDia) ? 'dos últimos' : 'das últimas'} ${nomeDia.replace(/-feira$/, 's-feiras').replace(/(sábado|domingo)$/, '$1s')}`) : `${fmt.int(ult.cupons)} cupons`,
        'Faturamento do último dia com venda no painel, comparado com a média do mesmo dia da semana nas 4 semanas anteriores'),
      TS.kpi('Mês até agora', fmt.brl0(mes.vt), meta ? `${fmt.pct(mes.vt / meta, 0)} da meta de ${fmt.brl0(meta)}` : `${fmt.int(mes.cupons)} cupons`),
      TS.kpi('Projeção do mês', proj != null ? fmt.brl0(proj) : '—', meta && proj != null ? h('span', { class: proj >= meta ? 'up' : 'down' }, proj >= meta ? 'bate a meta no ritmo atual' : `faltam ${fmt.brl0(meta - proj)} no ritmo atual`) : 'no ritmo atual',
        'Vendas do mês ÷ dias passados × dias do mês'),
      TS.kpi('Cupons no mês', fmt.int(mes.cupons), mes.cupons ? `ticket médio ${fmt.brl(mes.vt / mes.cupons)}` : ''));
  }
  async function avisosVendas(lista) {
    const db = TS.db;
    if (!db || !db.n) return;
    const atraso = TS.todayDay() - db.maxDay;
    if (atraso >= 2) lista.push({ nivel: 'warn', titulo: `As vendas no painel vão até ${fmt.date(TS.dayToIso(db.maxDay))}`, texto: 'A atualização dos últimos dias não chegou. Veja o histórico das atualizações.', acao: TS.eu && TS.eu.pode && TS.eu.pode.configurar && TS.abrirHistAtualizacoes && !TS.demo ? () => TS.abrirHistAtualizacoes() : null, ir: 'ver histórico ›' });
  }

  // ---------- estoque ----------
  async function avisosEstoque(lista) {
    const telas = TS.telasEstoque || [];
    if (!state.loja || state.loja === 'todas' || !(telas.includes('estoque') || telas.includes('pedido'))) return;
    const [e, M] = await Promise.all([TS.estoqueBuscar(state.loja), TS.custosLoja()]);
    if (!e || !e.estoque || !M) return;
    const db = TS.db, fim = db.maxDay;
    const vendeu90 = new Set(), vendeu30 = new Set();
    for (let i = 0; i < db.n; i++) {
      if (db.day[i] < fim - 89) continue;
      for (const [it] of M.consumo(i)) { vendeu90.add(String(it.cod)); if (db.day[i] >= fim - 29) vendeu30.add(String(it.cod)); }
    }
    const CO = TS.classeOficial ? TS.classeOficial(M, e.classe) : new Map();
    const cha = e.estoque.itens.filter((it) => it.un === 'Kg' && vendeu90.has(String(it.cod)));
    const abaixo500 = cha.filter((it) => (it.qtd || 0) < 0.5);
    const estrela700 = cha.filter((it) => (it.qtd || 0) >= 0.5 && it.qtd < 0.7 && (CO.get(String(it.cod)) || {}).classe === 'estrela');
    const acabou = e.estoque.itens.filter((it) => it.un !== 'Kg' && (it.qtd || 0) <= 0 && vendeu30.has(String(it.cod)) && it.tipo !== 'MC');
    const nomes = (xs) => xs.slice(0, 4).map((x) => x.desc).join(', ') + (xs.length > 4 ? ` e mais ${xs.length - 4}` : '');
    const temPedido = telas.includes('pedido');
    if (abaixo500.length) lista.push({ nivel: 'erro', titulo: `${fmt.int(abaixo500.length)} chá(s) a granel com menos de 500 g`, texto: nomes(abaixo500), link: temPedido ? '#pedido' : '#estoque', ir: temPedido ? 'ver no pedido ›' : 'ver estoque ›', antes: () => { state.pedFiltro = 'pedido'; } });
    if (estrela700.length) lista.push({ nivel: 'warn', titulo: `${fmt.int(estrela700.length)} chá(s) Estrela com menos de 700 g`, texto: nomes(estrela700), link: temPedido ? '#pedido' : '#estoque', ir: temPedido ? 'ver no pedido ›' : 'ver estoque ›' });
    if (acabou.length) lista.push({ nivel: 'warn', titulo: `${fmt.int(acabou.length)} produto(s) acabaram e venderam no último mês`, texto: nomes(acabou), link: '#estoque', ir: 'o que repor ›', antes: () => { state.estSit = 'repor'; } });
  }

  // ---------- inventário: grupo ou tipo de chá há 25 dias ou mais sem inventário importado ----------
  const DIAS_INV = 25;
  const LIM_AJUSTE = 300; // R$
  const GRUPOS_INV = [/ACESS/, /ALIMENT/, /CONSUM/, /SACH/, /TEA\s*MOMENT/];
  async function avisosInventario(lista, analise) {
    const telas = TS.telasEstoque || [];
    if (!state.loja || state.loja === 'todas' || !telas.includes('inventario') || !TS.invResumo) return;
    const d = await TS.invResumo(state.loja);
    // fora do padrão: inventário aplicado nos últimos 30 dias que mexeu muito no valor do estoque
    const grandes = (d.contagens || []).filter((c) => c.st === 'importado' && c.importadoEm && !c.revertidoEm && c.ajuste != null && Math.abs(c.ajuste) >= LIM_AJUSTE && Date.now() - Date.parse(c.importadoEm) < 30 * 864e5);
    if (grandes.length) {
      const txt = grandes.slice(0, 3).map((c) => `${c.nome} (${fmt.date(c.importadoEm.slice(0, 10))}): ${c.ajuste > 0 ? '+' : '−'}${fmt.brl0(Math.abs(c.ajuste))}`).join(' · ');
      lista.push({ nivel: 'warn', padrao: true, titulo: `Inventário com ajuste grande no estoque: ${fmt.int(grandes.length)} ${grandes.length === 1 ? 'contagem' : 'contagens'} nos últimos 30 dias`, texto: txt + '. Vale conferir se faltou contar algo ou se houve perda.', link: '#inventario', ir: 'ver ›', antes: () => { state.invId = null; } });
      if (analise) analise.inventario = grandes.slice(0, 5).map((c) => ({ contagem: c.nome, aplicado: c.importadoEm.slice(0, 10), ajuste_reais: Math.round(c.ajuste), itens_ajustados: c.naPlanilha, zerados: c.zerados }));
    }
    const fam = TS.invFamilia || ((x) => x);
    const feitas = (d.contagens || []).filter((c) => c.st === 'importado' && c.importadoEm);
    const dia = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const hoje = dia(new Date().toISOString());
    const diasDesde = (iso) => Math.round((Date.parse(hoje) - Date.parse(dia(iso))) / 864e5);
    // o servidor junta as contagens do painel e o histórico do AppNext (lido toda madrugada); na apresentação, só o painel
    const cob = d.cobertura || null;
    const ultimo = (cobre) => feitas.filter((c) => c.escopo && cobre(c.escopo)).reduce((m, c) => (!m || c.importadoEm > m ? c.importadoEm : m), null);
    const ultG = (g) => (cob ? (cob.grupos[g] || {}).em || null : ultimo((e) => e.grupo === g));
    const ultF = (f) => (cob ? (cob.familias[f] || {}).em || null : ultimo((e) => e.kg || e.familia === f || (e.tipo && fam(e.tipo) === f)));
    const atrasados = (itens) => itens.map(([nome, ult]) => ({ nome, dias: ult ? diasDesde(ult) : null })).filter((x) => x.dias == null || x.dias >= DIAS_INV)
      .sort((a, b) => (b.dias ?? 1e9) - (a.dias ?? 1e9));
    const norm = (s) => TS.norm(s).toUpperCase();
    const grupos = (d.grupos || []).map(([g]) => g).filter((g) => GRUPOS_INV.some((re) => re.test(norm(g))));
    const gAtr = atrasados(grupos.map((g) => [g, ultG(g)]));
    // tipo de chá: vale a contagem do tipo (puro + aromatizado), a de "todos os chás a granel" e as antigas de só puro/só aromatizado
    const tAtr = atrasados((d.familias || []).map(([f]) => [f, ultF(f)]));
    const txt = (xs) => {
      const com = xs.filter((x) => x.dias != null), sem = xs.filter((x) => x.dias == null);
      return [com.length ? com.map((x) => `${x.nome} (${x.dias} dias)`).join(', ') : '', sem.length ? `${cob && cob.appnextEm ? 'Nenhum inventário (painel ou AppNext)' : 'Nenhuma contagem no painel'}: ${sem.map((x) => x.nome).join(', ')}` : ''].filter(Boolean).join('. ');
    };
    const ir = { link: '#inventario', ir: 'fazer inventário ›', antes: () => { state.invId = null; } };
    if (gAtr.length) lista.push({ nivel: 'warn', titulo: `Inventário: ${fmt.int(gAtr.length)} ${gAtr.length === 1 ? 'grupo está' : 'grupos estão'} há ${DIAS_INV} dias ou mais sem contagem`, texto: txt(gAtr), ...ir });
    if (tAtr.length) lista.push({ nivel: 'warn', titulo: `Inventário: ${fmt.int(tAtr.length)} ${tAtr.length === 1 ? 'tipo de chá está' : 'tipos de chá estão'} há ${DIAS_INV} dias ou mais sem contagem`, texto: txt(tAtr), ...ir });
  }

  // ---------- custo subiu nas notas recentes: produtos à venda com margem menor (admin e franqueado) ----------
  async function avisosCusto(lista) {
    if (!state.loja || state.loja === 'todas' || !TS.custosLoja || !TS.impactoCusto || !TS.custoAntesNota) return;
    const M = await TS.custosLoja();
    if (!M) return;
    const [e, r] = await Promise.all([TS.estoqueBuscar(state.loja), fetch(TS.api(`estoque/notas?loja=${encodeURIComponent(state.loja)}`), { credentials: 'same-origin' })]);
    if (!r.ok) return;
    const j = await r.json();
    const D = { hist: e.historico || {}, comprasItens: (e.compras && e.compras.itens) || {} };
    const limite = TS.todayDay() - 14;
    const itens = [];
    for (const n of j.notas || []) {
      const dia = TS.isoToDay(n.entrada || n.emissao);
      if (dia < limite) continue;
      for (const i of n.itens) { const a = TS.custoAntesNota(D, i.cod, dia, n.nf); if (a) itens.push({ cod: i.cod, nome: i.nome, antes: a.v, depois: i.custo }); }
    }
    const imp = TS.impactoCusto(M, (e.tabela && e.tabela.itens) || [], itens).filter((x) => x.mD < x.mA - 0.01);
    if (!imp.length) return;
    lista.push({ nivel: 'warn', titulo: `Custo subiu: ${fmt.int(imp.length)} ${imp.length === 1 ? 'produto à venda ficou' : 'produtos à venda ficaram'} com margem menor`,
      texto: `Notas de entrada dos últimos 14 dias. ${imp.slice(0, 3).map((x) => `${x.desc} (${fmt.pct(x.mA, 0)} → ${fmt.pct(x.mD, 0)})`).join(', ')}${imp.length > 3 ? ` e mais ${imp.length - 3}` : ''}.`,
      link: '#notas', ir: 'ver as notas ›', antes: () => { state.prcNotasFil = 'subiu'; } });
  }

  // ---------- créditos com a franquia: devoluções sem desconto há mais de 30 dias ----------
  async function avisosCreditos(lista) {
    if (!state.loja || state.loja === 'todas' || !(TS.telasEstoque || []).includes('notas')) return;
    const r = await fetch(TS.api(`conta-franquia?loja=${encodeURIComponent(state.loja)}`), { credentials: 'same-origin' });
    if (!r.ok) return;
    const d = await r.json();
    const ir = { link: '#creditos', ir: 'ver créditos ›', antes: () => { state.cfFil = 'atrasado'; } };
    if (d.resumo.nAtrasado) lista.push({ nivel: 'warn', titulo: `Franquia: ${fmt.int(d.resumo.nAtrasado)} ${d.resumo.nAtrasado === 1 ? 'devolução sem desconto' : 'devoluções sem desconto'} há mais de ${d.prazo} dias · ${fmt.brl(d.resumo.atrasado)}`, texto: 'Nenhuma nota de compra trouxe esse desconto ainda. Cobre a franquia ou marque como compensado.', ...ir });
    const fr = d.fidelidade && d.fidelidade.resumo;
    if (fr && (fr.nAtrasado || fr.nFaltou)) lista.push({ nivel: 'warn', titulo: `Franquia: desconto dos prêmios de fidelidade ${fr.nAtrasado ? `atrasado em ${fr.nAtrasado} mês(es) (${fmt.brl(fr.atrasado)})` : ''}${fr.nAtrasado && fr.nFaltou ? ' e ' : ''}${fr.nFaltou ? `a menos em ${fr.nFaltou} mês(es) (${fmt.brl(fr.faltou)})` : ''}`, texto: 'Confira o boleto de royalties e lance o desconto que veio.', link: '#creditos', ir: 'ver ›' });
    if (d.resumo.conferir) lista.push({ nivel: 'info', titulo: `Franquia: ${fmt.int(d.resumo.conferir)} ${d.resumo.conferir === 1 ? 'nota de compra com desconto' : 'notas de compra com desconto'} para conferir`, texto: 'O desconto não fechou com as devoluções em aberto.', link: '#creditos', ir: 'conferir ›', antes: () => { state.cfFil = 'todos'; } });
  }

  // ---------- site ----------
  async function avisosSite(lista) {
    if (!(TS.telasEstoque || []).includes('site')) return;
    const r = await fetch(TS.api('site'), { credentials: 'same-origin' });
    if (!r.ok) return;
    const d = await r.json();
    if (d.erro && d.erro.em && (!d.em || Date.parse(d.erro.em) > Date.parse(d.em))) lista.push({ nivel: 'warn', titulo: 'A última consulta ao site falhou', texto: d.erro.msg, link: '#site' });
    const ant = (d.anterior && d.anterior.precos) || {};
    if (!d.anterior || !d.itens) return;
    let promoNova = 0, mudou = 0;
    for (const x of d.itens) {
      const a = ant[x.id];
      if (!a) continue;
      if (a[1] == null && x.de != null) promoNova++;
      else if (Math.abs(a[0] - x.preco) >= 0.01 || (a[1] ?? null) !== (x.de ?? null)) mudou++;
    }
    if (promoNova || mudou) lista.push({ nivel: 'info', titulo: `Site: ${promoNova ? `${fmt.int(promoNova)} produto(s) entraram em promoção` : ''}${promoNova && mudou ? ' e ' : ''}${mudou ? `${fmt.int(mudou)} mudaram de preço` : ''}`, texto: `Desde a consulta de ${new Date(d.anterior.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.`, link: '#site', ir: 'ver no site ›', antes: () => { state.siteFiltro = 'mudou'; } });
  }

  // ---------- atualizações ----------
  async function avisosAtualizacoes(lista) {
    if (!(TS.eu && TS.eu.pode && TS.eu.pode.configurar) || TS.demo) return;
    const r = await fetch('/api/admin/estado', { credentials: 'same-origin' });
    if (!r.ok) return;
    const e = await r.json();
    const limite = Date.now() - 48 * 3600e3;
    for (const l of e.lojas || []) {
      if (state.loja && state.loja !== 'todas' && l.id !== state.loja) continue;
      const falhas = (l.eventos || []).filter((x) => x.ok === false && Date.parse(x.em) >= limite);
      if (falhas.length) {
        const NOME = { vendas: 'vendas', xml: 'XML', estoque: 'estoque', compras: 'notas de compra', caixa: 'caixa', fixe: 'FIXE', fixeEmail: 'FIXE' };
        lista.push({ nivel: 'erro', titulo: `${l.nome}: ${fmt.int(falhas.length)} atualização(ões) falharam nas últimas 48 h`, texto: [...new Set(falhas.map((x) => NOME[x.parte] || x.parte))].join(', '), acao: () => TS.abrirHistAtualizacoes(), ir: 'ver histórico ›' });
      }
    }
  }
})();
