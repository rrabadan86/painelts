// Produtos → Site, filtro "Mudou em": as mudanças de um dia saem do histórico guardado (data da consulta, horário de Brasília)
// e o painel separa "nenhuma mudança" de "sem consulta neste dia"
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sitedia-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [], usuarios: {} }));
const SD = require('../../public/js/sitedia');
const S = require('../../src/site');

// consultas às 10h de Brasília (13h UTC); a de 21/11 às 23h30 de Brasília já é 22/11 em UTC
const pts = [
  ['2026-11-01T13:00:00.000Z', 100, null, 1], // primeiro ponto: o painel começou a guardar (não é mudança)
  ['2026-11-20T13:00:00.000Z', 110, null, 1], // preço cheio 100 → 110
  ['2026-11-20T18:00:00.000Z', 88, 110, 1], // no mesmo dia, "Consultar agora": entrou em promoção
  ['2026-11-22T02:30:00.000Z', 88, 110, 0], // 21/11 às 23h30 em Brasília: esgotou
  ['2026-11-23T13:00:00.000Z', null, null, 0], // saiu do site
];

test('SITE-DATA-01: as mudanças de um dia são as do histórico daquele dia (horário de Brasília), na ordem; o primeiro ponto não conta', () => {
  const d20 = SD.mudancasDoDia(pts, '2026-11-20');
  assert.deepStrictEqual(d20.map((m) => [m.a[1], m.b[1], m.b[2]]), [[100, 110, null], [110, 88, 110]]);
  assert.strictEqual(d20[0].em, pts[1][0]);
  // 02:30 UTC de 22/11 = 23:30 de 21/11 em Brasília
  assert.deepStrictEqual(SD.mudancasDoDia(pts, '2026-11-21').map((m) => m.b[3]), [0]);
  assert.strictEqual(SD.mudancasDoDia(pts, '2026-11-22').length, 0);
  assert.strictEqual(SD.mudancasDoDia(pts, '2026-11-01').length, 0, 'o primeiro ponto não é mudança');
  assert.deepStrictEqual(SD.mudancasDoDia(pts, '2026-11-23').map((m) => m.b[1]), [null], 'saiu do site');
  assert.deepStrictEqual(SD.mudancasDoDia(null, '2026-11-20'), []);
  assert.deepStrictEqual(SD.mudancasDoDia(pts, ''), []);
});

test('SITE-DATA-02: só conta como mudança o que a tela mostra (preço, preço "de", estoque, saiu/voltou); centavo de arredondamento não', () => {
  assert.strictEqual(SD.mudou([0, 10, null, 1], [0, 10.004, null, 1]), false);
  assert.strictEqual(SD.mudou([0, 10, null, 1], [0, 10, 12, 1]), true);
  assert.strictEqual(SD.mudou([0, 10, null, 1], [0, 10, null, 0]), true);
  assert.strictEqual(SD.mudou([0, 10, null, 1], [0, null, null, 0]), true);
  assert.strictEqual(SD.mudou([0, null, null, 0], [0, 10, null, 1]), true);
});

test('SITE-DATA-03: dia com consulta, sem consulta e sem registro (antes de o painel guardar a lista das consultas)', () => {
  const consultas = ['2026-11-21T13:00:00.000Z', '2026-11-23T13:00:00.000Z']; // lista guardada desde 21/11; 22/11 o servidor ficou desligado
  const dias = SD.diasDeConsulta(consultas, { a: pts });
  assert.strictEqual(SD.situacaoDia('2026-11-20', dias, consultas[0], '2026-11-23'), 'consultado', 'dia que aparece no histórico');
  assert.strictEqual(SD.situacaoDia('2026-11-21', dias, consultas[0], '2026-11-23'), 'consultado');
  assert.strictEqual(SD.situacaoDia('2026-11-22', dias, consultas[0], '2026-11-23'), 'sem-consulta', 'depois do começo da lista e fora dela');
  assert.strictEqual(SD.situacaoDia('2026-11-10', dias, consultas[0], '2026-11-23'), 'sem-registro', 'antes da lista: só se sabe dos dias com mudança');
  assert.strictEqual(SD.situacaoDia('2026-10-01', dias, consultas[0], '2026-11-23'), 'sem-consulta', 'antes da primeira consulta');
  assert.strictEqual(SD.situacaoDia('2026-11-24', dias, consultas[0], '2026-11-23'), 'sem-consulta', 'dia futuro');
  assert.strictEqual(SD.situacaoDia('', dias, consultas[0], '2026-11-23'), 'qualquer');
  // primeira e última consulta do dia (20/11 teve a das 10h e um "Consultar agora")
  assert.deepStrictEqual(dias.get('2026-11-20'), { primeira: pts[1][0], ultima: pts[2][0] });
  assert.strictEqual(SD.diaAntes('2026-03-01'), '2026-02-28');
  assert.strictEqual(SD.diaAntes('2027-01-01'), '2026-12-31');
});

test('SITE-DATA-04: o servidor guarda cada consulta (sem repetir, em ordem, com limite) e entrega também as de antes da lista', () => {
  let l = S.somarConsulta([], '2026-11-21T13:00:00.000Z');
  l = S.somarConsulta(l, '2026-11-20T13:00:00.000Z');
  l = S.somarConsulta(l, '2026-11-21T13:00:00.000Z');
  assert.deepStrictEqual(l, ['2026-11-20T13:00:00.000Z', '2026-11-21T13:00:00.000Z']);
  let muitas = [];
  for (let k = 0; k < 1600; k++) muitas = S.somarConsulta(muitas, new Date(Date.UTC(2022, 0, 1) + k * 86400e3).toISOString());
  assert.strictEqual(muitas.length, 1500);
  assert.ok(muitas[0] > '2022-01-01', 'guarda as mais novas');
  // sem lista guardada (versão de antes): entrega a consulta atual e a anterior de precos.json, e "desde" vazio
  const t = S.consultasTela({ em: '2026-11-23T13:00:00.000Z', anterior: { em: '2026-11-22T13:00:00.000Z' } });
  assert.deepStrictEqual(t, { consultas: ['2026-11-22T13:00:00.000Z', '2026-11-23T13:00:00.000Z'], consultasDesde: null });
  fs.mkdirSync(path.join(tmp, 'site'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'site', 'consultas.json'), JSON.stringify(['2026-11-23T13:00:00.000Z']));
  assert.strictEqual(S.consultasTela({ em: '2026-11-23T13:00:00.000Z' }).consultasDesde, '2026-11-23T13:00:00.000Z');
});
