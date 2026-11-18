'use strict';
/**
 * Notas fiscais eletrônicas (NF-e, modelo 55) emitidas pela loja: vendas com nota "grande", transferências, devoluções…
 * Vêm dos XMLs originais que o coletor já guarda (Fiscal → Gerar XML do AppNext):
 *   dados/<loja>/xmls/AAAA-MM/{ativos,cancelados}/AAAAMMDD_<chave>.xml
 * As NFC-e (modelo 65) são os cupons do caixa e ficam de fora (estão em Vendas → Cupons).
 * O modelo vem na própria chave (posições 21-22), então nem precisa abrir as NFC-e.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const CHAVE = /^\d{44}$/;
const raiz = (id) => path.join(C.pastaLoja(id), 'xmls');
const ehNFe = (ch) => CHAVE.test(ch) && ch.slice(20, 22) === '55';

/** arquivos de NF-e da loja: { chave, arq, sit } (a mais recente de cada chave; cancelada vence a ativa) */
function arquivos(id) {
  const out = new Map();
  let meses = [];
  try { meses = fs.readdirSync(raiz(id)).filter((m) => /^\d{4}-\d{2}$/.test(m)); } catch { return []; }
  for (const ym of meses) {
    for (const sit of ['ativos', 'cancelados']) {
      let fs_ = [];
      try { fs_ = fs.readdirSync(path.join(raiz(id), ym, sit)); } catch { continue; }
      for (const f of fs_) {
        const m = /^\d{8}_(\d{44})\.xml$/.exec(f);
        if (!m || !ehNFe(m[1])) continue;
        const atual = out.get(m[1]);
        if (!atual || sit === 'cancelados') out.set(m[1], { chave: m[1], arq: path.join(raiz(id), ym, sit, f), sit });
      }
    }
  }
  return [...out.values()];
}

// ---- leitura do XML (sem dependências: as tags da NF-e são fixas)
const ent = (s) => String(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (txt, n) => { if (!txt) return null; const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`).exec(txt); return m ? ent(m[1].trim()) : null; };
const bloco = (txt, n) => { if (!txt) return ''; const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`).exec(txt); return m ? m[1] : ''; };
const num = (v) => (v == null || v === '' ? null : Number(v));

function endereco(b) {
  if (!b) return null;
  const p = [tag(b, 'xLgr'), tag(b, 'nro')].filter(Boolean).join(', ');
  const q = [tag(b, 'xCpl'), tag(b, 'xBairro')].filter(Boolean).join(' · ');
  return { linha: [p, q].filter(Boolean).join(' · '), mun: tag(b, 'xMun'), uf: tag(b, 'UF'), cep: tag(b, 'CEP'), fone: tag(b, 'fone') };
}

const TP = { 1: 'Saída', 0: 'Entrada' };
const FIN = { 1: 'Normal', 2: 'Complementar', 3: 'Ajuste', 4: 'Devolução' };

/** lê a nota inteira (com os itens) */
function lerXml(txt) {
  const inf = bloco(txt, 'infNFe');
  const ide = bloco(inf, 'ide'), emit = bloco(inf, 'emit'), dest = bloco(inf, 'dest'), tot = bloco(inf, 'ICMSTot');
  const prot = bloco(txt, 'infProt');
  const itens = [];
  const re = /<det\b[^>]*\bnItem="(\d+)"[^>]*>([\s\S]*?)<\/det>/g;
  let m;
  while ((m = re.exec(inf))) {
    const p = bloco(m[2], 'prod');
    itens.push({ n: +m[1], cod: tag(p, 'cProd'), ean: tag(p, 'cEAN'), desc: tag(p, 'xProd'), ncm: tag(p, 'NCM'), cfop: tag(p, 'CFOP'), un: tag(p, 'uCom'),
      qtd: num(tag(p, 'qCom')), vUn: num(tag(p, 'vUnCom')), vProd: num(tag(p, 'vProd')), vDesc: num(tag(p, 'vDesc')) || 0, info: tag(m[2], 'infAdProd') });
  }
  const dh = tag(ide, 'dhEmi') || tag(ide, 'dEmi') || '';
  const pags = [];
  const rp = /<detPag(?:\s[^>]*)?>([\s\S]*?)<\/detPag>/g;
  while ((m = rp.exec(inf))) pags.push({ tPag: tag(m[1], 'tPag'), v: num(tag(m[1], 'vPag')) });
  return {
    numero: num(tag(ide, 'nNF')), serie: tag(ide, 'serie'), mod: tag(ide, 'mod'), emissao: dh, data: dh.slice(0, 10), natOp: tag(ide, 'natOp'),
    tipo: TP[tag(ide, 'tpNF')] || null, finalidade: FIN[tag(ide, 'finNFe')] || null, ambiente: tag(ide, 'tpAmb') === '2' ? 'homologação' : null,
    emit: { nome: tag(emit, 'xNome'), fantasia: tag(emit, 'xFant'), cnpj: tag(emit, 'CNPJ') || tag(emit, 'CPF'), ie: tag(emit, 'IE'), end: endereco(bloco(emit, 'enderEmit')) },
    dest: dest ? { nome: tag(dest, 'xNome'), doc: tag(dest, 'CNPJ') || tag(dest, 'CPF') || tag(dest, 'idEstrangeiro'), tipoDoc: tag(dest, 'CNPJ') ? 'CNPJ' : tag(dest, 'CPF') ? 'CPF' : null,
      ie: tag(dest, 'IE'), email: tag(dest, 'email'), end: endereco(bloco(dest, 'enderDest')) } : null,
    total: { vNF: num(tag(tot, 'vNF')), vProd: num(tag(tot, 'vProd')), vDesc: num(tag(tot, 'vDesc')), vFrete: num(tag(tot, 'vFrete')), vOutro: num(tag(tot, 'vOutro')),
      vBC: num(tag(tot, 'vBC')), vICMS: num(tag(tot, 'vICMS')), vIPI: num(tag(tot, 'vIPI')), vPIS: num(tag(tot, 'vPIS')), vCOFINS: num(tag(tot, 'vCOFINS')), vTotTrib: num(tag(tot, 'vTotTrib')) },
    pagamentos: pags,
    infCpl: tag(bloco(inf, 'infAdic'), 'infCpl'),
    refs: [...bloco(ide, 'NFref').matchAll(/<refNFe>(\d{44})<\/refNFe>/g)].map((x) => x[1]).concat([...ide.matchAll(/<refNFe>(\d{44})<\/refNFe>/g)].map((x) => x[1])).filter((v, k, a) => a.indexOf(v) === k),
    protocolo: tag(prot, 'nProt'), autorizadaEm: tag(prot, 'dhRecbto'), cStat: tag(prot, 'cStat'), xMotivo: tag(prot, 'xMotivo'),
    itens,
  };
}

// cabeçalhos em memória (a NF-e não muda depois de autorizada; a chave do cache inclui a data do arquivo)
const cache = new Map();
function cabecalho(a) {
  let st;
  try { st = fs.statSync(a.arq); } catch { return null; }
  const k = 'v2|' + a.arq + '|' + st.mtimeMs;
  if (!cache.has(k)) {
    if (cache.size >= 4000) cache.delete(cache.keys().next().value);
    try {
      const n = lerXml(fs.readFileSync(a.arq, 'utf8'));
      const cfops = [...new Set(n.itens.map((i) => i.cfop).filter(Boolean))];
      cache.set(k, { chave: a.chave, numero: n.numero, serie: n.serie, data: n.data, emissao: n.emissao, natOp: n.natOp, tipo: n.tipo, finalidade: n.finalidade,
        dest: n.dest ? { nome: n.dest.nome, doc: n.dest.doc, tipoDoc: n.dest.tipoDoc, mun: n.dest.end && n.dest.end.mun, uf: n.dest.end && n.dest.end.uf } : null,
        valor: n.total.vNF, itens: n.itens.length, qtd: n.itens.reduce((s, i) => s + (i.qtd || 0), 0), cfops, refs: n.refs || [] });
    } catch { cache.set(k, null); }
  }
  const c = cache.get(k);
  return c ? { ...c, situacao: a.sit === 'cancelados' ? 'cancelada' : 'autorizada' } : null;
}

/** lista das NF-e da loja (mais recentes primeiro) */
function lista(id) {
  const notas = arquivos(id).map(cabecalho).filter(Boolean).sort((a, b) => (b.emissao || '').localeCompare(a.emissao || '') || (b.numero || 0) - (a.numero || 0));
  let temXml = false;
  try { temXml = fs.readdirSync(raiz(id)).some((m) => /^\d{4}-\d{2}$/.test(m)); } catch { /* ok */ }
  return { notas, temXml };
}

function achar(id, chave) {
  if (!CHAVE.test(String(chave || ''))) return null;
  return arquivos(id).find((a) => a.chave === chave) || null;
}
/** nota completa, com os itens */
function nota(id, chave) {
  const a = achar(id, chave);
  if (!a) return null;
  return { chave, situacao: a.sit === 'cancelados' ? 'cancelada' : 'autorizada', ...lerXml(fs.readFileSync(a.arq, 'utf8')) };
}

// ---------- DANFE (gerado do XML autorizado, para imprimir ou salvar em PDF) ----------
const P128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
/** código de barras Code 128-C (só dígitos, quantidade par) em SVG */
function code128c(digitos) {
  const vals = [105];
  for (let i = 0; i < digitos.length; i += 2) vals.push(+digitos.slice(i, i + 2));
  let soma = 105;
  for (let i = 1; i < vals.length; i++) soma += vals[i] * i;
  vals.push(soma % 103, 106);
  let x = 10, rects = '';
  for (const v of vals) {
    const p = P128[v];
    for (let j = 0; j < p.length; j++) { const w = +p[j]; if (j % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="50"/>`; x += w; }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 10} 50" preserveAspectRatio="none" class="barras">${rects}</svg>`;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brl = (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qtdF = (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 }));
const docF = (d) => { const s = String(d || ''); if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'); if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'); return s; };
const dataF = (iso) => { if (!iso) return ''; const d = iso.slice(0, 10).split('-'); return `${d[2]}/${d[1]}/${d[0]}${iso.length > 10 ? ' ' + iso.slice(11, 16) : ''}`; };

function danfe(n) {
  const ch = n.chave.replace(/(\d{4})/g, '$1 ').trim();
  const e = n.emit, d = n.dest || {}, t = n.total;
  const campo = (rot, val, cls) => `<div class="c ${cls || ''}"><small>${esc(rot)}</small><b>${esc(val)}</b></div>`;
  const linhas = n.itens.map((i) => `<tr><td>${esc(i.cod)}</td><td class="l">${esc(i.desc)}${i.info ? `<br><small>${esc(i.info)}</small>` : ''}</td><td>${esc(i.ncm)}</td><td>${esc(i.cfop)}</td><td>${esc(i.un)}</td><td class="r">${qtdF(i.qtd)}</td><td class="r">${brl(i.vUn)}</td><td class="r">${brl(i.vDesc || null)}</td><td class="r">${brl(i.vProd)}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFE ${esc(n.numero)} - ${esc(e.fantasia || e.nome)}</title>
<style>
@page { size: A4; margin: 8mm; }
* { box-sizing: border-box; }
body { font: 10px/1.25 Arial, Helvetica, sans-serif; color: #000; margin: 0; padding: 12px; }
.folha { max-width: 194mm; margin: 0 auto; }
.barra-acoes { max-width: 194mm; margin: 0 auto 10px; display: flex; gap: 8px; align-items: center; font: 13px Arial; }
.barra-acoes button { font: 13px Arial; padding: 6px 12px; cursor: pointer; }
.g { display: grid; border: 1px solid #000; border-top: 0; }
.g:first-of-type { border-top: 1px solid #000; }
.c { border-right: 1px solid #000; padding: 2px 4px; min-height: 26px; overflow: hidden; }
.c:last-child { border-right: 0; }
.c small { display: block; font-size: 7px; text-transform: uppercase; }
.c b { font-weight: normal; font-size: 10px; }
h2 { font-size: 8px; margin: 6px 0 1px; text-transform: uppercase; }
.topo { grid-template-columns: 2.2fr 1fr 2.4fr; }
.emit b { font-size: 12px; font-weight: bold; display: block; margin-bottom: 2px; }
.danfe { text-align: center; }
.danfe b { font-size: 16px; font-weight: bold; display: block; }
.barras { width: 100%; height: 34px; display: block; margin: 2px 0; }
.chave { font-size: 9.5px; letter-spacing: .3px; text-align: center; }
table { width: 100%; border-collapse: collapse; border: 1px solid #000; }
th, td { border: 1px solid #000; padding: 2px 3px; font-size: 8.5px; text-align: center; vertical-align: top; }
th { font-size: 7px; text-transform: uppercase; font-weight: normal; }
td.l { text-align: left; } td.r { text-align: right; }
thead { display: table-header-group; } tr { break-inside: avoid; }
.cancelada { color: #b00; font-size: 22px; font-weight: bold; text-align: center; border: 3px solid #b00; padding: 4px; margin: 6px 0; }
.nota { font-size: 8px; color: #444; margin-top: 6px; }
@media print { .barra-acoes { display: none; } body { padding: 0; } }
</style><script src="/js/danfe.js"></script></head><body>
<div class="barra-acoes"><button id="imprimir" type="button">Imprimir / salvar em PDF</button><span>DANFE gerado pelo painel a partir do XML autorizado da nota.</span></div>
<div class="folha">
${n.situacao === 'cancelada' ? '<div class="cancelada">NOTA FISCAL CANCELADA</div>' : ''}
<div class="g topo">
  <div class="c emit"><small>Emitente</small><b>${esc(e.nome)}</b>${esc(e.end && e.end.linha)}<br>${esc(e.end && e.end.mun)} - ${esc(e.end && e.end.uf)} · CEP ${esc(e.end && e.end.cep)}${e.end && e.end.fone ? ' · Fone ' + esc(e.end.fone) : ''}</div>
  <div class="c danfe"><b>DANFE</b>Documento Auxiliar da Nota Fiscal Eletrônica<br>${n.tipo === 'Entrada' ? '0 - Entrada' : '1 - Saída'}<br><b style="font-size:11px">Nº ${esc(String(n.numero).padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3'))}</b>Série ${esc(n.serie)}</div>
  <div class="c">${code128c(n.chave)}<small>Chave de acesso</small><div class="chave">${esc(ch)}</div><small style="margin-top:3px">Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal</small></div>
</div>
<div class="g" style="grid-template-columns: 2fr 1.4fr">${campo('Natureza da operação', n.natOp)}${campo('Protocolo de autorização de uso', n.protocolo ? `${n.protocolo} - ${dataF(n.autorizadaEm)}` : '—')}</div>
<div class="g" style="grid-template-columns: 1fr 1fr 1fr">${campo('Inscrição estadual', e.ie)}${campo('CNPJ', docF(e.cnpj))}${campo('Finalidade', n.finalidade)}</div>
<h2>Destinatário / remetente</h2>
<div class="g" style="grid-template-columns: 3fr 1.3fr 1fr; border-top: 1px solid #000">${campo('Nome / razão social', d.nome || '—')}${campo('CNPJ / CPF', docF(d.doc))}${campo('Data da emissão', dataF(n.emissao).slice(0, 10))}</div>
<div class="g" style="grid-template-columns: 3fr 1.3fr 1fr">${campo('Endereço', d.end && d.end.linha)}${campo('CEP', d.end && d.end.cep)}${campo('Hora da emissão', (n.emissao || '').slice(11, 16))}</div>
<div class="g" style="grid-template-columns: 2fr 0.6fr 1.3fr 1fr">${campo('Município', d.end && d.end.mun)}${campo('UF', d.end && d.end.uf)}${campo('Fone', d.end && d.end.fone)}${campo('Inscrição estadual', d.ie)}</div>
<h2>Cálculo do imposto</h2>
<div class="g" style="grid-template-columns: repeat(6, 1fr); border-top: 1px solid #000">${campo('Base de cálculo do ICMS', brl(t.vBC))}${campo('Valor do ICMS', brl(t.vICMS))}${campo('Valor do IPI', brl(t.vIPI))}${campo('Valor do PIS', brl(t.vPIS))}${campo('Valor da COFINS', brl(t.vCOFINS))}${campo('Valor total dos produtos', brl(t.vProd))}</div>
<div class="g" style="grid-template-columns: repeat(5, 1fr)">${campo('Valor do frete', brl(t.vFrete))}${campo('Desconto', brl(t.vDesc))}${campo('Outras despesas', brl(t.vOutro))}${campo('Tributos aproximados', brl(t.vTotTrib))}${campo('Valor total da nota', brl(t.vNF), 'tot')}</div>
<h2>Dados dos produtos / serviços</h2>
<table><thead><tr><th>Código</th><th>Descrição</th><th>NCM</th><th>CFOP</th><th>Un</th><th>Qtd</th><th>V. unit.</th><th>Desc.</th><th>V. total</th></tr></thead><tbody>${linhas}</tbody></table>
<h2>Dados adicionais</h2>
<div class="g" style="grid-template-columns: 1fr; border-top: 1px solid #000"><div class="c" style="min-height:50px"><small>Informações complementares</small>${esc(n.infCpl || '')}</div></div>
<p class="nota">Representação gerada a partir do XML da NF-e autorizada (o XML é o documento fiscal). Para a via oficial do emissor, use o sistema de vendas.</p>
</div></body></html>`;
}

module.exports = { lista, nota, achar, danfe, lerXml, code128c };
