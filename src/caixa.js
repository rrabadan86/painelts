'use strict';
/**
 * Fechamento de caixa (AppNext → Vendas → Fechamentos de PDV), coletado pelo robô em
 * dados/<loja>/caixa/fechamentos.json. Vai junto do e-mail do fechamento do dia.
 *
 * Contas (iguais à planilha que as lojas preenchiam à mão):
 *  - formas de pagamento = valor vendido em cada forma no sistema
 *  - suprimento / sangria = movimentos do dia, sem as reservas automáticas de abertura e fechamento
 *  - abertura do caixa = fundo de caixa na abertura (primeiro caixa do dia)
 *  - fechamento do caixa = valor deixado no caixa ao fechar (reserva do último caixa do dia)
 *  - deveria ter em caixa = abertura + vendas em dinheiro + suprimentos − sangrias
 *  - diferença = fechamento − deveria ter (positivo = sobrou, negativo = faltou)
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const arq = (id) => path.join(C.pastaLoja(id), 'caixa', 'fechamentos.json');
function ler(id) {
  try { return JSON.parse(fs.readFileSync(arq(id), 'utf8')); } catch { return { fechamentos: [] }; }
}

const FORMAS = [
  ['credito', 'Cartão de crédito', /cr[eé]dito/i],
  ['debito', 'Cartão de débito', /d[eé]bito/i],
  ['dinheiro', 'Dinheiro', /dinheiro/i],
  ['ecommerce', 'Ecommerce', /e-?\s?commerce/i],
  ['troca', 'Troca', /troca/i],
  ['pix', 'Pix', /pix/i],
];
const r2 = (x) => Math.round((x || 0) * 100) / 100;

/** resumo do caixa de um dia (AAAA-MM-DD); null se não há fechamento no dia */
function doDia(id, dia) {
  const j = ler(id);
  const fs_ = (j.fechamentos || []).filter((f) => f.dia === dia && f.fechamento).sort((a, b) => (a.abertura || '').localeCompare(b.abertura || ''));
  if (!fs_.length) return { dia, vazio: true, atualizado: j.atualizado || null };
  const formas = FORMAS.map(([k, rot]) => ({ k, rot, valor: 0, informado: 0, dif: 0 }));
  const extras = new Map();
  let sup = 0, sang = 0, din = 0;
  const movs = [];
  for (const f of fs_) {
    for (const r of f.recebimentos || []) {
      const def = FORMAS.find(([, , re]) => re.test(r.forma));
      let alvo = def ? formas.find((x) => x.k === def[0]) : extras.get(r.forma);
      if (!alvo) { alvo = { k: 'x', rot: r.forma, valor: 0, informado: 0, dif: 0 }; extras.set(r.forma, alvo); }
      alvo.valor += r.venda || 0; alvo.informado += r.informado || 0; alvo.dif += r.dif || 0;
      if (def && def[0] === 'dinheiro') din += r.venda || 0;
    }
    for (const m of f.suprimentos || []) if (!m.reserva) { sup += m.valor || 0; movs.push({ tipo: 'Suprimento', ...m }); }
    for (const m of f.sangrias || []) if (!m.reserva) { sang += m.valor || 0; movs.push({ tipo: 'Sangria', ...m }); }
  }
  const lista = [...formas, ...[...extras.values()].filter((x) => x.valor || x.informado)].map((x) => ({ ...x, valor: r2(x.valor), informado: r2(x.informado), dif: r2(x.dif) }));
  // agrupa por PDV para somar corretamente múltiplos caixas e variações de fundo entre turnos
  const porPdv = new Map();
  for (const f of fs_) {
    const k = String(f.pdv ?? 'unico');
    let arr = porPdv.get(k);
    if (!arr) porPdv.set(k, (arr = []));
    arr.push(f);
  }
  let aberturaSoma = 0, fechamentoSoma = 0, ajusteTurnos = 0;
  for (const sessoes of porPdv.values()) {
    aberturaSoma += sessoes[0].fundoInicial || 0;
    fechamentoSoma += sessoes[sessoes.length - 1].reserva || 0;
    for (let i = 1; i < sessoes.length; i++) {
      if (sessoes[i].fundoInicial != null && sessoes[i - 1].reserva != null) {
        ajusteTurnos += (sessoes[i].fundoInicial || 0) - (sessoes[i - 1].reserva || 0);
      }
    }
  }
  const abertura = r2(aberturaSoma);
  const fechamento = r2(fechamentoSoma);
  const ajusteEntreTurnos = r2(ajusteTurnos);
  const deveria = r2(abertura + ajusteEntreTurnos + din + sup - sang);
  return {
    dia, vazio: false, atualizado: j.atualizado || null,
    caixas: fs_.map((f) => ({ numero: f.numero, pdv: f.pdv, turno: f.turno, abertura: f.abertura, fechamento: f.fechamento, operador: f.opFechamento || f.opAbertura })),
    formas: lista, totalVendas: r2(lista.reduce((s, x) => s + x.valor, 0)),
    suprimento: r2(sup), sangria: r2(sang), abertura, fechamento, ajusteEntreTurnos, deveria, diferenca: r2(fechamento - deveria),
    difAppNext: r2(fs_.reduce((s, f) => s + (f.difVendas || 0), 0)),
    movimentos: movs.sort((a, b) => (a.hora || '').localeCompare(b.hora || '')),
  };
}

module.exports = { ler, doDia };
