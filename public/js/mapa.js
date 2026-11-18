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
      c.vt += db.vt[i] || 0; c.qtd += TS.qtdItem(i);
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
    const maxF = Math.max(1, Math.min(10, Math.round(+e.maxFolgaDia || 1)));
    const folgasDia = Array(7).fill(0);
    const prefs = Array.from({ length: nFunc }, (_, i) => ((e.pessoas && e.pessoas[i]) || {}).turno);
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
          ganho += 2 * encaixe(prefs[p], s, len, ab); // preferência de turno (menos que cobrir horário vazio)
          if (!melhor || ganho > melhor.ganho) melhor = { ganho, s, len, pausa, intSlots };
        }
        opcoes.push(melhor);
      }
      // trabalha nos dias de maior ganho; folga nos demais
      const ordem = opcoes.map((o, wd) => [o ? o.ganho : -1, wd]).filter(([g]) => g >= 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      // folga nos dias de menor ganho, sem passar do limite de folgas no mesmo dia
      const nOff = Math.max(0, ordem.length - diasTrab);
      const porFolga = ordem.slice().sort((x, y) => ((folgasDia[x[1]] >= maxF) - (folgasDia[y[1]] >= maxF)) || x[0] - y[0] || folgasDia[x[1]] - folgasDia[y[1]]);
      const off = new Set(porFolga.slice(0, nOff).map(([, wd]) => wd));
      off.forEach((wd) => { folgasDia[wd]++; });
      const trab = new Set(ordem.filter(([, wd]) => !off.has(wd)).map(([, wd]) => wd));
      const turnos = opcoes.map((o, wd) => {
        if (!o || !trab.has(wd)) return null;
        for (let x = o.s; x < o.s + o.len; x++) if (!(o.pausa != null && x >= o.pausa && x < o.pausa + o.intSlots)) cob[wd][x]++;
        return { ini: o.s * 30, fim: (o.s + o.len) * 30, pausa: o.pausa != null && o.intSlots ? [o.pausa * 30, (o.pausa + o.intSlots) * 30] : null };
      });
      pessoas.push(turnos);
    }
    // troca turnos do mesmo dia entre pessoas quando respeita melhor as preferências
    for (let wd = 0; wd < 7; wd++) {
      const ab = abertura[wd];
      if (!ab) continue;
      const lista = pessoas.map((t, i) => (t[wd] ? { i, pref: prefs[i], o: { s: t[wd].ini / 30, len: (t[wd].fim - t[wd].ini) / 30, t: t[wd] } } : null)).filter(Boolean);
      trocarPorPreferencia(lista, ab);
      lista.forEach((x) => { pessoas[x.i][wd] = x.o.t; });
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
      return { nome: p.nome || (e.nomes && e.nomes[i]) || `Pessoa ${i + 1}`, folga: p.folga || 'auto', folga2: p.folga2 || 'auto', turno: p.turno === 'manha' || p.turno === 'noite' ? p.turno : 'tanto' };
    });
  }
  /** quanto um turno combina com a preferência (0 a 1): manhã = começar cedo, noite = terminar no fechamento */
  function encaixe(pref, s0, len, ab) {
    if (!ab || (pref !== 'manha' && pref !== 'noite')) return 0;
    const vao = ab[1] - len - ab[0];
    if (vao <= 0) return 0;
    const t = Math.min(1, Math.max(0, (s0 - ab[0]) / vao));
    return pref === 'manha' ? 1 - t : t;
  }
  const PESO_PREF = 6; // vale menos que deixar a loja sozinha, mais que reforço de pico
  /** troca turnos entre duas pessoas do mesmo dia quando a troca respeita melhor as preferências (a cobertura não muda) */
  function trocarPorPreferencia(lista, ab) {
    // lista: [{ pref, o: {s,len,...} }]
    for (let r = 0; r < 3; r++) {
      let mudou = false;
      for (let a = 0; a < lista.length; a++) for (let b = a + 1; b < lista.length; b++) {
        const A = lista[a], B = lista[b];
        if (!A.o || !B.o) continue;
        const agora = encaixe(A.pref, A.o.s, A.o.len, ab) + encaixe(B.pref, B.o.s, B.o.len, ab);
        const trocado = encaixe(A.pref, B.o.s, B.o.len, ab) + encaixe(B.pref, A.o.s, A.o.len, ab);
        if (trocado > agora + 1e-9) { const t = A.o; A.o = B.o; B.o = t; mudou = true; }
      }
      if (!mudou) break;
    }
  }
  TS.pessoasEquipe = pessoasDe;
  const mdc = (a, b) => (b ? mdc(b, a % b) : a);

  /** melhor turno de uma pessoa num dia, dada a cobertura atual (blocos de 30 min) */
  function melhorTurno(wd, cob, slotsNeed, abertura, trabMin, intervalo, pref) {
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
      ganho += PESO_PREF * encaixe(pref, s0, len, ab);
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
    // no máximo maxF pessoas de folga no mesmo dia (domingo incluído)
    const maxF = Math.max(1, Math.min(10, Math.round(+e.maxFolgaDia || 1)));
    const kDom = domAberto ? Math.min(N, Math.max(Math.max(...need[DOM]), N - maxF)) : 0;
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
      // folgas da semana: quem folga no domingo folga também na segunda; os demais folgam no(s) dia(s) fixo(s).
      // Dia "automático" é escolhido semana a semana, sem passar do limite de folgas no mesmo dia.
      const cont = Array(7).fill(0);
      const offs = pessoas.map(() => new Set());
      const folgasSem = pessoas.map(() => []);
      pessoas.forEach((_, i) => {
        if (!domAberto) { offs[i].add(DOM); motivos[i][DOM] = 'Fechado'; return; }
        if (folgaDom.has(i)) { offs[i].add(DOM); offs[i].add(SEG); cont[DOM]++; cont[SEG]++; motivos[i][DOM] = 'Folga (rodízio)'; motivos[i][SEG] = 'Folga (após domingo)'; }
      });
      const precisa = (i) => (domAberto ? (folgaDom.has(i) ? 0 : seis ? 1 : 2) : seis ? 0 : 1);
      const manuais = (i) => [pessoas[i].folga, pessoas[i].folga2].filter((f) => f && f !== 'auto').length;
      const ordemP = pessoas.map((_, i) => i).sort((x, y) => manuais(y) - manuais(x) || ((x - w + N * 9) % N) - ((y - w + N * 9) % N));
      for (const i of ordemP) {
        const cfgDias = [pessoas[i].folga, pessoas[i].folga2];
        for (let j = 0; j < precisa(i); j++) {
          let d = cfgDias[j] && cfgDias[j] !== 'auto' ? DIAS.indexOf(cfgDias[j]) : -1;
          const manual = d >= 0 && !offs[i].has(d);
          if (!manual) {
            let best = null;
            for (let wd = 0; wd <= 5; wd++) {
              if (offs[i].has(wd) || !abertura[wd]) continue;
              const custo = (cont[wd] >= maxF ? 1e6 : 0) + (wd === fixos[i][j] ? 0 : 100) + somaDia[wd] + cont[wd] * 20;
              if (!best || custo < best[0]) best = [custo, wd];
            }
            if (!best) continue;
            d = best[1];
          }
          offs[i].add(d); cont[d]++; folgasSem[i].push(d);
          motivos[i][d] = manual ? 'Folga fixa' : 'Folga';
        }
      }
      const excesso = [0, 1, 2, 3, 4, 5, 6].filter((wd) => abertura[wd] && cont[wd] > maxF);
      const trabalha = pessoas.map((_, i) => [0, 1, 2, 3, 4, 5, 6].filter((wd) => !offs[i].has(wd) && abertura[wd]));
      // primeiro o domingo (garante o mínimo), depois os outros dias; cada dia, pessoa por pessoa,
      // e depois algumas rodadas de ajuste (cada pessoa refaz o turno vendo os colegas) para fechar buracos
      const aplica = (wd, o, sinal) => { for (let x = o.s; x < o.s + o.len; x++) if (!(o.pausa != null && x >= o.pausa && x < o.pausa + o.intSlots)) cob[wd][x] += sinal; };
      for (const wd of [DOM, 0, 1, 2, 3, 4, 5]) {
        const doDia = [];
        pessoas.forEach((_, i) => {
          if (!trabalha[i].includes(wd)) return;
          const o = melhorTurno(wd, cob, slotsNeed, abertura, trabMin, intervalo, pessoas[i].turno);
          if (!o) return;
          aplica(wd, o, 1); doDia.push([i, o]);
        });
        for (let rodada = 0; rodada < 3; rodada++) {
          for (const par of doDia) { aplica(wd, par[1], -1); par[1] = melhorTurno(wd, cob, slotsNeed, abertura, trabMin, intervalo, pessoas[par[0]].turno); aplica(wd, par[1], 1); }
        }
        { const lista = doDia.map(([i, o]) => ({ pref: pessoas[i].turno, o })); trocarPorPreferencia(lista, abertura[wd]); lista.forEach((x, k) => { doDia[k][1] = x.o; }); }
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
      semanas.push({ turnosP, motivos, cob, descoberto, abaixo, problemas, folgaDom, folgasSem, excesso });
    }
    return { semanas, L, kDom, folgamDom, trabMin, jornada, intervalo, diasBase, fixos, maxF };
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
      fech.addEventListener('change', upd); [ab, fe].forEach((x) => TS.aoConfirmar(x, upd));
      return h('tr', null, h('td', { class: 'l' }, DIAS_NOME[i]), h('td', null, ab), h('td', null, fe), h('td', null, h('label', { class: 'cfg-check-l' }, fech, ' fechado')));
    });
    // feriados: horário próprio (padrão) ou igual ao dia da semana
    const fer = (op.funcionamento.feriado ||= { mesmoDoDia: true, abre: '14:00', fecha: '20:00', fechado: false });
    const fMesmo = h('input', { type: 'checkbox', checked: fer.mesmoDoDia || null });
    const fFech = h('input', { type: 'checkbox', checked: fer.fechado || null, disabled: fer.mesmoDoDia || null });
    const fAb = h('input', { class: 'f-input', type: 'time', value: fer.abre, disabled: fer.mesmoDoDia || fer.fechado || null });
    const fFe = h('input', { class: 'f-input', type: 'time', value: fer.fecha, disabled: fer.mesmoDoDia || fer.fechado || null });
    const fUpd = () => { fer.mesmoDoDia = fMesmo.checked; fer.fechado = fFech.checked; fer.abre = fAb.value || fer.abre; fer.fecha = fFe.value || fer.fecha; fFech.disabled = fer.mesmoDoDia; fAb.disabled = fFe.disabled = fer.mesmoDoDia || fer.fechado; aoMudar && aoMudar(); };
    [fMesmo, fFech].forEach((x) => x.addEventListener('change', fUpd)); [fAb, fFe].forEach((x) => TS.aoConfirmar(x, fUpd));
    linhas.push(h('tr', { class: 'linha-feriado' }, h('td', { class: 'l' }, 'Feriados'), h('td', null, fAb), h('td', null, fFe),
      h('td', null, h('label', { class: 'cfg-check-l' }, fFech, ' fechado'), h('label', { class: 'cfg-check-l' }, fMesmo, ' igual ao dia da semana'))));
    const e = op.equipe;
    const num = (k, attrs) => { const x = h('input', { class: 'f-input', type: 'number', value: e[k], ...attrs }); TS.aoConfirmar(x, () => { e[k] = +x.value; aoMudar && aoMudar(); }); return x; };
    const esc = h('select', { class: 'f-input' }, h('option', { value: '5x2', selected: e.escala === '5x2' || null }, '5x2 (5 dias, 2 folgas)'), h('option', { value: '6x1', selected: e.escala === '6x1' || null }, '6x1 (6 dias, 1 folga)'));
    esc.addEventListener('change', () => { e.escala = esc.value; aoMudar && aoMudar(); });
    const modelo = h('select', { class: 'f-input' },
      h('option', { value: 'livre', selected: e.modelo !== 'rodizio' || null }, 'Livre: o painel escolhe as folgas'),
      h('option', { value: 'rodizio', selected: e.modelo === 'rodizio' || null }, 'Rodízio de domingo (folga no domingo puxa a segunda)'));
    modelo.addEventListener('change', () => { e.modelo = modelo.value; aoMudar && aoMudar(); });
    const inicio = h('input', { class: 'f-input', type: 'date', value: e.inicioRodizio || '2026-01-04' });
    TS.aoConfirmar(inicio, () => { if (inicio.value) { e.inicioRodizio = inicio.value; aoMudar && aoMudar(); } });
    const ordemSemana = [6, 0, 1, 2, 3, 4, 5]; // domingo a sábado
    e.minimoDia = e.minimoDia || {};
    if (e.maxFolgaDia == null) e.maxFolgaDia = 1;
    const minimos = h('div', { class: 'op-minimos' }, ordemSemana.map((i) => {
      const d = DIAS[i];
      const x = h('input', { class: 'f-input', type: 'number', min: 1, max: 20, value: e.minimoDia[d] || 1 });
      TS.aoConfirmar(x, () => { e.minimoDia[d] = Math.max(1, +x.value || 1); aoMudar && aoMudar(); });
      return h('label', null, h('span', null, DIAS_CURTO[i]), x);
    }));
    const pessoas = pessoasDe(e);
    const optsDia = (atual, comAuto) => [comAuto ? h('option', { value: 'auto', selected: atual === 'auto' || null }, 'Automático') : null,
      ...[0, 1, 2, 3, 4, 5].map((i) => h('option', { value: DIAS[i], selected: atual === DIAS[i] || null }, DIAS_NOME[i]))].filter(Boolean);
    const salvarPessoas = () => { e.pessoas = pessoas.map((p) => ({ ...p })); e.nomes = pessoas.map((p) => p.nome); };
    const linhasP = pessoas.map((p) => {
      const nome = h('input', { class: 'f-input', value: p.nome, maxlength: 40 });
      TS.aoConfirmar(nome, () => { p.nome = nome.value.trim() || p.nome; salvarPessoas(); aoMudar && aoMudar(); });
      const f1 = h('select', { class: 'f-input' }, optsDia(p.folga, true));
      f1.addEventListener('change', () => { p.folga = f1.value; salvarPessoas(); aoMudar && aoMudar(); });
      const f2 = h('select', { class: 'f-input' }, optsDia(p.folga2, true));
      f2.addEventListener('change', () => { p.folga2 = f2.value; salvarPessoas(); aoMudar && aoMudar(); });
      const tu = h('select', { class: 'f-input' }, [['tanto', 'Tanto faz'], ['manha', 'Manhã'], ['noite', 'Noite']].map(([v, t]) => h('option', { value: v, selected: p.turno === v || null }, t)));
      tu.addEventListener('change', () => { p.turno = tu.value; salvarPessoas(); aoMudar && aoMudar(); });
      return h('tr', null, h('td', null, nome), h('td', null, tu), h('td', { class: 'so-rodizio' }, f1), h('td', { class: 'so-rodizio so-5x2' }, f2));
    });
    const tabP = h('table', { class: 'op-pessoas' + (e.modelo === 'rodizio' ? ' rodizio' : '') + (e.escala === '5x2' ? ' e5x2' : '') },
      h('thead', null, h('tr', null, h('th', null, 'Nome'), h('th', { title: 'Manhã = abre a loja · Noite = fecha a loja. A escala respeita ao máximo, sem deixar a loja descoberta.' }, 'Prefere trabalhar'), h('th', { class: 'so-rodizio' }, 'Folga fixa (quando trabalha no domingo)'), h('th', { class: 'so-rodizio so-5x2' }, '2ª folga (5x2)'))), h('tbody', null, linhasP));
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
      h('div', { class: 'cfg-grid', style: { marginTop: '10px' } }, campo('Máximo de pessoas de folga no mesmo dia', num('maxFolgaDia', { min: 1, max: 10, step: 1 }), 'Vale para todos os dias, inclusive domingo. Padrão: 1.')),
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
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Movimento e escala'), h('div', { class: 'page-sub' }, 'Movimento por dia da semana e hora, para montar a escala')),
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
      TS.kpi('Equipe ideal', ideal.tudo ? `${ideal.tudo} pessoas` : 'mais de 15', 'cobrindo também os picos')),
      h('details', { class: 'mapa-como' }, h('summary', null, 'Como esses números são calculados'),
        h('ol', null,
          h('li', null, `Para cada dia da semana e hora aberta, pega o movimento de pico (o número de atendimentos que 80% dos dias não passam) e divide por ${op.equipe.capacidade} atendimentos por pessoa por hora. Nunca fica abaixo do mínimo de pessoas do dia. Isso dá as "pessoas necessárias por hora".`),
          h('li', null, `Horas necessárias = soma dessas pessoas em todas as horas da semana. Horas da equipe = funcionários × ${op.equipe.cargaSemanal} h.`),
          h('li', null, `O painel monta a escala de verdade com 1, 2, 3… pessoas, usando as regras configuradas (${op.equipe.escala}, jornada, intervalo de ${op.equipe.intervalo} min, ${op.equipe.modelo === 'rodizio' ? 'rodízio de domingo, ' : ''}no máximo ${op.equipe.maxFolgaDia || 1} de folga por dia).`),
          h('li', null, h('b', null, 'Equipe mínima'), ': o menor número de pessoas em que nenhum horário fica com a loja sozinha (zero pessoas).'),
          h('li', null, h('b', null, 'Equipe ideal'), ': o menor número em que, além disso, todos os picos e o mínimo de cada dia ficam cobertos.')),
        h('p', { class: 'muted' }, 'A equipe pode ser maior que horas ÷ carga porque folgas, jornada máxima e intervalo não deixam encaixar as horas perfeitamente.')));
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
  function escalaDoMes({ op, cfg, semanas, L, ym, need, ajustes }) {
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
    // ajustes manuais: travam a escolha e recalculam os turnos das outras pessoas naquele dia
    if (ajustes && need) {
      const e = op.equipe;
      const diasBase = e.escala === '6x1' ? 6 : 5;
      const trabMin = Math.round(((e.cargaSemanal * 60) / diasBase) / 30) * 30;
      const intervalo = trabMin > 360 ? Math.max(0, Math.round((e.intervalo || 0) / 30) * 30) : trabMin > 240 ? 30 : 0;
      dias.forEach((iso, k) => {
        const aj = ajustes[iso];
        if (!aj || !Object.keys(aj).length) return;
        const wd = wdDe(iso);
        const fer = feriados.get(iso);
        const hf = fer && TS.horarioFeriado ? TS.horarioFeriado({ ...(cfg || {}), operacao: op }, iso) : null;
        const f = op.funcionamento[DIAS[wd]];
        const ab = hf && !hf.fechado ? [Math.ceil(hm(hf.abre) / 30), Math.floor(hm(hf.fecha) / 30)] : !f.fechado ? [Math.ceil(hm(f.abre) / 30), Math.floor(hm(f.fecha) / 30)] : null;
        const sNeed = [Array.from({ length: 48 }, (_, x) => (ab && x >= ab[0] && x < ab[1] ? need[wd][Math.floor(x / 2)] || 1 : 0))];
        const cob = [Array(48).fill(0)];
        const aplica = (c, sinal) => { if (c && c.tipo === 'trab') for (let x = Math.floor(c.ini / 30); x < Math.ceil(c.fim / 30); x++) if (!(c.pausa && x * 30 >= c.pausa[0] && x * 30 < c.pausa[1])) cob[0][x] += sinal; };
        // travados
        pessoas.forEach((p, i) => {
          const a = aj[p.nome.trim().toUpperCase()];
          if (!a) return;
          if (a.tipo === 'folga') cel[i][k] = { tipo: 'folga', motivo: 'Folga (ajuste)', aj: true, feriado: fer && fer.nome };
          else {
            const ini = hm(a.ini), fim = hm(a.fim), dur = fim - ini;
            let pausa = null;
            if (dur > 360 && e.intervalo) { const m = Math.round((ini + (dur - e.intervalo) / 2) / 30) * 30; pausa = [m, m + e.intervalo]; }
            cel[i][k] = { tipo: 'trab', ini, fim, pausa, aj: true, feriado: fer && fer.nome };
          }
          aplica(cel[i][k], 1);
        });
        // os demais que trabalham no dia: refazem o turno vendo os travados
        const livres = pessoas.map((p, i) => i).filter((i) => !aj[pessoas[i].nome.trim().toUpperCase()] && cel[i][k].tipo === 'trab');
        if (!ab) return;
        const turno = (o) => ({ tipo: 'trab', ini: o.s * 30, fim: (o.s + o.len) * 30, pausa: o.pausa != null && o.intSlots ? [o.pausa * 30, (o.pausa + o.intSlots) * 30] : null, feriado: fer && fer.nome, recalc: true });
        for (const i of livres) { const o = melhorTurno(0, cob, sNeed, [ab], trabMin, intervalo, pessoas[i].turno); if (o) { cel[i][k] = turno(o); aplica(cel[i][k], 1); } }
        for (let r = 0; r < 2; r++) for (const i of livres) { aplica(cel[i][k], -1); const o = melhorTurno(0, cob, sNeed, [ab], trabMin, intervalo, pessoas[i].turno); if (o) cel[i][k] = turno(o); aplica(cel[i][k], 1); }
        { // troca entre os recalculados quando respeita melhor a preferência (mesma duração)
          const lista = livres.filter((i) => cel[i][k].tipo === 'trab').map((i) => ({ i, pref: pessoas[i].turno, o: { s: cel[i][k].ini / 30, len: (cel[i][k].fim - cel[i][k].ini) / 30, c: cel[i][k] } }));
          trocarPorPreferencia(lista, ab);
          lista.forEach((x) => { cel[x.i][k] = x.o.c; });
        }
      });
    }
    return { dias, pessoas, cel, feriados };
  }

  function cartaoMes({ op, cfg, semanas, L, need, lojaNome }) {
    const hoje = new Date();
    const meses = [];
    for (let k = -1; k <= 3; k++) { const d = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() + k, 1)); meses.push(d.toISOString().slice(0, 7)); }
    const ym = meses.includes(state.escMesYm) ? state.escMesYm : meses[1];
    const sel = h('select', { class: 'f-input mes-sel' }, meses.map((m) => h('option', { value: m, selected: m === ym || null }, `${TS.MESES_LONGOS[+m.slice(5, 7) - 1]} de ${m.slice(0, 4)}`)));
    sel.addEventListener('change', () => { state.escMesYm = sel.value; TS.render(); });
    // ajustes manuais do mês (cópia de trabalho até salvar)
    const chaveAj = `${(cfg && cfg.id) || 'loja'}|${ym}`;
    if (!state.escAj || state.escAj.chave !== chaveAj) state.escAj = { chave: chaveAj, dados: JSON.parse(JSON.stringify(((cfg && cfg.escalaAjustes) || {})[ym] || {})), sujo: false, sel: null };
    const AJ = state.escAj;
    const pode = !TS.demo && (TS.eu?.pode?.configurar || (TS.eu?.perfil === 'gerente' && (TS.eu.telas || []).includes('mapa')));
    const E = escalaDoMes({ op, cfg, semanas, L, ym, need, ajustes: AJ.dados });
    const nAj = Object.values(AJ.dados).reduce((s, o) => s + Object.keys(o).length, 0);
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
    const bruto = (c) => (c.tipo === 'trab' ? c.fim - c.ini : 0);
    const liquido = (c) => (c.tipo === 'trab' ? c.fim - c.ini - (c.pausa ? c.pausa[1] - c.pausa[0] : 0) : 0);
    const hTxt = (m) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;
    // semanas de domingo a sábado que cobrem o mês
    const semanasMes = [];
    for (let k = 0; k < E.dias.length;) {
      const dom = domingoDe(E.dias[k]);
      const datas = Array.from({ length: 7 }, (_, j) => { const d = new Date(dom + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + j); return d.toISOString().slice(0, 10); });
      semanasMes.push(datas);
      k = E.dias.indexOf(datas[6]) + 1 || E.dias.length;
    }
    const DSN = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const celula = (i, iso, paraPdf) => {
      const k = E.dias.indexOf(iso);
      if (k < 0) return h('td', { class: 'fora' });
      const c = E.cel[i][k];
      const sel = !paraPdf && AJ.sel && AJ.sel.iso === iso && AJ.sel.i === i;
      const extra = (c.aj ? ' aj' : '') + (c.recalc ? ' recalc' : '') + (sel ? ' sel' : '') + (paraPdf ? '' : ' clicavel');
      const clique = paraPdf || c.tipo === 'ferias' || c.tipo === 'fechado' ? null : () => { AJ.sel = { iso, i }; TS.render(); };
      const marca = c.aj ? (paraPdf ? '*' : ' •') : '';
      if (c.tipo === 'trab') {
        return h('td', { class: 'trab' + (c.feriado ? ' fer' : '') + extra, onclick: clique, title: `${c.feriado ? c.feriado + ' · ' : ''}${c.aj ? 'ajuste manual' : c.recalc ? 'recalculado por causa de um ajuste' : ''}` },
          h('b', null, `${hhmm(c.ini)}–${hhmm(c.fim)}${marca}`), c.pausa ? h('small', null, `int. ${hhmm(c.pausa[0])}–${hhmm(c.pausa[1])}`) : null);
      }
      const txt = c.tipo === 'ferias' ? 'Férias' : c.tipo === 'fechado' ? 'Fechado' : /rodízio|após/.test(c.motivo || '') ? 'Folga (rodízio)' : 'Folga';
      return h('td', { class: c.tipo + (/rodízio|após/.test(c.motivo || '') ? ' rod' : '') + extra, onclick: clique, title: (c.motivo || '') + (c.feriado ? ` · ${c.feriado}` : '') }, txt + marca);
    };
    const blocoSemana = (datas, n, paraPdf) => {
      const dentro = datas.filter((d) => E.dias.includes(d));
      return h('table', { class: 'sem-t' + (paraPdf ? ' pdf' : '') },
        h('thead', null,
          h('tr', null, h('th', { class: 'l sem-nome' }, `Semana ${n}`, h('small', null, ` ${dentro[0].slice(8)}/${dentro[0].slice(5, 7)} a ${dentro[dentro.length - 1].slice(8)}/${dentro[dentro.length - 1].slice(5, 7)}`)),
            datas.map((d, j) => {
              const fer = E.feriados.get(d);
              return h('th', { class: (j === 0 ? 'dom' : '') + (fer ? ' fer' : '') + (E.dias.includes(d) ? '' : ' fora'), title: fer ? fer.nome : '' }, h('span', null, DSN[j]), h('b', null, `${d.slice(8)}/${d.slice(5, 7)}`), fer ? h('small', null, fer.nome) : null);
            }),
            h('th', { class: 'tot' }, 'Total'), h('th', { class: 'tot' }, 'Líquida'))),
        h('tbody', null, E.pessoas.map((p, i) => {
          let tb = 0, tl = 0;
          datas.forEach((d) => { const k = E.dias.indexOf(d); if (k >= 0) { tb += bruto(E.cel[i][k]); tl += liquido(E.cel[i][k]); } });
          return h('tr', null, h('th', { class: 'l' }, p.nome), datas.map((d) => celula(i, d, paraPdf)), h('td', { class: 'tot' }, hTxt(tb)), h('td', { class: 'tot liq' }, hTxt(tl)));
        })),
        h('tfoot', null, h('tr', null, h('th', { class: 'l' }, 'Na loja'), datas.map((d) => {
          const k = E.dias.indexOf(d);
          if (k < 0) return h('td', { class: 'fora' });
          const nP = E.cel.filter((row) => row[k].tipo === 'trab').length;
          const fechado = E.cel.every((row) => row[k].tipo === 'fechado');
          const min = minimoDia(d);
          return h('td', { class: !fechado && min && nP < min ? 'neg' : '' }, fechado ? '—' : `${nP} pessoa${nP === 1 ? '' : 's'}`);
        }), h('td'), h('td'))));
    };
    const resumoMes = (paraPdf) => h('table', { class: 'sem-t resumo' + (paraPdf ? ' pdf' : '') },
      h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Resumo do mês'), h('th', null, 'Dias trabalhados'), h('th', null, 'Folgas'), h('th', null, 'Férias'), h('th', { class: 'tot' }, 'Horas totais'), h('th', { class: 'tot' }, 'Horas líquidas'))),
      h('tbody', null, E.pessoas.map((p, i) => {
        const row = E.cel[i];
        return h('tr', null, h('th', { class: 'l' }, p.nome), h('td', null, String(row.filter((c) => c.tipo === 'trab').length)), h('td', null, String(row.filter((c) => c.tipo === 'folga').length)),
          h('td', null, String(row.filter((c) => c.tipo === 'ferias').length)), h('td', { class: 'tot' }, hTxt(row.reduce((s, c) => s + bruto(c), 0))), h('td', { class: 'tot liq' }, hTxt(row.reduce((s, c) => s + liquido(c), 0))));
      })));
    const tabela = (paraPdf) => h('div', { class: 'semanas' }, semanasMes.map((datas, n) => blocoSemana(datas, n + 1, paraPdf)), resumoMes(paraPdf));
    const legenda = () => h('div', { class: 'mes-leg' }, h('span', { class: 'l-trab' }, 'entrada–saída (int. = intervalo)'), h('span', { class: 'l-folga' }, 'folga'), h('span', { class: 'l-rod' }, 'folga do rodízio (domingo e segunda)'),
      h('span', { class: 'l-ferias' }, 'férias'), h('span', { class: 'l-fer' }, 'feriado'), h('span', null, '• ou * = ajuste manual'), h('span', null, 'Total = com intervalo · Líquida = sem intervalo'));
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
      document.body.classList.add('imprimindo-doc');
      const limpar = () => { document.body.classList.remove('imprimindo-doc'); el.remove(); window.removeEventListener('afterprint', limpar); };
      window.addEventListener('afterprint', limpar);
      setTimeout(() => { window.print(); setTimeout(() => { if (document.body.classList.contains('imprimindo-doc') && !window.matchMedia('print').matches) limpar(); }, 1000); }, 100);
    };
    // editor do dia selecionado
    const editor = (() => {
      if (!AJ.sel || !E.dias.includes(AJ.sel.iso) || !E.pessoas[AJ.sel.i]) return null;
      const { iso, i } = AJ.sel;
      const k = E.dias.indexOf(iso);
      const p = E.pessoas[i], N = p.nome.trim().toUpperCase();
      const atual = E.cel[i][k];
      const ajAtual = (AJ.dados[iso] || {})[N];
      const modo = h('select', { class: 'f-input' }, h('option', { value: 'auto', selected: !ajAtual || null }, 'Automático (sem ajuste)'), h('option', { value: 'folga', selected: ajAtual?.tipo === 'folga' || null }, 'Folga'),
        h('option', { value: 'trab', selected: ajAtual?.tipo === 'trab' || null }, 'Trabalha'), h('option', { value: 'troca' }, 'Trocar o dia com…'));
      const ini = h('input', { class: 'f-input', type: 'time', value: ajAtual?.ini || (atual.tipo === 'trab' ? hhmm(atual.ini) : '10:00') });
      const fim = h('input', { class: 'f-input', type: 'time', value: ajAtual?.fim || (atual.tipo === 'trab' ? hhmm(atual.fim) : '18:00') });
      const com = h('select', { class: 'f-input' }, E.pessoas.map((q, j) => (j === i ? null : h('option', { value: j }, `${q.nome} (${E.cel[j][k].tipo === 'trab' ? `${hhmm(E.cel[j][k].ini)}–${hhmm(E.cel[j][k].fim)}` : E.cel[j][k].motivo || 'folga'})`))).filter(Boolean));
      const blocoHora = h('div', { class: 'aj-linha' }, h('span', null, 'Entrada'), ini, h('span', null, 'Saída'), fim);
      const blocoTroca = h('div', { class: 'aj-linha' }, h('span', null, 'Com'), com);
      const mostrar = () => { blocoHora.hidden = modo.value !== 'trab'; blocoTroca.hidden = modo.value !== 'troca'; };
      modo.addEventListener('change', mostrar); mostrar();
      const comoAjuste = (c) => (c.tipo === 'trab' ? { tipo: 'trab', ini: hhmm(c.ini), fim: hhmm(c.fim) } : { tipo: 'folga' });
      const erro = h('span', { class: 'neg' });
      const aplicar = () => {
        const d = (AJ.dados[iso] ||= {});
        if (modo.value === 'auto') delete d[N];
        else if (modo.value === 'folga') d[N] = { tipo: 'folga' };
        else if (modo.value === 'trab') { if (!ini.value || !fim.value || ini.value >= fim.value) { erro.textContent = 'A entrada precisa ser antes da saída.'; return; } d[N] = { tipo: 'trab', ini: ini.value, fim: fim.value }; }
        else { const j = +com.value; const outra = E.pessoas[j].nome.trim().toUpperCase(); d[N] = comoAjuste(E.cel[j][k]); d[outra] = comoAjuste(atual); }
        if (!Object.keys(d).length) delete AJ.dados[iso];
        AJ.sujo = true; AJ.sel = null; AJ.msg = ''; TS.render();
      };
      const DSN = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
      const DSP = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
      // repetir os ajustes deste dia nos mesmos dias da semana seguintes (no mês), menos feriados
      const wdSel = new Date(iso + 'T12:00:00Z').getUTCDay();
      const ajDia = AJ.dados[iso] || {};
      const proximos = E.dias.filter((d) => d > iso && new Date(d + 'T12:00:00Z').getUTCDay() === wdSel && !E.feriados.has(d));
      const repetir = () => {
        let n = 0;
        for (const d of proximos) {
          const k2 = E.dias.indexOf(d);
          const alvo = (AJ.dados[d] ||= {});
          for (const [nome, aj] of Object.entries(ajDia)) {
            const j = E.pessoas.findIndex((q) => q.nome.trim().toUpperCase() === nome);
            if (j >= 0 && E.cel[j][k2].tipo === 'ferias') continue; // férias prevalecem
            alvo[nome] = { ...aj }; n++;
          }
          if (!Object.keys(alvo).length) delete AJ.dados[d];
        }
        AJ.sujo = true; AJ.sel = null; AJ.msg = `${n} ajuste(s) repetido(s) em ${proximos.length} ${DSP[wdSel]}.`; TS.render();
      };
      const nAjDia = Object.keys(ajDia).length;
      const blocoRepetir = nAjDia && proximos.length ? h('div', { class: 'aj-repetir' },
        h('button', { type: 'button', class: 'btn', onclick: repetir }, `↻ Repetir os ajustes deste dia nos próximos ${DSP[wdSel]}`),
        h('small', { class: 'muted' }, `${nAjDia} ajuste(s) de ${iso.slice(8)}/${iso.slice(5, 7)} (${Object.keys(ajDia).map((nm) => (E.pessoas.find((q) => q.nome.trim().toUpperCase() === nm) || { nome: nm }).nome).join(', ')}) vão para ${proximos.map((d) => `${d.slice(8)}/${d.slice(5, 7)}`).join(', ')}. Feriados e férias ficam de fora.`)) : null;
      return h('div', { class: 'aj-editor' },
        h('div', { class: 'aj-tit' }, `${p.nome} · ${iso.slice(8)}/${iso.slice(5, 7)} (${DSN[new Date(iso + 'T12:00:00Z').getUTCDay()]})`, h('small', null, ` — hoje: ${atual.tipo === 'trab' ? `${hhmm(atual.ini)}–${hhmm(atual.fim)}` : atual.motivo || 'folga'}`)),
        h('div', { class: 'aj-linha' }, modo), blocoHora, blocoTroca,
        h('div', { class: 'aj-linha' }, h('button', { type: 'button', class: 'btn primary', onclick: aplicar }, 'Aplicar'), h('button', { type: 'button', class: 'btn', onclick: () => { AJ.sel = null; TS.render(); } }, 'Cancelar'), erro),
        blocoRepetir,
        h('small', { class: 'muted' }, 'O painel trava a sua escolha e refaz os turnos das outras pessoas nesse dia para manter a loja coberta.'));
    })();
    const salvarAj = async (btn) => {
      btn.disabled = true;
      try {
        const r = await fetch(`/api/escala-ajustes?loja=${encodeURIComponent(cfg.id)}&ym=${ym}`, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ajustes: AJ.dados }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
        cfg.escalaAjustes = { ...(cfg.escalaAjustes || {}), [ym]: JSON.parse(JSON.stringify(AJ.dados)) };
        AJ.sujo = false; AJ.msg = ''; TS.render();
      } catch (e) { btn.textContent = e.message; btn.disabled = false; }
    };
    const barraAj = h('div', { class: 'aj-barra' },
      h('span', { class: 'muted' }, nAj ? `${nAj} ajuste(s) manual(is) neste mês${AJ.sujo ? ' — não salvos' : ''}.${AJ.msg ? ' ' + AJ.msg : ''}` : 'Toque num dia de uma pessoa para ajustar (folga, horário ou troca).'),
      pode && AJ.sujo ? (() => { const b = h('button', { type: 'button', class: 'btn primary' }, 'Salvar ajustes'); b.addEventListener('click', () => salvarAj(b)); return b; })() : null,
      nAj ? h('button', { type: 'button', class: 'btn ghost-danger', onclick: () => { AJ.dados = {}; AJ.sujo = true; AJ.sel = null; TS.render(); } }, 'Desfazer ajustes do mês') : null,
      TS.demo && AJ.sujo ? h('span', { class: 'muted' }, '(na apresentação os ajustes não são salvos)') : null);

    return TS.cardWithTools('Escala do mês', `Dia a dia com feriados e férias. ${L > 1 ? `O rodízio de ${L} semanas começa a contar no domingo ${TS.fmt.date(domingoDe(op.equipe.inicioRodizio || INICIO_PADRAO))} (ajuste em "Horário e equipe").` : 'A semana sugerida se repete todas as semanas.'} Passe o mouse para ver intervalo e feriado.`,
      h('div', { class: 'table-tools' }, sel, h('button', { type: 'button', class: 'btn primary', onclick: imprimir }, '⎙ Exportar PDF')),
      alertas.length ? h('div', { class: 'notice' }, h('b', null, 'Atenção: '), alertas.slice(0, 6).join(' · '), alertas.length > 6 ? ` e mais ${alertas.length - 6}` : '') : null,
      barraAj, editor,
      legenda(), tabela(false));
  }

  /** escala em rodízio de domingo: ciclo de semanas (domingo a sábado) */
  function cartaoRodizio(need, op, horas, ideal) {
    const pessoas = pessoasDe(op.equipe);
    const r = montarRodizio(need, op, pessoas);
    const ORDEM = [6, 0, 1, 2, 3, 4, 5]; // dom..sáb
    const tot = resumoRodizio(r);
    const sem = Math.min(state.escSemana || 0, r.L - 1);
    const fixosTxt = pessoas.map((p, i) => {
      const porSem = r.semanas.map((w, k) => [k, w.folgasSem[i].slice().sort((a, b) => a - b)]).filter(([, d]) => d.length);
      if (!porSem.length) return null;
      const chave = (d) => d.join(',');
      const iguais = porSem.every(([, d]) => chave(d) === chave(porSem[0][1]));
      const nomes = (d) => d.map((x) => DIAS_NOME[x]).join(' e ');
      return `${p.nome}: ${iguais ? nomes(porSem[0][1]) : porSem.map(([k, d]) => `sem. ${k + 1} ${d.map((x) => DIAS_CURTO[x]).join('/')}`).join(', ')}${p.folga === 'auto' ? ' (automático)' : ''}`;
    }).filter(Boolean).join(' · ');
    const excessos = r.semanas.map((w, k) => [k, w.excesso]).filter(([, x]) => x.length);
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
      excessos.length ? h('div', { class: 'notice err' }, `Não deu para manter no máximo ${r.maxF} pessoa(s) de folga por dia em: ${excessos.map(([k, x]) => `semana ${k + 1} (${x.map((wd) => DIAS_NOME[wd]).join(', ')})`).join('; ')}. Revise as folgas fixas escolhidas à mão ou o limite em "Horário e equipe".`) : null,
      h('p', { class: 'muted rod-fixos' }, h('b', null, `Folgas nas semanas em que trabalha no domingo (no máximo ${r.maxF} de folga por dia): `), fixosTxt),
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
