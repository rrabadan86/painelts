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
    const cuponsCPF = new Map(); // "cupom|lojaId" → cliente (para a % de vendas com CPF)
    const cha = TS.rules.ids.chaTotal;
    for (const c of porCPF.values()) {
      if (!c.cupons.length) { soSemVenda++; continue; } // nenhuma compra encontrada nas vendas
      c.cupons.sort((a, b) => b.day - a.day);
      c.visitas = new Set(c.cupons.map((k) => k.cupom + '|' + k.loja)).size;
      c.ultima = c.cupons[0].day;
      c.primeira = c.cupons[c.cupons.length - 1].day;
      c.ausencia = hoje - c.ultima;
      c.idade = idade(c.nascimento);
      c.aniv = c.nascimento ? c.nascimento.slice(8, 10) + '/' + c.nascimento.slice(5, 7) : '';
      // ficha: frequência, chá favorito, pacote, vendedora, gasto 12 meses
      const dias = [...new Set(c.cupons.map((k) => k.day))].sort((a, b) => a - b);
      c.intervalo = dias.length >= 2 ? (dias[dias.length - 1] - dias[0]) / (dias.length - 1) : null;
      const diasCha = new Set(), porCha = new Map(), porTam = new Map(), porVend = new Map(), gramas = new Map();
      c.gasto12 = 0; c.gasto12ant = 0;
      for (const k of c.cupons) {
        cuponsCPF.set(k.cupom + '|' + k.lojaId, c);
        if (k.day > hoje - 365) c.gasto12 += k.vt; else if (k.day > hoje - 730) c.gasto12ant += k.vt;
        for (const i of k.itens) {
          if (taxas.has(db.desc[i])) continue;
          const v = db.D.vendedor[db.vend[i]];
          if (v) porVend.set(v, (porVend.get(v) || 0) + (db.vt[i] || 0));
          // chá a granel/pacote (tem kg); xícaras e bebidas não contam
          if (!cha.has(db.grupo[i]) || !(db.cha[i] > 0)) continue;
          diasCha.add(k.day);
          gramas.set(k.day, (gramas.get(k.day) || 0) + db.cha[i] * 1000);
          porCha.set(db.prod[i], (porCha.get(db.prod[i]) || 0) + db.cha[i]);
          if (db.so[i]) porTam.set(db.so[i], (porTam.get(db.so[i]) || 0) + (db.qtd[i] || 0));
        }
      }
      const maior = (m) => { let b = null; for (const [k, v] of m) if (!b || v > b[1]) b = [k, v]; return b ? b[0] : null; };
      const fav = maior(porCha);
      c.chaFavorito = fav != null ? db.D.produto[fav] : null;
      c.pacote = maior(porTam);
      c.vendedora = maior(porVend);
      const dc = [...diasCha].sort((a, b) => a - b);
      c.ultimaCha = dc.length ? dc[dc.length - 1] : null;
      c.gramasUltima = c.ultimaCha != null ? Math.round(gramas.get(c.ultimaCha) || 0) : 0;
      // quando o chá da última compra deve acabar = gramas da última compra ÷ consumo por dia.
      // Consumo: pelo histórico da pessoa (chá comprado antes da última compra ÷ dias entre a 1ª e a última),
      // quando há pelo menos 60 dias de histórico; senão, ~3 g por dia (1 xícara). Fica entre 15 e 180 dias.
      c.gDia = null; c.reporEstimado = true;
      if (dc.length >= 2 && dc[dc.length - 1] - dc[0] >= 60) {
        let antes = 0; for (const [dia, g] of gramas) if (dia < c.ultimaCha) antes += g;
        const gd = antes / (dc[dc.length - 1] - dc[0]);
        if (gd > 0.3) { c.gDia = gd; c.reporEstimado = false; }
      }
      const gd = c.gDia || 3;
      c.intervaloCha = c.gramasUltima > 0 ? Math.min(180, Math.max(15, Math.round(c.gramasUltima / gd))) : null;
      c.proxCha = c.intervaloCha ? c.ultimaCha + c.intervaloCha : null;
      lista.push(c);
    }
    // segmentos (sobre o histórico todo)
    const gastos = lista.map((c) => c.gasto12).filter((v) => v > 0).sort((a, b) => b - a);
    const corteVip = gastos.length >= 10 ? gastos[Math.floor(gastos.length * 0.1) - 1] : Infinity;
    const hojeD = new Date(), mesHoje = hojeD.getUTCMonth(), anoHoje = hojeD.getUTCFullYear();
    const proximos7 = new Set(Array.from({ length: 8 }, (_, k) => { const d = new Date(Date.now() + k * 864e5); return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }));
    for (const c of lista) {
      const t = new Set();
      const p = new Date(c.primeira * 864e5);
      if (p.getUTCMonth() === mesHoje && p.getUTCFullYear() === anoHoje) t.add('novo');
      if (c.cupons.filter((k) => k.day > hoje - 365).length >= 5) t.add('fiel');
      if (c.gasto12 > 0 && c.gasto12 >= corteVip) t.add('vip');
      if (c.visitas === 1 && c.ausencia >= 30) t.add('uma');
      if (c.visitas >= 3 && c.intervalo && c.ausencia > Math.max(2 * c.intervalo, 60)) t.add('sumido');
      if (c.proxCha != null && hoje >= c.proxCha - 3 && hoje <= c.proxCha + 45) t.add('repor');
      if (c.nascimento && proximos7.has(c.nascimento.slice(5, 10))) t.add('aniv');
      c.tags = t;
    }
    TS.cli = { lista, semVendaTotal, soSemVenda, cuponsXml: db.xml.length, cuponsCPF, contatos: (TS.cli && TS.cli.contatos) || null, cidades: [...new Set(db.clientes.map((c) => c.cidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')) };
  };
  // ---------- contatos (contatado / não quer mensagens), guardados por loja no servidor ----------
  const NOMES_SEG = { hoje: 'Contatar hoje', aniv: 'Aniversário (7 dias)', sumido: 'Sumidos', repor: 'Hora de repor', novo: 'Novos do mês', fiel: 'Fiéis', vip: 'VIP', uma: 'Uma compra só' };
  const DICA_SEG = {
    hoje: 'Aniversariantes da semana, sumidos e quem está na hora de repor — sem quem já foi contatado nos últimos 30 dias ou não quer mensagens.',
    aniv: 'Fazem aniversário nos próximos 7 dias.',
    sumido: 'Compraram 3 vezes ou mais e estão sem vir há mais que o dobro do intervalo de costume (e mais de 60 dias).',
    repor: 'O chá a granel da última compra deve estar acabando: gramas levadas ÷ consumo por dia (pelo histórico da pessoa; sem histórico, ~3 g por dia).',
    novo: 'Primeira compra neste mês.', fiel: '5 compras ou mais nos últimos 12 meses.', vip: 'Os 10% que mais gastaram nos últimos 12 meses.', uma: 'Compraram uma vez só (há 30 dias ou mais) e não voltaram.',
  };
  const lojaIdDe = (c) => {
    const nomeVenda = TS.db.D.loja[c.cupons[0].lojaId];
    const m = (TS.db.metas || []).find((x) => (x.nomesVenda || []).includes(nomeVenda));
    return m ? m.id : (TS.db.metas[0] && TS.db.metas[0].id);
  };
  const contatoDe = (c) => (TS.cli.contatos ? TS.cli.contatos[c.cpf] : null);
  let carregandoContatos = false;
  function carregarContatos() {
    if (TS.cli.contatos || carregandoContatos) return;
    if (TS.demo) { TS.cli.contatos = {}; return; }
    carregandoContatos = true;
    fetch('/api/contatos?loja=' + encodeURIComponent(state.loja || ''), { credentials: 'same-origin' }).then((r) => r.json())
      .then((j) => { TS.cli.contatos = j.contatos || {}; if (state.page === 'clientes') TS.render(); })
      .catch(() => { TS.cli.contatos = {}; }).finally(() => { carregandoContatos = false; });
  }
  async function marcar(c, acao, motivo) {
    const loja = lojaIdDe(c);
    let novo;
    if (TS.demo) {
      const a = { ...(TS.cli.contatos[c.cpf] || {}) };
      if (acao === 'contatado') Object.assign(a, { em: new Date().toISOString(), por: 'você', motivo });
      if (acao === 'optout') a.optout = true;
      if (acao === 'aceita') delete a.optout;
      if (acao === 'limpar') { delete a.em; delete a.motivo; }
      novo = a;
    } else {
      const r = await fetch('/api/contatos', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ loja, cpf: c.cpf, acao, motivo }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
      novo = j.contato ? { ...j.contato, loja } : null;
    }
    if (novo && Object.keys(novo).length) TS.cli.contatos[c.cpf] = novo; else delete TS.cli.contatos[c.cpf];
  }
  // modelos de mensagem (editáveis em Configurações → Lojas → Mensagens de WhatsApp)
  TS.WPP_PADRAO = [
    { nome: 'Aniversário', texto: 'Oi, {nome}! A equipe da {loja} deseja um feliz aniversário 🎉 Que tal passar aqui esta semana para comemorar com um chá?' },
    { nome: 'Sentimos sua falta', texto: 'Oi, {nome}! Faz um tempinho que você não passa na {loja}. Chegaram novidades que têm a sua cara — vem provar! 🍵' },
    { nome: 'Hora de repor', texto: 'Oi, {nome}! Seu {cha} já deve estar acabando 🍵 Quer que a gente separe um pacote para você na {loja}?' },
    { nome: 'Novidades', texto: 'Oi, {nome}! Temos novidades na {loja} e lembrei de você. Posso te mandar as opções?' },
  ];
  const modelosDe = (lojaId) => { const m = (TS.db.metas || []).find((x) => x.id === lojaId); return (m && m.wpp && m.wpp.length ? m.wpp : TS.WPP_PADRAO); };
  const primeiroNome = (n) => { const p = String(n || '').trim().split(/\s+/)[0] || ''; return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : ''; };
  function textoWpp(modelo, c) {
    const lid = lojaIdDe(c);
    const loja = ((TS.lojas || []).find((l) => l.id === lid) || {}).nome || 'Tea Shop';
    return modelo.texto.replace(/\{nome\}/g, primeiroNome(c.nome) || 'tudo bem').replace(/\{loja\}/g, loja).replace(/\{cha\}/g, c.chaFavorito || 'chá');
  }
  const linkWpp = (c, txt) => (TS.demo ? '#demo' : c.wpp + '?text=' + encodeURIComponent(txt));

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
      if (s.seg) {
        const ct = contatoDe(c);
        if (s.seg === 'hoje') {
          if (!(c.tags.has('aniv') || c.tags.has('sumido') || c.tags.has('repor'))) continue;
          if (ct && (ct.optout || (ct.em && Date.now() - Date.parse(ct.em) < 30 * 864e5))) continue;
        } else if (!c.tags.has(s.seg)) continue;
      }
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
    carregarContatos();
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

    const segBar = h('div', { class: 'cli-segs' }, h('span', { class: 'f-label' }, 'Segmentos:'),
      Object.entries(NOMES_SEG).map(([k, nome]) => h('button', { type: 'button', class: 'chip' + (s.seg === k ? ' on' : '') + (k === 'hoje' ? ' chip-destaque' : ''), title: DICA_SEG[k], onclick: () => { s.seg = s.seg === k ? '' : k; TS.render(); } }, nome)),
      s.seg ? h('small', { class: 'muted cli-seg-dica' }, DICA_SEG[s.seg]) : null);
    const ordSel = TS.seg([['Mais recentes', 'recente'], ['Maior valor', 'valor'], ['Mais visitas', 'visitas'], ['Mais tempo sem vir', 'ausencia'], ['Nome', 'nome']], ordem, (v) => { s.ordem = v; TS.render(); });
    const csv = h('button', { class: 'btn', type: 'button', onclick: () => baixarCSV(lista) }, 'Baixar lista (CSV)');
    const csvWpp = h('button', { class: 'btn', type: 'button', title: 'Só nome e celular de quem tem WhatsApp e não pediu para não receber mensagens', onclick: () => baixarCSVWpp(lista) }, 'Lista para WhatsApp (CSV)');
    const listaCard = TS.cardWithTools('Lista de clientes', 'Clique num cliente para ver a ficha, os cupons e os itens', h('div', { class: 'table-tools' }, ordSel, csv, csvWpp),
      segBar, lista.length ? listBox : TS.empty('Nenhum cliente com esses filtros.'), mais);

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

    const junto = cartaoLevamJunto();
    if (junto) lado.prepend(junto);
    root.append(h('div', { class: 'grid g-2-1 mt', style: { alignItems: 'start' } }, listaCard, lado));
    root.append(...baseDeClientes(lista));
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
          ...[...(c.tags || [])].map((t) => h('span', { class: 'cli-tag t-' + t, title: DICA_SEG[t] }, NOMES_SEG[t])),
          (() => { const ct = contatoDe(c); return ct && ct.optout ? h('span', { class: 'cli-tag t-optout', title: 'Pediu para não receber mensagens' }, 'não quer mensagens') : ct && ct.em ? h('span', { class: 'cli-tag t-contato', title: `Contatado por ${ct.por || '?'}${ct.motivo ? ' · ' + ct.motivo : ''}` }, 'contatado ' + fmt.date(ct.em.slice(0, 10))) : null; })(),
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
        body.append(fichaCliente(c, r), acoesCliente(c));
        if (c.semVenda) body.append(h('p', { class: 'muted', style: { margin: '0 0 8px', fontSize: '12px' } }, `+ ${c.semVenda} cupom(ns) com o CPF desta pessoa não foram encontrados nas vendas (não entram nas contas).`));
        for (const k of r.cupons) {
          const itens = k.itensFiltrados || k.itens;
          const tb = h('table', { class: 'cupom-items' });
          for (const i of itens) tb.append(h('tr', { class: TS.rules.ids.taxas.has(db.desc[i]) ? 'taxa' : null, title: TS.rules.ids.taxas.has(db.desc[i]) ? 'Taxa: não soma no valor do cliente' : null }, h('td', null, db.D.descricao[db.desc[i]]), h('td', { class: 'r' }, `${fmt.int(db.qtd[i])} un.`), h('td', { class: 'r' }, fmt.brl(db.vt[i])), h('td', { class: 'r', style: { color: '#6B7A70' } }, db.D.vendedor[db.vend[i]])));
          if (!itens.length) tb.append(h('tr', null, h('td', { style: { color: '#6B7A70' } }, 'Cupom sem itens na planilha de vendas.')));
          body.append(h('div', { class: 'cupom' },
            h('div', { class: 'cupom-head' }, h('span', null, h('b', null, `Cupom ${k.cupom}`), ' · ', k.day != null ? fmt.date(TS.dayToIso(k.day)) : 'sem data', TS.db.opts.lojas.length > 1 ? ' · ' + k.loja : ''),
              h('span', null, `${fmt.int(k.qtd)} ${k.qtd === 1 ? 'item' : 'itens'} · `, h('b', null, fmt.brl(k.vt)))),
            tb));
        }
      }
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    card.append(head, body);
    return card;
  }
  // ---------- quem leva X também leva ----------
  function cartaoLevamJunto() {
    const s = state.cli, db = TS.db;
    const q = TS.norm(s.produto);
    if (!q) return null;
    const dDe = s.de ? TS.isoToDay(s.de) : -Infinity, dAte = s.ate ? TS.isoToDay(s.ate) : Infinity;
    const taxas = TS.rules.ids.taxas;
    const alvo = new Uint8Array(db.D.descricao.length);
    db.D.descricao.forEach((t, i) => { if (TS.norm(t).includes(q)) alvo[i] = 1; });
    const porCupom = new Map(); // cupons do período que têm o produto
    for (let i = 0; i < db.n; i++) {
      if (db.day[i] < dDe || db.day[i] > dAte) continue;
      if (alvo[db.desc[i]]) porCupom.set(db.cupom[i] + '|' + db.loja[i], true);
    }
    if (!porCupom.size) return TS.card(`Quem leva "${s.produto}"`, 'também leva…', TS.empty('Nenhuma venda desse produto no período.'));
    const cont = new Map();
    const vistos = new Set();
    for (let i = 0; i < db.n; i++) {
      const k = db.cupom[i] + '|' + db.loja[i];
      if (!porCupom.has(k) || alvo[db.desc[i]] || taxas.has(db.desc[i])) continue;
      const kp = k + '#' + db.prod[i];
      if (vistos.has(kp)) continue;
      vistos.add(kp);
      cont.set(db.prod[i], (cont.get(db.prod[i]) || 0) + 1);
    }
    const top = [...cont].sort((a, b) => b[1] - a[1]).slice(0, 8);
    return TS.card(`Quem leva "${s.produto}"`, `também leva… (${fmt.int(porCupom.size)} cupons com o produto, de todas as vendas do período)`,
      top.length ? h('ul', { class: 'cli-junto' }, top.map(([p, n]) => h('li', null, h('span', null, db.D.produto[p]), h('b', null, fmt.pct(n / porCupom.size, 0))))) : TS.empty('Sempre comprado sozinho.'));
  }

  // ---------- indicadores da base e vendedoras ----------
  function baseDeClientes(lista) {
    const s = state.cli, db = TS.db;
    const dDe = s.de ? TS.isoToDay(s.de) : -Infinity, dAte = s.ate ? TS.isoToDay(s.ate) : Infinity;
    const taxas = TS.rules.ids.taxas;
    const lojasOk = s.lojas.size ? s.lojas : null;
    // todas as vendas do período: cupons por vendedora e com/sem CPF
    const cupons = new Map(); // "cupom|loja" → { vt, vends:Set }
    for (let i = 0; i < db.n; i++) {
      if (db.day[i] < dDe || db.day[i] > dAte) continue;
      if (lojasOk && !lojasOk.has(db.loja[i])) continue;
      const v = db.D.vendedor[db.vend[i]];
      if (!v || /^sem vendedor$/i.test(v)) continue;
      const k = db.cupom[i] + '|' + db.loja[i];
      let x = cupons.get(k);
      if (!x) cupons.set(k, (x = { vt: 0, vends: new Set() }));
      if (!taxas.has(db.desc[i])) x.vt += db.vt[i] || 0;
      x.vends.add(v);
    }
    let nTot = 0, vtTot = 0, nCpf = 0, vtCpf = 0;
    const porVend = new Map();
    const pv = (v) => { let a = porVend.get(v); if (!a) porVend.set(v, (a = { nome: v, cupons: 0, cpf: 0, novos: 0, voltaram: 0 })); return a; };
    for (const [k, x] of cupons) {
      const temCpf = TS.cli.cuponsCPF.has(k);
      nTot++; vtTot += x.vt;
      if (temCpf) { nCpf++; vtCpf += x.vt; }
      for (const v of x.vends) { const a = pv(v); a.cupons++; if (temCpf) a.cpf++; }
    }
    // clientes novos no período: a primeira compra foi atendida por quem?
    for (const c of TS.cli.lista) {
      if (c.primeira < dDe || c.primeira > dAte) continue;
      const k1 = c.cupons[c.cupons.length - 1];
      if (lojasOk && !lojasOk.has(k1.lojaId)) continue;
      for (const v of new Set(k1.itens.map((i) => db.D.vendedor[db.vend[i]]).filter((v) => v && !/^sem vendedor$/i.test(v)))) {
        const a = pv(v); a.novos++; if (c.visitas >= 2) a.voltaram++;
      }
    }
    const recompra = lista.length ? lista.filter((r) => r.visitas >= 2).length / lista.length : null;
    const kpis = h('div', { class: 'grid g-kpi' },
      TS.kpi('Vendas com CPF', fmt.pct(nTot ? nCpf / nTot : null, 1), `${fmt.int(nCpf)} de ${fmt.int(nTot)} cupons do período`, 'Cupons de venda em que o cliente informou o CPF (e a nota foi encontrada)'),
      TS.kpi('Ticket do cliente identificado', fmt.brl(nCpf ? vtCpf / nCpf : null), h('span', null, 'geral: ', fmt.brl(nTot ? vtTot / nTot : null))),
      TS.kpi('Recompra', fmt.pct(recompra, 0), 'dos clientes da lista compraram 2 vezes ou mais no período'),
      TS.kpi('Clientes novos no período', fmt.int(TS.cli.lista.filter((c) => c.primeira >= dDe && c.primeira <= dAte).length), 'primeira compra identificada'));
    // novos × recorrentes por mês (últimos 12 meses do período)
    const fim = Number.isFinite(dAte) ? dAte : TS.todayDay();
    const meses = [];
    { const f = new Date(fim * 864e5); for (let k = 11; k >= 0; k--) { const d = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - k, 1)); meses.push(d.toISOString().slice(0, 7)); } }
    const ymDe = (day) => new Date(day * 864e5).toISOString().slice(0, 7);
    const nov = Object.fromEntries(meses.map((m) => [m, 0])), rec = Object.fromEntries(meses.map((m) => [m, 0]));
    for (const c of TS.cli.lista) {
      const ymPrim = ymDe(c.primeira);
      const noMes = new Set();
      for (const k of c.cupons) { if (lojasOk && !lojasOk.has(k.lojaId)) continue; const ym = ymDe(k.day); if (ym in nov) noMes.add(ym); }
      for (const ym of noMes) { if (ym === ymPrim) nov[ym]++; else rec[ym]++; }
    }
    const grafico = TS.card('Clientes por mês', 'Novos (primeira compra no mês) × recorrentes — clientes identificados por CPF', TS.chart({
      type: 'bar',
      data: { labels: meses.map(TS.ymLabel), datasets: [
        { label: 'Novos', data: meses.map((m) => nov[m]), backgroundColor: '#C9A227', borderRadius: 3 },
        { label: 'Recorrentes', data: meses.map((m) => rec[m]), backgroundColor: '#2C5234', borderRadius: 3 }] },
      options: { plugins: { tooltip: { mode: 'index', intersect: false } }, scales: { x: { stacked: true, ...TS.axisCat }, y: { stacked: true, ...TS.axisNum(fmt.int) } } },
    }));
    const rows = [...porVend.values()].filter((a) => a.cupons > 0).map((a) => ({ ...a, pct: a.cupons ? a.cpf / a.cupons : null, pctVolta: a.novos ? a.voltaram / a.novos : null }));
    const tab = TS.table({
      cols: [
        { key: 'nome', label: 'Vendedora', align: 'l' },
        { key: 'cupons', label: 'Cupons', fmt: fmt.int },
        { key: 'cpf', label: 'Com CPF', fmt: fmt.int },
        { key: 'pct', label: '% com CPF', fmt: (v) => fmt.pct(v, 0) },
        { key: 'novos', label: 'Clientes novos', fmt: fmt.int },
        { key: 'voltaram', label: 'Voltaram', fmt: fmt.int },
        { key: 'pctVolta', label: '% voltaram', fmt: (v) => (v == null ? '—' : fmt.pct(v, 0)) },
      ],
      rows, sortKey: 'pct',
      total: { nome: 'Total', cupons: nTot, cpf: nCpf, pct: nTot ? nCpf / nTot : null, novos: rows.reduce((t, r) => t + r.novos, 0), voltaram: rows.reduce((t, r) => t + r.voltaram, 0) },
    });
    return [TS.section('Base de clientes'), kpis,
      h('div', { class: 'grid mt', style: { alignItems: 'start' } }, grafico,
        TS.card('Vendedoras e clientes', '% de vendas com CPF (pedir o CPF faz a base crescer) · clientes novos = primeira compra atendida por ela · voltaram = compraram de novo depois', tab))];
  }

  // ---------- ficha e ações ----------
  function fichaCliente(c, r) {
    const hoje = TS.todayDay();
    const d = (day) => fmt.date(TS.dayToIso(day));
    const varia = c.gasto12ant > 0 ? c.gasto12 / c.gasto12ant - 1 : null;
    const item = (rot, val, dica) => (val == null || val === '' ? null : h('div', { class: 'fi', title: dica || null }, h('span', null, rot), h('b', null, val)));
    const bloco = (titulo, ...itens) => { const v = itens.filter(Boolean); return v.length ? h('div', { class: 'fi-bloco' }, h('div', { class: 'fi-tit' }, titulo), ...v) : null; };
    const tel = fmtTel(c.celular);
    const prox = c.intervalo ? Math.round(c.ultima + c.intervalo) : null;
    const repor = c.proxCha == null ? null
      : c.proxCha < hoje - 45 ? null
        : c.proxCha <= hoje ? `já deve ter acabado (${d(c.proxCha)})` : `por volta de ${d(c.proxCha)}`;
    const dicaRepor = c.proxCha == null ? null : c.reporEstimado
      ? `Na última compra de chá (${d(c.ultimaCha)}) levou ${c.gramasUltima} g. Sem histórico suficiente, o painel considera ~3 g por dia (1 xícara): dura ~${c.intervaloCha} dias.`
      : `Na última compra de chá (${d(c.ultimaCha)}) levou ${c.gramasUltima} g. Pelo histórico, consome ~${fmt.n1(c.gDia)} g por dia: dura ~${c.intervaloCha} dias.`;
    return h('div', { class: 'cli-ficha' }, ...[
      bloco('Contato',
        tel ? h('div', { class: 'fi' }, h('span', null, 'Celular'), h('b', null, tel, c.wpp ? h('a', { class: 'wpp', href: TS.demo ? '#' : c.wpp, target: '_blank', rel: 'noopener', onclick: (e) => { if (TS.demo) e.preventDefault(); } }, ' WhatsApp') : null)) : null,
        item('E-mail', c.email || null),
        item('Cidade', c.cidade || null),
        item('Aniversário', c.aniv ? `${c.aniv}${c.idade != null ? ` · ${c.idade} anos` : ''}` : null)),
      bloco('Histórico',
        item('Cliente desde', d(c.primeira)),
        item('Compras', `${fmt.int(c.visitas)}${r.visitas !== c.visitas ? ` (${fmt.int(r.visitas)} no período)` : ''}`),
        item('Frequência', c.intervalo ? `a cada ~${fmt.int(Math.round(c.intervalo))} dias` : 'comprou uma vez'),
        item('Última compra', `${d(c.ultima)} · ${c.ausencia === 0 ? 'hoje' : `há ${fmt.int(c.ausencia)} dias`}`),
        prox ? item('Próxima visita esperada', prox < hoje ? `${d(prox)} (atrasada ${fmt.int(hoje - prox)} dias)` : d(prox), 'Última compra + intervalo médio entre as compras') : null),
      bloco('Preferências',
        item('Chá favorito (a granel)', c.chaFavorito),
        item('Pacote preferido', c.pacote ? `${c.pacote} g` : null),
        item('Chá deve acabar', repor, dicaRepor),
        c.proxCha != null ? h('div', { class: 'fi-nota' }, dicaRepor) : null,
        item('Mais atendida por', c.vendedora)),
      bloco('Valores',
        h('div', { class: 'fi' }, h('span', null, 'Gasto em 12 meses'), h('b', null, fmt.brl(c.gasto12), varia != null ? h('em', { class: varia >= 0 ? 'pos' : 'neg' }, ` ${fmt.delta(varia)}`) : null)),
        item('Ticket médio', fmt.brl(r.tkm)),
        item('PMA · IPA', `${fmt.brl(r.qtd ? r.vt / r.qtd : null)} · ${fmt.n2(r.visitas ? r.qtd / r.visitas : null)}`),
        item('Itens', fmt.int(r.qtd))),
    ].filter(Boolean));
  }
  const fmtTel = (cel) => {
    let d = String(cel || '').replace(/\D/g, '');
    if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d || null;
  };
  function acoesCliente(c) {
    const box = h('div', { class: 'cli-acoes' });
    const pintar = () => {
      const ct = contatoDe(c) || {};
      box.replaceChildren();
      if (ct.optout) {
        box.append(h('span', { class: 'muted' }, 'Pediu para não receber mensagens. '), h('button', { type: 'button', class: 'btn', onclick: () => agir('aceita') }, 'Voltou a aceitar'));
        return;
      }
      if (c.wpp) {
        const mods = modelosDe(lojaIdDe(c));
        const sugerido = c.tags.has('aniv') ? 'Aniversário' : c.tags.has('repor') ? 'Hora de repor' : c.tags.has('sumido') || c.tags.has('uma') ? 'Sentimos sua falta' : 'Novidades';
        const sel = h('select', { class: 'f-input', 'aria-label': 'Modelo de mensagem' }, mods.map((m, k) => h('option', { value: k, selected: m.nome === sugerido || null }, m.nome)));
        const prev = h('div', { class: 'cli-msg' });
        const atual = () => mods[+sel.value];
        const pv = () => { prev.textContent = textoWpp(atual(), c); };
        sel.addEventListener('change', pv); pv();
        box.append(h('div', { class: 'cli-wpp' }, h('span', { class: 'f-label' }, 'Mensagem pronta'), sel, prev,
          h('div', { class: 'cfg-inline' },
            h('a', { class: 'btn primary', href: '#', onclick: async (e) => {
              e.preventDefault();
              if (TS.demo) { alert('Na apresentação o WhatsApp não abre (número fictício). A mensagem seria:\n\n' + textoWpp(atual(), c)); }
              else window.open(linkWpp(c, textoWpp(atual(), c)), '_blank', 'noopener');
              try { await marcar(c, 'contatado', atual().nome); pintar(); } catch (er) { alert(er.message); }
            } }, 'Abrir no WhatsApp'),
            h('small', { class: 'muted' }, 'Ao abrir, o cliente fica marcado como contatado.'))));
      }
      box.append(h('div', { class: 'cfg-inline cli-botoes' },
        ct.em ? h('span', { class: 'muted' }, `Contatado em ${fmt.date(ct.em.slice(0, 10))}${ct.por ? ' por ' + ct.por : ''}${ct.motivo ? ' (' + ct.motivo + ')' : ''}.`) : null,
        h('button', { type: 'button', class: 'btn', onclick: () => agir('contatado', 'ligação/outro') }, ct.em ? 'Marcar contato de novo' : 'Marcar como contatado'),
        ct.em ? h('button', { type: 'button', class: 'btn', onclick: () => agir('limpar') }, 'Desfazer contato') : null,
        h('button', { type: 'button', class: 'btn ghost-danger', title: 'LGPD: a pessoa sai das listas de contato e da exportação para WhatsApp', onclick: () => { if (confirm('Marcar que este cliente NÃO quer receber mensagens?')) agir('optout'); } }, 'Não quer mensagens')));
    };
    const agir = async (acao, motivo) => { try { await marcar(c, acao, motivo); pintar(); } catch (e) { alert(e.message); } };
    pintar();
    return box;
  }

  const fmtCPF = (s) => (s && s.length === 11 ? `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`
    : s && s.length === 14 ? `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}` : s || '');

  /** para lista de transmissão / campanha: só quem tem WhatsApp e não pediu para não receber mensagens */
  function baixarCSVWpp(lista) {
    const ok = lista.filter((r) => r.c.wpp && !(contatoDe(r.c) || {}).optout);
    if (!ok.length) { alert('Nenhum cliente da lista tem WhatsApp (ou todos pediram para não receber mensagens).'); return; }
    const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const cel = (c) => { const d = c.celular.replace(/\D/g, ''); return d.startsWith('55') && d.length >= 12 ? '+' + d : '+55' + d; };
    const linhas = [['Nome', 'Celular'].join(';'), ...ok.map((r) => [r.c.nome, TS.demo ? '' : cel(r.c)].map(esc).join(';'))];
    const blob = new Blob(['\ufeff' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `whatsapp-teashop-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function baixarCSV(lista) {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const linhas = [['Nome', 'CPF', 'Celular', 'WhatsApp', 'E-mail', 'Cidade', 'Nascimento', 'Visitas', 'Total (R$)', 'Última compra', 'Dias sem comprar', 'Segmentos', 'Chá favorito', 'Aceita mensagens', 'Último contato'].join(';')];
    for (const r of lista) {
      const c = r.c, ct = contatoDe(c) || {};
      linhas.push([c.nome, fmtCPF(c.cpf), c.celular, TS.demo ? '' : c.wpp || '', c.email, c.cidade, c.nascimento ? fmt.date(c.nascimento) : '', r.visitas, r.vt.toFixed(2).replace('.', ','), c.ultima != null ? fmt.date(TS.dayToIso(c.ultima)) : '', c.ausencia ?? '',
        [...(c.tags || [])].map((t) => NOMES_SEG[t]).join(', '), c.chaFavorito || '', ct.optout ? 'Não' : 'Sim', ct.em ? fmt.date(ct.em.slice(0, 10)) : ''].map(esc).join(';'));
    }
    const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `clientes-teashop-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
})();
