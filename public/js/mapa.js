/* Mapa de Calor: movimento por dia da semana × hora, pessoas necessárias e escala sugerida */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
  const DIAS_NOME = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  const DIAS_CURTO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const hm = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  const PADRAO = () => ({
    funcionamento: Object.fromEntries(DIAS.map((d) => [d, { abre: '10:00', fecha: d === 'dom' ? '18:00' : '22:00', fechado: false }])),
    equipe: { funcionarios: 3, cargaSemanal: 44, escala: '5x2', intervalo: 60, capacidade: 4, nomes: [] },
  });
  TS.operacaoPadrao = PADRAO;

  /** configuração de horário/equipe da loja (cópia para simular sem salvar) */
  function operacaoDaLoja() {
    const db = TS.db;
    if (!state.loja || state.loja === 'todas') return null;
    const m = (db.metas || []).find((x) => x.id === state.loja) || (db.metas || [])[0];
    return m ? { op: JSON.parse(JSON.stringify(m.operacao || PADRAO())), salva: !!m.operacao, id: m.id, nome: m.nome } : null;
  }

  // ---------- agregação ----------
  /** cupons do filtro com hora: [{ day, wd, min, vt, qtd }] */
  function cupons(base) {
    const db = TS.db, m = new Map();
    let semHora = 0;
    for (const i of base) {
      const k = TS.chaveCupom(i);
      let c = m.get(k);
      if (!c) { c = { day: db.day[i], wd: db.wd[i], min: db.min[i] ?? null, vt: 0, qtd: 0 }; m.set(k, c); }
      c.vt += db.vt[i] || 0; c.qtd += db.qtd[i] || 0;
      if (c.min == null && db.min[i] != null) c.min = db.min[i];
    }
    const lista = [...m.values()];
    for (const c of lista) if (c.min == null) semHora++;
    return { lista: lista.filter((c) => c.min != null), total: lista.length, semHora };
  }

  /** grade [dia 0-6][hora 0-23] com média por dia, total e percentil 80 (para dimensionar a equipe) */
  function grade(cs, de, ate, metrica, ehFeriado) {
    const val = (c) => (metrica === 'vt' ? c.vt : metrica === 'qtd' ? c.qtd : 1);
    // quantos dias de cada dia da semana existem no período
    const nDias = Array(7).fill(0), datas = Array.from({ length: 7 }, () => []);
    for (let d = de; d <= ate; d++) { if (ehFeriado && ehFeriado(d)) continue; const wd = (new Date(d * 86400000).getUTCDay() + 6) % 7; nDias[wd]++; datas[wd].push(d); }
    const tot = Array.from({ length: 7 }, () => Array(24).fill(0));
    const porData = new Map(); // "day|hora" -> cupons (sempre contagem, para a equipe)
    for (const c of cs) {
      const hr = Math.floor(c.min / 60);
      tot[c.wd][hr] += val(c);
      const k = c.day + '|' + hr;
      porData.set(k, (porData.get(k) || 0) + 1);
    }
    const media = tot.map((row, wd) => row.map((v) => (nDias[wd] ? v / nDias[wd] : 0)));
    const p80 = Array.from({ length: 7 }, (_, wd) => Array.from({ length: 24 }, (_, hr) => {
      const xs = datas[wd].map((d) => porData.get(d + '|' + hr) || 0).sort((a, b) => a - b);
      if (!xs.length) return 0;
      const pos = (xs.length - 1) * 0.8, b = Math.floor(pos);
      return xs[b] + (xs[Math.min(b + 1, xs.length - 1)] - xs[b]) * (pos - b);
    }));
    return { tot, media, p80, nDias };
  }

  /** pessoas necessárias em cada hora aberta: pelo menos 1; mais quando o movimento de pico passa da capacidade */
  function necessidade(p80, op) {
    const cap = op.equipe.capacidade || 4;
    return DIAS.map((d, wd) => {
      const f = op.funcionamento[d];
      return Array.from({ length: 24 }, (_, hr) => {
        if (!f || f.fechado) return 0;
        const ini = hr * 60, fim = ini + 60;
        if (fim <= hm(f.abre) || ini >= hm(f.fecha)) return 0;
        const minimo = Math.max(1, (op.equipe.minimoDia && op.equipe.minimoDia[d]) || 1);
        return Math.max(minimo, Math.ceil(p80[wd][hr] / cap - 0.15));
      });
    });
  }

  // ---------- escala sugerida (gulosa, em blocos de 30 min) ----------
  function montarEscala(need, op, nFunc) {
    const e = op.equipe;
    const diasTrab = e.escala === '6x1' ? 6 : 5;
    const jornada = (e.cargaSemanal * 60) / diasTrab; // jornada diária exata (ex.: 44h na 5x2 = 8h48)
    const trabMin = Math.round(jornada / 30) * 30; // na escala, arredondada para blocos de 30 min
    const intervalo = trabMin > 360 ? Math.max(0, Math.round((e.intervalo || 0) / 30) * 30) : trabMin > 240 ? 30 : 0;
    const slotsNeed = need.map((row) => Array.from({ length: 48 }, (_, s) => row[Math.floor(s / 2)]));
    const abertura = DIAS.map((d) => { const f = op.funcionamento[d]; return f && !f.fechado ? [Math.ceil(hm(f.abre) / 30), Math.floor(hm(f.fecha) / 30)] : null; });
    const cob = Array.from({ length: 7 }, () => Array(48).fill(0));
    const pessoas = [];
    for (let p = 0; p < nFunc; p++) {
      const opcoes = [];
      for (let wd = 0; wd < 7; wd++) {
        const ab = abertura[wd];
        if (!ab) { opcoes.push(null); continue; }
        const [a, b] = ab;
        const len = Math.min(b - a, (trabMin + intervalo) / 30);
        const intSlots = Math.min(intervalo / 30, Math.max(0, len - trabMin / 30));
        let melhor = null;
        for (let s = a; s + len <= b; s++) {
          // intervalo: no meio do turno, onde a necessidade é menor
          let pausa = null;
          if (intSlots) {
            let menor = Infinity;
            for (let x = s + Math.floor(len / 2) - 2; x <= s + Math.floor(len / 2) + 1; x++) {
              if (x < s + 4 || x + intSlots > s + len - 4) continue;
              const v = slotsNeed[wd][x] - cob[wd][x];
              if (v < menor) { menor = v; pausa = x; }
            }
            if (pausa == null) pausa = s + Math.floor((len - intSlots) / 2);
          }
          let ganho = 0;
          for (let x = s; x < s + len; x++) {
            if (pausa != null && x >= pausa && x < pausa + intSlots) continue;
            const falta = slotsNeed[wd][x] - cob[wd][x];
            ganho += falta > 0 ? (cob[wd][x] === 0 ? 3 : 1) : 0; // cobrir horário vazio vale mais
          }
          if (!melhor || ganho > melhor.ganho) melhor = { ganho, s, len, pausa, intSlots };
        }
        opcoes.push(melhor);
      }
      // trabalha nos dias de maior ganho; folga nos demais
      const ordem = opcoes.map((o, wd) => [o ? o.ganho : -1, wd]).filter(([g]) => g >= 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      const trab = new Set(ordem.slice(0, diasTrab).map(([, wd]) => wd));
      const turnos = opcoes.map((o, wd) => {
        if (!o || !trab.has(wd)) return null;
        for (let x = o.s; x < o.s + o.len; x++) if (!(o.pausa != null && x >= o.pausa && x < o.pausa + o.intSlots)) cob[wd][x]++;
        return { ini: o.s * 30, fim: (o.s + o.len) * 30, pausa: o.pausa != null && o.intSlots ? [o.pausa * 30, (o.pausa + o.intSlots) * 30] : null };
      });
      pessoas.push(turnos);
    }
    // faltas
    let descoberto = 0, abaixo = 0;
    const faltas = Array.from({ length: 7 }, () => Array(48).fill(0));
    for (let wd = 0; wd < 7; wd++) for (let s = 0; s < 48; s++) {
      const f = slotsNeed[wd][s] - cob[wd][s];
      if (slotsNeed[wd][s] > 0 && f > 0) { faltas[wd][s] = f; if (cob[wd][s] === 0) descoberto += 0.5; else abaixo += 0.5; }
    }
    return { pessoas, cob, faltas, descoberto, abaixo, trabMin, jornada, intervalo, diasTrab };
  }

  /** menor equipe que cobre todos os horários (e a que cobre também os picos) */
  function equipeIdeal(need, op) {
    let soAberto = null, tudo = null;
    const rod = op.equipe.modelo === 'rodizio';
    for (let n = 1; n <= 15; n++) {
      const r = rod ? resumoRodizio(montarRodizio(need, op, Array.from({ length: n }, (_, i) => ({ nome: `P${i + 1}`, folga: 'auto', folga2: 'auto' })))) : montarEscala(need, op, n);
      if (soAberto == null && r.descoberto === 0) soAberto = n;
      if (r.descoberto === 0 && r.abaixo === 0) { tudo = n; break; }
    }
    return { soAberto, tudo };
  }

  /** equipe com nome e folgas fixas (completa até o número de funcionários) */
  function pessoasDe(e) {
    return Array.from({ length: e.funcionarios || 1 }, (_, i) => {
      const p = (e.pessoas && e.pessoas[i]) || {};
      return { nome: p.nome || (e.nomes && e.nomes[i]) || `Pessoa ${i + 1}`, folga: p.folga || 'auto', folga2: p.folga2 || 'auto' };
    });
  }
  TS.pessoasEquipe = pessoasDe;
  const mdc = (a, b) => (b ? mdc(b, a % b) : a);

  /** melhor turno de uma pessoa num dia, dada a cobertura atual (blocos de 30 min) */
  function melhorTurno(wd, cob, slotsNeed, abertura, trabMin, intervalo) {
    const ab = abertura[wd];
    if (!ab) return null;
    const [a, b] = ab;
    const len = Math.min(b - a, (trabMin + intervalo) / 30);
    const intSlots = Math.min(intervalo / 30, Math.max(0, len - trabMin / 30));
    // horários das pontas (abertura/fechamento) só são cobertos por poucos turnos: valem mais
    const nIni = Math.max(1, b - len - a + 1);
    const raro = (x) => { const lo = Math.max(a, x - len + 1), hi = Math.min(b - len, x); return 1 + 4 / Math.max(1, Math.min(nIni, hi - lo + 1)); };
    let melhor = null;
    for (let s0 = a; s0 + len <= b; s0++) {
      let pausa = null;
      if (intSlots) {
        let menor = Infinity;
        for (let x = s0 + Math.floor(len / 2) - 2; x <= s0 + Math.floor(len / 2) + 1; x++) {
          if (x < s0 + 4 || x + intSlots > s0 + len - 4) continue;
          const v = slotsNeed[wd][x] - cob[wd][x];
          if (v < menor) { menor = v; pausa = x; }
        }
        if (pausa == null) pausa = s0 + Math.floor((len - intSlots) / 2);
      }
      let ganho = 0;
      for (let x = s0; x < s0 + len; x++) {
        if (pausa != null && x >= pausa && x < pausa + intSlots) continue;
        const falta = slotsNeed[wd][x] - cob[wd][x];
        ganho += falta > 0 ? (cob[wd][x] === 0 ? 10 * raro(x) : 1) : 0;
      }
      if (!melhor || ganho > melhor.ganho) melhor = { ganho, s: s0, len, pausa, intSlots };
    }
    return melhor;
  }

  /**
   * Rodízio de domingo (semana de domingo a sábado):
   *  - no domingo trabalham pelo menos o mínimo do dia (e o que o movimento pedir); as folgas de domingo giram igualmente;
   *  - quem folga no domingo folga também na segunda;
   *  - quem trabalha no domingo folga no seu dia fixo (na 5x2, também no 2º dia fixo).
   * Devolve um ciclo de semanas que se repete.
   */
  function montarRodizio(need, op, pessoas) {
    const e = op.equipe, N = pessoas.length;
    const seis = e.escala === '6x1';
    const diasBase = seis ? 6 : 5;
    const jornada = (e.cargaSemanal * 60) / diasBase;
    const trabMin = Math.round(jornada / 30) * 30;
    const intervalo = trabMin > 360 ? Math.max(0, Math.round((e.intervalo || 0) / 30) * 30) : trabMin > 240 ? 30 : 0;
    const slotsNeed = need.map((row) => Array.from({ length: 48 }, (_, x) => row[Math.floor(x / 2)]));
    const abertura = DIAS.map((d) => { const f = op.funcionamento[d]; return f && !f.fechado ? [Math.ceil(hm(f.abre) / 30), Math.floor(hm(f.fecha) / 30)] : null; });
    const DOM = 6, SEG = 0;
    const domAberto = !!abertura[DOM];
    // quantas pessoas no domingo
    const kDom = domAberto ? Math.min(N, Math.max(...need[DOM])) : 0;
    const folgamDom = N - kDom;
    const L = folgamDom > 0 && kDom > 0 ? Math.min(8, N / mdc(N, folgamDom)) : 1;
    // dias fixos automáticos: espalha nos dias de menor movimento (ter a sáb; segunda já recebe quem folga no domingo)
    const somaDia = need.map((r) => r.reduce((a, b) => a + b, 0));
    const usados = Array(7).fill(0);
    pessoas.forEach((p) => { [p.folga, p.folga2].forEach((f) => { const i = DIAS.indexOf(f); if (i >= 0) usados[i]++; }); });
    const escolher = (evitar) => {
      let best = null;
      for (let wd = 1; wd <= 5; wd++) {
        if (evitar.includes(wd) || !abertura[wd]) continue;
        const custo = somaDia[wd] + usados[wd] * 8;
        if (best == null || custo < best[0]) best = [custo, wd];
      }
      if (best == null) for (let wd = 0; wd <= 5; wd++) if (!evitar.includes(wd)) { best = [0, wd]; break; }
      usados[best[1]]++;
      return best[1];
    };
    const fixos = pessoas.map((p) => {
      const f1 = p.folga !== 'auto' ? DIAS.indexOf(p.folga) : escolher([]);
      const f2 = seis ? null : p.folga2 !== 'auto' ? DIAS.indexOf(p.folga2) : escolher([f1]);
      return [f1, f2];
    });
    const semanas = [];
    for (let w = 0; w < L; w++) {
      const folgaDom = new Set();
      if (!domAberto) pessoas.forEach((_, i) => folgaDom.add(i));
      else for (let j = 0; j < folgamDom; j++) folgaDom.add((w * folgamDom + j) % N);
      const cob = Array.from({ length: 7 }, () => Array(48).fill(0));
      const turnosP = pessoas.map(() => Array(7).fill(null));
      const motivos = pessoas.map(() => Array(7).fill(''));
      // dias de trabalho de cada pessoa nesta semana
      const trabalha = pessoas.map((_, i) => {
        const off = new Set();
        if (folgaDom.has(i)) { off.add(DOM); if (domAberto) off.add(SEG); motivos[i][DOM] = domAberto ? 'Folga (rodízio)' : 'Fechado'; if (domAberto) motivos[i][SEG] = 'Folga (após domingo)'; }
        else { const [f1, f2] = fixos[i]; off.add(f1); motivos[i][f1] = 'Folga fixa'; if (f2 != null) { off.add(f2); motivos[i][f2] = 'Folga fixa'; } }
        if (!domAberto && !seis) { const [f1] = fixos[i]; off.add(f1); motivos[i][f1] = 'Folga fixa'; }
        return [0, 1, 2, 3, 4, 5, 6].filter((wd) => !off.has(wd) && abertura[wd]);
      });
      // primeiro o domingo (garante o mínimo), depois os outros dias; cada dia, pessoa por pessoa,
      // e depois algumas rodadas de ajuste (cada pessoa refaz o turno vendo os colegas) para fechar buracos
      const aplica = (wd, o, sinal) => { for (let x = o.s; x < o.s + o.len; x++) if (!(o.pausa != null && x >= o.pausa && x < o.pausa + o.intSlots)) cob[wd][x] += sinal; };
      for (const wd of [DOM, 0, 1, 2, 3, 4, 5]) {
        const doDia = [];
        pessoas.forEach((_, i) => {
          if (!trabalha[i].includes(wd)) return;
          const o = melhorTurno(wd, cob, slotsNeed, abertura, trabMin, intervalo);
          if (!o) return;
          aplica(wd, o, 1); doDia.push([i, o]);
        });
        for (let rodada = 0; rodada < 3; rodada++) {
          for (const par of doDia) { aplica(wd, par[1], -1); par[1] = melhorTurno(wd, cob, slotsNeed, abertura, trabMin, intervalo); aplica(wd, par[1], 1); }
        }
        for (const [i, o] of doDia) turnosP[i][wd] = { ini: o.s * 30, fim: (o.s + o.len) * 30, pausa: o.pausa != null && o.intSlots ? [o.pausa * 30, (o.pausa + o.intSlots) * 30] : null };
      }
      let descoberto = 0, abaixo = 0;
      const problemas = [];
      for (let wd = 0; wd < 7; wd++) {
        let ini = null, pior = null;
        for (let x = 0; x <= 48; x++) {
          const n = x < 48 ? slotsNeed[wd][x] : 0, c = x < 48 ? cob[wd][x] : 0;
          const falta = n > 0 && c < n;
          if (falta) { if (c === 0) descoberto += 0.5; else abaixo += 0.5; if (ini == null) { ini = x; pior = { c, n }; } else if (c < pior.c) pior = { c, n }; }
          if (!falta && ini != null) { problemas.push({ wd, ini: ini * 30, fim: x * 30, c: pior.c, n: pior.n }); ini = null; }
        }
      }
      semanas.push({ turnosP, motivos, cob, descoberto, abaixo, problemas, folgaDom });
    }
    return { semanas, L, kDom, folgamDom, trabMin, jornada, intervalo, diasBase, fixos };
  }
  TS._escala = { montarRodizio: (...a) => montarRodizio(...a) };
  const resumoRodizio = (r) => ({ descoberto: r.semanas.reduce((s, w) => s + w.descoberto, 0), abaixo: r.semanas.reduce((s, w) => s + w.abaixo, 0) });

  // ---------- editor de horário e equipe (usado aqui e em Configurações) ----------
  TS.editorOperacao = function (op, aoMudar) {
    const box = h('div', { class: 'op-editor' });
    const linhas = DIAS.map((d, i) => {
      const f = op.funcionamento[d];
      const fech = h('input', { type: 'checkbox', checked: f.fechado || null });
      const ab = h('input', { class: 'f-input', type: 'time', value: f.abre, disabled: f.fechado || null });
      const fe = h('input', { class: 'f-input', type: 'time', value: f.fecha, disabled: f.fechado || null });
      const upd = () => { f.fechado = fech.checked; f.abre = ab.value || f.abre; f.fecha = fe.value || f.fecha; ab.disabled = fe.disabled = f.fechado; aoMudar && aoMudar(); };
      [fech, ab, fe].forEach((x) => x.addEventListener('change', upd));
      return h('tr', null, h('td', { class: 'l' }, DIAS_NOME[i]), h('td', null, ab), h('td', null, fe), h('td', null, h('label', { class: 'cfg-check-l' }, fech, ' fechado')));
    });
    // feriados: horário próprio (padrão) ou igual ao dia da semana
    const fer = (op.funcionamento.feriado ||= { mesmoDoDia: true, abre: '14:00', fecha: '20:00', fechado: false });
    const fMesmo = h('input', { type: 'checkbox', checked: fer.mesmoDoDia || null });
    const fFech = h('input', { type: 'checkbox', checked: fer.fechado || null, disabled: fer.mesmoDoDia || null });
    const fAb = h('input', { class: 'f-input', type: 'time', value: fer.abre, disabled: fer.mesmoDoDia || fer.fechado || null });
    const fFe = h('input', { class: 'f-input', type: 'time', value: fer.fecha, disabled: fer.mesmoDoDia || fer.fechado || null });
    const fUpd = () => { fer.mesmoDoDia = fMesmo.checked; fer.fechado = fFech.checked; fer.abre = fAb.value || fer.abre; fer.fecha = fFe.value || fer.fecha; fFech.disabled = fer.mesmoDoDia; fAb.disabled = fFe.disabled = fer.mesmoDoDia || fer.fechado; aoMudar && aoMudar(); };
    [fMesmo, fFech, fAb, fFe].forEach((x) => x.addEventListener('change', fUpd));
    linhas.push(h('tr', { class: 'linha-feriado' }, h('td', { class: 'l' }, 'Feriados'), h('td', null, fAb), h('td', null, fFe),
      h('td', null, h('label', { class: 'cfg-check-l' }, fFech, ' fechado'), h('label', { class: 'cfg-check-l' }, fMesmo, ' igual ao dia da semana'))));
    const e = op.equipe;
    const num = (k, attrs) => { const x = h('input', { class: 'f-input', type: 'number', value: e[k], ...attrs }); x.addEventListener('change', () => { e[k] = +x.value; aoMudar && aoMudar(); }); return x; };
    const esc = h('select', { class: 'f-input' }, h('option', { value: '5x2', selected: e.escala === '5x2' || null }, '5x2 (5 dias, 2 folgas)'), h('option', { value: '6x1', selected: e.escala === '6x1' || null }, '6x1 (6 dias, 1 folga)'));
    esc.addEventListener('change', () => { e.escala = esc.value; aoMudar && aoMudar(); });
    const modelo = h('select', { class: 'f-input' },
      h('option', { value: 'livre', selected: e.modelo !== 'rodizio' || null }, 'Livre: o painel escolhe as folgas'),
      h('option', { value: 'rodizio', selected: e.modelo === 'rodizio' || null }, 'Rodízio de domingo (folga no domingo puxa a segunda)'));
    modelo.addEventListener('change', () => { e.modelo = modelo.value; aoMudar && aoMudar(); });
    const inicio = h('input', { class: 'f-input', type: 'date', value: e.inicioRodizio || '2026-01-04' });
    inicio.addEventListener('change', () => { if (inicio.value) { e.inicioRodizio = inicio.value; aoMudar && aoMudar(); } });
    const ordemSemana = [6, 0, 1, 2, 3, 4, 5]; // domingo a sábado
    e.minimoDia = e.minimoDia || {};
    const minimos = h('div', { class: 'op-minimos' }, ordemSemana.map((i) => {
      const d = DIAS[i];
      const x = h('input', { class: 'f-input', type: 'number', min: 1, max: 20, value: e.minimoDia[d] || 1 });
      x.addEventListener('change', () => { e.minimoDia[d] = Math.max(1, +x.value || 1); aoMudar && aoMudar(); });
      return h('label', null, h('span', null, DIAS_CURTO[i]), x);
    }));
    const pessoas = pessoasDe(e);
    const optsDia = (atual, comAuto) => [comAuto ? h('option', { value: 'auto', selected: atual === 'auto' || null }, 'Automático') : null,
      ...[0, 1, 2, 3, 4, 5].map((i) => h('option', { value: DIAS[i], selected: atual === DIAS[i] || null }, DIAS_NOME[i]))].filter(Boolean);
    const salvarPessoas = () => { e.pessoas = pessoas.map((p) => ({ ...p })); e.nomes = pessoas.map((p) => p.nome); };
    const linhasP = pessoas.map((p) => {
      const nome = h('input', { class: 'f-input', value: p.nome, maxlength: 40 });
      nome.addEventListener('change', () => { p.nome = nome.value.trim() || p.nome; salvarPessoas(); aoMudar && aoMudar(); });
      const f1 = h('select', { class: 'f-input' }, optsDia(p.folga, true));
      f1.addEventListener('change', () => { p.folga = f1.value; salvarPessoas(); aoMudar && aoMudar(); });
      const f2 = h('select', { class: 'f-input' }, optsDia(p.folga2, true));
      f2.addEventListener('change', () => { p.folga2 = f2.value; salvarPessoas(); aoMudar && aoMudar(); });
      return h('tr', null, h('td', null, nome), h('td', { class: 'so-rodizio' }, f1), h('td', { class: 'so-rodizio so-5x2' }, f2));
    });
    const tabP = h('table', { class: 'op-pessoas' + (e.modelo === 'rodizio' ? ' rodizio' : '') + (e.escala === '5x2' ? ' e5x2' : '') },
      h('thead', null, h('tr', null, h('th', null, 'Nome'), h('th', { class: 'so-rodizio' }, 'Folga fixa (quando trabalha no domingo)'), h('th', { class: 'so-rodizio so-5x2' }, '2ª folga (5x2)'))), h('tbody', null, linhasP));
    const campo = (rot, el, dica) => h('label', { class: 'cfg-campo' }, h('span', null, rot), el, dica ? h('small', null, dica) : null);
    box.append(
      h('div', { class: 'f-label' }, 'Horário de funcionamento'),
      h('div', { class: 'table-wrap free' }, h('table', { class: 'op-horas' }, h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Dia'), h('th', null, 'Abre'), h('th', null, 'Fecha'), h('th'))), h('tbody', null, linhas))),
      h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Jornada'),
      h('div', { class: 'cfg-grid c3' },
        campo('Funcionários', num('funcionarios', { min: 1, max: 40, step: 1 })),
        campo('Carga horária semanal (h)', num('cargaSemanal', { min: 4, max: 60, step: 1 }), '44h = 8h48 por dia na 5x2 · 7h20 na 6x1'),
        campo('Escala', esc),
        campo('Intervalo (min)', num('intervalo', { min: 0, max: 180, step: 15 }), 'Para jornadas acima de 6h.'),
        campo('Atendimentos por pessoa por hora', num('capacidade', { min: 1, max: 100, step: 1 }), 'Acima disso, precisa de mais uma pessoa.')),
      h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Regras da escala'),
      h('div', { class: 'cfg-grid' }, campo('Modelo', modelo, e.modelo === 'rodizio' ? 'Semana de domingo a sábado. As folgas de domingo giram igualmente entre a equipe.' : null),
        e.modelo === 'rodizio' ? campo('A "Semana 1" do rodízio começa no domingo', inicio, 'Use um domingo em que a Pessoa 1 folgou. A escala do mês segue a partir dele.') : null),
      h('div', { class: 'f-label', style: { marginTop: '10px' } }, 'Mínimo de pessoas na loja, por dia'),
      minimos,
      h('small', { class: 'muted' }, 'Ex.: domingo 2 = nunca fica uma pessoa sozinha no domingo.'),
      h('div', { class: 'f-label', style: { marginTop: '12px' } }, 'Equipe'),
      h('div', { class: 'table-wrap free' }, tabP));
    return box;
  };

  // ---------- página ----------
  TS.pages.mapa = function (root) {
    const db = TS.db;
    const base = TS.filtrar();
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Mapa de calor'), h('div', { class: 'page-sub' }, 'Movimento por dia da semana e hora, para montar a escala')),
      h('div', { class: 'active-filters' }, h('span', { class: 'af' }, TS.periodoTexto()))));
    const cfgMapa = state.loja && state.loja !== 'todas' ? (db.metas || []).find((m) => m.id === state.loja) : null;
    const anoI = +TS.dayToIso(db.minDay).slice(0, 4), anoF = +TS.dayToIso(db.maxDay).slice(0, 4);
    const feriadosSet = TS.datasFeriado ? TS.datasFeriado(cfgMapa, anoI, anoF) : new Set();
    const ehFeriado = (day) => feriadosSet.has(TS.dayToIso(day));
    const { lista: lista0, total, semHora } = cupons(base);
    const lista = lista0.filter((c) => !ehFeriado(c.day));
    if (!total) { root.append(TS.card(null, null, TS.empty())); return; }
    if (!lista.length) {
      root.append(h('div', { class: 'card vazio-loja' }, h('h2', null, 'Ainda sem o horário das vendas'),
        h('p', null, 'As planilhas desta loja têm só a data de cada cupom. A partir desta versão o coletor também guarda a hora (quando o AppNext informa). Depois da próxima atualização, o mapa aparece aqui; para ter o passado, use "Importar histórico" em Configurações.')));
      return;
    }
    // a média considera só os dias que já têm hora registrada (vendas antigas vieram sem hora)
    let primHora = Infinity, ultHora = -Infinity;
    for (const c of lista) { if (c.day < primHora) primHora = c.day; if (c.day > ultHora) ultHora = c.day; }
    const de = Math.max(state.f.de ?? db.minDay, db.minDay, primHora), ate = Math.min(state.f.ate ?? db.maxDay, db.maxDay, ultHora);
    const met = state.mapaMetrica || 'cupons';
    const g = grade(lista, de, ate, met, ehFeriado);
    const opInfo = operacaoDaLoja();
    if (opInfo && (!state.mapaOp || state.mapaOp.id !== opInfo.id)) state.mapaOp = opInfo;
    const op = state.mapaOp && opInfo ? state.mapaOp.op : null;

    if (semHora / total > 0.05) root.append(h('div', { class: 'notice' }, `O mapa usa só as vendas que já têm hora: de ${fmt.date(TS.dayToIso(de))} a ${fmt.date(TS.dayToIso(ate))} (${fmt.int(lista.length)} cupons). As vendas mais antigas vieram sem hora`,
      TS.eu?.pode?.configurar ? h('span', null, ' — para incluí-las, use "Importar histórico" em ', h('a', { href: '#config' }, 'Configurações'), '.') : '.'));

    // horas exibidas: abertura..fechamento (ou onde houve venda)
    let hMin = 23, hMax = 0;
    for (let wd = 0; wd < 7; wd++) for (let hr = 0; hr < 24; hr++) if (g.tot[wd][hr] > 0) { hMin = Math.min(hMin, hr); hMax = Math.max(hMax, hr); }
    if (op) DIAS.forEach((d) => { const f = op.funcionamento[d]; if (!f.fechado) { hMin = Math.min(hMin, Math.floor(hm(f.abre) / 60)); hMax = Math.max(hMax, Math.ceil(hm(f.fecha) / 60) - 1); } });
    const horas = []; for (let hr = hMin; hr <= hMax; hr++) horas.push(hr);
    const aberto = (wd, hr) => { if (!op) return true; const f = op.funcionamento[DIAS[wd]]; return !f.fechado && hr * 60 + 60 > hm(f.abre) && hr * 60 < hm(f.fecha); };

    // ---- mapa
    const fv = met === 'vt' ? fmt.brl0 : (v) => (v >= 10 ? fmt.int(v) : fmt.n1(v));
    let vmax = 0; g.media.forEach((r) => horas.forEach((hr) => { vmax = Math.max(vmax, r[hr]); }));
    const cor = (v) => { const t = vmax ? v / vmax : 0; return t <= 0 ? 'transparent' : `rgba(44, 82, 52, ${0.08 + t * 0.85})`; };
    const tab = h('table', { class: 'mapa-t' },
      h('thead', null, h('tr', null, h('th'), horas.map((hr) => h('th', null, `${hr}h`)), h('th', { class: 'tot' }, 'Dia'))),
      h('tbody', null, DIAS_CURTO.map((dn, wd) => {
        const somaDia = horas.reduce((s, hr) => s + g.media[wd][hr], 0);
        return h('tr', null, h('th', { class: 'l' }, dn), horas.map((hr) => {
          const v = g.media[wd][hr];
          const td = h('td', { class: (aberto(wd, hr) ? '' : 'fechado') + (v / vmax > 0.6 ? ' forte' : ''), style: { background: cor(v) }, title: `${DIAS_NOME[wd]}, ${hr}h–${hr + 1}h: ${fv(v)} ${met === 'cupons' ? 'atendimentos' : met === 'qtd' ? 'itens' : ''} em média · pico (80%): ${fmt.n1(g.p80[wd][hr])} atendimentos` }, v ? fv(v) : '');
          return td;
        }), h('td', { class: 'tot' }, fv(somaDia)));
      })));
    const seg = TS.seg([['Atendimentos', 'cupons'], ['Faturamento', 'vt'], ['Itens', 'qtd']], met, (v) => { state.mapaMetrica = v; TS.render(); });
    root.append(TS.cardWithTools('Movimento médio por hora', `Média por dia no período (${g.nDias.reduce((s, x) => s + x, 0)} dias, sem os feriados, que têm movimento e horário diferentes). Passe o mouse para ver o pico de cada horário.${op ? ' Hachurado = loja fechada.' : ''}`, seg,
      h('div', { class: 'table-wrap free mapa-wrap' }, tab)));

    // ---- equipe e escala
    if (!opInfo) {
      root.append(h('div', { class: 'notice mt' }, 'Para ver quantas pessoas são necessárias e a escala sugerida, escolha uma loja no seletor do topo.'));
      return;
    }
    const need = necessidade(g.p80, op);
    const ideal = equipeIdeal(need, op);
    const rodizio = op.equipe.modelo === 'rodizio';
    const esc = rodizio ? null : montarEscala(need, op, op.equipe.funcionarios);
    const nomesEq = (i) => pessoasDe(op.equipe)[i].nome;

    // necessidade
    const corNeed = (n) => (n <= 0 ? '' : n === 1 ? 'n1' : n === 2 ? 'n2' : 'n3');
    const tabNeed = h('table', { class: 'mapa-t need' },
      h('thead', null, h('tr', null, h('th'), horas.map((hr) => h('th', null, `${hr}h`)))),
      h('tbody', null, DIAS_CURTO.map((dn, wd) => h('tr', null, h('th', { class: 'l' }, dn), horas.map((hr) => {
        const n = need[wd][hr];
        return h('td', { class: n ? corNeed(n) : 'fechado', title: n ? `${DIAS_NOME[wd]} ${hr}h: ${n} pessoa(s) · pico ${fmt.n1(g.p80[wd][hr])} atendimentos/h` : 'fechado' }, n || '');
      })))));
    // trechos que pedem 2+ pessoas
    const trechos = [];
    need.forEach((row, wd) => {
      let ini = null;
      for (let hr = 0; hr <= 24; hr++) {
        const dois = hr < 24 && row[hr] >= 2;
        if (dois && ini == null) ini = hr;
        if (!dois && ini != null) { trechos.push(`${DIAS_CURTO[wd]} ${ini}h–${hr}h`); ini = null; }
      }
    });
    const horasNec = need.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0);
    const horasDisp = op.equipe.funcionarios * op.equipe.cargaSemanal;
    root.append(h('div', { class: 'grid g-kpi mt' },
      TS.kpi('Horas de trabalho necessárias', `${fmt.int(horasNec)} h/semana`, `para cobrir todos os horários e picos`),
      TS.kpi('Horas da equipe atual', `${fmt.int(horasDisp)} h/semana`, h('span', { class: horasDisp >= horasNec ? 'up' : 'down' }, `${op.equipe.funcionarios} × ${op.equipe.cargaSemanal}h · ${horasDisp >= horasNec ? 'sobra' : 'faltam'} ${fmt.int(Math.abs(horasDisp - horasNec))} h`)),
      TS.kpi('Equipe mínima', ideal.soAberto ? `${ideal.soAberto} pessoas` : '15+', 'para nunca deixar a loja sozinha'),
      TS.kpi('Equipe ideal', ideal.tudo ? `${ideal.tudo} pessoas` : 'mais de 15', 'cobrindo também os picos')));
    root.append(h('div', { class: 'grid g-2 mt mapa-grid' },
      TS.card('Pessoas necessárias por hora', `Com base no pico do horário (80% dos dias ficam abaixo) e em ${op.equipe.capacidade} atendimentos por pessoa por hora.`,
        h('div', { class: 'table-wrap free mapa-wrap' }, tabNeed),
        h('div', { class: 'mapa-leg' }, h('span', { class: 'n1' }, '1 pessoa'), h('span', { class: 'n2' }, '2 pessoas'), h('span', { class: 'n3' }, '3 ou mais')),
        trechos.length ? h('p', { class: 'mapa-trechos' }, h('b', null, 'Precisa de 2+ pessoas: '), trechos.join(' · ')) : h('p', { class: 'muted' }, 'Uma pessoa dá conta em todos os horários com essa capacidade.')),
      cartaoAjustes(opInfo)));

    const cfgLoja = (db.metas || []).find((m) => m.id === opInfo.id) || null;
    if (rodizio) {
      root.append(h('div', { class: 'mt' }, cartaoRodizio(need, op, horas, ideal)));
      const rr = montarRodizio(need, op, pessoasDe(op.equipe));
      root.append(h('div', { class: 'mt' }, cartaoMes({ op, cfg: cfgLoja, semanas: rr.semanas, L: rr.L, need, lojaNome: opInfo.nome })));
      return;
    }
    // escala
    const linhasEsc = esc.pessoas.map((turnos, i) => h('tr', null, h('th', { class: 'l' }, nomesEq(i)), turnos.map((t) => h('td', { class: t ? 'trab' : 'folga' },
      t ? [h('b', null, `${hhmm(t.ini)}–${hhmm(t.fim)}`), t.pausa ? h('small', null, `intervalo ${hhmm(t.pausa[0])}–${hhmm(t.pausa[1])}`) : null] : 'Folga'))));
    const cobertura = h('table', { class: 'mapa-t cob' },
      h('thead', null, h('tr', null, h('th'), horas.map((hr) => h('th', null, `${hr}h`)))),
      h('tbody', null, DIAS_CURTO.map((dn, wd) => h('tr', null, h('th', { class: 'l' }, dn), horas.map((hr) => {
        const n = need[wd][hr];
        if (!n) return h('td', { class: 'fechado' });
        const c = Math.min(esc.cob[wd][hr * 2], esc.cob[wd][hr * 2 + 1]);
        const cls = c === 0 ? 'vazio' : c < n ? 'falta' : c > n ? 'sobra' : 'ok';
        return h('td', { class: cls, title: `${DIAS_NOME[wd]} ${hr}h: ${c} na loja, precisa de ${n}` }, c);
      })))));
    const avisoEsc = esc.descoberto > 0
      ? h('div', { class: 'notice err' }, `Com ${op.equipe.funcionarios} pessoa(s) ficam ${fmt.n1(esc.descoberto)} h por semana com a loja sozinha. A equipe mínima para isso não acontecer é de ${ideal.soAberto || '15+'} pessoas.`)
      : esc.abaixo > 0 ? h('div', { class: 'notice' }, `Loja sempre coberta, mas faltam pessoas nos picos durante ${fmt.n1(esc.abaixo)} h por semana. ${ideal.tudo ? `Com ${ideal.tudo} pessoas os picos ficam cobertos.` : ''}`)
        : h('div', { class: 'notice ok' }, 'Essa equipe cobre todos os horários e picos.');
    root.append(h('div', { class: 'mt' }, TS.card(`Escala sugerida (${op.equipe.escala})`,
      `Jornada de ${Math.floor(esc.jornada / 60)}h${String(Math.round(esc.jornada % 60)).padStart(2, '0')} por dia (horários arredondados de 30 em 30 min)${esc.intervalo ? ` + ${esc.intervalo} min de intervalo` : ''}, ${esc.diasTrab} dias por semana. Sugestão automática: ajuste ao que combinou com a equipe e confira as regras da CLT e da convenção coletiva (ex.: folga aos domingos periodicamente).`,
      avisoEsc,
      h('div', { class: 'table-wrap free' }, h('table', { class: 'escala-t' }, h('thead', null, h('tr', null, h('th', { class: 'l' }, ''), DIAS_NOME.map((d) => h('th', null, d)))), h('tbody', null, linhasEsc))),
      h('div', { class: 'f-label', style: { marginTop: '16px' } }, 'Cobertura da escala'),
      h('div', { class: 'table-wrap free mapa-wrap' }, cobertura),
      h('div', { class: 'mapa-leg' }, h('span', { class: 'ok' }, 'na medida'), h('span', { class: 'sobra' }, 'sobra gente'), h('span', { class: 'falta' }, 'falta gente no pico'), h('span', { class: 'vazio' }, 'loja sozinha')))));
    root.append(h('div', { class: 'mt' }, cartaoMes({ op, cfg: cfgLoja, semanas: [{ turnosP: esc.pessoas, motivos: null }], L: 1, need, lojaNome: opInfo.nome })));
  };

  // ---------- escala do mês (datas reais, feriados e férias) ----------
  const ORD = [6, 0, 1, 2, 3, 4, 5]; // índice interno (seg=0..dom=6) a partir do getUTCDay()
  const wdDe = (iso) => (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const diaMs = (iso) => Date.parse(iso + 'T12:00:00Z');
  /** domingo da semana (semana de domingo a sábado) */
  const domingoDe = (iso) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };
  const INICIO_PADRAO = '2026-01-04';

  /** monta a escala de cada dia do mês: { dias:[iso], pessoas:[nome], cel[i][k] = {tipo, ini, fim, pausa, motivo} } */
  function escalaDoMes({ op, cfg, semanas, L, ym }) {
    const pessoas = pessoasDe(op.equipe);
    const nD = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
    const dias = Array.from({ length: nD }, (_, k) => `${ym}-${String(k + 1).padStart(2, '0')}`);
    const ancora = domingoDe(op.equipe.inicioRodizio || INICIO_PADRAO);
    const feriados = new Map(TS.feriadosDoMes ? TS.feriadosDoMes(cfg, ym).map((f) => [f.data, f]) : []);
    const ferias = (cfg && cfg.ferias) || [];
    const cel = pessoas.map((p) => dias.map((iso) => {
      const wd = wdDe(iso);
      const w = L > 1 ? (((Math.round((diaMs(domingoDe(iso)) - diaMs(ancora)) / (7 * 86400000)) % L) + L) % L) : 0;
      const sem = semanas[w];
      const i = pessoas.indexOf(p);
      const fer = feriados.get(iso);
      const emFerias = ferias.some((f) => String(f.vendedor).trim().toUpperCase() === p.nome.trim().toUpperCase() && f.de <= iso && f.ate >= iso);
      if (emFerias) return { tipo: 'ferias', motivo: 'Férias', semana: w };
      if (fer) {
        const hf = TS.horarioFeriado ? TS.horarioFeriado({ ...(cfg || {}), operacao: op }, iso) : null;
        if (hf && hf.fechado) return { tipo: 'fechado', motivo: `Fechado (${fer.nome})`, semana: w };
        const t = sem.turnosP[i][wd];
        if (!t) return { tipo: 'folga', motivo: (sem.motivos && sem.motivos[i][wd]) || 'Folga', feriado: fer.nome, semana: w };
        if (hf && !hf.fechado) {
          const ini = Math.max(t.ini, hm(hf.abre)), fim = Math.min(t.fim, hm(hf.fecha));
          if (fim - ini < 60) return { tipo: 'folga', motivo: 'Folga (feriado)', feriado: fer.nome, semana: w };
          return { tipo: 'trab', ini, fim, pausa: fim - ini > 360 ? t.pausa : null, feriado: fer.nome, semana: w };
        }
        return { tipo: 'trab', ...t, feriado: fer.nome, semana: w };
      }
      if (op.funcionamento[DIAS[wd]].fechado) return { tipo: 'fechado', motivo: 'Fechado', semana: w };
      const t = sem.turnosP[i][wd];
      return t ? { tipo: 'trab', ...t, semana: w } : { tipo: 'folga', motivo: (sem.motivos && sem.motivos[i][wd]) || 'Folga', semana: w };
    }));
    return { dias, pessoas, cel, feriados };
  }

  function cartaoMes({ op, cfg, semanas, L, need, lojaNome }) {
    const hoje = new Date();
    const meses = [];
    for (let k = -1; k <= 3; k++) { const d = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() + k, 1)); meses.push(d.toISOString().slice(0, 7)); }
    const ym = meses.includes(state.escMesYm) ? state.escMesYm : meses[1];
    const sel = h('select', { class: 'f-input mes-sel' }, meses.map((m) => h('option', { value: m, selected: m === ym || null }, `${TS.MESES_LONGOS[+m.slice(5, 7) - 1]} de ${m.slice(0, 4)}`)));
    sel.addEventListener('change', () => { state.escMesYm = sel.value; TS.render(); });
    const E = escalaDoMes({ op, cfg, semanas, L, ym });
    const DS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
    const curto = (m) => (m % 60 ? hhmm(m) : `${Math.floor(m / 60)}h`);
    const minimoDia = (iso) => { const wd = wdDe(iso); return Math.max(0, ...need[wd]); };
    // alertas por dia: menos gente que o mínimo/necessário
    const alertas = [];
    E.dias.forEach((iso, k) => {
      const n = E.cel.filter((row) => row[k].tipo === 'trab').length;
      const fechado = E.cel.every((row) => row[k].tipo === 'fechado');
      const min = minimoDia(iso);
      if (!fechado && min && n < min) alertas.push(`${iso.slice(8)}/${iso.slice(5, 7)}: ${n} pessoa(s) na loja, mínimo ${min}${E.cel.some((row) => row[k].tipo === 'ferias') ? ' (férias)' : ''}`);
    });
    const totais = E.cel.map((row) => {
      let min = 0, dTrab = 0;
      row.forEach((c) => { if (c.tipo === 'trab') { dTrab++; min += c.fim - c.ini - (c.pausa ? c.pausa[1] - c.pausa[0] : 0); } });
      return { min, dTrab };
    });
    const tabela = (paraPdf) => h('table', { class: 'mes-t' + (paraPdf ? ' pdf' : '') },
      h('thead', null,
        h('tr', null, h('th', { class: 'l' }, ''), E.dias.map((iso) => h('th', { class: (wdDe(iso) === 6 ? 'dom' : '') + (E.feriados.has(iso) ? ' fer' : ''), title: E.feriados.get(iso)?.nome || '' }, String(+iso.slice(8)))), h('th', null, 'Dias'), h('th', null, 'Horas')),
        h('tr', null, h('th', { class: 'l' }, ''), E.dias.map((iso) => h('th', { class: 'ds' + (wdDe(iso) === 6 ? ' dom' : '') + (E.feriados.has(iso) ? ' fer' : '') }, E.feriados.has(iso) ? 'F' : DS[new Date(iso + 'T12:00:00Z').getUTCDay()])), h('th'), h('th'))),
      h('tbody', null, E.pessoas.map((p, i) => h('tr', null, h('th', { class: 'l' }, p.nome), E.cel[i].map((c) => {
        if (c.tipo === 'trab') return h('td', { class: 'trab' + (c.feriado ? ' fer' : ''), title: `${hhmm(c.ini)}–${hhmm(c.fim)}${c.pausa ? ` · intervalo ${hhmm(c.pausa[0])}–${hhmm(c.pausa[1])}` : ''}${c.feriado ? ` · ${c.feriado}` : ''}` }, h('span', null, curto(c.ini)), h('span', null, curto(c.fim)));
        const sig = c.tipo === 'ferias' ? 'Fér' : c.tipo === 'fechado' ? '—' : /rodízio|após/.test(c.motivo) ? 'FR' : 'F';
        return h('td', { class: c.tipo + (/rodízio|após/.test(c.motivo || '') ? ' rod' : ''), title: c.motivo + (c.feriado ? ` · ${c.feriado}` : '') }, sig);
      }), h('td', { class: 'tot' }, String(totais[i].dTrab)), h('td', { class: 'tot' }, TS.horasTxt ? TS.horasTxt(totais[i].min) : curto(totais[i].min))))),
      h('tfoot', null, h('tr', null, h('th', { class: 'l' }, 'Na loja'), E.dias.map((iso, k) => {
        const n = E.cel.filter((row) => row[k].tipo === 'trab').length;
        const min = minimoDia(iso);
        const fechado = E.cel.every((row) => row[k].tipo === 'fechado');
        return h('td', { class: !fechado && min && n < min ? 'neg' : '' }, fechado ? '—' : String(n));
      }), h('td'), h('td'))));
    const legenda = () => h('div', { class: 'mes-leg' }, h('span', { class: 'l-trab' }, 'entrada / saída'), h('span', { class: 'l-folga' }, 'F = folga'), h('span', { class: 'l-rod' }, 'FR = folga do rodízio (domingo e segunda)'),
      h('span', { class: 'l-ferias' }, 'Fér = férias'), h('span', { class: 'l-fer' }, 'F no cabeçalho = feriado'), h('span', null, '— = loja fechada'));
    const ferMes = [...E.feriados.values()];
    const imprimir = () => {
      document.getElementById('impressao')?.remove();
      const el = h('div', { id: 'impressao' }, h('section', { class: 'imp-pag imp-escala' },
        h('div', { class: 'imp-cab' }, h('div', null, h('div', { class: 'imp-marca' }, 'Tea Shop'), h('div', null, lojaNome || '')),
          h('div', { class: 'imp-dir' }, h('div', { class: 'imp-tit' }, 'Escala de trabalho'), h('div', null, `${TS.MESES_LONGOS[+ym.slice(5, 7) - 1]} de ${ym.slice(0, 4)}`), h('div', null, `Escala ${op.equipe.escala}${op.equipe.modelo === 'rodizio' ? ' · rodízio de domingo' : ''}`))),
        tabela(true), legenda(),
        ferMes.length ? h('p', { class: 'imp-obs' }, 'Feriados: ' + ferMes.map((f) => `${f.data.slice(8)}/${f.data.slice(5, 7)} ${f.nome}`).join(' · ')) : null,
        alertas.length ? h('p', { class: 'imp-obs' }, 'Atenção: ' + alertas.join(' · ')) : null,
        h('p', { class: 'imp-obs' }, `Intervalo de ${op.equipe.intervalo || 0} min nas jornadas acima de 6h. Emitido em ${new Date().toLocaleString('pt-BR')}.`),
        h('div', { class: 'imp-ass' }, h('div', null, h('span'), 'Responsável pela loja'), h('div', null, h('span'), 'Ciente da equipe'))));
      document.body.append(el);
      const limpar = () => { el.remove(); window.removeEventListener('afterprint', limpar); };
      window.addEventListener('afterprint', limpar);
      setTimeout(() => window.print(), 100);
    };
    return TS.cardWithTools('Escala do mês', `Dia a dia com feriados e férias. ${L > 1 ? `O rodízio de ${L} semanas começa a contar no domingo ${TS.fmt.date(domingoDe(op.equipe.inicioRodizio || INICIO_PADRAO))} (ajuste em "Horário e equipe").` : 'A semana sugerida se repete todas as semanas.'} Passe o mouse para ver intervalo e feriado.`,
      h('div', { class: 'table-tools' }, sel, h('button', { type: 'button', class: 'btn primary', onclick: imprimir }, '⎙ Exportar PDF')),
      alertas.length ? h('div', { class: 'notice' }, h('b', null, 'Atenção: '), alertas.slice(0, 6).join(' · '), alertas.length > 6 ? ` e mais ${alertas.length - 6}` : '') : null,
      h('div', { class: 'table-wrap free' }, tabela(false)), legenda());
  }

  /** escala em rodízio de domingo: ciclo de semanas (domingo a sábado) */
  function cartaoRodizio(need, op, horas, ideal) {
    const pessoas = pessoasDe(op.equipe);
    const r = montarRodizio(need, op, pessoas);
    const ORDEM = [6, 0, 1, 2, 3, 4, 5]; // dom..sáb
    const tot = resumoRodizio(r);
    const sem = Math.min(state.escSemana || 0, r.L - 1);
    const fixosTxt = r.fixos.map(([f1, f2], i) => `${pessoas[i].nome}: ${DIAS_NOME[f1]}${f2 != null ? ' e ' + DIAS_NOME[f2] : ''}${pessoas[i].folga === 'auto' ? ' (automático)' : ''}`).join(' · ');
    const tabelaSemana = (w, idx) => h('div', { class: 'rod-semana' },
      h('div', { class: 'rod-tit' }, `Semana ${idx + 1}`, w.problemas.length ? h('span', { class: 'badge erro' }, `${w.problemas.length} alerta(s)`) : h('span', { class: 'badge ok' }, 'ok')),
      h('div', { class: 'table-wrap free' }, h('table', { class: 'escala-t' },
        h('thead', null, h('tr', null, h('th', { class: 'l' }, ''), ORDEM.map((wd) => h('th', null, DIAS_NOME[wd])))),
        h('tbody', null, pessoas.map((p, i) => h('tr', null, h('th', { class: 'l' }, p.nome), ORDEM.map((wd) => {
          const t = w.turnosP[i][wd];
          if (t) return h('td', { class: 'trab' + (wd === 6 ? ' dom' : '') }, h('b', null, `${hhmm(t.ini)}–${hhmm(t.fim)}`), t.pausa ? h('small', null, `intervalo ${hhmm(t.pausa[0])}–${hhmm(t.pausa[1])}`) : null);
          const m = w.motivos[i][wd] || (op.funcionamento[DIAS[wd]].fechado ? 'Fechado' : 'Folga');
          return h('td', { class: 'folga' + (m.includes('rodízio') || m.includes('após') ? ' rod' : '') }, m);
        })))),
        h('tfoot', null, h('tr', null, h('th', { class: 'l' }, 'Na loja'), ORDEM.map((wd) => {
          const n = pessoas.filter((_, i) => w.turnosP[i][wd]).length;
          const min = Math.max(...need[wd]);
          return h('td', { class: n < min && min > 0 ? 'neg' : 'muted' }, min ? `${n} pessoa(s)` : '—');
        }))))),
      w.problemas.length ? h('ul', { class: 'rod-prob' }, w.problemas.slice(0, 8).map((pb) => h('li', null, `${DIAS_NOME[pb.wd]} ${hhmm(pb.ini)}–${hhmm(pb.fim)}: ${pb.c === 0 ? 'loja sozinha (ninguém)' : `${pb.c} pessoa(s)`}, precisa de ${pb.n}`))) : null);
    const seg = r.L > 1 ? TS.seg(r.semanas.map((_, i) => [`Semana ${i + 1}`, String(i)]), String(sem), (v) => { state.escSemana = +v; TS.render(); }) : null;
    const w = r.semanas[sem];
    const cobertura = h('table', { class: 'mapa-t cob' },
      h('thead', null, h('tr', null, h('th'), horas.map((hr) => h('th', null, `${hr}h`)))),
      h('tbody', null, ORDEM.map((wd) => h('tr', null, h('th', { class: 'l' }, DIAS_CURTO[wd]), horas.map((hr) => {
        const n = need[wd][hr];
        if (!n) return h('td', { class: 'fechado' });
        const c = Math.min(w.cob[wd][hr * 2], w.cob[wd][hr * 2 + 1]);
        const cls = c === 0 ? 'vazio' : c < n ? 'falta' : c > n ? 'sobra' : 'ok';
        return h('td', { class: cls, title: `${DIAS_NOME[wd]} ${hr}h: ${c} na loja, precisa de ${n}` }, c);
      })))));
    const aviso = tot.descoberto > 0
      ? h('div', { class: 'notice err' }, `Com ${pessoas.length} pessoa(s) e essas regras, a loja fica sem ninguém ${fmt.n1(tot.descoberto / r.L)} h por semana em média.${ideal.soAberto ? ` Equipe mínima: ${ideal.soAberto} pessoas.` : ''}`)
      : tot.abaixo > 0 ? h('div', { class: 'notice' }, `A loja nunca fica sozinha, mas faltam pessoas nos picos ou no mínimo do dia em ${fmt.n1(tot.abaixo / r.L)} h por semana, em média. Veja os alertas de cada semana.${ideal.tudo ? ` Com ${ideal.tudo} pessoas fica tudo coberto.` : ''}`)
        : h('div', { class: 'notice ok' }, 'Essa equipe cumpre o rodízio, os mínimos de cada dia e os picos.');
    return TS.cardWithTools(`Escala sugerida · rodízio de domingo (${op.equipe.escala})`,
      `Semana de domingo a sábado. ${r.kDom ? `${r.kDom} pessoa(s) trabalham em cada domingo; ${r.folgamDom} folga(m) — e folga(m) também na segunda.` : 'Loja fechada no domingo.'} O ciclo se repete a cada ${r.L} semana(s). Jornada de ${Math.floor(r.jornada / 60)}h${String(Math.round(r.jornada % 60)).padStart(2, '0')} por dia${r.intervalo ? ` + ${r.intervalo} min de intervalo` : ''}. Confira a CLT e a convenção coletiva.`,
      seg, aviso,
      h('p', { class: 'muted rod-fixos' }, h('b', null, 'Folgas fixas (semanas em que trabalha no domingo): '), fixosTxt),
      tabelaSemana(w, sem),
      h('div', { class: 'f-label', style: { marginTop: '16px' } }, `Cobertura da semana ${sem + 1}`),
      h('div', { class: 'table-wrap free mapa-wrap' }, cobertura),
      h('div', { class: 'mapa-leg' }, h('span', { class: 'ok' }, 'na medida'), h('span', { class: 'sobra' }, 'sobra gente'), h('span', { class: 'falta' }, 'abaixo do necessário'), h('span', { class: 'vazio' }, 'ninguém')));
  }

  /** ajustes da simulação (horário e equipe); quem pode configurar também salva na loja */
  function cartaoAjustes(opInfo) {
    const op = state.mapaOp.op;
    const pode = TS.eu?.pode?.configurar && !TS.demo;
    const ed = TS.editorOperacao(op, () => TS.render());
    const acoes = h('div', { class: 'cfg-acoes' });
    if (pode) {
      const b = h('button', { type: 'button', class: 'btn primary' }, 'Salvar na loja');
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const r = await fetch(`/api/admin/lojas/${encodeURIComponent(opInfo.id)}/operacao`, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ operacao: op }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
          b.textContent = 'Salvo ✓';
          TS.recarregar && TS.recarregar(true);
        } catch (e) { b.textContent = e.message; } finally { b.disabled = false; }
      });
      acoes.append(b);
    }
    acoes.append(h('button', { type: 'button', class: 'btn', onclick: () => { state.mapaOp = null; TS.render(); } }, 'Desfazer mudanças'));
    return TS.card('Horário e equipe', opInfo.salva ? 'Mude os valores para simular; a escala se recalcula na hora.' : 'Ainda não cadastrado para esta loja: os valores abaixo são um exemplo. Ajuste e salve.', ed, acoes);
  }
})();
