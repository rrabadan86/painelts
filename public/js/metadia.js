/* Meta de hoje: como a meta do dia da loja é dividida entre as vendedoras (cartão "Meta de hoje", Clientes → Hoje).
 * Conta pura (testada em tests/unit/metadia.test.js). Não mexe na meta do MÊS nem na comissão: é só o alvo do dia.
 *
 * - Com escala lançada: cada pessoa recebe a parte das HORAS dela na escala de hoje (horas líquidas, sem o intervalo).
 *   Quem está de folga ou de férias hoje fica com zero. Quem vende mas não foi encontrada na escala (nome diferente) fica
 *   de fora e a tela avisa.
 * - Sem escala (ou sem ninguém da escala ligado às vendas): divisão igual entre quem vende e não está de férias hoje. */
(function () {
  'use strict';
  const N = (s) => String(s == null ? '' : s).trim().toUpperCase();

  /**
   *   meta      meta do dia da loja (R$)
   *   pessoas   [nome nas vendas] — quem vende na loja (a tela passa quem teve venda da meta nos últimos 30 dias)
   *   horas     null = não há escala para usar; ou [[nome nas vendas, minutos líquidos escalados hoje]] (só quem trabalha hoje)
   *   semEscala o motivo de não haver escala: 'nao-lancada' | 'sem-acesso' (a vendedora não recebe a escala dos colegas)
   *   ferias    [{ vendedor, de, ate }] e hoje (AAAA-MM-DD): para a divisão igual não contar quem está de férias
   * → { modo: 'escala' | 'igual', motivo, total (minutos), partes: [{ nome, minutos, parte, alvo }] (maior alvo primeiro),
   *     fora: [nomes que vendem e não entram hoje], foraPorque: 'folga' | 'ferias' }
   */
  function dividir({ meta, pessoas, horas, semEscala, ferias, hoje }) {
    const m = +meta || 0;
    const nomes = [...new Set((pessoas || []).map((x) => String(x || '').trim()).filter(Boolean))];
    const emFerias = new Set((ferias || []).filter((f) => f && hoje && f.de <= hoje && f.ate >= hoje).map((f) => N(f.vendedor)));
    if (Array.isArray(horas)) {
      const hs = new Map();
      for (const [nome, min] of horas) { const k = String(nome || '').trim(); if (k && min > 0) hs.set(k, (hs.get(k) || 0) + min); }
      const total = [...hs.values()].reduce((a, b) => a + b, 0);
      if (total > 0) {
        const partes = [...hs].map(([nome, minutos]) => ({ nome, minutos, parte: minutos / total, alvo: (m * minutos) / total }))
          .sort((a, b) => b.alvo - a.alvo || a.nome.localeCompare(b.nome, 'pt-BR'));
        const dentro = new Set(partes.map((p) => N(p.nome)));
        return { modo: 'escala', motivo: null, total, partes, fora: nomes.filter((x) => !dentro.has(N(x))), foraPorque: 'folga' };
      }
    }
    const ativos = nomes.filter((x) => !emFerias.has(N(x)));
    const lista = ativos.length ? ativos : nomes; // todos de férias (cadastro errado): não deixa a meta sem divisor
    const partes = lista.map((nome) => ({ nome, minutos: null, parte: 1 / lista.length, alvo: m / lista.length }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const motivo = Array.isArray(horas) ? 'ninguem-na-escala' : semEscala === 'sem-acesso' ? 'sem-acesso' : 'nao-lancada';
    return { modo: 'igual', motivo, total: 0, partes, fora: nomes.filter((x) => !lista.includes(x)), foraPorque: 'ferias' };
  }

  /** frase curta do rodapé do cartão: como a meta de hoje foi dividida */
  function comoDividiu(r) {
    if (!r) return '';
    if (r.modo === 'escala') return 'A parte de cada pessoa segue as horas dela na escala de hoje (sem o intervalo). Folga e férias ficam sem meta no dia.';
    if (r.motivo === 'sem-acesso') return 'Meta de hoje dividida em partes iguais entre quem não está de férias.';
    if (r.motivo === 'ninguem-na-escala') return 'Ninguém da escala de hoje foi encontrado nas vendas (o nome na escala precisa ser igual ao do vendedor): a meta de hoje foi dividida em partes iguais entre quem não está de férias.';
    return 'Sem escala lançada para esta loja: a meta de hoje foi dividida em partes iguais entre quem não está de férias. Lance a escala em Equipe → Movimento e escala para dividir pelas horas de cada pessoa.';
  }

  const API = { dividir, comoDividiu };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  TS.metaDia = API;
})();
