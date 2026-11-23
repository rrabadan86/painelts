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

/** regras fiscais (sequências) do AppNext, para mostrar pelo nome (pedido do dono, 23/11/2026: "o correto não seria escolher a
 *  descrição?"). De venda: só informação (cada produto usa a regra vinculada a ele no AppNext, com ST ou sem ST). De devolução:
 *  a nota de devolução tem UM CFOP e o AppNext casa cada produto com a regra desse CFOP — escolher a regra é escolher o CFOP dela. */
const limpaRegra = (q) => ({ id: String((q && q.id) || '').slice(0, 60), descricao: String((q && q.descricao) || '').slice(0, 80), cfop: limpar(q && q.cfop), produtos: Math.max(0, Math.round(+(q && q.produtos) || 0)), motivo: String((q && q.motivo) || '').slice(0, 6), motivoNome: String((q && q.motivoNome) || '').slice(0, 60) });
const ehDevolucao = (q) => q.motivo === '19' || /devolu/i.test(q.motivoNome) || /devolu/i.test(q.descricao);
const ehVenda = (q) => q.motivo === '1' || /^venda/i.test(q.motivoNome);
const fs = require('fs'), path = require('path');
const arqRegrasDev = (id) => path.join(C.pastaLoja(id), 'nfe', 'regras-devolucao.json');
/** guarda as regras de devolução que o robô viu na última devolução (a leitura dos cadastros é da tela de venda e pode não trazê-las) */
function guardarRegrasDev(id, regras, em) {
  const l = (regras || []).map(limpaRegra).filter((q) => q.cfop);
  if (!l.length) return;
  fs.mkdirSync(path.dirname(arqRegrasDev(id)), { recursive: true });
  C.gravarAtomico(arqRegrasDev(id), JSON.stringify({ em: em || new Date().toISOString(), lista: l }), 0o640);
}
function regrasDe(id, cad) {
  const todas = (cad && Array.isArray(cad.regras) ? cad.regras : []).map(limpaRegra).filter((q) => q.id);
  let dev = todas.filter(ehDevolucao).filter((q) => q.cfop);
  if (!dev.length) { try { dev = (JSON.parse(fs.readFileSync(arqRegrasDev(id), 'utf8')).lista || []).map(limpaRegra); } catch { /* ainda não houve devolução */ } }
  return { venda: todas.filter(ehVenda), devolucao: dev };
}
/** a lista lida do AppNext para a loja: { em, lista (CFOPs), regras: { venda, devolucao } } (vazias quando o robô ainda não buscou) */
function listaAppNext(id) {
  try { const cad = require('./nfe').cadastros(id); return { em: cad ? cad.em : null, lista: opcoes(cad), regras: regrasDe(id, cad) }; } catch { return { em: null, lista: [], regras: { venda: [], devolucao: [] } }; }
}

module.exports = { validar, daLoja, opcoes, limpar, listaAppNext, guardarRegrasDev, regrasDe };
