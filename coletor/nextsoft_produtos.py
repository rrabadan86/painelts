#!/usr/bin/env python3
# Baixa as duas listagens de produtos do AppNext com o preço de tabela (Produtos → Produtos e Produtos → Produtos Compostos,
# botão do Excel) e grava em SAIDA_PRODUTOS (pasta): <carimbo>_produtos.xlsx e <carimbo>_compostos.xlsx.
# O painel junta as duas: o preço de tabela de cada produto, inclusive dos pacotes de chá a granel (compostos).
# Só observa e exporta: não altera nada no AppNext. Variáveis: as mesmas do script de vendas (APPNEXT_*) + SAIDA_PRODUTOS.
import os
import re
import sys
import traceback
from datetime import datetime
from pathlib import Path

SAIDA = os.getenv("SAIDA_PRODUTOS", "").strip()
if not SAIDA:
    print("ERRO: defina SAIDA_PRODUTOS")
    sys.exit(2)
os.environ.setdefault("SAIDA_ARQUIVO", str(Path.cwd() / "_nao_usado.xlsx"))

import nextsoft_export_to_drive as nx  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

log, step = nx.log, nx.step
TELAS = [("produtos", "#/loja/produtos/produtos", r"Listagem\s+de\s+Produtos"),
         ("compostos", "#/loja/produtos/produtos-compostos", r"Produtos\s+Compostos")]
BOTAO_EXCEL = [
    "[title*='Excel' i] >> visible=true",
    "[data-original-title*='Excel' i] >> visible=true",
    "[aria-label*='Excel' i] >> visible=true",
    "button:has(.fa-file-excel) >> visible=true",
    "a:has(.fa-file-excel) >> visible=true",
    "button:has(img[src*='excel' i]) >> visible=true",
    "button.btn-success >> visible=true",
]


def fazer_login(page):
    if "/#/login" in page.url:
        page.fill(nx.SEL["rede"], nx.REDE)
        page.fill(nx.SEL["email"], nx.USER)
        page.fill(nx.SEL["senha"], nx.PASS)
        page.click(nx.SEL["entrar"])
    page.wait_for_url("**/#/loja/**", timeout=120_000)


def tem_excel(page):
    return any(page.locator(s).count() for s in BOTAO_EXCEL)


def abrir(page, hash_, titulo):
    for tentativa in range(1, 4):
        try:
            if "/#/login" in page.url:
                log("O AppNext voltou para o login; entrando de novo…")
                fazer_login(page)
                nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            page.evaluate(f"() => {{ location.hash = '{hash_}'; }}")
            for _ in range(25):
                if page.locator(f"text=/{titulo}/i >> visible=true").count() and tem_excel(page):
                    return
                page.wait_for_timeout(1000)
        except Exception as e:  # noqa: BLE001
            log(f"Tentativa {tentativa}: {str(e).splitlines()[0][:200]}")
    texto = page.evaluate("() => document.body.innerText.slice(0, 300)").replace("\n", " | ")
    raise RuntimeError(f"Não abriu a tela {hash_}. Na tela: {texto}")


def baixar(page, destino):
    botao = next(page.locator(s).first for s in BOTAO_EXCEL if page.locator(s).count())
    with page.expect_download(timeout=180_000) as dl:
        botao.click()
    dados = Path(dl.value.path()).read_bytes()
    if not dados.startswith(b"PK"):
        raise RuntimeError(f"O arquivo baixado não é um .xlsx ({dl.value.suggested_filename}).")
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_name(destino.name + ".tmp")
    tmp.write_bytes(dados)
    tmp.replace(destino)
    log(f"{destino.name}: {len(dados) // 1024} KB")


def main():
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "600")))
    carimbo = datetime.now().strftime("%Y%m%d_%H%M%S")
    falhas = 0
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
            for k, (nome, hash_, titulo) in enumerate(TELAS, start=2):
                step(f"{k}) {nome}: abrir e exportar para Excel")
                try:
                    abrir(page, hash_, titulo)
                    try:
                        page.wait_for_load_state("networkidle", timeout=15000)
                    except Exception:  # noqa: BLE001
                        pass
                    page.wait_for_timeout(1500)
                    baixar(page, Path(SAIDA) / f"{carimbo}_{nome}.xlsx")
                except Exception as e:  # noqa: BLE001
                    falhas += 1
                    log(f"### ERRO em {nome}: {str(e).splitlines()[0][:300]}")
            return 1 if falhas == len(TELAS) else 0
        except Exception:  # noqa: BLE001
            log("### ERRO NOS PRODUTOS ###")
            print(traceback.format_exc())
            return 1
        finally:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    sys.exit(main())
