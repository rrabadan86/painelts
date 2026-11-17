#!/usr/bin/env python3
# Importa no AppNext a planilha de inventário gerada pelo painel (Estoque → Auditoria/Inventário → Importar):
#   1) envia o arquivo (o AppNext lê e mostra os itens — ainda não grava nada);
#   2) CONFERE item a item o que o AppNext leu com o que o painel mandou (código e quantidade): se algo não bater, PARA;
#   3) Continuar → Continuar → Salvar (aí o inventário é gravado) e espera a mensagem de sucesso.
# Só roda quando alguém do painel clica em "Enviar para o AppNext" e confirma.
# Variáveis: as do script de vendas (APPNEXT_*) + ENTRADA_INVENTARIO (.xlsx), ESPERADO_INVENTARIO (.json [{cod, nova}]),
#            SAIDA_RESULTADO (.json com o resultado). SIMULAR=1 faz tudo menos o Salvar.
import json
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path

ENTRADA = os.getenv("ENTRADA_INVENTARIO", "").strip()
ESPERADO = os.getenv("ESPERADO_INVENTARIO", "").strip()
SAIDA = os.getenv("SAIDA_RESULTADO", "").strip()
SIMULAR = os.getenv("SIMULAR", "") == "1"
if not (ENTRADA and ESPERADO and SAIDA):
    print("ERRO: defina ENTRADA_INVENTARIO, ESPERADO_INVENTARIO e SAIDA_RESULTADO")
    sys.exit(2)
os.environ.setdefault("SAIDA_ARQUIVO", str(Path.cwd() / "_nao_usado.xlsx"))

import nextsoft_export_to_drive as nx  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402
from nextsoft_produtos import fazer_login  # noqa: E402

log, step = nx.log, nx.step

# componente da tela de importação (Vue): o que o AppNext leu do arquivo e em que passo está
LER_VM = """() => {
  let c = document.querySelector('input[type=file]');
  while (c && !c.__vue__) c = c.parentElement;
  let v = c && c.__vue__;
  while (v && !(v.$options.methods && v.$options.methods.importarExcel)) v = v.$parent;
  if (!v) return null;
  const itens = ((v.inventario && v.inventario.itens) || []).map((i) => ({
    cod: String(i.codigo ?? i.codigoProduto ?? i.cod ?? (i.produto && (i.produto.codigo ?? i.produto.cod)) ?? ''),
    desc: String(i.descricao ?? i.produto ?? (i.produto && i.produto.descricao) ?? ''),
    qtd: Number(i.quantidade), custo: Number(i.precoCusto), id: i.id }));
  return { passo: v.wizardStep, carregando: !!v.loadingArquivo, erro: v.erroArquivo === true || v.erroArquivo === 'true', itens };
}"""


def gravar(res):
    Path(SAIDA).parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(SAIDA).with_suffix(".tmp")
    tmp.write_text(json.dumps({**res, "em": datetime.now().astimezone().isoformat()}, ensure_ascii=False), encoding="utf-8")
    tmp.replace(SAIDA)


def clicar_visivel(page, texto):
    b = page.locator(f"button:has-text('{texto}') >> visible=true").last
    b.wait_for(state="visible", timeout=20000)
    b.click()


def main():
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "600")))
    esperado = {str(x["cod"]): float(x["nova"]) for x in json.loads(Path(ESPERADO).read_text(encoding="utf-8"))}
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(Path.cwd() / "pw_state"), headless=True, accept_downloads=True, ignore_https_errors=True,
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
            step("2) Estoque → Auditoria/Inventário → Importar")
            page.evaluate("() => { location.hash = '#/estoque/inventario/importacao'; }")
            page.locator("input[type=file]").first.wait_for(state="attached", timeout=40000)
            page.wait_for_timeout(1500)
            step(f"3) Enviando a planilha ({len(esperado)} produtos)")
            page.locator("input[type=file]").first.set_input_files(ENTRADA)
            vm = None
            for _ in range(90):
                page.wait_for_timeout(1000)
                vm = page.evaluate(LER_VM)
                if vm and not vm["carregando"] and (vm["itens"] or vm["erro"]):
                    break
            if not vm or not vm["itens"]:
                raise RuntimeError("o AppNext não leu os itens da planilha" + (" (recusou o arquivo)" if vm and vm["erro"] else ""))
            step("4) Conferindo o que o AppNext leu")
            lidos = vm["itens"]
            com_cod = [i for i in lidos if i["cod"]]
            erros = []
            if len(lidos) != len(esperado):
                erros.append(f"o AppNext leu {len(lidos)} produtos e o painel mandou {len(esperado)}")
            if len(com_cod) == len(lidos):
                for i in lidos:
                    if i["cod"] not in esperado:
                        erros.append(f"código {i['cod']} não estava na planilha")
                    elif abs(i["qtd"] - esperado[i["cod"]]) > 0.0005:
                        erros.append(f"{i['cod']} {i['desc'][:40]}: AppNext leu {i['qtd']} e o painel mandou {esperado[i['cod']]}")
            else:  # a tela não mostra o código: confere as quantidades em conjunto
                if sorted(round(i["qtd"], 3) for i in lidos) != sorted(round(v, 3) for v in esperado.values()):
                    erros.append("as quantidades lidas pelo AppNext não batem com as da planilha")
            if erros:
                raise RuntimeError("conferência falhou, nada foi gravado: " + "; ".join(erros[:8]))
            log(f"   ✓ {len(lidos)} produtos conferidos (código e quantidade)")
            step("5) Continuar → Continuar")
            for alvo in (2, 3):
                clicar_visivel(page, "Continuar")
                for _ in range(20):
                    page.wait_for_timeout(500)
                    vm = page.evaluate(LER_VM)
                    if vm and vm["passo"] >= alvo:
                        break
                if not vm or vm["passo"] < alvo:
                    raise RuntimeError(f"a tela não passou para o passo {alvo}")
            if SIMULAR:
                log("   SIMULAR=1: parei antes do Salvar (nada foi gravado)")
                gravar({"ok": True, "simulado": True, "itens": len(lidos)})
                return 0
            step("6) Salvar (grava o inventário no AppNext)")
            clicar_visivel(page, "Salvar")
            ok = False
            for _ in range(60):
                page.wait_for_timeout(1000)
                if page.locator("text=/cadastrado com sucesso/i").count() or "/importacao" not in page.url:
                    ok = True
                    break
            if not ok:
                raise RuntimeError("o AppNext não confirmou a gravação (sem a mensagem de sucesso)")
            log("   ✓ inventário gravado no AppNext")
            gravar({"ok": True, "itens": len(lidos)})
            return 0
        except Exception as e:  # noqa: BLE001
            log("### ERRO NA IMPORTAÇÃO DO INVENTÁRIO ###")
            print(traceback.format_exc())
            gravar({"ok": False, "erro": str(e).splitlines()[0][:400]})
            return 1
        finally:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    sys.exit(main())
