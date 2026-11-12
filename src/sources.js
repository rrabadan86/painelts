'use strict';
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const T = require('./transform');
const C = require('./config');

/**
 * Para cada arquivo de uma loja:
 *   1º) dados/<loja>/<arquivo>.xlsx na VPS (enviado pelo script diário), se existir;
 *   2º) senão, o ID do Google Drive configurado em lojas.json;
 *   3º) senão, a fonte é ignorada.
 */
function resolverFontes(loja) {
  const pasta = C.pastaLoja(loja.id);
  return Object.entries(C.ARQUIVOS).map(([nome, def]) => {
    const local = path.join(pasta, `${nome}.xlsx`);
    let st = null;
    try { st = fs.statSync(local); } catch { /* não existe */ }
    if (st && st.isFile()) return { nome, ...def, origem: 'vps', caminho: local, modificado: st.mtime.toISOString(), mtime: st.mtimeMs };
    const id = loja.drive[nome];
    if (id) return { nome, ...def, origem: 'drive', id };
    return { nome, ...def, origem: null };
  });
}

/** Assinatura dos arquivos locais: muda quando o script grava um arquivo novo */
function assinatura(loja) {
  const B = require('./base');
  return resolverFontes(loja).map((f) => `${f.nome}:${f.origem}:${f.mtime || f.id || ''}`).join('|') + '#' + B.assinatura(loja.id) + '#' + B.pendentes(loja.id).join(',');
}

async function fetchWithTimeout(url, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'teashop-painel/1.1' } });
  } finally { clearTimeout(t); }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const motivo = (e) => (e.name === 'AbortError' ? 'tempo esgotado' : (e.cause && (e.cause.code || e.cause.message)) || e.message);

/** Baixa um arquivo do Drive como .xlsx, com novas tentativas em falhas de rede */
async function baixarDriveId(id, tentativas = 3) {
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
  let ultimo = '';
  for (let i = 1; i <= tentativas; i++) {
    try {
      const res = await fetchWithTimeout(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf[0] === 0x50 && buf[1] === 0x4b) return buf;
        ultimo = 'a resposta não é uma planilha (o arquivo está compartilhado como "qualquer pessoa com o link"?)';
        break; // não adianta repetir
      }
      ultimo = `HTTP ${res.status}`;
      if (res.status === 404 || res.status === 403 || res.status === 401) {
        // arquivo .xlsx enviado ao Drive (não Planilha Google): tenta o download direto
        const r2 = await fetchWithTimeout(`https://drive.google.com/uc?export=download&id=${id}`);
        const b2 = Buffer.from(await r2.arrayBuffer());
        if (r2.ok && b2[0] === 0x50 && b2[1] === 0x4b) return b2;
        ultimo += r2.ok ? '' : ` / download direto HTTP ${r2.status}`;
        break;
      }
    } catch (e) {
      ultimo = `falha de conexão com o Google (${motivo(e)})`;
    }
    if (i < tentativas) await espera(1500 * i);
  }
  throw new Error(ultimo);
}
const baixarDrive = (f) => baixarDriveId(f.id);

async function lerFonte(f) {
  const buf = f.origem === 'vps' ? await fs.promises.readFile(f.caminho) : await baixarDrive(f);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = (f.aba && wb.getWorksheet(f.aba)) || wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => { const v = row.values; rows[n - 1] = Array.isArray(v) ? v.slice(1) : []; });
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

const crypto = require('crypto');
const B = require('./base');

/** lê um .xlsx do disco como linhas (mesmo formato de lerFonte) */
const lerXlsx = (caminho, aba = 'Sheet1') => lerFonte({ origem: 'vps', caminho, aba });

const VENDAS = Object.entries(C.ARQUIVOS).filter(([, d]) => d.tipo === 'vendas').map(([n]) => n);

/**
 * Mantém a base mês a mês em dia:
 *  1) primeira vez: soma as planilhas de vendas antigas (VPS ou Drive) e grava a base;
 *  2) planilhas de vendas deixadas na pasta da loja (script antigo / API) entram como novas;
 *  3) processa dados/<loja>/entrada/*.xlsx (coletor e envio pelo painel);
 *  4) planilhas de vendas que ainda vêm do Drive são reimportadas quando mudam.
 */
async function atualizarBase(loja, fontes, avisos) {
  const id = loja.id;
  const vendasFontes = fontes.filter((f) => f.tipo === 'vendas' && f.origem);
  if (!B.existe(id)) {
    if (!vendasFontes.length && !B.pendentes(id).length) return; // loja nova, aguardando a 1ª coleta
    const todas = [];
    const shas = {};
    for (const f of vendasFontes) {
      try {
        const buf = f.origem === 'vps' ? await fs.promises.readFile(f.caminho) : await baixarDrive(f);
        if (f.origem === 'drive') shas[f.nome] = crypto.createHash('sha1').update(buf).digest('hex');
        for (const v of T.transformVendas(await linhasDeBuffer(buf, f.aba), f.nome)) todas.push(v);
        f.ok = true;
      } catch (e) { f.ok = false; f.erro = e.message; avisos.push(`${loja.nome} · ${f.nome}: ${e.message}`); }
    }
    if (vendasFontes.length && vendasFontes.every((f) => f.ok === false)) throw new Error(avisos.join(' | '));
    B.substituirTudo(id, todas, { origem: 'planilhas existentes (' + vendasFontes.map((f) => f.nome).join(', ') + ')' });
    gravarShas(id, shas);
    for (const f of vendasFontes) if (f.origem === 'vps') B.arquivar(id, f.caminho);
    console.log(`[base] ${id}: criada com ${todas.length} vendas das planilhas existentes`);
  }
  // planilhas de vendas soltas na pasta (script antigo, API de upload) → entrada
  for (const f of vendasFontes) {
    if (f.origem !== 'vps' || !fs.existsSync(f.caminho)) continue;
    fs.mkdirSync(B.pastaEntrada(id), { recursive: true });
    fs.renameSync(f.caminho, path.join(B.pastaEntrada(id), `${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}_${f.nome}.xlsx`));
  }
  // entrada
  for (const nome of B.pendentes(id)) {
    const arq = path.join(B.pastaEntrada(id), nome);
    try {
      const vendas = T.transformVendas(await lerXlsx(arq), 'importacaoA');
      const r = B.importar(id, vendas, { ...B.periodoDoNome(nome), origem: nome.replace(/^[\d-]+_/, '').replace(/\.xlsx$/i, '') });
      B.arquivar(id, arq);
      console.log(`[base] ${id}: ${nome} → ${r.linhas} linhas (${r.de} a ${r.ate})`);
    } catch (e) {
      avisos.push(`${loja.nome} · ${nome}: ${e.message}`);
      console.error(`[base] ${id}: ${nome} falhou:`, e.message);
      try { fs.renameSync(arq, arq + '.erro'); } catch { /* ok */ }
    }
  }
  // Drive (lojas que ainda recebem vendas pelo Drive)
  const shas = lerShas(id);
  for (const f of vendasFontes.filter((x) => x.origem === 'drive')) {
    try {
      const buf = await baixarDrive(f);
      const sha = crypto.createHash('sha1').update(buf).digest('hex');
      f.ok = true;
      if (shas[f.nome] === sha) continue;
      const r = B.importar(id, T.transformVendas(await linhasDeBuffer(buf, f.aba), f.nome), { origem: `Drive · ${f.nome}` });
      shas[f.nome] = sha;
      console.log(`[base] ${id}: Drive ${f.nome} → ${r.linhas} linhas (${r.de} a ${r.ate})`);
    } catch (e) { f.ok = false; f.erro = e.message; avisos.push(`${loja.nome} · ${f.nome}: ${e.message}`); }
  }
  gravarShas(id, shas);
}
const shaFile = (id) => path.join(C.pastaLoja(id), 'base', 'drive.json');
function lerShas(id) { try { return JSON.parse(fs.readFileSync(shaFile(id), 'utf8')); } catch { return {}; } }
function gravarShas(id, shas) { if (fs.existsSync(path.dirname(shaFile(id)))) C.gravarAtomico(shaFile(id), JSON.stringify(shas), 0o644); }

async function linhasDeBuffer(buf, aba) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = (aba && wb.getWorksheet(aba)) || wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => { const v = row.values; rows[n - 1] = Array.isArray(v) ? v.slice(1) : []; });
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

async function loadLoja(loja) {
  const t0 = Date.now();
  const fontes = resolverFontes(loja);
  const avisos = [];
  const out = { vendas: [], xml: [], clientes: [], meta: loja.meta ?? null };
  await atualizarBase(loja, fontes, avisos);
  out.vendas = B.ler(loja.id);
  out.semVendas = !out.vendas.length;
  await Promise.all(fontes.filter((f) => f.origem && f.tipo !== 'vendas').map(async (f) => {
    try {
      const rows = await lerFonte(f);
      if (f.tipo === 'xml') out.xml = T.transformXml(rows);
      else if (f.tipo === 'clientes') out.clientes = T.transformClientes(rows);
      else if (f.tipo === 'meta') out.metaPlanilha = T.transformMeta(rows);
      f.ok = true;
    } catch (e) {
      f.ok = false; f.erro = e.message;
      avisos.push(`${loja.nome} · ${f.nome}: ${e.message}`);
    }
  }));
  // Cada loja tem a própria planilha Xml: se as vendas são de uma loja só, os cupons com CPF
  // são dessa loja, qualquer que seja a cidade escrita no Xml.
  const nomesLoja = [...new Set(out.vendas.map((v) => v.loja).filter(Boolean))];
  if (nomesLoja.length === 1) out.xml.forEach((x) => { x.loja = nomesLoja[0]; });
  // metas: padrão (lojas.json ou planilha Meta) + metas por mês
  if (out.meta == null) out.meta = out.metaPlanilha ?? null;
  out.metaCfg = { id: loja.id, nome: loja.nome, nomesVenda: nomesLoja, padrao: out.meta, meses: loja.metas || {} };
  const ultimaVenda = out.vendas.length ? out.vendas[out.vendas.length - 1].data : null;
  const fontesInfo = fontes.filter((f) => f.tipo !== 'vendas').map(({ nome, desc, origem, modificado, ok, erro }) => ({ nome, desc, origem, modificado, ok, erro }));
  fontesInfo.unshift({ nome: 'Vendas', desc: 'histórico mês a mês', origem: 'vps', modificado: B.importacoes(loja.id)[0]?.em || null, ok: true, ultimaVenda });
  return { ...out, avisos, fontes: fontesInfo, ms: Date.now() - t0 };
}

/** Junta várias lojas (visão "Todas as lojas") */
function juntar(partes) {
  const metas = partes.map((p) => p.meta).filter((m) => m != null);
  return {
    vendas: partes.flatMap((p) => p.vendas),
    xml: partes.flatMap((p) => p.xml),
    clientes: (() => { const m = new Map(); partes.forEach((p) => p.clientes.forEach((c) => m.set(c.cpf, c))); return [...m.values()]; })(),
    meta: metas.length ? metas.reduce((s, m) => s + m, 0) : null,
    metaCfgs: partes.map((p) => p.metaCfg).filter(Boolean),
    avisos: partes.flatMap((p) => p.avisos),
    fontes: partes.flatMap((p) => p.fontes.map((f) => ({ ...f, loja: p.lojaNome }))),
  };
}

/** Compacta para o navegador: colunas + dicionário de textos repetidos */
function pack(data, info = {}) {
  const dicts = {};
  const enc = (campo) => {
    const d = (dicts[campo] = dicts[campo] || { list: [], idx: new Map() });
    return (v) => {
      v = v ?? '';
      let i = d.idx.get(v);
      if (i === undefined) { i = d.list.length; d.list.push(v); d.idx.set(v, i); }
      return i;
    };
  };
  const textCols = ['loja', 'vendedor', 'descricao', 'produto', 'grupo', 'grupoC', 'cat', 'subgrupo'];
  const numCols = ['cupom', 'qtd', 'soNumeros', 'qtdCha', 'vu', 'du', 'vt', 'min'];
  const encs = Object.fromEntries(textCols.map((c) => [c, enc(c)]));
  const v = { data: [] };
  textCols.forEach((c) => (v[c] = []));
  numCols.forEach((c) => (v[c] = []));
  for (const r of data.vendas) {
    v.data.push(r.data);
    textCols.forEach((c) => v[c].push(encs[c](r[c])));
    numCols.forEach((c) => v[c].push(r[c] === null || r[c] === undefined ? null : Math.round(r[c] * 10000) / 10000));
  }
  return {
    geradoEm: new Date().toISOString(),
    ...info,
    meta: data.meta,
    metas: data.metaCfgs || (data.metaCfg ? [data.metaCfg] : []),
    avisos: data.avisos,
    fontes: data.fontes,
    dict: Object.fromEntries(Object.entries(dicts).map(([k, d]) => [k, d.list])),
    vendas: v,
    xml: data.xml,
    clientes: data.clientes,
  };
}

module.exports = { loadLoja, juntar, pack, assinatura, resolverFontes, baixarDriveId, lerXlsx, linhasDeBuffer };
