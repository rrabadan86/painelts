'use strict';
/**
 * Celular trocado pelo painel (decisão do dono, 22/11/2026): na conversa do WhatsApp, o admin ou o franqueado diz
 * "este número é da Fulana" — o cliente trocou de número e o do FIXE não é mais usado. O número vinculado passa a ser
 * o celular do cliente em todo o painel (Hoje, Lista, ficha, Campanhas, Resumo diário, Lista de espera e o robô):
 * ele substitui o do FIXE no pacote de /api/dados (`aplicar`, chamado em `pacote` no server.js), que é o mesmo que a
 * tela e o robô (src/zapauto.js) leem. O FIXE não muda.
 *
 *   dados/<loja>/clientes/celulares.json  { <cpf>: { cel: '55DDDNNNNNNNN', antigo: '<celular do FIXE na hora>', por, em } }
 *
 * Fica fora de dados/<loja>/conversas/ (que é apagada quando o WhatsApp é desconectado): o vínculo continua valendo.
 * Um número é de um CPF só: vincular o mesmo número a outro cliente tira do anterior. Quem tinha esse número no FIXE
 * (outro cliente) perde o celular no painel, para o robô nunca mandar a mensagem de um para o outro.
 * Log e auditoria: CPF abreviado e só os 4 últimos dígitos do número.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');

const arquivo = (id) => path.join(C.pastaLoja(id), 'clientes', 'celulares.json');
const CPF_OK = /^\d{11}$|^\d{14}$/;

/**
 * Chave do celular: a mesma do robô (`ZF.foneChave`: 55 + DDD + número, com o 9 do celular). Com e sem o 9 é o mesmo
 * número (pedido do dono: 62981718205 = 6281718205). '' quando não é um número com DDD.
 */
function chave(n) { const k = require('./zapfila').foneChave(n); return /^55\d{10,11}$/.test(k) ? k : ''; }
/** só os dígitos sem o 55 (DDD + número) ou '' — para a tela e o demo */
const local = (n) => { const k = chave(n); return k ? k.slice(2) : ''; };
const mesmoNumero = (a, b) => { const ka = chave(a); return !!ka && ka === chave(b); };

function ler(id) {
  try { const j = JSON.parse(fs.readFileSync(arquivo(id), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
/** muda quando o arquivo muda (entra na chave do pacote de /api/dados) */
function sig(id) {
  try { const s = fs.statSync(arquivo(id)); return `${s.mtimeMs}:${s.size}`; } catch { return '0'; }
}
function gravar(id, dados) {
  fs.mkdirSync(path.dirname(arquivo(id)), { recursive: true });
  C.gravarAtomico(arquivo(id), JSON.stringify(dados), 0o640);
}

/**
 * liga o número ao cliente. → { erro } ou { ok, tirouDe: [cpfs que tinham este número pelo painel] }
 * antigo = o celular do FIXE na hora (fica guardado para a ficha mostrar e para desfazer).
 */
function vincular(id, { cpf, cel, antigo }, por, agora = Date.now()) {
  cpf = String(cpf || '').replace(/\D/g, '');
  if (!CPF_OK.test(cpf)) return { erro: 'Cliente inválido.' };
  const k = chave(cel);
  if (!k) return { erro: 'Número inválido: precisa do DDD e do número.' };
  const dados = ler(id);
  const tirouDe = [];
  for (const [k2, v] of Object.entries(dados)) if (k2 !== cpf && v && chave(v.cel) === k) { delete dados[k2]; tirouDe.push(k2); }
  const ant = dados[cpf] ? dados[cpf].antigo : String(antigo || '').replace(/\D/g, '').slice(0, 15);
  dados[cpf] = { cel: k, antigo: ant || '', por: String(por || '').slice(0, 60), em: new Date(agora).toISOString() };
  gravar(id, dados);
  return { ok: dados[cpf], tirouDe };
}
/** volta a usar o celular do FIXE. → true se havia vínculo */
function desfazer(id, cpf) {
  const dados = ler(id);
  cpf = String(cpf || '').replace(/\D/g, '');
  if (!dados[cpf]) return false;
  delete dados[cpf];
  gravar(id, dados);
  return true;
}

/**
 * aplica os vínculos à lista de clientes do pacote (não mexe na lista recebida: devolve outra).
 * Cliente vinculado: `celular` = o número do painel, `celFixe` = o do FIXE agora, `celVinc` = { em, por, antigo }.
 * Outro cliente com esse mesmo número no FIXE: fica sem celular no painel (`celTirado: true`).
 */
function aplicar(clientes, mapa) {
  const ents = Object.entries(mapa || {}).filter(([, v]) => v && chave(v.cel));
  if (!ents.length || !Array.isArray(clientes)) return clientes;
  const donoDe = new Map(ents.map(([cpf, v]) => [chave(v.cel), cpf])); // chave do número → cpf de quem ele é
  const porCpf = new Map(ents);
  return clientes.map((c) => {
    const v = porCpf.get(c.cpf);
    if (v) return { ...c, celular: v.cel, celFixe: c.celular || '', celVinc: { em: v.em, por: v.por, antigo: v.antigo || '' } };
    const dono = donoDe.get(chave(c.celular));
    if (dono && dono !== c.cpf) return { ...c, celular: '', celTirado: true };
    return c;
  });
}

module.exports = { ler, sig, vincular, desfazer, aplicar, chave, local, mesmoNumero, arquivo };
