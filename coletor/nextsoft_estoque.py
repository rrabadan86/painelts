#!/usr/bin/env python3
# Baixa o "Estoque Atual" do AppNext (Estoque → Estoque Atual → Exportar para Excel)
# e grava em SAIDA_ESTOQUE (.xlsx). O painel lê a planilha: estoque, estoque mínimo e custo de cada produto.
# Variáveis: as mesmas do script de vendas (APPNEXT_*) + SAIDA_ESTOQUE.
import os
import re
import sys
import traceback
from pathlib import Path

SAIDA = os.getenv("SAIDA_ESTOQUE", "").strip()
if not SAIDA:
    print("ERRO: defina SAIDA_ESTOQUE")
    sys.exit(2)
os.environ.setdefault("SAIDA_ARQUIVO", str(Path.cwd() / "_nao_usado.xlsx"))

import nextsoft_export_to_drive as nx  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

log, step = nx.log, nx.step
HASH = "#/estoque/estoque-atual"
BOTAO_EXCEL = [
    "[title*='Excel' i] >> visible=true",
    "[data-original-title*='Excel' i] >> visible=true",
    "[aria-label*='Excel' i] >> visible=true",
    "button:has(.fa-file-excel) >> visible=true",
    "a:has(.fa-file-excel) >> visible=true",
    "button.btn-success >> visible=true",
]


def fazer_login(page):
    if "/#/login" in page.url:
        page.fill(nx.SEL["rede"], nx.REDE)
        page.fill(nx.SEL["email"], nx.USER)
        page.fill(nx.SEL["senha"], nx.PASS)
        page.click(nx.SEL["entrar"])
    page.wait_for_url("**/#/loja/**", timeout=120_000)


def tela_ok(page):
    return page.locator("text=/Estoque\\s+Atual/ >> visible=true").count() > 0 and any(page.locator(s).count() for s in BOTAO_EXCEL)


def abrir_tela(page):
    for tentativa in range(1, 4):
        try:
            if "/#/login" in page.url:
                log("O AppNext voltou para o login; entrando de novo…")
                fazer_login(page)
                nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            # troca só o '#': a página não recarrega e o login continua valendo
            page.evaluate(f"() => {{ location.hash = '{HASH}'; }}")
            for _ in range(25):
                if tela_ok(page):
                    log(f"Tela Estoque Atual aberta ({page.url}).")
                    return
                page.wait_for_timeout(1000)
        except Exception as e:  # noqa: BLE001
            log(f"Tentativa {tentativa}: {str(e).splitlines()[0][:200]}")
    texto = page.evaluate("() => document.body.innerText.slice(0, 400)").replace("\n", " | ")
    raise RuntimeError(f"Não abriu a tela Estoque Atual. Na tela: {texto}")


def main():
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "600")))
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(Path.cwd() / "pw_state"), headless=True, accept_downloads=True, ignore_https_errors=True,
            viewport={"width": 1600, "height": 950},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_default_timeout(30_000)
        page.set_default_navigation_timeout(60_000)
        try:
            step("1) Login")
            nx.goto_login_with_retries(page, nx.LOGIN_URL)
            fazer_login(page)
            nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            step("2) Estoque → Estoque Atual")
            abrir_tela(page)
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:  # noqa: BLE001
                pass
            step("3) Exportar para Excel")
            botao = next(page.locator(s).first for s in BOTAO_EXCEL if page.locator(s).count())
            with page.expect_download(timeout=180_000) as dl:
                botao.click()
            dados = Path(dl.value.path()).read_bytes()
            if not dados.startswith(b"PK"):
                raise RuntimeError(f"O arquivo baixado não é um .xlsx ({dl.value.suggested_filename}).")
            destino = Path(SAIDA)
            destino.parent.mkdir(parents=True, exist_ok=True)
            tmp = destino.with_name(destino.name + ".tmp")
            tmp.write_bytes(dados)
            tmp.replace(destino)
            log(f"Estoque: {len(dados) // 1024} KB → {destino.name}")
            return 0
        except Exception:  # noqa: BLE001
            log("### ERRO NO ESTOQUE ###")
            print(traceback.format_exc())
            return 1
        finally:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    sys.exit(main())
