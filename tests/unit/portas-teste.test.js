// Servidor de teste: a porta sorteada nunca é uma que o fetch do Node recusa ("bad port") e as faixas dos arquivos
// não se cruzam (com 4045 e 6000 o teste esperava 90 s e caía no GitHub: "o servidor de teste não subiu").
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const porta = require('./_porta');

test('PORTA-01: o sorteio pula as portas que o fetch recusa e fica na faixa', async () => {
  for (let k = 0; k < 2000; k++) { const p = porta(3900, 200); assert.ok(p >= 3900 && p < 4100); assert.ok(!porta.PROIBIDAS.has(p), `porta ${p}`); }
  for (const p of [4045, 6000, 3659, 4190]) await assert.rejects(fetch(`http://127.0.0.1:${p}/`), (e) => /bad port/i.test(String(e.cause && e.cause.message)), `fetch recusa ${p}`);
});

test('PORTA-02: todo teste que sobe o servidor usa o sorteio e as faixas não se cruzam', () => {
  const dir = __dirname, faixas = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.test.js'))) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/const PORTA = \d+ \+ Math\.floor\(Math\.random/.test(s), `${f}: sorteie com require('./_porta')(início, tamanho)`);
    const m = s.match(/const PORTA = require\('\.\/_porta'\)\((\d+), (\d+)\)/);
    if (m) faixas.push({ f, a: +m[1], b: +m[1] + +m[2] });
  }
  assert.ok(faixas.length >= 10);
  faixas.sort((x, y) => x.a - y.a);
  for (let i = 1; i < faixas.length; i++) assert.ok(faixas[i].a >= faixas[i - 1].b, `${faixas[i - 1].f} e ${faixas[i].f} usam a mesma faixa de portas`);
});
