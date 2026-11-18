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
    tmp = Path(f"{SAIDA}.{os.getpid()}.tmp")
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_text(json.dumps({**res, "em": datetime.now().astimezone().isoformat()}, ensure_ascii=False), encoding="utf-8")
    os.chmod(tmp, 0o640)
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
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ZERO = '00000000-0000-0000-0000-000000000000';
  const ehGuid = (v) => typeof v === 'string' && v.trim() !== ZERO && GUID.test(v.trim());
  const ler = (o, ...ks) => {
    if (!o || typeof o !== 'object') return undefined;
    const alvos = ks.map((c) => c.toLowerCase()), achou = Object.keys(o).find((x) => alvos.includes(x.toLowerCase()));
    return achou !== undefined ? o[achou] : undefined;
  };
  if (!S.chaveAcesso) erro('a nota de entrada não tem chave de acesso no AppNext');
  // guarda os dados de modalidade da BC do ICMS da nota de entrada (id ou código XML em itemImposto) antes que a regra sobrescreva
  const modEntrada = new Map();
  for (const i of S.itens) {
    const cod = String(i.codigo).toUpperCase(), imp = i.imposto || i.Imposto || {}, itImp = i.itemImposto || i.ItemImposto || {};
    const idDir = [ler(imp, 'modalidadeDeterminacaoBcIcmsId'), imp.modalidadeDeterminacaoBcIcms && imp.modalidadeDeterminacaoBcIcms.id,
      ler(itImp, 'modalidadeDeterminacaoBcIcmsId'), itImp.modalidadeDeterminacaoBcIcms && itImp.modalidadeDeterminacaoBcIcms.id].find(ehGuid) || null;
    const codMod = [ler(itImp, 'modalidadeDeterminacaoBcIcmsCodigo'), ler(imp, 'modalidadeDeterminacaoBcIcmsCodigo'),
      imp.modalidadeDeterminacaoBcIcms && imp.modalidadeDeterminacaoBcIcms.codigo, itImp.modalidadeDeterminacaoBcIcms && itImp.modalidadeDeterminacaoBcIcms.codigo]
      .find((v) => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== ZERO);
    if (!modEntrada.has(cod)) modEntrada.set(cod, { id: idDir ? idDir.trim() : null, codigo: codMod != null ? String(codMod).trim() : null });
  }
  // só os itens da devolução, com as quantidades do painel (1 linha por item pedido e ordem renumerada)
  const pedidos = new Map(p.itens.map((i) => [String(i.codigo).toUpperCase(), i]));
  const escolhidos = [];
  for (const [cod, i] of pedidos) {
    const cands = S.itens.filter((x) => String(x.codigo).toUpperCase() === cod);
    if (!cands.length) erro(`o item ${i.codigo} não está nesta nota no AppNext`);
    const it = cands.find((x) => i.qtd <= Number(x.quantidade) + 1e-9) || cands[0];
    if (i.qtd > Number(it.quantidade) + 1e-9) erro(`o item ${i.codigo} tem ${it.quantidade} na nota e a devolução pede ${i.qtd}`);
    escolhidos.push(it);
  }
  S.itens.splice(0, S.itens.length, ...escolhidos);
  // nova quantidade: o valor bruto e os rateios (frete, seguro, despesas, desconto) da nota de entrada vão na proporção
  S.itens.forEach((it, idx) => {
    const novo = pedidos.get(String(it.codigo).toUpperCase()).qtd, orig = Number(it.quantidade) || novo, f = novo / orig;
    const r2 = (v) => Math.round((Number(v) || 0) * f * 100) / 100;
    tela.$set(it, 'ordem', idx + 1);
    tela.$set(it, 'quantidade', novo);
    tela.$set(it, 'valorTotalBruto', Math.round(novo * Number(it.valorUnitario) * 100) / 100);
    for (const k of ['valorDescontoProporcionalPedido', 'valorDescontoProporcional', 'valorFreteProporcional', 'valorSeguroProporcional', 'valorDespesasAcessoriasProporcional']) if (k in it) tela.$set(it, k, r2(it[k]));
    const desc = Number(it.valorDescontoProporcional ?? it.valorDescontoProporcionalPedido) || 0;
    tela.$set(it, 'valorTotalLiquido', Math.round((it.valorTotalBruto - desc) * 100) / 100);
  });
  // lista oficial de modalidades da BC do ICMS: na tela de devolução ela fica no FacilitadorProduto (onSubmitProduct) ou no endpoint fiscal
  let listaMod = [];
  const fp = acha('onSubmitProduct');
  for (let k = 0; k < 12; k++) {
    const cand = (fp && fp.selectList && fp.selectList.modalidadesDeterminacaoBcICMS) || sl.modalidadesDeterminacaoBcICMS || [];
    if (Array.isArray(cand) && cand.length) { listaMod = cand; break; }
    await espera(250);
  }
  if (!listaMod.length && typeof tela.getRequest === 'function') {
    const urlMod = (tela.$store && tela.$store.state && tela.$store.state.fiscal && tela.$store.state.fiscal.modalidade_determinacao_bc_icms && tela.$store.state.fiscal.modalidade_determinacao_bc_icms.get) || '/api/v1/fiscal/modalidade-determinacao-bc-icms';
    try { const rMod = await tela.getRequest(urlMod, '?desativado=false'); if (Array.isArray(rMod)) listaMod = rMod; } catch (e) { /* ok */ }
  }
  listaMod = listaMod.filter((x) => x && ehGuid(x.id));
  const acharModCod = (cod) => {
    if (cod == null || cod === '') return null;
    const s = String(cod).trim(), norm = /^\\d+$/.test(s) ? String(Number(s)) : s.toLowerCase();
    return listaMod.find((m) => m.codigo != null && (String(m.codigo).trim() === s || (/^\\d+$/.test(String(m.codigo).trim()) ? String(Number(m.codigo)) : String(m.codigo).trim().toLowerCase()) === norm)) || null;
  };
  const mod3 = acharModCod('3') || listaMod.find((m) => /valor da opera/i.test(String(m.descricao || ''))) || listaMod[0] || null;
  // endereço do parceiro (principal/padrão, se houver; senão o primeiro)
  const forn = acha('carregarEnderecosParceiro');
  for (let k = 0; k < 40 && forn && (forn.carregandoEnderecos || !forn.enderecosParceiro.length); k++) await espera(250);
  if (forn && forn.enderecosParceiro.length) {
    const ends = forn.enderecosParceiro;
    if (!ehGuid(S.enderecoId) || !ends.some((e) => String(e.id) === String(S.enderecoId))) set('enderecoId', (ends.find((e) => e.principal || e.padrao) || ends[0]).id);
    await espera(200);
    if (typeof forn.sincronizarEnderecoReferencia === 'function') forn.sincronizarEnderecoReferencia();
  }
  if (!ehGuid(S.enderecoId)) erro('o parceiro não tem endereço no AppNext para escolher');
  // motivo [19] e CFOP da regra fiscal de devolução (sem duplicar CFOP quando há mais de uma sequência com o mesmo CFOP)
  const m19 = (sl.motivosMovimentacao || []).find((x) => String(x.codigo) === '19') || erro('motivo [19] Devolução ao Fornecedor não existe');
  set('motivoMovimentacaoId', m19.id); await espera(800);
  const seqsMotivo = (sl.sequenciasFiscais || []).filter((e) => e && e.motivoMovimentacao && e.motivoMovimentacao.id === m19.id && e.cfop && ehGuid(e.cfop.id));
  const cfopsUnicos = [...new Map(seqsMotivo.map((s) => [s.cfop.id, s.cfop])).values()];
  sl.cfops = cfopsUnicos.length ? cfopsUnicos : (tela.buscarSequenciafiscalPorMotivoMovimentacao(m19.id) || []);
  const cfops = [...new Map((sl.cfops || []).filter((c) => c && ehGuid(c.id)).map((c) => [c.id, c])).values()];
  if (!cfops.length) erro('não há regra fiscal (sequência) de Devolução ao Fornecedor nesta loja no AppNext');
  let cfopEscolhido = cfops[0];
  if (cfops.length > 1) {
    const c5 = cfops.filter((c) => String(c.codigo).startsWith('5')), c6 = cfops.filter((c) => String(c.codigo).startsWith('6'));
    const ufEnd = String((((forn && forn.enderecoSelecionado && forn.enderecoSelecionado.cidade) || (S.enderecoReferencia && S.enderecoReferencia.cidade) || {}).uf) || '').toUpperCase();
    const ufLoja = String((((tela.lojaAtual && tela.lojaAtual.endereco && tela.lojaAtual.endereco.cidade) || {}).uf) || (tela.lojaAtual && tela.lojaAtual.uf) || '').toUpperCase();
    if (cfops.length === 2 && c5.length === 1 && c6.length === 1 && ufEnd && ufLoja) cfopEscolhido = ufEnd === ufLoja ? c5[0] : c6[0];
    else erro(`há ${cfops.length} CFOPs de devolução nesta loja (${cfops.map((c) => c.codigo).join(', ')}); faça esta nota à mão`);
  }
  // resolve a modalidade da BC do ICMS de cada item (1º regra fiscal, 2º nota de entrada por id ou código XML, 3º [3] Valor da operação)
  const seqsCfop = seqsMotivo.filter((s) => s.cfop.id === cfopEscolhido.id);
  const modAlvo = new Map();
  for (const it of S.itens) {
    const cod = String(it.codigo).toUpperCase();
    const seqProd = seqsCfop.find((s) => (s.produtosLoja || []).some((pr) => pr.id === it.produtoId)) || seqsCfop[0] || null;
    const modRegra = seqProd && seqProd.modalidadeDeterminacaoBcIcms && ehGuid(seqProd.modalidadeDeterminacaoBcIcms.id) ? seqProd.modalidadeDeterminacaoBcIcms : null;
    const orig = modEntrada.get(cod) || {};
    const modOrigId = orig.id && (!listaMod.length || listaMod.some((m) => String(m.id) === orig.id)) ? (listaMod.find((m) => String(m.id) === orig.id) || { id: orig.id }) : null;
    const modOrigCod = !modOrigId && orig.codigo != null ? acharModCod(orig.codigo) : null;
    if (modRegra) modAlvo.set(cod, { id: modRegra.id.trim(), obj: modRegra, fonte: 'da regra fiscal', daRegra: true });
    else if (modOrigId) modAlvo.set(cod, { id: modOrigId.id.trim(), obj: modOrigId, fonte: 'da nota de entrada', daRegra: false });
    else if (modOrigCod) modAlvo.set(cod, { id: modOrigCod.id.trim(), obj: modOrigCod, fonte: `[${modOrigCod.codigo}] da nota de entrada`, daRegra: false });
    else if (mod3) modAlvo.set(cod, { id: mod3.id.trim(), obj: mod3, fonte: `[${mod3.codigo ?? 3}] valor da operação`, daRegra: false });
  }
  // se a sequência fiscal da loja não tiver modalidade da BC, preenche na sequência em memória para o calcularProdutos já enviar o Guid certo
  const modPadraoSeq = ([...modAlvo.values()][0] && [...modAlvo.values()][0].obj) || mod3;
  if (modPadraoSeq) {
    for (const sq of (sl.sequenciasFiscais || [])) {
      if (sq && sq.cfop && sq.cfop.id === cfopEscolhido.id && !(sq.modalidadeDeterminacaoBcIcms && ehGuid(sq.modalidadeDeterminacaoBcIcms.id))) {
        sq.modalidadeDeterminacaoBcIcms = modPadraoSeq;
      }
    }
  }
  // zera cfopId anterior para esperar de verdade todas as chamadas assíncronas de calcularProdutos terminarem
  if (S.cfopId === cfopEscolhido.id) { set('cfopId', null); await espera(100); }
  for (const it of S.itens) if (it.imposto) it.imposto.cfopId = null;
  set('cfopId', cfopEscolhido.id);
  for (let k = 0; k < 60 && S.itens.some((i) => !i.produtosSequencia || !(i.imposto && i.imposto.cfopId === cfopEscolhido.id)); k++) await espera(250);
  if (S.itens.some((i) => !i.produtosSequencia)) erro('algum item não tem a regra fiscal de devolução');
  if (S.itens.some((i) => !(i.imposto && i.imposto.cfopId === cfopEscolhido.id))) erro('o AppNext não terminou de calcular os impostos dos itens da devolução');
  await espera(400);
  const serie = (sl.serieNfe || []).find((x) => x.descricao === 'NF-e') || erro('série "NF-e" não existe');
  const dn = tela.$refs.tabs && tela.$refs.tabs.$refs.dadosNota;
  if (dn) { dn.serie = serie.id; await espera(250); }
  if (!S.serie) set('serie', String(serie.serie));
  if (!S.modeloNFe) set('modeloNFe', String(serie.modelo));
  if (!S.numeroNota && serie.proximoNumero != null) set('numeroNota', String(serie.proximoNumero));
  const fin4 = (sl.finalidades || []).find((x) => Number(x.codigo) === 4);
  if (!ehGuid(S.finalidadeId) && fin4 && ehGuid(fin4.id)) set('finalidadeId', fin4.id);
  if (S.tipoFinalidadeId !== null) set('tipoFinalidadeId', null);
  const tf = (sl.tiposFrete || []).find((x) => String(x.codigo) === '9') || erro('tipo de frete [9] não existe');
  const mf = (sl.modalidadesFrete || []).find((x) => String(x.codigo) === '9') || erro('modalidade de frete [9] não existe');
  set('tipoFreteId', tf.id); set('modalidadeFreteId', mf.id);
  if (!S.revisado) set('usuarioConclusaoId', null);
  // data de emissão da saída: sempre hoje (a tela traz a data da nota de entrada)
  const hj = new Date(), hoje = `${hj.getFullYear()}-${String(hj.getMonth() + 1).padStart(2, '0')}-${String(hj.getDate()).padStart(2, '0')}`;
  const datas = Object.keys(S).filter((k) => /^data/i.test(k) && /emiss|saida/i.test(k));
  for (const k of datas) set(k, typeof S[k] === 'string' && /^\\d{4}-\\d{2}-\\d{2}/.test(S[k]) ? hoje + S[k].slice(10) : hoje);
  const modLog = [];
  const garantirModalidades = (logar) => {
    for (const it of S.itens) {
      if (!it.imposto) continue;
      const alvo = modAlvo.get(String(it.codigo).toUpperCase());
      if (alvo && ehGuid(alvo.id) && (!ehGuid(it.imposto.modalidadeDeterminacaoBcIcmsId) || (!alvo.daRegra && it.imposto.modalidadeDeterminacaoBcIcmsId !== alvo.id))) {
        tela.$set(it.imposto, 'modalidadeDeterminacaoBcIcmsId', alvo.id);
      }
      if (logar) {
        if (ehGuid(it.imposto.modalidadeDeterminacaoBcIcmsId)) modLog.push(`${it.codigo}: ${alvo ? alvo.fonte : 'preenchida'}`);
        else modLog.push(`${it.codigo}: sem modalidade (listaMod=${listaMod.length})`);
      }
    }
  };
  garantirModalidades(true);
  await espera(300);
  // totais da nota: aguarda a resposta do AppNext e reaplica a modalidade (AtualizaItens recria it.imposto)
  let erroTotais = null;
  for (let k = 0; k < 3; k++) {
    try {
      await tela.CalculaValoresTotaisMovimento({ lojaId: tela.lojaAtual.id, parceiroId: S.parceiroId, valorDesconto: S.valorDesconto || 0, valorFrete: S.valorFrete || 0,
        valorSeguro: S.valorSeguro || 0, valorDespesasAcessorias: S.valorDespesasAcessorias || 0, modalidadeFreteId: S.modalidadeFreteId, itens: S.itens });
      erroTotais = null; break;
    } catch (e) { erroTotais = String(e.message || e); await espera(1500); }
  }
  if (erroTotais) erro('o AppNext não recalculou os totais da nota: ' + erroTotais.slice(0, 150));
  garantirModalidades(false);
  await espera(300);
  if (tela.lojaAtual.id !== S.lojaId) erro('a loja aberta no AppNext não é a da nota de entrada');
  // campos opcionais *Id que não são Guid válido ("" , Guid zerado, número ou objeto) viram o id válido ou null (sem apagar Guid obrigatório)
  const trocados = [], jaLogou = new Set();
  const limparObj = (o, onde) => {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (/Id$/i.test(k) && v != null && !ehGuid(v)) {
        const g = v && typeof v === 'object' && ehGuid(v.id) ? v.id.trim() : null;
        const ch = onde + k;
        if (!jaLogou.has(ch)) { jaLogou.add(ch); trocados.push(`${ch}=${typeof v === 'object' ? 'objeto' : JSON.stringify(v).slice(0, 20)}→${g ? 'id' : 'null'}`); }
        o[k] = g;
      }
    }
  };
  const sanitizar = () => {
    garantirModalidades(false);
    limparObj(S, '');
    S.itens.forEach((it, n) => { limparObj(it, `itens[${n}].`); if (it.imposto) limparObj(it.imposto, `itens[${n}].imposto.`); });
    return trocados;
  };
  sanitizar();
  window.__limparIds = sanitizar; // reaplica logo antes de formCadastrar()
  const idsFaltando = [];
  for (const k of ['lojaId', 'parceiroId', 'enderecoId', 'motivoMovimentacaoId', 'cfopId', 'finalidadeId', 'tipoFreteId', 'modalidadeFreteId']) if (!ehGuid(S[k])) idsFaltando.push(k);
  S.itens.forEach((it, n) => {
    if (!ehGuid(it.produtoId)) idsFaltando.push(`itens[${n}].produtoId`);
    const imp = it.imposto || {};
    for (const k of ['cfopId', 'icmsId', 'icmsOrigemId', 'pisId', 'cofinsId', 'ipiId', 'modalidadeDeterminacaoBcIcmsId']) if (!ehGuid(imp[k])) idsFaltando.push(`itens[${n}].imposto.${k}`);
  });
  const t = tela.$refs.tabs; const invalida = ['validarDadosNota', 'validarDadosFornecedor', 'validarProdutos', 'validarTransportadora', 'validarValoresAdicionais'].filter((k) => t[k] && t[k]());
  return { modLog, datas: datas.length ? datas.map((k) => `${k}=${String(S[k]).slice(0, 10)}`) : ['campo não encontrado: ' + Object.keys(S).filter((k) => /^data/i.test(k)).join(', ')], trocados, idsFaltando, invalida, cfop: cfopEscolhido.codigo, chaveRef: String(S.chaveAcesso || ''), total: Number(S.valorTotalLiquido), produtos: Number(S.valorTotalProduto), itens: S.itens.map((i) => ({ codigo: String(i.codigo), nome: i.nome || '', qtd: Number(i.quantidade), preco: Number(i.valorUnitario), total: Number(i.valorTotalLiquido) })) };
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
    estado = (
        "() => { const r=[...document.querySelectorAll('*')].find(e=>e.__vue__); if(!r) return null;"
        " const f=[r.__vue__.$root]; while(f.length){const x=f.shift();"
        " if(x.$options.methods&&x.$options.methods.montarDevolucao){ const sl=x.selectList||{};"
        " return { pronta: !!x.devolucao, itens: ((x.saida||{}).itens||[]).length,"
        " regras: (sl.sequenciasFiscais||[]).length, motivos: (sl.motivosMovimentacao||[]).length,"
        " series: (sl.serieNfe||[]).length, finalidades: (sl.finalidades||[]).length,"
        " fretes: Math.min((sl.tiposFrete||[]).length, (sl.modalidadesFrete||[]).length) }; }"
        " f.push(...(x.$children||[]));} return null; }"
    )
    st = None
    for k in range(60):
        page.wait_for_timeout(1000)
        st = page.evaluate(estado)
        if st and (st["pronta"] or k >= 20) and st["itens"] and st["motivos"] and st["series"] and st["finalidades"] and st["fretes"] and (st["regras"] or k >= 15):
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
    log(f"   data de emissão: {', '.join(r.get('datas') or [])} · modalidade da BC do ICMS: {'; '.join(r.get('modLog') or []) or 'já preenchida'}")
    if r.get("trocados"):
        log("   campos de id corrigidos: " + ", ".join(r["trocados"][:20]))
    step("4) Conferindo")
    erros = []
    if r["invalida"]:
        erros.append("o AppNext acusou campo obrigatório faltando (" + ", ".join(r["invalida"]) + ")")
    if r.get("idsFaltando"):
        erros.append("campos fiscais sem Guid válido (" + ", ".join(r["idsFaltando"][:8]) + ")")
    esp = {str(i["codigo"]).upper(): float(i["qtd"]) for i in pedido["itens"]}
    if len(r["itens"]) != len(esp):
        erros.append(f"a nota ficou com {len(r['itens'])} itens e a devolução tem {len(esp)}")
    for i in r["itens"]:
        q = esp.get(i["codigo"].upper())
        ok = q is not None and abs(i["qtd"] - q) < 0.0005
        log(f"   {'✓' if ok else '✗'} {i['codigo']} {i['nome'][:40]}: {i['qtd']:g} × R$ {i['preco']:.2f} = R$ {i['total']:.2f}")
        if not ok:
            erros.append(f"item {i['codigo']} com quantidade diferente")
    # produtos da nota = soma de quantidade × valor unitário; o total pode ser maior pelos impostos por fora (IPI, ST)
    soma = round(sum(i["qtd"] * i["preco"] for i in r["itens"]), 2)
    prod = r.get("produtos") or 0
    log(f"   produtos: R$ {prod:.2f} (soma dos itens: R$ {soma:.2f}) · total da nota com impostos: R$ {r['total']:.2f}")
    if abs(prod - soma) > 0.05:
        erros.append(f"o valor dos produtos da nota (R$ {prod:.2f}) não bate com a soma dos itens (R$ {soma:.2f}): o AppNext não recalculou")
    elif not (soma - 0.05 <= r["total"] <= soma * 1.6 + 0.05):
        erros.append(f"o total da nota (R$ {r['total']:.2f}) está fora do esperado para R$ {soma:.2f} em produtos")
    if erros:
        raise RuntimeError("conferência falhou, nada foi salvo: " + "; ".join(erros[:6]))
    log("   ✓ tudo confere")
    if SIMULAR or pedido.get("simular"):
        log("   TESTE: parei antes de salvar (nada foi salvo no AppNext)")
        gravar({"ok": True, "simulado": True, "nota": r})
        return 0
    step("5) Salvar SEM concluir (a loja confere, conclui e transmite no AppNext)")
    # na 1ª etapa da tela, formCadastrar grava com revisado = falso (não concluída)
    resp = {}
    def ao_responder(rr):
        if rr.request.method == "POST" and "saida" in rr.url.lower():
            try:
                resp.update({"status": rr.status, "corpo": rr.text()[:500]})
            except Exception:  # noqa: BLE001
                resp.update({"status": rr.status})
    page.on("response", ao_responder)
    page.evaluate("() => { const r=[...document.querySelectorAll('*')].find(e=>e.__vue__); const f=[r.__vue__.$root]; while(f.length){const x=f.shift(); if(x.$options.methods&&x.$options.methods.montarDevolucao){ if (x.wizardStepSaida !== 1) throw new Error('a tela não está na 1ª etapa'); if (window.__limparIds) window.__limparIds(); x.formCadastrar(); return true; } f.push(...(x.$children||[]));} return false; }")
    ok = False
    for _ in range(60):
        page.wait_for_timeout(1000)
        if page.locator("text=/cadastrada com sucesso/i").count() or "/saida-devolucao/" not in page.url:
            ok = True
            break
    avisos = page.evaluate("() => [...document.querySelectorAll('.toast, .toasted, .swal2-popup, .notification, .vue-notification, .alert, .iziToast, [role=alert]')].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 5)")
    if resp:
        log(f"   resposta do AppNext: HTTP {resp.get('status')} {resp.get('corpo', '')[:300]}")
    for a in avisos:
        log("   aviso na tela: " + a.replace("\n", " ")[:300])
    if not ok:
        detalhe = f": {avisos[0][:200]}" if avisos else (f" (HTTP {resp.get('status')} {resp.get('corpo', '')[:200]})".rstrip() if resp else "")
        raise RuntimeError("o AppNext não confirmou a gravação da devolução" + detalhe)
    log("   ✓ o AppNext gravou a saída de devolução (não concluída)")
    if (resp and resp.get("corpo")):
        m_id = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", str(resp["corpo"]), re.I)
        if m_id and m_id.group(0) != "00000000-0000-0000-0000-000000000000":
            r["saidaId"] = m_id.group(0)
    log(f"Concluído em {(datetime.now() - t0).seconds} s")
    gravar({"ok": True, "nota": r})
    return 0


def main():
    nx.start_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "600")))
    pedido = json.loads(Path(ENTRADA).read_text(encoding="utf-8")) if ACAO != "cadastros" else None
    pasta_pw = Path.cwd() / "pw_state"
    nx.limpar_locks_perfil(pasta_pw)
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(pasta_pw), headless=True, accept_downloads=False, ignore_https_errors=nx.INSEGURO,
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
