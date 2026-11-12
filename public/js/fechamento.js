/* Fechamento do dia: substitui a planilha preenchida à mão no fim do expediente.
   As contas são feitas no servidor (src/fechamento.js) — as mesmas do e-mail automático. */
'use strict';
(function () {
  const { h, state } = TS;
  const cache = new Map(); // loja|dia → resposta

  TS.cartaoFechamento = function () {
    if (TS.eu && TS.eu.perfil === 'vendedor') return null;
    const loja = state.loja;
    const card = h('div', { class: 'card fech-card' });
    if (!loja || loja === 'todas') {
      card.append(h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'card-title' }, 'Fechamento do dia'), h('div', { class: 'card-sub' }, 'Escolha uma loja no topo para ver o fechamento.'))));
      return card;
    }
    const corpo = h('div', { class: 'fech-corpo' }, h('p', { class: 'muted' }, 'Carregando…'));
    const dataIn = h('input', { type: 'date', class: 'f-input fech-data', value: state.fechDia || '', 'aria-label': 'Dia do fechamento' });
    const imprimir = h('button', { type: 'button', class: 'btn', onclick: () => imprimirFech() }, 'Imprimir / PDF');
    card.append(h('div', { class: 'card-head' },
      h('div', null, h('div', { class: 'card-title' }, 'Fechamento do dia'),
        h('div', { class: 'card-sub' }, 'Automático, com as vendas do AppNext: as mesmas contas da planilha de fechamento.')),
      h('div', { class: 'fech-tools' }, dataIn, imprimir)), corpo);
    let atual = null;
    const carregar = async () => {
      const dia = dataIn.value;
      const chave = loja + '|' + dia;
      try {
        let j = cache.get(chave);
        if (!j) {
          const r = await fetch(TS.api(`fechamento?loja=${encodeURIComponent(loja)}${dia ? '&dia=' + dia : ''}`), { credentials: 'same-origin' });
          j = await r.json();
          if (!r.ok) throw new Error(j.erro || 'Falha ao montar o fechamento.');
          cache.set(chave, j);
          if (!dia && j.dia) cache.set(loja + '|' + j.dia, j);
        }
        if (j.vazio) { corpo.replaceChildren(h('p', { class: 'muted' }, 'Ainda sem vendas.')); return; }
        if (!dia && j.dia) dataIn.value = j.dia;
        atual = j;
        const caixa = h('div', { class: 'fech-tabela' });
        caixa.innerHTML = j.html; // montado e escapado no servidor (o mesmo HTML do e-mail)
        corpo.replaceChildren(...[
          !j.temVendas ? h('div', { class: 'notice' }, 'Nenhuma venda registrada neste dia (a coleta da noite já rodou?).') : null,
          caixa,
          h('p', { class: 'muted fech-nota' }, 'Vendas realizadas = caixa da loja, sem Espaço Gourmet e sem corporativo/omnichannel. Histórico = mesma data do ano anterior. "Clientes que entraram na loja" depende de contador de pessoas, que o sistema não tem.')].filter(Boolean));
      } catch (e) { corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
    };
    dataIn.addEventListener('change', () => { state.fechDia = dataIn.value; carregar(); });
    function imprimirFech() {
      if (!atual) return;
      let imp = document.getElementById('impressao');
      if (!imp) { imp = h('div', { id: 'impressao' }); document.body.append(imp); }
      const sec = h('section', { class: 'imp-pag imp-fech' });
      sec.innerHTML = atual.html;
      imp.replaceChildren(sec);
      document.body.classList.add('imprimindo');
      setTimeout(() => { window.print(); document.body.classList.remove('imprimindo'); }, 50);
    }
    carregar();
    return card;
  };
})();
