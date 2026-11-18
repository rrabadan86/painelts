'use strict';
/**
 * Replica, em JavaScript, as etapas do Power Query do relatório "Tea Shop - Igor".
 * Cada função recebe as linhas brutas da planilha (array de arrays) e devolve objetos limpos.
 * Os comentários indicam a etapa correspondente no Power Query original.
 */

// ---------- utilidades ----------
const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

function toText(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v.richText) return v.richText.map((t) => t.text).join('');
  if (typeof v === 'object' && 'result' in v) return toText(v.result);
  if (typeof v === 'object' && v.text !== undefined) return String(v.text);
  return String(v);
}

/** número/valor da planilha (formatos brasileiros, "R$", espaço invisível, negativo entre parênteses): ver src/numero.js */
function toNumber(v) {
  return require('./numero').valorBR(v);
}

// Int64.Type do Power Query arredonda "para o par" (banker's rounding)
function toInt64(v) {
  const n = toNumber(v);
  if (n === null) return null;
  const f = Math.floor(n), diff = n - f;
  if (Math.abs(diff - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(n);
}

/** Converte data do Excel (Date, número serial ou texto dd/mm/aaaa) em "AAAA-MM-DD" */
function toISODate(v, { preferMDY = false } = {}) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v)) return null;
    // exceljs devolve datas em UTC
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number') {
    const ms = Math.round((v - 25569) * 86400000);
    return toISODate(new Date(ms));
  }
  if (typeof v === 'object' && 'result' in v) return toISODate(v.result, { preferMDY });
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    // padrão dd/mm/aaaa; texto em formato americano (m/d/aaaa) só quando preferMDY ou quando o dia > 12
    let d = a, mo = b;
    if ((preferMDY && a <= 12) || (!preferMDY && b > 12 && a <= 12)) { mo = a; d = b; }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

const replaceAll = (s, from, to) => (s == null ? s : String(s).split(from).join(to));

/** Promove a linha `headerIndex` a cabeçalho e devolve objetos */
function promote(rows, headerIndex = 0) {
  const header = (rows[headerIndex] || []).map((h) => (toText(h) || '').trim());
  const out = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const o = {};
    let any = false;
    header.forEach((h, j) => {
      if (!h) return;
      const v = r[j] === undefined ? null : r[j];
      if (!isBlank(v)) any = true;
      o[h] = v;
    });
    if (any) out.push(o);
  }
  return out;
}

// ---------- PowerBi Vendas ----------
const PRODUTO_REMOVER = ['250G', '100G', '50G', '50g', '500G', '1000G', '1kg', 'Tropical Chai 50g', '100g', '1Kg'];
const SO_NUMEROS = [[' 20G', 20], [' 50G', 50], ['100G', 100], ['250G', 250], ['500G', 500], ['1000G', 1000], ['1KG', 1000], ['1KG.', 1000], ['1 KG', 1000]];
const ALVOS_SEM_CHA = ['ACESSÓRIOS, Lata 100g, LOJA', 'ACESSÓRIOS, Latas 250g, LOJA', 'Chás Envasados Puros, Chás Puros, LOJA', 'ACESSÓRIOS, Consumíveis, LOJA'].map((s) => s.trim().toUpperCase());
const DESC_SEM_CHA = ['SACO KRAFT 50/100G', 'SACO 100G KRAFT'];
const GRUPO_COPIAR = [
  ['TEA MOMENTS', 'CHÁS ENVASADOS'],
  ['CHÁ PRETO AROMATIZADO', 'CHÁ AROMATIZADO'],
  ['CHÁ BRANCO AROMATIZADO', 'CHÁ AROMATIZADO'],
  ['CHÁ OOLONG AROMATIZADO', 'CHÁ AROMATIZADO'],
  ['CHÁ VERDE AROMATIZADO', 'CHÁ AROMATIZADO'],
  ['CHÁ PARA MINITINS', 'CHÁ AROMATIZADO'],
  ['CHÁS PARA ACESSÓRIOS', 'CHÁ AROMATIZADO'],
  ['CHÁ VERMELHO AROMATIZADO', 'CHÁ AROMATIZADO'],
  ['CHÁ PRETO PURO', 'CHÁ PURO'],
  ['CHÁ BRANCO PURO', 'CHÁ PURO'],
  ['CHÁ OOLONG PURO', 'CHÁ PURO'],
  ['CHÁ VERDE PURO', 'CHÁ PURO'],
  ['CHÁ VERMELHO PURO', 'CHÁ PURO'],
  ['ROOIBOS PURO', 'CHÁ PURO'],
  ['CHÁ AMARELO', 'CHÁ PURO'],
  ['ESPAÇO GOURMET (Take Aways)', 'ESPAÇO GOURMET'],
  ['ESPAÇO GOURMET (Xícara EG)', 'ESPAÇO GOURMET'],
  ['MINITINS', 'ACESSÓRIOS'],
  ['CONSUMÍVEIS - COM CONTROLE DE ESTOQUE', 'ACESSÓRIOS'],
  ['TEA ROOM', 'ESPAÇO GOURMET'],
  ['TEA ROOM (BULE PARA 2 PESSOAS)', 'ESPAÇO GOURMET'],
  ['TEA ROOM (Xícara EG)', 'ESPAÇO GOURMET'],
  // etapas seguintes do PQ (Valor Substituído1..4 / Personalizar1)
  ['CHÁS PARA ACESSÓRIOS', 'CHÁ AROMATIZADO'],
  ['ESPAÇO GOURMET (Xícara EG)', 'ESPAÇO GOURMET'],
  ['ESPAÇO GOURMET (BULE PARA 2 PESSOAS)', 'ESPAÇO GOURMET'],
  ['ESPAÇO GOURMET (Take Aways)', 'ESPAÇO GOURMET'],
];

/**
 * rows: linhas brutas da aba "Sheet1" (1ª linha = título do relatório, 2ª = cabeçalhos)
 * origem: rótulo só para diagnóstico
 */
// coluna com o código do produto (o nome varia: "Código", "Cód. Produto", "Código do Produto"...)
const RE_COD = /^c[oó]d(igo|\.)?\s*(do\s+)?(produto|item|prod\.?)?$/i;
function colunaCodigo(rows, headerIndex) {
  const header = (rows[headerIndex] || []).map((h) => (toText(h) || '').trim());
  return header.find((h) => RE_COD.test(h)) || null;
}

function transformVendas(rows, origem) {
  const base = promote(rows, 1); // Table.Skip(1) + PromoteHeaders
  const colCod = colunaCodigo(rows, 1);
  // O AppNext exporta a quantidade multiplicada por 1.000 (1 un = 1000; 0,5 kg = 500). Planilhas antigas vêm
  // com a quantidade normal. Decide pela planilha inteira: se quase todas as quantidades são múltiplos de 1.000,
  // divide TODAS por 1.000 (assim 500 vira 0,5 e não 500 unidades).
  // texto com vírgula ("9.152,000") já é a quantidade de verdade; a escala ×1000 vale para os números
  const ehTextoReal = (v) => typeof v === 'string' && /,\d+$/.test(v.trim());
  const brutas = base.filter((r) => !ehTextoReal(r['Quantidade'])).map((r) => toNumber(r['Quantidade'])).filter((n) => n != null && n !== 0);
  // (venda normal tem 1, 2, 3… unidades; na escala do AppNext, 1000, 2000… — de 100 para cima é a escala ×1000)
  const grandes = brutas.filter((n) => Math.abs(n) >= 100).length;
  const escalaMil = brutas.length > 0 && grandes / brutas.length >= 0.9;
  const qtdDe = (n) => (n == null ? null : escalaMil ? Math.round(n) / 1000 : toInt64(Math.abs(n) >= 1000 ? n / 1000 : n));
  const out = [];
  for (const r of base) {
    const data = toISODate(r['Data']);
    const cupom = toInt64(r['Número Cupom']);
    if (!data || cupom === null) continue; // Remover Linhas Nulas

    let loja = toText(r['Loja']) || '';
    loja = replaceAll(loja, 'GOIANIA - TEA SHOP FLAMBOYANT.', 'GOIANIA - TEA SHOP FLAMBOYANT');
    const descricao = toText(r['Descrição']) || '';
    const qtdNum = toNumber(r['Quantidade']);
    const qtdRaw = toInt64(qtdNum);
    const qtdTexto = ehTextoReal(r['Quantidade']);
    const vu = toNumber(r['Valor Unitário']);
    const du = toNumber(r['Desconto Unitário']);
    const vt = toNumber(r['Valor Total']);
    const vendedor = toText(r['Vendedor']);
    const qtdItensCupom = toInt64(r['Qtd. Itens no Cupom']);

    // Quantidade Personalizado
    const qtdP = qtdTexto ? qtdNum : qtdDe(qtdNum);
    const qtdItensP = qtdItensCupom === null ? null : escalaMil ? Math.round(qtdItensCupom / 1000) : toInt64(Math.abs(qtdItensCupom) >= 1000 ? qtdItensCupom / 1000 : qtdItensCupom);

    // Grupo: correções
    let grupo = toText(r['Grupo']) || '';
    grupo = replaceAll(grupo, '.ESPAÇO GOURMET', 'ESPAÇO GOURMET');
    grupo = replaceAll(grupo, 'FOREST FRIENDLY TEAS', 'CHÁS ENVASADOS');
    grupo = replaceAll(grupo, 'PROMO/AÇÕES', '');

    // Produto - Copiar (descrição sem a gramatura)
    let produto = descricao;
    for (const p of PRODUTO_REMOVER) produto = replaceAll(produto, p, '');
    produto = produto.trim(); // o Power BI ignora espaços no fim ao agrupar

    // SoNumeros / Qtd. Chá
    const up = descricao.toUpperCase();
    const achado = SO_NUMEROS.find(([k]) => up.includes(k));
    const soNumeros = achado ? achado[1] : null;
    let qtdCha = soNumeros !== null && qtdP !== null ? (qtdP * soNumeros) / 1000 : null;

    // Categorias corrigidas
    let cat = toText(r['Categorias']);
    if (grupo === 'CHÁ AMARELO') cat = 'Chás Puros, Chás, Rooibos e Infusões Puros, LOJA';
    else if (grupo === 'ACESSÓRIOS' && up.includes('MINITIN')) cat = 'ACESSÓRIOS, Lata 20g, LOJA';
    if (cat != null) cat = replaceAll(cat, 'TEA ROOM', 'ESPAÇO GOURMET');
    if (vu !== null && Math.abs(vu - 0.01) < 1e-7 && !descricao.includes('Caixa')) cat = 'FIDELIDADE';

    // Zera Qtd. Chá para latas, envasados, consumíveis e sacos kraft
    if (ALVOS_SEM_CHA.includes(String(cat ?? '').trim().toUpperCase()) || DESC_SEM_CHA.includes(descricao.trim().toUpperCase())) qtdCha = null;

    // Grupo - Copiar (agrupamento usado nos filtros e nas metas)
    let grupoC = grupo;
    for (const [a, b] of GRUPO_COPIAR) grupoC = replaceAll(grupoC, a, b);
    if (cat === 'Chás Envasados Puros, Chás Puros, Chás, Rooibos e Infusões Puros, LOJA') grupoC = 'CHÁS ENVASADOS PUROS';

    out.push({
      data, cupom, loja, vendedor: vendedor ?? '', descricao, produto, grupo, grupoC, cat: cat ?? '',
      subgrupo: toText(r['Sub-Grupo']) ?? '', qtdRaw, qtd: qtdP, qtdItensCupom: qtdItensP, soNumeros, qtdCha, vu, du, vt,
      min: minutosDe(r['Hora']),
      // código do produto no AppNext (casa com a planilha de estoque/custo)
      cod: colCod && !isBlank(r[colCod]) ? String(toText(r[colCod])).trim() : null,
      origem,
    });
  }
  return out;
}

/** "HH:MM" (ou Date do Excel) → minutos desde a meia-noite; null se não houver hora */
function minutosDe(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) { const m = v.getUTCHours() * 60 + v.getUTCMinutes(); return m || null; }
  if (typeof v === 'number' && v > 0 && v < 1) return Math.round(v * 1440);
  const m = String(v).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const x = +m[1] * 60 + +m[2];
  return x >= 0 && x < 1440 ? x : null;
}

// ---------- Xml (cupons com CPF) ----------
const CIDADE_LOJA = [
  ['Torres', 'TORRES - TEA SHOP TORRES'],
  ['Goiânia', 'GOIANIA - TEA SHOP FLAMBOYANT'],
  ['São Paulo', 'SÃO PAULO - TEA SHOP VILA MADALENA'],
  ['Goiania', 'GOIANIA - TEA SHOP FLAMBOYANT'],
  ['Palmas', 'PALMAS - TEA SHOP TOCANTINS'],
];

function normCPF(v) {
  if (v === null || v === undefined) return null;
  let s = typeof v === 'number' ? String(Math.round(v)) : String(toText(v)).trim();
  if (s === '') return null;
  if (/^\d+$/.test(s) && s.length < 11) s = s.padStart(11, '0');
  return s;
}

function transformXml(rows) {
  const base = promote(rows, 0);
  const vistos = new Set();
  const out = [];
  for (const r of base) {
    const arquivo = toText(r['Arquivo']);
    if (arquivo && arquivo.startsWith('Cancelado')) continue;
    const cupom = toInt64(r['NumeroCupom']);
    if (cupom === null) continue;
    if (vistos.has(cupom)) continue; // Table.Distinct por NumeroCupom
    vistos.add(cupom);
    let cidade = toText(r['Cidade']) || '';
    for (const [a, b] of CIDADE_LOJA) cidade = replaceAll(cidade, a, b);
    out.push({ cpf: normCPF(r['CPF']), cupom, loja: cidade });
  }
  return out;
}

// ---------- Dados Clientes ----------
function transformClientes(rows) {
  const base = promote(rows, 0);
  const porCPF = new Map(); // mantém o ÚLTIMO registro de cada CPF (como o PQ)
  for (const r of base) {
    const cpf = normCPF(r['CPF']);
    if (!cpf) continue;
    let cel = toText(r['CELULAR']);
    if (cel) cel = cel.replace(/[()\-]/g, '');
    const nome = (toText(r['NOME']) || '').trim();
    porCPF.set(cpf, {
      cpf,
      nome,
      celular: cel || '',
      nascimento: toISODate(r['DATA NASC.'], { preferMDY: true }),
      email: toText(r['EMAIL']) || '',
      cidade: (toText(r['CIDADE']) || '').trim(),
    });
  }
  return [...porCPF.values()];
}

// ---------- Meta ----------
function transformMeta(rows) {
  for (const r of rows) {
    for (let j = 0; j < (r || []).length; j++) {
      const n = toNumber(r[j]);
      if (n !== null && n > 0) return n;
    }
  }
  return null;
}

module.exports = { transformVendas, transformXml, transformClientes, transformMeta, toISODate, toNumber, toInt64 };
