#!/usr/bin/env python3
# Fechamentos de caixa do AppNext: Vendas → Fechamentos de PDV.
# Grava em SAIDA_CAIXA (JSON) cada fechamento com os recebimentos por forma de pagamento,
# sangrias, suprimentos e fundo de caixa — usado no e-mail do fechamento do dia.
#
# Fluxo (só leitura, nada é alterado no AppNext):
#   1) Login e troca de loja (mesmas funções do script de vendas)
#   2) Abre Vendas → Fechamentos de PDV: a tela pede a lista à API do AppNext
#   3) Esse pedido (com o login dele) é repetido com os últimos CAIXA_DIAS dias
#   4) Para cada fechamento novo, pede o detalhe; os já guardados não são baixados de novo
# Variáveis: as mesmas do script de vendas (APPNEXT_*) + SAIDA_CAIXA e, opcional, CAIXA_DIAS (padrão 10).
import json
import os
import re
import sys
import traceback
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

SAIDA = os.getenv("SAIDA_CAIXA", "").strip()
os.environ.setdefault("SAIDA_ARQUIVO", str(Path.cwd() / "_nao_usado.xlsx"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import nextsoft_export_to_drive as nx  # noqa: E402
import nextsoft_compras as ncomp  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

log, step = nx.log, nx.step
HASH = "#/vendas/fechamentospdv"
RE_LISTA = re.compile(r"/api/v\d+/pdv/fechamento-pdv\?", re.I)
DIAS = max(1, min(120, int(os.getenv("CAIXA_DIAS") or "10")))
GUARDA_DIAS = 400  # histórico guardado no arquivo


def fazer_login(page):
    nx.preencher_login(page)  # espera o formulário, recarrega uma vez e diagnostica se não aparecer
    page.wait_for_url("**/#/loja/**", timeout=120_000)


def pedido_referencia(page, pedidos):
    """abre a tela Fechamentos de PDV e devolve o pedido da lista que a própria tela fez"""
    for tentativa in range(1, 4):
        try:
            if "/#/login" in page.url:
                log("O AppNext voltou para o login; entrando de novo…")
                fazer_login(page)
                nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            antes = len(pedidos)
            page.evaluate("() => { location.hash = '#/estoque/extrato-estoque'; }")
            page.wait_for_timeout(1500)
            page.evaluate(f"() => {{ location.hash = '{HASH}'; }}")
            for _ in range(30):
                novos = [r for r in pedidos[antes:] if RE_LISTA.search(r.url)]
                if novos:
                    log(f"Tela Fechamentos de PDV aberta ({page.url}).")
                    return novos[-1]
                page.wait_for_timeout(1000)
        except Exception as e:  # noqa: BLE001
            log(f"Tentativa {tentativa}: {str(e).splitlines()[0][:200]}")
    texto = page.evaluate("() => document.body.innerText.slice(0, 400)").replace("\n", " | ")
    raise RuntimeError(f"Não vi a lista da tela Fechamentos de PDV. Na tela: {texto}")


def trocar_periodo(url, ini: str, fim: str):
    p = urlsplit(url)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    if "dataInicial" not in q or "dataFinal" not in q:
        raise RuntimeError("O pedido da lista não tem dataInicial/dataFinal; o AppNext mudou a tela.")
    suf_z = "Z" if str(q.get("dataInicial") or "").endswith("Z") else ""
    if suf_z:
        q["dataInicial"] = nx.para_iso_utc_brt(datetime.strptime(ini, "%Y-%m-%d"), fim=False)
        q["dataFinal"] = nx.para_iso_utc_brt(datetime.strptime(fim, "%Y-%m-%d"), fim=True)
    else:
        q["dataInicial"] = f"{ini}T00:00:00.000"
        q["dataFinal"] = f"{fim}T23:59:59.999"
    for k in ("tamanhoPagina", "pageSize", "limit", "quantidade"):
        if k in q:
            try:
                if int(q[k]) < 200:
                    q[k] = "200"
            except ValueError:
                pass
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q), p.fragment))


def pedir_json(page, url, cab):
    return ncomp.pedir_json(page, url, cab)


def num(v):
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return 0.0


def nome(o):
    return ((o or {}).get("nome") or "").strip()


def mov(m):
    return {"hora": str(m.get("dataRegistro") or "")[:19], "valor": num(m.get("valor")), "motivo": (m.get("motivo") or "").strip(),
            "reserva": bool(m.get("reservaCaixa")), "forma": ((m.get("formaPagamento") or {}).get("descricao") or "").strip()}


def fechamento_de(d):
    return {
        "id": d.get("id"), "numero": d.get("numeroOperacao"), "status": d.get("status"),
        "abertura": str(d.get("dataAbertura") or "")[:19], "fechamento": str(d.get("dataFechamento") or "")[:19],
        "dia": str(d.get("dataFechamento") or d.get("dataAbertura") or "")[:10],
        "pdv": (d.get("pdv") or {}).get("numero"), "turno": nome(d.get("turno")),
        "opAbertura": nome(d.get("operadorAbertura")), "opFechamento": nome(d.get("operadorFechamento")),
        "fundoInicial": num(d.get("valorFundoCaixaInicial")), "reserva": num(d.get("valorReservaFundoCaixa")),
        "reservaAnterior": num(d.get("valorReservaFundoCaixaAnterior")), "difFundo": num(d.get("valorFundoDeCaixaDiferenca")),
        "apurado": num(d.get("totalValorApuradoSistema")), "recebido": num(d.get("totalValorRecebidoOperador")),
        "difVendas": num(d.get("valorVendasDiferenca")), "produtos": num(d.get("totalValorProduto")), "servico": num(d.get("totalValorServico")),
        "cancelado": num(d.get("totalValorCancelamento")), "desconto": num(d.get("totalValorDesconto")),
        "recebimentos": [{
            "forma": ((r.get("formaPagamento") or {}).get("descricao") or "").strip(),
            "venda": num(r.get("valorVenda")), "credito": num(r.get("credito")), "debito": num(r.get("debito")),
            "apurado": num(r.get("valorApurado")), "informado": num(r.get("valorInformadoOperador")), "dif": num(r.get("valorDiferenca")),
        } for r in d.get("recebimentos") or []],
        "sangrias": [mov(m) for m in d.get("sangrias") or []],
        "suprimentos": [mov(m) for m in d.get("suprimentos") or []],
    }


def coletar_caixa_na_pagina(page, saida: str, dias: int = None):
    dias = max(1, min(120, int(dias or os.getenv("CAIXA_DIAS") or "10")))
    destino = Path(saida)
    try:
        antigo = json.loads(destino.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        antigo = {}
    guardados = {f["id"]: f for f in antigo.get("fechamentos", []) if f.get("id")}
    pedidos = []
    on_req = lambda r: pedidos.append(r) if r.resource_type in ("xhr", "fetch") and "appnext" in r.url else None
    page.on("request", on_req)
    try:
        nx.garantir_loja(page)
        step("2) Vendas → Fechamentos de PDV")
        ref = pedido_referencia(page, pedidos)
        nx.garantir_loja(page)
        cab = {k: v for k, v in ref.headers.items() if k.lower() not in ("content-length", "host", "cookie", "accept-encoding")}

        hoje = datetime.now(nx._TZ_LOG).date()
        ini = (hoje - timedelta(days=dias)).isoformat()
        step(f"3) Fechamentos de {ini} a {hoje.isoformat()}")
        lista = ncomp.pedir_lista_paginada(page, trocar_periodo(ref.url, ini, hoje.isoformat()), cab)
        fechados = [x for x in lista if x.get("id") and x.get("dataFechamento")]
        log(f"{len(lista)} caixas no período, {len(fechados)} fechados")

        step("4) Detalhe dos fechamentos novos")
        base = urlsplit(ref.url)
        novos, falhas = 0, 0
        for x in fechados:
            if x["id"] in guardados:
                continue
            url = urlunsplit((base.scheme, base.netloc, base.path.rstrip("/") + "/" + x["id"], "", ""))
            try:
                f = fechamento_de(pedir_json(page, url, cab))
            except Exception as e:  # noqa: BLE001
                falhas += 1
                log(f"Fechamento {x.get('numeroOperacao')}: {str(e)[:200]}")
                if falhas >= 5:
                    raise
                continue
            guardados[f["id"]] = f
            novos += 1
            log(f"Fechamento {f['numero']} ({f['fechamento']}, PDV {f['pdv']}, {f['turno']}): R$ {f['apurado']:.2f}")
        corte = (hoje - timedelta(days=GUARDA_DIAS)).isoformat()
        todos = sorted((f for f in guardados.values() if (f.get("dia") or "") >= corte), key=lambda f: f.get("fechamento") or "")
        destino.parent.mkdir(parents=True, exist_ok=True)
        tmp = destino.with_name(f"{destino.name}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps({"atualizado": datetime.now(nx._TZ_LOG).isoformat(), "fechamentos": todos}, ensure_ascii=False), encoding="utf-8")
        os.chmod(tmp, 0o640)
        tmp.replace(destino)
        log(f"Caixa: {len(todos)} fechamentos guardados ({novos} novos{', ' + str(falhas) + ' com erro' if falhas else ''}) → {destino.name}")
        if falhas and novos == 0:  # antes "novas" (nome errado): com uma falha o robô parava com NameError
            raise RuntimeError(f"Falha ao baixar {falhas} fechamento(s) de caixa.")
    finally:
        try:
            page.remove_listener("request", on_req)
        except Exception:
            pass


def main():
    saida = os.getenv("SAIDA_CAIXA", "").strip()
    if not saida:
        print("ERRO: defina SAIDA_CAIXA")
        return 2
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "600")))
    pasta_pw = Path.cwd() / "pw_state"
    nx.limpar_locks_perfil(pasta_pw)
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(pasta_pw), headless=True, ignore_https_errors=nx.INSEGURO,
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
            coletar_caixa_na_pagina(page, saida)
            return 0
        except Exception:  # noqa: BLE001
            log("### ERRO NO FECHAMENTO DE CAIXA ###")
            print(traceback.format_exc())
            return 1
        finally:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    sys.exit(main())
