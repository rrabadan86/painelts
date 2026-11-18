'use strict';
/**
 * Classificação de produtos feita pelo painel (vale para a rede toda):
 * produtos de grupos que não entram na meta (ex.: "CONSUMÍVEIS - SEM CONTROLE DE ESTOQUE") podem ser marcados como
 * chá aromatizado, chá puro ou acessório — passam a contar na meta, comissão e royalties — ou confirmados como "fora".
 * Arquivo: config/classificacao.json { produtos: { "DESCRIÇÃO": { classe, por, em } } }
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const ARQ = () => path.join(C.CONFIG_DIR, 'classificacao.json');
const GRUPO = { arom: 'CHÁ AROMATIZADO', puro: 'CHÁ PURO', acess: 'ACESSÓRIOS', fora: 'FORA DA META' };
const CLASSES = ['arom', 'puro', 'acess', 'fora'];
const chave = (t) => String(t || '').trim().replace(/\s+/g, ' ').toUpperCase();

let cache = null, cacheMtime = -1;
function ler() {
  let mt = 0;
  try { mt = fs.statSync(ARQ()).mtimeMs; } catch { /* sem arquivo */ }
  if (cache && mt === cacheMtime) return cache;
  try { cache = JSON.parse(fs.readFileSync(ARQ(), 'utf8')); } catch { cache = {}; }
  if (!cache.produtos || typeof cache.produtos !== 'object') cache.produtos = {};
  cacheMtime = mt;
  return cache;
}
const versao = () => { try { return String(fs.statSync(ARQ()).mtimeMs); } catch { return '0'; } };

function definir(produto, classe, por) {
  const k = chave(produto);
  if (!k || k.length > 200) throw new Error('Produto inválido.');
  if (classe != null && !CLASSES.includes(classe)) throw new Error('Classificação inválida.');
  const j = ler();
  if (classe == null) delete j.produtos[k];
  else j.produtos[k] = { classe, por, em: new Date().toISOString() };
  C.gravarAtomico(ARQ(), JSON.stringify(j, null, 1), 0o640);
  cache = null;
  return j.produtos[k] || null;
}

/** aplica nas vendas carregadas: o produto reclassificado passa para o grupo da classe (o grupo original fica em grupoOrig) */
function aplicar(vendas) {
  const p = ler().produtos;
  if (!Object.keys(p).length) return 0;
  let n = 0;
  for (const v of vendas) {
    const x = p[chave(v.descricao)];
    if (!x || !GRUPO[x.classe]) continue;
    const orig = v.grupoOrig !== undefined ? v.grupoOrig : v.grupoC;
    if (v.grupoC === GRUPO[x.classe]) continue;
    v.grupoOrig = orig;
    v.grupoC = GRUPO[x.classe];
    n++;
  }
  return n;
}

module.exports = { ler, definir, aplicar, versao, chave, CLASSES };
