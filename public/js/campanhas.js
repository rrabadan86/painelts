/* Clientes → Campanhas: lista de clientes por critérios (pontos, vencimento, produto, ausência…), mensagem de WhatsApp
 * personalizada, envio em fila (um clique por cliente, no WhatsApp da loja) e o retorno: quem comprou nos N dias seguintes
 * (a conta do retorno e do grupo de comparação fica em campretorno.js).
 * Só clientes com celular e que não pediram para não receber mensagens. Campanha recorrente: uma lista nova por semana
 * ou por mês, montada com os mesmos critérios quando a tela é aberta (campanha do robô: o servidor monta sozinho,
 * com as contas deste arquivo — TS.campanhasCalc, src/zapauto.js). */
(function () {
  const { h, fmt, state } = TS;
  const A = () => TS.cliApi;
  const dia = TS.todayDay;
  const d = (day) => (day == null ? '—' : fmt.date(TS.dayToIso(day)));
  const isoDia = (iso) => TS.isoToDay(String(iso).slice(0, 10));

  TS.subClientes = (atual) => TS.subGrupo(atual);

  // ---------- servidor (na apresentação fica só na memória) ----------
  const demo = { lista: [] };
  async function api(met, url, corpo) {
    if (TS.demo) return demoApi(met, url, corpo);
    const r = await fetch(url, { method: met, credentials: 'same-origin', headers: corpo ? { 'Content-Type': 'application/json', 'X-Painel': '1' } : { 'X-Painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha ao salvar.');
    return j;
  }
  /** apresentação: uma campanha de exemplo já enviada pelo robô, com algumas não enviadas (para a aba "Não enviadas" ter o que mostrar) */
  function semearDemo() {
    if (demo.semeado || !TS.cli || !TS.cli.lista) return;
    demo.semeado = true;
    const cs = TS.cli.lista.filter((c) => c.wpp).slice(0, 24);
    if (cs.length < 12) return;
    const ontem = new Date(Date.now() - 864e5).toISOString();
    const MOT = ['sem WhatsApp', 'sem WhatsApp', 'já recebeu em ' + new Date(Date.now() - 5 * 864e5).toLocaleDateString('pt-BR') + ' (campanha Pontos vencendo)', 'sem celular válido', 'mesmo celular de outro cliente que já recebeu'];
    const lista = cs.map((c, k) => {
      const it = { cpf: c.cpf, nome: c.nome, st: 'p' };
      if (k < 8) Object.assign(it, { st: 'e', em: ontem, por: 'robô' });
      else if (k < 8 + MOT.length) Object.assign(it, { st: 'x', em: ontem, por: 'robô', motivo: MOT[k - 8] });
      else if (k === 8 + MOT.length) Object.assign(it, { st: 'o', em: ontem, por: 'robô' });
      return it;
    });
    demo.lista.push({ id: 'demo-exemplo', nome: 'Exemplo: Sentimos sua falta', mensagem: '{saudacao}, {nome}! Faz um tempinho que você não passa na {loja}. Chegaram novidades que têm a sua cara 😊', variacoes: [], limiteDia: 20, janela: 30, recorrente: '', comparar: false, ativa: true, robo: false, filtros: { ausMin: 60 }, criadaEm: ontem, por: 'robô', rodadas: [{ id: 'demo-r1', em: ontem, por: 'robô', lista }] });
  }
  function demoApi(met, url, b) {
    const id = () => Math.random().toString(16).slice(2, 14), agora = new Date().toISOString();
    const m = /\/api\/campanhas(?:\/([^/?]+))?(?:\/(\w+))?/.exec(url);
    const c = m[1] && demo.lista.find((x) => x.id === m[1]);
    if (met === 'GET') { semearDemo(); return { campanhas: demo.lista.slice() }; }
    const sep = (cid, l, ligado, tamanho) => TS.campRetorno.separar(l.map((x) => ({ ...x, st: 'p' })), cid, { ligado, em: agora, tamanho });
    if (met === 'POST' && !m[1]) { const cid = id(), comparar = b.comparar !== false; const n = { id: cid, nome: b.nome, mensagem: b.mensagem, porMotivo: b.porMotivo, limiteDia: b.limiteDia, janela: b.janela, recorrente: b.recorrente, comparar, ativa: true, filtros: b.filtros, criadaEm: agora, por: 'você', rodadas: [{ id: id(), em: agora, lista: sep(cid, b.lista, comparar) }] }; demo.lista.unshift(n); return { campanha: n }; }
    if (met === 'PUT' && !m[2]) { const { loja, ...resto } = b; Object.assign(c, resto); const fora = new Set((c.filtros && c.filtros.fora) || []); if (fora.size) for (const r of c.rodadas || []) r.lista = r.lista.filter((x) => !(x.st === 'p' && fora.has(x.cpf))); return { campanha: c }; }
    if (met === 'PUT' && m[2] === 'rodadas') { const r = c.rodadas[0]; const feitos = r.lista.filter((x) => x.st !== 'p'); const ja = new Set(feitos.map((x) => x.cpf)); const novos = b.lista.filter((x) => !ja.has(x.cpf)); r.lista = [...feitos, ...sep(c.id, novos, c.comparar === true, feitos.length + novos.length)]; return { campanha: c }; }
    if (m[2] === 'rodadas') { c.rodadas.unshift({ id: id(), em: agora, lista: sep(c.id, b.lista, c.comparar === true) }); return { campanha: c }; }
    if (m[2] === 'marcar') { const it = c.rodadas.find((r) => r.id === b.rodada).lista.find((x) => x.cpf === b.cpf); it.st = b.st; if (b.st === 'p') { delete it.em; delete it.por; } else { it.em = agora; it.por = 'você'; } return { item: { ...it } }; } // cópia: quem chama limpa o item antes de aplicar a resposta
    if (met === 'DELETE') { demo.lista = demo.lista.filter((x) => x !== c); return { ok: true }; }
    return {};
  }
  const qs = () => 'loja=' + encodeURIComponent(state.loja);
  const por = (el, ...xs) => el.replaceChildren(...xs.filter((x) => x != null && x !== false));

  // ---------- critérios ----------
  const SEGS = [['vip', 'VIP'], ['fiel', 'Fiéis'], ['sumido', 'Sumidos'], ['repor', 'Hora de repor'], ['vence', 'Pontos vencendo'], ['novo', 'Novos do mês'], ['uma', 'Uma compra só']];
  const BASE_INTEIRA = 0.3; // acima disto da base com celular, a campanha avisa (decisão do dono)
  const PADRAO = { ptsMin: '', ptsMax: '', venceDias: '', produto: '', produtos: [], grupo: '', compraDias: '', compraVezes: '', ausMin: '', ausMax: '', visMin: '', visMax: '', aniv: '', segs: [], rfm: [], tipos: [], vendedora: '', lojaPref: '', semContato: 30 };
  // tipo de chá pela família do grupo de venda: "CHÁ PRETO AROMATIZADO" e "CHÁ PRETO PURO" → "Chá preto"
  const NAO_TIPO = /ACESS|ENVASAD|ALIMENT|TEA ROOM|TEA MOMENT|CONSUM|MATERIA|SACH|FIDELIDADE|KIT|PRESENTE|EMBALA|LATA|MINITIN|ESPA[ÇC]O GOURMET|COSM/i;
  /** nomes dos motivos do Resumo diário (os mesmos da tela Clientes → Hoje) */
  const NOME_MOTIVO = { validade: '🍃 Chá dele perto da validade', vence: '★ Pontos vencendo', repor: '🍵 Hora de repor', aniv: '🎂 Aniversário', naoperder: '🚨 Não pode perder', risco: '⚠️ Em risco', atencao: '👀 Precisa de atenção' };
  const familiaCha = (g) => { const x = String(g || '').toUpperCase().replace(/\s+(AROMATIZADO|PURO)S?$/, '').trim(); return x && !NAO_TIPO.test(x) ? x.charAt(0) + x.slice(1).toLowerCase().replace(/\bchá\b/g, 'Chá') : ''; };
  /** famílias de chá que o cliente já comprou (guardado no cliente) */
  const familiasDe = (c) => {
    if (c._fams) return c._fams;
    const db = TS.db, fs = new Set();
    for (const k of c.cupons || []) for (const i of k.itens || []) { const f = familiaCha(db.D.grupo[db.grupo[i]]); if (f) fs.add(f); }
    return (c._fams = fs);
  };
  const num = (v) => (v === '' || v == null || Number.isNaN(+v) ? null : +v);

  /** clientes que atendem aos critérios: só com celular e sem "não quer mensagens" */
  function selecionar(f) {
    const db = TS.db, hoje = dia();
    const lp = listaProdutos(f);
    const grupoId = f.grupo ? db.D.grupoC.indexOf(f.grupo) : -1;
    if (f.grupo && grupoId < 0) return []; // grupo que não existe mais nas vendas: ninguém (antes o filtro era ignorado e entrava todo mundo)
    const desde = num(f.compraDias) != null ? hoje - num(f.compraDias) : -Infinity;
    const fora = new Set(Array.isArray(f.fora) ? f.fora : []); // tirados à mão da campanha (pedido do dono): nunca entram
    let prodOk = null;
    if (lp.length) {
      const exatos = new Set(lp.filter((x) => !x.contem).map((x) => TS.norm(x.t))), partes = lp.filter((x) => x.contem).map((x) => TS.norm(x.t));
      prodOk = new Uint8Array(db.D.descricao.length);
      db.D.descricao.forEach((t, i) => { const n = TS.norm(t); if (exatos.has(n) || partes.some((q) => n.includes(q))) prodOk[i] = 1; });
    }
    const mesHoje = +TS.hojeSP().slice(5, 7); // mês de Brasília (a mesma conta roda no servidor, que pode estar em outro fuso)
    const mesAniv = f.aniv === 'atual' ? mesHoje : f.aniv === 'proximo' ? (mesHoje % 12) + 1 : num(f.aniv);
    const out = [];
    for (const c of A().universo()) {
      if (!c.wpp || fora.has(c.cpf)) continue;
      const ct = A().contatoDe(c);
      if (ct && ct.optout) continue;
      const semC = Math.max(num(f.semContato) || 0, A().intervalo ? A().intervalo() : 21); // nunca menos que o intervalo da loja
      if (ct && ct.em && Date.now() - Date.parse(ct.em) < semC * 864e5) continue;
      const saldo = c.fx ? c.fx.saldo || 0 : 0;
      if (num(f.ptsMin) != null && saldo < num(f.ptsMin)) continue;
      if (num(f.ptsMax) != null && saldo > num(f.ptsMax)) continue;
      if (num(f.venceDias) != null && !(c.fx && c.fx.prox != null && c.fx.prox <= hoje + num(f.venceDias) && c.fx.proxPts > 0)) continue;
      if (num(f.ausMin) != null && !(c.ausencia != null && c.ausencia >= num(f.ausMin))) continue;
      if (num(f.ausMax) != null && !(c.ausencia != null && c.ausencia <= num(f.ausMax))) continue;
      if (num(f.visMin) != null && (c.visitas || 0) < num(f.visMin)) continue;
      if (num(f.visMax) != null && (c.visitas || 0) > num(f.visMax)) continue;
      if (mesAniv && !(c.nascimento && +c.nascimento.slice(5, 7) === mesAniv && !TS.nomeMsgDe(c))) continue; // o WhatsApp é de outra pessoa: o aniversário não é dela
      if (f.segs && f.segs.length && !f.segs.some((t) => c.tags && c.tags.has(t))) continue;
      if (f.rfm && f.rfm.length && !(c.rfm && f.rfm.includes(c.rfm.g))) continue;
      if (f.tipos && f.tipos.length && !f.tipos.some((t) => familiasDe(c).has(t))) continue;
      if (f.vendedora && c.vendedora !== f.vendedora) continue;
      if (f.lojaPref) {
        const pr = TS.lojasDoCliente(c).pref;
        if (!pr) continue;
        if (f.lojaPref === 'nossa' ? !pr.nossa : f.lojaPref === 'outra' ? pr.nossa : pr.nome !== f.lojaPref) continue;
      }
      let qProd = null;
      if (prodOk || grupoId >= 0) {
        qProd = 0;
        let vezes = 0; // compras (cupons) em que o produto apareceu: dois pacotes no mesmo cupom contam uma compra
        for (const k of c.cupons) { if (k.day < desde) continue; let teve = false; for (const i of k.itens) if ((!prodOk || prodOk[db.desc[i]]) && (grupoId < 0 || db.grupoC[i] === grupoId)) { qProd++; teve = true; } if (teve) vezes++; }
        if (!qProd) continue;
        if (num(f.compraVezes) != null && vezes < num(f.compraVezes)) continue;
      } else if (num(f.compraDias) != null && !c.cupons.some((k) => k.day >= desde)) continue;
      out.push({ c, saldo, qProd });
    }
    return out.sort((a, b) => b.saldo - a.saldo || (a.c.nome || '').localeCompare(b.c.nome || '', 'pt-BR'));
  }
  const clienteDe = (cpf) => A().universo().find((c) => c.cpf === cpf) || { cpf, nome: '', cupons: [], tags: new Set() };
  // produtos do filtro, {produto} da mensagem, rodízio das variações e quem sai da fila: iguais na tela e no robô (msgwpp.js)
  const { listaProdutos, extras } = TS.msgWpp;

  // ---------- página ----------
  TS.pages.campanhas = function (root) {
    root.append(TS.subClientes('campanhas'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Campanhas'),
      h('div', { class: 'page-sub' }, 'Monte uma lista de clientes, escreva a mensagem e envie pelo WhatsApp da loja, um por um. Depois veja quem voltou a comprar.'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'As campanhas são de cada loja: escolha uma loja no seletor do topo.')); return; }
    if (!TS.cli || !TS.cliApi) { root.append(h('div', { class: 'notice' }, 'Os clientes ainda não foram carregados.')); return; }
    A().carregarContatos();
    const corpo = h('div', null, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Carregando as campanhas…'))));
    root.append(corpo);
    api('GET', '/api/campanhas?' + qs()).then(async (j) => {
      const lista = j.campanhas || [];
      lista.copias = j.copias || [];
      const novas = await rodadasRecorrentes(lista);
      if (!corpo.isConnected) return;
      // faixa do robô do WhatsApp (fica acima da lista e da campanha aberta)
      // 2ª passada: o herói do robô também mostra as "Não enviadas" (o mesmo número da aba) e leva até elas
      if (TS.zapFaixa) {
        faixaRobo = TS.zapFaixa(state.loja, () => lista.some((c) => c.robo), () => ({
          n: lista.reduce((n, c) => n + naoEnviadasDe(c).length, 0),
          abrir: () => { state.cpNE = { mot: '', camp: '' }; state.cpVisao = 'naoenv'; pintarLista(corpo, lista, []); corpo.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
        }));
        corpo.before(faixaRobo);
      }
      pintarLista(corpo, lista, novas);
      prepararRobo(lista.filter((c) => c.robo && c.ativa !== false)).catch(() => null);
      // vinda de Estoque → Validade: a campanha já montada para quem comprou o chá perto de vencer
      if (TS.campanhaPronta) { const b = TS.campanhaPronta; TS.campanhaPronta = null; criar(corpo, lista, b); }
      // vinda de Clientes → Hoje: abre a Campanha Resumo diário (ou o formulário para criar)
      if (TS.abrirResumo) { TS.abrirResumo = false; const rc = resumoDe(lista); if (rc) abrirCampanha(corpo, lista, rc); else editarResumo(corpo, lista, null); }
    }).catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  };

  // ---------- robô do WhatsApp: a lista conferida que o servidor usa para montar o mesmo texto do envio manual ----------
  let faixaRobo = null;
  /** a "lista conferida" de uma campanha — para cada pendente: o número (o do link do envio manual), os valores dos
   *  {campos} e se a mensagem ofereceria produto sem estoque. `disp` = leitura do estoque (TS.estoqueDisp) ou null. */
  function itensPreparo(camp, disp, porCpf) {
    const r = camp.rodadas && camp.rodadas[0];
    if (!r) return [];
    porCpf = porCpf || new Map(A().universo().map((c) => [c.cpf, c]));
    const prods = listaProdutos(camp.filtros || {}).filter((x) => !x.contem).map((x) => x.t);
    const itens = [];
    for (const it of r.lista) {
      if (it.st !== 'p') continue;
      const c = porCpf.get(it.cpf);
      if (!c) continue; // cliente fora dos dados carregados agora: o robô espera a próxima conferência
      const textos = TS.msgWpp.textosDe(camp, it); // Resumo diário: o texto do motivo do cliente
      const ext = { produtos: prods, chaoferta: it.o || undefined };
      const oferece = TS.produtosDaMensagem ? textos.some((t) => TS.produtosDaMensagem(t, c, ext).length) : false;
      const falta = disp && TS.semEstoqueNaMensagem ? textos.map((t) => TS.semEstoqueNaMensagem(disp, t, c, ext)).find(Boolean) : null;
      itens.push({ cpf: it.cpf, para: TS.msgWpp.paraDoLink(c.wpp), v: { ...A().valores(c), chaoferta: it.o || c.chaFavorito || 'chá' }, espera: falta || (oferece && !disp ? 'estoque não conferido' : undefined) });
    }
    return itens;
  }
  /** quem entra na lista de uma campanha com estes critérios (o que vai gravado na rodada) */
  const listaDe = (filtros) => selecionar({ ...PADRAO, ...filtros }).map(({ c }) => ({ cpf: c.cpf, nome: c.nome }));
  /**
   * Campanha Resumo diário: a lista de Clientes → Hoje (a mesma conta, TS.cliApi.hojeItens), só com os motivos escolhidos;
   * cada cliente entra uma vez, pelo motivo mais importante dele (ordem de TS.msgWpp.MOTIVOS_RESUMO).
   */
  function listaResumo(filtros, val, disp) {
    const quer = new Set((filtros && filtros.resumo) || []);
    const ordem = TS.msgWpp.MOTIVOS_RESUMO.filter((m) => quer.has(m));
    const out = [];
    const fora = new Set((filtros && filtros.fora) || []);
    for (const x of A().hojeItens(val, disp).itens) {
      if (fora.has(x.c.cpf)) continue; // tirado à mão da campanha
      const m = ordem.find((k) => x.ms.includes(k));
      if (m) out.push({ cpf: x.c.cpf, nome: x.c.nome, m, ...(m === 'validade' && x.oferta ? { o: x.oferta } : {}) });
    }
    return out;
  }
  /** a lista de uma campanha agora (o Resumo diário lê a validade e o estoque da loja antes) */
  async function listaAgora(filtros, loja) {
    if (!(filtros && Array.isArray(filtros.resumo))) return listaDe(filtros);
    const val = TS.validade ? await TS.validade.dados(loja).catch(() => null) : null;
    const disp = TS.estoqueDisp ? await TS.estoqueDisp(loja).catch(() => null) : null;
    return listaResumo(filtros, val, disp);
  }
  // As contas acima são as mesmas que o servidor roda sozinho, todo dia, para o robô (src/zapauto.js carrega
  // ESTE arquivo): mudou aqui, mudou lá. Não copie a regra para outro lugar.
  TS.campanhasCalc = { listaDe, listaResumo, listaAgora, itensPreparo };
  /** para a tela Clientes → Hoje: a Campanha Resumo diário da loja (ou null) e quem o robô manda hoje (pendentes da lista de hoje,
   *  só com a campanha ativa e marcada para o robô) */
  TS.resumoDoDia = async function (loja) {
    const j = await api('GET', '/api/campanhas?loja=' + encodeURIComponent(loja));
    const camp = resumoDe(j.campanhas || []);
    if (!camp) return null;
    const r = camp.rodadas[0];
    const hoje = r && new Date(r.em).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) === TS.hojeSP();
    const robo = camp.robo === true && camp.ativa !== false;
    const de = (st) => new Set(hoje && robo ? r.lista.filter((x) => x.st === st).map((x) => x.cpf) : []);
    return { camp, robo, pendentes: de('p'), comparacao: de('c') }; // comparação: sorteados para ficar sem mensagem (medir o efeito)
  };
  /** manda a lista conferida ao abrir a tela, ao abrir a campanha e ao ligar o robô na campanha */
  async function prepararRobo(camps, dispLido) {
    if (TS.demo || !TS.zapPreparar || !camps.length) return;
    let disp = dispLido || null;
    if (!disp && TS.estoqueDisp) { try { disp = await TS.estoqueDisp(state.loja); } catch { /* sem leitura do estoque: quem receberia oferta de produto espera */ } }
    const porCpf = new Map(A().universo().map((c) => [c.cpf, c]));
    for (const camp of camps) {
      if (!camp.rodadas[0]) continue;
      await TS.zapPreparar(state.loja, camp.id, itensPreparo(camp, disp, porCpf));
    }
    if (faixaRobo && faixaRobo.atualizar) faixaRobo.atualizar();
  }

  /** etiqueta do período da campanha: "começa em", "terminou em" ou "até dd/mm" */
  const periodoTag = (c) => {
    if (!c.inicio && !c.fim) return null;
    const f = TS.msgWpp.foraDoPeriodo(c, TS.hojeSP());
    const d = (iso) => fmt.date(iso).slice(0, 5);
    return h('span', { class: 'badge ' + (f ? 'cinza' : 'ok'), title: `Período da campanha: ${c.inicio ? 'de ' + fmt.date(c.inicio) : 'já começou'}${c.fim ? ' até ' + fmt.date(c.fim) : ', sem data para acabar'}. Fora dele nada é enviado.` },
      f === 'antes' ? `começa em ${d(c.inicio)}` : f === 'depois' ? `terminou em ${d(c.fim)}` : c.fim ? `até ${d(c.fim)}` : `desde ${d(c.inicio)}`);
  };
  /** campanha recorrente: diária = uma lista nova por dia; semanal = a cada 7 dias; mensal = uma por mês */
  async function rodadasRecorrentes(lista) {
    const feitas = [];
    for (const c of lista) {
      if (!c.recorrente || c.ativa === false) continue;
      const ult = c.rodadas[0] && new Date(c.rodadas[0].em);
      const agora = new Date();
      const diaBR = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const vence = !ult || (c.recorrente === 'diaria' ? diaBR(agora) > diaBR(ult) : c.recorrente === 'semanal' ? agora - ult >= 7 * 864e5 : agora.getFullYear() * 12 + agora.getMonth() > ult.getFullYear() * 12 + ult.getMonth());
      if (!vence) continue;
      try { const r = await api('POST', `/api/campanhas/${c.id}/rodadas`, { loja: state.loja, lista: await listaAgora(c.filtros, state.loja) }); Object.assign(c, r.campanha); if (!r.repetida) feitas.push(c.nome); } catch { /* tenta de novo na próxima vez */ }
    }
    return feitas;
  }

  /** retorno: quem comprou DEPOIS do envio (do dia seguinte até N dias depois; cupons com CPF). A conta é a de campretorno.js */
  const cuponsDe = (cpf) => { const c = TS.cli.porCPF && TS.cli.porCPF.get(cpf); return c ? c.cupons : []; };
  const retorno = (item, janela) => TS.campRetorno.retornoItem(item, cuponsDe(item.cpf), janela, dia());
  const pctVoltou = (g) => (g.taxa == null ? '—' : fmt.pct(g.taxa, 0));
  /** retorno por variação da mensagem: enviadas, voltaram e faturamento de cada uma */
  function cartaoVariacoes(r, camp, textos) {
    const linhas = textos.map((t, k) => {
      const g = TS.campRetorno.resumo(r.lista, cuponsDe, camp.janela, dia(), (x) => x.st === 'e' && x.v === k).rec;
      return { k: k + 1, texto: t, env: g.n, fech: g.fechados, volt: g.voltFech, pct: g.taxa, vt: g.vt, aberto: g.abertos };
    });
    const melhor = linhas.filter((l) => l.fech >= 10).sort((a, b) => b.pct - a.pct)[0];
    return TS.card('Retorno por variação', `Cada cliente recebeu uma versão da mensagem · o % conta só quem já teve o prazo inteiro · com menos de 10 por variação a diferença ainda é sorte`, TS.table({
      cols: [
        { key: 'k', label: 'Variação', align: 'l', render: (l) => h('span', null, `${l.k}`, melhor && melhor.k === l.k ? h('span', { class: 'cli-tag t-repor' }, ' melhor até agora') : null) },
        { key: 'texto', label: 'Mensagem', align: 'l', render: (l) => h('small', { class: 'cp-var-txt' }, l.texto.length > 110 ? l.texto.slice(0, 110) + '…' : l.texto) },
        { key: 'env', label: 'Enviadas', fmt: fmt.int }, { key: 'pct', label: 'Voltaram', title: 'Voltaram ÷ enviadas cujo prazo já fechou (compra do dia seguinte ao envio em diante). Entre parênteses: quantos voltaram de quantos já fecharam. "poucos dados" = menos de 10 com o prazo fechado.', render: (l) => (l.pct == null ? h('span', { class: 'muted' }, l.aberto ? 'ainda no prazo' : '—') : h('span', null, `${fmt.pct(l.pct, 0)} (${fmt.int(l.volt)} de ${fmt.int(l.fech)})`, l.fech < 10 ? h('small', { class: 'muted' }, ' poucos dados') : null)), sortVal: (l) => l.pct ?? -1 },
        { key: 'vt', label: 'Faturamento', fmt: fmt.brl0 },
      ], rows: linhas, sortKey: 'k', sortDir: 'asc',
    }));
  }
  /** resumo da lista: a conta de campretorno.js (rec = quem recebeu; ctl = grupo de comparação; efeito = a diferença) */
  const resumoRodada = (r, janela) => TS.campRetorno.resumo(r.lista, cuponsDe, janela, dia());
  /** cartão "Efeito da campanha": quem recebeu × quem não recebeu, na mesma janela */
  function cartaoEfeito(s, camp) {
    const R = TS.campRetorno, e = s.efeito;
    if (!s.comp) return h('div', { class: 'muted cp-semcomp' }, h('b', null, 'Sem comparação: '), 'parte destes clientes voltaria de qualquer jeito, com ou sem mensagem. ',
      TS.dica(`Esta lista não tem grupo de comparação${camp.comparar ? ` (ela tem menos de ${R.MIN_LISTA} clientes)` : ''}. Para medir o efeito de verdade, marque "Guardar ${R.PCT}% da lista sem mensagem para comparar" em "Editar campanha": vale nas próximas listas com ${R.MIN_LISTA} clientes ou mais.`));
    const pp = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt.n1(Math.abs(v) * 100)} p.p.`;
    const rs = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt.brl(Math.abs(v))}`;
    const linha = (nome, g, det) => ({ nome, det, n: `${fmt.int(g.fechados)}${g.abertos ? ` (+${fmt.int(g.abertos)} no prazo)` : ''}`, taxa: g.taxa == null ? '—' : `${fmt.pct(g.taxa)} (${fmt.int(g.voltFech)} de ${fmt.int(g.fechados)})`, gasto: g.gasto == null ? '—' : fmt.brl(g.gasto) });
    const rows = [linha('Receberam a mensagem', s.rec, 'enviadas'), linha('Não receberam', s.ctl, `grupo de comparação · ${R.PCT}% da lista, por sorteio`)];
    if (e) rows.push({ nome: 'Efeito da campanha', det: 'receberam − não receberam', forte: true, n: '', taxa: pp(e.taxa), gasto: rs(e.gasto), cls: e.poucos ? '' : e.gasto > 0 ? 'pos' : e.gasto < 0 ? 'neg' : '' });
    const aviso = !e ? h('div', { class: 'muted' }, 'Ainda não dá para comparar: falta fechar o prazo de retorno dos dois grupos.')
      : e.poucos ? h('div', { class: 'notice' }, h('b', null, 'Poucos dados: '), `com menos de ${R.MIN_GRUPO} clientes de prazo fechado em cada grupo, a diferença ainda pode ser sorte. Leia como tendência, não como resultado.`)
        : h('div', { class: e.vendasAMais > 0 ? 'notice ok' : 'notice' }, e.vendasAMais > 0 ? h('span', null, 'A campanha trouxe cerca de ', h('b', null, fmt.brl0(e.vendasAMais)), ` a mais do que estes ${fmt.int(s.rec.fechados)} clientes comprariam sem a mensagem.`) : 'Quem recebeu a mensagem não comprou mais do que quem não recebeu: nesta lista a campanha não mostrou efeito.');
    return TS.card('Efeito da campanha', `Quem recebeu × quem ficou sem mensagem, nos mesmos ${camp.janela} dias. Só entra quem já teve o prazo inteiro.`, aviso, TS.table({
      cols: [
        { key: 'nome', label: 'Grupo', align: 'l', wrap: true, render: (x) => h('span', null, h('b', null, x.nome), x.det ? h('small', { class: 'muted cp-cel' }, x.det) : null) },
        { key: 'n', label: 'Clientes com prazo fechado', title: `Clientes cujo prazo de ${camp.janela} dias já acabou. Para quem recebeu, o prazo conta do dia do envio; para o grupo de comparação, do dia em que a lista foi criada. "no prazo" = ainda podem voltar (não entram no %).` },
        { key: 'taxa', label: 'Voltaram', title: `Compraram (cupom com CPF) do dia seguinte até ${camp.janela} dias depois ÷ clientes com prazo fechado. Na linha do efeito: a diferença, em pontos percentuais (p.p.).`, render: (x) => (x.forte ? h('b', { class: x.cls }, x.taxa) : x.taxa) },
        { key: 'gasto', label: 'Gasto médio por cliente', title: 'Soma das compras no prazo ÷ todos os clientes do grupo com prazo fechado (quem não voltou conta como R$ 0). Na linha do efeito: quanto cada cliente que recebeu gastou a mais do que quem não recebeu. Efeito × clientes que receberam = vendas a mais estimadas.', render: (x) => (x.forte ? h('b', { class: x.cls }, x.gasto) : x.gasto) },
      ], rows, cartao: true,
    }));
  }

  /** a mensagem deste cliente ofereceria produto sem estoque? → o que falta (texto) ou null. A mesma conta da fila e da aba "Não enviadas" */
  function faltaEstoqueDe(camp, disp) {
    const prodsCamp = listaProdutos(camp.filtros || {}).filter((x) => !x.contem).map((x) => x.t);
    return (it) => { const c = clienteDe(it.cpf); for (const t of TS.msgWpp.textosDe(camp, it)) { const f = TS.semEstoqueNaMensagem ? TS.semEstoqueNaMensagem(disp, t, c, { produtos: prodsCamp, chaoferta: it.o || undefined }) : null; if (f) return f; } return null; };
  }

  // ---------- "Não enviadas" (pedido do dono): quem ficou sem a mensagem em todas as campanhas, com o motivo ----------
  const MOT_NE = [['semwpp', 'Sem WhatsApp', 'O número do cadastro não tem WhatsApp (o robô tentou e o WhatsApp recusou). Corrija o celular no FIXE ou, se o cliente escreveu de outro número, vincule a conversa ao cliente em Clientes → Conversas; depois "Voltar para a fila".'],
    ['recebeu', 'Já recebeu', 'Recebeu mensagem (desta ou de outra campanha, ou pelo painel) dentro do intervalo da loja, ou o mesmo celular já recebeu por outro cliente. Volta sozinho na próxima lista depois do intervalo; "Voltar para a fila" libera o prazo maior pedido pela campanha, nunca o intervalo da loja.'],
    ['naoquer', 'Não quer', 'Pediu para não receber mensagens (pela fila, pela ficha ou respondeu "parar" ao robô). Só volta se alguém marcar "Voltou a aceitar" na ficha do cliente.'],
    ['semcel', 'Sem celular', 'O cadastro não tem um celular válido (DDD + número). Corrija no FIXE.'],
    ['estoque', 'Esperando estoque', 'Continuam na fila, mas a mensagem ofereceria um produto sem estoque (no chá a granel, menos de 100 g). Entram sozinhos quando chegar a nota de entrada.'],
    ['outros', 'Outros', 'Puladas à mão na fila (com o motivo escrito) ou por outro motivo.']];
  const motivoNE = (it) => {
    if (it.st === 'o') return 'naoquer';
    const m = String(it.motivo || '').toLowerCase();
    if (/whatsapp/.test(m)) return 'semwpp';
    if (/já recebeu|mesmo celular/.test(m)) return 'recebeu';
    if (/não quer/.test(m)) return 'naoquer';
    if (/celular válido|sem celular/.test(m)) return 'semcel';
    return 'outros';
  };
  /** puladas + não quer da lista atual de cada campanha (o que a tela já tem; a lista antiga de uma recorrente não entra) */
  const naoEnviadasDe = (c) => (c.rodadas && c.rodadas[0] ? c.rodadas[0].lista.filter((it) => it.st === 'x' || it.st === 'o') : []);
  async function pintarNaoEnviadas(box, corpo, lista) {
    if (!box.firstChild) box.append(h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Juntando as não enviadas…'))));
    let disp = null;
    if (TS.estoqueDisp) { try { disp = await TS.estoqueDisp(state.loja); } catch { /* sem leitura do estoque: a aba "Esperando estoque" fica vazia */ } }
    if (!box.isConnected) return;
    const linhas = [];
    for (const c of lista) {
      const r = c.rodadas && c.rodadas[0];
      if (!r) continue;
      for (const it of naoEnviadasDe(c)) linhas.push({ c, r, it, mot: motivoNE(it) });
      if (disp) { const falta = faltaEstoqueDe(c, disp); for (const it of r.lista) if (it.st === 'p') { const f = falta(it); if (f) linhas.push({ c, r, it, mot: 'estoque', falta: f }); } }
    }
    const rows = linhas.map((x) => { const cl = clienteDe(x.it.cpf); return { ...x, cpf: x.it.cpf, nome: x.it.nome || cl.nome || '—', cel: A().fmtTel(cl.celular) || '—', camp: x.c.nome, motivo: x.mot === 'estoque' ? `esperando estoque (${x.falta})` : x.it.st === 'o' ? 'não quer mensagens' : x.it.motivo || 'pulada', em: x.it.em ? isoDia(x.it.em) : null, por: x.it.por || '' }; });
    const f = state.cpNE || (state.cpNE = { mot: '', camp: '' });
    const camps = [...new Set(rows.map((x) => x.camp))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (f.camp && !camps.includes(f.camp)) f.camp = '';
    const daCamp = (x) => !f.camp || x.camp === f.camp;
    const repintar = () => pintarNaoEnviadas(box, corpo, lista);
    const voltar = async (x, bt) => {
      bt.disabled = true;
      try {
        const y = await api('POST', `/api/campanhas/${x.c.id}/marcar`, { loja: state.loja, rodada: x.r.id, cpf: x.it.cpf, st: 'p', motivo: x.it.motivo ? 'liberado' : null });
        for (const k of ['em', 'por', 'motivo', 'liberado', 'v']) delete x.it[k];
        Object.assign(x.it, y.item);
        pintarLista(corpo, lista, []); // a aba de cima (Não enviadas (N)) e a tabela da campanha mudam junto
      } catch (e) { bt.disabled = false; if (TS.avisarErro) TS.avisarErro(e); else alert(e.message); }
    };
    const conta = (k) => rows.filter((x) => x.mot === k && daCamp(x)).length;
    const abas = TS.seg([[`Todas (${fmt.int(rows.filter(daCamp).length)})`, '', 'Todas as não enviadas da lista atual de cada campanha.'], ...MOT_NE.map(([k, nome, dica]) => [`${nome} (${fmt.int(conta(k))})`, k, dica])], f.mot, (v) => { f.mot = v; repintar(); });
    const selCamp = h('select', { class: 'f-input cp-ne-camp', 'aria-label': 'Campanha' }, h('option', { value: '' }, 'Todas as campanhas'), ...camps.map((n) => h('option', { value: n, selected: f.camp === n || null }, n)));
    selCamp.addEventListener('change', () => { f.camp = selCamp.value; repintar(); });
    const tab = TS.table({
      cols: [
        { key: 'nome', label: 'Cliente', align: 'l', wrap: true, sticky: true, render: (x) => h('span', null, h('b', null, x.nome), h('small', { class: 'muted cp-cel' }, x.cel)) },
        { key: 'camp', label: 'Campanha', align: 'l', wrap: true },
        { key: 'motivo', label: 'Motivo', align: 'l', wrap: true, title: 'O motivo gravado quando o cliente saiu da fila (pelo robô 🤖 ou por quem enviava à mão).', render: (x) => { const nome = (MOT_NE.find((m) => m[0] === x.mot) || [])[1]; const repete = TS.norm(x.motivo).startsWith(TS.norm(nome || '')) || (x.mot === 'naoquer' && /não quer/i.test(x.motivo)); return h('span', null, TS.etqPrazo(x.mot === 'naoquer' ? 'agora' : x.mot === 'semwpp' || x.mot === 'semcel' ? 'semana' : 'saber', nome), repete ? null : h('small', { class: 'muted cp-cel' }, x.motivo)); } },
        { key: 'em', label: 'Quando', align: 'l', title: 'Dia em que saiu da fila e quem tirou (🤖 = o robô).', render: (x) => (x.em != null ? h('span', null, fmt.date(TS.dayToIso(x.em)), x.por ? h('small', { class: 'muted cp-cel' }, x.por === 'robô' ? '🤖 robô' : x.por) : null) : '—'), sortVal: (x) => x.em ?? -1 },
        { key: 'acao', label: '', align: 'l', render: (x) => h('span', { class: 'cp-ne-acoes' },
          x.mot !== 'estoque' ? h('button', { type: 'button', class: 'btn', onclick: (e) => { e.stopPropagation(); voltar(x, e.currentTarget); } }, 'Voltar para a fila') : null,
          h('button', { type: 'button', class: 'btn', onclick: (e) => { e.stopPropagation(); A().abrirClientes([x.cpf]); } }, 'Ver cliente'),
          x.mot === 'semwpp' ? TS.dica('Para corrigir: troque o celular no FIXE ou, se o cliente escreveu de outro número, abra a conversa em Clientes → Conversas e use "Vincular a um cliente". Depois toque em "Voltar para a fila".') : null), sortVal: () => 0 },
      ],
      rows: rows.filter((x) => (!f.mot || x.mot === f.mot) && daCamp(x)), sortKey: 'em', sortDir: 'desc', cartao: true, searchKeys: ['nome', 'cel', 'camp', 'motivo'],
      empty: 'Nenhuma mensagem deixou de sair por esse motivo. 👏',
    });
    box.replaceChildren(TS.cardWithTools(h('span', null, 'Não enviadas', TS.dica('Clientes da lista ATUAL de cada campanha que saíram da fila sem receber (puladas e "não quer") e os que esperam estoque. A lista antiga de uma campanha que se repete não entra. "Voltar para a fila" é a mesma ação da lista da campanha: o intervalo da loja e o "não quer" continuam valendo.')), 'Quem ficou sem a mensagem e por quê', h('div', { class: 'cp-ne-ferr' }, selCamp, tab.searchBox),
      abas, tab));
  }

  function pintarLista(corpo, lista, novas) {
    // redesenho (decisão do dono, 22/11/2026): as campanhas numa tabela escaneável (uma linha por campanha), não cartões com mini-quadros
    const etiquetas = (c) => [periodoTag(c), c.recorrente ? h('span', { class: 'cli-tag t-repor' }, c.recorrente === 'diaria' ? 'todo dia' : c.recorrente === 'semanal' ? 'toda semana' : 'todo mês') : null, c.robo ? h('span', { class: 'cli-tag', title: 'Enviada pelo robô do WhatsApp' }, '🤖 robô') : null, c.ativa === false ? h('span', { class: 'cli-tag' }, 'pausada') : null].filter(Boolean);
    const rowsC = lista.map((c) => {
      const r = c.rodadas[0], s = resumoRodada(r, c.janela);
      const quem = s.total - s.comp;
      return { c, r, s, nome: c.nome, total: s.total, env: s.env, pend: s.pend, naoenv: naoEnviadasDe(c).length, voltou: s.rec.taxa == null ? -1 : s.rec.taxa, prog: quem ? (s.env + s.opt) / quem : 0, em: r.em.slice(0, 10) };
    });
    const tabC = rowsC.length ? TS.table({
      cols: [
        { key: 'nome', label: 'Campanha', align: 'l', wrap: true, sticky: true, render: (x) => h('span', { class: 'cp-lin' }, h('b', null, x.nome), h('span', { class: 'cp-lin-tags' }, ...etiquetas(x.c)),
          h('small', { class: 'muted' }, `${x.c.recorrente ? 'Lista de ' : 'Criada em '}${fmt.date(x.em)} · por ${x.r.por || x.c.por || '—'}`)), sortVal: (x) => x.nome.toLocaleLowerCase('pt-BR') },
        { key: 'total', label: 'Na lista', fmt: fmt.int, title: 'Clientes da lista atual da campanha (com o grupo de comparação, quando houver).' },
        { key: 'env', label: 'Enviadas', title: 'Mensagens enviadas desta lista (pela fila manual ou pelo robô 🤖). A barra mostra quanto da lista já foi resolvido (enviada ou não quer mensagens).',
          render: (x) => h('span', { class: 'cp-env' }, fmt.int(x.env), h('span', { class: 'cp-barra cp-barra-p', 'aria-hidden': 'true' }, h('span', { style: { width: Math.round(x.prog * 100) + '%' } }))) },
        { key: 'pend', label: 'Pendentes', fmt: fmt.int, title: 'Clientes da lista que ainda não receberam (nem saíram da fila).' },
        { key: 'naoenv', label: 'Não enviadas', title: 'Clientes desta lista que saíram da fila sem receber: puladas (sem WhatsApp, já recebeu, sem celular…) e "não quer". Toque no número para ver quem e por quê.',
          render: (x) => (x.naoenv ? h('button', { type: 'button', class: 'link-btn cp-ne-link', title: 'Ver as não enviadas desta campanha', onclick: (e) => { e.stopPropagation(); state.cpNE = { mot: '', camp: x.nome }; state.cpVisao = 'naoenv'; pintarLista(corpo, lista, []); } }, fmt.int(x.naoenv)) : '0') },
        { key: 'voltou', label: 'Voltaram', title: 'Voltaram ÷ enviadas cujo prazo de retorno já fechou (compraram com CPF do dia seguinte ao envio até o prazo da campanha). "ainda no prazo" = ninguém com o prazo fechado ainda.',
          render: (x) => h('span', null, pctVoltou(x.s.rec), h('small', { class: 'muted cp-cel' }, x.s.rec.taxa == null && x.s.rec.abertos ? 'ainda no prazo' : `em ${x.c.janela} dias`)) },
      ],
      rows: rowsC, sortKey: 'em', sortDir: 'desc', cartao: true,
      onRowClick: (x) => abrirCampanha(corpo, lista, x.c),
    }) : null;
    const totNE = lista.reduce((n, c) => n + naoEnviadasDe(c).length, 0);
    if (faixaRobo && faixaRobo.repintar && faixaRobo.isConnected) faixaRobo.repintar(); // "Não enviadas" do herói acompanha a aba
    const visaoSeg = TS.seg([['Campanhas', 'campanhas', 'A lista de campanhas da loja.'], [`Não enviadas (${fmt.int(totNE)})`, 'naoenv', 'Quem ficou sem a mensagem (puladas e "não quer") em todas as campanhas, com o motivo, para consultar e voltar para a fila.']], state.cpVisao === 'naoenv' ? 'naoenv' : 'campanhas', (v) => { state.cpVisao = v; pintarLista(corpo, lista, []); });
    visaoSeg.classList.add('cp-visao');
    const neBox = h('div', { class: 'cp-ne' });
    if (state.cpVisao === 'naoenv') setTimeout(() => pintarNaoEnviadas(neBox, corpo, lista), 0);
    const copias = (lista.copias || []).map((cp) => h('div', { class: 'card cp-recebida' },
      h('div', null, h('b', null, cp.nome), h('small', { class: 'muted' }, ` · copiada de ${cp.deNome || cp.deLoja} por ${cp.por || '—'} em ${fmt.date(cp.em.slice(0, 10))}`),
        h('div', { class: 'muted cp-recebida-msg' }, cp.mensagem.length > 140 ? cp.mensagem.slice(0, 140) + '…' : cp.mensagem)),
      h('div', { class: 'cp-recebida-acoes' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => criar(corpo, lista, { ...cp, copia: cp.id }) }, 'Montar a lista desta loja'),
        h('button', { type: 'button', class: 'btn', onclick: async () => { if (!confirm(`Descartar a campanha "${cp.nome}" recebida de ${cp.deNome || cp.deLoja}?`)) return; try { await api('DELETE', `/api/campanhas/copias/${cp.id}?${qs()}`); lista.copias = lista.copias.filter((x) => x !== cp); pintarLista(corpo, lista, []); } catch (e) { alert(e.message); } } }, 'Descartar'))));
    por(corpo,
      novas.length ? h('div', { class: 'notice' }, `Nova lista criada para: ${novas.join(', ')} (campanha recorrente).`) : null,
      copias.length ? h('div', { class: 'cp-recebidas' }, h('div', { class: 'cp-recebidas-tit' }, h('b', null, `Recebidas de outras lojas (${copias.length})`), h('small', { class: 'muted' }, ' · a mensagem e os critérios vêm prontos; a lista é montada com os clientes desta loja')), ...copias) : null,
      h('div', { class: 'cp-acoes' }, h('button', { type: 'button', class: 'btn primary', onclick: () => criar(corpo, lista) }, '+ Criar campanha'),
        !resumoDe(lista) ? h('button', { type: 'button', class: 'btn', title: 'A lista da tela Clientes → Hoje, todo dia, enviada pelo robô do WhatsApp (uma mensagem por cliente).', onclick: () => editarResumo(corpo, lista, null) }, '🤖 ' + TS.msgWpp.NOME_RESUMO) : null),
      lista.length ? visaoSeg : null,
      lista.length && state.cpVisao === 'naoenv' ? neBox : lista.length ? TS.cardWithTools(h('span', null, `Campanhas (${fmt.int(lista.length)})`, TS.dica('Uma linha por campanha, a mais recente primeiro. "todo dia", "toda semana" e "todo mês" montam uma lista nova a cada período; 🤖 = enviada pelo robô do WhatsApp.')), 'Toque numa campanha para ver a fila, quem recebeu e quem voltou', null, tabC) : TS.card(null, null, TS.empty('Nenhuma campanha ainda. Clique em "Criar campanha" para montar a primeira.')));
  }

  /** escolher as lojas que recebem a campanha (mensagem e critérios; cada loja monta a própria lista) */
  function copiarPara(camp) {
    const outras = (TS.lojas || []).filter((l) => l.id !== state.loja).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const marc = new Set();
    const ok = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Copiar');
    const conta = () => { ok.disabled = !marc.size; ok.textContent = marc.size ? `Copiar para ${marc.size} ${marc.size === 1 ? 'loja' : 'lojas'}` : 'Copiar'; };
    const itens = outras.map((l) => { const cb = h('input', { type: 'checkbox' }); cb.addEventListener('change', () => { if (cb.checked) marc.add(l.id); else marc.delete(l.id); conta(); }); return h('label', { class: 'cp-loja' }, cb, h('span', null, l.nome)); });
    const todas = h('button', { type: 'button', class: 'btn link' }, 'Marcar todas');
    todas.addEventListener('click', () => { const tudo = marc.size < outras.length; itens.forEach((it, k) => { const cb = it.querySelector('input'); cb.checked = tudo; if (tudo) marc.add(outras[k].id); else marc.delete(outras[k].id); }); conta(); });
    const erro = h('div', { class: 'muted' });
    const fundo = h('div', { class: 'cp-modal-bg' });
    const fechar = () => fundo.remove();
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    ok.addEventListener('click', async () => {
      ok.disabled = true; erro.textContent = '';
      try { const r = await api('POST', `/api/campanhas/${camp.id}/copiar`, { loja: state.loja, destinos: [...marc] }); fechar(); const t = h('div', { class: 'toast', role: 'status' }, `Copiada para ${r.destinos.length} ${r.destinos.length === 1 ? 'loja' : 'lojas'}. Lá ela aparece em "Recebidas de outras lojas".`); document.body.append(t); setTimeout(() => t.remove(), 6000); } catch (e) { erro.textContent = e.message; ok.disabled = false; }
    });
    fundo.append(h('div', { class: 'card cp-copiar' },
      h('h3', null, 'Copiar para outra loja'),
      h('p', { class: 'muted' }, `"${camp.nome}" vai com a mensagem e os critérios. Em cada loja, quem abrir Campanhas clica em "Montar a lista desta loja": a lista sai dos clientes de lá.`),
      outras.length > 3 ? todas : null,
      h('div', { class: 'cp-lojas' }, ...itens), erro,
      h('div', { class: 'cp-acoes' }, h('span', { style: { flex: 1 } }), h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Cancelar'), ok)));
    document.body.append(fundo);
  }

  // ---------- Campanha Resumo diário (decisão do dono): a lista de Clientes → Hoje, todo dia, para o robô ----------
  /** textos padrão de cada motivo: começam com a vendedora que mais atende o cliente ({apresentacao}) */
  const TEXTO_RESUMO = {
    validade: 'Oi, {nome}! {apresentacao} 😊 O {chaoferta} que você gosta está com condição especial esta semana. Quer que a gente separe um pacote para você?',
    vence: 'Oi, {nome}! {apresentacao} 😊 Você tem {pontos} pontos no programa de fidelidade, e parte deles vence em {vence}. Que tal usar numa visita? 🍵',
    repor: 'Oi, {nome}! {apresentacao} 😊 Seu {cha} já deve estar acabando. Quer que a gente separe um pacote para você?',
    aniv: 'Oi, {nome}! {apresentacao} 😊 Feliz aniversário! 🎉 Que tal passar na loja esta semana para comemorar com um chá?',
    naoperder: 'Oi, {nome}! {apresentacao} 😊 Faz um tempinho que você não passa na loja. Chegaram novidades que têm a sua cara — vem provar! 🍵',
    risco: 'Oi, {nome}! {apresentacao} 😊 Faz um tempinho que você não passa na loja. Chegaram novidades que têm a sua cara — vem provar! 🍵',
    atencao: 'Oi, {nome}! {apresentacao} 😊 Temos novidades na loja e lembrei de você. Posso te mandar as opções?',
  };
  const DICA_MOTIVO = {
    validade: 'O chá favorito (ou o último) do cliente tem lote vencendo em menos de 60 dias. {chaoferta} = esse chá.',
    vence: 'Parte dos pontos do programa de fidelidade vence logo.',
    repor: 'Pelo ritmo de compra, o chá dele já deve estar acabando.',
    aniv: 'Faz aniversário nos próximos 7 dias.',
    naoperder: 'Estava entre os melhores clientes e parou de vir.',
    risco: 'Cliente bom que está demorando mais que o normal para voltar.',
    atencao: 'Comprava com frequência e começou a espaçar.',
  };
  const resumoDe = (lista) => lista.find((c) => TS.msgWpp.ehResumo(c));
  async function editarResumo(corpo, lista, camp) {
    por(corpo, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Conferindo a lista de hoje…'))));
    const val = TS.validade ? await TS.validade.dados(state.loja).catch(() => null) : null;
    const disp = TS.estoqueDisp ? await TS.estoqueDisp(state.loja).catch(() => null) : null;
    if (!corpo.isConnected) return;
    const todos = listaResumo({ resumo: TS.msgWpp.MOTIVOS_RESUMO }, val, disp);
    const conta = (m) => todos.filter((x) => x.m === m).length;
    const marcados = new Set((camp && camp.filtros.resumo) || TS.msgWpp.RESUMO_PADRAO);
    const textos = {};
    for (const m of TS.msgWpp.MOTIVOS_RESUMO) textos[m] = h('textarea', { class: 'f-input cp-msg', rows: 3, 'aria-label': 'Mensagem: ' + NOME_MOTIVO[m] }, (camp && camp.porMotivo && camp.porMotivo[m]) || TEXTO_RESUMO[m]);
    const limite = h('input', { class: 'f-input', type: 'number', min: 0, max: 500, value: camp && camp.limiteDia != null ? camp.limiteDia : 20, style: { maxWidth: '110px' } });
    const resumoTxt = h('small', { class: 'muted' });
    const linhas = h('div', { class: 'cp-resumo-motivos' });
    const pintarMotivos = () => {
      // quem tem mais de um motivo entra pelo mais importante dos marcados: a conta de verdade é a da lista
      const sel = listaResumo({ resumo: [...marcados] }, val, disp).length;
      resumoTxt.textContent = `Hoje entrariam ${fmt.int(sel)} ${sel === 1 ? 'cliente' : 'clientes'}, uma mensagem para cada.`;
      linhas.replaceChildren(...TS.msgWpp.MOTIVOS_RESUMO.map((m) => {
        const cx = h('input', { type: 'checkbox', checked: marcados.has(m) || null });
        cx.addEventListener('change', () => { cx.checked ? marcados.add(m) : marcados.delete(m); pintarMotivos(); });
        return h('div', { class: 'cp-resumo-mot' + (marcados.has(m) ? ' on' : '') },
          h('label', { class: 'cp-resumo-cab' }, cx, h('b', null, NOME_MOTIVO[m]), h('small', { class: 'muted' }, ` · ${fmt.int(conta(m))} hoje`), TS.dica(DICA_MOTIVO[m])),
          marcados.has(m) ? textos[m] : null);
      }));
    };
    pintarMotivos();
    const salvar = h('button', { type: 'button', class: 'btn primary' }, camp ? 'Salvar' : 'Criar a campanha');
    salvar.addEventListener('click', async () => {
      if (!marcados.size) { TS.avisar('Marque pelo menos um motivo.'); return; }
      const ms = TS.msgWpp.MOTIVOS_RESUMO.filter((m) => marcados.has(m));
      const porMotivo = Object.fromEntries(ms.map((m) => [m, textos[m].value.trim() || TEXTO_RESUMO[m]]));
      const corpoReq = { loja: state.loja, nome: TS.msgWpp.NOME_RESUMO, mensagem: porMotivo[ms[ms.length - 1]], porMotivo, limiteDia: +limite.value || 0, filtros: { resumo: ms } };
      salvar.disabled = true;
      try {
        const nova = listaResumo({ resumo: ms }, val, disp);
        if (camp) {
          const x = await api('PUT', `/api/campanhas/${camp.id}`, corpoReq);
          Object.assign(camp, x.campanha);
          // a lista de hoje acompanha os motivos novos (quem já recebeu continua como está)
          const r = camp.rodadas[0];
          if (r && new Date(r.em).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) === TS.hojeSP()) { const y = await api('PUT', `/api/campanhas/${camp.id}/rodadas/${r.id}`, { loja: state.loja, lista: nova }); Object.assign(camp, y.campanha); }
          abrirCampanha(corpo, lista, camp);
        } else {
          const x = await api('POST', '/api/campanhas', { ...corpoReq, recorrente: 'diaria', janela: 30, comparar: true, lista: nova });
          lista.unshift(x.campanha);
          abrirCampanha(corpo, lista, x.campanha);
        }
      } catch (e) { TS.avisarErro ? TS.avisarErro(e) : alert(e.message); salvar.disabled = false; }
    });
    por(corpo,
      h('div', { class: 'cp-acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => (camp ? abrirCampanha(corpo, lista, camp) : pintarLista(corpo, lista, [])) }, '‹ Voltar')),
      TS.card('🤖 ' + TS.msgWpp.NOME_RESUMO, 'Todo dia, a lista de Clientes → Hoje vira esta campanha: uma mensagem por cliente, pelo motivo mais importante dele, com o nome da vendedora que mais o atende. Valem as mesmas travas de sempre: uma mensagem a cada tantos dias por cliente, quem não quer, e chá sem estoque (no chá a granel, menos de 100 g) não é oferecido.',
        h('div', { class: 'cp-resumo' },
          h('p', { class: 'muted' }, 'Motivos que o robô envia (ordem de importância: o cliente que está em mais de um recebe só a do primeiro). Os não marcados continuam na tela Hoje para a equipe.'),
          linhas, resumoTxt,
          h('label', { class: 'cp-campo' }, h('span', null, 'Máximo de mensagens por dia nesta campanha', TS.dica('Comece baixo (15 a 20) e suba aos poucos: mais mensagens automáticas aumentam o risco de o WhatsApp restringir o número da loja. O robô também respeita o máximo por dia do número.')), limite),
          h('small', { class: 'muted' }, 'Campos: {nome}, {apresentacao} ("Aqui é Gabrielly, da …", texto em Configurações → Mensagens), {cha}, {chaoferta}, {pontos}, {vence}, {loja}. Depois de criar, use "🤖 Ligar o robô para esta campanha"; dá para desligar quando quiser.'),
          h('div', { class: 'cfg-acoes' }, salvar))));
  }

  // ---------- criar ----------
  function criar(corpo, lista, base, editando) {
    const f = { ...PADRAO, ...(base ? base.filtros : {}) };
    const db = TS.db;
    const modelos = A().modelos();
    const campo = (rot, el, dica) => h('label', { class: 'cp-campo' }, h('span', null, rot, dica ? TS.dica(dica) : null), el);
    const inp = (k, ph, tipo = 'number') => { const i = h('input', { class: 'f-input', type: tipo, placeholder: ph, value: f[k] ?? '', min: tipo === 'number' ? 0 : null }); i.addEventListener('input', () => { f[k] = i.value; atualizar(); }); return i; };
    const sel = (k, opcoes) => { const s = h('select', { class: 'f-input' }, ...opcoes.map(([v, t]) => h('option', { value: v, selected: String(f[k]) === String(v) || null }, t))); s.addEventListener('change', () => { f[k] = s.value; atualizar(); }); return s; };
    const nome = h('input', { class: 'f-input', placeholder: 'Ex.: Pontos vencendo em dezembro', value: base ? base.nome + (editando || base.copia || base.pronta ? '' : ' (cópia)') : '' });
    // campanha nova: modelo neutro (o de "Pontos vencendo" supunha um critério de pontos que a campanha nova não tem)
    const msg = h('textarea', { class: 'f-input cp-msg', rows: 4 }, base ? base.mensagem : (modelos.find((m) => /novidade/i.test(m.nome)) || modelos[0] || { texto: '' }).texto);
    const modSel = h('select', { class: 'f-input' }, h('option', { value: '' }, 'Usar um modelo…'), ...modelos.map((m, k) => h('option', { value: k }, m.nome)));
    modSel.addEventListener('change', () => { if (modSel.value !== '') { msg.value = modelos[+modSel.value].texto; atualizar(); } modSel.value = ''; });
    const janela = h('input', { class: 'f-input', type: 'number', min: 1, max: 365, value: base ? base.janela : 30 });
    // período da campanha (opcional): fora dele nada é enviado, pelo robô ou à mão
    const dIni = h('input', { class: 'f-input', type: 'date', value: (base && base.inicio) || '', 'aria-label': 'Início da campanha' });
    const dFim = h('input', { class: 'f-input', type: 'date', value: (base && base.fim) || '', 'aria-label': 'Término da campanha' });
    const limite = h('input', { class: 'f-input cp-num', type: 'number', min: 0, max: 500, value: base && base.limiteDia != null ? base.limiteDia : 20 });
    // grupo de comparação: campanha nova (ou duplicada) começa marcada; a que já existia mostra como está
    const comp = h('input', { type: 'checkbox', checked: (editando ? base.comparar === true : !base || base.comparar !== false) || null });
    // quem envia (pedido do dono): escolhido já ao criar; o robô só liga depois da janela com os números (TS.zapOpcao)
    const podeRobo = !!(TS.zapOpcao && TS.eu && TS.eu.perfil !== 'vendedor');
    const roboAntes = !!(editando && base.robo);
    const quemEnvia = h('select', { class: 'f-input cp-sel', 'aria-label': 'Quem envia' },
      h('option', { value: 'manual', selected: !roboAntes || null }, 'Eu envio pelo painel (um toque por mensagem)'),
      h('option', { value: 'robo', selected: roboAntes || null }, '🤖 O robô do WhatsApp envia sozinho'));
    const CR = TS.campRetorno;
    // variações da mensagem (até 4 além da principal): cada cliente recebe uma, em rodízio; o retorno é medido por variação
    let alvoMsg = msg;
    msg.addEventListener('focus', () => { alvoMsg = msg; });
    const varBox = h('div', { class: 'cp-variacoes' });
    const variacoes = [];
    const addVar = (txt = '') => {
      if (variacoes.length >= 4) return;
      const t = h('textarea', { class: 'f-input cp-msg', rows: 3, placeholder: 'Mesma ideia, com outras palavras…' }, txt);
      t.addEventListener('focus', () => { alvoMsg = t; });
      t.addEventListener('input', () => atualizar());
      const linhaV = h('div', { class: 'cp-var' }, h('div', { class: 'cp-var-top' }, h('small', null, ''), h('button', { type: 'button', class: 'link-btn', onclick: () => { variacoes.splice(variacoes.indexOf(t), 1); linhaV.remove(); numerar(); atualizar(); } }, 'remover')), t);
      variacoes.push(t); varBox.append(linhaV); numerar();
    };
    const btVar = h('button', { type: 'button', class: 'btn' }, '+ Adicionar variação');
    btVar.addEventListener('click', () => { addVar(); variacoes[variacoes.length - 1].focus(); });
    function numerar() { [...varBox.children].forEach((el, k) => { el.querySelector('small').textContent = `Variação ${k + 2}`; }); btVar.hidden = variacoes.length >= 4; }
    for (const v of (base && base.variacoes) || []) addVar(v);
    const textosVar = () => variacoes.map((t) => t.value.trim()).filter(Boolean);
    const rec = h('select', { class: 'f-input' }, h('option', { value: '' }, 'Não (lista única)'), h('option', { value: 'diaria', selected: base && base.recorrente === 'diaria' || null }, 'Todo dia'), h('option', { value: 'semanal', selected: base && base.recorrente === 'semanal' || null }, 'Toda semana'), h('option', { value: 'mensal', selected: base && base.recorrente === 'mensal' || null }, 'Todo mês'));
    const segBox = h('div', { class: 'chips' }, ...SEGS.map(([k, t]) => { const b = h('button', { type: 'button', class: 'chip' + (f.segs.includes(k) ? ' on' : '') }, t); b.addEventListener('click', () => { f.segs = f.segs.includes(k) ? f.segs.filter((x) => x !== k) : [...f.segs, k]; b.classList.toggle('on'); atualizar(); }); return b; }));
    if (!Array.isArray(f.rfm)) f.rfm = []; if (!Array.isArray(f.tipos)) f.tipos = [];
    const chipsDe = (k, opcoes) => h('div', { class: 'chips' }, ...opcoes.map(([v, t, dica]) => { const b = h('button', { type: 'button', class: 'chip' + (f[k].includes(v) ? ' on' : ''), title: dica || null }, t); b.addEventListener('click', () => { f[k] = f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]; b.classList.toggle('on'); atualizar(); }); return b; }));
    const rfmBox = TS.RFM ? chipsDe('rfm', TS.RFM.GRUPOS.map((g) => [g.id, g.nome, `${g.dica} O que fazer: ${g.acao}`])) : null;
    const fams = [...new Set(db.D.grupo.map(familiaCha).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const tiposBox = chipsDe('tipos', fams.map((x) => [x, x]));
    const vendedoras = [...new Set(TS.cli.lista.map((c) => c.vendedora).filter(Boolean))].sort();
    const lojasRede = [...new Set(((TS.cli.fixe && TS.cli.fixe.movs) || []).filter((m) => !m.propria && m.loja).map((m) => m.loja))].sort();
    const grupos = db.opts.grupos.map(([nomeG]) => nomeG).filter(Boolean);
    const MESES = TS.MESES_LONGOS.map((m, k) => [k + 1, m]);
    const contagem = h('div', { class: 'cp-contagem' });
    const previa = h('div', { class: 'cp-previa' });
    const exemplo = h('div', { class: 'cli-msg cp-exemplo' });
    let sel_ = [];
    let dispForm = null;
    if (TS.estoqueDisp && state.loja && state.loja !== 'todas') TS.estoqueDisp(state.loja).then((d0) => { dispForm = d0; atualizar(); }).catch(() => null);
    // decisão do dono: campanha que pega quase a base inteira (mais de 30% dos clientes com celular) avisa e pede confirmação ao salvar
    const baseCel = TS.cli.lista.filter((c) => c.wpp).length;
    const quaseTodos = () => baseCel >= 20 && sel_.length > baseCel * BASE_INTEIRA;
    // tirados à mão (pedido do dono, 23/11/2026): o cliente atende aos critérios, mas não deve receber esta campanha
    if (!Array.isArray(f.fora)) f.fora = [];
    const tirar = (cpf) => { if (!f.fora.includes(cpf)) f.fora = [...f.fora, cpf]; atualizar(); };
    const voltar = (cpf) => { f.fora = f.fora.filter((x) => x !== cpf); atualizar(); };
    function listaFora() {
      if (!f.fora.length) return null;
      const nomeDe = (cpf) => { const c = A().universo().find((x) => x.cpf === cpf); return (c && c.nome) || 'Cliente sem nome'; };
      return h('div', { class: 'cp-fora' },
        h('b', null, `Tirados à mão (${fmt.int(f.fora.length)})`, TS.dica('Não recebem esta campanha, mesmo atendendo aos critérios. Ao salvar, saem também da lista de quem falta receber (quem já recebeu continua no histórico).')),
        h('ul', null, ...f.fora.map((cpf) => h('li', null, h('span', null, nomeDe(cpf), h('small', { class: 'muted' }, ` · CPF ${A().fmtCPF(cpf)}`)),
          h('button', { type: 'button', class: 'btn cp-voltar', onclick: () => voltar(cpf) }, 'Voltar para a campanha')))));
    }
    let atualizar = TS.debounce(() => {
      sel_ = selecionar(f);
      contagem.replaceChildren(...[h('b', null, fmt.int(sel_.length)), ` ${sel_.length === 1 ? 'cliente' : 'clientes'} com celular entram na campanha`,
        comp.checked ? h('small', { class: 'muted cp-comp-n' }, sel_.length >= CR.MIN_LISTA ? `cerca de ${fmt.int(Math.round(sel_.length * CR.PCT / 100))} ficam sem mensagem, para comparar` : `sem grupo de comparação: a lista tem menos de ${CR.MIN_LISTA} clientes`) : null,
        quaseTodos() ? h('div', { class: 'notice warn cp-quase' }, `⚠ ${fmt.pct(sel_.length / baseCel, 0)} dos clientes com celular: quase a base inteira. Confira os critérios (pontos, segmento, última compra…) antes de salvar.`) : null].filter(Boolean));
      const c0 = sel_[0] && sel_[0].c;
      // quem não tem o dado de um campo usado (ex.: sem chá favorito) recebe o texto de reserva: avisa quantos
      const faltam = (TS.CAMPOS_MSG || []).filter(([k, , falta]) => falta && msg.value.includes('{' + k + '}'))
        .map(([k, , falta]) => [k, sel_.filter(({ c }) => falta(c)).length]).filter(([, n]) => n);
      exemplo.replaceChildren(h('small', { class: 'muted' }, c0 ? `Como fica para ${c0.nome || 'o primeiro cliente'}:` : 'Exemplo:'), h('div', null, c0 ? A().texto(msg.value, c0, extras({ filtros: f })) : msg.value),
        ...(faltam.length ? [h('small', { class: 'cp-faltam' }, 'Sem o dado: ', faltam.map(([k, n]) => `{${k}} em ${fmt.int(n)} ${n === 1 ? 'cliente' : 'clientes'}`).join(' · '), ' — confira como fica para eles ou ajuste a frase.')] : []),
        ...(() => { // trava de estoque: quantos receberiam oferta de produto sem estoque (ficam esperando a nota de entrada)
          if (!dispForm) return [];
          const prods = listaProdutos(f).filter((x) => !x.contem).map((x) => x.t);
          const textosF = [msg.value, ...textosVar()];
          const semP = /\{produto\}/.test(textosF.join(' ')) ? prods.filter((p) => dispForm.tem(p) === false) : [];
          let n = 0; for (const { c } of sel_) if (textosF.some((t) => TS.semEstoqueNaMensagem(dispForm, t, c, { produtos: prods }))) n++;
          return n ? [h('small', { class: 'cp-faltam cp-sem-estoque' }, `🚫 ${fmt.int(n)} ${n === 1 ? 'cliente receberia' : 'clientes receberiam'} oferta de produto sem estoque (no chá a granel, menos de 100 g)${semP.length ? ` (${semP.slice(0, 3).join(', ')})` : ''}: eles ficam esperando a nota de entrada e não entram na fila de envio.`)] : [];
        })());
      por(previa, sel_.length ? TS.table({
        cols: [{ key: 'nome', label: 'Cliente', align: 'l', render: (r) => h('span', null, r.nome, h('small', { class: 'muted cp-cel' }, `${r.cel} · CPF ${A().fmtCPF(r.cpf)}`)) }, { key: 'saldo', label: 'Pontos', fmt: fmt.int }, { key: 'vence', label: 'Vencem', align: 'l' }, { key: 'ultima', label: 'Última compra', align: 'l', render: (r) => d(r.ult) },
          { key: 'acao', label: '', align: 'l', title: 'Tira este cliente da campanha mesmo atendendo aos critérios (ele não recebe esta mensagem). Volta pela lista "Tirados à mão", embaixo.', render: (r) => h('button', { type: 'button', class: 'btn ghost-danger cp-tirar', 'aria-label': `Tirar ${r.nome} da campanha`, onclick: (e) => { e.stopPropagation(); tirar(r.cpf); } }, '✕ Tirar') }],
        rows: sel_.slice(0, 300).map(({ c, saldo }) => ({ cpf: c.cpf, nome: c.nome || '—', cel: A().fmtTel(c.celular), saldo, vence: c.fx && c.fx.prox != null ? `${fmt.int(c.fx.proxPts)} em ${d(c.fx.prox)}` : '—', ult: c.ultima, ultima: c.ultima ?? -1 })),
        sortKey: 'saldo', cartao: true, onRowClick: (r) => A().abrirClientes([r.cpf]),
      }) : TS.empty('Nenhum cliente com celular atende a esses critérios.'), sel_.length > 300 ? h('small', { class: 'muted' }, `Mostrando 300 de ${fmt.int(sel_.length)}. A campanha guarda todos.`) : null, listaFora());
    }, 250);
    msg.addEventListener('input', atualizar);
    comp.addEventListener('change', () => atualizar());
    function camposMsg() {
      const lista = [...(TS.CAMPOS_MSG || []), ['produto', 'produtos escolhidos nos critérios']];
      return h('div', { class: 'cp-campos' }, ...lista.map(([k, dica]) => {
        const b = h('button', { type: 'button', class: 'chip cp-tag', title: dica }, '{' + k + '}');
        b.addEventListener('mousedown', (e) => e.preventDefault()); // não tira o cursor da mensagem
        b.addEventListener('click', () => {
          const m = alvoMsg && alvoMsg.isConnected ? alvoMsg : msg;
          const ini = m.selectionStart ?? m.value.length, fim = m.selectionEnd ?? ini, t = '{' + k + '}';
          m.value = m.value.slice(0, ini) + t + m.value.slice(fim);
          m.focus(); m.selectionStart = m.selectionEnd = ini + t.length; atualizar();
        });
        return b;
      }));
    }
    const salvar = h('button', { type: 'button', class: 'btn primary' }, editando ? 'Salvar alterações' : 'Salvar campanha');
    const erro = h('span', { class: 'muted' });
    const filtrosAntes = JSON.stringify(editando ? { ...PADRAO, ...base.filtros } : null);
    const refazer = h('input', { type: 'checkbox', checked: true });
    const refazerBox = editando ? h('label', { class: 'cp-campo cp-check' }, refazer, h('span', null, 'Se mudar os critérios, refazer a lista atual (quem já recebeu continua marcado)')) : null;
    salvar.addEventListener('click', async () => {
      erro.textContent = '';
      // erro ao salvar: janela em destaque (pedido do dono: o aviso discreto passava despercebido e parecia salvo)
      if (!nome.value.trim()) { TS.naoSalvo('Dê um nome à campanha.', nome); return; }
      if (!msg.value.trim()) { TS.naoSalvo('Escreva a mensagem.', msg); return; }
      if (!sel_.length && !editando) { TS.naoSalvo('Nenhum cliente na lista: ajuste os critérios.'); return; }
      if (quaseTodos() && TS.janelaConfirmar && !(await TS.janelaConfirmar('Esta campanha pega quase todos os clientes', [
        h('p', null, `${fmt.int(sel_.length)} de ${fmt.int(baseCel)} clientes com celular (${fmt.pct(sel_.length / baseCel, 0)}) entram na lista.`),
        h('p', { class: 'muted' }, 'Campanha para quase todo mundo costuma ser mensagem que não serve para a maioria. Para mirar melhor, escolha um critério (pontos vencendo, segmento, tempo sem comprar, tipo de chá…).'),
      ], 'Salvar assim mesmo', 'Voltar e escolher critérios'))) return;
      salvar.disabled = true;
      if (editando) {
        try {
          const r = await api('PUT', `/api/campanhas/${base.id}`, { loja: state.loja, nome: nome.value.trim(), mensagem: msg.value.trim(), variacoes: textosVar(), limiteDia: +limite.value || 0, janela: +janela.value || 30, recorrente: rec.value, comparar: comp.checked, inicio: dIni.value || null, fim: dFim.value || null, filtros: f });
          Object.assign(base, r.campanha);
          if (refazer.checked && JSON.stringify(f) !== filtrosAntes && base.rodadas[0]) {
            const r2 = await api('PUT', `/api/campanhas/${base.id}/rodadas/${base.rodadas[0].id}`, { loja: state.loja, lista: sel_.map(({ c }) => ({ cpf: c.cpf, nome: c.nome })) });
            Object.assign(base, r2.campanha);
          }
          if (podeRobo && roboAntes && quemEnvia.value === 'manual') { const r3 = await api('PUT', `/api/campanhas/${base.id}`, { loja: state.loja, robo: false }); Object.assign(base, r3.campanha); }
          if (podeRobo && !base.robo && quemEnvia.value === 'robo') ligarAoAbrir = base.id;
          abrirCampanha(corpo, lista, base);
        } catch (e) { salvar.disabled = false; TS.naoSalvo(e, campoDoErro(e)); }
        return;
      }
      try {
        const r = await api('POST', '/api/campanhas', { loja: state.loja, nome: nome.value.trim(), mensagem: msg.value.trim(), variacoes: textosVar(), limiteDia: +limite.value || 0, janela: +janela.value || 30, recorrente: rec.value, comparar: comp.checked, inicio: dIni.value || null, fim: dFim.value || null, filtros: f, lista: sel_.map(({ c }) => ({ cpf: c.cpf, nome: c.nome })) });
        lista.unshift(r.campanha);
        if (base && base.copia) { api('DELETE', `/api/campanhas/copias/${base.copia}?${qs()}`).catch(() => null); lista.copias = (lista.copias || []).filter((x) => x.id !== base.copia); }
        if (podeRobo && quemEnvia.value === 'robo') ligarAoAbrir = r.campanha.id;
        abrirCampanha(corpo, lista, r.campanha);
      } catch (e) { salvar.disabled = false; TS.naoSalvo(e, campoDoErro(e)); }
    });
    /** o campo de que o erro do servidor fala (para "Corrigir" levar até ele) */
    function campoDoErro(e) {
      const t = String((e && e.message) || '');
      return /nome/i.test(t) ? nome : /mensagem/i.test(t) ? msg : /limite/i.test(t) ? limite : /retorno|prazo/i.test(t) ? janela : /término|início|data/i.test(t) ? dIni : null;
    }
    // ---- formulário: cada critério numa frase ("Saldo entre __ e __ pontos"), em blocos que abrem e fecham
    const num_ = (k, ph, larg) => { const x = inp(k, ph); x.classList.add('cp-num'); if (larg) x.style.width = larg; return x; };
    const linha = (...partes) => h('div', { class: 'cp-linha' }, ...partes.map((p) => (typeof p === 'string' ? h('span', null, p) : p)));
    const ativo = (...ks) => ks.some((k) => (Array.isArray(f[k]) ? f[k].length : f[k] !== '' && f[k] != null && f[k] !== PADRAO[k]));
    const bloco = (titulo, ks, ...corpoB) => {
      const d = h('details', { class: 'cp-bloco', open: ativo(...ks) || null }, h('summary', null, h('b', null, titulo), h('span', { class: 'cp-bloco-res' })), h('div', { class: 'cp-bloco-corpo' }, ...corpoB));
      d._ks = ks;
      return d;
    };
    // produtos: escolher na lista (exatos, com o tamanho) e/ou "todos que contêm…"
    if (!Array.isArray(f.produtos)) f.produtos = [];
    if (f.produto && !f.produtos.length) { f.produtos = ['~' + f.produto]; }
    f.produto = '';
    const vendidos = new Map();
    for (let i2 = 0; i2 < db.n; i2++) vendidos.set(db.desc[i2], (vendidos.get(db.desc[i2]) || 0) + (db.qtd[i2] || 0));
    const todosProd = db.D.descricao.map((t, k) => ({ t, k, n: TS.norm(t), q: vendidos.get(k) || 0 })).filter((x) => x.t && x.q > 0).sort((a, b) => b.q - a.q);
    const chipsProd = h('div', { class: 'cp-prod-chips' });
    const buscaProd = h('input', { class: 'f-input cp-prod-busca', type: 'search', placeholder: 'Digite parte do nome: african, earl grey, caneca…', autocomplete: 'off' });
    const sugest = h('div', { class: 'cp-sug', role: 'listbox', hidden: true });
    const pintarChips = () => {
      chipsProd.replaceChildren(...f.produtos.map((p) => h('span', { class: 'cp-prod-chip' + (p[0] === '~' ? ' contem' : '') }, p[0] === '~' ? `todos com "${p.slice(1)}"` : p,
        h('button', { type: 'button', 'aria-label': 'Tirar ' + p, onclick: () => { f.produtos = f.produtos.filter((x) => x !== p); pintarChips(); atualizar(); } }, '✕'))));
      chipsProd.hidden = !f.produtos.length;
    };
    const addProd = (p) => { if (!f.produtos.includes(p) && f.produtos.length < 30) f.produtos = [...f.produtos, p]; buscaProd.value = ''; sugest.hidden = true; pintarChips(); atualizar(); buscaProd.focus(); };
    const pintarSug = () => {
      const q = TS.norm(buscaProd.value.trim());
      if (!q) { sugest.hidden = true; return; }
      const achou = todosProd.filter((x) => x.n.includes(q) && !f.produtos.includes(x.t)).slice(0, 9);
      sugest.replaceChildren(...[
        ...achou.map((x) => h('button', { type: 'button', class: 'cp-sug-it', role: 'option', onmousedown: (e) => { e.preventDefault(); addProd(x.t); } }, h('span', null, x.t), h('small', null, [TS.grupoProd ? TS.grupoProd.texto(null, x.t) : '', `${fmt.int(x.q)} vendidos`].filter(Boolean).join(' · ')))),
        h('button', { type: 'button', class: 'cp-sug-it cp-sug-todos', onmousedown: (e) => { e.preventDefault(); addProd('~' + buscaProd.value.trim()); } }, h('span', null, `Todos os produtos com "${buscaProd.value.trim()}"`), h('small', null, 'todos os tamanhos e variações')),
        !achou.length ? h('div', { class: 'cp-sug-vazio' }, 'Nenhum produto vendido com esse nome.') : null].filter(Boolean));
      sugest.hidden = false;
    };
    buscaProd.addEventListener('input', pintarSug);
    buscaProd.addEventListener('focus', pintarSug);
    buscaProd.addEventListener('blur', () => setTimeout(() => { sugest.hidden = true; }, 150));
    buscaProd.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const p = sugest.querySelector('.cp-sug-it'); if (p) p.dispatchEvent(new MouseEvent('mousedown')); }
      if (e.key === 'Escape') sugest.hidden = true;
    });
    pintarChips();
    const lojaNome = (() => { const o = document.querySelector('#lojaSel option:checked'); const n = o && o.textContent.trim(); return n ? `Esta loja (${n})` : 'Esta loja'; })();
    const blocos = [
      bloco('Pontos no FIXE', ['ptsMin', 'ptsMax', 'venceDias'],
        linha('Saldo entre', num_('ptsMin', 'mín.'), 'e', num_('ptsMax', 'máx.'), 'pontos'),
        linha('Com pontos vencendo nos próximos', num_('venceDias', 'ex.: 30'), 'dias', TS.dica('Só quem tem pontos que vencem nos próximos N dias. Vazio = não filtra.'))),
      bloco('O que comprou', ['produtos', 'grupo', 'compraDias', 'compraVezes'],
        h('div', { class: 'cp-prod' }, h('span', { class: 'cp-rot' }, 'Comprou', TS.dica('Escolha um ou mais produtos (com o tamanho). Entra quem comprou qualquer um deles. Use {produto} na mensagem para citar os nomes.')),
          h('div', { class: 'cp-prod-box' }, chipsProd, h('div', { class: 'cp-prod-campo' }, buscaProd, sugest))),
        linha('ou algo do grupo', sel('grupo', [['', 'qualquer grupo'], ...grupos.map((g) => [g, g])])),
        linha('pelo menos', num_('compraVezes', '1'), 'compras', TS.dica('Quantas vezes, no mínimo, o cliente comprou o produto (ou algo do grupo) escolhido acima. Conta cada compra (cupom) uma vez: dois pacotes no mesmo cupom são uma compra. Com mais de um produto escolhido, somam as compras de qualquer um deles. Se preencher "nos últimos X dias", contam só as compras desse período. Vazio = basta uma compra. Só vale com produto ou grupo escolhido.')),
        linha('nos últimos', num_('compraDias', 'todos'), 'dias', TS.dica('Vazio = em qualquer época.'))),
      bloco('Frequência', ['ausMin', 'ausMax', 'visMin', 'visMax'],
        linha('Está sem comprar há', num_('ausMin', 'ex.: 60'), 'a', num_('ausMax', 'máx.'), 'dias', TS.dica('Dias desde a última compra com CPF.')),
        linha('Já fez de', num_('visMin', 'mín.'), 'a', num_('visMax', 'máx.'), 'compras', TS.dica('Cupons com CPF em todo o histórico.'))),
      bloco('Perfil', ['aniv', 'vendedora', 'lojaPref'],
        linha('Faz aniversário em', sel('aniv', [['', 'qualquer mês'], ['atual', 'mês atual'], ['proximo', 'próximo mês'], ...MESES]), TS.dica('"Mês atual" e "Próximo mês" acompanham a data nas campanhas recorrentes.')),
        linha('Mais atendido por', sel('vendedora', [['', 'qualquer vendedora'], ...vendedoras.map((v) => [v, v])])),
        linha('Compra mais em', sel('lojaPref', [['', 'qualquer loja'], ['nossa', lojaNome], ['outra', 'outra loja da rede'], ...lojasRede.map((l) => [l, l])]), TS.dica('Loja onde o cliente mais comprou nos últimos 12 meses (esta loja pelas vendas; as outras pelas compras lançadas no FIXE).'))),
      bloco('Segmentos', ['segs'], h('small', { class: 'muted' }, 'Entra quem estiver em qualquer um dos marcados. "Hora de repor" + um tipo de chá = a régua de recompra daquele tipo.'), segBox),
      rfmBox ? bloco('Grupo do cliente (RFM)', ['rfm'], h('small', { class: 'muted' }, 'Pelo comportamento: recência, frequência e valor nos últimos 12 meses. Entra quem estiver em qualquer um dos marcados.'), rfmBox) : null,
      fams.length ? bloco('Tipo de chá que compra', ['tipos'], h('small', { class: 'muted' }, 'Clientes que já compraram chá deste tipo (qualquer um dos marcados).'), tiposBox) : null,
    ].filter(Boolean);
    // resumo de cada bloco no título (aparece mesmo fechado)
    const resumoBloco = () => {
      const R = {
        ptsMin: () => (f.ptsMin !== '' || f.ptsMax !== '' ? `saldo ${f.ptsMin || 0}${f.ptsMax !== '' ? '–' + f.ptsMax : '+'} pts` : ''),
        venceDias: () => (f.venceDias !== '' ? `vencendo em ${f.venceDias} dias` : ''),
        produtos: () => (f.produtos.length ? `${f.produtos.length} produto${f.produtos.length > 1 ? 's' : ''}` : ''),
        grupo: () => f.grupo || '', compraDias: () => (f.compraDias !== '' ? `últimos ${f.compraDias} dias` : ''), compraVezes: () => (f.compraVezes !== '' && +f.compraVezes > 1 ? `${f.compraVezes}+ vezes` : ''),
        ausMin: () => (f.ausMin !== '' || f.ausMax !== '' ? `sem comprar ${f.ausMin || 0}${f.ausMax !== '' ? '–' + f.ausMax : '+'} dias` : ''),
        visMin: () => (f.visMin !== '' || f.visMax !== '' ? `${f.visMin || 0}${f.visMax !== '' ? '–' + f.visMax : '+'} compras` : ''),
        aniv: () => (f.aniv ? 'aniversário' : ''), vendedora: () => f.vendedora || '', lojaPref: () => (f.lojaPref ? 'loja preferida' : ''),
        segs: () => f.segs.map((k) => (SEGS.find(([x]) => x === k) || [, k])[1]).join(', '),
        rfm: () => (TS.RFM ? f.rfm.map((k) => (TS.RFM.por[k] || { nome: k }).nome).join(', ') : ''),
        tipos: () => f.tipos.join(', '),
      };
      for (const b of blocos) b.querySelector('.cp-bloco-res').textContent = b._ks.map((k) => (R[k] ? R[k]() : '')).filter(Boolean).join(' · ');
    };
    const atualizar0 = atualizar;
    atualizar = () => { resumoBloco(); atualizar0(); };
    resumoBloco();
    corpo.replaceChildren(
      h('div', { class: 'cp-acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => (editando ? abrirCampanha(corpo, lista, base) : pintarLista(corpo, lista, [])) }, editando ? '‹ Voltar à campanha' : '‹ Voltar às campanhas')),
      h('div', { class: 'grid g-3-2 cp-tela', style: { alignItems: 'start' } },
        h('div', { class: 'cp-esq' },
          TS.card(editando ? `Editar "${base.nome}"` : 'Nova campanha', null,
            h('div', { class: 'cp-form' },
              h('label', { class: 'cp-campo cp-nome' }, h('span', null, 'Nome da campanha'), nome),
              h('div', { class: 'cp-passo' }, h('span', { class: 'cp-n' }, '1'), h('div', null, h('b', null, 'Quem entra'), h('small', { class: 'muted' }, 'Só clientes com celular que não pediram para não receber mensagens. Os critérios se somam (precisa atender a todos).'))),
              ...blocos,
              linha('Não incluir quem foi contatado há menos de', num_('semContato', '0'), 'dias', TS.dica(`Evita mandar duas mensagens seguidas para a mesma pessoa. Nunca menos que o intervalo da loja (uma mensagem a cada ${A().intervalo ? A().intervalo() : 21} dias, em Configurações → Lojas → Mensagens de WhatsApp).`)),
              h('div', { class: 'cp-passo' }, h('span', { class: 'cp-n' }, '2'), h('div', null, h('b', null, 'Mensagem'), h('small', { class: 'muted' }, 'Clique num campo para colocar na mensagem onde está o cursor.'))),
              h('div', { class: 'cp-msg-topo' }, modSel), camposMsg(), h('small', { class: 'muted' }, 'Variação 1 (principal)'), msg, exemplo,
              varBox, h('div', { class: 'cp-var-acoes' }, btVar, h('small', { class: 'muted' }, ' Até 5 versões da mesma mensagem. Cada cliente recebe uma, em rodízio, e o painel mostra qual trouxe mais clientes de volta.')),
              h('div', { class: 'cp-passo' }, h('span', { class: 'cp-n' }, '3'), h('div', null, h('b', null, 'Envio e retorno'))),
              podeRobo ? linha('Quem envia', quemEnvia, TS.dica('Eu envio: a fila da campanha abre o WhatsApp com a mensagem pronta, um toque por cliente.\n\nO robô envia: depois de salvar, aparece a janela com quantos vão receber, o limite por dia e quando termina; o robô só liga quando você confirmar. Ele manda pelo número da loja, no ritmo, horário e dias das configurações do robô. Mesmo com o robô, dá para enviar à mão.')) : null,
              linha('Enviar no máximo', limite, 'mensagens por dia nesta campanha', TS.dica('Ao chegar no limite, a fila para e continua no dia seguinte. 0 = sem limite. Poucas mensagens por dia, para quem tem motivo de receber, mantêm o número da loja saudável.')),
              linha('Medir o retorno em', janela, 'dias', TS.dica('Conta como "voltou" quem comprar (cupom com CPF) depois da mensagem: do dia seguinte ao envio até N dias depois. Compra do mesmo dia não conta, porque o painel não sabe se foi antes ou depois da mensagem.')),
              h('label', { class: 'cp-campo cp-check' }, comp, h('span', null, `Guardar ${CR.PCT}% da lista sem mensagem para comparar`, TS.dica(`Para saber se a campanha funciona de verdade: parte de quem recebe a mensagem voltaria de qualquer jeito.\n\nCom esta opção, ${CR.PCT}% da lista (sorteio feito pelo painel) fica sem mensagem. Depois o painel mostra lado a lado quem recebeu × quem não recebeu, no mesmo prazo: a diferença é o efeito da campanha.\n\nVale para listas com ${CR.MIN_LISTA} clientes ou mais (em lista menor o grupo ficaria pequeno demais). Quem está no grupo de comparação não recebe nem pelo robô nem pela fila manual; numa campanha que se repete, o mesmo cliente fica sempre do mesmo lado.`))),
              linha('Período', h('span', { class: 'cp-periodo' }, 'de ', dIni, ' até ', dFim), TS.dica('Data de início e de término da campanha (as duas são opcionais).\n\nAntes do início e depois do término nada é enviado: o robô pula a campanha e a fila manual fica travada. Campanha que se repete também não monta lista nova fora do período.\n\nEm branco: começa já e não tem data para acabar. Ex.: Black Friday de 23/11 a 30/11.')),
              linha('Repetir', rec, TS.dica('Todo dia, toda semana ou todo mês uma lista nova é montada com estes critérios.\n\nTodo dia: serve para critérios que mudam a cada dia (aniversariantes, quem acabou de completar os pontos, quem está há X dias sem comprar). Quem já recebeu não recebe de novo antes do intervalo da loja.\n\nEnvio manual: a lista nova nasce quando a tela de campanhas é aberta. Campanha enviada pelo robô: o painel monta sozinho, sem ninguém abrir a tela.')),
              refazerBox))),
        h('div', { class: 'cp-dir' },
          h('div', { class: 'card cp-resumo-fixo' }, contagem, h('div', { class: 'cp-salvar' }, salvar, erro)),
          TS.card('Quem entra', 'Clique num cliente para ver a ficha', previa))));
    janela.classList.add('cp-num'); rec.classList.add('cp-sel');
    atualizar();
  }

  // ---------- campanha: fila de envio, lista e retorno ----------
  let ligarAoAbrir = null; // campanha salva com "O robô envia": ao abrir, já pergunta (a janela com os números) se liga o robô
  async function abrirCampanha(corpo, lista, camp, rodadaId, jaRecarregou) {
    // ao abrir: busca de novo quem já recebeu mensagem (de outra campanha, ou de outro computador)
    if (!jaRecarregou) { await A().recarregarContatos(); if (!corpo.isConnected) return; }
    // trava de estoque: a mensagem que oferece produto ({cha}, {ultimocha}, {produto}) só sai se a loja tiver
    let disp = null;
    if (TS.estoqueDisp) { try { disp = await TS.estoqueDisp(state.loja); } catch { /* sem leitura do estoque: sem trava (aviso na tela) */ } if (!corpo.isConnected) return; }
    const r = camp.rodadas.find((x) => x.id === rodadaId) || camp.rodadas[0];
    const s = resumoRodada(r, camp.janela);
    const repintar = () => abrirCampanha(corpo, lista, camp, r.id, true);
    const marcarSt = async (it, st, motivo, v) => {
      const x = await api('POST', `/api/campanhas/${camp.id}/marcar`, { loja: state.loja, rodada: r.id, cpf: it.cpf, st, motivo, v });
      for (const k of ['em', 'por', 'motivo', 'liberado', 'v']) delete it[k];
      Object.assign(it, x.item);
    };
    // quem recebeu mensagem de OUTRA campanha (ou pelo painel) há menos de N dias, ou pediu para não receber,
    // sai da fila sozinho como "pulada" com o motivo; "voltar para a fila" libera manualmente
    const dias = TS.msgWpp.prazoCampanha(camp, A().intervalo ? A().intervalo() : 21); // nunca menos que o intervalo da loja
    const minha = TS.msgWpp.motivoCampanha(camp.nome);
    // o intervalo da loja vale sempre (até para esta mesma campanha e para quem foi "voltado para a fila");
    // o prazo maior pedido na campanha pode ser liberado à mão
    const bloqueio = (it) => {
      const b = TS.msgWpp.bloqueio(it, A().contatoDe(clienteDe(it.cpf)), { intervalo: A().intervalo ? A().intervalo() : 21, dias, minha, agora: Date.now() });
      return b ? TS.msgWpp.textoBloqueio(b) : null;
    };
    const bloqueados = r.lista.map((it) => [it, bloqueio(it)]).filter(([, m]) => m);
    if (bloqueados.length) {
      for (const [it, m] of bloqueados) { try { await marcarSt(it, 'x', m); } catch { /* tenta de novo na próxima vez */ } }
      if (!corpo.isConnected) return;
      const t = h('div', { class: 'toast', role: 'status' }, `${fmt.int(bloqueados.length)} ${bloqueados.length === 1 ? 'cliente saiu' : 'clientes saíram'} da fila: já ${bloqueados.length === 1 ? 'recebeu' : 'receberam'} mensagem há menos de ${dias} dias (ou não quer${bloqueados.length === 1 ? '' : 'em'} mensagens).`);
      document.body.append(t); setTimeout(() => t.remove(), 6000);
    }
    // fila: próximo pendente (quem receberia oferta de produto sem estoque espera, sem sair da lista: volta quando chegar a nota)
    const faltaPara = faltaEstoqueDe(camp, disp);
    const esperandoEstoque = new Map();
    for (const it of r.lista) if (it.st === 'p') { const f = faltaPara(it); if (f) esperandoEstoque.set(it.cpf, f); }
    const pend = r.lista.filter((x) => x.st === 'p' && !esperandoEstoque.has(x.cpf));
    const atual = pend[0];
    const faltam = [...new Set(esperandoEstoque.values())];
    const avisoEstoque = esperandoEstoque.size ? h('div', { class: 'notice cp-estoque' }, h('b', null, `🚫 ${fmt.int(esperandoEstoque.size)} ${esperandoEstoque.size === 1 ? 'cliente esperando' : 'clientes esperando'} estoque: `),
      `a mensagem ofereceria ${faltam.slice(0, 4).join(', ')}${faltam.length > 4 ? '…' : ''}, que está sem estoque (no chá a granel, menos de 100 g). Eles continuam na lista e entram na fila quando chegar a nota de entrada.`)
      : !disp ? h('div', { class: 'notice' }, 'Não consegui ler o estoque agora: a fila não está conferindo se o produto citado tem em estoque.') : null;
    // robô: manda a lista conferida (depois de tirar da fila quem não pode receber)
    if (camp.robo && camp.ativa !== false && r === camp.rodadas[0]) prepararRobo([camp], disp).catch(() => null);
    const opcaoRobo = TS.zapOpcao ? TS.zapOpcao(camp, async (quer) => {
      const x = await api('PUT', `/api/campanhas/${camp.id}`, { loja: state.loja, robo: quer });
      Object.assign(camp, x.campanha);
      repintar();
    }, {
      // o que a janela de "Ligar o robô" mostra: pendentes da lista atual (sem quem espera estoque), comparação e a mensagem do 1º
      pendentes: () => (r === camp.rodadas[0] ? pend.length : camp.rodadas[0].lista.filter((x) => x.st === 'p').length),
      comparacao: () => camp.rodadas[0].lista.filter((x) => x.st === 'c').length,
      exemplo: () => { if (!atual) return null; const c = clienteDe(atual.cpf); return A().texto(textosAtual[varAtual], c, { ...extras(camp), chaoferta: atual.o || c.chaFavorito || 'chá' }); },
    }) : null;
    const pelosRobo = r.lista.filter((x) => x.st === 'e' && x.por === 'robô').length;
    // limite por dia: conta os envios de hoje desta campanha (todas as listas)
    const hojeIso = new Date().toLocaleDateString('sv-SE');
    const limiteDia = camp.limiteDia != null ? camp.limiteDia : 20;
    const enviadosHoje = camp.rodadas.reduce((n, rr) => n + rr.lista.filter((x) => x.st === 'e' && x.em && new Date(x.em).toLocaleDateString('sv-SE') === hojeIso).length, 0);
    const noLimite = limiteDia > 0 && enviadosHoje >= limiteDia;
    // variações: rodízio pela quantidade já enviada (cada uma recebe mais ou menos o mesmo número)
    const textos = TS.msgWpp.textos(camp);
    // Resumo diário: cada cliente com o texto do motivo dele (sem variações)
    const textosAtual = atual ? TS.msgWpp.textosDe(camp, atual) : textos;
    const varAtual = TS.msgWpp.variacaoDaVez(r.lista, textosAtual.length);
    const contaHoje = limiteDia > 0 ? h('span', { class: 'cp-hoje' + (noLimite ? ' fim' : '') }, `Hoje: ${fmt.int(enviadosHoje)} de ${fmt.int(limiteDia)}`) : null;
    let fila;
    const fora = TS.msgWpp.foraDoPeriodo(camp, TS.hojeSP());
    if (atual && fora) {
      // fora do período da campanha: nada é enviado (o robô também pula)
      fila = TS.card('Fila de envio', `${fmt.int(pend.length)} pendentes`, h('div', { class: 'cp-fim' }, h('b', null, fora === 'antes' ? `A campanha começa em ${fmt.date(camp.inicio)}.` : `A campanha terminou em ${fmt.date(camp.fim)}.`), ' Fora do período nada é enviado. Dá para mudar as datas em "Editar campanha".'));
    } else if (atual && noLimite) {
      fila = TS.card('Fila de envio', `${fmt.int(pend.length)} pendentes`, h('div', { class: 'cp-fim' }, contaHoje, h('b', null, ' Limite de hoje atingido.'), ` A fila continua amanhã. Dá para mudar o limite em "Editar campanha".`));
    } else if (atual) {
      const c = clienteDe(atual.cpf);
      const txt = A().texto(textosAtual[varAtual], c, { ...extras(camp), chaoferta: atual.o || c.chaFavorito || 'chá' });
      const ct = A().contatoDe(c);
      // com o robô ligado nesta campanha, o envio manual continua possível, mas deixa de ser o botão principal
      const enviar = h('a', { class: 'btn cp-enviar' + (camp.robo ? ' cp-enviar-sec' : ' primary'), href: '#', role: 'button' }, 'Abrir no WhatsApp e ir para o próximo ›');
      enviar.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!c.wpp) return;
        enviar.classList.add('carregando');
        try {
          // regra forte: o servidor confere antes de abrir o WhatsApp (já recebeu no intervalo, não quer, está com o robô)
          if (!TS.demo) {
            try { await A().enviarWpp(c, txt, minha, camp.id); } catch (err) {
              if (!err.bloqueado) throw err;
              await marcarSt(atual, 'x', err.message.replace(/^Mensagem não enviada: /, '').slice(0, 120)).catch(() => {});
              TS.avisar(err.message);
              repintar();
              return;
            }
          }
          await marcarSt(atual, 'e', null, textosAtual.length > 1 ? varAtual : null);
        } catch (err) { TS.avisarErro(err); }
        repintar();
      });
      fila = TS.card('Fila de envio', `${fmt.int(pend.length)} pendentes${textosAtual.length > 1 ? ` · variação ${varAtual + 1} de ${textosAtual.length}` : atual.m ? ` · motivo: ${NOME_MOTIVO[atual.m] || atual.m}` : ''} · toque, confira a mensagem e envie pelo WhatsApp da loja`, contaHoje,
        h('div', { class: 'cp-fila' },
          h('div', { class: 'cp-fila-cli' },
            h('div', { class: 'cj-nome' }, c.nome || 'Cliente'),
            h('div', { class: 'cli-meta' }, h('span', null, 'CPF ' + A().fmtCPF(c.cpf)), h('span', null, A().fmtTel(c.celular) || 'sem celular'), c.fx ? h('span', { class: 'cli-pts' }, `★ ${fmt.int(c.fx.saldo || 0)} pts`) : null,
              c.fx && c.fx.prox != null ? h('span', null, `${fmt.int(c.fx.proxPts)} vencem em ${d(c.fx.prox)}`) : null,
              c.ultima != null ? h('span', null, `última compra ${d(c.ultima)}`) : null,
              ct && ct.em ? h('span', { class: 'cli-tag t-contato' }, 'contatado ' + fmt.date(ct.em.slice(0, 10))) : null),
            h('div', { class: 'cli-msg' }, txt),
            !c.wpp ? h('div', { class: 'notice err' }, 'Este cliente está sem celular válido agora.') : null),
          h('div', { class: 'cp-fila-bts' }, enviar,
            h('button', { type: 'button', class: 'btn', onclick: async () => { await marcarSt(atual, 'x').catch((e) => alert(e.message)); repintar(); } }, 'Pular'),
            h('button', { type: 'button', class: 'btn', onclick: () => A().abrirClientes([c.cpf]) }, 'Ver cliente'),
            h('button', { type: 'button', class: 'btn danger-txt', onclick: async () => { if (!confirm(`${c.nome || 'Este cliente'} não quer receber mensagens?`)) return; await marcarSt(atual, 'o').catch(() => {}); if (!TS.demo) await A().marcar(c, 'optout').catch(() => {}); repintar(); } }, 'Não quer mensagens'))));
    } else {
      fila = esperandoEstoque.size ? TS.card('Fila de envio', null, h('div', { class: 'cp-fim' }, h('b', null, 'Só faltam clientes esperando estoque.'), ' Eles entram na fila quando chegar a nota de entrada do produto.'))
        : TS.card('Fila de envio', null, h('div', { class: 'cp-fim' }, h('b', null, '✓ Todas as mensagens desta lista foram enviadas.'), ` O retorno é medido do dia seguinte até ${camp.janela} dias depois de cada envio.`));
    }
    // lista com situação e retorno
    const ST = { p: ['Pendente', ''], e: ['Enviada', 'ok'], o: ['Não quer', 'neg'], x: ['Pulada', ''], c: ['Comparação (sem mensagem)', ''] };
    const linhas = r.lista.map((it) => {
      const c = clienteDe(it.cpf), ret = retorno(it, camp.janela);
      return { it, cpf: it.cpf, nome: it.nome || c.nome || '—', cel: A().fmtTel(c.celular), st: it.st, em: it.em ? isoDia(it.em) : null, por: it.por || '', voltou: ret ? (ret.voltou ? 2 : ret.aberto ? 1 : 0) : -1, ret };
    });
    const tab = TS.table({
      cols: [
        { key: 'nome', label: 'Cliente', align: 'l', render: (x) => h('span', null, x.nome, h('small', { class: 'muted cp-cel' }, 'CPF ' + A().fmtCPF(x.cpf))) },
        { key: 'cel', label: 'Celular', align: 'l' },
        { key: 'st', label: 'Situação', align: 'l', title: 'Pendente, Enviada (com a data e quem enviou: 🤖 robô = enviada pelo robô do WhatsApp), Pulada (com o motivo), Não quer mensagens ou Comparação (sorteado para ficar sem mensagem: serve para medir o efeito da campanha).', render: (x) => h('span', { class: 'cp-st ' + ST[x.st][1] }, x.st === 'p' && esperandoEstoque.has(x.cpf) ? `Esperando estoque (${esperandoEstoque.get(x.cpf)})` : ST[x.st][0], x.em != null && x.st !== 'c' ? h('small', null, ` ${d(x.em)}${x.por ? ' · ' + (x.por === 'robô' ? '🤖 robô' : x.por) : ''}`) : null, x.it.motivo ? h('small', { class: 'cp-motivo' }, x.it.motivo) : null, x.it.m ? h('small', { class: 'cp-motivo' }, NOME_MOTIVO[x.it.m] || x.it.m) : null), sortVal: (x) => ({ e: 3, x: 2, o: 1, c: 4, p: 0 })[x.st] },
        { key: 'voltou', label: `Voltou em ${camp.janela} dias`, align: 'l', title: `Comprou (cupom com CPF) do dia seguinte ao envio até ${camp.janela} dias depois. No grupo de comparação o prazo conta do dia em que a lista foi criada. "ainda no prazo" = pode voltar.`, render: (x) => (!x.ret ? '—' : x.ret.voltou ? h('span', { class: 'cp-st ok' }, `Sim · ${d(x.ret.primeira)} · ${fmt.brl0(x.ret.vt)}`) : x.ret.aberto ? h('span', { class: 'muted' }, 'ainda no prazo') : h('span', { class: 'muted' }, 'não')) },
        { key: 'acao', label: '', align: 'l', render: (x) => (x.st !== 'p' && x.st !== 'c' ? h('button', { type: 'button', class: 'link-btn', onclick: async (e) => { e.stopPropagation(); await marcarSt(x.it, 'p', x.it.motivo ? 'liberado' : null).catch((er) => alert(er.message)); repintar(); } }, 'voltar para a fila') : null), sortVal: () => 0 },
      ],
      rows: linhas.map((x) => ({ ...x, cpfTxt: A().fmtCPF(x.cpf) + ' ' + x.cpf })), search: 'Buscar por nome, CPF ou celular', searchKeys: ['nome', 'cpfTxt', 'cel'], sortKey: 'st', sortDir: 'asc', rowClass: (x) => (x.st === 'e' ? 'cp-enviada' : null), onRowClick: (x) => A().abrirClientes([x.cpf]),
    });
    const csvBt = h('button', { type: 'button', class: 'btn', onclick: () => A().csv('campanha-' + camp.nome.replace(/\W+/g, '-').toLowerCase(), ['Cliente', 'CPF', 'Celular', 'Situação', 'Enviada em', 'Por', 'Voltou', 'Valor no retorno'],
      linhas.map((x) => [x.nome, A().fmtCPF(x.cpf), TS.demo ? '' : x.cel, ST[x.st][0], x.em != null ? d(x.em) : '', x.por, x.ret ? (x.ret.voltou ? 'sim' : x.ret.aberto ? 'no prazo' : 'não') : '', x.ret && x.ret.voltou ? x.ret.vt.toFixed(2).replace('.', ',') : ''])) }, 'Baixar lista (CSV)');
    const rodSel = camp.rodadas.length > 1 ? (() => { const sx = h('select', { class: 'f-input', style: { width: 'auto' } }, ...camp.rodadas.map((x) => h('option', { value: x.id, selected: x.id === r.id || null }, `Lista de ${fmt.date(x.em.slice(0, 10))} (${fmt.int(x.lista.length)})`))); sx.addEventListener('change', () => abrirCampanha(corpo, lista, camp, sx.value)); return sx; })() : null;
    const kpi = (rot, val, sub, dica) => TS.kpi(rot, val, sub, dica);
    por(corpo,
      h('div', { class: 'cp-acoes' },
        h('button', { type: 'button', class: 'btn', onclick: () => pintarLista(corpo, lista, []) }, '‹ Voltar às campanhas'),
        rodSel,
        h('span', { style: { flex: 1 } }),
        h('button', { type: 'button', class: 'btn', onclick: () => (TS.msgWpp.ehResumo(camp) ? editarResumo(corpo, lista, camp) : criar(corpo, lista, camp, true)) }, 'Editar campanha'),
        camp.recorrente ? h('button', { type: 'button', class: 'btn', onclick: async () => { try { const x = await api('PUT', `/api/campanhas/${camp.id}`, { loja: state.loja, ativa: camp.ativa === false }); Object.assign(camp, x.campanha); repintar(); } catch (e) { alert(e.message); } } }, camp.ativa === false ? 'Retomar repetição' : 'Pausar repetição') : null,
        TS.msgWpp.ehResumo(camp) ? null : h('button', { type: 'button', class: 'btn', onclick: () => criar(corpo, lista, camp) }, 'Duplicar'),
        (TS.lojas || []).length > 1 && !TS.demo && !TS.msgWpp.ehResumo(camp) ? h('button', { type: 'button', class: 'btn', onclick: () => copiarPara(camp) }, 'Copiar para outra loja') : null,
        h('button', { type: 'button', class: 'btn danger-txt', onclick: async () => { if (!confirm(`Apagar a campanha "${camp.nome}"? As listas e o retorno somem.`)) return; await api('DELETE', `/api/campanhas/${camp.id}?${qs()}`).catch((e) => alert(e.message)); lista.splice(lista.indexOf(camp), 1); pintarLista(corpo, lista, []); } }, 'Apagar')),
      h('div', { class: 'page-head cp-head' }, h('div', null, h('h2', { class: 'page-title' }, camp.nome),
        h('div', { class: 'page-sub' }, `${camp.recorrente ? (camp.recorrente === 'diaria' ? 'Todo dia · ' : camp.recorrente === 'semanal' ? 'Toda semana · ' : 'Todo mês · ') : ''}lista de ${fmt.date(r.em.slice(0, 10))} · retorno medido em ${camp.janela} dias${camp.comparar ? ` · guarda ${TS.campRetorno.PCT}% sem mensagem para comparar` : ''}`))),
      h('div', { class: 'grid g-kpi' },
        kpi('Na lista', fmt.int(s.total), `${fmt.int(s.pend)} pendentes${s.comp ? ` · ${fmt.int(s.comp)} sem mensagem (comparação)` : ''}`, s.comp ? `Clientes desta lista. ${fmt.int(s.comp)} foram sorteados para ficar sem mensagem (grupo de comparação): não entram na fila nem no robô.` : 'Clientes desta lista.'),
        kpi('Enviadas', fmt.int(s.env), s.total - s.comp ? `${fmt.pct(s.env / (s.total - s.comp), 0)} de quem recebe${pelosRobo ? ` · 🤖 ${fmt.int(pelosRobo)} pelo robô` : ''}` : null, 'Mensagens abertas no WhatsApp pela fila (clique em "Abrir no WhatsApp") ou enviadas pelo robô do WhatsApp (🤖). O % é sobre quem recebe mensagem (sem o grupo de comparação).'),
        kpi('Voltaram', pctVoltou(s.rec), s.rec.fechados ? `${fmt.int(s.rec.voltFech)} de ${fmt.int(s.rec.fechados)} com o prazo fechado${s.rec.abertos ? ` · ${fmt.int(s.rec.abertos)} ainda no prazo` : ''}` : s.rec.abertos ? `${fmt.int(s.rec.abertos)} ainda no prazo${s.rec.voltAbertos ? ` (${fmt.int(s.rec.voltAbertos)} já voltaram)` : ''}` : 'nenhuma enviada ainda',
          `Voltaram ÷ enviadas cujo prazo de ${camp.janela} dias JÁ FECHOU.\n\n"Voltou" = comprou (cupom com CPF) depois da mensagem: do dia seguinte ao envio até ${camp.janela} dias depois. Compra do mesmo dia do envio não conta (o painel não sabe se foi antes ou depois da mensagem).\n\nQuem ainda está no prazo fica de fora do % (ainda pode voltar) e aparece separado.${s.comp ? '' : '\n\nSem grupo de comparação este número não é o efeito da campanha: parte destes clientes voltaria de qualquer jeito.'}`),
        kpi('Faturamento do retorno', fmt.brl0(s.rec.vt), s.rec.volt ? `ticket ${fmt.brl0(s.rec.vt / s.rec.volt)} · ${fmt.int(s.rec.volt)} ${s.rec.volt === 1 ? 'cliente' : 'clientes'}` : null, `Soma das compras de quem recebeu a mensagem e voltou no prazo (do dia seguinte ao envio até ${camp.janela} dias depois), inclusive de quem ainda está no prazo. Não é tudo "da campanha": parte compraria de qualquer jeito — o cartão "Efeito da campanha" mostra a diferença para quem não recebeu.`),
        kpi('Não querem', fmt.int(s.opt), 'saíram das próximas campanhas', 'Clientes desta lista marcados como "não quer mensagens" (pela fila, pela ficha ou porque responderam "parar" ao robô). Não recebem mais nenhuma campanha da loja, nem pelo robô, até alguém marcar "Voltou a aceitar" na ficha.')),
      avisoEstoque ? h('div', { class: 'mt' }, avisoEstoque) : null,
      opcaoRobo ? h('div', { class: 'mt' }, opcaoRobo) : null,
      h('div', { class: 'mt' }, fila),
      s.env || s.comp ? h('div', { class: 'mt' }, cartaoEfeito(s, camp)) : null,
      textos.length > 1 ? h('div', { class: 'mt' }, cartaoVariacoes(r, camp, textos)) : null,
      h('div', { class: 'mt' }, TS.cardWithTools('Clientes da campanha', 'Enviadas ficam em verde · clique num cliente para ver a ficha', h('div', { class: 'cp-acoes', style: { margin: 0 } }, tab.searchBox, csvBt), tab)));

    // salva com "O robô envia": já abre a janela de ligar (com os números); o robô só liga se a pessoa confirmar
    if (ligarAoAbrir === camp.id && opcaoRobo) { ligarAoAbrir = null; const bt = opcaoRobo.querySelector('.zap-ligar'); if (bt) setTimeout(() => bt.click(), 0); }
  }

})();
