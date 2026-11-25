'use strict';
// Campanhas: retorno só depois do envio, % sobre o prazo fechado e grupo de comparação (public/js/campretorno.js + src/campanhas.js)
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'campret-'));
process.env.DATA_DIR = tmp;
const C = require('../../src/config');
C.pastaLoja = (id) => path.join(tmp, 'lojas', id);
const CAMP = require('../../src/campanhas');
const R = require('../../public/js/campretorno');
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const perto = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
// envio em 10/03/2026 às 15h de Brasília = dia 20522
const EM = '2026-03-10T18:00:00.000Z', E = R.diaDe(EM);
const item = (o = {}) => ({ cpf: '1', st: 'e', em: EM, ...o });

test('CAMP-RET-01 só conta compra DEPOIS do envio: a do mesmo dia (antes era "voltou") e as anteriores ficam de fora', () => {
  assert.strictEqual(E, Math.floor(Date.UTC(2026, 2, 10) / 864e5));
  // comprou de manhã no dia do envio (antes da mensagem): antes contava como retorno de R$ 80; agora não
  let x = R.retornoItem(item(), [{ day: E, vt: 80 }], 30, E + 40);
  assert.strictEqual(x.voltou, false); assert.strictEqual(x.vt, 0); assert.strictEqual(x.primeira, null);
  // do dia seguinte até o último dia do prazo conta; um dia depois do prazo, não
  x = R.retornoItem(item(), [{ day: E - 3, vt: 10 }, { day: E, vt: 80 }, { day: E + 1, vt: 50 }, { day: E + 30, vt: 20 }, { day: E + 31, vt: 99 }], 30, E + 40);
  assert.strictEqual(x.voltou, true); assert.strictEqual(x.vt, 70); assert.strictEqual(x.primeira, E + 1);
  // com a hora da compra: no mesmo dia vale só a que foi depois da hora do envio
  x = R.retornoItem(item(), [{ day: E, vt: 30, em: '2026-03-10T14:00:00.000Z' }, { day: E, vt: 45, em: '2026-03-10T20:30:00.000Z' }], 30, E + 40);
  assert.strictEqual(x.voltou, true); assert.strictEqual(x.vt, 45);
  // envio às 22h de Brasília (já é dia seguinte em UTC): o dia do envio é o de Brasília
  assert.strictEqual(R.diaDe('2026-03-11T01:00:00.000Z'), E);
  // pendente, pulado ou sem data: sem retorno
  assert.strictEqual(R.retornoItem(item({ st: 'p' }), [], 30, E), null);
  assert.strictEqual(R.retornoItem(item({ st: 'x' }), [], 30, E), null);
  assert.strictEqual(R.retornoItem(item({ em: undefined }), [], 30, E), null);
});

test('CAMP-RET-02 prazo: fechado só depois do último dia; "ainda no prazo" fica separado', () => {
  assert.strictEqual(R.retornoItem(item(), [], 30, E + 30).aberto, true); // o último dia ainda não acabou
  assert.strictEqual(R.retornoItem(item(), [], 30, E + 31).fechado, true);
});

test('CAMP-RET-03 "% voltaram" = voltaram ÷ enviados com o prazo fechado (antes: ÷ todos os enviados)', () => {
  // 10 enviados há 40 dias (prazo fechado), 3 voltaram; 10 enviados há 5 dias (no prazo), 1 já voltou
  const lista = [], cup = {};
  for (let k = 0; k < 10; k++) { lista.push({ cpf: 'a' + k, st: 'e', em: EM }); if (k < 3) cup['a' + k] = [{ day: E + 5, vt: 100 }]; }
  const NOVO = new Date(Date.parse(EM) + 35 * 864e5).toISOString();
  for (let k = 0; k < 10; k++) { lista.push({ cpf: 'b' + k, st: 'e', em: NOVO }); if (k < 1) cup['b' + k] = [{ day: E + 37, vt: 60 }]; }
  lista.push({ cpf: 'p', st: 'p' }, { cpf: 'o', st: 'o', em: EM }, { cpf: 'x', st: 'x', em: EM });
  const s = R.resumo(lista, (cpf) => cup[cpf] || [], 30, E + 40);
  assert.deepStrictEqual([s.total, s.env, s.pend, s.opt, s.pul, s.comp], [23, 20, 1, 1, 1, 0]);
  assert.deepStrictEqual([s.rec.fechados, s.rec.abertos, s.rec.voltFech, s.rec.voltAbertos, s.rec.volt], [10, 10, 3, 1, 4]);
  perto(s.rec.taxa, 0.3); // antes: 4 ÷ 20 = 20%
  perto(s.rec.gasto, 30); // R$ 300 ÷ 10 clientes de prazo fechado
  assert.strictEqual(s.rec.vt, 360);
  assert.strictEqual(s.efeito, null); // sem grupo de comparação
  // ninguém com prazo fechado: sem % (não vira 0%)
  assert.strictEqual(R.resumo(lista.slice(10, 20), () => [], 30, E + 40).rec.taxa, null);
});

test('CAMP-RET-04 efeito da campanha = quem recebeu − quem não recebeu, na mesma janela; "poucos dados" abaixo de 20', () => {
  const lista = [], cup = {};
  // 100 receberam: 30 voltaram gastando R$ 100 cada (30%, R$ 30 por cliente)
  for (let k = 0; k < 100; k++) { lista.push({ cpf: 'e' + k, st: 'e', em: EM }); if (k < 30) cup['e' + k] = [{ day: E + 3, vt: 100 }]; }
  // 25 ficaram sem mensagem: 5 voltaram gastando R$ 100 cada (20%, R$ 20 por cliente)
  for (let k = 0; k < 25; k++) { lista.push({ cpf: 'c' + k, st: 'c', em: EM }); if (k < 5) cup['c' + k] = [{ day: E + 3, vt: 100 }]; }
  const s = R.resumo(lista, (cpf) => cup[cpf] || [], 30, E + 40);
  assert.strictEqual(s.comp, 25); assert.strictEqual(s.env, 100);
  perto(s.rec.taxa, 0.3); perto(s.ctl.taxa, 0.2);
  perto(s.efeito.taxa, 0.1); // +10 pontos
  perto(s.efeito.gasto, 10); // R$ 10 a mais por cliente
  perto(s.efeito.vendasAMais, 1000); // × 100 que receberam (o "faturamento do retorno" bruto seria R$ 3.000)
  assert.strictEqual(s.efeito.poucos, false);
  // grupo de comparação com 19 de prazo fechado: poucos dados
  const menor = lista.filter((x) => x.st === 'e' || +x.cpf.slice(1) < 19);
  assert.strictEqual(R.resumo(menor, (cpf) => cup[cpf] || [], 30, E + 40).efeito.poucos, true);
  // comparação ainda no prazo: sem efeito para mostrar
  assert.strictEqual(R.resumo(lista, (cpf) => cup[cpf] || [], 30, E + 10).efeito, null);
});

test('CAMP-CMP-01 sorteio estável por CPF + campanha: cerca de 10%, só em lista com 50+ e só entre pendentes', () => {
  const cpfs = Array.from({ length: 2000 }, (_, k) => String(10000000000 + k * 7919));
  const n = cpfs.filter((c) => R.noGrupo('camp1', c)).length;
  assert.ok(n > 150 && n < 250, `esperava perto de 200 em 2000, deu ${n}`);
  assert.strictEqual(R.noGrupo('camp1', cpfs[0]), R.noGrupo('camp1', cpfs[0])); // sempre a mesma resposta
  assert.notDeepStrictEqual(cpfs.map((c) => R.noGrupo('camp1', c)), cpfs.map((c) => R.noGrupo('camp2', c))); // outra campanha, outro sorteio
  const lista = cpfs.slice(0, 200).map((cpf) => ({ cpf, nome: 'x', st: 'p' }));
  const sep = R.separar(lista, 'camp1', { ligado: true, em: EM });
  const c = sep.filter((x) => x.st === 'c');
  assert.ok(c.length >= 8 && c.length <= 35, String(c.length));
  assert.ok(c.every((x) => x.em === EM));
  assert.strictEqual(sep.length, 200);
  // desligado ou lista com menos de 50: ninguém
  assert.ok(R.separar(lista, 'camp1', { ligado: false, em: EM }).every((x) => x.st === 'p'));
  assert.ok(R.separar(lista.slice(0, 49), 'camp1', { ligado: true, em: EM }).every((x) => x.st === 'p'));
  // quem já foi enviado não é mexido
  const env = lista.map((x) => ({ ...x, st: 'e' }));
  assert.ok(R.separar(env, 'camp1', { ligado: true, em: EM }).every((x) => x.st === 'e'));
});

test('CAMP-CMP-02 servidor: cria o grupo ao criar a lista, na lista nova da recorrente e ao refazer; "c" não pode ser marcado', () => {
  const lista = Array.from({ length: 120 }, (_, k) => ({ cpf: String(20000000000 + k * 104729), nome: 'Cliente ' + k }));
  const r = CAMP.criar('cmp', { nome: 'Volta', mensagem: 'Oi {nome}', recorrente: 'semanal', lista }, 'adm');
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.ok.comparar, true, 'campanha nova: padrão ligado');
  const l0 = r.ok.rodadas[0].lista, c0 = l0.filter((x) => x.st === 'c');
  assert.ok(c0.length >= 3 && c0.length <= 25, String(c0.length));
  assert.strictEqual(l0.filter((x) => x.st === 'p').length + c0.length, 120);
  assert.ok(c0.every((x) => x.em === r.ok.rodadas[0].em && R.noGrupo(r.ok.id, x.cpf)));
  // não dá para enviar, pular nem voltar para a fila quem é do grupo de comparação
  for (const st of ['e', 'p', 'x', 'o']) assert.match(CAMP.marcar('cmp', r.ok.id, r.ok.rodadas[0].id, c0[0].cpf, st, 'adm').erro, /grupo de comparação/);
  assert.strictEqual(CAMP.marcar('cmp', r.ok.id, r.ok.rodadas[0].id, c0[0].cpf, 'c', 'adm').erro, 'Situação inválida.');
  const pend = l0.find((x) => x.st === 'p');
  assert.strictEqual(CAMP.marcar('cmp', r.ok.id, r.ok.rodadas[0].id, pend.cpf, 'c', 'adm').erro, 'Situação inválida.'); // ninguém entra no grupo à mão
  // lista nova da recorrente: os mesmos clientes ficam no grupo (sorteio estável)
  const t1 = Date.parse(r.ok.rodadas[0].em) + 8 * 864e5;
  const n = CAMP.novaRodada('cmp', r.ok.id, lista, 'robô', t1);
  assert.deepStrictEqual(n.ok.rodadas[0].lista.filter((x) => x.st === 'c').map((x) => x.cpf), c0.map((x) => x.cpf));
  // refazer a lista: quem é "c" continua; pendente novo passa pelo mesmo sorteio
  const z = CAMP.refazerLista('cmp', r.ok.id, n.ok.rodadas[0].id, lista.slice(0, 80));
  const lz = z.ok.rodadas[0].lista;
  assert.ok(lz.filter((x) => x.st === 'c').length >= c0.length);
  assert.ok(lz.filter((x) => x.st === 'p').every((x) => !R.noGrupo(r.ok.id, x.cpf)));
  // desligado na criação: ninguém; campanha antiga (sem o campo) continua sem grupo ao editar outra coisa
  const s = CAMP.criar('cmp', { nome: 'Sem', mensagem: 'Oi', comparar: false, lista }, 'adm');
  assert.strictEqual(s.ok.comparar, false);
  assert.ok(s.ok.rodadas[0].lista.every((x) => x.st === 'p'));
  assert.strictEqual(CAMP.dadosOk({ nome: 'Outro nome' }, { id: 'velha', nome: 'Velha', mensagem: 'Oi', janela: 30 }).ok.comparar, false);
  assert.strictEqual(CAMP.alterar('cmp', s.ok.id, { comparar: true }).ok.comparar, true);
  // lista pequena: sem grupo, mesmo ligado
  const p = CAMP.criar('cmp', { nome: 'Pequena', mensagem: 'Oi', lista: lista.slice(0, 49) }, 'adm');
  assert.ok(p.ok.rodadas[0].lista.every((x) => x.st === 'p'));
});

test('CAMP-CMP-03 campanha que se repete, criada antes do grupo de comparação: passa a guardar os 10% na próxima lista; lista única antiga não muda', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-'));
  process.env.DATA_DIR = tmp;
  for (const k of Object.keys(require.cache)) if (/src[\\/](campanhas|config)\.js$/.test(k)) delete require.cache[k];
  const C = require('../../src/config'), CAMP = require('../../src/campanhas');
  const dir = path.join(C.pastaLoja('lz'), 'clientes');
  const achar = () => { const base = C.pastaLoja('lz'); const out = []; const anda = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) anda(p); else out.push(p); } }; try { anda(base); } catch { /* vazio */ } return out; };
  // cria uma campanha nova só para descobrir onde o arquivo fica, depois grava o formato antigo (sem "comparar")
  const lista = Array.from({ length: 60 }, (_, i) => ({ cpf: String(10000000000 + i), nome: 'C' + i }));
  CAMP.criar('lz', { nome: 'X', mensagem: 'oi', lista }, 'dono');
  const arq = achar().find((f) => /campanha/i.test(f));
  assert.ok(arq, 'arquivo das campanhas');
  const antigas = [{ id: 'rec1', nome: 'Toda semana', mensagem: 'oi', recorrente: 'semanal', ativa: true, filtros: {}, rodadas: [{ id: 'r0', em: '2026-01-01T12:00:00.000Z', lista: [] }] },
    { id: 'uni1', nome: 'Única', mensagem: 'oi', recorrente: '', ativa: true, filtros: {}, rodadas: [{ id: 'r0', em: '2026-01-01T12:00:00.000Z', lista: [] }] },
    { id: 'rec2', nome: 'Desmarcada', mensagem: 'oi', recorrente: 'mensal', comparar: false, ativa: true, filtros: {}, rodadas: [{ id: 'r0', em: '2026-01-01T12:00:00.000Z', lista: [] }] }];
  fs.writeFileSync(arq, JSON.stringify(antigas));
  const lidas = Object.fromEntries(CAMP.ler('lz').map((c) => [c.id, c.comparar]));
  assert.deepEqual(lidas, { rec1: true, uni1: undefined, rec2: false });
  const r = CAMP.novaRodada('lz', 'rec1', lista, 'robô', Date.parse('2026-11-20T12:00:00Z'));
  const nova = r.ok.rodadas[0].lista;
  assert.ok(nova.some((x) => x.st === 'c'), 'a lista nova tem grupo de comparação');
  assert.ok(nova.filter((x) => x.st === 'c').length <= 12);
  fs.rmSync(tmp, { recursive: true, force: true });
  void dir;
});

test('CAMP-TOT-01 retorno de todas as campanhas: a mesma compra e o mesmo cliente contam uma vez só', () => {
  const k1 = { day: E + 2, vt: 100 }, k2 = { day: E + 20, vt: 50 }, k3 = { day: E + 5, vt: 70 };
  const cup = { 1: [k1, k2], 2: [k3], 3: [], 4: [{ day: E + 3, vt: 40 }] };
  const cuponsDe = (cpf) => cup[cpf] || [];
  const A = { janela: 30, rodadas: [{ lista: [item({ cpf: '1' }), item({ cpf: '2' }), item({ cpf: '3' }), { cpf: '9', st: 'p' }] }] };
  // a cliente 1 recebeu também a campanha B, 1 dia depois: as compras de R$ 100 e R$ 50 são retorno das duas, mas no total entram uma vez
  const B = { janela: 30, rodadas: [{ lista: [item({ cpf: '1', em: '2026-03-11T18:00:00.000Z' }), item({ cpf: '4', st: 'c' }), item({ cpf: '2', st: 'c' })] }] };
  const g = R.geral([A, B], cuponsDe, E + 40);
  assert.strictEqual(g.campanhas, 2);
  assert.strictEqual(g.rec.n, 3); // 1, 2, 3 (a 1 conta uma vez)
  assert.strictEqual(g.rec.volt, 2);
  assert.strictEqual(g.rec.vt, 220); // 100 + 50 + 70, sem repetir os 150 da campanha B
  assert.strictEqual(g.rec.fechados, 3); perto(g.rec.taxa, 2 / 3);
  // cada campanha sozinha conta a compra (é retorno dela): 100 + 50
  assert.strictEqual(R.resumo(B.rodadas[0].lista, cuponsDe, 30, E + 40).rec.vt, 150);
  // comparação: quem recebeu alguma campanha (a 2) não entra; fica a 4, que voltou
  assert.strictEqual(g.ctl.n, 1); assert.strictEqual(g.ctl.voltFech, 1);
  perto(g.efeito, 2 / 3 - 1); assert.strictEqual(g.poucos, true);
  // prazo aberto: entra no faturamento, não no %
  const h = R.geral([A], cuponsDe, E + 10);
  assert.strictEqual(h.rec.fechados, 0); assert.strictEqual(h.rec.taxa, null); assert.strictEqual(h.rec.vt, 220);
  // período: só envios com o dia no período
  assert.strictEqual(R.geral([A, B], cuponsDe, E + 40, (d) => d > E).rec.n, 1);
  assert.strictEqual(R.geral([], cuponsDe, E).campanhas, 0);
});
