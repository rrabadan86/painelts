---
paths:
  - "src/nfe.js"
  - "src/nfsaida.js"
  - "src/devolucao.js"
  - "src/xmlarquivos.js"
  - "src/xmlbase.js"
  - "public/js/nfsaida.js"
  - "public/js/devolucao.js"
  - "public/js/danfe.js"
  - "public/js/creditos.js"
  - "public/js/orcamento.js"
  - "coletor/nextsoft_nfe.py"
  - "coletor/nextsoft_xml.py"
  - "tests/unit/nfe.test.js"
  - "tests/unit/nfsaida.test.js"
  - "tests/unit/devolucao.test.js"
---
# NF-e (venda, devolução ao fornecedor e notas emitidas)

- `src/nfe.js`: NF-e de venda como pedido para o robô (`dados/<loja>/nfe/envio/<id>.json` → `<id>.resultado.json`) e histórico em `rascunhos.json`.
- `src/devolucao.js`: devolução ao fornecedor a partir da nota de entrada (itens danificados/faltando, fotos, planilha, e-mail, NF-e).
- `src/nfsaida.js`: lista as NF-e (modelo 55) a partir dos XMLs que o coletor guarda; NFC-e (65) ficam em Vendas → Cupons.
- `coletor/nextsoft_nfe.py`: `ACAO=cadastros` só lê; `ACAO=rascunho` preenche e salva rascunho, e com `emitir` conclui e homologa.
  Confere produtos, quantidades, preços e total antes de salvar; se algo não bater, **para sem salvar**. `SIMULAR=1` faz tudo menos o clique final.

## Regras que não mudam
- O robô conclui e homologa NF-e (venda e devolução) **só depois da revisão** (teste conferido no painel, total igual ao do teste),
  e só para admin, franqueado e gerentes com a tela Notas fiscais. Confira no servidor, não só na tela.
- Toda ação (teste, rascunho, emitir) vai para `C.auditar`. Pedido repetido para a mesma nota (robô já na fila ou nota já gravada) devolve 409.
- Sem coletor ligado na VPS (`COL.ativo()`), as rotas respondem erro em vez de fingir que mandaram.
- Explorando o AppNext: nunca Concluir, Homologar ou Salvar fora desse fluxo.
- Na apresentação nada vai para o robô: resposta simulada.
- A confirmar com o dono: a primeira NF-e real emitida pelo painel ou pelo Orçamento; a linha "campos de desconto no AppNext" no log.
