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
  const GRUPOS = { cha: 'Chás a granel', env: 'Envasados', acess: 'Acessórios', insumo: 'Embalagens e insumos', outros: 'Outros (bens de consumo)' };
  const ordemG = ['cha', 'env', 'acess', 'insumo', 'outros'];
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
  /** passo de compra: chá a granel (kg) só em quilo inteiro; o resto, o múltiplo do site (ou 1 unidade) */
  const passoDe = (c, it) => (it.un === 'Kg' ? Math.max(1, Math.ceil(((c && c.mult) || 1) - 1e-9)) : (c && c.mult) || 1);
  // prioridade dos chás a granel: estoque abaixo de 500 g (sempre) e Estrela abaixo de 700 g
  const PISO = 0.5, PISO_ESTRELA = 0.7;
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
  let VAL = new Map(); // cod → { dias, faixa, kg } do lote mais urgente (< 90 dias)
  function calcular(M, estoque, ecfg, catalogo, pcfg, modo, ev, editados, ccfg, obrig, espera = {}) {
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
    const d30 = fim - 29, dN = fim - N + 1, d90 = fim - 89, d56 = fim - 55;
    const cons = new Map(), lyB = new Map(), lyN = new Map(), lyDias = new Map(), lyEv = new Map();
    const tot = { kg: { b: 0, n: 0 }, un: { b: 0, n: 0 } };
    const contrib = new Map(), vendaItem = new Map(), grupoVt = new Map(), bruto = new Map();
    const fatG = { cha: 0, env: 0, acess: 0 };
    let vendasN = 0, cmvVt = 0, cmvCusto = 0, cresA = 0, cresB = 0, evLyVt = 0;
    const lim0 = Math.min(lyB0, evLy0 ?? Infinity, d90 - 365, d56 - 365);
    for (let i = 0; i < db.n; i++) {
      const d = db.day[i];
      if (d < lim0) continue;
      const loja = ehLoja(i), vt = db.vt[i] || 0;
      const c = M.casar(i);
      if (loja) {
        if (d >= dN) { vendasN += vt; fatG[grupoLinha(i, c)] += vt; }
        // crescimento: últimas 8 semanas × as mesmas 8 do ano passado (igual ao card "Próximas semanas")
        if (d >= d56) cresA += vt; else if (d >= d56 - 364 && d <= fim - 364) cresB += vt;
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
      // vendas com custo dos últimos 90 dias (para saber se o chá ainda vende)
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
      const mult = passoDe(c, it);
      let x = Math.ceil(q / mult - 1e-9) * mult;
      if (c && c.min && x > 0 && x < c.min) x = Math.ceil(c.min / mult - 1e-9) * mult;
      if (c && c.max && x > c.max) x = Math.floor(c.max / mult + 1e-9) * mult;
      return Math.round(x * 1000) / 1000;
    };

    // classe oficial (a mesma do Estoque e margem): mediana do giro mensal nos últimos 3, 6 ou 12 meses fechados × margem,
    // independente do filtro de período; classes travadas à mão valem acima da conta
    const CO = TS.classeOficial(M, ccfg);
    const classe = { get: (cod) => { const x = CO.get(String(cod)); return x ? x.classe : undefined; }, fixa: (cod) => { const x = CO.get(String(cod)); return !!(x && x.fixa); } };
    // ---------- pedido obrigatório (ativo): vem de qualquer forma — conta como estoque chegando e entra no valor ----------
    const OB = new Map();
    const obAtivos = ((obrig && obrig.lista) || []).filter((o) => o.ativo);
    for (const o of obAtivos) for (const x of o.itens) {
      const k = String(x.cod);
      const a = OB.get(k) || OB.set(k, { cod: k, nome: x.nome, qtd: 0, preco: null, de: new Set() }).get(k);
      a.qtd += x.qtd; if (x.preco != null) a.preco = x.preco; a.de.add(o.nome);
    }
    const linhas = [];
    for (const it of estoque.itens) {
      const vel = (cons.get(it.cod) || 0) / 30;
      const prev = vel * (modo === 'evento' ? 1 : sazonal(it));
      const qtd = Math.max(0, it.qtd || 0);
      const chega = OB.has(String(it.cod)) ? OB.get(String(it.cod)).qtd : 0; // vem no pedido obrigatório
      const qtdEf = qtd + chega;
      const esp = espera[String(it.cod)] || null; // lista de espera (Clientes → Lista de espera)
      const txtChega = chega ? ` − ${qtdTxt(chega, it)} que vêm no pedido obrigatório` : '';
      let precisa, conta, prior = 0;
      if (modo === 'evento') {
        const ly = lyEv.get(it.cod) || 0;
        if (!(ly > 0)) continue;
        // consumo normal até começar: no máximo entrega + intervalo de pedidos (o resto as reposições normais cobrem)
        const ate = Math.min(Math.max(0, ev0 - hoje), ent + N);
        const noEvento = ly * cresc, antes = prev * ate;
        precisa = noEvento + antes - qtdEf;
        conta = `No ${ev.nome} do ano passado: ${qtdTxt(ly, it)} × crescimento ${fmt.n2(cresc)} = ${qtdTxt(noEvento, it)}. Consumo normal até lá (${fmt.int(ate)} dias × ${qtdTxt(prev, it)}/dia) = ${qtdTxt(antes, it)}. Menos o estoque de ${qtdTxt(qtd, it)}${txtChega}.`;
      } else {
        // chá a granel que vendeu nos últimos 90 dias e está abaixo do piso: entra sempre, na frente
        const cl = classe.get(it.cod);
        const ehCha = it.un === 'Kg' && (grupoDe(it.cod) || 'cha') === 'cha' && (prev > 0 || bruto.has(it.cod));
        prior = ehCha && qtdEf < PISO ? 2 : ehCha && cl === 'estrela' && qtdEf < PISO_ESTRELA ? 1 : 0;
        // cliente na lista de espera com o estoque zerado: entra na frente de tudo
        if (esp && qtdEf <= 0) prior = 3;
        if (!(prev > 0) && !(it.min && qtdEf < it.min) && !prior) continue;
        precisa = Math.max(prev * H - qtdEf, (it.min || 0) - qtdEf, prior ? 1e-6 : 0);
        conta = `Previsão ${qtdTxt(prev, it)}/dia × (${ent} dias de entrega + ${N} dias até o próximo pedido) = ${qtdTxt(prev * H, it)} − estoque ${qtdTxt(qtd, it)}${txtChega}${it.min && it.min - qtdEf > prev * H - qtdEf ? ` · o mínimo do AppNext pede ${qtdTxt(it.min - qtdEf, it)}` : ''}.`
          + (prior === 3 ? ` Prioridade: ${esp.pedidos} ${esp.pedidos === 1 ? 'cliente esperando' : 'clientes esperando'} na lista de espera.` : prior === 2 ? ' Prioridade: estoque abaixo de 500 g.' : prior === 1 ? ' Prioridade: Estrela com estoque abaixo de 700 g.' : '')
          + (it.un === 'Kg' ? ' Chá a granel só em quilo inteiro.' : '')
          + (VAL.has(String(it.cod)) ? ` Atenção: ${qtdTxt(VAL.get(String(it.cod)).kg, it)} deste chá vencem em ${VAL.get(String(it.cod)).dias < 0 ? 'lote já vencido' : VAL.get(String(it.cod)).dias + ' dias'}: venda antes de comprar mais.` : '');
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
      linhas.push({ cod: it.cod, produto: it.desc, it, c, grupo: g, grupoTxt: GRUPOS[g], qtd, chega, prev, dias, urgente, precisa, sugerido, conta, preco, lucroDia, site, unidadeEstranha,
        classe: classe.get(it.cod) || null, classeFixa: classe.fixa(it.cod), prior, esp,
        margem: vendaItem.get(it.cod) ? (contrib.get(it.cod) || 0) / vendaItem.get(it.cod) : null, pedir: 0, motivo: '' });
    }

    // ---------- o resto do catálogo: produtos que não precisam de reposição pela previsão, ou que nem estão no estoque
    // (bens de consumo da operação: etiquetas, sacolas…). Ficam fora da conta do valor; você pede à mão se quiser.
    if (catalogo && catalogo.itens) {
      const ja = new Set(linhas.map((r) => String(r.cod)));
      for (const c of catalogo.itens) {
        const cod = String(c.cod);
        if (ja.has(cod)) continue;
        ja.add(cod);
        const doEst = M.porCod.get(cod);
        const it = doEst || { cod, desc: c.nome, un: 'Un', custo: null, qtd: 0 };
        const g = grupoDe(cod) || (doEst ? (doEst.un === 'Kg' ? 'cha' : doEst.tipo === 'PN' ? 'acess' : 'insumo') : 'outros');
        linhas.push({ cod, produto: doEst ? doEst.desc : c.nome, it, c, grupo: g, grupoTxt: GRUPOS[g], qtd: Math.max(0, it.qtd || 0), prev: 0, dias: null, urgente: false, precisa: 0, sugerido: 0,
          conta: doEst ? 'Pela previsão não precisa de reposição agora. Peça à mão se quiser.' : 'Não está no estoque do AppNext (bem de consumo da operação ou produto novo). Peça à mão se precisar.',
          preco: c.disp ? c.preco : null, lucroDia: (contrib.get(cod) || 0) / 30, site: c.disp ? 'ok' : 'indisp', unidadeEstranha: false, classe: classe.get(cod) || null, classeFixa: classe.fixa(cod), margem: null,
          pedir: 0, motivo: '', extra: true, semEstoque: !doEst });
      }
    }

    // linhas do pedido obrigatório: travadas, entram no total e na proporção do grupo, mas não vão para o carrinho
    const obG = { cha: 0, env: 0, acess: 0, insumo: 0, outros: 0 };
    for (const x of OB.values()) {
      const c = catPorCod.get(x.cod), doEst = M.porCod.get(x.cod);
      const it = doEst || { cod: x.cod, desc: x.nome || (c && c.nome) || x.cod, un: 'Un', custo: null, qtd: 0 };
      const g = grupoDe(x.cod) || (doEst ? (doEst.un === 'Kg' ? 'cha' : doEst.tipo === 'PN' ? 'acess' : 'insumo') : 'outros');
      const preco = x.preco != null ? x.preco : c && c.disp ? c.preco : it.custo || null;
      obG[g] += x.qtd * (preco || 0);
      linhas.push({ cod: x.cod, produto: doEst ? doEst.desc : (c && c.nome) || x.nome || x.cod, it, c, grupo: g, grupoTxt: GRUPOS[g], qtd: Math.max(0, it.qtd || 0), prev: 0, dias: null, urgente: false, precisa: x.qtd, sugerido: x.qtd,
        conta: `Vem no ${[...x.de].join(', ')}: a franquia manda de qualquer forma. Não vai para o carrinho.`, preco, lucroDia: (contrib.get(x.cod) || 0) / 30, site: 'obrig', obrig: true, unidadeEstranha: false,
        classe: classe.get(x.cod) || null, classeFixa: classe.fixa(x.cod), margem: null, pedir: x.qtd, motivo: 'obrigatório' });
    }
    const obTotal = Object.values(obG).reduce((a, v) => a + v, 0);

    // ---------- distribuição do valor ----------
    const compraveis = linhas.filter((r) => !r.extra && (r.site === 'ok' || r.site === 'sem'));
    const prioridade = (a, b) => ((b.prior || 0) - (a.prior || 0)) || (b.urgente - a.urgente) || (b.lucroDia - a.lucroDia) || (b.prev * (b.preco || 0) - a.prev * (a.preco || 0));
    const fatSoma = fatG.cha + fatG.env + fatG.acess;
    const shareVendas = { cha: fatSoma ? fatG.cha / fatSoma : 0, env: fatSoma ? fatG.env / fatSoma : 0, acess: fatSoma ? fatG.acess / fatSoma : 0 };
    // proporção definida por você (ex.: 100% chás a granel): grupo com 0% não entra no pedido sugerido
    const pm = pcfg.proporcao;
    const manual = !!(pm && pm.cha + pm.env + pm.acess > 0);
    const share = manual ? { cha: pm.cha / 100, env: pm.env / 100, acess: pm.acess / 100 } : shareVendas;
    const custoDe = (r, q) => q * (r.preco || 0);
    if (orcamento == null) {
      for (const r of compraveis) { r.pedir = r.sugerido; r.motivo = 'completo'; }
    } else {
      // embalagens e insumos acompanham os chás: entram primeiro, fora da proporção
      // o pedido obrigatório já ocupa parte do valor: embalagens/outros saem antes; chás, envasados e acessórios contam na parte do grupo
      let gasto = obG.insumo + obG.outros;
      for (const r of compraveis.filter((x) => x.grupo === 'insumo')) { r.pedir = r.sugerido; r.motivo = 'completo'; gasto += custoDe(r, r.pedir); }
      const resto = Math.max(0, orcamento - gasto);
      const alvo = { cha: resto * share.cha, env: resto * share.env, acess: resto * share.acess };
      const folga = 1 + pcfg.folgaPct / 100;
      const usado = { cha: obG.cha, env: obG.env, acess: obG.acess };
      const mult = (r) => passoDe(r.c, r.it);
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
      for (const r of compraveis.filter((x) => x.grupo !== 'insumo' && (!manual || share[x.grupo] > 0)).sort(prioridade)) {
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
    return { linhas, vendasN, cmvReal, cmvVt, cmvCusto, cmvMeses: [...meses].sort(), pct, orcamento, share, shareVendas, propManual: manual, classeMeses: CO.meses, obTotal, obG, obAtivos, fatG, crescLoja, cresc, evInfo, ev, evLyVt, temAnoPassado, N, ent, hoje };
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
    Promise.all([TS.estoqueBuscar(loja), buscar(loja), TS.custosLoja(), TS.validade ? TS.validade.riscoPorCod(loja) : new Map()]).then(([e, p, M, vl]) => {
      if (!corpo.isConnected) return;
      VAL = vl; // lotes de chá a granel perto da validade (Estoque → Validade)
      if (!e.estoque || !e.estoque.itens || !e.estoque.itens.length || !M) {
        corpo.replaceChildren(h('div', { class: 'notice' }, 'Ainda não há estoque desta loja no painel. O pedido usa o estoque e o custo do AppNext: veja Estoque e Margem.'));
        return;
      }
      pintar(corpo, loja, M, e, p);
    }).catch((err) => corpo.replaceChildren(h('div', { class: 'notice err' }, err.message)));
  };

  function pintar(corpo, loja, M, e, p, Rpronto) {
    corpo.replaceChildren();
    const modo = state.pedModo || 'repor';
    const eventos = p.cfg.eventos || [];
    const ev = modo === 'evento' ? (eventos.find((x) => x.id === state.pedEvento) || eventos[0]) : null;
    // parâmetros desta tela (começam pelos salvos; só valem para a loja depois de "Salvar")
    const par = state.pedPar && state.pedPar.loja === loja ? state.pedPar : (state.pedPar = { loja, ...p.cfg });
    const chave = `${loja}|${modo}|${ev ? ev.id : ''}`;
    const editados = qtdPorLoja.get(chave) || qtdPorLoja.set(chave, new Map()).get(chave);
    // Rpronto: redesenho depois de pôr/tirar um produto (não refaz a conta; as quantidades já estão nas linhas)
    const R = Rpronto || calcular(M, e.estoque, e.cfg, p.catalogo, par, modo, ev, editados, e.classe, p.obrigatorio, p.espera || {});

    // ---------- controles ----------
    const num = (v, attrs) => h('input', { class: 'f-input', type: 'number', value: v ?? '', style: { maxWidth: '96px' }, ...attrs });
    // campos automáticos (CMV real, crescimento da loja) já vêm preenchidos; se você digitar, vira manual
    const auto = (el, ativo) => { el.dataset.auto = ativo ? '1' : '0'; if (ativo) el.classList.add('ped-auto'); el.addEventListener('input', () => { el.dataset.auto = '0'; el.classList.remove('ped-auto'); }); return el; };
    const um = (x) => Math.round(x * 10) / 10;
    const iPct = auto(num(par.cmvPct ?? (R.cmvReal != null ? um(R.cmvReal * 100) : null), { min: 1, max: 90, step: '0.5' }), par.cmvPct == null);
    const iDias = num(par.dias, { min: 3, max: 60 });
    const iFolga = num(par.folgaPct, { min: 0, max: 100 });
    const iCresc = auto(num(par.crescimentoPct ?? um((R.crescLoja - 1) * 100), { min: -80, max: 300, step: '0.1' }), par.crescimentoPct == null);
    const ler = () => {
      const v = (i) => (i.dataset.auto === '1' || i.value === '' ? null : +i.value);
      Object.assign(par, { cmvPct: v(iPct), dias: Math.max(3, Math.min(60, Math.round(+iDias.value || p.cfg.dias))), folgaPct: v(iFolga) ?? 10, crescimentoPct: v(iCresc) });
    };
    // recalcula ao sair do campo; espera um instante para não redesenhar a tela no meio do clique em "Salvar"
    let pendente = null;
    const aplicar = () => { ler(); editados.clear(); pintar(corpo, loja, M, e, p); };
    [iPct, iDias, iFolga, iCresc].forEach((i) => i.addEventListener('change', () => { clearTimeout(pendente); pendente = setTimeout(aplicar, 250); }));
    const msg = h('span', { class: state.pedMsg ? state.pedMsg[0] : 'muted' }, state.pedMsg ? state.pedMsg[1] : '');
    state.pedMsg = null;
    const salvar = h('button', { type: 'button', class: 'btn' }, 'Salvar como padrão da loja');
    salvar.addEventListener('pointerdown', () => { clearTimeout(pendente); pendente = null; });
    salvar.addEventListener('click', async () => {
      clearTimeout(pendente); pendente = null;
      ler();
      salvar.disabled = true; msg.className = 'muted'; msg.textContent = 'Salvando…';
      try {
        const r = await fetch(`/api/pedido/cfg?loja=${encodeURIComponent(loja)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmvPct: par.cmvPct, dias: par.dias, folgaPct: par.folgaPct, crescimentoPct: par.crescimentoPct, proporcao: par.proporcao || null, eventos }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
        p.cfg = j.cfg;
        state.pedMsg = ['pos', `Salvo como padrão da loja: ${par.cmvPct != null ? fmt.n1(par.cmvPct) + '% das vendas' : 'CMV real'}, ${par.dias} dias${par.proporcao ? `, proporção ${par.proporcao.cha}/${par.proporcao.env}/${par.proporcao.acess}%` : ''}.`];
        editados.clear();
        pintar(corpo, loja, M, e, p);
        return;
      } catch (err) { msg.className = 'neg'; msg.textContent = err.message; }
      salvar.disabled = false;
    });
    const lbl = (t, el, suf, dica, nota) => h('label', { title: dica || null }, h('span', null, t, dica ? h('span', { class: 'ped-i', 'aria-hidden': 'true' }, 'ⓘ') : null), h('div', null, el, suf ? ' ' + suf : ''), nota || null);
    const mesTxt = (ym) => new Date(ym + '-15T12:00:00Z').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('. de ', '/').replace('.', '');
    const dicaCmv = R.cmvReal == null ? 'Percentual do faturamento da loja (sem Espaço Gourmet) que vira pedido. Ainda não dá para calcular o CMV real: faltam vendas com custo nos 3 últimos meses fechados.'
      : `Percentual do faturamento da loja (sem Espaço Gourmet) que vira pedido.\n\nAutomático: o CMV real: ${fmt.pct(R.cmvReal)}.\nCMV = custo dos produtos vendidos ÷ faturamento, só loja, nos 3 últimos meses fechados (${R.cmvMeses.map(mesTxt).join(', ')}):\n${fmt.brl0(R.cmvCusto)} de custo ÷ ${fmt.brl0(R.cmvVt)} vendidos = ${fmt.pct(R.cmvReal)}.\n\nOu seja: o pedido repõe o que saiu da loja. Digite outro % para pedir mais ou menos (vira manual; "voltar ao automático" desfaz).`;
    const voltar = (campo) => h('a', { href: '#', onclick: (x) => { x.preventDefault(); par[campo] = null; editados.clear(); pintar(corpo, loja, M, e, p); } }, 'voltar ao automático');
    const notaCmv = h('small', { class: 'ped-nota' }, par.cmvPct == null ? 'automático: CMV real' : h('span', null, `manual · CMV real ${fmt.pct(R.cmvReal)} · `, voltar('cmvPct')));
    const notaCresc = h('small', { class: 'ped-nota' }, par.crescimentoPct == null ? 'automático: últimas 8 semanas' : h('span', null, `manual · da loja ${fmt.pct(R.crescLoja - 1)} · `, voltar('crescimentoPct')));
    const cat = blocoCatalogo(corpo, loja, M, e, p);
    const est = blocoEstoque(loja, e);
    const controles = h('div', { class: 'card ped-ctl' },
      h('div', { class: 'ped-ctl-l' },
        TS.seg([['Reposição', 'repor'], ['Data comemorativa', 'evento']], modo, (v) => { state.pedModo = v; pintar(corpo, loja, M, e, p); }),
        modo === 'evento' ? h('select', { class: 'f-input', onchange: (x) => { state.pedEvento = x.target.value; pintar(corpo, loja, M, e, p); } },
          eventos.map((x) => h('option', { value: x.id, selected: ev && x.id === ev.id || null }, x.nome))) : null),
      h('div', { class: 'est-cfg-g ped-ctl-g' },
        modo === 'repor' ? lbl('Valor do pedido', iPct, '% das vendas', dicaCmv, notaCmv) : null,
        modo === 'repor' ? lbl('Vendas de', iDias, 'dias', 'Período de vendas usado no valor e intervalo até o próximo pedido (ex.: 7 para pedido semanal, 14 para quinzenal).') : null,
        modo === 'repor' ? lbl('Folga da proporção', iFolga, '%', 'Quanto cada grupo (chás, envasados, acessórios) pode passar da sua parte antes de o valor ir para os outros.') : null,
        modo === 'evento' ? lbl('Crescimento', iCresc, '%', `Quanto a mais (ou a menos) que no ano passado se vende na data.\n\nAutomático: o crescimento da loja nas últimas 8 semanas contra as mesmas 8 semanas do ano passado (${fmt.pct(R.crescLoja - 1)}), o mesmo do card "Próximas semanas" em Estoque e margem.\n\nDigite outro valor se espera mais ou menos movimento.`, notaCresc) : null),
      h('div', { class: 'cfg-acoes' }, salvar, est.acao, cat.acao, msg), h('div', { class: 'ped-cat' }, est.info, cat.info, est.st, cat.st));
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
    // composição do valor (com pedido obrigatório): obrigatório + carrinho (+ fora do catálogo) e o que sobra do limite
    const compos = [];
    const desenharCompo = (el) => {
      if (!R.obTotal) { el.replaceChildren(); el.hidden = true; return; }
      el.hidden = false;
      const ob = R.obTotal;
      const car = R.linhas.filter((r) => !r.obrig && r.pedir > 0 && r.site === 'ok').reduce((s2, r) => s2 + r.pedir * (r.preco || 0), 0);
      const fora = R.linhas.filter((r) => !r.obrig && r.pedir > 0 && r.site !== 'ok').reduce((s2, r) => s2 + r.pedir * (r.preco || 0), 0);
      const tot = ob + car + fora, lim = R.orcamento;
      const base = Math.max(tot, lim || 0) || 1;
      const seg = (v, cls, tit) => (v > 0 ? h('span', { class: 'ped-compo-s ' + cls, style: { width: `${(v / base) * 100}%` }, title: `${tit}: ${fmt.brl(v)}` }) : null);
      el.replaceChildren(
        h('div', { class: 'ped-compo-t' },
          h('span', null, '🔒 Obrigatório ', h('b', null, fmt.brl0(ob))), h('span', { class: 'ped-compo-op' }, '+'),
          h('span', null, '🛒 Carrinho ', h('b', { class: 'ped-compo-car' }, fmt.brl0(car))),
          fora ? [h('span', { class: 'ped-compo-op' }, '+'), h('span', { title: 'Produtos no pedido que não estão disponíveis no catálogo do site: não vão para o carrinho' }, 'fora do site ', h('b', null, fmt.brl0(fora)))] : null,
          h('span', { class: 'ped-compo-op' }, '='), h('span', { class: 'ped-compo-tot' }, 'Total ', h('b', null, fmt.brl0(tot))),
          lim != null ? h('span', { class: 'muted' }, ` de ${fmt.brl0(lim)} · ${tot <= lim ? `sobram ${fmt.brl0(lim - tot)}` : `passa ${fmt.brl0(tot - lim)}`}`) : null),
        h('div', { class: 'ped-compo-bar' }, seg(ob, 'ob', 'Obrigatório'), seg(car, 'car', 'Carrinho'), seg(fora, 'fora', 'Fora do site'), lim != null && tot < lim ? seg(lim - tot, 'sobra', 'Sobra') : null));
    };
    R.novoCompo = () => { const el = h('div', { class: 'ped-compo' }); compos.push(el); desenharCompo(el); return el; };
    // celular: barra fixa no rodapé com o valor do carrinho e o atalho para montar
    const barra = matchMedia('(max-width: 760px)').matches ? h('div', { class: 'ped-barra' }) : null;
    const pintarBarra = () => {
      if (!barra) return;
      const car = R.linhas.filter((r) => !r.obrig && r.pedir > 0 && r.site === 'ok');
      const v = car.reduce((s2, r) => s2 + r.pedir * (r.preco || 0), 0), t = total();
      barra.replaceChildren(
        h('div', null, h('small', null, `🛒 Carrinho · ${fmt.int(car.length)} itens`), h('b', null, fmt.brl0(v)),
          R.orcamento != null ? h('small', { class: t > R.orcamento * 1.02 ? 'down' : '' }, t <= R.orcamento ? `sobram ${fmt.brl0(R.orcamento - t)}` : `passa ${fmt.brl0(t - R.orcamento)}`) : null),
        h('button', { type: 'button', class: 'btn primary', onclick: () => { const c = corpo.querySelector('.ped-robo'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 'Montar carrinho ›'));
    };
    const pintarTotal = () => {
      compos.forEach(desenharCompo);
      pintarBarra();
      const t = total(), n = R.linhas.filter((r) => r.pedir > 0).length;
      kTotal.textContent = fmt.brl0(t);
      const nOb = R.linhas.filter((r) => r.obrig).length;
      kTotalFoot.replaceChildren(R.obTotal ? h('span', null, h('b', null, `🛒 ${fmt.int(n - nOb)} no carrinho ${fmt.brl0(t - R.obTotal)}`), ` + 🔒 ${fmt.int(nOb)} obrigatório ${fmt.brl0(R.obTotal)}`) : `${fmt.int(n)} ${n === 1 ? 'produto' : 'produtos'}`,
        R.orcamento ? h('span', { class: t > R.orcamento * 1.02 ? 'down' : '' }, ` · ${fmt.pct(t / R.orcamento, 0)} do valor · ${t <= R.orcamento ? `sobram ${fmt.brl0(R.orcamento - t)}` : `passa ${fmt.brl0(t - R.orcamento)}`}`) : '');
      mix && pintarMix();
    };
    const kpis = [];
    if (modo === 'repor') {
      kpis.push(TS.kpi(`Vendas da loja · ${R.N} dias`, fmt.brl0(R.vendasN), `até ${fmt.date(TS.dayToIso(R.hoje - 1))} · sem Espaço Gourmet`));
      kpis.push(TS.kpi('Limite do pedido', fmt.brl0(R.orcamento), R.obTotal ? h('span', null, `obrigatório ${fmt.brl0(R.obTotal)} · `, h('b', null, `para pedir ${fmt.brl0(Math.max(0, R.orcamento - R.obTotal))}`)) : `${fmt.pct(R.pct)} das vendas${par.cmvPct == null ? ' (CMV real)' : ` · CMV real ${fmt.pct(R.cmvReal)}`}`,
        `CMV real = custo dos produtos vendidos ÷ faturamento, só loja, nos 3 últimos meses fechados: ${fmt.pct(R.cmvReal)}.`));
    } else {
      const [a0, a1] = R.evInfo.atual, [l0, l1] = R.evInfo.anterior;
      const ate = a0 - R.hoje;
      kpis.push(TS.kpi(R.ev.nome, `${fmt.date(TS.dayToIso(a0)).slice(0, 5)} a ${fmt.date(TS.dayToIso(a1)).slice(0, 5)}`, ate > 0 ? `começa em ${fmt.int(ate)} dias · peça até ${fmt.date(TS.dayToIso(a0 - R.ent)).slice(0, 5)}` : 'em andamento',
        `Para chegar a tempo, peça até ${R.ent} dias (a entrega) antes de começar.`));
      kpis.push(TS.kpi('Vendas no ano passado', fmt.brl0(R.evLyVt), `${fmt.date(TS.dayToIso(l0))} a ${fmt.date(TS.dayToIso(l1))} · previsão ${fmt.brl0(R.evLyVt * R.cresc)}`, `Só loja (sem Espaço Gourmet). Previsão = ano passado × crescimento ${fmt.n2(R.cresc)}.`));
    }
    const kT = h('div', { class: 'card kpi' }, h('div', { class: 'kpi-label' }, editados.size ? 'Seu pedido (com alterações)' : 'Pedido sugerido'), kTotal, kTotalFoot);
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
    if (R.obTotal) corpo.append(h('div', { class: 'card mt ped-compo-card' }, h('div', { class: 'card-title' }, 'Composição do pedido'), R.novoCompo()));
    corpo.append(h('div', { class: 'mt' }, cartaoObrigatorio(corpo, loja, M, e, p, R)));
    if (modo === 'evento' && R.evInfo.atual[0] - R.hoje > R.ent + R.N) corpo.append(h('div', { class: 'notice mt' }, `Faltam ${fmt.int(R.evInfo.atual[0] - R.hoje)} dias para o ${R.ev.nome}: isto é uma prévia. O consumo normal até lá foi limitado a ${R.ent + R.N} dias (entrega + intervalo de pedidos), porque as reposições normais cobrem o resto. Refaça perto da data, com o estoque de então.`));
    if (modo === 'evento' && R.evInfo.atual[0] - R.hoje < R.ent) corpo.append(h('div', { class: 'notice warn mt' }, `A entrega leva ${R.ent} dias e o ${R.ev.nome} começa antes disso: o pedido pode chegar atrasado.`));

    // ---------- como o pedido é montado (fica abaixo do gráfico) ----------
    function comoFeito() {
      const li = (t, ...x) => h('li', null, h('b', null, t), ' ', ...x);
      return h('details', { class: 'ped-como', open: state.pedComoAberto || null, ontoggle: (ev) => { state.pedComoAberto = ev.target.open; } },
        h('summary', null, 'Como o pedido é montado'),
        h('ol', null,
          li('Valor do pedido:', R.orcamento != null ? `${fmt.pct(R.pct, 1)} do faturamento dos últimos ${R.N} dias (sem Espaço Gourmet) = ${fmt.brl0(R.orcamento)}.` : 'sem limite de valor.'),
          li('Quanto cada produto precisa:', `previsão de venda por dia (últimos 30 dias, ajustada pela época do ano) × (${R.ent} dias de entrega + ${R.N} dias até o próximo pedido) − o estoque. Se o mínimo do AppNext pedir mais, vale o mínimo.`),
          li('Arredondamento:', 'chá a granel só em quilo inteiro (1 kg, 2 kg…); os outros no múltiplo do site, sempre para cima, respeitando mínimo e máximo do site.'),
          li('Embalagens e insumos', '(saco kraft, etiquetas) entram primeiro, fora da proporção.'),
          li('Pedido obrigatório:', 'o que a franquia manda de qualquer forma (cadastrado em "Pedido obrigatório") já ocupa o valor: sai do limite, conta na parte do grupo dele e as quantidades contam como estoque chegando, para não pedir de novo. Não vai para o carrinho.'),
          li('Divisão do valor:', R.propManual ? 'o resto vai para cada grupo pela proporção que você definiu; grupo com 0% fica fora (dá para pôr à mão).' : 'o resto vai para chás a granel, envasados e acessórios na mesma proporção das vendas do período.', ` Cada grupo pode passar ${fmt.int(par.folgaPct ?? 10)}% da sua parte (folga).`),
          li('Ordem dentro de cada grupo:', 'antes de tudo, produto zerado com cliente na lista de espera (⏳); 1º chás a granel com estoque abaixo de 500 g (entram sempre, mesmo que a previsão não peça, desde que tenham vendido nos últimos 90 dias); 2º chás Estrela abaixo de 700 g; 3º o que acaba antes da entrega; depois quem deixa mais lucro sem fixos por dia. Produto que não cabe inteiro entra com parte da necessidade.'),
          li('Classe (Estrela, Volume, Joia, Peso morto):', `é a classe oficial, a mesma da Rentabilidade. Usa a mediana do que o produto vendeu por mês nos últimos ${R.classeMeses} meses fechados, então um mês de promoção pesa pouco, e a margem bruta do período. Não muda com o filtro de período. A janela (3, 6 ou 12 meses) muda aqui, acima da tabela ("Classe pelos últimos"), ou em Produtos → Rentabilidade → Produtos por lucro; as classes travadas à mão (🔒) ficam na Rentabilidade.`),
          li('Sobra:', 'o que sobrar do valor vai para quem ainda precisa, na mesma ordem. Use "Limpar ▾ → Completar com a sobra" depois de mexer à mão.'),
          li('Fica de fora:', 'indisponível no site, fora do catálogo FRANQUIAS e o resto do catálogo (o que não precisa agora e os bens de consumo): esses você pede à mão.')));
    }

    // ---------- proporção ----------
    let mix = null;
    const pintarMix = () => {
      const gasto = { cha: 0, env: 0, acess: 0 };
      for (const r of R.linhas) if (r.pedir > 0 && gasto[r.grupo] != null) gasto[r.grupo] += r.pedir * (r.preco || 0);
      const soma = gasto.cha + gasto.env + gasto.acess;
      mix.replaceChildren(...['cha', 'env', 'acess'].map((g) => h('div', { class: 'ped-mix-i' },
        h('div', { class: 'ped-mix-t' }, GRUPOS[g]),
        h('div', { class: 'ped-mix-b' }, h('span', { class: 'ped-mix-alvo', style: { width: `${Math.round((R.share[g] || 0) * 100)}%` } }), h('span', { class: 'ped-mix-ped', style: { width: `${soma ? Math.round((gasto[g] / soma) * 100) : 0}%` } })),
        h('div', { class: 'ped-mix-n' }, `${R.propManual ? 'definido' : 'vendas'} ${fmt.pct(R.share[g], 0)} · pedido ${soma ? fmt.pct(gasto[g] / soma, 0) : '—'} (${fmt.brl0(gasto[g])})`))));
    };
    if (modo === 'repor') {
      mix = h('div', { class: 'ped-mix' });
      pintarMix();
      // proporção: pelas vendas (automático) ou definida por você (ex.: 100% chás); vale para o pedido sugerido
      const pm = par.proporcao || { cha: Math.round(R.shareVendas.cha * 100), env: Math.round(R.shareVendas.env * 100), acess: 100 - Math.round(R.shareVendas.cha * 100) - Math.round(R.shareVendas.env * 100) };
      const iP = Object.fromEntries(['cha', 'env', 'acess'].map((g) => [g, num(pm[g], { min: 0, max: 100, step: 1, style: { maxWidth: '76px' } })]));
      const somaP = h('span', { class: 'muted' });
      const verSoma = () => { const t = ['cha', 'env', 'acess'].reduce((a, g) => a + (+iP[g].value || 0), 0); somaP.textContent = `soma ${t}%`; somaP.className = t === 100 ? 'muted' : 'neg'; return t; };
      const aplicarP = (val) => {
        if (val) Object.entries(val).forEach(([g, v]) => { iP[g].value = v; });
        if (verSoma() !== 100) return;
        par.proporcao = { cha: +iP.cha.value || 0, env: +iP.env.value || 0, acess: +iP.acess.value || 0 };
        editados.clear(); pintar(corpo, loja, M, e, p);
      };
      Object.values(iP).forEach((i) => { i.addEventListener('input', verSoma); i.addEventListener('change', () => aplicarP()); });
      verSoma();
      const ctlP = h('div', { class: 'ped-prop' },
        h('span', { class: 'f-label' }, 'Proporção do pedido'),
        TS.seg([['Pelas vendas', 'auto'], ['Definir', 'manual']], R.propManual ? 'manual' : 'auto', (v) => { if (v === 'auto') { par.proporcao = null; editados.clear(); pintar(corpo, loja, M, e, p); } else aplicarP(); }),
        R.propManual || state.pedPropAberta ? h('span', { class: 'ped-prop-ins' },
          ...['cha', 'env', 'acess'].map((g) => h('label', null, h('span', null, GRUPOS[g]), iP[g], '%')), somaP,
          h('button', { type: 'button', class: 'chip', onclick: () => aplicarP({ cha: 100, env: 0, acess: 0 }) }, '100% chás'),
          h('button', { type: 'button', class: 'chip', onclick: () => aplicarP({ cha: 0, env: 0, acess: 100 }) }, '100% acessórios')) : null,
        h('small', { class: 'muted' }, R.propManual ? 'Grupo com 0% fica fora do pedido sugerido (dá para pôr à mão). "Salvar como padrão da loja" guarda esta proporção.' : 'Automático: a parte de cada grupo nas vendas do período.'));
      corpo.append(h('div', { class: 'mt' }, TS.card('Proporção do pedido', `Parte de cada grupo ${R.propManual ? 'definida por você' : `nas vendas dos últimos ${R.N} dias`} (cinza) e no pedido (verde). Embalagens e insumos (saco kraft, etiquetas) entram antes, fora da proporção.`, ctlP, mix, comoFeito())));
    }
    pintarTotal();

    // ---------- tabela ----------
    const filtro = state.pedFiltro || 'pedido';
    const FILTROS = {
      pedido: ['No pedido', (r) => r.pedir > 0 && !r.obrig],
      fora: ['Ficou de fora', (r) => !r.extra && !(r.pedir > 0) && (r.site === 'ok' || r.site === 'sem')],
      indisp: ['Indisponível no site', (r) => !r.extra && r.site === 'indisp'],
      cat: ['Fora do catálogo', (r) => r.site === 'fora'],
      resto: ['Resto do catálogo', (r) => r.extra],
      ...(R.obTotal ? { obrig: ['🔒 Obrigatório', (r) => r.obrig] } : {}),
      todos: ['Todos', () => true],
    };
    const SITK = (r) => (r.obrig ? 'obrig' : r.extra ? (r.semEstoque ? 'semest' : 'semnec') : r.qtd <= 0 ? 'acabou' : r.urgente ? 'falta' : r.dias != null && r.dias < R.ent + R.N ? 'pedir' : 'ok');
    const SITS = { acabou: ['Acabou', 'erro'], falta: ['Falta antes da entrega', 'erro'], pedir: ['Pedir', 'warn'], ok: ['OK', 'ok'], semnec: ['Não precisa agora', 'ok'], semest: ['Fora do estoque', 'muted'], obrig: ['🔒 Obrigatório', 'warn'] };
    const SITU = (r) => SITS[SITK(r)];
    // filtros extras (valem em qualquer aba): grupo, situação e classe
    const fx = state.pedFx || (state.pedFx = { g: '', s: '', c: '', m: '' });
    const multDe = (r) => (r.c && r.c.mult > 1 ? r.c.mult : 0);
    const passa = (r, sem) => (sem === 'm' || !fx.m || (fx.m === 'sim') === (multDe(r) > 0)) && (sem === 'g' || !fx.g || r.grupo === fx.g) && (sem === 's' || !fx.s || SITK(r) === fx.s) && (sem === 'c' || !fx.c || (r.classe || 'sem') === fx.c);
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
      seletor('m', 'Múltiplo', 'todos', [['sim', 'vende em múltiplos'], ['nao', 'unidade']], (r) => (multDe(r) ? 'sim' : 'nao')),
      fx.g || fx.s || fx.c || fx.m ? h('button', { type: 'button', class: 'btn ped-fx-limpa', onclick: () => { state.pedFx = { g: '', s: '', c: '', m: '' }; pintar(corpo, loja, M, e, p); } }, '✕ Tirar filtros') : null,
      h('span', { class: 'muted ped-fx-n' }, `${fmt.int(linhas.length)} ${linhas.length === 1 ? 'produto' : 'produtos'}`),
      // janela da classe oficial (a mesma do Estoque e margem): muda a classe e a prioridade "Estrela abaixo de 700 g"
      TS.eu && TS.eu.pode && TS.eu.pode.configurar && modo === 'repor'
        ? h('span', { class: 'ped-cl-meses', title: 'Classe oficial: a mediana do que cada produto vendeu por mês nestes meses fechados × a margem. Vale também na Rentabilidade' },
          h('span', { class: 'f-label' }, 'Classe pelos últimos'),
          TS.seg([['3', '3'], ['6', '6'], ['12 meses', '12']], String(R.classeMeses), async (v) => {
            try { await TS.salvarClasse(loja, { meses: +v }); pintar(corpo, loja, M, e, p); } catch (err) { alert(err.message); }
          }))
        : h('span', { class: 'muted ped-fx-n' }, `classe pelos últimos ${R.classeMeses} meses`));
    const totalAgora = R.linhas.reduce((s, r) => s + r.pedir * (r.preco || 0), 0);
    const sobra = R.orcamento != null ? R.orcamento - totalAgora : null;
    const MOBILE = matchMedia('(max-width: 760px)').matches;
    const cols = [
        { key: 'produto', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => h('span', null, r.produto, r.obrig ? h('span', { class: 'ped-tag-obr', title: 'Vem no pedido obrigatório: não vai para o carrinho' }, '🔒 obrigatório') : r.chega ? h('span', { class: 'ped-tag-obr', title: `O pedido obrigatório já traz ${qtdTxt(r.chega, r.it)} deste produto (já descontado do "Precisa"). O que estiver em "Pedir" é a mais e vai para o carrinho.` }, `+ ${qtdTxt(r.chega, r.it)} no obrigatório`) : null, r.esp ? h('a', { class: 'ped-prio ped-esp', href: '#espera', title: `Na lista de espera: ${r.esp.clientes.join(', ')}${r.esp.pedidos > r.esp.clientes.length ? '…' : ''}. Quando a nota chegar, eles aparecem para avisar.`, onclick: (e) => e.stopPropagation() }, `⏳ ${r.esp.pedidos} esperando`) : null, VAL.has(String(r.cod)) ? (() => { const v = VAL.get(String(r.cod)); return h('a', { class: 'pd-vl', href: '#validade', title: `${qtdTxt(v.kg, r.it)} em lote${v.dias < 0 ? ' já vencido' : ` que vence em ${v.dias} dias`}: venda o que tem antes de comprar mais (Estoque → Validade)`, onclick: (e) => e.stopPropagation() }, TS.validade.badge(v.faixa)); })() : null, r.prior && r.prior < 3 ? h('span', { class: 'ped-prio', title: r.prior === 2 ? 'Prioridade: estoque abaixo de 500 g' : 'Prioridade: Estrela com estoque abaixo de 700 g' }, r.prior === 2 ? '< 500 g' : 'Estrela < 700 g') : null, h('small', { class: 'est-tam' }, `cód. ${r.cod}`)) },
        { key: 'grupoTxt', label: 'Grupo', align: 'l' },
        { key: 'classe', label: 'Classe', align: 'l', title: `Classe oficial: o que sai por mês (a mediana dos últimos ${R.classeMeses} meses fechados, então um mês de promoção pesa pouco) × margem bruta, comparados com a mediana dos outros produtos. Não muda com o filtro de período. 🔒 = travada à mão na Rentabilidade. Estrela: vende muito e tem margem boa. Volume: vende muito, margem menor. Joia: margem boa, vende pouco. Peso morto: vende pouco e margem baixa`,
          render: (r) => (r.classe ? h('span', { class: 'ped-cl ped-cl-' + r.classe, title: r.classeFixa ? 'Travada à mão na Rentabilidade' : null }, (r.classeFixa ? '🔒 ' : '') + CLASSES[r.classe]) : h('span', { class: 'muted' }, '—')), sortVal: (r) => ({ estrela: 4, volume: 3, joia: 2, peso: 1 })[r.classe] || 0 },
        { key: 'sit', label: 'Situação', align: 'l', render: (r) => { const [t, c] = SITU(r); return h('span', { class: 'badge ' + c }, t); }, sortVal: (r) => (r.qtd <= 0 ? 3 : r.urgente ? 2 : 1) },
        { key: 'qtd', label: 'Estoque', render: (r) => qtdTxt(r.qtd, r.it) },
        { key: 'dias', label: 'Dura', fmt: (v) => (v == null ? '—' : v > 365 ? '+1 ano' : `${fmt.int(v)} dias`) },
        { key: 'sugerido', label: 'Precisa', title: 'Quanto precisa, arredondado ao múltiplo do site (chá a granel em quilo inteiro). Passe o mouse para ver a conta', render: (r) => h('span', { class: 'est-dica', title: r.conta }, qtdTxt(r.sugerido, r.it), (() => { const pv = r.it.un === 'Kg' ? r.precisa : Math.ceil(r.precisa - 1e-9); return (multDe(r) || r.it.un === 'Kg') && pv > 1e-3 && pv < r.sugerido - 1e-9 ? h('small', { class: 'est-tam' }, `pela venda: ${qtdTxt(pv, r.it)}`) : null; })()) },
        { key: 'pedir', label: 'Pedir', title: 'Quantidade do pedido: altere à vontade (0 tira do pedido). O total e a proporção se atualizam', render: (r) => campoQtd(r), sortVal: (r) => r.pedir },
        { key: 'preco', label: 'Preço', title: 'Preço no Sistema de Pedidos (FRANQUIAS); sem catálogo, o custo do AppNext', render: (r) => (r.preco ? h('span', { class: r.unidadeEstranha ? 'neg' : null, title: r.unidadeEstranha ? `Preço do site muito diferente do custo do AppNext (${fmt.brl(r.it.custo)}): confira a unidade.` : null }, fmt.brl(r.preco)) : '—'), sortVal: (r) => r.preco },
        { key: 'total', label: 'Total', render: (r) => { const s = h('span', { class: 'ped-tot' }, r.pedir > 0 ? fmt.brl(r.pedir * (r.preco || 0)) : '—'); r._tot = s; return s; }, sortVal: (r) => r.pedir * (r.preco || 0) },
        { key: 'lucroDia', label: 'Lucro sem fixos/dia', title: 'O que o produto deixou por dia nos últimos 30 dias depois do custo e das deduções variáveis (comissão, royalties, Simples, maquininha). É a prioridade do pedido: urgentes primeiro, depois quem deixa mais lucro', fmt: (v) => (v ? fmt.brl(v) : '—') },
        { key: 'motivo', label: 'Obs.', align: 'l', render: (r) => obs(r) },
      ];
    const col = (k) => cols.find((c) => c.key === k);
    const tab = TS.table({
      cols,
      rowClass: (r) => (r.obrig ? 'ped-row-obr' : null),
      rows: linhas, total: (() => {
        const ped = linhas.filter((r) => r.pedir > 0);
        if (!ped.length) return null;
        const un = ped.filter((r) => r.it.un !== 'Kg').reduce((s, r) => s + r.pedir, 0), kg = ped.filter((r) => r.it.un === 'Kg').reduce((s, r) => s + r.pedir, 0);
        return { produto: `Total · ${fmt.int(ped.length)} ${ped.length === 1 ? 'produto' : 'produtos'}`, pedir: [kg ? `${fmt.kg(kg)} kg` : '', un ? `${fmt.int(un)} un` : ''].filter(Boolean).join(' + '), total: fmt.brl(ped.reduce((s, r) => s + r.pedir * (r.preco || 0), 0)) };
      })(), sortKey: 'lucroDia', maxHeight: '620px', pageSize: linhas.length > 300 ? 200 : undefined, search: 'Buscar produto…', searchKeys: ['produto', 'cod'], produto: 'produto', imprimir: ['produto', 'grupoTxt', 'classe', 'sit', 'qtd', 'sugerido', 'pedir', 'preco', 'total'], cls: 'est-t ped-t',
      empty: { pedido: 'Nada no pedido.', fora: 'Nada ficou de fora.', indisp: 'Nenhum produto necessário está indisponível no site.', cat: 'Todos os produtos necessários estão no catálogo.', resto: 'Sem catálogo do Sistema de Pedidos: use "Atualizar catálogo".', todos: 'Nenhum produto.' }[filtro],
    });
    // ---------- celular: um cartão por produto, com o essencial e o − / ＋ ----------
    function listaMobile() {
      const box = h('div', { class: 'ped-cards' });
      const busca = h('input', { class: 'f-input ped-cards-busca', type: 'search', placeholder: 'Buscar produto ou código…', value: state.pedBuscaMob || '' });
      const ord = [...linhas].sort((a, b) => (b.pedir > 0) - (a.pedir > 0) || (b.prior || 0) - (a.prior || 0) || (b.qtd <= 0) - (a.qtd <= 0) || b.urgente - a.urgente || (b.lucroDia || 0) - (a.lucroDia || 0));
      let quantos = 40;
      const cartao = (r) => {
        const [t, c] = SITU(r);
        const tot = h('b', { class: 'ped-tot' }, r.pedir > 0 ? fmt.brl(r.pedir * (r.preco || 0)) : '—');
        r._tot = tot;
        return h('div', { class: 'ped-card' + (r.obrig ? ' obr' : r.pedir > 0 ? ' on' : '') },
          h('div', { class: 'ped-card-top' }, h('div', { class: 'ped-card-nome' }, col('produto').render(r)), h('span', { class: 'badge ' + c }, t)),
          h('div', { class: 'ped-card-meta' }, r.grupoTxt, r.classe ? [' · ', col('classe').render(r)] : null),
          h('div', { class: 'ped-card-nums' },
            h('div', null, h('small', null, 'Estoque'), h('b', null, qtdTxt(r.qtd, r.it))),
            h('div', null, h('small', null, 'Dura'), h('b', null, r.dias == null ? '—' : r.dias > 365 ? '+1 ano' : `${fmt.int(r.dias)} d`)),
            h('div', null, h('small', null, 'Precisa'), col('sugerido').render(r))),
          h('div', { class: 'ped-card-ped' }, campoQtd(r), h('div', { class: 'ped-card-val' }, h('small', null, r.preco ? `${fmt.brl(r.preco)} /${unid(r.it)}` : 'sem preço'), tot)),
          h('div', { class: 'ped-card-obs' }, obs(r)));
      };
      const desenhar = () => {
        const q = TS.norm(busca.value.trim());
        const xs = q ? ord.filter((r) => TS.norm(r.produto + ' ' + r.cod).includes(q)) : ord;
        box.replaceChildren(...xs.slice(0, quantos).map(cartao),
          xs.length > quantos ? h('button', { type: 'button', class: 'btn ped-cards-mais', onclick: () => { quantos += 60; desenhar(); } }, `Mostrar mais (${fmt.int(xs.length - quantos)})`) : null,
          !xs.length ? h('p', { class: 'muted' }, 'Nenhum produto aqui.') : null);
      };
      busca.addEventListener('input', TS.debounce(() => { state.pedBuscaMob = busca.value; quantos = 40; desenhar(); }, 250));
      desenhar();
      return h('div', null, busca, box);
    }

    // observação de cada linha, conforme o pedido de agora (muda quando você põe, tira ou limpa)
    function obs(r) {
      if (r.obrig) return h('span', { class: 'warn-t', title: r.conta }, 'pedido obrigatório (não vai no carrinho)');
      if (r.chega) {
        const base = obsBase(r);
        return h('span', null, base, h('small', { class: 'est-tam warn-t' }, r.pedir > 0 ? `a mais do que vem no obrigatório (${qtdTxt(r.chega, r.it)})` : `o obrigatório já traz ${qtdTxt(r.chega, r.it)}`));
      }
      return obsBase(r);
    }
    function obsBase(r) {
      if (r.site === 'indisp') return h('span', { class: 'neg' }, 'indisponível no site (R$ 0,01)');
      if (r.site === 'fora') return h('span', { class: 'muted' }, 'não está no catálogo FRANQUIAS');
      if (editados.has(String(r.cod))) {
        if (!(r.pedir > 0)) return h('span', { class: 'muted' }, 'tirado por você');
        return h('span', { class: 'pos' }, r.sugeridoPedir > 0 ? `alterado por você (sugestão ${qtdTxt(r.sugeridoPedir, r.it)})` : 'adicionado por você');
      }
      if (r.extra) return h('span', { class: 'muted', title: r.conta }, r.pedir > 0 ? 'adicionado por você' : r.semEstoque ? 'não está no estoque: peça à mão' : 'não precisa agora: peça à mão se quiser');
      if (r.pedir > 0) return h('span', { class: r.motivo === 'parcial' ? 'warn-t' : 'muted' }, r.motivo === 'parcial' ? `parte da necessidade (precisa ${qtdTxt(r.sugerido, r.it)})` : 'sugerido');
      if (sobra == null) return '';
      const custo = r.sugerido * (r.preco || 0);
      return sobra >= custo
        ? h('span', { class: 'pos' }, `cabe no valor (sobram ${fmt.brl0(sobra)}): use ＋`)
        : h('span', { class: 'warn-t' }, `passa do valor em ${fmt.brl0(custo - Math.max(0, sobra))}`);
    }
    /** redesenha mantendo a rolagem da tabela e da página */
    function repintar() {
      const tw = corpo.querySelector('.ped-t')?.closest('.table-wrap');
      const st = tw ? tw.scrollTop : 0, y = window.scrollY;
      pintar(corpo, loja, M, e, p, R);
      const tw2 = corpo.querySelector('.ped-t')?.closest('.table-wrap');
      if (tw2) tw2.scrollTop = st;
      window.scrollTo(0, y);
    }
    function campoQtd(r) {
      if (r.obrig) return h('span', { class: 'ped-obr-q', title: 'Vem no pedido obrigatório da franquia: não muda aqui (edite em "Pedido obrigatório")' }, `🔒 ${qtdTxt(r.pedir, r.it)}`);
      if (r.site !== 'ok' && r.site !== 'sem') return '—';
      const passo = passoDe(r.c, r.it);
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
        // redesenha: valor do pedido, sobra, abas, proporção e observações. Se saiu da aba, a linha some
        const sai = !FILTROS[filtro][1](r);
        if (sai) { const tr = i.closest('tr, .ped-card'); if (tr) tr.classList.add('ped-sai'); }
        clearTimeout(repintar.t);
        repintar.t = setTimeout(repintar, sai ? 260 : 0);
      };
      i.addEventListener('change', () => definir(Math.max(0, +i.value || 0)));
      // mousedown sem tirar o foco do campo: assim o número digitado não é aplicado antes e o botão faz o que mostra
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', () => {
        const digitado = Math.max(0, +i.value || 0);
        if (digitado > 0 && digitado !== r.pedir) definir(digitado); // digitou e clicou: coloca a quantidade digitada
        else definir(r.pedir > 0 ? 0 : (r.sugerido || passo));
      });
      i.addEventListener('input', () => { const d = Math.max(0, +i.value || 0); if (d > 0 && d !== r.pedir) { b.className = 'ped-ab poe'; b.textContent = '＋'; b.title = `Colocar ${i.value} no pedido`; } else pintarB(); });
      pintarB();
      const mult = multDe(r);
      const chip = mult ? h('span', { class: 'ped-mult', title: `No site só dá para pedir de ${fmt.n2(mult).replace(/,00$/, '')} em ${fmt.n2(mult).replace(/,00$/, '')}${r.c.max ? ` (máximo ${fmt.n2(r.c.max).replace(/,00$/, '')})` : ''}. A quantidade é arredondada para cima.` }, `×${fmt.n2(mult).replace(/,00$/, '')}`) : null;
      if (MOBILE) {
        // celular: − e ＋ grandes (de um passo do site), o número no meio
        const menos = h('button', { type: 'button', class: 'ped-step', 'aria-label': 'Menos', onclick: () => definir(Math.max(0, Math.round((r.pedir - passo) * 1000) / 1000)) }, '−');
        const mais = h('button', { type: 'button', class: 'ped-step', 'aria-label': 'Mais', onclick: () => definir(r.pedir > 0 ? Math.round((r.pedir + passo) * 1000) / 1000 : (r.sugerido || passo)) }, '＋');
        i.setAttribute('inputmode', 'decimal');
        return h('span', { class: 'ped-q-w ped-q-mob' }, menos, i, mais, h('small', null, unid(r.it)), chip);
      }
      return h('span', { class: 'ped-q-w' }, i, h('small', null, unid(r.it)), chip, b);
    }
    const catInfo = p.catalogo
      ? `Preços e disponibilidade do Sistema de Pedidos de ${new Date(p.catalogo.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.`
      : 'Ainda não há catálogo do Sistema de Pedidos: os preços são o custo do AppNext e não dá para saber o que está indisponível.';
    const sub = modo === 'repor'
      ? `Compra só o que precisa para ${R.ent} dias de entrega + ${R.N} dias até o próximo pedido, com a época do ano. Urgentes primeiro; depois quem deixa mais lucro sem fixos por dia. ${catInfo}`
      : `O que vendeu no ${R.ev.nome} do ano passado × crescimento, + o consumo normal até lá − estoque. Sem limite de valor: ajuste as quantidades. ${catInfo}`;
    const btnCsv = h('button', { type: 'button', class: 'btn', title: 'O pedido como está na tela (sem o pedido obrigatório, que a franquia já manda)', onclick: () => baixarCsv(R.linhas.filter((r) => r.pedir > 0 && !r.obrig), loja) }, '⬇ CSV');
    // Limpar: zera as quantidades do pedido (tudo ou um grupo); "Voltar à sugestão" desfaz
    const zerar = (g) => {
      for (const r of R.linhas) if ((r.site === 'ok' || r.site === 'sem') && (!g || r.grupo === g) && r.pedir > 0) { r.pedir = 0; if (r.sugeridoPedir === 0) editados.delete(String(r.cod)); else editados.set(String(r.cod), 0); }
      repintar();
    };
    // usa o que sobrou do valor nos produtos que ainda precisam, na mesma prioridade da sugestão
    // (não mexe no que você tirou à mão nem nos grupos que você limpou)
    function completarCandidatos() {
      return R.linhas.filter((r) => (r.site === 'ok' || r.site === 'sem') && r.preco > 0 && r.pedir < r.sugerido && !(editados.has(String(r.cod)) && editados.get(String(r.cod)) === 0));
    }
    function completar() {
      if (sobra == null) return;
      let livre = sobra;
      const prio = (a, b) => ((b.prior || 0) - (a.prior || 0)) || (b.urgente - a.urgente) || (b.lucroDia - a.lucroDia);
      for (const r of completarCandidatos().sort(prio)) {
        if (livre <= 0.5) break;
        const passo = passoDe(r.c, r.it);
        const falta = r.sugerido - r.pedir;
        let q = falta * r.preco <= livre + 0.005 ? falta : Math.floor(livre / (passo * r.preco) + 1e-9) * passo;
        if (q <= 0) continue;
        r.pedir = Math.round((r.pedir + q) * 1000) / 1000;
        livre -= q * r.preco;
        if (r.pedir === r.sugeridoPedir) editados.delete(String(r.cod)); else editados.set(String(r.cod), r.pedir);
      }
      repintar();
    }
    const noGrupo = (g) => R.linhas.filter((r) => r.pedir > 0 && (!g || r.grupo === g));
    const opLimpar = (rot, g) => { const l = noGrupo(g); return h('button', { type: 'button', disabled: !l.length || null, onclick: () => zerar(g) }, rot, h('small', null, l.length ? `${fmt.int(l.length)} · ${fmt.brl0(l.reduce((s, r) => s + r.pedir * (r.preco || 0), 0))}` : 'vazio')); };
    const menuLimpar = h('details', { class: 'ped-menu' }, h('summary', { class: 'btn' }, 'Limpar ▾'),
      h('div', { class: 'ped-menu-l' },
        (() => {
          const cand = completarCandidatos();
          return h('button', { type: 'button', class: 'ped-menu-completa', disabled: !(sobra > 1 && cand.length) || null, onclick: completar },
            'Completar com a sobra', h('small', null, sobra > 1 ? `${fmt.brl0(sobra)} livres` : 'sem sobra'));
        })(),
        opLimpar('Limpar tudo', null),
        ...['cha', 'env', 'acess', 'insumo'].filter((g) => R.linhas.some((r) => r.grupo === g)).map((g) => opLimpar(`Limpar ${GRUPOS[g].toLowerCase()}`, g)),
        h('button', { type: 'button', class: 'ped-menu-volta', disabled: !editados.size || null, onclick: () => { editados.clear(); pintar(corpo, loja, M, e, p); } }, 'Voltar à sugestão', h('small', null, editados.size ? `${editados.size} alterado(s)` : 'nada alterado'))));
    const foraMenu = (x) => { if (!menuLimpar.contains(x.target)) menuLimpar.open = false; };
    menuLimpar.addEventListener('toggle', () => { if (menuLimpar.open) document.addEventListener('mousedown', foraMenu); else document.removeEventListener('mousedown', foraMenu); });
    const obrN = R.linhas.filter((r) => r.obrig).length;
    const avisoObr = obrN ? h('div', { class: 'ped-obr-aviso' }, h('b', null, `🔒 Pedido obrigatório: ${fmt.int(obrN)} produtos · ${fmt.brl0(R.obTotal)}`),
      ' — a franquia manda de qualquer forma. Eles ', h('b', null, 'não vão para o carrinho'), ' (pedir de novo duplicaria). Ficam na aba "🔒 Obrigatório"; as outras abas mostram só o que você compra. ',
      filtro !== 'obrig' ? h('button', { type: 'button', class: 'link-btn', onclick: () => { state.pedFiltro = 'obrig'; pintar(corpo, loja, M, e, p); } }, 'Ver o obrigatório') : null) : null;
    corpo.append(h('div', { class: 'mt' }, TS.cardWithTools('Produtos', sub,
      h('div', { class: 'est-tools ped-tools' }, !MOBILE && tab.searchBox && (tab.searchBox.classList.add('est-busca'), tab.searchBox),
        TS.seg(Object.entries(FILTROS).map(([k, [t]]) => [`${t} (${cont(k)})`, k]), filtro, (v) => { state.pedFiltro = v; pintar(corpo, loja, M, e, p); }), menuLimpar, btnCsv),
      avisoObr, MOBILE ? h('details', { class: 'ped-fx-mob', open: (fx.g || fx.s || fx.c || fx.m) ? true : null }, h('summary', null, `Filtros${[fx.g, fx.s, fx.c, fx.m].filter(Boolean).length ? ` (${[fx.g, fx.s, fx.c, fx.m].filter(Boolean).length})` : ''} · ${fmt.int(linhas.length)} produtos`), filtrosExtra) : filtrosExtra, MOBILE ? listaMobile() : tab)));
    if (editados.size) corpo.append(h('p', { class: 'muted' }, `${editados.size} quantidade(s) alterada(s) à mão. `, h('a', { href: '#', onclick: (x) => { x.preventDefault(); editados.clear(); pintar(corpo, loja, M, e, p); } }, 'Voltar à sugestão')));

    corpo.append(h('div', { class: 'mt ped-robo' }, cartaoRobo(corpo, loja, M, e, p, R)));
    if (barra) { pintarBarra(); corpo.append(barra); corpo.classList.add('com-barra'); }
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

  /** topo da tela: de quando é o estoque do AppNext + "Atualizar estoque" (só o admin roda o coletor) com o andamento e o log */
  function blocoEstoque(loja, e) {
    const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const em = e.estoque && e.estoque.em;
    const horas = em ? (Date.now() - Date.parse(em)) / 36e5 : null;
    const ha = horas == null ? '' : horas < 1 ? `há ${Math.max(1, Math.round(horas * 60))} min` : horas < 48 ? `há ${Math.round(horas)} h` : `há ${Math.round(horas / 24)} dias`;
    const info = h('div', { class: 'ped-cat-info' }, em ? h('span', { class: horas > 12 ? 'neg' : null }, 'Estoque do AppNext: ', h('b', null, quando(em)), ` (${ha})`) : h('span', { class: 'neg' }, 'Sem data do estoque'));
    const st = h('div', { class: 'ped-cat-st' });
    if (TS.eu?.perfil !== 'admin' || TS.demo) return { info, st, acao: null };
    const btn = h('button', { type: 'button', class: 'btn' }, '↻ Atualizar estoque');
    const desenhar = (x) => {
      const ex = x && x.execucao;
      if (!ex) { st.replaceChildren(); return; }
      if (ex.estado === 'na_fila' || ex.estado === 'rodando') {
        btn.disabled = true;
        st.replaceChildren(h('div', { class: 'ped-est-vivo' }, h('div', null, h('span', { class: 'cfg-pulso' }), ' ', h('b', null, ex.estado === 'rodando' ? 'Buscando o estoque no AppNext…' : 'Na fila do robô…'),
          h('small', { class: 'muted' }, ` ${ex.itens && ex.itens.length ? 'só ' + ex.itens.join(', ') : 'atualização completa'} · leva de 1 a 4 min; a tela recarrega sozinha`)),
          ex.aoVivo && ex.aoVivo.length ? h('pre', { class: 'ped-log' }, ex.aoVivo.slice(-12).join('\n')) : null));
        return;
      }
      btn.disabled = false;
      if (ex.estado === 'falhou') st.replaceChildren(h('div', null, h('span', { class: 'neg' }, `A última atualização (${ex.fim ? quando(ex.fim) : ''}) falhou.`),
        ex.log && ex.log.length ? h('details', { class: 'ped-cat-log' }, h('summary', null, 'ver o log'), h('pre', { class: 'ped-log' }, ex.log.join('\n'))) : null));
      else st.replaceChildren();
    };
    let vigiando = false;
    const vigiar = async (antes) => {
      if (vigiando) return; vigiando = true;
      for (let k = 0; k < 150 && btn.isConnected; k++) {
        let x = null;
        try { x = await (await fetch('/api/script?loja=' + encodeURIComponent(loja), { credentials: 'same-origin' })).json(); } catch { /* tenta de novo */ }
        if (!btn.isConnected) break;
        desenhar(x);
        const ex = x && x.execucao;
        if (ex && ex.estado !== 'na_fila' && ex.estado !== 'rodando' && (k > 0 || antes)) {
          if (ex.estado === 'ok') { try { await TS.estoqueBuscar(loja, true); } catch { /* fica o que tinha */ } if (btn.isConnected) TS.render(); }
          break;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
      vigiando = false;
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = await fetch('/api/script?loja=' + encodeURIComponent(loja), { method: 'POST', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ itens: ['estoque'] }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok && r.status !== 409) throw new Error(j.erro || 'Falha.');
        desenhar({ execucao: { estado: 'na_fila', itens: ['estoque'] } });
        vigiar(true);
      } catch (err) { st.replaceChildren(h('span', { class: 'neg' }, err.message)); btn.disabled = false; }
    });
    // já tem uma atualização rodando? mostra o andamento
    fetch('/api/script?loja=' + encodeURIComponent(loja), { credentials: 'same-origin' }).then((r) => r.json()).then((x) => {
      if (!btn.isConnected) return;
      const ex = x && x.execucao;
      if (ex && (ex.estado === 'na_fila' || ex.estado === 'rodando')) { desenhar(x); vigiar(true); } else if (ex && ex.estado === 'falhou') desenhar(x);
    }).catch(() => null);
    return { info, st, acao: btn };
  }

  /** topo da tela: "Atualizar catálogo" + data da última leitura (preço, disponível e múltiplo do site) */
  function blocoCatalogo(corpo, loja, M, e, p) {
    const robo = p.robo || {};
    const ocupado = robo.estado === 'na_fila' || robo.estado === 'rodando';
    const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const st = h('div', { class: 'ped-cat-st' }, ocupado ? progressoCat(robo) : null);
    if (ocupado) acompanhar(corpo, loja, M, e);
    const u = robo.ultima;
    const info = h('div', { class: 'ped-cat-info' },
      p.catalogo ? h('span', null, 'Catálogo do site: ', h('b', null, quando(p.catalogo.em))) : h('span', { class: 'neg' }, 'Ainda não há catálogo do site'),
      u && !u.ok ? h('span', { class: 'neg' }, ` · a última leitura (${quando(u.fim)}) falhou`) : null,
      u && !u.ok && u.log ? h('details', { class: 'ped-cat-log' }, h('summary', null, 'ver o log'), h('pre', { class: 'ped-log' }, u.log.join('\n'))) : null);
    let acao = null;
    if (!robo.disponivel) acao = h('small', { class: 'muted' }, robo.erro ? `Coletor indisponível: ${robo.erro}` : 'O catálogo é lido pelo coletor da VPS.');
    else if (!robo.temLogin) acao = h('small', null, 'Falta o login do Sistema de Pedidos: ', p.podeRobo ? h('a', { href: '#config' }, 'Configurações → Lojas') : 'peça ao administrador');
    else if (p.podeRobo) {
      const btn = h('button', { type: 'button', class: 'btn primary', disabled: ocupado || null, title: 'Lê de novo no site o preço, o que está disponível e o múltiplo de cada produto. Também é lido sozinho toda noite.' }, '↻ Atualizar catálogo');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const r = await fetch(`/api/pedido/robo?loja=${encodeURIComponent(loja)}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'catalogo' }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.erro || 'Falha.');
          st.replaceChildren(progressoCat({ estado: 'na_fila' }));
          acompanhar(corpo, loja, M, e);
        } catch (err) { st.replaceChildren(h('span', { class: 'neg' }, err.message)); btn.disabled = false; }
      });
      acao = btn;
    }
    return { acao, info, st };
  }

  // ---------- carrinho no Sistema de Pedidos ----------
  function cartaoRobo(corpo, loja, M, e, p, R) {
    const robo = p.robo || {};
    const ativo = carrinhoAtivo(p.carrinho);
    const msg = h('div', { class: 'muted' });
    const statusBox = h('div', { class: 'ped-status' }, ativo ? progresso(p.carrinho) : null);
    if (ativo) acompanhar(corpo, loja, M, e);

    // 1) montar: gera o código e abre o site em outra aba (aberta já no clique, para o navegador não bloquear)
    // a lista é lida NA HORA do clique: vale o que está no pedido agora (com o que você pôs, tirou ou limpou)
    const doPedido = () => R.linhas.filter((r) => r.pedir > 0 && r.site === 'ok');
    const n0 = doPedido().length;
    const btnCarrinho = h('button', { type: 'button', class: 'btn primary', disabled: !n0 || null }, `Montar carrinho no site (${n0} produtos)`);
    btnCarrinho.addEventListener('click', async () => {
      const itens = doPedido();
      if (!itens.length) { msg.className = 'neg'; msg.textContent = 'Nada no pedido.'; return; }
      const semCat = R.linhas.filter((r) => r.pedir > 0 && r.site === 'sem').length;
      const nOb = R.linhas.filter((r) => r.obrig).length;
      if (!confirm(`Vão para o carrinho ${itens.length} produtos, ${fmt.brl(itens.reduce((s, r) => s + r.pedir * (r.preco || 0), 0))} (o pedido como está agora na tela).${semCat ? `\n${semCat} sem catálogo ficam de fora.` : ''}${nOb ? `\nO pedido obrigatório (${nOb} produtos) não vai: a franquia já manda.` : ''}\n\nContinuar?`)) return;
      const aba = window.open('about:blank', '_blank');
      btnCarrinho.disabled = true; msg.className = 'muted'; msg.textContent = 'Preparando…';
      try {
        const r = await fetch(`/api/pedido/carrinho?loja=${encodeURIComponent(loja)}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ itens: itens.map((x) => ({ cod: x.cod, qtd: x.pedir })) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha.');
        if (aba) aba.location.href = j.url; else window.open(j.url, '_blank');
        msg.className = j.fora && j.fora.length ? 'neg' : 'muted';
        msg.textContent = j.fora && j.fora.length ? `${j.fora.length} produto(s) não estão disponíveis no catálogo e ficaram de fora: atualize o catálogo.` : '';
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
    // no celular não dá para arrastar: copia o código e cria o favorito à mão (uma vez só)
    const msgCel = h('span', { class: 'muted' });
    const celular = h('details', { class: 'ped-cel', open: matchMedia('(max-width: 760px)').matches || null },
      h('summary', null, '📱 No celular (Chrome no Android ou Safari no iPhone)'),
      h('div', { class: 'ped-cel-c' },
        h('p', null, h('b', null, 'Uma vez só, criar o favorito: '),
          h('button', { type: 'button', class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(linkFavorito()); msgCel.textContent = 'Copiado.'; } catch { msgCel.textContent = 'Não consegui copiar: segure o dedo no texto abaixo e copie.'; } } }, '📋 Copiar o código do favorito'), ' ', msgCel),
        h('ol', null,
          h('li', null, h('b', null, 'Android (Chrome): '), 'abra qualquer página, toque em ⋮ → ☆ (favoritar) → Editar. Troque o nome para ', h('b', null, 'carrinhots'), ' e cole o código no lugar do endereço. Salve.'),
          h('li', null, h('b', null, 'iPhone (Safari): '), 'toque em Compartilhar → Adicionar Favorito → Salvar. Depois abra os Favoritos, toque em Editar, abra esse favorito, troque o nome para ', h('b', null, 'carrinhots'), ' e cole o código no endereço.')),
        h('p', null, h('b', null, 'Para montar: '), 'toque em "Montar carrinho no site". Na aba do Sistema de Pedidos, ', h('b', null, 'Android:'), ' digite ', h('b', null, 'carrinhots'), ' na barra de endereço e toque no favorito que aparece (com a estrela). ', h('b', null, 'iPhone:'), ' abra os Favoritos e toque em carrinhots.'),
        h('p', { class: 'muted' }, 'Funciona igual ao computador: coloca os produtos no carrinho da sua sessão e para na etapa 2. A tela do Sistema de Pedidos é pequena no celular: confira o carrinho com calma antes de finalizar.'),
        h('textarea', { class: 'f-input ped-cel-cod', rows: 3, readonly: true, onclick: (ev) => ev.target.select() }, linkFavorito())));

    const semCatalogo = !p.catalogo;
    return TS.card('Carrinho no Sistema de Pedidos', 'O carrinho do site vale só para a sessão de quem entrou; por isso ele é montado no seu navegador, com o seu login. O favorito procura cada produto pelo nome, confere o nome exato, ajusta ao múltiplo e coloca no carrinho. Ele para na etapa 2.',
      semCatalogo ? h('div', { class: 'notice' }, 'Leia o catálogo primeiro (botão "Atualizar catálogo", no topo): só vão para o carrinho os produtos disponíveis no site.') : null,
      passos, celular,
      (() => {
        const ob = R.linhas.filter((r) => r.obrig);
        if (!ob.length) return null;
        const v = ob.reduce((s2, r) => s2 + r.pedir * (r.preco || 0), 0);
        return h('div', { class: 'ped-obr-aviso' }, h('b', null, `🛒 Vão para o carrinho só os ${fmt.int(n0)} produtos que você compra.`), ` O pedido obrigatório (${fmt.int(ob.length)} produtos, ${fmt.brl0(v)}) não vai: a franquia já manda e pedir de novo duplicaria. Produto que está no obrigatório e também aparece no seu pedido vai só com a quantidade a mais.`, R.novoCompo ? R.novoCompo() : null);
      })(),
      h('div', { class: 'cfg-acoes' }, btnCarrinho), msg, statusBox,
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
    const quando = new Date(c.inicio).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    // registro do carrinho anterior: fechado, para não parecer que vai junto com o pedido de agora
    const recente = Date.now() - Date.parse(c.inicio) < 2 * 3600e3; // acabou de montar: fica aberto para conferir
    return h('details', { class: 'ped-ult mt', open: recente || null },
      h('summary', null, h('b', null, '🕘 Histórico: carrinho montado em ' + quando), c.por ? ` por ${c.por}` : '', ` · ${ok} de ${c.total || c.itens.length} produtos`,
        h('small', { class: 'muted' }, ' — registro do que já foi feito: não entra no pedido de agora')),
      h('p', { class: 'muted ped-ult-nota' }, 'É só o registro da última vez que o favorito montou o carrinho no site. O pedido de agora é o da tabela acima: ao clicar em "Montar carrinho no site", o favorito coloca esses produtos (se o carrinho do site ainda tiver itens antigos, confira lá antes de finalizar).'),
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
        if (box && car) box.replaceChildren(progresso(p.carrinho));
        const bc = corpo.querySelector('.ped-cat-st');
        if (bc && cat) bc.replaceChildren(progressoCat(p.robo));
      } catch { /* tenta de novo */ }
      poll = setTimeout(tic, 3000);
    };
    poll = setTimeout(tic, 3000);
  }

  // ---------- pedido obrigatório da franquia ----------
  async function salvarObrig(loja, corpoReq) {
    const r = await fetch(TS.api(`pedido/obrigatorio?loja=${encodeURIComponent(loja)}`), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify(corpoReq) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não consegui salvar.');
    return j.obrigatorio;
  }
  const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  function cartaoObrigatorio(corpo, loja, M, e, p, R) {
    const lista = (p.obrigatorio && p.obrigatorio.lista) || [];
    const refazer = (ob) => { p.obrigatorio = ob; pintar(corpo, loja, M, e, p); };
    const msg = h('span', { class: 'muted' });
    const acao = (rot, fn, cls) => h('button', { type: 'button', class: cls || 'btn', onclick: async () => { try { msg.className = 'muted'; msg.textContent = ''; const ob = await fn(); if (ob) refazer(ob); } catch (err) { msg.className = 'neg'; msg.textContent = err.message; } } }, rot);
    const valor = (o) => o.itens.reduce((s, x) => s + x.qtd * (x.preco ?? precoDe(p, M, x.cod) ?? 0), 0);
    const linha = (o) => h('div', { class: 'ped-obr ' + (o.ativo ? 'on' : 'off') },
      h('div', null, h('b', null, (o.ativo ? '🔒 ' : '') + o.nome),
        h('div', { class: 'muted' }, `${fmt.int(o.itens.length)} produtos · ${fmt.brl0(valor(o))}${o.ate ? ` · vale até ${dataBR(o.ate)}` : ''}${o.encerrado ? ' · encerrado' : !o.ativo ? ' · venceu' : ''}${o.por ? ` · por ${o.por}` : ''}`)),
      h('div', { class: 'ped-obr-ac' },
        acao('Editar', async () => { editarObrig(loja, p, M, o, refazer); return null; }),
        o.ativo ? acao('Já chegou · encerrar', () => (confirm(`Encerrar "${o.nome}"? Ele para de contar no pedido (o estoque do AppNext já terá a mercadoria).`) ? salvarObrig(loja, { id: o.id, encerrar: true }) : null))
          : acao('Reabrir', () => salvarObrig(loja, { id: o.id, reabrir: true })),
        acao('Apagar', () => (confirm(`Apagar "${o.nome}"?`) ? salvarObrig(loja, { id: o.id, apagar: true }) : null), 'btn ped-obr-del')));
    const ativos = lista.filter((o) => o.ativo), antigos = lista.filter((o) => !o.ativo);
    const sub = R.obTotal
      ? `A franquia manda de qualquer forma: ${fmt.brl0(R.obTotal)} já ocupam o valor do pedido e as quantidades contam como estoque chegando. Esses itens não vão para o carrinho.`
      : 'Quando a franquia avisar do pedido obrigatório, cadastre aqui: o valor sai do limite do pedido e as quantidades contam como estoque chegando, para não pedir duas vezes.';
    return TS.cardWithTools('Pedido obrigatório', sub, h('button', { type: 'button', class: 'btn primary', onclick: () => editarObrig(loja, p, M, null, refazer) }, '＋ Pedido obrigatório'),
      ...(ativos.length ? ativos.map(linha) : [h('p', { class: 'muted' }, 'Nenhum pedido obrigatório valendo agora.')]),
      antigos.length ? h('details', { class: 'ped-obr-ant' }, h('summary', null, `Anteriores (${antigos.length})`), ...antigos.map(linha)) : null, msg);
  }
  /** preço de um produto: catálogo do Sistema de Pedidos (disponível) ou custo do AppNext */
  function precoDe(p, M, cod) {
    const c = ((p.catalogo && p.catalogo.itens) || []).find((x) => String(x.cod) === String(cod));
    if (c && c.disp) return c.preco;
    const it = M.porCod.get(String(cod));
    return it && it.custo ? it.custo : null;
  }
  /** produtos conhecidos: catálogo + estoque, para a busca e para ler a mensagem colada */
  function conhecidos(p, M) {
    const m = new Map();
    for (const c of (p.catalogo && p.catalogo.itens) || []) m.set(String(c.cod), { cod: String(c.cod), nome: c.nome, un: '' });
    for (const it of M.porCod.values()) { const k = String(it.cod); const x = m.get(k) || { cod: k, nome: it.desc }; x.un = it.un; if (!x.nome) x.nome = it.desc; m.set(k, x); }
    return m;
  }
  const normT = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  /** lê a mensagem da franquia. Aceita a tabela copiada do e-mail ou do Excel (uma célula por linha, ou separada por tab)
   *  e o texto livre (código, nome, quantidade e valor na mesma linha). */
  const RE_COD = /^\d{3,7}(?:\.[A-Za-z0-9]{1,4})?$/;
  const RE_PRECO = /R\$\s*([\d.]+,\d{2})/i;
  const valorDe = (t) => { const m = String(t).match(RE_PRECO) || String(t).match(/^\s*([\d.]+,\d{2})\s*$/); return m ? +m[1].replace(/\./g, '').replace(',', '.') : null; };
  const ehQtd = (t) => /^\d+(?:[.,]\d{1,3})?$/.test(String(t).trim()) && valorDe(t) == null;
  function lerTabela(txt, K) {
    const linhas = String(txt || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // com tab: cada linha é um produto (colado do Excel); sem tab: uma célula por linha (colado do e-mail)
    const celulas = linhas.some((l) => l.includes('\t')) ? null : linhas;
    const registros = [];
    if (!celulas) {
      for (const l of linhas) {
        const cs = l.split('\t').map((c) => c.trim()).filter(Boolean);
        const cod = cs.find((c) => RE_COD.test(c) && (K.has(c) || /^\d{4,7}$/.test(c)));
        if (!cod) continue;
        registros.push({ cod, partes: cs.filter((c) => c !== cod) });
      }
    } else {
      let atual = null;
      celulas.forEach((c, k) => {
        // começa um produto quando a célula é um código (conhecido, ou 4 a 7 dígitos) e a próxima é o nome
        if (RE_COD.test(c) && (K.has(c) || /^\d{4,7}$/.test(c)) && /[A-Za-zÀ-ú]/.test(celulas[k + 1] || '')) { atual = { cod: c, partes: [] }; registros.push(atual); return; }
        if (atual) atual.partes.push(c);
      });
    }
    const achados = [];
    for (const r of registros) {
      const nome = r.partes.filter((t) => !ehQtd(t) && valorDe(t) == null && /[A-Za-zÀ-ú]/.test(t)).join(' ').trim();
      const qtdT = r.partes.find((t) => ehQtd(t) && valorDe(t) == null);
      const precoT = r.partes.find((t) => valorDe(t) != null);
      const q = qtdT != null ? +String(qtdT).replace(',', '.') : null;
      if (!(q > 0)) continue;
      const k = K.get(r.cod);
      achados.push({ cod: r.cod, nome: k ? k.nome : nome, qtd: q, preco: precoT != null ? valorDe(precoT) : null, novo: !k, nomeMsg: nome });
    }
    return achados;
  }
  function lerMensagem(txt, K) {
    const tab = lerTabela(txt, K);
    if (tab.length) return { achados: tab, nao: [] };
    return lerLinhas(txt, K);
  }
  /** texto livre: em cada linha, o código (ou o nome) de um produto conhecido, a quantidade e, se houver, o valor */
  function lerLinhas(txt, K) {
    const achados = [], nao = [];
    const nomes = [...K.values()].filter((x) => x.nome && x.nome.length >= 5).sort((a, b) => b.nome.length - a.nome.length);
    for (const bruta of String(txt || '').split(/\r?\n/)) {
      const l = bruta.trim();
      if (!l || !/\d/.test(l)) continue;
      // valor: "R$ 12,34" (ou o número com 2 casas depois de "valor"/"unit")
      let preco = null;
      const mp = l.match(/R\$\s*([\d.]+,\d{2})/i) || l.match(/(?:valor|unit[áa]rio|pre[çc]o)\D{0,10}([\d.]+,\d{2})/i);
      if (mp) preco = +mp[1].replace(/\./g, '').replace(',', '.');
      const semPreco = l.replace(/R\$\s*[\d.]+,\d{2}/gi, ' ');
      // código: um número (ou 29114.CX) que exista no catálogo/estoque
      const toks = semPreco.match(/\b\d+(?:\.[A-Za-z0-9]+)?\b/g) || [];
      let item = null, codTok = null;
      for (const t of toks) if (K.has(t)) { item = K.get(t); codTok = t; break; }
      if (!item) { const n = normT(semPreco); item = nomes.find((x) => n.includes(normT(x.nome))) || null; }
      if (!item) { nao.push(l); continue; }
      // quantidade: número com unidade (un, und, kg, x, pç) ou "qtd 6"; senão o último número inteiro que não é o código
      const resto = codTok ? semPreco.replace(codTok, ' ') : semPreco.replace(new RegExp(item.nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
      let q = null;
      const mq = resto.match(/(?:qtd|quant(?:idade)?)\D{0,6}(\d+(?:[.,]\d+)?)/i) || resto.match(/(\d+(?:[.,]\d+)?)\s*(?:un\b|und|unid|kg|pç|pc|pcs|x\b)/i) || resto.match(/\bx\s*(\d+(?:[.,]\d+)?)/i);
      if (mq) q = +mq[1].replace(',', '.');
      else { const ns = (resto.match(/\b\d+(?:,\d+)?\b/g) || []).map((x) => +x.replace(',', '.')).filter((x) => x > 0 && x < 10000); if (ns.length) q = ns[ns.length - 1]; }
      if (!(q > 0)) { nao.push(l); continue; }
      achados.push({ cod: item.cod, nome: item.nome, qtd: q, preco });
    }
    return { achados, nao };
  }
  function editarObrig(loja, p, M, o, refazer) {
    document.querySelector('.camada-obr')?.remove();
    const K = conhecidos(p, M);
    const fechar = () => { camada.remove(); if (!document.querySelector('.camada-cheia')) document.body.classList.remove('com-camada'); document.removeEventListener('keydown', esc); };
    const esc = (ev) => { if (ev.key === 'Escape') fechar(); };
    const proxMes = (() => {
      const h0 = TS.hojeSP ? TS.hojeSP() : new Date().toISOString().slice(0, 10);
      return new Date(Date.UTC(+h0.slice(0, 4), +h0.slice(5, 7) + 1, 0)).toISOString().slice(0, 10);
    })();
    const iNome = h('input', { class: 'f-input', value: o ? o.nome : `Pedido obrigatório de ${new Date().toLocaleDateString('pt-BR', { month: 'long' })}`, maxlength: 60 });
    const iAte = h('input', { class: 'f-input', type: 'date', value: o ? o.ate || '' : proxMes });
    const itens = (o ? o.itens : []).map((x) => ({ ...x }));
    const dl = h('datalist', { id: 'ped-obr-dl' }, [...K.values()].slice(0, 4000).map((x) => h('option', { value: `${x.cod} — ${x.nome}` })));
    const tbody = h('tbody');
    const totalEl = h('b');
    const resolver = (txt) => {
      const t = String(txt || '').trim();
      const cod = t.split(' — ')[0].trim();
      if (K.has(cod)) return K.get(cod);
      if (/^\d{4,7}$/.test(cod) && t.includes(' — ')) return { cod, nome: t.split(' — ').slice(1).join(' — ').trim() };
      const n = normT(t);
      const xs = [...K.values()].filter((x) => normT(x.nome).includes(n));
      return xs.length === 1 ? xs[0] : null;
    };
    const desenhar = () => {
      tbody.replaceChildren(...itens.map((x, k) => {
        const iP = h('input', { class: 'f-input', list: 'ped-obr-dl', value: x.cod ? `${x.cod} — ${x.nome || (K.get(x.cod) || {}).nome || ''}` : '', placeholder: 'Código ou nome', onchange: (ev) => { const a = resolver(ev.target.value); if (a) { x.cod = a.cod; x.nome = a.nome; } else { x.cod = ''; } desenhar(); } });
        const iQ = h('input', { class: 'f-input ped-obr-n', type: 'number', min: 0, step: 'any', value: x.qtd || '', onchange: (ev) => { x.qtd = +ev.target.value || 0; desenhar(); } });
        const auto = x.cod ? precoDe(p, M, x.cod) : null;
        const iV = h('input', { class: 'f-input ped-obr-n', type: 'number', min: 0, step: '0.01', value: x.preco ?? '', placeholder: auto != null ? fmt.n2(auto) : '—', title: 'Em branco = preço do catálogo (ou o custo do AppNext)', onchange: (ev) => { x.preco = ev.target.value === '' ? null : +ev.target.value; desenhar(); } });
        const un = x.cod && K.get(x.cod) ? String(K.get(x.cod).un || '').toLowerCase() : '';
        const v = (x.preco ?? auto ?? 0) * (x.qtd || 0);
        return h('tr', null, h('td', { class: 'l' }, iP, !x.cod ? h('small', { class: 'neg' }, x.nome ? ' não achei este produto' : '') : !K.has(x.cod) ? h('small', { class: 'warn-t' }, ' não está no catálogo nem no estoque') : null),
          h('td', null, iQ, un ? h('small', null, ' ' + un) : null), h('td', null, iV), h('td', null, fmt.brl(v)),
          h('td', null, h('button', { type: 'button', class: 'icon-btn', title: 'Tirar', onclick: () => { itens.splice(k, 1); desenhar(); } }, '×')));
      }));
      totalEl.textContent = `${fmt.int(itens.filter((x) => x.cod && x.qtd > 0).length)} produtos · ${fmt.brl(itens.reduce((s, x) => s + (x.cod ? (x.preco ?? precoDe(p, M, x.cod) ?? 0) * (x.qtd || 0) : 0), 0))}`;
    };
    const cola = h('textarea', { class: 'f-input ped-obr-cola', rows: 5, placeholder: 'Cole aqui a mensagem ou a tabela da franquia (e-mail, WhatsApp ou Excel), do jeito que vier: código, descrição, quantidade e custo. Ex.:\n75148  COLD BREW TEA MELON STRAWBERRY  4  R$ 62,40' });
    const resCola = h('div', { class: 'muted' });
    const ler = h('button', { type: 'button', class: 'btn', onclick: () => {
      const { achados, nao } = lerMensagem(cola.value, K);
      for (const a of achados) { const j = itens.find((x) => x.cod === a.cod); if (j) { j.qtd = a.qtd; if (a.preco != null) j.preco = a.preco; } else itens.push(a); }
      const novos = achados.filter((x) => x.novo).length;
      resCola.replaceChildren(`${fmt.int(achados.length)} produto(s) reconhecido(s)${novos ? ` · ${novos} não estão no catálogo nem no estoque (entram com o nome e o valor da mensagem)` : ''}.`, nao.length ? h('div', { class: 'neg' }, `Não reconheci ${nao.length} linha(s): `, h('small', null, nao.slice(0, 5).join(' · ') + (nao.length > 5 ? ' …' : '')), ' — inclua à mão.') : '');
      desenhar();
    } }, 'Ler a mensagem');
    const erro = h('span', { class: 'neg' });
    const salvar = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
      erro.textContent = '';
      const ok = itens.filter((x) => x.cod && x.qtd > 0);
      if (!ok.length) { erro.textContent = 'Coloque pelo menos um produto com quantidade.'; return; }
      salvar.disabled = true;
      try { const ob = await salvarObrig(loja, { id: o ? o.id : undefined, nome: iNome.value, ate: iAte.value, itens: ok }); fechar(); refazer(ob); }
      catch (err) { salvar.disabled = false; erro.textContent = err.message; }
    } }, 'Salvar');
    desenhar();
    const caixa = h('div', { class: 'card card-cheio fech-modal ped-obr-ed' },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      h('div', { class: 'fech-modal-topo' }, h('b', null, o ? 'Editar pedido obrigatório' : 'Novo pedido obrigatório')),
      h('div', { class: 'ped-obr-cab' }, h('label', null, h('span', { class: 'f-label' }, 'Nome'), iNome), h('label', null, h('span', { class: 'f-label' }, 'Vale até'), iAte,
        h('small', { class: 'muted' }, 'Depois desta data (ou de "Já chegou") ele para de contar no pedido.'))),
      h('div', { class: 'f-label mt' }, 'Colar a mensagem da franquia (opcional)'), cola, h('div', { class: 'ped-obr-lin' }, ler, resCola),
      h('div', { class: 'f-label mt' }, 'Produtos'), dl,
      h('div', { class: 'table-wrap' }, h('table', { class: 't ped-obr-t' }, h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Produto'), h('th', null, 'Quantidade'), h('th', { title: 'Em branco = preço do catálogo do Sistema de Pedidos (ou o custo do AppNext)' }, 'Valor unit.'), h('th', null, 'Total'), h('th', null, ''))), tbody)),
      h('div', { class: 'ped-obr-lin' }, h('button', { type: 'button', class: 'btn', onclick: () => { itens.push({ cod: '', nome: '', qtd: 1, preco: null }); desenhar(); const ins = tbody.querySelectorAll('input[list]'); if (ins.length) ins[ins.length - 1].focus(); } }, '＋ Produto'), totalEl),
      h('div', { class: 'ped-obr-lin mt' }, salvar, h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Cancelar'), erro));
    const camada = h('div', { class: 'camada-cheia camada-obr', role: 'dialog', 'aria-modal': 'true', onclick: (ev) => { if (ev.target === camada) fechar(); } }, caixa);
    document.body.append(camada); document.body.classList.add('com-camada'); document.addEventListener('keydown', esc);
  }

  function baixarCsv(lista, loja) {
    if (!lista.length) { alert('Nada no pedido.'); return; }
    const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const n = (v, d) => (v == null ? '' : v.toFixed(d).replace('.', ','));
    const linhas = [['Código', 'Produto', 'Grupo', 'Unidade', 'Múltiplo', 'Estoque', 'Pedir', 'Preço', 'Total', 'Site'].join(';'),
      ...lista.map((r) => [r.cod, r.produto, r.grupoTxt, r.it.un, r.c && r.c.mult > 1 ? n(r.c.mult, 0) : '', n(r.qtd, 3), n(r.pedir, 3), n(r.preco || 0, 2), n(r.pedir * (r.preco || 0), 2), { ok: 'disponível', sem: 'sem catálogo', indisp: 'indisponível', fora: 'fora do catálogo' }[r.site]].map(esc).join(';'))];
    const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `pedido-sugerido-${loja}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
})();
