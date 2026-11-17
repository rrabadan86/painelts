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
    .map((c) => ({ id: c.id, nome: c.nome, criadoEm: c.criadoEm, por: c.por, cega: c.cega, st: c.st, itens: c.itens.length, contados: c.itens.filter((i) => i.cont != null).length, geradoEm: c.geradoEm || null, importadoEm: c.importadoEm || null }))
    .sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1));
}

/**
 * Catálogo para escolher o que contar: itens do estoque com grupo/subgrupo (cadastro do AppNext) e,
 * para o chá a granel (kg), o tipo de chá vindo das vendas dos pacotes (Rooibos aromatizado, Chá verde puro…).
 */
// grupos de venda que não são tipo de chá (lata, acessório, Tea Room…): não viram "tipo"
const NAO_CHA = /ACESS|ENVASAD|ALIMENT|TEA ROOM|TEA MOMENT|CONSUM|MATERIA|SACH|FIDELIDADE|KIT|PRESENTE|EMBALA|LATA/i;
function catalogo(estoque, tabela, vendas) {
  const tab = new Map(((tabela && tabela.itens) || []).map((i) => [String(i.cod), i]));
  const tipo = new Map(); // cod do estoque → tipo de chá
  if (vendas) {
    const vistos = new Set();
    for (const v of vendas) {
      if (!v.grupo || vistos.has(v.descricao) || NAO_CHA.test(v.grupo)) continue;
      vistos.add(v.descricao);
      for (const c of ESP.codsEstoque({ desc: v.descricao, cod: v.cod != null ? String(v.cod) : null }, estoque)) {
        const it = estoque.itens.find((x) => String(x.cod) === c);
        if (it && it.un === 'Kg' && !tipo.has(c)) tipo.set(c, v.grupo);
      }
    }
  }
  return ((estoque && estoque.itens) || []).map((i) => {
    const t = tab.get(String(i.cod)) || {};
    return { cod: String(i.cod), desc: i.desc, un: i.un || t.un || '', grupo: t.grupo || '', sub: t.sub || '', barras: t.barras || '', tipo: tipo.get(String(i.cod)) || '', qtd: i.qtd ?? 0, custo: i.custo ?? null };
  });
}

/** tipo de chá agrupado: "ROOIBOS AROMATIZADO" e "ROOIBOS PURO" → "Rooibos" (os dois também ficam como opção) */
const familia = (t) => {
  const s = String(t || '').toUpperCase().replace(/\s+(AROMATIZADO|PURO)$/, '').trim();
  return s ? s[0] + s.slice(1).toLowerCase().replace(/\bchá\b/gi, 'Chá') : '';
};

/** escolhe os itens pela forma pedida: cods (lista), grupo, subgrupo, tipo, familia, "comEstoque" */
function escolher(cat, b) {
  const cods = new Set((Array.isArray(b.cods) ? b.cods : []).map(String));
  const f = b.filtro || {};
  return cat.filter((i) => cods.has(i.cod)
    || (f.grupo && i.grupo === f.grupo && (!f.sub || i.sub === f.sub))
    || (f.tipo && i.tipo === f.tipo)
    || (f.familia && familia(i.tipo) === f.familia)
    || (f.tudoKg && i.un === 'Kg' && i.tipo));
}

function criar(id, b, por, cat, perfil) {
  const itens = escolher(cat, b || {});
  if (!itens.length) return { erro: 'Escolha pelo menos um item para contar.' };
  if (itens.length > 2000) return { erro: 'Itens demais numa contagem só (máximo 2.000).' };
  const c = {
    id: crypto.randomBytes(6).toString('hex'), nome: txt(b.nome, 80) || `Contagem de ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    criadoEm: new Date().toISOString(), por, cega: perfil === 'vendedor' ? true : !!b.cega, st: 'contando',
    itens: itens.map((i) => ({ cod: i.cod, desc: i.desc, un: i.un, grupo: i.grupo, sub: i.sub, tipo: i.tipo, barras: i.barras, sis: i.qtd, custo: i.custo, cont: null, por: null, em: null })),
  };
  gravar(id, c);
  return { ok: c };
}

/** quantidade contada: número >= 0 com até 3 casas (kg) ou null para apagar */
function contar(id, cid, cod, valor, por) {
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
  else if (a === 'cancelar') { if (c.st === 'importado') return { erro: 'Esta contagem já foi importada no AppNext.' }; c.st = 'cancelado'; c.canceladoEm = agora; c.canceladoPor = por; }
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

/**
 * Planilha no modelo do AppNext (mesmas colunas e títulos), só com os itens contados.
 * Nova Qtd = o que foi contado. Preço de Custo = o custo atual do estoque do painel (sem alteração de custo).
 */
async function planilha(c, nomeLoja, estoqueAtual) {
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
  const atual = new Map(((estoqueAtual && estoqueAtual.itens) || []).map((i) => [String(i.cod), i]));
  let r = 7;
  for (const i of c.itens) {
    if (i.cont == null) continue;
    const a = atual.get(i.cod);
    const row = ws.getRow(r++);
    row.values = [i.cod, i.desc, i.un, i.grupo || '', i.sub || null, a ? a.qtd ?? 0 : i.sis ?? 0, i.cont, a && a.custo != null ? a.custo : i.custo ?? 0];
    row.getCell(1).numFmt = '@';
    row.getCell(6).numFmt = '#,##0.000';
    row.getCell(7).numFmt = '#,##0.000';
    row.getCell(8).numFmt = '#,##0.00';
  }
  return wb.xlsx.writeBuffer();
}

function marcarGerado(id, cid, por) {
  const c = ler(id, cid);
  if (!c) return null;
  if (c.st === 'contando' || c.st === 'revisao') c.st = 'gerado';
  c.geradoEm = new Date().toISOString(); c.geradoPor = por;
  gravar(id, c);
  return c;
}

module.exports = { lista, ler, catalogo, familia, criar, contar, adicionar, acao, paraUsuario, planilha, marcarGerado };
