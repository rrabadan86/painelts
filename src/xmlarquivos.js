'use strict';
/**
 * XMLs originais das notas, guardados pelo coletor:
 *   dados/<loja>/xmls/AAAA-MM/ativos/AAAAMMDD_<chave>.xml
 *   dados/<loja>/xmls/AAAA-MM/cancelados/AAAAMMDD_<chave>.xml (e AAAAMMDD_evento_<chave>.xml)
 * Vão zipados no e-mail de faturamento para a contabilidade.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const YM = /^\d{4}-\d{2}$/;
const CFOP_NAO_VENDA = /^([123]\d{3}|520[12]|620[12]|5411|6411|5556|6556|515[1256]|615[1256]|5409|6409)$/;
const pasta = (lojaId, ym, sit) => path.join(C.pastaLoja(lojaId), 'xmls', ym, sit);
const arquivos = (lojaId, ym, sit) => {
  try { return fs.readdirSync(pasta(lojaId, ym, sit)).filter((f) => f.endsWith('.xml')).sort(); } catch { return []; }
};
const vNF = (txt) => { const m = /<vNF>([\d.]+)<\/vNF>/.exec(txt); return m ? +m[1] : 0; };
function ehNaoVenda(txt) {
  const tp = /<tpNF>\s*([01])\s*<\/tpNF>/.exec(txt);
  if (tp && tp[1] === '0') return true;
  const fin = /<finNFe>\s*(\d+)\s*<\/finNFe>/.exec(txt);
  if (fin && fin[1] === '4') return true;
  const cfop = /<CFOP>\s*(\d{4})\s*<\/CFOP>/.exec(txt);
  return !!(cfop && CFOP_NAO_VENDA.test(cfop[1]));
}

const resumoCache = new Map(); // "lojaId|ym" -> { sig, out }
function assinaturaMes(lojaId, ym) {
  const partes = [];
  for (const sit of ['ativos', 'cancelados']) {
    const dir = pasta(lojaId, ym, sit);
    try {
      const st = fs.statSync(dir);
      const arqs = fs.readdirSync(dir).filter((f) => f.endsWith('.xml'));
      partes.push(`${sit}:${st.mtimeMs}:${arqs.length}`);
    } catch { partes.push(`${sit}:0:0`); }
  }
  return partes.join('|');
}

/** quantidade e soma das notas ativas (vendas), outras saídas/entradas (devoluções/transferências) e canceladas do mês */
function resumo(lojaId, ym) {
  if (!YM.test(ym)) throw new Error('Mês inválido.');
  const k = `${lojaId}|${ym}`, sig = assinaturaMes(lojaId, ym);
  const hit = resumoCache.get(k);
  if (hit && hit.sig === sig) return hit.out;
  const out = { ym, ativos: { notas: 0, total: 0 }, outras: { notas: 0, total: 0 }, cancelados: { notas: 0, total: 0, eventos: 0 }, de: null, ate: null, atualizado: null, bytes: 0 };
  for (const sit of ['ativos', 'cancelados']) {
    for (const f of arquivos(lojaId, ym, sit)) {
      const arq = path.join(pasta(lojaId, ym, sit), f);
      const st = fs.statSync(arq);
      out.bytes += st.size;
      if (!out.atualizado || st.mtime > out.atualizado) out.atualizado = st.mtime;
      if (f.includes('_evento_')) { out.cancelados.eventos++; continue; }
      const dia = `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`;
      const txt = fs.readFileSync(arq, 'latin1');
      const val = vNF(txt);
      if (sit === 'ativos') {
        if (!out.de || dia < out.de) out.de = dia;
        if (!out.ate || dia > out.ate) out.ate = dia;
        if (ehNaoVenda(txt)) { out.outras.notas++; out.outras.total += val; }
        else { out.ativos.notas++; out.ativos.total += val; }
      } else {
        out.cancelados.notas++;
        out.cancelados.total += val;
      }
    }
  }
  out.ativos.total = Math.round(out.ativos.total * 100) / 100;
  out.outras.total = Math.round(out.outras.total * 100) / 100;
  out.cancelados.total = Math.round(out.cancelados.total * 100) / 100;
  if (resumoCache.size > 300 && !resumoCache.has(k)) resumoCache.delete(resumoCache.keys().next().value);
  resumoCache.set(k, { sig, out });
  return out;
}

/** zip com as pastas ativos/ e cancelados/ do mês */
async function zipar(lojaId, ym) {
  const JSZip = require('jszip');
  const z = new JSZip();
  for (const sit of ['ativos', 'cancelados']) {
    for (const f of arquivos(lojaId, ym, sit)) z.file(`${sit}/${f}`, fs.readFileSync(path.join(pasta(lojaId, ym, sit), f)));
  }
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

module.exports = { resumo, zipar, ehNaoVenda };
