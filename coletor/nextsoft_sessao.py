#!/usr/bin/env python3
"""
Sessão unificada no AppNext para uma loja:
  Abre um único Chromium, faz login uma vez, troca para a loja da rotina uma vez e executa
  em sequência apenas os módulos pedidos (vendas, xml, caixa, estoque, compras, produtos).
  Cada etapa imprime o marcador '### nextsoft_<modulo>.py ###' para manter 100% de compatibilidade
  com o acompanhamento ao vivo (ao_vivo) e com o resumo por etapa do coletor.py.
"""
import json
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path

SESSAO_ARQUIVO = os.getenv("SESSAO_ARQUIVO", "").strip()
SAIDA_SESSAO = os.getenv("SAIDA_SESSAO", "").strip()
if not (SESSAO_ARQUIVO and SAIDA_SESSAO):
    print("ERRO: defina SESSAO_ARQUIVO e SAIDA_SESSAO")
    sys.exit(2)

CFG_SESSAO = json.loads(Path(SESSAO_ARQUIVO).read_text(encoding="utf-8"))
os.environ.setdefault("SAIDA_ARQUIVO", str(CFG_SESSAO.get("saida_vendas") or (Path.cwd() / "_nao_usado.xlsx")))

import nextsoft_export_to_drive as nx  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

log = nx.log
step = nx.step

MARCADORES = {
    "vendas": "nextsoft_export_to_drive.py",
    "xml": "nextsoft_xml.py",
    "caixa": "nextsoft_caixa.py",
    "estoque": "nextsoft_estoque.py",
    "compras": "nextsoft_compras.py",
    "produtos": "nextsoft_produtos.py",
}


def gravar_resultado(etapas_res, erro_login=None):
    destino = Path(SAIDA_SESSAO)
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_name(f"{destino.name}.{os.getpid()}.tmp")
    corpo = {"em": datetime.now(nx._TZ_LOG).isoformat(), "etapas": etapas_res}
    if erro_login:
        corpo["erro_login"] = erro_login
    tmp.write_text(json.dumps(corpo, ensure_ascii=False), encoding="utf-8")
    os.chmod(tmp, 0o640)
    tmp.replace(destino)


def login_unico(page):
    step("1) Login único da sessão AppNext")
    nx.goto_login_with_retries(page, nx.LOGIN_URL)
    if "/#/login" in page.url:
        page.fill(nx.SEL["rede"], nx.REDE)
        page.fill(nx.SEL["email"], nx.USER)
        page.fill(nx.SEL["senha"], nx.PASS)
        page.click(nx.SEL["entrar"])
    page.wait_for_url("**/#/loja/**", timeout=120_000)
    try:
        page.wait_for_load_state("networkidle", timeout=15_000)
    except Exception:  # noqa: BLE001
        pass
    nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))


def rodar_etapa(page, nome: str):
    if nome == "vendas":
        nx.coletar_vendas_na_pagina(page, CFG_SESSAO["saida_vendas"])
    elif nome == "xml":
        import nextsoft_xml as nxml
        ini = nxml.dt_br(os.getenv("DATA_INICIO", "01/06/2025"))
        fim = nxml.dt_br(os.getenv("DATA_FIM")) if os.getenv("DATA_FIM") else datetime.now(nx._TZ_LOG).date()
        nxml.coletar_xml_na_pagina(page, ini, fim, CFG_SESSAO["saida_xml"])
    elif nome == "caixa":
        import nextsoft_caixa as ncaixa
        ncaixa.coletar_caixa_na_pagina(page, CFG_SESSAO["saida_caixa"])
    elif nome == "estoque":
        import nextsoft_estoque as nest
        nest.coletar_estoque_na_pagina(page, CFG_SESSAO["saida_estoque"])
    elif nome == "compras":
        import nextsoft_compras as ncomp
        ncomp.coletar_compras_na_pagina(page, CFG_SESSAO["saida_compras"])
    elif nome == "produtos":
        import nextsoft_produtos as nprod
        nprod.coletar_produtos_na_pagina(page, CFG_SESSAO["saida_produtos"])
    else:
        raise ValueError(f"etapa desconhecida: {nome}")


def main():
    etapas = [e for e in (CFG_SESSAO.get("etapas") or []) if e in MARCADORES]
    if not etapas:
        gravar_resultado({})
        return 0

    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "1200")))
    pasta_pw = Path.cwd() / "pw_state"
    nx.limpar_locks_perfil(pasta_pw)
    resultados = {e: {"ok": False, "codigo": 1} for e in etapas}

    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(pasta_pw),
            headless=True,
            accept_downloads=True,
            ignore_https_errors=nx.INSEGURO,
            viewport={"width": 1600, "height": 950},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_default_timeout(30_000)
        page.set_default_navigation_timeout(60_000)
        page.on("dialog", lambda d: d.dismiss())

        try:
            primeiro = etapas[0]
            print(f"\n### {MARCADORES[primeiro]} ###", flush=True)
            login_unico(page)
        except Exception as e:  # noqa: BLE001
            log("### ERRO NO LOGIN DA SESSÃO APPNEXT ###")
            print(traceback.format_exc(), flush=True)
            gravar_resultado(resultados, str(e).splitlines()[0][:300])
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass
            return 1

        try:
            for idx, etapa in enumerate(etapas):
                if idx > 0:
                    print(f"\n### {MARCADORES[etapa]} ###", flush=True)
                try:
                    rodar_etapa(page, etapa)
                    resultados[etapa] = {"ok": True, "codigo": 0}
                except Exception as e:  # noqa: BLE001
                    log(f"### ERRO NA ETAPA {etapa.upper()} ###")
                    print(traceback.format_exc(), flush=True)
                    resultados[etapa] = {"ok": False, "codigo": 1, "erro": str(e).splitlines()[0][:240]}
                    # Se a sessão caiu na tela de login no meio do caminho, refaz login antes da próxima etapa
                    try:
                        if "/#/login" in page.url:
                            login_unico(page)
                    except Exception:  # noqa: BLE001
                        pass
                gravar_resultado(resultados)
        finally:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass

    gravar_resultado(resultados)
    principal = etapas[0]
    return 0 if resultados[principal]["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
