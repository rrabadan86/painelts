/* Pedido sugerido (aba Pedido): quanto pedir à franqueadora e o quê, e o robô que monta o carrinho no Sistema de Pedidos.
 * Reposição: valor = % do faturamento da loja (sem Espaço Gourmet) nos últimos N dias (padrão: o CMV real dos 3 últimos
 * meses fechados). Compra só o que precisa (previsão × (entrega + N dias) − estoque), dividido entre chás a granel,
 * envasados e acessórios na proporção das vendas, priorizando quem deixa mais lucro sem fixos por dia.
 * Data comemorativa: o que vendeu no mesmo período do ano passado × crescimento da loja, + o consumo até lá − estoque.
 * Só admin e franqueado; o robô (carrinho e catálogo) só o admin. */
(function () {
  const { h, fmt, state } = TS;
  const DIA = 86400e3;
  const GRUPOS = { cha: 'Chás a granel', env: 'Envasados', acess: 'Acessórios', insumo: 'Embalagens e insumos' };
  const ordemG = ['cha', 'env', 'acess', 'insumo'];
  const qtdPorLoja = new Map(); // loja|modo → Map(cod → quantidade editada)
  let poll = null;

  async function buscar(loja) {
    const r = await fetch(TS.api(`pedido?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha ao ler o pedido.');
    return j;
  }

  const unid = (it) => (it.un === 'Kg' ? 'kg' : (it.un || 'un').toLowerCase());
  const qtdTxt = (v, it) => (v == null ? '—' : it.un === 'Kg' ? `${fmt.kg(v)} kg` : `${fmt.int(v)} ${unid(it)}`);
  const segundoDomingoMaio = (ano) => { const d = new Date(Date.UTC(ano, 4, 1)); const dom = (7 - d.getUTCDay()) % 7; return Math.floor(d.getTime() / DIA) + dom + 7; };
  const diaDe = (ano, mmdd) => TS.isoToDay(`${ano}-${mmdd}`);

  /** janela de um evento num ano: [d0, d1] em dias */
  function janela(ev, ano) {
    if (ev.regra === 'maes') { const d = segundoDomingoMaio(ano); return [d - ev.diasAntes, d]; }
    const d0 = diaDe(ano, ev.de); let d1 = diaDe(ano, ev.ate);
    if (d1 < d0) d1 = diaDe(ano + 1, ev.ate);
    return [d0, d1];
  }
  /** a próxima ocorrência (a que ainda não terminou) e a do ano anterior */
  function proximo(ev, hoje) {
    const ano = +TS.dayToIso(hoje).slice(0, 4);
    let j = janela(ev, ano), a = ano;
    if (j[1] < hoje) { a = ano + 1; j = janela(ev, a); }
    return { atual: j, anterior: janela(ev, a - 1), ano: a };
  }

  /** o cálculo: tudo que a tela mostra */
  function calcular(M, estoque, ecfg, catalogo, pcfg, modo, ev, editados) {
    const db = TS.db, I = TS.rules.ids;
    const fim = db.maxDay, hoje = fim + 1;
    const N = pcfg.dias, ent = ecfg.entregaDias;
    const DD = M.ded;
    const catPorCod = new Map(((catalogo && catalogo.itens) || []).map((c) => [String(c.cod), c]));
    const catTxt = db.D.cat;
    const ehLoja = (i) => !I.eg.has(db.cat[i]) && !M.taxa(i);
    const grupoLinha = (i, c) => (c && c.kg ? 'cha' : /envasad|sach/i.test(catTxt[db.cat[i]] || '') ? 'env' : I.chaTotal.has(db.grupo[i]) ? 'cha' : 'acess');

    // CMV real: custo ÷ faturamento (só loja, só o que tem custo) nos 3 últimos meses fechados
    const ymAtual = TS.dayToIso(fim).slice(0, 7);
    const meses = new Set();
    { let d = new Date(ymAtual + '-01T12:00:00Z'); for (let k = 0; k < 3; k++) { d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)); meses.add(d.toISOString().slice(0, 7)); } }
    const ymDe = (i) => db.ym[i];

    // ano passado, para a época do ano (reposição) e para o evento
    let lyB0 = fim - 364 - 29, lyB1 = fim - 364, lyN0 = fim - 363, lyN1 = fim - 364 + ent + N;
    let ev0 = null, ev1 = null, evLy0 = null, evLy1 = null, evInfo = null;
    if (modo === 'evento' && ev) {
      evInfo = proximo(ev, hoje);
      [ev0, ev1] = evInfo.atual; [evLy0, evLy1] = evInfo.anterior;
    }
    const temAnoPassado = db.minDay <= lyB0;
    const d30 = fim - 29, dN = fim - N + 1, d90 = fim - 89;
    const cons = new Map(), lyB = new Map(), lyN = new Map(), lyDias = new Map(), lyEv = new Map();
    const tot = { kg: { b: 0, n: 0 }, un: { b: 0, n: 0 } };
    const contrib = new Map(), vendaItem = new Map(), grupoVt = new Map();
    const fatG = { cha: 0, env: 0, acess: 0 };
    let vendasN = 0, cmvVt = 0, cmvCusto = 0, cresA = 0, cresB = 0, evLyVt = 0;
    const lim0 = Math.min(lyB0, evLy0 ?? Infinity, d90 - 365);
    for (let i = 0; i < db.n; i++) {
      const d = db.day[i];
      if (d < lim0) continue;
      const loja = ehLoja(i), vt = db.vt[i] || 0;
      const c = M.casar(i);
      if (loja) {
        if (d >= dN) { vendasN += vt; fatG[grupoLinha(i, c)] += vt; }
        if (d >= d90) cresA += vt; else if (d >= d90 - 364 && d <= fim - 364) cresB += vt;
        if (evLy0 != null && d >= evLy0 && d <= evLy1) evLyVt += vt;
        if (meses.has(ymDe(i))) { const cu = M.custo(i); if (cu != null) { cmvVt += vt; cmvCusto += cu; } }
      }
      const cs = M.consumo(i);
      cs.forEach(([it, q], k) => {
        const cod = it.cod;
        if (d >= d30) cons.set(cod, (cons.get(cod) || 0) + q);
        const g = it.un === 'Kg' ? tot.kg : tot.un;
        if (d >= lyB0 && d <= lyB1) { lyB.set(cod, (lyB.get(cod) || 0) + q); g.b += q; (lyDias.get(cod) || lyDias.set(cod, new Set()).get(cod)).add(d); }
        else if (d >= lyN0 && d <= lyN1) { lyN.set(cod, (lyN.get(cod) || 0) + q); g.n += q; }
        if (evLy0 != null && d >= evLy0 && d <= evLy1) lyEv.set(cod, (lyEv.get(cod) || 0) + q);
        // grupo do item: pelo que ele é na venda (o principal); saco e etiqueta dos chás = embalagem
        if (d >= d90 && loja) {
          const gm = grupoVt.get(cod) || grupoVt.set(cod, { cha: 0, env: 0, acess: 0, insumo: 0 }).get(cod);
          if (k === 0) gm[grupoLinha(i, c)] += vt || 0.001; else gm.insumo += 0.001;
        }
      });
      // lucro sem fixos por item (o principal da linha), últimos 30 dias, só loja
      if (loja && d >= d30 && cs.length) {
        const cu = M.custo(i);
        if (cu != null) {
          const dv = DD ? DD.deducoes(i).var : 0;
          const cod = cs[0][0].cod;
          contrib.set(cod, (contrib.get(cod) || 0) + vt - cu - dv);
          vendaItem.set(cod, (vendaItem.get(cod) || 0) + vt);
        }
      }
    }
    const cmvReal = cmvVt > 0 ? cmvCusto / cmvVt : null;
    const pct = pcfg.cmvPct != null ? pcfg.cmvPct / 100 : cmvReal;
    const orcamento = modo === 'evento' ? null : pct != null ? vendasN * pct : null;
    const crescLoja = cresB > 0 ? Math.min(2, Math.max(0.5, cresA / cresB)) : 1;
    const cresc = pcfg.crescimentoPct != null ? 1 + pcfg.crescimentoPct / 100 : crescLoja;

    const lim = (f) => Math.min(3, Math.max(0.4, f));
    const H = ent + N;
    const fatLoja = (g) => (temAnoPassado && g.b > 0 && g.n > 0 ? lim((g.n / H) / (g.b / 30)) : 1);
    const FL = { kg: fatLoja(tot.kg), un: fatLoja(tot.un) };
    const sazonal = (it) => {
      if (!temAnoPassado) return 1;
      const b = lyB.get(it.cod) || 0, n = lyN.get(it.cod) || 0, dias = (lyDias.get(it.cod) || new Set()).size;
      return dias >= 6 && b > 0 ? lim((n / H) / (b / 30)) : FL[it.un === 'Kg' ? 'kg' : 'un'];
    };
    const grupoDe = (cod) => { const g = grupoVt.get(cod); if (!g) return null; return ordemG.reduce((a, k) => (g[k] > (g[a] || 0) ? k : a), 'insumo'); };
    const arred = (q, c, it) => {
      const mult = (c && c.mult) || (it.un === 'Kg' ? 0.1 : 1);
      let x = Math.ceil(q / mult - 1e-9) * mult;
      if (c && c.min && x > 0 && x < c.min) x = Math.ceil(c.min / mult - 1e-9) * mult;
      if (c && c.max && x > c.max) x = Math.floor(c.max / mult + 1e-9) * mult;
      return Math.round(x * 1000) / 1000;
    };

    const linhas = [];
    for (const it of estoque.itens) {
      const vel = (cons.get(it.cod) || 0) / 30;
      const prev = vel * (modo === 'evento' ? 1 : sazonal(it));
      const qtd = Math.max(0, it.qtd || 0);
      let precisa, conta;
      if (modo === 'evento') {
        const ly = lyEv.get(it.cod) || 0;
        if (!(ly > 0)) continue;
        // consumo normal até começar: no máximo entrega + intervalo de pedidos (o resto as reposições normais cobrem)
        const ate = Math.min(Math.max(0, ev0 - hoje), ent + N);
        const noEvento = ly * cresc, antes = prev * ate;
        precisa = noEvento + antes - qtd;
        conta = `No ${ev.nome} do ano passado: ${qtdTxt(ly, it)} × crescimento ${fmt.n2(cresc)} = ${qtdTxt(noEvento, it)}. Consumo normal até lá (${fmt.int(ate)} dias × ${qtdTxt(prev, it)}/dia) = ${qtdTxt(antes, it)}. Menos o estoque de ${qtdTxt(qtd, it)}.`;
      } else {
        if (!(prev > 0) && !(it.min && qtd < it.min)) continue;
        precisa = Math.max(prev * H - qtd, (it.min || 0) - qtd);
        conta = `Previsão ${qtdTxt(prev, it)}/dia × (${ent} dias de entrega + ${N} dias até o próximo pedido) = ${qtdTxt(prev * H, it)} − estoque ${qtdTxt(qtd, it)}${it.min && it.min - qtd > prev * H - qtd ? ` · o mínimo do AppNext pede ${qtdTxt(it.min - qtd, it)}` : ''}.`;
      }
      if (!(precisa > 0)) continue;
      const c = catPorCod.get(String(it.cod));
      const g = grupoDe(it.cod) || (it.un === 'Kg' ? 'cha' : 'acess');
      const preco = c && c.disp ? c.preco : (it.custo || null);
      const dias = prev > 0 ? qtd / prev : null;
      const urgente = qtd <= 0 || (dias != null && dias < ent);
      const lucroDia = (contrib.get(it.cod) || 0) / 30;
      const sugerido = arred(precisa, c, it);
      const site = !catalogo ? 'sem' : !c ? 'fora' : !c.disp ? 'indisp' : 'ok';
      const unidadeEstranha = c && c.disp && it.custo > 0 && (c.preco / it.custo > 4 || c.preco / it.custo < 0.25);
      linhas.push({ cod: it.cod, produto: it.desc, it, c, grupo: g, grupoTxt: GRUPOS[g], qtd, prev, dias, urgente, precisa, sugerido, conta, preco, lucroDia, site, unidadeEstranha,
        margem: vendaItem.get(it.cod) ? (contrib.get(it.cod) || 0) / vendaItem.get(it.cod) : null, pedir: 0, motivo: '' });
    }

    // ---------- distribuição do valor ----------
    const compraveis = linhas.filter((r) => r.site === 'ok' || r.site === 'sem');
    const prioridade = (a, b) => (b.urgente - a.urgente) || (b.lucroDia - a.lucroDia) || (b.prev * (b.preco || 0) - a.prev * (a.preco || 0));
    const fatSoma = fatG.cha + fatG.env + fatG.acess;
    const share = { cha: fatSoma ? fatG.cha / fatSoma : 0, env: fatSoma ? fatG.env / fatSoma : 0, acess: fatSoma ? fatG.acess / fatSoma : 0 };
    const custoDe = (r, q) => q * (r.preco || 0);
    if (orcamento == null) {
      for (const r of compraveis) { r.pedir = r.sugerido; r.motivo = 'completo'; }
    } else {
      // embalagens e insumos acompanham os chás: entram primeiro, fora da proporção
      let gasto = 0;
      for (const r of compraveis.filter((x) => x.grupo === 'insumo')) { r.pedir = r.sugerido; r.motivo = 'completo'; gasto += custoDe(r, r.pedir); }
      const resto = Math.max(0, orcamento - gasto);
      const alvo = { cha: resto * share.cha, env: resto * share.env, acess: resto * share.acess };
      const folga = 1 + pcfg.folgaPct / 100;
      const usado = { cha: 0, env: 0, acess: 0 };
      const mult = (r) => (r.c && r.c.mult) || (r.it.un === 'Kg' ? 0.1 : 1);
      const encaixar = (r, cabe) => {
        const falta = r.sugerido - r.pedir;
        if (falta <= 0 || !(r.preco > 0)) return 0;
        if (custoDe(r, falta) <= cabe + 0.005) { r.pedir = r.sugerido; return custoDe(r, falta); }
        const m = mult(r), q = Math.floor(cabe / (m * r.preco) + 1e-9) * m;
        if (q <= 0) return 0;
        if (r.c && r.c.min && r.pedir + q < r.c.min) return 0;
        r.pedir = Math.round((r.pedir + q) * 1000) / 1000;
        return custoDe(r, q);
      };
      // 1ª passada: cada grupo até a sua parte (com a folga)
      for (const g of ['cha', 'env', 'acess']) {
        for (const r of compraveis.filter((x) => x.grupo === g).sort(prioridade)) {
          const cabe = Math.min(alvo[g] * folga - usado[g], resto - usado.cha - usado.env - usado.acess);
          if (cabe <= 0) break;
          usado[g] += encaixar(r, cabe);
        }
      }
      // 2ª passada: o que sobrou do valor vai para quem ainda precisa, na mesma prioridade
      for (const r of compraveis.filter((x) => x.grupo !== 'insumo').sort(prioridade)) {
        const cabe = resto - usado.cha - usado.env - usado.acess;
        if (cabe <= 0.5) break;
        usado[r.grupo] += encaixar(r, cabe);
      }
      for (const r of compraveis) r.motivo = r.pedir >= r.sugerido ? 'completo' : r.pedir > 0 ? 'parcial' : 'fora do valor';
    }
    for (const r of linhas) {
      r.sugeridoPedir = r.pedir;
      if (editados && editados.has(String(r.cod)) && (r.site === 'ok' || r.site === 'sem')) r.pedir = editados.get(String(r.cod));
    }
    return { linhas, vendasN, cmvReal, pct, orcamento, share, fatG, crescLoja, cresc, evInfo, ev, evLyVt, temAnoPassado, N, ent, hoje };
  }

  // ---------- tela ----------
  TS.pages.pedido = function (root) {
    if (poll) { clearTimeout(poll); poll = null; }
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Pedido'),
      h('div', { class: 'page-sub' }, 'Pedido sugerido para a franqueadora e o robô que monta o carrinho no Sistema de Pedidos'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'O pedido é de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Montando o pedido…'))));
    root.append(corpo);
    const loja = state.loja;
    Promise.all([TS.estoqueBuscar(loja), buscar(loja), TS.custosLoja()]).then(([e, p, M]) => {
      if (!corpo.isConnected) return;
      if (!e.estoque || !e.estoque.itens || !e.estoque.itens.length || !M) {
        corpo.replaceChildren(h('div', { class: 'notice' }, 'Ainda não há estoque desta loja no painel. O pedido usa o estoque e o custo do AppNext: veja a aba Estoque e margem.'));
        return;
      }
      pintar(corpo, loja, M, e, p);
    }).catch((err) => corpo.replaceChildren(h('div', { class: 'notice err' }, err.message)));
  };

  function pintar(corpo, loja, M, e, p) {
    corpo.replaceChildren();
    const modo = state.pedModo || 'repor';
    const eventos = p.cfg.eventos || [];
    const ev = modo === 'evento' ? (eventos.find((x) => x.id === state.pedEvento) || eventos[0]) : null;
    // parâmetros desta tela (começam pelos salvos; só valem para a loja depois de "Salvar")
    const par = state.pedPar && state.pedPar.loja === loja ? state.pedPar : (state.pedPar = { loja, ...p.cfg });
    const chave = `${loja}|${modo}|${ev ? ev.id : ''}`;
    const editados = qtdPorLoja.get(chave) || qtdPorLoja.set(chave, new Map()).get(chave);
    const R = calcular(M, e.estoque, e.cfg, p.catalogo, par, modo, ev, editados);

    // ---------- controles ----------
    const num = (v, attrs) => h('input', { class: 'f-input', type: 'number', value: v ?? '', style: { maxWidth: '96px' }, ...attrs });
    const iPct = num(par.cmvPct, { min: 1, max: 90, step: '0.5', placeholder: R.cmvReal != null ? fmt.n1(R.cmvReal * 100) : '' });
    const iDias = num(par.dias, { min: 3, max: 60 });
    const iFolga = num(par.folgaPct, { min: 0, max: 100 });
    const iCresc = num(par.crescimentoPct, { min: -80, max: 300, placeholder: fmt.n1((R.crescLoja - 1) * 100) });
    const aplicar = () => {
      const v = (i) => (i.value === '' ? null : +i.value);
      Object.assign(par, { cmvPct: v(iPct), dias: Math.max(3, Math.min(60, Math.round(+iDias.value || p.cfg.dias))), folgaPct: v(iFolga) ?? 10, crescimentoPct: v(iCresc) });
      editados.clear();
      pintar(corpo, loja, M, e, p);
    };
    [iPct, iDias, iFolga, iCresc].forEach((i) => i.addEventListener('change', aplicar));
    const msg = h('span', { class: 'muted' });
    const salvar = h('button', { type: 'button', class: 'btn' }, 'Salvar como padrão da loja');
    salvar.addEventListener('click', async () => {
      salvar.disabled = true; msg.className = 'muted'; msg.textContent = 'Salvando…';
      try {
        const r = await fetch(`/api/pedido/cfg?loja=${encodeURIComponent(loja)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmvPct: par.cmvPct, dias: par.dias, folgaPct: par.folgaPct, crescimentoPct: par.crescimentoPct, eventos }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
        p.cfg = j.cfg; msg.className = 'pos'; msg.textContent = 'Salvo.';
      } catch (err) { msg.className = 'neg'; msg.textContent = err.message; }
      salvar.disabled = false;
    });
    const lbl = (t, el, suf, dica) => h('label', { title: dica || null }, h('span', null, t), h('div', null, el, suf ? ' ' + suf : ''));
    const controles = h('div', { class: 'card ped-ctl' },
      h('div', { class: 'ped-ctl-l' },
        TS.seg([['Reposição', 'repor'], ['Data comemorativa', 'evento']], modo, (v) => { state.pedModo = v; pintar(corpo, loja, M, e, p); }),
        modo === 'evento' ? h('select', { class: 'f-input', onchange: (x) => { state.pedEvento = x.target.value; pintar(corpo, loja, M, e, p); } },
          eventos.map((x) => h('option', { value: x.id, selected: ev && x.id === ev.id || null }, x.nome))) : null),
      h('div', { class: 'est-cfg-g ped-ctl-g' },
        modo === 'repor' ? lbl('Valor do pedido', iPct, '% das vendas', `Percentual do faturamento da loja (sem Espaço Gourmet) que vira pedido. Vazio = CMV real dos 3 últimos meses fechados (${fmt.pct(R.cmvReal)}): o custo do que foi vendido, ou seja, repor o que saiu.`) : null,
        modo === 'repor' ? lbl('Vendas de', iDias, 'dias', 'Período de vendas usado no valor e intervalo até o próximo pedido (ex.: 7 para pedido semanal, 14 para quinzenal).') : null,
        modo === 'repor' ? lbl('Folga da proporção', iFolga, '%', 'Quanto cada grupo (chás, envasados, acessórios) pode passar da sua parte antes de o valor ir para os outros.') : null,
        modo === 'evento' ? lbl('Crescimento', iCresc, '%', `Quanto a mais (ou a menos) que no ano passado. Vazio = o da loja: últimos 90 dias contra os mesmos 90 do ano anterior (${fmt.pct(R.crescLoja - 1)}).`) : null),
      h('div', { class: 'cfg-acoes' }, salvar, msg));
    corpo.append(controles);
    if (modo === 'evento') corpo.append(editorEventos(loja, p, par, () => pintar(corpo, loja, M, e, p)));

    if (modo === 'evento' && !ev) { corpo.append(h('div', { class: 'notice' }, 'Nenhuma data comemorativa cadastrada.')); return; }
    if (modo === 'evento' && !R.evLyVt) {
      corpo.append(h('div', { class: 'notice' }, `Não há vendas no painel em ${fmt.date(TS.dayToIso(R.evInfo.anterior[0]))} a ${fmt.date(TS.dayToIso(R.evInfo.anterior[1]))} (o ${ev.nome} do ano passado). Sem essa base não dá para prever.`));
      return;
    }

    // ---------- KPIs ----------
    const noPedido = R.linhas.filter((r) => r.pedir > 0);
    const total = () => R.linhas.reduce((s, r) => s + r.pedir * (r.preco || 0), 0);
    const necessidade = R.linhas.filter((r) => r.site === 'ok' || r.site === 'sem').reduce((s, r) => s + r.sugerido * (r.preco || 0), 0);
    const kTotal = h('div', { class: 'kpi-value' }, fmt.brl0(total()));
    const kTotalFoot = h('div', { class: 'kpi-foot' });
    const pintarTotal = () => {
      const t = total(), n = R.linhas.filter((r) => r.pedir > 0).length;
      kTotal.textContent = fmt.brl0(t);
      kTotalFoot.replaceChildren(`${fmt.int(n)} ${n === 1 ? 'produto' : 'produtos'}`, R.orcamento ? h('span', { class: t > R.orcamento * 1.02 ? 'down' : '' }, ` · ${fmt.pct(t / R.orcamento, 0)} do valor`) : '');
      mix && pintarMix();
    };
    const kpis = [];
    if (modo === 'repor') {
      kpis.push(TS.kpi(`Vendas da loja · ${R.N} dias`, fmt.brl0(R.vendasN), `até ${fmt.date(TS.dayToIso(R.hoje - 1))} · sem Espaço Gourmet`));
      kpis.push(TS.kpi('Valor para o pedido', fmt.brl0(R.orcamento), `${fmt.pct(R.pct)} das vendas${par.cmvPct == null ? ' (CMV real)' : ` · CMV real ${fmt.pct(R.cmvReal)}`}`,
        `CMV real = custo dos produtos vendidos ÷ faturamento, só loja, nos 3 últimos meses fechados: ${fmt.pct(R.cmvReal)}.`));
    } else {
      const [a0, a1] = R.evInfo.atual, [l0, l1] = R.evInfo.anterior;
      const ate = a0 - R.hoje;
      kpis.push(TS.kpi(R.ev.nome, `${fmt.date(TS.dayToIso(a0)).slice(0, 5)} a ${fmt.date(TS.dayToIso(a1)).slice(0, 5)}`, ate > 0 ? `começa em ${fmt.int(ate)} dias · peça até ${fmt.date(TS.dayToIso(a0 - R.ent)).slice(0, 5)}` : 'em andamento',
        `Para chegar a tempo, peça até ${R.ent} dias (a entrega) antes de começar.`));
      kpis.push(TS.kpi('Vendas no ano passado', fmt.brl0(R.evLyVt), `${fmt.date(TS.dayToIso(l0))} a ${fmt.date(TS.dayToIso(l1))} · previsão ${fmt.brl0(R.evLyVt * R.cresc)}`, `Só loja (sem Espaço Gourmet). Previsão = ano passado × crescimento ${fmt.n2(R.cresc)}.`));
    }
    const kT = h('div', { class: 'card kpi' }, h('div', { class: 'kpi-label' }, 'Pedido sugerido'), kTotal, kTotalFoot);
    kpis.push(kT);
    if (modo === 'repor') kpis.push(TS.kpi('Tudo que precisa', fmt.brl0(necessidade), 'sem limite de valor', 'Custo de comprar toda a necessidade dos produtos disponíveis, sem o limite do valor do pedido.'));
    else {
      // referência: o CMV sobre o que a loja deve vender até o fim da data (ritmo de agora até começar + previsão da data)
      const ate = Math.min(Math.max(0, R.evInfo.atual[0] - R.hoje), R.ent + R.N);
      const prevVendas = (R.vendasN / R.N) * ate + R.evLyVt * R.cresc;
      kpis.push(TS.kpi('Referência pelo CMV', R.pct != null ? fmt.brl0(prevVendas * R.pct) : '—', `${fmt.pct(R.pct)} de ${fmt.brl0(prevVendas)} previstos até o fim`,
        `Vendas previstas: ritmo dos últimos ${R.N} dias × ${fmt.int(ate)} dias até começar + ${R.ev.nome} do ano passado × ${fmt.n2(R.cresc)}. Se o pedido sugerido passar muito disso, há estoque sobrando ou produtos de giro alto; confira as quantidades.`));
    }
    corpo.append(h('div', { class: 'grid g-kpi mt' }, kpis));
    if (modo === 'evento' && R.evInfo.atual[0] - R.hoje > R.ent + R.N) corpo.append(h('div', { class: 'notice mt' }, `Faltam ${fmt.int(R.evInfo.atual[0] - R.hoje)} dias para o ${R.ev.nome}: isto é uma prévia. O consumo normal até lá foi limitado a ${R.ent + R.N} dias (entrega + intervalo de pedidos), porque as reposições normais cobrem o resto. Refaça perto da data, com o estoque de então.`));
    if (modo === 'evento' && R.evInfo.atual[0] - R.hoje < R.ent) corpo.append(h('div', { class: 'notice warn mt' }, `A entrega leva ${R.ent} dias e o ${R.ev.nome} começa antes disso: o pedido pode chegar atrasado.`));

    // ---------- proporção ----------
    let mix = null;
    const pintarMix = () => {
      const gasto = { cha: 0, env: 0, acess: 0 };
      for (const r of R.linhas) if (r.pedir > 0 && gasto[r.grupo] != null) gasto[r.grupo] += r.pedir * (r.preco || 0);
      const soma = gasto.cha + gasto.env + gasto.acess;
      mix.replaceChildren(...['cha', 'env', 'acess'].map((g) => h('div', { class: 'ped-mix-i' },
        h('div', { class: 'ped-mix-t' }, GRUPOS[g]),
        h('div', { class: 'ped-mix-b' }, h('span', { class: 'ped-mix-alvo', style: { width: `${Math.round((R.share[g] || 0) * 100)}%` } }), h('span', { class: 'ped-mix-ped', style: { width: `${soma ? Math.round((gasto[g] / soma) * 100) : 0}%` } })),
        h('div', { class: 'ped-mix-n' }, `vendas ${fmt.pct(R.share[g], 0)} · pedido ${soma ? fmt.pct(gasto[g] / soma, 0) : '—'} (${fmt.brl0(gasto[g])})`))));
    };
    if (modo === 'repor') {
      mix = h('div', { class: 'ped-mix' });
      pintarMix();
      corpo.append(h('div', { class: 'mt' }, TS.card('Proporção do pedido', `Parte de cada grupo nas vendas dos últimos ${R.N} dias (cinza) e no pedido (verde). Embalagens e insumos (saco kraft, etiquetas) entram antes, fora da proporção.`, mix)));
    }
    pintarTotal();

    // ---------- tabela ----------
    const filtro = state.pedFiltro || 'pedido';
    const FILTROS = {
      pedido: ['No pedido', (r) => r.pedir > 0],
      fora: ['Ficou de fora', (r) => !(r.pedir > 0) && (r.site === 'ok' || r.site === 'sem')],
      indisp: ['Indisponível no site', (r) => r.site === 'indisp'],
      cat: ['Fora do catálogo', (r) => r.site === 'fora'],
    };
    const cont = (k) => R.linhas.filter(FILTROS[k][1]).length;
    const linhas = R.linhas.filter(FILTROS[filtro][1]);
    const SITU = (r) => (r.qtd <= 0 ? ['Acabou', 'erro'] : r.urgente ? ['Falta antes da entrega', 'erro'] : r.dias != null && r.dias < R.ent + R.N ? ['Pedir', 'warn'] : ['OK', 'ok']);
    const tab = TS.table({
      cols: [
        { key: 'produto', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => h('span', null, r.produto, h('small', { class: 'est-tam' }, `cód. ${r.cod}`)) },
        { key: 'grupoTxt', label: 'Grupo', align: 'l' },
        { key: 'sit', label: 'Situação', align: 'l', render: (r) => { const [t, c] = SITU(r); return h('span', { class: 'badge ' + c }, t); }, sortVal: (r) => (r.qtd <= 0 ? 3 : r.urgente ? 2 : 1) },
        { key: 'qtd', label: 'Estoque', render: (r) => qtdTxt(r.qtd, r.it) },
        { key: 'dias', label: 'Dura', fmt: (v) => (v == null ? '—' : v > 365 ? '+1 ano' : `${fmt.int(v)} dias`) },
        { key: 'sugerido', label: 'Precisa', title: 'Quanto precisa (arredondado ao múltiplo do site). Passe o mouse para ver a conta', render: (r) => h('span', { class: 'est-dica', title: r.conta }, qtdTxt(r.sugerido, r.it)) },
        { key: 'pedir', label: 'Pedir', title: 'Quantidade do pedido: altere à vontade (0 tira do pedido). O total e a proporção se atualizam', render: (r) => campoQtd(r), sortVal: (r) => r.pedir },
        { key: 'preco', label: 'Preço', title: 'Preço no Sistema de Pedidos (FRANQUIAS); sem catálogo, o custo do AppNext', render: (r) => (r.preco ? h('span', { class: r.unidadeEstranha ? 'neg' : null, title: r.unidadeEstranha ? `Preço do site muito diferente do custo do AppNext (${fmt.brl(r.it.custo)}): confira a unidade.` : null }, fmt.brl(r.preco), r.c && r.c.mult && r.c.mult !== 1 ? h('small', { class: 'est-tam' }, `múltiplo de ${fmt.n2(r.c.mult)}`) : null) : '—'), sortVal: (r) => r.preco },
        { key: 'total', label: 'Total', render: (r) => { const s = h('span', { class: 'ped-tot' }, r.pedir > 0 ? fmt.brl(r.pedir * (r.preco || 0)) : '—'); r._tot = s; return s; }, sortVal: (r) => r.pedir * (r.preco || 0) },
        { key: 'lucroDia', label: 'Lucro sem fixos/dia', title: 'O que o produto deixou por dia nos últimos 30 dias depois do custo e das deduções variáveis (comissão, royalties, Simples, maquininha). É a prioridade do pedido: urgentes primeiro, depois quem deixa mais lucro', fmt: (v) => (v ? fmt.brl(v) : '—') },
        { key: 'motivo', label: 'Obs.', align: 'l', render: (r) => obs(r) },
      ],
      rows: linhas, sortKey: filtro === 'pedido' ? 'lucroDia' : 'lucroDia', maxHeight: '620px', search: 'Buscar produto…', searchKeys: ['produto', 'cod'], cls: 'est-t ped-t',
      empty: { pedido: 'Nada no pedido.', fora: 'Nada ficou de fora.', indisp: 'Nenhum produto necessário está indisponível no site.', cat: 'Todos os produtos necessários estão no catálogo.' }[filtro],
    });
    function obs(r) {
      if (r.site === 'indisp') return h('span', { class: 'neg' }, 'indisponível no site (R$ 0,01)');
      if (r.site === 'fora') return h('span', { class: 'muted' }, 'não está no catálogo FRANQUIAS');
      if (r.pedir !== r.sugeridoPedir) return h('span', { class: 'muted' }, `alterado (sugestão ${qtdTxt(r.sugeridoPedir, r.it)})`);
      return h('span', { class: r.motivo === 'completo' ? 'muted' : 'warn-t' }, { completo: 'completo', parcial: 'parte (o valor acabou)', 'fora do valor': 'o valor acabou' }[r.motivo] || '');
    }
    function campoQtd(r) {
      if (r.site !== 'ok' && r.site !== 'sem') return '—';
      const passo = (r.c && r.c.mult) || (r.it.un === 'Kg' ? 0.1 : 1);
      const i = h('input', { class: 'f-input ped-q', type: 'number', min: 0, step: String(passo), value: r.pedir || 0 });
      i.addEventListener('change', () => {
        let v = Math.max(0, +i.value || 0);
        if (v > 0) v = Math.round(Math.ceil(v / passo - 1e-9) * passo * 1000) / 1000;
        i.value = v;
        r.pedir = v;
        if (v === r.sugeridoPedir) editados.delete(String(r.cod)); else editados.set(String(r.cod), v);
        if (r._tot) r._tot.textContent = v > 0 ? fmt.brl(v * (r.preco || 0)) : '—';
        pintarTotal();
      });
      return h('span', { class: 'ped-q-w' }, i, h('small', null, unid(r.it)));
    }
    const catInfo = p.catalogo
      ? `Preços e disponibilidade do Sistema de Pedidos de ${new Date(p.catalogo.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.`
      : 'Ainda não há catálogo do Sistema de Pedidos: os preços são o custo do AppNext e não dá para saber o que está indisponível.';
    const sub = modo === 'repor'
      ? `Compra só o que precisa para ${R.ent} dias de entrega + ${R.N} dias até o próximo pedido, com a época do ano. Urgentes primeiro; depois quem deixa mais lucro sem fixos por dia. ${catInfo}`
      : `O que vendeu no ${R.ev.nome} do ano passado × crescimento, + o consumo normal até lá − estoque. Sem limite de valor: ajuste as quantidades. ${catInfo}`;
    const btnCsv = h('button', { type: 'button', class: 'btn', onclick: () => baixarCsv(R.linhas.filter((r) => r.pedir > 0), loja) }, '⬇ CSV');
    corpo.append(h('div', { class: 'mt' }, TS.cardWithTools('Produtos', sub,
      h('div', { class: 'est-tools' }, tab.searchBox && (tab.searchBox.classList.add('est-busca'), tab.searchBox),
        TS.seg(Object.entries(FILTROS).map(([k, [t]]) => [`${t} (${cont(k)})`, k]), filtro, (v) => { state.pedFiltro = v; pintar(corpo, loja, M, e, p); }), btnCsv),
      tab)));
    if (editados.size) corpo.append(h('p', { class: 'muted' }, `${editados.size} quantidade(s) alterada(s) à mão. `, h('a', { href: '#', onclick: (x) => { x.preventDefault(); editados.clear(); pintar(corpo, loja, M, e, p); } }, 'Voltar à sugestão')));

    corpo.append(h('div', { class: 'mt' }, cartaoRobo(corpo, loja, M, e, p, R)));
  }

  /** datas comemorativas da loja: nome e período (Dia das Mães: dias antes do 2º domingo de maio) */
  function editorEventos(loja, p, par, repintar) {
    const linhas = [];
    const box = h('div', { class: 'ped-evs' });
    const ddmm = (mmdd) => (mmdd ? `${mmdd.slice(3, 5)}/${mmdd.slice(0, 2)}` : '');
    const mmdd = (v) => { const m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(v).trim()); return m ? `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
    const linha = (ev = { nome: '', de: '', ate: '' }) => {
      const nome = h('input', { class: 'f-input', value: ev.nome, placeholder: 'Ex.: Dia dos Namorados', maxlength: 40 });
      const o = { ev, nome };
      let campos;
      if (ev.regra === 'maes') {
        o.dias = h('input', { class: 'f-input', type: 'number', min: 1, max: 45, value: ev.diasAntes, style: { maxWidth: '80px' } });
        campos = h('span', { class: 'ped-ev-c' }, o.dias, ' dias antes do 2º domingo de maio, até ele');
      } else {
        o.de = h('input', { class: 'f-input', value: ddmm(ev.de), placeholder: 'dd/mm', style: { maxWidth: '80px' } });
        o.ate = h('input', { class: 'f-input', value: ddmm(ev.ate), placeholder: 'dd/mm', style: { maxWidth: '80px' } });
        campos = h('span', { class: 'ped-ev-c' }, 'de ', o.de, ' a ', o.ate);
      }
      const el = h('div', { class: 'ped-ev' }, nome, campos, h('button', { type: 'button', class: 'est-outro-rem', onclick: () => { linhas.splice(linhas.indexOf(o), 1); el.remove(); } }, '✕ Remover'));
      linhas.push(o); box.append(el);
    };
    (p.cfg.eventos || []).forEach((ev) => linha(ev));
    const msg = h('span', { class: 'muted' });
    const salvar = h('button', { type: 'button', class: 'btn primary' }, 'Salvar datas');
    salvar.addEventListener('click', async () => {
      salvar.disabled = true; msg.className = 'muted'; msg.textContent = 'Salvando…';
      try {
        const eventos = linhas.map((o) => (o.ev.regra === 'maes' ? { id: o.ev.id, nome: o.nome.value, regra: 'maes', diasAntes: +o.dias.value } : { id: o.ev.id, nome: o.nome.value, de: mmdd(o.de.value), ate: mmdd(o.ate.value) }));
        const r = await fetch(`/api/pedido/cfg?loja=${encodeURIComponent(loja)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...p.cfg, eventos }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
        p.cfg = j.cfg; state.pedAbrirEv = true; repintar();
      } catch (err) { msg.className = 'neg'; msg.textContent = err.message; salvar.disabled = false; }
    });
    const d = h('details', { class: 'card ped-evs-card', open: state.pedAbrirEv || null },
      h('summary', null, 'Datas comemorativas da loja'),
      h('p', { class: 'muted' }, 'O período de cada data, que é comparado com o mesmo período do ano passado. Use dd/mm (ex.: 01/12 a 24/12).'),
      box, h('div', { class: 'cfg-acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => linha() }, '+ Adicionar data'), salvar, msg));
    d.addEventListener('toggle', () => { state.pedAbrirEv = d.open; });
    void par;
    return d;
  }

  /** bloco de Configurações → Lojas (só admin): login da loja no Sistema de Pedidos */
  TS.blocoPedidoAcesso = function (lojaId) {
    const b = h('section', { class: 'cfg-bloco' }, h('h3', null, 'Sistema de Pedidos'),
      h('p', { class: 'muted' }, 'Login desta loja no site de pedidos da franqueadora (grnteashop.nextsoft.com.br/Pedidos). Com ele, o robô lê o catálogo toda noite e monta o carrinho pela aba Pedido. Ele nunca finaliza o pedido.'));
    const corpo = h('div', null, h('p', { class: 'muted' }, 'Carregando…'));
    b.append(corpo);
    const api = `/api/pedido/acesso?loja=${encodeURIComponent(lojaId)}`;
    const pintarForm = (a) => {
      const usuario = h('input', { class: 'f-input', value: a.usuario || '', placeholder: 'ex.: flamboyant', autocomplete: 'off', style: { maxWidth: '220px' } });
      const senha = h('input', { class: 'f-input', type: 'password', autocomplete: 'new-password', placeholder: a.temSenha ? '•••••• (salva)' : 'senha do site', style: { maxWidth: '260px' } });
      const msg = h('span', { class: 'muted' });
      const enviar = async (body, btn) => {
        btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Salvando…';
        try {
          const r = await fetch(api, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
          pintarForm(j);
          corpo.querySelector('.cfg-acoes span').className = 'pos';
          corpo.querySelector('.cfg-acoes span').textContent = body.apagar ? 'Login removido.' : 'Salvo. Na aba Pedido, clique em "Atualizar catálogo" para testar.';
        } catch (err) { msg.className = 'neg'; msg.textContent = err.message; btn.disabled = false; }
      };
      const salvar = h('button', { type: 'button', class: 'btn primary' }, 'Salvar login');
      salvar.addEventListener('click', () => enviar({ usuario: usuario.value, senha: senha.value }, salvar));
      const remover = a.temSenha ? h('button', { type: 'button', class: 'btn' }, 'Remover') : null;
      if (remover) remover.addEventListener('click', () => { if (confirm('Remover o login desta loja no Sistema de Pedidos?')) enviar({ apagar: true }, remover); });
      corpo.replaceChildren(
        h('div', { class: 'est-cfg-g' }, h('label', null, h('span', null, 'Usuário'), h('div', null, usuario)), h('label', null, h('span', null, 'Senha'), h('div', null, senha))),
        h('small', { class: 'muted' }, a.temSenha ? `Senha salva${a.em ? ` em ${new Date(a.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${a.por ? ' por ' + a.por : ''}` : ''}. Ela fica só no servidor e não aparece mais aqui.` : 'A senha fica só no servidor e não aparece mais depois de salva. O site usa http (sem criptografia): não reaproveite essa senha em outro lugar.'),
        h('div', { class: 'cfg-acoes' }, salvar, remover, msg));
    };
    fetch(api, { credentials: 'same-origin' }).then((r) => r.json()).then(pintarForm).catch((e) => corpo.replaceChildren(h('p', { class: 'neg' }, e.message)));
    return b;
  };

  // ---------- robô do Sistema de Pedidos ----------
  function cartaoRobo(corpo, loja, M, e, p, R) {
    const robo = p.robo || {};
    const ocupado = robo.estado === 'na_fila' || robo.estado === 'rodando';
    const msg = h('div', { class: 'muted' });
    const acionar = async (body, btn) => {
      btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Enviando…';
      try {
        const r = await fetch(`/api/pedido/robo?loja=${encodeURIComponent(loja)}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha.');
        msg.className = 'pos'; msg.textContent = 'Na fila do coletor. Esta tela se atualiza sozinha.';
        acompanhar(corpo, loja, M, e);
      } catch (err) { msg.className = 'neg'; msg.textContent = err.message; btn.disabled = false; }
    };
    const itens = R.linhas.filter((r) => r.pedir > 0 && r.site === 'ok');
    const btnCarrinho = h('button', { type: 'button', class: 'btn primary', disabled: ocupado || !itens.length || null }, `Montar carrinho no site (${itens.length} produtos)`);
    btnCarrinho.addEventListener('click', () => {
      const semCat = R.linhas.filter((r) => r.pedir > 0 && r.site === 'sem').length;
      if (!confirm(`O robô vai entrar no Sistema de Pedidos e colocar ${itens.length} produtos no carrinho (${fmt.brl0(itens.reduce((s, r) => s + r.pedir * r.preco, 0))}).${semCat ? ` ${semCat} sem catálogo ficam de fora.` : ''}\n\nEle NÃO finaliza o pedido: depois você revisa e finaliza no site. Se o carrinho do site já tiver itens, ele não mexe.\n\nContinuar?`)) return;
      acionar({ acao: 'carrinho', itens: itens.map((r) => ({ cod: r.cod, qtd: r.pedir })) }, btnCarrinho);
    });
    const btnCat = h('button', { type: 'button', class: 'btn', disabled: ocupado || null }, 'Atualizar catálogo');
    btnCat.addEventListener('click', () => acionar({ acao: 'catalogo' }, btnCat));
    const estadoTxt = ocupado ? h('div', { class: 'notice' }, h('span', { class: 'spinner sm' }), ` ${robo.acao === 'carrinho' ? 'Montando o carrinho' : 'Lendo o catálogo'}… (${robo.estado === 'na_fila' ? 'na fila' : 'rodando'})`) : null;
    if (ocupado) acompanhar(corpo, loja, M, e);
    const u = robo.ultima;
    const ultima = u ? h('div', { class: 'muted ped-ult' }, `Última tarefa: ${u.acao === 'carrinho' ? 'carrinho' : 'catálogo'} em ${new Date(u.fim).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · `,
      h('span', { class: u.ok ? 'pos' : 'neg' }, u.ok ? 'ok' : `falhou (${u.codigo})`),
      !u.ok && u.log ? h('details', null, h('summary', null, 'ver o log'), h('pre', { class: 'ped-log' }, u.log.join('\n'))) : null) : null;
    let corpoRobo;
    if (!robo.disponivel) corpoRobo = h('p', { class: 'muted' }, robo.erro ? `Coletor indisponível: ${robo.erro}` : 'O robô roda no coletor da VPS, que não está ativo para esta loja. Dá para baixar o CSV e lançar no site.');
    else if (!robo.temLogin) corpoRobo = h('p', null, 'Falta o login desta loja no Sistema de Pedidos: ', p.podeRobo ? h('a', { href: '#config' }, 'Configurações → Lojas → Sistema de Pedidos') : 'peça ao administrador', '. Depois clique em "Atualizar catálogo".');
    else if (!p.podeRobo) corpoRobo = h('p', { class: 'muted' }, 'Só o administrador aciona o robô. Você pode baixar o CSV.');
    else corpoRobo = h('div', null, h('div', { class: 'cfg-acoes' }, btnCarrinho, btnCat), msg, estadoTxt, ultima);
    return TS.card('Carrinho no Sistema de Pedidos', 'O robô entra com o login da loja, escolhe FRANQUIAS, procura cada produto pelo nome, confere o nome exato, ajusta ao múltiplo e coloca no carrinho. Ele para na etapa 2: pagamento, entrega e finalização ficam com você. O catálogo é lido sozinho toda noite.',
      corpoRobo, h('div', { class: 'ped-andamento' }, resultadoCarrinho(p.carrinho)));
  }

  function resultadoCarrinho(c) {
    if (!c || !Array.isArray(c.itens)) return null;
    const ST = { ok: ['No carrinho', 'ok'], indisponivel: ['Indisponível', 'erro'], nao_encontrado: ['Não achou no site', 'erro'], acima_do_maximo: ['Acima do máximo', 'warn'], sem_confirmacao: ['Sem confirmação', 'warn'], erro: ['Erro', 'erro'] };
    const ok = c.itens.filter((x) => x.status === 'ok').length;
    return h('div', { class: 'mt' },
      h('div', { class: 'f-label' }, `Último carrinho: ${new Date(c.inicio).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${c.por ? ` · por ${c.por}` : ''}`),
      c.erro ? h('div', { class: 'notice err' }, c.erro) : null,
      c.carrinhoDepois ? h('p', null, h('b', null, `${ok} de ${c.itens.length} produtos no carrinho`), ` · no site: ${c.carrinhoDepois.texto || '—'}. `, h('span', { class: 'muted' }, 'Revise e finalize no Sistema de Pedidos.')) : (c.fim ? null : h('p', { class: 'muted' }, `Em andamento: ${c.itens.length} produtos até agora…`)),
      c.itens.length ? TS.table({
        cols: [
          { key: 'nome', label: 'Produto', align: 'l', wrap: true },
          { key: 'status', label: 'Resultado', align: 'l', render: (r) => { const s = ST[r.status] || [r.status, '']; return h('span', { class: 'badge ' + s[1], title: r.erro || null }, s[0]); } },
          { key: 'pedido', label: 'Pedido', fmt: fmt.n2 },
          { key: 'qtd', label: 'No carrinho', fmt: (v) => (v ? fmt.n2(v) : '—') },
          { key: 'preco', label: 'Preço', fmt: (v) => (v ? fmt.brl(v) : '—') },
        ],
        rows: c.itens, sortKey: 'status', sortDir: 'asc', maxHeight: '360px', cls: 'est-t',
      }) : null);
  }

  function acompanhar(corpo, loja, M, e) {
    if (poll) return;
    const tic = async () => {
      poll = null;
      if (!corpo.isConnected || state.page !== 'pedido' || state.loja !== loja) return;
      try {
        const p = await buscar(loja);
        const ocupado = p.robo && (p.robo.estado === 'na_fila' || p.robo.estado === 'rodando');
        if (!ocupado) { pintar(corpo, loja, M, e, p); return; }
        // durante o carrinho, mostra o andamento
        const box = corpo.querySelector('.ped-andamento');
        if (p.carrinho && box) box.replaceChildren(resultadoCarrinho(p.carrinho) || '');
      } catch { /* tenta de novo */ }
      poll = setTimeout(tic, 5000);
    };
    poll = setTimeout(tic, 5000);
  }

  function baixarCsv(lista, loja) {
    if (!lista.length) { alert('Nada no pedido.'); return; }
    const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const n = (v, d) => (v == null ? '' : v.toFixed(d).replace('.', ','));
    const linhas = [['Código', 'Produto', 'Grupo', 'Unidade', 'Estoque', 'Pedir', 'Preço', 'Total', 'Site'].join(';'),
      ...lista.map((r) => [r.cod, r.produto, r.grupoTxt, r.it.un, n(r.qtd, 3), n(r.pedir, 3), n(r.preco || 0, 2), n(r.pedir * (r.preco || 0), 2), { ok: 'disponível', sem: 'sem catálogo', indisp: 'indisponível', fora: 'fora do catálogo' }[r.site]].map(esc).join(';'))];
    const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `pedido-sugerido-${loja}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
})();
