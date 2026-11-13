/* Pedido sugerido (aba Pedido): quanto pedir à franqueadora e o quê, e o robô que monta o carrinho no Sistema de Pedidos.
 * Reposição: valor = % do faturamento da loja (sem Espaço Gourmet) nos últimos N dias (padrão: o CMV real dos 3 últimos
 * meses fechados). Compra só o que precisa (previsão × (entrega + N dias) − estoque), dividido entre chás a granel,
 * envasados e acessórios na proporção das vendas, priorizando quem deixa mais lucro sem fixos por dia.
 * Data comemorativa: o que vendeu no mesmo período do ano passado × crescimento da loja, + o consumo até lá − estoque.
 * Só admin e franqueado; o robô (carrinho e catálogo) só o admin. */
(function () {
  const { h, fmt, state } = TS;
  const DIA = 86400e3;
  const CLASSES = { estrela: 'Estrela', volume: 'Volume', joia: 'Joia', peso: 'Peso morto' };
  const GRUPOS = { cha: 'Chás a granel', env: 'Envasados', acess: 'Acessórios', insumo: 'Embalagens e insumos' };
  const ordemG = ['cha', 'env', 'acess', 'insumo'];
  const qtdPorLoja = new Map(); // loja|modo → Map(cod → quantidade editada)
  let poll = null;
  const tituloOriginal = document.title;
  document.addEventListener('visibilitychange', () => { if (!document.hidden && document.title.startsWith('✓')) document.title = tituloOriginal; });

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
    const contrib = new Map(), vendaItem = new Map(), grupoVt = new Map(), bruto = new Map();
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
      // giro e margem bruta dos últimos 90 dias (classe: estrela, volume, joia, peso morto)
      if (loja && d >= d90 && cs.length) {
        const cu = M.custo(i);
        if (cu != null) { const k = cs[0][0].cod; const b = bruto.get(k) || bruto.set(k, { vt: 0, custo: 0, giro: 0, kg: cs[0][0].un === 'Kg' }).get(k); b.vt += vt; b.custo += cu; b.giro += cs[0][1]; }
      }
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

    // mesma regra da matriz do Estoque e margem: giro × margem bruta comparados com a mediana
    // (chá a granel entre chás, em kg; acessórios e envasados entre si, em unidades)
    const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const classe = new Map();
    for (const kg of [true, false]) {
      const xs = [...bruto.entries()].filter(([, b]) => b.kg === kg && b.vt > 0);
      const mq = med(xs.map(([, b]) => b.giro)), mm = med(xs.map(([, b]) => (b.vt - b.custo) / b.vt));
      for (const [k, b] of xs) { const m = (b.vt - b.custo) / b.vt; classe.set(k, b.giro >= mq ? (m >= mm ? 'estrela' : 'volume') : (m >= mm ? 'joia' : 'peso')); }
    }
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
        classe: classe.get(it.cod) || null,
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
    root.append(TS.subEstoque('pedido'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Pedido'),
      h('div', { class: 'page-sub' }, 'Pedido sugerido para a franqueadora e o robô que monta o carrinho no Sistema de Pedidos'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'O pedido é de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Montando o pedido…'))));
    root.append(corpo);
    const loja = state.loja;
    Promise.all([TS.estoqueBuscar(loja), buscar(loja), TS.custosLoja()]).then(([e, p, M]) => {
      if (!corpo.isConnected) return;
      if (!e.estoque || !e.estoque.itens || !e.estoque.itens.length || !M) {
        corpo.replaceChildren(h('div', { class: 'notice' }, 'Ainda não há estoque desta loja no painel. O pedido usa o estoque e o custo do AppNext: veja Estoque → Estoque e margem.'));
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
      todos: ['Todos', () => true],
    };
    const SITK = (r) => (r.qtd <= 0 ? 'acabou' : r.urgente ? 'falta' : r.dias != null && r.dias < R.ent + R.N ? 'pedir' : 'ok');
    const SITS = { acabou: ['Acabou', 'erro'], falta: ['Falta antes da entrega', 'erro'], pedir: ['Pedir', 'warn'], ok: ['OK', 'ok'] };
    const SITU = (r) => SITS[SITK(r)];
    // filtros extras (valem em qualquer aba): grupo, situação e classe
    const fx = state.pedFx || (state.pedFx = { g: '', s: '', c: '' });
    const passa = (r, sem) => (sem === 'g' || !fx.g || r.grupo === fx.g) && (sem === 's' || !fx.s || SITK(r) === fx.s) && (sem === 'c' || !fx.c || (r.classe || 'sem') === fx.c);
    const cont = (k) => R.linhas.filter((r) => FILTROS[k][1](r) && passa(r)).length;
    const linhas = R.linhas.filter((r) => FILTROS[filtro][1](r) && passa(r));
    const naAba = R.linhas.filter(FILTROS[filtro][1]);
    const seletor = (chave, rot, todos, opcoes, valorDe) => {
      const n = (v) => naAba.filter((r) => passa(r, chave) && valorDe(r) === v).length;
      const s = h('select', { class: 'f-input ped-fx' + (fx[chave] ? ' on' : ''), 'aria-label': rot, onchange: (x) => { fx[chave] = x.target.value; pintar(corpo, loja, M, e, p); } },
        h('option', { value: '' }, `${rot}: ${todos}`),
        opcoes.filter(([v]) => n(v) || fx[chave] === v).map(([v, t]) => h('option', { value: v, selected: fx[chave] === v || null }, `${rot}: ${t} (${n(v)})`)));
      return s;
    };
    const filtrosExtra = h('div', { class: 'ped-fxs' },
      seletor('g', 'Grupo', 'todos', ordemG.map((g) => [g, GRUPOS[g]]), (r) => r.grupo),
      seletor('s', 'Situação', 'todas', Object.entries(SITS).map(([k, [t]]) => [k, t]), SITK),
      seletor('c', 'Classe', 'todas', [...Object.entries(CLASSES), ['sem', 'sem classe']], (r) => r.classe || 'sem'),
      fx.g || fx.s || fx.c ? h('button', { type: 'button', class: 'btn ped-fx-limpa', onclick: () => { state.pedFx = { g: '', s: '', c: '' }; pintar(corpo, loja, M, e, p); } }, '✕ Tirar filtros') : null,
      h('span', { class: 'muted ped-fx-n' }, `${fmt.int(linhas.length)} ${linhas.length === 1 ? 'produto' : 'produtos'}`));
    const tab = TS.table({
      cols: [
        { key: 'produto', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => h('span', null, r.produto, h('small', { class: 'est-tam' }, `cód. ${r.cod}`)) },
        { key: 'grupoTxt', label: 'Grupo', align: 'l' },
        { key: 'classe', label: 'Classe', align: 'l', title: 'Giro × margem bruta dos últimos 90 dias, comparados com a mediana (mesma regra do Estoque e margem). Estrela: vende muito e tem margem boa. Volume: vende muito, margem menor. Joia: margem boa, vende pouco. Peso morto: vende pouco e margem baixa',
          render: (r) => (r.classe ? h('span', { class: 'ped-cl ped-cl-' + r.classe }, CLASSES[r.classe]) : h('span', { class: 'muted' }, '—')), sortVal: (r) => ({ estrela: 4, volume: 3, joia: 2, peso: 1 })[r.classe] || 0 },
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
      empty: { pedido: 'Nada no pedido.', fora: 'Nada ficou de fora.', indisp: 'Nenhum produto necessário está indisponível no site.', cat: 'Todos os produtos necessários estão no catálogo.', todos: 'Nenhum produto precisa de reposição.' }[filtro],
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
      // ＋ põe no pedido (a quantidade que precisa, sem olhar o valor); × tira do pedido
      const b = h('button', { type: 'button', class: 'ped-ab' });
      const pintarB = () => {
        const tem = r.pedir > 0;
        b.className = 'ped-ab ' + (tem ? 'tira' : 'poe');
        b.textContent = tem ? '×' : '＋';
        b.title = tem ? 'Tirar do pedido' : `Adicionar ao pedido (${qtdTxt(r.sugerido, r.it)}), mesmo passando do valor`;
        b.setAttribute('aria-label', b.title);
      };
      const definir = (v) => {
        if (v > 0) v = Math.round(Math.ceil(v / passo - 1e-9) * passo * 1000) / 1000;
        i.value = v;
        r.pedir = v;
        if (v === r.sugeridoPedir) editados.delete(String(r.cod)); else editados.set(String(r.cod), v);
        if (r._tot) r._tot.textContent = v > 0 ? fmt.brl(v * (r.preco || 0)) : '—';
        pintarB();
        pintarTotal();
      };
      i.addEventListener('change', () => definir(Math.max(0, +i.value || 0)));
      b.addEventListener('click', () => definir(r.pedir > 0 ? 0 : (r.sugerido || passo)));
      pintarB();
      return h('span', { class: 'ped-q-w' }, i, h('small', null, unid(r.it)), b);
    }
    const catInfo = p.catalogo
      ? `Preços e disponibilidade do Sistema de Pedidos de ${new Date(p.catalogo.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.`
      : 'Ainda não há catálogo do Sistema de Pedidos: os preços são o custo do AppNext e não dá para saber o que está indisponível.';
    const sub = modo === 'repor'
      ? `Compra só o que precisa para ${R.ent} dias de entrega + ${R.N} dias até o próximo pedido, com a época do ano. Urgentes primeiro; depois quem deixa mais lucro sem fixos por dia. ${catInfo}`
      : `O que vendeu no ${R.ev.nome} do ano passado × crescimento, + o consumo normal até lá − estoque. Sem limite de valor: ajuste as quantidades. ${catInfo}`;
    const btnCsv = h('button', { type: 'button', class: 'btn', onclick: () => baixarCsv(R.linhas.filter((r) => r.pedir > 0), loja) }, '⬇ CSV');
    // Limpar: zera as quantidades do pedido (tudo ou um grupo); "Voltar à sugestão" desfaz
    const zerar = (g) => {
      for (const r of R.linhas) if ((r.site === 'ok' || r.site === 'sem') && (!g || r.grupo === g)) { if (r.sugeridoPedir === 0) editados.delete(String(r.cod)); else editados.set(String(r.cod), 0); }
      pintar(corpo, loja, M, e, p);
    };
    const noGrupo = (g) => R.linhas.filter((r) => r.pedir > 0 && (!g || r.grupo === g));
    const opLimpar = (rot, g) => { const l = noGrupo(g); return h('button', { type: 'button', disabled: !l.length || null, onclick: () => zerar(g) }, rot, h('small', null, l.length ? `${fmt.int(l.length)} · ${fmt.brl0(l.reduce((s, r) => s + r.pedir * (r.preco || 0), 0))}` : 'vazio')); };
    const menuLimpar = h('details', { class: 'ped-menu' }, h('summary', { class: 'btn' }, 'Limpar ▾'),
      h('div', { class: 'ped-menu-l' },
        opLimpar('Limpar tudo', null),
        ...['cha', 'env', 'acess', 'insumo'].filter((g) => R.linhas.some((r) => r.grupo === g)).map((g) => opLimpar(`Limpar ${GRUPOS[g].toLowerCase()}`, g)),
        h('button', { type: 'button', class: 'ped-menu-volta', disabled: !editados.size || null, onclick: () => { editados.clear(); pintar(corpo, loja, M, e, p); } }, 'Voltar à sugestão', h('small', null, editados.size ? `${editados.size} alterado(s)` : 'nada alterado'))));
    const foraMenu = (x) => { if (!menuLimpar.contains(x.target)) menuLimpar.open = false; };
    menuLimpar.addEventListener('toggle', () => { if (menuLimpar.open) document.addEventListener('mousedown', foraMenu); else document.removeEventListener('mousedown', foraMenu); });
    corpo.append(h('div', { class: 'mt' }, TS.cardWithTools('Produtos', sub,
      h('div', { class: 'est-tools' }, tab.searchBox && (tab.searchBox.classList.add('est-busca'), tab.searchBox),
        TS.seg(Object.entries(FILTROS).map(([k, [t]]) => [`${t} (${cont(k)})`, k]), filtro, (v) => { state.pedFiltro = v; pintar(corpo, loja, M, e, p); }), menuLimpar, btnCsv),
      filtrosExtra, tab)));
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
      h('p', { class: 'muted' }, 'Login desta loja no site de pedidos da franqueadora (grnteashop.nextsoft.com.br/Pedidos). Com ele, o robô lê o catálogo toda noite e monta o carrinho em Estoque → Pedido. Ele nunca finaliza o pedido.'));
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
          corpo.querySelector('.cfg-acoes span').textContent = body.apagar ? 'Login removido.' : 'Salvo. Em Estoque → Pedido, clique em "Atualizar catálogo" para testar.';
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
  /** o carrinho está sendo montado no navegador? (código válido e ainda não terminou) */
  const carrinhoAtivo = (c) => !!(c && c.modo === 'navegador' && !c.fim && c.expira && Date.parse(c.expira) > Date.now());
  const linkFavorito = () => `javascript:(function(){var s=document.createElement('script');s.src='${location.origin}/js/carrinho-site.js?v='+Date.now();document.body.appendChild(s);})();`;

  // ---------- carrinho no Sistema de Pedidos ----------
  function cartaoRobo(corpo, loja, M, e, p, R) {
    const robo = p.robo || {};
    const catOcupado = robo.estado === 'na_fila' || robo.estado === 'rodando';
    const ativo = carrinhoAtivo(p.carrinho);
    const msg = h('div', { class: 'muted' });
    const statusBox = h('div', { class: 'ped-status' }, ativo ? progresso(p.carrinho) : catOcupado ? progressoCat(robo) : null);
    if (ativo || catOcupado) acompanhar(corpo, loja, M, e);

    // 1) montar: gera o código e abre o site em outra aba (aberta já no clique, para o navegador não bloquear)
    const itens = R.linhas.filter((r) => r.pedir > 0 && r.site === 'ok');
    const btnCarrinho = h('button', { type: 'button', class: 'btn primary', disabled: !itens.length || null }, `Montar carrinho no site (${itens.length} produtos)`);
    btnCarrinho.addEventListener('click', async () => {
      const aba = window.open('about:blank', '_blank');
      btnCarrinho.disabled = true; msg.className = 'muted'; msg.textContent = 'Preparando…';
      try {
        const r = await fetch(`/api/pedido/carrinho?loja=${encodeURIComponent(loja)}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ itens: itens.map((x) => ({ cod: x.cod, qtd: x.pedir })) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha.');
        if (aba) aba.location.href = j.url; else window.open(j.url, '_blank');
        msg.textContent = '';
        statusBox.replaceChildren(progresso({ modo: 'navegador', aguardando: true, total: itens.length, itens: [], site: j.url }));
        acompanhar(corpo, loja, M, e);
      } catch (err) { if (aba) aba.close(); msg.className = 'neg'; msg.textContent = err.message; }
      btnCarrinho.disabled = false;
    });
    const fav = h('a', { class: 'ped-fav', href: linkFavorito(), title: 'Arraste para a barra de favoritos', onclick: (ev) => { ev.preventDefault(); alert('Arraste este botão para a barra de favoritos do navegador (Ctrl+Shift+B mostra a barra). Depois, use-o dentro do Sistema de Pedidos.'); } }, '🛒 Carrinho Tea Shop');
    const passos = h('ol', { class: 'ped-passos' },
      h('li', null, h('b', null, 'Uma vez só: '), 'arraste o botão ', fav, ' para a barra de favoritos do navegador.'),
      h('li', null, 'Clique em ', h('b', null, 'Montar carrinho no site'), '. O Sistema de Pedidos abre em outra aba (entre com o login da loja, se pedir).'),
      h('li', null, 'Lá, clique no favorito ', h('b', null, '🛒 Carrinho Tea Shop'), '. Ele coloca os produtos no carrinho da sua sessão e mostra o andamento, que também aparece aqui.'),
      h('li', null, 'Confira o carrinho e finalize no site. O painel nunca finaliza o pedido.'));

    // 2) catálogo: robô do coletor (preço, disponível, múltiplo)
    const acionarCat = async (btn) => {
      btn.disabled = true; msg.className = 'muted'; msg.textContent = 'Enviando…';
      try {
        const r = await fetch(`/api/pedido/robo?loja=${encodeURIComponent(loja)}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'catalogo' }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha.');
        msg.textContent = '';
        statusBox.replaceChildren(progressoCat({ estado: 'na_fila' }));
        acompanhar(corpo, loja, M, e);
      } catch (err) { msg.className = 'neg'; msg.textContent = err.message; btn.disabled = false; }
    };
    const btnCat = h('button', { type: 'button', class: 'btn', disabled: catOcupado || null }, 'Atualizar catálogo');
    btnCat.addEventListener('click', () => acionarCat(btnCat));
    const u = robo.ultima;
    const ultima = u ? h('div', { class: 'muted ped-ult' }, `Catálogo: última leitura em ${new Date(u.fim).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · `,
      h('span', { class: u.ok ? 'pos' : 'neg' }, u.ok ? 'ok' : `falhou (${u.codigo})`),
      !u.ok && u.log ? h('details', null, h('summary', null, 'ver o log'), h('pre', { class: 'ped-log' }, u.log.join('\n'))) : null) : null;
    let catTxt = null;
    if (!robo.disponivel) catTxt = h('p', { class: 'muted' }, robo.erro ? `Coletor indisponível: ${robo.erro}` : 'O catálogo é lido pelo coletor da VPS, que não está ativo para esta loja.');
    else if (!robo.temLogin) catTxt = h('p', null, 'Para ler o catálogo, falta o login desta loja no Sistema de Pedidos: ', p.podeRobo ? h('a', { href: '#config' }, 'Configurações → Lojas → Sistema de Pedidos') : 'peça ao administrador', '.');

    const semCatalogo = !p.catalogo;
    return TS.card('Carrinho no Sistema de Pedidos', 'O carrinho do site vale só para a sessão de quem entrou; por isso ele é montado no seu navegador, com o seu login. O favorito procura cada produto pelo nome, confere o nome exato, ajusta ao múltiplo e coloca no carrinho. Ele para na etapa 2.',
      semCatalogo ? h('div', { class: 'notice' }, 'Leia o catálogo primeiro (botão "Atualizar catálogo"): só vão para o carrinho os produtos disponíveis no site.') : null,
      passos,
      h('div', { class: 'cfg-acoes' }, btnCarrinho, p.podeRobo && robo.disponivel && robo.temLogin ? btnCat : null), msg, statusBox, catTxt, ultima,
      h('div', { class: 'ped-andamento' }, ativo ? null : resultadoCarrinho(p.carrinho)));
  }

  const progressoCat = (robo) => h('div', { class: 'notice ped-prog' }, h('span', { class: 'spinner sm' }),
    robo.estado === 'na_fila' ? [h('b', null, 'Catálogo na fila do coletor. '), 'Começa assim que a coleta em andamento terminar.'] : [h('b', null, 'Lendo o catálogo do site… '), 'Leva 1 a 2 minutos.']);

  /** andamento do carrinho: esperando o favorito, "3/25 produtos" com barra */
  function progresso(c) {
    const caixa = (...filhos) => h('div', { class: 'notice ped-prog' }, h('span', { class: 'spinner sm' }), ...filhos);
    if (!c || c.aguardando || !c.itens.length && !c.atual) {
      return caixa(h('b', null, 'Esperando o favorito no site. '), 'Na aba do Sistema de Pedidos, clique em "🛒 Carrinho Tea Shop". ',
        c && c.site ? h('a', { href: /#teashop=/.test(c.site) ? c.site : `${c.site}Abertura.aspx`, target: '_blank', rel: 'noopener' }, 'Abrir o site de novo') : null);
    }
    const feitos = c.itens.length, ok = c.itens.filter((x) => x.status === 'ok').length, prob = feitos - ok;
    return caixa(
      h('b', null, `${fmt.int(feitos)}/${fmt.int(c.total)} produtos processados`),
      ` · ${fmt.int(ok)} ${ok === 1 ? 'adicionado' : 'adicionados'} ao carrinho${prob ? ` · ${fmt.int(prob)} com problema` : ''}`,
      h('div', { class: 'ped-prog-b' }, h('span', { style: { width: `${Math.round((feitos / c.total) * 100)}%` } })),
      c.atual ? h('small', null, `Agora: ${c.atual}`) : null);
  }

  function resultadoCarrinho(c) {
    if (!c || !Array.isArray(c.itens) || (c.modo === 'navegador' && !c.itens.length)) return null;
    const ST = { ok: ['No carrinho', 'ok'], sem_estoque: ['Sem estoque no fornecedor', 'erro'], recusado: ['O site recusou', 'erro'], indisponivel: ['Indisponível', 'erro'], nao_encontrado: ['Não achou no site', 'erro'], acima_do_maximo: ['Acima do máximo', 'warn'], sem_confirmacao: ['Sem confirmação', 'warn'], erro: ['Erro', 'erro'] };
    const ok = c.itens.filter((x) => x.status === 'ok').length, prob = c.itens.length - ok;
    const site = c.site ? `${c.site.replace(/Abertura\.aspx.*$/, '')}Abertura.aspx` : null;
    const fimTxt = c.fim
      ? h('div', { class: 'notice ok' }, h('b', null, `Carrinho pronto: ${ok} de ${c.total || c.itens.length} produtos.`), c.carrinhoDepois && c.carrinhoDepois.texto ? ` No site: ${c.carrinhoDepois.texto}.` : '',
        prob ? ` ${prob} com problema: no quadro do favorito, no site, cada um tem "Tentar de novo".` : '', ' Confira e finalize no site. ',
        site ? h('a', { href: site, target: '_blank', rel: 'noopener' }, 'Abrir o Sistema de Pedidos ↗') : null)
      : h('div', { class: 'notice warn' }, `O carrinho parou em ${c.itens.length} de ${c.total} produtos (a aba do site foi fechada ou o link venceu). Clique em "Montar carrinho no site" de novo para refazer.`);
    return h('div', { class: 'mt' },
      h('div', { class: 'f-label' }, `Último carrinho: ${new Date(c.inicio).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${c.por ? ` · por ${c.por}` : ''}`),
      c.erro ? h('div', { class: 'notice err' }, c.erro) : null,
      c.modo === 'navegador' ? fimTxt : null,
      TS.table({
        cols: [
          { key: 'nome', label: 'Produto', align: 'l', wrap: true },
          { key: 'status', label: 'Resultado', align: 'l', render: (r) => { const s = ST[r.status] || [r.status, '']; return h('span', null, h('span', { class: 'badge ' + s[1], title: r.erro || null }, s[0]), r.erro && (r.status === 'sem_estoque' || r.status === 'recusado') ? h('small', { class: 'est-tam' }, r.erro) : null); } },
          { key: 'pedido', label: 'Pedido', fmt: fmt.n2 },
          { key: 'qtd', label: 'No carrinho', fmt: (v, r) => (v && r.status === 'ok' ? fmt.n2(v) : '—') },
          { key: 'preco', label: 'Preço', fmt: (v) => (v ? fmt.brl(v) : '—') },
        ],
        rows: c.itens, sortKey: 'status', sortDir: 'asc', maxHeight: '360px', cls: 'est-t',
      }));
  }

  function acompanhar(corpo, loja, M, e) {
    if (poll) return;
    const tic = async () => {
      poll = null;
      if (!corpo.isConnected || state.page !== 'pedido' || state.loja !== loja) return;
      try {
        const p = await buscar(loja);
        const cat = p.robo && (p.robo.estado === 'na_fila' || p.robo.estado === 'rodando');
        const car = carrinhoAtivo(p.carrinho);
        if (!cat && !car) {
          if (p.carrinho && p.carrinho.fim && document.hidden) document.title = '✓ Carrinho pronto · Tea Shop';
          pintar(corpo, loja, M, e, p); return;
        }
        // andamento: "3/25 produtos processados" e a barra
        const box = corpo.querySelector('.ped-status');
        if (box) box.replaceChildren(car ? progresso(p.carrinho) : progressoCat(p.robo));
      } catch { /* tenta de novo */ }
      poll = setTimeout(tic, 3000);
    };
    poll = setTimeout(tic, 3000);
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
