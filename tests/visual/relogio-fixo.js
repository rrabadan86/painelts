'use strict';
/**
 * Relógio fixo do servidor nos testes de prints (carregado com NODE_OPTIONS=--require): a apresentação monta as vendas,
 * os lotes e "hoje" pela data do servidor; com o relógio andando a partir de RELOGIO_FIXO, todo print sai do mesmo dia
 * e da mesma hora, em qualquer máquina e em qualquer dia do ano. O tempo continua correndo (timers e esperas funcionam).
 * Só para testes: o painel de verdade nunca carrega este arquivo.
 */
const alvo = Date.parse(process.env.RELOGIO_FIXO || '');
if (Number.isFinite(alvo)) {
  const Real = Date;
  const desvio = alvo - Real.now();
  class DataFixa extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + desvio); }
    static now() { return Real.now() + desvio; }
  }
  global.Date = DataFixa;
}
