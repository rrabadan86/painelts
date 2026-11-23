'use strict';
/**
 * Perdas do mês para o Resultado (linha "− Perdas"): o que a loja pagou e não vai vender.
 *  1. Lote VENCIDO que ainda está no estoque (chá a granel, envasado e alimentação): saldo do lote × custo (do kg no granel,
 *     da unidade no envasado e na alimentação), no mês em que a validade venceu (lotes de src/lotes.js — os da tela Validade).
 *  2. Faltas do INVENTÁRIO: contagens aplicadas no AppNext (st "importado", não desfeitas) no mês, pelo ajuste a custo
 *     (contado − sistema) × custo. As contagens do mês são somadas (sobra de uma compensa falta de outra — produto
 *     trocado na prateleira não é perda); só o saldo NEGATIVO do mês vira perda. Mês com sobra líquida = perda zero.
 * Conta pura: recebe os lotes e o resumo das contagens (INV.lista) e devolve por mês. Sem custo no AppNext o lote entra
 * com zero e é contado em `semCusto`. O lote vencido que depois é zerado no inventário sai do item 1 (não está mais no
 * estoque) e passa a aparecer no item 2, no mês do inventário: nunca nos dois ao mesmo tempo depois de o estoque atualizar.
 */
const r2 = (v) => Math.round(v * 100) / 100;
const diaSP = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const novo = () => ({ vencidos: 0, nVencidos: 0, kgVencidos: 0, unVencidos: 0, semCusto: 0, inventario: 0, ajusteInv: 0, faltasInv: 0, sobrasInv: 0, nContagens: 0, total: 0 });

/**
 *   lotes      [{ validade: 'AAAA-MM-DD', dias (negativo = vencido), saldo (kg ou un), un ('kg' | 'un'), custoKg (custo da unidade do lote) }]
 *   contagens  [{ st, importadoEm, revertidoEm, ajuste (R$ a custo; negativo = faltou) }]
 * → { 'AAAA-MM': { vencidos, nVencidos, kgVencidos, unVencidos, semCusto, inventario, ajusteInv, faltasInv, sobrasInv, nContagens, total } }
 *   (só os meses com algum lote vencido ou contagem aplicada)
 */
function porMes({ lotes, contagens }) {
  const out = {};
  const mes = (ym) => out[ym] || (out[ym] = novo());
  for (const l of lotes || []) {
    // venceu pela data que chegou primeiro (pacote ou 6 meses depois de aberto); pela abertura, só o que está na lata é perda
    const venceu = l && (l.venceEm || l.validade), kg = l && (l.kgVence ?? l.saldo);
    if (!l || l.dias == null || !(l.dias < 0) || !venceu || !(kg > 0)) continue;
    const m = mes(String(venceu).slice(0, 7));
    m.nVencidos++; if (l.un === 'un') m.unVencidos += kg; else m.kgVencidos += kg;
    if (l.custoKg > 0) m.vencidos += kg * l.custoKg; else m.semCusto++;
  }
  for (const c of contagens || []) {
    if (!c || c.st !== 'importado' || !c.importadoEm || c.revertidoEm || c.ajuste == null || !Number.isFinite(+c.ajuste)) continue;
    const m = mes(diaSP(c.importadoEm).slice(0, 7));
    m.nContagens++; m.ajusteInv += +c.ajuste;
    if (c.ajuste < 0) m.faltasInv += -c.ajuste; else m.sobrasInv += +c.ajuste;
  }
  for (const m of Object.values(out)) {
    m.inventario = r2(Math.max(0, -m.ajusteInv));
    m.vencidos = r2(m.vencidos); m.kgVencidos = Math.round(m.kgVencidos * 1000) / 1000;
    m.ajusteInv = r2(m.ajusteInv); m.faltasInv = r2(m.faltasInv); m.sobrasInv = r2(m.sobrasInv);
    m.total = r2(m.vencidos + m.inventario);
  }
  return out;
}

/** contagens fictícias da apresentação: uma por mês nos últimos 4 meses, com falta pequena (uma delas com sobra) */
function contagensDemo(lojaId, hojeIso) {
  const semente = [...String(lojaId)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const out = [];
  for (let k = 0; k < 4; k++) {
    const d = new Date(Date.UTC(+hojeIso.slice(0, 4), +hojeIso.slice(5, 7) - 1 - k, 10, 15));
    if (d.toISOString().slice(0, 10) > hojeIso) d.setUTCDate(1);
    const v = 60 + ((semente * (k + 3)) % 9) * 35;
    out.push({ st: 'importado', importadoEm: d.toISOString(), revertidoEm: null, ajuste: k === 2 ? 45 : -v });
    if (k === 0) out.push({ st: 'importado', importadoEm: d.toISOString(), revertidoEm: null, ajuste: 25 });
  }
  return out;
}

module.exports = { porMes, contagensDemo };
