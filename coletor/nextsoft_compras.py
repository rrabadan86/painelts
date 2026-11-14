#!/usr/bin/env python3
# Notas de entrada (compras) do AppNext: Estoque → Entrada de Produtos.
# Grava em SAIDA_COMPRAS (JSON) cada nota concluída com os itens (código, quantidade e custo unitário),
# para o painel montar o histórico de custo desde a primeira compra.
#
# Fluxo (só leitura, nada é alterado no AppNext):
#   1) Login e troca de loja (mesmas funções do script de vendas)
#   2) Abre Estoque → Entrada de Produtos: a tela pede a lista de notas à API do AppNext
#   3) Esse pedido (com o login dele) é repetido com o período desde COMPRAS_DESDE até hoje
#   4) Para cada nota nova, pede o detalhe (itens com quantidade e valor); notas já guardadas não são baixadas de novo
#
# Custo unitário = valor líquido do item ÷ quantidade (inclui IPI, igual ao "custo último" do AppNext).
# Chás chegam em kg (1 unidade = 1 kg, mesmo código da matéria-prima).
# Variáveis: as mesmas do script de vendas (APPNEXT_*) + SAIDA_COMPRAS e, opcional, COMPRAS_DESDE (AAAA-MM-DD).
import json
import os
import re
import sys
import traceback
from datetime import date, datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

SAIDA = os.getenv("SAIDA_COMPRAS", "").strip()
if not SAIDA:
    print("ERRO: defina SAIDA_COMPRAS")
    sys.exit(2)
os.environ.setdefault("SAIDA_ARQUIVO", str(Path.cwd() / "_nao_usado.xlsx"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import nextsoft_export_to_drive as nx  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

log, step = nx.log, nx.step
HASH = "#/estoque/entrada-produto"
RE_LISTA = re.compile(r"/api/v\d+/estoque/entrada-produto\?", re.I)
DESDE = (os.getenv("COMPRAS_DESDE") or "2018-01-01").strip()


def fazer_login(page):
    if "/#/login" in page.url:
        page.fill(nx.SEL["rede"], nx.REDE)
        page.fill(nx.SEL["email"], nx.USER)
        page.fill(nx.SEL["senha"], nx.PASS)
        page.click(nx.SEL["entrar"])
    page.wait_for_url("**/#/loja/**", timeout=120_000)


def pedido_referencia(page, pedidos):
    """abre a tela Entrada de Produtos e devolve o pedido da lista que a própria tela fez"""
    for tentativa in range(1, 4):
        try:
            if "/#/login" in page.url:
                log("O AppNext voltou para o login; entrando de novo…")
                fazer_login(page)
                nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            antes = len(pedidos)
            # troca só o '#': a página não recarrega e o login continua valendo (passa por outra tela para a lista recarregar)
            page.evaluate("() => { location.hash = '#/estoque/extrato-estoque'; }")
            page.wait_for_timeout(1500)
            page.evaluate(f"() => {{ location.hash = '{HASH}'; }}")
            for _ in range(30):
                novos = [r for r in pedidos[antes:] if RE_LISTA.search(r.url)]
                if novos:
                    log(f"Tela Entrada de Produtos aberta ({page.url}).")
                    return novos[-1]
                page.wait_for_timeout(1000)
        except Exception as e:  # noqa: BLE001
            log(f"Tentativa {tentativa}: {str(e).splitlines()[0][:200]}")
    texto = page.evaluate("() => document.body.innerText.slice(0, 400)").replace("\n", " | ")
    raise RuntimeError(f"Não vi a lista de notas da tela Entrada de Produtos. Na tela: {texto}")


def trocar_periodo(url, ini: str, fim: str):
    p = urlsplit(url)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    if "dataEmissaoInicial" not in q or "dataEmissaoFinal" not in q:
        raise RuntimeError("O pedido da lista não tem dataEmissaoInicial/dataEmissaoFinal; o AppNext mudou a tela.")
    q["dataEmissaoInicial"] = f"{ini}T00:00:00.000Z"
    q["dataEmissaoFinal"] = f"{fim}T23:59:59.000Z"
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q), p.fragment))


def pedir_json(page, url, cab):
    resp = page.request.get(url, headers=cab, timeout=120_000)
    if not resp.ok:
        try:
            t = re.sub(r"\s+", " ", resp.text())[:300]
        except Exception:  # noqa: BLE001
            t = ""
        raise RuntimeError(f"AppNext respondeu {resp.status} em {urlsplit(url).path}{': ' + t if t else ''}")
    return resp.json()


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def nota_de(d):
    forn = d.get("fornecedor") or {}
    itens = []
    for i in d.get("itens") or []:
        q, vl, vb = num(i.get("quantidade")), num(i.get("valorTotalLiquido")), num(i.get("valorTotalBruto"))
        if not q or q <= 0:
            continue
        itens.append({
            "cod": str(i.get("codigo") or "").strip(), "nome": (i.get("nome") or "").strip(), "un": i.get("unidade") or "",
            "qtd": q, "vu": num(i.get("valorUnitario")),
            # custo de uma unidade: líquido (com IPI e rateios) ÷ quantidade; sem o líquido, o bruto
            "custo": round((vl if vl else (vb or 0)) / q, 4), "grupo": i.get("grupoNome") or "",
        })
    return {
        "id": d.get("id"), "nf": d.get("numeroNota"), "serie": d.get("serie"),
        "emissao": str(d.get("dataEmissao") or "")[:10], "entrada": str(d.get("dataEntrada") or d.get("dataConclusao") or "")[:10],
        "status": d.get("status"), "motivo": ((d.get("motivoMovimentacao") or {}).get("descricao") or "").strip(),
        "cfop": (d.get("cfop") or {}).get("codigo"),
        "fornecedor": (forn.get("nomeFantasia") or forn.get("razaoSocial") or forn.get("nome") or "").strip(),
        "total": num(d.get("valorTotalLiquido")) or num(d.get("valorTotalNota")), "itens": itens,
    }


def main():
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "900")))
    destino = Path(SAIDA)
    try:
        antigo = json.loads(destino.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        antigo = {}
    guardadas = {n["id"]: n for n in antigo.get("notas", []) if n.get("id")}
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(Path.cwd() / "pw_state"), headless=True, ignore_https_errors=True,
            viewport={"width": 1600, "height": 950},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_default_timeout(30_000)
        page.set_default_navigation_timeout(60_000)
        pedidos = []
        page.on("request", lambda r: pedidos.append(r) if r.resource_type in ("xhr", "fetch") and "appnext" in r.url else None)
        try:
            step("1) Login")
            nx.goto_login_with_retries(page, nx.LOGIN_URL)
            fazer_login(page)
            nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))

            step("2) Estoque → Entrada de Produtos")
            ref = pedido_referencia(page, pedidos)
            cab = {k: v for k, v in ref.headers.items() if k.lower() not in ("content-length", "host", "cookie", "accept-encoding")}

            hoje = date.today().isoformat()
            step(f"3) Lista de notas de {DESDE} a {hoje}")
            lista = pedir_json(page, trocar_periodo(ref.url, DESDE, hoje), cab)
            if isinstance(lista, dict):
                lista = lista.get("itens") or next((v for v in lista.values() if isinstance(v, list)), [])
            concluidas = [x for x in lista if str(x.get("status") or "").lower().startswith("conclu") and x.get("id")]
            log(f"{len(lista)} notas no AppNext, {len(concluidas)} concluídas ({len(guardadas)} já guardadas)")

            step("4) Itens das notas novas")
            base = urlsplit(ref.url)
            notas, novas, falhas = [], 0, 0
            for x in concluidas:
                if x["id"] in guardadas:
                    notas.append(guardadas[x["id"]])
                    continue
                url = urlunsplit((base.scheme, base.netloc, base.path.rstrip("/") + "/" + x["id"], "", ""))
                try:
                    n = nota_de(pedir_json(page, url, cab))
                except Exception as e:  # noqa: BLE001
                    falhas += 1
                    log(f"NF {x.get('numeroNota')}: {str(e)[:200]}")
                    if falhas >= 5:
                        raise
                    continue
                notas.append(n)
                novas += 1
                log(f"NF {n['nf']} ({n['emissao']}, {n['fornecedor'][:30]}): {len(n['itens'])} itens")
            notas.sort(key=lambda n: (n["entrada"] or n["emissao"], n["nf"] or 0))
            destino.parent.mkdir(parents=True, exist_ok=True)
            tmp = destino.with_name(destino.name + ".tmp")
            tmp.write_text(json.dumps({"atualizado": datetime.now().astimezone().isoformat(), "desde": DESDE, "notas": notas}, ensure_ascii=False), encoding="utf-8")
            tmp.replace(destino)
            log(f"Compras: {len(notas)} notas ({novas} novas{', ' + str(falhas) + ' com erro' if falhas else ''}) → {destino.name}")
            return 0
        except Exception:  # noqa: BLE001
            log("### ERRO NAS COMPRAS ###")
            print(traceback.format_exc())
            return 1
        finally:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    sys.exit(main())
