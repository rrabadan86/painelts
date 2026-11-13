#!/usr/bin/env python3
# Pede ao FIXE (dash.epossible.com.br) a exportação da "Base de leads" (cadastro) e dos "Logs" (compras, pontos e resgates).
# O FIXE manda um e-mail com o link "Baixar agora"; o PAINEL lê esse e-mail (IMAP do Gmail da loja),
# baixa a planilha e importa no cadastro. Aqui só fazemos o pedido e deixamos um aviso para o painel.
# Variáveis: FIXE_URL (página de Leads da loja), FIXE_USER, FIXE_PASS, FIXE_EMAIL (para onde mandar), SAIDA_FIXE (aviso .json)
import json
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo(os.getenv("TZ") or "America/Sao_Paulo")
except Exception:  # noqa: BLE001
    TZ = None

from playwright.sync_api import sync_playwright

URL = os.getenv("FIXE_URL", "").strip()
USER = os.getenv("FIXE_USER", "").strip()
PASS = os.getenv("FIXE_PASS", "")
EMAIL = os.getenv("FIXE_EMAIL", "").strip()
SAIDA = os.getenv("SAIDA_FIXE", "").strip()


def log(msg):
    print(f"[{datetime.now(TZ).strftime('%H:%M:%S')}] {msg}", flush=True)


def tela(page):
    try:
        return page.evaluate("() => document.body.innerText.slice(0, 300)").replace("\n", " | ")
    except Exception:  # noqa: BLE001
        return "?"


def primeiro(page, seletores, timeout=15000):
    """primeiro elemento visível entre os seletores (espera até aparecer algum)"""
    fim = datetime.now().timestamp() + timeout / 1000
    while datetime.now().timestamp() < fim:
        for s in seletores:
            loc = page.locator(s)
            try:
                if loc.count() and loc.first.is_visible():
                    return loc.first
            except Exception:  # noqa: BLE001
                pass
        page.wait_for_timeout(400)
    return None


def main():
    if not (URL and USER and PASS and EMAIL and SAIDA):
        log("ERRO: acesso ao FIXE incompleto (endereço, usuário, senha e e-mail de destino).")
        return 2
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 1400, "height": 900}, locale="pt-BR",
                            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36")
        page = ctx.new_page()
        page.set_default_timeout(30000)
        try:
            log("1) Abrindo o FIXE")
            page.goto(URL, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2500)
            senha = primeiro(page, ["input[type=password]"], 8000)
            if senha:
                log("2) Login")
                usuario = primeiro(page, ["input[type=email]", "input[name*=email i]", "input[name*=user i]", "input[type=text]"], 5000)
                if not usuario:
                    raise RuntimeError(f"não achei o campo de usuário na tela de login. Na tela: {tela(page)}")
                usuario.fill(USER)
                senha.fill(PASS)
                botao = primeiro(page, ["button[type=submit]", "button:has-text('Entrar')", "button:has-text('Login')", "button:has-text('Acessar')"], 3000)
                (botao.click() if botao else senha.press("Enter"))
                page.wait_for_timeout(4000)
                if primeiro(page, ["input[type=password]"], 1500):
                    raise RuntimeError(f"o login não passou (usuário ou senha do FIXE?). Na tela: {tela(page)}")
                if "/leads" not in page.url:
                    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
                    page.wait_for_timeout(2500)
            feitos = []
            for rotulo, tipo in (("Base de leads", "leads"), ("Logs", "logs")):
                log(f"3) Leads → Exportar → {rotulo}")
                exp = primeiro(page, ["button:has-text('Exportar')", "a:has-text('Exportar')"], 20000)
                if not exp:
                    raise RuntimeError(f"não achei o botão Exportar. Na tela: {tela(page)}")
                exp.click()
                page.wait_for_timeout(1200)
                opc = primeiro(page, [f"[role=dialog] >> text={rotulo}", f"text={rotulo}"], 8000)
                if not opc:
                    raise RuntimeError(f"não achei a opção '{rotulo}' na janela de exportação. Na tela: {tela(page)}")
                opc.click()
                campo = primeiro(page, ["[role=dialog] input[type=email]", "[role=dialog] input", "input[placeholder*='@']", "input[type=email]"], 8000)
                if not campo:
                    raise RuntimeError(f"não achei o campo de e-mail da exportação. Na tela: {tela(page)}")
                campo.fill(EMAIL)
                ok = primeiro(page, ["[role=dialog] button:has-text('Exportar')", "button:has-text('Exportar') >> nth=-1"], 5000)
                if not ok:
                    raise RuntimeError("não achei o botão Exportar da janela")
                ok.click()
                page.wait_for_timeout(3500)
                # fecha a janela se ficou aberta
                if primeiro(page, ["[role=dialog]"], 800):
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(600)
                feitos.append(tipo)
                log(f"4) {rotulo}: exportação pedida para {EMAIL}")
            destino = Path(SAIDA)
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_text(json.dumps({"em": datetime.now(TZ).isoformat(), "email": EMAIL, "tipos": feitos}), encoding="utf-8")
            return 0
        except Exception:  # noqa: BLE001
            log("### ERRO NO FIXE ###")
            print(traceback.format_exc())
            return 1
        finally:
            try:
                b.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    sys.exit(main())
