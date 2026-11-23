'use strict';
/**
 * Listas de vendedores das regras de comissão (Configurações → loja → Metas e Comissão): "Não entram no rateio",
 * "Vendedores sem meta individual" e "Não recebem comissão". Pedido do dono (23/11/2026): escolher entre os vendedores
 * da loja, nunca texto livre. O servidor confere: cada nome precisa ser um vendedor que aparece nas vendas da loja, um
 * nome que já estava salvo (não some sem querer) ou um dos nomes que o modelo de regras já traz (rules.js).
 * Comparação em minúsculas, como as regras de comissão comparam.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let padroes = null;
const baixo = (x) => String(x == null ? '' : x).trim().toLowerCase();
/** todos os nomes das três listas de um objeto de regras */
function listas(g) {
  if (!g) return [];
  return [...((g.rateio && g.rateio.exclui) || []), ...(g.semMeta || []), ...(g.semComissao || [])].map(baixo).filter(Boolean);
}
/** nomes que os modelos de regras (public/js/rules.js) já trazem — lido uma vez, sem copiar a regra */
function nomesDosModelos() {
  if (padroes) return padroes;
  const ctx = { TS: {}, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'rules.js'), 'utf8'), ctx);
  padroes = new Set();
  for (const m of Object.values(ctx.TS.rules.MODELOS || {})) for (const n of listas(m.regras)) padroes.add(n);
  return padroes;
}
/**
 * nomes das regras novas que não são vendedores da loja. vendedores = [{ nome }] (das vendas); salvos = regras atuais.
 * Sem a lista de vendedores (dados ainda não carregados) não dá para conferir: devolve [].
 */
function invalidos(g, vendedores, salvos) {
  if (!Array.isArray(vendedores) || !vendedores.length) return [];
  const ok = new Set([...vendedores.map((v) => baixo(v && v.nome)), ...listas(salvos), ...nomesDosModelos(), 'sem vendedor']);
  return [...new Set(listas(g).filter((n) => !ok.has(n)))];
}
module.exports = { invalidos, listas, nomesDosModelos };
