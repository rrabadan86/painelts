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
import shutil
import signal
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
SCRIPT_SESSAO = Path(os.getenv("COLETOR_SCRIPT_SESSAO", Path(__file__).with_name("nextsoft_sessao.py")))
SCRIPT_XML = Path(os.getenv("COLETOR_SCRIPT_XML", Path(__file__).with_name("nextsoft_xml.py")))
SCRIPT_ESTOQUE = Path(os.getenv("COLETOR_SCRIPT_ESTOQUE", Path(__file__).with_name("nextsoft_estoque.py")))
# notas de entrada (compras): histórico de custo desde a primeira compra; roda junto do estoque
SCRIPT_COMPRAS = Path(os.getenv("COLETOR_SCRIPT_COMPRAS", Path(__file__).with_name("nextsoft_compras.py")))
# fechamentos de caixa (Fechamentos de PDV): vão no e-mail do fechamento do dia; rodam junto das vendas
SCRIPT_CAIXA = Path(os.getenv("COLETOR_SCRIPT_CAIXA", Path(__file__).with_name("nextsoft_caixa.py")))
# preço de tabela do cadastro (Produtos e Produtos Compostos): junto do estoque, no máximo uma vez a cada 20 horas
SCRIPT_PRODUTOS = Path(os.getenv("COLETOR_SCRIPT_PRODUTOS", Path(__file__).with_name("nextsoft_produtos.py")))
SCRIPT_FIXE = Path(os.getenv("COLETOR_SCRIPT_FIXE", Path(__file__).with_name("fixe_export.py")))
# Extrato de estoque do AppNext (só leitura): diagnóstico da tela + movimentos desde uma data, para reconstruir o estoque do
# começo de cada mês (CMV pelo estoque, EXTRATO-01). Roda sozinho, pedido pelo painel.
SCRIPT_EXTRATO = Path(os.getenv("COLETOR_SCRIPT_EXTRATO", Path(__file__).with_name("nextsoft_extrato.py")))
# saldo oficial de pontos de cada cliente (só pelo botão "Sincronizar saldos com o FIXE")
SCRIPT_NFE = Path(os.getenv("COLETOR_SCRIPT_NFE", Path(__file__).with_name("nextsoft_nfe.py")))
SCRIPT_INVENTARIO = Path(os.getenv("COLETOR_SCRIPT_INVENTARIO", Path(__file__).with_name("nextsoft_inventario.py")))
# só lê o histórico de inventários do AppNext (Auditoria/Inventário), todo dia às HORA_INVHIST
SCRIPT_INVHIST = Path(os.getenv("COLETOR_SCRIPT_INVHIST", Path(__file__).with_name("nextsoft_invhist.py")))
HORA_INVHIST = os.getenv("COLETOR_HORA_INVHIST", "02:00")
SCRIPT_SALDOS = Path(os.getenv("COLETOR_SCRIPT_SALDOS", Path(__file__).with_name("fixe_saldos.py")))
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
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d\Z")


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
    """horários padrão (lista única, formato antigo): /config/horarios.txt ou COLETOR_HORARIOS"""
    f = CONFIG_DIR / "horarios.txt"
    try:
        hs = [h.strip() for h in f.read_text(encoding="utf-8").replace("\n", ",").split(",") if HHMM.match(h.strip())]
        if hs:
            return sorted(set(hs))
    except OSError:
        pass
    return HORARIOS_ENV


def agenda():
    """/config/horarios.json (editado pelo painel): {"padrao": {"0".."6": [HH:MM]}, "lojas": {loja: {"0".."6": [...]}}}
    0 = domingo … 6 = sábado. Dia ausente no padrão = horarios(); loja sem agenda própria = padrão."""
    try:
        j = json.loads((CONFIG_DIR / "horarios.json").read_text(encoding="utf-8"))
        return j if isinstance(j, dict) else {}
    except (OSError, ValueError):
        return {}


def _limpa(hs):
    return sorted({h.strip() for h in (hs or []) if isinstance(h, str) and HHMM.match(h.strip())})


def horarios_do_dia(loja=None, quando=None):
    """horários de atualização de um dia (da loja, se ela tem agenda própria; senão os da rede)"""
    quando = quando or datetime.now(TZ)
    dia = str((quando.weekday() + 1) % 7)  # 0 = domingo
    ag = agenda()
    propria = (ag.get("lojas") or {}).get(loja) if loja else None
    if isinstance(propria, dict) and dia in propria:
        return _limpa(propria[dia])
    padrao = ag.get("padrao") or {}
    if dia in padrao:
        return _limpa(padrao[dia])
    return horarios()
TZ = ZoneInfo(os.getenv("TZ", "America/Sao_Paulo"))
TEMPO_MAX = int(os.getenv("COLETOR_TEMPO_MAX") or "900")  # segundos por loja
PORTA = int(os.getenv("COLETOR_PORTA") or "8000")
ID_OK = re.compile(r"^[a-z0-9_-]{1,40}\Z")

fila = deque()       # manual, agendado, saldos, pedido (sempre têm prioridade sobre lotes de histórico)
fila_hist = deque()  # partes de importação longa de histórico
lock = threading.Lock()
cond_loja = threading.Condition(lock)
lojas_appnext = {}   # loja -> {"gatilho": ..., "inicio": ...} enquanto algum robô usa a conta AppNext da loja
sem_pdf = threading.Semaphore(2)
estado = {}  # loja -> dict
inv_est = {}  # loja -> {"estado", "id", "tipo", "por", "ultima"} (importar inventário no AppNext)
saldos_est = {}  # loja -> {"estado", "por", "criado", "inicio", "ultima"} (sincronizar saldos de pontos com o FIXE)
pedido_est = {}  # loja -> {"estado", "acao", "criado", "inicio", "fim", "ok", "codigo", "log"} (Sistema de Pedidos)
DATA_OK = re.compile(r"^\d{4}-\d{2}-\d{2}\Z")


def log(msg):
    print(f"[{datetime.now(TZ):%d/%m %H:%M:%S}] {msg}", flush=True)


def rodar_processo(cmd, cwd, env, out, timeout):
    """Executa subprocesso em grupo próprio e mata toda a árvore (incluindo Chromium filho) em caso de timeout."""
    p = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        return p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            p.wait(timeout=5)
        except Exception:  # noqa: BLE001
            pass
        raise


def adquirir_loja_appnext(loja, gatilho, timeout=1200, ao_esperar=None):
    """Garante que apenas 1 navegador acesse a conta AppNext da mesma loja por vez."""
    fim = time.time() + timeout
    with cond_loja:
        while loja in lojas_appnext:
            restante = fim - time.time()
            if restante <= 0:
                return False
            if ao_esperar:
                ao_esperar(dict(lojas_appnext[loja]))
            cond_loja.wait(timeout=min(3.0, restante))
        lojas_appnext[loja] = {"loja": loja, "gatilho": gatilho, "inicio": datetime.now(TZ).isoformat()}
        return True


def liberar_loja_appnext(loja):
    with cond_loja:
        lojas_appnext.pop(loja, None)
        cond_loja.notify_all()


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
    nomes = {"nextsoft_extrato.py": "extrato de estoque", "nextsoft_export_to_drive.py": "vendas", "nextsoft_xml.py": "XML das notas", "nextsoft_estoque.py": "estoque", "nextsoft_compras.py": "notas de compra", "nextsoft_caixa.py": "fechamento de caixa", "nextsoft_produtos.py": "preço de tabela (produtos)"}
    return {"linhas": uteis[-12:], "etapa": etapa, "parte": nomes.get(script, script),
            "atividade": datetime.fromtimestamp(st.st_mtime, TZ).isoformat()}


def _estado(loja):
    return estado.setdefault(loja, {"estado": "parado", "ultima": None, "atual": None, "lote": None})


def _prox_coleta_loja(loja):
    for q in (fila, fila_hist):
        for j in q:
            if j["loja"] == loja and j.get("gatilho") not in ("pedido", "saldos", "inventario"):
                return j
    return None


def pendentes(loja):
    return (
        sum(1 for j in fila if j["loja"] == loja and j.get("gatilho") not in ("pedido", "saldos", "inventario"))
        + sum(1 for j in fila_hist if j["loja"] == loja)
    )


ITENS = ("vendas", "xml", "estoque", "fixe")


def enfileirar(loja, gatilho, por=None, de=None, ate=None, fixe=False, tipo=None, itens=None, ultima_do_dia=False, data_ref=None):
    """Rotina/manual: recusa se a loja já tem algo na fila ou rodando.
    fixe=True: pede também a exportação do cadastro de clientes ao FIXE (coleta da noite)."""
    hoje_str = data_ref or datetime.now(TZ).strftime("%Y-%m-%d")
    with lock:
        e = _estado(loja)
        if e["estado"] in ("na_fila", "rodando") or pendentes(loja):
            atual_g = (e.get("atual") or {}).get("gatilho")
            if gatilho == "agendado":
                # Se a loja está ocupada com lote de histórico (ou coleta manual parcial), guarda a rotina agendada
                # para rodar logo após o item em andamento, sem perder a atualização nem a data planejada.
                if atual_g == "historico" or (e.get("atual") or {}).get("tipo") in ("fixe", "xml"):
                    ant = e.get("agendado_pendente") or {}
                    e["agendado_pendente"] = {
                        "fixe": bool(ant.get("fixe") or fixe),
                        "ultima_do_dia": bool(ant.get("ultima_do_dia") or ultima_do_dia),
                        "data_ref": hoje_str,
                    }
                    log(f"{loja}: rotina agendada guardada para rodar após {atual_g or 'coleta atual'}")
                    return False
            if ultima_do_dia:
                # a loja já está atualizando vendas completas: a coleta em andamento passa a valer como a última do dia
                e["marcar_ultima_do_dia"] = hoje_str
            return False
        job = {"loja": loja, "gatilho": gatilho, "por": por, "de": de, "ate": ate, "criado": datetime.now(TZ).isoformat(), "inicio": None, "fixe": fixe}
        if data_ref:
            job["data_ref"] = data_ref
        if ultima_do_dia:
            job["ultimaDoDia"] = hoje_str  # o painel envia o fechamento do dia quando esta terminar
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


def enfileirar_saldos(loja, por=None):
    """saldos de pontos do FIXE: fila própria (espera a coleta em andamento, sem mexer no estado dela)"""
    with lock:
        p = saldos_est.get(loja) or {}
        if p.get("estado") in ("na_fila", "rodando"):
            return False
        job = {"loja": loja, "gatilho": "saldos", "por": por, "criado": datetime.now(TZ).isoformat()}
        saldos_est[loja] = {**{k: v for k, v in p.items() if k == "ultima"}, "estado": "na_fila", "por": por, "criado": job["criado"]}
        fila.appendleft(job)  # é rápido (1 a 2 min): passa na frente das partes do histórico, logo depois do que está rodando
    log(f"{loja}: saldos do FIXE na fila{' por ' + por if por else ''}")
    return True


CID_OK = re.compile(r"^[a-f0-9]{12}\Z")


def arquivos_inventario(loja, cid, tipo):
    base = DATA_DIR / loja / "inventario" / "envio"
    return base / f"{cid}-{tipo}.xlsx", base / f"{cid}-{tipo}.json", base / f"{cid}-{tipo}.resultado.json"


fila_inv = deque()  # robô exclusivo do inventário/NF-e: não espera as coletas das outras lojas


def trabalhador_inventario():
    while True:
        with lock:
            job = fila_inv.popleft() if fila_inv else None
        if not job:
            time.sleep(1)
            continue
        loja = job["loja"]
        eh_nfe = job.get("gatilho") == "nfe"
        eh_hist = job.get("gatilho") == "invhist"
        est_alvo = nfe_est if eh_nfe else invhist_est if eh_hist else inv_est

        def marcar_espera(ocup):
            est_alvo[loja] = {**est_alvo.get(loja, {}), "estado": "na_fila", "esperando": ocup}

        adquiriu = adquirir_loja_appnext(loja, job.get("gatilho") or "inventario", timeout=20 * 60, ao_esperar=marcar_espera)
        try:
            if not adquiriu:
                raise RuntimeError("tempo esgotado aguardando a coleta desta loja liberar o AppNext")
            if eh_nfe:
                rodar_nfe(job)
            elif eh_hist:
                rodar_invhist(job)
            else:
                rodar_inventario(job)
        except Exception as e:  # noqa: BLE001
            log(f"{loja}: {job.get('gatilho')} erro inesperado {e}")
            with lock:
                est_alvo[loja] = {**{k: v for k, v in est_alvo.get(loja, {}).items() if k != "esperando"}, "estado": "parado"}
        finally:
            if adquiriu:
                liberar_loja_appnext(loja)


# ---------- NF-e de saída (rascunho no AppNext): mesma fila exclusiva do inventário ----------
nfe_est = {}  # loja -> {"estado", "id", "acao", "ultima"}
RID_OK = re.compile(r"^([a-f0-9]{12}|cadastros)\Z")


def arquivos_nfe(loja, rid):
    base = DATA_DIR / loja / "nfe" / "envio"
    return base / f"{rid}.json", base / f"{rid}.resultado.json"


def enfileirar_nfe(loja, rid, acao, por=None):
    with lock:
        p = nfe_est.get(loja) or {}
        if p.get("estado") in ("na_fila", "rodando"):
            return False
        job = {"loja": loja, "gatilho": "nfe", "rid": rid, "acao": acao, "por": por, "criado": datetime.now(TZ).isoformat()}
        nfe_est[loja] = {**{k: v for k, v in p.items() if k == "ultima"}, "estado": "na_fila", "id": rid, "acao": acao, "por": por, "criado": job["criado"]}
        fila_inv.append(job)
    log(f"{loja}: NF-e ({acao}) na fila{' por ' + por if por else ''}")
    return True


def rodar_nfe(job):
    loja, rid, acao = job["loja"], job["rid"], job["acao"]
    pasta = WORK_DIR / loja
    robo = pasta / "nfe-robo"  # navegador próprio
    robo.mkdir(parents=True, exist_ok=True)
    entrada, resultado = arquivos_nfe(loja, rid)
    SEGREDO = re.compile(r"(SECRET|TOKEN|PASS|SENHA|SMTP|GITHUB|KEY)", re.I)
    env = {k: v for k, v in os.environ.items() if not k.startswith("COLETOR_") and not SEGREDO.search(k)}
    env.update(ler_env(CONFIG_DIR / f"{loja}.env"))
    env.update({"PYTHONUNBUFFERED": "1", "ACAO": acao, "ENTRADA_NFE": str(entrada), "SAIDA_RESULTADO": str(resultado)})
    log_path = pasta / "nfe.log"
    inicio = time.time()
    with lock:
        nfe_est[loja] = {**{k: v for k, v in nfe_est.get(loja, {}).items() if k != "esperando"}, "estado": "rodando", "inicio": datetime.now(TZ).isoformat()}
    log(f"{loja}: NF-e ({acao}) rodando")
    try:
        with open(log_path, "w", encoding="utf-8") as out:
            codigo = rodar_processo([sys.executable, str(SCRIPT_NFE)], cwd=robo, env=env, out=out, timeout=900)
    except subprocess.TimeoutExpired:
        codigo = "timeout"
    except Exception as e:  # noqa: BLE001
        codigo = str(e)
    try:
        cauda = [l for l in log_path.read_text(encoding="utf-8", errors="replace").splitlines() if l.strip() and not set(l.split("] ", 1)[-1]) <= {"="}][-80:]
    except OSError:
        cauda = []
    with lock:
        p = nfe_est.get(loja, {})
        ultima = {"id": rid, "acao": acao, "por": job.get("por"), "criado": job["criado"], "inicio": p.get("inicio"), "fim": datetime.now(TZ).isoformat(),
                  "ok": codigo == 0, "codigo": codigo, "duracao_s": round(time.time() - inicio), "log": cauda}
        nfe_est[loja] = {"estado": "parado", "ultima": ultima}
    try:
        (pasta / "nfe.json").write_text(json.dumps(ultima, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    log(f"{loja}: NF-e ({acao}) {'OK' if codigo == 0 else 'FALHOU (' + str(codigo) + ')'}")


def info_nfe(loja):
    with lock:
        st = json.loads(json.dumps(nfe_est.get(loja) or {}))
    if st.get("estado") == "rodando":
        try:
            st["aoVivo"] = [l for l in (WORK_DIR / loja / "nfe.log").read_text(encoding="utf-8", errors="replace").splitlines() if l.strip() and not set(l.split("] ", 1)[-1]) <= {"="}][-60:]
        except OSError:
            pass
    return st


def enfileirar_inventario(loja, cid, tipo, por=None):
    """inventário no AppNext (só por pedido de alguém no painel): fila própria, na frente das partes do histórico"""
    with lock:
        p = inv_est.get(loja) or {}
        if p.get("estado") in ("na_fila", "rodando"):
            return False
        job = {"loja": loja, "gatilho": "inventario", "cid": cid, "tipo": tipo, "por": por, "criado": datetime.now(TZ).isoformat()}
        inv_est[loja] = {**{k: v for k, v in p.items() if k == "ultima"}, "estado": "na_fila", "id": cid, "tipo": tipo, "por": por, "criado": job["criado"]}
        fila_inv.append(job)
    log(f"{loja}: inventário ({tipo}) na fila{' por ' + por if por else ''}")
    return True


def rodar_inventario(job):
    loja, cid, tipo = job["loja"], job["cid"], job["tipo"]
    pasta = WORK_DIR / loja
    robo = pasta / "inventario-robo"  # navegador próprio: não disputa o perfil com a coleta
    robo.mkdir(parents=True, exist_ok=True)
    xlsx, esperado, resultado = arquivos_inventario(loja, cid, tipo)
    SEGREDO = re.compile(r"(SECRET|TOKEN|PASS|SENHA|SMTP|GITHUB|KEY)", re.I)
    env = {k: v for k, v in os.environ.items() if not k.startswith("COLETOR_") and not SEGREDO.search(k)}
    env.update(ler_env(CONFIG_DIR / f"{loja}.env"))
    env.update({"PYTHONUNBUFFERED": "1", "ENTRADA_INVENTARIO": str(xlsx), "ESPERADO_INVENTARIO": str(esperado), "SAIDA_RESULTADO": str(resultado)})
    log_path = pasta / "inventario.log"
    inicio = time.time()
    with lock:
        inv_est[loja] = {**{k: v for k, v in inv_est.get(loja, {}).items() if k != "esperando"}, "estado": "rodando", "inicio": datetime.now(TZ).isoformat()}
    log(f"{loja}: inventário ({tipo}) rodando")
    try:
        with open(log_path, "w", encoding="utf-8") as out:
            codigo = rodar_processo([sys.executable, str(SCRIPT_INVENTARIO)], cwd=robo, env=env, out=out, timeout=900)
    except subprocess.TimeoutExpired:
        codigo = "timeout"
    except Exception as e:  # noqa: BLE001
        codigo = str(e)
    try:
        cauda = [l for l in log_path.read_text(encoding="utf-8", errors="replace").splitlines() if l.strip() and not set(l.split("] ", 1)[-1]) <= {"="}][-80:]
    except OSError:
        cauda = []
    with lock:
        p = inv_est.get(loja, {})
        ultima = {"id": cid, "tipo": tipo, "por": job.get("por"), "criado": job["criado"], "inicio": p.get("inicio"), "fim": datetime.now(TZ).isoformat(),
                  "ok": codigo == 0, "codigo": codigo, "duracao_s": round(time.time() - inicio), "log": cauda}
        inv_est[loja] = {"estado": "parado", "ultima": ultima}
    try:
        (pasta / "inventario.json").write_text(json.dumps(ultima, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    log(f"{loja}: inventário ({tipo}) {'OK' if codigo == 0 else 'FALHOU (' + str(codigo) + ')'}")


# ---------- histórico de inventários do AppNext (só leitura), todo dia de madrugada ----------
invhist_est = {}  # loja -> {"estado", "ultima"}


def enfileirar_invhist(loja):
    with lock:
        if (invhist_est.get(loja) or {}).get("estado") in ("na_fila", "rodando"):
            return False
        invhist_est[loja] = {**invhist_est.get(loja, {}), "estado": "na_fila"}
        fila_inv.append({"loja": loja, "gatilho": "invhist", "criado": datetime.now(TZ).isoformat()})
    log(f"{loja}: histórico de inventários do AppNext na fila")
    return True


def rodar_invhist(job):
    loja = job["loja"]
    pasta = WORK_DIR / loja
    robo = pasta / "inventario-robo"  # mesmo navegador do inventário (a fila é a mesma: nunca rodam juntos)
    robo.mkdir(parents=True, exist_ok=True)
    SEGREDO = re.compile(r"(SECRET|TOKEN|PASS|SENHA|SMTP|GITHUB|KEY)", re.I)
    env = {k: v for k, v in os.environ.items() if not k.startswith("COLETOR_") and not SEGREDO.search(k)}
    env.update(ler_env(CONFIG_DIR / f"{loja}.env"))
    env.update({"PYTHONUNBUFFERED": "1", "SAIDA_HISTORICO": str(DATA_DIR / loja / "inventario" / "appnext-historico.json")})
    log_path = pasta / "invhist.log"
    inicio = time.time()
    with lock:
        invhist_est[loja] = {"estado": "rodando", "inicio": datetime.now(TZ).isoformat()}
    try:
        with open(log_path, "w", encoding="utf-8") as out:
            codigo = rodar_processo([sys.executable, str(SCRIPT_INVHIST)], cwd=robo, env=env, out=out, timeout=1800)
    except subprocess.TimeoutExpired:
        codigo = "timeout"
    except Exception as e:  # noqa: BLE001
        codigo = str(e)
    with lock:
        invhist_est[loja] = {"estado": "parado", "ultima": {"fim": datetime.now(TZ).isoformat(), "ok": codigo == 0, "codigo": codigo, "duracao_s": round(time.time() - inicio)}}
    log(f"{loja}: histórico de inventários {'OK' if codigo == 0 else 'FALHOU (' + str(codigo) + ')'}")


def robo_agora(loja):
    """o que o robô está fazendo agora e quantos pedidos esperam na frente (sem expor outras lojas)"""
    with lock:
        t = dict(trabalho)
        n = len(fila) + len(fila_hist)
    # fila parada: tem pedido esperando, ninguém rodando e o laço não dá volta há mais de 1 min
    parado = bool(n) and not t and time.time() - batida_trab > 60
    if not t:
        return {"livre": True, "fila": n, "parado": parado}
    return {"livre": False, "fila": n, "inicio": t.get("inicio"), "gatilho": t.get("gatilho"), "outraLoja": t.get("loja") != loja}


def info_inventario(loja):
    with lock:
        st = json.loads(json.dumps(inv_est.get(loja) or {}))
    if st.get("estado") == "rodando":
        try:
            st["aoVivo"] = [l for l in (WORK_DIR / loja / "inventario.log").read_text(encoding="utf-8", errors="replace").splitlines() if l.strip() and not set(l.split("] ", 1)[-1]) <= {"="}][-60:]
        except OSError:
            pass
    return st


def rodar_saldos(job):
    loja = job["loja"]
    pasta = WORK_DIR / loja
    pasta.mkdir(parents=True, exist_ok=True)
    SEGREDO = re.compile(r"(SECRET|TOKEN|PASS|SENHA|SMTP|GITHUB|KEY)", re.I)
    env = {k: v for k, v in os.environ.items() if not k.startswith("COLETOR_") and not SEGREDO.search(k)}
    env.update(ler_env(CONFIG_DIR / f"{loja}.env"))
    env.update({"PYTHONUNBUFFERED": "1", "SAIDA_SALDOS": str(DATA_DIR / loja / "fixe" / "saldos.json")})
    log_path = pasta / "saldos.log"
    inicio = time.time()
    with lock:
        saldos_est[loja] = {**saldos_est.get(loja, {}), "estado": "rodando", "inicio": datetime.now(TZ).isoformat()}
    log(f"{loja}: saldos do FIXE rodando")
    try:
        with open(log_path, "w", encoding="utf-8") as out:
            codigo = rodar_processo([sys.executable, str(SCRIPT_SALDOS)], cwd=pasta, env=env, out=out, timeout=900)
    except subprocess.TimeoutExpired:
        codigo = "timeout"
    except Exception as e:  # noqa: BLE001
        codigo = str(e)
    try:
        cauda = log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-25:]
    except OSError:
        cauda = []
    with lock:
        p = saldos_est.get(loja, {})
        ultima = {"por": job.get("por"), "criado": job["criado"], "inicio": p.get("inicio"), "fim": datetime.now(TZ).isoformat(),
                  "ok": codigo == 0, "codigo": codigo, "duracao_s": round(time.time() - inicio), "log": cauda}
        saldos_est[loja] = {"estado": "parado", "ultima": ultima}
    try:
        (pasta / "saldos.json").write_text(json.dumps(ultima, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    log(f"{loja}: saldos do FIXE {'OK' if codigo == 0 else 'FALHOU (' + str(codigo) + ')'}")


def info_saldos(loja):
    """estado da sincronização de saldos; enquanto roda, as últimas linhas do log"""
    with lock:
        st = json.loads(json.dumps(saldos_est.get(loja) or {}))
    if st.get("estado") == "rodando":
        try:
            st["aoVivo"] = (WORK_DIR / loja / "saldos.log").read_text(encoding="utf-8", errors="replace").splitlines()[-8:]
        except OSError:
            pass
    return st


URL_PEDIDO_PADRAO = "https://grnteashop.nextsoft.com.br/pedidos"
CACHE_CATALOGO_TTL = 12 * 3600  # 12h: o catálogo FRANQUIAS é único da franqueadora


def rodar_pedido(job):
    loja, acao = job["loja"], job["acao"]
    pasta = WORK_DIR / loja
    pasta.mkdir(parents=True, exist_ok=True)
    SEGREDO = re.compile(r"(SECRET|TOKEN|PASS|SENHA|SMTP|GITHUB|KEY)", re.I)
    env = {k: v for k, v in os.environ.items() if not k.startswith("COLETOR_") and not SEGREDO.search(k)}
    env.update(ler_env(CONFIG_DIR / f"{loja}.env"))
    env.update(acesso_pedido(loja))
    destino = DATA_DIR / loja / "pedido"
    arq_cat = destino / "catalogo.json"
    env.update({"MODO": acao, "PYTHONUNBUFFERED": "1", "SAIDA_CATALOGO": str(arq_cat),
                "ENTRADA_PEDIDO": str(destino / "entrada.json"), "SAIDA_RESULTADO": str(destino / "carrinho.json"),
                "CARRINHO_SOMAR": "1" if job.get("somar") else "0"})
    env.setdefault("MAX_RUNTIME_SECONDS", "900")
    url_norm = (env.get("PEDIDO_URL") or URL_PEDIDO_PADRAO).strip().rstrip("/").lower()
    forn_slug = re.sub(r"[^a-z0-9]+", "_", (env.get("PEDIDO_FORNECEDOR") or "franquias").strip().lower()).strip("_") or "franquias"
    cache_rede = DATA_DIR / "_sistema" / f"catalogo-{forn_slug}.json" if url_norm == URL_PEDIDO_PADRAO else None
    log_path = pasta / "pedido.log"
    inicio = time.time()
    with lock:
        pedido_est[loja] = {**pedido_est.get(loja, {}), "estado": "rodando", "inicio": datetime.now(TZ).isoformat()}

    # Na rotina da noite, reaproveita o catálogo já consultado por outra loja nas últimas 12 horas
    if acao == "catalogo" and job.get("por") == "rotina" and cache_rede and cache_rede.exists():
        try:
            idade = time.time() - cache_rede.stat().st_mtime
            if 0 <= idade < CACHE_CATALOGO_TTL and cache_rede.stat().st_size > 100:
                destino.mkdir(parents=True, exist_ok=True)
                tmp = arq_cat.with_name(f"{arq_cat.name}.{os.getpid()}.tmp")
                shutil.copyfile(cache_rede, tmp)
                os.chmod(tmp, 0o640)
                tmp.replace(arq_cat)
                msg = f"[{datetime.now(TZ):%H:%M:%S}] Catálogo reaproveitado do cache da rede ({int(idade // 60)} min atrás)."
                log_path.write_text(msg + "\n", encoding="utf-8")
                with lock:
                    p = pedido_est.get(loja, {})
                    ultima = {"acao": acao, "por": job.get("por"), "criado": job["criado"], "inicio": p.get("inicio"), "fim": datetime.now(TZ).isoformat(),
                              "ok": True, "codigo": 0, "duracao_s": 0, "log": [msg]}
                    pedido_est[loja] = {"estado": "parado", "ultima": ultima}
                try:
                    (pasta / "pedido.json").write_text(json.dumps(ultima, ensure_ascii=False), encoding="utf-8")
                except OSError:
                    pass
                log(f"{loja}: pedido/catalogo OK (cache da rede)")
                return
        except OSError:
            pass

    log(f"{loja}: pedido/{acao} rodando")
    try:
        with open(log_path, "w", encoding="utf-8") as out:
            codigo = rodar_processo([sys.executable, str(SCRIPT_PEDIDO)], cwd=pasta, env=env, out=out, timeout=TEMPO_MAX)
    except subprocess.TimeoutExpired:
        codigo = "timeout"
    except Exception as e:  # noqa: BLE001
        codigo = str(e)
    if acao == "catalogo" and codigo == 0 and cache_rede and arq_cat.exists():
        try:
            cache_rede.parent.mkdir(parents=True, exist_ok=True)
            tmp_c = cache_rede.with_name(f"{cache_rede.name}.{os.getpid()}.tmp")
            shutil.copyfile(arq_cat, tmp_c)
            os.chmod(tmp_c, 0o640)
            tmp_c.replace(cache_rede)
        except OSError:
            pass
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


def enfileirar_historico(loja, partes, por=None, tipo="ambos", extras=None):
    with lock:
        e = _estado(loja)
        if e["estado"] in ("na_fila", "rodando") or pendentes(loja):
            return False
        agora = datetime.now(TZ).isoformat()
        jobs = [{"loja": loja, "gatilho": "historico", "tipo": tipo, "por": por, "de": p["de"], "ate": p["ate"], "criado": agora, "inicio": None} for p in partes]
        if extras:  # estoque (foto de agora) e FIXE vão junto da última parte
            jobs[-1]["extras"] = [x for x in extras if x in ("estoque", "fixe")]
            if "fixe" in jobs[-1]["extras"]:
                jobs[-1]["fixe"] = True
        e["lote"] = {"total": len(jobs), "feitas": 0, "falhas": [], "de": partes[0]["de"], "ate": partes[-1]["ate"], "por": por, "criado": agora, "fim": None, "tipo": tipo}
        e["estado"] = "na_fila"
        e["atual"] = jobs[0]
        fila_hist.extend(jobs)
    log(f"{loja}: histórico em {len(partes)} parte(s) {partes[0]['de']} → {partes[-1]['ate']}")
    return True


def cancelar(loja):
    with lock:
        antes = len(fila) + len(fila_hist)
        resto = [j for j in fila if j["loja"] != loja or j.get("gatilho") in ("pedido", "saldos", "inventario")]
        resto_h = [j for j in fila_hist if j["loja"] != loja]
        fila.clear()
        fila.extend(resto)
        fila_hist.clear()
        fila_hist.extend(resto_h)
        e = _estado(loja)
        e.pop("agendado_pendente", None)
        if e["estado"] == "na_fila":
            e["estado"], e["atual"] = "parado", None
        if e.get("lote") and not e["lote"].get("fim"):
            e["lote"]["fim"] = datetime.now(TZ).isoformat()
            e["lote"]["cancelado"] = True
        removidas = antes - (len(fila) + len(fila_hist))
    return removidas


def br(iso):
    return f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}"


def _enxugar_linhas(linhas):
    enxutas = []
    for l in linhas:
        if enxutas and l.strip() == enxutas[-1].strip():
            continue
        enxutas.append(l)
    return enxutas


def rodar(job):
    loja = job["loja"]
    cfg = CONFIG_DIR / f"{loja}.env"
    pasta = WORK_DIR / loja
    pasta.mkdir(parents=True, exist_ok=True)
    # scripts recebem só o ambiente do sistema + as credenciais da própria loja (nada de segredos do painel)
    SEGREDO = re.compile(r"(SECRET|TOKEN|PASS|SENHA|SMTP|GITHUB|KEY)", re.I)
    env = {k: v for k, v in os.environ.items() if not k.startswith("COLETOR_") and not SEGREDO.search(k)}
    env.update(ler_env(cfg))
    # período: histórico = o pedido; rotina = últimos dias da janela (ancorada na data em que foi agendada).
    # Do dia 1 ao 5 a rotina também refaz o mês anterior inteiro (correções do fechamento: comissão e faturamento).
    ref_iso = job.get("data_ref")
    hoje = datetime.strptime(ref_iso, "%Y-%m-%d").date() if (ref_iso and DATA_OK.match(ref_iso)) else datetime.now(TZ).date()
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
    if tipo not in TIPOS and tipo not in ("fixe", "saldos", "extrato"):
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

    def executar(arquivo, env_extra, tempo_limite=None):
        """roda um script e devolve o código de saída (ou 'timeout'/erro)"""
        inicio_log = log_path.stat().st_size
        try:
            return _executar(arquivo, env_extra, tempo_limite or TEMPO_MAX)
        finally:
            with open(log_path, "rb") as f:
                f.seek(inicio_log)
                linhas = f.read().decode("utf-8", "replace").splitlines()
            trechos.append(_enxugar_linhas(linhas)[-15:])

    def _executar(arquivo, env_extra, lim):
        try:
            with open(log_path, "a", encoding="utf-8") as out:
                out.write(f"\n### {arquivo.name} ###\n")
                out.flush()
                return rodar_processo([sys.executable, str(arquivo)], cwd=pasta, env={**env, **env_extra}, out=out, timeout=lim)
        except subprocess.TimeoutExpired:
            with open(log_path, "a", encoding="utf-8") as out:
                out.write(f"\n### coletor: tempo máximo de {lim}s excedido ###\n")
            return "timeout"
        except Exception as e:  # noqa: BLE001
            return str(e)

    quer_estoque = ("estoque" in quer) if quer is not None else (tipo not in ("fixe", "saldos", "extrato") and job["gatilho"] != "historico" and ESTOQUE_ROTINA)
    if "estoque" in (job.get("extras") or []):
        quer_estoque = True
    tab = DATA_DIR / loja / "cadastro" / "tabela.json"
    velha = not tab.exists() or (datetime.now().timestamp() - tab.stat().st_mtime) > 20 * 3600

    saida_xml = str(DATA_DIR / loja / "entrada" / f"{carimbo}_{de}_{ate}_xml.json")
    saida_caixa = str(DATA_DIR / loja / "caixa" / "fechamentos.json")
    saida_est = str(DATA_DIR / loja / "estoque" / "entrada" / f"{carimbo}_estoque.xlsx")
    saida_compras = str(DATA_DIR / loja / "estoque" / "compras.json")
    saida_produtos = str(DATA_DIR / loja / "cadastro" / "entrada")

    etapas_appnext = []
    if tipo == "extrato" and SCRIPT_EXTRATO.exists():
        etapas_appnext.append("extrato")
    if tipo in ("ambos", "vendas"):
        etapas_appnext.append("vendas")
    if tipo in ("ambos", "xml") and SCRIPT_XML.exists():
        etapas_appnext.append("xml")
    if tipo in ("ambos", "vendas") and job.get("gatilho") != "historico" and SCRIPT_CAIXA.exists():
        etapas_appnext.append("caixa")
    if quer_estoque and SCRIPT_ESTOQUE.exists():
        etapas_appnext.append("estoque")
        if SCRIPT_COMPRAS.exists():
            etapas_appnext.append("compras")
        if SCRIPT_PRODUTOS.exists() and (velha or "estoque" in (job.get("extras") or []) or (quer is not None and "estoque" in quer)):
            etapas_appnext.append("produtos")

    ok, codigo, xml, caixa, estoque, fixe = True, 0, None, None, None, None
    principal = None  # o resultado da coleta é o do primeiro script que rodou

    precisa_appnext = bool(etapas_appnext)
    adquiriu_appnext = False
    if precisa_appnext:
        adquiriu_appnext = adquirir_loja_appnext(loja, job.get("gatilho") or "coleta", timeout=max(TEMPO_MAX, 1200))
        if not adquiriu_appnext:
            with open(log_path, "a", encoding="utf-8") as out:
                out.write("\n### coletor: tempo esgotado aguardando liberação do AppNext desta loja ###\n")
            ok, codigo, principal = False, "ocupada", etapas_appnext[0]

    try:
        if precisa_appnext and adquiriu_appnext:
            usar_sessao_unica = (script == SCRIPT and SCRIPT_SESSAO.exists() and len(etapas_appnext) >= 2)
            if usar_sessao_unica:
                arq_sessao = pasta / "sessao.json"
                arq_res_sessao = pasta / "sessao_resultado.json"
                arq_res_sessao.unlink(missing_ok=True)
                arq_sessao.write_text(json.dumps({
                    "etapas": etapas_appnext,
                    "saida_vendas": env["SAIDA_ARQUIVO"],
                    "saida_xml": saida_xml,
                    "saida_caixa": saida_caixa,
                    "saida_estoque": saida_est,
                    "saida_compras": saida_compras,
                    "saida_produtos": saida_produtos,
                }, ensure_ascii=False), encoding="utf-8")
                lim_sessao = max(TEMPO_MAX, 1200)
                inicio_log = log_path.stat().st_size
                try:
                    with open(log_path, "a", encoding="utf-8") as out:
                        cod_s = rodar_processo(
                            [sys.executable, str(SCRIPT_SESSAO)],
                            cwd=pasta,
                            env={**env, "SESSAO_ARQUIVO": str(arq_sessao), "SAIDA_SESSAO": str(arq_res_sessao), "MAX_RUNTIME_SECONDS": str(lim_sessao)},
                            out=out,
                            timeout=lim_sessao + 30,
                        )
                except subprocess.TimeoutExpired:
                    with open(log_path, "a", encoding="utf-8") as out:
                        out.write(f"\n### coletor: tempo máximo de {lim_sessao}s excedido ###\n")
                    cod_s = "timeout"
                except Exception as e:  # noqa: BLE001
                    cod_s = str(e)
                # Extrai o resumo das últimas linhas de cada módulo impresso na sessão única
                with open(log_path, "rb") as f:
                    f.seek(inicio_log)
                    linhas_s = f.read().decode("utf-8", "replace").splitlines()
                bloco = []
                for l in linhas_s:
                    t = l.strip()
                    if t.startswith("### ") and t.endswith(" ###") and t[4:-4].endswith(".py"):
                        if bloco:
                            trechos.append(_enxugar_linhas(bloco)[-15:])
                        bloco = [l]
                    else:
                        bloco.append(l)
                if bloco:
                    trechos.append(_enxugar_linhas(bloco)[-15:])

                res_etapas = {}
                if arq_res_sessao.exists():
                    try:
                        res_etapas = (json.loads(arq_res_sessao.read_text(encoding="utf-8")) or {}).get("etapas") or {}
                    except Exception:  # noqa: BLE001
                        res_etapas = {}

                def _st(nome):
                    r = res_etapas.get(nome)
                    if isinstance(r, dict):
                        return bool(r.get("ok")), (0 if r.get("ok") else (cod_s if cod_s == "timeout" else r.get("codigo", 1)))
                    return False, (cod_s if cod_s != 0 else 1)

                if "vendas" in etapas_appnext:
                    ok, codigo = _st("vendas")
                    principal = "vendas"
                if "xml" in etapas_appnext:
                    ox, cx = _st("xml")
                    xml = {"ok": ox, "codigo": cx}
                    if principal is None:
                        ok, codigo, principal = ox, cx, "xml"
                if "caixa" in etapas_appnext:
                    oc, ccx = _st("caixa")
                    caixa = {"ok": oc, "codigo": ccx}
                if "estoque" in etapas_appnext:
                    oe, ce = _st("estoque")
                    estoque = {"ok": oe, "codigo": ce}
                    if principal is None:
                        ok, codigo, principal = oe, ce, "estoque"
                    if "compras" in etapas_appnext:
                        estoque["compras"] = _st("compras")[0]
                    if "produtos" in etapas_appnext:
                        estoque["produtos"] = _st("produtos")[0]
            else:
                if "extrato" in etapas_appnext:
                    ce = executar(SCRIPT_EXTRATO, {"SAIDA_EXTRATO": str(DATA_DIR / loja / "estoque" / "extrato.json"),
                                                   "SAIDA_EXTRATO_DIAG": str(DATA_DIR / loja / "estoque" / "extrato-diag.json"),
                                                   "EXTRATO_DESDE": job.get("de") or "2025-06-01", "SAIDA_ARQUIVO": str(pasta / "_nao_usado.xlsx"),
                                                   "MAX_RUNTIME_SECONDS": "2300"}, 2400)  # ~20 blocos de 28 dias, página por página
                    ok, codigo, principal = ce == 0, ce, "extrato"
                if "vendas" in etapas_appnext:
                    codigo = executar(script, {})
                    ok = codigo == 0
                    principal = "vendas"
                if "xml" in etapas_appnext:
                    cx = executar(SCRIPT_XML, {"SAIDA_XML": saida_xml, "SAIDA_ARQUIVO": str(pasta / "_nao_usado.xlsx")})
                    xml = {"ok": cx == 0, "codigo": cx}
                    if principal is None:
                        ok, codigo, principal = cx == 0, cx, "xml"
                if "caixa" in etapas_appnext:
                    cx2 = executar(SCRIPT_CAIXA, {"SAIDA_CAIXA": saida_caixa, "SAIDA_ARQUIVO": str(pasta / "_nao_usado.xlsx")})
                    caixa = {"ok": cx2 == 0, "codigo": cx2}
                if "estoque" in etapas_appnext:
                    ce = executar(SCRIPT_ESTOQUE, {"SAIDA_ESTOQUE": saida_est, "SAIDA_ARQUIVO": str(pasta / "_nao_usado.xlsx")})
                    estoque = {"ok": ce == 0, "codigo": ce}
                    if principal is None:
                        ok, codigo, principal = ce == 0, ce, "estoque"
                    if "compras" in etapas_appnext:
                        cc = executar(SCRIPT_COMPRAS, {"SAIDA_COMPRAS": saida_compras, "SAIDA_ARQUIVO": str(pasta / "_nao_usado.xlsx")})
                        estoque["compras"] = cc == 0
                    if "produtos" in etapas_appnext:
                        cp = executar(SCRIPT_PRODUTOS, {"SAIDA_PRODUTOS": saida_produtos, "SAIDA_ARQUIVO": str(pasta / "_nao_usado.xlsx")})
                        estoque["produtos"] = cp == 0
    finally:
        if adquiriu_appnext:
            liberar_loja_appnext(loja)

    if (job.get("fixe") or tipo == "fixe") and SCRIPT_FIXE.exists():
        # cadastro de clientes: só pede a exportação; o painel lê o e-mail do FIXE e importa
        cf = executar(SCRIPT_FIXE, {"SAIDA_FIXE": str(DATA_DIR / loja / "fixe" / "pedido.json"), "FIXE_APELIDO": loja})
        fixe = {"ok": cf == 0, "codigo": cf}
        if principal is None:
            ok, codigo, principal = cf == 0, cf, "fixe"

    cauda = [l for t in trechos for l in t] or (log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-25:] if log_path.exists() else [])
    with lock:
        e = _estado(loja)
        # pedido de "última do dia" que chegou com a loja ocupada: vale para esta coleta (o histórico em lotes passa adiante)
        if job.get("gatilho") != "historico" and tipo in ("ambos", "vendas") and e.get("marcar_ultima_do_dia"):
            marca = e.pop("marcar_ultima_do_dia")
            if not job.get("ultimaDoDia") and marca >= (datetime.now(TZ) - timedelta(hours=6)).strftime("%Y-%m-%d"):
                job = {**job, "ultimaDoDia": marca}
        e["ultima"] = {**job, "tipo": tipo, "xml": xml, "caixa": caixa, "estoque": estoque, "fixe": fixe, "fim": datetime.now(TZ).isoformat(), "ok": ok, "codigo": codigo,
                       "duracao_s": round(time.time() - inicio), "log": cauda}
        lote = e.get("lote")
        if job["gatilho"] == "historico" and lote and not lote.get("fim"):
            lote["feitas"] += 1
            if not ok:
                lote["falhas"].append({"de": de, "ate": ate, "codigo": str(codigo), "log": cauda[-30:]})
            if lote["feitas"] >= lote["total"]:
                lote["fim"] = datetime.now(TZ).isoformat()
        # Se uma rotina agendada chegou enquanto a loja estava ocupada, coloca na fila prioritária agora
        if e.get("agendado_pendente") and not any(j["loja"] == loja and j.get("gatilho") not in ("pedido", "saldos", "inventario") for j in fila):
            pend = e.pop("agendado_pendente")
            j_ag = {
                "loja": loja,
                "gatilho": "agendado",
                "por": None,
                "de": None,
                "ate": None,
                "criado": datetime.now(TZ).isoformat(),
                "inicio": None,
                "fixe": pend.get("fixe", False),
                "data_ref": pend.get("data_ref"),
            }
            if pend.get("ultima_do_dia"):
                j_ag["ultimaDoDia"] = pend.get("data_ref") or datetime.now(TZ).strftime("%Y-%m-%d")
            fila.append(j_ag)
        prox = _prox_coleta_loja(loja)
        e["atual"] = prox
        e["estado"] = "na_fila" if prox else "parado"
    (pasta / "ultima.json").write_text(json.dumps({"ultima": e["ultima"], "lote": e.get("lote")}, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"{loja}: {'OK' if ok else 'FALHOU'} em {round(time.time() - inicio)}s (código {codigo}{'' if xml is None else ', xml ' + ('ok' if xml['ok'] else 'falhou')})")


trabalho = {}  # o que o robô principal está fazendo agora


batida_trab = time.time()  # última volta do trabalhador (a tela avisa se a fila parou de andar — NF-FILA-01)


def trabalhador():
    """laço da fila: nunca pode morrer (antes, um erro fora do try parava a fila e o pedido ficava "na fila" para sempre)"""
    while True:
        try:
            _volta_trabalhador()
        except BaseException as e:  # noqa: BLE001
            log(f"trabalhador: erro inesperado no laço da fila ({type(e).__name__}: {e}); seguindo")
            time.sleep(2)


def _volta_trabalhador():
    global trabalho, batida_trab
    while True:
        batida_trab = time.time()
        job = None
        with lock:
            if fila:
                job = fila.popleft()
            elif fila_hist:
                job = fila_hist.popleft()
            if job:
                trabalho = {"loja": job["loja"], "gatilho": job.get("gatilho"), "inicio": datetime.now(TZ).isoformat()}
        if job:
            try:
                if job.get("gatilho") == "pedido":
                    rodar_pedido(job)
                elif job.get("gatilho") == "saldos":
                    rodar_saldos(job)
                elif job.get("gatilho") == "inventario":
                    rodar_inventario(job)
                else:
                    rodar(job)
            except Exception as e:  # noqa: BLE001
                log(f"{job['loja']}: erro inesperado {e}")
                with lock:
                    if job.get("gatilho") == "pedido":
                        pedido_est[job["loja"]] = {**pedido_est.get(job["loja"], {}), "estado": "parado"}
                    elif job.get("gatilho") == "saldos":
                        saldos_est[job["loja"]] = {**saldos_est.get(job["loja"], {}), "estado": "parado"}
                    elif job.get("gatilho") == "inventario":
                        inv_est[job["loja"]] = {**inv_est.get(job["loja"], {}), "estado": "parado"}
                    else:
                        _estado(job["loja"])["estado"] = "parado"
            finally:
                with lock:
                    trabalho = {}
            continue
        else:
            time.sleep(2)


def agendador():
    """cada loja segue os horários do dia dela (da rede ou próprios; dia sem horário = sem atualização automática)"""
    feitos = set()
    while True:
        agora = datetime.now(TZ)
        hhmm = agora.strftime("%H:%M")
        hoje_str = agora.strftime("%Y-%m-%d")
        for loja in lojas_configuradas():
            hs = horarios_do_dia(loja, agora)
            chave = f"{loja} {hoje_str} {hhmm}"
            if hhmm not in hs or chave in feitos:
                continue
            feitos.add(chave)
            noite = hhmm == max(hs)  # a última do dia também pede o FIXE, o catálogo e dispara o fechamento
            enfileirar(loja, "agendado", fixe=noite, ultima_do_dia=noite, data_ref=hoje_str)
            if noite and tem_pedido(loja):
                enfileirar_pedido(loja, "catalogo", "rotina")
        # histórico de inventários do AppNext: uma vez por dia, de madrugada (só leitura)
        if hhmm == HORA_INVHIST:
            for loja in lojas_configuradas():
                chave = f"invhist {loja} {hoje_str}"
                if chave not in feitos:
                    feitos.add(chave)
                    enfileirar_invhist(loja)
        if len(feitos) > 5000:
            feitos = {k for k in feitos if hoje_str in k}
        time.sleep(20)


def carregar_ultimas():
    for loja in lojas_configuradas():
        fn_ = WORK_DIR / loja / "nfe.json"
        if fn_.exists():
            try:
                nfe_est[loja] = {"estado": "parado", "ultima": json.loads(fn_.read_text(encoding="utf-8"))}
            except Exception:  # noqa: BLE001
                pass
        fi_ = WORK_DIR / loja / "inventario.json"
        if fi_.exists():
            try:
                inv_est[loja] = {"estado": "parado", "ultima": json.loads(fi_.read_text(encoding="utf-8"))}
            except Exception:  # noqa: BLE001
                pass
        fs_ = WORK_DIR / loja / "saldos.json"
        if fs_.exists():
            try:
                saldos_est[loja] = {"estado": "parado", "ultima": json.loads(fs_.read_text(encoding="utf-8"))}
            except Exception:  # noqa: BLE001
                pass
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
            return self._json(200, {"configurada": True, "horarios": horarios_do_dia(loja), "janela": janela(), "fila": fila_n, "temFixe": tem_fixe,
                                    "temPedido": tem_pedido(loja), "pedido": ped, "saldos": info_saldos(loja), "inventario": info_inventario(loja), "nfe": info_nfe(loja), "robo": robo_agora(loja), **info})
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
        if self.path.startswith("/pdf/"):
            # DANFE em PDF para o e-mail da devolução: o painel deixa o HTML em dados/<loja>/devolucoes/<id>/danfe.html
            loja = self._loja("/pdf/")
            if not loja or loja not in lojas_configuradas():
                return self._json(404, {"erro": "loja"})
            try:
                n = int(self.headers.get("Content-Length", "0") or 0)
                corpo = json.loads(self.rfile.read(min(n, 500)) or b"{}") if n else {}
            except Exception:  # noqa: BLE001
                return self._json(400, {"erro": "pedido inválido"})
            did = str(corpo.get("id") or "")
            if not CID_OK.match(did):
                return self._json(400, {"erro": "pedido inválido"})
            pasta = DATA_DIR / loja / "devolucoes" / did
            src, dst = pasta / "danfe.html", pasta / "danfe.pdf"
            if not src.exists():
                return self._json(400, {"erro": "sem o HTML do DANFE"})
            if not sem_pdf.acquire(timeout=30):
                return self._json(503, {"erro": "gerador de PDF ocupado, tente em instantes"})
            try:
                from playwright.sync_api import sync_playwright
                html_doc = src.read_text(encoding="utf-8")
                tmp_pdf = dst.with_name(f"{dst.name}.{os.getpid()}.{threading.get_ident()}.tmp")
                with sync_playwright() as pw:
                    b = pw.chromium.launch(headless=True)
                    try:
                        ctx = b.new_context(java_script_enabled=False)
                        pg = ctx.new_page()
                        pg.route("**/*", lambda route: route.continue_() if route.request.url.startswith(("about:", "data:")) else route.abort())
                        pg.set_content(html_doc, wait_until="load", timeout=15000)
                        pg.pdf(path=str(tmp_pdf), format="A4", print_background=True, margin={"top": "8mm", "bottom": "8mm", "left": "8mm", "right": "8mm"})
                    finally:
                        try:
                            b.close()
                        except Exception:  # noqa: BLE001
                            pass
                os.chmod(tmp_pdf, 0o640)
                tmp_pdf.replace(dst)
            except Exception as e:  # noqa: BLE001
                return self._json(500, {"erro": str(e)[:200]})
            finally:
                sem_pdf.release()
            return self._json(200, {"ok": True})
        if self.path.startswith("/nfe/"):
            loja = self._loja("/nfe/")
            if not loja or loja not in lojas_configuradas():
                return self._json(404, {"erro": "Loja sem acesso ao AppNext configurado."})
            try:
                n = int(self.headers.get("Content-Length", "0") or 0)
                corpo = json.loads(self.rfile.read(min(n, 2000)) or b"{}") if n else {}
            except Exception:  # noqa: BLE001
                return self._json(400, {"erro": "pedido inválido"})
            rid, acao = str(corpo.get("id") or ""), str(corpo.get("acao") or "")
            if not RID_OK.match(rid) or acao not in ("cadastros", "rascunho", "devolucao", "parceiro") or (acao == "cadastros") != (rid == "cadastros"):
                return self._json(400, {"erro": "pedido inválido"})
            if not SCRIPT_NFE.exists():
                return self._json(400, {"erro": "O coletor desta VPS ainda não tem o robô da NF-e (atualize)."})
            if acao != "cadastros" and not arquivos_nfe(loja, rid)[0].exists():
                return self._json(400, {"erro": "Falta o arquivo da nota."})
            if not enfileirar_nfe(loja, rid, acao, por):
                return self._json(409, {"erro": "O robô da NF-e desta loja já está trabalhando."})
            return self._json(200, {"ok": True})
        if self.path.startswith("/inventario/"):
            loja = self._loja("/inventario/")
            if not loja or loja not in lojas_configuradas():
                return self._json(404, {"erro": "Loja sem acesso ao AppNext configurado."})
            try:
                n = int(self.headers.get("Content-Length", "0") or 0)
                corpo = json.loads(self.rfile.read(min(n, 2000)) or b"{}") if n else {}
            except Exception:  # noqa: BLE001
                return self._json(400, {"erro": "pedido inválido"})
            cid, tipo = str(corpo.get("id") or ""), str(corpo.get("tipo") or "")
            if not CID_OK.match(cid) or tipo not in ("importar", "desfazer"):
                return self._json(400, {"erro": "pedido inválido"})
            if not SCRIPT_INVENTARIO.exists():
                return self._json(400, {"erro": "O coletor desta VPS ainda não tem o robô de inventário (atualize)."})
            if not all(f.exists() for f in arquivos_inventario(loja, cid, tipo)[:2]):
                return self._json(400, {"erro": "Faltam os arquivos do inventário."})
            if not enfileirar_inventario(loja, cid, tipo, por):
                return self._json(409, {"erro": "Já tem um inventário desta loja na fila ou rodando."})
            return self._json(200, {"ok": True})
        if self.path.startswith("/fixe-saldos/"):
            loja = self._loja("/fixe-saldos/")
            if not loja or loja not in lojas_configuradas():
                return self._json(404, {"erro": "Loja sem acesso configurado."})
            if not SCRIPT_SALDOS.exists():
                return self._json(400, {"erro": "O coletor desta VPS ainda não tem o robô de saldos (atualize o coletor)."})
            if not enfileirar_saldos(loja, por):
                return self._json(409, {"erro": "A sincronização de saldos desta loja já está na fila ou rodando."})
            return self._json(200, {"ok": True})
        if self.path.startswith("/extrato/"):
            loja = self._loja("/extrato/")
            if not loja or loja not in lojas_configuradas():
                return self._json(404, {"erro": "Loja sem acesso configurado."})
            if not SCRIPT_EXTRATO.exists():
                return self._json(400, {"erro": "O coletor desta VPS ainda não tem o robô do extrato (atualize o coletor)."})
            try:
                n = int(self.headers.get("Content-Length", "0") or 0)
                desde = (json.loads(self.rfile.read(min(n, 10000)) or b"{}").get("desde") or "2025-06-01")
            except Exception:  # noqa: BLE001
                return self._json(400, {"erro": "pedido inválido"})
            if not DATA_OK.match(desde):
                return self._json(400, {"erro": "data inválida"})
            if not enfileirar(loja, "manual", por, de=desde, tipo="extrato"):
                return self._json(409, {"erro": "Esta loja já tem uma coleta na fila ou rodando."})
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
                extras = [x for x in (corpo.get("extras") or []) if x in ("estoque", "fixe")]
            except Exception:  # noqa: BLE001
                return self._json(400, {"erro": "pedido inválido"})
            if tipo not in TIPOS:
                return self._json(400, {"erro": "tipo inválido"})
            if not partes or len(partes) > 120 or not all(DATA_OK.match(p["de"]) and DATA_OK.match(p["ate"]) and p["de"] <= p["ate"] for p in partes):
                return self._json(400, {"erro": "períodos inválidos"})
            if not enfileirar_historico(loja, partes, por, tipo, extras):
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
    threading.Thread(target=trabalhador_inventario, daemon=True).start()
    threading.Thread(target=agendador, daemon=True).start()
    for loja_ in lojas_configuradas():
        if not (DATA_DIR / loja_ / "inventario" / "appnext-historico.json").exists():
            enfileirar_invhist(loja_)
    ThreadingHTTPServer(("0.0.0.0", PORTA), API).serve_forever()


if __name__ == "__main__":
    main()
