/* Estoque → ⭐ Sugestões: a equipe marca com uma estrela o produto que quer no próximo pedido.
   Não muda a conta do pedido sugerido: quem faz o pedido revisa (Estoque → Pedido) e decide. A resposta volta para cá.
   Todos os perfis da loja usam. A vendedora vê só nome e situação do produto (tem / pouco / acabou), nunca quantidade nem custo.
   Na apresentação as mudanças ficam só no navegador. */
(function () {
  const { h, state } = TS;
  const SIT = { tem: ['Tem na loja', 'ok'], pouco: ['Pouco na loja', 'warn'], acabou: ['Acabou', 'erro'] };
  const RES = { entrou: ['✅ Entrou no pedido', 'pos'], nao: ['❌ Não entrou', 'neg'], semsite: ['🚫 Sem estoque no site', 'warn-t'] };
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
    const porCod = new Map(itens.map((x) => [String(x.cod), x])), em = new Date().toISOString(), n = { entrou: 0, semsite: 0, nao: 0 };
    for (const s of DEMO.d.itens) {
      if (s.st !== 'aberta') continue;
      const x = porCod.get(s.cod);
      let hh;
      if (x && x.pedir > 0 && (x.site === 'ok' || x.site === 'sem')) { hh = { em, res: 'entrou', motivo: '' }; s.st = 'atendida'; s.fimEm = em; }
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
    const abertas = d.itens.filter((s) => s.st === 'aberta'), encerradas = d.itens.filter((s) => s.st !== 'aberta');
    const novos = d.itens.filter((s) => s.novo);
    const aba = state.sugAba === 'encerradas' ? 'encerradas' : 'abertas';
    const lista = aba === 'abertas' ? abertas : encerradas;
    corpo.replaceChildren(...[
      novos.length ? h('div', { class: 'notice ok sug-novos' }, `🔔 ${novos.length === 1 ? '1 sugestão sua recebeu resposta' : `${novos.length} sugestões suas receberam resposta`}: veja abaixo.`) : null,
      cartaoNova(loja, d, (s) => { d.itens.unshift(s); state.sugAba = 'abertas'; repintar(); }),
      h('div', { class: 'card mt' },
        h('div', { class: 'card-title' }, d.todos ? 'Sugestões da equipe' : 'Minhas sugestões'),
        d.todos ? h('p', { class: 'muted' }, 'A decisão é tomada em ', h('a', { href: '#pedido' }, 'Estoque → Pedido'), ', no quadro "⭐ Sugestões da equipe". O pedido sugerido não muda sozinho por causa da estrela.') : null,
        TS.seg([[`Esperando o pedido (${abertas.length})`, 'abertas'], [`Encerradas (${encerradas.length})`, 'encerradas']], aba, (v) => { state.sugAba = v; repintar(); }),
        lista.length ? h('div', { class: 'sug-lista' }, lista.map((s) => cartaoSug(loja, d, s, repintar)))
          : h('p', { class: 'muted' }, aba === 'abertas' ? 'Nenhuma sugestão esperando o pedido.' : 'Nenhuma sugestão encerrada ainda.')),
    ].filter(Boolean));
    if (novos.length && !TS.demo) enviar('POST', `/api/sugestoes/visto?${q(loja)}`).catch(() => {});
    if (novos.length) for (const s of novos) s.novo = false;
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

  function cartaoSug(loja, d, s, repintar) {
    const [t, c] = SIT[s.situacao] || ['', ''];
    const ult = s.hist && s.hist.length ? s.hist[s.hist.length - 1] : null;
    const meu = !d.todos || s.nome === 'Você' || s.por === (TS.eu && TS.eu.usuario);
    const status = s.st === 'atendida' ? h('span', { class: 'pos' }, `✅ Entrou no pedido de ${dataTxt(s.fimEm)}`)
      : s.st === 'retirada' ? h('span', { class: 'muted' }, `Estrela tirada em ${dataTxt(s.fimEm)}`)
        : ult ? h('span', { class: RES[ult.res][1] }, `${RES[ult.res][0]} no pedido de ${dataTxt(ult.em)}${ult.motivo && ult.res !== 'semsite' ? `: ${ult.motivo}` : ''} · continua marcada para o próximo`)
          : h('span', { class: 'muted' }, '🕓 Aguardando o próximo pedido');
    const tirar = s.st === 'aberta' && (meu || d.todos) ? h('button', { type: 'button', class: 'btn ghost-danger sug-tirar', onclick: async (ev) => {
      if (!confirm(`Tirar a estrela de ${s.desc}?`)) return;
      ev.target.disabled = true;
      try { Object.assign(s, await retirar(loja, s.id)); repintar(); } catch (e) { alert(e.message); ev.target.disabled = false; }
    } }, 'Tirar estrela') : null;
    return h('div', { class: 'sug-item' + (s.novo ? ' novo' : '') },
      h('div', { class: 'sug-item-cab' }, h('b', null, (s.st === 'aberta' ? '⭐ ' : '') + s.desc), ' ', h('span', { class: 'badge ' + c, title: 'Situação na loja quando foi marcado' }, t), s.novo ? h('span', { class: 'badge warn' }, 'novo') : null),
      h('div', { class: 'sug-item-meta muted' }, `marcado em ${dataTxt(s.em)}`, d.todos && s.nome ? ` por ${s.nome}` : '', s.st === 'aberta' && s.equipe > 1 ? ` · ${s.equipe} pessoas da equipe pediram` : ''),
      s.justificativa ? h('div', { class: 'sug-item-txt' }, h('small', null, 'Por que pedir: '), s.justificativa) : null,
      s.recado ? h('div', { class: 'sug-item-txt' }, h('small', null, 'Recado: '), s.recado) : null,
      h('div', { class: 'sug-item-st' }, status),
      s.hist && s.hist.length > 1 ? h('details', { class: 'sug-hist' }, h('summary', null, `Histórico (${s.hist.length} pedidos)`),
        h('ul', null, s.hist.map((x) => h('li', null, `${dataTxt(x.em)} · ${RES[x.res][0]}${x.motivo && x.res !== 'semsite' ? ` — ${x.motivo}` : ''}`)))) : null,
      tirar);
  }
})();
