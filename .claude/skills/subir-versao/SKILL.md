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
2. **Testes da alteração pela matriz, primeiro:** `npm run testar-alteracao` (acha na `docs/rastreabilidade.md` as regras dos arquivos mexidos, roda os testes delas e avisa as sem teste). Mudou regra, tela, rota ou teste: atualize a linha da matriz no mesmo PR e rode `npm run matriz` (o resumo em números é contado; o guardião `matriz.test.js` falha se ficar velho).
2b. **Bateria completa, uma vez:**
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
5. **Instruções em dia:** a mudança criou regra, permissão, fluxo, tela ou convenção nova? Atualize o CLAUDE.md, a regra de `.claude/rules/` da área ou a skill, num commit à parte (`Claude: …`) no mesmo PR. Depois do commit, o hook `lembrar-docs.js` lembra se a área mexida ficou sem a instrução atualizada; se a mudança não altera nada que as instruções descrevam, siga.
6. **Commit no formato do projeto:** uma linha em português, `Assunto: o que muda para quem usa` (ex.: `Checklist: observação por turno`,
   `IA: respostas não param mais no meio`). Detalhes, se precisar, em parágrafo abaixo. Termine com as linhas de atribuição pedidas pela sessão.
7. **Push** para o ramo combinado na sessão (`git push -u origin <ramo>`; erro de rede: tente de novo até 4 vezes, esperando mais a cada vez).
8. **PR e merge (autorizado pelo dono para todas as sessões)** — o passo a passo detalhado (lembretes, log de falha, testes do main, aviso ao dono) está na skill `conferir-pr`: se o ramo não for o `main`, abra o PR para o `main`, espere os testes do GitHub terminarem e, com ✓, faça o merge sem perguntar. Com ✗: corrija, suba de novo e espere outra vez — nunca faça merge com teste falhando.
   - O merge pede o SHA **completo** (40 caracteres) do último commit do ramo: `git ls-remote origin <ramo>` (o curto dá erro; um SHA antigo dá 409).
   - Um PR por vez: se ainda há um PR aberto do mesmo ramo, espere o merge dele antes de subir outra mudança (ou ela entra no PR aberto — atualize a descrição).
9. **Versão de segurança (quando o dono pedir, ou ao fim de um conjunto grande de mudanças):** tag anotada no `main` já com o merge, no formato `DDMMAAAA-Claude`
   (as anteriores: `17112026-Antigravity`, `pre-fase1e2-Antigravity`…):
   ```bash
   git fetch origin main && git tag -a 19112026-Claude origin/main -m "Resumo do que entrou" && git push origin 19112026-Claude
   ```
   Não há ferramenta para criar o "Release" em si: entregue ao dono o link `https://github.com/rrabadan86/painelts/releases/new?tag=<tag>` e o texto das notas para colar.
   Para voltar a uma versão: "Atualizações do painel" ou `git checkout <tag>` num ramo novo — nunca reescreva o `main`.
10. Conte ao dono: o que mudou, resultado dos testes e que a instalação na VPS é por "Atualizações do painel" (só versões que passam nos testes do GitHub), depois Ctrl+F5.

**Conjuntos de tela além da apresentação** (rodam no GitHub em todo PR e de madrugada): `npx playwright test -c playwright.perfis.config.js` (perfis), `-c playwright.datas.config.js` (datas difíceis) e `PRINTS_LOCAL=1 npx playwright test -c playwright.visual.config.js` (prints, conferência local). Mudou layout de propósito: as referências dos prints são geradas pelo workflow "Prints de referência" (skill `conferir-pr`, passo 1b).
