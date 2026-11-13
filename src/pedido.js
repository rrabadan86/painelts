'use strict';
/**
 * Pedido sugerido e Sistema de Pedidos da franqueadora.
 *   dados/<loja>/pedido/catalogo.json  catálogo FRANQUIAS (o coletor lê toda noite): { em, itens:[{cod,nome,preco,disp,mult,min,max}] }
 *   dados/<loja>/pedido/entrada.json   lista que o painel manda para o robô montar o carrinho
 *   dados/<loja>/pedido/carrinho.json  resultado do robô (o que entrou, o que estava indisponível)
 * Configuração por loja (lojas.json → pedidoCfg): % do faturamento para o pedido (CMV), dias de vendas, folga da
 * proporção entre grupos e as datas comemorativas.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const pasta = (id) => path.join(C.pastaLoja(id), 'pedido');
const ler = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const catalogo = (id) => ler(path.join(pasta(id), 'catalogo.json'));
const carrinho = (id) => ler(path.join(pasta(id), 'carrinho.json'));

function gravarEntrada(id, itens, por) {
  fs.mkdirSync(pasta(id), { recursive: true });
  C.gravarAtomico(path.join(pasta(id), 'entrada.json'), JSON.stringify({ em: new Date().toISOString(), por, itens }), 0o640);
  try { fs.unlinkSync(path.join(pasta(id), 'carrinho.json')); } catch { /* não havia */ }
}

const EVENTOS = [
  { id: 'maes', nome: 'Dia das Mães', regra: 'maes', diasAntes: 14 },
  { id: 'natal', nome: 'Natal', de: '12-01', ate: '12-24' },
  { id: 'julho', nome: 'Férias de julho', de: '07-01', ate: '07-31' },
  { id: 'janeiro', nome: 'Férias de janeiro', de: '01-02', ate: '01-31' },
];
const PADRAO = { cmvPct: null, dias: 14, folgaPct: 10, crescimentoPct: null, eventos: EVENTOS };

function cfg(loja) {
  const c = (loja && loja.pedidoCfg) || {};
  return {
    cmvPct: Number.isFinite(c.cmvPct) ? c.cmvPct : null, // null = CMV real dos últimos 3 meses fechados
    dias: Number.isInteger(c.dias) ? c.dias : PADRAO.dias,
    folgaPct: Number.isFinite(c.folgaPct) ? c.folgaPct : PADRAO.folgaPct,
    crescimentoPct: Number.isFinite(c.crescimentoPct) ? c.crescimentoPct : null, // null = o da loja (3 meses × ano anterior)
    eventos: Array.isArray(c.eventos) && c.eventos.length ? c.eventos : EVENTOS,
  };
}

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function validarCfg(b) {
  const dec = (v) => (v == null || v === '' ? null : Math.round(Number(String(v).replace(',', '.')) * 10) / 10);
  const out = {};
  out.cmvPct = dec(b.cmvPct);
  if (out.cmvPct != null && !(out.cmvPct >= 1 && out.cmvPct <= 90)) return { erro: '% do faturamento para o pedido: entre 1 e 90 (ou vazio para usar o CMV real).' };
  out.dias = Math.round(+b.dias);
  if (!(out.dias >= 3 && out.dias <= 60)) return { erro: 'Dias de vendas: entre 3 e 60.' };
  out.folgaPct = dec(b.folgaPct ?? PADRAO.folgaPct);
  if (!(out.folgaPct >= 0 && out.folgaPct <= 100)) return { erro: 'Folga da proporção: entre 0 e 100%.' };
  out.crescimentoPct = dec(b.crescimentoPct);
  if (out.crescimentoPct != null && !(out.crescimentoPct >= -80 && out.crescimentoPct <= 300)) return { erro: 'Crescimento: entre −80% e 300% (ou vazio para usar o da loja).' };
  const evs = Array.isArray(b.eventos) ? b.eventos : EVENTOS;
  if (evs.length > 12) return { erro: 'No máximo 12 datas.' };
  out.eventos = [];
  for (const e of evs) {
    const nome = String(e.nome || '').replace(/[\r\n]/g, ' ').trim().slice(0, 40);
    if (!nome) return { erro: 'Dê um nome a cada data.' };
    const id = String(e.id || nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    if (e.regra === 'maes') {
      const d = Math.round(+e.diasAntes);
      if (!(d >= 1 && d <= 45)) return { erro: `${nome}: dias antes entre 1 e 45.` };
      out.eventos.push({ id, nome, regra: 'maes', diasAntes: d });
    } else {
      if (!MMDD.test(e.de || '') || !MMDD.test(e.ate || '')) return { erro: `${nome}: use datas no formato MM-DD (ex.: 12-01).` };
      out.eventos.push({ id, nome, de: e.de, ate: e.ate });
    }
  }
  return { ok: out };
}

/** lista do painel → itens do robô: só o que existe e está disponível no catálogo; o nome vem do catálogo */
function validarItens(id, itens) {
  const cat = catalogo(id);
  if (!cat || !Array.isArray(cat.itens)) return { erro: 'Ainda não há catálogo do Sistema de Pedidos: clique em "Atualizar catálogo".' };
  if (!Array.isArray(itens) || !itens.length) return { erro: 'Nenhum produto para colocar no carrinho.' };
  if (itens.length > 400) return { erro: 'Produtos demais (máximo 400).' };
  const porCod = new Map(cat.itens.map((x) => [String(x.cod), x]));
  const out = [], fora = [];
  for (const x of itens) {
    const c = porCod.get(String(x.cod || ''));
    const qtd = Math.round(Number(x.qtd) * 1000) / 1000;
    if (!(qtd > 0 && qtd <= 100000)) continue;
    if (!c || !c.disp) { fora.push(String(x.cod)); continue; }
    out.push({ cod: c.cod, nome: c.nome, qtd });
  }
  if (!out.length) return { erro: 'Nenhum dos produtos está disponível no catálogo.' };
  return { ok: out, fora };
}

// ---------- login da loja no Sistema de Pedidos (Configurações → Lojas; só o admin) ----------
// dados/_sistema/acesso-pedido/<loja>.json, só leitura do dono (o coletor roda com o mesmo usuário e lê daqui).
// A senha nunca volta para a tela: o painel só diz se existe.
const arqAcesso = (id) => path.join(C.pastaLoja('_sistema'), 'acesso-pedido', `${id}.json`);
function acesso(id) {
  const a = ler(arqAcesso(id));
  return { usuario: (a && a.usuario) || '', temSenha: !!(a && a.senha), em: (a && a.em) || null, por: (a && a.por) || null };
}
function gravarAcesso(id, { usuario, senha, apagar }, por) {
  const f = arqAcesso(id);
  if (apagar) { try { fs.unlinkSync(f); } catch { /* já não havia */ } return { ok: true }; }
  const u = String(usuario || '').trim();
  if (!u || u.length > 80 || /[\r\n]/.test(u)) return { erro: 'Informe o usuário do Sistema de Pedidos.' };
  const antes = ler(f) || {};
  const s = senha == null || senha === '' ? antes.senha : String(senha);
  if (!s) return { erro: 'Informe a senha.' };
  if (s.length > 120 || /[\r\n]/.test(s)) return { erro: 'Senha inválida.' };
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  C.gravarAtomico(f, JSON.stringify({ usuario: u, senha: s, em: new Date().toISOString(), por }), 0o600);
  return { ok: true };
}

module.exports = { acesso, gravarAcesso, catalogo, carrinho, gravarEntrada, cfg, validarCfg, validarItens, EVENTOS };
