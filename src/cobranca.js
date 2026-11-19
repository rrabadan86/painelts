'use strict';
/**
 * E-mails de cobrança à franquia (Notas fiscais → Créditos com a franquia):
 *   devolucoes — NF-e de devolução que ainda não vieram como desconto numa nota de compra;
 *   fidelidade — meses de prêmios de fidelidade sem o desconto nos royalties (ou que vieram a menos).
 * A pessoa revisa (destinatários, assunto, mensagem) e envia com um clique; cada envio fica registrado.
 *   dados/<loja>/cobrancas.json  { emails: { devolucoes: [..], fidelidade: [..] }, enviadas: [{ tipo, em, por, para, itens, total }] }
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const arq = (id) => path.join(C.pastaLoja(id), 'cobrancas.json');
const ler = (id) => { try { const j = JSON.parse(fs.readFileSync(arq(id), 'utf8')); return { emails: j.emails || {}, enviadas: j.enviadas || [], auto: j.auto || {} }; } catch { return { emails: {}, enviadas: [], auto: {} }; } };
const gravar = (id, d) => { fs.mkdirSync(C.pastaLoja(id), { recursive: true }); C.gravarAtomico(arq(id), JSON.stringify(d), 0o640); };
const EMAIL = /^[^\s@<>,;]{1,64}@[^\s@<>,;]{1,190}\.[a-z]{2,}$/i;
const brl = (v) => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const data = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mes = (ym) => `${MESES[+ym.slice(5, 7) - 1]}/${ym.slice(0, 4)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cpfParcial = (s) => (s && s.length === 11 ? `***.${s.slice(3, 6)}.${s.slice(6, 9)}-**` : '');
const horaTxt = (min) => (min == null ? '' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);

/** o que entra em cada cobrança (por padrão: o que está atrasado / veio a menos) */
function itensDevolucoes(conta, ids) {
  const sel = ids && ids.length ? new Set(ids) : null;
  return conta.creditos.filter((c) => (sel ? sel.has(c.id) : c.situacao === 'atrasado'));
}
function itensFidelidade(fid, meses) {
  const sel = meses && meses.length ? new Set(meses) : null;
  return fid.meses.filter((m) => (sel ? sel.has(m.mes) : m.situacao === 'atrasado' || m.situacao === 'faltou'));
}

const tabela = (cab, linhas, rodape) => `<table style="border-collapse:collapse;font-size:13px;margin:10px 0">
<tr>${cab.map((c, k) => `<th style="background:#2C5234;color:#fff;padding:6px 10px;text-align:${k ? 'right' : 'left'}">${esc(c)}</th>`).join('')}</tr>
${linhas.map((l, n) => `<tr style="background:${n % 2 ? '#f6f3ec' : '#fff'}">${l.map((c, k) => `<td style="padding:6px 10px;border-bottom:1px solid #e6e0d2;text-align:${k ? 'right' : 'left'};${/^R\$ /.test(c) ? 'white-space:nowrap' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}
${rodape ? `<tr>${rodape.map((c, k) => `<td style="padding:6px 10px;font-weight:bold;background:#e8efe7;white-space:nowrap;text-align:${k ? 'right' : 'left'}">${esc(c)}</td>`).join('')}</tr>` : ''}
</table>`;

/** rascunho: { assunto, mensagem, tabelaHtml, tabelaTexto, itens, total } */
function montar(tipo, { conta, fid, ids, meses, nomeLoja }) {
  if (tipo === 'devolucoes') {
    const its = itensDevolucoes(conta, ids);
    const total = its.reduce((s, c) => s + c.valor, 0);
    const linhas = its.map((c) => [`NF-e ${c.numero}`, data(c.emissao), c.notaOrigem ? `NF ${c.notaOrigem.nf}` : '—', brl(c.valor), c.dias != null ? `${c.dias} dias` : '']);
    return {
      itens: its.map((c) => c.id), total,
      assunto: `${nomeLoja} · Devoluções sem desconto · ${brl(total)}`,
      mensagem: `Olá,\n\nAs notas de devolução abaixo, da loja ${nomeLoja}, ainda não vieram como desconto nas notas de compra. Podem verificar e nos informar em qual nota o desconto será concedido?\n\nSeguem em anexo os XMLs das notas.\n\nObrigado!`,
      tabelaHtml: tabela(['Nota de devolução', 'Emissão', 'Devolve a nota', 'Valor', 'Em aberto há'], linhas, ['Total', '', '', brl(total), '']),
      tabelaTexto: linhas.map((l) => l.join(' · ')).join('\n') + `\nTotal: ${brl(total)}`,
    };
  }
  const ms = itensFidelidade(fid, meses);
  const falta = (m) => Math.max(0, m.devido - m.recebido);
  const total = ms.reduce((s, m) => s + falta(m), 0);
  const pct = Math.round((fid.pct || 0.5) * 100);
  const linhas = ms.map((m) => [mes(m.mes), String(m.resgates.length), brl(m.custo), brl(m.devido), m.recebido ? `${brl(m.recebido)} (${m.lancamentos.map((l) => 'royalty de ' + mes(l.ref)).join(', ')})` : '—', brl(falta(m))]);
  return {
    itens: ms.map((m) => m.mes), total,
    assunto: `${nomeLoja} · Desconto dos prêmios de fidelidade nos royalties · ${brl(total)}`,
    mensagem: `Olá,\n\nSegue o resumo dos prêmios de fidelidade resgatados na loja ${nomeLoja} e o desconto de ${pct}% do custo que ainda não veio nos royalties. A relação de cada resgate (data, cliente, prêmio e custo) está na planilha em anexo.\n\nPodem verificar e conceder o desconto no próximo boleto de royalties?\n\nObrigado!`,
    tabelaHtml: tabela(['Prêmios de', 'Resgates', 'Custo dos prêmios', `A receber (${pct}%)`, 'Já recebido', 'Falta'], linhas, ['Total', '', '', '', '', brl(total)]),
    tabelaTexto: linhas.map((l) => l.join(' · ')).join('\n') + `\nTotal a receber: ${brl(total)}`,
  };
}

/** planilha com a relação de cada resgate dos meses cobrados (sem o cupom da venda: é controle interno da loja) */
async function planilhaFidelidade(fid, meses, nomeLoja) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Prêmios');
  ws.columns = [{ header: 'Mês', width: 14 }, { header: 'Data', width: 12 }, { header: 'Hora', width: 8 }, { header: 'Cliente', width: 32 }, { header: 'CPF', width: 16 }, { header: 'Pontos', width: 8 }, { header: 'Prêmio', width: 36 }, { header: 'Custo', width: 11 }];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C5234' } };
  for (const m of itensFidelidade(fid, meses)) {
    for (const r of m.resgates) r.produtos.forEach((p, k) => ws.addRow([mes(m.mes), data(r.data), horaTxt(r.min), r.cliente || '', cpfParcial(r.cpf), k ? '' : r.pontos, p.nome, p.custo ?? null]));
    const t = ws.addRow([`Total ${mes(m.mes)}`, '', '', '', '', '', `A receber ${Math.round((fid.pct || 0.5) * 100)}%: ${brl(m.devido)}`, m.custo]);
    t.font = { bold: true };
  }
  ws.getColumn(8).numFmt = '"R$" #,##0.00';
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.headerFooter = { oddHeader: `${nomeLoja} · prêmios de fidelidade` };
  return wb.xlsx.writeBuffer();
}

function emails(id, tipo) { return ler(id).emails[tipo] || null; }
function registrar(id, tipo, para, itens, total, por) {
  const d = ler(id);
  d.emails[tipo] = para;
  d.enviadas.unshift({ tipo, em: new Date().toISOString(), por, para, itens, total: Math.round(total * 100) / 100 });
  d.enviadas = d.enviadas.slice(0, 200);
  gravar(id, d);
}
function historico(id) { return ler(id).enviadas; }
function validarPara(lista) {
  const l = [...new Set((Array.isArray(lista) ? lista : String(lista || '').split(/[,;\s]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  if (!l.length) return { erro: 'Informe pelo menos um e-mail.' };
  const ruim = l.find((e) => !EMAIL.test(e));
  return ruim ? { erro: `E-mail inválido: ${ruim}` } : { ok: l };
}
/** o e-mail em HTML: a mensagem (editada pela pessoa) + a tabela */
function html(mensagem, tabelaHtml) {
  const corpo = String(mensagem || '').split('\n').map((l) => (l ? `<div>${esc(l)}</div>` : '<br>')).join('');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1d2b22">${corpo}${tabelaHtml}</div>`;
}

/** envio automático todo mês (Configurações → Mensagens): { devolucoes, fidelidade, dia, hora, ultima: { tipo: 'AAAA-MM' }, erro } */
const AUTO_PADRAO = { devolucoes: false, fidelidade: false, dia: 2, hora: '09:00', ultima: {}, resultado: {} };
function auto(id) { return { ...AUTO_PADRAO, ...ler(id).auto }; }
function salvarAuto(id, b) {
  const d = ler(id);
  const a = { ...AUTO_PADRAO, ...d.auto };
  if (typeof b.devolucoes === 'boolean') a.devolucoes = b.devolucoes;
  if (typeof b.fidelidade === 'boolean') a.fidelidade = b.fidelidade;
  if (b.dia != null) { const n = parseInt(b.dia, 10); if (!(n >= 1 && n <= 28)) return { erro: 'Dia do mês entre 1 e 28.' }; a.dia = n; }
  if (b.hora != null) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.hora))) return { erro: 'Horário inválido.' }; a.hora = b.hora; }
  for (const t of ['devolucoes', 'fidelidade']) if (b.para && b.para[t] != null) { const v = validarPara(b.para[t]); if (v.erro) return v; d.emails[t] = v.ok; }
  d.auto = a; gravar(id, d);
  return { ok: a };
}
/** é hora de mandar? (dia e horário do mês, ainda não enviado neste mês) */
function devidoAgora(id, tipo, agora) {
  const a = auto(id);
  if (!a[tipo]) return false;
  const ym = agora.slice(0, 7), dd = +agora.slice(8, 10), hm = agora.slice(11, 16);
  return dd === a.dia && hm >= a.hora && a.ultima[tipo] !== ym;
}
function marcarAuto(id, tipo, ym, resultado) {
  const d = ler(id);
  d.auto = { ...AUTO_PADRAO, ...d.auto };
  d.auto.ultima = { ...d.auto.ultima, [tipo]: ym };
  d.auto.resultado = { ...d.auto.resultado, [tipo]: { ...resultado, em: new Date().toISOString() } };
  gravar(id, d);
}

module.exports = { auto, salvarAuto, devidoAgora, marcarAuto, montar, planilhaFidelidade, emails, registrar, historico, validarPara, html, itensDevolucoes, itensFidelidade };
