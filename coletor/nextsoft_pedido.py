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


def venda_conjunta(page):
    """Janela "Venda Conjunta" do site: se estiver aberta, lê os itens exigidos e clica em "Colocar Todos no Carrinho".
    Devolve a lista [{cod, nome, qtd, preco}] (pode ser vazia) ou None quando a janela não está na tela."""
    itens = page.evaluate("""() => {
      // janela fechada = ele ou um pai com display:none (não exige tamanho: no site de verdade a checagem por tamanho falhava)
      const fechado = (e) => { for (let x = e; x && x.nodeType === 1; x = x.parentElement) if (getComputedStyle(x).display === 'none') return true; return false; };
      const txt = (e) => String(e.tagName === 'INPUT' ? e.value || '' : e.textContent || '').replace(/\\s+/g, ' ').trim();
      const achados = [...document.querySelectorAll('a,button,input,span,div,label,td')].filter((x) => /^colocar\\s+todos\\s+no\\s+carrinho$/i.test(txt(x)) && !fechado(x));
      if (!achados.length) return null;
      const el = achados[achados.length - 1];
      const b = el.closest('a,button,input,[onclick]') || el;
      const num = (t) => { const m = /-?[\\d.]*\\d(?:,\\d+)?/.exec(String(t || '')); return m ? +m[0].replace(/\\./g, '').replace(',', '.') : null; };
      const j = b.closest('.modal, .modal-content, [role=dialog], .ui-dialog') || document;
      const itens = [...j.querySelectorAll('table tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\\s+/g, ' ').trim()))
        .filter((c) => c.length >= 4 && /\\d/.test(c[0])).map((c) => ({ cod: c[0], nome: c[1], qtd: num(c[c.length - 2]), preco: num(c[c.length - 1]) }));
      b.click();
      return itens;
    }""")
    return itens


# Aviso do site depois do clique (ex.: janela "Atenção" com "O produto X não possui estoque suficiente." e "Fechar").
# Na loja real (22/11/2026) o aviso não era o .modal de sempre e às vezes chegava atrasado. Mesma regra do favorito
# (avisoDoSite em public/js/carrinho-site.js): qualquer janela visível ou bloco visível com o texto de estoque; fecha e devolve o texto.
AVISO_JS = """() => {
  const RE_ESTOQUE = /n[ãa]o\\s+possui\\s+estoque\\s+suficiente|estoque\\s+insuficiente/i;
  const RE_FECHAR = /^(fechar|ok|×|x|fechar\\s*×)$/i;
  const BOTOES = 'button,a,input[type=button],input[type=submit],[onclick],.btn,span';
  const fechado = (e) => { for (let x = e; x && x.nodeType === 1; x = x.parentElement) if (getComputedStyle(x).display === 'none') return true; return getComputedStyle(e).visibility === 'hidden'; };
  const texto = (e) => (e.textContent || '').replace(/\\s+/g, ' ').trim();
  const ignorar = (e) => e.id === 'modalCarregamentoAjax' || e.id === 'modalCarrinho' || /colocar\\s+todos\\s+no\\s+carrinho/i.test(e.textContent || '');
  let janelas = [...document.querySelectorAll('.modal, [role=dialog], [role=alertdialog], .bootbox, .swal2-popup, .ui-dialog')].filter((e) => !ignorar(e) && !fechado(e) && texto(e));
  janelas = janelas.filter((e) => !janelas.some((o) => o !== e && o.contains(e)));
  if (!janelas.length) {
    const folhas = [...document.querySelectorAll('div,p,span,td,li,section')].filter((e) => RE_ESTOQUE.test(e.textContent || '') && ![...e.children].some((c) => RE_ESTOQUE.test(c.textContent || '')) && !fechado(e) && !e.closest('[data-tsc-visto]'));
    for (const f of folhas) {
      let c = f, achou = null;
      for (let i = 0; i < 6 && c && c !== document.body; i++, c = c.parentElement) { if ([...c.querySelectorAll(BOTOES)].some((b) => RE_FECHAR.test(texto(b) || b.value || ''))) { achou = c; break; } }
      const j = achou || f;
      if (!ignorar(j)) janelas.push(j);
    }
  }
  const m = janelas.find((e) => RE_ESTOQUE.test(e.textContent || '')) || janelas[0];
  if (!m) return null;
  const corpo = m.querySelector('.modal-body, .bootbox-body, .swal2-html-container') || m;
  // o texto do aviso: o bloco mais interno com a frase de estoque (sem o título "Atenção" nem o botão)
  const frase = [...m.querySelectorAll('*')].reverse().find((e) => RE_ESTOQUE.test(e.textContent || '') && ![...e.children].some((c) => RE_ESTOQUE.test(c.textContent || '')));
  const txt = (frase ? texto(frase) : texto(corpo)).replace(/\\s*(fechar|ok|×)\\s*$/i, '').trim();
  const fechar = [...m.querySelectorAll(BOTOES)].find((b) => RE_FECHAR.test(texto(b) || b.value || '')) || m.querySelector('[data-dismiss],[aria-label=Close],.close');
  try {
    if (fechar) fechar.click();
    else if (m.matches('.modal, [role=dialog], [role=alertdialog], .bootbox, .swal2-popup, .ui-dialog')) m.style.display = 'none';
    else m.setAttribute('data-tsc-visto', '1');
  } catch (e) { /* ok */ }
  return txt || 'O site mostrou um aviso.';
}"""
RE_ESTOQUE = re.compile(r"n[ãa]o\s+possui\s+estoque\s+suficiente|estoque\s+insuficiente", re.I)


def aviso_do_site(page):
    try:
        return page.evaluate(AVISO_JS)
    except Exception:  # noqa: BLE001
        return None


def dono_do_aviso(texto, atual, anteriores):
    """De quem é o aviso ("O produto X não possui estoque…" pode chegar atrasado, já no produto seguinte)."""
    m = re.search(r"produto\s+(.+?)\s+n[ãa]o\s+possui", texto or "", re.I)
    if not m:
        return atual
    n = esq(m.group(1))

    def parece(x):
        e = esq(x or "")
        return e == n or (len(e) >= 4 and len(n) >= 4 and (e in n or n in e))
    if atual and parece(atual):
        return atual
    return next((x for x in anteriores if esq(x) == n), None) or next((x for x in anteriores if parece(x)), None) or atual


def status_do_aviso(texto):
    return "sem_estoque" if RE_ESTOQUE.search(texto or "") or re.search(r"estoque", texto or "", re.I) else "recusado"


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
    res = {"inicio": datetime.now(TZ).isoformat(), "por": pedido.get("por"), "itens": [], "ok": False, "site": BASE}
    if pedido.get("refazer"):
        # "tentar de novo": mantém o resultado anterior e refaz só estes produtos
        try:
            antes_res = json.loads(Path(destino).read_text(encoding="utf-8"))
            refazer = {str(i.get("cod")) for i in itens}
            res.update({k: antes_res[k] for k in ("inicio", "por") if antes_res.get(k)})
            res["itens"] = [i for i in antes_res.get("itens", []) if str(i.get("cod")) not in refazer]
            res["refeito"] = datetime.now(TZ).isoformat()
        except (OSError, ValueError):
            pass
    base = len(res["itens"])
    res["base"] = base

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
    res["total"] = base + len(itens)
    salvar()  # o painel mostra o andamento: "3 de 25 produtos"
    for n, it in enumerate(itens, 1):
        res["atual"] = it["nome"]
        salvar()
        r = {"cod": it.get("cod"), "nome": it["nome"], "pedido": float(it["qtd"])}

        def aviso_de(nome):
            """aviso na tela: de outro produto (atrasado) → marca aquele e devolve None; deste → devolve o texto"""
            a = aviso_do_site(page)
            if not a:
                return None
            dono = dono_do_aviso(a, nome, [x["nome"] for x in res["itens"]])
            if dono != nome:
                for x in res["itens"]:
                    if x["nome"] == dono and x.get("status") != "ok":
                        x.update({"status": status_do_aviso(a), "erro": a[:200], "atrasado": True})
                        log(f"   aviso atrasado de {dono}: {x['status']}")
                        salvar()
                return None
            return a
        try:
            aviso_de(None)  # um aviso atrasado do produto anterior não pode cair neste
            page.fill(f"#{L}txtBusca", it["nome"])
            page.click(f"#{L}btnBuscar")
            esperar(page, 700)
            alvo = None
            for _ in range(8):  # a lista pode demorar a trocar (postback parcial)
                alvo = next((c for c in cards(page) if esq(c["nome"]) == esq(it["nome"])), None)
                if alvo:
                    break
                page.wait_for_timeout(700)
            aviso_de(None)  # a busca recarrega a página: o aviso atrasado pode aparecer agora
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
                    aceitou = False
                    aviso = None
                    for _ in range(12):  # o topo ("N Itens - R$ …") pode atualizar depois
                        if depois != antes_t:
                            break
                        aviso = aviso_de(it["nome"])
                        if aviso:
                            break
                        # "Venda Conjunta" (ex.: a mug só é vendida com o infusor dela): decisão do dono é aceitar
                        # em "Colocar Todos no Carrinho". Uma vez por produto; o que veio junto fica no resultado.
                        if not aceitou:
                            try:
                                junto = venda_conjunta(page)
                                if junto is not None:
                                    aceitou = True
                                    if junto:
                                        r["junto"] = junto
                                    log(f"   venda conjunta: {', '.join(j['nome'] for j in junto) or 'itens do site'} — Colocar Todos no Carrinho")
                                    esperar(page, 900)
                            except Exception:  # noqa: BLE001
                                pass
                        page.wait_for_timeout(700)
                        depois = carrinho_txt(page)
                    # o carrinho não mudou e nada apareceu: o aviso do site às vezes chega bem depois — espera mais um pouco só por ele
                    for _ in range(16):
                        if depois != antes_t or aviso:
                            break
                        page.wait_for_timeout(500)
                        depois = carrinho_txt(page)
                        if depois == antes_t:
                            aviso = aviso_de(it["nome"])
                    if depois != antes_t:
                        r["status"] = "ok"
                    elif aviso:
                        r["status"] = status_do_aviso(aviso)
                        r["erro"] = aviso[:200]
                    else:
                        r["status"] = "sem_confirmacao"
        except Exception as e:  # noqa: BLE001
            r["status"] = "erro"
            r["erro"] = str(e).splitlines()[0][:200]
        res["itens"].append(r)
        log(f"{n}/{len(itens)} {it['nome']}: {r['status']}{' ' + str(r.get('qtd')) if r.get('qtd') else ''}")
        salvar()
    res.pop("atual", None)
    res["carrinhoDepois"] = carrinho_info(page)
    # link do carrinho no topo do site (quando tem itens), para abrir direto
    try:
        href = page.evaluate("""() => { const a = [...document.querySelectorAll('a[href]')].find(a => /Ite(m|ns)\\s*-\\s*R\\$/i.test(a.textContent) && !/^javascript/i.test(a.getAttribute('href'))); return a ? a.href : null }""")
        if href:
            res["linkCarrinho"] = href
    except Exception:  # noqa: BLE001
        pass
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
