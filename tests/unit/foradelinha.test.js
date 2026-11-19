// Fora de linha: desde quando cada produto está indisponível no Sistema de Pedidos (para o Estoque mostrar "liquidar")
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fdl-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1' }], usuarios: {} }));
const PED = require('../../src/pedido');

test('fora de linha: guarda o primeiro dia indisponível, apaga quando volta, conta quem saiu do catálogo e ignora o que nunca foi da franquia', () => {
  const cat1 = { em: '2026-08-01T03:00:00Z', itens: [{ cod: 'A', disp: true }, { cod: 'B', disp: false }, { cod: 'C', disp: true }] };
  let d = PED.atualizarDisp('l1', cat1);
  assert.deepStrictEqual(d.indisp, { B: '2026-08-01' });
  assert.strictEqual(d.desde, '2026-08-01');
  // mesmo catálogo de novo: nada muda
  assert.deepStrictEqual(PED.atualizarDisp('l1', cat1).indisp, { B: '2026-08-01' });
  // dias depois: B continua (mantém a primeira data), A fica indisponível, C saiu do catálogo
  d = PED.atualizarDisp('l1', { em: '2026-08-10T03:00:00Z', itens: [{ cod: 'A', disp: false }, { cod: 'B', disp: false }] });
  assert.deepStrictEqual(d.indisp, { A: '2026-08-10', B: '2026-08-01', C: '2026-08-10' });
  // A volta (sexta à noite, por exemplo): sai da lista
  d = PED.atualizarDisp('l1', { em: '2026-08-15T03:00:00Z', itens: [{ cod: 'A', disp: true }, { cod: 'B', disp: false }] });
  assert.deepStrictEqual(d.indisp, { B: '2026-08-01', C: '2026-08-10' });
  // produto que nunca apareceu no catálogo (ex.: matéria-prima comprada fora) não entra
  assert.ok(!('Z' in d.indisp));
  const f = PED.foraDeLinha('l1');
  assert.strictEqual(f.dias, 90);
  assert.strictEqual(f.indisp.B, '2026-08-01');
});
