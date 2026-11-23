'use strict';
// Tipo do produto (granel, envasado, alimento) e o ponto único da unidade: o estoque como o painel usa (UN-ENV-01).
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tipoprod-'));
process.env.DATA_DIR = tmp;
const C = require('../../src/config');
const ES = require('../../src/estoque');
const TP = require('../../src/tipoprod');
after(() => fs.rmSync(tmp, { recursive: true, force: true })); // dados temporários do teste: apaga

test('tipo: grupo do AppNext decide; sem grupo, o nome decide só no item em kg', () => {
  assert.equal(TP.tipo({ un: 'Kg', desc: 'VALERIANA GARDEN' }), 'granel');
  assert.equal(TP.tipo({ un: 'Kg', desc: 'Matcha 30G Pacote' }), 'envasado');
  assert.equal(TP.tipo({ un: 'Kg', desc: 'Earl Grey Lata' }), 'envasado');
  assert.equal(TP.tipo({ un: 'Un', desc: 'Matcha', grupo: 'CHÁS ENVASADOS' }), 'envasado');
  assert.equal(TP.tipo({ un: 'Un', desc: 'Geleia', grupo: 'ALIMENTAÇÃO' }), 'alimento');
  assert.equal(TP.tipo({ un: 'Un', desc: 'Lata vazia 100g' }), null, 'unidade sem grupo: sem lote');
  assert.equal(TP.tipo({ un: 'Un', desc: 'Caneca', grupo: 'ACESSÓRIOS' }), null);
});

test('UN-ENV-01: ES.atual devolve o envasado do AppNext em "Kg" como unidade (grupo da nota de entrada); a planilha gravada não muda', () => {
  const dir = path.join(C.pastaLoja('tp1'), 'estoque');
  fs.mkdirSync(dir, { recursive: true });
  const cru = { em: '2026-11-18T10:00:00Z', itens: [{ cod: '10', desc: 'MATCHA PREMIUM', un: 'Kg', qtd: 9, custo: 40 }, { cod: '11', desc: 'CAMOMILA', un: 'Kg', qtd: 1.2, custo: 90 }] };
  fs.writeFileSync(path.join(dir, 'atual.json'), JSON.stringify(cru));
  // sem o grupo, o nome não diz que é envasado: continua kg
  assert.equal(ES.atual('tp1').itens[0].un, 'Kg');
  fs.writeFileSync(path.join(dir, 'compras.json'), JSON.stringify({ notas: [{ id: 'a', nf: 1, entrada: '2026-11-01', status: 'Concluída', motivo: 'Compra', itens: [{ cod: '10', nome: 'MATCHA PREMIUM', un: 'KG', qtd: 6, custo: 40, grupo: 'CHÁS ENVASADOS' }] }] }));
  const a = ES.atual('tp1');
  assert.deepEqual(a.itens.map((i) => [i.cod, i.un, i.qtd, i.tipoProd, i.unAppNext]), [['10', 'Un', 9, 'envasado', 'Kg'], ['11', 'Kg', 1.2, 'granel', undefined]]);
  assert.strictEqual(ES.atual('tp1').itens, ES.atual('tp1').itens, 'a mesma lista enquanto nada muda (os caches de quem usa continuam valendo)');
  assert.equal(ES.atualCru('tp1').itens[0].un, 'Kg', 'o arquivo do AppNext continua como veio');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'atual.json'), 'utf8')).itens[0].un, 'Kg');
  // inventário: a planilha devolve a unidade do AppNext
  const INV = require('../../src/inventario');
  const cat = INV.catalogo(a, null, null);
  assert.deepEqual([cat[0].un, cat[0].unAppNext], ['Un', 'Kg']);
});
