/* "O que mudou no painel" (decisão do dono, 24/11/2026; NOV-01…03): ao entrar depois de uma mudança, uma janela com as
 * novidades que valem para a pessoa, uma vez só (o servidor guarda até onde ela viu). Pelo menu do nome dá para ver de novo.
 * As novidades ficam em src/novidades.js. Na apresentação a janela não abre sozinha. */
'use strict';
(function () {
  const { h } = TS;
  const N = (TS.novidades = {});
  const dataBr = (d) => String(d || '').split('-').reverse().join('/');

  function janela(itens, { aoFechar, titulo = 'O que mudou no painel' } = {}) {
    document.querySelectorAll('.nov-bg').forEach((x) => x.remove());
    const fechar = () => { bg.remove(); document.removeEventListener('keydown', esc); if (aoFechar) aoFechar(); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    const ok = h('button', { type: 'button', class: 'btn primary', onclick: fechar }, 'Entendi');
    const lista = itens.length
      ? h('ul', { class: 'nov-lista' }, ...itens.map((n) => h('li', { class: 'nov-item' }, h('div', { class: 'nov-tit' }, n.titulo, h('small', { class: 'muted' }, ` · ${dataBr(n.data)}`)), h('p', null, n.texto))))
      : h('p', { class: 'muted' }, 'Nenhuma novidade para você por enquanto.');
    const caixa = h('div', { class: 'nov-caixa', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'nov-titulo' },
      h('h2', { id: 'nov-titulo' }, '✨ ', titulo), lista, h('div', { class: 'nov-acoes' }, ok));
    const bg = h('div', { class: 'cp-modal-bg ts-aviso-bg nov-bg' }, caixa);
    bg.addEventListener('click', (e) => { if (e.target === bg) fechar(); });
    document.addEventListener('keydown', esc);
    document.body.append(bg);
    ok.focus();
  }

  /** ao entrar: abre sozinha se houver novidade ainda não vista (e marca como vista ao fechar) */
  N.conferir = async function () {
    if (TS.demo) return;
    try {
      const r = await fetch(TS.api('novidades'), { credentials: 'same-origin' });
      if (!r.ok) return;
      const j = await r.json();
      if (!j.itens || !j.itens.length) return;
      janela(j.itens, { aoFechar: () => { fetch(TS.api('novidades/visto'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ ate: j.ultimo }) }).catch(() => {}); } });
    } catch { /* sem rede: tenta no próximo acesso */ }
  };

  /** menu do nome → "O que mudou no painel": as últimas novidades da pessoa, a qualquer hora */
  N.abrir = async function () {
    try {
      const j = await (await fetch(TS.api('novidades') + '?todas=1', { credentials: 'same-origin' })).json();
      janela(j.itens || []);
    } catch { TS.avisarErro ? TS.avisarErro('Não consegui buscar as novidades. Tente de novo.') : null; }
  };

  N.iniciar = function () {
    const b = document.getElementById('btnNovidades');
    if (b && !b._ligado) { b._ligado = true; b.addEventListener('click', () => { const pop = document.getElementById('userPop'); if (pop) pop.hidden = true; N.abrir(); }); }
    N.conferir();
  };
})();
