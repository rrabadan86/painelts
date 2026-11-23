// Guardião da matriz de rastreabilidade (decisão do dono, 23/11/2026: "a matriz sempre precisa estar atualizada").
// Falha o PR quando a matriz fica velha: código repetido, teste citado que não existe, teste com código de regra sem
// linha na matriz, regra marcada ✅ sem teste ou resumo em números diferente do que as linhas dão.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const M = require('../../scripts/matriz');

const RAIZ = path.join(__dirname, '../..');
const m = M.ler();

/** códigos de regra no começo do nome dos testes ("CUP-01: …", "[PORTA-01] …", "RESUMO-07 (tela) …") */
function codigosDosTestes() {
  const arquivos = [];
  (function andar(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules' && !f.startsWith('.')) andar(p); } else if (/\.(test|spec)\.js$/.test(f)) arquivos.push(p);
    }
  })(path.join(RAIZ, 'tests'));
  for (const f of fs.readdirSync(path.join(RAIZ, 'zap/tests'))) if (/\.test\.js$/.test(f)) arquivos.push(path.join(RAIZ, 'zap/tests', f));
  const re = /\b(?:test|it)(?:\.\w+)?\(\s*(['"`])\[?([A-Z]{2,6}(?:-[A-Z0-9]+)+)(?:[\]:]|\s|\(|…)/g;
  const out = new Map();
  for (const f of arquivos) {
    const s = fs.readFileSync(f, 'utf8');
    for (const mm of s.matchAll(re)) if (!out.has(mm[2])) out.set(mm[2], path.relative(RAIZ, f));
  }
  return out;
}

test('MATRIZ-01: cada código de regra aparece numa linha só e toda linha tem cobertura ✅, 🟡 ou ❌', () => {
  assert.ok(m.linhas.length > 300, 'a matriz foi lida');
  const vistos = new Map();
  for (const l of m.linhas) {
    assert.ok(l.codigos.length, `linha ${l.linha}: sem código ("${l.celula}")`);
    assert.ok(l.cobertura, `${l.celula} (linha ${l.linha}): cobertura sem ✅, 🟡 ou ❌`);
    for (const c of l.codigos) {
      assert.ok(!vistos.has(c), `${c} repetido nas linhas ${vistos.get(c)} e ${l.linha}`);
      vistos.set(c, l.linha);
    }
  }
});

test('MATRIZ-02: todo teste citado numa regra coberta (✅ ou 🟡) existe', () => {
  for (const l of m.linhas) {
    if (l.cobertura === '❌') continue;
    for (const t of M.testesDe(l.teste)) assert.ok(fs.existsSync(path.join(RAIZ, t)), `${l.celula}: o teste ${t} não existe (renomeado ou apagado? atualize a linha)`);
  }
});

test('MATRIZ-03: regra ✅ sempre aponta um teste', () => {
  for (const l of m.linhas.filter((x) => x.cobertura === '✅')) {
    assert.ok(!/^—/.test(l.teste.trim()), `${l.celula}: marcada ✅ sem teste`);
    assert.ok(M.testesDe(l.teste).length || /e2e|apresentação/.test(l.teste), `${l.celula}: marcada ✅ sem arquivo de teste citado`);
  }
});

test('MATRIZ-04: todo teste com código de regra no nome está amarrado na matriz', () => {
  const amarrados = M.codigosAmarrados(m);
  const fora = [...codigosDosTestes()].filter(([c]) => !amarrados.has(c)).map(([c, f]) => `${c} (${f})`);
  assert.deepStrictEqual(fora, [], `códigos de teste sem linha em docs/rastreabilidade.md: ${fora.join(', ')}`);
});

test('MATRIZ-05: o resumo em números gravado é o contado pelas linhas (rode `node scripts/matriz.js --resumo`)', () => {
  const gravado = M.resumoGravado(m.texto);
  assert.ok(gravado, 'faltam os marcadores do resumo na matriz');
  assert.strictEqual(gravado, M.tabelaResumo(m), 'resumo em números desatualizado: rode `node scripts/matriz.js --resumo`');
});

test('MATRIZ-06: leitura da matriz — faixas de código, arquivos do "Onde está" e testes da coluna Teste', () => {
  assert.deepStrictEqual(M.expandirCodigos('GRP-01…04'), ['GRP-01', 'GRP-02', 'GRP-03', 'GRP-04']);
  assert.deepStrictEqual(M.expandirCodigos('SUG-CARR-01/02'), ['SUG-CARR-01', 'SUG-CARR-02']);
  assert.deepStrictEqual(M.expandirCodigos('CLI-CEL / CONV-13'), ['CLI-CEL', 'CONV-13']);
  assert.ok(M.arquivosDe('`src/zapfila.js` `decidir`; `server.js`').includes('src/zapfila.js'));
  assert.ok(M.arquivosDe('`lotes.js` (`calcular`)').includes('src/lotes.js'));
  assert.deepStrictEqual(M.testesDe('`contas.test` META-01; `esc` "x"; `zap.spec`').sort(), ['tests/e2e/escala-horario.spec.js', 'tests/e2e/zap.spec.js', 'tests/unit/contas.test.js']);
  const afetadas = M.regrasDosArquivos(['src/zapfila.js'], m).map((l) => l.celula);
  assert.ok(afetadas.includes('ZAP-01') && afetadas.includes('ZAP-HORA-LOJA'), 'mexer no zapfila.js acha as regras do robô');
});
