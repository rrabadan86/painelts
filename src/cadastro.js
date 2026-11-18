'use strict';
/**
 * Cadastro de clientes enviado pelo painel.
 *
 * Aceita dois formatos, reconhecidos pelo cabeçalho:
 *  - modelo do painel: CPF | NOME | CELULAR | DATA NASC. | EMAIL | CIDADE
 *  - exportação de contatos do FIXE: Nome | Data Cadastro | Email | Aniversário | CPF | Loja | Saldo | Telefone | Estado * | Cidade *
 *    (Data Cadastro, Loja, Saldo e Estado não existem no painel e são ignorados; Aniversário vem dd/mm/aaaa)
 *
 * O envio JUNTA com o cadastro que já existe: CPF novo entra, CPF conhecido é atualizado
 * e campo vazio no arquivo novo não apaga o que já tinha. Grava sempre no modelo do painel
 * (Dados_Clientes.xlsx, com a data de nascimento como data de verdade).
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const C = require('./config');
const T = require('./transform');

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\*/g, '').trim().toLowerCase();
const txt = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') { if ('text' in v) return String(v.text); if ('result' in v) return String(v.result ?? ''); if (v.richText) return v.richText.map((r) => r.text).join(''); }
  return String(v);
};
const so = (v) => txt(v).replace(/\D/g, '');

/** dd/mm/aaaa (ou data do Excel) → AAAA-MM-DD */
function dataDMY(v) {
  if (v instanceof Date || typeof v === 'number') return T.toISODate(v);
  const m = txt(v).trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) return T.toISODate(v);
  let [, d, mo, y] = m.map(Number);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function cpfDe(v) {
  let s = so(v);
  if (!s) return null;
  if (s.length < 11) s = s.padStart(11, '0');
  return s.length === 11 || s.length === 14 ? s : null;
}

/** acha a linha de cabeçalho e o formato */
function detectar(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cab = (rows[i] || []).map((c) => norm(txt(c)));
    const tem = (n) => cab.indexOf(n);
    if (tem('cpf') >= 0 && tem('nome') >= 0 && (tem('telefone') >= 0 || tem('aniversario') >= 0)) {
      return { formato: 'FIXE', linha: i, col: { cpf: tem('cpf'), nome: tem('nome'), celular: tem('telefone'), nasc: tem('aniversario'), email: tem('email'), cidade: tem('cidade'), cadastro: tem('data cadastro'), saldo: tem('saldo') }, cab };
    }
    if (tem('cpf') >= 0 && tem('nome') >= 0) {
      return { formato: 'modelo do painel', linha: i, col: { cpf: tem('cpf'), nome: tem('nome'), celular: tem('celular'), nasc: tem('data nasc.'), email: tem('email'), cidade: tem('cidade') }, cab };
    }
  }
  return null;
}

function lerClientes(rows) {
  const d = detectar(rows);
  if (!d) throw new Error('Não reconheci o arquivo: a primeira linha precisa ter as colunas CPF e NOME (modelo do painel) ou ser a exportação de contatos do FIXE.');
  const pega = (r, k) => (d.col[k] >= 0 ? r[d.col[k]] : null);
  const porCPF = new Map();
  let semCPF = 0;
  for (const r of rows.slice(d.linha + 1)) {
    if (!r || !r.some((v) => txt(v).trim())) continue;
    const cpf = cpfDe(pega(r, 'cpf'));
    if (!cpf) { semCPF++; continue; }
    const nasc = pega(r, 'nasc');
    porCPF.set(cpf, {
      cpf,
      nome: txt(pega(r, 'nome')).trim().slice(0, 120),
      celular: so(pega(r, 'celular')).slice(0, 15),
      // FIXE e datas digitadas: dd/mm/aaaa. No modelo do painel o texto segue a regra antiga (célula de data é o recomendado).
      nascimento: nasc == null || txt(nasc).trim() === '' ? null : d.formato === 'FIXE' ? dataDMY(nasc) : T.toISODate(nasc, { preferMDY: true }),
      email: txt(pega(r, 'email')).trim().slice(0, 120),
      cidade: txt(pega(r, 'cidade')).trim().slice(0, 80),
      ...(d.formato === 'FIXE' ? { cadastroFixe: (() => { const v = pega(r, 'cadastro'); return v == null || txt(v).trim() === '' ? null : dataDMY(v); })(),
        // saldo oficial de pontos do FIXE (a base de leads traz); vale mais que a conta feita pelos Logs
        saldoFixe: (() => {
          const v = pega(r, 'saldo');
          if (v == null || txt(v).trim() === '') return null;
          if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
          if (typeof v === 'object' && typeof v.result === 'number') return Number.isFinite(v.result) ? Math.round(v.result) : null;
          const s = txt(v).trim();
          const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/\.(?=\d{3}(\D|$))/g, ''));
          return Number.isFinite(n) ? Math.round(n) : null;
        })() } : {}),
    });
  }
  const usadas = new Set(Object.values(d.col).filter((j) => j >= 0));
  const ignoradas = (rows[d.linha] || []).map((c, j) => (usadas.has(j) ? null : txt(c).trim())).filter(Boolean);
  return { formato: d.formato, clientes: [...porCPF.values()], semCPF, ignoradas };
}

async function linhas(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets.find((w) => w.rowCount > 1) || wb.worksheets[0];
  const rows = [];
  if (ws) ws.eachRow({ includeEmpty: true }, (row, n) => { const v = row.values; rows[n - 1] = Array.isArray(v) ? v.slice(1) : []; });
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

const arquivo = (id) => path.join(C.pastaLoja(id), 'Dados_Clientes.xlsx');

async function existentes(id) {
  try { return T.transformClientes(await linhas(fs.readFileSync(arquivo(id)))); } catch { return []; }
}

async function gravar(id, lista) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Planilha1');
  ws.columns = [
    { header: 'CPF', key: 'cpf', width: 16 }, { header: 'NOME', key: 'nome', width: 36 }, { header: 'CELULAR', key: 'celular', width: 16 },
    { header: 'DATA NASC.', key: 'nasc', width: 13, style: { numFmt: 'dd/mm/yyyy' } }, { header: 'EMAIL', key: 'email', width: 30 }, { header: 'CIDADE', key: 'cidade', width: 24 },
  ];
  for (const c of lista) {
    ws.addRow({ cpf: c.cpf, nome: c.nome, celular: c.celular, nasc: c.nascimento ? new Date(c.nascimento + 'T00:00:00Z') : null, email: c.email, cidade: c.cidade });
  }
  ws.getColumn('cpf').numFmt = '@';
  C.gravarAtomico(arquivo(id), Buffer.from(await wb.xlsx.writeBuffer()), 0o640);
}

/** junta o arquivo enviado com o cadastro atual e grava; devolve o resumo para mostrar na tela */
async function importar(id, buf) {
  if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new Error('Este .xls é do Excel antigo (97-2003). Abra no Excel e use "Salvar como" → Pasta de Trabalho do Excel (.xlsx).');
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('O arquivo não é uma planilha do Excel.');
  const novo = lerClientes(await linhas(buf));
  if (!novo.clientes.length) throw new Error('Nenhum cliente com CPF no arquivo.');
  const atual = await existentes(id);
  const porCPF = new Map(atual.map((c) => [c.cpf, c]));
  let novos = 0, atualizados = 0;
  for (const c of novo.clientes) {
    const a = porCPF.get(c.cpf);
    if (!a) { const { cadastroFixe, saldoFixe, ...so } = c; porCPF.set(c.cpf, so); novos++; continue; }
    const junto = { ...a };
    for (const k of ['nome', 'celular', 'nascimento', 'email', 'cidade']) if (c[k]) junto[k] = c[k]; // vazio não apaga
    delete junto.cadastroFixe; delete junto.saldoFixe;
    if (JSON.stringify(junto) !== JSON.stringify(a)) atualizados++;
    porCPF.set(c.cpf, junto);
  }
  await gravar(id, [...porCPF.values()]);
  const l = novo.clientes;
  // a base de leads do FIXE é a lista inteira de quem está no programa: guarda quem é membro e desde quando
  if (novo.formato === 'FIXE') require('./fidelidade').gravarMembros(id, l.map((c) => (c.saldoFixe != null ? [c.cpf, c.cadastroFixe || null, c.saldoFixe] : [c.cpf, c.cadastroFixe || null])));
  return {
    formato: novo.formato, noArquivo: l.length, novos, atualizados, total: porCPF.size, semCPF: novo.semCPF,
    comCelular: l.filter((c) => c.celular.length >= 10).length, comAniversario: l.filter((c) => c.nascimento).length,
    comEmail: l.filter((c) => c.email).length, comCidade: l.filter((c) => c.cidade).length, ignoradas: novo.ignoradas,
  };
}

module.exports = { importar, lerClientes, detectar, dataDMY };
