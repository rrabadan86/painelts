'use strict';
/**
 * Valor real de cada custo fixo por mês (Resultado: pedido do dono, 23/11/2026 — "eu coloco uma despesa fixa, mas acaba
 * variando um pouco; é interessante manter o histórico de gasto de cada uma com exatidão").
 *   dados/<loja>/fixos-mes.json  { despesas: { '<nome do custo>': { 'AAAA-MM': { valor, por, em } } } }
 * O valor de Configurações (estoqueCfg.outros, tipo 'mes') continua sendo o PADRÃO: vale para todo mês sem valor lançado.
 * O lançado aqui vale só para aquele mês e não muda quando o padrão muda. A conta (qual valor vale em cada mês) é uma só:
 * TS.contas.fixoDoMes (public/js/contas.js). Aqui só se guarda e se confere.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const YM = /^20\d\d-(0[1-9]|1[0-2])$/;
const MAX_VALOR = 10000000;
const arq = (id) => path.join(C.pastaLoja(id), 'fixos-mes.json');

function ler(id) {
  try {
    const j = JSON.parse(fs.readFileSync(arq(id), 'utf8'));
    return { despesas: j && j.despesas && typeof j.despesas === 'object' ? j.despesas : {} };
  } catch { return { despesas: {} }; }
}

const ymMais = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/**
 * Confere o pedido (sem gravar). b: { nome, ym, valor } para lançar ou { nome, ym, padrao: true } para voltar ao padrão.
 * fixos: os custos em R$ por mês da loja (Configurações). hoje: AAAA-MM-DD.
 * → { ok: { nome, ym, valor | null } } | { erro }
 */
function validar(b, fixos, hoje) {
  const nome = String((b && b.nome) || '').trim();
  const ym = String((b && b.ym) || '');
  if (!YM.test(ym)) return { erro: 'Mês inválido.' };
  if (ym > ymMais(String(hoje || '').slice(0, 7), 12)) return { erro: 'Só dá para lançar até 12 meses à frente.' };
  if (!nome || !(fixos || []).some((x) => x && x.tipo === 'mes' && x.nome === nome)) return { erro: 'Esse custo fixo não existe mais em Configurações. Atualize a página.' };
  if (b.padrao) return { ok: { nome, ym, valor: null } };
  const bruto = b.valor;
  const valor = typeof bruto === 'number' ? bruto : Number(String(bruto ?? '').trim());
  if (bruto === '' || bruto == null || !Number.isFinite(valor) || valor < 0 || valor > MAX_VALOR) return { erro: 'Digite o valor do mês em reais (zero ou mais).' };
  return { ok: { nome, ym, valor: Math.round(valor * 100) / 100 } };
}

/** grava (ou apaga, com valor null) o valor de um mês. → { ok: { despesas } } | { erro } */
function lancar(id, b, fixos, por, hoje = C.diaSP()) {
  const v = validar(b, fixos, hoje);
  if (v.erro) return v;
  const d = ler(id);
  const { nome, ym, valor } = v.ok;
  if (valor == null) {
    if (d.despesas[nome]) { delete d.despesas[nome][ym]; if (!Object.keys(d.despesas[nome]).length) delete d.despesas[nome]; }
  } else {
    const meses = d.despesas[nome] || (d.despesas[nome] = {});
    if (!meses[ym] && Object.keys(meses).length >= 240) return { erro: 'Há meses demais lançados neste custo.' };
    meses[ym] = { valor, por: String(por || '').slice(0, 60), em: new Date().toISOString() };
  }
  if (Object.keys(d.despesas).length > 200) return { erro: 'Há custos demais com valor lançado nesta loja.' };
  fs.mkdirSync(C.pastaLoja(id), { recursive: true });
  C.gravarAtomico(arq(id), JSON.stringify(d), 0o640);
  return { ok: d, valor };
}

module.exports = { ler, validar, lancar, YM };
