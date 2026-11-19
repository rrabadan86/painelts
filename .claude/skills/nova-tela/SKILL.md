---
name: nova-tela
description: Checklist para criar uma tela nova no painel (ou uma aba nova numa tela existente) — script em APP_SCRIPTS, menu, rótulo, rota de dados com permissão no servidor, versão da apresentação, auditoria e testes no computador e no celular.
---
# Tela nova no painel

Antes de começar, leia uma tela parecida já pronta (ex.: `public/js/checklist.js` + rotas `/api/checklist` no `server.js`).

## Servidor
- [ ] Regras em `src/<assunto>.js` (funções puras, testáveis); rotas no `server.js`.
- [ ] **Permissão no servidor** em toda rota: `req.perfil`, `podeTela(req, '<tela>')`, `podeClientes(req)`, custos. Esconder na tela não basta.
  - Custo/margem nunca para vendedora; dados de clientes nunca para vendedora; Orçamento só admin e franqueado.
- [ ] Tela liberável para gerente? Inclua o id em `TELAS` de `src/config.js` (e em `TELAS_GERENTE_PADRAO` só se for para todos os gerentes).
- [ ] Rota que grava: exige `X-Painel: 1` (na rota ou num `app.use` do grupo, como `/api/nfe`), limita o tamanho do corpo (`express.json({ limit })`) e registra com `C.auditar(...)` se for importante.
- [ ] **Apresentação:** rota `/api/demo/...` com dados fictícios (`src/demo.js`) ou resposta simulada — nunca grava nem envia nada.
  Alternativa usada em telas simples: `if (TS.demo)` no próprio script guardando só na página (veja `checklist.js`).

## Tela
- [ ] `public/js/<tela>.js` no namespace `TS` (`TS.h`, `TS.table`, `TS.kpi`, `TS.seg`, `TS.chart`, `TS.api`).
- [ ] Nome do arquivo em `APP_SCRIPTS` no `server.js` (antes de `config.js`/`main.js`). Não mexa no `?v=`.
- [ ] Menu em `public/js/main.js`: rótulo em `ROTULO` e o id no grupo certo; regras de quem vê (perfil, `telasDo`).
- [ ] Filtros: em `public/js/pages.js`, diga quais filtros a tela usa (ou a mensagem de que não usa).
- [ ] `replaceChildren([...].filter(Boolean))`; textos simples, em português, sem termos técnicos.

## Testes
- [ ] Unidade: `tests/unit/<assunto>.test.js` para as contas e permissões (`node --test tests/unit/<assunto>.test.js`).
- [ ] Tela: adicione o id em `TELAS` de `tests/e2e/telas.spec.js` (roda no computador e no celular) e, se tiver interação, um teste próprio.
- [ ] `npx playwright test tests/e2e/telas.spec.js -g "<tela>"` e a skill `conferir-celular`.
- [ ] Para subir: skill `subir-versao`.
