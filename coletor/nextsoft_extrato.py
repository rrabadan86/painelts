#!/usr/bin/env python3
# Extrato de estoque do AppNext (Estoque → Extrato de estoque), SÓ LEITURA (EXTRATO-01, pedido do dono de 25/11/2026).
# Serve para reconstruir o estoque a custo do começo de cada mês desde jun/2025 (CMV pelo estoque, src/cmvestoque.js).
#
# Como o formato da tela ainda não é conhecido, o robô faz duas coisas:
#   1) DIAGNÓSTICO (SAIDA_EXTRATO_DIAG): os endereços que a tela chama (só o caminho e os NOMES dos parâmetros), os campos
#      da resposta e 2 linhas de exemplo, o texto da tela e os rótulos dos filtros — sem dado pessoal (campos de usuário,
#      operador, e-mail, CPF/CNPJ, cliente e telefone são retirados). É isso que o dono manda para ajustar a leitura.
#   2) MOVIMENTOS (SAIDA_EXTRATO): se a tela chamar uma lista com período (dataInicial/dataFinal ou parecido), repete o
#      mesmo pedido de EXTRATO_DESDE até hoje, página por página, e guarda os itens (sem os campos pessoais).
# Nada é clicado além de abrir a tela: nunca Salvar, Concluir nem Homologar.
import json
import os
import re
import sys
import traceback
from datetime import date, datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

os.environ.setdefault("SAIDA_ARQUIVO", str(Path.cwd() / "_nao_usado.xlsx"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import nextsoft_export_to_drive as nx  # noqa: E402
import nextsoft_compras as ncomp  # noqa: E402
import nextsoft_caixa as ncx  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

log, step = nx.log, nx.step
HASH = "#/estoque/extrato-estoque"
PESSOAL = re.compile(r"usuario|usuário|operador|login|e-?mail|cpf|cnpj|cliente|telefone|celular|senha|token|responsavel|responsável", re.I)
DATA_PARAM = re.compile(r"data|date|inicio|início|fim|de$|ate$|periodo", re.I)
MAX_ITENS = 300_000


def limpar(v, prof=0):
    """tira campos pessoais e encurta textos (diagnóstico e movimentos)"""
    if prof > 6:
        return None
    if isinstance(v, dict):
        return {k: limpar(x, prof + 1) for k, x in v.items() if not PESSOAL.search(str(k))}
    if isinstance(v, list):
        return [limpar(x, prof + 1) for x in v[:50]] if prof else [limpar(x, prof + 1) for x in v]
    if isinstance(v, str):
        return v[:120]
    return v


def lista_de(j):
    """a lista de registros de uma resposta (a própria lista ou o primeiro campo que é lista de objetos)"""
    if isinstance(j, list):
        return j
    if isinstance(j, dict):
        for k in ("items", "itens", "data", "dados", "content", "registros", "result", "resultado", "lista"):
            if isinstance(j.get(k), list):
                return j[k]
        for v in j.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
    return None


def chaves(x, prof=0):
    if isinstance(x, dict) and prof < 3:
        return {k: chaves(v, prof + 1) for k, v in x.items() if not PESSOAL.search(str(k))}
    if isinstance(x, list):
        return [chaves(x[0], prof + 1)] if x else []
    return type(x).__name__


def gravar(caminho, dados):
    destino = Path(caminho)
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_name(f"{destino.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    os.chmod(tmp, 0o640)
    tmp.replace(destino)


def main():
    saida = os.getenv("SAIDA_EXTRATO", "").strip()
    saida_diag = os.getenv("SAIDA_EXTRATO_DIAG", "").strip()
    desde = (os.getenv("EXTRATO_DESDE") or "2025-06-01").strip()
    if not saida or not saida_diag or not re.match(r"^\d{4}-\d{2}-\d{2}$", desde):
        print("ERRO: defina SAIDA_EXTRATO, SAIDA_EXTRATO_DIAG e EXTRATO_DESDE (AAAA-MM-DD)")
        return 2
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "1500")))
    pasta_pw = Path.cwd() / "pw_state"
    nx.limpar_locks_perfil(pasta_pw)
    diag = {"em": datetime.now(nx._TZ_LOG).isoformat(), "desde": desde, "pedidos": [], "texto_tela": "", "campos_tela": [], "lista": None, "erro": None}
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(pasta_pw), headless=True, ignore_https_errors=nx.INSEGURO, viewport={"width": 1600, "height": 950},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_default_timeout(30_000)
        respostas = []

        def on_resp(r):
            try:
                if r.request.resource_type in ("xhr", "fetch") and "appnext" in r.url and len(respostas) < 40:
                    respostas.append(r)
            except Exception:  # noqa: BLE001
                pass

        try:
            step("1) Login")
            nx.goto_login_with_retries(page, nx.LOGIN_URL)
            ncx.fazer_login(page)
            nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            nx.garantir_loja(page)
            step("2) Estoque → Extrato de estoque (só abrir a tela)")
            page.on("response", on_resp)
            page.evaluate("() => { location.hash = '#/vendas/fechamentospdv'; }")
            page.wait_for_timeout(1500)
            respostas.clear()
            page.evaluate(f"() => {{ location.hash = '{HASH}'; }}")
            page.wait_for_timeout(9000)
            diag["texto_tela"] = page.evaluate("() => document.body.innerText.slice(0, 2500)")
            diag["campos_tela"] = page.evaluate("""() => [...document.querySelectorAll('input, select, label, button')].slice(0, 80)
              .map((e) => [e.tagName.toLowerCase(), e.getAttribute('placeholder') || e.getAttribute('aria-label') || e.getAttribute('name') || (e.innerText || '').trim().slice(0, 60), e.type || ''])""")
            modelo = None
            for r in respostas:
                p = urlsplit(r.url)
                q = parse_qsl(p.query, keep_blank_values=True)
                info = {"caminho": p.path, "parametros": {k: (v if DATA_PARAM.search(k) else "…") for k, v in q}, "status": r.status}
                try:
                    j = r.json()
                    lst = lista_de(j)
                    info["formato"] = chaves(j)
                    if lst:
                        info["n_itens"] = len(lst)
                        info["amostra"] = limpar(lst[:2])
                    tem_periodo = any(DATA_PARAM.search(k) for k, _ in q)
                    if lst is not None and tem_periodo and modelo is None:
                        modelo = r
                except Exception:  # noqa: BLE001
                    info["formato"] = "não é JSON"
                diag["pedidos"].append(info)
            log(f"{len(diag['pedidos'])} pedidos da tela registrados no diagnóstico")

            if modelo is not None:
                step(f"3) Movimentos de {desde} até hoje (o mesmo pedido da tela, com o período trocado)")
                cab = {k: v for k, v in modelo.request.headers.items() if k.lower() not in ("content-length", "host", "cookie", "accept-encoding")}
                url = modelo.url
                try:
                    url = ncx.trocar_periodo(url, desde, date.today().isoformat())
                except Exception as e:  # noqa: BLE001
                    log(f"Não deu para trocar o período automaticamente: {str(e)[:160]}")
                itens = ncomp.pedir_lista_paginada(page, url, cab)
                itens = [limpar(x) for x in itens[:MAX_ITENS]]
                gravar(saida, {"em": datetime.now(nx._TZ_LOG).isoformat(), "desde": desde, "caminho": urlsplit(url).path, "itens": itens})
                diag["lista"] = {"caminho": urlsplit(url).path, "itens": len(itens)}
                log(f"Extrato: {len(itens)} movimentos guardados → {Path(saida).name}")
            else:
                log("A tela não chamou uma lista com período: o diagnóstico mostra o que ela pede (talvez escolher um produto).")
            gravar(saida_diag, diag)
            return 0
        except Exception as e:  # noqa: BLE001
            diag["erro"] = str(e).splitlines()[0][:300]
            try:
                gravar(saida_diag, diag)
            except Exception:  # noqa: BLE001
                pass
            log("### ERRO NO EXTRATO DE ESTOQUE ###")
            print(traceback.format_exc())
            return 1
        finally:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    sys.exit(main())
