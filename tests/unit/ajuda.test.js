'use strict';
/* Ajuda do painel (pedido do dono, 25/11/2026; AJUDA-01, AJUDA-03): toda página do menu tem ficha, e as fichas que a
   vendedora pode ver não falam de custo nem de margem (linhas assim levam a marca `custo` e só aparecem para quem vê custo). */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../../public/js/ajuda.js');
const T = require('../../src/telas');

const PUB = path.join(__dirname, '../../public/js');
const js = fs.readdirSync(PUB).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(PUB, f), 'utf8')).join('\n');

test('AJUDA-01: toda página do menu (src/telas.js e TS.pages) tem uma ficha completa, uma só', () => {
  const pags = new Set([...Object.values(T.PAGINAS).flat(), ...[...js.matchAll(/TS\.pages\.([a-zA-Z_]+)\s*=/g)].map((m) => m[1])]);
  const fichas = A.FICHAS.map((f) => f.pag);
  assert.deepStrictEqual(fichas.filter((p, i) => fichas.indexOf(p) !== i), [], 'ficha repetida');
  const faltam = [...pags].filter((p) => !fichas.includes(p));
  assert.deepStrictEqual(faltam, [], `Tela sem ficha na Ajuda: ${faltam.join(', ')} — escreva em public/js/ajuda.js`);
  const sobram = fichas.filter((p) => !pags.has(p));
  assert.deepStrictEqual(sobram, [], `Ficha de tela que não existe: ${sobram.join(', ')}`);
  const grupos = new Set(T.GRUPOS.map(([g]) => g));
  for (const f of A.FICHAS) {
    assert.ok(grupos.has(f.grupo), `${f.pag}: grupo "${f.grupo}" não é um grupo do menu`);
    assert.ok(f.nome && f.serve && f.quem, `${f.pag}: nome, para que serve e quem vê`);
    assert.ok(f.nums.length >= 1, `${f.pag}: pelo menos um número explicado`);
    for (const x of [...f.nums, ...f.perg]) assert.ok(x[0] && x[1] && (x[2] == null || x[2] === A.C), `${f.pag}: linha bem formada`);
  }
});

test('AJUDA-03: as fichas e as perguntas que a vendedora vê não falam de custo, margem nem lucro', () => {
  const daVendedora = new Set(T.TODAS.filter((t) => t.vendedor !== 'nunca').flatMap((t) => T.PAGINAS[t.id] || [t.id]));
  assert.ok(daVendedora.has('validade') && daVendedora.has('minha'), 'achou as telas da vendedora');
  const proibido = /custo|margem|lucro|CMV/i;
  for (const f of A.FICHAS.filter((x) => daVendedora.has(x.pag))) {
    for (const x of [f.nome, f.serve, f.quem]) assert.doesNotMatch(x, proibido, f.pag);
    for (const [n, d, so] of [...f.nums, ...f.perg]) if (so !== A.C) assert.doesNotMatch(n + ' ' + d, proibido, `${f.pag}: "${n}" precisa da marca custo`);
  }
  for (const q of A.FAQ.filter((x) => !x.pags.length || x.pags.some((p) => daVendedora.has(p)))) assert.doesNotMatch(q.p + ' ' + q.r, proibido, q.p);
});
