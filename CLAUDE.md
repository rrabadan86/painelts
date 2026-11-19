# Painel Tea Shop — instruções para o Claude

Painel de vendas das lojas Tea Shop (substitui o Power BI). Responda sempre em **português do Brasil**.

## Como o projeto é organizado
- **Servidor:** Node/Express — `server.js` (rotas) e `src/*.js` (regras: estoque, inventário, NF-e, conta com a franquia, cobrança, orçamentos, checklist, IA…).
- **Tela:** JavaScript puro em `public/js/*.js`, namespace `TS`.
- **Coletor (robôs):** Python + Playwright em `coletor/` (AppNext, FIXE, Sistema de Pedidos).
- **Apresentação:** `/apresentacao` mostra dados fictícios (`src/demo.js`, rotas `/api/demo/...`) e **nunca grava nem envia nada**.
- **IA:** ✨ Pergunte ao painel, diagnóstico do Início e revisão do pedido (`src/ia*.js`, `public/js/ia.js`).

Regras por parte do código ficam em `.claude/rules/` e carregam sozinhas ao mexer nos arquivos: `tela.md`, `coletor.md`, `ia.md`, `nfe.md`.
Roteiros em `.claude/skills/`: `subir-versao`, `conferir-celular`, `nova-tela`, `nova-consulta-ia`.
Hooks (`.claude/settings.json`): bloqueiam commit/push de segredos e limpam os restos dos testes de tela.

## Convenções de código
- Rota que grava exige o cabeçalho `X-Painel: 1`; ações importantes vão para a auditoria (`C.auditar`).
- Toda tela/rota nova precisa funcionar na apresentação: crie a rota `/api/demo/...` (dados fictícios ou resposta simulada, sem gravar).
- Permissões no servidor (`req.perfil`, `podeTela`, `podeClientes`, `podeCustos`), não só escondendo na tela.
- Testes: unidade em `tests/unit/*.test.js` (`node --test`); tela em `tests/e2e/*.spec.js` (Playwright, sempre na apresentação, projetos "computador" e "celular").
- Durante os ajustes: `npm test` + só os testes de tela da parte mexida (`npx playwright test tests/e2e/ia.spec.js`, ou `-g "nome"`). A bateria completa é uma vez, antes de subir.

## Antes de cada commit
- Comece sempre com `git fetch origin main && git merge --ff-only FETCH_HEAD` (o dono também sobe mudanças).
- Faça commit e push de cada mudança (skill `subir-versao`). A instalação na VPS é pelo painel ("Atualizações do painel"): só versões que passam nos testes do GitHub entram. Depois é Ctrl+F5.
- **Versões de segurança:** tag `DDMMAAAA-Claude` no `main` (passo 8 da skill `subir-versao`); o dono transforma em Release no GitHub.
- **Autorizado pelo dono (vale para todas as sessões):** o Claude pode abrir o PR e fazer o merge no `main` sozinho, sem perguntar, depois que os testes do GitHub do PR passarem (✓). Testes falharam: corrija antes; nunca faça merge com ✗ nem pule testes.

## Regras que não mudam
**Segredos e dados**
- Nunca suba para o Git: `.env`, `config/lojas.json`, `config/coletor/*.env`, `config/ia.json`, `config/ia-mestra.key`, `dados/`, backups, IDs reais.
- Senhas e chaves: o Claude nunca digita, nunca pede no chat e o painel nunca devolve para a tela (só os 4 últimos caracteres). Quem faz login no AppNext e no FIXE é o dono.
- Os e-mails pessoais do dono não vão para código, commit nem log.

**Perfis**
- Custo e margem nunca aparecem para vendedora.
- Vendedora não recebe dados de clientes.
- Orçamento: só admin e franqueado.
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
- Conferência do boleto de royalties (ler o PDF e conferir os descontos de devoluções e da fidelidade).
- Reserva de estoque para encomenda (ligada ao Orçamento).
- Meta do dia dividida pela escala, em vez da participação nas vendas.
- A confirmar com o dono: a linha "campos de desconto no AppNext" no log da sincronização das notas; a primeira NF-e real emitida pelo painel ou pelo Orçamento.
