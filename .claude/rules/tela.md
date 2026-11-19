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
- Explicação de coluna: `title` na coluna do `TS.table` vira um ⓘ tocável no cabeçalho (computador) e no rótulo do cartão (celular). Toda coluna que precisa de explicação ganha `title` com texto simples (o que é, de onde vem, o que as cores/etiquetas querem dizer). Em cartão, use `TS.dica(texto)`.
- Campo que redesenha a tela ao mudar (hora, data, número): use `TS.aoConfirmar(campo, fn)` (aplica ao sair do campo, não a cada dígito). Ele acompanha o foco pelos eventos focus/blur: no campo de hora o Chrome dispara `change` a cada parte (hora, minuto).
- Celular: tabela com 5+ colunas vira cartão (grade de 2 colunas que encolhem). Nada pode passar da borda do cartão: o teste `tests/e2e/telas.spec.js` confere em todas as telas. Tabela dentro de cartão (ex.: conta por pacote) continua tabela.
- Mudou algo visível: confira no celular (390 px) — skill `conferir-celular`. Tela nova: skill `nova-tela`.
- Testes de tela (`tests/e2e`) rodam sempre na apresentação, nos projetos "computador" e "celular".
- ⭐ Sugestões para o pedido (`public/js/sugestoes.js` + `src/sugestoes.js`): tela da equipe em tabela (`TS.table`, abas Esperando o pedido / Aguardando entrega / Encerradas) e quadro "⭐ Sugestões da equipe" no Pedido. Com estoque na loja exige justificativa (chá a granel < 700 g não). Ao montar o carrinho (ou "Registrar o pedido nas sugestões"): no pedido → aguardando entrega; a estrela só sai quando a nota da TSB FRANQUIAS (emitida a partir do pedido; janela de 5 dias pela data de entrada da primeira nota; chegada atrasada também vale) traz o produto; sem ele, recusa do site ou sem estoque no site → volta para o próximo pedido. Histórico guardado. Apresentação: `/api/demo/sugestoes` + mudanças só no navegador. Testes: `tests/unit/sugestoes.test.js`, `tests/e2e/sugestoes.spec.js`.
- Fora de linha (Estoque): `src/pedido.js` guarda desde quando cada produto está indisponível no catálogo do Sistema de Pedidos (`pedido/disponibilidade.json`, a cada hora e ao abrir o Estoque); com 90+ dias vira "Fora de linha · liquidar" e sai de repor/parados. Só conta produto que já apareceu no catálogo.
- Telas por perfil: o menu (`main.js`) e Configurações → Usuários seguem a lista única `src/telas.js` (grupo, regra por perfil, padrão do gerente). Página nova (`TS.pages.x`) ou rótulo novo em `ROTULO` sem entrar lá derruba `tests/unit/telas.test.js`.
- Cache do aparelho: `/api/dados` manda `X-Painel-Usuario`; se não for a pessoa da aba (outra pessoa entrou em outra aba), o painel não guarda nem mostra e recarrega.
- Perguntas e avisos: `TS.perguntar` / `TS.avisar` / `TS.avisarErro` (components.js), nunca `prompt()`/`alert()` em fluxo novo. Tela sem filtros entra em `pg-semfiltros` (main.js). Aviso do Início que se repete ganha `id` para o "lembrar depois" (7 dias, por pessoa; aviso vermelho nunca é adiado).
- A vendedora recebe do servidor as listas das regras de comissão já traduzidas (`src/regrasvend.js`), mesmo sem regras salvas.
