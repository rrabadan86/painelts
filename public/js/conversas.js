/* Clientes → Conversas (decisão do dono): as conversas do WhatsApp da loja, lidas pelo robô do WhatsApp e guardadas no
 * servidor (src/conversas.js, 12 meses). Só admin e franqueado (o servidor confere). Fase 1: só leitura — responder é pelo
 * WhatsApp da loja. Cada conversa é ligada ao cliente pelo celular do cadastro (com e sem o 9º dígito). */
(function () {
  'use strict';
  const { h, fmt, state } = TS;
  const st = { aba: 'todas', aberta: null, tabEstado: {}, rolagem: null, ultima: null }; // rolagem/ultima: onde a lista estava ao abrir uma conversa

  /** pedido ao servidor. Falha de rede (celular pausou a página, internet caiu) espera a página voltar e tenta de novo uma
   *  vez; se continuar, o erro sai em português e marcado com `rede` (a tela mantém o que já mostrava) */
  async function api(met, url, corpo, tentou) {
    let r;
    try {
      r = await fetch(TS.api(url), { method: met, credentials: 'same-origin', headers: { 'X-Painel': '1', ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    } catch (e) {
      if (!TS.erroDeRede(e)) throw e;
      if (!tentou) { await TS.esperarVisivel(); return api(met, url, corpo, true); }
      const x = new Error('Sem conexão com o painel agora. As conversas voltam a atualizar sozinhas quando a internet voltar.'); x.rede = true; throw x;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não deu certo.');
    return j;
  }
  const soDig = (v) => String(v || '').replace(/\D/g, '');
  /** o mesmo celular com e sem o 9º dígito (contas antigas do WhatsApp ficaram sem o 9) */
  const variantes = (n) => {
    const out = [n], m = /^55(\d{2})(\d+)$/.exec(n);
    if (m) { if (m[2].length === 9 && m[2][0] === '9') out.push(`55${m[1]}${m[2].slice(1)}`); else if (m[2].length === 8) out.push(`55${m[1]}9${m[2]}`); }
    return out;
  };
  /** o celular do cadastro no formato da conversa (55 + DDD + número), o mesmo do link do WhatsApp (msgwpp.js) */
  const foneDe = (c) => soDig(TS.msgWpp.linkDoCelular(c && c.celular));
  TS.foneConversa = foneDe;
  /** telefone → cliente do painel (pelo celular do cadastro) */
  function mapaClientes() {
    const m = new Map();
    const lista = TS.cliApi && TS.cliApi.universo ? TS.cliApi.universo() : (TS.cli && TS.cli.lista) || [];
    for (const c of lista) {
      const d = foneDe(c);
      if (d.length >= 12) for (const v of variantes(d)) if (!m.has(v)) m.set(v, c);
    }
    return m;
  }
  const foneTxt = (chave) => {
    if (!/^\d+$/.test(chave)) return 'número não informado pelo WhatsApp';
    const d = chave.startsWith('55') ? chave.slice(2) : chave;
    return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}\u2011${d.slice(-4)}` : chave; // hífen que não quebra a linha
  };
  const TIPO = { imagem: '📷 Foto', video: '🎬 Vídeo', audio: '🎤 Áudio', documento: '📄 Documento', figurinha: '🙂 Figurinha', local: '📍 Localização', contato: '👤 Contato' };
  const resumoMsg = (m) => [m.deMim ? 'Loja: ' : '', m.tipo !== 'texto' ? TIPO[m.tipo] + (m.texto ? ' · ' : '') : '', m.texto || ''].join('');
  const quando = (iso) => { const d = new Date(iso), hoje = TS.hojeSP(); const dia = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); const hr = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); return dia === hoje ? hr : `${fmt.date(dia).slice(0, 5)} ${hr}`; };

  TS.pages.conversas = function (root) {
    if (TS.subClientes) root.append(TS.subClientes('conversas'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Conversas'),
      h('div', { class: 'page-sub' }, 'As conversas do WhatsApp da loja, ligadas aos clientes. Para responder, use o WhatsApp da loja.'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'As conversas são de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Carregando as conversas…'))));
    root.append(corpo);
    const loja = state.loja;
    let dados = null, timer = null;
    // o "voltar" do celular fecha a conversa (em vez de sair da tela): abrir uma conversa cria uma entrada no histórico
    const comEntrada = () => !!(history.state && history.state.conversa);
    const abrirPeloToque = (chave) => {
      if (!comEntrada()) history.pushState({ conversa: chave }, '', location.href);
      abrir(chave, true);
    };
    const aoVoltarHist = () => {
      if (!corpo.isConnected) { window.removeEventListener('popstate', aoVoltarHist); return; }
      if (st.aberta && !comEntrada()) voltar();
    };
    window.addEventListener('popstate', aoVoltarHist);
    const carregar = async () => {
      clearTimeout(timer);
      if (!corpo.isConnected || state.loja !== loja) return;
      if (document.hidden && dados) { timer = setTimeout(carregar, 30000); return; } // página escondida: não busca à toa
      try {
        // na apresentação a tela manda os celulares (fictícios) dos primeiros clientes para montar conversas de mentira
        const extra = TS.demo ? '&fones=' + encodeURIComponent((TS.cli ? TS.cli.lista : []).map(foneDe).filter((x) => x.length >= 12).slice(0, 6).join(',')) : '';
        dados = await api('GET', `conversas?loja=${encodeURIComponent(loja)}${extra}`);
        if (!corpo.isConnected) return;
        // vinda da ficha do cliente ("Ver conversa"): abre a conversa daquele celular (com e sem o 9º dígito)
        if (TS.abrirConversa) {
          const quer = variantes(TS.abrirConversa); TS.abrirConversa = null;
          const achou = dados.conversas.find((c) => quer.includes(c.chave));
          if (achou) { abrirPeloToque(achou.chave); return; }
          TS.avisar('Ainda não há conversa guardada com este cliente.');
        }
        if (st.aberta) await abrir(st.aberta); else pintarLista();
      } catch (e) {
        // sem internet por um momento: com a lista já na tela, mantém e tenta de novo na próxima volta; sem nada, explica
        if (corpo.isConnected && !(e.rede && dados)) corpo.replaceChildren(h('div', { class: e.rede ? 'notice warn' : 'notice err' }, e.message));
      }
      if (corpo.isConnected) timer = setTimeout(carregar, 30000); // o servidor busca no WhatsApp a cada 30 s
    };

    /** "‹ Voltar": se a conversa tem entrada no histórico, consome (o popstate chama voltar); senão volta direto */
    const botaoVoltar = () => { if (comEntrada()) history.back(); else voltar(); };
    /** volta para a lista no mesmo lugar em que a pessoa estava (mesma aba, página e rolagem; a conversa aberta fica marcada) */
    function voltar() {
      st.aberta = null;
      pintarLista();
      // a lista rola dentro do próprio quadro (barra interna) e a página também: volta as duas
      const y = st.rolagem, yl = st.rolagemLista;
      requestAnimationFrame(() => {
        const tw = corpo.querySelector('.table-wrap');
        if (tw && yl) tw.scrollTop = yl;
        if (y != null) window.scrollTo(0, y);
      });
    }

    function pintarLista() {
      st.aberta = null;
      // a atualização de 30 em 30 s redesenha a lista: a barra interna dela não volta para o topo
      const tw0 = corpo.querySelector('.table-wrap'), manter = tw0 ? tw0.scrollTop : 0;
      const cli = mapaClientes();
      const linhas = dados.conversas.map((c) => {
        const cliente = cli.get(c.chave) || null;
        const nome = cliente ? cliente.nome : c.nome || '';
        return { ...c, cliente, nomeTxt: nome || foneTxt(c.chave), fone: foneTxt(c.chave), ultTxt: resumoMsg(c.ult), quandoSort: c.ult.em };
      });
      const conta = { todas: linhas.length, semresp: linhas.filter((x) => x.semResposta).length, clientes: linhas.filter((x) => x.cliente).length, sem: linhas.filter((x) => !x.cliente).length };
      if (st.aba === 'naolidas') st.aba = 'semresp';
      const sel = linhas.filter((x) => (st.aba === 'semresp' ? x.semResposta : st.aba === 'clientes' ? x.cliente : st.aba === 'sem' ? !x.cliente : true));
      const seg = TS.seg([
        [`Todas (${conta.todas})`, 'todas', 'Todas as conversas guardadas (últimos ' + dados.meses + ' meses).'],
        [`Sem resposta (${conta.semresp})`, 'semresp', 'A última mensagem é do cliente: a loja ainda não respondeu (pelo celular da loja, pelo WhatsApp Web ou pelo robô).'],
        [`Clientes (${conta.clientes})`, 'clientes', 'O celular é de um cliente do painel (cadastro do FIXE ou das compras com CPF).'],
        [`Sem cadastro (${conta.sem})`, 'sem', 'O celular não bate com nenhum cliente do painel: pode ser alguém que ainda não comprou com CPF.'],
      ], st.aba, (v) => { st.aba = v; st.tabEstado = {}; pintarLista(); });
      const tab = TS.table({
        cols: [
          { key: 'nomeTxt', label: 'Conversa', align: 'l', sticky: true, wrap: true, title: 'Nome do cliente do painel (ou o nome que a pessoa usa no WhatsApp) e a última mensagem.',
            render: (x) => h('span', { class: 'cv-quem' }, h('span', { class: 'cv-nomel' }, h('b', null, x.nomeTxt), x.semResposta ? h('span', { class: 'badge warn', title: 'Mensagens do cliente depois da última resposta da loja: a conversa espera resposta.' }, `${fmt.int(x.semResposta)} sem resposta`) : null), x.cliente ? null : h('span', { class: 'badge cinza' }, 'sem cadastro'), h('small', { class: 'muted cv-ult' }, x.ult.robo ? '🤖 ' : '', x.ultTxt)) },
          { key: 'quandoSort', label: 'Última', align: 'r', title: 'Quando foi a última mensagem (hoje só a hora). A etiqueta amarela ao lado do nome diz quantas mensagens do cliente chegaram depois da última resposta da loja.', render: (x) => quando(x.ult.em) },
        ],
        rows: sel.map((x) => ({ ...x, busca: `${x.nomeTxt} ${x.fone} ${x.chave} ${x.ult.texto || ''}` })), search: 'Buscar nome ou telefone', searchKeys: ['nomeTxt', 'busca'],
        sortKey: 'quandoSort', sortDir: 'desc', estado: st.tabEstado, rowClass: (x) => (x.chave === st.ultima ? 'cv-ultima' : null),
        onRowClick: (x) => { const tw = corpo.querySelector('.table-wrap'); st.rolagem = window.scrollY; st.rolagemLista = tw ? tw.scrollTop : 0; st.ultima = x.chave; abrirPeloToque(x.chave); },
        empty: dados.conversas.length ? 'Nenhuma conversa nesta aba.' : 'Ainda não há conversas guardadas. Elas aparecem conforme chegam; para trazer as antigas, use "Reimportar histórico".',
      });
      // lista no topo: as contagens ficam nas abas (sem quadros de número antes); "Reimportar histórico" vai para o fim do cartão
      const card = TS.cardWithTools('Conversas do WhatsApp', 'Toque ou clique numa conversa para ler. A última mensagem que o robô mandou aparece com 🤖.', h('div', { class: 'cv-ferr' }, tab.searchBox), h('div', null, seg, tab), rodape());
      card.classList.add('sem-imprimir'); // conversa de cliente é privada: esta lista não tem "Imprimir"
      corpo.replaceChildren(...[avisos(), card].filter(Boolean));
      if (manter) { const tw = corpo.querySelector('.table-wrap'); if (tw) tw.scrollTop = manter; }
    }

    function rodape() {
      const hist = dados.historico;
      const bt = h('button', { type: 'button', class: 'btn', title: 'Traz de novo as conversas dos últimos 30 dias do WhatsApp da loja (o que já está guardado não se repete). Leva alguns minutos.' }, '↻ Reimportar histórico');
      bt.disabled = !dados.conectado || (hist && hist.estado === 'rodando') || null;
      bt.addEventListener('click', async () => {
        if (TS.demo) { TS.avisar(TS.DEMO_AVISO); return; }
        bt.disabled = true;
        try { await api('POST', 'conversas/historico', { loja, dias: 30 }); TS.avisar('Importando as conversas dos últimos 30 dias. Elas aparecem aqui em alguns minutos.'); } catch (e) { TS.avisarErro(e); bt.disabled = false; }
      });
      const histTxt = !hist ? '' : hist.estado === 'rodando' ? '⏳ importando o histórico…' : hist.estado === 'ok' ? `histórico importado (${fmt.int(hist.mensagens || 0)} mensagens novas)` : `a importação do histórico falhou: ${hist.erro || 'erro'}`;
      return h('div', { class: 'cv-rodape-lista' }, bt, h('small', { class: 'muted' }, histTxt || 'Traz de novo as conversas dos últimos 30 dias (o que já está guardado não se repete).'));
    }
    function avisos() {
      return h('div', null,
        !dados.servico ? h('div', { class: 'notice' }, 'O robô do WhatsApp não está instalado neste servidor: as conversas não são lidas.') : null,
        dados.servico && !dados.conectado ? h('div', { class: 'notice warn' }, 'O WhatsApp da loja não está conectado: as conversas novas não chegam. Conecte em Clientes → Campanhas → "Conectar e configurar".') : null,
        h('div', { class: 'cv-sit' }, h('small', { class: 'muted' }, dados.buscadoEm ? `Atualizado às ${quando(dados.buscadoEm)}` : 'Ainda não buscou nenhuma conversa',
          TS.dica('O painel busca as mensagens novas no WhatsApp da loja a cada 30 segundos (enviadas e recebidas, pelo celular, pelo WhatsApp Web ou pelo robô). Fotos e áudios aparecem só como marca.')),
          h('small', { class: 'muted cv-priv' }, `🔒 Só o franqueado e o admin veem · guardado ${dados.meses} meses · some se o WhatsApp for desconectado`)));
    }

    async function abrir(chave, topo) {
      st.aberta = chave;
      let msgs;
      try { msgs = (await api('GET', `conversas/mensagens?loja=${encodeURIComponent(loja)}&chave=${encodeURIComponent(chave)}`)).mensagens; } catch (e) { TS.avisarErro(e); st.aberta = null; return; }
      if (!corpo.isConnected || st.aberta !== chave) return;
      // atualização de 30 em 30 s com a conversa aberta: sem mensagem nova, não mexe em nada (a leitura continua onde estava);
      // com mensagem nova e a pessoa lendo mais acima, mantém a posição e mostra "↓ N novas"
      const velha = !topo && corpo.querySelector('.cv-msgs');
      const antes = velha && velha.dataset.chave === chave ? { n: Number(velha.dataset.n) || 0, top: velha.scrollTop, noFim: velha.scrollHeight - velha.scrollTop - velha.clientHeight < 40, y: window.scrollY } : null;
      if (antes && antes.n === msgs.length) return;
      const c = (dados.conversas || []).find((x) => x.chave === chave) || { chave };
      const cliente = mapaClientes().get(chave) || null;
      const nome = cliente ? cliente.nome : c.nome || foneTxt(chave);
      // ficha resumida do cliente (os mesmos dados da lista de clientes)
      const fx = cliente && cliente.fx;
      const ficha = cliente ? h('div', { class: 'cv-ficha' }, ...[
        cliente.chaFavorito ? h('span', { class: 'chip' }, '🍵 ', cliente.chaFavorito) : null,
        cliente.ultima != null ? h('span', { class: 'chip' }, 'última compra ', fmt.date(TS.dayToIso(cliente.ultima))) : null,
        fx ? h('span', { class: 'chip' }, `★ ${fmt.int(fx.saldo || 0)} pts`) : null,
        cliente.vendedoraPref ? h('span', { class: 'chip' }, 'atende: ', cliente.vendedoraPref) : null,
        h('button', { type: 'button', class: 'btn', onclick: () => TS.cliApi.abrirClientes([cliente.cpf]) }, 'Ver cliente'),
      ].filter(Boolean)) : h('div', { class: 'cv-ficha' }, h('span', { class: 'badge cinza' }, 'sem cadastro'), h('small', { class: 'muted' }, ' Este celular não bate com nenhum cliente do painel.'));
      // mensagens, com o dia em separador
      let dia = '';
      const bolhas = [];
      for (const m of msgs) {
        const d = new Date(m.em).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        if (d !== dia) { dia = d; bolhas.push(h('div', { class: 'cv-dia' }, h('span', null, d === TS.hojeSP() ? 'Hoje' : fmt.date(d)))); }
        bolhas.push(h('div', { class: 'cv-msg ' + (m.deMim ? 'eu' : 'ele') + (m.robo ? ' robo' : '') },
          h('small', { class: 'cv-meta' }, m.deMim ? (m.robo ? `🤖 robô · ${m.robo}` : 'Loja') : (cliente ? cliente.nome.split(' ')[0] : m.nome || 'Cliente'), ' · ', new Date(m.em).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })),
          m.tipo !== 'texto' ? h('div', { class: 'cv-tipo' }, TIPO[m.tipo] || m.tipo) : null,
          m.texto ? h('div', { class: 'cv-txt' }, m.texto) : null));
      }
      const lista = h('div', { class: 'cv-msgs', 'data-chave': chave, 'data-n': String(msgs.length) }, ...(bolhas.length ? bolhas : [TS.empty('Sem mensagens guardadas nesta conversa.')]));
      const novas = antes && !antes.noFim ? msgs.length - antes.n : 0;
      const btNovas = novas > 0 ? h('button', { type: 'button', class: 'btn cv-novas', onclick: () => { lista.scrollTo({ top: lista.scrollHeight, behavior: 'smooth' }); btNovas.remove(); } }, `↓ ${fmt.int(novas)} ${novas === 1 ? 'nova' : 'novas'}`) : null;
      if (btNovas) lista.addEventListener('scroll', () => { if (lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40) btNovas.remove(); }, { passive: true });
      corpo.replaceChildren(
        h('div', { class: 'cp-acoes' }, h('button', { type: 'button', class: 'btn', onclick: botaoVoltar }, '‹ Voltar')),
        h('div', { class: 'card cv-conversa' },
          h('div', { class: 'cv-topo' }, h('div', null, h('b', { class: 'cv-nome' }, nome), h('small', { class: 'muted cv-fone' }, ' ', foneTxt(chave)))),
          ficha, h('div', { class: 'cv-msgs-w' }, lista, btNovas),
          h('p', { class: 'muted cv-rodape' }, '🔒 Só leitura por enquanto: para responder, use o WhatsApp da loja (a resposta aparece aqui em seguida).')));
      if (antes) {
        window.scrollTo(0, antes.y);
        lista.scrollTop = antes.noFim ? lista.scrollHeight : antes.top; // estava no fim: acompanha a nova; lendo acima: fica onde estava
        return;
      }
      // a conversa aparece do começo, com o "‹ Voltar" abaixo da barra fixa do topo
      const topoFixo = (document.querySelector('.topbar') || { offsetHeight: 60 }).offsetHeight + 12;
      if (topo) window.scrollTo(0, Math.max(0, corpo.getBoundingClientRect().top + window.scrollY - topoFixo));
      lista.scrollTop = lista.scrollHeight; // abre na mensagem mais nova
    }

    setTimeout(carregar, 0); // depois que a tela entra na página (o roteador anexa a raiz em seguida)
    // voltou para a página (desbloqueou o celular, trocou de aplicativo e voltou): atualiza na hora
    const aoVoltar = () => { if (!corpo.isConnected) { document.removeEventListener('visibilitychange', aoVoltar); return; } if (!document.hidden) carregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
  };
})();
