/* Clientes → Conversas (decisão do dono): as conversas do WhatsApp da loja, lidas pelo robô do WhatsApp e guardadas no
 * servidor (src/conversas.js, 12 meses). Só admin e franqueado (o servidor confere). Fase 1: só leitura — responder é pelo
 * WhatsApp da loja. Cada conversa é ligada ao cliente pelo celular do cadastro (com e sem o 9º dígito). */
(function () {
  'use strict';
  const { h, fmt, state } = TS;
  const st = { aba: 'todas', aberta: null, tabEstado: {} };

  async function api(met, url, corpo) {
    const r = await fetch(TS.api(url), { method: met, credentials: 'same-origin', headers: { 'X-Painel': '1', ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
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
    return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : chave;
  };
  const TIPO = { imagem: '📷 Foto', video: '🎬 Vídeo', audio: '🎤 Áudio', documento: '📄 Documento', figurinha: '🙂 Figurinha', local: '📍 Localização', contato: '👤 Contato' };
  const resumoMsg = (m) => [m.deMim ? 'Loja: ' : '', m.tipo !== 'texto' ? TIPO[m.tipo] + (m.texto ? ' · ' : '') : '', m.texto || ''].join('');
  const quando = (iso) => { const d = new Date(iso), hoje = TS.hojeSP(); const dia = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); const hr = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); return dia === hoje ? hr : `${fmt.date(dia).slice(0, 5)} ${hr}`; };

  TS.pages.conversas = function (root) {
    if (TS.subClientes) root.append(TS.subClientes('conversas'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Conversas'),
      h('div', { class: 'page-sub' }, 'As conversas do WhatsApp da loja, ligadas aos clientes. Só admin e franqueado veem; para responder, use o WhatsApp da loja.'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'As conversas são de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Carregando as conversas…'))));
    root.append(corpo);
    const loja = state.loja;
    let dados = null, timer = null;
    const carregar = async () => {
      clearTimeout(timer);
      if (!corpo.isConnected || state.loja !== loja) return;
      try {
        // na apresentação a tela manda os celulares (fictícios) dos primeiros clientes para montar conversas de mentira
        const extra = TS.demo ? '&fones=' + encodeURIComponent((TS.cli ? TS.cli.lista : []).map(foneDe).filter((x) => x.length >= 12).slice(0, 6).join(',')) : '';
        dados = await api('GET', `conversas?loja=${encodeURIComponent(loja)}${extra}`);
        if (!corpo.isConnected) return;
        // vinda da ficha do cliente ("Ver conversa"): abre a conversa daquele celular (com e sem o 9º dígito)
        if (TS.abrirConversa) {
          const quer = variantes(TS.abrirConversa); TS.abrirConversa = null;
          const achou = dados.conversas.find((c) => quer.includes(c.chave));
          if (achou) st.aberta = achou.chave; else TS.avisar('Ainda não há conversa guardada com este cliente.');
        }
        if (st.aberta) await abrir(st.aberta); else pintarLista();
      } catch (e) { if (corpo.isConnected) corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
      if (corpo.isConnected) timer = setTimeout(carregar, 30000); // o servidor busca no WhatsApp a cada 30 s
    };

    function pintarLista() {
      st.aberta = null;
      const cli = mapaClientes();
      const linhas = dados.conversas.map((c) => {
        const cliente = cli.get(c.chave) || null;
        const nome = cliente ? cliente.nome : c.nome || '';
        return { ...c, cliente, nomeTxt: nome || foneTxt(c.chave), fone: foneTxt(c.chave), ultTxt: resumoMsg(c.ult), quandoSort: c.ult.em };
      });
      const conta = { todas: linhas.length, naolidas: linhas.filter((x) => x.naoLidas).length, clientes: linhas.filter((x) => x.cliente).length, sem: linhas.filter((x) => !x.cliente).length };
      const sel = linhas.filter((x) => (st.aba === 'naolidas' ? x.naoLidas : st.aba === 'clientes' ? x.cliente : st.aba === 'sem' ? !x.cliente : true));
      const seg = TS.seg([
        [`Todas (${conta.todas})`, 'todas', 'Todas as conversas guardadas (últimos ' + dados.meses + ' meses).'],
        [`Não lidas (${conta.naolidas})`, 'naolidas', 'Com mensagem do cliente que ninguém abriu aqui no painel.'],
        [`Clientes (${conta.clientes})`, 'clientes', 'O celular é de um cliente do painel (cadastro do FIXE ou das compras com CPF).'],
        [`Sem cadastro (${conta.sem})`, 'sem', 'O celular não bate com nenhum cliente do painel: pode ser alguém que ainda não comprou com CPF.'],
      ], st.aba, (v) => { st.aba = v; st.tabEstado = {}; pintarLista(); });
      const tab = TS.table({
        cols: [
          { key: 'nomeTxt', label: 'Conversa', align: 'l', sticky: true, wrap: true, title: 'Nome do cliente do painel (ou o nome que a pessoa usa no WhatsApp) e a última mensagem.',
            render: (x) => h('span', { class: 'cv-quem' }, h('span', { class: 'cv-nomel' }, h('b', null, x.nomeTxt), x.naoLidas ? h('span', { class: 'badge ok', title: 'Mensagens do cliente depois da última vez que alguém abriu a conversa aqui.' }, `${fmt.int(x.naoLidas)} ${x.naoLidas === 1 ? 'nova' : 'novas'}`) : null), x.cliente ? null : h('span', { class: 'badge cinza' }, 'sem cadastro'), h('small', { class: 'muted cv-ult' }, x.ultTxt)) },
          { key: 'quandoSort', label: 'Última', align: 'r', title: 'Quando foi a última mensagem (hoje só a hora). A etiqueta verde ao lado do nome diz quantas mensagens do cliente ninguém abriu aqui.', render: (x) => quando(x.ult.em) },
        ],
        rows: sel.map((x) => ({ ...x, busca: `${x.nomeTxt} ${x.fone} ${x.chave} ${x.ult.texto || ''}` })), search: 'Buscar nome, telefone ou palavra', searchKeys: ['nomeTxt', 'busca'],
        sortKey: 'quandoSort', sortDir: 'desc', estado: st.tabEstado, onRowClick: (x) => abrir(x.chave),
        empty: dados.conversas.length ? 'Nenhuma conversa nesta aba.' : 'Ainda não há conversas guardadas. Elas aparecem conforme chegam; para trazer as antigas, use "Reimportar histórico".',
      });
      corpo.replaceChildren(...[avisos(), h('div', { class: 'grid g-kpi' },
        TS.kpi('Conversas', fmt.int(conta.todas), `dos últimos ${dados.meses} meses`, 'Conversas individuais do WhatsApp da loja guardadas no painel (grupos não entram).'),
        TS.kpi('Não lidas', fmt.int(conta.naolidas), 'com mensagem nova do cliente', 'Conversas com mensagem do cliente que ninguém abriu aqui no painel. Abrir a conversa marca como lida.'),
        TS.kpi('Sem cadastro', fmt.int(conta.sem), 'celular sem cliente no painel', 'Quem conversou com a loja mas não tem cadastro com este celular: oportunidade de cadastrar no FIXE na próxima compra.')),
      TS.cardWithTools('Conversas do WhatsApp', 'Clique numa conversa para ler. As do robô aparecem com 🤖 e o nome da campanha.', h('div', { class: 'cv-ferr' }, tab.searchBox), h('div', null, seg, tab))].filter(Boolean));
    }

    function avisos() {
      const hist = dados.historico;
      const bt = h('button', { type: 'button', class: 'btn', title: 'Traz de novo as conversas dos últimos 30 dias do WhatsApp da loja (o que já está guardado não se repete). Leva alguns minutos.' }, '↻ Reimportar histórico');
      bt.disabled = !dados.conectado || (hist && hist.estado === 'rodando') || null;
      bt.addEventListener('click', async () => {
        if (TS.demo) { TS.avisar(TS.DEMO_AVISO); return; }
        bt.disabled = true;
        try { await api('POST', 'conversas/historico', { loja, dias: 30 }); TS.avisar('Importando as conversas dos últimos 30 dias. Elas aparecem aqui em alguns minutos.'); } catch (e) { TS.avisarErro(e); bt.disabled = false; }
      });
      const histTxt = !hist ? '' : hist.estado === 'rodando' ? ' · ⏳ importando o histórico…' : hist.estado === 'ok' ? ` · histórico importado (${fmt.int(hist.mensagens || 0)} mensagens novas)` : ` · a importação do histórico falhou: ${hist.erro || 'erro'}`;
      return h('div', null,
        !dados.servico ? h('div', { class: 'notice' }, 'O robô do WhatsApp não está instalado neste servidor: as conversas não são lidas.') : null,
        dados.servico && !dados.conectado ? h('div', { class: 'notice warn' }, 'O WhatsApp da loja não está conectado: as conversas novas não chegam. Conecte em Clientes → Campanhas → "Conectar e configurar".') : null,
        h('div', { class: 'cv-sit' }, h('small', { class: 'muted' }, dados.buscadoEm ? `Atualizado às ${quando(dados.buscadoEm)}` : 'Ainda não buscou nenhuma conversa', ` · guarda ${dados.meses} meses${histTxt}`,
          TS.dica(`O painel busca as mensagens novas no WhatsApp da loja a cada 30 segundos (enviadas e recebidas, pelo celular, pelo WhatsApp Web ou pelo robô). Guarda ${dados.meses} meses; desconectar o WhatsApp da loja apaga tudo. Fotos e áudios aparecem só como marca.`)), bt));
    }

    async function abrir(chave) {
      st.aberta = chave;
      let msgs;
      try { msgs = (await api('GET', `conversas/mensagens?loja=${encodeURIComponent(loja)}&chave=${encodeURIComponent(chave)}`)).mensagens; } catch (e) { TS.avisarErro(e); st.aberta = null; return; }
      if (!corpo.isConnected || st.aberta !== chave) return;
      const c = (dados.conversas || []).find((x) => x.chave === chave) || { chave, naoLidas: 0 };
      if (c.naoLidas && !TS.demo) api('POST', 'conversas/lida', { loja, chave }).then(() => { c.naoLidas = 0; }).catch(() => null);
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
      const lista = h('div', { class: 'cv-msgs' }, ...(bolhas.length ? bolhas : [TS.empty('Sem mensagens guardadas nesta conversa.')]));
      corpo.replaceChildren(
        h('div', { class: 'cp-acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => { st.aberta = null; pintarLista(); } }, '‹ Voltar')),
        h('div', { class: 'card cv-conversa' },
          h('div', { class: 'cv-topo' }, h('div', null, h('b', { class: 'cv-nome' }, nome), h('small', { class: 'muted' }, ' ', foneTxt(chave)))),
          ficha, lista,
          h('p', { class: 'muted cv-rodape' }, '🔒 Só leitura por enquanto: para responder, use o WhatsApp da loja (a resposta aparece aqui em seguida).')));
      lista.scrollTop = lista.scrollHeight; // abre na mensagem mais nova
    }

    setTimeout(carregar, 0); // depois que a tela entra na página (o roteador anexa a raiz em seguida)
  };
})();
