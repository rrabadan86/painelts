'use strict';
/**
 * Checklist de abertura e fechamento da loja: itens configuráveis (Configurações), marcados no dia por quem fez,
 * com a hora. O resumo do dia vai no e-mail de fechamento.
 *   dados/<loja>/checklist/itens.json        { abertura: [{ id, texto }], fechamento: [...] }
 *   dados/<loja>/checklist/AAAA-MM-DD.json   { abertura: { idItem: { por, em } }, fechamento: {...}, obs: {abertura, fechamento} }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');

const pasta = (id) => path.join(C.pastaLoja(id), 'checklist');
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS = ['abertura', 'fechamento'];
const lerJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const novoId = () => crypto.randomBytes(4).toString('hex');

const PADRAO = {
  abertura: ['Ligar luzes, som e ar-condicionado', 'Conferir o troco do caixa', 'Limpar balcão e vitrine', 'Repor chás e acessórios na vitrine', 'Preparar o chá de degustação', 'Conferir encomendas e retiradas do dia', 'Ver o Hoje no painel (clientes para contatar)'],
  fechamento: ['Fechar o caixa no AppNext (sangria e conferência)', 'Lavar bules, xícaras e utensílios', 'Guardar os chás abertos bem fechados', 'Limpar balcão e chão', 'Repor embalagens e sacolas', 'Desligar equipamentos, luzes e ar-condicionado', 'Trancar a loja e ligar o alarme'],
};

function itens(id) {
  const j = lerJ(path.join(pasta(id), 'itens.json'), null);
  if (j && Array.isArray(j.abertura) && Array.isArray(j.fechamento)) return j;
  // primeira vez: a lista padrão (ids fixos para não mudar entre leituras)
  const r = {};
  for (const t of TIPOS) r[t] = PADRAO[t].map((texto, k) => ({ id: `${t[0]}${k + 1}`, texto }));
  return r;
}
function salvarItens(id, b) {
  const r = {};
  for (const t of TIPOS) {
    const l = (Array.isArray(b[t]) ? b[t] : []).map((x) => ({ id: /^[\w]{1,16}$/.test(String(x.id || '')) ? String(x.id) : novoId(), texto: txt(x.texto, 120) })).filter((x) => x.texto).slice(0, 40);
    if (!l.length) return { erro: `A lista de ${t} precisa de pelo menos um item.` };
    r[t] = l;
  }
  fs.mkdirSync(pasta(id), { recursive: true });
  C.gravarAtomico(path.join(pasta(id), 'itens.json'), JSON.stringify(r), 0o640);
  return { ok: r };
}
function doDia(id, dia) {
  if (!DIA.test(dia)) return null;
  const d = lerJ(path.join(pasta(id), dia + '.json'), {});
  return { abertura: d.abertura || {}, fechamento: d.fechamento || {}, obs: d.obs || {} };
}
/** marca / desmarca um item (ou grava a observação) */
function marcar(id, dia, tipo, item, feito, por, obs) {
  if (!DIA.test(dia) || !TIPOS.includes(tipo)) return { erro: 'Pedido inválido.' };
  const d = doDia(id, dia);
  if (obs != null) d.obs[tipo] = txt(obs, 500);
  else {
    if (!itens(id)[tipo].some((x) => x.id === item)) return { erro: 'Item não encontrado.' };
    if (feito) d[tipo][item] = { por, em: new Date().toISOString() }; else delete d[tipo][item];
  }
  fs.mkdirSync(pasta(id), { recursive: true });
  C.gravarAtomico(path.join(pasta(id), dia + '.json'), JSON.stringify(d), 0o640);
  return { ok: d };
}
/** situação de cada parte no dia: { feitos, total, ultima: { por, em } } */
function resumo(id, dia) {
  const its = itens(id), d = doDia(id, dia);
  if (!d) return null;
  const r = {};
  for (const t of TIPOS) {
    const marcados = its[t].filter((x) => d[t][x.id]).map((x) => d[t][x.id]);
    const ultima = marcados.sort((a, b) => (a.em < b.em ? 1 : -1))[0] || null;
    r[t] = { feitos: marcados.length, total: its[t].length, ultima, pendentes: its[t].filter((x) => !d[t][x.id]).map((x) => x.texto), obs: d.obs[t] || '' };
  }
  return r;
}
function historico(id, dias = 31) {
  const out = [];
  const hoje = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  for (let k = 0; k < dias; k++) {
    const d = new Date(hoje.getTime() - k * 864e5);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!fs.existsSync(path.join(pasta(id), iso + '.json'))) continue;
    out.push({ dia: iso, ...resumo(id, iso) });
  }
  return out;
}
/** linha para o e-mail de fechamento */
function textoFechamento(id, dia) {
  const r = resumo(id, dia);
  if (!r || (!r.abertura.feitos && !r.fechamento.feitos)) return null;
  const hora = (u) => (u ? new Date(u.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) + (u.por ? ` (${u.por})` : '') : '');
  const parte = (rot, x) => `${rot}: ${x.feitos === x.total ? `✓ completa ${hora(x.ultima)}` : `${x.feitos} de ${x.total}${x.pendentes.length ? ' · faltou: ' + x.pendentes.slice(0, 4).join(', ') + (x.pendentes.length > 4 ? '…' : '') : ''}`}${x.obs ? ` · obs.: ${x.obs}` : ''}`;
  return `Checklist da loja\n${parte('Abertura', r.abertura)}\n${parte('Fechamento', r.fechamento)}`;
}

module.exports = { itens, salvarItens, doDia, marcar, resumo, historico, textoFechamento, TIPOS };
