/* Estoque → Notas fiscais → Saída: NF-e (modelo 55) emitidas pela loja, lidas dos XMLs que o coletor guarda.
   Lista, detalhe com os itens, download do XML original e DANFE para imprimir/salvar em PDF. */
(function () {
  const { h, fmt, state } = TS;

  /** abas Entrada | Saída dentro de Notas fiscais */
  TS.abasNotas = (atual) => h('div', { class: 'nf-abas' }, TS.seg([['Notas de entrada', 'notas'], ['Notas de saída (NF-e emitidas)', 'nfsaida']], atual, (v) => { location.hash = '#' + v; }));

  const docTxt = (d) => { const s = String(d || ''); return s.length === 14 ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : s.length === 11 ? s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : s; };
  const quando = (iso) => (iso ? fmt.date(iso.slice(0, 10)) + (iso.length > 10 ? ' ' + iso.slice(11, 16) : '') : '—');
  const url = (o, loja, chave) => TS.api(`nfsaida/${o}?loja=${encodeURIComponent(loja)}&chave=${chave}`);
  /** CPF do destinatário que existe nos clientes: clicar abre a ficha */
  const docLink = (d) => {
    if (!d || !d.doc) return '—';
    const temFicha = d.tipoDoc === 'CPF' && TS.cliApi && TS.cli && TS.cli.porCPF && (TS.cli.porCPF.has(d.doc) || (TS.cli.fxPorCpf && TS.cli.fxPorCpf.has(d.doc)));
    return temFicha ? h('button', { type: 'button', class: 'cpf-link', title: 'Abrir a ficha do cliente', onclick: (e) => { e.stopPropagation(); TS.cliApi.abrirClientes([d.doc]); } }, docTxt(d.doc)) : docTxt(d.doc);
  };
  const situ = (s) => h('span', { class: 'prc-st ' + (s === 'cancelada' ? 'prc-st-n nf-cancelada' : 'prc-st-v') }, s === 'cancelada' ? 'cancelada' : 'autorizada');

  const cache = new Map();
  TS.pages.nfsaida = function (root) {
    if (TS.subEstoque) root.append(TS.subEstoque('nfsaida'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Notas fiscais'),
      h('div', { class: 'page-sub' }, 'Notas de saída: NF-e emitidas pela loja (vendas com nota, transferências, devoluções), com o XML e o DANFE'))));
    root.append(TS.abasNotas('nfsaida'));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'As notas são de cada loja: escolha uma loja no seletor do topo.')); return; }
    const loja = state.loja;
    const corpo = h('div', { class: 'mt nf-saida' }, h('div', { class: 'card' }, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Lendo as notas…')))));
    root.append(corpo);
    const p = cache.get(loja) || fetch(TS.api(`nfsaida?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || 'Falha ao ler as notas.'); return j; });
    cache.set(loja, p);
    setTimeout(() => cache.delete(loja), 60000); // lista nova a cada minuto (o coletor pode ter trazido notas)
    p.then((j) => {
      if (!corpo.isConnected) return;
      corpo.replaceChildren(lista(loja, j));
      if (state.abrirNFe) { const ch = state.abrirNFe; state.abrirNFe = null; abrir(loja, ch); }
    }).catch((e) => { cache.delete(loja); corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)); });
  };

  function lista(loja, j) {
    const f = state.f;
    const todas = (j.notas || []).map((n) => ({ ...n, dia: TS.isoToDay(n.data), nfTxt: `${n.numero ?? '—'}${n.serie ? ' / ' + n.serie : ''}`, destNome: (n.dest && n.dest.nome) || '', docBusca: n.dest ? `${n.dest.doc || ''} ${docTxt(n.dest.doc)}` : '' }));
    if (!todas.length) {
      return TS.card('Notas de saída', null, h('p', { class: 'muted' }, j.temXml
        ? 'Nenhuma NF-e (modelo 55) nos XMLs guardados desta loja. As NFC-e do caixa ficam em Vendas → Cupons.'
        : 'O painel ainda não tem os XMLs desta loja. Eles chegam pela coleta de XML (Configurações → Dados e atualização → Importar histórico, com "XML das notas").'));
    }
    const noPer = (n) => (f.de == null || n.dia >= f.de) && (f.ate == null || n.dia <= f.ate);
    const FIL = { per: ['No período', noPer], todas: ['Todas', () => true] };
    const fil = FIL[state.nfsFil] ? state.nfsFil : 'per';
    const rows = todas.filter(FIL[fil][1]);
    const ativas = rows.filter((r) => r.situacao !== 'cancelada');
    const tab = TS.table({
      cols: [
        { key: 'emissao', label: 'Emissão', align: 'l', render: (r) => quando(r.emissao), sortVal: (r) => r.emissao || '' },
        { key: 'nfTxt', label: 'NF / série', align: 'l', render: (r) => h('a', { href: '#', class: 'prc-nome', onclick: (e) => { e.preventDefault(); abrir(loja, r.chave); } }, r.nfTxt), sortVal: (r) => r.numero || 0 },
        { key: 'destNome', label: 'Destinatário', align: 'l', wrap: true, render: (r) => h('span', null, r.destNome || '—', r.dest && r.dest.mun ? h('small', { class: 'est-tam' }, `${r.dest.mun}${r.dest.uf ? ' - ' + r.dest.uf : ''}`) : null) },
        { key: 'docBusca', label: 'CPF/CNPJ', align: 'l', render: (r) => docLink(r.dest), sortVal: (r) => (r.dest && r.dest.doc) || '' },
        { key: 'natOp', label: 'Natureza', align: 'l', wrap: true, render: (r) => h('span', null, r.natOp || '—', r.cfops && r.cfops.length ? h('small', { class: 'est-tam' }, 'CFOP ' + r.cfops.join(', ')) : null) },
        { key: 'situacao', label: 'Situação', align: 'l', render: (r) => situ(r.situacao) },
        { key: 'itens', label: 'Itens', fmt: fmt.int },
        { key: 'valor', label: 'Valor', fmt: (v) => (v == null ? '—' : fmt.brl(v)), cls: (r) => (r.situacao === 'cancelada' ? 'nf-riscado' : '') },
        { key: 'acoes', label: '', align: 'l', sortVal: () => 0, render: (r) => h('span', { class: 'nf-acoes' },
          h('button', { type: 'button', class: 'btn prc-ver', onclick: () => abrir(loja, r.chave) }, 'Ver'),
          h('a', { class: 'btn prc-ver', href: url('danfe', loja, r.chave), target: '_blank', rel: 'noopener', title: 'DANFE para imprimir ou salvar em PDF' }, 'DANFE'),
          TS.demo ? null : h('a', { class: 'btn prc-ver', href: url('xml', loja, r.chave), title: 'Baixar o XML da nota' }, 'XML')) },
      ],
      rows, sortKey: 'emissao', maxHeight: '560px', search: 'Buscar NF, destinatário, CPF/CNPJ ou natureza…', searchKeys: ['nfTxt', 'destNome', 'docBusca', 'natOp'], cls: 'est-t',
      rowClass: (r) => (r.situacao === 'cancelada' ? 'nf-linha-cancelada' : null),
      total: { nfTxt: `${fmt.int(rows.length)} notas`, itens: rows.reduce((a, r) => a + (r.itens || 0), 0), valor: ativas.reduce((a, r) => a + (r.valor || 0), 0) },
      imprimir: ['emissao', 'nfTxt', 'destNome', 'docBusca', 'natOp', 'situacao', 'itens', 'valor'],
      empty: fil === 'per' ? 'Nenhuma NF-e no período do filtro. Veja "Todas".' : 'Nenhuma nota.',
    });
    const canc = rows.length - ativas.length;
    return TS.cardWithTools('Notas de saída (NF-e)', `NF-e emitidas pela loja, lidas dos XMLs do AppNext. O total soma só as autorizadas${canc ? ` (${fmt.int(canc)} cancelada${canc > 1 ? 's' : ''} fora da soma)` : ''}. Clique na nota para ver os itens; "DANFE" abre a nota pronta para imprimir ou salvar em PDF.`,
      h('div', { class: 'est-tools' }, tab.searchBox && (tab.searchBox.classList.add('est-busca'), tab.searchBox),
        TS.seg(Object.entries(FIL).map(([k, [t, fn]]) => [`${t} (${fmt.int(todas.filter(fn).length)})`, k]), fil, (v) => { state.nfsFil = v; TS.render(); })),
      tab);
  }

  async function abrir(loja, chave) {
    document.querySelector('.prc-drawer-camada')?.remove();
    const fechar = () => { camada.remove(); document.body.classList.remove('com-camada'); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    const card = h('aside', { class: 'card prc-drawer prc-drawer-largo', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Nota fiscal' },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: () => fechar() }, '✕'),
      h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Abrindo a nota…'))));
    const camada = h('div', { class: 'prc-drawer-camada', onmousedown: (e) => { if (e.target === camada) fechar(); } }, card);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', esc);
    let n;
    try {
      const r = await fetch(url('nota', loja, chave), { credentials: 'same-origin' });
      n = await r.json();
      if (!r.ok) throw new Error(n.erro || 'Falha ao abrir a nota.');
    } catch (e) { card.lastChild.replaceWith(h('div', { class: 'notice err' }, e.message)); return; }
    const d = n.dest || {}, t = n.total || {};
    const tab = TS.table({
      cols: [
        { key: 'desc', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => h('span', null, r.desc, h('small', { class: 'est-tam' }, `cód. ${r.cod || '—'}${r.ncm ? ' · NCM ' + r.ncm : ''}${r.cfop ? ' · CFOP ' + r.cfop : ''}`)) },
        { key: 'qtd', label: 'Qtd', render: (r) => `${fmt.n2(r.qtd).replace(/,00$/, '')} ${String(r.un || '').toLowerCase()}`, sortVal: (r) => r.qtd },
        { key: 'vUn', label: 'Valor unit.', fmt: (v) => (v == null ? '—' : fmt.brl(v)) },
        { key: 'vDesc', label: 'Desconto', fmt: (v) => (v ? fmt.brl(v) : '—') },
        { key: 'vProd', label: 'Total', fmt: fmt.brl },
      ],
      rows: n.itens || [], sortKey: 'vProd', maxHeight: '50vh', search: 'Buscar produto…', searchKeys: ['desc', 'cod'], cls: 'est-t',
      total: { desc: `${fmt.int((n.itens || []).length)} itens`, vProd: (n.itens || []).reduce((a, r) => a + (r.vProd || 0), 0), vDesc: (n.itens || []).reduce((a, r) => a + (r.vDesc || 0), 0) },
    });
    const end = d.end ? [d.end.linha, [d.end.mun, d.end.uf].filter(Boolean).join(' - '), d.end.cep ? 'CEP ' + d.end.cep : ''].filter(Boolean).join(' · ') : '';
    card.replaceChildren(card.firstChild,
      h('div', { class: 'card-title' }, `NF-e ${n.numero ?? '—'}${n.serie ? ' / série ' + n.serie : ''} `, situ(n.situacao)),
      h('div', { class: 'card-sub' }, [n.natOp, n.tipo, n.finalidade && n.finalidade !== 'Normal' ? n.finalidade : null].filter(Boolean).join(' · ')),
      h('div', { class: 'prc-resumo' },
        h('div', null, h('small', null, 'Emissão'), h('b', null, quando(n.emissao))),
        h('div', null, h('small', null, 'Itens'), h('b', null, fmt.int((n.itens || []).length))),
        h('div', null, h('small', null, 'Valor da nota'), h('b', null, t.vNF != null ? fmt.brl(t.vNF) : '—'))),
      h('div', { class: 'nf-dest' }, h('small', null, 'Destinatário'), h('b', null, d.nome || '—'), h('span', null, d.tipoDoc ? d.tipoDoc + ' ' : '', docLink(d)), end ? h('span', { class: 'muted' }, end) : null, d.email ? h('span', { class: 'muted' }, d.email) : null),
      h('div', { class: 'prc-nota-info muted' }, [t.vDesc ? `Desconto ${fmt.brl(t.vDesc)}` : '', t.vFrete ? `Frete ${fmt.brl(t.vFrete)}` : '', t.vICMS ? `ICMS ${fmt.brl(t.vICMS)}` : '', n.protocolo ? `Protocolo ${n.protocolo}${n.autorizadaEm ? ' de ' + quando(n.autorizadaEm) : ''}` : '', `Chave ${n.chave}`].filter(Boolean).join(' · ')),
      n.infCpl ? h('div', { class: 'prc-nota-info muted' }, 'Informações complementares: ' + n.infCpl) : null,
      h('div', { class: 'nf-botoes' },
        h('a', { class: 'btn primary', href: url('danfe', loja, chave), target: '_blank', rel: 'noopener' }, 'DANFE (imprimir / PDF)'),
        TS.demo ? h('span', { class: 'muted' }, 'Na apresentação as notas são fictícias e não têm XML.') : h('a', { class: 'btn', href: url('xml', loja, chave) }, 'Baixar XML'),
        h('button', { type: 'button', class: 'btn', title: 'Copiar a chave de acesso', onclick: (e) => { navigator.clipboard?.writeText(n.chave).then(() => { e.target.textContent = 'Chave copiada ✓'; }); } }, 'Copiar chave')),
      h('div', { class: 'f-label mt' }, 'Produtos da nota'),
      tab);
  }
})();
