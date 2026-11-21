---
name: conferir-pr
description: O ciclo depois do push — abrir o PR, acompanhar os testes do GitHub, ler o log quando falha, fazer o merge com ✓, conferir os testes do main e avisar o dono que pode instalar. Use logo depois do passo 7 da skill subir-versao.
---
# Conferir o PR até o dono poder instalar

1. **Abrir o PR** para o `main` (título = o que muda para quem usa; corpo com O que muda / Testes / Instruções e as linhas de atribuição da sessão).
   Assine a atividade do PR (`subscribe_pr_activity`) e agende **um** lembrete para ~10 min com o **SHA completo** do commit no texto
   (`git rev-parse HEAD`). Lembrete com SHA diferente do atual = vencido: responda em uma linha ("já atendido") e não faça nada.
2. **Esperar sem ficar perguntando:** os avisos do GitHub acordam a sessão. Não use `sleep`. Ao acordar, leia `get_check_runs` do PR.
   - Os dois jobs `testes` precisam estar `success` no SHA atual (`registrar` aparece como `skipped`: normal).
3. **Falhou:** leia o log (`get_job_logs` com o `job_id`; se for grande, procure `not ok` e `✘` no arquivo salvo).
   - Ache a causa antes de mexer. Rode o mesmo teste aqui; se passa aqui e falha lá, desconfie de tempo/carga (servidor que não subiu em 10 s,
     espera fixa, teste pesado rodando junto) e de data/hora (o GitHub roda em UTC; virada do dia em Brasília).
   - Nunca pule, desligue ou "repita até passar". Corrija a causa, rode a bateria do que mexeu, suba e agende novo lembrete com o novo SHA.
   - Registre nos Achados de `docs/rastreabilidade.md` quando a causa for um teste frágil.
4. **Passou:** merge com `expectedHeadSha` = SHA atual (autorizado pelo dono; nunca com ✗). Depois:
   ```bash
   git fetch origin main && git merge --ff-only FETCH_HEAD && git push -u origin <ramo>
   ```
   Cancele a assinatura do PR e agende um lembrete (~10 min) para o run **"Testes" do main** desse merge.
5. **Testes do main ✓:** avise o dono em poucas linhas — pode instalar (**Atualizações do painel → instalar**, recarregar a página), o que muda
   para ele e o que conferir no uso real (o que só foi testado na apresentação). ✗ no main: mesmo caminho do passo 3, num PR novo.
6. **Avisos repetidos** (assinatura criada, PR fechado, lembrete antigo): uma linha dizendo o estado atual, sem repetir o relatório.
