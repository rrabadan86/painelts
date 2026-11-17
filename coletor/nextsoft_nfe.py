#!/usr/bin/env python3
# NF-e de saída no AppNext (Estoque → Saída de Produtos), em duas ações:
#   ACAO=cadastros  só LÊ a tela: parceiros, vendedores, produtos e formas de pagamento (para o formulário do painel);
#                   de vendedores sai só id/nome/código (nunca login ou senha).
#   ACAO=rascunho   preenche a saída com o que o painel mandou e salva como RASCUNHO (nunca conclui nem transmite):
#                   dados da nota (motivo [1] Venda, CFOP 5102, série NF-e, NF-e normal, pagamento escolhido), parceiro,
#                   consumidor final, endereço, vendedor, frete [9]/[9] e cada produto pela janela do próprio AppNext
#                   (que calcula os impostos). CONFERE produtos, quantidades, preços e total antes de salvar; se algo
#                   não bater, PARA sem salvar.
# Variáveis: APPNEXT_* (como os outros robôs), ACAO, ENTRADA_NFE (.json do pedido), SAIDA_RESULTADO (.json).
# SIMULAR=1 faz tudo menos o clique em Rascunho.
import json
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path

ACAO = os.getenv("ACAO", "").strip()
ENTRADA = os.getenv("ENTRADA_NFE", "").strip()
SAIDA = os.getenv("SAIDA_RESULTADO", "").strip()
SIMULAR = os.getenv("SIMULAR", "") == "1"
if ACAO not in ("cadastros", "rascunho") or not SAIDA or (ACAO == "rascunho" and not ENTRADA):
    print("ERRO: defina ACAO (cadastros|rascunho), SAIDA_RESULTADO e, no rascunho, ENTRADA_NFE")
    sys.exit(2)
os.environ.setdefault("SAIDA_ARQUIVO", str(Path.cwd() / "_nao_usado.xlsx"))

import nextsoft_export_to_drive as nx  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

log = nx.log
ROTA = "#/estoque/saida-produto/cadastrar"


def step(t):
    log("▸ " + t)


def fazer_login(page):
    if "/#/login" in page.url:
        page.fill(nx.SEL["rede"], nx.REDE)
        page.fill(nx.SEL["email"], nx.USER)
        page.fill(nx.SEL["senha"], nx.PASS)
        page.click(nx.SEL["entrar"])
    page.wait_for_url("**/#/loja/**", timeout=120_000)


def gravar(res):
    tmp = Path(SAIDA + ".tmp")
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_text(json.dumps({**res, "em": datetime.now().astimezone().isoformat()}, ensure_ascii=False), encoding="utf-8")
    tmp.replace(SAIDA)


# acha um componente da tela pela árvore do Vue (pelo nome de um método dele)
ACHA = """(m) => {
  const raiz = [...document.querySelectorAll('*')].find((e) => e.__vue__);
  const fila = raiz ? [raiz.__vue__.$root] : [];
  while (fila.length) { const x = fila.shift(); if (x.$options.methods && x.$options.methods[m]) return true; fila.push(...(x.$children || [])); }
  return false;
}"""
JS_BASE = """
const acha = (m) => { const raiz = [...document.querySelectorAll('*')].find((e) => e.__vue__); const fila = raiz ? [raiz.__vue__.$root] : [];
  while (fila.length) { const x = fila.shift(); if (x.$options.methods && x.$options.methods[m]) return x; fila.push(...(x.$children || [])); } return null; };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const tela = acha('salvarRascunho');
"""

LER_CADASTROS = "async () => {" + JS_BASE + """
  const sl = tela.selectList;
  const ativo = (x) => !(x.desativado === true || String(x.desativado).toLowerCase() === 'true');
  return {
    parceiros: (sl.parceiros || []).filter(ativo).map((x) => ({ id: x.id, nome: x.nome || x.apelido || '', doc: String(x.cnpjCpf || ''), consumidorFinal: !!x.tagConsumidorFinal, tipoPessoa: x.tipoPessoa })),
    vendedores: (sl.vendedores || []).filter(ativo).map((x) => ({ id: x.id, nome: x.nome || '', codigo: x.codigo })),
    produtos: (sl.produtos || []).filter(ativo).map((x) => ({ id: x.id, codigo: String(x.codigo ?? ''), nome: x.nome || '', preco: Number(x.precoVenda) || 0, un: x.unidadeMedida && (x.unidadeMedida.sigla || x.unidadeMedida.nome) || '' })),
    pagamentos: (sl.formasPagamento || []).map((x) => ({ codigo: String(x.codigo), descricao: x.descricao })),
  };
}"""

# preenche a nota (sem salvar) e devolve o que ficou na tela para conferir
PREENCHER = "async (p) => {" + JS_BASE + """
  const sl = tela.selectList, S = tela.saida, set = (k, v) => tela.$set(S, k, v);
  const cod = (arr, c) => (arr || []).find((x) => String(x.codigo) === String(c));
  const erro = (t) => { throw new Error(t); };
  const motivo = cod(sl.motivosMovimentacao, 1) || erro('motivo [1] Venda não existe nesta loja');
  const cfop = cod(sl.cfops, '5102') || erro('CFOP 5102 não existe nesta loja');
  const pag = cod(sl.formasPagamento, p.pagamento) || erro(`forma de pagamento [${p.pagamento}] não existe nesta loja`);
  const fin = cod(sl.finalidades, 1) || erro('finalidade NF-e normal não existe');
  const serie = (sl.serieNfe || []).find((x) => x.descricao === 'NF-e') || erro('série "NF-e" não existe');
  const tf = cod(sl.tiposFrete, 9) || erro('tipo de frete [9] não existe'), mf = cod(sl.modalidadesFrete, 9) || erro('modalidade de frete [9] não existe');
  const parc = (sl.parceiros || []).find((x) => x.id === p.parceiroId) || erro('parceiro não encontrado no AppNext');
  const vend = (sl.vendedores || []).find((x) => x.id === p.vendedorId) || erro('vendedor não encontrado no AppNext');
  set('motivoMovimentacaoId', motivo.id); set('cfopId', cfop.id); set('formaPagamentoId', pag.id); set('finalidadeId', fin.id);
  acha('sincronizarSerieSelecionada').serie = serie.id;
  set('vendedorId', vend.id); set('tipoFreteId', tf.id); set('modalidadeFreteId', mf.id);
  set('parceiroId', parc.id); set('consumidorFinal', !!p.consumidorFinal);
  // endereço: o padrão do parceiro; sem padrão e com um só, esse
  const forn = acha('carregarEnderecosParceiro');
  for (let k = 0; k < 40 && (forn.carregandoEnderecos || !forn.enderecosParceiro.length); k++) await espera(250);
  if (!S.enderecoId && forn.enderecosParceiro.length === 1) set('enderecoId', forn.enderecosParceiro[0].id);
  if (!S.enderecoId) erro(forn.enderecosParceiro.length ? 'o parceiro tem mais de um endereço e nenhum é o padrão' : 'o parceiro não tem endereço cadastrado');
  await espera(500);
  // produtos: pela janela do AppNext (ela calcula os impostos de cada item)
  for (const it of p.itens) {
    const prod = (sl.produtos || []).find((x) => x.id === it.produtoId) || erro(`produto ${it.codigo} não encontrado no AppNext`);
    acha('abrirNovoItem').abrirNovoItem(); await espera(1200);
    const f = acha('onSubmitProduct');
    f.$set(f.item, 'produtoId', prod.id); await espera(2000);
    f.$set(f.item, 'quantidade', it.qtd); await espera(500);
    if (it.preco != null) { f.$set(f.item, 'valorUnitario', it.preco); await espera(500); }
    f.$set(f.item, 'vendedorId', vend.id); await espera(500);
    if (!f.item.sequenciaFiscalId) erro(`o AppNext não achou a regra fiscal do produto ${prod.codigo}`);
    f.nextStep(); await espera(1200); f.nextStep(); await espera(1200);
    if (f.wizardStep !== 3) erro(`a janela do produto ${prod.codigo} não chegou ao resumo (passo ${f.wizardStep})`);
    const antes = S.itens.length;
    await f.onSubmitProduct(); await espera(1200);
    if (S.itens.length !== antes + 1) erro(`o produto ${prod.codigo} não entrou na nota`);
  }
  try { window.jQuery && window.jQuery('.modal.show').modal('hide'); } catch (e) { /* ok */ }
  await tela.calcularTotais(); await espera(800);
  const invalida = acha('validaCampos').validaCampos(); // true = tem erro em alguma aba
  return {
    invalida, parceiro: parc.nome, doc: String(parc.cnpjCpf || ''), consumidorFinal: S.consumidorFinal, vendedor: vend.nome, pagamento: pag.descricao,
    total: Number(S.valorTotalLiquido), itens: S.itens.map((i) => { const pr = (sl.produtos || []).find((x) => x.id === i.produtoId) || {}; return { produtoId: i.produtoId, codigo: String(pr.codigo ?? ''), nome: pr.nome || '', qtd: Number(i.quantidade), preco: Number(i.valorUnitario), total: Number(i.valorTotalBruto ?? i.valorTotal ?? 0) }; }),
  };
}"""


def abrir_tela(page):
    page.evaluate(f"() => {{ location.hash = '{ROTA}'; }}")
    for _ in range(60):
        page.wait_for_timeout(1000)
        if page.evaluate(ACHA, "salvarRascunho") and page.evaluate("() => { const r=[...document.querySelectorAll('*')].find(e=>e.__vue__); const f=[r.__vue__.$root]; while(f.length){const x=f.shift(); if(x.$options.methods&&x.$options.methods.salvarRascunho) return !!(x.selectList&&x.selectList.produtos&&x.selectList.produtos.length); f.push(...(x.$children||[]));} return false; }"):
            return
    raise RuntimeError("a tela de Saída de Produtos não carregou")


def main():
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "600")))
    pedido = json.loads(Path(ENTRADA).read_text(encoding="utf-8")) if ACAO == "rascunho" else None
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(Path.cwd() / "pw_state"), headless=True, accept_downloads=False, ignore_https_errors=True,
            viewport={"width": 1600, "height": 950},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_default_timeout(30_000)
        page.set_default_navigation_timeout(60_000)
        page.on("dialog", lambda d: d.dismiss())
        try:
            t0 = datetime.now()
            step("1) Login")
            nx.goto_login_with_retries(page, nx.LOGIN_URL)
            fazer_login(page)
            log("   ✓ login feito")
            nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            log(f"   ✓ loja: {os.getenv('APPNEXT_LOJA_DESTINO') or 'a padrão do usuário'}")
            step("2) Estoque → Saída de Produtos → Nova")
            abrir_tela(page)
            log("   ✓ tela aberta")
            if ACAO == "cadastros":
                step("3) Lendo parceiros, vendedores, produtos e formas de pagamento (nada é alterado)")
                c = page.evaluate(LER_CADASTROS)
                log(f"   ✓ {len(c['parceiros'])} parceiros · {len(c['vendedores'])} vendedores · {len(c['produtos'])} produtos · {len(c['pagamentos'])} formas de pagamento")
                gravar({"ok": True, "cadastros": c})
                return 0
            step(f"3) Preenchendo a nota ({len(pedido['itens'])} produtos)")
            r = page.evaluate(PREENCHER, pedido)
            log(f"   parceiro: {r['parceiro']} · consumidor final: {'sim' if r['consumidorFinal'] else 'não'} · vendedor: {r['vendedor']} · pagamento: {r['pagamento']}")
            step("4) Conferindo o que ficou na nota")
            erros = []
            if r["invalida"]:
                erros.append("o AppNext acusou campo obrigatório faltando")
            if len(r["itens"]) != len(pedido["itens"]):
                erros.append(f"a nota ficou com {len(r['itens'])} produtos e o painel mandou {len(pedido['itens'])}")
            for esp, lido in zip(pedido["itens"], r["itens"]):
                ok = lido["produtoId"] == esp["produtoId"] and abs(lido["qtd"] - esp["qtd"]) < 0.0005 and (esp.get("preco") is None or abs(lido["preco"] - esp["preco"]) < 0.005)
                log(f"   {'✓' if ok else '✗'} {lido['codigo']} {lido['nome'][:40]}: {lido['qtd']:g} × R$ {lido['preco']:.2f}")
                if not ok:
                    erros.append(f"produto {esp.get('codigo')} diferente do pedido")
            esperado = pedido.get("total")
            log(f"   total da nota: R$ {r['total']:.2f}" + (f" · painel: R$ {esperado:.2f}" if esperado is not None else ""))
            if esperado is not None and abs(r["total"] - esperado) > 0.01 * max(1, len(r["itens"])):
                erros.append(f"total R$ {r['total']:.2f} diferente do painel (R$ {esperado:.2f})")
            if erros:
                raise RuntimeError("conferência falhou, nada foi salvo: " + "; ".join(erros[:6]))
            log("   ✓ tudo confere")
            if SIMULAR or pedido.get("simular"):
                log("   TESTE: parei antes do Rascunho (nada foi salvo no AppNext)")
                gravar({"ok": True, "simulado": True, "nota": r})
                return 0
            step("5) Salvar como RASCUNHO (não conclui nem transmite)")
            page.locator("button:has-text('Rascunho') >> visible=true").last.click()
            ok = False
            for _ in range(60):
                page.wait_for_timeout(1000)
                if page.locator("text=/salva como rascunho/i").count() or "/cadastrar" not in page.url:
                    ok = True
                    break
            if not ok:
                raise RuntimeError("o AppNext não confirmou o rascunho")
            log("   ✓ o AppNext confirmou: saída salva como rascunho")
            log(f"Concluído em {(datetime.now() - t0).seconds} s")
            gravar({"ok": True, "nota": r})
            return 0
        except Exception as e:  # noqa: BLE001
            log("### ERRO NO ROBÔ DA NF-e ###")
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
