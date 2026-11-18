# nextsoft_xml.py — baixa os XMLs das notas (NFC-e e NF-e) do AppNext e extrai o CPF de cada cupom.
#
# Fluxo:
#   1) Login e troca de loja (mesmas funções do nextsoft_export_to_drive.py)
#   2) Fiscal → Gerar XML (https://www.appnext.com.br/#/fiscal/gerador-xml)
#   3) Abre os filtros (funil), escolhe Tipo "Todos" e Situação "Ativos" e clica em Gerar
#      (os cancelados vêm repetindo o pedido com cancelado:true; os XMLs ficam em dados/<loja>/xmls/AAAA-MM/)
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
# o módulo de vendas exige um destino; aqui só reaproveitamos login/troca de loja
os.environ.setdefault("SAIDA_ARQUIVO", str(Path.cwd() / "_nao_usado.xlsx"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import nextsoft_export_to_drive as nx  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit  # noqa: E402

log, step = nx.log, nx.step
URL_XML = "https://www.appnext.com.br/#/fiscal/gerador-xml"
MAX_ZIP_BYTES = 250 * 1024 * 1024


def dt_br(s):
    return datetime.strptime(s, "%d/%m/%Y").date()


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


def _limpar_chave_arq(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(s or "")).strip("._")[:80] or "nota"


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
    raw_id = (inf.get("Id") or "").replace("NFe", "").strip()
    chave = raw_id if re.fullmatch(r"\d{44}", raw_id) else (_limpar_chave_arq(raw_id) if raw_id else None)
    return {
        "chave": chave,
        "cupom": int(n),
        "serie": _txt(ide, "serie"),
        "mod": _txt(ide, "mod"),
        "data": dh[:10],
        "cpf": re.sub(r"\D", "", cpf) or None,
        "cnpj": re.sub(r"\D", "", cnpj) or None,
        "nome": nome[:80] or None,
        "valor": float(_txt(inf, "vNF") or 0) or None,
    }


def ler_zip(dados: bytes, notas: dict, brutos: list = None, _nivel: int = 0, _acum: list = None):
    """notas: chave -> dados da nota; brutos (opcional): [(nome, bytes, nota ou None)] com todos os XMLs"""
    if _nivel > 3:
        raise RuntimeError("ZIP com muitos níveis aninhados")
    if _acum is None:
        _acum = [0]
    with zipfile.ZipFile(io.BytesIO(dados)) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            _acum[0] += info.file_size
            if _acum[0] > MAX_ZIP_BYTES:
                raise RuntimeError("ZIP de XMLs excedeu o limite seguro de 250 MB descomprimidos")
            nome = info.filename
            b = z.read(info)
            if nome.lower().endswith(".zip"):
                ler_zip(b, notas, brutos, _nivel + 1, _acum)
            elif nome.lower().endswith(".xml"):
                n = ler_nota(b)
                if n:
                    notas[n["chave"] or f"{n['mod']}-{n['serie']}-{n['cupom']}"] = n
                if brutos is not None:
                    brutos.append((nome, b, n))


# ---------------- XMLs originais (vão para a contabilidade) ----------------
# dados/<loja>/xmls/AAAA-MM/{ativos,cancelados}/AAAAMMDD_<chave>.xml
RE_CHAVE = re.compile(rb"<chNFe>(\d{44})</chNFe>")
RE_DH = re.compile(rb"<(?:dhEvento|dhRegEvento|dhEmi)>(\d{4})-(\d{2})-(\d{2})")


def guardar_xmls(brutos, situacao: str, ini: date, fim: date, pasta_xmls: Path):
    """grava os XMLs do período primeiro e só depois remove antigos substituídos (quando começa no dia 1)"""
    meses = {}
    for nome, b, n in brutos:
        if n and re.fullmatch(r"\d{4}-\d{2}-\d{2}", n.get("data") or ""):
            dia = n["data"].replace("-", "")
            chave = _limpar_chave_arq(n["chave"] or f"{n['mod']}-{n['serie']}-{n['cupom']}")
        else:  # evento (cancelamento etc.): chave da nota + data do evento
            m, d = RE_CHAVE.search(b), RE_DH.search(b)
            dia = b"".join(d.groups()).decode() if d else ini.strftime("%Y%m%d")
            chave = "evento_" + (m.group(1).decode() if m else _limpar_chave_arq(Path(nome).stem)[:60])
        meses.setdefault(f"{dia[:4]}-{dia[4:6]}", []).append((f"{dia}_{chave}.xml", b))
    if ini.day == 1:
        meses.setdefault(ini.strftime("%Y-%m"), [])
    for ym, arqs in meses.items():
        if not re.fullmatch(r"\d{4}-\d{2}", ym):
            continue
        pasta = pasta_xmls / ym / situacao
        pasta.mkdir(parents=True, exist_ok=True)
        novos_nomes = set()
        for nome, b in arqs:
            novos_nomes.add(nome)
            tmp = pasta / f"{nome}.{os.getpid()}.tmp"
            tmp.write_bytes(b)
            os.chmod(tmp, 0o640)
            tmp.replace(pasta / nome)
        if ini.day == 1 and ym == ini.strftime("%Y-%m"):
            limite = fim.strftime("%Y%m%d")
            for velho in pasta.glob("*.xml"):
                if velho.name not in novos_nomes and velho.name[:8] <= limite:
                    velho.unlink(missing_ok=True)


class ErroAppNext(RuntimeError):
    """o AppNext recusou o pedido: guarda o código e o texto da resposta (o motivo)"""
    def __init__(self, a, status, texto):
        self.status, self.texto = status, texto
        super().__init__(f"{a:%m/%Y}: AppNext respondeu {status}{(': ' + texto) if texto else ''}")


RE_VAZIO = re.compile(r"nenhum|nenhuma|n[ãa]o (h[áa]|existe|foi encontrad|encontr)|sem (nota|xml|arquivo|registro)|not found|no (data|content|records)", re.I)


def texto_resposta(resp):
    try:
        t = resp.text()
    except Exception:  # noqa: BLE001
        return ""
    try:
        j = json.loads(t)
        if isinstance(j, dict):
            t = j.get("message") or j.get("mensagem") or j.get("error") or j.get("erro") or j.get("title") or json.dumps(j, ensure_ascii=False)
    except Exception:  # noqa: BLE001
        pass
    return re.sub(r"\s+", " ", str(t)).strip()[:300]


def pedir_zip(page, ref, cab, a, b, corpo_base):
    url_nova = trocar_datas_url(ref.url, a, b) or trocar_datas(ref.url, a, b)
    corpo = (trocar_datas_json(corpo_base, a, b) or trocar_datas(corpo_base, a, b)) if corpo_base else None
    if url_nova is None and corpo is None:
        raise RuntimeError("Não achei as datas no pedido do Gerar para trocar.")
    url = url_nova or ref.url
    if corpo is None:
        corpo = corpo_base
    resp = page.request.fetch(url, method=ref.method, headers=cab, data=corpo, timeout=300_000)
    dados = resp.body()
    if not resp.ok:
        raise ErroAppNext(a, resp.status, texto_resposta(resp))
    if not dados.startswith(b"PK"):
        dados = desembrulhar(page, dados)
        if not dados.startswith(b"PK"):
            raise RuntimeError(f"{a:%m/%Y}: a resposta não é um .zip ({resp.headers.get('content-type', '')}): {dados[:200]!r}")
    return dados


# ---------------- AppNext ----------------
def _tela_xml_visivel(page):
    return page.locator("text=/Filtros\\s*:/ >> visible=true").count() > 0 or page.locator("button:has-text('Gerar') >> visible=true").count() > 0


def fazer_login(page):
    if "/#/login" in page.url:
        page.fill(nx.SEL["rede"], nx.REDE)
        page.fill(nx.SEL["email"], nx.USER)
        page.fill(nx.SEL["senha"], nx.PASS)
        page.click(nx.SEL["entrar"])
    page.wait_for_url("**/#/loja/**", timeout=120_000)


def ir_para_xml(page):
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


RE_DATA = re.compile(r"(\d{4})-(\d{2})-(\d{2})|(\d{2})(/|%2F)(\d{2})\5(\d{4})", re.I)
CHAVES_INI = {"datainicial", "dataemissaoinicial", "datainicio", "inicio", "de"}
CHAVES_FIM = {"datafinal", "dataemissaofinal", "datafim", "fim", "ate"}


def _fmt_mesmo_estilo(val_atual: str, d: date) -> str:
    m = RE_DATA.search(str(val_atual or ""))
    if not m:
        return d.isoformat()
    novo = d.isoformat() if m.group(1) else f"{d.day:02d}{m.group(5)}{d.month:02d}{m.group(5)}{d.year}"
    return val_atual[:m.start()] + novo + val_atual[m.end():]


def trocar_datas_url(url: str, ini: date, fim: date):
    p = urlsplit(url)
    if not p.query:
        return None
    pares = parse_qsl(p.query, keep_blank_values=True)
    mudou_i, mudou_f, out = False, False, []
    for k, v in pares:
        kl = re.sub(r"[^a-z]", "", k.lower())
        if kl in CHAVES_INI and RE_DATA.search(v):
            out.append((k, _fmt_mesmo_estilo(v, ini)))
            mudou_i = True
        elif kl in CHAVES_FIM and RE_DATA.search(v):
            out.append((k, _fmt_mesmo_estilo(v, fim)))
            mudou_f = True
        else:
            out.append((k, v))
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(out), p.fragment)) if (mudou_i and mudou_f) else None


def trocar_datas_json(corpo: str, ini: date, fim: date):
    try:
        j = json.loads(corpo)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(j, dict):
        return None
    mudou = [False, False]
    def visitar(obj):
        if isinstance(obj, dict):
            for k, v in list(obj.items()):
                kl = re.sub(r"[^a-z]", "", str(k).lower())
                if isinstance(v, str) and kl in CHAVES_INI and RE_DATA.search(v):
                    obj[k] = _fmt_mesmo_estilo(v, ini)
                    mudou[0] = True
                elif isinstance(v, str) and kl in CHAVES_FIM and RE_DATA.search(v):
                    obj[k] = _fmt_mesmo_estilo(v, fim)
                    mudou[1] = True
                else:
                    visitar(v)
        elif isinstance(obj, list):
            for x in obj:
                visitar(x)
    visitar(j)
    return json.dumps(j, ensure_ascii=False) if (mudou[0] and mudou[1]) else None


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
        if t.startswith("https://") and re.search(r"(appnext\.com\.br|nextsoft|amazonaws\.com|blob\.core\.windows\.net)", t, re.I):
            return page.request.get(t, timeout=300_000).body()
    return dados


def coletar_xml_na_pagina(page, ini: date, fim: date, saida_xml: str):
    """Executa Fiscal → Gerar XML usando uma página já autenticada na loja certa."""
    pasta_xmls = Path(os.getenv("PASTA_XMLS") or (Path(saida_xml).parent.parent / "xmls"))
    notas = {}
    pedidos, respostas = [], []
    do_appnext = lambda u: re.search(r"https?://([^/]*\.)?(appnext\.com\.br|nextsoft[^/]*)(/|$)", u, re.I) is not None
    on_req = lambda r: pedidos.append(r) if r.resource_type in ("xhr", "fetch", "document", "other") and do_appnext(r.url) else None
    on_res = lambda r: respostas.append(r) if r.request.resource_type in ("xhr", "fetch", "document", "other") and do_appnext(r.url) else None
    page.on("request", on_req)
    page.on("response", on_res)
    try:
        nx.garantir_loja(page)
        step("2) Fiscal → Gerar XML")
        abrir_tela_xml(page)
        nx.garantir_loja(page)
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
        for resp in reversed(respostas[antes_r:]):
            h = {k.lower(): v for k, v in resp.headers.items()}
            tipo = h.get("content-type", "")
            if "zip" in tipo or "octet-stream" in tipo or "attachment" in h.get("content-disposition", ""):
                ref = resp.request
                log(f"Resposta com o arquivo: {resp.status} {tipo} {h.get('content-disposition', '')[:120]}")
                break
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

        step(f"5) Baixando {ini:%d/%m/%Y} a {fim:%d/%m/%Y} mês a mês")
        if not ref:
            raise RuntimeError("Sem o pedido de referência não dá para escolher o período. Veja os pedidos listados acima.")
        cab = {k: v for k, v in ref.headers.items() if k.lower() not in ("content-length", "host", "cookie", "accept-encoding")}
        corpo_canc = None
        if ref.post_data and re.search(r'"cancelado"\s*:\s*false', ref.post_data):
            corpo_canc = re.sub(r'"cancelado"\s*:\s*false', '"cancelado":true', ref.post_data)
        else:
            log("Aviso: não achei 'cancelado' no pedido do Gerar; só os XMLs ativos serão guardados.")
        for a, b in janelas(ini, fim):
            try:
                dados = pedir_zip(page, ref, cab, a, b, ref.post_data)
            except ErroAppNext as e:
                if e.status in (400, 404) and RE_VAZIO.search(e.texto or ""):
                    log(f"{a:%m/%Y}: sem notas ativas no período (AppNext: {e.texto})")
                    dados = None
                else:
                    raise
            antes_n = len(notas)
            brutos = []
            if dados:
                ler_zip(dados, notas, brutos)
                guardar_xmls(brutos, "ativos", a, b, pasta_xmls)
            txt = f"{a:%m/%Y}: {len(notas) - antes_n} notas ativas ({len(dados or b'') // 1024} KB)"
            if corpo_canc:
                try:
                    dc = pedir_zip(page, ref, cab, a, b, corpo_canc)
                except ErroAppNext as e:
                    if e.status not in (400, 404):
                        raise
                    log(f"{a:%m/%Y}: nenhuma nota cancelada (AppNext respondeu {e.status}{': ' + e.texto if e.texto else ''})")
                    dc = None
                canc, bc = {}, []
                if dc:
                    ler_zip(dc, canc, bc)
                bc = [x for x in bc if not (x[2] and (x[2]["chave"] or "") in notas)]
                if dc:
                    guardar_xmls(bc, "cancelados", a, b, pasta_xmls)
                txt += f" · {sum(1 for x in bc if x[2])} canceladas ({len(bc)} XMLs)"
            log(txt)
        if ref_bytes.startswith(b"PK"):
            conf = {}
            ler_zip(ref_bytes, conf)
            dias = sorted({n["data"] for n in conf.values()})
            log(f"Conferência: o clique em Gerar trouxe {len(conf)} notas ({dias[0] if dias else '-'} a {dias[-1] if dias else '-'}); não entram na importação")
    finally:
        try:
            page.remove_listener("request", on_req)
            page.remove_listener("response", on_res)
        except Exception:
            pass

    lista = sorted(notas.values(), key=lambda n: (n["data"], n["cupom"]))
    com_doc = sum(1 for n in lista if n["cpf"] or n["cnpj"])
    destino = Path(saida_xml)
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_name(f"{destino.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps({"de": ini.isoformat(), "ate": fim.isoformat(), "total": len(lista), "notas": [n for n in lista if n["cpf"] or n["cnpj"]]}, ensure_ascii=False), encoding="utf-8")
    os.chmod(tmp, 0o640)
    tmp.replace(destino)
    log(f"XML: {len(lista)} notas, {com_doc} com CPF/CNPJ → {destino.name}")


def main():
    saida = os.getenv("SAIDA_XML", "").strip()
    if not saida:
        print("ERRO: defina SAIDA_XML")
        return 1
    ini = dt_br(os.getenv("DATA_INICIO", "01/06/2025"))
    fim = dt_br(os.getenv("DATA_FIM")) if os.getenv("DATA_FIM") else datetime.now(nx._TZ_LOG).date()
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "900")))
    pasta_pw = Path.cwd() / "pw_state"
    nx.limpar_locks_perfil(pasta_pw)
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(pasta_pw), headless=True, accept_downloads=True, ignore_https_errors=nx.INSEGURO,
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
            coletar_xml_na_pagina(page, ini, fim, saida)
            return 0
        except Exception:
            log("### ERRO DURANTE O FLUXO DO XML ###")
            print(traceback.format_exc())
            log("### Finalizando com erro (exit 1) ###")
            return 1
        finally:
            try:
                ctx.close()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
