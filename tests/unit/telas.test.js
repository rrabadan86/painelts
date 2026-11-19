// Lista única das telas (src/telas.js): tudo o que o painel mostra precisa estar nela, com a regra de cada perfil.
// Se este teste falhar porque surgiu uma tela nova, inclua-a em src/telas.js (grupo do menu + regra por perfil)
// e, se for para o gerente escolher, o servidor precisa conferir com podeTela(req, '<id>').
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const T = require('../../src/telas');
const C = require('../../src/config');

const PUB = path.join(__dirname, '../../public/js');
const js = fs.readdirSync(PUB).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(PUB, f), 'utf8')).join('\n');
const coberta = new Set(Object.values(T.PAGINAS).flat());

test('toda página do painel (TS.pages.x) está na lista de telas de Configurações → Usuários', () => {
  const paginas = [...new Set([...js.matchAll(/TS\.pages\.([a-zA-Z_]+)\s*=/g)].map((m) => m[1]))];
  assert.ok(paginas.length > 20, 'achou as páginas');
  const fora = paginas.filter((p) => !coberta.has(p));
  assert.deepStrictEqual(fora, [], `Tela nova fora da lista: ${fora.join(', ')} — inclua em src/telas.js`);
});

test('todo rótulo do menu (main.js → ROTULO) está na lista de telas', () => {
  const main = fs.readFileSync(path.join(PUB, 'main.js'), 'utf8');
  const bloco = /const ROTULO = \{([\s\S]*?)\};/.exec(main)[1];
  const chaves = [...bloco.matchAll(/([a-z]+):\s*'/g)].map((m) => m[1]);
  const fora = chaves.filter((k) => !coberta.has(k));
  assert.deepStrictEqual(fora, [], `Item de menu fora da lista: ${fora.join(', ')}`);
});

test('regras: cada tela tem regra para os 4 perfis; admin e franqueado sempre; padrão do gerente só entre as que ele escolhe', () => {
  for (const t of T.TODAS) {
    for (const p of C.PERFIS) assert.ok(['sempre', 'nunca', 'escolha'].includes(t[p]), `${t.id}: regra de ${p}`);
    assert.strictEqual(t.admin, 'sempre'); assert.strictEqual(t.franqueado, 'sempre');
    assert.notStrictEqual(t.vendedor, 'escolha', `${t.id}: a vendedora não tem telas para escolher`);
    if (t.gerente !== 'escolha') assert.ok(!t.padrao, `${t.id}: padrão só vale para "escolha"`);
  }
  assert.deepStrictEqual(C.TELAS, T.ESCOLHA_GERENTE);
  assert.ok(C.TELAS_GERENTE_PADRAO.every((x) => C.TELAS.includes(x)));
});

test('regras fixas do dono: vendedora nunca vê custo nem Clientes; Orçamento e Configurações só admin/franqueado; ⭐ Sugestões e Lista de espera sempre para a vendedora', () => {
  for (const t of T.TODAS.filter((x) => x.custo)) assert.strictEqual(t.vendedor, 'nunca', t.id);
  assert.strictEqual(T.regra('clientes', 'vendedor'), 'nunca');
  for (const id of ['orcamento', 'config']) { assert.strictEqual(T.regra(id, 'gerente'), 'nunca'); assert.strictEqual(T.regra(id, 'vendedor'), 'nunca'); }
  for (const id of ['sugestoes', 'espera', 'inventario', 'validade', 'minha', 'checklist']) assert.strictEqual(T.regra(id, 'vendedor'), 'sempre', id);
  assert.strictEqual(T.regra('clientes', 'gerente'), 'escolha');
  assert.ok(!C.TELAS_GERENTE_PADRAO.includes('clientes'), 'Clientes não vem marcado para o gerente');
  assert.ok(C.TELAS_GERENTE_PADRAO.includes('sugestoes') && C.TELAS_GERENTE_PADRAO.includes('espera'));
  for (const t of T.TODAS.filter((x) => x.custo)) assert.ok(!C.TELAS_GERENTE_PADRAO.includes(t.id), `${t.id} (custo) não vem marcada para o gerente`);
});
