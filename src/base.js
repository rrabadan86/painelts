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
  return arquivosMes(id).map((f) => { try { return f + ':' + fs.statSync(path.join(pastaBase(id), f)).mtimeMs; } catch { return f; } }).join('|');
}

function lerMes(id, ym) {
  const f = path.join(pastaBase(id), `${ym}.json.gz`);
  if (!fs.existsSync(f)) return [];
  const linhas = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
  return linhas.map((a) => Object.fromEntries(CAMPOS.map((c, i) => [c, a[i]])));
}
function gravarMes(id, ym, vendas) {
  const f = path.join(pastaBase(id), `${ym}.json.gz`);
  if (!vendas.length) { try { fs.unlinkSync(f); } catch { /* ok */ } return; }
  vendas.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (a.cupom || 0) - (b.cupom || 0)));
  const json = JSON.stringify(vendas.map((v) => CAMPOS.map((c) => v[c] ?? null)));
  C.gravarAtomico(f, zlib.gzipSync(json, { level: 6 }), 0o640);
}

/** todas as vendas da loja (em ordem de data) */
function ler(id) {
  const out = [];
  for (const f of arquivosMes(id)) for (const v of lerMes(id, f.slice(0, 7))) out.push(v);
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
    const velhas = meses.flatMap((ym) => lerMes(id, ym));
    const naJanela = velhas.filter((v) => v.data >= de && v.data <= ate).length;
    const totalNovas = [...porMes.values()].reduce((s, a) => s + a.length, 0);
    if (!totalNovas && naJanela) throw new Error(`A planilha não trouxe vendas de ${de} a ${ate}, mas o painel já tem ${naJanela} linhas nesse período. Nada foi apagado (pode ter sido uma exportação incompleta).`);
    let nomesBase = new Set(velhas.map((v) => v.loja).filter(Boolean));
    if (!nomesBase.size) { const ult = arquivosMes(id).sort().pop(); if (ult) nomesBase = new Set(lerMes(id, ult.slice(0, 7)).map((v) => v.loja).filter(Boolean)); }
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

/** primeira carga: grava tudo de uma vez (planilhas antigas somadas) */
function substituirTudo(id, vendas, info = {}) {
  fs.mkdirSync(pastaBase(id), { recursive: true });
  for (const f of arquivosMes(id)) fs.unlinkSync(path.join(pastaBase(id), f));
  const porMes = new Map();
  for (const v of vendas) { if (!v.data) continue; const ym = v.data.slice(0, 7); if (!porMes.has(ym)) porMes.set(ym, []); porMes.get(ym).push(v); }
  for (const [ym, a] of porMes) gravarMes(id, ym, a);
  const datas = vendas.map((v) => v.data).filter(Boolean).sort();
  registrar(id, { em: new Date().toISOString(), origem: info.origem || 'migração das planilhas', por: info.por || 'sistema', de: datas[0] || null, ate: datas[datas.length - 1] || null, linhas: vendas.length });
}

function registrar(id, item) {
  const f = path.join(pastaBase(id), 'importacoes.json');
  let lista = [];
  try { lista = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* novo */ }
  lista.unshift(item);
  C.gravarAtomico(f, JSON.stringify(lista.slice(0, 60), null, 1), 0o640);
}
function importacoes(id) {
  try { return JSON.parse(fs.readFileSync(path.join(pastaBase(id), 'importacoes.json'), 'utf8')); } catch { return []; }
}

/** resumo para a tela de configurações */
function resumo(id) {
  const meses = arquivosMes(id).map((f) => f.slice(0, 7));
  let linhas = 0;
  const porMes = {};
  for (const ym of meses) {
    try {
      const n = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(pastaBase(id), `${ym}.json.gz`))).toString('utf8')).length;
      porMes[ym] = n; linhas += n;
    } catch { porMes[ym] = null; }
  }
  let ultimaVenda = null;
  if (meses.length) { const u = lerMes(id, meses[meses.length - 1]); ultimaVenda = u.reduce((m, v) => (v.data > m ? v.data : m), ''); }
  return { existe: existe(id), meses, porMes, linhas, ultimaVenda, de: meses[0] || null, ate: meses[meses.length - 1] || null, importacoes: importacoes(id).slice(0, 15), pendentes: pendentes(id).length };
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
const carimbo = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** grava um arquivo recebido na fila de entrada */
function receber(id, buf, { de, ate, origem } = {}) {
  const nome = `${carimbo()}${de && ate ? `_${de}_${ate}` : ''}_${(origem || 'upload').replace(/[^a-z0-9-]/gi, '')}.xlsx`;
  const f = path.join(pastaEntrada(id), nome);
  C.gravarAtomico(f, buf, 0o640);
  return nome;
}

module.exports = { ler, importar, substituirTudo, resumo, assinatura, existe, pendentes, periodoDoNome, arquivar, receber, pastaEntrada, importacoes, mesesEntre };
