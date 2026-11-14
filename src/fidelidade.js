'use strict';
/**
 * Logs do FIXE (programa de fidelidade): exportação "Logs" — uma linha por movimento do cliente.
 *   Nome | Data Cadastro | Email | CPF | Loja | RESGATE | DATA TRANSAÇÃO | Histórico
 * O "Histórico" tem o tipo, a data e hora e os produtos:
 *   "15/09/2025 15:19:58 - Adicionado 6 pontos\nProduto: X 250G\nProduto: Y 50G\n"
 *   "02/07/2025 00:00:00 - Compra feita em 09/09/2023Produto: ...\n"   (compras antigas, sem hora)
 *   "13/07/2025 20:15:02 - Resgate de 10 pontos\nProduto: Medida Inox\n"
 *   "15/09/2026 20:20:20 - 6 pontos removidos(expirados).\n"
 *   "19/08/2025 12:18:32 Operação cancelada via PDV.Produto: ..."
 *   "22/09/2025 21:59:49 - Bem vindo(a), você ganhou 1 ponto.\n"
 * A coluna "DATA TRANSAÇÃO" vem com erro em parte das linhas: a data usada é a do Histórico.
 * Guardado em dados/<loja>/fixe/eventos.json.gz (a exportação é sempre o histórico inteiro: substitui).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const C = require('./config');

const arq = (id) => path.join(C.pastaLoja(id), 'fixe', 'eventos.json.gz');
const ESQ = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const iso = (d, m, a) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** é a planilha de logs? (tem a coluna Histórico) */
function ehLogs(rows) {
  return rows.slice(0, 5).some((r) => (r || []).some((c) => ESQ(c) === 'historico'));
}

function evento(h) {
  const t = String(h || '').replace(/\r/g, '');
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*-?\s*/.exec(t);
  if (!m) return null;
  let data = iso(m[1], m[2], m[3]);
  let min = +m[4] * 60 + +m[5];
  const resto = t.slice(m[0].length);
  const produtos = [...resto.matchAll(/Produto:\s*([^\n]+)/g)].map((x) => x[1].trim()).filter(Boolean);
  let tipo = 'outro', pontos = 0;
  let k;
  if ((k = /^Compra feita em (\d{2})\/(\d{2})\/(\d{4})/i.exec(resto))) { tipo = 'compra'; data = iso(k[1], k[2], k[3]); min = null; } // compra antiga: só a data
  else if ((k = /^Adicionado (\d+) pontos?/i.exec(resto))) { tipo = 'pontos'; pontos = +k[1]; }
  else if ((k = /^Resgate de (\d+) pontos?/i.exec(resto))) { tipo = 'resgate'; pontos = +k[1]; }
  else if ((k = /^(\d+) pontos? removidos?\s*\(expirados?\)/i.exec(resto))) { tipo = 'expirou'; pontos = +k[1]; }
  else if (/^Opera[cç][aã]o cancelada/i.test(resto)) tipo = 'cancelado';
  else if ((k = /^Bem vindo\(a\), voc[eê] ganhou (\d+) ponto/i.exec(resto))) { tipo = 'boasvindas'; pontos = +k[1]; }
  else if (/^Bem vindo/i.test(resto)) tipo = 'boasvindas';
  return { data, min, tipo, pontos, produtos };
}

/** linhas da planilha → eventos */
function ler(rows) {
  const iCab = rows.findIndex((r) => (r || []).some((c) => ESQ(c) === 'historico'));
  if (iCab < 0) throw new Error('Não é a planilha de Logs do FIXE (falta a coluna Histórico).');
  const cab = rows[iCab].map(ESQ);
  const col = (n) => cab.indexOf(n);
  const k = { nome: col('nome'), cpf: col('cpf'), loja: col('loja'), hist: col('historico'), email: col('email'), cad: col('data cadastro') };
  const { dataDMY } = require('./cadastro');
  const cadastros = {};
  if (k.cpf < 0) throw new Error('A planilha de Logs precisa da coluna CPF.');
  const out = [];
  for (const r of rows.slice(iCab + 1)) {
    if (!r) continue;
    const cpf = String(r[k.cpf] ?? '').replace(/\D/g, '').padStart(11, '0');
    if (!/^\d{11}$/.test(cpf) || /^0+$/.test(cpf)) continue;
    if (k.cad >= 0 && r[k.cad] != null && String(r[k.cad]).trim() !== '') { let d = null; try { d = dataDMY(r[k.cad]); } catch { /* data ruim */ } if (d && (!cadastros[cpf] || d < cadastros[cpf])) cadastros[cpf] = d; }
    else if (!(cpf in cadastros)) cadastros[cpf] = null;
    // um campo Histórico pode ter vários movimentos (um por linha com data no começo)
    const blocos = String(r[k.hist] ?? '').split(/\n(?=\d{2}\/\d{2}\/\d{4}\s)/);
    for (const b of blocos) {
      const e = evento(b);
      if (!e) continue;
      out.push({ cpf, nome: k.nome >= 0 ? String(r[k.nome] ?? '').trim().slice(0, 80) : '', loja: k.loja >= 0 ? String(r[k.loja] ?? '').trim().replace(/\.$/, '') : '', ...e });
    }
  }
  if (!out.length) throw new Error('Nenhum movimento na planilha de Logs.');
  // sem repetidos (o mesmo movimento pode vir em duas linhas)
  const vistos = new Set();
  const ev = out.filter((e) => { const c = [e.cpf, e.data, e.min, e.tipo, e.pontos, e.produtos.join('|')].join('#'); if (vistos.has(c)) return false; vistos.add(c); return true; });
  ev.cadastros = cadastros;
  return ev;
}

async function importar(id, buf) {
  const { linhasDeBuffer } = require('./sources');
  const ev = ler(await linhasDeBuffer(buf));
  fs.mkdirSync(path.dirname(arq(id)), { recursive: true });
  C.gravarAtomico(arq(id), zlib.gzipSync(JSON.stringify({ em: new Date().toISOString(), eventos: ev, cadastros: ev.cadastros || {} })), 0o640);
  const cont = (t) => ev.filter((e) => e.tipo === t).length;
  const r = { tipo: 'logs', movimentos: ev.length, clientes: new Set(ev.map((e) => e.cpf)).size, compras: cont('pontos') + cont('compra'), resgates: cont('resgate'), expirados: cont('expirou') };
  C.gravarAtomico(path.join(path.dirname(arq(id)), 'logs.json'), JSON.stringify({ em: new Date().toISOString(), ...r }), 0o640);
  return r;
}
/** resumo da última importação dos Logs (por e-mail ou envio manual) */
function resumo(id) {
  try { return JSON.parse(fs.readFileSync(path.join(path.dirname(arq(id)), 'logs.json'), 'utf8')); } catch { return null; }
}

function eventos(id) {
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(arq(id))).toString('utf8')); } catch { return null; }
}

const arqMembros = (id) => path.join(C.pastaLoja(id), 'fixe', 'membros.json.gz');
function assinatura(id) {
  const m = (f) => { try { return String(fs.statSync(f).mtimeMs); } catch { return ''; } };
  return m(arq(id)) + '/' + m(arqMembros(id));
}
/** quem está no programa (base de leads do FIXE): [[cpf, data de cadastro], …] — a exportação é a base inteira, substitui */
function gravarMembros(id, lista) {
  fs.mkdirSync(path.dirname(arqMembros(id)), { recursive: true });
  C.gravarAtomico(arqMembros(id), zlib.gzipSync(JSON.stringify({ em: new Date().toISOString(), membros: lista })), 0o640);
}
function membros(id) {
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(arqMembros(id))).toString('utf8')); } catch { return null; }
}

// minResgate: pontos para poder resgatar; prazoResgate: dias que o cliente tem para resgatar (indicador da tela Clientes)
const REGRAS_PADRAO = { reaisPorPonto: 50, validadeMeses: 12, minResgate: 6, prazoResgate: 90 };
function regrasDe(loja) {
  const r = (loja && loja.fidelidade) || {};
  return {
    reaisPorPonto: r.reaisPorPonto > 0 ? +r.reaisPorPonto : REGRAS_PADRAO.reaisPorPonto,
    validadeMeses: r.validadeMeses > 0 ? Math.round(+r.validadeMeses) : REGRAS_PADRAO.validadeMeses,
    minResgate: r.minResgate > 0 ? Math.round(+r.minResgate) : REGRAS_PADRAO.minResgate,
    prazoResgate: r.prazoResgate > 0 ? Math.round(+r.prazoResgate) : REGRAS_PADRAO.prazoResgate,
  };
}

/**
 * Quais nomes de loja do FIXE são esta loja do painel. Os nomes são os do cadastro no FIXE, sem padrão:
 * a base é da loja, então o nome mais frequente é ela; os nomes que são começo dele (ou o contrário) também
 * ("GOIANIA - TEA SHOP" e "GOIANIA - TEA SHOP FLAMBOYANT"). As outras lojas são da rede.
 */
function nomesProprios(eventos) {
  const cont = new Map();
  for (const e of eventos) if (e.loja) cont.set(e.loja, (cont.get(e.loja) || 0) + 1);
  let dom = null;
  for (const [n, c] of cont) if (!dom || c > cont.get(dom)) dom = n;
  if (!dom) return new Set();
  const d = ESQ(dom);
  return new Set([...cont.keys()].filter((n) => { const x = ESQ(n); return x === d || d.startsWith(x + ' ') || x.startsWith(d + ' '); }));
}

/**
 * Formato enxuto para o painel: dicionários de nomes e lojas e uma linha por movimento
 *   [cpf, iNome, iLoja, data, min, tipo, pontos, "produto|produto"]
 * propria[i] diz se a loja i do FIXE é esta loja do painel; vendaLoja é o nome dessa loja nas vendas.
 */
function paraPainel(fx, loja, nomesVenda, mb) {
  const ev = (fx && fx.eventos) || [];
  // membros: base de leads + quem aparece nos Logs; a data de cadastro mais antiga que houver
  const cad = new Map();
  const poe = (cpf, d) => { if (!cad.has(cpf)) cad.set(cpf, d || null); else if (d && (!cad.get(cpf) || d < cad.get(cpf))) cad.set(cpf, d); };
  for (const [cpf, d] of (mb && mb.membros) || []) poe(cpf, d);
  for (const [cpf, d] of Object.entries((fx && fx.cadastros) || {})) poe(cpf, d);
  for (const e of ev) poe(e.cpf, null);
  const proprios = nomesProprios(ev);
  const nomes = [], iNome = new Map(), lojas = [], iLoja = new Map();
  const idx = (m, l, v) => { let i = m.get(v); if (i === undefined) { i = l.length; l.push(v); m.set(v, i); } return i; };
  const linhas = ev.map((e) => [e.cpf, idx(iNome, nomes, e.nome || ''), idx(iLoja, lojas, e.loja || ''), e.data, e.min, e.tipo, e.pontos || 0, (e.produtos || []).join('|')]);
  return { id: loja.id, nome: loja.nome, em: fx && fx.em, membrosEm: mb && mb.em, membros: [...cad], vendaLoja: (nomesVenda || [])[0] || null, regras: regrasDe(loja), nomes, lojas, propria: lojas.map((n) => proprios.has(n)), ev: linhas };
}

module.exports = { ehLogs, ler, importar, eventos, evento, assinatura, resumo, gravarMembros, membros, regrasDe, nomesProprios, paraPainel, REGRAS_PADRAO };
