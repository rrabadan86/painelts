/* Configuração guiada da loja: os 4 acessos que fazem o painel funcionar (AppNext, Sistema de Pedidos, FIXE e o Gmail da loja).
 * - Abre sozinha uma vez, no primeiro acesso do franqueado a uma loja com acesso faltando (o servidor diz: /api/admin/guia).
 * - Depois fica em Configurações ("Configuração guiada") e num lembrete do Início enquanto faltar algum passo.
 * - Cada passo grava pela mesma rota das Configurações; senha nunca volta para a tela. Na apresentação nada é gravado. */
(function () {
  const { h, state } = TS;
  const G = (TS.guia = {});
  const ORDEM = ['appnext', 'pedido', 'fixe', 'email', 'nfe'];
  // o passo 5 (CFOP das notas) é opcional: sem ele vale o automático; não conta como pendente
  const OBRIG = ['appnext', 'pedido', 'fixe', 'email'];
  const ROT = { appnext: 'AppNext', pedido: 'Sistema de Pedidos', fixe: 'FIXE', email: 'E-mail', nfe: 'Notas fiscais' };
  const SEM = { appnext: 'O painel fica sem vendas, estoque e notas.', pedido: 'O pedido à franquia fica sem o catálogo e os preços do site.', fixe: 'Clientes, Campanhas e Fidelidade ficam vazios.', email: 'O fechamento do dia não sai pelo e-mail da loja e o painel não recebe as planilhas do FIXE.' , nfe: 'Opcional: o robô usa o CFOP automático (venda 5102; devolução pela regra fiscal da loja).' };
  let situ = null; // última resposta de /api/admin/guia
  const toast = (msg, erro) => { document.querySelectorAll('.toast').forEach((x) => x.remove()); const t = h('div', { class: 'toast' + (erro ? ' err' : ''), role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), erro ? 7000 : 4000); };
  async function chamar(metodo, url, corpo) {
    const r = await fetch(url, { method: metodo, credentials: 'same-origin', headers: { 'X-Painel': '1', ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
    return j;
  }
  /** o mesmo Gmail, mesmo escrito com o apelido "+loja" ou com maiúsculas */
  const caixa = (email) => { const [u, d] = String(email || '').trim().toLowerCase().split('@'); return d ? `${u.split('+')[0]}@${d}` : ''; };
  G.mesmoGmail = (a, b) => !!caixa(a) && caixa(a) === caixa(b);
  const faltam = (l) => OBRIG.filter((p) => !l.passos[p]);

  G.carregar = async () => { try { situ = await chamar('GET', '/api/admin/guia'); } catch { situ = situ || { lojas: [] }; } return situ; };
  G.situacao = (lojaId) => (situ && situ.lojas.find((l) => l.id === lojaId)) || null;
  /** ao entrar no painel: abre sozinha só quando o servidor manda (franqueado, primeira vez na loja, com acesso faltando) */
  G.conferir = async () => {
    if (!(TS.eu && TS.eu.pode && TS.eu.pode.configurar)) return;
    await G.carregar();
    const l = !TS.demo && situ.lojas.find((x) => x.abrir);
    if (l) G.abrir(l.id);
  };
  /** lembrete do Início: uma linha por loja com passo faltando (não dá para adiar: some quando concluir) */
  G.avisos = async (lista) => {
    if (!(TS.eu && TS.eu.pode && TS.eu.pode.configurar)) return;
    if (!situ) await G.carregar();
    for (const l of situ.lojas) {
      if (state.loja && state.loja !== 'todas' && l.id !== state.loja) continue;
      const f = faltam(l);
      if (f.length) lista.push({ nivel: 'warn', titulo: `Falta configurar ${f.map((p) => ROT[p]).join(', ')}${situ.lojas.length > 1 ? ` (${l.nome})` : ''}`, texto: SEM[f[0]] + ' Leva poucos minutos.', ir: 'configurar ›', acao: () => G.abrir(l.id) });
    }
  };
  /** botão/aviso das Configurações → Integrações da loja */
  G.bloco = (lojaId) => {
    const l = G.situacao(lojaId);
    const f = l ? faltam(l) : [];
    return h('div', { class: 'notice guia-cfg ' + (f.length ? 'warn' : 'ok') },
      h('div', null, h('b', null, f.length ? `Falta configurar: ${f.map((p) => ROT[p]).join(', ')}. ` : 'Os 4 acessos desta loja estão configurados. '), 'A configuração guiada mostra um passo de cada vez, com a explicação de cada campo.'),
      h('button', { type: 'button', class: 'btn' + (f.length ? ' primary' : ''), onclick: () => G.abrir(lojaId) }, f.length ? 'Abrir configuração guiada' : 'Rever na configuração guiada'));
  };

  /**
   * Escolha do CFOP da NF-e de venda e de devolução (passo 5 do guia e Configurações → Integrações → Notas fiscais).
   * As opções são os CFOPs que o robô leu do AppNext ("Buscar cadastros" em Notas fiscais → Nova NF-e). Sem a lista, dá para
   * digitar o número. → { el, salvar } (salvar grava pela rota da loja e devolve o que ficou)
   */
  G.formCfop = (lojaId, atual, cfops) => {
    const lista = (cfops && cfops.lista) || [];
    const cx = (tipo, padrao, dica) => {
      const v = (atual && atual[tipo]) || '';
      if (!lista.length) return h('input', { class: 'f-input', inputmode: 'numeric', maxlength: 4, placeholder: padrao, value: v, 'aria-label': `CFOP de ${tipo === 'venda' ? 'venda' : 'devolução'}`, title: dica });
      const op = (c) => h('option', { value: c.codigo, selected: c.codigo === v || null }, `${c.codigo}${c.descricao ? ' · ' + c.descricao : ''}`);
      return h('select', { class: 'f-input', 'aria-label': `CFOP de ${tipo === 'venda' ? 'venda' : 'devolução'}`, title: dica },
        h('option', { value: '' }, padrao), ...(v && !lista.some((c) => c.codigo === v) ? [op({ codigo: v, descricao: 'não está na última lista do AppNext' })] : []), ...lista.map(op));
    };
    const venda = cx('venda', 'Automático (5102, como hoje)', 'O CFOP da NF-e de venda. Automático = 5102, como o robô sempre usou.');
    const devol = cx('devolucao', 'Automático (regra da loja)', 'O CFOP da NF-e de devolução ao fornecedor. Automático = o da regra fiscal (sequência) de devolução da loja; se a loja tiver mais de um, o robô escolhe pelo estado do fornecedor ou pede para fazer à mão.');
    const quando = cfops && cfops.em ? new Date(cfops.em).toLocaleDateString('pt-BR') : null;
    const el = h('div', { class: 'nfe-cfop' },
      h('div', { class: 'guia-g2' }, campo('CFOP da venda', venda, 'O CFOP da NF-e de venda. Automático = 5102, como o robô sempre usou.'), campo('CFOP da devolução ao fornecedor', devol, 'O CFOP da NF-e de devolução. Automático = o da regra fiscal (sequência) de devolução da loja.')),
      h('small', { class: 'muted' }, lista.length ? `Lista lida do AppNext${quando ? ' em ' + quando : ''}. Para atualizar: Notas fiscais → Nova NF-e → "Buscar cadastros".` : 'O painel ainda não leu os CFOPs do AppNext: digite o número (ex.: 5102) ou busque em Notas fiscais → Nova NF-e → "Buscar cadastros" e volte aqui.'),
      h('div', { class: 'guia-nota' }, '🔒 O robô usa só o CFOP escolhido. Se a nota tiver um produto sem regra fiscal com esse CFOP no AppNext, ele para e avisa qual é: nunca emite com outro.'));
    const salvar = async () => {
      const corpo = { venda: venda.value.trim(), devolucao: devol.value.trim() };
      if (TS.demo) { toast(TS.DEMO_AVISO); return corpo; }
      const j = await chamar('PUT', `/api/admin/lojas/${encodeURIComponent(lojaId)}/nfe-cfop`, corpo);
      return j.nfeCfop;
    };
    return { el, salvar };
  };

  const campo = (rotulo, el, dica, sub) => h('label', { class: 'cfg-campo' }, h('span', null, rotulo, TS.dica ? TS.dica(dica) : null), el, sub ? h('small', null, sub) : null);
  const inp = (a) => h('input', { class: 'f-input', autocomplete: 'off', ...a });
  const senhaInp = (tem, ph) => inp({ type: 'password', autocomplete: 'new-password', placeholder: tem ? '•••••••• (guardada)' : ph });
  const DICA_SENHA = 'Fica guardada só no servidor do painel e nunca aparece de volta na tela. Para trocar, é só digitar a nova.';

  /** abre a janela na loja (e, se pedido, direto num passo) */
  G.abrir = async function (lojaId, passo) {
    document.querySelectorAll('.guia-bg').forEach((x) => x.remove());
    const fundo = h('div', { class: 'cp-modal-bg guia-bg' });
    const caixaEl = h('div', { class: 'card guia', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Configuração guiada da loja' }, h('div', { class: 'guia-corpo muted' }, 'Carregando…'));
    fundo.append(caixaEl); document.body.append(fundo);
    let L = null, ped = null, est = null, i = 0, fim = false, mudou = false;
    const pulados = new Set();
    const fechar = async () => {
      fundo.remove();
      if (!TS.demo && L) { try { await chamar('POST', `/api/admin/lojas/${encodeURIComponent(L.id)}/guia/visto`); } catch { /* o lembrete do Início continua */ } }
      await G.carregar();
      document.dispatchEvent(new CustomEvent('ts-guia', { detail: { mudou } }));
      if (state.page === 'inicio' && TS.render) TS.render();
    };
    fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
    const carregarLoja = async (id) => {
      const s = G.situacao(id) || (situ && situ.lojas[0]);
      if (!s) throw new Error('Nenhuma loja para configurar.');
      const l = (est.lojas || []).find((x) => x.id === s.id) || {};
      ped = await chamar('GET', `/api/pedido/acesso?loja=${encodeURIComponent(s.id)}`).catch(() => ({}));
      L = { id: s.id, nome: s.nome, passos: { ...s.passos }, col: l.coletor || {}, appnext: l.appnext || '', fixe: l.fixe || {}, mail: (l.fechEmail && l.fechEmail.email) || {}, nfeCfop: l.nfeCfop || { venda: '', devolucao: '' }, cfops: l.cfopsAppNext || { lista: [] } };
      pulados.clear(); fim = false;
      const prim = OBRIG.findIndex((p) => !L.passos[p]);
      i = passo && ORDEM.includes(passo) ? ORDEM.indexOf(passo) : prim < 0 ? 0 : prim;
      passo = null;
    };
    const estado = (k) => (!fim && ORDEM[i] === k ? 'at' : L.passos[k] ? 'ok' : pulados.has(k) ? 'pu' : '');
    const trilha = () => h('div', { class: 'guia-trilha' }, ORDEM.map((k, n) => {
      const e = estado(k);
      return h('button', { type: 'button', class: 'guia-p ' + e, title: `Ir para o passo ${n + 1}: ${ROT[k]}`, onclick: () => { fim = false; i = n; pintar(); } },
        h('i'), h('b', null, `${n + 1}. ${ROT[k]}`), h('span', null, { ok: '✓ pronto', at: 'agora', pu: 'pulado', '': OBRIG.includes(k) ? 'falta' : 'opcional' }[e]));
    }));
    const topo = (titulo, sub) => {
      const outras = situ.lojas.length > 1 ? h('select', { class: 'f-input guia-loja', 'aria-label': 'Loja', title: 'Trocar a loja que está sendo configurada', onchange: async (e) => { await carregarLoja(e.target.value); pintar(); } }, situ.lojas.map((x) => h('option', { value: x.id, selected: x.id === L.id || null }, x.nome))) : null;
      return h('div', { class: 'guia-topo' }, h('div', null, h('h2', null, titulo), outras || h('p', { class: 'muted' }, sub)),
        h('button', { type: 'button', class: 'link-btn guia-x', title: 'Fecha a janela. O que já foi salvo continua salvo; o que falta fica em Configurações → Integrações.', onclick: fechar }, 'Fazer depois ✕'));
    };
    const seguir = () => { if (i < ORDEM.length - 1) i++; else fim = true; pintar(); };
    /** rodapé de um passo: pular, voltar e salvar */
    const pe = (salvar) => {
      const b = h('button', { type: 'button', class: 'btn primary' }, i === ORDEM.length - 1 ? 'Salvar e concluir' : 'Salvar e continuar →');
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          if (TS.demo) toast(TS.DEMO_AVISO); else { await salvar(); mudou = true; }
          L.passos[ORDEM[i]] = true; pulados.delete(ORDEM[i]);
          seguir();
        } catch (e) { toast(e.message, true); b.disabled = false; }
      });
      return h('div', { class: 'guia-pe' },
        h('button', { type: 'button', class: 'link-btn guia-pular', title: 'Deixa este passo para depois e vai para o próximo. Nada deste passo é gravado.', onclick: () => { if (!L.passos[ORDEM[i]]) pulados.add(ORDEM[i]); seguir(); } }, L.passos[ORDEM[i]] ? 'Continuar sem mudar' : 'Pular este passo'),
        h('span', { class: 'guia-esp' }),
        i > 0 ? h('button', { type: 'button', class: 'btn', onclick: () => { i--; pintar(); } }, '← Voltar') : null, b);
    };
    const corpo = (titulo, porque, ...filhos) => h('div', { class: 'guia-corpo' }, h('div', null, h('h3', null, titulo), h('p', { class: 'muted' }, porque)), ...filhos.filter(Boolean));
    const nota = (t) => h('div', { class: 'guia-nota' }, t);

    const PASSO = {
      appnext() {
        const c = L.col;
        const rede = inp({ value: c.rede || 'teashop' }), usuario = inp({ value: c.usuario || '' }), senha = senhaInp(c.temSenha, 'a senha do AppNext');
        const destino = inp({ value: (c.configurado ? c.lojaDestino : L.appnext) || '', placeholder: 'Ex.: TORRES - TEA SHOP TORRES' });
        return [corpo('Acesso ao AppNext', 'É de onde o painel busca as vendas, o estoque e as notas da loja, toda noite. Sem ele o painel fica vazio.',
          h('div', { class: 'guia-g2' }, campo('Rede', rede, 'O nome da rede na tela de login do AppNext (o primeiro campo). Para a Tea Shop é "teashop".'), campo('Usuário', usuario, 'O usuário que a loja usa para entrar no AppNext.')),
          campo('Senha', senha, DICA_SENHA),
          campo('Nome da loja no AppNext', destino, 'Exatamente como aparece na coluna "Loja" dos relatórios do AppNext. É uma trava de segurança: a planilha só entra no painel se todas as vendas forem desta loja.'),
          nota('🔒 A senha fica guardada só no servidor e nunca volta para a tela. O painel só lê relatórios; gravar no AppNext é sempre com o seu clique e confirmação.')),
        pe(async () => {
          await chamar('PUT', `/api/admin/lojas/${encodeURIComponent(L.id)}/appnext`, { rede: rede.value, usuario: usuario.value, senha: senha.value || undefined, lojaDestino: destino.value, lojaIdDestino: c.lojaIdDestino || '' });
          L.col = { ...c, configurado: true, rede: rede.value.trim(), usuario: usuario.value.trim(), temSenha: true, lojaDestino: destino.value.trim() };
        })];
      },
      pedido() {
        const usuario = inp({ value: ped.usuario || '', placeholder: 'ex.: o login da loja no site de pedidos' }), senha = senhaInp(ped.temSenha, 'a senha do site de pedidos');
        return [corpo('Acesso ao Sistema de Pedidos', 'O site de pedidos da franqueadora. Com o login, o robô lê o catálogo e os preços toda noite e o painel monta o pedido sugerido da loja.',
          h('div', { class: 'guia-g2' }, campo('Usuário', usuario, 'O login desta loja no site de pedidos da franqueadora.'), campo('Senha', senha, DICA_SENHA)),
          nota('🔒 O robô só lê o catálogo e monta o carrinho: ele nunca finaliza o pedido. Quem confere e envia é você.')),
        pe(async () => {
          if (!senha.value && !ped.temSenha) throw new Error('Informe a senha do Sistema de Pedidos.');
          ped = await chamar('PUT', `/api/pedido/acesso?loja=${encodeURIComponent(L.id)}`, { usuario: usuario.value, senha: senha.value });
        })];
      },
      fixe() {
        const fx = L.fixe, gmail = L.mail.user || '';
        const url = inp({ value: fx.url || (est.lojas || []).map((x) => x.fixe && x.fixe.url).find(Boolean) || '', placeholder: 'ex.: https://dash.epossible.com.br/loja/…/leads' });
        const usuario = inp({ value: fx.usuario || '', placeholder: 'ex.: e-mail de acesso ao FIXE' }), senha = senhaInp(fx.temSenha, 'a senha do FIXE');
        const email = inp({ type: 'email', value: gmail || fx.email || '', placeholder: 'ex.: o Gmail da loja' });
        const confere = h('small', { class: 'guia-confere' });
        const ver = () => {
          const dif = gmail && email.value.trim() && !G.mesmoGmail(email.value, gmail);
          confere.className = 'guia-confere ' + (dif ? 'neg' : 'muted');
          confere.textContent = dif ? `Diferente do Gmail da loja (${gmail}): assim a planilha do FIXE não chega ao painel.` : gmail ? `É o Gmail da loja cadastrado no passo 4 (${gmail}).` : 'Anote: é este mesmo endereço que você vai cadastrar no passo 4.';
        };
        email.addEventListener('input', ver); ver();
        return [corpo('Clientes e fidelidade (FIXE)', 'Traz o cadastro de clientes e os pontos do programa de fidelidade. É o que alimenta as telas Clientes, Campanhas e Fidelidade.',
          !L.passos.appnext ? h('div', { class: 'notice warn' }, 'Este passo depende do passo 1: salve primeiro o acesso ao AppNext. ', h('button', { type: 'button', class: 'link-btn', onclick: () => { i = 0; pintar(); } }, 'Ir para o passo 1')) : null,
          campo('Página de Leads no FIXE', url, 'Entre no FIXE, abra "Leads" e copie o endereço da página. É o mesmo endereço para todas as lojas da rede.'),
          h('div', { class: 'guia-g2' }, campo('Usuário do FIXE', usuario, 'O login desta loja no FIXE: é ele que define de qual loja vem a base de clientes.'), campo('Senha do FIXE', senha, DICA_SENHA)),
          h('div', { class: 'guia-mesmo' },
            h('b', null, '⚠ Tem que ser o mesmo Gmail do próximo passo (4. E-mail)'),
            h('div', null, 'O FIXE manda as planilhas para este endereço e é nessa mesma caixa de e-mail que o painel entra para buscá-las. Se os dois forem diferentes, o cadastro de clientes não chega.'),
            campo('E-mail que recebe a exportação', email, 'O Gmail da loja. O robô pede ao FIXE que mande as planilhas de clientes e de pontos para ele; o painel lê esse Gmail (passo 4) e importa sozinho.'), confere),
          nota('👁 Só leitura: o painel nunca altera nada no FIXE.')),
        pe(async () => {
          await chamar('PUT', `/api/admin/lojas/${encodeURIComponent(L.id)}/fixe`, { url: url.value, usuario: usuario.value, senha: senha.value, email: email.value, apelido: fx.apelido !== false });
          L.fixe = { ...fx, url: url.value.trim(), usuario: usuario.value.trim(), email: email.value.trim().toLowerCase(), temSenha: true };
        })];
      },
      email() {
        const e = L.mail, fxEmail = L.fixe.email || '';
        const user = inp({ type: 'email', value: e.user || caixa(fxEmail) || '', placeholder: 'ex.: teashop.loja@gmail.com' });
        const pass = senhaInp(e.temSenha, 'senha de app (16 letras)');
        const junto = h('input', { type: 'checkbox', checked: true });
        const aviso = h('div', { class: 'notice warn guia-dif', hidden: true });
        const ver = () => {
          const dif = !!(L.passos.fixe && fxEmail && user.value.trim() && !G.mesmoGmail(user.value, fxEmail));
          aviso.hidden = !dif;
          if (dif) aviso.replaceChildren(h('div', null, h('b', null, 'Diferente do e-mail cadastrado no FIXE (passo 3): '), `lá está ${caixa(fxEmail)}. Os dois precisam ser o mesmo Gmail, senão o cadastro de clientes não chega.`),
            h('label', { class: 'cfg-check-l' }, junto, ' Trocar também o e-mail do FIXE para este'));
        };
        user.addEventListener('input', ver); ver();
        return [corpo('Gmail da loja', 'O e-mail da loja no painel: por ele sai o fechamento do dia e as devoluções à franquia, e é nele que o painel recebe as planilhas do FIXE.',
          h('div', { class: 'guia-mesmo' }, h('b', null, 'É o mesmo e-mail do passo 3 (FIXE)'), h('div', null, 'Use aqui o mesmo Gmail que você informou como "E-mail que recebe a exportação". Já vem preenchido quando o passo 3 foi salvo.')),
          h('div', { class: 'guia-g2' },
            campo('Gmail da loja', user, 'O endereço completo, ex.: teashop.loja@gmail.com. De preferência uma conta só da loja, não o seu e-mail pessoal.'),
            campo('Senha de app', pass, 'Não é a senha normal do Gmail: é uma senha de 16 letras que o Google cria só para o painel. O passo a passo está logo abaixo.')),
          aviso,
          h('details', { class: 'cfg-gmail guia-como' }, h('summary', null, 'Como criar a senha de app (uns 5 minutos)'),
            h('ol', null,
              h('li', null, 'Entre no Gmail da loja e abra ', h('b', null, 'myaccount.google.com'), ' → ', h('b', null, 'Segurança'), '.'),
              h('li', null, 'Ative a ', h('b', null, 'Verificação em duas etapas'), ' (o Google manda um código por SMS). Sem isso o próximo passo não aparece.'),
              h('li', null, 'Na busca do topo, digite ', h('b', null, 'Senhas de app'), ' (ou abra ', h('b', null, 'myaccount.google.com/apppasswords'), ').'),
              h('li', null, 'Em "Nome do app" escreva ', h('b', null, 'Painel Tea Shop'), ' e clique em ', h('b', null, 'Criar'), '. Copie a senha de 16 letras na hora: ela não aparece de novo.'),
              h('li', null, 'Cole essa senha no campo "Senha de app" acima.'))),
          nota('✉️ Quem recebe o fechamento do dia e os e-mails da franquia fica em Configurações → Mensagens e Integrações. Aqui é só a conta que envia e recebe.')),
        pe(async () => {
          const u = user.value.trim();
          if (!u) throw new Error('Informe o Gmail da loja.');
          if (!e.host && !/@(gmail|googlemail)\.com$/i.test(u)) throw new Error('Aqui só dá para cadastrar um Gmail (é nele que o painel lê as planilhas do FIXE). Outro provedor: Configurações → Mensagens → Fechamento do dia.');
          if (!pass.value && !e.temSenha) throw new Error('Informe a senha de app do Gmail (16 letras).');
          await chamar('PUT', `/api/admin/lojas/${encodeURIComponent(L.id)}/fechamento-email`, { email: { host: e.host || 'smtp.gmail.com', port: e.port || 587, secure: !!e.secure, user: u, pass: pass.value || undefined, from: e.from && G.mesmoGmail(e.user, u) ? e.from : `${L.nome} <${u}>` } });
          L.mail = { ...e, host: e.host || 'smtp.gmail.com', user: u, temSenha: true, configurado: true };
          if (!aviso.hidden && junto.checked) {
            await chamar('PUT', `/api/admin/lojas/${encodeURIComponent(L.id)}/fixe`, { url: L.fixe.url, usuario: L.fixe.usuario, senha: '', email: u, apelido: L.fixe.apelido !== false });
            L.fixe = { ...L.fixe, email: u.toLowerCase() };
          }
        })];
      },
    };
    // passo 5 (opcional): CFOP da NF-e de venda e de devolução; grava pela mesma rota das Configurações
    PASSO.nfe = () => {
      const f = G.formCfop(L.id, L.nfeCfop, L.cfops);
      return [corpo('CFOP das notas fiscais', 'Qual CFOP o robô usa quando emite a NF-e de venda e a de devolução ao fornecedor no AppNext. Passo opcional: no automático fica como sempre foi.', f.el),
        pe(async () => { L.nfeCfop = await f.salvar(); })];
    };
    const telaFim = () => {
      const prontos = OBRIG.filter((k) => L.passos[k]).length;
      const FEITO = { nfe: 'CFOP das notas salvo.', appnext: 'Acesso salvo. A primeira busca de vendas e estoque roda na próxima atualização automática.', pedido: 'Acesso salvo. O catálogo é lido na atualização da noite.', fixe: 'Acesso salvo. O cadastro de clientes chega depois da próxima atualização.', email: 'Gmail da loja salvo.' };
      const buscar = L.passos.appnext && est.coletorAtivo ? h('button', { type: 'button', class: 'btn', title: 'Pede ao robô para buscar agora as vendas e o estoque no AppNext, sem esperar a atualização automática. Leva alguns minutos.' }, 'Buscar agora') : null;
      if (buscar) buscar.addEventListener('click', async () => {
        buscar.disabled = true;
        try { if (TS.demo) toast(TS.DEMO_AVISO); else { await chamar('POST', `/api/admin/lojas/${encodeURIComponent(L.id)}/rodar`, {}); toast('Busca pedida ao robô. Em alguns minutos os dados aparecem.'); } } catch (e) { toast(e.message, true); buscar.disabled = false; }
      });
      return [h('div', { class: 'guia-corpo' },
        h('div', { class: 'guia-lista' }, ORDEM.map((k, n) => h('div', { class: 'guia-li ' + (L.passos[k] ? 'ok' : OBRIG.includes(k) ? 'pu' : 'op') },
          h('span', { class: 'guia-ic' }, L.passos[k] ? '✓' : '!'),
          h('div', null, h('b', null, ROT[k] + (L.passos[k] ? '' : !OBRIG.includes(k) ? ' — opcional' : pulados.has(k) ? ' — pulado' : ' — falta')), h('small', { class: 'muted' }, L.passos[k] ? FEITO[k] : SEM[k])),
          L.passos[k] ? (k === 'appnext' ? buscar : null) : h('button', { type: 'button', class: 'btn', onclick: () => { fim = false; i = n; pintar(); } }, 'Configurar')))),
        nota(prontos === OBRIG.length ? 'Para mudar qualquer acesso depois: Configurações → Integrações → "Configuração guiada".'
          : 'O que ficou para depois está em Configurações → Integrações → "Configuração guiada". O Início mostra um lembrete até você concluir; esta janela não abre de novo sozinha.')),
      h('div', { class: 'guia-pe' }, h('span', { class: 'guia-esp' }), h('button', { type: 'button', class: 'btn primary', onclick: fechar }, 'Ir para o painel'))];
    };
    function pintar() {
      const prontos = OBRIG.filter((k) => L.passos[k]).length;
      const partes = fim ? telaFim() : PASSO[ORDEM[i]]();
      caixaEl.replaceChildren(fim ? topo(prontos === OBRIG.length ? 'Loja pronta' : 'Loja quase pronta', `${L.nome} · ${prontos} de 4 configurados`) : topo('Vamos deixar a loja pronta', `${L.nome} · passo ${i + 1} de ${ORDEM.length}${ORDEM[i] === 'nfe' ? ' (opcional)' : ''}`), trilha(), ...partes);
      const prim = caixaEl.querySelector('.guia-corpo input:not([type=checkbox])');
      if (prim && !fim && window.matchMedia('(min-width: 721px)').matches) prim.focus();
    }
    try {
      if (!situ) await G.carregar();
      est = await chamar('GET', '/api/admin/estado');
      await carregarLoja(lojaId);
      pintar();
    } catch (e) { caixaEl.replaceChildren(h('div', { class: 'guia-corpo' }, h('div', { class: 'notice err' }, e.message), h('div', { class: 'guia-pe' }, h('button', { type: 'button', class: 'btn', onclick: () => fundo.remove() }, 'Fechar')))); }
  };
})();
