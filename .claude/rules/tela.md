---
paths:
  - "public/**"
  - "tests/e2e/**"
---
# Tela (public/js)

- JavaScript puro, tudo no namespace `TS`: `TS.h()` monta elementos, `TS.table`, `TS.kpi`, `TS.seg`, `TS.chart`, `TS.api`
  (este já sabe se está na apresentação; `TS.demo` diz se é apresentação).
- Script novo precisa entrar em `APP_SCRIPTS` no `server.js` (a ordem importa: `core.js` primeiro, `main.js` por último).
- O versionamento dos arquivos (`?v=`) é automático: não mexa.
- `replaceChildren(...)` com `null` escreve "null" na tela: sempre `[...].filter(Boolean)`.
- Esconder na tela não é permissão: o servidor também precisa negar (custo/margem nunca para vendedora; clientes não vão para vendedora).
- Textos simples e diretos, em português; nada de termos técnicos para a vendedora.
- Toda tela funciona na apresentação (`/apresentacao`, dados fictícios, nada gravado nem enviado).
- `TS.table` pagina sozinho: no computador, tabela com mais de 150 linhas mostra 100 por página; no celular, cartões de 40 em 40 (a busca e a ordenação valem para todas as linhas; a impressão sai completa). Isso evita travar a troca de tela.
- Dados guardados no aparelho (`Guardados` em `main.js`, IndexedDB `teashop-painel`): o painel abre na hora com a última resposta de `/api/dados` e o servidor confere em seguida (304). Guarda só o que o servidor já entrega àquela pessoa, uma versão por pessoa e loja; apaga ao Sair, na tela de entrar (`login.js`), quando outra pessoa entra e após 7 dias. Outros dados de cliente não vão para `localStorage`/IndexedDB sem essas mesmas regras. Teste: `tests/e2e/guardados.spec.js`.
- Erro de rede ("Failed to fetch" quando o celular pausa a página ao trocar de aba ou a internet cai): use `TS.erroDeRede(e)` e `TS.esperarVisivel()` (core.js) para tentar de novo quando a página voltar; nunca mostre o texto do navegador, só mensagem em português.
- Celular: tabela com 5+ colunas vira cartão (grade de 2 colunas que encolhem). Nada pode passar da borda do cartão: o teste `tests/e2e/telas.spec.js` confere em todas as telas. Tabela dentro de cartão (ex.: conta por pacote) continua tabela.
- Mudou algo visível: confira no celular (390 px) — skill `conferir-celular`. Tela nova: skill `nova-tela`.
- Testes de tela (`tests/e2e`) rodam sempre na apresentação, nos projetos "computador" e "celular".
