'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blindagem-'));
process.env.DATA_DIR = path.join(tmp, 'dados');
process.env.CONFIG_FILE = path.join(tmp, 'config', 'lojas.json');
fs.mkdirSync(path.dirname(process.env.CONFIG_FILE), { recursive: true });
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({
  lojas: [{ id: 'l1', nome: 'Loja 1', fidelidade: { validadeMeses: 12, minResgate: 6, prazoResgate: 90 } }],
  usuarios: {},
}));

after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ok */ }
});

const C = require('../../src/config');
const CX = require('../../src/caixa');
const XA = require('../../src/xmlarquivos');
const FE = require('../../src/fechamento');
const CL = require('../../src/classificacao');
const CAD = require('../../src/cadastro');
const EST = require('../../src/estoque');
const TAB = require('../../src/tabela');
const FXM = require('../../src/fixemail');

test('config: preserva fidelidade, normaliza casing de usuário, scrypt assíncrono em tempo constante e fuso SP', async () => {
  const cfg = C.get();
  assert.deepStrictEqual(cfg.lojas[0].fidelidade, { validadeMeses: 12, minResgate: 6, prazoResgate: 90 });

  const h = await C.hashSenhaAsync('Segredo#2026');
  C.alterar((cru) => {
    cru.usuarios.RodrigoAdmin = { senha: h, lojas: ['*'], perfil: 'admin', nome: 'Rodrigo' };
  });
  assert.ok(C.usuario('rodrigoadmin'), 'usuário normalizado em minúsculas');
  assert.strictEqual(await C.confereSenhaAsync('Segredo#2026', h), true);
  assert.strictEqual(await C.confereSenhaAsync('Errada', h), false);
  assert.strictEqual(await C.confereSenhaAsync('Qualquer', null), false);

  // 22:30 de 17/11 em São Paulo = 01:30Z de 18/11 (não pode pular para o dia 18)
  assert.strictEqual(C.diaSP('2026-11-18T01:30:00Z'), '2026-11-17');
  assert.strictEqual(C.somaMeses('2026-01-31', 1), '2026-02-28');

  C.auditar('rodrigoadmin', 'teste', 'l1', 'ok');
  const aud = C.lerAuditoria(10);
  assert.strictEqual(aud[0].acao, 'teste');
});

test('caixa: concilia múltiplos PDVs e ajuste de fundo entre turnos sem distorcer diferença', () => {
  const dir = path.join(C.pastaLoja('l1'), 'caixa');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fechamentos.json'), JSON.stringify({
    atualizado: '2026-11-17T22:00:00-03:00',
    fechamentos: [
      {
        dia: '2026-11-17', pdv: 1, turno: 1, abertura: '09:00', fechamento: '15:00',
        fundoInicial: 200, reserva: 200,
        recebimentos: [{ forma: 'Dinheiro', venda: 100, informado: 100, dif: 0 }],
        suprimentos: [], sangrias: [{ valor: 100, hora: '14:50', reserva: false }],
      },
      {
        dia: '2026-11-17', pdv: 1, turno: 2, abertura: '15:05', fechamento: '22:00',
        fundoInicial: 150, reserva: 180, // −50 retirados entre turnos + 30 vendas em dinheiro = 180 exatos
        recebimentos: [{ forma: 'Dinheiro', venda: 30, informado: 30, dif: 0 }],
        suprimentos: [], sangrias: [],
      },
      {
        dia: '2026-11-17', pdv: 2, turno: 1, abertura: '10:00', fechamento: '21:00',
        fundoInicial: 100, reserva: 150,
        recebimentos: [{ forma: 'Dinheiro', venda: 50, informado: 50, dif: 0 }],
        suprimentos: [], sangrias: [],
      },
    ],
  }));
  const r = CX.doDia('l1', '2026-11-17');
  assert.strictEqual(r.abertura, 300); // 200 (PDV 1) + 100 (PDV 2)
  assert.strictEqual(r.fechamento, 330); // 180 (PDV 1 turno 2) + 150 (PDV 2)
  assert.strictEqual(r.ajusteEntreTurnos, -50);
  assert.strictEqual(r.deveria, 330); // 300 - 50 + (100+30+50) - 100
  assert.strictEqual(r.diferenca, 0);
});

test('xmlarquivos: separa devoluções (CFOP 6202 / finNFe 4) e entradas (tpNF 0) do faturamento de vendas', () => {
  const ym = '2026-11';
  const dirAt = path.join(C.pastaLoja('l1'), 'xmls', ym, 'ativos');
  const dirCa = path.join(C.pastaLoja('l1'), 'xmls', ym, 'cancelados');
  fs.mkdirSync(dirAt, { recursive: true });
  fs.mkdirSync(dirCa, { recursive: true });
  fs.writeFileSync(path.join(dirAt, '20261110_venda1.xml'), '<NFe><tpNF>1</tpNF><finNFe>1</finNFe><CFOP>5102</CFOP><vNF>250.50</vNF></NFe>');
  fs.writeFileSync(path.join(dirAt, '20261112_dev1.xml'), '<NFe><tpNF>1</tpNF><finNFe>4</finNFe><CFOP>6202</CFOP><vNF>100.00</vNF></NFe>');
  fs.writeFileSync(path.join(dirAt, '20261113_ent1.xml'), '<NFe><tpNF>0</tpNF><finNFe>1</finNFe><CFOP>1102</CFOP><vNF>900.00</vNF></NFe>');
  fs.writeFileSync(path.join(dirCa, '20261114_canc1.xml'), '<NFe><tpNF>1</tpNF><finNFe>1</finNFe><CFOP>5102</CFOP><vNF>80.00</vNF></NFe>');
  fs.writeFileSync(path.join(dirCa, '20261114_evento_canc1.xml'), '<procEventoNFe/>');

  const r = XA.resumo('l1', ym);
  assert.deepStrictEqual(r.ativos, { notas: 1, total: 250.5 });
  assert.deepStrictEqual(r.outras, { notas: 2, total: 1000 });
  assert.deepStrictEqual(r.cancelados, { notas: 1, total: 80, eventos: 1 });
});

test('fechamento e classificacao: sem dupla contagem de cupom omni+delivery e suporte à classe "fora"', () => {
  const vendas = [
    { data: '2026-11-17', cupom: 10, loja: 'L1', vendedor: 'ECOMMERCE SITE', descricao: 'Earl Grey 100G', grupoC: 'CHÁ AROMATIZADO', qtd: 1, vt: 89 },
    { data: '2026-11-17', cupom: 10, loja: 'L1', vendedor: 'ECOMMERCE SITE', descricao: 'Taxa Entrega Delivery', grupoC: 'OUTROS', qtd: 1, vt: 15 },
    { data: '2026-11-17', cupom: 11, loja: 'L1', vendedor: 'ANA', descricao: 'Sacola Kraft', grupoC: 'ACESSÓRIOS', qtd: 1, vt: 5 },
  ];
  const f = FE.calcular({ loja: { id: 'l1', nome: 'Loja 1', meta: 30000 }, vendas, metaPlanilha: null }, '2026-11-17');
  assert.strictEqual(f.clientes.omni, 1);
  assert.strictEqual(f.clientes.delivery, 0, 'cupom omnichannel com taxa delivery não conta duas vezes');
  assert.strictEqual(f.clientes.loja, 1);
  assert.strictEqual(f.clientes.total, 2);

  CL.definir('Sacola Kraft', 'fora', 'admin');
  const mudados = CL.aplicar(vendas);
  assert.strictEqual(mudados, 1);
  assert.strictEqual(vendas[2].grupoC, 'FORA DA META');
  assert.strictEqual(vendas[2].grupoOrig, 'ACESSÓRIOS');
});

test('cadastro, estoque e tabela: CPF com zero à esquerda, custo 4 casas, data US e preservação de .erro', async () => {
  const cli = CAD.lerClientes([
    ['Nome', 'Data Cadastro', 'Email', 'Aniversário', 'CPF', 'Loja', 'Saldo', 'Telefone', 'Cidade'],
    ['João Silva', '05/03/2026', 'j@teste.com', '12/08/1990', 123456789, 'L1', '1.250', '(62) 99999-1111', 'Goiânia'],
  ]);
  assert.strictEqual(cli.clientes[0].cpf, '00123456789');
  assert.strictEqual(cli.clientes[0].saldoFixe, 1250);

  const est = EST.ler([
    ['NextSoft - Estoque Atual ( 11/14/2026, 10:40 PM )'],
    ['Código', 'Descrição', 'Unidade', 'Quantidade', 'Custo Unitário'],
    ['80149', 'Saco 100G Kraft', 'Un', 25000, '1,2345'],
  ]);
  assert.strictEqual(est.em, '2026-11-14T22:40:00-03:00');
  assert.strictEqual(est.itens[0].qtd, 25);
  assert.strictEqual(est.itens[0].custo, 1.2345);

  const dirTab = path.join(C.pastaLoja('l1'), 'cadastro', 'entrada');
  fs.mkdirSync(dirTab, { recursive: true });
  const arqRuim = path.join(dirTab, '20261117_corrompido.xlsx');
  fs.writeFileSync(arqRuim, Buffer.from('nao-e-um-zip-valido'));
  await TAB.processar('l1');
  assert.strictEqual(fs.existsSync(arqRuim), false);
  assert.strictEqual(fs.existsSync(arqRuim + '.erro'), true, 'planilha inválida é preservada como .erro');

  assert.strictEqual(FXM.comApelido('loja@gmail.com', 'flamboyant'), 'loja+flamboyant@gmail.com');
});

test('frontend (core + fidelidade): chaveCupom segura p/ números grandes, hojeSP e validade fim de mês', () => {
  const ctx = { window: { fetch: async () => ({ ok: true, json: async () => ({}) }) }, location: { pathname: '/' }, Intl, Date, Math, Set, Map, Number, String, Object, Array, RegExp, isFinite, parseFloat, console };
  ctx.window.window = ctx.window;
  ctx.window.location = ctx.location;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/js/core.js'), 'utf8'), ctx);
  ctx.TS = ctx.window.TS;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/js/fidelidade.js'), 'utf8'), ctx);
  const { TS } = ctx.window;

  assert.match(TS.hojeSP(), /^\d{4}-\d{2}-\d{2}$/);

  let limpo = 0;
  TS.aoLimparCache(() => { limpo++; });
  TS.limparCaches();
  assert.strictEqual(limpo, 1);

  TS.rules = { ids: { taxas: new Set() } };
  TS.db = {
    n: 3,
    cupom: [123, 987654321012, 987654321012],
    loja: [0, 0, 1],
    day: [20000, 20000, 20000],
    min: [600, 600, 600],
    desc: [0, 0, 0],
    vt: [50, 50, 50],
    xml: [],
    D: { loja: ['L1', 'L2'], descricao: ['Chá'] },
    fidelidade: [{
      id: 'b1',
      regras: { validadeMeses: 1, minResgate: 6, prazoResgate: 90 },
      nomes: ['Ana'],
      lojas: ['L1'],
      propria: [true],
      vendaLoja: 'L1',
      ev: [
        ['11111111111', 0, 0, '2026-01-31', 600, 'pontos', 10, '', ''],
        ['11111111111', 0, 0, '2026-02-10', 700, 'saida', 3, '', ''],
      ],
    }],
  };
  assert.strictEqual(typeof TS.chaveCupom(0), 'number');
  assert.strictEqual(typeof TS.chaveCupom(1), 'string');
  assert.notStrictEqual(TS.chaveCupom(1), TS.chaveCupom(2), 'mesmo cupom grande em lojas diferentes não colide');

  const fx = TS.fx.preparar();
  const movGanho = fx.movs.find((m) => m.tipo === 'pontos');
  assert.strictEqual(TS.dayToIso(movGanho.vence), '2026-02-28', '31/01 + 1 mês vence em 28/02 e não em março');
  const ciclos = TS.fx.resgates(fx.movs, TS.isoToDay('2026-02-15'));
  assert.strictEqual(ciclos.length, 1, 'ciclo de elegibilidade calculado em TS.fx.resgates com movimento de saída');
});
