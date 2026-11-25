#!/usr/bin/env python3
# Extrato de estoque do AppNext (Estoque → Extrato de estoque), SÓ LEITURA (EXTRATO-01, pedido do dono de 25/11/2026).
# Serve para reconstruir o estoque a custo do começo de cada mês desde jun/2025 (CMV pelo estoque, src/cmvestoque.js).
#
# Como o formato da tela ainda não é conhecido, o robô faz duas coisas:
#   1) DIAGNÓSTICO (SAIDA_EXTRATO_DIAG): os endereços que a tela chama (só o caminho e os NOMES dos parâmetros), os campos
#      da resposta e 2 linhas de exemplo, o texto da tela e os rótulos dos filtros — sem dado pessoal (campos de usuário,
#      operador, e-mail, CPF/CNPJ, cliente e telefone são retirados). É isso que o dono manda para ajustar a leitura.
#   2) MOVIMENTOS (SAIDA_EXTRATO): a tela chama /api/v1/estoque/extrato-estoque com dataInicial/dataFinal (no máximo 31
#      dias por pedido, diagnóstico de 25/11/2026), paginado (pagina, tamanhoPagina, totalLinhas). O robô repete o mesmo pedido
#      em blocos de 28 dias de EXTRATO_DESDE até hoje, página por página, confere o total de cada bloco com o totalLinhas e
#      guarda os movimentos resumidos (sem parceiro nem campos pessoais). A situação do produto vai em "todos" quando o
#      AppNext aceita (a tela abre em "Ativos": produto desativado também mexeu no estoque do passado).
# Nada é clicado além de abrir a tela: nunca Salvar, Concluir nem Homologar.
import json
import os
import re
import sys
import traceback
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

os.environ.setdefault("SAIDA_ARQUIVO", str(Path.cwd() / "_nao_usado.xlsx"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import nextsoft_export_to_drive as nx  # noqa: E402
import nextsoft_compras as ncomp  # noqa: E402
import nextsoft_caixa as ncx  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

log, step = nx.log, nx.step
HASH = "#/estoque/extrato-estoque"
PESSOAL = re.compile(r"usuario|usuário|operador|login|e-?mail|cpf|cnpj|cliente|telefone|celular|senha|token|responsavel|responsável|parceiro", re.I)
# parâmetros do pedido que não são dado pessoal nem id: o valor aparece no diagnóstico
PARAM_OK = re.compile(r"^(situacao|ordenarPor|ordenarDirecao|pagina|tamanhoPagina|tipoMovimento)$")
BLOCO_DIAS = 28  # o AppNext recusa período maior que 31 dias
DATA_PARAM = re.compile(r"data|date|inicio|início|fim|de$|ate$|periodo", re.I)
MAX_ITENS = 300_000
TAM_PAGINA = 200


def blocos(desde: str, ate: str, dias: int = BLOCO_DIAS):
    """[(ini, fim)] em AAAA-MM-DD, de desde até ate, cada um com no máximo `dias` dias"""
    d0, d1 = date.fromisoformat(desde), date.fromisoformat(ate)
    out = []
    while d0 <= d1:
        fim = min(d1, d0 + timedelta(days=dias - 1))
        out.append((d0.isoformat(), fim.isoformat()))
        d0 = fim + timedelta(days=1)
    return out


def resumir(x):
    """um movimento do extrato, só com o que a reconstrução usa (sem parceiro nem ids de pessoa)"""
    return {"d": x.get("dataHora"), "t": x.get("tipoMovimento"), "o": x.get("origem"), "n": x.get("numeroDocumento"),
            "c": x.get("codigoProduto"), "p": x.get("nomeProduto"), "q": x.get("quantidade"), "dt": x.get("documentoOrigemTipo")}


def com_params(url, **troca):
    p = urlsplit(url)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    for k, v in troca.items():
        if v is None:
            q.pop(k, None)
        else:
            q[k] = v
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q), p.fragment))


def ler_bloco(page, url, cab):
    """todas as páginas de um bloco → (itens, totalLinhas)"""
    itens, total = [], None
    for pag in range(1, 500):
        j = ncomp.pedir_json(page, com_params(url, pagina=str(pag), tamanhoPagina=str(TAM_PAGINA)), cab)
        lote = lista_de(j) or []
        if isinstance(j, dict) and isinstance(j.get("totalLinhas"), int):
            total = j["totalLinhas"]
        itens.extend(lote)
        if not lote or len(lote) < TAM_PAGINA or (total is not None and len(itens) >= total):
            break
    return itens, total


def limpar(v, prof=0):
    """tira campos pessoais e encurta textos (diagnóstico e movimentos)"""
    if prof > 6:
        return None
    if isinstance(v, dict):
        return {k: limpar(x, prof + 1) for k, x in v.items() if not PESSOAL.search(str(k))}
    if isinstance(v, list):
        return [limpar(x, prof + 1) for x in v[:50]] if prof else [limpar(x, prof + 1) for x in v]
    if isinstance(v, str):
        return v[:120]
    return v


def lista_de(j):
    """a lista de registros de uma resposta (a própria lista ou o primeiro campo que é lista de objetos)"""
    if isinstance(j, list):
        return j
    if isinstance(j, dict):
        for k in ("items", "itens", "data", "dados", "content", "registros", "result", "resultado", "lista"):
            if isinstance(j.get(k), list):
                return j[k]
        for v in j.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
    return None


def chaves(x, prof=0):
    if isinstance(x, dict) and prof < 3:
        return {k: chaves(v, prof + 1) for k, v in x.items() if not PESSOAL.search(str(k))}
    if isinstance(x, list):
        return [chaves(x[0], prof + 1)] if x else []
    return type(x).__name__


def gravar(caminho, dados):
    destino = Path(caminho)
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_name(f"{destino.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    os.chmod(tmp, 0o640)
    tmp.replace(destino)


def main():
    saida = os.getenv("SAIDA_EXTRATO", "").strip()
    saida_diag = os.getenv("SAIDA_EXTRATO_DIAG", "").strip()
    desde = (os.getenv("EXTRATO_DESDE") or "2025-06-01").strip()
    if not saida or not saida_diag or not re.match(r"^\d{4}-\d{2}-\d{2}$", desde):
        print("ERRO: defina SAIDA_EXTRATO, SAIDA_EXTRATO_DIAG e EXTRATO_DESDE (AAAA-MM-DD)")
        return 2
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "1500")))
    pasta_pw = Path.cwd() / "pw_state"
    nx.limpar_locks_perfil(pasta_pw)
    diag = {"em": datetime.now(nx._TZ_LOG).isoformat(), "desde": desde, "pedidos": [], "texto_tela": "", "campos_tela": [], "lista": None, "erro": None}
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(pasta_pw), headless=True, ignore_https_errors=nx.INSEGURO, viewport={"width": 1600, "height": 950},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_default_timeout(30_000)
        respostas = []

        def on_resp(r):
            try:
                if r.request.resource_type in ("xhr", "fetch") and "appnext" in r.url and len(respostas) < 40:
                    respostas.append(r)
            except Exception:  # noqa: BLE001
                pass

        try:
            step("1) Login")
            nx.goto_login_with_retries(page, nx.LOGIN_URL)
            ncx.fazer_login(page)
            nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            nx.garantir_loja(page)
            step("2) Estoque → Extrato de estoque (só abrir a tela)")
            page.on("response", on_resp)
            page.evaluate("() => { location.hash = '#/vendas/fechamentospdv'; }")
            page.wait_for_timeout(1500)
            respostas.clear()
            page.evaluate(f"() => {{ location.hash = '{HASH}'; }}")
            page.wait_for_timeout(9000)
            diag["texto_tela"] = page.evaluate("() => document.body.innerText.slice(0, 2500)")
            diag["campos_tela"] = page.evaluate("""() => [...document.querySelectorAll('input, select, label, button')].slice(0, 80)
              .map((e) => [e.tagName.toLowerCase(), e.getAttribute('placeholder') || e.getAttribute('aria-label') || e.getAttribute('name') || (e.innerText || '').trim().slice(0, 60), e.type || ''])""")
            modelo = None
            for r in respostas:
                p = urlsplit(r.url)
                q = parse_qsl(p.query, keep_blank_values=True)
                info = {"caminho": p.path, "parametros": {k: (v if DATA_PARAM.search(k) or PARAM_OK.match(k) else "…") for k, v in q}, "status": r.status}
                try:
                    j = r.json()
                    lst = lista_de(j)
                    info["formato"] = chaves(j)
                    if lst:
                        info["n_itens"] = len(lst)
                        info["amostra"] = limpar(lst[:2])
                    tem_periodo = any(DATA_PARAM.search(k) for k, _ in q)
                    if lst is not None and tem_periodo and modelo is None:
                        modelo = r
                except Exception:  # noqa: BLE001
                    info["formato"] = "não é JSON"
                diag["pedidos"].append(info)
            log(f"{len(diag['pedidos'])} pedidos da tela registrados no diagnóstico")

            if modelo is not None:
                cab = {k: v for k, v in modelo.request.headers.items() if k.lower() not in ("content-length", "host", "cookie", "accept-encoding")}
                hoje = date.today().isoformat()
                partes = blocos(desde, hoje)
                step(f"3) Movimentos de {desde} até hoje: {len(partes)} blocos de até {BLOCO_DIAS} dias (o mesmo pedido da tela)")
                # situação do produto: "todos" quando o AppNext aceita (fica a opção que traz mais linhas no 1º bloco)
                ini0, fim0 = partes[0]
                base0 = ncx.trocar_periodo(modelo.url, ini0, fim0)
                escolha, melhor = None, -1
                for rot, val in (("como a tela", "__igual__"), ("sem situação", None), ("Todos", "Todos"), ("todos", "todos"), ("0", "0")):
                    try:
                        u = base0 if val == "__igual__" else com_params(base0, situacao=val)
                        j = ncomp.pedir_json(page, com_params(u, pagina="1", tamanhoPagina="1"), cab)
                        n = j.get("totalLinhas") if isinstance(j, dict) else None
                    except Exception as e:  # noqa: BLE001
                        n = None
                        log(f"situação {rot}: recusada ({str(e)[:80]})")
                    if isinstance(n, int) and n > melhor:
                        escolha, melhor = (rot, val), n
                diag["situacao"] = {"usada": escolha[0] if escolha else "como a tela", "linhas_1o_bloco": melhor}
                val = escolha[1] if escolha else "__igual__"
                itens, conf = [], []
                for ini, fim in partes:
                    u = ncx.trocar_periodo(modelo.url, ini, fim)
                    if val != "__igual__":
                        u = com_params(u, situacao=val)
                    lote, total = ler_bloco(page, u, cab)
                    itens.extend(resumir(x) for x in lote)
                    conf.append({"de": ini, "ate": fim, "lidos": len(lote), "total": total})
                    log(f"  {ini} a {fim}: {len(lote)} movimentos" + (f" de {total}" if total is not None and total != len(lote) else ""))
                    if len(itens) > MAX_ITENS:
                        raise RuntimeError(f"Mais de {MAX_ITENS} movimentos: parei para não encher a VPS.")
                faltando = [c for c in conf if c["total"] is not None and c["lidos"] != c["total"]]
                gravar(saida, {"em": datetime.now(nx._TZ_LOG).isoformat(), "desde": desde, "ate": hoje, "caminho": urlsplit(modelo.url).path,
                               "situacao": diag["situacao"]["usada"], "blocos": conf, "completo": not faltando, "itens": itens})
                diag["lista"] = {"caminho": urlsplit(modelo.url).path, "itens": len(itens), "blocos": len(conf), "incompletos": faltando[:10]}
                log(f"Extrato: {len(itens)} movimentos em {len(conf)} blocos guardados → {Path(saida).name}" + (f" · {len(faltando)} blocos incompletos" if faltando else ""))
            else:
                log("A tela não chamou uma lista com período: o diagnóstico mostra o que ela pede (talvez escolher um produto).")
            gravar(saida_diag, diag)
            return 0
        except Exception as e:  # noqa: BLE001
            diag["erro"] = str(e).splitlines()[0][:300]
            try:
                gravar(saida_diag, diag)
            except Exception:  # noqa: BLE001
                pass
            log("### ERRO NO EXTRATO DE ESTOQUE ###")
            print(traceback.format_exc())
            return 1
        finally:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    sys.exit(main())
