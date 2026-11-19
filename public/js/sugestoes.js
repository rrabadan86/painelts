/* Estoque → ⭐ Sugestões: a equipe marca com uma estrela o produto que quer no próximo pedido.
   Não muda a conta do pedido sugerido: quem faz o pedido revisa (Estoque → Pedido) e decide. A resposta volta para cá.
   Todos os perfis da loja usam. A vendedora vê só nome e situação do produto (tem / pouco / acabou), nunca quantidade nem custo.
   Na apresentação as mudanças ficam só no navegador. */
(function () {
  const { h, state } = TS;
  const SIT = { tem: ['Tem na loja', 'ok'], pouco: ['Pouco na loja', 'warn'], acabou: ['Acabou', 'erro'] };
  const RES = {
    pedido: ['🛒 Foi no pedido', 'muted'], chegou: ['✅ Chegou na loja', 'pos'], entrou: ['✅ Entrou no pedido', 'pos'],
    nao: ['❌ Não entrou no pedido', 'neg'], semsite: ['🚫 Sem estoque no site', 'warn-t'], naopediu: ['🚫 Não foi possível pedir', 'warn-t'], naoveio: ['⚠️ Não veio no pedido', 'neg'],
  };
  const MOTIVOS = ['Ainda temos estoque', 'Vende pouco', 'Fica para o próximo pedido', 'Passou do valor do pedido'];
  const dataTxt = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—');
  const DEMO = { loja: null, d: null };

  async function getJson(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não deu certo.');
    return j;
  }
  async function enviar(metodo, url, corpo) {
    const r = await fetch(url, { method: metodo, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify(corpo || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não deu certo.');
    return j;
  }
  const q = (loja) => `loja=${encodeURIComponent(loja)}`;

  async function carregar(loja) {
    if (!TS.demo) return getJson(`/api/sugestoes?${q(loja)}`);
    if (DEMO.loja !== loja) { DEMO.d = await getJson(TS.api(`sugestoes?${q(loja)}`)); DEMO.loja = loja; }
    return { ...DEMO.d, itens: [...DEMO.d.itens] };
  }
  async function produtos(loja, termo) {
    return (await getJson(TS.api(`sugestoes/produtos?${q(loja)}&q=${encodeURIComponent(termo)}`))).produtos || [];
  }
  async function criar(loja, prod, recado, justificativa) {
    if (!TS.demo) return (await enviar('POST', `/api/sugestoes?${q(loja)}`, { cod: prod.cod, recado, justificativa })).sugestao;
    if (DEMO.d.itens.some((s) => s.st === 'aberta' && s.cod === prod.cod && s.por === 'apresentacao')) throw new Error('Você já marcou este produto: ele está esperando o próximo pedido.');
    if (prod.justificar && String(justificativa || '').trim().length < 5) throw new Error('Este produto ainda tem na loja: conte por que pedir mais (ex.: "cliente leva sempre 3").');
    const s = { id: 'dn' + Date.now(), cod: prod.cod, desc: prod.desc, un: prod.un, por: 'apresentacao', nome: 'Você', em: new Date().toISOString(), recado: recado || '', justificativa: prod.justificar ? justificativa : '', situacao: prod.situacao, st: 'aberta', hist: [], decisao: null };
    DEMO.d.itens.unshift(s);
    return s;
  }
  async function retirar(loja, id) {
    if (!TS.demo) return (await enviar('POST', `/api/sugestoes/${encodeURIComponent(id)}/retirar?${q(loja)}`)).sugestao;
    const s = DEMO.d.itens.find((x) => x.id === id); Object.assign(s, { st: 'retirada', fimEm: new Date().toISOString() }); return s;
  }
  /** "Não agora" com motivo (res 'nao') ou desfazer (res null) — no Pedido */
  async function decidir(loja, cod, res, motivo) {
    if (!TS.demo) return (await enviar('PUT', `/api/pedido/sugestoes/decisao?${q(loja)}`, { cod, res, motivo })).decisao;
    await carregar(loja);
    const dec = res === 'nao' ? { res: 'nao', motivo: motivo || 'Não entrou desta vez', por: 'apresentacao', em: new Date().toISOString() } : null;
    for (const s of DEMO.d.itens) if (s.st === 'aberta' && s.cod === String(cod)) s.decisao = dec;
    return dec;
  }
  /** registra o pedido: itens [{ cod, pedir, site }] — entrou / sem estoque no site / não entrou (continua para o próximo) */
  async function fechar(loja, itens) {
    if (!TS.demo) return enviar('POST', `/api/pedido/sugestoes/fechar?${q(loja)}`, { itens });
    await carregar(loja);
    const porCod = new Map(), em = new Date().toISOString(), n = { pedido: 0, semsite: 0, nao: 0 };
    for (const x of itens) { const vai = x.pedir > 0 && ['ok', 'sem', 'obrig'].includes(x.site), a = porCod.get(String(x.cod)); if (!a) porCod.set(String(x.cod), { pedir: vai ? x.pedir : 0, site: vai ? 'ok' : x.site }); else if (vai) { a.pedir += x.pedir; a.site = 'ok'; } }
    for (const s of DEMO.d.itens) {
      if (s.st !== 'aberta' || s.aguardando) continue;
      const x = porCod.get(s.cod);
      let hh;
      if (x && x.pedir > 0 && (x.site === 'ok' || x.site === 'sem')) { hh = { em, res: 'pedido', motivo: '' }; s.aguardando = { em, qtd: x.pedir }; }
      else if (x && (x.site === 'indisp' || x.site === 'fora')) hh = { em, res: 'semsite', motivo: 'Sem estoque no site da franquia (automático)' };
      else hh = { em, res: 'nao', motivo: (s.decisao && s.decisao.motivo) || 'Não entrou desta vez' };
      (s.hist = s.hist || []).push(hh); s.decisao = null; n[hh.res]++;
    }
    return { ok: true, ...n };
  }
  /** as abertas agrupadas por produto (a mesma conta do servidor, para a apresentação) */
  function agrupar(itens) {
    const m = new Map();
    for (const s of itens) {
      if (s.st !== 'aberta') continue;
      const g = m.get(s.cod) || m.set(s.cod, { cod: s.cod, desc: s.desc, un: s.un, pessoas: [], notas: [], desde: s.em, pedidos: 0, decisao: null }).get(s.cod);
      g.pessoas.push(s.nome || s.por);
      g.notas.push({ nome: s.nome || s.por, recado: s.recado, justificativa: s.justificativa, situacao: s.situacao, em: s.em });
      if (s.em < g.desde) g.desde = s.em;
      g.pedidos = Math.max(g.pedidos, (s.hist || []).length);
      if (s.decisao) g.decisao = s.decisao;
      if (s.aguardando) g.aguardando = s.aguardando;
    }
    return [...m.values()].sort((a, b) => b.pessoas.length - a.pessoas.length || a.desde.localeCompare(b.desde));
  }
  /** para o Pedido: as abertas agrupadas (servidor manda em p.sugestoes; na apresentação vêm daqui) */
  async function paraPedido(loja, p) { return TS.demo ? agrupar((await carregar(loja)).itens) : (p && p.sugestoes) || []; }
  TS.sug = { carregar, decidir, fechar, paraPedido, agrupar, MOTIVOS, RES, SIT, dataTxt };

  // ---------- tela ----------
  TS.pages.sugestoes = function (root) {
    if (TS.subEstoque) root.append(TS.subEstoque('sugestoes'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, '⭐ Sugestões para o pedido'),
      h('div', { class: 'page-sub' }, 'Marque com uma estrela o produto que você quer no próximo pedido. Quem faz o pedido revisa e decide; a resposta aparece aqui.'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'As sugestões são de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'card' }, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Carregando…')))));
    root.append(corpo);
    const loja = state.loja;
    carregar(loja).then((d) => { if (corpo.isConnected) pintar(corpo, loja, d); }).catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  };

  function pintar(corpo, loja, d) {
    const repintar = () => pintar(corpo, loja, d);
    const ABAS = {
      abertas: ['Esperando o pedido', (s) => s.st === 'aberta' && !s.aguardando],
      entrega: ['Aguardando entrega', (s) => s.st === 'aberta' && !!s.aguardando],
      encerradas: ['Encerradas', (s) => s.st !== 'aberta'],
    };
    const novos = d.itens.filter((s) => s.novo);
    const aba = ABAS[state.sugAba] ? state.sugAba : 'abertas';
    const lista = d.itens.filter(ABAS[aba][1]);
    corpo.replaceChildren(...[
      novos.length ? h('div', { class: 'notice ok sug-novos' }, `🔔 ${novos.length === 1 ? '1 sugestão sua recebeu resposta' : `${novos.length} sugestões suas receberam resposta`}: veja abaixo (em destaque).`) : null,
      cartaoNova(loja, d, (x) => { d.itens.unshift(x); state.sugAba = 'abertas'; repintar(); }),
      h('div', { class: 'card mt' },
        h('div', { class: 'card-title' }, d.todos ? 'Sugestões da equipe' : 'Minhas sugestões'),
        d.todos ? h('p', { class: 'muted' }, 'A decisão é tomada em ', h('a', { href: '#pedido' }, 'Estoque → Pedido'), ', no quadro "⭐ Sugestões da equipe". O pedido sugerido não muda sozinho por causa da estrela.') : null,
        TS.seg(Object.entries(ABAS).map(([k, [t, f]]) => [`${t} (${d.itens.filter(f).length})`, k]), aba, (v) => { state.sugAba = v; repintar(); }),
        tabela(loja, d, lista, aba, repintar)),
    ].filter(Boolean));
    if (novos.length && !TS.demo) enviar('POST', `/api/sugestoes/visto?${q(loja)}`).catch(() => {});
    if (novos.length) for (const x of novos) x.novo = false;
  }

  const R = (x) => RES[x.res] || ['', 'muted'];
  const ultimo = (s) => (s.hist && s.hist.length ? s.hist[s.hist.length - 1] : null);
  /** andamento da sugestão: aguardando, no pedido (aguardando entrega), chegou, não veio… */
  function statusDe(s) {
    const ult = ultimo(s);
    if (s.st === 'atendida') return s.chegou ? h('span', { class: 'pos' }, `✅ Chegou na loja: NF ${s.chegou.nf} de ${TS.fmt.date(s.chegou.dia).slice(0, 5)}`) : h('span', { class: 'pos' }, `✅ Entrou no pedido de ${dataTxt(s.fimEm)}`);
    if (s.st === 'retirada') return h('span', { class: 'muted' }, `Estrela tirada em ${dataTxt(s.fimEm)}`);
    if (s.aguardando) return h('span', { class: 'sug-aguarda' }, `🛒 No pedido de ${dataTxt(s.aguardando.em)}: aguardando entrega`, TS.dica('A estrela sai quando a nota da TSB Franquias chegar com o produto (não importa quanto demore). Se a primeira nota chegar sem ele, o painel espera mais 5 dias por outra nota; sem o produto, a sugestão volta para o próximo pedido — e, se ele chegar depois, a estrela sai do mesmo jeito.'));
    if (ult) return h('span', { class: R(ult)[1] }, `${R(ult)[0]} · ${dataTxt(ult.em)}`, ult.motivo && ult.res !== 'semsite' ? h('small', { class: 'muted sug-motivo' }, ult.motivo) : null, h('small', { class: 'muted sug-motivo' }, 'continua marcada para o próximo pedido'));
    return h('span', { class: 'muted' }, '🕓 Aguardando o próximo pedido');
  }
  function tabela(loja, d, lista, aba, repintar) {
    const meu = (s) => !d.todos || s.nome === 'Você' || s.por === (TS.eu && TS.eu.usuario);
    const tirar = (s) => (s.st === 'aberta' && !s.aguardando && (meu(s) || d.todos) ? h('button', { type: 'button', class: 'btn ghost-danger sug-tirar', onclick: async (ev) => {
      ev.stopPropagation();
      if (!confirm(`Tirar a estrela de ${s.desc}?`)) return;
      ev.target.disabled = true;
      try { Object.assign(s, await retirar(loja, s.id)); repintar(); } catch (e) { alert(e.message); ev.target.disabled = false; }
    } }, 'Tirar estrela') : null);
    const cols = [
      { key: 'desc', label: 'Produto', align: 'l', sticky: true, wrap: true, title: 'A etiqueta é a situação na loja quando o produto foi marcado: tem, pouco (chá abaixo de 700 g) ou acabou.',
        render: (s) => { const [t, c] = SIT[s.situacao] || ['', '']; return h('div', { class: 'sug-prod-cel' }, h('b', null, (s.st === 'aberta' ? '⭐ ' : '') + s.desc), ' ', t ? h('span', { class: 'badge ' + c }, t) : null, s.novo ? h('span', { class: 'badge warn' }, 'novo') : null,
          s.st === 'aberta' && s.equipe > 1 ? h('small', { class: 'muted sug-motivo' }, `${s.equipe} pessoas da equipe pediram`) : null); } },
      d.todos ? { key: 'nome', label: 'Quem', align: 'l' } : null,
      { key: 'em', label: 'Marcado em', render: (s) => dataTxt(s.em), sortVal: (s) => s.em },
      { key: 'motivo', label: 'Por que / recado', align: 'l', wrap: true, title: 'Por que pedir (obrigatório quando ainda tinha na loja) e o recado para quem faz o pedido.',
        render: (s) => (s.justificativa || s.recado ? h('div', { class: 'sug-txt' }, s.justificativa ? h('div', null, s.justificativa) : null, s.recado ? h('div', { class: 'muted' }, s.recado) : null) : h('span', { class: 'muted' }, '—')),
        sortVal: (s) => s.justificativa || s.recado || '' },
      { key: 'andamento', label: 'Andamento', align: 'l', wrap: true, title: 'O que aconteceu nos pedidos: no pedido (aguardando entrega), chegou na loja pela nota da franquia, não veio na entrega, não entrou (com o motivo) ou sem estoque no site.',
        render: (s) => h('div', null, statusDe(s), s.hist && s.hist.length > 1 ? h('details', { class: 'sug-hist' }, h('summary', null, `Histórico (${s.hist.length})`),
          h('ul', null, s.hist.map((x) => h('li', null, `${dataTxt(x.em)} · ${R(x)[0]}${x.motivo && x.res !== 'semsite' ? ` — ${x.motivo}` : ''}`)))) : null),
        sortVal: (s) => (ultimo(s) || {}).em || s.em },
      { key: 'acoes', label: '', align: 'l', render: tirar, sortVal: () => 0 },
    ].filter(Boolean);
    return TS.table({
      cols, rows: lista, sortKey: 'em', sortDir: 'desc', maxHeight: '620px', search: 'Buscar produto, pessoa ou recado…', searchKeys: ['desc', 'cod', 'nome', 'recado', 'justificativa'], produto: 'desc', cls: 'est-t sug-t',
      rowClass: (s) => (s.novo ? 'sug-novo' : null),
      empty: { abertas: 'Nenhuma sugestão esperando o pedido.', entrega: 'Nada aguardando entrega.', encerradas: 'Nenhuma sugestão encerrada ainda.' }[aba],
    });
  }

  function cartaoNova(loja, d, aoCriar) {
    const busca = h('input', { class: 'f-input sug-busca', type: 'search', placeholder: 'Buscar produto (nome ou código)…', autocomplete: 'off' });
    const res = h('div', { class: 'sug-res' });
    const msg = h('div', { class: 'muted' });
    let seq = 0;
    const procurar = TS.debounce(async () => {
      const t = busca.value.trim();
      const meu = ++seq;
      if (t.length < 2) { res.replaceChildren(); return; }
      try {
        const ps = await produtos(loja, t);
        if (meu !== seq) return;
        res.replaceChildren(...(ps.length ? ps.map((p) => linhaProduto(p)) : [h('p', { class: 'muted' }, 'Nenhum produto com esse nome no estoque da loja.')]));
      } catch (e) { res.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
    }, 250);
    busca.addEventListener('input', procurar);
    const jaMarcou = (cod) => d.itens.some((s) => s.st === 'aberta' && s.cod === cod && (s.nome === 'Você' || !d.todos || s.por === (TS.eu && TS.eu.usuario)));
    function linhaProduto(p) {
      const [t, c] = SIT[p.situacao] || ['', ''];
      const box = h('div', { class: 'sug-prod' });
      const abrir = () => {
        const recado = h('textarea', { class: 'f-input', rows: 2, maxlength: 300, placeholder: 'Recado para quem faz o pedido (opcional): ex. "cliente pergunta toda semana"' });
        const just = p.justificar ? h('textarea', { class: 'f-input sug-just', rows: 2, maxlength: 300, placeholder: 'Ainda tem na loja: por que pedir mais? (obrigatório)' }) : null;
        const err = h('div', { class: 'neg' });
        const ok = h('button', { type: 'button', class: 'btn primary' }, '⭐ Confirmar sugestão');
        ok.addEventListener('click', async () => {
          ok.disabled = true; err.textContent = '';
          try { const s = await criar(loja, p, recado.value.trim(), just ? just.value.trim() : ''); busca.value = ''; res.replaceChildren(); msg.className = 'pos'; msg.textContent = `⭐ ${p.desc} marcado para o próximo pedido.`; aoCriar(s); }
          catch (e) { err.textContent = e.message; ok.disabled = false; }
        });
        box.replaceChildren(cab(true), h('div', { class: 'sug-form' },
          p.justificar ? h('p', { class: 'warn-t sug-aviso' }, 'Este produto ainda tem na loja. Para sugerir, conte o motivo.') : null,
          just, recado, err, h('div', { class: 'cfg-acoes' }, ok, h('button', { type: 'button', class: 'btn', onclick: () => box.replaceChildren(cab(false)) }, 'Cancelar'))));
        (just || recado).focus();
      };
      const cab = (aberto) => h('div', { class: 'sug-prod-cab' },
        h('div', null, h('b', null, p.desc), ' ', h('span', { class: 'badge ' + c }, t)),
        jaMarcou(p.cod) ? h('span', { class: 'muted' }, '⭐ já marcado') : aberto ? null : h('button', { type: 'button', class: 'btn sug-marcar', onclick: abrir }, '☆ Sugerir'));
      box.append(cab(false));
      return box;
    }
    return h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Sugerir um produto'),
      h('p', { class: 'muted' }, 'Busque o produto e toque em ☆ Sugerir. Se ainda tiver na loja, conte por que pedir mais (chá a granel com menos de 700 g não precisa).'),
      busca, res, msg);
  }

})();
