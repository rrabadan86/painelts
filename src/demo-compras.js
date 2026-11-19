'use strict';
/**
 * Apresentação: notas de compra FICTÍCIAS dos meses anteriores, para o "Compras × vendas" (Pedido e Resultado)
 * ter o ano inteiro para mostrar. As compras recentes da apresentação (src/demo.js) continuam como estão; aqui entram
 * só os meses antes delas: uma nota por mês, repondo o que cada produto vendeu naquele mês (um pouco a mais ou a menos),
 * pelo custo que o histórico fictício tinha na data. Nada é gravado.
 */
const ymMais = (ym, n) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);

/** compras: as da apresentação; estoque: itens fictícios; historico: custos por código; vendas: linhas de venda da loja */
function comprasDoAno(compras, estoque, historico, vendas, meses = 12) {
  const itens = { ...((compras && compras.itens) || {}) };
  const datas = Object.values(itens).flat().map((l) => l[0]).sort();
  if (!datas.length || !vendas || !vendas.length) return compras;
  const primeiroMes = datas[0].slice(0, 7), hojeYm = vendas[vendas.length - 1].data.slice(0, 7);
  const porCod = new Map((estoque.itens || []).map((i) => [i.cod, i]));
  const porNome = new Map((estoque.itens || []).map((i) => [(i.un === 'Kg' ? 'kg|' : 'un|') + i.desc, i]));
  // quanto cada item vendeu em cada mês (chá a granel em kg)
  const vendido = new Map();
  const de = ymMais(hojeYm, -(meses - 1));
  for (const v of vendas) {
    const ym = v.data.slice(0, 7);
    if (ym < de || ym >= primeiroMes || (v.vu != null && v.vu < 0.05)) continue;
    const kg = !!v.soNumeros;
    const it = porNome.get((kg ? 'kg|' : 'un|') + (kg ? v.produto : v.descricao));
    if (!it || !(it.custo > 0)) continue;
    const k = ym + '|' + it.cod;
    vendido.set(k, (vendido.get(k) || 0) + (kg ? (v.qtd * v.soNumeros) / 1000 : v.qtd));
  }
  const custoEm = (cod, dia, atual) => { let c = null; for (const [d, v] of (historico || {})[cod] || []) { if (d <= dia) c = v; else break; } return c ?? atual; };
  const mesesNovos = new Set();
  for (const [k, q] of vendido) {
    const [ym, cod] = k.split('|');
    const it = porCod.get(cod);
    const mes = +ym.slice(5, 7);
    const fator = 0.8 + ((mes * 7) % 5) * 0.12; // 0,80 a 1,28: uns meses compram mais do que vendem, outros menos
    const qtd = it.un === 'Kg' ? Math.round(q * fator * 10) / 10 : Math.round(q * fator);
    if (!(qtd > 0)) continue;
    const dia = `${ym}-08`;
    itens[cod] = [[dia, custoEm(cod, dia, it.custo), 500 + +ym.slice(2, 4) * 12 + mes, qtd, 'Distribuidora Fictícia de Chás'], ...(itens[cod] || [])];
    mesesNovos.add(ym);
  }
  for (const l of Object.values(itens)) l.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { ...compras, desde: `${de}-01`, notas: (compras.notas || 0) + mesesNovos.size, itens };
}

module.exports = { comprasDoAno };
