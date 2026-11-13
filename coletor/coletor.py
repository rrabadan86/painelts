"""
Coletor Tea Shop — roda o script de exportação do AppNext de cada loja na própria VPS.

- Cada loja tem um arquivo /config/<loja>.env com as credenciais do AppNext (veja exemplo.env.modelo).
- Roda sozinho nos horários de COLETOR_HORARIOS (padrão 13:30 e 23:00, horário de Brasília),
  uma loja por vez.
- O painel aciona e acompanha pela API interna (só acessível dentro do docker compose):
    GET  /status/<loja>   → estado da loja
    POST /rodar/<loja>    → coloca a loja na fila
  Ambas exigem o cabeçalho X-Coletor-Token.
    POST /historico/<loja> → importa um período longo em partes ({"partes":[{"de":"2024-01-01","ate":"2024-03-31"},...]})
    POST /cancelar/<loja>  → tira da fila as partes que ainda não rodaram
- Cada execução grava /data/<loja>/entrada/<carimbo>_<de>_<ate>_<gatilho>.xlsx; o painel junta no histórico
  mês a mês (substitui só aquele período).
- A rotina baixa só os últimos dias (padrão 7; /config/janela.txt, editado pelo painel, ou COLETOR_JANELA).
  Do dia 1 ao 5 de cada mês ela refaz também o mês anterior inteiro (fechamento de comissão e faturamento).
  O botão do painel (atualização manual) baixa só ontem e hoje: é a atualização imediata.
- Depois das vendas, baixa também os XMLs das notas do mesmo período (Fiscal → Gerar XML) e grava
  /data/<loja>/entrada/<carimbo>_<de>_<ate>_xml.json com o CPF de cada cupom (COLETOR_XML=0 desliga).
  No histórico dá para escolher "tipo": "vendas", "xml" ou "ambos".
- Horários: /config/horarios.txt (editado pelo painel) ou COLETOR_HORARIOS.
"""
import hmac
import json
import os

os.umask(0o027)  # arquivos novos (vendas, XMLs com CPF) sem leitura para outros usuários da VPS
import re
import subprocess
import sys
import threading
import time
from collections import deque
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

CONFIG_DIR = Path(os.getenv("COLETOR_CONFIG", "/config"))
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
WORK_DIR = Path(os.getenv("COLETOR_WORK", "/work"))
SCRIPT = Path(os.getenv("COLETOR_SCRIPT", Path(__file__).with_name("nextsoft_export_to_drive.py")))
SCRIPT_XML = Path(os.getenv("COLETOR_SCRIPT_XML", Path(__file__).with_name("nextsoft_xml.py")))
SCRIPT_ESTOQUE = Path(os.getenv("COLETOR_SCRIPT_ESTOQUE", Path(__file__).with_name("nextsoft_estoque.py")))
SCRIPT_FIXE = Path(os.getenv("COLETOR_SCRIPT_FIXE", Path(__file__).with_name("fixe_export.py")))
# Sistema de Pedidos da franqueadora: catálogo (toda noite) e montar o carrinho (pelo painel)
SCRIPT_PEDIDO = Path(os.getenv("COLETOR_SCRIPT_PEDIDO", Path(__file__).with_name("nextsoft_pedido.py")))
# estoque atual e custos junto da rotina e do botão do painel: 1 = sim
ESTOQUE_ROTINA = (os.getenv("COLETOR_ESTOQUE") or "1") != "0"
# XML das notas (CPF dos clientes) junto da rotina: 1 = sim
XML_ROTINA = (os.getenv("COLETOR_XML") or "1") != "0"
TIPOS = ("ambos", "vendas", "xml")
TOKEN = os.getenv("COLETOR_TOKEN", "")
# variável vazia (o docker-compose repassa só as do coletor; as que não existem no .env chegam vazias) = padrão
HORARIOS_ENV = [h.strip() for h in (os.getenv("COLETOR_HORARIOS") or "13:30,23:00").split(",") if h.strip()]
JANELA_ENV = int(os.getenv("COLETOR_JANELA") or "7")
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def janela():
    """dias baixados em cada atualização automática: /config/janela.txt (editado pelo painel) ou COLETOR_JANELA"""
    try:
        n = int((CONFIG_DIR / "janela.txt").read_text(encoding="utf-8").strip())
        if 1 <= n <= 90:
            return n
    except (OSError, ValueError):
        pass
    return JANELA_ENV


def horarios():
    f = CONFIG_DIR / "horarios.txt"
    try:
        hs = [h.strip() for h in f.read_text(encoding="utf-8").replace("\n", ",").split(",") if HHMM.match(h.strip())]
        if hs:
            return sorted(set(hs))
    except OSError:
        pass
    return HORARIOS_ENV
TZ = ZoneInfo(os.getenv("TZ", "America/Sao_Paulo"))
TEMPO_MAX = int(os.getenv("COLETOR_TEMPO_MAX") or "900")  # segundos por loja
PORTA = int(os.getenv("COLETOR_PORTA") or "8000")
ID_OK = re.compile(r"^[a-z0-9_-]{1,40}$")

fila = deque()
lock = threading.Lock()
estado = {}  # loja -> dict
pedido_est = {}  # loja -> {"estado", "acao", "criado", "inicio", "fim", "ok", "codigo", "log"} (Sistema de Pedidos)
DATA_OK = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def log(msg):
    print(f"[{datetime.now(TZ):%d/%m %H:%M:%S}] {msg}", flush=True)


def ler_env(path: Path) -> dict:
    env = {}
    for linha in path.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        k, v = linha.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        env[k.strip()] = v
    return env


def lojas_configuradas():
    if not CONFIG_DIR.exists():
        return []
    return sorted(p.stem for p in CONFIG_DIR.glob("*.env") if ID_OK.match(p.stem))


def info_loja(loja):
    with lock:
        return json.loads(json.dumps(_estado(loja)))


RE_RUIDO = re.compile(r"^\s*(=+|Traceback|File \"|\s{2,}\S|-\s|locator|waiting for|navigated to|\[pid=)")


def ao_vivo(loja):
    """últimas linhas úteis do log da coleta em andamento + quando o log mexeu pela última vez"""
    f = WORK_DIR / loja / "ultimo.log"
    try:
        st = f.stat()
        with open(f, "rb") as fh:
            fh.seek(max(0, st.st_size - 20000))
            linhas = fh.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return None
    uteis, etapa, script = [], None, None
    for l in linhas:
        t = l.strip()
        if not t or RE_RUIDO.match(l) or re.fullmatch(r"\[[\d:]+\]\s*=+", t):
            continue
        if t.startswith("### ") and t.endswith(" ###") and t[4:-4].endswith(".py"):
            script = t[4:-4]
        m = re.match(r"^\[[\d:]+\]\s*(\d+\)\s.*)$", t)
        if m:
            etapa = m.group(1)
        if not uteis or uteis[-1] != t:
            uteis.append(t)
    nomes = {"nextsoft_export_to_drive.py": "vendas", "nextsoft_xml.py": "XML das notas", "nextsoft_estoque.py": "estoque"}
    return {"linhas": uteis[-12:], "etapa": etapa, "parte": nomes.get(script, script),
            "atividade": datetime.fromtimestamp(st.st_mtime, TZ).isoformat()}


def _estado(loja):
    return estado.setdefault(loja, {"estado": "parado", "ultima": None, "atual": None, "lote": None})


def pendentes(loja):
    return sum(1 for j in fila if j["loja"] == loja and j.get("gatilho") != "pedido")


ITENS = ("vendas", "xml", "estoque", "fixe")


def enfileirar(loja, gatilho, por=None, de=None, ate=None, fixe=False, tipo=None, itens=None):
    """Rotina/manual: recusa se a loja já tem algo na fila ou rodando.
    fixe=True: pede também a exportação do cadastro de clientes ao FIXE (coleta da noite)."""
    with lock:
        e = _estado(loja)
        if e["estado"] in ("na_fila", "rodando") or pendentes(loja):
            return False
        job = {"loja": loja, "gatilho": gatilho, "por": por, "de": de, "ate": ate, "criado": datetime.now(TZ).isoformat(), "inicio": None, "fixe": fixe}
        if tipo:
            job["tipo"] = tipo
        if itens:
            job["itens"] = list(itens)  # "Rodar agora" com o que foi marcado
        e["estado"] = "na_fila"
        e["atual"] = job
        fila.append(job)
    log(f"{loja}: na fila ({gatilho}{' por ' + por if por else ''})")
    return True


def acesso_pedido(loja):
    """login do Sistema de Pedidos: o salvo pelo painel (Configurações → Lojas) ou, se não houver, o do arquivo da loja"""
    out = {}
    try:
        env = ler_env(CONFIG_DIR / f"{loja}.env")
        out = {k: env[k] for k in ("PEDIDO_USER", "PEDIDO_PASS", "PEDIDO_URL") if env.get(k)}
    except OSError:
        pass
    try:
        a = json.loads((DATA_DIR / "_sistema" / "acesso-pedido" / f"{loja}.json").read_text(encoding="utf-8"))
        if a.get("usuario") and a.get("senha"):
            out["PEDIDO_USER"], out["PEDIDO_PASS"] = a["usuario"], a["senha"]
    except (OSError, ValueError):
        pass
    return out


def tem_pedido(loja):
    a = acesso_pedido(loja)
    return bool(a.get("PEDIDO_USER") and a.get("PEDIDO_PASS") and SCRIPT_PEDIDO.exists())


def enfileirar_pedido(loja, acao, por=None, somar=False):
    """catálogo ou carrinho no Sistema de Pedidos: vai para a mesma fila (um navegador por vez),
    mas tem estado próprio e não mexe no da coleta"""
    with lock:
        p = pedido_est.get(loja) or {}
        if p.get("estado") in ("na_fila", "rodando"):
            return False
        job = {"loja": loja, "gatilho": "pedido", "acao": acao, "por": por, "somar": bool(somar), "criado": datetime.now(TZ).isoformat()}
        pedido_est[loja] = {**{k: v for k, v in p.items() if k == "ultima"}, "estado": "na_fila", "acao": acao, "por": por, "criado": job["criado"]}
        fila.append(job)
    log(f"{loja}: pedido/{acao} na fila{' por ' + por if por else ''}")
    return True


def rodar_pedido(job):
    loja, acao = job["loja"], job["acao"]
    pasta = WORK_DIR / loja
    pasta.mkdir(parents=True, exist_ok=True)
    SEGREDO = re.compile(r"(SECRET|TOKEN|PASS|SENHA|SMTP|GITHUB|KEY)", re.I)
    env = {k: v for k, v in os.environ.items() if not k.startswith("COLETOR_") and not SEGREDO.search(k)}
    env.update(ler_env(CONFIG_DIR / f"{loja}.env"))
    env.update(acesso_pedido(loja))
    destino = DATA_DIR / loja / "pedido"
    env.update({"MODO": acao, "PYTHONUNBUFFERED": "1", "SAIDA_CATALOGO": str(destino / "catalogo.json"),
                "ENTRADA_PEDIDO": str(destino / "entrada.json"), "SAIDA_RESULTADO": str(destino / "carrinho.json"),
                "CARRINHO_SOMAR": "1" if job.get("somar") else "0"})
    env.setdefault("MAX_RUNTIME_SECONDS", "900")
    log_path = pasta / "pedido.log"
    inicio = time.time()
    with lock:
        pedido_est[loja] = {**pedido_est.get(loja, {}), "estado": "rodando", "inicio": datetime.now(TZ).isoformat()}
    log(f"{loja}: pedido/{acao} rodando")
    try:
        with open(log_path, "w", encoding="utf-8") as out:
            p = subprocess.run([sys.executable, str(SCRIPT_PEDIDO)], cwd=pasta, env=env, stdout=out, stderr=subprocess.STDOUT, timeout=TEMPO_MAX)
            codigo = p.returncode
    except subprocess.TimeoutExpired:
        codigo = "timeout"
    except Exception as e:  # noqa: BLE001
        codigo = str(e)
    try:
        cauda = log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-25:]
    except OSError:
        cauda = []
    with lock:
        p = pedido_est.get(loja, {})
        ultima = {"acao": acao, "por": job.get("por"), "criado": job["criado"], "inicio": p.get("inicio"), "fim": datetime.now(TZ).isoformat(),
                  "ok": codigo == 0, "codigo": codigo, "duracao_s": round(time.time() - inicio), "log": cauda}
        pedido_est[loja] = {"estado": "parado", "ultima": ultima}
    try:
        (pasta / "pedido.json").write_text(json.dumps(ultima, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    log(f"{loja}: pedido/{acao} {'OK' if codigo == 0 else 'FALHOU (' + str(codigo) + ')'}")


def enfileirar_historico(loja, partes, por=None, tipo="ambos"):
    with lock:
        e = _estado(loja)
        if e["estado"] in ("na_fila", "rodando") or pendentes(loja):
            return False
        agora = datetime.now(TZ).isoformat()
        jobs = [{"loja": loja, "gatilho": "historico", "tipo": tipo, "por": por, "de": p["de"], "ate": p["ate"], "criado": agora, "inicio": None} for p in partes]
        e["lote"] = {"total": len(jobs), "feitas": 0, "falhas": [], "de": partes[0]["de"], "ate": partes[-1]["ate"], "por": por, "criado": agora, "fim": None, "tipo": tipo}
        e["estado"] = "na_fila"
        e["atual"] = jobs[0]
        fila.extend(jobs)
    log(f"{loja}: histórico em {len(partes)} parte(s) {partes[0]['de']} → {partes[-1]['ate']}")
    return True


def cancelar(loja):
    with lock:
        antes = len(fila)
        resto = [j for j in fila if j["loja"] != loja or j.get("gatilho") == "pedido"]
        fila.clear()
        fila.extend(resto)
        e = _estado(loja)
        if e["estado"] == "na_fila":
            e["estado"], e["atual"] = "parado", None
        if e.get("lote") and not e["lote"].get("fim"):
            e["lote"]["fim"] = datetime.now(TZ).isoformat()
            e["lote"]["cancelado"] = True
    return antes - len(fila)


def br(iso):
    return f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}"


def rodar(job):
    loja = job["loja"]
    cfg = CONFIG_DIR / f"{loja}.env"
    pasta = WORK_DIR / loja
    pasta.mkdir(parents=True, exist_ok=True)
    # scripts recebem só o ambiente do sistema + as credenciais da própria loja (nada de segredos do painel)
    SEGREDO = re.compile(r"(SECRET|TOKEN|PASS|SENHA|SMTP|GITHUB|KEY)", re.I)
    env = {k: v for k, v in os.environ.items() if not k.startswith("COLETOR_") and not SEGREDO.search(k)}
    env.update(ler_env(cfg))
    # período: histórico = o pedido; rotina = últimos dias da janela.
    # Do dia 1 ao 5 a rotina também refaz o mês anterior inteiro (correções do fechamento: comissão e faturamento).
    hoje = datetime.now(TZ).date()
    if job.get("de") and job.get("ate"):
        de, ate = job["de"], job["ate"]
    else:
        if job.get("gatilho") == "manual":
            # botão do painel: atualização imediata, só ontem e hoje
            ini = hoje - timedelta(days=1)
        else:
            ini = hoje - timedelta(days=janela())
            if hoje.day <= 5:
                ini = min(ini, (hoje.replace(day=1) - timedelta(days=1)).replace(day=1))
        de, ate = ini.isoformat(), hoje.isoformat()
    env.pop("DIAS_JANELA", None)
    env["DATA_INICIO"], env["DATA_FIM"] = br(de), br(ate)
    carimbo = datetime.now(TZ).strftime("%Y%m%d-%H%M%S")
    # destino: fila de entrada do painel; Drive/painel por HTTP ficam desligados
    env["SAIDA_ARQUIVO"] = str(DATA_DIR / loja / "entrada" / f"{carimbo}_{de}_{ate}_{job['gatilho']}.xlsx")
    env["DRIVE_FOLDER_ID"] = ""  # na VPS não envia para o Drive
    env["PAINEL_URL"] = ""
    env.setdefault("MAX_RUNTIME_SECONDS", "600")
    env["PYTHONUNBUFFERED"] = "1"
    script = CONFIG_DIR / f"{loja}.py"  # script próprio da loja, se existir
    script = script if script.exists() else SCRIPT
    log_path = pasta / "ultimo.log"
    inicio = time.time()
    with lock:
        e = _estado(loja)
        e["estado"] = "rodando"
        job["inicio"] = datetime.now(TZ).isoformat()
        e["atual"] = job
    tipo = job.get("tipo") or ("ambos" if XML_ROTINA else "vendas")
    if tipo not in TIPOS and tipo != "fixe":
        tipo = "vendas"
    itens = job.get("itens")
    if itens:  # escolha do "Rodar agora": cada parte só se marcada
        quer = set(itens)
        tipo = "ambos" if {"vendas", "xml"} <= quer else "vendas" if "vendas" in quer else "xml" if "xml" in quer else "nada"
        if "fixe" in quer:
            job["fixe"] = True
    else:
        quer = None
    log(f"{loja}: rodando {tipo} ({de} a {ate})")
    log_path.write_text(f"### período {br(de)} a {br(ate)} ({job['gatilho']}, {tipo}) ###\n", encoding="utf-8")

    trechos = []  # final do log de cada script (o do XML não esconde o das vendas)

    def executar(arquivo, env_extra):
        """roda um script e devolve o código de saída (ou 'timeout'/erro)"""
        inicio_log = log_path.stat().st_size
        try:
            return _executar(arquivo, env_extra)
        finally:
            with open(log_path, "rb") as f:
                f.seek(inicio_log)
                linhas = f.read().decode("utf-8", "replace").splitlines()
            # tira as linhas repetidas do Playwright ("locator resolved to ...")
            enxutas = []
            for l in linhas:
                if enxutas and l.strip() == enxutas[-1].strip():
                    continue
                enxutas.append(l)
            trechos.append(enxutas[-15:])

    def _executar(arquivo, env_extra):
        try:
            with open(log_path, "a", encoding="utf-8") as out:
                out.write(f"\n### {arquivo.name} ###\n")
                out.flush()
                p = subprocess.run([sys.executable, str(arquivo)], cwd=pasta, env={**env, **env_extra}, stdout=out, stderr=subprocess.STDOUT, timeout=TEMPO_MAX)
                return p.returncode
        except subprocess.TimeoutExpired:
            with open(log_path, "a", encoding="utf-8") as out:
                out.write(f"\n### coletor: tempo máximo de {TEMPO_MAX}s excedido ###\n")
            return "timeout"
        except Exception as e:  # noqa: BLE001
            return str(e)

    ok, codigo, xml = True, 0, None
    principal = None  # o resultado da coleta é o do primeiro script que rodou
    if tipo in ("ambos", "vendas"):
        codigo = executar(script, {})
        ok = codigo == 0
        principal = "vendas"
    if tipo in ("ambos", "xml") and SCRIPT_XML.exists():
        saida_xml = str(DATA_DIR / loja / "entrada" / f"{carimbo}_{de}_{ate}_xml.json")
        cx = executar(SCRIPT_XML, {"SAIDA_XML": saida_xml, "SAIDA_ARQUIVO": str(pasta / "_nao_usado.xlsx")})
        xml = {"ok": cx == 0, "codigo": cx}
        if principal is None:
            ok, codigo, principal = cx == 0, cx, "xml"
    estoque = None
    fixe = None
    if (job.get("fixe") or tipo == "fixe") and SCRIPT_FIXE.exists():
        # cadastro de clientes: só pede a exportação; o painel lê o e-mail do FIXE e importa
        cf = executar(SCRIPT_FIXE, {"SAIDA_FIXE": str(DATA_DIR / loja / "fixe" / "pedido.json")})
        fixe = {"ok": cf == 0, "codigo": cf}
        if principal is None:
            ok, codigo, principal = cf == 0, cf, "fixe"
    quer_estoque = ("estoque" in quer) if quer is not None else (tipo != "fixe" and job["gatilho"] != "historico" and ESTOQUE_ROTINA)
    if quer_estoque and SCRIPT_ESTOQUE.exists():
        # o estoque é uma foto de agora: só nas atualizações (não no histórico); falha aqui não derruba a coleta
        saida_est = str(DATA_DIR / loja / "estoque" / "entrada" / f"{carimbo}_estoque.xlsx")
        ce = executar(SCRIPT_ESTOQUE, {"SAIDA_ESTOQUE": saida_est, "SAIDA_ARQUIVO": str(pasta / "_nao_usado.xlsx")})
        estoque = {"ok": ce == 0, "codigo": ce}
        if principal is None:
            ok, codigo, principal = ce == 0, ce, "estoque"
    cauda = [l for t in trechos for l in t] or (log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-25:] if log_path.exists() else [])
    with lock:
        e = _estado(loja)
        e["ultima"] = {**job, "tipo": tipo, "xml": xml, "estoque": estoque, "fixe": fixe, "fim": datetime.now(TZ).isoformat(), "ok": ok, "codigo": codigo,
                       "duracao_s": round(time.time() - inicio), "log": cauda}
        lote = e.get("lote")
        if job["gatilho"] == "historico" and lote and not lote.get("fim"):
            lote["feitas"] += 1
            if not ok:
                lote["falhas"].append({"de": de, "ate": ate, "codigo": str(codigo), "log": cauda[-30:]})
            if lote["feitas"] >= lote["total"]:
                lote["fim"] = datetime.now(TZ).isoformat()
        prox = next((j for j in fila if j["loja"] == loja and j.get("gatilho") != "pedido"), None)
        e["atual"] = prox
        e["estado"] = "na_fila" if prox else "parado"
    (pasta / "ultima.json").write_text(json.dumps({"ultima": e["ultima"], "lote": e.get("lote")}, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"{loja}: {'OK' if ok else 'FALHOU'} em {round(time.time() - inicio)}s (código {codigo}{'' if xml is None else ', xml ' + ('ok' if xml['ok'] else 'falhou')})")


def trabalhador():
    while True:
        job = None
        with lock:
            if fila:
                job = fila.popleft()
        if job:
            try:
                if job.get("gatilho") == "pedido":
                    rodar_pedido(job)
                else:
                    rodar(job)
            except Exception as e:  # noqa: BLE001
                log(f"{job['loja']}: erro inesperado {e}")
                with lock:
                    if job.get("gatilho") == "pedido":
                        pedido_est[job["loja"]] = {**pedido_est.get(job["loja"], {}), "estado": "parado"}
                    else:
                        _estado(job["loja"])["estado"] = "parado"
        else:
            time.sleep(2)


def agendador():
    feitos = set()
    while True:
        agora = datetime.now(TZ)
        hhmm = agora.strftime("%H:%M")
        chave = agora.strftime("%Y-%m-%d ") + hhmm
        hs = horarios()
        if hhmm in hs and chave not in feitos:
            feitos.add(chave)
            noite = hhmm == max(hs)  # a última do dia também pede o cadastro de clientes ao FIXE
            for loja in lojas_configuradas():
                enfileirar(loja, "agendado", fixe=noite)
                if noite and tem_pedido(loja):
                    enfileirar_pedido(loja, "catalogo", "rotina")
        time.sleep(20)


def carregar_ultimas():
    for loja in lojas_configuradas():
        fp = WORK_DIR / loja / "pedido.json"
        if fp.exists():
            try:
                pedido_est[loja] = {"estado": "parado", "ultima": json.loads(fp.read_text(encoding="utf-8"))}
            except Exception:  # noqa: BLE001
                pass
        f = WORK_DIR / loja / "ultima.json"
        if f.exists():
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
                if "ultima" not in d:  # formato antigo
                    d = {"ultima": d, "lote": None}
                estado[loja] = {"estado": "parado", "atual": None, "ultima": d["ultima"], "lote": d.get("lote")}
            except Exception:  # noqa: BLE001
                pass


class API(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _autorizado(self):
        dado = self.headers.get("X-Coletor-Token", "")
        return bool(TOKEN) and hmac.compare_digest(dado.encode(), TOKEN.encode())

    def _loja(self, prefixo):
        loja = self.path[len(prefixo):].split("?")[0].strip("/").lower()
        return loja if ID_OK.match(loja) else None

    def do_GET(self):  # noqa: N802
        if self.path == "/saude":
            return self._json(200, {"ok": True, "lojas": lojas_configuradas(), "horarios": horarios(), "janela": janela()})
        if not self._autorizado():
            return self._json(401, {"erro": "token"})
        if self.path.startswith("/status/"):
            loja = self._loja("/status/")
            if not loja or loja not in lojas_configuradas():
                return self._json(200, {"configurada": False})
            with lock:
                fila_n = pendentes(loja)
            info = info_loja(loja)
            if info.get("estado") == "rodando":
                info["ao_vivo"] = ao_vivo(loja)
            env = ler_env(CONFIG_DIR / f"{loja}.env")
            tem_fixe = bool(env.get("FIXE_URL") and env.get("FIXE_PASS") and SCRIPT_FIXE.exists())
            with lock:
                ped = json.loads(json.dumps(pedido_est.get(loja) or {}))
            return self._json(200, {"configurada": True, "horarios": horarios(), "janela": janela(), "fila": fila_n, "temFixe": tem_fixe,
                                    "temPedido": tem_pedido(loja), "pedido": ped, **info})
        self._json(404, {"erro": "rota"})

    def do_POST(self):  # noqa: N802
        if not self._autorizado():
            return self._json(401, {"erro": "token"})
        por = self.headers.get("X-Coletor-Por", "")[:40] or None
        if self.path.startswith("/rodar/"):
            loja = self._loja("/rodar/")
            if not loja or loja not in lojas_configuradas():
                return self._json(404, {"erro": "Loja sem acesso ao AppNext configurado."})
            itens = None
            try:
                n = int(self.headers.get("Content-Length", "0") or 0)
                corpo = json.loads(self.rfile.read(min(n, 10000)) or b"{}") if n else {}
                if corpo.get("itens") is not None:
                    itens = [i for i in corpo["itens"] if i in ITENS]
                    if not itens:
                        return self._json(400, {"erro": "Marque pelo menos um item para buscar."})
            except Exception:  # noqa: BLE001
                return self._json(400, {"erro": "pedido inválido"})
            if not enfileirar(loja, "manual", por, itens=itens):
                return self._json(409, {"erro": "O script desta loja já está na fila ou rodando.", **info_loja(loja)})
            return self._json(200, {"ok": True})
        if self.path.startswith("/pedido/"):
            loja = self._loja("/pedido/")
            if not loja or loja not in lojas_configuradas():
                return self._json(404, {"erro": "Loja sem acesso configurado."})
            if not tem_pedido(loja):
                return self._json(400, {"erro": "Falta o login do Sistema de Pedidos: Configurações → Lojas → Sistema de Pedidos."})
            try:
                n = int(self.headers.get("Content-Length", "0") or 0)
                corpo = json.loads(self.rfile.read(min(n, 10000)) or b"{}") if n else {}
            except Exception:  # noqa: BLE001
                return self._json(400, {"erro": "pedido inválido"})
            acao = corpo.get("acao")
            if acao not in ("catalogo", "carrinho"):
                return self._json(400, {"erro": "ação inválida"})
            if acao == "carrinho" and not (DATA_DIR / loja / "pedido" / "entrada.json").exists():
                return self._json(400, {"erro": "Sem a lista de produtos para o carrinho."})
            if not enfileirar_pedido(loja, acao, por, bool(corpo.get("somar"))):
                return self._json(409, {"erro": "Já há uma tarefa do Sistema de Pedidos na fila ou rodando para esta loja."})
            return self._json(200, {"ok": True})
        if self.path.startswith("/fixe/"):
            loja = self._loja("/fixe/")
            if not loja or loja not in lojas_configuradas():
                return self._json(404, {"erro": "Loja sem acesso configurado."})
            if not enfileirar(loja, "manual", por, tipo="fixe"):
                return self._json(409, {"erro": "Esta loja já tem uma coleta na fila ou rodando."})
            return self._json(200, {"ok": True})
        if self.path.startswith("/historico/"):
            loja = self._loja("/historico/")
            if not loja or loja not in lojas_configuradas():
                return self._json(404, {"erro": "Loja sem acesso ao AppNext configurado."})
            try:
                n = int(self.headers.get("Content-Length", "0") or 0)
                corpo = json.loads(self.rfile.read(min(n, 100000)) or b"{}")
                partes = [{"de": p["de"], "ate": p["ate"]} for p in corpo.get("partes", [])]
                tipo = corpo.get("tipo") or "ambos"
            except Exception:  # noqa: BLE001
                return self._json(400, {"erro": "pedido inválido"})
            if tipo not in TIPOS:
                return self._json(400, {"erro": "tipo inválido"})
            if not partes or len(partes) > 120 or not all(DATA_OK.match(p["de"]) and DATA_OK.match(p["ate"]) and p["de"] <= p["ate"] for p in partes):
                return self._json(400, {"erro": "períodos inválidos"})
            if not enfileirar_historico(loja, partes, por, tipo):
                return self._json(409, {"erro": "Esta loja já tem uma coleta na fila ou rodando."})
            return self._json(200, {"ok": True, "partes": len(partes)})
        if self.path.startswith("/cancelar/"):
            loja = self._loja("/cancelar/")
            if not loja:
                return self._json(400, {"erro": "loja"})
            return self._json(200, {"ok": True, "removidas": cancelar(loja)})
        self._json(404, {"erro": "rota"})

    def log_message(self, *a):  # silencia o log de cada requisição
        pass


def main():
    if not TOKEN:
        log("ERRO: defina COLETOR_TOKEN no .env")
        sys.exit(1)
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    carregar_ultimas()
    log(f"Coletor pronto. Lojas: {', '.join(lojas_configuradas()) or 'nenhuma'} · horários: {', '.join(horarios())} · janela {janela()} dias")
    threading.Thread(target=trabalhador, daemon=True).start()
    threading.Thread(target=agendador, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", PORTA), API).serve_forever()


if __name__ == "__main__":
    main()
