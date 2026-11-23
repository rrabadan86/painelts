/* Página Configurações: lojas, acesso ao AppNext, metas por mês, planilhas, usuários, horários e histórico */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  const PERFIL_NOME = { admin: 'Administrador', franqueado: 'Franqueado', gerente: 'Gerente', vendedor: 'Vendedor' };
  const PERFIL_DESC = {
    admin: 'Tudo: todas as lojas, acessos, horários e usuários.',
    franqueado: 'Tudo das lojas dele, inclusive criar gerentes e vendedores.',
    gerente: 'As telas que você marcar (padrão: Vendas, Equipe, Lista de espera, Validade e ⭐ Sugestões; sem Clientes e sem custos).',
    vendedor: 'Fixas: Minha comissão, Lista de espera, Validade, Inventário, ⭐ Sugestões e Checklist. Nunca custo nem dados de clientes (exceto a Lista de espera).',
  };
  let est = null;          // último /api/admin/estado
  let timer = null;
  let raiz = null;
  const abertos = new Set(); // formulários abertos (sobrevivem à atualização)
  const cadastroRes = new Map(); // loja → resultado do último envio de cadastro (sobrevive à atualização da tela)
  /** <details> que continua aberto quando a tela se atualiza sozinha */
  const detalhes = (chave, attrs, ...filhos) => {
    const d = h('details', { ...attrs, open: abertos.has(chave) || null }, ...filhos);
    d.addEventListener('toggle', () => { d.open ? abertos.add(chave) : abertos.delete(chave); });
    return d;
  };

  async function api(metodo, url, corpo, extras = {}) {
    const raw = corpo instanceof Blob || corpo instanceof ArrayBuffer;
    const res = await fetch('/api/admin' + url, {
      method: metodo, credentials: 'same-origin',
      headers: { 'X-Painel': '1', ...(corpo && !raw ? { 'Content-Type': 'application/json' } : {}), ...extras },
      body: corpo == null ? undefined : raw ? corpo : JSON.stringify(corpo),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.erro || `Erro ${res.status}`); e.dados = j; throw e; }
    return j;
  }
  function toast(msg, erro) {
    document.querySelectorAll('.toast').forEach((x) => x.remove());
    const t = h('div', { class: 'toast' + (erro ? ' err' : ''), role: 'status' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), erro ? 7000 : 4000);
  }
  /** botão que mostra "…" enquanto a ação roda */
  function acao(rotulo, fn, cls = 'btn') {
    const b = h('button', { type: 'button', class: cls }, rotulo);
    b.addEventListener('click', async () => {
      b.disabled = true; const txt = b.textContent; b.textContent = '…';
      try { const msg = await fn(); if (msg) toast(TS.demo ? TS.DEMO_AVISO : msg); await carregar(); } catch (e) { toast(e.message, true); } finally { b.disabled = false; b.textContent = txt; }
    });
    return b;
  }
  const dt = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  const dIso = (iso) => (iso ? fmt.date(iso) : '—');
  const ymLongo = (ym) => `${TS.MESES_LONGOS[+ym.slice(5, 7) - 1]}/${ym.slice(0, 4)}`;
  const campo = (rotulo, el, dica) => h('label', { class: 'cfg-campo' }, h('span', null, rotulo), el, dica ? h('small', null, dica) : null);
  const inp = (attrs) => h('input', { class: 'f-input', ...attrs });

  // a configuração guiada salvou algum acesso: a tela mostra o que mudou
  document.addEventListener('ts-guia', () => { if (state.page === 'config' && raiz && raiz.isConnected) carregar(); });
  let sujo = false; // há campo editado e não salvo: a atualização automática não redesenha a tela
  async function carregar(auto) {
    try { est = await api('GET', '/estado'); } catch (e) { if (auto) return; est = { erro: e.message }; }
    if (!auto && TS.guia && !est.erro && (est.perfil === 'admin' || est.perfil === 'franqueado')) await TS.guia.carregar(); // o que falta configurar em cada loja
    if (state.page === 'config' && raiz && raiz.isConnected && !(auto && sujo)) pintar();
    clearTimeout(timer);
    const ocupado = est.lojas && est.lojas.some((l) => l.status && ((l.status.execucao && ['rodando', 'na_fila'].includes(l.status.execucao.estado)) || (l.status.saldos && ['rodando', 'na_fila'].includes(l.status.saldos.estado))));
    timer = setTimeout(() => { if (state.page === 'config' && raiz && raiz.isConnected) carregar(true); }, ocupado ? 5000 : 60000);
  }

  TS.pages.config = function (root) {
    raiz = root;
    if (!root._sujoLigado) {
      root._sujoLigado = true;
      root.addEventListener('input', () => { sujo = true; });
      root.addEventListener('change', (e) => { if (e.target.matches('input,select')) sujo = true; });
    }
    if (!est) { root.append(h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('p', null, 'Carregando configurações…'))); carregar(); return; }
    pintar();
    carregar();
  };

  TS.cfgRepintar = () => pintar();
  /** abre Configurações → Lojas → (loja) → Inteligência artificial */
  TS.cfgIrIA = (lojaId) => {
    if (!lojaId || lojaId === 'todas') lojaId = (TS.lojas || [])[0] && TS.lojas[0].id;
    state.cfgAba = 'lojas'; abertos.add('loja:' + lojaId); secaoLoja.set(lojaId, 'ia');
    try { sessionStorage.setItem('cfgSecao', JSON.stringify([...secaoLoja])); } catch { /* ok */ }
    if (location.hash === '#config' && raiz && raiz.isConnected) pintar(); else location.hash = '#config';
  }; // a mesma repintura da atualização automática (usada nos testes)
  function pintar() {
    // monta a tela nova fora da página e troca de uma vez: a página não encolhe no meio e a rolagem fica onde estava
    // (a atualização automática a cada 5 s não leva mais para o início); os logs abertos mantêm a própria rolagem
    const root = h('div');
    sujo = false;
    const scroll = window.scrollY;
    const rolLogs = [...raiz.querySelectorAll('.cfg-log')].map((d) => { const el = d.querySelector('.cfg-log-txt, pre, .log-bonito') || d; return [d.dataset.chave || '', el.scrollTop, el.scrollHeight - el.clientHeight - el.scrollTop < 4]; });
    const fim = () => {
      raiz.replaceChildren(...root.childNodes);
      [...raiz.querySelectorAll('.cfg-log')].forEach((d, i) => { const r = rolLogs[i]; const el = d.querySelector('.cfg-log-txt, pre, .log-bonito') || d; if (r) el.scrollTop = r[2] ? el.scrollHeight : r[1]; });
      window.scrollTo({ top: scroll, behavior: 'instant' });
    };
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Configurações'),
      h('div', { class: 'page-sub' }, est.perfil === 'admin' ? 'Lojas, acesso ao AppNext, metas, usuários e horários' : 'Metas, planilhas e usuários das suas lojas')),
      // atalho de fácil acesso: os 4 acessos da loja, um passo de cada vez (abre na loja escolhida no topo ou na primeira com algo faltando)
      TS.guia && !est.erro && (est.perfil === 'admin' || est.perfil === 'franqueado') && (est.lojas || []).length ? h('button', { type: 'button', class: 'btn cfg-guia-btn', title: 'Abre a configuração guiada: AppNext, Sistema de Pedidos, FIXE e o Gmail da loja, um passo de cada vez, com a explicação de cada campo. Dá para terminar o que ficou para depois ou editar o que já está salvo.',
        onclick: () => { const ab = est.lojas.find((l) => abertos.has('loja:' + l.id)), falta = est.lojas.find((l) => { const s = TS.guia.situacao(l.id); return s && Object.values(s.passos).some((v) => !v); }); TS.guia.abrir((ab || est.lojas.find((l) => l.id === state.loja) || falta || est.lojas[0]).id); } }, 'Configuração guiada') : null));
    if (est.erro) { root.append(h('div', { class: 'notice err' }, est.erro)); fim(); return; }
    const abas = [['Lojas', 'lojas'], ['Usuários', 'usuarios']];
    if (est.perfil === 'admin' || est.perfil === 'franqueado') abas.push(['Atualização automática', 'coletor'], ['Resumo diário', 'resumo']); // o franqueado vê a parte das lojas dele
    if (est.perfil === 'admin' || est.perfil === 'franqueado') abas.push(['Erros nas telas', 'erros', 'Erros de JavaScript que aconteceram nas telas de quem usa o painel (sem dado pessoal). O franqueado vê só os das lojas dele.']);
    abas.push(['Histórico de alterações', 'historico']);
    state.cfgAba = abas.some(([, v]) => v === state.cfgAba) ? state.cfgAba : 'lojas';
    root.append(h('div', { class: 'cfg-abas' }, TS.seg(abas, state.cfgAba, (v) => { state.cfgAba = v; pintar(); })));
    const corpo = h('div', { class: 'cfg-corpo' });
    root.append(corpo);
    ({ lojas: abaLojas, usuarios: abaUsuarios, coletor: abaColetor, resumo: abaResumo, erros: abaErros, historico: abaHistorico })[state.cfgAba](corpo);
    fim();
  }

  // ======================= LOJAS =======================
  function abaLojas(box) {
    const lojaAberta = est.lojas.length > 1 && est.lojas.some((l) => abertos.has('loja:' + l.id));
    // 2ª passada: "+ Nova loja" fica no cabeçalho do cartão das lojas (como "+ Novo usuário"); sem loja nenhuma, fica solto em cima
    let btNova = null;
    if (est.perfil === 'admin' && !lojaAberta) {
      const aberto = abertos.has('nova');
      btNova = h('button', { type: 'button', class: 'btn primary', onclick: () => { aberto ? abertos.delete('nova') : abertos.add('nova'); pintar(); } }, aberto ? 'Fechar' : '+ Nova loja');
      if (!est.lojas.length) box.append(h('div', { class: 'cfg-barra' }, btNova));
      if (aberto) box.append(formNovaLoja());
    }
    if (!est.lojas.length) { box.append(h('div', { class: 'card' }, TS.empty('Nenhuma loja cadastrada ainda.'))); return; }
    // uma loja aberta por vez: o detalhe dela no lugar da lista (com "‹ Lojas" para voltar); com uma loja só, vai direto
    const aberta = est.lojas.length === 1 ? est.lojas[0] : est.lojas.find((l) => abertos.has('loja:' + l.id));
    if (aberta) {
      if (btNova) box.prepend(h('div', { class: 'cfg-barra' }, btNova)); // loja única aberta direto: o botão fica em cima, como antes
      if (est.lojas.length > 1) box.append(h('div', { class: 'cfg-voltar' }, h('button', { type: 'button', class: 'btn', onclick: () => { for (const k of [...abertos]) if (k.startsWith('loja:')) abertos.delete(k); pintar(); } }, '‹ Lojas')));
      box.append(cartaoLoja(aberta));
      return;
    }
    box.append(tabelaLojas(btNova));
  }
  /** todas as lojas numa tabela (padrão do painel): situação dos dados de cada uma; tocar abre a loja */
  function tabelaLojas(btNova) {
    const abrir = (l) => { for (const k of [...abertos]) if (k.startsWith('loja:')) abertos.delete(k); abertos.add('loja:' + l.id); pintar(); window.scrollTo(0, 0); };
    const ORD_SIT = { erro: 0, espera: 1, rodando: 2, ok: 3 };
    const linhas = est.lojas.map((l) => ({ ...l, _info: infoItens(l, l.base.importacoes[0]), _sit: situacao(l) }));
    // na tabela o nome do item já está no cabeçalho da coluna: a célula leva só o ponto colorido e a data
    const cel = (k) => (r) => { if (!r._info[k]) return h('span', { class: 'muted' }, '—'); const c = r._info[k].cloneNode(true); c.querySelector('b')?.remove(); return c; };
    const cols = [
      { key: 'nome', label: 'Loja', align: 'l', sticky: true, wrap: true, render: (r) => h('div', null, h('b', null, r.nome), h('small', { class: 'muted cfg-loja-sub2' }, `${r.id}${r.appnext ? ' · ' + r.appnext : ''}`)) },
      { key: 'vendas', label: 'Vendas', align: 'l', title: 'Período das vendas no painel. Verde = em dia; amarelo = sem vendas novas há mais de 2 dias; cinza = sem dados.', render: cel('Vendas'), sortVal: (r) => (r.base && r.base.ultimaVenda) || '' },
      { key: 'xml', label: 'XML', align: 'l', title: 'Notas com CPF/CNPJ (XML dos cupons) importadas. Amarelo = mais de 7 dias atrás das vendas.', render: cel('XML'), sortVal: (r) => (r.xml && r.xml.ate) || '' },
      { key: 'estoque', label: 'Estoque', align: 'l', title: 'Última planilha de estoque e custos do AppNext. Amarelo = mais de 2 dias.', render: cel('Estoque'), sortVal: (r) => (r.estoque && r.estoque.em) || '' },
      est.lojas.some((l) => { const fx = l.fixe || {}; return fx.url || fx.ultimo || fx.logs; }) ? { key: 'fixe', label: 'FIXE', align: 'l', title: 'Cadastro de clientes e pontos (FIXE): última importação.', render: cel('FIXE'), sortVal: () => 0 } : null,
      { key: 'sit', label: 'Situação', align: 'l', render: (r) => h('span', { class: 'badge ' + r._sit[0] }, r._sit[1]), sortVal: (r) => ORD_SIT[r._sit[0]] ?? 9 },
      { key: 'acoes', label: '', align: 'l', render: (r) => h('button', { type: 'button', class: 'btn cfg-abrir', onclick: (e) => { e.stopPropagation(); abrir(r); } }, 'Abrir ›'), sortVal: () => 0 },
    ].filter(Boolean);
    const tab = TS.table({ cols, rows: linhas, sortKey: 'sit', sortDir: 'asc', search: 'Buscar loja…', searchKeys: ['nome', 'id', 'appnext'], cls: 'cfg-lojas-t', onRowClick: abrir,
      empty: 'Nenhuma loja com esse nome.' });
    const nErro = linhas.filter((r) => r._sit[0] === 'erro').length;
    const sub = `${fmt.int(linhas.length)} lojas${nErro ? ` · ${fmt.int(nErro)} com problema na atualização` : ' · todas em dia'}. Toque numa loja para ver os dados, metas, equipe, integrações e mensagens dela.`;
    return btNova ? TS.cardWithTools('Lojas', sub, btNova, tab) : TS.card('Lojas', sub, tab);
  }

  function formNovaLoja() {
    const nome = inp({ placeholder: 'Ex.: Tea Shop Campinas' });
    const id = inp({ placeholder: 'gerado do nome', maxlength: 40 });
    const appnext = inp({ placeholder: 'Ex.: CAMPINAS - TEA SHOP CAMBUÍ' });
    const meta = inp({ type: 'number', min: 0, step: 500, placeholder: 'Ex.: 60000' });
    nome.addEventListener('input', () => { id.placeholder = TS.norm(nome.value).replace(/^tea\s*shop\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'gerado do nome'; });
    return h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Nova loja'),
      h('div', { class: 'cfg-grid' },
        campo('Nome da loja', nome),
        campo('Identificador', id, 'Usado nos endereços e pastas. Não muda depois.'),
        campo('Nome da loja no AppNext', appnext, 'Exatamente como aparece na coluna "Loja" do relatório.'),
        campo('Meta mensal padrão (R$)', meta)),
      h('div', { class: 'cfg-acoes' }, acao('Criar loja', async () => {
        const r = await api('POST', '/lojas', { nome: nome.value, id: id.value || undefined, appnext: appnext.value, meta: meta.value });
        abertos.delete('nova'); abertos.add('loja:' + r.id);
        return 'Loja criada. Agora cadastre o acesso ao AppNext dela.';
      }, 'btn primary')));
  }

  function situacao(l) {
    const ex = l.status && l.status.execucao;
    if (ex && ex.estado === 'rodando') return ['rodando', 'Coletando agora…'];
    if (ex && ex.estado === 'na_fila') return ['rodando', 'Na fila'];
    if (l.fixe && l.fixe.pedido) return ['rodando', 'Atualizando o FIXE…'];
    if (!l.base.existe || !l.base.linhas) return l.coletor.configurado ? ['espera', 'Aguardando a 1ª coleta'] : ['espera', 'Sem dados'];
    if (ex && ex.estado === 'falhou') return ['erro', 'Última coleta falhou'];
    const dias = l.base.ultimaVenda ? Math.floor((Date.now() - new Date(l.base.ultimaVenda + 'T12:00:00').getTime()) / 86400e3) : null;
    if (dias != null && dias > 2) return ['erro', `Sem vendas novas desde ${dIso(l.base.ultimaVenda)}`];
    if (!l.coletor.configurado) return ['espera', 'Sem atualização automática'];
    return ['ok', 'Em dia'];
  }

  // aba aberta de cada loja (lembrada enquanto a aba do navegador estiver aberta)
  const secaoLoja = (() => { try { return new Map(JSON.parse(sessionStorage.getItem('cfgSecao') || '[]')); } catch { return new Map(); } })();
  /** atalho de outras telas: abre Configurações já na loja e na aba certa (e rola até um trecho, se pedido) */
  TS.abrirCfg = function (lojaId, secao, ancora) {
    abertos.add('loja:' + lojaId);
    if (secao) { secaoLoja.set(lojaId, secao); try { sessionStorage.setItem('cfgSecao', JSON.stringify([...secaoLoja])); } catch { /* ok */ } }
    TS.cfgAncora = ancora || null;
    location.hash = '#config';
  };
  /** cabeçalho da loja: até quando estão vendas, XML e estoque (verde em dia, amarelo atrasado, cinza sem dados) */
  function infoCabecalho(l, ult) { return h('div', { class: 'cfg-loja-info' }, ...Object.values(infoItens(l, ult))); }
  /** os mesmos itens separados ({ Vendas, XML, Estoque, FIXE }): colunas da tabela de lojas */
  function infoItens(l, ult) {
    const DIA = 86400e3, hoje = Date.now();
    const diasDesde = (iso) => (iso ? Math.floor((hoje - new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).getTime()) / DIA) : null);
    const curto = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '');
    const item = (rot, st, txt, dica) => h('span', { class: 'cfg-per', title: dica || null, 'data-rot': rot }, h('i', { class: 'cfg-per-p ' + st }), h('b', null, rot), ' ', txt);
    const out = [];
    // vendas
    if (l.base.linhas) {
      const d = diasDesde(l.base.ultimaVenda);
      out.push(item('Vendas', d != null && d > 2 ? 'atr' : 'ok', `${curto(l.base.de + '-01')} a ${curto(l.base.ultimaVenda)}`,
        `${fmt.int(l.base.linhas)} vendas de ${ymLongo(l.base.de)} a ${dIso(l.base.ultimaVenda)}${ult ? ` · atualizado ${dt(ult.em)}` : ''}${d != null && d > 2 ? ` · sem vendas novas há ${d} dias` : ''}`));
    } else out.push(item('Vendas', 'nada', 'sem dados'));
    // XML (CPF dos cupons)
    const x = l.xml;
    if (x && x.existe) {
      const atras = l.base.ultimaVenda && x.ate ? Math.round((new Date(l.base.ultimaVenda) - new Date(x.ate)) / DIA) : null;
      out.push(item('XML', atras != null && atras > 7 ? 'atr' : 'ok', `${curto(x.de)} a ${curto(x.ate)}`,
        `${fmt.int(x.notas)} notas com CPF/CNPJ; XML importado de ${dIso(x.de)} a ${dIso(x.ate)}${x.ultimaComDoc && x.ultimaComDoc < x.ate ? ` (última nota com CPF/CNPJ em ${dIso(x.ultimaComDoc)})` : ''}${atras != null && atras > 7 ? ` · ${atras} dias atrás das vendas: rode "Importar histórico" com "Só XML"` : ''}`));
    } else if (x) out.push(item('XML', 'nada', 'não importado', 'Use "Importar histórico" com "Só XML" de 06/2025 até hoje'));
    // estoque (foto)
    if (l.estoque) {
      const d = diasDesde(l.estoque.em);
      out.push(item('Estoque', d != null && d > 2 ? 'atr' : 'ok', dt(l.estoque.em), `${fmt.int(l.estoque.itens)} produtos${d != null && d > 2 ? ` · foto de ${d} dias atrás` : ''}`));
    } else out.push(item('Estoque', 'nada', 'não importado', 'Use "Importar histórico" → "Estoque e custos" ou "Rodar agora"'));
    // FIXE (cadastro e pontos): data da última importação que deu certo; aguardando o e-mail = azul
    const fx = l.fixe || {};
    if (fx.url || fx.ultimo || fx.logs) {
      const u = fx.ultimo && fx.ultimo.ok ? fx.ultimo : null;
      const em = [u && u.em, fx.logs && fx.logs.em].filter(Boolean).sort().pop() || null;
      const d = diasDesde(em);
      if (fx.pedido) out.push(item('FIXE', 'rod', 'aguardando e-mail', `Pedido feito em ${dt(fx.pedido.em)}${em ? ` · última importação ${dt(em)}` : ''}`));
      else if (fx.ultimo && !fx.ultimo.ok) out.push(item('FIXE', 'atr', em ? dt(em) : 'falhou', `A última importação falhou: ${fx.ultimo.erro || ''}`));
      else if (em) out.push(item('FIXE', d != null && d > 2 ? 'atr' : 'ok', dt(em), `Base de leads ${u ? dt(u.em) : '—'} · Logs ${fx.logs && fx.logs.em ? dt(fx.logs.em) : '—'}${d != null && d > 2 ? ` · ${d} dias sem atualizar` : ''}`));
      else out.push(item('FIXE', 'nada', 'não importado', 'Vem na atualização da noite ou em "Atualizar agora" com FIXE marcado'));
    }
    return Object.fromEntries(out.map((el) => [el.dataset.rot, el]));
  }
  function cartaoLoja(l) {
    const chave = 'loja:' + l.id;
    const aberto = abertos.has(chave) || est.lojas.length === 1;
    const [cls, txt] = situacao(l);
    const ult = l.base.importacoes[0];
    // situação da loja como pílula (linguagem do redesenho): em dia = verde, rodando/esperando = amarelo, problema = vermelho
    const sitPil = TS.pilulaSit ? TS.pilulaSit(cls === 'ok' ? 'ok' : cls === 'erro' ? 'err' : 'warn', txt) : h('span', { class: 'badge ' + cls }, txt);
    const cab = h('button', { type: 'button', class: 'cfg-loja-cab', 'aria-expanded': String(aberto), onclick: () => { aberto ? abertos.delete(chave) : abertos.add(chave); pintar(); } },
      h('div', null, h('div', { class: 'cfg-loja-nome' }, l.nome), h('div', { class: 'cfg-loja-sub' }, `${l.id}${l.appnext ? ' · ' + l.appnext : ''}`)),
      infoCabecalho(l, ult),
      sitPil, h('span', { class: 'cfg-seta', 'aria-hidden': 'true' }, aberto ? '▴' : '▾'));
    // aberta: sem moldura de cartão por fora (cada assunto já é um cartão: nada de caixa dentro de caixa)
    const card = h('div', { class: 'card cfg-loja' + (aberto ? ' cfg-loja-aberta' : '') }, cab);
    if (!aberto) return card;
    // seções da loja em abas (mesmo submenu do Estoque e Margem); só monta os blocos da aba aberta
    const admin = est.perfil === 'admin', gestor = admin || est.perfil === 'franqueado';
    const SECOES = [
      ['dados', 'Dados e atualização', 'Situação dos dados, coleta automática e envio de planilhas', () => [blocoDados(l), blocoHorarios(l), blocoPlanilhas(l)]],
      ['metas', 'Metas e comissão', 'Meta do mês, regras de comissão e férias da equipe', () => [blocoMetas(l), blocoFerias(l), gestor ? blocoRegras(l) : null]],
      ['loja', 'Loja e equipe', 'Horário de funcionamento, equipe, logo e dados da loja', () => [blocoOperacao(l), blocoMarca(l), gestor ? blocoEditar(l) : null]],
      gestor && TS.blocoEstoqueCfg ? ['estoque', 'Estoque e margem', 'Impostos, maquininha, custos da loja por categoria, reposição e embalagens', () => [TS.blocoEstoqueCfg(l.id)]] : null,
      ['integracoes', 'Integrações', 'AppNext, Sistema de Pedidos, FIXE e e-mail das devoluções', () => [gestor && TS.guia ? TS.guia.bloco(l.id) : null, gestor ? blocoAppNext(l) : null, gestor && TS.blocoPedidoAcesso ? TS.blocoPedidoAcesso(l.id) : null, blocoFixe(l), blocoDevolucao(l), gestor ? blocoNfeCfop(l) : null]],
      gestor && TS.blocoIA ? ['ia', 'Inteligência artificial', 'Chave da Anthropic desta loja, teto e uso do mês', () => [TS.blocoIA(l.id)]] : null,
      ['avisos', 'Mensagens', 'Fechamento do dia por e-mail, mensagens de WhatsApp, robô do WhatsApp e cobrança à franquia', () => [blocoFechamento(l), blocoWpp(l), gestor && TS.blocoZap ? TS.blocoZap(l.id) : null, gestor ? blocoCobranca(l) : null]],
    ].filter(Boolean);
    const atual = SECOES.some((x) => x[0] === secaoLoja.get(l.id)) ? secaoLoja.get(l.id) : SECOES[0][0];
    const sec = SECOES.find((x) => x[0] === atual);
    const nav = h('nav', { class: 'submenu cfg-sub', 'aria-label': 'Seções da loja' },
      SECOES.map(([id, rot]) => h('a', { href: '#config', class: id === atual ? 'on' : null, 'aria-current': id === atual ? 'page' : null,
        onclick: (e) => { e.preventDefault(); secaoLoja.set(l.id, id); try { sessionStorage.setItem('cfgSecao', JSON.stringify([...secaoLoja])); } catch { /* ok */ } pintar(); } }, rot)));
    const grid = h('div', { class: 'cfg-loja-corpo' }, ...sec[3]().filter(Boolean));
    enxugar(grid);
    // ajustes: menu das seções na lateral (no celular, em cima) e o conteúdo numa coluna, um cartão por assunto
    nav.classList.add('cfg-sub-v');
    card.append(h('div', { class: 'cfg-loja-layout' }, h('div', { class: 'cfg-loja-nav' }, nav),
      h('div', { class: 'cfg-loja-main' }, h('p', { class: 'cfg-sec-cab muted' }, sec[2]), grid)));
    return card;
  }

  /**
   * Deixa a seção enxuta (padrão minimalista): a ajuda longa embaixo de cada campo vira ⓘ ao lado do nome;
   * parágrafos e avisos de explicação além do primeiro vão para "Como funciona ▸" recolhido.
   */
  function enxugar(raiz) {
    for (const b of raiz.querySelectorAll('.cfg-bloco')) {
      for (const c of b.querySelectorAll('label.cfg-campo, div.cfg-campo')) {
        const sm = [...c.children].find((x) => x.tagName === 'SMALL' && !x.className && !x.children.length);
        const rot = [...c.children].find((x) => x.tagName === 'SPAN');
        const t = sm && sm.textContent.trim();
        if (!t || t.length < 40 || !rot || !TS.dica) continue;
        rot.append(' ', TS.dica(t)); sm.remove();
      }
      const ps = [...b.children].filter((x) => (x.tagName === 'P' && !x.querySelector('input, select, button, textarea')) || (x.classList.contains('notice') && !x.classList.contains('err')));
      const extras = ps.slice(1).filter((x) => x.textContent.trim().length > 60);
      if (extras.length) {
        const det = h('details', { class: 'cfg-mais' }, h('summary', null, 'Como funciona'));
        extras[0].before(det);
        for (const x of extras) det.append(x);
      }
    }
  }
  /** linha de situação (ícone + título + detalhes), o mesmo padrão em todo o painel */
  const linhaSit = (st, titulo, principal, ...extra) => h('div', { class: 'cfg-sit-l' },
    h('span', { class: 'cfg-sit-ic ' + st }, { ok: '✓', erro: '!', rodando: '…', nada: '–' }[st]),
    h('div', null, h('div', { class: 'cfg-sit-t' }, h('b', null, titulo), principal ? h('span', null, ' · ', principal) : null), ...extra.filter(Boolean).map((x) => h('div', { class: 'cfg-sit-d' }, x))));
  /** situação do cadastro de clientes pelo FIXE */
  function sitFixe(l) {
    const fx = l.fixe || {};
    const exF = l.status && l.status.execucao && l.status.execucao.fixe;
    const u = fx.ultimo;
    if (fx.pedido) {
      // são dois e-mails do FIXE: Base de leads (cadastro e saldo) e Logs (movimentos de pontos)
      const tipos = Array.isArray(fx.pedido.tipos) && fx.pedido.tipos.length ? fx.pedido.tipos : ['leads'];
      const feitos = fx.pedido.feitos || {};
      const NOME = { leads: 'Base de leads (cadastro e saldo de pontos)', logs: 'Logs (movimentos de pontos)' };
      const falta = tipos.filter((t) => !feitos[t]);
      return linhaSit('rodando', 'Cadastro de clientes (FIXE)', falta.length === tipos.length ? `aguardando ${tipos.length === 1 ? 'o e-mail' : `os ${tipos.length} e-mails`} do FIXE` : `chegou ${tipos.length - falta.length} de ${tipos.length} e-mails`,
        h('ul', { class: 'cfg-fx-emails' }, ...tipos.map((t) => h('li', { class: feitos[t] ? 'ok' : 'espera' }, feitos[t] ? '✓ ' : '… ', NOME[t] || t, feitos[t] ? ` · chegou ${dt(feitos[t].recebido)}${feitos[t].doSpam ? ' (estava no spam)' : ''}` : ' · aguardando',
          fx.pedido.respostas && fx.pedido.respostas[t] ? h('small', { class: 'muted' }, ` — o FIXE mostrou: "${fx.pedido.respostas[t]}"`) : null))),
        fx.pedido.email ? `Exportação pedida pelo robô para ${fx.pedido.email}.` : null,
        `Pedido feito em ${dt(fx.pedido.em)}. O painel olha o Gmail da loja a cada 2 minutos, inclusive no spam; se não chegar em 3 horas, avisa aqui.`,
        // enquanto espera, o que está valendo no painel
        u && u.ok ? `Última atualização que deu certo: Base de leads em ${dt(u.em)}${fx.logs && fx.logs.em ? ` · Logs em ${dt(fx.logs.em)}` : ''}.` : fx.logs && fx.logs.em ? `Logs importados em ${dt(fx.logs.em)}.` : null);
    }
    if (exF && !exF.ok && (!u || (l.status.execucao.fim && l.status.execucao.fim > u.em))) return linhaSit('erro', 'Cadastro de clientes (FIXE)', h('span', { class: 'neg' }, 'o pedido no FIXE falhou'), 'O coletor não conseguiu pedir a exportação no FIXE. Veja o motivo no log técnico de "Dados e atualização".', u && u.ok ? `Última importação que deu certo: ${dt(u.em)}` : null);
    if (u && !u.ok) return linhaSit('erro', 'Cadastro de clientes (FIXE)', h('span', { class: 'neg' }, 'a última importação falhou'), `${dt(u.em)} · ${u.erro}`);
    if (u && u.ok) {
      const r = u.resultado || {};
      return linhaSit('ok', 'Cadastro de clientes (FIXE)', 'em dia', `Importado em ${dt(u.em)}${u.recebido ? ` (e-mail recebido ${dt(u.recebido)}${u.doSpam ? ', estava no spam e foi movido para a caixa de entrada' : ''})` : ''}`,
        `${fmt.int(r.noArquivo || 0)} clientes no arquivo · ${fmt.int(r.novos || 0)} novos · ${fmt.int(r.atualizados || 0)} atualizados · ${fmt.int(r.total || 0)} no cadastro`);
    }
    return fx.url ? linhaSit('nada', 'Cadastro de clientes (FIXE)', 'ainda não importado', 'A primeira importação acontece na atualização da noite (ou em "Importar agora").') : null;
  }
  /** movimentos do programa de fidelidade (exportação "Logs" do FIXE) */
  function sitLogs(l) {
    const fx = l.fixe || {};
    const g = fx.logs;
    if (g) return linhaSit('ok', 'Fidelidade (Logs do FIXE)', 'em dia', `Importado em ${dt(g.em)}`,
      `${fmt.int(g.movimentos || 0)} movimentos · ${fmt.int(g.clientes || 0)} clientes · ${fmt.int(g.compras || 0)} compras · ${fmt.int(g.resgates || 0)} resgates · ${fmt.int(g.expirados || 0)} expirações`);
    return fx.url ? linhaSit('nada', 'Fidelidade (Logs do FIXE)', 'ainda não importado', 'Vem junto com o cadastro, na atualização da noite. Também dá para enviar a planilha de Logs em "Enviar planilha" → Cadastro de clientes.') : null;
  }

  /** botão "Sincronizar saldos com o FIXE" (admin ou franqueado da loja); some enquanto a sincronização está na fila ou rodando */
  function botaoSaldos(l) {
    const fx = l.fixe || {}, st = (l.status && l.status.saldos) || {};
    if (!((est.perfil === 'admin' || est.perfil === 'franqueado') && est.coletorAtivo && fx.url && fx.temSenha) || ['na_fila', 'rodando'].includes(st.estado)) return null;
    return acao('Sincronizar saldos com o FIXE', async () => {
      if (!confirm('O robô entra no FIXE e lê o saldo de pontos de cada cliente (só leitura, não muda nada no FIXE). Esse saldo passa a ser o ponto de partida; depois, os Logs de todo dia atualizam. Continuar?')) return null;
      await api('POST', `/lojas/${l.id}/fixe/saldos`);
      return 'Sincronização pedida. Acompanhe em "Saldos de pontos (FIXE)": a situação e o log atualizam sozinhos.';
    });
  }
  /** saldo oficial de pontos lido no FIXE (botão "Sincronizar saldos com o FIXE"): situação + log, ao vivo enquanto roda */
  function sitSaldos(l, comLog = true) {
    const fx = l.fixe || {}, sd = fx.saldos;
    const st = (l.status && l.status.saldos) || {}, u = st.ultima;
    const ex = l.status && l.status.execucao;
    const T = 'Saldos de pontos (FIXE)';
    const log = (linhas, chave, rot) => (comLog && linhas && linhas.length ? detalhes(chave + l.id, { class: 'cfg-log' }, h('summary', null, rot), logBonito(linhas)) : null);
    const ha = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? 'agora há pouco' : `há ${m} min`; };
    if (st.estado === 'na_fila') {
      const espera = ex && ['rodando', 'na_fila'].includes(ex.estado);
      return linhaSit('rodando', T, 'na fila', `Pedido ${dt(st.criado)}${st.por ? ` por ${st.por}` : ''}.`,
        espera ? 'Esperando a coleta que está em andamento terminar a parte atual; a sincronização roda logo depois (passa na frente das próximas partes do histórico).' : 'Começa em instantes.');
    }
    if (st.estado === 'rodando') {
      const av = st.aoVivo || [], ult = av.length ? av[av.length - 1].replace(/^\[[\d:]+\]\s*/, '') : null;
      return linhaSit('rodando', T, 'sincronizando agora', `Começou ${dt(st.inicio)}. Leva um ou dois minutos.`,
        ult ? h('span', { class: 'cfg-ao-vivo' }, h('i', { class: 'cfg-pulso' }), ult) : null, log(av, 'sdvivo:', 'Ver o log ao vivo'));
    }
    if (u && !u.ok && (!sd || u.fim > sd.em)) {
      return linhaSit('erro', T, h('span', { class: 'neg' }, 'a última sincronização falhou'), `${dt(u.fim)}${u.por ? ` · ${u.por}` : ''} · ${u.codigo === 'timeout' ? 'passou do tempo máximo' : 'veja o motivo no log'}`,
        sd ? `Continua valendo a sincronização de ${dt(sd.em)}.` : 'Enquanto isso, o saldo segue calculado só pelos Logs.', log(u.log, 'sdlog:', 'Log da sincronização'));
    }
    if (sd) {
      return linhaSit('ok', T, `sincronizados ${ha(sd.em) === 'agora há pouco' ? 'agora há pouco' : 'em ' + dt(sd.em)}`, `${fmt.int(sd.comPontos)} clientes com pontos (de ${fmt.int(sd.clientes)} na base)${u && u.duracao_s != null ? ` · levou ${u.duracao_s} s` : ''}. Depois disso, o saldo de cada cliente segue pelos Logs de todo dia.`,
        u && u.log ? log(u.log, 'sdlog:', 'Log da sincronização') : null);
    }
    return fx.url ? linhaSit('nada', T, 'ainda não sincronizados', 'Os Logs não detalham os pontos de compras antigas; sem sincronizar, o saldo de alguns clientes fica menor que o do FIXE.') : null;
  }

  // ---- horários da atualização automática desta loja (os da rede ou próprios)
  function blocoHorarios(l) {
    if (!est.coletorAtivo || !l.horarios) return null;
    const hz = l.horarios, pode = est.perfil === 'admin' || est.perfil === 'franqueado';
    const b = h('section', { class: 'cfg-bloco' }, h('h3', null, 'Horários da atualização automática'));
    const resumo = (sem) => [1, 2, 3, 4, 5, 6, 0].map((n) => `${NOMES_DIA[n].slice(0, 3)}: ${(sem[String(n)] || []).join(', ') || '—'}`).join(' · ');
    b.append(h('p', { class: 'muted' }, hz.propria ? 'Esta loja tem horários próprios.' : 'Esta loja segue os horários da rede.',
      ' Dia sem horário = sem atualização automática (ex.: loja fechada no domingo). A última do dia pede o FIXE e o catálogo de pedidos e dispara o e-mail do fechamento.'));
    if (!pode) { b.append(h('p', null, resumo(hz.semana))); return b; }
    const propria = h('input', { type: 'checkbox', checked: hz.propria || null });
    const ed = editorSemana(hz.semana);
    const caixa = h('div', { hidden: !hz.propria || null }, ed.el);
    const daRede = h('p', { class: 'muted', hidden: hz.propria || null }, 'Horários da rede: ', resumo(est.agenda || {}));
    propria.addEventListener('change', () => { caixa.hidden = !propria.checked; daRede.hidden = propria.checked; });
    b.append(h('label', { class: 'cfg-check-l' }, propria, ' Usar horários próprios nesta loja'), daRede, caixa,
      h('div', { class: 'cfg-acoes' }, acao('Salvar horários', async () => {
        if (!propria.checked) { await api('PUT', `/lojas/${l.id}/horarios`, { propria: false }); return 'Pronto: a loja segue os horários da rede.'; }
        await api('PUT', `/lojas/${l.id}/horarios`, { semana: ed.valor() }); return 'Horários da loja salvos. Valem a partir do próximo minuto.';
      }, 'btn primary')));
    return b;
  }

  // ---- dados e coleta
  function blocoDados(l) {
    const b = h('section', { class: 'cfg-bloco' }, h('h3', null, 'Dados e atualização'));
    const ex = l.status && l.status.execucao;
    const lote = l.status && l.status.lote;
    if (!est.coletorAtivo) b.append(h('p', { class: 'muted' }, 'O coletor (atualização automática) não está ligado nesta VPS.'));
    else if (!l.coletor.configurado) b.append(h('p', { class: 'muted' }, est.perfil === 'admin' ? 'Cadastre o acesso ao AppNext (ao lado) para a loja atualizar sozinha.' : 'Cadastre o acesso ao AppNext em Integrações para a loja atualizar sozinha.'));
    const ocupado = ex && ['rodando', 'na_fila'].includes(ex.estado);
    const GATILHO = { agendado: 'automática', manual: 'manual', historico: 'do histórico' };
    const quem = (e) => `${GATILHO[e.gatilho] || ''}${e.por && e.gatilho === 'manual' ? ` (${e.por})` : ''}`;
    const periodo = (e) => (e.de && e.ate ? `${dIso(e.de)} a ${dIso(e.ate)}` : '');
    // ---- situação: uma linha por tipo de dado
    const linha = linhaSit;
    const sit = h('div', { class: 'cfg-sit' });
    if (ocupado) {
      const av = ex.estado === 'rodando' ? ex.aoVivo : null;
      const min = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
      const ha = (iso) => { const m = min(iso); return m < 1 ? 'agora há pouco' : `há ${m} min`; };
      const parado = av && av.atividade ? min(av.atividade) : null;
      const ultima = av && av.linhas && av.linhas.length ? av.linhas[av.linhas.length - 1].replace(/^\[[\d:]+\]\s*/, '') : null;
      sit.append(linha('rodando', ex.estado === 'rodando' ? 'Coletando agora' : 'Na fila', `${quem(ex)}${periodo(ex) ? ' · ' + periodo(ex) : ''}`,
        ex.estado === 'rodando' ? `Começou ${dt(ex.inicio)} (${ha(ex.inicio).replace('há ', 'faz ')})` : null,
        av && av.parte ? h('span', null, 'Baixando agora: ', h('b', null, av.parte), av.etapa ? ` · etapa ${av.etapa}` : '') : null,
        ultima ? h('span', { class: 'cfg-ao-vivo' }, h('i', { class: 'cfg-pulso' }), `${ultima} · ${ha(av.atividade)}`) : null,
        parado != null && parado >= 6 ? h('span', { class: 'cfg-travado' }, `Nada de novo no log há ${parado} min. Pode estar esperando o AppNext gerar o relatório (períodos longos demoram) ou travado: cada parte é encerrada sozinha depois de 15 min sem terminar.`) : null));
      if (av && av.linhas && av.linhas.length) b.__aoVivo = detalhes('aovivo:' + l.id, { class: 'cfg-log' }, h('summary', null, 'Ver o log ao vivo'), logBonito(av.linhas));
    }
    // vendas
    const exV = ex && !ocupado && !['xml', 'fixe', 'saldos', 'nada'].includes(ex.tipo) ? ex : null; // coleta sem vendas não diz nada das vendas
    sit.append(linha(exV ? (exV.estado === 'ok' ? 'ok' : 'erro') : l.base.ate ? 'ok' : 'nada', 'Vendas',
      exV ? (exV.estado === 'ok' ? 'última coleta deu certo' : h('span', { class: 'neg' }, 'a última coleta falhou')) : l.base.ate ? null : 'ainda sem vendas',
      exV ? `${dt(exV.fim)} · coleta ${quem(exV)}${periodo(exV) ? ` · ${periodo(exV)}` : ''}` : null,
      l.base.ultimaVenda ? `Vendas no painel até ${dIso(l.base.ultimaVenda)}` : null,
      exV && exV.estado !== 'ok' ? 'As vendas que já estavam no painel continuam valendo. Veja o motivo no log abaixo.' : null));
    // XML
    if (l.xml) {
      const x = l.xml, ui = x.importacoes && x.importacoes[0];
      const falhou = ex && !ocupado && ex.xml && !ex.xml.ok;
      sit.append(linha(falhou ? 'erro' : x.existe ? 'ok' : 'nada', 'XML das notas (CPF dos clientes)',
        falhou ? h('span', { class: 'neg' }, 'falhou na última coleta') : x.existe ? 'em dia' : 'ainda não importado',
        falhou ? `Falhou em ${dt(ex.fim)}. A base de XML que já estava no painel continua valendo.` : null,
        x.existe ? `No painel: ${fmt.int(x.notas)} ${x.notas === 1 ? 'nota' : 'notas'} com CPF/CNPJ, de ${dIso(x.de)} a ${dIso(x.ate)}` : 'Use "Importar histórico" com "Só XML" de 06/2025 até hoje para a primeira carga.',
        ui ? `Última importação que deu certo: ${dt(ui.em)} · ${dIso(ui.de)} a ${dIso(ui.ate)} · ${ui.total == null ? '?' : fmt.int(ui.total)} ${ui.total === 1 ? 'nota' : 'notas'}, ${fmt.int(ui.comDoc)} com CPF/CNPJ` : null,
        (() => { // poucas notas com CPF na última importação, comparado com as anteriores: vale conferir no AppNext
          const ims = (x.importacoes || []).filter((y) => y.total >= 20);
          if (!ui || !(ui.total >= 30) || ims.length < 2) return null;
          const taxa = ui.comDoc / ui.total, ant = ims.slice(1).reduce((a, y) => a + y.comDoc, 0) / Math.max(1, ims.slice(1).reduce((a, y) => a + y.total, 0));
          return ant > 0.05 && taxa < ant / 3 ? h('span', { class: 'neg' }, `Atenção: só ${fmt.pct(taxa, 0)} das notas da última importação têm CPF/CNPJ (antes eram ${fmt.pct(ant, 0)}). Confira no AppNext se o CPF está saindo na nota.`) : null;
        })(),
        x.pendentes ? `${x.pendentes} arquivo(s) de XML sendo processado(s)…` : null,
        x.erros && x.erros.length ? h('span', { class: 'neg' }, `Arquivo(s) com erro: ${x.erros.join(', ')}`) : null));
    }
    // estoque
    const exE = ex && !ocupado && ex.estoque;
    sit.append(linha(exE && !exE.ok ? 'erro' : l.estoque ? 'ok' : 'nada', 'Estoque e custos',
      exE && !exE.ok ? h('span', { class: 'neg' }, 'falhou na última coleta') : l.estoque ? 'em dia' : 'ainda não importado',
      l.estoque ? `Estoque de ${dt(l.estoque.em)} · ${fmt.int(l.estoque.itens)} produtos${l.estoque.origem === 'coletor' ? ' · baixado pelo coletor' : l.estoque.origem ? ' · planilha enviada' : ''}` : 'Vem em cada atualização (automática ou pelo botão) ou pela planilha em "Enviar planilha".'));
    { const f = sitFixe(l); if (f) sit.append(f); }
    { const sd = sitSaldos(l); if (sd) sit.append(sd); }
    if (l.base.pendentes) sit.append(h('div', { class: 'cfg-sit-d muted' }, `${l.base.pendentes} planilha(s) de vendas sendo processada(s)…`));
    b.append(sit);
    if (b.__aoVivo) b.append(b.__aoVivo);
    // ---- importação do histórico (enquanto roda, ou nas 24 h seguintes)
    if (lote && (!lote.fim || Date.now() - new Date(lote.fim).getTime() < 86400e3)) {
      const pct = Math.round((lote.feitas / lote.total) * 100);
      const falhas = lote.falhas || [];
      const estado = lote.cancelado ? 'cancelada' : !lote.fim ? `${lote.feitas} de ${lote.total} partes` : falhas.length ? `terminou com ${falhas.length} parte(s) com erro` : 'concluída sem erros';
      b.append(h('div', { class: 'cfg-lote' + (lote.fim && falhas.length ? ' erro' : '') },
        h('div', null, h('b', null, 'Importação do histórico '), `${dIso(lote.de)} a ${dIso(lote.ate)} · ${estado}`),
        !lote.fim ? h('div', { class: 'cfg-barra-prog' }, h('div', { style: { width: pct + '%' } })) : null,
        falhas.length ? h('div', { class: 'neg' }, `Com erro: ${falhas.map((f) => `${dIso(f.de)} a ${dIso(f.ate)}`).join(', ')}. Rode de novo só esses períodos.`) : null,
        ...falhas.filter((f) => f.log && f.log.length).map((f) => detalhes(`falha:${l.id}:${f.de}`, { class: 'cfg-log' }, h('summary', null, `Por que a parte ${dIso(f.de)} a ${dIso(f.ate)} falhou`), logBonito(f.log)))));
    }
    if (est.coletorAtivo && l.coletor.configurado && (est.perfil === 'admin' || est.perfil === 'franqueado')) { // admin ou franqueado da loja roda o coletor
      const acoes = h('div', { class: 'cfg-acoes' });
      if (ocupado) acoes.append(acao('Cancelar o que está na fila', async () => { await api('POST', `/lojas/${l.id}/cancelar`); return 'Fila cancelada (a parte que já está rodando termina).'; }));
      else acoes.append(acao('Atualizar agora', async () => { await api('POST', `/lojas/${l.id}/rodar`); return 'Atualização na fila. Leva alguns minutos.'; }, 'btn primary'));
      { const bs = botaoSaldos(l); if (bs) acoes.append(bs); }
      b.append(acoes);
      if (!ocupado) b.append(formHistorico(l));
    }
    if (ex && ex.log && ex.log.length && !ocupado) b.append(detalhes('log:' + l.id, { class: 'cfg-log' }, h('summary', null, 'Log técnico da última coleta'), logBonito(ex.log)));
    {
      const c = cartaoHistAtualizacoes(l, () => pintar());
      if (c) b.append(detalhes('imp:' + l.id, { class: 'cfg-imp' }, h('summary', null, 'Histórico das atualizações'), c));
    }
    return b;
  }

  /** histórico das atualizações de uma loja (vendas e XML importados + coletas de estoque, notas, caixa e FIXE, com as falhas):
   *  nas Configurações e na janela que abre ao clicar em "Atualizado" no topo */
  function cartaoHistAtualizacoes(l, repintar) {
      const TIPO_IMP = (o) => {
      const s = String(o || '').toLowerCase();
      if (s.endsWith('historico')) return 'Histórico';
      if (s.endsWith('agendado') || s === 'automatico') return 'Automática';
      if (s.endsWith('manual')) return 'Manual (botão)';
      if (s.includes('painel')) return 'Planilha enviada';
      if (s.startsWith('api')) return 'Envio por script';
      if (s.includes('migra')) return 'Migração';
      return o ? o.replace(/_/g, ' ') : '—';
    };
    const PARTE = { vendas: 'Vendas', xml: 'XML', estoque: 'Estoque', compras: 'Notas de compra', caixa: 'Fechamento de caixa', fixe: 'FIXE · pedido no site', fixeEmail: 'FIXE · e-mail importado', saldos: 'FIXE · saldos de pontos' };
    const GRUPO = { vendas: 'vendas', xml: 'xml', estoque: 'estoque', compras: 'estoque', caixa: 'caixa', fixe: 'fixe', fixeEmail: 'fixe', saldos: 'fixe' };
    const per = (de, ate) => (de && ate ? `${dIso(de)} a ${dIso(ate)}` : '—');
    const linhas = [
      ...(l.base.importacoes || []).map((i) => ({ em: i.em, parte: 'vendas', ok: true, tipo: TIPO_IMP(i.origem), periodo: per(i.de, i.ate),
        detalhe: `${fmt.int(i.linhas)} linhas${i.comHora != null && i.linhas ? ` · ${fmt.pct(i.comHora / i.linhas, 0)} com hora` : ''}` })),
      ...((l.xml && l.xml.importacoes) || []).map((i) => ({ em: i.em, parte: 'xml', ok: true, tipo: '—', periodo: per(i.de, i.ate),
        detalhe: `${i.total == null ? '?' : fmt.int(i.total)} notas · ${fmt.int(i.comDoc)} com CPF/CNPJ` })),
      ...(l.eventos || []).map((e) => ({ em: e.em, parte: e.parte, ok: e.ok, tipo: TIPO_IMP(e.gatilho) + (e.por && e.gatilho === 'manual' ? ` · ${e.por}` : ''), periodo: ['vendas', 'xml'].includes(e.parte) ? per(e.de, e.ate) : '—',
        detalhe: e.ok ? e.detalhe || '' : e.erro || 'falhou (veja o log técnico)' })),
      // pedido ao FIXE ainda sem os e-mails: linha "aguardando" (vira ✓ ou ✗ quando o e-mail chegar ou passar de 3 h)
      ...(l.fixe && l.fixe.pedido && l.fixe.pedido.em ? [(() => {
        const pd = l.fixe.pedido, esp = Array.isArray(pd.tipos) && pd.tipos.length ? pd.tipos : ['leads'], feitos = pd.feitos || {};
        const nome = (t) => (t === 'logs' ? 'Logs' : 'Base de leads');
        return { em: pd.em, parte: 'fixeEmail', ok: null, tipo: '—', periodo: '—',
          detalhe: `aguardando o e-mail do FIXE${pd.email ? ` em ${pd.email}` : ''}: ${esp.map((t) => `${nome(t)} ${feitos[t] ? 'chegou' : 'aguardando'}`).join(' · ')}` };
      })()] : []),
    ].filter((x) => x.em).sort((a, b) => Date.parse(b.em) - Date.parse(a.em));
    if (linhas.length) {
      const fil = ((state.cfgHist ||= {})[l.id]) || 'todos';
      const cont = (k) => linhas.filter((x) => k === 'todos' || GRUPO[x.parte] === k).length;
      const OPS = [['todos', 'Todos'], ['vendas', 'Vendas'], ['xml', 'XML'], ['estoque', 'Estoque'], ['fixe', 'FIXE'], ['caixa', 'Caixa']].filter(([k]) => k === 'todos' || cont(k));
      const vis = linhas.filter((x) => fil === 'todos' || GRUPO[x.parte] === fil).slice(0, 80);
      // dentro de um cartão (com o botão ⤢ Expandir, como os outros cartões com tabela)
        return h('div', { class: 'card cfg-hist-card' },
        h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'card-title' }, `Histórico das atualizações · ${l.nome}`))),
        TS.seg(OPS.map(([k, t]) => [`${t} (${cont(k)})`, k]), fil, (v) => { state.cfgHist[l.id] = v; repintar(); }),
        h('div', { class: 'cfg-imp-wrap table-wrap' }, h('table', { class: 't cfg-t' },
          h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Quando'), h('th', { class: 'l' }, 'O quê'), h('th', { class: 'l' }, 'Resultado'), h('th', { class: 'l' }, 'Tipo'), h('th', { class: 'l' }, 'Período'), h('th', { class: 'l' }, 'Detalhe'))),
          h('tbody', null, vis.map((x) => h('tr', null, h('td', { class: 'l nw' }, dt(x.em)), h('td', { class: 'l nw' }, PARTE[x.parte] || x.parte),
            h('td', { class: 'l nw ' + (x.ok == null ? 'muted' : x.ok ? 'pos' : 'neg') }, x.ok == null ? '⏳ aguardando' : !x.ok ? '✗ falhou' : x.parte === 'fixe' ? '✓ pedido feito' : '✓ ok'), h('td', { class: 'l nw' }, x.tipo), h('td', { class: 'l nw' }, x.periodo), h('td', { class: 'l' }, x.detalhe)))))));
    }
        return null;
  }

  /** janela do histórico das atualizações (clique em "Atualizado", no topo) — admin e franqueado */
  TS.abrirHistAtualizacoes = async function () {
    document.querySelector('.camada-hist-at')?.remove();
    const corpo = h('div', null, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Lendo o histórico…'))));
    const fechar = () => { camada.remove(); if (!document.querySelector('.camada-cheia')) document.body.classList.remove('com-camada'); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    const caixa = h('div', { class: 'card card-cheio fech-modal hist-at' }, h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'), corpo);
    const camada = h('div', { class: 'camada-cheia camada-hist-at', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === camada) fechar(); } }, caixa);
    document.body.append(camada); document.body.classList.add('com-camada'); document.addEventListener('keydown', esc);
    try {
      const e = await api('GET', '/estado');
      const lojas = (e.lojas || []).filter((l) => !state.loja || state.loja === 'todas' || l.id === state.loja);
      let atual = lojas[0];
      const desenhar = () => {
        const sel = lojas.length > 1 ? h('select', { class: 'f-input hist-at-sel', onchange: (ev) => { atual = lojas.find((l) => l.id === ev.target.value); desenhar(); } }, lojas.map((l) => h('option', { value: l.id, selected: l === atual || null }, l.nome))) : null;
        const c = atual && cartaoHistAtualizacoes(atual, desenhar);
        corpo.replaceChildren(...[sel, c || TS.empty('Ainda não há atualizações registradas.'), h('p', { class: 'muted' }, 'Rodar uma atualização, importar o histórico e ver o log técnico: ', h('a', { href: '#config', onclick: () => fechar() }, 'Configurações → Lojas → Dados e atualização'), '.')].filter(Boolean));
      };
      desenhar();
    } catch (err) { corpo.replaceChildren(h('div', { class: 'notice err' }, err.message)); }
  };

  /** log do coletor mais legível: destaca erros, etapas e o resumo; esconde as linhas de ===== e o traceback */
  function logBonito(linhas) {
    const pre = h('div', { class: 'script-log log-bonito' });
    const erros = [];
    for (const raw of linhas) {
      const t = String(raw);
      if (/^=+$/.test(t.replace(/^\[[\d:]+\]\s*/, '').trim())) continue;
      if (/^(Traceback|\s+File "|\s+raise |\s{2,}\S)/.test(t)) continue;
      const sem = t.replace(/^\[[\d:]+\]\s*/, '');
      let cls = '';
      if (/erro|falh|não consegui|RuntimeError|Exception|timeout/i.test(sem)) { cls = 'e'; erros.push(sem.replace(/^RuntimeError:\s*/, '')); }
      else if (/^\d+\)\s/.test(sem)) cls = 'p';
      else if (/OK|conferida|notas|KB|→/.test(sem)) cls = 'k';
      pre.append(h('div', { class: 'll ' + cls }, t));
    }
    const motivo = erros.filter((e) => !/^#+/.test(e)).pop();
    return h('div', null, motivo ? h('div', { class: 'log-motivo' }, h('b', null, 'Motivo: '), motivo) : null, pre);
  }

  function formHistorico(l) {
    const hoje = new Date();
    const ymHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    const de = inp({ type: 'month', value: `${hoje.getFullYear() - 2}-01`, max: ymHoje });
    const ate = inp({ type: 'month', value: ymHoje, max: ymHoje });
    const passo = h('select', { class: 'f-input' }, [1, 2, 3, 6].map((n) => h('option', { value: n, selected: n === 3 || null }, n === 1 ? '1 mês' : `${n} meses`)));
    // o que importar: como no "Atualizar dados" do topo. Vendas e XML usam o período; estoque e FIXE são de agora
    const temFixe = !!(l.fixe && l.fixe.url && l.fixe.temSenha);
    const OPS = [['vendas', 'Vendas', 'do período escolhido', true], ['xml', 'XML das notas', 'do período escolhido (CPF dos clientes)', true],
      ['estoque', 'Estoque e custos', 'foto de agora (o período não se aplica)', false], ...(temFixe ? [['fixe', 'FIXE (clientes e pontos)', 'de agora; chega por e-mail alguns minutos depois', false]] : [])];
    const marcados = new Set(['vendas', 'xml']);
    const caixas = OPS.map(([k, t, sub]) => {
      const cb = h('input', { type: 'checkbox', checked: marcados.has(k) || null });
      cb.addEventListener('change', () => { cb.checked ? marcados.add(k) : marcados.delete(k); ajustar(); });
      return h('label', { class: 'hist-op' }, cb, h('span', null, h('b', null, t), h('small', null, sub)));
    });
    const dicaTipo = h('small', { class: 'muted' });
    const ajustar = () => {
      const comPeriodo = marcados.has('vendas') || marcados.has('xml');
      [de, ate, passo].forEach((x) => { x.disabled = !comPeriodo; });
      dicaTipo.textContent = !marcados.size ? 'Marque pelo menos um item.' : !comPeriodo ? 'Só estoque/FIXE: o período não se aplica (é a situação de agora).'
        : marcados.has('estoque') || marcados.has('fixe') ? 'O estoque e o FIXE vão junto da última parte do período.' : '';
    };
    const aberto = abertos.has('hist:' + l.id);
    const det = h('details', { class: 'cfg-hist', open: aberto || null }, h('summary', null, 'Importar histórico de um período'),
      h('p', { class: 'muted' }, 'Baixa do AppNext em partes (uma de cada vez) e junta no histórico. Use na primeira carga de uma loja ou para refazer meses.'),
      h('div', { class: 'cfg-grid c3' }, campo('De', de), campo('Até', ate), campo('Tamanho de cada parte', passo, 'Partes menores demoram mais no total, mas falham menos.')),
      h('div', { class: 'f-label', style: { marginTop: '8px' } }, 'O que importar'),
      h('div', { class: 'hist-ops' }, caixas),
      h('small', { class: 'muted' }, 'XML = Fiscal → Gerar XML do AppNext (Tipo Todos, Situação Ativos): traz o CPF de cada cupom para a aba Clientes. Para a primeira carga, use de 06/2025 até hoje.'),
      dicaTipo,
      h('div', { class: 'cfg-acoes' }, acao('Importar', async () => {
        if (!marcados.size) throw new Error('Marque o que importar.');
        const extras = ['estoque', 'fixe'].filter((k) => marcados.has(k));
        if (!marcados.has('vendas') && !marcados.has('xml')) {
          const rr = await fetch(`/api/script?loja=${encodeURIComponent(l.id)}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ itens: extras }) });
          const j = await rr.json().catch(() => ({}));
          if (!rr.ok) throw new Error(j.erro || 'Falha ao pedir ao coletor.');
          abertos.delete('hist:' + l.id);
          return `${extras.map((k) => (k === 'fixe' ? 'FIXE' : 'Estoque')).join(' e ')} na fila do coletor. Leva alguns minutos${extras.includes('fixe') ? ' (o FIXE chega por e-mail depois)' : ''}.`;
        }
        const tipo = marcados.has('vendas') && marcados.has('xml') ? 'ambos' : marcados.has('vendas') ? 'vendas' : 'xml';
        const r = await api('POST', `/lojas/${l.id}/historico`, { de: de.value, ate: ate.value, mesesPorParte: +passo.value, tipo, extras });
        abertos.delete('hist:' + l.id);
        return `Importação na fila: ${r.partes} parte(s)${extras.length ? ` + ${extras.map((k) => (k === 'fixe' ? 'FIXE' : 'estoque')).join(' e ')} no fim` : ''}. Pode fechar o painel; ela continua sozinha.`;
      }, 'btn primary')));
    ajustar();
    det.addEventListener('toggle', () => { det.open ? abertos.add('hist:' + l.id) : abertos.delete('hist:' + l.id); });
    return det;
  }

  // ---- AppNext
  /** CFOP das NF-e que o robô emite (o mesmo formulário do passo 5 da configuração guiada) */
  function blocoNfeCfop(l) {
    if (!TS.guia || !TS.guia.formCfop) return null;
    const trava = TS.demo ? null : !(l.coletor && l.coletor.configurado) ? 'Para buscar a lista, o robô precisa do acesso ao AppNext: salve primeiro o cartão "Acesso ao AppNext" acima (ou digite o CFOP).' : !est.coletorAtivo ? 'O robô não está ligado nesta VPS: digite o CFOP.' : null;
    const f = TS.guia.formCfop(l.id, l.nfeCfop, l.cfopsAppNext, trava);
    return h('section', { class: 'cfg-bloco cfg-form cfg-nfe-cfop' }, h('h3', null, 'Notas fiscais: CFOP'),
      h('p', { class: 'muted' }, 'Qual CFOP o robô usa ao emitir no AppNext a NF-e de venda e a de devolução ao fornecedor.'),
      f.el,
      h('div', { class: 'cfg-acoes' }, acao('Salvar CFOP', async () => { const v = await f.salvar(); l.nfeCfop = v; return 'CFOP salvo. Vale para as próximas notas.'; }, 'btn primary')));
  }

  function blocoAppNext(l) {
    const c = l.coletor;
    const rede = inp({ value: c.rede || 'teashop', autocomplete: 'off' });
    const usuario = inp({ value: c.usuario || '', autocomplete: 'off' });
    const senha = inp({ type: 'password', autocomplete: 'new-password', placeholder: c.temSenha ? '•••••••• (guardada — preencha só para trocar)' : '' });
    const destino = inp({ value: (c.configurado ? c.lojaDestino : l.appnext) || '', placeholder: 'Ex.: TORRES - TEA SHOP TORRES' });
    const idDest = inp({ value: c.lojaIdDestino || '', placeholder: 'opcional' });
    return h('section', { class: 'cfg-bloco cfg-form' }, h('h3', null, 'Acesso ao AppNext'),
      h('div', { class: 'cfg-grid' }, campo('Rede', rede), campo('Usuário', usuario), campo('Senha', senha, 'Fica só na VPS e nunca aparece de volta aqui.'),
        campo('Nome da loja no AppNext', destino, 'Trava de segurança: a planilha só entra se todas as vendas forem desta loja.'), campo('Código da loja no AppNext', idDest, 'Só se o usuário tiver acesso a várias lojas.')),
      h('div', { class: 'cfg-acoes' }, acao('Salvar acesso', async () => {
        await api('PUT', `/lojas/${l.id}/appnext`, { rede: rede.value, usuario: usuario.value, senha: senha.value || undefined, lojaDestino: destino.value, lojaIdDestino: idDest.value });
        return c.configurado ? 'Acesso atualizado.' : 'Acesso salvo. Use "Importar histórico" para a primeira carga.';
      }, 'btn primary')));
  }

  // ---- metas
  function blocoMetas(l) {
    const padrao = inp({ type: 'number', min: 0, step: 500, value: l.meta ?? '' });
    const auto = l.metaAuto || { ativo: false, pct: 10 };
    const autoOn = h('input', { type: 'checkbox', checked: auto.ativo || null });
    const pct = inp({ type: 'number', step: 0.5, min: -90, max: 500, value: auto.pct ?? 10, style: { maxWidth: '110px' } });
    const tot = l.totaisSemEG || {};
    const ymAnt = (ym) => `${+ym.slice(0, 4) - 1}${ym.slice(4)}`;
    const valorAuto = (ym) => { const b = tot[ymAnt(ym)]; return autoOn.checked && b > 0 ? Math.round(b * (1 + (+pct.value || 0) / 100)) : null; };
    const hoje = new Date();
    const ymHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    const meses = [];
    for (let k = -12; k <= 2; k++) { const d = new Date(hoje.getFullYear(), hoje.getMonth() + k, 1); meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    Object.keys(l.metas || {}).forEach((ym) => { if (!meses.includes(ym)) meses.push(ym); });
    meses.sort();
    const campos = new Map(), dicas = new Map();
    const grade = h('div', { class: 'cfg-metas' }, meses.map((ym) => {
      const i = inp({ type: 'number', min: 0, step: 500, value: l.metas[ym] ?? '' });
      const dica = h('small', { class: 'cfg-meta-dica' });
      campos.set(ym, i); dicas.set(ym, dica);
      return h('label', { class: 'cfg-meta' + (ym === ymHoje ? ' atual' : '') }, h('span', null, TS.ymLabel(ym)), i, dica);
    }));
    const atualizarDicas = () => {
      for (const [ym, i] of campos) {
        const v = valorAuto(ym);
        i.placeholder = v != null ? fmt.int(v) : padrao.value ? fmt.int(+padrao.value) : '—';
        const d = dicas.get(ym);
        d.textContent = i.value ? 'digitada' : v != null ? `auto (${ymAnt(ym).slice(5)}/${ymAnt(ym).slice(2, 4)}: ${fmt.compact(tot[ymAnt(ym)])})` : 'padrão';
        d.className = 'cfg-meta-dica ' + (i.value ? 'dig' : v != null ? 'auto' : '');
      }
    };
    [autoOn, pct, padrao].forEach((x) => x.addEventListener('input', atualizarDicas));
    autoOn.addEventListener('change', atualizarDicas);
    campos.forEach((i) => i.addEventListener('input', atualizarDicas));
    atualizarDicas();
    return h('section', { class: 'cfg-bloco cfg-form' }, h('h3', null, 'Metas'),
      h('div', { class: 'cfg-auto' },
        h('label', { class: 'cfg-check-l' }, autoOn, h('b', null, ' Meta automática pelo ano anterior')),
        h('div', { class: 'cfg-inline' }, h('span', null, 'Vendas do mesmo mês do ano anterior (sem Espaço Gourmet) +'), pct, h('span', null, '%')),
        h('small', { class: 'muted' }, 'Ex.: vendeu R$ 100.000 em nov/25 e o percentual é 10% → meta de nov/26 = R$ 110.000. Os meses sem venda no ano anterior usam a meta padrão.')),
      campo('Meta padrão (R$)', padrao, 'Usada quando o mês não tem meta digitada nem venda no ano anterior.'),
      h('div', { class: 'f-label', style: { marginTop: '10px' } }, 'Meta de cada mês'),
      h('p', { class: 'muted', style: { margin: '2px 0 8px' } }, 'Digite só para mudar um mês específico: a meta digitada vale mais que a automática. Em cinza, o valor que será usado.'),
      grade,
      h('div', { class: 'cfg-acoes' }, acao('Salvar metas', async () => {
        const metas = {};
        for (const [ym, i] of campos) { const v = i.value.trim(); if (v !== String(l.metas[ym] ?? '')) metas[ym] = v === '' ? null : +v; }
        if (padrao.value !== String(l.meta ?? '')) await api('PUT', `/lojas/${l.id}`, { meta: padrao.value });
        if (autoOn.checked !== !!auto.ativo || +pct.value !== +auto.pct) await api('PUT', `/lojas/${l.id}/metaauto`, { ativo: autoOn.checked, pct: +pct.value || 0 });
        if (Object.keys(metas).length) await api('PUT', `/lojas/${l.id}/metas`, { metas });
        TS.recarregar && TS.recarregar(true);
        return 'Metas salvas.';
      }, 'btn primary')));
  }

  // ---- planilhas
  // ---- cadastro de clientes pelo FIXE (exportação por e-mail, lida no Gmail da loja)
  /** e-mail das devoluções ao fornecedor: para quem vai e o assunto */
  function blocoDevolucao(l) {
    const b = h('section', { class: 'cfg-bloco' }, h('h3', null, 'Devoluções ao fornecedor (e-mail)'),
      h('p', { class: 'muted' }, 'Quando a loja registra uma devolução (Notas fiscais → Entrada → nota → Devolver itens), o painel manda, depois que a NF-e de devolução é autorizada, um e-mail com a NF-e (PDF e XML), a planilha e as fotos pelo Gmail da loja.'));
    const emails = h('input', { class: 'f-input', placeholder: 'e-mails separados por vírgula' });
    const assunto = h('input', { class: 'f-input', maxlength: 160 });
    const msg = h('small', { class: 'muted' });
    const salvar = h('button', { type: 'button', class: 'btn primary' }, 'Salvar');
    fetch(TS.api(`devolucoes?loja=${encodeURIComponent(l.id)}`), { credentials: 'same-origin' }).then((r) => r.json()).then((j) => { emails.value = (j.destinatarios || []).join(', '); assunto.value = j.assunto || ''; }).catch(() => null);
    salvar.addEventListener('click', async () => {
      salvar.disabled = true;
      try {
        const r = await fetch(TS.api('devolucoes/destinatarios'), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ loja: l.id, emails: emails.value.split(/[,;\s]+/).filter(Boolean), assunto: assunto.value }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha.');
        emails.value = j.destinatarios.join(', '); assunto.value = j.assunto; msg.textContent = 'Salvo.';
      } catch (e) { msg.textContent = e.message; }
      salvar.disabled = false;
    });
    b.append(h('label', { class: 'cfg-campo' }, h('span', null, 'Destinatários'), emails),
      h('label', { class: 'cfg-campo' }, h('span', null, 'Assunto'), assunto),
      h('small', { class: 'muted' }, 'Campos do assunto: {loja} · {nf} (nota de entrada) · {fornecedor} · {nfDevolucao} (número da NF-e de devolução)'),
      h('div', { class: 'cfg-acoes' }, salvar, msg));
    // para quem vai o e-mail: só admin e franqueado mudam (o servidor confere); os outros veem travado
    if (!(TS.eu && ['admin', 'franqueado'].includes(TS.eu.perfil))) {
      emails.disabled = true; assunto.disabled = true; salvar.hidden = true;
      msg.textContent = 'Só o admin ou o franqueado muda os destinatários.';
    }
    return b;
  }
  function blocoFixe(l) {
    const fx = l.fixe || {};
    const gmail = (l.fechEmail && l.fechEmail.email && l.fechEmail.email.user) || '';
    const b = h('section', { class: 'cfg-bloco' }, h('h3', null, 'Clientes e fidelidade pelo FIXE'),
      h('p', { class: 'muted' }, 'O coletor entra no FIXE e pede duas exportações para o Gmail da loja: a "Base de leads" (cadastro) e os "Logs" (pontos, compras e resgates). O painel lê os e-mails (na caixa de entrada ou no spam), baixa as planilhas, junta com o cadastro e liga as compras do FIXE aos cupons. Nada precisa ser feito à mão.'),
      h('div', { class: 'notice' }, h('b', null, 'Quando o FIXE é atualizado: '),
        `uma vez por dia, só na última atualização automática da loja${l.horarios && l.horarios.hoje && l.horarios.hoje.length ? ` (hoje às ${l.horarios.hoje[l.horarios.hoje.length - 1]})` : ''} — a marcada com ★ nos horários (Dados e atualização). As outras atualizações do dia trazem só vendas, XML e estoque, porque o cadastro e os pontos do FIXE não precisam de mais de uma leitura por dia e cada pedido gera dois e-mails. Num dia sem atualização automática (ex.: loja fechada), o FIXE não é pedido. Fora desse horário, o administrador pode pedir na hora pelo botão "Importar agora" (as atualizações manuais de vendas não pedem o FIXE).`));
    { const f = sitFixe(l), g = sitLogs(l), sd = sitSaldos(l); if (f || g || sd) b.append(h('div', { class: 'cfg-sit' }, f, g, sd)); }
    const url = inp({ value: fx.url || (est.lojas || []).map((x) => x.fixe && x.fixe.url).find(Boolean) || '', placeholder: 'ex.: https://dash.epossible.com.br/loja/…/leads' });
    const usuario = inp({ value: fx.usuario || '', placeholder: 'ex.: e-mail de acesso ao FIXE', autocomplete: 'off' });
    const senha = inp({ type: 'password', placeholder: fx.temSenha ? 'guardada (deixe em branco para manter)' : 'senha do FIXE', autocomplete: 'new-password' });
    const email = inp({ type: 'email', value: fx.email || gmail, placeholder: 'ex.: o Gmail da loja' });
    // apelido do Gmail (+loja): separa as lojas que usam o mesmo Gmail
    const apelido = h('input', { type: 'checkbox', checked: fx.apelido !== false || null });
    const tag = String(l.id).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
    const enderecoDe = () => {
      const e = email.value.trim().toLowerCase(), [u, d] = e.split('@');
      return apelido.checked && tag && d && !u.includes('+') && ['gmail.com', 'googlemail.com'].includes(d) ? `${u}+${tag}@${d}` : e;
    };
    const mesmoGmail = (est.lojas || []).filter((x) => x.id !== l.id && gmail && x.fechEmail && x.fechEmail.email && String(x.fechEmail.email.user || '').toLowerCase() === gmail.toLowerCase());
    const infoEnd = h('div', { class: 'cfg-ex-assunto' });
    const verEnd = () => {
      const end = enderecoDe(), comTag = end.includes('+');
      infoEnd.replaceChildren(...[end ? h('span', null, 'O robô pede as exportações ao FIXE para ', h('b', null, end), comTag ? ' — chega na mesma caixa do Gmail, mas só esta loja lê o que vier para esse endereço.' : '.') : null,
        mesmoGmail.length && !comTag ? h('div', { class: 'neg', style: { marginTop: '4px' } }, `Atenção: ${mesmoGmail.map((x) => x.nome).join(', ')} usa o mesmo Gmail. Sem o apelido, as exportações das lojas podem se misturar. Ligue "Separar esta loja com um apelido do Gmail".`) : null,
        mesmoGmail.length && comTag ? h('div', { class: 'muted', style: { marginTop: '4px' } }, `Este Gmail também é usado por ${mesmoGmail.map((x) => x.nome).join(', ')}; com o apelido cada loja lê só as suas exportações.`) : null].filter(Boolean));
    };
    email.addEventListener('input', verEnd); apelido.addEventListener('change', verEnd); verEnd();
    b.append(h('div', { class: 'cfg-grid' },
      campo('Página de Leads no FIXE', url, 'É o mesmo endereço para todas as lojas da rede. O que separa a base de cada loja é o usuário e a senha abaixo.'),
      campo('Usuário do FIXE', usuario, 'O login desta loja no FIXE: é ele que define de qual loja vem a base de clientes.'), campo('Senha do FIXE', senha, 'Fica guardada só na VPS, como a do AppNext.'),
      campo('E-mail que recebe a exportação', email, gmail ? `Use o Gmail da loja (${gmail}): é nele que o painel procura o e-mail do FIXE.` : 'Configure antes o Gmail da loja em "Fechamento do dia": é nele que o painel procura o e-mail do FIXE.')),
      h('label', { class: 'cfg-check-l' }, apelido, ' Separar esta loja com um apelido do Gmail (+', tag, ')'), infoEnd,
      h('div', { class: 'cfg-acoes' },
        acao('Salvar acesso ao FIXE', async () => { await api('PUT', `/lojas/${l.id}/fixe`, { url: url.value, usuario: usuario.value, senha: senha.value, email: email.value, apelido: apelido.checked }); senha.value = ''; return 'Acesso ao FIXE salvo.'; }, 'btn primary'),
        fx.url ? acao('Remover acesso', async () => { if (!confirm('Remover o acesso desta loja ao FIXE (endereço, usuário, senha e e-mail)? O cadastro de clientes que já está no painel continua.')) return null; await api('DELETE', `/lojas/${l.id}/fixe`); return 'Acesso ao FIXE removido.'; }) : null,
        (est.perfil === 'admin' || est.perfil === 'franqueado') && est.coletorAtivo && fx.url ? acao('Importar agora', async () => { await api('POST', `/lojas/${l.id}/fixe/rodar`); return 'Pedido enviado ao FIXE. Em alguns minutos o e-mail chega e o cadastro é atualizado.'; }) : null,
        botaoSaldos(l)),
      fx.url ? h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Sincronizar saldos: use uma vez para acertar os pontos antigos que os Logs não trazem. Repita só se notar diferença entre o painel e o FIXE em algum cliente.') : null);
    // regras de pontos
    if (est.perfil === 'admin' || est.perfil === 'franqueado') {
      const rg = fx.fidelidade || { reaisPorPonto: 50, validadeMeses: 12 };
      const rpp = inp({ type: 'number', min: 1, step: '0.01', value: rg.reaisPorPonto }), val = inp({ type: 'number', min: 1, max: 120, step: 1, value: rg.validadeMeses });
      const minR = inp({ type: 'number', min: 1, max: 1000, step: 1, value: rg.minResgate ?? 6 }), prazoR = inp({ type: 'number', min: 7, max: 730, step: 1, value: rg.prazoResgate ?? 90 });
      b.append(h('h4', { class: 'cfg-sub' }, 'Regras dos pontos'),
        h('div', { class: 'cfg-grid' },
          campo('Reais por ponto (R$)', rpp, 'Quanto a compra precisa somar para ganhar 1 ponto. Usado para conferir se um cupom é a compra lançada no FIXE.'),
          campo('Validade dos pontos (meses)', val, 'Depois disso o ponto vence. Usado no saldo e no aviso "Pontos vencendo" da tela Clientes.'),
          campo('Mínimo para resgatar (pontos)', minR, 'A partir de quantos pontos o cliente pode resgatar. Define quem entra no indicador "Resgate de pontos" da tela Clientes.'),
          campo('Prazo para resgatar (dias)', prazoR, 'Quantos dias depois de chegar ao mínimo o resgate ainda conta como "resgatou" no indicador.')),
        h('div', { class: 'cfg-acoes' }, acao('Salvar regras', async () => { await api('PUT', `/lojas/${l.id}/fidelidade`, { reaisPorPonto: rpp.value, validadeMeses: val.value, minResgate: +minR.value, prazoResgate: +prazoR.value }); return 'Regras salvas. O painel recalcula na próxima carga.'; })));
    }
    return b;
  }

  function blocoPlanilhas(l) {
    const tipo = h('select', { class: 'f-input' },
      h('option', { value: 'vendas' }, 'Vendas (relatório do AppNext)'),
      (est.perfil === 'admin' || est.perfil === 'franqueado') ? h('option', { value: 'historico' }, 'Histórico de vendas do sistema antigo (antes do AppNext)') : null, h('option', { value: 'Xml' }, 'Cupons com CPF (Xml)'),
      h('option', { value: 'Dados_Clientes' }, 'Cadastro de clientes (modelo do painel ou FIXE)'), h('option', { value: 'FIXE_Logs' }, 'Logs do FIXE (pontos, compras e resgates)'), h('option', { value: 'Meta' }, 'Meta (planilha antiga)'),
      h('option', { value: 'Estoque' }, 'Estoque atual e custos (AppNext → Estoque → Estoque Atual → Excel)'),
      (est.perfil === 'admin' || est.perfil === 'franqueado') ? h('option', { value: 'Produtos' }, 'Preço de tabela (AppNext → Produtos ou Produtos Compostos → Excel)') : null);
    const arq = h('input', { type: 'file', accept: '.xlsx,.xls', class: 'f-input' });
    const dica = h('p', { class: 'muted cfg-dica-cad' });
    const pintaDica = () => {
      dica.textContent = tipo.value === 'Dados_Clientes'
        ? 'Pode enviar o modelo do painel (CPF, NOME, CELULAR, DATA NASC., EMAIL, CIDADE), a exportação de contatos do FIXE ou a exportação de Logs do FIXE (pontos e compras), do jeito que sai do sistema. O painel reconhece sozinho, junta com o cadastro que já existe (CPF novo entra, CPF conhecido é atualizado, campo vazio não apaga) e ignora o que não usa (Data Cadastro, Loja, Saldo, Estado).'
        : tipo.value === 'FIXE_Logs'
          ? 'No FIXE: Logs → exportar (a planilha com compras, pontos e resgates de cada cliente). Envie do jeito que baixar. O coletor também pede essa exportação na última atualização do dia e o painel lê do e-mail; o envio manual serve para uma carga fora de hora.'
        : tipo.value === 'historico'
          ? 'A planilha de vendas antiga (a "importacaoB" que o Power BI usava). Entram só os dias ANTERIORES à primeira venda que o painel já tem: nada do que já está no painel é apagado ou trocado, e o período em que o AppNext começou continua com os dados do AppNext. Pode enviar de novo sem medo de duplicar.'
        : tipo.value === 'Estoque'
          ? 'No AppNext: Estoque → Estoque Atual → botão verde "Exportar para Excel". Envie o arquivo do jeito que baixar. O coletor também baixa sozinho em cada atualização; o envio manual serve para a primeira carga ou para conferir.'
        : tipo.value === 'Produtos'
          ? 'Envie as DUAS listagens, uma de cada vez: AppNext → Produtos → Produtos (acessórios, envasados, Tea Room…) e Produtos → Produtos Compostos (os pacotes de chá a granel, minitins, kits), botão do Excel. O painel reconhece qual é pelo título e guarda o preço de tabela de cada produto para a Margem de tabela. O coletor também baixa as duas uma vez por dia.'
          : '';
      dica.hidden = !dica.textContent;
    };
    tipo.addEventListener('change', pintaDica); pintaDica();
    const resultado = h('div');
    const mostrarCad = (c) => {
      const pct = (n) => (c.noArquivo ? ` (${fmt.pct(n / c.noArquivo, 0)})` : '');
      resultado.replaceChildren(h('div', { class: 'cfg-cad-res' },
        h('b', null, `Arquivo ${c.formato === 'FIXE' ? 'do FIXE' : 'no modelo do painel'} reconhecido: ${fmt.int(c.noArquivo)} clientes.`),
        h('ul', null,
          h('li', null, `${fmt.int(c.novos)} novos e ${fmt.int(c.atualizados)} atualizados · cadastro da loja agora com ${fmt.int(c.total)} clientes`),
          h('li', null, `Com celular: ${fmt.int(c.comCelular)}${pct(c.comCelular)} · aniversário: ${fmt.int(c.comAniversario)}${pct(c.comAniversario)} · e-mail: ${fmt.int(c.comEmail)}${pct(c.comEmail)} · cidade: ${fmt.int(c.comCidade)}${pct(c.comCidade)}`),
          c.semCPF ? h('li', null, `${fmt.int(c.semCPF)} linha(s) sem CPF válido ficaram de fora`) : null,
          c.ignoradas.length ? h('li', { class: 'muted' }, `Colunas que o painel não usa (ignoradas): ${c.ignoradas.join(', ')}`) : null),
        h('button', { type: 'button', class: 'link-btn', onclick: () => { cadastroRes.delete(l.id); resultado.replaceChildren(); } }, 'Fechar')));
    };
    if (cadastroRes.has(l.id)) mostrarCad(cadastroRes.get(l.id));
    const lg = l.fixe && l.fixe.logs;
    const lista = h('ul', { class: 'cfg-fontes' }, l.fontes.map((f) => h('li', null, h('b', null, f.desc), ' — ',
      f.origem === 'vps' ? `na VPS, ${dt(f.modificado)}` : h('span', { class: 'muted' }, 'não enviada'),
      null)),
      h('li', null, h('b', null, 'Logs do FIXE (pontos e compras)'), ' — ', lg && lg.em ? `importados em ${dt(lg.em)}${lg.movimentos ? ` · ${fmt.int(lg.movimentos)} movimentos` : ''}` : h('span', { class: 'muted' }, 'ainda não importados')));
    return h('section', { class: 'cfg-bloco' }, h('h3', null, 'Enviar planilha'),
      h('p', { class: 'muted' }, 'Vendas: entram no histórico substituindo só os dias que a planilha cobre. Cadastro de clientes: junta com o que já existe. As outras substituem a anterior.'),
      h('div', { class: 'cfg-grid' }, campo('Tipo', tipo), campo('Arquivo (.xlsx ou .xls)', arq)), dica,
      h('div', { class: 'cfg-acoes' }, acao('Enviar', async () => {
        const f = arq.files[0];
        if (!f) throw new Error('Escolha o arquivo.');
        // Logs do FIXE vão pelo mesmo envio do cadastro: o painel reconhece pela planilha
        const urlEnvio = `/lojas/${l.id}/upload/${tipo.value === 'FIXE_Logs' ? 'Dados_Clientes' : tipo.value}`;
        let r;
        try { r = await api('POST', urlEnvio, f, { 'X-Arquivo': encodeURIComponent(f.name) }); }
        catch (e) {
          // estoque com bem menos produtos que o atual: só grava se quem enviou confirmar
          if (!(e.dados && e.dados.podeForcar) || !confirm(e.message + '\n\nSe a planilha está certa (a loja realmente ficou com poucos produtos), clique em OK para gravar assim mesmo.')) throw e;
          r = await api('POST', urlEnvio + '?forcar=1', f, { 'X-Arquivo': encodeURIComponent(f.name) });
        }
        arq.value = '';
        setTimeout(() => TS.recarregar && TS.recarregar(true), 4000);
        if (r && r.estoque) {
          resultado.replaceChildren(h('div', { class: 'cfg-cad-res' }, h('b', null, `Estoque importado: ${fmt.int(r.estoque.itens)} produtos.`),
            h('ul', null, r.estoque.zerados ? h('li', null, `${fmt.int(r.estoque.zerados)} produto(s) que não vieram agora ficaram com estoque zero`) : null,
              r.estoque.semCusto ? h('li', null, `${fmt.int(r.estoque.semCusto)} produto(s) sem custo no AppNext`) : null),
            h('div', null, 'Veja na aba Estoque e margem.')));
          return 'Estoque importado.';
        }
        if (r && r.tabela) {
          resultado.replaceChildren(h('div', { class: 'cfg-cad-res' }, h('b', null, `${r.tabela.tipo === 'compostos' ? 'Produtos Compostos' : 'Produtos'} importado: ${fmt.int(r.tabela.itens)} produtos (${fmt.int(r.tabela.comPreco)} com preço).`),
            h('div', null, r.tabela.tipo === 'compostos' ? 'Se ainda não enviou, envie também a listagem de Produtos.' : 'Se ainda não enviou, envie também a de Produtos Compostos (os chás a granel).')));
          return 'Preço de tabela importado.';
        }
        if (r && r.historico) {
          const g = r.historico;
          resultado.replaceChildren(h('div', { class: 'cfg-cad-res' }, g.linhas
            ? h('b', null, `Histórico importado: ${fmt.int(g.linhas)} linhas de venda de ${dIso(g.de)} a ${dIso(g.ate)}.`)
            : h('b', null, 'Nada novo para importar.'),
            h('ul', null,
              h('li', null, `Arquivo de ${dIso(g.arquivoDe)} a ${dIso(g.arquivoAte)}`),
              g.corte ? h('li', null, `O painel já tinha vendas a partir de ${dIso(g.corte)}: ${fmt.int(g.descartadas)} linha(s) do arquivo nesse período ficaram de fora (valem as do AppNext)`) : null)));
          return g.linhas ? 'Histórico importado. O painel recarrega em alguns segundos.' : 'Nada novo: o painel já tinha esse período.';
        }
        if (r && r.logs) {
          const g = r.logs;
          resultado.replaceChildren(h('div', { class: 'cfg-cad-res' }, h('b', null, `Logs do FIXE importados: ${fmt.int(g.movimentos)} movimentos de ${fmt.int(g.clientes)} clientes.`),
            h('ul', null, h('li', null, `${fmt.int(g.compras)} compras · ${fmt.int(g.resgates)} resgates · ${fmt.int(g.expirados)} expirações`)),
            h('div', null, 'Saldo de pontos, vencimentos e compras ligadas aos cupons aparecem na aba Clientes.')));
          return 'Logs do FIXE importados.';
        }
        const c = r && r.cadastro;
        if (c) {
          cadastroRes.set(l.id, c); mostrarCad(c);
          return 'Cadastro importado. A aba Clientes se atualiza em alguns segundos.';
        }
        resultado.replaceChildren();
        return 'Planilha recebida. Os dados se atualizam em alguns segundos.';
      }, 'btn primary')), resultado,
      h('div', { class: 'f-label', style: { marginTop: '12px' } }, 'Outras planilhas da loja'), lista);
  }

  // ---- fechamento do dia por e-mail (Gmail e destinatários da própria franquia)
  function blocoFechamento(l) {
    const f = l.fechEmail;
    const sec0 = h('section', { class: 'cfg-bloco cfg-form cfg-fech' }, h('h3', null, 'Fechamento do dia por e-mail'));
    if (!f) return sec0;
    const e = f.email;
    const ativo = h('input', { type: 'checkbox', checked: f.fechamento.ativo || null });
    const hora = inp({ type: 'time', value: f.fechamento.horario || '23:30', style: { maxWidth: '140px' } });
    const ASSUNTO_PADRAO = '{loja} · fechamento de {data}';
    const assunto = inp({ value: f.fechamento.assunto || ASSUNTO_PADRAO, maxlength: 150, placeholder: ASSUNTO_PADRAO });
    const exAssunto = h('div', { class: 'muted cfg-ex-assunto' });
    const verAssunto = () => {
      const hj = new Date(), dd = String(hj.getDate()).padStart(2, '0'), mm = String(hj.getMonth() + 1).padStart(2, '0'), aa = String(hj.getFullYear());
      const t = (assunto.value.trim() || ASSUNTO_PADRAO).replace(/\{(data|dia|mes|mês|ano|loja)\}/gi, (_, k) => ({ data: `${dd}/${mm}/${aa}`, dia: dd, mes: mm, 'mês': mm, ano: aa, loja: l.nome })[k.toLowerCase()]);
      const temData = /\{data\}/i.test(assunto.value) || (/\{dia\}/i.test(assunto.value) && /\{m[eê]s\}/i.test(assunto.value) && /\{ano\}/i.test(assunto.value));
      exAssunto.replaceChildren(temData ? h('span', null, 'Fica assim: ', h('b', null, t)) : h('span', { class: 'neg' }, 'Falta a data: coloque {data} (ou {dia}, {mes} e {ano}).'));
    };
    assunto.addEventListener('input', verAssunto); verAssunto();
    const tag = (t) => h('button', { type: 'button', class: 'chip', onclick: () => { const i = assunto.selectionStart ?? assunto.value.length; assunto.value = assunto.value.slice(0, i) + t + assunto.value.slice(assunto.selectionEnd ?? i); assunto.focus(); verAssunto(); } }, t);
    const host = inp({ value: e.host, placeholder: 'ex.: smtp.gmail.com' }), port = inp({ type: 'number', value: e.port || 587 }), user = inp({ value: e.user, autocomplete: 'off', placeholder: 'ex.: teashop.loja@gmail.com' });
    const pass = inp({ type: 'password', autocomplete: 'new-password', placeholder: e.temSenha ? '•••••••• (guardada)' : 'senha de app (16 letras)' });
    const from = inp({ value: e.from, placeholder: `ex.: ${l.nome} <teashop.loja@gmail.com>` });
    const sec = h('input', { type: 'checkbox', checked: e.secure || null });
    const novoEmail = inp({ type: 'email', placeholder: 'pessoa@email.com' }), novoNome = inp({ placeholder: 'Nome' }), novoCaixa = h('input', { type: 'checkbox', checked: true });
    const envios = (r) => {
      const ok = r.envios.filter((x) => x.ok), falhas = r.envios.filter((x) => !x.ok);
      if (falhas.length) throw new Error(`Enviado para ${ok.length}; falhou: ${falhas.map((x) => `${x.para} (${x.erro})`).join('; ')}`);
      return `Fechamento de hoje enviado para ${ok.length}: ${ok.map((x) => x.para).join(', ')}.`;
    };
    sec0.append(...[
      h('p', { class: 'muted' }, `Todo dia, ${l.coletor && l.coletor.configurado && est.coletorAtivo ? 'logo depois da última atualização automática' : 'no horário escolhido'}, a ${l.nome} envia o fechamento do dia pelo Gmail dela para as pessoas da lista abaixo${f.gerais.length ? ' e para quem acompanha a loja pela rede' : ''}. É o mesmo conteúdo da planilha de fechamento, preenchido sozinho. No fim do e-mail vai o fechamento de caixa do AppNext (formas de pagamento, sangria, suprimento e diferença) para quem estiver marcado com "Recebe o caixa".`),
      h('label', { class: 'cfg-check-l' }, ativo, ' Enviar o fechamento todos os dias'),
      l.coletor && l.coletor.configurado && est.coletorAtivo
        ? h('p', { class: 'muted' }, h('b', null, `Envio: logo depois da última atualização automática do dia${l.horarios && l.horarios.hoje && l.horarios.hoje.length ? ` (hoje às ${l.horarios.hoje[l.horarios.hoje.length - 1]})` : ''}.`),
          ' Os horários de cada dia ficam em Dados e atualização. As atualizações manuais ("Rodar agora") não disparam o envio. Num dia sem atualização automática (ou se ela não acontecer), o fechamento sai às 6h do dia seguinte.')
        : h('div', { class: 'cfg-grid' }, campo('Horário (Brasília)', hora, 'Esta loja não tem atualização automática: o fechamento sai neste horário.')),
      f.fechamento.ultimoEnvio ? h('p', { class: 'muted' }, `Último envio automático: ${dIso(f.fechamento.ultimoEnvio)}`) : null,
      campo('Assunto do e-mail', assunto, 'A data é a do fechamento (o dia das vendas). Clique numa etiqueta para colocar no assunto.'),
      h('div', { class: 'cfg-tags' }, ['{data}', '{dia}', '{mes}', '{ano}', '{loja}'].map(tag)), exAssunto,
      h('div', { class: 'f-label', style: { marginTop: '10px' } }, 'Gmail que envia (da franquia)'),
      !e.configurado && f.servidorGeral ? h('p', { class: 'muted' }, 'Enquanto o Gmail da loja não for cadastrado, o envio usa o e-mail geral do painel.') : null,
      passoGmail('gmail:' + l.id, { host, port, sec, from, user }),
      h('div', { class: 'cfg-grid' }, campo('Servidor (SMTP)', host), campo('Porta', port), campo('Usuário (Gmail)', user), campo('Senha de app', pass), campo('Remetente', from)),
      h('label', { class: 'cfg-check-l' }, sec, ' Conexão segura direta (porta 465)'),
      h('div', { class: 'cfg-acoes' }, acao('Salvar', async () => {
        if (!host.value.trim() && /@gmail\.com$/i.test(user.value.trim())) host.value = 'smtp.gmail.com';
        if (user.value.trim() && !from.value.trim()) from.value = `${l.nome} <${user.value.trim()}>`;
        if (user.value.trim() && !host.value.trim()) throw new Error('Preencha o Servidor (SMTP). Para Gmail: smtp.gmail.com.');
        // usuário e servidor apagados = tirar o Gmail desta loja (a senha guardada sai junto)
        const semGmail = !user.value.trim() && !host.value.trim();
        await api('PUT', `/lojas/${l.id}/fechamento-email`, { fechamento: { ativo: ativo.checked, horario: hora.value, assunto: assunto.value.trim() === ASSUNTO_PADRAO ? '' : assunto.value }, email: semGmail ? { remover: true } : { host: host.value, port: port.value, user: user.value, pass: pass.value || undefined, from: from.value, secure: sec.checked } });
        if (semGmail) { from.value = ''; return 'Fechamento salvo. O Gmail desta loja foi removido.'; }
        return 'Fechamento salvo.';
      }, 'btn primary'),
        h('button', { type: 'button', class: 'btn', onclick: () => TS.abrirFechamento([{ id: l.id, nome: l.nome }], l.id) }, 'Ver mensagem'),
        acao('Enviar agora', async () => {
          if (!f.destinos.length && !f.gerais.length) throw new Error('Cadastre pelo menos um destinatário logo abaixo.');
          if (!confirm(`Enviar agora o fechamento de hoje da ${l.nome}?`)) return null;
          return envios(await api('POST', `/lojas/${l.id}/fechamento-email/enviar`, {}));
        })),
      h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Quem recebe'),
      f.destinos.length ? h('ul', { class: 'cfg-dest-lista' }, f.destinos.map((d) => h('li', null, h('span', null, h('b', null, d.nome || d.email), d.nome ? h('span', { class: 'muted' }, ' ' + d.email) : null),
        h('span', { class: 'cfg-inline' },
          h('label', { class: 'cfg-check-l cfg-caixa', title: 'Recebe também o fechamento de caixa (formas de pagamento, sangria, suprimento e diferença)' },
            h('input', { type: 'checkbox', checked: d.caixa !== false || null, onchange: async (ev) => {
              const cb = ev.target; cb.disabled = true;
              try { await api('POST', `/lojas/${l.id}/fechamento-email/destinos`, { email: d.email, caixa: cb.checked }); d.caixa = cb.checked; } catch (e) { cb.checked = !cb.checked; alert(e.message); } finally { cb.disabled = false; }
            } }), ' Recebe o caixa'),
          acao('Testar', async () => envios(await api('POST', `/lojas/${l.id}/fechamento-email/enviar`, { para: d.email }))),
          acao('Remover', async () => { await api('POST', `/lojas/${l.id}/fechamento-email/destinos`, { email: d.email, remover: true }); return 'Removido.'; }, 'btn ghost-danger'))))) : h('p', { class: 'muted' }, 'Ninguém ainda.'),
      h('div', { class: 'cfg-grid' }, campo('E-mail', novoEmail), campo('Nome', novoNome)),
      h('label', { class: 'cfg-check-l' }, novoCaixa, ' Recebe também o fechamento de caixa'),
      h('div', { class: 'cfg-acoes' }, acao('Adicionar destinatário', async () => { await api('POST', `/lojas/${l.id}/fechamento-email/destinos`, { email: novoEmail.value, nome: novoNome.value, caixa: novoCaixa.checked }); return 'Destinatário adicionado.'; })),
      f.gerais.length ? h('p', { class: 'muted' }, h('b', null, 'Também recebem (acompanham a loja pela rede): '), f.gerais.map((g) => g.nome || g.email).join(', '), '.') : null].filter(Boolean));
    return sec0;
  }

  // ---- modelos de mensagem de WhatsApp (tela Clientes)
  /** cobrança à franquia por e-mail, todo mês no dia escolhido (devoluções sem desconto e prêmios de fidelidade) */
  function blocoCobranca(l) {
    const sec = h('section', { class: 'cfg-bloco cfg-form' }, h('h3', null, 'Cobrança à franquia (automática)'), h('p', { class: 'muted' }, 'Carregando…'));
    if (TS.demo) { sec.replaceChildren(h('h3', null, 'Cobrança à franquia (automática)'), h('p', { class: 'muted' }, 'Na apresentação nada é enviado.')); return sec; }
    const url = `/api/conta-franquia/auto?loja=${encodeURIComponent(l.id)}`;
    fetch(url, { credentials: 'same-origin' }).then((r) => r.json().then((j) => { if (!r.ok) throw new Error(j.erro || 'Falha.'); return j; })).then((a) => {
      const dev = h('input', { type: 'checkbox', checked: a.devolucoes || null });
      const fid = h('input', { type: 'checkbox', checked: a.fidelidade || null });
      const dia = inp({ type: 'number', min: 1, max: 28, value: a.dia, style: { maxWidth: '90px' } });
      const hora = inp({ type: 'time', value: a.hora, style: { maxWidth: '140px' } });
      const paraD = inp({ value: (a.para.devolucoes || []).join(', '), placeholder: 'incidencias@…, financeiro@…' });
      const paraF = inp({ value: (a.para.fidelidade || []).join(', '), placeholder: 'financeiro@…' });
      const res = (t) => { const x = a.resultado && a.resultado[t]; if (!x) return null; const q = new Date(x.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        return h('small', { class: x.ok ? 'muted' : 'neg' }, x.ok ? (x.nada ? `Último mês (${q}): nada para cobrar, não enviou.` : `Último envio: ${q} · ${x.itens} item(ns) · R$ ${String((x.total || 0).toFixed(2)).replace('.', ',')}`) : `Último envio falhou (${q}): ${x.erro}`); };
      sec.replaceChildren(...[ // sem envio anterior, res() é null: filter(Boolean) evita escrever "null" na tela
        h('h3', null, 'Cobrança à franquia (automática)'),
        h('p', { class: 'muted' }, 'Todo mês, no dia e horário escolhidos, o painel envia por e-mail (pelo mesmo e-mail das devoluções) a cobrança do que está pendente. Se não houver nada pendente, não envia. É o mesmo e-mail do botão "Cobrar a franquia" em Notas fiscais → Créditos com a franquia.'),
        h('label', { class: 'cfg-check-l' }, dev, ' Incidências: notas de devolução sem desconto há mais de 30 dias (com os XMLs)'), res('devolucoes'),
        h('label', { class: 'f-label' }, 'Para (incidências)'), paraD,
        h('label', { class: 'cfg-check-l' }, fid, ' Fidelidade: prêmios com o desconto dos royalties atrasado ou que veio a menos (com a planilha dos resgates)'), res('fidelidade'),
        h('label', { class: 'f-label' }, 'Para (fidelidade)'), paraF,
        h('div', { class: 'cfg-grid' }, h('label', null, h('span', { class: 'f-label' }, 'Dia do mês'), dia), h('label', null, h('span', { class: 'f-label' }, 'A partir de'), hora)),
        h('div', { class: 'cfg-acoes' }, acao('Salvar', async () => {
          const r = await fetch(url, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ loja: l.id, devolucoes: dev.checked, fidelidade: fid.checked, dia: dia.value, hora: hora.value, para: { devolucoes: paraD.value, fidelidade: paraF.value } }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
          return (j.devolucoes || j.fidelidade) ? `Pronto: a cobrança sai todo dia ${j.dia}, a partir das ${j.hora}.` : 'Cobrança automática desligada.';
        }, 'btn primary'))].filter(Boolean));
    }).catch((e) => sec.replaceChildren(h('h3', null, 'Cobrança à franquia (automática)'), h('p', { class: 'neg' }, e.message)));
    return sec;
  }

  function blocoWpp(l) {
    const lista = (l.wppModelos && l.wppModelos.length ? l.wppModelos : TS.WPP_PADRAO || []).map((m) => ({ ...m }));
    const sec0 = h('section', { class: 'cfg-bloco cfg-form' }, h('h3', null, 'Mensagens de WhatsApp'));
    const corpo = h('div', { class: 'cfg-wpp' });
    const pintarW = () => {
      corpo.replaceChildren(...lista.map((m, k) => {
        const nome = inp({ value: m.nome, maxlength: 40 });
        const txt = h('textarea', { class: 'f-input', rows: 3, maxlength: 700 }, m.texto);
        nome.addEventListener('input', () => { m.nome = nome.value; });
        txt.addEventListener('input', () => { m.texto = txt.value; });
        return h('div', { class: 'cfg-wpp-item' }, h('div', { class: 'cfg-inline' }, nome, h('button', { type: 'button', class: 'btn ghost-danger', onclick: () => { lista.splice(k, 1); pintarW(); } }, 'Remover')), txt);
      }));
    };
    pintarW();
    const intervalo = inp({ type: 'number', min: 7, max: 90, value: l.wppIntervalo || 21, style: { width: '90px' } });
    sec0.append(h('div', { class: 'cfg-inline cfg-wpp-int' }, h('b', null, 'Uma mensagem a cada'), intervalo, h('span', null, 'dias por cliente'),
        TS.dica('Trava contra mensagem insistente: quem recebeu mensagem da loja (Hoje, ficha do cliente ou campanha) não recebe outra antes desse prazo. Vale para todas as telas; numa campanha dá para pedir um prazo maior.')),
      h('p', { class: 'muted' }, 'Textos que aparecem prontos ao abrir o WhatsApp de um cliente na tela Clientes. Use {nome} (primeiro nome), {loja} e {cha} (chá favorito do cliente).'),
      corpo,
      h('div', { class: 'cfg-acoes' },
        h('button', { type: 'button', class: 'btn', onclick: () => { if (lista.length >= 12) return; lista.push({ nome: 'Nova mensagem', texto: 'Oi, {nome}! ' }); pintarW(); } }, '+ Mensagem'),
        h('button', { type: 'button', class: 'btn', onclick: () => { lista.splice(0, lista.length, ...(TS.WPP_PADRAO || []).map((m) => ({ ...m }))); pintarW(); } }, 'Voltar ao padrão'),
        acao('Salvar mensagens', async () => { await api('PUT', `/lojas/${l.id}/wpp-modelos`, { modelos: lista, intervalo: +intervalo.value }); l.wppIntervalo = +intervalo.value; return 'Mensagens e intervalo salvos.'; }, 'btn primary')));
    return sec0;
  }

  // ---- férias
  function blocoFerias(l) {
    const lista = (l.ferias || []).map((f) => ({ ...f }));
    const nomes = [...new Set([...(l.vendedores || []).map((v) => v.nome.trim().toUpperCase()), ...lista.map((f) => f.vendedor)])].sort();
    const corpo = h('div', { class: 'ferias-lista' });
    const dias = (f) => (f.de && f.ate && f.de <= f.ate ? Math.round((Date.parse(f.ate) - Date.parse(f.de)) / 86400e3) + 1 : null);
    const pintarF = () => {
      corpo.textContent = '';
      if (!lista.length) corpo.append(h('p', { class: 'muted' }, 'Nenhuma férias cadastrada.'));
      lista.forEach((f, i) => {
        const sel = h('select', { class: 'f-input' }, h('option', { value: '' }, '— escolha —'), nomes.map((n) => h('option', { value: n, selected: f.vendedor === n || null }, n)));
        sel.addEventListener('change', () => { f.vendedor = sel.value; sujo = true; });
        const de = inp({ type: 'date', value: f.de || '' }), ate = inp({ type: 'date', value: f.ate || '' });
        const nd = h('span', { class: 'muted' }, dias(f) ? `${dias(f)} dias` : '');
        const upd = () => { f.de = de.value; f.ate = ate.value; nd.textContent = dias(f) ? `${dias(f)} dias` : ''; sujo = true; };
        de.addEventListener('change', upd); ate.addEventListener('change', upd);
        const hoje = TS.hojeSP ? TS.hojeSP() : new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
        corpo.append(h('div', { class: 'ferias-item' + (f.ate && f.ate < hoje ? ' passada' : '') },
          h('label', { class: 'cfg-campo fi-nome' }, h('span', null, 'Vendedora'), sel),
          h('label', { class: 'cfg-campo' }, h('span', null, 'De'), de), h('label', { class: 'cfg-campo' }, h('span', null, 'Até'), ate),
          h('div', { class: 'fi-rodape' }, nd, h('button', { type: 'button', class: 'btn ghost-danger', onclick: () => { lista.splice(i, 1); pintarF(); } }, 'Remover'))));
      });
    };
    pintarF();
    return h('section', { class: 'cfg-bloco cfg-form' }, h('h3', null, 'Férias'),
      h('p', { class: 'muted' }, 'A meta do mês vira meta diária (meta ÷ dias do mês). Em cada dia, ela é dividida só entre quem está trabalhando: quem está de férias fica com a meta menor e as colegas assumem a parte dela nesses dias.'),
      corpo,
      h('div', { class: 'cfg-acoes' },
        h('button', { type: 'button', class: 'btn', onclick: () => { lista.push({ vendedor: '', de: '', ate: '' }); pintarF(); } }, '+ Adicionar férias'),
        acao('Salvar férias', async () => { await api('PUT', `/lojas/${l.id}/ferias`, { ferias: lista.filter((f) => f.vendedor || f.de || f.ate) }); TS.recarregar && TS.recarregar(true); return 'Férias salvas. As metas individuais já foram recalculadas.'; }, 'btn primary')));
  }

  // ---- horário de funcionamento e equipe
  function blocoOperacao(l) {
    const op = JSON.parse(JSON.stringify(l.operacao || TS.operacaoPadrao()));
    return h('section', { class: 'cfg-bloco cfg-form' }, h('h3', null, 'Horário e equipe'),
      h('p', { class: 'muted' }, 'Usados em Equipe → Movimento e escala para calcular quantas pessoas cada horário precisa e sugerir a escala.'),
      TS.editorOperacao(op, () => { sujo = true; }),
      h('div', { class: 'cfg-acoes' }, acao('Salvar horário e equipe', async () => { await api('PUT', `/lojas/${l.id}/operacao`, { operacao: op }); TS.recarregar && TS.recarregar(true); return 'Salvo.'; }, 'btn primary')));
  }

  // ---- marca
  function blocoMarca(l) {
    const nome = inp({ value: (l.marca && l.marca.nome) || '', placeholder: l.nome });
    const arq = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'f-input' });
    const link = `${location.origin}/login?loja=${l.id}`;
    return h('section', { class: 'cfg-bloco cfg-form' }, h('h3', null, 'Logo e nome'),
      h('p', { class: 'muted' }, 'Aparecem no topo do painel e na tela de entrada pelo link próprio da loja.'),
      l.logo ? h('img', { class: 'cfg-logo-prev', src: `/marca/${l.id}/logo?v=${Date.now() % 1e6}`, alt: 'Logo atual' }) : h('p', { class: 'muted' }, 'Sem logo (usa o ícone do Tea Shop).'),
      h('div', { class: 'cfg-grid' }, campo('Nome exibido', nome), campo('Logo (PNG, JPG ou WEBP, até 500 KB)', arq)),
      campo('Link de entrada da loja', h('div', { class: 'cfg-inline' }, inp({ value: link, readonly: true }), h('button', { type: 'button', class: 'btn', onclick: () => { navigator.clipboard?.writeText(link); toast('Link copiado.'); } }, 'Copiar'))),
      h('div', { class: 'cfg-acoes' },
        acao('Salvar', async () => {
          await api('PUT', `/lojas/${l.id}/marca`, { nome: nome.value });
          const f = arq.files[0];
          if (f) { if (f.size > 500 * 1024) throw new Error('Imagem grande demais (máx. 500 KB).'); await api('POST', `/lojas/${l.id}/logo`, f); }
          return 'Marca salva. Recarregue o painel para ver no topo.';
        }, 'btn primary'),
        l.logo ? acao('Remover logo', async () => { await api('DELETE', `/lojas/${l.id}/logo`); return 'Logo removido.'; }, 'btn ghost-danger') : null));
  }

  // ---- regras de comissão
  function blocoRegras(l) {
    const R = TS.rules;
    const modeloAuto = R.modeloPorNome((l.nomesVenda || [])[0]);
    const efetivas = () => (l.regras ? R.fundir(R.MODELOS[l.regras.modelo] ? R.MODELOS[l.regras.modelo].regras : R.MODELOS.padrao.regras, l.regras) : { ...R.MODELOS[modeloAuto].regras, modelo: modeloAuto });
    let rg = efetivas(); rg.modelo = rg.modelo || (l.regras && l.regras.modelo) || modeloAuto;
    const sec = h('section', { class: 'cfg-bloco cfg-form cfg-regras' });
    const pctIn = (v) => inp({ type: 'number', min: 0, max: 100, step: 0.1, value: +(v * 100).toFixed(3) });
    const numIn = (v, step = 1) => inp({ type: 'number', min: 0, step, value: v });
    const lePct = (i) => Math.round(+i.value * 1000) / 100000;
    function pintarR() {
      sec.textContent = '';
      const modelo = h('select', { class: 'f-input' }, Object.entries(R.MODELOS).map(([k, m]) => h('option', { value: k, selected: rg.modelo === k || null }, m.nome)));
      modelo.addEventListener('change', () => { rg = { ...JSON.parse(JSON.stringify(R.MODELOS[modelo.value].regras)), modelo: modelo.value }; pintarR(); });
      const dv = { arom: pctIn(rg.divisaoMeta.arom), puro: pctIn(rg.divisaoMeta.puro), acess: pctIn(rg.divisaoMeta.acess) };
      const modo = h('select', { class: 'f-input' }, h('option', { value: 'faixas', selected: rg.comissao.modo === 'faixas' || null }, 'Por faixas (≥120%, bateu, abaixo)'), h('option', { value: 'simples', selected: rg.comissao.modo === 'simples' || null }, 'Simples (bateu / não bateu)'));
      const cm = {};
      const linhas = [['arom', 'Chá aromatizado'], ['puro', 'Chá puro'], ['acess', 'Acessórios']].map(([k, nome]) => {
        cm[k] = { acima120: pctIn(rg.comissao[k].acima120), bate: pctIn(rg.comissao[k].bate), abaixo: pctIn(rg.comissao[k].abaixo) };
        return h('tr', null, h('td', { class: 'l' }, nome), h('td', { class: 'c120' }, cm[k].acima120), h('td', null, cm[k].bate), h('td', null, cm[k].abaixo));
      });
      const tabCom = h('table', { class: 'cfg-rt' + (rg.comissao.modo === 'simples' ? ' simples' : '') }, h('thead', null, h('tr', null, h('th', { class: 'l' }, '% de comissão'), h('th', { class: 'c120' }, '≥ 120% da meta'), h('th', null, 'Bateu a meta'), h('th', null, 'Abaixo da meta'))), h('tbody', null, linhas));
      modo.addEventListener('change', () => tabCom.classList.toggle('simples', modo.value === 'simples'));
      const pr = rg.premiacao;
      const prAtiva = h('input', { type: 'checkbox', checked: pr.ativa || null });
      const prV = numIn(pr.valor, 5), prT = numIn(pr.tkm, 1), prI = numIn(pr.ipa, 0.1), prP = numIn(pr.pma, 0.01);
      const prMin = h('select', { class: 'f-input' }, [1, 2, 3].map((n) => h('option', { value: n, selected: pr.minimo === n || null }, `${n} de 3`)));
      const prAt = inp({ type: 'number', min: 0, max: 2000, step: 1, value: pr.minAtend ?? TS.contas.MIN_ATEND_PREMIACAO, 'data-regra': 'minAtend' });
      const pisoMeta = inp({ type: 'number', min: 1, max: 31, step: 1, value: rg.pisoDiasMeta ?? TS.contas.PISO_DIAS_META, 'data-regra': 'pisoDiasMeta' });
      const bn = { acima120: pctIn(rg.bonus.acima120), bate: pctIn(rg.bonus.bate), abaixo: pctIn(rg.bonus.abaixo) };
      const rtAtivo = h('input', { type: 'checkbox', checked: rg.rateio.ativo || null });
      const rtExc = inp({ value: (rg.rateio.exclui || []).join(', '), placeholder: 'nomes separados por vírgula' });
      const gjModo = h('select', { class: 'f-input' }, h('option', { value: 'proporcional', selected: rg.gorjeta.modo === 'proporcional' || null }, 'Proporcional ao faturamento no Espaço Gourmet'), h('option', { value: 'igual', selected: rg.gorjeta.modo === 'igual' || null }, 'Igual entre os vendedores ativos'));
      const gjPct = pctIn(rg.gorjeta.percentual);
      const ry = { loja: pctIn(rg.royalties.loja), mkt: pctIn(rg.royalties.mkt), eg: pctIn(rg.royalties.eg), egMkt: pctIn(rg.royalties.egMkt) };
      const semMeta = inp({ value: (rg.semMeta || []).join(', '), placeholder: 'nomes separados por vírgula' });
      const semCom = inp({ value: (rg.semComissao || []).join(', '), placeholder: 'nomes separados por vírgula' });
      sec.append(h('h3', null, 'Regras de comissão'),
        h('p', { class: 'muted' }, l.regras ? 'Regras próprias desta loja.' : `Usando o modelo "${R.MODELOS[modeloAuto].nome}" (padrão para esta loja). Ajuste e salve para ter regras próprias.`),
        h('div', { class: 'cfg-grid' }, campo('Modelo de partida', modelo, 'Trocar o modelo preenche os campos com os valores dele.'), campo('Tipo de comissão', modo)),
        h('div', { class: 'f-label', style: { marginTop: '12px' } }, 'Divisão da meta de cada vendedor (soma 100%)'),
        h('div', { class: 'cfg-grid c3' }, campo('Chá aromatizado %', dv.arom), campo('Chá puro %', dv.puro), campo('Acessórios %', dv.acess)),
        h('div', { class: 'table-wrap free', style: { marginTop: '12px' } }, tabCom),
        h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Premiação por indicadores'),
        h('label', { class: 'cfg-check-l' }, prAtiva, ' Pagar premiação'),
        h('div', { class: 'cfg-grid c3' }, campo('Valor por critério (R$)', prV), campo('TKM mínimo (R$)', prT), campo('IPA mínimo', prI), campo('PMA mínimo (R$)', prP), campo('Critérios necessários', prMin),
          campo('Mínimo de atendimentos no mês', prAt, 'Só concorre à premiação quem atendeu pelo menos esse número de cupons no mês (padrão 20; 0 = sem mínimo). Com poucos atendimentos, TKM, IPA e PMA são sorte, não desempenho. Abaixo disso a tela mostra "poucos atendimentos".')),
        h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Bônus sobre as vendas dos outros vendedores (vendedor escolhido nos filtros)'),
        h('div', { class: 'cfg-grid c3' }, campo('Loja abaixo da meta %', bn.abaixo), campo('Loja bateu a meta %', bn.bate), campo('Loja ≥ 120% %', bn.acima120)),
        h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Rateio'),
        h('label', { class: 'cfg-check-l' }, rtAtivo, ' Dividir o total de comissões igualmente entre os vendedores'),
        campo('Não entram no rateio', rtExc),
        h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Gorjeta (taxa de serviço)'),
        h('div', { class: 'cfg-grid' }, campo('Como divide', gjModo), campo('% da taxa repassada aos vendedores', gjPct)),
        h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Royalties'),
        h('div', { class: 'cfg-grid c3' }, campo('Loja %', ry.loja), campo('Marketing %', ry.mkt), campo('Espaço Gourmet %', ry.eg), campo('EG marketing %', ry.egMkt)),
        campo('Divide a meta quem tem pelo menos (dias com venda no mês)', pisoMeta, 'Padrão 4. A meta da loja é dividida só entre quem vendeu em pelo menos esse número de dias no mês; quem cobriu um ou dois dias não diminui a meta dos outros (e continua recebendo a comissão pela faixa, comparada com a mesma meta individual dos demais). No mês em andamento o piso acompanha os dias corridos: até o dia 7 todos com venda dividem. Use 1 para voltar à regra antiga (qualquer venda divide).'),
        campo('Vendedores sem meta individual', semMeta, 'Não dividem a meta da loja (ex.: corporativo, gerente) e recebem a comissão mínima (a taxa "abaixo da meta") sobre o que venderam.'),
        campo('Não recebem comissão', semCom, 'Ficam sem comissão e sem premiação (a gorjeta continua). Ex.: corporativo, sócio.'),
        h('div', { class: 'cfg-acoes' },
          acao('Salvar regras', async () => {
            const lista = (i) => i.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
            const regras = {
              modelo: modelo.value,
              divisaoMeta: { arom: lePct(dv.arom), puro: lePct(dv.puro), acess: lePct(dv.acess) },
              comissao: { modo: modo.value, ...Object.fromEntries(Object.entries(cm).map(([k, o]) => [k, { acima120: lePct(o.acima120), bate: lePct(o.bate), abaixo: lePct(o.abaixo) }])) },
              premiacao: { ativa: prAtiva.checked, valor: +prV.value, tkm: +prT.value, ipa: +prI.value, pma: +prP.value, minimo: +prMin.value, minAtend: Math.max(0, Math.round(+prAt.value || 0)) },
              pisoDiasMeta: Math.min(31, Math.max(1, Math.round(+pisoMeta.value || TS.contas.PISO_DIAS_META))),
              bonus: { abaixo: lePct(bn.abaixo), bate: lePct(bn.bate), acima120: lePct(bn.acima120) },
              rateio: { ativo: rtAtivo.checked, exclui: lista(rtExc) },
              gorjeta: { modo: gjModo.value, percentual: lePct(gjPct) },
              royalties: { loja: lePct(ry.loja), mkt: lePct(ry.mkt), eg: lePct(ry.eg), egMkt: lePct(ry.egMkt) },
              semMeta: lista(semMeta),
              semComissao: lista(semCom),
            };
            await api('PUT', `/lojas/${l.id}/regras`, { regras });
            TS.recarregar && TS.recarregar(true);
            return 'Regras salvas. A tela Comissionamento já usa os novos valores.';
          }, 'btn primary'),
          l.regras ? acao('Voltar ao modelo padrão da loja', async () => { await api('PUT', `/lojas/${l.id}/regras`, { regras: null }); TS.recarregar && TS.recarregar(true); return 'Regras próprias removidas.'; }) : null));
    }
    pintarR();
    return sec;
  }

  // ---- editar / remover
  function blocoEditar(l) {
    const nome = inp({ value: l.nome });
    const appnext = inp({ value: l.appnext || '' });
    const conf = abertos.has('rem:' + l.id);
    return h('section', { class: 'cfg-bloco cfg-form' }, h('h3', null, 'Dados da loja'),
      h('div', { class: 'cfg-grid' }, campo('Nome', nome), campo('Nome no AppNext', appnext), campo('Identificador', inp({ value: l.id, disabled: true }))),
      h('div', { class: 'cfg-acoes' }, acao('Salvar', async () => { await api('PUT', `/lojas/${l.id}`, { nome: nome.value, appnext: appnext.value }); return 'Loja atualizada.'; }, 'btn primary'),
        est.perfil !== 'admin' ? null // remover a loja: só o admin (é da rede)
          : conf ? acao(`Confirmar: remover ${l.nome}`, async () => { await api('DELETE', `/lojas/${l.id}`); abertos.delete('rem:' + l.id); return 'Loja removida (os dados continuam guardados na VPS).'; }, 'btn danger')
            : h('button', { type: 'button', class: 'btn ghost-danger', onclick: () => { abertos.add('rem:' + l.id); pintar(); } }, 'Remover loja…')),
      conf ? h('p', { class: 'muted' }, 'Os usuários perdem o acesso a ela e a atualização automática para. As planilhas e o histórico ficam guardados na VPS.') : null);
  }

  // ======================= USUÁRIOS =======================
  function abaUsuarios(box) {
    const aberto = abertos.has('novoUser');
    const btNovo = h('button', { type: 'button', class: 'btn primary', onclick: () => { aberto ? abertos.delete('novoUser') : abertos.add('novoUser'); state.cfgEdit = null; pintar(); } }, aberto ? 'Fechar' : '+ Novo usuário');
    if (aberto) box.append(formUsuario(null));
    const nomeLoja = new Map(est.todasLojas.map((l) => [l.id, l.nome]));
    // filtros: perfil, loja e situação (guardados enquanto a tela está aberta)
    const fu = (state.cfgUsuFiltro ||= { perfil: '', loja: '', situacao: '' });
    const situacaoDe = (u) => (!u.ativo ? 'desativado' : u.expirado ? 'expirado' : u.acessoAte && diasAte(u.acessoAte) <= 7 ? 'vence' : !u.ultimoAcesso ? 'nunca' : 'ativo');
    const passa = (u) => (!fu.perfil || u.perfil === fu.perfil) && (!fu.loja || u.lojas.includes('*') || u.lojas.includes(fu.loja)) && (!fu.situacao || situacaoDe(u) === fu.situacao || (fu.situacao === 'ativo' && ['ativo', 'vence', 'nunca'].includes(situacaoDe(u))));
    const selF = (k, rot, ops) => { const s = h('select', { class: 'f-input', 'aria-label': rot }, h('option', { value: '' }, rot), ops.map(([v, t]) => h('option', { value: v, selected: fu[k] === v || null }, t))); s.addEventListener('change', () => { fu[k] = s.value; pintar(); }); return s; };
    const usados = est.usuarios.filter(passa);
    const filtros = (h('div', { class: 'cfg-usu-filtros' },
      selF('perfil', 'Todos os perfis', Object.keys(PERFIL_NOME).filter((p) => est.usuarios.some((u) => u.perfil === p)).map((p) => [p, PERFIL_NOME[p]])),
      est.todasLojas.length > 1 ? selF('loja', 'Todas as lojas', est.todasLojas.map((l) => [l.id, l.nome])) : null,
      selF('situacao', 'Todas as situações', [['ativo', 'Ativos'], ['nunca', 'Nunca acessaram'], ['vence', 'Acesso vence em até 7 dias'], ['expirado', 'Acesso terminou'], ['desativado', 'Desativados']]),
      fu.perfil || fu.loja || fu.situacao ? h('button', { type: 'button', class: 'link-btn', onclick: () => { Object.assign(fu, { perfil: '', loja: '', situacao: '' }); pintar(); } }, 'Limpar') : null,
      h('span', { class: 'muted' }, `${usados.length} de ${est.usuarios.length} usuário(s)`)));
    const linhas = usados.map((u) => {
      const tr = h('tr', { class: u.ativo ? '' : 'inativo' },
        h('td', { class: 'l' }, h('b', null, u.nome), u.nome === est.usuario ? h('span', { class: 'muted' }, ' (você)') : null),
        h('td', { class: 'l' }, h('span', { class: 'badge p-' + u.perfil }, PERFIL_NOME[u.perfil]),
          u.perfil === 'gerente' ? h('div', { class: 'muted cfg-telas-resumo' }, u.telas ? `${u.telas.length} tela(s)${u.telas.includes('clientes') ? ' · vê clientes' : ''}` : 'telas padrão') : null,
          u.perfil === 'vendedor' ? h('div', { class: 'muted cfg-telas-resumo' }, u.vendedor ? `nas vendas: ${u.vendedor}` : h('span', { class: 'neg' }, 'sem o nome nas vendas')) : null),
        h('td', { class: 'l wrap' }, u.lojas.includes('*') ? 'Todas' : u.lojas.map((id) => nomeLoja.get(id) || id).join(', ')),
        h('td', { class: 'l' }, u.ultimoAcesso ? dt(u.ultimoAcesso) : h('span', { class: 'muted' }, 'nunca')),
        h('td', { class: 'l' }, !u.ativo ? h('span', { class: 'neg' }, 'Desativado')
          : u.expirado ? h('span', { class: 'neg' }, `Acesso terminou em ${dataBr(u.acessoAte)}`)
            : u.acessoAte ? h('span', null, 'Ativo', h('div', { class: diasAte(u.acessoAte) <= 7 ? 'neg cfg-prazo' : 'muted cfg-prazo' }, `até ${dataBr(u.acessoAte)}${diasAte(u.acessoAte) <= 7 ? ` (${diasAte(u.acessoAte)} dia(s))` : ''}`)) : 'Ativo',
          u.trocarSenha ? h('div', { class: 'cfg-prazo cfg-senha-pend', title: 'No próximo login a pessoa cria a própria senha' }, '🔑 aguardando troca da senha')
            : u.senhaTrocadaEm ? h('div', { class: 'muted cfg-prazo' }, `senha trocada em ${dt(u.senhaTrocadaEm)}`) : null),
        h('td', null, h('button', { type: 'button', class: 'btn', onclick: () => { state.cfgEdit = state.cfgEdit === u.nome ? null : u.nome; abertos.delete('novoUser'); pintar(); } }, state.cfgEdit === u.nome ? 'Fechar' : 'Editar')));
      return state.cfgEdit === u.nome ? [tr, h('tr', { class: 'cfg-edit-row' }, h('td', { colspan: 6 }, formUsuario(u)))] : [tr];
    }).flat();
    const tabela = h('div', { class: 'table-wrap free' }, h('table', { class: 't cfg-t' },
      h('thead', null, h('tr', null, ['Usuário', 'Perfil', 'Lojas', 'Último acesso', 'Situação', ''].map((t, i) => h('th', { class: i < 5 ? 'l' : '' }, t)))),
      h('tbody', null, linhas.length ? linhas : h('tr', null, h('td', { colspan: 6, class: 'l muted' }, est.usuarios.length ? 'Nenhum usuário com esses filtros.' : 'Nenhum usuário.')))));
    const perfis = h('div', { class: 'cfg-perfis' }, Object.entries(PERFIL_DESC).filter(([p]) => est.perfil === 'admin' || ['gerente', 'vendedor'].includes(p)).map(([p, d]) => h('div', null, h('span', { class: 'badge p-' + p }, PERFIL_NOME[p]), ' ', d)));
    // cartão com título e "+ Novo usuário" no cabeçalho (o Imprimir/Expandir entra no mesmo cabeçalho); filtros e legenda dentro
    box.append(TS.cardWithTools('Usuários', 'Quem entra no painel, com qual perfil e em quais lojas. O perfil decide o que a pessoa vê.', btNovo, filtros, tabela, perfis));
  }

  const dataBr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const hojeBR = () => (TS.hojeSP ? TS.hojeSP() : new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10));
  const diasAte = (iso) => Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(hojeBR() + 'T12:00:00Z')) / 864e5);
  function somaMeses(iso, n) {
    const [a, m, d] = iso.split('-').map(Number);
    const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
    const ult = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
    alvo.setUTCDate(Math.min(d, ult));
    return alvo.toISOString().slice(0, 10);
  }

  function senhaAleatoria() {
    const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const a = new Uint32Array(10); crypto.getRandomValues(a);
    return [...a].map((x) => c[x % c.length]).join('');
  }

  function formUsuario(u) {
    const novo = !u;
    const perfis = est.perfil === 'admin' ? ['admin', 'franqueado', 'gerente', 'vendedor'] : ['gerente', 'vendedor'];
    const nome = inp({ value: u ? u.nome : '', disabled: !novo || null, placeholder: 'ex.: maria.torres', autocomplete: 'off' });
    const perfil = h('select', { class: 'f-input', disabled: (u && u.nome === est.usuario) || null }, perfis.map((p) => h('option', { value: p, selected: (u ? u.perfil : 'gerente') === p || null }, PERFIL_NOME[p])));
    const marcadas = new Set(u ? u.lojas : est.todasLojas.length === 1 ? [est.todasLojas[0].id] : []);
    const lojasBox = h('div', { class: 'cfg-checks' });
    const vendSel = h('select', { class: 'f-input' });
    const senha = inp({ type: 'text', autocomplete: 'new-password', placeholder: novo ? 'mínimo 8 caracteres' : 'em branco = mantém a atual' });
    const ativo = h('input', { type: 'checkbox', checked: !u || u.ativo || null, disabled: (u && u.nome === est.usuario) || null });
    const campoLojas = campo('Lojas', lojasBox);
    // prazo de acesso, em meses a partir de hoje
    const proprio = u && u.nome === est.usuario;
    const meses = inp({ type: 'number', min: 0, max: 120, step: 1, placeholder: novo ? 'sem prazo' : 'mantém', style: { maxWidth: '110px' }, disabled: proprio || null });
    const atalhos = h('div', { class: 'chips cfg-meses' }, [1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: 'chip', onclick: () => { meses.value = n; dicaPrazo(); } }, `${n} ${n === 1 ? 'mês' : 'meses'}`)),
      !novo && u.acessoAte ? h('button', { type: 'button', class: 'chip', onclick: () => { meses.value = 0; dicaPrazo(); } }, 'Sem prazo') : null);
    const prazoTxt = h('small', null);
    const dicaPrazo = () => {
      const v = meses.value.trim();
      const atual = u && u.acessoAte ? `Hoje: ${u.expirado ? 'terminou em' : 'até'} ${dataBr(u.acessoAte)}.` : 'Hoje: sem prazo.';
      if (proprio) prazoTxt.textContent = 'Você não pode colocar prazo no próprio acesso.';
      else if (v === '') prazoTxt.textContent = novo ? 'Em branco = sem prazo.' : `${atual} Em branco = mantém.`;
      else if (+v === 0) prazoTxt.textContent = 'Sem prazo: acesso até ser desativado.';
      else prazoTxt.textContent = `Acesso até ${dataBr(somaMeses(hojeBR(), Math.round(+v)))} (último dia).`;
    };
    meses.addEventListener('input', dicaPrazo); dicaPrazo();
    const campoPrazo = h('label', { class: 'cfg-campo', style: { marginBottom: '12px' } }, h('span', null, 'Acesso por (meses)'), h('div', { class: 'cfg-inline' }, meses, atalhos), prazoTxt);
    // telas: a lista única do servidor (src/telas.js), agrupada como no menu; regras fixas vêm travadas
    const CAT = est.telas || [];
    const padraoGer = CAT.flatMap((g) => g.telas.filter((t) => t.gerente === 'escolha' && t.padrao).map((t) => t.id));
    const telasSel = new Set(u && u.perfil === 'gerente' && u.telas ? u.telas : padraoGer);
    const telasBox = h('div', { class: 'cfg-telas' });
    function pintarTelas() {
      const p = perfil.value;
      const ger = p === 'gerente';
      telasBox.replaceChildren(
        h('p', { class: 'muted cfg-telas-leg' }, ger
          ? 'Marque o que este gerente pode ver. 🔒 = regra fixa (não muda aqui). "padrão" = vem marcada para gerente novo.'
          : p === 'vendedor' ? 'A vendedora tem telas fixas (🔒): não dá para mudar aqui.' : 'Admin e franqueado veem todas as telas das suas lojas.'),
        ...CAT.map((g) => h('fieldset', { class: 'cfg-telas-g' }, h('legend', null, g.grupo),
          ...g.telas.map((t) => {
            const r = t[p] || 'nunca';
            const trava = r !== 'escolha';
            const cb = h('input', { type: 'checkbox', value: t.id, 'data-tela': t.id, checked: (trava ? r === 'sempre' : telasSel.has(t.id)) || null, disabled: trava || null });
            if (!trava) cb.addEventListener('change', () => { cb.checked ? telasSel.add(t.id) : telasSel.delete(t.id); });
            const porque = trava ? (p === 'vendedor' && r === 'nunca' && t.fixaVendedor) || t.fixa || (r === 'sempre' ? 'Sempre para este perfil.' : p === 'vendedor' ? 'A vendedora não usa esta tela.' : 'Não disponível para este perfil.') : null;
            return h('label', { class: 'cfg-tela' + (trava ? ' trava' : ''), title: porque || t.dica || null },
              cb, ' ', h('span', null, t.nome), trava ? h('span', { class: 'cfg-tela-lock', 'aria-label': 'regra fixa' }, ' 🔒') : null,
              ger && !trava && t.padrao ? h('span', { class: 'badge cfg-tela-pad' }, 'padrão') : null,
              porque ? h('small', { class: 'muted cfg-tela-pq' }, porque) : t.dica ? h('small', { class: 'muted cfg-tela-pq' }, t.dica) : null);
          }))),
        ger ? h('div', { class: 'cfg-acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => { telasSel.clear(); padraoGer.forEach((x) => telasSel.add(x)); pintarTelas(); } }, 'Voltar ao padrão do gerente')) : null);
    }
    // div (não label): os itens já são <label> com a própria caixa
    const campoTelas = ((rot, el, dica) => h('div', { class: 'cfg-campo' }, h('span', null, rot), el, h('small', null, dica)))('Telas', telasBox, 'Custo e margem (Rentabilidade, Preços, Estoque, Pedido, Notas fiscais, Resultado) e Clientes (CPF e telefone): libere só para quem precisa. O servidor confere a marcação: tela desmarcada também não entrega os dados.');
    const campoVend = campo('Quem é no sistema (nome do vendedor)', vendSel, 'Liga o usuário às vendas dele.');
    function pintarLojas() {
      const p = perfil.value;
      lojasBox.textContent = '';
      campoLojas.hidden = p === 'admin';
      campoVend.hidden = p !== 'vendedor';
      pintarTelas();
      for (const l of est.todasLojas) {
        const cb = h('input', { type: p === 'vendedor' ? 'radio' : 'checkbox', name: 'lojas-' + (u ? u.nome : 'novo'), value: l.id, checked: marcadas.has(l.id) || null });
        cb.addEventListener('change', () => { if (p === 'vendedor') marcadas.clear(); cb.checked ? marcadas.add(l.id) : marcadas.delete(l.id); pintarVend(); });
        lojasBox.append(h('label', null, cb, ' ', l.nome));
      }
      pintarVend();
    }
    function pintarVend() {
      const loja = est.lojas.find((l) => marcadas.has(l.id));
      const lista = loja ? loja.vendedores : [];
      vendSel.textContent = '';
      vendSel.append(h('option', { value: '' }, loja ? '— escolha —' : 'escolha a loja primeiro'));
      const atual = u && u.vendedor;
      if (atual && !lista.some((v) => v.nome.toUpperCase() === atual)) vendSel.append(h('option', { value: atual, selected: true }, atual));
      for (const v of lista) vendSel.append(h('option', { value: v.nome, selected: (atual && v.nome.toUpperCase() === atual) || null }, `${v.nome} (última venda ${dIso(v.ultima)})`));
    }
    perfil.addEventListener('change', () => { if (perfil.value === 'vendedor' && marcadas.size > 1) { const f = [...marcadas][0]; marcadas.clear(); marcadas.add(f); } pintarLojas(); });
    pintarLojas();
    const trocar = h('input', { type: 'checkbox', checked: (novo ? true : !!u.trocarSenha) || null, disabled: (u && u.nome === est.usuario) || null });
    const gerar = h('button', { type: 'button', class: 'btn', onclick: () => { senha.value = senhaAleatoria(); senha.select(); trocar.checked = true; } }, 'Gerar senha');
    senha.addEventListener('input', () => { if (senha.value) trocar.checked = true; });
    return h('div', { class: 'card cfg-form cfg-user-form' }, h('div', { class: 'card-title' }, novo ? 'Novo usuário' : `Editar ${u.nome}`),
      h('div', { class: 'cfg-grid' }, campo('Usuário (login)', nome), campo('Perfil', perfil),
        campo(novo ? 'Senha' : 'Nova senha', h('div', { class: 'cfg-inline' }, senha, gerar), 'Anote e envie para a pessoa: ela não aparece de novo.'),
        h('div', { class: 'cfg-campo' },
          h('label', { class: 'cfg-check' }, ativo, h('span', null, 'Usuário ativo (pode entrar)')),
          h('label', { class: 'cfg-check', title: 'No próximo login a pessoa precisa criar a própria senha antes de usar o painel.' }, trocar, h('span', null, 'Trocar a senha no próximo login')),
          !novo && u.senhaTrocadaEm ? h('small', null, `Trocou a senha em ${dt(u.senhaTrocadaEm)}.`) : null)),
      campoPrazo, campoLojas, campoVend, campoTelas,
      h('div', { class: 'cfg-acoes' },
        acao(novo ? 'Criar usuário' : 'Salvar', async () => {
          const corpo = { perfil: perfil.value, lojas: [...marcadas], vendedor: vendSel.value, ativo: ativo.checked, trocarSenha: trocar.disabled ? undefined : trocar.checked, senha: senha.value || undefined, acessoMeses: meses.value.trim() === '' || proprio ? undefined : Math.round(+meses.value), telas: perfil.value === 'gerente' ? CAT.flatMap((g) => g.telas.filter((t) => t.gerente === 'escolha' && telasSel.has(t.id)).map((t) => t.id)) : undefined };
          if (novo) { await api('POST', '/usuarios', { nome: nome.value.trim().toLowerCase(), ...corpo }); abertos.delete('novoUser'); }
          else { await api('PUT', `/usuarios/${encodeURIComponent(u.nome)}`, corpo); state.cfgEdit = null; }
          return novo ? `Usuário criado.${corpo.senha ? ' Envie a senha para a pessoa.' : ''}` : 'Usuário atualizado.';
        }, 'btn primary'),
        !novo && u.nome !== est.usuario ? acao('Encerrar sessões', async () => { await api('POST', `/usuarios/${encodeURIComponent(u.nome)}/encerrar-sessoes`); return `${u.nome} vai precisar entrar de novo em todos os aparelhos.`; }, 'btn') : null,
        !novo && u.nome !== est.usuario ? (abertos.has('delu:' + u.nome)
          ? acao(`Confirmar: excluir ${u.nome}`, async () => { await api('DELETE', `/usuarios/${encodeURIComponent(u.nome)}`); state.cfgEdit = null; abertos.delete('delu:' + u.nome); return 'Usuário excluído.'; }, 'btn danger')
          : h('button', { type: 'button', class: 'btn ghost-danger', onclick: () => { abertos.add('delu:' + u.nome); pintar(); } }, 'Excluir…')) : null));
  }

  /** editor da semana: um horário ou mais por dia; dia vazio = sem atualização automática */
  const NOMES_DIA = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado', 0: 'Domingo' };
  function editorSemana(semana) {
    const sem = {};
    for (const d of ['0', '1', '2', '3', '4', '5', '6']) sem[d] = [...((semana && semana[d]) || [])];
    const corpo = h('div', { class: 'sem-ed' });
    const pintarSem = () => {
      corpo.replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map((n) => {
        const d = String(n), hs = sem[d].sort();
        const novo = inp({ type: 'time', value: '', style: { maxWidth: '120px' }, 'aria-label': 'Novo horário de ' + NOMES_DIA[n] });
        const add = () => { if (novo.value && !hs.includes(novo.value)) { hs.push(novo.value); pintarSem(); } };
        novo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
        const ultimo = hs.length ? hs[hs.length - 1] : null;
        return h('div', { class: 'sem-dia' + (hs.length ? '' : ' vazio') },
          h('b', { class: 'sem-nome' }, NOMES_DIA[n]),
          h('div', { class: 'chips' }, hs.length ? hs.map((x, i) => h('span', { class: 'chip on' + (x === ultimo ? ' ultimo' : ''), title: x === ultimo ? 'Última do dia: pede o FIXE e o catálogo e envia o fechamento' : null }, x, x === ultimo ? ' ★' : '', ' ',
            h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remover ' + x, onclick: () => { hs.splice(i, 1); pintarSem(); } }, '×'))) : h('span', { class: 'muted' }, 'sem atualização automática')),
          h('span', { class: 'cfg-inline' }, novo, h('button', { type: 'button', class: 'btn', onclick: add }, '+')));
      }), h('div', { class: 'cfg-inline sem-atalhos' },
        h('button', { type: 'button', class: 'btn', onclick: () => { for (const d of ['2', '3', '4', '5', '6']) sem[d] = [...sem['1']]; pintarSem(); } }, 'Copiar segunda para terça a sábado'),
        h('button', { type: 'button', class: 'btn', onclick: () => { sem['0'] = []; pintarSem(); } }, 'Sem atualização no domingo')),
      h('p', { class: 'muted', style: { margin: '6px 0 0' } }, '★ = última do dia: só nela o robô pede as exportações do FIXE (uma vez por dia) e o catálogo de pedidos, e depois sai o e-mail do fechamento. As outras atualizações trazem vendas, XML e estoque.'));
    };
    pintarSem();
    return { el: corpo, valor: () => sem };
  }

  // ======================= COLETOR =======================
  // ---- backup no Google Drive (admin): situação, tamanho, log e "Fazer backup agora"
  let bkp = null;
  function cartaoBackup() {
    const card = h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Backup no Google Drive'));
    if (!bkp) { api('GET', '/backup').then((b) => { bkp = b; pintar(); }).catch(() => { bkp = { erro: true }; }); card.append(h('div', { class: 'muted' }, 'Carregando…')); return card; }
    if (bkp.erro) return null;
    const tam = (b) => (b == null ? '—' : b >= 1e9 ? `${(b / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB` : `${Math.max(1, Math.round(b / 1e6)).toLocaleString('pt-BR')} MB`);
    const u = bkp.ultimoOk;
    const sit = bkp.estado === 'rodando' || bkp.pedido ? linhaSit('rodando', 'Backup', bkp.pedido ? 'na fila (começa em até 1 minuto)' : 'enviando agora', 'A primeira vez envia tudo; as próximas, só o que mudou.')
      : bkp.estado === 'erro' ? linhaSit('erro', 'Backup', h('span', { class: 'neg' }, 'o último falhou'), `${dt(bkp.em)} · ${bkp.msg || 'veja o log'}`, u ? `O último que deu certo foi ${dt(u.em)}.` : null)
        : bkp.estado === 'ok' ? linhaSit('ok', 'Backup', `feito ${dt(bkp.em)}`, `${tam(u && u.bytes)} no Drive, ${fmt.int((u && u.arquivos) || 0)} arquivos, criptografados. Roda sozinho toda madrugada; o que muda fica guardado por 30 dias.`)
          : linhaSit('nada', 'Backup', 'ainda não configurado', 'Na VPS, rode uma vez: bash /opt/teashop-painel/scripts/backup-configurar.sh (ele explica o passo a passo).');
    card.append(h('div', { class: 'cfg-sit' }, sit));
    const pode = bkp.estado && bkp.estado !== 'nao_configurado' && bkp.estado !== 'rodando' && !bkp.pedido;
    if (pode) card.append(h('div', { class: 'cfg-acoes' }, acao('Fazer backup agora', async () => { await api('POST', '/backup'); bkp = null; setTimeout(() => { bkp = null; if (raiz && raiz.isConnected) pintar(); }, 70000); return 'Backup pedido. Começa em até 1 minuto.'; })));
    if (bkp.log && bkp.log.length) card.append(detalhes('bkplog', { class: 'cfg-log' }, h('summary', null, 'Log do último backup'), logBonito(bkp.log)));
    if (bkp.estado === 'rodando' || bkp.pedido) setTimeout(() => { bkp = null; if (raiz && raiz.isConnected && state.cfgAba === 'coletor') pintar(); }, 10000);
    return card;
  }

  function abaColetor(box) {
    if (est.perfil === 'admin') { const c = cartaoBackup(); if (c) box.append(c); }
    if (!est.coletorAtivo) { box.append(h('div', { class: 'notice' }, est.perfil === 'admin' ? 'O coletor não está ligado nesta VPS (falta COLETOR_URL/COLETOR_TOKEN no .env).' : 'A atualização automática não está ligada neste painel.')); return; }
    if (est.perfil !== 'admin') { abaColetorFranqueado(box); return; }
    const ed = editorSemana(est.agenda);
    const proprias = (est.lojas || []).filter((x) => x.horarios && x.horarios.propria).map((x) => x.nome);
    box.append(h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Horários da atualização automática (rede)'),
      h('p', { class: 'muted' }, `Em cada horário o coletor atualiza as lojas, uma de cada vez, baixando os últimos ${est.janela || 7} dias do AppNext (vendas e XML). Do dia 1 ao 5 de cada mês ele refaz também o mês anterior inteiro, para o fechamento pegar correções de última hora. O botão de buscar dados no topo (e o "Atualizar agora") baixa só ontem e hoje. Horário de Brasília.`),
      h('p', { class: 'muted' }, 'Estes são os horários padrão da rede. Cada loja pode ter os seus em Lojas → a loja → Dados e atualização (o franqueado também pode mudar os da loja dele).' + (proprias.length ? ` Com horários próprios: ${proprias.join(', ')}.` : '')),
      est.coletorOk === false ? h('div', { class: 'notice err' }, 'O coletor não está respondendo.') : null,
      ed.el,
      h('div', { class: 'cfg-acoes' }, acao('Salvar horários da rede', async () => { const r = await api('PUT', '/horarios', { semana: ed.valor() }); est.agenda = r.semana; return 'Horários salvos. Valem a partir do próximo minuto.'; }, 'btn primary'))));
    const dias = inp({ type: 'number', min: 1, max: 90, value: est.janela || 7, style: { maxWidth: '110px' } });
    box.append(h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Quantos dias baixar em cada atualização'),
      h('p', { class: 'muted' }, 'O histórico completo entra uma vez, pelo "Importar histórico". Depois, cada atualização só precisa dos dias recentes: quanto menos dias, mais rápido. Use mais dias se a loja costuma corrigir vendas antigas no AppNext (cancelamento, troca de vendedor).'),
      h('div', { class: 'cfg-inline' }, dias, h('span', { class: 'muted' }, 'dias (recomendado: 7)')),
      h('div', { class: 'cfg-acoes' }, acao('Salvar', async () => { const r = await api('PUT', '/janela', { dias: +dias.value }); est.janela = r.dias; return `Pronto: cada atualização baixa os últimos ${r.dias} dias.`; }, 'btn primary'))));
    // avisos de falha por e-mail
    {
      const card = h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Avisos de falha por e-mail'), h('div', { class: 'muted' }, 'Carregando…'));
      box.append(card);
      const montar = (n) => {
        const em = inp({ type: 'email', value: (n.avisos && n.avisos.email) || '', placeholder: 'ex.: seu e-mail', autocomplete: 'email' });
        card.replaceChildren(h('div', { class: 'card-title' }, 'Avisos de falha por e-mail'),
          h('p', { class: 'muted' }, 'O painel manda um e-mail quando: a coleta de vendas, XML, estoque ou o pedido ao FIXE falha duas vezes seguidas; a importação do e-mail do FIXE falha duas vezes seguidas; ou uma loja chega às 10h sem as vendas de ontem (se ela costuma vender nesse dia da semana). Um aviso por problema, e outro quando volta ao normal. Usa o servidor de e-mail do Resumo diário ou, se não houver, o Gmail de uma das lojas.'),
          h('div', { class: 'cfg-grid' }, campo('E-mail que recebe os avisos', em, 'Deixe vazio para não receber avisos.')),
          h('div', { class: 'cfg-acoes' }, acao('Salvar', async () => { await api('PUT', '/notif', { avisos: { email: em.value } }); notif = null; return em.value ? 'Pronto: os avisos vão para ' + em.value + '.' : 'Avisos desligados.'; }, 'btn primary')));
      };
      api('GET', '/notif').then(montar).catch((e) => card.replaceChildren(h('div', { class: 'card-title' }, 'Avisos de falha por e-mail'), h('p', { class: 'neg' }, e.message)));
    }
    box.append(cartaoSituacaoLojas());
  }
  /** franqueado: os horários e os dias da rede aparecem travados (🔒, são do administrador); a situação é só das lojas dele */
  function abaColetorFranqueado(box) {
    const NOMES = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb', 0: 'Dom' };
    const sem = est.agenda || {};
    box.append(h('div', { class: 'card cfg-form cfg-rede-travada' }, h('div', { class: 'card-title' }, 'Horários da atualização automática (rede) 🔒'),
      h('p', { class: 'muted' }, '🔒 Os horários da rede e os dias baixados em cada atualização valem para todas as lojas: só o administrador muda. Os horários da sua loja você muda em Lojas → abra a loja → Dados e atualização.'),
      h('p', null, [1, 2, 3, 4, 5, 6, 0].map((n) => `${NOMES[n]}: ${(sem[String(n)] || []).join(', ') || '—'}`).join(' · ')),
      h('p', { class: 'muted' }, `Cada atualização baixa os últimos ${est.janela || 7} dias do AppNext. "Atualizar agora" e "Importar histórico" ficam em Lojas → abra a loja → Dados e atualização.`)));
    box.append(cartaoSituacaoLojas());
  }
  function cartaoSituacaoLojas() {
    // resumo das lojas
    return (h('div', { class: 'card' }, h('div', { class: 'card-title' }, est.perfil === 'admin' ? 'Situação de cada loja' : 'Situação das suas lojas'),
      h('div', { class: 'table-wrap free' }, h('table', { class: 't cfg-t' },
        h('thead', null, h('tr', null, ['Loja', 'Acesso AppNext', 'Última coleta', 'Situação', 'Dados até'].map((t) => h('th', { class: 'l' }, t)))),
        h('tbody', null, est.lojas.map((l) => {
          const ex = l.status && l.status.execucao;
          const [cls, txt] = situacao(l);
          return h('tr', null, h('td', { class: 'l' }, l.nome), h('td', { class: 'l' }, l.coletor.configurado ? `${l.coletor.usuario}` : h('span', { class: 'muted' }, 'não cadastrado')),
            h('td', { class: 'l' }, ex && ex.fim ? dt(ex.fim) : '—'), h('td', { class: 'l' }, h('span', { class: 'badge ' + cls }, txt)), h('td', { class: 'l' }, l.base.ate ? ymLongo(l.base.ate) : '—'));
        }))))));
  }

  // ======================= RESUMO DIÁRIO =======================
  let notif = null, conversas = null, previa = null;
  function abaResumo(box) {
    if (!notif) { box.append(h('div', { class: 'muted' }, 'Carregando…')); api('GET', '/notif').then((n) => { notif = n; pintar(); }).catch((e) => toast(e.message, true)); return; }
    const n = notif;
    const recarregar = async () => { notif = await api('GET', '/notif'); };
    if (n.restrito) { abaResumoFranqueado(box, n, recarregar); return; }
    const nomeLoja = new Map(est.todasLojas.map((l) => [l.id, l.nome]));
    const lojasTxt = (ls) => (ls.includes('*') ? 'Todas as lojas' : ls.map((x) => nomeLoja.get(x) || x).join(', '));
    const selLojas = (atual) => {
      const marc = new Set(atual || ['*']);
      const el = h('div', { class: 'cfg-checks' }, h('label', null, h('input', { type: 'checkbox', value: '*', checked: marc.has('*') || null }), ' Todas'),
        est.todasLojas.map((l) => h('label', null, h('input', { type: 'checkbox', value: l.id, checked: marc.has(l.id) || null }), ' ', l.nome)));
      el.valor = () => { const v = [...el.querySelectorAll('input:checked')].map((i) => i.value); return v.includes('*') || !v.length ? ['*'] : v; };
      return el;
    };
    // geral
    const ativo = h('input', { type: 'checkbox', checked: n.ativo || null });
    const horario = inp({ type: 'time', value: n.horario, style: { maxWidth: '140px' } });
    const alertas = h('input', { type: 'checkbox', checked: n.alertas || null });
    box.append(h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Resumo diário'),
      h('p', { class: 'muted' }, 'Todo dia, no horário escolhido, cada pessoa recebe o resumo do dia anterior das lojas dela: faturamento, atendimentos, ticket médio, andamento da meta, projeção do mês e alertas.'),
      h('label', { class: 'cfg-check-l' }, ativo, ' Enviar o resumo todos os dias'),
      h('label', { class: 'cfg-check-l' }, alertas, ' Incluir alertas e destaques'),
      h('div', { class: 'cfg-grid' }, campo('Horário (Brasília)', horario)),
      n.ultimoEnvio ? h('p', { class: 'muted' }, `Último envio: ${dIso(n.ultimoEnvio)}`) : null,
      h('div', { class: 'cfg-acoes' }, acao('Salvar', async () => { await api('PUT', '/notif', { ativo: ativo.checked, horario: horario.value, alertas: alertas.checked }); await recarregar(); return 'Salvo.'; }, 'btn primary'),
        acao('Ver prévia da mensagem', async () => { previa = (await api('GET', '/notif/previa?loja=*')).texto; }))));
    if (previa) box.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Prévia'), h('pre', { class: 'cfg-msg' }, previa)));

    // fechamento do dia: configurado em cada loja
    box.append(h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Fechamento do dia'),
      h('p', null, 'O fechamento do dia (que substitui a planilha) é configurado ', h('b', null, 'em cada loja'), ': Configurações → Lojas → abra a loja → ', h('b', null, 'Fechamento do dia por e-mail'), '. Lá cada franquia cadastra o Gmail dela, quem recebe e o horário.'),
      h('p', { class: 'muted' }, 'Os destinatários de e-mail desta tela (abaixo) recebem também o fechamento de cada loja que acompanham: um e-mail por loja, enviado pelo Gmail daquela loja. Use "Testar fechamento" ao lado de cada um para conferir.'),
      h('div', { class: 'cfg-acoes' },
        h('button', { type: 'button', class: 'btn', onclick: () => TS.abrirFechamento(est.lojas.map((l) => ({ id: l.id, nome: l.nome })), state.loja && state.loja !== 'todas' ? state.loja : null) }, 'Ver mensagem'),
        acao('Enviar agora (todas as lojas)', async () => {
          if (!confirm('Enviar agora o fechamento de hoje de todas as lojas, cada uma pelo Gmail dela, para os destinatários de cada loja e os gerais?')) return null;
          const r = await api('POST', '/notif/fechamento/enviar');
          const ok = r.envios.filter((x) => x.ok), falhas = r.envios.filter((x) => !x.ok);
          if (falhas.length) throw new Error(`Enviados ${ok.length}; falharam: ${falhas.map((x) => `${x.loja} → ${x.para} (${x.erro})`).join('; ')}`);
          return `Fechamento enviado: ${ok.length} e-mail(s)/mensagem(ns).`;
        }))));

    // Telegram
    const token = inp({ type: 'password', autocomplete: 'off', placeholder: n.telegram.configurado ? '•••••••• (guardado — preencha só para trocar)' : '123456789:ABC…' });
    const tg = h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Telegram'),
      h('details', null, h('summary', null, 'Como criar o robô (2 minutos)'), h('ol', { class: 'cfg-passos' },
        h('li', null, 'No Telegram, abra o @BotFather e envie /newbot.'), h('li', null, 'Escolha um nome (ex.: Tea Shop Resumo) e um usuário terminado em "bot".'),
        h('li', null, 'Copie o token que ele mostra e cole aqui.'), h('li', null, 'Cada pessoa que vai receber abre o robô e toca em "Iniciar".'), h('li', null, 'Clique em "Buscar quem falou com o robô" e adicione a pessoa.'))),
      h('div', { class: 'cfg-grid' }, campo('Token do robô', token)),
      h('div', { class: 'cfg-acoes' }, acao('Salvar token', async () => { await api('PUT', '/notif', { telegram: { token: token.value } }); await recarregar(); return 'Token salvo.'; }, 'btn primary'),
        n.telegram.configurado ? acao('Buscar quem falou com o robô', async () => { conversas = (await api('GET', '/notif/telegram/conversas')).conversas; return conversas.length ? null : 'Ninguém novo. Peça para a pessoa abrir o robô e tocar em "Iniciar".'; }) : null));
    if (conversas && conversas.length) {
      tg.append(h('div', { class: 'f-label', style: { marginTop: '12px' } }, 'Novas conversas'));
      for (const c of conversas) {
        const sl = selLojas(['*']);
        const nm = inp({ value: c.nome || c.usuario });
        tg.append(h('div', { class: 'cfg-dest' }, h('div', { class: 'cfg-grid' }, campo('Nome', nm), campo('Usuário Telegram', inp({ value: c.usuario ? '@' + c.usuario : c.chatId, disabled: true }))), campo('Recebe as lojas', sl),
          h('div', { class: 'cfg-acoes' }, acao('Adicionar', async () => { await api('POST', '/notif/destinos', { canal: 'telegram', id: c.chatId, nome: nm.value, lojas: sl.valor() }); conversas = conversas.filter((x) => x !== c); await recarregar(); return 'Adicionado.'; }, 'btn primary'))));
      }
    }
    if (n.telegram.destinos.length) tg.append(tabelaDestinos('telegram', n.telegram.destinos, 'chatId', lojasTxt, recarregar));
    box.append(tg);

    // e-mail
    const e = n.email;
    const host = inp({ value: e.host, placeholder: 'ex.: smtp.gmail.com' }), port = inp({ type: 'number', value: e.port || 587 }), user = inp({ value: e.user, autocomplete: 'off' });
    const pass = inp({ type: 'password', autocomplete: 'new-password', placeholder: e.temSenha ? '•••••••• (guardada)' : '' }), from = inp({ value: e.from, placeholder: 'ex.: Tea Shop <seuemail@gmail.com>' });
    const sec = h('input', { type: 'checkbox', checked: e.secure || null });
    const novoEmail = inp({ type: 'email', placeholder: 'pessoa@email.com' }), novoNome = inp({ placeholder: 'Nome' }), novoLojas = selLojas(['*']);
    const em = h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'E-mail geral (resumo diário e franqueador)'), h('p', { class: 'muted' }, 'Servidor usado no resumo diário. Cada loja pode ter o próprio Gmail para o fechamento do dia (em Lojas); a loja que ainda não tiver usa este.'),
      passoGmail('gmail', { host, port, sec, from, user }),
      h('div', { class: 'cfg-grid' }, campo('Servidor (SMTP)', host), campo('Porta', port), campo('Usuário', user), campo('Senha', pass), campo('Remetente', from)),
      h('label', { class: 'cfg-check-l' }, sec, ' Conexão segura direta (porta 465)'),
      h('div', { class: 'cfg-acoes' }, acao('Salvar servidor', async () => {
        // Gmail sem servidor preenchido: completa sozinho (o cinza no campo é só um exemplo)
        if (!host.value.trim() && /@gmail\.com$/i.test(user.value.trim())) { host.value = 'smtp.gmail.com'; if (!port.value) port.value = 587; }
        if (!host.value.trim()) throw new Error('Preencha o Servidor (SMTP). Para Gmail: smtp.gmail.com (ou clique em "Preencher para Gmail").');
        if (!from.value.trim()) { if (user.value.trim()) from.value = `Tea Shop <${user.value.trim()}>`; else throw new Error('Preencha o Remetente.'); }
        await api('PUT', '/notif', { email: { host: host.value, port: port.value, user: user.value, pass: pass.value || undefined, from: from.value, secure: sec.checked } }); await recarregar();
        return 'Servidor salvo. Agora cadastre os destinatários logo abaixo.';
      }, 'btn primary')));
    if (!e.configurado) em.append(h('div', { class: 'notice', style: { marginTop: '14px' } }, h('b', null, 'Destinatários: '), e.host ? 'preencha também o Remetente e clique em "Salvar servidor".' : 'o Servidor (SMTP) ainda está vazio. Preencha (Gmail: smtp.gmail.com) e clique em "Salvar servidor"; logo depois aparece aqui o campo para adicionar quem recebe.'));
    if (e.configurado) {
      em.append(h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Adicionar destinatário geral (ex.: franqueador)'),
        h('div', { class: 'cfg-grid' }, campo('E-mail', novoEmail), campo('Nome', novoNome)), campo('Recebe as lojas', novoLojas),
        h('div', { class: 'cfg-acoes' }, acao('Adicionar', async () => { await api('POST', '/notif/destinos', { canal: 'email', id: novoEmail.value, nome: novoNome.value, lojas: novoLojas.valor() }); await recarregar(); return 'Adicionado.'; }, 'btn primary')));
      if (e.destinos.length) em.append(tabelaDestinos('email', e.destinos, 'email', lojasTxt, recarregar));
    }
    box.append(em);
  }
  /** franqueado: horário, ativação, robô do Telegram e servidor de e-mail são da rede (travados, 🔒); ele cuida de quem recebe as lojas dele */
  function abaResumoFranqueado(box, n, recarregar) {
    const nomeLoja = new Map(est.todasLojas.map((l) => [l.id, l.nome]));
    const lojasTxt = (ls) => ls.map((x) => nomeLoja.get(x) || x).join(', ');
    const selLojas = () => {
      const el = h('div', { class: 'cfg-checks' }, est.todasLojas.map((l) => h('label', null, h('input', { type: 'checkbox', value: l.id, checked: est.todasLojas.length === 1 || null }), ' ', l.nome)));
      el.valor = () => [...el.querySelectorAll('input:checked')].map((i) => i.value);
      return el;
    };
    box.append(h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Resumo diário'),
      h('p', { class: 'muted' }, 'Todo dia, no horário escolhido, cada pessoa recebe o resumo do dia anterior das lojas dela: faturamento, atendimentos, ticket médio, andamento da meta, projeção do mês e alertas.'),
      h('label', { class: 'cfg-check-l' }, h('input', { type: 'checkbox', checked: n.ativo || null, disabled: true }), ' Enviar o resumo todos os dias 🔒'),
      h('label', { class: 'cfg-check-l' }, h('input', { type: 'checkbox', checked: n.alertas || null, disabled: true }), ' Incluir alertas e destaques 🔒'),
      h('div', { class: 'cfg-grid' }, campo('Horário (Brasília) 🔒', inp({ type: 'time', value: n.horario, disabled: true, style: { maxWidth: '140px' } }))),
      h('p', { class: 'muted' }, '🔒 O horário, a ativação, o robô do Telegram e o servidor de e-mail valem para todas as lojas: só o administrador muda. Aqui você cuida de quem recebe o resumo das suas lojas.'),
      n.ultimoEnvio ? h('p', { class: 'muted' }, `Último envio: ${dIso(n.ultimoEnvio)}`) : null,
      h('div', { class: 'cfg-acoes' }, acao('Ver prévia da mensagem', async () => { previa = (await api('GET', '/notif/previa?loja=*')).texto; }))));
    if (previa) box.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Prévia'), h('pre', { class: 'cfg-msg' }, previa)));

    box.append(h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Fechamento do dia'),
      h('p', null, 'O fechamento do dia (que substitui a planilha) é configurado ', h('b', null, 'em cada loja'), ': Configurações → Lojas → abra a loja → ', h('b', null, 'Fechamento do dia por e-mail'), '.'),
      h('div', { class: 'cfg-acoes' },
        h('button', { type: 'button', class: 'btn', onclick: () => TS.abrirFechamento(est.lojas.map((l) => ({ id: l.id, nome: l.nome })), state.loja && state.loja !== 'todas' ? state.loja : null) }, 'Ver mensagem'),
        acao(est.lojas.length > 1 ? 'Enviar agora (suas lojas)' : 'Enviar agora', async () => {
          if (!confirm('Enviar agora o fechamento de hoje ' + (est.lojas.length > 1 ? 'das suas lojas' : 'da sua loja') + ' para os destinatários cadastrados?')) return null;
          const r = await api('POST', '/notif/fechamento/enviar');
          const ok = r.envios.filter((x) => x.ok), falhas = r.envios.filter((x) => !x.ok);
          if (falhas.length) throw new Error(`Enviados ${ok.length}; falharam: ${falhas.map((x) => `${x.loja} → ${x.para} (${x.erro})`).join('; ')}`);
          return `Fechamento enviado: ${ok.length} e-mail(s)/mensagem(ns).`;
        }))));

    const novoEmail = inp({ type: 'email', placeholder: 'pessoa@email.com' }), novoNome = inp({ placeholder: 'Nome' }), novoLojas = selLojas();
    const em = h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Quem recebe o resumo das suas lojas (e-mail)'));
    if (!n.email.configurado) em.append(h('div', { class: 'notice' }, 'O servidor de e-mail do resumo diário ainda não foi configurado pelo administrador. Sem ele o resumo não sai por e-mail.'));
    else {
      em.append(h('div', { class: 'cfg-grid' }, campo('E-mail', novoEmail), campo('Nome', novoNome)), campo('Recebe as lojas', novoLojas),
        h('div', { class: 'cfg-acoes' }, acao('Adicionar', async () => {
          if (!novoLojas.valor().length) throw new Error('Marque pelo menos uma loja.');
          await api('POST', '/notif/destinos', { canal: 'email', id: novoEmail.value, nome: novoNome.value, lojas: novoLojas.valor() }); await recarregar(); return 'Adicionado.';
        }, 'btn primary')));
      if (n.email.destinos.length) em.append(tabelaDestinos('email', n.email.destinos, 'email', lojasTxt, recarregar));
      else em.append(h('p', { class: 'muted' }, 'Ninguém cadastrado ainda para as suas lojas.'));
    }
    box.append(em);
    const tg = h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Telegram 🔒'),
      h('p', { class: 'muted' }, n.telegram.configurado ? '🔒 O robô do Telegram é da rede: para incluir uma pessoa nova, peça ao administrador. Quem já recebe só as suas lojas aparece abaixo.' : '🔒 O robô do Telegram é da rede e ainda não foi configurado pelo administrador.'));
    if (n.telegram.destinos.length) tg.append(tabelaDestinos('telegram', n.telegram.destinos, 'chatId', lojasTxt, recarregar));
    box.append(tg);
  }
  /** passo a passo do Gmail (usado no e-mail geral e no de cada loja) */
  function passoGmail(chave, { host, port, sec, from, user }) {
    return detalhes(chave, { class: 'cfg-gmail' }, h('summary', null, 'Passo a passo: enviar pelo Gmail'),
        h('p', null, 'O painel envia os e-mails por uma conta do Gmail. Use de preferência uma conta só para isso (ex.: teashop.painel@gmail.com) e não o seu e-mail pessoal. Leva uns 5 minutos.'),
        h('ol', null,
          h('li', null, h('b', null, 'Entre na conta do Gmail'), ' que vai enviar os e-mails e abra ', h('b', null, 'myaccount.google.com'), ' (ou clique na sua foto → "Gerenciar sua Conta do Google").'),
          h('li', null, 'No menu, clique em ', h('b', null, 'Segurança'), ' (no celular: "Segurança e login").'),
          h('li', null, 'Em "Como você faz login no Google", ative a ', h('b', null, 'Verificação em duas etapas'), '. O Google pede o seu celular e manda um código por SMS. Sem isso, o passo 5 não aparece.'),
          h('li', null, 'Volte para Segurança e, na busca do topo, digite ', h('b', null, 'Senhas de app'), ' (ou abra direto ', h('b', null, 'myaccount.google.com/apppasswords'), ').'),
          h('li', null, 'Em "Nome do app", escreva ', h('b', null, 'Painel Tea Shop'), ' e clique em ', h('b', null, 'Criar'), '. O Google mostra uma senha de ', h('b', null, '16 letras'), ' (ex.: abcd efgh ijkl mnop). ', h('b', null, 'Copie agora'), ': ela não aparece de novo.'),
          h('li', null, 'Aqui no painel, clique em ', h('b', null, 'Preencher para Gmail'), ' (abaixo) e complete:',
            h('ul', null,
              h('li', null, h('b', null, 'Usuário'), ': o endereço completo do Gmail (ex.: teashop.painel@gmail.com).'),
              h('li', null, h('b', null, 'Senha'), ': a senha de 16 letras do passo 5 (com ou sem espaços). ', h('b', null, 'Não'), ' é a senha normal do Gmail.'),
              h('li', null, h('b', null, 'Remetente'), ': como o e-mail vai aparecer, ex.: ', h('code', null, 'Tea Shop Flamboyant <teashop.painel@gmail.com>'), ' (o endereço entre < > precisa ser o mesmo do usuário).'))),
          h('li', null, 'Clique em ', h('b', null, 'Salvar servidor'), '. Depois, em "Adicionar destinatário", cadastre quem vai receber e use ', h('b', null, 'Testar fechamento'), ' para conferir.')),
        h('p', { class: 'muted' }, 'Se o teste der erro "Username and Password not accepted": a senha usada não é a senha de app, ou a verificação em duas etapas não está ativa. Se o e-mail cair no spam, peça para quem recebe marcar "Não é spam" uma vez. Para trocar a senha de app depois, crie outra no passo 5 e cole aqui; a antiga pode ser apagada no Google.'),
        h('button', { type: 'button', class: 'btn', onclick: () => { host.value = 'smtp.gmail.com'; port.value = 587; sec.checked = false; if (!from.value && user.value) from.value = `Tea Shop <${user.value}>`; user.focus(); toast('Servidor e porta do Gmail preenchidos. Complete usuário, senha de app e remetente.'); } }, 'Preencher para Gmail'));
  }

  function tabelaDestinos(canal, lista, chave, lojasTxt, recarregar) {
    return h('div', { class: 'table-wrap free', style: { marginTop: '12px' } }, h('table', { class: 't cfg-t' },
      h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Quem'), h('th', { class: 'l' }, 'Lojas'), h('th', null, ''))),
      h('tbody', null, lista.map((d) => h('tr', null, h('td', { class: 'l' }, h('b', null, d.nome || d[chave]), canal === 'email' ? h('div', { class: 'muted' }, d.email) : null), h('td', { class: 'l' }, lojasTxt(d.lojas)),
        h('td', null, h('div', { class: 'cfg-inline', style: { justifyContent: 'flex-end' } },
          acao('Testar resumo', async () => { await api('POST', '/notif/teste', { canal, id: d[chave] }); return 'Resumo de teste enviado.'; }),
          acao('Testar fechamento', async () => { await api('POST', '/notif/teste', { canal, id: d[chave], tipo: 'fechamento' }); return 'Fechamento de hoje enviado.'; }),
          acao('Remover', async () => { await api('POST', '/notif/destinos', { canal, id: d[chave], remover: true }); await recarregar(); return 'Removido.'; }, 'btn ghost-danger'))))))));
  }

  // ======================= HISTÓRICO =======================
  // ======================= ERROS NAS TELAS =======================
  /** erros de JavaScript da loja (src/errostela.js): um por linha, com quantas vezes, em que telas, perfis, lojas e navegadores */
  let errosTela = null;
  function abaErros(box) {
    const carregar = async () => {
      try { const r = await fetch(TS.api('erros-tela?dias=7'), { credentials: 'same-origin' }); const j = await r.json(); if (!r.ok) throw new Error(j.erro || 'Falha ao carregar.'); errosTela = j; }
      catch (e) { errosTela = { erro: TS.erroDeRede && TS.erroDeRede(e) ? 'Sem conexão com o painel agora.' : e.message }; }
      if (state.page === 'config' && state.cfgAba === 'erros') pintar();
    };
    if (!errosTela) { box.append(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Carregando os erros das telas…'))); carregar(); return; }
    const j = errosTela; errosTela = null; // da próxima vez que abrir a aba, busca de novo
    if (j.erro) { box.append(h('div', { class: 'notice err' }, j.erro)); return; }
    const nomeLoja = new Map((TS.lojas || []).map((l) => [l.id, l.nome]));
    const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const novo = (g) => g.primeira >= new Date(Date.now() - 2 * 864e5).toISOString();
    const rows = (j.itens || []).map((g) => ({ ...g, _telas: g.telas.join(', '), _onde: [g.perfis.join(', '), g.lojas.map((id) => nomeLoja.get(id) || id).join(', ')].filter(Boolean).join(' · ') }));
    const tab = TS.table({
      cols: [
        { key: 'msg', label: 'Erro', align: 'l', wrap: true, sticky: true, title: 'A mensagem do erro, sem dado pessoal (números longos, e-mails e textos digitados são trocados). Embaixo, o arquivo e a linha do código.',
          render: (g) => h('div', null, h('b', null, g.msg), novo(g) ? h('span', { class: 'badge warn cfg-erro-novo' }, 'novo') : null, h('small', { class: 'muted cfg-erro-sub' }, [g.arq ? `${g.arq}${g.ln ? ':' + g.ln : ''}` : '', g.tipo === 'promessa' ? 'em segundo plano' : ''].filter(Boolean).join(' · '))) },
        { key: '_telas', label: 'Telas', align: 'l', wrap: true, title: 'Em que telas aconteceu.' },
        { key: 'vezes', label: 'Vezes', fmt: (v) => fmt.int(v), title: 'Quantas vezes aconteceu nos últimos 7 dias (a mesma pessoa conta no máximo uma vez a cada 10 minutos).' },
        { key: '_onde', label: 'Quem e onde', align: 'l', wrap: true, title: 'Perfis e lojas de quem estava usando (nunca o nome da pessoa).', render: (g) => h('div', null, g._onde || '—', h('small', { class: 'muted cfg-erro-sub' }, g.navs.join(', '))) },
        { key: 'ultima', label: 'Última vez', align: 'l', title: 'Quando aconteceu pela última vez; embaixo, a primeira.', render: (g) => h('div', null, quando(g.ultima), h('small', { class: 'muted cfg-erro-sub' }, 'desde ' + quando(g.primeira))) },
      ],
      rows, sortKey: 'ultima', sortDir: 'desc', search: 'Buscar erro ou tela…', searchKeys: ['msg', '_telas', 'arq'], cls: 'cfg-erros-t',
      empty: 'Nenhum erro nas telas nos últimos 7 dias. 👏',
    });
    const n = rows.length, nNovos = rows.filter(novo).length;
    box.append(TS.card('Erros nas telas (últimos 7 dias)', `${n ? `${fmt.int(n)} erro(s) diferentes${nNovos ? `, ${fmt.int(nNovos)} novo(s) nos últimos 2 dias` : ''}.` : 'Tudo certo.'} O painel avisa sozinho quando uma tela dá erro no celular ou no computador de alguém da equipe, sem dado pessoal. Mande para o suporte do painel os que se repetem.`, tab));
  }

  function abaHistorico(box) {
    const fmtDet = (d) => {
      if (!d) return '';
      const val = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a} = ${b ?? 'padrão'}`).join(', ') : v === true ? 'sim' : v === false ? 'não' : v);
      return Object.entries(d).filter(([k, v]) => k !== 'loja' && v != null && v !== '').map(([k, v]) => `${k}: ${val(v)}`).join(' · ');
    };
    // loja de cada alteração: a do detalhe ou o próprio "onde" quando ele é uma loja
    const nomeLoja = new Map((est.todasLojas || []).map((l) => [l.id, l.nome]));
    const lojaDe = (e) => (e.detalhe && nomeLoja.has(e.detalhe.loja) ? e.detalhe.loja : nomeLoja.has(e.alvo) ? e.alvo : '');
    const todas = est.auditoria.map((e) => { const lj = lojaDe(e); return { ...e, lojaId: lj, loja: lj ? nomeLoja.get(lj) : '—', onde: lj && e.alvo === lj ? '—' : e.alvo || '—', dia: String(new Date(e.em).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })), det: fmtDet(e.detalhe) }; });
    // filtros: período, quem, onde e loja
    const fa = (state.cfgAud ||= { de: '', ate: '', por: '', onde: '', loja: '' });
    const unicos = (k) => [...new Set(todas.map((x) => x[k]).filter((v) => v && v !== '—'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const data = (k) => { const i = inp({ type: 'date', value: fa[k], style: { maxWidth: '160px' } }); i.addEventListener('change', () => { fa[k] = i.value; pintar(); }); return i; };
    const sel = (k, rot, ops) => { const x = h('select', { class: 'f-input', 'aria-label': rot }, h('option', { value: '' }, rot), ops.map(([v, t]) => h('option', { value: v, selected: fa[k] === v || null }, t))); x.addEventListener('change', () => { fa[k] = x.value; pintar(); }); return x; };
    const rows = todas.filter((x) => (!fa.de || x.dia >= fa.de) && (!fa.ate || x.dia <= fa.ate) && (!fa.por || x.por === fa.por) && (!fa.onde || x.onde === fa.onde) && (!fa.loja || x.lojaId === fa.loja));
    const algum = fa.de || fa.ate || fa.por || fa.onde || fa.loja;
    const filtros = h('div', { class: 'cfg-usu-filtros' },
      h('label', { class: 'cfg-inline' }, h('span', { class: 'muted' }, 'De'), data('de')), h('label', { class: 'cfg-inline' }, h('span', { class: 'muted' }, 'até'), data('ate')),
      sel('por', 'Quem: todos', unicos('por').map((v) => [v, v])),
      nomeLoja.size > 1 ? sel('loja', 'Loja: todas', [...nomeLoja].filter(([id]) => todas.some((x) => x.lojaId === id)).map(([id, n]) => [id, n])) : null,
      sel('onde', 'Onde: todos', unicos('onde').map((v) => [v, v])),
      algum ? h('button', { type: 'button', class: 'link-btn', onclick: () => { Object.assign(fa, { de: '', ate: '', por: '', onde: '', loja: '' }); pintar(); } }, 'Limpar') : null,
      h('span', { class: 'muted' }, `${rows.length} de ${todas.length} alteração(ões)`));
    const tab = TS.table({
      cols: [
        { key: 'em', label: 'Quando', align: 'l', fmt: (v) => dt(v) },
        { key: 'por', label: 'Quem', align: 'l' },
        { key: 'acao', label: 'O quê', align: 'l' },
        { key: 'loja', label: 'Loja', align: 'l' },
        { key: 'onde', label: 'Onde', align: 'l' },
        { key: 'det', label: 'Detalhes', align: 'l', wrap: true },
      ],
      rows,
      sortKey: 'em', sortDir: 'desc', maxHeight: '620px', search: 'Buscar…', searchKeys: ['por', 'acao', 'loja', 'onde', 'det'], empty: algum ? 'Nenhuma alteração com esses filtros.' : 'Nenhuma alteração registrada ainda.',
    });
    box.append(TS.cardWithTools('Histórico de alterações', 'Quem mudou o quê e quando', h('div', null, filtros, tab.searchBox), tab));
  }
})();
