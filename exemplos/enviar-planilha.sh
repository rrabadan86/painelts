#!/usr/bin/env bash
# Envia uma planilha para o painel Tea Shop.
# uso: ./enviar-planilha.sh <loja> <arquivo> <caminho.xlsx>
#  ex: ./enviar-planilha.sh torres importacaoA /tmp/relatorio.xlsx
set -euo pipefail
PAINEL="https://painel.seudominio.com.br"
TOKEN="COLE_AQUI_O_TOKEN_DE_UPLOAD"
curl --fail-with-body -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary @"$3" \
  "$PAINEL/api/upload/$1/$2"
echo
