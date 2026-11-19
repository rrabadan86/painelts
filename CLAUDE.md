# Painel Tea Shop — instruções para o Claude

Painel de vendas das lojas Tea Shop (substitui o Power BI). Responda sempre em **português do Brasil**.

## Como o projeto é organizado
- **Servidor:** Node/Express — `server.js` (rotas) e `src/*.js` (regras: estoque, inventário, NF-e, conta com a franquia, cobrança, orçamentos, checklist, IA…).
- **Tela:** JavaScript puro em `public/js/*.js`, namespace `TS`.
- **Coletor (robôs):** Python + Playwright em `coletor/` (AppNext, FIXE, Sistema de Pedidos).
- **Apresentação:** `/apresentacao` mostra dados fictícios (`src/demo.js`, rotas `/api/demo/...`) e **nunca grava nem envia nada**.
- **IA:** ✨ Pergunte ao painel, diagnóstico do Início e revisão do pedido (`src/ia*.js`, `public/js/ia.js`).

Regras por parte do código ficam em `.claude/rules/` e carregam sozinhas ao mexer nos arquivos: `tela.md`, `visual.md` (padrão de layout: cabeçalho, avisos, quadros, card com abas e `TS.table`, cores por classe, celular), `coletor.md`, `ia.md`, `nfe.md`.
Roteiros em `.claude/skills/`: `subir-versao`, `conferir-celular`, `nova-tela`, `nova-consulta-ia`.
Hooks (`.claude/settings.json`): bloqueiam commit/push de segredos e limpam os restos dos testes de tela.

## Convenções de código
- Rota que grava exige o cabeçalho `X-Painel: 1`; ações importantes vão para a auditoria (`C.auditar`).
- Toda tela/rota nova precisa funcionar na apresentação: crie a rota `/api/demo/...` (dados fictícios ou resposta simulada, sem gravar).
- **Layout sempre no padrão** de `.claude/rules/visual.md`: lista com mais de ~5 itens é `TS.table` (busca, ordenação, páginas, cartão no celular), nunca pilha de cartões; cores por classe/token; conferir prints no computador e no celular.
- Permissões no servidor (`req.perfil`, `podeTela`, `podeClientes`, `podeCustos`), não só escondendo na tela.
- Testes: unidade em `tests/unit/*.test.js` (`node --test`); tela em `tests/e2e/*.spec.js` (Playwright, sempre na apresentação, projetos "computador" e "celular").
- **Matriz de rastreabilidade:** `docs/rastreabilidade.md` liga cada regra (código PERF-01, ESC-16…) ao código e ao teste que a cobre. Mudou ou criou regra: atualize a linha no mesmo PR (onde está, teste, cobertura); achou erro ou lacuna: registre nos Achados.
- Durante os ajustes: `npm test` + só os testes de tela da parte mexida (`npx playwright test tests/e2e/ia.spec.js`, ou `-g "nome"`). A bateria completa é uma vez, antes de subir.

## Antes de cada commit
- Comece sempre com `git fetch origin main && git merge --ff-only FETCH_HEAD` (o dono também sobe mudanças).
- Faça commit e push de cada mudança (skill `subir-versao`). A instalação na VPS é pelo painel ("Atualizações do painel"): só versões que passam nos testes do GitHub entram. Depois é Ctrl+F5.
- **Instruções sempre em dia:** se a mudança cria regra, permissão, fluxo, tela ou convenção nova, atualize no mesmo PR o CLAUDE.md, a regra da área (`.claude/rules/`) ou a skill. O hook `lembrar-docs.js` avisa depois de cada commit quando a área mexida não teve a instrução atualizada.
- **Versões de segurança:** tag `DDMMAAAA-Claude` no `main` (passo 9 da skill `subir-versao`); o dono transforma em Release no GitHub.
- **Autorizado pelo dono (vale para todas as sessões):** o Claude pode abrir o PR e fazer o merge no `main` sozinho, sem perguntar, depois que os testes do GitHub do PR passarem (✓). Testes falharam: corrija antes; nunca faça merge com ✗ nem pule testes.

## Regras que não mudam
**Segredos e dados**
- Nunca suba para o Git: `.env`, `config/lojas.json`, `config/coletor/*.env`, `config/ia.json`, `config/ia-mestra.key`, `dados/`, backups, IDs reais.
- Senhas e chaves: o Claude nunca digita, nunca pede no chat e o painel nunca devolve para a tela (só os 4 últimos caracteres). Quem faz login no AppNext e no FIXE é o dono.
- Os e-mails pessoais do dono não vão para código, commit nem log.

**Perfis**
- Custo e margem nunca aparecem para vendedora.
- Vendedora não recebe dados de clientes. **Exceção (decisão do dono):** na Lista de espera ela busca e vê nome, CPF e celular do cliente para anotar e avisar.
- Gerente recebe as vendas de toda a loja mesmo sem as telas de vendas liberadas (decisão do dono); custo só com tela de custo liberada (Estoque, Preços, Rentabilidade, Notas, Pedido, Resultado) — inclusive no Inventário.
- Telas por perfil: a lista única fica em `src/telas.js` (grupos do menu, regra de cada perfil, padrão do gerente, regras fixas travadas em Configurações → Usuários). Tela nova entra lá; o teste `tests/unit/telas.test.js` avisa se faltar. Tela que o gerente escolhe precisa de `podeTela(req, '<id>')` no servidor.
- ⭐ Sugestões para o pedido (Estoque → Sugestões): vendedora sempre; gerente com a tela marcada (vem no padrão). A vendedora vê só o nome e a situação do produto (tem / pouco / acabou), nunca quantidade nem custo, e só as próprias sugestões; quem decide é quem tem a tela Pedido. A estrela não muda a conta do pedido sugerido.
- Orçamento: só admin e franqueado.
- Falar com a franquia por e-mail (reajuste de custo, cobrança de devoluções e de fidelidade, envio automático): só admin e franqueado.
- Só o admin dispara o coletor ("Sincronizar agora").
- IA (✨, análise do Início, revisão do pedido): só admin e franqueado.

**AppNext, FIXE e NF-e** (detalhes em `coletor.md` e `nfe.md`)
- AppNext: só grava em fluxos aprovados pelo dono (clique no painel + confirmação, conferido item a item, auditado). Explorando: só olhar, nunca Concluir, Homologar ou Salvar.
- O robô conclui e homologa NF-e (venda e devolução) só depois da revisão, para admin, franqueado e gerentes com Notas fiscais.
- FIXE: só observar.
- Pergunte antes de abrir o AppNext no Chrome. Ele guarda a sessão por aba: cada aba nova pede login ao dono.

**WhatsApp e testes**
- Envio manual: um clique por mensagem, sem insistir com o cliente.
- Dados temporários de teste: apague depois.

## Pendências combinadas (o dono pediu para depois)
- Infusor obrigatório das mugs (Harmony, Classic, Super Jumbo, All in One Mug e Jumbo) no Pedido e no favorito do carrinho: o par mug → infusor vem da pergunta do Sistema de Pedidos (o dono manda o print quando o site abrir). Mug Uki e a linha de pinturas não têm infusor. Decisão: não agrupar estampas nos indicadores.
- Conferência do boleto de royalties (ler o PDF e conferir os descontos de devoluções e da fidelidade).
- Reserva de estoque para encomenda (ligada ao Orçamento).
- Meta do dia dividida pela escala, em vez da participação nas vendas.
- A confirmar com o dono: a linha "campos de desconto no AppNext" no log da sincronização das notas; a primeira NF-e real emitida pelo painel ou pelo Orçamento.
