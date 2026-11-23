/* Erros de tela da loja: quando um erro de JavaScript acontece no painel de alguém, avisa o servidor
   (POST /api/erros-tela; na apresentação vai para a rota de mentira e nada é gravado). Assim o admin fica sabendo
   em Configurações → Erros nas telas, sem depender de print.
   Sem dado pessoal: só a mensagem do erro, curta e sem números longos, e-mails nem texto entre aspas (o servidor
   saneia de novo), a tela, arquivo:linha, a loja e o tipo. Nunca o que a pessoa digitou. No máximo 5 avisos por
   página aberta e 1 por erro. Não toca na página ao carregar. */
'use strict';
(function () {
  if (typeof window === 'undefined' || !window.addEventListener) return;
  const MAX = 5;
  let enviados = 0;
  const ja = new Set();
  const limpar = (t) => String(t == null ? '' : t)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail]')
    .replace(/(["'`“”])([^"'`“”]{25,})\1/g, '$1…$1')
    .replace(/\d[\d.\-/() ]{6,}\d/g, '[número]')
    .slice(0, 300);
  // só erro do próprio painel: extensão do navegador e scripts de fora ficam de fora
  const doPainel = (arq) => !arq || /^https?:\/\/[^/]+\/(app\.js|js\/|login\.js|trocar-senha\.js)/.test(String(arq)) && String(arq).startsWith(location.origin);
  function avisar(tipo, msg, arq, ln, col) {
    try {
      msg = limpar(msg);
      if (!msg || enviados >= MAX || !doPainel(arq)) return;
      const chave = msg + '|' + ln;
      if (ja.has(chave)) return;
      ja.add(chave); enviados++;
      const TS = window.TS || {};
      const url = TS.api ? TS.api('erros-tela') : '/api/erros-tela';
      const corpo = { tipo, msg, arq: arq ? String(arq).replace(location.origin, '') : '', ln: ln || null, col: col || null,
        tela: String(location.hash || '').slice(1, 31), loja: TS.state && TS.state.loja && TS.state.loja !== 'todas' ? TS.state.loja : null };
      fetch(url, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify(corpo) }).catch(() => {});
    } catch { /* o aviso nunca atrapalha a tela */ }
  }
  window.addEventListener('error', (e) => {
    if (!e || e.target !== window && e.target && e.target.tagName) return; // imagem ou arquivo que não carregou: não é erro de código
    avisar('erro', e.message || (e.error && e.error.message), e.filename, e.lineno, e.colno);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    const msg = r && (r.message || (typeof r === 'string' ? r : '')) || '';
    if (!msg || /Failed to fetch|NetworkError|Load failed|AbortError|The user aborted/i.test(msg)) return; // queda de rede não é erro de código
    const m = String((r && r.stack) || '').match(/(https?:\/\/[^\s)]+?):(\d+):(\d+)/);
    avisar('promessa', msg, m ? m[1] : '', m ? +m[2] : null, m ? +m[3] : null);
  });
  if (window.TS) window.TS.avisarErroTela = avisar; // testes
})();
