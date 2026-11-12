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
import base64
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
def _tela_xml_visivel(page):
    # "Gerar XML" também existe no menu (escondido): confere o que só existe na tela
    return page.locator("text=/Filtros\\s*:/ >> visible=true").count() > 0 or page.locator("button:has-text('Gerar') >> visible=true").count() > 0


def fazer_login(page):
    if "/#/login" in page.url:
        page.fill(nx.SEL["rede"], nx.REDE)
        page.fill(nx.SEL["email"], nx.USER)
        page.fill(nx.SEL["senha"], nx.PASS)
        page.click(nx.SEL["entrar"])
    page.wait_for_url("**/#/loja/**", timeout=120_000)


def ir_para_xml(page):
    """troca só o '#' do endereço: a página não recarrega e o login continua valendo
    (um goto para www.appnext.com.br quando o login abriu em appnext.com.br recarrega e desloga)"""
    page.evaluate("() => { location.hash = '#/fiscal/gerador-xml'; }")


def abrir_tela_xml(page):
    """abre Fiscal → Gerar XML; se o AppNext tiver voltado para o login, entra de novo"""
    for tentativa in range(1, 4):
        try:
            if "/#/login" in page.url:
                log("O AppNext voltou para o login; entrando de novo…")
                fazer_login(page)
                nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            if tentativa < 3:
                ir_para_xml(page)
            else:
                log("Tentando pelo menu Fiscal → Gerar XML…")
                nx._click_first(page, ["text=/^\\s*Fiscal\\s*$/ >> visible=true", "a:has-text('Fiscal') >> visible=true"])
                page.wait_for_timeout(800)
                page.locator("a[href*='gerador-xml'] >> visible=true").first.click(timeout=8000)
            for _ in range(25):
                if _tela_xml_visivel(page):
                    log(f"Tela Gerar XML aberta ({page.url}).")
                    return
                page.wait_for_timeout(1000)
        except Exception as e:  # noqa: BLE001
            log(f"Tentativa {tentativa}: {str(e).splitlines()[0][:200]}")
        try:
            texto = page.evaluate("() => document.body.innerText.slice(0, 400)").replace("\n", " | ")
        except Exception:  # noqa: BLE001
            texto = "?"
        log(f"Ainda não abriu. Endereço: {page.url} · na tela: {texto}")
    raise RuntimeError("Não consegui abrir a tela Fiscal → Gerar XML.")


def abrir_filtros(page):
    if page.locator("text=Data de Emissão >> visible=true").count():
        return
    ok = nx._click_first(page, [
        "button:has(i[class*='filter'])", "button:has(svg[class*='filter'])", "button:has([class*='funnel'])",
        "[title*='iltro']", "[aria-label*='iltro']",
        "xpath=//*[normalize-space()='Filtros:']/ancestor::*[.//button][1]//button[last()]",
    ])
    if not ok:
        raise RuntimeError("Não achei o botão de filtros (funil) na tela Gerar XML.")
    page.locator("text=Data de Emissão >> visible=true").first.wait_for(timeout=15000)


def escolher(page, grupo, opcao):
    alvo = page.locator(f"xpath=//*[normalize-space()='{grupo}']/following::*[self::button or self::label or self::a or self::span or self::div][normalize-space()='{opcao}'][1] >> visible=true").first
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


def desembrulhar(page, dados: bytes) -> bytes:
    """O AppNext devolve o .zip em base64 dentro de um JSON ("UEsDB..." = "PK..."),
    às vezes direto como texto e às vezes num campo; também aceita um endereço para baixar."""
    try:
        j = json.loads(dados.decode("utf-8", "replace"))
    except Exception:  # noqa: BLE001
        j = dados.decode("latin-1").strip().strip('"')
    textos = []
    def coletar(v):
        if isinstance(v, str):
            textos.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                coletar(x)
        elif isinstance(v, list):
            for x in v:
                coletar(x)
    coletar(j)
    for t in textos:
        t = t.strip()
        if t.startswith("data:") and "," in t:
            t = t.split(",", 1)[1]
        if t.startswith("UEsDB") or t.startswith("UEsFB"):
            try:
                return base64.b64decode(t + "=" * (-len(t) % 4))
            except Exception:  # noqa: BLE001
                pass
    for t in textos:
        if t.startswith("http"):
            return page.request.get(t, timeout=300_000).body()
    return dados


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
        pedidos, respostas = [], []
        # só pedidos do próprio AppNext (telemetria como Sentry/Google também manda datas no corpo)
        do_appnext = lambda u: re.search(r"https?://([^/]*\.)?(appnext\.com\.br|nextsoft[^/]*)(/|$)", u, re.I) is not None
        page.on("request", lambda r: pedidos.append(r) if r.resource_type in ("xhr", "fetch", "document", "other") and do_appnext(r.url) else None)
        page.on("response", lambda r: respostas.append(r) if r.request.resource_type in ("xhr", "fetch", "document", "other") and do_appnext(r.url) else None)
        try:
            step("1) Login")
            nx.goto_login_with_retries(page, nx.LOGIN_URL)
            fazer_login(page)
            nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))

            step("2) Fiscal → Gerar XML")
            abrir_tela_xml(page)
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass

            step("3) Filtros: Tipo Todos, Situação Ativos")
            abrir_filtros(page)
            escolher(page, "Tipo", "Todos")
            escolher(page, "Situação", "Ativos")

            step("4) Gerar (pedido de referência com o período que está na tela)")
            antes, antes_r = len(pedidos), len(respostas)
            with page.expect_download(timeout=180_000) as dl:
                page.get_by_role("button", name=re.compile(r"^\s*Gerar\s*$", re.I)).last.click()
            arq = dl.value
            ref_bytes = Path(arq.path()).read_bytes() if arq.path() else b""
            page.wait_for_timeout(1500)
            cand = pedidos[antes:]
            ref = None
            # 1º: a resposta que trouxe o arquivo (zip / download)
            for resp in reversed(respostas[antes_r:]):
                h = {k.lower(): v for k, v in resp.headers.items()}
                tipo = h.get("content-type", "")
                if "zip" in tipo or "octet-stream" in tipo or "attachment" in h.get("content-disposition", ""):
                    ref = resp.request
                    log(f"Resposta com o arquivo: {resp.status} {tipo} {h.get('content-disposition', '')[:120]}")
                    break
            # 2º: o último pedido do AppNext com as duas datas no endereço ou no corpo
            if ref is None:
                for r in reversed(cand):
                    corpo = r.post_data or ""
                    if len(RE_DATA.findall(unquote(r.url) + corpo)) >= 2:
                        ref = r
                        break
            if ref:
                log(f"Pedido de referência: {ref.method} {ref.url[:300]}")
                if ref.post_data:
                    log(f"Corpo: {ref.post_data[:500]}")
            else:
                log("Não identifiquei o pedido do Gerar com datas. Pedidos vistos:")
                for r in cand[-15:]:
                    log(f"  {r.method} {r.url[:200]} {(r.post_data or '')[:200]}")
                for resp in respostas[antes_r:][-15:]:
                    log(f"  resposta {resp.status} {resp.url[:160]} {resp.headers.get('content-type', '')}")

            step(f"5) Baixando {INI:%d/%m/%Y} a {FIM:%d/%m/%Y} mês a mês")
            if not ref:
                raise RuntimeError("Sem o pedido de referência não dá para escolher o período. Veja os pedidos listados acima.")
            cab = {k: v for k, v in ref.headers.items() if k.lower() not in ("content-length", "host", "cookie", "accept-encoding")}
            for a, b in janelas(INI, FIM):
                url_nova = trocar_datas(ref.url, a, b)
                corpo = trocar_datas(ref.post_data, a, b) if ref.post_data else None
                if url_nova is None and corpo is None:
                    raise RuntimeError("Não achei as datas no pedido do Gerar para trocar.")
                url = url_nova or ref.url
                if corpo is None:
                    corpo = ref.post_data
                resp = page.request.fetch(url, method=ref.method, headers=cab, data=corpo, timeout=300_000)
                dados = resp.body()
                if not resp.ok:
                    raise RuntimeError(f"{a:%m/%Y}: AppNext respondeu {resp.status}")
                if not dados.startswith(b"PK"):
                    dados = desembrulhar(page, dados)
                    if not dados.startswith(b"PK"):
                        # não aceita "sem notas" às cegas: pode ser o pedido errado
                        raise RuntimeError(f"{a:%m/%Y}: a resposta não é um .zip ({resp.headers.get('content-type', '')}): {dados[:200]!r}")
                antes_n = len(notas)
                ler_zip(dados, notas)
                log(f"{a:%m/%Y}: {len(notas) - antes_n} notas ({len(dados) // 1024} KB)")
            # o zip baixado pelo clique é do período que estava na tela (não do pedido): só serve de conferência
            if ref_bytes.startswith(b"PK"):
                conf = {}
                ler_zip(ref_bytes, conf)
                dias = sorted({n["data"] for n in conf.values()})
                log(f"Conferência: o clique em Gerar trouxe {len(conf)} notas ({dias[0] if dias else '-'} a {dias[-1] if dias else '-'}); não entram na importação")
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
