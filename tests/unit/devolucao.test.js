'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-'));
process.env.DATA_DIR = tmp;
const DEV = require('../../src/devolucao');

// JPEG mínimo válido o bastante para o teste (começa com FF D8 e tem mais de 1 KB)
const jpg = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000, 1)]).toString('base64');
const nota = { id: 'n1', nf: 18574, serie: 1, emissao: '2026-08-29', entrada: '2026-08-31', fornecedor: 'TSB', total: 100, itens: [{ cod: '406', nome: 'Top Tea', un: 'UN', qtd: 10, vu: 12.5 }, { cod: '11106CX', nome: 'Pu Erh', un: 'UN', qtd: 6, vu: 30 }] };

test('devolução: valida itens, fotos e destinatários', async () => {
  assert.match(DEV.criar('lj', nota, { itens: [{ cod: '406', tipo: 'danificado', qtd: 2, fotos: [] }] }, 'g').erro, /foto/);
  assert.match(DEV.criar('lj', nota, { itens: [{ cod: '406', tipo: 'faltou', qtd: 11 }] }, 'g').erro, /Quantidade/);
  assert.match(DEV.criar('lj', nota, { itens: [{ cod: '999', tipo: 'faltou', qtd: 1 }] }, 'g').erro, /não está/);
  assert.match(DEV.criar('lj', nota, { itens: [{ cod: '406', tipo: 'danificado', qtd: 1, fotos: ['data:image/png;base64,AAAA'] }] }, 'g').erro, /foto/);
  const d = DEV.criar('lj', nota, { itens: [{ cod: '406', tipo: 'danificado', qtd: 2, obs: 'vencida', fotos: [jpg, jpg] }, { cod: '11106CX', tipo: 'faltou', qtd: 1 }] }, 'g').ok;
  assert.equal(d.itens[0].fotos, 2);
  assert.equal(d.total, 55);
  assert.ok(fs.existsSync(DEV.arqFoto('lj', d.id, 0, 1)));
  assert.equal(DEV.arqFoto('lj', '../x', 0, 0), null);
  assert.equal(DEV.lista('lj').length, 1);
  assert.match(DEV.salvarDestinatarios('lj', ['ok@x.com', 'ruim']).erro, /inválido/);
  assert.deepEqual(DEV.salvarDestinatarios('lj', ['A@X.com', 'a@x.com']).ok, ['a@x.com']);
  assert.match(DEV.textoEmail(d, 'Loja'), /não chegaram/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
