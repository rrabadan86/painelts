'use strict';
/**
 * NF-e de saída como RASCUNHO no AppNext (o robô preenche e salva como rascunho; quem confere e transmite é a loja).
 *   dados/<loja>/nfe/envio/cadastros.resultado.json  parceiros, vendedores, produtos e formas de pagamento lidos da tela
 *   dados/<loja>/nfe/envio/<id>.json                 o pedido para o robô
 *   dados/<loja>/nfe/envio/<id>.resultado.json       o que o robô fez
 *   dados/<loja>/nfe/rascunhos.json                  histórico (quem pediu, o quê, situação)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');

const pasta = (id) => path.join(C.pastaLoja(id), 'nfe');
const envio = (id) => path.join(pasta(id), 'envio');
const arqLista = (id) => path.join(pasta(id), 'rascunhos.json');
const lerJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

function cadastros(id) {
  const r = lerJ(path.join(envio(id), 'cadastros.resultado.json'), null);
  return r && r.ok && r.cadastros ? { em: r.em, ...r.cadastros } : null;
}
function erroCadastros(id) {
  const r = lerJ(path.join(envio(id), 'cadastros.resultado.json'), null);
  return r && !r.ok ? { em: r.em, erro: r.erro } : null;
}
function prepararCadastros(id) {
  fs.mkdirSync(envio(id), { recursive: true });
  return true;
}
const lista = (id) => lerJ(arqLista(id), []);
function gravarLista(id, l) { fs.mkdirSync(pasta(id), { recursive: true }); C.gravarAtomico(arqLista(id), JSON.stringify(l.slice(0, 300)), 0o640); }

/** confere o pedido contra os cadastros e grava o arquivo para o robô */
function criar(id, b, por) {
  const cad = cadastros(id);
  if (!cad) return { erro: 'Busque os cadastros do AppNext primeiro.' };
  const parc = cad.parceiros.find((x) => x.id === b.parceiroId);
  if (!parc) return { erro: 'Escolha o parceiro.' };
  const vend = cad.vendedores.find((x) => x.id === b.vendedorId);
  if (!vend) return { erro: 'Escolha o vendedor.' };
  const pag = cad.pagamentos.find((x) => String(x.codigo) === String(b.pagamento));
  if (!pag) return { erro: 'Escolha a forma de pagamento.' };
  const itens = [];
  for (const x of Array.isArray(b.itens) ? b.itens.slice(0, 61) : []) {
    const p = cad.produtos.find((y) => y.id === x.produtoId);
    const qtd = Math.round(Number(x.qtd) * 1000) / 1000, preco = Math.round(Number(x.preco) * 100) / 100;
    if (!p) return { erro: 'Produto não encontrado nos cadastros: busque os cadastros de novo.' };
    if (!(qtd > 0 && qtd <= 100000)) return { erro: `Quantidade inválida em ${p.nome}.` };
    if (!(preco > 0 && preco <= 1e6)) return { erro: `Preço inválido em ${p.nome}.` };
    itens.push({ produtoId: p.id, codigo: p.codigo, nome: p.nome, qtd, preco });
  }
  if (!itens.length) return { erro: 'Adicione pelo menos um produto.' };
  if (itens.length > 60) return { erro: 'No máximo 60 produtos por nota.' };
  const total = Math.round(itens.reduce((s, i) => s + Math.round(i.qtd * i.preco * 100) / 100, 0) * 100) / 100;
  const rid = crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(envio(id), { recursive: true });
  const simular = !!b.simular; // teste: o robô preenche e confere, mas não salva
  C.gravarAtomico(path.join(envio(id), rid + '.json'), JSON.stringify({ parceiroId: parc.id, consumidorFinal: !!b.consumidorFinal, vendedorId: vend.id, pagamento: pag.codigo, itens: itens.map(({ nome, ...i }) => i), total, simular }), 0o640);
  const reg = { id: rid, em: new Date().toISOString(), por, parceiro: { nome: parc.nome, doc: parc.doc }, consumidorFinal: !!b.consumidorFinal, vendedor: vend.nome, pagamento: pag.descricao,
    obs: txt(b.obs, 200), itens, total, simular, estado: 'na_fila' };
  gravarLista(id, [reg, ...lista(id)]);
  return { ok: reg };
}
function erro(id, rid, msg) { const l = lista(id); const r = l.find((x) => x.id === rid); if (r) { r.estado = 'erro'; r.erro = msg; r.fim = new Date().toISOString(); gravarLista(id, l); } }
/** resultado do robô para os rascunhos na fila */
function conferir(id) {
  const l = lista(id);
  let mudou = [];
  for (const r of l) {
    if (r.estado !== 'na_fila') continue;
    const x = lerJ(path.join(envio(id), r.id + '.resultado.json'), null);
    if (!x || !x.em || Date.parse(x.em) < Date.parse(r.em)) continue;
    if (x.ok && x.simulado) { r.estado = 'teste'; r.totalAppNext = x.nota && x.nota.total; } else if (x.ok) { r.estado = 'ok'; r.totalAppNext = x.nota && x.nota.total; } else { r.estado = 'erro'; r.erro = x.erro || 'falhou'; }
    r.fim = x.em;
    mudou.push(r);
  }
  if (mudou.length) gravarLista(id, l);
  return { lista: l, mudou };
}

module.exports = { cadastros, erroCadastros, prepararCadastros, lista, criar, erro, conferir };
