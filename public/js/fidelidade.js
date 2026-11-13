/* Fidelidade (logs do FIXE): saldo de pontos, vencimentos e ligação das compras do FIXE aos cupons */
'use strict';
(function () {
  const TIPOS_COMPRA = new Set(['pontos', 'compra']);
  const JANELA_MIN = 120; // o FIXE registra os pontos perto da venda; a folga cobre o relógio e o lançamento depois

  const tokens = (s) => new Set(TS.norm(s).replace(/(\d+)\s*(g|kg|ml|un)\b/g, '$1$2').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length > 1 || /\d/.test(t)));
  const addMeses = (day, m) => { const d = new Date(day * 864e5); return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate()) / 864e5); };

  /** movimentos de todas as bases do FIXE carregadas → lista de objetos, com os cancelamentos aplicados */
  function movimentos() {
    const db = TS.db, lojaId = new Map(db.D.loja.map((s, i) => [s, i]));
    const out = [];
    for (const base of db.fidelidade || []) {
      const lid = base.vendaLoja != null ? lojaId.get(base.vendaLoja) : undefined;
      const porCpf = new Map();
      for (const r of base.ev) {
        const [cpf, iNome, iLoja, data, min, tipo, pontos, prods] = r;
        const m = { base, cpf, nome: base.nomes[iNome] || '', loja: base.lojas[iLoja] || '', propria: !!base.propria[iLoja], lojaId: base.propria[iLoja] ? lid : undefined,
          day: TS.isoToDay(data), min: min == null ? null : min, tipo, pontos: pontos || 0, produtos: prods ? prods.split('|') : [], anulado: false };
        out.push(m);
        let a = porCpf.get(cpf); if (!a) porCpf.set(cpf, (a = [])); a.push(m);
      }
      // "Operação cancelada via PDV": desfaz os pontos lançados pouco antes (mesmo dia, até 60 min)
      for (const lista of porCpf.values()) {
        for (const c of lista) {
          if (c.tipo !== 'cancelado' || c.min == null) continue;
          let alvo = null;
          for (const p of lista) if (p.tipo === 'pontos' && !p.anulado && p.day === c.day && p.min != null && p.min <= c.min && c.min - p.min <= 60 && (!alvo || p.min > alvo.min)) alvo = p;
          if (alvo) alvo.anulado = true;
        }
      }
    }
    return out;
  }

  /** saldo por CPF: lotes de pontos (FIFO), resgates e expirações tiram dos lotes mais antigos; lote vence após N meses */
  function saldos(movs) {
    const hoje = TS.todayDay();
    const porChave = new Map(); // base + cpf
    for (const m of movs) { const k = m.base.id + '|' + m.cpf; let a = porChave.get(k); if (!a) porChave.set(k, (a = [])); a.push(m); }
    const porCpf = new Map();
    for (const lista of porChave.values()) {
      const { validadeMeses } = lista[0].base.regras;
      lista.sort((a, b) => a.day - b.day || (a.min ?? 0) - (b.min ?? 0));
      const lotes = [];
      let ganhos = 0, resgatados = 0, expirados = 0;
      for (const m of lista) {
        if (m.anulado) continue;
        if ((m.tipo === 'pontos' || m.tipo === 'boasvindas') && m.pontos > 0) { lotes.push({ day: m.day, vence: addMeses(m.day, validadeMeses), resta: m.pontos }); ganhos += m.pontos; continue; }
        if (m.tipo !== 'resgate' && m.tipo !== 'expirou') continue;
        if (m.tipo === 'resgate') resgatados += m.pontos; else expirados += m.pontos;
        let falta = m.pontos;
        for (const l of lotes) { if (!falta) break; const t = Math.min(l.resta, falta); l.resta -= t; falta -= t; }
      }
      let saldo = 0, vencidos = 0, prox = null, proxPts = 0, em30 = 0;
      for (const l of lotes) {
        if (!l.resta) continue;
        if (l.vence <= hoje) { vencidos += l.resta; continue; }
        saldo += l.resta;
        if (l.vence <= hoje + 30) em30 += l.resta;
        if (prox == null || l.vence < prox) { prox = l.vence; proxPts = l.resta; } else if (l.vence === prox) proxPts += l.resta;
      }
      const cpf = lista[0].cpf;
      const a = porCpf.get(cpf) || { cpf, nome: '', saldo: 0, ganhos: 0, resgatados: 0, expirados: 0, vencidosSemBaixa: 0, prox: null, proxPts: 0, em30: 0, movs: [] };
      a.nome = a.nome || (lista.find((m) => m.nome) || {}).nome || '';
      a.saldo += saldo; a.ganhos += ganhos; a.resgatados += resgatados; a.expirados += expirados; a.vencidosSemBaixa += vencidos; a.em30 += em30;
      if (prox != null && (a.prox == null || prox < a.prox)) { a.prox = prox; a.proxPts = proxPts; } else if (prox != null && prox === a.prox) a.proxPts += proxPts;
      a.movs.push(...lista);
      porCpf.set(cpf, a);
    }
    for (const a of porCpf.values()) a.movs.sort((x, y) => y.day - x.day || (y.min ?? 0) - (x.min ?? 0));
    return porCpf;
  }

  /**
   * Liga as compras do FIXE (da própria loja) aos cupons de venda. O FIXE não tem o número do cupom:
   * mesmo dia + hora perto (quando há) + produtos em comum + pontos que o valor daria. Só liga quando o
   * melhor cupom é claramente melhor que o segundo; cada cupom é usado uma vez.
   */
  function ligar(movs) {
    const db = TS.db;
    const alvos = movs.filter((m) => TIPOS_COMPRA.has(m.tipo) && !m.anulado && m.lojaId !== undefined && (m.produtos.length || m.min != null));
    const dias = new Set(alvos.map((m) => m.lojaId + '|' + m.day));
    const cupons = new Map(); // "lojaId|day" → Map(cupom → { cupom, itens, min, vt, toks })
    const taxas = TS.rules.ids.taxas;
    for (let i = 0; i < db.n; i++) {
      const k = db.loja[i] + '|' + db.day[i];
      if (!dias.has(k)) continue;
      let m = cupons.get(k); if (!m) cupons.set(k, (m = new Map()));
      let c = m.get(db.cupom[i]);
      if (!c) m.set(db.cupom[i], (c = { cupom: db.cupom[i], lojaId: db.loja[i], day: db.day[i], itens: [], min: null, vt: 0 }));
      c.itens.push(i);
      if (c.min == null && db.min[i] != null) c.min = db.min[i];
      if (!taxas.has(db.desc[i])) c.vt += db.vt[i] || 0;
    }
    const tokDesc = new Map();
    const tk = (d) => { let t = tokDesc.get(d); if (!t) tokDesc.set(d, (t = tokens(db.D.descricao[d]))); return t; };
    const prodScore = (m, c) => {
      if (!m.produtos.length) return null;
      let ok = 0;
      for (const p of m.produtos) {
        const tp = tokens(p); if (!tp.size) continue;
        let best = 0;
        for (const i of c.itens) { const ti = tk(db.desc[i]); let n = 0; for (const t of tp) if (ti.has(t)) n++; best = Math.max(best, n / tp.size); }
        if (best >= 0.7) ok++;
      }
      return ok / m.produtos.length;
    };
    const pares = [];
    for (const m of alvos) {
      const lista = cupons.get(m.lojaId + '|' + m.day);
      if (!lista) continue;
      const rpp = m.base.regras.reaisPorPonto;
      const cands = [];
      for (const c of lista.values()) {
        const dt = m.min != null && c.min != null ? Math.abs(c.min - m.min) : null;
        if (dt != null && dt > JANELA_MIN) continue;
        const ps = prodScore(m, c);
        if (ps != null && ps < 0.5) continue;
        const ptsOk = m.tipo === 'pontos' && m.pontos > 0 ? Math.floor(c.vt / rpp + 1e-6) === m.pontos : null;
        if (ps == null && dt == null) continue;          // sem produto e sem hora: não dá para saber
        if (ps == null && ptsOk === false) continue;     // só pela hora, os pontos têm de bater
        const score = (ps ?? 0) * 2 + (ptsOk ? 1 : 0) + (dt != null ? 1 - dt / JANELA_MIN : 0);
        cands.push({ c, score });
      }
      if (!cands.length) continue;
      cands.sort((a, b) => b.score - a.score);
      pares.push({ m, cands });
    }
    // os mais certos primeiro; cada cupom vai para um movimento só
    pares.sort((a, b) => b.cands[0].score - a.cands[0].score);
    const usados = new Set(), lig = [];
    for (const p of pares) {
      const livres = p.cands.filter((x) => !usados.has(x.c.lojaId + '|' + x.c.day + '|' + x.c.cupom));
      if (!livres.length) continue;
      if (livres.length > 1 && livres[0].score - livres[1].score < 0.3) { p.m.ambiguo = true; continue; }
      const c = livres[0].c;
      usados.add(c.lojaId + '|' + c.day + '|' + c.cupom);
      p.m.cupom = c;
      lig.push({ m: p.m, c });
    }
    // só contam as compras do FIXE em dias que têm vendas no painel (o resto está fora do período importado)
    const noPeriodo = alvos.filter((m) => cupons.has(m.lojaId + '|' + m.day));
    return { lig, alvos: noPeriodo.length, semCupom: noPeriodo.filter((m) => !m.cupom).length };
  }

  TS.fx = {
    tem: () => !!(TS.db.fidelidade && TS.db.fidelidade.some((b) => b.ev && b.ev.length)),
    preparar() {
      const movs = movimentos();
      const porCpf = saldos(movs);
      const r = ligar(movs);
      return { movs, porCpf, ...r, bases: TS.db.fidelidade };
    },
    addMeses,
  };
})();
