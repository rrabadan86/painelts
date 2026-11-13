#!/usr/bin/env python3
"""
Sistema de Pedidos da franqueadora (grnteashop.nextsoft.com.br/Pedidos), fornecedor FRANQUIAS.

MODO=catalogo  → lê o catálogo e grava SAIDA_CATALOGO (.json):
    1. Consultar Produtos, busca "%": código, nome e preço de tudo (preço R$ 0,01 = indisponível);
    2. Novo Pedido → FRANQUIAS, 60 por página: pedido mínimo, máximo e múltiplo de cada produto disponível.
MODO=carrinho  → lê ENTRADA_PEDIDO (.json: {"itens":[{"cod","nome","qtd"}]}), coloca cada item no carrinho
    (busca pelo nome, confere o nome exato, ajusta ao múltiplo) e grava SAIDA_RESULTADO (.json).
    NUNCA passa da etapa "2: Escolha os Produtos": não escolhe pagamento nem finaliza o pedido.
    Se o carrinho já tiver itens, para sem mexer (CARRINHO_SOMAR=1 soma aos que já estão lá).

Credenciais da loja (config/coletor/<loja>.env, só na VPS): PEDIDO_USER, PEDIDO_PASS, PEDIDO_URL (opcional).
"""
import json
import os
import re
import sys
import threading
import time
import traceback
import unicodedata
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

TZ = ZoneInfo(os.getenv("TZ") or "America/Sao_Paulo")
BASE = (os.getenv("PEDIDO_URL") or "https://grnteashop.nextsoft.com.br/Pedidos/").strip()
if not BASE.endswith("/"):
    BASE += "/"
USER = (os.getenv("PEDIDO_USER") or "").strip()
PASS = (os.getenv("PEDIDO_PASS") or "").strip()
FORNECEDOR = (os.getenv("PEDIDO_FORNECEDOR") or "FRANQUIAS").strip()
MODO = (os.getenv("MODO") or "catalogo").strip()
P = "ctl00_ContentPlaceHolder1_"
L = P + "ucListagem1_"


def log(msg):
    print(f"[{datetime.now(TZ):%H:%M:%S}] {msg}", flush=True)


def step(t):
    log("=" * 60)
    log(t)
    log("=" * 60)


def watchdog(seg):
    def matar():
        time.sleep(seg)
        log(f"### tempo máximo de {seg}s excedido ###")
        os._exit(124)
    threading.Thread(target=matar, daemon=True).start()


def esq(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def num(s):
    """'1.234,50' → 1234.5 · 'Livre' → None"""
    m = re.search(r"-?[\d.]*\d(?:,\d+)?", str(s or ""))
    if not m:
        return None
    return float(m.group(0).replace(".", "").replace(",", "."))


def gravar(destino, obj):
    d = Path(destino)
    d.parent.mkdir(parents=True, exist_ok=True)
    tmp = d.with_name(d.name + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    tmp.replace(d)


def esperar(page, ms=600):
    try:
        page.wait_for_load_state("load", timeout=45000)
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(ms)


def login(page):
    page.goto(BASE + "Login.aspx", wait_until="load")
    if page.locator("#UserName").count():
        page.fill("#UserName", USER)
        page.fill("#Password", PASS)
        page.click("#LinkButton1")
        esperar(page, 1000)
    if page.locator("#UserName").count() or "login" in page.url.lower():
        msg = page.evaluate("() => document.body.innerText.slice(0, 300)").replace("\n", " | ")
        raise RuntimeError(f"Login não entrou (confira PEDIDO_USER e PEDIDO_PASS). Na tela: {msg}")
    quem = page.evaluate("() => { const a = [...document.querySelectorAll('a')].find(x => /Olá/.test(x.textContent)); return a ? a.textContent.replace(/\\s+/g, ' ').trim() : '' }")
    log(f"Login ok ({quem or page.url}).")


def carrinho_txt(page):
    return page.evaluate("""() => { const t = [...document.querySelectorAll('a,span,div')].map(e => e.textContent.replace(/\\s+/g, ' ').trim())
      .filter(t => t.length < 60 && /Ite(m|ns)\\s*-\\s*R\\$/i.test(t)); return t.sort((a, b) => a.length - b.length)[0] || '' }""")


def carrinho_info(page):
    t = carrinho_txt(page)
    if re.search(r"N[ãa]o h[áa] Ite", t, re.I):
        return {"texto": t, "itens": 0, "valor": 0.0}
    m = re.search(r"(\d+)\s*Ite", t)
    v = re.search(r"R\$\s*([\d.,]+)", t)
    return {"texto": t, "itens": int(m.group(1)) if m else None, "valor": num(v.group(1)) if v else None}


# ---------- catálogo ----------
def consulta(page):
    page.goto(BASE + "ConsultaProdutos.aspx", wait_until="load")
    page.fill(f"#{P}txtProduto", "%")
    page.click(f"#{P}btnBuscar")
    esperar(page, 1000)
    page.wait_for_function("() => document.querySelectorAll('table tr').length > 2", timeout=60000)
    linhas = page.evaluate("() => [...document.querySelectorAll('table tr')].map(r => [...r.cells].map(c => c.textContent.trim())).filter(r => r.length >= 5)")
    itens = {}
    for r in linhas[1:]:
        cod, nome, forn, _uf, preco = r[:5]
        if esq(forn) != esq(FORNECEDOR) or not cod:
            continue
        p = num(preco)
        itens[cod] = {"cod": cod, "nome": nome, "preco": p, "disp": p is not None and p > 0.011}
    return itens


JS_CARDS = """() => [...document.querySelectorAll('input[id*="txtQtde_"]')].map(q => {
  let c = q;
  for (let i = 0; i < 8 && c.parentElement; i++) { c = c.parentElement; if (/Pedido M[ií]nimo/i.test(c.innerText) && c.querySelectorAll('input[id*="txtQtde_"]').length === 1) break; }
  const t = c.innerText.replace(/\\r/g, '');
  const linhas = t.split('\\n').map(s => s.trim()).filter(Boolean);
  const iMin = linhas.findIndex(s => /Pedido M[ií]nimo/i.test(s));
  const g = (re) => { const m = re.exec(t); return m ? m[1].trim() : null; };
  return { id: q.id, nome: (iMin > 0 ? linhas.slice(0, iMin).filter(s => !/^NOVIDADE$/i.test(s)).pop() : linhas[0]) || '',
    min: g(/Pedido M[ií]nimo:\\s*([^\\n]+)/i), max: g(/Pedido M[áa]ximo:\\s*([^\\n]+)/i), preco: g(/R\\$\\s*([\\d.,]+)/), mult: g(/M[úu]ltiplo de\\s*([\\d.,]+)/i) };
})"""


def cards(page):
    out = []
    for c in page.evaluate(JS_CARDS):
        mn = num(c["min"]) if c["min"] and not re.search(r"livre", c["min"], re.I) else None
        out.append({"id": c["id"], "nome": c["nome"], "preco": num(c["preco"]), "min": mn, "max": num(c["max"]), "mult": num(c["mult"]) or 1.0})
    return out


def abrir_pedido(page):
    page.goto(BASE + "Abertura.aspx", wait_until="load")
    if page.locator("#new-pedido").count():
        page.click("#new-pedido")
        page.wait_for_timeout(800)
    sel = f"#{P}ddlFornecedores"
    page.wait_for_selector(sel, state="attached", timeout=20000)
    valor = page.evaluate(f"""() => {{ const s = document.querySelector('{sel}'); const o = [...s.options].find(o => o.text.trim().toUpperCase() === {json.dumps(FORNECEDOR.upper())}); return o ? o.value : null }}""")
    if not valor:
        raise RuntimeError(f"Fornecedor {FORNECEDOR} não aparece em 'Todos Fornecedores'.")
    page.select_option(sel, valor)
    page.wait_for_url("**/Home.aspx**", timeout=60000)
    esperar(page, 800)
    page.wait_for_selector(f"#{L}txtBusca", timeout=30000)
    log(f"Fornecedor {FORNECEDOR}: tela de produtos aberta.")


def ler_paginas(page):
    """60 por página e percorre a paginação; devolve {nome normalizado: card}"""
    sel = f"#{L}ddlItensPorPagina"
    if page.locator(sel).count() and page.eval_on_selector(sel, "s => s.value") != "60":
        page.select_option(sel, "60")
        esperar(page, 1200)
    vistos, pag = {}, 1
    while pag <= 40:
        cs = cards(page)
        for c in cs:
            vistos.setdefault(esq(c["nome"]), c)
        primeiro = cs[0]["id"] if cs else None
        prox = page.locator(f"a[href*='doPostBack']:text-is('{pag + 1}')")
        if not prox.count():
            break
        prox.first.click()
        esperar(page, 800)
        try:
            page.wait_for_function(f"() => {{ const q = document.querySelector('input[id*=\"txtQtde_\"]'); return q && q.id !== {json.dumps(primeiro)} }}", timeout=30000)
        except Exception:  # noqa: BLE001
            break
        pag += 1
    log(f"Tela de pedido: {len(vistos)} produtos em {pag} página(s).")
    return vistos


def modo_catalogo(page):
    destino = os.getenv("SAIDA_CATALOGO", "").strip()
    if not destino:
        raise RuntimeError("defina SAIDA_CATALOGO")
    step("2) Consultar Produtos (código, nome e preço)")
    itens = consulta(page)
    disp = sum(1 for i in itens.values() if i["disp"])
    log(f"Catálogo {FORNECEDOR}: {len(itens)} produtos, {disp} disponíveis.")
    if not itens:
        raise RuntimeError("A consulta não trouxe nenhum produto.")
    step("3) Novo Pedido: mínimo, máximo e múltiplo")
    regras = {}
    try:
        abrir_pedido(page)
        regras = ler_paginas(page)
    except Exception as e:  # noqa: BLE001
        log(f"Aviso: não li os múltiplos da tela de pedido ({str(e).splitlines()[0][:200]}); o catálogo sai sem eles.")
    casados = 0
    for it in itens.values():
        r = regras.get(esq(it["nome"]))
        if r:
            casados += 1
            it.update({"mult": r["mult"], "min": r["min"], "max": r["max"]})
            if r["preco"] is not None:
                it["precoPedido"] = r["preco"]
    log(f"Múltiplos encontrados para {casados} produtos.")
    gravar(destino, {"em": datetime.now(TZ).isoformat(), "fornecedor": FORNECEDOR, "itens": sorted(itens.values(), key=lambda x: x["nome"])})
    log(f"Catálogo gravado ({Path(destino).name}).")


def ajustar(qtd, c):
    mult = c.get("mult") or 1.0
    q = max(qtd, c.get("min") or 0)
    q = round(-(-round(q / mult, 6) // 1) * mult, 3)  # arredonda para cima no múltiplo
    if c.get("max") and q > c["max"]:
        q = round((c["max"] // mult) * mult, 3)
    return q


def modo_carrinho(page):
    entrada, destino = os.getenv("ENTRADA_PEDIDO", "").strip(), os.getenv("SAIDA_RESULTADO", "").strip()
    if not entrada or not destino:
        raise RuntimeError("defina ENTRADA_PEDIDO e SAIDA_RESULTADO")
    pedido = json.loads(Path(entrada).read_text(encoding="utf-8"))
    itens = [i for i in pedido.get("itens", []) if i.get("nome") and float(i.get("qtd") or 0) > 0]
    res = {"inicio": datetime.now(TZ).isoformat(), "por": pedido.get("por"), "itens": [], "ok": False}

    def salvar():
        res["fim"] = datetime.now(TZ).isoformat()
        gravar(destino, res)

    step("2) Novo Pedido → " + FORNECEDOR)
    try:
        abrir_pedido(page)
    except Exception as e:  # noqa: BLE001
        res["erro"] = f"Não abri a tela de produtos: {str(e).splitlines()[0][:200]}"
        salvar()
        raise
    antes = carrinho_info(page)
    res["carrinhoAntes"] = antes
    log(f"Carrinho agora: {antes['texto'] or '?'}")
    if antes["itens"] and (os.getenv("CARRINHO_SOMAR") or "0") != "1":
        res["erro"] = f"O carrinho do site já tem itens ({antes['texto']}). Finalize ou esvazie antes; nada foi colocado."
        log(res["erro"])
        salvar()
        return 3
    step(f"3) Colocando {len(itens)} produtos no carrinho")
    for n, it in enumerate(itens, 1):
        r = {"cod": it.get("cod"), "nome": it["nome"], "pedido": float(it["qtd"])}
        try:
            page.fill(f"#{L}txtBusca", it["nome"])
            page.click(f"#{L}btnBuscar")
            esperar(page, 700)
            alvo = None
            for _ in range(8):  # a lista pode demorar a trocar (postback parcial)
                alvo = next((c for c in cards(page) if esq(c["nome"]) == esq(it["nome"])), None)
                if alvo:
                    break
                page.wait_for_timeout(700)
            if not alvo:
                r["status"] = "nao_encontrado"
            elif not alvo["preco"] or alvo["preco"] <= 0.011:
                r["status"] = "indisponivel"
            else:
                q = ajustar(float(it["qtd"]), alvo)
                if q <= 0:
                    r["status"] = "acima_do_maximo"
                else:
                    r.update({"qtd": q, "preco": alvo["preco"], "mult": alvo["mult"]})
                    campo = page.locator(f"#{alvo['id']}")
                    campo.fill(f"{q:.2f}".replace(".", ","))
                    botao = page.locator("#" + re.sub(r"txtQtde_\d+$", "lnkAddCart", alvo["id"]))
                    antes_t = carrinho_txt(page)
                    botao.click()
                    esperar(page, 900)
                    depois = carrinho_txt(page)
                    for _ in range(12):  # o topo ("N Itens - R$ …") pode atualizar depois
                        if depois != antes_t:
                            break
                        page.wait_for_timeout(700)
                        depois = carrinho_txt(page)
                    r["status"] = "ok" if depois != antes_t else "sem_confirmacao"
        except Exception as e:  # noqa: BLE001
            r["status"] = "erro"
            r["erro"] = str(e).splitlines()[0][:200]
        res["itens"].append(r)
        log(f"{n}/{len(itens)} {it['nome']}: {r['status']}{' ' + str(r.get('qtd')) if r.get('qtd') else ''}")
        if n % 5 == 0:
            salvar()  # o painel acompanha o andamento
    res["carrinhoDepois"] = carrinho_info(page)
    res["ok"] = True
    log(f"Carrinho no fim: {res['carrinhoDepois']['texto']}. O pedido NÃO foi finalizado: revise no site e finalize.")
    salvar()
    return 0


def main():
    watchdog(int(os.getenv("MAX_RUNTIME_SECONDS") or "900"))
    if not USER or not PASS:
        log("ERRO: faltam PEDIDO_USER e PEDIDO_PASS no arquivo da loja.")
        return 2
    with sync_playwright() as pw:
        nav = pw.chromium.launch(headless=True)
        ctx = nav.new_context(viewport={"width": 1400, "height": 950}, locale="pt-BR",
                              user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36")
        page = ctx.new_page()
        page.set_default_timeout(30000)
        page.set_default_navigation_timeout(60000)
        try:
            step("1) Login no Sistema de Pedidos")
            login(page)
            if MODO == "carrinho":
                return modo_carrinho(page)
            modo_catalogo(page)
            return 0
        except Exception:  # noqa: BLE001
            log("### ERRO NO SISTEMA DE PEDIDOS ###")
            print(traceback.format_exc(), flush=True)
            return 1
        finally:
            try:
                nav.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    sys.exit(main())
