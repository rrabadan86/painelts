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
  const numIn = (v) => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };

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
    Promise.all([catalogo(loja), api('GET', `orcamentos?loja=${encodeURIComponent(loja)}`)]).then(([cat, j]) => {
      if (!corpo.isConnected) return;
      const lista = j.orcamentos || [];
      const aberto = state.orcAberto && (state.orcAberto === 'novo' ? {} : lista.find((o) => o.id === state.orcAberto));
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
      h('div', { class: 'orc-topo' }, h('button', { type: 'button', class: 'btn primary', onclick: () => abrir('novo') }, '+ Novo orçamento')),
      h('div', { class: 'grid g-kpi mt' },
        TS.kpi('Em aberto', fmt.int(conta0('rascunho') + conta0('enviado')), `${fmt.int(conta0('enviado'))} enviado(s) esperando resposta`),
        TS.kpi('Aprovados', fmt.int(aprov.length), fmt.brl(valorAprov)),
        TS.kpi('Taxa de conversão', dec.length ? fmt.pct(aprov.length / dec.length, 0) : '—', 'aprovados ÷ (aprovados + perdidos)'),
        TS.kpi('Perdidos', fmt.int(conta0('perdido')), 'veja o motivo de cada um')),
      h('div', { class: 'card mt' }, h('div', { class: 'card-title' }, 'Orçamentos'),
        h('div', { class: 'est-tools' }, tab.searchBox, TS.seg([['Todos', 'todos'], [`Rascunho (${conta0('rascunho')})`, 'rascunho'], [`Enviados (${conta0('enviado')})`, 'enviado'], [`Aprovados (${conta0('aprovado')})`, 'aprovado'], [`Perdidos (${conta0('perdido')})`, 'perdido']], fil, (v) => { state.orcFil = v; telaLista(corpo, loja, cat, lista); })),
        tab));
  }

  // ---------- editor ----------
  function editor(corpo, loja, cat, orig) {
    const o = JSON.parse(JSON.stringify({ cliente: {}, itens: [], descGeral: 0, frete: 0, custoExtra: 0, pagamento: 'pix', comissao: false, validadeDias: 7, entrega: '', obs: '', titulo: '', ...orig }));
    const travado = o.situacao === 'aprovado';
    const voltar = () => { state.orcAberto = null; TS.render(); };
    const painel = h('div', { class: 'orc-painel card' });
    const linhasBox = h('div');
    const campo = (rot, el, cls) => h('label', { class: 'cfr-campo ' + (cls || '') }, h('span', null, rot), el);
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
        t.outrosFix ? L('Margem de contribuição', pct(c.total ? (c.liquido + c.ded.fixos) / c.total : null), 'orc-dest') : null,
        t.outrosFix ? L(`Custos fixos rateados (${pct(t.outrosFix)})`, '− ' + fmt.brl(c.ded.fixos), '', 'Aluguel, salários e outros custos mensais da loja, rateados pelo faturamento médio') : null,
        L('Lucro líquido', fmt.brl(c.liquido), 'orc-dest orc-liq ' + (c.liquido < 0 ? 'neg' : '')), L('Margem líquida', pct(c.mLiq), 'orc-dest ' + (c.mLiq < 0 ? 'neg' : '')),
        c.semCusto ? h('div', { class: 'notice' }, `${c.semCusto} produto(s) sem custo no painel: a margem fica maior do que a real.`) : null,
        h('small', { class: 'muted' }, 'Deduções com as taxas da loja (Configurações → Estoque e margem). As margens líquida e de contribuição são sobre o total do cliente.')].filter(Boolean));
    }
    function pintar() { const c = conta(o, cat.taxas); pintarLinhas(c); pintarPainel(c); }

    const pagSel = h('select', { class: 'f-input', disabled: travado || null }, ...Object.entries(PAG).map(([k, v]) => h('option', { value: k, selected: o.pagamento === k || null }, v)));
    pagSel.addEventListener('change', () => { o.pagamento = pagSel.value; pintar(); });
    const comCb = h('input', { type: 'checkbox', checked: o.comissao || null, disabled: travado || null });
    comCb.addEventListener('change', () => { o.comissao = comCb.checked; pintar(); });

    const salvar = async () => {
      try {
        const r = await api('POST', 'orcamentos', { loja, ...o });
        Object.assign(o, r.ok); state.orcAberto = r.ok.id; toast(`Orçamento #${r.ok.numero} salvo.`); return r.ok;
      } catch (e) { toast(e.message, true); return null; }
    };
    const mudarSit = async (sit) => {
      let motivo = '';
      if (sit === 'perdido') { motivo = prompt('Por que perdemos? (preço, prazo, desistência, concorrente…)', ''); if (!motivo) return; }
      if (!o.id) { if (!(await salvar())) return; }
      try { const r = await api('POST', `orcamentos/${o.id}/situacao`, { loja, situacao: sit, motivo }); Object.assign(o, r.ok); toast(`Orçamento #${o.numero}: ${SIT[sit][0].toLowerCase()}.`); editor(corpo, loja, cat, o); } catch (e) { toast(e.message, true); }
    };
    const docCliente = () => documento(o, conta(o, cat.taxas), loja);
    const whats = () => {
      const c = conta(o, cat.taxas);
      const tel = String(o.cliente.telefone || '').replace(/\D/g, '');
      const linhas = o.itens.map((i) => `• ${fmt.n2(i.qtd).replace(/,00$/, '')} × ${i.nome} — ${fmt.brl(i.qtd * i.preco * (1 - (i.desc || 0) / 100) * (1 - (o.descGeral || 0) / 100))}`);
      const txt = `Olá${o.cliente.contato ? ', ' + o.cliente.contato.split(' ')[0] : ''}! Segue o orçamento${o.numero ? ' nº ' + o.numero : ''} da ${nomeLoja(loja)}:\n\n${linhas.join('\n')}${o.frete ? `\n• Frete — ${fmt.brl(o.frete)}` : ''}\n\n*Total: ${fmt.brl(c.total)}*\nPagamento: ${PAG[o.pagamento]} · Validade: ${o.validadeDias} dias${o.entrega ? `\nEntrega: ${o.entrega}` : ''}\n\nQualquer dúvida, estamos à disposição! 🍵`;
      window.open((tel.length >= 10 ? `https://wa.me/55${tel.replace(/^55(?=\d{10,11}$)/, '')}` : 'https://wa.me/') + '?text=' + encodeURIComponent(txt), '_blank', 'noopener');
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
            h('div', { class: 'cfr-grade' }, campo('Empresa', inp(o.cliente, 'empresa', { placeholder: 'Razão social ou nome' })), campo('CNPJ / CPF', inp(o.cliente, 'doc')),
              campo('Contato', inp(o.cliente, 'contato', { placeholder: 'Quem pediu' })), campo('Telefone / WhatsApp', inp(o.cliente, 'telefone', { inputmode: 'tel' })),
              campo('E-mail', inp(o.cliente, 'email', { type: 'email' })), campo('Título (opcional)', inp(o, 'titulo', { placeholder: 'Ex.: kits de fim de ano' })))),
          h('div', { class: 'card mt' }, h('div', { class: 'card-title' }, 'Produtos'),
            travado ? null : h('div', { class: 'orc-busca' }, busca, sugs), linhasBox),
          h('div', { class: 'card mt' }, h('div', { class: 'card-title' }, 'Condições'),
            h('div', { class: 'cfr-grade orc-cond' }, campo('Desconto geral (%)', numEl(o, 'descGeral')), campo('Frete cobrado (R$)', numEl(o, 'frete')),
              campo('Custos extras (R$)', numEl(o, 'custoExtra', { title: 'Embalagem especial, frete pago pela loja, cartão…' })), campo('Pagamento', pagSel),
              campo('Validade (dias)', numEl(o, 'validadeDias')), campo('Entrega', inp(o, 'entrega', { placeholder: 'Ex.: retirada na loja até 15/12' })),
              h('label', { class: 'cfg-check-l orc-com' }, comCb, ' Paga comissão à vendedora')),
            campo('Observações para o cliente', (() => { const t = h('textarea', { class: 'f-input', rows: 3, disabled: travado || null }, o.obs || ''); t.addEventListener('input', () => { o.obs = t.value; }); return t; })()))),
        h('div', { class: 'orc-lado' }, painel,
          h('div', { class: 'card mt orc-acoes' },
            travado ? null : h('button', { type: 'button', class: 'btn primary', onclick: async () => { if (await salvar()) editor(corpo, loja, cat, o); } }, 'Salvar'),
            h('button', { type: 'button', class: 'btn', onclick: docCliente }, '🖨 Imprimir / PDF para o cliente'),
            h('button', { type: 'button', class: 'btn', onclick: whats }, 'WhatsApp para o cliente'),
            o.situacao !== 'enviado' && !travado ? h('button', { type: 'button', class: 'btn', onclick: () => mudarSit('enviado') }, 'Marcar como enviado') : null,
            !travado ? h('button', { type: 'button', class: 'btn orc-aprov', onclick: () => mudarSit('aprovado') }, '✓ Cliente aprovou') : null,
            o.situacao !== 'perdido' && !travado ? h('button', { type: 'button', class: 'btn ghost-danger', onclick: () => mudarSit('perdido') }, 'Perdemos') : null,
            o.situacao === 'perdido' ? h('button', { type: 'button', class: 'btn', onclick: () => mudarSit('rascunho') }, 'Reabrir') : null,
            o.id ? h('button', { type: 'button', class: 'link-btn', onclick: dup }, 'Duplicar') : null,
            o.id && o.situacao === 'rascunho' ? h('button', { type: 'button', class: 'link-btn neg', onclick: excluir }, 'Excluir rascunho') : null)))].filter(Boolean));
    pintar();
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
