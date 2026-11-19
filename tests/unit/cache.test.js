// Memórias (caches) de leitura: arquivo novo aparece e o que o painel grava vale na leitura seguinte; limpeza dos envios antigos
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja 1' }, { id: 'l2', nome: 'Loja 2' }], usuarios: {} }));
const C = require('../../src/config');
const NFS = require('../../src/nfsaida');
const ES = require('../../src/estoque');
const INV = require('../../src/inventario');
const NFE = require('../../src/nfe');

// chave fictícia de 44 dígitos; o modelo (55 = NF-e, 65 = cupom) fica nas posições 21-22
const chave = (n, mod = '55') => '52261100000000000191' + mod + String(n).padStart(22, '0');
const xml = (ch, n) => `<nfeProc><NFe><infNFe Id="NFe${ch}"><ide><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>${n}</nNF><dhEmi>2026-11-11T10:00:00-03:00</dhEmi><tpNF>1</tpNF><finNFe>1</finNFe></ide>
<det nItem="1"><prod><cProd>1</cProd><xProd>Cha</xProd><CFOP>5102</CFOP><qCom>1</qCom><vUnCom>10</vUnCom><vProd>10</vProd></prod></det><total><ICMSTot><vNF>${n}.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
const dirX = (loja, ym, sit) => path.join(C.pastaLoja(loja), 'xmls', ym, sit);
function porXml(loja, ym, sit, ch, n) {
  fs.mkdirSync(dirX(loja, ym, sit), { recursive: true });
  fs.writeFileSync(path.join(dirX(loja, ym, sit), `${ym.replace('-', '')}11_${ch}.xml`), xml(ch, n));
}
// as pastas "assentam": a memória só vale para pasta mexida há mais de 2 s
function envelhecer(loja) {
  const r = path.join(C.pastaLoja(loja), 'xmls');
  const t = new Date(Date.now() - 60e3);
  for (const ym of fs.readdirSync(r)) for (const s of fs.readdirSync(path.join(r, ym))) fs.utimesSync(path.join(r, ym, s), t, t);
}

test('NF-e: a lista em memória mostra o XML novo, o cancelamento e não mistura lojas', () => {
  const a = chave(70), b = chave(71), c = chave(72);
  assert.match(a, /^\d{44}$/);
  assert.deepStrictEqual(NFS.lista('l1'), { notas: [], temXml: false });
  porXml('l1', '2026-11', 'ativos', a, 70);
  porXml('l1', '2026-11', 'ativos', chave(900, '65'), 900); // cupom (NFC-e) fica de fora
  assert.deepStrictEqual(NFS.lista('l1').notas.map((n) => n.numero), [70], 'nota recém-chegada aparece na hora');
  assert.strictEqual(NFS.lista('l1').temXml, true);
  envelhecer('l1');
  assert.deepStrictEqual(NFS.lista('l1').notas.map((n) => n.numero), [70]);
  // de dentro da memória: quem recebe a lista pode mexer nela sem estragar a próxima leitura
  const l = NFS.lista('l1'); l.notas[0].numero = 999; l.notas.pop();
  assert.deepStrictEqual(NFS.lista('l1').notas.map((n) => n.numero), [70]);
  assert.strictEqual(NFS.achar('l1', b), null);
  assert.strictEqual(NFS.chaves('l1').has(b), false);
  // chega outra nota na mesma pasta (a pasta muda): aparece na leitura seguinte, na lista, no achar e nas chaves
  porXml('l1', '2026-11', 'ativos', b, 71);
  assert.deepStrictEqual(NFS.lista('l1').notas.map((n) => n.numero).sort(), [70, 71]);
  assert.ok(NFS.achar('l1', b).arq.endsWith(`${b}.xml`));
  assert.ok(NFS.chaves('l1').has(b));
  assert.strictEqual(NFS.nota('l1', b).numero, 71);
  envelhecer('l1');
  NFS.lista('l1');
  // mês novo (pasta nova) e cancelamento (arquivo novo em "cancelados")
  porXml('l1', '2026-12', 'ativos', c, 72);
  assert.ok(NFS.achar('l1', c), 'pasta de mês nova entra');
  envelhecer('l1');
  assert.strictEqual(NFS.lista('l1').notas.find((n) => n.chave === a).situacao, 'autorizada');
  porXml('l1', '2026-11', 'cancelados', a, 70);
  assert.strictEqual(NFS.lista('l1').notas.find((n) => n.chave === a).situacao, 'cancelada');
  assert.strictEqual(NFS.achar('l1', a).sit, 'cancelados');
  // nota apagada da pasta some
  envelhecer('l1');
  NFS.lista('l1');
  fs.unlinkSync(NFS.achar('l1', c).arq);
  assert.strictEqual(NFS.achar('l1', c), null);
  // outra loja não enxerga nada disso
  assert.deepStrictEqual(NFS.lista('l2').notas, []);
  assert.strictEqual(NFS.achar('l2', a), null);
  porXml('l2', '2026-11', 'ativos', c, 72);
  assert.deepStrictEqual(NFS.lista('l2').notas.map((n) => n.numero), [72]);
  assert.strictEqual(NFS.lista('l1').notas.some((n) => n.chave === c), false);
});

test('Estoque: compras, notas e histórico de custo releem quando o arquivo muda', () => {
  const dir = path.join(C.pastaLoja('l1'), 'estoque');
  fs.mkdirSync(dir, { recursive: true });
  assert.strictEqual(ES.compras('l1'), null);
  assert.strictEqual(ES.notas('l1'), null);
  const nota = (id, custo) => ({ id, nf: String(100 + id), motivo: 'Compra', status: 'Concluído', entrada: '2026-11-0' + id, fornecedor: 'F', total: 10, itens: [{ cod: 'A', nome: 'Cha', qtd: 2, custo }] });
  fs.writeFileSync(path.join(dir, 'compras.json'), JSON.stringify({ atualizado: 't1', notas: [nota(1, 5)] }));
  assert.deepStrictEqual(ES.compras('l1').itens.A, [['2026-11-01', 5, '101', 2, 'F']]);
  assert.strictEqual(ES.notas('l1').notas.length, 1);
  assert.strictEqual(ES.compras('l1').notas, 1, 'segunda leitura (da memória) igual');
  // o coletor grava de novo (mais uma nota): a leitura seguinte já traz
  C.gravarAtomico(path.join(dir, 'compras.json'), JSON.stringify({ atualizado: 't2', notas: [nota(1, 5), nota(2, 6)] }));
  assert.strictEqual(ES.compras('l1').itens.A.length, 2);
  assert.deepStrictEqual([ES.notas('l1').atualizado, ES.notas('l1').notas.length], ['t2', 2]);
  // outra loja não recebe o que é desta
  assert.strictEqual(ES.compras('l2'), null);
  assert.deepStrictEqual(ES.historico('l2'), {});
  // histórico: nasce do estoque atual; custo novo gravado pelo painel aparece na leitura seguinte
  fs.writeFileSync(path.join(dir, 'atual.json'), JSON.stringify({ em: '2026-11-10T08:00:00-03:00', itens: [{ cod: 'A', desc: 'Cha', qtd: 1, custo: 5 }] }));
  assert.deepStrictEqual(ES.historico('l1'), { A: [['2026-11-10', 5]] });
  assert.deepStrictEqual(ES.historico('l1'), { A: [['2026-11-10', 5]] });
  const h = JSON.parse(fs.readFileSync(path.join(dir, 'custos.json'), 'utf8'));
  h.A.push(['2026-11-12', 7]);
  h.B = [['2026-11-12', 3]];
  C.gravarAtomico(path.join(dir, 'custos.json'), JSON.stringify(h));
  assert.deepStrictEqual(ES.historico('l1'), { A: [['2026-11-10', 5], ['2026-11-12', 7]], B: [['2026-11-12', 3]] });
  // arquivo apagado: volta a "não tem"
  fs.unlinkSync(path.join(dir, 'compras.json'));
  assert.strictEqual(ES.compras('l1'), null);
  assert.strictEqual(ES.notas('l1'), null);
});

test('Inventário: a lista das contagens reflete o que o painel grava', () => {
  const cat = [{ cod: '1', desc: 'Lata', un: 'Un', grupo: 'ACESSÓRIOS', sub: '', tipo: '', qtd: 3, custo: 2 }, { cod: '2', desc: 'Caneca', un: 'Un', grupo: 'ACESSÓRIOS', sub: '', tipo: '', qtd: 1, custo: 9 }];
  assert.deepStrictEqual(INV.lista('l1'), []);
  const c = INV.criar('l1', { cods: ['1', '2'], nome: 'Primeira' }, 'ger', cat, 'gerente').ok;
  assert.deepStrictEqual(INV.lista('l1').map((x) => [x.id, x.st, x.itens, x.contados]), [[c.id, 'contando', 2, 0]]);
  assert.ok(INV.contar('l1', c.id, '1', 3, 'ger').ok);
  assert.strictEqual(INV.lista('l1')[0].contados, 1, 'contou: a lista seguinte já mostra');
  assert.ok(INV.acao('l1', c.id, 'revisar', 'ger').ok);
  assert.strictEqual(INV.lista('l1')[0].st, 'revisao');
  // quem recebe a lista pode alterar a cópia (a rota tira o ajuste da vendedora) sem estragar a memória
  INV.lista('l1')[0].st = 'x';
  assert.strictEqual(INV.lista('l1')[0].st, 'revisao');
  const c2 = INV.criar('l1', { cods: ['2'], nome: 'Segunda' }, 'ger', cat, 'gerente').ok;
  assert.deepStrictEqual(INV.lista('l1').map((x) => x.id).sort(), [c.id, c2.id].sort());
  assert.deepStrictEqual(INV.lista('l2'), [], 'outra loja não vê');
  fs.unlinkSync(path.join(C.pastaLoja('l1'), 'inventario', c2.id + '.json'));
  assert.deepStrictEqual(INV.lista('l1').map((x) => x.id), [c.id]);
});

test('Limpeza: apaga só pedidos de envio antigos ou fora das listas; o resto fica', () => {
  const agora = Date.now();
  const velho = (f, n) => { const t = new Date(agora - n * 864e5); fs.utimesSync(f, t, t); };
  // NF-e
  const env = path.join(C.pastaLoja('l1'), 'nfe', 'envio');
  fs.mkdirSync(env, { recursive: true });
  const por = (nome, n) => { const f = path.join(env, nome); fs.writeFileSync(f, '{}'); velho(f, n); return f; };
  C.gravarAtomico(path.join(C.pastaLoja('l1'), 'nfe', 'rascunhos.json'), JSON.stringify([{ id: 'aaaaaaaaaaaa' }, { id: 'bbbbbbbbbbbb' }]));
  C.gravarAtomico(path.join(C.pastaLoja('l1'), 'nfe', 'parceiros.json'), JSON.stringify([{ id: 'cccccccccccc' }]));
  const fica = [por('aaaaaaaaaaaa.json', 30), por('aaaaaaaaaaaa.resultado.json', 30), por('cccccccccccc.json', 5), por('dddddddddddd.json', 40) /* devolução (manter) */,
    por('eeeeeeeeeeee.json', 0.5) /* acabou de ser pedido, ainda fora da lista */, por('cadastros.resultado.json', 400), por('outra-coisa.txt', 400)];
  const sai = [por('bbbbbbbbbbbb.json', 91), por('bbbbbbbbbbbb.resultado.json', 91), por('ffffffffffff.json', 2), por('ffffffffffff.resultado.json', 2), por('dddddddddddd.resultado.json', 95)];
  const xmlNota = path.join(dirX('l1', '2026-11', 'ativos'), `20261111_${chave(70)}.xml`);
  velho(xmlNota, 500);
  assert.strictEqual(NFE.limparEnvios('l1', ['dddddddddddd'], agora), sai.length);
  for (const f of fica) assert.ok(fs.existsSync(f), 'fica: ' + path.basename(f));
  for (const f of sai) assert.ok(!fs.existsSync(f), 'sai: ' + path.basename(f));
  assert.ok(fs.existsSync(xmlNota), 'XML de nota nunca é apagado');
  assert.strictEqual(NFE.lista('l1').length, 2);
  assert.strictEqual(NFE.limparEnvios('l1', ['dddddddddddd'], agora), 0);
  assert.strictEqual(NFE.limparEnvios('l2'), 0, 'loja sem pasta: nada a fazer');
  // inventário
  const cid = INV.lista('l1')[0].id;
  const envI = path.join(C.pastaLoja('l1'), 'inventario', 'envio');
  fs.mkdirSync(envI, { recursive: true });
  const porI = (nome, n) => { const f = path.join(envI, nome); fs.writeFileSync(f, 'x'); velho(f, n); return f; };
  const ficaI = [porI(`${cid}-importar.xlsx`, 30), porI(`${cid}-importar.json`, 30), porI('999999999999-importar.xlsx', 0.5), porI('anotacao.txt', 400)];
  const saiI = [porI(`${cid}-desfazer.xlsx`, 91), porI(`${cid}-desfazer.resultado.json`, 91), porI('999999999999-desfazer.xlsx', 3), porI('999999999999-desfazer.json', 3)];
  assert.strictEqual(INV.limparEnvios('l1', agora), saiI.length);
  for (const f of ficaI) assert.ok(fs.existsSync(f), 'fica: ' + path.basename(f));
  for (const f of saiI) assert.ok(!fs.existsSync(f), 'sai: ' + path.basename(f));
  assert.strictEqual(INV.lista('l1').length, 1, 'a contagem continua lá');
});
