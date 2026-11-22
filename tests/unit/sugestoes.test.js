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
  const nota = (nf, emissao, fornecedor, cods, entrada = emissao) => ({ nf, serie: '1', emissao, entrada, fornecedor, motivo: 'Compra para comercialização.', status: 'Concluída', itens: cods.map((cod) => ({ cod })) });
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
  assert.match(cl.hist.at(-1).motivo, /fora de estoque no fornecedor/);
  // a Hamsa: a entrega da franquia (com a janela fechada) veio sem ela
  const hoje = C.diaSP();
  const somar = (n) => new Date(Date.parse(hoje + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const notas = { notas: [{ nf: '19300', emissao: somar(1), fornecedor: 'TSB FRANQUIAS E COMERCIO LTDA ME', motivo: 'Compra', status: 'Concluída', itens: [{ cod: '71194' }] }] };
  assert.strictEqual(SUG.avaliarNotas('l2', notas, somar(3)).mudou, 0, 'janela aberta');
  assert.strictEqual(SUG.avaliarNotas('l2', notas, somar(7)).mudou, 1);
  const h = SUG.lista('l2', 'ana', false).find((s) => s.cod === '90001');
  assert.deepStrictEqual([h.st, !!h.aguardando, h.hist.at(-1).res], ['aberta', false, 'naoveio']);
  assert.match(h.hist.at(-1).motivo, /Não veio na entrega de .*NF 19300.*indisponível no fornecedor/);
});

test('tirar a estrela: só quem marcou (ou quem faz o pedido)', () => {
  const s = SUG.criar('l1', { cod: '71194', justificativa: 'presente de natal' }, 'ana', 'Ana', estoque).ok;
  assert.match(SUG.retirar('l1', s.id, 'bia', false).erro, /Só quem marcou/);
  assert.strictEqual(SUG.retirar('l1', s.id, 'ger', true).ok.st, 'retirada');
});

test('entrega: os 5 dias contam da ENTRADA na loja (não da emissão) e o produto que chega depois de "não veio" também tira a estrela', () => {
  const est = { itens: [{ cod: '95001', desc: 'Mug Super Jumbo Koi', un: 'Un', qtd: 0 }] };
  SUG.criar('l3', { cod: '95001' }, 'ana', 'Ana', est);
  SUG.fechar('l3', [{ cod: '95001', pedir: 2, site: 'ok' }], 'ger');
  const d = SUG.ler('l3'); d.itens[0].aguardando.em = '2026-11-20T15:00:00Z'; d.itens[0].hist[0].em = '2026-11-20T15:00:00Z';
  fs.writeFileSync(path.join(tmp, 'l3', 'sugestoes.json'), JSON.stringify(d));
  const N = (nf, emissao, entrada, cods) => ({ nf, serie: '1', emissao, entrada, fornecedor: 'TSB FRANQUIAS E COMERCIO LTDA ME', motivo: 'Compra', status: 'Concluída', itens: cods.map((cod) => ({ cod })) });
  // pedido sexta 20/11; 1ª nota emitida 25/11 entra só em 01/12, sem o produto; 2ª emitida 26/11 entra em 05/12 com ele
  const n1 = N('19400', '2026-11-25', '2026-12-01', ['71194']);
  assert.strictEqual(SUG.avaliarNotas('l3', { notas: [n1] }, '2026-12-04').mudou, 0, 'janela até 06/12 pela entrada: ainda espera');
  assert.strictEqual(SUG.avaliarNotas('l3', { notas: [n1, N('19401', '2026-11-26', '2026-12-05', ['95001'])] }, '2026-12-05').mudou, 1);
  let s = SUG.lista('l3', 'ana', false)[0];
  assert.deepStrictEqual([s.st, s.chegou], ['atendida', { nf: '19401/1', dia: '2026-12-05' }]);
  // outra loja: passa a janela sem o produto → não veio; depois chega numa nota de 15/12 → chegou
  SUG.criar('l4', { cod: '95001' }, 'ana', 'Ana', est);
  SUG.fechar('l4', [{ cod: '95001', pedir: 2, site: 'ok' }], 'ger');
  const d4 = SUG.ler('l4'); d4.itens[0].aguardando.em = '2026-11-20T15:00:00Z'; d4.itens[0].hist[0].em = '2026-11-20T15:00:00Z';
  fs.writeFileSync(path.join(tmp, 'l4', 'sugestoes.json'), JSON.stringify(d4));
  assert.strictEqual(SUG.avaliarNotas('l4', { notas: [n1] }, '2026-12-07').mudou, 1);
  s = SUG.lista('l4', 'ana', false)[0];
  assert.deepStrictEqual([s.st, !!s.aguardando, s.hist.at(-1).res], ['aberta', false, 'naoveio']);
  assert.strictEqual(SUG.avaliarNotas('l4', { notas: [n1, N('19500', '2026-12-12', '2026-12-15', ['95001'])] }, '2026-12-15').mudou, 1);
  s = SUG.lista('l4', 'ana', false)[0];
  assert.deepStrictEqual([s.st, s.chegou.nf, s.hist.map((x) => x.res)], ['atendida', '19500/1', ['pedido', 'naoveio', 'chegou']]);
});

test('revisão: obrigatório conta como pedido; registrar 2× no mesmo dia não duplica; 2ª estrela segue a 1ª; nota não concluída ou emitida no dia do pedido não vale; vendedora sem quantidade', () => {
  const est = { itens: [{ cod: 'A1', desc: 'Caneca A', un: 'Un', qtd: 0 }, { cod: 'B1', desc: 'Caneca B', un: 'Un', qtd: 0 }] };
  SUG.criar('l5', { cod: 'A1' }, 'ana', 'Ana', est);
  SUG.criar('l5', { cod: 'B1' }, 'ana', 'Ana', est);
  // A1: linha normal sem pedir + linha do obrigatório (vem por último) → pedido
  const r = SUG.fechar('l5', [{ cod: 'A1', pedir: 0, site: 'ok' }, { cod: 'A1', pedir: 6, site: 'obrig' }, { cod: 'B1', pedir: 0, site: 'ok' }], 'ger').ok;
  assert.deepStrictEqual(r, { pedido: 1, semsite: 0, nao: 1 });
  // registrar de novo no mesmo dia: B1 não ganha outro "não entrou"
  SUG.fechar('l5', [{ cod: 'B1', pedir: 0, site: 'ok' }], 'ger');
  assert.strictEqual(SUG.lista('l5', 'ana', false).find((s) => s.cod === 'B1').hist.length, 1);
  // 2ª estrela no A1 (já aguardando entrega) segue junto e não é decidida de novo
  const bia = SUG.criar('l5', { cod: 'A1' }, 'bia', 'Bia', est).ok;
  assert.ok(bia.aguardando);
  assert.match(SUG.decidir('l5', 'A1', { res: 'nao' }, 'ger').erro, /aguardando entrega/);
  // vendedora: sem quantidade pedida nem login de quem decidiu
  const v = SUG.lista('l5', 'ana', false).find((s) => s.cod === 'A1');
  assert.deepStrictEqual(Object.keys(v.aguardando), ['em']);
  assert.ok(v.hist.every((h) => h.por === undefined));
  // notas: emitida no mesmo dia do pedido (é do pedido anterior) e não concluída não valem
  const d = SUG.ler('l5'); for (const s of d.itens) if (s.aguardando) s.aguardando.em = '2026-11-20T23:00:00Z';
  fs.writeFileSync(path.join(tmp, 'l5', 'sugestoes.json'), JSON.stringify(d));
  const N = (nf, emissao, status) => ({ nf, emissao, entrada: emissao, status, fornecedor: 'TSB FRANQUIAS E COMERCIO LTDA ME', motivo: 'Compra', itens: [{ cod: 'A1' }] });
  assert.strictEqual(SUG.avaliarNotas('l5', { notas: [N('1', '2026-11-20', 'Concluída'), N('2', '2026-11-22', 'Digitação')] }, '2026-11-23').mudou, 0);
  assert.strictEqual(SUG.avaliarNotas('l5', { notas: [N('3', '2026-11-23', 'Concluída')] }, '2026-11-23').mudou, 2, 'as duas estrelas do A1 saem');
});

test('estoque agora: quem decide vê a quantidade; quem só sugere, só a situação', () => {
  const est = { itens: [{ cod: 'Q1', desc: 'Chá Q', un: 'Kg', qtd: 0.45 }] };
  const [a] = SUG.comEstoque([{ cod: 'Q1' }], est, true);
  assert.deepStrictEqual(a.agora, { situacao: 'pouco', un: 'Kg', qtd: 0.45 });
  const [b] = SUG.comEstoque([{ cod: 'Q1' }], est, false);
  assert.deepStrictEqual(b.agora, { situacao: 'pouco', un: 'Kg' });
  assert.strictEqual(SUG.comEstoque([{ cod: 'X' }], est, true)[0].agora, null);
});

test('SUG-CARR-01: carrinho refeito e excluído devolve a sugestão (a espera passa para o carrinho novo enquanto o pedido não foi confirmado)', async () => {
  const est = { itens: [{ cod: 'R1', desc: 'Chá R1', un: 'Kg', qtd: 0 }, { cod: 'R2', desc: 'Chá R2', un: 'Kg', qtd: 0 }] };
  SUG.criar('l7', { cod: 'R1' }, 'vend', 'Vend', est);
  SUG.criar('l7', { cod: 'R2' }, 'vend', 'Vend', est);
  // 1º carrinho: os dois vão para "aguardando entrega"
  SUG.fechar('l7', [{ cod: 'R1', pedir: 1, site: 'ok' }, { cod: 'R2', pedir: 1, site: 'ok' }], 'ger');
  const arq = path.join(tmp, 'l7', 'sugestoes.json');
  const d = SUG.ler('l7'); for (const s of d.itens) s.aguardando.em = '2026-11-20T10:00:00.000Z'; fs.writeFileSync(arq, JSON.stringify(d));
  // a pessoa desfaz e monta outro carrinho, só com o R1
  await new Promise((r) => setTimeout(r, 5));
  const inicio2 = new Date().toISOString();
  SUG.fechar('l7', [{ cod: 'R1', pedir: 2, site: 'ok' }, { cod: 'R2', pedir: 0, site: 'ok' }], 'ger');
  const a = SUG.ler('l7').itens;
  assert.ok(Date.parse(a.find((s) => s.cod === 'R1').aguardando.em) >= Date.parse(inicio2), 'a espera do R1 agora é do carrinho novo');
  assert.strictEqual(a.find((s) => s.cod === 'R1').aguardando.qtd, 2);
  assert.strictEqual(a.find((s) => s.cod === 'R2').aguardando.em, '2026-11-20T10:00:00.000Z', 'o que não entrou no carrinho novo não muda');
  // excluir o carrinho novo devolve o R1 (antes ficava "pedido em 20/11" para sempre)
  assert.deepStrictEqual(SUG.desfazerPedido('l7', inicio2, 'ger'), { ok: 1 });
  assert.strictEqual(SUG.ler('l7').itens.find((s) => s.cod === 'R1').aguardando, undefined);
  // o R2 ficou sem carrinho para excluir: "Não fiz este pedido" devolve o que não foi confirmado
  assert.deepStrictEqual(SUG.devolver('l7', null, 'ger'), { ok: 1 });
  const fim = SUG.ler('l7').itens.find((s) => s.cod === 'R2');
  assert.strictEqual(fim.aguardando, undefined);
  assert.match(fim.hist.slice(-1)[0].motivo, /não pedido/);
  assert.strictEqual(fim.st, 'aberta', 'continua esperando o próximo pedido');
});

test('SUG-CARR-02: pedido confirmado fica firme: outro carrinho não leva a espera e "Não fiz este pedido" (todos) não mexe; por produto, devolve', async () => {
  const est = { itens: [{ cod: 'F1', desc: 'Chá F1', un: 'Kg', qtd: 0 }] };
  SUG.criar('l8', { cod: 'F1' }, 'vend', 'Vend', est);
  const inicio = new Date().toISOString();
  SUG.fechar('l8', [{ cod: 'F1', pedir: 1, site: 'ok' }], 'ger');
  assert.strictEqual(SUG.ler('l8').itens[0].aguardando.conf, false);
  assert.deepStrictEqual(SUG.confirmarPedido('l8', inicio), { ok: 1 });
  const em1 = SUG.ler('l8').itens[0].aguardando.em;
  await new Promise((r) => setTimeout(r, 5));
  const inicio2 = new Date().toISOString();
  SUG.fechar('l8', [{ cod: 'F1', pedir: 3, site: 'ok' }], 'ger'); // segundo carrinho com o mesmo produto
  assert.strictEqual(SUG.ler('l8').itens[0].aguardando.em, em1, 'a espera continua sendo a do pedido confirmado');
  assert.deepStrictEqual(SUG.desfazerPedido('l8', inicio2, 'ger'), { ok: 0 }, 'excluir o 2º carrinho não desfaz o pedido confirmado');
  assert.deepStrictEqual(SUG.devolver('l8', null, 'ger'), { ok: 0 });
  assert.deepStrictEqual(SUG.devolver('l8', ['F1'], 'ger'), { ok: 1 }, 'por produto, a pessoa pode dizer que não pediu');
});
