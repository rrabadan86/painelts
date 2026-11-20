'use strict';
/**
 * Rotas das notificações no aparelho (/api/push/*): cada pessoa só vê e mexe nos próprios aparelhos.
 * Nada aqui devolve chave do aparelho nem endereço de entrega; da chave VAPID só sai a parte pública (o navegador precisa dela).
 */
const express = require('express');
const C = require('./config');
const W = require('./webpush');
const P = require('./push');

function registrar(app) {
  const r = express.Router();
  const json = express.json({ limit: '8kb' });
  r.use((req, res, next) => {
    if (req.method !== 'GET' && req.get('X-Painel') !== '1') return res.status(403).json({ erro: 'Pedido inválido.' });
    if (!req.user || req.user === '*' || !C.get().usuarios[req.user]) return res.status(403).json({ erro: 'As notificações precisam de um usuário próprio.' });
    next();
  });
  const estado = (req) => ({ chave: W.vapid().publica, tipos: P.tiposDe(req.user), aparelhos: P.aparelhos(req.user) });
  r.get('/', (req, res) => { try { res.json(estado(req)); } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); } });
  r.post('/aparelhos', json, (req, res) => {
    try {
      const x = P.ativar(req.user, req.body || {}, req.get('User-Agent'));
      if (x.erro) return res.status(400).json({ erro: x.erro });
      if (x.novo) C.auditar(req.user, 'ativou as notificações num aparelho', req.user, { aparelho: x.ok.nome });
      W.definirContato(`${req.protocol}://${req.get('host')}`);
      res.json({ ok: true, aparelho: x.ok, ...estado(req) });
    } catch (e) { res.status(500).json({ erro: C.msgErro(e) }); }
  });
  r.put('/aparelhos/:id', json, (req, res) => {
    const x = P.mudarTipos(req.user, String(req.params.id), (req.body || {}).tipos);
    if (x.erro) return res.status(404).json({ erro: x.erro });
    res.json({ ok: true, ...estado(req) });
  });
  r.delete('/aparelhos/:id', (req, res) => {
    const x = P.remover(req.user, String(req.params.id));
    if (x.erro) return res.status(404).json({ erro: x.erro });
    C.auditar(req.user, 'removeu um aparelho das notificações', req.user, {});
    res.json({ ok: true, ...estado(req) });
  });
  // teste: no máximo um a cada 10 segundos por pessoa
  const ultimoTeste = new Map();
  r.post('/teste', json, async (req, res) => {
    const agora = Date.now();
    if (agora - (ultimoTeste.get(req.user) || 0) < 10000) return res.status(429).json({ erro: 'Espere alguns segundos antes de enviar outro teste.' });
    ultimoTeste.set(req.user, agora);
    const x = await P.testar(req.user, String((req.body || {}).id || ''));
    if (x.erro) return res.status(x.sumiu ? 410 : 502).json({ erro: x.erro, ...estado(req) });
    res.json({ ok: true });
  });
  app.use('/api/push', r);
}
/** apresentação: tela com um aparelho fictício; nada é ativado nem enviado */
function demo(app) {
  app.get('/api/demo/push', (req, res) => res.json({
    chave: '', tipos: P.TIPOS.map(({ id, nome, dica }) => ({ id, nome, dica })),
    aparelhos: [{ id: 'demo000000000001', nome: 'Chrome no Android', tipos: ['espera', 'zap'], criadoEm: new Date(Date.now() - 6 * 864e5).toISOString(), ultimoEm: new Date(Date.now() - 864e5).toISOString() }],
  }));
}
module.exports = { registrar, demo };
