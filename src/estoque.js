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
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v && 'result' in v) return dinheiro(v.result);
  const s = String(v).replace(/R\$\s*/i, '').trim();
  const n = /,\d{1,2}$/.test(s) ? +s.replace(/\./g, '').replace(',', '.') : +s;
  return Number.isFinite(n) ? n : null;
}
/** "NextSoft - Estoque Atual ( 12/11/2026, 19:01:05 )" → ISO */
function dataDoTitulo(t) {
  const m = /(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(t || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}-03:00` : null;
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

function atual(id) {
  try { return JSON.parse(fs.readFileSync(arqAtual(id), 'utf8')); } catch { return null; }
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
  return { itens: novo.itens.length, zerados: zerados.length, semCusto: novo.itens.filter((i) => !i.custo).length, em: dados.em };
}

function pendentes(id) {
  try { return fs.readdirSync(pastaEntrada(id)).filter((f) => /\.xlsx$/i.test(f) && !f.includes('.tmp')).sort(); } catch { return []; }
}
/** planilhas que o coletor deixou: importa a mais nova e descarta as outras */
async function processar(id) {
  const fs_ = pendentes(id);
  if (!fs_.length) return null;
  const ultimo = fs_[fs_.length - 1];
  let r = null;
  try { r = await importar(id, fs.readFileSync(path.join(pastaEntrada(id), ultimo)), 'coletor'); }
  catch (e) { console.error(`[estoque] ${id}: ${ultimo}: ${e.message}`); }
  for (const f of fs_) { try { fs.unlinkSync(path.join(pastaEntrada(id), f)); } catch { /* ok */ } }
  return r;
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
const PADRAO = { entregaDias: 10, coberturaDias: 30, paradoDias: 60, segurancaPct: 50, simplesPct: 0, cartaoPct: 0, outros: [], embalagens: EMB_PADRAO };
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
    outros: Array.isArray(c.outros) ? c.outros : [],
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
  const outros = Array.isArray(b.outros) ? b.outros : [];
  if (outros.length > 20) return { erro: 'No máximo 20 custos.' };
  out.outros = [];
  for (const x of outros) {
    const nome = String(x.nome || '').replace(/[\r\n]/g, ' ').trim().slice(0, 40);
    const valor = Math.round(Number(String(x.valor ?? '').replace(',', '.')) * 100) / 100;
    if (!nome && !(valor > 0)) continue; // linha vazia
    if (!nome) return { erro: 'Dê um nome a cada custo.' };
    if (!['pct', 'mes'].includes(x.tipo)) return { erro: `Custo "${nome}": escolha % das vendas ou R$ por mês.` };
    if (!['tudo', 'loja', 'eg'].includes(x.aplica)) return { erro: `Custo "${nome}": escolha onde se aplica.` };
    if (!(valor >= 0) || (x.tipo === 'pct' ? valor > 100 : valor > 10000000)) return { erro: `Custo "${nome}": valor inválido.` };
    out.outros.push({ nome, tipo: x.tipo, valor, aplica: x.aplica });
  }
  const emb = {};
  for (const [g, lista] of Object.entries(b.embalagens || {})) {
    if (!/^\d{1,4}$/.test(g) || !Array.isArray(lista) || lista.length > 6) return { erro: 'Embalagens inválidas.' };
    emb[g] = lista.map((x) => ({ cod: String(x.cod || '').trim().slice(0, 30), qtd: +x.qtd })).filter((x) => x.cod && x.qtd > 0 && x.qtd <= 20);
  }
  out.embalagens = Object.keys(emb).length ? emb : EMB_PADRAO;
  return { ok: out };
}

module.exports = { ler, atual, importar, pendentes, processar, cfg, validarCfg, quantidade, PADRAO };
