/* Clientes → Lista de espera: anotar o pedido do cliente, saber quando o produto chegou (nota de entrada ou estoque),
   avisar pelo WhatsApp com a mensagem pronta e ver se o cliente comprou em até 7 dias.
   Todos os perfis da loja usam (vendedoras inclusive). Nada é descontado do estoque. */
(function () {
  const { h, fmt, state } = TS;
  const ST = {
    chegou: ['Chegou · avisar', 'esp-chegou'], esperando: ['Esperando', 'esp-esperando'], avisado: ['Avisado', 'esp-avisado'],
    comprou: ['Comprou', 'esp-comprou'], naocomprou: ['Não comprou', 'esp-nao'], cancelado: ['Cancelado', 'esp-canc'],
  };
  const ABAS = { avisar: ['Chegaram · avisar', ['chegou']], esperando: ['Esperando', ['esperando']], avisados: ['Avisados', ['avisado']], encerrados: ['Encerrados', ['comprou', 'naocomprou', 'cancelado']] };
  const MODOS = [['Por vendedora', 'vendedora'], ['Por produto', 'produto'], ['Lista corrida', 'lista']];
  const LOGIN_GEN = /^(vendedora?s?|gerentes?|admin|administrador|franquead[oa]s?|atendentes?|loja|caixa|balc[aã]o|equipe)$/i;
  const dataTxt = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—');
  const quandoTxt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const telTxt = (d) => { d = String(d || '').replace(/\D/g, ''); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d; };
  const wpp = (cel, texto) => { let d = String(cel || '').replace(/\D/g, ''); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); return d.length >= 10 ? `https://wa.me/55${d}?text=${encodeURIComponent(texto)}` : null; };
  const nomesItens = (p) => { const n = p.itens.map((i) => (i.qtd > 1 ? `${i.qtd}× ` : '') + i.desc); return n.length <= 1 ? n[0] || '' : n.slice(0, -1).join(', ') + ' e ' + n[n.length - 1]; };
  const primeiro = (nome) => { const p = String(nome || '').trim().split(/\s+/)[0] || ''; return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : ''; };
  const bonito = (s) => {
    const t = String(s || '').trim();
    if (!t) return '';
    if (t !== t.toLowerCase() && t !== t.toUpperCase()) return t;
    return t.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && /^(da|de|do|das|dos|e)$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
  };
  const vendDe = (p) => {
    const v = String((p && p.vendedora) || '').trim();
    if (v) return bonito(v);
    const por = String((p && p.por) || '').trim();
    return por && !LOGIN_GEN.test(por) ? bonito(por) : '';
  };
  const chaveV = (nome) => { const s = TS.norm ? TS.norm(nome || '') : String(nome || '').toLowerCase().trim(); return s || '__sem__'; };
  const listaVendedoras = (d) => {
    const m = new Map();
    const add = (n) => {
      const s = String(n || '').trim();
      if (!s || /^SEM VENDEDOR$|^COLEGA \d+$/i.test(s) || LOGIN_GEN.test(s)) return;
      const k = chaveV(s);
      if (k !== '__sem__' && !m.has(k)) m.set(k, bonito(s));
    };
    for (const n of (d && d.vendedoras) || []) add(n);
    for (const n of (TS.db && TS.db.D && TS.db.D.vendedor) || []) add(n);
    for (const p of (d && d.pedidos) || []) add(vendDe(p));
    if (TS.eu && TS.eu.vendedor) add(TS.eu.vendedor);
    return [...m.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  };
  const textoDe = (modelo, p, loja) => {
    const vars = { nome: primeiro(p.cliente.nome), produto: nomesItens(p), loja: loja || 'loja', vendedora: vendDe(p) || 'equipe' };
    return String(modelo || '').replace(/\{(nome|produto|loja|vendedora)\}/g, (_, k) => vars[k]);
  };

  async function api(metodo, url, corpo) {
    const r = await fetch(TS.api(url), { method: metodo, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não deu certo.');
    return j;
  }
  // apresentação: pedidos fictícios montados com os clientes e produtos da própria apresentação
  function demoDados() {
    const cl = (TS.cli && TS.cli.lista) || [], db = TS.db, hoje = Date.now();
    const prods = [...new Set(db.D.descricao.filter((d) => / \d+G$/i.test(d)))].slice(0, 12);
    const vends = ['Lyandra', 'Gabrielly', 'Camila'];
    const st = ['chegou', 'chegou', 'esperando', 'esperando', 'esperando', 'avisado', 'comprou', 'naocomprou', 'chegou', 'cancelado'];
    const pedidos = st.map((s, k) => {
      const c = cl[k * 7 % Math.max(1, cl.length)] || { nome: 'Cliente', celular: '62999990000', cpf: null };
      const criado = new Date(hoje - (12 - k) * 864e5).toISOString(), ch = new Date(hoje - (5 - (k % 4)) * 864e5).toISOString();
      const vd = vends[k % vends.length];
      return { id: 'd' + k, criadoEm: criado, por: 'vendedora', vendedora: vd, cliente: { cpf: c.cpf, nome: c.nome || 'Cliente', celular: c.celular || '62999990000' }, itens: [{ desc: prods[k % Math.min(3, Math.max(1, prods.length))] || 'African Sunset 100G', qtd: 1 }], obs: k === 2 ? 'Prefere 250g se tiver' : '', st: s,
        chegou: s !== 'esperando' ? { em: ch, nf: s === 'chegou' || s === 'avisado' ? '4512/1' : null, origem: 'nota', fornecedor: 'Tea Shop Franquias' } : null,
        avisado: ['avisado', 'comprou', 'naocomprou'].includes(s) ? { em: ch, por: 'vendedora', vendedora: vd } : null,
        compra: s === 'comprou' ? { data: TS.dayToIso(TS.todayDay() - 1), cupom: 8770, levou: true } : null, cancelado: s === 'cancelado' ? { em: ch, por: 'gerente' } : null };
    });
    return { pedidos, vendedoras: vends, modelo: 'Oi, {nome}! Tudo bem? Aqui é da {loja} 😊 O {produto} que você pediu chegou! Quando quiser, é só passar aqui que separamos para você.', dias: 7, podeModelo: true, lojaNome: 'Tea Shop Centro' };
  }
  async function buscar(loja) {
    if (TS.demo) return demoDados();
    const r = await fetch(TS.api(`espera?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha ao ler a lista de espera.');
    return j;
  }

  TS.pages.espera = function (root) {
    if (TS.subGrupo) root.append(TS.subGrupo('espera'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Lista de espera'),
      h('div', { class: 'page-sub' }, 'Cliente pediu um produto que acabou? Anote aqui. Quando a nota de entrada trouxer o produto, ele aparece em "Chegaram" com a mensagem pronta para o WhatsApp.'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'A lista de espera é de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'card' }, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Conferindo chegadas e compras…')))));
    root.append(corpo);
    const loja = state.loja;
    buscar(loja).then((d) => { if (corpo.isConnected) pintar(corpo, loja, d); }).catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  };

  function pintar(corpo, loja, d) {
    const repintar = () => pintar(corpo, loja, d);
    const conta = Object.fromEntries(Object.entries(ABAS).map(([k, [, sts]]) => [k, d.pedidos.filter((p) => sts.includes(p.st)).length]));
    const aba = ABAS[state.espAba] ? state.espAba : conta.avisar ? 'avisar' : 'esperando';
    const modo = MODOS.some(([, m]) => m === state.espModo) ? state.espModo : 'vendedora';
    state.espFechados = state.espFechados || {};
    // conversão: avisados nos últimos 90 dias que já encerraram (comprou ou não)
    const desde = Date.now() - 90 * 864e5;
    const enc = d.pedidos.filter((p) => p.avisado && Date.parse(p.avisado.em) >= desde && (p.st === 'comprou' || p.st === 'naocomprou'));
    const compraram = enc.filter((p) => p.st === 'comprou').length;
    const kpis = h('div', { class: 'grid g-kpi esp-kpis' },
      TS.kpi('Chegaram · avisar', fmt.int(conta.avisar), conta.avisar ? 'clientes para avisar' : 'ninguém para avisar'),
      TS.kpi('Esperando', fmt.int(conta.esperando), 'produto ainda não chegou'),
      TS.kpi('Avisados', fmt.int(conta.avisados), `aguardando compra (até ${d.dias} dias)`),
      TS.kpi('Voltaram para comprar', enc.length ? fmt.pct(compraram / enc.length, 0) : '—', enc.length ? `${fmt.int(compraram)} de ${fmt.int(enc.length)} avisados (90 dias)` : 'aparece depois dos primeiros avisos'));
    const novo = h('div');
    const btnNovo = h('button', { type: 'button', class: 'btn primary esp-novo-btn', onclick: () => { btnNovo.hidden = true; novo.replaceChildren(formNovo(loja, d, (p) => { d.pedidos.unshift(p); state.espAba = 'esperando'; repintar(); }, () => { btnNovo.hidden = false; novo.replaceChildren(); })); } }, '+ Anotar pedido');
    const abas = TS.seg(Object.entries(ABAS).map(([k, [t]]) => [`${t} (${fmt.int(conta[k])})`, k]), aba, (v) => { state.espAba = v; repintar(); });
    const segModo = TS.seg(MODOS, modo, (v) => { state.espModo = v; repintar(); });
    const baseAba = d.pedidos.filter((p) => ABAS[aba][1].includes(p.st));

    // resumo por vendedora na aba aberta (para as pílulas de filtro rápido)
    const porVendMap = new Map();
    for (const p of baseAba) {
      const nome = vendDe(p) || 'Sem vendedora', k = chaveV(vendDe(p));
      const g = porVendMap.get(k) || porVendMap.set(k, { k, nome, qtd: 0, chegou: 0 }).get(k);
      g.qtd++;
      if (p.st === 'chegou') g.chegou++;
    }
    const gruposVendPills = [...porVendMap.values()].sort((a, b) => (a.k === '__sem__') - (b.k === '__sem__') || b.chegou - a.chegou || b.qtd - a.qtd || a.nome.localeCompare(b.nome, 'pt-BR'));
    const vendFiltro = state.espVend && porVendMap.has(state.espVend) ? state.espVend : '';

    const pilulas = baseAba.length ? h('div', { class: 'esp-pilulas', role: 'group', 'aria-label': 'Filtrar por vendedora' },
      h('button', { type: 'button', class: 'esp-pil' + (!vendFiltro ? ' on' : ''), onclick: () => { state.espVend = ''; repintar(); } }, 'Todas ', h('b', null, fmt.int(baseAba.length))),
      ...gruposVendPills.map((g) => h('button', { type: 'button', class: 'esp-pil' + (vendFiltro === g.k ? ' on' : '') + (g.k === '__sem__' ? ' sem' : ''), onclick: () => { state.espVend = vendFiltro === g.k ? '' : g.k; repintar(); } },
        g.nome, ' ', h('b', null, fmt.int(g.qtd))))) : null;

    const inBusca = h('input', { class: 'f-input esp-busca', type: 'search', placeholder: 'Filtrar cliente, telefone ou produto…', value: state.espBusca || '', autocomplete: 'off' });
    const listaBox = h('div', { class: 'esp-lista' });

    const desenharLista = () => {
      const qRaw = String(state.espBusca || '').trim();
      const qn = TS.norm ? TS.norm(qRaw) : qRaw.toLowerCase(), qd = qRaw.replace(/\D/g, '');
      const filtrada = baseAba.filter((p) => {
        if (vendFiltro && chaveV(vendDe(p)) !== vendFiltro) return false;
        if (!qn && !qd) return true;
        const txtCli = (TS.norm ? TS.norm(p.cliente.nome || '') : String(p.cliente.nome || '').toLowerCase());
        const txtProds = p.itens.map((i) => (TS.norm ? TS.norm(i.desc || '') : String(i.desc || '').toLowerCase())).join(' ');
        const txtVend = chaveV(vendDe(p));
        const txtObs = TS.norm ? TS.norm(p.obs || '') : String(p.obs || '').toLowerCase();
        const cel = String(p.cliente.celular || '').replace(/\D/g, '');
        return (qn && (txtCli.includes(qn) || txtProds.includes(qn) || txtVend.includes(qn) || txtObs.includes(qn))) || (qd.length >= 2 && cel.includes(qd));
      });
      if (!baseAba.length) {
        listaBox.replaceChildren(TS.empty({ avisar: 'Nenhum produto chegou para quem está esperando.', esperando: 'Ninguém esperando. Use "+ Anotar pedido" quando um cliente pedir algo que acabou.', avisados: 'Ninguém avisado aguardando compra.', encerrados: 'Nada encerrado ainda.' }[aba]));
        return;
      }
      if (!filtrada.length) {
        listaBox.replaceChildren(TS.empty('Nenhum pedido combina com este filtro.'));
        return;
      }
      if (modo === 'vendedora') {
        const gm = new Map();
        for (const p of filtrada) {
          const nome = vendDe(p) || 'Sem vendedora', k = chaveV(vendDe(p));
          const g = gm.get(k) || gm.set(k, { k, nome, itens: [], chegou: 0, prods: new Map() }).get(k);
          g.itens.push(p);
          if (p.st === 'chegou') g.chegou++;
          for (const it of p.itens) g.prods.set(it.desc, (g.prods.get(it.desc) || 0) + 1);
        }
        const grupos = [...gm.values()].sort((a, b) => (a.k === '__sem__') - (b.k === '__sem__') || b.chegou - a.chegou || b.itens.length - a.itens.length || a.nome.localeCompare(b.nome, 'pt-BR'));
        listaBox.replaceChildren(...grupos.map((g) => {
          const chKey = `v:${aba}:${g.k}`;
          const topProds = [...g.prods.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([pr, n]) => (n > 1 ? `${pr} (${n})` : pr)).join(' · ');
          const ini = g.k === '__sem__' ? '?' : (g.nome[0] || '?').toUpperCase();
          const det = h('details', { class: 'esp-grupo' + (g.k === '__sem__' ? ' esp-grupo-sem' : ''), open: !state.espFechados[chKey] || null },
            h('summary', { class: 'esp-grupo-cab' },
              h('div', { class: 'esp-grupo-esq' },
                h('span', { class: 'esp-ini' }, ini),
                h('b', { class: 'esp-grupo-nome' }, g.nome),
                h('span', { class: 'esp-grupo-qtd' }, `${fmt.int(g.itens.length)} ${g.itens.length === 1 ? 'pedido' : 'pedidos'}`),
                g.chegou && aba !== 'avisar' ? h('span', { class: 'esp-st esp-chegou' }, `${fmt.int(g.chegou)} ${g.chegou === 1 ? 'chegou' : 'chegaram'}`) : null),
              topProds ? h('span', { class: 'esp-grupo-resumo muted' }, topProds) : null),
            h('div', { class: 'esp-grupo-corpo' }, ...g.itens.map((p) => cartao(p, loja, d, repintar, true))));
          det.addEventListener('toggle', () => { state.espFechados[chKey] = !det.open; });
          return det;
        }));
      } else if (modo === 'produto') {
        const pm = new Map();
        for (const p of filtrada) {
          for (const it of p.itens) {
            const k = TS.norm ? TS.norm(it.desc) : String(it.desc || '').toLowerCase();
            const g = pm.get(k) || pm.set(k, { k, nome: it.desc, pedidos: [], unid: 0, vends: new Set() }).get(k);
            if (!g.pedidos.includes(p)) g.pedidos.push(p);
            g.unid += Number(it.qtd) || 1;
            const vn = vendDe(p); if (vn) g.vends.add(vn);
          }
        }
        const grupos = [...pm.values()].sort((a, b) => b.pedidos.length - a.pedidos.length || b.unid - a.unid || a.nome.localeCompare(b.nome, 'pt-BR'));
        listaBox.replaceChildren(...grupos.map((g) => {
          const chKey = `p:${aba}:${g.k}`;
          const vTxt = [...g.vends].slice(0, 4).join(', ');
          const det = h('details', { class: 'esp-grupo esp-grupo-prod', open: !state.espFechados[chKey] || null },
            h('summary', { class: 'esp-grupo-cab' },
              h('div', { class: 'esp-grupo-esq' },
                h('b', { class: 'esp-grupo-nome' }, g.nome),
                h('span', { class: 'esp-grupo-qtd' }, `${fmt.int(g.pedidos.length)} ${g.pedidos.length === 1 ? 'cliente' : 'clientes'}${g.unid > g.pedidos.length ? ` · ${fmt.int(g.unid)} un.` : ''}`)),
              vTxt ? h('span', { class: 'esp-grupo-resumo muted' }, `Vendedoras: ${vTxt}`) : null),
            h('div', { class: 'esp-grupo-corpo' }, ...g.pedidos.map((p) => cartao(p, loja, d, repintar, false))));
          det.addEventListener('toggle', () => { state.espFechados[chKey] = !det.open; });
          return det;
        }));
      } else {
        listaBox.replaceChildren(...filtrada.map((p) => cartao(p, loja, d, repintar, false)));
      }
    };

    inBusca.addEventListener('input', () => { state.espBusca = inBusca.value; desenharLista(); });
    desenharLista();

    corpo.replaceChildren(kpis,
      h('div', { class: 'esp-topo mt' }, btnNovo, d.podeModelo ? modeloMsg(loja, d, repintar) : null), novo,
      h('div', { class: 'card mt' },
        h('div', { class: 'esp-cab-painel' }, h('div', { class: 'esp-abas' }, abas), baseAba.length ? h('div', { class: 'esp-modo' }, segModo) : null),
        baseAba.length ? h('div', { class: 'esp-barra' }, pilulas, inBusca) : null,
        listaBox,
        aba === 'encerrados' ? porQuem(d) : null));
  }

  /** um pedido: cliente, produtos, situação, vendedora e o que fazer */
  function cartao(p, loja, d, repintar, dentroGrupoVend) {
    const [stTxt, stCls] = ST[p.st];
    const vNome = vendDe(p);
    const fazer = async (acao, conf, extra) => {
      if (conf && !confirm(conf)) return;
      if (TS.demo) { TS.avisar('Na apresentação nada é salvo.'); return; }
      try { const r = await api('POST', `espera/${p.id}/${acao}`, { loja, ...(extra || {}) }); Object.assign(p, r.pedido); repintar(); } catch (e) { TS.avisarErro(e); }
    };
    const msg = h('textarea', { class: 'f-input esp-msg', rows: 2 }, textoDe(d.modelo, p, d.lojaNome));
    const linkW = () => wpp(p.cliente.celular, msg.value);
    const btnW = (rot) => h('a', { class: 'btn primary esp-wpp', href: '#', onclick: (e) => {
      e.preventDefault();
      const u = linkW();
      if (!u) { TS.avisar('Este cliente está sem celular válido. Corrija o celular no cadastro do AppNext para avisar pelo WhatsApp.'); return; }
      if (!TS.demo) window.open(u, '_blank', 'noopener');
      fazer('avisado', null, vNome ? { vendedora: vNome } : null);
    } }, rot);
    const quemAvisou = (p.avisado && bonito(p.avisado.vendedora || (!LOGIN_GEN.test(p.avisado.por || '') ? p.avisado.por : ''))) || vNome || (p.avisado && p.avisado.por) || '—';
    const sit = p.st === 'chegou' ? `Chegou ${dataTxt(p.chegou.em)}${p.chegou.nf ? ` na NF ${p.chegou.nf}${p.chegou.veio ? ` (${p.chegou.veio})` : ''}` : p.chegou.origem === 'estoque' ? ' (estoque voltou)' : ' (marcado à mão)'}`
      : p.st === 'esperando' ? `Esperando há ${Math.max(0, Math.round((Date.now() - Date.parse(p.criadoEm)) / 864e5))}d`
        : p.st === 'avisado' ? `Avisado ${quandoTxt(p.avisado.em)} por ${quemAvisou} · ${p.cliente.cpf ? `confere compra até ${dataTxt(new Date(Date.parse(p.avisado.em) + d.dias * 864e5).toISOString())}` : 'sem CPF p/ conferir compra'}`
          : p.st === 'comprou' ? `Comprou em ${fmt.date(p.compra.data)}${p.compra.cupom ? ` (cupom ${p.compra.cupom})` : p.compra.fixe ? ' (FIXE)' : ''} · ${p.compra.levou ? 'levou o produto ✓' : 'comprou outro item'}`
            : p.st === 'naocomprou' ? `Não comprou em ${d.dias} dias após aviso de ${dataTxt(p.avisado && p.avisado.em)}`
              : `Cancelado ${dataTxt(p.cancelado && p.cancelado.em)} por ${(p.cancelado && p.cancelado.por) || '—'}`;
    const acoes = p.st === 'chegou' ? [btnW('Avisar no WhatsApp ›'), h('button', { type: 'button', class: 'btn', onclick: () => fazer('cancelar', 'Cancelar este pedido da lista de espera?') }, 'Cancelar')]
      : p.st === 'esperando' ? [h('button', { type: 'button', class: 'btn', title: 'Use se o produto chegou e a nota ainda não apareceu no painel', onclick: () => fazer('chegou') }, 'Já chegou'), h('button', { type: 'button', class: 'btn', onclick: () => fazer('cancelar', 'Cancelar este pedido da lista de espera?') }, 'Cancelar')]
        : p.st === 'avisado' ? [h('a', { class: 'btn', href: TS.demo ? '#' : (wpp(p.cliente.celular, '') || '#'), target: TS.demo ? null : '_blank', rel: TS.demo ? null : 'noopener', onclick: TS.demo ? (e) => { e.preventDefault(); TS.avisar('Na apresentação nada é enviado.'); } : null }, 'Abrir conversa'), h('button', { type: 'button', class: 'btn', onclick: () => fazer('cancelar', 'Cancelar este pedido?') }, 'Cancelar')]
          : p.st === 'naocomprou' || p.st === 'cancelado' ? [h('button', { type: 'button', class: 'btn', onclick: () => fazer('reabrir') }, 'Reabrir')] : [];

    // seletor discreto para definir/trocar a vendedora do pedido quando necessário
    const vendsLoja = listaVendedoras(d);
    const vendWrap = h('span', { class: 'esp-vend-wrap' });
    const abrirTrocaVend = () => {
      const opcoes = [...new Set([...(vNome ? [vNome] : []), ...vendsLoja])];
      const sel = h('select', { class: 'f-input esp-vend-sel', 'aria-label': 'Vendedora do pedido' },
        h('option', { value: '' }, 'Sem vendedora'),
        ...opcoes.map((n) => h('option', { value: n, selected: chaveV(n) === chaveV(vNome) || null }, n)));
      sel.addEventListener('change', () => fazer('vendedora', null, { vendedora: sel.value }));
      sel.addEventListener('blur', () => setTimeout(() => { if (vendWrap.isConnected) pintarTagVend(); }, 150));
      vendWrap.replaceChildren(sel);
      sel.focus();
    };
    const pintarTagVend = () => {
      if (dentroGrupoVend && vNome) {
        vendWrap.replaceChildren(h('button', { type: 'button', class: 'link-btn esp-trocar-vend', title: 'Trocar a vendedora deste pedido', onclick: abrirTrocaVend }, 'trocar vendedora'));
      } else {
        vendWrap.replaceChildren(h('button', { type: 'button', class: 'esp-vend-tag' + (!vNome ? ' sem' : ''), title: 'Clique para definir ou trocar a vendedora', onclick: abrirTrocaVend }, vNome || 'Definir vendedora'));
      }
    };
    pintarTagVend();

    const autorExtra = p.por && !LOGIN_GEN.test(p.por) && (!vNome || chaveV(p.por) !== chaveV(vNome)) ? ` (${p.por})` : '';
    const estInfo = p.st === 'esperando'
      ? (p.estoqueCods && p.estoqueCods.length
        ? h('span', { title: 'Quando uma nota de entrada trouxer este item, o pedido passa para "Chegaram"' }, ` · Estoque: ${(p.estoqueNomes || p.estoqueCods).join(', ')}`)
        : TS.demo ? null : h('span', { class: 'esp-aviso-inline' }, ' · Não achei no estoque (use "Já chegou")'))
      : null;

    const corpoItem = h('div', { class: 'esp-corpo' },
      h('div', { class: 'esp-cab' },
        h('div', { class: 'esp-cli-linha' },
          h('b', { class: 'esp-nome' }, p.cliente.nome),
          h('small', { class: 'muted' }, ` ${telTxt(p.cliente.celular)}`),
          p.cliente.cpf && TS.cliApi && TS.cli ? h('button', { type: 'button', class: 'cpf-link esp-ficha', onclick: () => TS.cliApi.abrirClientes([p.cliente.cpf]) }, 'ver ficha') : null),
        h('div', { class: 'esp-tags-dir' }, !dentroGrupoVend || !vNome ? vendWrap : null, h('span', { class: 'esp-st ' + stCls }, stTxt))),
      h('div', { class: 'esp-meio' },
        h('span', { class: 'esp-prod' }, nomesItens(p)),
        h('span', { class: 'esp-sit' }, ' · ' + sit),
        p.obs ? h('span', { class: 'esp-obs' }, ` · “${p.obs}”`) : null),
      h('div', { class: 'esp-meta muted' },
        `Anotado ${quandoTxt(p.criadoEm)}${vNome ? ` por ${vNome}` : ''}${autorExtra}`,
        estInfo,
        dentroGrupoVend && vNome ? [' · ', vendWrap] : null));

    return h('div', { class: 'esp-item ' + stCls },
      p.st === 'chegou'
        ? [corpoItem, msg, acoes.length ? h('div', { class: 'esp-acoes' }, ...acoes) : null]
        : h('div', { class: 'esp-linha' }, corpoItem, acoes.length ? h('div', { class: 'esp-acoes esp-acoes-dir' }, ...acoes) : null));
  }

  /** conversão por vendedora (encerrados) */
  function porQuem(d) {
    const m = new Map();
    for (const p of d.pedidos) {
      if (p.avisado && (p.st === 'comprou' || p.st === 'naocomprou')) {
        const nome = bonito(p.avisado.vendedora || vendDe(p) || p.avisado.por || '') || 'Sem vendedora';
        const k = chaveV(nome);
        const a = m.get(k) || m.set(k, { quem: nome, avisou: 0, voltou: 0 }).get(k);
        a.avisou++;
        if (p.st === 'comprou') a.voltou++;
      }
    }
    if (!m.size) return null;
    return h('div', { class: 'mt' }, h('div', { class: 'f-label' }, 'Conversão por vendedora (avisados e quantos compraram)'), TS.table({
      cols: [{ key: 'quem', label: 'Vendedora', align: 'l' }, { key: 'avisou', label: 'Avisados', fmt: fmt.int }, { key: 'voltou', label: 'Compraram', fmt: fmt.int }, { key: 'pct', label: 'Conversão', fmt: (v) => fmt.pct(v, 0) }],
      rows: [...m.values()].map((x) => ({ ...x, pct: x.voltou / x.avisou })), sortKey: 'avisou',
    }));
  }

  /** mensagem padrão da loja (admin, franqueado e gerente) */
  function modeloMsg(loja, d, repintar) {
    const ta = h('textarea', { class: 'f-input', rows: 3 }, d.modelo);
    const det = h('details', { class: 'esp-modelo' }, h('summary', null, 'Mensagem padrão'),
      h('small', { class: 'muted' }, 'Campos: {nome} primeiro nome · {produto} o que pediu · {loja} · {vendedora}'), ta,
      h('button', { type: 'button', class: 'btn', onclick: async () => {
        if (TS.demo) { TS.avisar('Na apresentação nada é salvo.'); return; }
        try { const r = await api('PUT', 'espera/modelo', { loja, modelo: ta.value }); d.modelo = r.modelo; repintar(); } catch (e) { TS.avisarErro(e); }
      } }, 'Salvar mensagem'));
    return det;
  }

  /** formulário: cliente (da base ou novo), produtos (com o tamanho), vendedora e observação */
  function formNovo(loja, d, aoSalvar, aoFechar) {
    const f = { cliente: null, itens: [], obs: '' };
    // ---- cliente
    const buscaCli = h('input', { class: 'f-input', type: 'search', placeholder: 'Nome, CPF ou celular do cliente', autocomplete: 'off' });
    const sugCli = h('div', { class: 'cp-sug', hidden: true });
    const escolhido = h('div', { class: 'esp-cli-esc', hidden: true });
    const novoBox = h('div', { class: 'esp-cli-novo', hidden: true });
    const nNome = h('input', { class: 'f-input', placeholder: 'Nome' }), nCel = h('input', { class: 'f-input', placeholder: 'Celular com DDD', inputmode: 'tel' }), nCpf = h('input', { class: 'f-input', placeholder: 'CPF (opcional)', inputmode: 'numeric' });
    novoBox.append(nNome, nCel, nCpf, h('small', { class: 'muted' }, 'Com o CPF o painel consegue saber se o cliente voltou para comprar.'));
    const escolher = (c) => {
      f.cliente = c; buscaCli.value = ''; sugCli.hidden = true; buscaCli.parentNode.hidden = true; novoBox.hidden = true;
      escolhido.replaceChildren(...[h('b', null, c.nome), h('small', { class: 'muted' }, ` ${telTxt(c.celular)}${c.cpf ? ' · CPF ' + String(c.cpf).replace(/^(\d{3})\d{6}(\d{2})$/, '$1.***.***-$2') : ''}`),
        !c.celular || c.celular.length < 10 ? h('div', { class: 'esp-aviso' }, 'Sem celular no cadastro: ', (() => { const i = h('input', { class: 'f-input', placeholder: 'Celular com DDD', inputmode: 'tel' }); i.addEventListener('input', () => { f.cliente.celular = i.value.replace(/\D/g, ''); }); return i; })()) : null,
        h('button', { type: 'button', class: 'link-btn', onclick: () => { f.cliente = null; escolhido.hidden = true; buscaCli.parentNode.hidden = false; buscaCli.focus(); } }, 'trocar')].filter(Boolean));
      escolhido.hidden = false;
    };
    let tCli;
    buscaCli.addEventListener('input', () => {
      clearTimeout(tCli);
      const q = buscaCli.value.trim();
      if (q.length < 3) { sugCli.hidden = true; return; }
      tCli = setTimeout(async () => {
        let lista = [], dica = '';
        if (TS.demo) { const qn = TS.norm(q); lista = ((TS.cli && TS.cli.lista) || []).filter((c) => TS.norm(c.nome).includes(qn) || c.cpf.startsWith(q.replace(/\D/g, '') || '#')).slice(0, 8).map((c) => ({ cpf: c.cpf, nome: c.nome, celular: c.celular })); }
        else { try { const j = await (await fetch(TS.api(`espera/clientes?loja=${encodeURIComponent(loja)}&q=${encodeURIComponent(q)}`), { credentials: 'same-origin' })).json(); lista = j.clientes || []; dica = j.dica || j.erro || ''; } catch { lista = []; } }
        sugCli.replaceChildren(dica ? h('small', { class: 'muted cp-sug-dica' }, dica) : '', ...lista.map((c) => h('button', { type: 'button', class: 'cp-sug-it', onmousedown: (e) => { e.preventDefault(); escolher(c); } }, h('span', null, c.nome || '(sem nome)'), h('small', null, telTxt(c.celular) || 'sem celular'))),
          h('button', { type: 'button', class: 'cp-sug-it cp-sug-todos', onmousedown: (e) => { e.preventDefault(); sugCli.hidden = true; novoBox.hidden = false; nNome.value = /\d/.test(q) ? '' : q; if (/\d{10,}/.test(q.replace(/\D/g, '')) && q.replace(/\D/g, '').length <= 11 && !/^\d{11}$/.test(q)) nCel.value = q; nNome.focus(); } }, h('span', null, 'Cliente novo (não está na base)'), h('small', null, 'nome e celular')));
        sugCli.hidden = false;
      }, 250);
    });
    buscaCli.addEventListener('blur', () => setTimeout(() => { sugCli.hidden = true; }, 150));
    // ---- produtos
    const buscaP = h('input', { class: 'f-input', type: 'search', placeholder: 'Produto com o tamanho: african 100, earl grey 250…', autocomplete: 'off' });
    const sugP = h('div', { class: 'cp-sug esp-sug-p', hidden: true });
    const chips = h('div', { class: 'cp-prod-chips' });
    const pintarChips = () => chips.replaceChildren(...f.itens.map((it) => h('span', { class: 'cp-prod-chip esp-chip' },
      h('button', { type: 'button', 'aria-label': 'menos', onclick: () => { it.qtd = Math.max(1, it.qtd - 1); pintarChips(); } }, '−'), h('b', null, `${it.qtd}×`),
      h('button', { type: 'button', 'aria-label': 'mais', onclick: () => { it.qtd = Math.min(99, it.qtd + 1); pintarChips(); } }, '＋'),
      h('span', null, it.desc, it.generico ? h('em', null, ' · qualquer tamanho') : null), it.falta === false ? h('small', { class: 'esp-tem', title: 'O estoque do painel mostra este produto disponível' }, 'tem no estoque') : null,
      h('button', { type: 'button', 'aria-label': 'Tirar', onclick: () => { f.itens = f.itens.filter((x) => x !== it); pintarChips(); } }, '✕'))));
    let tP;
    buscaP.addEventListener('input', () => {
      clearTimeout(tP);
      const q = buscaP.value.trim();
      if (q.length < 2) { sugP.hidden = true; return; }
      tP = setTimeout(async () => {
        let lista = [];
        if (TS.demo) {
          const qn = TS.norm(q), descs = [...new Set(TS.db.D.descricao)].filter((x) => x && TS.norm(x).includes(qn));
          const bases = [...new Set(descs.filter((x) => / \d+ ?G$/i.test(x)).map((x) => x.replace(/\s*\d+\s*G$/i, '')))].slice(0, 3);
          lista = [...bases.map((x) => ({ desc: x, cod: null, generico: true, falta: true })), ...descs.slice(0, 9).map((x) => ({ desc: x, cod: null, vendidos: 0, falta: null }))];
        }
        else { try { lista = (await (await fetch(TS.api(`espera/produtos?loja=${encodeURIComponent(loja)}&q=${encodeURIComponent(q)}`), { credentials: 'same-origin' })).json()).produtos || []; } catch { lista = []; } }
        const add = (x) => { if (!f.itens.some((i) => i.desc === x.desc)) f.itens.push({ desc: x.desc, cod: x.cod, qtd: 1, falta: x.falta, generico: !!x.generico }); buscaP.value = ''; sugP.hidden = true; pintarChips(); buscaP.focus(); };
        sugP.replaceChildren(...[...lista.map((x) => h('button', { type: 'button', class: 'cp-sug-it' + (x.generico ? ' esp-sug-gen' : ''), onmousedown: (e) => { e.preventDefault(); add(x); } },
          h('span', null, x.desc, x.generico ? h('em', null, ' · qualquer tamanho') : null), h('small', null, [x.falta === true ? 'em falta' : x.falta === false ? 'tem no estoque' : '', x.vendidos ? `${fmt.int(x.vendidos)} vendidos` : ''].filter(Boolean).join(' · ')))),
        h('button', { type: 'button', class: 'cp-sug-it cp-sug-todos', onmousedown: (e) => { e.preventDefault(); add({ desc: q, cod: null, generico: true }); } }, h('span', null, `Anotar "${q}" como o cliente falou`), h('small', null, 'o painel procura no estoque pelo nome'))].filter(Boolean));
        sugP.hidden = false;
      }, 250);
    });
    buscaP.addEventListener('blur', () => setTimeout(() => { sugP.hidden = true; }, 150));
    const obs = h('input', { class: 'f-input', placeholder: 'Ex.: prefere 250 g, só depois do dia 20…' });
    // vendedora: todas as vendedoras da loja (lembra a última escolhida na sessão para anotar vários seguidos)
    const vendNomes = listaVendedoras(d);
    let salvoVend = '';
    try { salvoVend = sessionStorage.getItem('esp.vend.' + loja) || ''; } catch { /* ok */ }
    const euVend = TS.eu && TS.eu.vendedor ? bonito(TS.eu.vendedor) : '';
    const padraoVend = vendNomes.find((n) => chaveV(n) === chaveV(salvoVend)) || vendNomes.find((n) => chaveV(n) === chaveV(euVend)) || '';
    const vendOutra = h('input', { class: 'f-input', placeholder: 'Nome da vendedora', hidden: vendNomes.length > 0 });
    const vend = h('select', { class: 'f-input' },
      h('option', { value: '' }, vendNomes.length ? 'Escolha a vendedora…' : 'Digitar abaixo…'),
      ...vendNomes.map((n) => h('option', { value: n, selected: n === padraoVend || null }, n)),
      h('option', { value: '__outra__' }, '+ Outra vendedora…'));
    vend.addEventListener('change', () => { vendOutra.hidden = vend.value !== '__outra__'; if (!vendOutra.hidden) vendOutra.focus(); });
    const erro = h('div', { class: 'neg esp-erro' });
    const salvar = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
      erro.textContent = '';
      const cli = f.cliente || (!novoBox.hidden ? { nome: nNome.value.trim(), celular: nCel.value.replace(/\D/g, ''), cpf: nCpf.value.replace(/\D/g, '') || null } : null);
      if (!cli || !cli.nome) { erro.textContent = 'Escolha o cliente (ou "Cliente novo").'; return; }
      if (!f.itens.length) { erro.textContent = 'Escolha pelo menos um produto.'; return; }
      const vFinal = (vend.value === '__outra__' || !vendNomes.length ? vendOutra.value : vend.value).trim();
      if (vendNomes.length && !vFinal) { erro.textContent = 'Escolha a vendedora que atendeu o cliente.'; return; }
      if (TS.demo) { erro.textContent = 'Na apresentação nada é salvo.'; return; }
      salvar.disabled = true;
      try {
        const r = await api('POST', 'espera', { loja, cliente: cli, itens: f.itens.map(({ desc, cod, qtd, generico }) => ({ desc, cod, qtd, generico })), obs: obs.value, vendedora: vFinal });
        if (vFinal) { try { sessionStorage.setItem('esp.vend.' + loja, vFinal); } catch { /* ok */ } }
        aoSalvar(r.pedido);
      } catch (e) { erro.textContent = e.message; salvar.disabled = false; }
    } }, 'Salvar na lista de espera');
    return h('div', { class: 'card esp-form mt' },
      h('div', { class: 'card-title' }, 'Anotar pedido'),
      h('div', { class: 'esp-campo' }, h('span', { class: 'f-label' }, 'Cliente'), h('div', { class: 'cp-prod-campo' }, buscaCli, sugCli), escolhido, novoBox),
      h('div', { class: 'esp-campo' }, h('span', { class: 'f-label' }, 'Produtos'), chips, h('div', { class: 'cp-prod-campo' }, buscaP, sugP)),
      h('div', { class: 'esp-campo esp-dupla' },
        h('label', { class: 'esp-campo' }, h('span', { class: 'f-label' }, 'Vendedora'), vend, vendOutra),
        h('label', { class: 'esp-campo' }, h('span', { class: 'f-label' }, 'Observação (opcional)'), obs)),
      erro,
      h('div', { class: 'esp-acoes' }, salvar, h('button', { type: 'button', class: 'btn', onclick: aoFechar }, 'Fechar')));
  }

  // aviso no Início e número no menu: quantos produtos chegaram para quem está esperando
  TS.esperaResumo = async function () {
    if (!state.loja || state.loja === 'todas' || TS.demo) return null;
    try { const d = await buscar(state.loja); return { chegou: d.pedidos.filter((p) => p.st === 'chegou').length, esperando: d.pedidos.filter((p) => p.st === 'esperando').length }; } catch { return null; }
  };
})();
