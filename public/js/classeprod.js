/* Classe dos produtos (Estrela, Volume, Joia, Peso morto): a conta única, usada pela classe oficial (Rentabilidade, Pedido,
 * ⭐ Sugestões, Início, IA) e pela classe "no período" da Rentabilidade.
 * - Giro alto = vende pelo menos a mediana do grupo (chá a granel só se compara com chá; o resto entre si).
 * - Margem boa = margem bruta na mediana do grupo ou acima E margem sem fixos na margem MÍNIMA da loja ou acima.
 *   Só a mediana dizia "melhor que a metade", mesmo quando a metade inteira dava pouco.
 * - Giro alto: margem boa → Estrela; senão → Volume.
 * - Giro baixo: margem boa OU margem sem fixos na margem ALVO da loja ou acima → Joia; senão → Peso morto.
 *   Assim "Peso morto" deixa de ser um quarto dos produtos por construção: numa loja em que todos dão a margem alvo, ninguém é.
 * As margens mínima e alvo são as de Configurações → Lojas → Estoque e margem (margem sem fixos = depois do custo e das
 * deduções variáveis). Sem a margem sem fixos do produto (não deu para calcular as deduções), o critério absoluto usa a bruta. */
(function () {
  'use strict';
  const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return !n ? 0 : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

  /**
   * xs: [{ cod, giro, margem (bruta, fração), margemSf (sem fixos, fração; null = não deu para calcular) }] de UM grupo de comparação
   * min, alvo: margens mínima e alvo da loja, em fração (0,15 = 15%); null/undefined = sem critério absoluto (só a mediana)
   * → Map(cod → { auto, giro, margem, margemSf, medGiro, medMargem, alto, acimaMediana, acimaMin, acimaAlvo, porque })
   *   porque: 'min' (margem acima da mediana, mas abaixo da mínima: deixou de ser "boa") | 'alvo' (giro baixo e margem abaixo da
   *   mediana, mas na alvo ou acima: Joia, não Peso morto) | null
   */
  function classificar(xs, { min = null, alvo = null } = {}) {
    const mq = mediana(xs.map((x) => x.giro)), mm = mediana(xs.map((x) => x.margem));
    const out = new Map();
    for (const x of xs) {
      const abs = x.margemSf != null && Number.isFinite(x.margemSf) ? x.margemSf : x.margem;
      const alto = x.giro > 0 && x.giro >= mq;
      const acimaMediana = x.margem >= mm;
      const acimaMin = min == null || abs >= min;
      const acimaAlvo = alvo != null && abs >= alvo;
      const boa = acimaMediana && acimaMin;
      const auto = alto ? (boa ? 'estrela' : 'volume') : (boa || acimaAlvo ? 'joia' : 'peso');
      const porque = acimaMediana && !acimaMin && !(!alto && acimaAlvo) ? 'min' : !alto && !boa && acimaAlvo ? 'alvo' : null;
      out.set(x.cod, { auto, giro: x.giro, margem: x.margem, margemSf: x.margemSf != null && Number.isFinite(x.margemSf) ? x.margemSf : null, medGiro: mq, medMargem: mm, alto, acimaMediana, acimaMin, acimaAlvo, porque });
    }
    return out;
  }

  const API = { mediana, classificar };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  TS.classeProd = API;
})();
