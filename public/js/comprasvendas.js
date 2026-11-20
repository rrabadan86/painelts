/* Compras × vendas do mês: "estou comprando mais do que vendo?"
 * - Compras: notas de entrada do AppNext que o coletor guarda (só compra concluída, sem devolução/troca): soma de
 *   custo × quantidade de cada item, pelo dia de entrada da nota.
 * - Vendas: faturamento da loja no mês (com Espaço Gourmet, sem taxas e sem itens a R$ 0,01), como no Resultado.
 * - Teto: % das vendas que a loja aceita gastar em compras (Configurações → Lojas → Estoque e margem; padrão 32%).
 *   Nos quadros (Pedido e Resultado) o teto olha para a FRENTE: % × vendas previstas para os próximos dias (entrega + período do
 *   pedido) = ritmo dos últimos 30 dias × época do ano (ano passado, com as datas comemorativas do Pedido), contra o que foi comprado
 *   nos últimos dias (mesmo tamanho de período) + o pedido da tela. Na tabela mês a mês, o teto de cada mês é % × vendas do mês.
 * Aparece no Pedido (quadros antes da lista, com o valor do pedido somado) e no Resultado (mês a mês).
 * Só para quem vê custo: os dados vêm de /api/estoque, que o servidor só entrega a quem tem tela de custo. */
(function () {
  'use strict';
  const TETO_PADRAO = 32;
  const diasDoMes = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  const ymMais = (ym, n) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);

  /** notas de compra por mês: itens = { cod: [[AAAA-MM-DD, custo unitário, nº da NF, quantidade, fornecedor], …] }
   *  → { 'AAAA-MM': { valor, notas } } */
  function comprasPorMes(itens) {
    const out = {};
    for (const lista of Object.values(itens || {})) {
      for (const [dia, custo, nf, qtd] of lista || []) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia)) || !(custo > 0) || !(qtd > 0)) continue;
        const m = out[dia.slice(0, 7)] || (out[dia.slice(0, 7)] = { valor: 0, nfs: new Set() });
        m.valor += custo * qtd;
        m.nfs.add(String(nf));
      }
    }
    for (const m of Object.values(out)) { m.valor = Math.round(m.valor * 100) / 100; m.notas = m.nfs.size; delete m.nfs; }
    return out;
  }

  /**
   * vendas: { 'AAAA-MM': { fat, fatCusto, custo, ultimo: 'AAAA-MM-DD' } } (fatCusto = vendas que têm custo no estoque)
   * compras: resultado de comprasPorMes, ou null se o painel não tem as notas
   * desde: data em que as notas começam (antes disso as compras são desconhecidas: "—")
   * hoje: 'AAAA-MM-DD'; tetoPct: % das vendas; pedido: valor do pedido que está na tela (soma às compras do mês)
   */
  function resumo({ vendas = {}, compras = null, desde = null, hoje, tetoPct = TETO_PADRAO, meses = 12, pedido = 0 }) {
    const pct = (tetoPct > 0 ? tetoPct : TETO_PADRAO) / 100;
    const ymHoje = String(hoje).slice(0, 7);
    const yC = Object.keys(compras || {}).sort(), yV = Object.keys(vendas).filter((k) => vendas[k] && vendas[k].fat > 0).sort();
    // as notas começam em "desde"; sem essa data, na primeira compra que existe
    const dDesde = /^\d{4}-\d{2}-\d{2}/.test(String(desde || '')) ? String(desde).slice(0, 10) : null;
    const inicioCompras = !compras ? null : dDesde ? dDesde.slice(0, 7) : yC[0] || null;
    const primeiro = [yC[0], yV[0]].filter(Boolean).sort()[0];
    const lista = [];
    if (primeiro) {
      let ym = ymMais(ymHoje, -(Math.max(1, meses) - 1));
      if (ym < primeiro) ym = primeiro;
      for (; ym <= ymHoje; ym = ymMais(ym, 1)) {
        const v = vendas[ym] || {}, fat = v.fat || 0, parcial = ym === ymHoje, dm = diasDoMes(ym);
        const sabe = inicioCompras != null && ym >= inicioCompras;
        const c = sabe ? ((compras[ym] && compras[ym].valor) || 0) : null;
        const cmvPct = v.fatCusto > 0 ? v.custo / v.fatCusto : null;
        const cmv = cmvPct == null ? null : v.custo + (fat - v.fatCusto) * cmvPct; // vendas sem custo entram pelo mesmo %
        const decorridos = parcial && v.ultimo && v.ultimo.slice(0, 7) === ym ? Math.min(dm, Math.max(1, +v.ultimo.slice(8, 10))) : null;
        const projecao = parcial ? (decorridos && fat > 0 ? (fat * dm) / decorridos : null) : null;
        const base = parcial ? projecao : fat; // o teto (R$) do mês em andamento usa a projeção: fica na coluna da folga
        const teto = base > 0 ? base * pct : null;
        // o % do mês em andamento é "até agora": compras até hoje ÷ vendas ATÉ HOJE (dividir pela projeção misturava o comprado de verdade com venda que ainda não aconteceu)
        const pctMes = c != null && fat > 0 ? c / fat : null;
        lista.push({
          ym, parcial, diasMes: dm, decorridos, vendas: fat, projecao, base: base > 0 ? base : null,
          compras: c, notas: sabe ? ((compras[ym] && compras[ym].notas) || 0) : null,
          comprasParcial: sabe && ym === inicioCompras && !!dDesde && dDesde.slice(8, 10) !== '01',
          pct: pctMes, teto, folga: teto != null && c != null ? teto - c : null,
          acima: parcial ? (pctMes == null ? null : pctMes > pct + 1e-9) : teto != null && c != null ? c > teto + 0.005 : null,
          cmv, cmvPct, saldo: c != null && cmv != null ? c - cmv : null,
        });
      }
    }
    const m = lista.find((x) => x.ym === ymHoje) || null;
    const ped = pedido > 0 ? pedido : 0;
    let mes = null;
    if (m) {
      const soma = m.compras == null ? null : m.compras + ped;
      const cabe = m.teto != null && soma != null ? m.teto - soma : null;
      mes = { ...m, pedido: ped, soma, cabe, pctSoma: soma != null && m.base ? soma / m.base : null, ritmoCurto: m.decorridos != null && m.decorridos < 5,
        estado: cabe == null ? 'sem' : cabe < -0.005 ? 'acima' : soma > m.teto * 0.9 ? 'perto' : 'ok' };
    }
    // meses fechados com compras conhecidas: o retrato do período
    const fechados = lista.filter((x) => !x.parcial && x.compras != null && x.vendas > 0);
    const s = (k) => fechados.reduce((a, x) => a + (x[k] || 0), 0);
    const comCmv = fechados.filter((x) => x.cmv != null);
    const total = { meses: fechados.length, vendas: s('vendas'), compras: s('compras'), pct: s('vendas') > 0 ? s('compras') / s('vendas') : null,
      cmvPct: comCmv.length ? comCmv.reduce((a, x) => a + x.cmv, 0) / comCmv.reduce((a, x) => a + x.vendas, 0) : null,
      acima: fechados.filter((x) => x.acima).length };
    return { tetoPct: pct * 100, meses: lista, mes, total, inicioCompras, desde: dDesde, temCompras: !!compras };
  }

  // ---------------------------------------------------------------- teto pela previsão ----------------------------------------------------------------
  const DIA = 864e5;
  const paraDia = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DIA);
  const paraIso = (d) => new Date(d * DIA).toISOString().slice(0, 10);
  const segundoDomingoMaio = (ano) => { const d = new Date(Date.UTC(ano, 4, 1)); return Math.floor(d.getTime() / DIA) + ((7 - d.getUTCDay()) % 7) + 7; };
  /** janela de uma data comemorativa num ano, em dias: { de: 'MM-DD', ate: 'MM-DD' } ou { regra: 'maes', diasAntes } (as do Pedido) */
  function janelaEvento(ev, ano) {
    if (ev.regra === 'maes') { const d = segundoDomingoMaio(ano); return [d - (+ev.diasAntes || 0), d]; }
    if (!/^\d{2}-\d{2}$/.test(String(ev.de)) || !/^\d{2}-\d{2}$/.test(String(ev.ate))) return null;
    const d0 = paraDia(`${ano}-${ev.de}`); let d1 = paraDia(`${ano}-${ev.ate}`);
    if (d1 < d0) d1 = paraDia(`${ano + 1}-${ev.ate}`);
    return [d0, d1];
  }
  const lim = (f) => Math.min(3, Math.max(0.4, f));

  /**
   * Vendas previstas para os próximos dias (a base do teto de compras): o ritmo de agora × a época do ano.
   *   dias: { 'AAAA-MM-DD': faturamento do dia }; ult: último dia com venda no painel; janela: dias à frente (entrega + período do pedido);
   *   eventos: datas comemorativas do Pedido; ateEvento: evento escolhido no modo "Data comemorativa" (a janela vai até o fim dele).
   * Época do ano: para cada dia à frente, as vendas do mesmo dia no ano passado (364 dias antes: mesmo dia da semana); dia dentro de
   * uma data comemorativa usa o dia correspondente dessa data no ano passado (resolve as que mudam de dia, como o Dia das Mães).
   * fator = (média por dia da janela no ano passado) ÷ (média por dia dos 30 dias anteriores a ela no ano passado), entre 0,4 e 3.
   */
  function previsao({ dias = {}, ult, janela = 40, eventos = [], ateEvento = null }) {
    if (!ult || !/^\d{4}-\d{2}-\d{2}$/.test(ult)) return null;
    const u = paraDia(ult), v = (d) => dias[paraIso(d)] || 0;
    const datas = Object.keys(dias).sort(), primeiro = datas.length ? paraDia(datas[0]) : u;
    const evs = [];
    for (const ev of eventos || []) for (const ano of [+ult.slice(0, 4) - 1, +ult.slice(0, 4), +ult.slice(0, 4) + 1]) {
      const a = janelaEvento(ev, ano), b = janelaEvento(ev, ano - 1);
      if (a && b) evs.push({ ev, a, b });
    }
    let W = Math.max(7, Math.round(janela) || 40), esticada = null;
    if (ateEvento) {
      const x = evs.filter((e) => e.ev === ateEvento || (ateEvento.id != null && e.ev.id === ateEvento.id)).find((e) => e.a[1] > u);
      if (x && x.a[1] - u > W) { W = Math.min(150, x.a[1] - u); esticada = x.ev.nome || 'data comemorativa'; }
    }
    // o dia do ano passado que corresponde a d
    const anoPassado = (d) => { const e = evs.find((x) => d >= x.a[0] && d <= x.a[1]); return e ? Math.min(e.b[1], e.b[0] + (d - e.a[0])) : d - 364; };
    const nBase = Math.min(30, u - primeiro + 1);
    let base = 0; for (let d = u - nBase + 1; d <= u; d++) base += v(d);
    const baseDia = nBase >= 7 && base > 0 ? base / nBase : null;
    let A = 0, B = 0; const dentro = new Map();
    for (let d = u + 1; d <= u + W; d++) { A += v(anoPassado(d)); const e = evs.find((x) => d >= x.a[0] && d <= x.a[1]); if (e) dentro.set(e.ev, e); }
    // a base do ano passado são os 30 dias logo antes do primeiro dia correspondente (sem encostar na própria data comemorativa)
    const ly0 = anoPassado(u + 1);
    for (let d = ly0 - 30; d < ly0; d++) B += v(d);
    const temAno = primeiro <= ly0 - 30;
    const semEpoca = !temAno ? 'o painel ainda não tem um ano de vendas desta loja' : !(A > 0 && B > 0) ? 'não há vendas no mesmo período do ano passado' : null;
    const bruto = semEpoca ? 1 : (A / W) / (B / 30), fator = lim(bruto);
    return {
      janela: W, esticada, de: paraIso(u + 1), ate: paraIso(u + W), ult, baseDias: nBase, base, baseDia,
      lyJanela: semEpoca ? null : A, lyBase: semEpoca ? null : B, lyDe: paraIso(ly0), lyAte: paraIso(anoPassado(u + W)),
      fator, fatorBruto: bruto, limitado: !semEpoca && Math.abs(bruto - fator) > 1e-9, semEpoca,
      crescAno: !semEpoca && B > 0 && nBase === 30 ? base / B - 1 : null,
      eventos: [...dentro.values()].map((e) => ({ nome: e.ev.nome || 'Data comemorativa', de: paraIso(Math.max(e.a[0], u + 1)), ate: paraIso(Math.min(e.a[1], u + W)), lyDe: paraIso(e.b[0]), lyAte: paraIso(e.b[1]) })),
      previsao: baseDia == null ? null : baseDia * fator * W,
    };
  }

  /** compras (notas que deram entrada) num intervalo de dias, a partir dos itens das notas */
  function comprasNoPeriodo(itens, de, ate) {
    let valor = 0; const nfs = new Set();
    for (const lista of Object.values(itens || {})) for (const [dia, custo, nf, qtd] of lista || []) {
      if (!(dia >= de && dia <= ate) || !(custo > 0) || !(qtd > 0)) continue;
      valor += custo * qtd; nfs.add(String(nf));
    }
    return { valor: Math.round(valor * 100) / 100, notas: nfs.size };
  }

  /**
   * Teto de compras pela previsão: % × vendas previstas para os próximos W dias, contra o que já foi comprado nos últimos W dias
   * (mesmo tamanho de período) + o pedido da tela.
   */
  function tetoJanela({ prev, itens = null, desde = null, hoje, tetoPct = TETO_PADRAO, pedido = 0 }) {
    if (!prev) return null;
    const pct = (tetoPct > 0 ? tetoPct : TETO_PADRAO) / 100, W = prev.janela;
    const cDe = paraIso(paraDia(hoje) - W + 1);
    const c = itens ? comprasNoPeriodo(itens, cDe, hoje) : null;
    const dDesde = /^\d{4}-\d{2}-\d{2}/.test(String(desde || '')) ? String(desde).slice(0, 10) : null;
    const ped = pedido > 0 ? pedido : 0;
    const teto = prev.previsao != null ? prev.previsao * pct : null;
    const soma = c ? c.valor + ped : null;
    const cabe = teto != null && soma != null ? teto - soma : null;
    return { ...prev, tetoPct: pct * 100, teto, compras: c ? c.valor : null, notas: c ? c.notas : null, comprasDe: cDe, comprasAte: hoje,
      comprasParcial: !!(c && dDesde && dDesde > cDe), desde: dDesde, pedido: ped, soma, cabe,
      pctSoma: soma != null && prev.previsao ? soma / prev.previsao : null,
      estado: cabe == null ? 'sem' : cabe < -0.005 ? 'acima' : soma > teto * 0.9 ? 'perto' : 'ok' };
  }

  const API = { comprasPorMes, resumo, previsao, comprasNoPeriodo, tetoJanela, janelaEvento, TETO_PADRAO };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }

  // ---------------------------------------------------------------- tela ----------------------------------------------------------------
  const { h, fmt, state } = TS;

  /** vendas de cada mês da loja (todos os dias, sem os filtros da lateral), com as mesmas regras do Resultado */
  const memo = new WeakMap();
  function vendasPorMes(M) {
    const db = TS.db;
    const hit = memo.get(db);
    if (hit && hit.M === M) return hit.out;
    const out = {};
    for (let i = 0; i < db.n; i++) {
      if (M.taxa(i)) continue; // taxa de serviço, entrega e itens a R$ 0,01 (resgates da fidelidade)
      const ym = db.ym[i];
      const m = out[ym] || (out[ym] = { fat: 0, fatCusto: 0, custo: 0, ultimo: '' });
      const vt = db.vt[i] || 0;
      m.fat += vt;
      if (db.iso[i] > m.ultimo) m.ultimo = db.iso[i];
      const c = M.custo(i);
      if (c != null) { m.fatCusto += vt; m.custo += c; }
    }
    memo.set(db, { M, out });
    return out;
  }

  /** vendas de cada dia da loja (mesmas regras de vendasPorMes) e o último dia com venda */
  const memoDia = new WeakMap();
  function vendasPorDia(M) {
    const db = TS.db;
    const hit = memoDia.get(db);
    if (hit && hit.M === M) return hit.out;
    const dias = {}; let ult = '';
    for (let i = 0; i < db.n; i++) {
      if (M.taxa(i)) continue;
      const iso = db.iso[i];
      dias[iso] = (dias[iso] || 0) + (db.vt[i] || 0);
      if (iso > ult) ult = iso;
    }
    const out = { dias, ult };
    memoDia.set(db, { M, out });
    return out;
  }
  /** o teto pela previsão dos próximos dias; o = { janela, eventos, evento } (o Pedido manda as datas comemorativas e a escolhida) */
  function montarJanela(M, e, pedido, o = {}) {
    const { dias, ult } = vendasPorDia(M);
    const cfg = (e && e.cfg) || {};
    const janela = o.janela || ((+cfg.entregaDias || 10) + (+cfg.coberturaDias || 30));
    const prev = previsao({ dias, ult, janela, eventos: o.eventos || [], ateEvento: o.evento || null });
    const c = e && e.compras;
    return tetoJanela({ prev, itens: c ? c.itens : null, desde: c ? c.desde : null, hoje: TS.hojeSP(), tetoPct: cfg.comprasTetoPct ?? TETO_PADRAO, pedido });
  }

  /** junta o que o painel já tem (vendas, custos e notas de compra) → resumo */
  function montar(M, e, pedido) {
    const c = e && e.compras;
    return resumo({ vendas: vendasPorMes(M), compras: c ? comprasPorMes(c.itens) : null, desde: c ? c.desde : null, hoje: TS.hojeSP(),
      tetoPct: e && e.cfg ? e.cfg.comprasTetoPct : TETO_PADRAO, pedido });
  }

  const ONDE = 'Mude o teto em Configurações → Lojas → Estoque e margem → Reposição.';
  const semNotas = () => h('div', { class: 'notice' }, 'Compras × vendas: o painel ainda não tem as notas de compra desta loja (o robô traz do AppNext, em Entrada de Produtos).');

  const dm = (iso) => fmt.date(iso).slice(0, 5);
  const fx = (f) => '×' + fmt.n2(f);
  /** explicação completa da previsão (vai nos ⓘ): a conta aberta, com os números da loja */
  function comoPrevisao(J) {
    const l = [];
    l.push(`O que a loja deve vender de ${dm(J.de)} a ${dm(J.ate)} (${J.janela} dias): é para esse período que a compra de agora serve.`);
    l.push(J.esticada ? `Os ${J.janela} dias vão até o fim de "${J.esticada}", a data comemorativa escolhida no Pedido.` : `${J.janela} dias = prazo de entrega + período do pedido (os mesmos do Pedido).`);
    if (J.baseDia == null) { l.push('Ainda não há vendas suficientes (pelo menos 7 dias) para prever.'); return l.join('\n\n'); }
    l.push(`1) Ritmo de agora: ${fmt.brl0(J.base)} vendidos nos últimos ${J.baseDias} dias = ${fmt.brl0(J.baseDia)} por dia.`);
    if (J.semEpoca) l.push(`2) Época do ano: não entrou na conta (${J.semEpoca}). A previsão usa só o ritmo de agora, então pode ficar baixa antes de uma data forte.`);
    else {
      l.push(`2) Época do ano: no ano passado, os mesmos ${J.janela} dias (${dm(J.lyDe)} a ${dm(J.lyAte)}) venderam ${fmt.brl0(J.lyJanela / J.janela)} por dia, contra ${fmt.brl0(J.lyBase / 30)} por dia nos 30 dias antes deles. Ou seja, a época vende ${fx(J.fatorBruto)} o ritmo de antes${J.limitado ? ` (a conta limita a ${fx(J.fator)}, entre ×0,40 e ×3,00, para um ano fora do comum não distorcer)` : ''}.`);
      if (J.eventos.length) l.push('Datas comemorativas do Pedido dentro do período: ' + J.eventos.map((x) => `${x.nome} (${dm(x.de)} a ${dm(x.ate)}; usa as vendas de ${dm(x.lyDe)} a ${dm(x.lyAte)} do ano passado)`).join('; ') + '. Assim a data que muda de dia, como o Dia das Mães, é comparada com ela mesma.');
      if (J.crescAno != null) l.push(`O crescimento da loja já está no ritmo de agora: os últimos 30 dias estão ${J.crescAno >= 0 ? '+' : ''}${fmt.n1(J.crescAno * 100)}% contra os mesmos dias do ano passado.`);
    }
    l.push(`3) Previsão = ${fmt.brl0(J.baseDia)} por dia ${fx(J.fator)} × ${J.janela} dias = ${fmt.brl0(J.previsao)}.`);
    l.push('É uma estimativa: promoção, clima ou falta de produto mudam o resultado.');
    return l.join('\n\n');
  }
  /** os quadros do teto pela previsão; comPedido: mostra o quadro "Este pedido" (tela Pedido) */
  function quadrosJanela(J, comPedido) {
    if (!J) return [];
    const W = J.janela;
    const kPrev = TS.kpi(`Vendas previstas · próximos ${W} dias`, J.previsao == null ? '—' : fmt.brl0(J.previsao),
      J.previsao == null ? 'faltam vendas para prever' : `${dm(J.de)} a ${dm(J.ate)} · ${J.semEpoca ? 'só o ritmo de agora' : `época do ano ${fx(J.fator)}`}${J.eventos.length ? ' · ' + J.eventos.map((x) => x.nome).join(', ') : ''}`,
      comoPrevisao(J));
    const kTeto = TS.kpi('Teto de compras', J.teto == null ? '—' : fmt.brl0(J.teto),
      J.teto == null ? 'sem previsão de vendas' : `${fmt.n1(J.tetoPct)}% das vendas previstas`,
      `Quanto a loja pode comprar para abastecer os próximos ${W} dias.\n\nTeto = ${fmt.n1(J.tetoPct)}% × vendas previstas${J.previsao != null ? ` (${fmt.brl0(J.previsao)}) = ${fmt.brl0(J.teto)}` : ''}.\n\nComo a previsão olha para a frente, o teto sobe sozinho antes de uma época forte (Natal, Dia das Mães) e encolhe depois dela.\n\nO percentual é o quanto das vendas a loja aceita gastar em compras; fica perto do custo do que vende (CMV). ${ONDE}\n\nÉ só um aviso: não trava o pedido nem muda o pedido sugerido.`);
    const kComprado = TS.kpi(`Comprado nos últimos ${W} dias`, J.compras == null ? '—' : fmt.brl0(J.compras),
      J.compras == null ? 'sem notas de compra' : `${fmt.int(J.notas)} ${J.notas === 1 ? 'nota' : 'notas'} · ${dm(J.comprasDe)} a ${dm(J.comprasAte)}${J.comprasParcial ? ' · notas incompletas' : ''}`,
      `Soma das notas de compra que deram entrada no AppNext de ${dm(J.comprasDe)} a ${dm(J.comprasAte)} (custo × quantidade de cada item; só compra concluída, sem devolução nem troca).\n\nUsa o mesmo número de dias da previsão (${W}) para comparar períodos do mesmo tamanho: o que entrou nos últimos ${W} dias contra o que deve sair nos próximos ${W}.\n\nNota que ainda não deu entrada não conta.${J.comprasParcial ? `\n\nAtenção: o painel só tem as notas desde ${fmt.date(J.desde)}; o valor pode estar menor que o real.` : ''}`);
    const kPedido = comPedido ? TS.kpi('Este pedido', fmt.brl0(J.pedido), J.soma == null ? 'soma às compras' : h('span', null, 'com ele, as compras vão a ', h('b', null, fmt.brl0(J.soma))),
      'O valor do pedido que está na tela agora (carrinho + pedido obrigatório). Muda na hora quando você altera as quantidades.\n\nEle entra na conta como compra, mesmo antes de a nota chegar.') : null;
    const vCabe = J.cabe == null ? '—' : h('span', { class: J.estado === 'acima' ? 'neg' : J.estado === 'perto' ? 'warn-t' : 'pos' }, fmt.brl0(Math.abs(J.cabe)));
    const kCabe = TS.kpi(J.estado === 'acima' ? 'Passou do teto' : 'Ainda cabe comprar', vCabe,
      J.cabe == null ? (J.compras == null ? 'faltam as notas de compra' : 'falta a previsão de vendas')
        : J.estado === 'acima' ? `compras${comPedido ? ' + pedido' : ''} = ${fmt.pct(J.pctSoma)} das vendas previstas`
          : `${comPedido ? 'depois deste pedido · ' : ''}usado ${fmt.pct(J.soma / J.teto, 0)} do teto`,
      `Teto − comprado nos últimos ${W} dias${comPedido ? ' − este pedido' : ''}${J.cabe != null ? ` = ${fmt.brl0(J.teto)} − ${fmt.brl0(J.compras)}${comPedido ? ` − ${fmt.brl0(J.pedido)}` : ''} = ${fmt.brl0(J.cabe)}` : ''}.\n\nVerde: cabe com folga. Amarelo: já usou mais de 90% do teto. Vermelho: passou do teto, ou seja, a loja está comprando mais do que a previsão de vendas comporta — veja se há produto sobrando (Estoque → Sobrando) antes de fechar o pedido.`);
    return [kPrev, kTeto, kComprado, kPedido, kCabe].filter(Boolean);
  }

  /** Pedido: "já comprado no mês × teto", com o valor do pedido da tela somado. el.atualizar(valor) refaz quando o pedido muda */
  function quadroPedido(M, e, pedido, o = {}) {
    const el = h('div', { class: 'cv-pedido mt' });
    el.atualizar = (valor) => {
      if (!e || !e.compras) { el.replaceChildren(semNotas()); return; }
      const J = montarJanela(M, e, valor, o);
      el.replaceChildren(...[
        h('div', { class: 'section-label' }, `Compras × teto${J ? ` · para vender de ${dm(J.de)} a ${dm(J.ate)}` : ''} `, h('a', { href: '#dre', class: 'cv-link' }, 'ver mês a mês no Resultado')),
        J && J.estado === 'acima' ? h('div', { class: 'notice warn' }, `Com este pedido, as compras passam o teto em ${fmt.brl0(-J.cabe)} (${fmt.pct(J.pctSoma)} das vendas previstas para os próximos ${J.janela} dias; o teto é ${fmt.n1(J.tetoPct)}%). Veja se dá para tirar o que tem estoque sobrando.`) : null,
        J && J.semEpoca && J.previsao != null ? h('div', { class: 'notice' }, `A previsão usa só o ritmo de agora: ${J.semEpoca}. Antes de uma data forte, o teto pode ficar baixo.`) : null,
        h('div', { class: 'grid g-kpi' }, quadrosJanela(J, true)),
      ].filter(Boolean));
    };
    el.atualizar(pedido);
    return el;
  }

  /** Resultado: quadros do mês, gráfico e tabela mês a mês (compras × vendas × custo do que vendeu) */
  function cartaoResultado(M) {
    const el = h('div', { class: 'cv-resultado mt' });
    const loja = state.loja;
    TS.estoqueBuscar(loja).then((e) => {
      if (!el.isConnected) return;
      if (!e || !e.compras) { el.replaceChildren(semNotas()); return; }
      pintarResultado(el, montar(M, e, 0), montarJanela(M, e, 0));
    }).catch(() => el.remove());
    return el;
  }

  function pintarResultado(el, R, J) {
    const fil = state.cvFil || 'todos';
    const comCompras = R.meses.filter((x) => x.compras != null);
    const FIL = { todos: ['Todos os meses', () => true], acima: ['Acima do teto', (x) => x.acima === true], dentro: ['Dentro do teto', (x) => x.acima === false] };
    const cont = (k) => R.meses.filter(FIL[k][1]).length;
    const ir = (k) => { state.cvFil = k; pintarResultado(el, R, J); };
    const T = R.total;
    const kPer = TS.kpi(`Compras ÷ vendas · ${T.meses} ${T.meses === 1 ? 'mês fechado' : 'meses fechados'}`, T.pct == null ? '—' : h('span', { class: T.pct > R.tetoPct / 100 ? 'neg' : 'pos' }, fmt.pct(T.pct)),
      T.pct == null ? 'ainda sem mês fechado com notas' : `teto ${fmt.n1(R.tetoPct)}%${T.cmvPct != null ? ` · custo do que vendeu ${fmt.pct(T.cmvPct)}` : ''}`,
      'Tudo o que a loja comprou ÷ tudo o que vendeu nos meses fechados da tabela (só os meses em que o painel tem as notas de compra). Se ficar acima do custo do que vendeu, o estoque está crescendo.');
    const kAcima = TS.kpi('Meses acima do teto', fmt.int(cont('acima')), cont('acima') ? 'clique para ver quais' : 'nenhum no período',
      `Meses em que as compras passaram de ${fmt.n1(R.tetoPct)}% das vendas. Um mês acima não é problema se o seguinte compensar (ex.: compra grande antes do Natal).`);
    kAcima.classList.add('est-kpi-click'); kAcima.setAttribute('role', 'button'); kAcima.tabIndex = 0;
    kAcima.addEventListener('click', (ev) => { if (!ev.target.closest('.dica-i')) ir(fil === 'acima' ? 'todos' : 'acima'); });
    kAcima.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ir(fil === 'acima' ? 'todos' : 'acima'); });

    const cor = TS.cores || [];
    const graf = comCompras.length ? TS.chart({
      type: 'bar',
      data: { labels: R.meses.map((x) => TS.ymLabel(x.ym) + (x.parcial ? '*' : '')),
        datasets: [
          { type: 'bar', label: 'Compras', data: R.meses.map((x) => x.compras), backgroundColor: cor[0], borderRadius: 4, order: 2 },
          { type: 'bar', label: 'Custo do que vendeu', data: R.meses.map((x) => x.cmv), backgroundColor: cor[2], borderRadius: 4, order: 3 },
          { type: 'line', label: `Teto (${fmt.n1(R.tetoPct)}% das vendas)`, data: R.meses.map((x) => x.teto), borderColor: cor[1], backgroundColor: cor[1], tension: 0.3, pointRadius: 3, order: 1 },
        ] },
      options: { plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? '—' : fmt.brl0(c.raw)}` } } }, scales: { y: TS.axisNum(fmt.brl0), x: TS.axisCat } },
    }) : null;

    const tab = TS.table({
      cols: [
        { key: 'ym', label: 'Mês', align: 'l', sticky: true, wrap: true, render: (x) => h('span', null, h('b', null, TS.ymLabel(x.ym)), ' ',
          x.acima === true ? h('span', { class: 'badge ' + (x.parcial ? 'warn' : 'erro') }, x.parcial ? 'até agora acima do teto' : 'acima do teto') : x.acima === false ? h('span', { class: 'badge ok' }, x.parcial ? 'até agora dentro do teto' : 'dentro do teto') : h('span', { class: 'badge cinza' }, x.compras == null ? 'sem notas' : 'sem vendas'),
          x.parcial ? h('small', { class: 'muted cv-det' }, `em andamento · ${x.decorridos || 0} de ${x.diasMes} dias`) : x.comprasParcial ? h('small', { class: 'muted cv-det' }, `notas só a partir de ${fmt.date(R.desde)}`) : null) },
        { key: 'vendas', label: 'Vendas', title: 'Faturamento da loja no mês (com Espaço Gourmet, sem taxa de serviço, entrega e itens a R$ 0,01), igual ao Resultado. No mês em andamento: o vendido até agora e, embaixo, a previsão no ritmo atual.',
          render: (x) => h('div', null, fmt.brl0(x.vendas), x.parcial && x.projecao != null ? h('small', { class: 'muted cv-det' }, `previsão ${fmt.brl0(x.projecao)}`) : null) },
        { key: 'compras', label: 'Compras', title: 'Notas de compra que deram entrada no mês (custo × quantidade de cada item; só compra concluída, sem devolução nem troca). "—" = o painel não tem as notas daquele mês.',
          render: (x) => (x.compras == null ? '—' : h('div', null, fmt.brl0(x.compras), h('small', { class: 'muted cv-det' }, `${fmt.int(x.notas)} ${x.notas === 1 ? 'nota' : 'notas'}`))), sortVal: (x) => x.compras ?? -1 },
        { key: 'pct', label: 'Compras ÷ vendas', title: `Quanto das vendas virou compra. Vermelho = passou do teto de ${fmt.n1(R.tetoPct)}%. Mês fechado: compras do mês ÷ vendas do mês. Mês em andamento: compras até hoje ÷ vendas ATÉ HOJE (não a previsão) — por isso a etiqueta diz "até agora". No começo do mês é normal ficar alto: uma nota grande já entrou e as vendas ainda estão no início; veja a folga ao lado, que usa a previsão do mês inteiro.`,
          render: (x) => (x.pct == null ? '—' : h('b', { class: x.acima ? 'neg' : 'pos' }, fmt.pct(x.pct))), sortVal: (x) => x.pct ?? -1 },
        { key: 'folga', label: 'Folga no teto', title: `Teto (${fmt.n1(R.tetoPct)}% das vendas) − compras. Positivo: ainda cabia comprar; negativo: comprou além do teto. No mês em andamento o teto é ${fmt.n1(R.tetoPct)}% da previsão de vendas do mês inteiro (vendido até agora ÷ dias que passaram × dias do mês).`,
          render: (x) => (x.folga == null ? '—' : h('div', null, h('span', { class: x.folga < 0 ? 'neg' : null }, fmt.brl0(x.folga)), h('small', { class: 'muted cv-det' }, `teto ${fmt.brl0(x.teto)}`))), sortVal: (x) => x.folga ?? -1e12 },
        { key: 'cmv', label: 'Custo do que vendeu', title: 'CMV: custo dos produtos vendidos no mês, pelo custo de hoje do estoque (o mesmo do Resultado; vendas sem custo entram pelo mesmo % das outras). É o que a loja precisaria comprar só para repor o que saiu.',
          render: (x) => (x.cmv == null ? '—' : h('div', null, fmt.brl0(x.cmv), h('small', { class: 'muted cv-det' }, `${fmt.pct(x.cmvPct)} das vendas`))), sortVal: (x) => x.cmv ?? -1 },
        { key: 'saldo', label: 'Compras − custo', title: 'Positivo: comprou mais do que saiu (o estoque cresceu, dinheiro parado). Negativo: vendeu estoque que já tinha. No mês em andamento ainda está incompleto.',
          render: (x) => (x.saldo == null ? '—' : h('span', { class: x.saldo > 0 ? 'warn-t' : null }, `${x.saldo > 0 ? '+' : ''}${fmt.brl0(x.saldo)}`)), sortVal: (x) => x.saldo ?? -1e12 },
      ],
      rows: R.meses.filter(FIL[fil] ? FIL[fil][1] : FIL.todos[1]), sortKey: 'ym', sortDir: 'desc', cls: 'cv-t',
      empty: fil === 'acima' ? 'Nenhum mês acima do teto. 👏' : 'Sem meses para mostrar.',
    });
    el.replaceChildren(
      h('div', { class: 'section-label' }, 'Compras × vendas'),
      h('div', { class: 'grid g-kpi' }, ...quadrosJanela(J, false), kAcima),
      h('div', { class: 'grid g-kpi mt' }, kPer),
      h('div', { class: 'mt' }, TS.cardWithTools('Compras × vendas mês a mês',
        `Estou comprando mais do que vendo? Compras = notas de compra que entraram no AppNext; teto = ${fmt.n1(R.tetoPct)}% das vendas. * mês em andamento: o % é o de até agora (compras ÷ vendas até hoje) e o teto da folga usa a previsão do mês.${R.inicioCompras ? ` Notas de compra desde ${R.desde ? fmt.date(R.desde) : TS.ymLabel(R.inicioCompras)}.` : ''}`,
        TS.seg(Object.entries(FIL).map(([k, [t]]) => [`${t} (${cont(k)})`, k]), FIL[fil] ? fil : 'todos', ir),
        graf, tab)));
  }

  TS.comprasVendas = { ...API, vendasPorMes, vendasPorDia, montar, montarJanela, quadroPedido, cartaoResultado };
})();
