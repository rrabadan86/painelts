/* Extras: projeção do mês, "Minha comissão", fechamento em PDF e aviso de dados atrasados */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  const R = () => TS.rules;
  const dia = (iso) => TS.isoToDay(iso);
  const ymDe = (day) => TS.dayToIso(day).slice(0, 7);
  const diasNoMes = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();

  // ======================= META E PROJEÇÃO =======================
  /** meta das lojas (nomes de venda) num mês */
  TS.metaDoMes = function (ym, nomes) { return TS.metaCalc(ym, nomes).valor; };

  /**
   * Projeção linear do mês em andamento (pelo último dia com vendas).
   * Devolve null se o mês já fechou.
   */
  TS.projecao = function (valor, meta, ym) {
    const db = TS.db;
    if (ym !== ymDe(db.maxDay)) return null;
    const n = diasNoMes(ym), d = +TS.dayToIso(db.maxDay).slice(8, 10);
    const proj = d ? (valor / d) * n : null;
    const restantes = Math.max(0, n - d);
    const falta = meta != null ? Math.max(0, meta - valor) : null;
    return { proj, d, n, restantes, falta, porDia: falta != null && restantes ? falta / restantes : null, pctProj: meta ? proj / meta : null };
  };

  /** cartão de projeção (usado no Resumo, Comissionamento e Minha comissão) */
  TS.kpiProjecao = function (valor, meta, ym, rotulo = 'Projeção do mês') {
    const p = TS.projecao(valor, meta, ym);
    if (!p) return null;
    const foot = meta
      ? h('span', null, h('span', { class: p.pctProj >= 1 ? 'up' : 'down' }, `${fmt.pct(p.pctProj, 0)} da meta`),
        p.falta > 0 && p.restantes ? ` · faltam ${fmt.brl0(p.porDia)}/dia nos ${p.restantes} dias restantes` : p.falta === 0 ? ' · meta já batida' : '')
      : `no ritmo de ${p.d} de ${p.n} dias`;
    return TS.kpi(rotulo, fmt.brl0(p.proj), foot, `Faturamento até o dia ${p.d} ÷ ${p.d} dias × ${p.n} dias do mês`);
  };

  // ======================= AVISO DE DADOS ATRASADOS =======================
  /** lojas cuja última venda tem mais de 2 dias */
  TS.lojasAtrasadas = function () {
    const db = TS.db;
    if (!db || !db.n || TS.demo) return [];
    if (!db.ultimaPorLoja) {
      const m = new Map();
      for (let i = 0; i < db.n; i++) { const l = db.loja[i]; if (!(m.get(l) >= db.day[i])) m.set(l, db.day[i]); }
      db.ultimaPorLoja = m;
    }
    const hoje = TS.todayDay();
    return [...db.ultimaPorLoja].filter(([, d]) => hoje - d > 2).map(([l, d]) => ({ loja: db.D.loja[l], dia: d, dias: hoje - d }));
  };
  TS.avisoAtraso = function () {
    const at = TS.lojasAtrasadas();
    if (!at.length || TS.eu?.perfil === 'vendedor') return null;
    const txt = at.map((a) => `${a.loja}: última venda em ${fmt.date(TS.dayToIso(a.dia))} (há ${a.dias} dias)`).join(' · ');
    return h('div', { class: 'notice warn' }, h('b', null, 'Dados atrasados. '), txt, '. A atualização automática pode estar com problema',
      TS.eu?.pode?.configurar ? h('span', null, ' — veja em ', h('a', { href: '#config' }, 'Configurações'), '.') : '.');
  };

  // ======================= MINHA COMISSÃO =======================
  TS.PAGINAS_VENDEDOR = ['minha'];
  TS.pages.minha = function (root) {
    const db = TS.db;
    const souVendedor = TS.eu?.perfil === 'vendedor';
    const meses = [...new Set(db.ym)].sort().reverse();
    if (!state.minhaYm || !meses.includes(state.minhaYm)) state.minhaYm = meses[0];
    const ym = state.minhaYm;
    const de = dia(ym + '-01'), ate = dia(`${ym}-${String(diasNoMes(ym)).padStart(2, '0')}`);
    const base = TS.filtrar({ de, ate, mesLivre: true, ignorar: ['vendedores', 'grupos', 'cats', 'produto'] });
    const vendNoMes = [...new Set(base.map((i) => db.D.vendedor[db.vend[i]]))].filter((n) => n && !/^SEM VENDEDOR$|^COLEGA \d+$/i.test(n)).sort();
    let nome = souVendedor ? String(TS.eu.vendedor || '').toUpperCase() : (state.minhaVend || vendNoMes[0] || '');
    if (!souVendedor && !vendNoMes.includes(nome)) nome = vendNoMes[0] || '';
    if (souVendedor) nome = vendNoMes.find((n) => n.trim().toUpperCase() === nome) || nome;

    const selMes = h('select', { class: 'f-input' }, meses.map((m) => h('option', { value: m, selected: m === ym || null }, `${TS.MESES_LONGOS[+m.slice(5, 7) - 1]} de ${m.slice(0, 4)}`)));
    selMes.addEventListener('change', () => { state.minhaYm = selMes.value; TS.render(); });
    const ferramentas = h('div', { class: 'minha-sel' }, selMes);
    if (!souVendedor) {
      const selV = h('select', { class: 'f-input' }, vendNoMes.map((n) => h('option', { value: n, selected: n === nome || null }, n)));
      selV.addEventListener('change', () => { state.minhaVend = selV.value; TS.render(); });
      ferramentas.prepend(selV);
    }
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, souVendedor ? 'Minha comissão' : `Comissão de ${nome || '—'}`),
      h('div', { class: 'page-sub' }, souVendedor ? `Olá! Acompanhe sua meta e quanto vai receber em ${TS.MESES_LONGOS[+ym.slice(5, 7) - 1].toLowerCase()}.` : 'Como o vendedor vê a própria comissão')), ferramentas));
    const NOME = nome.trim().toUpperCase(); // comparação sem diferenciar maiúsculas ("Gabrielly" = "GABRIELLY")
    if (!nome) { root.append(TS.card(null, null, TS.empty(souVendedor ? 'Seu usuário ainda não está ligado a um vendedor. Fale com o gerente.' : 'Nenhum vendedor com vendas neste mês.'))); return; }

    const nomesLoja = new Set(base.filter((i) => db.D.vendedor[db.vend[i]].trim().toUpperCase() === NOME).map((i) => db.D.loja[db.loja[i]]));
    const baseLoja = nomesLoja.size ? base.filter((i) => nomesLoja.has(db.D.loja[db.loja[i]])) : base;
    const metaLoja = TS.metaDoMes(ym, nomesLoja.size ? nomesLoja : null) || 0;
    const res = R().comissionamento({ base: baseLoja, baseSemVend: baseLoja, metaLoja, vendBonus: '', ym });
    const row = res.rows.find((r) => r.vendedor.trim().toUpperCase() === NOME);
    if (!row) { root.append(TS.card(null, null, TS.empty(`Sem vendas de ${souVendedor ? 'você' : nome} em ${TS.ymLabel(ym)}.`))); return; }
    const rg = res.regras;
    const eg = R().espacoGourmet({ base: baseLoja, baseSemVend: baseLoja });
    const gorjeta = (eg.rows.find((r) => r.vendedor.trim().toUpperCase() === NOME) || {}).gorjeta || 0;
    const premio = rg.rateio && rg.rateio.ativo ? 0 : row.premiacao; // no rateio a premiação já entra no montante
    const totalReceber = (row.aPagar || 0) + premio + gorjeta;

    root.append(h('div', { class: 'grid g-kpi' },
      TS.kpi('A receber (estimado)', fmt.brl(totalReceber), h('span', null, `comissão ${fmt.brl(row.aPagar)}`, premio ? ` + premiação ${fmt.brl0(premio)}` : '', gorjeta ? ` + gorjeta ${fmt.brl(gorjeta)}` : '')),
      TS.kpi('Você vendeu', fmt.brl0(row.total), row.metaInd ? h('span', { class: row.total >= row.metaInd ? 'up' : 'down' }, `${fmt.pct(row.total / row.metaInd, 0)} da sua meta`) : 'sem meta individual'),
      TS.kpi('Sua meta', row.metaInd ? fmt.brl0(row.metaInd) : '—', (() => {
        const minhas = res.feriasMes.filter((f) => String(f.vendedor).trim().toUpperCase() === NOME);
        if (minhas.length) return `menor por causa das férias (${minhas.map((f) => `${fmt.date(f.de).slice(0, 5)} a ${fmt.date(f.ate).slice(0, 5)}`).join(', ')})`;
        if (res.feriasMes.length) return 'inclui a parte de quem está de férias';
        return `meta da loja ${fmt.brl0(metaLoja)} ÷ ${res.qtdVend} vendedores`;
      })()),
      TS.kpiProjecao(row.total, row.metaInd || null, ym, 'Se continuar neste ritmo') || TS.kpi('Mês', 'Fechado', TS.ymLabel(ym))));

    // por categoria
    const proj = TS.projecao(1, 1, ym);
    const cats = [['arom', 'Chá aromatizado', 'metaArom', 'cArom'], ['puro', 'Chá puro', 'metaPuro', 'cPuro'], ['acess', 'Acessórios', 'metaAcess', 'cAcess']];
    const blocos = cats.map(([k, nomeCat, mk, ck]) => {
      const v = row[k] || 0, m = row[mk] || 0, f = rg.comissao[k];
      const pct = m ? v / m : null;
      const simples = rg.comissao.modo === 'simples';
      const faixa = !m ? null : simples ? (v >= m ? 'bate' : 'abaixo') : v >= m * 1.2 ? 'acima120' : v >= m ? 'bate' : 'abaixo';
      const prox = !m ? null : faixa === 'abaixo' ? { alvo: m, taxa: f.bate, txt: 'bater a meta' } : faixa === 'bate' && !simples ? { alvo: m * 1.2, taxa: f.acima120, txt: 'chegar a 120%' } : null;
      const larg = Math.min(100, ((pct || 0) / (simples ? 1.1 : 1.3)) * 100);
      return h('div', { class: 'card minha-cat' },
        h('div', { class: 'minha-cat-top' }, h('div', { class: 'card-title' }, nomeCat), h('div', { class: 'minha-com' }, fmt.brl(row[ck]), h('small', null, faixa ? ` (${fmt.pct(f[faixa], 1)})` : ''))),
        h('div', { class: 'minha-val' }, h('b', null, fmt.brl0(v)), ` de ${fmt.brl0(m)}`, pct != null ? h('span', { class: pct >= 1 ? 'up' : 'down' }, ` · ${fmt.pct(pct, 0)}`) : null),
        h('div', { class: 'minha-barra' }, h('div', { class: 'fill' + (pct >= 1 ? ' ok' : ''), style: { width: larg + '%' } }),
          h('span', { class: 'marca', style: { left: (100 / (simples ? 1.1 : 1.3)) + '%' }, title: 'meta' }),
          simples ? null : h('span', { class: 'marca m120', style: { left: (120 / 1.3) + '%' }, title: '120% da meta' })),
        prox ? h('div', { class: 'minha-dica' }, `Faltam ${fmt.brl0(prox.alvo - v)} para ${prox.txt} e a comissão subir para ${fmt.pct(prox.taxa, 1)}`,
          proj && proj.restantes ? ` (${fmt.brl0((prox.alvo - v) / proj.restantes)}/dia)` : '', '.') : m ? h('div', { class: 'minha-dica ok' }, simples ? 'Meta batida!' : 'Acima de 120% da meta: faixa máxima!') : null);
    });
    root.append(TS.section('Por categoria'), h('div', { class: 'grid g-3' }, blocos));

    // indicadores e premiação
    const pr = rg.premiacao;
    const ind = (rot, val, alvo, fm) => h('div', { class: 'minha-ind' + (val >= alvo ? ' ok' : '') }, h('span', null, rot), h('b', null, fm(val)), h('small', null, `mínimo ${fm(alvo)}`), h('i', null, val >= alvo ? '✓' : '—'));
    const nOk = (row.tkm >= pr.tkm) + (row.ipa >= pr.ipa) + (row.pma >= pr.pma);
    root.append(h('div', { class: 'grid g-2 mt' },
      pr.ativa ? TS.card('Premiação', `${fmt.brl0(pr.valor)} por indicador quando ${pr.minimo} ou mais estão no mínimo · você está com ${nOk} de 3`,
        h('div', { class: 'minha-inds' }, ind('Ticket médio (TKM)', row.tkm, pr.tkm, fmt.brl), ind('Itens por atendimento (IPA)', row.ipa, pr.ipa, fmt.n2), ind('Preço médio (PMA)', row.pma, pr.pma, fmt.brl)),
        h('div', { class: 'minha-dica' + (row.premiacao ? ' ok' : '') }, row.premiacao ? `Premiação garantida até agora: ${fmt.brl0(row.premiacao)}` : `Falta${pr.minimo - nOk > 1 ? 'm' : ''} ${pr.minimo - nOk} indicador(es) para a premiação.`))
        : TS.card('Indicadores', 'Seu desempenho no mês', h('div', { class: 'minha-inds' }, ind('TKM', row.tkm, 0, fmt.brl), ind('IPA', row.ipa, 0, fmt.n2), ind('PMA', row.pma, 0, fmt.brl))),
      graficoAcumulado(baseLoja, NOME, ym, row.metaInd)));
    root.append(h('p', { class: 'muted minha-obs' }, 'Valores estimados com as vendas até ', fmt.date(TS.dayToIso(Math.min(db.maxDay, ate))), '. O valor final é fechado pela loja no fim do mês.'));
  };

  function graficoAcumulado(base, nome, ym, meta) {
    const db = TS.db, n = diasNoMes(ym);
    const porDia = new Array(n).fill(0);
    const I = R().ids;
    for (const i of base) {
      if (db.D.vendedor[db.vend[i]].trim().toUpperCase() !== nome) continue;
      const g = db.grupoC[i];
      if (I.eg.has(db.cat[i]) || !(I.arom.has(g) || I.puro.has(g) || I.acess.has(g))) continue;
      porDia[+db.iso[i].slice(8, 10) - 1] += db.vt[i] || 0;
    }
    const ultimo = ym === ymDe(db.maxDay) ? +TS.dayToIso(db.maxDay).slice(8, 10) : n;
    let acc = 0;
    const real = porDia.map((v, k) => (k < ultimo ? (acc += v) : null));
    const labels = porDia.map((_, k) => String(k + 1));
    return TS.card('Vendas acumuladas no mês', meta ? 'Linha tracejada = ritmo para bater a meta' : 'Chás e acessórios', TS.chart({
      type: 'line',
      data: { labels, datasets: [
        { label: 'Você', data: real, borderColor: '#2C5234', backgroundColor: 'rgba(44,82,52,.12)', fill: true, tension: 0.25, pointRadius: 0 },
        meta ? { label: 'Ritmo da meta', data: labels.map((_, k) => (meta / n) * (k + 1)), borderColor: '#C9A227', borderDash: [6, 4], pointRadius: 0, fill: false } : null,
      ].filter(Boolean) },
      options: { plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.brl0(c.raw)}` } } },
        scales: { y: { ticks: { callback: (v) => fmt.compact(v) }, grid: { color: '#EEE9DF' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } } } },
    }, 'short'));
  }

  // ======================= FECHAMENTO EM PDF =======================
  /** monta as páginas de impressão (Salvar como PDF no navegador) */
  TS.paginasFechamento = function ({ res, eg, meta, periodo, loja, feriados }) {
    const rg = res.regras;
    const gorj = new Map(eg.rows.map((r) => [r.vendedor, r.gorjeta]));
    const linhas = res.rows.filter((r) => (r.total > 0 || r.aPagar > 0) && !/^SEM VENDEDOR$/i.test(String(r.vendedor).trim())).sort((a, b) => a.vendedor.localeCompare(b.vendedor, 'pt-BR'));
    const totalDe = (r) => (r.aPagar || 0) + (rg.rateio && rg.rateio.ativo ? 0 : r.premiacao || 0) + (gorj.get(r.vendedor) || 0);
    const emitido = new Date().toLocaleString('pt-BR');
    // feriados trabalhados: { NOME: [{ data, nome, min }] }
    const fer = new Map();
    if (feriados) for (const f of feriados.lista) for (const [nome, min] of Object.entries(feriados.horas[f.data] || {})) {
      if (!fer.has(nome)) fer.set(nome, []);
      fer.get(nome).push({ data: f.data, nome: f.nome, min });
    }
    const ferDe = (vend) => fer.get(String(vend).trim().toUpperCase()) || [];
    const minTot = (vend) => ferDe(vend).reduce((s, x) => s + x.min, 0);
    const temFeriado = feriados && feriados.lista.length;
    const DSEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const cab = (sub) => h('div', { class: 'imp-cab' }, h('div', null, h('div', { class: 'imp-marca' }, 'Tea Shop'), h('div', null, loja)), h('div', { class: 'imp-dir' }, h('div', { class: 'imp-tit' }, 'Fechamento de comissão'), h('div', null, periodo), sub ? h('div', null, sub) : null));
    const pg = [];
    // resumo
    pg.push(h('section', { class: 'imp-pag' }, cab('Resumo'),
      h('table', { class: 'imp-t' }, h('thead', null, h('tr', null, ['Vendedor', 'Vendido', 'Meta ind.', 'Comissão', 'Premiação', 'Gorjeta', 'Total', ...(temFeriado ? ['Horas em feriados'] : [])].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
        h('tbody', null, linhas.map((r) => h('tr', null, h('td', null, r.vendedor), h('td', { class: 'r' }, fmt.brl(r.total)), h('td', { class: 'r' }, fmt.brl0(r.metaInd)), h('td', { class: 'r' }, fmt.brl(r.aPagar)),
          h('td', { class: 'r' }, fmt.brl(rg.rateio && rg.rateio.ativo ? 0 : r.premiacao)), h('td', { class: 'r' }, fmt.brl(gorj.get(r.vendedor) || 0)), h('td', { class: 'r b' }, fmt.brl(totalDe(r))), temFeriado ? h('td', { class: 'r' }, TS.horasTxt(minTot(r.vendedor))) : null))),
        h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', { class: 'r' }, fmt.brl(res.total.total)), h('td', { class: 'r' }, fmt.brl0(meta)), h('td', { class: 'r' }, fmt.brl(res.total.aPagar)),
          h('td', { class: 'r' }, fmt.brl(rg.rateio && rg.rateio.ativo ? 0 : res.total.premiacao)), h('td', { class: 'r' }, fmt.brl(linhas.reduce((s, r) => s + (gorj.get(r.vendedor) || 0), 0))), h('td', { class: 'r b' }, fmt.brl(linhas.reduce((s, r) => s + totalDe(r), 0))), temFeriado ? h('td', { class: 'r' }, TS.horasTxt(linhas.reduce((s, r) => s + minTot(r.vendedor), 0))) : null))),
      h('p', { class: 'imp-obs' }, `Meta da loja: ${fmt.brl0(meta)} · ${res.qtdVend} vendedores dividem a meta${res.feriasMes && res.feriasMes.length ? ` · férias no mês: ${res.feriasMes.map((f) => `${f.vendedor} (${fmt.date(f.de)} a ${fmt.date(f.ate)})`).join(', ')} — nesses dias a meta diária foi dividida entre quem estava trabalhando` : ''}. Vendas sem Espaço Gourmet. Emitido em ${emitido}.`)));
    // um por vendedor
    for (const r of linhas) {
      const cat = (rot, v, m, c) => h('tr', null, h('td', null, rot), h('td', { class: 'r' }, fmt.brl0(m)), h('td', { class: 'r' }, fmt.brl(v)), h('td', { class: 'r' }, m ? fmt.pct(v / m, 0) : '—'), h('td', { class: 'r' }, fmt.brl(c)));
      pg.push(h('section', { class: 'imp-pag' }, cab(r.vendedor),
        h('h2', { class: 'imp-nome' }, r.vendedor),
        h('table', { class: 'imp-t' }, h('thead', null, h('tr', null, ['Categoria', 'Meta', 'Vendido', '% da meta', 'Comissão'].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
          h('tbody', null, cat('Chá aromatizado', r.arom, r.metaArom, r.cArom), cat('Chá puro', r.puro, r.metaPuro, r.cPuro), cat('Acessórios', r.acess, r.metaAcess, r.cAcess),
            r.bonus ? h('tr', null, h('td', null, 'Bônus sobre outros vendedores'), h('td'), h('td'), h('td'), h('td', { class: 'r' }, fmt.brl(r.bonus))) : null),
          h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', { class: 'r' }, fmt.brl0(r.metaInd)), h('td', { class: 'r' }, fmt.brl(r.total)), h('td', { class: 'r' }, r.metaInd ? fmt.pct(r.total / r.metaInd, 0) : '—'), h('td', { class: 'r' }, fmt.brl(r.base))))),
        h('table', { class: 'imp-t imp-res' }, h('tbody', null,
          h('tr', null, h('td', null, rg.rateio && rg.rateio.ativo ? 'Comissão (rateio igual entre a equipe)' : 'Comissão'), h('td', { class: 'r' }, fmt.brl(r.aPagar))),
          rg.rateio && rg.rateio.ativo ? null : h('tr', null, h('td', null, `Premiação (TKM ${fmt.brl(r.tkm)} · IPA ${fmt.n2(r.ipa)} · PMA ${fmt.brl(r.pma)})`), h('td', { class: 'r' }, fmt.brl(r.premiacao))),
          h('tr', null, h('td', null, 'Gorjeta (taxa de serviço)'), h('td', { class: 'r' }, fmt.brl(gorj.get(r.vendedor) || 0))),
          h('tr', { class: 'tot' }, h('td', null, 'Total a receber'), h('td', { class: 'r' }, fmt.brl(totalDe(r)))))),
        temFeriado ? h('div', { class: 'imp-fer' }, h('div', { class: 'imp-sub' }, 'Feriados trabalhados'),
          ferDe(r.vendedor).length ? h('table', { class: 'imp-t' }, h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'Feriado'), h('th', { class: 'r' }, 'Horas'))),
            h('tbody', null, ferDe(r.vendedor).map((x) => h('tr', null, h('td', null, `${fmt.date(x.data)} (${DSEM[new Date(x.data + 'T12:00:00Z').getUTCDay()]})`), h('td', null, x.nome), h('td', { class: 'r' }, TS.horasTxt(x.min))))),
            h('tfoot', null, h('tr', null, h('td', { colspan: 2 }, 'Total em feriados'), h('td', { class: 'r' }, TS.horasTxt(minTot(r.vendedor))))))
            : h('p', { class: 'imp-obs' }, 'Não trabalhou em feriados neste período.')) : null,
        h('div', { class: 'imp-ass' }, h('div', null, h('span'), r.vendedor), h('div', null, h('span'), 'Responsável pela loja')),
        h('p', { class: 'imp-obs' }, `Emitido em ${emitido}.`)));
    }
    // dados usados também no e-mail da contabilidade
    pg.dados = { rg, gorj, linhas, totalDe, ferDe, minTot, temFeriado: !!temFeriado, emitido };
    return pg;
  };
  TS.imprimirFechamento = function (args) {
    document.getElementById('impressao')?.remove();
    const el = h('div', { id: 'impressao' }, TS.paginasFechamento(args));
    document.body.append(el);
    const limpar = () => { el.remove(); window.removeEventListener('afterprint', limpar); };
    window.addEventListener('afterprint', limpar);
    setTimeout(() => window.print(), 100);
  };
})();

/* ======================= REDE, ALERTAS E MARCA ======================= */
(function () {
  const { h, fmt, state } = TS;
  const FMT = { brl0: fmt.brl0, brl: fmt.brl, int: fmt.int, n2: fmt.n2, kg: (v) => fmt.kg(v) + ' kg', pct: (v) => fmt.pct(v), delta: (v) => fmt.delta(v) };
  const lojaUnicaSel = () => (state.loja && state.loja !== 'todas' ? state.loja : null);

  /** cartão "Sua loja × rede" (preenchido quando a resposta chega) */
  TS.cartaoRede = function () {
    const loja = lojaUnicaSel();
    const ym = TS.metaPeriodo().ym;
    const corpo = h('div', { class: 'rede-corpo' }, h('div', { class: 'muted' }, 'Carregando…'));
    const card = TS.card('Sua loja × rede', `${TS.MESES_LONGOS[+ym.slice(5, 7) - 1]} de ${ym.slice(0, 4)} · comparação anônima: nenhuma outra loja é identificada`, corpo);
    card.classList.add('rede-card');
    if (!loja) { corpo.replaceChildren(h('div', { class: 'muted' }, 'Escolha uma loja no seletor do topo para comparar com a rede.')); return card; }
    fetch(TS.api(`rede?ym=${ym}&loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }).then((r) => r.json()).then((r) => {
      if (r.erro) throw new Error(r.erro);
      if (r.lojas < r.minimo) { corpo.replaceChildren(h('div', { class: 'muted' }, `A comparação aparece quando pelo menos ${r.minimo} lojas têm vendas no mês (hoje: ${r.lojas}). Assim nenhuma loja pode ser identificada.`)); return; }
      const neutro = new Set(['pctEG', 'pctPuro', 'pctAcess']); // mix: nem melhor nem pior
      const linhas = r.indicadores.map((x) => {
        const f = FMT[x.formato] || fmt.n2;
        const acima = x.minha != null && x.minha >= x.media;
        const barra = x.posicao == null ? null : h('div', { class: 'rede-pos' }, h('div', { class: 'rede-pos-fill', style: { width: Math.max(4, x.posicao) + '%' } }));
        return h('tr', null, h('td', { class: 'l' }, x.nome), h('td', { class: 'b ' + (x.minha == null ? 'muted' : neutro.has(x.k) ? '' : acima ? 'pos' : 'neg') }, x.minha == null ? '—' : f(x.minha)),
          h('td', null, f(x.media)), h('td', null, f(x.top25)), h('td', { class: 'l', title: x.posicao == null ? '' : `Sua loja está acima de ${x.posicao}% das lojas da rede` }, barra, x.posicao == null ? '' : h('small', null, ` acima de ${x.posicao}%`)));
      });
      corpo.replaceChildren(
        r.parcial ? h('div', { class: 'muted', style: { marginBottom: '8px', fontSize: '12px' } }, `Mês em andamento: todas as lojas comparadas até ${fmt.date(r.ate)}. ${r.lojas} lojas na comparação.`) : h('div', { class: 'muted', style: { marginBottom: '8px', fontSize: '12px' } }, `${r.lojas} lojas na comparação.`),
        h('div', { class: 'table-wrap free' }, h('table', { class: 't rede-t' }, h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Indicador'), h('th', null, 'Sua loja'), h('th', null, 'Média da rede'), h('th', null, 'Melhores 25%'), h('th', { class: 'l' }, 'Posição'))), h('tbody', null, linhas))));
    }).catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
    return card;
  };

  /** alertas da loja (Resumo) */
  TS.cartaoAlertas = function () {
    const loja = lojaUnicaSel();
    if (!loja || TS.eu?.perfil === 'vendedor') return null;
    const box = h('div', { class: 'alertas', hidden: true });
    fetch(TS.api(`alertas?loja=${encodeURIComponent(loja)}`), { credentials: 'same-origin' }).then((r) => r.json()).then((r) => {
      const al = (r.alertas || []).slice(0, 6);
      if (!al.length) return;
      const ic = { queda: '▼', meta: '◎', vendedor: '●', alta: '▲' };
      box.replaceChildren(h('div', { class: 'alertas-tit' }, 'Alertas e destaques'), h('ul', null, al.map((a) => h('li', { class: 'al-' + a.tipo + (a.gravidade >= 2 ? ' grave' : '') }, h('span', { class: 'al-ic' }, ic[a.tipo] || '•'), a.texto))));
      box.hidden = false;
    }).catch(() => {});
    return box;
  };

  /** logo e nome da loja no topo */
  TS.aplicarMarca = function () {
    const brand = document.querySelector('.brand');
    if (!brand || TS.demo) return;
    const l = (TS.lojas || []).find((x) => x.id === state.loja);
    const mark = brand.querySelector('.brand-mark');
    brand.querySelector('.brand-logo')?.remove();
    if (l && l.marca && l.marca.logo) {
      mark.hidden = true;
      mark.after(h('img', { class: 'brand-logo', src: `/marca/${encodeURIComponent(l.id)}/logo?v=${Date.now() % 1e6}`, alt: '' }));
    } else mark.hidden = false;
    const sub = brand.querySelector('.brand-sub');
    if (sub) sub.textContent = l ? l.marca?.nome || l.nome : (TS.lojas || []).length > 1 ? 'Todas as lojas' : 'Painel de vendas';
  };
})();
