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

log = nx.log


def step(t):
    log("▸ " + t)


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

# componente da tela de importação (Vue): o que o AppNext leu do arquivo e em que passo está
LER_VM = """() => {
  // procura a tela pela árvore do Vue (depois de ler o arquivo, o campo de arquivo some da tela)
  const raiz = [...document.querySelectorAll('*')].find((e) => e.__vue__);
  let v = null;
  const fila = raiz ? [raiz.__vue__.$root] : [];
  while (fila.length && !v) {
    const x = fila.shift();
    if (x.$options.methods && x.$options.methods.importarExcel) v = x; else fila.push(...(x.$children || []));
  }
  if (!v) return null;
  const itens = ((v.inventario && v.inventario.itens) || []).map((i) => ({
    cod: String(i.codigo ?? i.codigoProduto ?? i.cod ?? ''),
    desc: String(i.nome ?? i.descricao ?? ''),
    qtd: Number(i.quantidade), custo: Number(i.precoCusto), id: i.id }));
  return { passo: v.wizardStep, carregando: !!v.loadingArquivo, erro: v.erroArquivo === true || v.erroArquivo === 'true', itens };
}"""


def gravar(res):
    Path(SAIDA).parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(SAIDA).with_name(f"{Path(SAIDA).name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps({**res, "em": datetime.now().astimezone().isoformat()}, ensure_ascii=False), encoding="utf-8")
    os.chmod(tmp, 0o640)
    tmp.replace(SAIDA)


def clicar_visivel(page, texto):
    b = page.locator(f"button:has-text('{texto}') >> visible=true").last
    b.wait_for(state="visible", timeout=20000)
    b.click()


def main():
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "600")))
    esperado = {str(x["cod"]): float(x["nova"]) for x in json.loads(Path(ESPERADO).read_text(encoding="utf-8"))}
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
            abrir_login(page)
            t0 = datetime.now()
            fazer_login(page)
            log("   ✓ login feito")
            nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            log(f"   ✓ loja: {os.getenv('APPNEXT_LOJA_DESTINO') or 'a padrão do usuário'}")
            step("2) Estoque → Auditoria/Inventário → Importar")
            page.evaluate("() => { location.hash = '#/estoque/inventario/importacao'; }")
            page.locator("input[type=file]").first.wait_for(state="attached", timeout=40000)
            page.wait_for_timeout(1500)
            log("   ✓ tela de importação aberta (passo 1: Selecione o arquivo)")
            step(f"3) Enviando a planilha ({len(esperado)} produtos, {Path(ENTRADA).stat().st_size // 1024 or 1} KB)")
            resp = {}

            def ao_responder(r):
                if "inventario/upload" in r.url:
                    try:
                        corpo = r.text()
                    except Exception:  # noqa: BLE001
                        corpo = ""
                    resp.update({"status": r.status, "corpo": corpo})
            page.on("response", ao_responder)
            page.locator("input[type=file]").first.set_input_files(ENTRADA)
            vm = None
            for _ in range(90):
                page.wait_for_timeout(1000)
                vm = page.evaluate(LER_VM)
                if vm and not vm["carregando"] and (vm["itens"] or vm["erro"]):
                    break
                if resp and (not vm or not vm["carregando"]):
                    page.wait_for_timeout(1500)
                    vm = page.evaluate(LER_VM)
                    break
            # aviso que o AppNext mostrou na tela (fica 10 s) e a resposta da leitura do arquivo
            avisos = page.evaluate("""() => [...document.querySelectorAll('.toast, .toasted, .swal2-popup, .notification, .vue-notification, .alert, .iziToast, [role=alert]')]
                .map((e) => e.innerText.trim()).filter(Boolean).slice(0, 5)""")
            if resp:
                log(f"   resposta do AppNext ao ler o arquivo: HTTP {resp['status']}")
                if resp.get("corpo") and resp["status"] >= 400:
                    log("   " + resp["corpo"][:600].replace("\n", " "))
            else:
                log("   o AppNext não respondeu à leitura do arquivo")
            for a in avisos:
                log("   aviso na tela: " + a.replace("\n", " ")[:300])
            if (not vm or not vm["itens"]) and resp.get("status") == 200:
                try:
                    lr = json.loads(resp.get("corpo") or "[]")
                    if isinstance(lr, list) and lr:
                        log("   (itens conferidos pela resposta do AppNext)")
                        vm = {**(vm or {"passo": 1, "carregando": False, "erro": False}), "itens": [
                            {"cod": str(i.get("codigo") or ""), "desc": str(i.get("nome") or ""), "qtd": float(i.get("quantidade") or 0)} for i in lr]}
                except ValueError:
                    pass
            if not vm or not vm["itens"]:
                motivo = (avisos[0] if avisos else "") or (resp.get("corpo", "")[:200] if resp and resp.get("status", 200) >= 400 else "")
                raise RuntimeError("o AppNext não leu os itens da planilha" + (f": {motivo}" if motivo else (" (recusou o arquivo)" if vm and vm["erro"] else "")))
            lidos = vm["itens"]
            page.remove_listener("response", ao_responder)
            log(f"   ✓ o AppNext leu {len(lidos)} produtos da planilha")
            step("4) Conferindo item a item (código e quantidade)")
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
            for i in lidos[:60]:
                e = esperado.get(i["cod"])
                marca = "✓" if e is not None and abs(i["qtd"] - e) <= 0.0005 else "✗"
                log(f"   {marca} {i['cod'] or '—'} {i['desc'][:45]}: AppNext {i['qtd']:g}" + (f" · painel {e:g}" if e is not None else ""))
            if len(lidos) > 60:
                log(f"   … e mais {len(lidos) - 60} produtos")
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
                log("   ✓ " + ("passo 2: Quantidade dos produtos" if alvo == 2 else "passo 3: Confirmar inventário"))
            if SIMULAR:
                log("   SIMULAR=1: parei antes do Salvar (nada foi gravado)")
                gravar({"ok": True, "simulado": True, "itens": len(lidos)})
                return 0
            step("6) Salvar (grava o inventário no AppNext)")
            alvo_loja = (os.getenv("APPNEXT_LOJA_DESTINO") or "").strip()
            if alvo_loja:
                atual_loja = nx.loja_atual(page)
                if not atual_loja or not nx._confere(atual_loja, alvo_loja):
                    raise RuntimeError(f"topo mudou para '{atual_loja or '?'}' antes de salvar (esperado '{alvo_loja}'); nada foi gravado")
            clicar_visivel(page, "Salvar")
            ok = False
            for _ in range(60):
                page.wait_for_timeout(1000)
                if page.locator("text=/cadastrado com sucesso/i").count() or "/importacao" not in page.url:
                    ok = True
                    break
            if not ok:
                raise RuntimeError("o AppNext não confirmou a gravação (sem a mensagem de sucesso)")
            log("   ✓ o AppNext confirmou: inventário cadastrado com sucesso")
            log(f"Concluído em {(datetime.now() - t0).seconds} s")
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
