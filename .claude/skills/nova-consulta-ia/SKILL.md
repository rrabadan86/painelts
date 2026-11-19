---
name: nova-consulta-ia
description: Como ensinar uma consulta nova ao ✨ Pergunte ao painel (ferramenta da IA) — definição em src/iaprompts.js, execução no navegador em public/js/ia.js, permissão por perfil, resposta simulada da apresentação e testes.
---
# Consulta nova para o ✨ Pergunte ao painel

As consultas rodam **no navegador**, sobre os dados que a pessoa já vê. O servidor só decide quais ferramentas oferecer.

1. **Definir a ferramenta** em `ferramentas({ clientes, custos })` de `src/iaprompts.js`:
   - `name` em snake_case português (`consultar_<coisa>`), `description` dizendo o que devolve, em que unidade, e o que **não** devolve;
   - `input_schema` com `enum`, `minimum`/`maximum` e `limite` (os resultados vão para a IA: devolva resumos, não listas enormes);
   - reaproveite `PERIODO` e `FILTROS`;
   - se envolve custo/margem/estoque → só dentro de `if (custos)`; clientes → só dentro de `if (clientes)`.
2. **Executar no navegador** em `public/js/ia.js`:
   - função `consultar<Coisa>(inp, ...)` que lê os dados já carregados (`TS.db`, `TS.custosLoja()`, etc.) e devolve um objeto pequeno;
   - ligue em `executar(...)` conferindo `pode` de novo (`if (nome === 'consultar_x' && pode.custos) ...`);
   - texto do passo em `PASSO` ("consultando o …").
   - Clientes: só primeiro nome + inicial, nunca CPF, telefone, e-mail.
3. **Instruções:** se a IA precisa de uma regra para usar bem a consulta, uma linha em `sistemaPergunta` (curta: vai em toda conversa, com cache).
4. **Apresentação/testes:** `simular` em `src/ia.js` responde sem a Anthropic. Só mexa se o teste de tela precisar ver a consulta nova sendo chamada.
5. **Testes:**
   - `tests/unit/ia.test.js`: a ferramenta aparece/some conforme o perfil (`IAP.ferramentas({ clientes, custos })`).
   - `node --test tests/unit/ia.test.js` e `npx playwright test tests/e2e/ia.spec.js`.
6. A IA só consulta: nunca crie ferramenta que grave ou envie algo.
