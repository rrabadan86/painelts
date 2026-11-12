/* Páginas: Resumo, Comparativos, Comissionamento, Promoção + painel de filtros */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  const R = () => TS.rules;

  // ======================= PERÍODO =======================
  const PRESETS = [
    ['Hoje', 'hoje'], ['Semana atual', 'semana'], ['Mês atual', 'mes'], ['Mês anterior', 'mesAnt'], ['30 dias', '30d'], ['Ano atual', 'ano'], ['12 meses', '12m'], ['Tudo', 'tudo'],
  ];
  TS.PRESETS = PRESETS;
  /** referência = último dia com venda (evita "mês atual" vazio quando a planilha ainda não foi atualizada) */
  TS.aplicarPreset = function (p) {
    const db = TS.db, f = state.f;
    const ref = new Date(db.maxDay * 86400000);
    const y = ref.getUTCFullYear(), m = ref.getUTCMonth();
    const d = (yy, mm, dd) => Math.floor(Date.UTC(yy, mm, dd) / 86400000);
    f.preset = p; f.ano = null; f.mes = null;
    if (p === 'hoje') { f.de = TS.todayDay(); f.ate = f.de; }
    else if (p === 'semana') { const hj = TS.todayDay(); const wd = (new Date(hj * 86400000).getUTCDay() + 6) % 7; f.de = hj - wd; f.ate = f.de + 6; } // segunda a domingo
    else if (p === 'mes') { f.de = d(y, m, 1); f.ate = db.maxDay; }
    else if (p === 'mesAnt') { f.de = d(y, m - 1, 1); f.ate = d(y, m, 0); }
    else if (p === '30d') { f.de = db.maxDay - 29; f.ate = db.maxDay; }
    else if (p === 'ano') { f.de = d(y, 0, 1); f.ate = db.maxDay; }
    else if (p === '12m') { f.de = d(y, m - 11, 1); f.ate = db.maxDay; }
    else if (p === 'tudo') { f.de = null; f.ate = null; }
  };
  /** combos Ano / Mês: ano+mês = aquele mês; só ano = o ano todo; só mês = aquele mês em todos os anos */
  TS.aplicarAnoMes = function (ano, mes) {
    const f = state.f, d = (yy, mm, dd) => Math.floor(Date.UTC(yy, mm, dd) / 86400000);
    f.ano = ano || null; f.mes = mes || null;
    if (!f.ano && !f.mes) { TS.aplicarPreset('30d'); return; }
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

  // ======================= PAINEL DE FILTROS =======================
  TS.renderFiltros = function () {
    const box = document.getElementById('filtros');
    box.textContent = '';
    if (state.page === 'clientes') { box.append(TS.filtrosClientes()); return; }
    const db = TS.db, f = state.f, rerender = () => TS.render();

    // período
    const de = h('input', { class: 'f-input', type: 'date', min: TS.dayToIso(db.minDay), max: TS.dayToIso(db.maxDay), value: f.de != null ? TS.dayToIso(f.de) : '' });
    const ate = h('input', { class: 'f-input', type: 'date', min: TS.dayToIso(db.minDay), max: TS.dayToIso(db.maxDay), value: f.ate != null ? TS.dayToIso(f.ate) : '' });
    const onDate = () => { f.de = de.value ? TS.isoToDay(de.value) : null; f.ate = ate.value ? TS.isoToDay(ate.value) : null; f.preset = 'custom'; f.ano = null; f.mes = null; rerender(); };
    TS.aoConfirmar(de, onDate); TS.aoConfirmar(ate, onDate);
    const chips = h('div', { class: 'chips' }, PRESETS.map(([lab, p]) => h('button', { type: 'button', class: 'chip' + (f.preset === p ? ' on' : ''), onclick: () => { TS.aplicarPreset(p); rerender(); } }, lab)));
    const anos = [];
    for (let y = new Date(db.maxDay * 86400000).getUTCFullYear(); y >= new Date(db.minDay * 86400000).getUTCFullYear(); y--) anos.push(y);
    const selAno = h('select', { class: 'f-input', 'aria-label': 'Ano' }, h('option', { value: '' }, 'Todos'),
      anos.map((y) => h('option', { value: y, selected: f.ano === y || null }, String(y))));
    const selMes = h('select', { class: 'f-input', 'aria-label': 'Mês' }, h('option', { value: '' }, 'Todos'),
      TS.MESES_LONGOS.map((m, k) => h('option', { value: k + 1, selected: f.mes === k + 1 || null }, m)));
    const onAnoMes = () => { TS.aplicarAnoMes(+selAno.value || null, +selMes.value || null); rerender(); };
    selAno.addEventListener('change', onAnoMes); selMes.addEventListener('change', onAnoMes);
    box.append(h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Período'), h('div', { class: 'f-row' }, de, ate), chips));
    box.append(h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Ano e mês'),
      h('div', { class: 'f-row anomes' }, h('label', null, h('span', null, 'Ano'), selAno), h('label', null, h('span', null, 'Mês'), selMes)),
      h('div', { class: 'f-hint' }, 'Só o mês = aquele mês em todos os anos.')));

    const opts = (list) => list.map(([s, i]) => [s, i]);
    if (db.opts.lojas.length > 1) box.append(TS.multiSelect({ label: 'Loja', options: opts(db.opts.lojas), selected: f.lojas, onChange: rerender, placeholder: 'Todas as lojas' }));
    box.append(TS.multiSelect({ label: 'Vendedor', options: opts(db.opts.vendedores), selected: f.vendedores, onChange: rerender }));
    box.append(TS.multiSelect({ label: 'Grupo', options: opts(db.opts.grupos), selected: f.grupos, onChange: rerender }));
    box.append(TS.multiSelect({ label: 'Categoria', options: opts(db.opts.cats), selected: f.cats, onChange: rerender, placeholder: 'Todas' }));
    const prod = h('input', { class: 'f-input', type: 'search', placeholder: 'Ex.: earl grey', value: f.produto });
    prod.addEventListener('input', TS.debounce(() => { f.produto = prod.value.trim(); rerender(); }, 500));
    box.append(h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Produto contém'), prod));

    // filtros específicos de cada página
    if (state.page === 'comparativos') {
      const tamanhos = [50, 100, 250, 500];
      box.append(h('div', { class: 'f-sep' }), h('div', { class: 'f-section' }, 'Comparativos'),
        h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Tamanho do pacote'),
          h('div', { class: 'chips' }, tamanhos.map((t) => h('button', { type: 'button', class: 'chip' + (f.tamanhos.has(t) ? ' on' : ''), onclick: () => { f.tamanhos.has(t) ? f.tamanhos.delete(t) : f.tamanhos.add(t); rerender(); } }, `${t}g`)))),
        h('div', { class: 'f-hint' }, 'Sem seleção = todos os produtos.'));
    }
    if (state.page === 'comissionamento') {
      const c = state.com;
      const mp = TS.metaPeriodo();
      const meta = h('input', { class: 'f-input', type: 'number', min: 0, step: 500, value: c.meta ?? mp.valor ?? '' });
      meta.addEventListener('change', () => { c.meta = meta.value === '' ? null : +meta.value; rerender(); });
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
    f.lojas.clear(); f.vendedores.clear(); f.grupos.clear(); f.cats.clear();
    state.cli.cidade.clear(); state.cli.grupos.clear(); state.cli.lojas.clear();
    state.com.vendBonus = ''; state.com.meta = null;
  };
  TS.limparFiltros = function () {
    const f = state.f;
    f.lojas.clear(); f.vendedores.clear(); f.grupos.clear(); f.cats.clear(); f.tamanhos.clear(); f.produto = '';
    TS.aplicarPreset('30d');
    state.com.cupom = '';
    Object.assign(state.cli, { nome: '', cpf: '', cupom: '', produto: '', aniv: '', visMin: '', visMax: '', ausMin: '', ausMax: '' });
    state.cli.cidade.clear(); state.cli.grupos.clear(); state.cli.lojas.clear();
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

  const semSemVendedor = (idx) => idx.filter((i) => !R().ids.semVendedor.has(TS.db.vend[i]));
  /** período anterior de mesmo tamanho (para as variações dos cartões) */
  function periodoAnterior() {
    const f = state.f;
    if (f.de == null) return null;
    const fim = f.ate ?? TS.db.maxDay;
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

  /** tabela em árvore Mês (todos os anos) → Ano → Vendedor */
  function arvoreMensal(base, porMesAll) {
    const db = TS.db;
    const aberto = (state.compAberto ||= new Set());
    const porMes = TS.agrupar(base, (i) => +db.ym[i].slice(5, 7));
    const meses = [...porMes.keys()].sort((x, y) => x - y);
    const ind = (idx) => TS.indicadores(idx);
    const prevDe = (ym, filtro) => {
      const k = `${+ym.slice(0, 4) - 1}${ym.slice(4)}`;
      let idx = porMesAll.get(k);
      if (idx && filtro) idx = idx.filter(filtro);
      return idx && idx.length ? ind(idx) : null;
    };
    // várias lojas: Mês → Ano → Loja → Vendedor
    const multiLoja = new Set(base.map((i) => db.loja[i])).size > 1;
    const cols = [['cupons', 'Cupons', fmt.int], ['tkm', 'TKM', fmt.brl], ['pma', 'PMA', fmt.brl], ['ipa', 'IPA', fmt.n2], ['vt', 'Faturamento', fmt.brl]];
    const tbl = h('table', { class: 't tree' + (multiLoja ? ' multi' : '') });
    const wrap = h('div', { class: 'table-wrap' }, tbl);
    wrap.style.maxHeight = '420px';

    function linha(nivel, chave, rotulo, a, p, temFilhos) {
      const open = aberto.has(chave);
      const btn = temFilhos ? h('button', { type: 'button', class: 'tree-btn', 'aria-expanded': String(open), 'aria-label': (open ? 'Recolher ' : 'Expandir ') + rotulo,
        onclick: () => { open ? fechar(chave) : aberto.add(chave); paint(); } }, open ? '−' : '+') : h('span', { class: 'tree-sp' });
      const tds = [h('td', { class: `l sticky-col tree-l n${nivel}` }, h('span', { class: 'tree-cell' }, btn, h('span', null, rotulo)))];
      for (const [k, , fm] of cols) {
        tds.push(h('td', null, fm(a[k])));
        if (nivel === 0) continue;
        const d = p && p[k] ? a[k] / p[k] - 1 : null;
        tds.push(h('td', { class: d == null ? 'muted' : d > 0 ? 'pos' : d < 0 ? 'neg' : 'muted' }, d == null ? '—' : fmt.delta(d)));
      }
      if (nivel === 0) {
        // mês raiz: sem variação (soma de anos); preenche as colunas de variação vazias
        const out = [tds[0]];
        tds.slice(1).forEach((td) => out.push(td, h('td', { class: 'muted' }, '')));
        return h('tr', { class: `lv${nivel}` }, out);
      }
      return h('tr', { class: `lv${nivel}` }, tds);
    }
    const fechar = (chave) => { for (const k of [...aberto]) if (k === chave || k.startsWith(chave + '|')) aberto.delete(k); };

    function paint() {
      tbl.textContent = '';
      const trh = h('tr', null, h('th', { class: 'l sticky-col' }, multiLoja ? 'Mês / Ano / Loja / Vendedor' : 'Mês / Ano / Vendedor'));
      for (const [, lab] of cols) trh.append(h('th', null, lab), h('th', { title: 'Variação contra o mesmo mês do ano anterior' }, 'vs. ano ant.'));
      tbl.append(h('thead', null, trh));
      const tb = h('tbody');
      for (const m of meses) {
        const idxM = porMes.get(m), kM = 'm' + m;
        const anos = TS.agrupar(idxM, (i) => db.year[i]);
        tb.append(linha(0, kM, `${TS.MESES_LONGOS[m - 1]}`, ind(idxM), null, true));
        if (!aberto.has(kM)) continue;
        for (const y of [...anos.keys()].sort((x, z) => z - x)) {
          const idxY = anos.get(y), ym = `${y}-${String(m).padStart(2, '0')}`, kY = `${kM}|${y}`;
          tb.append(linha(1, kY, String(y), ind(idxY), prevDe(ym), true));
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
      for (const [k, , fm] of cols) tf.append(h('td', null, fm(t[k])), h('td'));
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
    const base = semSemVendedor(TS.filtrar());
    root.append(cabecalho('Resumo de Vendas', 'Desempenho por vendedor, produto e tipo de chá'));
    if (!base.length) { root.append(TS.card(null, null, TS.empty())); return; }

    const ind = TS.indicadores(base);
    const kgTotal = base.reduce((s, i) => s + (I.chaTotal.has(db.grupo[i]) ? db.cha[i] || 0 : 0), 0);
    const pa = periodoAnterior();
    let prev = null;
    if (pa) {
      const pidx = semSemVendedor(TS.filtrar({ de: pa.de, ate: pa.ate }));
      if (pidx.length) prev = { ...TS.indicadores(pidx), kg: pidx.reduce((s, i) => s + (I.chaTotal.has(db.grupo[i]) ? db.cha[i] || 0 : 0), 0) };
    }
    const d = (a, b) => (prev && b ? TS.h('span', null, TS.deltaSpan(a / b - 1), ' ' + pa.txt) : null);
    root.append(h('div', { class: 'grid g-kpi' },
      TS.kpi('Faturamento', fmt.brl0(ind.vt), d(ind.vt, prev?.vt)),
      TS.kpi('Atendimentos (cupons)', fmt.int(ind.cupons), d(ind.cupons, prev?.cupons)),
      TS.kpi('Ticket médio (TKM)', fmt.brl(ind.tkm), d(ind.tkm, prev?.tkm), 'Faturamento ÷ cupons'),
      TS.kpi('Preço médio (PMA)', fmt.brl(ind.pma), d(ind.pma, prev?.pma), 'Faturamento ÷ itens'),
      TS.kpi('Itens por atendimento (IPA)', fmt.n2(ind.ipa), d(ind.ipa, prev?.ipa), 'Itens ÷ cupons'),
      TS.kpi('Chá vendido', fmt.kg(kgTotal) + ' kg', d(kgTotal, prev?.kg)),
      TS.kpi('Espaço Gourmet', fmt.pct(R().pctEG(base)), 'do faturamento'),
      // projeção: só quando o período é o mês em andamento
      (['mes', 'anomes'].includes(state.f.preset) || state.f.preset === 'custom') && state.f.de != null && TS.dayToIso(state.f.de).slice(8) === '01'
        ? TS.kpiProjecao(ind.vt, null, TS.dayToIso(state.f.de).slice(0, 7), 'Projeção do faturamento') : null));

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
        { key: 'cupons', label: 'Cupons', fmt: fmt.int },
        { key: 'tkm', label: 'TKM', fmt: fmt.brl, title: 'Ticket médio' },
        { key: 'pma', label: 'PMA', fmt: fmt.brl, title: 'Preço médio por item' },
        { key: 'ipa', label: 'IPA', fmt: fmt.n2, title: 'Itens por atendimento' },
        { key: 'vt', label: 'Faturamento', fmt: fmt.brl },
        { key: 'kg', label: 'Chá (kg)', fmt: kgFmt },
        ...tipoCols.map((n) => ({ key: 'kg_' + n, label: n, fmt: kgFmt, title: `Chá ${n} em kg` })),
      ],
      rows: rowsV, total: totV, sortKey: 'vt',
    });
    root.append(TS.section('Visão geral'), TS.card('Desempenho por vendedor', 'Clique no título de uma coluna para ordenar', tabVend));

    // ---- dia da semana + produtos
    const lojasIdx = TS.agrupar(base.filter((i) => db.D.grupoC[db.grupoC[i]] !== ''), (i) => db.loja[i]);
    const dsSemana = [...lojasIdx].map(([l, idx], k) => {
      const arr = new Array(7).fill(0);
      for (const i of idx) arr[db.wd[i]] += db.vt[i] || 0;
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
      TS.card('Faturamento por dia da semana', 'Soma do período, por loja', chSemana),
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
    const tipoAtual = state.tipoCha || 'Infusões';
    const resumoTipos = I.tipos.map(([n, set]) => [n, base.reduce((s, i) => s + (set.has(db.grupo[i]) ? db.cha[i] || 0 : 0), 0)]);
    const set = (I.tipos.find(([n]) => n === tipoAtual) || I.tipos[0])[1];
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
        onClick: (_e, els) => { if (els.length) { state.tipoCha = resumoTipos[els[0].index][0]; TS.render(); } },
      },
    }, 'short');
    root.append(TS.section('Vendas por tipo de chá'),
      h('div', { class: 'grid g-2-1' },
        TS.cardWithTools(`Chá ${tipoAtual}`, rowsT.length ? `${rowsT.length} produtos · ${fmt.kg(totT)} kg` : '',
          TS.seg(I.tipos.map(([n]) => [n, n]), tipoAtual, (v) => { state.tipoCha = v; TS.render(); }),
          rowsT.length ? topBar(rowsT.slice(0, 15), (v) => fmt.kg(v) + ' kg', '#2C5234', (v) => `${fmt.kg(v)} (${fmt.pct(v / totT)})`) : TS.empty()),
        TS.card('Kg por tipo', 'Kg e % do total de chá · clique numa barra para ver os produtos', tiposChart)));
  };

  // ======================= COMPARATIVOS =======================
  TS.pages.comparativos = function (root) {
    const db = TS.db, I = R().ids;
    const base = semSemVendedor(TS.filtrar({ usarTamanho: true }));
    root.append(cabecalho('Comparativos', 'Evolução mês a mês, ano contra ano e por vendedor'));
    if (!base.length) { root.append(TS.card(null, null, TS.empty())); return; }

    // ---- dados do ano anterior para o YoY
    const f = state.f;
    const de = f.de ?? db.minDay, ate = f.ate ?? db.maxDay;
    const prevIdx = semSemVendedor(TS.filtrar({ usarTamanho: true, de: de - 366, ate: ate - 365 }));
    const pctEG = R().pctEG(base);
    const indAll = TS.indicadores(base);
    const indPrev = prevIdx.length ? TS.indicadores(prevIdx) : null;
    root.append(h('div', { class: 'grid g-kpi' },
      TS.kpi('Faturamento', fmt.brl0(indAll.vt), indPrev ? h('span', null, TS.deltaSpan(indAll.vt / indPrev.vt - 1), ' vs. mesmo período do ano anterior') : 'sem dados do ano anterior'),
      TS.kpi('Espaço Gourmet', fmt.pct(pctEG), 'do faturamento'),
      TS.kpi('Loja (sem EG)', fmt.pct(pctEG == null ? null : 1 - pctEG), 'do faturamento'),
      TS.kpi('TKM', fmt.brl(indAll.tkm), indPrev ? h('span', null, TS.deltaSpan(indAll.tkm / indPrev.tkm - 1), ' ano contra ano') : null),
      TS.kpi('IPA', fmt.n2(indAll.ipa), indPrev ? h('span', null, TS.deltaSpan(indAll.ipa / indPrev.ipa - 1), ' ano contra ano') : null)));

    // ---- evolução mensal em árvore: Mês → Ano → Vendedor (variação contra o mesmo mês do ano anterior)
    const prevAll = semSemVendedor(TS.filtrar({ usarTamanho: true, ignorar: ['datas'] }));
    const porMesAll = TS.agrupar(prevAll, (i) => db.ym[i]);
    const tabM = arvoreMensal(base, porMesAll);
    // ---- mix por vendedor
    const porVend = [...TS.agrupar(base, (i) => db.vend[i])].map(([v, idx]) => ({ nome: db.D.vendedor[v], ...R().mixPct(idx), vt: TS.soma(idx, 'vt') })).filter((r) => r.arom != null).sort((a, b) => b.vt - a.vt);
    const mixLoja = R().mixPct(base);
    if (porVend.length > 1 && mixLoja.arom != null) porVend.push({ nome: 'Média da loja', ...mixLoja, media: true });
    const corMix = (cor) => porVend.map((r) => (r.media ? TS.alpha(cor, .5) : cor));
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
      TS.cardWithTools('Evolução mensal', `Clique em + no mês para ver os anos e no ano para ver ${new Set(base.map((i) => db.loja[i])).size > 1 ? 'as lojas e, na loja, os vendedores' : 'os vendedores'} · variação contra o mesmo mês do ano anterior`,
        tabM.tools, tabM)));
    root.append(h('div', { class: 'mt' }, TS.card('Mix de vendas por vendedor', '% do faturamento de chás e acessórios · última barra = média da loja', mixChart)));

    // ---- histórico de faturamento por loja
    const meses = [...new Set(base.map((i) => db.ym[i]))].sort();
    const porLoja = TS.agrupar(base.filter((i) => db.D.grupoC[db.grupoC[i]] !== ''), (i) => db.loja[i]);
    const dsLoja = [...porLoja].map(([l, idx], k) => {
      const m = new Map(); for (const i of idx) m.set(db.ym[i], (m.get(db.ym[i]) || 0) + (db.vt[i] || 0));
      return { label: db.D.loja[l], data: meses.map((x) => m.get(x) ?? null), borderColor: TS.color(k), backgroundColor: TS.alpha(TS.color(k), .12), fill: porLoja.size === 1, tension: .3, pointRadius: 3 };
    });
    if (dsLoja.length > 1) dsLoja.push(TS.dsMedia('Média das lojas', TS.mediaSeries(dsLoja.map((d) => d.data))));
    else if (dsLoja.length === 1) { const m = TS.mediaPontos(dsLoja[0].data); dsLoja.push(TS.dsMedia('Média mensal', dsLoja[0].data.map(() => m), { tension: 0 })); }
    root.append(h('div', { class: 'mt' }, TS.card('Histórico de faturamento', 'Por mês e loja · tracejado = média', TS.chart({
      type: 'line', data: { labels: meses.map(TS.ymLabel), datasets: dsLoja },
      options: { plugins: { legend: { display: true }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.brl(c.raw)}` } } }, scales: { y: TS.axisBRL, x: TS.axisCat } },
    }))));

    // ---- sua loja × rede (anônimo)
    if (TS.eu?.perfil !== 'vendedor') root.append(h('div', { class: 'mt' }, TS.cartaoRede()));

    // ---- indicadores mensais por vendedor
    const met = state.compMetrica || 'tkm';
    const METRICAS = [['TKM', 'tkm'], ['Atendimentos', 'cupons'], ['PMA', 'pma'], ['IPA', 'ipa'], ['Pacotes 50g', 'p50'], ['Pacotes 100g', 'p100']];
    const baseV = base.filter((i) => !I.excluiComparativos.has(db.vend[i]));
    const porV = TS.agrupar(baseV, (i) => db.vend[i]);
    const valMes = (idx) => {
      if (met === 'p50' || met === 'p100') {
        const alvo = met === 'p50' ? 50 : 100;
        return idx.reduce((s, i) => s + (db.so[i] === alvo && I.catChaKg.has(db.cat[i]) ? 1 : 0), 0) || null;
      }
      return TS.indicadores(idx)[met];
    };
    const fmtMet = met === 'tkm' || met === 'pma' ? fmt.brl : met === 'ipa' ? fmt.n2 : fmt.int;
    const dsV = [...porV].sort((a, b) => b[1].length - a[1].length).map(([v, idx], k) => {
      const pm = TS.agrupar(idx, (i) => db.ym[i]);
      return { label: db.D.vendedor[v], data: meses.map((m) => (pm.get(m) ? valMes(pm.get(m)) : null)), borderColor: TS.color(k), backgroundColor: TS.color(k), tension: .3, pointRadius: 3, spanGaps: true };
    });
    // média da loja: TKM/PMA/IPA da loja inteira no mês; contagens = média por vendedor que vendeu no mês
    const porMesV = TS.agrupar(baseV, (i) => db.ym[i]);
    const contagem = met === 'cupons' || met === 'p50' || met === 'p100';
    const mediaLoja = contagem ? TS.mediaSeries(dsV.map((d) => d.data)) : meses.map((m) => (porMesV.get(m) ? TS.indicadores(porMesV.get(m))[met] : null));
    if (dsV.length) dsV.push(TS.dsMedia('Média da loja', mediaLoja));
    root.append(TS.section('Indicadores por vendedor'), TS.cardWithTools('Mês a mês por vendedor', `${met.startsWith('p') ? 'Quantidade de pacotes de chá (linhas de venda). ' : ''}Tracejado = média da loja${contagem ? ' (por vendedor)' : ''}.`,
      TS.seg(METRICAS, met, (v) => { state.compMetrica = v; TS.render(); }),
      TS.chart({
        type: 'line', data: { labels: meses.map(TS.ymLabel), datasets: dsV },
        options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { itemSort: (a, b) => (b.raw ?? 0) - (a.raw ?? 0), callbacks: { label: (c) => `${c.dataset.label}: ${fmtMet(c.raw)}` } } }, scales: { y: TS.axisNum(fmtMet), x: TS.axisCat } },
      }, 'tall')));

    // ---- pacotes por tamanho
    const tams = [50, 100, 250, 500];
    const baseP = baseV.filter((i) => I.catChaKg.has(db.cat[i]) && tams.includes(db.so[i]));
    const vendP = [...TS.agrupar(baseP, (i) => db.vend[i])].sort((a, b) => b[1].length - a[1].length);
    const dsP = tams.map((t, k) => {
      const d = vendP.map(([, idx]) => idx.reduce((s, i) => s + (db.so[i] === t ? db.qtd[i] || 0 : 0), 0));
      const cor = ['#A9C5A0', '#2C5234', '#C9A227', '#8B5E3C'][k];
      d.push(d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0); // média da loja (por vendedor)
      return { label: `${t}g`, data: d, backgroundColor: d.map((_, j) => (j === d.length - 1 ? TS.alpha(cor, .45) : cor)), borderColor: cor, borderWidth: d.map((_, j) => (j === d.length - 1 ? 1.5 : 0)), borderRadius: 4 };
    });
    root.append(h('div', { class: 'mt' }, TS.card('Pacotes por tamanho', 'Unidades vendidas por vendedor no período · última coluna = média da loja por vendedor', vendP.length ? TS.chart({
      type: 'bar', data: { labels: [...vendP.map(([v]) => db.D.vendedor[v]), 'Média da loja'], datasets: dsP },
      options: { plugins: { legend: { labels: { generateLabels: (ch) => ch.data.datasets.map((d, i) => ({ text: d.label, fillStyle: d.borderColor, strokeStyle: d.borderColor, lineWidth: 0, datasetIndex: i, hidden: !ch.isDatasetVisible(i) })) } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.dataIndex === c.dataset.data.length - 1 ? fmt.n1(c.raw) : fmt.int(c.raw)} un.` } } }, scales: { y: TS.axisNum(fmt.int), x: TS.axisCat } },
    }) : TS.empty())));
  };

  // ======================= COMISSIONAMENTO =======================
  TS.pages.comissionamento = function (root) {
    const db = TS.db, c = state.com;
    const meta = c.meta ?? TS.metaPeriodo().valor ?? 0;
    const base = TS.filtrar();
    const baseSemVend = TS.filtrar({ ignorar: ['vendedores'] });
    root.append(cabecalho('Comissionamento', 'Metas, comissões, premiações, gorjetas e royalties'));
    if (!base.length) { root.append(TS.card(null, null, TS.empty())); return; }

    const res = R().comissionamento({ base, baseSemVend, metaLoja: meta, vendBonus: c.vendBonus, ym: TS.metaPeriodo().ym });
    if (res.feriasMes.length) root.append(h('div', { class: 'notice' }, h('b', null, 'Férias no mês: '),
      res.feriasMes.map((f) => `${f.vendedor} (${fmt.date(f.de)} a ${fmt.date(f.ate)})`).join(' · '),
      '. Nesses dias a meta diária é dividida só entre quem está trabalhando.'));
    if (res.lojasNoPeriodo > 1) root.append(h('div', { class: 'notice' }, 'Há mais de uma loja no filtro. As regras de comissão mudam por loja, então selecione uma loja para ver os valores corretos.'));
    const mensal = ['mes', 'mesAnt', 'custom'].includes(state.f.preset) || (state.f.preset === 'anomes' && state.f.ano && state.f.mes);
    if (!mensal) root.append(h('div', { class: 'notice' }, 'A meta é mensal. Para fechar a comissão, use "Mês atual", "Mês anterior" ou escolha Ano + Mês no período.'));

    const vendido = res.total.total;
    const naMeta = res.rows.filter((r) => r.metaInd > 0 && r.total >= r.metaInd).length;
    const comMeta = res.rows.filter((r) => r.metaInd > 0).length;
    const rg = res.regras, pr = rg.premiacao;
    const ymMeta = TS.metaPeriodo().ym;
    root.append(h('div', { class: 'grid g-kpi' },
      TS.kpi('Meta da loja', fmt.brl0(meta), `${res.qtdVend} vendedores dividem a meta`),
      TS.kpi('Vendido (chás + acessórios)', fmt.brl0(vendido), h('span', { class: vendido >= meta ? 'up' : 'down' }, `${fmt.pct(meta ? vendido / meta : null)} da meta`)),
      mensal ? TS.kpiProjecao(vendido, meta || null, ymMeta) : null,
      TS.kpi('Total a pagar', fmt.brl(res.total.aPagar), rg.rateio && rg.rateio.ativo ? 'rateio igual entre a equipe' : 'comissões + bônus'),
      pr.ativa ? TS.kpi('Premiações', fmt.brl0(res.total.premiacao), `TKM ≥ ${fmt.n2(pr.tkm)}, IPA ≥ ${fmt.n2(pr.ipa)}, PMA ≥ ${fmt.n2(pr.pma)}`) : null,
      TS.kpi('Na meta individual', `${naMeta} de ${comMeta}`, 'vendedores')));
    const eg = R().espacoGourmet({ base, baseSemVend });
    const cfgLoja = res.loja ? (db.metas || []).find((m) => (m.nomesVenda || []).includes(res.loja)) : null;
    const lojaTxt = res.loja ? (TS.lojas || []).find((l) => (db.metas.find((m) => m.id === l.id)?.nomesVenda || []).includes(res.loja))?.nome || res.loja : 'Várias lojas';
    root.append(h('div', { class: 'acoes-pagina' },
      h('button', { type: 'button', class: 'btn primary', disabled: res.lojasNoPeriodo > 1 || !cfgLoja || !mensal || null,
        title: res.lojasNoPeriodo > 1 || !cfgLoja ? 'Escolha uma loja' : !mensal ? 'Escolha um mês no período' : 'Mostra o e-mail com o PDF anexado antes de enviar',
        onclick: () => TS.abrirContabilidade({ cfg: cfgLoja, ym: ymMeta, args: { res, eg, meta, periodo: TS.periodoTexto(), loja: lojaTxt, feriados: TS.feriadosParaPdf(cfgLoja, ymMeta) } }) }, '✉ Enviar fechamento do mês para a contabilidade'),
      h('a', { class: 'btn', href: '#minha' }, 'Ver como o vendedor vê')));

    const hitCls = (vk, mk) => (r) => (r[mk] > 0 ? (r[vk] >= r[mk] ? 'hit' : 'miss') : '');
    const tab = TS.table({
      cols: [
        { key: 'vendedor', label: 'Vendedor', align: 'l', sticky: true },
        { key: 'aPagar', label: 'A pagar', fmt: fmt.brl, cls: () => 'hit' },
        { key: 'premiacao', label: 'Premiação', fmt: (v) => (v ? fmt.brl0(v) : '—') },
        { key: 'metaInd', label: 'Meta ind.', fmt: fmt.brl0 },
        { key: 'total', label: 'Vendido', fmt: fmt.brl },
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
        { key: 'bonus', label: 'Bônus', fmt: (v) => (v == null ? '—' : fmt.brl(v)), title: 'Bônus sobre outros vendedores' },
      ],
      rows: res.rows, total: res.total, sortKey: 'aPagar',
    });
    root.append(TS.section('Comissão por vendedor'), TS.card('Comissão por vendedor',
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

    // cupons detalhados
    const q = c.cupom;
    const detIdx = q ? base.filter((i) => String(db.cupom[i]).includes(q)) : base;
    const det = detIdx.map((i) => ({
      cupom: db.cupom[i], data: db.iso[i], produto: db.D.descricao[db.desc[i]], qtd: db.qtd[i], grupo: db.D.grupoC[db.grupoC[i]], cat: db.D.cat[db.cat[i]], vendedor: db.D.vendedor[db.vend[i]], vt: db.vt[i],
    }));
    const tabDet = TS.table({
      cols: [
        { key: 'cupom', label: 'Cupom', align: 'l', fmt: (v) => String(v) },
        { key: 'data', label: 'Data', align: 'l', fmt: fmt.date },
        { key: 'produto', label: 'Produto', align: 'l', wrap: true },
        { key: 'qtd', label: 'Qtd', fmt: fmt.int },
        { key: 'grupo', label: 'Grupo', align: 'l' },
        { key: 'cat', label: 'Categoria', align: 'l', wrap: true },
        { key: 'vendedor', label: 'Vendedor', align: 'l' },
        { key: 'vt', label: 'Valor', fmt: fmt.brl },
      ],
      rows: det, sortKey: 'data', pageSize: 50, maxHeight: 'free', search: 'Buscar produto, vendedor…', searchKeys: ['produto', 'vendedor', 'grupo', 'cat'],
      total: { cupom: `${fmt.int(new Set(detIdx.map(TS.chaveCupom)).size)} cupons`, vt: det.reduce((s, r) => s + (r.vt || 0), 0), qtd: det.reduce((s, r) => s + (r.qtd || 0), 0) },
    });
    const modoCup = state.cupModo || 'dia';
    const segCup = TS.seg([['Por dia e cupom', 'dia'], ['Lista de itens', 'lista']], modoCup, (v) => { state.cupModo = v; TS.render(); });
    if (modoCup === 'lista') {
      root.append(TS.section('Detalhamento de cupons'), TS.cardWithTools('Cupons do período', q ? `Filtrando cupom "${q}"` : 'Todos os itens vendidos', h('div', { class: 'table-tools' }, tabDet.searchBox, segCup), tabDet));
    } else {
      const arv = arvoreCupons(detIdx);
      root.append(TS.section('Detalhamento de cupons'), TS.cardWithTools('Cupons do período', q ? `Filtrando cupom "${q}"` : 'Clique em + no dia para ver os cupons e no cupom para ver os itens', h('div', { class: 'table-tools' }, arv.busca, segCup), arv.tools, arv));
    }
  };

  /** Dia → Cupom fiscal → itens */
  function arvoreCupons(idx) {
    const db = TS.db;
    const aberto = (state.cupAberto ||= new Set());
    let q = '', limite = 31;
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
      return TS.norm(db.D.descricao[db.desc[i]]).includes(q) || TS.norm(db.D.vendedor[db.vend[i]]).includes(q) || String(db.cupom[i]).includes(q) || TS.norm(db.D.grupoC[db.grupoC[i]]).includes(q);
    };
    const btn = (chave, rot) => {
      const open = aberto.has(chave);
      return h('button', { type: 'button', class: 'tree-btn', 'aria-expanded': String(open), 'aria-label': (open ? 'Recolher ' : 'Expandir ') + rot,
        onclick: () => { if (open) { for (const k of [...aberto]) if (k === chave || k.startsWith(chave + '|')) aberto.delete(k); } else aberto.add(chave); paint(); } }, open ? '−' : '+');
    };
    function paint() {
      tbl.textContent = '';
      tbl.append(h('thead', null, h('tr', null, h('th', { class: 'l sticky-col' }, 'Dia / Cupom / Produto'), h('th', { class: 'l' }, 'Hora'), h('th', { class: 'l' }, 'Vendedor'), h('th', { class: 'l' }, 'Grupo'), h('th', null, 'Cupons'), h('th', null, 'Itens'), h('th', null, 'Valor'))));
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
          h('td'), h('td'), h('td'), h('td', null, fmt.int(cups.length)), h('td', null, fmt.int(qtd)), h('td', null, fmt.brl(vt))));
        if (!aberto.has(kD) && !q) continue;
        for (const c of cups) {
          const kC = `${kD}|${c.k}`;
          tb.append(h('tr', { class: 'lv1' }, h('td', { class: 'l sticky-col tree-l n1' }, h('span', { class: 'tree-cell' }, btn(kC, 'cupom ' + c.num), h('span', null, `Cupom ${c.num}`, varias ? h('small', { class: 'muted' }, ` · ${c.loja}`) : null))),
            h('td', { class: 'l' }, hhmm(c.min)), h('td', { class: 'l' }, [...c.vend].join(', ') || '—'), h('td'), h('td'), h('td', null, fmt.int(c.qtd)), h('td', null, fmt.brl(c.vt))));
          if (!aberto.has(kC)) continue;
          for (const i of c.itens) {
            tb.append(h('tr', { class: 'lv2' + (casa(i) ? '' : ' fora') }, h('td', { class: 'l sticky-col tree-l n2 wrap' }, h('span', { class: 'tree-cell' }, h('span', { class: 'tree-sp' }), h('span', null, db.D.descricao[db.desc[i]]))),
              h('td'), h('td', { class: 'l' }, db.D.vendedor[db.vend[i]]), h('td', { class: 'l' }, db.D.grupoC[db.grupoC[i]]), h('td'), h('td', null, fmt.int(db.qtd[i])), h('td', null, fmt.brl(db.vt[i]))));
          }
        }
      }
      if (!lista.length) tb.append(h('tr', null, h('td', { colspan: 7, class: 'l muted' }, 'Nada encontrado.')));
      tbl.append(tb, h('tfoot', null, h('tr', null, h('td', { class: 'l sticky-col' }, `Total · ${fmt.int(lista.length)} dias`), h('td'), h('td'), h('td'), h('td', null, fmt.int(totC)), h('td', null, fmt.int(totI)), h('td', null, fmt.brl(totV)))));
      mais.textContent = '';
      if (lista.length > limite) mais.append(`Mostrando ${limite} de ${lista.length} dias `, h('button', { type: 'button', class: 'btn', onclick: () => { limite += 31; paint(); } }, 'Mostrar mais dias'));
    }
    const busca = h('input', { class: 'f-input', type: 'search', placeholder: 'Buscar produto, vendedor, cupom…' });
    busca.addEventListener('input', TS.debounce(() => { q = TS.norm(busca.value.trim()); paint(); }, 250));
    paint();
    box.busca = busca;
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
    if (f.de == null) { root.append(h('div', { class: 'notice' }, 'Escolha um período (por exemplo, as datas da promoção) para comparar com os dias anteriores.')); return; }
    const excl = (idx) => idx.filter((i) => !TS.rules.ids.semVendedor.has(db.vend[i]));
    const atual = excl(TS.filtrar());
    const ant = excl(TS.filtrar({ de: f.de - N, ate: f.de - 1 }));
    const a = TS.indicadores(atual), p = TS.indicadores(ant);
    const desc = (idx) => TS.soma(idx, 'du');
    const rel = (x, y) => (y ? x / y - 1 : null);
    const card = (lab, va, vp, fm) => TS.kpi(lab, fm(va), h('span', null, TS.deltaSpan(rel(va, vp)), ` · antes ${fm(vp)}`));
    root.append(h('div', { class: 'grid g-kpi' },
      h('div', { class: 'card kpi' }, h('div', { class: 'kpi-label' }, 'Período comparado'), h('div', { class: 'kpi-value', style: { fontSize: '15px', whiteSpace: 'normal' } }, `${fmt.date(TS.dayToIso(f.de - N))} a ${fmt.date(TS.dayToIso(f.de - 1))}`), h('div', { class: 'kpi-foot' }, `${N} dias antes de ${fmt.date(TS.dayToIso(f.de))}`)),
      card('TKM', a.tkm, p.tkm, fmt.brl), card('PMA', a.pma, p.pma, fmt.brl), card('IPA', a.ipa, p.ipa, fmt.n2),
      card('Atendimentos', a.cupons, p.cupons, fmt.int), card('Faturamento', a.vt, p.vt, fmt.brl0)));

    const vendA = TS.agrupar(atual, (i) => db.vend[i]), vendP = TS.agrupar(ant, (i) => db.vend[i]);
    const ids = new Set([...vendA.keys(), ...vendP.keys()]);
    const rows = [...ids].map((v) => {
      const x = TS.indicadores(vendA.get(v) || []), y = TS.indicadores(vendP.get(v) || []);
      return {
        vendedor: db.D.vendedor[v], cup: x.cupons, cupP: y.cupons, tkm: x.tkm, tkmP: y.tkm, dTkm: rel(x.tkm, y.tkm), pma: x.pma, pmaP: y.pma, dPma: rel(x.pma, y.pma),
        ipa: x.ipa, ipaP: y.ipa, dIpa: rel(x.ipa, y.ipa), desc: desc(vendA.get(v) || []), descP: desc(vendP.get(v) || []), vt: x.vt, vtP: y.vt, dVt: rel(x.vt, y.vt),
      };
    });
    const dcol = (k) => ({ key: k, label: 'Var.', fmt: (v) => (v == null ? '—' : fmt.delta(v)), cls: (r) => (r[k] > 0 ? 'pos' : r[k] < 0 ? 'neg' : 'muted') });
    const ant_ = { cls: () => 'muted' };
    const tab = TS.table({
      cols: [
        { key: 'vendedor', label: 'Vendedor', align: 'l', sticky: true },
        { key: 'cup', label: 'Cupons', fmt: fmt.int }, { key: 'cupP', label: 'Antes', fmt: fmt.int, ...ant_ },
        { key: 'tkm', label: 'TKM', fmt: fmt.brl }, { key: 'tkmP', label: 'Antes', fmt: fmt.brl, ...ant_ }, dcol('dTkm'),
        { key: 'pma', label: 'PMA', fmt: fmt.brl }, { key: 'pmaP', label: 'Antes', fmt: fmt.brl, ...ant_ }, dcol('dPma'),
        { key: 'ipa', label: 'IPA', fmt: fmt.n2 }, { key: 'ipaP', label: 'Antes', fmt: fmt.n2, ...ant_ }, dcol('dIpa'),
        { key: 'desc', label: 'Descontos', fmt: fmt.brl }, { key: 'descP', label: 'Antes', fmt: fmt.brl, ...ant_ },
        { key: 'vt', label: 'Faturamento', fmt: fmt.brl }, { key: 'vtP', label: 'Antes', fmt: fmt.brl, ...ant_ }, dcol('dVt'),
      ],
      rows, sortKey: 'vt',
      total: { vendedor: 'Total', cup: a.cupons, cupP: p.cupons, tkm: a.tkm, tkmP: p.tkm, dTkm: rel(a.tkm, p.tkm), pma: a.pma, pmaP: p.pma, dPma: rel(a.pma, p.pma), ipa: a.ipa, ipaP: p.ipa, dIpa: rel(a.ipa, p.ipa), desc: desc(atual), descP: desc(ant), vt: a.vt, vtP: p.vt, dVt: rel(a.vt, p.vt) },
    });
    root.append(TS.section('Por vendedor'), TS.card('Período atual × anterior', '"Antes" = os dias imediatamente anteriores ao período', tab));

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
