'use strict';
/**
 * Orçamentos para empresas (só admin e franqueado): cliente, itens com preço e desconto, situação.
 *   dados/<loja>/orcamentos/<id>.json   um por orçamento
 *   dados/<loja>/orcamentos/seq.json    { n } numeração da loja (Orçamento nº 1, 2, …)
 * O custo de cada item é guardado no momento em que o orçamento é salvo (para a margem não mudar depois que a
 * franquia reajustar o custo); a margem é recalculada na tela com as deduções da loja.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');

const pasta = (id) => path.join(C.pastaLoja(id), 'orcamentos');
const ID = /^[a-f0-9]{12}$/;
const SIT = ['rascunho', 'enviado', 'aprovado', 'perdido'];
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const num = (v, min, max) => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) && x >= min && x <= max ? Math.round(x * 10000) / 10000 : null; };
const lerJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

function ler(id, oid) { return ID.test(String(oid)) ? lerJ(path.join(pasta(id), oid + '.json'), null) : null; }
function lista(id) {
  let fs0 = [];
  try { fs0 = fs.readdirSync(pasta(id)).filter((f) => /^[a-f0-9]{12}\.json$/.test(f)); } catch { return []; }
  return fs0.map((f) => lerJ(path.join(pasta(id), f), null)).filter(Boolean).sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
}
function proximoNumero(id) {
  const f = path.join(pasta(id), 'seq.json');
  const n = (lerJ(f, { n: 0 }).n || 0) + 1;
  C.gravarAtomico(f, JSON.stringify({ n }), 0o640);
  return n;
}

/** limpa o que veio da tela; devolve { erro } ou o orçamento */
function normalizar(b) {
  const cli = b.cliente || {};
  const cliente = { empresa: txt(cli.empresa, 120), contato: txt(cli.contato, 80), doc: txt(cli.doc, 20).replace(/[^\d./-]/g, ''), telefone: txt(cli.telefone, 30), email: txt(cli.email, 120), cpf: txt(cli.cpf, 14).replace(/\D/g, '') };
  if (!cliente.empresa && !cliente.contato) return { erro: 'Informe a empresa ou o contato.' };
  const itens = [];
  for (const i of (Array.isArray(b.itens) ? b.itens : []).slice(0, 200)) {
    const qtd = num(i.qtd, 0.001, 100000), preco = num(i.preco, 0, 1e6), desc = num(i.desc ?? 0, 0, 100);
    if (qtd == null || preco == null || desc == null) return { erro: `Confira quantidade, preço e desconto de ${txt(i.desc_ || i.nome, 60) || 'um item'}.` };
    itens.push({ cod: txt(i.cod, 30), nome: txt(i.nome, 120), qtd, preco, desc, custo: num(i.custo, 0, 1e6), grupo: txt(i.grupo, 60) });
  }
  if (!itens.length) return { erro: 'Inclua pelo menos um produto.' };
  return {
    cliente, itens,
    descGeral: num(b.descGeral ?? 0, 0, 100) ?? 0,
    frete: num(b.frete ?? 0, 0, 1e6) ?? 0, custoExtra: num(b.custoExtra ?? 0, 0, 1e6) ?? 0,
    pagamento: ['pix', 'boleto', 'cartao', 'dinheiro'].includes(b.pagamento) ? b.pagamento : 'pix',
    comissao: !!b.comissao, validadeDias: Math.round(num(b.validadeDias ?? 7, 1, 90) ?? 7),
    entrega: txt(b.entrega, 120), obs: txt(b.obs, 1000), titulo: txt(b.titulo, 120),
  };
}

function salvar(id, b, por) {
  const n = normalizar(b);
  if (n.erro) return n;
  fs.mkdirSync(pasta(id), { recursive: true });
  const agora = new Date().toISOString();
  let o = b.id ? ler(id, b.id) : null;
  if (b.id && !o) return { erro: 'Orçamento não encontrado.' };
  if (o) { if (o.situacao === 'aprovado') return { erro: 'Orçamento aprovado não muda. Duplique para fazer outro.' }; Object.assign(o, n, { alteradoEm: agora, alteradoPor: por }); }
  else o = { id: crypto.randomBytes(6).toString('hex'), numero: proximoNumero(id), ...n, situacao: 'rascunho', historico: [], criadoEm: agora, criadoPor: por };
  C.gravarAtomico(path.join(pasta(id), o.id + '.json'), JSON.stringify(o), 0o640);
  return { ok: o };
}

/** situação: enviado | aprovado | perdido (com motivo) | rascunho (reabrir) */
function situacao(id, oid, sit, motivo, por) {
  const o = ler(id, oid);
  if (!o) return { erro: 'Orçamento não encontrado.' };
  if (!SIT.includes(sit)) return { erro: 'Situação inválida.' };
  if (sit === 'perdido' && !txt(motivo, 200)) return { erro: 'Diga o motivo da perda (preço, prazo, desistência…).' };
  o.situacao = sit;
  o.historico = [...(o.historico || []), { sit, motivo: txt(motivo, 200), por, em: new Date().toISOString() }].slice(-30);
  if (sit === 'perdido') o.motivoPerda = txt(motivo, 200); else delete o.motivoPerda;
  C.gravarAtomico(path.join(pasta(id), o.id + '.json'), JSON.stringify(o), 0o640);
  return { ok: o };
}

function excluir(id, oid) {
  const o = ler(id, oid);
  if (!o) return { erro: 'Orçamento não encontrado.' };
  if (o.situacao !== 'rascunho') return { erro: 'Só dá para excluir rascunho.' };
  fs.unlinkSync(path.join(pasta(id), o.id + '.json'));
  return { ok: true };
}

/** totais (sem deduções): bruto, desconto, frete, total, custo, lucro bruto */
function totais(o) {
  let bruto = 0, liquidoItens = 0, custo = 0, semCusto = 0;
  for (const i of o.itens) {
    const v = i.qtd * i.preco, l = v * (1 - i.desc / 100);
    bruto += v; liquidoItens += l;
    if (i.custo == null) semCusto++; else custo += i.qtd * i.custo;
  }
  const descGeral = liquidoItens * (o.descGeral || 0) / 100;
  const produtos = liquidoItens - descGeral;
  const total = produtos + (o.frete || 0);
  const r2 = (v) => Math.round(v * 100) / 100;
  return { bruto: r2(bruto), desconto: r2(bruto - produtos), produtos: r2(produtos), frete: r2(o.frete || 0), total: r2(total), custo: r2(custo + (o.custoExtra || 0)), lucroBruto: r2(produtos - custo - (o.custoExtra || 0)), semCusto };
}

module.exports = { ler, lista, salvar, situacao, excluir, totais, normalizar, SIT };
