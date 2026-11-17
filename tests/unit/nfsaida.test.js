// NF-e de saída: leitura do XML e código de barras do DANFE
const { test } = require('node:test');
const assert = require('node:assert');
const N = require('../../src/nfsaida');

const CH = '52261100000000000191550010000000701000000708';
const XML = `<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe><infNFe Id="NFe${CH}"><ide><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod><serie>1</serie><nNF>70</nNF><dhEmi>2026-11-11T10:21:00-03:00</dhEmi><tpNF>1</tpNF><finNFe>1</finNFe></ide>
<emit><CNPJ>00000000000191</CNPJ><xNome>LOJA TESTE</xNome><enderEmit><xLgr>Rua A</xLgr><nro>1</nro><xMun>Goiania</xMun><UF>GO</UF></enderEmit></emit>
<dest><CNPJ>35455258000167</CNPJ><xNome>EMPRESA &amp; CIA</xNome><enderDest><xLgr>Av B</xLgr><nro>2</nro><xMun>Goiania</xMun><UF>GO</UF><CEP>74150030</CEP></enderDest></dest>
<det nItem="1"><prod><cProd>29114</cProd><xProd>African Sunset - Sache</xProd><NCM>09021000</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>25.0000</qCom><vUnCom>7.90</vUnCom><vProd>197.50</vProd></prod></det>
<det nItem="2"><prod><cProd>13116</cProd><xProd>Moruno - Sache</xProd><NCM>09021000</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>25.0000</qCom><vUnCom>7.90</vUnCom><vProd>197.50</vProd><vDesc>1.00</vDesc></prod></det>
<total><ICMSTot><vProd>395.00</vProd><vDesc>1.00</vDesc><vNF>394.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><nProt>152261144841274</nProt><dhRecbto>2026-11-11T10:21:30-03:00</dhRecbto><cStat>100</cStat></infProt></protNFe></nfeProc>`;

test('lê cabeçalho, destinatário, itens e totais da NF-e', () => {
  const n = N.lerXml(XML);
  assert.strictEqual(n.numero, 70);
  assert.strictEqual(n.data, '2026-11-11');
  assert.strictEqual(n.tipo, 'Saída');
  assert.deepStrictEqual([n.dest.nome, n.dest.doc, n.dest.tipoDoc], ['EMPRESA & CIA', '35455258000167', 'CNPJ']);
  assert.strictEqual(n.itens.length, 2);
  assert.deepStrictEqual(n.itens.map((i) => [i.cod, i.qtd, i.vUn, i.vDesc]), [['29114', 25, 7.9, 0], ['13116', 25, 7.9, 1]]);
  assert.strictEqual(n.total.vNF, 394);
  assert.strictEqual(n.protocolo, '152261144841274');
});

test('DANFE: Code 128-C da chave igual ao de uma biblioteca de referência', () => {
  const svg = N.code128c('52261112345678000199550010000000701000000708');
  let barras = '', pos = 10, m;
  const re = /x="(\d+)" y="0" width="(\d+)"/g;
  while ((m = re.exec(svg))) { const x = +m[1], w = +m[2]; barras += '0'.repeat(x - pos) + '1'.repeat(w); pos = x + w; }
  assert.strictEqual(barras, '1101001110011011100010111001001101100010010010110011100100010110001110001011011000010100110110011001100110110010111011110111010001101101100110011001000100110110011001101100110011011001100101100001001100100010011011001100110110011001001100010010001100100110110001101100011101011');
});

test('DANFE escapa texto da nota (sem HTML injetado)', () => {
  const n = { ...N.lerXml(XML), chave: CH, situacao: 'autorizada' };
  n.dest.nome = '<script>x</script>';
  const html = N.danfe(n);
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
