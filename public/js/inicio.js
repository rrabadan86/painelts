/* Início: o que pede atenção hoje, numa tela só. Cada aviso leva à tela certa.
 * - Vendas: o último dia com venda × a média do mesmo dia da semana; o mês até agora × a meta.
 * - Estoque (quem vê Estoque ou Pedido, com uma loja escolhida): chás a granel abaixo de 500 g e Estrela abaixo de 700 g
 *   que venderam nos últimos 90 dias, e produtos que acabaram e venderam nos últimos 30 dias.
 * - Site (quem vê o Site): mudanças de preço e promoção desde a consulta anterior.
 * - Atualizações (admin e franqueado): coletas que falharam nas últimas 48 h; vendas atrasadas. */
(function () {
  const { h, fmt, state } = TS;

  TS.pages.inicio = function (root) {
    const nome = String((TS.eu && (TS.eu.nome || TS.eu.usuario)) || '').split(' ')[0];
    const hora = new Date().getHours();
    root.append(h('div', { class: 'page-head' }, h('div', null,
      h('h1', { class: 'page-title' }, `${hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'}${nome ? ', ' + nome : ''}`),
      h('div', { class: 'page-sub' }, 'O que pede atenção hoje. Clique num aviso para ir à tela certa.'))));
    const avisos = h('div', { class: 'ini-avisos' });
    const pend = h('div', { class: 'muted ini-pend' }, 'Conferindo estoque, site e atualizações…');
    root.append(blocoVendas(), h('div', { class: 'mt' }, h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Avisos'), avisos, pend)));
    const lista = [];
    const pintar = () => {
      const ord = { erro: 0, warn: 1, info: 2, ok: 3 };
      lista.sort((a, b) => ord[a.nivel] - ord[b.nivel]);
      avisos.replaceChildren(...(lista.length ? lista.map(item) : [h('p', { class: 'muted' }, 'Nada pedindo atenção por enquanto. 👏')]));
    };
    const tarefas = [avisosVendas(lista), avisosEstoque(lista), avisosSite(lista), avisosAtualizacoes(lista)].map((p) => p.catch(() => null).then(() => { if (avisos.isConnected) pintar(); }));
    Promise.all(tarefas).then(() => pend.remove());
  };

  function item(a) {
    const ir = () => { if (a.antes) a.antes(); if (a.link) location.hash = a.link; if (a.acao) a.acao(); };
    return h('div', { class: 'ini-aviso ini-' + a.nivel, role: a.link || a.acao ? 'button' : null, tabindex: a.link || a.acao ? '0' : null, onclick: a.link || a.acao ? ir : null, onkeydown: (e) => { if ((a.link || a.acao) && e.key === 'Enter') ir(); } },
      h('span', { class: 'ini-ico' }, { erro: '!', warn: '•', info: 'i', ok: '✓' }[a.nivel]),
      h('div', null, h('b', null, a.titulo), a.texto ? h('div', { class: 'muted' }, a.texto) : null),
      a.link || a.acao ? h('span', { class: 'ini-ir' }, a.ir || 'abrir ›') : null);
  }

  // ---------- vendas ----------
  function somaDias(de, ate) {
    const idx = TS.filtrar({ de, ate, ignorar: ['vendedores', 'grupos', 'cats', 'produto'], mesLivre: true });
    const taxas = TS.rules.ids.taxas;
    let vt = 0; const cup = new Set();
    for (const i of idx) { if (taxas.has(TS.db.desc[i])) continue; vt += TS.db.vt[i] || 0; cup.add(TS.db.loja[i] + '|' + TS.db.cupom[i]); }
    return { vt, cupons: cup.size };
  }
  function blocoVendas() {
    const db = TS.db;
    if (!db || !db.n) return h('div');
    const d = db.maxDay;
    const ult = somaDias(d, d);
    const ant = [7, 14, 21, 28].map((k) => somaDias(d - k, d - k)).filter((x) => x.vt > 0);
    const media = ant.length ? ant.reduce((a, x) => a + x.vt, 0) / ant.length : null;
    const ym = TS.dayToIso(d).slice(0, 7), ini = TS.isoToDay(ym + '-01');
    const mes = somaDias(ini, d);
    const meta = TS.metaCalc(ym).valor;
    const diasMes = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate(), feitos = d - ini + 1;
    const proj = feitos > 0 ? (mes.vt / feitos) * diasMes : null;
    const dia = TS.dayToIso(d);
    const nomeDia = new Date(dia + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' });
    return h('div', { class: 'grid g-kpi' },
      TS.kpi(`Vendas de ${d === TS.todayDay() ? 'hoje' : d === TS.todayDay() - 1 ? 'ontem' : fmt.date(dia)}`, fmt.brl0(ult.vt),
        media ? h('span', { class: ult.vt >= media ? 'up' : 'down' }, `${ult.vt >= media ? '+' : ''}${fmt.n1((ult.vt / media - 1) * 100)}% vs. média ${/sábado|domingo/.test(nomeDia) ? 'dos últimos' : 'das últimas'} ${nomeDia.replace(/-feira$/, 's-feiras').replace(/(sábado|domingo)$/, '$1s')}`) : `${fmt.int(ult.cupons)} cupons`,
        'Faturamento do último dia com venda no painel, comparado com a média do mesmo dia da semana nas 4 semanas anteriores'),
      TS.kpi('Mês até agora', fmt.brl0(mes.vt), meta ? `${fmt.pct(mes.vt / meta, 0)} da meta de ${fmt.brl0(meta)}` : `${fmt.int(mes.cupons)} cupons`),
      TS.kpi('Projeção do mês', proj != null ? fmt.brl0(proj) : '—', meta && proj != null ? h('span', { class: proj >= meta ? 'up' : 'down' }, proj >= meta ? 'bate a meta no ritmo atual' : `faltam ${fmt.brl0(meta - proj)} no ritmo atual`) : 'no ritmo atual',
        'Vendas do mês ÷ dias passados × dias do mês'),
      TS.kpi('Cupons no mês', fmt.int(mes.cupons), mes.cupons ? `ticket médio ${fmt.brl(mes.vt / mes.cupons)}` : ''));
  }
  async function avisosVendas(lista) {
    const db = TS.db;
    if (!db || !db.n) return;
    const atraso = TS.todayDay() - db.maxDay;
    if (atraso >= 2) lista.push({ nivel: 'warn', titulo: `As vendas no painel vão até ${fmt.date(TS.dayToIso(db.maxDay))}`, texto: 'A atualização dos últimos dias não chegou. Veja o histórico das atualizações.', acao: TS.eu && TS.eu.pode && TS.eu.pode.configurar && TS.abrirHistAtualizacoes && !TS.demo ? () => TS.abrirHistAtualizacoes() : null, ir: 'ver histórico ›' });
  }

  // ---------- estoque ----------
  async function avisosEstoque(lista) {
    const telas = TS.telasEstoque || [];
    if (!state.loja || state.loja === 'todas' || !(telas.includes('estoque') || telas.includes('pedido'))) return;
    const [e, M] = await Promise.all([TS.estoqueBuscar(state.loja), TS.custosLoja()]);
    if (!e || !e.estoque || !M) return;
    const db = TS.db, fim = db.maxDay;
    const vendeu90 = new Set(), vendeu30 = new Set();
    for (let i = 0; i < db.n; i++) {
      if (db.day[i] < fim - 89) continue;
      for (const [it] of M.consumo(i)) { vendeu90.add(String(it.cod)); if (db.day[i] >= fim - 29) vendeu30.add(String(it.cod)); }
    }
    const CO = TS.classeOficial ? TS.classeOficial(M, e.classe) : new Map();
    const cha = e.estoque.itens.filter((it) => it.un === 'Kg' && vendeu90.has(String(it.cod)));
    const abaixo500 = cha.filter((it) => (it.qtd || 0) < 0.5);
    const estrela700 = cha.filter((it) => (it.qtd || 0) >= 0.5 && it.qtd < 0.7 && (CO.get(String(it.cod)) || {}).classe === 'estrela');
    const acabou = e.estoque.itens.filter((it) => it.un !== 'Kg' && (it.qtd || 0) <= 0 && vendeu30.has(String(it.cod)) && it.tipo !== 'MC');
    const nomes = (xs) => xs.slice(0, 4).map((x) => x.desc).join(', ') + (xs.length > 4 ? ` e mais ${xs.length - 4}` : '');
    const temPedido = telas.includes('pedido');
    if (abaixo500.length) lista.push({ nivel: 'erro', titulo: `${fmt.int(abaixo500.length)} chá(s) a granel com menos de 500 g`, texto: nomes(abaixo500), link: temPedido ? '#pedido' : '#estoque', ir: temPedido ? 'ver no pedido ›' : 'ver estoque ›', antes: () => { state.pedFiltro = 'pedido'; } });
    if (estrela700.length) lista.push({ nivel: 'warn', titulo: `${fmt.int(estrela700.length)} chá(s) Estrela com menos de 700 g`, texto: nomes(estrela700), link: temPedido ? '#pedido' : '#estoque', ir: temPedido ? 'ver no pedido ›' : 'ver estoque ›' });
    if (acabou.length) lista.push({ nivel: 'warn', titulo: `${fmt.int(acabou.length)} produto(s) acabaram e venderam no último mês`, texto: nomes(acabou), link: '#estoque', ir: 'o que repor ›', antes: () => { state.estSit = 'repor'; } });
  }

  // ---------- site ----------
  async function avisosSite(lista) {
    if (!(TS.telasEstoque || []).includes('site')) return;
    const r = await fetch(TS.api('site'), { credentials: 'same-origin' });
    if (!r.ok) return;
    const d = await r.json();
    if (d.erro && d.erro.em && (!d.em || Date.parse(d.erro.em) > Date.parse(d.em))) lista.push({ nivel: 'warn', titulo: 'A última consulta ao site falhou', texto: d.erro.msg, link: '#site' });
    const ant = (d.anterior && d.anterior.precos) || {};
    if (!d.anterior || !d.itens) return;
    let promoNova = 0, mudou = 0;
    for (const x of d.itens) {
      const a = ant[x.id];
      if (!a) continue;
      if (a[1] == null && x.de != null) promoNova++;
      else if (Math.abs(a[0] - x.preco) >= 0.01 || (a[1] ?? null) !== (x.de ?? null)) mudou++;
    }
    if (promoNova || mudou) lista.push({ nivel: 'info', titulo: `Site: ${promoNova ? `${fmt.int(promoNova)} produto(s) entraram em promoção` : ''}${promoNova && mudou ? ' e ' : ''}${mudou ? `${fmt.int(mudou)} mudaram de preço` : ''}`, texto: `Desde a consulta de ${new Date(d.anterior.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.`, link: '#site', ir: 'ver no site ›', antes: () => { state.siteFiltro = 'mudou'; } });
  }

  // ---------- atualizações ----------
  async function avisosAtualizacoes(lista) {
    if (!(TS.eu && TS.eu.pode && TS.eu.pode.configurar) || TS.demo) return;
    const r = await fetch('/api/admin/estado', { credentials: 'same-origin' });
    if (!r.ok) return;
    const e = await r.json();
    const limite = Date.now() - 48 * 3600e3;
    for (const l of e.lojas || []) {
      if (state.loja && state.loja !== 'todas' && l.id !== state.loja) continue;
      const falhas = (l.eventos || []).filter((x) => x.ok === false && Date.parse(x.em) >= limite);
      if (falhas.length) {
        const NOME = { vendas: 'vendas', xml: 'XML', estoque: 'estoque', compras: 'notas de compra', caixa: 'caixa', fixe: 'FIXE', fixeEmail: 'FIXE' };
        lista.push({ nivel: 'erro', titulo: `${l.nome}: ${fmt.int(falhas.length)} atualização(ões) falharam nas últimas 48 h`, texto: [...new Set(falhas.map((x) => NOME[x.parte] || x.parte))].join(', '), acao: () => TS.abrirHistAtualizacoes(), ir: 'ver histórico ›' });
      }
    }
  }
})();
