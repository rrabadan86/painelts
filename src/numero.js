'use strict';
/**
 * Valor em reais vindo de planilha (célula numérica ou texto), à prova dos formatos que aparecem nos relatórios:
 *   "R$ 1.234,56", "R$ 1.234,56" (espaço invisível), "1.234,56 ", "-R$ 5,00", "R$ -5,00", "(5,00)" (negativo
 *   de contabilidade), "5,00-", "+12,50", "R$ 1.234" (com R$: ponto é milhar), "1.234.567" (vários pontos: milhar).
 * Sem "R$" e com um ponto só ("12.5", "1.234") o ponto é decimal — é como o Excel e o AppNext mandam números
 *   sem formatação (e "1.500" de quantidade não pode virar 1500).
 * Texto que não é número (ex.: "—", "abc", "1,2,3") vira null, nunca NaN.
 */
const ESPACOS = /[\s   ​]/g;
function valorBR(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object') {
    if ('result' in v) return valorBR(v.result);
    if (Array.isArray(v.richText)) v = v.richText.map((x) => x.text).join('');
    else if (v.text != null) v = v.text;
    else return null;
  }
  let s = String(v).replace(ESPACOS, '');
  if (!s || s === '-' || s === '—') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  let comRS = false;
  for (let k = 0; k < 2; k++) { // "-R$5", "R$-5", "+R$5"
    if (/^R\$/i.test(s)) { comRS = true; s = s.slice(2); }
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  }
  if (!/^\d[\d.,]*$/.test(s)) return null;
  let n;
  if (s.includes(',')) {
    if (s.indexOf(',') !== s.lastIndexOf(',')) return null; // "1,2,3": não é número brasileiro
    if (s.includes('.') && s.lastIndexOf('.') > s.indexOf(',')) return null; // "1,234.56" misturado ao contrário
    n = Number(s.replace(/\./g, '').replace(',', '.'));
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s) || (comRS && /^\d{1,3}(\.\d{3})+$/.test(s))) {
    n = Number(s.replace(/\./g, '')); // milhar: vários pontos, ou "R$ 1.234"
  } else {
    if ((s.match(/\./g) || []).length > 1) return null;
    n = Number(s);
  }
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}
module.exports = { valorBR };
