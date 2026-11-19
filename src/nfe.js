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
/** emitir (concluir e transmitir) a partir de um teste conferido há pouco: mesmo pedido, agora para valer */
function emitir(id, ridTeste, por) {
  const l = lista(id);
  const t = l.find((x) => x.id === ridTeste);
  if (!t || t.estado !== 'teste') return { erro: 'Emita a partir de um teste que deu certo ("Testar sem salvar").' };
  if (t.emitidaEm) return { erro: 'Esta nota já foi mandada para emitir.' };
  if (!(Date.now() - Date.parse(t.fim || t.em) < 2 * 3600e3)) return { erro: 'Este teste tem mais de 2 horas: teste de novo para conferir o total antes de emitir.' };
  const orig = lerJ(path.join(envio(id), ridTeste + '.json'), null);
  if (!orig) return { erro: 'Não achei o pedido do teste: teste de novo.' };
  const rid = crypto.randomBytes(6).toString('hex');
  C.gravarAtomico(path.join(envio(id), rid + '.json'), JSON.stringify({ ...orig, simular: false, emitir: true, totalTeste: t.totalAppNext ?? null }), 0o640);
  const reg = { ...t, id: rid, em: new Date().toISOString(), por, simular: false, emitir: true, de: ridTeste, estado: 'na_fila', fim: undefined, erro: undefined };
  t.emitidaEm = reg.em; t.emitidaPor = por;
  gravarLista(id, [reg, ...l]);
  return { ok: reg };
}
/** situação do XML da nota emitida: 'pedido' (importação pedida ao coletor) ou 'proxima' (vem na próxima coleta) */
function marcarXml(id, rid, sit) { const l = lista(id); const r = l.find((x) => x.id === rid); if (r) { r.xml = sit; r.xmlEm = new Date().toISOString(); gravarLista(id, l); } }
function erro(id, rid, msg) { const l = lista(id); const r = l.find((x) => x.id === rid); if (r) { r.estado = 'erro'; r.erro = msg; r.fim = new Date().toISOString(); gravarLista(id, l); } }
/** resultado do robô para os rascunhos na fila */
function conferir(id) {
  const l = lista(id);
  let mudou = [];
  for (const r of l) {
    if (r.estado !== 'na_fila') continue;
    const x = lerJ(path.join(envio(id), r.id + '.resultado.json'), null);
    if (!x || !x.em || Date.parse(x.em) < Date.parse(r.em)) continue;
    if (x.ok && x.simulado) { r.estado = 'teste'; r.totalAppNext = x.nota && x.nota.total; }
    else if (x.ok && x.emitida) { r.estado = 'autorizada'; r.totalAppNext = x.nota && x.nota.total; r.nfe = x.nfe ? { numero: x.nfe.numero, serie: x.nfe.serie, chave: x.nfe.chave, protocolo: x.nfe.protocolo } : null; }
    else if (x.ok) { r.estado = 'ok'; r.totalAppNext = x.nota && x.nota.total; }
    else if (x.concluida) { r.estado = 'concluida'; r.erro = x.erro || 'concluída sem transmitir'; }
    else { r.estado = 'erro'; r.erro = x.erro || 'falhou'; }
    r.fim = x.em;
    mudou.push(r);
  }
  if (mudou.length) gravarLista(id, l);
  return { lista: l, mudou };
}

// ---------- parceiro novo (o robô cadastra em Parceiros → Cadastrar do AppNext) ----------
const arqParc = (id) => path.join(pasta(id), 'parceiros.json');
const listaParceiros = (id) => lerJ(arqParc(id), []);
function gravarParceiros(id, l) { fs.mkdirSync(pasta(id), { recursive: true }); C.gravarAtomico(arqParc(id), JSON.stringify(l.slice(0, 200)), 0o640); }
const dig = (v) => String(v ?? '').replace(/\D/g, '');
function cpfOk(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === +c[9] && dv(10) === +c[10];
}
function cnpjOk(c) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n) => { const pes = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < n; i++) s += +c[i] * pes[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === +c[12] && dv(13) === +c[13];
}
/** valida o parceiro novo e grava o pedido para o robô; b = { tipo: 'PF'|'PJ', doc, ...campos, cep, numero, complemento, simular } */
function criarParceiro(id, b, por) {
  const tipo = b.tipo === 'PJ' ? 'PJ' : b.tipo === 'PF' ? 'PF' : null;
  if (!tipo) return { erro: 'Escolha pessoa física ou jurídica.' };
  const doc = dig(b.doc);
  if (tipo === 'PF' ? !cpfOk(doc) : !cnpjOk(doc)) return { erro: tipo === 'PF' ? 'CPF inválido.' : 'CNPJ inválido.' };
  const cad = cadastros(id);
  const ja = cad && (cad.parceiros || []).find((x) => dig(x.doc) === doc);
  if (ja) return { erro: `Este ${tipo === 'PF' ? 'CPF' : 'CNPJ'} já está cadastrado no AppNext: ${ja.nome}.` };
  const tel = dig(b.telefone);
  if (tel && (tel.length < 10 || tel.length > 11)) return { erro: 'Telefone: DDD + número (10 ou 11 dígitos).' };
  const cep = dig(b.cep);
  if (cep.length !== 8) return { erro: 'CEP: 8 dígitos.' };
  const numero = txt(b.numero, 20) || 'S/N';
  const out = { tipo, doc, telefone: tel, cep, numero, complemento: txt(b.complemento, 60), simular: !!b.simular };
  if (tipo === 'PF') {
    out.nome = txt(b.nome, 100).toUpperCase();
    if (out.nome.length < 3 || !/\s/.test(out.nome)) return { erro: 'Nome completo (nome e sobrenome).' };
    out.apelido = txt(b.apelido, 60) || out.nome.split(' ')[0];
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(b.nascimento || '').trim());
    const dt = m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
    if (!dt || dt.getUTCDate() !== +m[1] || +m[3] < 1900 || dt > new Date()) return { erro: 'Data de nascimento: DD/MM/AAAA (o AppNext exige).' };
    out.nascimento = `${m[1]}/${m[2]}/${m[3]}`;
  } else {
    out.razaoSocial = txt(b.razaoSocial, 100).toUpperCase();
    if (out.razaoSocial.length < 3) return { erro: 'Razão social.' };
    out.nomeFantasia = txt(b.nomeFantasia, 100).toUpperCase() || out.razaoSocial;
    out.tipoIe = ['1', '2', '9'].includes(String(b.tipoIe)) ? String(b.tipoIe) : null;
    if (!out.tipoIe) return { erro: 'Escolha a situação da inscrição estadual.' };
    out.ie = out.tipoIe === '1' ? dig(b.ie) : '';
    if (out.tipoIe === '1' && (out.ie.length < 8 || out.ie.length > 14)) return { erro: 'Inscrição estadual: só os números (contribuinte de ICMS).' };
    out.im = txt(b.im, 20);
    out.crt = ['1', '2', '3', '4'].includes(String(b.crt)) ? String(b.crt) : '1';
  }
  const rid = crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(envio(id), { recursive: true });
  C.gravarAtomico(path.join(envio(id), rid + '.json'), JSON.stringify(out), 0o640);
  const reg = { id: rid, em: new Date().toISOString(), por, tipo, doc, nome: out.nome || out.razaoSocial, simular: out.simular, estado: 'na_fila' };
  gravarParceiros(id, [reg, ...listaParceiros(id)]);
  return { ok: reg };
}
function erroParceiro(id, rid, msg) { const l = listaParceiros(id); const r = l.find((x) => x.id === rid); if (r) { r.estado = 'erro'; r.erro = msg; r.fim = new Date().toISOString(); gravarParceiros(id, l); } }
function conferirParceiros(id) {
  const l = listaParceiros(id);
  const mudou = [];
  for (const r of l) {
    if (r.estado !== 'na_fila') continue;
    const x = lerJ(path.join(envio(id), r.id + '.resultado.json'), null);
    if (!x || !x.em || Date.parse(x.em) < Date.parse(r.em)) continue;
    if (x.ok) { r.estado = x.simulado ? 'teste' : 'ok'; r.endereco = x.parceiro && x.parceiro.endereco ? x.parceiro.endereco : null; r.novoId = (x.parceiro && x.parceiro.id) || null; } else { r.estado = 'erro'; r.erro = x.erro || 'falhou'; }
    r.fim = x.em;
    mudou.push(r);
  }
  if (mudou.length) gravarParceiros(id, l);
  return { lista: l, mudou };
}

module.exports = { cadastros, erroCadastros, prepararCadastros, lista, criar, emitir, erro, marcarXml, conferir, criarParceiro, listaParceiros, erroParceiro, conferirParceiros, cpfOk, cnpjOk };
