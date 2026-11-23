'use strict';
/**
 * Devolução ao fornecedor a partir de uma nota de ENTRADA (itens danificados, itens que não chegaram e itens com validade
 * curta na chegada — o aviso da nota de entrada preenche este mesmo formulário; regra do prazo em src/lotes.js, VALIDADE_MIN).
 *   dados/<loja>/devolucoes/destinatarios.json    e-mails que recebem a devolução (editável na tela)
 *   dados/<loja>/devolucoes/<id>/devolucao.json  o registro (quem, quando, nota, itens, situação do e-mail e da NF-e)
 *   dados/<loja>/devolucoes/<id>/foto-<n>-<k>.jpg  até 3 fotos de cada item danificado
 *   dados/<loja>/devolucoes/<id>/devolucao.xlsx  a planilha que vai no e-mail
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');

const pasta = (id) => path.join(C.pastaLoja(id), 'devolucoes');
const pastaDev = (id, did) => path.join(pasta(id), did);
const ID_OK = /^[a-f0-9]{12}$/;
const EMAIL = /^[^\s@<>,;]{1,64}@[^\s@<>,;]{1,190}\.[a-z]{2,}$/i;
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const lerJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

const ASSUNTO_PADRAO = 'Devolução · {loja} · NF {nf} · {fornecedor}';
function destinatarios(id) { return lerJ(path.join(pasta(id), 'destinatarios.json'), []); }
/** assunto do e-mail (editável em Configurações → Integrações): {loja} {nf} {fornecedor} {nfDevolucao} */
function assunto(id) { const a = lerJ(path.join(pasta(id), 'assunto.json'), null); return (a && a.assunto) || ASSUNTO_PADRAO; }
function salvarAssunto(id, a) {
  const t = txt(a, 160) || ASSUNTO_PADRAO;
  fs.mkdirSync(pasta(id), { recursive: true });
  C.gravarAtomico(path.join(pasta(id), 'assunto.json'), JSON.stringify({ assunto: t }), 0o640);
  return t;
}
function montarAssunto(id, d, nomeLoja) {
  const v = { loja: nomeLoja, nf: String(d.nota.nf), fornecedor: d.nota.fornecedor || '', nfDevolucao: d.nfe && d.nfe.numero ? String(d.nfe.numero) : '' };
  return assunto(id).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)).replace(/\s*·\s*(·|$)/g, '$1').replace(/\s{2,}/g, ' ').trim();
}
function salvarDestinatarios(id, lista) {
  const l = [...new Set((Array.isArray(lista) ? lista : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  const ruim = l.find((e) => !EMAIL.test(e));
  if (ruim) return { erro: `E-mail inválido: ${ruim}` };
  fs.mkdirSync(pasta(id), { recursive: true });
  C.gravarAtomico(path.join(pasta(id), 'destinatarios.json'), JSON.stringify(l), 0o640);
  return { ok: l };
}

/** foto em data URL (o navegador já reduz para JPEG): só JPEG, até ~900 KB */
function foto(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const b = Buffer.from(m[1], 'base64');
  if (b.length < 1000 || b.length > 900 * 1024 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  return b;
}

/**
 * nota = a nota de entrada (ES.notas); b = { itens: [{ cod, tipo: 'danificado'|'faltou'|'validade', qtd, obs, fotos: [dataUrl] }], obs }
 * ou por item { cod, qtdDanificado, qtdFaltou, qtdValidade, obs, obsFaltou, obsValidade, fotos } (as três partes no mesmo produto)
 */
/** a devolução ocupa quantidade da nota? (tudo, menos NF-e com erro ou cancelada) */
function contaComoDevolvido(d) {
  const n = (d && d.nfe) || {};
  return n.estado !== 'erro' && n.situacao !== 'cancelada';
}
function criar(id, nota, b, por) {
  if (!nota) return { erro: 'Nota de entrada não encontrada.' };
  const porCod = new Map(nota.itens.map((i) => [String(i.cod), i]));
  // desconta o que já está em outra devolução desta mesma nota: NF-e gravada (ok), concluída, em teste, na fila
  // ou ainda por emitir (pendente). Só não conta a que deu erro ou foi cancelada.
  const jaDevolvido = new Map();
  if (nota.id != null) {
    for (const ant of lista(id)) {
      if (String(ant.nota && ant.nota.id) !== String(nota.id) || !contaComoDevolvido(ant)) continue;
      for (const it of ant.itens || []) jaDevolvido.set(String(it.cod), (jaDevolvido.get(String(it.cod)) || 0) + (it.qtd || 0));
    }
  }
  const somaPorCod = new Map();
  const itens = [], fotos = [];
  // cada produto pode ter parte danificada e parte que não chegou (ex.: pediu 6, 2 quebrados e 4 faltaram)
  for (const x of Array.isArray(b.itens) ? b.itens.slice(0, 80) : []) {
    const cod = String(x.cod);
    const i = porCod.get(cod);
    if (!i) return { erro: `O item ${x.cod} não está nesta nota.` };
    const q = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
    const partes = x.qtdDanificado != null || x.qtdFaltou != null || x.qtdValidade != null;
    const dan = partes ? q(x.qtdDanificado) : x.tipo === 'faltou' || x.tipo === 'validade' ? 0 : q(x.qtd);
    const fal = partes ? q(x.qtdFaltou) : x.tipo === 'faltou' ? q(x.qtd) : 0;
    const val = partes ? q(x.qtdValidade) : x.tipo === 'validade' ? q(x.qtd) : 0; // validade curta na chegada: sem foto
    if (dan < 0 || fal < 0 || val < 0 || !(dan + fal + val > 0)) return { erro: `Informe a quantidade de ${i.nome}.` };
    const prev = jaDevolvido.get(cod) || 0;
    const acum = Math.round(((somaPorCod.get(cod) || 0) + dan + fal + val) * 1000) / 1000;
    if (acum + prev > (i.qtd || 0) + 1e-9) {
      return { erro: prev > 0 ? `${i.nome}: ${acum} + ${prev} já devolvidos em outra devolução desta nota passa da quantidade da nota (${i.qtd}).` : `${i.nome}: ${acum} passa da quantidade da nota (${i.qtd}).` };
    }
    somaPorCod.set(cod, acum);
    if (dan > 0) {
      const fs_ = (Array.isArray(x.fotos) ? x.fotos : []).slice(0, 3).map(foto);
      if (fs_.some((f) => !f)) return { erro: `Uma foto de ${i.nome} não é válida (use JPG ou PNG).` };
      if (!fs_.length) return { erro: `Anexe pelo menos 1 foto de ${i.nome} (danificado).` };
      itens.push({ cod: String(i.cod), nome: i.nome, un: i.un || '', tipo: 'danificado', qtd: dan, vu: i.vu ?? null, obs: txt(x.obs, 200), fotos: fs_.length });
      fotos.push(fs_);
    }
    if (fal > 0) { itens.push({ cod: String(i.cod), nome: i.nome, un: i.un || '', tipo: 'faltou', qtd: fal, vu: i.vu ?? null, obs: txt(x.obsFaltou, 200), fotos: 0 }); fotos.push([]); }
    if (val > 0) { itens.push({ cod: String(i.cod), nome: i.nome, un: i.un || '', tipo: 'validade', qtd: val, vu: i.vu ?? null, obs: txt(x.obsValidade, 200) || 'validade curta', fotos: 0 }); fotos.push([]); }
  }
  if (!itens.length) return { erro: 'Escolha pelo menos um item.' };
  const did = crypto.randomBytes(6).toString('hex');
  const dir = pastaDev(id, did);
  fs.mkdirSync(dir, { recursive: true });
  itens.forEach((it, n) => fotos[n].forEach((f, k) => C.gravarAtomico(path.join(dir, `foto-${n}-${k}.jpg`), f, 0o640)));
  const d = {
    id: did, em: new Date().toISOString(), por, obs: txt(b.obs, 400),
    nota: { id: nota.id, nf: nota.nf, serie: nota.serie, chave: nota.chave || '', emissao: nota.emissao, entrada: nota.entrada, fornecedor: nota.fornecedor, total: nota.total },
    itens, total: Math.round(itens.reduce((s, i) => s + (i.vu || 0) * i.qtd, 0) * 100) / 100,
    email: { estado: 'pendente' }, nfe: { estado: 'pendente' },
  };
  C.gravarAtomico(path.join(dir, 'devolucao.json'), JSON.stringify(d), 0o640);
  return { ok: d };
}
const ler = (id, did) => (ID_OK.test(did) ? lerJ(path.join(pastaDev(id, did), 'devolucao.json'), null) : null);
function atualizar(id, did, fn) { const d = ler(id, did); if (!d) return null; fn(d); C.gravarAtomico(path.join(pastaDev(id, did), 'devolucao.json'), JSON.stringify(d), 0o640); return d; }
function excluir(id, did) {
  const d = ler(id, did);
  if (!d) return null;
  try { fs.rmSync(pastaDev(id, did), { recursive: true, force: true }); } catch { /* ok */ }
  for (const s of ['.json', '.resultado.json']) { try { fs.unlinkSync(path.join(envioNfe(id), did + s)); } catch { /* ok */ } }
  return d;
}
function lista(id) {
  let ds = [];
  try { ds = fs.readdirSync(pasta(id)).filter((x) => ID_OK.test(x)); } catch { /* nenhuma */ }
  return ds.map((x) => ler(id, x)).filter(Boolean).sort((a, b) => (a.em < b.em ? 1 : -1));
}
const arqFoto = (id, did, n, k) => (ID_OK.test(did) && /^\d{1,2}$/.test(String(n)) && /^[0-2]$/.test(String(k)) ? path.join(pastaDev(id, did), `foto-${n}-${k}.jpg`) : null);

/** planilha da devolução: cabeçalho, itens danificados (com as fotos), itens que não chegaram */
async function planilha(id, d, nomeLoja) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Devolução', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 12 }, { width: 10 }, { width: 12 }, { width: 8 }, { width: 46 }, { width: 46 }];
  const verde = 'FF2C5234', bege = 'FFF4F1EA', borda = { style: 'thin', color: { argb: 'FFBFB8A6' } };
  const caixa = (c) => { c.border = { top: borda, left: borda, bottom: borda, right: borda }; c.alignment = { vertical: 'middle', wrapText: true }; };
  const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  ws.mergeCells('A1:F1');
  Object.assign(ws.getCell('A1'), { value: `Devolução ao fornecedor · ${nomeLoja}` });
  ws.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: verde } };
  ws.getRow(1).height = 26;
  const info = [['Fornecedor', d.nota.fornecedor || '—'], ['Nota fiscal', `${d.nota.nf}${d.nota.serie ? ' / série ' + d.nota.serie : ''} · emissão ${dataBR(d.nota.emissao)} · entrada ${dataBR(d.nota.entrada)}`],
    ['Registrado', `${dataBR(d.em)} por ${d.por}`], ...(d.obs ? [['Observação', d.obs]] : [])];
  let r = 2;
  for (const [k, v] of info) { ws.mergeCells(`B${r}:F${r}`); ws.getCell(`A${r}`).value = k; ws.getCell(`A${r}`).font = { bold: true }; ws.getCell(`B${r}`).value = v; r++; }
  const secao = (titulo, cols) => {
    r++;
    ws.mergeCells(`A${r}:F${r}`);
    const c = ws.getCell(`A${r}`); c.value = titulo; c.font = { bold: true, size: 12 }; c.alignment = { horizontal: 'center' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3DED2' } }; caixa(c);
    r++;
    cols.forEach((t, k) => { const h = ws.getRow(r).getCell(k + 1); h.value = t; h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: verde } }; caixa(h); h.alignment = { horizontal: 'center', vertical: 'middle' }; });
    r++;
  };
  const linha = (it, k) => {
    const vals = [dataBR(d.em), d.nota.nf, it.cod, it.qtd, it.nome, it.obs || (it.tipo === 'faltou' ? 'Não chegou no pedido' : '')];
    vals.forEach((v, j) => { const c = ws.getRow(r).getCell(j + 1); c.value = v; caixa(c); if (j < 4) c.alignment = { horizontal: 'center', vertical: 'middle' }; if (k % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bege } }; });
    ws.getRow(r).height = 20;
    r++;
  };
  const dan = d.itens.map((it, n) => ({ it, n })).filter((x) => x.it.tipo === 'danificado');
  const fal = d.itens.filter((it) => it.tipo === 'faltou'), val = d.itens.filter((it) => it.tipo === 'validade');
  secao('Incidência — itens quebrados / danificados', ['Data', 'NF', 'Código', 'Qtd', 'Produto', 'Problema']);
  if (dan.length) dan.forEach((x, k) => linha(x.it, k)); else { ws.mergeCells(`A${r}:F${r}`); ws.getCell(`A${r}`).value = 'Nenhum'; r++; }
  secao('Itens que estavam na nota, porém não chegaram no pedido', ['Data', 'NF', 'Código', 'Qtd', 'Produto', 'Observação']);
  if (fal.length) fal.forEach((it, k) => linha(it, k)); else { ws.mergeCells(`A${r}:F${r}`); ws.getCell(`A${r}`).value = 'Nenhum'; r++; }
  if (val.length) { secao('Itens que chegaram com validade curta', ['Data', 'NF', 'Código', 'Qtd', 'Produto', 'Validade']); val.forEach((it, k) => linha(it, k)); }
  // fotos: um bloco por item danificado
  if (dan.some((x) => x.it.fotos)) {
    r += 1;
    ws.mergeCells(`A${r}:F${r}`); ws.getCell(`A${r}`).value = 'Fotos dos itens danificados'; ws.getCell(`A${r}`).font = { bold: true, size: 12 }; r++;
    for (const { it, n } of dan) {
      if (!it.fotos) continue;
      ws.mergeCells(`A${r}:F${r}`); ws.getCell(`A${r}`).value = `${it.cod} · ${it.nome} (${it.qtd} ${it.un || 'un'})${it.obs ? ' — ' + it.obs : ''}`; ws.getCell(`A${r}`).font = { bold: true }; r++;
      for (let k = 0; k < it.fotos; k++) {
        const f = arqFoto(id, d.id, n, k);
        const img = wb.addImage({ buffer: fs.readFileSync(f), extension: 'jpeg' });
        ws.addImage(img, { tl: { col: [0, 4, 5][k], row: r - 1 }, ext: { width: 260, height: 195 } }); // A, E e F: não se sobrepõem
      }
      for (let j = 0; j < 10; j++) ws.getRow(r + j).height = 20;
      r += 11;
    }
  }
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  C.gravarAtomico(path.join(pastaDev(id, d.id), 'devolucao.xlsx'), buf, 0o640);
  return buf;
}

/** texto do e-mail */
function textoEmail(d, nomeLoja) {
  const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const dan = d.itens.filter((i) => i.tipo === 'danificado'), fal = d.itens.filter((i) => i.tipo === 'faltou'), val = d.itens.filter((i) => i.tipo === 'validade');
  const l = (i) => `• ${i.cod} · ${i.nome} · ${i.qtd} ${i.un || 'un'}${i.obs ? ' — ' + i.obs : ''}`;
  const nf = d.nfe && d.nfe.numero ? `NF-e de devolução nº ${d.nfe.numero} (em anexo, PDF e XML)` : null;
  return [`Olá,`, '', `A ${nomeLoja} registrou uma devolução referente à NF ${d.nota.nf}${d.nota.serie ? '/' + d.nota.serie : ''} (${d.nota.fornecedor || 'fornecedor'}, emissão ${dataBR(d.nota.emissao)}).`, ...(nf ? ['', nf + '.'] : []), '',
    ...(dan.length ? ['Itens quebrados / danificados:', ...dan.map(l), ''] : []),
    ...(fal.length ? ['Itens que estavam na nota, porém não chegaram:', ...fal.map(l), ''] : []),
    ...(val.length ? ['Itens que chegaram com validade curta:', ...val.map(l), ''] : []),
    ...(d.obs ? [`Observação: ${d.obs}`, ''] : []),
    `Em anexo: ${d.nfe && d.nfe.numero ? 'a NF-e de devolução (PDF e XML), ' : ''}a planilha da devolução e as fotos dos itens danificados.`, '', `${nomeLoja}`].join('\n');
}

// ---------- NF-e de devolução: o robô grava a saída de devolução no AppNext SEM concluir ----------
const envioNfe = (id) => path.join(C.pastaLoja(id), 'nfe', 'envio');
function pedirNfe(id, d, simular, emitir) {
  if (!/^[0-9a-f-]{36}$/.test(String(d.nota.id || ''))) return { erro: 'Esta nota não tem o id do AppNext (atualize as notas de entrada).' };
  // emitir (concluir e transmitir) só depois de um teste conferido há pouco: o robô confere se o total continua o mesmo
  let totalTeste = null;
  if (emitir) {
    if (!(d.nfe && d.nfe.estado === 'teste' && d.nfe.total != null && Date.now() - Date.parse(d.nfe.fim || d.nfe.em) < 2 * 3600e3)) return { erro: 'Para emitir, teste antes ("testar sem salvar") e confira o total: o teste vale por 2 horas.' };
    totalTeste = d.nfe.total;
    simular = false;
  }
  fs.mkdirSync(envioNfe(id), { recursive: true });
  try { fs.unlinkSync(path.join(envioNfe(id), d.id + '.resultado.json')); } catch { /* ok */ }
  C.gravarAtomico(path.join(envioNfe(id), d.id + '.json'), JSON.stringify({ cfop: require('./nfecfop').daLoja(id).devolucao || undefined, entradaId: d.nota.id, itens: [...d.itens.reduce((m, i) => m.set(i.cod, Math.round(((m.get(i.cod) || 0) + i.qtd) * 1000) / 1000), new Map())].map(([codigo, qtd]) => ({ codigo, qtd })), simular: !!simular, emitir: !!emitir, totalTeste }), 0o640);
  return { ok: atualizar(id, d.id, (x) => { x.nfe = { estado: 'na_fila', em: new Date().toISOString(), simular: !!simular, emitir: !!emitir }; }) };
}
/** resultado do robô para a NF-e de devolução */
function conferirNfe(id, d) {
  if (!d.nfe || d.nfe.estado !== 'na_fila') return d;
  const r = lerJ(path.join(envioNfe(id), d.id + '.resultado.json'), null);
  if (!r || !r.em || Date.parse(r.em) < Date.parse(d.nfe.em)) return d;
  if (r.nota && Array.isArray(r.nota.regras) && r.nota.regras.length) {
    try { require('./nfecfop').guardarRegrasDev(id, r.nota.regras, r.em); } catch (e) { console.error('[devolução] regras:', C.msgErro(e)); }
  }
  return atualizar(id, d.id, (x) => {
    // emitida = concluída e autorizada pela SEFAZ (o e-mail sai quando o XML chegar); concluida = concluída mas não transmitida
    x.nfe = { ...x.nfe, fim: r.em, estado: r.ok ? (r.simulado ? 'teste' : 'ok') : r.concluida ? 'concluida' : 'erro', erro: r.ok ? undefined : r.erro || 'falhou', cfop: r.nota && r.nota.cfop, regra: r.nota && r.nota.regra ? String(r.nota.regra).slice(0, 80) : undefined, total: r.nota && r.nota.total, chaveRef: (r.nota && r.nota.chaveRef) || x.nfe.chaveRef, saidaId: (r.nota && r.nota.saidaId) || x.nfe.saidaId,
      emitida: r.emitida && r.nfe ? { numero: r.nfe.numero, serie: r.nfe.serie, chave: r.nfe.chave, protocolo: r.nfe.protocolo } : x.nfe.emitida };
  });
}
function erroNfe(id, did, erro) { return atualizar(id, did, (x) => { x.nfe = { ...(x.nfe || {}), estado: 'erro', erro, fim: new Date().toISOString() }; }); }

module.exports = { contaComoDevolvido, ASSUNTO_PADRAO, assunto, salvarAssunto, montarAssunto, pedirNfe, conferirNfe, erroNfe, destinatarios, salvarDestinatarios, criar, ler, atualizar, excluir, lista, arqFoto, planilha, textoEmail, pastaDev };
