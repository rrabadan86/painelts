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

/**
 * Fora de linha: desde quando cada produto está indisponível no Sistema de Pedidos (catálogo FRANQUIAS lido toda noite).
 *   dados/<loja>/pedido/disponibilidade.json = { desde: 'AAAA-MM-DD' (início do acompanhamento), catEm, indisp: { cod: 'AAAA-MM-DD' } }
 * Produto que volta a ficar disponível sai da lista. Fora do catálogo também conta como indisponível.
 * Com FORA_DE_LINHA_DIAS seguidos indisponível, o Estoque mostra "fora de linha: liquidar" em vez de "parado".
 */
const FORA_DE_LINHA_DIAS = 90;
const arqDisp = (id) => path.join(pasta(id), 'disponibilidade.json');
const diaSP = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(iso ? new Date(iso) : new Date());
function atualizarDisp(id, cat = catalogo(id)) {
  const d = ler(arqDisp(id)) || { desde: null, catEm: null, indisp: {} };
  d.indisp = d.indisp || {}; d.noCat = d.noCat || {};
  if (!cat || !Array.isArray(cat.itens) || !cat.itens.length || cat.em === d.catEm) return d;
  const dia = diaSP(cat.em || undefined);
  const noCat = new Set(cat.itens.map((c) => String(c.cod)));
  for (const c of cat.itens) {
    const cod = String(c.cod);
    d.noCat[cod] = 1; // já apareceu no catálogo alguma vez (produto que nunca foi da franquia não vira "fora de linha")
    if (c.disp) delete d.indisp[cod];
    else if (!d.indisp[cod]) d.indisp[cod] = dia;
  }
  // saiu do catálogo: também indisponível
  for (const cod of Object.keys(d.noCat)) if (!noCat.has(cod) && !d.indisp[cod]) d.indisp[cod] = dia;
  d.desde = d.desde || dia;
  d.catEm = cat.em;
  try { fs.mkdirSync(pasta(id), { recursive: true }); C.gravarAtomico(arqDisp(id), JSON.stringify(d), 0o640); } catch { /* sem disco: tenta na próxima */ }
  return d;
}
/** { desde, dias, indisp: { cod: 'AAAA-MM-DD' } } — o Estoque decide o que já passou de FORA_DE_LINHA_DIAS */
function foraDeLinha(id) {
  const d = atualizarDisp(id, catalogo(id));
  return { desde: d.desde, dias: FORA_DE_LINHA_DIAS, indisp: d.indisp };
}

function gravarEntrada(id, itens, por, refazer) {
  fs.mkdirSync(pasta(id), { recursive: true });
  C.gravarAtomico(path.join(pasta(id), 'entrada.json'), JSON.stringify({ em: new Date().toISOString(), por, itens, refazer: !!refazer }), 0o640);
  // carrinho novo: apaga o resultado anterior; "tentar de novo": o robô mantém o anterior e refaz só os itens pedidos
  if (!refazer) { try { fs.unlinkSync(path.join(pasta(id), 'carrinho.json')); } catch { /* não havia */ } }
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
    proporcao: c.proporcao && typeof c.proporcao === 'object' ? c.proporcao : null, // null = pelas vendas; { cha, env, acess } em %
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
  out.proporcao = null;
  if (b.proporcao) {
    const p = Object.fromEntries(['cha', 'env', 'acess'].map((g) => [g, Math.round(+b.proporcao[g] || 0)]));
    if (Object.values(p).some((v) => v < 0 || v > 100) || p.cha + p.env + p.acess !== 100) return { erro: 'Proporção do pedido: os três grupos precisam somar 100%.' };
    out.proporcao = p;
  }
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

// ---------- carrinho montado no navegador de quem pede ----------
// O carrinho do Sistema de Pedidos vale só para a sessão de quem entrou no site; por isso ele é montado
// no navegador da pessoa: o painel gera um código de uso único (30 min) com a lista, abre o site e o
// favorito "Carrinho Tea Shop" (public/js/carrinho-site.js) lê a lista, coloca no carrinho e devolve o andamento.
const crypto = require('crypto');
const SITE = (process.env.PEDIDO_SITE || 'https://grnteashop.nextsoft.com.br/Pedidos/').replace(/\/?$/, '/');
const ORIGENS = new Set([new URL(SITE).origin, new URL(SITE).origin.replace(/^https:/, 'http:')]);
const codigos = new Map(); // código → { loja, itens, por, expira, criado }
const CODIGO_TETO_MS = 3 * 3600e3;
const STATUS = new Set(['ok', 'sem_estoque', 'recusado', 'indisponivel', 'nao_encontrado', 'acima_do_maximo', 'sem_confirmacao', 'erro']);
function limparCodigos() { const t = Date.now(); for (const [k, v] of codigos) if (v.expira < t) codigos.delete(k); }
function criarCodigo(id, itens, por) {
  limparCodigos();
  for (const [k, v] of codigos) if (v.loja === id) codigos.delete(k); // um carrinho por loja de cada vez
  const c = crypto.randomBytes(18).toString('hex');
  const cat = catalogo(id) || { itens: [] };
  const porCod = new Map(cat.itens.map((x) => [String(x.cod), x]));
  const lista = itens.map((x) => { const k = porCod.get(String(x.cod)) || {}; return { cod: x.cod, nome: x.nome, qtd: x.qtd, mult: k.mult || null, min: k.min || null, max: k.max || null }; });
  const expira = Date.now() + 30 * 60e3;
  codigos.set(c, { loja: id, itens: lista, por, expira, criado: Date.now() });
  fs.mkdirSync(pasta(id), { recursive: true });
  C.gravarAtomico(path.join(pasta(id), 'carrinho.json'), JSON.stringify({ modo: 'navegador', inicio: new Date().toISOString(), por, total: lista.length, itens: [], site: SITE, expira: new Date(expira).toISOString(), aguardando: true }), 0o640);
  return { codigo: c, url: `${SITE}Abertura.aspx#teashop=${c}`, expira: new Date(expira).toISOString() };
}
function lerCodigo(c) {
  const x = codigos.get(String(c || ''));
  if (!x || x.expira < Date.now()) return null;
  return x;
}
/** andamento enviado pelo favorito: { itens:[…], atual, fim, carrinhoDepois:{texto} } */
function progresso(c, b) {
  const x = lerCodigo(c);
  if (!x) return { erro: 'Código vencido. Gere o carrinho de novo no painel.' };
  const f = path.join(pasta(x.loja), 'carrinho.json');
  const atual = ler(f) || { modo: 'navegador', inicio: new Date().toISOString(), por: x.por, total: x.itens.length, site: SITE };
  const txt = (v, n) => String(v ?? '').replace(/[\r\n<>]/g, ' ').slice(0, n);
  const num = (v) => (Number.isFinite(+v) ? Math.round(+v * 1000) / 1000 : null);
  const cods = new Set(x.itens.map((i) => String(i.cod)));
  const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 400).filter((i) => cods.has(String(i.cod)) && STATUS.has(i.status))
    .map((i) => ({ cod: String(i.cod), nome: txt(i.nome, 120), pedido: num(i.pedido), qtd: num(i.qtd), preco: num(i.preco), status: i.status, erro: i.erro ? txt(i.erro, 200) : undefined,
      // venda conjunta: o que o site exigiu colocar junto (ex.: o infusor da mug) — só código, nome, quantidade e preço
      junto: Array.isArray(i.junto) && i.junto.length ? i.junto.slice(0, 10).map((j) => ({ cod: txt(j.cod, 30), nome: txt(j.nome, 120), qtd: num(j.qtd), preco: num(j.preco) })).filter((j) => j.nome) : undefined }));
  if (b.fim) guardarConjuntos(x.loja, itens);
  // em uso: não vence no meio — mas só até 3 h depois de gerado (um código vazado não se renova para sempre)
  x.expira = Math.max(x.expira, Math.min(Date.now() + 15 * 60e3, (x.criado || Date.now()) + CODIGO_TETO_MS));
  const novo = { ...atual, aguardando: false, itens, total: x.itens.length, atual: b.atual ? txt(b.atual, 120) : undefined, expira: new Date(x.expira).toISOString(),
    fim: b.fim ? new Date().toISOString() : undefined, carrinhoDepois: b.carrinhoDepois ? { texto: txt(b.carrinhoDepois.texto, 80) } : atual.carrinhoDepois, ok: !!b.fim };
  C.gravarAtomico(f, JSON.stringify(novo), 0o640);
  // o servidor usa no fim para responder as ⭐ sugestões que o site recusou (só a loja e o resultado; nada vai ao favorito)
  return { ok: true, _loja: x.loja, _fim: !!b.fim, _itens: itens };
}

// ---------- carrinho montado no site: a pessoa confirma que fez o pedido, ou exclui o registro (montou para testar e não pediu) ----------
function confirmarCarrinho(id, por) {
  const f = path.join(pasta(id), 'carrinho.json'), c = ler(f);
  if (!c || !Array.isArray(c.itens)) return { erro: 'Não há carrinho montado para confirmar.' };
  if (!c.fim && c.modo === 'navegador' && !c.itens.length) return { erro: 'O carrinho ainda está sendo montado.' };
  c.confirmado = { por: String(por || ''), em: new Date().toISOString() };
  C.gravarAtomico(f, JSON.stringify(c), 0o640);
  return { ok: c };
}
/** apaga o registro do carrinho montado e o código de uso dele; devolve o que foi apagado (para a auditoria e as sugestões) */
function excluirCarrinho(id) {
  const f = path.join(pasta(id), 'carrinho.json'), c = ler(f);
  if (!c) return { erro: 'Não há carrinho montado para excluir.' };
  for (const [k, v] of codigos) if (v.loja === id) codigos.delete(k); // o favorito não continua um carrinho excluído
  try { fs.unlinkSync(f); } catch { /* já não havia */ }
  return { ok: { inicio: c.inicio, por: c.por, produtos: (c.itens || []).filter((i) => i.status === 'ok').length, confirmado: !!c.confirmado } };
}

// ---------- carrinho salvo (Estoque → Pedido → "Salvar carrinho"): as quantidades de cada produto, para terminar depois ----------
// dados/<loja>/pedido/rascunho.json = { itens: { cod: qtd }, por, em }; vale 5 dias e é um por loja (quem tem a tela Pedido continua de onde o outro parou)
const RASCUNHO_DIAS = 5;
const arqRasc = (id) => path.join(pasta(id), 'rascunho.json');
function rascunho(id, agora = Date.now()) {
  const d = ler(arqRasc(id));
  if (!d || !d.em || !d.itens || typeof d.itens !== 'object') return null;
  const expira = Date.parse(d.em) + RASCUNHO_DIAS * 864e5;
  if (!(expira > agora)) return null; // venceu: é como se não existisse (o arquivo é trocado no próximo salvar)
  return { itens: d.itens, por: d.por || '', em: d.em, expira: new Date(expira).toISOString(), dias: RASCUNHO_DIAS };
}
function salvarRascunho(id, itens, por) {
  if (!itens || typeof itens !== 'object' || Array.isArray(itens)) return { erro: 'Carrinho inválido.' };
  const out = {};
  for (const [cod, q] of Object.entries(itens).slice(0, 2000)) {
    const c = String(cod).trim(), n = Math.round(Number(q) * 1000) / 1000;
    if (!/^[A-Za-z0-9._-]{1,30}$/.test(c) || !Number.isFinite(n) || n < 0 || n > 100000) continue;
    out[c] = n;
  }
  if (!Object.values(out).some((q) => q > 0)) return { erro: 'O carrinho está vazio: não há o que salvar.' };
  fs.mkdirSync(pasta(id), { recursive: true });
  C.gravarAtomico(arqRasc(id), JSON.stringify({ itens: out, por: String(por || ''), em: new Date().toISOString() }), 0o640);
  return { ok: rascunho(id) };
}
function apagarRascunho(id) { try { fs.unlinkSync(arqRasc(id)); } catch { /* já não havia */ } return { ok: true }; }

// venda conjunta do site (ex.: a mug só é vendida com o infusor dela): o que o favorito viu fica guardado por produto
const arqConj = (id) => path.join(pasta(id), 'conjuntos.json');
const conjuntos = (id) => ler(arqConj(id)) || {};
function guardarConjuntos(id, itens) {
  const com = (itens || []).filter((i) => i.junto && i.junto.length);
  if (!com.length) return;
  const d = conjuntos(id);
  for (const i of com) d[i.cod] = { nome: i.nome, junto: i.junto.map((j) => ({ cod: j.cod, nome: j.nome, porUnidade: i.qtd > 0 && j.qtd > 0 ? Math.round((j.qtd / i.qtd) * 1000) / 1000 : null, preco: j.preco })), em: new Date().toISOString() };
  try { fs.mkdirSync(pasta(id), { recursive: true }); C.gravarAtomico(arqConj(id), JSON.stringify(d), 0o640); } catch { /* só um registro: o carrinho segue */ }
}

// ---------- pedido obrigatório: o que a franquia manda de qualquer forma (entra no valor e conta como estoque chegando) ----------
const arqObrig = (id) => path.join(pasta(id), 'obrigatorio.json');
const hojeBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
/** { lista: [{ id, nome, ate, encerrado, por, em, itens: [{ cod, nome, qtd, preco }] }] } — ativos = não encerrados e dentro da data */
function obrigatorios(id) {
  const d = ler(arqObrig(id)) || { lista: [] };
  const hoje = hojeBR();
  for (const o of d.lista) o.ativo = !o.encerrado && (!o.ate || o.ate >= hoje);
  return d;
}
function validarObrig(b) {
  const nome = String(b.nome || '').replace(/[\r\n]/g, ' ').trim().slice(0, 60) || 'Pedido obrigatório';
  const ate = String(b.ate || '').trim();
  if (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return { erro: 'Data inválida.' };
  const itens = [];
  for (const x of Array.isArray(b.itens) ? b.itens.slice(0, 300) : []) {
    const cod = String(x.cod || '').trim().slice(0, 30), q = Number(x.qtd), pr = x.preco == null || x.preco === '' ? null : Number(x.preco);
    if (!cod) continue;
    if (!(q > 0) || q > 100000) return { erro: `Quantidade inválida no produto ${cod}.` };
    if (pr != null && !(pr >= 0 && pr < 1e6)) return { erro: `Valor inválido no produto ${cod}.` };
    itens.push({ cod, nome: String(x.nome || '').trim().slice(0, 120), qtd: Math.round(q * 1000) / 1000, preco: pr == null ? null : Math.round(pr * 100) / 100 });
  }
  if (!itens.length) return { erro: 'Coloque pelo menos um produto.' };
  return { ok: { nome, ate: ate || null, itens } };
}
/** cria ou atualiza (b.id), encerra (b.encerrar), reabre (b.reabrir) ou apaga (b.apagar) */
function alterarObrig(id, b, por) {
  const d = ler(arqObrig(id)) || { lista: [] };
  let o = b.id ? d.lista.find((x) => x.id === b.id) : null;
  if (b.id && !o) return { erro: 'Pedido obrigatório não encontrado.' };
  if (!o && (b.apagar || b.encerrar || b.reabrir)) return { erro: 'Diga qual pedido obrigatório (falta o id).' };
  if (b.apagar) d.lista = d.lista.filter((x) => x !== o);
  else if (b.encerrar || b.reabrir) { o.encerrado = !!b.encerrar; o.encerradoEm = b.encerrar ? new Date().toISOString() : null; }
  else {
    const v = validarObrig(b);
    if (v.erro) return v;
    if (!o) { o = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), criadoEm: new Date().toISOString() }; d.lista.unshift(o); }
    Object.assign(o, v.ok, { por, em: new Date().toISOString() });
  }
  d.lista = d.lista.slice(0, 60);
  fs.mkdirSync(pasta(id), { recursive: true });
  C.gravarAtomico(arqObrig(id), JSON.stringify(d), 0o640);
  return { ok: obrigatorios(id), item: o };
}

module.exports = { arqAcesso, confirmarCarrinho, excluirCarrinho, rascunho, salvarRascunho, apagarRascunho, RASCUNHO_DIAS, conjuntos, foraDeLinha, atualizarDisp, FORA_DE_LINHA_DIAS, obrigatorios, alterarObrig, ORIGENS, criarCodigo, lerCodigo, progresso, acesso, gravarAcesso, catalogo, carrinho, gravarEntrada, cfg, validarCfg, validarItens, EVENTOS };
