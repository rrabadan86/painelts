/* Qualidade do cadastro (Clientes → Indicadores; QUAL-CAD-01…05, mockup aprovado pelo dono em 27/11/2026).
 * O que impede o cliente de receber mensagem, campanha e aniversário, para corrigir no FIXE ou no caixa (o painel só lê o cadastro).
 * Só admin e franqueado veem (decisão do dono). Base: TODOS os clientes do cadastro da loja (não segue período nem filtros).
 * A conta (`calcular`) é pura e também roda no node --test; não toca na página ao carregar. */
'use strict';
(function () {
  const raiz = typeof window !== 'undefined' ? window : globalThis;
  const TS = raiz.TS || (raiz.TS = {});

  // DDDs que existem no Brasil
  const DDD = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
    51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99]);
  const dig = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  const local = (cel) => { const d = dig(cel); return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d; };

  /** o celular do cadastro serve para WhatsApp? → null (serve) | 'vazio' | o motivo em texto */
  function motivoCelular(cel, demo) {
    const d = local(cel);
    if (!d) return 'vazio';
    if (d.length >= 10 && /^(\d)\1+$/.test(d.slice(2))) return 'número de mentira';
    if (d.length < 10) return 'faltando dígito';
    if (d.length > 11) return 'dígitos a mais';
    if (!DDD.has(+d.slice(0, 2)) && !(demo && d.startsWith('00'))) return 'DDD que não existe'; // a apresentação usa o DDD 00 (número que não existe de verdade)
    if (d.length === 10 && /[2-5]/.test(d[2])) return 'telefone fixo';
    if (d.length === 11 && d[2] !== '9') return 'não é celular';
    return null;
  }
  /** chave do número (com e sem o 9º dígito é o mesmo celular — a mesma regra de `ZF.foneChave`) */
  const chaveCel = (cel) => { const d = local(cel); return d.length === 10 && /[6-9]/.test(d[2]) ? d.slice(0, 2) + '9' + d.slice(2) : d; };
  /** data de nascimento de verdade (idade entre 12 e 105 anos em `hojeIso`) */
  function nascOk(iso, hojeIso) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return false;
    const a = +hojeIso.slice(0, 4) - +iso.slice(0, 4) - (hojeIso.slice(5, 10) < iso.slice(5, 10) ? 1 : 0);
    return a >= 12 && a <= 105;
  }

  /** os problemas, na ordem da tabela: [chave, nome, explicação] */
  const PROBLEMAS = [
    ['semwpp', 'Sem WhatsApp', 'O robô conferiu e o número não tem WhatsApp (guardado pelo robô a partir de 27/11/2026).'],
    ['celinv', 'Celular inválido', 'Telefone fixo, faltando dígito, DDD que não existe ou número de mentira (99999-9999).'],
    ['semcel', 'Sem celular', 'Campo do celular vazio no cadastro.'],
    ['repetido', 'Mesmo celular em vários CPFs', 'Casal, mãe e filha: o número recebe uma mensagem só. Não conta como cadastro incompleto.'],
    ['nasc', 'Sem data de nascimento', 'Vazia ou com ano de mentira (ex.: 1900): o aniversário não sai nas campanhas.'],
    ['cidade', 'Sem cidade', 'Fica fora do filtro por cidade das campanhas.'],
    ['email', 'Sem e-mail', 'Campo vazio ou sem @.'],
    ['nome', 'Nome incompleto', 'Só o primeiro nome no cadastro.'],
  ];

  /**
   * clientes: [{ cpf, nome, celular, nascimento, cidade, email }] (o cadastro da loja)
   * semwpp: Set de CPFs que o robô conferiu sem WhatsApp · cadDe(cpf) → 'AAAA-MM-DD' da entrada no programa ou null
   * hoje: 'AAAA-MM-DD'
   * → { total, completos, recebem, novos: { n, falha }, por: { chave: [cpf] }, motivoCel: Map(cpf → texto), porMes: [{ ym, n, ok }], problemasDe: Map(cpf → [chave]) }
   */
  function calcular({ clientes, semwpp, cadDe, hoje, demo }) {
    semwpp = semwpp || new Set(); cadDe = cadDe || (() => null);
    const por = Object.fromEntries(PROBLEMAS.map(([k]) => [k, []]));
    const problemasDe = new Map(), motivoCel = new Map(), porNumero = new Map();
    for (const c of clientes) {
      const m = motivoCelular(c.celular, demo);
      if (m && m !== 'vazio') motivoCel.set(c.cpf, m);
      if (!m) { const k = chaveCel(c.celular); const l = porNumero.get(k); if (l) l.push(c.cpf); else porNumero.set(k, [c.cpf]); }
    }
    const repetidos = new Set();
    for (const l of porNumero.values()) if (l.length > 1) l.forEach((x) => repetidos.add(x));
    let completos = 0, recebem = 0;
    const ini30 = new Date(Date.parse(hoje + 'T12:00:00Z') - 30 * 864e5).toISOString().slice(0, 10);
    const novos = { n: 0, falha: 0 };
    const mesesSet = new Map();
    for (const c of clientes) {
      const m = motivoCelular(c.celular, demo);
      const p = [];
      if (m === 'vazio') p.push('semcel'); else if (m) p.push('celinv');
      else if (semwpp.has(c.cpf)) p.push('semwpp');
      if (repetidos.has(c.cpf)) p.push('repetido');
      if (!nascOk(c.nascimento, hoje)) p.push('nasc');
      if (!String(c.cidade || '').trim()) p.push('cidade');
      if (!/@/.test(String(c.email || ''))) p.push('email');
      if (String(c.nome || '').trim().split(/\s+/).filter(Boolean).length < 2) p.push('nome');
      p.forEach((k) => por[k].push(c.cpf));
      problemasDe.set(c.cpf, p);
      const ok = !p.some((k) => k !== 'repetido');
      if (ok) completos++;
      if (!m && !semwpp.has(c.cpf)) recebem++;
      const cad = cadDe(c.cpf);
      if (cad && cad >= ini30 && cad <= hoje) { novos.n++; if (!ok) novos.falha++; }
      if (cad) { const ym = cad.slice(0, 7); const x = mesesSet.get(ym) || { ym, n: 0, ok: 0 }; x.n++; if (ok) x.ok++; mesesSet.set(ym, x); }
    }
    const ultimos = [];
    for (let k = 11; k >= 0; k--) { const d = new Date(Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1 - k, 1)); const ym = d.toISOString().slice(0, 7); ultimos.push(mesesSet.get(ym) || { ym, n: 0, ok: 0 }); }
    return { total: clientes.length, completos, recebem, novos, por, motivoCel, porMes: ultimos, problemasDe };
  }

  // ---------------- tela ----------------
  const semwppCache = new Map(); // loja → { em, cpfs: Set }
  async function carregarSemWpp(loja) {
    const r = await fetch(TS.api(`clientes/semwpp?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha ao ler a lista do robô.');
    let cpfs = j.cpfs || [];
    // apresentação: o robô de mentira "conferiu" alguns clientes de exemplo (nada é lido nem gravado)
    if (j.demo) cpfs = [...((TS.cli && TS.cli.cad) || new Map()).keys()].filter((cpf, i) => i % 23 === 5);
    return new Set(cpfs);
  }
  /** dia de entrada no programa de cada CPF (o mais antigo das bases do FIXE) */
  function cadastros() {
    const m = new Map();
    for (const b of (TS.db && TS.db.fidelidade) || []) for (const [cpf, d] of b.membros || []) { if (d && (!m.has(cpf) || d < m.get(cpf))) m.set(cpf, String(d).slice(0, 10)); }
    return m;
  }
  /** o cadastro da loja: todos os clientes (cadastro + quem só está no programa) */
  function clientesDaBase() {
    const cad = (TS.cli && TS.cli.cad) || new Map();
    const out = new Map();
    for (const [cpf, c] of cad) out.set(cpf, { cpf, nome: c.nome || '', celular: c.celular || '', nascimento: c.nascimento || null, cidade: c.cidade || '', email: c.email || '' });
    for (const cpf of ((TS.cli && TS.cli.fxPorCpf) || new Map()).keys()) if (!out.has(cpf)) { const f = TS.cli.fxPorCpf.get(cpf) || {}; out.set(cpf, { cpf, nome: f.nome || '', celular: '', nascimento: null, cidade: '', email: '' }); }
    return [...out.values()];
  }

  /** a seção inteira (título, alcance, herói, tabela, lista aberta e evolução) → [elementos] */
  function secao() {
    const { h, fmt, state } = TS;
    const loja = state.loja;
    const titulo = TS.section('Qualidade do cadastro');
    const alcance = h('p', { class: 'muted cli-alcance' }, 'Todos os clientes do cadastro da loja: não segue o período nem os filtros. A correção é no FIXE ou no caixa; o painel só lê o cadastro.');
    if (!loja || loja === 'todas') return [titulo, h('p', { class: 'muted' }, 'Escolha uma loja para ver a qualidade do cadastro.')];
    let sw = semwppCache.get(loja);
    if (!sw) {
      semwppCache.set(loja, (sw = { carregando: true, cpfs: new Set() }));
      carregarSemWpp(loja).then((cpfs) => { semwppCache.set(loja, { cpfs, em: Date.now() }); if (state.page === 'clientes') TS.render(); })
        .catch(() => { semwppCache.set(loja, { cpfs: new Set(), erro: true }); if (state.page === 'clientes') TS.render(); });
    }
    const cads = cadastros();
    const base = clientesDaBase();
    const hoje = TS.hojeSP ? TS.hojeSP() : new Date().toISOString().slice(0, 10);
    const r = calcular({ clientes: base, semwpp: sw.cpfs, cadDe: (cpf) => cads.get(cpf) || null, hoje, demo: !!TS.demo });
    if (!r.total) return [titulo, alcance, TS.card(null, null, TS.empty('Sem cadastro de clientes nesta loja.'))];
    const pc = (n) => fmt.pct(r.total ? n / r.total : 0);
    const heroi = TS.heroi([
      { rot: 'Cadastro completo', num: fmt.pct(r.completos / r.total, 0), barra: { pct: (r.completos / r.total) * 100, rotulo: `${fmt.pct(r.completos / r.total, 0)} completos` },
        linhas: [`${fmt.int(r.completos)} de ${fmt.int(r.total)} clientes`],
        dica: 'Clientes com celular que recebe WhatsApp, data de nascimento, cidade, e-mail e nome completo. O mesmo celular em vários CPFs não tira o cliente daqui.' },
      { rot: 'Recebem WhatsApp', num: fmt.pct(r.recebem / r.total, 0), linhas: [`${fmt.int(r.total - r.recebem)} não recebem: sem celular, número errado ou sem WhatsApp`],
        dica: 'Celular no formato certo e sem a marca do robô "sem WhatsApp".' + (sw.carregando ? ' Lendo a lista do robô…' : sw.erro ? ' Não consegui ler a lista do robô agora: os "sem WhatsApp" ficaram de fora.' : '') },
      { rot: 'Cadastros novos com falha', num: r.novos.n ? `${fmt.int(r.novos.falha)} de ${fmt.int(r.novos.n)}` : '—', estado: r.novos.n && r.novos.falha / r.novos.n > 0.2 ? 'ruim' : null,
        linhas: [r.novos.n ? 'entraram no programa nos últimos 30 dias' : 'ninguém entrou no programa nos últimos 30 dias'],
        dica: 'Clientes que entraram no programa de fidelidade nos últimos 30 dias com pelo menos um problema. É o número que a equipe controla no caixa.' },
    ]);
    const sel = state.qcSel && r.por[state.qcSel] ? state.qcSel : null;
    const linhas = PROBLEMAS.map(([k, nome, dica]) => ({ k, nome, dica, n: r.por[k].length }));
    const abrir = (row) => { state.qcSel = state.qcSel === row.k ? null : row.k; state.qcAba = 'todos'; TS.render(); };
    const tabela = TS.table({
      cols: [
        { key: 'nome', label: 'Problema', align: 'l', sticky: true, wrap: true, render: (x) => h('div', { 'data-qc': x.k }, h('b', null, x.nome), h('small', { class: 'muted', style: { display: 'block' } }, x.dica)) },
        { key: 'n', label: 'Clientes', fmt: (v) => fmt.int(v), title: 'Quantos clientes do cadastro têm este problema.' },
        { key: 'pct', label: '% da base', render: (x) => pc(x.n), title: 'Sobre todos os clientes do cadastro da loja.' },
        { key: 'ver', label: '', align: 'l', render: (x) => (x.n ? h('span', { class: 'link-btn' }, sel === x.k ? 'Fechar' : 'Ver lista ›') : h('span', { class: 'muted' }, '—')) },
      ],
      rows: linhas, sortKey: null, onRowClick: (x) => (x.n ? abrir(x) : null), search: false,
      linhaMob: (x) => h('div', { class: 'lmob-it', 'data-qc': x.k }, // o toque é o onRowClick (o TS.table liga sozinho)
        h('div', { class: 'lmob-l1' }, h('b', null, x.nome), h('span', { class: 'lmob-val' }, fmt.int(x.n))),
        h('div', { class: 'lmob-l2' }, `${pc(x.n)} · ${x.dica}${x.n ? ' · ver lista ›' : ''}`)),
    });
    const quadro = TS.cardSec('O que falta corrigir', { sub: 'Toque num problema para ver os clientes. Um cliente pode ter mais de um problema.' }, tabela);
    const lista = sel ? listaDe(sel, r, cads) : null;
    const meses = r.porMes.filter((x) => x.n);
    const evol = meses.length >= 2 ? TS.cardSec('Cadastros completos por mês', { sub: '% dos clientes que entraram no programa em cada mês e estão completos hoje.' },
      TS.ehCelular() ? TS.barrasMob(r.porMes.map((x) => ({ nome: TS.ymLabel(x.ym) + (x.n ? ` · ${x.n} ${x.n === 1 ? 'cadastro' : 'cadastros'}` : ''), v: x.n ? x.ok / x.n : 0, rot: x.n ? fmt.pct(x.ok / x.n, 0) : '—' })))
        : TS.chart({ type: 'bar', data: { labels: r.porMes.map((x) => TS.ymLabel(x.ym)), datasets: [{ data: r.porMes.map((x) => (x.n ? Math.round((x.ok / x.n) * 1000) / 10 : null)), backgroundColor: '#2C5234', borderRadius: 4 }] },
          options: { plugins: { legend: { display: false }, valueLabels: { display: true, format: (v) => (v == null ? '' : `${String(v).replace('.', ',')}%`) }, tooltip: { callbacks: { label: (c) => { const x = r.porMes[c.dataIndex]; return x.n ? `${x.ok} de ${x.n} completos` : 'sem cadastro'; } } } }, scales: { y: { display: false, max: 100, grace: '10%' }, x: TS.axisCat } } }, 'short')) : null;
    return [titulo, alcance, heroi, quadro, lista, evol].filter(Boolean);
  }

  function listaDe(k, r, cads) {
    const { h, fmt, state } = TS;
    const [, nome] = PROBLEMAS.find((p) => p[0] === k);
    const hoje = TS.hojeSP ? TS.hojeSP() : new Date().toISOString().slice(0, 10);
    const d90 = TS.todayDay() - 90, ini30 = new Date(Date.parse(hoje + 'T12:00:00Z') - 30 * 864e5).toISOString().slice(0, 10);
    const cad = (TS.cli && TS.cli.cad) || new Map();
    const todos = r.por[k].map((cpf) => {
      const c = cad.get(cpf) || {}, cl = (TS.cli.porCPF && TS.cli.porCPF.get(cpf)) || {};
      const quando = cads.get(cpf) || null;
      return { cpf, nome: TS.msgWpp.nomeProprio(c.nome || '') || '—', cel: TS.cliApi.fmtTel(c.celular) || '—', motivo: r.motivoCel.get(cpf) || '', ultima: cl.ultima ?? null, vend: TS.msgWpp.nomeProprio(cl.vendedoraPref || cl.vendedora || '') || '', cad: quando,
        outros: r.problemasDe.get(cpf).filter((x) => x !== k).map((x) => PROBLEMAS.find((p) => p[0] === x)[1].toLowerCase()) };
    });
    const ABAS = [['Todos', 'todos', 'Todos os clientes com este problema'], ['Compraram em 90 dias', '90', 'Compraram nos últimos 90 dias: é mais fácil confirmar o dado com eles'], ['Cadastro novo', 'novo', 'Entraram no programa nos últimos 30 dias']];
    const filtra = (a) => (a === '90' ? todos.filter((x) => x.ultima != null && x.ultima >= d90) : a === 'novo' ? todos.filter((x) => x.cad && x.cad >= ini30) : todos);
    const aba = ABAS.some((x) => x[1] === state.qcAba) ? state.qcAba : 'todos';
    const rows = filtra(aba).sort((a, b) => (b.ultima ?? -1) - (a.ultima ?? -1));
    const seg = TS.seg(ABAS.map(([rot, v, d]) => [`${rot} (${fmt.int(filtra(v).length)})`, v, d]), aba, (v) => { state.qcAba = v; TS.render(); });
    const tab = TS.table({
      cols: [
        { key: 'nome', label: 'Cliente', align: 'l', sticky: true, wrap: true, render: (x) => h('div', null, h('b', null, x.nome), h('small', { class: 'muted', style: { display: 'block' } }, `CPF ${TS.cliApi.fmtCPF(x.cpf)}${x.outros.length ? ' · também: ' + x.outros.join(', ') : ''}`)) },
        { key: 'cel', label: 'Celular no cadastro', align: 'l', render: (x) => h('div', null, x.cel, x.motivo ? h('small', { class: 'muted', style: { display: 'block' } }, x.motivo) : null) },
        { key: 'ultima', label: 'Última compra', fmt: (v) => (v == null ? '—' : fmt.date(TS.dayToIso(v))) },
        { key: 'vend', label: 'Vendedora', align: 'l', fmt: (v) => v || '—', title: 'Quem mais atende o cliente: quem pode confirmar o dado na próxima visita.' },
      ],
      rows, sortKey: 'ultima', sortDir: 'desc', onRowClick: (x) => TS.cliApi.abrirClientes([x.cpf]),
      empty: 'Ninguém nesta aba.',
      linhaMob: (x) => h('div', { class: 'lmob-it' },
        h('div', { class: 'lmob-l1' }, h('b', null, x.nome), h('span', { class: 'lmob-val' }, x.ultima == null ? '—' : fmt.date(TS.dayToIso(x.ultima)))),
        h('div', { class: 'lmob-l2' }, [x.cel !== '—' ? x.cel + (x.motivo ? ` (${x.motivo})` : '') : 'sem celular', x.vend, x.outros.length ? 'também: ' + x.outros.join(', ') : ''].filter(Boolean).join(' · '))),
    });
    const baixar = h('button', { type: 'button', class: 'btn', onclick: () => TS.cliApi.csv(`cadastro-${k}`, ['Nome', 'CPF', 'Celular no cadastro', 'Problema do celular', 'Última compra', 'Vendedora', 'Outros problemas'],
      rows.map((x) => [x.nome, TS.cliApi.fmtCPF(x.cpf), x.cel, x.motivo, x.ultima == null ? '' : fmt.date(TS.dayToIso(x.ultima)), x.vend, x.outros.join(', ')])) }, 'Baixar lista (CSV)');
    const fechar = h('button', { type: 'button', class: 'btn', onclick: () => { state.qcSel = null; TS.render(); } }, 'Fechar');
    return h('div', { class: 'qc-lista', 'data-qc-lista': k }, TS.cardSec(`${nome} (${fmt.int(todos.length)})`, { sub: 'O mais recente em cima: quem comprou há pouco é mais fácil de confirmar. Corrija no FIXE; na próxima importação do FIXE o cliente sai daqui sozinho.', ferramentas: h('span', { class: 'qc-ferr' }, baixar, fechar) }, seg, tab));
  }

  TS.qualidadeCad = { calcular, motivoCelular, chaveCel, nascOk, PROBLEMAS, secao, limpar: () => semwppCache.clear() };
  if (typeof module !== 'undefined' && module.exports) module.exports = TS.qualidadeCad;
})();
