/* Preço de tabela do cadastro do AppNext: Produtos → Produtos e Produtos → Produtos Compostos (as duas exportações em Excel
 * têm as mesmas colunas: Código, Código de Barras, Descrição, Unidade, Grupo, Subgrupo, Preço).
 * - Produtos: o que é vendido como está (acessórios, envasados, sachês, Tea Room…).
 * - Produtos Compostos: o que é montado de outro item (os pacotes de chá a granel 50G, 100G…, minitins, kits, bebidas EG).
 * Guarda as duas listas em dados/<loja>/cadastro/tabela.json; cada envio substitui a lista do mesmo tipo.
 *   dados/<loja>/cadastro/entrada/*_produtos.xlsx e *_compostos.xlsx  baixadas pelo coletor (processadas aqui) */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const pasta = (id) => path.join(C.pastaLoja(id), 'cadastro');
const pastaEntrada = (id) => path.join(pasta(id), 'entrada');
const arq = (id) => path.join(pasta(id), 'tabela.json');

const txt = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') { if (v.richText) return v.richText.map((x) => x.text).join(''); if (v.text != null) return String(v.text); if (v.result != null) return String(v.result); }
  return String(v).trim();
};
const preco = (v) => require('./numero').valorBR(typeof v === 'object' && v ? txt(v) : v); // src/numero.js
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function dataDoTitulo(t) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(String(t || ''));
  if (!m) return null;
  let [a, b] = [+m[1], +m[2]], hh = +m[4];
  if (m[7]) { if (/pm/i.test(m[7]) && hh < 12) hh += 12; if (/am/i.test(m[7]) && hh === 12) hh = 0; }
  let dia = a, mes = b;
  if (b > 12 || (m[7] && a <= 12)) { dia = b; mes = a; }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hh > 23) return null;
  const p2 = (n) => String(n).padStart(2, '0');
  const iso = `${m[3]}-${p2(mes)}-${p2(dia)}T${p2(hh)}:${m[5]}:${m[6] || '00'}-03:00`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** lê as linhas da planilha: descobre se é "Produtos" ou "Produtos Compostos" pelo título da primeira linha */
function ler(rows) {
  const cabCru = rows.slice(0, 3).map((r) => (r || []).map(txt).join(' ')).join(' ');
  const titulo = norm(cabCru);
  const tipo = /compost/.test(titulo) ? 'compostos' : 'simples';
  const iCab = rows.findIndex((r) => (r || []).some((c) => norm(txt(c)) === 'codigo') && (r || []).some((c) => norm(txt(c)) === 'preco'));
  if (iCab < 0) throw new Error('Não achei as colunas "Código" e "Preço": use a exportação em Excel de Produtos → Produtos (ou Produtos Compostos) do AppNext.');
  const cab = rows[iCab].map((c) => norm(txt(c)));
  const col = (n) => cab.indexOf(n);
  const ci = { cod: col('codigo'), barras: col('codigo de barras'), desc: col('descricao'), un: col('unidade'), grupo: col('grupo'), sub: col('subgrupo'), preco: col('preco') };
  if (ci.desc < 0) throw new Error('Não achei a coluna "Descrição".');
  const itens = [];
  const vistos = new Set();
  for (const r of rows.slice(iCab + 1)) {
    if (!r) continue;
    const cod = txt(r[ci.cod]);
    if (!cod || vistos.has(cod)) continue;
    vistos.add(cod);
    const b = ci.barras >= 0 ? txt(r[ci.barras]) : '';
    itens.push({ cod, barras: b && b !== '-' ? b : '', desc: txt(r[ci.desc]), un: ci.un >= 0 ? txt(r[ci.un]) : '', grupo: ci.grupo >= 0 ? txt(r[ci.grupo]) : '', sub: ci.sub >= 0 && txt(r[ci.sub]) !== '-' ? txt(r[ci.sub]) : '', preco: preco(r[ci.preco]) });
  }
  if (!itens.length) throw new Error('A planilha não tem produtos.');
  const em = dataDoTitulo(cabCru) || new Date().toISOString();
  return { tipo, em, itens };
}

function atual(id) {
  try { return JSON.parse(fs.readFileSync(arq(id), 'utf8')); } catch { return null; }
}

const resumoCache = new Map(); // id -> { mtimeMs, size, val }

async function importar(id, buf, origem = 'painel') {
  const { linhasDeBuffer } = require('./sources');
  const novo = ler(await linhasDeBuffer(buf));
  const d = atual(id) || {};
  d[novo.tipo] = { em: novo.em, importadoEm: new Date().toISOString(), origem, itens: novo.itens };
  fs.mkdirSync(pasta(id), { recursive: true });
  C.gravarAtomico(arq(id), JSON.stringify(d), 0o640);
  resumoCache.delete(id);
  return { tipo: novo.tipo, itens: novo.itens.length, comPreco: novo.itens.filter((i) => i.preco > 0.01).length, em: novo.em };
}

function pendentes(id) {
  try { return fs.readdirSync(pastaEntrada(id)).filter((f) => /\.xlsx$/i.test(f) && !f.includes('.tmp')).sort(); } catch { return []; }
}
const procAtivo = new Set();
/** planilhas que o coletor deixou: importa todas (produtos e compostos) e apaga (ou guarda .erro) */
async function processar(id) {
  if (procAtivo.has(id)) return [];
  procAtivo.add(id);
  try {
    const out = [], dir = pastaEntrada(id);
    for (const f of pendentes(id)) {
      let ok = false;
      try { out.push(await importar(id, fs.readFileSync(path.join(dir, f)), 'coletor')); ok = true; }
      catch (e) { console.error(`[tabela] ${id}: ${f}: ${e.message}`); }
      if (ok) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ok */ }
      } else {
        try {
          fs.renameSync(path.join(dir, f), path.join(dir, f + '.erro'));
          const errs = fs.readdirSync(dir).filter((x) => x.endsWith('.erro')).sort();
          errs.slice(0, Math.max(0, errs.length - 5)).forEach((x) => { try { fs.unlinkSync(path.join(dir, x)); } catch { /* ok */ } });
        } catch { /* ok */ }
      }
    }
    return out;
  } finally {
    procAtivo.delete(id);
  }
}

/** resumo para o navegador: as duas listas juntas (o composto vale quando o código repete) */
function resumo(id) {
  const f = arq(id);
  let st;
  try { st = fs.statSync(f); } catch { resumoCache.delete(id); return null; }
  const hit = resumoCache.get(id);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.val;
  const d = atual(id);
  if (!d) return null;
  const itens = new Map();
  for (const t of ['simples', 'compostos']) for (const i of (d[t] && d[t].itens) || []) itens.set(i.cod, { ...i, composto: t === 'compostos' });
  const val = { simples: d.simples ? { em: d.simples.em, origem: d.simples.origem, n: d.simples.itens.length } : null, compostos: d.compostos ? { em: d.compostos.em, origem: d.compostos.origem, n: d.compostos.itens.length } : null, itens: [...itens.values()] };
  resumoCache.set(id, { mtimeMs: st.mtimeMs, size: st.size, val });
  return val;
}

module.exports = { ler, atual, importar, pendentes, processar, resumo };
