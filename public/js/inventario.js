/* Estoque → Inventário: contar o estoque pelo celular ou computador e gerar a planilha de inventário do AppNext.
   1) Nova contagem: alguns produtos, um grupo, um tipo de chá (Rooibos, Chá verde…) ou todos os chás a granel.
   2) Contar: cada item com o campo grande (chá a granel em gramas), salva sozinho; leitor de código de barras no Android.
   3) Revisar: sistema × contado, diferença em quantidade e em R$.
   4) Planilha: o modelo do AppNext só com os itens contados → AppNext: Estoque → Auditoria/Inventário → Novo → Por Excel.
   Contagem cega: quem conta não vê a quantidade do sistema (a vendedora sempre conta às cegas). */
(function () {
  const { h, fmt, state } = TS;
  const ST = { contando: ['Contando', 'inv-st-cont'], revisao: ['Para revisar', 'inv-st-rev'], gerado: ['Planilha gerada', 'inv-st-ger'], importado: ['Importado no AppNext', 'inv-st-ok'], cancelado: ['Cancelada', 'inv-st-canc'], revertido: ['Desfeita', 'inv-st-canc'] };
  const ehKg = (un) => String(un || '').toLowerCase() === 'kg';
  const qtdTxt = (v, un) => (v == null ? '—' : ehKg(un) ? (v < 1 ? `${fmt.int(Math.round(v * 1000))} g` : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg`) : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${String(un || 'un').toLowerCase()}`);
  const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const troca = (el, ...xs) => el.replaceChildren(...xs.filter((x) => x != null && x !== false)); // sem "null" na tela
  const toast = (msg, erro) => { const t = h('div', { class: 'toast' + (erro ? ' err' : '') }, msg); document.body.append(t); setTimeout(() => t.remove(), erro ? 6000 : 3000); };

  // ---------- dados: servidor ou, na apresentação, só no navegador ----------
  const DEMO = { cat: null, cont: [] };
  async function req(metodo, url, corpo) {
    const r = await fetch(TS.api(url), { method: metodo, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não deu certo.');
    return j;
  }
  async function demoCat(loja) { if (!DEMO.cat) DEMO.cat = (await req('GET', `inventario/catalogo?loja=${encodeURIComponent(loja)}`)).itens; return DEMO.cat; }
  const familia = (t) => { const s = String(t || '').toUpperCase().replace(/\s+(AROMATIZADO|PURO)$/, '').trim(); return s ? s[0] + s.slice(1).toLowerCase().replace(/\bchá\b/gi, 'Chá') : ''; };
  const escolheDemo = (cat, b) => { const cods = new Set(b.cods || []), f = b.filtro || {}; return cat.filter((i) => cods.has(i.cod) || (f.grupo && i.grupo === f.grupo && (!f.sub || i.sub === f.sub)) || (f.tipo && i.tipo === f.tipo) || (f.familia && familia(i.tipo) === f.familia) || (f.tudoKg && ehKg(i.un) && i.tipo)); };
  const API = {
    async resumo(loja) {
      if (!TS.demo) return req('GET', `inventario?loja=${encodeURIComponent(loja)}`);
      const cat = await demoCat(loja), conta = (k) => { const m = new Map(); for (const i of cat) if (i[k]) m.set(i[k], (m.get(i[k]) || 0) + 1); return [...m]; };
      const fams = new Map(); for (const i of cat) { const f = familia(i.tipo); if (f) fams.set(f, (fams.get(f) || 0) + 1); }
      return { contagens: DEMO.cont.map((c) => ({ ...c, itens: c.itens.length, contados: c.itens.filter((i) => i.cont != null).length })), perfil: 'admin', grupos: conta('grupo'), subs: [], tipos: conta('tipo'), familias: [...fams], kg: cat.filter((i) => ehKg(i.un) && i.tipo).length };
    },
    async buscar(loja, q) {
      if (!TS.demo) return (await req('GET', `inventario/itens?loja=${encodeURIComponent(loja)}&q=${encodeURIComponent(q)}`)).itens;
      const qn = TS.norm(q); return (await demoCat(loja)).filter((i) => TS.norm(i.desc).includes(qn) || i.cod.startsWith(q)).slice(0, 15);
    },
    async previa(loja, b) { if (!TS.demo) return (await req('POST', 'inventario/previa', { loja, ...b })).itens; return escolheDemo(await demoCat(loja), b).length; },
    async criar(loja, b) {
      if (!TS.demo) return (await req('POST', 'inventario', { loja, ...b })).id;
      const itens = escolheDemo(await demoCat(loja), b);
      if (!itens.length) throw new Error('Escolha pelo menos um item para contar.');
      const c = { id: 'demo' + Date.now().toString(16).slice(-8), nome: b.nome || 'Contagem', criadoEm: new Date().toISOString(), por: 'apresentacao', cega: !!b.cega, st: 'contando', zerar: { ativo: !!b.zerarResto, semGrupos: null }, itens: itens.map((i) => ({ ...i, sis: i.qtd, cont: null })) };
      DEMO.cont.unshift(c); return c.id;
    },
    async abrir(loja, id) {
      if (!TS.demo) return req('GET', `inventario/contagem?loja=${encodeURIComponent(loja)}&id=${id}`);
      const c = DEMO.cont.find((x) => x.id === id), na = new Set(c.itens.map((i) => i.cod));
      const resto = (await demoCat(loja)).filter((i) => !na.has(i.cod) && Math.abs(i.qtd || 0) > 0.0005).map((i) => ({ cod: i.cod, desc: i.desc, un: i.un, grupo: i.grupo, qtd: i.qtd, custo: i.custo }));
      return { ...c, podeRevisar: true, agora: null, resto, restoFora: (c.zerar && c.zerar.semGrupos) || [] };
    },
    async enviar(loja, id, tipo) { if (TS.demo) throw new Error('Na apresentação nada é enviado ao AppNext.'); return req('POST', `inventario/contagem/${id}/enviar`, { loja, tipo }); },
    async zerar(loja, id, z) { if (!TS.demo) return req('PUT', `inventario/contagem/${id}/zerar`, { loja, ...z }); DEMO.cont.find((x) => x.id === id).zerar = z; },
    async contar(loja, id, cod, cont, lotes) {
      if (!TS.demo) return (await req('PUT', `inventario/contagem/${id}/item/${encodeURIComponent(cod)}`, { loja, cont, ...(lotes ? { lotes } : {}) })).item;
      const it = DEMO.cont.find((x) => x.id === id).itens.find((i) => i.cod === cod); Object.assign(it, { cont, lotes: lotes || undefined, por: 'apresentacao', em: cont == null ? null : new Date().toISOString() }); return it;
    },
    async incluir(loja, id, cods) {
      if (!TS.demo) return req('POST', `inventario/contagem/${id}/itens`, { loja, cods });
      const c = DEMO.cont.find((x) => x.id === id), tem = new Set(c.itens.map((i) => i.cod));
      for (const i of escolheDemo(await demoCat(loja), { cods })) if (!tem.has(i.cod)) c.itens.push({ ...i, sis: i.qtd, cont: null });
    },
    async acao(loja, id, a) {
      if (!TS.demo) return req('POST', `inventario/contagem/${id}/${a}`, { loja });
      const c = DEMO.cont.find((x) => x.id === id);
      c.st = { revisar: 'revisao', reabrir: 'contando', importado: 'importado', cancelar: 'cancelado' }[a] || c.st;
    },
  };

  TS.pages.inventario = function (root) {
    if (TS.subEstoque) root.append(TS.subEstoque('inventario'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Inventário'),
      h('div', { class: 'page-sub' }, 'Conte o estoque pelo celular ou pelo computador (um item, um grupo ou um tipo de chá) e envie direto para o AppNext.'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'O inventário é de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'card' }, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Carregando…')))));
    root.append(corpo);
    const loja = state.loja;
    if (state.invId) abrirContagem(corpo, loja, state.invId);
    else telaLista(corpo, loja);
  };

  // ---------- lista de contagens + nova ----------
  async function telaLista(corpo, loja) {
    let d;
    try { d = await API.resumo(loja); } catch (e) { troca(corpo, h('div', { class: 'notice err' }, e.message)); return; }
    if (!corpo.isConnected) return;
    const vend = TS.eu && TS.eu.perfil === 'vendedor';
    const abertas = d.contagens.filter((c) => c.st === 'contando' || c.st === 'revisao' || c.st === 'gerado');
    const antigas = d.contagens.filter((c) => !abertas.includes(c)).slice(0, 50);
    const linha = (c) => {
      const [t, cls] = ST[c.st];
      const pct = c.itens ? c.contados / c.itens : 0;
      return h('button', { type: 'button', class: 'inv-linha', onclick: () => { state.invId = c.id; TS.render(); } },
        h('div', { class: 'inv-linha-top' }, h('b', null, c.nome), h('span', { class: 'inv-st ' + cls }, t)),
        h('div', { class: 'inv-barra' }, h('i', { style: { width: Math.round(pct * 100) + '%' } })),
        h('small', { class: 'muted' }, `${fmt.int(c.contados)} de ${fmt.int(c.itens)} contados · aberta ${quando(c.criadoEm)} por ${c.por || '—'}${c.cega ? ' · cega' : ''}${c.zerar ? ' · zera os não listados' : ''}`),
        c.importadoEm ? h('small', { class: 'muted' }, `Importado ${quando(c.importadoEm)}${c.importadoPor ? ' por ' + c.importadoPor : ''} · ${fmt.int(c.naPlanilha || 0)} produtos${c.zerados ? ` (${fmt.int(c.zerados)} zerados)` : ''} · ajuste ${fmt.brl(c.ajuste || 0)}${c.revertidoEm ? ' · desfeito ' + quando(c.revertidoEm) : ''}`) : null);
    };
    const novaBox = h('div');
    const btnNova = h('button', { type: 'button', class: 'btn primary inv-nova-btn', onclick: () => { btnNova.hidden = true; novaBox.replaceChildren(formNova(loja, d, () => { btnNova.hidden = false; novaBox.replaceChildren(); })); } }, '+ Nova contagem');
    troca(corpo, 
      h('div', { class: 'inv-topo' }, btnNova, h('small', { class: 'muted' }, d.estoqueEm ? `Estoque do painel de ${quando(d.estoqueEm)}.` : '')),
      novaBox,
      h('div', { class: 'card mt' }, h('div', { class: 'card-title' }, 'Em andamento'), abertas.length ? h('div', { class: 'inv-lista' }, ...abertas.map(linha)) : TS.empty('Nenhuma contagem aberta. Comece com "Nova contagem".')),
      antigas.length ? h('div', { class: 'card mt inv-antigas' }, h('div', { class: 'card-title' }, `Histórico (${antigas.length})`), h('div', { class: 'card-sub' }, 'Contagens importadas, desfeitas ou canceladas. Abra uma para ver o que foi para o AppNext ou desfazer.'), h('div', { class: 'inv-lista' }, ...antigas.map(linha))) : null,
      vend ? null : h('div', { class: 'card mt inv-como' }, h('div', { class: 'card-title' }, 'Como funciona'),
        h('ol', null,
          h('li', null, 'Abra uma contagem: alguns produtos, um grupo, um tipo de chá ou todos os chás a granel. Itens fora dela não mudam no AppNext.'),
          h('li', null, 'Contem pelo celular (várias pessoas ao mesmo tempo). Chá a granel em gramas; o resto em unidades. Salva sozinho.'),
          h('li', null, 'Revise as diferenças e baixe a planilha. Ela vem só com os itens contados.'),
          h('li', null, 'No AppNext: Estoque → Auditoria/Inventário → ＋ → Por Excel → envie a planilha. Depois marque "Já importei" aqui.'),
          h('li', null, 'Conte com a loja fechada ou gere a planilha logo depois: o que vender entre a contagem e a importação não entra na conta.'))));
  }

  function formNova(loja, d, fechar) {
    const vend = TS.eu && TS.eu.perfil === 'vendedor';
    const f = { modo: 'produtos', cods: [], prod: [], grupo: '', sub: '', familia: '', tipo: '' };
    const nome = h('input', { class: 'f-input', placeholder: 'Nome (opcional): Rooibos, Latas, Contagem de sábado…' });
    const cega = h('input', { type: 'checkbox', checked: vend || null, disabled: vend || null });
    const zerarResto = h('input', { type: 'checkbox' });
    const previa = h('div', { class: 'inv-previa' });
    const corpoModo = h('div', { class: 'inv-modo-corpo' });
    let tPrev;
    const atualizarPrevia = () => { clearTimeout(tPrev); tPrev = setTimeout(async () => {
      const b = corpoB(); if (!b) { previa.textContent = ''; return; }
      try { const n = await API.previa(loja, b); previa.replaceChildren(h('b', null, fmt.int(n)), n === 1 ? ' item para contar' : ' itens para contar'); } catch { previa.textContent = ''; }
    }, 200); };
    const corpoB = () => (f.modo === 'produtos' ? (f.cods.length ? { cods: f.cods } : null) : f.modo === 'grupo' ? (f.grupo ? { filtro: { grupo: f.grupo, sub: f.sub || undefined } } : null)
      : f.modo === 'cha' ? (f.tipo ? { filtro: { tipo: f.tipo } } : f.familia ? { filtro: { familia: f.familia } } : null) : { filtro: { tudoKg: true } });
    const pintarModo = () => {
      if (f.modo === 'produtos') {
        const chips = h('div', { class: 'cp-prod-chips' });
        const pintarChips = () => chips.replaceChildren(...f.prod.map((p) => h('span', { class: 'cp-prod-chip' }, p.desc, h('button', { type: 'button', 'aria-label': 'Tirar', onclick: () => { f.prod = f.prod.filter((x) => x !== p); f.cods = f.prod.map((x) => x.cod); pintarChips(); atualizarPrevia(); } }, '✕'))));
        corpoModo.replaceChildren(chips, buscaItens(loja, (it) => { if (!f.cods.includes(it.cod)) { f.prod.push(it); f.cods = f.prod.map((x) => x.cod); pintarChips(); atualizarPrevia(); } }, 'Nome ou código: valeriana, caneca, 71194…'));
        pintarChips();
      } else if (f.modo === 'grupo') {
        const selG = h('select', { class: 'f-input' }, h('option', { value: '' }, 'Escolha o grupo'), ...d.grupos.map(([g, n]) => h('option', { value: g, selected: f.grupo === g || null }, `${g} (${n})`)));
        const subs = d.subs.filter((x) => x[0] === f.grupo);
        const selS = h('select', { class: 'f-input', disabled: !subs.length || null }, h('option', { value: '' }, subs.length ? 'Todos os subgrupos' : 'Sem subgrupos'), ...subs.map(([, s, n]) => h('option', { value: s, selected: f.sub === s || null }, `${s} (${n})`)));
        selG.addEventListener('change', () => { f.grupo = selG.value; f.sub = ''; pintarModo(); atualizarPrevia(); });
        selS.addEventListener('change', () => { f.sub = selS.value; atualizarPrevia(); });
        corpoModo.replaceChildren(h('div', { class: 'inv-dupla' }, selG, selS));
      } else if (f.modo === 'cha') {
        const selF = h('select', { class: 'f-input' }, h('option', { value: '' }, 'Escolha o tipo de chá'),
          h('optgroup', { label: 'Tipo (puro e aromatizado juntos)' }, ...d.familias.map(([x, n]) => h('option', { value: 'f:' + x, selected: f.familia === x || null }, `${x} (${n})`))),
          h('optgroup', { label: 'Só aromatizado ou só puro' }, ...d.tipos.map(([x, n]) => h('option', { value: 't:' + x, selected: f.tipo === x || null }, `${x[0] + x.slice(1).toLowerCase()} (${n})`))));
        selF.addEventListener('change', () => { const v = selF.value; f.familia = v.startsWith('f:') ? v.slice(2) : ''; f.tipo = v.startsWith('t:') ? v.slice(2) : ''; atualizarPrevia(); });
        troca(corpoModo, selF, d.familias.length ? null : h('small', { class: 'muted' }, 'O tipo de chá vem das vendas dos pacotes; ainda não há vendas suficientes para saber.'));
      } else corpoModo.replaceChildren(h('p', { class: 'muted' }, `Todos os ${fmt.int(d.kg)} chás a granel (kg) que aparecem nas vendas.`));
      atualizarPrevia();
    };
    const modos = TS.seg([['Alguns produtos', 'produtos'], ['Um grupo', 'grupo'], ['Um tipo de chá', 'cha'], ['Todos os chás a granel', 'kg']], f.modo, (v) => { f.modo = v; modos.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); pintarModo(); });
    modos.querySelectorAll('button').forEach((b, i) => { b.dataset.v = ['produtos', 'grupo', 'cha', 'kg'][i]; });
    pintarModo();
    const erro = h('div', { class: 'neg' });
    const comecar = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
      erro.textContent = '';
      const b = corpoB();
      if (!b) { erro.textContent = 'Escolha o que contar.'; return; }
      comecar.disabled = true;
      const nomePadrao = f.modo === 'grupo' ? f.sub || f.grupo : f.modo === 'cha' ? f.familia || f.tipo : f.modo === 'kg' ? 'Chás a granel' : f.prod.length === 1 ? f.prod[0].desc : '';
      try { const id = await API.criar(loja, { ...b, nome: nome.value.trim() || nomePadrao, cega: cega.checked, zerarResto: zerarResto.checked }); state.invId = id; TS.render(); }
      catch (e) { erro.textContent = e.message; comecar.disabled = false; }
    } }, 'Começar a contar');
    return h('div', { class: 'card mt inv-form' }, h('div', { class: 'card-title' }, 'Nova contagem'),
      h('div', { class: 'inv-modos' }, modos), corpoModo, previa,
      h('label', { class: 'esp-campo' }, h('span', { class: 'f-label' }, 'Nome'), nome),
      h('label', { class: 'inv-check' }, cega, h('span', null, h('b', null, 'Contagem cega'), ' — quem conta não vê a quantidade do sistema (conta sem se influenciar).', vend ? ' Para vendedoras é sempre cega.' : '')),
      vend ? null : h('label', { class: 'inv-check' }, zerarResto, h('span', null, h('b', null, 'Zerar os produtos que não estão nesta contagem'), ' — o que não for listado aqui fica 0 no AppNext. Na revisão você vê a lista e escolhe os grupos que ficam de fora antes de gerar a planilha.')),
      erro, h('div', { class: 'esp-acoes' }, comecar, h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Fechar')));
  }

  /** busca de itens do estoque (nome, código ou código de barras) */
  function buscaItens(loja, escolher, ph) {
    const inp = h('input', { class: 'f-input', type: 'search', placeholder: ph, autocomplete: 'off' });
    const sug = h('div', { class: 'cp-sug', hidden: true });
    let t;
    inp.addEventListener('input', () => { clearTimeout(t); const q = inp.value.trim(); if (q.length < 2) { sug.hidden = true; return; } t = setTimeout(async () => {
      let l = []; try { l = await API.buscar(loja, q); } catch { l = []; }
      sug.replaceChildren(...(l.length ? l.map((it) => h('button', { type: 'button', class: 'cp-sug-it', onmousedown: (e) => { e.preventDefault(); escolher(it); inp.value = ''; sug.hidden = true; inp.focus(); } }, h('span', null, it.desc), h('small', null, `${it.cod} · ${String(it.un || '').toLowerCase()}${it.qtd != null ? ' · ' + qtdTxt(it.qtd, it.un) : ''}`)))
        : [h('div', { class: 'cp-sug-vazio' }, 'Nada encontrado.')]));
      sug.hidden = false;
    }, 220); });
    inp.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 150));
    return h('div', { class: 'cp-prod-campo' }, inp, sug);
  }

  // ---------- contagem ----------
  async function abrirContagem(corpo, loja, id) {
    let c;
    try { c = await API.abrir(loja, id); } catch (e) { state.invId = null; troca(corpo, h('div', { class: 'notice err' }, e.message), h('button', { type: 'button', class: 'btn mt', onclick: () => TS.render() }, '‹ Voltar')); return; }
    if (!corpo.isConnected) return;
    if (c.st === 'contando' || !c.podeRevisar) telaContar(corpo, loja, c); else telaRevisar(corpo, loja, c);
  }

  function telaContar(corpo, loja, c) {
    const voltar = h('button', { type: 'button', class: 'btn', onclick: () => { state.invId = null; TS.render(); } }, '‹ Contagens');
    const aberta = c.st === 'contando';
    const prog = h('div', { class: 'inv-prog' });
    const lista = h('div', { class: 'inv-itens' });
    const fil = { v: state.invFil || 'faltam', q: '' };
    const pintarProg = () => {
      const n = c.itens.filter((i) => i.cont != null).length;
      prog.replaceChildren(h('div', { class: 'inv-barra' }, h('i', { style: { width: Math.round((n / Math.max(1, c.itens.length)) * 100) + '%' } })), h('small', null, h('b', null, `${fmt.int(n)} de ${fmt.int(c.itens.length)}`), ' contados'));
    };
    const busca = h('input', { class: 'f-input inv-busca', type: 'search', placeholder: 'Procurar na contagem…', autocomplete: 'off' });
    busca.addEventListener('input', TS.debounce ? TS.debounce(() => { fil.q = TS.norm(busca.value.trim()); pintar(); }, 120) : () => { fil.q = TS.norm(busca.value.trim()); pintar(); });
    const segF = TS.seg([['Faltam', 'faltam'], ['Contados', 'contados'], ['Todos', 'todos']], fil.v, (v) => { fil.v = v; state.invFil = v; segF.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); pintar(); });
    segF.querySelectorAll('button').forEach((b, i) => { b.dataset.v = ['faltam', 'contados', 'todos'][i]; });
    // leitor de código de barras (câmera) — Chrome no Android
    const scan = 'BarcodeDetector' in window && aberta ? h('button', { type: 'button', class: 'btn inv-scan', title: 'Ler o código de barras com a câmera', onclick: () => lerCodigo((cod) => {
      const it = c.itens.find((i) => i.barras === cod || i.cod === cod);
      if (!it) { toast(`Código ${cod} não está nesta contagem.`, true); return; }
      fil.v = 'todos'; fil.q = ''; busca.value = ''; pintar();
      const el = lista.querySelector(`[data-cod="${CSS.escape(it.cod)}"] input`); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
    }) }, '📷 Código') : null;
    const pintar = () => {
      const sel = c.itens.filter((i) => (fil.v === 'faltam' ? i.cont == null : fil.v === 'contados' ? i.cont != null : true) && (!fil.q || TS.norm(i.desc).includes(fil.q) || i.cod.includes(fil.q)));
      const porGrupo = new Map();
      for (const i of sel) { const g = i.tipo ? i.tipo[0] + i.tipo.slice(1).toLowerCase() : i.sub || i.grupo || 'Outros'; (porGrupo.get(g) || porGrupo.set(g, []).get(g)).push(i); }
      lista.replaceChildren(...(sel.length ? [...porGrupo].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).flatMap(([g, its]) => [h('div', { class: 'inv-grupo' }, `${g} (${its.length})`), ...its.sort((a, b) => a.desc.localeCompare(b.desc, 'pt-BR')).map((i) => linhaItem(i))])
        : [TS.empty(fil.v === 'faltam' ? 'Tudo contado! 👏 Agora é só terminar.' : 'Nada aqui.')]));
    };
    const linhaItem = (i) => {
      const kg = ehKg(i.un);
      // chá a granel: digita em gramas (a balança mostra gramas); guarda em kg
      const mostra = (v) => (v == null ? '' : kg ? String(Math.round(v * 1000)) : String(v).replace('.', ','));
      const inp = h('input', { class: 'f-input inv-qtd', type: 'text', inputmode: kg ? 'numeric' : 'decimal', value: mostra(i.cont), placeholder: kg ? 'gramas' : 'qtd', disabled: !aberta || null, enterkeyhint: 'next', 'aria-label': `Quantidade de ${i.desc}` });
      const est = h('small', { class: 'inv-salvo' });
      const dif = h('span', { class: 'inv-dif' });
      const pintarDif = () => {
        if (i.cont == null || i.sis == null) { dif.textContent = ''; dif.className = 'inv-dif'; return; }
        const d0 = Math.round((i.cont - i.sis) * 1000) / 1000;
        dif.textContent = d0 === 0 ? 'confere ✓' : `${d0 > 0 ? '+' : '−'}${qtdTxt(Math.abs(d0), i.un)}`;
        dif.className = 'inv-dif ' + (d0 === 0 ? 'ok' : d0 > 0 ? 'mais' : 'menos');
      };
      let t;
      const salvar = async () => {
        const txt = inp.value.trim().replace(/\s/g, '');
        let v = null;
        if (txt !== '') {
          // aceita vírgula brasileira ("1,5" ou "1.250,5") e ponto decimal direto do teclado numérico ("1.5")
          const limpo = txt.includes(',') ? txt.replace(/\./g, '').replace(',', '.') : txt;
          v = Number(limpo);
          if (!Number.isFinite(v) || v < 0) { est.textContent = 'número inválido'; est.className = 'inv-salvo neg'; return; }
          if (kg) v = v / 1000;
        }
        if (v === i.cont) return;
        est.textContent = 'salvando…'; est.className = 'inv-salvo';
        try { const r = await API.contar(loja, c.id, i.cod, v); Object.assign(i, { cont: r.cont, lotes: r.lotes, por: r.por, em: r.em }); inp.readOnly = false; painel.hidden = true; if (porLote) porLote.textContent = 'contar por lote'; est.textContent = v == null ? '' : 'salvo ✓'; est.className = 'inv-salvo ok'; pintarProg(); pintarDif(); }
        catch (e) { est.textContent = e.message; est.className = 'inv-salvo neg'; }
      };
      inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(salvar, 900); });
      inp.addEventListener('change', () => { clearTimeout(t); salvar(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); salvar(); const todos = [...lista.querySelectorAll('input.inv-qtd')]; const k = todos.indexOf(inp); if (todos[k + 1]) todos[k + 1].focus(); else inp.blur(); } });
      const passo = (d0) => h('button', { type: 'button', class: 'inv-passo', disabled: !aberta || null, 'aria-label': d0 > 0 ? 'mais um' : 'menos um', onclick: () => { const atual = i.cont ?? 0; const v = Math.max(0, kg ? atual * 1000 + d0 * 10 : atual + d0); inp.value = kg ? String(Math.round(v)) : String(v); clearTimeout(t); salvar(); } }, d0 > 0 ? '＋' : '−');
      pintarDif();
      // chá a granel: contar por lote (Estoque → Validade) — o total é a soma; depois de importado no AppNext,
      // o painel parte dessa contagem para o saldo de cada lote
      const painel = h('div', { class: 'inv-lotes', hidden: true });
      let tLote;
      const abrirLotes = async () => {
        if (!painel.hidden) { painel.hidden = true; return; }
        let dv;
        try { dv = await TS.validade.dados(loja); } catch (e) { toast(e.message, true); return; }
        const ls = TS.validade.lotesDoCha(dv, i.cod).map((x) => ({ ...x, saldo: undefined }));
        if (!ls.length) { toast('Este chá não tem entradas nos últimos 14 meses: conte o total.', true); return; }
        painel.replaceChildren(h('small', { class: 'muted' }, 'Pese cada lote em gramas: o total é a soma.'),
          TS.validade.camposLotes(ls, i.lotes || {}, (m, soma) => {
            inp.value = soma ? String(Math.round(soma * 1000)) : ''; inp.readOnly = true;
            clearTimeout(tLote);
            tLote = setTimeout(async () => {
              est.textContent = 'salvando…'; est.className = 'inv-salvo';
              try { const r = await API.contar(loja, c.id, i.cod, soma, Object.keys(m).length ? m : null); Object.assign(i, { cont: r.cont, lotes: r.lotes, por: r.por, em: r.em }); est.textContent = 'salvo por lote ✓'; est.className = 'inv-salvo ok'; pintarProg(); pintarDif(); }
              catch (e) { est.textContent = e.message; est.className = 'inv-salvo neg'; }
            }, 700);
          }, !aberta));
        painel.hidden = false;
      };
      const porLote = kg && TS.validade && (!TS.paginas || TS.paginas().includes('validade')) ? h('button', { type: 'button', class: 'link-btn inv-porlote', onclick: abrirLotes }, i.lotes && Object.keys(i.lotes).length ? `por lote ✓ (${Object.keys(i.lotes).length})` : 'contar por lote') : null;
      if (i.lotes && Object.keys(i.lotes).length) inp.readOnly = true;
      return h('div', { class: 'inv-item' + (i.cont != null ? ' feito' : '') + (kg ? ' inv-kg' : ''), 'data-cod': i.cod },
        h('div', { class: 'inv-item-txt' }, h('b', null, i.desc), h('small', { class: 'muted' }, `cód. ${i.cod}${i.sis != null ? ' · sistema: ' + qtdTxt(i.sis, i.un) : ''}`), h('div', null, dif, est, porLote)),
        h('div', { class: 'inv-item-qtd' }, passo(-1), h('div', { class: 'inv-campo' }, inp, h('span', null, kg ? 'g' : String(i.un || 'un').toLowerCase())), passo(1)),
        painel);
    };
    const incluir = aberta ? h('details', { class: 'inv-incluir' }, h('summary', null, '+ Incluir item que não está na lista'),
      buscaItens(loja, async (it) => { try { await API.incluir(loja, c.id, [it.cod]); toast(`${it.desc} incluído.`); abrirContagem(corpo, loja, c.id); } catch (e) { toast(e.message, true); } }, 'Nome, código ou código de barras')) : null;
    const terminar = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
      const faltam = c.itens.filter((i) => i.cont == null).length;
      if (faltam && !confirm(`${faltam} ${faltam === 1 ? 'item ficou' : 'itens ficaram'} sem contar. Eles ficam de fora da planilha (não mudam no AppNext). Terminar mesmo assim?`)) return;
      try { await API.acao(loja, c.id, 'revisar'); toast(c.podeRevisar ? 'Contagem terminada. Revise as diferenças.' : 'Contagem terminada. A gerente revisa e gera a planilha.'); if (!c.podeRevisar) state.invId = null; TS.render(); } catch (e) { toast(e.message, true); }
    } }, 'Terminar contagem');
    pintarProg(); pintar();
    troca(corpo, 
      h('div', { class: 'inv-cab' }, voltar, h('div', null, h('b', { class: 'inv-titulo' }, c.nome), h('small', { class: 'muted' }, ` · ${c.cega ? 'contagem cega' : 'com a quantidade do sistema'}`))),
      h('div', { class: 'card inv-fixo' }, prog, h('div', { class: 'inv-ferr' }, busca, scan), segF),
      !aberta ? h('div', { class: 'notice' }, 'Esta contagem já foi terminada. A gerente revisa e gera a planilha.') : null,
      lista, incluir,
      aberta ? h('div', { class: 'inv-rodape' }, terminar) : null);
  }

  /** câmera + BarcodeDetector: lê EAN/código e chama fn(código) */
  async function lerCodigo(fn) {
    let stream;
    const video = h('video', { class: 'inv-video', playsinline: true, muted: true });
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    const fechar = () => {
      document.removeEventListener('keydown', esc);
      window.removeEventListener('hashchange', fechar);
      try { stream && stream.getTracks().forEach((t) => t.stop()); } catch { /* ok */ }
      camada.remove();
    };
    const camada = h('div', { class: 'inv-camera' }, video, h('div', { class: 'inv-mira' }), h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Fechar'));
    document.body.append(camada);
    document.addEventListener('keydown', esc);
    window.addEventListener('hashchange', fechar);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play();
      const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e'] });
      const loop = async () => {
        if (!camada.isConnected) { fechar(); return; }
        try { const r = await det.detect(video); if (r.length) { fechar(); fn(String(r[0].rawValue).trim()); return; } } catch { /* tenta de novo */ }
        requestAnimationFrame(loop);
      };
      loop();
    } catch (e) { fechar(); toast('Não consegui abrir a câmera: ' + e.message, true); }
  }

  // ---------- revisão (gerente, franqueado, admin) ----------
  function telaRevisar(corpo, loja, c) {
    const repintar = () => abrirContagem(corpo, loja, c.id);
    const fechada = c.st === 'importado' || c.st === 'revertido';
    const contados = c.itens.filter((i) => i.cont != null);
    const rows = contados.map((i) => {
      const dq = Math.round((i.cont - (i.sis || 0)) * 1000) / 1000;
      const agora = c.agora && c.agora[i.cod] != null ? c.agora[i.cod] : null;
      return { ...i, dq, dr: i.custo != null ? dq * i.custo : null, agora, mudou: agora != null && Math.abs(agora - (i.sis || 0)) > 0.0005, conferiu: agora != null && Math.abs(agora - i.cont) < 0.0005 };
    });
    // "zerar os não listados": o que ficaria zero (menos os grupos desmarcados)
    const z = c.zerar || { ativo: false };
    const resto = c.resto || [];
    const fora = new Set(c.restoFora || []);
    const zerados = z.ativo ? resto.filter((r) => !fora.has(r.grupo)) : [];
    const valorZ = zerados.reduce((s0, r) => s0 + (r.custo || 0) * (r.qtd || 0), 0);
    const sobra = rows.reduce((s0, r) => s0 + (r.dr > 0 ? r.dr : 0), 0), falta = rows.reduce((s0, r) => s0 + (r.dr < 0 ? -r.dr : 0), 0) + Math.max(0, valorZ);
    const div = rows.filter((r) => Math.abs(r.dq) > 0.0005);
    const sem = c.itens.length - contados.length;
    const mudou = rows.filter((r) => r.mudou && !fechada);
    const filV = state.invRevFil === 'todos' ? 'todos' : 'dif';
    const tab = TS.table({
      cols: [
        { key: 'desc', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => h('span', null, r.desc, h('small', { class: 'est-tam' }, `cód. ${r.cod}${r.por ? ` · contou ${r.por} ${quando(r.em)}` : ''}`)) },
        { key: 'sis', label: 'Sistema', render: (r) => qtdTxt(r.sis, r.un), sortVal: (r) => r.sis },
        { key: 'cont', label: 'Contado', render: (r) => h('b', null, qtdTxt(r.cont, r.un)), sortVal: (r) => r.cont },
        { key: 'dq', label: 'Diferença', render: (r) => h('span', { class: r.dq > 0 ? 'pos' : r.dq < 0 ? 'neg' : 'muted' }, r.dq === 0 ? 'confere' : `${r.dq > 0 ? '+' : '−'}${qtdTxt(Math.abs(r.dq), r.un)}`), sortVal: (r) => r.dq },
        { key: 'dr', label: 'Em R$ (custo)', fmt: fmt.brl, render: (r) => (r.dr == null ? '—' : h('span', { class: r.dr > 0 ? 'pos' : r.dr < 0 ? 'neg' : 'muted' }, fmt.brl(r.dr))), sortVal: (r) => r.dr || 0 },
        c.st === 'importado' ? { key: 'agora', label: 'No AppNext agora', render: (r) => (r.agora == null ? '—' : h('span', { class: r.conferiu ? 'pos' : 'muted', title: r.conferiu ? 'O estoque do AppNext já está com a quantidade contada' : 'Ainda diferente: o estoque do painel é de antes da importação, ou houve venda/entrada depois' }, qtdTxt(r.agora, r.un), r.conferiu ? ' ✓' : '')), sortVal: (r) => r.agora || 0 } : null,
      ].filter(Boolean),
      rows: filV === 'dif' ? div : rows, sortKey: 'dr', sortDir: 'asc', maxHeight: '520px', search: 'Buscar produto…', searchKeys: ['desc', 'cod'], cls: 'est-t',
      total: { desc: `${fmt.int(filV === 'dif' ? div.length : rows.length)} itens`, dr: (filV === 'dif' ? div : rows).reduce((s0, r) => s0 + (r.dr || 0), 0) },
      imprimir: ['desc', 'sis', 'cont', 'dq', 'dr'],
      empty: 'Nenhuma diferença: tudo confere com o sistema. 👏',
    });
    const [stT, stC] = ST[c.st];
    const baixar = h('a', { class: 'btn primary', href: TS.demo ? '#' : TS.api(`inventario/contagem/${c.id}/planilha?loja=${encodeURIComponent(loja)}`), onclick: (e) => {
      if (TS.demo) { e.preventDefault(); toast('Na apresentação a planilha não é gerada.'); return; }
      if (!contados.length) { e.preventDefault(); toast('Nenhum item contado.', true); return; }
      if (z.ativo && zerados.length && !confirm(`A planilha vai ZERAR no AppNext ${fmt.int(zerados.length)} produtos que não estão nesta contagem (${fmt.brl(valorZ)} em custo). Confirma?`)) { e.preventDefault(); return; }
      setTimeout(repintar, 1500);
    } }, c.st === 'gerado' ? 'Baixar a planilha de novo' : 'Baixar planilha do AppNext');
    const fazer = (a, conf) => async () => { if (conf && !confirm(conf)) return; try { await API.acao(loja, c.id, a); if (a === 'cancelar') state.invId = null; TS.render(); } catch (e) { toast(e.message, true); } };
    // enviar direto para o AppNext pelo robô (confere o que o AppNext leu antes de salvar)
    const env = c.envio || null, enviando = env && env.estado === 'na_fila';
    const enviar = (tipo) => async () => {
      const n = tipo === 'importar' ? contados.length + zerados.length : (c.planilha ? c.planilha.itens.length : 0);
      const txt = tipo === 'importar'
        ? `Enviar para o AppNext agora?\n\n${fmt.int(contados.length)} produtos contados${zerados.length ? ` e ${fmt.int(zerados.length)} zerados (fora da contagem)` : ''}.\nO robô confere item a item o que o AppNext leu e só então salva o inventário.`
        : `Desfazer no AppNext?\n\n${fmt.int(n)} produtos voltam ao que eram antes deste inventário (mantendo o que vendeu ou entrou depois).`;
      if (!confirm(txt)) return;
      try { await API.enviar(loja, c.id, tipo); toast('Enviado para o robô. Acompanhe aqui.'); repintar(); } catch (e) { toast(e.message, true); }
    };
    const logRobo = (linhas) => h('pre', { class: 'inv-log' }, (linhas || []).join('\n'));
    const cartaoEnvio = (cc = c) => {
      const env = cc.envio;
      if (!env) return null;
      const r = cc.robo || {}, u = r.ultima || {};
      const desf = env.tipo === 'desfazer';
      if (env.estado === 'na_fila') {
        const rodando = r.estado === 'rodando';
        const oc = r.ocupado;
        const sub = rodando ? 'o robô está trabalhando no AppNext'
          : oc ? `esperando a atualização desta loja terminar no AppNext${oc.inicio ? ` (começou ${quando(oc.inicio)})` : ''}; o inventário começa logo depois`
            : 'o robô do inventário está abrindo (começa em instantes)';
        const el = h('div', { class: 'card mt inv-envio' },
          h('div', { class: 'inv-envio-tit' }, h('span', { class: 'cfg-pulso' }), h('b', null, desf ? 'Desfazendo no AppNext…' : 'Enviando para o AppNext…'), h('small', { class: 'muted inv-envio-sub' }, `Enviado ${quando(env.em)} por ${env.por || '—'} · ${sub}`)),
          rodando && r.aoVivo && r.aoVivo.length ? logRobo(r.aoVivo) : null,
          h('small', { class: 'muted' }, 'Leva de 1 a 3 minutos depois que começa. Pode sair desta tela: o resultado fica salvo aqui.'));
        // atualiza só este quadro (não mexe no resto da tela); quando terminar, redesenha tudo
        setTimeout(async () => {
          if (!el.isConnected || state.invId !== c.id) return;
          let n; try { n = await API.abrir(loja, c.id); } catch { n = null; }
          if (!el.isConnected) return;
          if (!n || !n.envio || n.envio.estado !== 'na_fila') { repintar(); return; }
          const pre = el.querySelector('.inv-log'), noFim = !pre || pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 10;
          const novo = cartaoEnvio(n); el.replaceWith(novo);
          const p2 = novo.querySelector('.inv-log'); if (p2 && noFim) p2.scrollTop = p2.scrollHeight;
        }, 3000);
        return el;
      }
      if (env.estado === 'erro') return h('div', { class: 'notice err mt' }, h('b', null, desf ? 'O desfazer não foi feito. ' : 'O inventário não foi importado. '), env.erro || 'falhou',
        ' Nada foi gravado no AppNext se a conferência falhou; tente de novo ou baixe a planilha e importe à mão.',
        u.log && u.log.length && u.id === c.id ? h('details', { open: true }, h('summary', null, 'Log do robô'), logRobo(u.log)) : null);
      if (env.estado === 'ok' && u.log && u.log.length && u.id === c.id) return h('details', { class: 'card mt' }, h('summary', null, h('b', null, desf ? '✓ Desfeito no AppNext pelo robô' : '✓ Importado no AppNext pelo robô'), h('span', { class: 'muted' }, ` ${quando(env.fim)} · ver o log`)), logRobo(u.log));
      return null;
    };

    // cartão "produtos fora da contagem": ligar, ver por grupo e escolher os grupos que ficam de fora
    const cartaoZerar = () => {
      if (fechada) return null;
      const salvarZ = async (novo) => { try { await API.zerar(loja, c.id, novo); repintar(); } catch (e) { toast(e.message, true); } };
      const chk = h('input', { type: 'checkbox', checked: z.ativo || null, onchange: () => salvarZ({ ativo: chk.checked, semGrupos: z.semGrupos ?? null }) });
      const card = h('div', { class: 'card mt inv-zerar' + (z.ativo ? ' on' : '') },
        h('label', { class: 'inv-check' }, chk, h('span', null, h('b', null, 'Zerar os produtos que não estão nesta contagem'), ` — ${fmt.int(resto.length)} produtos fora da contagem têm estoque no sistema hoje.`)));
      if (!z.ativo) return card;
      const grupos = new Map();
      for (const r of resto) { const g = r.grupo || 'Sem grupo'; const a = grupos.get(g) || grupos.set(g, { n: 0, v: 0 }).get(g); a.n++; a.v += (r.custo || 0) * (r.qtd || 0); }
      const lista = [...grupos].sort((a, b) => b[1].n - a[1].n);
      card.append(
        h('div', { class: 'inv-zerar-res' }, h('b', null, `${fmt.int(zerados.length)} produtos vão ficar 0 no AppNext`), ` · ${fmt.brl(valorZ)} em custo`),
        h('small', { class: 'muted' }, 'Desmarque os grupos que NÃO devem ser zerados (os "sem controle de estoque" já começam desmarcados).'),
        h('div', { class: 'inv-zerar-grupos' }, ...lista.map(([g, a]) => {
          const cb = h('input', { type: 'checkbox', checked: !fora.has(g === 'Sem grupo' ? '' : g) || null, onchange: () => {
            const nf = new Set(fora); const k = g === 'Sem grupo' ? '' : g; if (cb.checked) nf.delete(k); else nf.add(k);
            salvarZ({ ativo: true, semGrupos: [...nf] });
          } });
          return h('label', { class: 'inv-zerar-g' }, cb, h('span', null, g), h('small', { class: 'muted' }, `${fmt.int(a.n)} · ${fmt.brl(a.v)}`));
        })),
        h('details', { class: 'inv-zerar-lista' }, h('summary', null, 'Ver os produtos que vão ficar 0'), TS.table({
          cols: [{ key: 'desc', label: 'Produto', align: 'l', wrap: true, render: (r) => h('span', null, r.desc, h('small', { class: 'est-tam' }, `cód. ${r.cod} · ${r.grupo || 'sem grupo'}`)) }, { key: 'qtd', label: 'Hoje no sistema', render: (r) => qtdTxt(r.qtd, r.un), sortVal: (r) => r.qtd }, { key: 'v', label: 'Custo', fmt: fmt.brl }],
          rows: zerados.map((r) => ({ ...r, v: (r.custo || 0) * (r.qtd || 0) })), sortKey: 'v', maxHeight: '360px', search: 'Buscar…', searchKeys: ['desc', 'cod', 'grupo'], cls: 'est-t',
        })));
      return card;
    };

    // o que foi para o AppNext (histórico) e desfazer
    const cartaoEnviado = () => {
      if (!c.planilha) return null;
      const pl = c.planilha.itens.map((l) => ({ ...l, dif: Math.round((l.nova - l.antes) * 1000) / 1000, v: (l.nova - l.antes) * (l.custo || 0) }));
      const ajuste = pl.reduce((s0, l) => s0 + l.v, 0);
      const btnDesf = c.st === 'importado' ? h('a', { class: 'btn ghost-danger', href: TS.demo ? '#' : TS.api(`inventario/contagem/${c.id}/desfazer?loja=${encodeURIComponent(loja)}`), onclick: (e) => {
        if (TS.demo) { e.preventDefault(); toast('Na apresentação não dá para desfazer.'); return; }
        if (!confirm('Baixar a planilha que DESFAZ este inventário? Cada item volta ao que era antes, mantendo o que vendeu ou entrou depois. Depois importe no AppNext do mesmo jeito.')) { e.preventDefault(); return; }
        setTimeout(repintar, 1500);
      } }, 'Desfazer este inventário') : null;
      return h('div', { class: 'card mt' }, h('div', { class: 'card-title' }, 'O que foi para o AppNext'),
        h('div', { class: 'card-sub' }, `Planilha gerada ${quando(c.planilha.em)} por ${c.planilha.por || '—'}: ${fmt.int(pl.length)} produtos${pl.some((l) => l.zerado) ? ` (${fmt.int(pl.filter((l) => l.zerado).length)} zerados por estarem fora da contagem)` : ''} · ajuste de ${fmt.brl(ajuste)} em custo.`),
        c.st === 'importado' && !enviando ? h('div', { class: 'inv-acoes' }, c.podeEnviar ? h('button', { type: 'button', class: 'btn ghost-danger', onclick: enviar('desfazer') }, 'Desfazer no AppNext') : null, c.podeEnviar && btnDesf ? (btnDesf.className = 'btn', btnDesf.textContent = 'ou baixar a planilha de desfazer', btnDesf) : btnDesf, c.desfazer && c.desfazer.geradoEm && !(env && env.tipo === 'desfazer') ? h('button', { type: 'button', class: 'btn', onclick: fazer('desfeito', 'Confirma que importou a planilha de desfazer no AppNext?') }, 'Já importei o desfazer') : null) : null,
        c.st === 'importado' && c.desfazer && c.desfazer.geradoEm && !(env && env.tipo === 'desfazer') ? h('div', { class: 'aviso inv-passos' }, `Planilha de desfazer baixada ${quando(c.desfazer.geradoEm)}. Importe no AppNext (Auditoria/Inventário → ＋ → Por Excel) e clique em "Já importei o desfazer".`) : null,
        c.st === 'revertido' ? h('p', { class: 'muted' }, `Desfeito ${quando(c.desfazer.importadoEm)} por ${c.desfazer.importadoPor || '—'}.`) : null,
        h('details', null, h('summary', null, 'Ver item a item'), TS.table({
          cols: [
            { key: 'desc', label: 'Produto', align: 'l', wrap: true, render: (r) => h('span', null, r.desc, r.zerado ? h('span', { class: 'inv-st inv-st-canc', style: { marginLeft: '6px' } }, 'zerado') : null, h('small', { class: 'est-tam' }, `cód. ${r.cod}`)) },
            { key: 'antes', label: 'Antes', render: (r) => qtdTxt(r.antes, r.un), sortVal: (r) => r.antes },
            { key: 'nova', label: 'Ficou', render: (r) => h('b', null, qtdTxt(r.nova, r.un)), sortVal: (r) => r.nova },
            { key: 'v', label: 'Ajuste (custo)', fmt: fmt.brl, render: (r) => h('span', { class: r.v > 0 ? 'pos' : r.v < 0 ? 'neg' : 'muted' }, fmt.brl(r.v)), sortVal: (r) => r.v },
          ],
          rows: pl, sortKey: 'v', sortDir: 'asc', maxHeight: '420px', search: 'Buscar…', searchKeys: ['desc', 'cod'], cls: 'est-t', imprimir: ['desc', 'antes', 'nova', 'v'],
        })));
    };

    troca(corpo,
      h('div', { class: 'inv-cab' }, h('button', { type: 'button', class: 'btn', onclick: () => { state.invId = null; TS.render(); } }, '‹ Contagens'), h('div', null, h('b', { class: 'inv-titulo' }, c.nome), ' ', h('span', { class: 'inv-st ' + stC }, stT))),
      h('div', { class: 'grid g-kpi mt' },
        TS.kpi('Itens contados', `${fmt.int(contados.length)} de ${fmt.int(c.itens.length)}`, sem ? `${fmt.int(sem)} sem contar ficam de fora` : 'todos contados'),
        TS.kpi('Com diferença', fmt.int(div.length), contados.length ? `${fmt.pct(div.length / contados.length, 0)} dos contados` : ''),
        TS.kpi('Sobrou (custo)', fmt.brl(sobra), 'contado acima do sistema'),
        TS.kpi('Faltou (custo)', fmt.brl(falta), z.ativo && zerados.length ? `inclui ${fmt.brl(valorZ)} dos zerados` : 'contado abaixo do sistema')),
      mudou.length ? h('div', { class: 'notice mt' }, `${fmt.int(mudou.length)} ${mudou.length === 1 ? 'item mudou' : 'itens mudaram'} no estoque do painel desde o começo da contagem (venda ou entrada). A planilha leva o que foi contado: se vendeu depois de contar, reconte esses itens antes de importar.`) : null,
      cartaoEnvio(),
      enviando ? null : cartaoZerar(),
      h('div', { class: 'card mt' },
        h('div', { class: 'inv-acoes' },
          !fechada && c.st !== 'cancelado' && c.podeEnviar && !enviando ? h('button', { type: 'button', class: 'btn primary inv-enviar', onclick: enviar('importar') }, env && env.estado === 'erro' ? 'Tentar enviar de novo' : 'Enviar para o AppNext') : null,
          !fechada && c.st !== 'cancelado' && !enviando ? (c.podeEnviar ? (baixar.classList.remove('primary'), baixar.textContent = 'ou baixar a planilha', baixar) : baixar) : null,
          c.st === 'gerado' && !enviando && !(env && env.tipo === 'importar') ? h('button', { type: 'button', class: 'btn', onclick: fazer('importado') }, 'Já importei no AppNext') : null,
          ['revisao', 'gerado', 'cancelado'].includes(c.st) && !enviando ? h('button', { type: 'button', class: 'btn', onclick: fazer('reabrir') }, 'Reabrir para contar') : null,
          !fechada && c.st !== 'cancelado' && !enviando ? h('button', { type: 'button', class: 'btn ghost-danger', onclick: fazer('cancelar', 'Cancelar esta contagem? Ela fica no histórico.') }, 'Cancelar') : null),
        c.st === 'gerado' && !c.podeEnviar ? h('div', { class: 'aviso inv-passos' }, h('b', null, 'Agora no AppNext: '), 'Estoque → Auditoria/Inventário → ＋ (Cadastrar um novo) → Por Excel → envie a planilha baixada. Depois clique em "Já importei no AppNext".') : null,
        c.st === 'importado' ? h('p', { class: 'muted' }, `Importado ${quando(c.importadoEm)} por ${c.importadoPor || '—'}${c.importadoPeloRobo ? ' (pelo robô, conferido item a item)' : ''}. Na próxima atualização do estoque, a coluna "No AppNext agora" mostra ✓ nos itens que já estão com a quantidade contada.`) : null,
        h('div', { class: 'inv-revfil' }, TS.seg([[`Só diferenças (${div.length})`, 'dif'], [`Todos os contados (${rows.length})`, 'todos']], filV, (v) => { state.invRevFil = v; telaRevisar(corpo, loja, c); }), tab.searchBox), tab),
      cartaoEnviado());
  }
})();
