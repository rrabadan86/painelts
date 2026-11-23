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
  const sp = DEV.criar('lj', nota, { itens: [{ cod: '11106CX', qtdDanificado: 2, qtdFaltou: 3, obs: 'quebrado', fotos: [jpg] }] }, 'g').ok; // sobra 1 na nota para a próxima devolução
  assert.deepEqual(sp.itens.map((i) => [i.tipo, i.qtd, i.fotos]), [['danificado', 2, 1], ['faltou', 3, 0]]);
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

test('devolução: exclusão limpa registro/fila, NF-e cancelada libera saldo e NFS.lista expõe refs', () => {
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dev2-'));
  const C = require('../../src/config');
  const origPasta = C.pastaLoja;
  C.pastaLoja = (id) => path.join(tmp2, id);
  try {
    const NFS = require('../../src/nfsaida');
    const nEntrada = { id: '11111111-2222-3333-4444-555555555555', nf: 19084, serie: 1, chave: '32261023729370000160550010000190841885739322', emissao: '2026-10-15', entrada: '2026-10-20', fornecedor: 'TSB', total: 30, itens: [{ cod: '80149', nome: 'Saco Kraft', un: 'UN', qtd: 3, vu: 10 }] };
    const r1 = DEV.criar('lj2', nEntrada, { itens: [{ cod: '80149', tipo: 'faltou', qtd: 3 }] }, 'admin').ok;
    DEV.atualizar('lj2', r1.id, (x) => { x.nfe = { estado: 'ok', situacao: 'autorizada' }; });
    assert.match(DEV.criar('lj2', nEntrada, { itens: [{ cod: '80149', tipo: 'faltou', qtd: 1 }] }, 'admin').erro, /já devolvidos/);
    // se a NF-e de devolução foi cancelada no AppNext, o item volta a ficar disponível
    DEV.atualizar('lj2', r1.id, (x) => { x.nfe = { estado: 'ok', situacao: 'cancelada' }; });
    const r2 = DEV.criar('lj2', nEntrada, { itens: [{ cod: '80149', tipo: 'faltou', qtd: 2 }] }, 'admin');
    assert.ok(r2.ok, 'NF-e cancelada não deve bloquear nova devolução');
    // exclusão remove pasta da devolução e arquivos da fila de NF-e
    DEV.pedirNfe('lj2', r2.ok, true);
    assert.ok(fs.existsSync(path.join(tmp2, 'lj2', 'nfe', 'envio', r2.ok.id + '.json')));
    assert.equal(DEV.excluir('lj2', '../invalido'), null);
    const exc = DEV.excluir('lj2', r2.ok.id);
    assert.equal(exc.id, r2.ok.id);
    assert.equal(DEV.ler('lj2', r2.ok.id), null);
    assert.ok(!fs.existsSync(path.join(tmp2, 'lj2', 'nfe', 'envio', r2.ok.id + '.json')));

    // NFS.lista inclui as chaves referenciadas (<refNFe>) no cabeçalho
    const dirXml = path.join(tmp2, 'lj2', 'xmls', '2026-11', 'ativos');
    fs.mkdirSync(dirXml, { recursive: true });
    const chaveSaida = '52261100000000000191550010000000791100000790';
    fs.writeFileSync(path.join(dirXml, '20261118_' + chaveSaida + '.xml'), `<nfeProc><NFe><infNFe><ide><nNF>79</nNF><serie>1</serie><mod>55</mod><dhEmi>2026-11-18T10:00:00-03:00</dhEmi><natOp>Devolução</natOp><tpNF>1</tpNF><finNFe>4</finNFe><NFref><refNFe>${nEntrada.chave}</refNFe></NFref></ide><emit><xNome>Loja</xNome><CNPJ>00000000000191</CNPJ></emit><dest><xNome>TSB</xNome><CNPJ>23729370000160</CNPJ></dest><det nItem="1"><prod><cProd>80149</cProd><xProd>Saco</xProd><CFOP>6202</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>10</vUnCom><vProd>10</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF><vProd>10.00</vProd></ICMSTot></total></infNFe></NFe></nfeProc>`);
    const ls = NFS.lista('lj2');
    assert.equal(ls.notas.length, 1);
    assert.deepEqual(ls.notas[0].refs, [nEntrada.chave]);
  } finally {
    C.pastaLoja = origPasta;
    fs.rmSync(tmp2, { recursive: true, force: true });
  }
});



test('devolução: emitir só depois de um teste com total (até 2 horas)', () => {
  const nota2 = { ...nota, id: '11111111-2222-3333-4444-555555555555' };
  const d = DEV.criar('le', nota2, { itens: [{ cod: '406', tipo: 'faltou', qtd: 1 }] }, 'g').ok;
  assert.match(DEV.pedirNfe('le', d, false, true).erro, /teste/);
  DEV.atualizar('le', d.id, (x) => { x.nfe = { estado: 'teste', total: 12.5, em: new Date().toISOString(), fim: new Date().toISOString() }; });
  const r = DEV.pedirNfe('le', DEV.ler('le', d.id), false, true).ok;
  assert.deepEqual([r.nfe.estado, r.nfe.emitir], ['na_fila', true]);
  const dir = path.join(tmp, 'le', 'nfe', 'envio');
  const pedido = JSON.parse(fs.readFileSync(path.join(dir, d.id + '.json'), 'utf8'));
  assert.deepEqual([pedido.emitir, pedido.simular, pedido.totalTeste], [true, false, 12.5]);
  fs.writeFileSync(path.join(dir, d.id + '.resultado.json'), JSON.stringify({ ok: true, emitida: true, em: new Date(Date.now() + 1000).toISOString(), nota: { total: 12.5 }, nfe: { numero: 75, chave: 'x', protocolo: 'p' } }));
  const c = DEV.conferirNfe('le', DEV.ler('le', d.id));
  assert.deepEqual([c.nfe.estado, c.nfe.emitida.numero], ['ok', 75]);
});

test('DEV-VAL-01: validade curta entra na devolução que já existe — sem foto, com o motivo, na planilha e no e-mail', async () => {
  const n = { ...nota, id: 'n-val' };
  const d = DEV.criar('lval', n, { itens: [{ cod: '406', qtdValidade: 4, obsValidade: 'validade curta (vence 10/09/2026)' }] }, 'g').ok;
  assert.deepEqual(d.itens.map((i) => [i.tipo, i.qtd, i.fotos, i.obs]), [['validade', 4, 0, 'validade curta (vence 10/09/2026)']]);
  assert.match(DEV.criar('lval', n, { itens: [{ cod: '406', qtdValidade: 7 }] }, 'g').erro, /já devolvidos/, 'a soma com as outras devoluções da nota não passa');
  assert.equal(DEV.criar('lval', n, { itens: [{ cod: '406', tipo: 'validade', qtd: 1 }] }, 'g').ok.itens[0].obs, 'validade curta');
  assert.match(DEV.textoEmail(d, 'Loja X'), /validade curta:\n• 406 · Top Tea · 4 UN — validade curta \(vence 10\/09\/2026\)/);
  const buf = await DEV.planilha('lval', d, 'Loja X');
  const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const txt = []; wb.worksheets[0].eachRow((r) => txt.push(r.values.filter(Boolean).join(' | ')));
  assert.ok(txt.some((t) => /Itens que chegaram com validade curta/.test(t)));
  assert.ok(txt.some((t) => /406 \| 4 \| Top Tea \| validade curta \(vence 10\/09\/2026\)/.test(t)));
});
