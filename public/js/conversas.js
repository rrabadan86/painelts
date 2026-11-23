/* Clientes → Conversas (decisão do dono): as conversas do WhatsApp da loja, lidas pelo robô do WhatsApp e guardadas no
 * servidor (src/conversas.js, 12 meses). Só admin e franqueado (o servidor confere). Fase 2 (23/11/2026): responder pela
 * conversa, só texto, pelo número da loja (POST /api/conversas/responder). Cada conversa é ligada ao cliente pelo celular do cadastro (com e sem o 9º dígito).
 * Computador (> 860 px): lista à esquerda e conversa à direita, cada coluna rolando sozinha (como o WhatsApp Web).
 * Celular: a lista e, ao tocar, a conversa no lugar dela com "‹ Voltar" (o voltar do celular fecha a conversa). */
(function () {
  'use strict';
  const { h, fmt, state } = TS;
  // rolagem/rolagemLista/ultima: onde a lista estava ao abrir uma conversa (celular); busca e aba ficam entre as visitas
  const st = { aba: 'todas', aberta: null, busca: '', mostrar: 100, rolagem: null, rolagemLista: 0, ultima: null, enviadas: {}, rascunho: {} };

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
    return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}‑${d.slice(-4)}` : chave; // hífen que não quebra a linha
  };
  const TIPO = { imagem: '📷 Foto', video: '🎬 Vídeo', audio: '🎤 Áudio', documento: '📄 Documento', figurinha: '🙂 Figurinha', local: '📍 Localização', contato: '👤 Contato' };
  // ---------- mídia (decisão do dono: "baixar no computador e não armazenar na VPS") ----------
  // O servidor busca no WhatsApp na hora (GET conversas/midia) e não guarda nada; aqui fica só na memória da aba
  // (URL.createObjectURL), e sai ao trocar de conversa.
  const MIDIA = { imagem: ['Ver foto', 'foto'], figurinha: ['Ver figurinha', 'figurinha'], audio: ['Ouvir áudio', 'áudio'], video: ['Ver vídeo', 'vídeo'], documento: ['Baixar documento', 'documento'] };
  const midiaMem = { chave: null, itens: new Map() }; // id da mensagem → { url, tipo, nome }
  function soltarMidias(chave) {
    if (midiaMem.chave === chave) return;
    for (const x of midiaMem.itens.values()) URL.revokeObjectURL(x.url);
    midiaMem.itens.clear(); midiaMem.chave = chave;
  }
  /** espera (só para a nova tentativa) */
  const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
  async function buscarMidia(loja, chave, id, nomeTipo) {
    const url = TS.api(`conversas/midia?loja=${encodeURIComponent(loja)}&chave=${encodeURIComponent(chave)}&id=${encodeURIComponent(id)}`);
    let r;
    // a ligação caiu (internet oscilando ou rede que bloqueia áudio/vídeo, como firewall de empresa): tenta de novo
    // sozinho uma vez, 1,5 s depois, antes de mostrar o erro (pedido do dono, 23/11/2026)
    for (let tentativa = 1; ; tentativa++) {
      try { r = await fetch(url, { credentials: 'same-origin' }); break; }
      catch (e) {
        if (!TS.erroDeRede(e)) throw e;
        if (tentativa >= 2) throw new Error(`A conexão caiu ao buscar ${nomeTipo || 'o arquivo'}. Pode ser a internet ou a rede deste local bloqueando áudio e vídeo (firewall). Toque de novo ou tente em outra rede.`);
        await pausa(1500);
      }
    }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.erro || 'Não consegui buscar no WhatsApp agora.'); }
    let nome = 'arquivo';
    try { nome = decodeURIComponent(r.headers.get('X-Midia-Nome') || '') || nome; } catch { /* fica "arquivo" */ }
    const blob = await r.blob();
    return { url: URL.createObjectURL(blob), tipo: blob.type || r.headers.get('Content-Type') || '', nome };
  }
  /** a área da mídia dentro da bolha: o botão e, depois de buscar, a foto/áudio/vídeo e "Baixar" */
  /** nome de quem fala neste WhatsApp: o "Nome nas mensagens" do vínculo (o marido) ou o do cadastro */
  const nomeConv = (cl) => (TS.nomeMsgDe && TS.nomeMsgDe(cl)) || cl.nome || '';
  const ARTIGO = { imagem: 'a foto', figurinha: 'a figurinha', audio: 'o áudio', video: 'o vídeo', documento: 'o documento' };
  function caixaMidia(loja, chave, m) {
    const [rot, nomeTipo] = MIDIA[m.tipo];
    const caixa = h('div', { class: 'cv-midia' });
    const pintar = (x) => {
      const baixar = h('a', { class: 'btn cv-midia-baixar', href: x.url, download: x.nome }, '⬇ Baixar');
      const ver = /^image\//.test(x.tipo) ? h('a', { href: x.url, target: '_blank', rel: 'noopener', class: 'cv-midia-img', title: 'Abrir grande' }, h('img', { src: x.url, alt: `${nomeTipo} enviada na conversa` }))
        : /^audio\//.test(x.tipo) ? h('audio', { controls: true, src: x.url, preload: 'metadata' })
          : /^video\//.test(x.tipo) ? h('video', { controls: true, src: x.url, preload: 'metadata', class: 'cv-midia-video' })
            : h('small', { class: 'muted' }, 'Este arquivo não abre aqui: use "Baixar".');
      caixa.replaceChildren(ver, baixar);
    };
    const ja = midiaMem.chave === chave && midiaMem.itens.get(m.id);
    if (ja) { pintar(ja); return caixa; }
    const bt = h('button', { type: 'button', class: 'btn cv-midia-bt', title: 'Busca no WhatsApp da loja agora. Não fica guardado no painel: depois de ver, use "Baixar" para salvar no seu computador.' }, rot);
    const erro = h('small', { class: 'neg cv-midia-erro', role: 'alert' });
    bt.addEventListener('click', async () => {
      bt.disabled = true; bt.textContent = 'Buscando no WhatsApp…'; erro.textContent = '';
      try {
        const x = await buscarMidia(loja, chave, m.id, ARTIGO[m.tipo]);
        soltarMidias(chave);
        midiaMem.itens.set(m.id, x);
        pintar(x);
      } catch (e) { erro.textContent = e.message; bt.disabled = false; bt.textContent = rot; }
    });
    caixa.append(bt, erro);
    return caixa;
  }
  const resumoMsg = (m) => [m.deMim ? 'Loja: ' : '', m.tipo !== 'texto' ? TIPO[m.tipo] + (m.texto ? ' · ' : '') : '', m.texto || ''].join('');
  const quando = (iso) => { const d = new Date(iso), hoje = TS.hojeSP(); const dia = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); const hr = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); return dia === hoje ? hr : `${fmt.date(dia).slice(0, 5)} ${hr}`; };
  const LARGO = '(min-width: 861px)'; // computador: lista e conversa lado a lado; celular: uma de cada vez
  const POR_VEZ = 100; // itens da lista desenhados por vez ("Mostrar mais")
  /** iniciais do nome para o círculo da conversa (sem nome: "#") */
  const iniciais = (nome) => { const p = String(nome || '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean); return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '#'; };
  /** cor do círculo: uma de 5 classes fixas (cv-av-0…4 em styles.css), sempre a mesma para o mesmo celular */
  const corAv = (chave) => 'cv-av-' + ([...String(chave)].reduce((x, c) => x + c.charCodeAt(0), 0) % 5);

  /** cliente pediu para não receber mensagens (ficha, fila ou "parar" ao robô) — a marca da lista de contatos da loja */
  const naoQuerDe = (cliente) => { const ct = cliente && TS.cliApi && TS.cliApi.contatoDe(cliente); return !!(ct && ct.optout); };
  TS.pages.conversas = function (root) {
    if (TS.subClientes) root.append(TS.subClientes('conversas'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Conversas'),
      h('div', { class: 'page-sub' }, 'As conversas do WhatsApp da loja, ligadas aos clientes. Responda aqui mesmo: a mensagem sai pelo número da loja.'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'As conversas são de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', { class: 'cv-corpo' }, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Carregando as conversas…'))));
    root.append(corpo);
    const loja = state.loja;
    const mq = window.matchMedia(LARGO);
    const largo = () => mq.matches;
    let dados = null, timer = null, linhas = [];
    st.mostrar = POR_VEZ;

    // ---------- peças que ficam vivas enquanto a tela está aberta (a atualização de 30 s não refaz a tela do zero) ----------
    const elAvisos = h('div', { class: 'cv-avisos' });
    const busca = h('input', { type: 'search', class: 'f-input cv-busca', placeholder: 'Buscar nome, telefone ou mensagem', 'aria-label': 'Buscar conversa', value: st.busca });
    let tBusca = null;
    busca.addEventListener('input', () => { clearTimeout(tBusca); tBusca = setTimeout(() => { st.busca = busca.value; st.mostrar = POR_VEZ; elLista.scrollTop = 0; pintarItens(); }, 200); });
    const elAbas = h('div', { class: 'cv-abas' });
    const elLista = h('ul', { class: 'cv-lista', 'aria-label': 'Conversas, a mais recente primeiro' });
    const elRodape = h('div', { class: 'cv-rodape-lista' });
    // conversa de cliente é privada: esta lista não tem "Imprimir" (sem-imprimir)
    const colLista = h('section', { class: 'card cv-col-lista sem-imprimir', 'aria-label': 'Lista de conversas' },
      h('div', { class: 'card-title cv-col-tit' }, 'Conversas do WhatsApp',
        TS.dica('Toque ou clique numa conversa para ler. A mais recente fica em cima. A etiqueta amarela diz quantas mensagens do cliente chegaram depois da última resposta da loja. A última mensagem que o robô mandou aparece com 🤖.')),
      busca, elAbas, elLista, elRodape);
    const colConv = h('section', { class: 'card cv-conversa', 'aria-label': 'Conversa aberta' });
    const split = h('div', { class: 'cv-split' });

    // o "voltar" do celular fecha a conversa (em vez de sair da tela): no celular, abrir uma conversa cria uma entrada no histórico
    const comEntrada = () => !!(history.state && history.state.conversa);
    const abrirPeloToque = (chave) => {
      if (!largo()) {
        st.rolagem = window.scrollY; st.rolagemLista = elLista.scrollTop;
        if (!comEntrada()) history.pushState({ conversa: chave }, '', location.href);
      }
      st.ultima = chave;
      abrir(chave, true);
    };
    const aoVoltarHist = () => {
      if (!corpo.isConnected) { window.removeEventListener('popstate', aoVoltarHist); return; }
      if (st.aberta && !largo() && !comEntrada()) voltar();
    };
    window.addEventListener('popstate', aoVoltarHist);
    // girou o tablet / mudou a largura da janela: monta no outro jeito, com a mesma conversa aberta
    const aoMudarLargura = () => {
      if (!corpo.isConnected) { mq.removeEventListener('change', aoMudarLargura); return; }
      if (!dados) return;
      montar();
      if (st.aberta) abrir(st.aberta, true);
    };
    mq.addEventListener('change', aoMudarLargura);
    // computador: as duas colunas ocupam a altura que sobra da janela
    const aoRedimensionar = () => { if (!corpo.isConnected) { window.removeEventListener('resize', aoRedimensionar); return; } ajustarAltura(); };
    window.addEventListener('resize', aoRedimensionar, { passive: true });

    // "não quer mensagens" marcado (ou desfeito) na ficha aberta por "Ver cliente": a marca aparece na hora na lista e no topo
    const aoMudarContato = () => {
      if (!corpo.isConnected) { window.removeEventListener('ts-contato', aoMudarContato); return; }
      if (!dados) return;
      pintarItens();
      if (st.aberta) abrir(st.aberta, true);
    };
    window.addEventListener('ts-contato', aoMudarContato);
    // a marca "não quer mensagens" vem da lista de contatos da loja: busca uma vez ao abrir a tela (fora de Clientes ela não vem)
    if (TS.cliApi && TS.cliApi.recarregarContatos) TS.cliApi.recarregarContatos().then(aoMudarContato).catch(() => {});

    const carregar = async () => {
      clearTimeout(timer);
      if (!corpo.isConnected || state.loja !== loja) return;
      if (document.hidden && dados) { timer = setTimeout(carregar, 30000); return; } // página escondida: não busca à toa
      try {
        // na apresentação a tela manda os celulares (fictícios) dos primeiros clientes para montar conversas de mentira
        const extra = TS.demo ? '&fones=' + encodeURIComponent((TS.cli ? TS.cli.lista : []).map(foneDe).filter((x) => x.length >= 12).slice(0, 6).join(',')) : '';
        const primeira = !dados;
        dados = await api('GET', `conversas?loja=${encodeURIComponent(loja)}${extra}`);
        if (!corpo.isConnected) return;
        if (primeira || !elLista.isConnected && !colConv.isConnected) montar(); else { pintarAvisos(); pintarItens(); pintarRodape(); }
        // vinda da ficha do cliente ("Ver conversa"): abre a conversa daquele celular (com e sem o 9º dígito)
        if (TS.abrirConversa) {
          const quer = variantes(TS.abrirConversa); TS.abrirConversa = null;
          const achou = dados.conversas.find((c) => quer.includes(c.chave));
          if (achou) abrirPeloToque(achou.chave); else TS.avisar('Ainda não há conversa guardada com este cliente.');
        } else if (st.aberta) await abrir(st.aberta);
        else if (largo()) vazio();
      } catch (e) {
        // sem internet por um momento: com a lista já na tela, mantém e tenta de novo na próxima volta; sem nada, explica
        if (corpo.isConnected && !(e.rede && dados)) corpo.replaceChildren(h('div', { class: e.rede ? 'notice warn' : 'notice err' }, e.message));
      }
      if (corpo.isConnected) timer = setTimeout(carregar, 30000); // o servidor busca no WhatsApp a cada 30 s
    };

    /** monta a tela: no computador, lista e conversa lado a lado; no celular, só a lista (a conversa entra no lugar dela) */
    function montar() {
      pintarAvisos(); pintarItens(); pintarRodape();
      if (largo()) {
        split.replaceChildren(colLista, colConv);
        corpo.replaceChildren(elAvisos, split);
        if (!st.aberta) vazio();
        ajustarAltura();
        requestAnimationFrame(ajustarAltura); setTimeout(ajustarAltura, 400); // de novo depois que o resto da página assentar
      } else {
        corpo.replaceChildren(elAvisos, colLista);
      }
    }
    /** computador: as duas colunas vão até o pé da janela e rolam sozinhas (a página não rola junto) */
    function ajustarAltura() {
      if (!largo() || !split.isConnected) return;
      split.style.removeProperty('--cv-alto');
      const topo = split.getBoundingClientRect().top + window.scrollY;
      // as colunas terminam 16 px acima do pé da janela (o rodapé do painel fica abaixo, para quem rolar até ele)
      split.style.setProperty('--cv-alto', Math.max(440, Math.round(window.innerHeight - Math.min(topo, window.innerHeight * 0.45) - 16)) + 'px');
    }

    /** "‹ Voltar" (celular): se a conversa tem entrada no histórico, consome (o popstate chama voltar); senão volta direto */
    const botaoVoltar = () => { if (comEntrada()) history.back(); else voltar(); };
    /** volta para a lista no mesmo lugar em que a pessoa estava (mesma aba, busca e rolagem; a conversa aberta fica marcada) */
    function voltar() {
      st.aberta = null;
      montar();
      const y = st.rolagem, yl = st.rolagemLista;
      requestAnimationFrame(() => {
        if (yl) elLista.scrollTop = yl;
        if (y != null) window.scrollTo(0, y);
      });
    }

    function pintarAvisos() {
      elAvisos.replaceChildren(...[
        !dados.servico ? h('div', { class: 'notice' }, 'O robô do WhatsApp não está instalado neste servidor: as conversas não são lidas.') : null,
        dados.servico && !dados.conectado ? h('div', { class: 'notice warn' }, 'O WhatsApp da loja não está conectado: as conversas novas não chegam. Conecte em Clientes → Campanhas → "Conectar e configurar".') : null,
        h('div', { class: 'cv-sit' }, h('small', { class: 'muted' }, dados.buscadoEm ? `Atualizado às ${quando(dados.buscadoEm)}` : 'Ainda não buscou nenhuma conversa',
          TS.dica('O painel busca as mensagens novas no WhatsApp da loja a cada 30 segundos (enviadas e recebidas, pelo celular, pelo WhatsApp Web ou pelo robô). Fotos e áudios aparecem só como marca.')),
          h('small', { class: 'muted cv-priv' }, `🔒 Só o franqueado e o admin veem · guardado ${dados.meses} meses · some se o WhatsApp for desconectado`)),
      ].filter(Boolean));
    }

    /** a lista: abas com contagem, busca e os itens (a mais recente em cima). A atualização refaz os itens sem perder a
     *  rolagem da lista, a busca, a aba nem a conversa marcada */
    function pintarItens() {
      const cli = mapaClientes();
      linhas = dados.conversas.map((c) => {
        const cliente = cli.get(c.chave) || null;
        const nome = cliente ? nomeConv(cliente) : c.nome || '';
        return { ...c, cliente, nomeTxt: nome || foneTxt(c.chave), cadTxt: cliente && TS.nomeMsgDe(cliente) ? cliente.nome || '' : '', ultTxt: resumoMsg(c.ult) };
      }).sort((a, b) => b.ult.em.localeCompare(a.ult.em));
      const conta = { todas: linhas.length, semresp: linhas.filter((x) => x.semResposta).length, clientes: linhas.filter((x) => x.cliente).length, sem: linhas.filter((x) => !x.cliente).length };
      if (st.aba === 'naolidas') st.aba = 'semresp';
      elAbas.replaceChildren(TS.seg([
        [`Todas (${conta.todas})`, 'todas', 'Todas as conversas guardadas (últimos ' + dados.meses + ' meses).'],
        [`Sem resposta (${conta.semresp})`, 'semresp', 'A última mensagem é do cliente: a loja ainda não respondeu (pelo celular da loja, pelo WhatsApp Web ou pelo robô).'],
        [`Clientes (${conta.clientes})`, 'clientes', 'O celular é de um cliente do painel (cadastro do FIXE ou das compras com CPF).'],
        [`Sem cadastro (${conta.sem})`, 'sem', 'O celular não bate com nenhum cliente do painel: pode ser alguém que ainda não comprou com CPF.'],
      ], st.aba, (v) => { st.aba = v; st.mostrar = POR_VEZ; elLista.scrollTop = 0; pintarItens(); }));
      const q = TS.norm(st.busca).trim(), qd = soDig(st.busca);
      const sel = linhas.filter((x) => (st.aba === 'semresp' ? x.semResposta : st.aba === 'clientes' ? x.cliente : st.aba === 'sem' ? !x.cliente : true))
        .filter((x) => !q || TS.norm(`${x.nomeTxt} ${x.cadTxt} ${x.ult.texto || ''}`).includes(q) || (qd.length >= 3 && x.chave.includes(qd)));
      const manter = elLista.scrollTop;
      const itens = sel.slice(0, st.mostrar).map(item);
      if (!sel.length) itens.push(h('li', { class: 'cv-vazio muted' }, !dados.conversas.length ? 'Ainda não há conversas guardadas. Elas aparecem conforme chegam; para trazer as antigas, use "Reimportar histórico".' : q ? 'Nenhuma conversa com essa busca.' : 'Nenhuma conversa nesta aba.'));
      if (sel.length > st.mostrar) itens.push(h('li', { class: 'cv-mais-l' }, h('button', { type: 'button', class: 'btn cv-mais', onclick: () => { st.mostrar += POR_VEZ; pintarItens(); } }, `Mostrar mais (${fmt.int(sel.length - st.mostrar)})`)));
      elLista.replaceChildren(...itens);
      elLista.scrollTop = manter;
    }
    /** um item da lista: botão (abre pelo teclado com Enter e Espaço), a conversa aberta marcada com aria-current */
    function item(x) {
      const marcada = x.chave === (st.aberta || st.ultima);
      return h('li', null, h('button', { type: 'button', class: 'cv-item' + (marcada ? ' cv-ultima' : ''), 'aria-current': marcada ? 'true' : null, 'data-chave': x.chave, onclick: () => abrirPeloToque(x.chave) },
        h('span', { class: 'cv-av ' + corAv(x.chave), 'aria-hidden': 'true' }, x.cliente || x.nome ? iniciais(x.nomeTxt) : '#'),
        h('span', { class: 'cv-item-c' },
          h('span', { class: 'cv-item-l1' }, h('b', { class: 'cv-item-nome' }, x.nomeTxt), h('small', { class: 'cv-item-hora' }, quando(x.ult.em))),
          x.cadTxt ? h('small', { class: 'muted cv-item-cad' }, `cadastro: ${x.cadTxt}`) : null,
          h('small', { class: 'cv-item-ult' }, x.ult.robo ? '🤖 ' : '', x.ultTxt),
          x.semResposta || !x.cliente || naoQuerDe(x.cliente) ? h('span', { class: 'cv-item-et' }, ...[
            x.semResposta ? h('span', { class: 'badge warn', title: 'Mensagens do cliente depois da última resposta da loja: a conversa espera resposta.' }, `${fmt.int(x.semResposta)} sem resposta`) : null,
            naoQuerDe(x.cliente) ? h('span', { class: 'badge erro', title: 'Pediu para não receber mensagens: o painel e o robô não enviam.' }, '🚫 não quer') : null,
            x.cliente ? null : h('span', { class: 'badge cinza' }, 'sem cadastro'),
          ].filter(Boolean)) : null)));
    }
    /** marca na lista a conversa aberta, sem redesenhar */
    function marcar(chave) {
      for (const b of elLista.querySelectorAll('.cv-item')) {
        const on = b.dataset.chave === chave;
        b.classList.toggle('cv-ultima', on);
        if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      }
    }

    /** fim da coluna: "Reimportar histórico" (discreto, nunca o primeiro botão da tela) */
    function pintarRodape() {
      const hist = dados.historico;
      const bt = h('button', { type: 'button', class: 'btn cv-reimp', title: 'Traz de novo as conversas dos últimos 30 dias do WhatsApp da loja (o que já está guardado não se repete). Leva alguns minutos.' }, '↻ Reimportar histórico');
      bt.disabled = !dados.conectado || (hist && hist.estado === 'rodando') || null;
      bt.addEventListener('click', async () => {
        if (TS.demo) { TS.avisar(TS.DEMO_AVISO); return; }
        bt.disabled = true;
        try { await api('POST', 'conversas/historico', { loja, dias: 30 }); TS.avisar('Importando as conversas dos últimos 30 dias. Elas aparecem aqui em alguns minutos.'); } catch (e) { TS.avisarErro(e); bt.disabled = false; }
      });
      const histTxt = !hist ? '' : hist.estado === 'rodando' ? '⏳ importando o histórico…' : hist.estado === 'ok' ? `histórico importado (${fmt.int(hist.mensagens || 0)} mensagens novas)` : `a importação do histórico falhou: ${hist.erro || 'erro'}`;
      elRodape.replaceChildren(bt, h('small', { class: 'muted' }, histTxt || 'Traz as conversas dos últimos 30 dias.'));
    }

    /** computador, sem conversa aberta: a coluna da direita diz o que fazer (não abre nenhuma sozinha) */
    function vazio() {
      const sr = linhas.filter((x) => x.semResposta).length;
      colConv.classList.add('cv-conv-vazia');
      colConv.replaceChildren(h('div', { class: 'cv-escolha' }, h('div', { class: 'cv-escolha-ico', 'aria-hidden': 'true' }, '💬'),
        h('b', null, 'Escolha uma conversa à esquerda'),
        h('small', { class: 'muted' }, sr ? `${fmt.int(sr)} ${sr === 1 ? 'conversa espera' : 'conversas esperam'} resposta da loja (aba "Sem resposta").` : 'Nenhuma conversa esperando resposta da loja.')));
    }

    /** responder pela conversa (fase 2, aprovada pelo dono em 23/11/2026): texto só; sai pelo número da loja */
    function caixaResposta(chave, cliente) {
      if (!/^\d{10,15}$/.test(chave)) return h('p', { class: 'muted cv-resp-nao' }, 'O WhatsApp não informou o número desta conversa: responda pelo WhatsApp da loja.');
      if (!TS.demo && !dados.conectado) return h('p', { class: 'muted cv-resp-nao' }, 'O WhatsApp da loja não está conectado: para responder, conecte em Clientes → Campanhas → "Conectar e configurar" ou use o WhatsApp da loja.');
      const txt = h('textarea', { class: 'f-input cv-resp-txt', rows: 2, maxlength: 2000, placeholder: 'Escreva a resposta…', 'aria-label': 'Resposta para o cliente' });
      txt.value = st.rascunho[chave] || '';
      const bt = h('button', { type: 'button', class: 'btn primary cv-resp-bt' }, 'Enviar');
      const enviar = async (confirmado) => {
        const texto = txt.value.trim();
        if (!texto) { txt.focus(); return; }
        bt.disabled = true;
        try {
          await api('POST', 'conversas/responder', { loja, chave, texto, cpf: cliente ? cliente.cpf : undefined, confirmado: confirmado === true || undefined });
        } catch (e) {
          bt.disabled = false;
          if (/não receber mensagens/.test(e.message) && confirmado !== true) {
            if (await TS.janelaConfirmar('🚫 Este cliente pediu para não receber mensagens', [h('p', null, 'Responder mesmo assim? Use só se ele mesmo escreveu pedindo algo.')], 'Responder mesmo assim', 'Não enviar')) enviar(true);
            return;
          }
          TS.naoSalvo ? TS.naoSalvo(e, txt) : TS.avisarErro(e); return;
        }
        st.rascunho[chave] = '';
        (st.enviadas[chave] = st.enviadas[chave] || []).push({ deMim: true, pendente: true, tipo: 'texto', texto, em: new Date().toISOString(), por: TS.eu && TS.eu.nome });
        abrir(chave, true);
        // o WhatsApp devolve a mensagem em alguns segundos: busca de novo para trocar "enviando…" pela de verdade
        if (!TS.demo) { setTimeout(() => { if (st.aberta === chave) abrir(chave); }, 4000); setTimeout(() => { if (st.aberta === chave) abrir(chave); }, 15000); }
      };
      bt.addEventListener('click', () => enviar());
      txt.addEventListener('input', () => { st.rascunho[chave] = txt.value; });
      txt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviar(); } });
      return h('div', { class: 'cv-resp' }, txt, bt);
    }

    async function abrir(chave, topo) {
      st.aberta = chave;
      soltarMidias(chave); // outra conversa: as mídias da anterior saem da memória
      let msgs;
      try { msgs = (await api('GET', `conversas/mensagens?loja=${encodeURIComponent(loja)}&chave=${encodeURIComponent(chave)}`)).mensagens; } catch (e) { TS.avisarErro(e); if (st.aberta === chave) st.aberta = null; return; }
      if (!corpo.isConnected || st.aberta !== chave) return;
      // atualização de 30 em 30 s com a conversa aberta: sem mensagem nova, não mexe em nada (a leitura continua onde estava);
      // com mensagem nova e a pessoa lendo mais acima, mantém a posição e mostra "↓ N novas"
      const velha = !topo && colConv.isConnected && colConv.querySelector('.cv-msgs');
      const antes = velha && velha.dataset.chave === chave ? { n: Number(velha.dataset.n) || 0, top: velha.scrollTop, noFim: velha.scrollHeight - velha.scrollTop - velha.clientHeight < 40, y: window.scrollY } : null;
      if (antes && antes.n === msgs.length) return;
      const c = (dados.conversas || []).find((x) => x.chave === chave) || { chave };
      const cliente = mapaClientes().get(chave) || null;
      const nome = cliente ? nomeConv(cliente) : c.nome || foneTxt(chave);
      const cadDe = cliente && TS.nomeMsgDe(cliente) ? cliente.nome || '' : ''; // o cadastro (fidelidade) é de outra pessoa
      // ficha resumida do cliente (os mesmos dados da lista de clientes)
      const fx = cliente && cliente.fx;
      const ficha = cliente ? h('div', { class: 'cv-ficha' }, ...[
        cliente.chaFavorito ? h('span', { class: 'chip' }, '🍵 ', cliente.chaFavorito) : null,
        cliente.ultima != null ? h('span', { class: 'chip' }, 'última compra ', fmt.date(TS.dayToIso(cliente.ultima))) : null,
        fx ? h('span', { class: 'chip' }, `★ ${fmt.int(fx.saldo || 0)} pts`) : null,
        cliente.vendedoraPref ? h('span', { class: 'chip' }, 'atende: ', cliente.vendedoraPref) : null,
        naoQuerDe(cliente) ? h('span', { class: 'badge erro cv-naoquer', title: 'Pediu para não receber mensagens: o painel e o robô não enviam para este cliente e ele saiu das listas de campanha. Para desfazer: "Ver cliente" → "Voltou a aceitar".' }, '🚫 não quer mensagens') : null,
        cliente.celVinc && TS.cliApi.mesmoTel(cliente.celular, chave) ? h('small', { class: 'muted cv-vinc-nota' }, `Número ligado a este cliente pelo painel${cliente.celVinc.em ? ' em ' + fmt.date(cliente.celVinc.em.slice(0, 10)) : ''}: é o que vale no Hoje, nas campanhas e no robô.`) : null,
      ].filter(Boolean)) : h('div', { class: 'cv-ficha' }, h('span', { class: 'badge cinza' }, 'sem cadastro'), h('small', { class: 'muted' }, ' Este celular não bate com nenhum cliente do painel.'));
      // mensagens, com o dia em separador
      let dia = '';
      const bolhas = [];
      // respostas enviadas agora pelo painel que o WhatsApp ainda não devolveu (na apresentação, ficam só na memória)
      const pend = (st.enviadas[chave] || []).filter((p) => !msgs.some((m) => m.deMim && m.texto === p.texto && Date.parse(m.em) >= Date.parse(p.em) - 120e3));
      st.enviadas[chave] = pend;
      for (const m of [...msgs, ...pend]) {
        const d = new Date(m.em).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        if (d !== dia) { dia = d; bolhas.push(h('div', { class: 'cv-dia' }, h('span', null, d === TS.hojeSP() ? 'Hoje' : fmt.date(d)))); }
        bolhas.push(h('div', { class: 'cv-msg ' + (m.deMim ? 'eu' : 'ele') + (m.robo ? ' robo' : '') },
          h('small', { class: 'cv-meta' }, m.deMim ? (m.robo ? `🤖 robô · ${m.robo}` : m.pendente ? `Loja · ${m.por || 'você'} · ${TS.demo ? 'apresentação, nada foi enviado' : 'enviando…'}` : m.por ? `Loja · ${m.por}` : 'Loja') : (cliente ? nomeConv(cliente).split(' ')[0] : m.nome || 'Cliente'), ' · ', new Date(m.em).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })),
          m.tipo !== 'texto' ? h('div', { class: 'cv-tipo' }, TIPO[m.tipo] || m.tipo) : null,
          MIDIA[m.tipo] ? caixaMidia(loja, chave, m) : null,
          m.texto ? h('div', { class: 'cv-txt' }, m.texto) : null));
      }
      const lista = h('div', { class: 'cv-msgs', 'data-chave': chave, 'data-n': String(msgs.length) }, ...(bolhas.length ? bolhas : [TS.empty('Sem mensagens guardadas nesta conversa.')]));
      const novas = antes && !antes.noFim ? msgs.length - antes.n : 0;
      const btNovas = novas > 0 ? h('button', { type: 'button', class: 'btn cv-novas', onclick: () => { lista.scrollTo({ top: lista.scrollHeight, behavior: 'smooth' }); btNovas.remove(); } }, `↓ ${fmt.int(novas)} ${novas === 1 ? 'nova' : 'novas'}`) : null;
      if (btNovas) lista.addEventListener('scroll', () => { if (lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40) btNovas.remove(); }, { passive: true });
      colConv.classList.remove('cv-conv-vazia');
      colConv.replaceChildren(
        h('div', { class: 'cv-topo' },
          h('span', { class: 'cv-av ' + corAv(chave), 'aria-hidden': 'true' }, cliente || c.nome ? iniciais(nome) : '#'),
          h('div', { class: 'cv-topo-c' }, h('b', { class: 'cv-nome' }, nome), cadDe ? h('small', { class: 'muted cv-cad', title: 'O cadastro da fidelidade (CPF, pontos e compras) é desta pessoa; quem usa este WhatsApp é quem está no nome acima.' }, `cadastro: ${cadDe}`) : null, h('small', { class: 'muted cv-fone' }, foneTxt(chave))),
          h('div', { class: 'cv-topo-acoes' }, ...[
            cliente ? h('button', { type: 'button', class: 'btn', onclick: () => TS.cliApi.abrirClientes([cliente.cpf]) }, 'Ver cliente') : null,
            botaoVinculo(chave, cliente),
            botaoNome(chave, cliente),
          ].filter(Boolean))),
        ficha, h('div', { class: 'cv-msgs-w' }, lista, btNovas),
        caixaResposta(chave, cliente),
        h('p', { class: 'muted cv-rodape' }, '🔒 Só o franqueado e o admin respondem por aqui. A mensagem sai pelo WhatsApp da loja; o texto não fica em log nem auditoria.',
          msgs.some((m) => MIDIA[m.tipo]) ? h('span', null, ' Fotos e áudios vêm do WhatsApp na hora e não ficam guardados no painel.', TS.dica('Ao tocar em "Ver foto" ou "Ouvir áudio", o painel pede ao WhatsApp da loja naquele momento e mostra só para você. Nada fica guardado no servidor (decisão do dono). Para guardar, use "Baixar": o arquivo vai para o seu computador ou celular. Foto muito antiga pode não estar mais disponível no WhatsApp.')) : null));
      if (largo()) {
        // computador: a lista continua ao lado; só marca a conversa aberta
        if (!split.isConnected) montar();
        marcar(chave);
      } else if (topo || !colConv.isConnected) {
        // celular: a conversa entra no lugar da lista, com o "‹ Voltar" abaixo da barra fixa do topo
        corpo.replaceChildren(h('div', { class: 'cp-acoes' }, h('button', { type: 'button', class: 'btn', onclick: botaoVoltar }, '‹ Voltar')), colConv);
        const topoFixo = (document.querySelector('.topbar') || { offsetHeight: 60 }).offsetHeight + 12;
        window.scrollTo(0, Math.max(0, corpo.getBoundingClientRect().top + window.scrollY - topoFixo));
      }
      if (antes) {
        if (!largo()) window.scrollTo(0, antes.y);
        lista.scrollTop = antes.noFim ? lista.scrollHeight : antes.top; // estava no fim: acompanha a nova; lendo acima: fica onde estava
        return;
      }
      lista.scrollTop = lista.scrollHeight; // abre na mensagem mais nova
    }

    // ---------- vínculo da conversa com o cliente (o cliente trocou de número: decisão do dono) ----------
    /** "Vincular a um cliente" (sem cadastro), "Outro cliente?" (bate com alguém) ou "Desfazer vínculo" (trocado pelo painel) */
    function botaoVinculo(chave, cliente) {
      if (!/^\d{12,13}$/.test(chave) || !TS.cliApi || !TS.cliApi.aplicarCelular) return null; // sem o telefone (lid): não dá para ligar
      if (cliente && cliente.celVinc && TS.cliApi.mesmoTel(cliente.celular, chave)) {
        return h('button', { type: 'button', class: 'btn ghost-danger', title: 'Volta a usar o celular do FIXE para este cliente (Hoje, campanhas e robô). Esta conversa fica sem cliente.', onclick: () => desfazerVinculo(chave, cliente) }, 'Desfazer vínculo');
      }
      return h('button', { type: 'button', class: cliente ? 'btn' : 'btn primary', title: 'O cliente trocou de número? Ligue esta conversa ao cadastro dele: este número passa a ser o celular dele no painel (Hoje, campanhas e robô). O FIXE não muda.',
        onclick: () => escolherCliente(chave, cliente) }, cliente ? 'É outro cliente?' : 'Vincular a um cliente');
    }
    /** janela de busca: nome ou CPF entre os clientes que a tela já tem */
    function escolherCliente(chave, atual) {
      const todos = (TS.cliApi.universo ? TS.cliApi.universo() : (TS.cli && TS.cli.lista) || []).filter((c) => c && c.cpf);
      const fundo = h('div', { class: 'cp-modal-bg' });
      const fechar = () => fundo.remove();
      const busca = h('input', { class: 'f-input', type: 'search', placeholder: 'Nome ou CPF do cliente', 'aria-label': 'Buscar cliente', autocomplete: 'off' });
      const res = h('ul', { class: 'cv-vinc-lista', role: 'list' });
      const pintar = () => {
        const q = TS.norm(busca.value.trim()), qd = soDig(busca.value);
        if (q.length < 2 && qd.length < 3) { res.replaceChildren(h('li', { class: 'muted cv-vinc-dica' }, 'Digite pelo menos 2 letras do nome ou 3 números do CPF.')); return; }
        const achou = todos.filter((c) => (q.length >= 2 && TS.norm(c.nome || '').includes(q)) || (qd.length >= 3 && String(c.cpf).includes(qd))).slice(0, 12);
        res.replaceChildren(...(achou.length ? achou.map((c) => h('li', null, h('button', { type: 'button', class: 'cv-vinc-item', onclick: () => { fechar(); confirmarVinculo(chave, c); } },
          h('b', null, c.nome || 'Cliente sem nome'), h('small', { class: 'muted' }, `CPF ${String(c.cpf).slice(0, 3)}.***.***-${String(c.cpf).slice(-2)}`, c.celular ? ` · celular ${foneTxt(foneDe(c) || soDig(c.celular))}` : ' · sem celular')))) : [h('li', { class: 'muted cv-vinc-dica' }, 'Nenhum cliente com esse nome ou CPF.')]));
      };
      busca.addEventListener('input', TS.debounce ? TS.debounce(pintar, 200) : pintar);
      fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
      fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
      fundo.append(h('div', { class: 'card cp-copiar ts-perg cv-vinc', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Vincular a um cliente' },
        h('h3', null, 'De quem é este número?'),
        h('p', { class: 'muted' }, `${foneTxt(chave)}. Escolha o cliente: este número passa a ser o celular dele no painel.`, atual ? ` Hoje ele bate com ${atual.nome || 'outro cliente'}.` : ''),
        busca, res,
        h('div', { class: 'ts-perg-acoes' }, h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Cancelar'))));
      document.body.append(fundo);
      pintar();
      busca.focus();
    }
    /** depois de vincular/desfazer: a lista e a conversa aberta mostram o cliente certo (sem perder a posição da leitura) */
    function refazerConversa(chave) {
      const v = colConv.querySelector('.cv-msgs');
      if (v) v.dataset.n = '-1'; // força redesenhar a conversa aberta
      pintarItens();
      abrir(chave, false);
    }
    async function confirmarVinculo(chave, c) {
      const fixe = c.celVinc ? c.celFixe : c.celular;
      const ok = await TS.janelaConfirmar('Trocar o celular do cliente?', [
        h('p', null, 'O celular de ', h('b', null, c.nome || 'este cliente'), ' passa a ser ', h('b', null, foneTxt(chave)), ' no painel (Hoje, campanhas e robô).'),
        fixe ? h('p', null, `O número do FIXE, ${foneTxt(foneDe({ celular: fixe }) || soDig(fixe))}, deixa de ser usado. O FIXE não muda.`) : h('p', null, 'No FIXE ele está sem celular. O FIXE não muda.'),
        h('p', { class: 'muted' }, 'Se outro cliente tiver este mesmo número, ele fica sem celular no painel. Dá para desfazer aqui na conversa.'),
      ], 'Trocar o celular');
      if (!ok) return;
      try {
        const r = await api('POST', 'clientes/celular', { loja, cpf: c.cpf, cel: chave });
        TS.cliApi.aplicarCelular(c.cpf, r.vinculo);
        refazerConversa(chave);
      } catch (e) { TS.avisarErro(e); }
    }
    /** nome nas mensagens (decisão do dono, 23/11/2026): o cadastro é de uma pessoa (a esposa) e o WhatsApp de outra (o marido) */
    function botaoNome(chave, cliente) {
      if (!cliente || !cliente.celVinc || !TS.cliApi.mesmoTel(cliente.celular, chave) || !TS.cliApi.nomearCelular) return null;
      const nm = cliente.celVinc.nome || '';
      return h('button', { type: 'button', class: 'btn cv-nome-msg', title: 'O WhatsApp é de outra pessoa (ex.: o cadastro está no nome da esposa e quem usa o número é o marido)? Escreva como chamar quem usa este número: {nome} das mensagens sai com ele, e o aniversário (que é da pessoa do cadastro) não entra no Hoje, nas campanhas nem no robô. O cadastro do FIXE não muda.',
        onclick: () => nomearVinculo(chave, cliente) }, nm ? `Mensagens para: ${nm}` : 'Nome nas mensagens');
    }
    async function nomearVinculo(chave, c) {
      const v = await TS.perguntar('Como chamar quem usa este WhatsApp?', { valor: (c.celVinc && c.celVinc.nome) || '', max: 40, rotulo: 'Nome nas mensagens', dica: 'Ex.: Paulo (deixe vazio para usar o nome do cadastro)' });
      if (v == null) return;
      try {
        const r = await api('POST', 'clientes/celular/nome', { loja, cpf: c.cpf, nome: v });
        TS.cliApi.nomearCelular(c.cpf, r.nome || '');
        refazerConversa(chave);
      } catch (e) { TS.avisarErro(e); }
    }
    async function desfazerVinculo(chave, c) {
      const ok = await TS.janelaConfirmar('Desfazer o vínculo?', [
        h('p', null, h('b', null, c.nome || 'O cliente'), ' volta a usar o celular do FIXE', c.celFixe ? `, ${foneTxt(foneDe({ celular: c.celFixe }) || soDig(c.celFixe))},` : '', ' no painel. Esta conversa fica sem cliente.'),
      ], 'Desfazer');
      if (!ok) return;
      try {
        await api('POST', 'clientes/celular/desfazer', { loja, cpf: c.cpf });
        TS.cliApi.aplicarCelular(c.cpf, null);
        refazerConversa(chave);
      } catch (e) { TS.avisarErro(e); }
    }

    setTimeout(carregar, 0); // depois que a tela entra na página (o roteador anexa a raiz em seguida)
    // voltou para a página (desbloqueou o celular, trocou de aplicativo e voltou): atualiza na hora
    const aoVoltar = () => { if (!corpo.isConnected) { document.removeEventListener('visibilitychange', aoVoltar); return; } if (!document.hidden) carregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
  };
})();
