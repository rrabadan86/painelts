/* Mapa de Calor: movimento por dia da semana × hora, pessoas necessárias e escala sugerida */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
  const DIAS_NOME = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  const DIAS_CURTO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const hm = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
  // escala em blocos de 10 min (entrada, saída e intervalo em qualquer horário de 10 em 10 min)
  const B = 10, NB = 1440 / B, PH = 60 / B, K = 30 / B; // K: quantos blocos cabem em meia hora (as regras foram pensadas em meias horas)
  const ordemSem = (e) => (e && e.inicioSemana === 'seg' ? [0, 1, 2, 3, 4, 5, 6] : [6, 0, 1, 2, 3, 4, 5]); // ordem dos dias na semana da escala
  const hLiq = (m) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`; // 8h20, 8h
  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  /**
   * Faixa do dia em blocos de B (10) min: inclui o bloco da abertura e o do fechamento mesmo quando o horário não é
   * redondo (09:40 → o bloco das 09:30 conta), e guarda os minutos exatos: [bloco inicial, bloco final, abre, fecha].
   */
  const faixaDia = (f) => (f && !f.fechado ? [Math.floor(hm(f.abre) / B), Math.ceil(hm(f.fecha) / B), hm(f.abre), hm(f.fecha)] : null);
  /** cobertura da hora na grade: o menor número de pessoas nos blocos da hora que estão dentro do horário da loja */
  const cobHora = (linha, fx, hr) => { const xs = []; for (let s0 = hr * PH; s0 < hr * PH + PH; s0++) if (!fx || (s0 >= fx[0] && s0 < fx[1])) xs.push(linha[s0]); return xs.length ? Math.min(...xs) : 0; };
  /** turno em minutos: quem abre começa na hora exata da abertura e quem fecha sai na hora exata do fechamento (mesma jornada) */
  /**
   * Intervalo (min) de uma jornada: acima de 8h → "intervalo" da equipe; de 4h a 8h → "intervaloAte8"
   * (sem ele, o de antes: acima de 6h o "intervalo", até 6h 30 min); até 4h, sem intervalo.
   */
  function intervaloMin(e, jorn) {
    if (jorn > 480) return Math.max(0, +e.intervalo || 0);
    if (jorn > 240) return e.intervaloAte8 != null ? Math.max(0, +e.intervaloAte8 || 0) : jorn > 360 ? Math.max(0, +e.intervalo || 0) : 30;
    return 0;
  }
  /**
   * Blocos de intervalo num turno de len blocos: o intervalo inteiro sempre que sobram mais de 4h de trabalho
   * (dia curto, ex.: domingo 12h–21h, encurta o trabalho, não o intervalo — a CLT pede 1h acima de 6h).
   */
  let IV_CURTO = 30; // intervalo de um turno de 4h a 6h na loja em cálculo (definido por equipeAtual)
  const equipeAtual = (e) => { IV_CURTO = intervaloBloco(e, 300); };
  function intervaloNoTurno(len, intervalo) {
    if (!intervalo) return 0;
    if (len * B - intervalo > 360) return intervalo / B; // ainda mais de 6h de trabalho: intervalo inteiro
    const iv = Math.min(intervalo, IV_CURTO);            // turno de até 6h (dia curto): o intervalo dessa faixa
    if (len * B - iv > 360) return intervalo / B;         // com o intervalo curto passaria de 6h de trabalho: precisa do inteiro (CLT)
    return len * B > 240 ? iv / B : 0;                    // mais de 4h seguidas pede intervalo (CLT); até 4h, sem
  }
  /** intervalo de um turno já em minutos (feriado cortado, ajuste manual): o que a jornada real pede, no meio do turno */
  function pausaDoTurno(ini, fim, e, antes) {
    const dur = fim - ini;
    const ivA = +e.intervalo || 0;
    if (dur <= 240) return null; // até 4h: sem intervalo
    // o menor intervalo que cobre o trabalho que sobra (sempre crescente com o turno): tenta o das faixas de 4h–6h, 6h–8h e acima de 8h
    const cands = [...new Set([intervaloMin(e, 300), intervaloMin(e, 420), intervaloMin(e, 481), ivA])].filter((x) => x > 0).sort((a, b) => a - b);
    let iv = cands.find((c) => c >= intervaloMin(e, dur - c)) ?? cands[cands.length - 1] ?? 0;
    iv = Math.round(iv / B) * B;
    if (!iv) iv = Math.round(intervaloMin(e, 300) / B) * B; // mais de 4h seguidas: no mínimo o intervalo curto (CLT)
    if (!iv) return null;
    if (antes && antes[1] - antes[0] === iv && antes[0] >= ini + 120 && antes[1] <= fim - 120) return antes; // o de antes ainda serve
    const m = Math.round((ini + (dur - iv) / 2) / B) * B;
    return [m, m + iv];
  }

  /** na escala automática (blocos de 10 min) */
  const intervaloBloco = (e, trabMin) => Math.round(intervaloMin(e, trabMin) / B) * B;
  /** abaixo do mínimo da CLT? (acima de 6h: 1h; de 4h a 6h: 15 min) */
  const abaixoClt = (jorn, int) => (jorn > 360 ? int < 60 : jorn > 240 ? int < 15 : false);
  TS._intervalo = { intervaloMin, abaixoClt, pausaDoTurno: (...a) => pausaDoTurno(...a) };
  function paraTurno(o, ab) {
    let ini = o.s * B, fim = (o.s + o.len) * B;
    let pausa = o.pausa != null && o.intSlots ? [o.pausa * B, (o.pausa + o.intSlots) * B] : null;
    if (ab && ab.length > 2) {
      let d = 0;
      if (o.s <= ab[0] && ab[2] > ini) d = ab[2] - ini;            // abre: empurra para a hora exata (ex.: 09:30 → 09:40)
      else if (o.s + o.len >= ab[1] && ab[3] < fim) d = ab[3] - fim; // fecha: puxa para a hora exata (ex.: 22:00 → 21:50)
      ini += d; fim += d; if (pausa) pausa = [pausa[0] + d, pausa[1] + d];
      ini = Math.max(ini, ab[2]); fim = Math.min(fim, ab[3]); // turno do dia inteiro: fica dentro do horário
    }
    return { ini, fim, pausa };
  }

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
    equipeAtual(e);
    const diasTrab = e.escala === '6x1' ? 6 : 5;
    const jornada = (e.cargaSemanal * 60) / diasTrab; // jornada diária exata (ex.: 44h na 5x2 = 8h48)
    const trabMin = Math.round(jornada / B) * B; // na escala, arredondada para blocos de 10 min
    const intervalo = intervaloBloco(e, trabMin);
    const abertura = DIAS.map((d) => faixaDia(op.funcionamento[d]));
    // precisa de gente só dentro do horário da loja: com abertura 09:40, os blocos das 09:00–09:40 não contam
    const slotsNeed = need.map((row, wd) => Array.from({ length: NB }, (_, s) => (abertura[wd] && s >= abertura[wd][0] && s < abertura[wd][1] ? row[Math.floor(s / PH)] : 0)));
    const cob = Array.from({ length: 7 }, () => Array(NB).fill(0));
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
        const len = Math.min(b - a, (trabMin + intervalo) / B);
        const intSlots = intervaloNoTurno(len, intervalo); // dia curto: encurta o trabalho, não o intervalo
        let melhor = null;
        for (let s = a; s + len <= b; s++) {
          // intervalo: no meio do turno, onde a necessidade é menor
          let pausa = null;
          if (intSlots) {
            let menor = Infinity;
            for (let x = s + Math.floor(len / 2) - 2 * K; x <= s + Math.floor(len / 2) + K; x++) {
              if (x < s + 4 * K || x + intSlots > s + len - 4 * K) continue;
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
          ganho += 2 * K * encaixe(prefs[p], s, len, ab); // preferência de turno (menos que cobrir horário vazio)
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
        return paraTurno(o, abertura[wd]);
      });
      pessoas.push(turnos);
    }
    // troca turnos do mesmo dia entre pessoas quando respeita melhor as preferências
    for (let wd = 0; wd < 7; wd++) {
      const ab = abertura[wd];
      if (!ab) continue;
      const lista = pessoas.map((t, i) => (t[wd] ? { i, pref: prefs[i], o: { s: t[wd].ini / B, len: (t[wd].fim - t[wd].ini) / B, t: t[wd] } } : null)).filter(Boolean);
      trocarPorPreferencia(lista, ab);
      lista.forEach((x) => { pessoas[x.i][wd] = x.o.t; });
    }
    // faltas
    let descoberto = 0, abaixo = 0;
    const faltas = Array.from({ length: 7 }, () => Array(NB).fill(0));
    for (let wd = 0; wd < 7; wd++) for (let s = 0; s < NB; s++) {
      const f = slotsNeed[wd][s] - cob[wd][s];
      if (slotsNeed[wd][s] > 0 && f > 0) { faltas[wd][s] = f; if (cob[wd][s] === 0) descoberto += B / 60; else abaixo += B / 60; } // horas (cada bloco = B min)
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

  /** melhor turno de uma pessoa num dia, dada a cobertura atual (blocos de B min) */
  function melhorTurno(wd, cob, slotsNeed, abertura, trabMin, intervalo, pref) {
    const ab = abertura[wd];
    if (!ab) return null;
    const [a, b] = ab;
    const len = Math.min(b - a, (trabMin + intervalo) / B);
    const intSlots = intervaloNoTurno(len, intervalo); // dia curto: encurta o trabalho, não o intervalo
    // horários das pontas (abertura/fechamento) só são cobertos por poucos turnos: valem mais
    const nIni = Math.max(1, b - len - a + 1);
    const raro = (x) => { const lo = Math.max(a, x - len + 1), hi = Math.min(b - len, x); return 1 + 4 / Math.max(1, Math.ceil(Math.min(nIni, hi - lo + 1) / K)); };
    let melhor = null;
    for (let s0 = a; s0 + len <= b; s0++) {
      let pausa = null;
      if (intSlots) {
        let menor = Infinity;
        for (let x = s0 + Math.floor(len / 2) - 2 * K; x <= s0 + Math.floor(len / 2) + K; x++) {
          if (x < s0 + 4 * K || x + intSlots > s0 + len - 4 * K) continue;
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
      ganho += PESO_PREF * K * encaixe(pref, s0, len, ab);
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
    equipeAtual(e);
    const seis = e.escala === '6x1';
    const diasBase = seis ? 6 : 5;
    const jornada = (e.cargaSemanal * 60) / diasBase;
    const trabMin = Math.round(jornada / B) * B;
    const intervalo = intervaloBloco(e, trabMin);
    const abertura = DIAS.map((d) => faixaDia(op.funcionamento[d]));
    const slotsNeed = need.map((row, wd) => Array.from({ length: NB }, (_, x) => (abertura[wd] && x >= abertura[wd][0] && x < abertura[wd][1] ? row[Math.floor(x / PH)] : 0)));
    const DOM = 6, SEG = 0;
    const fechadosSem = [0, 1, 2, 3, 4, 5, 6].filter((wd) => !abertura[wd]);
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
    const seg = semanaSeg(e);
    // quem folga no domingo de cada semana do ciclo (gira igualmente)
    const domDe = (w) => { const f = new Set(); if (domAberto) for (let j = 0; j < folgamDom; j++) f.add((((w % L) + L) % L * folgamDom + j) % N); return f; };
    for (let w = 0; w < L; w++) {
      const folgaDom = domAberto ? domDe(w) : new Set(pessoas.map((_, i) => i));
      // semana de segunda a domingo: a segunda desta semana é a folga de quem folgou no domingo da semana anterior
      const segDoAnterior = seg && domAberto ? domDe(w - 1) : null;
      const cob = Array.from({ length: 7 }, () => Array(NB).fill(0));
      const turnosP = pessoas.map(() => Array(7).fill(null));
      const motivos = pessoas.map(() => Array(7).fill(''));
      // folgas da semana: quem folga no domingo folga também na segunda; os demais folgam no(s) dia(s) fixo(s).
      // Dia "automático" é escolhido semana a semana, sem passar do limite de folgas no mesmo dia.
      const cont = Array(7).fill(0);
      const offs = pessoas.map(() => new Set());
      const folgasSem = pessoas.map(() => []);
      pessoas.forEach((_, i) => {
        if (!domAberto) { offs[i].add(DOM); motivos[i][DOM] = 'Fechado'; return; }
        if (seg) {
          if (folgaDom.has(i)) { offs[i].add(DOM); cont[DOM]++; motivos[i][DOM] = 'Folga (rodízio)'; }
          if (segDoAnterior.has(i)) { offs[i].add(SEG); cont[SEG]++; motivos[i][SEG] = 'Folga (após domingo)'; }
        } else if (folgaDom.has(i)) { offs[i].add(DOM); offs[i].add(SEG); cont[DOM]++; cont[SEG]++; motivos[i][DOM] = 'Folga (rodízio)'; motivos[i][SEG] = 'Folga (após domingo)'; }
      });
      // folgas que ainda faltam na semana (5x2: 2; 6x1: 1), descontando as que o domingo já deu
      // dia em que a loja fecha conta como folga para todos (5x2 com segunda fechada: 5 dias, não 4)
      const precisa = (i) => Math.max(0, (seis ? 1 : 2) - new Set([...offs[i], ...fechadosSem]).size);
      const manuais = (i) => [pessoas[i].folga, pessoas[i].folga2].filter((f) => f && f !== 'auto').length;
      const ordemP = pessoas.map((_, i) => i).sort((x, y) => manuais(y) - manuais(x) || ((x - w + N * 9) % N) - ((y - w + N * 9) % N));
      for (const i of ordemP) {
        const cfgDias = [pessoas[i].folga, pessoas[i].folga2];
        const nPrecisa = precisa(i); // contado antes: cada folga marcada aumenta offs[i]
        for (let j = 0; j < nPrecisa; j++) {
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
        for (const [i, o] of doDia) turnosP[i][wd] = paraTurno(o, abertura[wd]);
      }
      let descoberto = 0, abaixo = 0;
      const problemas = [];
      for (let wd = 0; wd < 7; wd++) {
        let ini = null, pior = null;
        for (let x = 0; x <= NB; x++) {
          const n = x < NB ? slotsNeed[wd][x] : 0, c = x < NB ? cob[wd][x] : 0;
          const falta = n > 0 && c < n;
          if (falta) { if (c === 0) descoberto += B / 60; else abaixo += B / 60; if (ini == null) { ini = x; pior = { c, n }; } else if (c < pior.c) pior = { c, n }; }
          if (!falta && ini != null) { problemas.push({ wd, ini: ini * B, fim: x * B, c: pior.c, n: pior.n }); ini = null; }
        }
      }
      semanas.push({ turnosP, motivos, cob, descoberto, abaixo, problemas, folgaDom, folgasSem, excesso });
    }
    return { semanas, L, kDom, folgamDom, trabMin, jornada, intervalo, diasBase, fixos, maxF };
  }
  TS._escala = { montarRodizio: (...a) => montarRodizio(...a), montarEscala: (...a) => montarEscala(...a), B, PH };
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
    const num = (k, attrs) => { const x = h('input', { class: 'f-input', type: 'number', value: e[k], ...attrs }); TS.aoConfirmar(x, () => { e[k] = x.value === '' && attrs.placeholder ? null : +x.value; aoMudar && aoMudar(); }); return x; }; // com placeholder, vazio = sem valor (usa o padrão)
    const esc = h('select', { class: 'f-input' }, h('option', { value: '5x2', selected: e.escala === '5x2' || null }, '5x2 (5 dias, 2 folgas)'), h('option', { value: '6x1', selected: e.escala === '6x1' || null }, '6x1 (6 dias, 1 folga)'));
    esc.addEventListener('change', () => { e.escala = esc.value; aoMudar && aoMudar(); });
    const modelo = h('select', { class: 'f-input' },
      h('option', { value: 'livre', selected: e.modelo !== 'rodizio' || null }, 'Livre: o painel escolhe as folgas'),
      h('option', { value: 'rodizio', selected: e.modelo === 'rodizio' || null }, 'Rodízio de domingo (folga no domingo puxa a segunda)'));
    modelo.addEventListener('change', () => { e.modelo = modelo.value; aoMudar && aoMudar(); });
    const inicio = h('input', { class: 'f-input', type: 'date', value: e.inicioRodizio || '2026-01-04' });
    const iniSem = h('select', { class: 'f-input' }, h('option', { value: 'dom', selected: e.inicioSemana !== 'seg' || null }, 'Domingo (domingo a sábado)'), h('option', { value: 'seg', selected: e.inicioSemana === 'seg' || null }, 'Segunda (segunda a domingo)'));
    iniSem.addEventListener('change', () => { e.inicioSemana = iniSem.value; aoMudar && aoMudar(); });
    TS.aoConfirmar(inicio, () => { if (inicio.value) { e.inicioRodizio = inicio.value; aoMudar && aoMudar(); } });
    const ordemSemana = ordemSem(e); // na ordem da semana da escala
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
        campo('Carga horária semanal (h)', num('cargaSemanal', { min: 4, max: 60, step: 1 }), (() => { const c = +e.cargaSemanal || 44, f = (m) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`; return `${c}h = ${f((c * 60) / 5)} por dia na 5x2 · ${f((c * 60) / 6)} na 6x1`; })()),
        campo('Escala', esc),
        campo('Intervalo — jornada acima de 8h (min)', num('intervalo', { min: 0, max: 180, step: 5 }), 'CLT: no mínimo 1h (até 2h).'),
        campo('Intervalo — jornada de até 8h (min)', num('intervaloAte8', { min: 0, max: 180, step: 5, value: e.intervaloAte8 ?? '', placeholder: 'como antes' }), 'De 4h a 8h. Vazio = como antes (o intervalo de cima acima de 6h; 30 min até 6h). CLT: acima de 6h, 1h; de 4h a 6h, 15 min.'),
        campo('Atendimentos por pessoa por hora', num('capacidade', { min: 1, max: 100, step: 1 }), 'Acima disso, precisa de mais uma pessoa.')),
      (() => {
        const dias = e.escala === '6x1' ? 6 : 5, jorn = (e.cargaSemanal * 60) / dias, iv = intervaloMin(e, jorn);
        const txt = `Jornada desta loja: ${Math.floor(jorn / 60)}h${String(Math.round(jorn % 60)).padStart(2, '0')} por dia → intervalo de ${iv} min${iv % B ? ' (na escala automática, arredondado para ' + intervaloBloco(e, jorn) + ' min)' : ''}.`;
        return h('p', { class: 'op-int-info ' + (abaixoClt(jorn, iv) ? 'neg' : 'muted') }, txt, abaixoClt(jorn, iv) ? ' Abaixo do mínimo da CLT para essa jornada: confira com a convenção coletiva.' : '');
      })(),
      h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Regras da escala'),
      h('div', { class: 'cfg-grid' }, campo('Modelo', modelo, e.modelo === 'rodizio' ? `Semana de ${semanaSeg(e) ? 'segunda a domingo' : 'domingo a sábado'}. As folgas de domingo giram igualmente entre a equipe${semanaSeg(e) ? '; a folga da segunda cai na semana seguinte e entra na conta dela' : ''}.` : null),
        campo('A semana começa no', iniSem, 'Vale para a escala do mês, os totais por semana e o rodízio.'),
        e.modelo === 'rodizio' ? campo(`A "Semana 1" do rodízio começa ${semanaSeg(e) ? 'na semana de' : 'no domingo'}`, inicio, semanaSeg(e) ? 'Escolha uma data da semana (segunda a domingo) em que a Pessoa 1 folgou no domingo. A escala do mês segue a partir dela.' : 'Use um domingo em que a Pessoa 1 folgou. A escala do mês segue a partir dele.') : null),
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
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Movimento e escala'), h('div', { class: 'page-sub' }, 'A escala do mês da equipe, o movimento da loja por hora e as regras que montam a escala.')),
      h('div', { class: 'active-filters' }, h('span', { class: 'af' }, TS.periodoTexto()))));
    // três abas: Escala do mês (o dia a dia) · Movimento (por que a escala é assim) · Equipe e regras (o que monta a escala)
    const ABAS = [['escala', 'Escala do mês'], ['movimento', 'Movimento da loja'], ['equipe', 'Equipe e regras']];
    const temLoja = state.loja && state.loja !== 'todas';
    const aba = ABAS.some(([k]) => k === state.mapaAba) ? state.mapaAba : temLoja ? 'escala' : 'movimento';
    const cx = { escala: h('div', { class: 'mapa-aba' }), movimento: h('div', { class: 'mapa-aba' }), equipe: h('div', { class: 'mapa-aba' }) };
    root.append(h('div', { class: 'mapa-abas', role: 'tablist' }, ...ABAS.map(([k, t]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === aba), class: 'mapa-aba-btn' + (k === aba ? ' on' : ''), onclick: () => { state.mapaAba = k; TS.render(); } }, t))), cx[aba]);
    const M = cx.movimento, Q = cx.equipe, ES = cx.escala;
    const cfgMapa = state.loja && state.loja !== 'todas' ? (db.metas || []).find((m) => m.id === state.loja) : null;
    const anoI = +TS.dayToIso(db.minDay).slice(0, 4), anoF = +TS.dayToIso(db.maxDay).slice(0, 4);
    const feriadosSet = TS.datasFeriado ? TS.datasFeriado(cfgMapa, anoI, anoF) : new Set();
    const ehFeriado = (day) => feriadosSet.has(TS.dayToIso(day));
    const { lista: lista0, total, semHora } = cupons(base);
    const lista = lista0.filter((c) => !ehFeriado(c.day));
    if (!total) { cx[aba].append(TS.card(null, null, TS.empty())); return; }
    if (!lista.length) {
      cx[aba].append(h('div', { class: 'card vazio-loja' }, h('h2', null, 'Ainda sem o horário das vendas'),
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

    if (semHora / total > 0.05) M.append(h('div', { class: 'notice' }, `O mapa usa só as vendas que já têm hora: de ${fmt.date(TS.dayToIso(de))} a ${fmt.date(TS.dayToIso(ate))} (${fmt.int(lista.length)} cupons). As vendas mais antigas vieram sem hora`,
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
    M.append(TS.cardWithTools('Movimento médio por hora', `Média por dia no período (${g.nDias.reduce((s, x) => s + x, 0)} dias, sem os feriados, que têm movimento e horário diferentes). Passe o mouse para ver o pico de cada horário.${op ? ' Hachurado = loja fechada.' : ''}`, seg,
      h('div', { class: 'table-wrap free mapa-wrap' }, tab)));

    // ---- equipe e escala
    if (!opInfo) {
      const aviso = () => h('div', { class: 'notice mt' }, 'Escolha uma loja no seletor do topo para ver a escala, as pessoas necessárias por hora e as regras da equipe.');
      M.append(aviso()); ES.append(aviso()); Q.append(aviso());
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
    const kpis = () => h('div', { class: 'grid g-kpi mt' },
      TS.kpi('Horas de trabalho necessárias', `${fmt.int(horasNec)} h/semana`, `para cobrir todos os horários e picos`),
      TS.kpi('Horas da equipe atual', `${fmt.int(horasDisp)} h/semana`, h('span', { class: horasDisp >= horasNec ? 'up' : 'down' }, `${op.equipe.funcionarios} × ${op.equipe.cargaSemanal}h · ${horasDisp >= horasNec ? 'sobra' : 'faltam'} ${fmt.int(Math.abs(horasDisp - horasNec))} h`)),
      TS.kpi('Equipe mínima', ideal.soAberto ? `${ideal.soAberto} pessoas` : '15+', 'para nunca deixar a loja sozinha'),
      TS.kpi('Equipe ideal', ideal.tudo ? `${ideal.tudo} pessoas` : 'mais de 15', 'cobrindo também os picos'));
    M.append(kpis(),
      h('details', { class: 'mapa-como' }, h('summary', null, 'Como esses números são calculados'),
        h('ol', null,
          h('li', null, `Para cada dia da semana e hora aberta, pega o movimento de pico (o número de atendimentos que 80% dos dias não passam) e divide por ${op.equipe.capacidade} atendimentos por pessoa por hora. Nunca fica abaixo do mínimo de pessoas do dia. Isso dá as "pessoas necessárias por hora".`),
          h('li', null, `Horas necessárias = soma dessas pessoas em todas as horas da semana. Horas da equipe = funcionários × ${op.equipe.cargaSemanal} h.`),
          h('li', null, `O painel monta a escala de verdade com 1, 2, 3… pessoas, usando as regras configuradas (${op.equipe.escala}, jornada, intervalo de ${intervaloMin(op.equipe, (op.equipe.cargaSemanal * 60) / (op.equipe.escala === '6x1' ? 6 : 5))} min, ${op.equipe.modelo === 'rodizio' ? 'rodízio de domingo, ' : ''}no máximo ${op.equipe.maxFolgaDia || 1} de folga por dia).`),
          h('li', null, h('b', null, 'Equipe mínima'), ': o menor número de pessoas em que nenhum horário fica com a loja sozinha (zero pessoas).'),
          h('li', null, h('b', null, 'Equipe ideal'), ': o menor número em que, além disso, todos os picos e o mínimo de cada dia ficam cobertos.')),
        h('p', { class: 'muted' }, 'A equipe pode ser maior que horas ÷ carga porque folgas, jornada máxima e intervalo não deixam encaixar as horas perfeitamente.')));
    M.append(h('div', { class: 'mt' },
      TS.card('Pessoas necessárias por hora', `Com base no pico do horário (80% dos dias ficam abaixo) e em ${op.equipe.capacidade} atendimentos por pessoa por hora.`,
        h('div', { class: 'table-wrap free mapa-wrap' }, tabNeed),
        h('div', { class: 'mapa-leg' }, h('span', { class: 'n1' }, '1 pessoa'), h('span', { class: 'n2' }, '2 pessoas'), h('span', { class: 'n3' }, '3 ou mais')),
        trechos.length ? h('p', { class: 'mapa-trechos' }, h('b', null, 'Precisa de 2+ pessoas: '), trechos.join(' · ')) : h('p', { class: 'muted' }, 'Uma pessoa dá conta em todos os horários com essa capacidade.'))));
    // resumo da equipe no topo da escala do mês: dá para ver na hora se a equipe dá conta
    const nEq = op.equipe.funcionarios;
    const okEq = ideal.tudo && nEq >= ideal.tudo, minEq = ideal.soAberto && nEq >= ideal.soAberto;
    ES.append(h('div', { class: 'mapa-resumo ' + (okEq ? 'ok' : minEq ? 'warn' : 'err') },
      h('span', null, h('b', null, `${nEq} ${nEq === 1 ? 'pessoa' : 'pessoas'}`), ` · escala ${op.equipe.escala}${rodizio ? ' · rodízio de domingo' : ''} · ${op.equipe.cargaSemanal} h/semana`),
      h('span', null, okEq ? '✓ cobre todos os horários e picos' : minEq ? `cobre a loja, mas a ideal é ${ideal.tudo || '15+'} pessoas para os picos` : `a loja fica sozinha em algum horário: mínimo ${ideal.soAberto || '15+'} pessoas`),
      h('button', { type: 'button', class: 'link-btn', onclick: () => { state.mapaAba = 'equipe'; TS.render(); } }, 'mudar equipe e regras ›')));
    Q.append(cartaoAjustes(opInfo));

    const cfgLoja = (db.metas || []).find((m) => m.id === opInfo.id) || null;
    if (rodizio) {
      Q.append(h('div', { class: 'mt' }, cartaoRodizio(need, op, horas, ideal)));
      const rr = montarRodizio(need, op, pessoasDe(op.equipe));
      ES.append(h('div', { class: 'mt' }, cartaoMes({ op, cfg: cfgLoja, semanas: rr.semanas, L: rr.L, need, lojaNome: opInfo.nome })));
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
        const c = cobHora(esc.cob[wd], faixaDia(op.funcionamento[DIAS[wd]]), hr); // a hora (blocos dentro do horário da loja)
        const cls = c === 0 ? 'vazio' : c < n ? 'falta' : c > n ? 'sobra' : 'ok';
        return h('td', { class: cls, title: `${DIAS_NOME[wd]} ${hr}h: ${c} na loja, precisa de ${n}` }, c);
      })))));
    const avisoEsc = esc.descoberto > 0
      ? h('div', { class: 'notice err' }, `Com ${op.equipe.funcionarios} pessoa(s) ficam ${fmt.n1(esc.descoberto)} h por semana com a loja sozinha. A equipe mínima para isso não acontecer é de ${ideal.soAberto || '15+'} pessoas.`)
      : esc.abaixo > 0 ? h('div', { class: 'notice' }, `Loja sempre coberta, mas faltam pessoas nos picos durante ${fmt.n1(esc.abaixo)} h por semana. ${ideal.tudo ? `Com ${ideal.tudo} pessoas os picos ficam cobertos.` : ''}`)
        : h('div', { class: 'notice ok' }, 'Essa equipe cobre todos os horários e picos.');
    Q.append(h('div', { class: 'mt' }, TS.card(`Semana-modelo sugerida (${op.equipe.escala})`,
      `Jornada de ${Math.floor(esc.jornada / 60)}h${String(Math.round(esc.jornada % 60)).padStart(2, '0')} por dia (horários de 10 em 10 min)${esc.intervalo ? ` + ${esc.intervalo} min de intervalo` : ''}, ${esc.diasTrab} dias por semana. Sugestão automática: ajuste ao que combinou com a equipe e confira as regras da CLT e da convenção coletiva (ex.: folga aos domingos periodicamente).`,
      avisoEsc,
      h('div', { class: 'table-wrap free' }, h('table', { class: 'escala-t' }, h('thead', null, h('tr', null, h('th', { class: 'l' }, ''), DIAS_NOME.map((d) => h('th', null, d)))), h('tbody', null, linhasEsc))),
      h('div', { class: 'f-label', style: { marginTop: '16px' } }, 'Cobertura da escala'),
      h('div', { class: 'table-wrap free mapa-wrap' }, cobertura),
      h('div', { class: 'mapa-leg' }, h('span', { class: 'ok' }, 'na medida'), h('span', { class: 'sobra' }, 'sobra gente'), h('span', { class: 'falta' }, 'falta gente no pico'), h('span', { class: 'vazio' }, 'loja sozinha')))));
    ES.append(h('div', { class: 'mt' }, cartaoMes({ op, cfg: cfgLoja, semanas: [{ turnosP: esc.pessoas, motivos: null }], L: 1, need, lojaNome: opInfo.nome })));
  };

  // ---------- escala do mês (datas reais, feriados e férias) ----------
  const ORD = [6, 0, 1, 2, 3, 4, 5]; // índice interno (seg=0..dom=6) a partir do getUTCDay()
  const wdDe = (iso) => (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const diaMs = (iso) => Date.parse(iso + 'T12:00:00Z');
  /** domingo da semana (semana de domingo a sábado) */
  const domingoDe = (iso) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };
  /** semana da escala: de domingo a sábado (padrão) ou de segunda a domingo (equipe.inicioSemana = 'seg') */
  const semanaSeg = (e) => !!e && e.inicioSemana === 'seg';
  const segundaDe = (iso) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const inicioDe = (e, iso) => (semanaSeg(e) ? segundaDe(iso) : domingoDe(iso));
  const INICIO_PADRAO = '2026-01-04';

  /** monta a escala de cada dia do mês: { dias:[iso], pessoas:[nome], cel[i][k] = {tipo, ini, fim, pausa, motivo} } */
  function escalaDoMes({ op, cfg, semanas, L, ym, need, ajustes }) {
    equipeAtual(op.equipe);
    const pessoas = pessoasDe(op.equipe);
    const nD = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
    const dias = Array.from({ length: nD }, (_, k) => `${ym}-${String(k + 1).padStart(2, '0')}`);
    const ancora = inicioDe(op.equipe, op.equipe.inicioRodizio || INICIO_PADRAO);
    const feriados = new Map(TS.feriadosDoMes ? TS.feriadosDoMes(cfg, ym).map((f) => [f.data, f]) : []);
    const ferias = (cfg && cfg.ferias) || [];
    const cel = pessoas.map((p) => dias.map((iso) => {
      const wd = wdDe(iso);
      const w = L > 1 ? (((Math.round((diaMs(inicioDe(op.equipe, iso)) - diaMs(ancora)) / (7 * 86400000)) % L) + L) % L) : 0;
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
          return { tipo: 'trab', ini, fim, pausa: pausaDoTurno(ini, fim, op.equipe, t.pausa), feriado: fer.nome, semana: w };
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
      const trabMin = Math.round(((e.cargaSemanal * 60) / diasBase) / B) * B;
      const intervalo = intervaloBloco(e, trabMin);
      dias.forEach((iso, k) => {
        const aj = ajustes[iso];
        if (!aj || !Object.keys(aj).length) return;
        const wd = wdDe(iso);
        const fer = feriados.get(iso);
        const hf = fer && TS.horarioFeriado ? TS.horarioFeriado({ ...(cfg || {}), operacao: op }, iso) : null;
        const f = op.funcionamento[DIAS[wd]];
        const ab = hf && !hf.fechado ? faixaDia(hf) : faixaDia(f);
        const sNeed = [Array.from({ length: NB }, (_, x) => (ab && x >= ab[0] && x < ab[1] ? need[wd][Math.floor(x / PH)] || 1 : 0))];
        const cob = [Array(NB).fill(0)];
        const aplica = (c, sinal) => { if (c && c.tipo === 'trab') for (let x = Math.floor(c.ini / B); x < Math.ceil(c.fim / B); x++) if (!(c.pausa && x * B >= c.pausa[0] && x * B < c.pausa[1])) cob[0][x] += sinal; };
        // travados
        pessoas.forEach((p, i) => {
          const a = aj[p.nome.trim().toUpperCase()];
          if (!a) return;
          if (a.tipo === 'folga') cel[i][k] = { tipo: 'folga', motivo: 'Folga (ajuste)', aj: true, feriado: fer && fer.nome };
          else {
            const ini = hm(a.ini), fim = hm(a.fim);
            cel[i][k] = { tipo: 'trab', ini, fim, pausa: pausaDoTurno(ini, fim, e), aj: true, feriado: fer && fer.nome }; // horário digitado já inclui o intervalo
          }
          aplica(cel[i][k], 1);
        });
        // os demais que trabalham no dia: refazem o turno vendo os travados
        const livres = pessoas.map((p, i) => i).filter((i) => !aj[pessoas[i].nome.trim().toUpperCase()] && cel[i][k].tipo === 'trab');
        if (!ab) return;
        const turno = (o) => ({ tipo: 'trab', ...paraTurno(o, ab), feriado: fer && fer.nome, recalc: true });
        for (const i of livres) { const o = melhorTurno(0, cob, sNeed, [ab], trabMin, intervalo, pessoas[i].turno); if (o) { cel[i][k] = turno(o); aplica(cel[i][k], 1); } }
        for (let r = 0; r < 2; r++) for (const i of livres) { aplica(cel[i][k], -1); const o = melhorTurno(0, cob, sNeed, [ab], trabMin, intervalo, pessoas[i].turno); if (o) cel[i][k] = turno(o); aplica(cel[i][k], 1); }
        { // troca entre os recalculados quando respeita melhor a preferência (mesma duração)
          const lista = livres.filter((i) => cel[i][k].tipo === 'trab').map((i) => ({ i, pref: pessoas[i].turno, o: { s: cel[i][k].ini / B, len: (cel[i][k].fim - cel[i][k].ini) / B, c: cel[i][k] } }));
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
    const pode = TS.demo || TS.eu?.pode?.configurar || (TS.eu?.perfil === 'gerente' && (TS.eu.telas || []).includes('mapa')); // apresentação: ajusta na tela, não salva
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
    // semanas que cobrem o mês (de domingo a sábado, ou de segunda a domingo)
    const semanasMes = [];
    for (let k = 0; k < E.dias.length;) {
      const dom = inicioDe(op.equipe, E.dias[k]);
      const datas = Array.from({ length: 7 }, (_, j) => { const d = new Date(dom + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + j); return d.toISOString().slice(0, 10); });
      semanasMes.push(datas);
      k = E.dias.indexOf(datas[6]) + 1 || E.dias.length;
    }
    const DSN = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']; // por getUTCDay
    const dowDe = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
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
          h('b', null, `${hhmm(c.ini)}–${hhmm(c.fim)}${marca}`), c.pausa ? h('small', null, `int. ${hhmm(c.pausa[0])}–${hhmm(c.pausa[1])}`) : null,
          h('small', { class: 'liq-dia' }, `${hLiq((c.fim - c.ini) - (c.pausa ? c.pausa[1] - c.pausa[0] : 0))} líquidas`)); // horas trabalhadas no dia, sem o intervalo
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
              // feriado: mostra o horário que a escala usou e de onde veio (o horário próprio da data, na tela Feriados, vale mais que o padrão)
              const hfx = fer && TS.horarioFeriado ? TS.horarioFeriado({ ...(cfg || {}), operacao: op }, d) : null;
              const hTxtF = hfx ? (hfx.fechado ? 'fechada' : `${hfx.abre}–${hfx.fecha}`) : '';
              const origF = hfx ? { data: 'horário próprio desta data (tela Feriados)', feriados: 'padrão de feriados (Horário e equipe)', semana: 'horário normal do dia' }[hfx.origem] : '';
              return h('th', { class: (dowDe(d) === 0 ? 'dom' : '') + (fer ? ' fer' : '') + (E.dias.includes(d) ? '' : ' fora'), title: fer ? `${fer.nome}${hfx ? ` · loja ${hTxtF} (${origF})` : ''}` : '' }, h('span', null, DSN[dowDe(d)]), h('b', null, `${d.slice(8)}/${d.slice(5, 7)}`),
                fer ? h('small', null, fer.nome) : null, hfx ? h('small', { class: 'fer-hor' + (hfx.origem === 'data' ? ' proprio' : '') }, hfx.origem === 'data' ? `${hTxtF} ✎` : hTxtF) : null);
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
      h('span', { class: 'l-ferias' }, 'férias'), h('span', { class: 'l-fer' }, 'feriado'), h('span', null, '• ou * = ajuste manual'), h('span', null, 'Total = com intervalo · Líquida (e "líquidas" em cada dia) = sem intervalo'), h('span', { class: 'fer-hor proprio' }, '✎ = horário próprio do feriado (tela Feriados)'));
    const ferMes = [...E.feriados.values()];
    const imprimir = () => {
      document.getElementById('impressao')?.remove();
      const el = h('div', { id: 'impressao' }, h('section', { class: 'imp-pag imp-escala' },
        h('div', { class: 'imp-cab' }, h('div', null, h('div', { class: 'imp-marca' }, 'Tea Shop'), h('div', null, lojaNome || '')),
          h('div', { class: 'imp-dir' }, h('div', { class: 'imp-tit' }, 'Escala de trabalho'), h('div', null, `${TS.MESES_LONGOS[+ym.slice(5, 7) - 1]} de ${ym.slice(0, 4)}`), h('div', null, `Escala ${op.equipe.escala}${op.equipe.modelo === 'rodizio' ? ' · rodízio de domingo' : ''}`))),
        tabela(true), legenda(),
        ferMes.length ? h('p', { class: 'imp-obs' }, 'Feriados: ' + ferMes.map((f) => `${f.data.slice(8)}/${f.data.slice(5, 7)} ${f.nome}`).join(' · ')) : null,
        alertas.length ? h('p', { class: 'imp-obs' }, 'Atenção: ' + alertas.join(' · ')) : null,
        h('p', { class: 'imp-obs' }, `Intervalo: ${op.equipe.intervalo || 0} min nas jornadas acima de 8h${op.equipe.intervaloAte8 != null ? `, ${op.equipe.intervaloAte8} min nas de 4h a 8h` : ''}. Emitido em ${new Date().toLocaleString('pt-BR')}.`),
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
      // horário da loja nesse dia (feriado tem o seu) e jornada padrão: atalhos e conferência na hora
      const hfSel = E.feriados.has(iso) && TS.horarioFeriado ? TS.horarioFeriado({ ...(cfg || {}), operacao: op }, iso) : null;
      const fSel = hfSel && !hfSel.fechado ? hfSel : op.funcionamento[DIAS[wdDe(iso)]];
      const abreM = fSel && !fSel.fechado ? hm(fSel.abre) : null, fechaM = fSel && !fSel.fechado ? hm(fSel.fecha) : null;
      const eq = op.equipe, trabPad = Math.round(((eq.cargaSemanal * 60) / (eq.escala === '6x1' ? 6 : 5)) / B) * B;
      const totalPad = trabPad + intervaloMin(eq, trabPad);
      for (const x of [ini, fim]) { x.step = 600; if (abreM != null) { x.min = hhmm(abreM); x.max = hhmm(fechaM); } } // relógio de 10 em 10 min
      const resumo = h('small', { class: 'aj-resumo muted' });
      const hTxt2 = (m) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
      const conferir = () => {
        if (!ini.value || !fim.value || ini.value >= fim.value) { resumo.className = 'aj-resumo neg'; resumo.textContent = 'A entrada precisa ser antes da saída.'; return; }
        const dur = hm(fim.value) - hm(ini.value);
        const ivA = +eq.intervalo || 0; const iv = dur - ivA > 480 ? ivA : intervaloMin(eq, dur - intervaloMin(eq, Math.min(dur, 480)));
        const trab = iv && dur - iv > 240 ? dur - iv : dur;
        const avisos = [];
        if (abreM != null && (hm(ini.value) < abreM || hm(fim.value) > fechaM)) avisos.push(`fora do horário da loja (${hhmm(abreM)}–${hhmm(fechaM)})`);
        if (trab > trabPad + 5) avisos.push(`${hTxt2(trab - trabPad)} a mais que a jornada padrão (${hTxt2(trabPad)})`);
        else if (trab < trabPad - 5) avisos.push(`${hTxt2(trabPad - trab)} a menos que a jornada padrão (${hTxt2(trabPad)})`);
        resumo.className = 'aj-resumo ' + (avisos.length ? 'neg' : 'muted');
        resumo.textContent = `${hTxt2(dur)} no total = ${hTxt2(trab)} de trabalho${trab < dur ? ` + ${dur - trab} min de intervalo` : ''}${avisos.length ? ' · ⚠ ' + avisos.join(' · ') : ''}`;
      };
      ini.addEventListener('input', conferir); fim.addEventListener('input', conferir);
      const atalho = (rot, a, b) => (a == null ? null : h('button', { type: 'button', class: 'btn aj-atalho', onclick: () => { modo.value = 'trab'; mostrar(); ini.value = hhmm(a); fim.value = hhmm(b); conferir(); } }, h('b', null, rot), h('small', null, `${hhmm(a)}–${hhmm(b)}`)));
      const cabe = abreM != null && fechaM - abreM >= totalPad;
      const meio = cabe ? Math.round((abreM + (fechaM - abreM - totalPad) / 2) / B) * B : null;
      const atalhos = abreM != null ? h('div', { class: 'aj-atalhos' },
        cabe ? atalho('Abre', abreM, abreM + totalPad) : atalho('Dia todo', abreM, fechaM),
        cabe && fechaM - abreM - totalPad >= 60 ? atalho('Meio', meio, meio + totalPad) : null, // só quando sobra pelo menos 1h no dia
        cabe ? atalho('Fecha', fechaM - totalPad, fechaM) : null) : null;
      const blocoHora = h('div', null, atalhos, h('div', { class: 'aj-linha aj-horas' }, h('label', null, h('span', null, 'Entrada'), ini), h('label', null, h('span', null, 'Saída'), fim)), resumo);
      conferir();
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
      if (TS.demo) { AJ.msg = 'Na apresentação nada é salvo: os ajustes ficam só nesta tela.'; TS.render(); return; }
      btn.disabled = true;
      try {
        const r = await fetch(`/api/escala-ajustes?loja=${encodeURIComponent(cfg.id)}&ym=${ym}`, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ajustes: AJ.dados }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
        cfg.escalaAjustes = { ...(cfg.escalaAjustes || {}), [ym]: JSON.parse(JSON.stringify(AJ.dados)) };
        AJ.sujo = false; AJ.msg = ''; TS.render();
      } catch (e) { btn.textContent = e.message; btn.disabled = false; }
    };
    // replicar os ajustes para outro mês mantendo a alternância: cada dia recebe os ajustes do dia do mês de origem
    // com o MESMO dia da semana e a MESMA semana do rodízio (quem folga no domingo continua girando). Feriados e férias ficam de fora.
    const ancoraR = inicioDe(op.equipe, op.equipe.inicioRodizio || INICIO_PADRAO);
    const semR = (iso) => (L > 1 ? (((Math.round((diaMs(inicioDe(op.equipe, iso)) - diaMs(ancoraR)) / (7 * 86400000)) % L) + L) % L) : 0);
    const nomesEq = new Set(pessoasDe(op.equipe).map((q) => q.nome.trim().toUpperCase()));
    const deFerias = (nome, iso) => ((cfg && cfg.ferias) || []).some((f) => String(f.vendedor).trim().toUpperCase() === nome && f.de <= iso && f.ate >= iso);
    function replicar(srcYm, dstYm, src) {
      const ferSrc = new Set(TS.feriadosDoMes ? TS.feriadosDoMes(cfg, srcYm).map((f) => f.data) : []);
      const ferDst = new Set(TS.feriadosDoMes ? TS.feriadosDoMes(cfg, dstYm).map((f) => f.data) : []);
      const porChave = new Map(); // "semana|dia da semana" → ajustes do último dia assim no mês de origem
      for (const d of Object.keys(src).sort()) if (!ferSrc.has(d) && Object.keys(src[d] || {}).length) porChave.set(`${semR(d)}|${wdDe(d)}`, src[d]);
      const nD = new Date(Date.UTC(+dstYm.slice(0, 4), +dstYm.slice(5, 7), 0)).getUTCDate();
      const out = {}; let n = 0;
      for (let k = 1; k <= nD; k++) {
        const d = `${dstYm}-${String(k).padStart(2, '0')}`;
        const a = !ferDst.has(d) && porChave.get(`${semR(d)}|${wdDe(d)}`);
        if (!a) continue;
        for (const [nome, x] of Object.entries(a)) if (nomesEq.has(nome) && !deFerias(nome, d)) { (out[d] ||= {})[nome] = { ...x }; n++; }
      }
      return { out, n };
    }
    const iM = meses.indexOf(ym), prox = meses[iM + 1], ant = meses[iM - 1];
    const salvos = (m) => ((cfg && cfg.escalaAjustes) || {})[m] || {};
    const nomeMes = (m) => TS.MESES_LONGOS[+m.slice(5, 7) - 1].toLowerCase();
    const btnReplicar = pode && prox && nAj ? h('button', { type: 'button', class: 'btn', title: `Leva os ajustes deste mês para ${nomeMes(prox)}, seguindo o rodízio (mesma semana do rodízio e mesmo dia da semana). Você confere lá antes de salvar.`, onclick: () => {
      if (AJ.sujo) { alert('Salve os ajustes deste mês antes de replicar.'); return; }
      if (Object.keys(salvos(prox)).length && !confirm(`${TS.MESES_LONGOS[+prox.slice(5, 7) - 1]} já tem ajustes salvos. Substituir pelos deste mês? (você ainda confere antes de salvar)`)) return;
      const r = replicar(ym, prox, AJ.dados);
      state.escMesYm = prox;
      state.escAj = { chave: `${(cfg && cfg.id) || 'loja'}|${prox}`, dados: r.out, sujo: true, sel: null, msg: `${r.n} ajuste(s) trazidos de ${nomeMes(ym)} seguindo o rodízio. Confira e salve.` };
      TS.render();
    } }, `Replicar para ${nomeMes(prox)} ›`) : null;
    const btnTrazer = pode && ant && Object.keys(salvos(ant)).length ? h('button', { type: 'button', class: 'btn', title: `Traz os ajustes salvos de ${nomeMes(ant)} para este mês, seguindo o rodízio. Você confere antes de salvar.`, onclick: () => {
      if (nAj && !confirm(`Substituir os ${nAj} ajuste(s) deste mês pelos de ${nomeMes(ant)}?`)) return;
      const r = replicar(ant, ym, salvos(ant));
      AJ.dados = r.out; AJ.sujo = true; AJ.sel = null; AJ.msg = `${r.n} ajuste(s) trazidos de ${nomeMes(ant)} seguindo o rodízio. Confira e salve.`;
      TS.render();
    } }, `‹ Trazer de ${nomeMes(ant)}`) : null;
    const barraAj = h('div', { class: 'aj-barra' },
      h('span', { class: 'muted' }, nAj ? `${nAj} ajuste(s) manual(is) neste mês${AJ.sujo ? ' — não salvos' : ''}.${AJ.msg ? ' ' + AJ.msg : ''}` : 'Toque num dia de uma pessoa para ajustar (folga, horário ou troca).'),
      pode && AJ.sujo ? (() => { const b = h('button', { type: 'button', class: 'btn primary' }, 'Salvar ajustes'); b.addEventListener('click', () => salvarAj(b)); return b; })() : null,
      nAj ? h('button', { type: 'button', class: 'btn ghost-danger', onclick: () => { AJ.dados = {}; AJ.sujo = true; AJ.sel = null; TS.render(); } }, 'Desfazer ajustes do mês') : null,
      TS.demo && AJ.sujo ? h('span', { class: 'muted' }, '(na apresentação os ajustes não são salvos)') : null);

    return TS.cardWithTools('Escala do mês', `Dia a dia, com feriados e férias. ${L > 1 ? `Rodízio de ${L} semanas contado a partir ${semanaSeg(op.equipe) ? 'da segunda' : 'do domingo'} ${TS.fmt.date(inicioDe(op.equipe, op.equipe.inicioRodizio || INICIO_PADRAO))}.` : 'A semana-modelo se repete todas as semanas.'}`,
      h('div', { class: 'table-tools mes-tools' }, h('div', { class: 'mes-tools-esq' }, sel, btnTrazer, btnReplicar), h('button', { type: 'button', class: 'btn primary', onclick: imprimir }, '⎙ Exportar PDF')),
      alertas.length ? h('div', { class: 'notice' }, h('b', null, 'Atenção: '), alertas.slice(0, 6).join(' · '), alertas.length > 6 ? ` e mais ${alertas.length - 6}` : '') : null,
      barraAj, editor,
      legenda(), tabela(false));
  }

  /** escala em rodízio de domingo: ciclo de semanas (domingo a sábado) */
  function cartaoRodizio(need, op, horas, ideal) {
    const pessoas = pessoasDe(op.equipe);
    const r = montarRodizio(need, op, pessoas);
    const ORDEM = ordemSem(op.equipe); // dom..sáb ou seg..dom
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
        const c = cobHora(w.cob[wd], faixaDia(op.funcionamento[DIAS[wd]]), hr);
        const cls = c === 0 ? 'vazio' : c < n ? 'falta' : c > n ? 'sobra' : 'ok';
        return h('td', { class: cls, title: `${DIAS_NOME[wd]} ${hr}h: ${c} na loja, precisa de ${n}` }, c);
      })))));
    const aviso = tot.descoberto > 0
      ? h('div', { class: 'notice err' }, `Com ${pessoas.length} pessoa(s) e essas regras, a loja fica sem ninguém ${fmt.n1(tot.descoberto / r.L)} h por semana em média.${ideal.soAberto ? ` Equipe mínima: ${ideal.soAberto} pessoas.` : ''}`)
      : tot.abaixo > 0 ? h('div', { class: 'notice' }, `A loja nunca fica sozinha, mas faltam pessoas nos picos ou no mínimo do dia em ${fmt.n1(tot.abaixo / r.L)} h por semana, em média. Veja os alertas de cada semana.${ideal.tudo ? ` Com ${ideal.tudo} pessoas fica tudo coberto.` : ''}`)
        : h('div', { class: 'notice ok' }, 'Essa equipe cumpre o rodízio, os mínimos de cada dia e os picos.');
    return TS.cardWithTools(`Semana-modelo do rodízio de domingo (${op.equipe.escala})`,
      `Semana de ${semanaSeg(op.equipe) ? 'segunda a domingo' : 'domingo a sábado'}. ${r.kDom ? `${r.kDom} pessoa(s) trabalham em cada domingo; ${r.folgamDom} folga(m) — e folga(m) também na segunda${semanaSeg(op.equipe) ? ' seguinte' : ''}.` : 'Loja fechada no domingo.'} O ciclo se repete a cada ${r.L} semana(s). Jornada de ${Math.floor(r.jornada / 60)}h${String(Math.round(r.jornada % 60)).padStart(2, '0')} por dia${r.intervalo ? ` + ${r.intervalo} min de intervalo` : ''}. Confira a CLT e a convenção coletiva.`,
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
