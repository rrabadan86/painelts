/* Feriados do mês: horas trabalhadas por pessoa em cada feriado (vão para o PDF do fechamento) */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  const DIAS_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  /** domingo de Páscoa (algoritmo de Meeus/Jones/Butcher) */
  function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
    const mes = Math.floor((hh + l - 7 * m + 114) / 31), dia = ((hh + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(ano, mes - 1, dia);
  }
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const DIA = 86400000;

  /** feriados nacionais (e pontos facultativos usuais do comércio) de um ano */
  TS.feriadosNacionais = function (ano) {
    const p = pascoa(ano);
    const fixos = [['01-01', 'Confraternização Universal'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'], ['09-07', 'Independência do Brasil'],
      ['10-12', 'Nossa Senhora Aparecida'], ['11-02', 'Finados'], ['11-15', 'Proclamação da República'], ['11-20', 'Consciência Negra'], ['12-25', 'Natal']];
    return [
      ...fixos.map(([md, nome]) => ({ data: `${ano}-${md}`, nome, tipo: 'nacional' })),
      { data: iso(p - 48 * DIA), nome: 'Carnaval (segunda)', tipo: 'facultativo' },
      { data: iso(p - 47 * DIA), nome: 'Carnaval (terça)', tipo: 'facultativo' },
      { data: iso(p - 2 * DIA), nome: 'Sexta-feira Santa', tipo: 'nacional' },
      { data: iso(p + 60 * DIA), nome: 'Corpus Christi', tipo: 'facultativo' },
    ].sort((x, y) => (x.data < y.data ? -1 : 1));
  };

  /** feriados de um mês para a loja: nacionais + locais (anuais repetem todo ano) */
  TS.feriadosDoMes = function (cfg, ym) {
    const ano = +ym.slice(0, 4);
    const nac = TS.feriadosNacionais(ano).filter((f) => f.data.startsWith(ym));
    const loc = ((cfg && cfg.feriadosLocais) || []).map((f) => ({ data: f.anual !== false ? `${ano}${f.data.slice(4)}` : f.data, nome: f.nome, tipo: 'local', orig: f }))
      .filter((f) => f.data.startsWith(ym));
    const vistos = new Set();
    return [...nac, ...loc].filter((f) => (vistos.has(f.data) ? false : vistos.add(f.data))).sort((a, b) => (a.data < b.data ? -1 : 1));
  };

  const horasTxt = (m) => (m ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : '—');
  const campoTxt = (m) => (m ? `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` : '');
  /** aceita 07:20, 7:20, 7h20, 7h, 7, 7,5 */
  function lerHoras(v) {
    const s = String(v || '').trim().toLowerCase().replace(',', '.');
    if (!s) return 0;
    let m = s.match(/^(\d{1,2})\s*[:h]\s*(\d{1,2})?$/);
    if (m) return +m[1] * 60 + +(m[2] || 0);
    m = s.match(/^(\d{1,2}(?:\.\d+)?)$/);
    if (m) return Math.round(+m[1] * 60);
    return NaN;
  }
  TS.horasTxt = horasTxt;

  /** dados de feriados do mês para o PDF: { lista, horas: { data: { NOME: min } } } */
  TS.feriadosParaPdf = function (cfg, ym) {
    return { lista: TS.feriadosDoMes(cfg, ym), horas: (cfg && cfg.feriadosHoras && cfg.feriadosHoras[ym]) || {} };
  };

  /**
   * Cartão "Feriados do mês" no Comissionamento.
   * cfg = configuração da loja (db.metas[]), pessoas = nomes (como nas vendas), ym = mês
   */
  TS.cartaoFeriados = function ({ cfg, pessoas, ym }) {
    const db = TS.db;
    const pode = !TS.demo && (TS.eu?.pode?.configurar || (TS.eu?.perfil === 'gerente' && (TS.eu.telas || []).includes('comissionamento')));
    const editavel = pode || TS.demo; // na apresentação dá para testar, sem salvar
    const locais = ((cfg && cfg.feriadosLocais) || []).map((f) => ({ ...f }));
    const horas = JSON.parse(JSON.stringify((cfg && cfg.feriadosHoras && cfg.feriadosHoras[ym]) || {}));
    const nomes = [...new Set([...pessoas.map((n) => n.trim().toUpperCase()), ...Object.values(horas).flatMap((o) => Object.keys(o))])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const rotulo = new Map(pessoas.map((n) => [n.trim().toUpperCase(), n]));
    // quem vendeu em cada dia do mês
    const vendeu = new Map();
    for (let i = 0; i < db.n; i++) {
      if (!db.iso[i].startsWith(ym)) continue;
      const nm = String(db.D.vendedor[db.vend[i]] || '').trim().toUpperCase();
      if (!nm) continue;
      if (!vendeu.has(db.iso[i])) vendeu.set(db.iso[i], new Set());
      vendeu.get(db.iso[i]).add(nm);
    }
    const eq = (cfg && cfg.operacao && cfg.operacao.equipe) || { cargaSemanal: 44, escala: '6x1' };
    const jornada = Math.round((eq.cargaSemanal * 60) / (eq.escala === '5x2' ? 5 : 6));
    const card = h('div', { class: 'card feriados-card' });
    let sujoF = false;

    function pintar() {
      const lista = TS.feriadosDoMes({ feriadosLocais: locais }, ym);
      card.textContent = '';
      const acoes = h('div', { class: 'table-tools' });
      if (editavel) acoes.append(h('button', { type: 'button', class: 'btn', onclick: () => { form.hidden = !form.hidden; } }, '+ Feriado local'));
      if (pode) {
        const salvar = h('button', { type: 'button', class: 'btn primary' }, sujoF ? 'Salvar alterações' : 'Salvar');
        salvar.addEventListener('click', async () => {
          salvar.disabled = true;
          try {
            const r = await fetch(`/api/feriados?loja=${encodeURIComponent(cfg.id)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ym, horas, locais }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
            cfg.feriadosHoras = { ...(cfg.feriadosHoras || {}), [ym]: horas }; cfg.feriadosLocais = locais;
            sujoF = false; salvar.textContent = 'Salvo ✓';
          } catch (e) { salvar.textContent = e.message; } finally { salvar.disabled = false; }
        });
        acoes.append(salvar);
      }
      card.append(h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'card-title' }, `Feriados de ${TS.MESES_LONGOS[+ym.slice(5, 7) - 1].toLowerCase()}/${ym.slice(0, 4)}`),
        h('div', { class: 'card-sub' }, 'Horas trabalhadas por cada pessoa em cada feriado. Vão para o PDF do fechamento.')), acoes));
      // formulário de feriado local
      const fData = h('input', { class: 'f-input', type: 'date', min: ym + '-01', max: ym + '-31' });
      const fNome = h('input', { class: 'f-input', placeholder: 'Aniversário da cidade' });
      const fAnual = h('input', { type: 'checkbox', checked: true });
      const form = h('div', { class: 'feriado-form', hidden: true }, fData, fNome, h('label', { class: 'cfg-check-l' }, fAnual, ' repete todo ano'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => {
          if (!fData.value || !fNome.value.trim()) return;
          locais.push({ data: fData.value, nome: fNome.value.trim(), anual: fAnual.checked }); sujoF = true; pintar();
        } }, 'Adicionar'));
      card.append(form);
      // chips
      card.append(h('div', { class: 'feriado-chips' }, lista.length ? lista.map((f) => {
        const dt = new Date(f.data + 'T12:00:00Z');
        return h('span', { class: 'feriado-chip ' + f.tipo }, `${f.data.slice(8)}/${f.data.slice(5, 7)} ${DIAS_SEM[dt.getUTCDay()]} · ${f.nome} · ${f.tipo === 'facultativo' ? 'ponto facultativo' : f.tipo}`,
          f.tipo === 'local' && editavel ? h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remover ' + f.nome, onclick: () => { const i = locais.indexOf(f.orig); if (i >= 0) locais.splice(i, 1); sujoF = true; pintar(); } }, '×') : null);
      }) : h('span', { class: 'muted' }, 'Nenhum feriado neste mês. Use "+ Feriado local" para incluir um feriado da cidade ou do estado.')));
      if (!lista.length) return;
      // tabela
      const tot = (nome) => lista.reduce((s, f) => s + ((horas[f.data] || {})[nome] || 0), 0);
      const totDia = (d) => Object.values(horas[d] || {}).reduce((s, m) => s + m, 0);
      const tb = h('tbody', null, nomes.map((nome) => h('tr', null, h('td', { class: 'l' }, rotulo.get(nome) || nome), lista.map((f) => {
        const m = (horas[f.data] || {})[nome] || 0;
        const vend = vendeu.get(f.data)?.has(nome);
        const inp = h('input', { class: 'f-input hora-in', value: campoTxt(m), placeholder: '—', disabled: !editavel || null, inputmode: 'numeric', 'aria-label': `Horas de ${nome} em ${f.data}` });
        inp.addEventListener('change', () => {
          const v = lerHoras(inp.value);
          if (Number.isNaN(v) || v > 1440) { inp.classList.add('erro'); return; }
          inp.classList.remove('erro');
          if (v) (horas[f.data] ||= {})[nome] = v; else if (horas[f.data]) delete horas[f.data][nome];
          sujoF = true; pintar();
        });
        return h('td', null, inp, vend ? h('div', { class: 'hora-dica ' + (m ? 'ok' : 'falta') }, m ? 'vendeu' : 'vendeu, sem horas') : null);
      }), h('td', { class: 'b' }, horasTxt(tot(nome))))));
      card.append(h('div', { class: 'table-wrap free' }, h('table', { class: 't feriados-t' },
        h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Pessoa'), lista.map((f) => h('th', { title: f.nome }, `${f.data.slice(8)}/${f.data.slice(5, 7)}`)), h('th', null, 'Total'))),
        tb, h('tfoot', null, h('tr', null, h('td', { class: 'l' }, 'Total'), lista.map((f) => h('td', null, horasTxt(totDia(f.data)))), h('td', null, horasTxt(lista.reduce((s, f) => s + totDia(f.data), 0))))))));
      if (editavel) {
        card.append(h('div', { class: 'feriado-rodape' },
          h('button', { type: 'button', class: 'btn', onclick: () => {
            for (const f of lista) for (const nome of vendeu.get(f.data) || []) if (nomes.includes(nome) && !(horas[f.data] || {})[nome]) (horas[f.data] ||= {})[nome] = jornada;
            sujoF = true; pintar();
          } }, `Preencher quem vendeu (${horasTxt(jornada)})`),
          h('span', { class: 'muted' }, '"vendeu" = teve venda nesse dia, para ajudar a conferir. Formato: 07:20, 7h20 ou 7,5.')));
      }
    }
    pintar();
    return card;
  };
})();
