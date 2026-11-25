/* Estoque → Notas fiscais → Saída: NF-e (modelo 55) emitidas pela loja, lidas dos XMLs que o coletor guarda.
   Lista, detalhe com os itens, download do XML original e DANFE para imprimir/salvar em PDF. */
(function () {
  const { h, fmt, state } = TS;

  /** abas Entrada | Saída dentro de Notas fiscais */
  TS.abasNotas = (atual) => h('div', { class: 'nf-abas' }, TS.seg([['Notas de entrada', 'notas'], ['Notas de saída (NF-e emitidas)', 'nfsaida'], ['Créditos com a franquia', 'creditos']], atual, (v) => { location.hash = '#' + v; }));

  const docTxt = (d) => { const s = String(d || ''); return s.length === 14 ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : s.length === 11 ? s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : s; };
  const quando = (iso) => (iso ? fmt.date(iso.slice(0, 10)) + (iso.length > 10 ? ' ' + iso.slice(11, 16) : '') : '—');
  const url = (o, loja, chave) => TS.api(`nfsaida/${o}?loja=${encodeURIComponent(loja)}&chave=${chave}`);
  /** CPF do destinatário que existe nos clientes: clicar abre a ficha */
  const docLink = (d) => {
    if (!d || !d.doc) return '—';
    const temFicha = (d.tipoDoc === 'CPF' || d.tipoDoc === 'CNPJ') && TS.cliApi && TS.cli && TS.cli.porCPF && (TS.cli.porCPF.has(d.doc) || (TS.cli.fxPorCpf && TS.cli.fxPorCpf.has(d.doc)));
    return temFicha ? h('button', { type: 'button', class: 'cpf-link', title: 'Abrir o histórico do cliente', onclick: (e) => { e.stopPropagation(); TS.cliApi.abrirClientes([d.doc]); } }, docTxt(d.doc)) : docTxt(d.doc);
  };
  const situ = (s) => h('span', { class: 'prc-st ' + (s === 'cancelada' ? 'prc-st-n nf-cancelada' : 'prc-st-v') }, s === 'cancelada' ? 'cancelada' : 'autorizada');

  const cache = new Map();
  TS.pages.nfsaida = function (root) {
    if (TS.subEstoque) root.append(TS.subEstoque('nfsaida'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Notas fiscais'),
      h('div', { class: 'page-sub' }, 'Notas de saída: NF-e emitidas pela loja (vendas com nota, transferências, devoluções), com o XML e o DANFE'))));
    root.append(TS.abasNotas('nfsaida'));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'As notas são de cada loja: escolha uma loja no seletor do topo.')); return; }
    const loja = state.loja;
    const corpo = h('div', { class: 'mt nf-saida' }, h('div', { class: 'card' }, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Lendo as notas…')))));
    if (TS.eu?.perfil !== 'vendedor' && !TS.demo) root.append(novaNota(loja));
    root.append(corpo);
    const p = cache.get(loja) || fetch(TS.api(`nfsaida?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || 'Falha ao ler as notas.'); return j; });
    cache.set(loja, p);
    setTimeout(() => cache.delete(loja), 60000); // lista nova a cada minuto (o coletor pode ter trazido notas)
    p.then((j) => {
      if (!corpo.isConnected) return;
      corpo.replaceChildren(lista(loja, j));
      if (state.abrirNFe) { const ch = state.abrirNFe; state.abrirNFe = null; abrir(loja, ch); }
    }).catch((e) => { cache.delete(loja); corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)); });
  };

  // ======================= nova NF-e: rascunho no AppNext pelo robô =======================
  const quandoTZ = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const ESTADO_NFE = { na_fila: ['na fila do robô', 'nfe-st-fila'], ok: ['rascunho salvo no AppNext', 'nfe-st-ok'], teste: ['teste ok: tudo conferiu (nada foi salvo)', 'nfe-st-fila'], erro: ['não foi salvo', 'nfe-st-erro'],
    autorizada: ['NF-e autorizada pela SEFAZ', 'nfe-st-ok nfe-st-aut'], concluida: ['concluída, NÃO transmitida', 'nfe-st-erro'] };
  const ESQ = (x) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  async function nfeApi(metodo, rota, corpo) {
    const r = await fetch(TS.api(rota), { method: metodo, credentials: 'same-origin', headers: metodo === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha.');
    return j;
  }
  function novaNota(loja) {
    const box = h('div', { class: 'mt nfe-box' });
    let aberto = false, info = null, timer = null, esperandoParc = null, avisoPronta = null;
    const form = { parceiro: null, consumidorFinal: false, vendedorId: '', pagamento: '', itens: [], obs: '' };
    /** nota vinda de um orçamento aprovado (Vendas → Orçamento): parceiro pelo CNPJ/CPF, vendedora pelo nome,
     *  pagamento pela forma, produtos pelo código (preço já com os descontos). O que não achar fica listado. */
    function aplicarPronta() {
      const p = TS.nfPronta;
      const cad = info && info.cadastros;
      if (!p || p.loja !== loja || !cad) return;
      TS.nfPronta = null;
      const falta = [];
      const doc = String(p.doc || '').replace(/\D/g, '');
      form.parceiro = doc ? cad.parceiros.find((x) => String(x.doc || '').replace(/\D/g, '') === doc) || null : null;
      if (!form.parceiro) falta.push(`parceiro ${p.nome || ''}${doc ? ' (' + docTxt(doc) + ')' : ''} não está no AppNext: escolha ou cadastre`);
      else form.consumidorFinal = !!form.parceiro.consumidorFinal;
      const vn = ESQ(p.vendedora || '');
      const v = vn ? cad.vendedores.find((x) => ESQ(x.nome) === vn) || cad.vendedores.find((x) => ESQ(x.nome).startsWith(vn.split(' ')[0])) : null;
      form.vendedorId = v ? v.id : '';
      if (p.vendedora && !v) falta.push(`vendedora ${p.vendedora} não achada nos vendedores do AppNext`);
      const PAGS = { pix: /pix/i, boleto: /boleto/i, cartao: /cr[eé]dito|cart/i, dinheiro: /dinheiro/i };
      const pg = cad.pagamentos.find((x) => (PAGS[p.pagamento] || /$^/).test(x.descricao));
      if (pg) form.pagamento = pg.codigo;
      form.itens = [];
      for (const i of p.itens) {
        const x = cad.produtos.find((y) => y.codigo === String(i.cod));
        if (x) form.itens.push({ produtoId: x.id, codigo: x.codigo, nome: x.nome, un: x.un, qtd: i.qtd, preco: Math.round(i.preco * 100) / 100 });
        else falta.push(`produto ${i.nome} (cód. ${i.cod}) não está nos produtos lidos do AppNext`);
      }
      if (p.frete) falta.push(`o frete do orçamento (${fmt.brl(p.frete)}) não entra nos itens: lance no AppNext se precisar`);
      form.obs = p.obs || '';
      aberto = true;
      avisoPronta = { numero: p.numero, falta };
    }
    const carregar = async () => {
      try { info = await nfeApi('GET', `nfe?loja=${encodeURIComponent(loja)}`); } catch (e) { info = { erroGeral: e.message }; }
      if (!box.isConnected) return;
      aplicarPronta();
      pintar();
      const trabalhando = info && ((info.robo && (info.robo.estado === 'na_fila' || info.robo.estado === 'rodando')) || (info.rascunhos || []).some((r) => r.estado === 'na_fila') || (info.parceiros || []).some((r) => r.estado === 'na_fila'));
      // parceiro novo cadastrado pelo robô: já fica escolhido na nota
      if (info && esperandoParc) {
        const r = (info.parceiros || []).find((x) => x.id === esperandoParc);
        if (r && r.estado !== 'na_fila') {
          esperandoParc = null;
          const novo = r.estado === 'ok' && info.cadastros ? info.cadastros.parceiros.find((x) => (r.novoId && x.id === r.novoId) || String(x.doc || '').replace(/\D/g, '') === r.doc) : null;
          if (novo) { form.parceiro = novo; form.consumidorFinal = !!novo.consumidorFinal; pintar(); }
        }
      }
      clearTimeout(timer);
      // nota emitida esperando o XML (o coletor importa logo depois): confere de novo a cada 20 s por até 15 min
      const esperandoXml = info && (info.rascunhos || []).some((r) => r.estado === 'autorizada' && r.nfe && r.nfe.chave && !r.temXml && r.xml === 'pedido' && Date.now() - Date.parse(r.xmlEm || r.fim || r.em) < 15 * 60e3);
      if (trabalhando) timer = setTimeout(carregar, 4000);
      else if (esperandoXml) timer = setTimeout(async () => {
        const antes = new Set((info.rascunhos || []).filter((r) => r.temXml).map((r) => r.id));
        await carregar();
        // o XML chegou: redesenha a tela para a nota entrar também em "Notas de saída" (só se ninguém está montando uma nota)
        if (!aberto && box.isConnected && info && (info.rascunhos || []).some((r) => r.temXml && !antes.has(r.id))) TS.render();
      }, 20000);
    };
    const roboVivo = () => {
      const r = info && info.robo;
      if (!r || (r.estado !== 'na_fila' && r.estado !== 'rodando')) return null;
      return h('div', { class: 'nfe-vivo' }, h('div', null, h('span', { class: 'cfg-pulso' }), ' ', h('b', null, r.acao === 'cadastros' ? 'Lendo os cadastros do AppNext…' : r.acao === 'parceiro' ? 'Cadastrando o parceiro no AppNext…' : (info.rascunhos || []).some((x) => x.id === r.id && x.emitir) ? 'Emitindo a NF-e (concluir e transmitir à SEFAZ)…' : 'Preenchendo a nota no AppNext…'),
        h('small', { class: 'muted' }, r.estado === 'rodando' ? (r.acao === 'parceiro' ? ' o robô está em Parceiros → Cadastrar' : ' o robô está na tela de Saída de Produtos') : ' na fila do robô')),
        r.aoVivo && r.aoVivo.length ? h('pre', { class: 'inv-log' }, r.aoVivo.slice(-14).join('\n')) : null);
    };
    function pintar() {
      const bt = h('button', { type: 'button', class: 'btn ' + (aberto ? '' : 'primary') }, aberto ? 'Fechar' : '＋ Nova NF-e');
      bt.addEventListener('click', () => { aberto = !aberto; pintar(); });
      // a lista mostra só o que ainda pede atenção: nota emitida que já tem DANFE/XML vai para "Notas de saída";
      // teste que já virou nota (ou venceu as 2 horas) some
      const ras = ((info && info.rascunhos) || []).filter((r) => (r.estado === 'autorizada' ? !r.temXml : r.estado === 'teste' ? !r.emitidaEm && Date.now() - Date.parse(r.fim || r.em) < 2 * 3600e3 : true));
      box.replaceChildren(...[
        h('div', { class: 'nfe-topo' }, bt, h('small', { class: 'muted' }, 'Para emitir pelo painel: o robô testa a nota no AppNext (sem salvar), você confere o total e clica em "Emitir NF-e" — ele conclui e transmite à SEFAZ. Se preferir, "Só salvar rascunho" deixa a nota no AppNext para transmitir lá.')),
        info && info.erroGeral ? h('div', { class: 'notice err mt' }, info.erroGeral) : null,
        aberto && avisoPronta ? h('div', { class: 'notice ' + (avisoPronta.falta.length ? '' : 'ok') }, h('b', null, avisoPronta.titulo || `Nota montada a partir do orçamento #${avisoPronta.numero}. `), avisoPronta.falta.length ? h('span', null, 'Confira: ', avisoPronta.falta.join('; '), '.') : 'Confira e teste antes de emitir.') : null,
        aberto ? formulario() : (info && info.robo && info.robo.acao === 'rascunho' ? roboVivo() : null),
        ras.length ? listaRascunhos(ras) : null].filter(Boolean));
    }
    /** nota emitida: DANFE e XML (quando o XML já foi importado) ou o aviso de quando chegam */
    const docsNfe = (r, grande) => {
      if (r.estado !== 'autorizada' || !r.nfe || !r.nfe.chave) return null;
      if (r.temXml) return h('span', { class: 'nf-acoes' },
        h('a', { class: grande ? 'btn primary' : 'btn prc-ver', href: url('danfe', loja, r.nfe.chave), target: '_blank', rel: 'noopener', title: 'DANFE para imprimir ou salvar em PDF', onclick: (e) => e.stopPropagation() }, grande ? 'DANFE (imprimir / PDF)' : 'DANFE'),
        h('a', { class: 'btn prc-ver', href: url('xml', loja, r.nfe.chave), title: 'Baixar o XML da nota', onclick: (e) => e.stopPropagation() }, 'XML'));
      return h('small', { class: 'muted nfe-xml-esp', title: 'O DANFE e o XML saem do XML que o coletor baixa do AppNext. Depois disso a nota também aparece em "Notas de saída (NF-e)", abaixo.' },
        r.xml === 'pedido' ? '⏳ DANFE e XML: importando do AppNext (alguns minutos)' : '⏳ DANFE e XML chegam na próxima coleta do AppNext');
    };
    /** rascunhos pedidos ao robô: tabela no padrão das notas de saída (filtro, busca, paginação) */
    function listaRascunhos(ras) {
      const ult = info.robo && info.robo.ultima;
      const FIL = { todos: ['Todos', () => true], aut: ['Aguardando DANFE/XML', (r) => r.estado === 'autorizada'], ok: ['Rascunhos salvos', (r) => r.estado === 'ok'], erro: ['Com problema', (r) => r.estado === 'erro' || r.estado === 'concluida'], fila: ['Na fila', (r) => r.estado === 'na_fila'], teste: ['Testes', (r) => r.estado === 'teste'] };
      const contaF = (k) => ras.filter(FIL[k][1]).length;
      const fil = FIL[state.nfeRasFil] && contaF(state.nfeRasFil) ? state.nfeRasFil : 'todos';
      const rows = ras.filter(FIL[fil][1]).map((r) => ({ ...r, quando: r.em, parcNome: r.parceiro.nome, nItens: r.itens.length, situ: { na_fila: 0, concluida: 1, erro: 2, teste: 3, ok: 4, autorizada: 5 }[r.estado] ?? 6 }));
      const situCel = (r) => {
        const rodando = r.estado === 'na_fila' && info.robo && info.robo.estado === 'rodando' && info.robo.id === r.id;
        return h('div', { class: 'nfe-ras-situ' }, h('span', { class: 'nfe-st ' + (ESTADO_NFE[r.estado] || ESTADO_NFE.erro)[1] }, rodando ? (r.emitir ? 'o robô está emitindo' : 'o robô está preenchendo') : r.estado === 'na_fila' && r.emitir ? 'na fila para emitir' : (ESTADO_NFE[r.estado] || ESTADO_NFE.erro)[0]),
          r.estado === 'autorizada' && r.nfe ? h('small', { class: 'muted' }, `NF-e nº ${r.nfe.numero}${r.nfe.protocolo ? ' · protocolo ' + r.nfe.protocolo : ''}`) : null,
          r.estado === 'teste' && r.totalAppNext != null ? h('small', { class: 'muted' }, `total no AppNext: ${fmt.brl(r.totalAppNext)}`) : null,
          r.estado === 'erro' || r.estado === 'concluida' ? h('small', { class: 'nfe-erro', title: r.erro || '' }, (r.erro || 'falhou').replace(/^(Page\.evaluate|Locator\.\w+): (Error: )?/, '').slice(0, r.estado === 'concluida' ? 200 : 90)) : null);
      };
      const tab = TS.table({
        cols: [
          { key: 'quando', label: 'Pedido em', align: 'l', render: (r) => h('span', null, quandoTZ(r.em), h('small', { class: 'est-tam' }, r.por || '—')), sortVal: (r) => Date.parse(r.em) || 0 },
          { key: 'parcNome', label: 'Parceiro', align: 'l', wrap: true, render: (r) => h('span', null, r.parceiro.nome, h('small', { class: 'est-tam' }, [r.parceiro.doc ? docTxt(r.parceiro.doc) : null, r.vendedor, r.pagamento].filter(Boolean).join(' · '))) },
          { key: 'nItens', label: 'Itens', fmt: fmt.int },
          { key: 'total', label: 'Total', fmt: (v) => (v == null ? '—' : fmt.brl(v)) },
          { key: 'situ', label: 'Situação', align: 'l', render: situCel },
          { key: 'log', label: '', align: 'l', sortVal: () => 0, render: (r) => h('span', { class: 'nf-acoes' },
            docsNfe(r),
            r.estado === 'erro' && podeRefazer(r) ? h('button', { type: 'button', class: 'btn nfe-refazer', title: 'Abre a nota já preenchida com os mesmos dados para ajustar e testar de novo', onclick: (e) => { e.stopPropagation(); refazer(r); } }, '↻ Refazer') : null,
            podeEmitir(r) ? h('button', { type: 'button', class: 'btn primary nfe-emitir', title: 'Concluir e transmitir esta nota à SEFAZ (o robô confere se o total continua o do teste)', onclick: (e) => { e.stopPropagation(); emitirTeste(r); } }, 'Emitir NF-e') : null,
            (r.estado === 'erro' || r.estado === 'concluida') && ult && ult.id === r.id && ult.log && ult.log.length ? h('button', { type: 'button', class: 'btn prc-ver', onclick: (e) => { e.stopPropagation(); verLog(r, ult.log); } }, 'Log') : null) },
        ],
        rows, sortKey: 'quando', pageSize: 8, search: 'Buscar parceiro, vendedor ou quem pediu…', searchKeys: ['parcNome', 'por', 'vendedor'], cls: 'est-t nfe-ras-t',
        rowClass: (r) => (r.estado === 'erro' ? 'nfe-ras-erro' : null),
        onRowClick: (r) => detalhes(r),
        empty: 'Nenhum rascunho com esse filtro.',
      });
      return TS.cardWithTools(`Notas pedidas ao robô (${fmt.int(ras.length)})`, 'Só o que ainda pede atenção: teste para emitir, rascunho salvo no AppNext e o que deu erro ("↻ Refazer" vale só no dia do pedido). Nota emitida vai para "Notas de saída", abaixo, com DANFE e XML.',
        h('div', { class: 'est-tools' }, tab.searchBox && (tab.searchBox.classList.add('est-busca'), tab.searchBox),
          TS.seg(Object.entries(FIL).filter(([k]) => k === 'todos' || contaF(k)).map(([k, [t]]) => [`${t} (${fmt.int(contaF(k))})`, k]), fil, (v) => { state.nfeRasFil = v; pintar(); })),
        tab);
    }
    /** refazer: abre o formulário já preenchido com o pedido (parceiro, vendedor, pagamento, produtos) para ajustar e testar de novo */
    const diaBR = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    /** refazer só no dia do pedido (horário de Brasília); nota já emitida não se refaz */
    const podeRefazer = (r) => ['erro', 'teste', 'ok'].includes(r.estado) && diaBR(Date.parse(r.em)) === diaBR(Date.now()) && !(info.robo && (info.robo.estado === 'na_fila' || info.robo.estado === 'rodando'));
    function refazer(r) {
      const cad = info && info.cadastros;
      if (!cad) { alert('Busque os cadastros do AppNext primeiro.'); return; }
      if (r.estado === 'ok' && !confirm('Este pedido já está salvo como rascunho no AppNext. Refazer cria outra nota (o rascunho antigo continua lá: apague no AppNext se não for usar). Continuar?')) return;
      const falta = [];
      const doc = String(r.parceiro.doc || '').replace(/\D/g, '');
      form.parceiro = cad.parceiros.find((x) => doc && String(x.doc || '').replace(/\D/g, '') === doc) || cad.parceiros.find((x) => ESQ(x.nome) === ESQ(r.parceiro.nome)) || null;
      if (!form.parceiro) falta.push(`parceiro ${r.parceiro.nome} não está mais nos cadastros: escolha de novo`);
      form.consumidorFinal = !!r.consumidorFinal;
      const v = cad.vendedores.find((x) => ESQ(x.nome) === ESQ(r.vendedor || ''));
      form.vendedorId = v ? v.id : ''; if (r.vendedor && !v) falta.push(`vendedor ${r.vendedor} não achado`);
      const pg = cad.pagamentos.find((x) => x.descricao === r.pagamento);
      form.pagamento = pg ? pg.codigo : ''; if (r.pagamento && !pg) falta.push(`forma de pagamento ${r.pagamento} não achada`);
      form.itens = [];
      for (const i of r.itens) {
        const x = cad.produtos.find((y) => y.id === i.produtoId) || cad.produtos.find((y) => y.codigo === String(i.codigo));
        if (x) form.itens.push({ produtoId: x.id, codigo: x.codigo, nome: x.nome, un: x.un, qtd: i.qtd, preco: i.preco });
        else falta.push(`produto ${i.nome || i.codigo} não está mais nos cadastros`);
      }
      form.obs = r.obs || '';
      aberto = true;
      avisoPronta = { titulo: `Nota refeita a partir do pedido de ${quandoTZ(r.em)}${r.erro ? ' (que deu erro)' : ''}. `, falta };
      pintar();
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    /** detalhes do pedido ao robô: itens, estoque de agora, situação completa e as ações */
    function detalhes(r) {
      const fundo = h('div', { class: 'cp-modal-bg' });
      const fechar = () => fundo.remove();
      fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
      const est = (i) => (info.estoque && info.estoque.qtd && info.estoque.qtd[String(i.codigo)] != null ? info.estoque.qtd[String(i.codigo)] : null);
      const ult = info.robo && info.robo.ultima;
      const [stTxt, stCls] = ESTADO_NFE[r.estado] || ESTADO_NFE.erro;
      const tab = TS.table({
        cols: [
          { key: 'nome', label: 'Produto', align: 'l', wrap: true, title: 'Embaixo do código, a regra fiscal que o AppNext usou neste produto (a vinculada a ele lá: com ST ou sem ST) e o CFOP dela — aparece depois do teste.',
            render: (i) => { const rg = r.regras && r.regras[i.produtoId]; return h('span', null, h('b', null, i.nome || ''), h('small', { class: 'est-tam' }, `cód. ${i.codigo}`), rg ? h('small', { class: 'est-tam nfe-regra' }, `regra fiscal: ${rg.regra}${rg.cfop ? ' · CFOP ' + rg.cfop : ''}`) : null); } },
          { key: 'qtd', label: 'Qtd', fmt: (v) => fmt.n2(v).replace(/,00$/, '') },
          { key: 'preco', label: 'Preço', fmt: fmt.brl },
          { key: 'tot', label: 'Total', render: (i) => fmt.brl(Math.round(i.qtd * i.preco * 100) / 100), sortVal: (i) => i.qtd * i.preco },
          { key: 'est', label: 'Estoque agora', title: 'Estoque da última planilha do AppNext. Vermelho = a nota pede mais do que tem (o AppNext recusa ao concluir).',
            render: (i) => { const e = est(i); return e == null ? h('span', { class: 'muted' }, '—') : h('span', { class: i.qtd > e + 1e-9 ? 'neg' : null }, fmt.n2(e).replace(/,00$/, '') + (i.qtd > e + 1e-9 ? ' ⚠' : '')); }, sortVal: (i) => est(i) ?? -1 },
        ],
        rows: r.itens.map((i) => ({ ...i, tot: i.qtd * i.preco, est: est(i) })), sortKey: 'nome', sortDir: 'asc', cls: 'est-t', empty: 'Sem itens.',
      });
      fundo.append(h('div', { class: 'card cp-copiar nfe-det-modal' },
        h('div', { class: 'nfe-det-cab' }, h('h3', null, r.parceiro.nome), h('span', { class: 'nfe-st ' + stCls }, stTxt)),
        h('div', { class: 'muted nfe-det-info' }, [r.parceiro.doc ? docTxt(r.parceiro.doc) : null, r.vendedor && `vendedor ${r.vendedor}`, r.pagamento, `pedido em ${quandoTZ(r.em)}${r.por ? ' por ' + r.por : ''}`].filter(Boolean).join(' · ')),
        r.erro ? h('div', { class: 'notice err nfe-det-erro' }, r.erro) : null,
        r.estado === 'autorizada' && r.nfe ? h('div', { class: 'notice ok' }, `NF-e nº ${r.nfe.numero}${r.nfe.protocolo ? ' · protocolo ' + r.nfe.protocolo : ''}${r.nfe.chave ? ' · chave ' + r.nfe.chave : ''}`) : null,
        tab,
        h('div', { class: 'nfe-det-tot' }, 'Total: ', h('b', null, fmt.brl(r.total)), r.totalAppNext != null ? h('span', { class: 'muted' }, ` · no AppNext: ${fmt.brl(r.totalAppNext)}`) : null),
        h('div', { class: 'cp-acoes' },
          docsNfe(r, true),
          podeRefazer(r) ? h('button', { type: 'button', class: r.estado === 'autorizada' ? 'btn' : 'btn primary', onclick: () => { fechar(); refazer(r); } }, '↻ Refazer esta nota') : null,
          podeEmitir(r) ? h('button', { type: 'button', class: 'btn primary', onclick: () => { fechar(); emitirTeste(r); } }, 'Emitir NF-e') : null,
          (r.estado === 'erro' || r.estado === 'concluida') && ult && ult.id === r.id && ult.log && ult.log.length ? h('button', { type: 'button', class: 'btn', onclick: () => { fechar(); verLog(r, ult.log); } }, 'Ver log do robô') : null,
          r.estado === 'concluida' ? h('small', { class: 'neg' }, 'A saída foi concluída no AppNext: confira lá antes de refazer (para não duplicar).') : null,
          h('span', { style: { flex: 1 } }), h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Fechar'))));
      document.body.append(fundo);
    }
    TS.nfeDetalhesTeste = detalhes; // testes
    // teste que deu certo há menos de 2 horas e ainda não foi emitido: pode virar a NF-e de verdade
    const podeEmitir = (r) => r.estado === 'teste' && !r.emitidaEm && r.totalAppNext != null && Date.now() - Date.parse(r.fim || r.em) < 2 * 3600e3 && !(info.robo && (info.robo.estado === 'na_fila' || info.robo.estado === 'rodando'));
    async function emitirTeste(r) {
      const txt = `EMITIR a NF-e no AppNext?\n\n${r.parceiro.nome}\n${r.itens.length} ${r.itens.length === 1 ? 'produto' : 'produtos'} · total calculado pelo AppNext: ${fmt.brl(r.totalAppNext)}\n\nO robô preenche de novo, confere se o total continua o mesmo, CONCLUI a saída e HOMOLOGA (transmite à SEFAZ). Depois de autorizada, a nota só pode ser cancelada em até 24 horas.`;
      if (!confirm(txt)) return;
      try { await nfeApi('POST', 'nfe/emitir', { loja, id: r.id }); carregar(); } catch (e) { alert(e.message); }
    }
    /** log do robô (última execução) numa janela */
    function verLog(r, log) {
      const fundo = h('div', { class: 'cp-modal-bg' });
      const fechar = () => fundo.remove();
      fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
      fundo.append(h('div', { class: 'card cp-copiar nfe-log-modal' }, h('h3', null, `Log do robô · ${r.parceiro.nome}`), h('p', { class: 'nfe-erro' }, r.erro || ''), h('pre', { class: 'inv-log' }, log.join('\n')),
        h('div', { class: 'cp-acoes' }, h('span', { style: { flex: 1 } }), h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Fechar'))));
      document.body.append(fundo);
    }
    const formParceiro = (aoPedir) => abrirFormParceiro(loja, aoPedir);
    blocoParceiros = () => {
      const ps = ((info && info.parceiros) || []).filter((r) => r.estado !== 'teste' || Date.now() - Date.parse(r.em) < 3600e3).slice(0, 3);
      if (!ps.length) return null;
      const ult = info.robo && info.robo.ultima;
      return h('div', { class: 'nfe-parcs' }, ...ps.map((r) => h('div', { class: 'nfe-parc-l' },
        h('small', null, h('b', null, r.nome), ` · ${quandoTZ(r.em)} `), h('span', { class: 'nfe-st ' + ESTADO_PARC[r.estado][1] }, r.estado === 'na_fila' && info.robo && info.robo.estado === 'rodando' && info.robo.id === r.id ? 'o robô está cadastrando' : ESTADO_PARC[r.estado][0]),
        r.estado === 'erro' ? h('div', { class: 'nfe-erro' }, r.erro || 'falhou', ' — nada foi salvo.', ult && ult.id === r.id && ult.log && ult.log.length ? h('details', null, h('summary', null, 'log do robô'), h('pre', { class: 'inv-log' }, ult.log.join('\n'))) : null) : null)));
    };
    function formulario() {
      if (!info) return h('div', { class: 'card mt' }, h('p', { class: 'muted' }, 'Carregando…'));
      const cad = info.cadastros;
      const vivo = roboVivo();
      const btCad = h('button', { type: 'button', class: 'btn', disabled: !!vivo || !info.podeRobo || null }, cad ? '↻ Atualizar cadastros' : 'Buscar cadastros do AppNext');
      btCad.addEventListener('click', async () => { btCad.disabled = true; try { await nfeApi('POST', 'nfe/cadastros', { loja }); carregar(); } catch (e) { alert(e.message); btCad.disabled = false; } });
      const topoCad = h('div', { class: 'nfe-cad' }, cad ? h('small', { class: 'muted' }, `Parceiros, vendedores e produtos do AppNext lidos em ${quandoTZ(cad.em)} (${fmt.int(cad.parceiros.length)} parceiros · ${fmt.int(cad.produtos.length)} produtos). Cadastrou algo novo no AppNext? Atualize.`) : h('span', null, 'Para montar a nota, o painel precisa dos parceiros, vendedores e produtos do AppNext (o robô só lê, não altera nada).'), btCad,
        info.erroCadastros && (!cad || Date.parse(info.erroCadastros.em) > Date.parse(cad.em)) ? h('div', { class: 'notice err' }, 'A última leitura dos cadastros falhou: ', info.erroCadastros.erro) : null, vivo && info.robo.acao === 'cadastros' ? vivo : null);
      if (!cad) return h('div', { class: 'card mt nfe-form' }, topoCad);
      // ---- parceiro
      const parcBox = h('div', { class: 'nfe-campo' });
      const pintarParc = () => {
        if (form.parceiro) {
          const cf = h('input', { type: 'checkbox', checked: form.consumidorFinal || null });
          cf.addEventListener('change', () => { form.consumidorFinal = cf.checked; });
          parcBox.replaceChildren(h('label', null, 'Parceiro'), h('div', { class: 'nfe-escolhido' }, h('b', null, form.parceiro.nome), h('small', { class: 'muted' }, ' ' + docTxt(form.parceiro.doc)),
            h('button', { type: 'button', class: 'link-btn', onclick: () => { form.parceiro = null; pintarParc(); } }, 'trocar')),
          h('label', { class: 'nfe-check' }, cf, ' Consumidor final'));
          return;
        }
        const inp = h('input', { class: 'f-input', placeholder: 'Nome ou CNPJ/CPF do parceiro…', autocomplete: 'off' });
        const sug = h('div', { class: 'nfe-sug' });
        inp.addEventListener('input', () => {
          const q = ESQ(inp.value), qd = inp.value.replace(/\D/g, '');
          const vistos = new Set();
          // o AppNext às vezes devolve o mesmo parceiro duas vezes: mostra um só (mesmo documento e nome)
          const achou = q.length < 2 ? [] : cad.parceiros.filter((x) => ESQ(x.nome).includes(q) || (qd.length >= 3 && x.doc.includes(qd)))
            .filter((x) => { const k = String(x.doc || '').replace(/\D/g, '') + '|' + ESQ(x.nome); if (vistos.has(k)) return false; vistos.add(k); return true; }).slice(0, 8);
          sug.replaceChildren(...achou.map((x) => h('button', { type: 'button', class: 'nfe-sug-i', onclick: () => { form.parceiro = x; form.consumidorFinal = !!x.consumidorFinal; pintarParc(); } }, h('b', null, x.nome), h('small', { class: 'muted' }, ' ' + docTxt(x.doc)))),
            ...(q.length >= 2 && !achou.length ? [h('small', { class: 'muted' }, 'Nenhum parceiro com esse nome ou documento. Use "＋ Cadastrar parceiro novo".')] : []));
        });
        parcBox.replaceChildren(h('label', null, 'Parceiro'), inp, sug,
          h('button', { type: 'button', class: 'link-btn nfe-novo-parc', disabled: !!vivo || !info.podeRobo || null, onclick: () => formParceiro((rid) => { esperandoParc = rid; carregar(); }) }, '＋ Cadastrar parceiro novo'),
          blocoParceiros());
      };
      pintarParc();
      // ---- vendedor e pagamento
      const vend = h('select', { class: 'f-input' }, h('option', { value: '' }, 'Escolha…'), ...cad.vendedores.map((v) => h('option', { value: v.id, selected: form.vendedorId === v.id || null }, v.nome)));
      vend.addEventListener('change', () => { form.vendedorId = vend.value; });
      if (!form.pagamento) form.pagamento = (cad.pagamentos.find((x) => x.codigo === '9') || {}).codigo || '';
      const pag = h('select', { class: 'f-input' }, h('option', { value: '' }, 'Escolha…'), ...cad.pagamentos.map((x) => h('option', { value: x.codigo, selected: form.pagamento === x.codigo || null }, `[${x.codigo}] ${x.descricao}`)));
      pag.addEventListener('change', () => { form.pagamento = pag.value; });
      // ---- produtos
      const tabela = h('div', { class: 'nfe-itens' });
      const totalEl = h('b');
      // estoque da última planilha do AppNext (o AppNext recusa concluir a nota sem estoque suficiente): avisa já aqui
      const ESTQ = info.estoque;
      const estqDe = (it) => (ESTQ && ESTQ.qtd && ESTQ.qtd[String(it.codigo)] != null ? ESTQ.qtd[String(it.codigo)] : null);
      const faltas = () => form.itens.filter((it) => { const e = estqDe(it); return e != null && it.qtd > e + 1e-9; });
      TS.nfeFaltasTeste = faltas; // testes
      const pintarItens = () => {
        const tot = form.itens.reduce((s, i) => s + Math.round(i.qtd * i.preco * 100) / 100, 0);
        totalEl.textContent = fmt.brl(tot);
        tabela.replaceChildren(...form.itens.map((it, k) => {
          const q = h('input', { class: 'f-input nfe-num', type: 'number', min: 0, step: 'any', value: it.qtd });
          const pr = h('input', { class: 'f-input nfe-num', type: 'number', min: 0, step: '0.01', value: it.preco });
          const lin = h('small', { class: 'nfe-lin' }, fmt.brl(it.qtd * it.preco));
          const eq = h('small', { class: 'nfe-estq' });
          const pintarEstq = () => { const e = estqDe(it); eq.className = 'nfe-estq ' + (e == null ? 'muted' : it.qtd > e + 1e-9 ? 'neg' : 'muted'); eq.textContent = e == null ? 'estoque: —' : it.qtd > e + 1e-9 ? `⚠ estoque ${fmt.n2(e).replace(/,00$/, '')} — falta ${fmt.n2(it.qtd - e).replace(/,00$/, '')}` : `estoque ${fmt.n2(e).replace(/,00$/, '')}`; };
          pintarEstq();
          q.addEventListener('input', () => { it.qtd = Number(q.value) || 0; lin.textContent = fmt.brl(it.qtd * it.preco); pintarEstq(); totalEl.textContent = fmt.brl(form.itens.reduce((s, i) => s + Math.round(i.qtd * i.preco * 100) / 100, 0)); });
          pr.addEventListener('input', () => { it.preco = Number(pr.value) || 0; lin.textContent = fmt.brl(it.qtd * it.preco); totalEl.textContent = fmt.brl(form.itens.reduce((s, i) => s + Math.round(i.qtd * i.preco * 100) / 100, 0)); });
          return h('div', { class: 'nfe-item' }, h('div', { class: 'nfe-item-n' }, h('b', null, it.nome), h('small', { class: 'muted' }, ` cód. ${it.codigo}${it.un ? ' · ' + it.un : ''}`)),
            h('label', null, 'Qtd ', q, eq), h('label', null, 'R$ ', pr), lin,
            h('button', { type: 'button', class: 'link-btn', onclick: () => { form.itens.splice(k, 1); pintarItens(); } }, 'remover'));
        }), ...(form.itens.length ? [] : [h('small', { class: 'muted' }, 'Nenhum produto ainda.')]));
      };
      const busca = h('input', { class: 'f-input', placeholder: 'Adicionar produto: nome ou código…', autocomplete: 'off' });
      const sugP = h('div', { class: 'nfe-sug' });
      busca.addEventListener('input', () => {
        const q = ESQ(busca.value);
        const achou = q.length < 2 ? [] : cad.produtos.filter((x) => x.codigo === busca.value.trim() || ESQ(x.nome).includes(q) || x.codigo.startsWith(busca.value.trim())).slice(0, 10);
        sugP.replaceChildren(...achou.map((x) => h('button', { type: 'button', class: 'nfe-sug-i', onclick: () => { form.itens.push({ produtoId: x.id, codigo: x.codigo, nome: x.nome, un: x.un, qtd: 1, preco: x.preco }); busca.value = ''; sugP.replaceChildren(); pintarItens(); busca.focus(); } },
          h('b', null, x.nome), h('small', { class: 'muted' }, ` cód. ${x.codigo} · ${fmt.brl(x.preco)}`))));
      });
      pintarItens();
      const msg = h('div', { class: 'muted' });
      const enviar = h('button', { type: 'button', class: 'btn', disabled: !!vivo || null, title: 'O robô salva a nota no AppNext como rascunho, sem transmitir: a loja confere e transmite lá' }, 'Só salvar rascunho');
      const testar = h('button', { type: 'button', class: 'btn primary', disabled: !!vivo || null, title: 'O robô preenche a nota no AppNext e confere tudo, mas não salva nada. Depois, na lista, aparece "Emitir NF-e"' }, '1. Testar para emitir');
      const mandar = async (simular) => {
        msg.className = 'neg';
        if (!form.parceiro) { msg.textContent = 'Escolha o parceiro.'; return; }
        if (!form.vendedorId) { msg.textContent = 'Escolha o vendedor.'; return; }
        if (!form.pagamento) { msg.textContent = 'Escolha a forma de pagamento.'; return; }
        if (!form.itens.length) { msg.textContent = 'Adicione pelo menos um produto.'; return; }
        if (form.itens.some((i) => !(i.qtd > 0) || !(i.preco > 0))) { msg.textContent = 'Confira quantidade e preço de cada produto.'; return; }
        const tot = form.itens.reduce((s, i) => s + Math.round(i.qtd * i.preco * 100) / 100, 0);
        const fs = faltas();
        if (fs.length) {
          const quando = ESTQ.em ? new Date(ESTQ.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';
          msg.className = 'neg';
          msg.textContent = `Sem estoque suficiente (planilha do AppNext de ${quando}): ${fs.map((i) => `${i.nome} — tem ${fmt.n2(estqDe(i)).replace(/,00$/, '')}, a nota pede ${fmt.n2(i.qtd).replace(/,00$/, '')}`).join('; ')}. O AppNext não deixa emitir assim: ajuste a quantidade ou dê entrada no estoque.`;
          if (!confirm(`${fs.length === 1 ? 'Um produto está' : `${fs.length} produtos estão`} sem estoque suficiente pela planilha do AppNext de ${quando}:\n\n${fs.map((i) => `• ${i.nome}: tem ${fmt.n2(estqDe(i)).replace(/,00$/, '')}, pede ${fmt.n2(i.qtd).replace(/,00$/, '')}`).join('\n')}\n\nO AppNext recusa concluir a nota sem estoque. Se o estoque já mudou (entrada recente), continue: o robô confere o estoque de agora no AppNext. Continuar mesmo assim?`)) return;
        }
        if (!simular && !confirm(`Criar o rascunho da NF-e no AppNext?\n\n${form.parceiro.nome}${form.consumidorFinal ? ' (consumidor final)' : ''}\n${form.itens.length} ${form.itens.length === 1 ? 'produto' : 'produtos'} · ${fmt.brl(tot)}\n\nO robô salva como RASCUNHO: a nota só é emitida quando a loja conferir e transmitir no AppNext.`)) return;
        enviar.disabled = true; testar.disabled = true; msg.className = 'muted'; msg.textContent = 'Enviando ao robô…';
        try {
          await nfeApi('POST', 'nfe/rascunho', { loja, simular, parceiroId: form.parceiro.id, consumidorFinal: form.consumidorFinal, vendedorId: form.vendedorId, pagamento: form.pagamento, itens: form.itens.map((i) => ({ produtoId: i.produtoId, qtd: i.qtd, preco: i.preco })) });
          if (!simular) { Object.assign(form, { parceiro: null, consumidorFinal: false, itens: [] }); aberto = false; }
          carregar();
        } catch (e) { msg.className = 'neg'; msg.textContent = e.message; enviar.disabled = false; testar.disabled = false; }
      };
      enviar.addEventListener('click', () => mandar(false));
      testar.addEventListener('click', () => mandar(true));
      return h('div', { class: 'card mt nfe-form' }, topoCad,
        h('div', { class: 'nfe-grade' }, parcBox,
          h('div', { class: 'nfe-campo' }, h('label', null, 'Vendedor'), vend),
          h('div', { class: 'nfe-campo' }, h('label', null, 'Forma de pagamento'), pag)),
        h('div', { class: 'nfe-campo' }, h('label', null, 'Produtos'), busca, sugP, tabela),
        h('div', { class: 'nfe-total' }, 'Total: ', totalEl),
        h('div', { class: 'aviso nfe-fixos' }, 'Vai sempre como: [1] Venda · CFOP 5102 · série NF-e · NF-e normal · frete [9] sem frete / [9] sem ocorrência de transporte · endereço padrão do parceiro. Os impostos são calculados pelo AppNext. ',
          h('b', null, 'Para emitir: '), '1. "Testar para emitir" (nada é salvo) → 2. confira o total do AppNext na lista → 3. ', h('b', null, '"Emitir NF-e"'), ' (o robô conclui e transmite à SEFAZ; vale por 2 horas depois do teste). "Só salvar rascunho" grava sem transmitir.'),
        h('div', { class: 'cfg-acoes' }, testar, enviar, msg),
        vivo && (info.robo.acao === 'rascunho' || info.robo.acao === 'parceiro') ? vivo : null);
    }
    pintar();
    carregar();
    return box;
  }

  /** parceiros novos pedidos ao robô (os mais recentes) */
  const ESTADO_PARC = { na_fila: ['na fila do robô', 'nfe-st-fila'], ok: ['cadastrado no AppNext', 'nfe-st-ok'], teste: ['teste ok (nada foi salvo)', 'nfe-st-fila'], erro: ['não foi cadastrado', 'nfe-st-erro'] };
  let blocoParceiros = () => null;
  /** janela "Cadastrar parceiro novo": o robô preenche Parceiros → Cadastrar no AppNext (o CEP completa o endereço) */
  function abrirFormParceiro(loja, aoPedir) {
    const v = { tipo: 'PJ', tipoIe: '9', crt: '1' };
    const campo = (rot, el, dica) => h('label', { class: 'nfe-campo np-campo' }, h('span', null, rot, dica ? TS.dica(dica) : null), el);
    const els = {};
    const inp = (k, ph, extra = {}) => { const i = h('input', { class: 'f-input', placeholder: ph || '', autocomplete: 'off', value: v[k] || '', ...extra }); i.addEventListener('input', () => { v[k] = i.value; }); els[k] = i; return i; };
    // preenche só o que ainda está vazio (não apaga o que a pessoa digitou)
    const por = (k, val) => { if (!val || String(v[k] || '').trim()) return; v[k] = val; if (els[k]) els[k].value = val; };
    // CNPJ completo: busca na Receita (BrasilAPI) e preenche razão social, nome fantasia, CEP, número, telefone
    const infoCnpj = h('small', { class: 'np-consulta muted' });
    let ultimoCnpj = '';
    const consultarCnpj = async () => {
      const d = String(v.doc || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
      if (v.tipo !== 'PJ' || !TS.brasil.pareceCnpj(d) || d === ultimoCnpj) return;
      ultimoCnpj = d;
      infoCnpj.className = 'np-consulta muted'; infoCnpj.textContent = 'Consultando o CNPJ na Receita…';
      try {
        const e = await TS.brasil.cnpj(d);
        if (d !== ultimoCnpj) return;
        if (!e) { infoCnpj.className = 'np-consulta neg'; infoCnpj.textContent = 'CNPJ não encontrado na Receita: confira os números.'; return; }
        por('razaoSocial', e.razaoSocial); por('nomeFantasia', e.nomeFantasia); por('cep', e.cep); por('numero', e.numero); por('complemento', e.complemento); por('telefone', e.telefone);
        infoCnpj.className = 'np-consulta ' + (e.ativa ? 'pos' : 'neg');
        infoCnpj.textContent = (e.ativa ? '✓ Achado na Receita (ativa) · ' : `Atenção: na Receita a empresa está ${String(e.situacao || 'sem situação').toLowerCase()} · `) + TS.brasil.enderecoTxt(e);
        if (e.cep) consultarCep();
      } catch (err) { infoCnpj.className = 'np-consulta muted'; infoCnpj.textContent = err.message; ultimoCnpj = ''; }
    };
    // CEP completo: mostra rua, bairro e cidade para conferir (o AppNext preenche o endereço pelo CEP)
    const infoCep = h('small', { class: 'np-consulta muted' });
    let ultimoCep = '';
    const consultarCep = async () => {
      const c = String(v.cep || '').replace(/\D/g, '');
      if (c.length !== 8) { if (!c) infoCep.textContent = ''; return; }
      if (c === ultimoCep) return;
      ultimoCep = c;
      infoCep.className = 'np-consulta muted'; infoCep.textContent = 'Buscando o endereço…';
      try {
        const e = await TS.brasil.cep(c);
        if (c !== ultimoCep) return;
        infoCep.className = 'np-consulta ' + (e ? 'pos' : 'neg');
        infoCep.textContent = e ? TS.brasil.enderecoTxt(e) : 'CEP não encontrado: confira os números.';
      } catch (err) { infoCep.className = 'np-consulta muted'; infoCep.textContent = err.message; ultimoCep = ''; }
    };
    let tCnpj = null, tCep = null;
    const corpoTipo = h('div', { class: 'np-grade' });
    const pintarTipo = () => {
      if (v.tipo === 'PJ') {
        const ie = h('select', { class: 'f-input' }, [['9', 'Não contribuinte'], ['2', 'Contribuinte isento de IE'], ['1', 'Contribuinte de ICMS (tem IE)']].map(([c, t]) => h('option', { value: c, selected: v.tipoIe === c || null }, t)));
        const ieNum = inp('ie', 'só números', { inputmode: 'numeric' });
        const ieBox = campo('Inscrição estadual', ieNum); ieBox.hidden = v.tipoIe !== '1';
        ie.addEventListener('change', () => { v.tipoIe = ie.value; ieBox.hidden = v.tipoIe !== '1'; });
        const crt = h('select', { class: 'f-input' }, [['1', 'Simples Nacional'], ['2', 'Simples Nacional - excesso de sublimite'], ['3', 'Regime Normal'], ['4', 'Simples Nacional - MEI']].map(([c, t]) => h('option', { value: c, selected: v.crt === c || null }, t)));
        crt.addEventListener('change', () => { v.crt = crt.value; });
        const docEl = inp('doc', '00.000.000/0000-00', { inputmode: 'numeric' });
        docEl.addEventListener('input', () => { clearTimeout(tCnpj); tCnpj = setTimeout(consultarCnpj, 400); });
        corpoTipo.replaceChildren(h('div', { class: 'np-campo-cheio' }, campo('CNPJ', docEl, 'Com o CNPJ completo, o painel busca na Receita e preenche o que estiver vazio.'), infoCnpj), campo('Razão social', inp('razaoSocial', '')),
          campo('Nome fantasia', inp('nomeFantasia', 'se vazio, a razão social')), campo('Situação no ICMS', ie), ieBox, campo('Regime tributário', crt),
          campo('Inscrição municipal', inp('im', 'opcional')));
      } else {
        corpoTipo.replaceChildren(campo('CPF', inp('doc', '000.000.000-00', { inputmode: 'numeric' })), campo('Nome completo', inp('nome', 'nome e sobrenome')),
          campo('Data de nascimento', inp('nascimento', 'DD/MM/AAAA', { inputmode: 'numeric', maxlength: 10 }), 'O AppNext exige a data de nascimento para pessoa física.'), campo('Apelido', inp('apelido', 'se vazio, o primeiro nome')));
      }
    };
    const tipoSeg = TS.seg([['Empresa (CNPJ)', 'PJ'], ['Pessoa física (CPF)', 'PF']], v.tipo, (t) => { for (const k of ['doc', 'nome', 'apelido', 'nascimento', 'razaoSocial', 'nomeFantasia', 'ie', 'im']) delete v[k]; v.tipo = t; ultimoCnpj = ''; infoCnpj.textContent = ''; tipoSeg.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', (k === 0 ? 'PJ' : 'PF') === t)); pintarTipo(); });
    pintarTipo();
    const msg = h('div', { class: 'muted' });
    const fundo = h('div', { class: 'cp-modal-bg' });
    const fechar = () => fundo.remove();
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    const mandar = async (simular) => {
      const doc = String(v.doc || '').replace(/\D/g, '');
      const nome = v.tipo === 'PJ' ? v.razaoSocial : v.nome;
      if (!simular && !confirm(`Cadastrar no AppNext?\n\n${nome || '(sem nome)'}\n${v.tipo === 'PJ' ? 'CNPJ' : 'CPF'} ${doc}\nCEP ${v.cep || ''}, nº ${v.numero || 'S/N'}\n\nO robô preenche Parceiros → Cadastrar e salva. O endereço sai do CEP.`)) return;
      msg.className = 'muted'; msg.textContent = 'Enviando ao robô…';
      try {
        const j = await nfeApi('POST', 'nfe/parceiro', { loja, simular, ...v });
        fechar();
        aoPedir(j.parceiro.id);
      } catch (e) { msg.className = 'neg'; msg.textContent = e.message; }
    };
    fundo.append(h('div', { class: 'card cp-copiar np-modal' },
      h('h3', null, 'Cadastrar parceiro novo no AppNext'),
      h('p', { class: 'muted' }, 'O robô preenche Parceiros → Cadastrar no AppNext e salva. Rua, bairro, cidade e UF vêm do CEP. Entra no grupo "Clientes". Depois ele já aparece na nota.'),
      tipoSeg, corpoTipo,
      h('div', { class: 'np-grade' }, campo('Telefone', inp('telefone', 'DDD + número (opcional)', { inputmode: 'tel' })),
        h('div', { class: 'np-campo-cheio' }, campo('CEP', (() => { const c = inp('cep', '00000-000', { inputmode: 'numeric' }); c.addEventListener('input', () => { clearTimeout(tCep); tCep = setTimeout(consultarCep, 400); }); return c; })()), infoCep),
        campo('Número', inp('numero', 'S/N se não tiver')), campo('Complemento', inp('complemento', 'opcional'))),
      msg,
      h('div', { class: 'cp-acoes' }, h('button', { type: 'button', class: 'btn', title: 'O robô preenche e confere, mas não salva', onclick: () => mandar(true) }, 'Testar sem salvar'), h('span', { style: { flex: 1 } }),
        h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Cancelar'), h('button', { type: 'button', class: 'btn primary', onclick: () => mandar(false) }, 'Cadastrar no AppNext'))));
    document.body.append(fundo);
    const primeiro = fundo.querySelector('input'); if (primeiro) primeiro.focus();
  }

  TS.abrirFormParceiro = abrirFormParceiro;

  function lista(loja, j) {
    const f = state.f;
    const todas = (j.notas || []).map((n) => ({ ...n, dia: TS.isoToDay(n.data), nfTxt: `${n.numero ?? '—'}${n.serie ? ' / ' + n.serie : ''}`, destNome: (n.dest && n.dest.nome) || '', docBusca: n.dest ? `${n.dest.doc || ''} ${docTxt(n.dest.doc)}` : '' }));
    if (!todas.length) {
      return TS.card('Notas de saída', null, h('p', { class: 'muted' }, j.temXml
        ? 'Nenhuma NF-e (modelo 55) nos XMLs guardados desta loja. As NFC-e do caixa ficam em Vendas → Cupons.'
        : 'O painel ainda não tem os XMLs desta loja. Eles chegam pela coleta de XML (Configurações → Dados e atualização → Importar histórico, com "XML das notas").'));
    }
    const noPer = (n) => (f.de == null || n.dia >= f.de) && (f.ate == null || n.dia <= f.ate);
    const FIL = { per: ['No período', noPer], todas: ['Todas', () => true] };
    const fil = FIL[state.nfsFil] ? state.nfsFil : 'per';
    const rows = todas.filter(FIL[fil][1]);
    const ativas = rows.filter((r) => r.situacao !== 'cancelada');
    const tab = TS.table({ linhaMob: { nome: 'nfTxt', val: 'valor', l2: ['destNome', 'natOp', 'situacao'], l3: ['acoes'] }, // celular em linhas (LMOB-04)
        
      cols: [
        // compacta: cada coluna junta duas informações para caber sem rolagem horizontal
        { key: 'nfTxt', label: 'NF / emissão', align: 'l', render: (r) => h('span', null, h('a', { href: '#', class: 'prc-nome', onclick: (e) => { e.preventDefault(); e.stopPropagation(); abrir(loja, r.chave); } }, r.nfTxt), h('small', { class: 'est-tam' }, quando(r.emissao))), sortVal: (r) => r.emissao || '' },
        { key: 'destNome', label: 'Destinatário', align: 'l', wrap: true, render: (r) => h('span', null, r.destNome || '—', h('small', { class: 'est-tam' }, r.dest && r.dest.doc ? docLink(r.dest) : null, r.dest && r.dest.mun ? `${r.dest && r.dest.doc ? ' · ' : ''}${r.dest.mun}${r.dest.uf ? ' - ' + r.dest.uf : ''}` : null)) },
        { key: 'natOp', label: 'Natureza', align: 'l', wrap: true, render: (r) => h('span', null, r.natOp || '—', h('small', { class: 'est-tam' }, [r.cfops && r.cfops.length ? 'CFOP ' + r.cfops.join(', ') : null, r.itens != null ? `${fmt.int(r.itens)} ${r.itens === 1 ? 'item' : 'itens'}` : null].filter(Boolean).join(' · '))) },
        { key: 'situacao', label: 'Situação', align: 'l', render: (r) => situ(r.situacao) },
        { key: 'valor', label: 'Valor', fmt: (v) => (v == null ? '—' : fmt.brl(v)), cls: (r) => (r.situacao === 'cancelada' ? 'nf-riscado' : '') },
        { key: 'acoes', label: '', align: 'l', sortVal: () => 0, render: (r) => h('span', { class: 'nf-acoes' },
          h('a', { class: 'btn prc-ver', href: url('danfe', loja, r.chave), target: '_blank', rel: 'noopener', title: 'DANFE para imprimir ou salvar em PDF', onclick: (e) => e.stopPropagation() }, 'DANFE'),
          TS.demo ? null : h('a', { class: 'btn prc-ver', href: url('xml', loja, r.chave), title: 'Baixar o XML da nota', onclick: (e) => e.stopPropagation() }, 'XML')) },
      ],
      rows, sortKey: 'emissao', maxHeight: '560px', search: 'Buscar NF, destinatário, CPF/CNPJ ou natureza…', searchKeys: ['nfTxt', 'destNome', 'docBusca', 'natOp'], cls: 'est-t',
      rowClass: (r) => (r.situacao === 'cancelada' ? 'nf-linha-cancelada' : null),
      onRowClick: (r) => abrir(loja, r.chave), // a linha inteira abre a nota (produtos, destinatário, valores), como na entrada
      total: { nfTxt: `${fmt.int(rows.length)} notas`, valor: ativas.reduce((a, r) => a + (r.valor || 0), 0) },
      imprimir: ['nfTxt', 'destNome', 'natOp', 'situacao', 'valor'],
      empty: fil === 'per' ? 'Nenhuma NF-e no período do filtro. Veja "Todas".' : 'Nenhuma nota.',
    });
    const canc = rows.length - ativas.length;
    return TS.cardWithTools('Notas de saída (NF-e)', `NF-e emitidas pela loja, lidas dos XMLs do AppNext. O total soma só as autorizadas${canc ? ` (${fmt.int(canc)} cancelada${canc > 1 ? 's' : ''} fora da soma)` : ''}. Clique no número da nota para ver os itens; "DANFE" abre a nota pronta para imprimir ou salvar em PDF.`,
      h('div', { class: 'est-tools' }, tab.searchBox && (tab.searchBox.classList.add('est-busca'), tab.searchBox),
        TS.seg(Object.entries(FIL).map(([k, [t, fn]]) => [`${t} (${fmt.int(todas.filter(fn).length)})`, k]), fil, (v) => { state.nfsFil = v; TS.render(); })),
      tab);
  }

  async function abrir(loja, chave, opts) {
    const sobrepor = !!(opts && opts.sobrepor) || !!document.querySelector('.prc-drawer-camada');
    document.querySelector('.prc-popup-camada')?.remove();
    if (!sobrepor) document.querySelector('.prc-drawer-camada')?.remove();
    const fechar = () => {
      camada.remove();
      if (!document.querySelector('.prc-drawer-camada, .prc-popup-camada, .camada-cheia')) document.body.classList.remove('com-camada');
      document.removeEventListener('keydown', esc, true);
    };
    const esc = (e) => {
      if (e.key === 'Escape') {
        if (sobrepor) { e.preventDefault(); e.stopImmediatePropagation(); }
        fechar();
      }
    };
    const card = h('aside', { class: sobrepor ? 'card prc-popup prc-drawer-largo' : 'card prc-drawer prc-drawer-largo', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Nota fiscal de saída' },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: () => fechar() }, '✕'),
      h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Abrindo a nota…'))));
    const camada = h('div', { class: sobrepor ? 'prc-popup-camada' : 'prc-drawer-camada', onmousedown: (e) => { if (e.target === camada) fechar(); } }, card);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', esc, true);
    let n;
    try {
      const r = await fetch(url('nota', loja, chave), { credentials: 'same-origin' });
      n = await r.json();
      if (!r.ok) throw new Error(n.erro || 'Falha ao abrir a nota.');
    } catch (e) { card.lastChild.replaceWith(h('div', { class: 'notice err' }, e.message)); return; }
    const d = n.dest || {}, t = n.total || {};
    // custo e margem de cada item (só para quem vê custos): custo do cadastro do AppNext (chá a granel: kg × tamanho + embalagem)
    let M = null;
    try { M = TS.custosLoja ? await TS.custosLoja() : null; } catch { M = null; }
    const itens = (n.itens || []).map((r) => {
      let c = M ? M.custoCadastro(r.cod, r.desc) : null;
      // chá a granel vendido em kg (ex.: transferência): o custo do kg do estoque
      if (!c && M && M.porCod && /^kg$/i.test(String(r.un || ''))) { const it = M.porCod.get(String(r.cod)); if (it && it.custo) c = { custo: it.custo }; }
      const cu = c ? Math.round(c.custo * 100) / 100 : null;
      const liq = r.qtd ? ((r.vProd || 0) - (r.vDesc || 0)) / r.qtd : null;
      return { ...r, custo: cu, margem: cu != null && liq ? (liq - cu) / liq : null };
    });
    const tab = TS.table({ linhaMob: { nome: 'desc', val: 'vProd', l2: ['qtd', 'vUn', 'vDesc', 'custo', 'margem'] }, // celular em linhas (LMOB-04)
        
      cols: [
        { key: 'desc', label: 'Produto', align: 'l', sticky: true, wrap: true, render: (r) => h('span', null, r.desc, h('small', { class: 'est-tam' }, `cód. ${r.cod || '—'}${r.ncm ? ' · NCM ' + r.ncm : ''}${r.cfop ? ' · CFOP ' + r.cfop : ''}`)) },
        { key: 'qtd', label: 'Qtd', render: (r) => `${fmt.n2(r.qtd).replace(/,00$/, '')} ${String(r.un || '').toLowerCase()}`, sortVal: (r) => r.qtd },
        { key: 'vUn', label: 'Valor unit.', fmt: (v) => (v == null ? '—' : fmt.brl(v)) },
        { key: 'vDesc', label: 'Desconto', fmt: (v) => (v ? fmt.brl(v) : '—') },
        { key: 'vProd', label: 'Total', fmt: fmt.brl },
        ...(M ? [
          { key: 'custo', label: 'Custo unit.', title: 'Custo do cadastro do AppNext (chá a granel: custo do kg × tamanho + embalagem)', fmt: (v) => (v == null ? '—' : fmt.brl(v)) },
          { key: 'margem', label: 'Margem', title: '(valor unitário com desconto − custo) ÷ valor unitário com desconto', render: (r) => (r.margem == null ? '—' : h('span', { class: r.margem < 0 ? 'neg' : '' }, fmt.pct(r.margem, 1))), sortVal: (r) => r.margem ?? -99 },
        ] : []),
      ],
      rows: itens, sortKey: 'vProd', maxHeight: '50vh', search: 'Buscar produto…', searchKeys: ['desc', 'cod'], cls: 'est-t',
      total: { desc: `${fmt.int((n.itens || []).length)} itens`, vProd: (n.itens || []).reduce((a, r) => a + (r.vProd || 0), 0), vDesc: (n.itens || []).reduce((a, r) => a + (r.vDesc || 0), 0) },
    });
    const end = d.end ? [d.end.linha, [d.end.mun, d.end.uf].filter(Boolean).join(' - '), d.end.cep ? 'CEP ' + d.end.cep : ''].filter(Boolean).join(' · ') : '';
    card.replaceChildren(...[card.firstChild,
      h('div', { class: 'card-title' }, `NF-e ${n.numero ?? '—'}${n.serie ? ' / série ' + n.serie : ''} `, situ(n.situacao)),
      h('div', { class: 'card-sub' }, [n.natOp, n.tipo, n.finalidade && n.finalidade !== 'Normal' ? n.finalidade : null].filter(Boolean).join(' · ')),
      h('div', { class: 'prc-resumo' },
        h('div', null, h('small', null, 'Emissão'), h('b', null, quando(n.emissao))),
        h('div', null, h('small', null, 'Itens'), h('b', null, fmt.int((n.itens || []).length))),
        h('div', null, h('small', null, 'Valor da nota'), h('b', null, t.vNF != null ? fmt.brl(t.vNF) : '—')),
        ...(() => { // margem da nota (só com custo de todos os itens)
          if (!M || !itens.length || itens.some((r) => r.custo == null)) return [];
          const venda = itens.reduce((a, r) => a + (r.vProd || 0) - (r.vDesc || 0), 0), custo = itens.reduce((a, r) => a + r.custo * r.qtd, 0);
          return venda > 0 ? [h('div', null, h('small', null, 'Margem bruta'), h('b', null, `${fmt.pct((venda - custo) / venda, 1)} · ${fmt.brl(venda - custo)}`))] : [];
        })()),
      h('div', { class: 'nf-dest' }, h('small', null, 'Destinatário'), h('b', null, d.nome || '—'), h('span', null, d.tipoDoc ? d.tipoDoc + ' ' : '', docLink(d)), end ? h('span', { class: 'muted' }, end) : null, d.email ? h('span', { class: 'muted' }, d.email) : null),
      h('div', { class: 'prc-nota-info muted' }, [t.vDesc ? `Desconto ${fmt.brl(t.vDesc)}` : '', t.vFrete ? `Frete ${fmt.brl(t.vFrete)}` : '', t.vICMS ? `ICMS ${fmt.brl(t.vICMS)}` : '', n.protocolo ? `Protocolo ${n.protocolo}${n.autorizadaEm ? ' de ' + quando(n.autorizadaEm) : ''}` : '', `Chave ${n.chave}`].filter(Boolean).join(' · ')),
      n.infCpl ? h('div', { class: 'prc-nota-info muted' }, 'Informações complementares: ' + n.infCpl) : null,
      h('div', { class: 'nf-botoes' },
        h('a', { class: 'btn primary', href: url('danfe', loja, chave), target: '_blank', rel: 'noopener' }, 'DANFE (imprimir / PDF)'),
        TS.demo ? h('span', { class: 'muted' }, 'Na apresentação as notas são fictícias e não têm XML.') : h('a', { class: 'btn', href: url('xml', loja, chave) }, 'Baixar XML'),
        h('button', { type: 'button', class: 'btn', title: 'Copiar a chave de acesso', onclick: (e) => { navigator.clipboard?.writeText(n.chave).then(() => { e.target.textContent = 'Chave copiada ✓'; }); } }, 'Copiar chave')),
      h('div', { class: 'f-label mt' }, 'Produtos da nota'),
      tab].filter(Boolean));
  }
  TS.abrirNFe = (chave, loja = state.loja, opts) => abrir(loja, chave, opts);
})();
