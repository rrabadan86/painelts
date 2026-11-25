/* Vendas → Conferência: dá para confiar nos números?
 * - Caixa × painel: o faturamento do painel de cada dia confere com o fechamento do caixa (AppNext)?
 * - Cancelados: notas canceladas, o que o caixa cancelou e o que ainda conta nas vendas (e na comissão).
 * - Saúde dos dados: quanto das vendas casa com o estoque, quanto está sem custo e a idade de cada fonte.
 * As contas são de conferencia.js (TS.conferencia); o servidor entrega tudo em /api/conferencia (só lê). */
(function () {
  const { h, fmt, state } = TS;
  const toast = (msg, erro) => { const t = h('div', { class: 'toast' + (erro ? ' err' : '') }, msg); document.body.append(t); setTimeout(() => t.remove(), erro ? 6000 : 3000); };
  const dm = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—');
  const semana = (iso) => TS.conferencia.DIAS_SEMANA[new Date(iso + 'T12:00:00Z').getUTCDay()];
  const sinal = (x) => (x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + fmt.brl(Math.abs(x)));
  const cache = new Map(); // loja → { at, d }
  TS.aoLimparCache && TS.aoLimparCache(() => cache.clear());

  /** conferência da loja (guardada por 2 minutos; o Início e a tela usam a mesma resposta) */
  TS.conferenciaBuscar = async function (loja, forcar) {
    const c = cache.get(loja);
    if (c && !forcar && Date.now() - c.at < 120e3) return c.d;
    const r = await fetch(TS.api(`conferencia?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || 'Não consegui ler a conferência.');
    cache.set(loja, { at: Date.now(), d });
    return d;
  };

  const ABAS = [
    ['caixa', 'Caixa × painel', 'O faturamento do painel de cada dia comparado com o que o caixa recebeu no fechamento do AppNext.'],
    ['cancelados', 'Cancelados', 'Notas e cupons cancelados: quanto foi, de quem, e o que ainda conta nas vendas.'],
    ['saude', 'Saúde dos dados', 'Quanto das vendas casa com o estoque, quanto está sem custo e se cada fonte está em dia.'],
  ];

  TS.pages.conferencia = function (root) {
    if (TS.subGrupo) root.append(TS.subGrupo('conferencia'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Conferência'),
      h('div', { class: 'page-sub' }, 'Dá para confiar nos números? O faturamento do painel comparado com o caixa, os cupons cancelados e a situação dos dados.'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'Escolha a loja no seletor do topo: a conferência é de uma loja por vez.')); return; }
    const corpo = h('div', { class: 'mt' }, h('div', { class: 'loading' }, h('div', { class: 'spinner' }), 'Conferindo…'));
    root.append(corpo);
    const loja = state.loja;
    TS.conferenciaBuscar(loja).then((d) => { if (corpo.isConnected) pintar(corpo, loja, d); })
      .catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, TS.erroDeRede && TS.erroDeRede(e) ? 'Sem conexão agora. Tente de novo em instantes.' : e.message)));
  };

  function pintar(corpo, loja, d) {
    const aba = ABAS.some(([k]) => k === state.confAba) ? state.confAba : 'caixa';
    const n = { caixa: d.resumo.naobate, cancelados: d.cancelados.impacto.cupons, saude: (d.fontes || []).filter((f) => f.sinal === 'vermelho').length };
    const area = h('div', { class: 'mt' });
    const seg = TS.seg(ABAS.map(([k, rot, dica]) => [n[k] ? `${rot} (${fmt.int(n[k])})` : rot, k, dica]), aba, (k) => { state.confAba = k; desenhar(k); });
    seg.classList.add('conf-abas');
    const desenhar = (k) => { area.replaceChildren(); ({ caixa: abaCaixa, cancelados: abaCancelados, saude: abaSaude })[k](area, loja, d, () => { cache.delete(loja); TS.render(); }); };
    corpo.replaceChildren(seg, area);
    desenhar(aba);
  }

  // ======================= caixa × painel =======================
  const EST = { bate: ['Bate', 'ok'], explicado: ['Bate com explicação', 'ok'], naobate: ['Não bate', 'erro'], semfechamento: ['Sem fechamento', 'cinza'] };
  function abaCaixa(area, loja, d, recarregar) {
    const R = d.resumo, T = d.cfg.tolerancia;
    if (!d.temCaixa) {
      area.append(h('div', { class: 'notice warn' }, 'O painel ainda não leu nenhum fechamento de caixa desta loja. Ele é lido pelo robô junto com as vendas (AppNext → Vendas → Fechamentos de PDV): aparece depois da próxima atualização.'));
    } else if (d.recentes.length) {
      const m = d.recentes.reduce((a, x) => (Math.abs(x.dif) > Math.abs(a.dif) ? x : a));
      area.append(h('div', { class: 'notice warn' }, TS.etqPrazo('semana'), ' ', `${fmt.int(d.recentes.length)} ${d.recentes.length === 1 ? 'dia recente não bate' : 'dias recentes não batem'} com o caixa. Maior diferença: ${sinal(m.dif)} em ${dm(m.dia)}. Veja o motivo provável na tabela.`));
    }
    let fil = state.confFil || (R.naobate ? 'naobate' : 'todos');
    const tabela = h('div');
    const filtros = [['todos', `Todos (${fmt.int(R.total)})`, 'Todos os dias com venda ou com caixa fechado nos últimos 60 dias.'],
      ['naobate', `Não batem (${fmt.int(R.naobate)})`, `Dias em que a diferença passa da tolerância de ${fmt.brl(T)} e o painel não achou explicação.`],
      ['bate', `Batem (${fmt.int(R.bate + R.explicado)})`, 'Dias que conferem, direto ou depois de somar o que fica de fora de um dos lados (taxa de serviço, itens a R$ 0,01…).'],
      ['semfechamento', `Sem fechamento (${fmt.int(R.semfechamento)})`, 'Dias com venda no painel e sem caixa fechado lido do AppNext.']];
    const seg = TS.seg(filtros.map(([k, rot, dica]) => [rot, k, dica]), fil, (k) => { fil = state.confFil = k; pintarTabela(); });
    const irPara = (k) => () => { fil = state.confFil = k; TS.segMarcar(seg, k); pintarTabela(); };
    const clicavel = (el, k) => { el.classList.add('est-kpi-click'); el.setAttribute('role', 'button'); el.tabIndex = 0; el.addEventListener('click', irPara(k)); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') irPara(k)(); }); return el; };
    const S = d.sobras;
    area.append(h('div', { class: 'grid g-kpi vp2-conf-kpi' },
      clicavel(TS.kpi('Dias que batem', fmt.int(R.bate + R.explicado), R.explicado ? `${fmt.int(R.explicado)} com explicação` : `de ${fmt.int(R.total)} dias`,
        `Dias em que o faturamento do painel e o total do caixa ficam a até ${fmt.brl(T)} um do outro.\n\n"Com explicação": a diferença é exatamente o que fica de fora de um dos lados (taxa de serviço, itens a R$ 0,01, venda fora do caixa) ou o caixa foi fechado depois da meia-noite. Toque para ver na tabela.`, R.total && !R.naobate ? 'bom' : null), 'bate'),
      clicavel(TS.kpi('Não batem', fmt.int(R.naobate), R.naobate ? h('span', { class: 'down' }, `${fmt.brl(R.somaNaoBate)} somando as diferenças`) : 'nenhum dia 👏',
        `Dias em que a diferença entre o caixa e o painel passa de ${fmt.brl(T)} e nenhuma explicação fechou a conta. É aqui que pode haver venda fora da planilha, cupom cancelado contando ou recebimento lançado no dia errado. Toque para ver na tabela.`, R.naobate ? 'ruim' : null), 'naobate'),
      clicavel(TS.kpi('Sem fechamento', fmt.int(R.semfechamento), d.caixaLido ? `caixa lido em ${new Date(d.caixaLido).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'caixa nunca lido',
        'Dias com venda no painel em que o AppNext ainda não tinha o caixa fechado na última leitura. Hoje sempre aparece aqui até o caixa fechar. Toque para ver na tabela.'), 'semfechamento'),
      TS.kpi('Sobra e falta de caixa', sinal(S.saldo), `${fmt.int(S.faltas.n)} ${S.faltas.n === 1 ? 'falta' : 'faltas'} · ${fmt.int(S.sobras.n)} ${S.sobras.n === 1 ? 'sobra' : 'sobras'} em ${fmt.int(S.dias)} dias`,
        `Dinheiro contado na gaveta − o que deveria ter (abertura + vendas em dinheiro + suprimentos − sangrias), somado nos dias em que passou de ${fmt.brl(T)}.\n\nFaltas: ${fmt.brl(S.faltas.valor)} · sobras: ${fmt.brl(S.sobras.valor)}. Negativo = faltou dinheiro. Veja por operador mais abaixo.`, S.saldo < -T ? 'ruim' : null)));

    // FECH-REENV-01 (pedido do dono, 25/11/2026): "✉ Reenviar" o fechamento de um dia — admin e franqueado (o servidor confere)
    const podeReenviar = TS.demo || (TS.podeContabilidade && TS.podeContabilidade());
    async function reenviar(dia, bt) {
      const data = `${dm(dia)}/${dia.slice(0, 4)}`;
      if (!(await TS.janelaConfirmar(`Reenviar o fechamento de ${data}?`, [h('p', null, 'O mesmo e-mail do envio automático vai de novo para os destinatários cadastrados da loja (e o Telegram, se tiver).')], 'Reenviar', 'Cancelar'))) return;
      bt.disabled = true;
      try {
        const url = TS.demo ? TS.api('fechamento/reenviar') : `/api/admin/lojas/${encodeURIComponent(loja)}/fechamento-email/enviar`;
        const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ dia }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Não foi possível reenviar.');
        const ok = (j.envios || []).filter((x) => x.ok), falhas = (j.envios || []).filter((x) => !x.ok);
        if (falhas.length) TS.avisar(`Fechamento de ${data}: ${ok.length} enviado(s); não foi para ${falhas.map((x) => `${x.para} (${x.erro})`).join('; ')}.`);
        else TS.avisar(`Fechamento de ${data} reenviado para ${ok.length} ${ok.length === 1 ? 'destinatário' : 'destinatários'}.${j.demo ? ' (Apresentação: nada foi enviado.)' : ''}`);
      } catch (e) { TS.avisarErro ? TS.avisarErro(e) : TS.avisar(e.message); } finally { bt.disabled = false; }
    }
    function pintarTabela() {
      const rows = d.lista.filter((x) => fil === 'todos' || (fil === 'bate' ? x.estado === 'bate' || x.estado === 'explicado' : x.estado === fil));
      tabela.replaceChildren(TS.table({ linhaMob: { nome: 'dia', val: 'dif', l2: ['fat', 'caixa', 'estado', 'gaveta'], l3: ['reenviar'] }, // celular em linhas (LMOB-04)
        
        cls: 'conf-t', sortKey: 'dia', sortDir: 'desc', maxHeight: '640px', rows,
        empty: { naobate: 'Nenhum dia fora da tolerância. 👏', semfechamento: 'Todos os dias com venda têm o caixa lido.', bate: 'Nenhum dia conferido ainda.', todos: 'Sem vendas nem caixa nos últimos 60 dias.' }[fil],
        cols: [
          { key: 'dia', label: 'Dia', align: 'l', sticky: true, title: 'Dia da venda. Para o caixa vale o dia em que ele foi fechado no AppNext.',
            render: (x) => h('div', null, h('b', null, dm(x.dia)), h('small', { class: 'muted conf-sub' }, semana(x.dia))) },
          { key: 'fat', label: 'Painel', title: 'Faturamento do painel no dia: tudo o que foi vendido, com Espaço Gourmet e vendas sem vendedor, sem taxas de serviço e entrega e sem itens a R$ 0,01. É o mesmo número do Resumo e do Resultado.',
            render: (x) => h('div', null, fmt.brl(x.fat), x.cupons ? h('small', { class: 'muted conf-sub' }, `${fmt.int(x.cupons)} ${x.cupons === 1 ? 'cupom' : 'cupons'}`) : null) },
          { key: 'caixa', label: 'Caixa', title: 'Total recebido no fechamento do caixa do AppNext (soma das formas de pagamento: cartão, Pix, dinheiro, troca…). Com mais de um caixa no dia, a soma de todos.',
            render: (x) => (x.caixa == null ? h('span', { class: 'muted' }, '—') : fmt.brl(x.caixa)) },
          { key: 'dif', label: 'Diferença', title: 'Caixa − painel. Positivo: o caixa recebeu mais do que o painel mostra. Negativo: o painel tem venda que o caixa não recebeu. Embaixo, a diferença em % do faturamento.',
            sortVal: (x) => (x.dif == null ? null : Math.abs(x.dif)),
            render: (x) => (x.dif == null ? h('span', { class: 'muted' }, '—') : h('div', { class: x.estado === 'naobate' ? 'neg' : '' }, sinal(x.dif), x.pct != null ? h('small', { class: 'muted conf-sub' }, fmt.pct(x.pct, 2)) : null)) },
          { key: 'estado', label: 'Situação', align: 'l', wrap: true, title: `Bate: diferença de até ${fmt.brl(T)}. Bate com explicação: o painel achou exatamente de onde vem a diferença. Não bate: precisa conferir. Embaixo, o motivo provável.`,
            sortVal: (x) => ({ naobate: 0, semfechamento: 1, explicado: 2, bate: 3 })[x.estado],
            render: (x) => h('div', null, h('span', { class: 'badge ' + EST[x.estado][1] }, EST[x.estado][0]), x.estado !== 'bate' ? h('small', { class: 'muted conf-sub' }, x.motivo) : null) },
          ...(podeReenviar ? [{ key: 'reenviar', label: '', title: 'Reenvia o fechamento deste dia por e-mail (e Telegram) para os destinatários cadastrados da loja: o mesmo do envio automático. Só administrador e franqueado.',
            sortVal: () => 0, render: (x) => h('button', { type: 'button', class: 'btn conf-reenv', title: `Reenviar o fechamento de ${dm(x.dia)}`, 'aria-label': `Reenviar o fechamento de ${dm(x.dia)}`, onclick: (e) => { e.stopPropagation(); reenviar(x.dia, e.currentTarget); } }, '✉ Reenviar') }] : []),
          { key: 'gaveta', label: 'Gaveta', title: 'Sobra (+) ou falta (−) de dinheiro no fechamento: dinheiro contado − o que deveria ter. Embaixo, quem fechou o caixa.',
            render: (x) => (x.gaveta == null ? h('span', { class: 'muted' }, '—') : h('div', { class: x.gaveta < -T ? 'neg' : x.gaveta > T ? 'warn-t' : '' }, Math.abs(x.gaveta) <= T ? 'certa' : sinal(x.gaveta), x.operador ? h('small', { class: 'muted conf-sub' }, x.operador) : null)) },
        ],
      }));
    }
    area.append(TS.cardWithTools('Dia a dia · últimos 60 dias', `Diferença = caixa − painel. Tolerância de ${fmt.brl(T)}.`, h('div', { class: 'table-tools' }, seg), tabela));
    pintarTabela();

    // formas de pagamento e sobras/faltas
    const formas = TS.card('Formas de pagamento no período', 'O que o caixa recebeu em cada forma nos dias com fechamento.',
      d.formas.length ? TS.table({ rows: d.formas, sortKey: 'valor', cls: 'conf-t',
        total: { rot: 'Total', valor: d.formas.reduce((s, f) => s + f.valor, 0), pct: 1 },
        cols: [{ key: 'rot', label: 'Forma', align: 'l', title: 'Forma de pagamento como está no fechamento do caixa do AppNext.' },
          { key: 'valor', label: 'Recebido', fmt: fmt.brl, title: 'Valor vendido nessa forma, somando os dias com caixa fechado.' },
          { key: 'pct', label: 'Parte', fmt: (v) => fmt.pct(v), title: 'Parte do total recebido. Ajuda a conferir a taxa da maquininha e o dinheiro que deveria ir para o banco.' }] })
        : h('p', { class: 'muted' }, 'Sem fechamento de caixa lido no período.'));
    let modo = state.confSobras || 'operador';
    const tb2 = h('div');
    const colsSF = (rot, dica) => [
      { key: 'nome', label: rot, align: 'l', title: dica, render: (x) => h('div', null, h('b', null, x.nome), x.recorrente ? h('span', { class: 'badge warn conf-rec' }, 'recorrente') : null) },
      { key: 'dias', label: 'Dias', fmt: fmt.int, title: 'Dias com caixa fechado.' },
      { key: 'faltas', label: 'Faltas', title: 'Dias em que faltou dinheiro na gaveta (além da tolerância) e quanto faltou no total.', render: (x) => (x.faltas ? h('div', { class: 'neg' }, fmt.int(x.faltas), h('small', { class: 'muted conf-sub' }, sinal(x.vFaltas))) : '—') },
      { key: 'sobras', label: 'Sobras', title: 'Dias em que sobrou dinheiro na gaveta (além da tolerância) e quanto sobrou no total.', render: (x) => (x.sobras ? h('div', null, fmt.int(x.sobras), h('small', { class: 'muted conf-sub' }, sinal(x.vSobras))) : '—') },
      { key: 'saldo', label: 'Saldo', title: 'Sobras − faltas. "Recorrente" = 3 dias ou mais com diferença no período.', render: (x) => h('span', { class: x.saldo < 0 ? 'neg' : '' }, sinal(x.saldo)) }];
    const pintarSF = () => tb2.replaceChildren(modo === 'operador'
      ? TS.table({ rows: S.porOperador, sortKey: 'faltas', cls: 'conf-t', empty: 'Sem fechamento de caixa lido no período.', cols: colsSF('Quem fechou o caixa', 'Operador que fechou o caixa no AppNext (com dois caixas no dia, os dois nomes).') })
      : TS.table({ rows: S.porSemana.filter((x) => x.dias), cls: 'conf-t', empty: 'Sem fechamento de caixa lido no período.', cols: colsSF('Dia da semana', 'Dia da semana em que o caixa foi fechado.') }));
    const segSF = TS.seg([['Por operador', 'operador', 'Sobras e faltas somadas por quem fechou o caixa.'], ['Por dia da semana', 'semana', 'Sobras e faltas somadas por dia da semana.']], modo, (k) => { modo = state.confSobras = k; pintarSF(); });
    pintarSF();
    area.append(h('div', { class: 'grid g-2 mt' }, formas, TS.cardWithTools('Sobras e faltas de caixa', 'Diferença da gaveta no fechamento: quem e quando se repete.', h('div', { class: 'table-tools' }, segSF), tb2)));
    area.append(h('p', { class: 'muted conf-nota' }, 'O caixa do AppNext vale pelo dia em que foi fechado. ', TS.dica('Caixa fechado depois da meia-noite cai no dia seguinte: nesse caso os dois dias aparecem como "Bate com explicação" quando, somados, conferem. O painel só lê o caixa: nada é mudado no AppNext.')));
    if (d.podeCfg) area.append(ajustes(loja, d, recarregar));
  }

  // ======================= ajustes (admin e franqueado) =======================
  function ajustes(loja, d, recarregar) {
    const tolIn = h('input', { class: 'f-input conf-tol', type: 'number', min: 0, max: 1000, step: '0.01', value: String(d.cfg.tolerancia), 'aria-label': 'Tolerância da conferência em reais' });
    const sel = h('select', { class: 'f-input', 'aria-label': 'O que fazer com cupom cancelado' },
      h('option', { value: 'avisar', selected: d.cfg.cancelados === 'avisar' || null }, 'Só avisar (continuam nas vendas)'),
      h('option', { value: 'excluir', selected: d.cfg.cancelados === 'excluir' || null }, 'Tirar das vendas e da comissão'));
    const btn = h('button', { type: 'button', class: 'btn primary' }, 'Salvar');
    btn.addEventListener('click', async () => {
      const corpo = { tolerancia: tolIn.value, cancelados: sel.value };
      if (corpo.cancelados === 'excluir' && d.cfg.cancelados !== 'excluir') {
        const i = d.cancelados.impacto;
        if (!window.confirm(`Tirar os cupons cancelados das vendas muda o faturamento, a meta e a comissão de quem vendeu${i.cupons ? ` (hoje: ${fmt.brl(i.valor)} em ${fmt.int(i.cupons)} ${i.cupons === 1 ? 'cupom' : 'cupons'} nos últimos 60 dias)` : ''}. Vale para todo o histórico e fica registrado na auditoria. Confirmar?`)) return;
      }
      if (TS.demo) { toast(TS.DEMO_AVISO || 'Na apresentação nada é salvo.'); return; }
      btn.disabled = true;
      try {
        const r = await fetch(`/api/conferencia/cfg?loja=${encodeURIComponent(loja)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify(corpo) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Não consegui salvar.');
        toast('Salvo.');
        cache.delete(loja);
        if (j.cfg.cancelados !== d.cfg.cancelados && TS.recarregar) TS.recarregar(true); else recarregar();
      } catch (e) { toast(e.message, true); btn.disabled = false; }
    });
    const campo = (rot, el, dica) => h('label', { class: 'conf-campo' }, h('span', { class: 'f-label' }, rot, TS.dica(dica)), el);
    return h('section', { class: 'card mt conf-ajustes' }, h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'card-title' }, 'Ajustes da conferência'), h('div', { class: 'card-sub' }, 'Valem para esta loja. Só admin e franqueado mudam.'))),
      h('div', { class: 'ped-ctl' },
        campo('Tolerância (R$)', tolIn, 'Diferença que ainda conta como "bate": arredondamento de centavos entre o caixa e a planilha. Padrão: R$ 1,00. Vale também para a sobra e a falta da gaveta.'),
        campo('Cupom cancelado', sel, 'Padrão: só avisar. "Tirar das vendas" remove do painel as linhas dos cupons (NFC-e) cancelados: muda faturamento, meta e comissão de todo o histórico. Use depois de conferir a lista em Cancelados.'),
        btn));
  }

  // ======================= cancelados =======================
  function abaCancelados(area, loja, d) {
    const c = d.cancelados, I = c.impacto, exc = d.cfg.cancelados === 'excluir';
    if (I.cupons) {
      area.append(h('div', { class: 'notice warn' }, TS.etqPrazo('semana'), ' ', `${fmt.brl(I.valor)} em ${fmt.int(I.cupons)} ${I.cupons === 1 ? 'cupom cancelado ainda conta' : 'cupons cancelados ainda contam'} nas vendas do painel` + (I.valorMeta ? ` (${fmt.brl(I.valorMeta)} na base da meta e da comissão).` : '.') + (d.podeCfg ? ' Confira a lista; para tirar das vendas, mude em Caixa × painel → Ajustes da conferência.' : ' Avise o franqueado.')));
    } else if (!c.temXml) {
      area.append(h('div', { class: 'notice' }, 'O painel ainda não tem os XMLs das notas desta loja, então não sabe quais cupons foram cancelados. Eles vêm pelo robô (Configurações → loja → Coletor → Histórico → "Só XML").'));
    }
    if (exc && c.excluidos.cupons) area.append(h('div', { class: 'notice ok' }, `Esta loja tira os cupons cancelados das vendas: ${fmt.brl(c.excluidos.valor)} em ${fmt.int(c.excluidos.cupons)} ${c.excluidos.cupons === 1 ? 'cupom' : 'cupons'} já estão fora do faturamento e da comissão dos últimos 60 dias.`));
    area.append(h('div', { class: 'grid g-kpi vp2-conf-kpi' },
      TS.kpi('Notas canceladas', fmt.brl(c.total.valor), `${fmt.int(c.total.cupons)} ${c.total.cupons === 1 ? 'nota' : 'notas'} em 60 dias`,
        'Cupons (NFC-e) e notas de venda (NF-e) cancelados no AppNext nos últimos 60 dias, pelo XML que o robô guarda. Valor = total da nota cancelada. Devolução, transferência e nota de entrada não entram.'),
      TS.kpi('Ainda contam nas vendas', fmt.brl(I.valor), I.cupons ? h('span', { class: 'down' }, `${fmt.int(I.cupons)} ${I.cupons === 1 ? 'cupom' : 'cupons'} · ${fmt.brl(I.valorMeta)} na comissão`) : 'nenhum 👏',
        'Cupom cancelado que continua na planilha de vendas: mesmo número, até 1 dia de distância da nota cancelada. Enquanto estiver lá, soma no faturamento, na meta e na comissão de quem vendeu. O valor é o faturamento dessas linhas no painel.', I.cupons ? 'ruim' : c.total.cupons ? 'bom' : null),
      TS.kpi('Cancelado no caixa', fmt.brl(c.pdv.total), c.pdv.porOperador.length ? `${fmt.int(c.pdv.porDia.length)} ${c.pdv.porDia.length === 1 ? 'dia' : 'dias'} · mais: ${c.pdv.porOperador[0].operador}` : 'nada registrado',
        'Total de cancelamentos que o próprio caixa registrou nos fechamentos (item ou venda cancelada no PDV, muitas vezes antes de virar cupom). É outra fonte: não soma com as notas canceladas. O fechamento informa só o valor por caixa, não qual venda.'),
      TS.kpi('Linhas negativas', fmt.brl(c.negativas.valor), c.negativas.linhas ? `${fmt.int(c.negativas.linhas)} ${c.negativas.linhas === 1 ? 'linha' : 'linhas'} na planilha` : 'nenhuma na planilha',
        'Linhas com valor ou quantidade negativa na planilha de vendas (estorno ou devolução lançada como venda negativa). Elas já diminuem o faturamento sozinhas. Se o número for zero, o AppNext não lança devolução assim nesta loja.')));

    let modo = state.confCanc || 'cupom';
    const tb = h('div');
    const marca = (x) => (x.nasVendas ? h('span', { class: 'badge erro' }, 'Ainda nas vendas') : h('span', { class: 'badge ok' }, 'Fora das vendas'));
    const pintarT = () => {
      if (modo === 'cupom') {
        tb.replaceChildren(TS.table({ rows: c.lista, cls: 'conf-t', sortKey: 'dia', sortDir: 'desc', maxHeight: '620px', search: 'Buscar número do cupom ou vendedor…', searchKeys: ['numero', 'vend'],
          rowClass: (x) => (x.nasVendas ? 'conf-conta' : null), empty: c.temXml ? 'Nenhuma nota cancelada nos últimos 60 dias. 👏' : 'Sem XML das notas ainda.',
          cols: [
            { key: 'dia', label: 'Cupom', align: 'l', sticky: true, title: 'Dia da emissão e número da nota cancelada. NFC-e = cupom do caixa; NF-e = nota grande.',
              render: (x) => h('div', null, h('b', null, `${dm(x.dia)} · nº ${x.numero}`), h('small', { class: 'muted conf-sub' }, x.mod === '55' ? 'NF-e' : 'NFC-e')) },
            { key: 'valor', label: 'Valor da nota', fmt: fmt.brl, title: 'Total da nota cancelada (vNF do XML).' },
            { key: 'nasVendas', label: 'Situação', align: 'l', title: '"Ainda nas vendas": a planilha de vendas tem linhas com este número de cupom no mesmo dia (ou no dia vizinho). "Fora das vendas": o AppNext já não traz este cupom na planilha.', sortVal: (x) => (x.nasVendas ? 0 : 1), render: marca },
            { key: 'valorVendas', label: 'Conta no painel', title: 'Faturamento que este cupom ainda soma no painel. Embaixo, a parte que entra na meta e na comissão.',
              render: (x) => (x.nasVendas ? h('div', { class: 'neg' }, fmt.brl(x.valorVendas), h('small', { class: 'muted conf-sub' }, `comissão: ${fmt.brl(x.valorMeta)}`)) : h('span', { class: 'muted' }, '—')) },
            { key: 'vend', label: 'Vendedor', align: 'l', wrap: true, title: 'Quem está na planilha de vendas como vendedor deste cupom. O XML da nota não traz o vendedor: cupom fora da planilha fica sem nome.' },
          ] }));
      } else if (modo === 'dia') {
        const pdv = new Map(c.pdv.porDia.map((x) => [x.dia, x.valor])), neg = new Map(c.negativas.porDia.map((x) => [x.dia, x.valor]));
        const dias = new Map(c.porDia.map((x) => [x.dia, { ...x, pdv: 0, neg: 0 }]));
        for (const [k, v] of pdv) { if (!dias.has(k)) dias.set(k, { dia: k, cupons: 0, valor: 0, aindaConta: 0, pdv: 0, neg: 0 }); dias.get(k).pdv = v; }
        for (const [k, v] of neg) { if (!dias.has(k)) dias.set(k, { dia: k, cupons: 0, valor: 0, aindaConta: 0, pdv: 0, neg: 0 }); dias.get(k).neg = v; }
        tb.replaceChildren(TS.table({ linhaMob: { nome: 'dia', val: 'valor', l2: ['aindaConta', 'pdv', 'neg'] }, rows: [...dias.values()], cls: 'conf-t', sortKey: 'dia', sortDir: 'desc', maxHeight: '620px', empty: 'Nada cancelado nos últimos 60 dias. 👏',
          cols: [
            { key: 'dia', label: 'Dia', align: 'l', sticky: true, title: 'Dia da nota cancelada ou do fechamento do caixa.', render: (x) => h('div', null, h('b', null, dm(x.dia)), h('small', { class: 'muted conf-sub' }, semana(x.dia))) },
            { key: 'valor', label: 'Notas canceladas', title: 'Total das notas canceladas do dia (XML) e quantas foram.', render: (x) => (x.cupons ? h('div', null, fmt.brl(x.valor), h('small', { class: 'muted conf-sub' }, `${fmt.int(x.cupons)} ${x.cupons === 1 ? 'nota' : 'notas'}`)) : h('span', { class: 'muted' }, '—')) },
            { key: 'aindaConta', label: 'Ainda conta', title: 'Parte que continua somando nas vendas do painel nesse dia.', render: (x) => (x.aindaConta ? h('span', { class: 'neg' }, fmt.brl(x.aindaConta)) : h('span', { class: 'muted' }, '—')) },
            { key: 'pdv', label: 'Cancelado no caixa', title: 'O que o fechamento do caixa do dia registrou como cancelamento.', render: (x) => (x.pdv ? fmt.brl(x.pdv) : h('span', { class: 'muted' }, '—')) },
            { key: 'neg', label: 'Linhas negativas', title: 'Estornos lançados como venda negativa na planilha de vendas.', render: (x) => (x.neg ? fmt.brl(x.neg) : h('span', { class: 'muted' }, '—')) },
          ] }));
      } else {
        tb.replaceChildren(TS.table({ linhaMob: { nome: 'vendedor', val: 'valor', l2: ['cupons', 'aindaConta', 'valorMeta'] }, rows: c.porVendedor, cls: 'conf-t', sortKey: 'aindaConta', empty: 'Nada cancelado nos últimos 60 dias. 👏',
          cols: [
            { key: 'vendedor', label: 'Vendedor', align: 'l', sticky: true, title: 'Vendedor da planilha de vendas nos cupons cancelados. "(fora da planilha de vendas)" = cupons que o AppNext já não traz: o XML não diz quem vendeu.', render: (x) => h('b', null, x.vendedor) },
            { key: 'cupons', label: 'Cupons', fmt: fmt.int, title: 'Cupons cancelados em que a pessoa aparece.' },
            { key: 'valor', label: 'Valor cancelado', fmt: fmt.brl, title: 'Total das notas canceladas (cupom com dois vendedores: dividido igualmente).' },
            { key: 'aindaConta', label: 'Ainda conta', title: 'Faturamento desses cupons que continua nas vendas da pessoa.', render: (x) => (x.aindaConta ? h('span', { class: 'neg' }, fmt.brl(x.aindaConta)) : h('span', { class: 'muted' }, '—')) },
            { key: 'valorMeta', label: 'Na comissão', title: 'Parte que entra na meta e na comissão (chá aromatizado, chá puro e acessórios; sem Espaço Gourmet).', render: (x) => (x.valorMeta ? h('span', { class: 'neg' }, fmt.brl(x.valorMeta)) : h('span', { class: 'muted' }, '—')) },
          ] }));
      }
    };
    c.lista.forEach((x) => { x.vend = x.vendedores.join(', ') || (x.nasVendas ? '(sem vendedor)' : '—'); });
    const seg = TS.seg([[`Por cupom (${fmt.int(c.lista.length)})`, 'cupom', 'Cada nota cancelada e se ela ainda aparece nas vendas.'], ['Por dia', 'dia', 'Quanto foi cancelado em cada dia, pelas três fontes.'], ['Por vendedor', 'vendedor', 'Cancelados somados por vendedor.']], modo, (k) => { modo = state.confCanc = k; pintarT(); });
    pintarT();
    area.append(TS.cardWithTools('Cancelados · últimos 60 dias', 'O painel não tira nada sozinho das vendas: só mostra.', h('div', { class: 'table-tools' }, seg), tb));
    area.append(h('p', { class: 'muted conf-nota' }, 'Devolução de cliente com troca aparece no caixa como forma de pagamento "Troca". ', TS.dica('O AppNext não entrega ao painel uma lista de devoluções de venda: o que dá para ver é a nota cancelada (XML), o total cancelado em cada fechamento de caixa, as linhas negativas da planilha e o valor recebido em "Troca" (em Caixa × painel → Formas de pagamento).')));
  }

  // ======================= saúde dos dados =======================
  const SIN = { verde: ['Em dia', 'ok'], amarelo: ['Atrasada', 'warn'], vermelho: ['Parada', 'erro'], cinza: ['Sem dados', 'cinza'] };
  function abaSaude(area, loja, d) {
    const fts = d.fontes || [];
    const ruins = fts.filter((f) => f.sinal === 'vermelho');
    if (ruins.length) area.append(h('div', { class: 'notice warn' }, TS.etqPrazo('agora'), ' ', `${ruins.length === 1 ? 'Fonte parada' : 'Fontes paradas'} há mais de 3 dias: ${ruins.map((f) => f.nome).join(', ')}. Os números que dependem ${ruins.length === 1 ? 'dela' : 'delas'} estão velhos.`));
    const quadros = h('div', { class: 'grid g-kpi vp2-conf-kpi' }, h('div', { class: 'loading' }, h('div', { class: 'spinner' }), 'Casando as vendas com o estoque…'));
    const lista = h('div');
    area.append(quadros,
      TS.card('Fontes dos dados', 'Quando cada dado chegou ao painel pela última vez.', TS.table({ linhaMob: { nome: 'nome', val: 'sinal', l2: ['horas'], l3: ['fazer'] }, rows: fts, cls: 'conf-t',
        cols: [
          { key: 'nome', label: 'Fonte', align: 'l', sticky: true, wrap: true, title: 'De onde o painel tira cada dado.', render: (f) => h('div', null, h('b', null, f.nome), h('small', { class: 'muted conf-sub' }, f.oque)) },
          { key: 'horas', label: 'Última atualização', align: 'l', title: 'Há quanto tempo o dado chegou ao painel. Embaixo, até onde ele vai.', sortVal: (f) => (f.horas == null ? 1e9 : f.horas),
            render: (f) => h('div', null, f.idade, f.detalhe ? h('small', { class: 'muted conf-sub' }, f.detalhe) : null) },
          { key: 'sinal', label: 'Situação', align: 'l', title: 'Em dia: atualizada nas últimas 36 horas. Atrasada: entre 36 horas e 3 dias. Parada: mais de 3 dias. Sem dados: o painel nunca recebeu.', sortVal: (f) => ({ vermelho: 0, cinza: 1, amarelo: 2, verde: 3 })[f.sinal],
            render: (f) => h('span', { class: 'badge ' + SIN[f.sinal][1] }, SIN[f.sinal][0]) },
          { key: 'fazer', label: 'O que fazer', align: 'l', wrap: true, title: 'Como atualizar quando a fonte está atrasada, parada ou sem dados.', render: (f) => (f.sinal === 'verde' ? h('span', { class: 'muted' }, 'Nada: está em dia.') : f.fazer) },
        ] })),
      lista);
    casar(d).then((r) => {
      if (!quadros.isConnected) return;
      if (!r) {
        quadros.replaceChildren(h('div', { class: 'notice' }, TS.eu && TS.eu.pode && TS.eu.pode.custos ? 'Ainda não há estoque desta loja no painel: sem ele não dá para casar as vendas com os produtos nem achar o custo.' : 'O casamento das vendas com o estoque e o custo aparecem para quem tem uma tela de custo liberada (Estoque, Preços, Rentabilidade…).'));
        return;
      }
      const s = r.s;
      quadros.replaceChildren(
        TS.kpi('Casado pelo código', fmt.pct(s.pctCodigo, 0), `${fmt.brl0(s.codigo)} de ${fmt.brl0(s.fat)}`,
          'Parte do faturamento dos últimos 60 dias em que a venda traz o código do produto e ele existe no estoque. É o casamento seguro: custo, margem e reposição certos.', s.pctCodigo >= 0.9 ? 'bom' : null),
        TS.kpi('Casado pelo nome', fmt.pct(s.pctNome, 0), fmt.brl0(s.nome),
          'Venda sem código (ou com código que não existe no estoque) que o painel casou pelo nome do produto. Funciona, mas quebra se o nome mudar no AppNext. O ideal é as vendas virem com o código.' + (r.temCod ? '' : '\n\nAs vendas desta loja estão chegando SEM a coluna do código do produto.'), s.pctNome > 0.2 ? 'ruim' : null),
        TS.kpi('Sem produto no estoque', fmt.pct(s.pctSemProduto, 0), `${fmt.brl0(s.semProduto)} · ${fmt.int(s.naoCasados.length)} ${s.naoCasados.length === 1 ? 'produto' : 'produtos'}`,
          'Vendas que o painel não conseguiu ligar a nenhum produto do estoque, nem pelo código nem pelo nome. Ficam fora da margem, da reposição e do pedido. A lista está logo abaixo.', s.pctSemProduto > 0.02 ? 'ruim' : 'bom'),
        TS.kpi('Vendas sem custo', fmt.pct(s.pctSemCusto, 0), fmt.brl0(s.semCusto),
          'Faturamento cujo custo o painel não achou: o que não casou com o estoque + o que casou com produto que está com custo zero no AppNext. É o contrário do quadro "Vendas com custo" da Rentabilidade.', s.pctSemCusto > 0.05 ? 'ruim' : 'bom'));
      const linhas = [...s.naoCasados.map((x) => ({ ...x, tipo: 'Não existe no estoque', fazer: x.cod ? 'Confira no AppNext se o código está certo e ativo no estoque.' : 'Cadastre o produto no estoque do AppNext com o mesmo nome da venda.' })),
        ...s.semCustoLista.map((x) => ({ ...x, tipo: 'No estoque, sem custo', fazer: 'Lance o custo do produto no AppNext (ou a nota de compra).' }))];
      lista.replaceChildren(TS.card(`Produtos vendidos sem ligação ou sem custo (${fmt.int(linhas.length)})`, 'O que foi vendido nos últimos 60 dias e o painel não consegue custear.',
        TS.table({ rows: linhas, cls: 'conf-t', sortKey: 'vt', maxHeight: '560px', search: 'Buscar produto ou código…', searchKeys: ['nome', 'cod'], produto: 'nome',
          empty: 'Tudo o que foi vendido está ligado a um produto do estoque com custo. 👏',
          cols: [
            { key: 'nome', label: 'Produto', align: 'l', sticky: true, wrap: true, title: 'Nome do produto como veio na venda. Embaixo, o código (quando a venda traz).', render: (x) => h('div', null, h('b', null, x.nome), h('small', { class: 'muted conf-sub' }, x.cod ? 'código ' + x.cod : 'venda sem código')) },
            { key: 'tipo', label: 'Problema', align: 'l', title: '"Não existe no estoque": nem o código nem o nome batem com a planilha de estoque. "No estoque, sem custo": o produto existe, mas o custo está zerado.', render: (x) => h('span', { class: 'badge ' + (x.tipo === 'Não existe no estoque' ? 'erro' : 'warn') }, x.tipo) },
            { key: 'vt', label: 'Vendeu', fmt: fmt.brl, title: 'Faturamento do produto nos últimos 60 dias.' },
            { key: 'linhas', label: 'Vendas', fmt: fmt.int, title: 'Quantas linhas de venda.' },
            { key: 'fazer', label: 'O que fazer', align: 'l', wrap: true, title: 'O que resolver no AppNext para o painel achar o produto e o custo.' },
          ] })));
    }).catch((e) => { if (quadros.isConnected) quadros.replaceChildren(h('div', { class: 'notice err' }, e.message)); });
  }

  /** casa as vendas dos últimos 60 dias com o estoque pelo motor do Estoque (M.casar / M.custo): nada de conta copiada */
  async function casar(d) {
    const M = TS.custosLoja ? await TS.custosLoja() : null;
    if (!M) return null;
    const db = TS.db, de = TS.isoToDay(d.de), linhas = [];
    for (let i = 0; i < db.n; i++) {
      if (db.day[i] < de || !TS.contaFat(i)) continue;
      const c = M.casar(i);
      linhas.push({ vt: db.vt[i] || 0, via: c ? c.via : null, temCusto: M.custo(i) != null, nome: db.D.descricao[db.desc[i]], cod: db.D.cod ? String(db.D.cod[db.cod[i]] ?? '') : '' });
    }
    return { s: TS.conferencia.casamento(linhas), temCod: !!(db.D.cod && db.D.cod.some((x) => x)) };
  }

  // ======================= avisos do Início =======================
  TS.conferenciaAvisos = async function (lista) {
    if (!state.loja || state.loja === 'todas' || !TS.paginas().includes('conferencia')) return;
    let d;
    try { d = await TS.conferenciaBuscar(state.loja); } catch { return; }
    const ir = (aba, fil) => ({ link: '#conferencia', ir: 'conferir ›', antes: () => { state.confAba = aba; if (fil) state.confFil = fil; } });
    if (d.recentes.length) {
      const m = d.recentes.reduce((a, x) => (Math.abs(x.dif) > Math.abs(a.dif) ? x : a));
      lista.push({ nivel: 'warn', id: 'conf-naobate', titulo: `Caixa × painel: ${fmt.int(d.recentes.length)} ${d.recentes.length === 1 ? 'dia recente não bate' : 'dias recentes não batem'} · maior diferença ${sinal(m.dif)} em ${dm(m.dia)}`, texto: 'O faturamento do painel está diferente do fechamento do caixa, sem explicação conhecida.', ...ir('caixa', 'naobate') });
    }
    const I = d.cancelados.impacto;
    if (I.cupons) lista.push({ nivel: 'warn', id: 'conf-cancelados', titulo: `${fmt.brl(I.valor)} em ${fmt.int(I.cupons)} ${I.cupons === 1 ? 'cupom cancelado ainda conta' : 'cupons cancelados ainda contam'} nas vendas`, texto: 'Eles somam no faturamento, na meta e na comissão. Confira a lista antes de decidir tirar.', ...ir('cancelados') });
    const paradas = (d.fontes || []).filter((f) => f.sinal === 'vermelho');
    if (paradas.length && TS.eu && TS.eu.pode && TS.eu.pode.configurar) lista.push({ nivel: 'info', id: 'conf-fontes', titulo: `Dados parados há mais de 3 dias: ${paradas.map((f) => f.nome).join(', ')}`, texto: 'Os números que dependem dessas fontes estão velhos. Veja o que fazer em cada uma.', ...ir('saude') });
  };
})();
