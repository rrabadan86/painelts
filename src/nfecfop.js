'use strict';
/**
 * CFOP escolhido pela loja para as NF-e que o robô emite no AppNext (Configurações → Integrações → Notas fiscais e
 * passo 5 da configuração guiada). Vazio = automático, como sempre foi: venda 5102 e, na devolução, o da regra fiscal
 * (sequência) de devolução da loja. As opções são os CFOPs que o robô leu do próprio AppNext ("Buscar cadastros").
 *   loja.nfeCfop = { venda: '5102' | '', devolucao: '5202' | '' }
 */
const C = require('./config');

const CODIGO = /^[56]\d{3}$/;
/** '' (automático) ou um CFOP de saída de 4 dígitos começando por 5 (dentro do estado) ou 6 (fora) */
const limpar = (v) => { const s = String(v ?? '').replace(/\D/g, ''); return CODIGO.test(s) ? s : ''; };
function validar(b) {
  const o = b && typeof b === 'object' ? b : {};
  const out = {};
  for (const k of ['venda', 'devolucao']) {
    const bruto = String(o[k] ?? '').trim();
    if (bruto && !limpar(bruto)) return { erro: `CFOP de ${k === 'venda' ? 'venda' : 'devolução'} inválido: use 4 números começando por 5 ou 6 (ex.: 5102), ou deixe automático.` };
    out[k] = limpar(bruto);
  }
  return { ok: out };
}
/** o que vale para a loja agora */
const daLoja = (id) => { const l = (C.get().lojas || []).find((x) => x.id === id); return { venda: limpar(l && l.nfeCfop && l.nfeCfop.venda), devolucao: limpar(l && l.nfeCfop && l.nfeCfop.devolucao) }; };
/** CFOPs de saída que o robô leu do AppNext (cadastros.cfops), sem repetir, em ordem */
function opcoes(cadastros) {
  const l = (cadastros && Array.isArray(cadastros.cfops) ? cadastros.cfops : []).map((x) => ({ codigo: limpar(x && x.codigo), descricao: String((x && x.descricao) || '').slice(0, 120) })).filter((x) => x.codigo);
  const m = new Map(); for (const x of l) if (!m.has(x.codigo)) m.set(x.codigo, x); // o primeiro de cada código
  return [...m.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/** a lista lida do AppNext para a loja: { em, lista } (vazia quando o robô ainda não buscou os cadastros) */
function listaAppNext(id) {
  try { const cad = require('./nfe').cadastros(id); return { em: cad ? cad.em : null, lista: opcoes(cad) }; } catch { return { em: null, lista: [] }; }
}

module.exports = { validar, daLoja, opcoes, limpar, listaAppNext };
