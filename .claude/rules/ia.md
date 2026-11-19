---
paths:
  - "src/ia.js"
  - "src/iaprompts.js"
  - "src/iaconversas.js"
  - "public/js/ia.js"
  - "public/js/inicio.js"
  - "tests/unit/ia.test.js"
  - "tests/e2e/ia.spec.js"
---
# IA (✨ Pergunte ao painel, diagnóstico do Início, revisão do pedido)

- `src/ia.js`: chave da Anthropic **por loja**, criptografada (`config/ia.json` + `config/ia-mestra.key`, nunca no Git); teto e uso por mês.
  A chave nunca volta para a tela (só os 4 últimos caracteres) e o Claude nunca a digita nem pede no chat.
- `src/iaprompts.js`: instruções (`sistemaPergunta`, `SISTEMA_DIAG`, `SISTEMA_PEDIDO`), ferramentas (`ferramentas({ clientes, custos })`)
  e `conferirMensagens` (do navegador só sai texto e `tool_result`).
- `src/iaconversas.js`: histórico por pessoa e por loja (sem a lista de clientes).
- **Análise do dia** (Início): **uma por loja por dia**, a mesma para admin e franqueado. `POST /api/ia/diagnostico` guarda em
  `dados/<loja>/ia/diag-AAAA-MM-DD-loja.json` com `IA.umaVez` (quem abre depois lê a guardada; duas pessoas juntas não pagam duas vezes).
  Vão só números e avisos de **vendas** (nada de custo, estoque, franquia). Tela: faixa no topo do Início + aba "Análise do dia" no ✨
  (`TS.iaAnaliseDia()` em `inicio.js`), pontinho no ✨ até ler (`TS.iaAnaliseLida`, por aparelho).
- Modelos novos da Anthropic **recusam forçar ferramenta** (`tool_choice` `tool`/`any` dá 400): use `IA.comFerramenta` (vai com `auto` e pede de novo se vier só texto).
- `public/js/ia.js`: as consultas **rodam no navegador** sobre os dados que o perfil já vê (`executar(nome, inp, pode, resp)`).
  O que o perfil não pode ver não existe ali, então também não vai para a IA.
- **Margem ao longo do tempo / custo de compra:** `consultar_compras` (só com `custos`) lê as **notas de entrada** (`compras.itens` do estoque) × preço de tabela atual do AppNext, mês a mês, e lista o que não teve compra no período. Não usa as vendas. `consultar_vendas` com `incluir_lucro` é a margem do que foi vendido.
- Erro de rede ("Failed to fetch": celular pausou a página ao trocar de aba, internet caiu): `iaApi` e `carregar` esperam a página voltar (`TS.esperarVisivel`) e tentam uma vez; se falhar, mensagem em português, nunca o texto do navegador.

## Regras
- **Quem usa a IA: só admin e franqueado** (✨, análise do Início, revisão do pedido). Gerente e vendedora não veem nem usam: `IA.podeUsar` no servidor e a mesma lista na tela.
- Permissão em dois lugares: o servidor só oferece a ferramenta se o perfil pode (`clientes`, `custos`) **e** `executar` confere `pode` de novo.
- Vendedora: sem custo/margem/estoque e sem dados de clientes. Clientes: só primeiro nome + inicial, nunca CPF, telefone ou e-mail.
- A IA só consulta: nada de ferramenta que grave.
- Na apresentação e nos testes (`IA_FALSO=1`) a resposta é simulada (`simular` em `src/ia.js`, rotas `/api/demo/ia/...`): nada vai para a Anthropic.
- Modelo (`MODELO()`) e preço por milhão de tokens (`PRECO()`, `IA_PRECO_ENTRADA`/`IA_PRECO_SAIDA`) ficam em `src/ia.js`: o uso e o teto do mês dependem deles.
- Consulta nova para o ✨: siga a skill `nova-consulta-ia`.
- Testes: `node --test tests/unit/ia.test.js` e `npx playwright test tests/e2e/ia.spec.js`.
