/* Custo na data: quanto custava um item do estoque num certo dia. A conta única usada por Preços (histórico do produto,
 * efeito do reajuste) e pelo motor de custos (estoque.js → Resultado, Rentabilidade, classe, CMV do Pedido).
 * De onde vem: as notas de compra que o coletor guarda (Entrada de Produtos do AppNext: custo de cada nota, pelo dia de
 * entrada) + as "fotos" do custo que o painel guarda a cada planilha de estoque (custos.json), em ordem de data.
 * - Na mesma data vale a nota; uma foto do estoque só vira ponto se mudar o custo em 1% ou mais (o "custo último" do
 *   AppNext é o da última nota).
 * - Dia antes do primeiro ponto conhecido: usa o custo MAIS ANTIGO conhecido, marcado como estimado (est: true).
 * - Item sem histórico nenhum: usa o custo de hoje do estoque, também estimado.
 * Dias = dias desde 1970 (como TS.isoToDay). */
(function () {
  'use strict';
  const paraDia = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5);

  /**
   * historico: { cod: [[AAAA-MM-DD, custo], …] } (fotos do estoque); comprasItens: { cod: [[AAAA-MM-DD, custo, nf, qtd, fornecedor], …] }
   * → { hist: Map(cod → [[dia, custo, nota|null], …]), custoEm(it, dia) → { v, est }, custoNaData(cod, dia, custoHoje) → { v, est },
   *     origemEm(it, dia) → nota de compra que valia no dia (ou null), inicio: primeiro dia com custo conhecido (Infinity se não há) }
   */
  function montar(historico, comprasItens) {
    const hist = new Map();
    const cods = new Set([...Object.keys(historico || {}), ...Object.keys(comprasItens || {})]);
    for (const cod of cods) {
      const pts = [
        ...((comprasItens && comprasItens[cod]) || []).map(([d, v, nf, q, forn]) => ({ d: paraDia(d), v, o: { nf, q, forn, data: d } })),
        ...((historico && historico[cod]) || []).map(([d, v]) => ({ d: paraDia(d), v, o: null })),
      ].filter((x) => Number.isFinite(x.d) && x.v > 0).sort((a, b) => a.d - b.d || (a.o ? 1 : 0) - (b.o ? 1 : 0));
      const l = [];
      for (const x of pts) {
        const ult = l[l.length - 1];
        if (ult && ult[0] === x.d) { if (x.o || !ult[2]) { ult[1] = x.v; ult[2] = x.o || ult[2]; } continue; }
        if (!x.o && ult && Math.abs(x.v / ult[1] - 1) < 0.01) continue;
        l.push([x.d, x.v, x.o]);
      }
      hist.set(cod, l);
    }
    const memo = new Map(); // cod → Map(dia → { v, est })
    /** custo de 1 unidade do item `cod` no dia; custoHoje = o do estoque de agora (só para quem não tem histórico) */
    function custoNaData(cod, dia, custoHoje) {
      cod = String(cod);
      const l = hist.get(cod);
      if (!l || !l.length) return { v: custoHoje || null, est: true };
      let m = memo.get(cod);
      if (!m) memo.set(cod, (m = new Map()));
      let r = m.get(dia);
      if (r) return r;
      let v = null;
      for (const [d, c] of l) { if (d <= dia) v = c; else break; }
      r = v == null ? { v: l[0][1], est: true } : { v, est: false };
      m.set(dia, r);
      return r;
    }
    const custoEm = (it, dia) => custoNaData(it.cod, dia, it.custo);
    const origemEm = (it, dia) => { let o = null; for (const [d, , x] of hist.get(String(it.cod)) || []) { if (d <= dia) o = x; else break; } return o; };
    let inicio = Infinity;
    for (const l of hist.values()) if (l.length && l[0][0] < inicio) inicio = l[0][0];
    return { hist, custoNaData, custoEm, origemEm, inicio };
  }

  const API = { montar, paraDia };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  TS.custoData = API;
})();
