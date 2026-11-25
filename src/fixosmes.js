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
const CT = require('../public/js/contas');

const YM = /^20\d\d-(0[1-9]|1[0-2])$/;
/** linhas CALCULADAS do Resultado que também aceitam o valor real do mês (pedido do dono, 23/11/2026: "eu não consigo editar
 *  Simples Nacional? Royalties? MKT? Deveria poder"): o valor lançado substitui o calculado pelo % naquele mês (DRE-CALC-01) */
const CALC = { '@simples': 'Simples Nacional', '@maquininha': 'Maquininha', '@royalties': 'Royalties', '@marketing': 'Marketing', '@financeiro': 'Resultado financeiro' };
// resultado financeiro (DRE-FIN-01): o único que aceita valor negativo (juros e tarifas pagos); positivo = rendimentos
const COM_SINAL = new Set(['@financeiro']);
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
  if (!nome || (!CALC[nome] && !(fixos || []).some((x) => x && x.tipo === 'mes' && x.nome === nome))) return { erro: 'Esse custo fixo não existe mais em Configurações. Atualize a página.' };
  if (b.padrao) return { ok: { nome, ym, valor: null } };
  const bruto = b.valor;
  const valor = typeof bruto === 'number' ? bruto : Number(String(bruto ?? '').trim());
  if (bruto === '' || bruto == null || !Number.isFinite(valor) || valor < (COM_SINAL.has(nome) ? -MAX_VALOR : 0) || valor > MAX_VALOR) return { erro: COM_SINAL.has(nome) ? 'Digite o valor do mês em reais: negativo para juros e tarifas, positivo para rendimentos.' : 'Digite o valor do mês em reais (zero ou mais).' };
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

/**
 * Novo valor de um custo fixo com a escolha de onde vale (FIXO-ESC-01, pedido do dono de 25/11/2026):
 * b.escopo 'mes' = só aquele mês (o lançar de sempre); 'diante' = daquele mês em diante; 'todos' = todos os meses.
 * 'diante' e 'todos' mudam o padrão de Configurações: devolve { padrao } para o servidor gravar na loja.
 * A conta é uma só (TS.contas.aplicarFixo, public/js/contas.js). → { ok: { despesas }, valor, padrao? } | { erro }
 */
function aplicar(id, b, fixos, por, hoje = C.diaSP()) {
  const escopo = (b && b.escopo) || 'mes';
  if (escopo === 'mes' || b.padrao) return lancar(id, b, fixos, por, hoje);
  if (escopo !== 'diante' && escopo !== 'todos') return { erro: 'Escolha onde o novo valor vale.' };
  const v = validar(b, fixos, hoje);
  if (v.erro) return v;
  const { nome, ym, valor } = v.ok;
  if (CALC[nome]) return { erro: 'Esta linha é calculada: o valor real vale só para o mês.' };
  const despesa = fixos.find((x) => x && x.tipo === 'mes' && x.nome === nome);
  const d = ler(id);
  const r = CT.aplicarFixo(despesa, d.despesas, ym, valor, escopo);
  const quem = { por: String(por || '').slice(0, 60), em: new Date().toISOString() };
  const meses = r.lancados[nome];
  if (meses && Array.isArray(meses['@ate'])) {
    if (meses['@ate'].length > 120) return { erro: 'Há mudanças de padrão demais neste custo.' };
    meses['@ate'] = meses['@ate'].map((e) => ({ ...quem, ...e }));
  }
  fs.mkdirSync(C.pastaLoja(id), { recursive: true });
  C.gravarAtomico(arq(id), JSON.stringify({ despesas: r.lancados }), 0o640);
  return { ok: { despesas: r.lancados }, valor, padrao: r.padrao };
}

module.exports = { ler, validar, lancar, aplicar, YM, CALC };
