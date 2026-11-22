/* Visão do dono no Início:
 *  - "Minhas lojas lado a lado" (com "Todas as lojas" escolhido): uma linha por loja, ordenada por quem mais precisa de atenção.
 *  - "Sua semana" (admin e franqueado, com uma loja escolhida): 5 números e até 3 ações priorizadas.
 *  - Aviso de validade (o que venceu e o que vence em 30 dias).
 * Nenhuma conta nova de venda: faturamento, atendimentos e vendas da meta vêm de TS.indicadores / TS.rules.vendasMeta, a
 * projeção de TS.projecaoMes, a margem de TS.dreContribDias (as linhas do Resultado), o zerado que vende de ruptura.js,
 * a validade de src/lotes.js (/api/validade). Aqui ficam só: a regra do "parado" e do "fora de linha" (usadas também pelo
 * Estoque), a janela da semana, os pontos de atenção de cada loja e a ordem das ações. Contas puras testadas em
 * tests/unit/visaodono.test.js. Custo só para quem vê custo: os dados vêm de rotas que já negam (/api/estoque, /api/validade). */
(function () {
  'use strict';
  const NODE = typeof module !== 'undefined' && module.exports;
  const RUP = () => (NODE ? require('./ruptura.js') : TS.ruptura);
  const DIA = 86400000;
  const diaDe = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DIA);

  /** produto fora de linha: indisponível no Sistema de Pedidos há `dias` (90) ou mais → a data desde quando; senão null.
   *  fl = { dias, indisp: { cod: 'AAAA-MM-DD' } } (src/pedido.js); hoje = dia (número) */
  function foraLinhaDe(fl, cod, hoje) {
    const d = fl && fl.indisp && fl.indisp[String(cod)];
    return d && hoje - diaDe(d) >= ((fl && fl.dias) || 90) ? d : null;
  }

  /** estoque parado: tem saldo e custo, não é fora de linha (esse é "liquidar") e não vende há `paradoDias` ou mais.
   *  Quem nunca vendeu só conta se for produto de revenda (PN) numa loja com código nas vendas (novoPN). */
  function ehParado({ qtd, custo, foraLinha, ult, fim, paradoDias, novoPN }) {
    const vendeu = ult != null;
    return !!(qtd > 0 && custo && !foraLinha && (vendeu || novoPN) && (!vendeu || fim - ult >= paradoDias));
  }

  /**
   * Resumo do estoque de UMA loja para a visão do dono, com as mesmas regras da tela Estoque:
   *   itens      itens do estoque ({ cod, un, qtd, custo, tipo })
   *   vendas     Map(cod → [{ d, q, v }]) das vendas de cada produto (sem taxas e resgates), como em ruptura.js
   *   ultima     Map(cod → dia da última saída)
   *   hoje       último dia com dados; inicio = primeiro dia com dados
   * → { zerados: { n, comConta, perdaDia }, parado: { n, valor }, valorEstoque }
   */
  function estoqueLoja({ itens, vendas, ultima, hoje, inicio, paradoDias, foraLinha, temCod }) {
    const R = RUP();
    const zerados = { n: 0, comConta: 0, perdaDia: 0 }, parado = { n: 0, valor: 0 };
    let valorEstoque = 0;
    for (const it of itens || []) {
      const cod = String(it.cod), qtd = Math.max(0, it.qtd || 0);
      const fl = foraLinha ? !!foraLinha(cod) : false;
      if (it.custo && qtd > 0) valorEstoque += qtd * it.custo;
      if (!fl && R.zerado(qtd, it.un)) {
        const p = R.perda({ vendas: (vendas && vendas.get(cod)) || [], qtd, un: it.un, hoje, inicio });
        if (p) { zerados.n++; if (p.perdaDia != null) { zerados.comConta++; zerados.perdaDia += p.perdaDia; } }
      }
      const ult = ultima && ultima.has(cod) ? ultima.get(cod) : null;
      if (ehParado({ qtd, custo: it.custo, foraLinha: fl, ult, fim: hoje, paradoDias, novoPN: !!temCod && it.tipo === 'PN' })) { parado.n++; parado.valor += qtd * it.custo; }
    }
    return { zerados, parado, valorEstoque };
  }

  /**
   * A semana do dono: de segunda até o último dia COMPLETO (hoje ainda está acontecendo), contra os mesmos dias da semana
   * anterior. hoje, maxDay, minDay = dias (número). → { u, de, ate, n, antDe, antAte } ou null (sem dia completo).
   */
  function semana(hoje, maxDay, minDay) {
    const u = maxDay >= hoje ? hoje - 1 : maxDay;
    if (!(u >= minDay)) return null;
    const wd = (new Date(u * DIA).getUTCDay() + 6) % 7; // 0 = segunda
    const de = u - wd, n = wd + 1;
    return { u, de, ate: u, n, antDe: de - 7, antAte: de - 7 + n - 1 };
  }

  /**
   * Pontos de atenção de uma loja (para ordenar "quem mais precisa de atenção" e para a coluna Avisos).
   *   l = { pctProj (vendas da meta projetadas ÷ meta), var28 (últimos 7 dias ÷ média semanal dos 28 anteriores − 1),
   *         vendaDia (faturamento médio por dia), zerados { n, perdaDia }, risco { vencidos, criticos }, parado { valor }, valorEstoque }
   * → { pontos, motivos: [texto] }. O que a pessoa não pode ver (ou a loja não tem) vem null e não pontua.
   */
  function atencao(l) {
    const m = [];
    let p = 0;
    const pct = (v) => `${Math.round(v * 100)}%`;
    if (l.pctProj != null && l.pctProj < 1) { p += l.pctProj < 0.9 ? 3 : 2; m.push(`projeção em ${pct(l.pctProj)} da meta`); }
    if (l.var28 != null && l.var28 <= -0.1) { p += l.var28 <= -0.2 ? 3 : 2; m.push(`vendas ${pct(-l.var28)} abaixo das últimas 4 semanas`); }
    if (l.zerados && l.zerados.n > 0) {
      const forte = l.vendaDia > 0 && l.zerados.perdaDia / l.vendaDia >= 0.03;
      p += forte ? 3 : 2; m.push(`${l.zerados.n} ${l.zerados.n === 1 ? 'produto zerado que vende' : 'produtos zerados que vendem'}`);
    }
    if (l.risco && l.risco.vencidos > 0) { p += 3; m.push(`${l.risco.vencidos} ${l.risco.vencidos === 1 ? 'lote de chá vencido' : 'lotes de chá vencidos'}`); }
    if (l.risco && l.risco.criticos > 0) { p += 1; m.push(`${l.risco.criticos} ${l.risco.criticos === 1 ? 'lote vence' : 'lotes vencem'} em até 30 dias`); }
    if (l.parado && l.valorEstoque > 0 && l.parado.valor / l.valorEstoque >= 0.15) { p += 1; m.push(`${pct(l.parado.valor / l.valorEstoque)} do estoque parado`); }
    return { pontos: p, motivos: m };
  }
  /** ordem das lojas: mais pontos primeiro; empate = a que mais caiu contra as 4 semanas; depois o nome */
  const ordenar = (linhas) => [...linhas].sort((a, b) => b.at.pontos - a.at.pontos || (a.var28 ?? 0) - (b.var28 ?? 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

  /**
   * Até 3 ações da semana, priorizadas pelo dinheiro em jogo. É só ordem: cada número já existe numa tela.
   *   c = { zerados { n, perdaDia }, vencidos { lotes, valor }, criticos { lotes, valor }, franquia { n, valor },
   *         parado { n, valor }, meta { falta, porDia, dias } } — o que não existe vem null.
   * Peso: vencido × 3 (tem de sair da venda), zerado = 30 dias de venda perdida, vence em 30 dias (a custo, se a pessoa vê custo) e franquia pelo valor,
   * parado × 0,1 (dinheiro que volta devagar). A meta só entra quando sobram menos de 3 ações.
   * → [{ tipo, n, valor, porDia, peso }]
   */
  function acoes(c, max = 3) {
    const l = [];
    const add = (tipo, x, peso) => { if (peso > 0) l.push({ tipo, ...x, peso }); };
    if (c.vencidos && c.vencidos.lotes > 0) add('vencidos', { n: c.vencidos.lotes, valor: c.vencidos.valor || 0 }, Math.max(1, (c.vencidos.valor || 0) * 3));
    if (c.zerados && c.zerados.n > 0) add('zerados', { n: c.zerados.n, porDia: c.zerados.perdaDia || 0 }, Math.max(1, (c.zerados.perdaDia || 0) * 30));
    if (c.criticos && c.criticos.lotes > 0) add('criticos', { n: c.criticos.lotes, valor: c.criticos.valor || 0, custo: !!c.criticos.custo }, Math.max(1, c.criticos.valor || 0));
    if (c.franquia && c.franquia.valor > 0) add('franquia', { n: c.franquia.n || 0, valor: c.franquia.valor }, c.franquia.valor);
    if (c.parado && c.parado.valor > 0) add('parado', { n: c.parado.n || 0, valor: c.parado.valor }, c.parado.valor * 0.1);
    l.sort((a, b) => b.peso - a.peso);
    const out = l.slice(0, max);
    if (out.length < max && c.meta && c.meta.falta > 0 && c.meta.dias > 0) out.push({ tipo: 'meta', valor: c.meta.falta, porDia: c.meta.porDia, n: c.meta.dias, peso: 0 });
    return out;
  }

  const API = { foraLinhaDe, ehParado, estoqueLoja, semana, atencao, ordenar, acoes };
  if (NODE) { module.exports = API; return; }

  // ======================= tela (só no navegador) =======================
  const { h, fmt, state } = TS;
  const veCusto = () => !!(TS.eu && TS.eu.pode && (TS.eu.pode.configurar || TS.eu.pode.custos));
  const veValidade = () => (TS.telasEstoque || []).includes('validade');
  const sub = (v, d) => h('span', null, v, d ? h('small', { class: 'vd-sub' }, d) : null);
  const IGN = ['lojas', 'vendedores', 'grupos', 'cats', 'produto'];

  /** índices de db.D.loja que são desta loja (nomes de venda do cadastro) */
  const idxLoja = (meta) => new Set(((meta && meta.nomesVenda) || []).map((n) => TS.db.D.loja.indexOf(n)).filter((x) => x >= 0));
  /** faturamento, atendimentos e vendas da meta de um intervalo; soLoja = Set de índices de loja (ou null = o filtro da tela) */
  function soma(de, ate, soLoja) {
    const db = TS.db;
    const idx = TS.filtrar({ de, ate, ignorar: soLoja ? IGN : IGN.slice(1), mesLivre: true, extra: soLoja ? (i) => soLoja.has(db.loja[i]) : null });
    const ind = TS.indicadores(idx);
    return { vt: ind.vt, cupons: ind.cupons, meta: TS.rules.vendasMeta(idx) };
  }

  /** estoque de uma loja (zerados que vendem, parado, valor): o motor de custos do Estoque com as vendas só dessa loja */
  async function estoqueDe(lojaId, soLoja) {
    if (!veCusto() || !TS.estoqueBuscar || !TS.motorEstoque) return null;
    const x = await TS.estoqueBuscar(lojaId);
    if (!x || !x.estoque || !x.estoque.itens || !x.estoque.itens.length) return null;
    const db = TS.db, M = TS.motorEstoque(x.estoque, x.cfg);
    const alvo = new Map(), ultima = new Map(), hojeD = TS.todayDay();
    let fimLoja = -Infinity; // o último dia com venda DESTA loja: o mesmo "hoje" da tela Estoque dela (com "Todas as lojas", db.maxDay é o de qualquer loja)
    const fl = (cod) => foraLinhaDe(x.foraDeLinha, cod, hojeD);
    for (const it of x.estoque.itens) if (!fl(it.cod) && TS.ruptura.zerado(Math.max(0, it.qtd || 0), it.un)) alvo.set(String(it.cod), []);
    for (let i = 0; i < db.n; i++) {
      if (soLoja && !soLoja.has(db.loja[i])) continue;
      const d = db.day[i];
      if (d > fimLoja) fimLoja = d;
      for (const [it] of M.consumo(i)) { const k = String(it.cod); if (!ultima.has(k) || d > ultima.get(k)) ultima.set(k, d); }
      if (M.taxa(i)) continue;
      const c = M.casar(i), l = c && alvo.get(String(c.it.cod));
      if (l) { const q = db.qtd[i] || 0; l.push({ d, q: c.kg ? (q * c.g) / 1000 : q, v: db.vt[i] || 0 }); }
    }
    return estoqueLoja({ itens: x.estoque.itens, vendas: alvo, ultima, hoje: Number.isFinite(fimLoja) ? fimLoja : db.maxDay, inicio: db.minDay, paradoDias: (x.cfg && x.cfg.paradoDias) || 60, foraLinha: fl, temCod: !!(db.D.cod && db.D.cod.some((c) => c)) });
  }
  /** validade de uma loja: valor em risco (< 60 dias, com os vencidos), vencidos e o que vence em 30 dias */
  async function validadeDe(lojaId) {
    if (!veValidade() || !TS.validade) return null;
    const d = await TS.validade.dados(lojaId);
    const r = d.resumo, pf = r.porFaixa;
    return { d, custos: !!d.custos, dias: d.riscoDias, lotes: r.risco.lotes, kg: r.risco.kg, custo: d.custos ? r.risco.custo : null, venda: r.risco.venda,
      vencidos: pf.vencido.lotes, criticos: pf.critica.lotes, pf };
  }
  const quieto = (p) => p.catch(() => null);

  // ---------- minhas lojas lado a lado ----------
  async function linhaLoja(L) {
    const db = TS.db, meta = (db.metas || []).find((m) => m.id === L.id) || null, so = idxLoja(meta);
    const hojeD = TS.todayDay(), u = db.maxDay >= hojeD ? hojeD - 1 : db.maxDay;
    const ym = TS.dayToIso(db.maxDay).slice(0, 7), ini = TS.isoToDay(ym + '-01');
    const mes = soma(ini, db.maxDay, so);
    const metaV = meta ? TS.metaCalc(ym, new Set(meta.nomesVenda || [])).valor : null;
    const P = TS.projecaoMes(ym, { base: 'loja', lojaId: L.id }), Pm = metaV ? TS.projecaoMes(ym, { base: 'meta', lojaId: L.id }) : null;
    const s7 = soma(u - 6, u, so), s28 = soma(u - 34, u - 7, so);
    const var28 = s28.vt > 0 && u - 34 >= db.minDay ? s7.vt / (s28.vt / 4) - 1 : null;
    const [est, val] = await Promise.all([quieto(estoqueDe(L.id, so)), quieto(validadeDe(L.id))]);
    const l = { id: L.id, nome: L.nome, fat: mes.vt, cupons: mes.cupons, ticket: mes.cupons ? mes.vt / mes.cupons : null, vendasMeta: mes.meta, meta: metaV,
      pctMeta: metaV ? mes.meta / metaV : null, proj: P ? P.proj : null, projMeta: Pm ? Pm.proj : null, pctProj: metaV && Pm ? Pm.proj / metaV : null,
      var28, vendaDia: s28.vt > 0 ? s28.vt / 28 : null, zerados: est ? est.zerados : null, parado: est ? est.parado : null, valorEstoque: est ? est.valorEstoque : null, risco: val };
    l.at = atencao(l);
    return l;
  }
  function trocarLoja(id) {
    const sel = document.getElementById('lojaSel');
    if (!sel || ![...sel.options].some((o) => o.value === id)) return;
    sel.value = id;
    sel.dispatchEvent(new Event('change'));
  }
  /** cartão "Minhas lojas lado a lado" (Início com "Todas as lojas"); null para quem tem uma loja só ou é vendedora */
  API.mostraLojas = () => !!(TS.db && TS.db.n && state.loja === 'todas' && (TS.lojas || []).length > 1 && TS.eu && TS.eu.perfil !== 'vendedor');
  API.tabelaLojas = function () {
    if (!API.mostraLojas()) return null;
    const corpo = h('div', { class: 'muted' }, 'Comparando as lojas…');
    const custo = veCusto();
    const card = TS.card('Minhas lojas lado a lado', 'No topo, a loja que mais precisa de atenção. Clique numa loja para ver os avisos dela.', corpo);
    card.classList.add('vd-lojas');
    Promise.all(TS.lojas.map((L) => linhaLoja(L))).then((linhas) => {
      if (!card.isConnected) return;
      const rows = ordenar(linhas);
      const riscoV = (r) => (r.risco ? (custo && r.risco.custo != null ? r.risco.custo : r.risco.venda) : null);
      const cols = [
        { key: 'nome', label: 'Loja', align: 'l', sticky: true, wrap: true, title: 'As lojas que você acompanha. A ordem é por pontos de atenção (veja a coluna Avisos); no empate, vem antes a que mais caiu contra as últimas 4 semanas. Clique para trocar para a loja.',
          render: (r) => h('button', { type: 'button', class: 'vd-loja', onclick: (e) => { e.stopPropagation(); trocarLoja(r.id); } }, h('b', null, r.nome)) },
        { key: 'fat', label: 'Vendas do mês', title: 'Faturamento da loja no mês até agora (com Espaço Gourmet e vendas sem vendedor; sem taxas e sem itens a R$ 0,01): o mesmo número do Resumo e do Resultado. Embaixo, o ticket médio = faturamento ÷ atendimentos (cupons únicos).',
          render: (r) => sub(fmt.brl0(r.fat), r.ticket != null ? `ticket ${fmt.brl(r.ticket)}` : null), sortVal: (r) => r.fat },
        { key: 'pctMeta', label: 'Meta e projeção', title: 'Em cima: vendas da meta do mês (chá aromatizado, chá puro e acessórios, sem Espaço Gourmet — a base do Comissionamento) ÷ meta da loja. Embaixo: a projeção do faturamento do mês (vendas até ontem + cada dia que falta pela média do mesmo dia da semana nas últimas 8 semanas; dia de loja fechada conta zero — a mesma conta do Início e do Resultado) e o % da meta que as vendas da meta projetadas alcançam. "—" = loja sem meta cadastrada ou mês fechado.',
          render: (r) => sub(r.pctMeta == null ? '—' : `${fmt.pct(r.pctMeta, 0)} da meta`, r.proj == null ? (r.meta ? `meta ${fmt.brl0(r.meta)}` : 'sem meta') : h('span', { class: r.pctProj == null ? null : r.pctProj >= 1 ? 'pos' : 'neg' }, `projeção ${fmt.brl0(r.proj)}${r.pctProj != null ? ` · ${fmt.pct(r.pctProj, 0)} da meta` : ''}`)), sortVal: (r) => r.pctProj ?? r.pctMeta ?? -1 },
        { key: 'var28', label: '× 28 dias', title: 'Faturamento dos últimos 7 dias completos comparado com a média por semana dos 28 dias anteriores. Negativo = a loja está vendendo menos que o ritmo dela. "—" = menos de 5 semanas de vendas no painel.',
          render: (r) => (r.var28 == null ? '—' : TS.deltaSpan(r.var28)), sortVal: (r) => r.var28 ?? -9 },
        ...(custo ? [{ key: 'zer', label: 'Zerados que vendem', title: 'Produtos com saldo zero (chá a granel: menos de 50 g) que venderam nos últimos 90 dias, fora os fora de linha. Embaixo, quanto eles vendiam por dia nos 60 dias antes de zerar (estimativa a preço de venda): é o que a loja deixa de vender. A mesma conta de Estoque → Perdendo venda.',
          render: (r) => (!r.zerados ? '—' : sub(h('b', { class: r.zerados.n ? 'neg' : null }, fmt.int(r.zerados.n)), r.zerados.comConta ? `${fmt.brl0(r.zerados.perdaDia)}/dia` : null)), sortVal: (r) => (r.zerados ? r.zerados.perdaDia || r.zerados.n / 1e6 : -1) }] : []),
        { key: 'risco', label: 'Validade em risco', title: `Chá a granel que vence em menos de 60 dias, com os vencidos${custo ? ', a custo (o que a loja perde se vencer)' : ', a preço de venda'}. Embaixo, quantos lotes e quantos já venceram. Os lotes são os de Estoque → Validade.`,
          render: (r) => (!r.risco ? '—' : sub(fmt.brl0(riscoV(r)), `${fmt.int(r.risco.lotes)} ${r.risco.lotes === 1 ? 'lote' : 'lotes'}${r.risco.vencidos ? ` · ${fmt.int(r.risco.vencidos)} vencido${r.risco.vencidos === 1 ? '' : 's'}` : ''}`)), sortVal: (r) => riscoV(r) ?? -1 },
        ...(custo ? [{ key: 'par', label: 'Estoque parado', title: 'Produtos com saldo que não vendem há 60 dias ou mais (o prazo de cada loja fica em Configurações → Estoque e margem), a custo: dinheiro parado na prateleira. Fora de linha não entra (é "liquidar"). A mesma conta do quadro Estoque parado.',
          render: (r) => (!r.parado ? '—' : sub(fmt.brl0(r.parado.valor), `${fmt.int(r.parado.n)} ${r.parado.n === 1 ? 'produto' : 'produtos'}`)), sortVal: (r) => (r.parado ? r.parado.valor : -1) }] : []),
        { key: 'avisos', label: 'Avisos', align: 'l', wrap: true, title: 'Pontos de atenção da loja nesta tabela: projeção abaixo da meta, vendas 10% ou mais abaixo das últimas 4 semanas, produto zerado que vende, chá vencido, lote que vence em 30 dias e 15% ou mais do estoque parado. Os mais graves (projeção abaixo de 90% da meta, queda de 20%, chá vencido) pesam mais na ordem. Os avisos completos aparecem ao abrir a loja.',
          render: (r) => (r.at.motivos.length ? h('span', null, h('span', { class: 'badge ' + (r.at.pontos >= 5 ? 'erro' : 'warn') }, `${fmt.int(r.at.motivos.length)} ${r.at.motivos.length === 1 ? 'aviso' : 'avisos'}`), h('small', { class: 'vd-sub' }, r.at.motivos.join(' · '))) : h('span', { class: 'badge ok' }, 'tudo certo')), sortVal: (r) => r.at.pontos },
      ];
      corpo.className = '';
      corpo.replaceChildren(TS.table({ cols, rows, sortKey: null, maxHeight: 'free', cls: 'vd-t', cartao: true, onRowClick: (r) => trocarLoja(r.id), empty: 'Nenhuma loja para comparar.' }));
    }).catch((e) => { if (card.isConnected) { corpo.className = 'notice err'; corpo.textContent = TS.erroDeRede && TS.erroDeRede(e) ? 'Sem conexão para comparar as lojas. Tente de novo.' : 'Não consegui comparar as lojas agora.'; console.error(e); } });
    return card;
  };

  // ---------- aviso de validade no Início ----------
  API.avisosValidade = async function (lista) {
    if (!state.loja || state.loja === 'todas') return;
    const v = await validadeDe(state.loja);
    if (!v) return;
    const kg = (x) => `${fmt.kg(x)} kg`;
    const nomes = (faixa) => v.d.lotes.filter((l) => l.faixa === faixa).slice(0, 3).map((l) => `${l.desc} (${l.dias < 0 ? `venceu há ${fmt.int(-l.dias)} d` : `${fmt.int(l.dias)} d`})`).join(', ');
    const valor = (p) => (v.custos && p.custo != null ? ` · ${fmt.brl0(p.custo)} a custo` : '');
    const ven = v.pf.vencido, cri = v.pf.critica;
    if (ven.lotes) lista.push({ nivel: 'erro', topo: 'vencidos', titulo: `Validade: ${fmt.int(ven.lotes)} ${ven.lotes === 1 ? 'lote de chá vencido' : 'lotes de chá vencidos'} (${kg(ven.kg)}${valor(ven)})`,
      texto: `Retire da venda e lance a perda no AppNext. ${nomes('vencido')}${ven.lotes > 3 ? ` e mais ${ven.lotes - 3}` : ''}.`, link: '#validade', ir: 'ver os vencidos ›', antes: () => { state.valFaixa = 'vencido'; } });
    if (cri.lotes) lista.push({ nivel: 'warn', id: 'val-30', topo: 'criticos', titulo: `Validade: ${fmt.int(cri.lotes)} ${cri.lotes === 1 ? 'lote de chá vence' : 'lotes de chá vencem'} em até 30 dias (${kg(cri.kg)}${valor(cri)})`,
      texto: `Ofereça primeiro ou faça uma promoção antes de perder. ${nomes('critica')}${cri.lotes > 3 ? ` e mais ${cri.lotes - 3}` : ''}.`, link: '#validade', ir: 'ver os lotes ›', antes: () => { state.valFaixa = 'critica'; } });
  };

  // ---------- "Sua semana" ----------
  const CHAVE_SEM = 'teashop.ini.semana';
  API.mostraSemana = () => !!(TS.db && TS.db.n && state.loja && state.loja !== 'todas' && TS.eu && ['admin', 'franqueado'].includes(TS.eu.perfil));
  const DS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  /** texto, destino e explicação de cada ação */
  function acaoTela(a, ctx) {
    const pl = (n, um, mais) => `${fmt.int(n)} ${n === 1 ? um : mais}`;
    if (a.tipo === 'zerados') return { titulo: `Pedir ${pl(a.n, 'produto zerado que vende', 'produtos zerados que vendem')}${a.porDia > 0 ? ` ${fmt.brl0(a.porDia)}/dia` : ''}`, texto: 'Estão sem saldo e vendiam: cada dia sem eles é venda perdida.', link: ctx.temPedido ? '#pedido' : '#estoque', ir: ctx.temPedido ? 'montar o pedido ›' : 'ver quais ›', antes: () => { state.estSit = 'falta'; state.pedFiltro = 'pedido'; } };
    if (a.tipo === 'vencidos') return { titulo: `Retirar da venda ${pl(a.n, 'lote de chá vencido', 'lotes de chá vencidos')}${a.valor > 0 ? ` (${fmt.brl0(a.valor)} a custo)` : ''}`, texto: 'Chá vencido não pode ser vendido: tire da prateleira e lance a perda no AppNext.', link: '#validade', ir: 'ver os vencidos ›', antes: () => { state.valFaixa = 'vencido'; } };
    if (a.tipo === 'criticos') return { titulo: `Liquidar ${pl(a.n, 'lote que vence', 'lotes que vencem')} em até 30 dias${a.valor > 0 ? ` (${fmt.brl0(a.valor)} ${a.custo ? 'a custo' : 'a preço de venda'})` : ''}`, texto: 'Ofereça primeiro ou faça uma promoção antes de virar perda.', link: '#validade', ir: 'ver os lotes ›', antes: () => { state.valFaixa = 'critica'; } };
    if (a.tipo === 'franquia') return { titulo: `Cobrar ${fmt.brl0(a.valor)} da franquia`, texto: `${pl(a.n, 'devolução sem desconto', 'devoluções sem desconto')} há mais de ${ctx.prazoFranquia || 30} dias.`, link: '#creditos', ir: 'ver os créditos ›', antes: () => { state.cfFil = 'atrasado'; } };
    if (a.tipo === 'parado') return { titulo: `Girar ${fmt.brl0(a.valor)} de estoque parado (${pl(a.n, 'produto', 'produtos')})`, texto: 'Têm saldo e não vendem: vale promoção, vitrine ou devolução.', link: '#estoque', ir: 'ver os parados ›', antes: () => { state.estSit = 'parados'; } };
    return { titulo: `Vender ${fmt.brl0(a.porDia)} por dia para bater a meta`, texto: `Faltam ${fmt.brl0(a.valor)} em vendas da meta e ${pl(a.n, 'dia', 'dias')} de loja aberta.`, link: null, rolar: '.md-card', ir: 'ver a meta de hoje ↓', antes: null };
  }
  /** opts.aoAcoes(tipos) = avisa quais ações foram para "O que fazer primeiro" (o Início marca o aviso igual na lista) */
  API.blocoSemana = function (opts = {}) {
    if (!API.mostraSemana()) return null;
    const db = TS.db, hojeD = TS.todayDay();
    const S = semana(hojeD, db.maxDay, db.minDay);
    if (!S) return null;
    const br = (d) => fmt.date(TS.dayToIso(d)).slice(0, 5);
    const periodo = S.n === 1 ? `${DS[0]} (${br(S.de)})` : `de segunda a ${DS[S.n - 1]} (${br(S.de)} a ${br(S.ate)})`;
    const cur = soma(S.de, S.ate, null), ant = S.antDe >= db.minDay ? soma(S.antDe, S.antAte, null) : null;
    const ym = TS.dayToIso(db.maxDay).slice(0, 7), ini = TS.isoToDay(ym + '-01');
    const mes = soma(ini, db.maxDay, null), meta = TS.metaCalc(ym).valor;
    const Pm = meta ? TS.projecaoMes(ym, { base: 'meta' }) : null;
    const dv = ant && ant.vt > 0 ? cur.vt / ant.vt - 1 : null;
    const kVendas = TS.kpi('Vendas da semana', fmt.brl0(cur.vt), dv == null ? `${S.n} ${S.n === 1 ? 'dia' : 'dias'} · sem a semana anterior para comparar` : h('span', null, TS.deltaSpan(dv), ` vs. ${fmt.brl0(ant.vt)} nos mesmos ${S.n === 1 ? 'dia' : `${S.n} dias`} da semana anterior`),
      `Faturamento da loja ${periodo}: de segunda até o último dia completo (hoje ainda está acontecendo e fica de fora).\n\nComparado com os mesmos dias da semana anterior (${br(S.antDe)} a ${br(S.antAte)}), para não comparar uma semana pela metade com uma inteira.\n\nÉ o mesmo faturamento do Resumo: com Espaço Gourmet e vendas sem vendedor, sem taxas e sem itens a R$ 0,01.`);
    const kMeta = TS.kpi('Meta do mês', meta ? fmt.pct(mes.meta / meta, 0) : '—', !meta ? 'sem meta cadastrada' : Pm ? h('span', { class: Pm.proj >= meta ? 'up' : 'down' }, `vendas da meta projetadas ${fmt.brl0(Pm.proj)} = ${fmt.pct(Pm.proj / meta, 0)} da meta`) : `${fmt.brl0(mes.meta)} de ${fmt.brl0(meta)}`,
      meta ? `Vendas da meta do mês (${fmt.brl0(mes.meta)}: chá aromatizado, chá puro e acessórios, sem Espaço Gourmet) ÷ meta da loja (${fmt.brl0(meta)}).${Pm ? '\n\nProjeção:\n' + TS.comoProjecao(Pm) : ''}` : 'Cadastre a meta do mês em Configurações → Lojas.');
    const kMargem = TS.kpi('Margem de contribuição da semana', '…', 'calculando…', '');
    const kZer = TS.kpi('Zerados que vendem', '…', 'conferindo o estoque…', '');
    const kVal = TS.kpi('Validade em risco', '…', 'conferindo os lotes…', '');
    const trocar = (velho, novoK) => { if (velho.isConnected) velho.replaceWith(novoK); return novoK; };
    const lista = h('div', { class: 'vd-acoes' }, h('p', { class: 'muted' }, 'Escolhendo as ações da semana…'));
    let aberto = true;
    try { aberto = localStorage.getItem(CHAVE_SEM) !== 'fechado'; } catch { /* sem armazenamento: começa aberto */ }
    const box = h('details', { class: 'vd-semana', open: aberto || null },
      h('summary', { class: 'vd-sem-t' }, h('span', { class: 'card-title' }, 'Sua semana'), h('span', { class: 'muted vd-sem-p' }, periodo)),
      h('div', { class: 'grid g-kpi vd-sem-k' }, kVendas, kMeta, kMargem, kZer, kVal),
      h('div', { class: 'card vd-acoes-card' }, h('div', { class: 'card-title vd-acoes-t' }, 'O que fazer primeiro', TS.dica('Até 3 ações, na ordem do dinheiro em jogo. Não é conta nova: cada número vem de uma tela do painel.\n\nChá vencido vem na frente (tem de sair da venda; peso de 3× o valor a custo). Produto zerado conta 30 dias da venda que ele fazia por dia. Lote que vence em 30 dias conta o valor a custo (a preço de venda para quem não vê custo), o mesmo do quadro Validade em risco; crédito atrasado da franquia, o valor a receber; estoque parado, 10% do valor a custo (dinheiro que volta devagar). A meta do mês entra quando sobra espaço.')),
        lista));
    box.addEventListener('toggle', () => { try { localStorage.setItem(CHAVE_SEM, box.open ? 'aberto' : 'fechado'); } catch { /* ok */ } });
    const telas = TS.telasEstoque || [];
    (async () => {
      const meuDb = TS.db;
      const franquia = telas.includes('notas') ? quieto(fetch(TS.api(`conta-franquia?loja=${encodeURIComponent(state.loja)}`), { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null))) : Promise.resolve(null);
      const [M, est, val, cf] = await Promise.all([quieto(TS.custosLoja()), quieto(estoqueDe(state.loja, null)), quieto(validadeDe(state.loja)), franquia]);
      if (!box.isConnected || TS.db !== meuDb) return;
      const C = M && TS.dreContribDias ? TS.dreContribDias(M, S.de, S.ate) : null;
      trocar(kMargem, TS.kpi('Margem de contribuição da semana', C && C.contrib != null ? fmt.brl0(C.contrib) : '—', C && C.contrib != null && C.fat > 0 ? `${fmt.pct(C.contrib / C.fat)} do faturamento` : 'sem o custo dos produtos desta loja',
        `O que sobrou das vendas ${periodo} para pagar os custos fixos: faturamento − Simples, maquininha e royalties − custo dos produtos − comissões − custos em %. As mesmas linhas do Resultado do mês, só nesses dias (sem as perdas e sem os custos fixos, que são do mês).${C && C.cobre < 0.95 ? `\n\n${fmt.pct(1 - C.cobre, 0)} das vendas da semana não têm custo no estoque: entraram pelo mesmo % das outras (estimado).` : ''}\n\nA comissão usa o % efetivo do mês até agora.`, C && C.contrib != null ? (C.contrib >= 0 ? null : 'ruim') : null));
      trocar(kZer, TS.kpi('Zerados que vendem', est ? fmt.int(est.zerados.n) : '—', !est ? 'sem o estoque desta loja' : est.zerados.n ? h('span', { class: 'down' }, est.zerados.comConta ? `perdendo ${fmt.brl0(est.zerados.perdaDia)}/dia` : 'pouco histórico para estimar') : 'nenhum produto zerado que vendia',
        'Produtos com saldo zero (chá a granel: menos de 50 g) que venderam nos últimos 90 dias, fora os fora de linha. "Perdendo R$/dia" = quanto eles vendiam por dia nos 60 dias antes de zerar, a preço de venda (estimativa: o painel considera que zerou no dia da última venda). A mesma conta de Estoque → Perdendo venda.'));
      const rv = val ? (val.custo != null ? val.custo : val.venda) : null;
      trocar(kVal, TS.kpi('Validade em risco', val ? fmt.brl0(rv) : '—', !val ? 'sem os lotes desta loja' : h('span', { class: val.vencidos ? 'down' : null }, `${fmt.int(val.lotes)} ${val.lotes === 1 ? 'lote' : 'lotes'} em menos de ${val.dias} dias${val.vencidos ? ` · ${fmt.int(val.vencidos)} vencido${val.vencidos === 1 ? '' : 's'}` : ''}`),
        `Chá a granel que vence em menos de ${val ? val.dias : 60} dias, com os vencidos, ${val && val.custo != null ? 'a custo (saldo do lote × custo do kg): o que a loja perde se vencer' : 'a preço de venda'}. Os lotes são os de Estoque → Validade.`));
      // dias de loja aberta que faltam (com hoje), como no cartão "Meta de hoje"
      const cfg = (db.metas || []).find((m) => m.id === state.loja) || null;
      const ultimo = TS.isoToDay(`${ym}-${String(TS.contas.diasNoMes(ym)).padStart(2, '0')}`);
      let restam = 0;
      for (let d = Math.max(hojeD, ini); d <= ultimo; d++) if (TS.lojaAberta(cfg, TS.dayToIso(d))) restam++;
      const faltaMeta = meta && Pm && Pm.proj < meta ? Math.max(0, meta - mes.meta) : 0;
      const as = acoes({
        zerados: est ? est.zerados : null,
        vencidos: val && val.vencidos ? { lotes: val.vencidos, valor: val.custo != null ? val.pf.vencido.custo : 0 } : null,
        criticos: val && val.criticos ? { lotes: val.criticos, valor: val.custo != null && val.pf.critica.custo != null ? val.pf.critica.custo : val.pf.critica.venda, custo: val.custo != null && val.pf.critica.custo != null } : null,
        franquia: cf && cf.resumo && cf.resumo.nAtrasado ? { n: cf.resumo.nAtrasado, valor: cf.resumo.atrasado } : null,
        parado: est ? est.parado : null,
        meta: faltaMeta > 0 && restam > 0 ? { falta: faltaMeta, porDia: faltaMeta / restam, dias: restam } : null,
      });
      const ctx = { temPedido: telas.includes('pedido'), prazoFranquia: cf && cf.prazo };
      if (opts.aoAcoes) opts.aoAcoes(as.map((a) => a.tipo));
      lista.replaceChildren(...(as.length ? as.map((a, k) => {
        const t = acaoTela(a, ctx);
        const ir = () => { if (t.antes) t.antes(); if (t.rolar) { const el = document.querySelector(t.rolar); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else location.hash = t.link; };
        return h('div', { class: 'vd-acao', role: 'button', tabindex: '0', 'data-acao': a.tipo, onclick: ir, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } } },
          h('span', { class: 'vd-acao-n' }, String(k + 1)), h('div', null, h('b', null, t.titulo), h('div', { class: 'muted' }, t.texto)), h('span', { class: 'ini-ir' }, t.ir));
      }) : [h('p', { class: 'muted' }, 'Nada urgente esta semana: sem produto zerado que vende, sem chá perto de vencer e a meta no ritmo. 👏')]));
    })().catch((e) => { console.error(e); if (lista.isConnected) lista.replaceChildren(h('p', { class: 'muted' }, 'Não consegui montar as ações agora.')); });
    return box;
  };

  TS.visaoDono = API;
})();
