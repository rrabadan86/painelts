/* Preços do e-commerce (www.teashop.com.br, loja Shopify): lê o catálogo público (/products.json) uma vez por dia
 * às 10h (horário de Brasília) e quando alguém pede "Consultar agora". Guarda em dados/site/precos.json só o que é
 * público no site: produto, variante, SKU, preço, preço "de" (quando está em promoção), disponibilidade, o link e o
 * endereço das fotos (o painel não copia as fotos: o navegador mostra direto do site; só endereços https dos
 * servidores de imagem conhecidos, `HOSTS_FOTO`, os mesmos liberados no cabeçalho de segurança do painel).
 * A comparação com os preços das lojas é feita no navegador, com as vendas. */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const SITE = 'https://www.teashop.com.br';
// servidores de onde o painel aceita mostrar foto de produto (têm de estar também no img-src do cabeçalho de segurança, server.js)
const HOSTS_FOTO = ['cdn.shopify.com', 'www.teashop.com.br'];
const MAX_FOTOS = 4;
/** endereço de foto aceito: https, sem usuário/porta, de um servidor conhecido e de tamanho normal */
function fotoOk(u) {
  if (typeof u !== 'string' || u.length > 400) return false;
  try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.port && HOSTS_FOTO.includes(x.hostname); } catch { return false; }
}
const pasta = () => path.join(C.DATA_DIR, 'site');
const arq = () => path.join(pasta(), 'precos.json');
// histórico: só os pontos em que algo mudou em cada variante — { id: [[data ISO, preço, preço "de" ou null, disponível 1/0], …] }
// preço null = o produto saiu do site naquela consulta
const arqHist = () => path.join(pasta(), 'historico.json');
// as consultas que deram certo (data ISO de cada uma), desde 23/11/2026: separam "nenhuma mudança neste dia" de "sem
// consulta neste dia" no filtro "Mudou em" da tela Site (o histórico só guarda os pontos em que algo mudou)
const arqConsultas = () => path.join(pasta(), 'consultas.json');
const MAX_CONSULTAS = 1500; // ~4 anos de uma consulta por dia
let rodando = null;

function ler() {
  try { return JSON.parse(fs.readFileSync(arq(), 'utf8')); } catch { return null; }
}
function lerConsultas() {
  try { const l = JSON.parse(fs.readFileSync(arqConsultas(), 'utf8')); return Array.isArray(l) ? l.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
/** acrescenta uma consulta à lista (sem repetir; guarda as últimas MAX_CONSULTAS) */
function somarConsulta(lista, em) {
  const l = (lista || []).filter((x) => x !== em);
  l.push(em);
  l.sort((a, b) => Date.parse(a) - Date.parse(b));
  return l.slice(-MAX_CONSULTAS);
}
/** as consultas para a tela: as guardadas + a atual e a anterior de precos.json (das versões de antes da lista) */
function consultasTela(d) {
  const guardadas = lerConsultas();
  let l = guardadas;
  for (const em of [d && d.anterior && d.anterior.em, d && d.em]) if (em && !l.includes(em)) l = somarConsulta(l, em);
  return { consultas: l, consultasDesde: guardadas[0] || null };
}
function lerHist() {
  try { return JSON.parse(fs.readFileSync(arqHist(), 'utf8')); } catch { return null; }
}
/** histórico inicial a partir do que já existia: a consulta anterior guardada (se houver) e a atual */
function semear(d) {
  const hist = {};
  if (!d || !d.em || !d.itens || !d.itens.length) return hist;
  if (d.anterior && d.anterior.em) for (const [id, [preco, de]] of Object.entries(d.anterior.precos || {})) hist[id] = [[d.anterior.em, preco, de ?? null, 1]];
  registrar(hist, d.em, d.itens);
  return hist;
}
/** acrescenta ao histórico os pontos que mudaram nesta consulta */
function registrar(hist, em, itens) {
  const vistos = new Set();
  for (const x of itens) {
    vistos.add(x.id);
    const l = hist[x.id] || (hist[x.id] = []);
    const u = l[l.length - 1];
    const p = [em, x.preco, x.de ?? null, x.disponivel ? 1 : 0];
    if (!u || u[1] !== p[1] || (u[2] ?? null) !== p[2] || u[3] !== p[3]) l.push(p);
  }
  for (const [id, l] of Object.entries(hist)) { const u = l[l.length - 1]; if (!vistos.has(id) && u && u[1] != null) l.push([em, null, null, 0]); }
}

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; };

/** variantes de uma página do catálogo (products.json): preço, link e fotos (a da variante primeiro, depois as do produto) */
function itensDe(ps) {
  const itens = [];
  for (const p of ps || []) {
    const doProd = (Array.isArray(p.images) ? p.images : []).map((i) => i && i.src).filter(fotoOk);
    for (const v of p.variants || []) {
      const preco = num(v.price), de = num(v.compare_at_price);
      if (preco == null) continue;
      const daVar = v.featured_image && fotoOk(v.featured_image.src) ? v.featured_image.src : null;
      const imgs = [...new Set([daVar, ...doProd].filter(Boolean))].slice(0, MAX_FOTOS);
      itens.push({
        id: String(v.id), produto: String(p.title || '').trim(), variante: v.title && v.title !== 'Default Title' ? String(v.title).trim() : '',
        sku: String(v.sku || '').trim(), tipo: String(p.product_type || '').trim(), preco, de: de != null && de > preco + 0.004 ? de : null,
        disponivel: v.available !== false, url: `${SITE}/products/${encodeURIComponent(p.handle)}?variant=${v.id}`,
        ...(imgs.length ? { imgs } : {}),
      });
    }
  }
  return itens;
}

/** fotos por produto, para as listas do painel: [{ s: SKU, n: nome, v: variante, u: link, i: [fotos] }] (só quem tem foto) */
let fotosMemo = null; // { chave, val }
function fotos() {
  let chave = '';
  try { const st = fs.statSync(arq()); chave = `${st.mtimeMs}|${st.size}`; } catch { return { em: null, itens: [] }; }
  if (fotosMemo && fotosMemo.chave === chave) return fotosMemo.val;
  const d = ler() || { itens: [] };
  const val = { em: d.em || null, itens: (d.itens || []).filter((x) => Array.isArray(x.imgs) && x.imgs.some(fotoOk)).map((x) => ({ s: x.sku || '', n: x.produto, v: x.variante || '', u: x.url, i: x.imgs.filter(fotoOk).slice(0, MAX_FOTOS) })) };
  fotosMemo = { chave, val };
  return val;
}

/** baixa o catálogo inteiro (até 40 páginas de 250 produtos) */
async function baixar() {
  const itens = [];
  for (let pag = 1; pag <= 40; pag++) {
    const r = await fetch(`${SITE}/products.json?limit=250&page=${pag}`, { headers: { Accept: 'application/json', 'User-Agent': 'PainelTeaShop/1.0 (consulta de precos 1x por dia)' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`o site respondeu ${r.status} na página ${pag}`);
    const j = await r.json();
    const ps = Array.isArray(j.products) ? j.products : [];
    if (!ps.length) break;
    itens.push(...itensDe(ps));
    if (ps.length < 250) break;
  }
  if (!itens.length) throw new Error('o site não devolveu nenhum produto');
  return itens;
}

/** consulta o site e grava; guarda os preços da consulta anterior para mostrar o que mudou */
async function atualizar(origem, quem) {
  if (rodando) return rodando;
  rodando = (async () => {
    const antes = ler();
    try {
      const itens = await baixar();
      const ant = {};
      if (antes && antes.itens) for (const x of antes.itens) ant[x.id] = [x.preco, x.de];
      const out = { em: new Date().toISOString(), origem, quem: quem || '', itens, anterior: antes && antes.em ? { em: antes.em, precos: ant } : null };
      fs.mkdirSync(pasta(), { recursive: true });
      // histórico: começa pela consulta que já existia (a primeira, antes do histórico) e soma esta
      let hist = lerHist();
      if (!hist) hist = semear(antes);
      registrar(hist, out.em, itens);
      C.gravarAtomico(arqHist(), JSON.stringify(hist), 0o640);
      C.gravarAtomico(arqConsultas(), JSON.stringify(somarConsulta(lerConsultas(), out.em)), 0o640);
      C.gravarAtomico(arq(), JSON.stringify(out), 0o640);
      console.log(`[site] ${itens.length} variantes lidas (${origem})`);
      return { ok: true, n: itens.length, em: out.em };
    } catch (e) {
      console.error('[site] falhou:', e.message);
      const out = { ...(antes || { itens: [] }), erro: { em: new Date().toISOString(), msg: e.message, origem } };
      try { fs.mkdirSync(pasta(), { recursive: true }); C.gravarAtomico(arq(), JSON.stringify(out), 0o640); } catch { /* ok */ }
      return { ok: false, erro: e.message };
    } finally { rodando = null; }
  })();
  return rodando;
}

/** hora e dia em Brasília */
function agoraBR() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: +p.hour % 24, min: +p.minute };
}
const diaBR = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/** todo dia às 10h; se o servidor estava desligado às 10h, consulta assim que subir (depois das 10h) */
function agendar() {
  const tick = () => {
    const a = agoraBR();
    if (a.hora < 10) return;
    const d = ler();
    const ult = d && d.em ? diaBR(d.em) : null, ultErro = d && d.erro ? diaBR(d.erro.em) : null;
    if (ult === a.dia) return;
    // se falhou hoje, tenta de novo de hora em hora
    if (ultErro === a.dia && Date.now() - Date.parse(d.erro.em) < 3600e3) return;
    atualizar('agendada');
  };
  setTimeout(tick, 20e3).unref();
  setInterval(tick, 60e3).unref();
}

module.exports = { ler, lerHist, lerConsultas, somarConsulta, consultasTela, atualizar, agendar, rodando: () => !!rodando, semear, fotos, fotoOk, itensDe, HOSTS_FOTO };
