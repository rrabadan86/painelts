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
const preco = (v) => {
  if (typeof v === 'number') return v;
  const s = txt(v).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
};
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** lê as linhas da planilha: descobre se é "Produtos" ou "Produtos Compostos" pelo título da primeira linha */
function ler(rows) {
  const titulo = norm(rows.slice(0, 3).map((r) => (r || []).map(txt).join(' ')).join(' '));
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
  const m = titulo.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})/);
  const em = m ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00`).toISOString() : new Date().toISOString();
  return { tipo, em, itens };
}

function atual(id) {
  try { return JSON.parse(fs.readFileSync(arq(id), 'utf8')); } catch { return null; }
}

async function importar(id, buf, origem = 'painel') {
  const { linhasDeBuffer } = require('./sources');
  const novo = ler(await linhasDeBuffer(buf));
  const d = atual(id) || {};
  d[novo.tipo] = { em: novo.em, importadoEm: new Date().toISOString(), origem, itens: novo.itens };
  fs.mkdirSync(pasta(id), { recursive: true });
  C.gravarAtomico(arq(id), JSON.stringify(d), 0o640);
  return { tipo: novo.tipo, itens: novo.itens.length, comPreco: novo.itens.filter((i) => i.preco > 0.01).length, em: novo.em };
}

function pendentes(id) {
  try { return fs.readdirSync(pastaEntrada(id)).filter((f) => /\.xlsx$/i.test(f) && !f.includes('.tmp')).sort(); } catch { return []; }
}
/** planilhas que o coletor deixou: importa todas (produtos e compostos) e apaga */
async function processar(id) {
  const out = [];
  for (const f of pendentes(id)) {
    try { out.push(await importar(id, fs.readFileSync(path.join(pastaEntrada(id), f)), 'coletor')); }
    catch (e) { console.error(`[tabela] ${id}: ${f}: ${e.message}`); }
    try { fs.unlinkSync(path.join(pastaEntrada(id), f)); } catch { /* ok */ }
  }
  return out;
}

/** resumo para o navegador: as duas listas juntas (o composto vale quando o código repete) */
function resumo(id) {
  const d = atual(id);
  if (!d) return null;
  const itens = new Map();
  for (const t of ['simples', 'compostos']) for (const i of (d[t] && d[t].itens) || []) itens.set(i.cod, { ...i, composto: t === 'compostos' });
  return { simples: d.simples ? { em: d.simples.em, origem: d.simples.origem, n: d.simples.itens.length } : null, compostos: d.compostos ? { em: d.compostos.em, origem: d.compostos.origem, n: d.compostos.itens.length } : null, itens: [...itens.values()] };
}

module.exports = { ler, atual, importar, pendentes, processar, resumo };
