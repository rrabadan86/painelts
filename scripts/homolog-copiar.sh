#!/usr/bin/env bash
# Copia uma loja da PRODUÇÃO para a HOMOLOGAÇÃO (roda na VPS, fora do Docker; HOMOLOG-01).
#   bash /opt/teashop-painel/scripts/homolog-copiar.sh goiania
# - dados/<loja> inteiro, MENOS o que é privado ou só serve para enviar: conversas do WhatsApp, fila de envio
#   e estado do robô (a homologação nunca envia nada);
# - config/lojas.json só com essa loja e os usuários dela + os administradores (senhas como estão: mesmo login);
# - nunca copia: config/coletor (senhas do AppNext/FIXE), config/ia.json e a chave da IA, as chaves das notificações,
#   aparelhos, sessão do WhatsApp (zap-work) nem o .env.
set -euo pipefail
LOJA="${1:-}"
PROD="${PROD_DIR:-/opt/teashop-painel}"
HOM="${HOMOLOG_DIR:-/opt/teashop-homolog}"
[[ "$LOJA" =~ ^[a-z0-9_-]+$ ]] || { echo "Uso: $0 <id da loja>  (ex.: goiania)"; exit 1; }
[ -d "$PROD/dados/$LOJA" ] || { echo "Loja '$LOJA' não existe em $PROD/dados"; exit 1; }
[ -d "$HOM" ] || { echo "Pasta da homologação $HOM não existe (veja docs/homologacao.md)"; exit 1; }
grep -qiE '^[[:space:]]*PAINEL_AMBIENTE=["'"'"']?homologacao' "$HOM/.env" || { echo "$HOM/.env precisa de PAINEL_AMBIENTE=homologacao"; exit 1; }
mkdir -p "$HOM/dados" "$HOM/config"
rm -rf "$HOM/dados/$LOJA.novo" && cp -a "$PROD/dados/$LOJA" "$HOM/dados/$LOJA.novo"
rm -rf "$HOM/dados/$LOJA.novo/conversas" "$HOM/dados/$LOJA.novo/envio" "$HOM/dados/$LOJA.novo/zap"
find "$HOM/dados/$LOJA.novo" -name 'push*' -exec rm -rf {} + 2>/dev/null || true
rm -rf "$HOM/dados/$LOJA" && mv "$HOM/dados/$LOJA.novo" "$HOM/dados/$LOJA"
# cadastros da rede que a tela usa (site, fotos): só leitura, sem nada de cliente
if [ -d "$PROD/dados/site" ]; then rm -rf "$HOM/dados/site" && cp -a "$PROD/dados/site" "$HOM/dados/site"; fi
python3 - "$PROD/config/lojas.json" "$HOM/config/lojas.json" "$LOJA" <<'PY'
import json, os, sys
orig, dest, loja = sys.argv[1:4]
c = json.load(open(orig, encoding="utf-8"))
lojas = [l for l in c.get("lojas", []) if l and str(l.get("id", "")).lower() == loja]
usuarios = {}
for n, u in (c.get("usuarios") or {}).items():
    ls = [str(x) for x in (u.get("lojas") or [])]
    if u.get("perfil") == "admin" or "*" in ls: usuarios[n] = dict(u)
    elif loja in ls: usuarios[n] = {**u, "lojas": [loja]}
fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
with os.fdopen(fd, "w", encoding="utf-8") as f: json.dump({"lojas": lojas, "usuarios": usuarios}, f, ensure_ascii=False, indent=2); f.write("\n")
print(f"lojas.json da homologação: {len(lojas)} loja, {len(usuarios)} usuário(s)")
PY
chown -R 1000:1000 "$HOM/dados" "$HOM/config" 2>/dev/null || true
echo "Pronto: a loja '$LOJA' foi copiada para a homologação em $(date '+%d/%m/%Y %H:%M'). Recarregue o painel de homologação."
