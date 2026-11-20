'use strict';
/**
 * Caixa a pagar (Resultado → A pagar): o servidor só guarda o que foi marcado como PAGO, por loja, e conta quanto das
 * vendas é cartão (pelos fechamentos de caixa). O calendário em si é montado na tela (public/js/apagar.js) com o que
 * /api/estoque e /api/estoque/notas já entregam a quem vê custo.
 *   dados/<loja>/a-pagar.json  { pagos: { id: { em, por, nome, valor, vence } } }
 * id = "<origem>|<nome ou número>|<mês>" (fixo, pontual, nota, royalties, simples), montado pela conta da tela.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const ID_OK = /^(fixo|pontual|nota|royalties|simples)\|[a-z0-9|-]{1,90}$/;
const GUARDA_DIAS = 400; // marcas de contas vencidas há mais de um ano saem sozinhas
const arq = (id) => path.join(C.pastaLoja(id), 'a-pagar.json');
function ler(id) {
  try { const j = JSON.parse(fs.readFileSync(arq(id), 'utf8')); return { pagos: j.pagos && typeof j.pagos === 'object' ? j.pagos : {} }; } catch { return { pagos: {} }; }
}
const menosDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);

/** marca (ou desmarca) uma conta como paga. b: { id, pago, nome, valor, vence } → { ok: { pagos } } | { erro } */
function marcar(id, b, por, hoje = C.diaSP()) {
  const item = String((b && b.id) || '');
  if (!ID_OK.test(item)) return { erro: 'Conta inválida.' };
  const d = ler(id);
  if (b.pago) {
    const vence = /^\d{4}-\d{2}-\d{2}$/.test(String(b.vence || '')) ? b.vence : null;
    const valor = Math.round(Number(b.valor) * 100) / 100;
    if (!vence || !(valor > 0 && valor <= 100000000)) return { erro: 'Conta inválida.' };
    d.pagos[item] = { em: new Date().toISOString(), por: String(por || '').slice(0, 60), nome: String(b.nome || '').replace(/[\r\n]/g, ' ').trim().slice(0, 120), valor, vence };
  } else delete d.pagos[item];
  const corte = menosDias(hoje, GUARDA_DIAS);
  for (const [k, v] of Object.entries(d.pagos)) if (!v || !v.vence || v.vence < corte) delete d.pagos[k];
  if (Object.keys(d.pagos).length > 5000) return { erro: 'Há contas demais marcadas nesta loja.' };
  fs.mkdirSync(C.pastaLoja(id), { recursive: true });
  C.gravarAtomico(arq(id), JSON.stringify(d), 0o640);
  return { ok: d };
}

/**
 * Quanto das vendas é cartão (crédito + débito), pelos fechamentos de caixa dos últimos `dias` dias.
 * fechamentos: os do AppNext ([{ dia, fechamento, recebimentos: [{ forma, venda }] }]).
 * → { pct (0 a 1), dias (dias com fechamento), total } ou null quando não há fechamento com vendas no período
 */
function parteCartao(fechamentos, hoje, dias = 60) {
  const de = menosDias(hoje, dias);
  let cartao = 0, total = 0;
  const vistos = new Set();
  for (const f of fechamentos || []) {
    if (!f || !f.fechamento || !f.dia || f.dia < de || f.dia > hoje) continue;
    for (const r of f.recebimentos || []) {
      const v = Number(r.venda) || 0;
      if (!(v > 0)) continue;
      total += v; vistos.add(f.dia);
      if (/cr[eé]dito|d[eé]bito/i.test(r.forma || '')) cartao += v;
    }
  }
  if (!(total > 0)) return null;
  return { pct: Math.round((cartao / total) * 10000) / 10000, dias: vistos.size, total: Math.round(total * 100) / 100 };
}

module.exports = { ler, marcar, parteCartao, ID_OK };
