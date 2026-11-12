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
const pasta = (lojaId, ym, sit) => path.join(C.pastaLoja(lojaId), 'xmls', ym, sit);
const arquivos = (lojaId, ym, sit) => {
  try { return fs.readdirSync(pasta(lojaId, ym, sit)).filter((f) => f.endsWith('.xml')).sort(); } catch { return []; }
};
const vNF = (txt) => { const m = /<vNF>([\d.]+)<\/vNF>/.exec(txt); return m ? +m[1] : 0; };

/** quantidade e soma das notas ativas e canceladas do mês */
function resumo(lojaId, ym) {
  if (!YM.test(ym)) throw new Error('Mês inválido.');
  const out = { ym, ativos: { notas: 0, total: 0 }, cancelados: { notas: 0, total: 0, eventos: 0 }, de: null, ate: null, atualizado: null, bytes: 0 };
  for (const sit of ['ativos', 'cancelados']) {
    for (const f of arquivos(lojaId, ym, sit)) {
      const arq = path.join(pasta(lojaId, ym, sit), f);
      const st = fs.statSync(arq);
      out.bytes += st.size;
      if (!out.atualizado || st.mtime > out.atualizado) out.atualizado = st.mtime;
      if (f.includes('_evento_')) { out.cancelados.eventos++; continue; }
      const dia = `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`;
      if (sit === 'ativos') { if (!out.de || dia < out.de) out.de = dia; if (!out.ate || dia > out.ate) out.ate = dia; }
      out[sit].notas++;
      out[sit].total += vNF(fs.readFileSync(arq, 'latin1'));
    }
  }
  out.ativos.total = Math.round(out.ativos.total * 100) / 100;
  out.cancelados.total = Math.round(out.cancelados.total * 100) / 100;
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

module.exports = { resumo, zipar };
