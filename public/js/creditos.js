/* Notas fiscais → Créditos com a franquia.
 * Cada NF-e de devolução vira um crédito; o painel procura o desconto dela nas notas de compra seguintes
 * (a franquia desconta a devolução inteira numa nota, diluída nos itens; uma nota pode trazer várias).
 * Achou → compensado. Não fechou → "Para conferir". Sem desconto em 30 dias → atrasado. */
(function () {
  const { h, fmt, state } = TS;
  const toast = (msg, erro) => { const t = h('div', { class: 'toast' + (erro ? ' err' : '') }, msg); document.body.append(t); setTimeout(() => t.remove(), erro ? 6000 : 3000); };
  const dataTxt = (iso) => (iso ? fmt.date(String(iso).slice(0, 10)) : '—');
  const ST = {
    aberto: ['Em aberto', 'cf-aberto'], atrasado: ['Atrasado', 'cf-atrasado'], compensado: ['Compensado', 'cf-ok'], manual: ['Compensado (confirmado)', 'cf-ok'], confirmar: ['A confirmar', 'cf-aberto'],
  };
  const COMO = { nota: 'na nota', boleto: 'no boleto', royalties: 'nos royalties', outro: 'de outro jeito', cancelado: 'cancelado' };
  const NST = { compensou: ['Compensou (valor exato)', 'cf-ok'], manual: ['Confirmada', 'cf-ok'], conferir: ['Confirme: mais de uma combinação', 'cf-aberto'], sugestao: ['Sugestão: confirme', 'cf-aberto'], sem_par: ['Desconto sem devolução que feche', 'cf-atrasado'], sem_credito: ['Desconto sem devolução em aberto', 'cf-aberto'], ignorada: ['Não é de devolução', 'cf-cinza'] };

  async function api(metodo, p, corpo) {
    const r = await fetch(TS.api(p), { method: metodo, credentials: 'same-origin', headers: corpo ? { 'Content-Type': 'application/json', 'X-Painel': '1' } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha.');
    return j;
  }

  TS.pages.creditos = function (root) {
    if (TS.subEstoque) root.append(TS.subEstoque('creditos'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Notas fiscais'),
      h('div', { class: 'page-sub' }, 'Créditos com a franquia: cada devolução e em qual nota de compra ela foi descontada'))));
    if (TS.abasNotas) root.append(TS.abasNotas('creditos'));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'Os créditos são de cada loja: escolha uma loja no seletor do topo.')); return; }
    const loja = state.loja;
    const corpo = h('div', { class: 'mt' }, h('div', { class: 'card' }, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Montando a conta…')))));
    root.append(corpo);
    api('GET', `conta-franquia?loja=${encodeURIComponent(loja)}`).then((d) => { if (corpo.isConnected) pintar(corpo, loja, d); })
      .catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  };

  function pintar(corpo, loja, d) {
    const r = d.resumo;
    const acao = async (b, msg) => {
      try { const nd = await api('POST', 'conta-franquia/acao', { loja, ...b }); if (msg) toast(msg); pintar(corpo, loja, nd); } catch (e) { toast(e.message, true); }
    };
    const porId = new Map(d.creditos.map((c) => [c.id, c]));
    const fil = ['todos', 'aberto', 'atrasado', 'compensado', 'confirmar'].includes(state.cfFil) ? state.cfFil : 'todos';
    const filtra = (c) => fil === 'todos' || (fil === 'compensado' ? c.situacao === 'compensado' || c.situacao === 'manual' : c.situacao === fil);
    // clicar na NF abre a nota: a devolução (NF-e com itens e DANFE) ou a nota de compra (em Notas de entrada)
    const abrirDev = (c) => { if (c.xml && TS.abrirNFe) TS.abrirNFe(c.id, loja); else toast('O XML desta NF-e ainda não chegou ao painel.', true); };
    const abrirCompra = (nf) => { state.abrirNF = nf; state.prcNotasFil = 'todas'; location.hash = '#notas'; };
    const rows = d.creditos.filter(filtra);

    const menuCredito = (c) => {
      if (c.situacao === 'manual') return h('button', { type: 'button', class: 'link-btn', onclick: () => acao({ tipo: 'desfazer', credito: c.id }, 'Voltou para o automático.') }, 'desfazer');
      if (c.situacao === 'compensado') return null;
      const sel = h('select', { class: 'f-input cf-sel', 'aria-label': 'Marcar como' },
        h('option', { value: '' }, 'Marcar como…'), h('option', { value: 'boleto' }, 'Compensado no boleto'), h('option', { value: 'royalties' }, 'Compensado nos royalties'),
        h('option', { value: 'outro' }, 'Compensado de outro jeito'), h('option', { value: 'cancelar' }, 'Cancelado / não vai ser pago'));
      sel.addEventListener('change', () => {
        const v = sel.value; sel.value = '';
        if (!v) return;
        const obs = prompt(v === 'cancelar' ? 'Por que este crédito não vai ser pago? (opcional)' : 'Observação (opcional): data, nº do boleto…', '');
        if (obs === null) return;
        acao(v === 'cancelar' ? { tipo: 'cancelar', credito: c.id, obs } : { tipo: 'compensar', credito: c.id, como: v, obs }, 'Crédito atualizado.');
      });
      return sel;
    };
    const tab = TS.table({
      cols: [
        { key: 'numero', label: 'Devolução', align: 'l', render: (c) => h('span', null, h('a', { href: '#', class: 'prc-nome', onclick: (e) => { e.preventDefault(); e.stopPropagation(); abrirDev(c); } }, h('b', null, `NF-e ${c.numero ?? '—'}`)), h('small', { class: 'est-tam' }, `${dataTxt(c.emissao)}${c.notaOrigem ? ` · da NF ${c.notaOrigem.nf}` : ''}${c.xml ? '' : ' · XML ainda não chegou'}`)), sortVal: (c) => c.emissao },
        { key: 'fornecedor', label: 'Fornecedor', align: 'l', wrap: true },
        { key: 'valor', label: 'Valor', fmt: fmt.brl },
        { key: 'situacao', label: 'Situação', align: 'l', render: (c) => {
          const [t, cls] = ST[c.situacao] || [c.situacao, ''];
          const comp = c.compensado;
          return h('span', null, h('span', { class: 'cf-st ' + cls }, comp && comp.como === 'cancelado' ? 'Cancelado' : t),
            h('small', { class: 'est-tam' }, comp ? (comp.nota ? `na NF ${comp.nota.nf} de ${dataTxt(comp.nota.emissao)}${c.situacao === 'confirmar' ? ' (sugestão)' : ''}` : `${COMO[comp.como] || ''}${comp.obs ? ' · ' + comp.obs : ''}`) + (comp.por ? ` · ${comp.por}` : '')
              : `${c.dias} dia(s) sem desconto${c.situacao === 'atrasado' ? ` (prazo ${d.prazo})` : ''}`));
        }, sortVal: (c) => ({ atrasado: 0, aberto: 1, confirmar: 2, manual: 3, compensado: 4 })[c.situacao] ?? 9 },
        { key: 'acao', label: '', align: 'l', render: (c) => h('span', { class: 'cf-acoes', onclick: (e) => e.stopPropagation() }, menuCredito(c)) },
      ],
      rows, sortKey: 'numero', pageSize: 15, search: 'Buscar NF ou fornecedor…', searchKeys: ['fornecedor', 'numero'], cls: 'est-t', onRowClick: abrirDev,
      total: rows.length ? { numero: `${fmt.int(rows.length)} devoluções`, valor: rows.reduce((s, c) => s + c.valor, 0) } : null,
      empty: d.creditos.length ? 'Nenhuma devolução com esse filtro.' : 'Nenhuma NF-e de devolução autorizada ainda. Elas aparecem aqui quando o XML chega ao painel.',
    });
    const seg = TS.seg([['Todas', 'todos'], [`Atrasadas (${r.nAtrasado})`, 'atrasado'], [`Em aberto (${r.nAberto})`, 'aberto'], [`A confirmar (${r.nConfirmar || 0})`, 'confirmar'], ['Compensadas', 'compensado']], fil, (v) => { state.cfFil = v; pintar(corpo, loja, d); });

    // notas de compra com desconto: o que cada uma compensou, e as que pedem conferência
    const ligar = (n) => {
      // as em aberto/atrasadas e as que só têm sugestão (em outra nota) — ligar aqui tira a sugestão de lá
      const abertos = d.creditos.filter((c) => (c.situacao === 'aberto' || c.situacao === 'atrasado' || c.situacao === 'confirmar' || (n.creditos || []).includes(c.id)) && c.emissao <= (n.emissao || '9'))
        .sort((a, b) => a.emissao.localeCompare(b.emissao));
      if (!abertos.length) { toast('Nenhuma devolução emitida antes desta nota está livre para ligar.', true); return; }
      const marc = new Set((n.creditos || []).filter((id) => abertos.some((c) => c.id === id)));
      const soma = h('div', { class: 'cfl-soma' });
      const btnOk = h('button', { type: 'button', class: 'btn primary' });
      const pintarSoma = () => {
        const s0 = [...marc].reduce((a, id) => a + porId.get(id).valor, 0), dif = Math.round((n.desconto - s0) * 100) / 100;
        const ok = Math.abs(dif) < 0.1;
        soma.className = 'cfl-soma ' + (ok ? 'ok' : dif < 0 ? 'passou' : '');
        soma.replaceChildren(
          h('div', null, h('small', null, 'Marcado'), h('b', null, fmt.brl(s0))),
          h('div', null, h('small', null, 'Desconto da nota'), h('b', null, fmt.brl(n.desconto))),
          h('div', null, h('small', null, ok ? 'Fecha' : dif > 0 ? 'Sobra de desconto' : 'Passou do desconto'), h('b', null, ok ? '✓ certinho' : fmt.brl(Math.abs(dif)))));
        btnOk.disabled = !marc.size;
        btnOk.textContent = marc.size ? `Ligar ${marc.size} ${marc.size === 1 ? 'devolução' : 'devoluções'}` : 'Marque ao menos uma';
      };
      const fundo = h('div', { class: 'cp-modal-bg' });
      const fechar = () => fundo.remove();
      fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
      const linha = (c) => {
        const cb = h('input', { type: 'checkbox', checked: marc.has(c.id) || null, 'aria-label': `NF-e ${c.numero}` });
        const el = h('label', { class: 'cfl-linha' + (marc.has(c.id) ? ' on' : '') }, cb,
          h('span', { class: 'cfl-nf' }, h('b', null, `NF-e ${c.numero}`), h('small', null, dataTxt(c.emissao))),
          h('span', { class: 'cfl-onde' }, c.situacao === 'confirmar' && c.compensado && c.compensado.nota && c.compensado.nota.id !== n.id ? `sugerida na NF ${c.compensado.nota.nf}` : c.situacao === 'atrasado' ? 'atrasada' : (n.creditos || []).includes(c.id) ? 'nesta nota' : 'em aberto'),
          h('b', { class: 'cfl-valor' }, fmt.brl(c.valor)));
        cb.addEventListener('change', () => { if (cb.checked) marc.add(c.id); else marc.delete(c.id); el.classList.toggle('on', cb.checked); pintarSoma(); });
        return el;
      };
      btnOk.addEventListener('click', () => { if (!marc.size) return; fechar(); acao({ tipo: 'ligar', nota: n.id, creditos: [...marc] }, 'Nota ligada às devoluções.'); });
      fundo.append(h('div', { class: 'card cp-copiar cf-ligar' },
        h('div', { class: 'cfl-cab' }, h('div', null, h('h3', null, `Quais devoluções vieram na NF ${n.nf}?`), h('small', { class: 'muted' }, `Emitida em ${dataTxt(n.emissao)} · só aparecem devoluções emitidas antes dela`)),
          h('button', { type: 'button', class: 'cf-b', 'aria-label': 'Fechar', onclick: fechar }, '✕')),
        h('div', { class: 'cfl-lista' }, h('div', { class: 'cfl-tit' }, h('span'), h('span', null, 'Devolução'), h('span', null, 'Situação'), h('span', null, 'Valor')), ...abertos.map(linha)),
        soma,
        h('div', { class: 'cp-acoes' }, h('span', { style: { flex: 1 } }), h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Cancelar'), btnOk)));
      pintarSoma();
      document.body.append(fundo);
    };
    const tabN = d.notas.length ? TS.table({
      cols: [
        { key: 'nf', label: 'Nota de compra', align: 'l', render: (n) => h('span', null, h('a', { href: '#', class: 'prc-nome', title: 'Abrir a nota de entrada', onclick: (e) => { e.preventDefault(); e.stopPropagation(); abrirCompra(n.nf); } }, h('b', null, `NF ${n.nf}`)), h('small', { class: 'est-tam' }, `emissão ${dataTxt(n.emissao)}`)), sortVal: (n) => n.emissao },
        { key: 'desconto', label: 'Desconto', fmt: fmt.brl },
        { key: 'situacao', label: 'O que compensou', align: 'l', wrap: true, render: (n) => {
          const [t, cls] = NST[n.situacao] || [n.situacao, ''];
          const cs = (n.creditos || []).map((id) => porId.get(id)).filter(Boolean);
          return h('span', null, h('span', { class: 'cf-st ' + cls }, t), cs.length ? h('small', { class: 'est-tam' }, cs.map((c) => `NF-e ${c.numero} (${fmt.brl(c.valor)})`).join(' + '),
            n.sobra > 0.05 ? h('span', { class: 'cf-sobra' }, ` · sobram ${fmt.brl(n.sobra)} de desconto sem devolução`) : null) : null);
        } },
        { key: 'acao', label: '', align: 'l', render: (n) => (n.situacao === 'ignorada'
          ? h('div', { class: 'cf-btns' }, h('button', { type: 'button', class: 'cf-b', onclick: (e) => { e.stopPropagation(); acao({ tipo: 'considerar', nota: n.id }, 'Desconto volta a ser conferido.'); } }, '↺ É de devolução'))
          : h('div', { class: 'cf-btns', onclick: (e) => e.stopPropagation() },
            n.situacao === 'sugestao' || n.situacao === 'conferir' ? h('button', { type: 'button', class: 'cf-b cf-b-ok', title: 'As devoluções sugeridas vieram nesta nota', onclick: () => acao({ tipo: 'confirmar', nota: n.id, creditos: n.creditos }, 'Confirmado.') }, '✓ Confirmar') : null,
            n.situacao !== 'compensou' ? h('button', { type: 'button', class: 'cf-b', title: 'Escolher à mão quais devoluções vieram nesta nota', onclick: () => ligar(n) }, n.situacao === 'manual' ? '✎ Trocar devoluções' : '✎ Escolher devoluções') : null,
            n.situacao === 'sugestao' || n.situacao === 'conferir' ? h('button', { type: 'button', class: 'cf-b', title: 'A sugestão está errada: as devoluções voltam a ficar em aberto para as próximas notas', onclick: () => acao({ tipo: 'recusar', nota: n.id }, 'Sugestão recusada.') }, '✕ Recusar sugestão') : null,
            n.situacao === 'manual' ? null : h('button', { type: 'button', class: 'cf-b cf-b-cinza', title: 'Desconto de promoção, bonificação…: sai da conferência', onclick: () => { const obs = prompt('De que é este desconto? (opcional)', ''); if (obs !== null) acao({ tipo: 'ignorar', nota: n.id, obs }, 'Marcado como desconto que não é de devolução.'); } }, 'Não é devolução'))) },
      ],
      rows: d.notas, sortKey: 'nf', pageSize: 10, cls: 'est-t', onRowClick: (n) => abrirCompra(n.nf),
    }) : null;

    corpo.replaceChildren(...[
      h('div', { class: 'grid g-kpi' },
        TS.kpi('A receber, atrasado', fmt.brl(r.atrasado), r.nAtrasado ? `${fmt.int(r.nAtrasado)} devolução(ões) há mais de ${d.prazo} dias` : 'nada atrasado'),
        TS.kpi('A receber, no prazo', fmt.brl(r.aberto), `${fmt.int(r.nAberto)} devolução(ões) esperando desconto`),
        TS.kpi('Já compensado', fmt.brl(r.compensado), r.confirmar ? `+ ${fmt.brl(r.confirmar)} a confirmar` : 'descontado em notas ou marcado à mão'),
        TS.kpi('Para conferir', fmt.int(r.conferir), r.conferir ? 'notas com sugestão ou sem devolução que feche' : 'tudo ligado')),
      d.descontoLido ? null : h('div', { class: 'notice mt' }, h('b', null, 'Ainda sem o desconto das notas de compra. '), 'O robô passa a ler o desconto de cada nota na próxima sincronização das notas de entrada. Até lá, as devoluções ficam em aberto e você pode marcar à mão.'),
      h('div', { class: 'card mt' }, h('div', { class: 'card-title' }, 'Devoluções (créditos)'),
        h('div', { class: 'card-sub' }, `Cada NF-e de devolução autorizada. A franquia desconta cada uma inteira numa nota de compra seguinte; o painel acha a nota pelo valor do desconto. Sem desconto em ${d.prazo} dias = atrasada.`),
        h('div', { class: 'est-tools' }, tab.searchBox, seg), tab),
      tabN ? h('div', { class: 'card mt' }, h('div', { class: 'card-title' }, 'Notas de compra com desconto'),
        h('div', { class: 'card-sub' }, 'Desconto que fecha exatamente com uma combinação de devoluções: o painel liga sozinho. Quando há mais de uma combinação, ou o desconto é maior que as devoluções (pode ter outra coisa junto), o painel sugere as devoluções mais antigas que cabem: confirme ou recuse. Clique na nota para abri-la.'), tabN) : null].filter(Boolean));
  }
})();
