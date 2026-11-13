/* Atualizações do painel (só administrador): mostra as novidades disponíveis e pede a atualização.
   Quem instala de fato é o scripts/atualizador.sh, que roda na VPS pelo cron. */
'use strict';
(function () {
  const { h } = TS;
  const btn = document.getElementById('btnSistema');
  const pop = document.getElementById('sistemaPop');
  const nEl = btn.querySelector('.sis-n');
  let info = null, timer = null, acompanhando = false, versaoAntes = null;

  const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
  const atualizando = () => info && (info.pedido || (info.status && info.status.estado === 'atualizando'));
  const api = async (metodo, url) => {
    const r = await fetch('/api/admin' + url, { method: metodo, credentials: 'same-origin', headers: { 'X-Painel': '1' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
    return j;
  };
  function toast(msg) { const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 6000); }

  /** "Estoque e margem: importa…" → título "Estoque e margem" + detalhe; sem título, a 1ª frase vira o título */
  function partes(msg) {
    const m = String(msg || '').trim();
    const i = m.indexOf(': ');
    if (i > 0 && i < 60) return { t: m.slice(0, i), d: m.slice(i + 2) };
    const j = m.search(/[;.] /);
    return j > 0 && j < 90 ? { t: m.slice(0, j), d: m.slice(j + 2) } : { t: m, d: '' };
  }
  const maiuscula = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
  function itemLista(c) {
    const p = partes(c.msg);
    const det = p.d ? h('div', { class: 'sis-det' }, maiuscula(p.d)) : null;
    const li = h('li', { class: det ? 'tem-det' : '', title: det ? 'Toque para ver tudo' : '' },
      h('div', { class: 'sis-l1' }, h('b', null, maiuscula(p.t)), h('small', null, dia(c.data))), det);
    if (det) li.addEventListener('click', () => li.classList.toggle('aberto'));
    return li;
  }

  function pintar() {
    const n = info && info.instalado ? info.novidades.length : 0;
    nEl.hidden = !(n || atualizando());
    nEl.textContent = atualizando() ? '…' : n > 9 ? '9+' : String(n);
    btn.classList.toggle('rodando', !!atualizando());
    btn.title = n ? `${n} novidade(s) para instalar` : 'Atualizações do painel';
    if (pop.hidden) return;
    const fechar = h('button', { type: 'button', class: 'sis-x', 'aria-label': 'Fechar', onclick: () => { pop.hidden = true; } }, '✕');
    pop.replaceChildren(h('div', { class: 'sis-topo' }, h('h3', null, 'Atualizações do painel'), fechar));
    if (!info) { pop.append(h('p', null, 'Carregando…')); return; }
    if (!info.instalado) {
      pop.append(h('p', null, 'Para atualizar por aqui, instale uma vez o atualizador na VPS (com o mesmo usuário que roda o git pull):'),
        h('pre', { class: 'script-log' }, 'cd /opt/teashop-painel && git pull\nchmod +x scripts/atualizador.sh\n(crontab -l 2>/dev/null; echo "* * * * * /opt/teashop-painel/scripts/atualizador.sh") | crontab -'),
        h('div', { class: 'aviso' }, 'Em até 1 minuto as novidades aparecem aqui.'));
      return;
    }
    const corpo = h('div', { class: 'sis-corpo' });
    const st = info.status;
    // situação
    if (atualizando()) corpo.append(h('div', { class: 'script-status' }, h('span', { class: 'ic rodando' }, '…'), h('span', null, info.pedido ? 'Pedido enviado, começando em até 1 minuto…' : 'Atualizando…', h('small', null, 'Leva de 1 a 3 minutos. O painel fica fora do ar alguns segundos e recarrega sozinho.'))));
    else if (st && st.estado === 'erro') corpo.append(h('div', { class: 'script-status' }, h('span', { class: 'ic falhou' }, '!'), h('span', null, st.msg, h('small', null, quando(st.em)))));
    else if (!info.novidades.length) corpo.append(h('div', { class: 'script-status' }, h('span', { class: 'ic ok' }, '✓'), h('span', null, 'O painel está na versão mais recente.')));
    if (info.parado) corpo.append(h('div', { class: 'notice err' }, 'O atualizador da VPS não verifica há mais de 20 minutos. Confira o cron na VPS (crontab -l).'));
    // para instalar
    if (info.novidades.length) {
      corpo.append(h('div', { class: 'sis-sec' }, `Para instalar · ${info.novidades.length}`),
        h('ul', { class: 'sis-lista' }, info.novidades.map(itemLista)));
      const b = h('button', { class: 'btn primary', type: 'button', disabled: atualizando() || null }, atualizando() ? 'Atualização em andamento' : `Instalar ${info.novidades.length === 1 ? 'a novidade' : `as ${info.novidades.length} novidades`}`);
      b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = 'Enviando…';
        try { await api('POST', '/sistema/atualizar'); acompanhando = true; versaoAntes = info.atual && info.atual.sha; toast('Atualização pedida. O painel recarrega sozinho quando terminar.'); }
        catch (e) { toast(e.message); }
        consultar();
      });
      corpo.append(h('div', { class: 'sis-acao' }, b));
    }
    // instaladas recentemente
    const rec = (info.recentes && info.recentes.length ? info.recentes : info.atual ? [info.atual] : []).slice(0, 8);
    if (rec.length) corpo.append(h('div', { class: 'sis-sec' }, 'Instaladas recentemente'), h('ul', { class: 'sis-lista sis-rec' }, rec.map(itemLista)));
    pop.append(corpo);
    const verificar = h('button', { class: 'link-btn', type: 'button' }, 'Verificar agora');
    verificar.addEventListener('click', async () => { verificar.textContent = 'Verificando…'; try { await api('POST', '/sistema/verificar'); setTimeout(consultar, 65e3); } catch (e) { toast(e.message); } });
    pop.append(h('div', { class: 'sis-rodape' }, h('span', null, info.atual ? `Versão ${info.atual.sha} · ${quando(info.atual.data)}` : ''), h('span', null, `Verificado ${quando(info.verificado)} · `, verificar)));
  }

  async function consultar() {
    try {
      const r = await fetch('/api/admin/sistema', { credentials: 'same-origin' });
      if (r.status === 401) { location.href = '/login'; return; }
      if (!r.ok) throw new Error('fora do ar');
      info = await r.json();
      // terminou a atualização que acompanhamos
      if (acompanhando && !atualizando() && info.status) {
        acompanhando = false;
        if (info.status.estado === 'ok') { toast('Painel atualizado. Recarregando…'); setTimeout(() => location.reload(), 1500); }
        else if (info.status.estado === 'erro') toast(info.status.msg);
      }
    } catch (e) {
      // durante a reconstrução o painel some por alguns segundos: tenta de novo
    }
    pintar();
    clearTimeout(timer);
    timer = setTimeout(consultar, acompanhando || atualizando() ? 5e3 : 10 * 60e3);
  }

  btn.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) { pintar(); consultar(); } });
  document.addEventListener('click', (e) => { if (!pop.hidden && !e.target.closest('.sis-wrap')) pop.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });

  /** chamado pelo main.js quando sabe quem entrou */
  TS.sistemaInit = function (eu) {
    if (TS.demo || !eu || eu.perfil !== 'admin') return;
    btn.hidden = false;
    consultar();
  };
})();
