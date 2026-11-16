'use strict';
/**
 * Horários da atualização automática por dia da semana (lidos pelo coletor em /config/horarios.json):
 *   { padrao: { "0".."6": ["HH:MM", …] }, lojas: { <loja>: { "0".."6": [...] } } }   0 = domingo … 6 = sábado
 * A rede tem os horários padrão (o administrador muda); cada loja pode ter os seus (o franqueado muda).
 * Dia com lista vazia = sem atualização automática nesse dia (ex.: loja fechada no domingo).
 * A última atualização de cada dia pede o FIXE, o catálogo de pedidos e dispara o fechamento do dia.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const ARQ = () => path.join(C.COLETOR_DIR, 'horarios.json');
const TXT = () => path.join(C.COLETOR_DIR, 'horarios.txt');
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIAS = ['0', '1', '2', '3', '4', '5', '6'];

function listaTxt() {
  try { const hs = fs.readFileSync(TXT(), 'utf8').split(/[\n,]/).map((x) => x.trim()).filter((x) => HHMM.test(x)); if (hs.length) return [...new Set(hs)].sort(); } catch { /* sem arquivo */ }
  return (process.env.COLETOR_HORARIOS || '13:30,23:00').split(',').map((x) => x.trim()).filter((x) => HHMM.test(x));
}
function lerArq() { try { const j = JSON.parse(fs.readFileSync(ARQ(), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
const limpa = (hs) => [...new Set((Array.isArray(hs) ? hs : []).map((x) => String(x).trim()).filter((x) => HHMM.test(x)))].sort().slice(0, 12);
/** semana completa: dia ausente = a lista antiga (horarios.txt) */
function semana(obj, base) { const out = {}; for (const d of DIAS) out[d] = obj && Array.isArray(obj[d]) ? limpa(obj[d]) : [...base]; return out; }

/** { padrao: semana, lojas: { id: semana } } (só as lojas com horários próprios) */
function ler() {
  const j = lerArq(), base = listaTxt();
  const padrao = semana(j.padrao, base);
  const lojas = {};
  for (const [id, s] of Object.entries(j.lojas || {})) if (s && typeof s === 'object') lojas[id] = semana(s, []);
  return { padrao, lojas };
}
function gravar(j) {
  fs.mkdirSync(C.COLETOR_DIR, { recursive: true });
  C.gravarAtomico(ARQ(), JSON.stringify(j, null, 1) + '\n', 0o644);
}
/** valida e normaliza uma semana vinda da tela */
function validar(s) {
  if (!s || typeof s !== 'object') throw new Error('Informe os horários de cada dia.');
  const out = {};
  for (const d of DIAS) {
    const bruto = Array.isArray(s[d]) ? s[d] : [];
    if (bruto.some((x) => !HHMM.test(String(x).trim()))) throw new Error('Horário inválido: use HH:MM.');
    out[d] = limpa(bruto);
  }
  return out;
}
function gravarPadrao(s) { const j = lerArq(); j.padrao = validar(s); gravar(j); return j.padrao; }
function gravarLoja(id, s) { const j = lerArq(); j.lojas = j.lojas || {}; if (s == null) delete j.lojas[id]; else j.lojas[id] = validar(s); gravar(j); return j.lojas[id] || null; }
/** horários da loja num dia (Date) — os próprios, se houver; senão os da rede */
function doDia(id, quando = new Date()) {
  const a = ler();
  const d = String(new Date(quando.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay());
  return ((a.lojas[id] || a.padrao)[d]) || [];
}

module.exports = { ler, gravarPadrao, gravarLoja, doDia, DIAS };
