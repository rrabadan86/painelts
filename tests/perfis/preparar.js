'use strict';
/**
 * Prepara o painel DE VERDADE (não a apresentação) para os testes de tela por perfil (playwright.perfis.config.js):
 * apaga e recria a pasta de dados temporária com duas lojas, as vendas e o estoque fictícios da apresentação
 * (src/demo.js, nada real) gravados no formato que o servidor lê, e um usuário de cada perfil. A senha é criada aqui
 * (hashSenhaAsync) e só vale nesta pasta temporária. Roda antes de `node server.js`, com DATA_DIR e CONFIG_FILE do teste.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR, CONFIG_FILE = process.env.CONFIG_FILE;
if (!DATA_DIR || !CONFIG_FILE || process.env.NODE_ENV !== 'test') { console.error('preparar.js: só roda nos testes (NODE_ENV=test, DATA_DIR e CONFIG_FILE)'); process.exit(1); }
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const C = require('../../src/config');
const B = require('../../src/base');
const D = require('../../src/demo');
const SENHA = 'senha-perfis-123';

(async () => {
  const parte = D.partes()[0]; // a loja fictícia "Tea Shop Centro"
  const vendas = parte.vendas;
  // a vendedora que mais vendeu no mês: ela é a "vend"; as outras são as colegas que ela nunca pode ver
  const ym = vendas[vendas.length - 1].data.slice(0, 7), conta = new Map();
  for (const v of vendas) if (v.data.startsWith(ym) && v.vendedor) conta.set(v.vendedor, (conta.get(v.vendedor) || 0) + 1);
  const vendedoras = [...conta].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  B.substituirTudo('l1', vendas, { origem: 'teste de perfis' });
  const est = D.estoqueDemo(D.LOJAS[0].id);
  fs.mkdirSync(path.join(C.pastaLoja('l1'), 'estoque'), { recursive: true });
  C.gravarAtomico(path.join(C.pastaLoja('l1'), 'estoque', 'atual.json'), JSON.stringify(est.estoque), 0o640);
  fs.mkdirSync(C.pastaLoja('l2'), { recursive: true });

  const senha = await C.hashSenhaAsync(SENHA);
  const u = (perfil, extra) => ({ senha, perfil, lojas: ['l1'], ativo: true, telasV: 8, ...extra });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    lojas: [
      { id: 'l1', nome: 'Loja Teste Centro', meta: parte.loja.meta, operacao: parte.loja.operacao },
      { id: 'l2', nome: 'Loja de Outro Franqueado' },
    ],
    usuarios: {
      dono: u('franqueado', { nome: 'Dona Teste' }),
      ger_custo: u('gerente', { nome: 'Gerente Com Custo', telas: ['resumo', 'comparativos', 'estoque', 'validade', 'inventario', 'sugestoes', 'espera', 'mapa', 'checklist'] }),
      ger_sem: u('gerente', { nome: 'Gerente Sem Custo', telas: ['resumo', 'validade', 'inventario', 'sugestoes', 'espera', 'checklist'] }),
      vend: u('vendedor', { nome: 'Vendedora Teste', vendedor: vendedoras[0] }),
    },
  }, null, 1));
  // o que os testes precisam saber (sem senha guardada em lugar nenhum além do lojas.json temporário)
  fs.writeFileSync(path.join(DATA_DIR, 'perfis.json'), JSON.stringify({ vendedora: vendedoras[0], colegas: vendedoras.slice(1) }));
  console.log(`[perfis] pronto: ${vendas.length} vendas, ${est.estoque.itens.length} itens de estoque, vendedora ${vendedoras[0]}`);
})().catch((e) => { console.error(e); process.exit(1); });
