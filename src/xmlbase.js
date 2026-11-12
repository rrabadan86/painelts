'use strict';
/**
 * Notas fiscais (XML) de cada loja, para saber o CPF de quem comprou em cada cupom.
 *
 *   dados/<loja>/entrada/*_xml.json   ← o coletor grava aqui (Fiscal → Gerar XML do AppNext)
 *   dados/<loja>/base/xml.json.gz     ← { notas: { <chave>: { c, d, cpf, cnpj, n, m, s } } }
 *
 * Cada importação substitui as notas do período que ela cobre (como as vendas).
 * O painel usa só as notas com CPF/CNPJ: cupom → CPF (e o nome, quando a nota traz).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const C = require('./config');

const arqBase = (id) => path.join(C.pastaLoja(id), 'base', 'xml.json.gz');
const pastaEntrada = (id) => path.join(C.pastaLoja(id), 'entrada');
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function lerBase(id) {
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(arqBase(id))).toString('utf8')); } catch { return { notas: {}, importacoes: [] }; }
}
function gravarBase(id, b) {
  fs.mkdirSync(path.dirname(arqBase(id)), { recursive: true });
  C.gravarAtomico(arqBase(id), zlib.gzipSync(Buffer.from(JSON.stringify(b))), 0o644);
}
const existe = (id) => fs.existsSync(arqBase(id));
function assinatura(id) { try { return String(fs.statSync(arqBase(id)).mtimeMs); } catch { return '-'; } }
function pendentes(id) {
  try { return fs.readdirSync(pastaEntrada(id)).filter((f) => /_xml\.json$/i.test(f)).sort(); } catch { return []; }
}

/** junta um arquivo do coletor na base (substitui o período dele) */
function importar(id, arquivo) {
  const j = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (!DATA.test(j.de || '') || !DATA.test(j.ate || '') || !Array.isArray(j.notas)) throw new Error('arquivo de XML inválido');
  const b = lerBase(id);
  let removidas = 0;
  for (const [k, n] of Object.entries(b.notas)) if (n.d >= j.de && n.d <= j.ate) { delete b.notas[k]; removidas++; }
  let novas = 0;
  for (const n of j.notas) {
    const cupom = Number(n.cupom);
    if (!Number.isInteger(cupom) || !DATA.test(n.data || '')) continue;
    const cpf = String(n.cpf || '').replace(/\D/g, '').slice(0, 11) || null;
    const cnpj = String(n.cnpj || '').replace(/\D/g, '').slice(0, 14) || null;
    if (!cpf && !cnpj) continue;
    const chave = String(n.chave || `${n.mod}-${n.serie}-${cupom}`).slice(0, 60);
    b.notas[chave] = { c: cupom, d: n.data, cpf, cnpj, n: n.nome ? String(n.nome).slice(0, 80) : null, m: String(n.mod || ''), s: String(n.serie || '') };
    novas++;
  }
  b.importacoes = [{ em: new Date().toISOString(), de: j.de, ate: j.ate, total: j.total ?? null, comDoc: novas, removidas }, ...(b.importacoes || [])].slice(0, 30);
  gravarBase(id, b);
  return { de: j.de, ate: j.ate, total: j.total ?? null, comDoc: novas };
}

/** processa a fila de XML da loja; devolve avisos */
function processar(id, nomeLoja) {
  const avisos = [];
  for (const nome of pendentes(id)) {
    const arq = path.join(pastaEntrada(id), nome);
    try {
      const r = importar(id, arq);
      const dest = path.join(C.pastaLoja(id), 'processados');
      fs.mkdirSync(dest, { recursive: true });
      fs.renameSync(arq, path.join(dest, nome));
      console.log(`[xml] ${id}: ${nome} → ${r.comDoc} notas com CPF/CNPJ de ${r.total ?? '?'} (${r.de} a ${r.ate})`);
    } catch (e) {
      avisos.push(`${nomeLoja} · ${nome}: ${e.message}`);
      try { fs.renameSync(arq, arq + '.erro'); } catch { /* ok */ }
    }
  }
  return avisos;
}

/** cupons com CPF (formato igual ao da planilha Xml) e nomes por CPF */
function ler(id) {
  const b = lerBase(id);
  const porCupom = new Map();
  const nomes = new Map();
  for (const n of Object.values(b.notas)) {
    const doc = n.cpf || n.cnpj;
    if (!doc) continue;
    // NFC-e (65) é o cupom do caixa; se o número repetir numa NF-e (55), fica a NFC-e
    const atual = porCupom.get(n.c);
    if (!atual || (atual.m !== '65' && n.m === '65')) porCupom.set(n.c, { cpf: doc, cupom: n.c, m: n.m });
    if (n.n && !nomes.has(doc)) nomes.set(doc, n.n);
  }
  return { xml: [...porCupom.values()].map(({ cpf, cupom }) => ({ cpf, cupom, loja: '' })), nomes, importacoes: b.importacoes || [] };
}

function resumo(id) {
  const b = lerBase(id);
  const notas = Object.values(b.notas);
  let de = null, ate = null;
  for (const n of notas) { if (!de || n.d < de) de = n.d; if (!ate || n.d > ate) ate = n.d; }
  return { existe: existe(id), notas: notas.length, de, ate, importacoes: (b.importacoes || []).slice(0, 10), pendentes: pendentes(id).length };
}

module.exports = { existe, assinatura, pendentes, processar, ler, resumo, importar };
