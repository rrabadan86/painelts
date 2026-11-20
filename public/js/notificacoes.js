/* Notificações e aplicativo (menu da pessoa → "🔔 Notificações e aplicativo"):
 * - instalar o painel como aplicativo (botão quando o navegador oferece + instrução manual);
 * - ativar/desativar as notificações NESTE aparelho, escolher os tipos de aviso, enviar um teste e remover aparelhos.
 * O service worker (/sw.js) só mostra a notificação e abre o painel no link; não guarda página.
 * A tela nunca recebe chave nem endereço de entrega: só o id (resumo do endereço), o nome do aparelho, os tipos e as datas.
 * Na apresentação nada é ativado nem enviado. */
(function () {
  const { h } = TS;
  const N = (TS.notif = {});
  const toast = (msg, erro) => { document.querySelectorAll('.toast').forEach((x) => x.remove()); const t = h('div', { class: 'toast' + (erro ? ' err' : ''), role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), erro ? 7000 : 4000); };
  const suporta = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const instalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  // o navegador avisa quando dá para instalar: guarda o convite para o botão "Instalar"
  let convite = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); convite = e; document.dispatchEvent(new CustomEvent('ts-instalavel')); });
  window.addEventListener('appinstalled', () => { convite = null; document.dispatchEvent(new CustomEvent('ts-instalavel')); });

  let registro = null;
  /** registra o service worker (uma vez); sem suporte devolve null */
  N.registrar = async () => {
    if (!('serviceWorker' in navigator)) return null;
    if (!registro) registro = navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready).catch(() => { registro = null; return null; });
    return registro;
  };
  const api = async (metodo, caminho, corpo) => {
    const r = await fetch('/api/push' + caminho, { method: metodo, credentials: 'same-origin', headers: { 'X-Painel': '1', ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.erro || `Erro ${r.status}`); e.dados = j; throw e; }
    return j;
  };
  const bytes = (b64u) => { const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  /** o mesmo id que o servidor dá ao aparelho: começo do SHA-256 do endereço (para marcar "este aparelho" sem o servidor devolver o endereço) */
  const idDe = async (endpoint) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  const assinatura = async () => { const reg = await N.registrar(); return reg ? reg.pushManager.getSubscription() : null; };

  const quando = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

  N.abrir = async function () {
    document.querySelectorAll('.notif-bg').forEach((x) => x.remove());
    const fundo = h('div', { class: 'cp-modal-bg notif-bg' });
    const caixa = h('div', { class: 'card notif', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Notificações e aplicativo' }, h('p', { class: 'muted' }, 'Carregando…'));
    fundo.append(caixa); document.body.append(fundo);
    const fechar = () => { fundo.remove(); document.removeEventListener('ts-instalavel', pintar); };
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
    let est = null, esteId = null, ocupado = false;

    const carregar = async () => {
      est = await api('GET', '');
      esteId = null;
      if (!TS.demo && suporta()) { const s = await assinatura().catch(() => null); if (s) esteId = await idDe(s.endpoint); }
      // o aparelho tem assinatura no navegador mas o painel não conhece (foi removido de outro lugar): desfaz a do navegador
      if (esteId && !est.aparelhos.some((a) => a.id === esteId)) { const s = await assinatura(); if (s) await s.unsubscribe().catch(() => null); esteId = null; }
    };
    const acao = (rotulo, fn, cls = 'btn', dica) => {
      const b = h('button', { type: 'button', class: cls, title: dica || null }, rotulo);
      b.addEventListener('click', async () => {
        if (ocupado) return;
        ocupado = true; b.disabled = true;
        try { if (TS.demo) toast(TS.DEMO_AVISO); else { const m = await fn(); if (m) toast(m); await carregar(); } } catch (e) { toast(e.message, true); if (e.dados && e.dados.aparelhos) { est = { ...est, ...e.dados }; await carregar().catch(() => null); } }
        ocupado = false; pintar();
      });
      return b;
    };
    const ativar = async () => {
      const p = await Notification.requestPermission();
      if (p !== 'granted') throw new Error(p === 'denied' ? 'As notificações estão bloqueadas neste navegador. Veja abaixo como liberar.' : 'Você não respondeu ao pedido de permissão. Clique em "Ativar" de novo e escolha "Permitir".');
      const reg = await N.registrar();
      if (!reg) throw new Error('Não consegui preparar as notificações neste navegador.');
      let s = await reg.pushManager.getSubscription();
      const chave = bytes(est.chave);
      // assinatura feita com outra chave (painel reinstalado): refaz
      if (s && s.options && s.options.applicationServerKey && b64u(s.options.applicationServerKey) !== est.chave) { await s.unsubscribe(); s = null; }
      // o navegador recusou (janela anônima, navegador sem serviço de notificações, sem internet): diz em português, sem o texto técnico
      if (!s) { try { s = await Promise.race([reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave }), new Promise((_, rej) => setTimeout(() => rej(new Error('demorou')), 20000))]); } catch (e) { throw new Error('O navegador não deixou ativar as notificações. Confira se não é uma janela anônima e se o aparelho está com internet; depois tente de novo.'); } }
      const j = s.toJSON();
      await api('POST', '/aparelhos', { endpoint: j.endpoint, keys: j.keys });
      return 'Notificações ativadas neste aparelho. Use "Enviar teste" para conferir.';
    };
    const desativar = async (id) => {
      if (id === esteId) { const s = await assinatura(); if (s) await s.unsubscribe().catch(() => null); }
      await api('DELETE', '/aparelhos/' + encodeURIComponent(id));
      return id === esteId ? 'Notificações desativadas neste aparelho.' : 'Aparelho removido.';
    };

    function blocoInstalar() {
      const passos = h('details', { class: 'notif-como' }, h('summary', null, 'Como instalar à mão'),
        h('ul', null,
          h('li', null, h('b', null, 'Android (Chrome): '), 'menu ⋮ do navegador → "Adicionar à tela inicial" ou "Instalar app".'),
          h('li', null, h('b', null, 'iPhone e iPad (Safari): '), 'botão Compartilhar (quadrado com a seta) → "Adicionar à Tela de Início". Precisa ser pelo Safari.'),
          h('li', null, h('b', null, 'Computador (Chrome ou Edge): '), 'ícone de instalar no fim da barra de endereço, ou menu ⋮ → "Transmitir, salvar e compartilhar" → "Instalar página como app".')));
      const btn = convite && !instalado() ? h('button', { type: 'button', class: 'btn primary', title: 'Instala o painel como aplicativo neste aparelho: ganha ícone próprio e abre sem a barra do navegador.' }, 'Instalar') : null;
      if (btn) btn.addEventListener('click', async () => { if (TS.demo) { toast(TS.DEMO_AVISO); return; } const c = convite; convite = null; c.prompt(); try { await c.userChoice; } catch { /* fechou */ } pintar(); });
      return h('section', { class: 'notif-sec' }, h('h3', null, 'Aplicativo', TS.dica('O painel pode ficar instalado como aplicativo no celular e no computador: ganha um ícone, abre em janela própria e recebe notificações. É o mesmo painel, com o mesmo login.')),
        instalado() ? h('p', { class: 'pos' }, '✓ Você está usando o painel instalado como aplicativo.')
          : h('p', { class: 'muted' }, btn ? 'Este navegador deixa instalar o painel como aplicativo.' : 'Para instalar o painel como aplicativo neste aparelho, siga a instrução abaixo.'),
        btn ? h('div', { class: 'notif-acoes' }, btn) : null, instalado() ? null : passos);
    }
    function blocoEste() {
      const sec = h('section', { class: 'notif-sec' }, h('h3', null, 'Notificações neste aparelho', TS.dica('Avisos que chegam mesmo com o painel fechado. Vale para este aparelho e este navegador: no celular e no computador, ative em cada um.')));
      if (TS.demo) { sec.append(h('p', { class: 'muted' }, 'Na apresentação as notificações não são ativadas. No painel de verdade, o botão "Ativar neste aparelho" pede a permissão do navegador.'), h('div', { class: 'notif-acoes' }, acao('Ativar neste aparelho', async () => null, 'btn primary'))); return sec; }
      if (ios && !instalado()) { sec.append(h('div', { class: 'notice warn' }, h('b', null, 'No iPhone e no iPad as notificações só funcionam com o painel instalado. '), 'Abra o painel no Safari, toque em Compartilhar → "Adicionar à Tela de Início", abra pelo ícone novo e volte aqui. Precisa de iOS 16.4 ou mais novo.')); return sec; }
      if (!suporta()) { sec.append(h('div', { class: 'notice warn' }, h('b', null, 'Este navegador não recebe notificações do painel. '), ios ? 'Atualize o iPhone/iPad para o iOS 16.4 ou mais novo.' : 'Use o Chrome, o Edge ou o Firefox atualizados (em janela normal, não anônima).')); return sec; }
      if (Notification.permission === 'denied') {
        sec.append(h('div', { class: 'notice err' }, h('b', null, 'As notificações do painel estão bloqueadas neste navegador. '),
          android ? 'Toque no cadeado ao lado do endereço → Permissões → Notificações → Permitir, e recarregue a página.' : ios ? 'Abra Ajustes → Notificações → Tea Shop e ligue "Permitir Notificações".' : 'Clique no cadeado (ou no ícone ao lado do endereço) → Notificações → Permitir, e recarregue a página.'));
        return sec;
      }
      const ap = est.aparelhos.find((a) => a.id === esteId);
      if (!ap) { sec.append(h('p', { class: 'muted' }, 'Desativadas neste aparelho.'), h('div', { class: 'notif-acoes' }, acao('Ativar neste aparelho', ativar, 'btn primary', 'O navegador vai pedir a permissão: escolha "Permitir". Depois você escolhe quais avisos quer receber.'))); return sec; }
      sec.append(h('p', { class: 'pos' }, `✓ Ativadas neste aparelho (${ap.nome}).`), tiposDe(ap),
        h('div', { class: 'notif-acoes' },
          acao('Enviar teste', async () => { await api('POST', '/teste', { id: ap.id }); return 'Teste enviado. A notificação deve aparecer em instantes.'; }, 'btn primary', 'Manda uma notificação de teste para este aparelho, pelo mesmo caminho dos avisos de verdade.'),
          acao('Desativar neste aparelho', () => desativar(ap.id), 'btn', 'Este aparelho para de receber notificações do painel. Dá para ativar de novo quando quiser.')));
      return sec;
    }
    /** caixas dos tipos de aviso de um aparelho (grava ao marcar) */
    function tiposDe(ap) {
      if (!est.tipos.length) return h('p', { class: 'muted' }, 'Seu usuário não tem nenhum tipo de aviso disponível.');
      return h('div', { class: 'notif-tipos' }, h('div', { class: 'f-label' }, 'Avisos que este aparelho recebe'),
        est.tipos.map((t) => {
          const cb = h('input', { type: 'checkbox', checked: ap.tipos.includes(t.id) || null });
          cb.addEventListener('change', async () => {
            if (TS.demo) { toast(TS.DEMO_AVISO); cb.checked = !cb.checked; return; }
            const novos = est.tipos.map((x) => x.id).filter((id) => (id === t.id ? cb.checked : ap.tipos.includes(id)));
            try { const j = await api('PUT', '/aparelhos/' + encodeURIComponent(ap.id), { tipos: novos }); est = { ...est, ...j }; ap.tipos = novos; } catch (e) { cb.checked = !cb.checked; toast(e.message, true); }
          });
          return h('label', { class: 'cfg-check-l notif-tipo' }, cb, h('span', null, ' ' + t.nome), TS.dica(t.dica));
        }));
    }
    function blocoLista() {
      const outros = est.aparelhos.filter((a) => a.id !== esteId);
      if (!est.aparelhos.length) return null;
      return h('section', { class: 'notif-sec' }, h('h3', null, 'Seus aparelhos', TS.dica('Todos os aparelhos em que você ativou as notificações. Só você vê esta lista. Remova o que não usa mais (celular trocado, computador de outra pessoa).')),
        h('div', { class: 'notif-lista' }, est.aparelhos.map((a) => h('div', { class: 'notif-ap' },
          h('div', null, h('b', null, a.nome, a.id === esteId ? h('span', { class: 'badge ok notif-este' }, 'este aparelho') : null),
            h('small', { class: 'muted' }, `ativado em ${quando(a.criadoEm)} · último aviso: ${quando(a.ultimoEm)} · ${a.tipos.length ? a.tipos.map((id) => (est.tipos.find((t) => t.id === id) || { nome: id }).nome).join('; ') : 'nenhum tipo de aviso marcado'}`)),
          acao('Remover', () => desativar(a.id), 'btn ghost-danger', 'Este aparelho para de receber notificações do painel.')))),
        outros.length ? h('small', { class: 'muted' }, 'Para mudar os tipos de aviso de outro aparelho, abra esta tela nele.') : null);
    }
    function pintar() {
      if (!fundo.isConnected) return;
      caixa.replaceChildren(...[
        h('div', { class: 'notif-topo' }, h('h2', null, 'Notificações e aplicativo'), h('button', { type: 'button', class: 'link-btn', 'aria-label': 'Fechar', onclick: fechar }, 'Fechar ✕')),
        blocoInstalar(), blocoEste(), blocoLista(),
      ].filter(Boolean));
    }
    document.addEventListener('ts-instalavel', pintar);
    try { await carregar(); pintar(); } catch (e) { caixa.replaceChildren(h('div', { class: 'notice err' }, e.message), h('div', { class: 'notif-acoes' }, h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Fechar'))); }
  };

  /** ao entrar: registra o service worker e liga o item do menu da pessoa */
  N.iniciar = function () {
    N.registrar();
    const b = document.getElementById('btnNotif');
    if (b && !b._ligado) { b._ligado = true; b.addEventListener('click', () => { const pop = document.getElementById('userPop'); if (pop) pop.hidden = true; N.abrir(); }); }
  };
})();
