/* Banco de horas dos feriados (decisão do dono, 26/11/2026; BANCO-01…).
 * Uma conta só, usada pela aba Banco de horas, pelo cartão de feriados, pelo PDF/e-mail do fechamento e pelo PDF da escala.
 *
 * O que entra no saldo de cada pessoa (nome em maiúsculas, como nas vendas e na escala):
 *   + feriado trabalhado com acerto "banco": as horas em DOBRO (6h no feriado = +12h). Acerto "pagar" não mexe no saldo.
 *   − folga pelo banco (ajuste da escala com banco: true): a jornada do dia (carga semanal ÷ dias da escala).
 *   ± lançamento manual (horas a crédito ou devidas, com o motivo).
 * Compensação do mais antigo para o mais novo. Prazo (6 ou 12 meses, Equipe e regras):
 *   - hora DEVIDA pela pessoa que passa do prazo some (vence) — decisão do dono;
 *   - hora A CRÉDITO da pessoa não vence: passou do prazo, vira aviso "dê a folga ou pague".
 * Só entram feriados a partir de `desde` (o banco começa zerado). Movimento com data depois de `ate` (hoje) ainda não conta.
 */
'use strict';
(function () {
  const TS = (typeof window !== 'undefined' && window.TS) || (typeof globalThis !== 'undefined' && globalThis.TS) || {};
  const PRAZOS = [6, 12];
  const DESDE_PADRAO = '2026-11'; // o mês da decisão: o feriado de 20/11 já pode ir para o banco (ou ser marcado "pagar")

  /** regras da loja: { padrao: 'banco'|'pagar', prazo: 6|12, desde: 'AAAA-MM' } */
  function regras(cfg) {
    const b = (cfg && cfg.bancoHoras) || {};
    return {
      padrao: b.padrao === 'pagar' ? 'pagar' : 'banco',
      prazo: PRAZOS.includes(+b.prazo) ? +b.prazo : 6,
      desde: /^\d{4}-\d{2}$/.test(b.desde || '') ? b.desde : DESDE_PADRAO,
    };
  }
  /** acerto de uma pessoa num feriado: o da pessoa > o do dia > o padrão; antes de `desde`, sempre "pagar" (como era) */
  function acertoDe(cfg, data, nome) {
    const r = regras(cfg);
    if (data.slice(0, 7) < r.desde) return 'pagar';
    const d = ((cfg && cfg.feriadosAcerto) || {})[data.slice(0, 7)];
    const x = d && d[data];
    const p = x && x.p && x.p[String(nome).trim().toUpperCase()];
    return p === 'banco' || p === 'pagar' ? p : x && (x.d === 'banco' || x.d === 'pagar') ? x.d : r.padrao;
  }
  /** jornada do dia em minutos (carga semanal ÷ dias da escala, em blocos de 10 min — a mesma da escala) */
  function jornadaMin(cfg) {
    const e = (cfg && cfg.operacao && cfg.operacao.equipe) || {};
    const dias = { '6x1': 6, '5x2': 5, '4x3': 4 }[e.escala] || 5;
    return Math.round(((+e.cargaSemanal || 44) * 60) / dias / 10) * 10;
  }
  const maisMeses = (iso, n) => {
    let y = +iso.slice(0, 4), m = +iso.slice(5, 7) + n;
    while (m > 12) { m -= 12; y++; }
    const ult = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(+iso.slice(8, 10), ult)).padStart(2, '0')}`;
  };
  const meses = (de, ate) => { const out = []; let [y, m] = de.split('-').map(Number); for (;;) { const k = `${y}-${String(m).padStart(2, '0')}`; if (k > ate) break; out.push(k); if (++m > 12) { m = 1; y++; } } return out; };
  const hTxt = (min) => { const a = Math.abs(Math.round(min)); return `${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`; };
  const sinal = (min) => (min > 0 ? '+' : min < 0 ? '−' : '') + hTxt(min);
  const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  /**
   * os movimentos de cada pessoa até `ate`.
   * feriadosDoMes(ym) → [{ data, nome, horas: { NOME: min } }] (no navegador: TS.horasFeriados; no teste: o que o teste passa)
   */
  function movimentos(cfg, { ate, feriadosDoMes }) {
    const r = regras(cfg), jorn = jornadaMin(cfg);
    const porNome = new Map();
    const add = (nome, m) => { const n = String(nome).trim().toUpperCase(); if (!porNome.has(n)) porNome.set(n, []); porNome.get(n).push(m); };
    if (feriadosDoMes) for (const ym of meses(r.desde, ate.slice(0, 7))) {
      for (const f of feriadosDoMes(ym) || []) {
        if (f.data > ate) continue;
        for (const [nome, min] of Object.entries(f.horas || {})) {
          if (!(min > 0) || acertoDe(cfg, f.data, nome) !== 'banco') continue;
          add(nome, { data: f.data, tipo: 'feriado', min: 2 * min, txt: `Feriado ${f.nome || ''} · ${hTxt(min)} ×2`.replace('  ', ' ') });
        }
      }
    }
    for (const [ym, dias] of Object.entries((cfg && cfg.escalaAjustes) || {})) {
      for (const [iso, pp] of Object.entries(dias || {})) {
        if (iso > ate) continue;
        for (const [nome, a] of Object.entries(pp || {})) if (a && a.tipo === 'folga' && a.banco) add(nome, { data: iso, tipo: 'folga', min: -jorn, txt: 'Folga pelo banco · jornada do dia' });
      }
      void ym;
    }
    for (const l of ((cfg && cfg.bancoHoras && cfg.bancoHoras.lanc) || [])) {
      if (!l || !l.data || l.data > ate || !l.min) continue;
      add(l.nome, { data: l.data, tipo: 'lanc', min: l.min, id: l.id, txt: `${l.motivo || 'Lançamento'}${l.por ? ' · por ' + l.por : ''}` });
    }
    return porNome;
  }

  /** saldo, extrato e avisos de uma pessoa (movimentos de `movimentos`) */
  function conta(movs, { ate, prazo }) {
    const ordem = { feriado: 0, lanc: 1, folga: 2 };
    const lista = [...movs].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (ordem[a.tipo] ?? 9) - (ordem[b.tipo] ?? 9)));
    const cred = [], deb = []; // lotes abertos { data, min } (min sempre positivo)
    const ext = [];
    let saldo = 0;
    const vencer = (ateData) => {
      while (deb.length) {
        const v = maisMeses(deb[0].data, prazo);
        if (v > ateData) break;
        const l = deb.shift();
        saldo += l.min;
        ext.push({ data: v, tipo: 'venceu', min: l.min, txt: `Horas devidas de ${dm(l.data)} venceram (prazo de ${prazo} meses)`, saldo });
      }
    };
    for (const m of lista) {
      vencer(m.data);
      let x = m.min;
      if (x > 0) { while (x > 0 && deb.length) { const u = Math.min(x, deb[0].min); deb[0].min -= u; x -= u; if (!deb[0].min) deb.shift(); } if (x > 0) cred.push({ data: m.data, min: x }); }
      else { x = -x; while (x > 0 && cred.length) { const u = Math.min(x, cred[0].min); cred[0].min -= u; x -= u; if (!cred[0].min) cred.shift(); } if (x > 0) deb.push({ data: m.data, min: x }); }
      saldo += m.min;
      ext.push({ ...m, saldo });
    }
    vencer(ate);
    ext.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    const em30 = maisMeses(ate, 1);
    return {
      saldo, ext,
      creditoAtrasado: cred.filter((l) => maisMeses(l.data, prazo) <= ate).map((l) => ({ ...l, prazo: maisMeses(l.data, prazo) })),
      creditoVencendo: cred.filter((l) => { const v = maisMeses(l.data, prazo); return v > ate && v <= em30; }).map((l) => ({ ...l, prazo: maisMeses(l.data, prazo) })),
      debitoVencendo: deb.filter((l) => maisMeses(l.data, prazo) <= em30).map((l) => ({ ...l, vence: maisMeses(l.data, prazo) })),
    };
  }

  /** tudo de uma loja: { regras, pessoas: Map NOME → conta } */
  function calcular(cfg, { ate, feriadosDoMes }) {
    const r = regras(cfg);
    const pessoas = new Map();
    for (const [nome, movs] of movimentos(cfg, { ate, feriadosDoMes })) pessoas.set(nome, conta(movs, { ate, prazo: r.prazo }));
    return { regras: r, pessoas };
  }
  /** o mês de uma pessoa: saldo no início, entrou, saiu, venceu, saldo no fim (PDF e e-mail do fechamento) */
  function resumoMes(p, ym) {
    const ini = `${ym}-01`, fimMes = `${ym}-31`;
    const antes = (p ? p.ext : []).filter((m) => m.data < ini);
    const no = (p ? p.ext : []).filter((m) => m.data >= ini && m.data <= fimMes);
    const inicio = antes.length ? antes[antes.length - 1].saldo : 0;
    const entrou = no.filter((m) => m.min > 0 && m.tipo !== 'venceu').reduce((s, m) => s + m.min, 0);
    const saiu = no.filter((m) => m.min < 0).reduce((s, m) => s + m.min, 0);
    const venceu = no.filter((m) => m.tipo === 'venceu').reduce((s, m) => s + m.min, 0);
    return { inicio, entrou, saiu, venceu, fim: inicio + entrou + saiu + venceu, movs: no };
  }

  const API = { regras, acertoDe, jornadaMin, movimentos, conta, calcular, resumoMes, maisMeses, hTxt, sinal, PRAZOS, DESDE_PADRAO };
  /** no navegador: a loja com os feriados da tela (TS.horasFeriados) e hoje de Brasília */
  API.daLoja = function (cfg, ate) {
    const hoje = ate || (TS.hojeSP ? TS.hojeSP() : new Date().toISOString().slice(0, 10));
    const feriadosDoMes = TS.feriadosDoMes && TS.horasFeriados ? (ym) => {
      const hv = TS.horasFeriados(cfg, ym).horas;
      return TS.feriadosDoMes(cfg, ym).map((f) => ({ data: f.data, nome: f.nome, horas: hv[f.data] || {} }));
    } : null;
    return calcular(cfg, { ate: hoje, feriadosDoMes });
  };

  // ---------- tela (só no navegador; nada aqui roda ao carregar) ----------
  const nomeBonito = (n) => (TS.msgWpp && TS.msgWpp.nomeProprio ? TS.msgWpp.nomeProprio(n) : n);
  const podeMexer = () => !!(TS.demo || (TS.eu && ['admin', 'franqueado', 'gerente'].includes(TS.eu.perfil)));
  async function enviar(caminho, cfg, metodo, corpo) {
    const r = await fetch(TS.api(`banco-horas/${caminho}?loja=${encodeURIComponent(cfg.id)}`), { method: metodo, credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não foi salvo.');
    return j;
  }
  /** aba Movimento e escala → Banco de horas. pessoas = nomes da escala */
  API.tela = function (root, cfg, pessoas) {
    const { h, fmt, state } = TS;
    const hoje = TS.hojeSP();
    const ymHoje = hoje.slice(0, 7);
    const R = API.daLoja(cfg, hoje);
    const nomes = [...new Set([...(pessoas || []).map((n) => String(n).trim().toUpperCase()), ...R.pessoas.keys()])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const linhas = nomes.map((n) => {
      const p = R.pessoas.get(n) || { saldo: 0, ext: [], creditoAtrasado: [], creditoVencendo: [], debitoVencendo: [] };
      const m = resumoMes(p, ymHoje);
      return { nome: n, rot: nomeBonito(n), p, saldo: p.saldo, entrou: m.entrou, saiu: m.saiu, venceu: m.venceu };
    });
    const tot = linhas.reduce((s, r) => s + r.saldo, 0);
    const credito = linhas.filter((r) => r.saldo > 0).length, devendo = linhas.filter((r) => r.saldo < 0).length;
    const atrasados = linhas.flatMap((r) => r.p.creditoAtrasado.map((l) => ({ ...l, nome: r.rot })));
    const vencendo = linhas.flatMap((r) => r.p.creditoVencendo.map((l) => ({ ...l, nome: r.rot })));
    const ferMes = linhas.reduce((s, r) => s + r.p.ext.filter((x) => x.tipo === 'feriado' && x.data.startsWith(ymHoje)).reduce((a, x) => a + x.min, 0), 0);
    const somaMin = (l) => l.reduce((s, x) => s + x.min, 0);
    if (atrasados.length) root.append(h('div', { class: 'notice err', 'data-aviso': 'bh-prazo' }, `Passou do prazo de ${R.regras.prazo} meses: `,
      atrasados.map((x) => `${x.nome} tem ${hTxt(x.min)} de crédito desde ${dm(x.data)}`).join('; '), '. Dê a folga ou pague essas horas (o crédito da pessoa não vence).'));
    root.append(TS.heroi([
      { rot: 'Saldo da equipe', num: sinal(tot), linhas: [`${credito} com crédito · ${devendo} devendo`], estado: tot < 0 ? 'ruim' : null,
        dica: 'Soma dos saldos. Positivo = a loja deve folga (ou pagamento) às pessoas; negativo = as pessoas devem horas à loja.' },
      { rot: 'Folga ou pagar', num: atrasados.length ? hTxt(somaMin(atrasados)) : vencendo.length ? hTxt(somaMin(vencendo)) : '0h00', estado: atrasados.length ? 'ruim' : null,
        linhas: [atrasados.length ? 'crédito que passou do prazo' : vencendo.length ? `crédito que chega ao prazo em 30 dias (${vencendo.map((x) => x.nome).join(', ')})` : 'nenhum crédito perto do prazo'],
        dica: `O crédito da pessoa não vence: passados ${R.regras.prazo} meses, o painel avisa para dar a folga ou pagar. A hora que a pessoa deve vence e some depois de ${R.regras.prazo} meses.` },
      { rot: 'Feriados no mês', num: sinal(ferMes), linhas: [`acerto padrão: ${R.regras.padrao === 'banco' ? 'banco de horas (×2)' : 'pagar'}`],
        dica: 'Horas de feriado deste mês que foram para o banco (já em dobro). Banco ou pagar se escolhe no cartão de feriados do Comissionamento.' },
    ], { titulo: 'Banco de horas' }));
    const pode = podeMexer();
    // extrato da pessoa escolhida
    const sel = state.bhSel && linhas.find((r) => r.nome === state.bhSel);
    const tabela = TS.table({
      cols: [
        { key: 'rot', label: 'Pessoa', align: 'l', sticky: true, wrap: true, render: (r) => h('div', null, h('b', null, r.rot),
          r.p.creditoAtrasado.length ? h('small', { class: 'neg', style: { display: 'block' } }, `${hTxt(somaMin(r.p.creditoAtrasado))} passaram do prazo: folga ou pagar`)
            : r.p.debitoVencendo.length ? h('small', { class: 'muted', style: { display: 'block' } }, `${hTxt(somaMin(r.p.debitoVencendo))} devidas vencem em ${dm(r.p.debitoVencendo[0].vence)}`) : null) },
        { key: 'entrou', label: 'Entrou no mês', fmt: (v) => (v ? sinal(v) : '—'), cls: (r) => (r.entrou ? 'pos' : ''), title: 'Feriados no banco (em dobro) e lançamentos a crédito neste mês.' },
        { key: 'saiu', label: 'Saiu no mês', fmt: (v) => (v ? sinal(v) : '—'), cls: (r) => (r.saiu ? 'neg' : ''), title: 'Folgas pelo banco (a jornada do dia) e lançamentos de horas devidas neste mês.' },
        { key: 'saldo', label: 'Saldo', fmt: (v) => sinal(v), cls: (r) => 'bh-saldo ' + (r.saldo > 0 ? 'pos' : r.saldo < 0 ? 'neg' : ''), title: 'Positivo = a loja deve à pessoa. Negativo = a pessoa deve horas.' },
      ],
      rows: linhas, sortKey: 'rot', sortDir: 'asc', onRowClick: (r) => { state.bhSel = state.bhSel === r.nome ? null : r.nome; TS.render(); },
      empty: 'Ninguém no banco ainda. Ele começa zerado e recebe os feriados marcados como "banco".',
      linhaMob: (r) => h('div', { class: 'lmob-it' }, // o toque é o onRowClick: com onclick aqui também, abria e fechava no mesmo toque
        h('div', { class: 'lmob-l1' }, h('b', null, r.rot), h('span', { class: 'bh-saldo ' + (r.saldo > 0 ? 'pos' : r.saldo < 0 ? 'neg' : '') }, sinal(r.saldo))),
        h('div', { class: 'lmob-l2' }, `entrou ${r.entrou ? sinal(r.entrou) : '—'} · saiu ${r.saiu ? sinal(r.saiu) : '—'}${r.p.creditoAtrasado.length ? ' · passou do prazo: folga ou pagar' : ''}`)),
    });
    const lanc = pode ? formLanc(cfg, nomes, hoje) : null;
    root.append(TS.cardSec('Saldo por pessoa', { sub: 'Toque no nome para ver o extrato.', ferramentas: pode ? h('button', { type: 'button', class: 'btn primary', 'data-bh': 'novo', onclick: () => { state.bhNovo = !state.bhNovo; TS.render(); } }, '+ Lançamento') : null },
      state.bhNovo && lanc ? lanc : null, tabela));
    if (sel) root.append(extrato(cfg, sel, R.regras, pode));
    root.append(h('p', { class: 'muted bh-como' }, `Como funciona: feriado no banco entra em dobro; "Folga pelo banco" na escala (toque no dia da pessoa) desconta a jornada de ${hTxt(jornadaMin(cfg))}; lançamentos com o motivo valem para o resto (saiu mais cedo, ficou depois). Compensa do mais antigo para o mais novo. Hora devida vence em ${R.regras.prazo} meses e some; crédito não vence. Regras em Equipe e regras.`));
  };
  function extrato(cfg, r, regras, pode) {
    const { h, state } = TS;
    const movs = [...r.p.ext].reverse();
    return TS.cardSec(`Extrato · ${r.rot}`, { sub: `Saldo ${sinal(r.saldo)} · prazo de ${regras.prazo} meses`, ferramentas: h('button', { type: 'button', class: 'btn', onclick: () => { state.bhSel = null; TS.render(); } }, 'Fechar') },
      movs.length ? h('ul', { class: 'bh-ext' }, movs.map((m) => h('li', null, h('span', { class: 'd' }, dm(m.data) + '/' + m.data.slice(2, 4)),
        h('span', null, m.txt, m.tipo === 'lanc' && pode ? h('button', { type: 'button', class: 'link-btn', style: { marginLeft: '8px' }, onclick: async () => {
          const ok = await TS.perguntar('Apagar este lançamento?', { texto: `${m.txt} (${sinal(m.min)})`, ok: 'Apagar', rotulo: 'Por que apagar? (opcional)' });
          if (ok == null) return;
          try { await enviar('lanc/apagar', cfg, 'POST', { id: m.id }); cfg.bancoHoras = { ...(cfg.bancoHoras || {}), lanc: ((cfg.bancoHoras && cfg.bancoHoras.lanc) || []).filter((x) => x.id !== m.id) }; TS.render(); }
          catch (e) { TS.naoSalvo(e); }
        } }, 'apagar') : null),
        h('span', { class: 'v ' + (m.min > 0 ? 'pos' : 'neg') }, sinal(m.min)), h('span', { class: 's' }, 'saldo ' + sinal(m.saldo)))))
        : h('p', { class: 'muted' }, 'Nenhum movimento ainda.'));
  }
  function formLanc(cfg, nomes, hoje) {
    const { h, state } = TS;
    const pessoa = h('select', { class: 'f-input', id: 'bh-pessoa' }, nomes.map((n) => h('option', { value: n }, nomeBonito(n))));
    const data = h('input', { class: 'f-input', type: 'date', id: 'bh-data', value: hoje, max: hoje });
    const horas = h('input', { class: 'f-input', id: 'bh-horas', placeholder: '2:00', inputmode: 'numeric', style: { width: '90px' } });
    const tipo = h('select', { class: 'f-input', id: 'bh-tipo' }, h('option', { value: '-1' }, 'A pessoa deve (−)'), h('option', { value: '1' }, 'A loja deve à pessoa (+)'));
    const motivo = h('input', { class: 'f-input', id: 'bh-motivo', maxlength: 120, placeholder: 'Saiu 2h mais cedo (consulta)' });
    const salvar = h('button', { type: 'button', class: 'btn primary' }, 'Salvar lançamento');
    salvar.addEventListener('click', async () => {
      const t = String(horas.value || '').trim().replace(',', '.');
      const mm = /^(\d{1,3})(?:[:h](\d{1,2}))?$/.exec(t.replace(/\s/g, ''));
      const dec = /^\d+(\.\d+)?$/.test(t) ? Math.round(parseFloat(t) * 60) : null;
      const min = mm && !/\./.test(t) ? +mm[1] * 60 + +(mm[2] || 0) : dec;
      if (!min) return TS.naoSalvo('Digite as horas (ex.: 2:00, 2h30 ou 1,5).', horas);
      if (!motivo.value.trim()) return TS.naoSalvo('Escreva o motivo do lançamento.', motivo);
      if (!data.value || data.value > hoje) return TS.naoSalvo('Escolha uma data até hoje.', data);
      const corpo = { nome: pessoa.value, data: data.value, min: min * +tipo.value, motivo: motivo.value.trim() };
      salvar.disabled = true;
      try {
        const j = await enviar('lanc', cfg, 'POST', corpo);
        const por = (TS.eu && TS.eu.nome) || '';
        cfg.bancoHoras = { ...(cfg.bancoHoras || {}), lanc: [...((cfg.bancoHoras && cfg.bancoHoras.lanc) || []), { id: j.id, ...corpo, por }] };
        state.bhNovo = false; state.bhSel = corpo.nome; TS.render();
      } catch (e) { salvar.disabled = false; TS.naoSalvo(e); }
    });
    return h('div', { class: 'bh-form', 'data-bh': 'form' },
      h('label', null, 'Pessoa', pessoa), h('label', null, 'Data', data), h('label', null, 'Horas', horas), h('label', null, 'Tipo', tipo),
      h('label', { class: 'bh-mot' }, 'Motivo', motivo), salvar,
      h('small', { class: 'muted', style: { flexBasis: '100%' } }, 'Folga pelo banco não precisa de lançamento: marque na escala (toque no dia da pessoa → "Folga pelo banco").'));
  }
  /** avisos do Início (BANCO-09): crédito que passou do prazo (dê a folga ou pague) e o que chega ao prazo em 30 dias */
  API.avisos = function (lista) {
    const eu = TS.eu || {}, st = TS.state || {};
    const pode = eu.perfil === 'admin' || eu.perfil === 'franqueado' || (eu.perfil === 'gerente' && (eu.telas || []).includes('mapa'));
    if (!pode || !st.loja || st.loja === 'todas' || !TS.db) return;
    const cfg = (TS.db.metas || []).find((m) => m.id === st.loja);
    if (!cfg) return;
    const R = API.daLoja(cfg);
    const atr = [], perto = [];
    for (const [n, p] of R.pessoas) {
      if (p.creditoAtrasado.length) atr.push(`${nomeBonito(n)} ${hTxt(p.creditoAtrasado.reduce((s, x) => s + x.min, 0))}`);
      else if (p.creditoVencendo.length) perto.push(`${nomeBonito(n)} ${hTxt(p.creditoVencendo.reduce((s, x) => s + x.min, 0))} até ${dm(p.creditoVencendo[0].prazo)}`);
    }
    const ir = { link: '#mapa', antes: () => { st.mapaAba = 'banco'; } };
    if (atr.length) lista.push({ nivel: 'warn', id: 'bh-prazo', titulo: `Banco de horas: ${atr.length} ${atr.length === 1 ? 'pessoa com crédito' : 'pessoas com crédito'} que passou do prazo de ${R.regras.prazo} meses`, texto: `Dê a folga ou pague: ${atr.join(', ')}.`, ...ir });
    if (perto.length) lista.push({ nivel: 'info', id: 'bh-perto', titulo: 'Banco de horas: crédito chegando ao prazo', texto: `Programe a folga: ${perto.join(', ')}.`, ...ir });
  };
  /** cartão das regras (Movimento e escala → Equipe e regras) */
  API.cartaoRegras = function (cfg) {
    const { h } = TS;
    const r = regras(cfg);
    const pode = podeMexer();
    const radio = (nome, v, atual, rot) => h('label', null, h('input', { type: 'radio', name: nome, value: v, checked: v === atual || null, disabled: !pode || null }), rot);
    const desde = h('input', { class: 'f-input', type: 'month', id: 'bh-desde', value: r.desde, disabled: !pode || null });
    const box = h('section', { class: 'card bh-regras mt', 'data-bh': 'regras' });
    const salvar = h('button', { type: 'button', class: 'btn primary' }, 'Salvar regras do banco');
    salvar.addEventListener('click', async () => {
      const corpo = { padrao: box.querySelector('input[name=bh-padrao]:checked').value, prazo: +box.querySelector('input[name=bh-prazo]:checked').value, desde: desde.value };
      salvar.disabled = true;
      try { await enviar('regras', cfg, 'PUT', corpo); cfg.bancoHoras = { ...(cfg.bancoHoras || {}), ...corpo }; salvar.textContent = 'Salvo ✓'; }
      catch (e) { TS.naoSalvo(e); } finally { salvar.disabled = false; }
    });
    box.append(h('div', { class: 'card-title' }, 'Banco de horas'),
      h('div', { class: 'card-sub' }, 'Como os feriados trabalhados acertam e quanto tempo vale o saldo.'),
      h('div', { class: 'cfg-l' }, h('div', { class: 'k' }, 'Feriado trabalhado vai para', h('small', null, 'padrão de cada feriado; dá para trocar no cartão de feriados (Comissionamento)')),
        radio('bh-padrao', 'banco', r.padrao, ' Banco de horas (×2)'), radio('bh-padrao', 'pagar', r.padrao, ' Pagar')),
      h('div', { class: 'cfg-l' }, h('div', { class: 'k' }, 'Prazo', h('small', null, 'a hora que a pessoa deve vence e some; o crédito dela não vence: passado o prazo, o painel avisa para dar a folga ou pagar')),
        radio('bh-prazo', '6', String(r.prazo), ' 6 meses'), radio('bh-prazo', '12', String(r.prazo), ' 12 meses')),
      h('div', { class: 'cfg-l' }, h('div', { class: 'k' }, 'Começa em', h('small', null, 'feriados deste mês em diante entram no banco; antes, ficam como pagos')), desde),
      pode ? h('div', { class: 'cfg-l' }, salvar) : null);
    return box;
  };
  TS.bancoHoras = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
