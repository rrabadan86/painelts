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


def mostrar_zerados(page):
    """Filtros (funil) → "Mostrar item com Quantidade Zero" = Sim → Atualizar Filtros.
    Sem isso o relatório esconde o que está zerado (ex.: a matéria-prima de um chá que acabou) e o painel perde o custo."""
    rotulo = "text=/Mostrar item com Quantidade Zero/i >> visible=true"
    if not page.locator(rotulo).count():
        ok = nx._click_first(page, [
            "button:has(i[class*='filter'])", "button:has(svg[class*='filter'])", "button:has([class*='funnel'])",
            "[title*='iltro']", "[aria-label*='iltro']",
            "xpath=//*[normalize-space()='Filtros:']/ancestor::*[.//button][1]//button[last()]",
        ])
        if not ok:
            raise RuntimeError("Não achei o botão de filtros (funil) na tela Estoque Atual.")
        page.locator(rotulo).first.wait_for(timeout=15000)
    sim = page.locator("xpath=//*[contains(normalize-space(), 'Mostrar item com Quantidade Zero')]/following::*[self::button or self::label or self::a or self::span or self::div][normalize-space()='Sim'][1] >> visible=true").first
    sim.click(timeout=8000)
    page.get_by_role("button", name=re.compile(r"Atualizar\s+Filtros", re.I)).first.click(timeout=8000)
    try:
        page.wait_for_load_state("networkidle", timeout=20000)
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(1500)
    chip = page.locator("text=/quantidade zero:\\s*Sim/i").count()
    log("Filtro: itens com quantidade zero = Sim" + ("" if chip else " (não confirmei na etiqueta do filtro)"))


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
            step("3) Filtro: mostrar itens com quantidade zero")
            try:
                mostrar_zerados(page)
            except Exception as e:  # noqa: BLE001
                log(f"Aviso: não consegui ligar 'Mostrar item com Quantidade Zero' ({str(e).splitlines()[0][:160]}); o relatório sai sem os itens zerados.")
            step("4) Exportar para Excel")
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
