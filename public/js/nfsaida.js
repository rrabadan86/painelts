/* Estoque → Notas fiscais → Saída: NF-e (modelo 55) emitidas pela loja, lidas dos XMLs que o coletor guarda.
   Lista, detalhe com os itens, download do XML original e DANFE para imprimir/salvar em PDF. */
(function () {
  const { h, fmt, state } = TS;

  /** abas Entrada | Saída dentro de Notas fiscais */
  TS.abasNotas = (atual) => h('div', { class: 'nf-abas' }, TS.seg([['Notas de entrada', 'notas'], ['Notas de saída (NF-e emitidas)', 'nfsaida']], atual, (v) => { location.hash = '#' + v; }));

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
  const ESTADO_NFE = { na_fila: ['na fila do robô', 'nfe-st-fila'], ok: ['rascunho salvo no AppNext', 'nfe-st-ok'], teste: ['teste ok: tudo conferiu (nada foi salvo)', 'nfe-st-fila'], erro: ['não foi salvo', 'nfe-st-erro'] };
  const ESQ = (x) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  async function nfeApi(metodo, rota, corpo) {
    const r = await fetch(TS.api(rota), { method: metodo, credentials: 'same-origin', headers: metodo === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha.');
    return j;
  }
  function novaNota(loja) {
    const box = h('div', { class: 'mt nfe-box' });
    let aberto = false, info = null, timer = null, esperandoParc = null;
    const form = { parceiro: null, consumidorFinal: false, vendedorId: '', pagamento: '', itens: [], obs: '' };
    const carregar = async () => {
      try { info = await nfeApi('GET', `nfe?loja=${encodeURIComponent(loja)}`); } catch (e) { info = { erroGeral: e.message }; }
      if (!box.isConnected) return;
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
      if (trabalhando) timer = setTimeout(carregar, 4000);
    };
    const roboVivo = () => {
      const r = info && info.robo;
      if (!r || (r.estado !== 'na_fila' && r.estado !== 'rodando')) return null;
      return h('div', { class: 'nfe-vivo' }, h('div', null, h('span', { class: 'cfg-pulso' }), ' ', h('b', null, r.acao === 'cadastros' ? 'Lendo os cadastros do AppNext…' : r.acao === 'parceiro' ? 'Cadastrando o parceiro no AppNext…' : 'Preenchendo a nota no AppNext…'),
        h('small', { class: 'muted' }, r.estado === 'rodando' ? (r.acao === 'parceiro' ? ' o robô está em Parceiros → Cadastrar' : ' o robô está na tela de Saída de Produtos') : ' na fila do robô')),
        r.aoVivo && r.aoVivo.length ? h('pre', { class: 'inv-log' }, r.aoVivo.slice(-14).join('\n')) : null);
    };
    function pintar() {
      const bt = h('button', { type: 'button', class: 'btn ' + (aberto ? '' : 'primary') }, aberto ? 'Fechar' : '＋ Nova NF-e (rascunho no AppNext)');
      bt.addEventListener('click', () => { aberto = !aberto; pintar(); });
      const ras = (info && info.rascunhos) || [];
      box.replaceChildren(...[
        h('div', { class: 'nfe-topo' }, bt, h('small', { class: 'muted' }, 'O robô preenche a saída no AppNext e salva como rascunho. Quem confere e transmite a nota é a loja, no AppNext.')),
        info && info.erroGeral ? h('div', { class: 'notice err mt' }, info.erroGeral) : null,
        aberto ? formulario() : (info && info.robo && info.robo.acao === 'rascunho' ? roboVivo() : null),
        ras.length ? listaRascunhos(ras.slice(0, aberto ? 3 : 6)) : null].filter(Boolean));
    }
    function listaRascunhos(ras) {
      const ult = info.robo && info.robo.ultima;
      return TS.card('Rascunhos pedidos ao robô', 'Os mais recentes. "Rascunho salvo" = está no AppNext em Estoque → Saída de Produtos, esperando a loja conferir e transmitir.',
        h('div', { class: 'nfe-ras' }, ...ras.map((r) => h('div', { class: 'nfe-ras-l' },
          h('div', null, h('b', null, r.parceiro.nome), h('small', { class: 'muted' }, ` · ${quandoTZ(r.em)} · ${r.por || '—'} · ${fmt.int(r.itens.length)} ${r.itens.length === 1 ? 'produto' : 'produtos'} · ${fmt.brl(r.total)}`)),
          h('span', { class: 'nfe-st ' + ESTADO_NFE[r.estado][1] }, r.estado === 'na_fila' && info.robo && info.robo.estado === 'rodando' && info.robo.id === r.id ? 'o robô está preenchendo' : ESTADO_NFE[r.estado][0]),
          r.estado === 'erro' ? h('div', { class: 'nfe-erro' }, r.erro || 'falhou', ' — nada foi salvo no AppNext.', ult && ult.id === r.id && ult.log && ult.log.length ? h('details', null, h('summary', null, 'log do robô'), h('pre', { class: 'inv-log' }, ult.log.join('\n'))) : null) : null))));
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
          const achou = q.length < 2 ? [] : cad.parceiros.filter((x) => ESQ(x.nome).includes(q) || (qd.length >= 3 && x.doc.includes(qd))).slice(0, 8);
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
      const pintarItens = () => {
        const tot = form.itens.reduce((s, i) => s + Math.round(i.qtd * i.preco * 100) / 100, 0);
        totalEl.textContent = fmt.brl(tot);
        tabela.replaceChildren(...form.itens.map((it, k) => {
          const q = h('input', { class: 'f-input nfe-num', type: 'number', min: 0, step: 'any', value: it.qtd });
          const pr = h('input', { class: 'f-input nfe-num', type: 'number', min: 0, step: '0.01', value: it.preco });
          const lin = h('small', { class: 'nfe-lin' }, fmt.brl(it.qtd * it.preco));
          q.addEventListener('input', () => { it.qtd = Number(q.value) || 0; lin.textContent = fmt.brl(it.qtd * it.preco); totalEl.textContent = fmt.brl(form.itens.reduce((s, i) => s + Math.round(i.qtd * i.preco * 100) / 100, 0)); });
          pr.addEventListener('input', () => { it.preco = Number(pr.value) || 0; lin.textContent = fmt.brl(it.qtd * it.preco); totalEl.textContent = fmt.brl(form.itens.reduce((s, i) => s + Math.round(i.qtd * i.preco * 100) / 100, 0)); });
          return h('div', { class: 'nfe-item' }, h('div', { class: 'nfe-item-n' }, h('b', null, it.nome), h('small', { class: 'muted' }, ` cód. ${it.codigo}${it.un ? ' · ' + it.un : ''}`)),
            h('label', null, 'Qtd ', q), h('label', null, 'R$ ', pr), lin,
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
      const enviar = h('button', { type: 'button', class: 'btn primary', disabled: !!vivo || null }, 'Criar rascunho no AppNext');
      const testar = h('button', { type: 'button', class: 'btn', disabled: !!vivo || null, title: 'O robô preenche a nota no AppNext e confere tudo, mas não salva nada' }, 'Testar sem salvar');
      const mandar = async (simular) => {
        msg.className = 'neg';
        if (!form.parceiro) { msg.textContent = 'Escolha o parceiro.'; return; }
        if (!form.vendedorId) { msg.textContent = 'Escolha o vendedor.'; return; }
        if (!form.pagamento) { msg.textContent = 'Escolha a forma de pagamento.'; return; }
        if (!form.itens.length) { msg.textContent = 'Adicione pelo menos um produto.'; return; }
        if (form.itens.some((i) => !(i.qtd > 0) || !(i.preco > 0))) { msg.textContent = 'Confira quantidade e preço de cada produto.'; return; }
        const tot = form.itens.reduce((s, i) => s + Math.round(i.qtd * i.preco * 100) / 100, 0);
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
        h('div', { class: 'aviso nfe-fixos' }, 'Vai sempre como: [1] Venda · CFOP 5102 · série NF-e · NF-e normal · frete [9] sem frete / [9] sem ocorrência de transporte · endereço padrão do parceiro. Os impostos são calculados pelo AppNext. O robô confere tudo e salva como ', h('b', null, 'rascunho'), ' (não transmite).'),
        h('div', { class: 'cfg-acoes' }, enviar, testar, msg),
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
    const inp = (k, ph, extra = {}) => { const i = h('input', { class: 'f-input', placeholder: ph || '', autocomplete: 'off', ...extra }); i.addEventListener('input', () => { v[k] = i.value; }); return i; };
    const corpoTipo = h('div', { class: 'np-grade' });
    const pintarTipo = () => {
      if (v.tipo === 'PJ') {
        const ie = h('select', { class: 'f-input' }, [['9', 'Não contribuinte'], ['2', 'Contribuinte isento de IE'], ['1', 'Contribuinte de ICMS (tem IE)']].map(([c, t]) => h('option', { value: c, selected: v.tipoIe === c || null }, t)));
        const ieNum = inp('ie', 'só números', { inputmode: 'numeric' });
        const ieBox = campo('Inscrição estadual', ieNum); ieBox.hidden = v.tipoIe !== '1';
        ie.addEventListener('change', () => { v.tipoIe = ie.value; ieBox.hidden = v.tipoIe !== '1'; });
        const crt = h('select', { class: 'f-input' }, [['1', 'Simples Nacional'], ['2', 'Simples Nacional - excesso de sublimite'], ['3', 'Regime Normal'], ['4', 'Simples Nacional - MEI']].map(([c, t]) => h('option', { value: c, selected: v.crt === c || null }, t)));
        crt.addEventListener('change', () => { v.crt = crt.value; });
        corpoTipo.replaceChildren(campo('CNPJ', inp('doc', '00.000.000/0000-00', { inputmode: 'numeric' })), campo('Razão social', inp('razaoSocial', '')),
          campo('Nome fantasia', inp('nomeFantasia', 'se vazio, a razão social')), campo('Situação no ICMS', ie), ieBox, campo('Regime tributário', crt),
          campo('Inscrição municipal', inp('im', 'opcional')));
      } else {
        corpoTipo.replaceChildren(campo('CPF', inp('doc', '000.000.000-00', { inputmode: 'numeric' })), campo('Nome completo', inp('nome', 'nome e sobrenome')),
          campo('Data de nascimento', inp('nascimento', 'DD/MM/AAAA', { inputmode: 'numeric', maxlength: 10 }), 'O AppNext exige a data de nascimento para pessoa física.'), campo('Apelido', inp('apelido', 'se vazio, o primeiro nome')));
      }
    };
    const tipoSeg = TS.seg([['Empresa (CNPJ)', 'PJ'], ['Pessoa física (CPF)', 'PF']], v.tipo, (t) => { for (const k of ['doc', 'nome', 'apelido', 'nascimento', 'razaoSocial', 'nomeFantasia', 'ie', 'im']) delete v[k]; v.tipo = t; tipoSeg.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', (k === 0 ? 'PJ' : 'PF') === t)); pintarTipo(); });
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
      h('div', { class: 'np-grade' }, campo('Telefone', inp('telefone', 'DDD + número (opcional)', { inputmode: 'tel' })), campo('CEP', inp('cep', '00000-000', { inputmode: 'numeric' })),
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
    const tab = TS.table({
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
    const tab = TS.table({
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
