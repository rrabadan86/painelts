/* Clientes → Campanhas: lista de clientes por critérios (pontos, vencimento, produto, ausência…), mensagem de WhatsApp
 * personalizada, envio em fila (um clique por cliente, no WhatsApp da loja) e o retorno: quem comprou nos N dias seguintes.
 * Só clientes com celular e que não pediram para não receber mensagens. Campanha recorrente: uma lista nova por semana
 * ou por mês, montada com os mesmos critérios quando a tela é aberta. */
(function () {
  const { h, fmt, state } = TS;
  const A = () => TS.cliApi;
  const dia = TS.todayDay;
  const d = (day) => (day == null ? '—' : fmt.date(TS.dayToIso(day)));
  const isoDia = (iso) => TS.isoToDay(String(iso).slice(0, 10));

  TS.subClientes = (atual) => TS.subGrupo(atual);

  // ---------- servidor (na apresentação fica só na memória) ----------
  const demo = { lista: [] };
  async function api(met, url, corpo) {
    if (TS.demo) return demoApi(met, url, corpo);
    const r = await fetch(url, { method: met, credentials: 'same-origin', headers: corpo ? { 'Content-Type': 'application/json', 'X-Painel': '1' } : { 'X-Painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
    return j;
  }
  function demoApi(met, url, b) {
    const id = () => Math.random().toString(16).slice(2, 14), agora = new Date().toISOString();
    const m = /\/api\/campanhas(?:\/([^/?]+))?(?:\/(\w+))?/.exec(url);
    const c = m[1] && demo.lista.find((x) => x.id === m[1]);
    if (met === 'GET') return { campanhas: demo.lista.slice() };
    if (met === 'POST' && !m[1]) { const n = { id: id(), nome: b.nome, mensagem: b.mensagem, janela: b.janela, recorrente: b.recorrente, ativa: true, filtros: b.filtros, criadaEm: agora, por: 'você', rodadas: [{ id: id(), em: agora, lista: b.lista.map((x) => ({ ...x, st: 'p' })) }] }; demo.lista.unshift(n); return { campanha: n }; }
    if (met === 'PUT' && !m[2]) { const { loja, ...resto } = b; Object.assign(c, resto); return { campanha: c }; }
    if (met === 'PUT' && m[2] === 'rodadas') { const r = c.rodadas[0]; const feitos = r.lista.filter((x) => x.st !== 'p'); const ja = new Set(feitos.map((x) => x.cpf)); r.lista = [...feitos, ...b.lista.filter((x) => !ja.has(x.cpf)).map((x) => ({ ...x, st: 'p' }))]; return { campanha: c }; }
    if (m[2] === 'rodadas') { c.rodadas.unshift({ id: id(), em: agora, lista: b.lista.map((x) => ({ ...x, st: 'p' })) }); return { campanha: c }; }
    if (m[2] === 'marcar') { const it = c.rodadas.find((r) => r.id === b.rodada).lista.find((x) => x.cpf === b.cpf); it.st = b.st; if (b.st === 'p') { delete it.em; delete it.por; } else { it.em = agora; it.por = 'você'; } return { item: it }; }
    if (met === 'DELETE') { demo.lista = demo.lista.filter((x) => x !== c); return { ok: true }; }
    return {};
  }
  const qs = () => 'loja=' + encodeURIComponent(state.loja);
  const por = (el, ...xs) => el.replaceChildren(...xs.filter((x) => x != null && x !== false));

  // ---------- critérios ----------
  const SEGS = [['vip', 'VIP'], ['fiel', 'Fiéis'], ['sumido', 'Sumidos'], ['repor', 'Hora de repor'], ['vence', 'Pontos vencendo'], ['novo', 'Novos do mês'], ['uma', 'Uma compra só']];
  const PADRAO = { ptsMin: '', ptsMax: '', venceDias: '', produto: '', grupo: '', compraDias: '', ausMin: '', ausMax: '', visMin: '', visMax: '', aniv: '', segs: [], vendedora: '', lojaPref: '', semContato: 30 };
  const num = (v) => (v === '' || v == null || Number.isNaN(+v) ? null : +v);

  /** clientes que atendem aos critérios: só com celular e sem "não quer mensagens" */
  function selecionar(f) {
    const db = TS.db, hoje = dia();
    const prod = TS.norm(f.produto || '').trim();
    const grupoId = f.grupo ? db.D.grupoC.indexOf(f.grupo) : -1;
    if (f.grupo && grupoId < 0) return []; // grupo que não existe mais nas vendas: ninguém (antes o filtro era ignorado e entrava todo mundo)
    const desde = num(f.compraDias) != null ? hoje - num(f.compraDias) : -Infinity;
    let prodOk = null;
    if (prod) { prodOk = new Uint8Array(db.D.descricao.length); db.D.descricao.forEach((t, i) => { if (TS.norm(t).includes(prod)) prodOk[i] = 1; }); }
    const mesAniv = f.aniv === 'atual' ? new Date().getMonth() + 1 : f.aniv === 'proximo' ? ((new Date().getMonth() + 1) % 12) + 1 : num(f.aniv);
    const out = [];
    for (const c of A().universo()) {
      if (!c.wpp) continue;
      const ct = A().contatoDe(c);
      if (ct && ct.optout) continue;
      if (num(f.semContato) && ct && ct.em && Date.now() - Date.parse(ct.em) < num(f.semContato) * 864e5) continue;
      const saldo = c.fx ? c.fx.saldo || 0 : 0;
      if (num(f.ptsMin) != null && saldo < num(f.ptsMin)) continue;
      if (num(f.ptsMax) != null && saldo > num(f.ptsMax)) continue;
      if (num(f.venceDias) != null && !(c.fx && c.fx.prox != null && c.fx.prox <= hoje + num(f.venceDias) && c.fx.proxPts > 0)) continue;
      if (num(f.ausMin) != null && !(c.ausencia != null && c.ausencia >= num(f.ausMin))) continue;
      if (num(f.ausMax) != null && !(c.ausencia != null && c.ausencia <= num(f.ausMax))) continue;
      if (num(f.visMin) != null && (c.visitas || 0) < num(f.visMin)) continue;
      if (num(f.visMax) != null && (c.visitas || 0) > num(f.visMax)) continue;
      if (mesAniv && !(c.nascimento && +c.nascimento.slice(5, 7) === mesAniv)) continue;
      if (f.segs && f.segs.length && !f.segs.some((t) => c.tags && c.tags.has(t))) continue;
      if (f.vendedora && c.vendedora !== f.vendedora) continue;
      if (f.lojaPref) {
        const pr = TS.lojasDoCliente(c).pref;
        if (!pr) continue;
        if (f.lojaPref === 'nossa' ? !pr.nossa : f.lojaPref === 'outra' ? pr.nossa : pr.nome !== f.lojaPref) continue;
      }
      let qProd = null;
      if (prodOk || grupoId >= 0) {
        qProd = 0;
        for (const k of c.cupons) { if (k.day < desde) continue; for (const i of k.itens) if ((!prodOk || prodOk[db.desc[i]]) && (grupoId < 0 || db.grupoC[i] === grupoId)) qProd++; }
        if (!qProd) continue;
      } else if (num(f.compraDias) != null && !c.cupons.some((k) => k.day >= desde)) continue;
      out.push({ c, saldo, qProd });
    }
    return out.sort((a, b) => b.saldo - a.saldo || (a.c.nome || '').localeCompare(b.c.nome || '', 'pt-BR'));
  }
  const clienteDe = (cpf) => A().universo().find((c) => c.cpf === cpf) || { cpf, nome: '', cupons: [], tags: new Set() };
  const extras = (camp) => ({ produto: (camp.filtros && camp.filtros.produto) || '' });

  // ---------- página ----------
  TS.pages.campanhas = function (root) {
    root.append(TS.subClientes('campanhas'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Campanhas'),
      h('div', { class: 'page-sub' }, 'Monte uma lista de clientes, escreva a mensagem e envie pelo WhatsApp da loja, um por um. Depois veja quem voltou a comprar.'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'As campanhas são de cada loja: escolha uma loja no seletor do topo.')); return; }
    if (!TS.cli || !TS.cliApi) { root.append(h('div', { class: 'notice' }, 'Os clientes ainda não foram carregados.')); return; }
    A().carregarContatos();
    const corpo = h('div', null, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Carregando as campanhas…'))));
    root.append(corpo);
    api('GET', '/api/campanhas?' + qs()).then(async (j) => {
      const lista = j.campanhas || [];
      const novas = await rodadasRecorrentes(lista);
      if (corpo.isConnected) pintarLista(corpo, lista, novas);
    }).catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  };

  /** campanha recorrente: semanal = uma lista nova a cada 7 dias; mensal = uma por mês */
  async function rodadasRecorrentes(lista) {
    const feitas = [];
    for (const c of lista) {
      if (!c.recorrente || c.ativa === false) continue;
      const ult = c.rodadas[0] && new Date(c.rodadas[0].em);
      const agora = new Date();
      const vence = !ult || (c.recorrente === 'semanal' ? agora - ult >= 7 * 864e5 : agora.getFullYear() * 12 + agora.getMonth() > ult.getFullYear() * 12 + ult.getMonth());
      if (!vence) continue;
      const sel = selecionar({ ...PADRAO, ...c.filtros });
      try { const r = await api('POST', `/api/campanhas/${c.id}/rodadas`, { loja: state.loja, lista: sel.map(({ c: x }) => ({ cpf: x.cpf, nome: x.nome })) }); Object.assign(c, r.campanha); feitas.push(c.nome); } catch { /* tenta de novo na próxima vez */ }
    }
    return feitas;
  }

  /** retorno: quem comprou do dia do envio até N dias depois (cupons com CPF) */
  function retorno(item, janela) {
    if (item.st !== 'e' || !item.em) return null;
    const c = TS.cli.porCPF && TS.cli.porCPF.get(item.cpf);
    const e = isoDia(item.em);
    const ks = c ? c.cupons.filter((k) => k.day >= e && k.day <= e + janela) : [];
    return { voltou: ks.length > 0, vt: ks.reduce((t, k) => t + k.vt, 0), primeira: ks.length ? Math.min(...ks.map((k) => k.day)) : null, aberto: dia() - e < janela };
  }
  function resumoRodada(r, janela) {
    let env = 0, pend = 0, opt = 0, volt = 0, vt = 0, aberto = 0;
    for (const it of r.lista) {
      if (it.st === 'p') pend++; else if (it.st === 'o') opt++;
      if (it.st === 'e') { env++; const x = retorno(it, janela); if (x.voltou) { volt++; vt += x.vt; } if (x.aberto) aberto++; }
    }
    return { total: r.lista.length, env, pend, opt, volt, vt, aberto };
  }

  function pintarLista(corpo, lista, novas) {
    const cards = lista.map((c) => {
      const r = c.rodadas[0], s = resumoRodada(r, c.janela);
      return h('div', { class: 'card cp-card', role: 'button', tabindex: 0, onclick: () => abrirCampanha(corpo, lista, c), onkeydown: (e) => { if (e.key === 'Enter') abrirCampanha(corpo, lista, c); } },
        h('div', { class: 'cp-card-top' }, h('b', null, c.nome), c.recorrente ? h('span', { class: 'cli-tag t-repor' }, c.recorrente === 'semanal' ? 'toda semana' : 'todo mês') : null, c.ativa === false ? h('span', { class: 'cli-tag' }, 'pausada') : null),
        h('small', { class: 'muted' }, `${c.recorrente ? 'Lista de ' : 'Criada em '}${fmt.date(r.em.slice(0, 10))} · por ${r.por || c.por || '—'}`),
        h('div', { class: 'cp-mini' },
          h('div', null, h('b', null, fmt.int(s.total)), h('small', null, 'na lista')),
          h('div', null, h('b', null, fmt.int(s.env)), h('small', null, 'enviadas')),
          h('div', null, h('b', null, fmt.int(s.pend)), h('small', null, 'pendentes')),
          h('div', { class: 'ok' }, h('b', null, s.env ? fmt.pct(s.volt / s.env, 0) : '—'), h('small', null, `voltaram (${c.janela} dias)`))),
        h('div', { class: 'cp-barra' }, h('span', { style: { width: (s.total ? (s.env + s.opt) / s.total * 100 : 0) + '%' } })));
    });
    por(corpo,
      novas.length ? h('div', { class: 'notice' }, `Nova lista criada para: ${novas.join(', ')} (campanha recorrente).`) : null,
      h('div', { class: 'cp-acoes' }, h('button', { type: 'button', class: 'btn primary', onclick: () => criar(corpo, lista) }, '+ Criar campanha')),
      lista.length ? h('div', { class: 'cp-grid' }, ...cards) : TS.card(null, null, TS.empty('Nenhuma campanha ainda. Clique em "Criar campanha" para montar a primeira.')));
  }

  // ---------- criar ----------
  function criar(corpo, lista, base, editando) {
    const f = { ...PADRAO, ...(base ? base.filtros : {}) };
    const db = TS.db;
    const modelos = A().modelos();
    const campo = (rot, el, dica) => h('label', { class: 'cp-campo' }, h('span', null, rot, dica ? TS.dica(dica) : null), el);
    const inp = (k, ph, tipo = 'number') => { const i = h('input', { class: 'f-input', type: tipo, placeholder: ph, value: f[k] ?? '', min: tipo === 'number' ? 0 : null }); i.addEventListener('input', () => { f[k] = i.value; atualizar(); }); return i; };
    const sel = (k, opcoes) => { const s = h('select', { class: 'f-input' }, ...opcoes.map(([v, t]) => h('option', { value: v, selected: String(f[k]) === String(v) || null }, t))); s.addEventListener('change', () => { f[k] = s.value; atualizar(); }); return s; };
    const nome = h('input', { class: 'f-input', placeholder: 'Ex.: Pontos vencendo em dezembro', value: base ? base.nome + (editando ? '' : ' (cópia)') : '' });
    const msg = h('textarea', { class: 'f-input cp-msg', rows: 4 }, base ? base.mensagem : (modelos.find((m) => /pontos/i.test(m.nome)) || modelos[0] || { texto: '' }).texto);
    const modSel = h('select', { class: 'f-input' }, h('option', { value: '' }, 'Usar um modelo…'), ...modelos.map((m, k) => h('option', { value: k }, m.nome)));
    modSel.addEventListener('change', () => { if (modSel.value !== '') { msg.value = modelos[+modSel.value].texto; atualizar(); } modSel.value = ''; });
    const janela = h('input', { class: 'f-input', type: 'number', min: 1, max: 365, value: base ? base.janela : 30 });
    const rec = h('select', { class: 'f-input' }, h('option', { value: '' }, 'Não (lista única)'), h('option', { value: 'semanal', selected: base && base.recorrente === 'semanal' || null }, 'Toda semana'), h('option', { value: 'mensal', selected: base && base.recorrente === 'mensal' || null }, 'Todo mês'));
    const segBox = h('div', { class: 'chips' }, ...SEGS.map(([k, t]) => { const b = h('button', { type: 'button', class: 'chip' + (f.segs.includes(k) ? ' on' : '') }, t); b.addEventListener('click', () => { f.segs = f.segs.includes(k) ? f.segs.filter((x) => x !== k) : [...f.segs, k]; b.classList.toggle('on'); atualizar(); }); return b; }));
    const vendedoras = [...new Set(TS.cli.lista.map((c) => c.vendedora).filter(Boolean))].sort();
    const lojasRede = [...new Set(((TS.cli.fixe && TS.cli.fixe.movs) || []).filter((m) => !m.propria && m.loja).map((m) => m.loja))].sort();
    const grupos = db.opts.grupos.map(([nomeG]) => nomeG).filter(Boolean);
    const MESES = TS.MESES_LONGOS.map((m, k) => [k + 1, m]);
    const contagem = h('div', { class: 'cp-contagem' });
    const previa = h('div', { class: 'cp-previa' });
    const exemplo = h('div', { class: 'cli-msg cp-exemplo' });
    let sel_ = [];
    const atualizar = TS.debounce(() => {
      sel_ = selecionar(f);
      contagem.replaceChildren(h('b', null, fmt.int(sel_.length)), ` ${sel_.length === 1 ? 'cliente' : 'clientes'} com celular entram na campanha`);
      const c0 = sel_[0] && sel_[0].c;
      exemplo.replaceChildren(h('small', { class: 'muted' }, c0 ? `Como fica para ${c0.nome || 'o primeiro cliente'}:` : 'Exemplo:'), h('div', null, c0 ? A().texto(msg.value, c0, extras({ filtros: f })) : msg.value));
      por(previa, sel_.length ? TS.table({
        cols: [{ key: 'nome', label: 'Cliente', align: 'l', render: (r) => h('span', null, r.nome, h('small', { class: 'muted cp-cel' }, `${r.cel} · CPF ${A().fmtCPF(r.cpf)}`)) }, { key: 'saldo', label: 'Pontos', fmt: fmt.int }, { key: 'vence', label: 'Vencem', align: 'l' }, { key: 'ultima', label: 'Última compra', align: 'l', render: (r) => d(r.ult) }],
        rows: sel_.slice(0, 300).map(({ c, saldo }) => ({ cpf: c.cpf, nome: c.nome || '—', cel: A().fmtTel(c.celular), saldo, vence: c.fx && c.fx.prox != null ? `${fmt.int(c.fx.proxPts)} em ${d(c.fx.prox)}` : '—', ult: c.ultima, ultima: c.ultima ?? -1 })),
        sortKey: 'saldo', onRowClick: (r) => A().abrirClientes([r.cpf]),
      }) : TS.empty('Nenhum cliente com celular atende a esses critérios.'), sel_.length > 300 ? h('small', { class: 'muted' }, `Mostrando 300 de ${fmt.int(sel_.length)}. A campanha guarda todos.`) : null);
    }, 250);
    msg.addEventListener('input', atualizar);
    const salvar = h('button', { type: 'button', class: 'btn primary' }, editando ? 'Salvar alterações' : 'Salvar campanha');
    const erro = h('span', { class: 'muted' });
    const filtrosAntes = JSON.stringify(editando ? { ...PADRAO, ...base.filtros } : null);
    const refazer = h('input', { type: 'checkbox', checked: true });
    const refazerBox = editando ? h('label', { class: 'cp-campo cp-check' }, refazer, h('span', null, 'Se mudar os critérios, refazer a lista atual (quem já recebeu continua marcado)')) : null;
    salvar.addEventListener('click', async () => {
      erro.textContent = '';
      if (!nome.value.trim()) { erro.textContent = 'Dê um nome à campanha.'; nome.focus(); return; }
      if (!sel_.length && !editando) { erro.textContent = 'Nenhum cliente na lista.'; return; }
      salvar.disabled = true;
      if (editando) {
        try {
          const r = await api('PUT', `/api/campanhas/${base.id}`, { loja: state.loja, nome: nome.value.trim(), mensagem: msg.value.trim(), janela: +janela.value || 30, recorrente: rec.value, filtros: f });
          Object.assign(base, r.campanha);
          if (refazer.checked && JSON.stringify(f) !== filtrosAntes && base.rodadas[0]) {
            const r2 = await api('PUT', `/api/campanhas/${base.id}/rodadas/${base.rodadas[0].id}`, { loja: state.loja, lista: sel_.map(({ c }) => ({ cpf: c.cpf, nome: c.nome })) });
            Object.assign(base, r2.campanha);
          }
          abrirCampanha(corpo, lista, base);
        } catch (e) { erro.textContent = e.message; salvar.disabled = false; }
        return;
      }
      try {
        const r = await api('POST', '/api/campanhas', { loja: state.loja, nome: nome.value.trim(), mensagem: msg.value.trim(), janela: +janela.value || 30, recorrente: rec.value, filtros: f, lista: sel_.map(({ c }) => ({ cpf: c.cpf, nome: c.nome })) });
        lista.unshift(r.campanha);
        abrirCampanha(corpo, lista, r.campanha);
      } catch (e) { erro.textContent = e.message; salvar.disabled = false; }
    });
    const grupo = (titulo, ...itens) => h('div', { class: 'cp-grupo' }, h('div', { class: 'fx-grupo-tit' }, titulo), h('div', { class: 'cp-campos' }, ...itens));
    corpo.replaceChildren(
      h('div', { class: 'cp-acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => (editando ? abrirCampanha(corpo, lista, base) : pintarLista(corpo, lista, [])) }, editando ? '‹ Voltar à campanha' : '‹ Voltar às campanhas')),
      h('div', { class: 'grid g-3-2', style: { alignItems: 'start' } },
        TS.card(editando ? `Editar "${base.nome}"` : 'Nova campanha', 'Escolha quem entra. Só aparecem clientes com celular cadastrado que não pediram para não receber mensagens.',
          h('div', { class: 'cp-form' },
            campo('Nome da campanha', nome),
            grupo('Pontos (FIXE)',
              campo('Saldo de', inp('ptsMin', 'mín.')), campo('até', inp('ptsMax', 'máx.')),
              campo('Pontos vencendo em até (dias)', inp('venceDias', 'ex.: 30'), 'Só quem tem pontos que vencem nos próximos N dias. Vazio = não filtra.')),
            grupo('Compras',
              campo('Comprou o produto', inp('produto', 'ex.: earl grey', 'search'), 'Parte do nome do produto. Use {produto} na mensagem para citar.'),
              campo('ou do grupo', sel('grupo', [['', 'Qualquer grupo'], ...grupos.map((g) => [g, g])])),
              campo('nos últimos (dias)', inp('compraDias', 'vazio = qualquer época')),
              campo('Dias sem comprar: de', inp('ausMin', 'ex.: 60'), 'Dias desde a última compra com CPF.'), campo('até', inp('ausMax', 'máx.')),
              campo('Visitas (compras): de', inp('visMin', 'mín.'), 'Quantas compras o cliente já fez (cupons com CPF), em todo o histórico.'), campo('até', inp('visMax', 'máx.'))),
            grupo('Perfil',
              campo('Aniversário', sel('aniv', [['', 'Qualquer mês'], ['atual', 'Mês atual'], ['proximo', 'Próximo mês'], ...MESES]), '"Mês atual" e "Próximo mês" acompanham a data nas campanhas recorrentes.'),
              campo('Mais atendido por', sel('vendedora', [['', 'Qualquer vendedora'], ...vendedoras.map((v) => [v, v])])),
              campo('Loja preferida', sel('lojaPref', [['', 'Qualquer loja'], ['nossa', 'Esta loja'], ['outra', 'Outra loja da rede'], ...lojasRede.map((l) => [l, l])]), 'Loja onde o cliente mais comprou nos últimos 12 meses (esta loja pelas vendas; as outras pelas compras lançadas no FIXE). "Outra loja da rede" = clientes que compram mais em outra loja.'),
              campo('Não incluir quem foi contatado há menos de (dias)', inp('semContato', '0 = incluir'), 'Evita mandar duas mensagens seguidas para a mesma pessoa.')),
            h('div', { class: 'cp-grupo' }, h('div', { class: 'fx-grupo-tit' }, 'Segmentos (qualquer um deles)'), segBox),
            h('div', { class: 'cp-grupo' }, h('div', { class: 'fx-grupo-tit' }, 'Mensagem'),
              h('div', { class: 'cp-campos' }, campo('Modelo', modSel)),
              msg,
              h('small', { class: 'muted' }, 'Campos: {nome} primeiro nome · {pontos} saldo · {vence} data do próximo vencimento · {cha} chá favorito · {produto} produto do filtro · {loja}'),
              exemplo),
            grupo('Envio e retorno',
              campo('Medir o retorno em (dias)', janela, 'Conta como "voltou" quem comprar (cupom com CPF) do dia do envio até N dias depois.'),
              campo('Repetir', rec, 'Toda semana ou todo mês uma lista nova é montada com estes critérios quando a tela de campanhas é aberta.')),
            refazerBox,
            h('div', { class: 'cp-salvar' }, contagem, salvar, erro))),
        TS.card('Quem entra', 'Clique num cliente para ver a ficha', previa)));
    atualizar();
  }

  // ---------- campanha: fila de envio, lista e retorno ----------
  function abrirCampanha(corpo, lista, camp, rodadaId) {
    const r = camp.rodadas.find((x) => x.id === rodadaId) || camp.rodadas[0];
    const s = resumoRodada(r, camp.janela);
    const repintar = () => abrirCampanha(corpo, lista, camp, r.id);
    const marcarSt = async (it, st) => {
      const x = await api('POST', `/api/campanhas/${camp.id}/marcar`, { loja: state.loja, rodada: r.id, cpf: it.cpf, st });
      Object.assign(it, x.item);
    };
    // fila: próximo pendente
    const pend = r.lista.filter((x) => x.st === 'p');
    const atual = pend[0];
    let fila;
    if (atual) {
      const c = clienteDe(atual.cpf);
      const txt = A().texto(camp.mensagem, c, extras(camp));
      const ct = A().contatoDe(c);
      const enviar = h('a', { class: 'btn primary cp-enviar', href: c.wpp ? A().linkWpp(c, txt) : '#', target: '_blank', rel: 'noopener' }, 'Abrir no WhatsApp e ir para o próximo ›');
      enviar.addEventListener('click', async (e) => {
        if (!c.wpp || TS.demo) e.preventDefault();
        enviar.classList.add('carregando');
        try { await marcarSt(atual, 'e'); if (!TS.demo) await A().marcar(c, 'contatado', 'Campanha: ' + camp.nome.slice(0, 28)).catch(() => {}); } catch (err) { alert(err.message); }
        repintar();
      });
      fila = TS.card('Fila de envio', `${fmt.int(pend.length)} pendentes · com o WhatsApp da loja aberto neste computador, clique, confira e aperte Enter no WhatsApp`,
        h('div', { class: 'cp-fila' },
          h('div', { class: 'cp-fila-cli' },
            h('div', { class: 'cj-nome' }, c.nome || 'Cliente'),
            h('div', { class: 'cli-meta' }, h('span', null, 'CPF ' + A().fmtCPF(c.cpf)), h('span', null, A().fmtTel(c.celular) || 'sem celular'), c.fx ? h('span', { class: 'cli-pts' }, `★ ${fmt.int(c.fx.saldo || 0)} pts`) : null,
              c.fx && c.fx.prox != null ? h('span', null, `${fmt.int(c.fx.proxPts)} vencem em ${d(c.fx.prox)}`) : null,
              c.ultima != null ? h('span', null, `última compra ${d(c.ultima)}`) : null,
              ct && ct.em ? h('span', { class: 'cli-tag t-contato' }, 'contatado ' + fmt.date(ct.em.slice(0, 10))) : null),
            h('div', { class: 'cli-msg' }, txt),
            !c.wpp ? h('div', { class: 'notice err' }, 'Este cliente está sem celular válido agora.') : null),
          h('div', { class: 'cp-fila-bts' }, enviar,
            h('button', { type: 'button', class: 'btn', onclick: async () => { await marcarSt(atual, 'x').catch((e) => alert(e.message)); repintar(); } }, 'Pular'),
            h('button', { type: 'button', class: 'btn', onclick: () => A().abrirClientes([c.cpf]) }, 'Ver cliente'),
            h('button', { type: 'button', class: 'btn danger-txt', onclick: async () => { if (!confirm(`${c.nome || 'Este cliente'} não quer receber mensagens?`)) return; await marcarSt(atual, 'o').catch(() => {}); if (!TS.demo) await A().marcar(c, 'optout').catch(() => {}); repintar(); } }, 'Não quer mensagens'))));
    } else {
      fila = TS.card('Fila de envio', null, h('div', { class: 'cp-fim' }, h('b', null, '✓ Todas as mensagens desta lista foram enviadas.'), ` O retorno é medido até ${camp.janela} dias depois de cada envio.`));
    }
    // lista com situação e retorno
    const ST = { p: ['Pendente', ''], e: ['Enviada', 'ok'], o: ['Não quer', 'neg'], x: ['Pulada', ''] };
    const linhas = r.lista.map((it) => {
      const c = clienteDe(it.cpf), ret = retorno(it, camp.janela);
      return { it, cpf: it.cpf, nome: it.nome || c.nome || '—', cel: A().fmtTel(c.celular), st: it.st, em: it.em ? isoDia(it.em) : null, por: it.por || '', voltou: ret ? (ret.voltou ? 2 : ret.aberto ? 1 : 0) : -1, ret };
    });
    const tab = TS.table({
      cols: [
        { key: 'nome', label: 'Cliente', align: 'l', render: (x) => h('span', null, x.nome, h('small', { class: 'muted cp-cel' }, 'CPF ' + A().fmtCPF(x.cpf))) },
        { key: 'cel', label: 'Celular', align: 'l' },
        { key: 'st', label: 'Situação', align: 'l', render: (x) => h('span', { class: 'cp-st ' + ST[x.st][1] }, ST[x.st][0], x.em != null ? h('small', null, ` ${d(x.em)}${x.por ? ' · ' + x.por : ''}`) : null), sortVal: (x) => ({ e: 3, x: 2, o: 1, p: 0 })[x.st] },
        { key: 'voltou', label: `Voltou em ${camp.janela} dias`, align: 'l', render: (x) => (!x.ret ? '—' : x.ret.voltou ? h('span', { class: 'cp-st ok' }, `Sim · ${d(x.ret.primeira)} · ${fmt.brl0(x.ret.vt)}`) : x.ret.aberto ? h('span', { class: 'muted' }, 'ainda no prazo') : h('span', { class: 'muted' }, 'não')) },
        { key: 'acao', label: '', align: 'l', render: (x) => (x.st !== 'p' ? h('button', { type: 'button', class: 'link-btn', onclick: async (e) => { e.stopPropagation(); await marcarSt(x.it, 'p').catch((er) => alert(er.message)); repintar(); } }, 'voltar para a fila') : null), sortVal: () => 0 },
      ],
      rows: linhas.map((x) => ({ ...x, cpfTxt: A().fmtCPF(x.cpf) + ' ' + x.cpf })), search: 'Buscar por nome, CPF ou celular', searchKeys: ['nome', 'cpfTxt', 'cel'], sortKey: 'st', sortDir: 'asc', rowClass: (x) => (x.st === 'e' ? 'cp-enviada' : null), onRowClick: (x) => A().abrirClientes([x.cpf]),
    });
    const csvBt = h('button', { type: 'button', class: 'btn', onclick: () => A().csv('campanha-' + camp.nome.replace(/\W+/g, '-').toLowerCase(), ['Cliente', 'CPF', 'Celular', 'Situação', 'Enviada em', 'Por', 'Voltou', 'Valor no retorno'],
      linhas.map((x) => [x.nome, A().fmtCPF(x.cpf), TS.demo ? '' : x.cel, ST[x.st][0], x.em != null ? d(x.em) : '', x.por, x.ret ? (x.ret.voltou ? 'sim' : x.ret.aberto ? 'no prazo' : 'não') : '', x.ret && x.ret.voltou ? x.ret.vt.toFixed(2).replace('.', ',') : ''])) }, 'Baixar lista (CSV)');
    const rodSel = camp.rodadas.length > 1 ? (() => { const sx = h('select', { class: 'f-input', style: { width: 'auto' } }, ...camp.rodadas.map((x) => h('option', { value: x.id, selected: x.id === r.id || null }, `Lista de ${fmt.date(x.em.slice(0, 10))} (${fmt.int(x.lista.length)})`))); sx.addEventListener('change', () => abrirCampanha(corpo, lista, camp, sx.value)); return sx; })() : null;
    const kpi = (rot, val, sub, dica) => TS.kpi(rot, val, sub, dica);
    por(corpo,
      h('div', { class: 'cp-acoes' },
        h('button', { type: 'button', class: 'btn', onclick: () => pintarLista(corpo, lista, []) }, '‹ Voltar às campanhas'),
        rodSel,
        h('span', { style: { flex: 1 } }),
        h('button', { type: 'button', class: 'btn', onclick: () => criar(corpo, lista, camp, true) }, 'Editar campanha'),
        camp.recorrente ? h('button', { type: 'button', class: 'btn', onclick: async () => { try { const x = await api('PUT', `/api/campanhas/${camp.id}`, { loja: state.loja, ativa: camp.ativa === false }); Object.assign(camp, x.campanha); repintar(); } catch (e) { alert(e.message); } } }, camp.ativa === false ? 'Retomar repetição' : 'Pausar repetição') : null,
        h('button', { type: 'button', class: 'btn', onclick: () => criar(corpo, lista, camp) }, 'Duplicar'),
        h('button', { type: 'button', class: 'btn danger-txt', onclick: async () => { if (!confirm(`Apagar a campanha "${camp.nome}"? As listas e o retorno somem.`)) return; await api('DELETE', `/api/campanhas/${camp.id}?${qs()}`).catch((e) => alert(e.message)); lista.splice(lista.indexOf(camp), 1); pintarLista(corpo, lista, []); } }, 'Apagar')),
      h('div', { class: 'page-head cp-head' }, h('div', null, h('h2', { class: 'page-title' }, camp.nome),
        h('div', { class: 'page-sub' }, `${camp.recorrente ? (camp.recorrente === 'semanal' ? 'Toda semana · ' : 'Todo mês · ') : ''}lista de ${fmt.date(r.em.slice(0, 10))} · retorno medido em ${camp.janela} dias`))),
      h('div', { class: 'grid g-kpi' },
        kpi('Na lista', fmt.int(s.total), `${fmt.int(s.pend)} pendentes`),
        kpi('Enviadas', fmt.int(s.env), s.total ? `${fmt.pct(s.env / s.total, 0)} da lista` : null, 'Mensagens abertas no WhatsApp pela fila (clique em "Abrir no WhatsApp").'),
        kpi('Voltaram', s.env ? fmt.pct(s.volt / s.env, 0) : '—', `${fmt.int(s.volt)} de ${fmt.int(s.env)} enviados${s.aberto ? ` · ${fmt.int(s.aberto)} ainda no prazo` : ''}`, `Clientes que compraram (cupom com CPF) do dia do envio até ${camp.janela} dias depois.`),
        kpi('Faturamento do retorno', fmt.brl0(s.vt), s.volt ? `ticket ${fmt.brl0(s.vt / s.volt)}` : null, 'Soma das compras desses clientes no prazo do retorno.'),
        kpi('Não querem', fmt.int(s.opt), 'saíram das próximas campanhas')),
      h('div', { class: 'mt' }, fila),
      h('div', { class: 'mt' }, TS.cardWithTools('Clientes da campanha', 'Enviadas ficam em verde · clique num cliente para ver a ficha', h('div', { class: 'cp-acoes', style: { margin: 0 } }, tab.searchBox, csvBt), tab)));
  }

})();
