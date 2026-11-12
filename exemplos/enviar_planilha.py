"""
Envia uma planilha para o painel Tea Shop na VPS.
Use no fim do seu script diário, logo depois de baixar o relatório.

    python enviar_planilha.py torres importacaoA "C:/caminho/relatorio.xlsx"

Sem dependências: só a biblioteca padrão do Python 3.
"""
import sys
import json
import urllib.request
import urllib.error

PAINEL = "https://painel.seudominio.com.br"   # endereço do painel
TOKEN = "COLE_AQUI_O_TOKEN_DE_UPLOAD"           # gerado com: node scripts/admin.js token


def enviar(loja: str, arquivo: str, caminho: str) -> dict:
    with open(caminho, "rb") as f:
        dados = f.read()
    req = urllib.request.Request(
        f"{PAINEL}/api/upload/{loja}/{arquivo}",
        data=dados,
        method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Falha no envio ({e.code}): {e.read().decode('utf-8', 'replace')}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("uso: python enviar_planilha.py <loja> <arquivo> <caminho.xlsx>")
    print(enviar(*sys.argv[1:]))
