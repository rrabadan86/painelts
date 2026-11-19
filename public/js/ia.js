/* Inteligência artificial (Claude, com a chave da Anthropic de cada franqueado).
 *  - "Pergunte ao painel" (botão ✨ no topo): a IA pede consultas e o NAVEGADOR as faz sobre os dados que a pessoa já vê
 *    (vendas, clientes, estoque): o que o perfil não pode ver não existe aqui, então também não vai para a IA.
 *    Clientes vão só com primeiro nome + inicial (sem CPF, telefone, e-mail).
 *  - Revisão do pedido sugerido (aba Pedido): TS.iaPedido.
 *  - Configurações → Inteligência artificial: TS.abaIA (a chave nunca volta para a tela).
 * Na apresentação as respostas são simuladas. */
(function () {
  const { h, fmt, state } = TS;
  const DIA = 86400e3;

  async function iaApi(metodo, rota, corpo) {
    const r = await fetch(TS.api(rota), { method: metodo, credentials: 'same-origin', headers: metodo === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.erro || 'Falha.'); e.status = r.status; throw e; }
    return j;
  }
  TS.iaApi = iaApi;

  // ======================= Markdown simples → elementos (sem innerHTML) =======================
  function inline(txt) {
    const out = [];
    const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;
    let ult = 0, m;
    while ((m = re.exec(txt))) {
      if (m.index > ult) out.push(txt.slice(ult, m.index));
      const t = m[0];
      out.push(t.startsWith('**') ? h('b', null, t.slice(2, -2)) : t.startsWith('`') ? h('code', null, t.slice(1, -1)) : h('i', null, t.slice(1, -1)));
      ult = m.index + t.length;
    }
    if (ult < txt.length) out.push(txt.slice(ult));
    return out;
  }
  TS.iaMd = function (txt) {
    const box = h('div', { class: 'ia-md' });
    const linhas = String(txt || '').replace(/\r/g, '').split('\n');
    let k = 0;
    while (k < linhas.length) {
      const l = linhas[k];
      if (!l.trim()) { k++; continue; }
      if (/^\s*\|/.test(l)) { // tabela
        const rows = [];
        while (k < linhas.length && /^\s*\|/.test(linhas[k])) { rows.push(linhas[k]); k++; }
        const cel = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const corpo = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)).map(cel);
        const [cab, ...resto] = corpo;
        const num = (c) => /^[-+]?(R\$\s?)?[\d.,]+\s?%?$/.test(c);
        box.append(h('div', { class: 'ia-tab-w' }, h('table', { class: 'ia-tab' },
          cab ? h('thead', null, h('tr', null, cab.map((c) => h('th', null, inline(c))))) : null,
          h('tbody', null, resto.map((r) => h('tr', null, r.map((c) => h('td', { class: num(c) ? 'n' : null }, inline(c)))))))));
        continue;
      }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
        const ord = /^\s*\d+[.)]/.test(l);
        const lista = h(ord ? 'ol' : 'ul');
        while (k < linhas.length && /^\s*([-*•]|\d+[.)])\s+/.test(linhas[k])) { lista.append(h('li', null, inline(linhas[k].replace(/^\s*([-*•]|\d+[.)])\s+/, '')))); k++; }
        box.append(lista);
        continue;
      }
      if (/^#{1,4}\s/.test(l)) { box.append(h('p', { class: 'ia-tit' }, inline(l.replace(/^#+\s*/, '')))); k++; continue; }
      const par = [];
      while (k < linhas.length && linhas[k].trim() && !/^\s*(\||[-*•]\s|\d+[.)]\s|#{1,4}\s)/.test(linhas[k])) { par.push(linhas[k]); k++; }
      box.append(h('p', null, inline(par.join(' '))));
    }
    return box;
  };

  // ======================= ferramentas (rodam aqui, sobre TS.db) =======================
  const r2 = (v) => Math.round(v * 100) / 100;
  const isoOk = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? TS.isoToDay(s) : null);
  const isoDe = (d) => TS.dayToIso(d);
  function periodo(p) {
    const db = TS.db;
    let de = p ? isoOk(p.de) : null, ate = p ? isoOk(p.ate) : null;
    if (p && p.ultimos_dias > 0) { if (ate == null) ate = db.maxDay; de = ate - Math.round(p.ultimos_dias) + 1; }
    if (ate == null) ate = db.maxDay;
    if (de == null) de = ate - 29;
    if (de > ate) [de, ate] = [ate, de];
    return [de, ate];
  }
  const CAMPO = { lojas: ['loja', 'loja'], vendedores: ['vendedor', 'vend'], grupos: ['grupoC', 'grupoC'], categorias: ['cat', 'cat'] };
  function casar(dic, nomes) {
    const alvo = nomes.map((x) => TS.norm(x).trim()).filter(Boolean);
    if (!alvo.length) return null;
    const s = new Set();
    TS.db.D[dic].forEach((x, i) => { const n = TS.norm(x); if (alvo.some((a) => n === a)) s.add(i); });
    if (!s.size) TS.db.D[dic].forEach((x, i) => { const n = TS.norm(x); if (alvo.some((a) => n.includes(a))) s.add(i); });
    return s;
  }
  function indices(input) {
    const db = TS.db, f = (input && input.filtros) || {};
    const [de, ate] = periodo(input && input.periodo);
    const sets = {};
    for (const [k, [dic, col]] of Object.entries(CAMPO)) {
      if (!Array.isArray(f[k]) || !f[k].length) continue;
      const s = casar(dic, f[k]);
      if (!s.size) return { erro: `Nenhum valor de ${k} parecido com ${f[k].join(', ')}. Use listar_valores para ver os nomes.` };
      sets[col] = s;
    }
    let prodOk = null;
    if (f.produto && String(f.produto).trim()) {
      const q = TS.norm(f.produto).trim();
      prodOk = { desc: new Set(), prod: new Set() };
      db.D.descricao.forEach((x, i) => { if (TS.norm(x).includes(q)) prodOk.desc.add(i); });
      db.D.produto.forEach((x, i) => { if (TS.norm(x).includes(q)) prodOk.prod.add(i); });
      if (!prodOk.desc.size && !prodOk.prod.size) return { erro: `Nenhum produto com "${f.produto}" no nome.` };
    }
    const idx = [];
    for (let i = 0; i < db.n; i++) {
      const d = db.day[i];
      if (d < de || d > ate) continue;
      let ok = true;
      for (const col in sets) if (!sets[col].has(db[col][i])) { ok = false; break; }
      if (!ok) continue;
      if (prodOk && !prodOk.desc.has(db.desc[i]) && !prodOk.prod.has(db.prod[i])) continue;
      idx.push(i);
    }
    return { idx, de, ate };
  }
  const CHAVES = {
    dia: (db, i) => db.iso[i], semana: (db, i) => isoDe(db.day[i] - db.wd[i]), mes: (db, i) => db.ym[i], ano: (db, i) => String(db.year[i]),
    dia_semana: (db, i) => db.wd[i], hora: (db, i) => (db.min[i] != null ? Math.floor(db.min[i] / 60) % 24 : undefined),
    loja: (db, i) => db.D.loja[db.loja[i]], vendedor: (db, i) => db.D.vendedor[db.vend[i]] || '(sem vendedor)', grupo: (db, i) => db.D.grupoC[db.grupoC[i]],
    categoria: (db, i) => db.D.cat[db.cat[i]], produto: (db, i) => db.D.produto[db.prod[i]] || db.D.descricao[db.desc[i]],
  };
  const ROT = { semana: (k) => `semana de ${fmt.date(k).slice(0, 5)}`, dia_semana: (k) => TS.DIAS_SEMANA[k], hora: (k) => `${String(k).padStart(2, '0')}h` };
  const TEMPO = new Set(['dia', 'semana', 'mes', 'ano', 'dia_semana', 'hora']);
  function metricas(idx, M) {
    const db = TS.db, m = TS.metricas(idx);
    const dias = new Set(); for (const i of idx) dias.add(db.day[i]);
    const o = { faturamento: r2(m.vt), itens: Math.round(m.qtd * 10) / 10, cupons: m.cupons, ticket_medio: m.cupons ? r2(m.vt / m.cupons) : null, itens_por_atendimento: m.cupons ? r2(m.qtd / m.cupons) : null, kg_cha: Math.round(m.cha * 1000) / 1000, desconto: r2(m.du), dias_com_venda: dias.size };
    if (M) {
      let c = 0, vtC = 0;
      for (const i of idx) { const x = M.custo(i); if (x != null) { c += x; vtC += db.vt[i] || 0; } }
      o.custo = r2(c); o.lucro_bruto = r2(vtC - c); o.margem_bruta = vtC ? r2((vtC - c) / vtC) : null; o.parte_com_custo = m.vt ? r2(vtC / m.vt) : null;
    }
    return o;
  }
  async function consultarVendas(inp, pode) {
    const x = indices(inp);
    if (x.erro) return { erro: x.erro };
    const por = CHAVES[inp.agrupar_por] ? inp.agrupar_por : 'nenhum';
    const M = inp.incluir_lucro && pode.custos ? await TS.custosLoja() : null;
    const res = { periodo: { de: isoDe(x.de), ate: isoDe(x.ate), dias: x.ate - x.de + 1 }, total: metricas(x.idx, M) };
    if (inp.incluir_lucro && !M) res.aviso_lucro = 'Sem custo disponível (escolha uma loja no painel; o custo vem do estoque do AppNext).';
    if (por !== 'nenhum') {
      const g = TS.agrupar(x.idx, (i) => CHAVES[por](TS.db, i));
      let grupos = [...g].map(([k, idx]) => ({ k, chave: ROT[por] ? ROT[por](k) : String(k), ...metricas(idx, M) }));
      const ord = inp.ordenar_por || (TEMPO.has(por) ? 'chave' : 'faturamento');
      grupos.sort((a, b) => (ord === 'chave' ? (a.k < b.k ? -1 : a.k > b.k ? 1 : 0) : (b[ord] || 0) - (a[ord] || 0)));
      const lim = Math.min(100, inp.limite || (TEMPO.has(por) ? 100 : 30));
      res.grupos_omitidos = Math.max(0, grupos.length - lim);
      res.grupos = grupos.slice(0, lim).map(({ k, ...r }) => r);
    }
    return res;
  }
  function listarValores(inp) {
    const D = TS.db.D;
    const q = TS.norm(inp.busca || '').trim();
    const dic = { lojas: 'loja', vendedores: 'vendedor', grupos: 'grupoC', categorias: 'cat', produtos: 'produto' }[inp.campo];
    if (!dic) return { erro: 'campo inválido' };
    const vals = [...new Set(D[dic].filter((x) => x && x !== '-' && (!q || TS.norm(x).includes(q))))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return { total: vals.length, valores: vals.slice(0, 80) };
  }
  const SEG = { vip: 'vip', fiel: 'fiel', sumido: 'sumido', novo: 'novo', uma_compra: 'uma', hora_de_repor: 'repor', aniversario: 'aniv', pontos_vencendo: 'vence' };
  function consultarClientes(inp, resp) {
    const cli = TS.garantirClientes && TS.garantirClientes();
    if (!cli || !cli.lista) return { erro: 'Sem dados de clientes nesta loja.' };
    const cha = inp.cha ? TS.norm(inp.cha) : null, cid = inp.cidade ? TS.norm(inp.cidade) : null;
    let l = cli.lista.filter((c) => (inp.sem_comprar_ha_dias_min == null || c.ausencia >= inp.sem_comprar_ha_dias_min)
      && (inp.sem_comprar_ha_dias_max == null || c.ausencia <= inp.sem_comprar_ha_dias_max)
      && (inp.gasto_12m_min == null || c.gasto12 >= inp.gasto_12m_min) && (inp.compras_min == null || c.visitas >= inp.compras_min)
      && (!inp.segmento || (c.tags && c.tags.has(SEG[inp.segmento])))
      && (!cha || TS.norm(c.chaFavorito).includes(cha)) && (!cid || TS.norm(c.cidade).includes(cid)));
    const ord = { gasto_12m: (a, b) => b.gasto12 - a.gasto12, ultima_compra: (a, b) => b.ultima - a.ultima, compras: (a, b) => b.visitas - a.visitas, dias_sem_comprar: (a, b) => b.ausencia - a.ausencia }[inp.ordenar_por || 'gasto_12m'];
    l = l.sort(ord);
    if (l.length) resp.clientes.push({ cpfs: l.map((c) => c.cpf), n: l.length });
    const nome = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || '(sem nome)'; };
    const rfm = (c) => (c.rfm && TS.RFM && TS.RFM.por[c.rfm.g] ? TS.RFM.por[c.rfm.g].nome.replace(/^\W+\s*/u, '') : null);
    return {
      total: l.length, gasto_12m_somado: r2(l.reduce((s, c) => s + (c.gasto12 || 0), 0)),
      clientes: l.slice(0, Math.min(50, inp.limite || 20)).map((c) => ({ nome: nome(c.nome), gasto_12m: r2(c.gasto12 || 0), compras: c.visitas, ultima_compra: isoDe(c.ultima), dias_sem_comprar: c.ausencia, cha_favorito: c.chaFavorito || null, cidade: c.cidade || null, grupo: rfm(c) })),
    };
  }
  async function consultarEstoque(inp) {
    if (!state.loja || state.loja === 'todas') return { erro: 'Escolha uma loja no topo do painel para ver o estoque.' };
    const [e, M] = await Promise.all([TS.estoqueBuscar(state.loja), TS.custosLoja()]);
    const itens = e && e.estoque && e.estoque.itens;
    if (!itens || !itens.length || !M) return { erro: 'Ainda não há estoque desta loja no painel.' };
    const db = TS.db, ini = db.maxDay - 29, venda = new Map();
    for (let i = 0; i < db.n; i++) { if (db.day[i] < ini) continue; for (const [it, q] of M.consumo(i)) venda.set(String(it.cod), (venda.get(String(it.cod)) || 0) + q); }
    const q = inp.busca ? TS.norm(inp.busca) : null;
    let l = itens.filter((it) => (it.qtd || 0) > 0 || venda.get(String(it.cod))).map((it) => {
      const vd = (venda.get(String(it.cod)) || 0) / 30;
      return { cod: String(it.cod), produto: it.desc, unidade: it.un === 'Kg' ? 'kg' : (it.un || 'un').toLowerCase(), estoque: Math.round((it.qtd || 0) * 1000) / 1000, venda_dia_30d: Math.round(vd * 1000) / 1000,
        cobertura_dias: vd > 0 ? Math.round((it.qtd || 0) / vd) : null, custo_unit: it.custo != null ? r2(it.custo) : null, valor_estoque: it.custo ? r2(Math.max(0, it.qtd || 0) * it.custo) : null };
    }).filter((x) => (!q || TS.norm(x.produto).includes(q) || x.cod.includes(inp.busca)) && (inp.cobertura_max_dias == null || (x.cobertura_dias != null && x.cobertura_dias <= inp.cobertura_max_dias))
      && (!inp.sem_venda_30d || (x.venda_dia_30d === 0 && x.estoque > 0)));
    const ord = { cobertura: (a, b) => (a.cobertura_dias ?? 1e9) - (b.cobertura_dias ?? 1e9), valor_estoque: (a, b) => (b.valor_estoque || 0) - (a.valor_estoque || 0), venda_dia: (a, b) => b.venda_dia_30d - a.venda_dia_30d, produto: (a, b) => a.produto.localeCompare(b.produto, 'pt-BR') }[inp.ordenar_por || 'valor_estoque'];
    l.sort(ord);
    return { lido_do_appnext_em: e.estoque.em || null, total: l.length, valor_total: r2(l.reduce((s, x) => s + (x.valor_estoque || 0), 0)), itens: l.slice(0, Math.min(100, inp.limite || 30)) };
  }
  async function executar(nome, inp, pode, resp) {
    inp = inp || {};
    try {
      if (nome === 'consultar_vendas') return await consultarVendas(inp, pode);
      if (nome === 'listar_valores') return listarValores(inp);
      if (nome === 'consultar_clientes' && pode.clientes) return consultarClientes(inp, resp);
      if (nome === 'consultar_estoque' && pode.custos) return await consultarEstoque(inp);
      if (nome === 'mostrar_grafico') { resp.graficos.push(inp); return { ok: true }; }
      return { erro: 'Ferramenta indisponível para este perfil.' };
    } catch (e) { return { erro: 'Falha na consulta: ' + e.message }; }
  }
  const PASSO = { consultar_vendas: 'consultando as vendas', listar_valores: 'conferindo os nomes', consultar_clientes: 'consultando os clientes', consultar_estoque: 'consultando o estoque', mostrar_grafico: 'montando o gráfico' };

  // ======================= painel "Pergunte ao painel" =======================
  let conv = null; // { loja, mensagens:[API], vis:[{eu}|{ia}] }
  let ocupado = false;
  const pode = () => ({ clientes: !!(TS.eu && TS.eu.pode && TS.eu.pode.clientes) && !!(TS.db && TS.db.clientes), custos: !!(TS.eu && TS.eu.pode && (TS.eu.pode.custos || TS.eu.pode.configurar)) && state.loja !== 'todas' });
  function contexto() {
    const db = TS.db, hoje = TS.hojeSP();
    const nomeLoja = state.loja === 'todas' ? 'Todas as lojas' : ((TS.lojas || []).find((l) => l.id === state.loja) || {}).nome || state.loja;
    return { hoje, diaSemana: TS.DIAS_SEMANA[(new Date(hoje + 'T12:00:00Z').getUTCDay() + 6) % 7], loja: nomeLoja, lojas: db ? db.D.loja.filter(Boolean) : [], desde: db ? isoDe(db.minDay) : '', ate: db ? isoDe(db.maxDay) : '', parcial: !!(db && db.desde) };
  }
  function sugestoes() {
    const p = pode();
    return [
      'Quanto vendemos este mês comparado ao mesmo período do ano passado?',
      'Quem foram as vendedoras que mais venderam nos últimos 30 dias, com ticket médio?',
      'Em que dia da semana e horário vendemos mais nos últimos 90 dias?',
      p.clientes ? 'Quais bons clientes estão sumidos há mais de 60 dias?' : null,
      p.custos ? 'O que está parado no estoque há 30 dias sem vender?' : null,
      'Quais chás cresceram e quais caíram nos últimos 3 meses contra os 3 anteriores?',
    ].filter(Boolean);
  }

  TS.iaInit = function (eu) {
    if (!eu || !['admin', 'franqueado', 'gerente'].includes(eu.perfil) || document.getElementById('btnIA')) return;
    const b = h('button', { class: 'icon-btn ia-btn', id: 'btnIA', type: 'button', title: 'Pergunte ao painel (IA)', 'aria-label': 'Pergunte ao painel (IA)', onclick: () => abrir() }, '✨');
    const alvo = document.querySelector('.topbar-right');
    const upd = document.getElementById('updated');
    if (alvo) alvo.insertBefore(b, upd ? upd.nextSibling : alvo.firstChild);
  };
  TS.iaAbrir = (pergunta) => abrir(pergunta);

  let painel = null;
  function abrir(pergunta) {
    if (painel && painel.isConnected) { painel.querySelector('textarea').focus(); return; }
    if (!conv || conv.loja !== state.loja) conv = { loja: state.loja, mensagens: [], vis: [] };
    const lista = h('div', { class: 'ia-lista', 'aria-live': 'polite' });
    const txt = h('textarea', { class: 'f-input ia-txt', rows: 2, maxlength: 2000, placeholder: 'Pergunte sobre vendas, vendedoras, clientes, estoque…' });
    const env = h('button', { type: 'button', class: 'btn primary ia-env' }, 'Enviar');
    const aviso = h('div', { class: 'ia-aviso' });
    const fechar = () => { camada.remove(); document.removeEventListener('keydown', esc); if (!document.querySelector('.camada-cheia, .prc-drawer-camada')) document.body.classList.remove('com-camada'); };
    const esc = (e) => { if (e.key === 'Escape' && camada.isConnected && document.querySelector('.prc-drawer-camada:last-of-type') === camada) fechar(); };
    const nova = h('button', { type: 'button', class: 'link-btn', onclick: () => { if (ocupado) return; conv = { loja: state.loja, mensagens: [], vis: [] }; pintarLista(); txt.focus(); } }, 'Nova conversa');
    const nomeLoja = contexto().loja;
    const gaveta = h('div', { class: 'card prc-drawer ia-gaveta', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pergunte ao painel' },
      h('button', { type: 'button', class: 'exp-fechar', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      h('div', { class: 'ia-cab' }, h('div', { class: 'card-title' }, '✨ Pergunte ao painel'), h('div', { class: 'muted ia-sub' }, nomeLoja, ' · ', nova)),
      aviso, lista,
      h('div', { class: 'ia-rodape' }, txt, env),
      h('small', { class: 'muted ia-nota' }, 'A IA só consulta os dados que você já vê no painel e pode errar: confira os números importantes. Clientes vão só com o primeiro nome.'));
    const camada = h('div', { class: 'prc-drawer-camada ia-camada', onclick: (e) => { if (e.target === camada) fechar(); } }, gaveta);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', esc);
    painel = camada;
    const enviar = () => { const q = txt.value.trim(); if (!q || ocupado) return; txt.value = ''; perguntar(q); };
    env.addEventListener('click', enviar);
    txt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });

    function pintarLista() {
      if (!conv.vis.length) {
        lista.replaceChildren(h('div', { class: 'ia-vazio' }, h('p', null, 'Pergunte em português, como perguntaria a um analista. Exemplos:'),
          h('div', { class: 'ia-sugs' }, sugestoes().map((s) => h('button', { type: 'button', class: 'ia-sug', onclick: () => perguntar(s) }, s)))));
        return;
      }
      lista.replaceChildren(...conv.vis.map(itemVis));
      lista.scrollTop = lista.scrollHeight;
    }
    function itemVis(v) {
      if (v.eu) return h('div', { class: 'ia-msg ia-eu' }, v.eu);
      const r = v.ia;
      return h('div', { class: 'ia-msg ia-ela' + (r.erro ? ' ia-erro' : '') },
        r.passos.length ? h('div', { class: 'ia-passos' }, r.passos.map((p) => h('span', null, (r.fim || r.erro ? '✓ ' : '… ') + p))) : null,
        r.erro ? h('p', null, r.erro) : null,
        r.texto ? TS.iaMd(r.texto) : !r.fim && !r.erro ? h('div', { class: 'ia-pensando' }, h('span', { class: 'cfg-pulso' }), ' pensando…') : null,
        ...r.graficos.map(grafico),
        ...r.clientes.map((c) => h('button', { type: 'button', class: 'btn ia-cli', onclick: () => { fechar(); TS.abrirClientes && TS.abrirClientes(c.cpfs); } }, `👥 Abrir ${fmt.int(c.n)} ${c.n === 1 ? 'cliente' : 'clientes'} no painel`)),
        r.fim && r.texto ? h('div', { class: 'ia-acoes' }, h('button', { type: 'button', class: 'link-btn', onclick: (e) => { navigator.clipboard && navigator.clipboard.writeText(r.texto); e.target.textContent = 'copiado ✓'; } }, 'copiar resposta')) : null);
    }
    async function perguntar(q) {
      if (ocupado) return;
      if (!TS.db) { aviso.replaceChildren(h('div', { class: 'notice' }, 'Espere os dados da loja carregarem.')); return; }
      ocupado = true; env.disabled = true; aviso.replaceChildren();
      const base = conv.mensagens.length;
      conv.mensagens.push({ role: 'user', content: q });
      const r = { passos: [], texto: '', graficos: [], clientes: [], fim: false, erro: null };
      conv.vis.push({ eu: q }, { ia: r });
      pintarLista();
      const pd = pode();
      try {
        for (let rodada = 0; rodada < 10; rodada++) {
          const j = await iaApi('POST', 'ia/perguntar', { loja: state.loja, mensagens: conv.mensagens, contexto: contexto() });
          const content = j.content && j.content.length ? j.content : [{ type: 'text', text: '(sem resposta)' }];
          conv.mensagens.push({ role: 'assistant', content });
          const textos = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n').trim();
          const usos = content.filter((b) => b.type === 'tool_use');
          if (j.stop_reason !== 'tool_use' || !usos.length) { r.texto = textos; break; }
          const res = [];
          for (const u of usos) {
            r.passos.push(PASSO[u.name] || u.name); pintarLista();
            const out = await executar(u.name, u.input, pd, r);
            let s = JSON.stringify(out);
            if (s.length > 50000) s = s.slice(0, 50000) + '…(cortado)';
            res.push({ type: 'tool_result', tool_use_id: u.id, content: s });
          }
          conv.mensagens.push({ role: 'user', content: res });
          if (rodada === 9) r.texto = textos || 'A pergunta precisou de consultas demais. Tente dividir em perguntas menores.';
        }
        r.fim = true;
      } catch (e) {
        conv.mensagens.length = base; // volta a conversa ao ponto antes da pergunta
        r.erro = e.message; r.fim = true;
      }
      ocupado = false; env.disabled = false;
      pintarLista();
      txt.focus();
    }
    pintarLista();
    // estado: avisa logo se a loja não tem chave
    iaApi('GET', `ia/estado?loja=${encodeURIComponent(state.loja || '')}`).then((s) => {
      if (s.ativa) return;
      aviso.replaceChildren(h('div', { class: 'notice' }, s.podeConfigurar
        ? h('span', null, 'A IA ainda não está ligada nesta loja. ', h('a', { href: '#config', onclick: () => { state.cfgAba = 'ia'; fechar(); } }, 'Cadastre sua chave da Anthropic em Configurações → Inteligência artificial'), '.')
        : 'A IA ainda não está ligada nesta loja: peça ao franqueado para cadastrar a chave em Configurações.'));
    }).catch(() => {});
    if (typeof pergunta === 'string' && pergunta.trim()) perguntar(pergunta.trim()); else setTimeout(() => txt.focus(), 50);
  }

  const CORES = ['#2C5234', '#C9A227', '#7FA37A', '#B5452B', '#6B7A70'];
  function grafico(g) {
    const fmtV = g.formato === 'moeda' ? fmt.brl0 : g.formato === 'percentual' ? (v) => fmt.pct(v > 1.5 ? v / 100 : v) : fmt.int;
    const linha = g.tipo === 'linha';
    const cfg = {
      type: linha ? 'line' : 'bar',
      data: { labels: (g.rotulos || []).map(String), datasets: (g.series || []).slice(0, 5).map((s, k) => ({ label: s.nome, data: s.valores, backgroundColor: CORES[k], borderColor: CORES[k], borderWidth: linha ? 2 : 0, tension: 0.3, pointRadius: linha ? 2 : 0, borderRadius: 4 })) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: (g.series || []).length > 1 }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtV(c.parsed.y)}` } } }, scales: { y: { ticks: { callback: (v) => fmtV(v) } } } },
      legendaChave: 'ia|' + (g.titulo || ''),
    };
    return h('div', { class: 'ia-graf' }, g.titulo ? h('div', { class: 'ia-graf-t' }, g.titulo) : null, TS.chart(cfg, 'ia-graf-box'));
  }

  // ======================= revisão do pedido =======================
  TS.iaPedido = (loja, dados) => iaApi('POST', 'ia/pedido', { loja, dados });

  // ======================= Configurações → Inteligência artificial =======================
  let cfgDados = null, cfgMsg = null, formAberto = false;
  TS.abaIA = function (box, repintar) {
    const corpo = h('div');
    box.append(corpo);
    const pintarCfg = () => {
      if (!cfgDados) { corpo.replaceChildren(h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('p', null, 'Carregando…'))); return; }
      if (cfgDados.erro) { corpo.replaceChildren(h('div', { class: 'notice err' }, cfgDados.erro)); return; }
      const d = cfgDados;
      const nomeLoja = (id) => (d.porLoja.find((l) => l.loja === id) || {}).nome || id;
      const semChave = d.porLoja.filter((l) => !l.chave);
      const usd = (v) => 'US$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const msg = cfgMsg ? h('div', { class: 'notice ' + cfgMsg[0] }, cfgMsg[1]) : null;
      cfgMsg = null;
      const cartaoChave = (k) => {
        const pct = k.teto ? Math.min(1, k.uso.usd / k.teto) : 0;
        const teto = h('input', { class: 'f-input', type: 'number', min: 1, max: 1000, step: 1, value: k.teto ?? '', placeholder: 'sem teto', style: { maxWidth: '110px' } });
        const btTeto = h('button', { type: 'button', class: 'btn' }, 'Salvar teto');
        btTeto.addEventListener('click', async () => {
          btTeto.disabled = true;
          try { await iaApi('PATCH', `ia/chave/${k.id}`, { teto: teto.value === '' ? null : +teto.value }); cfgMsg = ['ok', 'Teto salvo.']; await recarregar(); } catch (e) { cfgMsg = ['err', e.message]; pintarCfg(); }
        });
        const btRem = h('button', { type: 'button', class: 'btn danger' }, 'Remover chave');
        btRem.addEventListener('click', async () => {
          if (!confirm(`Remover a chave terminada em ${k.fim}?\n\nA IA fica desligada em ${k.lojas.map(nomeLoja).join(', ')} até cadastrar outra. A chave continua existindo no console da Anthropic: desative lá também se não for usar mais.`)) return;
          btRem.disabled = true;
          try { await iaApi('DELETE', `ia/chave/${k.id}`); cfgMsg = ['ok', 'Chave removida.']; await recarregar(); } catch (e) { cfgMsg = ['err', e.message]; pintarCfg(); }
        });
        return h('div', { class: 'card ia-chave' },
          h('div', { class: 'ia-chave-cab' }, h('span', { class: 'cf-st cf-ok' }, 'Chave configurada ✓'), h('b', null, ` ···· ${k.fim}`),
            h('small', { class: 'muted' }, ` · cadastrada por ${k.dono}${k.criadaEm ? ' em ' + fmt.date(k.criadaEm.slice(0, 10)) : ''}`)),
          h('div', null, 'Vale para: ', h('b', null, k.lojas.map(nomeLoja).join(', ')), k.outrasLojas ? h('small', { class: 'muted' }, ` + ${k.outrasLojas} loja(s) de outros usuários`) : null),
          h('div', { class: 'ia-uso' },
            h('div', null, 'Uso neste mês: ', h('b', null, usd(k.uso.usd)), k.teto ? ` de ${usd(k.teto)}` : ' (sem teto)', h('small', { class: 'muted' }, ` · ${fmt.int(k.uso.pedidos)} chamadas à IA · estimativa`)),
            k.teto ? h('div', { class: 'ia-barra' }, h('span', { style: { width: `${pct * 100}%` }, class: pct >= 0.9 ? 'alto' : null })) : null),
          k.podeMexer ? h('div', { class: 'cfg-acoes ia-chave-acoes' }, h('label', null, 'Teto por mês (US$) ', teto), btTeto, h('button', { type: 'button', class: 'btn', onclick: () => { formAberto = true; pintarCfg(); } }, 'Trocar a chave'), btRem)
            : h('small', { class: 'muted' }, 'Só quem cadastrou (ou o admin) muda esta chave.'));
      };
      // formulário: a chave vai direto para o servidor (campo de senha, sem autocompletar) e nunca volta
      const form = () => {
        const inp = h('input', { class: 'f-input', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-…', style: { maxWidth: '420px' } });
        const marcadas = new Set(semChave.length ? semChave.map((l) => l.loja) : d.porLoja.map((l) => l.loja));
        const cks = d.porLoja.map((l) => {
          const c = h('input', { type: 'checkbox', checked: marcadas.has(l.loja) || null });
          c.addEventListener('change', () => { if (c.checked) marcadas.add(l.loja); else marcadas.delete(l.loja); });
          return h('label', { class: 'ia-ck' }, c, ' ', l.nome, l.chave ? h('small', { class: 'muted' }, ' (troca a chave atual)') : null);
        });
        const teto = h('input', { class: 'f-input', type: 'number', min: 1, max: 1000, step: 1, value: d.tetoPadrao, style: { maxWidth: '110px' } });
        const bt = h('button', { type: 'button', class: 'btn primary' }, 'Testar e salvar');
        const st = h('span', { class: 'muted' });
        bt.addEventListener('click', async () => {
          if (!/^sk-ant-/.test(inp.value.trim())) { st.className = 'neg'; st.textContent = 'A chave começa com "sk-ant-". Copie de novo no console da Anthropic.'; return; }
          if (!marcadas.size) { st.className = 'neg'; st.textContent = 'Marque pelo menos uma loja.'; return; }
          bt.disabled = true; st.className = 'muted'; st.textContent = 'Testando a chave na Anthropic…';
          try {
            const j = await iaApi('PUT', 'ia/chave', { chave: inp.value.trim(), lojas: [...marcadas], teto: teto.value === '' ? null : +teto.value });
            inp.value = '';
            formAberto = false;
            cfgMsg = ['ok', `Chave ···· ${j.fim} conferida e salva. A IA já está ligada: use o botão ✨ no topo.`];
            await recarregar();
          } catch (e) { st.className = 'neg'; st.textContent = e.message; bt.disabled = false; }
        });
        return h('div', { class: 'card ia-form' },
          h('div', { class: 'card-title' }, d.chaves.length ? 'Cadastrar outra chave' : 'Cadastrar a sua chave'),
          h('label', { class: 'cfr-campo' }, h('span', null, 'Chave da API (Anthropic)'), inp),
          h('div', { class: 'ia-cks' }, h('span', null, 'Lojas que usam esta chave:'), cks),
          h('label', null, 'Teto por mês (US$) ', teto, h('small', { class: 'muted' }, ' a IA pausa ao chegar nele; vazio = sem teto')),
          h('div', { class: 'cfg-acoes' }, bt, d.chaves.length ? h('button', { type: 'button', class: 'btn', onclick: () => { formAberto = false; pintarCfg(); } }, 'Cancelar') : null, st),
          h('small', { class: 'muted' }, 'A chave é testada na Anthropic e guardada criptografada no servidor. Ela nunca mais aparece na tela, em e-mail ou em log: só os 4 últimos caracteres.'));
      };
      corpo.replaceChildren(...[
        h('div', { class: 'card' },
          h('div', { class: 'card-title' }, 'Inteligência artificial'),
          h('p', null, 'Com a IA ligada, o botão ✨ no topo responde perguntas sobre as vendas, a equipe, os clientes e o estoque, e a aba Pedido ganha a revisão do pedido sugerido. '
            + 'Cada franqueado usa a própria conta da Anthropic (a empresa do Claude): o uso é cobrado direto no cartão de quem cadastrou a chave.'),
          h('p', { class: 'muted' }, `Quanto custa: uma pergunta comum fica em torno de US$ 0,01 a 0,05 (estimativa pelo preço de ${usd(d.preco.entrada)} por milhão de tokens de entrada e ${usd(d.preco.saida)} de saída). Uma loja que pergunta todo dia gasta poucos dólares por mês.`),
          h('details', { class: 'ia-passo' }, h('summary', null, 'Como criar a chave (5 minutos)'), h('ol', { class: 'cfg-passos' },
            h('li', null, 'Entre em ', h('a', { href: 'https://console.anthropic.com', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'), ' e crie uma conta com o seu e-mail.'),
            h('li', null, 'Em ', h('b', null, 'Billing'), ', cadastre o cartão e compre créditos (US$ 5 ou 10 bastam para começar). Ali também dá para pôr um limite de gasto por mês.'),
            h('li', null, 'Em ', h('b', null, 'API keys'), ', clique em ', h('b', null, 'Create key'), ', dê um nome (ex.: "Painel Tea Shop") e copie a chave (começa com sk-ant-).'),
            h('li', null, 'Cole aqui embaixo, marque as lojas e clique em ', h('b', null, 'Testar e salvar'), '. Não mande a chave por WhatsApp nem e-mail.')))),
        msg,
        ...d.chaves.map(cartaoChave),
        semChave.length && d.chaves.length ? h('div', { class: 'notice' }, `Sem chave (IA desligada): ${semChave.map((l) => l.nome).join(', ')}.`) : null,
        !d.chaves.length || formAberto || semChave.length ? form() : h('button', { type: 'button', class: 'btn', onclick: () => { formAberto = true; pintarCfg(); } }, '＋ Cadastrar outra chave')].filter(Boolean));
    };
    const recarregar = async () => { try { cfgDados = await iaApi('GET', 'ia/config'); } catch (e) { cfgDados = { erro: e.message }; } if (corpo.isConnected) pintarCfg(); };
    pintarCfg();
    recarregar();
  };
})();
