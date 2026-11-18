'use strict';
/**
 * Histórico de vendas guardado mês a mês na VPS:
 *   dados/<loja>/base/AAAA-MM.json.gz   (vendas já tratadas daquele mês)
 *   dados/<loja>/base/importacoes.json  (últimas importações: quando, de onde, período)
 *
 * Cada planilha que chega cobre um período (de → até). Ao importar, as vendas desse período
 * são SUBSTITUÍDAS pelas da planilha nova; o resto do histórico fica intacto.
 * Assim o coletor diário pode baixar só os últimos dias e o histórico nunca se perde.
 *
 * Planilhas novas entram por dados/<loja>/entrada/*.xlsx (coletor, upload pelo painel ou API).
 * O nome pode trazer o período: 20261111-230000_2026-09-27_2026-11-11.xlsx
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const C = require('./config');

const CAMPOS = ['data', 'cupom', 'loja', 'vendedor', 'descricao', 'produto', 'grupo', 'grupoC', 'cat', 'subgrupo', 'qtd', 'soNumeros', 'qtdCha', 'vu', 'du', 'vt', 'min', 'cod'];

const pastaBase = (id) => path.join(C.pastaLoja(id), 'base');
const pastaEntrada = (id) => path.join(C.pastaLoja(id), 'entrada');
const pastaProcessados = (id) => path.join(C.pastaLoja(id), 'processados');

const existe = (id) => fs.existsSync(pastaBase(id));

function arquivosMes(id) {
  try { return fs.readdirSync(pastaBase(id)).filter((f) => /^\d{4}-\d{2}\.json\.gz$/.test(f)).sort(); } catch { return []; }
}

/** assinatura: muda quando algum mês é regravado */
function assinatura(id) {
  return arquivosMes(id).map((f) => { try { const st = fs.statSync(path.join(pastaBase(id), f)); return `${f}:${st.mtimeMs}:${st.size}`; } catch { return f; } }).join('|');
}

// cache em memória por (loja, AAAA-MM): meses fechados nunca mais precisam de gunzip + JSON.parse
const mesCache = new Map(); // "id|ym" -> { mtimeMs, size, rows }
const resumoCache = new Map(); // id -> { sig, impMtime, pendCount, val }

function linhaDeArray(a) {
  return {
    data: a[0], cupom: a[1], loja: a[2], vendedor: a[3], descricao: a[4], produto: a[5],
    grupo: a[6], grupoC: a[7], cat: a[8], subgrupo: a[9], qtd: a[10], soNumeros: a[11],
    qtdCha: a[12], vu: a[13], du: a[14], vt: a[15], min: a[16], cod: a[17],
  };
}

function lerMesInterno(id, ym) {
  const f = path.join(pastaBase(id), `${ym}.json.gz`);
  let st;
  try { st = fs.statSync(f); } catch { mesCache.delete(`${id}|${ym}`); return []; }
  const k = `${id}|${ym}`;
  const hit = mesCache.get(k);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.rows;
  const linhas = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
  const rows = linhas.map(linhaDeArray);
  if (mesCache.size > 600 && !mesCache.has(k)) mesCache.delete(mesCache.keys().next().value);
  mesCache.set(k, { mtimeMs: st.mtimeMs, size: st.size, rows });
  return rows;
}

function lerMes(id, ym) {
  // devolve cópia rasa por linha para que reclassificações em memória (grupoC/grupoOrig) não sujem o cache
  return lerMesInterno(id, ym).map((r) => ({ ...r }));
}

function gravarMes(id, ym, vendas) {
  const f = path.join(pastaBase(id), `${ym}.json.gz`);
  const k = `${id}|${ym}`;
  resumoCache.delete(id);
  if (!vendas.length) { mesCache.delete(k); try { fs.unlinkSync(f); } catch { /* ok */ } return; }
  vendas.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (a.cupom || 0) - (b.cupom || 0)));
  const arrs = vendas.map((v) => CAMPOS.map((c) => v[c] ?? null));
  C.gravarAtomico(f, zlib.gzipSync(JSON.stringify(arrs), { level: 6 }), 0o640);
  try {
    const st = fs.statSync(f);
    mesCache.set(k, { mtimeMs: st.mtimeMs, size: st.size, rows: arrs.map(linhaDeArray) });
  } catch { mesCache.delete(k); }
}

/** todas as vendas da loja (em ordem de data) */
function ler(id) {
  const out = [];
  for (const f of arquivosMes(id)) {
    const rows = lerMesInterno(id, f.slice(0, 7));
    for (let i = 0; i < rows.length; i++) out.push({ ...rows[i] });
  }
  return out;
}

/** lê apenas vendas a partir de desdeIso (AAAA-MM-DD), sem abrir meses anteriores */
function lerDesde(id, desdeIso) {
  const corte = String(desdeIso || '');
  if (!/^\d{4}-\d{2}/.test(corte)) return ler(id);
  const ymMin = corte.slice(0, 7);
  const out = [];
  for (const f of arquivosMes(id)) {
    const ym = f.slice(0, 7);
    if (ym < ymMin) continue;
    const rows = lerMesInterno(id, ym);
    for (let i = 0; i < rows.length; i++) {
      if (!corte || rows[i].data >= corte) out.push({ ...rows[i] });
    }
  }
  return out;
}

function mesesEntre(de, ate) {
  const out = [];
  let y = +de.slice(0, 4), m = +de.slice(5, 7);
  const yf = +ate.slice(0, 4), mf = +ate.slice(5, 7);
  while (y < yf || (y === yf && m <= mf)) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  return out;
}

/**
 * Substitui as vendas de [de, ate] (AAAA-MM-DD) pelas recebidas.
 * Sem de/ate: usa o primeiro e o último dia que aparecem nas vendas.
 */
function importar(id, vendas, { de, ate, origem, por } = {}) {
  const datas = vendas.map((v) => v.data).filter(Boolean).sort();
  de = de || datas[0]; ate = ate || datas[datas.length - 1];
  if (!de || !ate) return { linhas: 0, de: null, ate: null, meses: 0 };
  fs.mkdirSync(pastaBase(id), { recursive: true });
  const porMes = new Map();
  for (const v of vendas) {
    if (!v.data || v.data < de || v.data > ate) continue;
    const ym = v.data.slice(0, 7);
    if (!porMes.has(ym)) porMes.set(ym, []);
    porMes.get(ym).push(v);
  }
  const meses = mesesEntre(de, ate);
  // travas: não apaga um período inteiro com uma planilha vazia, nem mistura vendas de outra loja
  {
    const velhas = meses.flatMap((ym) => lerMesInterno(id, ym));
    const naJanela = velhas.filter((v) => v.data >= de && v.data <= ate).length;
    const totalNovas = [...porMes.values()].reduce((s, a) => s + a.length, 0);
    if (!totalNovas && naJanela) throw new Error(`A planilha não trouxe vendas de ${de} a ${ate}, mas o painel já tem ${naJanela} linhas nesse período. Nada foi apagado (pode ter sido uma exportação incompleta).`);
    let nomesBase = new Set(velhas.map((v) => v.loja).filter(Boolean));
    if (!nomesBase.size) { const ult = arquivosMes(id).sort().pop(); if (ult) nomesBase = new Set(lerMesInterno(id, ult.slice(0, 7)).map((v) => v.loja).filter(Boolean)); }
    const nomesNovos = new Set([...porMes.values()].flat().map((v) => v.loja).filter(Boolean));
    if (nomesBase.size && nomesNovos.size && ![...nomesNovos].some((n) => nomesBase.has(n))) {
      throw new Error(`A planilha é de outra loja (${[...nomesNovos].join(', ')}); esta loja vende como ${[...nomesBase].join(', ')}. Nada foi gravado.`);
    }
  }
  let horasMantidas = 0;
  for (const ym of meses) {
    const antigas = lerMes(id, ym);
    const fica = antigas.filter((v) => v.data < de || v.data > ate);
    const novas = porMes.get(ym) || [];
    // planilha sem a hora (script antigo, Drive, envio manual): mantém a hora que o cupom já tinha
    if (novas.some((v) => v.min == null)) {
      const horaDe = new Map();
      for (const v of antigas) if (v.min != null && v.data >= de && v.data <= ate) horaDe.set(`${v.data}|${v.cupom}|${v.loja}`, v.min);
      if (horaDe.size) for (const v of novas) {
        if (v.min != null) continue;
        const m = horaDe.get(`${v.data}|${v.cupom}|${v.loja}`);
        if (m != null) { v.min = m; horasMantidas++; }
      }
    }
    gravarMes(id, ym, fica.concat(novas));
  }
  const linhas = [...porMes.values()].reduce((s, a) => s + a.length, 0);
  const comHora = [...porMes.values()].reduce((s, a) => s + a.filter((v) => v.min != null).length, 0);
  registrar(id, { em: new Date().toISOString(), origem: origem || '', por: por || '', de, ate, linhas, comHora, horasMantidas });
  if (horasMantidas) console.log(`[base] ${id}: planilha sem hora (${origem}) — mantidas as horas de ${horasMantidas} linhas`);
  return { linhas, de, ate, meses: meses.length };
}

/** primeiro dia com venda na base (ou null) */
function primeiroDia(id) {
  const meses = arquivosMes(id).map((f) => f.slice(0, 7)).sort();
  for (const ym of meses) { const d = lerMesInterno(id, ym).map((v) => v.data).filter(Boolean).sort()[0]; if (d) return d; }
  return null;
}
/**
 * Histórico do sistema antigo: entra só o que é ANTERIOR à primeira venda que o painel já tem
 * (nenhum dia existente é tocado; o período em que o sistema novo começou fica com o sistema novo).
 */
function completarAntes(id, vendas, { origem, por } = {}) {
  const corte = primeiroDia(id);
  const antes = corte ? vendas.filter((v) => v.data && v.data < corte) : vendas.filter((v) => v.data);
  const datas = vendas.map((v) => v.data).filter(Boolean).sort();
  const descartadas = vendas.length - antes.length;
  if (!antes.length) return { linhas: 0, de: null, ate: null, corte, descartadas, arquivoDe: datas[0] || null, arquivoAte: datas[datas.length - 1] || null };
  const d = antes.map((v) => v.data).sort();
  const r = importar(id, antes, { de: d[0], ate: d[d.length - 1], origem: origem || 'histórico do sistema antigo', por });
  return { ...r, corte, descartadas, arquivoDe: datas[0], arquivoAte: datas[datas.length - 1] };
}

/** primeira carga: grava tudo de uma vez (planilhas antigas somadas) */
function substituirTudo(id, vendas, info = {}) {
  fs.mkdirSync(pastaBase(id), { recursive: true });
  resumoCache.delete(id);
  for (const f of arquivosMes(id)) {
    mesCache.delete(`${id}|${f.slice(0, 7)}`);
    fs.unlinkSync(path.join(pastaBase(id), f));
  }
  const porMes = new Map();
  for (const v of vendas) { if (!v.data) continue; const ym = v.data.slice(0, 7); if (!porMes.has(ym)) porMes.set(ym, []); porMes.get(ym).push(v); }
  for (const [ym, a] of porMes) gravarMes(id, ym, a);
  const datas = vendas.map((v) => v.data).filter(Boolean).sort();
  registrar(id, { em: new Date().toISOString(), origem: info.origem || 'migração das planilhas', por: info.por || 'sistema', de: datas[0] || null, ate: datas[datas.length - 1] || null, linhas: vendas.length });
}

function registrar(id, item) {
  resumoCache.delete(id);
  const f = path.join(pastaBase(id), 'importacoes.json');
  let lista = [];
  try { lista = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* novo */ }
  lista.unshift(item);
  C.gravarAtomico(f, JSON.stringify(lista.slice(0, 60), null, 1), 0o640);
}
function importacoes(id) {
  try { return JSON.parse(fs.readFileSync(path.join(pastaBase(id), 'importacoes.json'), 'utf8')); } catch { return []; }
}

/** resumo para a tela de configurações (em cache pela assinatura dos meses) */
function resumo(id) {
  const sig = assinatura(id);
  let impMtime = 0;
  try { impMtime = fs.statSync(path.join(pastaBase(id), 'importacoes.json')).mtimeMs; } catch { /* sem arq */ }
  const pendCount = pendentes(id).length;
  const hit = resumoCache.get(id);
  if (hit && hit.sig === sig && hit.impMtime === impMtime) return { ...hit.val, pendentes: pendCount };
  const meses = arquivosMes(id).map((f) => f.slice(0, 7));
  let linhas = 0;
  const porMes = {};
  for (const ym of meses) {
    try {
      const n = lerMesInterno(id, ym).length;
      porMes[ym] = n; linhas += n;
    } catch { porMes[ym] = null; }
  }
  let ultimaVenda = null;
  if (meses.length) { const u = lerMesInterno(id, meses[meses.length - 1]); ultimaVenda = u.reduce((m, v) => (v.data > m ? v.data : m), ''); }
  const val = { existe: existe(id), meses, porMes, linhas, ultimaVenda, de: meses[0] || null, ate: meses[meses.length - 1] || null, importacoes: importacoes(id).slice(0, 15), pendentes: pendCount };
  resumoCache.set(id, { sig, impMtime, val });
  return val;
}

// ---------- entrada ----------
function pendentes(id) {
  try { return fs.readdirSync(pastaEntrada(id)).filter((f) => /\.xlsx$/i.test(f) && !f.includes('.tmp')).sort(); } catch { return []; }
}
/** período codificado no nome do arquivo */
function periodoDoNome(nome) {
  const m = nome.match(/(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/);
  return m ? { de: m[1], ate: m[2] } : {};
}
/** guarda o arquivo já importado (últimos 15) */
function arquivar(id, arquivo) {
  const dest = pastaProcessados(id);
  fs.mkdirSync(dest, { recursive: true });
  fs.renameSync(arquivo, path.join(dest, path.basename(arquivo)));
  const velhos = fs.readdirSync(dest).sort();
  velhos.slice(0, Math.max(0, velhos.length - 15)).forEach((f) => { try { fs.unlinkSync(path.join(dest, f)); } catch { /* ok */ } });
}
const carimbo = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) + '-' + crypto.randomBytes(2).toString('hex');

/** grava um arquivo recebido na fila de entrada */
function receber(id, buf, { de, ate, origem } = {}) {
  const nome = `${carimbo()}${de && ate ? `_${de}_${ate}` : ''}_${(origem || 'upload').replace(/[^a-z0-9-]/gi, '')}.xlsx`;
  const f = path.join(pastaEntrada(id), nome);
  C.gravarAtomico(f, buf, 0o640);
  return nome;
}

module.exports = { ler, lerDesde, importar, completarAntes, primeiroDia, substituirTudo, resumo, assinatura, existe, pendentes, periodoDoNome, arquivar, receber, pastaEntrada, importacoes, mesesEntre };
