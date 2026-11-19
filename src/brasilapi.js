'use strict';
/**
 * BrasilAPI (https://brasilapi.com.br, gratuita, sem chave): dados públicos de CNPJ (Receita Federal) e de CEP.
 * Usada para preencher o cadastro de parceiro e o cliente do orçamento. Só leitura; a resposta fica 1 dia em memória.
 * Quem consulta é o servidor (a VPS precisa acessar brasilapi.com.br). BRASILAPI_URL troca o endereço (testes).
 */
const BASE = () => (process.env.BRASILAPI_URL || 'https://brasilapi.com.br/api').replace(/\/$/, '');
const DIA = 24 * 3600e3;
const cache = new Map();

class ErroBR extends Error { constructor(msg, status) { super(msg); this.status = status; } }

/** CNPJ numérico ou alfanumérico (a partir de 2026): 12 caracteres + 2 dígitos verificadores */
function limparCnpj(v) { return String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); }
function cnpjValido(v) {
  const c = limparCnpj(v);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const val = (ch) => ch.charCodeAt(0) - 48;
  const dv = (n) => {
    let s = 0, p = 2;
    for (let i = n - 1; i >= 0; i--) { s += val(c[i]) * p; p = p === 9 ? 2 : p + 1; }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === +c[12] && dv(13) === +c[13];
}
const limparCep = (v) => String(v || '').replace(/\D/g, '');

const txt = (v, n = 120) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const tel = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(0, 11) : ''; };

/** o que o painel usa do CNPJ (só dados públicos da empresa) */
function deCnpj(j) {
  const sit = txt(j.descricao_situacao_cadastral, 30).toUpperCase();
  const tipo = txt(j.descricao_tipo_de_logradouro, 20);
  const rua = txt(j.logradouro);
  return {
    cnpj: limparCnpj(j.cnpj), razaoSocial: txt(j.razao_social, 150), nomeFantasia: txt(j.nome_fantasia, 150),
    situacao: sit || null, ativa: sit === 'ATIVA',
    cep: limparCep(j.cep), rua: rua && tipo && !rua.toUpperCase().startsWith(tipo.toUpperCase()) ? `${tipo} ${rua}` : rua,
    numero: txt(j.numero, 20), complemento: txt(j.complemento, 60), bairro: txt(j.bairro, 80), cidade: txt(j.municipio, 80), uf: txt(j.uf, 2).toUpperCase(),
    telefone: tel(j.ddd_telefone_1), email: txt(j.email, 120).toLowerCase(),
  };
}
function deCep(j) {
  return { cep: limparCep(j.cep), rua: txt(j.street), bairro: txt(j.neighborhood, 80), cidade: txt(j.city, 80), uf: txt(j.state, 2).toUpperCase() };
}

async function buscar(caminho) {
  const em = cache.get(caminho);
  if (em && Date.now() - em.t < DIA) return em.v;
  let r;
  try { r = await fetch(BASE() + caminho, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }); } catch (e) {
    throw new ErroBR(e.name === 'TimeoutError' ? 'A consulta pública demorou demais. Preencha à mão ou tente de novo.' : 'Não consegui consultar agora (a VPS acessa brasilapi.com.br?). Preencha à mão.', 502);
  }
  if (r.status === 404) return null;
  if (r.status === 429) throw new ErroBR('Muitas consultas seguidas no serviço público. Espere um minuto.', 429);
  if (!r.ok) throw new ErroBR('O serviço público de consulta está fora do ar agora. Preencha à mão.', 502);
  const v = await r.json().catch(() => null);
  if (!v) throw new ErroBR('Resposta inválida da consulta pública.', 502);
  if (cache.size >= 500) cache.delete(cache.keys().next().value);
  cache.set(caminho, { t: Date.now(), v });
  return v;
}

/** dados públicos do CNPJ; null = não encontrado */
async function cnpj(v) {
  const c = limparCnpj(v);
  if (!cnpjValido(c)) throw new ErroBR('CNPJ inválido: confira os números.', 400);
  const j = await buscar(`/cnpj/v1/${c}`);
  return j ? deCnpj(j) : null;
}
/** rua, bairro, cidade e UF do CEP; null = não encontrado */
async function cep(v) {
  const c = limparCep(v);
  if (c.length !== 8) throw new ErroBR('CEP inválido: são 8 números.', 400);
  const j = await buscar(`/cep/v2/${c}`);
  return j ? deCep(j) : null;
}

module.exports = { cnpj, cep, cnpjValido, limparCnpj, deCnpj, deCep, ErroBR, _cache: cache };
