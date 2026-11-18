#!/usr/bin/env python3
# Lê (SÓ LÊ) o histórico de inventários do AppNext: Estoque → Auditoria/Inventário.
#   1) lista dos inventários dos últimos DIAS_HIST dias (data, número, quem fez);
#   2) para cada inventário que ainda não está no arquivo, abre os detalhes e lê os produtos
#      (código, quantidade anterior e lançada).
# Não clica em nada que salve: só troca de tela e lê os dados que a própria tela carregou.
# Roda todo dia às 02:00 (agendado pelo coletor). O painel usa para saber há quantos dias cada grupo
# ou tipo de chá foi inventariado, mesmo quando o inventário foi feito direto no AppNext.
# Variáveis: as do script de vendas (APPNEXT_*) + SAIDA_HISTORICO (.json). DIAS_HIST (padrão 180).
import json
import os
import sys
import traceback
from datetime import datetime, timedelta
from pathlib import Path

SAIDA = os.getenv("SAIDA_HISTORICO", "").strip()
DIAS = max(30, min(400, int(os.getenv("DIAS_HIST", "180") or 180)))
if not SAIDA:
    print("ERRO: defina SAIDA_HISTORICO")
    sys.exit(2)
os.environ.setdefault("SAIDA_ARQUIVO", str(Path.cwd() / "_nao_usado.xlsx"))

import nextsoft_export_to_drive as nx  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

log = nx.log


def abrir_login(page):
    """abre o AppNext sem esperar o "load" completo (um recurso de terceiros lento travava 60 s por tentativa):
    basta a página montar e aparecer o login (ou já estar logado)"""
    for i in range(1, 5):
        for url in (nx.LOGIN_URL, nx.LOGIN_URL.replace("https://www.", "https://")):
            try:
                log(f"   abrindo o AppNext (tentativa {i})")
                page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                page.wait_for_function("() => !!document.querySelector('input[type=password]') || /#\\/loja\\//.test(location.hash)", timeout=45_000)
                return
            except Exception as e:  # noqa: BLE001
                log(f"   não abriu: {str(e).splitlines()[0][:120]}")
        page.wait_for_timeout(i * 5000)
    raise RuntimeError("o AppNext não abriu (site lento ou fora do ar); tente de novo em alguns minutos")


def fazer_login(page):
    """mesmo login do robô de produtos (aqui sem importar aquele script, que exige outras variáveis)"""
    if "/#/login" in page.url:
        page.fill(nx.SEL["rede"], nx.REDE)
        page.fill(nx.SEL["email"], nx.USER)
        page.fill(nx.SEL["senha"], nx.PASS)
        page.click(nx.SEL["entrar"])
    page.wait_for_url("**/#/loja/**", timeout=120_000)


ACHAR = """(teste) => {
  const raiz = [...document.querySelectorAll('*')].find((e) => e.__vue__);
  const fila = raiz ? [raiz.__vue__.$root] : [];
  while (fila.length) { const x = fila.shift(); if (teste(x)) return x; fila.push(...(x.$children || [])); }
  return null;
}"""

LISTA_JS = """async (dias) => {
  const achar = %s;
  let v = null;
  for (let i = 0; i < 40 && !v; i++) { v = achar((x) => x.$data && 'inventarios' in x.$data && x.$options.methods && x.$options.methods.filtrar); if (!v) await new Promise((r) => setTimeout(r, 500)); }
  if (!v) return { erro: 'não achei a lista de inventários' };
  v.range = { start: new Date(Date.now() - dias * 864e5), end: new Date(Date.now() + 864e5) };
  await v.filtrar();
  for (let i = 0; i < 40 && v.loading; i++) await new Promise((r) => setTimeout(r, 500));
  await new Promise((r) => setTimeout(r, 1500));
  return { lista: (v.inventarios || []).map((x) => ({ id: x.id, numero: x.numero, data: x.data, tipo: x.tipoInventario, usuario: x.usuario && x.usuario.nome })) };
}""" % ACHAR

DETALHE_JS = """async (id) => {
  const achar = %s;
  for (let i = 0; i < 80; i++) {
    const v = achar((x) => x.$data && 'inventario' in x.$data && 'config' in x.$data);
    const inv = v && v.inventario;
    if (inv && inv.id === id && Array.isArray(inv.itens)) {
      return { itens: inv.itens.map((i) => ({ cod: String(i.produtoCodigo ?? ''), ant: Number(i.quantidadeAnterior), lanc: Number(i.quantidadeLancada) })) };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { erro: 'os detalhes não carregaram' };
}""" % ACHAR

GUID = __import__("re").compile(r"^[0-9a-fA-F-]{36}\Z")


def ler_atual():
    try:
        return json.loads(Path(SAIDA).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def gravar(res):
    Path(SAIDA).parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(SAIDA).with_name(f"{Path(SAIDA).name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    os.chmod(tmp, 0o640)
    tmp.replace(SAIDA)


def main():
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "1500")))
    atual = ler_atual()
    ja = {x["id"]: x for x in (atual.get("inventarios") or []) if x.get("id") and isinstance(x.get("itens"), list)}
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
        try:
            log("▸ 1) Login")
            abrir_login(page)
            fazer_login(page)
            log("   ✓ login feito")
            log(f"▸ 2) Auditoria/Inventário: lista dos últimos {DIAS} dias")
            page.evaluate("() => { location.hash = '#/estoque/inventario'; }")
            r = page.evaluate(LISTA_JS, DIAS)
            if r.get("erro"):
                raise RuntimeError(r["erro"])
            lista = [x for x in r["lista"] if x.get("id") and GUID.match(str(x["id"]))]
            novos = [x for x in lista if x["id"] not in ja]
            log(f"   {len(lista)} inventários no período · {len(novos)} novos para ler")
            lidos = 0
            for x in sorted(novos, key=lambda y: y.get("data") or ""):
                # passa pela lista antes: indo de um detalhe direto para outro, o AppNext reaproveita a tela e não recarrega
                page.evaluate("() => { location.hash = '#/estoque/inventario'; }")
                page.wait_for_timeout(800)
                page.evaluate("(id) => { location.hash = '#/estoque/inventario/detalhes/' + id; }", x["id"])
                d = page.evaluate(DETALHE_JS, x["id"])
                if d.get("erro"):
                    log(f"   nº {x.get('numero')}: {d['erro']} (tenta de novo amanhã)")
                    continue
                ja[x["id"]] = {**x, "itens": [i for i in d["itens"] if i["cod"]]}
                lidos += 1
                if lidos % 20 == 0:  # grava aos poucos: se cair no meio, não perde o que já leu
                    gravar({"em": datetime.now().astimezone().isoformat(), "dias": DIAS, "inventarios": list(ja.values())})
                    log(f"   {lidos} lidos…")
            limite = (datetime.now().astimezone() - timedelta(days=DIAS + 30)).isoformat()
            inv = sorted([x for x in ja.values() if (x.get("data") or "") >= limite], key=lambda y: y.get("data") or "", reverse=True)
            gravar({"em": datetime.now().astimezone().isoformat(), "dias": DIAS, "inventarios": inv})
            log(f"✓ histórico salvo: {len(inv)} inventários ({lidos} lidos agora)")
        except Exception as e:  # noqa: BLE001
            log(f"ERRO: {e}")
            traceback.print_exc()
            sys.exit(1)
        finally:
            ctx.close()


if __name__ == "__main__":
    main()
