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
  const NFE_TXT = { na_fila: 'NF-e: o robô está gravando no AppNext…', ok: 'NF-e de devolução gravada no AppNext (não concluída): confira, conclua e transmita lá', teste: 'NF-e: teste ok, tudo conferiu (nada foi salvo)', erro: 'NF-e de devolução não foi gravada', pendente: 'NF-e: ainda não pedida' };
  const EMAIL_TXT = { aguardando_nf: 'e-mail aguardando a NF-e de devolução ser autorizada (vai com o PDF e o XML)', enviado: 'e-mail enviado', erro: 'e-mail não foi enviado', sem_destinatarios: 'sem destinatários: e-mail não enviado', pendente: 'enviando e-mail…' };

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
    const e = d.email || {}, nf = d.nfe || { estado: 'pendente' };
    const reenviar = h('button', { type: 'button', class: 'link-btn', title: e.estado === 'aguardando_nf' ? 'Manda já, só com a planilha e as fotos (sem a NF-e)' : 'Manda de novo (com a NF-e, se ela já estiver autorizada)' }, e.estado === 'aguardando_nf' ? 'enviar agora sem a nota' : 'reenviar e-mail');
    const pedirNfe = (simular) => async () => {
      if (!simular && !confirm('Gravar a NF-e de devolução no AppNext (sem concluir)? A loja confere, conclui e transmite lá.')) return;
      try { const r = await api('POST', `devolucoes/${d.id}/nfe`, { loja, simular }); el.replaceWith(itemFeito(r.devolucao, loja)); } catch (er) { alert(er.message); }
    };
    const podePedir = nf.estado === 'erro' || nf.estado === 'teste' || nf.estado === 'pendente';
    const el = h('div', { class: 'dev-feita' },
      h('div', null, h('b', null, `Devolução de ${quando(d.em)}`), h('small', { class: 'muted' }, ` por ${d.por} · ${d.itens.length} ${d.itens.length === 1 ? 'item' : 'itens'} · `),
        h('a', { href: TS.api(`devolucoes/${d.id}/planilha?loja=${encodeURIComponent(loja)}`) }, 'planilha')),
      h('div', null, h('span', { class: 'dev-st ' + (e.estado === 'enviado' ? 'ok' : e.estado === 'aguardando_nf' ? 'fila' : 'erro') }, (e.estado === 'enviado' && e.comNota ? 'e-mail enviado com a NF-e' : EMAIL_TXT[e.estado] || e.estado)), e.erro ? h('small', { class: 'neg' }, ' ' + e.erro) : null, ' ', reenviar),
      h('div', null, h('span', { class: 'dev-st ' + (nf.estado === 'ok' || nf.estado === 'teste' ? 'ok' : nf.estado === 'erro' ? 'erro' : 'fila') }, (nf.estado === 'na_fila' ? '⏳ ' : '') + (NFE_TXT[nf.estado] || nf.estado)),
        nf.numero ? h('small', null, ` · NF-e nº ${nf.numero} autorizada`) : null, nf.cfop ? h('small', { class: 'muted' }, ` · CFOP ${nf.cfop}`) : null, nf.erro ? h('small', { class: 'neg' }, ' ' + nf.erro) : null,
        podePedir ? h('span', null, ' ', h('button', { type: 'button', class: 'link-btn', onclick: pedirNfe(false) }, nf.estado === 'erro' ? 'tentar de novo' : 'gravar no AppNext'), ' · ', h('button', { type: 'button', class: 'link-btn', onclick: pedirNfe(true) }, 'testar sem salvar')) : null),
      nf.estado === 'na_fila' && nf.robo && nf.robo.aoVivo ? h('pre', { class: 'inv-log' }, nf.robo.aoVivo.slice(-8).join('\n')) : null);
    reenviar.addEventListener('click', async () => { if (e.estado === 'aguardando_nf' && !confirm('Mandar o e-mail agora, SEM a NF-e de devolução (só a planilha e as fotos)?')) return; reenviar.disabled = true; try { const r = await api('POST', `devolucoes/${d.id}/reenviar`, { loja }); el.replaceWith(itemFeito(r.devolucao, loja)); } catch (er) { alert(er.message); reenviar.disabled = false; } });
    if (nf.estado === 'na_fila') setTimeout(async () => {
      if (!el.isConnected) return;
      try { const j = await api('GET', `devolucoes?loja=${encodeURIComponent(loja)}`); const n = j.devolucoes.find((x) => x.id === d.id); if (n && el.isConnected) el.replaceWith(itemFeito(n, loja)); } catch { /* tenta de novo */ }
    }, 4000);
    return el;
  }

  async function formulario(n, box, loja) {
    let dest = [];
    try { dest = (await api('GET', `devolucoes?loja=${encodeURIComponent(loja)}`)).destinatarios; } catch { /* segue */ }
    const sel = new Map(); // cod → { tipo, qtd, obs, fotos: [dataUrl] }
    const lista = h('div', { class: 'dev-itens' });
    const resumo = h('div', { class: 'muted' });
    const pintarResumo = () => { const v = [...sel.values()]; const d = v.filter((x) => x.dan > 0).length, f = v.filter((x) => x.fal > 0).length; resumo.textContent = sel.size ? `${sel.size} ${sel.size === 1 ? 'produto escolhido' : 'produtos escolhidos'} · ${d} com danificados · ${f} com faltas` : 'Marque os itens a devolver.'; };
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
        // o mesmo produto pode ter parte danificada e parte que não chegou (ex.: pediu 6: 2 quebrados e 4 faltaram)
        const num = (k) => { const el = h('input', { class: 'f-input dev-num', type: 'number', min: 0, max: i.qtd, step: 'any', value: x[k] || '', placeholder: '0' }); el.addEventListener('input', () => { x[k] = Number(el.value) || 0; danBox.hidden = !(x.dan > 0); pintarResumo(); }); return el; };
        const obs = h('input', { class: 'f-input', placeholder: 'O que aconteceu com os danificados? (ex.: caixa amassada, vencido)', value: x.obs, maxlength: 200 });
        obs.addEventListener('input', () => { x.obs = obs.value; });
        const arq = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
        const btFoto = h('button', { type: 'button', class: 'btn', disabled: x.fotos.length >= 3 || null }, `📷 Foto (${x.fotos.length}/3)`);
        btFoto.addEventListener('click', () => arq.click());
        arq.addEventListener('change', async () => {
          for (const f of [...arq.files].slice(0, 3 - x.fotos.length)) { try { x.fotos.push(await reduzir(f)); } catch (e) { alert(e.message); } }
          pintarDet();
        });
        const fotos = h('div', { class: 'dev-fotos' }, ...x.fotos.map((f, k) => h('div', { class: 'dev-foto' }, h('img', { src: f, alt: `Foto ${k + 1}` }),
          h('button', { type: 'button', class: 'dev-foto-x', title: 'Tirar a foto', onclick: () => { x.fotos.splice(k, 1); pintarDet(); } }, '✕'))));
        const danBox = h('div', { class: 'dev-det', style: { margin: 0 }, hidden: !(x.dan > 0) }, obs, h('div', { class: 'dev-linha' }, btFoto, arq, h('small', { class: 'muted' }, 'fotos dos danificados: até 3 · pelo menos 1')), fotos);
        det.replaceChildren(h('div', { class: 'dev-linha' }, h('label', null, 'Danificados ', num('dan')), h('label', null, 'Não chegaram ', num('fal')), h('small', { class: 'muted' }, `de ${fmt.n2(i.qtd).replace(/,00$/, '')} na nota`)), danBox);
      };
      cb.addEventListener('change', () => { if (cb.checked) sel.set(i.cod, { dan: 0, fal: 0, obs: '', fotos: [] }); else sel.delete(i.cod); pintarDet(); pintarResumo(); });
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
        if (!(x.dan + x.fal > 0)) { msg.textContent = `Informe quantos de ${it.nome} vieram danificados e/ou não chegaram.`; return; }
        if (x.dan + x.fal > it.qtd) { msg.textContent = `${it.nome}: ${x.dan + x.fal} passa da quantidade da nota (${it.qtd}).`; return; }
        if (x.dan > 0 && !x.fotos.length) { msg.textContent = `Anexe pelo menos 1 foto dos danificados de ${it.nome}.`; return; }
      }
      if (!dest.length && !confirm('Não há destinatários salvos: a devolução fica registrada, mas o e-mail não vai. Continuar?')) return;
      if (dest.length && !confirm(`Enviar a devolução de ${sel.size} ${sel.size === 1 ? 'item' : 'itens'} da NF ${n.nf} por e-mail para:\n${dest.join('\n')}`)) return;
      enviar.disabled = true; msg.className = 'muted'; msg.textContent = 'Montando a planilha e enviando…';
      try {
        const r = await api('POST', 'devolucoes', { loja, notaId: n.id, nf: n.nf, obs: obsGeral.value, itens: [...sel].map(([cod, x]) => ({ cod, qtdDanificado: x.dan, qtdFaltou: x.fal, obs: x.obs, fotos: x.dan > 0 ? x.fotos : [] })) });
        box.replaceChildren(h('div', { class: 'notice' }, h('b', null, 'Devolução registrada.')), h('div', { class: 'dev-feitas' }, itemFeito(r.devolucao, loja)));
      } catch (e) { msg.className = 'neg'; msg.textContent = e.message; enviar.disabled = false; }
    });
    box.replaceChildren(h('div', { class: 'card dev-form' },
      h('div', { class: 'card-title' }, `Devolver itens da NF ${n.nf}`),
      h('div', { class: 'card-sub' }, 'Marque os itens e diga quantos vieram danificados e quantos não chegaram (pode ser os dois no mesmo item). Danificados precisam de foto (até 3).'),
      busca, lista, resumo, obsGeral,
      h('div', { class: 'dev-dest' }, h('b', null, 'Destinatários do e-mail (desta loja)'), destInp, h('div', { class: 'dev-linha' }, salvarDest, destMsg)),
      h('div', { class: 'cfg-acoes' }, enviar, h('button', { type: 'button', class: 'btn', onclick: () => box.replaceWith(barra(n)) }, 'Cancelar'), msg)));
  }
  TS.devolucao = { barra };
})();
