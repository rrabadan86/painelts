/* Página Clientes: histórico por CPF, visitas, ausência, aniversários, WhatsApp */
'use strict';
(function () {
  const { h, fmt, state } = TS;

  /**
   * Monta (uma vez) o índice cliente → cupons → itens.
   * - Só conta como compra o cupom encontrado nas vendas da loja; o que não foi encontrado
   *   fica à parte (semVenda) e não entra em visitas, valor nem ticket.
   * - Quando a nota tem data (XML do AppNext), a venda precisa ser do mesmo dia (±1),
   *   para não juntar vendas diferentes com o mesmo número (outro caixa/série, NF-e × NFC-e).
   * - Taxas (serviço/delivery) aparecem nos itens, mas não somam no valor do cliente.
   */
  TS.prepararClientes = function () {
    const db = TS.db;
    const taxas = TS.rules.ids.taxas;
    const porChave = new Map(); // "cupom|lojaId" -> índices
    for (let i = 0; i < db.n; i++) {
      const k = db.cupom[i] + '|' + db.loja[i];
      let a = porChave.get(k);
      if (!a) porChave.set(k, (a = []));
      a.push(i);
    }
    const lojaId = new Map(db.D.loja.map((s, i) => [s, i]));
    const cad = new Map(db.clientes.map((c) => [c.cpf, c]));
    const porCPF = new Map();
    let semVendaTotal = 0;
    for (const x of db.xml) {
      if (!x.cpf) continue;
      const lid = lojaId.get(x.loja);
      let itens = lid === undefined ? [] : porChave.get(x.cupom + '|' + lid) || [];
      if (x.data && itens.length) {
        const d = TS.isoToDay(x.data);
        itens = itens.filter((i) => Math.abs(db.day[i] - d) <= 1);
      }
      let c = porCPF.get(x.cpf);
      if (!c) {
        const info = cad.get(x.cpf) || {};
        const nome = (info.nome || '').replace(/^[\s\-–—]+/, '').trim();
        const cel = digits(info.celular);
        const local = cel.length >= 12 && cel.startsWith('55') ? cel.slice(2) : cel; // aceita com o 55 na frente
        c = { cpf: x.cpf, empresa: x.cpf.length === 14, nome, celular: cel, wpp: local.length >= 10 && local.length <= 11 ? TS.demo ? '#demo' : 'https://wa.me/55' + local : null, nascimento: info.nascimento || null, cidade: info.cidade || '', email: info.email || '', cupons: [], semVenda: 0 };
        porCPF.set(x.cpf, c);
      }
      if (!itens.length) { c.semVenda++; semVendaTotal++; continue; }
      let day = null, vt = 0, qtd = 0;
      const vends = new Set();
      for (const i of itens) {
        if (day === null || db.day[i] > day) day = db.day[i];
        if (taxas.has(db.desc[i])) continue;
        vt += db.vt[i] || 0; qtd += db.qtd[i] || 0; vends.add(db.D.vendedor[db.vend[i]]);
      }
      c.cupons.push({ cupom: x.cupom, loja: x.loja, lojaId: lid, day, vt, qtd, itens, vendedores: [...vends].filter(Boolean).join(', ') });
    }
    const hoje = TS.todayDay();
    const lista = [];
    let soSemVenda = 0;
    for (const c of porCPF.values()) {
      if (!c.cupons.length) { soSemVenda++; continue; } // nenhuma compra encontrada nas vendas
      c.cupons.sort((a, b) => b.day - a.day);
      c.visitas = new Set(c.cupons.map((k) => k.cupom + '|' + k.loja)).size;
      c.ultima = c.cupons[0].day;
      c.ausencia = hoje - c.ultima;
      c.idade = idade(c.nascimento);
      c.aniv = c.nascimento ? c.nascimento.slice(8, 10) + '/' + c.nascimento.slice(5, 7) : '';
      lista.push(c);
    }
    TS.cli = { lista, semVendaTotal, soSemVenda, cuponsXml: db.xml.length, cidades: [...new Set(db.clientes.map((c) => c.cidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')) };
  };
  const digits = (s) => String(s || '').replace(/\D/g, '');
  function idade(iso) {
    if (!iso) return null;
    const n = new Date(), y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    let a = n.getFullYear() - y;
    if (n.getMonth() + 1 < m || (n.getMonth() + 1 === m && n.getDate() < d)) a--;
    // ano de mentira (1900) ou data do cadastro no lugar do nascimento: mantém o aniversário, sem idade
    return a >= 12 && a <= 105 ? a : null;
  }
  const faixa = (a) => (a == null ? null : a < 20 ? 'até 19' : a <= 29 ? '20 a 29' : a <= 39 ? '30 a 39' : a <= 49 ? '40 a 49' : a <= 59 ? '50 a 59' : '60+');

  // ---------- filtros ----------
  TS.filtrosClientes = function () {
    const s = state.cli, db = TS.db, box = h('div'), rerender = () => TS.render();
    const txt = (label, key, ph, mode) => {
      const i = h('input', { class: 'f-input', type: 'search', placeholder: ph, value: s[key], inputmode: mode || null });
      i.addEventListener('input', TS.debounce(() => { s[key] = i.value.trim(); rerender(); }, 500));
      return h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, label), i);
    };
    const faixaNum = (label, kMin, kMax, chips) => {
      const a = h('input', { class: 'f-input', type: 'number', min: 0, placeholder: 'de', value: s[kMin] });
      const b = h('input', { class: 'f-input', type: 'number', min: 0, placeholder: 'até', value: s[kMax] });
      TS.aoConfirmar(a, () => { s[kMin] = a.value; rerender(); });
      TS.aoConfirmar(b, () => { s[kMax] = b.value; rerender(); });
      return h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, label), h('div', { class: 'f-row' }, a, b),
        chips ? h('div', { class: 'chips' }, chips.map(([lab, mi, ma]) => h('button', { type: 'button', class: 'chip' + (String(s[kMin]) === String(mi) && String(s[kMax]) === String(ma) ? ' on' : ''), onclick: () => { s[kMin] = String(mi); s[kMax] = String(ma); rerender(); } }, lab))) : null);
    };
    // período das compras (vazio = todo o histórico)
    const de = h('input', { class: 'f-input', type: 'date', value: s.de || '' }), ate = h('input', { class: 'f-input', type: 'date', value: s.ate || '' });
    TS.aoConfirmar(de, () => { s.de = de.value; rerender(); });
    TS.aoConfirmar(ate, () => { s.ate = ate.value; rerender(); });
    const hojeIso = TS.dayToIso(TS.todayDay());
    const atalho = (lab, dias) => h('button', { type: 'button', class: 'chip' + (s.ate === '' && s.de === (dias ? TS.dayToIso(TS.todayDay() - dias) : '') ? ' on' : ''), onclick: () => { s.de = dias ? TS.dayToIso(TS.todayDay() - dias) : ''; s.ate = ''; rerender(); } }, lab);
    box.append(h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Compras entre'), h('div', { class: 'f-row' }, de, ate),
      h('div', { class: 'chips' }, atalho('Tudo', 0), atalho('90 dias', 90), atalho('12 meses', 365)),
      h('small', { class: 'muted' }, s.de || s.ate ? 'Valores, visitas e ticket só desse período. "Dias sem comprar" olha a última compra de verdade.' : `Todo o histórico (até ${fmt.date(hojeIso)}).`)));
    box.append(
      txt('Nome', 'nome', 'Nome do cliente'),
      txt('CPF', 'cpf', 'Somente números', 'numeric'),
      txt('Cupom', 'cupom', 'Nº do cupom', 'numeric'),
      txt('Produto comprado', 'produto', 'Ex.: earl grey'),
      faixaNum('Visitas (cupons)', 'visMin', 'visMax', [['1', 1, 1], ['2 a 4', 2, 4], ['5+', 5, '']]),
      faixaNum('Dias sem comprar', 'ausMin', 'ausMax', [['30+', 30, ''], ['60+', 60, ''], ['90+', 90, ''], ['180+', 180, '']]),
    );
    const mes = h('select', { class: 'f-input' }, h('option', { value: '' }, 'Qualquer mês'), TS.MESES.map((m, i) => h('option', { value: String(i + 1).padStart(2, '0'), selected: s.aniv === String(i + 1).padStart(2, '0') || null }, m)));
    mes.addEventListener('change', () => { s.aniv = mes.value; rerender(); });
    const hojeMes = String(new Date().getMonth() + 1).padStart(2, '0');
    box.append(h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Aniversário'), mes,
      h('div', { class: 'chips' }, h('button', { type: 'button', class: 'chip' + (s.aniv === hojeMes ? ' on' : ''), onclick: () => { s.aniv = s.aniv === hojeMes ? '' : hojeMes; rerender(); } }, 'Aniversariantes do mês'))));
    if (db.opts.lojas.length > 1) box.append(TS.multiSelect({ label: 'Loja', options: db.opts.lojas, selected: s.lojas, onChange: rerender, placeholder: 'Todas as lojas' }));
    box.append(TS.multiSelect({ label: 'Grupo comprado', options: db.opts.grupos, selected: s.grupos, onChange: rerender }));
    if (TS.cli.cidades.length) box.append(TS.multiSelect({ label: 'Cidade (cadastro)', options: TS.cli.cidades.map((c) => [c, c]), selected: s.cidade, onChange: rerender, placeholder: 'Todas' }));
    return box;
  };

  // ---------- aplicação dos filtros ----------
  function filtrar() {
    const s = state.cli, db = TS.db;
    const nome = TS.norm(s.nome), cpf = s.cpf.replace(/\D/g, ''), cupom = s.cupom.replace(/\D/g, ''), prod = TS.norm(s.produto);
    const num = (v) => (v === '' || v == null ? null : +v);
    const vMin = num(s.visMin), vMax = num(s.visMax), aMin = num(s.ausMin), aMax = num(s.ausMax);
    const filtraItens = prod || s.grupos.size;
    let prodOk = null;
    if (prod) { prodOk = new Uint8Array(db.D.descricao.length); db.D.descricao.forEach((t, i) => { if (TS.norm(t).includes(prod)) prodOk[i] = 1; }); }
    const dDe = s.de ? TS.isoToDay(s.de) : null, dAte = s.ate ? TS.isoToDay(s.ate) : null;
    const out = [];
    for (const c of TS.cli.lista) {
      if (nome && !TS.norm(c.nome).includes(nome)) continue;
      if (cpf && !c.cpf.includes(cpf)) continue;
      if ((aMin != null || aMax != null) && c.ausencia == null) continue;
      if (aMin != null && c.ausencia < aMin) continue;
      if (aMax != null && c.ausencia > aMax) continue;
      if (s.aniv && (!c.nascimento || c.nascimento.slice(5, 7) !== s.aniv)) continue;
      if (s.cidade.size && !s.cidade.has(c.cidade)) continue;
      let cupons = c.cupons;
      if (dDe != null || dAte != null) cupons = cupons.filter((k) => (dDe == null || k.day >= dDe) && (dAte == null || k.day <= dAte));
      if (s.lojas.size) cupons = cupons.filter((k) => s.lojas.has(k.lojaId));
      if (cupom) cupons = cupons.filter((k) => String(k.cupom).includes(cupom));
      if (filtraItens) {
        cupons = cupons.map((k) => {
          const itens = k.itens.filter((i) => (!prodOk || prodOk[db.desc[i]]) && (!s.grupos.size || s.grupos.has(db.grupoC[i])));
          return itens.length ? { ...k, itensFiltrados: itens } : null;
        }).filter(Boolean);
      }
      if (!cupons.length) continue;
      const visitas = cupons.length;
      if (vMin != null && visitas < vMin) continue;
      if (vMax != null && visitas > vMax) continue;
      const taxas = TS.rules.ids.taxas;
      // com filtro de produto/grupo, o valor é só dos itens filtrados
      const somaItens = (k) => { let v = 0, q = 0; for (const i of k.itensFiltrados) { if (taxas.has(db.desc[i])) continue; v += db.vt[i] || 0; q += db.qtd[i] || 0; } return [v, q]; };
      let vt = 0, qtd = 0;
      for (const k of cupons) { const [v, q] = k.itensFiltrados ? somaItens(k) : [k.vt, k.qtd]; vt += v; qtd += q; }
      out.push({ c, cupons, visitas, vt, qtd, tkm: vt / visitas });
    }
    return out;
  }

  // ---------- página ----------
  TS.pages.clientes = function (root) {
    const db = TS.db, s = state.cli;
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Clientes'), h('div', { class: 'page-sub' }, 'Cupons identificados por CPF, com histórico de compras e contato'))));
    if (!db.xml.length) { root.append(h('div', { class: 'notice' }, 'A planilha "Xml" (cupons com CPF) não foi carregada.')); return; }
    const lista = filtrar();
    if (TS.cli.semVendaTotal) {
      const pct = TS.cli.semVendaTotal / TS.cli.cuponsXml;
      root.append(h('div', { class: 'notice' + (pct > 0.2 ? ' err' : '') },
        h('b', null, `${fmt.int(TS.cli.semVendaTotal)} cupons com CPF (${fmt.pct(pct, 0)}) não foram encontrados nas vendas`),
        ` e ficaram de fora das contas${TS.cli.soSemVenda ? ` (${fmt.int(TS.cli.soSemVenda)} CPFs só têm cupons assim)` : ''}. Normalmente são vendas fora do período importado ou números de cupom que não batem com o relatório de vendas.`));
    }

    const ordem = s.ordem;
    const ORD = { recente: (a, b) => (b.c.ultima ?? -1) - (a.c.ultima ?? -1), valor: (a, b) => b.vt - a.vt, visitas: (a, b) => b.visitas - a.visitas, ausencia: (a, b) => (b.c.ausencia ?? -1) - (a.c.ausencia ?? -1), nome: (a, b) => (a.c.nome || 'zzz').localeCompare(b.c.nome || 'zzz', 'pt-BR') };
    lista.sort(ORD[ordem] || ORD.recente);

    const tot = lista.reduce((t, r) => t + r.vt, 0);
    const comWpp = lista.filter((r) => r.c.wpp).length;
    const visMed = lista.length ? lista.reduce((t, r) => t + r.visitas, 0) / lista.length : null;
    const mesAtual = String(new Date().getMonth() + 1).padStart(2, '0');
    const anivMes = lista.filter((r) => r.c.nascimento && r.c.nascimento.slice(5, 7) === mesAtual).length;
    root.append(h('div', { class: 'grid g-kpi' },
      TS.kpi('Clientes', fmt.int(lista.length), `de ${fmt.int(TS.cli.lista.length)} com compra identificada`),
      TS.kpi('Faturamento desses clientes', fmt.brl0(tot)),
      TS.kpi('Visitas por cliente', fmt.n1(visMed), 'média'),
      TS.kpi('Com WhatsApp', fmt.int(comWpp), lista.length ? fmt.pct(comWpp / lista.length, 0) + ' da lista' : null),
      TS.kpi('Aniversariantes do mês', fmt.int(anivMes), TS.MESES[+mesAtual - 1])));

    // ---- lista
    const listBox = h('div', { class: 'cli-list' });
    const PAG = 40;
    let mostrados = 0;
    const mais = h('button', { class: 'btn', type: 'button', style: { margin: '12px auto 0', display: 'block' } });
    const paint = () => {
      const fim = Math.min(lista.length, mostrados + PAG);
      for (let k = mostrados; k < fim; k++) listBox.append(clienteCard(lista[k]));
      mostrados = fim;
      mais.textContent = `Mostrar mais (${fmt.int(lista.length - mostrados)} restantes)`;
      mais.style.display = mostrados < lista.length ? 'block' : 'none';
    };
    mais.addEventListener('click', paint);
    paint();

    const ordSel = TS.seg([['Mais recentes', 'recente'], ['Maior valor', 'valor'], ['Mais visitas', 'visitas'], ['Mais tempo sem vir', 'ausencia'], ['Nome', 'nome']], ordem, (v) => { s.ordem = v; TS.render(); });
    const csv = h('button', { class: 'btn', type: 'button', onclick: () => baixarCSV(lista) }, 'Baixar lista (CSV)');
    const listaCard = TS.cardWithTools('Lista de clientes', 'Clique num cliente para ver os cupons e os itens', h('div', { class: 'table-tools' }, ordSel, csv),
      lista.length ? listBox : TS.empty('Nenhum cliente com esses filtros.'), mais);

    // ---- painéis laterais
    const lado = h('div', { class: 'grid', style: { alignContent: 'start' } });
    // top chás desses clientes
    const prodVal = new Map();
    for (const r of lista) for (const k of r.cupons) for (const i of (k.itensFiltrados || k.itens)) {
      if (!TS.rules.ids.catChaKg.has(db.cat[i]) && !TS.rules.ids.arom.has(db.grupoC[i]) && !TS.rules.ids.puro.has(db.grupoC[i])) continue;
      prodVal.set(db.prod[i], (prodVal.get(db.prod[i]) || 0) + (db.vt[i] || 0));
    }
    const topCha = [...prodVal].sort((a, b) => b[1] - a[1]).slice(0, 5);
    lado.append(TS.card('Chás mais comprados', lista.length === 1 ? 'por este cliente' : 'pelos clientes da lista (R$)', topCha.length ? TS.chart({
      type: 'doughnut',
      data: { labels: topCha.map(([p]) => db.D.produto[p]), datasets: [{ data: topCha.map(([, v]) => v), backgroundColor: TS.cores.slice(0, 5), borderWidth: 2, borderColor: '#fff' }] },
      options: { cutout: '58%', plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${fmt.brl(c.raw)}` } } } },
    }) : TS.empty()));
    const top = (arr, key, fm, titulo, sub) => {
      const rows = arr.filter((r) => r[key] != null).sort((a, b) => b[key] - a[key]).slice(0, 5);
      return TS.card(titulo, sub, rows.length ? TS.chart({
        type: 'bar',
        data: { labels: rows.map((r) => { const n = r.c.nome || r.c.cpf; return n.length > 16 ? n.slice(0, 15) + '…' : n; }), datasets: [{ data: rows.map((r) => r[key]), backgroundColor: '#2C5234', borderRadius: 4, maxBarThickness: 18 }] },
        options: { indexAxis: 'y', layout: { padding: { left: 8, right: 80 } }, plugins: { legend: { display: false }, valueLabels: { display: true, format: fm }, tooltip: { callbacks: { label: (c) => fm(c.raw) } } }, scales: { x: { display: false }, y: { grid: { display: false }, ticks: { font: { size: 11 }, crossAlign: 'far' } } } },
      }, 'short') : TS.empty());
    };
    lado.append(top(lista, 'vt', fmt.brl0, 'Top 5 em faturamento', 'Clientes da lista'));
    lado.append(top(lista.filter((r) => r.cupons.length >= 2), 'tkm', fmt.brl, 'Top 5 em ticket médio', 'Clientes com 2 ou mais compras'));
    const faixas = ['até 19', '20 a 29', '30 a 39', '40 a 49', '50 a 59', '60+'];
    const cont = Object.fromEntries(faixas.map((f) => [f, 0]));
    let semData = 0;
    for (const r of lista) { const f = faixa(r.c.idade); if (f) cont[f]++; else semData++; }
    const comData = lista.length - semData;
    lado.append(TS.card('Faixa etária', `${fmt.int(comData)} clientes com data de nascimento`, comData ? TS.chart({
      type: 'bar', data: { labels: faixas, datasets: [{ data: faixas.map((f) => cont[f]), backgroundColor: '#C9A227', borderRadius: 4 }] },
      options: { plugins: { legend: { display: false }, valueLabels: { display: true, format: (v) => `${v} (${fmt.pct(v / comData, 0)})` } }, scales: { y: { display: false, grace: '15%' }, x: TS.axisCat } },
    }, 'short') : TS.empty()));

    root.append(h('div', { class: 'grid g-2-1 mt', style: { alignItems: 'start' } }, listaCard, lado));
  };

  function clienteCard(r) {
    const db = TS.db, c = r.c;
    const nome = c.nome || 'Cliente sem cadastro';
    const card = h('div', { class: 'cli' });
    const ausTxt = c.ausencia == null ? '—' : c.ausencia === 0 ? 'hoje' : `${fmt.int(c.ausencia)} d`;
    const head = h('div', { class: 'cli-head', role: 'button', tabindex: 0, 'aria-expanded': 'false' },
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'cli-name', title: nome }, nome),
        h('div', { class: 'cli-meta' },
          h('span', null, fmtCPF(c.cpf)), c.empresa ? h('span', { class: 'cli-emp' }, 'empresa') : null,
          c.idade != null ? h('span', null, `${c.idade} anos`) : null,
          c.aniv ? h('span', null, '🎂 ' + c.aniv) : null,
          c.cidade ? h('span', null, c.cidade) : null,
          c.wpp ? h('a', { class: 'wpp', href: c.wpp, target: TS.demo ? null : '_blank', rel: 'noopener', title: TS.demo ? 'Na apresentação o WhatsApp não abre (número fictício)' : null, onclick: (e) => { e.stopPropagation(); if (TS.demo) e.preventDefault(); } }, '● WhatsApp') : null)),
      h('div', { class: 'cli-stat' }, fmt.int(r.visitas), h('small', null, 'visitas')),
      h('div', { class: 'cli-stat' }, fmt.brl0(r.vt), h('small', null, 'total')),
      h('div', { class: 'cli-stat hide-sm' }, fmt.brl(r.tkm), h('small', null, 'ticket')),
      h('div', { class: 'cli-stat hide-sm' }, c.ultima != null ? fmt.date(TS.dayToIso(c.ultima)) : '—', h('small', null, 'última')),
      h('div', { class: 'cli-stat hide-sm' }, ausTxt, h('small', null, 'sem vir')),
      h('div', { class: 'cli-caret' }, '›'));
    const body = h('div', { class: 'cli-body' });
    let aberto = false;
    const toggle = () => {
      aberto = !aberto;
      card.classList.toggle('open', aberto);
      head.setAttribute('aria-expanded', String(aberto));
      if (aberto && !body.childElementCount) {
        const pma = r.qtd ? r.vt / r.qtd : null, ipa = r.visitas ? r.qtd / r.visitas : null;
        body.append(h('div', { class: 'cli-meta', style: { margin: '4px 0 2px' } },
          h('span', null, `PMA ${fmt.brl(pma)}`), h('span', null, `IPA ${fmt.n2(ipa)}`), h('span', null, `${fmt.int(r.qtd)} itens`),
          c.celular ? h('span', null, `Tel. ${c.celular}`) : null, c.email ? h('span', null, c.email) : null,
          c.semVenda ? h('span', { class: 'muted', title: 'Cupons com o CPF desta pessoa que não foram encontrados nas vendas (não entram nas contas)' }, `+ ${c.semVenda} cupom(ns) sem venda encontrada`) : null));
        for (const k of r.cupons) {
          const itens = k.itensFiltrados || k.itens;
          const tb = h('table', { class: 'cupom-items' });
          for (const i of itens) tb.append(h('tr', { class: TS.rules.ids.taxas.has(db.desc[i]) ? 'taxa' : null, title: TS.rules.ids.taxas.has(db.desc[i]) ? 'Taxa: não soma no valor do cliente' : null }, h('td', null, db.D.descricao[db.desc[i]]), h('td', { class: 'r' }, `${fmt.int(db.qtd[i])} un.`), h('td', { class: 'r' }, fmt.brl(db.vt[i])), h('td', { class: 'r', style: { color: '#6B7A70' } }, db.D.vendedor[db.vend[i]])));
          if (!itens.length) tb.append(h('tr', null, h('td', { style: { color: '#6B7A70' } }, 'Cupom sem itens na planilha de vendas.')));
          body.append(h('div', { class: 'cupom' },
            h('div', { class: 'cupom-head' }, h('span', null, h('b', null, `Cupom ${k.cupom}`), ' · ', k.day != null ? fmt.date(TS.dayToIso(k.day)) : 'sem data', TS.db.opts.lojas.length > 1 ? ' · ' + k.loja : ''),
              h('span', null, `${fmt.int(k.qtd)} itens · `, h('b', null, fmt.brl(k.vt)))),
            tb));
        }
      }
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    card.append(head, body);
    return card;
  }
  const fmtCPF = (s) => (s && s.length === 11 ? `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`
    : s && s.length === 14 ? `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}` : s || '');

  function baixarCSV(lista) {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const linhas = [['Nome', 'CPF', 'Celular', 'WhatsApp', 'E-mail', 'Cidade', 'Nascimento', 'Visitas', 'Total (R$)', 'Última compra', 'Dias sem comprar'].join(';')];
    for (const r of lista) {
      const c = r.c;
      linhas.push([c.nome, fmtCPF(c.cpf), c.celular, TS.demo ? '' : c.wpp || '', c.email, c.cidade, c.nascimento ? fmt.date(c.nascimento) : '', r.visitas, r.vt.toFixed(2).replace('.', ','), c.ultima != null ? fmt.date(TS.dayToIso(c.ultima)) : '', c.ausencia ?? ''].map(esc).join(';'));
    }
    const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `clientes-teashop-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
})();
