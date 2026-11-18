'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-'));
process.env.DATA_DIR = tmp;
const DEV = require('../../src/devolucao');

// JPEG mínimo válido o bastante para o teste (começa com FF D8 e tem mais de 1 KB)
const jpg = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000, 1)]).toString('base64');
const nota = { id: 'n1', nf: 18574, serie: 1, emissao: '2026-08-29', entrada: '2026-08-31', fornecedor: 'TSB', total: 100, itens: [{ cod: '406', nome: 'Top Tea', un: 'UN', qtd: 10, vu: 12.5 }, { cod: '11106CX', nome: 'Pu Erh', un: 'UN', qtd: 6, vu: 30 }] };

test('devolução: valida itens, fotos e destinatários', async () => {
  assert.match(DEV.criar('lj', nota, { itens: [{ cod: '406', tipo: 'danificado', qtd: 2, fotos: [] }] }, 'g').erro, /foto/);
  assert.match(DEV.criar('lj', nota, { itens: [{ cod: '406', tipo: 'faltou', qtd: 11 }] }, 'g').erro, /passa/);
  assert.match(DEV.criar('lj', nota, { itens: [{ cod: '11106CX', qtdDanificado: 2, qtdFaltou: 5, fotos: [jpg] }] }, 'g').erro, /passa/);
  const sp = DEV.criar('lj', nota, { itens: [{ cod: '11106CX', qtdDanificado: 2, qtdFaltou: 4, obs: 'quebrado', fotos: [jpg] }] }, 'g').ok;
  assert.deepEqual(sp.itens.map((i) => [i.tipo, i.qtd, i.fotos]), [['danificado', 2, 1], ['faltou', 4, 0]]);
  assert.match(DEV.criar('lj', nota, { itens: [{ cod: '999', tipo: 'faltou', qtd: 1 }] }, 'g').erro, /não está/);
  assert.match(DEV.criar('lj', nota, { itens: [{ cod: '406', tipo: 'danificado', qtd: 1, fotos: ['data:image/png;base64,AAAA'] }] }, 'g').erro, /foto/);
  const d = DEV.criar('lj', nota, { itens: [{ cod: '406', tipo: 'danificado', qtd: 2, obs: 'vencida', fotos: [jpg, jpg] }, { cod: '11106CX', tipo: 'faltou', qtd: 1 }] }, 'g').ok;
  assert.equal(d.itens[0].fotos, 2);
  assert.equal(d.total, 55);
  assert.ok(fs.existsSync(DEV.arqFoto('lj', d.id, 0, 1)));
  assert.equal(DEV.arqFoto('lj', '../x', 0, 0), null);
  assert.equal(DEV.lista('lj').length, 2);
  assert.match(DEV.salvarDestinatarios('lj', ['ok@x.com', 'ruim']).erro, /inválido/);
  assert.deepEqual(DEV.salvarDestinatarios('lj', ['A@X.com', 'a@x.com']).ok, ['a@x.com']);
  assert.match(DEV.textoEmail(d, 'Loja'), /não chegaram/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('robô de devolução: preenche e preserva modalidadeDeterminacaoBcIcmsId válido mesmo sem modalidade na regra fiscal', async () => {
  const vm = require('node:vm');
  const py = fs.readFileSync(path.join(__dirname, '../../coletor/nextsoft_nfe.py'), 'utf8');
  const mBase = py.match(/JS_BASE = """([\s\S]*?)"""/);
  const mDev = py.match(/DEVOLVER = "async \(p\) => \{" \+ JS_BASE\.replace\("acha\('salvarRascunho'\)", "acha\('montarDevolucao'\)"\) \+ """([\s\S]*?)"""/);
  assert.ok(mBase && mDev, 'trecho DEVOLVER deve existir em nextsoft_nfe.py');
  const unesc = (s) => s.replace(/\\\\/g, '\\');
  const src = 'async (p) => {' + unesc(mBase[1]).replace("acha('salvarRascunho')", "acha('montarDevolucao')") + unesc(mDev[1]);

  const MOD3_ID = '33333333-4444-5555-6666-777777777777';
  const LOJA_ID = '10000000-0000-0000-0000-000000000001';
  const PARC_ID = '20000000-0000-0000-0000-000000000002';
  const END_ID = '30000000-0000-0000-0000-000000000003';
  const MOT_ID = '40000000-0000-0000-0000-000000000019';
  const CFOP_ID = '50000000-0000-0000-0000-000000006202';
  const SER_ID = '60000000-0000-0000-0000-000000000001';
  const FIN4_ID = '70000000-0000-0000-0000-000000000004';
  const TF9_ID = '80000000-0000-0000-0000-000000000009';
  const MF9_ID = '90000000-0000-0000-0000-000000000009';
  const PROD_ID = 'a1000000-0000-0000-0000-000000080149';
  const ICMS_ID = 'b1000000-0000-0000-0000-000000000001';
  const ORIG_ID = 'b2000000-0000-0000-0000-000000000001';
  const PIS_ID = 'b3000000-0000-0000-0000-000000000001';
  const COF_ID = 'b4000000-0000-0000-0000-000000000001';
  const IPI_ID = 'b5000000-0000-0000-0000-000000000001';
  const SEQ_ID = 'c1000000-0000-0000-0000-000000000001';

  const seqObj = {
    id: SEQ_ID, motivoMovimentacao: { id: MOT_ID, codigo: '19' }, cfop: { id: CFOP_ID, codigo: '6202' },
    icms: { id: ICMS_ID }, origemMercadoria: { id: ORIG_ID }, pis: { id: PIS_ID }, cofins: { id: COF_ID }, ipi: { id: IPI_ID },
    modalidadeDeterminacaoBcIcms: null, produtosLoja: [{ id: PROD_ID }],
  };
  const saida = {
    revisado: false, modeloNFe: '55', serie: '', numeroNota: '', chaveAcesso: '32261023729370000160550010000190841885739322',
    motivoMovimentacaoId: null, dataEmissao: '2026-10-15', formaPagamentoId: null, cfopId: null, lojaId: LOJA_ID,
    parceiroId: PARC_ID, enderecoId: null, usuarioConclusaoId: LOJA_ID, tipoFreteId: null, modalidadeFreteId: null,
    finalidadeId: null, tipoFinalidadeId: null, valorTotalProduto: 300, valorTotalLiquido: 321,
    itens: [
      { produtoId: 'a9999999-0000-0000-0000-000000099999', codigo: '99999', nome: 'Outro', quantidade: 5, valorUnitario: 10, imposto: {} },
      {
        produtoId: PROD_ID, codigo: '80149', nome: 'Saco 100G Kraft', quantidade: 300, valorUnitario: 1, valorTotalBruto: 300, valorTotalLiquido: 300,
        sequenciaFiscalId: seqObj, itemImposto: { ModalidadeDeterminacaoBcIcmsCodigo: '3' },
        imposto: { cfopId: 'e1000000-0000-0000-0000-000000002102', cestId: '', modalidadeDeterminacaoBcIcmsId: null, modalidadeDeterminacaoBcIcmsStId: '00000000-0000-0000-0000-000000000000' },
      },
    ],
  };
  const dadosNota = {};
  const forn = { carregandoEnderecos: false, enderecosParceiro: [{ id: END_ID, padrao: false }], $options: { methods: { carregarEnderecosParceiro() {} } }, $children: [] };
  const facilitador = { selectList: { modalidadesDeterminacaoBcICMS: [] }, $options: { methods: { onSubmitProduct() {} } }, $children: [] };
  const tela = {
    lojaAtual: { id: LOJA_ID }, saida,
    selectList: {
      motivosMovimentacao: [{ id: MOT_ID, codigo: '19' }], sequenciasFiscais: [seqObj],
      serieNfe: [{ id: SER_ID, descricao: 'NF-e', serie: 1, modelo: '55', proximoNumero: 71 }],
      finalidades: [{ id: FIN4_ID, codigo: 4 }], tiposFrete: [{ id: TF9_ID, codigo: '9' }], modalidadesFrete: [{ id: MF9_ID, codigo: '9' }], cfops: [],
    },
    $refs: { tabs: { $refs: { dadosNota }, validarDadosNota: () => false, validarDadosFornecedor: () => false, validarProdutos: () => false, validarTransportadora: () => false, validarValoresAdicionais: () => false } },
    $set(o, k, v) {
      o[k] = v;
      if (o === saida && k === 'cfopId' && v) {
        saida.itens.forEach((it) => {
          it.produtosSequencia = seqObj; it.sequenciaFiscalId = seqObj.id;
          Promise.resolve().then(() => {
            it.valorTotalLiquido = 1.07;
            it.imposto = { cfopId: CFOP_ID, icmsId: ICMS_ID, icmsOrigemId: ORIG_ID, pisId: PIS_ID, cofinsId: COF_ID, ipiId: IPI_ID, modalidadeDeterminacaoBcIcmsId: null, modalidadeDeterminacaoBcIcmsStId: '00000000-0000-0000-0000-000000000000', cestId: '' };
          });
        });
      }
    },
    async getRequest() { return [{ id: MOD3_ID, codigo: 3, descricao: 'Valor da operação' }]; },
    buscarSequenciafiscalPorMotivoMovimentacao: () => [seqObj.cfop],
    async CalculaValoresTotaisMovimento(pl) {
      saida.valorTotalProduto = 1; saida.valorTotalLiquido = 1.07;
      saida.itens.forEach((it, i) => { it.imposto = { ...pl.itens[i].imposto, modalidadeDeterminacaoBcIcmsId: null }; });
    },
    $options: { methods: { montarDevolucao() {} } }, $children: [forn, facilitador],
  };
  const ctx = { window: {}, document: { querySelectorAll: () => [{ __vue__: { $root: tela } }] }, setTimeout: (fn) => setImmediate(fn), Math, Number, String, Array, Object, Map, Set, Date, RegExp, JSON, Error, Promise };
  const fn = vm.runInNewContext('(' + src + ')', ctx);
  const r = await fn({ itens: [{ codigo: '80149', qtd: 1 }] });
  ctx.window.__limparIds();
  assert.deepEqual(r.idsFaltando, []);
  assert.equal(saida.itens.length, 1);
  assert.equal(saida.itens[0].imposto.modalidadeDeterminacaoBcIcmsId, MOD3_ID);
  assert.equal(saida.itens[0].imposto.modalidadeDeterminacaoBcIcmsStId, null);
  assert.equal(saida.itens[0].imposto.cestId, null);
  assert.equal(saida.serie, '1');
  assert.equal(saida.numeroNota, '71');
  assert.equal(saida.finalidadeId, FIN4_ID);
  assert.equal(saida.usuarioConclusaoId, null);
});

