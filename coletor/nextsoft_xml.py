# nextsoft_xml.py — baixa os XMLs das notas (NFC-e e NF-e) do AppNext e extrai o CPF de cada cupom.
#
# Fluxo:
#   1) Login e troca de loja (mesmas funções do nextsoft_export_to_drive.py)
#   2) Fiscal → Gerar XML (https://www.appnext.com.br/#/fiscal/gerador-xml)
#   3) Abre os filtros (funil), escolhe Tipo "Todos" e Situação "Ativos" e clica em Gerar
#      → o AppNext baixa um .zip com um XML por nota
#   4) O pedido que o botão Gerar fez é repetido mês a mês para o período pedido
#      (DATA_INICIO a DATA_FIM), assim não é preciso clicar no calendário
#   5) Lê os XMLs e grava SAIDA_XML (JSON) com cupom, data, CPF/CNPJ e nome do destinatário
#
# Variáveis: as mesmas do script de vendas (APPNEXT_*, DATA_INICIO, DATA_FIM) + SAIDA_XML.
import io
import json
import os
import re
import sys
import traceback
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import unquote
import xml.etree.ElementTree as ET

SAIDA_XML = os.getenv("SAIDA_XML", "").strip()
if not SAIDA_XML:
    print("ERRO: defina SAIDA_XML")
    sys.exit(1)
# o módulo de vendas exige um destino; aqui só reaproveitamos login/troca de loja
os.environ.setdefault("SAIDA_ARQUIVO", str(Path.cwd() / "_nao_usado.xlsx"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import nextsoft_export_to_drive as nx  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

log, step = nx.log, nx.step
URL_XML = "https://www.appnext.com.br/#/fiscal/gerador-xml"


def dt_br(s):
    return datetime.strptime(s, "%d/%m/%Y").date()


INI = dt_br(os.getenv("DATA_INICIO", "01/06/2025"))
FIM = dt_br(os.getenv("DATA_FIM")) if os.getenv("DATA_FIM") else date.today()


def janelas(ini, fim):
    """[(ini, fim)] de mês em mês"""
    out, d = [], ini
    while d <= fim:
        prox = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
        out.append((d, min(fim, prox - timedelta(days=1))))
        d = prox
    return out


# ---------------- leitura dos XMLs ----------------
def _sem_ns(tag):
    return tag.rsplit("}", 1)[-1]


def _achar(raiz, caminho):
    """procura ignorando namespace: 'ide/nNF'"""
    nos = [raiz]
    for parte in caminho.split("/"):
        prox = []
        for n in nos:
            for el in n.iter():
                if _sem_ns(el.tag) == parte and el is not n:
                    prox.append(el)
                    break
        nos = prox
        if not nos:
            return None
    return nos[0]


def _txt(raiz, caminho):
    el = _achar(raiz, caminho)
    return (el.text or "").strip() if el is not None and el.text else ""


def ler_nota(conteudo: bytes):
    try:
        raiz = ET.fromstring(conteudo)
    except ET.ParseError:
        return None
    inf = _achar(raiz, "infNFe")
    if inf is None:
        return None  # evento de cancelamento etc.
    ide = _achar(inf, "ide")
    if ide is None:
        return None
    n = _txt(ide, "nNF")
    if not n.isdigit():
        return None
    dest = _achar(inf, "dest")
    cpf = _txt(dest, "CPF") if dest is not None else ""
    cnpj = _txt(dest, "CNPJ") if dest is not None else ""
    nome = _txt(dest, "xNome") if dest is not None else ""
    dh = _txt(ide, "dhEmi") or _txt(ide, "dEmi")
    return {
        "chave": (inf.get("Id") or "").replace("NFe", "") or None,
        "cupom": int(n),
        "serie": _txt(ide, "serie"),
        "mod": _txt(ide, "mod"),
        "data": dh[:10],
        "cpf": re.sub(r"\D", "", cpf) or None,
        "cnpj": re.sub(r"\D", "", cnpj) or None,
        "nome": nome[:80] or None,
        "valor": float(_txt(inf, "vNF") or 0) or None,
    }


def ler_zip(dados: bytes, notas: dict):
    with zipfile.ZipFile(io.BytesIO(dados)) as z:
        for nome in z.namelist():
            b = z.read(nome)
            if nome.lower().endswith(".zip"):
                ler_zip(b, notas)
            elif nome.lower().endswith(".xml"):
                n = ler_nota(b)
                if n:
                    notas[n["chave"] or f"{n['mod']}-{n['serie']}-{n['cupom']}"] = n


# ---------------- AppNext ----------------
def abrir_filtros(page):
    if page.get_by_text("Data de Emissão", exact=False).count() and page.get_by_text("Data de Emissão").first.is_visible():
        return
    ok = nx._click_first(page, [
        "button:has(i[class*='filter'])", "button:has(svg[class*='filter'])", "button:has([class*='funnel'])",
        "[title*='iltro']", "[aria-label*='iltro']",
        "xpath=//*[normalize-space()='Filtros:']/ancestor::*[.//button][1]//button[last()]",
    ])
    if not ok:
        raise RuntimeError("Não achei o botão de filtros (funil) na tela Gerar XML.")
    page.get_by_text("Data de Emissão").first.wait_for(timeout=15000)


def escolher(page, grupo, opcao):
    alvo = page.locator(f"xpath=//*[normalize-space()='{grupo}']/following::*[self::button or self::label or self::a or self::span or self::div][normalize-space()='{opcao}'][1]").first
    alvo.click(timeout=8000)
    log(f"{grupo}: {opcao}")


# datas nos pedidos: ISO (2026-11-01) ou brasileira (01/11/2026, também codificada 01%2F11%2F2026)
RE_DATA = re.compile(r"(\d{4})-(\d{2})-(\d{2})|(\d{2})(/|%2F)(\d{2})\5(\d{4})", re.I)


def trocar_datas(texto, ini: date, fim: date):
    achados = list(RE_DATA.finditer(texto))
    if len(achados) < 2:
        return None
    novos, out, pos = [ini] + [fim] * (len(achados) - 1), [], 0
    for m, d in zip(achados, novos):
        out.append(texto[pos:m.start()])
        if m.group(1):
            out.append(d.isoformat())
        else:
            sep = m.group(5)
            out.append(f"{d.day:02d}{sep}{d.month:02d}{sep}{d.year}")
        pos = m.end()
    out.append(texto[pos:])
    return "".join(out)


def main():
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "900")))
    notas, ok = {}, False
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(Path.cwd() / "pw_state"), headless=True, accept_downloads=True, ignore_https_errors=True,
            viewport={"width": 1600, "height": 950},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_default_timeout(30_000)
        page.set_default_navigation_timeout(60_000)
        pedidos = []
        page.on("request", lambda r: pedidos.append(r) if r.resource_type in ("xhr", "fetch", "document", "other") else None)
        try:
            step("1) Login")
            nx.goto_login_with_retries(page, nx.LOGIN_URL)
            if "/#/login" in page.url:
                page.fill(nx.SEL["rede"], nx.REDE)
                page.fill(nx.SEL["email"], nx.USER)
                page.fill(nx.SEL["senha"], nx.PASS)
                page.click(nx.SEL["entrar"])
            page.wait_for_url("**/#/loja/**", timeout=120_000)
            nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))

            step("2) Fiscal → Gerar XML")
            page.goto(URL_XML)
            page.get_by_text("Gerar XML").first.wait_for(timeout=30000)
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass

            step("3) Filtros: Tipo Todos, Situação Ativos")
            abrir_filtros(page)
            escolher(page, "Tipo", "Todos")
            escolher(page, "Situação", "Ativos")

            step("4) Gerar (pedido de referência com o período que está na tela)")
            antes = len(pedidos)
            with page.expect_download(timeout=180_000) as dl:
                page.get_by_role("button", name=re.compile(r"^\s*Gerar\s*$", re.I)).last.click()
            arq = dl.value
            ref_bytes = Path(arq.path()).read_bytes() if arq.path() else b""
            # o pedido que gerou o zip: o último com data no endereço ou no corpo
            cand = [r for r in pedidos[antes:] if "appnext" in r.url or "nextsoft" in r.url or r.url.startswith("http")]
            ref = None
            for r in reversed(cand):
                corpo = r.post_data or ""
                if len(RE_DATA.findall(unquote(r.url) + corpo)) >= 2 or len(RE_DATA.findall(r.url + corpo)) >= 2:
                    ref = r
                    break
            if ref:
                log(f"Pedido de referência: {ref.method} {ref.url[:300]}")
                if ref.post_data:
                    log(f"Corpo: {ref.post_data[:500]}")
            else:
                log("Não identifiquei o pedido do Gerar com datas. Pedidos vistos:")
                for r in cand[-12:]:
                    log(f"  {r.method} {r.url[:200]} {(r.post_data or '')[:200]}")

            step(f"5) Baixando {INI:%d/%m/%Y} a {FIM:%d/%m/%Y} mês a mês")
            if not ref:
                raise RuntimeError("Sem o pedido de referência não dá para escolher o período. Veja os pedidos listados acima.")
            cab = {k: v for k, v in ref.headers.items() if k.lower() not in ("content-length", "host", "cookie", "accept-encoding")}
            for a, b in janelas(INI, FIM):
                url = trocar_datas(ref.url, a, b) or ref.url
                corpo = trocar_datas(ref.post_data, a, b) if ref.post_data else None
                if url == ref.url and corpo in (None, ref.post_data):
                    raise RuntimeError("Não consegui trocar as datas no pedido do Gerar.")
                resp = page.request.fetch(url, method=ref.method, headers=cab, data=corpo, timeout=300_000)
                dados = resp.body()
                if not resp.ok:
                    raise RuntimeError(f"{a:%m/%Y}: AppNext respondeu {resp.status}")
                if not dados.startswith(b"PK"):
                    # algumas telas devolvem um JSON com o endereço do arquivo
                    try:
                        j = json.loads(dados.decode("utf-8", "replace"))
                        link = next((v for v in (j.values() if isinstance(j, dict) else []) if isinstance(v, str) and v.startswith("http")), None)
                    except Exception:
                        link = None
                    if link:
                        dados = page.request.get(link, timeout=300_000).body()
                    if not dados.startswith(b"PK"):
                        if len(dados) < 400:  # mês sem notas
                            log(f"{a:%m/%Y}: sem notas ({dados[:120]!r})")
                            continue
                        raise RuntimeError(f"{a:%m/%Y}: resposta não é um .zip ({dados[:120]!r})")
                antes_n = len(notas)
                ler_zip(dados, notas)
                log(f"{a:%m/%Y}: {len(notas) - antes_n} notas ({len(dados) // 1024} KB)")
            if not notas and ref_bytes.startswith(b"PK"):
                ler_zip(ref_bytes, notas)
            ok = True
        except Exception:
            log("### ERRO DURANTE O FLUXO DO XML ###")
            print(traceback.format_exc())
        finally:
            try:
                ctx.close()
            except Exception:
                pass

    if ok:
        lista = sorted(notas.values(), key=lambda n: (n["data"], n["cupom"]))
        com_doc = sum(1 for n in lista if n["cpf"] or n["cnpj"])
        destino = Path(SAIDA_XML)
        destino.parent.mkdir(parents=True, exist_ok=True)
        tmp = destino.with_suffix(".tmp")
        tmp.write_text(json.dumps({"de": INI.isoformat(), "ate": FIM.isoformat(), "total": len(lista), "notas": [n for n in lista if n["cpf"] or n["cnpj"]]}, ensure_ascii=False), encoding="utf-8")
        tmp.replace(destino)
        log(f"XML: {len(lista)} notas, {com_doc} com CPF/CNPJ → {destino.name}")
        return 0
    log("### Finalizando com erro (exit 1) ###")
    return 1


if __name__ == "__main__":
    sys.exit(main())
