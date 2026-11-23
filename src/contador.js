'use strict';
/**
 * Exportação do mês fechado para o contador (Resultado → "Exportar para o contador"): uma planilha .xlsx com
 *   Resumo do mês      as linhas do Resultado, como a tela mostra (vêm da tela: a conta do Resultado é uma só, lá)
 *   Vendas por dia     faturamento oficial (public/js/contas.js) e atendimentos; formas de pagamento se houver fechamento de caixa
 *   Notas de entrada   notas que deram entrada no mês (AppNext)
 *   Notas de saída     NF-e emitidas no mês (XML da loja)
 *   Despesas           custos fixos e despesas do mês
 * montar() devolve as abas em listas simples (testável); planilha() escreve o .xlsx.
 */
const CT = require('../public/js/contas');

const r2 = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : Math.round(+v * 100) / 100);
const txt = (v, n = 120) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
const dataBr = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesExtenso = (ym) => `${MESES[+ym.slice(5, 7) - 1]} de ${ym.slice(0, 4)}`;
const FORMAS = [['credito', 'Cartão de crédito'], ['debito', 'Cartão de débito'], ['dinheiro', 'Dinheiro'], ['pix', 'Pix'], ['ecommerce', 'Ecommerce'], ['troca', 'Troca']];

/** o mês já fechou? (só mês anterior ao de hoje) */
const mesFechado = (ym, hoje) => /^20\d\d-(0[1-9]|1[0-2])$/.test(String(ym || '')) && ym < String(hoje).slice(0, 7);

/** confere o que veio da tela (linhas do Resultado e despesas): só texto curto e número */
function limpar(b) {
  const resumo = (Array.isArray(b && b.resumo) ? b.resumo : []).slice(0, 80).map((x) => ({ rot: txt(x && x.rot, 80), valor: r2(x && x.valor), pct: x && x.pct != null && Number.isFinite(+x.pct) ? Math.round(+x.pct * 10000) / 10000 : null, tipo: txt(x && x.tipo, 10) })).filter((x) => x.rot);
  const despesas = (Array.isArray(b && b.despesas) ? b.despesas : []).slice(0, 120).map((x) => ({ nome: txt(x && x.nome, 60), cat: txt(x && x.cat, 40), tipo: x && x.tipo === 'pontual' ? 'pontual' : x && x.tipo === 'real' ? 'real' : 'fixa', valor: r2(x && x.valor) })).filter((x) => x.nome && x.valor != null);
  return { resumo, despesas };
}

/** vendas do mês por dia: faturamento oficial e atendimentos; caixa(dia) → resumo do fechamento (src/caixa.js doDia) ou null */
function vendasPorDia(vendas, ym, caixa) {
  const porDia = new Map();
  for (const v of vendas || []) {
    if (!v.data || v.data.slice(0, 7) !== ym) continue;
    (porDia.get(v.data) || porDia.set(v.data, []).get(v.data)).push(v);
  }
  const out = [];
  for (const dia of [...porDia.keys()].sort()) {
    const r = CT.resumo(porDia.get(dia));
    const c = caixa ? caixa(dia) : null;
    let formas = null;
    if (c && !c.vazio && Array.isArray(c.formas)) {
      formas = { outras: 0, total: c.totalVendas };
      for (const [k] of FORMAS) formas[k] = 0;
      for (const f of c.formas) { if (FORMAS.some(([k]) => k === f.k)) formas[f.k] += f.valor || 0; else formas.outras += f.valor || 0; }
      for (const k of Object.keys(formas)) formas[k] = r2(formas[k]);
    }
    if (!r.fat && !formas) continue;
    out.push({ dia, fat: r2(r.fat), cupons: r.cupons, formas });
  }
  return out;
}

/**
 * As abas da planilha. entrada: { loja: { nome }, ym, geradoEm, resumo, despesas, vendas, caixa, notasEntrada, notasSaida, comDestinatario }
 * → [{ nome, titulo, cab: [..], linhas: [[..]], dinheiro: [índices das colunas em R$], pct: [índices em %], total: [..] | null, obs }]
 */
function montar(e) {
  const ym = e.ym, { resumo, despesas } = limpar(e);
  const cabecalho = `${txt(e.loja && e.loja.nome, 80) || 'Loja'} · ${mesExtenso(ym)}`;
  const abas = [];
  abas.push({ nome: 'Resumo do mês', titulo: `Resultado do mês · ${cabecalho}`, cab: ['Linha', 'Valor (R$)', '% do faturamento'],
    linhas: resumo.map((x) => [x.rot, x.valor, x.pct]), dinheiro: [1], pct: [2], negrito: resumo.map((x) => ['base', 'sub', 'tot'].includes(x.tipo)), total: null,
    obs: 'Resultado gerencial do painel da loja (não é balancete nem apuração fiscal): faturamento pelas vendas do sistema; impostos, taxas e custos fixos pelos percentuais e valores cadastrados hoje; custo dos produtos pelo custo do estoque.' });

  const dias = vendasPorDia(e.vendas, ym, e.caixa);
  const temCaixa = dias.some((d) => d.formas);
  const somaCol = (linhas, k) => r2(linhas.reduce((a, l) => a + (Number(l[k]) || 0), 0));
  const lDias = dias.map((d) => [dataBr(d.dia), d.fat, d.cupons, ...(temCaixa ? [...FORMAS.map(([k]) => (d.formas ? d.formas[k] : null)), d.formas ? d.formas.outras : null, d.formas ? d.formas.total : null] : [])]);
  const nColsDia = 3 + (temCaixa ? FORMAS.length + 2 : 0);
  abas.push({ nome: 'Vendas por dia', titulo: `Vendas por dia · ${cabecalho}`, cab: ['Dia', 'Faturamento (R$)', 'Atendimentos', ...(temCaixa ? [...FORMAS.map(([, r]) => r), 'Outras formas', 'Total do caixa'] : [])],
    linhas: lDias, dinheiro: Array.from({ length: nColsDia }, (_, k) => k).filter((k) => k === 1 || k > 2),
    total: lDias.length ? ['Total', somaCol(lDias, 1), somaCol(lDias, 2), ...Array.from({ length: nColsDia - 3 }, (_, k) => somaCol(lDias, k + 3))] : null,
    obs: 'Faturamento = tudo o que foi vendido no dia, com os descontos, sem taxa de serviço e entrega e sem itens a R$ 0,01 (resgates e brindes).'
      + (temCaixa ? ' Formas de pagamento = fechamento de caixa do sistema; o total do caixa pode diferir do faturamento (taxas, trocas e vendas de outro dia).' : ' O painel não tem o fechamento de caixa deste mês: sem as formas de pagamento.') });

  const ent = (e.notasEntrada || []).filter((n) => String(n.entrada || n.emissao || '').slice(0, 7) === ym)
    .sort((a, b) => String(a.entrada || a.emissao).localeCompare(String(b.entrada || b.emissao)));
  const lEnt = ent.map((n) => [n.nf != null ? String(n.nf) : '', txt(n.serie, 6), txt(n.fornecedor, 80), txt(n.fornecedorDoc, 20), dataBr(n.emissao), dataBr(n.entrada), txt(n.motivo, 40), txt(n.status, 30), txt(n.cfop, 8), r2(n.desconto), r2(n.total), txt(n.chave, 44)]);
  abas.push({ nome: 'Notas de entrada', titulo: `Notas de entrada · ${cabecalho}`, cab: ['Número', 'Série', 'Fornecedor', 'CNPJ/CPF', 'Emissão', 'Entrada', 'Tipo', 'Situação', 'CFOP', 'Desconto (R$)', 'Valor (R$)', 'Chave'],
    linhas: lEnt, dinheiro: [9, 10], total: lEnt.length ? ['Total', '', '', '', '', '', '', '', '', somaCol(lEnt, 9), somaCol(lEnt, 10), ''] : null,
    obs: 'Notas que deram entrada no mês no sistema da loja (Entrada de Produtos), de todos os tipos: compra, devolução, troca, bonificação.' });

  const sai = (e.notasSaida || []).filter((n) => String(n.data || n.emissao || '').slice(0, 7) === ym)
    .sort((a, b) => String(a.emissao || a.data).localeCompare(String(b.emissao || b.data)) || (a.numero || 0) - (b.numero || 0));
  const comDest = e.comDestinatario !== false;
  const lSai = sai.map((n) => [n.numero != null ? String(n.numero) : '', txt(n.serie, 6), dataBr(n.data || n.emissao), txt(n.natOp, 60), txt(n.finalidade, 30),
    comDest && n.dest ? txt(n.dest.nome, 80) : '', comDest && n.dest ? txt(n.dest.doc, 20) : '', n.situacao === 'cancelada' ? 'Cancelada' : 'Autorizada', r2(n.valor), txt(n.chave, 44)]);
  const validas = lSai.filter((l) => l[7] !== 'Cancelada');
  abas.push({ nome: 'Notas de saída (NF-e)', titulo: `Notas de saída (NF-e) · ${cabecalho}`, cab: ['Número', 'Série', 'Emissão', 'Natureza', 'Finalidade', 'Destinatário', 'CNPJ/CPF', 'Situação', 'Valor (R$)', 'Chave'],
    linhas: lSai, dinheiro: [8], total: lSai.length ? ['Total (sem as canceladas)', '', '', '', '', '', '', '', somaCol(validas, 8), ''] : null,
    obs: 'NF-e (modelo 55) emitidas pela loja no mês, pelos XML guardados no painel. Os cupons do caixa (NFC-e) não estão aqui: vão no arquivo de XML do faturamento.' });

  const lDesp = despesas.map((x) => [x.nome, x.cat, x.tipo === 'pontual' ? 'Só deste mês' : x.tipo === 'real' ? 'Todo mês · valor real do mês' : 'Todo mês', x.valor]);
  abas.push({ nome: 'Despesas', titulo: `Despesas · ${cabecalho}`, cab: ['Despesa', 'Categoria', 'Tipo', 'Valor (R$)'], linhas: lDesp, dinheiro: [3],
    total: lDesp.length ? ['Total', '', '', somaCol(lDesp, 3)] : null,
    obs: 'Custos fixos (valor cheio do mês: o valor real lançado no Resultado ou, sem lançamento, o padrão de Configurações) e despesas só deste mês cadastrados no painel pela loja. Não são lançamentos conferidos com boleto ou extrato.' });
  return abas;
}

async function planilha(e) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Painel da loja'; wb.created = new Date();
  for (const a of montar(e)) {
    const ws = wb.addWorksheet(a.nome.replace(/[\\/?*[\]:]/g, ' '));
    ws.addRow([a.titulo]).font = { bold: true, size: 13 };
    ws.addRow([`Gerado em ${dataBr(e.geradoEm || new Date().toISOString().slice(0, 10))}. ${a.obs}`]);
    ws.addRow([]);
    ws.addRow(a.cab).font = { bold: true };
    a.linhas.forEach((l, k) => { const row = ws.addRow(l); if (a.negrito && a.negrito[k]) row.font = { bold: true }; });
    if (a.total) ws.addRow(a.total).font = { bold: true };
    if (!a.linhas.length) ws.addRow(['Nada neste mês.']);
    a.cab.forEach((c, k) => {
      const col = ws.getColumn(k + 1);
      col.width = Math.min(60, Math.max(12, String(c).length + 2, ...a.linhas.slice(0, 400).map((l) => String(l[k] == null ? '' : l[k]).length + 2)));
      if ((a.dinheiro || []).includes(k)) col.numFmt = '#,##0.00';
      if ((a.pct || []).includes(k)) col.numFmt = '0.0%';
    });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { montar, planilha, vendasPorDia, limpar, mesFechado };
