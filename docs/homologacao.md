# Homologação e versões agrupadas

Decisão do dono (24/11/2026): **toda mudança passa por um painel de teste separado antes da produção**, e a produção
recebe as mudanças **juntas, numa versão liberada pelo dono** (sem dia fixo: quando ele conferir, normalmente uma vez
por semana). Regras HOMOLOG-01 e HOMOLOG-02 na matriz (`docs/rastreabilidade.md`).

## Como uma mudança chega à loja

```
PR (testes do GitHub ✓) ─▶ main ─▶ HOMOLOGAÇÃO instala sozinha (até 5 min)
                                        │ o dono confere com o roteiro do PR
                                        ▼
                         dono: "pode liberar" ─▶ Claude cria a versão (tag versao-AAAA-MM-DD + notas)
                                        ▼
                         PRODUÇÃO: Configurações → Atualizações do painel → instalar → Ctrl+F5
```

- **Correção urgente** (algo quebrado nas lojas): exceção — passa pela homologação na hora e é liberada no mesmo dia.
- **Voltar atrás:** a produção só avança; para voltar a uma versão anterior, `git checkout versao-…` num ramo novo na VPS
  (nunca reescrever o `main`) — peça ao Claude o passo a passo.
- **Robôs** (AppNext, FIXE, Sistema de Pedidos, WhatsApp): a homologação não fala com eles. O que mexe neles traz no PR
  um roteiro de conferência na produção, numa loja primeiro.

## O que é a homologação

| | Produção | Homologação |
|---|---|---|
| Pasta na VPS | `/opt/teashop-painel` | `/opt/teashop-homolog` |
| Endereço | o de sempre | `homolog.<domínio>` (Caddy → `127.0.0.1:3001`) |
| Código | só versões liberadas (`versao-AAAA-MM-DD`) | o `main` testado, instalado sozinho |
| Dados | as lojas | cópia de uma loja (Flamboyant), renovada quando o dono pede |
| Coletor, WhatsApp, e-mail, Telegram, notificações, IA, GitHub, Gmail da FIXE | ligados | **recusados no servidor** (`PAINEL_AMBIENTE=homologacao`) |
| Na tela | normal | faixa amarela "HOMOLOGAÇÃO" embaixo e `[HOMOLOG]` no título da aba |
| Backup no Google Drive | sim | não (é cópia) |

A cópia (`scripts/homolog-copiar.sh`) leva `dados/<loja>` **sem** as conversas do WhatsApp, a fila de envio e o estado do
robô, e um `lojas.json` só com aquela loja, os usuários dela e os administradores (mesmo login). **Nunca** copia as
senhas do AppNext/FIXE (`config/coletor`), a chave da IA, as chaves das notificações, a sessão do WhatsApp nem o `.env`.
Nada da homologação volta para a produção.

## Instalação na VPS (uma vez, ~20 minutos)

1. **DNS:** no painel do domínio, crie um registro `A` para `homolog` apontando para o IP da VPS.
2. **Pasta e código:**
   ```bash
   cd /opt && git clone /opt/teashop-painel teashop-homolog
   git -C teashop-homolog remote set-url origin "$(git -C /opt/teashop-painel remote get-url origin)"
   cd /opt/teashop-homolog && git checkout -q main && mkdir -p config dados
   ```
   (clona da própria produção e usa o mesmo acesso ao GitHub que ela já tem.)
3. **`.env` da homologação** (`/opt/teashop-homolog/.env`): copie o da produção e mude o seguinte — o Claude nunca vê
   este arquivo:
   ```
   PAINEL_AMBIENTE=homologacao
   SESSION_SECRET=<outro valor, diferente da produção>
   ```
   e apague as linhas de senha de e-mail/SMTP, `ZAP_TOKEN`, `COLETOR_TOKEN` e `GITHUB_TOKEN` (a homologação não usa).
4. **Copiar a loja:**
   ```bash
   bash /opt/teashop-painel/scripts/homolog-copiar.sh goiania
   ```
   (`goiania` é o id da loja do Flamboyant nos dados; confira com `ls /opt/teashop-painel/dados`.)
5. **Subir:**
   ```bash
   cd /opt/teashop-homolog && docker compose -p teashop-homolog -f docker-compose.homolog.yml up -d --build
   ```
6. **Caddy** (`/etc/caddy/Caddyfile`), um bloco novo, e recarregar:
   ```
   homolog.<seu domínio> {
       reverse_proxy 127.0.0.1:3001
   }
   ```
   `sudo systemctl reload caddy`
7. **Atualizador da homologação** (instala sozinho cada versão testada e faz a cópia pedida pela tela):
   ```bash
   (crontab -l 2>/dev/null; echo "* * * * * /opt/teashop-homolog/scripts/atualizador.sh") | crontab -
   ```
8. **Conferir:** abra `https://homolog.<domínio>`, entre com o seu usuário: a faixa amarela aparece embaixo. Em
   Configurações → Atualizações do painel aparecem o aviso da homologação e o botão "Copiar de novo a loja … da produção".

Memória: só o painel (~350 MB). O KVM 2 comporta.

## Versões liberadas (produção)

- Uma versão é uma **tag anotada** no `main`: `versao-AAAA-MM-DD` (mais de uma no mesmo dia: `-2`, `-3`), com as notas
  na mensagem (o que entrou, uma linha por mudança). Quem cria é o Claude, quando o dono diz "pode liberar":
  ```bash
  git fetch origin main && git tag -a versao-2026-11-28 <sha conferido na homologação> -m "Versão de 28/11: …" && git push origin versao-2026-11-28
  ```
  Só um commit que **passou nos testes do GitHub** e foi **o mesmo conferido na homologação**.
- O atualizador da produção (`scripts/atualizador.sh`) passa sozinho para o modo "versões" assim que existir a primeira
  tag `versao-*`: a tela "Atualizações do painel" mostra só o que vai até a versão liberada mais nova e diz qual é.
  Antes da primeira versão, tudo segue como era (o `main` testado).
- As tags `DDMMAAAA-Claude` continuam sendo os pontos de backup pedidos pelo dono (viram Release no GitHub) e não
  mudam nada na instalação.
