'use strict';
/**
 * Web Push sem biblioteca: só o crypto do Node.
 *   - Mensagem cifrada para o aparelho: RFC 8291 (aes128gcm, RFC 8188).
 *   - Identificação do servidor: RFC 8292 (VAPID): JWT ES256 em "Authorization: vapid t=..., k=...".
 * A chave VAPID é desta instalação: criada na primeira vez em config/push-vapid.json (fora do git; a parte privada é segredo).
 * Quem decide para quem enviar é src/push.js; aqui é só cifrar, assinar e entregar.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const C = require('./config');

const b64u = (b) => Buffer.from(b).toString('base64url');
const deB64u = (s) => Buffer.from(String(s || ''), 'base64url');
const ARQ_VAPID = () => path.join(C.CONFIG_DIR, 'push-vapid.json');

/** chave VAPID da instalação: { publica (65 bytes, base64url), privada (JWK d), contato } — cria na primeira vez */
let vapidMem = null;
function vapid() {
  if (vapidMem && vapidMem.arq === ARQ_VAPID()) return vapidMem;
  const arq = ARQ_VAPID();
  let v = null;
  try { v = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { /* ainda não existe */ }
  if (!v || !v.publica || !v.privada || deB64u(v.publica).length !== 65) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    v = { publica: b64u(Buffer.concat([Buffer.from([4]), deB64u(jwk.x), deB64u(jwk.y)])), privada: jwk.d, criadaEm: new Date().toISOString() };
    void publicKey;
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.writeFileSync(arq, JSON.stringify(v, null, 2), { mode: 0o600 });
  }
  vapidMem = { ...v, arq };
  return vapidMem;
}
function chavePrivada(v) {
  const pub = deB64u(v.publica);
  return crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: v.privada, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
}

/** só https dos serviços de push conhecidos: sem isso o servidor poderia ser usado para chamar qualquer endereço */
const SERVICOS = [/^fcm\.googleapis\.com$/, /^[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com$/, /^[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com$/];
function enderecoOk(url) {
  if (typeof url !== 'string' || url.length > 1000) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  return SERVICOS.some((r) => r.test(u.hostname.toLowerCase()));
}
/** chaves do aparelho no formato certo: p256dh = ponto P-256 sem compressão (65 bytes), auth = 16 bytes */
function chavesOk(k) {
  if (!k || typeof k.p256dh !== 'string' || typeof k.auth !== 'string') return false;
  const p = deB64u(k.p256dh), a = deB64u(k.auth);
  if (p.length !== 65 || p[0] !== 4 || a.length !== 16) return false;
  // o ponto precisa estar na curva: uma troca de chaves de mentira confere isso
  try { const e = crypto.createECDH('prime256v1'); e.generateKeys(); e.computeSecret(p); return true; } catch { return false; }
}

const hkdf = (salt, ikm, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, n));
/**
 * RFC 8291: cifra `texto` para o aparelho (p256dh + auth). → corpo pronto para o POST (Content-Encoding: aes128gcm).
 * `opt.efemera` (ECDH) e `opt.sal` existem só para os testes compararem com as bibliotecas de referência.
 */
function cifrar(texto, p256dh, auth, opt = {}) {
  const uaPub = deB64u(p256dh), segredo = deB64u(auth);
  const ecdh = opt.efemera || crypto.createECDH('prime256v1');
  if (!opt.efemera) ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const comum = ecdh.computeSecret(uaPub);
  const ikm = hkdf(segredo, comum, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const sal = opt.sal || crypto.randomBytes(16);
  const cek = hkdf(sal, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(sal, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const dados = Buffer.from(String(texto), 'utf8');
  if (dados.length > 3000) throw new Error('Mensagem grande demais para uma notificação.');
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const cifra = Buffer.concat([c.update(Buffer.concat([dados, Buffer.from([2])])), c.final(), c.getAuthTag()]); // 0x02 = último registro
  const cab = Buffer.alloc(21); sal.copy(cab, 0); cab.writeUInt32BE(4096, 16); cab[20] = asPub.length;
  return Buffer.concat([cab, asPub, cifra]);
}
/** o "lado do navegador": abre a mensagem com a chave privada do aparelho (usado nos testes) */
function abrir(corpo, ecdhAparelho, auth) {
  const sal = corpo.subarray(0, 16), n = corpo[20], asPub = corpo.subarray(21, 21 + n), cifra = corpo.subarray(21 + n);
  const uaPub = ecdhAparelho.getPublicKey();
  const ikm = hkdf(deB64u(auth), ecdhAparelho.computeSecret(asPub), Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const cek = hkdf(sal, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), nonce = hkdf(sal, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cifra.subarray(cifra.length - 16));
  const claro = Buffer.concat([d.update(cifra.subarray(0, cifra.length - 16)), d.final()]);
  let fim = claro.length - 1;
  while (fim >= 0 && claro[fim] === 0) fim--; // enchimento
  if (claro[fim] !== 2) throw new Error('registro sem o delimitador final');
  return claro.subarray(0, fim).toString('utf8');
}

/** RFC 8292: "vapid t=<JWT ES256>, k=<chave pública>" para o serviço de push de `endpoint` */
function cabecalhoVapid(endpoint, v = vapid(), agora = Date.now()) {
  const aud = new URL(endpoint).origin;
  const sub = /^(mailto:|https:\/\/)/.test(v.contato || process.env.PUSH_CONTATO || '') ? (v.contato || process.env.PUSH_CONTATO) : 'https://painel.invalid/contato';
  const cab = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corpo = b64u(JSON.stringify({ aud, exp: Math.floor(agora / 1000) + 12 * 3600, sub }));
  const ass = crypto.sign('sha256', Buffer.from(`${cab}.${corpo}`), { key: chavePrivada(v), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${cab}.${corpo}.${b64u(ass)}, k=${v.publica}`;
}
/** guarda o endereço do painel como contato do VAPID (o serviço de push exige um mailto: ou https:) */
function definirContato(url) {
  const v = vapid();
  if (v.contato || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url || '')) return;
  const { arq, ...resto } = v; // eslint-disable-line no-unused-vars
  resto.contato = url;
  try { fs.writeFileSync(ARQ_VAPID(), JSON.stringify(resto, null, 2), { mode: 0o600 }); vapidMem = null; } catch { /* segue com o contato padrão */ }
}

/**
 * Entrega uma mensagem a um aparelho. Nunca lança: → { ok, status, sumiu } (sumiu = 404/410: o aparelho não existe mais).
 * `opt.fetch` é injetado nos testes; a espera é limitada (padrão 8 s).
 */
async function enviar(ap, dados, opt = {}) {
  try {
    if (!enderecoOk(ap.endpoint) || !chavesOk(ap.keys)) return { ok: false, status: 0, erro: 'endereço ou chave inválida', sumiu: true };
    const corpo = cifrar(typeof dados === 'string' ? dados : JSON.stringify(dados), ap.keys.p256dh, ap.keys.auth);
    const r = await (opt.fetch || fetch)(ap.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(opt.espera || 8000),
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(opt.ttl || 24 * 3600), Urgency: opt.urgencia || 'normal', Authorization: cabecalhoVapid(ap.endpoint) },
      body: corpo,
    });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, sumiu: r.status === 404 || r.status === 410 };
  } catch (e) { return { ok: false, status: 0, erro: e && e.name === 'TimeoutError' ? 'o serviço de notificações demorou demais' : 'falha ao falar com o serviço de notificações' }; }
}

module.exports = { vapid, cifrar, abrir, cabecalhoVapid, definirContato, enderecoOk, chavesOk, enviar, b64u, deB64u };
