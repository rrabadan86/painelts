/* Estoque e Margem → Site: preços do e-commerce (www.teashop.com.br) × os preços praticados nas lojas.
 * - Site: o catálogo público é lido todo dia às 10h (e em "Consultar agora"): produto, variante, preço, preço "de"
 *   (promoção) e o link.
 * - Nosso preço: o preço de tabela mais vendido nas últimas 4 semanas com venda (o mesmo "preço praticado" da tela Preços).
 * - Casamento: pelo SKU = código do produto; senão pelo nome (sem "Chá Branco", "Infusão"…) e pelo tamanho (50g, 100g…).
 * Situação: em promoção no site (tem preço "de"), preço cheio diferente do nosso, igual, ou sem correspondência. */
(function () {
  const { h, fmt, state } = TS;

  async function buscar() {
    const r = await fetch(TS.api('site'), { credentials: 'same-origin' });
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
  function nossos() {
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
      out.push({ nome: p.nome, cod: p.cod, preco, ult: p.ult, tok: new Set(tokens(p.nome)), g: gramas(p.nome) });
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
            const sc = tk.length / p.tok.size + (p.ult / 1e6);
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
    buscar().then((d) => { if (corpo.isConnected) pintar(corpo, d); }).catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  };

  function pintar(corpo, d) {
    corpo.replaceChildren();
    const nos = nossos();
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
        pintar(corpo, await buscar());
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

    const ant = (d.anterior && d.anterior.precos) || {};
    const linhas = casar(itensSite, nos).map((x) => {
      const cheio = x.de ?? x.preco;
      const nosso = x.nos ? x.nos.preco : null;
      const promo = x.de != null;
      const dif = nosso != null && Math.abs(cheio - nosso) >= 0.01;
      const a = ant[x.id];
      const mudou = a && (Math.abs(a[0] - x.preco) >= 0.01 || (a[1] ?? null) !== (x.de ?? null)) ? a : null;
      return {
        ...x, cheio, nosso, promo, dif, mudou,
        desconto: promo ? 1 - x.preco / x.de : null,
        difV: nosso != null ? cheio - nosso : null, difP: nosso ? cheio / nosso - 1 : null,
        sit: !x.nos ? 'sem' : promo && dif ? 'promodif' : promo ? 'promo' : dif ? 'dif' : 'igual',
        nomeTxt: x.produto + (x.variante ? ' ' + x.variante : ''), nossoTxt: x.nos ? x.nos.nome : '',
      };
    });
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
        { key: 'nossoTxt', label: 'Nas vendas', align: 'l', wrap: true, title: 'Produto das vendas que casou com o do site: pelo código (SKU) ou pelo nome e tamanho', render: (r) => (r.nos ? h('span', null, r.nos.nome, h('small', { class: 'est-tam' }, `${r.nos.cod ? 'cód. ' + r.nos.cod + ' · ' : ''}${r.como === 'sku' ? 'pelo código' : 'pelo nome'} · última venda ${fmt.date(TS.dayToIso(r.nos.ult))}`)) : h('span', { class: 'muted' }, '—')) },
        { key: 'nosso', label: 'Nosso preço', title: 'Preço de tabela mais vendido nas últimas 4 semanas com venda (sem desconto)', fmt: (v) => (v != null ? fmt.brl(v) : '—') },
        { key: 'cheio', label: 'Site: preço cheio', title: 'Preço do site sem a promoção (o preço "de" quando está em promoção)', fmt: fmt.brl, cls: (r) => (r.dif ? 'site-dif' : '') },
        { key: 'preco', label: 'Site: agora', title: 'O preço que o cliente paga hoje no site', render: (r) => h('span', null, r.promo ? h('s', { class: 'muted site-de' }, fmt.brl(r.de)) : null, h('b', null, fmt.brl(r.preco))) },
        { key: 'desconto', label: 'Desconto no site', fmt: (v) => (v != null ? `−${fmt.int(v * 100)}%` : '—'), cls: (r) => (r.promo ? 'site-promo' : '') },
        { key: 'difP', label: 'Diferença', title: 'Preço cheio do site − nosso preço', render: (r) => (r.difV == null ? '—' : !r.dif ? h('span', { class: 'muted' }, 'igual') : h('span', { class: r.difV > 0 ? 'pos' : 'neg' }, `${r.difV > 0 ? '+' : '−'}${fmt.brl(Math.abs(r.difV))} (${r.difV > 0 ? '+' : '−'}${fmt.n1(Math.abs(r.difP) * 100)}%)`)), sortVal: (r) => r.difP },
        { key: 'sit', label: 'Situação', align: 'l', render: (r) => { const [t, c] = SIT[r.sit]; return h('span', { class: 'badge ' + c }, t); }, sortVal: (r) => ({ promodif: 5, dif: 4, promo: 3, igual: 2, sem: 1 })[r.sit] },
        { key: 'mudou', label: 'Antes', title: 'Preço na consulta anterior, quando mudou', render: (r) => (r.mudou ? h('span', { class: 'warn-t', title: d.anterior ? `Consulta de ${new Date(d.anterior.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : '' }, `era ${fmt.brl(r.mudou[0])}${r.mudou[1] ? ` (de ${fmt.brl(r.mudou[1])})` : ''}`) : ''), sortVal: (r) => (r.mudou ? 1 : 0) },
      ],
      rows: linhas.filter(FILTROS[filtro][1]), sortKey: 'sit', maxHeight: '640px', search: 'Buscar produto…', searchKeys: ['nomeTxt', 'nossoTxt', 'sku'],
      imprimir: ['nomeTxt', 'nossoTxt', 'nosso', 'cheio', 'preco', 'desconto', 'difP', 'sit'], cls: 'site-t',
      empty: 'Nenhum produto nesta aba.',
    });
    corpo.append(h('div', { class: 'mt' }, TS.card('Produtos do site', `Preço cheio do site comparado com o preço praticado ${lojaTxt} (o preço de tabela mais vendido nas últimas 4 semanas). Em promoção = o site mostra preço "de" e "por". Clique no nome para abrir o produto no site.`, seg, tab)));
  }
})();
