// ⭐ Sugestões da equipe para o pedido: justificar quando tem na loja, decidir no pedido, histórico e retorno
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sug-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1' }], usuarios: {} }));
const SUG = require('../../src/sugestoes');
const C = require('../../src/config');

const estoque = { itens: [
  { cod: '31020', desc: 'Valeriana Garden', un: 'Kg', qtd: 0.5, custo: 180 },
  { cod: '31030', desc: 'Rooibos Paradise', un: 'Kg', qtd: 1.2, custo: 150 },
  { cod: '71194', desc: 'Lata Ginko 100G', un: 'Un', qtd: 4, custo: 22.5 },
  { cod: '80001', desc: 'Caneca Tea', un: 'Un', qtd: 0, custo: 30 },
] };

test('situação: chá abaixo de 700 g é "pouco" e não pede justificativa; com estoque pede; a busca não devolve quantidade nem custo', () => {
  assert.strictEqual(SUG.situacao(estoque.itens[0]), 'pouco');
  assert.strictEqual(SUG.situacao(estoque.itens[1]), 'tem');
  assert.strictEqual(SUG.situacao(estoque.itens[3]), 'acabou');
  const b = SUG.buscar(estoque, 'rooibos');
  assert.deepStrictEqual(b, [{ cod: '31030', desc: 'Rooibos Paradise', un: 'Kg', situacao: 'tem', justificar: true }]);
  assert.ok(!('qtd' in b[0]) && !('custo' in b[0]));
});

test('criar: justificativa obrigatória quando tem na loja; não repete a mesma pessoa no mesmo produto', () => {
  assert.match(SUG.criar('l1', { cod: '31030' }, 'ana', 'Ana', estoque).erro, /ainda tem na loja/);
  assert.ok(SUG.criar('l1', { cod: '31030', justificativa: 'cliente leva 1 kg por mês' }, 'ana', 'Ana', estoque).ok);
  assert.ok(SUG.criar('l1', { cod: '31020' }, 'ana', 'Ana', estoque).ok, 'chá com menos de 700 g não justifica');
  assert.match(SUG.criar('l1', { cod: '31020' }, 'ana', 'Ana', estoque).erro, /já marcou/);
  assert.ok(SUG.criar('l1', { cod: '31020', recado: 'pedem muito' }, 'bia', 'Bia', estoque).ok);
  assert.ok(SUG.criar('l1', { cod: '80001' }, 'bia', 'Bia', estoque).ok);
  assert.match(SUG.criar('l1', { cod: '99999' }, 'bia', 'Bia', estoque).erro, /não encontrado/);
  const g = SUG.paraPedido('l1');
  assert.deepStrictEqual(g.find((x) => x.cod === '31020').pessoas, ['Ana', 'Bia']);
});

test('pedido: no pedido fica "aguardando entrega"; sem estoque no site é automático; "não agora" guarda o motivo; tudo continua marcado', () => {
  assert.ok(SUG.decidir('l1', '31030', { res: 'nao', motivo: 'Vende pouco' }, 'ger').ok);
  const r = SUG.fechar('l1', [{ cod: '31020', pedir: 1, site: 'ok' }, { cod: '80001', pedir: 0, site: 'indisp' }, { cod: '31030', pedir: 0, site: 'ok' }], 'ger').ok;
  assert.deepStrictEqual(r, { pedido: 2, semsite: 1, nao: 1 });
  const ana = SUG.lista('l1', 'ana', false);
  assert.ok(ana.every((s) => s.por === undefined), 'a vendedora não recebe o login de ninguém');
  const roo = ana.find((s) => s.cod === '31030');
  assert.deepStrictEqual([roo.st, roo.hist[0].res, roo.hist[0].motivo, roo.novo], ['aberta', 'nao', 'Vende pouco', true]);
  const val = ana.find((s) => s.cod === '31020');
  assert.deepStrictEqual([val.st, !!val.aguardando, val.hist[0].res], ['aberta', true, 'pedido'], 'no pedido: a estrela continua até a nota chegar');
  const cx = SUG.lista('l1', 'bia', false).find((s) => s.cod === '80001');
  assert.deepStrictEqual([cx.st, cx.hist[0].res], ['aberta', 'semsite']);
  // registrar de novo não mexe no que já foi pedido
  SUG.fechar('l1', [], 'ger');
  assert.strictEqual(SUG.lista('l1', 'ana', false).find((s) => s.cod === '31020').hist.length, 1);
  assert.ok(SUG.paraPedido('l1').find((g) => g.cod === '31020').aguardando);
  SUG.visto('l1', 'ana');
  assert.ok(SUG.lista('l1', 'ana', false).every((s) => !s.novo));
});

test('entrega: só nota da TSB Franquias emitida a partir do pedido; janela de 5 dias depois da primeira; chegou tira a estrela, não veio volta', () => {
  const d = SUG.ler('l1');
  const dia = (s) => s.aguardando && s.aguardando.em.slice(0, 10);
  // fixa o dia do pedido em 2026-11-21 (meio-dia em Brasília) para as duas pedidas (valeriana de ana e de bia)
  for (const s of d.itens) if (s.aguardando) s.aguardando.em = '2026-11-21T15:00:00Z';
  fs.writeFileSync(path.join(tmp, 'l1', 'sugestoes.json'), JSON.stringify(d));
  const nota = (nf, emissao, fornecedor, cods) => ({ nf, serie: '1', emissao, fornecedor, motivo: 'Compra para comercialização.', itens: cods.map((cod) => ({ cod })) });
  const notas = { notas: [
    nota('19000', '2026-11-18', 'TSB FRANQUIAS E COMERCIO LTDA ME', ['31020']), // antes do pedido: não vale
    nota('555', '2026-11-24', 'GRAFICA QUALQUER LTDA', ['31020']), // outro fornecedor: não vale
    nota('19218', '2026-11-25', 'TSB FRANQUIAS E COMERCIO LTDA ME', ['71194']), // primeira da franquia: sem a valeriana
  ] };
  // dentro da janela (até 30/11): ainda espera
  assert.strictEqual(SUG.avaliarNotas('l1', notas, '2026-11-27').mudou, 0);
  assert.ok(SUG.lista('l1', 'ana', false).find((s) => s.cod === '31020').aguardando);
  // segunda nota da franquia na janela traz a valeriana: chegou, a estrela sai
  const comSegunda = { notas: [...notas.notas, nota('19219', '2026-11-28', 'TSB FRANQUIAS E COMERCIO LTDA ME', ['31020'])] };
  assert.strictEqual(SUG.avaliarNotas('l1', comSegunda, '2026-11-28').mudou, 2);
  const v = SUG.lista('l1', 'ana', false).find((s) => s.cod === '31020');
  assert.deepStrictEqual([v.st, v.chegou.nf, v.hist.at(-1).res], ['atendida', '19219/1', 'chegou']);
});

test('entrega: fechou a janela sem o produto → "não veio no pedido" e volta; carrinho recusado volta na hora', () => {
  const estoque2 = { itens: [{ cod: '90001', desc: 'Mug Harmony Hamsa', un: 'Un', qtd: 0 }, { cod: '90002', desc: 'Mug Classic Oasis', un: 'Un', qtd: 0 }] };
  SUG.criar('l2', { cod: '90001' }, 'ana', 'Ana', estoque2);
  SUG.criar('l2', { cod: '90002' }, 'ana', 'Ana', estoque2);
  SUG.fechar('l2', [{ cod: '90001', pedir: 6, site: 'ok' }, { cod: '90002', pedir: 6, site: 'ok' }], 'ger');
  const d = SUG.ler('l2'); for (const s of d.itens) s.aguardando.em = new Date(Date.now() - 10 * 864e5).toISOString();
  fs.writeFileSync(path.join(tmp, 'l2', 'sugestoes.json'), JSON.stringify(d));
  // o favorito: o site recusou a Classic
  assert.strictEqual(SUG.resultadoCarrinho('l2', [{ cod: '90002', status: 'sem_estoque' }, { cod: '90001', status: 'ok' }]).ok, 0, 'pedido de mais de 3 dias atrás: o resultado do carrinho não vale');
  const d2 = SUG.ler('l2'); for (const s of d2.itens) s.aguardando.em = new Date().toISOString();
  fs.writeFileSync(path.join(tmp, 'l2', 'sugestoes.json'), JSON.stringify(d2));
  assert.strictEqual(SUG.resultadoCarrinho('l2', [{ cod: '90002', status: 'sem_estoque' }, { cod: '90001', status: 'ok' }]).ok, 1);
  const cl = SUG.lista('l2', 'ana', false).find((s) => s.cod === '90002');
  assert.deepStrictEqual([cl.st, !!cl.aguardando, cl.hist.at(-1).res], ['aberta', false, 'naopediu']);
  assert.match(cl.hist.at(-1).motivo, /sem estoque no fornecedor/);
  // a Hamsa: a entrega da franquia (com a janela fechada) veio sem ela
  const hoje = C.diaSP();
  const somar = (n) => new Date(Date.parse(hoje + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const notas = { notas: [{ nf: '19300', emissao: somar(1), fornecedor: 'TSB FRANQUIAS E COMERCIO LTDA ME', motivo: 'Compra', itens: [{ cod: '71194' }] }] };
  assert.strictEqual(SUG.avaliarNotas('l2', notas, somar(3)).mudou, 0, 'janela aberta');
  assert.strictEqual(SUG.avaliarNotas('l2', notas, somar(7)).mudou, 1);
  const h = SUG.lista('l2', 'ana', false).find((s) => s.cod === '90001');
  assert.deepStrictEqual([h.st, !!h.aguardando, h.hist.at(-1).res], ['aberta', false, 'naoveio']);
  assert.match(h.hist.at(-1).motivo, /Não veio na NF 19300 .*indisponível no fornecedor/);
});

test('tirar a estrela: só quem marcou (ou quem faz o pedido)', () => {
  const s = SUG.criar('l1', { cod: '71194', justificativa: 'presente de natal' }, 'ana', 'Ana', estoque).ok;
  assert.match(SUG.retirar('l1', s.id, 'bia', false).erro, /Só quem marcou/);
  assert.strictEqual(SUG.retirar('l1', s.id, 'ger', true).ok.st, 'retirada');
});
