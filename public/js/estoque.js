/* Estoque e margem: custo de cada venda (planilha "Estoque Atual" do AppNext), rentabilidade e reposição.
 * Só admin e franqueado (o servidor não entrega custo para os outros perfis). */
(function () {
  const { h, fmt, state } = TS;
  const ESQ = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cache = new Map(); // loja → { at, estoque, cfg }
  TS.aoLimparCache && TS.aoLimparCache(() => cache.clear());
  const DIA = 86400e3;

  async function buscar(loja, forcar) {
    const c = cache.get(loja);
    if (c && !forcar && Date.now() - c.at < 120e3) return c;
    const r = await fetch(TS.api(`estoque?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha ao ler o estoque.');
    const x = { at: Date.now(), estoque: j.estoque, cfg: j.cfg, tabela: j.tabela || null, classe: j.classe || { meses: 6, fixas: {} }, historico: j.historico || {}, compras: j.compras || null, foraDeLinha: j.foraDeLinha || null, espera: j.espera || {} };
    cache.set(loja, x);
    return x;
  }

  const TAM_DIGITO = { 1: 50, 2: 100, 3: 250, 4: 500, 5: 1000 };
  /** casa cada linha de venda com o item do estoque e calcula o custo.
   *  hist = { historico, compras } de /api/estoque: com ele, a venda de MÊS PASSADO usa o custo da data da venda
   *  (custodata.js: notas de compra + fotos do custo; antes do primeiro custo conhecido, o mais antigo, marcado como estimado).
   *  O mês em andamento continua com o custo de hoje do estoque (bate com o AppNext). Sem hist: tudo pelo custo de hoje. */
  function motor(estoque, cfg, hist) {
    const db = TS.db, I = TS.rules.ids;
    const CD = hist && TS.custoData && (hist.historico || hist.compras) ? TS.custoData.montar(hist.historico, hist.compras && hist.compras.itens) : null;
    const ymHoje = TS.hojeSP().slice(0, 7);
    const porCod = new Map(), porNome = new Map(), porNomeKg = new Map();
    for (const it of estoque.itens) {
      porCod.set(String(it.cod), it);
      const n = ESQ(it.desc);
      if (it.un === 'Kg') { if (!porNomeKg.has(n)) porNomeKg.set(n, it); } else if (!porNome.has(n)) porNome.set(n, it);
    }
    const emb = {};
    for (const [g, lista] of Object.entries(cfg.embalagens || {})) emb[g] = lista.map((x) => ({ it: porCod.get(String(x.cod)), qtd: x.qtd })).filter((x) => x.it);
    const custoEmb = (g) => (emb[g] || []).reduce((s, x) => s + (x.it.custo || 0) * x.qtd, 0);
    const memo = new Map();
    const gramasDoCod = (cod) => { const m = /\.(\d+)\s*g$/i.exec(cod || ''); return m ? +m[1] : null; };
    /** { it, kg:boolean, g, via } ou null */
    function casar(i) {
      const k = db.cod[i] + '|' + db.desc[i];
      if (memo.has(k)) return memo.get(k);
      const cod = db.D.cod ? String(db.D.cod[db.cod[i]] ?? '') : '';
      const g = db.so[i] || gramasDoCod(cod);
      let r = null, it = cod && porCod.get(cod);
      if (it) r = { it, kg: it.un === 'Kg', g, via: 'código' };
      if (!r && cod && cod.includes('.')) { it = porCod.get(cod.split('.')[0]); if (it && it.un === 'Kg' && g) r = { it, kg: true, g, via: 'código' }; }
      // pacote de chá: código da matéria-prima + 1 dígito do tamanho (27010 Valeriana Garden → 270101 = 50g, 270102 = 100g…)
      if (!r && /^\d{6,}$/.test(cod)) { it = porCod.get(cod.slice(0, -1)); const gg = g || TAM_DIGITO[cod.slice(-1)]; if (it && it.un === 'Kg' && gg) r = { it, kg: true, g: gg, via: 'código' }; }
      if (!r) {
        const nP = ESQ(db.D.produto[db.prod[i]]), nD = ESQ(db.D.descricao[db.desc[i]]);
        it = g ? porNomeKg.get(nP) : null;
        if (it) r = { it, kg: true, g, via: 'nome' };
        else if ((it = porNome.get(nD) || porNome.get(nP))) r = { it, kg: false, g, via: 'nome' };
      }
      if (r && r.kg && !r.g) r = null; // granel sem saber os gramas: não dá para custear
      memo.set(k, r);
      return r;
    }
    // fora do faturamento: linha de taxa e item a R$ 0,01 — a definição única (TS.contaFat, public/js/contas.js)
    const taxa = (i) => !TS.contaFat(i);
    /** custo da linha pelo custo de HOJE do estoque (R$) ou null */
    function custoHoje(i) {
      const c = casar(i);
      if (!c || !c.it.custo) return null;
      const q = db.qtd[i] || 0;
      return c.kg ? q * ((c.g / 1000) * c.it.custo + custoEmb(c.g)) : q * c.it.custo;
    }
    /** custo da linha com a origem: { v (R$), est (parte dele é estimada), naData (usou o custo da data da venda) } ou null.
     *  Mês passado: custo de cada item na data da venda; mês em andamento (ou sem histórico carregado): custo de hoje. */
    function custoDet(i) {
      if (!CD || !(db.ym[i] < ymHoje)) { const v = custoHoje(i); return v == null ? null : { v, est: false, naData: false }; }
      const c = casar(i);
      if (!c) return null;
      const dia = db.day[i], q = db.qtd[i] || 0;
      const a = CD.custoEm(c.it, dia);
      if (!(a.v > 0)) return null;
      if (!c.kg) return { v: q * a.v, est: a.est, naData: true };
      let e = 0, est = a.est;
      for (const x of emb[c.g] || []) { const b = CD.custoEm(x.it, dia); e += (b.v || 0) * x.qtd; est = est || (b.v > 0 && b.est); }
      return { v: q * ((c.g / 1000) * a.v + e), est, naData: true };
    }
    /** custo da linha (R$) ou null: o da data da venda nos meses passados, o de hoje no mês em andamento */
    const custo = (i) => { const d = custoDet(i); return d ? d.v : null; };
    /** consumo de estoque da linha: [[item, quantidade na unidade do item]] */
    function consumo(i) {
      const c = casar(i);
      if (!c) return [];
      const q = db.qtd[i] || 0;
      if (!c.kg) return [[c.it, q]];
      return [[c.it, (q * c.g) / 1000], ...(emb[c.g] || []).map((x) => [x.it, q * x.qtd])];
    }
    /** chá em pacote sem matéria-prima no estoque: { cod, nome } da matéria-prima esperada (para agrupar e explicar) */
    function materiaPrima(i) {
      const cod = db.D.cod ? String(db.D.cod[db.cod[i]] ?? '') : '';
      const g = db.so[i] || gramasDoCod(cod);
      if (!g || !(db.cha[i] > 0 || I.chaTotal.has(db.grupo[i]))) return null;
      const base = cod.includes('.') ? cod.split('.')[0] : /^\d{6,}$/.test(cod) ? cod.slice(0, -1) : '';
      return { cod: base, nome: db.D.produto[db.prod[i]] || db.D.descricao[db.desc[i]], g };
    }
    /** parte da embalagem (saco e etiquetas) no custo da linha, em R$ */
    const custoEmbLinha = (i) => { const c = casar(i); return c && c.kg ? (db.qtd[i] || 0) * custoEmb(c.g) : 0; };
    /** custo de 1 unidade de um produto do cadastro (preço de tabela), vendido ou não:
     *  produto do estoque pelo código; pacote de chá = código da matéria-prima + dígito do tamanho (ou os gramas no nome);
     *  senão pelo nome. { custo, kg, g, it } ou null */
    function custoCadastro(cod, desc) {
      cod = String(cod || '');
      let it = porCod.get(cod);
      if (it && it.un !== 'Kg') return it.custo ? { custo: it.custo, kg: false, it } : null;
      const gNome = (() => { const m = /(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i.exec(desc || ''); return m ? Math.round(parseFloat(m[1].replace(',', '.')) * (/kg/i.test(m[2]) ? 1000 : 1)) : null; })();
      if (/^\d{6,}$/.test(cod)) {
        const mp = porCod.get(cod.slice(0, -1));
        const g = gNome || TAM_DIGITO[cod.slice(-1)];
        if (mp && mp.un === 'Kg' && g) return mp.custo ? { custo: (g / 1000) * mp.custo + custoEmb(g), kg: true, g, it: mp } : null;
      }
      it = porNome.get(ESQ(desc));
      return it && it.custo ? { custo: it.custo, kg: false, it } : null;
    }
    return { casar, custo, custoDet, custoHoje, custoNaData: CD ? CD.custoNaData : null, custoInicio: CD ? CD.inicio : null, consumo, taxa, porCod, materiaPrima, custoEmbLinha, custoCadastro, cfg };
  }

  /** motor de custos da loja escolhida (ou null se não houver estoque / permissão) */
  const motores = new WeakMap();
  /** deduções da margem líquida de cada linha de venda (comissão, royalties, Simples, maquininha, outros custos) */
  function criarDeducoes(M, cfg) {
    const db = TS.db;
    // ---------- deduções da margem líquida ----------
    // comissão: o que a loja pagou no mês (comissões + premiação + bônus, como no Comissionamento) ÷ vendas de cada
    // tipo (aromatizado, puro, acessório) = % efetivo por tipo; Espaço Gourmet não tem comissão (a gorjeta vem da taxa de serviço).
    // royalties: loja + marketing nas vendas da loja; EG + marketing EG no Espaço Gourmet. Simples e maquininha: % de tudo.
    const RR = TS.rules, I = RR.ids;
    const taxaCom = new Map();
    const comDoMes = (ym) => {
      if (taxaCom.has(ym)) return taxaCom.get(ym);
      const idx = [];
      for (let i = 0; i < db.n; i++) if (db.ym[i] === ym) idx.push(i);
      let t = { arom: 0, puro: 0, acess: 0 };
      try {
        const res = RR.comissionamento({ base: idx, baseSemVend: idx, metaLoja: (TS.metaCalc(ym).valor) || 0, vendBonus: '', ym });
        const T = res.total, rateio = res.regras.rateio && res.regras.rateio.ativo;
        const pago = rateio ? T.aPagar : T.aPagar + (T.premiacao || 0);
        const vendas = (T.arom || 0) + (T.puro || 0) + (T.acess || 0);
        const extra = pago - ((T.cArom || 0) + (T.cPuro || 0) + (T.cAcess || 0)); // premiação, bônus e o que o rateio redistribui
        const tx = (c, v) => (v > 0 ? (c + (vendas ? extra * (v / vendas) : 0)) / v : 0);
        t = { arom: tx(T.cArom || 0, T.arom || 0), puro: tx(T.cPuro || 0, T.puro || 0), acess: tx(T.cAcess || 0, T.acess || 0), pago, vendas };
      } catch (e) { /* sem regras: sem comissão */ }
      taxaCom.set(ym, t);
      return t;
    };
    /** comissão do mês PROJETADO: as vendas de cada pessoa × fator (projeção ÷ vendido até agora) contra a meta do mês,
     *  cada uma na faixa em que fecharia — não a comissão parcial multiplicada. → R$ (comissões + premiação) */
    const comProj = new Map();
    const comProjetada = (ym, fator) => {
      const k = `${ym}|${fator}`;
      if (comProj.has(k)) return comProj.get(k);
      const idx = [];
      for (let i = 0; i < db.n; i++) if (db.ym[i] === ym) idx.push(i);
      let v = null;
      try {
        const res = RR.comissionamento({ base: idx, baseSemVend: idx, metaLoja: (TS.metaCalc(ym).valor) || 0, vendBonus: '', ym, projFator: fator });
        const T = res.total, rateio = res.regras.rateio && res.regras.rateio.ativo;
        v = rateio ? T.aPagar : T.aPagar + (T.premiacao || 0);
      } catch (e) { /* sem regras: sem comissão */ }
      comProj.set(k, v);
      return v;
    };
    const rgLoja = RR.regrasDe(db.D.loja[db.loja[0]]);
    const pSimples = (cfg.simplesPct || 0) / 100, pCartao = (cfg.cartaoPct || 0) / 100;
    // outros custos da loja (Configurações): % das vendas, ou R$ por mês dividido pelas vendas do mês
    // (no mês em andamento, só a parte dos dias que já passaram: o custo fica proporcional às vendas até agora)
    const OUTROS = (cfg.outros || []).filter((x) => x.valor > 0);
    const fatMes = new Map();
    const fatDoMes = (ym, aplica) => {
      const k = ym + '|' + aplica;
      if (fatMes.has(k)) return fatMes.get(k);
      let t = 0;
      for (let i = 0; i < db.n; i++) {
        if (db.ym[i] !== ym || M.taxa(i)) continue;
        const eg = I.eg.has(db.cat[i]);
        if (aplica === 'tudo' || (aplica === 'eg') === eg) t += db.vt[i] || 0;
      }
      fatMes.set(k, t);
      return t;
    };
    // custo em R$ por mês: valor ÷ média do faturamento dos últimos 3 meses fechados = % fixo usado em todas as vendas
    // (mais estável que dividir pelo mês da venda; muda quando entra um mês fechado novo)
    const ymHoje = TS.dayToIso(TS.todayDay()).slice(0, 7);
    const mesesFechados = (() => {
      const set = new Set();
      for (let i = 0; i < db.n; i++) if (db.ym[i] < ymHoje) set.add(db.ym[i]);
      return [...set].sort().slice(-3);
    })();
    const baseMensal = new Map();
    const mediaFat = (aplica) => {
      if (baseMensal.has(aplica)) return baseMensal.get(aplica);
      const vals = mesesFechados.map((ym) => fatDoMes(ym, aplica)).filter((v) => v > 0);
      const r = { media: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0, meses: mesesFechados.filter((ym) => fatDoMes(ym, aplica) > 0) };
      baseMensal.set(aplica, r);
      return r;
    };
    const taxaOutro = (x) => {
      if (x.tipo === 'pct') return x.valor / 100;
      const m = mediaFat(x.aplica);
      return m.media > 0 ? x.valor / m.media : 0;
    };
    const ONDE_FAT = { tudo: 'loja + Espaço Gourmet', loja: 'só loja', eg: 'só Espaço Gourmet' };
    const dicaOutro = (x) => {
      if (x.tipo === 'pct') return `${x.nome}: ${fmt.pct(x.valor / 100)} sobre o valor de cada venda${x.aplica !== 'tudo' ? ` (${ONDE_FAT[x.aplica]})` : ''}.`;
      const m = mediaFat(x.aplica);
      if (!m.media) return `${x.nome}: ainda não há mês fechado com vendas para calcular o %.`;
      return `${x.nome}: R$ ${fmt.int(x.valor)} por mês ÷ média do faturamento (${ONDE_FAT[x.aplica]}, sem taxas) dos últimos ${m.meses.length === 1 ? 'mês fechado' : m.meses.length + ' meses fechados'} (${m.meses.map(TS.ymLabel).join(', ')}: ${fmt.brl0(m.media)} por mês) = ${fmt.pct(x.valor / m.media)} de cada venda. `
        + 'Esse % é volátil: muda quando um mês fecha e entra na média, e sobe quando a loja vende menos. Num mês que vender abaixo da média, o aluguel de verdade pesa mais do que o mostrado; acima da média, pesa menos.';
    };
    /** deduções da linha de venda: { com, roy, imp, maq } em R$ */
    function deducoes(i) {
      const vt = db.vt[i] || 0, g = db.grupoC[i];
      const ehEG = I.eg.has(db.cat[i]);
      const cat = ehEG ? null : I.arom.has(g) ? 'arom' : I.puro.has(g) ? 'puro' : I.acess.has(g) ? 'acess' : null;
      const ry = rgLoja.royalties;
      const outros = OUTROS.map((x) => (x.aplica === 'tudo' || (x.aplica === 'eg') === ehEG ? vt * taxaOutro(x) : 0));
      return {
        com: cat ? vt * (comDoMes(db.ym[i])[cat] || 0) : 0,
        roy: ehEG ? vt * (ry.eg + ry.egMkt) : cat ? vt * (ry.loja + ry.mkt) : 0,
        imp: vt * pSimples,
        maq: vt * pCartao,
        out: outros.reduce((a, b) => a + b, 0),
        outros,
        // variáveis = acompanham a venda (comissão, royalties, Simples, maquininha, custos em %);
        // fixos = custos em R$ por mês rateados. Contribuição = lucro bruto − variáveis.
        get var() { return this.com + this.roy + this.imp + this.maq + this.outros.reduce((a, v, k) => a + (OUTROS[k].tipo === 'pct' ? v : 0), 0); },
        get fix() { return this.outros.reduce((a, v, k) => a + (OUTROS[k].tipo === 'mes' ? v : 0), 0); },
      };
    }


    // categorias dos custos (Funcionários, Imóvel, Sistemas…), na ordem cadastrada; "outros" recebe o que não tem
    const CATS = (cfg.categorias && cfg.categorias.length ? cfg.categorias : [{ id: 'outros', nome: 'Outros' }]);
    const catDe = (x) => (CATS.some((c) => c.id === x.cat) ? x.cat : 'outros');
    // despesas de um mês só: as que caem no mês ym (as "todo ano" repetem no mesmo mês dos anos seguintes)
    const PONTUAIS = (cfg.pontuais || []).filter((x) => x.valor > 0 && x.ym);
    const pontuaisDoMes = (ym) => PONTUAIS.filter((x) => x.ym === ym || (x.anual && x.ym.slice(5) === ym.slice(5) && ym > x.ym));
    /** % das deduções sobre uma venda (para o Orçamento): royalties + marketing, Simples, maquininha, comissão média
     *  do mês fechado mais recente e os outros custos (% e mensais rateados) */
    const taxasVenda = () => {
      const ym = (TS.dayToIso(TS.todayDay()).slice(0, 7));
      const ant = (() => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 1)); return d.toISOString().slice(0, 7); })();
      const c = comDoMes(ant), vend = (c.vendas || 0);
      const com = vend > 0 ? (c.pago || 0) / vend : 0;
      const ry = rgLoja.royalties;
      const pct = OUTROS.filter((x) => x.tipo === 'pct' && x.aplica !== 'eg').reduce((s, x) => s + taxaOutro(x), 0);
      const fix = OUTROS.filter((x) => x.tipo === 'mes' && x.aplica !== 'eg').reduce((s, x) => s + taxaOutro(x), 0);
      return { roy: (ry.loja || 0) + (ry.mkt || 0), imp: pSimples, maq: pCartao, com, outrosPct: pct, outrosFix: fix, mesCom: ant };
    };
    return { deducoes, OUTROS, taxaOutro, dicaOutro, mediaFat, ONDE_FAT, pSimples, pCartao, CATS, catDe, PONTUAIS, pontuaisDoMes, taxasVenda, comDoMes, comProjetada };
  }

  TS.estoqueBuscar = buscar;
  TS.motorEstoque = motor; // Início com todas as lojas (visaodono.js): o mesmo motor, com o estoque de cada loja

  /** Classe oficial de cada produto (Estrela, Volume, Joia, Peso morto), fixa e separada do filtro de período.
   *  Últimos 3, 6 ou 12 meses fechados (só loja). Giro = a MEDIANA do que saiu por mês (um mês de promoção pesa pouco);
   *  margem bruta = (venda − custo) ÷ venda no período todo. Chá a granel (kg) só se compara com chá; o resto entre si.
   *  A conta é a de classeprod.js: além da mediana, a margem sem fixos do produto contra as margens mínima e alvo da loja.
   *  Classes travadas à mão valem acima da conta. Devolve Map(cod → { classe, auto, fixa, giro, margem, margemSf, porque… })
   *  e, no próprio Map, .meses .de .ate .min .alvo (as margens da loja usadas, em fração). */
  const memoCl = { k: null, v: null };
  TS.classeOficial = function (M, ccfg) {
    const db = TS.db, I = TS.rules.ids;
    const meses = [3, 6, 12].includes(ccfg && ccfg.meses) ? ccfg.meses : 6;
    const fixas = (ccfg && ccfg.fixas) || {};
    const cfgM = M.cfg || {};
    const min = (cfgM.margemMin ?? 15) / 100, alvo = (cfgM.margemAlvo ?? 30) / 100;
    const chave = [db.n, db.maxDay, meses, JSON.stringify(fixas), min, alvo].join('|');
    if (memoCl.k === chave && memoCl.M === M) return memoCl.v;
    const ymAtual = TS.dayToIso(db.maxDay).slice(0, 7);
    const lista = [];
    { let d = new Date(ymAtual + '-01T12:00:00Z'); for (let k = 0; k < meses; k++) { d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)); lista.push(d.toISOString().slice(0, 7)); } }
    const idx = new Map(lista.map((ym, k) => [ym, k]));
    // deduções variáveis de cada venda (comissão, royalties, Simples, maquininha, custos em %): para a margem sem fixos
    let DD = null;
    try { DD = M.ded || (M.cfg ? (M.ded = criarDeducoes(M, M.cfg)) : null); } catch (e) { DD = null; }
    const prods = new Map();
    for (let i = 0; i < db.n; i++) {
      const k = idx.get(db.ym[i]);
      if (k == null || I.eg.has(db.cat[i]) || M.taxa(i)) continue;
      const cu = M.custo(i);
      if (cu == null) continue;
      const c = M.casar(i);
      if (!c || !c.it) continue;
      const cod = String(c.it.cod);
      const p = prods.get(cod) || prods.set(cod, { kg: !!c.kg, vt: 0, custo: 0, dedVar: 0, mes: new Array(meses).fill(0) }).get(cod);
      const q = db.qtd[i] || 0;
      p.mes[k] += c.kg ? (q * c.g) / 1000 : q;
      p.vt += db.vt[i] || 0; p.custo += cu;
      if (DD && p.dedVar != null) { try { p.dedVar += DD.deducoes(i).var; } catch (e) { p.dedVar = null; } }
    }
    const CP = TS.classeProd, mediana = CP.mediana;
    const out = new Map();
    for (const kg of [true, false]) {
      const xs = [...prods.entries()].filter(([, p]) => p.kg === kg && p.vt > 0).map(([cod, p]) => ({ cod, giro: mediana(p.mes), margem: (p.vt - p.custo) / p.vt, margemSf: DD && p.dedVar != null ? (p.vt - p.custo - p.dedVar) / p.vt : null }));
      for (const [cod, x] of CP.classificar(xs, { min, alvo })) out.set(cod, { ...x, kg });
    }
    for (const [cod, x] of out) { const f = fixas[cod]; x.fixa = f ? f : null; x.classe = f ? f.classe : x.auto; }
    for (const [cod, f] of Object.entries(fixas)) if (!out.has(cod)) out.set(cod, { auto: null, fixa: f, classe: f.classe, giro: 0, margem: null });
    out.meses = meses; out.de = lista[lista.length - 1]; out.ate = lista[0]; out.min = min; out.alvo = alvo;
    memoCl.k = chave; memoCl.M = M; memoCl.v = out;
    return out;
  };
  /** grava a janela ({meses}) ou trava/destrava a classe de um produto ({cod, nome, classe|null}) */
  TS.salvarClasse = async function (loja, corpo) {
    const r = await fetch(TS.api(`estoque/classe?loja=${encodeURIComponent(loja)}`), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não consegui salvar.');
    const c = cache.get(loja);
    if (c) c.classe = j.classe;
    return j.classe;
  };
  TS.custosLoja = async function () {
    if (!(TS.eu && TS.eu.pode && (TS.eu.pode.configurar || TS.eu.pode.custos)) || !state.loja || state.loja === 'todas') return null;
    const x = await buscar(state.loja);
    if (!x.estoque || !x.estoque.itens || !x.estoque.itens.length) return null;
    let m = motores.get(TS.db);
    if (!m || m.est !== x.estoque || m.cfg !== x.cfg || m.hist !== x.historico || m.comp !== x.compras) { m = { est: x.estoque, cfg: x.cfg, hist: x.historico, comp: x.compras, M: motor(x.estoque, x.cfg, { historico: x.historico, compras: x.compras }) }; m.M.ded = criarDeducoes(m.M, x.cfg); motores.set(TS.db, m); }
    return m.M;
  };

  /** cartão "Lucro da promoção": antes × durante × depois (só admin e franqueado) */
  TS.cartaoLucroPromo = function ({ antes, durante, depois, diasAntes, diasDurante, diasDepois }) {
    const corpo = h('div', null, h('div', { class: 'muted' }, 'Calculando o lucro…'));
    const card = TS.card('Lucro da promoção', 'Com o custo de cada produto (planilha de estoque do AppNext). Lucro por dia, para comparar períodos de tamanhos diferentes.', corpo);
    TS.custosLoja().then((M) => {
      if (!M) { card.remove(); return; }
      const db = TS.db;
      const DD = M.ded;
      const calc = (idx, dias) => {
        let vt = 0, custo = 0, comCusto = 0, desc = 0, ded = 0, dedVar = 0;
        const prod = new Map();
        for (const i of idx) {
          if (M.taxa(i)) continue;
          const v = db.vt[i] || 0; vt += v; desc += TS.descontos([i]);
          const c = M.custo(i);
          if (c == null) continue;
          comCusto += v; custo += c;
          if (DD) { const dd = DD.deducoes(i); ded += dd.var + dd.fix; dedVar += dd.var; }
          const cs = M.casar(i);
          const k = cs && cs.kg ? cs.it.desc : db.D.descricao[db.desc[i]];
          const p = prod.get(k) || { vt: 0, lucro: 0 }; p.vt += v; p.lucro += v - c; prod.set(k, p);
        }
        const lucro = comCusto - custo, liq = lucro - ded, contrib = lucro - dedVar;
        return { dias, vt, desc, lucro, liq, contrib, margem: comCusto ? lucro / comCusto : null, margemLiq: comCusto ? liq / comCusto : null, margemContrib: comCusto ? contrib / comCusto : null, contribDia: dias ? contrib / dias : null, lucroDia: dias ? lucro / dias : null, liqDia: dias ? liq / dias : null, vtDia: dias ? vt / dias : null, prod };
      };
      const A = calc(antes, diasAntes), D = calc(durante, diasDurante), P = diasDepois > 0 ? calc(depois, diasDepois) : null;
      const delta = A.lucroDia ? D.lucroDia / A.lucroDia - 1 : null;
      const col = (t, x, destaque) => h('div', { class: 'promo-col' + (destaque ? ' on' : '') }, h('div', { class: 'promo-col-t' }, t, h('small', null, `${x ? fmt.int(x.dias) : 0} dias`)),
        x ? [h('div', { class: 'promo-lucro' }, fmt.brl0(x.lucroDia), h('small', null, ' de lucro bruto por dia')),
          h('div', null, `Lucro sem fixos ${fmt.brl0(x.contribDia)}/dia · com fixos ${fmt.brl0(x.liqDia)}/dia`),
          h('div', null, `Faturamento ${fmt.brl0(x.vtDia)}/dia`), h('div', null, `Margem bruta ${fmt.pct(x.margem)} · sem fixos ${fmt.pct(x.margemContrib)} · com fixos ${fmt.pct(x.margemLiq)}`), h('div', null, `Descontos ${fmt.brl0(x.desc)} no período`)]
          : h('div', { class: 'muted' }, 'Ainda não há dias depois da promoção.'));
      const veredito = delta == null ? null : delta > 0.03
        ? h('div', { class: 'notice ok-n' }, h('b', null, 'A promoção se pagou: '), `o lucro por dia subiu ${fmt.pct(delta, 0)} em relação aos ${fmt.int(diasAntes)} dias antes, mesmo com ${fmt.brl0(D.desc)} em descontos.`)
        : delta < -0.03
          ? h('div', { class: 'notice err' }, h('b', null, 'A promoção não se pagou: '), `o lucro por dia caiu ${fmt.pct(-delta, 0)} em relação aos ${fmt.int(diasAntes)} dias antes. O desconto (${fmt.brl0(D.desc)}) custou mais do que a venda a mais trouxe.`)
          : h('div', { class: 'notice' }, h('b', null, 'Empate: '), 'o lucro por dia ficou praticamente igual ao de antes. A promoção trouxe movimento, mas não lucro a mais.');
      const nomes = new Set([...A.prod.keys(), ...D.prod.keys()]);
      const linhas = [...nomes].map((n) => {
        const a = A.prod.get(n), d = D.prod.get(n);
        const la = a ? a.lucro / diasAntes : 0, ld = d ? d.lucro / diasDurante : 0;
        return { produto: n, antes: la, durante: ld, dif: ld - la };
      }).filter((r) => Math.abs(r.dif) > 0.005).sort((x, y) => Math.abs(y.dif) - Math.abs(x.dif)).slice(0, 15);
      corpo.replaceChildren(...[veredito,
        h('div', { class: 'promo-cols' }, col('Antes', A), col('Durante', D, true), col('Depois', P)),
        P && A.lucroDia ? h('p', { class: 'muted', style: { fontSize: '12.5px' } }, P.lucroDia >= A.lucroDia * 1.03 ? `Depois da promoção o lucro por dia seguiu ${fmt.pct(P.lucroDia / A.lucroDia - 1, 0)} acima de antes: a campanha deixou efeito.` : P.lucroDia <= A.lucroDia * 0.97 ? `Depois da promoção o lucro por dia ficou ${fmt.pct(1 - P.lucroDia / A.lucroDia, 0)} abaixo de antes: parte da venda foi só antecipada.` : 'Depois da promoção o lucro por dia voltou ao nível de antes.') : null,
        linhas.length ? h('div', { class: 'mt' }, h('div', { class: 'f-label' }, 'Produtos que mais mudaram o lucro bruto por dia'), TS.table({
          cols: [{ key: 'produto', label: 'Produto', align: 'l', wrap: true }, { key: 'antes', label: 'Antes /dia', fmt: fmt.brl }, { key: 'durante', label: 'Durante /dia', fmt: fmt.brl },
            { key: 'dif', label: 'Diferença', fmt: (v) => (v > 0 ? '+' : '') + fmt.brl(v), cls: (r) => (r.dif > 0 ? 'pos' : 'neg') }],
          rows: linhas, sortKey: 'dif', maxHeight: '360px', cls: 'est-t',
        })) : null].filter(Boolean));
    }).catch(() => card.remove());
    return card;
  };

  /** janelinha com um cartão (fecha clicando fora, com Esc ou rolando a tela) */
  function popCartao(alvo, cartao) {
    document.querySelector('.est-pop')?.remove();
    const pop = h('div', { class: 'est-pop est-pop-card', role: 'dialog' }, cartao);
    document.body.append(pop);
    const r = alvo.getBoundingClientRect(), w = pop.offsetWidth, hh = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
    pop.style.top = (r.bottom + 6 + hh > window.innerHeight ? Math.max(8, r.top - hh - 6) : r.bottom + 6) + 'px';
    const sair = (ev) => {
      if (ev && ev.type === 'mousedown' && pop.contains(ev.target)) return;
      if (ev && ev.type === 'keydown' && ev.key !== 'Escape') return;
      if (ev && ev.type === 'scroll' && pop.contains(ev.target)) return;
      pop.remove(); document.removeEventListener('mousedown', sair, true); document.removeEventListener('keydown', sair); window.removeEventListener('scroll', sair, true);
    };
    setTimeout(() => { document.addEventListener('mousedown', sair, true); document.addEventListener('keydown', sair); window.addEventListener('scroll', sair, true); }, 0);
  }

  const TIPO_ITEM = (it) => (it.un === 'Kg' && it.tipo === 'IN' ? 'Chá a granel' : it.tipo === 'PN' ? 'Produto' : 'Insumo / embalagem');
  const qtdTxt = (v, it) => (v == null ? '—' : it.un === 'Kg' ? `${fmt.kg(v)} kg` : `${fmt.int(v)} ${it.un ? it.un.toLowerCase() : ''}`);

  /** submenu do menu Estoque e Margem */
  TS.subEstoque = (atual) => TS.subGrupo(atual);
  /** apresentação: um "cadastro" montado com os produtos vendidos (preço mais comum) e alguns do estoque sem venda */
  function tabelaDemo(M, estoque) {
    const db = TS.db, porCod = new Map();
    for (let i = 0; i < db.n; i++) {
      const c = M.casar(i);
      const cod = (db.D.cod ? String(db.D.cod[db.cod[i]] ?? '') : '') || (c && !c.kg ? String(c.it.cod) : '');
      if (!cod || M.taxa(i) || !(db.vu[i] > 0)) continue;
      const x = porCod.get(cod) || porCod.set(cod, { cod, desc: db.D.descricao[db.desc[i]], grupo: String((db.D.grupo && db.D.grupo[db.grupo[i]]) || ''), precos: new Map() }).get(cod);
      const k = Math.round(db.vu[i] * 100) / 100; x.precos.set(k, (x.precos.get(k) || 0) + 1);
    }
    const out = [...porCod.values()].map((x) => ({ cod: x.cod, desc: x.desc, grupo: x.grupo, sub: '', preco: [...x.precos].sort((a, b) => b[1] - a[1])[0][0] }));
    for (const it of estoque.itens) if (it.un !== 'Kg' && it.custo > 0 && !porCod.has(String(it.cod)) && out.length < 1200) out.push({ cod: String(it.cod), desc: it.desc, grupo: 'ACESSÓRIOS', sub: '', preco: Math.round(it.custo * 24) / 10 - 0.1 });
    return out;
  }

  /** Produtos → Rentabilidade e Estoque → Estoque: a mesma conta, cada tela mostra a sua parte */
  function telaEstoque(root, modo) {
    root.append(TS.subEstoque(modo));
    const T = modo === 'rentab'
      ? ['Rentabilidade', 'Quais produtos dão lucro: giro × margem, curva ABC, margem de tabela, kits e lucro por vendedora']
      : ['Estoque', 'O que repor, o que está parado e quanto vale o estoque'];
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, T[0]), h('div', { class: 'page-sub' }, T[1])),
      modo === 'rentab' ? h('div', { class: 'active-filters' }, h('span', { class: 'af' }, TS.periodoTexto())) : null));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'É de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Lendo o estoque…'))));
    root.append(corpo);
    buscar(state.loja).then((x) => { if (corpo.isConnected) pintar(corpo, x, modo); }).catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  }
  TS.pages.estoque = (root) => telaEstoque(root, 'estoque');
  /** abre o Pedido na aba "Site de pedidos completo" (todos os produtos) já buscando o produto */
  TS.irParaPedido = (nome) => {
    TS._buscas = { tela: '#pedido', v: { 'Buscar produto…|produto,cod': nome } };
    state.pedFiltro = 'site';
    location.hash = '#pedido';
  };
  TS.pages.rentab = (root) => telaEstoque(root, 'rentab');
  /** cartão do ponto de equilíbrio (fica no Resultado) */
  TS.cartaoEquilibrio = function (loja) {
    const box = h('div', { class: 'mt' });
    buscar(loja).then((x) => { if (box.isConnected) pintar(box, x, 'equilibrio'); }).catch(() => box.replaceChildren());
    return box;
  };

  function pintar(corpo, { estoque, cfg, historico, classe: ccfg, tabela, foraDeLinha, espera, compras }, modo = 'estoque') {
    corpo.replaceChildren();
    // cada tela põe só a sua parte (a conta é a mesma)
    const R = modo === 'rentab', E = modo === 'estoque', EQ = modo === 'equilibrio';
    const put = (vale, ...els) => { if (vale) corpo.append(...els.filter(Boolean)); };
    if (!estoque || !estoque.itens || !estoque.itens.length) {
      corpo.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Ainda não há estoque desta loja'),
        h('p', null, 'No AppNext: Estoque → Estoque Atual → botão verde "Exportar para Excel". Envie o arquivo em Configurações → Lojas → Enviar planilha → "Estoque atual e custos". Depois disso o coletor baixa sozinho em cada atualização.')));
      return;
    }
    const db = TS.db;
    const M = motor(estoque, cfg, { historico, compras });
    const temCod = db.D.cod && db.D.cod.some((c) => c);
    put(!EQ, h('div', { class: 'muted est-origem' }, `Estoque e custos do AppNext de ${new Date(estoque.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${fmt.int(estoque.itens.length)} produtos`,
      temCod ? null : ' · ', temCod ? null : h('details', { class: 'est-como' }, h('summary', null, 'As vendas estão sem o código do produto. Como funciona ▸'),
        h('p', null, 'Sem o código, o painel acha o custo de cada venda pelo nome do produto. Se o nome da venda for diferente do nome no estoque, o custo não é achado e a venda fica fora da margem' + (R ? ': confira a lista "Vendas sem custo" no fim desta tela.' : ' (a lista fica em Produtos → Rentabilidade, "Vendas sem custo").')))));

    const { deducoes, OUTROS, taxaOutro, mediaFat, ONDE_FAT, pSimples, pCartao, CATS, catDe, pontuaisDoMes } = (M.ded = criarDeducoes(M, cfg));

    // ---------- rentabilidade no período e filtros escolhidos ----------
    const base = TS.filtrar();
    let fat = 0, fatCusto = 0, custoTot = 0, custoNaDataTot = 0, custoEstTot = 0;
    const dedTot = { com: 0, roy: 0, imp: 0, maq: 0, out: 0 };
    const outrosTot = OUTROS.map(() => 0);
    const porProd = new Map(), porVend = new Map(), semCusto = new Map();
    // prêmio de fidelidade ou brinde: sai por R$ 0,01 (às vezes com o preço cheio e o desconto de quase 100% na linha, o que
    // M.taxa e TS.ehResgate não pegam). Entra no total da loja (o custo é real), mas não na conta de cada produto:
    // uma unidade a R$ 0,01 levava a margem do produto a −100.000% e esticava o gráfico.
    const resg = (i) => TS.ehResgate(i) || ((db.qtd[i] || 0) > 0 && (db.vt[i] || 0) / db.qtd[i] < 0.05);
    let nResg = 0, custoResg = 0;
    for (const i of base) {
      if (M.taxa(i)) continue;
      const vt = db.vt[i] || 0;
      fat += vt;
      const cd = M.custoDet(i), c = cd ? cd.v : null;
      if (cd && cd.naData) { custoNaDataTot += c; if (cd.est) custoEstTot += c; }
      const d = db.D.descricao[db.desc[i]];
      if (c == null) {
        const cs0 = M.casar(i);
        // chá a granel: todos os tamanhos saem da mesma matéria-prima, então aparece uma linha só
        const mp = cs0 && cs0.kg ? { cod: cs0.it.cod, nome: cs0.it.desc, g: cs0.g } : !cs0 ? M.materiaPrima(i) : null;
        const chave = mp ? 'mp:' + (mp.cod || mp.nome) : d;
        const s = semCusto.get(chave) || (mp
          ? { produto: mp.nome, granel: true, tam: new Map(), cod: mp.cod || '—', vt: 0, qtd: 0, motivo: cs0 ? 'matéria-prima com custo zero no AppNext' : `matéria-prima${mp.cod ? ` (cód. ${mp.cod})` : ''} não está na planilha de estoque` }
          : { produto: d, cod: db.D.cod ? db.D.cod[db.cod[i]] : '', vt: 0, qtd: 0, motivo: cs0 ? 'custo zero no AppNext' : 'não achado no estoque' });
        s.vt += vt; s.qtd += db.qtd[i] || 0;
        if (mp) s.tam.set(mp.g, (s.tam.get(mp.g) || 0) + (db.qtd[i] || 0));
        semCusto.set(chave, s);
        continue;
      }
      fatCusto += vt; custoTot += c;
      const dd = deducoes(i);
      for (const k in dedTot) dedTot[k] += dd[k];
      dd.outros.forEach((v, k) => { outrosTot[k] += v; });
      if (resg(i)) { nResg += db.qtd[i] || 0; custoResg += c; } else {
      const cs = M.casar(i);
      const granel = cs.kg;
      const chave = granel ? 'kg:' + cs.it.cod : d;
      const p = porProd.get(chave) || { produto: granel ? cs.it.desc : d, cod: String(cs.it.cod), granel, qtd: 0, kg: 0, tam: new Map(), vt: 0, custo: 0, com: 0, roy: 0, imp: 0, maq: 0, out: 0, outros: OUTROS.map(() => 0), desc: 0, emb: 0 };
      p.desc += TS.descontos([i]); p.emb += M.custoEmbLinha(i);
      const q = db.qtd[i] || 0;
      p.qtd += q; p.vt += vt; p.custo += c;
      p.com += dd.com; p.roy += dd.roy; p.imp += dd.imp; p.maq += dd.maq; p.out += dd.out;
      dd.outros.forEach((v, k) => { p.outros[k] += v; });
      if (granel) {
        p.kg += (q * cs.g) / 1000; p.tam.set(cs.g, (p.tam.get(cs.g) || 0) + q);
        // por tamanho de pacote (50g, 100g…): para ver a margem de cada um
        p.porTam = p.porTam || new Map();
        const t = p.porTam.get(cs.g) || { g: cs.g, qtd: 0, vt: 0, custo: 0, ded: 0, dedVar: 0 };
        t.qtd += q; t.vt += vt; t.custo += c; t.ded += dd.var + dd.fix; t.dedVar += dd.var;
        p.porTam.set(cs.g, t);
      }
      porProd.set(chave, p);
      }
      const vn = db.D.vendedor[db.vend[i]] || '—';
      const v = porVend.get(vn) || { vendedor: vn, vt: 0, custo: 0, fat: 0, ded: 0, dedVar: 0 };
      v.vt += vt; v.custo += c; v.ded += dd.var + dd.fix; v.dedVar += dd.var; porVend.set(vn, v);
    }
    for (const i of base) { if (M.taxa(i)) continue; const v = porVend.get(db.D.vendedor[db.vend[i]] || '—'); if (v) v.fat += db.vt[i] || 0; }
    put(R && nResg > 0, h('div', { class: 'muted est-origem' }, `${fmt.int(nResg)} ${nResg === 1 ? 'item saiu' : 'itens saíram'} a R$ 0,01 (prêmios de fidelidade e brindes): ${nResg === 1 ? 'fica' : 'ficam'} fora da margem de cada produto e ${nResg === 1 ? 'entra' : 'entram'} só no total da loja (custo de ${fmt.brl(custoResg)}).`));
    // custo da data da venda: avisa (linha discreta) quanto do custo do período veio da data e quanto é estimado
    put(R && custoNaDataTot > 0, h('div', { class: 'muted est-origem est-custo-data' }, `Custo da data da venda: ${fmt.pct(custoNaDataTot / custoTot, 0)} do custo do período${custoEstTot > 0 ? ` · ${fmt.pct(custoEstTot / custoTot, 0)} estimado` : ''} `,
      TS.dica(`Venda de mês passado usa o custo que o produto tinha no dia da venda (notas de compra do AppNext + o custo que o painel guarda a cada planilha de estoque), não o custo de hoje: se o custo subiu depois, a margem daquele mês não piora sozinha.\n\nVenda do mês em andamento usa o custo de hoje do estoque.\n\nNeste período: ${fmt.brl0(custoNaDataTot)} de ${fmt.brl0(custoTot)} do custo vieram da data da venda${custoEstTot > 0 ? `; ${fmt.brl0(custoEstTot)} (${fmt.pct(custoEstTot / custoTot, 0)}) são ESTIMADOS: a venda é anterior ao primeiro custo que o painel conhece do produto${Number.isFinite(M.custoInicio) ? ` (o histórico de custos começa em ${fmt.date(TS.dayToIso(M.custoInicio))})` : ''}, então vale o custo mais antigo conhecido` : ' e nada precisou ser estimado'}.`)));
    const lucro = fatCusto - custoTot;
    const tamTxt = (m) => [...m].sort((a, b) => a[0] - b[0]).map(([g, q]) => `${fmt.int(q)}× ${g >= 1000 ? g / 1000 + ' kg' : g + 'g'}`).join(' · ');
    const prods = [...porProd.values()].filter((p) => p.vt > 0).map((p) => {
      const ded = p.com + p.roy + p.imp + p.maq + p.out, liq = p.vt - p.custo - ded;
      const dedVar = p.com + p.roy + p.imp + p.maq + p.outros.reduce((a, v, k) => a + (OUTROS[k].tipo === 'pct' ? v : 0), 0);
      const contrib = p.vt - p.custo - dedVar;
      return { ...p, lucro: p.vt - p.custo, margem: (p.vt - p.custo) / p.vt, ded, dedVar, contrib, margemContrib: contrib / p.vt, lucroLiq: liq, margemLiq: liq / p.vt, giro: p.granel ? p.kg : p.qtd, tamanhos: p.granel ? tamTxt(p.tam) : '' };
    });
    const dedSoma = dedTot.com + dedTot.roy + dedTot.imp + dedTot.maq + dedTot.out;
    const lucroLiqTot = fatCusto - custoTot - dedSoma;
    const dedVarTot = prods.reduce((a, p) => a + p.dedVar, 0);
    const contribTot = fatCusto - custoTot - dedVarTot;
    const pctDe = (v, r) => (r.vt ? fmt.pct(v / r.vt) : '');
    const ONDE = { tudo: '', loja: ' (só loja)', eg: ' (só EG)' };
    const rotOutro = (x) => `${x.nome}${x.tipo === 'mes' ? ` (R$ ${fmt.int(x.valor)}/mês) ⓘ` : ''}${ONDE[x.aplica] || ''}`;
    const NOTA_DED = `Comissão: o que a loja pagou no mês (comissões, premiação e bônus) ÷ vendas do tipo do produto; Espaço Gourmet não tem comissão. Royalties pelas regras da loja. Simples ${fmt.pct(pSimples)} e maquininha ${fmt.pct(pCartao)} sobre o valor vendido.${OUTROS.some((x) => x.tipo === 'mes') ? ' Custos em R$ por mês viram % pela média do faturamento dos últimos 3 meses fechados (passe o mouse no nome para ver a conta).' : ''} Ajuste em Configurações → Lojas → Estoque e margem.`;
    /** conta do lucro em cartões no mesmo visual dos pacotes: resultado, deduções variáveis e custos fixos.
     *  modo 'liq' = os três; 'ded' = só as deduções */
    const cartoesConta = (r, modo) => {
      const linha = (rot, val, cls, dica) => h('tr', { class: cls || null, title: dica || null }, h('td', null, rot), h('td', { class: 'r' }, fmt.brl(val)), h('td', { class: 'r est-det-pct' }, pctDe(val, r) || ''));
      const cupom = (titulo, dir, linhas, rodape, cls) => h('div', { class: 'cupom' + (cls ? ' ' + cls : '') },
        h('div', { class: 'cupom-head' }, h('span', null, h('b', null, titulo)), h('span', null, dir)), h('table', { class: 'cupom-items' }, ...linhas), rodape ? h('div', { class: 'cupom-rodape' }, rodape) : null);
      const fixosK = OUTROS.map((x, k) => (x.tipo === 'mes' ? k : -1)).filter((k) => k >= 0);
      const pctK = OUTROS.map((x, k) => (x.tipo === 'pct' ? k : -1)).filter((k) => k >= 0);
      const somaK = (ks) => ks.reduce((a, k) => a + r.outros[k], 0);
      const varTot = r.com + r.roy + r.imp + r.maq + somaK(pctK), fixTot = somaK(fixosK);
      const cards = [];
      if (modo === 'liq') {
        const un = r.granel ? r.kg : r.qtd;
        cards.push(cupom('Do faturamento ao lucro', 'no período', [
          linha('Faturamento', r.vt),
          linha('− Custo dos produtos', r.custo, null, r.granel ? 'Chá pelo kg da matéria-prima + saco kraft e etiquetas de cada pacote' : 'Custo do AppNext × quantidade'),
          linha('= Lucro bruto', r.lucro, 'est-det-sub'),
          linha('− Deduções variáveis', varTot),
          linha('= Lucro sem fixos (contribuição)', r.lucro - varTot, 'est-det-sub est-det-con', 'O que o produto deixa para pagar os custos fixos'),
          fixosK.length ? linha('− Custos fixos (rateio)', fixTot) : null,
          linha('= Lucro com fixos (líquido)', r.lucroLiq, 'est-det-tot' + (r.lucroLiq < 0 ? ' neg' : '')),
        ].filter(Boolean), un ? `${r.granel ? `${fmt.kg(un)} kg vendidos` : `${fmt.int(un)} un. vendidas`}: preço ${fmt.brl(r.vt / un)} e custo ${fmt.brl(r.custo / un)} por ${r.granel ? 'kg' : 'unidade'}` : null, 'est-det-total'));
      }
      cards.push(cupom('Deduções variáveis', 'acompanham a venda', [
        linha('Comissão paga', r.com, null, 'Média do que a loja pagou no mês (comissões, premiação e bônus) ÷ vendas do tipo do produto. Espaço Gourmet não tem comissão.'),
        linha('Royalties + marketing', r.roy, null, 'Regras da loja (loja + marketing; no Espaço Gourmet, EG + marketing EG)'),
        linha('Simples Nacional', r.imp, null, `${fmt.pct(pSimples)} de cada venda`),
        linha('Maquininha', r.maq, null, `${fmt.pct(pCartao)} de cada venda`),
        ...pctK.map((k) => linha(OUTROS[k].nome, r.outros[k], null, `${fmt.pct(OUTROS[k].valor / 100)} de cada venda${OUTROS[k].aplica !== 'tudo' ? ' · ' + ONDE_FAT[OUTROS[k].aplica] : ''}`)),
        linha('Total', varTot, 'est-det-tot'),
      ], `Simples ${fmt.pct(pSimples)} · maquininha ${fmt.pct(pCartao)} · royalties e comissão pelas regras da loja`));
      if (fixosK.length) {
        const m = mediaFat(OUTROS[fixosK[0]].aplica);
        // agrupados por categoria: subtotal da categoria e, embaixo, cada custo
        const linhasFix = [];
        for (const c of CATS) {
          const ks = fixosK.filter((k) => catDe(OUTROS[k]) === c.id);
          if (!ks.length) continue;
          linhasFix.push(linha(c.nome, somaK(ks), 'est-det-sub', `Soma dos custos de ${c.nome}`));
          for (const k of ks) { const x = OUTROS[k], mm = mediaFat(x.aplica); linhasFix.push(linha('  ' + x.nome, r.outros[k], 'est-det-filho', mm.media ? `R$ ${fmt.int(x.valor)} por mês ÷ ${fmt.brl0(mm.media)} (média) = ${fmt.pct(x.valor / mm.media)} de cada venda` : 'Sem mês fechado para calcular')); }
        }
        cards.push(cupom('Custos fixos da loja', 'rateio', [
          ...linhasFix,
          linha('Total', fixTot, 'est-det-tot'),
        ], m.media ? `Valor por mês ÷ média do faturamento de ${m.meses.map(TS.ymLabel).join(', ')} (${fmt.brl0(m.media)}/mês)` : null));
      }
      const fixosTxt = fixosK.length ? ' Custos fixos: cada um vira um % pela média do faturamento dos últimos 3 meses fechados; esse % é volátil (muda quando um mês fecha e sobe quando a loja vende menos).' : '';
      const avisoNeg = modo === 'liq' && r.lucroLiq < 0 && r.lucro - varTot > 0
        ? h('div', { class: 'est-det-aviso' }, `Com os custos fixos o resultado fica negativo só por causa do rateio. Sem os fixos o produto deixa ${fmt.brl(r.lucro - varTot)}: cada venda ajuda a pagar o aluguel e os outros fixos. Deixar de vender diminuiria o resultado da loja.`)
        : null;
      return h('div', null, avisoNeg,
        h('div', { class: 'est-det-grid' }, ...cards),
        h('div', { class: 'est-det-nota' }, `Passe o mouse em cada linha para ver de onde vem o valor.${fixosTxt} Ajuste em Configurações → Lojas → Estoque e margem.`));
    };
    /** compatibilidade: o cartão único (janelinha do cartão do topo) */
    const cartaoConta = (r) => cartoesConta(r, 'liq');
    /** abre (ou fecha) embaixo da linha da tabela um conteúdo; uma linha aberta por produto */
    const expandirLinha = (e, chave, conteudo) => {
      e.stopPropagation();
      const tr = e.currentTarget.closest('tr');
      const prox = tr.nextElementSibling;
      const aberta = prox && prox.classList.contains('est-det') ? prox : null;
      if (aberta) { aberta.remove(); tr.classList.remove('est-aberto'); if (aberta.dataset.chave === chave) return; }
      const wrap = tr.closest('.table-wrap');
      const caixa = h('div', { class: 'est-det-box', style: { width: Math.max(260, (wrap ? wrap.clientWidth : 600) - 24) + 'px' } }, conteudo());
      tr.classList.add('est-aberto');
      const det = h('tr', { class: 'est-det' }, h('td', { colspan: tr.children.length }, caixa));
      det.dataset.chave = chave;
      tr.after(det);
    };
    const abrirDed = (e, r) => expandirLinha(e, 'ded', () => cartoesConta(r, 'ded'));
    const abrirLiq = (e, r) => {
      // o cartão do topo não é linha de tabela: abre a janelinha com o mesmo cartão
      if (!e.currentTarget.closest('tr')) { e.stopPropagation(); popCartao(e.currentTarget, cartaoConta(r)); return; }
      expandirLinha(e, 'liq', () => cartoesConta(r, 'liq'));
    };

    /** abre embaixo da linha do chá um cartão por tamanho de pacote (mesmo visual dos cupons na tela Clientes) */
    const abrirTamanhos = (e, r) => expandirLinha(e, 'tam', () => {
      const tams = [...r.porTam.values()].sort((a, b) => a.g - b.g);
      const rotG = (g) => (g >= 1000 ? `${g / 1000} kg` : `${g}g`);
      const pc = (v, base) => (base ? fmt.pct(v / base) : '—');
      const melhorG = (() => { let b = null; for (const t of tams) { if (!t.qtd) continue; const v = ((t.vt - t.custo - t.dedVar) / t.qtd) * (100 / t.g); if (!b || v > b.v) b = { g: t.g, v }; } return tams.length > 1 && b ? b.g : null; })();
      const card = (t, total) => {
        const un = t.qtd || 1, f = total ? 1 : 1 / un;
        const txVar = t.vt ? t.dedVar / t.vt : 0; // deduções variáveis acompanham o preço
        const txFix = t.vt ? (t.ded - t.dedVar) / t.vt : 0; // custos fixos rateados (% do preço)
        const tb = h('table', { class: 'cupom-items' });
        const pintarCard = (preco) => {
          const vt = total ? t.vt : preco * un;
          const dv = vt * txVar, df = vt * txFix, lb = vt - t.custo, cb = lb - dv, ll = cb - df;
          const lin = (rot, val, pct, cls) => h('tr', { class: cls || null }, h('td', null, rot), h('td', { class: 'r' }, fmt.brl(val * f)), h('td', { class: 'r est-det-pct' }, pct));
          tb.replaceChildren(...[
            lin(total ? 'Faturamento' : 'Preço médio', vt, '100%'),
            lin('− Custo', t.custo, pc(t.custo, vt)),
            lin('= Lucro bruto', lb, pc(lb, vt), 'est-det-sub'),
            lin('− Deduções variáveis', dv, pc(dv, vt)),
            lin('= Lucro sem fixos', cb, pc(cb, vt), 'est-det-sub est-det-con' + (cb < 0 ? ' neg' : '')),
            df ? lin('− Custos fixos (rateio)', df, pc(df, vt)) : null,
            lin('= Lucro com fixos', ll, pc(ll, vt), 'est-det-tot' + (ll < 0 ? ' neg' : '')),
          ].filter(Boolean));
          if (rod) rod.textContent = `No período${simulado ? ' (com o preço simulado)' : ''}: lucro sem fixos ${fmt.brl(cb)} · com fixos ${fmt.brl(ll)}`;
        };
        const precoAtual = t.vt / un, custoUn = t.custo / un;
        let simulado = false, rod = null;
        const alvoPreco = 1 - txVar - margemAlvo > 0 ? custoUn / (1 - txVar - margemAlvo) : null;
        const sim = total ? null : h('input', { class: 'f-input est-sim-in', type: 'number', min: 0, step: '0.10', placeholder: fmt.brl(precoAtual).replace('R$', '').trim(), title: 'Digite um preço para simular' });
        if (sim) sim.addEventListener('input', () => { const v = parseFloat(String(sim.value).replace(',', '.')); simulado = v > 0; pintarCard(simulado ? v : precoAtual); cardEl.classList.toggle('est-simulando', simulado); });
        if (!total) rod = h('div', { class: 'cupom-rodape' });
        const cardEl = h('div', { class: 'cupom' + (total ? ' est-det-total' : '') + (melhorG === t.g ? ' est-melhor' : '') },
          h('div', { class: 'cupom-head' }, h('span', null, h('b', null, total ? 'Todos os tamanhos' : rotG(t.g)), ` · ${fmt.int(t.qtd)} ${t.qtd === 1 ? 'pacote' : 'pacotes'}`,
            melhorG === t.g ? h('span', { class: 'cli-tag t-fixe-ok', title: 'Deixa mais lucro (sem fixos) por grama de chá' }, 'mais rentável') : null),
            h('span', null, total ? 'no período' : 'por pacote')),
          tb,
          total ? null : h('div', { class: 'est-sim' },
            h('label', null, 'Simular preço R$ ', sim),
            alvoPreco ? h('button', { type: 'button', class: 'est-sim-alvo', title: `Preço em que a margem sem custos fixos chega a ${fmt.pct(margemAlvo, 0)} (a meta da loja em Configurações)`, onclick: () => { sim.value = alvoPreco.toFixed(2); sim.dispatchEvent(new Event('input')); } }, `Para ${fmt.pct(margemAlvo, 0)} sem fixos: ${fmt.brl(alvoPreco)}`) : null),
          rod);
        pintarCard(precoAtual);
        return cardEl;
      };
      const tot = tams.reduce((a, t) => ({ qtd: a.qtd + t.qtd, vt: a.vt + t.vt, custo: a.custo + t.custo, ded: a.ded + t.ded, dedVar: a.dedVar + t.dedVar }), { qtd: 0, vt: 0, custo: 0, ded: 0, dedVar: 0 });
      return h('div', null,
        h('div', { class: 'est-det-grid' }, tams.map((t) => card(t)), tams.length > 1 ? card(tot, true) : null),
        h('div', { class: 'est-det-nota' }, `Custo = chá pelo kg da matéria-prima + saco kraft e etiquetas. Deduções variáveis = comissão, royalties, Simples, maquininha e custos em %. Contribuição = o que o pacote deixa para pagar os custos fixos (é a que vale para decidir preço e qual pacote oferecer). Simular preço: digite um preço e veja as margens novas (as deduções acompanham o preço; o custo não muda). "Para ${fmt.pct(margemAlvo, 0)} de contribuição" mostra o preço que chega na meta da loja. "Mais rentável" = o tamanho que deixa mais contribuição por grama de chá.`));
    });

    const margemMin = (cfg.margemMin ?? 15) / 100, margemAlvo = (cfg.margemAlvo ?? 30) / 100;

    // ---------- ponto de equilíbrio do mês (sem os filtros: mês corrente inteiro da loja) ----------
    function cartaoEquilibrio() {
      const fixos = OUTROS.filter((x) => x.tipo === 'mes');
      const ymAgora = TS.dayToIso(TS.todayDay()).slice(0, 7);
      // despesas de um mês só (IPTU, 13º…): as mesmas que o Resultado soma neste mês também precisam ser pagas
      const pontuais = pontuaisDoMes(ymAgora);
      const PE = TS.contas.pontoEquilibrio({ fixos, pontuais, margem: null });
      const Fp = PE.pontuais, F = PE.total;
      const ini = TS.isoToDay(ymAgora + '-01'), diasMes = new Date(Date.UTC(+ymAgora.slice(0, 4), +ymAgora.slice(5, 7), 0)).getUTCDate();
      let vendas = 0, vtC = 0, cus = 0, varDed = 0, ultimoDia = ini - 1;
      const porDia = new Map();
      const idxFixo = new Set(OUTROS.map((x, k) => (x.tipo === 'mes' ? k : -1)).filter((k) => k >= 0));
      for (let i = 0; i < db.n; i++) {
        if (db.ym[i] !== ymAgora || M.taxa(i)) continue;
        const v = db.vt[i] || 0; vendas += v; if (db.day[i] > ultimoDia) ultimoDia = db.day[i];
        porDia.set(db.day[i], (porDia.get(db.day[i]) || 0) + v);
        const c = M.custo(i); if (c == null) continue;
        const dd = deducoes(i);
        vtC += v; cus += c; varDed += dd.com + dd.roy + dd.imp + dd.maq + dd.outros.reduce((a, x, k) => a + (idxFixo.has(k) ? 0 : x), 0);
      }
      const titulo = `Ponto de equilíbrio de ${TS.ymLabel(ymAgora)}`;
      if (!F) return TS.card(titulo, 'Quanto a loja precisa vender no mês para pagar os custos fixos', h('p', { class: 'muted' }, 'Cadastre os custos fixos (aluguel, salários, energia…) em R$ por mês em Configurações → Lojas → Estoque e margem → Outros custos da loja.'));
      const contrib = vtC ? (vtC - cus - varDed) / vtC : null;
      if (!(contrib > 0)) return TS.card(titulo, null, h('p', { class: 'muted' }, 'Ainda não há vendas com custo neste mês para calcular.'));
      const equilibrio = TS.contas.pontoEquilibrio({ fixos, pontuais, margem: contrib }).equilibrio;
      const dias = Math.max(1, ultimoDia - ini + 1);
      // projeção: a mesma conta de todas as telas (dia da semana, loja aberta, sem o dia em andamento)
      const PM = TS.projecaoMes ? TS.projecaoMes(ymAgora, { base: 'loja', todas: true }) : null;
      const proj = PM ? PM.proj : vendas;
      const falta = equilibrio - vendas;
      const diaEq = (() => { let acc = 0; for (let d = ini; d <= ultimoDia; d++) { acc += porDia.get(d) || 0; if (acc >= equilibrio) return d; } return null; })();
      const resultado = proj * contrib - F;
      const txtPont = Fp ? ` · inclui ${fmt.brl0(Fp)} de despesas só deste mês` : '';
      const conta = `Custos fixos ${fmt.brl0(F)} (${[...fixos, ...pontuais].map((x) => x.nome).join(', ')}${Fp ? `; ${fmt.brl0(Fp)} são despesas só deste mês: ${pontuais.map((x) => x.nome).join(', ')}` : ''}) ÷ margem de contribuição ${fmt.pct(contrib)} = ${fmt.brl0(equilibrio)}. Margem de contribuição = o que sobra de cada venda depois do custo do produto, comissão, royalties, Simples, maquininha e dos custos em % (vendas com custo deste mês).`;
      return TS.card(titulo, 'Quanto a loja precisa vender no mês para pagar os custos fixos (o mês inteiro, sem os filtros)',
        (() => {
          // uma frase diz o que falta (ou que já passou do equilíbrio); os números de apoio e a conta ficam no ⓘ e no title da barra
          const restam = diasMes - dias;
          const nums = `Equilíbrio ${fmt.brl0(equilibrio)} (margem sem fixos ${fmt.pct(contrib)}) · vendido até ${fmt.date(TS.dayToIso(ultimoDia))} ${fmt.brl0(vendas)} (${fmt.pct(vendas / equilibrio, 0)} do equilíbrio) · no ritmo atual ${fmt.brl0(proj)} (${resultado >= 0 ? 'sobra' : 'falta'} ${fmt.brl0(Math.abs(resultado))} de resultado no mês)`;
          const frase = falta > 0
            ? h('p', { class: 'est-eq-frase' }, 'Faltam ', h('b', { class: 'neg' }, fmt.brl0(falta)), ' para pagar os custos fixos',
              restam > 0 ? ` · ${fmt.brl0(falta / restam)} por dia ${restam === 1 ? 'no dia que falta' : `nos ${restam} dias que faltam`}` : '', ` · equilíbrio em ${fmt.brl0(equilibrio)}`, txtPont, TS.dica(`${nums}.\n\n${conta}${PM ? '\n\nRitmo atual (projeção do mês):\n' + TS.comoProjecao(PM) : ''}`))
            : h('p', { class: 'est-eq-frase' }, h('b', { class: 'pos' }, diaEq != null ? `Custos fixos do mês pagos desde ${fmt.date(TS.dayToIso(diaEq)).slice(0, 5)}` : 'Custos fixos do mês já pagos'), ': daqui para frente é lucro',
              ` · já passou ${fmt.brl0(-falta)} do equilíbrio de ${fmt.brl0(equilibrio)}`, txtPont, TS.dica(`${nums}.\n\n${conta}`));
          // escala: o maior entre equilíbrio, vendido e projeção; a barra é o vendido, o traço vermelho é o equilíbrio
          const esc = Math.max(equilibrio, proj, vendas) || 1;
          return h('div', { class: 'est-eq' }, frase,
            h('div', { class: 'est-eq-barra', title: nums },
              h('i', { style: { width: ((vendas / esc) * 100).toFixed(1) + '%' } }),
              h('em', { style: { left: ((equilibrio / esc) * 100).toFixed(1) + '%' }, title: `Equilíbrio ${fmt.brl0(equilibrio)}` }),
              h('u', { style: { left: ((proj / esc) * 100).toFixed(1) + '%' }, title: `Projeção do mês ${fmt.brl0(proj)}` })),
            h('div', { class: 'est-eq-leg' }, h('span', null, h('i', { class: 'l-v' }), 'vendido'), h('span', null, h('i', { class: 'l-e' }), 'equilíbrio'), h('span', null, h('i', { class: 'l-p' }), 'projeção do mês')));
        })());
    }

    // ---------- margem abaixo do mínimo, com o principal motivo ----------
    /** cadastro com preço e custo de cada produto (preço R$ 0,01 = simbólico: fica de fora) */
    // grupo do produto no AppNext (definição única: grupoprod.js); sem venda, o grupo do cadastro de preços
    const tabGrp = new Map(((tabela && tabela.itens) || []).map((t) => [String(t.cod), t.grupo || '']));
    const grpDe = (r) => (r.grp != null ? r.grp : (r.grp = TS.grupoProd.texto(r.cod, r.produto, r.it ? r.it.un === 'Kg' : !!r.granel, tabGrp.get(String(r.cod)))));
    function tabelaLista() {
      let itens = tabela && tabela.itens;
      if (!itens && TS.demo) itens = tabelaDemo(M, estoque);
      if (!itens) return [];
      return itens.filter((t) => t.preco > 0.011).map((t) => {
        const c = M.custoCadastro(t.cod, t.desc);
        const custo = c ? Math.round(c.custo * 100) / 100 : null;
        return { ...t, custo, kg: !!(c && c.kg), g: c ? c.g : null, it: c ? c.it : null, margem: custo != null ? (t.preco - custo) / t.preco : null };
      });
    }
    /** histórico de compras do produto (a mesma janela da nota de entrada); chá a granel: as compras do chá em kg */
    const abrirCompras = (r) => { const mp = r.kg && r.it ? r.it : null; TS.histCompras({ nome: mp ? `${r.nome} (compras de ${mp.desc}, em kg)` : r.nome, cod: mp ? mp.cod : r.cod, un: mp ? 'kg' : 'un', grupo: r.grupoTxt }, (compras && compras.itens) || {}, null); };
    /** Margem de tabela: todos os produtos do cadastro, vendidos ou não */
    function cartaoTabela() {
      const quem = TS.eu && TS.eu.pode && TS.eu.pode.configurar;
      if (!TB.length) return TS.card('Margem de tabela', null, h('p', { class: 'muted' }, 'Ainda não há o preço de tabela do cadastro. ' + (quem ? 'Envie as listagens do AppNext (Produtos → Produtos e Produtos → Produtos Compostos, botão do Excel) em Configurações → Lojas → Dados e atualização → Enviar planilha → "Preço de tabela". O coletor também baixa as duas uma vez por dia.' : 'O coletor baixa uma vez por dia; peça ao administrador.')));
      // deduções variáveis médias do período (comissão, royalties, Simples, maquininha, % da loja): chá e o resto separados
      const dPct = {};
      for (const gr of [true, false]) { const xs = prods.filter((p) => p.granel === gr); const vt = xs.reduce((a, p) => a + p.vt, 0); dPct[gr] = vt ? xs.reduce((a, p) => a + p.dedVar, 0) / vt : 0; }
      // o que vendeu no período, por código do produto vendido (pacote, no chá)
      // (pelo código; sem código nas vendas, pelo nome)
      const real = new Map();
      for (const i of base) {
        if (M.taxa(i) || resg(i)) continue;
        const cod = db.D.cod ? String(db.D.cod[db.cod[i]] ?? '') : '';
        const k = cod || 'n:' + ESQ(db.D.descricao[db.desc[i]]);
        const r = real.get(k) || real.set(k, { vt: 0, custo: 0, qtd: 0, temCusto: true }).get(k);
        const cu = M.custo(i);
        r.vt += db.vt[i] || 0; r.qtd += db.qtd[i] || 0;
        if (cu == null) r.temCusto = false; else r.custo += cu;
      }
      const linhas = TB.map((t) => {
        const r = real.get(t.cod) || real.get('n:' + ESQ(t.desc));
        const mSf = t.margem != null ? t.margem - dPct[t.kg] : null;
        const mReal = r && r.vt > 0 && r.temCusto ? (r.vt - r.custo) / r.vt : null;
        return { ...t, nome: t.desc, mSf, vendido: r ? r.qtd : 0, mReal, desconto: mReal != null && t.margem != null ? t.margem - mReal : null, abaixo: mSf != null && mSf < margemMin, grupoTxt: (t.grupo || '') + (t.sub ? ' · ' + t.sub : '') };
      });
      const F = {
        todos: ['Todos com custo', (r) => r.custo != null],
        abaixo: [`Abaixo da mínima (${fmt.pct(margemMin, 0)})`, (r) => r.abaixo],
        semvenda: ['Sem venda no período', (r) => r.custo != null && !r.vendido],
        desconto: ['Vendido abaixo da tabela', (r) => r.desconto != null && r.desconto > 0.02],
        semcusto: ['Sem custo', (r) => r.custo == null],
      };
      const f = F[state.estTabF] ? state.estTabF : 'todos';
      const grupos = [...new Set(linhas.map((r) => r.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const gSel = grupos.includes(state.estTabG) ? state.estTabG : '';
      const fp = state.f.produto ? TS.norm(state.f.produto) : '';
      const doGrupo = linhas.filter((r) => (!gSel || r.grupo === gSel) && (!fp || TS.norm(r.nome).includes(fp)));
      const conta = (k) => doGrupo.filter(F[k][1]).length;
      const selG = h('select', { class: 'f-input est-tab-g', onchange: (e) => { state.estTabG = e.target.value; TS.render(); } },
        h('option', { value: '' }, 'Grupo: todos'), ...grupos.map((g) => h('option', { value: g, selected: g === gSel || null }, g)));
      const rows = doGrupo.filter(F[f][1]);
      const datas = TS.demo ? 'na apresentação o cadastro é fictício' : [tabela.simples ? `Produtos de ${new Date(tabela.simples.em).toLocaleDateString('pt-BR')}` : 'falta a listagem de Produtos', tabela.compostos ? `Compostos de ${new Date(tabela.compostos.em).toLocaleDateString('pt-BR')}` : 'falta a de Produtos Compostos (chás a granel)'].join(' · ');
      return TS.card('Margem de tabela', `Todos os produtos do cadastro do AppNext, vendidos ou não: preço de tabela (sem desconto) × custo atual. Margem sem fixos estimada com as deduções variáveis médias do período (${fmt.pct(dPct[true], 1)} nos chás a granel, ${fmt.pct(dPct[false], 1)} no resto). "Praticada" = a margem bruta do que vendeu no período; a diferença é o desconto. ${fmt.int(linhas.filter((r) => r.custo != null).length)} de ${fmt.int(linhas.length)} produtos com custo · ${datas}.`,
        h('div', { class: 'est-tab-fx' }, TS.seg(Object.entries(F).map(([k, [t]]) => [`${t} (${fmt.int(conta(k))})`, k]), f, (v) => { state.estTabF = v; TS.render(); }), selG),
        TS.table({
          cols: [
            { key: 'nome', label: 'Produto', align: 'l', sticky: true, wrap: true, title: 'Clique no produto para ver o histórico de compras: cada nota, a quantidade e como o custo variou (no chá a granel, as compras do chá em kg).',
              render: (r) => h('span', null, TS.histCompras ? h('button', { type: 'button', class: 'nf-hist-btn', title: 'Ver o histórico de compras deste produto', onclick: (e) => { e.stopPropagation(); abrirCompras(r); } }, r.nome) : r.nome, h('small', { class: 'est-tam' }, `cód. ${r.cod}${r.grupoTxt ? ' · ' + r.grupoTxt : ''}`)) },
            { key: 'preco', label: 'Preço de tabela', fmt: fmt.brl },
            { key: 'custo', label: 'Custo', title: 'Custo atual do AppNext (chá a granel: gramas × custo do kg + saco kraft e etiquetas)', fmt: (v) => (v == null ? '—' : fmt.brl(v)) },
            { key: 'margem', label: 'Margem bruta', fmt: (v) => (v == null ? '—' : fmt.pct(v)), cls: (r) => (r.margem != null && r.margem < 0.3 ? 'miss' : '') },
            { key: 'mSf', label: 'Margem sem fixos', title: `Margem bruta − deduções variáveis médias do período. Em vermelho abaixo da mínima da loja (${fmt.pct(margemMin, 0)})`, fmt: (v) => (v == null ? '—' : fmt.pct(v)), cls: (r) => (r.abaixo ? 'miss' : '') },
            { key: 'vendido', label: 'Vendido no período', fmt: (v) => (v ? fmt.int(v) : '—') },
            { key: 'mReal', label: 'Praticada', title: 'Margem bruta do que vendeu no período (com os descontos)', fmt: (v) => (v == null ? '—' : fmt.pct(v)) },
            { key: 'desconto', label: 'Desconto', title: 'Margem de tabela − praticada, em pontos: o quanto os descontos tiraram da margem', render: (r) => (r.desconto == null ? '—' : Math.abs(r.desconto) < 0.005 ? h('span', { class: 'muted' }, '0') : h('span', { class: r.desconto > 0.02 ? 'neg' : 'muted' }, `${r.desconto > 0 ? '−' : '+'}${fmt.n1(Math.abs(r.desconto) * 100)} pts`)), sortVal: (r) => r.desconto },
          ],
          rows, sortKey: f === 'abaixo' ? 'mSf' : 'margem', sortDir: f === 'abaixo' ? 'asc' : 'desc', maxHeight: '520px', search: 'Buscar produto ou código…', searchKeys: ['nome', 'cod', 'grupoTxt'], produto: 'nome', cls: 'est-t est-t-larga', pageSize: rows.length > 400 ? 200 : undefined,
          empty: f === 'abaixo' ? 'Nenhum produto com margem de tabela abaixo da mínima. 👏' : 'Nenhum produto aqui.',
        }));
    }
    function cartaoAlertaMargem() {
      const tot = prods.reduce((a, p) => ({ vt: a.vt + p.vt, custo: a.custo + p.custo - p.emb, emb: a.emb + p.emb, com: a.com + p.com, roy: a.roy + p.roy, imp: a.imp + p.imp, maq: a.maq + p.maq, out: a.out + (p.dedVar - p.com - p.roy - p.imp - p.maq) }), { vt: 0, custo: 0, emb: 0, com: 0, roy: 0, imp: 0, maq: 0, out: 0 });
      if (!tot.vt) return null;
      const PARTES = [['custo', 'Custo do produto'], ['emb', 'Embalagem (saco e etiquetas)'], ['com', 'Comissão'], ['roy', 'Royalties'], ['imp', 'Simples'], ['maq', 'Maquininha'], ['out', 'Custos em % da loja']];
      const outVar = (p) => p.dedVar - p.com - p.roy - p.imp - p.maq;
      const media = Object.fromEntries(PARTES.map(([k]) => [k, tot[k] / tot.vt]));
      const baixos = prods.filter((p) => p.margemContrib < margemMin).map((p) => {
        const parte = { custo: (p.custo - p.emb) / p.vt, emb: p.emb / p.vt, com: p.com / p.vt, roy: p.roy / p.vt, imp: p.imp / p.vt, maq: p.maq / p.vt, out: outVar(p) / p.vt };
        const descPct = p.desc > 0 ? p.desc / (p.vt + p.desc) : 0;
        let k = PARTES.map(([k]) => k).sort((a, b) => (parte[b] - media[b]) - (parte[a] - media[a]))[0];
        let motivo = `${PARTES.find((x) => x[0] === k)[1]}: ${fmt.pct(parte[k])} do preço (média da loja ${fmt.pct(media[k])})`;
        if (descPct >= 0.05 && descPct - 0.02 > parte[k] - media[k]) motivo = `Desconto: ${fmt.pct(descPct)} do preço cheio`;
        const un = p.granel ? p.kg : p.qtd;
        return { ...p, motivo, pv: un ? p.vt / un : null, pc: un ? p.custo / un : null };
      }).sort((a, b) => a.contrib - b.contrib);
      if (!baixos.length) return TS.card(`Margem sem fixos abaixo de ${fmt.pct(margemMin, 0)}`, null, h('p', { class: 'muted' }, `Nenhum produto abaixo da margem mínima no período. 👏 (Mude o mínimo em Configurações → Lojas → Estoque e margem.)`));
      return TS.card(`Margem sem fixos abaixo de ${fmt.pct(margemMin, 0)}`, `${fmt.int(baixos.length)} produto(s) no período. Margem sem fixos = o que o produto deixa depois do custo e das deduções variáveis, antes do aluguel e outros fixos. Abaixo do mínimo ele ajuda pouco a pagar os fixos; negativa, ele custa dinheiro à loja. Motivo = o que mais pesa no preço desse produto comparado com a média da loja.`, TS.table({
        cols: [
          TS.grupoProd.coluna({ key: 'produto', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => (r.granel ? h('span', null, r.produto, h('small', { class: 'est-tam' }, r.tamanhos)) : r.produto) }, grpDe),
          { key: 'pv', label: 'Preço de venda', title: 'Preço médio vendido no período (chá a granel: por kg; o resto: por unidade)', render: (r) => h('span', null, fmt.brl(r.pv), h('small', { class: 'est-tam' }, r.granel ? 'por kg' : 'por un.')), sortVal: (r) => r.pv },
          { key: 'pc', label: 'Preço de custo', title: 'Custo médio no período (chá a granel: por kg, com saco e etiquetas; o resto: por unidade)', render: (r) => h('span', null, fmt.brl(r.pc), h('small', { class: 'est-tam' }, r.granel ? 'por kg' : 'por un.')), sortVal: (r) => r.pc },
          { key: 'vt', label: 'Faturamento', fmt: fmt.brl },
          { key: 'margem', label: 'Margem bruta', fmt: (v) => fmt.pct(v) },
          { key: 'contrib', label: 'Lucro sem fixos', fmt: fmt.brl, cls: (r) => (r.contrib < 0 ? 'miss' : '') },
          { key: 'margemContrib', label: 'Margem sem fixos', title: 'Clique para ver toda a conta', fmt: (v) => fmt.pct(v), render: (r) => h('button', { type: 'button', class: 'est-conta neg', title: 'Clique para ver toda a conta', onclick: (e) => abrirLiq(e, r) }, fmt.pct(r.margemContrib)), sortVal: (r) => r.margemContrib },
          { key: 'margemLiq', label: 'Margem com fixos', title: 'Com os custos fixos rateados (informativa)', fmt: (v) => fmt.pct(v) },
          { key: 'motivo', label: 'Principal motivo', align: 'l', wrap: true },
        ],
        rows: baixos, sortKey: 'margemContrib', sortDir: 'asc', maxHeight: '360px', cls: 'est-t est-t-larga',
      }));
    }

    // ---------- qual pacote oferecer: lucro líquido por 100 g de chá em cada tamanho ----------
    function cartaoPacotes() {
      const TAMS = [50, 100, 250, 500, 1000];
      const rotG = (g) => (g >= 1000 ? `${g / 1000} kg` : `${g}g`);
      const linhas = prods.filter((p) => p.granel && p.porTam && p.porTam.size >= 2).map((p) => {
        const r = { produto: p.produto, tamanhos: p.tamanhos };
        let melhor = null, pior = null;
        for (const [g, t] of p.porTam) {
          if (!t.qtd) continue;
          const por100 = ((t.vt - t.custo - t.dedVar) / t.qtd) * (100 / g);
          r['g' + g] = por100;
          if (!melhor || por100 > melhor.v) melhor = { g, v: por100 };
          if (!pior || por100 < pior.v) pior = { g, v: por100 };
        }
        r.melhor = melhor ? rotG(melhor.g) : '';
        r.ganho = melhor && pior && pior.v > 0 ? melhor.v / pior.v - 1 : null;
        r.dica = melhor && pior && melhor.g !== pior.g ? `Cada 100 g vendidos em ${rotG(melhor.g)} deixam ${fmt.brl(melhor.v - pior.v)} a mais de lucro (sem fixos) do que em ${rotG(pior.g)}.` : '';
        return r;
      }).sort((a, b) => (b.ganho ?? -1) - (a.ganho ?? -1));
      if (!linhas.length) return null;
      const usados = TAMS.filter((g) => linhas.some((r) => r['g' + g] != null));
      return TS.card('Qual pacote oferecer', 'Lucro sem custos fixos (lucro bruto − deduções variáveis) a cada 100 g de chá vendido, em cada tamanho de pacote. Ajuda a equipe a saber quando vale oferecer o pacote maior (ex.: um de 100g em vez de dois de 50g).', TS.table({
        cols: [
          { key: 'produto', label: 'Chá', align: 'l', sticky: true, wrap: true },
          ...usados.map((g) => ({ key: 'g' + g, label: rotG(g), title: `Lucro sem fixos por 100 g de chá vendido em pacotes de ${rotG(g)}`, fmt: (v) => (v == null ? '—' : fmt.brl(v)), cls: (r) => (r.melhor === rotG(g) ? 'hit' : '') })),
          { key: 'melhor', label: 'Mais rentável', align: 'l', title: 'Tamanho que deixa mais lucro (sem fixos) por grama' },
          { key: 'dica', label: 'Diferença', align: 'l', wrap: true },
        ],
        rows: linhas, sortKey: null, maxHeight: '420px', search: 'Buscar chá…', searchKeys: ['produto'], produto: 'produto', cls: 'est-t',
      }));
    }

    // ---------- custos que mudaram no AppNext ----------
    function cartaoCustos() {
      const datas = Object.values(historico || {}).flatMap((l) => l.map((x) => x[0]));
      if (!datas.length) return null;
      const inicio = datas.sort()[0];
      const limite = TS.dayToIso(TS.todayDay() - 90);
      // consumo no período (kg ou unidades do item) para medir o efeito da mudança
      const consumoItem = new Map();
      for (const i of base) { if (M.taxa(i)) continue; for (const [it, q] of M.consumo(i)) consumoItem.set(it.cod, (consumoItem.get(it.cod) || 0) + q); }
      const porCodItem = M.porCod;
      const linhas = [];
      for (const [cod, l] of Object.entries(historico)) {
        if (l.length < 2) continue;
        const ult = l[l.length - 1];
        const ref = [...l].reverse().find((x) => x[0] <= limite && x !== ult) || l[0];
        if (ref === ult || !(ref[1] > 0)) continue;
        const v = ult[1] / ref[1] - 1;
        if (Math.abs(v) < 0.03) continue;
        const it = porCodItem.get(cod);
        const cons = consumoItem.get(cod) || 0;
        linhas.push({ cod, item: it ? it.desc : cod, un: it && it.un === 'Kg' ? 'kg' : 'un', antes: ref[1], deData: ref[0], agora: ult[1], ateData: ult[0], v, efeito: cons * (ult[1] - ref[1]) });
      }
      linhas.sort((a, b) => Math.abs(b.efeito) - Math.abs(a.efeito) || Math.abs(b.v) - Math.abs(a.v));
      const sub = `Comparação do custo atual do AppNext com o de ~90 dias atrás (ou o primeiro registrado). O painel guarda o custo a cada planilha de estoque desde ${fmt.date(inicio)}.`;
      if (!linhas.length) return TS.card('Custos que mudaram', sub, h('p', { class: 'muted' }, 'Nenhum custo mudou 3% ou mais até agora. As mudanças aparecem aqui conforme novas planilhas de estoque chegam.'));
      return TS.card('Custos que mudaram', sub, TS.table({
        cols: [
          { key: 'item', label: 'Item do estoque', align: 'l', sticky: true, wrap: true },
          { key: 'antes', label: 'Antes', render: (r) => h('span', null, fmt.brl(r.antes), h('small', { class: 'est-tam' }, fmt.date(r.deData))), sortVal: (r) => r.antes },
          { key: 'agora', label: 'Agora', render: (r) => h('span', null, fmt.brl(r.agora), h('small', { class: 'est-tam' }, fmt.date(r.ateData))), sortVal: (r) => r.agora },
          { key: 'v', label: 'Variação', fmt: (v) => fmt.delta(v), cls: (r) => (r.v > 0 ? 'neg' : 'pos') },
          { key: 'efeito', label: 'Efeito no período', title: 'Quanto o custo do que foi vendido no período mudou por causa disso (consumo × diferença de custo). Positivo = margem menor', fmt: (v) => (Math.abs(v) < 0.005 ? '—' : (v > 0 ? '+' : '') + fmt.brl(v)), cls: (r) => (r.efeito > 0 ? 'neg' : r.efeito < 0 ? 'pos' : '') },
        ],
        rows: linhas, sortKey: null, maxHeight: '360px', search: 'Buscar item…', searchKeys: ['item'], cls: 'est-t',
      }));
    }

    // ---------- reposição: últimos 30 dias da loja (sem os filtros) + sazonalidade do ano passado ----------
    const ent = cfg.entregaDias, cob = cfg.coberturaDias, seg = cfg.segurancaPct ?? 50;
    const H = ent + cob; // horizonte do pedido
    const fim = db.maxDay, ini = fim - 29;
    // ano passado: os 30 dias equivalentes aos de agora e os H dias seguintes (o que vem pela frente)
    const lyB0 = fim - 364 - 29, lyB1 = fim - 364, lyN0 = fim - 363, lyN1 = fim - 364 + H;
    const temAnoPassado = db.minDay <= lyB0;
    const cons = new Map(), ultimaVenda = new Map(), lyB = new Map(), lyN = new Map(), lyDias = new Map();
    const tot = { kg: { b: 0, n: 0, r: 0 }, un: { b: 0, n: 0, r: 0 } };
    for (let i = 0; i < db.n; i++) {
      const d = db.day[i];
      for (const [it, q] of M.consumo(i)) {
        const g = it.un === 'Kg' ? tot.kg : tot.un;
        if (d >= ini) { cons.set(it.cod, (cons.get(it.cod) || 0) + q); g.r += q; }
        if (d >= lyB0 && d <= lyB1) { lyB.set(it.cod, (lyB.get(it.cod) || 0) + q); g.b += q; (lyDias.get(it.cod) || lyDias.set(it.cod, new Set()).get(it.cod)).add(d); }
        else if (d >= lyN0 && d <= lyN1) { lyN.set(it.cod, (lyN.get(it.cod) || 0) + q); g.n += q; }
        if (!ultimaVenda.has(it.cod) || d > ultimaVenda.get(it.cod)) ultimaVenda.set(it.cod, d);
      }
    }
    const lim = (f) => Math.min(3, Math.max(0.4, f));
    // fator da loja (chá a granel e produtos à parte): ritmo dos próximos H dias ÷ ritmo dos 30 dias, no ano passado
    const fatLoja = (g) => (temAnoPassado && g.b > 0 && g.n > 0 ? lim((g.n / H) / (g.b / 30)) : 1);
    const FL = { kg: fatLoja(tot.kg), un: fatLoja(tot.un) };
    /** fator de sazonalidade do item: do próprio item quando vendeu o bastante no ano passado; senão, o da loja */
    function sazonal(it) {
      if (!temAnoPassado) return { f: 1, origem: 'sem' };
      const b = lyB.get(it.cod) || 0, n = lyN.get(it.cod) || 0, dias = (lyDias.get(it.cod) || new Set()).size;
      if (dias >= 6 && b > 0) return { f: lim((n / H) / (b / 30)), origem: 'item' };
      return { f: FL[it.un === 'Kg' ? 'kg' : 'un'], origem: 'loja' };
    }
    // fora de linha: indisponível no Sistema de Pedidos há 90+ dias seguidos (o painel acompanha o catálogo desde foraDeLinha.desde)
    const FL_DIAS = (foraDeLinha && foraDeLinha.dias) || 90;
    const foraLinhaDe = (cod) => {
      return TS.visaoDono.foraLinhaDe(foraDeLinha, cod, TS.todayDay()); // a mesma regra do Início (lojas lado a lado)
    };
    TS.estoqueForaLinhaDe = foraLinhaDe; // testes
    const repo = [];
    let valorEstoque = 0, valorParado = 0;
    const parados = [];
    const todos = []; // todos os produtos da planilha do AppNext (a tabela única da tela Estoque)
    for (const it of estoque.itens) {
      const vel = (cons.get(it.cod) || 0) / 30;
      const sz = sazonal(it);
      const prev = vel * sz.f; // venda por dia esperada nos próximos dias
      const qtd = Math.max(0, it.qtd || 0);
      if (it.custo && qtd > 0) valorEstoque += qtd * it.custo;
      const dias = prev > 0 ? qtd / prev : null;
      let pedir = Math.max(0, prev * H - qtd, (it.min || 0) - qtd);
      pedir = it.un === 'Kg' ? Math.ceil(pedir * 10) / 10 : Math.ceil(pedir);
      let sit = 'ok';
      if (prev > 0 && qtd <= 0) sit = 'acabou';
      else if (dias != null && dias < ent) sit = 'falta';
      else if (it.min && qtd < it.min) sit = 'minimo';
      else if (dias != null && dias < H) sit = 'pedir';
      const ult = ultimaVenda.get(it.cod);
      const vendeuAlgumaVez = ult != null;
      if (TS.visaoDono.ehParado({ qtd, custo: it.custo, foraLinha: foraLinhaDe(it.cod), ult, fim, paradoDias: cfg.paradoDias, novoPN: temCod && it.tipo === 'PN' })) { // fora de linha conta à parte (liquidar)
        const v = qtd * it.custo; valorParado += v;
        parados.push({ cod: it.cod, produto: it.desc, tipo: TIPO_ITEM(it), qtd, it, valor: v, ultima: vendeuAlgumaVez ? TS.dayToIso(ult) : null, dias: vendeuAlgumaVez ? fim - ult : null });
      }
      // mínimo sugerido: o que deve vender durante a entrega + margem de segurança
      let sug = prev * ent * (1 + seg / 100);
      sug = sug <= 0 ? null : it.un === 'Kg' ? Math.ceil(sug * 10) / 10 : Math.ceil(sug);
      const minSit = sug == null ? null : !it.min ? 'sem' : it.min > sug * 2 ? 'alto' : it.min < sug * 0.7 ? 'baixo' : 'ok';
      const linha = { cod: it.cod, produto: it.desc, tipo: TIPO_ITEM(it), it, qtd, min: it.min, sug, minSit, vel, prev, fator: sz.f, origem: sz.origem, dias, pedir, custoPedido: pedir * (it.custo || 0), sit };
      if (vel > 0 || (it.min && qtd < it.min)) repo.push(linha);
      const parado = parados.length && parados[parados.length - 1].cod === it.cod;
      todos.push({ ...linha, valor: it.custo && qtd > 0 ? qtd * it.custo : 0, ultima: vendeuAlgumaVez ? TS.dayToIso(ult) : null, semVenda: vendeuAlgumaVez ? fim - ult : null, parado: !!parado, nunca: !vendeuAlgumaVez, foraLinha: foraLinhaDe(it.cod) });
    }
    // venda perdida por falta (zerado que vendia) e excesso (vende, mas sobra): contas em ruptura.js
    const RUP = TS.ruptura.marcar({ linhas: todos, M, H, espera });
    const diasTxt = (d) => (d == null ? '—' : `${fmt.int(d)} ${Math.round(d) === 1 ? 'dia' : 'dias'}`);
    const porque = (r) => ({
      acabou: `Estoque zerado e a previsão é vender ${qtdTxt(r.prev, r.it)} por dia.`,
      falta: `O estoque dura ${diasTxt(r.dias)} e a entrega leva ${ent} dias: acaba antes de o pedido chegar.`,
      minimo: `Estoque de ${qtdTxt(r.qtd, r.it)} abaixo do mínimo de ${qtdTxt(r.min, r.it)} cadastrado no AppNext.`,
      pedir: `O estoque dura ${diasTxt(r.dias)}: menos que a entrega (${ent} dias) + o período do pedido (${cob} dias). Hora de pedir.`,
      ok: `O estoque dura ${diasTxt(r.dias)}: dá para a entrega e o período do pedido.`,
    })[r.sit];
    const sugTxt = (r) => {
      const base = `Previsão ${qtdTxt(r.prev, r.it)}/dia × ${ent} dias de entrega = ${qtdTxt(r.prev * ent, r.it)}, + ${seg}% de segurança = ${qtdTxt(r.sug, r.it)}.`;
      return base + ({
        sem: ' Este produto não tem mínimo no AppNext: vale cadastrar.',
        alto: ` O mínimo do AppNext (${qtdTxt(r.min, r.it)}) está bem acima: prende dinheiro em estoque.`,
        baixo: ` O mínimo do AppNext (${qtdTxt(r.min, r.it)}) está baixo: o produto pode acabar antes do pedido chegar.`,
        ok: ` O mínimo do AppNext (${qtdTxt(r.min, r.it)}) está adequado.`,
      })[r.minSit];
    };
    const prevTxt = (r) => {
      if (r.origem === 'sem') return 'A loja ainda não tem um ano de histórico: a previsão é o ritmo dos últimos 30 dias.';
      const var_ = r.fator >= 1 ? `${fmt.int((r.fator - 1) * 100)}% a mais` : `${fmt.int((1 - r.fator) * 100)}% a menos`;
      return r.origem === 'item'
        ? `No ano passado, nos ${H} dias que vêm agora, este produto vendeu ${var_} por dia do que nos 30 dias anteriores. Ritmo de agora ${qtdTxt(r.vel, r.it)}/dia × ${fmt.n2(r.fator)} = ${qtdTxt(r.prev, r.it)}/dia.`
        : `Este produto vendeu pouco no ano passado; usei o movimento da loja toda nessa época (${var_} por dia). Ritmo de agora ${qtdTxt(r.vel, r.it)}/dia × ${fmt.n2(r.fator)} = ${qtdTxt(r.prev, r.it)}/dia.`;
    };
    const contaPedido = (r) => {
      const precisa = r.prev * (ent + cob);
      const pelaVenda = `Previsão ${qtdTxt(r.prev, r.it)}/dia × (${ent} dias de entrega + ${cob} dias de pedido) = ${qtdTxt(precisa, r.it)} − estoque ${qtdTxt(r.qtd, r.it)}`;
      const peloMin = r.min && r.min - r.qtd > precisa - r.qtd ? ` · o mínimo do AppNext pede mais: ${qtdTxt(r.min, r.it)} − estoque = ${qtdTxt(r.min - r.qtd, r.it)}` : '';
      return `${pelaVenda}${peloMin}. Arredondado para ${qtdTxt(r.pedir, r.it)}.`;
    };
    const SIT = { acabou: ['Acabou', 'erro', 0], falta: ['Falta antes da entrega', 'erro', 1], minimo: ['Abaixo do mínimo', 'erro', 2], pedir: ['Pedir', 'warn', 3], ok: ['OK', 'ok', 4] };
    const repor = repo.filter((r) => r.sit !== 'ok' && r.pedir > 0 && !foraLinhaDe(r.cod)); // fora de linha não se repõe
    const urgentes = repor.filter((r) => r.sit === 'acabou' || r.sit === 'falta').length;

    // ---------- KPIs ----------
    // Rentabilidade (revisão de 22/11): o "como está" num cartão-herói — lucro bruto, sem fixos e com fixos, cada um com a margem;
    // "ver a conta" abre a mesma janela de antes. A cobertura do custo fica numa linha do primeiro número.
    const verConta = (rot) => h('button', { type: 'button', class: 'link-btn est-heroi-conta', onclick: (e) => abrirLiq(e, { produto: 'todos os produtos com custo', vt: fatCusto, custo: custoTot, lucro, ...dedTot, outros: outrosTot, ded: dedSoma, lucroLiq: lucroLiqTot }) }, rot);
    const margemTxt = (v) => h('span', { class: v != null && v < 0 ? 'neg' : null }, `margem de ${fmt.pct(fatCusto ? v : null)}`);
    put(R, h('div', { class: 'est-heroi' }, TS.heroi([
      { rot: 'Lucro bruto', num: fmt.brl0(lucro), dica: 'Faturamento − custo dos produtos (com embalagem nos chás a granel), só das vendas que têm custo',
        linhas: [margemTxt(fatCusto ? lucro / fatCusto : null), h('span', { class: 'muted', title: 'Parte do faturamento (sem taxas) cujo custo o painel encontrou' }, `vendas com custo: ${fmt.pct(fat ? fatCusto / fat : null, 0)} (${fmt.brl0(fatCusto)} de ${fmt.brl0(fat)})`)] },
      { rot: 'Lucro sem fixos', num: fmt.brl0(contribTot), estado: contribTot < 0 ? 'ruim' : null, dica: 'Lucro bruto − deduções variáveis (comissão, royalties, Simples, maquininha e custos em %). É o que as vendas deixam para pagar os custos fixos.',
        linhas: [margemTxt(fatCusto ? contribTot / fatCusto : null), verConta('ver a conta ›')] },
      { rot: 'Lucro com fixos', num: fmt.brl0(lucroLiqTot), estado: lucroLiqTot < 0 ? 'ruim' : null,
        dica: `Lucro bruto − comissão ${fmt.brl0(dedTot.com)} − royalties ${fmt.brl0(dedTot.roy)} − Simples ${fmt.brl0(dedTot.imp)} (${fmt.pct(pSimples)}) − maquininha ${fmt.brl0(dedTot.maq)} (${fmt.pct(pCartao)})${OUTROS.length ? ` − outros custos ${fmt.brl0(dedTot.out)}` : ''}.${!pSimples && !pCartao ? ' Configure o % do Simples e da maquininha em Configurações → Lojas → Estoque e margem.' : ''}`,
        linhas: [margemTxt(fatCusto ? lucroLiqTot / fatCusto : null), verConta('ver a conta ›')] },
    ], { titulo: 'Lucro do período' })));
    // 2ª passada (23/11/2026, proposta do Figma aprovada pelo dono): no lugar dos 5 quadros, o cartão-herói com os 3 números
    // que decidem — perdendo por falta · para repor (com "Montar o pedido") · estoque a custo, com parado e sobrando em linhas.
    // Cada número leva à aba da tabela (TS.estFiltrar), como os quadros faziam; nenhum número saiu da tela.
    const irT = (k) => (e) => { if (e) e.preventDefault(); if (TS.estFiltrar) TS.estFiltrar(k); };
    const verT = (rot, k) => h('button', { type: 'button', class: 'link-btn est-heroi-conta est-p2-ir', 'data-aba': k, onclick: irT(k) }, rot);
    const fT = RUP.falta, sT = RUP.sobra, dR = TS.ruptura.dicas(RUP, { H });
    const comSaldo = estoque.itens.filter((i) => i.qtd > 0).length;
    const pedidoSug = repor.reduce((s, r) => s + r.custoPedido, 0);
    const podePedH = (TS.telasEstoque || []).includes('pedido');
    const temCustoE = valorEstoque > 0;
    put(E, h('div', { class: 'est-heroi est-p2-heroi' }, TS.heroi([
      { rot: 'Perdendo por falta', num: fT.comConta ? fmt.brl0(fT.perdaDia) : '—', sub: fT.comConta ? 'por dia' : null, estado: fT.n ? 'ruim' : null, dica: dR.falta,
        linhas: [fT.n ? verT(`${fmt.int(fT.n)} ${fT.n === 1 ? 'produto zerado que vende' : 'produtos zerados que vendem'} ›`, 'falta') : 'nenhum produto zerado que vendia',
          fT.n && (fT.esperando || fT.comConta) ? h('span', { class: 'muted' }, [fT.esperando ? `⏳ ${fmt.int(fT.esperando)} com cliente esperando` : null, fT.comConta ? `${fmt.brl0(fT.acumulado)} perdidos até agora` : null].filter(Boolean).join(' · ')) : null] },
      { rot: 'Para repor', num: fmt.int(repor.length), sub: repor.length === 1 ? 'produto' : 'produtos',
        dica: `Produtos que vendem e cujo saldo não cobre a entrega (${ent} dias) + o período do pedido (${cob} dias): a lista do que pedir agora. Urgente = acabou ou acaba antes de o pedido chegar. Pedido sugerido = quantidade a pedir × custo do AppNext.`,
        linhas: [repor.length ? { el: `${fmt.int(urgentes)} ${urgentes === 1 ? 'urgente' : 'urgentes'} · pedido sugerido ${fmt.brl0(pedidoSug)}`, cls: urgentes ? 'neg' : null } : 'nada para repor agora 👏',
          repor.length ? h('div', { class: 'est-p2-acoes' }, podePedH ? h('a', { class: 'btn primary', href: '#pedido' }, 'Montar o pedido ›') : null, verT('ver na tabela ›', 'repor')) : null] },
      { rot: temCustoE ? 'Estoque a custo' : 'Com saldo', num: temCustoE ? fmt.brl0(valorEstoque) : fmt.int(comSaldo),
        dica: `Saldo de cada produto × custo unitário do AppNext. Parado = com saldo e sem venda há ${cfg.paradoDias}+ dias (dinheiro parado). ${dR.sobra.replace(/ Toque para ver.*$/, '')} Toque numa linha para ver os produtos na tabela.`,
        linhas: [verT(`${fmt.int(comSaldo)} ${comSaldo === 1 ? 'produto com saldo' : 'produtos com saldo'} ›`, 'saldo'),
          TS.linhasNum([
            { rot: `Parado · ${fmt.int(parados.length)} ${parados.length === 1 ? 'produto sem venda' : 'produtos sem venda'} há ${cfg.paradoDias}+ dias`, num: fmt.brl0(valorParado), estado: parados.length ? 'atencao' : null, onclick: irT('parados') },
            { rot: `Sobrando · ${fmt.int(sT.n)} ${sT.n === 1 ? 'produto que vende devagar' : 'produtos que vendem devagar'}`, num: sT.n ? fmt.brl0(sT.valor) : '—', estado: sT.n ? 'atencao' : null, onclick: irT('sobrando') },
          ])] },
    ])));

    if (EQ) { corpo.append(cartaoEquilibrio()); return; }

    // ---------- matriz giro × margem ----------
    const CLASSE = { estrela: ['Estrela', '#1F5FBF'], volume: ['Volume', '#C9A227'], joia: ['Joia', '#2C5234'], peso: ['Peso morto', '#B5452B'] };
    // chá a granel compara com chá (kg, somando 50g, 100g, 250g…); acessórios e envasados entre si (unidades).
    // A conta é a mesma da classe oficial (classeprod.js): mediana + margens mínima e alvo da loja, só que com as vendas do período
    const MED = {};
    for (const gr of [true, false]) {
      const xs = prods.filter((p) => p.granel === gr);
      const cl = TS.classeProd.classificar(xs.map((p) => ({ cod: p, giro: p.giro, margem: p.margem, margemSf: p.margemContrib })), { min: margemMin, alvo: margemAlvo });
      MED[gr] = { q: TS.classeProd.mediana(xs.map((p) => p.giro)), m: TS.classeProd.mediana(xs.map((p) => p.margem)) };
      for (const p of xs) p.classe = cl.get(p).auto;
    }
    // classe oficial (fixa, últimos 3/6/12 meses fechados) e a tendência: o que saiu por mês no período × a mediana mensal oficial
    const CO = TS.classeOficial(M, ccfg);
    // ---------- preço de tabela (cadastro do AppNext: Produtos + Produtos Compostos) ----------
    const TB = tabelaLista();
    const tabPorCod = new Map(TB.map((t) => [t.cod, t]));
    const tabPorMp = new Map(); // matéria-prima do chá → pacotes do cadastro
    for (const t of TB) if (t.kg && t.it) (tabPorMp.get(String(t.it.cod)) || tabPorMp.set(String(t.it.cod), []).get(String(t.it.cod))).push(t);
    for (const p of prods) {
      if (p.granel) {
        // chá: média dos pacotes pela quantidade vendida de cada tamanho (sem venda do tamanho, não entra)
        let v = 0, c = 0;
        for (const t of tabPorMp.get(p.cod) || []) { const q = p.tam.get(t.g) || 0; if (q && t.custo != null) { v += q * t.preco; c += q * t.custo; } }
        p.margemTab = v ? (v - c) / v : null;
      } else {
        const t = tabPorCod.get(p.cod);
        p.margemTab = t && t.custo != null ? t.margem : null;
      }
    }
    let dMin = Infinity, dMax = -Infinity;
    for (const i of base) { const d = db.day[i]; if (d < dMin) dMin = d; if (d > dMax) dMax = d; }
    const diasPer = dMax >= dMin ? dMax - dMin + 1 : 0;
    for (const p of prods) {
      p.of = CO.get(p.cod) || null;
      p.oficial = p.of ? p.of.classe : null;
      p.porMes = diasPer ? (p.giro / diasPer) * 30 : null;
      p.tend = p.of && p.of.giro > 0 && p.porMes != null ? p.porMes / p.of.giro - 1 : null;
    }
    const podeTravar = !!(TS.eu && TS.eu.pode && TS.eu.pode.configurar) && state.loja && state.loja !== 'todas';
    // a regra da classe em palavras (vai nos ⓘ): mediana + margens mínima e alvo da loja
    const COMO_CLASSE = `Como é a conta: "vende muito" = vende pelo menos a mediana (metade dos produtos do mesmo tipo vende menos). "Margem boa" = margem bruta na mediana ou acima E margem sem fixos de pelo menos ${fmt.pct(margemMin, 0)} (a margem mínima da loja). Vende muito: Estrela com margem boa, Volume sem ela. Vende pouco: Joia com margem boa ou com margem sem fixos de ${fmt.pct(margemAlvo, 0)} ou mais (a margem alvo da loja); Peso morto só quando vende pouco E a margem sem fixos fica abaixo de ${fmt.pct(margemAlvo, 0)}. As duas margens mudam em Configurações → Lojas → Estoque e margem.`;
    const ORD_CL = { estrela: 4, volume: 3, joia: 2, peso: 1 };
    const tagCl = (k, extra) => h('span', { class: 'est-tag', style: { '--cor': CLASSE[k][1] } }, (extra || '') + CLASSE[k][0]);
    async function travar(p, valor, sel) {
      sel.disabled = true;
      try { await TS.salvarClasse(state.loja, { cod: p.cod, nome: p.produto, classe: valor || null }); TS.render(); }
      catch (err) { sel.disabled = false; alertaLinha(sel, err.message); }
    }
    function alertaLinha(el, msg) { const m = h('small', { class: 'neg est-cl-erro' }, msg); el.after(m); setTimeout(() => m.remove(), 4000); }
    function celOficial(p) {
      if (!p.oficial) return h('span', { class: 'muted', title: `Sem venda com custo nos últimos ${CO.meses} meses fechados` }, '—');
      const tag = tagCl(p.oficial, p.of.fixa ? '🔒 ' : '');
      const dica = p.of.fixa
        ? `Travada à mão por ${p.of.fixa.por || '—'}${p.of.fixa.em ? ' em ' + new Date(p.of.fixa.em).toLocaleDateString('pt-BR') : ''}. Pela conta seria ${p.of.auto ? CLASSE[p.of.auto][0] : '—'}.`
        : `Pela conta: vende ${p.granel ? fmt.kg(p.of.giro) + ' kg' : fmt.n2(p.of.giro).replace(/,00$/, '') + ' un.'} por mês (mediana de ${CO.meses} meses; metade dos ${p.granel ? 'chás' : 'produtos'} vende mais de ${p.granel ? fmt.kg(p.of.medGiro) + ' kg' : fmt.n2(p.of.medGiro).replace(/,00$/, '') + ' un.'}) e margem bruta de ${fmt.pct(p.of.margem)} (mediana ${fmt.pct(p.of.medMargem)})${p.of.margemSf != null ? `; margem sem fixos de ${fmt.pct(p.of.margemSf)} (mínima da loja ${fmt.pct(CO.min, 0)}, alvo ${fmt.pct(CO.alvo, 0)})` : ''}.${p.of.porque === 'min' ? ' A margem passa da mediana, mas fica abaixo da mínima da loja: não conta como margem boa.' : p.of.porque === 'alvo' ? ' Vende pouco e a margem fica abaixo da mediana, mas chega na margem alvo da loja: é Joia, não Peso morto.' : ''}`;
      if (!podeTravar) return h('span', { title: dica }, tag);
      const sel = h('select', { class: 'est-cl-sel', title: 'Travar a classe à mão (vale no Pedido também). "Automática" volta para a conta.' },
        h('option', { value: '' }, `Automática${p.of.auto ? ' (' + CLASSE[p.of.auto][0] + ')' : ''}`),
        ...Object.entries(CLASSE).map(([k, [n]]) => h('option', { value: k, selected: p.of.fixa && p.of.fixa.classe === k ? true : null }, '🔒 ' + n)));
      sel.addEventListener('change', () => travar(p, sel.value, sel));
      return h('span', { class: 'est-cl-of', title: dica }, tag, sel);
    }
    const celTend = (p) => {
      if (p.tend == null) return h('span', { class: 'muted' }, '—');
      const v = p.tend, txt = `${v >= 0 ? '+' : '−'}${fmt.int(Math.abs(v) * 100)}%`;
      const cls = v >= 0.2 ? 'pos' : v <= -0.2 ? 'neg' : 'muted';
      return h('span', { class: cls, title: `No período saiu o equivalente a ${p.granel ? fmt.kg(p.porMes) + ' kg' : fmt.n2(p.porMes).replace(/,00$/, '') + ' un.'} por mês, contra ${p.granel ? fmt.kg(p.of.giro) + ' kg' : fmt.n2(p.of.giro).replace(/,00$/, '') + ' un.'} por mês na classe oficial (mediana de ${CO.meses} meses).` }, `${v >= 0.2 ? '↑' : v <= -0.2 ? '↓' : '→'} ${txt}`);
    };
    const ctlMeses = h('div', { class: 'est-cl-meses' },
      h('span', { class: 'f-label' }, 'Classe oficial:'),
      podeTravar
        ? TS.seg([['3 meses', '3'], ['6 meses', '6'], ['12 meses', '12']], String(CO.meses), async (v) => {
          try { await TS.salvarClasse(state.loja, { meses: +v }); TS.render(); } catch (err) { alertaLinha(ctlMeses.lastChild, err.message); }
        })
        : h('b', null, `${CO.meses} meses`),
      h('small', { class: 'muted' }, `meses fechados de ${CO.de.split('-').reverse().join('/')} a ${CO.ate.split('-').reverse().join('/')} · não muda com o filtro · vale para o Pedido`));
    const grSel = state.estGrupo === 'un' ? false : true;
    const prodsG = prods.filter((p) => p.granel === grSel);
    // curva ABC por lucro
    const ord = [...prods].sort((a, b) => b.lucro - a.lucro);
    const lucroPos = ord.reduce((s, p) => s + Math.max(0, p.lucro), 0);
    let ac = 0;
    for (const p of ord) { ac += Math.max(0, p.lucro); p.abc = !lucroPos ? 'C' : ac / lucroPos <= 0.8 ? 'A' : ac / lucroPos <= 0.95 ? 'B' : 'C'; }

    if (R) {
    const conta = Object.fromEntries(Object.keys(CLASSE).map((k) => [k, prodsG.filter((p) => p.classe === k).length]));
    const un = grSel ? 'kg' : 'un.';
    const fq = (v) => (grSel ? `${fmt.kg(v)} kg` : `${fmt.int(v)} un.`);
    const DESC = {
      estrela: `Vende muito e tem margem boa (acima da metade dos produtos e da mínima da loja, ${fmt.pct(margemMin, 0)}). Não pode faltar.`,
      volume: 'Vende muito, mas a margem é menor. Vale rever preço ou custo.',
      joia: 'Margem boa, mas vende pouco. Merece vitrine, degustação e indicação.',
      peso: `Vende pouco e a margem sem fixos fica abaixo do alvo da loja (${fmt.pct(margemAlvo, 0)}). Candidato a promoção ou a sair do mix.`,
    };
    const sel = CLASSE[state.estClasse] ? state.estClasse : null;
    const mq = MED[grSel];
    // abas internas: uma parte por vez (no celular a tela inteira passava de 30 mil px); a aba fica lembrada
    const ABAS_R = [['Visão geral', 'geral'], ['Produtos', 'produtos'], ['Margem de tabela', 'tabela'], ['Pacotes', 'pacotes'], ['Vendedoras', 'vendedoras'], ['Kits', 'kits']];
    const abaR = ABAS_R.some(([, k]) => k === state.rentAba) ? state.rentAba : 'geral';
    const irAba = (k) => { state.rentAba = k; TS.render(); };
    corpo.append(h('div', { class: 'est-abas mt' }, TS.seg(ABAS_R, abaR, irAba)));
    const legenda = h('div', { class: 'est-classes' }, Object.entries(CLASSE).map(([k, [n, c]]) => h('button', {
      type: 'button', class: 'est-classe' + (sel === k ? ' on' : sel ? ' off' : ''), style: { '--cor': c }, 'aria-pressed': sel === k ? 'true' : 'false',
      title: sel === k ? 'Clique de novo para ver todos' : `Mostrar só ${n}`,
      onclick: () => { state.estClasse = sel === k ? null : k; TS.render(); },
    }, h('span', { class: 'est-classe-tit' }, h('i'), h('b', null, n), h('em', null, conta[k])), h('span', { class: 'est-classe-txt' }, DESC[k]))));
    const linhaMed = (pts) => ({ type: 'line', data: pts, borderColor: '#9AA59D', borderDash: [5, 4], borderWidth: 1, pointRadius: 0, pointHoverRadius: 0, fill: false, showLine: true });
    // margem muito negativa (venda quase de graça) não pode esticar o eixo: o ponto fica na borda de baixo e o balão mostra a margem real
    const PISO_Y = -50, yDe = (p) => Math.max(PISO_Y, p.margem * 100);
    const ys = prodsG.map(yDe), xs = prodsG.map((p) => Math.max(grSel ? 0.01 : 1, p.giro));
    const yMin = Math.min(...ys, mq.m * 100) - 1, yMax = Math.max(...ys, mq.m * 100) + 1, xMin = Math.min(...xs, mq.q), xMax = Math.max(...xs, mq.q);
    if (abaR === 'geral') corpo.append(h('div', { class: 'mt' }, TS.cardWithTools('Giro × margem', grSel
      ? `Cada ponto é um chá a granel, somando todos os tamanhos (50g, 100g, 250g…). Quanto mais à direita, mais kg vendidos no período; quanto mais alto, maior a margem. As linhas tracejadas dividem os chás ao meio: metade vendeu mais de ${fq(mq.q)} e metade tem margem acima de ${fmt.pct(mq.m, 0)}. Chá é comparado só com chá. Aqui a classe é a do período escolhido; a oficial (fixa, usada no Pedido) está na aba Produtos.`
      : `Cada ponto é um acessório ou envasado. Quanto mais à direita, mais unidades vendidas no período; quanto mais alto, maior a margem. As linhas tracejadas dividem os produtos ao meio: metade vendeu mais de ${fq(mq.q)} e metade tem margem acima de ${fmt.pct(mq.m, 0)}. Aqui a classe é a do período escolhido; a oficial (fixa, usada no Pedido) está na aba Produtos.`,
      TS.seg([['Chás a granel', 'kg'], ['Acessórios e envasados', 'un']], grSel ? 'kg' : 'un', (v) => { state.estGrupo = v; TS.render(); }),
      legenda,
      sel ? h('div', { class: 'est-filtro' }, `Mostrando só ${CLASSE[sel][0]} no gráfico e na aba Produtos. `, h('button', { type: 'button', class: 'link-btn', onclick: () => { state.estClasse = null; TS.render(); } }, 'Ver todos')) : null,
      prodsG.length ? TS.chart({
        type: 'scatter',
        data: { datasets: [
          ...Object.entries(CLASSE).filter(([k]) => !sel || k === sel).map(([k, [n, c]]) => ({ label: n, data: prodsG.filter((p) => p.classe === k).map((p) => ({ x: Math.max(grSel ? 0.01 : 1, p.giro), y: yDe(p), p })), backgroundColor: c + 'CC', pointRadius: 5, pointHoverRadius: 7 })),
          linhaMed([{ x: mq.q, y: yMin }, { x: mq.q, y: yMax }]), linhaMed([{ x: xMin, y: mq.m * 100 }, { x: xMax, y: mq.m * 100 }]),
        ] },
        options: { plugins: { legend: { display: false }, tooltip: { filter: (c) => !!c.raw.p, callbacks: { label: (c) => `${c.raw.p.produto}: ${fq(c.raw.p.giro)}${c.raw.p.tamanhos ? ' (' + c.raw.p.tamanhos + ')' : ''} · margem ${fmt.pct(c.raw.p.margem)} · lucro ${fmt.brl(c.raw.p.lucro)}` } } },
          scales: { x: { type: 'logarithmic', title: { display: true, text: `${grSel ? 'Kg vendidos' : 'Unidades vendidas'} no período` }, ticks: { callback: (v) => (Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9 ? (v < 1 ? String(v).replace('.', ',') : fmt.int(v)) : '') } }, y: { min: Math.floor(yMin), max: Math.ceil(yMax), title: { display: true, text: 'Margem (%)' }, ticks: { callback: (v) => v + '%' } } } },
      }, 'tall') : TS.empty())));
    if (abaR === 'geral') { const al = cartaoAlertaMargem(); if (al) corpo.append(h('div', { class: 'mt' }, al)); }
    // colunas por visão: a tabela completa tem 16 colunas; "Resumo" e "Margens" cabem na tela sem rolar para o lado
    const COLS = [

        { key: 'produto', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => h('span', null, (r.granel && r.porTam ? h('button', { type: 'button', class: 'est-prod-btn', title: 'Ver lucro e margem de cada tamanho de pacote', onclick: (e) => abrirTamanhos(e, r) }, h('span', { class: 'est-seta', 'aria-hidden': 'true' }, '▸'), h('span', null, h('span', { class: 'est-prod-nome' }, r.produto), h('small', { class: 'est-tam' }, r.tamanhos, h('span', { class: 'est-ver' }, ' · ver por pacote')))) : r.granel ? h('span', null, r.produto, h('small', { class: 'est-tam' }, r.tamanhos)) : r.produto), (TS.telasEstoque || []).includes('pedido') ? h('a', { href: '#pedido', class: 'est-ir', title: 'Abrir o Pedido já buscando este produto', onclick: (e) => { e.preventDefault(); TS.irParaPedido(r.produto); } }, 'no pedido ›') : null) },
        { key: 'abc', label: 'ABC', title: 'Curva ABC pelo lucro: A = produtos que somam 80% do lucro do período; B = os próximos 15%; C = o resto', cls: (r) => (r.abc === 'A' ? 'hit' : '') },
        { key: 'classe', label: 'No período', align: 'l', title: 'Classe só com as vendas do filtro de período (a do gráfico acima), pela mesma conta da oficial. Mostra o momento: uma promoção pode puxar um produto para cima aqui', render: (r) => tagCl(r.classe), sortVal: (r) => ORD_CL[r.classe] || 0 },
        { key: 'oficial', label: 'Oficial', align: 'l', title: `Classe oficial: a mediana do que saiu por mês nos últimos ${CO.meses} meses fechados × a margem. Um mês de promoção pesa pouco. Não muda com o filtro e é a que o Pedido usa. ${COMO_CLASSE} ${podeTravar ? 'Escolha uma classe para travar à mão (🔒); "Automática" volta para a conta.' : '🔒 = travada à mão.'}`, render: (r) => celOficial(r), sortVal: (r) => ORD_CL[r.oficial] || 0 },
        { key: 'tend', label: 'Tendência', title: 'O que saiu por mês no período escolhido comparado com a mediana mensal da classe oficial. ↑ vendendo 20% ou mais acima do normal; ↓ 20% ou mais abaixo. Com períodos curtos (poucos dias) a conta oscila mais', render: (r) => celTend(r), sortVal: (r) => (r.tend == null ? -9 : r.tend) },
        { key: 'giro', label: 'Vendido', title: 'Quanto saiu no período. Chá a granel em kg, somando todos os tamanhos; os outros em unidades', render: (r) => (r.granel ? `${fmt.kg(r.giro)} kg` : `${fmt.int(r.giro)} un.`), sortVal: (r) => r.giro },
        { key: 'vt', label: 'Faturamento', title: 'Valor vendido no período (sem taxa de serviço)', fmt: fmt.brl },
        { key: 'custo', label: 'Custo', title: 'Custo do produto × quantidade vendida. Venda de mês passado: o custo que o produto tinha na data da venda (notas de compra e histórico de custos do painel); mês em andamento: o custo de hoje do AppNext. No chá a granel: kg × custo do kg + saco kraft e etiquetas de cada pacote', fmt: fmt.brl },
        { key: 'lucro', label: 'Lucro bruto', title: 'Faturamento − custo', fmt: fmt.brl, cls: (r) => (r.lucro < 0 ? 'miss' : '') },
        { key: 'margem', label: 'Margem bruta', title: 'Lucro bruto ÷ faturamento. Em vermelho quando fica abaixo de 30%', fmt: (v) => fmt.pct(v), cls: (r) => (r.margem < 0.3 ? 'miss' : '') },
        { key: 'margemTab', label: 'Margem de tabela', title: 'Margem bruta pelo preço de tabela do cadastro do AppNext (sem desconto) com o custo atual. A diferença para a margem bruta praticada é o efeito dos descontos. Chá a granel: média dos pacotes pela quantidade vendida de cada tamanho', render: (r) => (r.margemTab == null ? h('span', { class: 'muted' }, '—') : h('span', { title: r.margemTab - r.margem > 0.005 ? `${fmt.n1((r.margemTab - r.margem) * 100)} pontos a mais que a praticada: é o que o desconto levou` : '' }, fmt.pct(r.margemTab))), sortVal: (r) => r.margemTab },
        { key: 'contrib', label: 'Lucro sem fixos', fmt: fmt.brl, title: 'Lucro bruto − deduções variáveis: o que o produto deixa para pagar os custos fixos. É a métrica para decidir preço, desconto e mix. Clique para ver a conta', render: (r) => (r.contrib == null ? '' : h('button', { type: 'button', class: 'est-conta' + (r.contrib < 0 ? ' neg' : ''), title: 'Clique para ver a conta', onclick: (e) => abrirLiq(e, r) }, fmt.brl(r.contrib))), sortVal: (r) => r.contrib },
        { key: 'margemContrib', label: 'Margem sem fixos', title: `Contribuição ÷ faturamento. Em vermelho abaixo da mínima da loja (${fmt.pct(margemMin, 0)})`, fmt: (v) => (v == null ? '' : fmt.pct(v)), cls: (r) => (r.margemContrib != null && r.margemContrib < margemMin ? 'miss' : '') },
        { key: 'ded', label: 'Deduções', fmt: fmt.brl, title: 'Comissão paga + royalties + Simples Nacional + maquininha. Clique no valor para ver cada um', render: (r) => (r.ded == null ? '' : h('button', { type: 'button', class: 'est-conta', title: 'Clique para ver o detalhamento', onclick: (e) => abrirDed(e, r) }, fmt.brl(r.ded))), sortVal: (r) => r.ded },
        { key: 'lucroLiq', label: 'Lucro com fixos', fmt: fmt.brl, title: 'Lucro bruto − deduções. Clique no valor para ver a conta', render: (r) => (r.lucroLiq == null ? '' : h('button', { type: 'button', class: 'est-conta' + (r.lucroLiq < 0 ? ' neg' : ''), title: 'Clique para ver a conta', onclick: (e) => abrirLiq(e, r) }, fmt.brl(r.lucroLiq))), sortVal: (r) => r.lucroLiq },
        { key: 'margemLiq', label: 'Margem com fixos', title: 'Lucro líquido ÷ faturamento (com os custos fixos rateados). Informativa: um produto com líquida negativa e contribuição positiva continua ajudando a pagar os custos fixos', fmt: (v) => (v == null ? '' : fmt.pct(v)), cls: (r) => (r.margemLiq != null && r.margemLiq < 0 ? 'est-liq-neg' : '') },


      // Resumo: classe oficial com a do período e a tendência embaixo (uma coluna em vez de três)
      { key: 'classeRes', label: 'Classe', align: 'l', title: `Em cima, a classe oficial (mediana de ${CO.meses} meses, a que o Pedido usa${podeTravar ? '; escolha para travar à mão 🔒' : ''}). Embaixo, a classe só no período do filtro e a tendência (o que saiu por mês no período × o normal). ${COMO_CLASSE}`,
        render: (r) => h('div', { class: 'est-cl-res' }, celOficial(r), h('small', { class: 'est-tam' }, 'no período: ', r.classe ? CLASSE[r.classe][0] : '—', r.tend != null ? h('span', null, ' · ', celTend(r)) : null)), sortVal: (r) => ORD_CL[r.oficial] || 0 },
      { key: 'lucroRes', label: 'Lucro bruto', title: 'Faturamento − custo. Embaixo, o custo (o da data da venda nos meses passados; o de hoje no mês em andamento)', render: (r) => h('span', { class: r.lucro < 0 ? 'neg' : null }, fmt.brl(r.lucro), h('small', { class: 'est-tam' }, 'custo ' + fmt.brl(r.custo))), sortVal: (r) => r.lucro },
    ];
    const VIS = {
      resumo: ['Resumo', ['produto', 'abc', 'classeRes', 'giro', 'vt', 'lucroRes', 'margem', 'margemContrib'], 'Classe, venda, lucro e margens (as outras colunas em "Lucro e margens")'],
      margens: ['Lucro e margens', ['produto', 'vt', 'lucroRes', 'margem', 'margemTab', 'contrib', 'margemContrib', 'lucroLiq', 'margemLiq'], 'Do faturamento ao lucro com os custos fixos'],
      tudo: ['Todas as colunas', ['produto', 'abc', 'classe', 'oficial', 'tend', 'giro', 'vt', 'custo', 'lucro', 'margem', 'margemTab', 'contrib', 'margemContrib', 'ded', 'lucroLiq', 'margemLiq'], 'Tudo (rola para o lado)'],
    };
    const vis = VIS[state.estColVis] ? state.estColVis : 'resumo';
    COLS[0] = TS.grupoProd.coluna(COLS[0], grpDe);
    const porKey = new Map(COLS.map((c) => [c.key, c]));
    prods.forEach(grpDe); // a busca também acha pelo grupo
    const tabLucro = TS.table({
      cols: VIS[vis][1].map((k) => porKey.get(k)).filter(Boolean),
      rows: sel ? prods.filter((p) => p.classe === sel) : prods, sortKey: 'lucro', maxHeight: '520px', search: 'Buscar produto ou grupo…', searchKeys: ['produto', 'grp'], produto: 'produto', imprimir: ['produto', 'abc', 'oficial', 'classeRes', 'giro', 'vt', 'lucro', 'lucroRes', 'margem', 'margemTab', 'contrib', 'margemContrib'], cls: 'est-t est-t-lucro est-vis-' + vis,
      total: { produto: 'Total', vt: fatCusto, custo: custoTot, lucro, lucroRes: fmt.brl(lucro), margem: fatCusto ? lucro / fatCusto : null, contrib: contribTot, margemContrib: fatCusto ? contribTot / fatCusto : null, ded: dedSoma, lucroLiq: lucroLiqTot, margemLiq: fatCusto ? lucroLiqTot / fatCusto : null },
    });
    const segVis = h('div', { class: 'est-vis' }, h('span', { class: 'f-label' }, 'Colunas:'),
      TS.seg(Object.entries(VIS).map(([k, [t]]) => [t, k]), vis, (v) => { state.estColVis = v; TS.render(); }),
      h('small', { class: 'muted' }, VIS[vis][2]));
    if (abaR === 'produtos') corpo.append(h('div', { class: 'mt' }, sel ? h('div', { class: 'est-filtro' }, `Mostrando só ${CLASSE[sel][0]}. `, h('button', { type: 'button', class: 'link-btn', onclick: () => { state.estClasse = null; TS.render(); } }, 'Ver todos')) : null, TS.card('Produtos por lucro', 'Curva ABC: A = produtos que fazem 80% do lucro (nunca podem faltar). Chá a granel aparece uma vez só, somando todas as gramaturas. A classe (Estrela, Volume…) compara chá com chá e acessório com acessório: a oficial é fixa e é a que o Pedido usa; a "no período" usa o filtro; a tendência mostra se o produto está saindo acima ou abaixo do normal.', h('div', { class: 'est-lucro-ctl' }, ctlMeses, segVis), tabLucro)));

    if (abaR === 'tabela') corpo.append(h('div', { class: 'mt' }, cartaoTabela()));
    if (abaR === 'pacotes') corpo.append(h('div', { class: 'mt' }, cartaoPacotes() || TS.card('Qual pacote oferecer', null, h('p', { class: 'muted' }, 'Nenhum chá a granel vendeu em dois tamanhos ou mais no período. Escolha um período maior.'))));

    const vends = [...porVend.values()].filter((v) => v.vt > 0).map((v) => ({ ...v, lucro: v.vt - v.custo, margem: (v.vt - v.custo) / v.vt, lucroLiq: v.vt - v.custo - v.ded, margemLiq: (v.vt - v.custo - v.ded) / v.vt, contrib: v.vt - v.custo - v.dedVar, margemContrib: (v.vt - v.custo - v.dedVar) / v.vt, cobre: v.fat ? v.vt / v.fat : null }));
    if (abaR === 'vendedoras') corpo.append(h('div', { class: 'mt' }, TS.card('Lucro por vendedora', 'Quem vende mais nem sempre é quem deixa mais lucro.', TS.table({
      cols: [
        { key: 'vendedor', label: 'Vendedora', align: 'l', sticky: true },
        { key: 'fat', label: 'Faturamento', title: 'Tudo que a vendedora vendeu no período (sem taxa de serviço)', fmt: fmt.brl },
        { key: 'lucro', label: 'Lucro bruto', title: 'Faturamento − custo, só das vendas que têm custo', fmt: fmt.brl },
        { key: 'margem', label: 'Margem bruta', title: 'Lucro bruto ÷ faturamento das vendas com custo', fmt: (v) => fmt.pct(v) },
        { key: 'contrib', label: 'Lucro sem fixos', title: 'Lucro bruto − deduções variáveis (comissão, royalties, Simples, maquininha e custos em %)', fmt: fmt.brl },
        { key: 'margemContrib', label: 'Margem sem fixos', title: 'Contribuição ÷ faturamento das vendas com custo', fmt: (v) => fmt.pct(v) },
        { key: 'lucroLiq', label: 'Lucro com fixos', title: 'Contribuição − custos fixos rateados', fmt: fmt.brl },
        { key: 'margemLiq', label: 'Margem com fixos', title: 'Lucro líquido ÷ faturamento das vendas com custo', fmt: (v) => fmt.pct(v) },
        { key: 'cobre', label: 'Com custo', fmt: (v) => fmt.pct(v, 0), title: 'Parte das vendas da vendedora cujo custo foi encontrado' },
      ],
      rows: vends, sortKey: 'lucro', maxHeight: 'free', cls: 'est-t-larga',
    }))));

    // ---------- kits: produtos que saem juntos no mesmo cupom ----------
    if (abaR === 'kits') corpo.append(h('div', { class: 'mt' }, cartaoKits()));
    }
    function cartaoKits() {
      const DESC_KIT = (state.estKitDesc ?? 10);
      const cupons = new Map(); // cupom → Set(produto)
      const preco = new Map(); // produto → { vt, qtd, custo, qtdC }
      for (const i of base) {
        if (M.taxa(i) || !(db.vt[i] > 0) || resg(i)) continue;
        const cs = M.casar(i);
        const nome = cs && cs.kg ? cs.it.desc : db.D.descricao[db.desc[i]];
        const k = TS.chaveCupom(i);
        (cupons.get(k) || cupons.set(k, new Set()).get(k)).add(nome);
        const p = preco.get(nome) || { vt: 0, qtd: 0, custo: 0, qtdC: 0, ded: 0, granel: !!(cs && cs.kg) };
        const q = db.qtd[i] || 1; p.vt += db.vt[i]; p.qtd += q;
        const dd = deducoes(i); p.ded += dd.var + dd.fix; p.dedVar = (p.dedVar || 0) + dd.var;
        const c = M.custo(i); if (c != null) { p.custo += c; p.qtdC += q; }
        preco.set(nome, p);
      }
      const nCup = cupons.size, cnt = new Map(), par = new Map();
      for (const set of cupons.values()) {
        const xs = [...set].sort();
        for (const a of xs) cnt.set(a, (cnt.get(a) || 0) + 1);
        if (xs.length < 2 || xs.length > 12) continue;
        for (let x = 0; x < xs.length; x++) for (let y = x + 1; y < xs.length; y++) { const k = xs[x] + '\u0001' + xs[y]; par.set(k, (par.get(k) || 0) + 1); }
      }
      const minJuntos = Math.max(3, Math.round(nCup * 0.002));
      // deduções em % do valor vendido de cada produto (comissão, royalties, impostos… acompanham o preço com desconto)
      const media = (n) => { const p = preco.get(n); return { preco: p.qtd ? p.vt / p.qtd : 0, custo: p.qtdC ? p.custo / p.qtdC : null, granel: p.granel, txDed: p.vt ? p.ded / p.vt : 0, txVar: p.vt ? (p.dedVar || 0) / p.vt : 0 }; };
      const kits = [];
      for (const [k, n] of par) {
        if (n < minJuntos) continue;
        const [a, b] = k.split('\u0001');
        const lift = (n * nCup) / (cnt.get(a) * cnt.get(b));
        if (lift < 1.2) continue;
        const A = media(a), B = media(b);
        const soma = A.preco + B.preco, custo = A.custo != null && B.custo != null ? A.custo + B.custo : null;
        const comDesc = soma * (1 - DESC_KIT / 100);
        const txDed = soma ? (A.preco * A.txDed + B.preco * B.txDed) / soma : 0;
        const dedKit = comDesc * txDed;
        const txVar = soma ? (A.preco * A.txVar + B.preco * B.txVar) / soma : 0;
        kits.push({ dedKit, txDed, margemKitLiq: custo != null && comDesc ? (comDesc - custo - dedKit) / comDesc : null, margemKitCon: custo != null && comDesc ? (comDesc - custo - comDesc * txVar) / comDesc : null, kit: `${a} + ${b}`, a, b, juntos: n, confA: n / cnt.get(a), confB: n / cnt.get(b), lift, soma, custo, margem: custo != null && soma ? (soma - custo) / soma : null, precoKit: comDesc, margemKit: custo != null && comDesc ? (comDesc - custo) / comDesc : null, granel: A.granel || B.granel });
      }
      kits.sort((x, y) => y.lift * Math.log(1 + y.juntos) - x.lift * Math.log(1 + x.juntos));
      const top = kits.slice(0, 25);
      const descIn = h('input', { class: 'f-input', type: 'number', min: 0, max: 50, value: DESC_KIT, style: { width: '70px' } });
      descIn.addEventListener('change', () => { state.estKitDesc = Math.max(0, Math.min(50, Math.round(+descIn.value) || 0)); TS.render(); });
      return TS.cardWithTools('Kits sugeridos', `Pares de produtos que saem juntos no mesmo cupom mais do que o acaso explicaria (${fmt.int(nCup)} cupons no período). Chá a granel conta como o chá, qualquer tamanho; o preço dele é o do pacote médio vendido.`,
        h('label', { class: 'est-kit-desc' }, 'Desconto do kit ', descIn, ' %'),
        top.length ? TS.table({
          cols: [
            { key: 'kit', label: 'Kit', align: 'l', wrap: true, sticky: true },
            { key: 'juntos', label: 'Juntos', fmt: fmt.int, title: 'Em quantos cupons os dois saíram juntos no período' },
            { key: 'confA', label: 'Quem leva o 1º leva o 2º', fmt: (v) => fmt.pct(v, 0), title: 'De quem comprou o primeiro produto, quantos também levaram o segundo' },
            { key: 'lift', label: 'Afinidade', fmt: (v) => `${fmt.n1(v)}×`, title: 'Quantas vezes mais eles saem juntos do que sairiam por acaso. Acima de 2× é uma ligação forte' },
            { key: 'soma', label: 'Preço somado', fmt: fmt.brl, title: 'Preço médio do primeiro + do segundo, como vendidos hoje' },
            { key: 'precoKit', label: 'Preço do kit', fmt: fmt.brl, title: `Preço somado com ${DESC_KIT}% de desconto` },
            { key: 'margemKit', label: 'Margem bruta', fmt: (v) => fmt.pct(v), cls: (r) => (r.margemKit != null && r.margemKit < 0.3 ? 'miss' : ''), title: 'Margem bruta do kit já com o desconto: (preço do kit − custo) ÷ preço do kit. Custo do AppNext; chá a granel com saco e etiquetas' },
            { key: 'margemKitCon', label: 'Margem sem fixos', fmt: (v) => fmt.pct(v), cls: (r) => (r.margemKitCon != null && r.margemKitCon < margemMin ? 'miss' : ''), title: 'Margem bruta − deduções variáveis (comissão, royalties, Simples, maquininha e custos em %), já com o desconto do kit' },
            { key: 'margemKitLiq', label: 'Margem com fixos', fmt: (v) => fmt.pct(v), title: 'Margem de contribuição − custos fixos rateados (informativa)' },
          ],
          rows: top, sortKey: 'lift', maxHeight: '520px', cls: 'est-t est-t-larga', search: 'Buscar produto…', searchKeys: ['kit'], produto: 'kit',
        }) : h('p', { class: 'muted' }, `Ainda não há pares que saiam juntos em pelo menos ${minJuntos} cupons. Escolha um período maior (por exemplo, 12 meses).`),
        h('p', { class: 'muted est-kit-dica' }, 'Como usar: monte o kit com os pares de maior afinidade e margem boa, deixe-o na vitrine e treine as vendedoras para oferecer o segundo produto a quem leva o primeiro.'));
    }

    // ---------- reposição ----------
    // "Próximas semanas" vai depois da tabela (put mais abaixo): os quadros de decisão ficam colados na lista de ação
    function cartaoSazonal() {
      if (!temAnoPassado) return TS.card('Próximas semanas', null, h('p', { class: 'muted' }, 'A previsão por época do ano aparece quando a loja tiver mais de um ano de vendas no painel. Até lá, a reposição usa o ritmo dos últimos 30 dias.'));
      // faturamento por semana (sem taxas): 8 semanas passadas e as 8 que vêm, este ano e o ano passado
      const fatDia = new Map();
      for (let i = 0; i < db.n; i++) { if (M.taxa(i)) continue; fatDia.set(db.day[i], (fatDia.get(db.day[i]) || 0) + (db.vt[i] || 0)); }
      const somaDias = (d0, n) => { let t = 0; for (let d = d0; d < d0 + n; d++) t += fatDia.get(d) || 0; return t; };
      const ini8 = fim - 55; // 8 semanas até o último dia com venda
      const agora8 = somaDias(ini8, 56), ly8 = somaDias(ini8 - 364, 56);
      const cresc = ly8 > 0 ? Math.min(2, Math.max(0.5, agora8 / ly8)) : 1;
      const labels = [], antes = [], lyFut = [], prevFut = [], atual = [];
      for (let w = -8; w < 8; w++) {
        const d0 = fim + 1 + w * 7;
        labels.push(fmt.date(TS.dayToIso(d0)).slice(0, 5));
        const ly = somaDias(d0 - 364, 7);
        if (w < 0) { atual.push(somaDias(d0, 7)); antes.push(ly); lyFut.push(null); prevFut.push(null); }
        else { atual.push(null); antes.push(null); lyFut.push(ly); prevFut.push(ly * cresc); }
      }
      const proxLy = lyFut.reduce((t, v) => t + (v || 0), 0), passLy = antes.reduce((t, v) => t + (v || 0), 0);
      const varEpoca = passLy ? proxLy / passLy - 1 : null;
      // taxas, serviços e o consumo do Espaço Gourmet estão na planilha do AppNext como "produto", mas ninguém compra isso da franquia
      const nomesTaxa = new Set([...TS.rules.ids.taxas].map((k) => TS.norm(db.D.descricao[k])));
      const compravel = (r) => { const n = TS.norm(r.produto); return !nomesTaxa.has(n) && !/^taxa\b|\bservico\b|\bconsumo eg\b/.test(n); };
      const picos = repo.filter((r) => compravel(r) && r.origem === 'item' && r.vel > 0 && r.fator >= 1.3).sort((a, b) => (b.prev - b.vel) * (b.it.custo || 1) - (a.prev - a.vel) * (a.it.custo || 1)).slice(0, 8);
      const quedas = repo.filter((r) => compravel(r) && r.origem === 'item' && r.vel > 0 && r.fator <= 0.75).sort((a, b) => a.fator - b.fator).slice(0, 6);
      const tok = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim(); // cores dos tokens (nunca hex solto no JS)
      const item = (r) => h('li', null, h('b', null, r.produto), ` · ${r.fator > 1 ? '+' : '−'}${fmt.int(Math.abs(r.fator - 1) * 100)}% por dia · prever ${qtdTxt(r.prev * H, r.it)} em ${H} dias`);
      // 2ª passada: consulta, não decisão do dia — fica recolhida numa linha com o resumo (a alta da época e os 3 primeiros do
      // "compre antes"); "Ver o gráfico" abre. Compartilhar/Imprimir com ele fechado abrem antes (o gráfico precisa estar à vista).
      const corpoSaz = h('div', { class: 'est-p2-saz-corpo', hidden: !state.estSazAberto });
      const btnSaz = h('button', { type: 'button', class: 'btn est-p2-saz-btn', 'aria-expanded': String(!!state.estSazAberto) }, state.estSazAberto ? 'Fechar o gráfico ▴' : 'Ver o gráfico ▾');
      const abrirSaz = (abrir) => { state.estSazAberto = abrir; corpoSaz.hidden = !abrir; btnSaz.setAttribute('aria-expanded', String(abrir)); btnSaz.textContent = abrir ? 'Fechar o gráfico ▴' : 'Ver o gráfico ▾'; };
      btnSaz.addEventListener('click', () => abrirSaz(corpoSaz.hidden));
      const resumo = [varEpoca == null ? null : h('span', null, 'Pelo ano passado, as próximas 8 semanas vendem ', h('b', { class: varEpoca >= 0 ? 'pos' : 'neg' }, `${varEpoca >= 0 ? '+' : ''}${fmt.pct(varEpoca, 0)}`), '.'),
        picos.length ? h('span', null, ' Compre antes: ', picos.slice(0, 3).map((r) => `${r.produto} (+${fmt.int((r.fator - 1) * 100)}%)`).join(', '), picos.length > 3 ? '…' : '', '.') : null].filter(Boolean);
      const cardSaz = TS.card('Próximas semanas', `Movimento da loja nas próximas 8 semanas pelo que aconteceu na mesma época do ano passado, corrigido pelo crescimento atual da loja (${cresc >= 1 ? '+' : ''}${fmt.pct(cresc - 1, 0)} nas últimas 8 semanas em relação ao ano passado).`,
        h('div', { class: 'est-p2-saz-linha' }, h('p', { class: 'est-saz-res' }, ...(resumo.length ? resumo : ['Sem alta nem queda forte nessa época no ano passado.'])), btnSaz),
        corpoSaz);
      cardSaz.classList.add('est-p2-saz');
      cardSaz.addEventListener('click', (e) => {
        const b = e.target.closest('.shr-btn, .prt-btn');
        if (!b || !corpoSaz.hidden) return;
        e.preventDefault(); e.stopPropagation();
        abrirSaz(true);
        setTimeout(() => b.click(), 400);
      }, true);
      corpoSaz.append(
        TS.chart({
          type: 'bar',
          data: { labels, datasets: [
            { type: 'bar', label: 'Este ano', data: atual, backgroundColor: tok('--green'), borderRadius: 4 },
            { type: 'bar', label: 'Ano passado', data: antes.map((v, k) => v ?? lyFut[k]), backgroundColor: tok('--bege'), borderRadius: 4 },
            { type: 'line', label: 'Previsão', data: prevFut, borderColor: tok('--gold'), backgroundColor: tok('--gold'), borderDash: [6, 4], pointRadius: 3, tension: 0.25, spanGaps: false },
          ] },
          options: { plugins: { legend: { display: true }, tooltip: { callbacks: { title: (c) => `Semana de ${c[0].label}`, label: (c) => `${c.dataset.label}: ${fmt.brl0(c.raw)}` } } }, scales: { y: TS.axisNum(fmt.brl0), x: TS.axisCat } },
        }),
        h('div', { class: 'est-saz-g' },
          h('div', null, h('div', { class: 'f-label' }, 'Vão vender mais nas próximas semanas: compre antes'), picos.length ? h('ul', { class: 'est-saz-l' }, picos.map(item)) : h('p', { class: 'muted' }, 'Nenhum produto com alta forte nessa época no ano passado.')),
          h('div', null, h('div', { class: 'f-label' }, 'Vão vender menos: segure a compra'), quedas.length ? h('ul', { class: 'est-saz-l' }, quedas.map(item)) : h('p', { class: 'muted' }, 'Nenhum produto com queda forte nessa época no ano passado.'))));
      return cardSaz;
    }
    // ---------- tabela única: todos os produtos da planilha do AppNext ----------
    const SIT_T = { ...SIT, liquidar: ['Fora de linha · liquidar', 'warn', 5], parado: ['Parado', 'warn', 5], novo: ['Novo · ainda não vendeu', 'novo', 6], ok: ['OK', 'ok', 7], foralinha: ['Fora de linha', 'cinza', 8], semsaldo: ['Sem saldo', 'cinza', 8] };
    for (const r of todos) {
      // fora de linha não se repõe (a franquia não vende mais): com saldo, é para liquidar
      if (r.foraLinha) { r.est = r.qtd > 0 ? 'liquidar' : 'foralinha'; continue; }
      r.est = ['acabou', 'falta', 'minimo', 'pedir'].includes(r.sit) && (r.sit !== 'pedir' || r.pedir > 0) ? r.sit
        : r.parado ? 'parado' : r.nunca && r.qtd > 0 ? 'novo' : r.qtd <= 0 ? 'semsaldo' : 'ok';
    }
    const porqueT = (r) => (r.foraLinha ? `Indisponível no Sistema de Pedidos desde ${fmt.date(r.foraLinha)} (${FL_DIAS}+ dias): saiu de linha na franquia, não dá para repor.${r.qtd > 0 ? ` Venda o saldo de ${qtdTxt(r.qtd, r.it)} (vitrine, promoção, kit).` : ''}`
      : r.est === 'parado' ? `Saldo de ${qtdTxt(r.qtd, r.it)} ${r.ultima ? `e a última venda foi há ${diasTxt(r.semVenda)}` : 'e nenhuma venda no histórico do painel'}: dinheiro parado.`
      : r.est === 'novo' ? 'Tem saldo e ainda não vendeu no histórico do painel (produto novo ou matéria-prima de pacotes que ainda não saíram).'
        : r.est === 'semsaldo' ? 'Sem saldo no AppNext e sem venda nos últimos 30 dias.' : porque(r));
    const FILTROS = {
      repor: ['O que repor', (r) => repor.includes(r), 'Produtos que vendem e cujo saldo não cobre a entrega + o período do pedido: é a lista do que pedir agora.'],
      falta: ['Perdendo venda', (r) => !!r.rup, 'Produtos zerados que vendiam: quanto a loja deixa de vender por dia sem eles (estimativa pela venda antes de zerar).'],
      parados: ['Parados', (r) => r.parado && !r.foraLinha, 'Têm saldo e não vendem há 60 dias ou mais: dinheiro parado na prateleira.'],
      sobrando: ['Sobrando', (r) => !!r.exc, 'Vendem, mas o saldo dura muito mais que o necessário: dinheiro sobrando em estoque.'],
      ...(todos.some((r) => r.foraLinha && r.qtd > 0) ? { liquidar: ['Fora de linha · liquidar', (r) => r.foraLinha && r.qtd > 0, 'Indisponíveis há 90 dias ou mais no Sistema de Pedidos e ainda com saldo: não voltam, vale liquidar.'] } : {}),
      saldo: ['Com saldo', (r) => r.qtd > 0, 'Tudo que tem saldo hoje na planilha do AppNext.'],
      todos: ['Todos', () => true, 'Todos os produtos da planilha de estoque do AppNext, com ou sem saldo.'],
    };
    // "todos" antigo era "Tudo que vende"; o Início manda "repor"
    let filtroT = FILTROS[state.estSit] ? state.estSit : 'repor';
    const codRepor = new Set(repor.map((r) => r.cod));
    FILTROS.repor[1] = (r) => codRepor.has(r.cod) && !r.foraLinha;
    const conta = (k) => todos.filter(FILTROS[k][1]).length;
    const podePed = (TS.telasEstoque || []).includes('pedido');
    // notas de entrada lançadas depois da planilha de estoque: o saldo delas ainda não está aqui
    let entradas = new Map(); // cod → [{ nf, dia, qtd, mesmoDia }]
    const diaPlanilha = estoque.em ? new Date(estoque.em).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : null;
    const avisoNotas = h('div', { class: 'est-notas-depois' });
    const celEstoque = (r) => {
      const es = entradas.get(String(r.cod));
      return h('span', null, qtdTxt(r.qtd, r.it), es ? h('small', { class: 'est-entrada', title: es.map((e) => `NF ${e.nf} lançada em ${fmt.date(e.dia)}${e.mesmoDia ? ' (mesmo dia da planilha: pode já estar no saldo)' : ''}`).join('\n') },
        `+ ${qtdTxt(es.reduce((a, e) => a + (e.qtd || 0), 0), r.it)} da NF ${es.map((e) => e.nf).join(', ')}`, es.every((e) => e.mesmoDia) ? ' (talvez já no saldo)' : ' ainda não está no saldo') : null);
    };
    const colsT = [
          { key: 'produto', label: 'Produto', align: 'l', sticky: true, wrap: true, title: 'Chá a granel: clique no nome para ver os lotes dele (o que está aberto, desde quando e até quando vale; os pacotes fechados na ordem de abrir) e para marcar "Abrir lote".',
            render: (r) => h('span', null, r.it.un === 'Kg' && TS.validade && TS.validade.janelaPacotes
              ? h('button', { type: 'button', class: 'vl-nome est-nome-cha', title: 'Ver os lotes deste chá: aberto, fechado, abertura e vencimento.', onclick: (e) => { e.stopPropagation(); TS.validade.janelaPacotes(state.loja, r.cod, r.produto); } }, r.produto)
              : r.produto, podePed ? h('a', { href: '#pedido', class: 'est-ir', title: 'Abrir o Pedido já buscando este produto', onclick: (e) => { e.preventDefault(); TS.irParaPedido(r.produto); } }, 'no pedido ›') : null) },
          { key: 'tipo', label: 'Tipo', align: 'l', title: 'Chá a granel (em kg, vendido em pacotes de vários tamanhos), produto pronto ou insumo/embalagem (saco kraft, etiqueta…)' },
          { key: 'est', label: 'Situação', align: 'l', title: 'Passe o mouse (ou toque) na etiqueta para ver o motivo', render: (r) => h('span', { class: 'badge ' + SIT_T[r.est][1], title: porqueT(r) }, SIT_T[r.est][0]), sortVal: (r) => -SIT_T[r.est][2] },
          { key: 'qtd', label: 'Estoque', title: 'Saldo da última planilha de estoque do AppNext (data no topo). Nota de entrada lançada depois aparece embaixo do saldo', render: celEstoque },
          { key: 'min', label: 'Mínimo', title: 'Estoque mínimo cadastrado no AppNext (— = sem mínimo)', render: (r) => (r.min ? qtdTxt(r.min, r.it) : '—') },
          { key: 'sug', label: 'Mín. sugerido', title: `Mínimo calculado pela venda: venda por dia × ${ent} dias de entrega + ${seg}% de segurança. Azul = o mínimo do AppNext está bom; vermelho = muito baixo (vai faltar); amarelo = muito alto (dinheiro parado). Use para corrigir o cadastro no AppNext`,
            render: (r) => (r.sug == null ? '—' : h('span', { class: 'est-sug est-sug-' + r.minSit, title: sugTxt(r) }, qtdTxt(r.sug, r.it))), sortVal: (r) => r.sug },
          { key: 'vel', label: 'Venda/dia', title: 'Média por dia nos últimos 30 dias. No chá a granel soma todos os tamanhos; em saco kraft e etiqueta, o que os pacotes de chá consumiram', render: (r) => (r.it.un === 'Kg' ? `${fmt.kg(r.vel)} kg` : fmt.n1(r.vel)) },
          { key: 'prev', label: 'Previsão/dia', title: `Venda por dia esperada para os próximos ${H} dias (entrega + pedido): o ritmo de agora ajustado pelo que aconteceu nessa mesma época do ano passado. É ela que decide Dura, Pedir e o mínimo sugerido`,
            render: (r) => (!(r.prev > 0) ? '—' : h('span', { class: 'est-prev' + (r.fator >= 1.15 ? ' sobe' : r.fator <= 0.87 ? ' desce' : ''), title: prevTxt(r) }, `${r.it.un === 'Kg' ? fmt.kg(r.prev) + ' kg' : fmt.n1(r.prev)}`, r.fator >= 1.15 || r.fator <= 0.87 ? h('small', null, ` ${r.fator > 1 ? '▲' : '▼'}${fmt.int(Math.abs(r.fator - 1) * 100)}%`) : null)), sortVal: (r) => r.prev },
          { key: 'dias', label: 'Dura', title: 'Quantos dias o estoque atual aguenta no ritmo de venda (estoque ÷ venda por dia)', fmt: (v) => (v == null ? '—' : v > 365 ? '+1 ano' : `${fmt.int(v)} ${Math.round(v) === 1 ? "dia" : "dias"}`) },
          { key: 'pedir', label: 'Pedir', title: 'Quanto pedir para chegar em tempo e durar o período escolhido. Passe o mouse no número para ver a conta', render: (r) => (r.pedir > 0 ? h('b', { title: contaPedido(r), class: 'est-dica' }, qtdTxt(r.pedir, r.it)) : '—') },
          { key: 'custoPedido', label: 'Custo do pedido', title: 'Quantidade a pedir × custo unitário do AppNext', fmt: (v) => (v ? fmt.brl(v) : '—') },
      { key: 'valor', label: 'Valor a custo', title: 'Estoque × custo unitário do AppNext', fmt: (v) => (v ? fmt.brl(v) : '—') },
      { key: 'ultima', label: 'Última venda', title: 'Última vez que este produto vendeu no histórico do painel', fmt: (v) => (v ? fmt.date(v) : '—'), sortVal: (r) => (r.semVenda == null ? -1e9 : -r.semVenda) },
    ];
    // abas "Perdendo venda" e "Sobrando": só as colunas que explicam a conta (ruptura.js); nas outras, entra "Perdendo R$/dia"
    const RC = TS.ruptura.colunas({ qtdTxt, H });
    colsT[0] = TS.grupoProd.coluna(colsT[0], grpDe);
    const col = (k) => colsT.find((c) => c.key === k);
    const COLS_ABA = {
      falta: ['produto', 'tipo', RC.perdaDia, RC.zeradoHa, RC.acumulado, RC.vendiaDia, RC.esperando, 'pedir', 'custoPedido'].map((c) => (typeof c === 'string' ? col(c) : c)),
      sobrando: ['produto', 'tipo', 'qtd', 'prev', 'dias', RC.alvo, RC.sobraQtd, RC.sobraValor].map((c) => (typeof c === 'string' ? col(c) : c)),
    };
    colsT.splice(colsT.findIndex((c) => c.key === 'qtd'), 0, RC.perdaDia);
    // computador (revisão de 22/11, sem rolagem para o lado): cada aba mostra só as colunas dela, com o detalhe empilhado na célula
    // (Mínimo do AppNext com o sugerido embaixo; Previsão/dia com a venda/dia embaixo; o tipo embaixo da situação)
    const colMin = { key: 'min', label: 'Mínimo', title: `Em cima, o mínimo cadastrado no AppNext (— = sem mínimo). Embaixo, o mínimo sugerido pela venda: venda por dia × ${ent} dias de entrega + ${seg}% de segurança. Azul = o mínimo do AppNext está bom; vermelho = muito baixo (vai faltar); amarelo = muito alto (dinheiro parado). Use para corrigir o cadastro no AppNext`,
      render: (r) => h('span', null, r.min ? qtdTxt(r.min, r.it) : '—', r.sug == null ? null : h('small', { class: 'est-tam' }, 'sugerido ', h('span', { class: 'est-sug est-sug-' + r.minSit, title: sugTxt(r) }, qtdTxt(r.sug, r.it)))), sortVal: (r) => r.min || 0 };
    const colPrev = { ...col('prev'), title: col('prev').title + '. Embaixo, a venda por dia dos últimos 30 dias', render: (r) => h('span', null, col('prev').render(r), h('small', { class: 'est-tam' }, 'vendia ', r.it.un === 'Kg' ? `${fmt.kg(r.vel)} kg` : fmt.n1(r.vel), '/dia')) };
    const colSit = { ...col('est'), title: col('est').title + '. Embaixo, o tipo: chá a granel, produto pronto ou insumo/embalagem', render: (r) => h('span', null, col('est').render(r), h('small', { class: 'est-tam' }, r.tipo)) };
    const ABA_PC = {
      repor: [colSit, RC.perdaDia, col('qtd'), colMin, colPrev, col('dias'), col('pedir'), col('custoPedido')],
      parados: [colSit, col('qtd'), col('valor'), col('ultima'), col('dias')],
      liquidar: [colSit, col('qtd'), col('valor'), col('ultima')],
      saldo: [colSit, col('qtd'), col('valor'), col('dias'), col('ultima')],
      todos: [colSit, RC.perdaDia, col('qtd'), colMin, colPrev, col('dias'), col('pedir'), col('valor'), col('ultima')],
    };
    for (const [k, cs] of Object.entries(ABA_PC)) COLS_ABA[k] = [colsT[0], ...cs];
    // celular: as colunas de cada aba (chaves de colsT/COLS_ABA)
    const COLS_MOB = {
      repor: ['produto', 'est', 'qtd', 'dias', 'pedir'],
      falta: ['produto', 'perdaDia', RC.zeradoHa && RC.zeradoHa.key, RC.esperando && RC.esperando.key, 'pedir'],
      parados: ['produto', 'est', 'qtd', 'valor', 'ultima'],
      sobrando: ['produto', 'qtd', 'dias', RC.alvo && RC.alvo.key, RC.sobraValor && RC.sobraValor.key],
      liquidar: ['produto', 'est', 'qtd', 'valor'],
      saldo: ['produto', 'est', 'qtd', 'dias', 'valor'],
      todos: ['produto', 'est', 'qtd', 'dias', 'pedir'],
    };
    // busca: procura em TODOS os produtos, qualquer que seja o filtro
    const busca = h('input', { class: 'f-input est-busca', type: 'search', placeholder: 'Buscar qualquer produto (nome, código ou grupo)…', value: state.estBusca || '', autocomplete: 'off' });
    const tabBoxT = h('div');
    const infoBusca = h('small', { class: 'muted est-busca-info' });
    const ORD = { repor: 'est', falta: 'perdaDia', sobrando: 'sobraValor', parados: 'valor', liquidar: 'valor', saldo: 'valor', todos: 'produto' };
    function montarT() {
      const q = ESQ(busca.value), qd = busca.value.replace(/\D/g, '');
      const rows = q ? todos.filter((r) => ESQ(r.produto).includes(q) || ESQ(grpDe(r)).includes(q) || (qd && String(r.cod).includes(qd))) : todos.filter(FILTROS[filtroT][1]);
      infoBusca.textContent = !q ? '' : rows.length ? `${fmt.int(rows.length)} ${rows.length === 1 ? 'produto encontrado' : 'produtos encontrados'} entre todos os ${fmt.int(todos.length)} (a busca procura em todos, qualquer que seja o filtro)` : '';
      segT.classList.toggle('est-seg-off', !!q);
      let cols = (!q && COLS_ABA[filtroT]) || COLS_ABA.todos;
      // "Perdendo R$/dia" só onde algum produto está zerado com conta (nas outras abas seria uma coluna de "—")
      if (!rows.some((r) => r.rup && r.rup.perdaDia != null)) cols = cols.filter((c) => c !== RC.perdaDia);
      // celular: cartão enxuto — nome, situação e os 2 ou 3 números que decidem aquela aba (o resto fica no computador e no CSV)
      if (TS.ehCelular()) {
        const mob = (q ? COLS_MOB.todos : COLS_MOB[filtroT]) || COLS_MOB.todos;
        const pega = new Set(mob);
        cols = cols.filter((c) => pega.has(c.key) || pega.has(c));
      }
      tabBoxT.replaceChildren(TS.table({
        cols, rows, sortKey: q ? 'produto' : ORD[filtroT], sortDir: q || filtroT === 'todos' ? 'asc' : 'desc', maxHeight: '600px', produto: 'produto', cls: 'est-t',
        imprimir: !q && COLS_ABA[filtroT] && !ABA_PC[filtroT] ? null : ['produto', 'est', 'qtd', 'prev', 'dias', 'pedir', 'custoPedido', 'valor'],
        rowClass: (r) => (entradas.has(String(r.cod)) ? 'est-tem-entrada' : ''),
        empty: q ? 'Nenhum produto com esse nome ou código na planilha de estoque do AppNext.' : { repor: 'Nada para repor agora. 👏', falta: 'Nenhum produto zerado que vendia. 👏', sobrando: 'Nenhum produto com saldo demais. 👏', parados: 'Nada parado. 👏', saldo: 'Nenhum produto com saldo.', todos: 'Nenhum produto.' }[filtroT],
      }));
    }
    const segT = TS.seg(Object.entries(FILTROS).map(([k, [t, , dica]]) => [`${t} (${fmt.int(conta(k))})`, k, dica]), filtroT, (v) => { filtroT = v; state.estSit = v; if (busca.value) { busca.value = ''; state.estBusca = ''; } montarT(); });
    let tBusca = null;
    busca.addEventListener('input', () => { clearTimeout(tBusca); tBusca = setTimeout(() => { state.estBusca = busca.value; montarT(); }, 200); });
    montarT();
    // depois que as notas chegam, marca os produtos com entrada que ainda não está no saldo
    if (diaPlanilha && state.loja && state.loja !== 'todas') fetch(TS.api(`estoque/notas?loja=${encodeURIComponent(state.loja)}`), { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => {
        if (!j || !tabBoxT.isConnected) return;
        const novas = (j.notas || []).filter((n) => /^conclu/i.test(n.status || '') && String(n.entrada || '').slice(0, 10) >= diaPlanilha);
        if (!novas.length) return;
        entradas = new Map();
        for (const n of novas) for (const i of n.itens || []) {
          const k = String(i.cod);
          (entradas.get(k) || entradas.set(k, []).get(k)).push({ nf: n.nf, dia: String(n.entrada).slice(0, 10), qtd: i.qtd, mesmoDia: String(n.entrada).slice(0, 10) === diaPlanilha });
        }
        const depois = novas.filter((n) => String(n.entrada).slice(0, 10) > diaPlanilha), mesmo = novas.length - depois.length;
        avisoNotas.replaceChildren(h('span', null, '📦 ',
          depois.length ? `${depois.length === 1 ? 'A NF' : 'As NFs'} ${depois.map((n) => n.nf).join(', ')} ${depois.length === 1 ? 'foi lançada' : 'foram lançadas'} depois da planilha de estoque: o saldo ${depois.length === 1 ? 'dela' : 'delas'} entra na próxima atualização. ` : '',
          mesmo ? `${mesmo === 1 ? '1 nota lançada' : `${mesmo} notas lançadas`} no mesmo dia da planilha (pode já estar no saldo). ` : '',
          'Os produtos estão marcados na tabela.'));
        montarT();
      }).catch(() => null);
    // 2ª passada: "Baixar pedido" no canto do cabeçalho, junto de Imprimir e Expandir (que o TS.botoesExpandir põe depois dele);
    // busca e abas descem para a linha de cima da tabela
    const csv = h('button', { type: 'button', class: 'est-p2-csv', title: 'Baixa a lista do que repor (O que repor) em planilha CSV, para conferir ou mandar para quem faz o pedido', onclick: () => baixarPedido(repor) }, '⬇', h('span', null, 'Baixar pedido (CSV)'));
    const minRes = h('small', { class: 'muted est-minres' }, 'Mínimo do AppNext comparado com o sugerido: ',
      h('b', { class: 'est-sug est-sug-baixo' }, `${fmt.int(repo.filter((r) => r.minSit === 'baixo').length)} baixos`), ' · ',
      h('b', { class: 'est-sug est-sug-alto' }, `${fmt.int(repo.filter((r) => r.minSit === 'alto').length)} altos`), ' · ',
      h('b', { class: 'est-sug est-sug-sem' }, `${fmt.int(repo.filter((r) => r.minSit === 'sem').length)} sem mínimo`));
    // subtítulo como texto: o cartão corta sozinho na primeira frase e guarda o resto em "Como ler ▸"
    const cardT = TS.cardWithTools('Produtos',
      `Todos os ${fmt.int(todos.length)} produtos da planilha do AppNext; clique no nome do chá para ver os lotes. Reposição pelo ritmo dos últimos 30 dias ajustado pela época do ano (coluna Previsão/dia) · entrega em ${ent} dias · pedido para ${cob} dias de venda. Chás a granel em kg (inclui o consumo de saco kraft e etiquetas). Parado = com saldo e sem venda há ${cfg.paradoDias}+ dias. Perdendo venda = zerado que vendia (estimativa pela venda dos ${TS.ruptura.JANELA} dias antes de zerar). Sobrando = vende, mas o saldo dura mais de ${TS.ruptura.FATOR_EXCESSO * H} dias.`,
      csv,
      h('div', { class: 'est-tools est-p2-tools' }, busca, segT),
      h('div', null, infoBusca, avisoNotas, tabBoxT, minRes));
    cardT.id = 'est-tabela';
    put(E, h('div', { class: 'mt' }, cardT));
    put(E, h('div', { class: 'mt' }, cartaoSazonal()));
    // os quadros do topo filtram a tabela
    TS.estFiltrar = (k) => { filtroT = k; state.estSit = k; busca.value = ''; state.estBusca = ''; TS.segMarcar(segT, k); montarT(); cardT.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

    put(R, h('p', { class: 'muted mt' }, 'Reajustes de custo e de venda e o efeito na margem de cada produto: ', h('a', { href: '#precos' }, 'Produtos → Preços'), '.'));
    put(E, h('p', { class: 'muted mt' }, 'Margem e lucro de cada produto: ', h('a', { href: '#rentab' }, 'Produtos → Rentabilidade'), ' · notas de entrada: ', h('a', { href: '#notas' }, 'Estoque → Notas fiscais'), '.'));

    // ---------- conferência ----------
    const sc = [...semCusto.values()].map((x) => (x.granel ? { ...x, tamanhos: tamTxt(x.tam) } : x)).sort((a, b) => b.vt - a.vt);
    if (sc.length && R) corpo.append(h('details', { class: 'card est-sem' }, h('summary', null, `Vendas sem custo: ${fmt.brl0(sc.reduce((s, x) => s + x.vt, 0))} em ${fmt.int(sc.length)} produtos (ficam fora da margem)`),
      h('p', { class: 'muted' }, 'Chá a granel aparece uma vez, somando todos os tamanhos (50g, 100g, 250g…), porque todos saem da mesma matéria-prima: o custo vem do kg dela. Se a matéria-prima "não está na planilha de estoque", normalmente é porque está com saldo zero no AppNext (o relatório esconde item zerado) — assim que ela tiver saldo e a planilha for atualizada, o custo entra. Corrija no AppNext os itens com "custo zero". Itens do Espaço Gourmet preparados na loja não têm custo no estoque.'),
      TS.table({ cols: [{ key: 'produto', label: 'Produto vendido', align: 'l', wrap: true, render: (r) => (r.granel ? h('span', null, r.produto, h('small', { class: 'est-tam' }, r.tamanhos)) : r.produto) }, { key: 'cod', label: 'Código', align: 'l' }, { key: 'motivo', label: 'Motivo', align: 'l', title: '"custo zero no AppNext": o produto existe mas está sem custo lá. "não achado no estoque": o painel não encontrou o produto na planilha de estoque' }, { key: 'qtd', label: 'Unid.', fmt: fmt.int }, { key: 'vt', label: 'Faturamento', fmt: fmt.brl }], rows: sc, sortKey: 'vt', maxHeight: '360px', cls: 'est-t' })));

    if (TS.eu && TS.eu.pode && TS.eu.pode.configurar) corpo.append(h('p', { class: 'muted est-cfg-link' },
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); TS.editarCustos(state.loja); } }, 'Editar custos da loja'), ' · ',
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); TS.editarCustos(state.loja, 'cfg-pontuais'); } }, 'despesas de um mês só'),
      ' · Simples Nacional, maquininha, prazos da reposição e embalagem dos chás: ', h('a', { href: '#config', onclick: (e) => { e.preventDefault(); TS.abrirCfg ? TS.abrirCfg(state.loja, 'estoque') : (location.hash = '#config'); } }, 'Configurações → Lojas → Estoque e margem'), '.'));
  }

  function baixarPedido(lista) {
    if (!lista.length) { alert('Nada para repor agora.'); return; }
    const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const num = (v, d) => v.toFixed(d).replace('.', ',');
    const linhas = [['Código', 'Produto', 'Unidade', 'Estoque', 'Pedir', 'Custo unitário', 'Custo do pedido', 'Situação'].join(';'),
      ...lista.map((r) => [r.cod, r.produto, r.it.un, num(r.qtd, r.it.un === 'Kg' ? 3 : 0), num(r.pedir, r.it.un === 'Kg' ? 1 : 0), num(r.it.custo || 0, 2), num(r.custoPedido, 2), r.sit].map(esc).join(';'))];
    const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `pedido-${state.loja}-${TS.hojeSP ? TS.hojeSP() : new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** formulário dos ajustes de estoque e margem de uma loja (fica em Configurações → Lojas) */
  /** opts.so = 'custos': só os custos da loja (popup do Resultado e do Estoque e margem); opts.aoSalvar: depois de salvar */
  function formCfg(lojaId, cfg, porCod, opts = {}) {
    const num = (v, min, max) => h('input', { class: 'f-input', type: 'number', min, max, value: v, style: { maxWidth: '110px' } });
    const ent = num(cfg.entregaDias, 0, 120), cob = num(cfg.coberturaDias, 1, 365), par = num(cfg.paradoDias, 7, 730), seg = num(cfg.segurancaPct ?? 50, 0, 300);
    const simp = h('input', { class: 'f-input', type: 'number', min: 0, max: 50, step: '0.01', value: cfg.simplesPct ?? 0, style: { maxWidth: '110px' } });
    const maq = h('input', { class: 'f-input', type: 'number', min: 0, max: 50, step: '0.01', value: cfg.cartaoPct ?? 0, style: { maxWidth: '110px' } });
    const mMin = h('input', { class: 'f-input', type: 'number', min: -50, max: 95, step: '0.5', value: cfg.margemMin ?? 15, style: { maxWidth: '110px' } });
    const mAlvo = h('input', { class: 'f-input', type: 'number', min: -50, max: 95, step: '0.5', value: cfg.margemAlvo ?? 30, style: { maxWidth: '110px' } });
    const teto = h('input', { class: 'f-input', type: 'number', min: 1, max: 90, step: '0.5', value: cfg.comprasTetoPct ?? 32, style: { maxWidth: '110px' } }); // Compras × vendas (comprasvendas.js)
    // caixa a pagar (Resultado → A pagar, apagar.js): prazo das notas de compra, dias do cartão e dia dos royalties
    const prazoNf = num(cfg.prazoNotasDias ?? 30, 0, 180), cartDias = num(cfg.cartaoDias ?? 1, 0, 60), royDia = num(cfg.royaltiesDia ?? 10, 1, 31);
    const diaVenc = (x) => h('input', { class: 'f-input est-dia', type: 'number', min: 1, max: 31, step: 1, value: x.dia ?? '', placeholder: 'fim do mês', 'aria-label': 'Dia do vencimento',
      title: 'Dia do mês em que vence (para o calendário "A pagar" do Resultado). Vazio = último dia do mês.', oninput: (e) => { x.dia = e.target.value; } });
    // ---------- outros custos, agrupados por categoria (Funcionários, Imóvel, Sistemas, Outros…) ----------
    const cats = (cfg.categorias || []).map((c) => ({ ...c }));
    if (!cats.some((c) => c.id === 'outros')) cats.push({ id: 'outros', nome: 'Outros' });
    const itens = (cfg.outros || []).map((x) => ({ ...x, cat: cats.some((c) => c.id === x.cat) ? x.cat : 'outros' }));
    const outrosBox = h('div', { class: 'est-outros' });
    const totais = new Map();
    const brl = (v) => fmt.brl0(v);
    function atualizarTotais() {
      let mesTot = 0, pctTot = 0;
      for (const c of cats) {
        const l = itens.filter((x) => x.cat === c.id);
        const mes = l.filter((x) => x.tipo === 'mes').reduce((a, x) => a + (+String(x.valor).replace(',', '.') || 0), 0);
        const pct = l.filter((x) => x.tipo === 'pct').reduce((a, x) => a + (+String(x.valor).replace(',', '.') || 0), 0);
        mesTot += mes; pctTot += pct;
        const el = totais.get(c.id);
        if (el) el.textContent = [mes ? `${brl(mes)}/mês` : '', pct ? `${fmt.n1(pct)}% das vendas` : ''].filter(Boolean).join(' + ') || 'vazio';
      }
      const g = totais.get('*');
      if (g) g.textContent = [mesTot ? `${brl(mesTot)}/mês` : '', pctTot ? `${fmt.n1(pctTot)}% das vendas` : ''].filter(Boolean).join(' + ') || '—';
    }
    function pintarOutros() {
      totais.clear();
      const linhaItem = (x) => {
        const nome = h('input', { class: 'f-input', value: x.nome, placeholder: 'Ex.: Aluguel', maxlength: 40, oninput: (e) => { x.nome = e.target.value; } });
        const dia = diaVenc(x); dia.disabled = x.tipo !== 'mes';
        const tipo = h('select', { class: 'f-input', onchange: (e) => { x.tipo = e.target.value; dia.disabled = x.tipo !== 'mes'; atualizarTotais(); } }, h('option', { value: 'mes', selected: x.tipo === 'mes' || null }, 'R$ por mês'), h('option', { value: 'pct', selected: x.tipo === 'pct' || null }, '% das vendas'));
        const valor = h('input', { class: 'f-input', type: 'number', min: 0, step: '0.01', value: x.valor, placeholder: '0', oninput: (e) => { x.valor = e.target.value; atualizarTotais(); } });
        const aplica = h('select', { class: 'f-input', onchange: (e) => { x.aplica = e.target.value; } }, [['tudo', 'Todas as vendas'], ['loja', 'Só loja'], ['eg', 'Só Espaço Gourmet']].map(([v, t]) => h('option', { value: v, selected: x.aplica === v || null }, t)));
        const cat = h('select', { class: 'f-input', title: 'Mudar de categoria', onchange: (e) => { x.cat = e.target.value; pintarOutros(); sujo(); } }, cats.map((c) => h('option', { value: c.id, selected: x.cat === c.id || null }, c.nome)));
        const rem = h('button', { type: 'button', class: 'est-outro-rem', title: 'Remover este custo', onclick: () => { itens.splice(itens.indexOf(x), 1); pintarOutros(); sujo(); } }, '✕');
        return h('tr', null, h('td', null, nome), h('td', null, tipo), h('td', null, valor), h('td', null, dia), h('td', null, aplica), h('td', null, cat), h('td', null, rem));
      };
      const corpoT = h('tbody');
      for (const c of cats) {
        const l = itens.filter((x) => x.cat === c.id);
        const tot = h('span', { class: 'est-cat-tot' });
        totais.set(c.id, tot);
        const nomeCat = h('input', { class: 'f-input est-cat-nome', value: c.nome, maxlength: 30, title: 'Nome da categoria (clique para mudar)', oninput: (e) => { c.nome = e.target.value; } });
        const add = h('button', { type: 'button', class: 'btn est-cat-add', onclick: () => { itens.push({ nome: '', tipo: 'mes', valor: '', aplica: 'tudo', cat: c.id }); pintarOutros(); sujo(); const ins = outrosBox.querySelectorAll(`tr[data-cat="${c.id}"] input`); } }, '+ Custo');
        const remCat = c.id !== 'outros' && !l.length ? h('button', { type: 'button', class: 'est-outro-rem', title: 'Apagar esta categoria (vazia)', onclick: () => { cats.splice(cats.indexOf(c), 1); pintarOutros(); sujo(); } }, '✕ categoria') : null;
        corpoT.append(h('tr', { class: 'est-cat-cab' }, h('td', { colspan: 7 }, h('div', { class: 'est-cat-l' }, nomeCat, tot, add, remCat))));
        if (!l.length) corpoT.append(h('tr', { class: 'est-cat-vazia' }, h('td', { colspan: 7, class: 'muted' }, 'Nenhum custo nesta categoria.')));
        l.forEach((x) => { const tr = linhaItem(x); tr.dataset.cat = c.id; corpoT.append(tr); });
      }
      const geral = h('span');
      totais.set('*', geral);
      const novaCat = h('button', { type: 'button', class: 'btn', onclick: () => { const nome = prompt('Nome da nova categoria (ex.: Marketing):'); if (!nome || !nome.trim()) return; let id = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'cat'; while (cats.some((c) => c.id === id)) id += '1'; cats.splice(cats.length - 1, 0, { id, nome: nome.trim().slice(0, 30) }); pintarOutros(); sujo(); } }, '+ Nova categoria');
      outrosBox.replaceChildren(
        h('div', { class: 'table-wrap free' }, h('table', { class: 't est-cat-t' },
          h('thead', null, h('tr', null, ['Custo', 'Tipo', 'Valor', 'Vence no dia', 'Onde se aplica', 'Categoria', ''].map((t) => h('th', { class: 'l' }, t)))), corpoT,
          h('tfoot', null, h('tr', null, h('td', { colspan: 7 }, h('b', null, 'Total: '), geral))))),
        h('div', { class: 'cfg-acoes' }, novaCat));
      atualizarTotais();
      pintarPontuais();
    }
    // ---------- despesas de um mês só (ex.: IPTU em janeiro, 13º em dezembro) ----------
    const pont = (cfg.pontuais || []).map((x) => ({ ...x }));
    const pontBox = h('div', { class: 'est-outros' });
    function pintarPontuais() {
      const tb = h('tbody');
      const ordem = [...pont].sort((a, b) => (a.ym || '9').localeCompare(b.ym || '9'));
      for (const x of ordem) {
        const nome = h('input', { class: 'f-input', value: x.nome, placeholder: 'Ex.: IPTU', maxlength: 40, oninput: (e) => { x.nome = e.target.value; } });
        const mes = h('input', { class: 'f-input', type: 'month', value: x.ym || '', onchange: (e) => { x.ym = e.target.value; } });
        const valor = h('input', { class: 'f-input', type: 'number', min: 0, step: '0.01', value: x.valor, placeholder: '0', oninput: (e) => { x.valor = e.target.value; } });
        const cat = h('select', { class: 'f-input', onchange: (e) => { x.cat = e.target.value; } }, cats.map((c) => h('option', { value: c.id, selected: x.cat === c.id || null }, c.nome)));
        const anual = h('label', { class: 'est-pont-anual', title: 'Lança também no mesmo mês dos anos seguintes' }, h('input', { type: 'checkbox', checked: x.anual || null, onchange: (e) => { x.anual = e.target.checked; } }), ' todo ano');
        const rem = h('button', { type: 'button', class: 'est-outro-rem', title: 'Remover', onclick: () => { pont.splice(pont.indexOf(x), 1); pintarPontuais(); sujo(); } }, '✕');
        tb.append(h('tr', null, h('td', null, nome), h('td', null, mes), h('td', null, diaVenc(x)), h('td', null, valor), h('td', null, cat), h('td', null, anual), h('td', null, rem)));
      }
      if (!pont.length) tb.append(h('tr', null, h('td', { colspan: 7, class: 'muted', style: { padding: '8px 10px' } }, 'Nenhuma despesa pontual.')));
      const add = h('button', { type: 'button', class: 'btn', onclick: () => { const d = new Date(); pont.push({ nome: '', ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, valor: '', cat: 'outros', anual: false }); pintarPontuais(); sujo(); } }, '+ Despesa pontual');
      pontBox.replaceChildren(h('div', { class: 'table-wrap free' }, h('table', { class: 't est-cat-t' },
        h('thead', null, h('tr', null, ['Despesa', 'Mês', 'Vence no dia', 'Valor (R$)', 'Categoria', 'Repete', ''].map((t) => h('th', { class: 'l' }, t)))), tb)),
        h('div', { class: 'cfg-acoes' }, add));
    }
    pintarOutros();
    const tams = ['50', '100', '250', '500', '1000'];
    const txtEmb = (l) => (l || []).map((x) => `${x.cod}×${x.qtd}`).join(', ');
    const nomeEmb = (l) => (l || []).map((x) => `${x.qtd}× ${porCod.get(String(x.cod))?.desc || '(código ' + x.cod + ' não está no estoque)'}`).join(' + ');
    const embs = tams.map((g) => { const i = h('input', { class: 'f-input', value: txtEmb(cfg.embalagens[g]), placeholder: 'código×quantidade, ...' }); return [g, i]; });
    const msg = h('span', { class: 'muted' });
    // dois botões (depois dos custos e no fim) com o mesmo efeito; aviso de alteração não salva
    const salvar = h('button', { type: 'button', class: 'btn primary' }, 'Salvar ajustes de estoque e margem');
    const salvar2 = h('button', { type: 'button', class: 'btn primary' }, 'Salvar');
    const msg2 = h('span', { class: 'muted' });
    const status = (cls, txt) => { msg.className = msg2.className = cls; msg.textContent = msg2.textContent = txt; };
    const sujo = () => status('est-sujo', 'Alterações ainda não salvas: clique em Salvar.');
    salvar2.addEventListener('click', () => salvar.click());
    salvar.addEventListener('click', async () => {
      salvar.disabled = salvar2.disabled = true; status('muted', 'Salvando…');
      try {
        const embalagens = Object.fromEntries(embs.map(([g, i]) => [g, i.value.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [cod, q] = s.split(/[×x*]/i); return { cod: (cod || '').trim(), qtd: +(q || 1) }; })]));
        const r = await fetch(`/api/estoque/cfg?loja=${encodeURIComponent(lojaId)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ entregaDias: +ent.value, coberturaDias: +cob.value, paradoDias: +par.value, segurancaPct: +seg.value, simplesPct: simp.value, cartaoPct: maq.value, margemMin: mMin.value, margemAlvo: mAlvo.value, comprasTetoPct: teto.value, prazoNotasDias: prazoNf.value, cartaoDias: cartDias.value, royaltiesDia: royDia.value, outros: itens.map((x) => ({ nome: x.nome, tipo: x.tipo, valor: x.valor, aplica: x.aplica, cat: x.cat, dia: x.dia })), categorias: cats.map((c) => ({ id: c.id, nome: c.nome })), pontuais: pont.map((x) => ({ nome: x.nome, ym: x.ym, valor: x.valor, cat: x.cat, anual: !!x.anual, dia: x.dia })), embalagens }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
        cache.delete(lojaId);
        status('pos', 'Salvo. As telas de Produtos, Estoque e Resultado já usam os valores novos.');
        if (opts.aoSalvar) opts.aoSalvar();
      } catch (e) { status('neg', e.message); }
      salvar.disabled = salvar2.disabled = false;
    });
    const ouvir = (el) => { el.addEventListener('input', sujo); el.addEventListener('change', sujo); return el; };
    [ent, cob, par, seg, simp, maq, mMin, mAlvo, teto, prazoNf, cartDias, royDia, outrosBox, pontBox].forEach(ouvir);
    const blocoCaixa = [
      h('div', { class: 'f-label', style: { marginTop: '14px' }, id: `cfg-caixa-${lojaId}` }, 'Caixa a pagar (Resultado → A pagar)'),
      h('div', { class: 'est-cfg-g' },
        h('label', null, h('span', null, 'Prazo das notas de compra', TS.dica('Em quantos dias a franquia cobra a nota depois que ela dá entrada. O painel não tem a data do boleto: o vencimento de cada nota é estimado por este prazo (entrada + dias).')), h('div', null, prazoNf, ' dias depois da entrada')),
        h('label', null, h('span', null, 'Dias para receber do cartão', TS.dica('Quantos dias a maquininha leva para pôr na conta o que foi vendido em cartão (crédito e débito). 1 = cai no dia seguinte; 30 = recebe em 30 dias.')), h('div', null, cartDias, ' dias')),
        h('label', null, h('span', null, 'Royalties vencem no dia', TS.dica('Dia do mês seguinte em que a loja paga os royalties e o marketing do mês.')), h('div', null, royDia, ' do mês seguinte'))),
      h('small', { class: 'muted' }, 'Usados só no calendário "A pagar" do Resultado. O dia de vencimento de cada custo fixo e de cada despesa fica na coluna "Vence no dia" das tabelas acima (vazio = último dia do mês).'),
    ];
    embs.forEach(([, i]) => ouvir(i));
    outrosBox.addEventListener('click', (e) => { if (e.target.closest('.est-outro-rem')) sujo(); });
    if (opts.so === 'custos') {
      return [
        h('div', { class: 'f-label', id: `cfg-custos-${lojaId}` }, 'Custos da loja por categoria'),
        h('small', { class: 'muted' }, 'R$ por mês (aluguel, salários, energia…) ou % das vendas (aluguel percentual do shopping, app de delivery). O valor por mês vira um % pela média do faturamento dos últimos 3 meses fechados.'),
        outrosBox,
        h('div', { class: 'f-label', style: { marginTop: '14px' }, id: `cfg-pontuais-${lojaId}` }, 'Despesas de um mês só'),
        h('small', { class: 'muted' }, 'IPTU e IPVA no começo do ano, 13º salário, uma manutenção… Entram cheias no Resultado do mês escolhido, dentro da categoria. "Todo ano" repete no mesmo mês dos anos seguintes.'),
        pontBox,
        ...blocoCaixa,
        h('div', { class: 'cfg-acoes' }, salvar2, msg2),
      ];
    }
    return [
      h('div', { class: 'f-label' }, 'Margem líquida (sobre o valor vendido)'),
      h('div', { class: 'est-cfg-g' },
        h('label', null, h('span', null, 'Simples Nacional'), h('div', null, simp, ' %')),
        h('label', null, h('span', null, 'Taxa da maquininha'), h('div', null, maq, ' %')),
        h('label', null, h('span', null, 'Margem mínima (sem fixos)'), h('div', null, mMin, ' %')),
        h('label', null, h('span', null, 'Meta de margem (sem fixos)'), h('div', null, mAlvo, ' %'))),
      h('small', { class: 'muted' }, 'Margem sem fixos = lucro bruto − deduções variáveis, antes do aluguel e outros custos fixos. Abaixo da mínima o produto aparece em vermelho e no alerta. A meta é usada no simulador de preço ("Para X% sem fixos").'),
      h('small', { class: 'muted' }, 'Comissão e royalties vêm das regras da loja (Comissionamento). Use a taxa média da maquininha (débito, crédito e Pix juntos).'),
      h('div', { class: 'f-label', style: { marginTop: '14px' }, id: `cfg-custos-${lojaId}` }, 'Outros custos da loja'),
      h('small', { class: 'muted' }, '% das vendas (ex.: aluguel percentual do shopping, app de delivery) ou R$ por mês (ex.: aluguel fixo, energia, salários). O valor em R$ por mês vira um %: valor ÷ média do faturamento dos últimos 3 meses fechados (ex.: R$ 16.000 ÷ média de R$ 200.000 = 8% de cada venda). Esse % é volátil: muda quando um mês fecha e entra na média.'),
      outrosBox,
      h('div', { class: 'f-label', style: { marginTop: '14px' }, id: `cfg-pontuais-${lojaId}` }, 'Despesas de um mês só'),
      h('small', { class: 'muted' }, 'Gastos que caem num mês específico, como IPTU e IPVA no começo do ano, 13º salário ou uma manutenção. Entram no Resultado do mês escolhido, dentro da categoria. Marque "todo ano" para repetir no mesmo mês dos anos seguintes. Não entram no rateio da margem de cada produto.'),
      pontBox,
      ...blocoCaixa,
      h('div', { class: 'cfg-acoes' }, salvar2, msg2),
      h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Reposição'),
      h('div', { class: 'est-cfg-g' },
        h('label', null, h('span', null, 'Entrega do fornecedor'), h('div', null, ent, ' dias')),
        h('label', null, h('span', null, 'Pedir para'), h('div', null, cob, ' dias de venda')),
        h('label', null, h('span', null, 'Parado depois de'), h('div', null, par, ' dias sem venda')),
        h('label', null, h('span', null, 'Segurança do mínimo sugerido'), h('div', null, seg, ' %')),
        h('label', null, h('span', null, 'Teto de compras do mês', TS.dica('Quanto das vendas a loja aceita gastar em compras no mês (padrão 32%). Aparece em "Compras × vendas", no Pedido e no Resultado: acima disso a loja está comprando mais do que o combinado para o que vende.')), h('div', null, teto, ' % das vendas'))),
      h('div', { class: 'f-label', style: { marginTop: '14px' } }, 'Embalagem de cada pacote de chá a granel (entra no custo e no consumo)'),
      h('div', { class: 'est-emb' }, embs.map(([g, i]) => h('label', null, h('span', null, g === '1000' ? '1 kg' : g + ' g'), i, h('small', { class: 'muted' }, nomeEmb(cfg.embalagens[g]))))),
      h('div', { class: 'cfg-acoes' }, salvar, msg),
    ];
  }
  /** popup "Custos da loja": edita os custos por categoria e as despesas de um mês só sem sair da tela.
   *  Ao salvar, fecha e redesenha a tela (Resultado, margens e ponto de equilíbrio com os valores novos). */
  TS.editarCustos = function (lojaId, ancora) {
    document.querySelector('.camada-custos')?.remove();
    const fechar = () => { camada.remove(); document.body.classList.remove('com-camada'); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    const corpo = h('div', null, h('p', { class: 'muted' }, 'Carregando…'));
    const card = h('div', { class: 'card card-cheio cfg-popup' },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'card-title' }, 'Custos da loja'), h('div', { class: 'card-sub' }, 'Os mesmos de Configurações → Lojas → Estoque e margem. Ao salvar, a tela se atualiza com os valores novos.'))),
      corpo);
    const camada = h('div', { class: 'camada-cheia camada-custos', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Custos da loja', onmousedown: (e) => { if (e.target === camada) fechar(); } }, card);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', esc);
    buscar(lojaId, true).then(({ estoque, cfg }) => {
      const porCod = new Map(((estoque && estoque.itens) || []).map((it) => [String(it.cod), it]));
      corpo.replaceChildren(...formCfg(lojaId, cfg, porCod, { so: 'custos', aoSalvar: () => { setTimeout(() => { fechar(); TS.render(); }, 500); } }));
      const alvo = ancora && document.getElementById(`${ancora}-${lojaId}`);
      if (alvo) requestAnimationFrame(() => alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }).catch((e) => corpo.replaceChildren(h('p', { class: 'neg' }, e.message)));
  };

  /** bloco de Configurações → Lojas (admin e franqueado) */
  TS.blocoEstoqueCfg = function (lojaId) {
    const b = h('section', { class: 'cfg-bloco cfg-bloco-largo' }, h('h3', null, 'Estoque e margem'),
      h('p', { class: 'muted' }, 'Impostos, maquininha e outros custos para a margem líquida, prazos da reposição e a embalagem dos chás a granel.'));
    const corpo = h('div', null, h('p', { class: 'muted' }, 'Carregando…'));
    b.append(corpo);
    buscar(lojaId).then(({ estoque, cfg }) => {
      const porCod = new Map(((estoque && estoque.itens) || []).map((it) => [String(it.cod), it]));
      corpo.replaceChildren(...formCfg(lojaId, cfg, porCod));
      // veio de um atalho (ex.: Resultado → "Adicionar custos"): rola até o trecho e destaca
      if (TS.cfgAncora) {
        const alvo = document.getElementById(`${TS.cfgAncora}-${lojaId}`);
        TS.cfgAncora = null;
        if (alvo) requestAnimationFrame(() => { alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }); alvo.classList.add('cfg-destaque'); setTimeout(() => alvo.classList.remove('cfg-destaque'), 2500); });
      }
    }).catch((e) => corpo.replaceChildren(h('p', { class: 'neg' }, e.message)));
    return b;
  };
})();
