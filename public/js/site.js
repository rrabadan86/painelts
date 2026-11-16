/* Estoque e Margem → Site: preços do e-commerce (www.teashop.com.br) × os preços praticados nas lojas.
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

    if (d.demo && !d.historico) {
      // apresentação: algumas mudanças fictícias nas últimas semanas
      d.historico = {};
      const t = Date.parse(d.em), dia = 86400e3, iso = (ms) => new Date(ms).toISOString();
      itensSite.forEach((x, k) => {
        const cheio = x.de ?? x.preco;
        if (k % 3 === 0) d.historico[x.id] = [[iso(t - 40 * dia), Math.round(cheio * 0.94 * 10) / 10, null, 1], [iso(t - 12 * dia), cheio, null, 1], ...(x.de ? [[iso(t - 3 * dia), x.preco, x.de, 1]] : [])];
        else d.historico[x.id] = [[iso(t - 40 * dia), x.preco, x.de ?? null, x.disponivel ? 1 : 0]];
      });
    }
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
      return {
        ...x, cheio, nosso, promo, dif, mudou, pts, ultMud, desde: pts[0][0],
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
    const FILTROS = {
      todos: ['Todos', () => true],
      promo: ['Em promoção no site', (r) => r.promo],
      dif: ['Preço diferente', (r) => r.dif],
      igual: ['Iguais', (r) => r.sit === 'igual'],
      sem: ['Sem correspondência', (r) => !r.nos],
      mudou: ['Mudou desde a consulta anterior', (r) => !!r.mudou],
    };
    const filtro = FILTROS[state.siteFiltro] ? state.siteFiltro : 'todos';
    corpo.append(h('div', { class: 'grid g-kpi mt' },
      TS.kpi('Produtos no site', fmt.int(linhas.length), `${fmt.int(conta((r) => !r.disponivel))} esgotados`, 'Cada tamanho (variante) conta como um produto'),
      TS.kpi('Em promoção no site', fmt.int(conta((r) => r.promo)), linhas.some((r) => r.promo) ? `desconto médio de ${fmt.pct(linhas.filter((r) => r.promo).reduce((s, r) => s + r.desconto, 0) / conta((r) => r.promo), 0)}` : '', 'Produtos com preço "de" e "por" no site'),
      TS.kpi('Preço diferente', fmt.int(conta((r) => r.dif)), `${fmt.int(conta((r) => r.dif && r.difV > 0))} mais caros no site · ${fmt.int(conta((r) => r.dif && r.difV < 0))} mais baratos`, `Preço cheio do site (sem a promoção) diferente do preço praticado ${lojaTxt}`),
      TS.kpi('Iguais', fmt.int(conta((r) => r.sit === 'igual')), `mesmo preço ${lojaTxt}, sem promoção`),
      TS.kpi('Sem correspondência', fmt.int(conta((r) => !r.nos)), 'não achei nas vendas', 'Produto do site que não casou com nenhum produto vendido (pelo código ou pelo nome e tamanho): só no site, ou o nome é bem diferente')));

    const SIT = { sem: ['Sem correspondência', 'muted'], promodif: ['Promoção + preço diferente', 'erro'], promo: ['Em promoção', 'warn'], dif: ['Preço diferente', 'erro'], igual: ['Igual', 'ok'] };
    const seg = TS.seg(Object.entries(FILTROS).map(([k, [t, f]]) => [`${t} (${fmt.int(conta(f))})`, k]), filtro, (v) => { state.siteFiltro = v; pintar(corpo, d); });
    const tab = TS.table({
      cols: [
        { key: 'nomeTxt', label: 'Produto no site', align: 'l', sticky: true, wrap: true, render: (r) => h('span', null,
          h('a', { href: r.url, target: '_blank', rel: 'noopener', class: 'site-link', title: 'Abrir no site (nova aba)', onclick: (e) => { if (r.url === '#') e.preventDefault(); } }, r.produto, ' ↗'),
          r.variante ? h('small', { class: 'est-tam' }, r.variante) : null, !r.disponivel ? h('small', { class: 'est-tam neg' }, 'esgotado no site') : null) },
        { key: 'nossoTxt', label: 'Nas vendas', align: 'l', wrap: true, title: 'Produto das vendas que casou com o do site: pelo código (SKU) ou pelo nome e tamanho', render: (r) => (r.nos ? h('span', null, r.nos.nome, h('small', { class: 'est-tam' }, `${r.nos.cod ? 'cód. ' + r.nos.cod + ' · ' : ''}${r.como === 'sku' ? 'pelo código' : 'pelo nome'} · ${r.nos.ult != null ? 'última venda ' + fmt.date(TS.dayToIso(r.nos.ult)) : 'sem venda'}`)) : h('span', { class: 'muted' }, '—')) },
        { key: 'nosso', label: 'Nosso preço', title: 'Preço de tabela do cadastro do AppNext (com uma loja escolhida e o cadastro no painel); senão, o preço mais vendido nas últimas 4 semanas com venda (sem desconto)', render: (r) => (r.nosso == null ? '—' : h('span', null, fmt.brl(r.nosso), h('small', { class: 'est-tam' }, r.nos.fonte === 'cadastro' ? 'cadastro' : 'vendas'))), sortVal: (r) => r.nosso },
        { key: 'cheio', label: 'Site: preço cheio', title: 'Preço do site sem a promoção (o preço "de" quando está em promoção)', fmt: fmt.brl, cls: (r) => (r.dif ? 'site-dif' : '') },
        { key: 'preco', label: 'Site: agora', title: 'O preço que o cliente paga hoje no site', render: (r) => h('span', null, r.promo ? h('s', { class: 'muted site-de' }, fmt.brl(r.de)) : null, h('b', null, fmt.brl(r.preco))) },
        { key: 'desconto', label: 'Desconto no site', fmt: (v) => (v != null ? `−${fmt.int(v * 100)}%` : '—'), cls: (r) => (r.promo ? 'site-promo' : '') },
        { key: 'difP', label: 'Diferença', title: 'Preço cheio do site − nosso preço', render: (r) => (r.difV == null ? '—' : !r.dif ? h('span', { class: 'muted' }, 'igual') : h('span', { class: r.difV > 0 ? 'pos' : 'neg' }, `${r.difV > 0 ? '+' : '−'}${fmt.brl(Math.abs(r.difV))} (${r.difV > 0 ? '+' : '−'}${fmt.n1(Math.abs(r.difP) * 100)}%)`)), sortVal: (r) => r.difP },
        { key: 'sit', label: 'Situação', align: 'l', render: (r) => { const [t, c] = SIT[r.sit]; return h('span', { class: 'badge ' + c }, t); }, sortVal: (r) => ({ promodif: 5, dif: 4, promo: 3, igual: 2, sem: 1 })[r.sit] },
        { key: 'ultMud', label: 'Última mudança no site', align: 'l', wrap: true, title: 'A última vez que o site mudou o preço ou a promoção deste produto (o painel guarda o preço a cada consulta). Clique em Histórico para ver tudo', render: (r) => (r.ultMud ? h('span', { class: r.mudou ? 'warn-t' : null, title: r.ultMud.txt }, h('b', null, dataTxt(r.ultMud.em)), h('small', { class: 'est-tam' }, r.ultMud.txt)) : h('span', { class: 'muted' }, `sem mudança desde ${dataTxt(r.desde)}`)), sortVal: (r) => (r.ultMud ? Date.parse(r.ultMud.em) : 0) },
        { key: 'hist', label: '', align: 'l', render: (r) => h('button', { type: 'button', class: 'btn prc-ver', onclick: () => abrirHistorico(r, r.pts) }, 'Histórico'), sortVal: () => 0 },
      ],
      rows: linhas.filter(FILTROS[filtro][1]), sortKey: 'sit', maxHeight: '640px', search: 'Buscar produto…', searchKeys: ['nomeTxt', 'nossoTxt', 'sku'], produto: ['nomeTxt', 'nossoTxt'],
      imprimir: ['nomeTxt', 'nossoTxt', 'nosso', 'cheio', 'preco', 'desconto', 'difP', 'sit'], cls: 'site-t',
      empty: 'Nenhum produto nesta aba.',
    });
    corpo.append(h('div', { class: 'mt' }, TS.card('Produtos do site', `Preço cheio do site comparado com o nosso preço ${lojaTxt}: o preço de tabela do cadastro do AppNext quando o painel tem, senão o preço mais vendido nas últimas 4 semanas. Em promoção = o site mostra preço "de" e "por". Clique no nome para abrir o produto no site.`, seg, tab)));
  }
  // ---------- histórico de um produto do site ----------
  const dataTxt = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const diaDe = (iso) => TS.isoToDay(new Date(iso).toLocaleDateString('en-CA')); // dia no horário local (a consulta é gravada em UTC)
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
  /** nosso preço praticado num dia: o preço de tabela mais vendido nos 28 dias até ele */
  function nossoNoDia(nome, dia) {
    const db = TS.db;
    const cont = new Map();
    for (let i = 0; i < db.n; i++) {
      if (db.day[i] > dia || db.day[i] < dia - 27 || db.D.descricao[db.desc[i]] !== nome || !(db.vu[i] > 0)) continue;
      const k = Math.round(db.vu[i] * 100) / 100; cont.set(k, (cont.get(k) || 0) + db.qtd[i]);
    }
    let best = null, n = -1;
    for (const [k, q] of cont) if (q > n) { best = k; n = q; }
    return best;
  }
  function abrirHistorico(r, pts) {
    document.querySelector('.prc-drawer-camada')?.remove();
    const fechar = () => { camada.remove(); document.body.classList.remove('com-camada'); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    const titulo = r.produto + (r.variante ? ' · ' + r.variante : '');
    // gráfico em degrau: cada ponto do histórico + hoje
    const dias = [...pts.map((p) => diaDe(p[0])), TS.todayDay()];
    const labels = dias.map((d) => dataTxt(TS.dayToIso(d)));
    const em = (k) => pts[Math.min(k, pts.length - 1)];
    const sAgora = dias.map((_, k) => em(k)[1]), sCheio = dias.map((_, k) => (em(k)[1] == null ? null : em(k)[2] ?? em(k)[1]));
    const sNosso = r.nos && r.nos.ult != null ? dias.map((d) => nossoNoDia(r.nos.nome, d)) : dias.map(() => r.nosso);
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
      const nosso = r.nos ? (r.nos.ult != null ? nossoNoDia(r.nos.nome, dia) : r.nosso) : null;
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
