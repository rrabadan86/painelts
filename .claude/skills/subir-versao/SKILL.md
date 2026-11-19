---
name: subir-versao
description: Sobe uma mudança do painel para o GitHub — atualiza com o main, roda a bateria completa (unitários + telas no computador e no celular), limpa os restos dos testes, faz o commit no formato do projeto e o push. Use ao terminar cada mudança.
---
# Subir versão

1. **Atualizar** (o dono também sobe mudanças):
   ```bash
   git fetch origin main && git merge --ff-only FETCH_HEAD
   ```
   Se o fast-forward falhar, pare e conte ao dono o que divergiu (não force).
2. **Bateria completa, uma vez:**
   ```bash
   npm test
   npx playwright test          # se o Chromium não for achado: CHROME_PATH=<chromium> npx playwright test
   ```
   Falhou: corrija e rode **só** o teste que falhou (`npx playwright test <arquivo> -g "<nome>"`); no fim, a bateria inteira de novo.
3. **Limpar** (o hook já limpa quando os testes de tela passam; garanta):
   ```bash
   rm -rf test-results playwright-report tests/.dados
   ```
4. **Conferir o que vai** — `git status` e `git diff --stat`. Nunca: `.env`, `config/lojas.json`, `config/coletor/*.env`, `config/ia.json`,
   `config/ia-mestra.key`, `dados/`, backups, IDs reais, e-mails pessoais do dono. (O hook `segredos.js` bloqueia, mas confira.)
   Adicione os arquivos pelo nome, não `git add -A`.
5. **Commit no formato do projeto:** uma linha em português, `Assunto: o que muda para quem usa` (ex.: `Checklist: observação por turno`,
   `IA: respostas não param mais no meio`). Detalhes, se precisar, em parágrafo abaixo. Termine com as linhas de atribuição pedidas pela sessão.
6. **Push** para o ramo combinado na sessão (`git push -u origin <ramo>`; erro de rede: tente de novo até 4 vezes, esperando mais a cada vez).
7. **PR e merge (autorizado pelo dono para todas as sessões):** se o ramo não for o `main`, abra o PR para o `main`, espere os testes do GitHub terminarem e, com ✓, faça o merge sem perguntar. Com ✗: corrija, suba de novo e espere outra vez — nunca faça merge com teste falhando.
8. Conte ao dono: o que mudou, resultado dos testes e que a instalação na VPS é por "Atualizações do painel" (só versões que passam nos testes do GitHub), depois Ctrl+F5.
