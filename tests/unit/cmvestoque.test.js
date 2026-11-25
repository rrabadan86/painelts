'use strict';
/* CMV pelo estoque (decisão do dono, 25/11/2026; CMV-EST-01): foto do estoque a custo na virada do mês e a conta
   estoque inicial + compras − devoluções − estoque final (src/cmvestoque.js). */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmvest-'));
let CE;
before(() => { process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = path.join(tmp, 'lojas.json'); CE = require('../../src/cmvestoque'); });
after(() => fs.rmSync(tmp, { recursive: true, force: true })); // dados temporários do teste: apaga

const itens = (v) => [{ cod: '1', qtd: 2, custo: v / 2 }, { cod: '2', qtd: 0, custo: 50 }, { cod: '3', qtd: 4, custo: 0 }];

test('CMV-EST-01: guarda a primeira foto de cada dia só perto da virada do mês, com o valor a custo', () => {
  assert.strictEqual(CE.registrarFoto('l1', { em: '2026-10-15T09:00:00Z', itens: itens(100) }), null, 'meio do mês: não guarda');
  const f = CE.registrarFoto('l1', { em: '2026-11-01T09:00:00Z', itens: itens(1000) });
  assert.deepStrictEqual({ valor: f.valor, itens: f.itens, semCusto: f.semCusto }, { valor: 1000, itens: 2, semCusto: 1 });
  assert.strictEqual(CE.registrarFoto('l1', { em: '2026-11-01T15:00:00Z', itens: itens(5) }), null, 'a segunda do dia não troca a primeira');
  assert.strictEqual(CE.ler('l1')['2026-11-01'].valor, 1000);
});

test('CMV-EST-01: estoque final = foto do dia 1 do mês seguinte; sem ela, a mais próxima (aprox.); a conta do mês', () => {
  CE.registrarFoto('l1', { em: '2026-11-30T09:00:00Z', itens: itens(1200) }); // sem dia 1 de dezembro
  const fotos = CE.ler('l1');
  assert.deepStrictEqual(CE.fotoFim(fotos, '2026-10'), { dia: '2026-11-01', valor: 1000, aprox: false });
  assert.deepStrictEqual(CE.fotoFim(fotos, '2026-11'), { dia: '2026-11-30', valor: 1200, aprox: true });
  const notas = [
    { entrada: '2026-11-10', motivo: 'Compra', status: 'Concluída', itens: [{ qtd: 3, custo: 100 }, { qtd: 1, custo: 50 }] },
    { entrada: '2026-11-12', motivo: 'Bonificação', status: 'Concluída', itens: [{ qtd: 9, custo: 10 }] },
    { entrada: '2026-11-15', motivo: 'Compra', status: 'Pendente', itens: [{ qtd: 9, custo: 10 }] },
  ];
  const saidas = [{ data: '2026-11-20', finalidade: 'Devolução', valor: 80, situacao: 'autorizada' }, { data: '2026-11-21', finalidade: 'Devolução', valor: 999, situacao: 'cancelada' }];
  const r = CE.resumo('l1', { notas, saidas });
  assert.deepStrictEqual(r['2026-11'], { ini: { dia: '2026-11-01', valor: 1000, aprox: false }, fim: { dia: '2026-11-30', valor: 1200, aprox: true }, compras: 350, devolucoes: 80 });
  assert.strictEqual(r['2026-10'], undefined, 'outubro sem a foto do começo: fica de fora');
});
