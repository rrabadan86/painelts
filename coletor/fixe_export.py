#!/usr/bin/env python3
# Pede ao FIXE (dash.epossible.com.br) a exportação da "Base de leads" (cadastro) e dos "Logs" (compras, pontos e resgates).
# O FIXE manda um e-mail com o link "Baixar agora"; o PAINEL lê esse e-mail (IMAP do Gmail da loja),
# baixa a planilha e importa no cadastro. Aqui só fazemos o pedido e deixamos um aviso para o painel.
# Variáveis: FIXE_URL (página de Leads da loja), FIXE_USER, FIXE_PASS, FIXE_EMAIL (para onde mandar), SAIDA_FIXE (aviso .json)
import json
import re
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
EMAIL_BASE = os.getenv("FIXE_EMAIL", "").strip()


def com_apelido(email, tag):
    """Gmail: usuario+tag@gmail.com cai na mesma caixa, mas chega endereçado ao apelido da loja.
    Assim várias lojas podem usar o mesmo Gmail sem misturar as exportações do FIXE."""
    tag = re.sub(r"[^a-z0-9]", "", (tag or "").lower())[:30]
    if not tag or "@" not in email or "+" in email.split("@")[0]:
        return email
    usuario, dominio = email.rsplit("@", 1)
    if dominio.lower() not in ("gmail.com", "googlemail.com"):
        return email
    return f"{usuario}+{tag}@{dominio}"


EMAIL = EMAIL_BASE if os.getenv("FIXE_APELIDO_USAR", "1") == "0" else com_apelido(EMAIL_BASE, os.getenv("FIXE_APELIDO", ""))
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


import threading
import time


def iniciar_watchdog(seg=600):
    def _matar():
        time.sleep(max(60, int(seg)))
        log(f"[watchdog] tempo máximo ({seg}s) atingido. Abortando.")
        os._exit(124)
    threading.Thread(target=_matar, daemon=True).start()


def main():
    if not (URL and USER and PASS and EMAIL and SAIDA):
        log("ERRO: acesso ao FIXE incompleto (endereço, usuário, senha e e-mail de destino).")
        return 2
    iniciar_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "600")))
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
            respostas = {}
            confirmacoes = {}
            def salvar_pedido():
                # grava o que já foi pedido: o painel importa o que chegar, mesmo se outra exportação falhar
                destino = Path(SAIDA)
                destino.parent.mkdir(parents=True, exist_ok=True)
                tmp = destino.with_name(f"{destino.name}.{os.getpid()}.tmp")
                tmp.write_text(json.dumps({"em": datetime.now(TZ).isoformat(), "email": EMAIL, "emailBase": EMAIL_BASE, "tipos": feitos, "respostas": respostas, "confirmados": confirmacoes}), encoding="utf-8")
                os.chmod(tmp, 0o640)
                tmp.replace(destino)

            def abrir_opcao(rotulo):
                """clica em Exportar e na opção; tenta de novo com a página recarregada (a janela anterior pode ter ficado aberta)"""
                for tentativa in range(1, 4):
                    for _ in range(2):
                        page.keyboard.press("Escape")
                        page.wait_for_timeout(300)
                    if tentativa > 1:
                        log(f"   não abriu a opção '{rotulo}'; recarregando a página (tentativa {tentativa})")
                        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
                        page.wait_for_timeout(3500)
                    exp = primeiro(page, ["button:has-text('Exportar')", "a:has-text('Exportar')"], 20000)
                    if not exp:
                        continue
                    exp.click()
                    page.wait_for_timeout(1500)
                    opc = primeiro(page, [f"[role=dialog] >> text={rotulo}", f"[role=menu] >> text={rotulo}", f"text={rotulo}"], 8000)
                    if opc:
                        return opc
                # o que havia no menu/janela: ajuda a saber se a opção mudou de nome ou o usuário não tem acesso
                try:
                    menu = page.evaluate("""() => [...document.querySelectorAll('[role=dialog],[role=menu],[role=listbox],.dropdown-menu,.MuiPopover-root,.MuiMenu-root')]
                        .map((e) => e.innerText.trim()).filter(Boolean).join(' | ').replace(/\\s+/g, ' ').slice(0, 300)""")
                except Exception:  # noqa: BLE001
                    menu = ""
                raise RuntimeError(f"não achei a opção '{rotulo}' na janela de exportação. Opções que apareceram: {menu or '(nenhuma janela aberta)'}. Na tela: {tela(page)}")

            for rotulo, tipo in (("Base de leads", "leads"), ("Logs", "logs")):
                log(f"3) Leads → Exportar → {rotulo}")
                try:
                    opc = abrir_opcao(rotulo)
                except RuntimeError:
                    if feitos:
                        salvar_pedido()
                        log(f"   A Base de leads já foi pedida e vai ser importada; só {rotulo} ficou para trás.")
                    raise
                opc.click()
                campo = primeiro(page, ["[role=dialog] input[type=email]", "[role=dialog] input", "input[placeholder*='@']", "input[type=email]"], 8000)
                if not campo:
                    raise RuntimeError(f"não achei o campo de e-mail da exportação. Na tela: {tela(page)}")
                campo.fill(EMAIL)
                ok = primeiro(page, ["[role=dialog] button:has-text('Exportar')", "button:has-text('Exportar') >> nth=-1"], 5000)
                if not ok:
                    raise RuntimeError("não achei o botão Exportar da janela")
                # espera sumir o aviso da exportação anterior, para não confundir com o desta
                for _ in range(16):
                    try:
                        if not page.locator("[data-sonner-toast], .Toastify__toast, [role=status]:visible, [role=alert]:visible").count():
                            break
                    except Exception:  # noqa: BLE001
                        break
                    page.wait_for_timeout(500)
                antes = page.evaluate("() => document.body.innerText")
                ok.click()
                # confirmação do FIXE: o aviso "Exportação iniciada. Você receberá o arquivo por e-mail." (some depois de alguns segundos)
                resposta, confirmado = "", False
                SELS = ["[data-sonner-toast]", "[role=alert]", "[role=status]", ".Toastify__toast", ".toast", ".MuiSnackbar-root", ".swal2-popup", ".notification", ".ant-message", ".v-snack", "[class*=toast i]"]
                for _ in range(24):  # até ~12 s
                    page.wait_for_timeout(500)
                    for sel in SELS:
                        try:
                            el = page.locator(sel).first
                            if el.count() and el.is_visible():
                                t = " ".join(el.inner_text().split())[:200]
                                if t:
                                    resposta = t
                                    break
                        except Exception:  # noqa: BLE001
                            pass
                    if not resposta:
                        try:
                            depois = page.evaluate("() => document.body.innerText")
                            novas = [l.strip() for l in depois.splitlines() if l.strip() and l.strip() not in antes]
                            achou = next((l for l in novas if re.search(r"exporta|e-?mail|erro|falha", l, re.I)), "")
                            resposta = achou[:200]
                        except Exception:  # noqa: BLE001
                            pass
                    if resposta:
                        break
                confirmado = bool(re.search(r"exporta[çc][ãa]o iniciada|receber[áa] o arquivo", resposta, re.I))
                respostas[tipo] = resposta
                log(f"   O FIXE mostrou: {resposta or '(nenhum aviso na tela)'}" + (" ✓ exportação confirmada" if confirmado else ""))
                if not confirmado and not re.search(r"erro|falha|inválid|invalid|não foi possível|tente novamente", resposta, re.I):
                    log("   Atenção: não vi a confirmação \"Exportação iniciada\" do FIXE; o painel vai esperar o e-mail mesmo assim.")
                confirmacoes[tipo] = confirmado
                if re.search(r"erro|falha|inválid|invalid|não foi possível|tente novamente", resposta, re.I):
                    raise RuntimeError(f"o FIXE recusou a exportação de {rotulo}: {resposta}")
                # fecha a janela se ficou aberta
                if primeiro(page, ["[role=dialog]"], 800):
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(600)
                feitos.append(tipo)
                log(f"4) {rotulo}: exportação pedida para {EMAIL}")
            salvar_pedido()
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
