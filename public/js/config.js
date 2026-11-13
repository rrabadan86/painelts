/* Página Configurações: lojas, acesso ao AppNext, metas por mês, planilhas, usuários, horários e histórico */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  const TELAS_NOME = [['resumo', 'Resumo'], ['comparativos', 'Comparativos'], ['comissionamento', 'Comissionamento'], ['promocao', 'Promoção'], ['mapa', 'Mapa de calor'], ['clientes', 'Clientes (CPF e telefone)'], ['minha', 'Comissão de cada vendedor']];
  const TELAS_PADRAO = ['resumo', 'comparativos', 'comissionamento', 'promocao', 'mapa', 'minha'];
  const PERFIL_NOME = { admin: 'Administrador', franqueado: 'Franqueado', gerente: 'Gerente', vendedor: 'Vendedor' };
  const PERFIL_DESC = {
    admin: 'Tudo: todas as lojas, acessos, horários e usuários.',
    franqueado: 'Tudo das lojas dele, inclusive criar gerentes e vendedores.',
    gerente: 'As telas que você liberar (padrão: todas, menos Clientes).',
    vendedor: 'Só a própria comissão e o andamento da meta.',
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
    if (!res.ok) throw new Error(j.erro || `Erro ${res.status}`);
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
      try { const msg = await fn(); if (msg) toast(msg); await carregar(); } catch (e) { toast(e.message, true); } finally { b.disabled = false; b.textContent = txt; }
    });
    return b;
  }
  const dt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const dIso = (iso) => (iso ? fmt.date(iso) : '—');
  const ymLongo = (ym) => `${TS.MESES_LONGOS[+ym.slice(5, 7) - 1]}/${ym.slice(0, 4)}`;
  const campo = (rotulo, el, dica) => h('label', { class: 'cfg-campo' }, h('span', null, rotulo), el, dica ? h('small', null, dica) : null);
  const inp = (attrs) => h('input', { class: 'f-input', ...attrs });

  let sujo = false; // há campo editado e não salvo: a atualização automática não redesenha a tela
  async function carregar(auto) {
    try { est = await api('GET', '/estado'); } catch (e) { if (auto) return; est = { erro: e.message }; }
    if (state.page === 'config' && raiz && raiz.isConnected && !(auto && sujo)) pintar();
    clearTimeout(timer);
    const ocupado = est.lojas && est.lojas.some((l) => l.status && l.status.execucao && ['rodando', 'na_fila'].includes(l.status.execucao.estado));
    timer = setTimeout(() => { if (state.page === 'config' && raiz && raiz.isConnected) carregar(true); }, ocupado ? 5000 : 60000);
  }

  TS.pages.config = function (root) {
    raiz = root;
    root.addEventListener('input', () => { sujo = true; });
    root.addEventListener('change', (e) => { if (e.target.matches('input,select')) sujo = true; });
    if (!est) { root.append(h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('p', null, 'Carregando configurações…'))); carregar(); return; }
    pintar();
    carregar();
  };

  function pintar() {
    const root = raiz;
    sujo = false;
    const scroll = window.scrollY;
    root.textContent = '';
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Configurações'),
      h('div', { class: 'page-sub' }, est.perfil === 'admin' ? 'Lojas, acesso ao AppNext, metas, usuários e horários' : 'Metas, planilhas e usuários das suas lojas'))));
    if (est.erro) { root.append(h('div', { class: 'notice err' }, est.erro)); return; }
    const abas = [['Lojas', 'lojas'], ['Usuários', 'usuarios']];
    if (est.perfil === 'admin') abas.push(['Atualização automática', 'coletor'], ['Resumo diário', 'resumo']);
    abas.push(['Histórico de alterações', 'historico']);
    state.cfgAba = abas.some(([, v]) => v === state.cfgAba) ? state.cfgAba : 'lojas';
    root.append(h('div', { class: 'cfg-abas' }, TS.seg(abas, state.cfgAba, (v) => { state.cfgAba = v; pintar(); })));
    const corpo = h('div', { class: 'cfg-corpo' });
    root.append(corpo);
    ({ lojas: abaLojas, usuarios: abaUsuarios, coletor: abaColetor, resumo: abaResumo, historico: abaHistorico })[state.cfgAba](corpo);
    window.scrollTo({ top: scroll });
  }

  // ======================= LOJAS =======================
  function abaLojas(box) {
    if (est.perfil === 'admin') {
      const aberto = abertos.has('nova');
      box.append(h('div', { class: 'cfg-barra' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => { aberto ? abertos.delete('nova') : abertos.add('nova'); pintar(); } }, aberto ? 'Fechar' : '+ Nova loja')));
      if (aberto) box.append(formNovaLoja());
    }
    if (!est.lojas.length) box.append(h('div', { class: 'card' }, TS.empty('Nenhuma loja cadastrada ainda.')));
    for (const l of est.lojas) box.append(cartaoLoja(l));
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
    if (!l.base.existe || !l.base.linhas) return l.coletor.configurado ? ['espera', 'Aguardando a 1ª coleta'] : ['espera', 'Sem dados'];
    if (ex && ex.estado === 'falhou') return ['erro', 'Última coleta falhou'];
    const dias = l.base.ultimaVenda ? Math.floor((Date.now() - new Date(l.base.ultimaVenda + 'T12:00:00').getTime()) / 86400e3) : null;
    if (dias != null && dias > 2) return ['erro', `Sem vendas novas desde ${dIso(l.base.ultimaVenda)}`];
    if (!l.coletor.configurado) return ['espera', 'Sem atualização automática'];
    return ['ok', 'Em dia'];
  }

  function cartaoLoja(l) {
    const chave = 'loja:' + l.id;
    const aberto = abertos.has(chave) || est.lojas.length === 1;
    const [cls, txt] = situacao(l);
    const ult = l.base.importacoes[0];
    const cab = h('button', { type: 'button', class: 'cfg-loja-cab', 'aria-expanded': String(aberto), onclick: () => { aberto ? abertos.delete(chave) : abertos.add(chave); pintar(); } },
      h('div', null, h('div', { class: 'cfg-loja-nome' }, l.nome), h('div', { class: 'cfg-loja-sub' }, `${l.id}${l.appnext ? ' · ' + l.appnext : ''}`)),
      h('div', { class: 'cfg-loja-info' },
        l.base.linhas ? h('span', null, `${fmt.int(l.base.linhas)} vendas · ${ymLongo(l.base.de)} a ${dIso(l.base.ultimaVenda)}`) : null,
        ult ? h('span', { class: 'muted' }, `atualizado ${dt(ult.em)}`) : null),
      h('span', { class: 'badge ' + cls }, txt), h('span', { class: 'cfg-seta' }, aberto ? '▴' : '▾'));
    const card = h('div', { class: 'card cfg-loja' }, cab);
    if (!aberto) return card;
    const grid = h('div', { class: 'cfg-loja-corpo' });
    grid.append(blocoDados(l));
    if (est.perfil === 'admin') grid.append(blocoAppNext(l));
    grid.append(blocoMetas(l), blocoFerias(l), blocoFechamento(l), blocoWpp(l), blocoFixe(l), blocoPlanilhas(l), blocoOperacao(l), blocoMarca(l));
    if (est.perfil === 'admin') grid.append(blocoRegras(l), blocoEditar(l));
    card.append(grid);
    return card;
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
    if (fx.pedido) return linhaSit('rodando', 'Cadastro de clientes (FIXE)', 'aguardando o e-mail do FIXE', `Pedido feito em ${dt(fx.pedido.em)}. O painel olha o Gmail da loja a cada 2 minutos, inclusive no spam.`);
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

  // ---- dados e coleta
  function blocoDados(l) {
    const b = h('section', { class: 'cfg-bloco' }, h('h3', null, 'Dados e atualização'));
    const ex = l.status && l.status.execucao;
    const lote = l.status && l.status.lote;
    if (!est.coletorAtivo) b.append(h('p', { class: 'muted' }, 'O coletor (atualização automática) não está ligado nesta VPS.'));
    else if (!l.coletor.configurado) b.append(h('p', { class: 'muted' }, est.perfil === 'admin' ? 'Cadastre o acesso ao AppNext (ao lado) para a loja atualizar sozinha.' : 'O administrador ainda não cadastrou o acesso ao AppNext desta loja.'));
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
    const exV = ex && !ocupado && !['xml', 'fixe', 'nada'].includes(ex.tipo) ? ex : null; // coleta sem vendas não diz nada das vendas
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
        x.pendentes ? `${x.pendentes} arquivo(s) de XML sendo processado(s)…` : null,
        x.erros && x.erros.length ? h('span', { class: 'neg' }, `Arquivo(s) com erro: ${x.erros.join(', ')}`) : null));
    }
    // estoque
    const exE = ex && !ocupado && ex.estoque;
    sit.append(linha(exE && !exE.ok ? 'erro' : l.estoque ? 'ok' : 'nada', 'Estoque e custos',
      exE && !exE.ok ? h('span', { class: 'neg' }, 'falhou na última coleta') : l.estoque ? 'em dia' : 'ainda não importado',
      l.estoque ? `Estoque de ${dt(l.estoque.em)} · ${fmt.int(l.estoque.itens)} produtos${l.estoque.origem === 'coletor' ? ' · baixado pelo coletor' : l.estoque.origem ? ' · planilha enviada' : ''}` : 'Vem em cada atualização (automática ou pelo botão) ou pela planilha em "Enviar planilha".'));
    { const f = sitFixe(l); if (f) sit.append(f); }
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
    if (est.coletorAtivo && l.coletor.configurado && est.perfil === 'admin') { // só o admin roda o coletor
      const acoes = h('div', { class: 'cfg-acoes' });
      if (ocupado) acoes.append(acao('Cancelar o que está na fila', async () => { await api('POST', `/lojas/${l.id}/cancelar`); return 'Fila cancelada (a parte que já está rodando termina).'; }));
      else acoes.append(acao('Atualizar agora', async () => { await api('POST', `/lojas/${l.id}/rodar`); return 'Atualização na fila. Leva alguns minutos.'; }, 'btn primary'));
      b.append(acoes);
      if (!ocupado) b.append(formHistorico(l));
    }
    if (ex && ex.log && ex.log.length && !ocupado) b.append(detalhes('log:' + l.id, { class: 'cfg-log' }, h('summary', null, 'Log técnico da última coleta'), logBonito(ex.log)));
    // últimas importações de vendas
    if (l.base.importacoes.length) {
      const TIPO_IMP = (o) => {
        const s = String(o || '').toLowerCase();
        if (s.endsWith('historico')) return 'Histórico';
        if (s.endsWith('agendado')) return 'Automática';
        if (s.endsWith('manual')) return 'Manual (botão)';
        if (s.includes('painel')) return 'Planilha enviada';
        if (s.startsWith('api')) return 'Envio por script';
        if (s.includes('migra')) return 'Migração';
        return o ? o.replace(/_/g, ' ') : '—';
      };
      b.append(detalhes('imp:' + l.id, { class: 'cfg-imp' }, h('summary', null, 'Últimas importações de vendas'), h('div', { class: 'cfg-imp-wrap' },
        h('table', { class: 't cfg-t' }, h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Quando'), h('th', { class: 'l' }, 'Tipo'), h('th', { class: 'l' }, 'Período'), h('th', null, 'Linhas'), h('th', { title: 'Parte das linhas que veio com o horário da venda (usado no Mapa de calor)' }, 'Com hora'))),
          h('tbody', null, l.base.importacoes.map((i) => h('tr', null, h('td', { class: 'l nw' }, dt(i.em)), h('td', { class: 'l' }, TIPO_IMP(i.origem)), h('td', { class: 'l nw' }, `${dIso(i.de)} a ${dIso(i.ate)}`), h('td', null, fmt.int(i.linhas)),
            h('td', { title: i.horasMantidas ? `A planilha veio sem hora; ${i.horasMantidas} linhas mantiveram a hora que já tinham` : '' }, i.comHora == null ? '—' : i.linhas ? fmt.pct(i.comHora / i.linhas, 0) + (i.horasMantidas ? ' *' : '') : '—'))))))));
    }
    return b;
  }

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
    const tipo = h('select', { class: 'f-input' }, [['ambos', 'Vendas e XML das notas (CPF)'], ['vendas', 'Só vendas'], ['xml', 'Só XML das notas (CPF dos clientes)']].map(([v, t]) => h('option', { value: v }, t)));
    const aberto = abertos.has('hist:' + l.id);
    const det = h('details', { class: 'cfg-hist', open: aberto || null }, h('summary', null, 'Importar histórico de um período'),
      h('p', { class: 'muted' }, 'Baixa do AppNext em partes (uma de cada vez) e junta no histórico. Use na primeira carga de uma loja ou para refazer meses.'),
      h('div', { class: 'cfg-grid c3' }, campo('De', de), campo('Até', ate), campo('Tamanho de cada parte', passo, 'Partes menores demoram mais no total, mas falham menos.')),
      h('div', { class: 'cfg-grid' }, campo('O que importar', tipo, 'XML = Fiscal → Gerar XML do AppNext (Tipo Todos, Situação Ativos). Traz o CPF de cada cupom para a aba Clientes. Para a primeira carga, use de 06/2025 até hoje.')),
      h('div', { class: 'cfg-acoes' }, acao('Importar', async () => {
        const r = await api('POST', `/lojas/${l.id}/historico`, { de: de.value, ate: ate.value, mesesPorParte: +passo.value, tipo: tipo.value });
        abertos.delete('hist:' + l.id);
        return `Importação na fila: ${r.partes} parte(s). Pode fechar o painel; ela continua sozinha.`;
      }, 'btn primary')));
    det.addEventListener('toggle', () => { det.open ? abertos.add('hist:' + l.id) : abertos.delete('hist:' + l.id); });
    return det;
  }

  // ---- AppNext
  function blocoAppNext(l) {
    const c = l.coletor;
    const rede = inp({ value: c.rede || 'teashop', autocomplete: 'off' });
    const usuario = inp({ value: c.usuario || '', autocomplete: 'off' });
    const senha = inp({ type: 'password', autocomplete: 'new-password', placeholder: c.temSenha ? '•••••••• (guardada — preencha só para trocar)' : '' });
    const destino = inp({ value: c.lojaDestino || l.appnext || '', placeholder: 'Ex.: TORRES - TEA SHOP TORRES' });
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
  function blocoFixe(l) {
    const fx = l.fixe || {};
    const gmail = (l.fechEmail && l.fechEmail.email && l.fechEmail.email.user) || '';
    const b = h('section', { class: 'cfg-bloco' }, h('h3', null, 'Clientes e fidelidade pelo FIXE'),
      h('p', { class: 'muted' }, 'Toda noite, na última atualização automática, o coletor entra no FIXE e pede duas exportações para o Gmail da loja: a "Base de leads" (cadastro) e os "Logs" (pontos, compras e resgates). O painel lê os e-mails (na caixa de entrada ou no spam), baixa as planilhas, junta com o cadastro e liga as compras do FIXE aos cupons. Nada precisa ser feito à mão.'));
    { const f = sitFixe(l), g = sitLogs(l); if (f || g) b.append(h('div', { class: 'cfg-sit' }, f, g)); }
    const url = inp({ value: fx.url || (est.lojas || []).map((x) => x.fixe && x.fixe.url).find(Boolean) || '', placeholder: 'ex.: https://dash.epossible.com.br/loja/…/leads' });
    const usuario = inp({ value: fx.usuario || '', placeholder: 'ex.: e-mail de acesso ao FIXE', autocomplete: 'off' });
    const senha = inp({ type: 'password', placeholder: fx.temSenha ? 'guardada (deixe em branco para manter)' : 'senha do FIXE', autocomplete: 'new-password' });
    const email = inp({ type: 'email', value: fx.email || gmail, placeholder: 'ex.: o Gmail da loja' });
    b.append(h('div', { class: 'cfg-grid' },
      campo('Página de Leads no FIXE', url, 'É o mesmo endereço para todas as lojas da rede. O que separa a base de cada loja é o usuário e a senha abaixo.'),
      campo('Usuário do FIXE', usuario, 'O login desta loja no FIXE: é ele que define de qual loja vem a base de clientes.'), campo('Senha do FIXE', senha, 'Fica guardada só na VPS, como a do AppNext.'),
      campo('E-mail que recebe a exportação', email, gmail ? `Use o Gmail da loja (${gmail}): é nele que o painel procura o e-mail do FIXE.` : 'Configure antes o Gmail da loja em "Fechamento do dia": é nele que o painel procura o e-mail do FIXE.')),
      h('div', { class: 'cfg-acoes' },
        acao('Salvar acesso ao FIXE', async () => { await api('PUT', `/lojas/${l.id}/fixe`, { url: url.value, usuario: usuario.value, senha: senha.value, email: email.value }); senha.value = ''; return 'Acesso ao FIXE salvo.'; }, 'btn primary'),
        est.perfil === 'admin' && est.coletorAtivo && fx.url ? acao('Importar agora', async () => { await api('POST', `/lojas/${l.id}/fixe/rodar`); return 'Pedido enviado ao FIXE. Em alguns minutos o e-mail chega e o cadastro é atualizado.'; }) : null));
    // regras de pontos
    if (est.perfil === 'admin' || est.perfil === 'franqueado') {
      const rg = fx.fidelidade || { reaisPorPonto: 50, validadeMeses: 12 };
      const rpp = inp({ type: 'number', min: 1, step: '0.01', value: rg.reaisPorPonto }), val = inp({ type: 'number', min: 1, max: 120, step: 1, value: rg.validadeMeses });
      b.append(h('h4', { class: 'cfg-sub' }, 'Regras dos pontos'),
        h('div', { class: 'cfg-grid' },
          campo('Reais por ponto (R$)', rpp, 'Quanto a compra precisa somar para ganhar 1 ponto. Usado para conferir se um cupom é a compra lançada no FIXE.'),
          campo('Validade dos pontos (meses)', val, 'Depois disso o ponto vence. Usado no saldo e no aviso "Pontos vencendo" da tela Clientes.')),
        h('div', { class: 'cfg-acoes' }, acao('Salvar regras', async () => { await api('PUT', `/lojas/${l.id}/fidelidade`, { reaisPorPonto: rpp.value, validadeMeses: val.value }); return 'Regras salvas. O painel recalcula na próxima carga.'; })));
    }
    return b;
  }

  function blocoPlanilhas(l) {
    const tipo = h('select', { class: 'f-input' },
      h('option', { value: 'vendas' }, 'Vendas (relatório do AppNext)'), h('option', { value: 'Xml' }, 'Cupons com CPF (Xml)'),
      h('option', { value: 'Dados_Clientes' }, 'Cadastro de clientes (modelo do painel ou FIXE)'), h('option', { value: 'Meta' }, 'Meta (planilha antiga)'),
      h('option', { value: 'Estoque' }, 'Estoque atual e custos (AppNext → Estoque → Estoque Atual → Excel)'));
    const arq = h('input', { type: 'file', accept: '.xlsx,.xls', class: 'f-input' });
    const dica = h('p', { class: 'muted cfg-dica-cad' });
    const pintaDica = () => {
      dica.textContent = tipo.value === 'Dados_Clientes'
        ? 'Pode enviar o modelo do painel (CPF, NOME, CELULAR, DATA NASC., EMAIL, CIDADE), a exportação de contatos do FIXE ou a exportação de Logs do FIXE (pontos e compras), do jeito que sai do sistema. O painel reconhece sozinho, junta com o cadastro que já existe (CPF novo entra, CPF conhecido é atualizado, campo vazio não apaga) e ignora o que não usa (Data Cadastro, Loja, Saldo, Estado).'
        : tipo.value === 'Estoque'
          ? 'No AppNext: Estoque → Estoque Atual → botão verde "Exportar para Excel". Envie o arquivo do jeito que baixar. O coletor também baixa sozinho em cada atualização; o envio manual serve para a primeira carga ou para conferir.'
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
    const lista = h('ul', { class: 'cfg-fontes' }, l.fontes.map((f) => h('li', null, h('b', null, f.desc), ' — ',
      f.origem === 'vps' ? `na VPS, ${dt(f.modificado)}` : f.origem === 'drive' ? 'no Google Drive' : h('span', { class: 'muted' }, 'não enviada'))));
    return h('section', { class: 'cfg-bloco' }, h('h3', null, 'Enviar planilha'),
      h('p', { class: 'muted' }, 'Vendas: entram no histórico substituindo só os dias que a planilha cobre. Cadastro de clientes: junta com o que já existe. As outras substituem a anterior.'),
      h('div', { class: 'cfg-grid' }, campo('Tipo', tipo), campo('Arquivo (.xlsx ou .xls)', arq)), dica,
      h('div', { class: 'cfg-acoes' }, acao('Enviar', async () => {
        const f = arq.files[0];
        if (!f) throw new Error('Escolha o arquivo.');
        const r = await api('POST', `/lojas/${l.id}/upload/${tipo.value}`, f, { 'X-Arquivo': encodeURIComponent(f.name) });
        arq.value = '';
        setTimeout(() => TS.recarregar && TS.recarregar(true), 4000);
        if (r && r.estoque) {
          resultado.replaceChildren(h('div', { class: 'cfg-cad-res' }, h('b', null, `Estoque importado: ${fmt.int(r.estoque.itens)} produtos.`),
            h('ul', null, r.estoque.zerados ? h('li', null, `${fmt.int(r.estoque.zerados)} produto(s) que não vieram agora ficaram com estoque zero`) : null,
              r.estoque.semCusto ? h('li', null, `${fmt.int(r.estoque.semCusto)} produto(s) sem custo no AppNext`) : null),
            h('div', null, 'Veja na aba Estoque e margem.')));
          return 'Estoque importado.';
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
    const host = inp({ value: e.host, placeholder: 'ex.: smtp.gmail.com' }), port = inp({ type: 'number', value: e.port || 587 }), user = inp({ value: e.user, autocomplete: 'off', placeholder: 'ex.: teashop.loja@gmail.com' });
    const pass = inp({ type: 'password', autocomplete: 'new-password', placeholder: e.temSenha ? '•••••••• (guardada)' : 'senha de app (16 letras)' });
    const from = inp({ value: e.from, placeholder: `ex.: ${l.nome} <teashop.loja@gmail.com>` });
    const sec = h('input', { type: 'checkbox', checked: e.secure || null });
    const novoEmail = inp({ type: 'email', placeholder: 'pessoa@email.com' }), novoNome = inp({ placeholder: 'Nome' });
    const envios = (r) => {
      const ok = r.envios.filter((x) => x.ok), falhas = r.envios.filter((x) => !x.ok);
      if (falhas.length) throw new Error(`Enviado para ${ok.length}; falhou: ${falhas.map((x) => `${x.para} (${x.erro})`).join('; ')}`);
      return `Fechamento de hoje enviado para ${ok.length}: ${ok.map((x) => x.para).join(', ')}.`;
    };
    sec0.append(...[
      h('p', { class: 'muted' }, `Todo dia, no horário escolhido, a ${l.nome} envia o fechamento de HOJE pelo Gmail dela para as pessoas da lista abaixo${f.gerais.length ? ' e para quem acompanha a loja pela rede' : ''}. É o mesmo conteúdo da planilha de fechamento, preenchido sozinho.`),
      h('label', { class: 'cfg-check-l' }, ativo, ' Enviar o fechamento todos os dias'),
      h('div', { class: 'cfg-grid' }, campo('Horário (Brasília)', hora, 'Depois da última coleta do dia (ex.: coleta 23:00 → 23:30).')),
      f.fechamento.ultimoEnvio ? h('p', { class: 'muted' }, `Último envio automático: ${dIso(f.fechamento.ultimoEnvio)}`) : null,
      h('div', { class: 'f-label', style: { marginTop: '10px' } }, 'Gmail que envia (da franquia)'),
      !e.configurado && f.servidorGeral ? h('p', { class: 'muted' }, 'Enquanto o Gmail da loja não for cadastrado, o envio usa o e-mail geral do painel.') : null,
      passoGmail('gmail:' + l.id, { host, port, sec, from, user }),
      h('div', { class: 'cfg-grid' }, campo('Servidor (SMTP)', host), campo('Porta', port), campo('Usuário (Gmail)', user), campo('Senha de app', pass), campo('Remetente', from)),
      h('label', { class: 'cfg-check-l' }, sec, ' Conexão segura direta (porta 465)'),
      h('div', { class: 'cfg-acoes' }, acao('Salvar', async () => {
        if (!host.value.trim() && /@gmail\.com$/i.test(user.value.trim())) host.value = 'smtp.gmail.com';
        if (user.value.trim() && !from.value.trim()) from.value = `${l.nome} <${user.value.trim()}>`;
        if (user.value.trim() && !host.value.trim()) throw new Error('Preencha o Servidor (SMTP). Para Gmail: smtp.gmail.com.');
        await api('PUT', `/lojas/${l.id}/fechamento-email`, { fechamento: { ativo: ativo.checked, horario: hora.value }, email: { host: host.value, port: port.value, user: user.value, pass: pass.value || undefined, from: from.value, secure: sec.checked } });
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
          acao('Testar', async () => envios(await api('POST', `/lojas/${l.id}/fechamento-email/enviar`, { para: d.email }))),
          acao('Remover', async () => { await api('POST', `/lojas/${l.id}/fechamento-email/destinos`, { email: d.email, remover: true }); return 'Removido.'; }, 'btn ghost-danger'))))) : h('p', { class: 'muted' }, 'Ninguém ainda.'),
      h('div', { class: 'cfg-grid' }, campo('E-mail', novoEmail), campo('Nome', novoNome)),
      h('div', { class: 'cfg-acoes' }, acao('Adicionar destinatário', async () => { await api('POST', `/lojas/${l.id}/fechamento-email/destinos`, { email: novoEmail.value, nome: novoNome.value }); return 'Destinatário adicionado.'; })),
      f.gerais.length ? h('p', { class: 'muted' }, h('b', null, 'Também recebem (acompanham a loja pela rede): '), f.gerais.map((g) => g.nome || g.email).join(', '), '.') : null].filter(Boolean));
    return sec0;
  }

  // ---- modelos de mensagem de WhatsApp (tela Clientes)
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
    sec0.append(h('p', { class: 'muted' }, 'Textos que aparecem prontos ao abrir o WhatsApp de um cliente na tela Clientes. Use {nome} (primeiro nome), {loja} e {cha} (chá favorito do cliente).'),
      corpo,
      h('div', { class: 'cfg-acoes' },
        h('button', { type: 'button', class: 'btn', onclick: () => { if (lista.length >= 12) return; lista.push({ nome: 'Nova mensagem', texto: 'Oi, {nome}! ' }); pintarW(); } }, '+ Mensagem'),
        h('button', { type: 'button', class: 'btn', onclick: () => { lista.splice(0, lista.length, ...(TS.WPP_PADRAO || []).map((m) => ({ ...m }))); pintarW(); } }, 'Voltar ao padrão'),
        acao('Salvar mensagens', async () => { await api('PUT', `/lojas/${l.id}/wpp-modelos`, { modelos: lista }); return 'Mensagens salvas.'; }, 'btn primary')));
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
        const hoje = new Date().toISOString().slice(0, 10);
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
      h('p', { class: 'muted' }, 'Usados no Mapa de calor para calcular quantas pessoas cada horário precisa e sugerir a escala.'),
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
        h('div', { class: 'cfg-grid c3' }, campo('Valor por critério (R$)', prV), campo('TKM mínimo (R$)', prT), campo('IPA mínimo', prI), campo('PMA mínimo (R$)', prP), campo('Critérios necessários', prMin)),
        h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Bônus sobre as vendas dos outros vendedores (vendedor escolhido nos filtros)'),
        h('div', { class: 'cfg-grid c3' }, campo('Loja abaixo da meta %', bn.abaixo), campo('Loja bateu a meta %', bn.bate), campo('Loja ≥ 120% %', bn.acima120)),
        h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Rateio'),
        h('label', { class: 'cfg-check-l' }, rtAtivo, ' Dividir o total de comissões igualmente entre os vendedores'),
        campo('Não entram no rateio', rtExc),
        h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Gorjeta (taxa de serviço)'),
        h('div', { class: 'cfg-grid' }, campo('Como divide', gjModo), campo('% da taxa repassada aos vendedores', gjPct)),
        h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Royalties'),
        h('div', { class: 'cfg-grid c3' }, campo('Loja %', ry.loja), campo('Marketing %', ry.mkt), campo('Espaço Gourmet %', ry.eg), campo('EG marketing %', ry.egMkt)),
        campo('Vendedores sem meta individual', semMeta, 'Não dividem a meta da loja (ex.: corporativo, gerente) e recebem a comissão mínima (a taxa "abaixo da meta") sobre o que venderam.'),
        campo('Não recebem comissão', semCom, 'Ficam sem comissão e sem premiação (a gorjeta continua). Ex.: corporativo, sócio.'),
        h('div', { class: 'cfg-acoes' },
          acao('Salvar regras', async () => {
            const lista = (i) => i.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
            const regras = {
              modelo: modelo.value,
              divisaoMeta: { arom: lePct(dv.arom), puro: lePct(dv.puro), acess: lePct(dv.acess) },
              comissao: { modo: modo.value, ...Object.fromEntries(Object.entries(cm).map(([k, o]) => [k, { acima120: lePct(o.acima120), bate: lePct(o.bate), abaixo: lePct(o.abaixo) }])) },
              premiacao: { ativa: prAtiva.checked, valor: +prV.value, tkm: +prT.value, ipa: +prI.value, pma: +prP.value, minimo: +prMin.value },
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
        conf ? acao(`Confirmar: remover ${l.nome}`, async () => { await api('DELETE', `/lojas/${l.id}`); abertos.delete('rem:' + l.id); return 'Loja removida (os dados continuam guardados na VPS).'; }, 'btn danger')
          : h('button', { type: 'button', class: 'btn ghost-danger', onclick: () => { abertos.add('rem:' + l.id); pintar(); } }, 'Remover loja…')),
      conf ? h('p', { class: 'muted' }, 'Os usuários perdem o acesso a ela e a atualização automática para. As planilhas e o histórico ficam guardados na VPS.') : null);
  }

  // ======================= USUÁRIOS =======================
  function abaUsuarios(box) {
    const aberto = abertos.has('novoUser');
    box.append(h('div', { class: 'cfg-barra' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => { aberto ? abertos.delete('novoUser') : abertos.add('novoUser'); state.cfgEdit = null; pintar(); } }, aberto ? 'Fechar' : '+ Novo usuário')));
    if (aberto) box.append(formUsuario(null));
    const nomeLoja = new Map(est.todasLojas.map((l) => [l.id, l.nome]));
    const linhas = est.usuarios.map((u) => {
      const tr = h('tr', { class: u.ativo ? '' : 'inativo' },
        h('td', { class: 'l' }, h('b', null, u.nome), u.nome === est.usuario ? h('span', { class: 'muted' }, ' (você)') : null),
        h('td', { class: 'l' }, h('span', { class: 'badge p-' + u.perfil }, PERFIL_NOME[u.perfil]),
          u.perfil === 'gerente' ? h('div', { class: 'muted cfg-telas-resumo' }, u.telas ? `${u.telas.length} tela(s)${u.telas.includes('clientes') ? ' · vê clientes' : ''}` : 'telas padrão') : null),
        h('td', { class: 'l wrap' }, u.lojas.includes('*') ? 'Todas' : u.lojas.map((id) => nomeLoja.get(id) || id).join(', ')),
        h('td', { class: 'l' }, u.vendedor || '—'),
        h('td', { class: 'l' }, u.ultimoAcesso ? dt(u.ultimoAcesso) : h('span', { class: 'muted' }, 'nunca')),
        h('td', { class: 'l' }, !u.ativo ? h('span', { class: 'neg' }, 'Desativado')
          : u.expirado ? h('span', { class: 'neg' }, `Acesso terminou em ${dataBr(u.acessoAte)}`)
            : u.acessoAte ? h('span', null, 'Ativo', h('div', { class: diasAte(u.acessoAte) <= 7 ? 'neg cfg-prazo' : 'muted cfg-prazo' }, `até ${dataBr(u.acessoAte)}${diasAte(u.acessoAte) <= 7 ? ` (${diasAte(u.acessoAte)} dia(s))` : ''}`)) : 'Ativo',
          u.trocarSenha ? h('div', { class: 'cfg-prazo cfg-senha-pend', title: 'No próximo login a pessoa cria a própria senha' }, '🔑 aguardando troca da senha')
            : u.senhaTrocadaEm ? h('div', { class: 'muted cfg-prazo' }, `senha trocada em ${dt(u.senhaTrocadaEm)}`) : null),
        h('td', null, h('button', { type: 'button', class: 'btn', onclick: () => { state.cfgEdit = state.cfgEdit === u.nome ? null : u.nome; abertos.delete('novoUser'); pintar(); } }, state.cfgEdit === u.nome ? 'Fechar' : 'Editar')));
      return state.cfgEdit === u.nome ? [tr, h('tr', { class: 'cfg-edit-row' }, h('td', { colspan: 7 }, formUsuario(u)))] : [tr];
    }).flat();
    box.append(h('div', { class: 'card' }, h('div', { class: 'table-wrap free' }, h('table', { class: 't cfg-t' },
      h('thead', null, h('tr', null, ['Usuário', 'Perfil', 'Lojas', 'Vendedor', 'Último acesso', 'Situação', ''].map((t, i) => h('th', { class: i < 6 ? 'l' : '' }, t)))),
      h('tbody', null, linhas.length ? linhas : h('tr', null, h('td', { colspan: 7, class: 'l muted' }, 'Nenhum usuário.')))))));
    box.append(h('div', { class: 'cfg-perfis' }, Object.entries(PERFIL_DESC).filter(([p]) => est.perfil === 'admin' || ['gerente', 'vendedor'].includes(p)).map(([p, d]) => h('div', null, h('span', { class: 'badge p-' + p }, PERFIL_NOME[p]), ' ', d))));
  }

  const dataBr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
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
    const telasSel = new Set(u && u.telas ? u.telas : TELAS_PADRAO);
    const telasBox = h('div', { class: 'cfg-checks' }, TELAS_NOME.map(([k, nomeT]) => {
      const cb = h('input', { type: 'checkbox', value: k, checked: telasSel.has(k) || null });
      cb.addEventListener('change', () => { cb.checked ? telasSel.add(k) : telasSel.delete(k); });
      return h('label', null, cb, ' ', nomeT);
    }));
    const campoTelas = campo('Telas que o gerente pode ver', telasBox, 'Clientes mostra CPF, telefone e histórico de compras: libere só para quem precisa.');
    const campoVend = campo('Quem é no sistema (nome do vendedor)', vendSel, 'Liga o usuário às vendas dele.');
    function pintarLojas() {
      const p = perfil.value;
      lojasBox.textContent = '';
      campoLojas.hidden = p === 'admin';
      campoVend.hidden = p !== 'vendedor';
      campoTelas.hidden = p !== 'gerente';
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
          const corpo = { perfil: perfil.value, lojas: [...marcadas], vendedor: vendSel.value, ativo: ativo.checked, trocarSenha: trocar.disabled ? undefined : trocar.checked, senha: senha.value || undefined, acessoMeses: meses.value.trim() === '' || proprio ? undefined : Math.round(+meses.value), telas: perfil.value === 'gerente' ? TELAS_NOME.map(([k]) => k).filter((k) => telasSel.has(k)) : undefined };
          if (novo) { await api('POST', '/usuarios', { nome: nome.value.trim().toLowerCase(), ...corpo }); abertos.delete('novoUser'); }
          else { await api('PUT', `/usuarios/${encodeURIComponent(u.nome)}`, corpo); state.cfgEdit = null; }
          return novo ? `Usuário criado.${corpo.senha ? ' Envie a senha para a pessoa.' : ''}` : 'Usuário atualizado.';
        }, 'btn primary'),
        !novo && u.nome !== est.usuario ? acao('Encerrar sessões', async () => { await api('POST', `/usuarios/${encodeURIComponent(u.nome)}/encerrar-sessoes`); return `${u.nome} vai precisar entrar de novo em todos os aparelhos.`; }, 'btn') : null,
        !novo && u.nome !== est.usuario ? (abertos.has('delu:' + u.nome)
          ? acao(`Confirmar: excluir ${u.nome}`, async () => { await api('DELETE', `/usuarios/${encodeURIComponent(u.nome)}`); state.cfgEdit = null; abertos.delete('delu:' + u.nome); return 'Usuário excluído.'; }, 'btn danger')
          : h('button', { type: 'button', class: 'btn ghost-danger', onclick: () => { abertos.add('delu:' + u.nome); pintar(); } }, 'Excluir…')) : null));
  }

  // ======================= COLETOR =======================
  function abaColetor(box) {
    if (!est.coletorAtivo) { box.append(h('div', { class: 'notice' }, 'O coletor não está ligado nesta VPS (falta COLETOR_URL/COLETOR_TOKEN no .env).')); return; }
    const hs = [...est.horarios];
    const lista = h('div', { class: 'chips' });
    const pintarHs = () => { lista.textContent = ''; hs.sort().forEach((x, i) => lista.append(h('span', { class: 'chip on' }, x, ' ', h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remover ' + x, onclick: () => { hs.splice(i, 1); pintarHs(); } }, '×')))); };
    pintarHs();
    const novo = inp({ type: 'time', value: '12:00', style: { maxWidth: '140px' } });
    box.append(h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Horários da atualização automática'),
      h('p', { class: 'muted' }, `Em cada horário o coletor atualiza todas as lojas, uma de cada vez, baixando os últimos ${est.janela || 7} dias do AppNext (vendas e XML). Do dia 1 ao 5 de cada mês ele refaz também o mês anterior inteiro, para o fechamento pegar correções de última hora. O botão de buscar dados no topo (e o "Atualizar agora") baixa só ontem e hoje. Horário de Brasília.`),
      est.coletorOk === false ? h('div', { class: 'notice err' }, 'O coletor não está respondendo.') : null,
      lista,
      h('div', { class: 'cfg-inline', style: { marginTop: '10px' } }, novo, h('button', { type: 'button', class: 'btn', onclick: () => { if (novo.value && !hs.includes(novo.value)) { hs.push(novo.value); pintarHs(); } } }, 'Adicionar horário')),
      h('div', { class: 'cfg-acoes' }, acao('Salvar horários', async () => { await api('PUT', '/horarios', { horarios: hs }); return 'Horários salvos. Valem a partir do próximo minuto.'; }, 'btn primary'))));
    const dias = inp({ type: 'number', min: 1, max: 90, value: est.janela || 7, style: { maxWidth: '110px' } });
    box.append(h('div', { class: 'card cfg-form' }, h('div', { class: 'card-title' }, 'Quantos dias baixar em cada atualização'),
      h('p', { class: 'muted' }, 'O histórico completo entra uma vez, pelo "Importar histórico". Depois, cada atualização só precisa dos dias recentes: quanto menos dias, mais rápido. Use mais dias se a loja costuma corrigir vendas antigas no AppNext (cancelamento, troca de vendedor).'),
      h('div', { class: 'cfg-inline' }, dias, h('span', { class: 'muted' }, 'dias (recomendado: 7)')),
      h('div', { class: 'cfg-acoes' }, acao('Salvar', async () => { const r = await api('PUT', '/janela', { dias: +dias.value }); est.janela = r.dias; return `Pronto: cada atualização baixa os últimos ${r.dias} dias.`; }, 'btn primary'))));
    // resumo das lojas
    box.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Situação de cada loja'),
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
  function abaHistorico(box) {
    const fmtDet = (d) => {
      if (!d) return '';
      const val = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a} = ${b ?? 'padrão'}`).join(', ') : v === true ? 'sim' : v === false ? 'não' : v);
      return Object.entries(d).filter(([k, v]) => k !== 'loja' && v != null && v !== '').map(([k, v]) => `${k}: ${val(v)}`).join(' · ');
    };
    const tab = TS.table({
      cols: [
        { key: 'em', label: 'Quando', align: 'l', fmt: (v) => dt(v) },
        { key: 'por', label: 'Quem', align: 'l' },
        { key: 'acao', label: 'O quê', align: 'l' },
        { key: 'alvo', label: 'Onde', align: 'l' },
        { key: 'det', label: 'Detalhes', align: 'l', wrap: true },
      ],
      rows: est.auditoria.map((e) => ({ ...e, det: fmtDet(e.detalhe) })),
      sortKey: 'em', sortDir: 'desc', maxHeight: '620px', search: 'Buscar…', searchKeys: ['por', 'acao', 'alvo', 'det'], empty: 'Nenhuma alteração registrada ainda.',
    });
    box.append(TS.cardWithTools('Histórico de alterações', 'Quem mudou o quê e quando', tab.searchBox, tab));
  }
})();
