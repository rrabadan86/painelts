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

  /** menu "⋯" com ações secundárias: [[rótulo, fn, dica]] */
  function menuMais(itens) {
    const lista = h('div', { class: 'cf-menu-lista', hidden: true });
    const fechar = () => { lista.hidden = true; document.removeEventListener('click', fora, true); };
    const fora = (e) => { if (!box.contains(e.target)) fechar(); };
    const btn = h('button', { type: 'button', class: 'cf-b cf-mais', 'aria-label': 'Mais ações', title: 'Mais ações', onclick: (e) => { e.stopPropagation(); lista.hidden = !lista.hidden; if (!lista.hidden) document.addEventListener('click', fora, true); else fechar(); } }, '⋯');
    for (const [t, fn, dica] of itens) lista.append(h('button', { type: 'button', title: dica || '', onclick: (e) => { e.stopPropagation(); fechar(); fn(); } }, t));
    const box = h('span', { class: 'cf-menu', onclick: (e) => e.stopPropagation() }, btn, lista);
    return box;
  }

  function pintar(corpo, loja, d) {
    const r = d.resumo;
    const acao = async (b, msg) => {
      try { const nd = await api('POST', 'conta-franquia/acao', { loja, ...b }); if (msg) toast(msg); pintar(corpo, loja, nd); } catch (e) { toast(e.message, true); }
    };
    const porId = new Map(d.creditos.map((c) => [c.id, c]));
    const abrirDev = (c) => { if (c.xml && TS.abrirNFe) TS.abrirNFe(c.id, loja); else toast('O XML desta NF-e ainda não chegou ao painel.', true); };
    const abrirCompra = (nf) => { state.abrirNF = nf; state.prcNotasFil = 'todas'; location.hash = '#notas'; };
    const linkNF = (txt, fn, dica) => h('a', { href: '#', class: 'prc-nome', title: dica || 'Abrir a nota', onclick: (e) => { e.preventDefault(); e.stopPropagation(); fn(); } }, txt);
    const variosForn = new Set(d.creditos.map((c) => c.fornecedor)).size > 1;

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

    // ---------- 1) Para resolver: notas de compra com desconto que pedem você ----------
    const PEND = ['sugestao', 'conferir', 'sem_par', 'sem_credito'];
    const pend = d.notas.filter((n) => PEND.includes(n.situacao));
    const naoEhDev = (n) => () => { const obs = prompt('De que é este desconto? (opcional)', ''); if (obs !== null) acao({ tipo: 'ignorar', nota: n.id, obs }, 'Marcado como desconto que não é de devolução.'); };
    const itemPend = (n) => {
      const cs = (n.creditos || []).map((id) => porId.get(id)).filter(Boolean);
      const sug = n.situacao === 'sugestao' || n.situacao === 'conferir';
      const soma = cs.reduce((a, c) => a + c.valor, 0);
      const detalhe = sug
        ? h('div', { class: 'cfp-sug' },
          h('div', { class: 'cfp-rot' }, n.situacao === 'conferir' ? 'Fecha de mais de um jeito. Sugestão (as mais antigas):' : 'Sugestão (as mais antigas que cabem no desconto):'),
          h('div', { class: 'cfp-chips' }, ...cs.map((c) => h('span', { class: 'cfp-chip' }, linkNF(`NF-e ${c.numero}`, () => abrirDev(c), 'Abrir a devolução'), ' ', h('b', null, fmt.brl(c.valor)))),
            h('span', { class: 'cfp-igual' }, '= ', h('b', null, fmt.brl(soma)))),
          n.sobra > 0.05 ? h('div', { class: 'cfp-sobra' }, `Sobram ${fmt.brl(n.sobra)} de desconto sem devolução`) : h('div', { class: 'cfp-fecha' }, '✓ fecha com o desconto'))
        : h('div', { class: 'cfp-sug' }, h('div', { class: 'cfp-vazio' }, n.situacao === 'sem_credito' ? 'Nenhuma devolução em aberto emitida antes desta nota.' : 'Nenhuma combinação de devoluções em aberto cabe neste desconto.'),
          h('small', { class: 'muted' }, 'Se o desconto for de devolução, escolha quais. Se for promoção ou bonificação, marque que não é devolução.'));
      return h('div', { class: 'cfp-item' },
        h('div', { class: 'cfp-nota' }, linkNF(h('b', null, `NF ${n.nf}`), () => abrirCompra(n.nf), 'Abrir a nota de compra'), h('small', null, `emissão ${dataTxt(n.emissao)}`),
          h('div', { class: 'cfp-desc' }, h('small', null, 'Desconto'), h('b', null, fmt.brl(n.desconto)))),
        detalhe,
        h('div', { class: 'cfp-acoes' },
          sug ? h('button', { type: 'button', class: 'cf-b cf-b-ok', title: 'Estas devoluções vieram nesta nota', onclick: () => acao({ tipo: 'confirmar', nota: n.id, creditos: n.creditos }, 'Confirmado.') }, '✓ Confirmar') : null,
          h('button', { type: 'button', class: 'cf-b' + (sug ? '' : ' cf-b-ok'), onclick: () => ligar(n) }, sug ? 'Trocar' : 'Escolher devoluções'),
          menuMais([...(sug ? [['✕ Recusar a sugestão', () => acao({ tipo: 'recusar', nota: n.id }, 'Sugestão recusada.'), 'As devoluções voltam a ficar em aberto para as próximas notas']] : []),
            ['Não é devolução (promoção, bonificação…)', naoEhDev(n)]])));
    };
    const cardPend = h('div', { class: 'card mt' },
      h('div', { class: 'card-title' }, pend.length ? `Para resolver (${pend.length})` : 'Para resolver'),
      h('div', { class: 'card-sub' }, 'Notas de compra com desconto que o painel não conseguiu ligar sozinho. Confirme a sugestão, escolha as devoluções ou diga que o desconto é de outra coisa.'),
      pend.length ? h('div', { class: 'cfp-lista' }, ...pend.map(itemPend)) : h('p', { class: 'cfp-ok' }, '✓ Nada para resolver: todo desconto está ligado ou explicado.'));

    // ---------- 2) Devoluções ----------
    const fil = ['todos', 'aberto', 'atrasado', 'compensado', 'confirmar'].includes(state.cfFil) ? state.cfFil : 'todos';
    const filtra = (c) => fil === 'todos' || (fil === 'compensado' ? c.situacao === 'compensado' || c.situacao === 'manual' : c.situacao === fil);
    const rows = d.creditos.filter(filtra);
    const maisCredito = (c) => {
      if (c.situacao === 'compensado') return null;
      if (c.situacao === 'manual') return menuMais([['↺ Desfazer (volta ao automático)', () => acao({ tipo: 'desfazer', credito: c.id }, 'Voltou para o automático.')]]);
      const marcar = (tipo, como, pergunta) => () => { const obs = prompt(pergunta, ''); if (obs === null) return; acao(tipo === 'cancelar' ? { tipo, credito: c.id, obs } : { tipo, credito: c.id, como, obs }, 'Devolução atualizada.'); };
      return menuMais([
        ['Compensada no boleto', marcar('compensar', 'boleto', 'Observação (opcional): data, nº do boleto…')],
        ['Compensada nos royalties', marcar('compensar', 'royalties', 'Observação (opcional): mês dos royalties…')],
        ['Compensada de outro jeito', marcar('compensar', 'outro', 'Como foi compensada? (opcional)')],
        ['Cancelada / não vai ser paga', marcar('cancelar', null, 'Por que não vai ser paga? (opcional)')]]);
    };
    const tab = TS.table({
      cols: [
        { key: 'numero', label: 'Devolução', align: 'l', render: (c) => h('span', null, linkNF(h('b', null, `NF-e ${c.numero ?? '—'}`), () => abrirDev(c), 'Abrir a devolução'),
          h('small', { class: 'est-tam' }, `${dataTxt(c.emissao)}${c.notaOrigem ? ` · da NF ${c.notaOrigem.nf}` : ''}${variosForn && c.fornecedor ? ' · ' + c.fornecedor : ''}${c.xml ? '' : ' · XML ainda não chegou'}`)), sortVal: (c) => c.emissao },
        { key: 'valor', label: 'Valor', fmt: fmt.brl },
        { key: 'situacao', label: 'Situação', align: 'l', wrap: true, render: (c) => {
          const [t, cls] = ST[c.situacao] || [c.situacao, ''];
          const comp = c.compensado;
          return h('span', null, h('span', { class: 'cf-st ' + cls }, comp && comp.como === 'cancelado' ? 'Cancelada' : t), ' ',
            h('small', { class: 'muted' }, comp ? (comp.nota ? [`na NF ${comp.nota.nf} de ${dataTxt(comp.nota.emissao)}`] : `${COMO[comp.como] || ''}${comp.obs ? ' · ' + comp.obs : ''}`) : `há ${c.dias} dia(s) sem desconto`));
        }, sortVal: (c) => ({ atrasado: 0, aberto: 1, confirmar: 2, manual: 3, compensado: 4 })[c.situacao] ?? 9 },
        { key: 'acao', label: '', align: 'r', render: maisCredito },
      ],
      rows, sortKey: 'numero', pageSize: 15, search: 'Buscar NF…', searchKeys: ['fornecedor', 'numero'], cls: 'est-t cf-tab', onRowClick: abrirDev, cartao: true,
      total: rows.length ? { numero: `${fmt.int(rows.length)} devoluções`, valor: rows.reduce((s, c) => s + c.valor, 0) } : null,
      empty: d.creditos.length ? 'Nenhuma devolução com esse filtro.' : 'Nenhuma NF-e de devolução autorizada ainda. Elas aparecem aqui quando o XML chega ao painel.',
    });
    const seg = TS.seg([['Todas', 'todos'], [`Atrasadas (${r.nAtrasado})`, 'atrasado'], [`Em aberto (${r.nAberto})`, 'aberto'], [`A confirmar (${r.nConfirmar || 0})`, 'confirmar'], ['Compensadas', 'compensado']], fil, (v) => { state.cfFil = v; pintar(corpo, loja, d); });

    // ---------- 3) Já resolvidas (fechado) ----------
    const feitas = d.notas.filter((n) => !PEND.includes(n.situacao));
    const linhaFeita = (n) => {
      const cs = (n.creditos || []).map((id) => porId.get(id)).filter(Boolean);
      const [t, cls] = NST[n.situacao] || [n.situacao, ''];
      return h('div', { class: 'cff-linha' },
        h('span', null, linkNF(h('b', null, `NF ${n.nf}`), () => abrirCompra(n.nf)), h('small', { class: 'muted' }, ` · ${dataTxt(n.emissao)}`)),
        h('span', null, fmt.brl(n.desconto)),
        h('span', null, h('span', { class: 'cf-st ' + cls }, t), ' ', h('small', { class: 'muted' }, cs.length ? cs.map((c) => `NF-e ${c.numero}`).join(' + ') : n.obs || '')),
        n.situacao === 'ignorada' ? menuMais([['↺ É de devolução (voltar a conferir)', () => acao({ tipo: 'considerar', nota: n.id }, 'Desconto volta a ser conferido.')]])
          : menuMais([['Trocar devoluções', () => ligar(n)], ['Não é devolução', naoEhDev(n)]]));
    };
    const cardFeitas = feitas.length ? h('details', { class: 'card mt cff', open: state.cfFeitasAberto || null, ontoggle: (e) => { state.cfFeitasAberto = e.target.open; } },
      h('summary', null, h('b', null, `Notas de compra já resolvidas (${feitas.length})`), h('small', { class: 'muted' }, ' — desconto ligado às devoluções ou marcado como outra coisa')),
      h('div', { class: 'cff-lista' }, ...feitas.map(linhaFeita))) : null;

    corpo.replaceChildren(...[
      h('div', { class: 'grid g-kpi' },
        TS.kpi('A receber, atrasado', fmt.brl(r.atrasado), r.nAtrasado ? `${fmt.int(r.nAtrasado)} devolução(ões) há mais de ${d.prazo} dias` : 'nada atrasado'),
        TS.kpi('A receber, no prazo', fmt.brl(r.aberto), `${fmt.int(r.nAberto)} devolução(ões) esperando desconto`),
        TS.kpi('A confirmar', fmt.brl(r.confirmar || 0), r.nConfirmar ? `${fmt.int(r.nConfirmar)} devolução(ões) com sugestão` : 'nenhuma sugestão pendente'),
        TS.kpi('Já compensado', fmt.brl(r.compensado), 'descontado em notas ou marcado à mão')),
      d.descontoLido ? null : h('div', { class: 'notice mt' }, h('b', null, 'Ainda sem o desconto das notas de compra. '), 'O robô passa a ler o desconto na próxima sincronização das notas de entrada. Até lá, as devoluções ficam em aberto.'),
      cardPend,
      h('div', { class: 'card mt' }, h('div', { class: 'card-title' }, 'Devoluções'),
        h('div', { class: 'card-sub' }, `Cada NF-e de devolução autorizada${variosForn ? '' : ` para ${d.creditos[0] ? d.creditos[0].fornecedor : 'a franquia'}`}. Sem desconto em ${d.prazo} dias = atrasada. Clique para abrir a NF-e.`),
        h('div', { class: 'est-tools' }, tab.searchBox, seg), tab),
      cardFeitas].filter(Boolean));
  }
})();
