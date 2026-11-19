---
name: conferir-celular
description: Abre a apresentação do painel como celular (390 px) e tira print das telas mexidas, apontando erro de JavaScript, "null/undefined/NaN" no texto e rolagem para o lado. Use sempre que mudar algo visível na tela, antes de subir.
---
# Conferir no celular (390 px)

1. Na raiz do projeto (com `node_modules` instalado — se faltar, `npm ci`), rode com as telas mexidas (o nome é o do `#hash`, ex.: `inicio`, `checklist`, `orcamento`, `nfsaida`, `config`):
   ```bash
   node .claude/skills/conferir-celular/conferir.js <tela> [<tela> ...] --saida=<pasta>
   ```
   - `--saida` padrão: `test-results/celular/` (o hook apaga depois dos testes de tela). Para mostrar ao dono, use a pasta de rascunho da sessão.
   - `--inteira` tira a página inteira; `--largura=360` testa um celular menor.
   - Se o Chromium não for achado: `CHROME_PATH=<chromium> node ...`.
2. O script sobe o servidor sozinho (porta 3098, dados de teste), sai com ✓/✗ por tela e apaga `tests/.dados` no fim.
3. Rode também no computador (`--largura=1100`) e compare com o padrão de `.claude/rules/visual.md` (lista em `TS.table`, abas com contagem, cores por classe).
4. **Olhe os prints** (ferramenta Read na imagem): texto cortado, botão fora da tela, tabela espremida, sobreposição com o ✨ flutuante.
5. Se a tela precisa de um clique para mostrar a parte mexida (abrir gaveta, aba interna), faça um teste em `tests/e2e/` em vez do script e rode só ele:
   `npx playwright test tests/e2e/<arquivo>.spec.js --project=celular`.
6. Apague os prints que ficaram dentro do projeto (`rm -rf test-results`) — nada disso vai para o Git.
