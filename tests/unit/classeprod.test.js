'use strict';
// Classe dos produtos (Estrela, Volume, Joia, Peso morto): mediana + margens mínima e alvo da loja
const { test } = require('node:test');
const assert = require('node:assert');
const CP = require('../../public/js/classeprod');

const cl = (xs, o) => Object.fromEntries([...CP.classificar(xs, o)].map(([k, v]) => [k, v.auto]));

test('CLS-01 só a mediana (sem margens da loja): a conta antiga — um quarto vira Peso morto por construção', () => {
  // loja boa: todos com margem sem fixos acima de 40%
  const xs = [
    { cod: 'A', giro: 10, margem: 0.70, margemSf: 0.48 }, { cod: 'B', giro: 9, margem: 0.62, margemSf: 0.41 },
    { cod: 'C', giro: 2, margem: 0.72, margemSf: 0.50 }, { cod: 'D', giro: 1, margem: 0.63, margemSf: 0.42 },
  ];
  assert.deepStrictEqual(cl(xs), { A: 'estrela', B: 'volume', C: 'joia', D: 'peso' });
});

test('CLS-02 Peso morto só com giro baixo E margem sem fixos abaixo do alvo: D (42% ≥ alvo 30%) vira Joia', () => {
  const xs = [
    { cod: 'A', giro: 10, margem: 0.70, margemSf: 0.48 }, { cod: 'B', giro: 9, margem: 0.62, margemSf: 0.41 },
    { cod: 'C', giro: 2, margem: 0.72, margemSf: 0.50 }, { cod: 'D', giro: 1, margem: 0.63, margemSf: 0.42 },
  ];
  const r = CP.classificar(xs, { min: 0.15, alvo: 0.30 });
  assert.deepStrictEqual(cl(xs, { min: 0.15, alvo: 0.30 }), { A: 'estrela', B: 'volume', C: 'joia', D: 'joia' });
  assert.strictEqual(r.get('D').porque, 'alvo');
  assert.strictEqual(r.get('C').porque, null);
  // com o alvo em 45%, D (42%) fica abaixo: continua Peso morto
  assert.strictEqual(cl(xs, { min: 0.15, alvo: 0.45 }).D, 'peso');
  // exatamente no alvo conta como alvo atingido
  assert.strictEqual(cl(xs, { min: 0.15, alvo: 0.42 }).D, 'joia');
});

test('CLS-03 margem boa = acima da mediana E da mínima da loja: loja ruim não tem Estrela só por ser "a melhor da turma"', () => {
  // todos com margem sem fixos baixa: A é a melhor (12%), mas abaixo da mínima de 15%
  const xs = [
    { cod: 'A', giro: 10, margem: 0.40, margemSf: 0.12 }, { cod: 'B', giro: 9, margem: 0.30, margemSf: 0.03 },
    { cod: 'C', giro: 2, margem: 0.41, margemSf: 0.13 }, { cod: 'D', giro: 1, margem: 0.28, margemSf: 0.01 },
  ];
  assert.deepStrictEqual(cl(xs), { A: 'estrela', B: 'volume', C: 'joia', D: 'peso' }); // antes
  const r = CP.classificar(xs, { min: 0.15, alvo: 0.30 });
  assert.deepStrictEqual(cl(xs, { min: 0.15, alvo: 0.30 }), { A: 'volume', B: 'volume', C: 'peso', D: 'peso' }); // agora
  assert.strictEqual(r.get('A').porque, 'min'); assert.strictEqual(r.get('C').porque, 'min');
  assert.strictEqual(r.get('A').acimaMediana, true); assert.strictEqual(r.get('A').acimaMin, false);
  // exatamente na mínima vale
  assert.strictEqual(cl(xs, { min: 0.12, alvo: 0.30 }).A, 'estrela');
});

test('CLS-04 bordas: sem margem sem fixos usa a bruta; giro zero nunca é "vende muito"; lista vazia; mediana', () => {
  const xs = [{ cod: 'A', giro: 0, margem: 0.5, margemSf: null }, { cod: 'B', giro: 0, margem: 0.2 }];
  const r = CP.classificar(xs, { min: 0.15, alvo: 0.30 });
  assert.strictEqual(r.get('A').auto, 'joia'); assert.strictEqual(r.get('A').margemSf, null);
  assert.strictEqual(r.get('B').auto, 'peso'); // bruta de 20% < alvo de 30%
  assert.strictEqual(CP.classificar([], { min: 0.15, alvo: 0.3 }).size, 0);
  assert.strictEqual(CP.mediana([3, 1, 2]), 2); assert.strictEqual(CP.mediana([4, 1, 2, 3]), 2.5); assert.strictEqual(CP.mediana([]), 0);
  // giro alto com margem abaixo da mediana, mas acima do alvo: continua Volume (o alvo só salva quem vende pouco)
  const ys = [{ cod: 'A', giro: 10, margem: 0.6, margemSf: 0.4 }, { cod: 'B', giro: 9, margem: 0.7, margemSf: 0.5 }, { cod: 'C', giro: 1, margem: 0.65, margemSf: 0.45 }];
  assert.strictEqual(cl(ys, { min: 0.15, alvo: 0.30 }).A, 'volume');
});
