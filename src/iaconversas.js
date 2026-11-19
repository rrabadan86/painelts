'use strict';
/**
 * Histórico do "Pergunte ao painel": cada pessoa vê só as próprias conversas (por loja).
 *   dados/_ia/conversas/<hash do usuário>/<id>.json   { id, loja, titulo, criadaEm, atualizadaEm, vis, mensagens }
 * vis = o que aparece na tela (pergunta, resposta, gráficos); mensagens = a conversa no formato da IA (para continuar).
 * Lista de clientes não é gravada (só a quantidade). Guarda as 150 conversas mais recentes de cada pessoa.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');

const MAX = 150;
const pasta = (user) => path.join(C.DATA_DIR, '_ia', 'conversas', crypto.createHash('sha256').update(String(user)).digest('hex').slice(0, 24));
const idOk = (id) => /^[a-f0-9]{12}$/.test(String(id || ''));
const ler = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

function lista(user, loja) {
  let fsx = [];
  try { fsx = fs.readdirSync(pasta(user)).filter((f) => /^[a-f0-9]{12}\.json$/.test(f)); } catch { return []; }
  return fsx.map((f) => ler(path.join(pasta(user), f))).filter((c) => c && (!loja || c.loja === loja))
    .map((c) => ({ id: c.id, loja: c.loja, titulo: c.titulo, criadaEm: c.criadaEm, atualizadaEm: c.atualizadaEm, perguntas: (c.vis || []).filter((v) => v.eu).length }))
    .sort((a, b) => (a.atualizadaEm < b.atualizadaEm ? 1 : -1));
}
function abrir(user, id) {
  if (!idOk(id)) return null;
  return ler(path.join(pasta(user), id + '.json'));
}
const limpa = (s, n) => String(s == null ? '' : s).slice(0, n);
/** só o que a tela precisa: pergunta; resposta (texto, gráficos, passos, erro, quantos clientes) */
function visLimpa(vis) {
  return (Array.isArray(vis) ? vis : []).slice(0, 200).map((v) => {
    if (v && typeof v.eu === 'string') return { eu: limpa(v.eu, 4000) };
    const r = (v && v.ia) || {};
    return { ia: { passos: (r.passos || []).slice(0, 20).map((p) => limpa(p, 60)), texto: limpa(r.texto, 20000), erro: r.erro ? limpa(r.erro, 500) : null, fim: true,
      graficos: (r.graficos || []).slice(0, 5), clientes: (r.clientes || []).slice(0, 5).map((c) => ({ n: +c.n || 0 })) } };
  });
}
function salvar(user, id, { loja, vis, mensagens }) {
  if (!idOk(id)) return { erro: 'Conversa inválida.' };
  const v = visLimpa(vis);
  const prim = v.find((x) => x.eu);
  if (!prim) return { erro: 'Conversa vazia.' };
  const corpo = { vis: v, mensagens: Array.isArray(mensagens) ? mensagens : [] };
  if (JSON.stringify(corpo).length > 600000) corpo.mensagens = []; // grande demais: guarda só a leitura (não dá para continuar)
  const ant = abrir(user, id);
  if (ant && ant.loja !== String(loja)) return { erro: 'Conversa de outra loja.' };
  const agora = new Date().toISOString();
  const c = { id, loja: String(loja), titulo: limpa(prim.eu, 120), criadaEm: (ant && ant.criadaEm) || agora, atualizadaEm: agora, ...corpo };
  fs.mkdirSync(pasta(user), { recursive: true });
  C.gravarAtomico(path.join(pasta(user), id + '.json'), JSON.stringify(c), 0o640);
  // guarda só as mais recentes
  const todas = lista(user);
  for (const x of todas.slice(MAX)) { try { fs.unlinkSync(path.join(pasta(user), x.id + '.json')); } catch { /* ok */ } }
  return { ok: { id, atualizadaEm: agora } };
}
function apagar(user, id) {
  if (!idOk(id)) return { erro: 'Conversa inválida.' };
  try { fs.unlinkSync(path.join(pasta(user), id + '.json')); return { ok: true }; } catch { return { erro: 'Conversa não encontrada.' }; }
}

module.exports = { lista, abrir, salvar, apagar, MAX };
