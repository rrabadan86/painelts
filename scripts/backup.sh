#!/usr/bin/env bash
# Backup do painel no Google Drive — roda NA VPS (fora do Docker), chamado pelo atualizador:
#   - todo dia de madrugada (entre 3h e 6h, uma vez por dia) e quando o administrador pede no painel;
#   - copia dados/, config/ e o .env para a pasta do Drive, CRIPTOGRAFADOS (rclone crypt: nomes e conteúdo);
#   - só envia o que mudou desde o último backup (incremental);
#   - o que foi alterado ou apagado vai para versoes/<data>/ e fica 30 dias (dá para voltar um arquivo a um dia anterior).
# Configuração (uma vez): scripts/backup-configurar.sh
set -u
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIS="$DIR/dados/_sistema"
mkdir -p "$SIS" || exit 1
exec 8>"$SIS/.backup.lock"
flock -n 8 || exit 0
REM="teashop-cripto:"
LOG="$SIS/backup.log"
agora() { date -Iseconds; }
estado() { # estado (ok|erro|rodando|nao_configurado) · quando · bytes no Drive · arquivos · mensagem
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$(agora)" "${2:-}" "${3:-}" "${4:-}" > "$SIS/backup.txt.tmp" && mv -f "$SIS/backup.txt.tmp" "$SIS/backup.txt"
  chmod 644 "$SIS/backup.txt" 2>/dev/null
}
rm -f "$SIS/backup.pedido"
if ! command -v rclone >/dev/null 2>&1 || ! rclone listremotes 2>/dev/null | grep -qx "$REM"; then
  estado nao_configurado "" "" "Rode scripts/backup-configurar.sh na VPS (uma vez)."
  exit 0
fi
estado rodando "" "" "Enviando para o Google Drive…"
DIA="$(date +%F)"
OPC=(--fast-list --transfers 4 --checkers 8 --retries 3 --low-level-retries 10 --log-level NOTICE --log-file "$LOG")
{
  echo "=== backup $(agora) ==="
} > "$LOG"
ok=1
rclone sync "$DIR/dados" "${REM}atual/dados" --backup-dir "${REM}versoes/$DIA/dados" \
  --exclude "_sistema/*.lock" --exclude "_sistema/.*" --exclude "_sistema/backup.*" "${OPC[@]}" || ok=0
rclone sync "$DIR/config" "${REM}atual/config" --backup-dir "${REM}versoes/$DIA/config" --exclude "*.lock" "${OPC[@]}" || ok=0
[ -f "$DIR/.env" ] && { rclone copyto "$DIR/.env" "${REM}atual/env/painel.env" --backup-dir "${REM}versoes/$DIA/env" "${OPC[@]}" || ok=0; }
# versões com mais de 30 dias saem
rclone delete "${REM}versoes" --min-age 30d "${OPC[@]}" >/dev/null 2>&1
rclone rmdirs "${REM}versoes" --leave-root "${OPC[@]}" >/dev/null 2>&1
TAM="$(rclone size "${REM}atual" --json 2>/dev/null)"
BYTES="$(printf '%s' "$TAM" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
ARQS="$(printf '%s' "$TAM" | sed -n 's/.*"count":\([0-9]*\).*/\1/p')"
if [ "$ok" = 1 ]; then
  estado ok "$BYTES" "$ARQS" "Backup completo."
  printf '%s\t%s\t%s\n' "$(agora)" "$BYTES" "$ARQS" > "$SIS/backup.ok"; chmod 644 "$SIS/backup.ok" 2>/dev/null
else
  estado erro "$BYTES" "$ARQS" "$(grep -m1 -iE 'error|erro|failed' "$LOG" | cut -c1-300)"
fi
chmod 644 "$LOG" 2>/dev/null
