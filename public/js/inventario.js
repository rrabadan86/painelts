/* Estoque → Inventário: contar o estoque pelo celular ou computador e gerar a planilha de inventário do AppNext.
   1) Nova contagem: alguns produtos, um grupo, um tipo de chá (Rooibos, Chá verde…) ou todos os chás a granel.
   2) Contar: cada item com o campo grande (chá a granel em gramas), salva sozinho; leitor de código de barras no Android.
   3) Revisar: sistema × contado, diferença em quantidade e em R$.
   4) Planilha: o modelo do AppNext só com os itens contados → AppNext: Estoque → Auditoria/Inventário → Novo → Por Excel.
   Contagem cega: quem conta não vê a quantidade do sistema (a vendedora sempre conta às cegas). */
(function () {
  const { h, fmt, state } = TS;
  const ST = { contando: ['Contando', 'inv-st-cont'], revisao: ['Para revisar', 'inv-st-rev'], gerado: ['Planilha gerada', 'inv-st-ger'], importado: ['Importado no AppNext', 'inv-st-ok'], cancelado: ['Cancelada', 'inv-st-canc'] };
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
      const c = { id: 'demo' + Date.now().toString(16).slice(-8), nome: b.nome || 'Contagem', criadoEm: new Date().toISOString(), por: 'apresentacao', cega: !!b.cega, st: 'contando', itens: itens.map((i) => ({ ...i, sis: i.qtd, cont: null })) };
      DEMO.cont.unshift(c); return c.id;
    },
    async abrir(loja, id) { if (!TS.demo) return req('GET', `inventario/contagem?loja=${encodeURIComponent(loja)}&id=${id}`); const c = DEMO.cont.find((x) => x.id === id); return { ...c, podeRevisar: true, agora: null }; },
    async contar(loja, id, cod, cont) {
      if (!TS.demo) return (await req('PUT', `inventario/contagem/${id}/item/${encodeURIComponent(cod)}`, { loja, cont })).item;
      const it = DEMO.cont.find((x) => x.id === id).itens.find((i) => i.cod === cod); Object.assign(it, { cont, por: 'apresentacao', em: cont == null ? null : new Date().toISOString() }); return it;
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
      h('div', { class: 'page-sub' }, 'Conte o estoque pelo celular ou pelo computador (um item, um grupo ou um tipo de chá) e gere a planilha para importar no AppNext.'))));
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
    const antigas = d.contagens.filter((c) => !abertas.includes(c)).slice(0, 20);
    const linha = (c) => {
      const [t, cls] = ST[c.st];
      const pct = c.itens ? c.contados / c.itens : 0;
      return h('button', { type: 'button', class: 'inv-linha', onclick: () => { state.invId = c.id; TS.render(); } },
        h('div', { class: 'inv-linha-top' }, h('b', null, c.nome), h('span', { class: 'inv-st ' + cls }, t)),
        h('div', { class: 'inv-barra' }, h('i', { style: { width: Math.round(pct * 100) + '%' } })),
        h('small', { class: 'muted' }, `${fmt.int(c.contados)} de ${fmt.int(c.itens)} contados · aberta ${quando(c.criadoEm)} por ${c.por || '—'}${c.cega ? ' · cega' : ''}`));
    };
    const novaBox = h('div');
    const btnNova = h('button', { type: 'button', class: 'btn primary inv-nova-btn', onclick: () => { btnNova.hidden = true; novaBox.replaceChildren(formNova(loja, d, () => { btnNova.hidden = false; novaBox.replaceChildren(); })); } }, '+ Nova contagem');
    troca(corpo, 
      h('div', { class: 'inv-topo' }, btnNova, h('small', { class: 'muted' }, d.estoqueEm ? `Estoque do painel de ${quando(d.estoqueEm)}.` : '')),
      novaBox,
      h('div', { class: 'card mt' }, h('div', { class: 'card-title' }, 'Em andamento'), abertas.length ? h('div', { class: 'inv-lista' }, ...abertas.map(linha)) : TS.empty('Nenhuma contagem aberta. Comece com "Nova contagem".')),
      antigas.length ? h('details', { class: 'card mt inv-antigas' }, h('summary', null, `Contagens anteriores (${antigas.length})`), h('div', { class: 'inv-lista' }, ...antigas.map(linha))) : null,
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
      try { const id = await API.criar(loja, { ...b, nome: nome.value.trim() || nomePadrao, cega: cega.checked }); state.invId = id; TS.render(); }
      catch (e) { erro.textContent = e.message; comecar.disabled = false; }
    } }, 'Começar a contar');
    return h('div', { class: 'card mt inv-form' }, h('div', { class: 'card-title' }, 'Nova contagem'),
      h('div', { class: 'inv-modos' }, modos), corpoModo, previa,
      h('label', { class: 'esp-campo' }, h('span', { class: 'f-label' }, 'Nome'), nome),
      h('label', { class: 'inv-check' }, cega, h('span', null, h('b', null, 'Contagem cega'), ' — quem conta não vê a quantidade do sistema (conta sem se influenciar).', vend ? ' Para vendedoras é sempre cega.' : '')),
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
    busca.addEventListener('input', () => { fil.q = TS.norm(busca.value.trim()); pintar(); });
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
        if (txt !== '') { v = Number(txt.replace(/\./g, '').replace(',', '.')); if (!Number.isFinite(v) || v < 0) { est.textContent = 'número inválido'; est.className = 'inv-salvo neg'; return; } if (kg) v = v / 1000; }
        if (v === i.cont) return;
        est.textContent = 'salvando…'; est.className = 'inv-salvo';
        try { const r = await API.contar(loja, c.id, i.cod, v); Object.assign(i, { cont: r.cont, por: r.por, em: r.em }); est.textContent = v == null ? '' : 'salvo ✓'; est.className = 'inv-salvo ok'; pintarProg(); pintarDif(); }
        catch (e) { est.textContent = e.message; est.className = 'inv-salvo neg'; }
      };
      inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(salvar, 900); });
      inp.addEventListener('change', () => { clearTimeout(t); salvar(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); salvar(); const todos = [...lista.querySelectorAll('input.inv-qtd')]; const k = todos.indexOf(inp); if (todos[k + 1]) todos[k + 1].focus(); else inp.blur(); } });
      const passo = (d0) => h('button', { type: 'button', class: 'inv-passo', disabled: !aberta || null, 'aria-label': d0 > 0 ? 'mais um' : 'menos um', onclick: () => { const atual = i.cont ?? 0; const v = Math.max(0, kg ? atual * 1000 + d0 * 10 : atual + d0); inp.value = kg ? String(Math.round(v)) : String(v); clearTimeout(t); salvar(); } }, d0 > 0 ? '＋' : '−');
      pintarDif();
      return h('div', { class: 'inv-item' + (i.cont != null ? ' feito' : ''), 'data-cod': i.cod },
        h('div', { class: 'inv-item-txt' }, h('b', null, i.desc), h('small', { class: 'muted' }, `cód. ${i.cod}${i.sis != null ? ' · sistema: ' + qtdTxt(i.sis, i.un) : ''}`), h('div', null, dif, est)),
        h('div', { class: 'inv-item-qtd' }, passo(-1), h('div', { class: 'inv-campo' }, inp, h('span', null, kg ? 'g' : String(i.un || 'un').toLowerCase())), passo(1)));
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
    const fechar = () => { try { stream && stream.getTracks().forEach((t) => t.stop()); } catch { /* ok */ } camada.remove(); };
    const camada = h('div', { class: 'inv-camera' }, video, h('div', { class: 'inv-mira' }), h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Fechar'));
    document.body.append(camada);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play();
      const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e'] });
      const loop = async () => {
        if (!camada.isConnected) return;
        try { const r = await det.detect(video); if (r.length) { fechar(); fn(String(r[0].rawValue).trim()); return; } } catch { /* tenta de novo */ }
        requestAnimationFrame(loop);
      };
      loop();
    } catch (e) { fechar(); toast('Não consegui abrir a câmera: ' + e.message, true); }
  }

  // ---------- revisão (gerente, franqueado, admin) ----------
  function telaRevisar(corpo, loja, c) {
    const contados = c.itens.filter((i) => i.cont != null);
    const rows = contados.map((i) => {
      const dq = Math.round((i.cont - (i.sis || 0)) * 1000) / 1000;
      const agora = c.agora && c.agora[i.cod] != null ? c.agora[i.cod] : null;
      return { ...i, dq, dr: i.custo != null ? dq * i.custo : null, agora, mudou: agora != null && Math.abs(agora - (i.sis || 0)) > 0.0005, conferiu: agora != null && Math.abs(agora - i.cont) < 0.0005 };
    });
    const sobra = rows.reduce((s, r) => s + (r.dr > 0 ? r.dr : 0), 0), falta = rows.reduce((s, r) => s + (r.dr < 0 ? -r.dr : 0), 0);
    const div = rows.filter((r) => Math.abs(r.dq) > 0.0005);
    const sem = c.itens.length - contados.length;
    const mudou = rows.filter((r) => r.mudou && c.st !== 'importado');
    const filV = state.invRevFil === 'todos' ? 'todos' : 'dif';
    const tab = TS.table({
      cols: [
        { key: 'desc', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => h('span', null, r.desc, h('small', { class: 'est-tam' }, `cód. ${r.cod}${r.por ? ` · contou ${r.por} ${quando(r.em)}` : ''}`)) },
        { key: 'sis', label: 'Sistema', render: (r) => qtdTxt(r.sis, r.un), sortVal: (r) => r.sis },
        { key: 'cont', label: 'Contado', render: (r) => h('b', null, qtdTxt(r.cont, r.un)), sortVal: (r) => r.cont },
        { key: 'dq', label: 'Diferença', render: (r) => h('span', { class: r.dq > 0 ? 'pos' : r.dq < 0 ? 'neg' : 'muted' }, r.dq === 0 ? 'confere' : `${r.dq > 0 ? '+' : '−'}${qtdTxt(Math.abs(r.dq), r.un)}`), sortVal: (r) => r.dq },
        { key: 'dr', label: 'Em R$ (custo)', render: (r) => (r.dr == null ? '—' : h('span', { class: r.dr > 0 ? 'pos' : r.dr < 0 ? 'neg' : 'muted' }, fmt.brl(r.dr))), sortVal: (r) => r.dr || 0 },
        c.st === 'importado' ? { key: 'agora', label: 'No AppNext agora', render: (r) => (r.agora == null ? '—' : h('span', { class: r.conferiu ? 'pos' : 'muted', title: r.conferiu ? 'O estoque do AppNext já está com a quantidade contada' : 'Ainda diferente: o estoque do painel é de antes da importação, ou houve venda/entrada depois' }, qtdTxt(r.agora, r.un), r.conferiu ? ' ✓' : '')), sortVal: (r) => r.agora || 0 } : null,
      ].filter(Boolean),
      rows: filV === 'dif' ? div : rows, sortKey: 'dr', sortDir: 'asc', maxHeight: '520px', search: 'Buscar produto…', searchKeys: ['desc', 'cod'], cls: 'est-t',
      total: { desc: `${fmt.int(filV === 'dif' ? div.length : rows.length)} itens`, dr: (filV === 'dif' ? div : rows).reduce((s, r) => s + (r.dr || 0), 0) },
      imprimir: ['desc', 'sis', 'cont', 'dq', 'dr'],
      empty: 'Nenhuma diferença: tudo confere com o sistema. 👏',
    });
    const [stT, stC] = ST[c.st];
    const baixar = h('a', { class: 'btn primary', href: TS.demo ? '#' : TS.api(`inventario/contagem/${c.id}/planilha?loja=${encodeURIComponent(loja)}`), onclick: (e) => {
      if (TS.demo) { e.preventDefault(); toast('Na apresentação a planilha não é gerada.'); return; }
      if (!contados.length) { e.preventDefault(); toast('Nenhum item contado.', true); return; }
      setTimeout(() => abrirContagem(corpo, loja, c.id), 1500);
    } }, c.st === 'gerado' || c.st === 'importado' ? 'Baixar a planilha de novo' : 'Baixar planilha do AppNext');
    const fazer = (a, conf) => async () => { if (conf && !confirm(conf)) return; try { await API.acao(loja, c.id, a); if (a === 'cancelar') state.invId = null; TS.render(); } catch (e) { toast(e.message, true); } };
    troca(corpo, 
      h('div', { class: 'inv-cab' }, h('button', { type: 'button', class: 'btn', onclick: () => { state.invId = null; TS.render(); } }, '‹ Contagens'), h('div', null, h('b', { class: 'inv-titulo' }, c.nome), ' ', h('span', { class: 'inv-st ' + stC }, stT))),
      h('div', { class: 'grid g-kpi mt' },
        TS.kpi('Itens contados', `${fmt.int(contados.length)} de ${fmt.int(c.itens.length)}`, sem ? `${fmt.int(sem)} sem contar ficam de fora` : 'todos contados'),
        TS.kpi('Com diferença', fmt.int(div.length), contados.length ? `${fmt.pct(div.length / contados.length, 0)} dos contados` : ''),
        TS.kpi('Sobrou (custo)', fmt.brl(sobra), 'contado acima do sistema'),
        TS.kpi('Faltou (custo)', fmt.brl(falta), 'contado abaixo do sistema')),
      mudou.length ? h('div', { class: 'notice mt' }, `${fmt.int(mudou.length)} ${mudou.length === 1 ? 'item mudou' : 'itens mudaram'} no estoque do painel desde o começo da contagem (venda ou entrada). A planilha leva o que foi contado: se vendeu depois de contar, reconte esses itens ou ajuste antes de importar.`) : null,
      h('div', { class: 'card mt' },
        h('div', { class: 'inv-acoes' },
          c.st !== 'importado' && c.st !== 'cancelado' ? baixar : null,
          c.st === 'gerado' ? h('button', { type: 'button', class: 'btn', onclick: fazer('importado') }, 'Já importei no AppNext') : null,
          c.st === 'importado' ? baixar : null,
          ['revisao', 'gerado', 'cancelado'].includes(c.st) ? h('button', { type: 'button', class: 'btn', onclick: fazer('reabrir') }, 'Reabrir para contar') : null,
          c.st !== 'importado' && c.st !== 'cancelado' ? h('button', { type: 'button', class: 'btn ghost-danger', onclick: fazer('cancelar', 'Cancelar esta contagem? Ela fica no histórico.') }, 'Cancelar') : null),
        c.st === 'gerado' ? h('div', { class: 'aviso inv-passos' }, h('b', null, 'Agora no AppNext: '), 'Estoque → Auditoria/Inventário → ＋ (Cadastrar um novo) → Por Excel → envie a planilha baixada. Depois clique em "Já importei no AppNext". A planilha só tem os itens contados: o resto do estoque não muda.') : null,
        c.st === 'importado' ? h('p', { class: 'muted' }, `Importado ${quando(c.importadoEm)}. Na próxima atualização do estoque, a coluna "No AppNext agora" mostra ✓ nos itens que já estão com a quantidade contada.`) : null,
        h('div', { class: 'inv-revfil' }, TS.seg([[`Só diferenças (${div.length})`, 'dif'], [`Todos os contados (${rows.length})`, 'todos']], filV, (v) => { state.invRevFil = v; telaRevisar(corpo, loja, c); }), tab.searchBox), tab));
  }
})();
