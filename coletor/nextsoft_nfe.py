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
import re
import sys
import traceback
from datetime import datetime
from pathlib import Path

ACAO = os.getenv("ACAO", "").strip()
ENTRADA = os.getenv("ENTRADA_NFE", "").strip()
SAIDA = os.getenv("SAIDA_RESULTADO", "").strip()
SIMULAR = os.getenv("SIMULAR", "") == "1"
if ACAO not in ("cadastros", "rascunho", "devolucao") or not SAIDA or (ACAO != "cadastros" and not ENTRADA):
    print("ERRO: defina ACAO (cadastros|rascunho|devolucao), SAIDA_RESULTADO e, no rascunho/devolução, ENTRADA_NFE")
    sys.exit(2)
os.environ.setdefault("SAIDA_ARQUIVO", str(Path.cwd() / "_nao_usado.xlsx"))

import nextsoft_export_to_drive as nx  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

log = nx.log
ROTA = "#/estoque/saida-produto/cadastrar"


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
    // produtos: a lista da JANELA de produto (a da tela não traz os chás em pacote, ex.: Valeriana Garden 100G)
    produtos: ((acha('onSubmitProduct') || {}).selectList || {}).produtos.filter(ativo).map((x) => ({ id: x.id, codigo: String(x.codigo ?? ''), nome: x.nome || '', preco: Number(x.precoVenda) || 0,
      un: typeof x.unidadeMedida === 'string' ? x.unidadeMedida : (x.unidadeMedida && (x.unidadeMedida.sigla || x.unidadeMedida.nome)) || '' })),
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
    const prod = (acha('onSubmitProduct').selectList.produtos || []).find((x) => x.id === it.produtoId) || erro(`produto ${it.codigo} não encontrado no AppNext`);
    acha('abrirNovoItem').abrirNovoItem(); await espera(1200);
    const f = acha('onSubmitProduct');
    // as regras fiscais (sequências) chegam do AppNext depois que a janela abre: espera antes de escolher o produto
    for (let k = 0; k < 60 && !((f.selectList.sequenciasFiscal || []).length); k++) await espera(250);
    if (!(f.selectList.sequenciasFiscal || []).length) erro('o AppNext não carregou as regras fiscais (sequências) na janela do produto');
    f.$set(f.item, 'produtoId', prod.id);
    for (let k = 0; k < 40 && !f.item.sequenciaFiscalId; k++) await espera(250);
    if (!f.item.sequenciaFiscalId) {
      // a janela não escolheu sozinha: a regra de Venda que inclui o produto (a mesma que o AppNext procura)
      const seq = (f.selectList.sequenciasFiscal || []).find((q) => q.motivoMovimentacao && q.motivoMovimentacao.id === motivo.id && (q.produtosLoja || []).some((e) => e.id === prod.id));
      if (seq) { f.$set(f.item, 'sequenciaFiscalId', seq.id); for (let k = 0; k < 20 && !(f.item.imposto && f.item.imposto.cfopId); k++) await espera(250); }
    }
    await espera(800);
    f.$set(f.item, 'quantidade', it.qtd); await espera(500);
    if (it.preco != null) { f.$set(f.item, 'valorUnitario', it.preco); await espera(500); }
    f.$set(f.item, 'vendedorId', vend.id); await espera(500);
    if (!f.item.sequenciaFiscalId) erro(`o produto ${prod.codigo} (${prod.nome}) não tem regra fiscal de Venda no AppNext: cadastre a sequência fiscal dele ou faça esta nota à mão`);
    if (!(f.item.imposto && f.item.imposto.cfopId)) erro(`o AppNext não preencheu os impostos do produto ${prod.codigo}`);
    f.nextStep(); await espera(1200); f.nextStep(); await espera(1200);
    if (f.wizardStep !== 3) erro(`a janela do produto ${prod.codigo} não chegou ao resumo (passo ${f.wizardStep})`);
    const antes = S.itens.length;
    await f.onSubmitProduct(); await espera(1200);
    if (S.itens.length !== antes + 1) erro(`o produto ${prod.codigo} não entrou na nota`);
  }
  // fecha a janela do produto (se ficar aberta, ela cobre o botão Rascunho)
  for (let k = 0; k < 20 && document.querySelector('#facilitadorProdutos.show, .modal.show'); k++) {
    const m = document.querySelector('#facilitadorProdutos.show, .modal.show');
    const x = m && m.querySelector('[data-dismiss="modal"], button.close, .btn-close, button[aria-label="Close"], button[aria-label="Fechar"]');
    if (x) x.click(); else { try { window.jQuery && window.jQuery(m).modal('hide'); } catch (e) { /* ok */ } m.classList.remove('show'); m.style.display = 'none'; document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove()); document.body.classList.remove('modal-open'); }
    await espera(400);
  }
  await tela.calcularTotais(); await espera(800);
  const invalida = acha('validaCampos').validaCampos(); // true = tem erro em alguma aba
  return {
    invalida, parceiro: parc.nome, doc: String(parc.cnpjCpf || ''), consumidorFinal: S.consumidorFinal, vendedor: vend.nome, pagamento: pag.descricao,
    total: Number(S.valorTotalLiquido), itens: S.itens.map((i) => { const pr = (acha('onSubmitProduct').selectList.produtos || []).find((x) => x.id === i.produtoId) || {}; return { produtoId: i.produtoId, codigo: String(pr.codigo ?? ''), nome: pr.nome || '', qtd: Number(i.quantidade), preco: Number(i.valorUnitario), total: Number(i.valorTotalBruto ?? i.valorTotal ?? 0) }; }),
  };
}"""


# devolução: a tela do AppNext abre a partir da nota de ENTRADA já com fornecedor, chave e TODOS os itens;
# o robô deixa só os itens da devolução com as quantidades do painel, põe o motivo [19], o CFOP da regra fiscal
# de devolução, a série NF-e e frete [9]/[9] (sem pagamento e sem vendedor) e o AppNext recalcula os impostos.
DEVOLVER = "async (p) => {" + JS_BASE.replace("acha('salvarRascunho')", "acha('montarDevolucao')") + """
  const sl = tela.selectList, S = tela.saida, set = (k, v) => tela.$set(S, k, v);
  const erro = (t) => { throw new Error(t); };
  if (!S.chaveAcesso) erro('a nota de entrada não tem chave de acesso no AppNext');
  // só os itens da devolução, com as quantidades do painel
  const pedidos = new Map(p.itens.map((i) => [String(i.codigo).toUpperCase(), i]));
  const naNota = new Map(S.itens.map((i) => [String(i.codigo).toUpperCase(), i]));
  for (const [cod, i] of pedidos) {
    const it = naNota.get(cod) || erro(`o item ${i.codigo} não está nesta nota no AppNext`);
    if (i.qtd > Number(it.quantidade) + 1e-9) erro(`o item ${i.codigo} tem ${it.quantidade} na nota e a devolução pede ${i.qtd}`);
  }
  S.itens.splice(0, S.itens.length, ...S.itens.filter((i) => pedidos.has(String(i.codigo).toUpperCase())));
  for (const it of S.itens) tela.$set(it, 'quantidade', pedidos.get(String(it.codigo).toUpperCase()).qtd);
  const m19 = (sl.motivosMovimentacao || []).find((x) => String(x.codigo) === '19') || erro('motivo [19] Devolução ao Fornecedor não existe');
  set('motivoMovimentacaoId', m19.id); await espera(1500);
  if (!(sl.cfops || []).length) sl.cfops = tela.buscarSequenciafiscalPorMotivoMovimentacao(m19.id);
  const cfops = sl.cfops || [];
  if (!cfops.length) erro('não há regra fiscal (sequência) de Devolução ao Fornecedor nesta loja no AppNext');
  if (cfops.length > 1) erro(`há ${cfops.length} CFOPs de devolução nesta loja (${cfops.map((c) => c.codigo).join(', ')}); faça esta nota à mão`);
  set('cfopId', cfops[0].id); // a tela põe a regra em cada item e recalcula os impostos
  for (let k = 0; k < 40 && S.itens.some((i) => !i.produtosSequencia || !(i.imposto && i.imposto.cfopId)); k++) await espera(250);
  if (S.itens.some((i) => !i.produtosSequencia)) erro('algum item não tem a regra fiscal de devolução');
  await espera(2500); // o cálculo dos impostos de cada item vem do AppNext
  const serie = (sl.serieNfe || []).find((x) => x.descricao === 'NF-e') || erro('série "NF-e" não existe');
  const dn = tela.$refs.tabs && tela.$refs.tabs.$refs.dadosNota; if (dn) dn.serie = serie.id;
  if (!S.serie) { set('serie', String(serie.serie)); set('modeloNFe', String(serie.modelo)); }
  const tf = (sl.tiposFrete || []).find((x) => String(x.codigo) === '9') || erro('tipo de frete [9] não existe');
  const mf = (sl.modalidadesFrete || []).find((x) => String(x.codigo) === '9') || erro('modalidade de frete [9] não existe');
  set('tipoFreteId', tf.id); set('modalidadeFreteId', mf.id);
  const forn = acha('carregarEnderecosParceiro');
  for (let k = 0; k < 40 && forn && (forn.carregandoEnderecos || !forn.enderecosParceiro.length); k++) await espera(250);
  if (!S.enderecoId && forn && forn.enderecosParceiro.length === 1) set('enderecoId', forn.enderecosParceiro[0].id);
  await espera(800);
  await tela.calcularTotais(); await espera(800);
  const t = tela.$refs.tabs; const invalida = ['validarDadosNota', 'validarDadosFornecedor', 'validarProdutos', 'validarTransportadora', 'validarValoresAdicionais'].filter((k) => t[k] && t[k]());
  return { invalida, cfop: cfops[0].codigo, chaveRef: String(S.chaveAcesso || ''), total: Number(S.valorTotalLiquido), itens: S.itens.map((i) => ({ codigo: String(i.codigo), nome: i.nome || '', qtd: Number(i.quantidade), preco: Number(i.valorUnitario), total: Number(i.valorTotalLiquido) })) };
}"""


def abrir_tela(page):
    page.evaluate(f"() => {{ location.hash = '{ROTA}'; }}")
    for _ in range(60):
        page.wait_for_timeout(1000)
        if page.evaluate(ACHA, "salvarRascunho") and page.evaluate("() => { const r=[...document.querySelectorAll('*')].find(e=>e.__vue__); const f=[r.__vue__.$root]; while(f.length){const x=f.shift(); if(x.$options.methods&&x.$options.methods.salvarRascunho) return !!(x.selectList&&x.selectList.produtos&&x.selectList.produtos.length); f.push(...(x.$children||[]));} return false; }") and page.evaluate("() => { const r=[...document.querySelectorAll('*')].find(e=>e.__vue__); const f=[r.__vue__.$root]; while(f.length){const x=f.shift(); if(x.$options.methods&&x.$options.methods.onSubmitProduct) return !!(x.selectList&&x.selectList.produtos&&x.selectList.produtos.length); f.push(...(x.$children||[]));} return false; }"):
            return
    raise RuntimeError("a tela de Saída de Produtos não carregou")


def devolucao(page, pedido, t0):
    step("2) Entrada da nota → Devolução (o AppNext preenche fornecedor, chave e itens)")
    if not re.match(r"^[0-9a-f-]{36}$", str(pedido.get("entradaId", ""))):
        raise RuntimeError("a nota de entrada não tem o id do AppNext")
    page.evaluate("() => { location.hash = '#/estoque/entrada-produto'; }")
    page.wait_for_timeout(3000)
    page.evaluate(f"() => {{ location.hash = '#/estoque/saida-devolucao/devolucao/{pedido['entradaId']}'; }}")
    estado = "() => { const r=[...document.querySelectorAll('*')].find(e=>e.__vue__); if(!r) return null; const f=[r.__vue__.$root]; while(f.length){const x=f.shift(); if(x.$options.methods&&x.$options.methods.montarDevolucao){ const sl=x.selectList||{}; return { itens: ((x.saida||{}).itens||[]).length, regras: (sl.sequenciasFiscais||[]).length, motivos: (sl.motivosMovimentacao||[]).length }; } f.push(...(x.$children||[]));} return null; }"
    st = None
    for k in range(60):
        page.wait_for_timeout(1000)
        st = page.evaluate(estado)
        if st and st["itens"] and st["motivos"] and (st["regras"] or k >= 15):
            break
    log(f"   situação da tela: {st}")
    if not st or not st["itens"]:
        raise RuntimeError("a tela de devolução não carregou a nota de entrada")
    if not st["regras"]:
        # a tela busca as regras fiscais de devolução DA LOJA (devolucao=true): esta loja não tem nenhuma
        raise RuntimeError("esta loja não tem regra fiscal (sequência fiscal) de Devolução ao Fornecedor no AppNext: cadastre uma (motivo [19], CFOP 5202/6202, marcada para devolução, com os produtos), como a da Vila Madalena, e tente de novo")
    log("   ✓ nota de entrada carregada na devolução")
    step(f"3) Deixando só os {len(pedido['itens'])} itens da devolução e preenchendo")
    r = page.evaluate(DEVOLVER, pedido)
    log(f"   CFOP {r['cfop']} · série NF-e · frete [9]/[9] · sem pagamento e sem vendedor")
    step("4) Conferindo")
    erros = []
    if r["invalida"]:
        erros.append("o AppNext acusou campo obrigatório faltando (" + ", ".join(r["invalida"]) + ")")
    esp = {str(i["codigo"]).upper(): float(i["qtd"]) for i in pedido["itens"]}
    if len(r["itens"]) != len(esp):
        erros.append(f"a nota ficou com {len(r['itens'])} itens e a devolução tem {len(esp)}")
    for i in r["itens"]:
        q = esp.get(i["codigo"].upper())
        ok = q is not None and abs(i["qtd"] - q) < 0.0005
        log(f"   {'✓' if ok else '✗'} {i['codigo']} {i['nome'][:40]}: {i['qtd']:g} × R$ {i['preco']:.2f} = R$ {i['total']:.2f}")
        if not ok:
            erros.append(f"item {i['codigo']} com quantidade diferente")
    log(f"   total da nota: R$ {r['total']:.2f}")
    if erros:
        raise RuntimeError("conferência falhou, nada foi salvo: " + "; ".join(erros[:6]))
    log("   ✓ tudo confere")
    if SIMULAR or pedido.get("simular"):
        log("   TESTE: parei antes de salvar (nada foi salvo no AppNext)")
        gravar({"ok": True, "simulado": True, "nota": r})
        return 0
    step("5) Salvar SEM concluir (a loja confere, conclui e transmite no AppNext)")
    # na 1ª etapa da tela, formCadastrar grava com revisado = falso (não concluída)
    page.evaluate("() => { const r=[...document.querySelectorAll('*')].find(e=>e.__vue__); const f=[r.__vue__.$root]; while(f.length){const x=f.shift(); if(x.$options.methods&&x.$options.methods.montarDevolucao){ if (x.wizardStepSaida !== 1) throw new Error('a tela não está na 1ª etapa'); x.formCadastrar(); return true; } f.push(...(x.$children||[]));} return false; }")
    ok = False
    for _ in range(60):
        page.wait_for_timeout(1000)
        if page.locator("text=/cadastrada com sucesso/i").count() or "/saida-devolucao/" not in page.url:
            ok = True
            break
    if not ok:
        raise RuntimeError("o AppNext não confirmou a gravação da devolução")
    log("   ✓ o AppNext gravou a saída de devolução (não concluída)")
    log(f"Concluído em {(datetime.now() - t0).seconds} s")
    gravar({"ok": True, "nota": r})
    return 0


def main():
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "600")))
    pedido = json.loads(Path(ENTRADA).read_text(encoding="utf-8")) if ACAO != "cadastros" else None
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
            abrir_login(page)
            fazer_login(page)
            log("   ✓ login feito")
            nx.trocar_loja(page, os.getenv("APPNEXT_LOJA_DESTINO"))
            log(f"   ✓ loja: {os.getenv('APPNEXT_LOJA_DESTINO') or 'a padrão do usuário'}")
            if ACAO == "devolucao":
                return devolucao(page, pedido, t0)
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
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
            # o mesmo que o botão "Rascunho" faz (valida as abas, calcula os totais e grava com revisado = falso)
            page.evaluate("() => { const r=[...document.querySelectorAll('*')].find(e=>e.__vue__); const f=[r.__vue__.$root]; while(f.length){const x=f.shift(); if(x.$options.methods&&x.$options.methods.salvarRascunho){ x.salvarRascunho(); return true; } f.push(...(x.$children||[]));} return false; }")
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
