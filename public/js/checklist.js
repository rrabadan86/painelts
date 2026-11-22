/* Equipe → Checklist: abertura e fechamento da loja. Cada item marcado guarda quem fez e a hora; o resumo do dia
 * vai no e-mail de fechamento. A lista de itens muda aqui mesmo (gerente, franqueado e admin). */
(function () {
  const { h, fmt, state } = TS;
  const toast = (msg, erro) => { const t = h('div', { class: 'toast' + (erro ? ' err' : '') }, msg); document.body.append(t); setTimeout(() => t.remove(), erro ? 6000 : 3000); };
  const NOMES = { abertura: 'Abertura', fechamento: 'Fechamento' };
  const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '');
  const hojeIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  // apresentação: fica só na página
  const DEMO = { marcados: {}, itens: null };
  async function api(metodo, p, corpo) {
    if (TS.demo) {
      if (!DEMO.itens) DEMO.itens = { abertura: ['Ligar luzes, som e ar-condicionado', 'Conferir o troco do caixa', 'Limpar balcão e vitrine', 'Preparar o chá de degustação'].map((texto, k) => ({ id: 'a' + k, texto })), fechamento: ['Fechar o caixa no AppNext', 'Lavar bules e xícaras', 'Desligar equipamentos', 'Trancar a loja e ligar o alarme'].map((texto, k) => ({ id: 'f' + k, texto })) };
      const dia = hojeIso();
      const m = DEMO.marcados[dia] || (DEMO.marcados[dia] = { abertura: {}, fechamento: {}, obs: {} });
      if (metodo === 'GET') return { dia, hoje: dia, itens: DEMO.itens, marcados: m, historico: [], podeEditar: true };
      if (p === 'checklist/itens') { DEMO.itens = corpo; return { ok: corpo }; }
      if (corpo.obs != null) m.obs[corpo.tipo] = corpo.obs; else if (corpo.feito) m[corpo.tipo][corpo.item] = { por: 'apresentacao', em: new Date().toISOString() }; else delete m[corpo.tipo][corpo.item];
      return { ok: true, marcados: m };
    }
    const r = await fetch('/api/' + p, { method: metodo, credentials: 'same-origin', headers: corpo ? { 'Content-Type': 'application/json', 'X-Painel': '1' } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha.');
    return j;
  }

  TS.pages.checklist = function (root) {
    if (TS.subGrupo) root.append(TS.subGrupo('checklist'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Checklist da loja'),
      h('div', { class: 'page-sub' }, 'Abertura e fechamento: marque cada item quando fizer. Fica o nome e a hora, e o resumo vai no e-mail de fechamento do dia.'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'Escolha a loja no seletor do topo.')); return; }
    const corpo = h('div', { class: 'mt' });
    root.append(corpo);
    const loja = state.loja;
    if (state.ckDiaLoja !== state.loja) state.ckDia = null; // trocou de loja: volta para hoje
    state.ckDiaLoja = state.loja;
    const dia = state.ckDia || null;
    api('GET', `checklist?loja=${encodeURIComponent(loja)}${dia ? '&dia=' + dia : ''}`).then((d) => { if (corpo.isConnected) pintar(corpo, loja, d); })
      .catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  };

  function pintar(corpo, loja, d) {
    const ehHoje = d.dia === d.hoje;
    const ontem = new Date(Date.parse(d.hoje + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
    const podeMarcar = ehHoje || d.dia === ontem;
    const parte = (tipo) => {
      const its = d.itens[tipo], m = d.marcados[tipo] || {};
      const feitos = its.filter((x) => m[x.id]).length;
      const barra = h('div', { class: 'md-barra' }, h('i', { style: { width: (its.length ? (feitos / its.length) * 100 : 0) + '%' } }));
      const obs = h('textarea', { class: 'f-input ck-obs', rows: 2, placeholder: 'Observação (opcional): algo que aconteceu, o que faltou…', disabled: !podeMarcar || null }, (d.marcados.obs || {})[tipo] || '');
      obs.addEventListener('change', async () => { try { const r = await api('POST', 'checklist/marcar', { loja, dia: d.dia, tipo, obs: obs.value }); d.marcados = r.marcados; toast('Observação salva.'); } catch (e) { toast(e.message, true); } });
      return h('div', { class: 'card ck-parte' + (feitos === its.length ? ' ok' : '') },
        h('div', { class: 'ck-topo' }, h('h2', { class: 'card-title' }, NOMES[tipo]), feitos === its.length ? TS.etqPrazo('ok', '✓ completo') : h('b', { class: 'ck-cont' }, `${feitos} de ${its.length}`)),
        barra,
        h('div', { class: 'ck-lista' }, ...its.map((x) => {
          const feito = m[x.id];
          const cb = h('input', { type: 'checkbox', checked: !!feito || null, disabled: !podeMarcar || null });
          cb.addEventListener('change', async () => {
            cb.disabled = true;
            try { const r = await api('POST', 'checklist/marcar', { loja, dia: d.dia, tipo, item: x.id, feito: cb.checked }); d.marcados = r.marcados; pintar(corpo, loja, d); } catch (e) { toast(e.message, true); cb.checked = !cb.checked; cb.disabled = false; }
          });
          return h('label', { class: 'ck-item' + (feito ? ' on' : '') }, cb, h('span', { class: 'ck-txt' }, x.texto), feito ? h('small', { class: 'ck-quem' }, `${hora(feito.em)} · ${feito.por || ''}`) : null);
        })),
        obs);
    };
    const hist = (d.historico || []).length ? TS.table({
      cols: [
        { key: 'dia', label: 'Dia', align: 'l', render: (x) => h('a', { href: '#', class: 'prc-nome', onclick: (e) => { e.preventDefault(); state.ckDia = x.dia; TS.render(); } }, fmt.date(x.dia)) },
        ...['abertura', 'fechamento'].map((t) => ({ key: t, label: NOMES[t], align: 'l', render: (x) => { const r = x[t]; if (!r) return '—'; return r.feitos === r.total ? h('span', { class: 'cf-st cf-ok' }, `✓ ${hora(r.ultima && r.ultima.em)}${r.ultima && r.ultima.por ? ' · ' + r.ultima.por : ''}`) : h('span', { class: 'cf-st ' + (r.feitos ? 'cf-aberto' : 'cf-atrasado') }, `${r.feitos} de ${r.total}`); }, sortVal: (x) => (x[t] ? x[t].feitos / x[t].total : 0) })),
      ],
      rows: d.historico, sortKey: 'dia', pageSize: 10, cls: 'est-t',
    }) : null;
    corpo.replaceChildren(...[
      h('div', { class: 'ck-dia' }, h('b', null, ehHoje ? `Hoje, ${fmt.date(d.dia)}` : fmt.date(d.dia)),
        !ehHoje ? h('button', { type: 'button', class: 'btn', onclick: () => { state.ckDia = null; TS.render(); } }, 'Voltar para hoje') : null,
        !podeMarcar ? h('small', { class: 'muted' }, 'Dia passado: só para consulta.') : null,
        d.podeEditar ? h('button', { type: 'button', class: 'link-btn ck-editar', onclick: () => editarItens(corpo, loja, d) }, 'Editar os itens') : null),
      h('div', { class: 'ck-grade' }, parte('abertura'), parte('fechamento')),
      hist ? h('div', { class: 'mt' }, TS.cardSec('Últimos dias', { sub: 'toque num dia para ver o checklist dele', dica: 'Cada dia com quantos itens de abertura e de fechamento foram marcados, a hora do último e quem marcou.' }, hist)) : null].filter(Boolean));
  }

  function editarItens(corpo, loja, d) {
    const its = JSON.parse(JSON.stringify(d.itens));
    const fundo = h('div', { class: 'cp-modal-bg' });
    const fechar = () => fundo.remove();
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    const lista = (tipo) => {
      const box = h('div', { class: 'ck-ed-lista' });
      const pintarL = () => box.replaceChildren(...its[tipo].map((x, k) => {
        const inp = h('input', { class: 'f-input', value: x.texto, maxlength: 120 });
        inp.addEventListener('input', () => { x.texto = inp.value; });
        return h('div', { class: 'ck-ed-l' }, inp,
          h('button', { type: 'button', class: 'cf-b', 'aria-label': 'Subir', disabled: !k || null, onclick: () => { [its[tipo][k - 1], its[tipo][k]] = [its[tipo][k], its[tipo][k - 1]]; pintarL(); } }, '↑'),
          h('button', { type: 'button', class: 'cf-b', 'aria-label': 'Tirar', onclick: () => { its[tipo].splice(k, 1); pintarL(); } }, '✕'));
      }), h('button', { type: 'button', class: 'link-btn', onclick: () => { its[tipo].push({ id: '', texto: '' }); pintarL(); const l = box.querySelectorAll('input'); l[l.length - 1].focus(); } }, '+ incluir item'));
      pintarL();
      return box;
    };
    fundo.append(h('div', { class: 'card cp-copiar cf-ligar ck-ed' },
      h('div', { class: 'cfl-cab' }, h('h3', null, 'Itens do checklist'), h('button', { type: 'button', class: 'cf-b', 'aria-label': 'Fechar', onclick: fechar }, '✕')),
      h('div', { class: 'ck-ed-grade' }, h('div', null, h('div', { class: 'cfe-sec' }, 'Abertura'), lista('abertura')), h('div', null, h('div', { class: 'cfe-sec' }, 'Fechamento'), lista('fechamento'))),
      h('div', { class: 'cp-acoes' }, h('span', { style: { flex: 1 } }), h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Cancelar'),
        h('button', { type: 'button', class: 'btn primary', onclick: async () => {
          try { const r = await api('PUT', 'checklist/itens', { loja, abertura: its.abertura.filter((x) => x.texto.trim()), fechamento: its.fechamento.filter((x) => x.texto.trim()) }); d.itens = r.ok; fechar(); pintar(corpo, loja, d); toast('Checklist atualizado.'); } catch (e) { toast(e.message, true); }
        } }, 'Salvar'))));
    document.body.append(fundo);
  }
})();
