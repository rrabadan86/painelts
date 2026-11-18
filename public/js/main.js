/* Inicialização, navegação e atualização dos dados */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  const content = document.getElementById('content');
  let PAGES = ['inicio', 'resumo', 'comparativos', 'comissionamento', 'promocao', 'cupons', 'mapa', 'clientes', 'minha'];
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
    x.addEventListener('change', () => {
      // no celular, data e hora vêm de um seletor (não se digita): aplica na hora
      const seletor = /^(date|time|month|datetime-local)$/.test(x.type) && matchMedia('(pointer: coarse)').matches;
      if (!seletor && document.activeElement === x && x.type !== 'checkbox' && x.tagName !== 'SELECT') {
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
  const TELAS_CLI = new Set(['hoje', 'clientes', 'clilista', 'campanhas', 'cupons', 'espera', 'nfsaida']);
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
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.page === state.page || (a.dataset.grupo || '').split(',').includes(state.page === 'nfsaida' ? 'notas' : state.page)));
    ajustarTopo();
    const ativa = document.querySelector('#tabs a.active');
    if (ativa && ativa.scrollIntoView) { const t = document.getElementById('tabs'); if (t.scrollWidth > t.clientWidth) t.scrollTo({ left: ativa.offsetLeft - 12, behavior: 'smooth' }); }
    document.body.classList.toggle('pg-config', state.page === 'config');
    document.getElementById('btnUsuario')?.classList.toggle('on', state.page === 'config');
    document.body.classList.toggle('pg-minha', state.page === 'minha');
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

  // ---------- dados ----------
  async function carregar(forcar) {
    const btn = document.getElementById('updated');
    btn.classList.add('carregando');
    try {
      const hashPag = location.hash.replace('#', '');
      const pagAlvo = PAGES.includes(hashPag) ? hashPag : state.page;
      const qs = new URLSearchParams({ loja: state.loja || '' });
      if (TS.lojaCarregada !== state.loja) TS.historicoCompleto = false; // loja nova: começa pelo parcial
      if (['clientes', 'clilista', 'campanhas'].includes(pagAlvo)) TS.historicoCompleto = true;
      if (!TS.historicoCompleto) qs.set('desde', desdeParcial());
      const chave = qs.toString();
      if (forcar) { qs.set('atualizar', '1'); TS.limparCaches && TS.limparCaches(); }
      // mesmo pedido de antes: o servidor responde 304 se nada mudou (não baixa tudo de novo)
      const headers = !forcar && TS.etag && TS.etagChave === chave && TS.db ? { 'If-None-Match': TS.etag } : {};
      const res = await fetch(TS.api('dados?' + qs), { credentials: 'same-origin', headers });
      if (res.status === 304) return;
      if (res.status === 401 && !TS.demo) { location.href = '/login'; return; }
      const body = await res.json();
      if (res.status === 403 && body.erro === 'trocar-senha') { location.href = '/trocar-senha?primeiro=1'; return; }
      if (body.semLojas) { TS.db = null; if (TS.eu?.pode?.configurar) { location.hash = '#config'; rota(); } else content.replaceChildren(h('div', { class: 'notice' }, body.erro)); return; }
      if (!res.ok) throw new Error(body.erro || res.statusText);
      const primeira = !TS.db || TS.lojaCarregada !== state.loja;
      if (!primeira && !forcar && body.geradoEm === TS.db.geradoEm && (body.desde || null) === (TS.db.desde || null)) return; // nada mudou
      TS.etag = res.headers.get('ETag'); TS.etagChave = chave;
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
      const aviso = res.headers.get('X-Dados-Aviso');
      TS.aviso = aviso ? 'Não consegui atualizar agora; mostrando os dados anteriores. Motivo: ' + decodeURIComponent(aviso) : null;
      const em = new Date(res.headers.get('X-Dados-Em') || body.geradoEm);
      document.getElementById('updated').replaceChildren('Atualizado', h('b', null, em.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
      const upd = document.getElementById('updated');
      const podeHist = TS.eu && TS.eu.pode && TS.eu.pode.configurar && TS.abrirHistAtualizacoes && !TS.demo;
      upd.title = `Dados processados em ${em.toLocaleString('pt-BR')}. Vendas até ${fmt.date(TS.dayToIso(TS.db.maxDay))}.${podeHist ? '\n\nClique para ver o histórico das atualizações.' : ''}`;
      upd.classList.toggle('clicavel', !!podeHist);
      if (podeHist && !upd.dataset.ligado) { upd.dataset.ligado = '1'; upd.setAttribute('role', 'button'); upd.tabIndex = 0; upd.addEventListener('click', () => TS.abrirHistAtualizacoes()); upd.addEventListener('keydown', (e) => { if (e.key === 'Enter') TS.abrirHistAtualizacoes(); }); }
      if (primeira) { if (!lerEstado()) TS.aplicarPreset('30d'); rota(); } else if (state.page !== 'config') TS.render();
    } catch (e) {
      console.error(e);
      if (!TS.db) content.replaceChildren(h('div', { class: 'notice err' }, 'Não foi possível carregar os dados: ' + e.message, h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: () => carregar(true) }, 'Tentar de novo'))));
      else { TS.aviso = 'Falha ao atualizar: ' + e.message; TS.render(); }
    } finally {
      btn.classList.remove('carregando');
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
  const ROTULO = { inicio: 'Início', resumo: 'Resumo', comparativos: 'Comparativos', promocao: 'Promoção', cupons: 'Cupons', nfsaida: 'Notas fiscais', hoje: 'Hoje', clilista: 'Lista de clientes', clientes: 'Indicadores', campanhas: 'Campanhas', espera: 'Lista de espera',
    comissionamento: 'Comissionamento', minha: 'Minha comissão', mapa: 'Movimento e escala', rentab: 'Rentabilidade', precos: 'Preços', site: 'Site', estoque: 'Estoque', pedido: 'Pedido', notas: 'Notas fiscais', inventario: 'Inventário', validade: 'Validade', dre: 'Resultado' };
  TS.GRUPOS = [];
  function montarMenu(grupoEst, temConfig) {
    const tabs = document.getElementById('tabs');
    const G = [
      ['Início', ['inicio']],
      ['Vendas', ['resumo', 'comparativos', 'promocao', 'cupons']],
      ['Clientes', ['hoje', 'clilista', 'clientes', 'campanhas', 'espera']],
      ['Equipe', ['comissionamento', 'minha', 'mapa']],
      ['Produtos', grupoEst.filter((p) => ['rentab', 'precos', 'site'].includes(p))],
      ['Estoque', grupoEst.filter((p) => ['estoque', 'validade', 'pedido', 'notas', 'inventario'].includes(p))],
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
    if (atual === 'nfsaida') atual = 'notas'; // Notas fiscais → Saída fica dentro de Notas fiscais
    const g = TS.GRUPOS.find(([, ps]) => ps.includes(atual));
    if (!g || g[1].length < 2) return document.createDocumentFragment();
    return h('nav', { class: 'submenu', 'aria-label': g[0] }, g[1].map((p) => h('a', { href: '#' + p, class: p === atual ? 'on' : null, 'aria-current': p === atual ? 'page' : null }, ROTULO[p])));
  };

  /** abas conforme o perfil */
  function configurarAbas(eu) {
    if (!eu.perfil) {
      if (!PAGES.includes('campanhas')) PAGES.splice(PAGES.indexOf('clientes'), 1, 'hoje', 'clilista', 'clientes', 'campanhas', 'espera');
      PAGES = PAGES.filter((p) => p !== 'minha');
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
    // Estoque e Margem: admin e franqueado veem tudo; gerente só as telas liberadas em Configurações → Usuários
    // Produtos (Rentabilidade, Preços, Site), Estoque (Estoque, Pedido, Notas fiscais) e Resultado
    const EST = ['rentab', 'precos', 'site', 'estoque', 'validade', 'pedido', 'notas', 'inventario', 'dre'];
    const grupoEst = eu.pode?.configurar ? EST : EST.filter((p) => (eu.telas || []).includes(p));
    if (eu.perfil === 'vendedor' && !grupoEst.includes('inventario')) grupoEst.push('inventario'); // a vendedora conta o estoque
    if (eu.perfil === 'vendedor' && !grupoEst.includes('validade')) grupoEst.unshift('validade'); // e acompanha a validade dos lotes
    TS.telasEstoque = grupoEst;
    PAGES = [...PAGES.filter((p) => !grupoEst.includes(p)), ...grupoEst, ...(grupoEst.includes('notas') ? ['nfsaida'] : [])];
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
      if (r.status === 401 && !TS.demo) { location.href = '/login'; return; }
      const eu = await r.json();
      TS.eu = eu;
      TS.lojas = eu.lojas || [];
      configurarAbas(eu);
      TS.sistemaInit && TS.sistemaInit(eu);
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
