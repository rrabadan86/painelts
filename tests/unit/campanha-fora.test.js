'use strict';
// Clientes tirados à mão da campanha (pedido do dono, 23/11/2026): filtros.fora — src/campanhas.js (guarda e tira dos pendentes)
// e public/js/campanhas.js (selecionar / listaResumo, a mesma conta da tela e do robô; a do robô está em zapauto.test.js)
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'campfora-'));
process.env.DATA_DIR = tmp;
const C = require('../../src/config');
C.pastaLoja = (id) => path.join(tmp, 'lojas', id);
const CAMP = require('../../src/campanhas');
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const A = '11111111111', B = '22222222222', D = '33333333333';
const lista = [{ cpf: A, nome: 'ANA' }, { cpf: B, nome: 'BIA' }, { cpf: D, nome: 'DUDA' }];

test('CAMP-FORA-02: o servidor guarda em filtros.fora só CPFs válidos, sem repetir', () => {
  const r = CAMP.criar('fora', { nome: 'Fora', mensagem: 'Oi {nome}', comparar: false, lista, filtros: { ausMin: 10, fora: ['44444444444', 'x', '123', '44444444444', 5] } }, 'adm');
  assert.ok(r.ok, r.erro);
  assert.deepStrictEqual(r.ok.filtros.fora, ['44444444444']);
  const s = CAMP.criar('fora', { nome: 'Lixo', mensagem: 'Oi', comparar: false, lista, filtros: { fora: 'abc' } }, 'adm');
  assert.ok(s.ok, s.erro);
  assert.strictEqual(s.ok.filtros.fora, undefined, 'não é lista: ignora');
});

test('CAMP-FORA-03: tirar numa campanha já criada tira dos pendentes; quem já recebeu continua no histórico', () => {
  const r = CAMP.criar('fora', { nome: 'Já criada', mensagem: 'Oi {nome}', comparar: false, lista, filtros: { ausMin: 10 } }, 'adm');
  const id = r.ok.id, rid = r.ok.rodadas[0].id;
  assert.ok(CAMP.marcar('fora', id, rid, B, 'e', 'adm').ok, 'Bia já recebeu');
  const x = CAMP.alterar('fora', id, { filtros: { ausMin: 10, fora: [A, B] } });
  assert.ok(x.ok, x.erro);
  assert.strictEqual(x.tirados, 1, 'só a Ana (pendente) sai');
  assert.deepStrictEqual(x.ok.rodadas[0].lista.map((y) => [y.cpf, y.st]), [[B, 'e'], [D, 'p']]);
  // gravado
  const gravada = CAMP.ler('fora').find((c) => c.id === id);
  assert.deepStrictEqual(gravada.filtros.fora, [A, B]);
  assert.deepStrictEqual(gravada.rodadas[0].lista.map((y) => y.cpf), [B, D]);
  // voltar para a campanha: fica fora de filtros.fora (a lista nova/refeita a inclui de novo)
  const v = CAMP.alterar('fora', id, { filtros: { ausMin: 10, fora: [B] } });
  assert.deepStrictEqual(v.ok.filtros.fora, [B]);
  assert.strictEqual(v.tirados, 0);
});
