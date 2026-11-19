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

  const mesTxt = (ym) => (ym ? `${TS.MESES_LONGOS[+ym.slice(5, 7) - 1].toLowerCase()}/${ym.slice(0, 4)}` : '—');
  const somaMes = (ym, k) => { const x = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + k, 1)); return x.toISOString().slice(0, 7); };
  const PST = { ok: ['Recebido certo', 'cf-ok'], faltou: ['Veio a menos', 'cf-atrasado'], veio_mais: ['Veio a mais', 'cf-aberto'], atrasado: ['Atrasado', 'cf-atrasado'], aguardando: ['Aguardando royalty', 'cf-aberto'], mes_aberto: ['Mês em andamento', 'cf-cinza'] };

  /** janela: lançar o desconto que veio num royalty (mês de referência do royalty + mês dos prêmios que ele cobre) */
  function lancarRoyalty(fid, acaoRoy, mesPremios) {
    const hoje = new Date().toISOString().slice(0, 7);
    const ref = h('input', { type: 'month', class: 'f-input', value: mesPremios ? somaMes(mesPremios, 1) : hoje, max: somaMes(hoje, 1) });
    const meses = fid.meses.map((m) => m.mes);
    const prem = h('select', { class: 'f-input' }, ...meses.map((m) => h('option', { value: m, selected: m === (mesPremios || somaMes(ref.value, -1)) || null }, mesTxt(m))));
    const valor = h('input', { class: 'f-input', inputmode: 'decimal', placeholder: '0,00' });
    const obs = h('input', { class: 'f-input', maxlength: 200, placeholder: 'Opcional: nº do boleto, observação…' });
    const info = h('div', { class: 'cfr-info' });
    const pintarInfo = () => { const m = fid.meses.find((x) => x.mes === prem.value); info.replaceChildren(m ? h('span', null, `Prêmios de ${mesTxt(m.mes)}: custo ${fmt.brl(m.custo)} · a receber `, h('b', null, fmt.brl(m.devido)), m.recebido ? ` · já lançado ${fmt.brl(m.recebido)}` : '') : ''); };
    ref.addEventListener('change', () => { if (!mesPremios && ref.value) { const p = somaMes(ref.value, -1); if (meses.includes(p)) prem.value = p; pintarInfo(); } });
    prem.addEventListener('change', pintarInfo);
    const fundo = h('div', { class: 'cp-modal-bg' });
    const fechar = () => fundo.remove();
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    const ok = h('button', { type: 'button', class: 'btn primary', onclick: async () => { ok.disabled = true; const feito = await acaoRoy({ ref: ref.value, premios: prem.value, valor: valor.value, obs: obs.value }, 'Desconto nos royalties lançado.'); if (feito) fechar(); else ok.disabled = false; } }, 'Lançar');
    const campo = (rot, el, dica) => h('label', { class: 'cfr-campo' }, h('span', null, rot), el, dica ? h('small', { class: 'muted' }, dica) : null);
    fundo.append(h('div', { class: 'card cp-copiar cf-ligar' },
      h('div', { class: 'cfl-cab' }, h('div', null, h('h3', null, 'Desconto nos royalties (fidelidade)'), h('small', { class: 'muted' }, 'O que a franquia descontou no boleto de royalties pelos prêmios de fidelidade')), h('button', { type: 'button', class: 'cf-b', 'aria-label': 'Fechar', onclick: fechar }, '✕')),
      h('div', { class: 'cfr-grade' },
        campo('Royalty de referência', ref, 'O mês do royalty em que veio o desconto'),
        campo('Valor do desconto (R$)', valor),
        campo('Referente aos prêmios de', prem, 'Normalmente o mês anterior ao do royalty'),
        campo('Observação', obs)),
      info,
      h('div', { class: 'cp-acoes' }, h('span', { style: { flex: 1 } }), h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Cancelar'), ok)));
    pintarInfo();
    document.body.append(fundo);
    valor.focus();
  }

  /** janela: todos os resgates do mês — fidelizado, prêmio e custo, e o cupom da venda em que o prêmio saiu */
  const cpfTxt = (s) => (s && s.length === 11 ? `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}` : s || '');
  const telTxt = (t) => { const x = String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return x.length === 11 ? `(${x.slice(0, 2)}) ${x.slice(2, 7)}-${x.slice(7)}` : x.length === 10 ? `(${x.slice(0, 2)}) ${x.slice(2, 6)}-${x.slice(6)}` : ''; };
  const horaTxt = (min) => (min == null ? '' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);
  function verMes(m, acaoRoy, fid, loja) {
    const fundo = h('div', { class: 'cp-modal-bg' });
    const fechar = () => fundo.remove();
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    const resg = m.resgates.slice().sort((a, b) => (a.data + String(a.min ?? '')).localeCompare(b.data + String(b.min ?? '')));
    const cupons = TS.fx && TS.fx.cupomDosResgates ? TS.fx.cupomDosResgates(loja, resg) : resg.map(() => null);
    const cli = (cpf) => (TS.cli && TS.cli.porCPF && TS.cli.porCPF.get(cpf)) || null;
    const achados = cupons.filter(Boolean).length;
    const item = (r, k) => {
      const c = cli(r.cpf), cp = cupons[k];
      const custo = r.produtos.reduce((s0, p) => s0 + (p.custo || 0), 0);
      const COMO = { fixe: 'mesma compra no FIXE', cpf: 'CPF do cliente na nota', hora: 'pela hora e pelo produto (confira)' };
      const det = cp ? h('details', { class: 'cfm-cupom' }, h('summary', null, h('b', null, `Cupom ${cp.cupom}`), ` · ${horaTxt(cp.min)}${cp.vendedor ? ' · ' + cp.vendedor : ''} · ${fmt.brl(cp.vt)}`,
        h('small', { class: 'cfm-como' + (cp.como === 'hora' ? ' aprox' : '') }, COMO[cp.como] || '')),
        h('div', { class: 'cfm-itens' }, ...cp.itens.map((it) => h('div', null, h('span', null, it.desc), h('span', null, it.qtd != null ? `${fmt.n2(it.qtd).replace(/,00$/, '')} × ` : '', fmt.brl(it.vt))))))
        : h('div', { class: 'cfm-semcupom', title: 'Nenhum cupom da loja no mesmo dia, perto do horário, com o produto do prêmio (o painel pode não ter as vendas desse dia)' }, 'cupom não achado');
      return h('div', { class: 'cfm-item' },
        h('div', { class: 'cfm-quando' }, h('b', null, fmt.date(r.data)), h('small', null, horaTxt(r.min) || '—'), h('small', null, `${fmt.int(r.pontos)} pontos`)),
        h('div', { class: 'cfm-quem' },
          r.cpf && TS.abrirClientes ? h('a', { href: '#', class: 'prc-nome', title: 'Abrir a ficha do cliente', onclick: (e) => { e.preventDefault(); fechar(); TS.abrirClientes([r.cpf]); } }, h('b', null, (c && c.nome) || r.cliente || cpfTxt(r.cpf))) : h('b', null, r.cliente || '—'),
          h('small', null, [cpfTxt(r.cpf), c && telTxt(c.celular)].filter(Boolean).join(' · ')),
          c && c.fx && c.fx.saldo != null ? h('small', null, `saldo hoje: ${fmt.int(c.fx.saldo)} pontos`) : null),
        h('div', { class: 'cfm-premio' }, ...r.produtos.map((p) => h('div', null, h('span', null, p.nome), p.custo == null ? h('span', { class: 'cf-sobra', title: 'Produto não achado no estoque' }, 'sem custo') : h('span', null, fmt.brl(p.custo)))),
          r.produtos.length > 1 ? h('div', { class: 'cfm-tot' }, h('span', null, 'Custo'), h('b', null, fmt.brl(custo))) : null),
        h('div', { class: 'cfm-cup' }, det));
    };
    const card = h('div', { class: 'card cp-copiar cf-ligar cfr-mes' },
      h('div', { class: 'cfl-cab' }, h('div', null, h('h3', null, `Prêmios de ${mesTxt(m.mes)}`),
        h('small', { class: 'muted' }, `${fmt.int(m.resgates.length)} resgates · custo ${fmt.brl(m.custo)} · a receber ${fmt.int(fid.pct * 100)}% = ${fmt.brl(m.devido)} · cupom achado em ${fmt.int(achados)} de ${fmt.int(resg.length)}`)),
        h('div', { class: 'cfm-topo-btn' }, h('button', { type: 'button', class: 'cf-b', title: 'Imprimir ou salvar em PDF', onclick: () => TS.imprimir && TS.imprimir(card) }, '🖨 Imprimir'), h('button', { type: 'button', class: 'cf-b', 'aria-label': 'Fechar', onclick: fechar }, '✕'))),
      m.semCusto ? h('div', { class: 'notice' }, `${fmt.int(m.semCusto)} prêmio(s) sem custo no painel (produto não achado no estoque): o valor a receber pode estar abaixo do certo.`) : null,
      h('div', { class: 'cfm-cab' }, h('span', null, 'Data'), h('span', null, 'Fidelizado'), h('span', null, 'Prêmio e custo'), h('span', null, 'Cupom da venda')),
      h('div', { class: 'cfm-lista' }, ...resg.map(item)),
      h('div', { class: 'cfr-lanc' }, h('b', null, 'Descontos lançados nos royalties'),
        m.lancamentos.length ? h('div', null, ...m.lancamentos.map((l) => h('div', { class: 'cfr-lanc-l' }, h('span', null, `Royalty de ${mesTxt(l.ref)}: `, h('b', null, fmt.brl(l.valor)), l.obs ? h('small', { class: 'muted' }, ` · ${l.obs}`) : null, l.por ? h('small', { class: 'muted' }, ` · ${l.por}`) : null),
          h('button', { type: 'button', class: 'link-btn', onclick: async () => { if (!confirm('Apagar este lançamento?')) return; if (await acaoRoy({ tipo: 'apagar', id: l.id }, 'Lançamento apagado.')) fechar(); } }, 'apagar'))))
          : h('p', { class: 'muted' }, 'Nenhum desconto lançado para os prêmios deste mês.'),
        h('div', { class: 'cp-acoes' }, h('span', { style: { flex: 1 } }), h('button', { type: 'button', class: 'btn primary', onclick: () => { fechar(); lancarRoyalty(fid, acaoRoy, m.mes); } }, '+ Lançar desconto deste mês'))));
    fundo.append(card);
    document.body.append(fundo);
  }

  /** janela de cobrança por e-mail: escolher o que cobrar, revisar destinatários/assunto/mensagem e enviar */
  function cobrar(tipo, d, loja) {
    const fid = tipo === 'fidelidade';
    const opcoes = fid
      ? d.fidelidade.meses.filter((m) => m.situacao !== 'mes_aberto' && m.situacao !== 'ok').map((m) => ({ id: m.mes, rot: `Prêmios de ${mesTxt(m.mes)}`, val: Math.max(0, m.devido - m.recebido), info: (PST[m.situacao] || [''])[0], marcado: m.situacao === 'atrasado' || m.situacao === 'faltou' }))
      : d.creditos.filter((c) => c.situacao === 'atrasado' || c.situacao === 'aberto' || c.situacao === 'confirmar').map((c) => ({ id: c.id, rot: `NF-e ${c.numero} · ${dataTxt(c.emissao)}`, val: c.valor, info: (ST[c.situacao] || [''])[0], marcado: c.situacao === 'atrasado' }));
    if (!opcoes.length) { toast(fid ? 'Nenhum mês de prêmios para cobrar.' : 'Nenhuma devolução em aberto para cobrar.', true); return; }
    const marc = new Set(opcoes.filter((o) => o.marcado).map((o) => o.id));
    if (!marc.size) marc.add(opcoes[0].id);
    const para = h('input', { class: 'f-input', placeholder: 'email@franquia.com.br, outro@…' });
    const assunto = h('input', { class: 'f-input', maxlength: 200 });
    const msg = h('textarea', { class: 'f-input cfe-msg', rows: 7 });
    const prev = h('div', { class: 'cfe-prev' });
    const info = h('div', { class: 'cfe-info muted' });
    let editouA = false, editouM = false;
    assunto.addEventListener('input', () => { editouA = true; });
    msg.addEventListener('input', () => { editouM = true; });
    const enviar = h('button', { type: 'button', class: 'btn primary' }, '✉ Enviar e-mail');
    const carregar = async () => {
      enviar.disabled = !marc.size;
      if (!marc.size) { prev.replaceChildren(h('p', { class: 'muted' }, 'Marque o que cobrar.')); return; }
      try {
        const r = await api('POST', 'conta-franquia/email/previa', { loja, tipo, ...(fid ? { meses: [...marc] } : { ids: [...marc] }) });
        if (!para.value) para.value = (r.para || []).join(', ');
        if (!editouA) assunto.value = r.assunto;
        if (!editouM) msg.value = r.mensagem;
        prev.innerHTML = r.tabelaHtml; // montada no servidor, com o texto escapado
        info.replaceChildren(...[h('div', null, h('b', null, 'Anexos: '), (r.anexos || []).join(', ') || 'nenhum'),
          r.ultima ? h('div', null, `Última cobrança deste tipo: ${new Date(r.ultima.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} por ${r.ultima.por || '—'}, para ${r.ultima.para.join(', ')}`) : null].filter(Boolean));
      } catch (e) { prev.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
    };
    const fundo = h('div', { class: 'cp-modal-bg' });
    const fechar = () => fundo.remove();
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    enviar.addEventListener('click', async () => {
      const total = opcoes.filter((o) => marc.has(o.id)).reduce((s0, o) => s0 + o.val, 0);
      if (!confirm(`Enviar a cobrança para ${para.value}?\n\n${marc.size} ${fid ? 'mês(es) de prêmios' : 'nota(s) de devolução'} · ${fmt.brl(total)}`)) return;
      enviar.disabled = true; enviar.textContent = 'Enviando…';
      try {
        await api('POST', 'conta-franquia/email/enviar', { loja, tipo, para: para.value, assunto: assunto.value, mensagem: msg.value, ...(fid ? { meses: [...marc] } : { ids: [...marc] }) });
        fechar(); toast('Cobrança enviada.');
      } catch (e) { toast(e.message, true); enviar.disabled = false; enviar.textContent = '✉ Enviar e-mail'; }
    });
    const lista = h('div', { class: 'cfl-lista cfe-itens' }, ...opcoes.map((o) => {
      const cb = h('input', { type: 'checkbox', checked: marc.has(o.id) || null });
      const el = h('label', { class: 'cfl-linha' + (marc.has(o.id) ? ' on' : '') }, cb, h('span', { class: 'cfl-nf' }, h('b', null, o.rot)), h('span', { class: 'cfl-onde' }, o.info), h('b', { class: 'cfl-valor' }, fmt.brl(o.val)));
      cb.addEventListener('change', () => { if (cb.checked) marc.add(o.id); else marc.delete(o.id); el.classList.toggle('on', cb.checked); carregar(); });
      return el;
    }));
    const campo = (rot, el) => h('label', { class: 'cfr-campo' }, h('span', null, rot), el);
    fundo.append(h('div', { class: 'card cp-copiar cf-ligar cfe' },
      h('div', { class: 'cfl-cab' }, h('div', null, h('h3', null, fid ? 'Cobrar a franquia · prêmios de fidelidade' : 'Cobrar a franquia · devoluções'), h('small', { class: 'muted' }, 'Revise e envie. Nada sai sem você clicar em Enviar.')), h('button', { type: 'button', class: 'cf-b', 'aria-label': 'Fechar', onclick: fechar }, '✕')),
      h('div', { class: 'cfe-sec' }, fid ? 'Meses a cobrar' : 'Notas a cobrar'), lista,
      campo('Para', para), campo('Assunto', assunto), campo('Mensagem', msg),
      h('div', { class: 'cfe-sec' }, 'Vai junto no e-mail'), prev, info,
      h('div', { class: 'cp-acoes' }, h('span', { style: { flex: 1 } }), h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Cancelar'), enviar)));
    document.body.append(fundo);
    carregar();
  }

  function premiosCard(d, loja, acaoRoy) {
    const fid = d.fidelidade;
    if (!fid) return null;
    if (fid.erro) return h('div', { class: 'notice err mt' }, fid.erro);
    const r = fid.resumo;
    const tab = fid.meses.length ? TS.table({
      cols: [
        { key: 'mes', label: 'Prêmios de', align: 'l', render: (m) => h('span', null, h('a', { href: '#', class: 'prc-nome', onclick: (e) => { e.preventDefault(); e.stopPropagation(); verMes(m, acaoRoy, fid, loja); } }, h('b', null, mesTxt(m.mes))), h('small', { class: 'est-tam' }, `${fmt.int(m.resgates.length)} resgates`)), sortVal: (m) => m.mes },
        { key: 'custo', label: 'Custo dos prêmios', render: (m) => h('span', null, fmt.brl(m.custo), m.semCusto ? h('small', { class: 'cf-sobra', title: 'Prêmios sem custo no painel' }, ` +${m.semCusto}?`) : null), sortVal: (m) => m.custo },
        { key: 'devido', label: `A receber (${fmt.int(fid.pct * 100)}%)`, fmt: fmt.brl },
        { key: 'recebido', label: 'Recebido nos royalties', render: (m) => (m.lancamentos.length ? h('span', null, fmt.brl(m.recebido), h('small', { class: 'est-tam' }, m.lancamentos.map((l) => `royalty de ${mesTxt(l.ref)}`).join(' + '))) : h('span', { class: 'muted' }, '—')), sortVal: (m) => m.recebido },
        { key: 'diferenca', label: 'Diferença', render: (m) => (m.situacao === 'ok' ? h('span', { class: 'muted' }, '—') : !m.lancamentos.length ? h('span', { class: 'muted' }, '—') : h('b', { class: m.diferenca > 0 ? 'neg' : 'pos' }, (m.diferenca > 0 ? 'faltam ' : 'a mais ') + fmt.brl(Math.abs(m.diferenca)))), sortVal: (m) => m.diferenca },
        { key: 'situacao', label: 'Situação', align: 'l', render: (m) => { const [t, cls] = PST[m.situacao] || [m.situacao, '']; return h('span', { class: 'cf-st ' + cls }, t); } },
        { key: 'acao', label: '', align: 'r', render: (m) => (m.situacao === 'mes_aberto' ? null : h('span', { onclick: (e) => e.stopPropagation() }, h('button', { type: 'button', class: 'cf-b' + (m.situacao === 'atrasado' || m.situacao === 'aguardando' ? ' cf-b-ok' : ''), onclick: () => lancarRoyalty(fid, acaoRoy, m.mes) }, '+ Lançar'))) },
      ],
      rows: fid.meses, sortKey: 'mes', pageSize: 12, cls: 'est-t', onRowClick: (m) => verMes(m, acaoRoy, fid, loja),
    }) : null;
    return h('div', { class: 'card mt' },
      h('div', { class: 'cfr-topo' }, h('div', null, h('div', { class: 'card-title' }, 'Prêmios de fidelidade · desconto nos royalties'),
        h('div', { class: 'card-sub' }, `A franquia devolve ${fmt.int(fid.pct * 100)}% do custo dos prêmios resgatados no FIXE, como desconto no boleto de royalties (normalmente no royalty do mês seguinte). Lance o desconto que veio, com o mês de referência do royalty, e o painel confere.`)),
        fid.meses.length ? h('div', { class: 'cfr-btns' }, h('button', { type: 'button', class: 'btn', onclick: () => cobrar('fidelidade', d, loja) }, '✉ Cobrar a franquia'), h('button', { type: 'button', class: 'btn primary', onclick: () => lancarRoyalty(fid, acaoRoy) }, '+ Lançar desconto nos royalties')) : null),
      fid.meses.length ? h('div', { class: 'cfr-res' },
        h('div', { class: r.nAtrasado ? 'ruim' : '' }, h('small', null, 'Atrasado'), h('b', null, fmt.brl(r.atrasado)), h('small', null, r.nAtrasado ? `${r.nAtrasado} mês(es) sem desconto` : 'nada atrasado')),
        h('div', { class: r.nFaltou ? 'ruim' : '' }, h('small', null, 'Veio a menos'), h('b', null, fmt.brl(r.faltou)), h('small', null, r.nFaltou ? `${r.nFaltou} mês(es) com diferença` : 'nenhuma diferença')),
        h('div', null, h('small', null, 'Aguardando'), h('b', null, fmt.brl(r.aguardando)), h('small', null, 'meses que ainda não venceram')),
        h('div', null, h('small', null, 'Recebido'), h('b', null, fmt.brl(r.recebido)), h('small', null, 'lançado nos royalties'))) : null,
      tab || h('p', { class: 'muted' }, 'Nenhum resgate de prêmio no FIXE desta loja ainda. Os resgates vêm da importação dos Logs do FIXE.'));
  }

  function pintar(corpo, loja, d) {
    const r = d.resumo;
    const acao = async (b, msg) => {
      try { const nd = await api('POST', 'conta-franquia/acao', { loja, ...b }); if (msg) toast(msg); pintar(corpo, loja, nd); } catch (e) { toast(e.message, true); }
    };
    const acaoRoy = async (b, msg) => {
      try { const nd = await api('POST', 'conta-franquia/royalties', { loja, ...b }); if (msg) toast(msg); pintar(corpo, loja, nd); return true; } catch (e) { toast(e.message, true); return false; }
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
          // posições fixas (botão principal · secundário · ⋯): ficam alinhados de nota para nota
          sug ? h('button', { type: 'button', class: 'cf-b cf-b-ok cfp-b1', title: 'Estas devoluções vieram nesta nota', onclick: () => acao({ tipo: 'confirmar', nota: n.id, creditos: n.creditos }, 'Confirmado.') }, '✓ Confirmar')
            : h('button', { type: 'button', class: 'cf-b cf-b-ok cfp-b1', onclick: () => ligar(n) }, 'Escolher devoluções'),
          sug ? h('button', { type: 'button', class: 'cf-b cfp-b2', onclick: () => ligar(n) }, 'Trocar') : h('span', { class: 'cfp-b2' }),
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

    // ---------- 4) Prêmios de fidelidade: 50% do custo, como desconto nos royalties ----------
    const cardPremios = premiosCard(d, loja, acaoRoy);
    corpo.replaceChildren(...[
      h('div', { class: 'grid g-kpi' },
        TS.kpi('A receber, atrasado', fmt.brl(r.atrasado), r.nAtrasado ? `${fmt.int(r.nAtrasado)} devolução(ões) há mais de ${d.prazo} dias` : 'nada atrasado'),
        TS.kpi('A receber, no prazo', fmt.brl(r.aberto), `${fmt.int(r.nAberto)} devolução(ões) esperando desconto`),
        TS.kpi('A confirmar', fmt.brl(r.confirmar || 0), r.nConfirmar ? `${fmt.int(r.nConfirmar)} devolução(ões) com sugestão` : 'nenhuma sugestão pendente'),
        TS.kpi('Já compensado', fmt.brl(r.compensado), 'descontado em notas ou marcado à mão')),
      d.descontoLido ? null : h('div', { class: 'notice mt' }, h('b', null, 'Ainda sem o desconto das notas de compra. '), 'O robô passa a ler o desconto na próxima sincronização das notas de entrada. Até lá, as devoluções ficam em aberto.'),
      cardPend,
      h('div', { class: 'card mt' }, h('div', { class: 'cfr-topo' }, h('div', { class: 'card-title' }, 'Devoluções'), d.creditos.some((c) => c.situacao === 'atrasado' || c.situacao === 'aberto' || c.situacao === 'confirmar') ? h('button', { type: 'button', class: 'btn', onclick: () => cobrar('devolucoes', d, loja) }, '✉ Cobrar a franquia') : null),
        h('div', { class: 'card-sub' }, `Cada NF-e de devolução autorizada${variosForn ? '' : ` para ${d.creditos[0] ? d.creditos[0].fornecedor : 'a franquia'}`}. Sem desconto em ${d.prazo} dias = atrasada. Clique para abrir a NF-e.`),
        h('div', { class: 'est-tools' }, tab.searchBox, seg), tab),
      cardPremios,
      cardFeitas].filter(Boolean));
  }
})();
