/* Botão "rodar o script da loja" (GitHub Actions) */
'use strict';
(function () {
  const { h, state } = TS;
  const btn = document.getElementById('btnScript');
  const pop = document.getElementById('scriptPop');
  const dot = btn.querySelector('.dot');
  let info = null;          // última resposta de /api/script
  let timer = null;
  let acompanhando = false; // disparado por aqui: recarregar ao terminar
  let ultimoEstado = null;

  const hora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const ativo = () => info && (info.aguardando || (info.execucao && (info.execucao.estado === 'rodando' || info.execucao.estado === 'na_fila')));

  function toast(msg) {
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 5000);
  }

  // o que o "Rodar agora" busca (vem tudo marcado; a escolha vale até recarregar a página)
  const ITENS = [
    { id: 'vendas', nome: 'Vendas', dica: 'de ontem e de hoje' },
    { id: 'xml', nome: 'XML das notas', dica: 'de ontem e de hoje (CPF dos clientes, notas ativas)' },
    { id: 'estoque', nome: 'Estoque e custos', dica: 'de agora, com os itens zerados' },
    { id: 'fixe', nome: 'FIXE (clientes e pontos)', dica: 'chega por e-mail alguns minutos depois' },
  ];
  const desmarcados = new Set();

  function pintar() {
    btn.classList.toggle('rodando', !!ativo());
    dot.hidden = !ativo();
    if (pop.hidden) return;
    pop.replaceChildren();
    pop.append(h('h3', null, 'Atualizar dados do sistema'),
      h('p', null, 'Escolha o que buscar agora desta loja. Leva poucos minutos; o painel recarrega sozinho quando terminar.'));
    if (!info) { pop.append(h('p', null, 'Carregando…')); return; }
    if (!info.disponivel) { pop.append(h('div', { class: 'script-status' }, h('span', null, info.motivo))); return; }
    if (info.erro) pop.append(h('div', { class: 'script-status' }, h('span', { class: 'ic falhou' }, '!'), h('span', null, 'Não consegui consultar o GitHub.', h('small', null, info.erro))));
    const e = info.execucao;
    let ic = null, txt = null, sub = null;
    if (info.aguardando) { ic = 'aguardando'; txt = 'Acionado, aguardando o GitHub iniciar…'; sub = info.disparo ? `por ${info.disparo.por} às ${hora(info.disparo.em)}` : ''; }
    else if (e && e.estado === 'na_fila') { ic = 'na_fila'; txt = info.origem === 'vps' ? 'Na fila (uma loja por vez)' : 'Na fila do GitHub'; sub = `desde ${hora(e.criado)}`; }
    else if (e && e.estado === 'rodando') { ic = 'rodando'; txt = 'Rodando…'; sub = `começou ${hora(e.inicio)}${e.por ? ' · por ' + e.por : ''} · costuma levar de 3 a 7 min`; }
    else if (e && e.estado === 'ok') { ic = 'ok'; txt = 'Última atualização concluída'; sub = `${hora(e.fim)} · ${e.gatilho === 'agendado' ? 'automática' : 'manual' + (e.por ? ' (' + e.por + ')' : '')}${e.duracao ? ' · ' + (e.duracao < 90 ? e.duracao + ' s' : Math.round(e.duracao / 60) + ' min') : ''}`; }
    else if (e && e.estado === 'falhou') { ic = 'falhou'; txt = 'A última execução falhou'; sub = `${hora(e.fim)} · ${e.conclusao === 'cancelled' ? 'cancelada' : 'veja o log abaixo ou avise o administrador'}`; }
    if (ic) pop.append(h('div', { class: 'script-status' }, h('span', { class: 'ic ' + ic }, ic === 'ok' ? '✓' : ic === 'falhou' ? '!' : '…'), h('span', null, txt, sub ? h('small', null, sub) : null)));
    if (TS.eu && TS.eu.perfil === 'admin') { // só o admin roda a coleta
      let escolhidos = null;
      if (info.origem === 'vps') {
        const opcoes = ITENS.filter((it) => it.id !== 'fixe' || info.temFixe);
        pop.append(h('div', { class: 'script-escolha' }, opcoes.map((it) => {
          const cb = h('input', { type: 'checkbox', checked: !desmarcados.has(it.id) || null, disabled: ativo() || null });
          cb.addEventListener('change', () => { if (cb.checked) desmarcados.delete(it.id); else desmarcados.add(it.id); pintar(); });
          return h('label', { class: 'script-op' }, cb, h('span', null, h('b', null, it.nome), h('small', null, it.dica)));
        })));
        escolhidos = opcoes.map((it) => it.id).filter((id) => !desmarcados.has(id));
      }
      const nenhum = escolhidos && !escolhidos.length;
      const rodar = h('button', { class: 'btn primary', type: 'button', disabled: ativo() || nenhum || null }, ativo() ? 'Atualização em andamento' : nenhum ? 'Marque o que buscar' : 'Rodar agora');
      rodar.addEventListener('click', disparar);
      pop.append(rodar);
    }
    if (e && e.url && e.estado === 'falhou') pop.append(h('div', { class: 'aviso' }, 'Detalhes no GitHub: ', h('a', { href: e.url, target: '_blank', rel: 'noopener' }, 'abrir execução')));
    if (e && e.log && e.log.length) pop.append(h('details', { class: 'aviso' }, h('summary', null, 'Ver o final do log'), h('pre', { class: 'script-log' }, e.log.join('\n'))));
    const hs = info.horarios && info.horarios.length ? info.horarios.join(' e ') : null;
    const ult = info.horarios && info.horarios.length ? [...info.horarios].sort().pop() : null;
    const dias = info.janela || 7;
    pop.append(h('div', { class: 'aviso' }, hs ? `Também roda sozinho às ${hs}: vendas e XML dos últimos ${dias} dias e o estoque.` : 'O script também roda sozinho duas vezes por dia.',
      ult ? h('div', null, `Às ${ult} pede também ao FIXE o cadastro de clientes e os pontos (Logs), que chegam por e-mail.`) : null));
  }

  async function consultar() {
    if (!state.loja || state.loja === 'todas') { info = { disponivel: false, motivo: 'Escolha uma loja no seletor para rodar o script dela.' }; pintar(); return; }
    try {
      const r = await fetch('/api/script?loja=' + encodeURIComponent(state.loja), { credentials: 'same-origin' });
      if (r.status === 401) { location.href = '/login'; return; }
      info = await r.json();
    } catch (e) {
      info = { disponivel: true, erro: e.message };
    }
    btn.hidden = !info.disponivel; // só aparece para lojas com script ligado
    if (btn.hidden) pop.hidden = true;
    const estado = info.execucao && info.execucao.estado;
    // terminou uma execução acompanhada → recarrega os dados
    if (acompanhando && !info.aguardando && (estado === 'ok' || estado === 'falhou') && ultimoEstado !== estado) {
      acompanhando = false;
      if (estado === 'ok') { toast('Script concluído. Carregando os dados novos…'); TS.recarregar && TS.recarregar(true); }
      else toast('O script falhou. Os dados continuam os anteriores.');
    }
    ultimoEstado = info.aguardando ? 'aguardando' : estado;
    pintar();
    agendar();
  }

  function agendar() {
    clearTimeout(timer);
    // rápido enquanto roda; devagar quando parado (só se o painel estiver aberto)
    const ms = ativo() ? 10e3 : 120e3;
    timer = setTimeout(() => { if (document.visibilityState === 'visible' || ativo()) consultar(); else agendar(); }, ms);
  }

  async function disparar() {
    const b = pop.querySelector('.btn.primary');
    if (b) { b.disabled = true; b.textContent = 'Acionando…'; }
    try {
      const opcoes = ITENS.filter((it) => it.id !== 'fixe' || (info && info.temFixe)).map((it) => it.id);
      const itens = info && info.origem === 'vps' ? opcoes.filter((id) => !desmarcados.has(id)) : null;
      const r = await fetch('/api/script?loja=' + encodeURIComponent(state.loja), { method: 'POST', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(itens ? { itens } : {}) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { acompanhando = true; toast('Script acionado. Você pode continuar usando o painel.'); }
      else if (r.status === 409) { acompanhando = true; toast(j.erro || 'O script já está rodando.'); }
      else toast(j.erro || 'Não foi possível acionar o script.');
    } catch (e) {
      toast('Falha de conexão: ' + e.message);
    }
    consultar();
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    if (!pop.hidden) { pintar(); consultar(); }
  });
  document.addEventListener('click', (e) => { if (!pop.hidden && !e.target.closest('.script-wrap')) pop.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });

  /** chamado pelo main.js quando a loja muda */
  TS.scriptLoja = function () {
    if (TS.demo) return;
    acompanhando = false; ultimoEstado = null; info = null;
    pop.hidden = true;
    consultar();
  };
})();
