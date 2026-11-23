/* Vendas → Orçamento: pedidos de empresas (brindes, kits, eventos). Só admin e franqueado (mostra custo e margem).
 * O franqueado monta na hora vendo a margem bruta e a líquida (royalties, Simples, maquininha, comissão e outros
 * custos da loja) e decide o desconto. O documento para o cliente (imprimir / PDF / WhatsApp) não mostra custo. */
(function () {
  const { h, fmt, state } = TS;
  const toast = (msg, erro) => { const t = h('div', { class: 'toast' + (erro ? ' err' : '') }, msg); document.body.append(t); setTimeout(() => t.remove(), erro ? 6000 : 3000); };
  const SIT = { rascunho: ['Rascunho', 'cf-cinza'], enviado: ['Enviado', 'cf-aberto'], aprovado: ['Aprovado', 'cf-ok'], perdido: ['Perdido', 'cf-atrasado'] };
  const PAG = { pix: 'PIX', boleto: 'Boleto', cartao: 'Cartão', dinheiro: 'Dinheiro' };
  const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : fmt.pct(v, 1));
  const num = (v) => { const x = Number(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
  // campo digitado: "1.234,56" (milhar com ponto), "1234,56" ou "123.45" (teclado com ponto decimal)
  const numIn = (v) => { const t = String(v ?? '').trim(); const x = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(x) ? x : 0; };

  // apresentação: nada é salvo no servidor (fica na memória da página)
  const DEMO = { lista: [], n: 0 };
  async function api(metodo, p, corpo) {
    if (TS.demo) {
      if (metodo === 'GET') return { orcamentos: DEMO.lista };
      if (p.endsWith('/situacao')) { const o = DEMO.lista.find((x) => p.includes(x.id)); Object.assign(o, { situacao: corpo.situacao, motivoPerda: corpo.motivo || undefined }); return { ok: o }; }
      if (metodo === 'DELETE') { DEMO.lista = DEMO.lista.filter((x) => !p.includes(x.id)); return { ok: true }; }
      const o = corpo.id ? Object.assign(DEMO.lista.find((x) => x.id === corpo.id), corpo) : { ...corpo, id: 'demo' + (++DEMO.n), numero: DEMO.n, situacao: 'rascunho', criadoEm: new Date().toISOString(), criadoPor: 'apresentacao' };
      if (!corpo.id) DEMO.lista.unshift(o);
      return { ok: o };
    }
    const r = await fetch('/api/' + p, { method: metodo, credentials: 'same-origin', headers: corpo || metodo !== 'GET' ? { 'Content-Type': 'application/json', 'X-Painel': '1' } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha.');
    return j;
  }

  /** catálogo: produtos da tabela de preço (com preço) + custo de 1 unidade + quanto há em estoque */
  async function catalogo(loja) {
    const [x, M] = await Promise.all([TS.estoqueBuscar(loja), TS.custosLoja()]);
    const est = new Map(((x.estoque && x.estoque.itens) || []).map((i) => [String(i.cod), i]));
    const itens = ((x.tabela && x.tabela.itens) || []).filter((t) => t.preco > 0.011).map((t) => {
      const c = M ? M.custoCadastro(t.cod, t.desc) : null;
      let disp = null;
      const e = est.get(String(t.cod));
      if (e && e.un !== 'Kg') disp = e.qtd;
      else if (c && c.kg && c.it && c.g) disp = Math.floor(((c.it.qtd || 0) * 1000) / c.g);
      return { cod: String(t.cod), nome: t.desc, grupo: t.grupo || '', preco: t.preco, custo: c ? Math.round(c.custo * 100) / 100 : null, disp, composto: !!t.composto };
    });
    const taxas = M && M.ded && M.ded.taxasVenda ? M.ded.taxasVenda() : { roy: 0, imp: 0, maq: 0, com: 0, outrosPct: 0, outrosFix: 0 };
    return { itens, porCod: new Map(itens.map((i) => [i.cod, i])), taxas };
  }

  /** a conta do orçamento: total, custo, lucro bruto, deduções e lucro líquido */
  function conta(o, taxas) {
    let bruto = 0, liq = 0, custo = 0, semCusto = 0;
    const linhas = o.itens.map((i) => {
      const v = i.qtd * i.preco, l = v * (1 - (i.desc || 0) / 100);
      bruto += v; liq += l;
      if (i.custo == null) semCusto++; else custo += i.qtd * i.custo;
      const pu = i.preco * (1 - (i.desc || 0) / 100) * (1 - (o.descGeral || 0) / 100);
      return { ...i, total: l, margem: i.custo != null && pu > 0 ? (pu - i.custo) / pu : null };
    });
    const produtos = liq * (1 - (o.descGeral || 0) / 100);
    const total = produtos + (o.frete || 0);
    custo += o.custoExtra || 0;
    const lucro = produtos - custo;
    const t = taxas || {};
    const ded = {
      roy: produtos * (t.roy || 0), imp: total * (t.imp || 0), maq: o.pagamento === 'cartao' ? total * (t.maq || 0) : 0,
      com: o.comissao ? produtos * (t.com || 0) : 0, outros: produtos * (t.outrosPct || 0), fixos: produtos * (t.outrosFix || 0),
    };
    const dedTot = ded.roy + ded.imp + ded.maq + ded.com + ded.outros + ded.fixos;
    const liquido = lucro + (o.frete || 0) - dedTot;
    return { linhas, bruto, desconto: bruto - produtos, produtos, total, custo, lucro, mBruta: produtos ? lucro / produtos : null, ded, dedTot, liquido, mLiq: total ? liquido / total : null, semCusto };
  }

  TS.pages.orcamento = function (root) {
    if (TS.subGrupo) root.append(TS.subGrupo('orcamento'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Orçamento'),
      h('div', { class: 'page-sub' }, 'Pedidos de empresas: monte com a margem bruta e a líquida na tela, imprima ou mande pelo WhatsApp e acompanhe até virar venda'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'O orçamento é de uma loja: escolha a loja no seletor do topo.')); return; }
    const corpo = h('div', { class: 'mt' }, h('div', { class: 'card' }, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Carregando os produtos e os custos…')))));
    root.append(corpo);
    const loja = state.loja;
    // parceiros do AppNext (os mesmos da NF-e de saída): empresas com CNPJ que não aparecem na base de clientes
    const parceiros = api('GET', `nfe?loja=${encodeURIComponent(loja)}`).then((x) => (x && x.cadastros && x.cadastros.parceiros) || []).catch(() => []);
    Promise.all([catalogo(loja), api('GET', `orcamentos?loja=${encodeURIComponent(loja)}`), parceiros]).then(([cat, j, parc]) => {
      if (!corpo.isConnected) return;
      const lista = j.orcamentos || [];
      cat.parceiros = parc;
      const aberto = state.orcAberto && (state.orcAberto === 'novo' ? {} : lista.find((o) => o.id === state.orcAberto));
      cat.orcAnteriores = lista;
      if (aberto) editor(corpo, loja, cat, aberto); else telaLista(corpo, loja, cat, lista);
    }).catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  };

  // ---------- lista ----------
  function telaLista(corpo, loja, cat, lista) {
    const fil = ['todos', 'rascunho', 'enviado', 'aprovado', 'perdido'].includes(state.orcFil) ? state.orcFil : 'todos';
    const rows = lista.map((o) => { const c = conta(o, cat.taxas); return { ...o, cli: o.cliente.empresa || o.cliente.contato, valor: c.total, mBruta: c.mBruta, mLiq: c.mLiq }; })
      .filter((o) => fil === 'todos' || o.situacao === fil);
    const conta0 = (s) => lista.filter((o) => o.situacao === s).length;
    const aprov = lista.filter((o) => o.situacao === 'aprovado'), dec = lista.filter((o) => o.situacao === 'aprovado' || o.situacao === 'perdido');
    const valorAprov = aprov.reduce((s, o) => s + conta(o, cat.taxas).total, 0);
    const abrir = (id) => { state.orcAberto = id; TS.render(); };
    const tab = TS.table({
      cols: [
        { key: 'numero', label: 'Nº', render: (o) => h('b', null, `#${o.numero}`), sortVal: (o) => o.numero },
        { key: 'cli', label: 'Cliente', align: 'l', wrap: true, render: (o) => h('span', null, o.cli, h('small', { class: 'est-tam' }, `${fmt.date(o.criadoEm.slice(0, 10))}${o.titulo ? ' · ' + o.titulo : ''}`)) },
        { key: 'valor', label: 'Total', fmt: fmt.brl },
        { key: 'mBruta', label: 'Margem bruta', fmt: pct },
        { key: 'mLiq', label: 'Margem líquida', render: (o) => h('span', { class: o.mLiq < 0 ? 'neg' : '' }, pct(o.mLiq)), sortVal: (o) => o.mLiq ?? -9 },
        { key: 'situacao', label: 'Situação', align: 'l', render: (o) => { const [t, cls] = SIT[o.situacao] || [o.situacao, '']; return h('span', null, h('span', { class: 'cf-st ' + cls }, t), o.motivoPerda ? h('small', { class: 'muted' }, ' · ' + o.motivoPerda) : null); } },
      ],
      rows, sortKey: 'numero', pageSize: 15, search: 'Buscar cliente…', searchKeys: ['cli', 'titulo'], cls: 'est-t', onRowClick: (o) => abrir(o.id),
      empty: lista.length ? 'Nenhum orçamento com esse filtro.' : 'Nenhum orçamento ainda. Comece com "Novo orçamento".',
    });
    corpo.replaceChildren(
      // herói (redesenho de 22/11): em aberto decide (a quem responder), aprovados e a taxa de conversão;
      // 2ª passada (23/11/2026): a ação principal "+ Novo orçamento" fica ao lado do número que decide, não solta acima
      TS.heroi([
        { rot: 'Em aberto', num: fmt.int(conta0('rascunho') + conta0('enviado')), linhas: [`${fmt.int(conta0('enviado'))} enviado(s) esperando resposta`, `${fmt.int(conta0('rascunho'))} rascunho(s)`,
          { el: h('button', { type: 'button', class: 'btn primary vp2-acao', onclick: () => abrir('novo') }, '+ Novo orçamento') }],
          dica: 'Orçamentos em rascunho ou enviados ao cliente e ainda sem resposta.' },
        { rot: 'Aprovados', num: fmt.int(aprov.length), linhas: [fmt.brl(valorAprov)], dica: 'Orçamentos que o cliente aprovou e o valor somado deles.' },
        { rot: 'Taxa de conversão', num: dec.length ? fmt.pct(aprov.length / dec.length, 0) : '—', linhas: ['aprovados ÷ (aprovados + perdidos)', `${fmt.int(conta0('perdido'))} perdido(s) · veja o motivo de cada um`],
          dica: 'Aprovados ÷ (aprovados + perdidos). Os em aberto ficam fora até terem resposta.' },
      ]),
      h('div', { class: 'mt' }, TS.card('Orçamentos', 'Clique no orçamento para abrir, editar, imprimir ou mandar pelo WhatsApp.',
        h('div', { class: 'est-tools' }, tab.searchBox, TS.seg([['Todos', 'todos'], [`Rascunho (${conta0('rascunho')})`, 'rascunho'], [`Enviados (${conta0('enviado')})`, 'enviado'], [`Aprovados (${conta0('aprovado')})`, 'aprovado'], [`Perdidos (${conta0('perdido')})`, 'perdido']], fil, (v) => { state.orcFil = v; telaLista(corpo, loja, cat, lista); })),
        tab)));
  }

  // ---------- editor ----------
  function editor(corpo, loja, cat, orig) {
    const o = JSON.parse(JSON.stringify({ cliente: {}, itens: [], descGeral: 0, frete: 0, custoExtra: 0, pagamento: 'pix', comissao: false, validadeDias: 7, entrega: '', obs: '', titulo: '', ...orig }));
    const travado = o.situacao === 'aprovado';
    const voltar = () => { state.orcAberto = null; TS.render(); };
    const painel = h('div', { class: 'orc-painel card' });
    const linhasBox = h('div');
    const campo = (rot, el, cls) => h('label', { class: 'cfr-campo ' + (cls || '') }, h('span', null, rot), el);
    // cliente: busca na base de clientes (CPF/CNPJ das notas, FIXE) e nos orçamentos anteriores
    if (TS.garantirClientes) { try { TS.garantirClientes(); } catch { /* sem base */ } }
    const docFmt = (d) => { const x = String(d || '').replace(/\D/g, ''); return x.length === 14 ? `${x.slice(0, 2)}.${x.slice(2, 5)}.${x.slice(5, 8)}/${x.slice(8, 12)}-${x.slice(12)}` : x.length === 11 ? `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}` : d || ''; };
    const telFmt = (t) => { const x = String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return x.length === 11 ? `(${x.slice(0, 2)}) ${x.slice(2, 7)}-${x.slice(7)}` : x.length === 10 ? `(${x.slice(0, 2)}) ${x.slice(2, 6)}-${x.slice(6)}` : t || ''; };
    const infoCli = h('div', { class: 'orc-cli-info' });
    const pintarInfo = () => {
      const c = o.cliente.cpf && TS.cli && TS.cli.porCPF ? TS.cli.porCPF.get(o.cliente.cpf) : null;
      const pa = o.cliente.cpf ? (cat.parceiros || []).find((x) => String(x.doc || '').replace(/\D/g, '') === o.cliente.cpf) : null;
      if (!c) { infoCli.replaceChildren(...(pa ? [h('span', { class: 'cf-st cf-ok' }, 'Parceiro no AppNext'), ' ', h('small', null, 'a NF-e de venda já sai para este cadastro')] : [])); return; }
      infoCli.replaceChildren(h('span', { class: 'cf-st cf-ok' }, 'Cliente da base'), ' ',
        h('small', null, [c.ultima != null ? `última compra ${fmt.date(TS.dayToIso(c.ultima))}` : '', c.gasto12 ? `${fmt.brl0(c.gasto12)} nos últimos 12 meses` : '', c.cupons ? `${fmt.int(c.cupons.length)} compra(s)` : '', c.chaFavorito ? `gosta de ${c.chaFavorito}` : ''].filter(Boolean).join(' · ')));
    };
    const candidatos = (q) => {
      const n = TS.norm(q), dig = q.replace(/\D/g, '');
      const out = [], vistos = new Set();
      for (const a of cat.orcAnteriores || []) {
        const k = (a.cliente.doc || '').replace(/\D/g, '') || TS.norm(a.cliente.empresa || a.cliente.contato);
        if (vistos.has(k)) continue;
        if (TS.norm(`${a.cliente.empresa} ${a.cliente.contato}`).includes(n) || (dig.length >= 3 && (a.cliente.doc || '').replace(/\D/g, '').includes(dig))) { vistos.add(k); out.push({ fonte: `orçamento #${a.numero}`, ...a.cliente }); }
      }
      for (const p of cat.parceiros || []) {
        if (out.length >= 10) break;
        const d = String(p.doc || '').replace(/\D/g, '');
        if (!d || vistos.has(d)) continue;
        if (TS.norm(p.nome).includes(n) || (dig.length >= 3 && d.includes(dig))) {
          vistos.add(d);
          const pj = d.length === 14;
          out.push({ fonte: 'parceiro no AppNext', empresa: pj ? p.nome : '', contato: pj ? '' : p.nome, doc: docFmt(d), cpf: d });
        }
      }
      for (const c of (TS.cli && TS.cli.lista) || []) {
        if (out.length >= 10) break;
        if (vistos.has(c.cpf)) continue;
        if (TS.norm(c.nome).includes(n) || (dig.length >= 4 && c.cpf.includes(dig))) {
          vistos.add(c.cpf);
          out.push({ fonte: c.empresa ? 'cliente (CNPJ)' : 'cliente', empresa: c.empresa ? c.nome : '', contato: c.empresa ? '' : c.nome, doc: docFmt(c.cpf), cpf: c.cpf, telefone: telFmt(c.celular), email: c.email || '', extra: c.ultima != null ? `última compra ${fmt.date(TS.dayToIso(c.ultima))}` : '' });
        }
      }
      return out.slice(0, 10);
    };
    const campos = {};
    const preencher = (x) => {
      for (const k of ['empresa', 'contato', 'doc', 'telefone', 'email']) if (x[k]) { o.cliente[k] = x[k]; if (campos[k]) campos[k].value = x[k]; }
      o.cliente.cpf = x.cpf || String(x.doc || '').replace(/\D/g, '');
      pintarInfo();
    };
    // CNPJ completo de empresa que não está na base: dados públicos da Receita (BrasilAPI) preenchem o que estiver vazio
    const infoRec = h('div', { class: 'orc-rec-info np-consulta' });
    let ultimoCnpj = '';
    const consultarCnpj = async () => {
      const d = String(o.cliente.doc || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
      if (travado || !TS.brasil.pareceCnpj(d) || d === ultimoCnpj) return;
      ultimoCnpj = d;
      infoRec.className = 'orc-rec-info np-consulta muted'; infoRec.textContent = 'Consultando o CNPJ na Receita…';
      try {
        const e = await TS.brasil.cnpj(d);
        if (d !== ultimoCnpj) return;
        if (!e) { infoRec.className = 'orc-rec-info np-consulta neg'; infoRec.textContent = 'CNPJ não encontrado na Receita: confira os números.'; return; }
        const por = (k, val) => { if (!val || String(o.cliente[k] || '').trim()) return; o.cliente[k] = val; if (campos[k]) campos[k].value = val; };
        por('empresa', e.razaoSocial); por('telefone', telFmt(e.telefone)); por('email', e.email);
        if (!o.cliente.cpf) o.cliente.cpf = d;
        infoRec.className = 'orc-rec-info np-consulta ' + (e.ativa ? 'pos' : 'neg');
        infoRec.textContent = (e.ativa ? '✓ Receita: empresa ativa' : `Atenção: na Receita a empresa está ${String(e.situacao || 'sem situação').toLowerCase()}`) + (e.nomeFantasia ? ` · ${e.nomeFantasia}` : '') + ` · ${TS.brasil.enderecoTxt(e)}`;
      } catch (err) { infoRec.className = 'orc-rec-info np-consulta muted'; infoRec.textContent = err.message; ultimoCnpj = ''; }
    };
    let tCnpj = null;
    const autoCli = (k, attrs) => {
      const el = inp(o.cliente, k, attrs);
      campos[k] = el;
      if (k === 'doc') el.addEventListener('input', () => { clearTimeout(tCnpj); tCnpj = setTimeout(consultarCnpj, 500); });
      const box = h('div', { class: 'orc-sugs orc-cli-sugs' });
      let t = null;
      el.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const q = el.value.trim();
          if (q.length < 2) { box.replaceChildren(); return; }
          const cs = candidatos(q);
          box.replaceChildren(...cs.map((x) => h('button', { type: 'button', class: 'orc-sug', onclick: () => { preencher(x); box.replaceChildren(); } },
            h('span', null, h('b', null, x.empresa || x.contato), h('small', null, ` ${[x.doc, x.telefone].filter(Boolean).join(' · ')}`)),
            h('small', null, [x.fonte, x.extra].filter(Boolean).join(' · ')))));
        }, 200);
      });
      el.addEventListener('blur', () => setTimeout(() => box.replaceChildren(), 200));
      return h('div', { class: 'orc-busca orc-cli-campo' }, el, box);
    };
    const inp = (obj, k, attrs = {}) => { const el = h('input', { class: 'f-input', value: obj[k] ?? '', disabled: travado || null, ...attrs }); el.addEventListener('input', () => { obj[k] = el.value; if (attrs.recalc) pintar(); }); return el; };
    const numEl = (obj, k, attrs = {}) => { const el = h('input', { class: 'f-input orc-num', inputmode: 'decimal', value: String(obj[k] ?? 0).replace('.', ','), disabled: travado || null, ...attrs }); el.addEventListener('input', () => { obj[k] = numIn(el.value); pintar(); }); return el; };

    // busca de produto
    const busca = h('input', { class: 'f-input', placeholder: 'Buscar produto: nome ou código…', disabled: travado || null });
    const sugs = h('div', { class: 'orc-sugs' });
    const incluir = (p) => {
      const ja = o.itens.find((i) => i.cod === p.cod);
      if (ja) ja.qtd += 1; else o.itens.push({ cod: p.cod, nome: p.nome, grupo: p.grupo, qtd: 1, preco: p.preco, desc: 0, custo: p.custo });
      busca.value = ''; sugs.replaceChildren(); pintar(); busca.focus();
    };
    busca.addEventListener('input', () => {
      const q = TS.norm(busca.value.trim());
      if (q.length < 2) { sugs.replaceChildren(); return; }
      const ach = cat.itens.filter((i) => TS.norm(i.nome).includes(q) || i.cod.startsWith(busca.value.trim())).slice(0, 12);
      sugs.replaceChildren(...ach.map((p) => h('button', { type: 'button', class: 'orc-sug', onclick: () => incluir(p) },
        h('span', null, h('b', null, p.nome), h('small', null, ` cód. ${p.cod}`)),
        h('span', null, fmt.brl(p.preco), h('small', { class: p.disp != null && p.disp <= 0 ? 'neg' : 'muted' }, p.disp == null ? '' : ` · ${fmt.int(p.disp)} em estoque`)))),
        ach.length ? null : h('div', { class: 'muted orc-sug-vazio' }, 'Nenhum produto da tabela de preço com esse nome.'));
    });

    function pintarLinhas(c) {
      linhasBox.replaceChildren(o.itens.length ? h('div', { class: 'orc-itens' },
        h('div', { class: 'orc-cab' }, h('span', null, 'Produto'), h('span', null, 'Qtd'), h('span', null, 'Preço un.'), h('span', null, 'Desc. %'), h('span', null, 'Total'), h('span', null, 'Custo un.'), h('span', null, 'Margem'), h('span')),
        ...c.linhas.map((l, k) => {
          const it = o.itens[k], p = cat.porCod.get(it.cod);
          const falta = p && p.disp != null && it.qtd > p.disp;
          const q = h('input', { class: 'f-input orc-num', inputmode: 'decimal', value: String(it.qtd).replace('.', ','), disabled: travado || null });
          q.addEventListener('change', () => { it.qtd = Math.max(0, numIn(q.value)); pintar(); });
          const pr = h('input', { class: 'f-input orc-num', inputmode: 'decimal', value: it.preco.toFixed(2).replace('.', ','), disabled: travado || null });
          pr.addEventListener('change', () => { it.preco = Math.max(0, numIn(pr.value)); pintar(); });
          const ds = h('input', { class: 'f-input orc-num', inputmode: 'decimal', value: String(it.desc || 0).replace('.', ','), disabled: travado || null });
          ds.addEventListener('change', () => { it.desc = Math.min(100, Math.max(0, numIn(ds.value))); pintar(); });
          return h('div', { class: 'orc-linha' },
            h('span', { class: 'orc-prod' }, h('b', null, it.nome), h('small', { class: falta ? 'neg' : 'muted' }, `cód. ${it.cod}${p && p.disp != null ? ` · ${fmt.int(p.disp)} em estoque${falta ? ' (falta!)' : ''}` : ''}${p && Math.abs(p.preco - it.preco) > 0.005 ? ` · tabela ${fmt.brl(p.preco)}` : ''}`)),
            h('span', { 'data-r': 'Qtd' }, q), h('span', { 'data-r': 'Preço' }, pr), h('span', { 'data-r': 'Desc. %' }, ds),
            h('span', { class: 'orc-v', 'data-r': 'Total' }, fmt.brl(l.total)),
            h('span', { class: 'orc-v muted', 'data-r': 'Custo' }, it.custo == null ? h('span', { class: 'neg', title: 'Sem custo no painel' }, 'sem custo') : fmt.brl(it.custo)),
            h('span', { class: 'orc-v ' + (l.margem != null && l.margem < 0 ? 'neg' : ''), 'data-r': 'Margem' }, pct(l.margem)),
            travado ? h('span') : h('button', { type: 'button', class: 'cf-b orc-x', 'aria-label': `Tirar ${it.nome}`, onclick: () => { o.itens.splice(k, 1); pintar(); } }, '✕'));
        })) : h('p', { class: 'muted' }, 'Busque e inclua os produtos do pedido.'));
    }
    function pintarPainel(c) {
      const t = cat.taxas, L = (rot, v, cls, dica) => h('div', { class: 'orc-l ' + (cls || ''), title: dica || '' }, h('span', null, rot), h('b', null, v));
      painel.replaceChildren(...[
        h('div', { class: 'card-title' }, 'Resultado do orçamento'),
        L('Produtos (preço cheio)', fmt.brl(c.bruto)), L('Descontos', '− ' + fmt.brl(c.desconto)), o.frete ? L('Frete cobrado', fmt.brl(o.frete)) : null,
        L('Total para o cliente', fmt.brl(c.total), 'orc-tot'),
        h('hr'),
        L('Custo dos produtos' + (o.custoExtra ? ' + extras' : ''), '− ' + fmt.brl(c.custo)),
        L('Lucro bruto', fmt.brl(c.lucro), 'orc-dest'), L('Margem bruta', pct(c.mBruta), 'orc-dest ' + (c.mBruta < 0 ? 'neg' : '')),
        h('hr'),
        L(`Royalties + marketing (${pct(t.roy)})`, '− ' + fmt.brl(c.ded.roy)),
        L(`Imposto / Simples (${pct(t.imp)})`, '− ' + fmt.brl(c.ded.imp)),
        o.pagamento === 'cartao' ? L(`Maquininha (${pct(t.maq)})`, '− ' + fmt.brl(c.ded.maq)) : null,
        o.comissao ? L(`Comissão (${pct(t.com)})`, '− ' + fmt.brl(c.ded.com), '', `Comissão média paga em ${t.mesCom ? TS.ymLabel(t.mesCom) : 'o último mês'}`) : null,
        t.outrosPct ? L(`Outros custos em % (${pct(t.outrosPct)})`, '− ' + fmt.brl(c.ded.outros)) : null,
        t.outrosFix ? L('Lucro de contribuição', fmt.brl(c.liquido + c.ded.fixos), 'orc-dest', 'Antes dos custos fixos: o quanto este pedido ajuda a pagar aluguel, salários etc. Um pedido extra não aumenta os custos fixos.') : null,
        t.outrosFix ? L('Margem sem fixos', pct(c.total ? (c.liquido + c.ded.fixos) / c.total : null), 'orc-dest') : null,
        t.outrosFix ? L(`Custos fixos rateados (${pct(t.outrosFix)})`, '− ' + fmt.brl(c.ded.fixos), '', 'Aluguel, salários e outros custos mensais da loja, rateados pelo faturamento médio') : null,
        L('Lucro líquido', fmt.brl(c.liquido), 'orc-dest orc-liq ' + (c.liquido < 0 ? 'neg' : '')), L('Margem líquida', pct(c.mLiq), 'orc-dest ' + (c.mLiq < 0 ? 'neg' : '')),
        c.semCusto ? h('div', { class: 'notice' }, `${c.semCusto} produto(s) sem custo no painel: a margem fica maior do que a real.`) : null,
        h('small', { class: 'muted' }, 'Deduções com as taxas da loja (Configurações → Estoque e margem). As margens líquida e de contribuição são sobre o total do cliente.')].filter(Boolean));
    }
    // rascunho: só "Salvar" fica ativo até salvar; qualquer mudança depois volta a pedir para salvar
    let sujo = !o.id, iniciado = false;
    const secundarios = [];
    const aviso = h('small', { class: 'muted orc-salve' });
    const atualizarBotoes = () => {
      const bloq = !travado && (sujo || !o.id);
      for (const b of secundarios) b.disabled = bloq;
      aviso.textContent = bloq ? (o.id ? 'Há mudanças não salvas: salve para imprimir, enviar ou mudar a situação.' : 'Salve o orçamento para imprimir, enviar ou mudar a situação.') : '';
    };
    const mexeu = () => { if (!iniciado || travado) return; if (!sujo) { sujo = true; atualizarBotoes(); } };
    const sec = (b) => { if (b) secundarios.push(b); return b; };
    function pintar() { const c = conta(o, cat.taxas); pintarLinhas(c); pintarPainel(c); mexeu(); }

    const pagSel = h('select', { class: 'f-input', disabled: travado || null }, ...Object.entries(PAG).map(([k, v]) => h('option', { value: k, selected: o.pagamento === k || null }, v)));
    pagSel.addEventListener('change', () => { o.pagamento = pagSel.value; pintar(); });
    // vendedora do pedido (vai na NF-e de venda): quem vendeu nos últimos 90 dias
    const vendsLoja = (() => { const db = TS.db, s = new Set(); if (db && db.n) for (let i = 0; i < db.n; i++) if (db.day[i] > TS.todayDay() - 90 && db.D.vendedor[db.vend[i]]) s.add(db.D.vendedor[db.vend[i]]); return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR')); })();
    const vendSel = h('select', { class: 'f-input', disabled: travado || null }, h('option', { value: '' }, 'Sem vendedora'), ...[...new Set([...vendsLoja, ...(o.vendedora ? [o.vendedora] : [])])].map((v) => h('option', { value: v, selected: o.vendedora === v || null }, v)));
    vendSel.addEventListener('change', () => { o.vendedora = vendSel.value; });
    const comCb = h('input', { type: 'checkbox', checked: o.comissao || null, disabled: travado || null });
    comCb.addEventListener('change', () => { o.comissao = comCb.checked; pintar(); });

    const salvar = async () => {
      try {
        const r = await api('POST', 'orcamentos', { loja, ...o });
        Object.assign(o, r.ok); state.orcAberto = r.ok.id; sujo = false; toast(`Orçamento #${r.ok.numero} salvo.`); return r.ok;
      } catch (e) { TS.naoSalvo(e); return null; } // erro ao salvar: janela em destaque (pedido do dono, 23/11/2026)
    };
    const mudarSit = async (sit) => {
      let motivo = '';
      if (sit === 'perdido') { motivo = await TS.perguntar('Por que perdemos este orçamento?', { chips: ['Preço', 'Prazo', 'Desistência', 'Concorrente', 'Sem resposta do cliente'], obrigatorio: true, rotulo: 'Motivo', falta: 'Escolha um motivo ou escreva o que aconteceu.', ok: 'Marcar como perdido' }); if (!motivo) return; }
      if (!o.id) { if (!(await salvar())) return; }
      try { const r = await api('POST', `orcamentos/${o.id}/situacao`, { loja, situacao: sit, motivo }); Object.assign(o, r.ok); toast(`Orçamento #${o.numero}: ${SIT[sit][0].toLowerCase()}.`); editor(corpo, loja, cat, o); } catch (e) { toast(e.message, true); }
    };
    const docCliente = () => documento(o, conta(o, cat.taxas), loja);
    const whats = () => {
      const c = conta(o, cat.taxas);
      const tel = String(o.cliente.telefone || '').replace(/\D/g, '');
      const linhas = o.itens.map((i) => `• ${fmt.n2(i.qtd).replace(/,00$/, '')} × ${i.nome} — ${fmt.brl(i.qtd * i.preco * (1 - (i.desc || 0) / 100) * (1 - (o.descGeral || 0) / 100))}`);
      const txt = `Olá${o.cliente.contato ? ', ' + o.cliente.contato.split(' ')[0] : ''}! Segue o orçamento${o.numero ? ' nº ' + o.numero : ''} da ${nomeLoja(loja)}:\n\n${linhas.join('\n')}${o.frete ? `\n• Frete — ${fmt.brl(o.frete)}` : ''}\n\n*Total: ${fmt.brl(c.total)}*\nPagamento: ${PAG[o.pagamento]} · Validade: ${o.validadeDias} dias${o.entrega ? `\nEntrega: ${o.entrega}` : ''}\n\nQualquer dúvida, estamos à disposição! 🍵`;
      window.open(TS.msgWpp.linkComTexto(tel.length >= 10 ? '55' + tel.replace(/^55(?=\d{10,11}$)/, '') : '', txt), '_blank', 'noopener');
    };
    const emitirNfe = () => {
      if (!o.cliente.doc) { if (!confirm('O orçamento está sem CNPJ/CPF: na nota você vai escolher o parceiro à mão. Continuar?')) return; }
      const pu = (i) => i.preco * (1 - (i.desc || 0) / 100) * (1 - (o.descGeral || 0) / 100);
      // na NF-e o preço unitário vai com 2 casas: com desconto, o total pode mudar alguns centavos — avisa antes
      const exato = o.itens.reduce((t, i) => t + i.qtd * pu(i), 0), nota = o.itens.reduce((t, i) => t + i.qtd * Math.round(pu(i) * 100) / 100, 0);
      if (Math.abs(exato - nota) >= 0.005 && !confirm(`Na NF-e o preço de cada unidade vai com 2 casas: os produtos somam ${fmt.brl(nota)} (no orçamento ${fmt.brl(exato)}). Ajuste um preço na nota se precisar bater o centavo. Continuar?`)) return;
      TS.nfPronta = { loja, numero: o.numero, doc: o.cliente.doc, nome: o.cliente.empresa || o.cliente.contato, vendedora: o.vendedora || '', pagamento: o.pagamento, frete: o.frete || 0, obs: `Orçamento nº ${o.numero}`, itens: o.itens.map((i) => ({ cod: i.cod, nome: i.nome, qtd: i.qtd, preco: pu(i) })) };
      location.hash = '#nfsaida';
    };
    const dup = () => { const c = JSON.parse(JSON.stringify(o)); delete c.id; delete c.numero; delete c.situacao; delete c.historico; delete c.motivoPerda; state.orcAberto = 'novo'; editor(corpo, loja, cat, c); toast('Cópia aberta: salve para criar o novo orçamento.'); };
    const excluir = async () => { if (!o.id || !confirm('Excluir este rascunho?')) return; try { await api('DELETE', `orcamentos/${o.id}?loja=${encodeURIComponent(loja)}`); voltar(); } catch (e) { toast(e.message, true); } };

    const [sitT, sitC] = SIT[o.situacao || 'rascunho'];
    corpo.replaceChildren(...[
      h('div', { class: 'inv-cab' }, h('button', { type: 'button', class: 'btn', onclick: voltar }, '‹ Orçamentos'),
        h('div', null, h('b', { class: 'inv-titulo' }, o.numero ? `Orçamento #${o.numero}` : 'Novo orçamento'), ' ', h('span', { class: 'cf-st ' + sitC }, sitT), o.motivoPerda ? h('small', { class: 'muted' }, ' · ' + o.motivoPerda) : null)),
      travado ? h('div', { class: 'notice mt' }, 'Orçamento aprovado: não muda mais. Use "Duplicar" para fazer outro parecido.') : null,
      h('div', { class: 'orc-grade mt' },
        h('div', null,
          h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Cliente'),
            h('small', { class: 'muted' }, 'Digite o nome, o CNPJ ou o CPF: o painel procura na base de clientes e nos orçamentos anteriores. Com um CNPJ novo, busca os dados da empresa na Receita.'),
            h('div', { class: 'cfr-grade' }, campo('Empresa', autoCli('empresa', { placeholder: 'Razão social ou nome' })), campo('CNPJ / CPF', autoCli('doc', { inputmode: 'numeric' })),
              campo('Contato', autoCli('contato', { placeholder: 'Quem pediu' })), campo('Telefone / WhatsApp', (campos.telefone = inp(o.cliente, 'telefone', { inputmode: 'tel' }))),
              campo('E-mail', (campos.email = inp(o.cliente, 'email', { type: 'email' }))), campo('Título (opcional)', inp(o, 'titulo', { placeholder: 'Ex.: kits de fim de ano' }))),
            infoCli, infoRec),
          h('div', { class: 'card mt' }, h('div', { class: 'card-title' }, 'Produtos'),
            travado ? null : h('div', { class: 'orc-busca' }, busca, sugs), linhasBox),
          h('div', { class: 'card mt' }, h('div', { class: 'card-title' }, 'Condições'),
            h('div', { class: 'cfr-grade orc-cond' }, campo('Desconto geral (%)', numEl(o, 'descGeral')), campo('Frete cobrado (R$)', numEl(o, 'frete')),
              campo('Custos extras (R$)', numEl(o, 'custoExtra', { title: 'Embalagem especial, frete pago pela loja, cartão…' })), campo('Pagamento', pagSel),
              campo('Validade (dias)', numEl(o, 'validadeDias')), campo('Entrega', inp(o, 'entrega', { placeholder: 'Ex.: retirada na loja até 15/12' })), campo('Vendedora', vendSel),
              h('label', { class: 'cfg-check-l orc-com' }, comCb, ' Paga comissão à vendedora')),
            campo('Observações para o cliente', (() => { const t = h('textarea', { class: 'f-input', rows: 3, disabled: travado || null }, o.obs || ''); t.addEventListener('input', () => { o.obs = t.value; }); return t; })()))),
        h('div', { class: 'orc-lado' }, painel,
          h('div', { class: 'card mt orc-acoes' },
            travado ? null : h('button', { type: 'button', class: 'btn primary', onclick: async () => { if (await salvar()) editor(corpo, loja, cat, o); } }, 'Salvar'),
            travado ? null : aviso,
            sec(h('button', { type: 'button', class: 'btn', onclick: docCliente }, '🖨 Imprimir / PDF para o cliente')),
            sec(h('button', { type: 'button', class: 'btn', onclick: whats }, 'WhatsApp para o cliente')),
            o.situacao !== 'enviado' && !travado ? sec(h('button', { type: 'button', class: 'btn', onclick: () => mudarSit('enviado') }, 'Marcar como enviado')) : null,
            !travado ? sec(h('button', { type: 'button', class: 'btn orc-aprov', onclick: () => mudarSit('aprovado') }, '✓ Cliente aprovou')) : null,
            travado && !TS.demo ? h('button', { type: 'button', class: 'btn primary', title: 'Abre a NF-e de venda já com o parceiro, a vendedora, o pagamento e os produtos do orçamento', onclick: emitirNfe }, '🧾 Emitir NF-e de venda') : null,
            travado && TS.demo ? h('button', { type: 'button', class: 'btn primary', onclick: () => toast('Na apresentação a NF-e não é emitida.') }, '🧾 Emitir NF-e de venda') : null,
            o.situacao !== 'perdido' && !travado ? sec(h('button', { type: 'button', class: 'btn ghost-danger', onclick: () => mudarSit('perdido') }, 'Perdemos')) : null,
            o.situacao === 'perdido' ? sec(h('button', { type: 'button', class: 'btn', onclick: () => mudarSit('rascunho') }, 'Reabrir')) : null,
            o.id ? sec(h('button', { type: 'button', class: 'link-btn', onclick: dup }, 'Duplicar')) : null,
            o.id && o.situacao === 'rascunho' ? h('button', { type: 'button', class: 'link-btn neg', onclick: excluir }, 'Excluir rascunho') : null)))].filter(Boolean));
    pintar();
    pintarInfo();
    // campos de texto (cliente, condições, observação) também contam como mudança; a busca de produto não
    const ed = corpo;
    if (!ed._orcOuvindo) { ed._orcOuvindo = true; ed.addEventListener('input', (e) => { if (ed._orcMexeu && !e.target.closest('.orc-busca:not(.orc-cli-campo)')) ed._orcMexeu(); }); ed.addEventListener('change', (e) => { if (ed._orcMexeu && !e.target.closest('.orc-busca:not(.orc-cli-campo)')) ed._orcMexeu(); }); }
    ed._orcMexeu = mexeu;
    iniciado = true;
    atualizarBotoes();
  }

  const nomeLoja = (loja) => { const m = (TS.db.metas || []).find((x) => x.id === loja); return (m && m.nome) || 'Tea Shop'; };

  /** documento para o cliente (sem custo nem margem): abre e imprime (salvar em PDF pelo navegador) */
  function documento(o, c, loja) {
    const hoje = new Date();
    const val = new Date(hoje.getTime() + (o.validadeDias || 7) * 864e5);
    const linhas = o.itens.map((i) => {
      const pu = i.preco * (1 - (i.desc || 0) / 100) * (1 - (o.descGeral || 0) / 100);
      return h('tr', null, h('td', null, i.nome), h('td', { class: 'r' }, fmt.n2(i.qtd).replace(/,00$/, '')), h('td', { class: 'r' }, fmt.brl(pu)), h('td', { class: 'r' }, fmt.brl(pu * i.qtd)));
    });
    const doc = h('div', { class: 'card orc-doc' },
      h('div', { class: 'orc-doc-cab' }, h('div', null, h('h2', null, nomeLoja(loja)), h('div', { class: 'muted' }, 'Orçamento')),
        h('div', { class: 'r' }, h('b', null, o.numero ? `Nº ${o.numero}` : 'Rascunho'), h('div', null, `Emitido em ${hoje.toLocaleDateString('pt-BR')}`), h('div', null, `Válido até ${val.toLocaleDateString('pt-BR')}`))),
      h('div', { class: 'orc-doc-cli' }, h('b', null, o.cliente.empresa || o.cliente.contato || ''), [o.cliente.doc, o.cliente.contato && o.cliente.empresa ? 'A/C ' + o.cliente.contato : '', o.cliente.telefone, o.cliente.email].filter(Boolean).map((x) => h('div', null, x))),
      o.titulo ? h('h3', null, o.titulo) : null,
      h('table', { class: 'orc-doc-t' }, h('thead', null, h('tr', null, h('th', null, 'Produto'), h('th', { class: 'r' }, 'Qtd'), h('th', { class: 'r' }, 'Preço un.'), h('th', { class: 'r' }, 'Total'))),
        h('tbody', null, ...linhas),
        h('tfoot', null,
          c.desconto > 0.005 ? h('tr', null, h('td', { colspan: 3 }, 'Descontos já aplicados nos preços'), h('td', { class: 'r' }, fmt.brl(c.desconto))) : null,
          o.frete ? h('tr', null, h('td', { colspan: 3 }, 'Frete'), h('td', { class: 'r' }, fmt.brl(o.frete))) : null,
          h('tr', { class: 'tot' }, h('td', { colspan: 3 }, 'Total'), h('td', { class: 'r' }, fmt.brl(c.total))))),
      h('div', { class: 'orc-doc-cond' }, h('div', null, h('b', null, 'Pagamento: '), PAG[o.pagamento]), o.entrega ? h('div', null, h('b', null, 'Entrega: '), o.entrega) : null, o.obs ? h('div', null, h('b', null, 'Observações: '), o.obs) : null));
    if (TS.imprimir) TS.imprimir(doc); else { document.body.append(doc); window.print(); doc.remove(); }
  }
})();
