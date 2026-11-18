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

  const hm2 = (x) => +x.slice(0, 2) * 60 + +x.slice(3, 5);
  /**
   * Horário da loja num feriado: 1º) o definido para aquela data; 2º) o horário padrão de feriados da loja;
   * 3º) o horário normal do dia da semana. origem = 'data' | 'feriados' | 'semana'
   */
  TS.horarioFeriado = function (cfg, data) {
    const esp = cfg && cfg.feriadosHorario && cfg.feriadosHorario[data];
    if (esp) return { ...esp, origem: 'data' };
    const func = cfg && cfg.operacao && cfg.operacao.funcionamento;
    const pad = func && func.feriado;
    if (pad && !pad.mesmoDoDia) return { abre: pad.abre, fecha: pad.fecha, fechado: !!pad.fechado, origem: 'feriados' };
    const dia = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'][new Date(data + 'T12:00:00Z').getUTCDay()];
    const f = func && func[dia];
    return f ? { abre: f.abre, fecha: f.fecha, fechado: !!f.fechado, origem: 'semana' } : null;
  };
  /** datas de feriado (para tirar do Mapa de calor) entre dois anos */
  TS.datasFeriado = function (cfg, anoIni, anoFim) {
    const s = new Set();
    for (let a = anoIni; a <= anoFim; a++) {
      TS.feriadosNacionais(a).forEach((f) => s.add(f.data));
      ((cfg && cfg.feriadosLocais) || []).forEach((f) => s.add(f.anual !== false ? `${a}${f.data.slice(4)}` : f.data));
    }
    return s;
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
  /** quem vendeu em cada dia do mês (nomes em maiúsculas) */
  function vendeuNoMes(ym) {
    const db = TS.db, out = new Map();
    if (!db) return out;
    for (let i = 0; i < db.n; i++) {
      if (!db.iso[i].startsWith(ym)) continue;
      const nm = String(db.D.vendedor[db.vend[i]] || '').trim().toUpperCase();
      if (!nm) continue;
      if (!out.has(db.iso[i])) out.set(db.iso[i], new Set());
      out.get(db.iso[i]).add(nm);
    }
    return out;
  }
  const equipeDe = (cfg) => (cfg && cfg.operacao && cfg.operacao.equipe) || { cargaSemanal: 44, escala: '6x1' };
  const jornadaDe = (eq) => Math.round((eq.cargaSemanal * 60) / (eq.escala === '5x2' ? 5 : 6));
  /** horas automáticas de quem vendeu no feriado: horário da loja naquele dia (acima de 6h desconta o intervalo), até a jornada */
  function horasAuto(cfg, data) {
    const eq = equipeDe(cfg), jornada = jornadaDe(eq);
    const ef = TS.horarioFeriado(cfg, data);
    if (ef && ef.fechado) return 0;
    const aberto = ef && ef.abre && ef.fecha ? hm2(ef.fecha) - hm2(ef.abre) : jornada;
    const util = aberto > 360 ? aberto - (eq.intervalo ?? 60) : aberto;
    return Math.max(0, Math.min(jornada, util));
  }
  /**
   * horas de cada pessoa nos feriados do mês: o que foi editado (inclusive 0) vale; quem vendeu no feriado e não foi editado
   * entra com as horas automáticas. Devolve { data: { NOME: min } } e, em auto, quais vieram do automático.
   */
  TS.horasFeriados = function (cfg, ym, vendeu) {
    const salvas = (cfg && cfg.feriadosHoras && cfg.feriadosHoras[ym]) || {};
    const v = vendeu || vendeuNoMes(ym);
    const horas = {}, auto = {};
    for (const f of TS.feriadosDoMes(cfg, ym)) {
      const d = f.data, ed = salvas[d] || {};
      for (const [nome, m] of Object.entries(ed)) if (m > 0) (horas[d] ||= {})[nome] = m;
      const a = horasAuto(cfg, d);
      if (a) for (const nome of v.get(d) || []) if (!(nome in ed)) { (horas[d] ||= {})[nome] = a; (auto[d] ||= {})[nome] = true; }
    }
    return { horas, auto };
  };
  TS.feriadosParaPdf = function (cfg, ym) {
    return { lista: TS.feriadosDoMes(cfg, ym), horas: TS.horasFeriados(cfg, ym).horas };
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
    const horas = JSON.parse(JSON.stringify((cfg && cfg.feriadosHoras && cfg.feriadosHoras[ym]) || {})); // só o que foi editado (0 = não trabalhou)
    const horarios = Object.fromEntries(Object.entries((cfg && cfg.feriadosHorario) || {}).filter(([d]) => d.startsWith(ym)).map(([d, v]) => [d, { ...v }]));
    const cfgVivo = () => ({ ...cfg, feriadosHorario: { ...((cfg && cfg.feriadosHorario) || {}), ...horarios } });
    const nomes = [...new Set([...pessoas.map((n) => n.trim().toUpperCase()), ...Object.values(horas).flatMap((o) => Object.keys(o).filter((k) => o[k] > 0))])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const rotulo = new Map(pessoas.map((n) => [n.trim().toUpperCase(), n]));
    const vendeu = vendeuNoMes(ym);
    const jornada = jornadaDe(equipeDe(cfg));
    // horas que valem (editadas + automáticas), com o horário e os feriados como estão na tela
    const efetivas = () => TS.horasFeriados({ ...cfgVivo(), feriadosLocais: locais, feriadosHoras: { ...((cfg && cfg.feriadosHoras) || {}), [ym]: horas } }, ym, vendeu);
    const card = h('div', { class: 'card feriados-card' });
    let sujoF = false;

    /** horário da loja no feriado: padrão (da loja) ou personalizado para a data, ou fechado */
    function celulaHorario(data) {
      const ef = TS.horarioFeriado(cfgVivo(), data);
      const txt = !ef ? 'sem horário cadastrado' : ef.fechado ? 'fechada' : `${ef.abre}–${ef.fecha}`;
      const origem = !ef ? 'Movimento e escala → Horário e equipe' : ef.origem === 'data' ? 'deste feriado' : ef.origem === 'feriados' ? 'padrão de feriados' : 'dia normal';
      if (!editavel) return h('div', { class: 'hor-txt' }, txt, h('small', null, origem));
      const modo = horarios[data] ? (horarios[data].fechado ? 'fechado' : 'proprio') : 'padrao';
      const sel = h('select', { class: 'f-input hor-sel' }, h('option', { value: 'padrao', selected: modo === 'padrao' || null }, 'Padrão'), h('option', { value: 'proprio', selected: modo === 'proprio' || null }, 'Outro horário'), h('option', { value: 'fechado', selected: modo === 'fechado' || null }, 'Fechada'));
      sel.addEventListener('change', () => {
        if (sel.value === 'padrao') delete horarios[data];
        else if (sel.value === 'fechado') horarios[data] = { fechado: true };
        else { const b = TS.horarioFeriado({ ...cfg, feriadosHorario: {} }, data); horarios[data] = { abre: (b && !b.fechado && b.abre) || '10:00', fecha: (b && !b.fechado && b.fecha) || '18:00', fechado: false }; }
        sujoF = true; pintar();
      });
      const box = h('div', { class: 'hor-cel' }, sel);
      if (modo === 'proprio') {
        const a = h('input', { class: 'f-input hor-t', type: 'time', value: horarios[data].abre }), b = h('input', { class: 'f-input hor-t', type: 'time', value: horarios[data].fecha });
        const upd = () => { horarios[data] = { abre: a.value, fecha: b.value, fechado: false }; sujoF = true; };
        a.addEventListener('change', upd); b.addEventListener('change', () => { upd(); pintar(); });
        box.append(a, b);
      } else box.append(h('small', null, `${txt} · ${origem}`));
      return box;
    }

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
            const r = await fetch(`/api/feriados?loja=${encodeURIComponent(cfg.id)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Painel': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ym, horas, locais, horarios }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
            cfg.feriadosHoras = { ...(cfg.feriadosHoras || {}), [ym]: horas }; cfg.feriadosLocais = locais;
            cfg.feriadosHorario = { ...Object.fromEntries(Object.entries(cfg.feriadosHorario || {}).filter(([d]) => !d.startsWith(ym))), ...horarios };
            sujoF = false; salvar.textContent = 'Salvo ✓';
          } catch (e) { salvar.textContent = e.message; } finally { salvar.disabled = false; }
        });
        acoes.append(salvar);
      }
      card.append(h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'card-title' }, `Feriados de ${TS.MESES_LONGOS[+ym.slice(5, 7) - 1].toLowerCase()}/${ym.slice(0, 4)}`),
        h('div', { class: 'card-sub' }, 'Horas trabalhadas por cada pessoa em cada feriado. Vão para o PDF do fechamento.')), acoes));
      // formulário de feriado local
      const ultDia = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
      const fData = h('input', { class: 'f-input', type: 'date', min: ym + '-01', max: `${ym}-${String(ultDia).padStart(2, '0')}` });
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
      // tabela: quem vendeu no feriado entra sozinho com as horas do horário da loja; o que for digitado passa a valer
      const { horas: hv, auto } = efetivas();
      const tot = (nome) => lista.reduce((s, f) => s + ((hv[f.data] || {})[nome] || 0), 0);
      const totDia = (d) => Object.values(hv[d] || {}).reduce((s, m) => s + m, 0);
      const tb = h('tbody', null, nomes.map((nome) => h('tr', null, h('td', { class: 'l' }, rotulo.get(nome) || nome), lista.map((f) => {
        const m = (hv[f.data] || {})[nome] || 0;
        const ehAuto = !!(auto[f.data] || {})[nome];
        const editado = horas[f.data] && nome in horas[f.data];
        const vend = vendeu.get(f.data)?.has(nome);
        const inp = h('input', { class: 'f-input hora-in' + (ehAuto ? ' auto' : ''), value: campoTxt(m), placeholder: '—', disabled: !editavel || null, inputmode: 'numeric', 'aria-label': `Horas de ${nome} em ${f.data}` });
        inp.addEventListener('change', () => {
          const v = lerHoras(inp.value);
          if (Number.isNaN(v) || v > 1440) { inp.classList.add('erro'); return; }
          inp.classList.remove('erro');
          (horas[f.data] ||= {})[nome] = v || 0; // apagar = não trabalhou (o automático não volta)
          sujoF = true; pintar();
        });
        const ef = TS.horarioFeriado(cfgVivo(), f.data);
        const voltar = editado && vend && editavel ? h('button', { type: 'button', class: 'link-btn', title: 'Voltar às horas automáticas (horário da loja no feriado)', onclick: () => { delete horas[f.data][nome]; sujoF = true; pintar(); } }, '↺ automático') : null;
        const dica = ef && ef.fechado && m ? h('div', { class: 'hora-dica falta' }, 'loja marcada como fechada')
          : ehAuto ? h('div', { class: 'hora-dica ok' }, 'vendeu · automático')
            : editado && vend ? h('div', { class: 'hora-dica' }, m ? 'editado ' : 'editado: não trabalhou ', voltar)
              : vend && !m ? h('div', { class: 'hora-dica falta' }, 'vendeu, sem horas')
                : editado && m ? h('div', { class: 'hora-dica' }, 'editado') : null;
        return h('td', null, inp, dica);
      }), h('td', { class: 'b' }, horasTxt(tot(nome))))));
      card.append(h('div', { class: 'table-wrap free' }, h('table', { class: 't feriados-t' },
        h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Pessoa'), lista.map((f) => h('th', { title: f.nome }, `${f.data.slice(8)}/${f.data.slice(5, 7)}`)), h('th', null, 'Total')),
          h('tr', { class: 'linha-horario' }, h('td', { class: 'l' }, 'Loja abre'), lista.map((f) => h('td', null, celulaHorario(f.data))), h('td'))),
        tb, h('tfoot', null, h('tr', null, h('td', { class: 'l' }, 'Total'), lista.map((f) => h('td', null, horasTxt(totDia(f.data)))), h('td', null, horasTxt(lista.reduce((s, f) => s + totDia(f.data), 0))))))));
      card.append(h('div', { class: 'feriado-rodape' }, h('span', { class: 'muted' },
        `Quem vendeu no feriado entra sozinho com as horas do horário da loja naquele dia (até a jornada de ${horasTxt(jornada)}; acima de 6h desconta o intervalo) — mudou o horário, as horas acompanham. Para corrigir, digite em cima (07:20, 7h20 ou 7,5); apagar = não trabalhou. "↺ automático" desfaz a correção.${editavel ? ' Clique em Salvar para guardar as correções.' : ''}`)));
    }
    pintar();
    return card;
  };
})();
