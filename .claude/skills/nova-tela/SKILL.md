---
name: nova-tela
description: Checklist para criar uma tela nova no painel (ou uma aba nova numa tela existente) — script em APP_SCRIPTS, menu, rótulo, rota de dados com permissão no servidor, versão da apresentação, auditoria e testes no computador e no celular.
---
# Tela nova no painel

Antes de começar, leia uma tela parecida já pronta (ex.: `public/js/checklist.js` + rotas `/api/checklist` no `server.js`).

## Servidor
- [ ] Regras em `src/<assunto>.js` (funções puras, testáveis); rotas no `server.js`.
- [ ] **Permissão no servidor** em toda rota: `req.perfil`, `podeTela(req, '<tela>')`, `podeClientes(req)`, custos. Esconder na tela não basta.
  - Custo/margem nunca para vendedora; dados de clientes nunca para vendedora; Orçamento e IA só admin e franqueado.
- [ ] Inclua a tela em `src/telas.js` (grupo do menu, regra de cada perfil: `sempre`/`nunca`/`escolha`, `padrao` do gerente, texto da regra fixa). `TELAS` e `TELAS_GERENTE_PADRAO` de `src/config.js` saem daí, e Configurações → Usuários mostra sozinha. O teste `tests/unit/telas.test.js` falha se a página (`TS.pages.x`) ou o rótulo do menu não estiverem lá.
- [ ] Gerente escolhe? O servidor confere com `podeTela(req, '<id>')` (vendedora com regra `sempre`: `req.perfil === 'vendedor' || podeTela(...)`) e há caso em `tests/unit/permissoes-telas.test.js`. Gerente que já tinha telas escolhidas: migração em `server.js` (`telasV`) para não perder a tela nova.
- [ ] Rota que grava: exige `X-Painel: 1` (na rota ou num `app.use` do grupo, como `/api/nfe`), limita o tamanho do corpo (`express.json({ limit })`) e registra com `C.auditar(...)` se for importante.
- [ ] **Apresentação:** rota `/api/demo/...` com dados fictícios (`src/demo.js`) ou resposta simulada — nunca grava nem envia nada.
  Alternativa usada em telas simples: `if (TS.demo)` no próprio script guardando só na página (veja `checklist.js`).

## Tela
- [ ] `public/js/<tela>.js` no namespace `TS` (`TS.h`, `TS.table`, `TS.kpi`, `TS.seg`, `TS.chart`, `TS.api`).
- [ ] Nome do arquivo em `APP_SCRIPTS` no `server.js` (antes de `config.js`/`main.js`). Não mexa no `?v=`.
- [ ] **Layout no padrão** de `.claude/rules/visual.md`: submenu do grupo → cabeçalho (título + frase) → avisos → quadros (`TS.kpi`) → ação principal → card com abas com contagem e `TS.table`. Cores por classe (`pos`/`neg`/`warn-t`/`muted`, `badge ok|warn|erro|cinza`), nada de cor solta no JS.
- [ ] Menu em `public/js/main.js`: rótulo em `ROTULO` e o id no grupo certo; regras de quem vê (perfil, `telasDo`).
- [ ] Filtros: em `public/js/pages.js`, diga quais filtros a tela usa (ou a mensagem de que não usa).
- [ ] `replaceChildren([...].filter(Boolean))`; textos simples, em português, sem termos técnicos.

## Testes
- [ ] Unidade: `tests/unit/<assunto>.test.js` para as contas e permissões (`node --test tests/unit/<assunto>.test.js`).
- [ ] Tela: adicione o id em `TELAS` de `tests/e2e/telas.spec.js` (roda no computador e no celular) e, se tiver interação, um teste próprio.
- [ ] `npx playwright test tests/e2e/telas.spec.js -g "<tela>"` (no celular ele também confere que nada sai do cartão) e a skill `conferir-celular`.
- [ ] Para subir: skill `subir-versao`.
