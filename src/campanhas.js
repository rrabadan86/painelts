'use strict';
/**
 * Campanhas de WhatsApp da tela Clientes → Campanhas.
 *   dados/<loja>/campanhas.json = [{ id, nome, criadaEm, por, filtros, mensagem, janela, recorrente, ativa,
 *                                    robo (enviada pelo robô do WhatsApp; src/zapfila.js),
 *                                    rodadas: [{ id, em, lista: [{ cpf, nome, st, em?, por? }] }] }]
 * A lista de cada rodada é a foto do momento em que foi criada (os filtros rodam no navegador, com os dados do painel).
 * st: 'p' pendente · 'e' enviada (clicou em "Abrir no WhatsApp") · 'o' não quer mensagens · 'x' pulada.
 * O celular não é guardado aqui: no envio o painel usa o do cadastro.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');

const arq = (id) => path.join(C.pastaLoja(id), 'campanhas.json');
const CPF_OK = /^\d{11}(\d{3})?$/;
const RECORRENCIAS = ['', 'semanal', 'mensal'];
const ST = ['p', 'e', 'o', 'x'];

function ler(id) { try { const j = JSON.parse(fs.readFileSync(arq(id), 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } }
function gravar(id, lista) { fs.mkdirSync(path.dirname(arq(id)), { recursive: true }); C.gravarAtomico(arq(id), JSON.stringify(lista), 0o640); }
const novoId = () => crypto.randomBytes(6).toString('hex');
const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

/** filtros: só números, textos curtos e listas curtas (o painel é quem interpreta) */
function filtrosOk(f) {
  const out = {};
  if (!f || typeof f !== 'object') return out;
  for (const [k, v] of Object.entries(f).slice(0, 40)) {
    if (!/^[a-zA-Z]{1,20}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = texto(v, 80);
    else if (typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 30).map((x) => texto(x, 120));
  }
  return out;
}
function listaOk(l) {
  if (!Array.isArray(l)) return { erro: 'Lista inválida.' };
  if (l.length > 5000) return { erro: 'No máximo 5.000 clientes por campanha.' };
  const vistos = new Set(), out = [];
  for (const x of l) {
    const cpf = String(x && x.cpf || '');
    if (!CPF_OK.test(cpf) || vistos.has(cpf)) continue;
    vistos.add(cpf);
    out.push({ cpf, nome: texto(x.nome, 80), st: 'p' });
  }
  return { ok: out };
}
function dadosOk(b, atual = {}) {
  const nome = texto(b.nome ?? atual.nome, 60);
  if (!nome) return { erro: 'Dê um nome à campanha.' };
  const mensagem = texto(b.mensagem ?? atual.mensagem, 1000);
  if (!mensagem) return { erro: 'Escreva a mensagem.' };
  const janela = Math.round(+(b.janela ?? atual.janela ?? 30));
  if (!(janela >= 1 && janela <= 365)) return { erro: 'Prazo para medir o retorno: de 1 a 365 dias.' };
  const recorrente = String(b.recorrente ?? atual.recorrente ?? '');
  if (!RECORRENCIAS.includes(recorrente)) return { erro: 'Repetição inválida.' };
  // até 4 variações além da mensagem principal (cada cliente recebe uma; o retorno é medido por variação)
  const variacoes = (Array.isArray(b.variacoes) ? b.variacoes : atual.variacoes || []).map((x) => texto(x, 1000)).filter(Boolean).slice(0, 4);
  // limite de envios por dia nesta campanha (0 = sem limite)
  const limiteDia = Math.round(+(b.limiteDia ?? atual.limiteDia ?? 20));
  if (!(limiteDia >= 0 && limiteDia <= 500)) return { erro: 'Limite por dia: de 0 a 500.' };
  // robo: a campanha é enviada pelo robô do WhatsApp (padrão desligado; as outras continuam manuais)
  const robo = b.robo == null ? !!atual.robo : b.robo === true;
  return { ok: { nome, mensagem, variacoes, limiteDia, janela, recorrente, robo, ativa: b.ativa == null ? atual.ativa ?? true : !!b.ativa, filtros: b.filtros ? filtrosOk(b.filtros) : atual.filtros || {} } };
}

function criar(id, b, por) {
  const d = dadosOk(b);
  if (d.erro) return d;
  const l = listaOk(b.lista);
  if (l.erro) return l;
  const todas = ler(id);
  if (todas.length >= 200) return { erro: 'No máximo 200 campanhas por loja: apague as antigas.' };
  const agora = new Date().toISOString();
  const c = { id: novoId(), ...d.ok, criadaEm: agora, por, rodadas: [{ id: novoId(), em: agora, por, lista: l.ok }] };
  todas.unshift(c);
  gravar(id, todas);
  return { ok: c };
}
function alterar(id, cid, b) {
  const todas = ler(id);
  const c = todas.find((x) => x.id === cid);
  if (!c) return { erro: 'Campanha não encontrada.' };
  const d = dadosOk(b, c);
  if (d.erro) return d;
  Object.assign(c, d.ok);
  gravar(id, todas);
  return { ok: c };
}
/** campanha recorrente: a última lista ainda vale? (semanal = menos de 7 dias; mensal = mesmo mês, em Brasília) */
function rodadaEmDia(c, agora = Date.now()) {
  const ult = c && c.recorrente && c.rodadas && c.rodadas[0] ? Date.parse(c.rodadas[0].em) : NaN;
  if (!Number.isFinite(ult)) return false;
  if (c.recorrente === 'semanal') return agora - ult < 7 * 864e5;
  return C.diaSP(agora).slice(0, 7) <= C.diaSP(ult).slice(0, 7);
}
/** lista nova da campanha. Recorrente com a lista do período já criada (duas abas, dois aparelhos): não cria
 *  outra — devolve a que existe, com repetida: true */
function novaRodada(id, cid, lista, por, agora = Date.now()) {
  const todas = ler(id);
  const c = todas.find((x) => x.id === cid);
  if (!c) return { erro: 'Campanha não encontrada.' };
  if (rodadaEmDia(c, agora)) return { ok: c, repetida: true };
  const l = listaOk(lista);
  if (l.erro) return l;
  c.rodadas.unshift({ id: novoId(), em: new Date(agora).toISOString(), por, lista: l.ok });
  if (c.rodadas.length > 60) c.rodadas.length = 60;
  gravar(id, todas);
  return { ok: c };
}
/** critérios mudaram: a lista da rodada é refeita — quem já foi enviado, pulado ou pediu para não receber continua
 *  como está; os pendentes passam a ser os da lista nova */
function refazerLista(id, cid, rid, lista) {
  const todas = ler(id);
  const c = todas.find((x) => x.id === cid);
  const r = c && c.rodadas.find((x) => x.id === rid);
  if (!r) return { erro: 'Lista não encontrada.' };
  const l = listaOk(lista);
  if (l.erro) return l;
  const feitos = r.lista.filter((x) => x.st !== 'p');
  const ja = new Set(feitos.map((x) => x.cpf));
  r.lista = [...feitos, ...l.ok.filter((x) => !ja.has(x.cpf))];
  gravar(id, todas);
  return { ok: c };
}
function marcar(id, cid, rid, cpf, st, por, motivo, variacao) {
  if (!ST.includes(st)) return { erro: 'Situação inválida.' };
  const todas = ler(id);
  const c = todas.find((x) => x.id === cid);
  const r = c && c.rodadas.find((x) => x.id === rid);
  const it = r && r.lista.find((x) => x.cpf === cpf);
  if (!it) return { erro: 'Cliente não está nesta campanha.' };
  it.st = st;
  delete it.v;
  if (st === 'e' && Number.isInteger(variacao) && variacao >= 0 && variacao <= 4) it.v = variacao;
  if (st === 'p') { delete it.em; delete it.por; delete it.motivo; if (motivo === 'liberado') it.liberado = true; } else { it.em = new Date().toISOString(); it.por = por; if (motivo && motivo !== 'liberado') it.motivo = texto(motivo, 120); else delete it.motivo; }
  gravar(id, todas);
  return { ok: it };
}
function apagar(id, cid) {
  const todas = ler(id);
  const i = todas.findIndex((x) => x.id === cid);
  if (i < 0) return { erro: 'Campanha não encontrada.' };
  todas.splice(i, 1);
  gravar(id, todas);
  return { ok: true };
}

// ---------- copiar para outra loja ----------
// A lista depende dos clientes de cada loja (os filtros rodam no navegador), então a cópia chega na outra loja
// como "campanha recebida": quem abre Campanhas lá revisa e salva, e a lista é montada com os clientes de lá.
const arqCopias = (id) => path.join(C.pastaLoja(id), 'campanhas-copias.json');
function lerCopias(id) { try { const j = JSON.parse(fs.readFileSync(arqCopias(id), 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } }
function copiar(origem, nomeOrigem, cid, destinos, por) {
  const c = ler(origem).find((x) => x.id === cid);
  if (!c) return { erro: 'Campanha não encontrada.' };
  const ds = [...new Set((destinos || []).map(String))].filter((d) => d !== origem);
  if (!ds.length) return { erro: 'Escolha pelo menos uma loja.' };
  for (const d of ds) {
    const l = lerCopias(d).filter((x) => !(x.deLoja === origem && x.deCampanha === cid)); // a mesma campanha mandada de novo substitui
    l.unshift({ id: novoId(), nome: c.nome, mensagem: c.mensagem, janela: c.janela, recorrente: c.recorrente, filtros: c.filtros || {}, deLoja: origem, deNome: nomeOrigem, deCampanha: cid, por, em: new Date().toISOString() });
    fs.mkdirSync(path.dirname(arqCopias(d)), { recursive: true });
    C.gravarAtomico(arqCopias(d), JSON.stringify(l.slice(0, 50)), 0o640);
  }
  return { ok: ds };
}
function descartarCopia(id, cpid) {
  const l = lerCopias(id);
  const n = l.filter((x) => x.id !== cpid);
  if (n.length === l.length) return { erro: 'Cópia não encontrada.' };
  C.gravarAtomico(arqCopias(id), JSON.stringify(n), 0o640);
  return { ok: true };
}

module.exports = { rodadaEmDia, lerCopias, copiar, descartarCopia, ler, criar, alterar, novaRodada, refazerLista, marcar, apagar };
