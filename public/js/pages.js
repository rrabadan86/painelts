/* Páginas: Resumo, Comparativos, Comissionamento, Promoção + painel de filtros */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  const R = () => TS.rules;

  // ======================= PERÍODO =======================
  const PRESETS = [
    ['Hoje', 'hoje'], ['Semana atual', 'semana'], ['Mês atual', 'mes'], ['Mês anterior', 'mesAnt'], ['28 dias', '30d'], ['Ano atual', 'ano'], ['12 meses', '12m'], ['Tudo', 'tudo'],
  ];
  TS.PRESETS = PRESETS;
  /** referência = último dia com venda (evita "mês atual" vazio quando a planilha ainda não foi atualizada) */
  TS.aplicarPreset = function (p, f = state.f) {
    const db = TS.db;
    const ref = new Date(db.maxDay * 86400000);
    const y = ref.getUTCFullYear(), m = ref.getUTCMonth();
    const d = (yy, mm, dd) => Math.floor(Date.UTC(yy, mm, dd) / 86400000);
    f.preset = p; f.ano = null; f.mes = null;
    if (p === 'hoje') { f.de = TS.todayDay(); f.ate = f.de; }
    else if (p === 'semana') { const hj = TS.todayDay(); const wd = (new Date(hj * 86400000).getUTCDay() + 6) % 7; f.de = hj - wd; f.ate = f.de + 6; } // segunda a domingo
    else if (p === 'mes') { f.de = d(y, m, 1); f.ate = db.maxDay; }
    else if (p === 'mesAnt') { f.de = d(y, m - 1, 1); f.ate = d(y, m, 0); }
    // "28 dias" (4 semanas inteiras: mesma quantidade de cada dia da semana; a chave continua '30d' por causa do estado salvo)
    else if (p === '30d') { f.de = db.maxDay - 27; f.ate = db.maxDay; }
    else if (p === 'ano') { f.de = d(y, 0, 1); f.ate = db.maxDay; }
    else if (p === '12m') { f.de = d(y, m - 11, 1); f.ate = db.maxDay; }
    else if (p === 'tudo') { f.de = null; f.ate = null; }
  };
  /** combos Ano / Mês: ano+mês = aquele mês; só ano = o ano todo; só mês = aquele mês em todos os anos */
  TS.aplicarAnoMes = function (ano, mes, f = state.f, padrao = '30d') {
    const d = (yy, mm, dd) => Math.floor(Date.UTC(yy, mm, dd) / 86400000);
    f.ano = ano || null; f.mes = mes || null;
    if (!f.ano && !f.mes) { TS.aplicarPreset(padrao, f); return; }
    f.preset = 'anomes';
    if (f.ano && f.mes) { f.de = d(f.ano, f.mes - 1, 1); f.ate = d(f.ano, f.mes, 0); }
    else if (f.ano) { f.de = d(f.ano, 0, 1); f.ate = d(f.ano, 11, 31); }
    else { f.de = null; f.ate = null; }
  };
  TS.MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  TS.periodoTexto = function () {
    const f = state.f;
    if (f.preset === 'anomes') {
      if (f.ano && f.mes) return `${TS.MESES_LONGOS[f.mes - 1]} de ${f.ano}`;
      if (f.ano) return `Ano de ${f.ano}`;
      return `${TS.MESES_LONGOS[f.mes - 1]} (todos os anos)`;
    }
    if (f.preset === 'hoje') return `Hoje · ${fmt.date(TS.dayToIso(f.de))}`;
    if (f.preset === 'semana') return `Semana atual · ${fmt.date(TS.dayToIso(f.de))} a ${fmt.date(TS.dayToIso(f.ate))}`;
    if (f.de == null && f.ate == null) return 'Todo o histórico';
    return `${fmt.date(TS.dayToIso(f.de ?? TS.db.minDay))} a ${fmt.date(TS.dayToIso(f.ate ?? TS.db.maxDay))}`;
  };

  /** Período (datas + atalhos) e Ano e mês: o mesmo bloco em todas as telas; f = onde guarda (state.f ou o período dos Clientes) */
  TS.blocoPeriodo = function (f, rerender, { padrao = '30d', rotulo = 'Período', dica = null } = {}) {
    const db = TS.db;
    const de = h('input', { class: 'f-input', type: 'date', min: TS.dayToIso(db.minDay), max: TS.dayToIso(db.maxDay), value: f.de != null ? TS.dayToIso(f.de) : '' });
    const ate = h('input', { class: 'f-input', type: 'date', min: TS.dayToIso(db.minDay), max: TS.dayToIso(db.maxDay), value: f.ate != null ? TS.dayToIso(f.ate) : '' });
    const onDate = () => { f.de = de.value ? TS.isoToDay(de.value) : null; f.ate = ate.value ? TS.isoToDay(ate.value) : null; f.preset = 'custom'; f.ano = null; f.mes = null; rerender(); };
    TS.aoConfirmar(de, onDate); TS.aoConfirmar(ate, onDate);
    const chips = h('div', { class: 'chips' }, PRESETS.map(([lab, p]) => h('button', { type: 'button', class: 'chip' + (f.preset === p ? ' on' : ''), onclick: () => { TS.aplicarPreset(p, f); rerender(); } }, lab)));
    const anos = [];
    const anoIni = db.inicio ? +db.inicio.slice(0, 4) : new Date(db.minDay * 86400000).getUTCFullYear();
    for (let y = new Date(db.maxDay * 86400000).getUTCFullYear(); y >= anoIni; y--) anos.push(y);
    const selAno = h('select', { class: 'f-input', 'aria-label': 'Ano' }, h('option', { value: '' }, 'Todos'),
      anos.map((y) => h('option', { value: y, selected: f.ano === y || null }, String(y))));
    const selMes = h('select', { class: 'f-input', 'aria-label': 'Mês' }, h('option', { value: '' }, 'Todos'),
      TS.MESES_LONGOS.map((m, k) => h('option', { value: k + 1, selected: f.mes === k + 1 || null }, m)));
    const onAnoMes = () => { TS.aplicarAnoMes(+selAno.value || null, +selMes.value || null, f, padrao); rerender(); };
    selAno.addEventListener('change', onAnoMes); selMes.addEventListener('change', onAnoMes);
    return [h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, rotulo), h('div', { class: 'f-row' }, de, ate), chips, dica || null),
      h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Ano e mês'),
      h('div', { class: 'f-row anomes' }, h('label', null, h('span', null, 'Ano'), selAno), h('label', null, h('span', null, 'Mês'), selMes)),
      h('div', { class: 'f-hint' }, 'Só o mês = aquele mês em todos os anos.'),
      db.desde && !TS.historicoCompleto ? h('div', { class: 'f-hint' }, `Carregado desde ${fmt.date(db.desde)} (mais leve). `, h('button', { type: 'button', class: 'link-btn', onclick: () => TS.carregarTudo() }, `Carregar desde ${fmt.date(db.inicio)}`)) : null)];
  };

  // ======================= PAINEL DE FILTROS =======================
  TS.renderFiltros = function () {
    const box = document.getElementById('filtros');
    box.textContent = '';
    if (state.page === 'clientes' || state.page === 'clilista') { box.append(TS.filtrosClientes()); return; }
    if (state.page === 'campanhas') { box.append(h('div', { class: 'f-hint' }, 'Nas campanhas os critérios ficam na própria campanha (Criar campanha). Os clientes considerados são de todo o histórico.')); return; }
    const db = TS.db, f = state.f, rerender = () => TS.render();
    // só os filtros que a tela usa (os outros somem e uma frase diz por quê)
    const USO = {
      precos: [['periodo', 'produto'], 'Preços: o período marca o "antes" e o "agora" dos reajustes.'],
      site: [['produto'], 'Site: mostra os preços da última consulta ao site (não usa o período).'],
      estoque: [['produto'], 'Estoque de agora; a reposição usa o ritmo das últimas semanas (não usa o período).'],
      pedido: [['produto'], 'Pedido: estoque de agora e a previsão de venda (não usa o período). O produto só filtra a tabela.'],
      notas: [['periodo'], 'Notas fiscais: o período vale na aba "No período".'],
      nfsaida: [['periodo'], 'Notas fiscais: o período vale na aba "No período".'],
      creditos: [[], 'Créditos com a franquia: mostra tudo, sem período.'],
      orcamento: [[], 'O orçamento não usa estes filtros.'],
      checklist: [[], 'O checklist não usa estes filtros.'],
      conferencia: [[], 'A conferência mostra sempre os últimos 60 dias e não usa estes filtros.'],
      dre: [[], 'O Resultado mostra mês a mês e não usa estes filtros.'],
      inicio: [[], 'O Início mostra o que pede atenção hoje e não usa estes filtros.'],
      espera: [[], 'A lista de espera não usa estes filtros.'],
      inventario: [[], 'O inventário não usa estes filtros.'],
    }[state.page];
    const usa = (k) => !USO || USO[0].includes(k);
    if (USO) box.append(h('div', { class: 'f-hint f-uso' }, USO[1]));

    // período
    if (usa('periodo')) box.append(...TS.blocoPeriodo(f, rerender));

    const opts = (list) => list.map(([s, i]) => [s, i]);
    if (usa('lojas') && db.opts.lojas.length > 1) box.append(TS.multiSelect({ label: 'Loja', options: opts(db.opts.lojas), selected: f.lojas, onChange: rerender, placeholder: 'Todas as lojas' }));
    if (usa('vendedor')) box.append(TS.multiSelect({ label: 'Vendedor', options: opts(db.opts.vendedores), selected: f.vendedores, onChange: rerender }));
    if (usa('grupo')) box.append(TS.multiSelect({ label: 'Grupo', options: opts(db.opts.grupos), selected: f.grupos, onChange: rerender }));
    if (usa('categoria')) box.append(TS.multiSelect({ label: 'Categoria', options: opts(db.opts.cats), selected: f.cats, onChange: rerender, placeholder: 'Todas' }));
    if (usa('produto')) {
      const prod = h('input', { class: 'f-input', type: 'search', placeholder: 'Ex.: earl grey', value: f.produto });
      prod.addEventListener('input', TS.debounce(() => { f.produto = prod.value.trim(); rerender(); }, 500));
      box.append(h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Produto contém'), prod));
    }

    // filtros específicos de cada página
    if (state.page === 'comparativos') {
      const tamanhos = [50, 100, 250, 500, 1000];
      box.append(h('div', { class: 'f-sep' }), h('div', { class: 'f-section' }, 'Comparativos'),
        h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Tamanho do pacote'),
          h('div', { class: 'chips' }, tamanhos.map((t) => h('button', { type: 'button', class: 'chip' + (f.tamanhos.has(t) ? ' on' : ''), onclick: () => { f.tamanhos.has(t) ? f.tamanhos.delete(t) : f.tamanhos.add(t); rerender(); } }, t >= 1000 ? '1 kg' : `${t}g`)))),
        h('div', { class: 'f-hint' }, 'Sem seleção = todos os produtos.'));
    }
    if (state.page === 'comissionamento') {
      const c = state.com;
      const mp = TS.metaPeriodo();
      // a meta simulada vale só para o mês em que foi digitada: mudou o mês do período, volta a meta cadastrada
      if (c.meta != null && c.metaYm && c.metaYm !== mp.ym) { c.meta = null; c.metaYm = null; }
      const meta = h('input', { class: 'f-input', type: 'number', min: 0, step: 500, value: c.meta ?? mp.valor ?? '' });
      meta.addEventListener('change', () => { c.meta = meta.value === '' ? null : +meta.value; c.metaYm = c.meta == null ? null : TS.metaPeriodo().ym; rerender(); });
      const sel = h('select', { class: 'f-input' }, h('option', { value: '' }, '— nenhum —'),
        db.opts.vendedores.filter(([s]) => s.toUpperCase() !== 'SEM VENDEDOR').map(([s]) => h('option', { value: s, selected: c.vendBonus === s || null }, s)));
      sel.addEventListener('change', () => { c.vendBonus = sel.value; rerender(); });
      const cup = h('input', { class: 'f-input', type: 'search', inputmode: 'numeric', placeholder: 'Nº do cupom', value: c.cupom });
      cup.addEventListener('input', TS.debounce(() => { c.cupom = cup.value.trim(); rerender(); }, 500));
      box.append(h('div', { class: 'f-sep' }), h('div', { class: 'f-section' }, 'Comissionamento'),
        h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Meta da loja (R$)'), meta,
          h('div', { class: 'f-hint' }, mp.valor != null ? `Meta de ${TS.ymLabel(mp.ym)}${{ mes: '', auto: ' (automática: ano anterior + %)', padrao: ' (padrão da loja)', misto: '' }[mp.origem] || ''}: ${fmt.brl(mp.valor)}${c.meta != null ? ' · você está simulando outro valor' : ''}` : 'Meta não cadastrada (Configurações → Lojas).')),
        h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Bônus sobre outros vendedores'), sel,
          h('div', { class: 'f-hint' }, 'Vendedor que recebe % sobre as vendas dos demais.')),
        h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Buscar cupom'), cup));
    }
    if (state.page === 'promocao') {
      const p = state.promo;
      const dias = h('input', { class: 'f-input', type: 'number', min: 1, max: 365, value: p.dias });
      dias.addEventListener('change', () => { p.dias = Math.max(1, Math.min(365, +dias.value || 30)); rerender(); });
      box.append(h('div', { class: 'f-sep' }), h('div', { class: 'f-section' }, 'Promoção'),
        h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Comparar com os dias anteriores'), dias,
          h('div', { class: 'chips' }, [7, 15, 30, 60, 90].map((n) => h('button', { type: 'button', class: 'chip' + (p.dias === n ? ' on' : ''), onclick: () => { p.dias = n; rerender(); } }, `${n} dias`))),
          h('div', { class: 'f-hint' }, 'O período anterior termina no dia antes do início do período escolhido.')));
    }
  };

  /** ao trocar de loja os ids dos textos mudam: zera o que depende deles */
  TS.resetFiltros = function () {
    const f = state.f;
    f.lojas.clear(); f.vendedores.clear(); f.grupos.clear(); f.cats.clear(); f.tamanhos.clear(); f.produto = '';
    state.cli.cidade.clear(); state.cli.grupos.clear(); state.cli.lojas.clear();
    state.com.vendBonus = ''; state.com.meta = null; state.com.cupom = '';
    nfsCache = null;
  };
  /** filtros que guardam números do dicionário → textos (e de volta), para sobreviver a uma recarga dos dados */
  const SETS_DIC = () => [[state.f.lojas, 'loja'], [state.f.vendedores, 'vendedor'], [state.f.grupos, 'grupoC'], [state.f.cats, 'cat'], [state.cli.grupos, 'grupoC'], [state.cli.lojas, 'loja']];
  TS.filtrosEmTexto = function () {
    const D = TS.db.D;
    return SETS_DIC().map(([set, campo]) => [...set].map((i) => D[campo][i]).filter((t) => t != null));
  };
  TS.filtrosDeTexto = function (textos) {
    const D = TS.db.D;
    SETS_DIC().forEach(([set, campo], k) => { set.clear(); for (const t of textos[k] || []) { const i = D[campo].indexOf(t); if (i >= 0) set.add(i); } });
  };
  TS.limparFiltros = function () {
    const f = state.f;
    f.lojas.clear(); f.vendedores.clear(); f.grupos.clear(); f.cats.clear(); f.tamanhos.clear(); f.produto = '';
    TS.aplicarPreset('30d');
    Object.assign(state.com, { cupom: '', meta: null, vendBonus: '' });
    state.promo.dias = 30;
    Object.assign(state.cli, { nome: '', cpf: '', cupom: '', produto: '', aniv: '', visMin: '', visMax: '', ausMin: '', ausMax: '', seg: '' });
    Object.assign(state.cli.per, { preset: 'tudo', de: null, ate: null, ano: null, mes: null });
    state.cli.cidade.clear(); state.cli.grupos.clear(); state.cli.lojas.clear();
    TS._buscas = null; // buscas digitadas nas tabelas também
  };

  function cabecalho(titulo, sub) {
    const f = state.f, db = TS.db;
    const tags = [h('span', { class: 'af' }, TS.periodoTexto())];
    const nomes = (set, field) => [...set].map((i) => db.D[field][i]).join(', ');
    if (f.lojas.size) tags.push(h('span', { class: 'af' }, nomes(f.lojas, 'loja')));
    if (f.vendedores.size) tags.push(h('span', { class: 'af' }, f.vendedores.size > 2 ? `${f.vendedores.size} vendedores` : nomes(f.vendedores, 'vendedor')));
    if (f.grupos.size) tags.push(h('span', { class: 'af' }, f.grupos.size > 2 ? `${f.grupos.size} grupos` : nomes(f.grupos, 'grupoC')));
    if (f.cats.size) tags.push(h('span', { class: 'af' }, `${f.cats.size} categoria(s)`));
    if (f.produto) tags.push(h('span', { class: 'af' }, `produto: "${f.produto}"`));
    return h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, titulo), h('div', { class: 'page-sub' }, sub)), h('div', { class: 'active-filters' }, tags));
  }

  /** período anterior de mesmo tamanho (para as variações dos cartões) */
  function periodoAnterior() {
    const f = state.f;
    if (f.de == null) return null;
    // período que ainda não acabou (ex.: mês atual até o dia 30): compara só até o último dia com vendas
    const fim = Math.max(f.de, Math.min(f.ate ?? TS.db.maxDay, TS.db.maxDay));
    const shift = (day, meses) => {
      const d = new Date(day * 86400000), y = d.getUTCFullYear(), m = d.getUTCMonth() + meses;
      const ult = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return Math.floor(Date.UTC(y, m, Math.min(d.getUTCDate(), ult)) / 86400000);
    };
    if (f.preset === 'mes' || f.preset === 'mesAnt') return { de: shift(f.de, -1), ate: f.preset === 'mesAnt' ? f.de - 1 : shift(fim, -1), txt: 'vs. mesmo período do mês anterior' };
    if (f.preset === 'hoje') return { de: f.de - 7, ate: f.de - 7, txt: 'vs. mesmo dia da semana passada' };
    if (f.preset === 'semana') { const ateReal = Math.min(f.ate, Math.max(TS.db.maxDay, f.de)); return { de: f.de - 7, ate: ateReal - 7, txt: 'vs. mesmos dias da semana passada' }; }
    if (f.preset === 'anomes' && f.ano && f.mes) return { de: shift(f.de, -12), ate: shift(fim, -12), txt: 'vs. mesmo mês do ano anterior' };
    if (f.preset === 'anomes' && f.ano) return { de: shift(f.de, -12), ate: shift(fim, -12), txt: 'vs. ano anterior' };
    if (f.preset === 'ano') return { de: shift(f.de, -12), ate: shift(fim, -12), txt: 'vs. mesmo período do ano anterior' };
    const len = fim - f.de + 1;
    return { de: f.de - len, ate: f.de - 1, txt: `vs. ${len} dias anteriores` };
  }

  /**
   * Agrupamento dos gráficos no tempo pelo período escolhido: até 45 dias = por dia; até ~6 meses = por semana
   * (segunda a domingo); mais que isso (ano, 12 meses, tudo) = por mês.
   */
  TS.baldes = function (de, ate) {
    const db = TS.db;
    const a = de ?? db.minDay, b = Math.min(ate ?? db.maxDay, db.maxDay);
    const n = b - a + 1;
    const tipo = n <= 45 ? 'dia' : n <= 200 ? 'semana' : 'mes';
    const seg = (day) => day - ((new Date(day * 864e5).getUTCDay() + 6) % 7);
    const chave = tipo === 'dia' ? (day) => day : tipo === 'semana' ? seg : (day) => TS.dayToIso(day).slice(0, 7);
    const chaves = [];
    if (tipo === 'mes') { const vist = new Set(); for (let d = a; d <= b; d++) { const k = chave(d); if (!vist.has(k)) { vist.add(k); chaves.push(k); } } }
    else for (let d = tipo === 'semana' ? seg(a) : a; d <= b; d += tipo === 'semana' ? 7 : 1) chaves.push(d);
    const dm = (day) => { const x = TS.dayToIso(day); return `${x.slice(8, 10)}/${x.slice(5, 7)}`; };
    const rotulo = tipo === 'mes' ? TS.ymLabel : tipo === 'semana' ? (k) => `sem. ${dm(k)}` : (k) => `${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(k * 864e5).getUTCDay()]} ${dm(k)}`;
    const nome = { dia: 'Dia a dia', semana: 'Semana a semana', mes: 'Mês a mês' }[tipo];
    const porX = { dia: 'por dia', semana: 'por semana', mes: 'por mês' }[tipo];
    return { tipo, chave, chaves, rotulo, nome, porX };
  };

  /** os mesmos dias da semana um ano antes (364 dias) e as mesmas datas no mês anterior (até o último dia com vendas): Resumo e Comparativos */
  TS.DICA_ANO = 'vs. ano anterior: o mesmo período 364 dias antes (52 semanas), para comparar os mesmos dias da semana — segunda com segunda, sábado com sábado';
  TS.periodosIguais = function (de, ate) {
    const db = TS.db;
    if (de == null) return null;
    const fim = Math.max(de, Math.min(ate ?? db.maxDay, db.maxDay));
    // ano anterior = 364 dias antes (52 semanas): segunda compara com segunda, sábado com sábado
    const anoAntes = (d) => d - 364;
    const mesAntes = (day) => { const d = new Date(day * 86400000), y = d.getUTCFullYear(), m = d.getUTCMonth() - 1; const ult = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return Math.floor(Date.UTC(y, m, Math.min(d.getUTCDate(), ult)) / 86400000); };
    return { ano: { de: anoAntes(de), ate: anoAntes(fim) }, mes: { de: mesAntes(de), ate: mesAntes(fim) } };
  };
  /** linhas de variação de um cartão: [[valor atual, valor anterior, 'vs. …'], …] (sem dado anterior a linha some).
   *  No quadro o texto sai curto ("· 30 dias", "· ano"); a frase completa fica no title. */
  const varCurta = (txt) => {
    const m = /^vs\. (\d+) dias anteriores$/.exec(txt);
    return m ? `· ${m[1]} dias` : txt === 'vs. ano anterior' ? '· ano' : txt;
  };
  TS.linhasVar = (...ls) => {
    const v = ls.filter((l) => l && l[1] != null && l[1] !== 0 && l[0] != null);
    return v.length ? h('span', { class: 'kpi-vars' }, ...v.map(([a, b, txt]) => { const c = varCurta(txt); return h('span', { title: txt === 'vs. ano anterior' ? TS.DICA_ANO : c !== txt ? txt : null }, TS.deltaSpan(a / b - 1), ' ' + c); })) : null;
  };

  /** o período da tela fica dentro de UM mês? → 'AAAA-MM' (senão null). Meta, comissão e projeção são do mês. */
  TS.periodoUmMes = function () {
    const f = state.f, db = TS.db;
    if (f.de == null || (f.preset === 'anomes' && !(f.ano && f.mes))) return null;
    const ymDe = TS.dayToIso(f.de).slice(0, 7);
    const fim = Math.max(f.de, Math.min(f.ate ?? db.maxDay, db.maxDay));
    return TS.dayToIso(fim).slice(0, 7) === ymDe && (f.ate == null || TS.dayToIso(f.ate).slice(0, 7) === ymDe) ? ymDe : null;
  };

  /** tabela em árvore Mês (todos os anos) → Ano → Vendedor */
  function arvoreMensal(base, porMesAll, periodo) {
    const db = TS.db;
    const aberto = (state.compAberto ||= new Set());
    const porMes = TS.agrupar(base, (i) => +db.ym[i].slice(5, 7));
    const meses = [...porMes.keys()].sort((x, y) => x - y);
    const ind = (idx) => TS.indicadores(idx);
    /** dias do mês que entram na conta: o período escolhido, sem passar de hoje/da última venda.
     *  Mês pela metade (ex.: 1 a 12/11) compara com os mesmos dias do ano anterior, não com o mês inteiro. */
    const diasDoMes = (ym) => {
      const ini = TS.isoToDay(ym + '-01');
      const fim = TS.isoToDay(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10));
      const lo = Math.max(ini, periodo.de) - ini + 1, hi = Math.min(fim, periodo.ate) - ini + 1;
      return { lo, hi, parcial: lo > 1 || hi < fim - ini + 1 };
    };
    const prevIdx = (ym, filtro) => {
      const k = `${+ym.slice(0, 4) - 1}${ym.slice(4)}`;
      let idx = porMesAll.get(k);
      const d = diasDoMes(ym);
      if (idx && d.parcial) idx = idx.filter((i) => { const dia = +db.iso[i].slice(8, 10); return dia >= d.lo && dia <= d.hi; });
      if (idx && filtro) idx = idx.filter(filtro);
      return idx && idx.length ? idx : null;
    };
    const prevDe = (ym, filtro) => { const idx = prevIdx(ym, filtro); return idx ? ind(idx) : null; };
    const rotAno = (y, ym) => { const d = diasDoMes(ym); return d.parcial ? `${y} (dias ${d.lo} a ${d.hi})` : String(y); };
    // várias lojas: Mês → Ano → Loja → Vendedor
    const multiLoja = new Set(base.map((i) => db.loja[i])).size > 1;
    const cols = [['vt', 'Faturamento', fmt.brl], ['cupons', 'Cupons', fmt.int], ['tkm', 'TKM', fmt.brl], ['pma', 'PMA', fmt.brl], ['ipa', 'IPA', fmt.n2]];
    const tbl = h('table', { class: 't tree' + (multiLoja ? ' multi' : '') });
    const wrap = h('div', { class: 'table-wrap' }, tbl);
    wrap.style.maxHeight = '420px';

    /** cmp (só no mês e no total): { a, p, dica } — variação do ano mais recente contra o anterior */
    function linha(nivel, chave, rotulo, a, p, temFilhos, cmp) {
      const open = aberto.has(chave);
      const btn = temFilhos ? h('button', { type: 'button', class: 'tree-btn', 'aria-expanded': String(open), 'aria-label': (open ? 'Recolher ' : 'Expandir ') + rotulo,
        onclick: () => { open ? fechar(chave) : aberto.add(chave); paint(); } }, open ? '−' : '+') : h('span', { class: 'tree-sp' });
      const tds = [h('td', { class: `l sticky-col tree-l n${nivel}` }, h('span', { class: 'tree-cell' }, btn, h('span', null, rotulo)))];
      for (const [k, lab, fm] of cols) {
        tds.push(h('td', { class: 'tree-v', 'data-l': lab }, fm(a[k])));
        if (nivel === 0) continue;
        const d = p && p[k] ? a[k] / p[k] - 1 : null;
        // variação e, embaixo, o valor do ano anterior (no mesmo recorte de dias)
        tds.push(h('td', { class: 'tree-var ' + (d == null ? 'muted' : d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'), title: p && p[k] != null ? `Ano anterior: ${fm(p[k])}` : null },
          d == null ? '—' : fmt.delta(d), p && p[k] != null ? h('small', { class: 'tree-ant' }, fm(p[k])) : null));
      }
      if (nivel === 0) {
        // mês: o resumo do ano mais recente contra o anterior (mesmos dias se o mês está incompleto)
        const out = [tds[0]];
        tds.slice(1).forEach((td, j) => out.push(td, celVar(cols[j], cmp)));
        return h('tr', { class: `lv${nivel}` }, out);
      }
      return h('tr', { class: `lv${nivel}` }, tds);
    }
    function celVar([k, , fm], cmp) {
      if (!cmp || !cmp.p) return h('td', { class: 'muted' }, '');
      const a = cmp.a[k], pv = cmp.p[k];
      const d = pv ? a / pv - 1 : null;
      return h('td', { class: 'tree-var ' + (d == null ? 'muted' : d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted'), title: `${cmp.dica}: ${fm(a)} contra ${fm(pv)}` },
        d == null ? '—' : fmt.delta(d), pv != null ? h('small', { class: 'tree-ant' }, fm(pv)) : null);
    }
    const fechar = (chave) => { for (const k of [...aberto]) if (k === chave || k.startsWith(chave + '|')) aberto.delete(k); };

    function paint() {
      tbl.textContent = '';
      const trh = h('tr', null, h('th', { class: 'l sticky-col' }, multiLoja ? 'Mês / Ano / Loja / Vendedor' : 'Mês / Ano / Vendedor'));
      for (const [, lab] of cols) trh.append(h('th', null, lab), h('th', { title: 'Variação contra o mesmo mês do ano anterior. Mês incompleto (o atual, ou um período que corta o mês) compara só os mesmos dias' }, 'vs. ano ant.'));
      tbl.append(h('thead', null, trh));
      const tb = h('tbody');
      for (const m of meses) {
        const idxM = porMes.get(m), kM = 'm' + m;
        const anos = TS.agrupar(idxM, (i) => db.year[i]);
        const yMax = Math.max(...anos.keys()), ymMax = `${yMax}-${String(m).padStart(2, '0')}`;
        const pM = prevDe(ymMax);
        const cmpM = pM ? { a: ind(anos.get(yMax)), p: pM, dica: `${rotAno(yMax, ymMax)} contra ${yMax - 1}${diasDoMes(ymMax).parcial ? ' (mesmos dias)' : ''}` } : null;
        tb.append(linha(0, kM, `${TS.MESES_LONGOS[m - 1]}`, ind(idxM), null, true, cmpM));
        if (!aberto.has(kM)) continue;
        for (const y of [...anos.keys()].sort((x, z) => z - x)) {
          const idxY = anos.get(y), ym = `${y}-${String(m).padStart(2, '0')}`, kY = `${kM}|${y}`;
          tb.append(linha(1, kY, rotAno(y, ym), ind(idxY), prevDe(ym), true));
          if (!aberto.has(kY)) continue;
          const vendedores = (idx, nivel, chavePai, filtroPai) => {
            const vends = [...TS.agrupar(idx, (i) => db.vend[i])].map(([v, vi]) => ({ v, a: ind(vi) })).sort((x, z) => z.a.vt - x.a.vt);
            for (const { v, a } of vends) tb.append(linha(nivel, `${chavePai}|${v}`, db.D.vendedor[v], a, prevDe(ym, (i) => db.vend[i] === v && (!filtroPai || filtroPai(i))), false));
          };
          if (!multiLoja) { vendedores(idxY, 2, kY, null); continue; }
          const lojas = [...TS.agrupar(idxY, (i) => db.loja[i])].map(([l, li]) => ({ l, li, a: ind(li) })).sort((x, z) => z.a.vt - x.a.vt);
          for (const { l, li, a } of lojas) {
            const kL = `${kY}|L${l}`;
            tb.append(linha(2, kL, db.D.loja[l], a, prevDe(ym, (i) => db.loja[i] === l), true));
            if (aberto.has(kL)) vendedores(li, 3, kL, (i) => db.loja[i] === l);
          }
        }
      }
      if (!meses.length) tb.append(h('tr', null, h('td', { colspan: 11, class: 'l muted' }, 'Sem dados.')));
      tbl.append(tb);
      const t = ind(base), tf = h('tr', null, h('td', { class: 'l sticky-col' }, 'Total'));
      // total contra o mesmo período do ano anterior (só quando o período não inclui o próprio ano anterior)
      const yms = new Set(base.map((i) => db.ym[i]));
      const antYms = [...yms].map((ym) => `${+ym.slice(0, 4) - 1}${ym.slice(4)}`);
      let cmpT = null;
      if (!antYms.some((x) => yms.has(x))) {
        const idxAnt = [...yms].flatMap((ym) => prevIdx(ym) || []);
        if (idxAnt.length) cmpT = { a: t, p: ind(idxAnt), dica: 'Período escolhido contra o mesmo período do ano anterior' };
      }
      for (const col of cols) tf.append(h('td', { class: 'tree-v', 'data-l': col[1] }, col[2](t[col[0]])), celVar(col, cmpT));
      tbl.append(h('tfoot', null, tf));
    }
    paint();
    const expandir = () => {
      for (const m of meses) {
        aberto.add('m' + m);
        for (const y of new Set(porMes.get(m).map((i) => db.year[i]))) {
          aberto.add(`m${m}|${y}`);
          if (multiLoja) for (const i of porMes.get(m)) if (db.year[i] === y) aberto.add(`m${m}|${y}|L${db.loja[i]}`);
        }
      }
      paint();
    };
    const soAnos = () => { aberto.clear(); for (const m of meses) aberto.add('m' + m); paint(); };
    wrap.tools = h('div', { class: 'table-tools' },
      h('button', { type: 'button', class: 'btn', onclick: soAnos }, 'Abrir anos'),
      h('button', { type: 'button', class: 'btn', onclick: expandir }, 'Expandir tudo'),
      h('button', { type: 'button', class: 'btn', onclick: () => { aberto.clear(); paint(); } }, 'Recolher'));
    return wrap;
  }

  // ======================= RESUMO =======================
  TS.pages = {};
  TS.pages.resumo = function (root) {
    const db = TS.db, I = R().ids;
    const base = TS.filtrar();
    root.append(cabecalho('Resumo de Vendas', 'Desempenho por vendedor, produto e tipo de chá'));
    if (!base.length) { root.append(TS.card(null, null, TS.empty())); return; }

    const ind = TS.indicadores(base);
    const kgTotal = base.reduce((s, i) => s + (I.chaTotal.has(db.grupo[i]) ? db.cha[i] || 0 : 0), 0);
    const pa = periodoAnterior();
    let prev = null;
    if (pa) {
      const pidx = TS.filtrar({ de: pa.de, ate: pa.ate });
      if (pidx.length) prev = { ...TS.indicadores(pidx), kg: pidx.reduce((s, i) => s + (I.chaTotal.has(db.grupo[i]) ? db.cha[i] || 0 : 0), 0) };
    }
    // segunda linha: mesmo período do ano anterior (quando a primeira já não é ela)
    const pi = TS.periodosIguais(state.f.de, state.f.ate);
    let prevAno = null;
    if (pi && !/ano anterior/.test(pa?.txt || '')) {
      const ia = TS.filtrar({ de: pi.ano.de, ate: pi.ano.ate });
      if (ia.length) prevAno = { ...TS.indicadores(ia), kg: ia.reduce((s, i) => s + (I.chaTotal.has(db.grupo[i]) ? db.cha[i] || 0 : 0), 0) };
    }
    const d = (a, b, k) => TS.linhasVar(prev && b ? [a, b, pa.txt.replace('mesmo período do ', '')] : null, prevAno && k ? [a, prevAno[k], 'vs. ano anterior'] : null);
    root.append(h('div', { class: 'grid g-kpi' },
      TS.kpi('Faturamento', fmt.brl0(ind.vt), d(ind.vt, prev?.vt, 'vt')),
      TS.kpi('Atendimentos (cupons)', fmt.int(ind.cupons), d(ind.cupons, prev?.cupons, 'cupons')),
      TS.kpi('Ticket médio (TKM)', fmt.brl(ind.tkm), d(ind.tkm, prev?.tkm, 'tkm'), 'Faturamento ÷ cupons'),
      TS.kpi('Preço médio (PMA)', fmt.brl(ind.pma), d(ind.pma, prev?.pma, 'pma'), 'Faturamento ÷ itens'),
      TS.kpi('Itens por atendimento (IPA)', fmt.n2(ind.ipa), d(ind.ipa, prev?.ipa, 'ipa'), 'Itens ÷ cupons'),
      TS.kpi('Chá vendido', fmt.kg(kgTotal) + ' kg', d(kgTotal, prev?.kg, 'kg')),
      TS.kpi('Espaço Gourmet', fmt.pct(R().pctEG(base)), 'do faturamento'),
      // projeção: só quando o período começa no dia 1 e fica dentro de UM mês (o mês em andamento); período
      // personalizado que termina antes de hoje projeta a partir do fim do período, não do dia de hoje
      TS.periodoUmMes() && TS.dayToIso(state.f.de).slice(8) === '01'
        ? TS.kpiProjecao(ind.vt, null, TS.dayToIso(state.f.de).slice(0, 7), 'Projeção do faturamento', { base: 'loja', ate: state.f.ate }) : null));

    const al = TS.cartaoAlertas && TS.cartaoAlertas();
    if (al) root.append(al);

    // ---- tabela por vendedor
    const porVend = TS.agrupar(base, (i) => db.vend[i]);
    const tipoCols = I.tipos.map(([n]) => n);
    const linhaVend = (idx, nome) => {
      const ii = TS.indicadores(idx);
      const r = { vendedor: nome, cupons: ii.cupons, tkm: ii.tkm, pma: ii.pma, ipa: ii.ipa, vt: ii.vt, kg: 0 };
      I.tipos.forEach(([n]) => (r['kg_' + n] = 0));
      for (const i of idx) {
        const c = db.cha[i] || 0;
        if (!c) continue;
        if (I.chaTotal.has(db.grupo[i])) r.kg += c;
        for (const [n, set] of I.tipos) if (set.has(db.grupo[i])) r['kg_' + n] += c;
      }
      return r;
    };
    const rowsV = [...porVend].map(([v, idx]) => linhaVend(idx, db.D.vendedor[v]));
    const totV = linhaVend(base, 'Total');
    const kgFmt = (v) => (v ? fmt.kg(v) : '—');
    const tabVend = TS.table({
      cols: [
        { key: 'vendedor', label: 'Vendedor', align: 'l', sticky: true },
        { key: 'vt', label: 'Faturamento', fmt: fmt.brl },
        { key: 'cupons', label: 'Cupons', fmt: fmt.int },
        { key: 'tkm', label: 'TKM', fmt: fmt.brl, title: 'Ticket médio' },
        { key: 'pma', label: 'PMA', fmt: fmt.brl, title: 'Preço médio por item' },
        { key: 'ipa', label: 'IPA', fmt: fmt.n2, title: 'Itens por atendimento' },
        { key: 'kg', label: 'Chá (kg)', fmt: kgFmt },
        ...tipoCols.map((n) => ({ key: 'kg_' + n, label: n, fmt: kgFmt, title: `Chá ${n} em kg` })),
      ],
      rows: rowsV, total: totV, sortKey: 'vt',
    });
    root.append(TS.section('Visão geral'), TS.card('Desempenho por vendedor', 'Clique no título de uma coluna para ordenar', tabVend));

    // ---- dia da semana + produtos
    // total do período ou média por dia (total ÷ quantos daquele dia da semana tiveram venda no período)
    const modoSem = state.semModo === 'media' ? 'media' : 'total';
    const lojasIdx = TS.agrupar(base.filter((i) => db.D.grupoC[db.grupoC[i]] !== ''), (i) => db.loja[i]);
    const dsSemana = [...lojasIdx].map(([l, idx], k) => {
      const arr = new Array(7).fill(0);
      const dias = Array.from({ length: 7 }, () => new Set());
      for (const i of idx) { arr[db.wd[i]] += db.vt[i] || 0; dias[db.wd[i]].add(db.day[i]); }
      if (modoSem === 'media') for (let w = 0; w < 7; w++) arr[w] = dias[w].size ? arr[w] / dias[w].size : 0;
      return { label: db.D.loja[l], data: arr, borderColor: TS.color(k), backgroundColor: TS.alpha(TS.color(k), .12), fill: lojasIdx.size === 1, tension: .35, pointRadius: 4 };
    });
    if (dsSemana.length > 1) dsSemana.push(TS.dsMedia('Média das lojas', TS.mediaSeries(dsSemana.map((d) => d.data))));
    else if (dsSemana.length === 1) { const m = TS.mediaPontos(dsSemana[0].data); dsSemana.push(TS.dsMedia('Média dos dias', dsSemana[0].data.map(() => m), { tension: 0 })); }
    const chSemana = TS.chart({
      type: 'line', data: { labels: TS.DIAS_SEMANA, datasets: dsSemana },
      options: { plugins: { legend: { display: true }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.brl(c.raw)}` } } }, scales: { y: TS.axisBRL, x: TS.axisCat } },
    });

    const prodIdx = base.filter((i) => !I.taxas.has(db.desc[i]));
    const porProd = TS.agrupar(prodIdx, (i) => db.prod[i]);
    const rowsP = [...porProd].map(([p, idx]) => {
      let q = 0, kg = 0, v = 0;
      for (const i of idx) { q += db.qtd[i] || 0; kg += db.cha[i] || 0; v += db.vt[i] || 0; }
      return { produto: db.D.produto[p], qtd: q, kg, vt: v };
    });
    const tabProd = TS.table({
      cols: [
        { key: 'produto', label: 'Produto', align: 'l', wrap: true },
        { key: 'qtd', label: 'Qtd', fmt: fmt.int },
        { key: 'kg', label: 'Kg', fmt: kgFmt },
        { key: 'vt', label: 'Faturamento', fmt: fmt.brl },
      ],
      rows: rowsP, sortKey: 'vt', maxHeight: '300px', search: 'Buscar produto…', searchKeys: ['produto'], cls: 't-compacta',
      total: { produto: 'Total', qtd: rowsP.reduce((s, r) => s + r.qtd, 0), kg: rowsP.reduce((s, r) => s + r.kg, 0), vt: rowsP.reduce((s, r) => s + r.vt, 0) },
    });
    root.append(h('div', { class: 'grid g-3-2 mt' },
      TS.cardWithTools('Faturamento por dia da semana', modoSem === 'media' ? 'Média por dia com venda no período (ex.: total das sextas ÷ número de sextas), por loja' : 'Soma do período, por loja',
        TS.seg([['Total', 'total'], ['Média por dia', 'media']], modoSem, (v) => { state.semModo = v; TS.render(); }), chSemana),
      TS.cardWithTools('Vendas por produto', 'Sem taxa de serviço/entrega', tabProd.searchBox, tabProd)));

    // ---- volume por produto
    const topBar = (rows, fmtVal, color, labelFmt) => { const el = TS.chart({
      type: 'bar',
      data: { labels: rows.map((r) => r.nome), datasets: [{ data: rows.map((r) => r.v), backgroundColor: color, borderRadius: 4, maxBarThickness: 18 }] },
      options: {
        indexAxis: 'y', layout: { padding: { right: 90 } },
        plugins: { legend: { display: false }, valueLabels: { display: true, format: labelFmt }, tooltip: { callbacks: { label: (c) => fmtVal(c.raw) } } },
        scales: { x: { display: false, grid: { display: false } }, y: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } } },
      },
    }); el.style.height = Math.max(120, rows.length * 28 + 30) + 'px'; return el; };
    const somaPor = (idx, valFn) => {
      const m = new Map();
      for (const i of idx) { const v = valFn(i); if (!v) continue; m.set(db.prod[i], (m.get(db.prod[i]) || 0) + v); }
      return [...m].map(([p, v]) => ({ nome: db.D.produto[p], v })).sort((a, b) => b.v - a.v);
    };
    const kgRows = somaPor(base.filter((i) => I.catChaKg.has(db.cat[i])), (i) => db.cha[i] || 0);
    const kgTot = kgRows.reduce((s, r) => s + r.v, 0);
    const acRows = somaPor(base.filter((i) => I.grupoAcessQtd.has(db.grupo[i])), (i) => db.qtd[i] || 0);
    const acTot = acRows.reduce((s, r) => s + r.v, 0);
    const TOP = 12;
    root.append(TS.section('Volume por produto'), h('div', { class: 'grid g-2' },
      TS.card('Chá em kg', `Top ${TOP} de ${kgRows.length} chás · total ${fmt.kg(kgTot)} kg`,
        kgRows.length ? topBar(kgRows.slice(0, TOP), (v) => fmt.kg(v) + ' kg', '#2C5234', (v) => `${fmt.kg(v)} (${fmt.pct(v / kgTot)})`) : TS.empty()),
      TS.card('Acessórios e alimentação', `Top ${TOP} de ${acRows.length} itens · ${fmt.int(acTot)} unidades`,
        acRows.length ? topBar(acRows.slice(0, TOP), (v) => fmt.int(v) + ' un.', '#C9A227', (v) => `${fmt.int(v)} (${fmt.pct(v / acTot)})`) : TS.empty())));

    // ---- por tipo de chá
    // nenhum tipo marcado = todos os tipos; clicar no tipo já marcado desmarca
    const tipoAtual = I.tipos.some(([n]) => n === state.tipoCha) ? state.tipoCha : null;
    const alternar = (v) => { state.tipoCha = state.tipoCha === v ? null : v; TS.render(); };
    const resumoTipos = I.tipos.map(([n, set]) => [n, base.reduce((s, i) => s + (set.has(db.grupo[i]) ? db.cha[i] || 0 : 0), 0)]);
    const set = tipoAtual ? I.tipos.find(([n]) => n === tipoAtual)[1] : new Set(I.tipos.flatMap(([, st]) => [...st]));
    const rowsT = somaPor(base.filter((i) => set.has(db.grupo[i])), (i) => db.cha[i] || 0);
    const totT = rowsT.reduce((s, r) => s + r.v, 0);
    const totTipos = resumoTipos.reduce((s, [, v]) => s + v, 0);
    const tiposChart = TS.chart({
      type: 'bar',
      data: { labels: resumoTipos.map(([n]) => n), datasets: [{ data: resumoTipos.map(([, v]) => v), backgroundColor: resumoTipos.map(([n]) => (n === tipoAtual ? '#C9A227' : '#7FA37A')), borderRadius: 6 }] },
      options: {
        plugins: { legend: { display: false }, valueLabels: { display: true, format: (v) => (v ? fmt.pct(totTipos ? v / totTipos : null, 0) : "") },
          tooltip: { callbacks: { label: (c) => `${fmt.kg(c.raw)} kg · ${fmt.pct(totTipos ? c.raw / totTipos : null)} do total de chá (${fmt.kg(totTipos)} kg)` } } },
        scales: { y: { ...TS.axisNum((v) => fmt.kg(v).replace(/0+$/, '').replace(/,$/, '')), title: { display: true, text: 'kg' } }, x: TS.axisCat },
        onClick: (_e, els) => { if (els.length) alternar(resumoTipos[els[0].index][0]); },
      },
    }, 'short');
    root.append(TS.section('Vendas por tipo de chá'),
      h('div', { class: 'grid g-2-1' },
        TS.cardWithTools(tipoAtual ? `Chá ${tipoAtual}` : 'Chás de todos os tipos', `${rowsT.length ? `${rowsT.length} produtos · ${fmt.kg(totT)} kg · ` : ''}${tipoAtual ? 'clique de novo no tipo para ver todos' : 'clique num tipo para filtrar'}`,
          TS.seg(I.tipos.map(([n]) => [n, n]), tipoAtual, alternar),
          rowsT.length ? topBar(rowsT.slice(0, 15), (v) => fmt.kg(v) + ' kg', '#2C5234', (v) => `${fmt.kg(v)} (${fmt.pct(v / totT)})`) : TS.empty()),
        TS.card('Kg por tipo', 'Kg e % do total de chá · clique numa barra para ver os produtos (de novo para desmarcar)', tiposChart)));
  };

  // ======================= COMPARATIVOS =======================
  TS.pages.comparativos = function (root) {
    const db = TS.db, I = R().ids;
    const base = TS.filtrar({ usarTamanho: true });
    root.append(cabecalho('Comparativos', 'Evolução mês a mês, ano contra ano e por vendedor'));
    if (!base.length) { root.append(TS.card(null, null, TS.empty())); return; }

    // ---- dados do ano anterior para o YoY
    const f = state.f;
    const de = f.de ?? db.minDay, ate = f.ate ?? db.maxDay;
    // "vs. ano anterior" dos quadros = os mesmos dias da semana, 364 dias antes (a mesma conta do Resumo);
    // a tabela "Evolução mensal" continua comparando mês com o mesmo mês do calendário
    // sem data de início ("Tudo" ou só o mês) não existe "mesmo período do ano anterior": não compara
    const prevIdx = f.de == null ? [] : TS.filtrar({ usarTamanho: true, de: de - 364, ate: Math.min(ate, db.maxDay) - 364 });
    const pctEG = R().pctEG(base);
    const indAll = TS.indicadores(base);
    const indPrev = prevIdx.length ? TS.indicadores(prevIdx) : null;
    // mês anterior: as mesmas datas um mês antes (a mesma conta do Resumo com "Mês atual")
    const pi = f.de != null ? TS.periodosIguais(de, ate) : null;
    const mesIdx = pi ? TS.filtrar({ usarTamanho: true, de: pi.mes.de, ate: pi.mes.ate }) : [];
    const indMes = mesIdx.length ? TS.indicadores(mesIdx) : null;
    const vars = (k) => TS.linhasVar(indPrev ? [indAll[k], indPrev[k], 'vs. ano anterior'] : null, indMes ? [indAll[k], indMes[k], 'vs. mês anterior'] : null) || 'sem dados para comparar';
    root.append(h('div', { class: 'grid g-kpi' },
      TS.kpi('Faturamento', fmt.brl0(indAll.vt), vars('vt')),
      TS.kpi('Cupons', fmt.int(indAll.cupons), vars('cupons')),
      TS.kpi('TKM', fmt.brl(indAll.tkm), vars('tkm')),
      TS.kpi('PMA', fmt.brl(indAll.pma), vars('pma')),
      TS.kpi('IPA', fmt.n2(indAll.ipa), vars('ipa')),
      TS.kpi('Espaço Gourmet', fmt.pct(pctEG), 'do faturamento'),
      TS.kpi('Loja (sem EG)', fmt.pct(pctEG == null ? null : 1 - pctEG), 'do faturamento')));

    // ---- evolução mensal em árvore: Mês → Ano → Vendedor (variação contra o mesmo mês do ano anterior)
    // média da franquia (anônima, todas as lojas): só para quem não é vendedora, com uma loja escolhida
    const B0 = TS.baldes(f.de, f.ate);
    const fr = (() => {
      if (TS.eu?.perfil === 'vendedor' || !state.loja || state.loja === 'todas' || TS.demo) return null;
      const a = de, b = Math.min(ate, db.maxDay), chave = `${state.loja}|${a}|${b}|${B0.tipo}`;
      if (TS._redeComp && TS._redeComp.chave === chave) return TS._redeComp.r;
      if (TS._redeCompPedido !== chave) {
        TS._redeCompPedido = chave;
        fetch(TS.api(`rede/comparativos?loja=${encodeURIComponent(state.loja)}&de=${a}&ate=${b}&tipo=${B0.tipo}`), { credentials: 'same-origin' }).then((r) => r.json()).then((r) => {
          TS._redeComp = { chave, r: r.erro ? null : r };
          if (state.page === 'comparativos' && TS._redeCompPedido === chave) TS.render();
        }).catch(() => { TS._redeComp = { chave, r: null }; });
      }
      return null;
    })();
    const temFr = !!(fr && !fr.minimo);
    const FR = 'Média da franquia';
    const dsFr = (data) => TS.dsMedia(FR, data, { borderColor: '#6B3FA0', backgroundColor: '#6B3FA0', borderDash: [2, 3], borderWidth: 2.5 });
    const prevAll = TS.filtrar({ usarTamanho: true, ignorar: ['datas'] });
    const porMesAll = TS.agrupar(prevAll, (i) => db.ym[i]);
    const tabM = arvoreMensal(base, porMesAll, { de, ate: Math.min(ate, db.maxDay) });
    // ---- mix por vendedor
    const porVend = [...TS.agrupar(base, (i) => db.vend[i])].map(([v, idx]) => ({ nome: db.D.vendedor[v], ...R().mixPct(idx), vt: TS.soma(idx, 'vt') })).filter((r) => r.arom != null).sort((a, b) => b.vt - a.vt);
    const mixLoja = R().mixPct(base);
    if (porVend.length > 1 && mixLoja.arom != null) porVend.push({ nome: 'Média da loja', ...mixLoja, media: true });
    if (temFr && fr.mix) porVend.push({ nome: FR, ...fr.mix, media: true, franquia: true });
    const corMix = (cor) => porVend.map((r) => (r.franquia ? TS.alpha(cor, .28) : r.media ? TS.alpha(cor, .5) : cor));
    const mixChart = TS.chart({
      type: 'bar',
      data: {
        labels: porVend.map((r) => r.nome),
        datasets: [
          { label: 'Chá aromatizado', data: porVend.map((r) => r.arom), backgroundColor: corMix('#2C5234') },
          { label: 'Chá puro', data: porVend.map((r) => r.puro), backgroundColor: corMix('#7FA37A') },
          { label: 'Acessórios', data: porVend.map((r) => r.acess), backgroundColor: corMix('#C9A227') },
        ],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { position: 'top', labels: { generateLabels: (ch) => ch.data.datasets.map((d, i) => ({ text: d.label, fillStyle: d.backgroundColor[0], strokeStyle: d.backgroundColor[0], lineWidth: 0, datasetIndex: i, hidden: !ch.isDatasetVisible(i) })) } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.pct(c.raw)}` } } },
        scales: { x: { stacked: true, max: 1, ticks: { callback: (v) => fmt.pct(v, 0) }, grid: { color: '#EEE9DF' } }, y: { stacked: true, grid: { display: false } } },
      },
    });
    root.append(h('div', { class: 'mt' },
      TS.cardWithTools('Evolução mensal', `Clique em + no mês para ver os anos e no ano para ver ${new Set(base.map((i) => db.loja[i])).size > 1 ? 'as lojas e, na loja, os vendedores' : 'os vendedores'} · variação contra o mesmo mês do ano anterior (mês incompleto: mesmos dias)`,
        tabM.tools, tabM)));
    root.append(h('div', { class: 'mt' }, TS.card('Mix de vendas por vendedor', `% do faturamento de chás e acessórios · no fim: média da loja${temFr && fr.mix ? ' e da franquia' : ''}`, mixChart)));

    // ---- histórico de faturamento por loja
    // agrupado pelo período do filtro: semana/mês atual = por dia; até ~6 meses = por semana; ano ou mais = por mês
    const B = TS.baldes(f.de, f.ate);
    const meses = B.chaves;
    const porLoja = TS.agrupar(base.filter((i) => db.D.grupoC[db.grupoC[i]] !== ''), (i) => db.loja[i]);
    const dsLoja = [...porLoja].map(([l, idx], k) => {
      const m = new Map(); for (const i of idx) { const kk = B.chave(db.day[i]); m.set(kk, (m.get(kk) || 0) + (db.vt[i] || 0)); }
      return { label: db.D.loja[l], data: meses.map((x) => m.get(x) ?? null), borderColor: TS.color(k), backgroundColor: TS.alpha(TS.color(k), .12), fill: porLoja.size === 1, tension: .3, pointRadius: 3 };
    });
    if (dsLoja.length > 1) dsLoja.push(TS.dsMedia('Média das lojas', TS.mediaSeries(dsLoja.map((d) => d.data))));
    else if (dsLoja.length === 1) { const m = TS.mediaPontos(dsLoja[0].data); dsLoja.push(TS.dsMedia({ dia: 'Média diária', semana: 'Média semanal', mes: 'Média mensal' }[B.tipo], dsLoja[0].data.map(() => m), { tension: 0 })); }
    if (temFr && dsLoja.length) dsLoja.push(dsFr(meses.map((k) => fr.hist[String(k)] ?? null)));
    root.append(h('div', { class: 'mt' }, TS.card('Histórico de faturamento', `${B.porX[0].toUpperCase() + B.porX.slice(1)} e loja · tracejado = média${temFr ? ' · pontilhado = média da franquia (por loja)' : ''} · acompanha o período do filtro`, TS.chart({
      type: 'line', data: { labels: meses.map(B.rotulo), datasets: dsLoja },
      options: { plugins: { legend: { display: true }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.brl(c.raw)}` } } }, scales: { y: TS.axisBRL, x: TS.axisCat } },
    }))));


    // ---- indicadores mensais por vendedor
    const met = state.compMetrica || 'tkm';
    const TAMS = [50, 100, 250, 500, 1000];
    const rotTam = (t) => (t >= 1000 ? `${t / 1000} kg` : `${t}g`);
    const METRICAS = [['TKM', 'tkm'], ['Atendimentos', 'cupons'], ['PMA', 'pma'], ['IPA', 'ipa'], ...TAMS.map((t) => [`Pacotes ${rotTam(t)}`, 'p' + t])];
    const baseV = base.filter((i) => !I.excluiComparativos.has(db.vend[i]));
    const porV = TS.agrupar(baseV, (i) => db.vend[i]);
    const valMes = (idx) => {
      if (/^p\d+$/.test(met)) {
        const alvo = +met.slice(1);
        return idx.reduce((s, i) => s + (db.so[i] === alvo && I.catChaKg.has(db.cat[i]) ? db.qtd[i] || 0 : 0), 0) || null;
      }
      return TS.indicadores(idx)[met];
    };
    const fmtMet = met === 'tkm' || met === 'pma' ? fmt.brl : met === 'ipa' ? fmt.n2 : fmt.int;
    const dsV = [...porV].sort((a, b) => b[1].length - a[1].length).map(([v, idx], k) => {
      const pm = TS.agrupar(idx, (i) => B.chave(db.day[i]));
      return { label: db.D.vendedor[v], data: meses.map((m) => (pm.get(m) ? valMes(pm.get(m)) : null)), borderColor: TS.color(k), backgroundColor: TS.color(k), tension: .3, cubicInterpolationMode: 'monotone', pointRadius: 3, spanGaps: true };
    });
    // média da loja: TKM/PMA/IPA da loja inteira no mês; contagens = média por vendedor que vendeu no mês
    const porMesV = TS.agrupar(baseV, (i) => B.chave(db.day[i]));
    const contagem = met === 'cupons' || /^p\d+$/.test(met);
    const mediaLoja = contagem ? TS.mediaSeries(dsV.map((d) => d.data)) : meses.map((m) => (porMesV.get(m) ? TS.indicadores(porMesV.get(m))[met] : null));
    if (dsV.length) dsV.push(TS.dsMedia('Média da loja', mediaLoja));
    if (temFr && dsV.length) dsV.push(dsFr(meses.map((k) => (fr.met[String(k)] || {})[met] ?? null)));
    root.append(TS.section('Indicadores por vendedor'), TS.cardWithTools(`${B.nome} por vendedor`, `${/^p\d+$/.test(met) ? 'Pacotes de chá vendidos (unidades). ' : ''}Tracejado = média da loja${contagem ? ' (por vendedor)' : ''}.${temFr ? ` Pontilhado = média da franquia${contagem ? ' (por vendedor)' : ''}.` : ''}`,
      TS.seg(METRICAS, met, (v) => { state.compMetrica = v; TS.render(); }),
      TS.chart({
        type: 'line', data: { labels: meses.map(B.rotulo), datasets: dsV },
        options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { itemSort: (a, b) => (b.raw ?? 0) - (a.raw ?? 0), callbacks: { label: (c) => `${c.dataset.label}: ${fmtMet(c.raw)}` } } }, scales: { y: TS.axisNum(fmtMet), x: TS.axisCat } },
      }, 'tall')));

    // ---- pacotes por tamanho
    const tams = TAMS;
    const baseP = baseV.filter((i) => I.catChaKg.has(db.cat[i]) && tams.includes(db.so[i]));
    const vendP = [...TS.agrupar(baseP, (i) => db.vend[i])].sort((a, b) => b[1].length - a[1].length);
    const dsP = tams.map((t, k) => {
      const d = vendP.map(([, idx]) => idx.reduce((s, i) => s + (db.so[i] === t ? db.qtd[i] || 0 : 0), 0));
      const cor = ['#A9C5A0', '#2C5234', '#C9A227', '#8B5E3C', '#2F6F6A'][k];
      const nv = d.length;
      d.push(nv ? d.reduce((a, b) => a + b, 0) / nv : 0); // média da loja (por vendedor)
      if (temFr && fr.pacotes) d.push(fr.pacotes[t] || 0); // média da franquia (por vendedor)
      return { label: rotTam(t), data: d, backgroundColor: d.map((_, j) => (j === nv + 1 ? TS.alpha(cor, .22) : j === nv ? TS.alpha(cor, .45) : cor)), borderColor: cor, borderWidth: d.map((_, j) => (j >= nv ? 1.5 : 0)), borderRadius: 4 };
    });
    const comFrP = temFr && fr.pacotes;
    root.append(h('div', { class: 'mt' }, TS.card('Pacotes por tamanho', `Unidades vendidas por vendedor no período · no fim: média da loja${comFrP ? ' e da franquia' : ''} por vendedor`, vendP.length ? TS.chart({
      type: 'bar', data: { labels: [...vendP.map(([v]) => db.D.vendedor[v]), 'Média da loja', ...(comFrP ? [FR] : [])], datasets: dsP },
      options: { plugins: { legend: { labels: { generateLabels: (ch) => ch.data.datasets.map((d, i) => ({ text: d.label, fillStyle: d.borderColor, strokeStyle: d.borderColor, lineWidth: 0, datasetIndex: i, hidden: !ch.isDatasetVisible(i) })) } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.dataIndex >= vendP.length ? fmt.n1(c.raw) : fmt.int(c.raw)} un.` } } }, scales: { y: TS.axisNum(fmt.int), x: TS.axisCat } },
    }) : TS.empty())));
    // ---- sua loja × rede (anônimo): último cartão da tela
    if (TS.eu?.perfil !== 'vendedor') root.append(h('div', { class: 'mt' }, TS.cartaoRede()));
    if (fr && fr.minimo) root.append(h('p', { class: 'muted', style: { fontSize: '12px' } }, `A média da franquia aparece nos gráficos quando pelo menos ${fr.minimo} lojas têm vendas no período (hoje: ${fr.lojas}).`));
  };

  // ======================= COMISSIONAMENTO =======================
  TS.pages.comissionamento = function (root) {
    const db = TS.db, c = state.com;
    if (c.meta != null && c.metaYm && c.metaYm !== TS.metaPeriodo().ym) { c.meta = null; c.metaYm = null; }
    const meta = c.meta ?? TS.metaPeriodo().valor ?? 0;
    const base = TS.filtrar();
    const baseSemVend = TS.filtrar({ ignorar: ['vendedores'] });
    root.append(cabecalho('Comissionamento', 'Metas, comissões, premiações, gorjetas e royalties'));
    // a meta é do mês: período que passa de um mês somaria dois meses contra UMA meta — não calcula, pede o mês
    const umMes = TS.periodoUmMes();
    if (!umMes) {
      const ir = (p) => h('button', { type: 'button', class: 'btn', onclick: () => { TS.aplicarPreset(p); TS.render(); } }, p === 'mes' ? 'Ver o mês atual' : 'Ver o mês anterior');
      root.append(h('div', { class: 'notice', 'data-aviso': 'escolha-um-mes' }, h('b', null, 'Escolha um mês. '),
        'A meta e a comissão são do mês: com um período que passa de um mês, as vendas de dois meses seriam comparadas com a meta de um só. Use "Mês atual", "Mês anterior", Ano + Mês ou datas dentro do mesmo mês. ',
        h('span', { class: 'cfg-inline' }, ir('mes'), ir('mesAnt'))));
      return;
    }
    if (!base.length) { root.append(TS.card(null, null, TS.empty())); return; }

    const ateDia = Math.min(state.f.ate ?? db.maxDay, db.maxDay);
    const res = R().comissionamento({ base, baseSemVend, metaLoja: meta, vendBonus: c.vendBonus, ym: TS.metaPeriodo().ym, ate: ateDia });
    if (!(meta > 0)) root.append(h('div', { class: 'notice warn', 'data-aviso': 'sem-meta' }, h('b', null, 'Meta não cadastrada: '),
      `sem a meta de ${TS.ymLabel(TS.metaPeriodo().ym)} a comissão sai pela taxa mínima (abaixo da meta) e o bônus pela menor faixa. Cadastre a meta em Configurações → Lojas.`));
    if (res.feriasMes.length) root.append(h('div', { class: 'notice' }, h('b', null, 'Férias no mês: '),
      res.feriasMes.map((f) => `${f.vendedor} (${fmt.date(f.de)} a ${fmt.date(f.ate)})`).join(' · '),
      '. Nesses dias a meta diária é dividida só entre quem está trabalhando.'));
    // vendas de grupos que não entram em meta, comissão e royalties: o administrador classifica cada produto aqui mesmo
    {
      const I = R().ids, fora = new Map(), prods = new Map();
      const conf = TS.classificacao || {};
      for (const i of base) {
        if (I.eg.has(db.cat[i]) || I.taxas.has(db.desc[i]) || db.D.cat[db.cat[i]] === 'FIDELIDADE' || !(db.vt[i] > 0)) continue;
        const g = db.grupoC[i];
        if (I.arom.has(g) || I.puro.has(g) || I.acess.has(g)) continue;
        const desc = db.D.descricao[db.desc[i]] || '';
        const k = desc.trim().replace(/\s+/g, ' ').toUpperCase();
        const n = db.D.grupoC[g] || '(sem grupo)';
        let p = prods.get(k);
        if (!p) prods.set(k, (p = { desc, grupo: n, vt: 0, qtd: 0, classe: (conf[k] || {}).classe || '' }));
        p.vt += db.vt[i]; p.qtd += db.qtd[i] || 0;
        if (p.classe !== 'fora') fora.set(n, (fora.get(n) || 0) + db.vt[i]);
      }
      const tot = [...fora.values()].reduce((a, b) => a + b, 0);
      const ehAdm = !!(TS.eu && TS.eu.perfil === 'admin');
      const nRecl = Object.values(conf).filter((x) => ['arom', 'puro', 'acess'].includes(x.classe)).length;
      if (prods.size || (ehAdm && nRecl)) {
        const OPC = [['', 'A classificar'], ['fora', 'Fica fora (confirmado)'], ['arom', 'Chá aromatizado'], ['puro', 'Chá puro'], ['acess', 'Acessório']];
        // as escolhas só valem depois de "Salvar classificação" (dá para conferir antes de recalcular)
        const pend = new Map(); // produto -> { de, para }
        const ROTC = Object.fromEntries(OPC);
        const barra = h('div', { class: 'cls-barra', hidden: true });
        const pintarBarra = () => {
          barra.hidden = !pend.size;
          if (!pend.size) return;
          barra.replaceChildren(h('div', null, h('b', null, `${pend.size} alteração${pend.size === 1 ? '' : 'ões'} para salvar: `),
            [...pend].map(([k, x]) => `${k} → ${x.para === '' ? 'volta ao grupo do AppNext' : ROTC[x.para]}`).join(' · ')),
          h('div', { class: 'cfg-inline', style: { marginTop: '6px', gap: '8px' } },
            h('button', { type: 'button', class: 'btn primary', onclick: salvarPend }, 'Salvar classificação'),
            h('button', { type: 'button', class: 'btn', onclick: () => { state.foraAberto = true; TS.render(); } }, 'Cancelar'),
            h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Ao salvar, meta, comissão e royalties são recalculados (em todas as lojas e meses).')));
        };
        const marcar = (prod, de, para, st) => {
          if ((para || '') === (de || '')) { pend.delete(prod); st.textContent = ''; } else { pend.set(prod, { de, para }); st.textContent = 'não salvo'; }
          pintarBarra();
        };
        async function salvarPend(ev) {
          const b = ev.currentTarget; b.disabled = true; b.textContent = 'Salvando…';
          try {
            for (const [prod, x] of pend) {
              const r = await fetch('/api/classificacao', { method: 'PUT', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ produto: prod, classe: x.para || null }) });
              const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
            }
            const recalc = [...pend.values()].some((x) => ['arom', 'puro', 'acess'].includes(x.para) || ['arom', 'puro', 'acess'].includes(x.de));
            await TS.carregarClassificacao();
            if (recalc) TS.recarregar && TS.recarregar(true); else TS.render();
          } catch (e) { b.disabled = false; b.textContent = 'Salvar classificação'; alert(e.message); }
        }
        const lista = [...prods.values()].sort((a, b) => (a.classe === 'fora') - (b.classe === 'fora') || b.vt - a.vt);
        const linhas = lista.map((p) => {
          const sel = h('select', { class: 'f-input', disabled: !ehAdm || null, style: { width: 'auto', minWidth: '180px' } }, OPC.map(([v, t]) => h('option', { value: v, selected: p.classe === v || null }, t)));
          const st = h('span', { class: 'muted', style: { marginLeft: '8px', fontSize: '12px' } });
          sel.addEventListener('change', () => marcar(p.desc, p.classe, sel.value, st));
          return h('tr', { class: p.classe === 'fora' ? 'muted' : null }, h('td', { class: 'l' }, p.desc), h('td', { class: 'l muted' }, p.grupo), h('td', null, fmt.int(p.qtd)), h('td', null, fmt.brl(p.vt)), h('td', { class: 'l' }, sel, st));
        });
        // os que já foram reclassificados (contam na meta): dá para desfazer
        const ROT = { arom: 'Chá aromatizado', puro: 'Chá puro', acess: 'Acessório' };
        const recl = Object.entries(conf).filter(([, x]) => ROT[x.classe]);
        const linhasRecl = recl.map(([k, x]) => {
          const p = { desc: k, classe: x.classe };
          const sel = h('select', { class: 'f-input', disabled: !ehAdm || null, style: { width: 'auto', minWidth: '180px' } }, OPC.map(([v, t]) => h('option', { value: v, selected: x.classe === v || null }, v === '' ? 'Voltar ao grupo do AppNext' : t)));
          const st = h('span', { class: 'muted', style: { marginLeft: '8px', fontSize: '12px' } });
          sel.addEventListener('change', () => marcar(p.desc, p.classe, sel.value, st));
          return h('tr', null, h('td', { class: 'l' }, k), h('td', { class: 'l muted' }, `${x.por || ''}${x.em ? ' · ' + fmt.date(x.em.slice(0, 10)) : ''}`), h('td', { class: 'l' }, sel, st));
        });
        const det = h('details', { class: 'fora-det' }, h('summary', null, prods.size ? `Ver os ${prods.size} produto${prods.size === 1 ? '' : 's'}${ehAdm ? ' e classificar' : ''}` : `Ver os produtos reclassificados no painel (${recl.length})`),
          h('p', { class: 'muted', style: { margin: '6px 0' } }, ehAdm
            ? 'Escolha a classificação de cada produto e clique em "Salvar classificação": chá aromatizado, chá puro ou acessório passam a contar na meta, na comissão e nos royalties (em todas as lojas e em todos os meses, inclusive os já vendidos); "Fica fora" confirma que não conta e o aviso não aparece mais para ele. Vale até alguém mudar aqui.'
            : 'Só o administrador do painel muda a classificação dos produtos.'),
          prods.size ? h('div', { class: 'table-wrap free' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Produto'), h('th', { class: 'l' }, 'Grupo no AppNext'), h('th', null, 'Qtd'), h('th', null, 'Vendido'), h('th', { class: 'l' }, 'Classificação'))), h('tbody', null, linhas))) : null,
          barra,
          recl.length ? h('div', { style: { marginTop: '10px' } }, h('b', null, `Já reclassificados no painel (${recl.length})`), h('div', { class: 'table-wrap free' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Produto'), h('th', { class: 'l' }, 'Por'), h('th', { class: 'l' }, 'Conta como'))), h('tbody', null, linhasRecl)))) : null);
        if (state.foraAberto) det.open = true;
        det.addEventListener('toggle', () => { state.foraAberto = det.open; });
        if (tot >= 1) root.append(h('div', { class: 'notice' }, h('b', null, `${fmt.brl(tot)} em vendas ficaram fora da meta, da comissão e dos royalties`),
          ` porque o grupo do produto não é chá aromatizado, chá puro nem acessório: ${[...fora].sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} (${fmt.brl(v)})`).join(', ')}.${ehAdm ? '' : ' Se algum deveria contar, peça ao administrador do painel para classificar o produto.'}`, det));
        else if (ehAdm) root.append(h('div', { class: 'fora-ok muted' }, prods.size ? 'Os produtos fora da meta deste período já foram confirmados. ' : '', det));
      }
      if (!TS.classificacao && !TS._clsCarregando) TS.carregarClassificacao().then(() => { if (state.page === 'comissionamento') TS.render(); });
    }
    if (res.lojasNoPeriodo > 1) root.append(h('div', { class: 'notice' }, 'Há mais de uma loja no filtro. As regras de comissão mudam por loja, então selecione uma loja para ver os valores corretos.'));
    const mensal = true; // só chega aqui com o período dentro de um mês (TS.periodoUmMes)

    const vendido = res.total.total;
    const naMeta = res.rows.filter((r) => r.metaInd > 0 && r.total >= r.metaInd).length;
    const comMeta = res.rows.filter((r) => r.metaInd > 0).length;
    const rg = res.regras, pr = rg.premiacao;
    const ymMeta = TS.metaPeriodo().ym;
    // mês em andamento: a faixa de cada pessoa ainda pode mudar até o fim do mês
    const fimMes = TS.isoToDay(`${ymMeta}-${String(TS.contas.diasNoMes(ymMeta)).padStart(2, '0')}`);
    const parcial = ymMeta === TS.dayToIso(db.maxDay).slice(0, 7) && Math.max(db.maxDay, TS.todayDay() - 1) < fimMes;
    const minAt = R().minAtendPremiacao(rg);
    const P = res.piso;
    const dicaPiso = `A meta da loja é dividida entre quem tem pelo menos ${P.dias} ${P.dias === 1 ? 'dia' : 'dias'} com venda no mês (regras da loja em Configurações → Lojas → Regras de comissão).`
      + (P.fechado ? '' : `\n\nMês em andamento (dia ${P.dia}): o piso acompanha os dias corridos — até o dia 7 todos com venda dividem; depois vale ${P.dias} × dia do mês ÷ dias do mês, arredondado para baixo. Hoje: ${P.aplicado} ${P.aplicado === 1 ? 'dia' : 'dias'}.`)
      + (P.todosAbaixo ? '\n\nNinguém alcançou o piso: todos com venda dividem.' : '')
      + '\n\nQuem fica abaixo do piso não aumenta o número de pessoas que dividem a meta, mas continua recebendo a comissão pela faixa: a venda dela é comparada com a mesma meta individual dos demais.'
      + (res.foraDaMeta.length ? `\n\nFora da divisão agora: ${res.foraDaMeta.map((x) => `${x.vendedor} (${x.dias} ${x.dias === 1 ? 'dia' : 'dias'} com venda; precisa de ${P.aplicado})`).join(', ')}.` : '');
    root.append(h('div', { class: 'grid g-kpi' },
      TS.kpi('Meta da loja', fmt.brl0(meta), h('span', { 'data-meta-div': String(res.qtdVend) }, `Meta dividida entre ${res.qtdVend} ${res.qtdVend === 1 ? 'pessoa' : 'pessoas'}${res.foraDaMeta.length ? ` · ${res.foraDaMeta.length} fora` : ''}`), dicaPiso),
      TS.kpi('Vendas da meta', fmt.brl0(vendido), h('span', { class: vendido >= meta ? 'up' : 'down' }, `${fmt.pct(meta ? vendido / meta : null)} da meta`),
        'Vendas que contam para a meta e a comissão: chá aromatizado, chá puro e acessórios, sem Espaço Gourmet. É a base do "% da meta" em todas as telas (Início, Meta de hoje, resumo diário). O faturamento da loja (Resumo, Resultado) é maior: inclui o Espaço Gourmet e os outros grupos.'),
      mensal ? TS.kpiProjecao(vendido, meta || null, ymMeta, 'Projeção do mês', { base: 'meta', ate: state.f.ate }) : null,
      TS.kpi('Total a pagar', fmt.brl(res.total.aPagar), rg.rateio && rg.rateio.ativo ? 'rateio igual entre a equipe' : 'comissões + bônus'),
      pr.ativa ? TS.kpi('Premiações', fmt.brl0(res.total.premiacao), `TKM ≥ ${fmt.n2(pr.tkm)}, IPA ≥ ${fmt.n2(pr.ipa)}, PMA ≥ ${fmt.n2(pr.pma)}`,
        `${fmt.brl0(pr.valor)} por indicador quando ${pr.minimo} ou mais estão no mínimo. TKM = vendas ÷ atendimentos; PMA = vendas ÷ itens; IPA = itens ÷ atendimentos (vendas da meta de cada pessoa; o cupom atendido por duas pessoas conta para as duas).${minAt ? ` Só concorre quem tem pelo menos ${fmt.int(minAt)} atendimentos no mês: com poucos cupons o indicador é sorte, não desempenho.` : ''}`) : null,
      TS.kpi('Na meta individual', `${naMeta} de ${comMeta}`, 'vendedores')));
    if (res.foraDaMeta.length) root.append(h('p', { class: 'muted com-fora', 'data-fora-meta': String(res.foraDaMeta.length) },
      `Meta dividida entre ${res.qtdVend} ${res.qtdVend === 1 ? 'pessoa' : 'pessoas'}. Fora da divisão (menos de ${P.aplicado} ${P.aplicado === 1 ? 'dia' : 'dias'} com venda${P.fechado ? '' : ' até agora'}): ${res.foraDaMeta.map((x) => `${x.vendedor} (${x.dias} ${x.dias === 1 ? 'dia' : 'dias'})`).join(', ')}.`, TS.dica(dicaPiso)));
    const eg = R().espacoGourmet({ base, baseSemVend });
    const cfgLoja = res.loja ? (db.metas || []).find((m) => (m.nomesVenda || []).includes(res.loja)) : null;
    const lojaTxt = res.loja ? (TS.lojas || []).find((l) => (db.metas.find((m) => m.id === l.id)?.nomesVenda || []).includes(res.loja))?.nome || res.loja : 'Várias lojas';
    const argsPdf = { res, eg, meta, periodo: TS.periodoTexto(), loja: lojaTxt, feriados: cfgLoja && mensal ? TS.feriadosParaPdf(cfgLoja, ymMeta) : null };
    const umaLoja = res.lojasNoPeriodo <= 1 && !!cfgLoja;
    const travado = !umaLoja || !mensal;
    const dicaTrava = !umaLoja ? 'Escolha uma loja' : 'Escolha um mês no período';
    // envios para a contabilidade: só admin e franqueado (na apresentação aparecem, sem enviar)
    const contab = TS.podeContabilidade() || TS.demo;
    root.append(h('div', { class: 'acoes-pagina' },
      contab ? h('button', { type: 'button', class: 'btn primary', disabled: travado || null, title: travado ? dicaTrava : 'Mostra o e-mail com o PDF anexado antes de enviar',
        onclick: () => TS.abrirContabilidade({ cfg: cfgLoja, ym: ymMeta, args: argsPdf }) }, '✉ Enviar fechamento do mês para a contabilidade') : null,
      contab ? h('button', { type: 'button', class: 'btn primary', disabled: travado || null, title: travado ? dicaTrava : 'Faturamento bruto, taxa de serviço e os XMLs das notas do mês',
        onclick: () => TS.abrirFaturamento({ cfg: cfgLoja, ym: ymMeta, loja: lojaTxt }) }, '🧾 Enviar faturamento e XMLs para a contabilidade') : null,
      contab ? null : h('button', { type: 'button', class: 'btn primary', disabled: res.lojasNoPeriodo > 1 || null, title: res.lojasNoPeriodo > 1 ? 'Escolha uma loja' : 'Abre a impressão: escolha "Salvar como PDF"',
        onclick: () => TS.imprimirFechamento(argsPdf) }, '⎙ Fechamento em PDF'),
      h('a', { class: 'btn', href: '#minha' }, 'Ver como o vendedor vê')));

    const hitCls = (vk, mk) => (r) => (r[mk] > 0 ? (r[vk] >= r[mk] ? 'hit' : 'miss') : '');
    const tab = TS.table({
      cols: [
        { key: 'vendedor', label: 'Vendedor', align: 'l', sticky: true },
        { key: 'aPagar', label: 'A pagar', fmt: fmt.brl, cls: () => 'hit' },
        { key: 'premiacao', label: 'Premiação', title: `${fmt.brl0(pr.valor)} por indicador (TKM, IPA, PMA) no mínimo${minAt ? `; só concorre quem tem pelo menos ${fmt.int(minAt)} atendimentos no mês` : ''}`,
          fmt: (v, r) => (r && r.poucosAtend ? h('small', { class: 'muted' }, `poucos atendimentos (${fmt.int(r.atend)} de ${fmt.int(minAt)})`) : v ? fmt.brl0(v) : '—') },
        { key: 'metaInd', label: 'Meta ind.', fmt: fmt.brl0, title: 'Meta da loja ÷ pessoas que dividem a meta (quem tem o mínimo de dias com venda no mês; férias descontadas). Quem está fora da divisão é comparado com a mesma meta dos demais' },
        { key: 'total', label: 'Vendas da meta', fmt: fmt.brl, title: 'Chá aromatizado + chá puro + acessórios, sem Espaço Gourmet' },
        { key: 'metaArom', label: 'Meta arom.', fmt: fmt.brl0 },
        { key: 'arom', label: 'Aromatizado', fmt: fmt.brl, cls: hitCls('arom', 'metaArom') },
        { key: 'cArom', label: 'Com. arom.', fmt: fmt.brl },
        { key: 'metaPuro', label: 'Meta puro', fmt: fmt.brl0 },
        { key: 'puro', label: 'Puro', fmt: fmt.brl, cls: hitCls('puro', 'metaPuro') },
        { key: 'cPuro', label: 'Com. puro', fmt: fmt.brl },
        { key: 'metaAcess', label: 'Meta acess.', fmt: fmt.brl0 },
        { key: 'acess', label: 'Acessórios', fmt: fmt.brl, cls: hitCls('acess', 'metaAcess') },
        { key: 'cAcess', label: 'Com. acess.', fmt: fmt.brl },
        { key: 'tkm', label: 'TKM', fmt: fmt.brl, cls: (r) => (pr.ativa && r.tkm >= pr.tkm ? 'hit' : '') },
        { key: 'pma', label: 'PMA', fmt: fmt.brl, cls: (r) => (pr.ativa && r.pma >= pr.pma ? 'hit' : '') },
        { key: 'ipa', label: 'IPA', fmt: fmt.n2, cls: (r) => (pr.ativa && r.ipa >= pr.ipa ? 'hit' : '') },
        { key: 'bonus', label: 'Bônus', fmt: (v) => (v == null ? '—' : fmt.brl(v)), title: 'Bônus sobre outros vendedores: % sobre as vendas da meta dos demais. A faixa do % usa as vendas da meta da loja contra a meta da loja (a mesma base do "% da meta")' },
      ],
      rows: res.rows, total: res.total, sortKey: 'aPagar', imprimir: ['vendedor', 'aPagar', 'premiacao', 'metaInd', 'total', 'arom', 'puro', 'acess', 'tkm', 'pma', 'ipa', 'bonus'],
    });
    root.append(TS.section('Comissão por vendedor'), TS.card(h('span', null, 'Comissão por vendedor', parcial ? h('span', { class: 'badge warn com-parcial', title: 'Mês em andamento: os valores usam as vendas até agora contra a meta do mês inteiro. Quem ainda está "abaixo da meta" pode mudar de faixa (e de % de comissão) até o fim do mês.' }, 'parcial: a faixa pode mudar até o fim do mês') : null),
      h('span', null, 'Sem Espaço Gourmet. ', h('b', { class: 'hit', style: { color: '#1F5FBF' } }, 'Azul'), ' = meta batida, ', h('b', { style: { color: '#B5452B' } }, 'vermelho'), ' = abaixo da meta. A linha Total soma os vendedores.'), tab));

    // feriados do mês (horas trabalhadas por pessoa → PDF do fechamento)
    if (cfgLoja && mensal && res.lojasNoPeriodo === 1) {
      const pessoas = res.rows.map((r) => r.vendedor).filter((n) => n && !/^SEM VENDEDOR$/i.test(n));
      root.append(h('div', { class: 'mt' }, TS.cartaoFeriados({ cfg: cfgLoja, pessoas, ym: ymMeta })));
    }

    // EG + royalties
    const tabEG = TS.table({
      cols: [
        { key: 'vendedor', label: 'Vendedor', align: 'l' },
        { key: 'gorjeta', label: 'Gorjeta a pagar', fmt: fmt.brl },
        { key: 'fatEG', label: 'Faturamento EG', fmt: fmt.brl },
        { key: 'tkmEG', label: 'TKM EG', fmt: fmt.brl },
        { key: 'pmaEG', label: 'PMA', fmt: fmt.brl },
        { key: 'ipaEG', label: 'IPA', fmt: fmt.n2 },
      ],
      rows: eg.rows, total: eg.total, sortKey: 'fatEG', maxHeight: '320px',
    });
    const roy = R().royalties(base);
    const tabRoy = TS.table({
      cols: [
        { key: 'loja', label: 'Loja', align: 'l' },
        { key: 'total', label: 'Vendas loja', fmt: fmt.brl },
        { key: 'royLoja', label: 'Roy. loja', fmt: fmt.brl, title: 'Percentual definido nas regras da loja' },
        { key: 'royMkt', label: 'Roy. MKT', fmt: fmt.brl },
        { key: 'fatEG', label: 'Fat. EG', fmt: fmt.brl },
        { key: 'royEG', label: 'Roy. EG', fmt: fmt.brl },
        { key: 'royEGMkt', label: 'Roy. EG MKT', fmt: fmt.brl },
        { key: 'royTotal', label: 'Total', fmt: fmt.brl },
      ],
      rows: roy, sortKey: 'total', maxHeight: 'free',
    });
    root.append(h('div', { class: 'grid g-2 mt' },
      TS.card('Espaço Gourmet: gorjetas', 'Taxa de serviço dividida conforme a regra de cada loja', tabEG),
      TS.card('Royalties', 'Vendas da loja = chás + acessórios', tabRoy)));

  };

  // ======================= CUPONS (Vendas → Cupons) =======================
  /** cupom (chave da venda) → cliente: CPF/CNPJ da nota ou, sem CPF na nota, o CPF que ganhou os pontos no FIXE */
  function clientesDosCupons() {
    const m = new Map();
    if (!TS.cli || !TS.cli.porCPF || !(TS.eu && (TS.eu.pode?.clientes || TS.demo))) return m;
    for (const c of TS.cli.porCPF.values()) for (const k of c.cupons || []) {
      if (!k.itens || !k.itens.length) continue;
      const ch = TS.chaveCupom(k.itens[0]);
      if (!m.has(ch) || (m.get(ch).fixe && k.origem !== 'fixe')) m.set(ch, { cpf: c.cpf, nome: c.nome || '', fixe: k.origem === 'fixe' });
    }
    return m;
  }
  const docTxt = (d) => { const s = String(d || ''); return s.length === 14 ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : s.length === 11 ? s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : s; };
  /** CPF/CNPJ do cupom: clicar abre a ficha do cliente */
  function docCupom(cl) {
    if (!cl) return '';
    return h('button', { type: 'button', class: 'cpf-link', title: (cl.nome ? cl.nome + ' · ' : '') + (cl.fixe ? 'sem CPF na nota; o CPF veio dos pontos lançados no FIXE' : 'CPF/CNPJ na nota') + ' · clique para abrir a ficha',
      onclick: (e) => { e.stopPropagation(); if (TS.cliApi) TS.cliApi.abrirClientes([cl.cpf]); } }, docTxt(cl.cpf), cl.fixe ? h('small', { class: 'muted' }, ' FIXE') : null);
  }
  // NF-e emitidas (Estoque → Notas fiscais → Saída): o cupom com o mesmo número e data é uma nota "grande"
  let nfsCache = null;
  TS.aoLimparCache && TS.aoLimparCache(() => { nfsCache = null; });
  function nfsDaLoja() {
    const loja = state.loja;
    if (!loja || loja === 'todas' || !PAGES_TEM('notas')) return Promise.resolve(null);
    if (nfsCache && nfsCache.loja === loja) return nfsCache.p;
    const p = fetch(TS.api(`nfsaida?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    nfsCache = { loja, p };
    return p;
  }
  const PAGES_TEM = (p) => (TS.GRUPOS || []).some(([, ps]) => ps.includes(p));

  TS.pages.cupons = function (root) {
    const db = TS.db;
    if (TS.subGrupo) root.append(TS.subGrupo('cupons'));
    root.append(cabecalho('Cupons', 'Cada venda do período, por dia e cupom, com os itens, o vendedor e o cliente (CPF/CNPJ)'));
    const base = TS.filtrar();
    if (!base.length) { root.append(TS.card(null, null, TS.empty())); return; }
    const clientes = clientesDosCupons();
    const cliDe = (i) => clientes.get(TS.chaveCupom(i)) || null;
    const temCli = clientes.size > 0;
    const modoCup = state.cupModo || 'dia';
    const segCup = TS.seg([['Por dia e cupom', 'dia'], ['Lista de itens', 'lista']], modoCup, (v) => { state.cupModo = v; TS.render(); });
    const cupSet = new Set(), cpfSet = new Set();
    for (const i of base) {
      const ch = TS.chaveCupom(i);
      cupSet.add(ch);
      if (temCli && clientes.has(ch)) cpfSet.add(ch);
    }
    const nCup = cupSet.size, nCpf = cpfSet.size;
    const subCli = temCli ? ` · ${fmt.int(nCpf)} de ${fmt.int(nCup)} cupons com cliente identificado (clique no CPF/CNPJ para abrir a ficha)` : '';
    if (modoCup === 'lista') {
      const det = base.map((i) => {
        const cl = cliDe(i);
        return { cupom: db.cupom[i], data: db.iso[i], produto: db.D.descricao[db.desc[i]], qtd: db.qtd[i], grupo: db.D.grupoC[db.grupoC[i]], cat: db.D.cat[db.cat[i]], vendedor: db.D.vendedor[db.vend[i]], vt: db.vt[i], cl, doc: cl ? cl.cpf + ' ' + docTxt(cl.cpf) + ' ' + cl.nome : '' };
      });
      const tabDet = TS.table({
        cols: [
          { key: 'cupom', label: 'Cupom', align: 'l', fmt: (v) => String(v) },
          { key: 'data', label: 'Data', align: 'l', fmt: fmt.date },
          temCli ? { key: 'doc', label: 'CPF/CNPJ', align: 'l', render: (r) => docCupom(r.cl), sortVal: (r) => r.doc } : null,
          { key: 'produto', label: 'Produto', align: 'l', wrap: true },
          { key: 'qtd', label: 'Qtd', fmt: fmt.int },
          { key: 'grupo', label: 'Grupo', align: 'l' },
          { key: 'cat', label: 'Categoria', align: 'l', wrap: true },
          { key: 'vendedor', label: 'Vendedor', align: 'l' },
          { key: 'vt', label: 'Valor', fmt: fmt.brl },
        ].filter(Boolean),
        rows: det, sortKey: 'data', pageSize: 50, maxHeight: 'free', search: 'Buscar produto, vendedor, CPF…', searchKeys: ['produto', 'vendedor', 'grupo', 'cat', 'doc'],
        total: { cupom: `${fmt.int(nCup)} cupons`, vt: det.reduce((s, r) => s + (r.vt || 0), 0), qtd: det.reduce((s, r) => s + (r.qtd || 0), 0) },
      });
      root.append(TS.cardWithTools('Cupons do período', 'Todos os itens vendidos' + subCli, h('div', { class: 'table-tools' }, tabDet.searchBox, segCup), tabDet));
    } else {
      const arv = arvoreCupons(base, temCli ? cliDe : null);
      root.append(TS.cardWithTools('Cupons do período', 'Clique em + no dia para ver os cupons e no cupom para ver os itens' + subCli, h('div', { class: 'table-tools' }, arv.busca, segCup), arv.tools, arv));
      nfsDaLoja().then((j) => { if (j && j.notas && j.notas.length) arv.marcarNFe(j.notas); });
    }
  };

  /** Dia → Cupom fiscal → itens */
  function arvoreCupons(idx, cliDe) {
    const db = TS.db;
    const aberto = (state.cupAberto ||= new Set());
    let q = '', limite = 31, nfe = new Map();
    const hhmm = (m) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    // monta dias e cupons uma vez
    const dias = new Map();
    for (const i of idx) {
      const d = db.iso[i];
      let dia = dias.get(d);
      if (!dia) dias.set(d, (dia = { d, cupons: new Map(), vt: 0, qtd: 0 }));
      const k = TS.chaveCupom(i);
      let c = dia.cupons.get(k);
      if (!c) dia.cupons.set(k, (c = { k, num: db.cupom[i], loja: db.D.loja[db.loja[i]], min: db.min[i] ?? null, itens: [], vt: 0, qtd: 0, vend: new Set() }));
      c.itens.push(i); c.vt += db.vt[i] || 0; c.qtd += db.qtd[i] || 0;
      if (c.min == null && db.min[i] != null) c.min = db.min[i];
      const v = db.D.vendedor[db.vend[i]];
      if (v && !/^SEM VENDEDOR$/i.test(v)) c.vend.add(v);
      dia.vt += db.vt[i] || 0; dia.qtd += db.qtd[i] || 0;
    }
    const ordem = [...dias.values()].sort((a, b) => (a.d < b.d ? 1 : -1));
    const varias = new Set(idx.map((i) => db.loja[i])).size > 1;
    const tbl = h('table', { class: 't tree cupons-t' });
    const wrap = h('div', { class: 'table-wrap free' }, tbl);
    const mais = h('div', { class: 'pager' });
    const box = h('div', null, wrap, mais);
    const casa = (i) => {
      if (!q) return true;
      const cl = cliDe && cliDe(i);
      return TS.norm(db.D.descricao[db.desc[i]]).includes(q) || TS.norm(db.D.vendedor[db.vend[i]]).includes(q) || String(db.cupom[i]).includes(q) || TS.norm(db.D.grupoC[db.grupoC[i]]).includes(q)
        || (cl && (cl.cpf.includes(q.replace(/\D/g, '') || '#') || TS.norm(cl.nome).includes(q)));
    };
    const btn = (chave, rot) => {
      const open = aberto.has(chave);
      return h('button', { type: 'button', class: 'tree-btn', 'aria-expanded': String(open), 'aria-label': (open ? 'Recolher ' : 'Expandir ') + rot,
        onclick: () => { if (open) { for (const k of [...aberto]) if (k === chave || k.startsWith(chave + '|')) aberto.delete(k); } else aberto.add(chave); paint(); } }, open ? '−' : '+');
    };
    function paint() {
      tbl.textContent = '';
      tbl.append(h('thead', null, h('tr', null, h('th', { class: 'l sticky-col' }, 'Dia / Cupom / Produto'), h('th', { class: 'l' }, 'Hora'), cliDe ? h('th', { class: 'l' }, 'CPF/CNPJ') : null, h('th', { class: 'l' }, 'Vendedor'), h('th', { class: 'l' }, 'Grupo'), h('th', null, 'Cupons'), h('th', null, 'Itens'), h('th', null, 'Valor'))));
      const tb = h('tbody');
      let mostrados = 0, totC = 0, totI = 0, totV = 0;
      const lista = q ? ordem.filter((dia) => [...dia.cupons.values()].some((c) => c.itens.some(casa))) : ordem;
      for (const dia of lista) {
        const cups = [...dia.cupons.values()].filter((c) => !q || c.itens.some(casa)).sort((a, b) => (a.min ?? 9999) - (b.min ?? 9999) || a.num - b.num);
        const vt = q ? cups.reduce((s, c) => s + c.vt, 0) : dia.vt, qtd = q ? cups.reduce((s, c) => s + c.qtd, 0) : dia.qtd;
        totC += cups.length; totI += qtd; totV += vt;
        if (mostrados >= limite) continue;
        mostrados++;
        const kD = 'd' + dia.d;
        const wd = new Date(dia.d + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
        tb.append(h('tr', { class: 'lv0' }, h('td', { class: 'l sticky-col tree-l' }, h('span', { class: 'tree-cell' }, btn(kD, dia.d), h('span', null, `${fmt.date(dia.d)} · ${wd}`))),
          h('td'), cliDe ? h('td') : null, h('td'), h('td'), h('td', null, fmt.int(cups.length)), h('td', null, fmt.int(qtd)), h('td', null, fmt.brl(vt))));
        if (!aberto.has(kD) && !q) continue;
        for (const c of cups) {
          const kC = `${kD}|${c.k}`;
          const nf = nfe.get(c.num + '|' + dia.d);
          tb.append(h('tr', { class: 'lv1' }, h('td', { class: 'l sticky-col tree-l n1' }, h('span', { class: 'tree-cell' }, btn(kC, 'cupom ' + c.num), nf ? h('span', null, 'Nota fiscal ', h('button', { type: 'button', class: 'cpf-link', title: `NF-e ${nf.numero}${nf.natOp ? ' · ' + nf.natOp : ''}${nf.dest && nf.dest.nome ? ' · ' + nf.dest.nome : ''}. Clique para ver a nota, o XML e o DANFE.`, onclick: (e) => { e.stopPropagation(); if (TS.abrirNFe) TS.abrirNFe(nf.chave); } }, String(c.num)), varias ? h('small', { class: 'muted' }, ` · ${c.loja}`) : null)
              : h('span', null, `Cupom ${c.num}`, varias ? h('small', { class: 'muted' }, ` · ${c.loja}`) : null))),
            h('td', { class: 'l' }, hhmm(c.min)), cliDe ? h('td', { class: 'l' }, docCupom(cliDe(c.itens[0]))) : null, h('td', { class: 'l' }, [...c.vend].join(', ') || '—'), h('td'), h('td'), h('td', null, fmt.int(c.qtd)), h('td', null, fmt.brl(c.vt))));
          if (!aberto.has(kC)) continue;
          for (const i of c.itens) {
            tb.append(h('tr', { class: 'lv2' + (casa(i) ? '' : ' fora') }, h('td', { class: 'l sticky-col tree-l n2 wrap' }, h('span', { class: 'tree-cell' }, h('span', { class: 'tree-sp' }), h('span', null, db.D.descricao[db.desc[i]]))),
              h('td'), cliDe ? h('td') : null, h('td', { class: 'l' }, db.D.vendedor[db.vend[i]]), h('td', { class: 'l' }, db.D.grupoC[db.grupoC[i]]), h('td'), h('td', null, fmt.int(db.qtd[i])), h('td', null, fmt.brl(db.vt[i]))));
          }
        }
      }
      if (!lista.length) tb.append(h('tr', null, h('td', { colspan: cliDe ? 8 : 7, class: 'l muted' }, 'Nada encontrado.')));
      tbl.append(tb, h('tfoot', null, h('tr', null, h('td', { class: 'l sticky-col' }, `Total · ${fmt.int(lista.length)} dias`), h('td'), cliDe ? h('td') : null, h('td'), h('td'), h('td', null, fmt.int(totC)), h('td', null, fmt.int(totI)), h('td', null, fmt.brl(totV)))));
      mais.textContent = '';
      if (lista.length > limite) mais.append(`Mostrando ${limite} de ${lista.length} dias `, h('button', { type: 'button', class: 'btn', onclick: () => { limite += 31; paint(); } }, 'Mostrar mais dias'));
    }
    const busca = h('input', { class: 'f-input', type: 'search', placeholder: cliDe ? 'Buscar produto, vendedor, cupom, CPF…' : 'Buscar produto, vendedor, cupom…' });
    busca.addEventListener('input', TS.debounce(() => { q = TS.norm(busca.value.trim()); paint(); }, 250));
    paint();
    box.busca = busca;
    // NF-e (modelo 55) com o mesmo número e data de um cupom: a linha vira "NF-e nº" com o link para a nota
    box.marcarNFe = (notas) => {
      nfe = new Map();
      const porNum = new Map();
      for (const n of notas) if (n.situacao !== 'cancelada') (porNum.get(n.numero) || porNum.set(n.numero, []).get(n.numero)).push(n);
      for (const dia of ordem) for (const c of dia.cupons.values()) {
        const cand = porNum.get(c.num);
        if (!cand) continue;
        const d0 = TS.isoToDay(dia.d);
        const n = cand.map((x) => ({ x, dd: Math.abs(TS.isoToDay(x.data) - d0) })).filter((y) => y.dd <= 3).sort((a, b) => a.dd - b.dd)[0];
        if (n) nfe.set(c.num + '|' + dia.d, n.x);
      }
      if (tbl.isConnected) paint();
    };
    box.tools = h('div', { class: 'table-tools', style: { marginBottom: '8px' } },
      h('button', { type: 'button', class: 'btn', onclick: () => { ordem.slice(0, limite).forEach((d) => aberto.add('d' + d.d)); paint(); } }, 'Abrir dias'),
      h('button', { type: 'button', class: 'btn', onclick: () => { ordem.slice(0, limite).forEach((d) => { aberto.add('d' + d.d); d.cupons.forEach((c) => aberto.add(`d${d.d}|${c.k}`)); }); paint(); } }, 'Expandir tudo'),
      h('button', { type: 'button', class: 'btn', onclick: () => { aberto.clear(); paint(); } }, 'Recolher'));
    return box;
  }

  // ======================= PROMOÇÃO =======================
  TS.pages.promocao = function (root) {
    const db = TS.db, f = state.f, N = state.promo.dias;
    root.append(cabecalho('Promoção', 'Compara o período escolhido com os dias imediatamente anteriores'));
    // sugestões para a próxima promoção (validade dos lotes): logo abaixo dos números do período
    const sugestoes = TS.validade ? TS.validade.secaoPromocao(state.loja) : null;
    if (f.de == null) { root.append(h('div', { class: 'notice' }, 'Escolha um período (por exemplo, as datas da promoção) para comparar com os dias anteriores.'), sugestoes || ''); return; }
    // faturamento da loja: com as vendas sem vendedor (definição única)
    const excl = (idx) => idx;
    const atual = excl(TS.filtrar());
    const ant = excl(TS.filtrar({ de: f.de - N, ate: f.de - 1 }));
    const a = TS.indicadores(atual), p = TS.indicadores(ant);
    const desc = (idx) => TS.descontos(idx);
    const rel = (x, y) => (y ? x / y - 1 : null);
    const card = (lab, va, vp, fm) => TS.kpi(lab, fm(va), h('span', null, TS.deltaSpan(rel(va, vp)), ` · antes ${fm(vp)}`));
    // totais (faturamento, atendimentos) com períodos de tamanhos diferentes: a variação é pela média por dia
    const diasAtual = Math.max(1, Math.min(f.ate ?? db.maxDay, db.maxDay) - f.de + 1);
    const cardDia = (lab, va, vp, fm) => TS.kpi(lab, fm(va), h('span', null, TS.deltaSpan(rel(va / diasAtual, vp / N)), ` por dia · antes ${fm(vp)} em ${N} dias`),
      `Variação da média por dia: ${fm(va / diasAtual)}/dia em ${diasAtual} dia(s) contra ${fm(vp / N)}/dia nos ${N} dias anteriores`);
    root.append(h('div', { class: 'grid g-kpi' },
      h('div', { class: 'card kpi' }, h('div', { class: 'kpi-label' }, 'Período comparado'), h('div', { class: 'kpi-value', style: { fontSize: '15px', whiteSpace: 'normal' } }, `${fmt.date(TS.dayToIso(f.de - N))} a ${fmt.date(TS.dayToIso(f.de - 1))}`), h('div', { class: 'kpi-foot' }, `${N} dias antes de ${fmt.date(TS.dayToIso(f.de))}`)),
      card('TKM', a.tkm, p.tkm, fmt.brl), card('PMA', a.pma, p.pma, fmt.brl), card('IPA', a.ipa, p.ipa, fmt.n2),
      cardDia('Atendimentos', a.cupons, p.cupons, fmt.int), cardDia('Faturamento', a.vt, p.vt, fmt.brl0)));
    if (sugestoes) root.append(sugestoes);

    // lucro antes × durante × depois (custo do estoque; só admin e franqueado com uma loja escolhida)
    if (TS.cartaoLucroPromo && TS.podeContabilidade && TS.podeContabilidade() && state.loja && state.loja !== 'todas') {
      const fimP = f.ate ?? db.maxDay;
      const diasDur = fimP - f.de + 1;
      const fimDepois = Math.min(db.maxDay, fimP + N);
      const depois = fimDepois > fimP ? excl(TS.filtrar({ de: fimP + 1, ate: fimDepois })) : [];
      root.append(h('div', { class: 'mt' }, TS.cartaoLucroPromo({ antes: ant, durante: atual, depois, diasAntes: N, diasDurante: diasDur, diasDepois: fimDepois - fimP })));
    }
    const vendA = TS.agrupar(atual, (i) => db.vend[i]), vendP = TS.agrupar(ant, (i) => db.vend[i]);
    const ids = new Set([...vendA.keys(), ...vendP.keys()]);
    const rows = [...ids].map((v) => {
      const x = TS.indicadores(vendA.get(v) || []), y = TS.indicadores(vendP.get(v) || []);
      return {
        vendedor: db.D.vendedor[v], cup: x.cupons, cupP: y.cupons, tkm: x.tkm, tkmP: y.tkm, dTkm: rel(x.tkm, y.tkm), pma: x.pma, pmaP: y.pma, dPma: rel(x.pma, y.pma),
        ipa: x.ipa, ipaP: y.ipa, dIpa: rel(x.ipa, y.ipa), desc: desc(vendA.get(v) || []), descP: desc(vendP.get(v) || []), vt: x.vt, vtP: y.vt, dVt: rel(x.vt / diasAtual, y.vt / N),
      };
    });
    const dcol = (k) => ({ key: k, label: 'Var.', fmt: (v) => (v == null ? '—' : fmt.delta(v)), cls: (r) => (r[k] > 0 ? 'pos' : r[k] < 0 ? 'neg' : 'muted') });
    const ant_ = { cls: () => 'muted' };
    const tab = TS.table({
      cols: [
        { key: 'vendedor', label: 'Vendedor', align: 'l', sticky: true },
        { key: 'vt', label: 'Faturamento', fmt: fmt.brl }, { key: 'vtP', label: 'Antes', fmt: fmt.brl, ...ant_ }, dcol('dVt'),
        { key: 'cup', label: 'Cupons', fmt: fmt.int }, { key: 'cupP', label: 'Antes', fmt: fmt.int, ...ant_ },
        { key: 'tkm', label: 'TKM', fmt: fmt.brl }, { key: 'tkmP', label: 'Antes', fmt: fmt.brl, ...ant_ }, dcol('dTkm'),
        { key: 'pma', label: 'PMA', fmt: fmt.brl }, { key: 'pmaP', label: 'Antes', fmt: fmt.brl, ...ant_ }, dcol('dPma'),
        { key: 'ipa', label: 'IPA', fmt: fmt.n2 }, { key: 'ipaP', label: 'Antes', fmt: fmt.n2, ...ant_ }, dcol('dIpa'),
        { key: 'desc', label: 'Descontos', fmt: fmt.brl }, { key: 'descP', label: 'Antes', fmt: fmt.brl, ...ant_ },
      ],
      rows, sortKey: 'vt',
      total: { vendedor: 'Total', cup: a.cupons, cupP: p.cupons, tkm: a.tkm, tkmP: p.tkm, dTkm: rel(a.tkm, p.tkm), pma: a.pma, pmaP: p.pma, dPma: rel(a.pma, p.pma), ipa: a.ipa, ipaP: p.ipa, dIpa: rel(a.ipa, p.ipa), desc: desc(atual), descP: desc(ant), vt: a.vt, vtP: p.vt, dVt: rel(a.vt / diasAtual, p.vt / N) },
    });
    root.append(TS.section('Por vendedor'), TS.card('Período atual × anterior', `"Antes" = os ${N} dias imediatamente anteriores ao período · a variação do faturamento é pela média por dia (${diasAtual} dia(s) agora × ${N} antes)`, tab));

    const rowsS = rows.filter((r) => r.tkm != null || r.tkmP != null).sort((x, y) => (y.vt || 0) - (x.vt || 0));
    if (rowsS.length > 1) rowsS.push({ vendedor: 'Média da loja', tkm: a.tkm, tkmP: p.tkm, media: true });
    const corS = (cor) => rowsS.map((r) => (r.media ? TS.alpha(cor, .5) : cor));
    root.append(h('div', { class: 'mt' }, TS.card('TKM antes e durante', 'Por vendedor · última coluna = TKM da loja', TS.chart({
      type: 'bar',
      data: { labels: rowsS.map((r) => r.vendedor), datasets: [
        { label: 'Antes', data: rowsS.map((r) => r.tkmP), backgroundColor: corS('#A9C5A0'), borderColor: '#A9C5A0', borderWidth: rowsS.map((r) => (r.media ? 1.5 : 0)), borderRadius: 4 },
        { label: 'Período', data: rowsS.map((r) => r.tkm), backgroundColor: corS('#2C5234'), borderColor: '#2C5234', borderWidth: rowsS.map((r) => (r.media ? 1.5 : 0)), borderRadius: 4 },
      ] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.brl(c.raw)}` } } }, scales: { y: TS.axisNum(fmt.brl0), x: TS.axisCat } },
    }))));
  };
})();
