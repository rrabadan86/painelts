---
paths:
  - "zap/**"
  - "src/zap*.js"
  - "public/js/zap.js"
  - "public/js/msgwpp.js"
  - "public/js/campanhas.js"
  - "src/campanhas.js"
  - "tests/unit/zap*.test.js"
---
# Robô do WhatsApp das campanhas

Decisão do dono: campanhas marcadas "Enviar pelo robô" saem sozinhas pelo número de WhatsApp da loja. O dono aceitou o risco de bloqueio do número; por isso as travas são obrigatórias e ficam no servidor.

## Quem faz o quê
- `zap/` (serviço à parte, sem porta publicada, `ZAP_TOKEN`): **não decide nada**. Conecta (QR ou código), envia a mensagem que o painel manda, informa a situação e quem respondeu "parar". Um envio por vez por loja; o mesmo `id` não reenvia em 24 h. Contrato: `/saude`, `/status/<loja>`, `/conectar`, `/desconectar`, `/enviar`, `/optouts`.
- `src/zapfila.js` (`decidir`, pura): quem recebe a próxima mensagem ou por que não há — robô ligado/pausado, dias e horário (Brasília), máximo por dia do número, ritmo, limite da campanha, intervalo da loja, optout, só campanhas ativas com `robo: true`, a mais antiga primeiro, telefone inválido marca e segue.
- `src/zaplaco.js`: a cada ~30 s, uma mensagem por vez, só com o serviço `conectado`; grava `st 'e'`, `por: 'robô'`; `sem_whatsapp` marca e segue; `desconectado` não marca nem conta falha; N falhas seguidas pausa sozinho e audita. Estado em `dados/<loja>/zap/estado.json`.
- `public/js/msgwpp.js`: montagem do texto e do número, usada pelo envio manual e pelo robô (precisam dar o mesmo resultado).
- `src/zap-api.js`: rotas `/api/zap/*` (e `/api/demo/zap/*` simuladas). Configuração em `lojas.json → zap`.

## Regras que não mudam
- Toda trava nova entra em `decidir` com teste em `tests/unit/zapfila.test.js`; nunca só na tela.
- Padrões: ritmo 900–1200 s (mínimo aceito 60; a tela alerta abaixo de 300), 09:00–18:30, seg a sáb, 30 mensagens por dia, pausa após 3 falhas.
- O robô não depende de alguém abrir a tela. `src/zapauto.js` (tarefa do servidor, só loja com o robô ligado e campanha `robo: true` ativa): quando o dia vira, quando os dados da loja mudam (coleta) ou quando falta a lista de alguma campanha — no máximo 1× por hora por loja — cria a lista nova da recorrente vencida (`CAMP.rodadaEmDia`; auditoria só aí, por `robô`) e refaz a lista conferida (valores de `{pontos}`, `{cha}`, número, estoque…). A tela continua mandando a dela ao abrir Campanhas.
- **A conta é uma só**: `src/zapauto.js` carrega os próprios arquivos da tela (`core`, `rules`, `fidelidade`, `msgwpp`, `clientes`, `campanhas`, `validade`) num contexto isolado do Node, com o pacote de `/api/dados` de quem vê tudo, e chama `TS.campanhasCalc.listaDe` / `itensPreparo` (`public/js/campanhas.js`). Nunca copie regra de cliente/campanha para o servidor. Esses arquivos não podem tocar na página ao carregar (só dentro de função); "hoje" sempre por `TS.hojeSP`/`TS.todayDay`, nunca pelo fuso da máquina. Testes: `tests/unit/zapauto.test.js` e, em `tests/e2e/zap.spec.js`, navegador × servidor com os mesmos dados.
- A lista conferida vale 3 dias (rede de segurança): se a tarefa falhar esse tempo todo, o robô para com "a lista precisa ser conferida" e não envia com valores velhos. A lista de uma rodada já criada não é refeita sozinha (é a foto do dia em que foi criada, como na tela).
- Resposta "parar/sair/não quero/remover/descadastrar" vira "não quer mensagens" com a origem registrada; a loja desfaz em "Voltou a aceitar".
- Permissão: admin e franqueado da loja conectam, ligam e configuram; gerente com Clientes vê e pausa; vendedora não vê. QR só para quem configura.
- Nunca em log, auditoria ou resposta: texto de mensagem recebida, número completo (só 4 últimos dígitos), `ZAP_TOKEN`. Nunca subir `zap-work/`.
- Não dá para testar com WhatsApp de verdade no ambiente de desenvolvimento: os testes usam um cliente de mentira (`zap/tests`, `tests/unit/zap-integracao.test.js`). Mudança em `zap/wa.js` precisa ser conferida pelo dono na VPS.
- Instalação: serviço opcional (`docker compose --profile zap up -d --build zap`); a atualização pelo painel não mexe nele (ver `zap/README.md`).
- Apresentação: tudo simulado, nada conecta nem envia.
- **Período da campanha** (`inicio`, `fim`, opcionais; `M.foraDoPeriodo`): fora dele o robô pula a campanha (`fora_periodo`), a fila manual fica travada e a recorrente não monta lista nova. Recorrência: `diaria` (uma lista por dia de Brasília), `semanal`, `mensal`.
