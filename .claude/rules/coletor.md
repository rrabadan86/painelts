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
- **Robô novo entra no `COPY` do `coletor/Dockerfile`** (a lista é arquivo por arquivo; sem isso a VPS não tem o script — COLETOR-IMG-01, `extrato.test`).
- Saídas do robô em JSON (`SAIDA_RESULTADO`/`SAIDA_SESSAO`): o painel lê esses arquivos; mantenha os campos que ele já usa.
- Logs não podem ter senha, token, CPF completo nem e-mail pessoal do dono.
- Dados temporários de teste: apague depois.
- Dado que vem do AppNext pode faltar ou vir em outro formato: número com `?? 0`, data com `Date.parse` conferida — um `NaN`/data inválida gravado no JSON derruba a leitura no painel.
- Planilha de estoque com menos de 50% dos produtos que tinham saldo é recusada (vira `.erro`); só o envio manual pode confirmar (`?forcar=1`, auditado).
- E-mail do FIXE: só vale com DKIM/DMARC/SPF alinhados ao domínio do FIXE; link só nos domínios conhecidos (`FIXE_LINK_DOMINIOS` libera outro).
- Robô do WhatsApp (serviço `zap/`, separado do coletor): o painel fala com ele só por `src/zap.js` (`ZAP_URL`, `ZAP_TOKEN`, cabeçalho `X-Zap-Token`). O serviço não decide nada: fila e travas em `src/zapfila.js`, laço de 30 s em `src/zaplaco.js` (uma mensagem por vez, só com o estado `conectado`; `desconectado` não marca o cliente nem conta como falha; id estável campanha-rodada-CPF). Log e auditoria: nunca o texto da mensagem nem o número completo (só os 4 últimos dígitos).
- Sistema de Pedidos, janela "Venda Conjunta" (o produto só é vendido junto com outro, ex.: mug + infusor): `venda_conjunta(page)` em `nextsoft_pedido.py` lê os itens e clica em "Colocar Todos no Carrinho" (decisão do dono), uma vez por produto; o que veio junto vai em `r["junto"]`. O favorito do navegador faz o mesmo (`vendaConjunta` em `public/js/carrinho-site.js`). Nenhum dos dois finaliza o pedido. **Na loja real (20/11/2026) a primeira versão não aceitou a janela** (as mugs ficaram "sem confirmação") e não deu para ver a página de lá: a detecção passou a aceitar qualquer elemento com o texto exato "Colocar Todos no Carrinho" que não esteja dentro de algo com `display:none` (sem exigir tamanho), o clique é completo (`clicar`), há uma segunda tentativa seguindo o link do botão (`seguirLink`), `avisoDoSite` não fecha essa janela, e quando o site não confirma o item leva um diagnóstico (`diagnostico`: janelas abertas, tipo do botão, se havia "Venda Conjunta"), mostrado no favorito. Nunca teste abrindo o site: `tests/e2e/carrinho-conjunta.spec.js` roda as funções do favorito em páginas de mentira. Se o dono mandar o diagnóstico, ajuste por ele.
- Sistema de Pedidos, **aviso de estoque** ("O produto X não possui estoque suficiente.", loja real 22/11/2026: a janela "Atenção" não era o `.modal` de sempre e às vezes chegava atrasada, depois de o favorito desistir, e caía no produto seguinte): `avisoDoSite` (favorito) e `AVISO_JS`/`aviso_do_site` (robô, o mesmo JS) procuram qualquer janela visível e também qualquer bloco visível com a frase de estoque, fecham pelo "Fechar"/×/OK (bloco sem botão é marcado `data-tsc-visto`, nunca escondido) e devolvem o texto; depois que o carrinho não mudou, esperam até mais 8 s só pelo aviso; antes de cada produto e depois da busca, aviso que sobrou é atribuído ao produto citado no texto (`donoDoAviso`/`dono_do_aviso`), nunca ao atual. Status `sem_estoque` aparece como **"Fora de estoque"** (decisão do dono), sem "Tentar de novo".
- Favorito do carrinho e robô do Sistema de Pedidos: siga a skill `testar-favorito` (páginas de mentira, nunca o site real). O hook `testar-favorito` roda esses testes sozinho antes de todo commit que mexe em `public/js/carrinho-site.js` ou `coletor/nextsoft_pedido.py` e bloqueia o commit se falharem: corrija, nunca desligue o teste.

- **Extrato de estoque** (EXTRATO-01, `nextsoft_extrato.py`, tipo `extrato` no coletor): só abre Estoque → Extrato de estoque (nunca clica nem digita além do login), guarda o diagnóstico sem campos pessoais (`PESSOAL`) em `estoque/extrato-diag.json` e, quando a tela pede uma lista com período, os movimentos desde `EXTRATO_DESDE` em `estoque/extrato.json`. O formato ainda não é conhecido: a reconstrução das fotos do estoque (CMV-EST-01) se ajusta pelo diagnóstico que o dono mandar.
- **Extrato em blocos** (EXTRATO-02): o AppNext recusa período maior que 31 dias em `/api/v1/estoque/extrato-estoque`; o robô lê em blocos de 28 dias (`blocos`), todas as páginas (`ler_bloco`, 200 por página), confere com `totalLinhas` e grava em `estoque/extrato.json` `{ desde, ate, situacao, blocos: [{ de, ate, lidos, total }], completo, itens: [{ d, t, o, n, c, p, q, dt }] }` (sem parceiro). O extrato **não traz custo**: a reconstrução do estoque a custo dos meses passados (CMV-REC-01, `src/cmvestoque.js`) volta do estoque de hoje pelos movimentos e usa o custo de cada data (`custodata.js`); roda na rotina de 15 min do servidor, uma vez por leitura do extrato.

- **Homologação** (`PAINEL_AMBIENTE=homologacao`, HOMOLOG-01, `docs/homologacao.md`): ali nada sai do painel — o servidor recusa por `C.travaHomolog` (e `ativo()` do coletor e do robô dá falso). Saída nova desta parte passa pela mesma trava e ganha linha em `tests/unit/homolog.test.js`.

- **Login do AppNext** (LOGIN-APPNEXT-01): todo robô entra por `nx.preencher_login(page)` (espera o formulário, recarrega uma vez, diagnostica sem valores e para com mensagem clara); nunca preencha `SEL["rede"]` direto (o `coletor-login.test` confere).
- **Fila do coletor** (NF-FILA-01): o laço `trabalhador` nunca pode morrer (proteção em volta de cada volta, `finally` limpa `trabalho`); `robo_agora` devolve `parado` quando a fila não anda; a tela nunca mostra "N na frente" a partir de `pendentes(loja)` (conta o próprio pedido).
