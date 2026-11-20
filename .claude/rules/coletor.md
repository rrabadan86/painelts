---
paths:
  - "coletor/**"
  - "src/coletor.js"
  - "config/coletor/**"
---
# Coletor (robôs do AppNext, FIXE e Sistema de Pedidos)

- Python + Playwright, um script por tarefa (`nextsoft_*.py` = AppNext, `fixe_*.py` = FIXE). `coletor.py` é o serviço que roda na VPS
  e enfileira as lojas; `nextsoft_sessao.py` faz um login só e roda os módulos em sequência (mantenha o marcador `### nextsoft_<modulo>.py ###`).
- O painel fala com o coletor por `src/coletor.js` (API interna do docker compose, cabeçalho `X-Coletor-Token`).
- Quem dispara o coletor ("Sincronizar agora", "Atualizar agora", importar histórico, FIXE, robô do Sistema de Pedidos): o admin em qualquer loja e o **franqueado só nas lojas dele**. Confira no servidor a permissão e a loja (`soGestor` + `lojaPermitida` em `src/admin-api.js`; `req.lojas` em `server.js`). Gerente e vendedora nunca. Horários e janela da rede continuam só do admin.
- Credenciais ficam em `config/coletor/<loja>.env` (nunca no Git; o modelo é `exemplo.env.modelo`). O Claude nunca digita nem pede senha:
  quem faz login no AppNext e no FIXE é o dono.

## O que o robô pode fazer
- **AppNext:** só grava em fluxos aprovados pelo dono (clique no painel + confirmação, conferido item a item, auditado). Na dúvida, para sem salvar.
- **Explorando o AppNext** (descobrir telas, seletores): só olhar, nunca Concluir, Homologar ou Salvar. Use `SIMULAR=1` quando o script tiver.
- **FIXE:** só observar.
- Pergunte antes de abrir o AppNext no Chrome. Ele guarda a sessão por aba: cada aba nova pede login ao dono.

## Ao mexer
- Saídas do robô em JSON (`SAIDA_RESULTADO`/`SAIDA_SESSAO`): o painel lê esses arquivos; mantenha os campos que ele já usa.
- Logs não podem ter senha, token, CPF completo nem e-mail pessoal do dono.
- Dados temporários de teste: apague depois.
- Dado que vem do AppNext pode faltar ou vir em outro formato: número com `?? 0`, data com `Date.parse` conferida — um `NaN`/data inválida gravado no JSON derruba a leitura no painel.
- Planilha de estoque com menos de 50% dos produtos que tinham saldo é recusada (vira `.erro`); só o envio manual pode confirmar (`?forcar=1`, auditado).
- E-mail do FIXE: só vale com DKIM/DMARC/SPF alinhados ao domínio do FIXE; link só nos domínios conhecidos (`FIXE_LINK_DOMINIOS` libera outro).
- Robô do WhatsApp (serviço `zap/`, separado do coletor): o painel fala com ele só por `src/zap.js` (`ZAP_URL`, `ZAP_TOKEN`, cabeçalho `X-Zap-Token`). O serviço não decide nada: fila e travas em `src/zapfila.js`, laço de 30 s em `src/zaplaco.js` (uma mensagem por vez, só com o estado `conectado`; `desconectado` não marca o cliente nem conta como falha; id estável campanha-rodada-CPF). Log e auditoria: nunca o texto da mensagem nem o número completo (só os 4 últimos dígitos).
- Sistema de Pedidos, janela "Venda Conjunta" (o produto só é vendido junto com outro, ex.: mug + infusor): `venda_conjunta(page)` em `nextsoft_pedido.py` lê os itens e clica em "Colocar Todos no Carrinho" (decisão do dono), uma vez por produto; o que veio junto vai em `r["junto"]`. O favorito do navegador faz o mesmo (`vendaConjunta` em `public/js/carrinho-site.js`). Nenhum dos dois finaliza o pedido.
