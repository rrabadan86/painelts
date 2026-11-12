'use strict';
/**
 * Gera demo/perfil.json a partir das vendas reais de UMA loja: catálogo de produtos,
 * cestas de compra (itens por cupom), sazonalidade e ritmo de vendas.
 * NÃO guarda vendedores, clientes, CPFs nem nomes de loja.
 *   node scripts/demo-perfil.js <idLoja>
 */
const fs = require('fs');
const path = require('path');
const C = require('../src/config');
const { loadLoja } = require('../src/sources');

(async () => {
  const id = process.argv[2];
  const loja = C.get().lojas.find((l) => l.id === id);
  if (!loja) { console.error('loja não encontrada'); process.exit(1); }
  const { vendas } = await loadLoja(loja);
  const prod = new Map(), produtos = [];
  const pid = (r) => {
    let i = prod.get(r.descricao);
    if (i === undefined) { i = produtos.length; prod.set(r.descricao, i); produtos.push([r.descricao, r.produto, r.grupo, r.grupoC, r.cat, r.subgrupo, r.soNumeros]); }
    return i;
  };
  const cupons = new Map();
  for (const r of vendas) {
    const k = r.cupom;
    let c = cupons.get(k);
    if (!c) cupons.set(k, (c = { d: r.data, it: [] }));
    c.it.push([pid(r), r.qtd, r.vu, r.du, r.vt, r.qtdCha]);
  }
  const cestas = [...cupons.values()].map((c) => [c.d, c.it]);
  // ritmo: cupons por dia (só dias com venda), por mês do ano e por dia da semana
  const porDia = new Map();
  for (const c of cupons.values()) porDia.set(c.d, (porDia.get(c.d) || 0) + 1);
  const mes = Array(12).fill(0).map(() => [0, 0]), sem = Array(7).fill(0).map(() => [0, 0]);
  for (const [d, n] of porDia) {
    const dt = new Date(d + 'T00:00:00Z');
    mes[dt.getUTCMonth()][0] += n; mes[dt.getUTCMonth()][1]++;
    sem[dt.getUTCDay()][0] += n; sem[dt.getUTCDay()][1]++;
  }
  const media = [...porDia.values()].reduce((s, n) => s + n, 0) / porDia.size;
  const out = {
    geradoEm: new Date().toISOString(),
    cuponsPorDia: +media.toFixed(2),
    sazonalidade: mes.map(([s, n]) => +(n ? s / n / media : 1).toFixed(3)),
    semana: sem.map(([s, n]) => +(n ? s / n / media : 1).toFixed(3)),
    produtos, cestas,
  };
  const file = path.join(__dirname, '..', 'demo', 'perfil.json');
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`perfil: ${produtos.length} produtos, ${cestas.length} cestas, ${media.toFixed(1)} cupons/dia → ${file} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
})();
