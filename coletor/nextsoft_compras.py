#!/usr/bin/env python3
# Notas de entrada (compras) do AppNext: Estoque → Entrada de Produtos.
# Grava em SAIDA_COMPRAS (JSON) cada nota concluída com os itens (código, quantidade e custo unitário),
# para o painel montar o histórico de custo desde a primeira compra.
#
# Fluxo (só leitura, nada é alterado no AppNext):
#   1) Login e troca de loja (mesmas funções do script de vendas)
#   2) Abre Estoque → Entrada de Produtos: a tela pede a lista de notas à API do AppNext
#   3) Esse pedido (com o login dele) é repetido com o período desde COMPRAS_DESDE até hoje
#   4) Para cada nota nova, pede o detalhe (itens com quantidade e valor); notas já guardadas não são baixadas de novo
#
# Custo unitário = valor líquido do item ÷ quantidade (inclui IPI, igual ao "custo último" do AppNext).
# Chás chegam em kg (1 unidade = 1 kg, mesmo código da matéria-prima).
# Variáveis: as mesmas do script de vendas (APPNEXT_*) + SAIDA_COMPRAS e, opcional, COMPRAS_DESDE (AAAA-MM-DD).
import json
import os
import re
import sys
import traceback
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

SAIDA = os.getenv("SAIDA_COMPRAS", "").strip()
os.environ.setdefault("SAIDA_ARQUIVO", str(Path.cwd() / "_nao_usado.xlsx"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import nextsoft_export_to_drive as nx  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

log, step = nx.log, nx.step
HASH = "#/estoque/entrada-produto"
RE_LISTA = re.compile(r"/api/v\d+/estoque/entrada-produto\?", re.I)
DESDE = (os.getenv("COMPRAS_DESDE") or "2018-01-01").strip()


def fazer_login(page):
    nx.preencher_login(page)  # espera o formulário, recarrega uma vez e diagnostica se não aparecer
    page.wait_for_url("**/#/loja/**", timeout=120_000)


def pedido_referencia(page, pedidos):
    """abre a tela Entrada de Produtos e devolve o pedido da lista que a própria tela fez"""
    for tentativa in range(1, 4):
        try:
            if "/#/login" in page.url:
                log("O AppNext voltou para o login; entrando de novo…")
                fazer_login(page)
                nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            antes = len(pedidos)
            page.evaluate("() => { location.hash = '#/estoque/extrato-estoque'; }")
            page.wait_for_timeout(1500)
            page.evaluate(f"() => {{ location.hash = '{HASH}'; }}")
            for _ in range(30):
                novos = [r for r in pedidos[antes:] if RE_LISTA.search(r.url)]
                if novos:
                    log(f"Tela Entrada de Produtos aberta ({page.url}).")
                    return novos[-1]
                page.wait_for_timeout(1000)
        except Exception as e:  # noqa: BLE001
            log(f"Tentativa {tentativa}: {str(e).splitlines()[0][:200]}")
    texto = page.evaluate("() => document.body.innerText.slice(0, 400)").replace("\n", " | ")
    raise RuntimeError(f"Não vi a lista de notas da tela Entrada de Produtos. Na tela: {texto}")


def trocar_periodo(url, ini: str, fim: str):
    p = urlsplit(url)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    if "dataEmissaoInicial" not in q or "dataEmissaoFinal" not in q:
        raise RuntimeError("O pedido da lista não tem dataEmissaoInicial/dataEmissaoFinal; o AppNext mudou a tela.")
    dt_i = datetime.strptime(ini, "%Y-%m-%d")
    dt_f = datetime.strptime(fim, "%Y-%m-%d")
    q["dataEmissaoInicial"] = nx.para_iso_utc_brt(dt_i, fim=False)
    q["dataEmissaoFinal"] = nx.para_iso_utc_brt(dt_f, fim=True)
    for k in ("tamanhoPagina", "pageSize", "limit", "quantidade"):
        if k in q:
            try:
                if int(q[k]) < 200:
                    q[k] = "200"
            except ValueError:
                pass
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q), p.fragment))


def pedir_json(page, url, cab):
    resp = page.request.get(url, headers=cab, timeout=120_000)
    if not resp.ok:
        try:
            t = re.sub(r"\s+", " ", resp.text())[:300]
        except Exception:  # noqa: BLE001
            t = ""
        raise RuntimeError(f"AppNext respondeu {resp.status} em {urlsplit(url).path}{': ' + t if t else ''}")
    return resp.json()


def pedir_lista_paginada(page, url_base, cab):
    """Percorre páginas da listagem quando a API do AppNext pagina os registros."""
    p = urlsplit(url_base)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    pag_key = next((k for k in ("pagina", "page", "pageNumber") if k in q), None)
    skip_key = "skip" if not pag_key and "skip" in q else None
    tam_key = next((k for k in ("tamanhoPagina", "pageSize", "limit", "length", "take") if k in q), None)
    tam = int(q[tam_key]) if tam_key and str(q[tam_key]).isdigit() else 0
    base_num = int(q[pag_key]) if pag_key and str(q[pag_key]).isdigit() else 1

    vistos, out = set(), []
    for idx in range(50):
        q_cur = dict(q)
        if pag_key:
            q_cur[pag_key] = str(base_num + idx)
        elif skip_key and tam > 0:
            q_cur[skip_key] = str(idx * tam)
        url = urlunsplit((p.scheme, p.netloc, p.path, urlencode(q_cur), p.fragment))
        res = pedir_json(page, url, cab)
        if isinstance(res, list):
            lote, meta = res, {}
        elif isinstance(res, dict):
            meta = res
            lote = res.get("itens") or res.get("items") or next((v for v in res.values() if isinstance(v, list)), [])
        else:
            break
        novos_lote = 0
        for item in lote:
            iid = item.get("id") if isinstance(item, dict) else None
            if iid is not None:
                if iid in vistos:
                    continue
                vistos.add(iid)
            out.append(item)
            novos_lote += 1
        if not (pag_key or (skip_key and tam > 0)) or not lote or novos_lote == 0:
            break
        tot_pags = meta.get("totalPaginas") or meta.get("totalPages")
        tot_regs = meta.get("totalRegistros") or meta.get("totalCount") or meta.get("total")
        if isinstance(tot_pags, int) and (idx + 1) >= tot_pags:
            break
        if isinstance(tot_regs, int) and len(out) >= tot_regs:
            break
        if tam > 0 and len(lote) < tam and not tot_pags and not tot_regs:
            break
    return out


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# desconto da nota (a franquia dá o desconto das devoluções diluído nos itens): os nomes que o AppNext pode usar
CAMPOS_DESC_NOTA = ("valorDesconto", "valorTotalDesconto", "valorDescontoTotal", "totalDesconto", "desconto", "vDesc")
CAMPOS_DESC_ITEM = ("valorDesconto", "valorTotalDesconto", "valorDescontoTotal", "desconto", "vDesc", "descontoValor")
VERSAO_NOTA = 2  # 2 = já tem o desconto
_viu_campos = []


def primeiro_num(d, campos):
    for k in campos:
        if k in d and d.get(k) is not None:
            v = num(d.get(k))
            if v is not None:
                return v
    return None


def nota_de(d):
    forn = d.get("fornecedor") or {}
    itens = []
    if not _viu_campos:  # uma vez por execução: o log mostra onde o AppNext guarda o desconto (para conferir)
        _viu_campos.append(1)
        cn = sorted(k for k in d.keys() if "desc" in k.lower())
        ci = sorted({k for i in (d.get("itens") or [])[:5] for k in i.keys() if "desc" in k.lower()})
        log(f"campos de desconto no AppNext · nota: {', '.join(cn) or 'nenhum'} · itens: {', '.join(ci) or 'nenhum'}")
    for i in d.get("itens") or []:
        q, vl, vb = num(i.get("quantidade")), num(i.get("valorTotalLiquido")), num(i.get("valorTotalBruto"))
        if not q or q <= 0:
            continue
        itens.append({
            "cod": str(i.get("codigo") or "").strip(), "nome": (i.get("nome") or "").strip(), "un": i.get("unidade") or "",
            "qtd": q, "vu": num(i.get("valorUnitario")),
            "custo": round((vl if vl else (vb or 0)) / q, 4), "grupo": i.get("grupoNome") or "",
            "desc": primeiro_num(i, CAMPOS_DESC_ITEM),
        })
    ch = re.sub(r"\D", "", str(d.get("chaveAcesso") or d.get("chaveNfe") or d.get("chave") or ""))
    return {
        "id": d.get("id"), "nf": d.get("numeroNota"), "serie": d.get("serie"),
        "chave": ch if len(ch) == 44 else "",
        "emissao": str(d.get("dataEmissao") or "")[:10], "entrada": str(d.get("dataEntrada") or d.get("dataConclusao") or "")[:10],
        "status": d.get("status"), "motivo": ((d.get("motivoMovimentacao") or {}).get("descricao") or "").strip(),
        "cfop": (d.get("cfop") or {}).get("codigo"),
        "fornecedor": (forn.get("nomeFantasia") or forn.get("razaoSocial") or forn.get("nome") or "").strip(),
        "total": num(d.get("valorTotalLiquido")) or num(d.get("valorTotalNota")), "itens": itens,
        "desconto": primeiro_num(d, CAMPOS_DESC_NOTA), "fornecedorDoc": re.sub(r"\D", "", str(forn.get("cpfCnpj") or forn.get("cnpj") or forn.get("documento") or "")),
        "v": VERSAO_NOTA,
    }


def coletar_compras_na_pagina(page, saida: str, desde: str = None):
    desde = (desde or os.getenv("COMPRAS_DESDE") or "2018-01-01").strip()
    destino = Path(saida)
    try:
        antigo = json.loads(destino.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        antigo = {}
    guardadas = {n["id"]: n for n in antigo.get("notas", []) if n.get("id")}
    pedidos = []
    on_req = lambda r: pedidos.append(r) if r.resource_type in ("xhr", "fetch") and "appnext" in r.url else None
    page.on("request", on_req)
    try:
        nx.garantir_loja(page)
        step("2) Estoque → Entrada de Produtos")
        ref = pedido_referencia(page, pedidos)
        nx.garantir_loja(page)
        cab = {k: v for k, v in ref.headers.items() if k.lower() not in ("content-length", "host", "cookie", "accept-encoding")}

        hoje = datetime.now(nx._TZ_LOG).date().isoformat()
        step(f"3) Lista de notas de {desde} a {hoje}")
        lista = pedir_lista_paginada(page, trocar_periodo(ref.url, desde, hoje), cab)
        concluidas = [x for x in lista if str(x.get("status") or "").lower().startswith("conclu") and x.get("id")]
        log(f"{len(lista)} notas no AppNext, {len(concluidas)} concluídas ({len(guardadas)} já guardadas)")

        step("4) Itens das notas novas")
        base = urlsplit(ref.url)
        notas_por_id = dict(guardadas)
        novas, falhas = 0, 0
        # notas guardadas antes do desconto: baixa de novo as do último ano (uma vez só)
        um_ano = (datetime.now(nx._TZ_LOG).date().replace(day=1) - timedelta(days=365)).isoformat()
        velhas = {}
        for nid, g in list(notas_por_id.items()):
            if g.get("v") != VERSAO_NOTA and (g.get("entrada") or g.get("emissao") or "") >= um_ano:
                velhas[nid] = notas_por_id.pop(nid)
        if velhas:
            log(f"{len(velhas)} nota(s) do último ano baixadas de novo para ler o desconto (só desta vez)")
        for x in concluidas:
            if x["id"] in notas_por_id:
                if not notas_por_id[x["id"]].get("chave"):
                    ch_x = re.sub(r"\D", "", str(x.get("chaveAcesso") or x.get("chaveNfe") or x.get("chave") or ""))
                    if len(ch_x) == 44:
                        notas_por_id[x["id"]]["chave"] = ch_x
                continue
            url = urlunsplit((base.scheme, base.netloc, base.path.rstrip("/") + "/" + x["id"], "", ""))
            try:
                n = nota_de(pedir_json(page, url, cab))
            except Exception as e:  # noqa: BLE001
                falhas += 1
                if x["id"] in velhas:  # não perde a nota guardada se a releitura falhar
                    notas_por_id[x["id"]] = velhas[x["id"]]
                log(f"NF {x.get('numeroNota')}: {str(e)[:200]}")
                if falhas >= 5:
                    raise
                continue
            notas_por_id[n["id"]] = n
            novas += 1
            log(f"NF {n['nf']} ({n['emissao']}, {n['fornecedor'][:30]}): {len(n['itens'])} itens")
        for nid, g in velhas.items():
            notas_por_id.setdefault(nid, g)
        ids_concluidas = {x["id"] for x in concluidas}
        notas = [n for nid, n in notas_por_id.items() if nid in ids_concluidas or nid in guardadas]
        notas.sort(key=lambda n: (n["entrada"] or n["emissao"], n["nf"] or 0))
        destino.parent.mkdir(parents=True, exist_ok=True)
        tmp = destino.with_name(f"{destino.name}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps({"atualizado": datetime.now(nx._TZ_LOG).isoformat(), "desde": desde, "notas": notas}, ensure_ascii=False), encoding="utf-8")
        os.chmod(tmp, 0o640)
        tmp.replace(destino)
        log(f"Compras: {len(notas)} notas ({novas} novas{', ' + str(falhas) + ' com erro' if falhas else ''}) → {destino.name}")
        if falhas and novas == 0:
            raise RuntimeError(f"Falha ao baixar {falhas} nota(s) nova(s) de compra.")
    finally:
        try:
            page.remove_listener("request", on_req)
        except Exception:
            pass


def main():
    saida = os.getenv("SAIDA_COMPRAS", "").strip()
    if not saida:
        print("ERRO: defina SAIDA_COMPRAS")
        return 2
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "900")))
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
        page.set_default_navigation_timeout(60_000)
        try:
            step("1) Login")
            nx.goto_login_with_retries(page, nx.LOGIN_URL)
            fazer_login(page)
            nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            coletar_compras_na_pagina(page, saida)
            return 0
        except Exception:  # noqa: BLE001
            log("### ERRO NAS COMPRAS ###")
            print(traceback.format_exc())
            return 1
        finally:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    sys.exit(main())
