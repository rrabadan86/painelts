/* Inicialização, navegação e atualização dos dados */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  const content = document.getElementById('content');
  let PAGES = ['inicio', 'resumo', 'comparativos', 'comissionamento', 'promocao', 'cupons', 'conferencia', 'mapa', 'clientes', 'minha'];
  TS.paginas = () => PAGES;

  // ---- manter o campo em que a pessoa está digitando quando a tela é redesenhada ----
  const ehCampo = (el) => el && el !== document.body && /^(INPUT|TEXTAREA)$/.test(el.tagName) && !/^(checkbox|radio|button|submit|file)$/.test(el.type);
  function caminho(el) {
    const p = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) { const pai = n.parentElement; if (!pai) return null; p.unshift(Array.prototype.indexOf.call(pai.children, n)); }
    return p;
  }
  function seguir(p) { let n = document.body; for (const k of p) { n = n && n.children[k]; } return n; }
  function capturar(el) {
    let ini = null, fim = null;
    try { ini = el.selectionStart; fim = el.selectionEnd; } catch { /* number/time não têm seleção */ }
    return { el, p: caminho(el), tag: el.tagName, type: el.type, ph: el.placeholder || '', valor: el.value, ini, fim, scroll: window.scrollY };
  }
  function restaurar(g) {
    if (!g.p || g.el.isConnected) return; // o mesmo campo continua na tela
    const n = seguir(g.p);
    if (!n || n.tagName !== g.tag || n.type !== g.type || (n.placeholder || '') !== g.ph) return;
    if (n.value !== g.valor && n.value === g.valor.trim()) n.value = g.valor; // mantém o espaço que a pessoa acabou de digitar
    try { n.focus({ preventScroll: true }); } catch { n.focus(); }
    if (g.ini != null) { try { n.setSelectionRange(g.ini, g.fim); } catch { /* ok */ } }
    if (Math.abs(window.scrollY - g.scroll) > 2) window.scrollTo(0, g.scroll);
  }
  /** Para campos que redesenham a tela ao mudar (hora, número, data): aplica quando a pessoa sai do campo,
      não a cada dígito — senão o campo some no meio da digitação. */
  TS.aoConfirmar = function (x, fn) {
    let pendente = false;
    // foco acompanhado pelos próprios eventos: no campo de hora o Chrome dispara "change" a cada parte digitada
    // (hora, minuto) e document.activeElement nem sempre aponta para o campo nesse momento
    let focado = false;
    x.addEventListener('focus', () => { focado = true; });
    x.addEventListener('blur', () => { focado = false; });
    x.addEventListener('change', () => {
      // no celular, data e hora vêm de um seletor (não se digita): aplica na hora
      const seletor = /^(date|time|month|datetime-local)$/.test(x.type) && matchMedia('(pointer: coarse)').matches;
      if (!seletor && (focado || document.activeElement === x) && x.type !== 'checkbox' && x.tagName !== 'SELECT') {
        if (pendente) return;
        pendente = true;
        x.addEventListener('blur', () => { pendente = false; setTimeout(fn, 0); }, { once: true }); // depois que o foco já foi para o próximo campo
      } else fn();
    });
    x.addEventListener('keydown', (e) => { if (e.key === 'Enter' && pendente) x.blur(); });
  };

  /** crédito no rodapé de todas as telas */
  TS.credito = () => h('footer', { class: 'credito' }, 'Desenvolvido por ', h('b', null, 'Rodrigo Rabadan'));
  // histórico parcial: o painel carrega os últimos 24 meses (+ o mês atual) e busca o resto só quando precisa
  // (Clientes, "Tudo", "só o mês" em todos os anos, ou um período cujo ano anterior fica antes do que veio)
  TS.historicoCompleto = false;
  let buscandoCompleto = false, cliIdle = null;
  const TELAS_CLI = new Set(['hoje', 'clientes', 'clilista', 'campanhas', 'conversas', 'cupons', 'espera', 'nfsaida']);
  const desdeParcial = () => {
    const h0 = TS.hojeSP ? TS.hojeSP() : new Date().toISOString().slice(0, 10);
    return new Date(Date.UTC(+h0.slice(0, 4), +h0.slice(5, 7) - 1 - 24, 1)).toISOString().slice(0, 10);
  };
  TS.garantirClientes = function () {
    if (TS.db && (!TS.cli || TS.cli._db !== TS.db)) {
      TS.prepararClientes();
      if (TS.cli) TS.cli._db = TS.db;
    }
    return TS.cli;
  };
  function precisaCompleto() {
    const db = TS.db, f = state.f;
    if (!db || !db.desde || TS.historicoCompleto) return false;
    const d0 = TS.isoToDay(db.desde);
    return state.page === 'clientes' || state.page === 'clilista' || state.page === 'campanhas' || f.de == null || f.de - 366 < d0 || (f.mes && !f.ano) || (f.ano && f.ano - 1 < +db.desde.slice(0, 4));
  }
  TS.carregarTudo = function () {
    if (TS.historicoCompleto || buscandoCompleto) return;
    TS.historicoCompleto = true; buscandoCompleto = true;
    carregar(false).finally(() => { buscandoCompleto = false; });
  };
  TS.render = function () {
    if (precisaCompleto()) TS.carregarTudo();
    const ae = document.activeElement;
    const g = ehCampo(ae) ? capturar(ae) : null;
    renderTela();
    // submenu do grupo (Vendas, Clientes, Equipe, Estoque e Margem): as telas que já desenham o seu não ganham outro
    if (state.page !== 'config' && !content.querySelector('.submenu')) { const sm = TS.subGrupo && TS.subGrupo(state.page); if (sm) content.prepend(sm); }
    TS.botoesExpandir && TS.botoesExpandir(content);
    if (g) restaurar(g);
  };
  function renderTela() {
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.page === state.page || (a.dataset.grupo || '').split(',').includes(state.page === 'nfsaida' || state.page === 'creditos' ? 'notas' : state.page)));
    ajustarTopo();
    const ativa = document.querySelector('#tabs a.active');
    if (ativa && ativa.scrollIntoView) { const t = document.getElementById('tabs'); if (t.scrollWidth > t.clientWidth) t.scrollTo({ left: ativa.offsetLeft - 12, behavior: 'smooth' }); }
    document.body.classList.toggle('pg-config', state.page === 'config');
    document.getElementById('btnUsuario')?.classList.toggle('on', state.page === 'config');
    document.body.classList.toggle('pg-minha', state.page === 'minha');
    document.body.classList.toggle('pg-semfiltros', state.page === 'inicio' || state.page === 'dre' || state.page === 'conferencia' || state.page === 'conversas'); // não usam os filtros
    if (state.page === 'config') {
      TS.destroyCharts();
      const root = h('div');
      content.replaceChildren(root, TS.credito());
      TS.pages.config(root);
      return;
    }
    if (!TS.db) return;
    TS.destroyCharts();
    if (TS.db.n && TELAS_CLI.has(state.page)) TS.garantirClientes();
    TS.renderFiltros();
    montarFaixa();
    const root = h('div');
    if (!TS.db.n) {
      root.append(h('div', { class: 'card vazio-loja' }, h('h2', null, 'Aguardando os primeiros dados desta loja'),
        h('p', null, 'Assim que a primeira coleta do AppNext terminar (ou uma planilha de vendas for enviada), os indicadores aparecem aqui.'),
        TS.eu?.pode?.configurar ? h('a', { class: 'btn primary', href: '#config' }, 'Abrir Configurações') : null));
      content.replaceChildren(root);
      return;
    }
    const atraso = TS.avisoAtraso && TS.avisoAtraso();
    if (atraso) root.append(atraso);
    if (TS.db.avisos.length) root.append(h('div', { class: 'notice' }, 'Algumas planilhas não foram lidas: ', TS.db.avisos.join(' · ')));
    if (TS.aviso) root.append(h('div', { class: 'notice err' }, TS.aviso));
    try {
      TS.pages[state.page](root);
    } catch (e) {
      console.error(e);
      root.append(h('div', { class: 'notice err' }, 'Erro ao montar a página: ' + e.message));
    }
    content.replaceChildren(root, TS.credito());
    salvarEstado();
  }

  // ---------- filtros em faixa no topo (computador); no celular continuam na gaveta ----------
  // TS.renderFiltros monta os campos que a tela usa; aqui eles só mudam de lugar: o período fica na faixa e o resto vai
  // para o painel "Mais filtros". O estado (TS.state) e o que cada tela usa não mudam.
  const mqGaveta = matchMedia('(max-width: 860px)');
  let maisAberto = false, maisPagina = null;
  const anoMesTxt = (p) => (p.ano && p.mes ? `${TS.MESES_LONGOS[p.mes - 1]} de ${p.ano}` : p.ano ? `Ano de ${p.ano}` : `${TS.MESES_LONGOS[p.mes - 1]} (todos os anos)`);
  const faixaTxt = (a, b) => (a !== '' && b !== '' ? (String(a) === String(b) ? String(a) : `${a} a ${b}`) : a !== '' ? `${a} ou mais` : b !== '' ? `até ${b}` : '');
  const nomesSet = (set, campo) => { const n = [...set].map((i) => (campo ? TS.db.D[campo][i] : i)).filter((x) => x != null); return n.length > 2 ? `${n.length} selecionados` : n.join(', '); };
  /** filtros do painel "Mais filtros" que estão valendo agora: rótulo do campo, nome na etiqueta, texto e como tirar */
  function filtrosAtivos() {
    const f = state.f, s = state.cli, c = state.com, p = state.promo, L = [];
    const add = (rotulo, nome, texto, limpar) => { if (texto) L.push({ rotulo, nome, texto: String(texto), limpar }); };
    if (state.page === 'clientes' || state.page === 'clilista') {
      add('Ano e mês', 'Ano e mês', s.per.preset === 'anomes' ? anoMesTxt(s.per) : '', () => TS.aplicarAnoMes(null, null, s.per, 'tudo'));
      for (const [rot, k] of [['Nome', 'nome'], ['CPF', 'cpf'], ['Cupom', 'cupom'], ['Produto comprado', 'produto']]) add(rot, rot, s[k], () => { s[k] = ''; });
      add('Visitas (cupons)', 'Visitas', faixaTxt(s.visMin, s.visMax), () => { s.visMin = ''; s.visMax = ''; });
      add('Dias sem comprar', 'Dias sem comprar', faixaTxt(s.ausMin, s.ausMax), () => { s.ausMin = ''; s.ausMax = ''; });
      add('Aniversário', 'Aniversário', s.aniv ? TS.MESES_LONGOS[+s.aniv - 1] : '', () => { s.aniv = ''; });
      add('Loja', 'Loja', nomesSet(s.lojas, 'loja'), () => s.lojas.clear());
      add('Grupo comprado', 'Grupo comprado', nomesSet(s.grupos, 'grupoC'), () => s.grupos.clear());
      add('Cidade (cadastro)', 'Cidade', nomesSet(s.cidade, null), () => s.cidade.clear());
      return L;
    }
    add('Ano e mês', 'Ano e mês', f.preset === 'anomes' ? anoMesTxt(f) : '', () => TS.aplicarAnoMes(null, null, f));
    add('Loja', 'Loja', nomesSet(f.lojas, 'loja'), () => f.lojas.clear());
    add('Vendedor', 'Vendedor', nomesSet(f.vendedores, 'vendedor'), () => f.vendedores.clear());
    add('Grupo', 'Grupo', nomesSet(f.grupos, 'grupoC'), () => f.grupos.clear());
    add('Categoria', 'Categoria', nomesSet(f.cats, 'cat'), () => f.cats.clear());
    add('Produto contém', 'Produto', f.produto, () => { f.produto = ''; });
    add('Tamanho do pacote', 'Pacote', [...f.tamanhos].sort((a, b) => a - b).map((t) => (t >= 1000 ? '1 kg' : `${t}g`)).join(', '), () => f.tamanhos.clear());
    add('Meta da loja (R$)', 'Meta simulada', c.meta != null ? fmt.brl(c.meta) : '', () => { c.meta = null; c.metaYm = null; });
    add('Bônus sobre outros vendedores', 'Bônus', c.vendBonus, () => { c.vendBonus = ''; });
    add('Buscar cupom', 'Cupom', c.cupom, () => { c.cupom = ''; });
    add('Comparar com os dias anteriores', 'Comparar com', p.dias !== 30 ? `${p.dias} dias anteriores` : '', () => { p.dias = 30; });
    return L;
  }
  function abrirMais(abrir, foco) {
    maisAberto = !!abrir;
    const bt = document.getElementById('btnMaisFiltros'), pop = document.getElementById('maisFiltros');
    if (!bt || !pop) return;
    if (!maisAberto) pop.querySelectorAll('.ms.open .ms-btn').forEach((b) => b.click()); // fecha junto a lista (Vendedor, Grupo…) que ficou aberta
    pop.hidden = !maisAberto; bt.setAttribute('aria-expanded', String(maisAberto));
    if (!foco) return;
    if (maisAberto) { const alvo = pop.querySelector('select, input, button'); if (alvo) alvo.focus(); } else bt.focus();
  }
  function montarFaixa() {
    const box = document.getElementById('filtros');
    if (state.page !== maisPagina) { maisAberto = false; maisPagina = state.page; }
    let itens = [...box.children];
    if (itens.length === 1 && itens[0].tagName === 'DIV' && !itens[0].className) itens = [...itens[0].children]; // Clientes entrega tudo numa caixa só
    const grupos = itens.filter((e) => e.classList.contains('f-group'));
    const periodo = grupos.find((g) => g.querySelector('input[type=date]') && g.querySelector('.chips'));
    const simples = !periodo && grupos.length <= 2; // tela de um filtro só (Estoque, Pedido, Site): o campo vai sozinho na faixa
    document.body.classList.toggle('fx-vazia', !grupos.length); // tela sem filtro: sem faixa no computador
    document.body.classList.toggle('fx-simples', simples);
    if (mqGaveta.matches || !grupos.length) return; // celular: a gaveta de sempre
    const uso = itens.find((e) => e.classList.contains('f-uso'));
    const resto = simples ? [] : itens.filter((e) => e !== uso && e !== periodo);
    const ativos = filtrosAtivos().filter((a) => resto.some((g) => g.classList.contains('f-group') && g.querySelector('.f-label')?.textContent === a.rotulo));
    // a frase de contexto ("Estoque de agora…") e a dica do período viram um ⓘ ao lado do rótulo
    const rot = (periodo || grupos[0]).querySelector('.f-label');
    if (uso && rot) rot.append(TS.dica(uso.textContent));
    if (periodo && rot) for (const d of [...periodo.children].filter((e) => e.tagName === 'SMALL' || e.classList.contains('f-hint'))) { rot.append(TS.dica(d.textContent)); d.remove(); }
    if (simples) { box.replaceChildren(...grupos); return; }
    const pop = h('div', { class: 'fx-pop' + (resto.filter((e) => e.classList.contains('f-group')).length > 6 ? ' larga' : ''), id: 'maisFiltros', role: 'dialog', 'aria-label': 'Mais filtros', hidden: !maisAberto }, resto);
    const bt = h('button', { type: 'button', class: 'fx-btn' + (ativos.length ? ' on' : ''), id: 'btnMaisFiltros', 'aria-haspopup': 'dialog', 'aria-controls': 'maisFiltros', 'aria-expanded': String(maisAberto),
      title: ativos.length ? `${ativos.length} filtro${ativos.length > 1 ? 's' : ''} valendo além do período` : null, onclick: () => abrirMais(!maisAberto, true) },
    'Mais filtros', ativos.length ? h('small', { class: 'fx-n' }, String(ativos.length)) : null);
    const tags = ativos.map((a) => h('span', { class: 'fx-tag' }, h('span', null, `${a.nome}: ${a.texto}`),
      h('button', { type: 'button', 'aria-label': `Tirar o filtro ${a.nome}`, title: 'Tirar este filtro', onclick: () => { a.limpar(); TS.render(); document.getElementById('btnMaisFiltros')?.focus(); } }, '✕')));
    // ordem fixa (período, botão + painel, etiquetas): o campo em que a pessoa digita continua no mesmo lugar quando a tela é redesenhada
    box.replaceChildren(...[periodo, resto.length ? h('div', { class: 'fx-mais' }, bt, pop) : null, h('div', { class: 'fx-tags' }, tags)].filter(Boolean));
  }
  document.addEventListener('click', (e) => { if (maisAberto && !e.target.closest('.fx-mais')) abrirMais(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && maisAberto) abrirMais(false, true); });
  mqGaveta.addEventListener('change', () => { maisAberto = false; document.body.classList.remove('filters-open'); if (TS.db) TS.render(); });

  // ---------- estado na URL/localStorage (filtros lembrados) ----------
  const keyFiltros = () => 'teashop.filtros.v2.' + (TS.demo ? 'demo.' : '') + (state.loja || 'padrao');
  function salvarEstado() {
    try {
      const f = state.f;
      localStorage.setItem(keyFiltros(), JSON.stringify({
        preset: f.preset, de: f.de, ate: f.ate, ano: f.ano, mes: f.mes,
        lojas: [...f.lojas].map((i) => TS.db.D.loja[i]), vendedores: [...f.vendedores].map((i) => TS.db.D.vendedor[i]),
        grupos: [...f.grupos].map((i) => TS.db.D.grupoC[i]), cats: [...f.cats].map((i) => TS.db.D.cat[i]),
        vendBonus: state.com.vendBonus, dias: state.promo.dias,
      }));
    } catch { /* navegação privada */ }
  }
  function lerEstado() {
    try {
      const s = JSON.parse(localStorage.getItem(keyFiltros()) || 'null');
      if (!s) return false;
      const f = state.f, D = TS.db.D;
      const back = (arr, field, set) => (arr || []).forEach((t) => { const i = D[field].indexOf(t); if (i >= 0) set.add(i); });
      back(s.lojas, 'loja', f.lojas); back(s.vendedores, 'vendedor', f.vendedores); back(s.grupos, 'grupoC', f.grupos); back(s.cats, 'cat', f.cats);
      if (s.preset === 'anomes') TS.aplicarAnoMes(s.ano, s.mes); else if (s.preset && s.preset !== 'custom') TS.aplicarPreset(s.preset); else { f.preset = 'custom'; f.de = s.de; f.ate = s.ate; }
      state.com.vendBonus = s.vendBonus || ''; state.promo.dias = s.dias || 30;
      return true;
    } catch { return false; }
  }

  // ---------- navegação ----------
  function rota() {
    const p = location.hash.replace('#', '');
    state.page = PAGES.includes(p) ? p : PAGES[0];
    document.body.classList.remove('filters-open');
    TS.render();
    window.scrollTo({ top: 0 });
  }
  window.addEventListener('hashchange', rota);

  // ---------- botão "voltar" do celular fecha a janela por cima (nota, ficha, drawer…) em vez de trocar de tela ----------
  // Cada janela aberta ganha uma entrada no histórico (mesmo endereço). O "voltar" consome essa entrada e fecha a de cima.
  // Se a janela fecha pelo X/fundo, o painel tira a entrada sobrando (sem o usuário perceber).
  (function () {
    const SEL = '.camada-cheia, .prc-drawer-camada, .prc-popup-camada, .cp-modal-bg';
    let empurrados = 0, ignorar = 0, fechandoPeloVoltar = 0, agendado = false;
    const pilha = [];
    const abertas = () => [...document.querySelectorAll(SEL)].filter((el) => el.isConnected);
    const sync = () => {
      agendado = false;
      const n = abertas().length;
      while (empurrados < n) { history.pushState({ camada: true }, '', location.href); pilha.push(location.href); empurrados++; }
      while (empurrados > n) {
        empurrados--;
        const url = pilha.pop();
        if (fechandoPeloVoltar > 0) fechandoPeloVoltar--; // o "voltar" já consumiu a entrada
        else if (url === location.href && history.state && history.state.camada) { ignorar++; history.back(); }
        // fechou porque foi para outra tela (link dentro da janela): não volta, senão desfaria a navegação
      }
    };
    // setTimeout (não microtarefa): um link dentro da janela que fecha a janela no clique já trocou o endereço quando o sync roda,
    // então o "voltar" automático não desfaz a navegação
    new MutationObserver(() => { if (!agendado) { agendado = true; setTimeout(sync, 0); } }).observe(document.body, { childList: true, subtree: true });
    const fecharTopo = (el) => {
      // as janelas fecham com um clique no fundo (o próprio elemento da camada)
      for (const tipo of ['mousedown', 'click']) el.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true }));
      if (el.isConnected) { const x = el.querySelector('[aria-label="Fechar"], .fechar, .prc-drawer-fechar'); if (x) x.click(); }
      if (el.isConnected) { el.remove(); if (!document.querySelector(SEL)) document.body.classList.remove('com-camada'); }
    };
    window.addEventListener('popstate', () => {
      if (ignorar > 0) { ignorar--; return; }
      const lista = abertas();
      if (!lista.length) return;
      fechandoPeloVoltar++;
      fecharTopo(lista[lista.length - 1]);
    });
  })();

  // ---------- dados guardados no aparelho ----------
  // Abrir o painel mostra na hora a última versão guardada neste navegador; o servidor confere logo em seguida
  // (responde "não mudou" ou manda a nova). Guarda só o que o servidor já entrega a esta pessoa, uma versão por
  // pessoa e loja; some ao sair, quando a sessão expira, quando outra pessoa entra neste aparelho e depois de 7 dias.
  const Guardados = (() => {
    const BANCO = 'teashop-painel', TAB = 'dados', VALIDADE = 7 * 864e5;
    let pBanco = null;
    const banco = () => pBanco || (pBanco = new Promise((ok, erro) => {
      if (!window.indexedDB) { erro(new Error('sem IndexedDB')); return; }
      const r = indexedDB.open(BANCO, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(TAB);
      r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); pBanco = null; }; ok(r.result); };
      r.onerror = () => erro(r.error);
      r.onblocked = () => erro(new Error('bloqueado'));
    }).catch((e) => { pBanco = null; throw e; }));
    const pedir = async (modo, fn) => {
      const db = await banco();
      return new Promise((ok, erro) => {
        const t = db.transaction(TAB, modo);
        const r = fn(t.objectStore(TAB));
        t.oncomplete = () => ok(r && r.result);
        t.onerror = t.onabort = () => erro(t.error);
      });
    };
    const dono = () => (TS.demo ? 'demo' : TS.eu ? (TS.eu.usuario || '_') : '');
    return {
      async ler(loja, chave) {
        try {
          const u = dono();
          if (!u) return null;
          const g = await pedir('readonly', (s) => s.get(u + '|' + loja));
          return g && g.chave === chave && Date.now() - g.salvoEm < VALIDADE ? g : null;
        } catch { return null; }
      },
      salvar(loja, chave, texto, etag, em) {
        const u = dono();
        if (!u || !etag) return;
        pedir('readwrite', (s) => s.put({ chave, texto, etag, em, salvoEm: Date.now() }, u + '|' + loja)).catch(() => { /* sem espaço: segue sem guardar */ });
      },
      /** apaga o que é de outra pessoa ou já venceu */
      async limpar() {
        const u = dono();
        if (!u) return;
        try {
          await pedir('readwrite', (s) => {
            const r = s.openCursor();
            r.onsuccess = () => {
              const c = r.result;
              if (!c) return;
              if (!String(c.key).startsWith(u + '|') || !(Date.now() - (c.value && c.value.salvoEm) < VALIDADE)) c.delete();
              c.continue();
            };
          });
        } catch { /* ok */ }
      },
      /** apaga tudo (sair / sessão expirada); espera no máximo 1,5 s */
      apagarTudo() {
        return new Promise((ok) => {
          const fim = setTimeout(ok, 1500);
          const pronto = () => { clearTimeout(fim); ok(); };
          Promise.resolve(pBanco).then((db) => db && db.close(), () => {}).then(() => {
            pBanco = null;
            try { const r = indexedDB.deleteDatabase(BANCO); r.onsuccess = r.onerror = r.onblocked = pronto; } catch { pronto(); }
          });
        });
      },
    };
  })();
  TS.guardados = Guardados;
  const irParaLogin = async () => { await Guardados.apagarTudo(); location.href = '/login'; };
  // Sair: apaga os dados guardados antes de encerrar a sessão
  document.querySelectorAll('form.logout-form').forEach((f) => f.addEventListener('submit', (e) => {
    if (f.dataset.limpo) return;
    e.preventDefault();
    Guardados.apagarTudo().then(() => { f.dataset.limpo = '1'; f.submit(); });
  }));

  // ---------- dados ----------
  /** desenha os dados recebidos (do servidor ou guardados no aparelho) */
  function aplicar(body, { pagAlvo, em, aviso }) {
    const primeira = !TS.db || TS.lojaCarregada !== state.loja;
    if (primeira && TS.db) { TS.resetFiltros(); TS.limparCaches && TS.limparCaches(); }
    // os filtros guardam o número de cada texto no dicionário; numa recarga (atualização automática, "carregar todo o
    // histórico", produto reclassificado) a ordem do dicionário pode mudar: guarda os textos e remonta depois
    const textos = !primeira && TS.db ? TS.filtrosEmTexto() : null;
    TS.lojaCarregada = state.loja;
    TS.db = TS.decode(body);
    if (textos) TS.filtrosDeTexto(textos);
    TS.aplicarMarca && TS.aplicarMarca();
    TS.rules.prepare();
    TS.cli = null;
    if (cliIdle) { (window.cancelIdleCallback || clearTimeout)(cliIdle); cliIdle = null; }
    if (TELAS_CLI.has(pagAlvo)) TS.garantirClientes();
    else cliIdle = (window.requestIdleCallback || ((fn) => setTimeout(fn, 200)))(() => { cliIdle = null; TS.garantirClientes(); });
    TS.aviso = aviso ? 'Não consegui atualizar agora; mostrando os dados anteriores. Motivo: ' + aviso : null;
    const quando = new Date(em || body.geradoEm);
    const upd = document.getElementById('updated');
    upd.replaceChildren('Atualizado', h('b', null, quando.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
    const podeHist = TS.eu && TS.eu.pode && TS.eu.pode.configurar && TS.abrirHistAtualizacoes && !TS.demo;
    upd.title = `Dados processados em ${quando.toLocaleString('pt-BR')}. Vendas até ${fmt.date(TS.dayToIso(TS.db.maxDay))}.${podeHist ? '\n\nClique para ver o histórico das atualizações.' : ''}`;
    upd.classList.toggle('clicavel', !!podeHist);
    if (podeHist && !upd.dataset.ligado) { upd.dataset.ligado = '1'; upd.setAttribute('role', 'button'); upd.tabIndex = 0; upd.addEventListener('click', () => TS.abrirHistAtualizacoes()); upd.addEventListener('keydown', (e) => { if (e.key === 'Enter') TS.abrirHistAtualizacoes(); }); }
    if (primeira) { if (!lerEstado()) TS.aplicarPreset('30d'); rota(); } else if (state.page !== 'config') TS.render();
  }

  async function carregar(forcar, repetindo) {
    const btn = document.getElementById('updated');
    btn.classList.add('carregando');
    const loja = state.loja;
    try {
      const hashPag = location.hash.replace('#', '');
      const pagAlvo = PAGES.includes(hashPag) ? hashPag : state.page;
      const qs = new URLSearchParams({ loja: loja || '' });
      if (TS.lojaCarregada !== loja) TS.historicoCompleto = false; // loja nova: começa pelo parcial
      if (['clientes', 'clilista', 'campanhas'].includes(pagAlvo)) TS.historicoCompleto = true;
      if (!TS.historicoCompleto) qs.set('desde', desdeParcial());
      const chave = qs.toString();
      if (forcar) { qs.set('atualizar', '1'); TS.limparCaches && TS.limparCaches(); }
      // abrindo o painel (ou trocando de loja): mostra na hora o que ficou guardado neste aparelho
      if (!forcar && (!TS.db || TS.lojaCarregada !== loja)) {
        const g = await Guardados.ler(loja, chave);
        if (g && state.loja === loja && (!TS.db || TS.lojaCarregada !== loja)) {
          try {
            aplicar(JSON.parse(g.texto), { pagAlvo, em: g.em, aviso: null });
            TS.etag = g.etag; TS.etagChave = chave; TS.dadosGuardados = true;
          } catch (e) { console.error(e); }
        }
      }
      // mesmo pedido de antes: o servidor responde 304 se nada mudou (não baixa tudo de novo)
      const headers = !forcar && TS.etag && TS.etagChave === chave && TS.db && TS.lojaCarregada === loja ? { 'If-None-Match': TS.etag } : {};
      const res = await fetch(TS.api('dados?' + qs), { credentials: 'same-origin', headers });
      if (state.loja !== loja) return; // trocaram de loja enquanto baixava: o pedido da loja nova cuida da tela
      // outra pessoa entrou neste navegador (outra aba): nada desta resposta fica aqui; recarrega como a pessoa nova
      const dono = res.headers.get('X-Painel-Usuario');
      if (!TS.demo && dono != null && TS.eu && dono !== (TS.eu.usuario || '')) { Guardados.limpar && Guardados.limpar(); location.reload(); return; }
      if (res.status === 304) { TS.dadosGuardados = false; return; }
      if (res.status === 401 && !TS.demo) { irParaLogin(); return; }
      const texto = await res.text();
      const body = JSON.parse(texto);
      if (res.status === 403 && body.erro === 'trocar-senha') { location.href = '/trocar-senha?primeiro=1'; return; }
      if (body.semLojas) { TS.db = null; if (TS.eu?.pode?.configurar) { location.hash = '#config'; rota(); } else content.replaceChildren(h('div', { class: 'notice' }, body.erro)); return; }
      if (!res.ok) throw new Error(body.erro || res.statusText);
      TS.dadosGuardados = false;
      const etag = res.headers.get('ETag');
      const em = res.headers.get('X-Dados-Em') || body.geradoEm;
      const avisoSrv = res.headers.get('X-Dados-Aviso');
      if (!avisoSrv) Guardados.salvar(loja, chave, texto, etag, em);
      const primeira = !TS.db || TS.lojaCarregada !== loja;
      TS.etag = etag; TS.etagChave = chave;
      if (!primeira && !forcar && body.geradoEm === TS.db.geradoEm && (body.desde || null) === (TS.db.desde || null)) return; // nada mudou
      aplicar(body, { pagAlvo, em, aviso: avisoSrv ? decodeURIComponent(avisoSrv) : null });
    } catch (e) {
      console.error(e);
      // a página foi pausada (outra aba/app) ou a internet caiu no meio: espera voltar e tenta de novo uma vez, sem assustar
      if (TS.erroDeRede(e) && !repetindo) { TS.esperarVisivel().then(() => { if (state.loja === loja) carregar(forcar, true); }); return; }
      if (TS.erroDeRede(e)) e = new Error('sem conexão com o painel agora.');
      if (!TS.db) content.replaceChildren(h('div', { class: 'notice err' }, 'Não foi possível carregar os dados: ' + e.message, h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: () => carregar(true) }, 'Tentar de novo'))));
      else { TS.aviso = (TS.dadosGuardados ? 'Sem conexão com o painel: mostrando os dados guardados neste aparelho. ' : 'Falha ao atualizar: ') + e.message; TS.render(); }
    } finally {
      if (state.loja === loja) btn.classList.remove('carregando');
    }
  }

  TS.recarregar = carregar;
  // menu da conta (trocar senha, sair)
  {
    const b = document.getElementById('btnUsuario'), pop = document.getElementById('userPop');
    const fechar = () => { pop.hidden = true; b.setAttribute('aria-expanded', 'false'); };
    b.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; b.setAttribute('aria-expanded', String(!pop.hidden)); });
    document.addEventListener('click', (e) => { if (!pop.hidden && !e.target.closest('.user-wrap')) fechar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
  }
  document.getElementById('btnLimpar').addEventListener('click', () => { TS.limparFiltros(); TS.render(); });
  document.getElementById('btnFiltros').addEventListener('click', () => document.body.classList.add('filters-open'));
  document.getElementById('btnFecharFiltros').addEventListener('click', () => document.body.classList.remove('filters-open'));
  document.getElementById('scrim').addEventListener('click', () => document.body.classList.remove('filters-open'));
  // recarrega sozinho a cada 15 min se a aba estiver aberta
  setInterval(() => { if (document.visibilityState === 'visible') carregar(false); }, 15 * 60e3);

  // ---------- apresentação: faixa de aviso e sem botões de conta/script ----------
  if (!TS.demo && new URLSearchParams(location.search).get('senha') === 'ok') {
    history.replaceState(null, '', location.pathname + location.hash);
    setTimeout(() => { const t = h('div', { class: 'toast', role: 'status' }, 'Senha alterada. Use a nova senha nos próximos acessos.'); document.body.append(t); setTimeout(() => t.remove(), 6000); }, 600);
  }
  if (TS.demo) {
    document.body.classList.add('demo');
    document.title = 'Tea Shop · Apresentação do painel';
    // menu da conta só com Configurações (não há senha nem sair na apresentação)
    document.getElementById('btnSenha')?.remove();
    document.querySelector('.user-wrap .logout-form')?.remove();
    document.getElementById('btnScript')?.remove();
    document.querySelector('.layout').before(h('div', { class: 'demo-bar', role: 'note' },
      h('b', null, 'Apresentação'), ' · Você está vendo o painel como administrador, com todas as telas. Todos os dados são fictícios (lojas, vendedores, clientes, estoque e valores) e nada do que você mudar é salvo.'));
  }

  /** as abas não cabem ao lado da marca e dos botões? descem para a segunda linha (nada fica escondido) */
  function ajustarTopo() {
    const t = document.getElementById('tabs');
    if (!t) return;
    document.body.classList.remove('tabs-2l');
    if (t.scrollWidth > t.clientWidth + 2) document.body.classList.add('tabs-2l');
  }
  TS.ajustarTopo = ajustarTopo;
  window.addEventListener('resize', TS.debounce ? TS.debounce(ajustarTopo, 120) : ajustarTopo);

  /**
   * Menu por assunto: Vendas · Clientes · Equipe · Estoque e Margem · ⚙. Cada grupo mostra só as telas que a pessoa pode ver;
   * grupo com uma tela só vira uma aba com o nome da tela; com mais de uma, a tela tem um submenu no topo.
   */
  const ROTULO = { inicio: 'Início', resumo: 'Resumo', comparativos: 'Comparativos', promocao: 'Promoção', cupons: 'Cupons', conferencia: 'Conferência', nfsaida: 'Notas fiscais', creditos: 'Notas fiscais', orcamento: 'Orçamento', checklist: 'Checklist', hoje: 'Hoje', clilista: 'Lista de clientes', clientes: 'Indicadores', campanhas: 'Campanhas', conversas: 'Conversas', espera: 'Lista de espera',
    comissionamento: 'Comissionamento', minha: 'Minha comissão', mapa: 'Movimento e escala', rentab: 'Rentabilidade', precos: 'Preços', site: 'Site', estoque: 'Estoque', pedido: 'Pedido', notas: 'Notas fiscais', inventario: 'Inventário', sugestoes: '⭐ Sugestões', validade: 'Validade', dre: 'Resultado' };
  TS.GRUPOS = [];
  function montarMenu(grupoEst, temConfig) {
    const tabs = document.getElementById('tabs');
    const G = [
      ['Início', ['inicio']],
      ['Vendas', ['resumo', 'comparativos', 'promocao', 'cupons', 'conferencia', 'orcamento']],
      ['Clientes', ['hoje', 'clilista', 'clientes', 'campanhas', 'conversas', 'espera']],
      ['Equipe', ['comissionamento', 'minha', 'mapa', 'checklist']],
      ['Produtos', grupoEst.filter((p) => ['rentab', 'precos', 'site'].includes(p))],
      ['Estoque', grupoEst.filter((p) => ['estoque', 'validade', 'pedido', 'notas', 'inventario', 'sugestoes'].includes(p))],
      ['Resultado', grupoEst.filter((p) => p === 'dre')],
    ].map(([nome, ps]) => [nome, ps.filter((p) => PAGES.includes(p))]).filter(([, ps]) => ps.length);
    TS.GRUPOS = G;
    tabs.replaceChildren(...G.map(([nome, ps]) => h('a', { href: '#' + ps[0], 'data-page': ps[0], 'data-grupo': ps.join(',') }, ps.length === 1 ? ROTULO[ps[0]] : nome)));
    // Configurações fica no menu da conta (nome no canto direito)
    if (temConfig && !document.getElementById('menuConfig')) {
      document.getElementById('userPop').prepend(h('a', { class: 'user-item', id: 'menuConfig', href: '#config', role: 'menuitem', onclick: () => { document.getElementById('userPop').hidden = true; } }, '⚙ Configurações'));
    }
    // ordem das telas = ordem do menu
    const ordem = G.flatMap(([, ps]) => ps);
    PAGES = [...ordem, ...PAGES.filter((p) => !ordem.includes(p))];
  }
  /** submenu do grupo da tela (quando o grupo tem mais de uma tela) */
  TS.subGrupo = (atual) => {
    if (atual === 'nfsaida' || atual === 'creditos') atual = 'notas'; // Notas fiscais → Saída fica dentro de Notas fiscais
    const g = TS.GRUPOS.find(([, ps]) => ps.includes(atual));
    if (!g || g[1].length < 2) return document.createDocumentFragment();
    return TS.ativoVisivel(h('nav', { class: 'submenu', 'aria-label': g[0] }, g[1].map((p) => h('a', { href: '#' + p, class: p === atual ? 'on' : null, 'aria-current': p === atual ? 'page' : null }, ROTULO[p]))));
  };

  /** abas conforme o perfil */
  function configurarAbas(eu) {
    if (!eu.perfil) {
      if (!PAGES.includes('campanhas')) PAGES.splice(PAGES.indexOf('clientes'), 1, 'hoje', 'clilista', 'clientes', 'campanhas', 'conversas', 'espera');
      PAGES = PAGES.filter((p) => p !== 'minha');
      if (!PAGES.includes('checklist')) PAGES.push('checklist');
      montarMenu([], false);
      return;
    }
    if (eu.perfil === 'vendedor') PAGES = [...TS.PAGINAS_VENDEDOR];
    else if (Array.isArray(eu.telas)) PAGES = PAGES.filter((p) => p === 'inicio' || (eu.telas.includes(p) && (p !== 'clientes' || eu.pode?.clientes))); // Início: todos (só mostra o que a pessoa pode ver)
    else if (!eu.pode?.clientes) PAGES = PAGES.filter((p) => p !== 'clientes');
    if (!PAGES.length) PAGES = ['resumo'];
    // "minha" (comissão do próprio vendedor / por vendedor para o gerente sem o Comissionamento completo)
    const comMinha = eu.perfil === 'vendedor' || (eu.perfil === 'gerente' && PAGES.includes('minha') && !PAGES.includes('comissionamento'));
    if (!comMinha) PAGES = PAGES.filter((p) => p !== 'minha');
    else if (!PAGES.includes('minha')) PAGES.push('minha');
    ROTULO.minha = eu.perfil === 'vendedor' ? 'Minha comissão' : 'Comissão por vendedor';
    if (eu.perfil === 'vendedor') document.body.classList.add('perfil-vendedor');
    // lista de espera: vendedoras sempre; gerente só com a tela liberada
    const veEspera = eu.perfil !== 'gerente' || !Array.isArray(eu.telas) || eu.telas.includes('espera');
    PAGES = PAGES.filter((p) => p !== 'espera');
    if (PAGES.includes('clientes')) PAGES.splice(PAGES.indexOf('clientes'), 1, 'hoje', 'clilista', 'clientes', 'campanhas', ...(veEspera ? ['espera'] : []));
    else if (veEspera) PAGES.push('espera');
    // Conversas do WhatsApp: só admin e franqueado (decisão do dono; o servidor também confere)
    if (['admin', 'franqueado'].includes(eu.perfil) && PAGES.includes('campanhas')) PAGES.splice(PAGES.indexOf('campanhas') + 1, 0, 'conversas');
    // Estoque e Margem: admin e franqueado veem tudo; gerente só as telas liberadas em Configurações → Usuários
    // Produtos (Rentabilidade, Preços, Site), Estoque (Estoque, Pedido, Notas fiscais) e Resultado
    const EST = ['rentab', 'precos', 'site', 'estoque', 'validade', 'pedido', 'notas', 'inventario', 'dre'];
    const grupoEst = eu.pode?.configurar ? EST : EST.filter((p) => (eu.telas || []).includes(p));
    if (eu.perfil === 'vendedor' && !grupoEst.includes('inventario')) grupoEst.push('inventario'); // a vendedora conta o estoque
    if (eu.perfil === 'vendedor' && !grupoEst.includes('validade')) grupoEst.unshift('validade'); // e acompanha a validade dos lotes
    // ⭐ sugestões para o pedido: vendedora sempre; gerente só com a tela marcada (sem escolha = padrão, que inclui)
    const veSug = eu.perfil !== 'gerente' || !Array.isArray(eu.telas) || eu.telas.includes('sugestoes');
    if (veSug && !grupoEst.includes('sugestoes')) grupoEst.push('sugestoes');
    TS.telasEstoque = grupoEst;
    PAGES = [...PAGES.filter((p) => !grupoEst.includes(p)), ...grupoEst, ...(grupoEst.includes('notas') ? ['nfsaida', 'creditos'] : [])];
    // checklist de abertura e fechamento: todo mundo da loja
    PAGES = [...PAGES.filter((p) => p !== 'checklist'), 'checklist'];
    // orçamento para empresas: só admin e franqueado (mostra custo e margem)
    if (eu.perfil === 'admin' || eu.perfil === 'franqueado' || eu.pode?.configurar) PAGES = [...PAGES.filter((p) => p !== 'orcamento'), 'orcamento'];
    if (eu.pode?.configurar) PAGES = [...PAGES, 'config'];
    montarMenu(grupoEst, !!eu.pode?.configurar);
    // nome no menu da conta
    const nome = String(eu.nome || eu.usuario || '').trim();
    document.getElementById('userNome').textContent = nome.split(/\s+/)[0] || 'Conta';
    document.getElementById('userIni').textContent = (nome[0] || '?').toUpperCase();
  }

  // ---------- lojas do usuário ----------
  async function iniciar() {
    try {
      const r = await fetch(TS.api('eu'), { credentials: 'same-origin' });
      if (r.status === 401 && !TS.demo) { irParaLogin(); return; }
      const eu = await r.json();
      TS.eu = eu;
      Guardados.limpar(); // outra pessoa entrou neste aparelho: o que era dela sai daqui
      TS.lojas = eu.lojas || [];
      configurarAbas(eu);
      TS.sistemaInit && TS.sistemaInit(eu);
      TS.iaInit && TS.iaInit(eu);
      TS.notif && TS.notif.iniciar(); // service worker das notificações + item "Notificações e aplicativo" do menu
      TS.guia && TS.guia.conferir(); // primeiro acesso do franqueado: abre a configuração guiada da loja (uma vez)
      const salvo = localStorage.getItem(TS.demo ? 'teashop.demo.loja' : 'teashop.loja');
      const ids = TS.lojas.map((l) => l.id);
      if (TS.lojas.length > 1) ids.push('todas');
      state.loja = ids.includes(salvo) ? salvo : ids[0];
      const sel = document.getElementById('lojaSel');
      if (TS.lojas.length > 1) {
        sel.replaceChildren(...TS.lojas.map((l) => h('option', { value: l.id }, l.nome)), h('option', { value: 'todas' }, 'Todas as lojas'));
        sel.value = state.loja;
        sel.hidden = false;
        sel.addEventListener('change', () => {
          state.loja = sel.value;
          state.invId = null;
          TS.limparCaches && TS.limparCaches();
          try { localStorage.setItem(TS.demo ? 'teashop.demo.loja' : 'teashop.loja', state.loja); } catch { /* ok */ }
          // nas Configurações (todas as lojas) a tela fica; a loja escolhida vale para as outras telas
          if (state.page !== 'config') content.replaceChildren(h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Carregando a loja…'))));
          carregar(false);
          TS.scriptLoja();
        });
      } else if (TS.lojas.length === 1) {
        document.querySelector('.brand-sub').textContent = TS.lojas[0].nome;
      }
    } catch (e) { console.error(e); }
    carregar(false);
    TS.scriptLoja();
  }
  iniciar();

  // painel atualizado com a aba aberta: avisa e oferece recarregar (senão a tela continua com a versão antiga)
  const minhaVersao = (() => { const sc = [...document.scripts].find((x) => /\?v=/.test(x.src)); return sc ? new URL(sc.src).searchParams.get('v') : null; })();
  let avisado = false;
  async function conferirVersao() {
    if (avisado || !minhaVersao || TS.demo) return;
    try {
      const j = await (await fetch('/api/versao', { credentials: 'same-origin', cache: 'no-store' })).json();
      if (!j.v || j.v === minhaVersao) return;
      avisado = true;
      const b = TS.h('div', { class: 'aviso-versao', role: 'status' }, TS.h('span', null, 'O painel foi atualizado.'),
        TS.h('button', { type: 'button', class: 'btn primary', onclick: () => location.reload() }, 'Recarregar agora'));
      document.body.append(b);
    } catch { /* sem conexão: tenta depois */ }
  }
  setInterval(conferirVersao, 3 * 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) conferirVersao(); });
})();
