#!/usr/bin/env bash
# Atualizador do painel — roda NA VPS (fora do Docker), pelo cron, a cada minuto.
#
#  - de 5 em 5 minutos (ou quando o painel pede "verificar"), faz git fetch e grava
#    dados/_sistema/versao.txt com a versão atual e as novidades ainda não instaladas;
#  - quando o administrador clica em "Atualizar agora" no painel, o painel grava
#    dados/_sistema/atualizar.pedido; aqui o pedido vira:
#        git pull --ff-only && docker compose up -d --build
#
# O painel nunca roda comandos: ele só deixa o pedido. Nada de docker.sock no container.
#
# Dois trilhos (decisão do dono, 24/11/2026 — homologação e versões agrupadas; HOMOLOG-02):
#  - PRODUÇÃO: assim que existir a primeira versão liberada (tag "versao-AAAA-MM-DD" no GitHub), só instala
#    versões liberadas que passaram nos testes; antes disso, segue o main testado como sempre foi.
#  - HOMOLOGAÇÃO (.env com PAINEL_AMBIENTE=homologacao, pasta própria, docker-compose.homolog.yml): segue o main
#    testado e instala SOZINHA cada versão nova, para o dono conferir antes de liberar.
#
# Instalação (uma vez, com o mesmo usuário que hoje roda o git pull):
#   chmod +x /opt/teashop-painel/scripts/atualizador.sh
#   (crontab -l 2>/dev/null; echo "* * * * * /opt/teashop-painel/scripts/atualizador.sh") | crontab -
set -u
export PATH="${ATUALIZADOR_PATH_TESTE:+$ATUALIZADOR_PATH_TESTE:}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" # o teste põe um "docker" de mentira na frente
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIS="$DIR/dados/_sistema"
CTL="$DIR/.atualizador"
[ -L "$SIS" ] && exit 1
mkdir -p "$SIS" "$CTL" || exit 1
chmod 700 "$CTL" 2>/dev/null
# o painel (usuário 1000 no container) grava os pedidos aqui: grupo 1000 sem liberar escrita geral (nunca 777)
if chgrp 1000 "$SIS" 2>/dev/null; then chmod 2770 "$SIS" 2>/dev/null; else chmod 755 "$SIS" 2>/dev/null; fi
exec 9>"$CTL/.lock"
flock -n 9 || exit 0           # já tem uma atualização rodando
cd "$DIR" || exit 1
G() { git -c safe.directory="$DIR" "$@"; }
LOG="$CTL/atualizacao.log"
agora() { date -Iseconds; }
HOMOLOG=0
grep -qiE '^[[:space:]]*PAINEL_AMBIENTE=["'"'"']?homologacao' "$DIR/.env" 2>/dev/null && HOMOLOG=1
if [ "$HOMOLOG" = 1 ]; then COMPOSE=(docker compose -p teashop-homolog -f docker-compose.homolog.yml); else COMPOSE=(docker compose); fi
PRODD="${PROD_DIR:-/opt/teashop-painel}"
# versões liberadas (HOMOLOG-03, decisão do dono 24/11/2026): o admin libera pelo painel da homologação e o atualizador dela
# anota aqui, na pasta de controle da PRODUÇÃO (mesma VPS): sha<TAB>quando<TAB>quem<TAB>assunto, uma por linha, a mais nova no fim.
# As tags "versao-AAAA-MM-DD" do GitHub continuam valendo (depois das liberadas pelo painel).
if [ "$HOMOLOG" = 1 ]; then LIBF="$PRODD/.atualizador/liberadas.txt"; else LIBF="$CTL/liberadas.txt"; fi
liberadas() { # sha<TAB>rótulo<TAB>quem<TAB>assunto, a mais nova primeiro
  if [ -f "$LIBF" ]; then tac "$LIBF" | awk -F'\t' 'length($1) == 40 && $1 ~ /^[0-9a-f]+$/ { print $1 "\t" $2 "\t" $3 "\t" $4 }'; fi
  local t
  for t in $(G tag -l 'versao-*' --sort=-creatordate 2>/dev/null | grep -E '^versao-[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?$'); do
    printf '%s\t%s\t\t%s\n' "$(G rev-list -n1 "$t" 2>/dev/null)" "$t" "$(G tag -l "$t" --format='%(contents:subject)' | tr '\t' ' ')"
  done
}
porversoes() { [ "$HOMOLOG" = 0 ] && [ -n "$(liberadas | head -1)" ]; }

# grava em dados/_sistema sem nunca seguir symlinks criados pelo container
publicar() { # $1=nome_arquivo (lê da entrada padrão)
  [ -L "$SIS" ] && return 1
  # sem apagar antes: o "mv -f" troca o arquivo (ou um symlink) de uma vez só. Apagar antes deixava o painel sem
  # versao.txt enquanto o git buscava as novidades (segundos, a cada 5 min) e a tela pedia para "instalar o atualizador"
  local tmp
  tmp="$(mktemp "$SIS/.tmp.${1}.XXXXXX")" || return 1
  cat > "$tmp" && chmod 644 "$tmp" 2>/dev/null && mv -f "$tmp" "$SIS/$1"
}

status() { # estado (ok|erro|atualizando) e mensagem
  printf '%s\t%s\t%s\n' "$1" "$(agora)" "$2" | publicar status.txt
}

# resultado dos testes automáticos de cada versão (o GitHub grava no ramo "testes": sha, resultado, data, link)
temtestes() { G rev-parse -q --verify origin/testes >/dev/null 2>&1; }
resultado() { # sha completo -> success | failure | cancelled | (vazio = ainda testando)
  G show origin/testes:resultados.txt 2>/dev/null | awk -F'\t' -v s="$1" '$1==s {r=$2} END {print r}'
}
alvo() { # produção com versões: a versão liberada mais nova, à frente da instalada e testada; senão a mais nova do main que passou nos testes
  local sha t
  if porversoes; then
    for sha in $(liberadas | cut -f1); do
      G cat-file -e "$sha^{commit}" 2>/dev/null || continue   # ainda não chegou pelo fetch
      [ "$sha" = "$(G rev-parse HEAD)" ] && return          # a mais nova já está instalada
      G merge-base --is-ancestor HEAD "$sha" 2>/dev/null || continue
      { ! temtestes || [ "$(resultado "$sha")" = success ]; } && { echo "$sha"; return; }
    done
    return
  fi
  for sha in $(G log --format=%H HEAD..origin/main 2>/dev/null); do
    [ "$(resultado "$sha")" = success ] && { echo "$sha"; return; }
  done
}
nomeversao() { # sha -> "liberada em <quando> por <quem>" ou o nome da tag (vazio se não for uma versão liberada)
  liberadas | awk -F'\t' -v s="$1" '$1 == s { if ($2 ~ /^versao-/) print $2; else print "liberada em " substr($2, 9, 2) "/" substr($2, 6, 2) " por " $3; exit }'
}

versao() { # grava a versão instalada e as novidades disponíveis
  {
    printf 'verificado\t%s\n' "$(agora)"
    printf 'atual\t%s\t%s\t%s\n' "$(G rev-parse --short HEAD)" "$(G log -1 --format=%cI HEAD)" "$(G log -1 --format=%s HEAD)"
    printf 'ambiente\t%s\n' "$([ "$HOMOLOG" = 1 ] && echo homologacao || echo producao)"
    if porversoes; then
      printf 'trilho\tversoes\n'
      a="$(alvo)"; [ -n "$a" ] && G log "HEAD..$a" --format='novo%x09%h%x09%cI%x09%s' 2>/dev/null
      liberadas | head -6 | awk -F'\t' '{ printf "versao\t%s\t%s\t%s\t%s\n", substr($1, 1, 7), $2, $3, $4 }'
    else
      G log HEAD..origin/main --format='novo%x09%h%x09%cI%x09%s' 2>/dev/null
      # homologação: o que já foi liberado para a produção (a tela marca a versão instalada aqui)
      [ "$HOMOLOG" = 1 ] && liberadas | head -6 | awk -F'\t' '{ printf "versao\t%s\t%s\t%s\t%s\n", substr($1, 1, 7), $2, $3, $4 }'
    fi
    G log -12 HEAD --format='recente%x09%h%x09%cI%x09%s' 2>/dev/null
    if temtestes; then
      printf 'testes\ton\n'
      for sha in $(G log --format=%H HEAD..origin/main 2>/dev/null); do
        G show origin/testes:resultados.txt 2>/dev/null | awk -F'\t' -v s="$sha" -v c="$(G rev-parse --short "$sha")" '$1==s {r=$2; u=$4} END {if (r!="") printf "teste\t%s\t%s\t%s\n", c, r, u}'
      done
      a="$(alvo)"
      if [ -n "$a" ]; then printf 'alvo\t%s\n' "$(G rev-parse --short "$a")"; fi
    fi
    true
  } | publicar versao.txt
}

buscar() {
  G fetch -q --tags origin main >>"$LOG" 2>&1 || echo "$(agora) falha no git fetch" >>"$LOG"
  G fetch -q origin testes:refs/remotes/origin/testes >>"$LOG" 2>&1 || true
}

# 0) backup no Google Drive (scripts/backup.sh): quando o painel pede, ou uma vez por dia entre 3h e 6h.
#    Só marca o dia concluído quando o backup termina ok; se falhar, tenta de novo após 30 min.
if [ -f "$DIR/scripts/backup.sh" ] && [ "$HOMOLOG" = 0 ]; then # a homologação é cópia: não entra no backup
  HOJE="$(date +%F)"; H=$((10#$(date +%H)))
  PED_BKP=0
  [ ! -L "$SIS/backup.pedido" ] && [ -f "$SIS/backup.pedido" ] && PED_BKP=1
  RECENTE_BKP=0
  find "$CTL" -maxdepth 1 -name '.backup.tentativa' -mmin -30 2>/dev/null | grep -q . && RECENTE_BKP=1
  if [ "$PED_BKP" = 1 ] || { [ "$H" -ge 3 ] && [ "$H" -lt 6 ] && [ ! -f "$CTL/.backup.dia.$HOJE" ] && [ "$RECENTE_BKP" = 0 ]; }; then
    touch "$CTL/.backup.tentativa"
    find "$CTL" -maxdepth 1 -name '.backup.dia.*' -mtime +3 -delete 2>/dev/null
    nohup bash "$DIR/scripts/backup.sh" </dev/null >/dev/null 2>&1 9>&- &
  fi
fi

# 0b) homologação: o admin pediu para copiar de novo uma loja da produção (scripts/homolog-copiar.sh da produção)
if [ "$HOMOLOG" = 1 ] && [ ! -L "$SIS/copiar.pedido" ] && [ -f "$SIS/copiar.pedido" ]; then
  LJ="$(head -c 40 "$SIS/copiar.pedido" | tr -cd 'a-z0-9_-')"
  rm -f "$SIS/copiar.pedido"
  echo "===== $(agora) cópia da loja ${LJ:-?} da produção =====" >>"$LOG"
  if [ -n "$LJ" ] && HOMOLOG_DIR="$DIR" PROD_DIR="$PRODD" bash "$PRODD/scripts/homolog-copiar.sh" "$LJ" >>"$LOG" 2>&1; then
    status ok "Loja $LJ copiada da produção em $(date '+%d/%m %H:%M')"
  else
    status erro "A cópia da loja ${LJ:-?} falhou. Veja o log da atualização."
  fi
  publicar atualizacao.log < "$LOG"
fi

# 0c) homologação: o admin liberou a versão que está aqui para a produção (HOMOLOG-03). Só a versão instalada aqui,
#     só se passou nos testes do GitHub; anota na pasta de controle da produção e pede a ela que verifique já.
if [ "$HOMOLOG" = 1 ] && [ ! -L "$SIS/liberar.pedido" ] && [ -f "$SIS/liberar.pedido" ]; then
  PED_LIB="$(head -c 200 "$SIS/liberar.pedido" | tr -cd '[:alnum:] ._@-')"
  rm -f "$SIS/liberar.pedido"
  POR_LIB="${PED_LIB%% *}"; SHA_LIB="${PED_LIB##* }"
  HEADF="$(G rev-parse HEAD)"
  echo "===== $(agora) liberação pedida por ${POR_LIB:-?} (${SHA_LIB:-?}) =====" >>"$LOG"
  if [ -z "$SHA_LIB" ] || [ "${#SHA_LIB}" -lt 7 ] || [ "${HEADF#"$SHA_LIB"}" = "$HEADF" ]; then
    status erro "A versão pedida não é a que está na homologação agora. Recarregue a página e confira de novo."
  elif temtestes && [ "$(resultado "$HEADF")" != success ]; then
    status erro "Esta versão ainda não passou nos testes automáticos: espere o resultado para liberar."
  elif [ ! -d "$PRODD/.atualizador" ]; then
    status erro "Não achei a produção em $PRODD (o atualizador dela precisa estar instalado)."
  else
    if [ "$(tail -n1 "$LIBF" 2>/dev/null | cut -f1)" != "$HEADF" ]; then
      printf '%s\t%s\t%s\t%s\n' "$HEADF" "$(agora)" "${POR_LIB:-?}" "$(G log -1 --format=%s HEAD | tr '\t' ' ')" >> "$LIBF"
    fi
    [ -d "$PRODD/dados/_sistema" ] && [ ! -L "$PRODD/dados/_sistema" ] && : > "$PRODD/dados/_sistema/verificar.pedido" 2>/dev/null
    status ok "Versão $(G rev-parse --short HEAD) liberada para a produção. Lá ela aparece em Atualizações do painel em até 1 minuto."
  fi
  versao
  publicar atualizacao.log < "$LOG"
fi

# 1) pedido de atualização
if [ ! -L "$SIS/atualizar.pedido" ] && [ -f "$SIS/atualizar.pedido" ]; then
  POR="$(head -c 200 "$SIS/atualizar.pedido" | tr -cd '[:alnum:] ._@:-')"
  printf '%s\n' "$POR" > "$CTL/.pedido.ultimo"
  rm -f "$SIS/atualizar.pedido"
  echo "===== $(agora) atualização pedida por ${POR:-?} =====" >>"$LOG"
  status atualizando "Baixando a versão nova e reconstruindo o painel"
  buscar
  # só instala até a versão mais nova que passou nos testes automáticos ("forcar" no pedido instala tudo)
  DESTINO=origin/main
  if porversoes || { temtestes && ! grep -q ' forcar' "$CTL/.pedido.ultimo" 2>/dev/null; }; then
    DESTINO="$(alvo)"
    if [ -z "$DESTINO" ]; then
      if porversoes; then status ok "Nenhuma versão liberada nova. Nada foi instalado."; else status erro "Nenhuma novidade passou nos testes automáticos ainda. Nada foi instalado."; fi
      versao; exit 0
    fi
  fi
  ANTES="$(G rev-parse HEAD)"
  echo "destino: $(G rev-parse --short "$DESTINO") (antes: $(G rev-parse --short "$ANTES"))" >>"$LOG"
  if G merge --ff-only "$DESTINO" >>"$LOG" 2>&1; then
    if "${COMPOSE[@]}" up -d --build >>"$LOG" 2>&1; then
      NV="$(nomeversao "$(G rev-parse HEAD)")"
      status ok "Atualizado para a versão $(G rev-parse --short HEAD)${NV:+ ($NV)}"
      docker image prune -f >>"$LOG" 2>&1
      # cache de montagem com mais de 7 dias (pedido do dono, 23/11/2026: chegou a 6,3 GB). O da última semana fica:
      # a próxima atualização continua rápida. Não mexe no painel nem nos dados.
      docker builder prune -f --filter until=168h >>"$LOG" 2>&1
    else
      echo "$(agora) docker compose falhou; voltando git para $ANTES" >>"$LOG"
      G reset --hard "$ANTES" >>"$LOG" 2>&1 || true
      status erro "A reconstrução do painel falhou (versão mantida). Veja dados/_sistema/atualizacao.log."
    fi
  else
    status erro "A atualização falhou no git merge. Veja dados/_sistema/atualizacao.log na VPS."
  fi
  versao
  tail -n 600 "$LOG" > "$LOG.tmp" 2>/dev/null && mv -f "$LOG.tmp" "$LOG"
  publicar atualizacao.log < "$LOG"
  exit 0
fi

# 2) verificação: a cada 5 min ou quando o painel pede
if { [ ! -L "$SIS/verificar.pedido" ] && [ -f "$SIS/verificar.pedido" ]; } || [ $(( 10#$(date +%M) % 5 )) -eq 0 ] || [ ! -f "$SIS/versao.txt" ]; then
  rm -f "$SIS/verificar.pedido"
  buscar
  versao
  # homologação: instala sozinha a versão nova testada (no próximo minuto), para o dono conferir antes de liberar
  if [ "$HOMOLOG" = 1 ] && [ -n "$(alvo)" ] && [ ! -f "$SIS/atualizar.pedido" ]; then
    echo "homologação (automático)" | publicar atualizar.pedido
  fi
fi
