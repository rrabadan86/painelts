'use strict';
// SMTP-01/02: a conexão segura segue a porta e o erro do servidor de e-mail sai em português, dizendo o que fazer
const test = require('node:test');
const assert = require('node:assert');
const N = require('../../src/notificacoes');

test('SMTP-01: porta 587 nunca usa conexão direta; 465 sempre usa; outras seguem a caixa', () => {
  assert.strictEqual(N.transporteSmtp({ host: 'smtp.gmail.com', port: 587, secure: true }).secure, false);
  assert.strictEqual(N.transporteSmtp({ host: 'smtp.gmail.com', port: '587', secure: true }).secure, false);
  assert.strictEqual(N.transporteSmtp({ host: 'smtp.gmail.com', port: 465, secure: false }).secure, true);
  assert.strictEqual(N.transporteSmtp({ host: 'smtp.x.com', port: 2525, secure: true }).secure, true);
  assert.strictEqual(N.transporteSmtp({ host: 'smtp.x.com', port: 2525, secure: false }).secure, false);
  assert.strictEqual(N.transporteSmtp({ host: 'smtp.x.com' }).port, 587);
});

test('SMTP-02: erros conhecidos viram explicação; nada de caminho de arquivo do OpenSSL', () => {
  const ssl = N.msgSmtp(new Error('989267F5F47A0000:error:0A00010B:SSL routines:tls_validate_record_header:wrong version number:../deps/openssl/openssl/ssl/record/methods/tlsany_meth.c:77:'));
  assert.match(ssl, /porta 587/);
  assert.doesNotMatch(ssl, /openssl|\.c:/);
  assert.match(N.msgSmtp(new Error('Invalid login: 535-5.7.8 Username and Password not accepted')), /senha de app/);
  assert.match(N.msgSmtp(new Error('connect ETIMEDOUT 1.2.3.4:587')), /smtp\.gmail\.com/);
  assert.doesNotMatch(N.msgSmtp(new Error('falha (x/y/z.c:10: coisa)')), /\.c:10/);
});

test('FECH-REENV-01: só reenvia o fechamento de um dia válido dos últimos 60 dias, nunca do futuro', () => {
  const hoje = '2026-11-25';
  assert.ok(N.diaReenvioOk('2026-11-25', hoje));
  assert.ok(N.diaReenvioOk('2026-11-24', hoje));
  assert.ok(N.diaReenvioOk('2026-09-26', hoje)); // 60 dias
  assert.ok(!N.diaReenvioOk('2026-09-25', hoje)); // 61
  assert.ok(!N.diaReenvioOk('2026-11-26', hoje), 'amanhã não');
  assert.ok(!N.diaReenvioOk('2026-02-30', hoje), 'data que não existe');
  assert.ok(!N.diaReenvioOk('25/11/2026', hoje));
  assert.ok(!N.diaReenvioOk('', hoje));
});
