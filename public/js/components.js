/* Componentes de interface: seleção múltipla, tabela, gráficos, cartões */
'use strict';
(function () {
  const { h, fmt } = TS;

  // ---------- seleção múltipla ----------
  /** options: [[label, value]], selected: Set, onChange(Set) */
  TS.multiSelect = function ({ label, options, selected, onChange, placeholder = 'Todos' }) {
    const wrap = h('div', { class: 'ms' });
    const btnText = h('span');
    const btn = h('button', { class: 'ms-btn', type: 'button', 'aria-haspopup': 'listbox' }, btnText);
    const search = h('input', { class: 'f-input ms-search', placeholder: 'Buscar…', type: 'search' });
    const list = h('div', { class: 'ms-list', role: 'listbox' });
    const pop = h('div', { class: 'ms-pop' },
      options.length > 7 ? search : null,
      h('div', { class: 'ms-actions' },
        h('button', { class: 'link-btn', type: 'button', onclick: () => { options.forEach(([, v]) => selected.add(v)); refresh(true); } }, 'Marcar todos'),
        h('button', { class: 'link-btn', type: 'button', onclick: () => { selected.clear(); refresh(true); } }, 'Limpar')),
      list);
    wrap.append(btn, pop);

    function paintBtn() {
      if (!selected.size || selected.size === options.length) { btnText.textContent = placeholder; btnText.className = 'muted'; }
      else if (selected.size === 1) { const o = options.find(([, v]) => selected.has(v)); btnText.textContent = o ? o[0] : '1 selecionado'; btnText.className = ''; }
      else { btnText.textContent = `${selected.size} selecionados`; btnText.className = ''; }
    }
    function paintList() {
      const q = TS.norm(search.value);
      list.textContent = '';
      for (const [lab, val] of options) {
        if (q && !TS.norm(lab).includes(q)) continue;
        const cb = h('input', { type: 'checkbox' });
        cb.checked = selected.has(val);
        cb.addEventListener('change', () => { cb.checked ? selected.add(val) : selected.delete(val); refresh(true); });
        list.append(h('label', { class: 'ms-item' }, cb, h('span', null, lab || '(vazio)')));
      }
    }
    function refresh(changed) {
      if (selected.size === options.length) selected.clear();
      paintBtn(); paintList();
      if (changed) onChange(selected);
    }
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ms.open').forEach((m) => m !== wrap && m.classList.remove('open'));
      wrap.classList.toggle('open');
      if (wrap.classList.contains('open')) { search.value = ''; paintList(); search.focus(); }
    });
    search.addEventListener('input', paintList);
    refresh(false);
    return h('div', { class: 'f-group' }, label ? h('span', { class: 'f-label' }, label) : null, wrap);
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('.ms')) document.querySelectorAll('.ms.open').forEach((m) => m.classList.remove('open')); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.ms.open').forEach((m) => m.classList.remove('open')); });

  // ---------- cartões ----------
  TS.card = (title, sub, ...body) => h('div', { class: 'card' },
    (title || sub) ? h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'card-title' }, title), sub ? h('div', { class: 'card-sub' }, sub) : null)) : null,
    ...body);
  TS.cardWithTools = (title, sub, tools, ...body) => h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'card-title' }, title), sub ? h('div', { class: 'card-sub' }, sub) : null), tools),
    ...body);
  TS.kpi = (label, value, foot, title) => h('div', { class: 'card kpi', title: title || null },
    h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), foot ? h('div', { class: 'kpi-foot' }, foot) : null);
  TS.deltaSpan = (v) => h('span', { class: v > 0 ? 'up' : v < 0 ? 'down' : '' }, fmt.delta(v));
  TS.section = (t) => h('div', { class: 'section-label' }, t);
  TS.empty = (t = 'Sem dados para os filtros escolhidos.') => h('div', { class: 'empty' }, t);

  TS.seg = function (items, current, onPick) {
    const el = h('div', { class: 'seg', role: 'tablist' });
    for (const [lab, val] of items) {
      el.append(h('button', { type: 'button', class: val === current ? 'on' : '', onclick: () => onPick(val) }, lab));
    }
    return el;
  };

  // ---------- tabela ordenável ----------
  /**
   * cols: [{key, label, fmt, align:'l'|'r', cls:(row)=>string, sticky, title}]
   * rows: objetos; total: objeto opcional; sort: {key, dir}
   */
  TS.table = function ({ cols, rows, total, sortKey, sortDir = 'desc', maxHeight, pageSize, search, searchKeys, onRowClick, empty }) {
    let sk = sortKey, sd = sortDir, page = 0, q = '';
    const wrap = h('div');
    const tbl = h('table', { class: 't' });
    const tw = h('div', { class: 'table-wrap' + (maxHeight === 'free' ? ' free' : '') }, tbl);
    if (maxHeight && maxHeight !== 'free') tw.style.maxHeight = maxHeight;
    const pager = h('div', { class: 'pager' });
    let searchBox = null;
    if (search) {
      searchBox = h('input', { class: 'f-input', type: 'search', placeholder: search });
      searchBox.addEventListener('input', TS.debounce(() => { q = TS.norm(searchBox.value); page = 0; paint(); }, 200));
    }
    function sorted() {
      let r = rows;
      if (q) r = r.filter((row) => (searchKeys || cols.map((c) => c.key)).some((k) => TS.norm(row[k]).includes(q)));
      if (!sk) return r;
      const col = cols.find((c) => c.key === sk);
      const val = col && col.sortVal ? col.sortVal : (row) => row[sk];
      return [...r].sort((a, b) => {
        const x = val(a), y = val(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        const c = typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y;
        return sd === 'asc' ? c : -c;
      });
    }
    function paint() {
      tbl.textContent = '';
      const thead = h('thead'), trh = h('tr');
      cols.forEach((c) => {
        const th = h('th', { class: [c.align === 'l' ? 'l' : '', c.sticky ? 'sticky-col' : '', sk === c.key ? 'sorted' : ''].join(' '), title: c.title || null, scope: 'col' },
          c.label, h('span', { class: 'arrow' }, sk === c.key ? (sd === 'asc' ? '▲' : '▼') : '↕'));
        th.addEventListener('click', () => { if (sk === c.key) sd = sd === 'asc' ? 'desc' : 'asc'; else { sk = c.key; sd = c.align === 'l' ? 'asc' : 'desc'; } paint(); });
        trh.append(th);
      });
      thead.append(trh); tbl.append(thead);
      const all = sorted();
      const tb = h('tbody');
      const start = pageSize ? page * pageSize : 0;
      const slice = pageSize ? all.slice(start, start + pageSize) : all;
      for (const row of slice) {
        const tr = h('tr');
        if (onRowClick) { tr.style.cursor = 'pointer'; tr.addEventListener('click', () => onRowClick(row)); }
        cols.forEach((c) => {
          const v = row[c.key];
          const extra = c.cls ? c.cls(row) : '';
          const content = c.render ? c.render(row) : (c.fmt ? c.fmt(v, row) : (v ?? ''));
          tr.append(h('td', { class: [c.align === 'l' ? 'l' : '', c.sticky ? 'sticky-col' : '', c.wrap ? 'wrap' : '', extra].join(' ') }, content));
        });
        tb.append(tr);
      }
      if (!slice.length) tb.append(h('tr', null, h('td', { colspan: cols.length, class: 'l muted' }, empty || 'Nada encontrado.')));
      tbl.append(tb);
      if (total) {
        const tf = h('tfoot'), tr = h('tr');
        cols.forEach((c, j) => {
          const v = total[c.key];
          tr.append(h('td', { class: [c.align === 'l' ? 'l' : '', c.sticky ? 'sticky-col' : ''].join(' ') }, j === 0 && v == null ? 'Total' : (v == null ? '' : (c.fmt ? c.fmt(v, total) : v))));
        });
        tf.append(tr); tbl.append(tf);
      }
      pager.textContent = '';
      if (pageSize && all.length > pageSize) {
        const pages = Math.ceil(all.length / pageSize);
        pager.append(
          `${NF(start + 1)}–${NF(Math.min(start + pageSize, all.length))} de ${NF(all.length)}`,
          h('button', { class: 'btn', type: 'button', disabled: page === 0 || null, onclick: () => { page--; paint(); } }, '‹ Anterior'),
          h('button', { class: 'btn', type: 'button', disabled: page >= pages - 1 || null, onclick: () => { page++; paint(); } }, 'Próxima ›'));
      }
    }
    const NF = (n) => fmt.int(n);
    paint();
    wrap.append(tw, pager);
    wrap.searchBox = searchBox;
    return wrap;
  };

  // ---------- gráficos (Chart.js) ----------
  const PALETA = ['#2C5234', '#C9A227', '#7FA37A', '#B5652B', '#2F6F6A', '#8B5E3C', '#A9C5A0', '#6B4E71', '#D98F4E', '#4E7D96', '#1F3D2B', '#E3C766'];
  TS.cores = PALETA;
  const charts = new Set();
  TS.destroyCharts = () => { charts.forEach((c) => c.destroy()); charts.clear(); };

  if (window.Chart) {
    Chart.defaults.font.family = '"Segoe UI", system-ui, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#5B6B60';
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.tooltip.backgroundColor = '#1F3D2B';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation.duration = 250;

    // rótulos de valor nas barras
    Chart.register({
      id: 'valueLabels',
      afterDatasetsDraw(chart, _a, opts) {
        if (!opts || !opts.display) return;
        const { ctx } = chart;
        ctx.save();
        ctx.font = '11px "Segoe UI", sans-serif';
        chart.data.datasets.forEach((ds, di) => {
          const meta = chart.getDatasetMeta(di);
          if (meta.hidden) return;
          meta.data.forEach((el, i) => {
            const v = ds.data[i];
            if (v == null) return;
            const txt = opts.format ? opts.format(v, i, di) : String(v);
            const horiz = chart.options.indexAxis === 'y';
            ctx.fillStyle = '#24302A';
            if (horiz) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, el.x + 6, el.y); }
            else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(txt, el.x, el.y - 4); }
          });
        });
        ctx.restore();
      },
    });
  }

  /** Cria um gráfico dentro de um contêiner com altura fixa */
  TS.chart = function (config, cls = '') {
    const box = h('div', { class: 'chart-box ' + cls });
    const canvas = h('canvas', { role: 'img', 'aria-label': config.ariaLabel || 'Gráfico' });
    box.append(canvas);
    requestAnimationFrame(() => {
      if (!box.isConnected) return;
      const c = new Chart(canvas, config);
      charts.add(c);
    });
    return box;
  };

  TS.axisBRL = { ticks: { callback: (v) => fmt.compact(v) }, grid: { color: '#EEE9DF' }, border: { display: false } };
  TS.axisNum = (f) => ({ ticks: { callback: (v) => f(v) }, grid: { color: '#EEE9DF' }, border: { display: false } });
  TS.axisCat = { grid: { display: false }, border: { display: false } };
  TS.color = (i) => PALETA[i % PALETA.length];
  TS.alpha = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
})();
