'use strict';
/**
 * CMV pelo estoque (decisão do dono, 25/11/2026; CMV-EST-01): estoque inicial + compras − devoluções à franquia − estoque final.
 * A diferença para o custo das vendas (o que saiu vendido) são as perdas e os acertos do mês (inventário, vencidos, erros).
 *
 * Foto do estoque a custo: a cada planilha de estoque importada (src/estoque.js → importar) o painel guarda, nos dias perto da
 * virada do mês (26 em diante e 1 a 3), a PRIMEIRA foto do dia (o relatório do AppNext sai de madrugada, antes das vendas):
 *   dados/<loja>/estoque/fotos.json  { 'AAAA-MM-DD': { em, valor, itens, semCusto } }
 * Estoque final de um mês = a foto do dia 1 do mês seguinte; sem ela, a mais próxima (marcada "aprox."). Estoque inicial = o final
 * do mês anterior. Só leitura de planilha: nada é gravado no AppNext.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const arq = (id) => path.join(C.pastaLoja(id), 'estoque', 'fotos.json');
const GUARDA_DIAS = 800;
const ymMais = (ym, n) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);

function ler(id) {
  try { const j = JSON.parse(fs.readFileSync(arq(id), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}

/** valor a custo de um estoque (itens do AppNext): só saldo positivo com custo */
function valorDe(itens) {
  let valor = 0, n = 0, semCusto = 0;
  for (const it of itens || []) {
    const q = +it.qtd;
    if (!(q > 0)) continue;
    n++;
    if (+it.custo > 0) valor += q * +it.custo; else semCusto++;
  }
  return { valor: Math.round(valor * 100) / 100, itens: n, semCusto };
}

/** perto da virada? (26 em diante ou 1 a 3) */
const pertoDaVirada = (dia) => { const d = +dia.slice(8, 10); return d >= 26 || d <= 3; };

/** guarda a foto do estoque recém-importado (a primeira de cada dia perto da virada). dados: { em, itens } */
function registrarFoto(id, dados, opts = {}) {
  const ms = Date.parse((dados && dados.em) || '');
  if (!Number.isFinite(ms) || !dados.itens || !dados.itens.length) return null;
  const dia = C.diaSP(ms);
  if (!opts.sempre && !pertoDaVirada(dia)) return null;
  const f = ler(id);
  if (f[dia] && Date.parse(f[dia].em) <= ms) return null; // já tem a primeira do dia
  f[dia] = { em: new Date(ms).toISOString(), ...valorDe(dados.itens) };
  const corte = C.diaSP(Date.now() - GUARDA_DIAS * 864e5);
  for (const k of Object.keys(f)) if (k < corte) delete f[k];
  fs.mkdirSync(path.dirname(arq(id)), { recursive: true });
  C.gravarAtomico(arq(id), JSON.stringify(f), 0o640);
  return f[dia];
}

/** a foto da virada para o mês ym (estoque no FIM de ym): dia 1 do mês seguinte; senão a mais próxima entre o dia 26 de ym e o dia 3 do seguinte */
function fotoFim(fotos, ym) {
  const prox = ymMais(ym, 1);
  const exato = fotos[`${prox}-01`];
  if (exato) return { dia: `${prox}-01`, valor: exato.valor, aprox: false };
  const alvo = Date.parse(`${prox}-01T03:00:00Z`);
  let best = null;
  for (const [dia, f] of Object.entries(fotos)) {
    if (!(dia >= `${ym}-26` && dia <= `${prox}-03`)) continue;
    const d = Math.abs(Date.parse(`${dia}T12:00:00Z`) - alvo);
    if (!best || d < best.d) best = { d, dia, valor: f.valor };
  }
  return best ? { dia: best.dia, valor: best.valor, aprox: true } : null;
}

/**
 * Os meses com a conta pelo estoque: { 'AAAA-MM': { ini, fim, compras, devolucoes } } (só meses com as duas fotos).
 * notas: as notas de entrada do coletor (compras.json: { entrada, motivo, status, itens: [{ qtd, custo }] });
 * saidas: as NF-e de saída do painel (nfsaida: { data, finalidade, valor, situacao, dest }) — devoluções à franquia.
 */
function resumo(id, { notas = [], saidas = [] } = {}) {
  const fotos = ler(id);
  const compras = {}, devol = {};
  for (const n of notas) {
    if (!/compra/i.test(n.motivo || '') || !/^conclu/i.test(n.status || '')) continue;
    const ym = String(n.entrada || n.emissao || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    compras[ym] = (compras[ym] || 0) + (n.itens || []).reduce((a, i) => a + ((+i.qtd > 0 && +i.custo > 0) ? +i.qtd * +i.custo : 0), 0);
  }
  for (const s of saidas) {
    if (s.situacao === 'cancelada' || !/devolu/i.test(s.finalidade || '')) continue;
    const ym = String(s.data || s.emissao || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) devol[ym] = (devol[ym] || 0) + (+s.valor || 0);
  }
  const meses = new Set(Object.keys(fotos).map((d) => d.slice(0, 7)).flatMap((ym) => [ym, ymMais(ym, -1)]));
  const out = {};
  for (const ym of meses) {
    const fim = fotoFim(fotos, ym), ini = fotoFim(fotos, ymMais(ym, -1));
    if (!fim || !ini) continue;
    out[ym] = { ini, fim, compras: Math.round((compras[ym] || 0) * 100) / 100, devolucoes: Math.round((devol[ym] || 0) * 100) / 100 };
  }
  return out;
}

module.exports = { ler, valorDe, registrarFoto, fotoFim, resumo, pertoDaVirada };
