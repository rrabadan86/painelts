# nextsoft_export_to_drive.py
# Fluxo:
# 1) Login (resiliente: retries, timeouts maiores, user-agent real)
# 2) Troca de loja (via secret APPNEXT_LOJA_DESTINO)
# 3) Vendas > Vendedor Analítico
# 4) Abre filtros (estabiliza grid)
# 5) Tenta exportar; se URL direta não for capturada (blob/POST), FALLBACK:
#    refaz a chamada de dados em janelas mensais e gera o Excel localmente
# 6) Envia o arquivo ao Google Drive via rclone (se DRIVE_FOLDER_ID estiver definido)
# 7) Envia o arquivo ao painel Tea Shop na VPS (se PAINEL_URL estiver definido)

import os
import sys
import subprocess
import traceback
import shutil
import json
import re
import threading           # <<< NOVO: usado pelo watchdog global
import time                # <<< NOVO: usado pelo watchdog global
from pathlib import Path
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, parse_qs, urlencode
import urllib.request      # <<< NOVO: envio ao painel (sem dependências extras)
import urllib.error

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

from openpyxl import Workbook
from openpyxl.styles import Font, Alignment

# ================= LOG =================
try:
    from zoneinfo import ZoneInfo
    _TZ_LOG = ZoneInfo(os.getenv("TZ") or "America/Sao_Paulo")
except Exception:  # noqa: BLE001
    _TZ_LOG = None


def log(msg: str):
    # horário de Brasília no log (o container pode estar em UTC)
    now = datetime.now(_TZ_LOG).strftime("%H:%M:%S")
    print(f"[{now}] {msg}", flush=True)


def step(title: str):
    log("=" * 70)
    log(title)
    log("=" * 70)


# ============== WATCHDOG GLOBAL (NOVO) ==============
# Mata o processo se ele exceder o tempo máximo, não importa onde
# o Playwright esteja travado. Roda numa thread separada (daemon).
def start_watchdog(max_seconds: int):
    def _killer():
        time.sleep(max_seconds)
        log(f"### TIMEOUT GLOBAL: excedeu {max_seconds}s ({max_seconds // 60} min). Abortando. ###")
        # 124 é o código convencional de timeout; faz o job FALHAR no Actions
        os._exit(124)
    threading.Thread(target=_killer, daemon=True).start()
    log(f"[watchdog] ativo: aborta em {max_seconds}s ({max_seconds // 60} min).")


load_dotenv()

# ================ CONFIG ================
REDE = os.getenv("APPNEXT_REDE", "").strip()
USER = os.getenv("APPNEXT_USER", "").strip()
PASS = os.getenv("APPNEXT_PASS", "").strip()

DRIVE_REMOTE = os.getenv("DRIVE_REMOTE", "GDRIVE:")
DRIVE_FOLDER_ID = os.getenv("DRIVE_FOLDER_ID", "").strip()
DRIVE_FILE_NAME = os.getenv("DRIVE_FILE_NAME", "importacaoA.xlsx").strip()

# ---- Painel Tea Shop (VPS) ----
# PAINEL_URL   ex.: https://painel.seudominio.com.br
# PAINEL_TOKEN token da loja (na VPS: node scripts/admin.js token <loja>)
# PAINEL_LOJA  id da loja no painel (ex.: torres)
PAINEL_URL = os.getenv("PAINEL_URL", "").strip().rstrip("/")
PAINEL_TOKEN = os.getenv("PAINEL_TOKEN", "").strip()
PAINEL_LOJA = os.getenv("PAINEL_LOJA", "").strip().lower()
PAINEL_ARQUIVO = os.getenv("PAINEL_ARQUIVO", "importacaoA").strip()

ENVIAR_DRIVE = bool(DRIVE_FOLDER_ID)
ENVIAR_PAINEL = bool(PAINEL_URL)

# ---- Gravação direta (quando o script roda na própria VPS, pelo coletor) ----
# SAIDA_ARQUIVO ex.: /data/torres/importacaoA.xlsx
SAIDA_ARQUIVO = os.getenv("SAIDA_ARQUIVO", "").strip()
GRAVAR_LOCAL = bool(SAIDA_ARQUIVO)

# Tempo máximo total do processo, em segundos (default 7 min = 420s).
# Pode ser sobrescrito via secret/variável MAX_RUNTIME_SECONDS.
MAX_RUNTIME_SECONDS = int(os.getenv("MAX_RUNTIME_SECONDS", "420"))

# ---- Datas ----
# Lógica:
#  - Se DATA_INICIO for definida explicitamente no ambiente, usa ela.
#  - Senão, se DIAS_JANELA for definida, calcula uma janela deslizante
#    (ex.: últimos 60 dias) -> mantém o tempo de execução estável.
#  - Senão, mantém o comportamento antigo (data fixa 01/06/2025).
DIAS_JANELA = os.getenv("DIAS_JANELA", "").strip()
_data_inicio_env = os.getenv("DATA_INICIO", "").strip()

if _data_inicio_env:
    DATA_INICIO = _data_inicio_env
elif DIAS_JANELA:
    _dias = int(DIAS_JANELA)
    DATA_INICIO = (datetime.now() - timedelta(days=_dias)).strftime("%d/%m/%Y")
else:
    DATA_INICIO = "01/06/2025"  # comportamento original preservado

DATA_FIM = os.getenv("DATA_FIM", "").strip()  # vazio => hoje 23:59:59

TEMPLATE_XLSX = os.getenv("TEMPLATE_XLSX", "importacaoA.xlsx")
TEMPLATE_HEADER_ROW = int(os.getenv("TEMPLATE_HEADER_ROW", "2"))

# Forçar lojaId diretamente no fallback (se quiser)
LOJA_ID_DESTINO = os.getenv("APPNEXT_LOJA_ID_DESTINO", "").strip()

RCLONE_PATH = os.getenv("RCLONE_PATH") or shutil.which("rclone") or r"C:\rclone\rclone.exe"
if ENVIAR_DRIVE and not Path(RCLONE_PATH).exists() and shutil.which("rclone") is None:
    log("ERRO: rclone não encontrado. Ajuste RCLONE_PATH ou adicione ao PATH.")
    sys.exit(1)

if not (ENVIAR_DRIVE or ENVIAR_PAINEL or GRAVAR_LOCAL):
    log("ERRO: nenhum destino configurado. Defina SAIDA_ARQUIVO, DRIVE_FOLDER_ID e/ou PAINEL_URL.")
    sys.exit(1)

if ENVIAR_PAINEL and not (PAINEL_TOKEN and PAINEL_LOJA):
    log("ERRO: PAINEL_URL definido, mas faltam PAINEL_TOKEN e/ou PAINEL_LOJA.")
    sys.exit(1)

if not (REDE and USER and PASS):
    log("ERRO: Preencha APPNEXT_REDE / APPNEXT_USER / APPNEXT_PASS")
    sys.exit(1)

TS = datetime.now().strftime("%Y%m%d_%H%M%S")
LOCAL_OUT = Path.cwd() / f"export_nextsoft_{TS}.xlsx"
LOGIN_URL = "https://www.appnext.com.br/#/login"
INSEGURO = os.getenv("APPNEXT_INSEGURO", "0").strip() == "1"
_BRT = timezone(timedelta(hours=-3))


def limpar_locks_perfil(pasta_pw: Path):
    """Remove travas órfãs do Chromium (SingletonLock/Cookie/Socket) deixadas por processos encerrados à força."""
    for nome in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        p = pasta_pw / nome
        try:
            if p.is_symlink() or p.exists():
                p.unlink(missing_ok=True)
        except OSError:
            pass


# -------- datas ----------
def to_dt(s: str, end=False):
    try:
        d = datetime.strptime(s, "%d/%m/%Y")
        return d.replace(hour=23, minute=59, second=59) if end else d
    except Exception:
        return None


def para_iso_utc_brt(dt_brt: datetime, fim=False) -> str:
    """Converte data/hora em Brasília (-03:00) para ISO UTC (...Z) esperado pela API do AppNext."""
    base = dt_brt.replace(hour=23, minute=59, second=59, microsecond=999000) if fim else dt_brt.replace(hour=0, minute=0, second=0, microsecond=0)
    utc = base.replace(tzinfo=_BRT).astimezone(timezone.utc)
    ms = 999 if fim else 0
    return utc.strftime(f"%Y-%m-%dT%H:%M:%S.{ms:03d}Z")


if not DATA_FIM:
    DATA_FIM = datetime.now(_TZ_LOG).strftime("%d/%m/%Y")

INI_DT = to_dt(DATA_INICIO) or datetime(2025, 6, 1)
FIM_DT = to_dt(DATA_FIM, end=True) or datetime.now(_TZ_LOG).replace(tzinfo=None, hour=23, minute=59, second=59)

# ISO em UTC correspondente ao início (00:00 BRT) e fim (23:59:59.999 BRT) do dia em Brasília
FMT_JSON_INI = para_iso_utc_brt(INI_DT, fim=False)
FMT_JSON_FIM = para_iso_utc_brt(FIM_DT, fim=True)
FMT_BR_INI = INI_DT.strftime("%d/%m/%Y, %H:%M:%S")
FMT_BR_FIM = FIM_DT.strftime("%d/%m/%Y, %H:%M:%S")

log(f"[datas] período: {FMT_BR_INI}  ->  {FMT_BR_FIM}")

# -------- seletores ----------
SEL = {
    # login
    "rede": "input[placeholder='Rede']",
    "email": "input[placeholder='Email']",
    "senha": "input[placeholder='Senha']",
    "entrar": "button:has-text('Entrar'), button:has-text('Login')",
    # menu
    "menu_vendas": "nav >> text=Vendas, header >> text=Vendas, a[href*='vendas']:has-text('Vendas'), button:has-text('Vendas')",
    "item_vendedor_analitico": "a[href*='vendedor-analitico'], a:has-text('Vendedor Anal'), [role='menuitem']:has-text('Vendedor Anal'), li:has-text('Vendedor Anal')",
    # tela alvo
    "titulo_rel": "text=Listagem de Vendedor Anal",
    # filtros / grid / export
    "btn_filtros": "[title*='Filtro'], [aria-label*='Filtro'], button:has(i.mdi-filter), button:has(i.fa-filter), button:has-text('Filtros')",
    "pane_filtros": "#filtrosForm",
    "btn_atualizar": "button:has-text('Atualizar Filtros')",
    "grid_row": "table tbody tr",
    "excel_btn": "#dataTableButtons button.buttons-excel, button.buttons-excel",
}

# =============== HELPERS ===============
def rclone_copy_latest(local_file: Path):
    cmd = [
        RCLONE_PATH,
        "copyto",
        str(local_file),
        f"{DRIVE_REMOTE}{DRIVE_FILE_NAME}",
        "--drive-root-folder-id",
        DRIVE_FOLDER_ID,
        "-v",
    ]
    log(f"rclone -> {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.stdout.strip():
        print(res.stdout)
    if res.returncode != 0:
        print(res.stderr, file=sys.stderr)
        raise RuntimeError("Falha ao atualizar o arquivo no Drive.")


def conferir_loja(local_file: Path):
    """Trava de segurança: se APPNEXT_LOJA_DESTINO estiver definido, a planilha precisa ser dessa loja.
    Evita gravar os dados de outra loja quando a troca de loja no AppNext falha."""
    esperado = os.getenv("APPNEXT_LOJA_DESTINO", "").strip()
    if not esperado:
        return
    from openpyxl import load_workbook
    norm = lambda s: re.sub(r"[.\s]+$", "", str(s or "").strip()).upper()
    wb = load_workbook(local_file, read_only=True)
    ws = wb.worksheets[0]
    lojas = {}
    for i, row in enumerate(ws.iter_rows(min_row=3, max_col=1, values_only=True)):
        if row and row[0]:
            lojas[norm(row[0])] = lojas.get(norm(row[0]), 0) + 1
    wb.close()
    if not lojas:
        log("[conferência] planilha sem linhas de venda; nada a conferir")
        return
    certas = lojas.get(norm(esperado), 0)
    total = sum(lojas.values())
    if certas < total:
        raise RuntimeError(
            f"a planilha não é só da loja esperada ({esperado}): {dict(sorted(lojas.items(), key=lambda x: -x[1])[:3])}. "
            "A troca de loja no AppNext provavelmente falhou; o arquivo anterior foi mantido."
        )
    log(f"[conferência] {total} linhas, todas da loja {esperado}")


def gravar_saida_local(local_file: Path):
    """Copia a planilha para SAIDA_ARQUIVO de forma atômica (o painel nunca lê pela metade)."""
    conferir_loja(local_file)
    destino = Path(SAIDA_ARQUIVO)
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_name(destino.name + f".{os.getpid()}.tmp")
    shutil.copyfile(local_file, tmp)
    os.chmod(tmp, 0o640)
    os.replace(tmp, destino)
    log(f"Planilha gravada em {destino} ({destino.stat().st_size // 1024} KB)")


def enviar_para_painel(local_file: Path, tentativas: int = 3):
    """Envia a planilha ao painel na VPS. O arquivo substitui o anterior da loja."""
    url = f"{PAINEL_URL}/api/upload/{PAINEL_LOJA}/{PAINEL_ARQUIVO}"
    dados = local_file.read_bytes()
    log(f"painel -> POST {url} ({len(dados) // 1024} KB)")
    ultimo_erro = None
    for i in range(1, tentativas + 1):
        req = urllib.request.Request(
            url,
            data=dados,
            method="POST",
            headers={
                "Authorization": f"Bearer {PAINEL_TOKEN}",
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "User-Agent": "teashop-export/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                resp = json.loads(r.read().decode("utf-8", "replace") or "{}")
            if resp.get("ok"):
                log(f"painel: recebido ({resp.get('loja')}/{resp.get('arquivo')}, {resp.get('bytes')} bytes)")
                return
            ultimo_erro = f"resposta inesperada: {resp}"
        except urllib.error.HTTPError as e:
            corpo = e.read().decode("utf-8", "replace")[:300]
            ultimo_erro = f"HTTP {e.code}: {corpo}"
            if e.code in (400, 401, 403, 404, 413):
                break  # erro de configuração: não adianta repetir
        except Exception as e:
            ultimo_erro = str(e)
        log(f"  painel: falhou (tentativa {i}/{tentativas}): {ultimo_erro}")
        time.sleep(5 * i)
    raise RuntimeError(f"Falha ao enviar para o painel: {ultimo_erro}")


def _click_first(page, selectors):
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if loc.count():
                loc.scroll_into_view_if_needed(timeout=1500)
                loc.click(timeout=4000, force=True)
                return True
        except Exception:
            pass
    return False


def wait_for_titulo_rel(page, timeout=40000):
    """Aguarda qualquer variação do título do relatório Vendedor Analítico."""
    sels = [
        SEL["titulo_rel"],
        "h1:has-text('Vendedor')",
        "h2:has-text('Vendedor')",
        ".page-title:has-text('Vendedor')",
        "text=Vendedor Anal",
    ]
    deadline = timeout
    for sel in sels:
        try:
            page.wait_for_selector(sel, timeout=deadline)
            return
        except Exception:
            pass
    raise TimeoutError(f"Título de Vendedor Analítico não encontrado após {timeout}ms")


def goto_vendedor_analitico_via_menu(page):
    # --- tentativa 1: navegação direta via URL ---
    base = page.url.split("/#/")[0] if "/#/" in page.url else "https://www.appnext.com.br"
    direct_url = f"{base}/#/loja/vendas/vendedor-analitico"
    try:
        log(f"[nav] tentando URL direta -> {direct_url}")
        page.goto(direct_url, wait_until="load", timeout=60_000)
        try:
            page.wait_for_url("**/loja/vendas/**vendedor**", timeout=15000)
        except PWTimeout:
            pass
        try:
            wait_for_titulo_rel(page, timeout=15000)
            return  # sucesso via URL direta
        except Exception:
            pass
    except Exception as e:
        log(f"[nav] URL direta falhou: {e}")

    # --- tentativa 2: via menu ---
    for sel in [s.strip() for s in SEL["menu_vendas"].split(",")]:
        try:
            loc = page.locator(sel).first
            if loc.count():
                try:
                    loc.hover()
                except Exception:
                    pass
                loc.click(timeout=4000, force=True)
                break
        except Exception:
            continue
    for sel in [s.strip() for s in SEL["item_vendedor_analitico"].split(",")]:
        try:
            it = page.locator(sel).first
            if it.count():
                it.click(timeout=6000, force=True)
                break
        except Exception:
            continue
    # confirma rota/título
    try:
        page.wait_for_url("**/loja/vendas/**vendedor**", timeout=30000)
    except PWTimeout:
        wait_for_titulo_rel(page, timeout=20000)


def open_filters_pane(page):
    # se já estiver aberto, retorna
    try:
        page.wait_for_selector(f"{SEL['pane_filtros']}.show", timeout=1500)
        return
    except Exception:
        pass
    # clica no botão/ícone de filtros
    for sel in [s.strip() for s in SEL["btn_filtros"].split(",")]:
        try:
            loc = page.locator(sel).first
            if loc.count():
                loc.scroll_into_view_if_needed(timeout=1500)
                loc.click(timeout=2000, force=True)
                break
        except Exception:
            continue
    # espera abrir
    try:
        page.wait_for_selector(f"{SEL['pane_filtros']}.show", timeout=4000)
    except Exception:
        # força abrir (caso offcanvas)
        page.evaluate(
            """idSel => { const p=document.querySelector(idSel); if(p){p.classList.add('show'); p.style.display='block';} }""",
            SEL["pane_filtros"],
        )

# --------- CAPTURA DO FILTRO (debug/auxiliar) ----------
class Captured:
    filtro_url = None
    filtro_method = None
    filtro_ct = None
    filtro_body = None
    filtro_headers = None


def _clean_headers(h: dict) -> dict:
    bad = {"content-length", "host", "origin", "referer"}
    return {k: v for k, v in (h or {}).items() if k.lower() not in bad}


def hook_filter_capture(page):
    def on_request(req):
        url = (req.url or "").lower()
        if Captured.filtro_url is None and req.resource_type in ("xhr", "fetch"):
            # request principal do relatório (GET com query)
            is_report_data = ("vendedor" in url and "analit" in url) or "relatoriovendedoranalitico" in url
            if is_report_data:
                hdrs = _clean_headers(req.headers or {})
                body = ""
                try:
                    body = req.post_data or ""
                except Exception:
                    pass
                Captured.filtro_url = req.url
                Captured.filtro_method = (req.method or "GET").upper()
                Captured.filtro_body = body
                Captured.filtro_ct = hdrs.get("content-type", "")
                Captured.filtro_headers = hdrs
                log(f"[capture] filtro de DADOS {Captured.filtro_method} -> {req.url}")

    page.on("request", on_request)

# --------- CAPTURA DO EXPORT (se existir URL direta) ----------
class CapturedExport:
    url = None
    method = None
    headers = None


def hook_export_capture(page):
    def on_request(req):
        url = (req.url or "").lower()
        if req.resource_type in ("xhr", "fetch", "document"):
            if ("excel" in url or "export" in url or "xlsx" in url) and ("vendedor" in url or "analit" in url):
                CapturedExport.url = req.url
                CapturedExport.method = (req.method or "GET").upper()
                CapturedExport.headers = _clean_headers(req.headers or {})
                log(f"[capture] EXPORT {CapturedExport.method} -> {req.url}")

    page.on("request", on_request)

# --------- REPLAY DO EXPORT (se capturado) ---------
def replay_export_with_dates(page, destino_path: Path):
    if not CapturedExport.url:
        raise RuntimeError("URL de exportação não foi capturada. Clique 1x no botão Excel para eu aprender a URL.")
    parsed = urlparse(CapturedExport.url)
    qs = parse_qs(parsed.query)
    qs["dataInicial"] = [FMT_JSON_INI]
    qs["dataFinal"] = [FMT_JSON_FIM]
    target_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}?{urlencode(qs, doseq=True)}"
    log(f"[export-replay] GET -> {target_url}")
    # timeout reduzido de 180s -> 90s
    with page.expect_download(timeout=90_000) as dl:
        page.evaluate(
            """
            (url) => { const a=document.createElement('a'); a.href=url; a.target='_blank';
                       document.body.appendChild(a); a.click(); setTimeout(()=>a.remove(),500); }
            """,
            target_url,
        )
    download = dl.value
    download.save_as(destino_path.as_posix())
    log(f"Arquivo exportado (período aplicado): {destino_path.name}")

# --------- FALLBACK: baixar JSON em janelas mensais ----------
def _janelas_mensais(ini_dt, fim_dt):
    janelas, cur = [], ini_dt
    while cur <= fim_dt:
        if cur.month == 12:
            prox = cur.replace(year=cur.year + 1, month=1, day=1)
        else:
            prox = cur.replace(month=cur.month + 1, day=1)
        fim_janela = min(prox - timedelta(seconds=1), fim_dt)
        janelas.append((cur, fim_janela))
        cur = prox
    return janelas


def fetch_report_json_with_dates(page):
    if not Captured.filtro_url:
        raise RuntimeError("Endpoint de dados não capturado ainda.")
    parsed = urlparse(Captured.filtro_url)
    base_qs = parse_qs(parsed.query)
    if LOJA_ID_DESTINO:
        base_qs["lojaId"] = [LOJA_ID_DESTINO]
    headers = {**_clean_headers(Captured.filtro_headers or {})}

    js_code = """
    async ([url, headers]) => {
        const res = await fetch(url, { method: "GET", headers });
        const text = await res.text();
        return { ok: res.ok, status: res.status, text };
    }
    """

    todos = []
    for jini, jfim in _janelas_mensais(INI_DT, FIM_DT):
        qs = dict(base_qs)
        qs["dataInicial"] = [para_iso_utc_brt(jini, fim=False)]
        qs["dataFinal"]   = [para_iso_utc_brt(jfim, fim=True)]
        pag_key = next((k for k in ("pagina", "page", "pageNumber") if k in qs), None)
        pag_num = 1
        while pag_num <= 50:
            if pag_key:
                qs[pag_key] = [str(pag_num)]
            target_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}?{urlencode(qs, doseq=True)}"
            if pag_num == 1:
                log(f"[dados-replay] {jini:%d/%m/%Y} -> {jfim:%d/%m/%Y}")
            else:
                log(f"[dados-replay] {jini:%d/%m/%Y} -> {jfim:%d/%m/%Y} (página {pag_num})")

            result = None
            for tentativa in range(1, 3):
                result = page.evaluate(js_code, [target_url, headers])
                if result.get("ok"):
                    break
                log(f"  HTTP {result.get('status')} (tentativa {tentativa}/2)")
                page.wait_for_timeout(1000 * tentativa)

            if not result or not result.get("ok"):
                raise RuntimeError(
                    f"Falha na janela {jini:%d/%m} - {jfim:%d/%m}: "
                    f"HTTP {result.get('status') if result else '??'}"
                )

            try:
                parcial = json.loads(result["text"])
            except Exception as e:
                raise RuntimeError(f"JSON inválido na janela {jini:%d/%m}: {e}") from e

            if isinstance(parcial, list):
                todos.extend(parcial)
                break
            elif isinstance(parcial, dict):
                lote = None
                for key in ("items", "itens", "data", "resultado", "rows", "content"):
                    if isinstance(parcial.get(key), list):
                        lote = parcial[key]
                        break
                if lote is None:
                    todos.append(parcial)
                    break
                todos.extend(lote)
                tot_pags = parcial.get("totalPages") or parcial.get("totalPaginas")
                tem_prox = parcial.get("hasNextPage") or (isinstance(tot_pags, int) and pag_num < tot_pags)
                if pag_key and lote and tem_prox:
                    pag_num += 1
                    continue
                break
            else:
                break

    log(f"[dados-replay] total de linhas agregadas: {len(todos)}")
    return todos

# ----------------- GERAÇÃO DO EXCEL (idêntico ao importacaoA.xlsx) -----------------
# Larguras EXATAS extraídas do modelo
COL_WIDTHS = {
    "A": 32.4, "B": 18.9, "C": 13.5, "D": 16.2, "E": 25.65, "F": 18.9,
    "G": 54.0, "H": 40.5, "I": 52.65, "J": 54.0, "K": 13.5, "L": 18.9,
    "M": 22.95, "N": 14.85, "O": 16.2, "P": 9.0,
}

# Layout do arquivo final, na ordem das colunas A..O:
#   (cabeçalho, [campos candidatos vindos da API], tipo, env_fallback)
# tipo: "text" | "num" | "data_br"
# >>> AJUSTE os nomes de campo conforme o log "[debug] colunas do JSON normalizado:".
COLUNAS = [
    ("Loja",                ["loja"],                         "text",    "APPNEXT_LOJA_DESTINO"),
    ("CNPJ",                ["cnpj"],                         "text",    "APPNEXT_LOJA_CNPJ"),
    ("Data",                ["data"],                         "data_br", None),
    ("Número Cupom",        ["numeroCupom"],                  "text",    None),
    # CONFIRMADO pela amostra: valorTotal = valorUnitario * quantidadeItem,
    # logo 'quantidade' = total de itens do cupom (coluna E) e
    # 'quantidadeItem' = qtd da linha (coluna "Quantidade", K).
    ("Qtd. Itens no Cupom", ["quantidade", "quantidadeItem"], "num",     None),
    ("Código Produto",      ["codigo"],                       "text",    None),
    ("Descrição",           ["produto"],                      "text",    None),
    ("Grupo",               ["grupo"],                        "text",    None),
    ("Sub-Grupo",           ["subGrupo"],                     "text",    None),
    ("Categorias",          ["categorias"],                   "text",    None),
    ("Quantidade",          ["quantidadeItem", "quantidade"], "num",     None),
    ("Valor Unitário",      ["valorUnitario"],                "num",     None),
    ("Desconto Unitário",   ["desconto"],                     "num",     None),
    ("Valor Total",         ["valorTotal"],                   "num",     None),
    ("Vendedor",            ["vendedor"],                     "text",    None),
    # Hora do cupom (para o Mapa de Calor). Vem do mesmo campo de data quando a API manda data+hora.
    ("Hora",                ["dataHora", "dataEmissao", "dataVenda", "horaVenda", "hora", "data"], "hora_br", None),
]


def _pick(rec, candidatos):
    """Primeiro campo presente e não vazio (trata NaN do pandas)."""
    for c in candidatos:
        if c in rec:
            v = rec[c]
            if v is None:
                continue
            if isinstance(v, float) and v != v:  # NaN
                continue
            if v == "":
                continue
            return v
    return None


def _num(v):
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return int(v) if float(v).is_integer() else v
    try:
        n = float(str(v).replace(",", "."))
        return int(n) if n.is_integer() else n
    except Exception:
        return v


def _data_br(v):
    """Converte a data da API para a string 'dd/mm/yyyy' (igual ao modelo).
    Se vier ISO com fuso (…Z), converte para horário de Brasília (-03:00)
    antes de extrair o dia, evitando virar o dia por causa do UTC."""
    if v is None or v == "":
        return ""
    s = str(v).strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(_BRT)
        return dt.strftime("%d/%m/%Y")
    except Exception:
        pass
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", s)
    if m:
        return s[:10]
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(3)}/{m.group(2)}/{m.group(1)}"
    return s


def _hora_br(v):
    """'HH:MM' (horário de Brasília) quando o valor traz hora; vazio quando é só data."""
    if v is None or v == "":
        return ""
    s = str(v).strip()
    m = re.match(r"^(\d{1,2}):(\d{2})", s)
    if m:
        return f"{int(m.group(1)):02d}:{m.group(2)}"
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if "T" not in s and " " not in s:
            return ""
        if dt.tzinfo is None and dt.hour == 0 and dt.minute == 0 and dt.second == 0:
            return ""  # data sem fuso à meia-noite = API mandou só a data
        if dt.tzinfo is not None:
            # 00:00:00Z exato sem milissegundos pode ser só data OU venda às 21:00:00 BRT;
            # só descarta quando a própria string termina em T00:00:00Z/T00:00:00.000Z em campos só de data
            dt = dt.astimezone(_BRT)
        if dt.hour == 0 and dt.minute == 0 and dt.second == 0:
            return ""  # meia-noite em Brasília = sem hora real
        return dt.strftime("%H:%M")
    except Exception:
        pass
    m = re.search(r"\d{2}/\d{2}/\d{4}[ ,T]+(\d{1,2}):(\d{2})", s)
    if m:
        return f"{int(m.group(1)):02d}:{m.group(2)}"
    return ""


def _texto(raw):
    if raw is None:
        return ""
    if isinstance(raw, list):
        partes = []
        for x in raw:
            if isinstance(x, dict):
                partes.append(str(x.get("nome") or x.get("descricao") or x))
            else:
                partes.append(str(x))
        return ", ".join(partes)
    return str(raw).strip()


def write_excel_from_json(data, out_path: Path):
    import pandas as pd

    # 1) extrai a lista de linhas
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        rows = None
        for key in ("items", "data", "resultado", "rows", "content"):
            if isinstance(data.get(key), list):
                rows = data[key]
                break
        rows = rows if rows is not None else [data]
    else:
        rows = []

    df = pd.json_normalize(rows)
    log("[debug] colunas do JSON normalizado: " + ", ".join(map(str, df.columns)))
    if len(df):
        amostra = {k: df.iloc[0][k] for k in df.columns}
        log("[debug] 1a linha (amostra): "
            + json.dumps(amostra, ensure_ascii=False, default=str)[:1500])
    registros = df.to_dict("records")

    # 2) monta a planilha do zero, igual ao importacaoA.xlsx
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"

    ts = datetime.now().strftime("%d/%m/%Y, %H:%M:%S")
    ws["A1"] = f"Vendas Por Vendedor - Listagem Vendedor Analítico ( {ts} )"
    ws["A1"].font = Font(name="Calibri", size=11)
    ws.merge_cells("A1:O1")

    hdr_font = Font(name="Calibri", size=11, bold=True)
    hdr_align = Alignment(horizontal="center")
    for j, (header, _c, _t, _f) in enumerate(COLUNAS, start=1):
        c = ws.cell(row=2, column=j, value=header)
        c.font = hdr_font
        c.alignment = hdr_align

    body_font = Font(name="Calibri", size=11)
    preenchidas = set()
    r = 3
    for rec in registros:
        for j, (header, cands, tipo, fb) in enumerate(COLUNAS, start=1):
            raw = _pick(rec, cands)
            if raw is None and fb:
                raw = os.getenv(fb, "") or None
            if tipo == "data_br":
                val = _data_br(raw)
            elif tipo == "hora_br":
                val = _hora_br(raw)
                if not val:
                    raw = None  # não conta como preenchida
            elif tipo == "num":
                val = _num(raw)
            else:
                val = _texto(raw)

            if raw is not None and val not in ("", None):
                preenchidas.add(header)
            cell = ws.cell(row=r, column=j, value=val)
            cell.font = body_font
        r += 1

    for col, w in COL_WIDTHS.items():
        ws.column_dimensions[col].width = w

    if "Hora" not in preenchidas:
        log("[hora] a API não informou a hora dos cupons: o Mapa de Calor fica sem dados. Veja a amostra acima ([debug] 1a linha) para achar o campo de hora.")
    vazias = [h for (h, _c, _t, _f) in COLUNAS if h not in preenchidas and h != "Hora"]
    if vazias:
        log("[mapeamento] colunas SEM origem na API (saíram VAZIAS em TODAS as linhas, ajustar COLUNAS): "
            + ", ".join(vazias))

    wb.save(out_path.as_posix())
    log(f"Arquivo salvo no layout do modelo: {out_path.name} ({len(registros)} linhas de dados)")

# -------------- TROCAR LOJA --------------
def _sem_acento(t):
    import unicodedata
    t = unicodedata.normalize("NFD", str(t or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", t).strip().rstrip(".").upper()


def loja_atual(page):
    """texto da loja que aparece no topo do AppNext (botão com 'TEA SHOP'), ou None"""
    for sel in ["button:has-text('TEA SHOP') >> visible=true", "[data-bs-toggle='dropdown']:has-text('TEA SHOP') >> visible=true",
                ".dropdown-toggle:has-text('TEA SHOP') >> visible=true"]:
        try:
            loc = page.locator(sel).first
            if loc.count():
                return loc.inner_text(timeout=3000).strip()
        except Exception:
            pass
    return None


def _confere(texto, alvo):
    """Confere o nome no topo: só aceita prefixo quando o próprio topo veio cortado com '...' / '…'."""
    bruto = str(texto or "").strip()
    truncado = "..." in bruto or "…" in bruto
    pedaco = bruto.replace("…", "...").split("...")[0].strip() if truncado else bruto
    t = _sem_acento(pedaco)
    a = _sem_acento(alvo)
    if not t or not a:
        return False
    if t == a:
        return True
    return truncado and len(t) >= 18 and a.startswith(t)


def trocar_loja(page, loja_nome=None):
    """
    Troca a loja pelo menu do topo e CONFERE se a troca valeu (lendo o nome no topo).
    Se não conseguir confirmar depois de 3 tentativas, para com erro: nunca baixa dados de outra loja.
    """
    alvo = (loja_nome or os.getenv("APPNEXT_LOJA_DESTINO") or "").strip()
    if not alvo:
        # sem "Loja no AppNext" cadastrada: usa a loja que o usuário do AppNext já abre (contas de uma loja só)
        step("2) Loja no AppNext")
        log(f"Sem loja de destino cadastrada no painel: seguindo na loja que abriu ({loja_atual(page) or '?'}). "
            "Cadastre a 'Loja no AppNext' em Configurações para o coletor conferir a loja.")
        return True
    alvo_n = _sem_acento(alvo)
    step(f"2) Trocando loja → {alvo}")
    atual = loja_atual(page)
    # só pula o clique se o texto completo bater sem estar cortado com reticências
    if atual and "..." not in atual and "…" not in atual and _sem_acento(atual) == alvo_n:
        log(f"Já está na loja certa: {atual}")
        return True
    for tentativa in range(1, 4):
        try:
            opened = _click_first(
                page,
                [
                    "button:has-text('TEA SHOP') >> visible=true",
                    "[data-bs-toggle='dropdown']:has-text('TEA SHOP') >> visible=true",
                    ".dropdown-toggle:has-text('TEA SHOP') >> visible=true",
                    "[data-bs-toggle='dropdown']",
                    ".dropdown-toggle",
                ],
            )
            if not opened:
                raise RuntimeError("não achei o seletor de loja no topo")
            page.wait_for_timeout(1000)
            # procura na tela qualquer elemento visível cujo texto (sem acento e sem ponto final) seja a loja;
            # o menu do AppNext não usa sempre a mesma marcação, então marca o alvo e clica nele
            r = page.evaluate(r"""(alvo) => {
                const sem = (t) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.$/, '').toUpperCase();
                const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
                const nomes = new Set(); let achou = null;
                for (const el of document.querySelectorAll('body *')) {
                    if (!vis(el) || el.closest('button[aria-expanded], .dropdown-toggle') === el) continue;
                    const t = sem(el.innerText);
                    if (!t || t.length > 80 || !/TEA SHOP/.test(t)) continue;
                    if ([...el.children].some((c) => sem(c.innerText) === t)) continue; // fica com o mais interno
                    nomes.add(t);
                    if (t === alvo && !achou) achou = el;
                }
                document.querySelectorAll('[data-ts-alvo]').forEach((e) => e.removeAttribute('data-ts-alvo'));
                if (achou) achou.setAttribute('data-ts-alvo', '1');
                return { achou: !!achou, nomes: [...nomes].slice(0, 15) };
            }""", alvo_n)
            if not r["achou"]:
                raise RuntimeError(f"a opção '{alvo}' não apareceu na tela (lojas visíveis: {', '.join(r['nomes']) or 'nenhuma'})")
            page.locator("[data-ts-alvo='1']").first.click(timeout=6000, force=True)
            try:
                page.wait_for_load_state("networkidle", timeout=12000)
            except Exception:
                pass
            for _ in range(10):
                atual = loja_atual(page)
                if atual and _confere(atual, alvo):
                    log(f"Loja selecionada e conferida: {atual}")
                    return True
                page.wait_for_timeout(1000)
            raise RuntimeError(f"depois do clique o topo mostra '{atual or '?'}'")
        except Exception as e:
            log(f"Troca de loja, tentativa {tentativa}: {str(e).splitlines()[0][:300]}")
            try:
                page.keyboard.press("Escape")
            except Exception:
                pass
            page.wait_for_timeout(1500)
    raise RuntimeError(f"Não consegui trocar para a loja {alvo} no AppNext (o topo mostra '{loja_atual(page) or '?'}'). "
                       "Parei para não baixar dados de outra loja.")


def garantir_loja(page, loja_nome=None):
    """Reconfere o cabeçalho da loja antes de exportar e refaz a troca se necessário."""
    alvo = (loja_nome or os.getenv("APPNEXT_LOJA_DESTINO") or "").strip()
    if not alvo:
        return True
    atual = loja_atual(page)
    if atual and _confere(atual, alvo):
        return True
    log(f"[conferência] topo mostra '{atual or '?'}' em vez de '{alvo}'; refazendo troca de loja…")
    return trocar_loja(page, alvo)


# -------- Navegação resiliente: goto com retries --------
def preencher_login(page):
    """Preenche e envia o login do AppNext (se a página for a de login).
    O formulário às vezes demora (ou o site está instável): espera até 60 s, recarrega uma vez e, se o campo "Rede"
    ainda não aparece, grava no log um diagnóstico sem nenhum valor digitado (endereço, título, campos e botões)."""
    if "/#/login" not in page.url:
        return
    for tentativa in (1, 2):
        try:
            page.wait_for_selector(SEL["rede"], state="visible", timeout=60_000)
            break
        except Exception:  # noqa: BLE001
            if "/#/login" not in page.url:
                return  # a sessão voltou sozinha (já está logado)
            if tentativa == 1:
                log("[login] o formulário de login não apareceu em 60 s; recarregando a página uma vez")
                try:
                    page.reload(wait_until="load", timeout=60_000)
                except Exception as e:  # noqa: BLE001
                    log(f"[login] falhou ao recarregar: {e}")
                continue
            try:
                diag = page.evaluate("""() => ({
                    titulo: document.title,
                    campos: [...document.querySelectorAll('input')].filter((i) => i.offsetParent).map((i) => (i.placeholder || i.name || i.type || '').slice(0, 40)),
                    botoes: [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => (b.innerText || '').trim().slice(0, 40)).filter(Boolean).slice(0, 10),
                    texto: (document.body && document.body.innerText || '').trim().slice(0, 200),
                })""")
            except Exception as e:  # noqa: BLE001
                diag = {"erro": str(e)[:200]}
            log(f"[login] diagnóstico da tela de login: endereço {page.url.split('?')[0]} · {diag}")
            raise RuntimeError("A tela de login do AppNext não mostrou o campo \"Rede\" (o site pode estar fora do ar, lento ou ter mudado o login).")
    page.fill(SEL["rede"], REDE)
    page.fill(SEL["email"], USER)
    page.fill(SEL["senha"], PASS)
    page.click(SEL["entrar"])


def goto_login_with_retries(page, url, tries=3):
    alt_urls = {url, url.replace("https://www.", "https://")}
    for i in range(1, tries + 1):
        for target in alt_urls:
            try:
                log(f"[goto] tentativa {i}/{tries} -> {target}")
                page.goto(target, wait_until="load", timeout=60_000)
                return
            except Exception as e:
                log(f"[goto] falhou em {target}: {e}")
        page.wait_for_timeout(i * 3000)
    page.goto(url, wait_until="load", timeout=60_000)


def coletar_vendas_na_pagina(page, saida_arquivo=None):
    """Executa a coleta de Vendedor Analítico aproveitando uma página já autenticada na loja certa."""
    global SAIDA_ARQUIVO, GRAVAR_LOCAL
    if saida_arquivo is not None:
        SAIDA_ARQUIVO = str(saida_arquivo).strip()
        GRAVAR_LOCAL = bool(SAIDA_ARQUIVO)
    Captured.filtro_url = None
    CapturedExport.url = None
    hook_filter_capture(page)
    hook_export_capture(page)
    garantir_loja(page)

    step("3) Menu: Vendas → Vendedor Analítico")
    goto_vendedor_analitico_via_menu(page)
    wait_for_titulo_rel(page, timeout=40000)
    log("Tela confirmada.")
    garantir_loja(page)

    step("4) Abrindo filtros")
    open_filters_pane(page)
    try:
        page.locator(SEL["btn_atualizar"]).first.click(timeout=3000)
    except Exception:
        pass
    try:
        page.wait_for_selector(SEL["grid_row"], timeout=30000)
    except Exception:
        log("[grid] nenhuma linha visível no período inicial da tela; seguindo para exportação/API.")

    step("5) Exportar Excel (tentar capturar URL)")
    captured_export_ok = False
    local_out = Path.cwd() / f"export_nextsoft_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    try:
        with page.expect_download(timeout=90_000) as dl_tmp:
            page.locator(SEL["excel_btn"]).first.click()
        tmp_download = dl_tmp.value
        tmp_path = Path.cwd() / f"_tmp_export_{TS}.xlsx"
        tmp_download.save_as(tmp_path.as_posix())
        log("Export padrão baixado (pode ser blob:/POST). Tentando reaproveitar URL capturada...")

        if CapturedExport.url:
            step(f"5b) Reemitindo export com período {FMT_BR_INI} → {FMT_BR_FIM}")
            replay_export_with_dates(page, local_out)
            captured_export_ok = True
        else:
            log("Não consegui capturar URL direta do Excel (provável blob:). Usarei fallback via API.")

        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
    except Exception as e:
        log(f"Aviso: falha ao acionar o botão Excel ou capturar URL: {e}. Vou usar fallback via API.")

    if not captured_export_ok:
        step(f"5c) Fallback: baixando dados da API {FMT_BR_INI} → {FMT_BR_FIM} e gerando Excel")
        data = fetch_report_json_with_dates(page)
        write_excel_from_json(data, local_out)

    erros_envio = []
    if GRAVAR_LOCAL:
        step("6) Gravando a planilha na pasta da loja")
        try:
            gravar_saida_local(local_out)
        except Exception as e:
            log(f"ERRO ao gravar: {e}")
            erros_envio.append("pasta local")
    if ENVIAR_DRIVE:
        step("6) Enviando para Google Drive")
        try:
            rclone_copy_latest(local_out)
            log("Upload no Drive concluído.")
        except Exception as e:
            log(f"ERRO no Drive: {e}")
            erros_envio.append("Drive")
    if ENVIAR_PAINEL:
        step(f"7) Enviando para o painel ({PAINEL_LOJA})")
        try:
            enviar_para_painel(local_out)
        except Exception as e:
            log(f"ERRO no painel: {e}")
            erros_envio.append("painel")
    if GRAVAR_LOCAL:
        try:
            local_out.unlink(missing_ok=True)
        except Exception:
            pass
    if erros_envio:
        raise RuntimeError("Falha no envio para: " + ", ".join(erros_envio))


# ================ MAIN =================
def main():
    start_watchdog(MAX_RUNTIME_SECONDS)
    ok = False
    pasta_pw = Path.cwd() / "pw_state"
    limpar_locks_perfil(pasta_pw)

    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            user_data_dir=str(pasta_pw),
            headless=True,
            accept_downloads=True,
            ignore_https_errors=INSEGURO,
            viewport={"width": 1600, "height": 950},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.set_default_timeout(30_000)
        page.set_default_navigation_timeout(60_000)

        page.on("console", lambda m: log(f"[console] {m.type}: {m.text}"))
        page.on("pageerror", lambda e: log(f"[pageerror] {e}"))
        page.on("requestfailed", lambda r: log(f"[requestfailed] {r.url} -> {r.failure}"))

        try:
            step("1) Login")
            goto_login_with_retries(page, LOGIN_URL)

            preencher_login(page)

            page.wait_for_url("**/#/loja/**", timeout=120_000)
            try:
                page.wait_for_load_state("networkidle", timeout=15_000)
            except Exception:
                pass

            trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            coletar_vendas_na_pagina(page, SAIDA_ARQUIVO)
            ok = True

        except Exception:
            log("### ERRO DURANTE O FLUXO ###")
            print(traceback.format_exc())
        finally:
            try:
                context.close()
            except Exception:
                pass

    step("FINALIZADO")
    if GRAVAR_LOCAL:
        log(f"Saída: {SAIDA_ARQUIVO}")
    if ENVIAR_DRIVE:
        log(f"Drive: {DRIVE_FILE_NAME}  (pasta ID {DRIVE_FOLDER_ID})")
    if ENVIAR_PAINEL:
        log(f"Painel: {PAINEL_URL}  (loja {PAINEL_LOJA}, arquivo {PAINEL_ARQUIVO}.xlsx)")

    if not ok:
        log("### Finalizando com erro (exit 1) ###")
        sys.exit(1)


if __name__ == "__main__":
    main()
