/* Devolução ao fornecedor a partir de uma nota de entrada: escolhe os itens (danificado ou não chegou), quantidades,
   até 3 fotos de cada danificado; o painel monta a planilha e manda por e-mail para os destinatários da loja. */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  const api = async (metodo, rota, corpo) => {
    const r = await fetch(TS.api(rota), { method: metodo, credentials: 'same-origin', headers: metodo === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha.');
    return j;
  };
  const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const EMAIL_TXT = { enviado: 'e-mail enviado', erro: 'e-mail não foi enviado', sem_destinatarios: 'sem destinatários: e-mail não enviado', pendente: 'enviando e-mail…' };

  /** reduz a foto do celular para JPEG de até 1600 px (cabe no e-mail e na planilha) */
  function reduzir(arquivo) {
    return new Promise((ok, falha) => {
      const img = new Image();
      const leitor = new FileReader(); // data: (a política de segurança do painel não deixa abrir blob:)
      leitor.onload = () => { img.src = leitor.result; };
      leitor.onerror = () => falha(new Error('Não consegui ler a foto.'));
      img.onload = () => {
        const max = 1600, esc = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.width * esc); cv.height = Math.round(img.height * esc);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        let q = 0.82, d = cv.toDataURL('image/jpeg', q);
        while (d.length > 1150000 && q > 0.4) { q -= 0.1; d = cv.toDataURL('image/jpeg', q); }
        ok(d);
      };
      img.onerror = () => falha(new Error('Não consegui abrir a foto (use JPG ou PNG).'));
      leitor.readAsDataURL(arquivo);
    });
  }

  function barra(n, card) {
    const loja = state.loja;
    const box = h('div', { class: 'dev-barra' });
    const bt = h('button', { type: 'button', class: 'btn' }, '↩ Devolver itens ao fornecedor');
    bt.addEventListener('click', () => formulario(n, box, loja));
    box.append(bt, h('small', { class: 'muted' }, ' Itens quebrados ou que não chegaram: planilha com fotos por e-mail.'));
    // devoluções já feitas desta nota
    api('GET', `devolucoes?loja=${encodeURIComponent(loja)}`).then((j) => {
      const desta = j.devolucoes.filter((d) => String(d.nota.nf) === String(n.nf) && String(d.nota.id) === String(n.id));
      if (desta.length && box.isConnected) box.append(h('div', { class: 'dev-feitas' }, ...desta.map((d) => itemFeito(d, loja))));
    }).catch(() => null);
    return box;
  }
  function itemFeito(d, loja) {
    const e = d.email || {};
    const reenviar = h('button', { type: 'button', class: 'link-btn' }, 'reenviar e-mail');
    const el = h('div', { class: 'dev-feita' },
      h('b', null, `Devolução de ${quando(d.em)}`), h('small', { class: 'muted' }, ` por ${d.por} · ${d.itens.length} ${d.itens.length === 1 ? 'item' : 'itens'} · `),
      h('span', { class: 'dev-st ' + (e.estado === 'enviado' ? 'ok' : 'erro') }, EMAIL_TXT[e.estado] || e.estado), e.erro ? h('small', { class: 'neg' }, ' ' + e.erro) : null, ' ',
      h('a', { href: TS.api(`devolucoes/${d.id}/planilha?loja=${encodeURIComponent(loja)}`) }, 'planilha'), ' · ', reenviar);
    reenviar.addEventListener('click', async () => { reenviar.disabled = true; try { const r = await api('POST', `devolucoes/${d.id}/reenviar`, { loja }); el.replaceWith(itemFeito(r.devolucao, loja)); } catch (er) { alert(er.message); reenviar.disabled = false; } });
    return el;
  }

  async function formulario(n, box, loja) {
    let dest = [];
    try { dest = (await api('GET', `devolucoes?loja=${encodeURIComponent(loja)}`)).destinatarios; } catch { /* segue */ }
    const sel = new Map(); // cod → { tipo, qtd, obs, fotos: [dataUrl] }
    const lista = h('div', { class: 'dev-itens' });
    const resumo = h('div', { class: 'muted' });
    const pintarResumo = () => { const d = [...sel.values()].filter((x) => x.tipo === 'danificado').length; resumo.textContent = sel.size ? `${sel.size} ${sel.size === 1 ? 'item escolhido' : 'itens escolhidos'} (${d} danificado${d === 1 ? '' : 's'}, ${sel.size - d} não chegou)` : 'Marque os itens a devolver.'; };
    const busca = h('input', { class: 'f-input', placeholder: 'Filtrar produto da nota…' });
    const linhas = n.itens.map((i) => {
      const cb = h('input', { type: 'checkbox' });
      const det = h('div', { class: 'dev-det', hidden: true });
      const el = h('div', { class: 'dev-item' }, h('label', { class: 'dev-item-top' }, cb, h('span', null, h('b', null, i.nome), h('small', { class: 'muted' }, ` cód. ${i.cod} · na nota: ${fmt.n2(i.qtd).replace(/,00$/, '')} ${String(i.un || 'un').toLowerCase()}`))), det);
      el.dataset.busca = (i.nome + ' ' + i.cod).toLowerCase();
      const pintarDet = () => {
        const x = sel.get(i.cod);
        if (!x) { det.hidden = true; det.replaceChildren(); return; }
        det.hidden = false;
        const qtd = h('input', { class: 'f-input dev-num', type: 'number', min: 0, max: i.qtd, step: 'any', value: x.qtd });
        qtd.addEventListener('input', () => { x.qtd = Number(qtd.value) || 0; });
        const obs = h('input', { class: 'f-input', placeholder: x.tipo === 'danificado' ? 'O que aconteceu? (ex.: caixa amassada, vencido)' : 'Observação (opcional)', value: x.obs, maxlength: 200 });
        obs.addEventListener('input', () => { x.obs = obs.value; });
        const tipo = TS.seg([['Danificado', 'danificado'], ['Não chegou', 'faltou']], x.tipo, (v) => { x.tipo = v; pintarDet(); pintarResumo(); });
        const arq = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
        const btFoto = h('button', { type: 'button', class: 'btn', disabled: x.fotos.length >= 3 || null }, `📷 Foto (${x.fotos.length}/3)`);
        btFoto.addEventListener('click', () => arq.click());
        arq.addEventListener('change', async () => {
          for (const f of [...arq.files].slice(0, 3 - x.fotos.length)) { try { x.fotos.push(await reduzir(f)); } catch (e) { alert(e.message); } }
          pintarDet();
        });
        const fotos = h('div', { class: 'dev-fotos' }, ...x.fotos.map((f, k) => h('div', { class: 'dev-foto' }, h('img', { src: f, alt: `Foto ${k + 1}` }),
          h('button', { type: 'button', class: 'dev-foto-x', title: 'Tirar a foto', onclick: () => { x.fotos.splice(k, 1); pintarDet(); } }, '✕'))));
        det.replaceChildren(h('div', { class: 'dev-linha' }, tipo, h('label', null, 'Qtd ', qtd)), obs,
          ...(x.tipo === 'danificado' ? [h('div', { class: 'dev-linha' }, btFoto, arq, h('small', { class: 'muted' }, 'até 3 fotos · pelo menos 1')), fotos] : []));
      };
      cb.addEventListener('change', () => { if (cb.checked) sel.set(i.cod, { tipo: 'danificado', qtd: i.qtd, obs: '', fotos: [] }); else sel.delete(i.cod); pintarDet(); pintarResumo(); });
      return el;
    });
    busca.addEventListener('input', () => { const q = busca.value.toLowerCase().trim(); linhas.forEach((el) => { el.hidden = !!q && !el.dataset.busca.includes(q); }); });
    lista.append(...linhas);
    pintarResumo();
    // destinatários
    const destInp = h('input', { class: 'f-input', value: dest.join(', '), placeholder: 'e-mails separados por vírgula' });
    const destMsg = h('small', { class: 'muted' });
    const salvarDest = h('button', { type: 'button', class: 'btn' }, 'Salvar destinatários');
    salvarDest.addEventListener('click', async () => {
      try { const r = await api('PUT', 'devolucoes/destinatarios', { loja, emails: destInp.value.split(/[,;\s]+/).filter(Boolean) }); dest = r.destinatarios; destInp.value = dest.join(', '); destMsg.textContent = `Salvo: ${dest.length} ${dest.length === 1 ? 'destinatário' : 'destinatários'}.`; } catch (e) { destMsg.textContent = e.message; }
    });
    const obsGeral = h('textarea', { class: 'f-input', rows: 2, maxlength: 400, placeholder: 'Observação geral (opcional)' });
    const msg = h('div', { class: 'muted' });
    const enviar = h('button', { type: 'button', class: 'btn primary' }, 'Enviar devolução');
    enviar.addEventListener('click', async () => {
      msg.className = 'neg';
      if (!sel.size) { msg.textContent = 'Marque pelo menos um item.'; return; }
      for (const [cod, x] of sel) {
        const it = n.itens.find((i) => i.cod === cod);
        if (!(x.qtd > 0 && x.qtd <= it.qtd)) { msg.textContent = `Quantidade de ${it.nome}: de 0 a ${it.qtd}.`; return; }
        if (x.tipo === 'danificado' && !x.fotos.length) { msg.textContent = `Anexe pelo menos 1 foto de ${it.nome}.`; return; }
      }
      if (!dest.length && !confirm('Não há destinatários salvos: a devolução fica registrada, mas o e-mail não vai. Continuar?')) return;
      if (dest.length && !confirm(`Enviar a devolução de ${sel.size} ${sel.size === 1 ? 'item' : 'itens'} da NF ${n.nf} por e-mail para:\n${dest.join('\n')}`)) return;
      enviar.disabled = true; msg.className = 'muted'; msg.textContent = 'Montando a planilha e enviando…';
      try {
        const r = await api('POST', 'devolucoes', { loja, notaId: n.id, nf: n.nf, obs: obsGeral.value, itens: [...sel].map(([cod, x]) => ({ cod, ...x })) });
        box.replaceChildren(h('div', { class: 'notice' }, h('b', null, 'Devolução registrada. '), EMAIL_TXT[r.devolucao.email.estado] || '', r.devolucao.email.erro ? ': ' + r.devolucao.email.erro.replace(/\.$/, '') : '', '. ',
          h('a', { href: TS.api(`devolucoes/${r.devolucao.id}/planilha?loja=${encodeURIComponent(loja)}`) }, 'Baixar a planilha'),
          h('div', { class: 'muted' }, 'A NF-e de devolução (rascunho no AppNext) é a próxima etapa do painel; por enquanto, emita no AppNext.')));
      } catch (e) { msg.className = 'neg'; msg.textContent = e.message; enviar.disabled = false; }
    });
    box.replaceChildren(h('div', { class: 'card dev-form' },
      h('div', { class: 'card-title' }, `Devolver itens da NF ${n.nf}`),
      h('div', { class: 'card-sub' }, 'Marque os itens, diga se chegou danificado ou não chegou e a quantidade. Danificado precisa de foto (até 3).'),
      busca, lista, resumo, obsGeral,
      h('div', { class: 'dev-dest' }, h('b', null, 'Destinatários do e-mail (desta loja)'), destInp, h('div', { class: 'dev-linha' }, salvarDest, destMsg)),
      h('div', { class: 'cfg-acoes' }, enviar, h('button', { type: 'button', class: 'btn', onclick: () => box.replaceWith(barra(n)) }, 'Cancelar'), msg)));
  }
  TS.devolucao = { barra };
})();
