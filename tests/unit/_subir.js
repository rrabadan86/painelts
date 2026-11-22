'use strict';
/**
 * Espera o servidor de teste (server.js em outro processo) responder. No GitHub, com vários arquivos de teste subindo um
 * servidor ao mesmo tempo, 30 s já não bastaram duas vezes ("fetch failed" sem pista): espera até 90 s, para na hora se o
 * processo cair e mostra a saída de erro dele. Use com stdio: ['ignore', 'ignore', 'pipe'].
 */
const assert = require('node:assert');
module.exports = async function esperarServidor(srv, base) {
  let saida = '', caiu = null, subiu = false;
  if (srv.stderr) srv.stderr.on('data', (d) => { saida = (saida + d).slice(-4000); });
  srv.once('exit', (c) => { caiu = c; });
  for (let k = 0; k < 900 && caiu === null; k++) {
    try { const r = await fetch(base + '/login'); if (r.status < 500) { subiu = true; break; } } catch { /* subindo */ }
    await new Promise((ok) => setTimeout(ok, 100));
  }
  assert.ok(subiu, `o servidor de teste não subiu em ${base}${caiu !== null ? ` (saiu com código ${caiu})` : ' em 90 s'}:\n${saida}`);
};
