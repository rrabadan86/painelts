/* Estoque → Validade: lotes do chá a granel (só o chá em kg tem validade).
   Cada entrada de chá é um lote, com validade de 12 meses da entrada. A equipe digita o nº do lote (vem "0")
   e corrige a validade se o pacote disser outra coisa. O saldo de cada lote vem do estoque atual do AppNext,
   distribuído da entrada mais nova para a mais antiga (o mais antigo foi vendido primeiro).
   Também alimenta: Vendas → Promoção ("vender primeiro"), Estoque → Pedido (aviso) e Clientes → Campanhas. */
(function () {
  const { h, fmt, state } = TS;
  const COR = { vencido: 'vl-vencido', critica: 'vl-critica', acao: 'vl-acao', atencao: 'vl-atencao', ok: 'vl-ok', sem: 'vl-sem' };
  const ICONE = { vencido: '⚫', critica: '🔴', acao: '🟠', atencao: '🟡', ok: '🟢', sem: '⚪' };
  const NOME = { vencido: '⚫ Vencido', critica: '🔴 Menos de 30 dias', acao: '🟠 30 a 60 dias', atencao: '🟡 60 a 90 dias', ok: '🟢 Mais de 90 dias', sem: '⚪ Sem data' };
  const CURTO = { vencido: 'Vencido', critica: '< 30 dias', acao: '30–60 dias', atencao: '60–90 dias', ok: '> 90 dias', sem: 'Sem data' };
  const kgTxt = (v) => (v == null ? '—' : v < 1 ? `${fmt.int(Math.round(v * 1000))} g` : `${fmt.kg(v)} kg`);
  const diasTxt = (d) => (d == null ? 'sem data' : d < 0 ? `venceu há ${-d} d` : d === 0 ? 'vence hoje' : `${d} d`);
  const toast = (msg, erro) => { const t = h('div', { class: 'toast' + (erro ? ' err' : '') }, msg); document.body.append(t); setTimeout(() => t.remove(), erro ? 6000 : 3000); };

  async function req(metodo, url, corpo) {
    const r = await fetch(TS.api(url), { method: metodo, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.erro || 'Não deu certo.'); e.status = r.status; throw e; }
    return j;
  }
  // os dados ficam guardados 1 minuto (Promoção, Pedido e a tela usam os mesmos)
  const cache = new Map();
  function dados(loja, forcar) {
    const c = cache.get(loja);
    if (!forcar && c && Date.now() - c.em < 60000) return c.p;
    const p = req('GET', `validade?loja=${encodeURIComponent(loja)}`);
    cache.set(loja, { em: Date.now(), p });
    p.catch(() => cache.delete(loja));
    return p;
  }
  const badge = (f) => h('span', { class: 'vl-badge ' + COR[f] }, ICONE[f] + ' ' + CURTO[f]);
  const podeCampanha = () => (TS.paginas ? TS.paginas().includes('campanhas') : false);

  /** abre Clientes → Campanhas com a campanha pronta para quem já comprou o chá */
  function campanhaDoCha(l) {
    const nome = l.desc.replace(/\s+/g, ' ').trim();
    const titulo = nome.charAt(0) + nome.slice(1).toLowerCase();
    TS.campanhaPronta = {
      pronta: true, nome: `Validade: ${titulo}`.slice(0, 60), recorrente: '', janela: 15,
      mensagem: `Oi, {nome}! Você que gosta de ${titulo}: estamos com ele fresquinho em condição especial esta semana na {loja} 🍵 Quer que a gente separe um pacote para você?`,
      filtros: { produtos: ['~' + nome] },
    };
    location.hash = '#campanhas';
  }
  /** entradas recentes do chá (+ "saldo sem nota" quando houver), com o saldo que o painel calcula hoje */
  function lotesDoCha(d, cod) {
    const atuais = new Map(d.lotes.filter((l) => l.cod === cod).map((l) => [l.chave, l]));
    const out = ((d.entradas || {})[cod] || []).map((e) => ({ ...e, saldo: atuais.has(e.chave) ? atuais.get(e.chave).saldo : 0 }));
    for (const l of atuais.values()) if (!out.some((e) => e.chave === l.chave)) out.push({ chave: l.chave, nf: l.nf, entrada: l.entrada, lote: l.lote, validade: l.validade, saldo: l.saldo });
    return out;
  }
  const rotLote = (e) => (e.entrada ? `Entrada ${fmt.date(e.entrada)} · NF ${e.nf}` : 'Saldo sem nota') + ` · lote ${e.lote && e.lote !== '0' ? e.lote : '0'}` + (e.validade ? ` · vence ${fmt.date(e.validade)}` : '');
  /** campos em gramas, um por lote; onChange(mapa chave → kg, soma em kg) */
  function camposLotes(lotes, valores, onChange, desabilitado) {
    const vals = new Map(lotes.map((e) => [e.chave, valores[e.chave] ?? 0]));
    const avisar = () => onChange(Object.fromEntries([...vals].filter(([, v]) => v > 0)), Math.round([...vals.values()].reduce((a, b) => a + b, 0) * 1000) / 1000);
    return h('div', { class: 'vl-lotes-campos' }, ...lotes.map((e) => {
      const i = h('input', { class: 'f-input vl-g', type: 'text', inputmode: 'numeric', value: vals.get(e.chave) ? String(Math.round(vals.get(e.chave) * 1000)) : '', placeholder: '0', disabled: desabilitado || null, 'aria-label': `Gramas: ${rotLote(e)}` });
      i.addEventListener('input', () => { const g = Number(i.value.replace(/\D/g, '')) || 0; vals.set(e.chave, g / 1000); avisar(); });
      return h('label', { class: 'vl-lote-linha' }, h('span', null, rotLote(e)), h('span', { class: 'vl-g-box' }, i, h('small', null, 'g')));
    }));
  }

  /** "Ajustar os lotes deste chá": quanto tem de cada lote (a soma tem de ser o estoque do AppNext) */
  function ajustarCha(l, d, loja, depois) {
    const lotes = lotesDoCha(d, l.cod);
    const S = Math.round(d.lotes.filter((x) => x.cod === l.cod).reduce((a, x) => a + x.saldo, 0) * 1000) / 1000;
    let mapa = Object.fromEntries(lotes.filter((e) => e.saldo > 0).map((e) => [e.chave, e.saldo])), soma = S;
    const ok = h('button', { type: 'button', class: 'btn primary' }, 'Salvar');
    const info = h('div', { class: 'vl-soma' });
    const erro = h('div', { class: 'muted vl-erro' });
    const pintarSoma = () => {
      const igual = Math.abs(soma - S) < 0.0015;
      info.replaceChildren(h('b', null, `Soma: ${kgTxt(soma)}`), ` · estoque no AppNext: ${kgTxt(S)}`, igual ? h('span', { class: 'vl-okk' }, ' ✓') : h('span', { class: 'vl-dif' }, ` · ${soma > S ? 'sobram' : 'faltam'} ${kgTxt(Math.abs(soma - S))}`));
      ok.disabled = !igual;
    };
    const fundo = h('div', { class: 'cp-modal-bg' });
    const fechar = () => fundo.remove();
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    const enviar = async (corpoReq) => {
      ok.disabled = true; erro.textContent = '';
      if (TS.demo) { fechar(); toast('Na apresentação nada é salvo.'); return; }
      try { await req('PUT', 'validade/saldo', { loja, ...corpoReq }); cache.delete(loja); fechar(); toast('Lotes ajustados.'); depois(); } catch (e) { erro.textContent = e.message; ok.disabled = false; }
    };
    ok.addEventListener('click', () => enviar({ cod: l.cod, lotes: mapa }));
    const manual = d.lotes.some((x) => x.cod === l.cod && x.ajuste && x.ajuste.tipo === 'manual');
    fundo.append(h('div', { class: 'card cp-copiar vl-modal' },
      h('h3', null, `Lotes de ${l.desc}`),
      h('p', { class: 'muted' }, 'Pese quanto tem de cada lote (em gramas). Use quando a loja abriu um pacote novo antes do antigo.'),
      h('p', { class: 'vl-aviso' }, h('b', null, 'Não é inventário: '), 'não muda nada no AppNext, só diz ao painel de que lote é cada parte do estoque. A soma tem de dar o estoque que já está no AppNext. Se não der, o total está errado: corrija pelo Inventário (dá para contar por lote lá).'),
      camposLotes(lotes, mapa, (m, sm) => { mapa = m; soma = sm; pintarSoma(); }), info, erro,
      h('div', { class: 'cp-acoes' },
        manual ? h('button', { type: 'button', class: 'link-btn', title: 'Esquece o ajuste e volta a calcular: o estoque fica nas entradas mais novas', onclick: () => enviar({ chave: l.chave, automatico: true }) }, 'voltar ao automático') : null,
        h('span', { style: { flex: 1 } }), h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Cancelar'), ok)));
    pintarSoma();
    document.body.append(fundo);
    const primeiro = fundo.querySelector('input'); if (primeiro) primeiro.focus();
  }

  /** chás a granel de uma nota de entrada com o nº do lote e a validade (vale antes do estoque ser atualizado) */
  function linhasNota(loja, nt, aoSalvar) {
    return h('div', { class: 'vl-nota-itens' }, ...nt.itens.map((it) => {
      const lote = h('input', { class: 'f-input vl-lote' + (it.lote === '0' ? ' vl-vazio' : ''), value: it.lote === '0' ? '' : it.lote, placeholder: 'nº do lote', maxlength: 30, autocomplete: 'off', autocapitalize: 'characters', 'aria-label': `Lote de ${it.desc}` });
      const val = h('input', { class: 'f-input vl-val', type: 'date', value: it.validade || '', min: it.entrada, 'aria-label': `Validade de ${it.desc}` });
      const enviar = (corpoReq, el) => {
        if (TS.demo) { el.classList.add('vl-salvo'); setTimeout(() => el.classList.remove('vl-salvo'), 1200); return; }
        el.classList.add('vl-salvando');
        req('PUT', 'validade/lote', { loja, chave: it.chave, ...corpoReq }).then((j) => {
          cache.delete(loja);
          const e = j.editado || {};
          it.lote = e.lote || '0'; it.validade = e.validade || it.validadePadrao;
          el.classList.remove('vl-salvando'); el.classList.add('vl-salvo'); setTimeout(() => el.classList.remove('vl-salvo'), 1200);
          if ('validade' in corpoReq) val.value = it.validade;
          if (aoSalvar) aoSalvar(it);
        }).catch((e) => { el.classList.remove('vl-salvando'); toast(e.message, true); });
      };
      lote.addEventListener('change', () => { lote.value = lote.value.trim().toUpperCase(); lote.classList.toggle('vl-vazio', !lote.value); enviar({ lote: lote.value }, lote); });
      lote.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lote.blur(); } });
      val.addEventListener('change', () => enviar({ validade: val.value }, val));
      return h('div', { class: 'vl-nota-item' },
        h('div', { class: 'vl-nota-cha' }, h('b', null, it.desc), h('small', { class: 'muted vl-sub' }, `cód. ${it.cod} · ${kgTxt(it.qtd)}`)),
        h('label', { class: 'vl-campo' }, h('small', null, 'Lote'), lote),
        h('label', { class: 'vl-campo' }, h('small', null, 'Validade'), val));
    }));
  }
  /** Estoque → Notas fiscais → nota de entrada: bloco "Lotes do chá a granel" (some se a nota não tem chá a granel) */
  function blocoNota(loja, n, aoSalvar) {
    const box = h('div');
    if (!loja || loja === 'todas') return box;
    req('GET', `validade/notas?loja=${encodeURIComponent(loja)}&nota=${encodeURIComponent(n.id)}`).then((j) => {
      const nt = (j.notas || [])[0];
      if (!nt || !nt.itens.length || !box.isConnected) return;
      const falta = h('span', { class: 'vl-falta' });
      const contar = () => { const f = nt.itens.filter((x) => x.lote === '0').length; falta.textContent = f ? ` · ${f} sem lote` : ' · tudo preenchido ✓'; falta.className = f ? 'vl-falta' : 'vl-falta ok'; };
      contar();
      box.replaceChildren(h('div', { class: 'vl-nota' },
        h('div', { class: 'vl-nota-tit' }, h('b', null, '🍃 Lotes do chá a granel'), falta),
        h('small', { class: 'muted' }, 'Digite o nº do lote que está no pacote. A validade já vem com 12 meses da entrada; corrija se o pacote disser outra data.'),
        linhasNota(loja, nt, () => { contar(); if (aoSalvar) aoSalvar(); })));
    }).catch(() => null); // sem permissão: o bloco não aparece
    return box;
  }
  /** notas de entrada com lote pendente: { id da nota: quantos chás faltam } */
  const pendentes = (loja) => (req('GET', `validade/notas?loja=${encodeURIComponent(loja)}`).then((j) => j.pendentes || {}).catch(() => ({})));

  TS.validade = { dados, badge, campanhaDoCha, lotesDoCha, camposLotes, rotLote, blocoNota, pendentes };

  TS.pages.validade = function (root) {
    if (TS.subEstoque) root.append(TS.subEstoque('validade'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Validade e lotes'),
      h('div', { class: 'page-sub' }, 'Chá a granel: cada entrada é um lote, com validade de 12 meses. Digite o nº do lote que está no pacote quando a mercadoria chegar.'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'A validade é de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'card' }, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Carregando os lotes…')))));
    root.append(corpo);
    const loja = state.loja;
    dados(loja, true).then((d) => { if (corpo.isConnected) pintar(corpo, loja, d); })
      .catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, TS.demo ? 'A validade dos lotes não está na apresentação.' : e.message)));
  };

  const F = { faixa: 'risco', familia: '', q: '', semLote: false }; // filtros sobrevivem enquanto a tela está aberta
  function pintar(corpo, loja, d) {
    const r = d.resumo, pf = r.porFaixa;
    const tile = (id) => {
      const x = pf[id];
      const el = TS.kpi(NOME[id], `${fmt.int(x.lotes)} lote${x.lotes === 1 ? '' : 's'}`, kgTxt(x.kg) + (x.venda ? ` · ${fmt.brl0(x.venda)}` : ''),
        id === 'vencido' ? 'Lotes com a validade já passada: retirar da venda e lançar a perda no AppNext.' : id === 'sem' ? 'Estoque que não bate com nenhuma nota de entrada conhecida: informe a validade do pacote.' : `Lotes que vencem em: ${CURTO[id]}.`);
      el.classList.add('vl-kpi', COR[id]);
      el.tabIndex = 0; el.setAttribute('role', 'button');
      const ir = () => { F.faixa = id; pintar(corpo, loja, d); };
      el.addEventListener('click', ir); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') ir(); });
      return el;
    };
    const ids = ['vencido', 'critica', 'acao', 'atencao', 'ok', ...(pf.sem.lotes ? ['sem'] : [])];
    const risco = TS.kpi(`Valor em risco (< ${d.riscoDias} dias)`, fmt.brl0(r.risco.venda), [
      `${kgTxt(r.risco.kg)} · ${fmt.int(r.risco.lotes)} lote${r.risco.lotes === 1 ? '' : 's'}`,
      d.custos && r.risco.custo != null ? ` · a custo ${fmt.brl0(r.risco.custo)}` : '',
    ].join(''), 'A preço de venda (pacote de 100 g): o que deixa de entrar se o chá vencer. Inclui os vencidos.' + (d.custos ? ' A custo: o que a loja perde.' : ''));
    risco.classList.add('vl-kpi-risco');

    // filtros
    const fams = [...new Set(d.lotes.map((l) => l.familia).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const selFam = h('select', { class: 'f-input', 'aria-label': 'Tipo de chá' }, h('option', { value: '' }, 'Todos os tipos de chá'), ...fams.map((f) => h('option', { value: f, selected: F.familia === f || null }, f)));
    selFam.addEventListener('change', () => { F.familia = selFam.value; desenharTabela(); });
    const semLote = h('label', { class: 'vl-check' }, h('input', { type: 'checkbox', checked: F.semLote || null, onchange: (e) => { F.semLote = e.target.checked; desenharTabela(); } }), ` sem nº de lote (${fmt.int(r.semLote)})`);
    const segs = () => TS.seg([['Em risco', 'risco'], ...ids.map((id) => [CURTO[id], id]), ['Todos', 'todos']], F.faixa, (v) => { F.faixa = v; pintar(corpo, loja, d); });

    const tabela = h('div');
    function linhas() {
      return d.lotes.filter((l) => (F.faixa === 'todos' ? true : F.faixa === 'risco' ? l.dias != null && l.dias < 90 : l.faixa === F.faixa)
        && (!F.familia || l.familia === F.familia) && (!F.semLote || l.lote === '0'));
    }
    function salvar(l, corpoReq, el) {
      if (TS.demo) { // apresentação: muda só na tela
        if ('lote' in corpoReq) l.lote = corpoReq.lote || '0';
        el.classList.add('vl-salvo'); setTimeout(() => el.classList.remove('vl-salvo'), 1200);
        return;
      }
      el.classList.add('vl-salvando');
      req('PUT', 'validade/lote', { loja, chave: l.chave, ...corpoReq }).then((j) => {
        cache.delete(loja);
        if (j.lote) Object.assign(l, j.lote);
        el.classList.remove('vl-salvando'); el.classList.add('vl-salvo'); setTimeout(() => el.classList.remove('vl-salvo'), 1200);
        if ('validade' in corpoReq) dados(loja, true).then((nd) => { if (corpo.isConnected) pintar(corpo, loja, nd); }).catch(() => null);
      }).catch((e) => { el.classList.remove('vl-salvando'); toast(e.message, true); });
    }
    function desenharTabela() {
      const rows = linhas();
      const cols = [
        { key: 'dias', label: 'Faixa', align: 'l', render: (l) => h('div', null, badge(l.faixa), h('small', { class: 'vl-dias' }, diasTxt(l.dias))) },
        { key: 'desc', label: 'Chá', align: 'l', render: (l) => h('div', null, h('b', null, l.desc), h('small', { class: 'muted vl-sub' }, [l.cod, l.familia].filter(Boolean).join(' · '))) },
        { key: 'entrada', label: 'Entrada', align: 'l', render: (l) => (l.entrada ? h('div', null, fmt.date(l.entrada), h('small', { class: 'muted vl-sub' }, `NF ${l.nf}`)) : h('small', { class: 'muted' }, 'saldo sem nota')) },
        { key: 'saldo', label: 'Saldo', render: (l) => h('div', { class: 'vl-saldo' },
          h('span', { title: l.qtdEntrada ? `chegaram ${kgTxt(l.qtdEntrada)}` : null }, kgTxt(l.saldo)),
          l.ajuste ? h('small', { class: 'vl-sub vl-aj', title: `${l.ajuste.tipo === 'inventario' ? 'Contado por lote no inventário' : 'Ajustado na tela'}${l.ajuste.por ? ' por ' + l.ajuste.por : ''} em ${new Date(l.ajuste.em).toLocaleDateString('pt-BR')}; as vendas depois disso saem do lote mais antigo` }, l.ajuste.tipo === 'inventario' ? 'contado no inventário' : 'ajustado') : null,
          h('button', { type: 'button', class: 'link-btn vl-ajustar', title: 'Divide o estoque deste chá entre os lotes (ex.: abriram o pacote novo antes do antigo). Não é inventário: não muda nada no AppNext e a soma tem de ser o estoque que já está lá. Se o total estiver errado, corrija pelo Inventário.', onclick: () => ajustarCha(l, d, loja, () => dados(loja, true).then((nd) => { if (corpo.isConnected) pintar(corpo, loja, nd); })) }, '⚖ ajustar')) },
        { key: 'lote', label: 'Lote', align: 'l', render: (l) => {
          const i = h('input', { class: 'f-input vl-lote' + (l.lote === '0' ? ' vl-vazio' : ''), value: l.lote === '0' ? '' : l.lote, placeholder: '0', maxlength: 30, 'aria-label': `Lote de ${l.desc}`, autocomplete: 'off', autocapitalize: 'characters' });
          i.addEventListener('change', () => { i.value = i.value.trim().toUpperCase(); i.classList.toggle('vl-vazio', !i.value); salvar(l, { lote: i.value }, i); });
          i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
          return i;
        } },
        { key: 'validade', label: 'Validade', align: 'l', render: (l) => {
          const i = h('input', { class: 'f-input vl-val', type: 'date', value: l.validade || '', min: l.entrada || null, 'aria-label': `Validade de ${l.desc}` });
          i.addEventListener('change', () => salvar(l, { validade: i.value }, i));
          const volta = !l.padrao && l.validadePadrao ? h('button', { type: 'button', class: 'link-btn', title: `Voltar para 12 meses da entrada (${fmt.date(l.validadePadrao)})`, onclick: () => salvar(l, { validade: '' }, i) }, '12 meses') : null;
          return h('div', { class: 'vl-val-box' }, i, volta, !l.padrao && l.editadoPor ? h('small', { class: 'muted vl-sub' }, `corrigida por ${l.editadoPor}`) : null);
        } },
        { key: 'venda', label: 'Valor (venda)', render: (l) => (l.precoKg ? fmt.brl0(l.saldo * l.precoKg) : '—'), sortVal: (l) => l.saldo * (l.precoKg || 0) },
        ...(d.custos ? [{ key: 'custo', label: 'A custo', render: (l) => (l.custoKg ? fmt.brl0(l.saldo * l.custoKg) : '—'), sortVal: (l) => l.saldo * (l.custoKg || 0) }] : []),
        ...(podeCampanha() ? [{ key: 'acao', label: '', align: 'l', render: (l) => (l.dias != null && l.dias < 60 && l.dias >= 0
          ? h('button', { type: 'button', class: 'btn vl-camp', title: `Campanha no WhatsApp para quem já comprou ${l.desc}`, onclick: () => campanhaDoCha(l) }, '📣 Campanha') : null) }] : []),
      ];
      const rowsT = rows.map((l) => ({ ...l, venda: l.saldo * (l.precoKg || 0), custo: l.saldo * (l.custoKg || 0), dias: l.dias == null ? 99999 : l.dias, _l: l }));
      // a tabela ordena pelo valor das chaves; sem data vai para o fim (tem a aba própria)
      tabela.replaceChildren(rows.length ? TS.table({
        cols: cols.map((c) => ({ ...c, render: c.render ? (row) => c.render(row._l) : undefined })), rows: rowsT, sortKey: 'dias', sortDir: 'asc',
        search: 'Buscar chá ou lote', searchKeys: ['desc', 'cod', 'lote', 'nf'], pageSize: 50, cls: 'vl-tabela',
      }) : TS.empty(F.faixa === 'risco' ? 'Nenhum lote vence nos próximos 90 dias. 🎉' : 'Nenhum lote com esses filtros.'));
    }

    const quando = d.em ? new Date(d.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    corpo.replaceChildren(
      h('div', { class: 'grid g-kpi vl-kpis' }, risco, ...ids.map(tile)),
      TS.cardWithTools('Lotes de chá a granel', `Saldo pelo estoque do AppNext de ${quando} · o mais antigo sai primeiro · envasado e acessório não têm validade`,
        h('div', { class: 'vl-filtros' }, selFam, semLote),
        h('div', { class: 'vl-segs' }, segs()), tabela),
      h('div', { class: 'card vl-ajuda' }, h('b', null, 'Como funciona'), h('ul', null,
        h('li', null, 'Chegou chá a granel? Digite o nº do lote que está no pacote na linha da entrada (nota e data). A validade já vem com 12 meses da entrada; se o pacote disser outra data, corrija.'),
        h('li', null, 'O saldo de cada lote sai do estoque do AppNext: o que sobrou fica nas entradas mais novas, porque o mais antigo é vendido primeiro. Por isso, venda sempre o lote mais antigo.'),
        h('li', null, 'Abriram o pacote novo antes do antigo? Em "⚖ ajustar", pese quanto tem de cada lote. O ajustar não é inventário: não muda o AppNext, só divide o estoque entre os lotes. Se o total estiver errado, use o Inventário (o chá a granel pode ser contado por lote). Depois disso, as vendas saem do lote mais antigo.'),
        h('li', null, '⚫ Vencido: tire da venda e lance a perda no AppNext. 🔴 e 🟠: degustação, oferta e campanha. 🟡: deixe na frente da prateleira.'),
        h('li', null, 'Os lotes em risco aparecem também em Vendas → Promoção, no Pedido (para não comprar mais do mesmo chá) e no resumo diário.'))));
    desenharTabela();
    // notas que chegaram com chá sem nº de lote (antes mesmo de o estoque ser atualizado)
    req('GET', `validade/notas?loja=${encodeURIComponent(loja)}`).then((j) => {
      const ns = (j.notas || []).filter((nt) => j.pendentes[nt.id]);
      if (!ns.length || !corpo.isConnected) return;
      corpo.insertBefore(TS.card('📦 Notas que chegaram: lote pendente', 'Chá a granel das notas de entrada recentes ainda sem o nº do lote',
        ...ns.slice(0, 5).map((nt) => h('div', { class: 'vl-nota' }, h('div', { class: 'vl-nota-tit' }, h('b', null, `NF ${nt.nf}`), h('span', { class: 'muted' }, ` · entrada ${fmt.date(nt.entrada)} · ${nt.fornecedor}`)),
          linhasNota(loja, { ...nt, itens: nt.itens.filter((x) => x.lote === '0') }, null)))), corpo.children[1] || null);
    }).catch(() => null);
  }

  /** Vendas → Promoção: o que vender primeiro (vencendo em menos de 60 dias) */
  TS.validade.cartaoVenderPrimeiro = function (loja) {
    const box = h('div');
    if (!loja || loja === 'todas') return box;
    dados(loja).then((d) => {
      const ls = d.lotes.filter((l) => l.dias != null && l.dias < 60).sort((a, b) => a.dias - b.dias);
      if (!ls.length || !box.isConnected) return;
      box.replaceChildren(TS.card('🍃 Vender primeiro: chá perto da validade', `${fmt.int(ls.length)} lote${ls.length === 1 ? '' : 's'} vencem em menos de 60 dias · valor ${fmt.brl0(d.resumo.risco.venda)} a preço de venda`,
        h('ul', { class: 'vl-lista' }, ...ls.slice(0, 12).map((l) => h('li', null, badge(l.faixa), h('b', null, ' ' + l.desc), h('span', { class: 'muted' }, ` · ${kgTxt(l.saldo)} · ${diasTxt(l.dias)}${l.lote !== '0' ? ` · lote ${l.lote}` : ''}`)))),
        ls.length > 12 ? h('p', { class: 'muted' }, `e mais ${ls.length - 12}…`) : null,
        TS.paginas && TS.paginas().includes('validade') ? h('a', { href: '#validade', class: 'link-btn' }, 'Ver todos os lotes →') : null));
    }).catch(() => null); // sem permissão ou sem estoque: o cartão não aparece
    return box;
  };

  /** Estoque → Pedido: por código, o lote mais urgente (< 90 dias) de cada chá */
  TS.validade.riscoPorCod = async function (loja) {
    const out = new Map();
    try {
      const d = await dados(loja);
      for (const l of d.lotes) if (l.dias != null && l.dias < 90 && (!out.has(l.cod) || l.dias < out.get(l.cod).dias)) out.set(l.cod, { dias: l.dias, faixa: l.faixa, kg: d.lotes.filter((x) => x.cod === l.cod && x.dias != null && x.dias < 90).reduce((s, x) => s + x.saldo, 0) });
    } catch { /* sem permissão: sem aviso */ }
    return out;
  };
})();
