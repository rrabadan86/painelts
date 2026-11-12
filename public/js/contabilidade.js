/* Fechamento do mês para a contabilidade: e-mail (mesmo visual do fechamento do dia) + PDF anexado */
(function () {
  const { h, fmt } = TS;
  const VERDE = '#2C5234', ESCURO = '#1F3D2B', OURO = '#C9A227', CREME = '#F7F4EC', LINHA = '#ECE7DB', CINZA = '#7A857D';
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brl = (v) => fmt.brl(v || 0).replace(/\s/, ' ');
  const juntar = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);
  const nomeMes = (ym) => `${TS.MESES_LONGOS[+ym.slice(5, 7) - 1]} de ${ym.slice(0, 4)}`;

  /** corpo do e-mail (HTML compatível com Gmail: tabelas e estilos inline) */
  TS.emailContabilidade = function ({ loja, ym, mensagem, dados }) {
    const { rg, gorj, linhas, totalDe, ferDe, temFeriado } = dados;
    const rateio = rg.rateio && rg.rateio.ativo;
    const td = `padding:9px 0;border-bottom:1px solid ${LINHA};font-size:13px;`;
    const num = 'text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;padding-left:14px;';
    const linha = (rot, val, o = {}) => `<tr>
      <td style="${td}color:${o.forte ? ESCURO : '#3D4A42'};${o.forte ? 'font-weight:700;' : ''}">${esc(rot)}</td>
      <td style="${td}${num}color:${ESCURO};${o.forte ? 'font-weight:700;' : ''}">${o.html ? val : esc(val)}</td></tr>`;
    const secao = (titulo, rows) => `
<tr><td style="padding:22px 18px 0">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    <tr><td colspan="2" style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${VERDE};padding-bottom:6px;border-bottom:2px solid ${OURO}">${esc(titulo)}</td></tr>
    ${rows.filter(Boolean).join('')}
  </table>
</td></tr>`;
    const feriadosDe = (vend) => {
      const fs = ferDe(vend);
      if (!fs.length) return 'nenhum';
      return juntar(fs.map((x) => `${x.data.slice(8, 10)}/${x.data.slice(5, 7)} (${TS.horasTxt(x.min)})`));
    };
    const tot = { com: 0, pre: 0, gor: 0, total: 0 };
    const blocos = linhas.map((r) => {
      const com = r.aPagar || 0, pre = rateio ? 0 : r.premiacao || 0, gor = gorj.get(r.vendedor) || 0;
      tot.com += com; tot.pre += pre; tot.gor += gor; tot.total += totalDe(r);
      return secao(r.vendedor, [
        linha('Comissão', brl(com)),
        rateio ? null : linha('Premiação', brl(pre)),
        linha('Gorjeta', brl(gor)),
        temFeriado ? linha('Feriados trabalhados', feriadosDe(r.vendedor)) : null,
        linha('Total a receber', brl(totalDe(r)), { forte: true }),
      ]);
    }).join('');
    const msg = String(mensagem || '').trim();
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;border-collapse:separate;background:#ffffff;border:1px solid ${LINHA};border-radius:16px;font-family:Arial,Helvetica,sans-serif;color:${ESCURO}">
<tr><td style="padding:22px 18px 4px">
  <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;color:${OURO};text-transform:uppercase">Fechamento do mês</div>
  <div style="font-size:22px;font-weight:700;color:${ESCURO};margin-top:4px">${esc(loja)}</div>
  <div style="font-size:14px;color:${CINZA};margin-top:2px">${esc(nomeMes(ym))} · comissões, premiações, gorjetas e feriados</div>
  <div style="font-size:11px;color:${CINZA};margin-top:8px">Gerado pelo <b style="color:${VERDE}">Painel Tea Shop</b> com as vendas do AppNext · desenvolvido por <b style="color:${VERDE}">Rodrigo Rabadan</b></div>
</td></tr>
${msg ? `<tr><td style="padding:14px 18px 0;font-size:14px;line-height:1.55;color:#3D4A42">${esc(msg).replace(/\n/g, '<br>')}</td></tr>` : ''}
<tr><td style="padding:14px 18px 0">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;background:${CREME};border-radius:12px">
    <tr>
      <td style="padding:12px 14px"><div style="font-size:11px;color:${CINZA};text-transform:uppercase;letter-spacing:.6px">Total a pagar</div>
        <div style="font-size:12px;color:${CINZA};margin-top:2px">${linhas.length} ${linhas.length === 1 ? 'funcionária' : 'funcionárias'}</div></td>
      <td style="padding:12px 14px;text-align:right;white-space:nowrap;font-size:20px;font-weight:700;color:${ESCURO}">${brl(tot.total)}</td>
    </tr>
  </table>
</td></tr>
${blocos}
${secao('Total da loja', [
    linha('Comissões', brl(tot.com)),
    rateio ? null : linha('Premiações', brl(tot.pre)),
    linha('Gorjetas', brl(tot.gor)),
    linha('Total a pagar', brl(tot.total), { forte: true }),
  ])}
<tr><td style="padding:20px 18px 22px;font-size:11px;line-height:1.5;color:${CINZA}">
  O PDF anexado traz o detalhe de cada funcionária (vendas e metas por categoria, horas em feriados) e a linha para assinatura.${rateio ? ' Nesta loja a comissão é rateada igualmente entre a equipe.' : ''}
</td></tr>
</table>`;
  };

  // ---------- PDF no navegador (as mesmas páginas do "Fechamento em PDF") ----------
  const carregado = {};
  const carregar = (src) => (carregado[src] ||= new Promise((ok, falha) => {
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => { delete carregado[src]; falha(new Error('Não consegui carregar o gerador de PDF.')); };
    document.head.append(s);
  }));
  TS.gerarPdfFechamento = async function (paginas) {
    await carregar('/vendor/html2canvas.js');
    await carregar('/vendor/jspdf.js');
    const box = h('div', { class: 'imp-render', 'aria-hidden': 'true' }, paginas);
    document.body.append(box);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
      const pags = [...box.querySelectorAll('.imp-pag')];
      for (let i = 0; i < pags.length; i++) {
        const cv = await window.html2canvas(pags[i], { scale: 2, backgroundColor: '#ffffff', logging: false, windowWidth: 794 });
        let w = 210, alt = (cv.height * 210) / cv.width;
        if (alt > 297) { w = (210 * 297) / alt; alt = 297; }
        if (i) doc.addPage();
        doc.addImage(cv.toDataURL('image/jpeg', 0.88), 'JPEG', (210 - w) / 2, 0, w, alt);
      }
      return doc.output('blob');
    } finally { box.remove(); }
  };
  const base64 = (blob) => new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = falha; r.readAsDataURL(blob); });
  const kb = (n) => (n > 1024 * 1024 ? `${fmt.n1(n / 1024 / 1024)} MB` : `${Math.round(n / 1024)} KB`);

  TS.podeContabilidade = () => !!(TS.eu && TS.eu.pode && TS.eu.pode.configurar); // admin e franqueado
  const slugDe = (x) => String(x || 'loja').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

  /** janela de envio para a contabilidade (comum aos dois envios)
   *  o: { titulo, cfg, ym, assunto, mensagem, nomeAnexo, anexo: Promise<{ texto, blob?, url? }>, previa(msg) → html, corpoEnvio(msg) → objeto, rota } */
  function janelaEnvio(o) {
    document.querySelector('.camada-cont')?.remove();
    const pode = !TS.demo && TS.podeContabilidade();
    const salvos = (o.cfg && o.cfg.contabilidade) || [];
    let urlAnexo = null;
    const fechar = () => { if (urlAnexo) URL.revokeObjectURL(urlAnexo); camada.remove(); document.body.classList.remove('com-camada'); document.removeEventListener('keydown', teclaEsc); };
    const teclaEsc = (e) => { if (e.key === 'Escape') fechar(); };
    const para = h('input', { class: 'f-input', type: 'text', inputmode: 'email', placeholder: 'ex.: contabilidade@escritorio.com.br', value: salvos.join(', '), autocomplete: 'email' });
    const assunto = h('input', { class: 'f-input', type: 'text', value: o.assunto });
    const mensagem = h('textarea', { class: 'f-input', rows: 3 }, o.mensagem);
    const previa = h('div', { class: 'cont-previa' });
    const pintar = () => { previa.innerHTML = o.previa(mensagem.value); };
    mensagem.addEventListener('input', pintar);

    const anexoTxt = h('span', null, 'Preparando o anexo…');
    const baixar = h('a', { class: 'btn', hidden: true, target: '_blank', rel: 'noopener', download: o.nomeAnexo }, 'Baixar');
    const anexo = h('div', { class: 'cont-anexo' }, h('span', { class: 'cont-clipe' }, '📎'), h('b', null, o.nomeAnexo), anexoTxt, baixar);
    let anexoOk = false;
    const pronto = o.anexo.then((a) => {
      anexoTxt.textContent = '· ' + a.texto; anexoOk = !a.vazio;
      if (a.blob) { urlAnexo = URL.createObjectURL(a.blob); baixar.href = urlAnexo; baixar.hidden = false; }
      if (a.vazio) anexoTxt.className = 'neg';
      pintar();
      return a;
    }).catch((e) => { anexoTxt.textContent = '· ' + e.message; anexoTxt.className = 'neg'; throw e; });
    pronto.catch(() => {});

    const status = h('div', { class: 'cont-status', role: 'status' });
    const enviar = h('button', { type: 'button', class: 'btn primary', disabled: !pode || null, title: pode ? '' : TS.demo ? 'Na apresentação o envio fica desligado' : 'Só admin e franqueado enviam' }, '✉ Enviar e-mail');
    enviar.addEventListener('click', async () => {
      const lista = para.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
      if (!lista.length) { status.className = 'cont-status neg'; status.textContent = 'Informe o e-mail da contabilidade.'; para.focus(); return; }
      enviar.disabled = true; status.className = 'cont-status'; status.textContent = 'Enviando…';
      try {
        const a = await pronto;
        if (!anexoOk) throw new Error('Sem anexo para enviar.');
        const r = await fetch(o.rota, { method: 'POST', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ loja: o.cfg.id, ym: o.ym, para: lista, assunto: assunto.value, html: o.previa(mensagem.value), ...(await o.corpoEnvio(a)) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha ao enviar.');
        o.cfg.contabilidade = j.para;
        status.className = 'cont-status pos'; status.textContent = `Enviado para ${j.para.join(', ')} ✓ Esses e-mails ficam salvos para o próximo mês.`;
        enviar.textContent = 'Enviado ✓';
      } catch (e) { status.className = 'cont-status neg'; status.textContent = e.message; enviar.disabled = false; }
    });

    const campo = (rot, el, dica) => h('label', { class: 'cont-campo' }, h('span', null, rot), el, dica ? h('small', { class: 'muted' }, dica) : null);
    const caixa = h('div', { class: 'card card-cheio fech-modal cont-modal' },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      h('div', { class: 'fech-modal-topo' }, h('b', null, o.titulo)),
      h('div', { class: 'cont-form' },
        campo('Para', para, salvos.length ? 'E-mails usados no último envio. Separe vários com vírgula.' : 'Separe vários com vírgula. Ficam salvos para o próximo mês.'),
        campo('Assunto', assunto),
        campo('Mensagem', mensagem, 'Aparece no começo do e-mail.'),
        anexo),
      h('div', { class: 'cont-previa-tit muted' }, 'Prévia do e-mail · sai do Gmail da loja (Configurações → Lojas → Fechamento do dia)'),
      previa,
      h('div', { class: 'cont-acoes' }, status, h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Cancelar'), enviar),
      TS.demo ? h('div', { class: 'notice' }, 'Na apresentação dá para ver a mensagem, mas o envio fica desligado.') : null);
    const camada = h('div', { class: 'camada-cheia camada-cont', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === camada) fechar(); } }, caixa);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', teclaEsc);
    pintar();
    if (!salvos.length) setTimeout(() => para.focus(), 50);
  }

  /** "Enviar fechamento do mês para a contabilidade" (comissões + PDF) */
  TS.abrirContabilidade = function ({ args, cfg, ym }) {
    const paginas = TS.paginasFechamento(args);
    const dados = paginas.dados;
    janelaEnvio({
      titulo: 'Enviar fechamento do mês para a contabilidade', cfg, ym, rota: '/api/contabilidade/enviar',
      assunto: `Fechamento de comissão · ${args.loja} · ${nomeMes(ym)}`,
      mensagem: `Olá! Segue o fechamento de comissão de ${nomeMes(ym).toLowerCase()} da ${args.loja}. O PDF com o detalhamento de cada funcionária está em anexo.`,
      nomeAnexo: `fechamento-${slugDe(args.loja)}-${ym}.pdf`,
      anexo: TS.gerarPdfFechamento(paginas).then((blob) => ({ blob, texto: `${kb(blob.size)} · ${paginas.length} ${paginas.length === 1 ? 'página' : 'páginas'}` })),
      previa: (msg) => TS.emailContabilidade({ loja: args.loja, ym, mensagem: msg, dados }),
      corpoEnvio: async (a) => ({ pdf: await base64(a.blob), nomePdf: `fechamento-${slugDe(args.loja)}-${ym}.pdf` }),
    });
  };

  // ---------- faturamento do mês (impostos): vendas + XMLs das notas ----------
  /** faturamento da loja no mês, direto das vendas (sem filtros de vendedor, grupo etc.) */
  TS.faturamentoMes = function (cfg, ym) {
    const db = TS.db, I = TS.rules.ids;
    const nomes = new Set((cfg.nomesVenda || []).map((n) => String(n)));
    let bruto = 0, taxa = 0, ult = null;
    for (let i = 0; i < db.n; i++) {
      if (db.ym[i] !== ym || !nomes.has(db.D.loja[db.loja[i]])) continue;
      if (I.taxaServico.has(db.desc[i])) taxa += db.vt[i] || 0; else bruto += db.vt[i] || 0;
      if (!ult || db.iso[i] > ult) ult = db.iso[i];
    }
    return { bruto, taxa, total: bruto + taxa, ult };
  };
  const dataBr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const ultimoDia = (ym) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)); return d.toISOString().slice(0, 10); };
  /** período de apuração: mês cheio; no mês corrente, até hoje */
  TS.periodoApuracao = function (ym) {
    const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
    const fim = ultimoDia(ym) > hoje ? hoje : ultimoDia(ym);
    return { de: ym + '-01', ate: fim, parcial: fim !== ultimoDia(ym), texto: `${dataBr(ym + '-01')} a ${dataBr(fim)}` };
  };

  TS.emailFaturamento = function ({ loja, ym, mensagem, fat, xml, periodo }) {
    const td = `padding:9px 0;border-bottom:1px solid ${LINHA};font-size:13px;`;
    const num = 'text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;padding-left:14px;';
    const linha = (rot, val, o = {}) => `<tr>
      <td style="${td}color:${o.forte ? ESCURO : '#3D4A42'};${o.forte ? 'font-weight:700;' : ''}">${esc(rot)}${o.sub ? `<div style="font-size:11px;color:${CINZA};font-weight:400">${esc(o.sub)}</div>` : ''}</td>
      <td style="${td}${num}color:${o.cor || ESCURO};${o.forte ? 'font-weight:700;' : ''}">${esc(val)}</td></tr>`;
    const secao = (titulo, rows) => `
<tr><td style="padding:22px 18px 0">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    <tr><td colspan="2" style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${VERDE};padding-bottom:6px;border-bottom:2px solid ${OURO}">${esc(titulo)}</td></tr>
    ${rows.filter(Boolean).join('')}
  </table>
</td></tr>`;
    const destaque = (rot, sub, val) => `<tr>
      <td style="padding:12px 14px;border-bottom:1px solid ${LINHA}"><div style="font-size:11px;color:${CINZA};text-transform:uppercase;letter-spacing:.6px">${esc(rot)}</div>${sub ? `<div style="font-size:12px;color:${CINZA};margin-top:2px">${esc(sub)}</div>` : ''}</td>
      <td style="padding:12px 14px;border-bottom:1px solid ${LINHA};text-align:right;white-space:nowrap;font-size:20px;font-weight:700;color:${ESCURO}">${esc(brl(val))}</td></tr>`;
    const msg = String(mensagem || '').trim();
    const x = xml || { ativos: { notas: 0, total: 0 }, cancelados: { notas: 0, total: 0, eventos: 0 } };
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;border-collapse:separate;background:#ffffff;border:1px solid ${LINHA};border-radius:16px;font-family:Arial,Helvetica,sans-serif;color:${ESCURO}">
<tr><td style="padding:22px 18px 4px">
  <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;color:${OURO};text-transform:uppercase">Faturamento do mês</div>
  <div style="font-size:22px;font-weight:700;color:${ESCURO};margin-top:4px">${esc(loja)}</div>
  <div style="font-size:14px;color:${CINZA};margin-top:2px">Período de apuração: ${esc(periodo.texto)}${periodo.parcial ? ' (mês em andamento)' : ''}</div>
  <div style="font-size:11px;color:${CINZA};margin-top:8px">Gerado pelo <b style="color:${VERDE}">Painel Tea Shop</b> com as vendas e as notas do AppNext · desenvolvido por <b style="color:${VERDE}">Rodrigo Rabadan</b></div>
</td></tr>
${msg ? `<tr><td style="padding:14px 18px 0;font-size:14px;line-height:1.55;color:#3D4A42">${esc(msg).replace(/\n/g, '<br>')}</td></tr>` : ''}
<tr><td style="padding:14px 18px 0">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;background:${CREME};border-radius:12px">
    ${destaque('Faturamento bruto', 'vendas da loja, sem a taxa de serviço', fat.bruto)}
    ${destaque('Taxa de serviço (10%)', 'gorjeta cobrada na nota', fat.taxa)}
    <tr>
      <td style="padding:12px 14px"><div style="font-size:11px;color:${CINZA};text-transform:uppercase;letter-spacing:.6px">Total faturado</div></td>
      <td style="padding:12px 14px;text-align:right;white-space:nowrap;font-size:20px;font-weight:700;color:${VERDE}">${esc(brl(fat.total))}</td>
    </tr>
  </table>
</td></tr>
${secao('Notas fiscais (XML anexado)', [
    linha('Ativas', `${fmt.int(x.ativos.notas)} ${x.ativos.notas === 1 ? 'nota' : 'notas'} · ${brl(x.ativos.total)}`, { forte: true }),
    linha('Canceladas', `${fmt.int(x.cancelados.notas)} ${x.cancelados.notas === 1 ? 'nota' : 'notas'} · ${brl(x.cancelados.total)}`, { cor: x.cancelados.notas ? '#B5452B' : ESCURO, sub: x.cancelados.eventos ? `${x.cancelados.eventos} ${x.cancelados.eventos === 1 ? 'evento' : 'eventos'} de cancelamento junto` : '' }),
    linha('Total de notas emitidas', `${fmt.int(x.ativos.notas + x.cancelados.notas)} · ${brl(x.ativos.total + x.cancelados.total)}`),
  ])}
<tr><td style="padding:20px 18px 22px;font-size:11px;line-height:1.5;color:${CINZA}">
  O arquivo .zip anexado tem duas pastas: <b>ativos</b> (notas válidas) e <b>cancelados</b> (notas canceladas e os eventos de cancelamento). Faturamento calculado com as vendas do AppNext; as notas ativas somam o valor das NFC-e válidas do período.
</td></tr>
</table>`;
  };

  /** "Enviar faturamento do mês para a contabilidade" (XMLs) */
  TS.abrirFaturamento = function ({ cfg, ym, loja }) {
    const fat = TS.faturamentoMes(cfg, ym);
    const periodo = TS.periodoApuracao(ym);
    let xml = null;
    const nomeZip = `xml-${slugDe(loja)}-${ym}.zip`;
    const anexo = TS.demo
      ? Promise.resolve({ vazio: true, texto: 'na apresentação não há XMLs' })
      : fetch(TS.api(`xmls/resumo?loja=${encodeURIComponent(cfg.id)}&ym=${ym}`), { credentials: 'same-origin' }).then((r) => r.json()).then((r) => {
        if (r.erro) throw new Error(r.erro);
        xml = r;
        const n = r.ativos.notas + r.cancelados.notas;
        if (!n) return { vazio: true, texto: 'ainda não há XMLs guardados deste mês: importe em Configurações → Coletor → Histórico ("Só XML")' };
        return { texto: `${fmt.int(r.ativos.notas)} ativas · ${fmt.int(r.cancelados.notas)} canceladas${r.atualizado ? ` · XMLs de ${new Date(r.atualizado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}` };
      });
    janelaEnvio({
      titulo: 'Enviar faturamento do mês para a contabilidade', cfg, ym, rota: '/api/faturamento/enviar',
      assunto: `Faturamento e XMLs · ${loja} · ${nomeMes(ym)}`,
      mensagem: `Olá! Segue o faturamento de ${nomeMes(ym).toLowerCase()} da ${loja} para a apuração dos impostos. Os XMLs das notas (ativas e canceladas) estão em anexo.`,
      nomeAnexo: nomeZip, anexo,
      previa: (msg) => TS.emailFaturamento({ loja, ym, mensagem: msg, fat, xml, periodo }),
      corpoEnvio: async () => ({ nomeZip }),
    });
  };
})();
