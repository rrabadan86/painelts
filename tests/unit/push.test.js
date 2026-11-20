// Notificações no aparelho (Web Push): cifra RFC 8291 aberta pelo "lado do navegador", VAPID RFC 8292, endereços aceitos,
// permissão conferida a cada envio, remoção do aparelho que sumiu, cada tipo de evento e nunca repetir o mesmo aviso.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'));
process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
const C = require('../../src/config');
const W = require('../../src/webpush');
const P = require('../../src/push');

/** um "navegador": par de chaves do aparelho + segredo, e o endereço de entrega que ele daria */
function aparelho(n = 1, host = 'fcm.googleapis.com') {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  return { ecdh, auth, sub: { endpoint: `https://${host}/fcm/send/aparelho-${n}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth } } };
}
/** serviço de push de mentira: guarda o que chegou e responde o status pedido por endereço */
function servico(status = {}) {
  const chegou = [];
  const f = async (url, o) => { chegou.push({ url, headers: o.headers, body: Buffer.from(o.body), redirect: o.redirect, signal: o.signal }); const s = status[url] || 201; if (s === 'erro') throw new Error('rede caiu'); return { status: s }; };
  return { chegou, fetch: f };
}
const gravarCfg = (usuarios) => { fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1' }, { id: 'l2', nome: 'Loja 2' }], usuarios })); const agora = new Date(Date.now() + 5000); fs.utimesSync(process.env.CONFIG_FILE, agora, agora); cfgAtual = usuarios; };
let cfgAtual = null, relogio = 0;
// o painel relê o lojas.json quando a data do arquivo muda (confere a cada 0,4 s): cada gravação do teste avança a data e espera
const mudarCfg = async (fn) => { const u = JSON.parse(JSON.stringify(cfgAtual)); fn(u); fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1' }, { id: 'l2', nome: 'Loja 2' }], usuarios: u })); relogio += 10; const t = new Date(Date.now() + 10000 + relogio * 1000); fs.utimesSync(process.env.CONFIG_FILE, t, t); cfgAtual = u; await new Promise((ok) => setTimeout(ok, 450)); assert.deepStrictEqual(Object.keys(C.get().usuarios).sort(), Object.keys(u).sort(), 'o painel releu o cadastro'); };
const limparPush = () => { try { fs.unlinkSync(P.ARQ()); } catch { /* não havia */ } };

before(() => {
  const u = (perfil, extra) => ({ senha: 'x', perfil, lojas: ['l1'], ativo: true, ...extra });
  gravarCfg({
    chefe: u('admin', { lojas: ['*'] }), dono: u('franqueado'), dono2: u('franqueado', { lojas: ['l2'] }),
    ger: u('gerente', { telas: ['resumo', 'espera', 'clientes', 'pedido'], telasV: 99 }),
    ger_sem: u('gerente', { telas: ['resumo'], telasV: 99 }),
    vend: u('vendedor', { vendedor: 'ANA' }),
  });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true })); // dados temporários do teste: apaga

// ---------- cifra (RFC 8291, aes128gcm) ----------
test('cifra: o "lado do navegador" abre a mensagem; cada envio usa chave efêmera e sal novos; chave errada não abre', () => {
  const a = aparelho(), msg = JSON.stringify({ titulo: 'Chá chegou ✓', texto: 'Rooibos — 2 clientes', link: '/#espera' });
  const c1 = W.cifrar(msg, a.sub.keys.p256dh, a.auth), c2 = W.cifrar(msg, a.sub.keys.p256dh, a.auth);
  assert.strictEqual(W.abrir(c1, a.ecdh, a.auth), msg);
  assert.strictEqual(W.abrir(c2, a.ecdh, a.auth), msg);
  assert.notDeepStrictEqual(c1, c2, 'nunca dois corpos iguais');
  // cabeçalho do registro: sal (16) + tamanho do registro 4096 + chave pública efêmera de 65 bytes
  assert.strictEqual(c1.readUInt32BE(16), 4096); assert.strictEqual(c1[20], 65); assert.strictEqual(c1[21], 4);
  assert.strictEqual(c1.length, 16 + 4 + 1 + 65 + Buffer.byteLength(msg) + 1 + 16);
  assert.ok(!c1.includes(Buffer.from('Rooibos')), 'o texto não vai às claras');
  const outro = aparelho(2);
  assert.throws(() => W.abrir(c1, outro.ecdh, outro.auth), 'outro aparelho não abre');
  assert.throws(() => W.abrir(c1, a.ecdh, crypto.randomBytes(16).toString('base64url')), 'segredo errado não abre');
  const mexido = Buffer.from(c1); mexido[mexido.length - 20] ^= 1;
  assert.throws(() => W.abrir(mexido, a.ecdh, a.auth), 'mensagem adulterada não abre');
  assert.throws(() => W.cifrar('x'.repeat(4000), a.sub.keys.p256dh, a.auth), /grande demais/);
});
test('cifra: vetor do RFC 8291 (apêndice A) sai byte a byte igual', () => {
  const d = (s) => Buffer.from(s, 'base64url');
  const ef = crypto.createECDH('prime256v1'); ef.setPrivateKey(d('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'));
  const corpo = W.cifrar('When I grow up, I want to be a watermelon', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg', { efemera: ef, sal: d('DGv6ra1nlYgDCS1FRnbzlw') });
  assert.strictEqual(corpo.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

// ---------- identificação do servidor (RFC 8292, VAPID) ----------
test('VAPID: chave da instalação criada uma vez, guardada com permissão restrita; JWT ES256 assinado para o serviço certo', () => {
  const v = W.vapid(), arq = path.join(C.CONFIG_DIR, 'push-vapid.json');
  assert.strictEqual(Buffer.from(v.publica, 'base64url').length, 65);
  assert.strictEqual(fs.statSync(arq).mode & 0o777, 0o600, 'só o dono do processo lê a chave privada');
  assert.strictEqual(W.vapid().publica, v.publica, 'não cria outra a cada chamada');
  assert.strictEqual(JSON.parse(fs.readFileSync(arq, 'utf8')).publica, v.publica);
  const agora = Date.parse('2026-11-20T12:00:00Z');
  const h = W.cabecalhoVapid('https://updates.push.services.mozilla.com/wpush/v2/abc', v, agora);
  const m = h.match(/^vapid t=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+), k=([A-Za-z0-9_-]+)$/);
  assert.ok(m, 'formato "vapid t=..., k=..."');
  assert.strictEqual(m[4], v.publica);
  assert.deepStrictEqual(JSON.parse(Buffer.from(m[1], 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const corpo = JSON.parse(Buffer.from(m[2], 'base64url'));
  assert.strictEqual(corpo.aud, 'https://updates.push.services.mozilla.com', 'aud = só a origem do serviço');
  assert.strictEqual(corpo.exp, agora / 1000 + 12 * 3600, 'vale 12 horas (o limite do padrão é 24)');
  assert.match(corpo.sub, /^(mailto:|https:\/\/)/);
  const pub = Buffer.from(v.publica, 'base64url');
  const chave = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
  const ass = Buffer.from(m[3], 'base64url');
  assert.strictEqual(ass.length, 64, 'assinatura crua r||s');
  assert.ok(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: chave, dsaEncoding: 'ieee-p1363' }, ass), 'a chave pública confere a assinatura');
  assert.ok(!crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}x`), { key: chave, dsaEncoding: 'ieee-p1363' }, ass));
  assert.ok(!h.includes(v.privada), 'a parte privada nunca vai no cabeçalho');
});

// ---------- endereços de entrega ----------
test('endereço de entrega: só https dos serviços de push conhecidos', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-by3p.notify.windows.com/w/?token=x', 'https://web.push.apple.com/Qx', 'https://fcm.googleapis.com:443/x']) assert.ok(W.enderecoOk(ok), ok);
  for (const ruim of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://evilfcm.googleapis.com/x', 'https://evil.com/fcm.googleapis.com', 'https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/latest', 'https://painel.interno/x',
    'https://fcm.googleapis.com:8443/x', 'https://user:senha@fcm.googleapis.com/x', 'https://fcm.googleapis.com@evil.com/x', 'https://push.apple.com.evil.com/x', 'https://notify.windows.com.br/x', 'ftp://fcm.googleapis.com/x', 'javascript:alert(1)', '', null, 12, 'https://' + 'a'.repeat(1200) + '.push.apple.com/x']) assert.ok(!W.enderecoOk(ruim), String(ruim).slice(0, 60));
});
test('envio: cabeçalhos certos, espera limitada, sem seguir redirecionamento; nunca lança; endereço recusado nem sai do servidor', async () => {
  const a = aparelho(), s = servico();
  const r = await W.enviar(a.sub, { titulo: 'Oi', texto: 'teste', link: '/' }, { fetch: s.fetch });
  assert.deepStrictEqual(r, { ok: true, status: 201, sumiu: false });
  const p = s.chegou[0];
  assert.strictEqual(p.url, a.sub.endpoint);
  assert.strictEqual(p.headers['Content-Encoding'], 'aes128gcm');
  assert.match(p.headers.Authorization, /^vapid t=.+, k=.+$/);
  assert.ok(+p.headers.TTL > 0);
  assert.strictEqual(p.redirect, 'error');
  assert.ok(p.signal, 'tem limite de espera');
  assert.deepStrictEqual(JSON.parse(W.abrir(p.body, a.ecdh, a.auth)), { titulo: 'Oi', texto: 'teste', link: '/' });
  // serviço fora do ar, demorando ou recusando: devolve o resultado, não lança
  assert.strictEqual((await W.enviar(a.sub, 'x', { fetch: async () => { throw new Error('rede'); } })).ok, false);
  const vivo = setTimeout(() => {}, 5000); // o relógio do limite de espera não segura o processo aberto: o teste segura
  const lento = await W.enviar(a.sub, 'x', { espera: 30, fetch: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(o.signal.reason))) });
  clearTimeout(vivo);
  assert.strictEqual(lento.ok, false); assert.match(lento.erro, /demorou/);
  assert.deepStrictEqual(await W.enviar(a.sub, 'x', { fetch: async () => ({ status: 410 }) }), { ok: false, status: 410, sumiu: true });
  assert.strictEqual((await W.enviar(a.sub, 'x', { fetch: async () => ({ status: 429 }) })).sumiu, false);
  // endereço fora da lista: nenhuma chamada é feita
  let chamou = 0;
  const fora = await W.enviar({ endpoint: 'https://painel.interno/admin', keys: a.sub.keys }, 'x', { fetch: async () => { chamou++; return { status: 201 }; } });
  assert.strictEqual(fora.ok, false); assert.strictEqual(chamou, 0);
  const semChave = await W.enviar({ endpoint: a.sub.endpoint, keys: { p256dh: 'abc', auth: 'def' } }, 'x', { fetch: async () => { chamou++; return { status: 201 }; } });
  assert.strictEqual(semChave.ok, false); assert.strictEqual(chamou, 0);
});

// ---------- aparelhos de cada pessoa ----------
test('aparelhos: cada pessoa só vê e remove os próprios; a tela não recebe chave nem endereço; endereço e chave são conferidos', () => {
  limparPush();
  const a = aparelho(1), b = aparelho(2);
  const r = P.ativar('ger', a.sub, 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36');
  assert.strictEqual(r.ok.nome, 'Chrome no Android');
  assert.deepStrictEqual(Object.keys(r.ok).sort(), ['criadoEm', 'id', 'nome', 'tipos', 'ultimoEm']);
  assert.deepStrictEqual(r.ok.tipos, ['espera', 'sugestao', 'zap'], 'começa com todos os tipos que a pessoa pode receber');
  P.ativar('dono', b.sub, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1');
  const txt = JSON.stringify(P.aparelhos('ger'));
  assert.ok(!txt.includes('fcm.googleapis') && !txt.includes(a.sub.keys.p256dh) && !txt.includes(a.auth), 'nada de endereço nem chave');
  assert.strictEqual(P.aparelhos('ger').length, 1); assert.strictEqual(P.aparelhos('dono')[0].nome, 'Safari no iPhone');
  // um não mexe no do outro
  assert.ok(P.remover('ger', P.aparelhos('dono')[0].id).erro);
  assert.ok(P.mudarTipos('ger', P.aparelhos('dono')[0].id, []).erro);
  assert.strictEqual(P.aparelhos('dono').length, 1);
  // tipos: só os que a pessoa pode
  assert.deepStrictEqual(P.mudarTipos('ger', r.ok.id, ['zap', 'inventado', 'zap']).ok.tipos, ['zap']);
  const v = aparelho(3);
  assert.deepStrictEqual(P.ativar('vend', { ...v.sub, tipos: ['espera', 'zap', 'sugestao'] }, '').ok.tipos, ['espera'], 'vendedora: só a Lista de espera');
  assert.deepStrictEqual(P.tiposDe('vend').map((t) => t.id), ['espera', 'validade'], 'vendedora: Lista de espera e Validade (as telas fixas dela)');
  assert.deepStrictEqual(P.tiposDe('ger_sem'), []);
  // recusados
  assert.match(P.ativar('ger', { endpoint: 'https://evil.com/x', keys: a.sub.keys }, '').erro, /não conhece/);
  assert.match(P.ativar('ger', { endpoint: a.sub.endpoint, keys: { p256dh: 'AAAA', auth: 'AAAA' } }, '').erro, /chave inválida/);
  assert.ok(P.ativar('ninguem', a.sub, '').erro);
  // o mesmo aparelho ativado por outra pessoa (celular compartilhado) passa a ser só dela
  P.ativar('dono', a.sub, '');
  assert.strictEqual(P.aparelhos('ger').length, 0); assert.strictEqual(P.aparelhos('dono').length, 2);
  // limite por pessoa
  limparPush();
  for (let i = 0; i < 10; i++) assert.ok(P.ativar('ger', aparelho(100 + i).sub, '').ok);
  assert.match(P.ativar('ger', aparelho(999).sub, '').erro, /Máximo de 10/);
  // o arquivo com as chaves dos aparelhos também fica só para o dono do processo
  assert.strictEqual(fs.statSync(P.ARQ()).mode & 0o777, 0o600);
});

// ---------- eventos ----------
test('cada evento chega só a quem tem a tela do assunto, só da loja da pessoa e só nos aparelhos com o tipo marcado', async () => {
  limparPush();
  const ap = {}; let n = 0;
  for (const nome of ['chefe', 'dono', 'dono2', 'ger', 'ger_sem', 'vend']) { ap[nome] = aparelho(++n); P.ativar(nome, ap[nome].sub, ''); }
  const quem = async (e) => { const s = servico(); const r = await P.avisar(e, { fetch: s.fetch }); return { r, nomes: r.pessoas.sort(), s }; };
  // lista de espera: toda a equipe da loja 1 que usa a tela (inclusive a vendedora); nunca a loja 2
  let x = await quem({ tipo: 'espera', loja: 'l1', chave: 'e1', titulo: 'Lista de espera · Loja 1', texto: 'Chegou: Rooibos (2 clientes)', link: '/#espera' });
  assert.deepStrictEqual(x.nomes, ['chefe', 'dono', 'ger', 'vend']);
  assert.strictEqual(x.r.enviados, 4);
  const msg = JSON.parse(W.abrir(x.s.chegou.find((c) => c.url === ap.vend.sub.endpoint).body, ap.vend.ecdh, ap.vend.auth));
  assert.deepStrictEqual(msg, { titulo: 'Lista de espera · Loja 1', texto: 'Chegou: Rooibos (2 clientes)', link: '/#espera', tag: 'espera' });
  // sugestão para o pedido: quem decide (tela Pedido); nunca a vendedora; quem sugeriu não recebe o próprio aviso
  x = await quem({ tipo: 'sugestao', loja: 'l1', chave: 's1', titulo: 'Sugestão', texto: 'ANA sugeriu Sencha.', link: '/#pedido', menos: 'ger' });
  assert.deepStrictEqual(x.nomes, ['chefe', 'dono']);
  // robô do WhatsApp: admin, franqueado da loja e gerente com Clientes
  x = await quem({ tipo: 'zap', loja: 'l2', chave: 'z1', titulo: 'Robô', texto: 'pausou', link: '/#campanhas' });
  assert.deepStrictEqual(x.nomes, ['chefe', 'dono2']);
  x = await quem({ tipo: 'zap', loja: 'l1', chave: 'z2', titulo: 'Robô', texto: 'pausou', link: '/#campanhas' });
  assert.deepStrictEqual(x.nomes, ['chefe', 'dono', 'ger']);
  // tipo desmarcado no aparelho: não chega
  P.mudarTipos('dono', P.aparelhos('dono')[0].id, ['espera']);
  x = await quem({ tipo: 'zap', loja: 'l1', chave: 'z3', titulo: 'Robô', texto: 'pausou' });
  assert.deepStrictEqual(x.nomes, ['chefe', 'ger']);
  // tipo que não existe e link de fora: nada sai / o link vira "/"
  assert.strictEqual((await quem({ tipo: 'inventado', loja: 'l1', titulo: 'x' })).r.enviados, 0);
  x = await quem({ tipo: 'espera', loja: 'l1', chave: 'e2', titulo: 'x', texto: 'y', link: 'https://evil.com/' });
  assert.strictEqual(JSON.parse(W.abrir(x.s.chegou[0].body, ap[x.nomes.includes('chefe') ? 'chefe' : 'dono'].ecdh, ap.chefe.auth)).link, '/');
});

test('permissão conferida a cada envio: quem perde a tela, é desativado, vence o prazo ou é excluído para de receber', async () => {
  limparPush();
  const g = aparelho(1), d = aparelho(2);
  P.ativar('ger', g.sub, ''); P.ativar('dono', d.sub, '');
  const quem = async (chave) => (await P.avisar({ tipo: 'espera', loja: 'l1', chave, titulo: 't', texto: 'x' }, { fetch: servico().fetch })).pessoas.sort();
  assert.deepStrictEqual(await quem('p1'), ['dono', 'ger']);
  assert.ok(P.podeReceber('ger', 'espera', 'l1'));
  // o gerente perde a tela: o aparelho continua cadastrado, mas nada chega
  await mudarCfg((u) => { u.ger.telas = ['resumo']; });
  assert.ok(!P.podeReceber('ger', 'espera', 'l1'));
  assert.deepStrictEqual(await quem('p2'), ['dono']);
  assert.strictEqual(P.aparelhos('ger').length, 1);
  // volta a tela, perde a loja
  await mudarCfg((u) => { u.ger.telas = ['espera']; u.ger.lojas = ['l2']; });
  assert.deepStrictEqual(await quem('p3'), ['dono']);
  // volta a loja, é desativado
  await mudarCfg((u) => { u.ger.lojas = ['l1']; u.ger.ativo = false; });
  assert.deepStrictEqual(await quem('p4'), ['dono']);
  // reativado, com o prazo de acesso vencido
  await mudarCfg((u) => { u.ger.ativo = true; u.ger.acessoAte = '2020-01-01'; });
  assert.deepStrictEqual(await quem('p5'), ['dono']);
  // senha provisória (ainda não entrou de verdade)
  await mudarCfg((u) => { u.ger.acessoAte = null; u.ger.trocarSenha = true; });
  assert.deepStrictEqual(await quem('p6'), ['dono']);
  await mudarCfg((u) => { u.ger.trocarSenha = false; });
  assert.deepStrictEqual(await quem('p7'), ['dono', 'ger']);
  // excluído do painel: para de receber e os aparelhos dele são apagados
  await mudarCfg((u) => { delete u.ger; });
  assert.deepStrictEqual(await quem('p8'), ['dono']);
  assert.ok(!JSON.parse(fs.readFileSync(P.ARQ(), 'utf8')).usuarios.ger, 'aparelhos do excluído saíram do arquivo');
  await mudarCfg((u) => { u.ger = { senha: 'x', perfil: 'gerente', lojas: ['l1'], ativo: true, telas: ['resumo', 'espera', 'clientes', 'pedido'], telasV: 99 }; });
});

test('aparelho que sumiu (404 ou 410) sai da lista; outros erros não removem; o último envio fica anotado', async () => {
  limparPush();
  const a = aparelho(1), b = aparelho(2), c = aparelho(3), d = aparelho(4);
  P.ativar('dono', a.sub, ''); P.ativar('dono', b.sub, ''); P.ativar('chefe', c.sub, ''); P.ativar('ger', d.sub, '');
  const s = servico({ [a.sub.endpoint]: 410, [c.sub.endpoint]: 404, [d.sub.endpoint]: 500 });
  const r = await P.avisar({ tipo: 'espera', loja: 'l1', chave: 'x1', titulo: 't', texto: 'x' }, { fetch: s.fetch });
  assert.deepStrictEqual({ enviados: r.enviados, falhas: r.falhas, removidos: r.removidos }, { enviados: 1, falhas: 3, removidos: 2 });
  assert.deepStrictEqual(P.aparelhos('dono').map((x) => x.id), [P.idDe(b.sub.endpoint)]);
  assert.ok(P.aparelhos('dono')[0].ultimoEm, 'anota o último aviso entregue');
  assert.strictEqual(P.aparelhos('chefe').length, 0);
  assert.strictEqual(P.aparelhos('ger').length, 1, 'erro 500 é do serviço: o aparelho fica');
  // teste manual num aparelho que sumiu: avisa e remove
  const t = await P.testar('ger', P.aparelhos('ger')[0].id, { fetch: async () => ({ status: 410 }) });
  assert.ok(t.sumiu); assert.strictEqual(P.aparelhos('ger').length, 0);
  // teste só no aparelho da própria pessoa
  assert.ok((await P.testar('ger', P.aparelhos('dono')[0].id, { fetch: servico().fetch })).erro);
  const ok = servico();
  assert.deepStrictEqual(await P.testar('dono', P.aparelhos('dono')[0].id, { fetch: ok.fetch }), { ok: true });
  assert.match(JSON.parse(W.abrir(ok.chegou[0].body, b.ecdh, b.auth)).texto, /funcionando/);
});

test('não repete: o evento é marcado como avisado ANTES do envio (mesmo se o envio falhar) e nunca derruba quem chamou', async () => {
  limparPush();
  const a = aparelho(1);
  P.ativar('dono', a.sub, '');
  const s = servico();
  const e = { tipo: 'espera', loja: 'l1', chave: 'espera:l1:abc', titulo: 't', texto: 'x' };
  // no momento em que o serviço é chamado, a chave já está gravada
  let jaMarcado = null;
  const r1 = await P.avisar(e, { fetch: async (u, o) => { jaMarcado = !!JSON.parse(fs.readFileSync(P.ARQ(), 'utf8')).avisados['espera:l1:abc']; return s.fetch(u, o); } });
  assert.strictEqual(jaMarcado, true);
  assert.strictEqual(r1.enviados, 1);
  assert.deepStrictEqual(await P.avisar(e, { fetch: s.fetch }), { repetido: true });
  assert.strictEqual(s.chegou.length, 1, 'uma notificação só');
  // envio que falha: fica marcado do mesmo jeito (melhor perder um aviso do que repetir sem parar)
  const r2 = await P.avisar({ ...e, chave: 'espera:l1:def' }, { fetch: async () => { throw new Error('rede caiu'); } });
  assert.strictEqual(r2.enviados, 0); assert.strictEqual(r2.falhas, 1);
  assert.deepStrictEqual(await P.avisar({ ...e, chave: 'espera:l1:def' }, { fetch: s.fetch }), { repetido: true });
  // nada lança: evento quebrado, arquivo corrompido
  assert.strictEqual((await P.avisar(null)).enviados, 0);
  fs.writeFileSync(P.ARQ(), '{quebrado');
  assert.strictEqual((await P.avisar({ ...e, chave: 'k9' }, { fetch: s.fetch })).enviados, 0);
  assert.doesNotThrow(() => P.avisarDepois({ ...e, chave: 'k10' }));
});

test('os eventos do painel estão ligados: lista de espera, sugestão para o pedido e robô do WhatsApp (pausa e queda)', () => {
  const raiz = path.join(__dirname, '../..');
  const srv = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8'), laco = fs.readFileSync(path.join(raiz, 'src/zaplaco.js'), 'utf8');
  assert.match(srv, /PUSH\.avisarDepois\(\{ tipo: 'espera', loja: loja\.id, chave: `espera:\$\{loja\.id\}:/);
  assert.match(srv, /PUSH\.avisarDepois\(\{ tipo: 'sugestao', loja: loja\.id, chave: `sugestao:\$\{loja\.id\}:\$\{r\.ok\.id\}`, menos: req\.user/);
  assert.match(laco, /if \(pausou\) avisarAparelhos\(lojaId, `pausa:/);
  assert.match(laco, /if \(!antes\) avisarAparelhos\(lojaId, `queda:/);
  assert.match(laco, /avisarDepois\(\{ tipo: 'zap', loja: lojaId, chave: `zap:\$\{lojaId\}:\$\{chave\}`/);
  // o service worker só aceita link do próprio painel e não guarda página
  const sw = fs.readFileSync(path.join(raiz, 'public/sw.js'), 'utf8');
  assert.ok(!/caches\.|addEventListener\('fetch'/.test(sw), 'sem cache e sem interceptar páginas');
  assert.match(sw, /\^\\\/\(\?!\[\/\\\\\]\)/);
});
