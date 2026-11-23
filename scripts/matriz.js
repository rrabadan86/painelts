#!/usr/bin/env node
'use strict';
/**
 * Matriz de rastreabilidade (docs/rastreabilidade.md) lida por programa — uma leitura só, usada por:
 * - `node scripts/matriz.js --resumo`  reescreve a tabela "Resumo em números" (entre os marcadores) pela contagem das linhas;
 * - `node scripts/matriz.js`           mostra o resumo contado (sem gravar);
 * - tests/unit/matriz.test.js           (guardião: a matriz não fica velha nem aponta para teste que não existe);
 * - scripts/testar-alteracao.js         (regras afetadas pelos arquivos mexidos e os testes delas);
 * - .claude/hooks/lembrar-docs.js       (lembra de atualizar a matriz quando o commit mexe num arquivo citado nela).
 * Node puro, sem dependência.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ARQ = path.join(RAIZ, 'docs', 'rastreabilidade.md');
const INI = '<!-- resumo:inicio -->';
const FIM = '<!-- resumo:fim -->';
const COB = ['✅', '🟡', '❌'];
// pastas onde moram os arquivos citados só pelo nome (ex.: `lotes.js` → src/lotes.js e public/js/lotes.js se existir)
const PASTAS = ['', 'src', 'public/js', 'public', 'zap', 'coletor', 'scripts', '.claude/hooks', 'public/site'];
// abreviações usadas na coluna Teste
const ABREV = { esc: 'tests/e2e/escala-horario.spec.js', blind: 'tests/unit/blindagem.test.js' };

/** separa as células de uma linha de tabela markdown (crase não quebra célula) */
function celulas(linha) {
  const t = linha.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) return null;
  const out = [];
  let cel = '', crase = false;
  for (const ch of t.slice(1, -1)) {
    if (ch === '`') crase = !crase;
    if (ch === '|' && !crase) { out.push(cel.trim()); cel = ''; } else cel += ch;
  }
  out.push(cel.trim());
  return out;
}

/** "GRP-01…04" → GRP-01..GRP-04; "SUG-CARR-01/02" → os dois; "CLI-CEL / CONV-13" → os dois */
function expandirCodigos(cel) {
  const out = [];
  for (const parte of String(cel).replace(/\*\*/g, '').split(/\s*\/\s+|\s+e\s+|,\s*/)) {
    const p = parte.trim();
    let m = p.match(/^([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*)-(\d+)\s*(?:…|\.\.\.|a)\s*(\d+)$/);
    if (m) { const w = m[2].length; for (let n = +m[2]; n <= +m[3]; n++) out.push(`${m[1]}-${String(n).padStart(w, '0')}`); continue; }
    m = p.match(/^([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*)-(\d+)\/(\d+)$/);
    if (m) { out.push(`${m[1]}-${m[2]}`, `${m[1]}-${m[3].padStart(m[2].length, '0')}`); continue; }
    if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(p)) out.push(p);
  }
  return out;
}

/** cobertura da linha: o primeiro ✅/🟡/❌ da célula */
function coberturaDe(cel) {
  let melhor = null, pos = Infinity;
  for (const c of COB) { const i = cel.indexOf(c); if (i >= 0 && i < pos) { pos = i; melhor = c; } }
  return melhor;
}

let _indice = null;
/** nome de arquivo → caminhos no projeto (para resolver `lotes.js`, `server.js`…) */
function indiceArquivos() {
  if (_indice) return _indice;
  _indice = new Map();
  for (const p of PASTAS) {
    const dir = path.join(RAIZ, p);
    let nomes = [];
    try { nomes = fs.readdirSync(dir); } catch { continue; }
    for (const n of nomes) {
      if (!/\.(js|py|css|html|sh|json|md)$/.test(n)) continue;
      const rel = p ? `${p}/${n}` : n;
      try { if (!fs.statSync(path.join(RAIZ, rel)).isFile()) continue; } catch { continue; }
      (_indice.get(n) || _indice.set(n, []).get(n)).push(rel);
    }
  }
  return _indice;
}

/** arquivos de código citados na coluna "Onde está" (entre crases) */
function arquivosDe(cel) {
  const out = new Set();
  for (const m of String(cel).matchAll(/`([^`]+)`/g)) {
    for (const tok of m[1].split(/[\s,;()]+/)) {
      const t = tok.replace(/^\.\//, '').replace(/[:#].*$/, '');
      if (!/\.(js|py|css|html|sh)$/.test(t)) continue;
      if (t.includes('/')) { if (fs.existsSync(path.join(RAIZ, t))) out.add(t); else for (const r of indiceArquivos().get(path.basename(t)) || []) if (r.endsWith(t)) out.add(r); continue; }
      for (const r of indiceArquivos().get(t) || []) out.add(r);
    }
  }
  return [...out];
}

/** arquivos de teste citados na coluna "Teste" (`x.test`, `y.spec`, `esc`, `blind`, `zap/tests`) */
function testesDe(cel) {
  const out = new Set();
  const txt = String(cel);
  for (const m of txt.matchAll(/`([^`]+)`/g)) {
    const t = m[1].trim();
    let mm;
    if (ABREV[t]) out.add(ABREV[t]);
    else if (/^zap\/tests(\/.*)?$/.test(t)) out.add(t.replace(/\/$/, ''));
    // outras pastas de teste com o caminho inteiro (tests/perfis/…, tests/datas/…, tests/visual/…)
    else if (/^tests\/(?!unit\/|e2e\/)[\w.-]+\/[\w.-]+\.(spec|test)\.js$/.test(t)) out.add(t);
    else if ((mm = t.match(/^(?:tests\/unit\/)?([\w.-]+)\.test(?:\.js)?$/))) out.add(`tests/unit/${mm[1]}.test.js`);
    else if ((mm = t.match(/^(?:tests\/e2e\/)?([\w.-]+)\.spec(?:\.js)?$/))) out.add(`tests/e2e/${mm[1]}.spec.js`);
  }
  return [...out];
}

/** lê a matriz: linhas de regra (com área), o texto e as seções */
function ler(arquivo = ARQ) {
  const texto = fs.readFileSync(arquivo, 'utf8');
  const linhas = [];
  const areas = [];
  let area = null, fimRegras = false;
  texto.split('\n').forEach((l, i) => {
    const h = l.match(/^## (\d+)\. (.+?) \(([A-Z]+)\)\s*$/);
    if (h) { area = { n: +h[1], nome: h[2], sigla: h[3] }; areas.push(area); return; }
    if (/^## /.test(l)) { if (area) fimRegras = true; area = null; return; }
    if (!area || fimRegras) return;
    const c = celulas(l);
    if (!c || c.length < 5 || /^-+$/.test(c[0]) || c[0] === 'Código') return;
    linhas.push({ linha: i + 1, area: area.sigla, areaNome: area.nome, celula: c[0], codigos: expandirCodigos(c[0]), regra: c[1], onde: c[2], teste: c[3], cob: c[4], cobertura: coberturaDe(c[4]) });
  });
  return { texto, linhas, areas };
}

/** contagem por área: { sigla, nome, total, '✅', '🟡', '❌' } */
function contar(m = ler()) {
  return m.areas.map((a) => {
    const ls = m.linhas.filter((l) => l.area === a.sigla);
    const r = { sigla: a.sigla, nome: a.nome, total: ls.length };
    for (const c of COB) r[c] = ls.filter((l) => l.cobertura === c).length;
    return r;
  });
}

const pct = (n, t) => (t ? Math.round((100 * n) / t) : 0);
/** a tabela "Resumo em números" (markdown) pela contagem */
function tabelaResumo(m = ler()) {
  const por = contar(m);
  const tot = { total: 0, '✅': 0, '🟡': 0, '❌': 0 };
  for (const r of por) for (const k of Object.keys(tot)) tot[k] += r[k];
  const linhas = ['| Área | Regras | ✅ | 🟡 | ❌ |', '|---|---|---|---|---|'];
  for (const r of por) linhas.push(`| ${r.nome} (${r.sigla}) | ${r.total} | ${r['✅']} | ${r['🟡']} | ${r['❌']} |`);
  linhas.push(`| **Total** | **${tot.total}** | **${tot['✅']} (${pct(tot['✅'], tot.total)}%)** | **${tot['🟡']} (${pct(tot['🟡'], tot.total)}%)** | **${tot['❌']} (${pct(tot['❌'], tot.total)}%)** |`);
  return linhas.join('\n');
}

/** o resumo que está gravado entre os marcadores (ou null) */
function resumoGravado(texto) {
  const a = texto.indexOf(INI), b = texto.indexOf(FIM);
  if (a < 0 || b < a) return null;
  return texto.slice(a + INI.length, b).trim();
}

/** reescreve o resumo no arquivo; devolve true se mudou */
function gravarResumo(arquivo = ARQ) {
  const m = ler(arquivo);
  const novo = tabelaResumo(m);
  const a = m.texto.indexOf(INI), b = m.texto.indexOf(FIM);
  if (a < 0 || b < a) throw new Error(`marcadores ${INI} / ${FIM} não encontrados em ${arquivo}`);
  const texto = m.texto.slice(0, a + INI.length) + '\n' + novo + '\n' + m.texto.slice(b);
  if (texto === m.texto) return false;
  fs.writeFileSync(arquivo, texto);
  return true;
}

/** todos os códigos amarrados na matriz: o da linha e os citados na coluna Teste (ex.: `contas.test` META-01…04) */
function codigosAmarrados(m = ler()) {
  const out = new Set();
  for (const l of m.linhas) {
    for (const c of l.codigos) out.add(c);
    for (const mm of String(l.teste).matchAll(/\b[A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]+)+(?:\s*…\s*\d+|\/\d+)?/g)) for (const c of expandirCodigos(mm[0].replace(/\s+/g, ''))) out.add(c);
  }
  return out;
}

/** regras cujos arquivos em "Onde está" estão na lista de arquivos mexidos */
function regrasDosArquivos(arquivos, m = ler()) {
  const set = new Set(arquivos.map((a) => a.replace(/\\/g, '/')));
  return m.linhas.map((l) => ({ ...l, arquivos: arquivosDe(l.onde).filter((a) => set.has(a)) })).filter((l) => l.arquivos.length);
}

module.exports = { ARQ, INI, FIM, ler, contar, codigosAmarrados, tabelaResumo, resumoGravado, gravarResumo, expandirCodigos, coberturaDe, arquivosDe, testesDe, regrasDosArquivos };

if (require.main === module) {
  if (process.argv.includes('--resumo')) {
    const mudou = gravarResumo();
    console.log(mudou ? 'Resumo em números atualizado em docs/rastreabilidade.md:' : 'Resumo em números já estava em dia:');
  }
  console.log(tabelaResumo());
}
