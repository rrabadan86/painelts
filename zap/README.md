# zap — robô do WhatsApp das campanhas

Serviço interno do painel: conecta o WhatsApp **já existente** de cada loja (WhatsApp Web, por QR ou código) e envia o que o painel mandar. Ele é "burro" de propósito: **quem decide para quem, quando e quantas mensagens é o painel** (ritmo, janela, teto do dia, pausa por falhas). Aqui só mora: conectar, enviar uma mensagem por vez, dizer a situação e avisar quem respondeu "parar".

- Sem porta publicada: só o painel fala com ele, em `http://zap:8010`, com o cabeçalho `X-Zap-Token` (`ZAP_TOKEN` do `.env`).
- Uma sessão por loja em `zap-work/<loja>/` (fora do Git). Lá ficam o login do WhatsApp (`session/`), os ids já enviados (`enviados.json`, sem texto nem número), os pedidos de saída (`optouts.json`, número e data, sem o texto) e as **conversas dos últimos 7 dias** (`conversas.json`, com o texto — decisão do dono, para Clientes → Conversas; o painel busca e guarda do lado dele; desconectar apaga).
- O log mostra só os 4 últimos dígitos dos números e nunca o texto das mensagens.
- Ao subir, reconecta só as lojas que já estavam conectadas. Nunca abre sessão nova sozinho.

## Subir na VPS (uma vez)

```bash
cd /caminho/do/painel
# 1) senha interna entre o painel e o robô
echo "ZAP_TOKEN=$(openssl rand -hex 32)" >> .env
# 2) pasta da sessão, com o mesmo usuário dos contêineres
mkdir -p zap-work && chown -R 1000:1000 zap-work
# 3) construir e subir o robô, e reiniciar o painel para ele enxergar o ZAP_TOKEN
docker compose --profile zap up -d --build zap
docker compose up -d teashop-painel
# 4) conferir
docker compose --profile zap logs --tail 20 zap      # "ouvindo na porta 8010"
```

Depois é pelo painel: Configurações → loja → WhatsApp → **Conectar** (lê o QR no celular da loja em *Aparelhos conectados → Conectar um aparelho*, ou usa o código de 8 caracteres).

A primeira construção baixa o Chromium (demora alguns minutos e ocupa perto de 1 GB). Cada loja conectada mantém um navegador aberto (uns 300–500 MB de memória).

## Dia a dia

- **Atualizações do painel** reconstroem este serviço junto; as lojas voltam sozinhas com a sessão salva.
- **Ver o que está acontecendo:** `docker compose --profile zap logs -f zap`.
- **Loja "caiu":** o WhatsApp encerrou a conexão (aparelho removido no celular, número aberto em outro WhatsApp Web, muito tempo com o celular sem internet). Conecte de novo pelo painel.
- **Trocar a senha interna:** mude `ZAP_TOKEN` no `.env` e rode `docker compose --profile zap up -d zap teashop-painel`.
- **Apagar tudo de uma loja:** desconecte pelo painel (sai do WhatsApp e apaga `zap-work/<loja>/session`).
- **O WhatsApp Web mudou e parou de conectar/enviar:** quase sempre é a biblioteca. Troque a versão de `whatsapp-web.js` em `zap/package.json`, rode `npm install --package-lock-only` nesta pasta e suba a versão.

## API (JSON; `<loja>` = `[a-z0-9_-]+`; 401 sem o token certo; 400 para loja ou pedido inválido)

| Chamada | Resposta |
|---|---|
| `GET /saude` | `{ ok: true }` |
| `GET /status/<loja>` | `{ estado, qr, codigo, numeroFim, desde, erro }` — `estado`: `desligado`, `iniciando`, `qr`, `codigo`, `conectado` ou `caiu`; `qr` é imagem (dataURL); `numeroFim` são os 4 últimos dígitos |
| `POST /conectar/<loja>` `{ numero? }` | `{ ok: true }` — com número (DDI+DDD+número) pareia por código; sem, por QR. A situação vem pelo `/status` |
| `POST /desconectar/<loja>` | `{ ok: true }` — sai do WhatsApp e apaga a sessão |
| `POST /enviar/<loja>` `{ id, para, texto }` | `{ ok: true, idMsg }` ou `{ ok: false, motivo: 'sem_whatsapp' \| 'desconectado' \| 'falha', erro }` |
| `GET /optouts/<loja>?desde=<ISO>` | `{ itens: [{ de, em }] }` |
| `GET /conversas/<loja>?desde=<n>` | `{ ultimo, itens: [{ seq, id, chat, deMim, em, tipo, texto, nome? }], mais }` — mensagens das conversas individuais depois do número `desde`, de 500 em 500 (Clientes → Conversas do painel). `chat` = telefone ou `lid:<n>`; `tipo`: texto, imagem, video, audio, documento, figurinha, local, contato (mídia só a marca) |
| `POST /historico/<loja>` `{ dias }` | `{ ok: true }` — importa as conversas dos últimos `dias` (1 a 90); a situação vem em `status().historico` |

Detalhes que o painel pode contar:

- **Envio:** um por vez por loja (os outros esperam na fila); confere se o número tem WhatsApp (tenta com e sem o 9º dígito); mostra "digitando…" de 3 a 7 segundos; envio que não responde em 2 minutos vira `falha`.
- **Mesmo `id` em 24 h não reenvia** e devolve o resultado anterior — inclusive depois de reiniciar o serviço. Ficam guardados: enviado, `sem_whatsapp` e a `falha` que aconteceu **depois** de entregar a mensagem ao WhatsApp (ela pode ter saído; reenviar arriscaria mandar duas). **Não** ficam guardados `desconectado` e a `falha` de antes do envio (não conseguiu conferir o número): nesses nada saiu e o mesmo `id` pode tentar de novo.
- **`/enviar` nunca liga o WhatsApp sozinho:** loja não conectada responde `desconectado`.
- **Queda sem logout:** tenta voltar sozinho (5 s, 30 s, 2 min, 10 min) e mostra `iniciando` com `erro: "… Reconectando…"`; se não voltar, `caiu`. A cada 15 minutos confere se cada loja conectada ainda responde.
- **QR/código que ninguém leu** em uns 5 minutos: fecha o navegador e volta para `desligado` (ou `caiu`, se a loja já tinha estado conectada).
- **Pedidos de saída:** só mensagem de texto **recebida** em conversa **individual**, curta (até 60 caracteres), com uma das palavras inteiras — `parar`, `sair`, `não quero`, `remover`, `descadastrar` — sem ligar para acento, maiúscula ou pontuação. Fica só o último pedido de cada número, por 180 dias. `desde` devolve os pedidos a partir daquela data (inclusive).

## Código

- `server.js` — a API (HTTP puro) e a subida/derrubada do serviço. Recebe a fábrica do cliente do WhatsApp.
- `sessoes.js` — as regras acima, sem conhecer o WhatsApp de verdade (é o que os testes exercitam).
- `wa.js` — o cliente de verdade (whatsapp-web.js + Chromium); só é carregado ao rodar o serviço.
- `tests/` — `node --test zap/tests/*.test.js` (da raiz) ou `npm test` (nesta pasta). Usam um WhatsApp de mentira: nada conecta nem envia, e não precisam de `npm install`.

## Atualizações
O robô é um serviço opcional (`profiles: ["zap"]`): a atualização pelo painel não mexe nele. Quando uma versão nova mudar a pasta `zap/`,
rode de novo na VPS `docker compose --profile zap up -d --build zap` (a sessão do WhatsApp fica em `zap-work/` e é mantida).
