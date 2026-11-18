#!/usr/bin/env bash
# Configura o backup no Google Drive (uma vez), NA VPS, com o mesmo usuário que roda o atualizador:
#   bash /opt/teashop-painel/scripts/backup-configurar.sh
# Pede a autorização do Google (o token vem do seu computador) e cria a chave de criptografia.
set -eu
PASTA_ID="${1:-15lgoUPyTMn-00tQeW_FdL0fOwWpOpf5o}"   # pasta "BKP VPS" no seu Google Drive
DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "== Backup do painel no Google Drive =="
if ! command -v rclone >/dev/null 2>&1; then
  echo "Instalando o rclone (programa de cópia para o Drive)…"
  curl -fsSL https://rclone.org/install.sh | sudo bash
fi
if rclone listremotes | grep -qx 'teashop-cripto:'; then
  echo "O backup já está configurado. Para refazer: rclone config delete teashop-cripto; rclone config delete teashop-drive"
  exit 0
fi
cat <<TXT

1) No SEU COMPUTADOR (Windows), autorize o acesso ao Google Drive:
   - baixe o rclone em https://rclone.org/downloads/ (Windows, "Intel/AMD - 64 Bit"), descompacte;
   - abra o Prompt de Comando na pasta descompactada e rode:
         rclone authorize "drive"
   - o navegador abre: entre na conta Google dona da pasta "BKP VPS" e clique em Permitir;
   - o Prompt mostra um texto entre ---> e <---End paste. Copie TUDO o que está entre eles (começa com {"access_token").

TXT
read -r -p "2) Cole aqui o token e tecle Enter: " TOKEN
case "$TOKEN" in \{*access_token*) ;; *) echo "Isso não parece o token (deve começar com {\"access_token\"). Rode de novo."; exit 1;; esac
umask 077
RCLONE_CONF="$(rclone config file | tail -n1)"
mkdir -p "$(dirname "$RCLONE_CONF")"
cat >> "$RCLONE_CONF" <<EOF

[teashop-drive]
type = drive
scope = drive
root_folder_id = $PASTA_ID
token = $TOKEN
EOF
chmod 600 "$RCLONE_CONF"
rclone lsd teashop-drive: >/dev/null || { echo "Não consegui acessar a pasta do Drive. Confira a conta usada na autorização."; rclone config delete teashop-drive; exit 1; }
SENHA="$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-32)"
SAL="$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-32)"
SENHA_OBS="$(printf '%s' "$SENHA" | rclone obscure -)"
SAL_OBS="$(printf '%s' "$SAL" | rclone obscure -)"
cat >> "$RCLONE_CONF" <<EOF

[teashop-cripto]
type = crypt
remote = teashop-drive:painel
filename_encryption = standard
directory_name_encryption = true
password = $SENHA_OBS
password2 = $SAL_OBS
EOF
chmod 600 "$RCLONE_CONF"
cat <<TXT

==================================================================================
 3) GUARDE ESTAS DUAS SENHAS FORA DA VPS (gerenciador de senhas ou papel).
    Sem elas o backup NÃO pode ser aberto — nem por você, nem por ninguém.

    Senha:  $SENHA
    Sal:    $SAL
==================================================================================
Para restaurar numa VPS nova: instale o rclone, crie "teashop-drive" (mesma pasta) e
"teashop-cripto" (crypt, remote=teashop-drive:painel, com estas duas senhas) e rode:
    rclone copy teashop-cripto:atual/dados /opt/teashop-painel/dados
    rclone copy teashop-cripto:atual/config /opt/teashop-painel/config
    rclone copyto teashop-cripto:atual/env/painel.env /opt/teashop-painel/.env
TXT
read -r -p "Já guardou as senhas? Digite SIM para fazer o primeiro backup agora: " R
[ "$R" = "SIM" ] || [ "$R" = "sim" ] || { echo "Ok. O primeiro backup roda esta madrugada (ou pelo botão no painel)."; exit 0; }
echo "Fazendo o primeiro backup (a primeira vez envia tudo; as próximas, só o que mudou)…"
bash "$DIR/scripts/backup.sh"
cut -f1,3,4,5 "$DIR/dados/_sistema/backup.txt"
