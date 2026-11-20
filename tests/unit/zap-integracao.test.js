'use strict';
// O painel (src/zap.js) conversando com o serviço de verdade (zap/server.js + zap/sessoes.js), com um WhatsApp DE MENTIRA:
// confere que as duas partes falam o mesmo contrato (situação, conectar, enviar, idempotência, sem WhatsApp, respostas de saída).
const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { criarServidor } = require('../../zap/server');
const { criarSessoes } = require('../../zap/sessoes');

function fabrica(clientes) {
  return (loja) => {
    const c = new EventEmitter();
    Object.assign(c, { enviadas: [], semWhatsapp: new Set(),
      async iniciar() {}, async pedirCodigo() { return 'ABCD1234'; },
      async temWhatsapp(n) { return c.semWhatsapp.has(n) ? null : n + '@c.us'; },
      async digitando() {}, async enviar(d, texto) { c.enviadas.push({ d, texto }); return 'msg' + c.enviadas.length; },
      async vivo() { return true; }, async sair() {}, async fechar() {} });
    clientes[loja] = c;
    return c;
  };
}

test('painel ↔ serviço zap: situação, conectar, enviar uma vez só, sem WhatsApp, desconectado e "parar"', async () => {
  const clientes = {};
  const sessoes = criarSessoes({ fabrica: fabrica(clientes), espera: async () => {}, digitandoMs: [0, 0], log: () => {}, agendar: () => {} });
  const { servidor } = criarServidor({ token: 'segredo-de-teste', sessoes, log: () => {} });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  process.env.ZAP_URL = 'http://127.0.0.1:' + servidor.address().port;
  process.env.ZAP_TOKEN = 'segredo-de-teste';
  const ZAP = require('../../src/zap');
  try {
    assert.equal(ZAP.ativo(), true);
    assert.deepEqual(await ZAP.saude(), { ok: true });
    assert.equal((await ZAP.status('lojaa')).estado, 'desligado');
    // sem conexão, enviar devolve "desconectado" (não liga o WhatsApp sozinho)
    assert.deepEqual((({ ok, motivo }) => ({ ok, motivo }))(await ZAP.enviar('lojaa', { id: 'c1-r1-111', para: '5562999998888', texto: 'oi' })), { ok: false, motivo: 'desconectado' });
    await ZAP.conectar('lojaa');
    clientes.lojaa.emit('qr', 'data:image/png;base64,AAAA');
    const q = await ZAP.status('lojaa');
    assert.deepEqual([q.estado, q.qr], ['qr', 'data:image/png;base64,AAAA']);
    clientes.lojaa.emit('pronto', { numero: '5562911112222' });
    const s = await ZAP.status('lojaa');
    assert.deepEqual([s.estado, s.numeroFim], ['conectado', '2222']);
    assert.ok(!JSON.stringify(s).includes('5562911112222'), 'o número completo não sai do serviço');
    // envia; o mesmo id não reenvia
    const r1 = await ZAP.enviar('lojaa', { id: 'c1-r1-111', para: '5562999998888', texto: 'Olá, Ana!' });
    assert.equal(r1.ok, true);
    const r2 = await ZAP.enviar('lojaa', { id: 'c1-r1-111', para: '5562999998888', texto: 'Olá, Ana!' });
    assert.equal(r2.ok, true);
    assert.equal(clientes.lojaa.enviadas.length, 1, 'uma mensagem só');
    assert.equal(clientes.lojaa.enviadas[0].texto, 'Olá, Ana!');
    // número sem WhatsApp
    clientes.lojaa.semWhatsapp.add('5562988887777');
    const r3 = await ZAP.enviar('lojaa', { id: 'c1-r1-222', para: '5562988887777', texto: 'oi' });
    assert.deepEqual([r3.ok, r3.motivo], [false, 'sem_whatsapp']);
    // respostas de saída: só o número e a hora
    const o = await ZAP.optouts('lojaa', new Date(Date.now() - 3600e3).toISOString());
    assert.ok(Array.isArray(o.itens));
    // token errado: mensagem clara para a tela
    process.env.ZAP_TOKEN = 'outro';
    await assert.rejects(() => ZAP.status('lojaa'), /ZAP_TOKEN diferente/);
    process.env.ZAP_TOKEN = 'segredo-de-teste';
    await ZAP.desconectar('lojaa');
    assert.equal((await ZAP.status('lojaa')).estado, 'desligado');
  } finally {
    await new Promise((r) => servidor.close(r));
    delete process.env.ZAP_URL; delete process.env.ZAP_TOKEN;
  }
});
