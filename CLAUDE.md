# Painel Tea Shop — instruções para o Claude

Painel de vendas das lojas Tea Shop (substitui o Power BI). Responda sempre em **português do Brasil**.

## Como o projeto é organizado
- **Servidor:** Node/Express — `server.js` (rotas) e `src/*.js` (regras: estoque, inventário, NF-e, conta com a franquia, cobrança, orçamentos, checklist, IA…).
- **Tela:** JavaScript puro em `public/js/*.js`, tudo no namespace `TS` (`TS.h()` monta elementos, `TS.table`, `TS.kpi`, `TS.seg`, `TS.chart`, `TS.api` — este já sabe se está na apresentação).
  - Script novo de tela precisa entrar em `APP_SCRIPTS` no `server.js`.
  - O versionamento dos arquivos (`?v=`) é automático: não mexa.
  - `replaceChildren(...)` com `null` escreve "null" na tela: sempre `[...].filter(Boolean)`.
- **Coletor (robôs):** Python + Playwright em `coletor/` (AppNext, FIXE, Sistema de Pedidos).
- **Apresentação:** `/apresentacao` mostra dados fictícios (`src/demo.js`, rotas `/api/demo/...`) e **nunca grava nem envia nada**.
- **IA:** `src/ia.js` (chave da Anthropic por loja, criptografada; teto e uso por mês), `src/iaprompts.js` (instruções e ferramentas), `src/iaconversas.js` (histórico), `public/js/ia.js` (✨ Pergunte ao painel; as consultas rodam no navegador sobre os dados que o perfil já vê). Na apresentação e nos testes (`IA_FALSO=1`) as respostas são simuladas.

## Antes de cada commit
```bash
npm test
npx playwright test          # se precisar: CHROME_PATH=<chromium> npx playwright test
rm -rf test-results playwright-report tests/.dados
```
- Comece sempre com `git fetch origin main && git merge --ff-only FETCH_HEAD` (o dono também sobe mudanças).
- Faça commit e push de cada mudança. A instalação na VPS é pelo painel ("Atualizações do painel"): só versões que passam nos testes do GitHub entram. Depois é Ctrl+F5.

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

**AppNext e FIXE**
- AppNext: só grava em fluxos aprovados pelo dono (clique no painel + confirmação, conferido item a item, auditado).
- O robô conclui e homologa NF-e (venda e devolução) só depois da revisão, para admin, franqueado e gerentes com Notas fiscais.
- Explorando o AppNext: só olhar, nunca Concluir, Homologar ou Salvar.
- FIXE: só observar.

**WhatsApp e testes**
- Envio manual: um clique por mensagem, sem insistir com o cliente.
- Dados temporários de teste: apague depois.
