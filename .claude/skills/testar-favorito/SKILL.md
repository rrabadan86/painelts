---
name: testar-favorito
description: Testa o favorito "Carrinho Tea Shop" (public/js/carrinho-site.js) e o robô do Sistema de Pedidos (coletor/nextsoft_pedido.py) em páginas de mentira que imitam o site da franquia — venda conjunta (mug + infusor), aviso de estoque, máximo por pedido, "sem confirmação". Use ao mexer no favorito ou no robô, e quando o dono mandar o "Diagnóstico" de um item que falhou no site real.
---
# Testar o favorito e o robô do Sistema de Pedidos

**Nunca abra o Sistema de Pedidos de verdade** (login é do dono; o favorito e o robô nunca finalizam pedido). Tudo aqui roda em páginas de mentira, com as funções reais tiradas dos arquivos.

1. **Ler o que o site mostrou.** Se o dono mandou o print da linha "Diagnóstico: …" (vem em todo item "sem confirmação"), anote:
   janelas abertas e o `display` de cada uma, o tipo do botão "Colocar Todos" (`a`, `button`, `input`, `div`…) e se havia o texto "Venda Conjunta".
   Sem diagnóstico, peça ao dono: testar **um** produto só e mandar o print da linha.
2. **Reproduzir numa página de mentira** em `tests/e2e/carrinho-conjunta.spec.js` (é o modelo): monte o HTML como o diagnóstico descreve
   (`janela(botao, estilo)`), dentro do **mesmo quadro invisível** do favorito (iframe fora da tela, `visibility:hidden`). O teste tira as funções
   do arquivo entre `const RE_TODOS =` e `const ajustar = (qtd, c) =>` — se mexer nesse trecho, mantenha os dois marcadores.
   - Confirme que o teste **falha** antes da correção (é a prova de que reproduziu o caso real).
3. **Corrigir nos dois lados:** `vendaConjunta`/`clicar`/`seguirLink`/`avisoDoSite`/`diagnostico` em `carrinho-site.js` e `venda_conjunta` em
   `nextsoft_pedido.py` usam a mesma regra (texto exato do botão, janela fechada = algum pai com `display:none`). Ajuste os dois juntos.
4. **Rodar:**
   ```bash
   npx playwright test tests/e2e/carrinho-conjunta.spec.js tests/e2e/carrinho-salvo.spec.js --project computador
   node --test tests/unit/carrinho-salvo.test.js
   ```
   O `carrinho-salvo.test` confere também que nenhum dos dois clica em finalizar/fechar pedido — nunca afrouxe essa checagem.
5. **Contar ao dono:** o que o diagnóstico mostrou, o que mudou, que foi testado só em página de mentira, e pedir um teste com **uma** mug no
   site real (mandar o "Diagnóstico" de novo se falhar). Registre o caso na linha EST-PED-CONJ da `docs/rastreabilidade.md`.

Aviso de estoque (janela "Atenção" fora do `.modal`, atrasada, de outro produto): `carrinho-conjunta.spec` tem os casos com atraso configurável (`ATENCAO(atraso, nome)`) e roda também o `AVISO_JS` do robô (tirado do `.py`); `donoDoAviso`/`dono_do_aviso` decidem de quem é o aviso (o robô tem teste em `carrinho-salvo.test`, com o Playwright de mentira). Os dois trechos ficam entre os marcadores `const RE_TODOS =` e `const ajustar = (qtd, c) =>`.

Outros casos que a mesma técnica cobre: aviso "não possui estoque suficiente" (`avisoDoSite`), máximo por pedido (`ajustar`), produto não achado
pela busca (`cartoes`). Para cada novo formato de página do site, acrescente um caso ao `carrinho-conjunta.spec`.

**Automático:** o hook `testar-favorito` (`.claude/hooks/`) roda os passos 4 sozinho antes de todo commit que mexe no favorito ou no robô e bloqueia o commit se falhar.
