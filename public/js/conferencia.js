/* Confiança nos dados — contas puras (telas: TS.conferencia; servidor: require em src/conferencia.js).
 * Não toca na página nem em TS.db.
 *
 * 1. Conferência com o caixa: faturamento do painel (definição oficial, contas.js) × total recebido no fechamento
 *    do caixa do mesmo dia. diferença = caixa − painel. Até a tolerância (padrão R$ 1,00) o dia BATE.
 *    Fora da tolerância, o painel tenta explicar com o que ele sabe que fica de fora de um dos lados:
 *      + taxas de serviço/entrega  (o caixa recebe, o faturamento não conta)
 *      + itens a R$ 0,01           (resgates e brindes: o caixa recebe o centavo, o faturamento não conta)
 *      − vendas sem vendedor       (estão no faturamento; podem não ter passado por este caixa)
 *      − vendas corporativas/on-line (idem)
 *      − cupons cancelados que ainda estão na planilha de vendas
 *    Se alguma combinação fecha a conta, o dia fica "bate com explicação". Dois dias seguidos cujas diferenças se
 *    anulam = caixa fechado depois da meia-noite. O resto é "não bate".
 * 2. Sobras e faltas de caixa: diferença da gaveta (dinheiro contado − o que deveria ter) por operador e dia da semana.
 * 3. Cupons cancelados: notas canceladas (XML) cruzadas com a planilha de vendas (mesmo número, até 1 dia de distância).
 * 4. Saúde dos dados: quanto do faturamento casa com o estoque por código, por nome ou não casa; quanto está sem custo;
 *    idade de cada fonte com sinal verde / amarelo / vermelho. */
(function () {
  'use strict';
  const CT = typeof module !== 'undefined' && module.exports ? require('./contas') : TS.contas;
  const TOLERANCIA_PADRAO = 1;
  const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const r2 = (x) => Math.round((+x || 0) * 100) / 100;
  const brl = (x) => 'R$ ' + Math.abs(+x || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const semVendedor = (v) => !v || /^sem vendedor$/i.test(String(v).trim());
  // pela palavra inteira no nome do vendedor (as mesmas palavras do e-mail de fechamento)
  const foraDaLoja = (v) => /(^|[^a-zà-ú])(corporativ[oa]s?|omni\w*|e-?commerce|loja virtual|online|site|ifood|rappi)([^a-zà-ú]|$)/i.test(v || '');
  const tol = (t) => (Number.isFinite(+t) && +t >= 0 ? +t : TOLERANCIA_PADRAO);

  /**
   * O que o painel tem de cada dia, a partir das linhas de venda (como o servidor guarda).
   * → Map(dia → { fat, taxas, centavos, semVendedor, foraLoja, cupons })
   * fat = faturamento oficial (CT.contaFat); taxas e centavos = o que fica FORA do faturamento.
   */
  function painelPorDia(vendas, de, ate) {
    const m = new Map();
    for (const v of vendas || []) {
      if (!v.data || (de && v.data < de) || (ate && v.data > ate)) continue;
      let d = m.get(v.data);
      if (!d) m.set(v.data, (d = { fat: 0, taxas: 0, centavos: 0, semVendedor: 0, foraLoja: 0, _c: new Set() }));
      const x = v.vt || 0;
      if (CT.ehTaxa(v.descricao)) { d.taxas += x; continue; }
      if (CT.ehCentavo(v.vu)) { d.centavos += x; continue; }
      d.fat += x;
      d._c.add(v.cupom + '|' + v.loja);
      if (semVendedor(v.vendedor)) d.semVendedor += x;
      else if (foraDaLoja(v.vendedor)) d.foraLoja += x;
    }
    for (const d of m.values()) { d.cupons = d._c.size; delete d._c; for (const k of ['fat', 'taxas', 'centavos', 'semVendedor', 'foraLoja']) d[k] = r2(d[k]); }
    return m;
  }

  const PARTES = [
    ['taxa', 'taxas', 1, (v) => `taxa de serviço/entrega de ${brl(v)} (o caixa recebe, o faturamento não conta)`],
    ['centavo', 'centavos', 1, (v) => `itens a R$ 0,01 somando ${brl(v)} (resgates e brindes: fora do faturamento)`],
    ['semvendedor', 'semVendedor', -1, (v) => `${brl(v)} em vendas sem vendedor que não passaram por este caixa`],
    ['fora', 'foraLoja', -1, (v) => `${brl(v)} em vendas corporativas ou on-line que não passaram por este caixa`],
    ['cancelado', 'cancelados', -1, (v) => `${brl(v)} em cupons cancelados que ainda estão na planilha de vendas`],
  ];

  /**
   * Conferência de UM dia.
   *   painel  { fat, taxas, centavos, semVendedor, foraLoja, cancelados } ou null (sem vendas no painel)
   *   caixa   { total } ou null (sem fechamento lido)
   * → { dia, fat, caixa, dif, pct, estado: 'bate' | 'explicado' | 'naobate' | 'semfechamento', cod, motivo }
   *   dif = caixa − painel (positivo: o caixa recebeu mais do que o painel mostra).
   */
  function conferirDia({ dia, painel, caixa, tolerancia, hoje }) {
    const T = tol(tolerancia);
    const fat = painel ? r2(painel.fat) : null;
    const base = { dia, fat, caixa: caixa ? r2(caixa.total) : null, dif: null, pct: null, cod: null, motivo: '' };
    if (!caixa) {
      return { ...base, estado: 'semfechamento', cod: dia === hoje ? 'hoje' : 'semleitura',
        motivo: dia === hoje ? 'O dia ainda está em andamento: o caixa fecha à noite.' : 'O painel ainda não leu o fechamento deste dia: o caixa não foi fechado no AppNext ou a coleta está atrasada.' };
    }
    if (!painel) {
      if (Math.abs(caixa.total) <= T) return { ...base, fat: 0, dif: r2(caixa.total), pct: null, estado: 'bate', cod: 'zero', motivo: 'Dia sem vendas no painel e no caixa.' };
      return { ...base, dif: r2(caixa.total), estado: 'naobate', cod: 'semvendas', motivo: `O caixa fechou com ${brl(caixa.total)}, mas a planilha de vendas deste dia ainda não chegou ao painel. Atualize as vendas.` };
    }
    const dif = r2(caixa.total - painel.fat);
    const out = { ...base, dif, pct: painel.fat ? dif / painel.fat : null };
    if (Math.abs(dif) <= T) return { ...out, estado: 'bate', cod: 'ok', motivo: 'Faturamento e caixa conferem.' };
    // tenta explicar com a menor combinação do que fica de fora de um dos lados
    const ps = PARTES.map(([cod, campo, sinal, txt]) => ({ cod, v: r2(sinal * (painel[campo] || 0)), txt })).filter((p) => Math.abs(p.v) >= 0.005);
    let melhor = null;
    for (let mask = 1; mask < 1 << ps.length; mask++) {
      const sel = ps.filter((_, k) => mask & (1 << k));
      if (melhor && sel.length >= melhor.length) continue;
      if (Math.abs(dif - sel.reduce((s, p) => s + p.v, 0)) <= T) melhor = sel;
    }
    if (melhor) return { ...out, estado: 'explicado', cod: melhor.map((p) => p.cod).join('+'), motivo: 'A diferença é ' + melhor.map((p) => p.txt(p.v)).join(' e ') + '.' };
    return { ...out, estado: 'naobate', cod: dif > 0 ? 'caixamaior' : 'painelmaior',
      motivo: dif > 0
        ? `O caixa recebeu ${brl(dif)} a mais do que as vendas do painel. Pode ser venda que não entrou na planilha de vendas ou recebimento de outro dia.`
        : `As vendas do painel passam ${brl(dif)} do que o caixa recebeu. Pode ser venda que não passou por este caixa ou cupom cancelado que continua na planilha.` };
  }

  /**
   * Conferência de um período.
   *   painel  Map(dia → …) de painelPorDia;  caixas  Map(dia → { total, … });  canceladosDia  Map(dia → R$ de cupons cancelados ainda nas vendas)
   * Só entram os dias que têm venda no painel ou fechamento no caixa. Depois de conferir dia a dia, procura a
   * "virada do dia": dois dias seguidos que não batem sozinhos, mas batem somados (caixa fechado depois da meia-noite).
   * → lista do dia mais novo para o mais antigo
   */
  function conferir({ de, ate, painel, caixas, canceladosDia, tolerancia, hoje }) {
    const T = tol(tolerancia), out = [];
    for (let d = CT.diaDe(de); d <= CT.diaDe(ate); d++) {
      const dia = CT.isoDe(d), p = painel.get(dia) || null, c = caixas.get(dia) || null;
      if (!p && !c) continue;
      if (!c && !(p.fat > 0)) continue; // só taxa ou brinde, sem fechamento: não é dia de venda
      const pc = p ? { ...p, cancelados: (canceladosDia && canceladosDia.get(dia)) || 0 } : null;
      out.push({ ...conferirDia({ dia, painel: pc, caixa: c, tolerancia: T, hoje }), cupons: p ? p.cupons : 0 });
    }
    // virada do dia: a diferença de um dia é o contrário da do vizinho (dia sem fechamento conta como "falta tudo")
    const falta = (x) => (x.estado === 'naobate' ? x.dif : x.estado === 'semfechamento' && x.cod !== 'hoje' && x.fat > 0 ? -x.fat : null);
    for (let k = 0; k + 1 < out.length; k++) {
      const a = out[k], b = out[k + 1];
      if (CT.diaDe(b.dia) - CT.diaDe(a.dia) !== 1) continue;
      const fa = falta(a), fb = falta(b);
      if (fa == null || fb == null || !(Math.abs(fa) > T) || Math.abs(fa + fb) > 2 * T) continue;
      const br = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
      const txt = (outro) => `Somado com ${br(outro.dia)} a conta fecha: o caixa foi fechado depois da meia-noite (ou só no dia seguinte), e ${brl(fa)} caíram no dia vizinho.`;
      a.motivo = txt(b); b.motivo = txt(a);
      a.estado = b.estado = 'explicado'; a.cod = b.cod = 'virada';
      k++;
    }
    return out.reverse();
  }

  /** quadros da conferência → { bate, explicado, naobate, semfechamento, total, somaNaoBate, maior } */
  function resumo(lista) {
    const r = { bate: 0, explicado: 0, naobate: 0, semfechamento: 0, total: (lista || []).length, somaNaoBate: 0, maior: null };
    for (const x of lista || []) {
      r[x.estado]++;
      if (x.estado === 'naobate') { r.somaNaoBate += Math.abs(x.dif || 0); if (!r.maior || Math.abs(x.dif) > Math.abs(r.maior.dif)) r.maior = { dia: x.dia, dif: x.dif }; }
    }
    r.somaNaoBate = r2(r.somaNaoBate);
    return r;
  }

  /** dias recentes (padrão: últimos 7, sem contar hoje) que não batem — é o aviso do Início */
  function recentesQueNaoBatem(lista, hoje, dias = 7) {
    const de = CT.isoDe(CT.diaDe(hoje) - dias);
    return (lista || []).filter((x) => x.estado === 'naobate' && x.dia >= de && x.dia < hoje);
  }

  /** formas de pagamento somadas no período: caixas = [{ formas: [{ k, rot, valor }] }] → [{ rot, valor, pct }] (maior primeiro) */
  function formasPeriodo(caixas) {
    const m = new Map();
    let total = 0;
    for (const c of caixas || []) for (const f of c.formas || []) {
      if (!f.valor) continue;
      m.set(f.rot, (m.get(f.rot) || 0) + f.valor); total += f.valor;
    }
    return [...m].map(([rot, valor]) => ({ rot, valor: r2(valor), pct: total ? valor / total : null })).sort((a, b) => b.valor - a.valor);
  }

  /**
   * Sobras e faltas da gaveta: caixas = [{ dia, diferenca, operadores: [nome] }] (diferenca = dinheiro contado − o que deveria ter).
   * Diferença até a tolerância não conta. "Recorrente" = 3 ou mais dias com diferença no período.
   * → { dias, sobras: { n, valor }, faltas: { n, valor }, saldo, porOperador: […], porSemana: [7] }
   */
  function sobrasFaltas(caixas, tolerancia) {
    const T = tol(tolerancia);
    const novo = (nome) => ({ nome, dias: 0, sobras: 0, vSobras: 0, faltas: 0, vFaltas: 0, saldo: 0 });
    const soma = (g, d) => { g.dias++; if (d > T) { g.sobras++; g.vSobras += d; } else if (d < -T) { g.faltas++; g.vFaltas += d; } if (Math.abs(d) > T) g.saldo += d; };
    const tot = novo('Total'), ops = new Map(), sem = DIAS_SEMANA.map((n) => novo(n));
    for (const c of caixas || []) {
      const d = +c.diferenca || 0;
      soma(tot, d);
      soma(sem[new Date(c.dia + 'T12:00:00Z').getUTCDay()], d);
      const nome = [...new Set((c.operadores || []).filter(Boolean))].join(' + ') || '(sem operador)';
      if (!ops.has(nome)) ops.set(nome, novo(nome));
      soma(ops.get(nome), d);
    }
    const fim = (g) => ({ ...g, vSobras: r2(g.vSobras), vFaltas: r2(g.vFaltas), saldo: r2(g.saldo), recorrente: g.sobras + g.faltas >= 3 });
    return { dias: tot.dias, sobras: { n: tot.sobras, valor: r2(tot.vSobras) }, faltas: { n: tot.faltas, valor: r2(tot.vFaltas) }, saldo: r2(tot.saldo),
      porOperador: [...ops.values()].map(fim).sort((a, b) => (b.sobras + b.faltas) - (a.sobras + a.faltas) || Math.abs(b.saldo) - Math.abs(a.saldo)),
      porSemana: sem.map(fim) };
  }

  /**
   * Cupons cancelados × planilha de vendas.
   *   notas   [{ dia, numero, mod, valor, chave }] — notas canceladas (XML). mod 65 = cupom do caixa, 55 = nota grande.
   *   vendas  linhas de venda (data, cupom, vendedor, descricao, vu, vt, grupoC, cat)
   * Um cupom cancelado "ainda conta" quando a planilha de vendas tem linhas com o mesmo número até 1 dia de distância
   * (a venda casa pela data ±1, como o CPF do cupom). valorVendas = faturamento dessas linhas; valorMeta = a parte
   * que entra na meta e na comissão.
   * → { lista, impacto: { cupons, valor, valorMeta }, total: { cupons, valor }, porDia, porVendedor }
   */
  function cancelados({ notas, vendas, de, ate }) {
    const porNum = new Map();
    const alvo = new Set((notas || []).map((n) => +n.numero));
    for (const v of vendas || []) {
      if (!alvo.has(+v.cupom)) continue;
      let l = porNum.get(+v.cupom);
      if (!l) porNum.set(+v.cupom, (l = []));
      l.push(v);
    }
    const lista = [], porDia = new Map(), porVend = new Map();
    const emDia = (k) => { let d = porDia.get(k); if (!d) porDia.set(k, (d = { dia: k, cupons: 0, valor: 0, aindaConta: 0, cuponsConta: 0 })); return d; };
    const emVend = (k) => { let d = porVend.get(k); if (!d) porVend.set(k, (d = { vendedor: k, cupons: 0, valor: 0, aindaConta: 0, valorMeta: 0 })); return d; };
    const impacto = { cupons: 0, valor: 0, valorMeta: 0 }, total = { cupons: 0, valor: 0 };
    for (const n of notas || []) {
      if ((de && n.dia < de) || (ate && n.dia > ate)) continue;
      const dn = CT.diaDe(n.dia);
      let ls = (porNum.get(+n.numero) || []).filter((v) => Math.abs(CT.diaDe(v.data) - dn) <= 1);
      const noDia = ls.filter((v) => v.data === n.dia);
      if (noDia.length) ls = noDia; // o mesmo número em dias vizinhos: vale o do dia da nota
      let valorVendas = 0, valorMeta = 0;
      const vends = new Map();
      for (const v of ls) {
        if (!CT.contaFat(v.descricao, v.vu)) continue;
        const x = v.vt || 0;
        valorVendas += x;
        if (CT.classeMeta(v.grupoC, v.cat)) valorMeta += x;
        const nome = semVendedor(v.vendedor) ? '(sem vendedor)' : String(v.vendedor).trim();
        const a = vends.get(nome) || { vt: 0, meta: 0 };
        a.vt += x; if (CT.classeMeta(v.grupoC, v.cat)) a.meta += x;
        vends.set(nome, a);
      }
      const nasVendas = ls.length > 0;
      const item = { dia: n.dia, numero: +n.numero, mod: String(n.mod || ''), valor: r2(n.valor), chave: n.chave || null, nasVendas, valorVendas: r2(valorVendas), valorMeta: r2(valorMeta), vendedores: [...vends.keys()] };
      lista.push(item);
      total.cupons++; total.valor += item.valor;
      const d = emDia(n.dia);
      d.cupons++; d.valor += item.valor;
      if (nasVendas) {
        impacto.cupons++; impacto.valor += valorVendas; impacto.valorMeta += valorMeta;
        d.aindaConta += valorVendas; d.cuponsConta++;
        const nv = vends.size || 1;
        for (const [nome, a] of vends.size ? vends : new Map([['(sem vendedor)', { vt: 0, meta: 0 }]])) {
          const g = emVend(nome);
          g.cupons++; g.valor += item.valor / nv; g.aindaConta += a.vt; g.valorMeta += a.meta;
        }
      } else {
        const g = emVend('(fora da planilha de vendas)');
        g.cupons++; g.valor += item.valor;
      }
    }
    const arr = (o, ks) => { for (const k of ks) o[k] = r2(o[k]); return o; };
    return {
      lista: lista.sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : b.numero - a.numero)),
      impacto: arr(impacto, ['valor', 'valorMeta']), total: arr(total, ['valor']),
      porDia: [...porDia.values()].map((d) => arr(d, ['valor', 'aindaConta'])).sort((a, b) => (a.dia < b.dia ? 1 : -1)),
      porVendedor: [...porVend.values()].map((d) => arr(d, ['valor', 'aindaConta', 'valorMeta'])).sort((a, b) => b.aindaConta - a.aindaConta || b.valor - a.valor),
    };
  }

  /** linhas negativas da planilha de vendas (estorno/devolução lançada como venda negativa) → { linhas, valor, porDia, porVendedor } */
  function negativas(vendas, de, ate) {
    const porDia = new Map(), porVend = new Map();
    let linhas = 0, valor = 0;
    for (const v of vendas || []) {
      if (!v.data || (de && v.data < de) || (ate && v.data > ate)) continue;
      if (!((v.vt || 0) < 0 || (v.qtd || 0) < 0)) continue;
      const x = v.vt || 0;
      linhas++; valor += x;
      porDia.set(v.data, r2((porDia.get(v.data) || 0) + x));
      const nome = semVendedor(v.vendedor) ? '(sem vendedor)' : String(v.vendedor).trim();
      porVend.set(nome, r2((porVend.get(nome) || 0) + x));
    }
    return { linhas, valor: r2(valor), porDia: [...porDia].map(([dia, v]) => ({ dia, valor: v })), porVendedor: [...porVend].map(([vendedor, v]) => ({ vendedor, valor: v })) };
  }

  /**
   * Tira das vendas as linhas dos cupons cancelados (só quando a loja escolhe "tirar das vendas").
   * Mesma regra de `cancelados`: mesmo número, até 1 dia de distância (preferindo o dia da nota). Só NFC-e (modelo 65).
   * → { vendas, fora } (fora = linhas tiradas)
   */
  function semCancelados(vendas, notas) {
    const alvo = new Map(); // numero → [dias das notas]
    for (const n of notas || []) { if (String(n.mod) !== '65') continue; const l = alvo.get(+n.numero) || []; l.push(n.dia); alvo.set(+n.numero, l); }
    if (!alvo.size) return { vendas, fora: [] };
    // para cada (número, dia da nota): o dia das linhas que valem (o próprio dia, senão o vizinho)
    const cand = new Map(); // numero → Set(datas com linha)
    for (const v of vendas) if (alvo.has(+v.cupom)) { const s = cand.get(+v.cupom) || new Set(); s.add(v.data); cand.set(+v.cupom, s); }
    const tirar = new Set(); // "numero|data"
    for (const [num, dias] of alvo) {
      const tem = cand.get(num);
      if (!tem) continue;
      for (const dia of dias) {
        if (tem.has(dia)) { tirar.add(num + '|' + dia); continue; }
        const d = CT.diaDe(dia);
        for (const viz of [CT.isoDe(d - 1), CT.isoDe(d + 1)]) if (tem.has(viz)) tirar.add(num + '|' + viz);
      }
    }
    if (!tirar.size) return { vendas, fora: [] };
    const fica = [], fora = [];
    for (const v of vendas) (tirar.has(+v.cupom + '|' + v.data) ? fora : fica).push(v);
    return { vendas: fica, fora };
  }

  // ---------- saúde dos dados ----------
  /**
   * Quanto do faturamento casa com o produto do estoque.
   *   linhas [{ vt, via: 'código' | 'nome' | null, temCusto, nome, cod }] — só linhas que contam no faturamento
   * → { fat, codigo, nome, semProduto, semCusto, pct…, naoCasados: [{ nome, cod, vt, linhas }], semCustoLista: […] }
   * semCusto = não casou + casou com produto que está sem custo no estoque.
   */
  function casamento(linhas) {
    const r = { fat: 0, codigo: 0, nome: 0, semProduto: 0, semCusto: 0 };
    const nao = new Map(), sc = new Map();
    const junta = (m, l) => { const k = (l.cod || '') + '|' + (l.nome || ''); let a = m.get(k); if (!a) m.set(k, (a = { nome: l.nome || '(sem nome)', cod: l.cod || '', vt: 0, linhas: 0 })); a.vt += l.vt || 0; a.linhas++; };
    for (const l of linhas || []) {
      const x = l.vt || 0;
      r.fat += x;
      if (l.via === 'código') r.codigo += x; else if (l.via === 'nome') r.nome += x; else { r.semProduto += x; junta(nao, l); }
      if (!l.temCusto) { r.semCusto += x; if (l.via) junta(sc, l); }
    }
    const p = (x) => (r.fat ? x / r.fat : null);
    const lista = (m) => [...m.values()].map((a) => ({ ...a, vt: r2(a.vt) })).sort((a, b) => b.vt - a.vt);
    return { fat: r2(r.fat), codigo: r2(r.codigo), nome: r2(r.nome), semProduto: r2(r.semProduto), semCusto: r2(r.semCusto),
      pctCodigo: p(r.codigo), pctNome: p(r.nome), pctSemProduto: p(r.semProduto), pctSemCusto: p(r.semCusto), naoCasados: lista(nao), semCustoLista: lista(sc) };
  }

  /**
   * Sinal de uma fonte pela idade: verde até `verdeH` horas, amarelo até `vermelhoH`, vermelho depois; sem data = 'cinza'.
   * → { sinal, horas, idade: 'há 3 h' | 'há 2 dias' | 'nunca' }
   */
  function sinalFonte({ em, verdeH = 36, vermelhoH = 72 }, agora) {
    const t = em ? Date.parse(em) : NaN;
    if (!Number.isFinite(t)) return { sinal: 'cinza', horas: null, idade: 'nunca' };
    const horas = Math.max(0, ((agora || Date.now()) - t) / 3600e3);
    const idade = horas < 1 ? 'há menos de 1 h' : horas < 48 ? `há ${Math.round(horas)} h` : `há ${Math.round(horas / 24)} dias`;
    return { sinal: horas <= verdeH ? 'verde' : horas <= vermelhoH ? 'amarelo' : 'vermelho', horas, idade };
  }

  const API = { TOLERANCIA_PADRAO, DIAS_SEMANA, painelPorDia, conferirDia, conferir, resumo, recentesQueNaoBatem, formasPeriodo, sobrasFaltas, cancelados, negativas, semCancelados, casamento, sinalFonte, semVendedor, foraDaLoja };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  TS.conferencia = API;
})();
