/* Inicialização, navegação e atualização dos dados */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  const content = document.getElementById('content');
  let PAGES = ['resumo', 'comparativos', 'comissionamento', 'promocao', 'mapa', 'clientes', 'minha'];
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
  TS.render = function () {
    const ae = document.activeElement;
    const g = ehCampo(ae) ? capturar(ae) : null;
    renderTela();
    TS.botoesExpandir && TS.botoesExpandir(content);
    if (g) restaurar(g);
  };
  function renderTela() {
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.page === state.page));
    const ativa = document.querySelector('#tabs a.active');
    if (ativa && ativa.scrollIntoView) { const t = document.getElementById('tabs'); if (t.scrollWidth > t.clientWidth) t.scrollTo({ left: ativa.offsetLeft - 12, behavior: 'smooth' }); }
    document.body.classList.toggle('pg-config', state.page === 'config');
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
    const btn = document.getElementById('btnAtualizar');
    btn.classList.add('spin');
    try {
      const qs = new URLSearchParams({ loja: state.loja || '' });
      if (forcar) qs.set('atualizar', '1');
      const res = await fetch(TS.api('dados?' + qs), { credentials: 'same-origin' });
      if (res.status === 401 && !TS.demo) { location.href = '/login'; return; }
      const body = await res.json();
      if (res.status === 403 && body.erro === 'trocar-senha') { location.href = '/trocar-senha?primeiro=1'; return; }
      if (body.semLojas) { TS.db = null; if (TS.eu?.pode?.configurar) { location.hash = '#config'; rota(); } else content.replaceChildren(h('div', { class: 'notice' }, body.erro)); return; }
      if (!res.ok) throw new Error(body.erro || res.statusText);
      const primeira = !TS.db || TS.lojaCarregada !== state.loja;
      if (!primeira && !forcar && body.geradoEm === TS.db.geradoEm) return; // nada mudou
      if (primeira && TS.db) TS.resetFiltros();
      TS.lojaCarregada = state.loja;
      TS.db = TS.decode(body);
      TS.aplicarMarca && TS.aplicarMarca();
      TS.rules.prepare();
      TS.prepararClientes();
      const aviso = res.headers.get('X-Dados-Aviso');
      TS.aviso = aviso ? 'Não consegui atualizar agora; mostrando os dados anteriores. Motivo: ' + decodeURIComponent(aviso) : null;
      const em = new Date(res.headers.get('X-Dados-Em') || body.geradoEm);
      document.getElementById('updated').replaceChildren('Atualizado', h('b', null, em.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })));
      const fontes = (body.fontes || []).filter((f) => f.origem).map((f) => `${f.loja ? f.loja + ' · ' : ''}${f.nome}: ${f.origem === 'vps' ? 'VPS, arquivo de ' + new Date(f.modificado).toLocaleString('pt-BR') : 'Google Drive'}${f.ok === false ? ' (FALHOU)' : ''}`);
      document.getElementById('updated').title = `Dados processados em ${em.toLocaleString('pt-BR')}. Vendas até ${fmt.date(TS.dayToIso(TS.db.maxDay))}.\n\nFontes:\n${fontes.join('\n')}`;
      if (primeira) { if (!lerEstado()) TS.aplicarPreset('30d'); rota(); } else if (state.page !== 'config') TS.render();
    } catch (e) {
      console.error(e);
      if (!TS.db) content.replaceChildren(h('div', { class: 'notice err' }, 'Não foi possível carregar os dados: ' + e.message, h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: () => carregar(true) }, 'Tentar de novo'))));
      else { TS.aviso = 'Falha ao atualizar: ' + e.message; TS.render(); }
    } finally {
      btn.classList.remove('spin');
    }
  }

  TS.recarregar = carregar;
  document.getElementById('btnAtualizar').addEventListener('click', () => carregar(true));
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
    document.querySelector('.logout-form')?.remove();
    document.getElementById('btnSenha')?.remove();
    document.getElementById('btnScript')?.remove();
    document.getElementById('btnAtualizar').title = 'Recarregar';
    document.querySelector('.layout').before(h('div', { class: 'demo-bar', role: 'note' },
      h('b', null, 'Apresentação'), ' · Todos os dados desta página são fictícios: lojas, vendedores, clientes e valores foram inventados para demonstração. Fique à vontade para clicar e filtrar.'));
  }

  /** abas conforme o perfil */
  function configurarAbas(eu) {
    if (TS.demo || !eu.perfil) return;
    const tabs = document.getElementById('tabs');
    if (eu.perfil === 'vendedor') PAGES = TS.PAGINAS_VENDEDOR;
    else if (Array.isArray(eu.telas)) PAGES = PAGES.filter((p) => eu.telas.includes(p) && (p !== 'clientes' || eu.pode?.clientes));
    else if (!eu.pode?.clientes) PAGES = PAGES.filter((p) => p !== 'clientes');
    if (!PAGES.length) PAGES = ['resumo'];
    tabs.querySelectorAll('a').forEach((a) => { if (!PAGES.includes(a.dataset.page)) a.remove(); });
    if (eu.perfil === 'vendedor' || (eu.perfil === 'gerente' && PAGES.includes('minha') && !PAGES.includes('comissionamento'))) {
      tabs.append(h('a', { href: '#minha', 'data-page': 'minha' }, eu.perfil === 'vendedor' ? 'Minha comissão' : 'Comissão por vendedor'));
    }
    if (eu.perfil === 'vendedor') {
      document.body.classList.add('perfil-vendedor');
    }
    if (eu.pode?.configurar) {
      PAGES = [...PAGES, 'config'];
      tabs.append(h('a', { href: '#config', 'data-page': 'config', class: 'tab-config', title: 'Configurações', 'aria-label': 'Configurações' }, '⚙'));
    }
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
})();
