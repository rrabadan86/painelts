'use strict';
// Venda por hora trabalhada e ficha da equipe (public/js/equipe.js): as contas e o que a vendedora NÃO recebe
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const E = require('../../public/js/equipe.js');

const turno = (nome, day, ini, fim, pausa) => ({ nome, day, wd: day % 7, ini, fim, pausa: pausa || null });
const cupom = (vend, day, min, vt) => ({ vend, day, wd: day % 7, min, vt });

test('nomes: liga a pessoa da escala ao vendedor pelo nome igual ou pelo primeiro nome, só sem dúvida', () => {
  const m = E.casarNomes(['Lívia', 'Gabi', 'ANA PAULA', 'Bia'], ['LIVIA SOUZA', 'ANA PAULA', 'ANA PAULA REIS', 'BIANCA', 'GABI LIMA', 'GABI ROCHA']);
  assert.strictEqual(m.get('Lívia'), 'LIVIA SOUZA');   // sem acento, primeiro nome
  assert.strictEqual(m.get('ANA PAULA'), 'ANA PAULA'); // igual vale mais que "começa com"
  assert.strictEqual(m.has('Gabi'), false);            // duas Gabi nas vendas: não adivinha
  assert.strictEqual(m.has('Bia'), false);             // "BIA" não é uma palavra inteira de "BIANCA"
  // duas pessoas da escala que serviriam para o mesmo vendedor: nenhuma é ligada
  assert.strictEqual(E.casarNomes(['Ana', 'Ana Paula'], ['ANA PAULA REIS']).size, 0);
  assert.strictEqual(E.casarNomes([], ['X']).size, 0);
  assert.strictEqual(E.casarNomes(['Pessoa 1'], ['MARIA']).size, 0);
});

test('horas líquidas: o intervalo sai, e só a parte do turno dentro da faixa conta', () => {
  const t = turno('A', 7, 600, 1140, [780, 840]); // 10h–19h com intervalo 13h–14h
  assert.strictEqual(E.liquido(t), 480);
  assert.strictEqual(E.minutosNaFaixa(t, 600, 660), 60);
  assert.strictEqual(E.minutosNaFaixa(t, 780, 840), 0);    // hora do intervalo
  assert.strictEqual(E.minutosNaFaixa(t, 1080, 1200), 60); // sai às 19h
  assert.strictEqual(E.minutosNaFaixa(t, 0, 600), 0);
  assert.strictEqual(E.minutosNaFaixa(turno('A', 7, 600, 900, [870, 885]), 840, 900), 45); // intervalo de 15 min
});

test('venda por hora: vendas ÷ horas escaladas, por pessoa, por horário e por dia', () => {
  const turnos = [turno('ANA', 7, 600, 1080, [780, 840]), turno('ANA', 8, 600, 840), turno('BIA', 7, 840, 1080)];
  const cupons = [cupom('ANA', 7, 610, 100), cupom('ANA', 7, 900, 200), cupom('ANA', 8, 700, 60), cupom('BIA', 7, 905, 80), cupom('BIA', 9, 700, 40), cupom('CAIO', 7, 620, 500), cupom('ANA', 8, null, 40)];
  const r = E.rendimento(turnos, cupons);
  const ana = r.porPessoa.find((p) => p.nome === 'ANA'), bia = r.porPessoa.find((p) => p.nome === 'BIA'), caio = r.porPessoa.find((p) => p.nome === 'CAIO');
  assert.strictEqual(ana.horas, 11);            // 7h líquidas + 4h
  assert.strictEqual(ana.vt, 400);
  assert.ok(Math.abs(ana.rph - 400 / 11) < 1e-9);
  assert.ok(Math.abs(ana.cph - 4 / 11) < 1e-9);
  assert.strictEqual(ana.pctFora, 0);
  assert.strictEqual(bia.horas, 4);
  assert.strictEqual(bia.rph, 30);              // vendeu 120 em 4h escaladas
  assert.ok(Math.abs(bia.pctFora - 40 / 120) < 1e-9); // R$ 40 num dia sem turno
  assert.strictEqual(caio.naEscala, false);     // vendeu, mas não está na escala: sem hora, sem R$/hora
  assert.strictEqual(caio.rph, null);
  assert.strictEqual(caio.pctFora, null);
  // loja: só quem está na escala
  assert.strictEqual(r.total.vt, 520);
  assert.strictEqual(r.total.horas, 15);
  // por horário: 15h tem ANA + BIA escaladas (2h de pessoa) e R$ 280
  const h15 = r.porHora.find((x) => x.hora === 15);
  assert.strictEqual(h15.horas, 2);
  assert.strictEqual(h15.rph, 140);
  assert.strictEqual(r.porHora.find((x) => x.hora === 13).horas, 1); // ANA no intervalo no dia 7; no dia 8 trabalhou
  assert.strictEqual(r.porHora.some((x) => x.hora === 9), false);
  assert.strictEqual(r.semHora, 1);             // o cupom sem hora fica fora da visão por horário…
  assert.strictEqual(r.porDia[8 % 7].vt, 100);  // …mas entra no dia da semana
});

test('venda por hora: sem escala no período não inventa número', () => {
  const r = E.rendimento([], [cupom('ANA', 7, 610, 100)]);
  assert.strictEqual(r.total.rph, null);
  assert.strictEqual(r.total.cph, null);
  assert.strictEqual(r.porPessoa[0].rph, null);
  assert.deepStrictEqual(r.porHora, []);
  assert.ok(r.porDia.every((d) => d.rph === null));
  // pessoa na escala só de férias/folga (nenhum minuto): também "—"
  const f = E.rendimento([turno('ANA', 7, 600, 600)], [cupom('ANA', 7, 610, 100)]);
  assert.strictEqual(f.porPessoa[0].naEscala, true);
  assert.strictEqual(f.porPessoa[0].rph, null);
  assert.strictEqual(E.rendimento(null, null).total.vt, 0);
});

test('ficha: ticket, itens por atendimento, CPF, desconto e lucro (só com custo)', () => {
  const i = E.indicadores({ vt: 900, qtd: 30, desc: 100, cupons: 10, comCpf: 4, custo: 300, vtCusto: 800 });
  assert.strictEqual(i.ticket, 90);
  assert.strictEqual(i.ipa, 3);
  assert.strictEqual(i.pctCpf, 0.4);
  assert.strictEqual(i.descPct, 0.1);          // 100 de desconto sobre 1.000 de preço cheio
  assert.strictEqual(i.lucro, 500);            // só nos itens com custo
  assert.ok(Math.abs(i.parteCusto - 800 / 900) < 1e-9);
  // sem acesso a clientes e a custo: fica sem número (a tela mostra "—")
  const s = E.indicadores({ vt: 900, qtd: 30, desc: 0, cupons: 10, comCpf: null, custo: null, vtCusto: null });
  assert.strictEqual(s.pctCpf, null);
  assert.strictEqual(s.lucro, null);
  assert.strictEqual(s.descPct, 0);
  // sem venda
  const z = E.indicadores({ vt: 0, qtd: 0, desc: 0, cupons: 0, comCpf: 0, custo: 0, vtCusto: 0 });
  assert.deepStrictEqual([z.ticket, z.ipa, z.pctCpf, z.descPct, z.lucro], [null, null, null, null, null]);
});

test('lista de espera: conversão por pessoa só com 3 desfechos ou mais, no período', () => {
  const p = (vendedora, st, fim) => ({ vendedora, st, fim: fim + 'T12:00:00.000Z', criadoEm: '2026-01-01T12:00:00.000Z' });
  const ped = [p('Lívia', 'comprou', '2026-03-02'), p('Lívia', 'comprou', '2026-03-05'), p('Lívia', 'naocomprou', '2026-03-09'), p('Lívia', 'comprou', '2026-05-01'),
    p('Gabi', 'comprou', '2026-03-03'), p('Lívia', 'esperando', '2026-03-03'), { st: 'comprou', fim: '2026-03-03' }];
  const m = E.conversaoEspera(ped, ['LIVIA SOUZA', 'GABI LIMA'], '2026-03-01', '2026-03-31');
  assert.deepStrictEqual(m.get('LIVIA SOUZA'), { comprou: 2, fechados: 3, taxa: 2 / 3 });
  assert.strictEqual(m.get('GABI LIMA').taxa, null); // 1 pedido só: pouco dado
  assert.strictEqual(E.conversaoEspera([], ['X']).size, 0);
});

// ---------- permissão: o que /api/dados entrega à vendedora (filtrarPorPerfil, server.js) ----------
function filtrar() {
  const src = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
  const ini = src.indexOf('function filtrarPorPerfil('), fim = src.indexOf('\nconst packCache');
  assert.ok(ini > 0 && fim > ini, 'filtrarPorPerfil não encontrada no server.js');
  const ctx = vm.createContext({ crypto: require('crypto'), SECRET: 'teste' });
  vm.runInContext(src.slice(ini, fim) + '\nthis.f = filtrarPorPerfil;', ctx);
  return (d, p) => JSON.parse(JSON.stringify(ctx.f(d, p)));
}
const DADOS = () => ({
  vendas: [{ vendedor: 'ANA LIMA', vt: 10 }, { vendedor: 'BIA REIS', vt: 20 }, { vendedor: 'CAIO DIAS', vt: 30 }],
  xml: [{ cpf: '1', cupom: 1 }], clientes: [{ cpf: '1', nome: 'Cliente' }], fidelidade: [{ ev: [['1']] }],
  metaCfgs: [{ id: 'l1', escalaAjustes: { '2026-11': { '2026-11-03': { 'BIA REIS': { tipo: 'folga' } } } }, contabilidade: ['x@y'], ferias: [{ vendedor: 'BIA REIS', de: '2026-11-01', ate: '2026-11-05' }],
    operacao: { equipe: { funcionarios: 3, nomes: ['ANA LIMA', 'BIA REIS', 'CAIO DIAS'], pessoas: [{ nome: 'BIA REIS', folga: 'seg' }] } }, regras: null }],
});

test('vendedora: não recebe a escala, o nome dos colegas, os cupons com CPF nem o FIXE (nada para a ficha da equipe)', () => {
  const out = filtrar()(DADOS(), 'vendedor:ANA LIMA');
  assert.ok(!/BIA REIS|CAIO DIAS/.test(JSON.stringify(out)), 'nome de colega vazou para a vendedora');
  assert.ok(out.vendas.map((v) => v.vendedor).filter((n) => n !== 'ANA LIMA').every((n) => /^COLEGA \d+$/.test(n)));
  assert.deepStrictEqual(out.metaCfgs[0].escalaAjustes, {}); // sem a escala de ninguém
  assert.strictEqual(out.metaCfgs[0].operacao.equipe.nomes, undefined);
  assert.strictEqual(out.metaCfgs[0].operacao.equipe.pessoas, undefined);
  assert.strictEqual(out.xml.length + out.clientes.length + out.fidelidade.length, 0); // sem % de CPF e sem retorno da fidelidade
});

test('gerente sem a tela Clientes: vê a equipe, mas não recebe cupons com CPF nem o FIXE', () => {
  const out = filtrar()(DADOS(), 'gerente');
  assert.deepStrictEqual(out.vendas.map((v) => v.vendedor), ['ANA LIMA', 'BIA REIS', 'CAIO DIAS']);
  assert.strictEqual(out.xml.length + out.clientes.length + out.fidelidade.length, 0);
  assert.strictEqual(filtrar()(DADOS(), 'completo').fidelidade.length, 1);
});

test('a aba da equipe e o cartão da fidelidade se recusam para quem não é da gestão ou não vê clientes', () => {
  const eq = fs.readFileSync(path.join(__dirname, '../../public/js/equipe.js'), 'utf8');
  assert.match(eq, /if \(!ehGestao\(\)\) \{ root\.append\(.*return; \}/);
  const mapa = fs.readFileSync(path.join(__dirname, '../../public/js/mapa.js'), 'utf8');
  assert.match(mapa, /TS\.eu\.perfil !== 'vendedor' \? \[\['rendimento'/);
  const fid = fs.readFileSync(path.join(__dirname, '../../public/js/fidretorno.js'), 'utf8');
  assert.match(fid, /if \(!\(TS\.eu && TS\.eu\.pode && TS\.eu\.pode\.clientes\)\) return null;/);
  // as telas onde isso mora nunca são da vendedora
  const T = require('../../src/telas');
  assert.strictEqual(T.regra('mapa', 'vendedor'), 'nunca');
  assert.strictEqual(T.regra('clientes', 'vendedor'), 'nunca');
});
