'use strict';
/**
 * Inventário (Estoque → Inventário): contar o estoque pelo celular ou pelo computador — um item, um grupo,
 * um tipo de chá (Rooibos, Chá verde…) ou uma lista própria — e gerar a planilha de inventário do AppNext
 * (Estoque → Auditoria/Inventário → Novo → Por Excel) só com os itens contados.
 *   dados/<loja>/inventario/<id>.json
 * Contagem: { id, nome, criadoEm, por, cega, st: contando | revisao | gerado | importado | cancelado,
 *   itens: [{ cod, desc, un, grupo, sub, tipo, sis, custo, cont, por, em }], geradoEm, geradoPor, importadoEm }
 * "sis" = quantidade no estoque do painel quando a contagem começou. Contagem cega: quem conta não vê "sis".
 * O painel não mexe no AppNext: a planilha é importada por quem usa o AppNext.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');
const ESP = require('./espera');

const pasta = (id) => path.join(C.pastaLoja(id), 'inventario');
const arq = (id, cid) => path.join(pasta(id), `${cid}.json`);
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const ID = /^[a-f0-9]{12}$/;

function ler(id, cid) {
  if (!ID.test(String(cid))) return null;
  try { return JSON.parse(fs.readFileSync(arq(id, cid), 'utf8')); } catch { return null; }
}
function gravar(id, c) { fs.mkdirSync(pasta(id), { recursive: true }); C.gravarAtomico(arq(id, c.id), JSON.stringify(c), 0o640); }
function lista(id) {
  let fsx = [];
  try { fsx = fs.readdirSync(pasta(id)).filter((f) => /^[a-f0-9]{12}\.json$/.test(f)); } catch { return []; }
  return fsx.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(pasta(id), f), 'utf8')); } catch { return null; } }).filter(Boolean)
    .map((c) => ({ id: c.id, nome: c.nome, criadoEm: c.criadoEm, por: c.por, cega: c.cega, st: c.st, itens: c.itens.length, contados: c.itens.filter((i) => i.cont != null).length, geradoEm: c.geradoEm || null, importadoEm: c.importadoEm || null, importadoPor: c.importadoPor || null, zerar: !!(c.zerar && c.zerar.ativo),
      ajuste: c.planilha ? c.planilha.itens.reduce((s, l) => s + (l.nova - l.antes) * (l.custo || 0), 0) : null, naPlanilha: c.planilha ? c.planilha.itens.length : null, zerados: c.planilha ? c.planilha.itens.filter((l) => l.zerado).length : null, revertidoEm: c.desfazer && c.desfazer.importadoEm || null }))
    .sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1));
}

/**
 * Catálogo para escolher o que contar: itens do estoque com grupo/subgrupo (cadastro do AppNext) e,
 * para o chá a granel (kg), o tipo de chá vindo das vendas dos pacotes (Rooibos aromatizado, Chá verde puro…).
 */
// grupos de venda que não são tipo de chá (lata, acessório, Tea Room…): não viram "tipo"
const NAO_CHA = /ACESS|ENVASAD|ALIMENT|TEA ROOM|TEA MOMENT|CONSUM|MATERIA|SACH|FIDELIDADE|KIT|PRESENTE|EMBALA|LATA/i;
const catCache = new Map();
function catalogo(estoque, tabela, vendas) {
  const estItens = (estoque && estoque.itens) || [];
  const tabItens = (tabela && tabela.itens) || [];
  const chave = estoque && estoque.em && tabela && tabela.simples && tabela.simples.em
    ? `${estoque.em}|${estItens.length}|${tabela.simples.em}|${(tabela.compostos && tabela.compostos.em) || ''}|${tabItens.length}|${vendas ? vendas.length : 0}|${vendas && vendas.length ? vendas[vendas.length - 1].data : ''}`
    : null;
  if (chave && catCache.has(chave)) return catCache.get(chave);
  const tab = new Map(tabItens.map((i) => [String(i.cod), i]));
  const porCod = new Map(estItens.map((i) => [String(i.cod), i]));
  const tipo = new Map(); // cod do estoque → tipo de chá
  if (vendas) {
    const vistos = new Set();
    for (const v of vendas) {
      if (!v.grupo || vistos.has(v.descricao) || NAO_CHA.test(v.grupo)) continue;
      vistos.add(v.descricao);
      for (const c of ESP.codsEstoque({ desc: v.descricao, cod: v.cod != null ? String(v.cod) : null }, estoque)) {
        const it = porCod.get(c);
        if (it && it.un === 'Kg' && !tipo.has(c)) tipo.set(c, v.grupo);
      }
    }
  }
  const out = estItens.map((i) => {
    const t = tab.get(String(i.cod)) || {};
    return { cod: String(i.cod), desc: i.desc, un: i.un || t.un || '', grupo: t.grupo || '', sub: t.sub || '', barras: t.barras || '', tipo: tipo.get(String(i.cod)) || '', qtd: i.qtd ?? 0, custo: i.custo ?? null };
  });
  if (chave) {
    if (catCache.size >= 24) catCache.delete(catCache.keys().next().value);
    catCache.set(chave, out);
  }
  return out;
}

/** tipo de chá agrupado: "ROOIBOS AROMATIZADO" e "ROOIBOS PURO" → "Rooibos" (os dois também ficam como opção) */
const familia = (t) => {
  const s = String(t || '').toUpperCase().replace(/\s+(AROMATIZADO|PURO)$/, '').trim();
  return s ? s[0] + s.slice(1).toLowerCase().replace(/\bchá\b/gi, 'Chá') : '';
};

/** escolhe os itens pela forma pedida: cods (lista), grupo, subgrupo, tipo, familia, "comEstoque" */
/** chá a granel do estoque (kg): com estoque no sistema ou que vende — independente de ter vendido no período */
const ehChaGranel = (i) => i.un === 'Kg' && (Math.abs(Number(i.qtd) || 0) > 0.0005 || !!i.tipo);
/**
 * Até onde vai o "zerar os produtos que não estão nesta contagem": o mesmo recorte da contagem
 * (todos os chás a granel → só chá a granel; um grupo → só o grupo; um tipo de chá → só esse tipo).
 * "Alguns produtos" = a loja inteira (como antes).
 */
function escopoDe(b) {
  const f = (b && b.filtro) || {};
  if (f.tudoKg) return { kg: true };
  if (f.grupo) return { grupo: txt(f.grupo, 80), ...(f.sub ? { sub: txt(f.sub, 80) } : {}) };
  if (f.tipo) return { tipo: txt(f.tipo, 80) };
  if (f.familia) return { familia: txt(f.familia, 80) };
  return null;
}
const noEscopo = (esc, i) => !esc || (esc.kg ? i.un === 'Kg' : esc.grupo ? i.grupo === esc.grupo && (!esc.sub || i.sub === esc.sub) : esc.tipo ? i.tipo === esc.tipo : esc.familia ? familia(i.tipo) === esc.familia : true);
function escolher(cat, b) {
  const cods = new Set((Array.isArray(b.cods) ? b.cods : []).map(String));
  const f = b.filtro || {};
  return cat.filter((i) => cods.has(i.cod)
    || (f.grupo && i.grupo === f.grupo && (!f.sub || i.sub === f.sub))
    || (f.tipo && i.tipo === f.tipo)
    || (f.familia && familia(i.tipo) === f.familia)
    || (f.tudoKg && ehChaGranel(i)));
}

function criar(id, b, por, cat, perfil) {
  const itens = escolher(cat, b || {});
  if (!itens.length) return { erro: 'Escolha pelo menos um item para contar.' };
  if (itens.length > 2000) return { erro: 'Itens demais numa contagem só (máximo 2.000).' };
  const c = {
    id: crypto.randomBytes(6).toString('hex'), nome: txt(b.nome, 80) || `Contagem de ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    criadoEm: new Date().toISOString(), por, cega: perfil === 'vendedor' ? true : !!b.cega, st: 'contando', semContarZero: true /* item não contado = 0 */, zerar: { ativo: perfil !== 'vendedor' && !!b.zerarResto, semGrupos: null, escopo: escopoDe(b) },
    itens: itens.map((i) => ({ cod: i.cod, desc: i.desc, un: i.un, grupo: i.grupo, sub: i.sub, tipo: i.tipo, barras: i.barras, sis: i.qtd, custo: i.custo, cont: null, por: null, em: null })),
  };
  gravar(id, c);
  return { ok: c };
}

/** quantidade contada: número >= 0 com até 3 casas (kg) ou null para apagar */
function contar(id, cid, cod, valor, por, lotes) {
  const c = ler(id, cid);
  if (!c) return { erro: 'Contagem não encontrada.' };
  if (c.st !== 'contando' && c.st !== 'revisao') return { erro: 'Esta contagem já foi fechada. Reabra para mudar.' };
  const it = c.itens.find((i) => i.cod === String(cod));
  if (!it) return { erro: 'Item fora desta contagem.' };
  let v = null;
  if (valor !== null && valor !== '' && valor !== undefined) {
    v = Number(String(valor).replace(',', '.'));
    if (!Number.isFinite(v) || v < 0 || v > 1e6) return { erro: 'Quantidade inválida.' };
    v = Math.round(v * 1000) / 1000;
    if (it.un !== 'Kg' && it.un !== 'kg' && !Number.isInteger(v)) return { erro: `${it.desc} é contado em ${it.un || 'unidades'}: use número inteiro.` };
  }
  // chá a granel contado por lote: { chave do lote: kg } (Estoque → Validade); o total é a soma
  if (lotes && typeof lotes === 'object' && !Array.isArray(lotes) && Object.keys(lotes).length) {
    if (it.un !== 'Kg' && it.un !== 'kg') return { erro: 'Só o chá a granel é contado por lote.' };
    const ls = {};
    for (const [k, q] of Object.entries(lotes).slice(0, 30)) {
      if (!/^[\w.|-]{3,80}$/.test(k)) return { erro: 'Lote inválido.' };
      const x = Math.round(Number(q) * 1000) / 1000;
      if (!Number.isFinite(x) || x < 0 || x > 1e4) return { erro: 'Quantidade inválida no lote.' };
      if (x > 0) ls[k] = x;
    }
    v = Math.round(Object.values(ls).reduce((s, x) => s + x, 0) * 1000) / 1000;
    it.lotes = ls;
  } else delete it.lotes;
  it.cont = v; it.por = v == null ? null : por; it.em = v == null ? null : new Date().toISOString();
  gravar(id, c);
  return { ok: it };
}

function adicionar(id, cid, cods, cat) {
  const c = ler(id, cid);
  if (!c) return { erro: 'Contagem não encontrada.' };
  if (c.st !== 'contando') return { erro: 'Só dá para incluir itens enquanto a contagem está aberta.' };
  const tem = new Set(c.itens.map((i) => i.cod));
  for (const i of escolher(cat, { cods })) if (!tem.has(i.cod)) c.itens.push({ cod: i.cod, desc: i.desc, un: i.un, grupo: i.grupo, sub: i.sub, tipo: i.tipo, barras: i.barras, sis: i.qtd, custo: i.custo, cont: null, por: null, em: null });
  gravar(id, c);
  return { ok: c };
}

function acao(id, cid, a, por) {
  const c = ler(id, cid);
  if (!c) return { erro: 'Contagem não encontrada.' };
  const agora = new Date().toISOString();
  if (a === 'revisar') { if (c.st !== 'contando') return { erro: 'A contagem não está aberta.' }; c.st = 'revisao'; c.revisaoEm = agora; }
  else if (a === 'reabrir') { if (!['revisao', 'gerado', 'cancelado'].includes(c.st)) return { erro: 'Não dá para reabrir.' }; c.st = 'contando'; }
  else if (a === 'importado') { if (c.st !== 'gerado') return { erro: 'Gere a planilha antes.' }; c.st = 'importado'; c.importadoEm = agora; c.importadoPor = por; }
  else if (a === 'cancelar') { if (c.st === 'importado' || c.st === 'revertido') return { erro: 'Esta contagem já foi importada no AppNext.' }; c.st = 'cancelado'; c.canceladoEm = agora; c.canceladoPor = por; }
  else return { erro: 'Ação inválida.' };
  gravar(id, c);
  return { ok: c };
}

/** versão para quem conta: sem a quantidade do sistema nem custo na contagem cega (e nunca custo para vendedora) */
function paraUsuario(c, perfil) {
  const esconde = c.cega && perfil === 'vendedor';
  const semCusto = perfil === 'vendedor';
  return { ...c, itens: c.itens.map((i) => ({ ...i, sis: esconde ? null : i.sis, custo: semCusto ? null : i.custo })) };
}

/** grupo que, por padrão, NÃO é zerado junto (não tem controle de estoque) */
const SEM_CONTROLE = /SEM CONTROLE/i;
/**
 * Itens fora da contagem que seriam zerados ("zerar os produtos não listados"): todos do estoque com quantidade
 * diferente de zero, menos os grupos desmarcados. cat = catálogo (para o grupo).
 */
function resto(c, estoque, cat) {
  const na = new Set(c.itens.map((i) => i.cod));
  const g = new Map((cat || []).map((i) => [i.cod, i]));
  const esc = c.zerar && c.zerar.escopo;
  return ((estoque && estoque.itens) || []).filter((i) => !na.has(String(i.cod)) && Math.abs(i.qtd || 0) > 0.0005)
    .map((i) => { const x = g.get(String(i.cod)) || {}; return { cod: String(i.cod), desc: i.desc, un: i.un, grupo: x.grupo || '', sub: x.sub || '', tipo: x.tipo || '', qtd: i.qtd, custo: i.custo ?? null }; })
    .filter((i) => noEscopo(esc, i)); // só o recorte da contagem (ex.: chá a granel), nunca a loja inteira sem querer
}
const zerarOpcao = (c) => c.zerar || { ativo: false, semGrupos: null };
/** grupos que ficam de fora do "zerar": escolha da pessoa, ou por padrão os "sem controle de estoque" */
const gruposFora = (c, itens) => { const z = zerarOpcao(c); return new Set(Array.isArray(z.semGrupos) ? z.semGrupos : [...new Set(itens.map((i) => i.grupo).filter((x) => SEM_CONTROLE.test(x)))]); };

function zerar(id, cid, b) {
  const c = ler(id, cid);
  if (!c) return { erro: 'Contagem não encontrada.' };
  if (c.st === 'importado' || c.st === 'revertido') return { erro: 'Esta contagem já foi importada.' };
  c.zerar = { ativo: !!b.ativo, semGrupos: Array.isArray(b.semGrupos) ? b.semGrupos.map((x) => txt(x, 80)).slice(0, 200) : null, escopo: (c.zerar && c.zerar.escopo) || null };
  gravar(id, c);
  return { ok: c.zerar };
}

/** linhas da planilha: os contados (Nova Qtd = contado) e, com "zerar", os de fora com quantidade (Nova Qtd = 0) */
function linhasPlanilha(c, estoque, cat) {
  const atual = new Map(((estoque && estoque.itens) || []).map((i) => [String(i.cod), i]));
  const out = [];
  for (const i of c.itens) {
    const a = atual.get(i.cod);
    const antes = a ? a.qtd ?? 0 : i.sis ?? 0;
    // item da contagem que ninguém contou: vai como 0 (contagens novas); se o sistema já tem 0, não precisa ir
    if (i.cont == null && !(c.semContarZero && Math.abs(antes) > 0.0005)) continue;
    out.push({ cod: i.cod, desc: i.desc, un: i.un, grupo: i.grupo || '', sub: i.sub || '', antes, nova: i.cont ?? 0, custo: a && a.custo != null ? a.custo : i.custo ?? 0, zerado: false, naoContado: i.cont == null });
  }
  if (zerarOpcao(c).ativo) {
    const r = resto(c, estoque, cat), fora = gruposFora(c, r);
    for (const i of r) if (!fora.has(i.grupo)) out.push({ cod: i.cod, desc: i.desc, un: i.un, grupo: i.grupo, sub: i.sub, antes: i.qtd, nova: 0, custo: i.custo ?? 0, zerado: true });
  }
  return out;
}

/** planilha no modelo do AppNext (mesmas colunas e títulos) a partir das linhas */
async function planilha(linhas) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inventário');
  ws.columns = [{ width: 10.1 }, { width: 58.4 }, { width: 8.4 }, { width: 42.1 }, { width: 35.6 }, { width: 10.4 }, { width: 10 }, { width: 14.4 }];
  ws.getCell('A1').value = 'Modelo de arquivo Excel para inventario';
  ws.mergeCells('A1:H1');
  ws.getCell('A2').value = '* Itens sem quantidade especificada ou com quantidade negativa, serão ignorados no inventário. \n* A separação das casas decimais nos itens fracionados deve ser realizada por virgula (,). \n* A atualização do custo só ocorrerá quando o produto possuir quantidade informada no inventário. \n* Para atualizar o custo, alterar o valor na coluna "Preço de Custo".';
  ws.mergeCells('A2:H5');
  ws.getCell('A2').alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(6).values = ['Código', 'Descrição', 'Unidade', 'Grupo', 'Subgrupo', 'Qtd. Atual', 'Nova Qtd.', 'Preço de Custo'];
  ws.getRow(6).font = { bold: true };
  let r = 7;
  for (const l of linhas) {
    const row = ws.getRow(r++);
    row.values = [l.cod, l.desc, l.un, l.grupo || '', l.sub || null, l.antes ?? 0, l.nova, l.custo ?? 0];
    row.getCell(1).numFmt = '@';
    row.getCell(6).numFmt = '#,##0.000';
    row.getCell(7).numFmt = '#,##0.000';
    row.getCell(8).numFmt = '#,##0.00';
  }
  return wb.xlsx.writeBuffer();
}

/** guarda o que foi para o AppNext (para o histórico e para desfazer) */
function marcarGerado(id, cid, por, linhas) {
  const c = ler(id, cid);
  if (!c) return null;
  if (c.st === 'contando' || c.st === 'revisao') c.st = 'gerado';
  c.geradoEm = new Date().toISOString(); c.geradoPor = por;
  c.planilha = { em: c.geradoEm, por, itens: linhas.map((l) => ({ cod: l.cod, desc: l.desc, un: l.un, grupo: l.grupo, sub: l.sub, antes: l.antes, nova: l.nova, custo: l.custo, zerado: !!l.zerado })) };
  gravar(id, c);
  return c;
}

/**
 * Desfazer (rollback): volta cada item da planilha importada ao que era antes, mantendo o que aconteceu depois
 * (venda, entrada): nova = agora − (contado − antes). Se o estoque do painel ainda é de antes da importação,
 * "agora" é o que foi importado, e o resultado é a quantidade de antes.
 */
function linhasDesfazer(c, estoque) {
  if (!c.planilha) return null;
  const atual = new Map(((estoque && estoque.itens) || []).map((i) => [String(i.cod), i]));
  const depois = estoque && estoque.em && c.importadoEm && Date.parse(estoque.em) > Date.parse(c.importadoEm);
  return c.planilha.itens.map((l) => {
    const a = atual.get(l.cod);
    const agora = depois && a ? a.qtd ?? 0 : l.nova;
    const nova = Math.max(0, Math.round((agora - (l.nova - l.antes)) * 1000) / 1000);
    return { ...l, antes: agora, nova, custo: a && a.custo != null ? a.custo : l.custo, zerado: false };
  });
}
function marcarDesfazer(id, cid, por, etapa) {
  const c = ler(id, cid);
  if (!c) return { erro: 'Contagem não encontrada.' };
  if (etapa === 'gerado') { if (c.st !== 'importado') return { erro: 'Só dá para desfazer uma contagem importada.' }; c.desfazer = { geradoEm: new Date().toISOString(), por }; }
  else if (etapa === 'importado') { if (!c.desfazer) return { erro: 'Baixe a planilha de desfazer antes.' }; c.desfazer.importadoEm = new Date().toISOString(); c.desfazer.importadoPor = por; c.st = 'revertido'; }
  gravar(id, c);
  return { ok: c };
}

// ---------- enviar direto para o AppNext (robô do coletor) ----------
const pastaEnvio = (id) => path.join(pasta(id), 'envio');
/** deixa a planilha e a lista do que tem de ser lido (código → quantidade) para o robô; grava o envio na contagem */
async function prepararEnvio(id, cid, tipo, linhas, por) {
  if (!ler(id, cid)) return { erro: 'Contagem não encontrada.' };
  fs.mkdirSync(pastaEnvio(id), { recursive: true });
  const base = path.join(pastaEnvio(id), `${cid}-${tipo}`);
  try { fs.unlinkSync(base + '.resultado.json'); } catch { /* ok */ }
  const buf = Buffer.from(await planilha(linhas));
  C.gravarAtomico(base + '.xlsx', buf, 0o640);
  C.gravarAtomico(base + '.json', JSON.stringify(linhas.map((l) => ({ cod: l.cod, nova: l.nova }))), 0o640);
  const c = ler(id, cid);
  if (!c) return { erro: 'Contagem não encontrada.' };
  if (tipo === 'importar') {
    c.planilha = { em: new Date().toISOString(), por, itens: linhas.map((l) => ({ cod: l.cod, desc: l.desc, un: l.un, grupo: l.grupo, sub: l.sub, antes: l.antes, nova: l.nova, custo: l.custo, zerado: !!l.zerado })) };
    c.geradoEm = c.planilha.em; c.geradoPor = por;
    if (c.st === 'contando' || c.st === 'revisao') c.st = 'gerado';
  } else c.desfazer = { geradoEm: new Date().toISOString(), por };
  c.envio = { tipo, em: new Date().toISOString(), por, itens: linhas.length, estado: 'na_fila' };
  gravar(id, c);
  return { ok: c };
}
/** resultado do robô: importado (ou desfeito) quando deu certo; o erro fica no envio */
function conferirEnvio(id, cid) {
  const c = ler(id, cid);
  if (!c || !c.envio || c.envio.estado === 'ok' || c.envio.estado === 'erro') return { c, mudou: false };
  let r;
  try { r = JSON.parse(fs.readFileSync(path.join(pastaEnvio(id), `${cid}-${c.envio.tipo}.resultado.json`), 'utf8')); } catch { return { c, mudou: false }; }
  if (!r.em || Date.parse(r.em) < Date.parse(c.envio.em)) return { c, mudou: false };
  if (r.ok && !r.simulado) {
    c.envio.estado = 'ok'; c.envio.fim = r.em;
    if (c.envio.tipo === 'importar') { c.st = 'importado'; c.importadoEm = r.em; c.importadoPor = c.envio.por; c.importadoPeloRobo = true; }
    else { c.desfazer = { ...(c.desfazer || {}), importadoEm: r.em, importadoPor: c.envio.por }; c.st = 'revertido'; }
  } else { c.envio.estado = 'erro'; c.envio.erro = r.erro || (r.simulado ? 'simulação' : 'falhou'); c.envio.fim = r.em; }
  gravar(id, c);
  return { c, mudou: true, ok: c.envio.estado === 'ok' };
}

function erroEnvio(id, cid, erro) { const c = ler(id, cid); if (c && c.envio) { c.envio.estado = 'erro'; c.envio.erro = erro; c.envio.fim = new Date().toISOString(); gravar(id, c); } }

module.exports = { ehChaGranel, escopoDe, erroEnvio, prepararEnvio, conferirEnvio, lista, ler, catalogo, familia, criar, contar, adicionar, acao, paraUsuario, planilha, linhasPlanilha, marcarGerado, resto, zerar, gruposFora, linhasDesfazer, marcarDesfazer };
