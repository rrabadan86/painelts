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
    const camada = h('div', { class: 'camada-cheia exp-camada', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo, onclick: (e) => { if (e.target === camada) fecharExpandido(false); } }, card);
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && expandido && !document.querySelector('.ms.open, .camada-cheia:not(.exp-camada), .prc-drawer-camada, .prc-popup-camada, .inv-camera')) fecharExpandido(false);
  });
  /** imagem do cartão com gráfico: título, loja e período, o(s) gráfico(s) e o rodapé; compartilha (celular) ou baixa (computador) */
  TS.compartilharGrafico = async function (card, btn) {
    const canv = [...card.querySelectorAll('.chart-box canvas')].filter((c) => c.closest('.card') === card && c.width && c.height);
    if (!canv.length) return;
    const titulo = (card.querySelector('.card-title')?.firstChild?.textContent || card.querySelector('.card-title')?.textContent || 'Gráfico').trim();
    const selLoja = document.querySelector('#lojaSel, .loja-sel select, header select');
    const loja = selLoja && selLoja.selectedOptions && selLoja.selectedOptions[0] ? selLoja.selectedOptions[0].textContent.trim() : '';
    const periodo = TS.periodoTexto ? TS.periodoTexto() : '';
    const W = 1080, pad = 48, esc = (c) => (W - pad * 2) / c.width;
    const alturas = canv.map((c) => Math.round(c.height * esc(c)));
    const H = pad + 64 + 40 + alturas.reduce((a, b) => a + b + 24, 0) + 56;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2C5234'; g.fillRect(0, 0, W, 10);
    g.fillStyle = '#1f2a22'; g.font = '700 40px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'; g.textBaseline = 'top';
    const corta = (t, max) => { let x = t; while (g.measureText(x).width > max && x.length > 4) x = x.slice(0, -2); return x === t ? t : x.trimEnd() + '…'; };
    g.fillText(corta(titulo, W - pad * 2), pad, pad);
    g.fillStyle = '#6b6b6b'; g.font = '400 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText(corta([loja, periodo].filter(Boolean).join(' · '), W - pad * 2), pad, pad + 56);
    let y = pad + 64 + 40;
    canv.forEach((c, i) => { g.drawImage(c, pad, y, W - pad * 2, alturas[i]); y += alturas[i] + 24; });
    g.fillStyle = '#9a9a9a'; g.font = '400 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText(`Tea Shop · painel de vendas · ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`, pad, H - 44);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    if (!blob) return;
    const nome = (titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'grafico') + '.png';
    const arq = new File([blob], nome, { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [arq] })) { await navigator.share({ files: [arq], title: titulo }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    // sem compartilhar (computador): baixa a imagem
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    if (btn) { const sp = btn.querySelector('span'); if (sp) { const t = sp.textContent; sp.textContent = 'Imagem baixada'; setTimeout(() => { sp.textContent = t; }, 2500); } }
  };

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
      // cartão de seção (TS.cardSec): os botões vão para a direita do próprio cabeçalho, junto do título
      const sec = card.querySelector(':scope > .card-sec-head');
      const cab = sec ? ':scope > .card-sec-head' : ':scope > .card-head';
      const temExp = !!card.querySelector(cab + ' .exp-btn:not(.prt-btn):not(.shr-btn)'), temPrt = !!card.querySelector(cab + ' .prt-btn') || card.classList.contains('sem-imprimir'); // sem-imprimir: lista privada (Conversas)
      const temShr = !!card.querySelector(cab + ' .shr-btn');
      if ((temExp || !temTab) && temPrt && (temShr || !temGraf)) continue;
      let head = sec ? (sec.querySelector(':scope > .card-sec-dir') || sec.appendChild(h('div', { class: 'card-sec-dir' }))) : card.querySelector(':scope > .card-head');
      if (!head) { head = h('div', { class: 'card-head' }, h('div')); card.prepend(head); }
      // gráfico: compartilhar a imagem (no celular abre o menu do sistema, com o WhatsApp)
      if (temGraf && !temShr) head.append(h('button', { type: 'button', class: 'exp-btn shr-btn', title: 'Compartilhar a imagem do gráfico (WhatsApp, e-mail…)', 'aria-label': 'Compartilhar imagem', onclick: (e) => TS.compartilharGrafico(card, e.currentTarget) }, '📤', h('span', null, 'Compartilhar')));
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
    balao = h('div', { class: 'dica-balao' + (String(texto).length > 320 ? ' dica-longa' : ''), role: 'tooltip' }, texto);
    balao._alvo = alvo; balao._em = Date.now();
    document.body.append(balao);
    const r = alvo.getBoundingClientRect(), b = balao.getBoundingClientRect(), m = 8;
    let x = r.left + r.width / 2 - b.width / 2; x = Math.max(m, Math.min(x, window.innerWidth - b.width - m));
    let y = r.bottom + 6; if (y + b.height > window.innerHeight - m) y = Math.max(m, r.top - b.height - 6);
    if (y + b.height > window.innerHeight - m) y = Math.max(m, window.innerHeight - b.height - m); // texto longo: encosta na borda em vez de sair da tela
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
  // texto de apoio do cartão: com mais de ~140 caracteres fica só a primeira frase; o resto vai para "Como ler ▸" (continua na página)
  const SUB_MAX = 140;
  const subCurto = (sub) => {
    if (typeof sub !== 'string' || sub.length <= SUB_MAX) return sub;
    // fim da primeira frase: ponto final seguido de espaço e maiúscula (não corta "R$ 1.234" nem "vs. 30 dias"), fora de parênteses
    let corte = -1, par = 0;
    for (let i = 0; i < sub.length - 2; i++) {
      const c = sub[i];
      if (c === '(') par++; else if (c === ')') par = Math.max(0, par - 1);
      else if (c === '.' && !par && i >= 30 && sub[i + 1] === ' ' && /[A-ZÀ-Ý"“]/.test(sub[i + 2]) && !/\b(vs|ex|obs|nº|n)$/i.test(sub.slice(Math.max(0, i - 3), i))) { corte = i + 1; break; }
    }
    if (corte < 0 || sub.length - corte < 30) return sub;
    return [sub.slice(0, corte), ' ', h('details', { class: 'est-como card-como' }, h('summary', null, 'Como ler ▸'), h('p', null, sub.slice(corte + 1)))];
  };
  const subDe = (sub) => (sub ? h('div', { class: 'card-sub' }, subCurto(sub)) : null);
  TS.card = (title, sub, ...body) => h('div', { class: 'card' },
    (title || sub) ? h('div', { class: 'card-head' }, h('div', null, tituloCom(title, 'card-title'), subDe(sub))) : null,
    ...body);
  TS.cardWithTools = (title, sub, tools, ...body) => h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, tituloCom(title, 'card-title'), subDe(sub)), tools),
    ...body);
  // explicação do indicador: a que veio no código; se for curta (ex.: "Faturamento ÷ cupons"), a do dicionário, mais completa
  const dicaKpi = (label, title) => { const d = TS.dicaDe && TS.dicaDe(label); return title && (title.length >= 40 || !d) ? title : d || title; };
  // número grande (R$ 9.511.881,00; 3.870,220 kg) diminui a fonte para caber no cartão (pela largura do cartão e o tamanho do texto)
  // estado: 'bom' | 'ruim' | null (neutro). Sem estado explícito, vale o primeiro sinal de bom/ruim do rodapé (a comparação principal) e, na falta, o do valor.
  const KPI_BOM = ['up', 'pos'], KPI_RUIM = ['down', 'neg'];
  const sinalDe = (el) => {
    if (!el) return null;
    for (const x of [el, ...el.querySelectorAll('.up, .pos, .down, .neg')]) {
      if (KPI_RUIM.some((c) => x.classList.contains(c))) return 'ruim';
      if (KPI_BOM.some((c) => x.classList.contains(c))) return 'bom';
    }
    return null;
  };
  /** marca o estado do quadro (kpi-bom / kpi-ruim; sem barra lateral desde 22/11/2026 — a cor está no texto da comparação). Chame de novo quando o rodapé mudar depois de montado. */
  TS.kpiEstado = (el, estado) => {
    if (!el) return el;
    const e = estado !== undefined ? estado : sinalDe(el.querySelector('.kpi-foot')) || sinalDe(el.querySelector('.kpi-value'));
    el.classList.toggle('kpi-bom', e === 'bom'); el.classList.toggle('kpi-ruim', e === 'ruim');
    return el;
  };
  TS.kpi = (label, value, foot, title, estado) => {
    const v = h('div', { class: 'kpi-value' }, value);
    const n = (v.textContent || '').length;
    if (n > 9) v.style.setProperty('--n', n);
    return TS.kpiEstado(h('div', { class: 'card kpi' },
      h('div', { class: 'kpi-label' }, label, TS.dica(dicaKpi(label, title))), v, foot ? h('div', { class: 'kpi-foot' }, foot) : null), estado);
  };
  TS.deltaSpan = (v) => h('span', { class: v > 0 ? 'up' : v < 0 ? 'down' : '' }, fmt.delta(v));
  TS.section = (t) => h('div', { class: 'section-label' }, t);
  TS.empty = (t = 'Sem dados para os filtros escolhidos.') => h('div', { class: 'empty' }, t);

  // ---------- peças do redesenho (decisão do dono, 22/11/2026: o visual limpo do protótipo do Início vale para o painel todo) ----------
  // Regras em .claude/rules/visual.md. Nenhuma cor aqui: estado e nível só por classe (styles.css).
  /** liga Enter e Espaço a um elemento que não é botão nem link (os botões e links de verdade já respondem sozinhos) */
  const teclado = (el, fn) => { el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); } }); return el; };
  /** ação: { rotulo, href } vira link; { rotulo, onclick } vira botão */
  const acaoEl = (a, cls) => (a.href
    ? h('a', { class: cls, href: a.href, onclick: a.onclick || null }, a.rotulo)
    : h('button', { type: 'button', class: cls, onclick: a.onclick || null }, a.rotulo));

  /**
   * Cartão-herói: a resposta de "como está" da tela, em 2–3 colunas separadas por uma linha vertical (no celular a primeira em cima).
   * coluna = { rot, num, sub?, linhas?: [texto|elemento], estado?: 'bom'|'ruim', dica?, barra?: { pct, esperado?, rotulo } }
   */
  TS.heroi = (colunas, opts = {}) => {
    const col = (c, i) => {
      const linhas = (c.linhas || []).filter((x) => x != null && x !== '' && x !== false);
      const barra = c.barra && Number.isFinite(c.barra.pct) ? h('div', { class: 'heroi-barra', role: 'img', 'aria-label': c.barra.rotulo || `${Math.round(c.barra.pct)}%` },
        h('span', { class: 'heroi-barra-ok', style: { width: `${Math.max(0, Math.min(100, c.barra.pct))}%` } }),
        Number.isFinite(c.barra.esperado) ? h('span', { class: 'heroi-barra-marca', style: { left: `${Math.max(0, Math.min(100, c.barra.esperado))}%` } }) : null) : null;
      return h('div', { class: 'heroi-col' + (i === 0 ? ' heroi-pri' : '') },
        h('div', { class: 'heroi-rot' }, h('span', null, c.rot), TS.dica(c.dica)),
        h('div', { class: 'heroi-num' + (c.estado === 'bom' ? ' pos' : c.estado === 'ruim' ? ' neg' : '') }, c.num, c.sub ? h('span', { class: 'heroi-sub' }, ' ', c.sub) : null),
        barra,
        // linha: texto, elemento ou { el, cls } (cls = 'pos' | 'neg' para a comparação em cor de texto)
        ...linhas.map((l) => (l && typeof l === 'object' && !(l instanceof Node) && 'el' in l ? h('div', { class: 'heroi-linha' + (l.cls ? ' ' + l.cls : '') }, l.el) : h('div', { class: 'heroi-linha' }, l))));
    };
    const cols = (colunas || []).filter(Boolean);
    return h('section', { class: 'card heroi heroi-n' + cols.length, 'aria-label': opts.titulo || null },
      opts.titulo ? h('h2', { class: 'heroi-titulo' }, opts.titulo) : null,
      h('div', { class: 'heroi-cols' }, ...cols.map(col)),
      opts.extra || null);
  };

  /** ações numeradas ("O que fazer agora"): [{ titulo, texto, acao: { rotulo, href? | onclick? }, principal? }]; sem `principal` em nenhuma, a 1ª é a principal */
  TS.acoesNum = (itens) => {
    const lista = (itens || []).filter(Boolean);
    const temPri = lista.some((x) => x.principal);
    return h('ol', { class: 'acoes-num' }, ...lista.map((x, i) => {
      const pri = temPri ? !!x.principal : i === 0;
      return h('li', { class: 'acao' + (pri ? ' acao-pri' : ''), 'data-acao': x.tipo || null },
        h('span', { class: 'acao-n', 'aria-hidden': 'true' }, String(i + 1)),
        h('div', { class: 'acao-txt' }, h('strong', null, x.titulo), x.texto ? h('span', { class: 'muted' }, x.texto) : null),
        x.acao ? acaoEl(x.acao, 'btn acao-btn' + (pri ? ' primary' : ' contorno')) : null);
    }));
  };

  /** etiqueta de prazo/estado em texto: 'agora' | 'semana' | 'saber' | 'ok' */
  const PRAZO = { agora: 'Agora', semana: 'Esta semana', saber: 'Para saber', ok: 'Ok' };
  const NIVEL = { erro: 'agora', warn: 'semana', aviso: 'semana', info: 'saber' }; // o nível dos avisos (erro/warn/info) vira o prazo
  TS.etqPrazo = (nivel, texto) => { const n = NIVEL[nivel] || nivel; return h('span', { class: 'etq-prazo ' + (PRAZO[n] ? n : 'saber') }, texto || PRAZO[n] || PRAZO.saber); };

  /** linhas "rótulo …… número" com divisória, clicáveis quando têm href/onclick: [{ rot, num, estado?, href? | onclick?, dica? }] */
  TS.linhasNum = (itens) => h('ul', { class: 'linhas-num' }, ...(itens || []).filter(Boolean).map((x) => {
    const num = h('strong', { class: 'linhas-num-v' + (x.estado === 'bom' ? ' pos' : x.estado === 'ruim' ? ' neg' : x.estado === 'atencao' ? ' warn-t' : '') }, x.num);
    const rot = h('span', { class: 'linhas-num-r' }, x.rot, TS.dica(x.dica));
    const corpo = x.href ? h('a', { class: 'linhas-num-a', href: x.href, onclick: x.onclick || null }, rot, num)
      : x.onclick ? h('button', { type: 'button', class: 'linhas-num-a', onclick: x.onclick }, rot, num)
        : h('div', { class: 'linhas-num-a' }, rot, num);
    return h('li', null, corpo);
  }));

  /** pílula de situação (ex.: "Vendas atualizadas hoje às 14:32"): 'ok' | 'warn' | 'err' */
  // com `ir` (função) vira botão: a pílula amarela/vermelha leva ao que explica o problema (ex.: os avisos de dados do Início)
  TS.pilulaSit = (nivel, texto, ir, dica) => {
    const cls = 'pilula-sit ' + (['ok', 'warn', 'err'].includes(nivel) ? nivel : 'ok');
    const bola = h('span', { class: 'pilula-sit-b', 'aria-hidden': 'true' });
    if (typeof ir !== 'function') return h('p', { class: cls }, bola, texto);
    return h('button', { type: 'button', class: cls + ' pilula-sit-btn', title: dica || null, onclick: (e) => { e.preventDefault(); ir(); } }, bola, texto, h('span', { class: 'pilula-sit-ir', 'aria-hidden': 'true' }, ' ›'));
  };

  /** tela em duas colunas no computador (principal 1.7fr / lateral 1fr); no celular empilha, a lateral depois */
  TS.duasColunas = (principal, lateral) => h('div', { class: 'tela-2col' },
    h('div', { class: 'tela-2col-pri' }, ...[].concat(principal || []).filter(Boolean)),
    h('aside', { class: 'tela-2col-lat' }, ...[].concat(lateral || []).filter(Boolean)));

  /** cartão de seção: título h2 + frase curta ou link "Ver todos ›" à direita (+ ferramentas) e o conteúdo */
  TS.cardSec = (titulo, opts = {}, ...conteudo) => {
    const dir = [opts.sub ? h('span', { class: 'card-sec-sub' }, opts.sub) : null,
      opts.link ? (opts.link instanceof Node ? opts.link : acaoEl(opts.link, 'card-sec-link')) : null, opts.ferramentas || null].filter(Boolean);
    return h('section', { class: 'card card-sec' },
      h('div', { class: 'card-sec-head' }, h('h2', { class: 'card-sec-titulo' }, titulo, TS.dica(opts.dica)), dir.length ? h('div', { class: 'card-sec-dir' }, ...dir) : null),
      ...conteudo.filter((x) => x != null && x !== false));
  };
  TS.teclado = teclado;

  /**
   * Faixa que rola para o lado (abas, submenu) e é refeita a cada clique: sem isto ela voltava para o começo e a opção
   * escolhida (a última, por exemplo) sumia da vista. Rola só a faixa, o mínimo para a opção marcada aparecer inteira.
   */
  TS.ativoVisivel = function (el, sel) {
    const ajustar = () => {
      if (!el.isConnected || el.scrollWidth <= el.clientWidth + 1) return el.isConnected;
      const a = el.querySelector(sel || ':scope > .on');
      if (!a) return true;
      const r = a.getBoundingClientRect(), c = el.getBoundingClientRect(), m = 12;
      if (r.left < c.left + m) el.scrollLeft -= c.left + m - r.left;
      else if (r.right > c.right - m) el.scrollLeft += r.right - (c.right - m);
      return true;
    };
    // a faixa é criada antes de entrar na página: ajusta no próximo quadro (e de novo logo depois, se ainda não tinha entrado)
    const quadro = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 0);
    quadro(() => { if (!ajustar()) setTimeout(ajustar, 80); });
    return TS.sinalRolagem(el);
  };
  /**
   * faixa que rola para o lado (abas, submenu, menu do topo): a borda que tem mais opções escondidas fica esmaecida
   * (classes rola-esq / rola-dir); abas que quebram em duas linhas ou mais ganham seg-quebra (canto menor, sem virar bolha)
   */
  TS.sinalRolagem = function (el) {
    if (!el || el._sinal) return el;
    el._sinal = true;
    const marcar = () => {
      if (!el.isConnected) return;
      const sobra = el.scrollWidth - el.clientWidth;
      el.classList.toggle('rola-esq', sobra > 2 && el.scrollLeft > 2);
      el.classList.toggle('rola-dir', sobra > 2 && el.scrollLeft < sobra - 2);
      if (el.classList.contains('seg')) {
        const bs = el.querySelectorAll(':scope > button');
        el.classList.toggle('seg-quebra', bs.length > 1 && bs[bs.length - 1].offsetTop > bs[0].offsetTop + 4);
      }
    };
    el.addEventListener('scroll', marcar, { passive: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(marcar).observe(el);
    const quadro = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 0);
    quadro(() => { marcar(); setTimeout(marcar, 120); });
    return el;
  };
  TS.seg = function (items, current, onPick) {
    const el = h('div', { class: 'seg', role: 'group' });
    for (const [lab, val, dica] of items) { // dica (opcional): explicação da opção, aparece ao passar o mouse / tocar e segurar
      // o seletor marca sozinho a opção clicada: quem redesenha só a tabela (sem refazer o seletor) não fica com a aba errada marcada
      el.append(h('button', { type: 'button', class: val === current ? 'on' : '', 'aria-pressed': val === current ? 'true' : 'false', 'data-val': String(val), title: dica || null,
        onclick: (e) => { TS.segMarcar(el, e.currentTarget); onPick(val); } }, lab));
    }
    return TS.ativoVisivel(el);
  };
  /** seletor com muitas opções (FOLHA-01): no computador é o TS.seg de sempre; no celular, um botão com o rótulo e a opção
   *  escolhida que abre a folha (o "(N)" do fim do rótulo vira a contagem e a dica, a explicação da opção) */
  TS.segFolha = function (items, current, onPick, rotulo = 'Mostrar') {
    if (!TS.ehCelular()) return TS.seg(items, current, onPick);
    const partes = (lab) => { const m = String(lab).match(/^(.*?)\s*\(([\d.]+)\)$/); return m ? [m[1], +m[2].replace(/\./g, '')] : [lab, null]; };
    let atual = current;
    const nomeDe = (v) => { const it = items.find(([, x]) => x === v); return it ? String(it[0]) : ''; };
    const el = TS.botaoFolha({ rotulo, valor: nomeDe(atual), ativo: false, cls: 'seg-folha', onclick: () => TS.folha({ titulo: rotulo, valor: atual,
      opcoes: items.map(([lab, v, dica]) => { const [nome, n] = partes(lab); return { v, nome, n, dica }; }),
      onEscolher: (v) => { el._marcar(v); onPick(v); } }) });
    el._marcar = (v) => { atual = v; el.querySelector('b').textContent = nomeDe(v); };
    return el;
  };
  /** marca uma opção do seletor (pelo botão ou pelo valor): use quando outra coisa (um quadro clicável) muda a aba */
  TS.segMarcar = function (el, alvo) {
    if (el && el._marcar) { el._marcar(typeof alvo === 'object' ? alvo.dataset.val : alvo); return; }
    for (const b of el.querySelectorAll(':scope > button')) { const on = typeof alvo === 'object' ? b === alvo : b.dataset.val === String(alvo); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  };

  // ---------- tabela ordenável ----------
  /**
   * cols: [{key, label, fmt, align:'l'|'r', cls:(row)=>string, sticky, title}]
   * rows: objetos; total: objeto opcional; sort: {key, dir}
   */
  /** tela de celular (até 760 px): algumas telas mudam o jeito de mostrar; o computador não muda */
  TS.ehCelular = () => window.matchMedia('(max-width: 760px)').matches;

  // ---------- Celular: filtro num botão que abre uma folha de opções; downloads num menu ⤓ ----------
  // Padrão aprovado pelo dono em 24/11/2026 (Lista de clientes, FOLHA-01): no lugar de uma faixa de etiquetas,
  // um botão com o nome do filtro e o que está escolhido; tocar abre a folha que sobe de baixo, com a quantidade
  // e a explicação de cada opção. Tocar numa opção já aplica e fecha. O "voltar" do celular fecha a folha (main.js).
  /** opcoes: [{ v, nome, dica?, n? }] — n é quantos itens a opção mostra (opcional) */
  TS.folha = function ({ titulo, sub, opcoes, valor, onEscolher }) {
    const fundo = h('div', { class: 'cp-modal-bg folha-bg' });
    const fechar = () => fundo.remove();
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
    const ops = h('div', { class: 'folha-ops', role: 'radiogroup', 'aria-label': titulo }, opcoes.map((o) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(o.v === valor), class: 'folha-op' + (o.v === valor ? ' on' : ''), 'data-v': o.v,
      onclick: () => { fechar(); onEscolher(o.v); },
    }, h('span', { class: 'folha-r', 'aria-hidden': 'true' }), h('span', { class: 'folha-t' }, h('b', null, o.nome), o.dica ? h('small', null, o.dica) : null),
    o.n != null ? h('span', { class: 'folha-n' }, fmt.int(o.n)) : null)));
    fundo.append(h('div', { class: 'folha', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
      h('div', { class: 'folha-puxa', 'aria-hidden': 'true' }),
      h('div', { class: 'folha-cab' }, h('h3', null, titulo), h('button', { type: 'button', class: 'folha-x', 'aria-label': 'Fechar', onclick: fechar }, '✕')),
      sub ? h('div', { class: 'folha-sub' }, sub) : null, ops));
    document.body.append(fundo);
    const foco = ops.querySelector('.on') || ops.firstChild;
    if (foco) foco.focus({ preventScroll: true });
    return fundo;
  };
  /** botão do filtro: rótulo pequeno em cima, o que está escolhido embaixo (borda dourada quando filtra) */
  TS.botaoFolha = ({ rotulo, valor, ativo, onclick, cls }) => h('button', { type: 'button', class: 'fbot' + (ativo ? ' on' : '') + (cls ? ' ' + cls : ''), onclick },
    h('span', { class: 'fbot-r' }, rotulo), h('b', null, valor), h('span', { class: 'fbot-v', 'aria-hidden': 'true' }, '▾'));
  /** ícone ⤓ com o menu de downloads; itens: [{ nome, dica?, fazer }] */
  TS.menuBaixar = function (itens, titulo = 'Baixar') {
    const caixa = h('div', { class: 'mbx' });
    const menu = h('div', { class: 'mbx-menu', role: 'menu', hidden: true });
    const fora = (e) => { if (!caixa.contains(e.target)) fechar(); };
    const fechar = () => { menu.hidden = true; bt.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', fora, true); };
    const bt = h('button', { type: 'button', class: 'mbx-bt', title: titulo, 'aria-label': titulo, 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => {
      if (!menu.hidden) { fechar(); return; }
      menu.hidden = false; bt.setAttribute('aria-expanded', 'true'); document.addEventListener('click', fora, true);
    } }, '⤓');
    for (const it of itens) menu.append(h('button', { type: 'button', role: 'menuitem', class: 'mbx-it', onclick: () => { fechar(); it.fazer(); } }, it.nome, it.dica ? h('small', null, it.dica) : null));
    caixa.append(bt, menu);
    return caixa;
  };

  /** linha do celular a partir das colunas da tabela (LMOB-04): nome e o número que decide em cima; as outras colunas pequenas
   *  embaixo, cada uma com o rótulo curto (labelMob ou o rótulo da coluna); célula vazia ou "—" some */
  TS.linhaCols = function (cols, { nome, val, valRot, l2 = [], l3 = [] }) {
    const col = (k) => cols.find((c) => c.key === k);
    const rot = (c) => (c.labelMob != null ? c.labelMob : typeof c.label === 'string' ? c.label : '');
    const vazio = (x) => x == null || x === '' || x === '—' || (x instanceof Node && !x.textContent.trim());
    const cel = (c, row) => (c.render ? c.render(row) : c.fmt ? c.fmt(row[c.key], row) : (row[c.key] ?? ''));
    // ⓘ (explicação da coluna) só na primeira linha da página: cada informação continua explicada sem repetir o ⓘ em todas as linhas
    const dicaDe = (c, k) => (k === 0 && c.title ? TS.dica(c.title) : null);
    const pedacos = (ks, row, k) => ks.map(col).filter(Boolean).map((c) => { const x = cel(c, row); return vazio(x) ? null : h('span', { class: 'lmob-c' }, rot(c) ? h('small', { class: 'lmob-rot' }, rot(c), dicaDe(c, k), ' ') : null, x); }).filter(Boolean);
    return (row, k) => {
      const cN = col(nome), cV = val && col(val);
      const v = cV ? cel(cV, row) : null;
      const p2 = pedacos(l2, row, k), p3 = pedacos(l3, row, k);
      return h('div', null,
        h('div', { class: 'lmob-l1' }, h('span', { class: 'lmob-nome' }, cN ? cel(cN, row) : ''),
          cV && !vazio(v) ? h('span', { class: 'lmob-val' }, valRot ? h('small', { class: 'lmob-rot' }, valRot, dicaDe(cV, k), ' ') : null, v) : null),
        p2.length ? h('div', { class: 'lmob-l2' }, p2) : null,
        p3.length ? h('div', { class: 'lmob-l2' }, p3) : null);
    };
  };

  TS.table = function ({ cols, rows, total, sortKey, sortDir = 'desc', maxHeight, pageSize, search, searchKeys, searchInit, onSearch, onRowClick, rowClass, empty, cls, imprimir, produto, cartao, estado, linhaMob, totalMob }) {
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
    // estado: objeto de quem chama ({ page, sk, sd }) para a página e a ordem sobreviverem quando a tela se redesenha (ex.: Pedido ao mudar uma quantidade)
    if (estado) { if (estado.sk && cols.some((c) => c.key === estado.sk)) { sk = estado.sk; sd = estado.sd || sd; } page = estado.page > 0 ? estado.page : 0; }
    // celular: tabela com 5 colunas ou mais vira cartões (cada linha um cartão, "rótulo: valor"); só no celular
    const MOB = TS.ehCelular() && (cols.length >= 5 || cartao === true);
    // páginas: montar centenas de linhas de uma vez travava a troca de tela (o navegador calcula o layout de todas).
    // Celular: cartões são altos, sempre em páginas de 40. Computador: tabela grande em páginas de 100.
    // A busca e a ordenação valem para todas as linhas; a impressão mostra tudo (tw._tudo).
    if (MOB && rows.length > 60) pageSize = Math.min(pageSize || 40, 40);
    else if (!MOB && !pageSize && rows.length > 150) pageSize = 100;
    const rotulo = (c) => (typeof c.label === 'string' ? c.label : '');
    const wrap = h('div', { class: MOB ? 'tab-mob-w' : null });
    const tbl = h('table', { class: 't' + (cls ? ' ' + cls : '') + (MOB ? ' t-mob' : '') });
    // linhaMob (padrão de listas no celular, aprovado pelo dono em 24/11/2026; LMOB-01): no celular, cada linha vira uma linha
    // com divisória (nome + o número que decide em cima, o resto pequeno embaixo) desenhada por quem chama, no lugar do cartão
    // de "rótulo: valor". A busca, a ordem ("Ordenar por") e as páginas continuam as mesmas. No computador nada muda.
    // linhaMob também pode ser { nome, val, l2: [chaves], l3: [chaves] } (LMOB-04): a linha é montada com as próprias colunas
    // (o mesmo render/fmt do computador, então o nome continua clicável e com o grupo embaixo)
    if (linhaMob && typeof linhaMob === 'object') linhaMob = TS.linhaCols(cols, linhaMob);
    const LMOB = TS.ehCelular() && typeof linhaMob === 'function';
    const lista = LMOB ? h('div', { class: 'lmob' + (cls ? ' ' + cls + '-lmob' : '') }) : null;
    const tw = h('div', { class: 'table-wrap' + (maxHeight === 'free' ? ' free' : '') + (LMOB ? ' lmob-w' : '') }, LMOB ? lista : tbl);
    if (maxHeight && maxHeight !== 'free') tw.style.maxHeight = maxHeight;
    const pager = h('div', { class: 'pager' });
    let searchBox = null;
    if (search) {
      searchBox = h('input', { class: 'f-input', type: 'search', placeholder: search, value: searchInit || '' });
      // o texto buscado é guardado na hora (só o redesenho espera): quem apaga a busca e troca logo de aba não
      // leva a busca antiga para a tabela nova ("Nada encontrado" na Validade → Alimentação)
      searchBox.addEventListener('input', () => { if (TS._buscas && TS._buscas.tela === location.hash) TS._buscas.v[chaveBusca] = searchBox.value; if (onSearch) onSearch(searchBox.value); });
      searchBox.addEventListener('input', TS.debounce(() => { q = TS.norm(searchBox.value); page = 0; paint(); }, 120));
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
    function paintLista() {
      lista.textContent = '';
      const all = sorted();
      if (pageSize && page > 0 && page * pageSize >= all.length) page = Math.max(0, Math.ceil(all.length / pageSize) - 1);
      if (estado) Object.assign(estado, { page, sk, sd });
      const start = pageSize ? page * pageSize : 0;
      const slice = pageSize ? all.slice(start, start + pageSize) : all;
      for (const [k, row] of slice.entries()) {
        const el = linhaMob(row, k);
        if (!el) continue;
        el.classList.add('lmob-it');
        if (rowClass && rowClass(row)) el.classList.add(...String(rowClass(row)).split(/\s+/).filter(Boolean));
        if (onRowClick) {
          el.tabIndex = 0; el.setAttribute('role', 'button'); el.style.cursor = 'pointer';
          el.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, select')) onRowClick(row); });
          el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); onRowClick(row); } });
        }
        lista.append(el);
      }
      if (!slice.length) lista.append(h('div', { class: 'muted t-vazio lmob-vazio' }, empty || 'Nada encontrado.'));
      if (total && totalMob) { const t = totalMob(total); if (t) { t.classList.add('lmob-total'); lista.append(t); } }
      pager.textContent = '';
      if (pageSize && all.length > pageSize) {
        const pages = Math.ceil(all.length / pageSize);
        pager.append(`${NF(start + 1)}–${NF(Math.min(start + pageSize, all.length))} de ${NF(all.length)}`,
          h('button', { class: 'btn', type: 'button', disabled: page === 0 || null, onclick: () => { page--; paint(); } }, '‹ Anterior'),
          h('button', { class: 'btn', type: 'button', disabled: page >= pages - 1 || null, onclick: () => { page++; paint(); } }, 'Próxima ›'));
      }
    }
    function paint() {
      if (LMOB) { paintLista(); return; }
      tbl.textContent = '';
      const thead = h('thead'), trh = h('tr');
      cols.forEach((c) => {
        // coluna com explicação (title): ⓘ tocável ao lado do nome (o balão funciona também no celular)
        const th = h('th', { class: [c.align === 'l' ? 'l' : '', c.sticky ? 'sticky-col' : '', sk === c.key ? 'sorted' : ''].join(' ') + sec(c), scope: 'col' },
          c.label, c.title && c.label ? TS.dica(c.title) : null, h('span', { class: 'arrow' }, sk === c.key ? (sd === 'asc' ? '▲' : '▼') : '↕'));
        th.addEventListener('click', () => { if (sk === c.key) sd = sd === 'asc' ? 'desc' : 'asc'; else { sk = c.key; sd = c.align === 'l' ? 'asc' : 'desc'; } paint(); });
        trh.append(th);
      });
      thead.append(trh); tbl.append(thead);
      const all = sorted();
      const tb = h('tbody');
      if (pageSize && page > 0 && page * pageSize >= all.length) page = Math.max(0, Math.ceil(all.length / pageSize) - 1); // a lista encolheu: fica na última página que existe
      if (estado) Object.assign(estado, { page, sk, sd });
      const start = pageSize ? page * pageSize : 0;
      const slice = pageSize ? all.slice(start, start + pageSize) : all;
      for (const row of slice) {
        const tr = h('tr', { class: rowClass ? rowClass(row) || null : null });
        if (onRowClick) {
          // a linha abre também pelo teclado (Enter ou Espaço), não só com o mouse ou o dedo
          tr.style.cursor = 'pointer'; tr.tabIndex = 0; tr.setAttribute('role', 'button');
          tr.addEventListener('click', () => onRowClick(row));
          tr.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === tr) { e.preventDefault(); onRowClick(row); } });
        }
        cols.forEach((c) => {
          const v = row[c.key];
          const extra = c.cls ? c.cls(row) : '';
          const content = c.render ? c.render(row) : (c.fmt ? c.fmt(v, row) : (v ?? ''));
          // celular: o rótulo do cartão vem do CSS (data-l); com explicação, vira um rótulo de verdade com o ⓘ
          const comDica = MOB && c.title && rotulo(c) && c !== cols[0];
          tr.append(h('td', { class: [c.align === 'l' ? 'l' : '', c.sticky ? 'sticky-col' : '', c.wrap ? 'wrap' : '', extra, comDica ? 'com-dica' : ''].join(' ') + sec(c) + (MOB && c === cols[0] ? ' mob-tit' : ''), 'data-l': MOB ? rotulo(c) : null },
            comDica ? h('span', { class: 'mob-rot' }, rotulo(c), TS.dica(c.title)) : null, content));
        });
        tb.append(tr);
      }
      if (!slice.length) tb.append(h('tr', null, h('td', { colspan: cols.length, class: 'l muted t-vazio' }, empty || 'Nada encontrado.')));
      tbl.append(tb);
      if (total) {
        const tf = h('tfoot'), tr = h('tr');
        cols.forEach((c, j) => {
          const v = total[c.key];
          tr.append(h('td', { class: [c.align === 'l' ? 'l' : '', c.sticky ? 'sticky-col' : ''].join(' ') + sec(c) + (MOB && j === 0 ? ' mob-tit' : ''), 'data-l': MOB && v != null && j ? rotulo(c) : null }, j === 0 && v == null ? 'Total' : (v == null ? '' : (c.fmt ? c.fmt(v, total) : v))));
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
    if (fProd) wrap.append(h('div', { class: 'tab-fprod' }, `Só produtos com “${TS.state.f.produto}” (filtro Produto contém) · `, h('button', { type: 'button', class: 'link-btn', onclick: () => { TS.state.f.produto = ''; document.querySelectorAll('.sidebar input[type=search]').forEach((i) => { if (i.placeholder === 'Ex.: earl grey') i.value = ''; }); TS.render(); } }, 'tirar o filtro')));
    // a busca aparece em cima da tabela; quem quiser pôr em outro lugar (barra de ferramentas do cartão) só move o campo
    if (searchBox) { searchBox.classList.add('tab-busca'); wrap.prepend(searchBox); }
    if (MOB) {
      // sem cabeçalho clicável no celular: "Ordenar por" no lugar
      const ordenaveis = cols.filter((c) => rotulo(c));
      const sel = h('select', { class: 'f-input tab-ord', 'aria-label': 'Ordenar por', onchange: () => { sk = sel.value; const c = cols.find((x) => x.key === sk); sd = c && c.align === 'l' ? 'asc' : 'desc'; dir.textContent = sd === 'asc' ? '↑' : '↓'; page = 0; paint(); } },
        ordenaveis.map((c) => h('option', { value: c.key, selected: c.key === sk || null }, 'Ordenar: ' + rotulo(c))));
      const dir = h('button', { type: 'button', class: 'btn tab-ord-d', 'aria-label': 'Inverter a ordem', onclick: () => { sd = sd === 'asc' ? 'desc' : 'asc'; dir.textContent = sd === 'asc' ? '↑' : '↓'; paint(); } }, sd === 'asc' ? '↑' : '↓');
      wrap.append(h('div', { class: 'tab-ord-w' }, sel, dir));
    }
    wrap.append(tw, pager);
    if (MOB) tw.style.maxHeight = ''; // no celular a página rola, não a tabela
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
        ctx.font = '12px "Segoe UI", sans-serif';
        // texto dentro da barra: escuro em barra clara (dourada, sálvia), branco em barra escura — contraste ≥ 4,5
        const dentro = (el) => {
          const c = String((el.options && el.options.backgroundColor) || '');
          const m = /^#([0-9a-f]{6})$/i.exec(c);
          if (!m) return '#fff';
          const l = [0, 2, 4].map((i) => { const v = parseInt(m[1].slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2] > 0.18 ? '#24302A' : '#fff';
        };
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
              if (barra && el.x + 6 + w > area.right && Math.abs(el.x - el.base) > w + 10) { ctx.textAlign = 'right'; ctx.fillStyle = dentro(el); ctx.fillText(txt, el.x - 6, el.y); }
              else { ctx.textAlign = 'left'; ctx.fillText(txt, Math.min(el.x + 6, area.right - w), el.y); }
            } else {
              ctx.textAlign = 'center';
              // não cabe acima da barra (passa do topo do gráfico): vai para dentro dela, em branco
              if (barra && el.y - 4 - 13 < area.top && Math.abs(el.base - el.y) > 18) { ctx.textBaseline = 'top'; ctx.fillStyle = dentro(el); ctx.fillText(txt, el.x, el.y + 4); }
              else { ctx.textBaseline = 'bottom'; ctx.fillText(txt, el.x, Math.max(el.y - 4, area.top + 13)); }
            }
          });
        });
        ctx.restore();
      },
    });
  }

  /** Cria um gráfico dentro de um contêiner com altura fixa */
  // séries escondidas pela legenda, por gráfico (tela + título do cartão), enquanto o painel estiver aberto
  const OCULTAS = new Map();
  const chaveLegenda = (box) => {
    const t = box.closest('.card') && box.closest('.card').querySelector('.card-title');
    if (!t) return null;
    const txt = (t.firstChild ? t.firstChild.textContent : t.textContent || '').trim().replace(/^(Dia a dia|Semana a semana|Mês a mês)\s+/, '');
    return txt ? (TS.state && TS.state.page || location.hash) + '|' + txt : null;
  };
  TS.chart = function (config, cls = '') {
    const box = h('div', { class: 'chart-box ' + cls });
    const canvas = h('canvas', { role: 'img', 'aria-label': config.ariaLabel || 'Gráfico' });
    box.append(canvas);
    const criar = () => {
      for (const ch of charts) { if (!ch.canvas || !ch.canvas.isConnected) { ch.destroy(); charts.delete(ch); } }
      if (!box.isConnected) return;
      // cartão ainda sem largura (painel voltando do segundo plano, tela montando): o Chart.js nasceria com o tamanho
      // mínimo e não se ajustava depois ("gráfico pequeno no canto e o resto em branco", print do dono de 23/11/2026).
      // Espera o cartão ter largura de verdade para desenhar.
      if (box.clientWidth < 60 && window.ResizeObserver && !box._esperaLarg) {
        box._esperaLarg = new ResizeObserver(() => { if (box.clientWidth >= 60) { box._esperaLarg.disconnect(); box._esperaLarg = null; criar(); } });
        box._esperaLarg.observe(box);
        return;
      }
      if (window.Chart && Chart.getChart) { const ant = Chart.getChart(canvas); if (ant) { ant.destroy(); charts.delete(ant); } }
      // legenda desmarcada continua desmarcada quando o gráfico é redesenhado (troca de indicador, filtro, período)
      const chave = config.legendaChave || chaveLegenda(box);
      const ocultas = chave ? (OCULTAS.get(chave) || new Set()) : null;
      if (ocultas && ocultas.size) for (const d of (config.data && config.data.datasets) || []) if (ocultas.has(d.label)) d.hidden = true;
      if (chave) {
        config.options = config.options || {};
        config.options.plugins = config.options.plugins || {};
        const lg = (config.options.plugins.legend = config.options.plugins.legend || {});
        const antes = lg.onClick || Chart.defaults.plugins.legend.onClick;
        lg.onClick = function (e, item, legend) {
          antes.call(this, e, item, legend);
          if (item.datasetIndex == null) return; // pizza: a legenda é de fatias, não de séries
          const ch = legend.chart, ds = ch.data.datasets[item.datasetIndex];
          if (!ds || !ds.label) return;
          const set = OCULTAS.get(chave) || new Set();
          if (ch.isDatasetVisible(item.datasetIndex)) set.delete(ds.label); else set.add(ds.label);
          OCULTAS.set(chave, set);
        };
      }
      const c = new Chart(canvas, config);
      charts.add(c);
    };
    requestAnimationFrame(criar);
    return box;
  };
  /** reajusta os gráficos ao tamanho do cartão (o painel voltou do segundo plano, girou o celular, a janela mudou) */
  // Print do dono (23/11/2026): às vezes o desenho ocupava só o canto do quadro (cerca de 1/2,4 da largura no celular) e o
  // resto ficava em branco — o jeito de um gráfico desenhado com a densidade de pixels errada (o celular muda a densidade
  // ao pôr o painel em segundo plano, ao girar ou ao mudar o zoom). Ao voltar, ao girar e quando a densidade muda, cada
  // gráfico refaz o tamanho e a densidade e se desenha de novo.
  TS.ajustarGraficos = () => {
    for (const ch of charts) {
      if (!ch.canvas || !ch.canvas.isConnected) { ch.destroy(); charts.delete(ch); continue; }
      if (!ch.canvas.offsetParent) continue; // escondido: ajusta quando aparecer
      const dpr = window.devicePixelRatio || 1;
      if (ch.currentDevicePixelRatio !== dpr || Math.abs(ch.width - ch.canvas.parentNode.clientWidth) > 2) { ch.resize(); ch.update('none'); }
    }
  };
  if (typeof document !== 'undefined' && document.addEventListener && window.matchMedia) {
    const aoMudar = () => requestAnimationFrame(TS.ajustarGraficos);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') aoMudar(); });
    window.addEventListener('pageshow', aoMudar);
    window.addEventListener('orientationchange', () => setTimeout(TS.ajustarGraficos, 300));
    // densidade de pixels mudou (zoom, tela externa, segundo plano no Android): a consulta é refeita a cada mudança
    const vigiarDensidade = () => {
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      const f = () => { mq.removeEventListener ? mq.removeEventListener('change', f) : mq.removeListener(f); aoMudar(); vigiarDensidade(); };
      mq.addEventListener ? mq.addEventListener('change', f) : mq.addListener(f);
    };
    vigiarDensidade();
  }

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
  /** consulta pública (BrasilAPI, pelo servidor): dados da empresa pelo CNPJ e endereço pelo CEP. Devolve null se não achou. */
  const consultaBR = async (rota) => {
    const r = await fetch(TS.api(rota), { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(j.erro || 'Falha na consulta.');
    return j;
  };
  TS.brasil = {
    /** 14 caracteres (números, ou letras e números no CNPJ novo) */
    pareceCnpj: (v) => /^[0-9A-Z]{12}\d{2}$/.test(String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '')),
    cnpj: async (v) => { const j = await consultaBR('brasil/cnpj/' + encodeURIComponent(String(v).toUpperCase().replace(/[^0-9A-Z]/g, ''))); return j && j.empresa; },
    cep: async (v) => { const j = await consultaBR('brasil/cep/' + String(v).replace(/\D/g, '')); return j && j.endereco; },
    enderecoTxt: (e) => (e ? [[e.rua, e.numero].filter(Boolean).join(', '), e.bairro, [e.cidade, e.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ') : ''),
  };

  // ---------- janelas de pergunta e de aviso (no lugar do prompt()/alert() do navegador) ----------
  /**
   * TS.perguntar('Por que perdemos?', { texto, chips: ['Preço', 'Prazo'], obrigatorio: true, rotulo, dica, ok: 'Salvar' })
   * devolve Promise: o texto digitado ('' quando é opcional e ficou vazio) ou null se a pessoa cancelou.
   * Os chips são atalhos: um toque preenche o campo (dá para completar escrevendo).
   */
  TS.perguntar = function (titulo, o = {}) {
    return new Promise((resolver) => {
      const fundo = h('div', { class: 'cp-modal-bg ts-aviso-bg' });
      let feito = false;
      const sair = (v) => { if (feito) return; feito = true; fundo.remove(); resolver(v); };
      const campo = h('input', { class: 'f-input', type: 'text', maxlength: o.max || 200, value: o.valor || '', placeholder: o.dica || '', 'aria-label': o.rotulo || titulo });
      const erro = h('small', { class: 'neg', role: 'alert', hidden: true });
      const chips = (o.chips || []).length ? h('div', { class: 'chips' }, o.chips.map((c) => h('button', { type: 'button', class: 'chip', onclick: (e) => {
        campo.value = c; erro.hidden = true;
        chips.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
        campo.focus();
      } }, c))) : null;
      const confirmar = () => {
        const v = campo.value.trim();
        if (o.obrigatorio && !v) { erro.textContent = o.falta || 'Escolha um motivo ou escreva no campo.'; erro.hidden = false; campo.focus(); return; }
        sair(v);
      };
      campo.addEventListener('input', () => { erro.hidden = true; if (chips) chips.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', b.textContent === campo.value.trim())); });
      campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } });
      fundo.addEventListener('click', (e) => { if (e.target === fundo) sair(null); });
      fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') sair(null); });
      fundo.append(h('div', { class: 'card cp-copiar ts-perg', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
        h('h3', null, titulo),
        o.texto ? h('div', { class: 'muted' }, o.texto) : null,
        chips,
        h('label', { class: 'ts-perg-campo' }, h('span', { class: 'f-label' }, o.rotulo || (o.obrigatorio ? 'Motivo' : 'Observação (opcional)')), campo),
        erro,
        h('div', { class: 'ts-perg-acoes' },
          h('button', { type: 'button', class: 'btn', onclick: () => sair(null) }, 'Cancelar'),
          h('button', { type: 'button', class: 'btn primary', onclick: confirmar }, o.ok || 'Confirmar'))));
      // fechada pelo "voltar" do celular (main.js tira a janela): conta como cancelar
      new MutationObserver((_, ob) => { if (!fundo.isConnected) { ob.disconnect(); if (!feito) { feito = true; resolver(null); } } }).observe(document.body, { childList: true });
      document.body.append(fundo);
      campo.focus();
    });
  };
  /** TS.avisar('Este cliente está sem celular válido.') — aviso simples com "Entendi"; devolve Promise que fecha junto */
  TS.avisar = function (msg, o = {}) {
    return new Promise((resolver) => {
      const fundo = h('div', { class: 'cp-modal-bg ts-aviso-bg' });
      let feito = false;
      const sair = () => { if (feito) return; feito = true; fundo.remove(); resolver(); };
      const ok = h('button', { type: 'button', class: 'btn primary', onclick: sair }, o.botao || 'Entendi');
      fundo.addEventListener('click', (e) => { if (e.target === fundo) sair(); });
      fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') sair(); });
      fundo.append(h('div', { class: 'card cp-copiar ts-perg' + (o.erro ? ' ts-perg-erro' : ''), role: 'alertdialog', 'aria-modal': 'true', 'aria-label': o.titulo || 'Aviso' },
        o.titulo ? h('h3', null, o.erro ? '⚠️ ' : '', o.titulo) : null,
        h('div', { class: 'ts-perg-msg' }, String(msg == null ? '' : msg)),
        h('div', { class: 'ts-perg-acoes' }, ok)));
      new MutationObserver((_, ob) => { if (!fundo.isConnected) { ob.disconnect(); if (!feito) { feito = true; resolver(); } } }).observe(document.body, { childList: true });
      document.body.append(fundo);
      ok.focus();
    });
  };
  /**
   * Não foi salvo (pedido do dono, 23/11/2026): o erro ao salvar abre uma janela em destaque, não um aviso discreto que
   * some (ele criou uma campanha sem nome, o aviso passou despercebido e achou que tinha salvado). "Corrigir" fecha e leva
   * ao campo com problema: borda de erro, a frase embaixo dele e o foco; some quando a pessoa mexe no campo.
   * Só para ação que a pessoa fez (clicou em Salvar); atualização em segundo plano não usa isto.
   */
  TS.naoSalvo = async (e, campo) => {
    const msg = typeof e === 'string' ? e : TS.erroDeRede && TS.erroDeRede(e) ? 'Sem conexão com o painel agora. Tente de novo em instantes.' : (e && e.message) || 'Não deu certo. Tente de novo.';
    await TS.avisar(msg, { titulo: 'Não foi salvo', botao: campo ? 'Corrigir' : 'Entendi', erro: true });
    if (!campo || !campo.isConnected) return;
    TS.marcarCampoErro(campo, msg);
  };
  /** marca o campo com problema (borda, frase embaixo, aria-invalid) e põe o foco nele; sai ao mexer no campo */
  TS.marcarCampoErro = (campo, msg) => {
    const ant = campo.parentNode && campo.parentNode.querySelector(':scope > .campo-erro-msg');
    if (ant) ant.remove();
    const nota = h('small', { class: 'campo-erro-msg', role: 'alert' }, msg);
    campo.classList.add('campo-erro');
    campo.setAttribute('aria-invalid', 'true');
    campo.insertAdjacentElement('afterend', nota);
    const tirar = () => { campo.classList.remove('campo-erro'); campo.removeAttribute('aria-invalid'); nota.remove(); campo.removeEventListener('input', tirar); campo.removeEventListener('change', tirar); };
    campo.addEventListener('input', tirar); campo.addEventListener('change', tirar);
    if (campo.scrollIntoView) campo.scrollIntoView({ block: 'center', behavior: 'smooth' });
    campo.focus({ preventScroll: true });
  };
  /** erro de uma ação em português: sem conexão vira frase nossa, nunca o texto do navegador */
  TS.avisarErro = (e) => TS.avisar(TS.erroDeRede && TS.erroDeRede(e) ? 'Sem conexão com o painel agora. Tente de novo em instantes.' : (e && e.message) || 'Não deu certo. Tente de novo.', { titulo: 'Não deu certo' });

  TS.alpha = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
})();
