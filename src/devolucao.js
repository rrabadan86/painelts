'use strict';
/**
 * Devolução ao fornecedor a partir de uma nota de ENTRADA (itens danificados e itens que não chegaram).
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

function destinatarios(id) { return lerJ(path.join(pasta(id), 'destinatarios.json'), []); }
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
 * nota = a nota de entrada (ES.notas); b = { itens: [{ cod, tipo: 'danificado'|'faltou', qtd, obs, fotos: [dataUrl] }], obs }
 */
function criar(id, nota, b, por) {
  if (!nota) return { erro: 'Nota de entrada não encontrada.' };
  const porCod = new Map(nota.itens.map((i) => [String(i.cod), i]));
  const itens = [], fotos = [];
  // cada produto pode ter parte danificada e parte que não chegou (ex.: pediu 6, 2 quebrados e 4 faltaram)
  for (const x of Array.isArray(b.itens) ? b.itens.slice(0, 80) : []) {
    const i = porCod.get(String(x.cod));
    if (!i) return { erro: `O item ${x.cod} não está nesta nota.` };
    const q = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
    const dan = x.qtdDanificado != null || x.qtdFaltou != null ? q(x.qtdDanificado) : x.tipo === 'faltou' ? 0 : q(x.qtd);
    const fal = x.qtdDanificado != null || x.qtdFaltou != null ? q(x.qtdFaltou) : x.tipo === 'faltou' ? q(x.qtd) : 0;
    if (dan < 0 || fal < 0 || !(dan + fal > 0)) return { erro: `Informe a quantidade de ${i.nome}.` };
    if (dan + fal > (i.qtd || 0) + 1e-9) return { erro: `${i.nome}: ${dan + fal} passa da quantidade da nota (${i.qtd}).` };
    if (dan > 0) {
      const fs_ = (Array.isArray(x.fotos) ? x.fotos : []).slice(0, 3).map(foto);
      if (fs_.some((f) => !f)) return { erro: `Uma foto de ${i.nome} não é válida (use JPG ou PNG).` };
      if (!fs_.length) return { erro: `Anexe pelo menos 1 foto de ${i.nome} (danificado).` };
      itens.push({ cod: String(i.cod), nome: i.nome, un: i.un || '', tipo: 'danificado', qtd: dan, vu: i.vu ?? null, obs: txt(x.obs, 200), fotos: fs_.length });
      fotos.push(fs_);
    }
    if (fal > 0) { itens.push({ cod: String(i.cod), nome: i.nome, un: i.un || '', tipo: 'faltou', qtd: fal, vu: i.vu ?? null, obs: txt(x.obsFaltou, 200), fotos: 0 }); fotos.push([]); }
  }
  if (!itens.length) return { erro: 'Escolha pelo menos um item.' };
  const did = crypto.randomBytes(6).toString('hex');
  const dir = pastaDev(id, did);
  fs.mkdirSync(dir, { recursive: true });
  itens.forEach((it, n) => fotos[n].forEach((f, k) => fs.writeFileSync(path.join(dir, `foto-${n}-${k}.jpg`), f)));
  const d = {
    id: did, em: new Date().toISOString(), por, obs: txt(b.obs, 400),
    nota: { id: nota.id, nf: nota.nf, serie: nota.serie, emissao: nota.emissao, entrada: nota.entrada, fornecedor: nota.fornecedor, total: nota.total },
    itens, total: Math.round(itens.reduce((s, i) => s + (i.vu || 0) * i.qtd, 0) * 100) / 100,
    email: { estado: 'pendente' }, nfe: { estado: 'pendente' },
  };
  C.gravarAtomico(path.join(dir, 'devolucao.json'), JSON.stringify(d), 0o640);
  return { ok: d };
}
const ler = (id, did) => (ID_OK.test(did) ? lerJ(path.join(pastaDev(id, did), 'devolucao.json'), null) : null);
function atualizar(id, did, fn) { const d = ler(id, did); if (!d) return null; fn(d); C.gravarAtomico(path.join(pastaDev(id, did), 'devolucao.json'), JSON.stringify(d), 0o640); return d; }
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
  const fal = d.itens.filter((it) => it.tipo === 'faltou');
  secao('Incidência — itens quebrados / danificados', ['Data', 'NF', 'Código', 'Qtd', 'Produto', 'Problema']);
  if (dan.length) dan.forEach((x, k) => linha(x.it, k)); else { ws.mergeCells(`A${r}:F${r}`); ws.getCell(`A${r}`).value = 'Nenhum'; r++; }
  secao('Itens que estavam na nota, porém não chegaram no pedido', ['Data', 'NF', 'Código', 'Qtd', 'Produto', 'Observação']);
  if (fal.length) fal.forEach((it, k) => linha(it, k)); else { ws.mergeCells(`A${r}:F${r}`); ws.getCell(`A${r}`).value = 'Nenhum'; r++; }
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
  fs.writeFileSync(path.join(pastaDev(id, d.id), 'devolucao.xlsx'), buf);
  return buf;
}

/** texto do e-mail */
function textoEmail(d, nomeLoja) {
  const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const dan = d.itens.filter((i) => i.tipo === 'danificado'), fal = d.itens.filter((i) => i.tipo === 'faltou');
  const l = (i) => `• ${i.cod} · ${i.nome} · ${i.qtd} ${i.un || 'un'}${i.obs ? ' — ' + i.obs : ''}`;
  return [`Olá,`, '', `A ${nomeLoja} registrou uma devolução referente à NF ${d.nota.nf}${d.nota.serie ? '/' + d.nota.serie : ''} (${d.nota.fornecedor || 'fornecedor'}, emissão ${dataBR(d.nota.emissao)}).`, '',
    ...(dan.length ? ['Itens quebrados / danificados:', ...dan.map(l), ''] : []),
    ...(fal.length ? ['Itens que estavam na nota, porém não chegaram:', ...fal.map(l), ''] : []),
    ...(d.obs ? [`Observação: ${d.obs}`, ''] : []),
    'Em anexo: a planilha da devolução e as fotos dos itens danificados.', '', `${nomeLoja}`].join('\n');
}

// ---------- NF-e de devolução: o robô grava a saída de devolução no AppNext SEM concluir ----------
const envioNfe = (id) => path.join(C.pastaLoja(id), 'nfe', 'envio');
function pedirNfe(id, d, simular) {
  if (!/^[0-9a-f-]{36}$/.test(String(d.nota.id || ''))) return { erro: 'Esta nota não tem o id do AppNext (atualize as notas de entrada).' };
  fs.mkdirSync(envioNfe(id), { recursive: true });
  try { fs.unlinkSync(path.join(envioNfe(id), d.id + '.resultado.json')); } catch { /* ok */ }
  fs.writeFileSync(path.join(envioNfe(id), d.id + '.json'), JSON.stringify({ entradaId: d.nota.id, itens: [...d.itens.reduce((m, i) => m.set(i.cod, Math.round(((m.get(i.cod) || 0) + i.qtd) * 1000) / 1000), new Map())].map(([codigo, qtd]) => ({ codigo, qtd })), simular: !!simular }));
  return { ok: atualizar(id, d.id, (x) => { x.nfe = { estado: 'na_fila', em: new Date().toISOString(), simular: !!simular }; }) };
}
/** resultado do robô para a NF-e de devolução */
function conferirNfe(id, d) {
  if (!d.nfe || d.nfe.estado !== 'na_fila') return d;
  const r = lerJ(path.join(envioNfe(id), d.id + '.resultado.json'), null);
  if (!r || !r.em || Date.parse(r.em) < Date.parse(d.nfe.em)) return d;
  return atualizar(id, d.id, (x) => {
    x.nfe = { ...x.nfe, fim: r.em, estado: r.ok ? (r.simulado ? 'teste' : 'ok') : 'erro', erro: r.ok ? undefined : r.erro || 'falhou', cfop: r.nota && r.nota.cfop, total: r.nota && r.nota.total };
  });
}
function erroNfe(id, did, erro) { return atualizar(id, did, (x) => { x.nfe = { ...(x.nfe || {}), estado: 'erro', erro, fim: new Date().toISOString() }; }); }

module.exports = { pedirNfe, conferirNfe, erroNfe, destinatarios, salvarDestinatarios, criar, ler, atualizar, lista, arqFoto, planilha, textoEmail, pastaDev };
