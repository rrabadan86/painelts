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

const baseCache = new Map();
const lerCache = new Map();
const processando = new Set();

function lerBase(id, mutavel) {
  const f = arqBase(id);
  let st;
  try { st = fs.statSync(f); } catch { baseCache.delete(f); return { notas: {}, importacoes: [] }; }
  const hit = baseCache.get(f);
  if (!mutavel && hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.val;
  try {
    const val = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
    if (!mutavel) baseCache.set(f, { mtimeMs: st.mtimeMs, size: st.size, val });
    return val;
  } catch { return { notas: {}, importacoes: [] }; }
}
function gravarBase(id, b) {
  const f = arqBase(id);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  C.gravarAtomico(f, zlib.gzipSync(Buffer.from(JSON.stringify(b))), 0o640);
  baseCache.delete(f);
  lerCache.delete(f);
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
  const b = lerBase(id, true);
  // não apaga um período com um arquivo vazio (exportação incompleta)
  const naJanela = Object.values(b.notas).filter((n) => n.d >= j.de && n.d <= j.ate).length;
  if (!j.notas.length && (j.total === 0 || j.total == null) && naJanela) throw new Error(`o XML de ${j.de} a ${j.ate} veio sem notas, mas o painel já tem ${naJanela} nesse período; nada foi apagado`);
  let removidas = 0;
  for (const [k, n] of Object.entries(b.notas)) if (n.d >= j.de && n.d <= j.ate) { delete b.notas[k]; removidas++; }
  let novas = 0;
  for (const n of j.notas) {
    const cupom = Number(n.cupom);
    if (!Number.isInteger(cupom) || !DATA.test(n.data || '')) continue;
    let cpf = String(n.cpf || '').replace(/\D/g, '').slice(0, 11);
    if (cpf.length >= 8 && cpf.length < 11) cpf = cpf.padStart(11, '0');
    cpf = cpf && !/^0+$/.test(cpf) ? cpf : null;
    let cnpj = String(n.cnpj || '').replace(/\D/g, '').slice(0, 14);
    if (cnpj.length >= 12 && cnpj.length < 14) cnpj = cnpj.padStart(14, '0');
    cnpj = cnpj && !/^0+$/.test(cnpj) ? cnpj : null;
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
  if (processando.has(id)) return [];
  processando.add(id);
  const avisos = [];
  try {
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
  } finally { processando.delete(id); }
  return avisos;
}

/** cupons com CPF (formato igual ao da planilha Xml) e nomes por CPF */
function ler(id) {
  const f = arqBase(id);
  let st = null;
  try { st = fs.statSync(f); } catch { lerCache.delete(f); }
  if (st) {
    const hit = lerCache.get(f);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.val;
  }
  const b = lerBase(id);
  const porCupom = new Map();
  const nomes = new Map();
  for (const n of Object.values(b.notas)) {
    let doc = n.cpf || n.cnpj;
    if (!doc) continue;
    if (n.cpf && doc.length >= 8 && doc.length < 11) doc = doc.padStart(11, '0');
    // NFC-e (65) é o cupom do caixa; se o número repetir numa NF-e (55), fica a NFC-e
    // número + data: o mesmo número pode voltar em outro caixa/série ou outro dia (a venda casa pela data ±1)
    const k = n.c + '|' + n.d;
    const atual = porCupom.get(k);
    if (!atual || (atual.m !== '65' && n.m === '65')) porCupom.set(k, { cpf: doc, cupom: n.c, m: n.m, data: n.d });
    if (n.n && !nomes.has(doc)) nomes.set(doc, n.n);
  }
  const val = { xml: [...porCupom.values()].map(({ cpf, cupom, data }) => ({ cpf, cupom, data, loja: '' })), nomes, importacoes: b.importacoes || [] };
  if (st) lerCache.set(f, { mtimeMs: st.mtimeMs, size: st.size, val });
  return val;
}

function resumo(id) {
  const b = lerBase(id);
  const notas = Object.values(b.notas);
  let de = null, ate = null;
  for (const n of notas) { if (!de || n.d < de) de = n.d; if (!ate || n.d > ate) ate = n.d; }
  // a base guarda só as notas com CPF/CNPJ: o "até" é o período que as importações cobriram (com ou sem CPF),
  // senão uns dias sem cliente identificado pareciam XML atrasado
  const ultimaComDoc = ate;
  for (const im of b.importacoes || []) if (im.ate && (!ate || im.ate > ate)) ate = im.ate;
  let erros = [];
  try { erros = fs.readdirSync(pastaEntrada(id)).filter((f) => /_xml\.json\.erro$/i.test(f)).sort().slice(-5); } catch { /* ok */ }
  return { existe: existe(id), notas: notas.length, de, ate, ultimaComDoc, importacoes: (b.importacoes || []).slice(0, 10), pendentes: pendentes(id).length, erros };
}

module.exports = { existe, assinatura, pendentes, processar, ler, resumo, importar };
