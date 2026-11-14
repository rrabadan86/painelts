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
    const cliente = (cpf, nomeAlt) => {
      let c = porCPF.get(cpf);
      if (!c) {
        const info = cad.get(cpf) || {};
        const nome = (info.nome || nomeAlt || '').replace(/^[\s\-–—]+/, '').trim();
        const cel = digits(info.celular);
        const local = cel.length >= 12 && cel.startsWith('55') ? cel.slice(2) : cel; // aceita com o 55 na frente
        c = { cpf, empresa: cpf.length === 14, nome, celular: cel, wpp: local.length >= 10 && local.length <= 11 ? TS.demo ? '#demo' : 'https://wa.me/55' + local : null, nascimento: info.nascimento || null, cidade: info.cidade || '', email: info.email || '', cupons: [], semVenda: 0, divergencias: [] };
        porCPF.set(cpf, c);
      }
      return c;
    };
    const resumo = (itens) => {
      let day = null, vt = 0, qtd = 0;
      const vends = new Set();
      for (const i of itens) {
        if (day === null || db.day[i] > day) day = db.day[i];
        if (taxas.has(db.desc[i])) continue;
        vt += db.vt[i] || 0; qtd += TS.qtdItem(i); vends.add(db.D.vendedor[db.vend[i]]);
      }
      return { day, vt, qtd, vendedores: [...vends].filter(Boolean).join(', ') };
    };
    const cupomXml = new Map(); // "lojaId|dia|cupom" → { cpf, k } (cupom com CPF na nota)
    for (const x of db.xml) {
      if (!x.cpf) continue;
      const lid = lojaId.get(x.loja);
      let itens = lid === undefined ? [] : porChave.get(x.cupom + '|' + lid) || [];
      if (x.data && itens.length) {
        const d = TS.isoToDay(x.data);
        itens = itens.filter((i) => Math.abs(db.day[i] - d) <= 1);
      }
      const c = cliente(x.cpf);
      if (!itens.length) { c.semVenda++; semVendaTotal++; continue; }
      const k = { cupom: x.cupom, loja: x.loja, lojaId: lid, itens, ...resumo(itens) };
      c.cupons.push(k);
      for (const i of itens) cupomXml.set(lid + '|' + db.day[i] + '|' + x.cupom, { cpf: x.cpf, k });
    }
    // FIXE: compras do programa de fidelidade ligadas aos cupons (o FIXE não tem o número do cupom)
    const fx = TS.fx && TS.fx.tem() ? TS.fx.preparar() : null;
    const fixe = fx ? { alvos: fx.alvos, ligadas: fx.lig.length, confirmadas: 0, porFixe: 0, divergencias: [], semCupom: fx.semCupom, bases: fx.bases, movs: fx.movs } : null;
    if (fx) {
      for (const { m, c: cv } of fx.lig) {
        const x = cupomXml.get(cv.lojaId + '|' + cv.day + '|' + cv.cupom);
        if (x) {
          if (x.cpf === m.cpf) { fixe.confirmadas++; x.k.fixeOk = true; continue; }
          // a nota saiu num CPF e os pontos foram para outro
          const dv = { cupom: cv.cupom, day: cv.day, lojaId: cv.lojaId, loja: db.D.loja[cv.lojaId], vt: x.k.vt, cpfNota: x.cpf, cpfFixe: m.cpf, nomeFixe: m.nome };
          x.k.cpfFixe = m.cpf;
          fixe.divergencias.push(dv);
          cliente(m.cpf, m.nome).divergencias.push(dv);
          continue;
        }
        // cupom sem CPF na nota: o cliente vem do FIXE
        const k = { cupom: cv.cupom, loja: db.D.loja[cv.lojaId], lojaId: cv.lojaId, itens: cv.itens, origem: 'fixe', ...resumo(cv.itens) };
        cliente(m.cpf, m.nome).cupons.push(k);
        fixe.porFixe++;
      }
    }
    // vendas sem FIXE: nota no CPF de quem está no programa, depois do cadastro, e nenhum movimento no FIXE nesse dia
    // (o cliente pode ter esquecido de falar ou a loja não lançou: serve para rastrear e corrigir)
    if (fixe) {
      fixe.temLeads = (fx.bases || []).some((b) => b.membrosEm);
      fixe.temLogs = fx.logsAte != null;
      fixe.logsAte = fx.logsAte;
      fixe.semFixe = [];
      const rpp = ((fx.bases || [])[0] || {}).regras ? fx.bases[0].regras.reaisPorPonto : 50;
      for (const c of porCPF.values()) {
        if (c.empresa) continue;
        c.membroFixe = fx.membros.has(c.cpf);
        c.cadastroFixe = c.membroFixe ? fx.membros.get(c.cpf) : null;
        if (!c.membroFixe || !fixe.temLogs) continue;
        for (const k of c.cupons) {
          if (k.origem === 'fixe' || k.fixeOk || k.cpfFixe || k.day == null) continue;
          if (k.day >= fx.logsAte) continue;                               // depois da exportação dos Logs: ainda não dá para saber
          if (c.cadastroFixe != null && k.day <= c.cadastroFixe) continue; // antes de entrar no programa
          if (fx.movDia.has(c.cpf + '|' + k.day)) continue;
          k.semFixe = true;
          k.ptsPerdidos = Math.floor(k.vt / rpp + 1e-6);
          fixe.semFixe.push({ c, k });
        }
      }
    }
    const hoje = TS.todayDay();
    const lista = [];
    let soSemVenda = 0;
    const cuponsCPF = new Map(); // "cupom|lojaId" → cliente (para a % de vendas com CPF)
    const cha = TS.rules.ids.chaTotal;
    for (const c of porCPF.values()) {
      if (!c.cupons.length) { if (c.semVenda) soSemVenda++; continue; } // nenhuma compra encontrada nas vendas
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
      c.fx = fx ? fx.porCpf.get(c.cpf) || null : null;
      if (c.fx && c.fx.em30 > 0) t.add('vence');
      if (c.cupons.some((k) => k.semFixe)) t.add('semfixe');
      if (fixe && fixe.temLeads && !c.empresa && !c.membroFixe) t.add('forafixe');
      c.tags = t;
    }
    TS.cli = { lista, fixe, porCPF, fxPorCpf: fx ? fx.porCpf : null, semVendaTotal, soSemVenda, cuponsXml: db.xml.length, cuponsCPF, contatos: (TS.cli && TS.cli.contatos) || null, cidades: [...new Set(db.clientes.map((c) => c.cidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')) };
  };
  // ---------- contatos (contatado / não quer mensagens), guardados por loja no servidor ----------
  const NOMES_SEG = { hoje: 'Contatar hoje', aniv: 'Aniversário (7 dias)', sumido: 'Sumidos', repor: 'Hora de repor', vence: 'Pontos vencendo', semfixe: 'Compras sem FIXE', forafixe: 'Fora do FIXE', novo: 'Novos do mês', fiel: 'Fiéis', vip: 'VIP', uma: 'Uma compra só' };
  const DICA_SEG = {
    hoje: 'Aniversariantes da semana, sumidos, quem está na hora de repor e quem tem pontos do FIXE vencendo — sem quem já foi contatado nos últimos 30 dias ou não quer mensagens.',
    vence: 'Têm pontos do programa de fidelidade (FIXE) que vencem nos próximos 30 dias.',
    semfixe: 'Estão no FIXE, mas têm compra com CPF na nota sem nenhum lançamento no FIXE naquele dia (não informou ou não foi lançado).',
    forafixe: 'Deram o CPF na nota, mas não estão na base do FIXE desta loja: dá para convidar a se cadastrar.',
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
    { nome: 'Pontos vencendo', texto: 'Oi, {nome}! Você tem {pontos} pontos no programa de fidelidade da {loja}, e parte deles vence em {vence}. Que tal usar numa visita? 🍵' },
  ];
  const modelosDe = (lojaId) => { const m = (TS.db.metas || []).find((x) => x.id === lojaId); return (m && m.wpp && m.wpp.length ? m.wpp : TS.WPP_PADRAO); };
  const primeiroNome = (n) => { const p = String(n || '').trim().split(/\s+/)[0] || ''; return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : ''; };
  function textoWpp(modelo, c) {
    const lid = lojaIdDe(c);
    const loja = ((TS.lojas || []).find((l) => l.id === lid) || {}).nome || 'Tea Shop';
    const fx = c.fx || {};
    return modelo.texto.replace(/\{nome\}/g, primeiroNome(c.nome) || 'tudo bem').replace(/\{loja\}/g, loja).replace(/\{cha\}/g, c.chaFavorito || 'chá')
      .replace(/\{pontos\}/g, fmt.int(fx.saldo || 0)).replace(/\{vence\}/g, fx.prox != null ? fmt.date(TS.dayToIso(fx.prox)) : '—');
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
    // período das compras: o mesmo bloco das outras telas, mas guardado à parte (aqui o padrão é todo o histórico)
    const p = s.per;
    box.append(...TS.blocoPeriodo(p, rerender, { padrao: 'tudo', rotulo: 'Período',
      dica: h('small', { class: 'muted' }, p.de != null || p.ate != null || p.mes ? 'Valores, visitas e ticket só desse período. "Dias sem comprar" olha a última compra de verdade.' : `Todo o histórico (até ${fmt.date(TS.dayToIso(TS.todayDay()))}).`) }));
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

  /** o dia está no período escolhido nos Clientes? (só o mês = aquele mês em todos os anos) */
  function noPeriodoCli() {
    const p = state.cli.per;
    const de = p.de ?? -Infinity, ate = p.ate ?? Infinity, soMes = p.mes && !p.ano ? p.mes : null;
    if (de === -Infinity && ate === Infinity && !soMes) return null;
    return (day) => day >= de && day <= ate && (!soMes || new Date(day * 86400000).getUTCMonth() + 1 === soMes);
  }

  // ---------- aplicação dos filtros ----------
  function filtrar() {
    const s = state.cli, db = TS.db;
    const nome = TS.norm(s.nome), cpf = s.cpf.replace(/\D/g, ''), cupom = s.cupom.replace(/\D/g, ''), prod = TS.norm(s.produto);
    const num = (v) => (v === '' || v == null ? null : +v);
    const vMin = num(s.visMin), vMax = num(s.visMax), aMin = num(s.ausMin), aMax = num(s.ausMax);
    const filtraItens = prod || s.grupos.size;
    let prodOk = null;
    if (prod) { prodOk = new Uint8Array(db.D.descricao.length); db.D.descricao.forEach((t, i) => { if (TS.norm(t).includes(prod)) prodOk[i] = 1; }); }
    const noPer = noPeriodoCli();
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
          if (!(c.tags.has('aniv') || c.tags.has('sumido') || c.tags.has('repor') || c.tags.has('vence'))) continue;
          if (ct && (ct.optout || (ct.em && Date.now() - Date.parse(ct.em) < 30 * 864e5))) continue;
        } else if (!c.tags.has(s.seg)) continue;
      }
      if (s.cidade.size && !s.cidade.has(c.cidade)) continue;
      let cupons = c.cupons;
      if (noPer) cupons = cupons.filter((k) => noPer(k.day));
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
      const somaItens = (k) => { let v = 0, q = 0; for (const i of k.itensFiltrados) { if (taxas.has(db.desc[i])) continue; v += db.vt[i] || 0; q += TS.qtdItem(i); } return [v, q]; };
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
    if (!db.xml.length && !(TS.fx && TS.fx.tem())) { root.append(h('div', { class: 'notice' }, 'A planilha "Xml" (cupons com CPF) não foi carregada.')); return; }
    carregarContatos();
    const lista = filtrar();
    if (TS.cli.semVendaTotal) {
      const pct = TS.cli.semVendaTotal / TS.cli.cuponsXml;
      root.append(h('div', { class: 'notice' + (pct > 0.2 ? ' err' : '') },
        h('b', null, `${fmt.int(TS.cli.semVendaTotal)} cupons com CPF (${fmt.pct(pct, 0)}) não foram encontrados nas vendas`),
        ` e ficaram de fora das contas${TS.cli.soSemVenda ? ` (${fmt.int(TS.cli.soSemVenda)} CPFs só têm cupons assim)` : ''}. Normalmente são vendas fora do período importado ou números de cupom que não batem com o relatório de vendas.`));
    }

    if (TS.cli.fixe) { const cr = cartaoResgate(TS.cli.fixe); if (cr) root.append(cr); root.append(cartaoFixe(TS.cli.fixe)); }

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
      Object.entries(NOMES_SEG).filter(([k]) => !['vence', 'semfixe', 'forafixe'].includes(k) || TS.cli.fixe).map(([k, nome]) => h('button', { type: 'button', class: 'chip' + (s.seg === k ? ' on' : '') + (k === 'hoje' ? ' chip-destaque' : ''), title: DICA_SEG[k], onclick: () => { s.seg = s.seg === k ? '' : k; TS.render(); } }, nome)),
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
          c.fx && c.fx.saldo ? h('span', { class: 'cli-pts', title: c.fx.prox != null ? `Saldo no FIXE · ${fmt.int(c.fx.proxPts)} pts vencem em ${fmt.date(TS.dayToIso(c.fx.prox))}` : 'Saldo no FIXE' }, `★ ${fmt.int(c.fx.saldo)} pts`) : null,
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
      if (aberto && !body.childElementCount) body.append(...corpoCliente(c, r));
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    card.append(head, body);
    return card;
  }
  /** ficha, ações, avisos e cupons de um cliente (lista e janela) */
  function corpoCliente(c, r, destaque) {
    const db = TS.db, out = [];
    const hm = (m) => (m.min != null ? ` ${String(Math.floor(m.min / 60)).padStart(2, '0')}:${String(m.min % 60).padStart(2, '0')}` : '');
    // na janela de comparação: o que o FIXE registrou para este CPF no dia do cupom
    if (destaque && destaque.day != null && c.fx) {
      const doDia = c.fx.movs.filter((m) => m.day === destaque.day);
      out.push(h('div', { class: 'cupom-aviso fx-dia' }, h('b', null, `No FIXE em ${fmt.date(TS.dayToIso(destaque.day))}: `),
        doDia.length ? h('ul', { class: 'fi-lista' }, doDia.map((m) => h('li', { class: m.anulado ? 'anulado' : null }, h('b', null, hm(m).trim() || 'sem hora'), ' · ', TIPO_MOV[m.tipo] || m.tipo, m.pontos ? ` · ${m.pontos} pts` : '', m.produtos.length ? h('small', null, ' — ' + m.produtos.join(', ')) : null)))
          : 'nenhum movimento neste dia.'));
    }
    if (c.cupons.length) out.push(fichaCliente(c, r), destaque && destaque.cpfNota ? null : acoesCliente(c));
    else {
      const f = blocoFidelidade(c);
      out.push(h('div', { class: 'cli-ficha' }, f || h('div', { class: 'fi-bloco fi-largo' }, h('div', { class: 'fi-nota' }, 'Sem dados no FIXE.'))),
        h('p', { class: 'muted', style: { margin: '0 0 8px', fontSize: '12px' } }, 'Nenhuma compra com este CPF na nota foi encontrada nas vendas.'));
    }
    for (const dv of c.divergencias || []) out.push(h('div', { class: 'cupom-aviso' }, h('span', { class: 'cli-tag t-semfixe', style: { marginLeft: 0, marginRight: '6px' } }, 'CPF diferente no FIXE'), `Cupom ${dv.cupom} de ${fmt.date(TS.dayToIso(dv.day))} (${fmt.brl(dv.vt)}): compra feita no CPF `, cpfLink(dv.cpfNota, { cupom: dv.cupom, day: dv.day, cpfNota: dv.cpfNota }, c.cpf), ', mas foi usado o CPF deste cliente no FIXE.'));
    if (c.semVenda) out.push(h('p', { class: 'muted', style: { margin: '0 0 8px', fontSize: '12px' } }, `+ ${c.semVenda} cupom(ns) com o CPF desta pessoa não foram encontrados nas vendas (não entram nas contas).`));
    for (const k of r.cupons) {
      const itens = k.itensFiltrados || k.itens;
      const tb = h('table', { class: 'cupom-items' });
      // item a R$ 0,01 com o mesmo nome de um produto vendido normalmente = prêmio do programa de fidelidade (resgate)
      const ehPremio = TS.ehResgate;
      for (const i of itens) tb.append(h('tr', { class: TS.rules.ids.taxas.has(db.desc[i]) ? 'taxa' : ehPremio(i) ? 'premio' : null, title: TS.rules.ids.taxas.has(db.desc[i]) ? 'Taxa: não soma no valor do cliente' : null },
        h('td', null, db.D.descricao[db.desc[i]], ehPremio(i) ? h('span', { class: 'cli-tag t-premio' }, 'Resgate') : null), h('td', { class: 'r' }, `${fmt.int(db.qtd[i])} un.`), h('td', { class: 'r' }, fmt.brl(db.vt[i])), h('td', { class: 'r', style: { color: '#6B7A70' } }, db.D.vendedor[db.vend[i]])));
      const temPremio = k.itens.some(ehPremio);
      if (!itens.length) tb.append(h('tr', null, h('td', { style: { color: '#6B7A70' } }, 'Cupom sem itens na planilha de vendas.')));
      const aviso = k.cpfFixe ? h('div', { class: 'cupom-aviso' }, 'Compra feita no CPF ', fmtCPF(c.cpf), ', mas foi usado o CPF ', cpfLink(k.cpfFixe, { cupom: k.cupom, day: k.day, cpfNota: c.cpf }), ' no FIXE. Clique no CPF para comparar os dois históricos.') : null;
      const el = h('div', { class: 'cupom' + (k.cpfFixe ? ' cupom-div' : '') + (destaque && destaque.cupom === k.cupom && destaque.day === k.day ? ' cupom-destaque' : '') }, aviso,
        h('div', { class: 'cupom-head' }, h('span', null, h('b', null, `Cupom ${k.cupom}`), ' · ', k.day != null ? fmt.date(TS.dayToIso(k.day)) : 'sem data', TS.db.opts.lojas.length > 1 ? ' · ' + k.loja : '',
          temPremio ? h('span', { class: 'cli-tag t-premio', title: 'Cupom com prêmio do programa de fidelidade (item a R$ 0,01)' }, '★ Resgate') : null,
          k.origem === 'fixe' ? h('span', { class: 'cli-tag t-fixe', title: 'A nota saiu sem CPF; a compra foi ligada a este cliente pelos pontos lançados no FIXE (mesmo dia, hora e produtos).' }, 'CPF pelo FIXE') : null,
          k.fixeOk ? h('span', { class: 'cli-tag t-fixe-ok', title: 'Os pontos desta compra foram para o mesmo CPF da nota.' }, 'FIXE ✓') : null,
          k.cpfFixe ? h('span', { class: 'cli-tag t-semfixe', title: `Os pontos desta compra foram para outro CPF no FIXE (${fmtCPF(k.cpfFixe)}).` }, 'CPF diferente no FIXE') : null,
          k.semFixe ? h('span', { class: 'cli-tag t-semfixe', title: `Cliente do FIXE, nota com o CPF, mas nenhum lançamento no FIXE neste dia (não informou ou não foi lançado).${k.ptsPerdidos ? ` Deixou de ganhar ${k.ptsPerdidos} pt(s).` : ''}` }, 'Sem FIXE') : null),
          h('span', null, `${fmt.int(k.qtd)} ${k.qtd === 1 ? 'item' : 'itens'} · `, h('b', null, fmt.brl(k.vt)))),
        tb);
      out.push(el);
    }
    // compras da pessoa (pelo FIXE) que o painel não ligou a nenhum cupom: mesmo formato dos cupons, com o motivo
    if (destaque && c.fx) {
      const soltas = c.fx.movs.filter((m) => (m.tipo === 'pontos' || m.tipo === 'compra') && !m.cupom && !m.anulado && m.propria);
      if (soltas.length) out.push(h('div', { class: 'fi-tit fx-soltas-tit' }, `Compras no FIXE sem cupom ligado (${soltas.length})`));
      const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
      const cand = (x) => `${x.cupom}${x.min != null ? ` (${hhmm(x.min)}` : ' ('}${x.min != null ? ' · ' : ''}${fmt.brl(x.vt)})`;
      for (const m of soltas.slice(0, 20)) {
        const motivo = m.motivo === 'periodo' ? 'Sem vendas deste dia no painel (fora do período importado).'
          : m.motivo === 'ambiguo' ? `Mais de um cupom parecido no dia: ${m.cands.map(cand).join(', ')}. Confira qual é.`
            : m.motivo === 'usado' ? `O cupom mais parecido já foi ligado a outra compra do FIXE: ${m.cands.map(cand).join(', ')}.`
              : m.tipo === 'compra' ? 'Compra antiga importada no FIXE, só com a data: nenhum cupom do dia com esses produtos.'
                : `Nenhum cupom do dia com esses produtos e horário.${m.cands && m.cands.length ? ` Mais perto do horário: ${m.cands.map(cand).join(', ')}.` : ''}`;
        const tb = h('table', { class: 'cupom-items' });
        for (const p of m.produtos) tb.append(h('tr', null, h('td', null, p), h('td', { class: 'r', style: { color: '#6B7A70' } }, '—')));
        if (!m.produtos.length) tb.append(h('tr', null, h('td', { style: { color: '#6B7A70' } }, 'O FIXE não informou os produtos.')));
        out.push(h('div', { class: 'cupom cupom-fixe' },
          h('div', { class: 'cupom-head' },
            h('span', null, h('b', null, 'Cupom não identificado'), ' · ', fmt.date(TS.dayToIso(m.day)), m.min != null ? ' ' + hhmm(m.min) : '',
              h('span', { class: 'cli-tag t-forafixe', style: { marginLeft: '6px' }, title: motivo }, m.tipo === 'compra' ? 'Compra antiga no FIXE' : 'Só no FIXE')),
            h('span', null, m.tipo === 'pontos' ? h('b', null, `+${fmt.int(m.pontos)} pts`) : h('span', { class: 'muted' }, 'sem pontos'))),
          tb,
          h('div', { class: 'cupom-rodape' }, motivo)));
      }
      if (soltas.length > 20) out.push(h('p', { class: 'muted', style: { fontSize: '12px' } }, `+ ${soltas.length - 20} compras mais antigas no FIXE.`));
    }
    return out.filter(Boolean);
  }

  /** dados completos de um CPF para a janela (inclusive quem só existe no FIXE) */
  function clientePorCpf(cpf) {
    let c = TS.cli.porCPF && TS.cli.porCPF.get(cpf);
    const fxc = TS.cli.fxPorCpf ? TS.cli.fxPorCpf.get(cpf) : null;
    if (!c) c = { cpf, empresa: cpf.length === 14, nome: (fxc && fxc.nome) || '', celular: '', wpp: null, cupons: [], divergencias: [], tags: new Set(), semVenda: 0 };
    if (!c.fx && fxc) c.fx = fxc;
    if (!c.tags) c.tags = new Set();
    const cupons = c.cupons;
    const vt = cupons.reduce((t, k) => t + k.vt, 0), qtd = cupons.reduce((t, k) => t + k.qtd, 0);
    return { c, r: { c, cupons, visitas: cupons.length, vt, qtd, tkm: cupons.length ? vt / cupons.length : null } };
  }
  /** CPF que abre a janela do cliente */
  function cpfLink(cpf, comparar, cpfFixe) {
    return h('button', { type: 'button', class: 'cpf-link', title: comparar ? 'Ver o histórico dos dois CPFs lado a lado' : 'Ver o histórico deste CPF',
      onclick: (e) => { e.stopPropagation(); if (comparar) abrirClientes([comparar.cpfNota, cpfFixe || cpf], comparar); else abrirClientes([cpf]); } }, fmtCPF(cpf));
  }
  function abrirClientes(cpfs, destaque) {
    document.querySelector('.camada-cli')?.remove();
    const fechar = () => { camada.remove(); document.body.classList.remove('com-camada'); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    const rot = cpfs.length === 2 ? ['CPF da nota', 'CPF no FIXE'] : [null];
    const colunas = cpfs.map((cpf, j) => {
      const { c, r } = clientePorCpf(cpf);
      const ct = contatoDe(c);
      return h('div', { class: 'cli-janela-col' },
        rot[j] ? h('div', { class: 'cli-janela-rot' }, rot[j]) : null,
        h('div', { class: 'cli-janela-cab' },
          h('div', { class: 'cli-name' }, c.nome || 'Cliente sem cadastro'),
          h('div', { class: 'cli-meta' }, h('span', null, fmtCPF(c.cpf)),
            c.fx && c.fx.saldo ? h('span', { class: 'cli-pts' }, `★ ${fmt.int(c.fx.saldo)} pts`) : null,
            ...[...c.tags].map((t) => h('span', { class: 'cli-tag t-' + t, title: DICA_SEG[t] }, NOMES_SEG[t])),
            ct && ct.optout ? h('span', { class: 'cli-tag t-optout' }, 'não quer mensagens') : null),
          c.cupons.length ? h('div', { class: 'cli-meta' }, `${fmt.int(r.visitas)} compras · ${fmt.brl0(r.vt)} · última ${fmt.date(TS.dayToIso(c.ultima ?? c.cupons[0].day))}`) : null),
        ...corpoCliente(c, r, destaque || { cupom: null }).filter(Boolean));
    });
    const caixa = h('div', { class: 'card card-cheio fech-modal cli-janela' + (cpfs.length === 2 ? ' dupla' : '') },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      h('div', { class: 'fech-modal-topo' }, h('b', null, cpfs.length === 2 ? `Cupom ${destaque.cupom} de ${fmt.date(TS.dayToIso(destaque.day))}: nota num CPF, pontos em outro` : 'Histórico do cliente')),
      h('div', { class: 'cli-janela-cols' }, ...colunas));
    const camada = h('div', { class: 'camada-cheia camada-cli', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === camada) fechar(); } }, caixa);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', esc);
    const alvo = caixa.querySelector('.cupom-destaque');
    if (alvo) setTimeout(() => alvo.scrollIntoView({ block: 'center' }), 50);
  }
  // ---------- quem leva X também leva ----------
  function cartaoLevamJunto() {
    const s = state.cli, db = TS.db;
    const q = TS.norm(s.produto);
    if (!q) return null;
    const noPer = noPeriodoCli() || (() => true);
    const taxas = TS.rules.ids.taxas;
    const alvo = new Uint8Array(db.D.descricao.length);
    db.D.descricao.forEach((t, i) => { if (TS.norm(t).includes(q)) alvo[i] = 1; });
    const porCupom = new Map(); // cupons do período que têm o produto
    for (let i = 0; i < db.n; i++) {
      if (!noPer(db.day[i])) continue;
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
    const noPer = noPeriodoCli() || (() => true);
    const taxas = TS.rules.ids.taxas;
    const lojasOk = s.lojas.size ? s.lojas : null;
    // todas as vendas do período: cupons por vendedora e com/sem CPF
    const cupons = new Map(); // "cupom|loja" → { vt, vends:Set }
    for (let i = 0; i < db.n; i++) {
      if (!noPer(db.day[i])) continue;
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
    const pv = (v) => { let a = porVend.get(v); if (!a) porVend.set(v, (a = { nome: v, cupons: 0, cpf: 0, novos: 0, voltaram: 0, cliFixe: 0, semFixe: 0 })); return a; };
    for (const [k, x] of cupons) {
      const temCpf = TS.cli.cuponsCPF.has(k);
      nTot++; vtTot += x.vt;
      if (temCpf) { nCpf++; vtCpf += x.vt; }
      for (const v of x.vends) { const a = pv(v); a.cupons++; if (temCpf) a.cpf++; }
    }
    // clientes novos no período: a primeira compra foi atendida por quem?
    for (const c of TS.cli.lista) {
      if (c.primeira == null || !noPer(c.primeira)) continue;
      const k1 = c.cupons[c.cupons.length - 1];
      if (lojasOk && !lojasOk.has(k1.lojaId)) continue;
      for (const v of new Set(k1.itens.map((i) => db.D.vendedor[db.vend[i]]).filter((v) => v && !/^sem vendedor$/i.test(v)))) {
        const a = pv(v); a.novos++; if (c.visitas >= 2) a.voltaram++;
      }
    }
    // compras de clientes do FIXE (entre o cadastro e a data dos Logs) e quantas passaram sem FIXE
    const fxi = TS.cli.fixe;
    const comFixe = !!(fxi && fxi.temLogs);
    if (comFixe) {
      for (const c of TS.cli.lista) {
        if (!c.membroFixe) continue;
        for (const k of c.cupons) {
          if (!noPer(k.day) || k.day >= fxi.logsAte || (c.cadastroFixe != null && k.day <= c.cadastroFixe)) continue;
          if (lojasOk && !lojasOk.has(k.lojaId)) continue;
          for (const v of new Set(k.itens.map((i) => db.D.vendedor[db.vend[i]]).filter((v) => v && !/^sem vendedor$/i.test(v)))) { const a = pv(v); a.cliFixe++; if (k.semFixe) a.semFixe++; }
        }
      }
    }
    const recompra = lista.length ? lista.filter((r) => r.visitas >= 2).length / lista.length : null;
    const kpis = h('div', { class: 'grid g-kpi' },
      TS.kpi('Vendas com CPF', fmt.pct(nTot ? nCpf / nTot : null, 1), `${fmt.int(nCpf)} de ${fmt.int(nTot)} cupons do período`, 'Cupons de venda em que o cliente informou o CPF (e a nota foi encontrada)'),
      TS.kpi('Ticket do cliente identificado', fmt.brl(nCpf ? vtCpf / nCpf : null), h('span', null, 'geral: ', fmt.brl(nTot ? vtTot / nTot : null))),
      TS.kpi('Recompra', fmt.pct(recompra, 0), 'dos clientes da lista compraram 2 vezes ou mais no período'),
      TS.kpi('Clientes novos no período', fmt.int(TS.cli.lista.filter((c) => c.primeira != null && noPer(c.primeira)).length), 'primeira compra identificada'));
    // novos × recorrentes por mês (últimos 12 meses do período)
    const fim = state.cli.per.ate ?? TS.todayDay();
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
    const rows = [...porVend.values()].filter((a) => a.cupons > 0).map((a) => ({ ...a, pct: a.cupons ? a.cpf / a.cupons : null, pctVolta: a.novos ? a.voltaram / a.novos : null, pctSemFixe: a.cliFixe ? a.semFixe / a.cliFixe : null }));
    const tab = TS.table({
      cols: [
        { key: 'nome', label: 'Vendedora', align: 'l' },
        { key: 'cupons', label: 'Cupons', fmt: fmt.int },
        { key: 'cpf', label: 'Com CPF', fmt: fmt.int },
        { key: 'pct', label: '% com CPF', fmt: (v) => fmt.pct(v, 0) },
        { key: 'novos', label: 'Clientes novos', fmt: fmt.int },
        { key: 'voltaram', label: 'Voltaram', fmt: fmt.int },
        { key: 'pctVolta', label: '% voltaram', fmt: (v) => (v == null ? '—' : fmt.pct(v, 0)) },
        ...(comFixe ? [
          { key: 'semFixe', label: 'Sem FIXE', fmt: fmt.int },
          { key: 'pctSemFixe', label: '% sem FIXE', fmt: (v) => (v == null ? '—' : fmt.pct(v, 0)) },
        ] : []),
      ],
      rows, sortKey: 'pct',
      total: { nome: 'Total', cupons: nTot, cpf: nCpf, pct: nTot ? nCpf / nTot : null, novos: rows.reduce((t, r) => t + r.novos, 0), voltaram: rows.reduce((t, r) => t + r.voltaram, 0),
        ...(comFixe ? (() => { const cf = rows.reduce((t, r) => t + r.cliFixe, 0), sf = rows.reduce((t, r) => t + r.semFixe, 0); return { semFixe: sf, pctSemFixe: cf ? sf / cf : null }; })() : {}) },
    });
    return [TS.section('Base de clientes'), kpis,
      h('div', { class: 'grid mt', style: { alignItems: 'start' } }, grafico,
        TS.card('Vendedoras e clientes', '% de vendas com CPF (pedir o CPF faz a base crescer) · clientes novos = primeira compra atendida por ela · voltaram = compraram de novo depois' + (comFixe ? ' · sem FIXE = compras de clientes do FIXE sem lançamento no dia (o cliente pode não ter informado)' : ''), tab))];
  }

  // ---------- ficha e ações ----------
  function fichaCliente(c, r) {
    const hoje = TS.todayDay();
    const d = (day) => fmt.date(TS.dayToIso(day));
    const varia = c.gasto12ant > 0 ? c.gasto12 / c.gasto12ant - 1 : null;
    const item = (rot, val, dica) => (val == null || val === '' ? null : h('div', { class: 'fi' }, h('span', null, rot, TS.dica(dica)), h('b', null, val)));
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
      blocoFidelidade(c),
    ].filter(Boolean));
  }
  // ---------- fidelidade (FIXE) ----------
  const TIPO_MOV = { pontos: 'Pontos da compra', compra: 'Compra (histórico antigo)', resgate: 'Resgate', expirou: 'Pontos expirados', cancelado: 'Operação cancelada', boasvindas: 'Boas-vindas', outro: 'Outro' };
  function blocoFidelidade(c) {
    const f = c.fx;
    const d = (day) => fmt.date(TS.dayToIso(day));
    const item = (rot, val, dica) => (val == null || val === '' ? null : h('div', { class: 'fi' }, h('span', null, rot, TS.dica(dica)), h('b', null, val)));
    const sem = c.cupons.filter((k) => k.semFixe);
    const linhaSem = sem.length ? item('Compras sem FIXE', `${fmt.int(sem.length)}${sem.reduce((t, k) => t + k.ptsPerdidos, 0) ? ` · ${fmt.int(sem.reduce((t, k) => t + k.ptsPerdidos, 0))} pts não lançados` : ''}`, 'Compras com o CPF na nota sem lançamento no FIXE no dia. Os cupons estão marcados "Sem FIXE" abaixo.') : null;
    if (!f) {
      if (c.tags && c.tags.has('forafixe')) return h('div', { class: 'fi-bloco fi-largo' }, h('div', { class: 'fi-tit' }, 'Fidelidade (FIXE)'), h('div', { class: 'fi-nota' }, 'Não está na base do FIXE desta loja. Dá para convidar a se cadastrar e começar a pontuar.'));
      if (c.membroFixe) return h('div', { class: 'fi-bloco fi-largo' }, h('div', { class: 'fi-tit' }, 'Fidelidade (FIXE)'),
        item('No programa desde', c.cadastroFixe != null ? d(c.cadastroFixe) : 'cadastrado'), item('Saldo de pontos', '0 (sem movimentos nos Logs)'), linhaSem);
      return null;
    }
    const outras = f.movs.filter((m) => (m.tipo === 'pontos' || m.tipo === 'compra') && !m.propria && !m.anulado);
    const ult = f.movs.slice(0, 5);
    const regras = (f.movs[0] && f.movs[0].base.regras) || { reaisPorPonto: 50, validadeMeses: 12 };
    return h('div', { class: 'fi-bloco fi-largo' }, h('div', { class: 'fi-tit' }, 'Fidelidade (FIXE)'),
      item('Saldo de pontos', fmt.int(f.saldo), `Pontos ganhos que ainda valem (cada lote vale ${regras.validadeMeses} meses), menos resgates e expirações, do mais antigo para o mais novo.`),
      f.prox != null ? item('Próximo vencimento', `${fmt.int(f.proxPts)} pts em ${d(f.prox)}`) : null,
      f.em30 ? item('Vencem em 30 dias', `${fmt.int(f.em30)} pts`) : null,
      item('Ganhos · resgatados · expirados', `${fmt.int(f.ganhos)} · ${fmt.int(f.resgatados)} · ${fmt.int(f.expirados)}`),
      c.cadastroFixe != null ? item('No programa desde', d(c.cadastroFixe)) : null,
      linhaSem,
      f.vencidosSemBaixa ? h('div', { class: 'fi-nota' }, `${fmt.int(f.vencidosSemBaixa)} pts já passaram da validade e ainda não aparecem como expirados no FIXE (não entram no saldo).`) : null,
      outras.length ? h('div', { class: 'fi-sub' }, h('div', { class: 'fi-tit2' }, `Compras em outras lojas da rede (${outras.length})`),
        h('ul', { class: 'fi-lista' }, outras.slice(0, 6).map((m) => h('li', null, h('b', null, d(m.day)), ' · ', m.loja, m.produtos.length ? h('small', null, ' — ' + m.produtos.slice(0, 3).join(', ') + (m.produtos.length > 3 ? '…' : '')) : null)))) : null,
      ult.length ? h('div', { class: 'fi-sub' }, h('div', { class: 'fi-tit2' }, 'Últimos movimentos'),
        h('ul', { class: 'fi-lista' }, ult.map((m) => h('li', { class: m.anulado ? 'anulado' : null, title: m.anulado ? 'Cancelado no PDV logo depois' : null },
          h('b', null, d(m.day)), m.min != null ? ` ${String(Math.floor(m.min / 60)).padStart(2, '0')}:${String(m.min % 60).padStart(2, '0')}` : '', ' · ', TIPO_MOV[m.tipo] || m.tipo,
          m.pontos ? h('strong', { class: m.tipo === 'resgate' || m.tipo === 'expirou' ? 'neg' : 'pos' }, ` ${m.tipo === 'resgate' || m.tipo === 'expirou' ? '−' : '+'}${m.pontos}`) : null,
          m.propria ? '' : h('small', null, ' · ' + m.loja))))) : null);
  }
  function csv(nome, cab, linhas) {
    const esc = (v) => { const t = v == null ? '' : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const blob = new Blob(['﻿' + [cab, ...linhas].map((l) => l.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${nome}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  // ---------- resgate de pontos: dos clientes que chegaram ao mínimo para resgatar, quantos resgataram no prazo ----------
  function cartaoResgate(fx) {
    if (!fx.movs || !fx.movs.length) return null;
    const rg = (fx.bases.find((b) => b.ev && b.ev.length) || {}).regras || {};
    const min = rg.minResgate || 6, prazo = rg.prazoResgate || 90;
    const ate = fx.logsAte ?? TS.todayDay();
    const noPer = noPeriodoCli() || (() => true);
    // um ciclo por cliente: o primeiro em que ficou elegível dentro do período
    const porCpf = new Map();
    for (const c of TS.fx.resgates(fx.movs, { min, prazo, ate })) if (noPer(c.E) && !porCpf.has(c.cpf)) porCpf.set(c.cpf, c);
    const cs = [...porCpf.values()];
    const sim = cs.filter((c) => c.res === 'sim'), nao = cs.filter((c) => c.res === 'nao'), ab = cs.filter((c) => c.res === 'aberto');
    const fechados = sim.length + nao.length;
    const dias = sim.map((c) => c.dias).sort((a, b) => a - b);
    const mediana = dias.length ? (dias.length % 2 ? dias[(dias.length - 1) / 2] : (dias[dias.length / 2 - 1] + dias[dias.length / 2]) / 2) : null;
    // pontos que se moveram no período (ganhos, resgatados, expirados)
    let ganhos = 0, resg = 0, exp = 0;
    for (const m of fx.movs) {
      if (m.anulado || !noPer(m.day)) continue;
      if ((m.tipo === 'pontos' || m.tipo === 'boasvindas') && m.pontos > 0) ganhos += m.pontos;
      else if (m.tipo === 'resgate') resg += m.pontos;
      else if (m.tipo === 'expirou') exp += m.pontos;
    }
    const stat = (rot, val, sub, dica, cls) => h('div', { class: 'fx-stat' + (cls ? ' ' + cls : '') }, h('span', null, rot, TS.dica(dica)), h('b', null, val), sub ? h('small', null, sub) : null);
    const grupo = (titulo, ...itens) => h('div', { class: 'fx-grupo' }, h('div', { class: 'fx-grupo-tit' }, titulo), h('div', { class: 'fx-stats' }, ...itens.filter(Boolean)));
    const taxa = fechados ? sim.length / fechados : null;
    // ---- retorno do programa: o que a loja devolveu em prêmios (no caixa os prêmios saem a R$ 0,01)
    const db = TS.db, rpp = rg.reaisPorPonto || 50;
    // o prêmio sai a R$ 0,01 com o mesmo nome do produto normal; a R$ 0,01 com outro nome (ex.: brinde de promoção) não é resgate
    const chaveNome = TS.nomeChave;
    const precoNormal = new Map(); // nome sem "fidelidade" → Map(preço → peso) das vendas normais
    const linhaNormal = new Map(); // nome sem "fidelidade" → última linha vendida normalmente (para o custo)
    const premios = [];
    let fat = 0;
    const desdeAno = TS.todayDay() - 365;
    for (let i = 0; i < db.n; i++) {
      const vu = db.vu[i];
      if (vu != null && Math.abs(vu - 0.01) < 1e-7) { if (noPer(db.day[i]) && db.qtd[i] > 0 && TS.ehResgate(i)) premios.push(i); continue; }
      if (noPer(db.day[i]) && !TS.rules.ids.taxas.has(db.desc[i])) fat += db.vt[i] || 0;
      if (vu >= 0.05 && db.qtd[i] > 0) {
        const k = chaveNome(db.D.descricao[db.desc[i]]);
        // preço do último ano; produto que só vendeu antes disso usa o preço mais antigo (peso menor)
        let m = precoNormal.get(k); if (!m) precoNormal.set(k, (m = new Map()));
        const pv = Math.round(vu * 100) / 100; m.set(pv, (m.get(pv) || 0) + db.qtd[i] * (db.day[i] >= desdeAno ? 1000 : 1));
        const u = linhaNormal.get(k); if (u == null || db.day[i] >= db.day[u]) linhaNormal.set(k, i);
      }
    }
    const moda = (m) => { let b = null, n = -1; for (const [v, q] of m) if (q > n) { b = v; n = q; } return b; };
    // produto normal do prêmio: mesmo nome; se o prêmio vem sem o tamanho ("Pu Erh Original Fidelidade"), o mais barato
    // dos produtos que começam com esse nome ("Pu Erh Original 50G")
    const parDe = new Map();
    const par = (i) => {
      const k = chaveNome(db.D.descricao[db.desc[i]]);
      if (parDe.has(k)) return parDe.get(k);
      let r = precoNormal.has(k) ? k : null;
      if (!r) { let best = null; for (const [kk, m] of precoNormal) if (kk.startsWith(k + ' ')) { const v = moda(m); if (best == null || v < best[1]) best = [kk, v]; } r = best && best[0]; }
      parDe.set(k, r);
      return r;
    };
    let valorPremios = 0, nPremios = 0, semPar = 0;
    for (const i of premios) {
      nPremios += db.qtd[i];
      const k = par(i);
      if (k) valorPremios += moda(precoNormal.get(k)) * db.qtd[i]; else semPar += db.qtd[i];
    }
    const compras = ganhos * rpp; // compras que geraram pontos
    const prometido = resg ? valorPremios / (resg * rpp) : null; // valor do prêmio ÷ gasto que os pontos representam
    const diasPer = (() => { const pp = state.cli.per; const de = pp.de ?? db.minDay, a = pp.ate ?? db.maxDay; return pp.mes && !pp.ano ? 31 : a - de + 1; })();
    const curto = diasPer < 180;
    const custoBox = h('b', null, '…'), custoSub = h('small', null, 'calculando o custo dos prêmios');
    const custoPctFat = h('small', null);
    const retornoGrupo = premios.length ? h('div', { class: 'fx-grupo' }, h('div', { class: 'fx-grupo-tit' }, 'Retorno do programa (prêmios entregues no período)'),
      curto ? h('div', { class: 'notice rs-aviso' }, `Período curto (${fmt.int(diasPer)} dias): os resgates de agora vêm de pontos ganhos meses antes, então o retorno oscila. Para um número confiável use 12 meses.`) : null,
      h('div', { class: 'fx-stats' },
        stat('Prometido no resgate', prometido == null ? '—' : fmt.pct(prometido, 1), `valor do prêmio ÷ gasto de R$ ${fmt.int(rpp)} por ponto`, `Quanto o cliente recebe quando resgata: valor dos prêmios ÷ (pontos resgatados × R$ ${rpp}). Comparável à tabela de prêmios da franquia.`),
        stat('Retorno efetivo ao cliente', compras ? fmt.pct(valorPremios / compras, 1) : '—', fat ? `${fmt.pct(valorPremios / fat, 1)} do faturamento total` : null, `Valor de venda dos prêmios entregues ÷ compras que geraram pontos no período (pontos ganhos × R$ ${rpp}). Menor que o prometido porque nem todos resgatam e pontos vencem. Abaixo: o mesmo valor sobre todo o faturamento da loja.`, 'ok'),
        h('div', { class: 'fx-stat ok' }, h('span', null, 'Custo real para a loja', TS.dica('Custo dos produtos dados como prêmio (o que a loja gastou de fato) ÷ compras que geraram pontos. Abaixo: sobre todo o faturamento.')), custoBox, custoSub, custoPctFat)),
      h('small', { class: 'muted' }, `${fmt.int(nPremios)} prêmios saíram no caixa (R$ 0,01 com o nome de um produto vendido normalmente ou com "Fidelidade" no nome; valor de venda ${fmt.brl0(valorPremios)}${semPar ? `, ${fmt.int(semPar)} sem produto correspondente para dar preço` : ''}) · ${fmt.int(resg)} pontos resgatados no FIXE · compras que geraram pontos: ${fmt.brl0(compras)} · faturamento: ${fmt.brl0(fat)}.`)) : null;
    if (retornoGrupo) {
      const semAcesso = () => { custoBox.textContent = '—'; custoSub.textContent = 'sem acesso ao estoque e custos'; };
      if (TS.custosLoja) TS.custosLoja().then((M) => {
        if (!M) return semAcesso();
        let c = 0, sem = 0;
        for (const i of premios) {
          // custo do próprio prêmio no estoque; se não tiver, o custo unitário do produto normal (mesmo nome sem "fidelidade")
          let x = M.custo(i);
          if (x == null) { const pk = par(i), j = pk ? linhaNormal.get(pk) : null; const cj = j != null ? M.custo(j) : null; if (cj != null && db.qtd[j] > 0) x = (cj / db.qtd[j]) * db.qtd[i]; }
          if (x == null) sem += db.qtd[i]; else c += x;
        }
        custoBox.textContent = compras ? fmt.pct(c / compras, 1) : '—';
        custoSub.textContent = `${fmt.brl0(c)} em prêmios${sem ? ` (${fmt.int(sem)} sem custo, fora)` : ''}`;
        custoPctFat.textContent = fat ? `${fmt.pct(c / fat, 1)} do faturamento total` : '';
      }).catch(semAcesso); else semAcesso();
    }
    const card = TS.card('Resgate de pontos', `Clientes que chegaram a ${fmt.int(min)} pontos (o mínimo para resgatar) no período · resgatou = fez um resgate em até ${fmt.int(prazo)} dias${fx.logsAte != null ? ` · logs do FIXE até ${fmt.date(TS.dayToIso(fx.logsAte))}` : ''}`,
      cs.length ? h('div', null,
        h('div', { class: 'rs-topo' },
          h('div', { class: 'rs-num' }, h('b', null, taxa == null ? '—' : fmt.pct(taxa, 0)), h('span', null, 'resgatam')),
          h('p', null, fechados ? `${fmt.int(sim.length)} de ${fmt.int(fechados)} clientes que chegaram a ${fmt.int(min)} pontos resgataram em até ${fmt.int(prazo)} dias.` : `Ninguém completou ainda os ${fmt.int(prazo)} dias de prazo.`,
            ab.length ? h('span', { class: 'muted' }, ` ${fmt.int(ab.length)} ${ab.length === 1 ? 'cliente ainda está' : 'clientes ainda estão'} no prazo e não entram na conta.`) : null)),
        grupo('Clientes',
          stat('Resgataram', fmt.int(sim.length), mediana != null ? `em ${fmt.int(Math.round(mediana))} dias (mediana)` : null, `Fizeram um resgate até ${prazo} dias depois de chegar a ${min} pontos`, 'ok'),
          stat('Não resgataram', fmt.int(nao.length), `passaram ${fmt.int(prazo)} dias sem resgate`, 'Chegaram ao mínimo e não resgataram dentro do prazo (alguns podem ter resgatado depois)', nao.length ? 'alerta' : null),
          stat('Ainda no prazo', fmt.int(ab.length), 'ficam fora do %', 'Chegaram ao mínimo há menos dias que o prazo: ainda podem resgatar')),
        grupo('Pontos no período',
          stat('Ganhos', fmt.int(ganhos), 'compras e boas-vindas'),
          stat('Resgatados', fmt.int(resg), ganhos ? `${fmt.pct(resg / ganhos, 0)} dos ganhos` : null),
          stat('Expirados', fmt.int(exp), ganhos ? `${fmt.pct(exp / ganhos, 0)} dos ganhos` : null, 'Pontos que venceram sem uso', exp ? 'alerta' : null)),
        retornoGrupo,
        h('small', { class: 'muted' }, `Cada cliente conta uma vez: a primeira vez no período em que o saldo válido chegou a ${min} pontos. Mínimo e prazo ficam em Configurações → Lojas → Integrações (regras dos pontos).`))
        : TS.empty(`Nenhum cliente chegou a ${min} pontos no período.`));
    card.classList.add('fx-card');
    return card;
  }

  function cartaoFixe(fx) {
    const em = (fx.bases || []).map((b) => b.em).filter(Boolean).sort()[0];
    const nomes = (fx.bases || []).map((b) => b.lojas.filter((n, i) => b.propria[i]).join(' / ')).filter(Boolean).join(' · ');
    const sem = fx.alvos - fx.ligadas;
    const d = (day) => fmt.date(TS.dayToIso(day));
    const semFixe = (fx.semFixe || []).slice().sort((a, b) => b.k.day - a.k.day);
    const ptsSem = semFixe.reduce((t, x) => t + x.k.ptsPerdidos, 0);
    const fora = fx.temLeads ? TS.cli.lista.filter((c) => c.tags.has('forafixe')).sort((a, b) => b.ultima - a.ultima) : [];
    const detalhe = (titulo, ...corpo) => h('details', { class: 'fx-det' }, h('summary', null, titulo), ...corpo);
    const blocos = [];
    if (fx.divergencias.length) blocos.push(detalhe(`Ver as ${fmt.int(fx.divergencias.length)} compras com CPF diferente`, TS.table({
      cols: [
        { key: 'data', label: 'Data', align: 'l' }, { key: 'cupom', label: 'Cupom', align: 'l' },
        { key: 'nota', label: 'CPF da nota', align: 'l', render: (r) => cpfLink(r.x.cpfNota, { cupom: r.x.cupom, day: r.x.day, cpfNota: r.x.cpfNota }, r.x.cpfFixe) }, { key: 'fixe', label: 'CPF no FIXE', align: 'l', render: (r) => cpfLink(r.x.cpfFixe, { cupom: r.x.cupom, day: r.x.day, cpfNota: r.x.cpfNota }) }, { key: 'nome', label: 'Nome no FIXE', align: 'l' }, { key: 'vt', label: 'Valor', fmt: fmt.brl },
      ],
      rows: fx.divergencias.map((x) => ({ data: d(x.day), dia: x.day, cupom: String(x.cupom), nota: fmtCPF(x.cpfNota), fixe: fmtCPF(x.cpfFixe), nome: x.nomeFixe || '—', vt: x.vt, x })),
      sortKey: 'dia',
      onRowClick: (row) => abrirClientes([row.x.cpfNota, row.x.cpfFixe], { cupom: row.x.cupom, day: row.x.day, cpfNota: row.x.cpfNota }),
    })));
    if (semFixe.length) {
      const linhas = semFixe.map(({ c, k }) => ({ data: d(k.day), dia: k.day, cupom: String(k.cupom), nome: c.nome || '—', cpf: fmtCPF(c.cpf), cpfN: c.cpf, vt: k.vt, pts: k.ptsPerdidos, vend: k.vendedores || '—', k }));
      blocos.push(detalhe(`Ver as ${fmt.int(semFixe.length)} vendas sem FIXE`,
        h('p', { class: 'muted' }, 'A nota saiu com o CPF de quem está no FIXE (depois do cadastro), mas o FIXE não tem nenhum movimento desse CPF no dia. Pode ser que o cliente não tenha informado ou que a compra não tenha sido lançada. Serve para conferir e, se o FIXE permitir, lançar os pontos.'),
        h('div', { class: 'cfg-acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => csv('vendas-sem-fixe', ['Data', 'Cupom', 'Cliente', 'CPF', 'Valor (R$)', 'Pontos não lançados', 'Vendedora'], linhas.map((r) => [r.data, r.cupom, r.nome, r.cpf, r.vt.toFixed(2).replace('.', ','), r.pts, r.vend])) }, 'Baixar lista (CSV)')),
        TS.table({
          cols: [{ key: 'data', label: 'Data', align: 'l' }, { key: 'cupom', label: 'Cupom', align: 'l' }, { key: 'nome', label: 'Cliente', align: 'l' }, { key: 'cpf', label: 'CPF', align: 'l', render: (r) => cpfLink(r.cpfN) },
            { key: 'vt', label: 'Valor', fmt: fmt.brl }, { key: 'pts', label: 'Pontos', fmt: fmt.int }, { key: 'vend', label: 'Vendedora', align: 'l' }],
          rows: linhas, sortKey: 'dia', onRowClick: (r) => abrirClientes([r.cpfN], { cupom: r.k.cupom, day: r.k.day }),
        })));
    }
    if (fora.length) {
      const linhas = fora.map((c) => { const ct = contatoDe(c) || {}; return { nome: c.nome || '—', cpf: fmtCPF(c.cpf), cpfN: c.cpf, cel: ct.optout ? 'não quer mensagens' : fmtTel(c.celular) || '—', compras: c.visitas, ultima: d(c.ultima), dia: c.ultima, vend: c.vendedora || '—' }; });
      blocos.push(detalhe(`Ver os ${fmt.int(fora.length)} clientes fora do FIXE`,
        h('p', { class: 'muted' }, 'Deram o CPF na nota, mas não estão na base do FIXE desta loja (Base de leads). Se o cliente se cadastrou em outra loja da rede com outra base, também aparece aqui.'),
        h('div', { class: 'cfg-acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => csv('clientes-fora-do-fixe', ['Cliente', 'CPF', 'Celular', 'Compras', 'Última compra', 'Mais atendida por'], linhas.map((r) => [r.nome, r.cpf, TS.demo ? '' : r.cel, r.compras, r.ultima, r.vend])) }, 'Baixar lista (CSV)')),
        TS.table({
          cols: [{ key: 'nome', label: 'Cliente', align: 'l' }, { key: 'cpf', label: 'CPF', align: 'l', render: (r) => cpfLink(r.cpfN) }, { key: 'cel', label: 'Celular', align: 'l' }, { key: 'compras', label: 'Compras', fmt: fmt.int }, { key: 'ultima', label: 'Última compra', align: 'l' }, { key: 'vend', label: 'Mais atendida por', align: 'l' }],
          rows: linhas, sortKey: 'dia', onRowClick: (r) => abrirClientes([r.cpfN]),
        })));
    }
    blocos.push(detalhe('Como funciona',
      h('p', { class: 'muted' }, 'O FIXE não guarda o número do cupom. O painel procura, na mesma loja e no mesmo dia, o cupom com hora próxima (até 2 h), os mesmos produtos e o valor que daria os pontos lançados. Só liga quando um cupom é claramente o melhor; na dúvida, deixa sem ligar.'),
      h('p', { class: 'muted' }, `"Venda sem FIXE" só olha compras entre o cadastro do cliente no FIXE e a data dos Logs${fx.logsAte != null ? ` (${d(fx.logsAte)})` : ''}; qualquer movimento do CPF no FIXE no mesmo dia conta como venda que passou pelo FIXE.`),
      nomes ? h('p', { class: 'muted' }, `Lojas do FIXE consideradas desta loja: ${nomes}. As outras aparecem como "outras lojas da rede" na ficha do cliente.`) : null));
    const stat = (rot, val, sub, dica, cls) => h('div', { class: 'fx-stat' + (cls ? ' ' + cls : '') }, h('span', null, rot, TS.dica(dica)), h('b', null, val), sub ? h('small', null, sub) : null);
    const grupo = (titulo, ...itens) => { const v = itens.filter(Boolean); return v.length ? h('div', { class: 'fx-grupo' }, h('div', { class: 'fx-grupo-tit' }, titulo), h('div', { class: 'fx-stats' }, ...v)) : null; };
    const card = TS.card('Fidelidade (FIXE)', `Compras do programa de fidelidade ligadas aos cupons de venda${em ? ` · logs de ${fmt.date(em.slice(0, 10))}` : ''} · clique num CPF para ver o histórico`,
      fx.temLogs ? grupo('Ligação das compras do FIXE aos cupons',
        stat('Compras no FIXE', fmt.int(fx.alvos), 'nesta loja, no período das vendas', 'Movimentos de compra do FIXE desta loja em dias que têm vendas no painel'),
        stat('Cupom confirmado', fmt.int(fx.confirmadas), 'mesmo CPF na nota e no FIXE', null, 'ok'),
        stat('Cliente achado pelo FIXE', fmt.int(fx.porFixe), 'nota sem CPF', 'A nota saiu sem CPF: a compra passou a contar para o cliente do FIXE', 'ok'),
        stat('Sem cupom', fmt.int(sem), sem && fx.alvos ? fmt.pct(sem / fx.alvos, 0) + ' das compras do FIXE' : null, 'Não achou um cupom claramente igual (hora ou produtos diferentes, ou mais de um parecido)')) : null,
      grupo('Para conferir e corrigir',
        fx.temLogs ? stat('CPF diferente', fmt.int(fx.divergencias.length), 'nota num CPF, pontos em outro', 'Compra feita num CPF, mas foi usado outro CPF no FIXE', 'alerta') : null,
        fx.temLogs ? stat('Vendas sem FIXE', fmt.int(semFixe.length), ptsSem ? `${fmt.int(ptsSem)} pts não lançados` : 'sem lançamento no dia', 'Nota no CPF de quem está no FIXE e nenhum movimento no FIXE no dia', 'alerta') : null,
        fx.temLeads ? stat('Fora do FIXE', fmt.int(fora.length), 'deram CPF, não estão na base', 'Clientes com CPF na nota que não estão na Base de leads do FIXE desta loja') : null),
      h('div', { class: 'fx-dets' }, ...blocos));
    card.classList.add('fx-card');
    return card;
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
