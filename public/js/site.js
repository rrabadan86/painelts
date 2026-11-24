/* Produtos → Site: preços do e-commerce (www.teashop.com.br) × os preços praticados nas lojas.
 * - Site: o catálogo público é lido todo dia às 10h (e em "Consultar agora"): produto, variante, preço, preço "de"
 *   (promoção) e o link.
 * - Nosso preço: o preço de tabela mais vendido nas últimas 4 semanas com venda (o mesmo "preço praticado" da tela Preços).
 * - Casamento: pelo SKU = código do produto; senão pelo nome (sem "Chá Branco", "Infusão"…) e pelo tamanho (50g, 100g…).
 * Situação: em promoção no site (tem preço "de"), preço cheio diferente do nosso, igual, ou sem correspondência. */
(function () {
  const { h, fmt, state } = TS;

  const comTabela = (d) => ({ ...d, tabela: Array.isArray(d.tabela) && d.tabela.length ? new Map(d.tabela.map((t) => [t.cod, t])) : null });
  async function buscar() {
    const loja = state.loja && state.loja !== 'todas' ? state.loja : '';
    const r = await fetch(TS.api(`site${loja ? '?loja=' + encodeURIComponent(loja) : ''}`), { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha ao ler os preços do site.');
    return j;
  }

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // palavras de tipo que o site põe no nome e as vendas não ("Chá Branco Watermelon Paradise - Tea Shop")
  const TIPO = new Set(['cha', 'chas', 'infusao', 'infusoes', 'tea', 'shop', 'de', 'do', 'da', 'dos', 'das', 'com', 'e', 'o', 'a', 'branco', 'verde', 'preto', 'vermelho', 'oolong', 'puro', 'gr', 'g', 'kg', 'grs', 'gramas', 'un', 'und', 'unidade', 'tamanho', 'lata', 'refil']);
  const gramas = (s) => {
    const m = norm(s).match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|grs|gramas)\b/);
    if (!m) return null;
    const v = parseFloat(m[1].replace(',', '.'));
    return Math.round(m[2] === 'kg' ? v * 1000 : v);
  };
  const tokens = (s) => norm(s).replace(/\b\d+(?:\s*(kg|g|gr|grs|gramas))\b/g, ' ').split(' ').filter((t) => t && !TIPO.has(t));
  const semZeros = (c) => String(c || '').trim().replace(/^0+/, '');

  /** nossos produtos: preço de tabela mais vendido nas últimas 4 semanas com venda de cada produto */
  function nossos(tabela) {
    const db = TS.db, I = TS.rules.ids;
    const prods = new Map();
    for (let i = 0; i < db.n; i++) {
      if (I.taxas.has(db.desc[i]) || I.eg.has(db.cat[i]) || !(db.qtd[i] > 0) || !(db.vu[i] > 0)) continue;
      const nome = db.D.descricao[db.desc[i]];
      let p = prods.get(nome);
      if (!p) { p = { nome, cod: db.D.cod ? String(db.D.cod[db.cod[i]] || '') : '', ult: -Infinity, vendas: [] }; prods.set(nome, p); }
      p.vendas.push(i);
      if (db.day[i] > p.ult) p.ult = db.day[i];
    }
    const out = [];
    for (const p of prods.values()) {
      const cont = new Map();
      for (const i of p.vendas) {
        if (db.day[i] < p.ult - 27) continue;
        const k = Math.round(db.vu[i] * 100) / 100;
        cont.set(k, (cont.get(k) || 0) + db.qtd[i]);
      }
      let preco = null, n = -1;
      for (const [k, q] of cont) if (q > n || (q === n && k > preco)) { preco = k; n = q; }
      const tab = tabela && p.cod ? tabela.get(p.cod) : null;
      out.push({ nome: p.nome, cod: p.cod, preco: tab ? tab.preco : preco, fonte: tab ? 'cadastro' : 'vendas', ult: p.ult, tok: new Set(tokens(p.nome)), g: gramas(p.nome) });
    }
    // produtos do cadastro que não venderam: entram com o preço de tabela
    if (tabela) {
      const ja = new Set(out.map((p) => p.cod));
      for (const t of tabela.values()) if (!ja.has(t.cod)) out.push({ nome: t.desc, cod: t.cod, preco: t.preco, fonte: 'cadastro', ult: null, tok: new Set(tokens(t.desc)), g: gramas(t.desc) });
    }
    return out;
  }

  /** casa cada variante do site com um produto nosso */
  function casar(itens, nos) {
    const porCod = new Map(nos.filter((p) => p.cod).map((p) => [semZeros(p.cod), p]));
    const porTok = new Map();
    for (const p of nos) for (const t of p.tok) (porTok.get(t) || porTok.set(t, []).get(t)).push(p);
    return itens.map((x) => {
      let m = x.sku ? porCod.get(semZeros(x.sku)) : null, como = m ? 'sku' : '';
      if (!m) {
        const tk = [...new Set(tokens(x.produto + ' ' + x.variante))];
        const g = gramas(x.variante) || gramas(x.produto);
        if (tk.length) {
          const cand = new Set(porTok.get(tk[0]) || []);
          let best = null, bs = 0;
          for (const p of cand) {
            if (!tk.every((t) => p.tok.has(t))) continue; // todas as palavras do nome do site no nosso nome
            if (g && p.g && g !== p.g) continue;
            if (g && !p.g) continue;
            const sc = tk.length / p.tok.size + ((p.ult || 0) / 1e6);
            if (sc > bs) { bs = sc; best = p; }
          }
          if (best) { m = best; como = 'nome'; }
        }
      }
      return { ...x, nos: m || null, como };
    });
  }

  /** apresentação: preços do site parecidos com os da loja, com algumas promoções e diferenças */
  function demoItens(nos) {
    const out = [];
    nos.filter((p) => p.preco && p.preco > 20).slice(0, 160).forEach((p, k) => {
      const r = (k * 37) % 100;
      const cheio = r < 15 ? Math.round(p.preco * 1.08 * 10) / 10 : p.preco;
      const de = r >= 60 && r < 85 ? cheio : null;
      out.push({ id: 'd' + k, produto: 'Chá ' + p.nome, variante: '', sku: r < 50 ? p.cod : '', tipo: '', preco: de ? Math.round(cheio * 0.7 * 100) / 100 : cheio, de, disponivel: r % 9 !== 0, url: '#' });
    });
    out.push({ id: 'dx', produto: 'Kit Presente Natal (só no site)', variante: '', sku: '', preco: 189.9, de: null, disponivel: true, url: '#' });
    return out;
  }

  TS.pages.site = function (root) {
    if (TS.subEstoque) root.append(TS.subEstoque('site'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Site'),
      h('div', { class: 'page-sub' }, 'Preços do e-commerce (teashop.com.br) comparados com os preços praticados nas lojas · consulta todo dia às 10h'))));
    const corpo = h('div', null, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Lendo os preços do site…'))));
    root.append(corpo);
    // com uma loja escolhida, "nosso preço" é o preço de tabela do cadastro do AppNext (vem junto, sem custos)
    buscar().then((d) => { if (corpo.isConnected) pintar(corpo, comTabela(d)); }).catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  };

  function pintar(corpo, d) {
    corpo.replaceChildren();
    const nos = nossos(d.tabela);
    const itensSite = d.demo ? demoItens(nos) : d.itens || [];
    const lojaTxt = state.loja && state.loja !== 'todas' ? 'desta loja' : 'das lojas';
    // topo: última consulta e "Consultar agora"
    const msg = h('span', { class: 'muted' });
    const btn = d.podeConsultar ? h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
      btn.disabled = true; btn.textContent = 'Consultando…'; msg.className = 'muted'; msg.textContent = 'Lendo todos os produtos do site (leva alguns segundos)…';
      try {
        const r = await fetch(TS.api('site/consultar'), { method: 'POST', credentials: 'same-origin', headers: { 'X-Painel': '1' } });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Não consegui consultar o site.');
        if (TS.foto) TS.foto.limpar(); // as fotos dos produtos vêm desta consulta: as listas buscam de novo
        pintar(corpo, comTabela(await buscar()));
      } catch (e) { btn.disabled = false; btn.textContent = 'Consultar agora'; msg.className = 'neg'; msg.textContent = e.message; }
    } }, d.rodando ? 'Consultando…' : 'Consultar agora') : null;
    if (btn && d.rodando) btn.disabled = true;
    const quando = d.em ? new Date(d.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;
    corpo.append(h('div', { class: 'site-topo' },
      h('span', null, quando ? h('span', null, 'Última consulta: ', h('b', null, quando), ` (${d.origem === 'manual' ? `manual${d.quem ? ' · ' + d.quem : ''}` : 'automática das 10h'})`) : 'O site ainda não foi consultado.'),
      btn, msg));
    if (d.erro && (!d.em || Date.parse(d.erro.em) > Date.parse(d.em))) corpo.append(h('div', { class: 'notice err' }, `A última tentativa (${new Date(d.erro.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}) falhou: ${d.erro.msg}. ${d.em ? 'Os preços abaixo são da consulta anterior.' : ''}`));
    if (d.demo) corpo.append(h('div', { class: 'notice' }, 'Na apresentação os preços do site são fictícios, montados a partir das vendas.'));
    if (!itensSite.length) { if (!d.erro) corpo.append(TS.empty(d.podeConsultar ? 'Ainda não há preços do site: clique em "Consultar agora" ou espere a consulta das 10h.' : 'Ainda não há preços do site: a consulta automática é às 10h.')); return; }

    if (d.demo && !d.historico) demoHistorico(d, itensSite);
    // filtro "Mudou em" (só durante a visita): '' = qualquer dia; senão AAAA-MM-DD (horário de Brasília)
    const SD = TS.siteDia, hoje = TS.hojeSP(), ontem = SD.diaAntes(hoje);
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(state.siteDia || '') ? state.siteDia : '';
    const diasCons = SD.diasDeConsulta(d.consultas, d.historico);
    const sitDia = SD.situacaoDia(dia, diasCons, d.consultasDesde, hoje);
    const ant = (d.anterior && d.anterior.precos) || {};
    const linhas = casar(itensSite, nos).map((x) => {
      const cheio = x.de ?? x.preco;
      const nosso = x.nos ? x.nos.preco : null;
      const promo = x.de != null;
      const dif = nosso != null && Math.abs(cheio - nosso) >= 0.01;
      const a = ant[x.id];
      const mudou = a && (Math.abs(a[0] - x.preco) >= 0.01 || (a[1] ?? null) !== (x.de ?? null)) ? a : null;
      // histórico guardado: a última mudança de preço ou promoção no site
      const pts = (d.historico && d.historico[x.id]) || [[d.em, x.preco, x.de ?? null, x.disponivel ? 1 : 0]];
      let ultMud = null;
      for (let k = pts.length - 1; k >= 1; k--) { const ms = mudancas(pts[k - 1], pts[k]).filter((m) => !/estoque|Esgotou/.test(m.t)); if (ms.length) { ultMud = { em: pts[k][0], txt: ms.map((m) => m.t).join(' · ') }; break; } }
      const doDia = dia ? SD.mudancasDoDia(pts, dia) : [];
      return {
        ...x, cheio, nosso, promo, dif, mudou, pts, ultMud, desde: pts[0][0], doDia,
        desconto: promo ? 1 - x.preco / x.de : null,
        difV: nosso != null ? cheio - nosso : null, difP: nosso ? cheio / nosso - 1 : null,
        sit: !x.nos ? 'sem' : promo && dif ? 'promodif' : promo ? 'promo' : dif ? 'dif' : 'igual',
        nomeTxt: x.produto + (x.variante ? ' ' + x.variante : ''), nossoTxt: x.nos ? x.nos.nome : '',
      };
    });
    // filtro "Produto contém" da lateral: vale também nos números do topo e nas abas
    const fp = state.f.produto ? TS.norm(state.f.produto) : '';
    if (fp) for (let k = linhas.length - 1; k >= 0; k--) if (!TS.norm(linhas[k].nomeTxt + ' ' + linhas[k].nossoTxt).includes(fp)) linhas.splice(k, 1);
    const conta = (f) => linhas.filter(f).length;
    // com um dia escolhido, as abas contam só os produtos que mudaram naquele dia (o herói continua mostrando o site agora)
    const linhasDia = dia ? linhas.filter((r) => r.doDia.length) : linhas;
    const contaAba = (f) => linhasDia.filter(f).length;
    const FILTROS = {
      todos: ['Todos', () => true],
      promo: ['Em promoção no site', (r) => r.promo],
      dif: ['Preço diferente', (r) => r.dif],
      igual: ['Iguais', (r) => r.sit === 'igual'],
      sem: ['Sem correspondência', (r) => !r.nos],
      mudou: ['Mudou desde a consulta anterior', (r) => !!r.mudou],
    };
    const filtro = FILTROS[state.siteFiltro] ? state.siteFiltro : 'todos';
    // revisão de 22/11: o "como está" num cartão-herói; cada número leva à aba dele
    const ir = (k, rot) => h('button', { type: 'button', class: 'link-btn est-heroi-conta', onclick: () => { state.siteFiltro = k; pintar(corpo, d); } }, rot);
    const nPromo = conta((r) => r.promo), nDif = conta((r) => r.dif);
    corpo.append(h('div', { class: 'mt' }, TS.heroi([
      { rot: 'Preço diferente', num: fmt.int(nDif), estado: nDif ? 'ruim' : null, dica: `Preço cheio do site (sem a promoção) diferente do preço praticado ${lojaTxt}`,
        linhas: [`${fmt.int(conta((r) => r.dif && r.difV > 0))} mais caros no site · ${fmt.int(conta((r) => r.dif && r.difV < 0))} mais baratos`, nDif ? ir('dif', 'ver os diferentes ›') : null] },
      { rot: 'Em promoção no site', num: fmt.int(nPromo), dica: 'Produtos com preço "de" e "por" no site',
        linhas: [nPromo ? `desconto médio de ${fmt.pct(linhas.filter((r) => r.promo).reduce((s2, r) => s2 + r.desconto, 0) / nPromo, 0)}` : 'nenhum agora', nPromo ? ir('promo', 'ver as promoções ›') : null] },
      { rot: 'Produtos no site', num: fmt.int(linhas.length), dica: 'Cada tamanho (variante) conta como um produto. Iguais: mesmo preço da loja, sem promoção. Sem correspondência: produto do site que não casou com nenhum produto vendido (pelo código ou pelo nome e tamanho) — só no site, ou o nome é bem diferente',
        linhas: [`${fmt.int(conta((r) => !r.disponivel))} esgotados · ${fmt.int(conta((r) => r.sit === 'igual'))} iguais ${lojaTxt}`, h('span', null, `${fmt.int(conta((r) => !r.nos))} sem correspondência nas vendas `, conta((r) => !r.nos) ? ir('sem', 'ver ›') : null)] },
    ], { titulo: 'Site × loja' })));

    const SIT = { sem: ['Sem correspondência', 'muted'], promodif: ['Promoção + preço diferente', 'erro'], promo: ['Em promoção', 'warn'], dif: ['Preço diferente', 'erro'], igual: ['Igual', 'ok'] };
    const seg = TS.seg(Object.entries(FILTROS).map(([k, [t, f]]) => [`${t} (${fmt.int(contaAba(f))})`, k]), filtro, (v) => { state.siteFiltro = v; pintar(corpo, d); });
    const tab = TS.table({
      cols: [
        { key: 'nomeTxt', label: 'Produto no site', align: 'l', sticky: true, wrap: true, render: (r) => h('span', null,
          h('a', { href: r.url, target: '_blank', rel: 'noopener', class: 'site-link', title: 'Abrir no site (nova aba)', onclick: (e) => { if (r.url === '#') e.preventDefault(); } }, r.produto, ' ↗'),
          r.variante ? h('small', { class: 'est-tam' }, r.variante) : null, !r.disponivel ? h('small', { class: 'est-tam neg' }, 'esgotado no site') : null) },
        { key: 'nossoTxt', label: 'Nas vendas', align: 'l', wrap: true, title: 'Produto das vendas que casou com o do site: pelo código (SKU) ou pelo nome e tamanho', render: (r) => (r.nos ? h('span', null, r.nos.nome, h('small', { class: 'est-tam' }, `${r.nos.cod ? 'cód. ' + r.nos.cod + ' · ' : ''}${r.como === 'sku' ? 'pelo código' : 'pelo nome'} · ${r.nos.ult != null ? 'última venda ' + fmt.date(TS.dayToIso(r.nos.ult)) : 'sem venda'}`)) : h('span', { class: 'muted' }, '—')) },
        { key: 'nosso', label: 'Nosso preço', title: 'Preço de tabela do cadastro do AppNext (com uma loja escolhida e o cadastro no painel); senão, o preço mais vendido nas últimas 4 semanas com venda (sem desconto)', render: (r) => (r.nosso == null ? '—' : h('span', null, fmt.brl(r.nosso), h('small', { class: 'est-tam' }, r.nos.fonte === 'cadastro' ? 'cadastro' : 'vendas'))), sortVal: (r) => r.nosso },
        // revisão de 22/11 (sem rolagem para o lado): o preço do site numa coluna só (agora em cima; o preço cheio e o desconto embaixo),
        // a diferença embaixo da situação e o botão Histórico junto da última mudança
        { key: 'preco', label: 'Site', title: 'Em cima, o preço que o cliente paga hoje no site. Embaixo, o preço cheio (sem a promoção: o preço "de") e o desconto do site', render: (r) => h('span', null, h('b', null, fmt.brl(r.preco)),
          h('small', { class: 'est-tam' + (r.dif ? ' site-dif' : '') }, r.promo ? h('span', null, 'de ', h('s', { class: 'site-de' }, fmt.brl(r.de)), h('span', { class: 'site-promo' }, ` · −${fmt.int(r.desconto * 100)}%`)) : 'preço cheio')), sortVal: (r) => r.preco },
        { key: 'sit', label: 'Situação', align: 'l', title: 'Embaixo, a diferença: preço cheio do site − nosso preço', render: (r) => { const [t, c] = SIT[r.sit]; return h('span', null, h('span', { class: 'badge site-sit ' + c }, t),
          r.difV == null || !r.dif ? null : h('small', { class: 'est-tam ' + (r.difV > 0 ? 'pos' : 'neg') }, `${r.difV > 0 ? '+' : '−'}${fmt.brl(Math.abs(r.difV))} (${r.difV > 0 ? '+' : '−'}${fmt.n1(Math.abs(r.difP) * 100)}%)`)); }, sortVal: (r) => ({ promodif: 5, dif: 4, promo: 3, igual: 2, sem: 1 })[r.sit] },
        dia ? { key: 'doDia', label: `Mudança em ${dataCurta(dia)}`, align: 'l', wrap: true, title: `O que o site mudou neste produto em ${dataCurta(dia)}: preço cheio, preço com promoção, entrou ou saiu de promoção, esgotou ou voltou, saiu ou voltou ao site (de → para). A data é a da consulta em que o painel viu a mudança (o site é consultado uma vez por dia). Toque em Histórico para ver tudo`,
          render: (r) => h('span', null, h('span', { class: 'site-dia-mud' }, ...r.doDia.flatMap((m) => mudancas(m.a, m.b).map((x) => h('small', { class: 'est-tam' }, x.t)))),
            h('small', { class: 'est-tam muted' }, `consulta das ${horaTxt(r.doDia[r.doDia.length - 1].em)}`),
            h('button', { type: 'button', class: 'btn prc-ver site-hist', onclick: () => abrirHistorico(r, r.pts) }, 'Histórico')), sortVal: (r) => (r.doDia.length ? Date.parse(r.doDia[r.doDia.length - 1].em) : 0) }
          : { key: 'ultMud', label: 'Última mudança no site', align: 'l', wrap: true, title: 'A última vez que o site mudou o preço ou a promoção deste produto (o painel guarda o preço a cada consulta). Toque em Histórico para ver tudo', render: (r) => h('span', null, r.ultMud ? h('span', { class: r.mudou ? 'warn-t' : null, title: r.ultMud.txt }, h('b', null, dataTxt(r.ultMud.em)), h('small', { class: 'est-tam' }, r.ultMud.txt)) : h('span', { class: 'muted' }, `sem mudança desde ${dataTxt(r.desde)}`),
          h('button', { type: 'button', class: 'btn prc-ver site-hist', onclick: () => abrirHistorico(r, r.pts) }, 'Histórico')), sortVal: (r) => (r.ultMud ? Date.parse(r.ultMud.em) : 0) },
      ],
      rows: linhasDia.filter(FILTROS[filtro][1]), sortKey: dia ? 'doDia' : 'sit', maxHeight: '640px', search: 'Buscar produto…', searchKeys: ['nomeTxt', 'nossoTxt', 'sku'], produto: ['nomeTxt', 'nossoTxt'],
      imprimir: ['nomeTxt', 'nossoTxt', 'nosso', 'preco', 'sit', 'ultMud', 'doDia'], cls: 'site-t',
      empty: vazioDia(dia, sitDia, diasCons, linhasDia.length, d.consultasDesde),
    });
    // filtro "Mudou em" ao lado da busca da tabela
    const filtroDia = campoDia(dia, hoje, ontem, (v) => { state.siteDia = v; pintar(corpo, d); });
    if (tab.searchBox) { const linha = h('div', { class: 'site-busca' }); tab.searchBox.replaceWith(linha); linha.append(tab.searchBox, filtroDia); } else tab.prepend(filtroDia);
    corpo.append(h('div', { class: 'mt' }, TS.card('Produtos do site', `Preço cheio do site comparado com o nosso preço ${lojaTxt}: o preço de tabela do cadastro do AppNext quando o painel tem, senão o preço mais vendido nas últimas 4 semanas. Em promoção = o site mostra preço "de" e "por". Clique no nome para abrir o produto no site.`, seg, tab)));
  }
  // ---------- histórico de um produto do site ----------
  const dataTxt = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' });
  const dataCurta = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(2, 4)}`;
  const horaTxt = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const DICA_DIA = 'Mostra só os produtos que mudaram no site naquele dia (preço cheio, preço com promoção, entrou ou saiu de promoção, esgotou ou voltou) e o que mudou. A data é a da consulta em que o painel viu a mudança (o site é consultado uma vez por dia). As abas continuam valendo junto.';
  /** filtro "Mudou em": atalhos Qualquer dia · Hoje · Ontem e um campo de data (aplica ao sair do campo, não a cada dígito) */
  function campoDia(dia, hoje, ontem, escolher) {
    const seg = TS.seg([
      ['Qualquer dia', '', 'Todos os produtos, com a última mudança de cada um'],
      ['Hoje', hoje, `Produtos que mudaram no site hoje (${dataCurta(hoje)})`],
      ['Ontem', ontem, `Produtos que mudaram no site ontem (${dataCurta(ontem)})`],
    ], dia === hoje || dia === ontem ? dia : (dia ? null : ''), (v) => escolher(v));
    const data = h('input', { type: 'date', class: 'f-input site-dia-data', value: dia || '', max: hoje, 'aria-label': 'Mudou em (data)', title: 'Escolha um dia' });
    TS.aoConfirmar(data, () => { const v = /^\d{4}-\d{2}-\d{2}$/.test(data.value) ? data.value : ''; if (v !== dia) escolher(v); });
    return h('div', { class: 'site-dia', role: 'group', 'aria-label': 'Mudou em' },
      h('span', { class: 'site-dia-rot' }, 'Mudou em', TS.dica(DICA_DIA)), seg, data);
  }
  /** frase da tabela vazia: com um dia escolhido, diz se houve consulta naquele dia */
  function vazioDia(dia, sit, dias, nDia, desde) {
    if (!dia) return 'Nenhum produto nesta aba.';
    const dt = dataCurta(dia);
    if (sit === 'sem-consulta') return `Sem consulta do site neste dia (${dt}): o painel não leu o site nesse dia, então não há como saber se algo mudou.`;
    if (sit === 'sem-registro') return `Sem consulta do site registrada neste dia (${dt}): antes de ${desde ? dataTxt(desde) : 'hoje'} o painel só guardava os dias em que algo mudou.`;
    const c = dias.get(dia);
    if (!nDia) return `Nenhuma mudança no site em ${dt}${c ? ` (consulta das ${horaTxt(c.ultima)})` : ''}.`;
    return `Nenhum produto desta aba mudou em ${dt}.`;
  }
  /** apresentação: histórico e consultas fictícios, com mudanças hoje, ontem e em dias para trás; sem consulta há 6 e 7 dias */
  function demoHistorico(d, itensSite) {
    const t = Date.parse(d.em), dia = 86400e3, iso = (ms) => new Date(ms).toISOString(), r1 = (v) => Math.round(v * 10) / 10;
    d.historico = {};
    d.consultas = [];
    for (let k = 45; k >= 0; k--) if (k !== 6 && k !== 7) d.consultas.push(iso(t - k * dia));
    d.consultasDesde = d.consultas[0];
    itensSite.forEach((x, k) => {
      const cheio = x.de ?? x.preco, disp = x.disponivel ? 1 : 0, ini = iso(t - 45 * dia), agora = [x.preco, x.de ?? null, disp];
      const r = k % 6;
      let pts;
      if (r === 0) pts = [[ini, r1(cheio * 0.94), null, 1], [iso(t - 12 * dia), cheio, null, 1], ...(x.de ? [[iso(t - 3 * dia), x.preco, x.de, 1]] : [])];
      else if (r === 1) pts = [[ini, r1(cheio * 0.95), null, disp], [iso(t), ...agora]]; // hoje
      else if (r === 2) pts = disp ? [[ini, ...agora.slice(0, 2), 1], [iso(t - 4 * dia), ...agora.slice(0, 2), 0], [iso(t - dia), ...agora]] : [[ini, ...agora.slice(0, 2), 1], [iso(t - dia), ...agora]]; // esgotou / voltou
      else if (r === 3 && k % 12 === 3) pts = [[ini, r1(cheio * 1.05), null, disp], [iso(t - dia), ...agora]]; // ontem
      else pts = [[ini, ...agora]];
      // o último ponto é sempre o site agora (o resto fica como estava em r === 0, com o estoque de agora)
      if (r === 0 && pts[pts.length - 1][3] !== disp) pts.push([iso(t), ...agora]);
      d.historico[x.id] = pts;
    });
  }
  const diaDe = (iso) => TS.isoToDay(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)));
  /** mudanças entre dois pontos do histórico, em palavras */
  function mudancas(a, b) {
    const out = [];
    if (b[1] == null) return [{ t: 'Saiu do site', cls: 'prc-st-c' }];
    if (a[1] == null) out.push({ t: 'Voltou ao site', cls: 'prc-st-v' });
    const cheioA = a[2] ?? a[1], cheioB = b[2] ?? b[1];
    if (a[1] != null && Math.abs(cheioA - cheioB) >= 0.01) out.push({ t: `Preço cheio ${fmt.brl(cheioA)} → ${fmt.brl(cheioB)}`, v: cheioB / cheioA - 1, cls: 'prc-st-a' });
    if (a[1] != null && a[2] == null && b[2] != null) out.push({ t: `Entrou em promoção: de ${fmt.brl(b[2])} por ${fmt.brl(b[1])} (−${fmt.int((1 - b[1] / b[2]) * 100)}%)`, cls: 'prc-st-v' });
    else if (a[1] != null && a[2] != null && b[2] == null) out.push({ t: `Saiu da promoção: volta a ${fmt.brl(b[1])}`, cls: 'prc-st-c' });
    else if (a[1] != null && a[2] != null && b[2] != null && Math.abs(a[1] - b[1]) >= 0.01) out.push({ t: `Promoção mudou: por ${fmt.brl(a[1])} → ${fmt.brl(b[1])} (−${fmt.int((1 - b[1] / b[2]) * 100)}%)`, cls: 'prc-st-v' });
    if (a[1] != null && a[3] !== b[3]) out.push({ t: b[3] ? 'Voltou a ter estoque' : 'Esgotou', cls: 'prc-st-n' });
    return out;
  }
  /** pré-indexa as vendas de um produto por dia para consultar a moda de 28 dias em O(1) */
  function indexarNosso(nome) {
    const db = TS.db;
    const descId = db.D.descricao.indexOf(nome);
    const porDia = new Map();
    if (descId >= 0) {
      for (let i = 0; i < db.n; i++) {
        if (db.desc[i] !== descId || !(db.vu[i] > 0)) continue;
        const d = db.day[i], k = Math.round(db.vu[i] * 100) / 100;
        let m = porDia.get(d); if (!m) porDia.set(d, (m = new Map()));
        m.set(k, (m.get(k) || 0) + db.qtd[i]);
      }
    }
    return (dia) => {
      const cont = new Map();
      for (let d = dia - 27; d <= dia; d++) {
        const m = porDia.get(d);
        if (m) for (const [k, q] of m) cont.set(k, (cont.get(k) || 0) + q);
      }
      let best = null, n = -1;
      for (const [k, q] of cont) if (q > n) { best = k; n = q; }
      return best;
    };
  }
  function abrirHistorico(r, pts) {
    document.querySelector('.prc-drawer-camada')?.remove();
    const fechar = () => { camada.remove(); document.body.classList.remove('com-camada'); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    const titulo = r.produto + (r.variante ? ' · ' + r.variante : '');
    const nossoNoDia = r.nos && r.nos.ult != null ? indexarNosso(r.nos.nome) : null;
    // gráfico em degrau: cada ponto do histórico + hoje
    const dias = [...pts.map((p) => diaDe(p[0])), TS.todayDay()];
    const labels = dias.map((d) => dataTxt(TS.dayToIso(d) + 'T12:00:00Z'));
    const em = (k) => pts[Math.min(k, pts.length - 1)];
    const sAgora = dias.map((_, k) => em(k)[1]), sCheio = dias.map((_, k) => (em(k)[1] == null ? null : em(k)[2] ?? em(k)[1]));
    const sNosso = nossoNoDia ? dias.map((d) => nossoNoDia(d)) : dias.map(() => r.nosso);
    const graf = TS.chart({
      type: 'line',
      data: { labels, datasets: [
        { label: 'Site: agora', data: sAgora, borderColor: '#B5452B', backgroundColor: '#B5452B', stepped: 'before', pointRadius: 3, borderWidth: 2 },
        { label: 'Site: preço cheio', data: sCheio, borderColor: '#C77F12', backgroundColor: '#C77F12', stepped: 'before', pointRadius: 2, borderWidth: 1.5, borderDash: [5, 4] },
        r.nos ? { label: 'Nosso preço', data: sNosso, borderColor: '#2C5234', backgroundColor: '#2C5234', stepped: 'before', pointRadius: 3, borderWidth: 2 } : null,
      ].filter(Boolean) },
      options: { plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? '—' : fmt.brl(c.raw)}` } } },
        scales: { y: { ...TS.axisNum((v) => fmt.brl0(v)), beginAtZero: false }, x: TS.axisCat } },
    }, 'short');
    // linha do tempo (mais recente primeiro)
    const itens = [];
    for (let k = pts.length - 1; k >= 1; k--) {
      const ms = mudancas(pts[k - 1], pts[k]);
      if (!ms.length) continue;
      const dia = diaDe(pts[k][0]);
      const nosso = r.nos ? (nossoNoDia ? nossoNoDia(dia) : r.nosso) : null;
      itens.push(h('li', { class: 'prc-tl-i' },
        h('div', { class: 'prc-tl-d' }, dataTxt(pts[k][0]), h('span', { class: 'muted' }, ` (consulta das ${new Date(pts[k][0]).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`)),
        ...ms.map((m) => h('div', { class: 'prc-tl-l' }, h('span', { class: 'prc-st ' + m.cls }, m.t), m.v != null ? h('span', { class: 'prc-badge ' + (m.v > 0 ? 'prc-ruim' : 'prc-bom') }, `${m.v > 0 ? '+' : ''}${fmt.n1(m.v * 100)}%`) : null)),
        nosso != null && pts[k][1] != null ? h('div', { class: 'prc-tl-m muted' }, `Nesse dia: site ${fmt.brl(pts[k][1])}${pts[k][2] ? ` (cheio ${fmt.brl(pts[k][2])})` : ''} · nosso ${fmt.brl(nosso)}`) : null));
    }
    if (!itens.length) itens.push(h('li', { class: 'muted' }, `Nenhuma mudança desde ${dataTxt(pts[0][0])}, quando o painel começou a guardar o preço deste produto.`));
    // texto pronto para falar com a franquia
    const resumoTxt = [
      `${titulo} (site Tea Shop)`,
      `• Site hoje: ${r.promo ? `de ${fmt.brl(r.de)} por ${fmt.brl(r.preco)} (−${fmt.int(r.desconto * 100)}%)` : fmt.brl(r.preco)}`,
      r.nosso != null ? `• Na loja: ${fmt.brl(r.nosso)}${r.dif ? ` (preço cheio do site ${r.difV > 0 ? '+' : '−'}${fmt.n1(Math.abs(r.difP) * 100)}%)` : ' (igual ao preço cheio do site)'}` : '',
      ...pts.slice(1).map((p, k) => mudancas(pts[k], p).map((m) => `• ${dataTxt(p[0])}: ${m.t}`).join('\n')).filter(Boolean).reverse(),
      `• Link: ${r.url}`,
    ].filter(Boolean).join('\n');
    const msg = h('small', { class: 'muted' });
    const copiar = h('button', { type: 'button', class: 'btn', onclick: async () => {
      try { await navigator.clipboard.writeText(resumoTxt); msg.textContent = 'Copiado: cole no WhatsApp ou e-mail da franquia.'; } catch { msg.textContent = 'Não consegui copiar: selecione o texto abaixo.'; }
    } }, '📋 Copiar resumo para a franquia');
    const card = h('aside', { class: 'card prc-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      h('div', { class: 'card-title' }, h('a', { href: r.url, target: '_blank', rel: 'noopener', class: 'site-link' }, titulo, ' ↗')),
      h('div', { class: 'card-sub' }, r.nos ? `Nas vendas: ${r.nos.nome}${r.nos.cod ? ' · cód. ' + r.nos.cod : ''}` : 'Sem correspondência nas vendas'),
      h('div', { class: 'prc-resumo' },
        h('div', null, h('small', null, 'Site: preço cheio'), h('b', null, fmt.brl(r.cheio))),
        h('div', null, h('small', null, 'Site: agora'), h('b', { class: r.promo ? 'neg' : null }, fmt.brl(r.preco)), r.promo ? h('em', { class: 'muted' }, ` −${fmt.int(r.desconto * 100)}%`) : null),
        h('div', null, h('small', null, 'Nosso preço'), h('b', null, r.nosso != null ? fmt.brl(r.nosso) : '—'))),
      h('div', { class: 'f-label mt' }, 'Evolução: site × nosso preço'),
      h('div', { class: 'prc-graf' }, graf),
      h('div', { class: 'muted prc-nota' }, `O painel guarda o preço do site a cada consulta (todo dia às 10h) desde ${dataTxt(pts[0][0])}. "Nosso preço" ao longo do tempo = o preço mais vendido nas 4 semanas até cada data.`),
      h('div', { class: 'f-label mt' }, 'Mudanças no site (mais recente primeiro)'),
      h('ul', { class: 'prc-tl' }, itens),
      h('div', { class: 'f-label mt' }, 'Para falar com a franquia'),
      h('div', { class: 'site-copiar' }, copiar, msg),
      h('pre', { class: 'site-resumo' }, resumoTxt));
    const camada = h('div', { class: 'prc-drawer-camada', onmousedown: (e) => { if (e.target === camada) fechar(); } }, card);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', esc);
  }
})();
