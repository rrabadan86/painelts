// SINTAXE-01: todo arquivo da tela (public/js) compila. Um erro de sintaxe num deles quebra o pacote inteiro da tela
// (todas as páginas ficam em "Carregando…"), e os testes de unidade não carregam a maioria desses arquivos.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('SINTAXE-01: todos os arquivos de public/js compilam (só compila, não executa)', () => {
  const pasta = path.join(__dirname, '../../public/js');
  const arqs = fs.readdirSync(pasta).filter((f) => f.endsWith('.js'));
  assert.ok(arqs.length > 20);
  for (const f of arqs) {
    const src = fs.readFileSync(path.join(pasta, f), 'utf8');
    assert.doesNotThrow(() => new vm.Script(src, { filename: f }), `${f} tem erro de sintaxe`);
  }
});
