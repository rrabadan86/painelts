'use strict';
/**
 * Regras de comissão que a vendedora recebe: as listas de nomes (sem meta, não recebem comissão,
 * fora do rateio) saem do modelo da loja + o que foi configurado, já com os colegas trocados por
 * apelidos. Sem isso, loja sem regras gravadas usaria no navegador o modelo padrão com nomes reais,
 * que não casam com "COLEGA n" — e a "Minha comissão" sairia diferente da conta do gerente.
 * Os modelos são os mesmos do navegador (public/js/rules.js), lidos uma vez.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let _R = null;
function regrasNavegador() {
  if (_R) return _R;
  const ctx = { TS: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/rules.js'), 'utf8'), ctx);
  return (_R = ctx.TS.rules);
}

/** modelo que o navegador usaria para a loja (mesma escolha de R.regrasDe) */
function modeloDe(m) {
  const R = regrasNavegador();
  const r = m && m.regras;
  if (r && R.MODELOS[r.modelo]) return r.modelo;
  for (const n of (m && m.nomesVenda) || []) { const k = R.modeloPorNome(n); if (k !== 'padrao') return k; }
  return 'padrao';
}

/** listas de nomes que valem para a loja: modelo + regras gravadas (a lista gravada substitui a do modelo) */
function listasEfetivas(m) {
  const base = regrasNavegador().MODELOS[modeloDe(m)].regras;
  const r = (m && m.regras) || {};
  const lista = (a, b) => [...(Array.isArray(a) ? a : Array.isArray(b) ? b : [])];
  return {
    semMeta: lista(r.semMeta, base.semMeta),
    semComissao: lista(r.semComissao, base.semComissao),
    rateioExclui: lista(r.rateio && r.rateio.exclui, base.rateio && base.rateio.exclui),
  };
}

/** regras para mandar à vendedora: sempre com as três listas preenchidas e traduzidas por mapearNome */
function regrasAnonimas(m, mapearNome) {
  const ef = listasEfetivas(m);
  const r = (m && m.regras) || {};
  return {
    ...r,
    semMeta: ef.semMeta.map(mapearNome),
    semComissao: ef.semComissao.map(mapearNome),
    rateio: { ...(r.rateio || {}), exclui: ef.rateioExclui.map(mapearNome) },
  };
}

module.exports = { regrasNavegador, modeloDe, listasEfetivas, regrasAnonimas };
