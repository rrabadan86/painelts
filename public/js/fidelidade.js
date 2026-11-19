/* Fidelidade (logs do FIXE): saldo de pontos, vencimentos e ligação das compras do FIXE aos cupons */
'use strict';
(function () {
  const TIPOS_COMPRA = new Set(['pontos', 'compra']);
  const JANELA_MIN = 120; // o FIXE registra os pontos perto da venda; a folga cobre o relógio e o lançamento depois

  const tokens = (s) => new Set(TS.norm(s).replace(/(\d+)\s*(g|kg|ml|un)\b/g, '$1$2').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length > 1 || /\d/.test(t)));
  const addMeses = (day, m) => {
    const d = new Date(day * 864e5);
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + m;
    const ult = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return Math.round(Date.UTC(y, mo, Math.min(d.getUTCDate(), ult)) / 864e5);
  };

  /** movimentos de todas as bases do FIXE carregadas → lista de objetos, com os cancelamentos aplicados */
  function movimentos() {
    const db = TS.db, lojaId = new Map(db.D.loja.map((s, i) => [s, i]));
    const out = [];
    for (const base of db.fidelidade || []) {
      const lid = base.vendaLoja != null ? lojaId.get(base.vendaLoja) : undefined;
      const porCpf = new Map();
      for (const r of base.ev) {
        const [cpf, iNome, iLoja, data, min, tipo, pontos, prods, txt] = r;
        const m = { base, cpf, nome: base.nomes[iNome] || '', loja: base.lojas[iLoja] || '', propria: !!base.propria[iLoja], lojaId: base.propria[iLoja] ? lid : undefined,
          day: TS.isoToDay(data), min: min == null ? null : min, tipo, pontos: pontos || 0, produtos: prods ? prods.split('|') : [], txt: txt || '', anulado: false };
        out.push(m);
        let a = porCpf.get(cpf); if (!a) porCpf.set(cpf, (a = [])); a.push(m);
      }
      // "Operação cancelada via PDV": desfaz os pontos lançados pouco antes (mesmo dia, até 60 min)
      for (const lista of porCpf.values()) {
        for (const c of lista) {
          if (c.tipo !== 'cancelado' || c.min == null) continue;
          // pode cancelar uma compra (pontos) ou um resgate: vale o mais recente antes dele com os mesmos produtos; sem produto, o mais recente
          const prods = new Set(c.produtos.map((x) => TS.norm(x)));
          const comum = (p) => (prods.size ? p.produtos.some((x) => prods.has(TS.norm(x))) : true);
          let alvo = null;
          for (const p of lista) {
            if ((p.tipo !== 'pontos' && p.tipo !== 'resgate') || p.anulado || p.day !== c.day || p.min == null || p.min > c.min || c.min - p.min > 60) continue;
            const melhor = !alvo || (comum(p) && !comum(alvo)) || (comum(p) === comum(alvo) && p.min > alvo.min);
            if (melhor) alvo = p;
          }
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
      // saldo válido logo depois de cada movimento (para mostrar no cupom)
      const validoEm = (day) => lotes.reduce((t, l) => t + (l.vence > day ? l.resta : 0), 0);
      for (const m of lista) {
        if (m.anulado) continue;
        if ((m.tipo === 'pontos' || m.tipo === 'boasvindas' || m.tipo === 'ajuste') && m.pontos > 0) { m.vence = addMeses(m.day, validadeMeses); lotes.push({ day: m.day, vence: m.vence, resta: m.pontos }); ganhos += m.pontos; m.saldoApos = validoEm(m.day); continue; }
        if (m.tipo !== 'resgate' && m.tipo !== 'expirou' && m.tipo !== 'saida') continue;
        if (m.tipo === 'resgate') resgatados += m.pontos; else if (m.tipo === 'expirou') expirados += m.pontos;
        let falta = m.pontos;
        for (const l of lotes) { if (!falta) break; const t = Math.min(l.resta, falta); l.resta -= t; falta -= t; }
        m.saldoApos = validoEm(m.day);
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
      if (!lista) { m.motivo = 'periodo'; continue; }
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
      if (!cands.length) {
        m.motivo = 'nenhum';
        // para conferir à mão: os cupons do dia mais perto do horário do FIXE
        if (m.min != null) m.cands = [...lista.values()].filter((c) => c.min != null).sort((a, b) => Math.abs(a.min - m.min) - Math.abs(b.min - m.min)).slice(0, 2).map((c) => ({ cupom: c.cupom, min: c.min, vt: c.vt }));
        continue;
      }
      cands.sort((a, b) => b.score - a.score);
      pares.push({ m, cands });
    }
    // os mais certos primeiro; cada cupom vai para um movimento só
    pares.sort((a, b) => b.cands[0].score - a.cands[0].score);
    const usados = new Set(), lig = [];
    for (const p of pares) {
      const livres = p.cands.filter((x) => !usados.has(x.c.lojaId + '|' + x.c.day + '|' + x.c.cupom));
      const resumo = (x) => ({ cupom: x.c.cupom, min: x.c.min, vt: x.c.vt });
      if (!livres.length) { p.m.motivo = 'usado'; p.m.cands = p.cands.slice(0, 3).map(resumo); continue; }
      if (livres.length > 1 && livres[0].score - livres[1].score < 0.3) { p.m.ambiguo = true; p.m.motivo = 'ambiguo'; p.m.cands = livres.slice(0, 3).map(resumo); continue; }
      const c = livres[0].c;
      usados.add(c.lojaId + '|' + c.day + '|' + c.cupom);
      p.m.cupom = c;
      lig.push({ m: p.m, c });
    }
    // só contam as compras do FIXE em dias que têm vendas no painel (o resto está fora do período importado)
    const noPeriodo = alvos.filter((m) => cupons.has(m.lojaId + '|' + m.day));
    return { lig, alvos: noPeriodo.length, semCupom: noPeriodo.filter((m) => !m.cupom).length };
  }

  /** quem está no programa (base de leads + Logs) e desde quando; até que dia os Logs vão */
  function membros() {
    const m = new Map(), saldoFixe = new Map();
    let logsAte = null;
    // saldo oficial do FIXE com a hora em que foi lido: { pts, em, origem }. Vale o mais recente.
    // (a sincronização do robô lê o saldo direto no FIXE; a Base de leads pode trazer a coluna de saldo)
    const oficial = (cpf, pts, em, origem) => {
      const a = saldoFixe.get(cpf);
      if (!a || (em || '') > (a.em || '') || ((em || '') === (a.em || '') && pts > a.pts)) saldoFixe.set(cpf, { pts, em: em || null, origem });
    };
    for (const base of TS.db.fidelidade || []) {
      if (base.saldosFixe && base.saldosFixe.em) for (const [cpf, pts] of base.saldosFixe.s || []) oficial(cpf, pts, base.saldosFixe.em, 'sinc');
    }
    for (const base of TS.db.fidelidade || []) {
      for (const [cpf, d, sd] of base.membros || []) {
        if (sd != null) oficial(cpf, sd, base.membrosEm, 'leads'); // o saldo do FIXE é da rede: o mesmo em todas as bases
        const day = d ? TS.isoToDay(d) : null;
        if (!m.has(cpf) || (day != null && (m.get(cpf) == null || day < m.get(cpf)))) m.set(cpf, day);
      }
      if (base.ev && base.ev.length && base.em) { const d = TS.isoToDay(base.em.slice(0, 10)); if (logsAte == null || d > logsAte) logsAte = d; }
    }
    return { membros: m, logsAte, saldoFixe };
  }

  /**
   * Resgate dos clientes que juntaram pontos suficientes. Para cada CPF, em ordem de data:
   * fica "elegível" no dia em que o saldo válido chega ao mínimo de resgate; "resgatou" se fizer um resgate até
   * `prazo` dias depois; "em aberto" se o prazo ainda não acabou na data dos Logs; senão "não resgatou".
   * Depois de um resgate o cliente pode ficar elegível de novo (novo ciclo).
   */
  function resgates(movs, { min, prazo, ate }) {
    const porChave = new Map();
    for (const m of movs) { if (m.anulado) continue; const k = m.base.id + '|' + m.cpf; let a = porChave.get(k); if (!a) porChave.set(k, (a = [])); a.push(m); }
    const ciclos = []; // { cpf, E, fim, res: 'sim'|'nao'|'aberto', dias }
    for (const lista of porChave.values()) {
      const { validadeMeses } = lista[0].base.regras;
      lista.sort((a, b) => a.day - b.day || (a.min ?? 0) - (b.min ?? 0));
      const lotes = [];
      const valido = (day) => lotes.reduce((s, l) => s + (l.vence > day ? l.resta : 0), 0);
      let aberto = null, podeAbrir = true; // depois de um ciclo sem resgate, só abre outro após resgatar ou o saldo cair abaixo do mínimo
      const fecha = (res, day) => { ciclos.push({ cpf: lista[0].cpf, E: aberto, res, dias: day != null ? day - aberto : null }); aberto = null; };
      for (const m of lista) {
        // prazo vencido antes deste movimento: o ciclo fecha sem resgate
        if (aberto != null && m.day - aberto > prazo) { fecha('nao'); podeAbrir = false; }
        if ((m.tipo === 'pontos' || m.tipo === 'boasvindas' || m.tipo === 'ajuste') && m.pontos > 0) lotes.push({ vence: addMeses(m.day, validadeMeses), resta: m.pontos });
        else if (m.tipo === 'resgate' || m.tipo === 'expirou' || m.tipo === 'saida') {
          if (m.tipo === 'resgate') { if (aberto != null) fecha('sim', m.day); podeAbrir = true; }
          let falta = m.pontos;
          for (const l of lotes) { if (!falta) break; const t = Math.min(l.resta, falta); l.resta -= t; falta -= t; }
        }
        const v = valido(m.day);
        if (v < min) podeAbrir = true;
        else if (aberto == null && podeAbrir) aberto = m.day;
      }
      if (aberto != null) fecha(ate - aberto > prazo ? 'nao' : 'aberto');
    }
    return ciclos;
  }

  /**
   * cupom de venda de cada resgate de prêmio (o prêmio sai num cupom no caixa): mesmo dia e loja, hora perto
   * do registro no FIXE e o produto do prêmio no cupom. lista: [{ cpf, data (AAAA-MM-DD), min, produtos }]
   * → mesma ordem: { cupom, min, vt, vendedor, itens: [{ desc, qtd, vt }] } ou null
   */
  function cupomDosResgates(lojaPainel, lista) {
    const db = TS.db;
    const base = (db.fidelidade || []).find((b) => b.id === lojaPainel);
    const lid = base && base.vendaLoja != null ? db.D.loja.indexOf(base.vendaLoja) : -1;
    if (lid < 0) return lista.map(() => null);
    const dias = new Set(lista.map((r) => TS.isoToDay(r.data)));
    const porDia = new Map();
    for (let i = 0; i < db.n; i++) {
      if (db.loja[i] !== lid || !dias.has(db.day[i])) continue;
      let m = porDia.get(db.day[i]); if (!m) porDia.set(db.day[i], (m = new Map()));
      let c = m.get(db.cupom[i]); if (!c) m.set(db.cupom[i], (c = { cupom: db.cupom[i], min: null, vt: 0, vend: null, linhas: [] }));
      c.linhas.push(i);
      if (c.min == null && db.min[i] != null) c.min = db.min[i];
      c.vt += db.vt[i] || 0;
      if (c.vend == null) c.vend = db.D.vendedor[db.vend[i]] || null;
    }
    const usados = new Set();
    return lista.map((r) => {
      const m = porDia.get(TS.isoToDay(r.data));
      if (!m) return null;
      const tp = (r.produtos || []).map(tokens);
      let best = null;
      for (const c of m.values()) {
        if (usados.has(c.cupom)) continue;
        const dt = r.min != null && c.min != null ? Math.abs(c.min - r.min) : null;
        if (dt != null && dt > JANELA_MIN) continue;
        let ok = 0;
        for (const t of tp) { if (!t.size) continue; let b = 0; for (const i of c.linhas) { const ti = tokens(db.D.descricao[db.desc[i]]); let n = 0; for (const x of t) if (ti.has(x)) n++; b = Math.max(b, n / t.size); } if (b >= 0.7) ok++; }
        if (tp.length && !ok) continue; // o prêmio tem de estar no cupom
        const score = ok * 2 + (dt != null ? 1 - dt / JANELA_MIN : 0);
        if (!best || score > best.score) best = { c, score };
      }
      if (!best) return null;
      usados.add(best.c.cupom);
      const c = best.c;
      return { cupom: c.cupom, min: c.min, vt: c.vt, vendedor: c.vend, itens: c.linhas.map((i) => ({ desc: db.D.descricao[db.desc[i]], qtd: TS.qtdItem ? TS.qtdItem(i) : null, vt: db.vt[i] || 0 })) };
    });
  }

  TS.fx = {
    resgates,
    cupomDosResgates,
    tem: () => !!(TS.db.fidelidade && TS.db.fidelidade.some((b) => (b.ev && b.ev.length) || (b.membros && b.membros.length))),
    preparar() {
      const movs = movimentos();
      const porCpf = saldos(movs);
      const r = ligar(movs);
      // dias em que o CPF teve movimento no FIXE (qualquer loja): a venda desse dia passou pelo FIXE
      const movDia = new Set();
      for (const m of movs) if (!m.anulado && m.tipo !== 'expirou') movDia.add(m.cpf + '|' + m.day);
      const mb = membros();
      // saldo oficial do FIXE: é o que vale. Depois da leitura, soma o que os Logs trazem de novo
      // (pontos ganhos, resgates, expirações). A conta só pelos Logs fica para comparar e para os vencimentos.
      const quando = (iso) => { if (!iso) return null; const d = new Date(iso); if (isNaN(d)) return null; const p2 = (n) => String(n).padStart(2, '0'); return { day: TS.isoToDay(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`), min: d.getHours() * 60 + d.getMinutes() }; };
      const SINAL = { pontos: 1, boasvindas: 1, ajuste: 1, resgate: -1, expirou: -1, saida: -1 };
      for (const [cpf, of] of mb.saldoFixe) {
        let a = porCpf.get(cpf);
        if (!a) { if (!of.pts) continue; porCpf.set(cpf, (a = { cpf, nome: '', saldo: 0, ganhos: 0, resgatados: 0, expirados: 0, vencidosSemBaixa: 0, prox: null, proxPts: 0, em30: 0, movs: [] })); }
        const q = quando(of.em), vistos = new Set();
        let depois = 0;
        if (q) for (const m of a.movs) {
          if (m.anulado || !SINAL[m.tipo] || !(m.day > q.day || (m.day === q.day && m.min != null && m.min > q.min))) continue;
          const k = m.day + '|' + m.min + '|' + m.tipo + '|' + m.pontos; // o mesmo movimento nos Logs de duas lojas conta uma vez
          if (vistos.has(k)) continue;
          vistos.add(k);
          depois += SINAL[m.tipo] * (m.pontos || 0);
        }
        a.saldoLogs = a.saldo;
        a.saldoFixe = Math.max(0, of.pts + depois);
        a.saldoFixeLido = of.pts; a.saldoFixeEm = of.em; a.saldoFixeOrigem = of.origem; a.saldoFixeDepois = depois;
        a.saldo = a.saldoFixe;
      }
      return { movs, porCpf, ...r, ...mb, movDia, bases: TS.db.fidelidade };
    },
    addMeses,
  };
})();
