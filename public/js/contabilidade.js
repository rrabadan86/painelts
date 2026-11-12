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

  /** janela "Enviar fechamento do mês para a contabilidade" */
  TS.abrirContabilidade = function ({ args, cfg, ym }) {
    document.querySelector('.camada-cont')?.remove();
    const pode = !TS.demo && (TS.eu?.pode?.configurar || (TS.eu?.perfil === 'gerente' && (TS.eu.telas || []).includes('comissionamento')));
    const paginas = TS.paginasFechamento(args);
    const dados = paginas.dados;
    const slug = String(args.loja || 'loja').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    const nomePdf = `fechamento-${slug}-${ym}.pdf`;
    const salvos = (cfg && cfg.contabilidade) || [];

    const fechar = () => { if (urlPdf) URL.revokeObjectURL(urlPdf); camada.remove(); document.body.classList.remove('com-camada'); document.removeEventListener('keydown', teclaEsc); };
    const teclaEsc = (e) => { if (e.key === 'Escape') fechar(); };
    const para = h('input', { class: 'f-input', type: 'text', inputmode: 'email', placeholder: 'ex.: contabilidade@escritorio.com.br', value: salvos.join(', '), autocomplete: 'email' });
    const assunto = h('input', { class: 'f-input', type: 'text', value: `Fechamento de comissão · ${args.loja} · ${nomeMes(ym)}` });
    const mensagem = h('textarea', { class: 'f-input', rows: 3 },
      `Olá! Segue o fechamento de comissão de ${nomeMes(ym).toLowerCase()} da ${args.loja}. O PDF com o detalhamento de cada funcionária está em anexo.`);
    const previa = h('div', { class: 'cont-previa' });
    const pintar = () => { previa.innerHTML = TS.emailContabilidade({ loja: args.loja, ym, mensagem: mensagem.value, dados }); };
    mensagem.addEventListener('input', pintar);

    let blob = null, urlPdf = null;
    const anexoTxt = h('span', null, 'Gerando o PDF…');
    const verPdf = h('a', { class: 'btn', hidden: true, target: '_blank', rel: 'noopener', download: nomePdf }, 'Baixar PDF');
    const anexo = h('div', { class: 'cont-anexo' }, h('span', { class: 'cont-clipe' }, '📎'), h('b', null, nomePdf), anexoTxt, verPdf);
    const pronto = TS.gerarPdfFechamento(paginas).then((b) => {
      blob = b; urlPdf = URL.createObjectURL(b);
      anexoTxt.textContent = `· ${kb(b.size)} · ${paginas.length} ${paginas.length === 1 ? 'página' : 'páginas'}`;
      verPdf.href = urlPdf; verPdf.hidden = false;
      return b;
    }).catch((e) => { anexoTxt.textContent = '· ' + e.message; anexoTxt.className = 'neg'; throw e; });
    pronto.catch(() => {});

    const status = h('div', { class: 'cont-status', role: 'status' });
    const enviar = h('button', { type: 'button', class: 'btn primary', disabled: !pode || null, title: pode ? '' : TS.demo ? 'Na apresentação o envio fica desligado' : 'Sem permissão para enviar' }, '✉ Enviar e-mail');
    enviar.addEventListener('click', async () => {
      const lista = para.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
      if (!lista.length) { status.className = 'cont-status neg'; status.textContent = 'Informe o e-mail da contabilidade.'; para.focus(); return; }
      enviar.disabled = true; status.className = 'cont-status'; status.textContent = 'Enviando…';
      try {
        const b = await pronto;
        const r = await fetch('/api/contabilidade/enviar', { method: 'POST', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ loja: cfg.id, ym, para: lista, assunto: assunto.value, html: TS.emailContabilidade({ loja: args.loja, ym, mensagem: mensagem.value, dados }), pdf: await base64(b), nomePdf }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || 'Falha ao enviar.');
        cfg.contabilidade = j.para;
        status.className = 'cont-status pos'; status.textContent = `Enviado para ${j.para.join(', ')} ✓ Esses e-mails ficam salvos para o próximo mês.`;
        enviar.textContent = 'Enviado ✓';
      } catch (e) { status.className = 'cont-status neg'; status.textContent = e.message; enviar.disabled = false; }
    });

    const campo = (rot, el, dica) => h('label', { class: 'cont-campo' }, h('span', null, rot), el, dica ? h('small', { class: 'muted' }, dica) : null);
    const caixa = h('div', { class: 'card card-cheio fech-modal cont-modal' },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      h('div', { class: 'fech-modal-topo' }, h('b', null, 'Enviar fechamento do mês para a contabilidade')),
      h('div', { class: 'cont-form' },
        campo('Para', para, salvos.length ? 'E-mails usados no último envio. Separe vários com vírgula.' : 'Separe vários com vírgula. Ficam salvos para o próximo mês.'),
        campo('Assunto', assunto),
        campo('Mensagem', mensagem, 'Aparece no começo do e-mail.'),
        anexo),
      h('div', { class: 'cont-previa-tit muted' }, 'Prévia do e-mail · sai do Gmail da loja (Configurações → Lojas → Fechamento do dia)'),
      previa,
      h('div', { class: 'cont-acoes' }, status, h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Cancelar'), enviar),
      TS.demo ? h('div', { class: 'notice' }, 'Na apresentação dá para ver a mensagem e baixar o PDF, mas o envio fica desligado.') : null);
    const camada = h('div', { class: 'camada-cheia camada-cont', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === camada) fechar(); } }, caixa);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', teclaEsc);
    pintar();
    if (!salvos.length) setTimeout(() => para.focus(), 50);
  };
})();
