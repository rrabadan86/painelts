/* Foto do produto (TS.foto): miniatura ao lado do nome nas listas e janela com a foto grande.
 * As fotos são as do site da Tea Shop (consulta diária de src/site.js); o painel não copia: o navegador mostra direto
 * do site, só dos servidores liberados no cabeçalho de segurança. A ligação com o produto da loja é pelo código (SKU do
 * site = código do produto, sem zeros à esquerda) e, sem código igual, pelo nome idêntico. Chá a granel não tem foto.
 * Sem foto, a lista fica como era (nenhum espaço vazio). */
(function () {
  'use strict';
  const h = TS.h;
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const semZeros = (c) => String(c ?? '').trim().replace(/^0+/, '');
  let indice = null, pedido = null, chave = null; // { porCod, porNome }; na apresentação as fotos fictícias são por loja

  function montar(itens) {
    const porCod = new Map(), porNome = new Map();
    for (const x of itens || []) {
      if (!x || !Array.isArray(x.i) || !x.i.length) continue;
      const f = { imgs: x.i, url: x.u || '', nome: [x.n, x.v].filter(Boolean).join(' · ') };
      const c = semZeros(x.s);
      if (c && !porCod.has(c)) porCod.set(c, f);
      for (const n of [norm(x.n + ' ' + (x.v || '')), norm(x.n)]) if (n && !porNome.has(n)) porNome.set(n, f);
    }
    return { porCod, porNome };
  }
  /** busca as fotos uma vez por sessão do painel; nunca derruba a tela (sem fotos = listas como antes) */
  function carregar() {
    const k = TS.demo ? String(TS.state.loja || '') : 'painel';
    if (pedido && chave === k) return pedido;
    chave = k;
    pedido = fetch(`${TS.api('site/fotos')}?loja=${encodeURIComponent(TS.state.loja || '')}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { itens: [] })).then((d) => { indice = montar(d && d.itens); return indice; })
      .catch(() => { pedido = null; indice = montar([]); return indice; });
    return pedido;
  }
  /** foto do produto: { imgs, url, nome } ou null (só depois de `carregar()`) */
  function de(cod, nome) {
    if (!indice) return null;
    return indice.porCod.get(semZeros(cod)) || indice.porNome.get(norm(nome)) || null;
  }
  // a loja do site entrega a foto no tamanho pedido: miniatura leve na lista, grande só na janela
  const tam = (u, w) => (/^data:/.test(u) ? u : u + (u.includes('?') ? '&' : '?') + 'width=' + w);
  const img = (u, w, alt, cls) => {
    const el = h('img', { class: cls, src: tam(u, w), alt, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    el.addEventListener('error', () => { const b = el.closest('.foto-mini'); if (b) b.remove(); else el.classList.add('foto-erro'); }, { once: true });
    return el;
  };

  /** janela com a foto grande: troca entre as fotos do produto, "Abrir no site" e fechar (Esc, clique fora, voltar do celular) */
  function abrir(f, info) {
    document.querySelectorAll('.foto-bg').forEach((x) => x.remove());
    const nome = (info && info.nome) || f.nome;
    const fundo = h('div', { class: 'cp-modal-bg foto-bg' });
    const grande = h('div', { class: 'foto-grande' });
    const minis = h('div', { class: 'foto-minis' });
    const mostrar = (k) => {
      grande.replaceChildren(img(f.imgs[k], 900, `Foto de ${nome}`, 'foto-img'));
      minis.querySelectorAll('button').forEach((b, j) => { b.classList.toggle('on', j === k); b.setAttribute('aria-pressed', j === k ? 'true' : 'false'); });
    };
    if (f.imgs.length > 1) minis.append(...f.imgs.map((u, k) => h('button', { type: 'button', class: 'foto-outra', title: `Foto ${k + 1} de ${f.imgs.length}`, onclick: () => mostrar(k) }, img(u, 120, `Foto ${k + 1} de ${nome}`, 'foto-img'))));
    const fechar = () => fundo.remove();
    const btFechar = h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Fechar');
    const caixa = h('div', { class: 'card foto-janela', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Foto de ${nome}` },
      h('div', { class: 'foto-cab' }, h('b', null, nome), h('button', { type: 'button', class: 'foto-x', 'aria-label': 'Fechar', onclick: fechar }, '✕')),
      grande, f.imgs.length > 1 ? minis : null,
      h('div', { class: 'foto-info' }, [info && info.cod ? `cód. ${info.cod}` : '', info && info.grupo ? info.grupo : ''].filter(Boolean).join(' · '),
        h('small', { class: 'muted' }, 'Foto do site da Tea Shop, ligada pelo código do produto (ou pelo nome). Atualizada uma vez por dia.')),
      h('div', { class: 'cfg-acoes foto-acoes' }, f.url && f.url !== '#' ? h('a', { class: 'btn primary', href: f.url, target: '_blank', rel: 'noopener' }, 'Abrir no site ↗') : null, btFechar));
    fundo.append(caixa); document.body.append(fundo);
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } });
    mostrar(0);
    btFechar.focus();
  }

  /** miniatura clicável (ou null quando o produto não tem foto): vai antes do nome */
  function mini(cod, nome, info) {
    const f = de(cod, nome);
    if (!f) return null;
    return h('button', { type: 'button', class: 'foto-mini', title: 'Ver a foto do produto', 'aria-label': `Ver a foto de ${nome}`, onclick: (e) => { e.stopPropagation(); e.preventDefault(); abrir(f, { cod, nome, ...(info || {}) }); } },
      img(f.imgs[0], 120, '', 'foto-img'));
  }
  /** põe a miniatura à esquerda do conteúdo da célula/cartão (devolve o próprio conteúdo quando não há foto) */
  function comMini(conteudo, cod, nome, info) {
    const m = mini(cod, nome, info);
    return m ? h('span', { class: 'foto-cel' }, m, h('span', { class: 'foto-txt' }, conteudo)) : conteudo;
  }

  TS.foto = { carregar, de, mini, comMini, abrir, montar };
})();
