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
  const PADRAO = { ptsMin: '', ptsMax: '', venceDias: '', produto: '', produtos: [], grupo: '', compraDias: '', ausMin: '', ausMax: '', visMin: '', visMax: '', aniv: '', segs: [], vendedora: '', lojaPref: '', semContato: 30 };
  const num = (v) => (v === '' || v == null || Number.isNaN(+v) ? null : +v);

  /** clientes que atendem aos critérios: só com celular e sem "não quer mensagens" */
  function selecionar(f) {
    const db = TS.db, hoje = dia();
    const lp = listaProdutos(f);
    const grupoId = f.grupo ? db.D.grupoC.indexOf(f.grupo) : -1;
    if (f.grupo && grupoId < 0) return []; // grupo que não existe mais nas vendas: ninguém (antes o filtro era ignorado e entrava todo mundo)
    const desde = num(f.compraDias) != null ? hoje - num(f.compraDias) : -Infinity;
    let prodOk = null;
    if (lp.length) {
      const exatos = new Set(lp.filter((x) => !x.contem).map((x) => TS.norm(x.t))), partes = lp.filter((x) => x.contem).map((x) => TS.norm(x.t));
      prodOk = new Uint8Array(db.D.descricao.length);
      db.D.descricao.forEach((t, i) => { const n = TS.norm(t); if (exatos.has(n) || partes.some((q) => n.includes(q))) prodOk[i] = 1; });
    }
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
  /** produtos do filtro: [{ t, contem }]. "~texto" = todos os produtos que contêm o texto; o campo antigo "produto" vira "contém" */
  function listaProdutos(f) {
    const l = Array.isArray(f.produtos) && f.produtos.length ? f.produtos : f.produto ? ['~' + f.produto] : [];
    return l.filter(Boolean).map((x) => (x[0] === '~' ? { t: x.slice(1), contem: true } : { t: x, contem: false }));
  }
  /** {produto} na mensagem: os nomes escolhidos ("African Sunset 250G e African Sunset 100G") */
  const nomesProdutos = (f) => {
    const n = listaProdutos(f || {}).map((x) => x.t.replace(/\s+/g, ' ').trim());
    return n.length <= 1 ? n[0] || '' : n.slice(0, -1).join(', ') + ' e ' + n[n.length - 1];
  };
  const extras = (camp) => ({ produto: nomesProdutos(camp.filtros) });

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
      lista.copias = j.copias || [];
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
  /** retorno por variação da mensagem: enviadas, voltaram e faturamento de cada uma */
  function cartaoVariacoes(r, camp, textos) {
    const linhas = textos.map((t, k) => {
      const its = r.lista.filter((x) => x.st === 'e' && x.v === k);
      let volt = 0, vt = 0, aberto = 0;
      for (const it of its) { const x = retorno(it, camp.janela); if (x.voltou) { volt++; vt += x.vt; } if (x.aberto) aberto++; }
      return { k: k + 1, texto: t, env: its.length, volt, pct: its.length ? volt / its.length : null, vt, aberto };
    });
    const melhor = linhas.filter((l) => l.env >= 10).sort((a, b) => b.pct - a.pct)[0];
    return TS.card('Retorno por variação', `Cada cliente recebeu uma versão da mensagem · com poucas mensagens (menos de 10 por variação) a diferença ainda é sorte`, TS.table({
      cols: [
        { key: 'k', label: 'Variação', align: 'l', render: (l) => h('span', null, `${l.k}`, melhor && melhor.k === l.k ? h('span', { class: 'cli-tag t-repor' }, ' melhor até agora') : null) },
        { key: 'texto', label: 'Mensagem', align: 'l', render: (l) => h('small', { class: 'cp-var-txt' }, l.texto.length > 110 ? l.texto.slice(0, 110) + '…' : l.texto) },
        { key: 'env', label: 'Enviadas', fmt: fmt.int }, { key: 'pct', label: 'Voltaram', render: (l) => (l.pct == null ? '—' : `${fmt.pct(l.pct, 0)} (${fmt.int(l.volt)})`) },
        { key: 'vt', label: 'Faturamento', fmt: fmt.brl0 },
      ], rows: linhas, sortKey: 'k', sortDir: 'asc',
    }));
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
    const copias = (lista.copias || []).map((cp) => h('div', { class: 'card cp-recebida' },
      h('div', null, h('b', null, cp.nome), h('small', { class: 'muted' }, ` · copiada de ${cp.deNome || cp.deLoja} por ${cp.por || '—'} em ${fmt.date(cp.em.slice(0, 10))}`),
        h('div', { class: 'muted cp-recebida-msg' }, cp.mensagem.length > 140 ? cp.mensagem.slice(0, 140) + '…' : cp.mensagem)),
      h('div', { class: 'cp-recebida-acoes' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => criar(corpo, lista, { ...cp, copia: cp.id }) }, 'Montar a lista desta loja'),
        h('button', { type: 'button', class: 'btn', onclick: async () => { if (!confirm(`Descartar a campanha "${cp.nome}" recebida de ${cp.deNome || cp.deLoja}?`)) return; try { await api('DELETE', `/api/campanhas/copias/${cp.id}?${qs()}`); lista.copias = lista.copias.filter((x) => x !== cp); pintarLista(corpo, lista, []); } catch (e) { alert(e.message); } } }, 'Descartar'))));
    por(corpo,
      novas.length ? h('div', { class: 'notice' }, `Nova lista criada para: ${novas.join(', ')} (campanha recorrente).`) : null,
      copias.length ? h('div', { class: 'cp-recebidas' }, h('div', { class: 'cp-recebidas-tit' }, h('b', null, `Recebidas de outras lojas (${copias.length})`), h('small', { class: 'muted' }, ' · a mensagem e os critérios vêm prontos; a lista é montada com os clientes desta loja')), ...copias) : null,
      h('div', { class: 'cp-acoes' }, h('button', { type: 'button', class: 'btn primary', onclick: () => criar(corpo, lista) }, '+ Criar campanha')),
      lista.length ? h('div', { class: 'cp-grid' }, ...cards) : TS.card(null, null, TS.empty('Nenhuma campanha ainda. Clique em "Criar campanha" para montar a primeira.')));
  }

  /** escolher as lojas que recebem a campanha (mensagem e critérios; cada loja monta a própria lista) */
  function copiarPara(camp) {
    const outras = (TS.lojas || []).filter((l) => l.id !== state.loja).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const marc = new Set();
    const ok = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Copiar');
    const conta = () => { ok.disabled = !marc.size; ok.textContent = marc.size ? `Copiar para ${marc.size} ${marc.size === 1 ? 'loja' : 'lojas'}` : 'Copiar'; };
    const itens = outras.map((l) => { const cb = h('input', { type: 'checkbox' }); cb.addEventListener('change', () => { if (cb.checked) marc.add(l.id); else marc.delete(l.id); conta(); }); return h('label', { class: 'cp-loja' }, cb, h('span', null, l.nome)); });
    const todas = h('button', { type: 'button', class: 'btn link' }, 'Marcar todas');
    todas.addEventListener('click', () => { const tudo = marc.size < outras.length; itens.forEach((it, k) => { const cb = it.querySelector('input'); cb.checked = tudo; if (tudo) marc.add(outras[k].id); else marc.delete(outras[k].id); }); conta(); });
    const erro = h('div', { class: 'muted' });
    const fundo = h('div', { class: 'cp-modal-bg' });
    const fechar = () => fundo.remove();
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    ok.addEventListener('click', async () => {
      ok.disabled = true; erro.textContent = '';
      try { const r = await api('POST', `/api/campanhas/${camp.id}/copiar`, { loja: state.loja, destinos: [...marc] }); fechar(); const t = h('div', { class: 'toast', role: 'status' }, `Copiada para ${r.destinos.length} ${r.destinos.length === 1 ? 'loja' : 'lojas'}. Lá ela aparece em "Recebidas de outras lojas".`); document.body.append(t); setTimeout(() => t.remove(), 6000); } catch (e) { erro.textContent = e.message; ok.disabled = false; }
    });
    fundo.append(h('div', { class: 'card cp-copiar' },
      h('h3', null, 'Copiar para outra loja'),
      h('p', { class: 'muted' }, `"${camp.nome}" vai com a mensagem e os critérios. Em cada loja, quem abrir Campanhas clica em "Montar a lista desta loja": a lista sai dos clientes de lá.`),
      outras.length > 3 ? todas : null,
      h('div', { class: 'cp-lojas' }, ...itens), erro,
      h('div', { class: 'cp-acoes' }, h('span', { style: { flex: 1 } }), h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Cancelar'), ok)));
    document.body.append(fundo);
  }

  // ---------- criar ----------
  function criar(corpo, lista, base, editando) {
    const f = { ...PADRAO, ...(base ? base.filtros : {}) };
    const db = TS.db;
    const modelos = A().modelos();
    const campo = (rot, el, dica) => h('label', { class: 'cp-campo' }, h('span', null, rot, dica ? TS.dica(dica) : null), el);
    const inp = (k, ph, tipo = 'number') => { const i = h('input', { class: 'f-input', type: tipo, placeholder: ph, value: f[k] ?? '', min: tipo === 'number' ? 0 : null }); i.addEventListener('input', () => { f[k] = i.value; atualizar(); }); return i; };
    const sel = (k, opcoes) => { const s = h('select', { class: 'f-input' }, ...opcoes.map(([v, t]) => h('option', { value: v, selected: String(f[k]) === String(v) || null }, t))); s.addEventListener('change', () => { f[k] = s.value; atualizar(); }); return s; };
    const nome = h('input', { class: 'f-input', placeholder: 'Ex.: Pontos vencendo em dezembro', value: base ? base.nome + (editando || base.copia ? '' : ' (cópia)') : '' });
    const msg = h('textarea', { class: 'f-input cp-msg', rows: 4 }, base ? base.mensagem : (modelos.find((m) => /pontos/i.test(m.nome)) || modelos[0] || { texto: '' }).texto);
    const modSel = h('select', { class: 'f-input' }, h('option', { value: '' }, 'Usar um modelo…'), ...modelos.map((m, k) => h('option', { value: k }, m.nome)));
    modSel.addEventListener('change', () => { if (modSel.value !== '') { msg.value = modelos[+modSel.value].texto; atualizar(); } modSel.value = ''; });
    const janela = h('input', { class: 'f-input', type: 'number', min: 1, max: 365, value: base ? base.janela : 30 });
    const limite = h('input', { class: 'f-input cp-num', type: 'number', min: 0, max: 500, value: base && base.limiteDia != null ? base.limiteDia : 20 });
    // variações da mensagem (até 4 além da principal): cada cliente recebe uma, em rodízio; o retorno é medido por variação
    let alvoMsg = msg;
    msg.addEventListener('focus', () => { alvoMsg = msg; });
    const varBox = h('div', { class: 'cp-variacoes' });
    const variacoes = [];
    const addVar = (txt = '') => {
      if (variacoes.length >= 4) return;
      const t = h('textarea', { class: 'f-input cp-msg', rows: 3, placeholder: 'Mesma ideia, com outras palavras…' }, txt);
      t.addEventListener('focus', () => { alvoMsg = t; });
      t.addEventListener('input', () => atualizar());
      const linhaV = h('div', { class: 'cp-var' }, h('div', { class: 'cp-var-top' }, h('small', null, ''), h('button', { type: 'button', class: 'link-btn', onclick: () => { variacoes.splice(variacoes.indexOf(t), 1); linhaV.remove(); numerar(); atualizar(); } }, 'remover')), t);
      variacoes.push(t); varBox.append(linhaV); numerar();
    };
    const btVar = h('button', { type: 'button', class: 'btn' }, '+ Adicionar variação');
    btVar.addEventListener('click', () => { addVar(); variacoes[variacoes.length - 1].focus(); });
    function numerar() { [...varBox.children].forEach((el, k) => { el.querySelector('small').textContent = `Variação ${k + 2}`; }); btVar.hidden = variacoes.length >= 4; }
    for (const v of (base && base.variacoes) || []) addVar(v);
    const textosVar = () => variacoes.map((t) => t.value.trim()).filter(Boolean);
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
    let atualizar = TS.debounce(() => {
      sel_ = selecionar(f);
      contagem.replaceChildren(h('b', null, fmt.int(sel_.length)), ` ${sel_.length === 1 ? 'cliente' : 'clientes'} com celular entram na campanha`);
      const c0 = sel_[0] && sel_[0].c;
      // quem não tem o dado de um campo usado (ex.: sem chá favorito) recebe o texto de reserva: avisa quantos
      const faltam = (TS.CAMPOS_MSG || []).filter(([k, , falta]) => falta && msg.value.includes('{' + k + '}'))
        .map(([k, , falta]) => [k, sel_.filter(({ c }) => falta(c)).length]).filter(([, n]) => n);
      exemplo.replaceChildren(h('small', { class: 'muted' }, c0 ? `Como fica para ${c0.nome || 'o primeiro cliente'}:` : 'Exemplo:'), h('div', null, c0 ? A().texto(msg.value, c0, extras({ filtros: f })) : msg.value),
        ...(faltam.length ? [h('small', { class: 'cp-faltam' }, 'Sem o dado: ', faltam.map(([k, n]) => `{${k}} em ${fmt.int(n)} ${n === 1 ? 'cliente' : 'clientes'}`).join(' · '), ' — confira como fica para eles ou ajuste a frase.')] : []));
      por(previa, sel_.length ? TS.table({
        cols: [{ key: 'nome', label: 'Cliente', align: 'l', render: (r) => h('span', null, r.nome, h('small', { class: 'muted cp-cel' }, `${r.cel} · CPF ${A().fmtCPF(r.cpf)}`)) }, { key: 'saldo', label: 'Pontos', fmt: fmt.int }, { key: 'vence', label: 'Vencem', align: 'l' }, { key: 'ultima', label: 'Última compra', align: 'l', render: (r) => d(r.ult) }],
        rows: sel_.slice(0, 300).map(({ c, saldo }) => ({ cpf: c.cpf, nome: c.nome || '—', cel: A().fmtTel(c.celular), saldo, vence: c.fx && c.fx.prox != null ? `${fmt.int(c.fx.proxPts)} em ${d(c.fx.prox)}` : '—', ult: c.ultima, ultima: c.ultima ?? -1 })),
        sortKey: 'saldo', onRowClick: (r) => A().abrirClientes([r.cpf]),
      }) : TS.empty('Nenhum cliente com celular atende a esses critérios.'), sel_.length > 300 ? h('small', { class: 'muted' }, `Mostrando 300 de ${fmt.int(sel_.length)}. A campanha guarda todos.`) : null);
    }, 250);
    msg.addEventListener('input', atualizar);
    function camposMsg() {
      const lista = [...(TS.CAMPOS_MSG || []), ['produto', 'produtos escolhidos nos critérios']];
      return h('div', { class: 'cp-campos' }, ...lista.map(([k, dica]) => {
        const b = h('button', { type: 'button', class: 'chip cp-tag', title: dica }, '{' + k + '}');
        b.addEventListener('mousedown', (e) => e.preventDefault()); // não tira o cursor da mensagem
        b.addEventListener('click', () => {
          const m = alvoMsg && alvoMsg.isConnected ? alvoMsg : msg;
          const ini = m.selectionStart ?? m.value.length, fim = m.selectionEnd ?? ini, t = '{' + k + '}';
          m.value = m.value.slice(0, ini) + t + m.value.slice(fim);
          m.focus(); m.selectionStart = m.selectionEnd = ini + t.length; atualizar();
        });
        return b;
      }));
    }
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
          const r = await api('PUT', `/api/campanhas/${base.id}`, { loja: state.loja, nome: nome.value.trim(), mensagem: msg.value.trim(), variacoes: textosVar(), limiteDia: +limite.value || 0, janela: +janela.value || 30, recorrente: rec.value, filtros: f });
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
        const r = await api('POST', '/api/campanhas', { loja: state.loja, nome: nome.value.trim(), mensagem: msg.value.trim(), variacoes: textosVar(), limiteDia: +limite.value || 0, janela: +janela.value || 30, recorrente: rec.value, filtros: f, lista: sel_.map(({ c }) => ({ cpf: c.cpf, nome: c.nome })) });
        lista.unshift(r.campanha);
        if (base && base.copia) { api('DELETE', `/api/campanhas/copias/${base.copia}?${qs()}`).catch(() => null); lista.copias = (lista.copias || []).filter((x) => x.id !== base.copia); }
        abrirCampanha(corpo, lista, r.campanha);
      } catch (e) { erro.textContent = e.message; salvar.disabled = false; }
    });
    // ---- formulário: cada critério numa frase ("Saldo entre __ e __ pontos"), em blocos que abrem e fecham
    const num_ = (k, ph, larg) => { const x = inp(k, ph); x.classList.add('cp-num'); if (larg) x.style.width = larg; return x; };
    const linha = (...partes) => h('div', { class: 'cp-linha' }, ...partes.map((p) => (typeof p === 'string' ? h('span', null, p) : p)));
    const ativo = (...ks) => ks.some((k) => (Array.isArray(f[k]) ? f[k].length : f[k] !== '' && f[k] != null && f[k] !== PADRAO[k]));
    const bloco = (titulo, ks, ...corpoB) => {
      const d = h('details', { class: 'cp-bloco', open: ativo(...ks) || null }, h('summary', null, h('b', null, titulo), h('span', { class: 'cp-bloco-res' })), h('div', { class: 'cp-bloco-corpo' }, ...corpoB));
      d._ks = ks;
      return d;
    };
    // produtos: escolher na lista (exatos, com o tamanho) e/ou "todos que contêm…"
    if (!Array.isArray(f.produtos)) f.produtos = [];
    if (f.produto && !f.produtos.length) { f.produtos = ['~' + f.produto]; }
    f.produto = '';
    const vendidos = new Map();
    for (let i2 = 0; i2 < db.n; i2++) vendidos.set(db.desc[i2], (vendidos.get(db.desc[i2]) || 0) + (db.qtd[i2] || 0));
    const todosProd = db.D.descricao.map((t, k) => ({ t, k, n: TS.norm(t), q: vendidos.get(k) || 0 })).filter((x) => x.t && x.q > 0).sort((a, b) => b.q - a.q);
    const chipsProd = h('div', { class: 'cp-prod-chips' });
    const buscaProd = h('input', { class: 'f-input cp-prod-busca', type: 'search', placeholder: 'Digite parte do nome: african, earl grey, caneca…', autocomplete: 'off' });
    const sugest = h('div', { class: 'cp-sug', role: 'listbox', hidden: true });
    const pintarChips = () => {
      chipsProd.replaceChildren(...f.produtos.map((p) => h('span', { class: 'cp-prod-chip' + (p[0] === '~' ? ' contem' : '') }, p[0] === '~' ? `todos com "${p.slice(1)}"` : p,
        h('button', { type: 'button', 'aria-label': 'Tirar ' + p, onclick: () => { f.produtos = f.produtos.filter((x) => x !== p); pintarChips(); atualizar(); } }, '✕'))));
      chipsProd.hidden = !f.produtos.length;
    };
    const addProd = (p) => { if (!f.produtos.includes(p) && f.produtos.length < 30) f.produtos = [...f.produtos, p]; buscaProd.value = ''; sugest.hidden = true; pintarChips(); atualizar(); buscaProd.focus(); };
    const pintarSug = () => {
      const q = TS.norm(buscaProd.value.trim());
      if (!q) { sugest.hidden = true; return; }
      const achou = todosProd.filter((x) => x.n.includes(q) && !f.produtos.includes(x.t)).slice(0, 9);
      sugest.replaceChildren(...[
        ...achou.map((x) => h('button', { type: 'button', class: 'cp-sug-it', role: 'option', onmousedown: (e) => { e.preventDefault(); addProd(x.t); } }, h('span', null, x.t), h('small', null, `${fmt.int(x.q)} vendidos`))),
        h('button', { type: 'button', class: 'cp-sug-it cp-sug-todos', onmousedown: (e) => { e.preventDefault(); addProd('~' + buscaProd.value.trim()); } }, h('span', null, `Todos os produtos com "${buscaProd.value.trim()}"`), h('small', null, 'todos os tamanhos e variações')),
        !achou.length ? h('div', { class: 'cp-sug-vazio' }, 'Nenhum produto vendido com esse nome.') : null].filter(Boolean));
      sugest.hidden = false;
    };
    buscaProd.addEventListener('input', pintarSug);
    buscaProd.addEventListener('focus', pintarSug);
    buscaProd.addEventListener('blur', () => setTimeout(() => { sugest.hidden = true; }, 150));
    buscaProd.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const p = sugest.querySelector('.cp-sug-it'); if (p) p.dispatchEvent(new MouseEvent('mousedown')); }
      if (e.key === 'Escape') sugest.hidden = true;
    });
    pintarChips();
    const lojaNome = (() => { const o = document.querySelector('#lojaSel option:checked'); const n = o && o.textContent.trim(); return n ? `Esta loja (${n})` : 'Esta loja'; })();
    const blocos = [
      bloco('Pontos no FIXE', ['ptsMin', 'ptsMax', 'venceDias'],
        linha('Saldo entre', num_('ptsMin', 'mín.'), 'e', num_('ptsMax', 'máx.'), 'pontos'),
        linha('Com pontos vencendo nos próximos', num_('venceDias', 'ex.: 30'), 'dias', TS.dica('Só quem tem pontos que vencem nos próximos N dias. Vazio = não filtra.'))),
      bloco('O que comprou', ['produtos', 'grupo', 'compraDias'],
        h('div', { class: 'cp-prod' }, h('span', { class: 'cp-rot' }, 'Comprou', TS.dica('Escolha um ou mais produtos (com o tamanho). Entra quem comprou qualquer um deles. Use {produto} na mensagem para citar os nomes.')),
          h('div', { class: 'cp-prod-box' }, chipsProd, h('div', { class: 'cp-prod-campo' }, buscaProd, sugest))),
        linha('ou algo do grupo', sel('grupo', [['', 'qualquer grupo'], ...grupos.map((g) => [g, g])])),
        linha('nos últimos', num_('compraDias', 'todos'), 'dias', TS.dica('Vazio = em qualquer época.'))),
      bloco('Frequência', ['ausMin', 'ausMax', 'visMin', 'visMax'],
        linha('Está sem comprar há', num_('ausMin', 'ex.: 60'), 'a', num_('ausMax', 'máx.'), 'dias', TS.dica('Dias desde a última compra com CPF.')),
        linha('Já fez de', num_('visMin', 'mín.'), 'a', num_('visMax', 'máx.'), 'compras', TS.dica('Cupons com CPF em todo o histórico.'))),
      bloco('Perfil', ['aniv', 'vendedora', 'lojaPref'],
        linha('Faz aniversário em', sel('aniv', [['', 'qualquer mês'], ['atual', 'mês atual'], ['proximo', 'próximo mês'], ...MESES]), TS.dica('"Mês atual" e "Próximo mês" acompanham a data nas campanhas recorrentes.')),
        linha('Mais atendido por', sel('vendedora', [['', 'qualquer vendedora'], ...vendedoras.map((v) => [v, v])])),
        linha('Compra mais em', sel('lojaPref', [['', 'qualquer loja'], ['nossa', lojaNome], ['outra', 'outra loja da rede'], ...lojasRede.map((l) => [l, l])]), TS.dica('Loja onde o cliente mais comprou nos últimos 12 meses (esta loja pelas vendas; as outras pelas compras lançadas no FIXE).'))),
      bloco('Segmentos', ['segs'], h('small', { class: 'muted' }, 'Entra quem estiver em qualquer um dos marcados.'), segBox),
    ];
    // resumo de cada bloco no título (aparece mesmo fechado)
    const resumoBloco = () => {
      const R = {
        ptsMin: () => (f.ptsMin !== '' || f.ptsMax !== '' ? `saldo ${f.ptsMin || 0}${f.ptsMax !== '' ? '–' + f.ptsMax : '+'} pts` : ''),
        venceDias: () => (f.venceDias !== '' ? `vencendo em ${f.venceDias} dias` : ''),
        produtos: () => (f.produtos.length ? `${f.produtos.length} produto${f.produtos.length > 1 ? 's' : ''}` : ''),
        grupo: () => f.grupo || '', compraDias: () => (f.compraDias !== '' ? `últimos ${f.compraDias} dias` : ''),
        ausMin: () => (f.ausMin !== '' || f.ausMax !== '' ? `sem comprar ${f.ausMin || 0}${f.ausMax !== '' ? '–' + f.ausMax : '+'} dias` : ''),
        visMin: () => (f.visMin !== '' || f.visMax !== '' ? `${f.visMin || 0}${f.visMax !== '' ? '–' + f.visMax : '+'} compras` : ''),
        aniv: () => (f.aniv ? 'aniversário' : ''), vendedora: () => f.vendedora || '', lojaPref: () => (f.lojaPref ? 'loja preferida' : ''),
        segs: () => f.segs.map((k) => (SEGS.find(([x]) => x === k) || [, k])[1]).join(', '),
      };
      for (const b of blocos) b.querySelector('.cp-bloco-res').textContent = b._ks.map((k) => (R[k] ? R[k]() : '')).filter(Boolean).join(' · ');
    };
    const atualizar0 = atualizar;
    atualizar = () => { resumoBloco(); atualizar0(); };
    resumoBloco();
    corpo.replaceChildren(
      h('div', { class: 'cp-acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => (editando ? abrirCampanha(corpo, lista, base) : pintarLista(corpo, lista, [])) }, editando ? '‹ Voltar à campanha' : '‹ Voltar às campanhas')),
      h('div', { class: 'grid g-3-2 cp-tela', style: { alignItems: 'start' } },
        h('div', { class: 'cp-esq' },
          TS.card(editando ? `Editar "${base.nome}"` : 'Nova campanha', null,
            h('div', { class: 'cp-form' },
              h('label', { class: 'cp-campo cp-nome' }, h('span', null, 'Nome da campanha'), nome),
              h('div', { class: 'cp-passo' }, h('span', { class: 'cp-n' }, '1'), h('div', null, h('b', null, 'Quem entra'), h('small', { class: 'muted' }, 'Só clientes com celular que não pediram para não receber mensagens. Os critérios se somam (precisa atender a todos).'))),
              ...blocos,
              linha('Não incluir quem foi contatado há menos de', num_('semContato', '0'), 'dias', TS.dica('Evita mandar duas mensagens seguidas para a mesma pessoa. 0 = incluir todos.')),
              h('div', { class: 'cp-passo' }, h('span', { class: 'cp-n' }, '2'), h('div', null, h('b', null, 'Mensagem'), h('small', { class: 'muted' }, 'Clique num campo para colocar na mensagem onde está o cursor.'))),
              h('div', { class: 'cp-msg-topo' }, modSel), camposMsg(), h('small', { class: 'muted' }, 'Variação 1 (principal)'), msg, exemplo,
              varBox, h('div', { class: 'cp-var-acoes' }, btVar, h('small', { class: 'muted' }, ' Até 5 versões da mesma mensagem. Cada cliente recebe uma, em rodízio, e o painel mostra qual trouxe mais clientes de volta.')),
              h('div', { class: 'cp-passo' }, h('span', { class: 'cp-n' }, '3'), h('div', null, h('b', null, 'Envio e retorno'))),
              linha('Enviar no máximo', limite, 'mensagens por dia nesta campanha', TS.dica('Ao chegar no limite, a fila para e continua no dia seguinte. 0 = sem limite. Poucas mensagens por dia, para quem tem motivo de receber, mantêm o número da loja saudável.')),
              linha('Medir o retorno em', janela, 'dias', TS.dica('Conta como "voltou" quem comprar (cupom com CPF) do dia do envio até N dias depois.')),
              linha('Repetir', rec, TS.dica('Toda semana ou todo mês uma lista nova é montada com estes critérios quando a tela de campanhas é aberta.')),
              refazerBox))),
        h('div', { class: 'cp-dir' },
          h('div', { class: 'card cp-resumo-fixo' }, contagem, h('div', { class: 'cp-salvar' }, salvar, erro)),
          TS.card('Quem entra', 'Clique num cliente para ver a ficha', previa))));
    janela.classList.add('cp-num'); rec.classList.add('cp-sel');
    atualizar();
  }

  // ---------- campanha: fila de envio, lista e retorno ----------
  async function abrirCampanha(corpo, lista, camp, rodadaId, jaRecarregou) {
    // ao abrir: busca de novo quem já recebeu mensagem (de outra campanha, ou de outro computador)
    if (!jaRecarregou) { await A().recarregarContatos(); if (!corpo.isConnected) return; }
    const r = camp.rodadas.find((x) => x.id === rodadaId) || camp.rodadas[0];
    const s = resumoRodada(r, camp.janela);
    const repintar = () => abrirCampanha(corpo, lista, camp, r.id, true);
    const marcarSt = async (it, st, motivo, v) => {
      const x = await api('POST', `/api/campanhas/${camp.id}/marcar`, { loja: state.loja, rodada: r.id, cpf: it.cpf, st, motivo, v });
      for (const k of ['em', 'por', 'motivo', 'liberado', 'v']) delete it[k];
      Object.assign(it, x.item);
    };
    // quem recebeu mensagem de OUTRA campanha (ou pelo painel) há menos de N dias, ou pediu para não receber,
    // sai da fila sozinho como "pulada" com o motivo; "voltar para a fila" libera manualmente
    const dias = Number(String((camp.filtros || {}).semContato ?? '').replace(',', '.')) || 0;
    const minha = 'Campanha: ' + camp.nome.slice(0, 28);
    const bloqueio = (it) => {
      if (it.st !== 'p' || it.liberado) return null;
      const ct = A().contatoDe(clienteDe(it.cpf));
      if (!ct) return null;
      if (ct.optout) return 'não quer mensagens';
      if (dias && ct.em && Date.now() - Date.parse(ct.em) < dias * 864e5 && ct.motivo !== minha) return `já recebeu em ${fmt.date(ct.em.slice(0, 10))}${ct.motivo ? ' (' + ct.motivo.replace(/^Campanha: /, 'campanha ') + ')' : ''}`;
      return null;
    };
    const bloqueados = r.lista.map((it) => [it, bloqueio(it)]).filter(([, m]) => m);
    if (bloqueados.length) {
      for (const [it, m] of bloqueados) { try { await marcarSt(it, 'x', m); } catch { /* tenta de novo na próxima vez */ } }
      if (!corpo.isConnected) return;
      const t = h('div', { class: 'toast', role: 'status' }, `${fmt.int(bloqueados.length)} ${bloqueados.length === 1 ? 'cliente saiu' : 'clientes saíram'} da fila: já ${bloqueados.length === 1 ? 'recebeu' : 'receberam'} mensagem há menos de ${dias} dias (ou não quer${bloqueados.length === 1 ? '' : 'em'} mensagens).`);
      document.body.append(t); setTimeout(() => t.remove(), 6000);
    }
    // fila: próximo pendente
    const pend = r.lista.filter((x) => x.st === 'p');
    const atual = pend[0];
    // limite por dia: conta os envios de hoje desta campanha (todas as listas)
    const hojeIso = new Date().toLocaleDateString('sv-SE');
    const limiteDia = camp.limiteDia != null ? camp.limiteDia : 20;
    const enviadosHoje = camp.rodadas.reduce((n, rr) => n + rr.lista.filter((x) => x.st === 'e' && x.em && new Date(x.em).toLocaleDateString('sv-SE') === hojeIso).length, 0);
    const noLimite = limiteDia > 0 && enviadosHoje >= limiteDia;
    // variações: rodízio pela quantidade já enviada (cada uma recebe mais ou menos o mesmo número)
    const textos = [camp.mensagem, ...(camp.variacoes || [])];
    const varAtual = r.lista.filter((x) => x.st === 'e').length % textos.length;
    const contaHoje = limiteDia > 0 ? h('span', { class: 'cp-hoje' + (noLimite ? ' fim' : '') }, `Hoje: ${fmt.int(enviadosHoje)} de ${fmt.int(limiteDia)}`) : null;
    let fila;
    if (atual && noLimite) {
      fila = TS.card('Fila de envio', `${fmt.int(pend.length)} pendentes`, h('div', { class: 'cp-fim' }, contaHoje, h('b', null, ' Limite de hoje atingido.'), ` A fila continua amanhã. Dá para mudar o limite em "Editar campanha".`));
    } else if (atual) {
      const c = clienteDe(atual.cpf);
      const txt = A().texto(textos[varAtual], c, extras(camp));
      const ct = A().contatoDe(c);
      const enviar = h('a', { class: 'btn primary cp-enviar', href: c.wpp ? A().linkWpp(c, txt) : '#', target: '_blank', rel: 'noopener' }, 'Abrir no WhatsApp e ir para o próximo ›');
      enviar.addEventListener('click', async (e) => {
        if (!c.wpp || TS.demo) e.preventDefault();
        enviar.classList.add('carregando');
        try { await marcarSt(atual, 'e', null, textos.length > 1 ? varAtual : null); if (!TS.demo) await A().marcar(c, 'contatado', 'Campanha: ' + camp.nome.slice(0, 28)).catch(() => {}); } catch (err) { alert(err.message); }
        repintar();
      });
      fila = TS.card('Fila de envio', `${fmt.int(pend.length)} pendentes${textos.length > 1 ? ` · variação ${varAtual + 1} de ${textos.length}` : ''} · com o WhatsApp da loja aberto neste computador, clique, confira e aperte Enter no WhatsApp`, contaHoje,
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
        { key: 'st', label: 'Situação', align: 'l', render: (x) => h('span', { class: 'cp-st ' + ST[x.st][1] }, ST[x.st][0], x.em != null ? h('small', null, ` ${d(x.em)}${x.por ? ' · ' + x.por : ''}`) : null, x.it.motivo ? h('small', { class: 'cp-motivo' }, x.it.motivo) : null), sortVal: (x) => ({ e: 3, x: 2, o: 1, p: 0 })[x.st] },
        { key: 'voltou', label: `Voltou em ${camp.janela} dias`, align: 'l', render: (x) => (!x.ret ? '—' : x.ret.voltou ? h('span', { class: 'cp-st ok' }, `Sim · ${d(x.ret.primeira)} · ${fmt.brl0(x.ret.vt)}`) : x.ret.aberto ? h('span', { class: 'muted' }, 'ainda no prazo') : h('span', { class: 'muted' }, 'não')) },
        { key: 'acao', label: '', align: 'l', render: (x) => (x.st !== 'p' ? h('button', { type: 'button', class: 'link-btn', onclick: async (e) => { e.stopPropagation(); await marcarSt(x.it, 'p', x.it.motivo ? 'liberado' : null).catch((er) => alert(er.message)); repintar(); } }, 'voltar para a fila') : null), sortVal: () => 0 },
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
        (TS.lojas || []).length > 1 && !TS.demo ? h('button', { type: 'button', class: 'btn', onclick: () => copiarPara(camp) }, 'Copiar para outra loja') : null,
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
      textos.length > 1 ? h('div', { class: 'mt' }, cartaoVariacoes(r, camp, textos)) : null,
      h('div', { class: 'mt' }, TS.cardWithTools('Clientes da campanha', 'Enviadas ficam em verde · clique num cliente para ver a ficha', h('div', { class: 'cp-acoes', style: { margin: 0 } }, tab.searchBox, csvBt), tab)));
  }

})();
