/* Componentes de interface: seleção múltipla, tabela, gráficos, cartões */
'use strict';
(function () {
  const { h, fmt } = TS;

  // ---------- seleção múltipla ----------
  /** options: [[label, value]], selected: Set, onChange(Set) */
  // Vazio = sem filtro (todos). Na lista, "sem filtro" aparece com tudo marcado.
  // O popup continua aberto enquanto a pessoa marca: a tela é redesenhada a cada mudança,
  // então guardamos qual filtro estava aberto (e a busca/rolagem) e reabrimos o novo igual.
  let msAberto = null; // { key, q, scroll, nenhum }
  TS.multiSelect = function ({ label, options, selected, onChange, placeholder = 'Todos', key }) {
    const chave = key || label || placeholder;
    const wrap = h('div', { class: 'ms' });
    const btnText = h('span');
    const btn = h('button', { class: 'ms-btn', type: 'button', 'aria-haspopup': 'listbox' }, btnText);
    const search = h('input', { class: 'f-input ms-search', placeholder: 'Buscar…', type: 'search' });
    const list = h('div', { class: 'ms-list', role: 'listbox' });
    let nenhum = false; // depois de "Limpar": mostra tudo desmarcado (o filtro continua "todos" até marcar algo)
    const todos = () => options.map(([, v]) => v);
    const marcado = (v) => (nenhum ? false : !selected.size || selected.has(v));
    const guardar = () => { msAberto = { key: chave, q: search.value, scroll: list.scrollTop, nenhum }; };
    const pop = h('div', { class: 'ms-pop' },
      options.length > 7 ? search : null,
      h('div', { class: 'ms-actions' },
        h('button', { class: 'link-btn', type: 'button', onclick: () => { nenhum = false; const mudou = selected.size > 0; selected.clear(); refresh(mudou); } }, 'Marcar todos'),
        h('button', { class: 'link-btn', type: 'button', onclick: () => { nenhum = true; const mudou = selected.size > 0; selected.clear(); refresh(mudou); } }, 'Limpar')),
      list);
    wrap.append(btn, pop);

    function paintBtn() {
      if (!selected.size || selected.size === options.length) { btnText.textContent = placeholder; btnText.className = 'muted'; }
      else if (selected.size === 1) { const o = options.find(([, v]) => selected.has(v)); btnText.textContent = o ? o[0] : '1 selecionado'; btnText.className = ''; }
      else { btnText.textContent = `${selected.size} selecionados`; btnText.className = ''; }
    }
    function paintList() {
      const q = TS.norm(search.value);
      const sc = list.scrollTop;
      list.textContent = '';
      for (const [lab, val] of options) {
        if (q && !TS.norm(lab).includes(q)) continue;
        const cb = h('input', { type: 'checkbox' });
        cb.checked = marcado(val);
        cb.addEventListener('change', () => {
          // parte do que está marcado na tela
          const atual = new Set(nenhum ? [] : selected.size ? selected : todos());
          cb.checked ? atual.add(val) : atual.delete(val);
          nenhum = false;
          selected.clear();
          if (atual.size && atual.size < options.length) atual.forEach((v) => selected.add(v));
          else if (!atual.size) nenhum = true; // desmarcou tudo: sem filtro, mas a lista fica vazia
          refresh(true);
        });
        list.append(h('label', { class: 'ms-item' }, cb, h('span', null, lab || '(vazio)')));
      }
      list.scrollTop = sc;
    }
    function refresh(changed) {
      if (selected.size === options.length) selected.clear();
      paintBtn(); paintList();
      if (changed) { if (wrap.classList.contains('open')) guardar(); onChange(selected); }
    }
    const abrir = (restaurar) => {
      document.querySelectorAll('.ms.open').forEach((m) => m !== wrap && m.classList.remove('open'));
      wrap.classList.add('open');
      if (restaurar) { search.value = restaurar.q || ''; nenhum = !!restaurar.nenhum && !selected.size; paintList(); list.scrollTop = restaurar.scroll || 0; }
      else { search.value = ''; nenhum = false; paintList(); if (!matchMedia('(pointer: coarse)').matches) search.focus(); }
    };
    btn.addEventListener('click', () => {
      if (wrap.classList.contains('open')) { wrap.classList.remove('open'); msAberto = null; } else { abrir(null); msAberto = { key: chave, q: '', scroll: 0 }; }
    });
    search.addEventListener('input', () => { paintList(); guardar(); });
    list.addEventListener('scroll', () => { if (wrap.classList.contains('open')) guardar(); });
    refresh(false);
    // estava aberto antes de a tela ser redesenhada: reabre
    if (msAberto && msAberto.key === chave) { const r = msAberto; queueMicrotask(() => { if (wrap.isConnected) abrir(r); else setTimeout(() => wrap.isConnected && abrir(r), 0); }); }
    return h('div', { class: 'f-group' }, label ? h('span', { class: 'f-label' }, label) : null, wrap);
  };
  const fecharTodos = () => { document.querySelectorAll('.ms.open').forEach((m) => m.classList.remove('open')); msAberto = null; };
  document.addEventListener('click', (e) => { if (!e.target.closest('.ms')) fecharTodos(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharTodos(); });

  // ---------- expandir tabela em tela cheia ----------
  // Todo cartão com tabela ganha o botão ⤢: o próprio cartão vai para uma camada por cima da tela
  // (mesmos elementos, então ordenar/abrir/buscar continua funcionando) e volta ao fechar.
  let expandido = null; // { titulo, card, marcador, camada }
  function fecharExpandido(lembrar) {
    if (!expandido) return;
    const { card, marcador, camada } = expandido;
    card.classList.remove('card-cheio');
    card.querySelectorAll('.table-wrap table').forEach((t) => { t.style.fontSize = ''; t.classList.remove('quebra-th'); });
    expandido.fechar.remove();
    if (marcador.isConnected) marcador.replaceWith(card); else card.remove();
    camada.remove();
    document.body.classList.remove('com-camada');
    TS.expandidoTitulo = lembrar ? expandido.titulo : null;
    expandido = null;
  }
  function expandir(card) {
    fecharExpandido(false);
    const titulo = card.querySelector('.card-title')?.textContent || '';
    const marcador = document.createComment('cartão expandido');
    card.replaceWith(marcador);
    const fechar = h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: () => fecharExpandido(false) }, '✕');
    const camada = h('div', { class: 'camada-cheia', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo, onclick: (e) => { if (e.target === camada) fecharExpandido(false); } }, card);
    card.classList.add('card-cheio');
    card.prepend(fechar);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    expandido = { titulo, card, marcador, camada, fechar };
    // cabe na largura sem rolar para o lado: diminui a letra aos poucos (até 10px) e quebra os títulos
    requestAnimationFrame(() => {
      for (const w of card.querySelectorAll('.table-wrap')) {
        const t = w.querySelector('table');
        if (!t) continue;
        let fs = 12.5;
        while (t.scrollWidth > w.clientWidth + 1 && fs > 10) { fs -= .5; t.style.fontSize = fs + 'px'; if (fs <= 11.5) t.classList.add('quebra-th'); }
      }
    });
    TS.expandidoTitulo = titulo;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expandido && !document.querySelector('.ms.open')) fecharExpandido(false); });
  TS.botoesExpandir = function (root) {
    // a tela foi redesenhada: a camada antiga ficou com o cartão velho
    const reabrir = TS.expandidoTitulo;
    if (expandido) { const { camada } = expandido; camada.remove(); document.body.classList.remove('com-camada'); expandido = null; }
    adicionarBotoes(root, reabrir);
    vigiar(root);
  };
  /** põe o botão ⤢ nos cartões com tabela que ainda não têm (não mexe no que está expandido) */
  function adicionarBotoes(root, reabrir) {
    for (const card of root.querySelectorAll('.card')) {
      if (card.classList.contains('kpi') || card.tagName === 'DETAILS') continue;
      // só a tabela/gráfico do próprio cartão (não a de um cartão dentro dele)
      const temTab = [...card.querySelectorAll('.table-wrap')].some((t) => t.closest('.card') === card);
      const temGraf = [...card.querySelectorAll('.chart-box')].some((t) => t.closest('.card') === card);
      if (!temTab && !temGraf) continue;
      const temExp = !!card.querySelector(':scope > .card-head .exp-btn'), temPrt = !!card.querySelector(':scope > .card-head .prt-btn');
      if ((temExp || !temTab) && temPrt) continue;
      let head = card.querySelector(':scope > .card-head');
      if (!head) { head = h('div', { class: 'card-head' }, h('div')); card.prepend(head); }
      if (!temPrt) head.append(h('button', { type: 'button', class: 'exp-btn prt-btn', title: 'Imprimir (ou salvar em PDF)', 'aria-label': 'Imprimir', onclick: () => TS.imprimir(card) }, '🖨', h('span', null, 'Imprimir')));
      if (temTab && !temExp) {
        head.append(h('button', { type: 'button', class: 'exp-btn', title: 'Expandir em tela cheia', 'aria-label': 'Expandir em tela cheia', onclick: () => expandir(card) }, '⤢', h('span', null, 'Expandir')));
        if (reabrir && card.querySelector('.card-title')?.textContent === reabrir) requestAnimationFrame(() => expandir(card));
      }
    }
  }

  // ---------- impressão de um cartão (tabela e/ou gráfico) ----------
  // Copia o cartão (com todas as linhas da tabela), troca os gráficos por imagem e escolhe a folha:
  // em pé quando a tabela cabe na largura de um A4 em pé; deitada quando é larga ou tem gráfico.
  // A tabela encolhe para caber na largura (nunca corta coluna); linhas, gráficos e cartões não se partem entre páginas,
  // e o cabeçalho da tabela se repete em cada página.
  const LARG = { portrait: 718, landscape: 1047 }; // A4 menos 10 mm de margem de cada lado, em px (96 dpi)
  TS.imprimir = function (card) {
    document.getElementById('area-impressao')?.remove();
    document.getElementById('pagina-impressao')?.remove();
    const wraps = [...card.querySelectorAll('.table-wrap')];
    wraps.forEach((t) => t._tudo && t._tudo(true));
    const copia = card.cloneNode(true);
    wraps.forEach((t) => t._tudo && t._tudo(false));
    // gráficos viram imagem (o canvas copiado vem em branco)
    const orig = card.querySelectorAll('canvas'), cop = copia.querySelectorAll('canvas');
    orig.forEach((c, k) => {
      let src = '';
      try { src = c.toDataURL('image/png'); } catch { /* ok */ }
      const img = h('img', { class: 'prt-graf', src, alt: c.getAttribute('aria-label') || 'Gráfico' });
      if (c.width && c.height) img.style.aspectRatio = `${c.width} / ${c.height}`;
      cop[k] && cop[k].replaceWith(img);
    });
    // o que é de tela sai; campos viram texto
    copia.querySelectorAll('details').forEach((d) => { if (d.querySelector(':scope > summary.btn')) d.remove(); else d.open = true; }); // menus (Limpar ▾) saem
    copia.querySelectorAll('.col-sec').forEach((el) => el.remove()); // só as colunas principais
    copia.querySelectorAll('.exp-btn, .exp-fechar, .dica-i, .pager, input[type=search], .seg button:not(.on), .ped-ab, button.chip, button.btn, .est-cl-sel').forEach((el) => el.remove());
    copia.querySelectorAll('select').forEach((el) => el.replaceWith(h('span', { class: 'prt-campo' }, el.selectedOptions[0] ? el.selectedOptions[0].textContent : '')));
    copia.querySelectorAll('input').forEach((el) => {
      if (el.type === 'checkbox' || el.type === 'radio') el.replaceWith(el.checked ? '☑ ' : '☐ ');
      else el.replaceWith(h('span', { class: 'prt-campo' }, el.value));
    });
    copia.classList.remove('card-cheio');
    // cabeçalho: tela, loja, período e quando foi impresso
    const f = TS.state.f;
    const lojaSel = document.getElementById('lojaSel');
    const loja = lojaSel && lojaSel.selectedOptions[0] ? lojaSel.selectedOptions[0].textContent : '';
    const per = f.de != null || f.ate != null ? `${f.de != null ? fmt.date(TS.dayToIso(f.de)) : 'início'} a ${f.ate != null ? fmt.date(TS.dayToIso(f.ate)) : 'hoje'}` : 'todo o histórico';
    const tela = document.querySelector('.page-title')?.textContent || '';
    const area = h('div', { id: 'area-impressao' },
      h('div', { class: 'prt-cab' }, h('b', null, ['Tea Shop', loja, tela].filter(Boolean).join(' · ')),
        h('span', null, `Período: ${per} · impresso em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`)),
      copia);
    document.body.append(area);
    // mede a largura natural das tabelas para escolher a folha e o quanto encolher
    area.classList.add('prt-medindo');
    const tabs = [...copia.querySelectorAll('table')];
    const largs = tabs.map((t) => t.scrollWidth);
    const larg = Math.max(0, ...largs);
    area.classList.remove('prt-medindo');
    const orient = copia.querySelector('.prt-graf') || larg > LARG.portrait ? 'landscape' : 'portrait';
    const cabe = LARG[orient] - 4;
    tabs.forEach((t, k) => { const w = largs[k] || larg; if (w > cabe) t.style.zoom = String(Math.max(0.3, cabe / w)); });
    const pagina = h('style', { id: 'pagina-impressao' }, `@page { size: A4 ${orient}; margin: 10mm; }`);
    document.head.append(pagina);
    document.body.classList.add('imprimindo-cartao');
    const limpar = () => { document.body.classList.remove('imprimindo-cartao'); area.remove(); pagina.remove(); window.removeEventListener('afterprint', limpar); };
    window.addEventListener('afterprint', limpar);
    // espera as imagens dos gráficos antes de abrir a impressão
    Promise.all([...area.querySelectorAll('img')].map((im) => (im.complete ? 0 : new Promise((ok) => { im.onload = im.onerror = ok; }))))
      .then(() => setTimeout(() => { window.print(); setTimeout(() => { if (document.body.classList.contains('imprimindo-cartao') && !window.matchMedia('print').matches) limpar(); }, 1000); }, 50));
  };
  // telas que terminam de montar depois (estoque, alertas, cartões que buscam dados): o botão aparece quando a tabela chega
  let observador = null;
  function vigiar(root) {
    if (observador || typeof MutationObserver === 'undefined') return;
    let pendente = false;
    observador = new MutationObserver(() => {
      if (pendente) return;
      pendente = true;
      requestAnimationFrame(() => { pendente = false; adicionarBotoes(root, null); });
    });
    observador.observe(root, { childList: true, subtree: true });
  }

  // ---------- cartões ----------
  // ⓘ: explicação do cartão (passa o mouse ou toca); o texto vem do próprio cartão ou de TS.DICAS pelo título
  let balao = null;
  const fecharBalao = () => { if (balao) { balao.remove(); balao = null; } };
  const abrirBalao = (alvo, texto) => {
    fecharBalao();
    balao = h('div', { class: 'dica-balao', role: 'tooltip' }, texto);
    balao._alvo = alvo; balao._em = Date.now();
    document.body.append(balao);
    const r = alvo.getBoundingClientRect(), b = balao.getBoundingClientRect(), m = 8;
    let x = r.left + r.width / 2 - b.width / 2; x = Math.max(m, Math.min(x, window.innerWidth - b.width - m));
    let y = r.bottom + 6; if (y + b.height > window.innerHeight - m) y = Math.max(m, r.top - b.height - 6);
    balao.style.left = x + 'px'; balao.style.top = y + 'px';
  };
  document.addEventListener('scroll', fecharBalao, true);
  document.addEventListener('pointerdown', (e) => { if (balao && !e.target.closest('.dica-i')) fecharBalao(); });
  TS.dica = (texto) => {
    if (!texto) return null;
    const el = h('button', { type: 'button', class: 'dica-i', 'aria-label': 'O que é isto: ' + texto }, 'i');
    // passar o mouse abre; no toque (celular) só o clique abre e fecha
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') abrirBalao(el, texto); });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') fecharBalao(); });
    // no celular o toque também dispara o "mouseenter": o clique logo depois não pode fechar o balão
    el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (balao && balao._alvo === el && Date.now() - balao._em > 400) fecharBalao(); else if (!balao || balao._alvo !== el) abrirBalao(el, texto); });
    return el;
  };
  const tituloCom = (title, cls) => { const d = TS.dicaDe && typeof title === 'string' ? TS.dica(TS.dicaDe(title)) : null; return h('div', { class: cls }, title, d); };
  TS.card = (title, sub, ...body) => h('div', { class: 'card' },
    (title || sub) ? h('div', { class: 'card-head' }, h('div', null, tituloCom(title, 'card-title'), sub ? h('div', { class: 'card-sub' }, sub) : null)) : null,
    ...body);
  TS.cardWithTools = (title, sub, tools, ...body) => h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, tituloCom(title, 'card-title'), sub ? h('div', { class: 'card-sub' }, sub) : null), tools),
    ...body);
  // explicação do indicador: a que veio no código; se for curta (ex.: "Faturamento ÷ cupons"), a do dicionário, mais completa
  const dicaKpi = (label, title) => { const d = TS.dicaDe && TS.dicaDe(label); return title && (title.length >= 40 || !d) ? title : d || title; };
  // número grande (R$ 9.511.881,00; 3.870,220 kg) diminui a fonte para caber no cartão (pela largura do cartão e o tamanho do texto)
  TS.kpi = (label, value, foot, title) => {
    const v = h('div', { class: 'kpi-value' }, value);
    const n = (v.textContent || '').length;
    if (n > 9) v.style.setProperty('--n', n);
    return h('div', { class: 'card kpi' },
      h('div', { class: 'kpi-label' }, label, TS.dica(dicaKpi(label, title))), v, foot ? h('div', { class: 'kpi-foot' }, foot) : null);
  };
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
  TS.table = function ({ cols, rows, total, sortKey, sortDir = 'desc', maxHeight, pageSize, search, searchKeys, searchInit, onSearch, onRowClick, rowClass, empty, cls, imprimir, produto }) {
    // produto: colunas com o nome do produto — o filtro "Produto contém" da lateral também vale nesta tabela
    const fProd = produto && TS.state.f.produto ? TS.norm(TS.state.f.produto) : '';
    if (fProd) { const ks = [].concat(produto); rows = rows.filter((row) => ks.some((k) => TS.norm(row[k]).includes(fProd))); }
    // imprimir: as colunas principais (as outras saem na impressão)
    const sec = (c) => (imprimir && !imprimir.includes(c.key) ? ' col-sec' : '');
    // a busca digitada sobrevive quando a tela se redesenha (troca de aba/filtro); some ao trocar de tela
    const mem = TS._buscas && TS._buscas.tela === location.hash ? TS._buscas : (TS._buscas = { tela: location.hash, v: {} });
    const chaveBusca = search ? search + '|' + (searchKeys || []).join(',') : null;
    if (chaveBusca && searchInit == null && mem.v[chaveBusca]) searchInit = mem.v[chaveBusca];
    let sk = sortKey, sd = sortDir, page = 0, q = searchInit ? TS.norm(searchInit) : '';
    const wrap = h('div');
    const tbl = h('table', { class: 't' + (cls ? ' ' + cls : '') });
    const tw = h('div', { class: 'table-wrap' + (maxHeight === 'free' ? ' free' : '') }, tbl);
    if (maxHeight && maxHeight !== 'free') tw.style.maxHeight = maxHeight;
    const pager = h('div', { class: 'pager' });
    let searchBox = null;
    if (search) {
      searchBox = h('input', { class: 'f-input', type: 'search', placeholder: search, value: searchInit || '' });
      searchBox.addEventListener('input', TS.debounce(() => { q = TS.norm(searchBox.value); page = 0; if (TS._buscas && TS._buscas.tela === location.hash) TS._buscas.v[chaveBusca] = searchBox.value; if (onSearch) onSearch(searchBox.value); paint(); }, 200));
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
        const th = h('th', { class: [c.align === 'l' ? 'l' : '', c.sticky ? 'sticky-col' : '', sk === c.key ? 'sorted' : ''].join(' ') + sec(c), title: c.title || null, scope: 'col' },
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
        const tr = h('tr', { class: rowClass ? rowClass(row) || null : null });
        if (onRowClick) { tr.style.cursor = 'pointer'; tr.addEventListener('click', () => onRowClick(row)); }
        cols.forEach((c) => {
          const v = row[c.key];
          const extra = c.cls ? c.cls(row) : '';
          const content = c.render ? c.render(row) : (c.fmt ? c.fmt(v, row) : (v ?? ''));
          tr.append(h('td', { class: [c.align === 'l' ? 'l' : '', c.sticky ? 'sticky-col' : '', c.wrap ? 'wrap' : '', extra].join(' ') + sec(c) }, content));
        });
        tb.append(tr);
      }
      if (!slice.length) tb.append(h('tr', null, h('td', { colspan: cols.length, class: 'l muted' }, empty || 'Nada encontrado.')));
      tbl.append(tb);
      if (total) {
        const tf = h('tfoot'), tr = h('tr');
        cols.forEach((c, j) => {
          const v = total[c.key];
          tr.append(h('td', { class: [c.align === 'l' ? 'l' : '', c.sticky ? 'sticky-col' : ''].join(' ') + sec(c) }, j === 0 && v == null ? 'Total' : (v == null ? '' : (c.fmt ? c.fmt(v, total) : v))));
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
    // impressão: mostra todas as linhas (sem páginas) enquanto copia a tabela, depois volta
    let psGuardado = null;
    tw._tudo = (on) => {
      if (on) { if (!pageSize) return; psGuardado = pageSize; pageSize = 0; paint(); }
      else if (psGuardado) { pageSize = psGuardado; psGuardado = null; paint(); }
    };
    paint();
    if (fProd) wrap.append(h('div', { class: 'tab-fprod' }, `Só produtos com “${TS.state.f.produto}” (filtro Produto contém, na lateral) · `, h('button', { type: 'button', class: 'link-btn', onclick: () => { TS.state.f.produto = ''; document.querySelectorAll('.sidebar input[type=search]').forEach((i) => { if (i.placeholder === 'Ex.: earl grey') i.value = ''; }); TS.render(); } }, 'tirar o filtro')));
    // a busca aparece em cima da tabela; quem quiser pôr em outro lugar (barra de ferramentas do cartão) só move o campo
    if (searchBox) { searchBox.classList.add('tab-busca'); wrap.prepend(searchBox); }
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
            const area = chart.chartArea, w = ctx.measureText(txt).width;
            const barra = el.base != null && Number.isFinite(el.base);
            ctx.fillStyle = '#24302A';
            if (horiz) {
              ctx.textBaseline = 'middle';
              // não cabe à direita da barra: vai para dentro dela, em branco
              if (barra && el.x + 6 + w > area.right && Math.abs(el.x - el.base) > w + 10) { ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText(txt, el.x - 6, el.y); }
              else { ctx.textAlign = 'left'; ctx.fillText(txt, Math.min(el.x + 6, area.right - w), el.y); }
            } else {
              ctx.textAlign = 'center';
              // não cabe acima da barra (passa do topo do gráfico): vai para dentro dela, em branco
              if (barra && el.y - 4 - 13 < area.top && Math.abs(el.base - el.y) > 18) { ctx.textBaseline = 'top'; ctx.fillStyle = '#fff'; ctx.fillText(txt, el.x, el.y + 4); }
              else { ctx.textBaseline = 'bottom'; ctx.fillText(txt, el.x, Math.max(el.y - 4, area.top + 13)); }
            }
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

  /** linha tracejada de média (para pôr junto das séries de vendedores/lojas) */
  TS.dsMedia = (label, data, extra = {}) => ({ type: 'line', label, data, borderColor: '#6B6B6B', backgroundColor: '#6B6B6B', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointStyle: 'line', fill: false, tension: .3, spanGaps: true, order: -1, ...extra });
  /** média por posição entre várias séries (ignora vazios) */
  TS.mediaSeries = (series) => (series[0] || []).map((_, k) => { let s = 0, n = 0; for (const d of series) { const v = d[k]; if (v != null && !Number.isNaN(v)) { s += v; n++; } } return n ? s / n : null; });
  /** média dos pontos de uma série (para uma linha reta) */
  TS.mediaPontos = (d) => { const v = d.filter((x) => x != null && x !== 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  TS.axisBRL = { ticks: { callback: (v) => fmt.compact(v) }, grid: { color: '#EEE9DF' }, border: { display: false } };
  TS.axisNum = (f) => ({ ticks: { callback: (v) => f(v) }, grid: { color: '#EEE9DF' }, border: { display: false } });
  TS.axisCat = { grid: { display: false }, border: { display: false } };
  TS.color = (i) => PALETA[i % PALETA.length];
  TS.alpha = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
})();
