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
  Vão só números e avisos de **vendas** (nada de custo, estoque, franquia). Tela: uma linha discreta logo abaixo do cartão-herói do Início ("✨ Análise do dia: … ler ›", redesenho de 22/11/2026) + aba "Análise do dia" no ✨
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
- Análise do dia só com os dados **atuais** do servidor (espera sair do cache do aparelho, `TS.dadosGuardados`); resultado `null` não fica guardado (chave cadastrada depois vale na hora). Conversa do ✨: acima de 60 mensagens pede nova conversa; a 10ª rodada fecha com uma resposta (a conversa nunca termina em `tool_result`).
- A análise do dia guarda quem gerou (`por`) e a tela mostra "Feita às HH:MM por X".
- **Ligar/desligar a IA por loja** (Configurações → loja → Inteligência artificial; admin e franqueado): desligar guarda a chave (`desligada: true` em `config/ia.json`) e bloqueia todo uso (`IA.chaveAtiva`; `mensagens` devolve 409 "IA desligada"); `/api/ia/estado` responde `ativa: false, desligada: true`. Chave nova entra ligada. Auditado.

- **Homologação** (`PAINEL_AMBIENTE=homologacao`, HOMOLOG-01, `docs/homologacao.md`): ali nada sai do painel — o servidor recusa por `C.travaHomolog` (e `ativo()` do coletor e do robô dá falso). Saída nova desta parte passa pela mesma trava e ganha linha em `tests/unit/homolog.test.js`.
