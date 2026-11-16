/* Preços do e-commerce (www.teashop.com.br, loja Shopify): lê o catálogo público (/products.json) uma vez por dia
 * às 10h (horário de Brasília) e quando alguém pede "Consultar agora". Guarda em dados/site/precos.json só o que é
 * público no site: produto, variante, SKU, preço, preço "de" (quando está em promoção), disponibilidade e o link.
 * A comparação com os preços das lojas é feita no navegador, com as vendas. */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const SITE = 'https://www.teashop.com.br';
const pasta = () => path.join(C.DATA_DIR, 'site');
const arq = () => path.join(pasta(), 'precos.json');
let rodando = null;

function ler() {
  try { return JSON.parse(fs.readFileSync(arq(), 'utf8')); } catch { return null; }
}

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; };

/** baixa o catálogo inteiro (até 40 páginas de 250 produtos) */
async function baixar() {
  const itens = [];
  for (let pag = 1; pag <= 40; pag++) {
    const r = await fetch(`${SITE}/products.json?limit=250&page=${pag}`, { headers: { Accept: 'application/json', 'User-Agent': 'PainelTeaShop/1.0 (consulta de precos 1x por dia)' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`o site respondeu ${r.status} na página ${pag}`);
    const j = await r.json();
    const ps = Array.isArray(j.products) ? j.products : [];
    if (!ps.length) break;
    for (const p of ps) {
      for (const v of p.variants || []) {
        const preco = num(v.price), de = num(v.compare_at_price);
        if (preco == null) continue;
        itens.push({
          id: String(v.id), produto: String(p.title || '').trim(), variante: v.title && v.title !== 'Default Title' ? String(v.title).trim() : '',
          sku: String(v.sku || '').trim(), tipo: String(p.product_type || '').trim(), preco, de: de != null && de > preco + 0.004 ? de : null,
          disponivel: v.available !== false, url: `${SITE}/products/${encodeURIComponent(p.handle)}?variant=${v.id}`,
        });
      }
    }
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
      fs.writeFileSync(arq() + '.tmp', JSON.stringify(out));
      fs.renameSync(arq() + '.tmp', arq());
      console.log(`[site] ${itens.length} variantes lidas (${origem})`);
      return { ok: true, n: itens.length, em: out.em };
    } catch (e) {
      console.error('[site] falhou:', e.message);
      const out = { ...(antes || { itens: [] }), erro: { em: new Date().toISOString(), msg: e.message, origem } };
      try { fs.mkdirSync(pasta(), { recursive: true }); fs.writeFileSync(arq(), JSON.stringify(out)); } catch { /* ok */ }
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
  setTimeout(tick, 20e3);
  setInterval(tick, 60e3);
}

module.exports = { ler, atualizar, agendar, rodando: () => !!rodando };
