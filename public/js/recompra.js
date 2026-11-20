/* Recompra com prazo inteiro (Clientes → Indicadores → Base de clientes): "voltou a comprar?" só para quem já teve tempo.
 * O cliente do fim do período teve menos dias para voltar: contá-lo junto puxa o % para baixo sem ser culpa de ninguém.
 * Por isso, como a retenção por safra, só entra quem já teve o prazo inteiro (90 dias) depois da compra de partida;
 * os outros aparecem separados ("ainda no prazo"). Com menos de 20 clientes de prazo completo: "poucos dados".
 * Usada no quadro "Recompra" e no "% voltaram" de cada vendedora. Conta pura (tests/unit/recompra.test.js). */
(function () {
  'use strict';
  const PRAZO = 90; // dias para voltar
  const MIN = 20;   // clientes com o prazo completo para o % não ser sorte

  /**
   * clientes: [{ ref: dia da compra de partida, dias: [dia de cada compra do cliente] }]; hoje: último dia com dados.
   * → { clientes, elegiveis (já tiveram o prazo inteiro), voltaram (compraram de novo em até `prazo` dias depois da partida),
   *     semPrazo (ainda no prazo), pct (voltaram ÷ elegíveis; null sem elegíveis), pouco (elegíveis < min), prazo, min }
   */
  function recompra(clientes, hoje, prazo = PRAZO, min = MIN) {
    let elegiveis = 0, voltaram = 0, semPrazo = 0, total = 0;
    for (const c of clientes || []) {
      if (c == null || c.ref == null) continue;
      total++;
      if (hoje - c.ref < prazo) { semPrazo++; continue; }
      elegiveis++;
      if ((c.dias || []).some((d) => d > c.ref && d <= c.ref + prazo)) voltaram++;
    }
    return { clientes: total, elegiveis, voltaram, semPrazo, pct: elegiveis ? voltaram / elegiveis : null, pouco: elegiveis < min, prazo, min };
  }

  const API = { PRAZO, MIN, recompra };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  TS.recompra = API;
})();
