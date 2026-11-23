/* Grupo do produto no AppNext — a definição única, usada em todas as telas que listam produtos.
 * É o grupo com que o produto sai nas vendas (ex.: CHÁ VERDE AROMATIZADO); o "grupo das Vendas" é o agrupamento do
 * filtro das Vendas (CHÁ AROMATIZADO). Um produto pode aparecer em mais de um grupo (o chá a granel sai em vários
 * pacotes e em minitin): vale o que mais aparece nas vendas.
 * Como acha: pelo código vendido; no chá a granel (item em kg do estoque), pelos pacotes dele (código da matéria-prima +
 * dígito do tamanho, ou "cod.50g", só as vendas que contam como chá: sachê, caixa e Tea Moments não); por último, pelo nome. Sem venda nenhuma devolve null (a tela mostra o grupo do
 * cadastro de preços, se tiver). Conta pura (tests/unit/grupoprod.test.js); não toca na página. */
(function () {
  'use strict';
  const ESQ = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /** índice das vendas: db do painel (colunas db.cod, db.desc, db.prod, db.grupo, db.grupoC e os dicionários db.D) */
  function montar(db) {
    const porCod = new Map(), porBase = new Map(), porNome = new Map(), paraVendas = new Map();
    const chaveG = (g) => String(g ?? '').trim().toUpperCase();
    const D = (db && db.D) || {};
    const soma = (mapa, k, g, gc, n) => {
      if (!k) return;
      const m = mapa.get(k) || mapa.set(k, new Map()).get(k), x = m.get(g);
      if (x) x[0] += n; else m.set(g, [n, gc]);
    };
    if (db && db.n && db.grupo) {
      // primeiro junta as linhas iguais (mesmo código, descrição, produto e grupo): o resto é feito uma vez por combinação
      const combos = new Map();
      for (let i = 0; i < db.n; i++) {
        const k = `${db.cod ? db.cod[i] : ''}|${db.desc ? db.desc[i] : ''}|${db.prod ? db.prod[i] : ''}|${db.grupo[i]}`;
        const c = combos.get(k);
        if (c) c.n++; else combos.set(k, { i, n: 1 });
      }
      for (const { i, n } of combos.values()) {
        const g = D.grupo ? D.grupo[db.grupo[i]] : '';
        if (!g) continue;
        const gc = (D.grupoC && db.grupoC ? D.grupoC[db.grupoC[i]] : '') || g;
        soma(paraVendas, chaveG(g), gc, gc, n); // grupo do AppNext → grupo do filtro das Vendas (o que mais aparece)
        const cod = D.cod && db.cod ? String(D.cod[db.cod[i]] ?? '') : '';
        if (cod) {
          soma(porCod, cod, g, gc, n);
          // pacote DE CHÁ do granel: código + dígito do tamanho (270101) ou "cod.50g", vendido como chá (kg de chá na venda).
          // Sachê (29114.I), caixa de sachês (29114.CX) e lata Tea Moments (29114.40G) começam com o mesmo código mas não são
          // pacote do chá: em Torres, que vende mais sachê, o 29114 aparecia como SACHÊS PIRAMIDAIS (visto pelo dono, 23/11/2026; GRP-06)
          const ehCha = !db.cha || db.cha[i] > 0;
          if (ehCha && /\.\d+\s*g$/i.test(cod)) soma(porBase, cod.split('.')[0], g, gc, n);
          else if (ehCha && /^\d{6,}$/.test(cod)) soma(porBase, cod.slice(0, -1), g, gc, n);
        }
        const nd = D.descricao && db.desc ? ESQ(D.descricao[db.desc[i]]) : '', np = D.produto && db.prod ? ESQ(D.produto[db.prod[i]]) : '';
        soma(porNome, nd, g, gc, n);
        if (np !== nd) soma(porNome, np, g, gc, n);
      }
    }
    const melhor = (m) => {
      if (!m) return null;
      let top = null;
      for (const [g, [n, gc]] of m) if (!top || n > top.n) top = { grupo: g, grupoVendas: gc, n };
      return top && { grupo: top.grupo, grupoVendas: top.grupoVendas };
    };
    /** cod: código do produto (do estoque ou vendido); desc: nome; kg: true quando é chá a granel (item em kg do estoque),
     *  false quando não é; sem informar, tenta o código e depois os pacotes */
    function de(cod, desc, kg) {
      cod = cod == null ? '' : String(cod);
      const n = ESQ(desc);
      return (kg ? melhor(porBase.get(cod)) || melhor(porCod.get(cod)) : melhor(porCod.get(cod)) || (kg == null ? melhor(porBase.get(cod)) : null))
        || (n ? melhor(porNome.get(n)) : null);
    }
    /** grupo do filtro das Vendas de um grupo do AppNext (ex.: do cadastro de preços): CHÁ BRANCO AROMATIZADO → CHÁ AROMATIZADO.
     *  Grupo que nunca apareceu nas vendas devolve '' (a tela põe em "sem grupo"): o filtro só lista grupos que existem nas Vendas. */
    const vendasDe = (grupo) => { const m = melhor(paraVendas.get(chaveG(grupo))); return m ? m.grupo : ''; };
    return { de, vendasDe };
  }

  let memo = null; // { db, idx }: um índice por base carregada
  /** índice da base aberta no painel (refeito quando a base muda) */
  function doPainel() {
    const db = typeof TS !== 'undefined' ? TS.db : null;
    if (!db) return montar(null);
    if (!memo || memo.db !== db) memo = { db, idx: montar(db) };
    return memo.idx;
  }
  /** grupo do produto para mostrar: o das vendas ou, sem venda, o do cadastro de preços (`cadastro`); '' quando não há */
  const texto = (cod, desc, kg, cadastro) => { const g = doPainel().de(cod, desc, kg); return (g && g.grupo) || cadastro || ''; };

  const API = { montar, ESQ };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  const DICA = 'Grupo do produto no AppNext, como ele sai nas vendas (no chá a granel, o dos pacotes dele). Produto que ainda não vendeu mostra o grupo do cadastro de preços, se tiver.';
  /** linha pequena com o grupo, para pôr embaixo do nome do produto (null quando não há grupo) */
  const marca = (g) => (g ? TS.h('small', { class: 'est-tam grp-prod', title: DICA }, g) : null);
  /** devolve a coluna do nome com o grupo embaixo; `grupoDe(linha)` dá o texto do grupo */
  const coluna = (col, grupoDe) => ({ ...col, render: (r) => { const el = col.render ? col.render(r) : r[col.key], m = marca(grupoDe(r)); return m ? TS.h('span', null, el, m) : el; } });
  TS.grupoProd = { ...API, de: (cod, desc, kg) => doPainel().de(cod, desc, kg), vendasDe: (g) => doPainel().vendasDe(g), texto, marca, coluna, DICA };
})();
