/* Robô do WhatsApp das campanhas: cartão em Configurações → loja → Mensagens (conectar, ligar/pausar, ritmo, horário,
 * máximo por dia), faixa de situação na tela Campanhas, a opção "Enviar pelo robô" de cada campanha e o aviso do Início.
 * Quem decide o que envia é o servidor (src/zapfila.js): aqui é só mostrar e pedir. Na apresentação tudo é simulado. */
(function () {
  const { h, fmt, state } = TS;
  const DIAS = [[1, 'seg'], [2, 'ter'], [3, 'qua'], [4, 'qui'], [5, 'sex'], [6, 'sáb'], [0, 'dom']];
  const RISCO = 'O WhatsApp pode bloquear o número da loja quando percebe envio automático. Intervalo maior entre as mensagens e máximo por dia menor são mais seguros.';

  async function api(met, caminho, corpo) {
    let r;
    try {
      r = await fetch(TS.api('zap/' + caminho), { method: met, credentials: 'same-origin', headers: { 'X-Painel': '1', ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    } catch (e) { throw new Error(TS.erroDeRede && TS.erroDeRede(e) ? 'Sem conexão com o painel agora. Tente de novo em instantes.' : 'Não deu certo. Tente de novo.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não deu certo. Tente de novo.');
    return j;
  }
  const qs = (loja) => 'loja=' + encodeURIComponent(loja);
  const hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  // quem cuida do robô: admin, franqueado e gerente com a tela Clientes (a vendedora não vê Campanhas)
  const gestor = () => !!(TS.eu && TS.eu.perfil !== 'vendedor');

  /** etiqueta da conexão com o WhatsApp: [classe, texto] */
  function sitConexao(s) {
    const c = s.conexao || {};
    return ({
      conectado: ['ok', `WhatsApp conectado${c.numeroFim ? ' · número final ' + c.numeroFim : ''}`],
      qr: ['warn', 'Esperando ler o QR'], codigo: ['warn', 'Esperando digitar o código'], iniciando: ['cinza', 'Iniciando…'],
      caiu: ['erro', 'A conexão com o WhatsApp caiu'], desligado: ['cinza', 'WhatsApp não conectado'],
      indisponivel: ['erro', 'Robô fora do ar'], sem_servico: ['cinza', 'Robô não instalado'],
    })[c.estado] || ['cinza', 'WhatsApp não conectado'];
  }
  /** etiqueta do robô: [classe, texto] */
  function sitRobo(s) {
    if (s.pausa && s.pausa.auto) return ['erro', 'Pausou sozinho'];
    if (s.pausa) return ['warn', 'Pausado'];
    return s.ligado ? ['ok', 'Ligado'] : ['cinza', 'Desligado'];
  }
  /** "amanhã", "segunda (24/11)"… para a volta do robô */
  function dataCurta(d) {
    const iso = (x) => x.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const amanha = iso(new Date(Date.now() + 864e5));
    if (iso(d) === amanha) return 'amanhã';
    return `${d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' }).replace('-feira', '')} (${fmt.date(iso(d)).slice(0, 5)})`;
  }
  /** "Hoje: 12 de 30 · próxima mensagem por volta de 10:42" e, quando está parado, o motivo */
  function linhaHoje(s) {
    const partes = [`Hoje: ${fmt.int(s.hoje.n)} de ${fmt.int(s.hoje.teto)} ${s.hoje.teto === 1 ? 'mensagem' : 'mensagens'}`];
    const andando = s.ligado && !s.pausa && s.conexao.estado === 'conectado';
    if (andando && s.proximoEm && (!s.motivo || s.motivo.cod === 'ritmo')) {
      // a próxima "por volta de" pode cair depois do fim do horário (ou num dia sem envio): aí diz quando volta de verdade
      const est = s.cfg ? estimar({ pend: 1, limite: 0, cfg: s.cfg, agora: Date.parse(s.proximoEm) }) : null;
      if (est && !est.agoraNoHorario && est.primeira) partes.push(`hoje não sai mais nenhuma (o horário acaba às ${s.cfg.as}) · volta ${dataCurta(est.primeira)} às ${s.cfg.das}`);
      else partes.push(`próxima mensagem por volta de ${hhmm(s.proximoEm)}`);
    }
    else if (andando && !s.motivo) partes.push('próxima mensagem em instantes');
    return partes.join(' · ');
  }
  function motivoParado(s) {
    if (s.pausa && s.pausa.auto) return `Pausou sozinho${s.pausa.em ? ' às ' + hhmm(s.pausa.em) : ''}: ${s.pausa.motivo || 'falhas seguidas ao enviar'}. Confira o WhatsApp da loja antes de ligar de novo.`;
    if (s.pausa) return `Pausado${s.pausa.por ? ' por ' + s.pausa.por : ''}${s.pausa.em ? ' às ' + hhmm(s.pausa.em) : ''}. Nada é enviado até alguém ligar de novo.`;
    if (!s.motivo || s.motivo.cod === 'ritmo') return null;
    return s.motivo.texto;
  }
  const etiqueta = ([cls, txt]) => h('span', { class: 'badge ' + cls }, txt);

  // ---------- Configurações → loja → Mensagens: cartão "Robô do WhatsApp" ----------
  TS.blocoZap = function (lojaId) {
    const sec = h('section', { class: 'cfg-bloco cfg-form zap-cfg' });
    const tit = () => h('h3', null, '🤖 Robô do WhatsApp');
    let s = null, msg = null, timer = null, editando = false;
    const carregar = async () => {
      try { s = await api('GET', 'situacao?' + qs(lojaId)); } catch (e) { if (!s) { sec.replaceChildren(tit(), h('div', { class: 'notice err' }, e.message)); return; } }
      if (sec.isConnected || !sec.parentNode) pintar();
    };
    // enquanto espera o QR/código (ou a conexão subir), confere de novo sozinho
    const agendar = () => {
      clearTimeout(timer);
      if (!s || TS.demo || !['qr', 'codigo', 'iniciando'].includes(s.conexao.estado)) return;
      timer = setTimeout(() => { if (sec.isConnected && !editando) carregar(); else if (sec.isConnected) agendar(); }, 5000);
    };
    const fazer = (bt, fn, okMsg) => async () => {
      bt.disabled = true; msg = null;
      try { s = await fn(); msg = okMsg ? ['ok', TS.demo ? TS.DEMO_AVISO : okMsg] : null; } catch (e) { msg = ['err', e.message]; }
      pintar();
    };
    function pintar() {
      const m = msg; msg = null; editando = false;
      const intro = h('p', { class: 'muted' }, 'Envia sozinho, pelo WhatsApp da loja, as mensagens das campanhas marcadas com "Enviar pelo robô" (Clientes → Campanhas). Uma mensagem por vez, só no horário e no ritmo escolhidos aqui; quem pediu para não receber ou já recebeu mensagem há pouco tempo fica de fora.');
      const risco = h('div', { class: 'notice warn zap-risco' }, h('b', null, '⚠️ Risco: '), RISCO);
      const partes = [tit(), intro, risco, m ? h('div', { class: 'notice ' + m[0] }, m[1]) : null];
      if (!s.servico) {
        partes.push(h('div', { class: 'notice' }, 'O robô do WhatsApp ainda não está instalado neste servidor: nada é enviado sozinho. As campanhas continuam com o envio manual (um clique por mensagem). O ritmo e o horário abaixo já podem ficar salvos.'));
      } else {
        // --- conexão
        const c = s.conexao;
        const btQr = h('button', { type: 'button', class: 'btn' }, 'Conectar com QR');
        btQr.addEventListener('click', fazer(btQr, () => api('POST', 'conectar', { loja: lojaId })));
        const btCod = h('button', { type: 'button', class: 'btn' }, 'Conectar com código');
        btCod.addEventListener('click', async () => {
          const n = await TS.perguntar('Conectar com código', { texto: 'Digite o número do WhatsApp da loja, com DDD. O painel mostra um código para digitar no celular da loja (WhatsApp → Aparelhos conectados → Conectar com número).', rotulo: 'Número do WhatsApp da loja', dica: '62 99999-8888', obrigatorio: true, falta: 'Digite o número com DDD.', ok: 'Pedir o código', max: 20 });
          if (n == null) return;
          fazer(btCod, () => api('POST', 'conectar', { loja: lojaId, numero: n }))();
        });
        const btSair = h('button', { type: 'button', class: 'btn ghost-danger' }, 'Desconectar');
        btSair.addEventListener('click', () => { if (!confirm('Desconectar o WhatsApp da loja do robô?\n\nO robô para de enviar e sai do WhatsApp. Para voltar é preciso conectar de novo.')) return; fazer(btSair, () => api('POST', 'desconectar', { loja: lojaId }), 'WhatsApp desconectado.')(); });
        const conectado = c.estado === 'conectado';
        partes.push(h('div', { class: 'zap-linha' }, h('b', null, 'Conexão'), TS.dica('O robô usa o WhatsApp que a loja já tem, como um "aparelho conectado" (igual ao WhatsApp Web). O painel mostra só os 4 últimos dígitos do número.'), etiqueta(sitConexao(s)),
          h('span', { class: 'zap-bts' }, ...(conectado || ['qr', 'codigo', 'iniciando'].includes(c.estado) ? [btSair] : [btQr, btCod]))));
        if (c.erro && !conectado) partes.push(h('small', { class: 'neg' }, c.erro));
        if (c.estado === 'qr') partes.push(h('div', { class: 'zap-qr' }, c.qr ? h('img', { src: c.qr, alt: 'QR para conectar o WhatsApp da loja', width: 220, height: 220 }) : h('div', { class: 'muted' }, 'Gerando o QR…'),
          h('div', null, h('b', null, 'No celular da loja:'), h('ol', { class: 'cfg-passos' }, h('li', null, 'Abra o WhatsApp.'), h('li', null, 'Toque em Aparelhos conectados → Conectar um aparelho.'), h('li', null, 'Aponte a câmera para este QR.')), h('small', { class: 'muted' }, 'O QR muda a cada minuto: esta tela atualiza sozinha.'))));
        if (c.estado === 'codigo') partes.push(h('div', { class: 'zap-qr' }, h('div', { class: 'zap-codigo' }, c.codigo || '…'),
          h('div', null, h('b', null, 'No celular da loja:'), h('ol', { class: 'cfg-passos' }, h('li', null, 'Abra o WhatsApp.'), h('li', null, 'Toque em Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone.'), h('li', null, 'Digite este código.')))));
        // --- ligar / pausar
        const btLigar = h('button', { type: 'button', class: 'btn primary' }, s.pausa ? 'Ligar de novo' : 'Ligar o robô');
        btLigar.addEventListener('click', fazer(btLigar, () => api('POST', 'ligar', { loja: lojaId }), 'Robô ligado.'));
        const btPausar = h('button', { type: 'button', class: 'btn' }, 'Pausar');
        btPausar.addEventListener('click', fazer(btPausar, () => api('POST', 'pausar', { loja: lojaId }), 'Robô pausado: nada é enviado até ligar de novo.'));
        const mot = motivoParado(s);
        partes.push(h('div', { class: 'zap-linha' }, h('b', null, 'Robô'), TS.dica('Ligado: envia as mensagens das campanhas marcadas, uma por vez. Pausado: não envia nada até alguém ligar de novo. Ele pausa sozinho depois de algumas falhas seguidas (abaixo).'), etiqueta(sitRobo(s)),
          h('span', { class: 'zap-bts' }, s.ligado && !s.pausa ? btPausar : btLigar)),
          h('div', { class: 'zap-hoje' }, linhaHoje(s), s.fila ? h('small', { class: 'muted' }, ` · ${fmt.int(s.fila.pendentes)} ${s.fila.pendentes === 1 ? 'pendente' : 'pendentes'} em ${fmt.int(s.fila.campanhas)} ${s.fila.campanhas === 1 ? 'campanha' : 'campanhas'} do robô`) : null),
          mot ? h('small', { class: s.pausa && s.pausa.auto ? 'neg' : 'muted' }, mot) : null);
      }
      // --- configuração
      const g = s.cfg;
      const sujar = (el) => { el.addEventListener('focus', () => { editando = true; }); return el; };
      const num = (v, min, max, larg) => sujar(h('input', { class: 'f-input zap-num', type: 'number', min, max, step: 1, value: v, inputmode: 'numeric', style: { width: larg || '84px' } }));
      const min = num(g.min, 60, 7200), max = num(g.max, 60, 7200);
      const das = sujar(h('input', { class: 'f-input zap-hora', type: 'time', value: g.das })), as = sujar(h('input', { class: 'f-input zap-hora', type: 'time', value: g.as }));
      const teto = num(g.teto, 1, 200, '72px'), falhas = num(g.falhas, 1, 10, '64px');
      const dias = new Set(g.dias);
      const cxDias = h('fieldset', { class: 'zap-dias' }, h('legend', null, 'Dias de envio ', TS.dica('O robô só envia nos dias marcados. Padrão: de segunda a sábado.')),
        ...DIAS.map(([d, t]) => { const cb = sujar(h('input', { type: 'checkbox', checked: dias.has(d) || null })); cb.addEventListener('change', () => { cb.checked ? dias.add(d) : dias.delete(d); }); return h('label', { class: 'zap-dia' }, cb, h('span', null, t)); }));
      const avisoRitmo = h('small', { class: 'warn-t zap-aviso', role: 'status', hidden: true });
      const conferirRitmo = () => {
        const v = +min.value;
        avisoRitmo.hidden = !(v >= 60 && v < 300);
        avisoRitmo.textContent = '⚠ Menos de 300 segundos (5 minutos) entre as mensagens aumenta muito o risco de bloqueio do número.';
      };
      TS.aoConfirmar(min, conferirRitmo); conferirRitmo();
      const btSalvar = h('button', { type: 'button', class: 'btn primary' }, 'Salvar');
      btSalvar.addEventListener('click', fazer(btSalvar, () => api('PUT', 'config', { loja: lojaId, min: min.value, max: max.value, das: das.value, as: as.value, dias: [...dias], teto: teto.value, falhas: falhas.value }), 'Configuração do robô salva.'));
      const trava = !s.pode.configurar;
      const campos = h('div', { class: 'zap-campos' },
        h('div', { class: 'zap-linha' }, h('b', null, 'Ritmo'), TS.dica('Tempo entre uma mensagem e a próxima. O robô sorteia um valor diferente a cada envio, entre os dois números, para não parecer máquina. Padrão: de 900 a 1200 segundos (15 a 20 minutos). Mínimo aceito: 60.'), h('span', null, 'de'), min, h('span', null, 'a'), max, h('span', null, 'segundos entre as mensagens')),
        avisoRitmo,
        h('div', { class: 'zap-linha' }, h('b', null, 'Horário'), TS.dica('O robô só envia dentro deste horário (de Brasília). Fora dele, espera o próximo dia de envio. Padrão: das 09:00 às 18:30.'), h('span', null, 'das'), das, h('span', null, 'às'), as),
        cxDias,
        h('div', { class: 'zap-linha' }, h('b', null, 'Máximo por dia'), TS.dica('Quantas mensagens o robô manda por dia pelo número da loja, somando todas as campanhas. Chegou no máximo, continua no próximo dia de envio. Cada campanha ainda tem o próprio limite por dia. Padrão: 30.'), teto, h('span', null, 'mensagens por dia (todas as campanhas)')),
        h('div', { class: 'zap-linha' }, h('b', null, 'Parar sozinho'), TS.dica('Se o envio falhar esse número de vezes seguidas, o robô pausa, avisa aqui e no Início e só volta quando alguém ligar de novo. Protege o número quando algo está errado. Padrão: 3.'), h('span', null, 'depois de'), falhas, h('span', null, 'falhas seguidas')));
      if (trava) for (const el of campos.querySelectorAll('input')) el.disabled = true;
      partes.push(campos, trava ? h('small', { class: 'muted' }, '🔒 Só o administrador, o franqueado da loja ou a gerente com a tela Clientes muda a configuração do robô.') : h('div', { class: 'cfg-acoes' }, btSalvar));
      sec.replaceChildren(...partes.filter(Boolean));
      agendar();
    }
    sec.append(tit(), h('p', { class: 'muted' }, 'Carregando…'));
    carregar();
    return sec;
  };

  // ---------- Clientes → Campanhas: faixa de situação do robô ----------
  /** some sozinha quando o robô não está instalado e nenhuma campanha usa o robô */
  /** o cartão do robô numa janela, por cima da tela Campanhas (a gerente não tem a tela Configurações) */
  function abrirJanela(lojaId) {
    const fundo = h('div', { class: 'cp-modal-bg' });
    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc, true); if (TS.state.page === 'campanhas') TS.render(); };
    const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fechar(); } };
    fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fechar(); });
    fundo.append(h('div', { class: 'card cp-copiar zap-janela', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Robô do WhatsApp' },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      TS.blocoZap(lojaId)));
    document.body.append(fundo);
    document.addEventListener('keydown', esc, true);
  }
  TS.zapAbrirJanela = abrirJanela;
  TS.zapFaixa = function (lojaId, temCampanhaRobo) {
    const box = h('div', { class: 'zap-faixa', hidden: true });
    let s = null, timer = null;
    const carregar = async () => {
      try { s = await api('GET', 'situacao?' + qs(lojaId)); } catch { s = null; }
      if (!box.isConnected && box.parentNode) return;
      pintar();
      clearTimeout(timer);
      if (!TS.demo) timer = setTimeout(() => { if (box.isConnected) carregar(); }, 30000);
    };
    function pintar() {
      if (!s || (!s.servico && !temCampanhaRobo())) { box.hidden = true; return; }
      box.hidden = false;
      const erro = h('small', { class: 'neg', role: 'alert' });
      const btPausar = h('button', { type: 'button', class: 'btn' }, 'Pausar o robô');
      btPausar.title = s.pode.configurar ? 'Para os envios do robô agora. Para voltar, use "Ligar de novo".' : 'Para os envios do robô agora. Só o administrador, o franqueado ou a gerente com a tela Clientes liga de novo.';
      btPausar.addEventListener('click', async () => { btPausar.disabled = true; try { s = await api('POST', 'pausar', { loja: lojaId }); pintar(); } catch (e) { erro.textContent = e.message; btPausar.disabled = false; } });
      const btLigar = h('button', { type: 'button', class: 'btn primary' }, s.pausa ? 'Ligar de novo' : 'Ligar o robô');
      btLigar.addEventListener('click', async () => { btLigar.disabled = true; try { s = await api('POST', 'ligar', { loja: lojaId }); pintar(); } catch (e) { erro.textContent = e.message; btLigar.disabled = false; } });
      const mot = !s.servico ? 'O robô do WhatsApp ainda não está instalado neste servidor: as campanhas marcadas para o robô não são enviadas sozinhas (o envio manual continua).' : motivoParado(s);
      const andando = s.ligado && !s.pausa;
      box.className = 'zap-faixa card' + (s.pausa && s.pausa.auto ? ' zap-erro' : '');
      box.replaceChildren(...[
        h('div', { class: 'zap-faixa-t' }, h('b', null, '🤖 Robô do WhatsApp'),
          TS.dica(`Envia sozinho, pelo WhatsApp da loja, as campanhas com o robô ligado: uma mensagem por vez, no ritmo, horário e máximo por dia definidos ${s.pode.configurar ? 'no botão de configurar, aqui ao lado' : 'por quem cuida do robô (administrador, franqueado ou gerente)'}. Quem pediu para não receber ou recebeu mensagem há pouco tempo fica de fora. ` + RISCO),
          s.servico ? etiqueta(sitRobo(s)) : null, etiqueta(sitConexao(s))),
        h('div', { class: 'zap-faixa-m' }, s.servico ? h('span', null, linhaHoje(s)) : null, mot ? h('small', { class: s.pausa && s.pausa.auto ? 'neg' : 'muted' }, mot) : null, erro),
        h('div', { class: 'zap-faixa-b' },
          s.servico && andando ? btPausar : null,
          s.servico && !andando && s.pode.configurar && s.conexao.estado === 'conectado' ? btLigar : null,
          s.pode.configurar ? h('button', { type: 'button', class: 'btn', title: 'Conectar o WhatsApp da loja (QR ou código) e ajustar ritmo, horário e máximo por dia', onclick: () => abrirJanela(lojaId) }, s.conexao.estado === 'conectado' ? 'Configurar ›' : 'Conectar e configurar ›') : null),
      ].filter(Boolean));
    }
    box.atualizar = carregar;
    carregar();
    return box;
  };

  /**
   * Janela de confirmação do painel (no lugar do confirm() do navegador): título, conteúdo (elementos) e dois botões.
   * → Promise<boolean>. Esc, clique fora e o "voltar" do celular contam como cancelar.
   */
  TS.janelaConfirmar = function (titulo, conteudo, ok = 'Confirmar', cancelar = 'Cancelar') {
    return new Promise((resolver) => {
      const fundo = h('div', { class: 'cp-modal-bg' });
      let feito = false;
      const sair = (v) => { if (feito) return; feito = true; fundo.remove(); resolver(v); };
      const btOk = h('button', { type: 'button', class: 'btn primary', onclick: () => sair(true) }, ok);
      fundo.addEventListener('click', (e) => { if (e.target === fundo) sair(false); });
      fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') sair(false); });
      fundo.append(h('div', { class: 'card cp-copiar ts-perg ts-conf', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
        h('h3', null, titulo), h('div', { class: 'ts-conf-corpo' }, ...[].concat(conteudo).filter(Boolean)),
        h('div', { class: 'ts-perg-acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => sair(false) }, cancelar), btOk)));
      new MutationObserver((_, ob) => { if (!fundo.isConnected) { ob.disconnect(); if (!feito) { feito = true; resolver(false); } } }).observe(document.body, { childList: true });
      document.body.append(fundo);
      btOk.focus();
    });
  };

  /**
   * Quanto tempo a campanha leva no robô (só estimativa para a pessoa decidir; quem manda de verdade é src/zapfila.js):
   * por dia = o menor entre o limite da campanha, o máximo do número e o que cabe no horário no ritmo médio.
   * Conta só os dias de envio (cfg.dias), no horário de Brasília. → { porDia, dias, fim (Date), primeira (Date|null), agoraNoHorario }
   */
  function estimar({ pend, limite, cfg, agora = Date.now() }) {
    const sp = (t) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), min: (+p.hour % 24) * 60 + +p.minute };
    };
    const hm = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
    const ini = hm(cfg.das), fim = hm(cfg.as), medio = (cfg.min + cfg.max) / 2;
    const cabe = Math.max(1, Math.floor(((fim - ini) * 60) / medio) + 1);
    const porDia = Math.max(1, Math.min(limite > 0 ? limite : Infinity, cfg.teto, cabe));
    const agoraSP = sp(agora), envia = (dow) => cfg.dias.includes(dow);
    const agoraNoHorario = envia(agoraSP.dow) && agoraSP.min >= ini && agoraSP.min < fim;
    // dias de envio a partir de hoje (hoje só conta se ainda dá tempo)
    const diasEnvio = [];
    for (let k = 0; diasEnvio.length < 400 && k < 800; k++) {
      if (!envia(sp(agora + k * 864e5).dow)) continue;
      if (k === 0 && agoraSP.min >= fim) continue;
      diasEnvio.push(k);
    }
    const n = Math.max(1, Math.ceil(pend / porDia));
    const k0 = diasEnvio[0] ?? 0, kFim = diasEnvio[Math.min(n, diasEnvio.length) - 1] ?? 0;
    // primeira fora do horário: no começo do próximo horário de envio
    const primeira = agoraNoHorario ? null : new Date(agora + k0 * 864e5 + ((k0 === 0 ? Math.max(0, ini - agoraSP.min) : ini - agoraSP.min) * 60e3));
    return { porDia, dias: n, fim: new Date(agora + kFim * 864e5), primeira, agoraNoHorario };
  }
  TS.zapEstimar = estimar;

  /**
   * Robô de uma campanha (decisão do dono, revisão de 22/11): ligar mostra antes o que vai acontecer — quantos recebem, quantos
   * ficam para comparar, limites, dias e horário, término estimado, primeira mensagem e um exemplo. Desligar é um toque.
   * Quem liga: administrador, franqueado da loja e gerente com a tela Clientes (o servidor confere).
   * info: { pendentes(), comparacao(), exemplo() } da tela Campanhas.
   */
  TS.zapOpcao = function (camp, aoMudar, info = {}) {
    const pode = gestor();
    if (!pode && !camp.robo) return null;
    const erro = h('small', { class: 'neg', role: 'alert' });
    const dica = TS.dica('Robô ligado: o robô do WhatsApp envia os pendentes desta lista sozinho, um por vez, respeitando o limite por dia da campanha e o ritmo, horário e máximo por dia da loja. A lista é conferida de novo pelo próprio servidor todo dia (pontos, chá, estoque), sem ninguém abrir a tela. Mesmo ligado, dá para enviar à mão. ' + RISCO);
    const dataTxt = (d) => fmt.date(d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }));
    const ligar = async (bt) => {
      bt.disabled = true; erro.textContent = '';
      let s = null;
      try { s = await api('GET', 'situacao?' + qs(state.loja)); } catch { /* sem situação: confirma sem os números do robô */ }
      const pend = info.pendentes ? info.pendentes() : 0, comp = info.comparacao ? info.comparacao() : 0;
      const limite = camp.limiteDia != null ? camp.limiteDia : 20;
      const cfg = s && s.cfg;
      const est = cfg ? estimar({ pend, limite, cfg }) : null;
      const diasTxt = cfg ? DIAS.filter(([d]) => cfg.dias.includes(d)).map(([, t]) => t).join(', ') : '';
      const ex = info.exemplo ? info.exemplo() : null;
      const andando = s && s.ligado && !s.pausa && s.conexao && s.conexao.estado === 'conectado';
      const primeira = !est || !pend ? null
        : !andando ? (s.pausa ? 'quando alguém ligar o robô de novo (está pausado)' : s.conexao && s.conexao.estado !== 'conectado' ? 'quando o WhatsApp da loja estiver conectado' : 'quando o robô da loja for ligado (faixa do robô, acima)')
          : est.agoraNoHorario ? (s.proximoEm ? `por volta de ${hhmm(s.proximoEm)}` : 'em instantes') : `${dataTxt(est.primeira)} por volta de ${hhmm(est.primeira.toISOString())}`;
      const linha = (rot, val) => h('li', null, h('b', null, rot + ': '), val);
      const sim = await TS.janelaConfirmar(`Ligar o robô para "${camp.nome}"?`, [
        h('ul', { class: 'zap-resumo' }, ...[
          linha('Vai enviar para', `${fmt.int(pend)} ${pend === 1 ? 'cliente' : 'clientes'}${comp ? ` (${fmt.int(comp)} ${comp === 1 ? 'fica' : 'ficam'} sem mensagem, para comparar)` : ''}`),
          linha('Por dia', `até ${limite > 0 ? fmt.int(limite) : 'sem limite'} desta campanha${cfg ? ` · ${fmt.int(cfg.teto)} no número da loja (somando todas as campanhas)` : ''}`),
          cfg ? linha('Quando', `${diasTxt}, das ${cfg.das} às ${cfg.as} (horário de Brasília), uma mensagem a cada ${Math.round(cfg.min / 60)} a ${Math.round(cfg.max / 60)} minutos`) : null,
          est && pend ? linha('Termina', `por volta de ${dataTxt(est.fim)} (${fmt.int(est.dias)} ${est.dias === 1 ? 'dia' : 'dias'} de envio, cerca de ${fmt.int(est.porDia)} por dia${s.fila && s.fila.campanhas ? '; com outras campanhas no robô, demora mais' : ''})`) : null,
          primeira ? linha('A primeira sai', primeira) : null,
        ].filter(Boolean)),
        ex ? h('div', null, h('small', { class: 'muted' }, 'Exemplo da mensagem:'), h('div', { class: 'cli-msg' }, ex)) : null,
        h('p', { class: 'muted' }, 'Quem pediu para não receber, recebeu mensagem dentro do intervalo da loja ou receberia oferta de produto sem estoque fica de fora. ' + RISCO),
      ], 'Ligar o robô', 'Cancelar');
      if (!sim) { bt.disabled = false; return; }
      try { await aoMudar(true); } catch (e) { erro.textContent = e.message; bt.disabled = false; }
    };
    if (!camp.robo) {
      const bt = h('button', { type: 'button', class: 'btn zap-ligar' }, '🤖 Ligar o robô para esta campanha');
      bt.addEventListener('click', () => ligar(bt));
      return h('div', { class: 'card zap-opcao' }, h('div', { class: 'zap-opcao-t' }, h('b', null, 'Robô do WhatsApp'), dica),
        h('small', { class: 'muted' }, 'Desligado: só o envio manual, um toque por mensagem.'), bt, erro);
    }
    const bt = h('button', { type: 'button', class: 'btn' }, 'Desligar o robô');
    bt.addEventListener('click', async () => { bt.disabled = true; erro.textContent = ''; try { await aoMudar(false); } catch (e) { erro.textContent = e.message; bt.disabled = false; } });
    const pend = info.pendentes ? info.pendentes() : null;
    return h('div', { class: 'card zap-opcao zap-opcao-on' }, h('div', { class: 'zap-opcao-t' }, h('b', null, '🤖 Robô ligado nesta campanha'), dica),
      h('small', { class: 'muted' }, `O robô envia os pendentes desta lista sozinho${pend != null ? ` (${fmt.int(pend)} na fila)` : ''}, no ritmo e horário da loja. A situação dele está na faixa do robô, acima.`),
      pode ? bt : h('span', { class: 'muted', title: 'Só o administrador, o franqueado ou a gerente com a tela Clientes desligam' }, '🔒'), erro);
  };
  /** manda ao servidor os valores dos campos e o número de cada pendente (o servidor monta o mesmo texto do envio manual) */
  TS.zapPreparar = (lojaId, campanha, itens) => (TS.demo ? Promise.resolve({ ok: true }) : api('PUT', 'preparo', { loja: lojaId, campanha, itens }));

  // ---------- Início: aviso quando o robô pausou sozinho ou a conexão caiu ----------
  TS.zapAvisos = async function (lista) {
    if (!state.loja || state.loja === 'todas' || !(TS.eu && TS.eu.pode && TS.eu.pode.clientes)) return;
    let s;
    try { s = await api('GET', `situacao?leve=1&${qs(state.loja)}`); } catch { return; }
    if (!s || !s.servico) return;
    const ir = { link: '#campanhas', ir: 'ver o robô ›' };
    if (s.pausa && s.pausa.auto) lista.push({ nivel: 'erro', titulo: 'Robô do WhatsApp pausou sozinho', texto: `${s.pausa.motivo ? s.pausa.motivo[0].toUpperCase() + s.pausa.motivo.slice(1) : 'Falhas seguidas ao enviar'}. Nada mais é enviado até alguém conferir o WhatsApp da loja e ligar de novo.`, ...ir });
    else if (s.caiu) lista.push({ nivel: 'erro', titulo: 'Robô do WhatsApp: a conexão com o WhatsApp da loja caiu', texto: 'As campanhas do robô estão paradas. Conecte de novo em Configurações → loja → Mensagens.', ...ir });
  };
})();
