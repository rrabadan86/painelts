'use strict';
/**
 * Estoque atual e custo dos produtos (AppNext → Estoque → Estoque Atual → Exportar para Excel).
 *   dados/<loja>/estoque/atual.json      itens { cod, tipo, desc, un, qtd, min, custo } + quando
 *   dados/<loja>/estoque/entrada/*.xlsx  planilhas que o coletor baixa (processadas aqui)
 * Quantidades: o AppNext manda números inteiros multiplicados por 1.000 (86000 = 86 un; 50 = 0,05 kg)
 * e, às vezes, texto brasileiro já com a vírgula ("9.152,000" = 9.152 un).
 * Itens que somem da planilha (o relatório esconde quantidade zero) ficam com quantidade 0 e mantêm o custo.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const pasta = (id) => path.join(C.pastaLoja(id), 'estoque');
const arqAtual = (id) => path.join(pasta(id), 'atual.json');
const pastaEntrada = (id) => path.join(pasta(id), 'entrada');

const ESQ = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
function quantidade(v) {
  if (v == null || v === '' || v === '-') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v / 1000 : null;
  if (typeof v === 'object' && v && 'result' in v) return quantidade(v.result);
  const s = String(v).trim();
  if (s === '-' || s === '') return null;
  if (/^-?[\d.]+,\d+$/.test(s)) return +s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n / 1000 : null;
}
function dinheiro(v) {
  if (v == null || v === '' || v === '-') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && v && 'result' in v) return dinheiro(v.result);
  const s = String(v).replace(/R\$\s*/i, '').trim();
  const n = /,\d{1,4}$/.test(s) ? +s.replace(/\./g, '').replace(',', '.') : +s;
  return Number.isFinite(n) ? n : null;
}
/** "NextSoft - Estoque Atual ( 12/11/2026, 19:01:05 )" → ISO */
function dataDoTitulo(t) {
  // "14/11/2026, 22:40" (dd/mm) ou, em algumas versões do AppNext, "11/14/2026, 10:40 PM" (mm/dd, 12 h)
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(String(t || ''));
  if (!m) return null;
  let [a, b] = [+m[1], +m[2]], hh = +m[4];
  if (m[7]) { if (/pm/i.test(m[7]) && hh < 12) hh += 12; if (/am/i.test(m[7]) && hh === 12) hh = 0; }
  let dia = a, mes = b;
  if (b > 12 || (m[7] && a <= 12)) { dia = b; mes = a; }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hh > 23) return null;
  const p2 = (n) => String(n).padStart(2, '0');
  const iso = `${m[3]}-${p2(mes)}-${p2(dia)}T${p2(hh)}:${m[5]}:${m[6] || '00'}-03:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** linhas da planilha → { em, itens } */
function ler(rows) {
  const iCab = rows.findIndex((r) => (r || []).some((c) => ESQ(c) === 'descricao') && (r || []).some((c) => ESQ(c).startsWith('custo unit')));
  if (iCab < 0) throw new Error('Não parece a planilha "Estoque Atual" do AppNext (faltam as colunas Descrição e Custo Unitário).');
  const cab = rows[iCab].map(ESQ);
  const col = (...nomes) => cab.findIndex((c) => nomes.some((n) => c === n || c.startsWith(n)));
  const k = { tipo: col('tipo'), cod: col('codigo', 'cod'), desc: col('descricao'), un: col('unidade', 'un'), qtd: col('quantidade', 'qtd'), min: col('estoque minimo', 'minimo'), custo: col('custo unit') };
  if (k.cod < 0 || k.qtd < 0) throw new Error('A planilha precisa das colunas Código e Quantidade.');
  const titulo = rows.slice(0, iCab).flat().find((c) => /estoque/i.test(String(c || '')));
  const itens = [];
  for (const r of rows.slice(iCab + 1)) {
    if (!r || r[k.cod] == null || r[k.cod] === '') continue;
    const desc = String(r[k.desc] ?? '').trim();
    if (!desc) continue;
    itens.push({
      cod: String(typeof r[k.cod] === 'object' && r[k.cod].result != null ? r[k.cod].result : r[k.cod]).trim(),
      tipo: k.tipo >= 0 ? String(r[k.tipo] ?? '').trim() : '',
      desc,
      un: k.un >= 0 ? String(r[k.un] ?? '').trim() : '',
      qtd: quantidade(r[k.qtd]) ?? 0,
      min: k.min >= 0 ? quantidade(r[k.min]) : null,
      custo: k.custo >= 0 ? dinheiro(r[k.custo]) : null,
    });
  }
  if (!itens.length) throw new Error('Nenhum produto na planilha.');
  return { em: dataDoTitulo(titulo), itens };
}

const arqHist = (id) => path.join(pasta(id), 'custos.json');
/** histórico de custo por código: { cod: [[AAAA-MM-DD, custo], …] } — um ponto novo só quando o custo muda */
// pontos com data que não dá para ler (estoque antigo com a data do título no formato americano) ficam de fora
const limparHist = (h) => { for (const k of Object.keys(h)) { h[k] = h[k].filter(([d]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))); if (!h[k].length) delete h[k]; } return h; };
function historico(id) {
  try { return limparHist(JSON.parse(fs.readFileSync(arqHist(id), 'utf8'))); } catch { /* ainda não existe */ }
  const a = atual(id); // começa pelo estoque que já está no painel
  if (a && a.itens) { registrarCustos(id, a.itens, a.em); try { return JSON.parse(fs.readFileSync(arqHist(id), 'utf8')); } catch { /* sem custos */ } }
  return {};
}
const lerHist = (id) => { try { return JSON.parse(fs.readFileSync(arqHist(id), 'utf8')); } catch { return {}; } };
function registrarCustos(id, itens, quando) {
  const h = lerHist(id);
  const ms = quando ? Date.parse(quando) : NaN;
  const dia = Number.isFinite(ms) ? C.diaSP(ms) : C.hojeBR();
  let mudou = false;
  for (const it of itens) {
    if (!(it.custo > 0)) continue;
    const l = h[it.cod] || (h[it.cod] = []);
    const ult = l[l.length - 1];
    if (ult && Math.abs(ult[1] - it.custo) < 0.005) continue;
    if (ult && ult[0] === dia) ult[1] = it.custo; else l.push([dia, it.custo]);
    if (l.length > 60) l.splice(0, l.length - 60);
    mudou = true;
  }
  if (mudou) C.gravarAtomico(arqHist(id), JSON.stringify(h), 0o640);
}

const arqCompras = (id) => path.join(pasta(id), 'compras.json');
/** notas de compra que o coletor guarda (Estoque → Entrada de Produtos do AppNext), por código:
 *  { cod: [[AAAA-MM-DD da entrada, custo unitário, nº da NF, quantidade, fornecedor], …] } — só compras (sem devolução/troca)
 *  + atualizado. Chás chegam em kg: custo por kg, como no estoque. */
function compras(id) {
  let j;
  try { j = JSON.parse(fs.readFileSync(arqCompras(id), 'utf8')); } catch { return null; }
  const out = {};
  for (const n of j.notas || []) {
    if (!/compra/i.test(n.motivo || '') || !/^conclu/i.test(n.status || '')) continue;
    const dia = String(n.entrada || n.emissao || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
    for (const it of n.itens || []) {
      if (!it.cod || !(it.custo > 0) || !(it.qtd > 0)) continue;
      (out[it.cod] || (out[it.cod] = [])).push([dia, Math.round(it.custo * 100) / 100, n.nf, it.qtd, n.fornecedor || '']);
    }
  }
  for (const l of Object.values(out)) l.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { atualizado: j.atualizado || null, notas: (j.notas || []).length, itens: out };
}

/** notas de entrada guardadas pelo coletor, inteiras (para a lista e o detalhe na tela Preços) */
function notas(id) {
  let j;
  try { j = JSON.parse(fs.readFileSync(arqCompras(id), 'utf8')); } catch { return null; }
  return { atualizado: j.atualizado || null, desde: j.desde || null, notas: (j.notas || []).map((n) => ({
    id: n.id, nf: n.nf, serie: n.serie, chave: n.chave || '', emissao: n.emissao || '', entrada: n.entrada || '', status: n.status || '', motivo: n.motivo || '', cfop: n.cfop || '',
    fornecedor: n.fornecedor || '', total: n.total, itens: (n.itens || []).map((i) => ({ cod: i.cod, nome: i.nome, un: i.un, qtd: i.qtd, vu: i.vu, custo: i.custo, grupo: i.grupo })),
  })) };
}

const atualCache = new Map(); // id -> { mtimeMs, size, val }
function atual(id) {
  const f = arqAtual(id);
  let st;
  try { st = fs.statSync(f); } catch { atualCache.delete(id); return null; }
  const hit = atualCache.get(id);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return { ...hit.val };
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
  if (j && (!j.em || Number.isNaN(Date.parse(j.em)))) j.em = j.importadoEm || null; // data do título que não deu para ler
  atualCache.set(id, { mtimeMs: st.mtimeMs, size: st.size, val: j });
  return { ...j };
}

/** grava a planilha nova; o que sumiu fica com quantidade 0 (o relatório esconde itens zerados) */
async function importar(id, buf, origem = 'painel') {
  const { linhasDeBuffer } = require('./sources');
  const novo = ler(await linhasDeBuffer(buf));
  const antes = atual(id);
  const vistos = new Set(novo.itens.map((i) => i.cod));
  const zerados = antes ? antes.itens.filter((i) => !vistos.has(i.cod)).map((i) => ({ ...i, qtd: 0, zerado: true })) : [];
  const dados = { em: novo.em || new Date().toISOString(), importadoEm: new Date().toISOString(), origem, itens: [...novo.itens, ...zerados] };
  fs.mkdirSync(pasta(id), { recursive: true });
  C.gravarAtomico(arqAtual(id), JSON.stringify(dados), 0o640);
  atualCache.delete(id);
  // primeira vez: o estoque que já existia vira o ponto de partida do histórico
  if (antes && !fs.existsSync(arqHist(id))) registrarCustos(id, antes.itens, antes.em);
  registrarCustos(id, novo.itens, dados.em);
  return { itens: novo.itens.length, zerados: zerados.length, semCusto: novo.itens.filter((i) => !i.custo).length, em: dados.em };
}

function pendentes(id) {
  try { return fs.readdirSync(pastaEntrada(id)).filter((f) => /\.xlsx$/i.test(f) && !f.includes('.tmp')).sort(); } catch { return []; }
}
const procAtivo = new Set();
function guardarErro(dir, f) {
  try {
    fs.renameSync(path.join(dir, f), path.join(dir, f + '.erro'));
    const errs = fs.readdirSync(dir).filter((x) => x.endsWith('.erro')).sort();
    errs.slice(0, Math.max(0, errs.length - 5)).forEach((x) => { try { fs.unlinkSync(path.join(dir, x)); } catch { /* ok */ } });
  } catch { /* ok */ }
}
/** planilhas que o coletor deixou: importa a mais nova e descarta as outras (se falhar, guarda .erro) */
async function processar(id) {
  if (procAtivo.has(id)) return null;
  procAtivo.add(id);
  try {
    const fs_ = pendentes(id);
    if (!fs_.length) return null;
    const dir = pastaEntrada(id), ultimo = fs_[fs_.length - 1];
    let r = null, falhou = false;
    try { r = await importar(id, fs.readFileSync(path.join(dir, ultimo)), 'coletor'); }
    catch (e) { falhou = true; console.error(`[estoque] ${id}: ${ultimo}: ${e.message}`); }
    for (const f of fs_) {
      if (falhou && f === ultimo) guardarErro(dir, f);
      else try { fs.unlinkSync(path.join(dir, f)); } catch { /* ok */ }
    }
    return r;
  } finally {
    procAtivo.delete(id);
  }
}

// ---------- configuração por loja (prazo do fornecedor, cobertura, embalagens dos chás) ----------
const EMB_PADRAO = {
  // chá a granel: saco kraft + 2 etiquetas Sato (frente e verso)
  50: [{ cod: '80149', qtd: 1 }, { cod: '81010', qtd: 2 }],
  100: [{ cod: '80149', qtd: 1 }, { cod: '81010', qtd: 2 }],
  250: [{ cod: '80150', qtd: 1 }, { cod: '81010', qtd: 2 }],
  500: [{ cod: '80151', qtd: 1 }, { cod: '81010', qtd: 2 }],
  1000: [{ cod: '80152', qtd: 1 }, { cod: '81010', qtd: 2 }],
};
// categorias dos outros custos (editáveis); "outros" sempre existe e recebe o que não tem categoria
const CATEGORIAS = [{ id: 'func', nome: 'Funcionários' }, { id: 'imovel', nome: 'Imóvel' }, { id: 'sistemas', nome: 'Sistemas' }, { id: 'outros', nome: 'Outros' }];
const PADRAO = { categorias: CATEGORIAS, entregaDias: 10, coberturaDias: 30, paradoDias: 60, segurancaPct: 50, simplesPct: 0, cartaoPct: 0, outros: [], margemMin: 15, margemAlvo: 30, embalagens: EMB_PADRAO };
function cfg(loja) {
  const c = (loja && loja.estoqueCfg) || {};
  return {
    entregaDias: Number.isInteger(c.entregaDias) ? c.entregaDias : PADRAO.entregaDias,
    coberturaDias: Number.isInteger(c.coberturaDias) ? c.coberturaDias : PADRAO.coberturaDias,
    paradoDias: Number.isInteger(c.paradoDias) ? c.paradoDias : PADRAO.paradoDias,
    segurancaPct: Number.isInteger(c.segurancaPct) ? c.segurancaPct : PADRAO.segurancaPct,
    // margem líquida: % do Simples Nacional e da taxa da maquininha sobre o valor vendido
    simplesPct: Number.isFinite(c.simplesPct) ? c.simplesPct : PADRAO.simplesPct,
    cartaoPct: Number.isFinite(c.cartaoPct) ? c.cartaoPct : PADRAO.cartaoPct,
    // outros custos da loja: % das vendas ou R$ por mês (dividido pelas vendas do mês), em tudo, só loja ou só EG
    outros: (Array.isArray(c.outros) ? c.outros : []).map((x) => ({ ...x, cat: x.cat || 'outros' })),
    categorias: Array.isArray(c.categorias) && c.categorias.length ? c.categorias : CATEGORIAS,
    // despesas de um mês só (ex.: IPVA/IPTU em janeiro); anual = repete no mesmo mês todo ano
    pontuais: Array.isArray(c.pontuais) ? c.pontuais : [],
    margemMin: Number.isFinite(c.margemMin) ? c.margemMin : PADRAO.margemMin,
    margemAlvo: Number.isFinite(c.margemAlvo) ? c.margemAlvo : PADRAO.margemAlvo,
    embalagens: c.embalagens && typeof c.embalagens === 'object' ? c.embalagens : EMB_PADRAO,
  };
}
function validarCfg(b) {
  const n = (v, a, z) => { const x = Math.round(+v); return x >= a && x <= z ? x : null; };
  const out = { entregaDias: n(b.entregaDias, 0, 120), coberturaDias: n(b.coberturaDias, 1, 365), paradoDias: n(b.paradoDias, 7, 730), segurancaPct: n(b.segurancaPct ?? PADRAO.segurancaPct, 0, 300) };
  if (Object.values(out).some((v) => v == null)) return { erro: 'Confira os números (entrega 0–120 dias, pedido 1–365 dias, parado 7–730 dias, segurança 0–300%).' };
  const pct = (v) => { const x = Math.round(Number(String(v ?? 0).replace(',', '.')) * 100) / 100; return Number.isFinite(x) && x >= 0 && x <= 50 ? x : null; };
  out.simplesPct = pct(b.simplesPct); out.cartaoPct = pct(b.cartaoPct);
  if (out.simplesPct == null || out.cartaoPct == null) return { erro: 'Simples Nacional e maquininha: use um percentual entre 0 e 50.' };
  const mm = (v, d) => { const x = Math.round(Number(String(v ?? d).replace(',', '.')) * 10) / 10; return Number.isFinite(x) && x >= -50 && x <= 95 ? x : null; };
  out.margemMin = mm(b.margemMin, PADRAO.margemMin); out.margemAlvo = mm(b.margemAlvo, PADRAO.margemAlvo);
  if (out.margemMin == null || out.margemAlvo == null) return { erro: 'Margens: use um percentual entre −50 e 95.' };
  // categorias: nome curto; "outros" sempre fica
  const cats = Array.isArray(b.categorias) ? b.categorias : CATEGORIAS;
  if (cats.length > 12) return { erro: 'No máximo 12 categorias.' };
  out.categorias = [];
  for (const c of cats) {
    const nome = String(c.nome || '').replace(/[\r\n]/g, ' ').trim().slice(0, 30);
    const id = String(c.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);
    if (!nome || !id) return { erro: 'Dê um nome a cada categoria.' };
    if (out.categorias.some((x) => x.id === id)) continue;
    out.categorias.push({ id, nome });
  }
  if (!out.categorias.some((x) => x.id === 'outros')) out.categorias.push({ id: 'outros', nome: 'Outros' });
  const idsCat = new Set(out.categorias.map((x) => x.id));
  const outros = Array.isArray(b.outros) ? b.outros : [];
  if (outros.length > 40) return { erro: 'No máximo 40 custos.' };
  out.outros = [];
  for (const x of outros) {
    const nome = String(x.nome || '').replace(/[\r\n]/g, ' ').trim().slice(0, 40);
    const valor = Math.round(Number(String(x.valor ?? '').replace(',', '.')) * 100) / 100;
    if (!nome && !(valor > 0)) continue; // linha vazia
    if (!nome) return { erro: 'Dê um nome a cada custo.' };
    if (!['pct', 'mes'].includes(x.tipo)) return { erro: `Custo "${nome}": escolha % das vendas ou R$ por mês.` };
    if (!['tudo', 'loja', 'eg'].includes(x.aplica)) return { erro: `Custo "${nome}": escolha onde se aplica.` };
    if (!(valor >= 0) || (x.tipo === 'pct' ? valor > 100 : valor > 10000000)) return { erro: `Custo "${nome}": valor inválido.` };
    out.outros.push({ nome, tipo: x.tipo, valor, aplica: x.aplica, cat: idsCat.has(x.cat) ? x.cat : 'outros' });
  }
  const pontuais = Array.isArray(b.pontuais) ? b.pontuais : [];
  if (pontuais.length > 60) return { erro: 'No máximo 60 despesas pontuais.' };
  out.pontuais = [];
  for (const x of pontuais) {
    const nome = String(x.nome || '').replace(/[\r\n]/g, ' ').trim().slice(0, 40);
    const valor = Math.round(Number(String(x.valor ?? '').replace(',', '.')) * 100) / 100;
    if (!nome && !(valor > 0)) continue;
    if (!nome) return { erro: 'Dê um nome a cada despesa pontual.' };
    if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(String(x.ym || ''))) return { erro: `Despesa "${nome}": escolha o mês.` };
    if (!(valor > 0 && valor <= 10000000)) return { erro: `Despesa "${nome}": valor inválido.` };
    out.pontuais.push({ nome, valor, ym: x.ym, anual: !!x.anual, cat: idsCat.has(x.cat) ? x.cat : 'outros' });
  }
  const emb = {};
  for (const [g, lista] of Object.entries(b.embalagens || {})) {
    if (!/^\d{1,4}$/.test(g) || !Array.isArray(lista) || lista.length > 6) return { erro: 'Embalagens inválidas.' };
    emb[g] = lista.map((x) => ({ cod: String(x.cod || '').trim().slice(0, 30), qtd: +x.qtd })).filter((x) => x.cod && x.qtd > 0 && x.qtd <= 20);
  }
  out.embalagens = Object.keys(emb).length ? emb : EMB_PADRAO;
  return { ok: out };
}

// classe oficial dos produtos (Estrela, Volume, Joia, Peso morto): janela de meses e classes travadas à mão
const CLASSES = ['estrela', 'volume', 'joia', 'peso'];
function classeCfg(loja) {
  const c = (loja && loja.classeCfg) || {};
  const fixas = {};
  for (const [cod, x] of Object.entries(c.fixas || {})) if (x && CLASSES.includes(x.classe)) fixas[cod] = { classe: x.classe, por: x.por || '', em: x.em || '' };
  return { meses: [3, 6, 12].includes(c.meses) ? c.meses : 6, fixas };
}
/** muda a janela ({meses}) ou trava/destrava um produto ({cod, classe|null}); devolve a config nova */
function alterarClasse(atual, b, quem) {
  const c = classeCfg({ classeCfg: atual });
  if (b.meses != null) {
    if (![3, 6, 12].includes(+b.meses)) return { erro: 'Escolha 3, 6 ou 12 meses.' };
    c.meses = +b.meses;
  }
  if (b.cod != null) {
    const cod = String(b.cod).trim().slice(0, 30);
    if (!cod) return { erro: 'Produto inválido.' };
    if (b.classe == null || b.classe === '') delete c.fixas[cod];
    else if (!CLASSES.includes(b.classe)) return { erro: 'Classe inválida.' };
    else {
      if (Object.keys(c.fixas).length >= 500 && !c.fixas[cod]) return { erro: 'No máximo 500 produtos travados.' };
      c.fixas[cod] = { classe: b.classe, por: String(quem || ''), em: new Date().toISOString() };
    }
  }
  return { ok: c };
}

module.exports = { ler, atual, historico, compras, notas, importar, pendentes, processar, cfg, validarCfg, quantidade, PADRAO, classeCfg, alterarClasse };
