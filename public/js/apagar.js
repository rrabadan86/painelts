/* Caixa a pagar (Resultado → A pagar): calendário de vencimentos com previsão de entrada. NÃO é contabilidade.
 * O que sai (por data de vencimento):
 *  - custos fixos (Configurações → Estoque e margem, R$ por mês) no DIA cadastrado; sem dia = último dia do mês;
 *  - despesas de um mês só, no dia cadastrado do mês delas (sem dia = último dia do mês);
 *  - notas de compra concluídas: o painel não tem a condição de pagamento da nota, então o vencimento é ESTIMADO =
 *    dia de entrada + prazo da franquia em dias (configurável);
 *  - royalties + marketing e Simples do mês: vencem no mês seguinte (dia configurável; Simples no dia 20). O valor é o
 *    mesmo do Resultado (mês em andamento e seguintes: estimado pela previsão de vendas).
 * O que entra: a previsão de vendas de cada dia (média do dia da semana da projeção única, TS.projecaoMes), menos a taxa
 * da maquininha; a parte em cartão cai N dias depois ("dias para receber do cartão").
 * Saldo por semana = entra − sai, acumulado a partir do saldo informado (ou zero). Conta marcada como paga sai do saldo.
 * Arquivo de conta pura no começo (module.exports para o node --test) e a tela depois. Só para quem vê custo. */
(function () {
  'use strict';
  const DIA = 86400000;
  const diaDe = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DIA);
  const isoDe = (d) => new Date(d * DIA).toISOString().slice(0, 10);
  const maisDias = (iso, n) => isoDe(diaDe(iso) + n);
  const diasNoMes = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  const ymMais = (ym, n) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const limite = (v, a, z) => Math.min(z, Math.max(a, v));
  /** dia do mês → data; sem dia (ou dia que o mês não tem, ex.: 31 em fevereiro) = último dia do mês */
  const dataNoMes = (ym, dia) => `${ym}-${String(Math.min(dia >= 1 ? Math.round(dia) : 99, diasNoMes(ym))).padStart(2, '0')}`;
  const slug = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
  const ehCompra = (n) => /compra/i.test(n.motivo || '') && /^conclu/i.test(n.status || '');

  /**
   * Lista do que vence de (hoje − atras) até (hoje + dias − 1), em ordem de data.
   *   fixos          [{ nome, valor, dia?, cat? }] custos fixos em R$ por mês
   *   pontuaisDoMes  (ym) → [{ nome, valor, dia?, cat? }] despesas de um mês só que caem em ym (a regra é a do Resultado)
   *   notas          notas de entrada [{ id, nf, fornecedor, entrada, emissao, total, motivo, status }]; prazoNotas em dias
   *   competencias   [{ origem, nome, ym, valor, estimado, dia, detalhe }] — o que é do mês ym e vence no dia `dia` do mês SEGUINTE
   *   pagos          { id: { em, por } } contas já marcadas como pagas
   *   valorDoMes     (fixo, ym) → R$ do custo fixo naquele mês (o lançado no Resultado ou o padrão; sem ele, o padrão)
   * → [{ id, origem, nome, vence, valor, estimado, semDia, detalhe, atrasado, pago, pagoEm, pagoPor }]
   */
  function vencimentos({ hoje, dias = 30, atras = 15, fixos = [], pontuaisDoMes = null, notas = [], prazoNotas = 30, competencias = [], pagos = {}, valorDoMes = null }) {
    const de = maisDias(hoje, -atras), ate = maisDias(hoje, dias - 1);
    const out = [], vistos = new Set();
    const por = (it) => {
      if (!(it.valor > 0) || !it.vence || it.vence < de || it.vence > ate) return;
      let id = it.id;
      for (let k = 2; vistos.has(id); k++) id = `${it.id}-${k}`; // dois custos com o mesmo nome
      vistos.add(id);
      const pg = pagos && pagos[id];
      out.push({ ...it, id, valor: r2(it.valor), atrasado: it.vence < hoje, pago: !!pg, pagoEm: pg ? pg.em || null : null, pagoPor: pg ? pg.por || null : null });
    };
    for (let ym = de.slice(0, 7); ym <= ate.slice(0, 7); ym = ymMais(ym, 1)) {
      for (const x of fixos) por({ id: `fixo|${slug(x.nome)}|${ym}`, origem: 'fixo', nome: x.nome, cat: x.cat || null, vence: dataNoMes(ym, x.dia), valor: valorDoMes ? +valorDoMes(x, ym) : +x.valor, estimado: false, semDia: !(x.dia >= 1) });
      for (const x of (pontuaisDoMes ? pontuaisDoMes(ym) : [])) por({ id: `pontual|${slug(x.nome)}|${ym}`, origem: 'pontual', nome: x.nome, cat: x.cat || null, vence: dataNoMes(ym, x.dia), valor: +x.valor, estimado: false, semDia: !(x.dia >= 1) });
    }
    const prazo = limite(Math.round(+prazoNotas) || 0, 0, 180);
    for (const n of notas || []) {
      const ent = String(n.entrada || n.emissao || '').slice(0, 10);
      if (!ehCompra(n) || !/^\d{4}-\d{2}-\d{2}$/.test(ent)) continue;
      por({ id: `nota|${slug(n.id != null ? n.id : n.nf)}`, origem: 'nota', nome: `NF ${n.nf != null ? n.nf : '—'}${n.fornecedor ? ' · ' + n.fornecedor : ''}`, vence: maisDias(ent, prazo), valor: +n.total, estimado: true, semDia: false, entrada: ent, prazo });
    }
    for (const c of competencias || []) {
      if (!/^\d{4}-\d{2}$/.test(String(c.ym || ''))) continue;
      por({ id: `${slug(c.origem)}|${c.ym}`, origem: c.origem, nome: c.nome, vence: dataNoMes(ymMais(c.ym, 1), c.dia), valor: +c.valor, estimado: !!c.estimado, semDia: false, ym: c.ym, detalhe: c.detalhe || null });
    }
    return out.sort((a, b) => (a.vence < b.vence ? -1 : a.vence > b.vence ? 1 : b.valor - a.valor));
  }

  /**
   * Entrada prevista por dia, de hoje até hoje + dias − 1.
   *   vendaDia(iso)  venda do dia: a real nos dias que já passaram, a prevista de hoje em diante
   *   parteCartao    quanto das vendas é cartão (0 a 1); sem a informação, 1 (tudo cai com o prazo: conta conservadora)
   *   diasCartao     dias para o cartão cair na conta (0 a 60)
   *   taxaMaq        taxa média da maquininha sobre as vendas (0 a 0,5): não entra no caixa
   * A parte que não é cartão entra no próprio dia; a parte em cartão, diasCartao depois (as vendas dos últimos dias
   * ainda estão por cair). → Map(iso → { vista, cartao, total })
   */
  function entradas({ hoje, dias = 30, vendaDia, parteCartao = 1, diasCartao = 1, taxaMaq = 0 }) {
    const c = limite(parteCartao == null || !isFinite(parteCartao) ? 1 : +parteCartao, 0, 1);
    const n = limite(Math.round(+diasCartao) || 0, 0, 60), t = limite(+taxaMaq || 0, 0, 0.5);
    const h0 = diaDe(hoje), fim = h0 + dias - 1, out = new Map();
    const soma = (d, k, v) => { if (!(v > 0)) return; const iso = isoDe(d); const x = out.get(iso) || out.set(iso, { vista: 0, cartao: 0, total: 0 }).get(iso); x[k] += v; x.total += v; };
    for (let d = h0 - n; d <= fim; d++) {
      const v = (+vendaDia(isoDe(d)) || 0) * (1 - t);
      if (!(v > 0)) continue;
      if (d >= h0) soma(d, 'vista', v * (1 - c));
      if (d + n >= h0 && d + n <= fim) soma(d + n, 'cartao', v * c);
    }
    return out;
  }

  /**
   * Saldo previsto por semana (segunda a domingo; a primeira começa hoje e a última acaba no fim do período).
   * sai = contas a vencer na semana ainda não pagas (vencidas antes de hoje ficam de fora: aparecem à parte);
   * entra = entrada prevista (null sem previsão); acumulado = saldo inicial + saldos das semanas até ali.
   * → [{ de, ate, entra, sai, contas, saldo, acumulado, falta }]
   */
  function semanas({ hoje, dias = 30, itens = [], entradas: ent = null, saldoInicial = 0 }) {
    const h0 = diaDe(hoje), fim = h0 + dias - 1, out = [];
    let acum = +saldoInicial || 0;
    for (let d = h0; d <= fim;) {
      const dow = new Date(d * DIA).getUTCDay(); // 0 = domingo
      const ate = Math.min(fim, d + (dow === 0 ? 0 : 7 - dow));
      const de = isoDe(d), ateIso = isoDe(ate);
      const daSemana = itens.filter((x) => !x.pago && !x.atrasado && x.vence >= de && x.vence <= ateIso);
      const sai = r2(daSemana.reduce((a, x) => a + x.valor, 0));
      let entra = null;
      if (ent) { entra = 0; for (let k = d; k <= ate; k++) entra += (ent.get(isoDe(k)) || { total: 0 }).total; entra = r2(entra); }
      const saldo = entra == null ? null : r2(entra - sai);
      if (saldo != null) acum = r2(acum + saldo);
      out.push({ de, ate: ateIso, entra, sai, contas: daSemana.length, saldo, acumulado: saldo == null ? null : acum, falta: saldo != null && acum < -0.005 ? r2(-acum) : 0 });
      d = ate + 1;
    }
    return out;
  }
  /** primeira semana em que o dinheiro previsto não cobre as contas → { de, ate, falta } ou null */
  const alerta = (sems) => { const s = (sems || []).find((x) => x.falta > 0); return s ? { de: s.de, ate: s.ate, falta: s.falta } : null; };
  /** somas da lista: o que falta pagar no período, o que venceu sem baixa e o que já foi pago */
  function totais(itens) {
    const t = { aPagar: 0, nAPagar: 0, vencidos: 0, nVencidos: 0, pagos: 0, nPagos: 0, estimado: 0 };
    for (const x of itens || []) {
      if (x.pago) { t.pagos += x.valor; t.nPagos++; }
      else if (x.atrasado) { t.vencidos += x.valor; t.nVencidos++; }
      else { t.aPagar += x.valor; t.nAPagar++; if (x.estimado) t.estimado += x.valor; }
    }
    for (const k of ['aPagar', 'vencidos', 'pagos', 'estimado']) t[k] = r2(t[k]);
    return t;
  }

  const API = { vencimentos, entradas, semanas, alerta, totais, dataNoMes, maisDias, ymMais, slug, ehCompra };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }

  // ============================== tela ==============================
  const { h, fmt, state } = TS;
  const dm = (iso) => fmt.date(iso).slice(0, 5);
  const ORIGEM = {
    fixo: ['Custo fixo', 'Custo fixo cadastrado em Configurações → Lojas → Estoque e margem (R$ por mês), no dia de vencimento cadastrado.'],
    pontual: ['Despesa do mês', 'Despesa de um mês só (IPTU, 13º…), no dia cadastrado do mês dela.'],
    nota: ['Nota de compra', 'Nota de compra concluída no AppNext. O vencimento é estimado: dia de entrada + prazo da franquia.'],
    royalties: ['Royalties', 'Royalties + marketing do mês, pelas regras da loja (o mesmo valor do Resultado). Vencem no mês seguinte.'],
    simples: ['Imposto', 'Simples Nacional do mês (o % cadastrado sobre as vendas, como no Resultado). Vence no dia 20 do mês seguinte.'],
  };
  const NAO_E = 'Não é contabilidade nem extrato do banco: é um calendário do que vence, com uma previsão do que deve entrar.';

  const mem = new Map(); // loja → { e, notas, extra }
  async function carregar(loja) {
    if (mem.has(loja)) return mem.get(loja);
    const ler = async (rota) => { const r = await fetch(TS.api(`${rota}?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || 'Não consegui ler os dados.'); return j; };
    const [e, notas, extra] = await Promise.all([TS.estoqueBuscar(loja), ler('estoque/notas').catch(() => null), ler('apagar')]);
    const d = { e, notas: notas && Array.isArray(notas.notas) ? notas.notas : null, extra: { pagos: extra.pagos || {}, cartao: extra.cartao || null } };
    mem.set(loja, d);
    return d;
  }
  TS.aoLimparCache && TS.aoLimparCache(() => mem.clear());

  /** junta o que o painel já tem → { itens, sems, ent, ... } */
  function montar(M, D, dias) {
    const hoje = TS.hojeSP(), ymH = hoje.slice(0, 7), cfg = (D.e && D.e.cfg) || {}, db = TS.db;
    const fixos = M.ded.OUTROS.filter((x) => x.tipo === 'mes');
    // royalties e Simples: os mesmos números do Resultado (mês fechado = real; em andamento = projeção)
    const meses = TS.dreCalcular ? TS.dreCalcular(M) : [];
    const PM = TS.projecaoMes ? TS.projecaoMes(ymH, { base: 'loja', todas: true }) : null;
    const cfgLoja = (db.metas || []).find((m) => m.id === state.loja) || null;
    const prevDia = !PM ? null : (iso) => (TS.lojaAberta(cfgLoja, iso) ? (PM.metodo === 'semana' ? PM.medias[new Date(iso + 'T12:00:00Z').getUTCDay()] : PM.mediaSimples) || 0 : 0);
    const h0 = TS.todayDay(), reais = new Map();
    for (let i = 0; i < db.n; i++) if (db.day[i] >= h0 - 60 && db.day[i] < h0 && TS.contaFat(i)) reais.set(db.day[i], (reais.get(db.day[i]) || 0) + (db.vt[i] || 0));
    const vendaDia = (iso) => (iso < hoje ? reais.get(TS.isoToDay(iso)) || 0 : prevDia ? prevDia(iso) : 0);
    const atual = meses.find((m) => m.ym === ymH) || null;
    const ref = atual || meses[meses.length - 1] || null; // de onde vêm os % para os meses que ainda não começaram
    const comp = [];
    const ate = maisDias(hoje, dias - 1);
    for (let ym = ymMais(maisDias(hoje, -15).slice(0, 7), -1); ymMais(ym, 1) <= ate.slice(0, 7); ym = ymMais(ym, 1)) {
      const m = meses.find((x) => x.ym === ym);
      let roy = null, imp = null, est = false, det = null;
      if (m && ym < ymH) { roy = m.roy; imp = m.imp; det = `mês fechado: ${fmt.brl0(m.fat)} de vendas`; }
      else if (m && ym === ymH) { const p = m.proj || m; roy = p.roy; imp = p.imp; est = true; det = `mês em andamento: pela projeção de ${fmt.brl0(p.fat)} de vendas`; }
      else if (ym > ymH && prevDia && ref && ref.fat > 0) {
        let v = 0; for (let d = TS.isoToDay(ym + '-01'), f = d + diasNoMes(ym) - 1; d <= f; d++) v += prevDia(TS.dayToIso(d));
        roy = v * (ref.roy / ref.fat); imp = v * (ref.imp / ref.fat); est = true; det = `mês que ainda não começou: previsão de ${fmt.brl0(v)} de vendas`;
      }
      if (roy > 0) comp.push({ origem: 'royalties', nome: `Royalties + marketing de ${TS.ymLabel(ym)}`, ym, valor: roy, estimado: est, dia: cfg.royaltiesDia || 10, detalhe: det });
      if (imp > 0) comp.push({ origem: 'simples', nome: `Simples Nacional de ${TS.ymLabel(ym)}`, ym, valor: imp, estimado: est, dia: 20, detalhe: det });
    }
    const itens = vencimentos({ hoje, dias, fixos, pontuaisDoMes: M.ded.pontuaisDoMes, notas: D.notas || [], prazoNotas: cfg.prazoNotasDias, competencias: comp, pagos: D.extra.pagos, valorDoMes: M.ded.fixoDoMes ? (x, ym) => M.ded.fixoDoMes(x, ym).valor : null });
    const cartao = D.extra.cartao;
    const parte = cartao && cartao.pct != null ? cartao.pct : 1;
    const ent = prevDia ? entradas({ hoje, dias, vendaDia, parteCartao: parte, diasCartao: cfg.cartaoDias, taxaMaq: M.ded.pCartao }) : null;
    const sems = semanas({ hoje, dias, itens, entradas: ent, saldoInicial: state.apSaldo || 0 });
    return { hoje, dias, cfg, itens, ent, sems, PM, cartao, parte, fixos, temNotas: !!D.notas, tot: totais(itens), entTotal: ent ? r2([...ent.values()].reduce((a, x) => a + x.total, 0)) : null, entCartao: ent ? r2([...ent.values()].reduce((a, x) => a + x.cartao, 0)) : null };
  }

  async function marcar(loja, x, pago) {
    const r = await fetch(TS.api('apagar/pago'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' },
      body: JSON.stringify({ loja, id: x.id, pago, nome: x.nome, valor: x.valor, vence: x.vence }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não consegui gravar.');
    const D = mem.get(loja);
    if (!D) return;
    if (j.pagos) D.extra.pagos = j.pagos; // na apresentação nada é gravado: a marca fica só nesta página
    else if (pago) D.extra.pagos[x.id] = { em: new Date().toISOString(), por: (TS.eu && TS.eu.nome) || '' };
    else delete D.extra.pagos[x.id];
  }

  /** aba "A pagar" do Resultado */
  function pagina(corpo, M) {
    const loja = state.loja;
    corpo.replaceChildren(h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Montando o calendário…'))));
    carregar(loja).then((D) => { if (corpo.isConnected && state.loja === loja) pintar(corpo, M, D); })
      .catch((e) => { if (corpo.isConnected) corpo.replaceChildren(h('div', { class: 'notice err' }, TS.erroDeRede && TS.erroDeRede(e) ? 'Sem conexão com o painel agora. Tente de novo em instantes.' : e.message)); });
  }

  function pintar(corpo, M, D) {
    const dias = state.apDias === 60 ? 60 : 30;
    const R = montar(M, D, dias), T = R.tot, cfg = R.cfg;
    const refazer = () => pintar(corpo, M, D);
    const podeCfg = !!(TS.eu && TS.eu.pode && TS.eu.pode.configurar);
    const ajustar = (rot) => (podeCfg ? h('a', { href: '#config', onclick: (e) => { e.preventDefault(); TS.editarCustos(state.loja, 'cfg-caixa'); } }, rot) : null);

    // ----- avisos: só o que pede ação -----
    const A = alerta(R.sems);
    const avisos = [
      A ? h('div', { class: 'notice warn ap-alerta' }, `Na semana de ${dm(A.de)} faltam ${fmt.brl0(A.falta)}: o que deve entrar até lá não cobre as contas que vencem. `, TS.dica(`Soma do que entra menos o que vence, desde hoje${state.apSaldo ? `, partindo do saldo informado de ${fmt.brl0(state.apSaldo)}` : ' (sem contar o dinheiro que já está na conta: informe o saldo de hoje para a conta ficar completa)'}. É uma previsão: as vendas podem vir acima ou abaixo da média.`)) : null,
      !R.fixos.length && !T.nAPagar ? h('div', { class: 'notice' }, 'Ainda não há custos fixos cadastrados: sem eles o calendário fica vazio. ', ajustar('Cadastrar custos da loja')) : null,
      !R.temNotas ? h('div', { class: 'notice' }, 'O painel ainda não tem as notas de compra desta loja (o robô traz do AppNext): as compras ficam fora do calendário.') : null,
    ].filter(Boolean);

    // ----- quadros -----
    let fil = ['abertos', 'vencidos', 'pagos', 'todos'].includes(state.apFil) ? state.apFil : 'abertos';
    const saldoFim = R.sems.length ? R.sems[R.sems.length - 1].acumulado : null;
    const comoEntra = !R.PM ? 'Ainda não há vendas neste mês para prever (a previsão aparece depois do primeiro dia de vendas do mês).'
      : `Previsão de vendas de cada dia, de hoje até ${dm(maisDias(R.hoje, dias - 1))}: a média do mesmo dia da semana nas últimas semanas (a mesma conta da projeção do mês; dia de loja fechada conta zero).\n\nMenos a taxa da maquininha (${fmt.pct(M.ded.pCartao)}).\n\nCartão: ${R.cartao && R.cartao.pct != null ? `${fmt.pct(R.parte, 0)} das vendas, pelos fechamentos de caixa dos últimos ${R.cartao.dias} dias com fechamento` : 'o painel não tem o fechamento do caixa desta loja, então considera tudo como cartão (conta conservadora)'}; cai na conta ${cfg.cartaoDias === 0 ? 'no mesmo dia' : `${cfg.cartaoDias} ${cfg.cartaoDias === 1 ? 'dia' : 'dias'} depois da venda`}. O resto (dinheiro, Pix) entra no dia.\n\nDepois do fim deste mês a previsão segue com as mesmas médias: não considera Natal, Dia das Mães nem promoção.`;
    // herói (redesenho de 22/11): o saldo previsto decide; a pagar e a entrada explicam; vencidos sem baixa é uma linha clicável
    const dicaPagar = `Tudo o que vence de hoje até ${dm(maisDias(R.hoje, dias - 1))} e ainda não foi marcado como pago: custos fixos, despesas do mês, notas de compra, royalties + marketing e Simples.\n\n"Estimado" = o painel não tem a data ou o valor exatos (nota de compra pelo prazo da franquia; royalties e Simples do mês em andamento pela projeção de vendas).\n\nNão entram: comissões e o que não estiver cadastrado como custo fixo ou despesa do mês (parcela de empréstimo, pró-labore…). Cadastre para aparecer aqui.`;
    const kVenc = h('button', { type: 'button', class: 'link-btn ap-h-venc' + (T.nVencidos ? ' warn-t' : ''), title: 'Contas que venceram nos últimos 15 dias e não foram marcadas como pagas. O painel não sabe se foram pagas: marque "Pago" nas que já saíram. Elas ficam fora do saldo previsto.' },
      T.nVencidos ? `Vencidos sem baixa: ${fmt.brl0(T.vencidos)} (${fmt.int(T.nVencidos)} ${T.nVencidos === 1 ? 'conta' : 'contas'}) · ver ›` : 'Vencidos sem baixa: nada nos últimos 15 dias');
    const heroi = TS.heroi([
      { rot: `Saldo previsto em ${dm(maisDias(R.hoje, dias - 1))}`, num: saldoFim == null ? '—' : fmt.brl0(saldoFim), estado: saldoFim == null ? null : saldoFim < 0 ? 'ruim' : 'bom',
        linhas: [saldoFim == null ? 'falta a previsão de entrada' : state.apSaldo ? `partindo de ${fmt.brl0(state.apSaldo)} em conta` : 'sem contar o que já há em conta'],
        dica: `Entrada prevista − contas a pagar no período${state.apSaldo ? ` + saldo informado (${fmt.brl0(state.apSaldo)})` : ''}.\n\n${R.entTotal != null ? `${fmt.brl0(R.entTotal)} − ${fmt.brl0(T.aPagar)}${state.apSaldo ? ` + ${fmt.brl0(state.apSaldo)}` : ''} = ${fmt.brl0(saldoFim)}.\n\n` : ''}Não é o lucro: lucro é o Resultado do mês. Aqui é só o dinheiro que entra e sai nas datas. Contas vencidas sem baixa ficam fora desta soma.` },
      { rot: `A pagar · próximos ${dias} dias`, num: fmt.brl0(T.aPagar),
        linhas: [h('span', { class: 'ap-h-pagar' }, `${fmt.int(T.nAPagar)} ${T.nAPagar === 1 ? 'conta' : 'contas'}${T.estimado ? ` · ${fmt.brl0(T.estimado)} com data ou valor estimado` : ''}`), kVenc], dica: dicaPagar },
      { rot: `Entrada prevista · ${dias} dias`, num: R.entTotal == null ? '—' : fmt.brl0(R.entTotal),
        linhas: [R.entTotal == null ? 'sem vendas no mês para prever' : `${fmt.brl0(R.entCartao)} em cartão`], dica: comoEntra },
    ], { titulo: 'Caixa dos próximos dias' });
    heroi.classList.add('ap-heroi');

    // ----- saldo por semana -----
    const tSem = TS.table({ linhaMob: { nome: 'de', val: 'acumulado', valRot: 'acumulado', l2: ['entra', 'sai', 'saldo'] }, // celular em linhas (LMOB-04)
        
      cols: [
        { key: 'de', label: 'Semana', align: 'l', sticky: true, wrap: true, title: 'Semanas de segunda a domingo. A primeira começa hoje e a última acaba no fim do período escolhido.',
          render: (s) => h('span', null, h('b', null, s.de === s.ate ? dm(s.de) : `${dm(s.de)} a ${dm(s.ate)}`), s.falta > 0 ? h('span', null, ' ', h('span', { class: 'badge erro' }, `faltam ${fmt.brl0(s.falta)}`)) : null) },
        { key: 'entra', label: 'Entra', title: 'Entrada prevista na semana: vendas previstas menos a taxa da maquininha, com o cartão caindo no prazo cadastrado.', render: (s) => (s.entra == null ? '—' : fmt.brl0(s.entra)), sortVal: (s) => s.entra ?? -1 },
        { key: 'sai', label: 'Sai', title: 'Contas que vencem na semana e ainda não foram marcadas como pagas.', render: (s) => h('div', null, fmt.brl0(s.sai), h('small', { class: 'muted cv-det' }, `${fmt.int(s.contas)} ${s.contas === 1 ? 'conta' : 'contas'}`)) },
        { key: 'saldo', label: 'Saldo da semana', title: 'Entra − sai, só desta semana.', render: (s) => (s.saldo == null ? '—' : h('span', { class: s.saldo < 0 ? 'neg' : null }, fmt.brl0(s.saldo))), sortVal: (s) => s.saldo ?? -1e12 },
        { key: 'acumulado', label: 'Saldo acumulado', title: 'O saldo informado de hoje (ou zero) mais os saldos das semanas até esta. Vermelho = até esta semana o dinheiro previsto não cobre as contas.',
          render: (s) => (s.acumulado == null ? '—' : h('b', { class: s.acumulado < 0 ? 'neg' : 'pos' }, fmt.brl0(s.acumulado))), sortVal: (s) => s.acumulado ?? -1e12 },
      ],
      rows: R.sems, sortKey: 'de', sortDir: 'asc', cls: 'ap-sem', empty: 'Sem semanas para mostrar.',
    });
    const iSaldo = h('input', { class: 'f-input ap-saldo', type: 'number', step: '0.01', inputmode: 'decimal', value: state.apSaldo || '', placeholder: '0,00', 'aria-label': 'Saldo em conta hoje' });
    TS.aoConfirmar(iSaldo, () => { const v = Math.round((+String(iSaldo.value).replace(',', '.') || 0) * 100) / 100; if (v !== (state.apSaldo || 0)) { state.apSaldo = v; refazer(); } });

    // ----- o que vence -----
    const FIL = { abertos: ['A pagar', (x) => !x.pago && !x.atrasado, 'O que vence de hoje em diante e ainda não foi pago.'], vencidos: ['Vencidos sem baixa', (x) => !x.pago && x.atrasado, 'Venceu nos últimos 15 dias e não foi marcado como pago.'],
      pagos: ['Pagos', (x) => x.pago, 'O que já foi marcado como pago (dá para desfazer).'], todos: ['Todos', () => true, 'Tudo o que vence no período, pago ou não.'] };
    const cont = (k) => R.itens.filter(FIL[k][1]).length;
    const lista = h('div');
    const acao = (x) => {
      const b = h('button', { type: 'button', class: 'btn ap-btn', title: x.pago ? 'Tirar a marca de pago' : 'Marcar esta conta como paga: ela sai do saldo previsto' }, x.pago ? 'Desfazer' : 'Marcar pago');
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await marcar(state.loja, x, !x.pago); refazer(); }
        catch (e) { b.disabled = false; TS.avisarErro(e); }
      });
      return b;
    };
    const pintarLista = () => {
      lista.replaceChildren(TS.table({ linhaMob: { nome: 'nome', val: 'valor', l2: ['vence', 'pago'] }, // celular em linhas (LMOB-04)
        
        cols: [
          { key: 'nome', label: 'Conta', align: 'l', sticky: true, wrap: true, title: 'O que vence e de onde o painel tirou: custo fixo e despesa do mês (cadastro da loja), nota de compra (AppNext), royalties e Simples (as mesmas contas do Resultado).',
            render: (x) => h('span', null, h('b', null, x.nome), ' ', h('span', { class: 'badge cinza', title: ORIGEM[x.origem] ? ORIGEM[x.origem][1] : null }, ORIGEM[x.origem] ? ORIGEM[x.origem][0] : x.origem),
              h('small', { class: 'muted cv-det' }, x.origem === 'nota' ? `entrou em ${dm(x.entrada)} + ${x.prazo} dias de prazo` : x.detalhe || (x.semDia ? 'sem dia cadastrado: fim do mês' : x.origem === 'fixo' ? 'todo mês' : 'só neste mês'))) },
          { key: 'vence', label: 'Vence', align: 'l', title: 'Dia do vencimento. "estimado" = o painel não tem a data exata (nota de compra: entrada + prazo da franquia) ou o valor ainda depende das vendas do mês.',
            render: (x) => h('span', null, h('b', null, dm(x.vence)), x.estimado ? h('span', null, ' ', h('span', { class: 'badge warn' }, 'estimado')) : null) },
          { key: 'valor', label: 'Valor', title: 'Valor da conta. Nota de compra: o total da nota (já com o desconto).', render: (x) => fmt.brl(x.valor) },
          { key: 'pago', label: 'Situação', align: 'l', wrap: true, title: 'Marque "pago" quando a conta sair: ela deixa de pesar no saldo previsto. Fica gravado por loja, com quem marcou.',
            render: (x) => h('div', { class: 'ap-sit' }, x.pago ? h('span', { class: 'badge ok' }, `pago${x.pagoEm ? ' em ' + dm(String(x.pagoEm).slice(0, 10)) : ''}`) : x.atrasado ? h('span', { class: 'badge erro' }, 'venceu') : h('span', { class: 'badge cinza' }, 'a pagar'), acao(x)),
            sortVal: (x) => (x.pago ? 2 : x.atrasado ? 0 : 1) },
        ],
        rows: R.itens.filter(FIL[fil][1]), sortKey: 'vence', sortDir: 'asc', search: 'Buscar conta ou fornecedor…', searchKeys: ['nome'], cls: 'ap-t', maxHeight: '560px', cartao: true,
        empty: fil === 'abertos' ? `Nada a pagar nos próximos ${dias} dias. 👏` : fil === 'vencidos' ? 'Nada vencido sem baixa. 👏' : fil === 'pagos' ? 'Nenhuma conta marcada como paga neste período.' : 'Nada vence neste período.',
      }));
    };
    const seg = TS.seg(Object.entries(FIL).map(([k, [t, , d]]) => [`${t} (${cont(k)})`, k, d]), fil, (k) => { fil = state.apFil = k; pintarLista(); });
    const irVenc = (ev) => { if (ev.target.closest('.dica-i')) return; fil = state.apFil = 'vencidos'; TS.segMarcar(seg, 'vencidos'); pintarLista(); lista.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
    kVenc.addEventListener('click', irVenc);
    pintarLista();

    corpo.replaceChildren(...[
      h('div', { class: 'dre-topo ap-topo' },
        TS.seg([['Próximos 30 dias', 30, 'O que vence e o que deve entrar nos próximos 30 dias.'], ['Próximos 60 dias', 60, 'O mesmo calendário, olhando 60 dias à frente (a previsão de entrada fica menos precisa).']], dias, (v) => { state.apDias = v; refazer(); }),
        h('label', null, 'Saldo em conta hoje ', TS.dica('Opcional. Informe quanto há na conta hoje para o saldo acumulado partir dele. Não fica gravado: vale enquanto o painel estiver aberto.'), iSaldo)),
      ...avisos,
      heroi,
      h('p', { class: 'dre-andamento muted' }, NAO_E, TS.dica(`${NAO_E}\n\nO lucro do mês está na aba "Resultado do mês"; aqui é o dinheiro nas datas ("lucro no papel não paga boleto").\n\nNota de compra: o AppNext não informa a condição de pagamento, então o vencimento é o dia de entrada + ${cfg.prazoNotasDias} dias${cfg.prazoNotasInformado ? '' : ' (prazo padrão do painel: cadastre o prazo da franquia)'}.\n\nRoyalties + marketing: dia ${cfg.royaltiesDia} do mês seguinte. Simples: dia 20 do mês seguinte.\n\nCusto fixo sem dia cadastrado vence no último dia do mês.`)),
      h('div', { class: 'mt ap-semanas' }, TS.card('Saldo previsto por semana', 'O que deve entrar menos o que vence em cada semana.', tSem)),
      h('div', { class: 'mt ap-vence' }, TS.cardWithTools('O que vence', `Custos fixos, despesas do mês, notas de compra (vencimento estimado: entrada + ${cfg.prazoNotasDias} dias), royalties e Simples.`, seg, lista,
        podeCfg ? h('div', { class: 'dre-links' }, ajustar('Ajustar dias de vencimento, prazo das notas e do cartão'), h('a', { href: '#config', onclick: (e) => { e.preventDefault(); TS.editarCustos(state.loja, 'cfg-pontuais'); } }, '+ Despesa de um mês só')) : null)),
    ].filter(Boolean));
  }

  /** Resultado: botão "Exportar para o contador" do mês fechado (planilha .xlsx montada no servidor) */
  function botaoExportar(m, linhas, cats, vgrupos) {
    const fechado = !m.parcial;
    const b = h('button', { type: 'button', class: 'btn ap-exportar', disabled: fechado ? null : true,
      title: fechado ? `Baixa uma planilha de ${TS.ymLabel(m.ym)} com as abas: Resumo do mês, Vendas por dia, Notas de entrada, Notas de saída (NF-e) e Despesas.` : 'Só para mês fechado: escolha um mês que já terminou.' }, 'Exportar para o contador');
    b.addEventListener('click', async () => {
      const txt = b.textContent;
      b.disabled = true; b.textContent = 'Montando a planilha…';
      try {
        const nomeCat = new Map((cats || []).map((c) => [c.id, c.nome]));
        const corpo = { loja: state.loja, ym: m.ym,
          resumo: linhas.map(([rot, f, tipo]) => { const v = f(m); return { rot: tipo === 'grupo' ? rot.replace(/^− /, '− Custos fixos · ') : rot, valor: v == null ? null : Math.round(v * 100) / 100, pct: v == null || !m.fat ? null : Math.round((v / m.fat) * 10000) / 10000, tipo }; }),
          // as que acompanham as vendas, com a categoria escolhida (DESP-CAT-01), e os custos fixos
          despesas: [...(vgrupos || []).flatMap((g) => g.itens.map((x) => ({ nome: x.nome, cat: g.nome, tipo: 'vendas', valor: Math.round((x.f(m) || 0) * 100) / 100 }))).filter((x) => x.valor),
            ...m.fixosMes.map((x) => ({ nome: x.nome, cat: nomeCat.get(x.cat) || 'Outros', tipo: x.pontual ? 'pontual' : x.lancado ? 'real' : 'fixa', valor: x.valor }))] };
        const r = await fetch(TS.api('resultado/exportar'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify(corpo) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.erro || 'Não deu para montar a planilha.'); }
        const blob = await r.blob();
        const a = h('a', { href: URL.createObjectURL(blob), download: `contador-${state.loja}-${m.ym}.xlsx` });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        b.dataset.baixou = m.ym;
      } catch (e) { TS.avisarErro(e); }
      b.disabled = false; b.textContent = txt;
    });
    return b;
  }

  TS.aPagar = { ...API, pagina, montar, botaoExportar };
})();
