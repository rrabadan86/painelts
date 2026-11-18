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
# Instalação (uma vez, com o mesmo usuário que hoje roda o git pull):
#   chmod +x /opt/teashop-painel/scripts/atualizador.sh
#   (crontab -l 2>/dev/null; echo "* * * * * /opt/teashop-painel/scripts/atualizador.sh") | crontab -
set -u
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
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

# grava em dados/_sistema sem nunca seguir symlinks criados pelo container
publicar() { # $1=nome_arquivo (lê da entrada padrão)
  [ -L "$SIS" ] && return 1
  rm -f "$SIS/$1" 2>/dev/null
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
alvo() { # a versão mais nova (até origin/main) que passou nos testes
  local sha
  for sha in $(G log --format=%H HEAD..origin/main 2>/dev/null); do
    [ "$(resultado "$sha")" = success ] && { echo "$sha"; return; }
  done
}

versao() { # grava a versão instalada e as novidades disponíveis
  {
    printf 'verificado\t%s\n' "$(agora)"
    printf 'atual\t%s\t%s\t%s\n' "$(G rev-parse --short HEAD)" "$(G log -1 --format=%cI HEAD)" "$(G log -1 --format=%s HEAD)"
    G log HEAD..origin/main --format='novo%x09%h%x09%cI%x09%s' 2>/dev/null
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
  G fetch -q origin main >>"$LOG" 2>&1 || echo "$(agora) falha no git fetch" >>"$LOG"
  G fetch -q origin testes:refs/remotes/origin/testes >>"$LOG" 2>&1 || true
}

# 0) backup no Google Drive (scripts/backup.sh): quando o painel pede, ou uma vez por dia entre 3h e 6h.
#    Só marca o dia concluído quando o backup termina ok; se falhar, tenta de novo após 30 min.
if [ -f "$DIR/scripts/backup.sh" ]; then
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
  if temtestes && ! grep -q ' forcar' "$CTL/.pedido.ultimo" 2>/dev/null; then
    DESTINO="$(alvo)"
    if [ -z "$DESTINO" ]; then
      status erro "Nenhuma novidade passou nos testes automáticos ainda. Nada foi instalado."
      versao; exit 0
    fi
  fi
  ANTES="$(G rev-parse HEAD)"
  echo "destino: $(G rev-parse --short "$DESTINO") (antes: $(G rev-parse --short "$ANTES"))" >>"$LOG"
  if G merge --ff-only "$DESTINO" >>"$LOG" 2>&1; then
    if docker compose up -d --build >>"$LOG" 2>&1; then
      status ok "Atualizado para a versão $(G rev-parse --short HEAD)"
      docker image prune -f >>"$LOG" 2>&1
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
if { [ ! -L "$SIS/verificar.pedido" ] && [ -f "$SIS/verificar.pedido" ]; } || [ $(( $(date +%M) % 5 )) -eq 0 ] || [ ! -f "$SIS/versao.txt" ]; then
  rm -f "$SIS/verificar.pedido"
  buscar
  versao
fi
