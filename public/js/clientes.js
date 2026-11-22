/* Página Clientes: histórico por CPF, visitas, ausência, aniversários, WhatsApp */
'use strict';
(function () {
  const { h, fmt, state } = TS;
  /**
   * celular trocado pelo painel (vínculo da conversa do WhatsApp, src/celulares.js): o servidor já entrega o número novo
   * em `celular`; aqui só vêm junto o do FIXE (`celFixe`) e quem/quando trocou (`celVinc`), para a ficha mostrar.
   * `celTirado`: o número do FIXE deste cliente foi ligado a outro cliente pelo painel (fica sem celular).
   */
  const celInfo = (info) => (info && (info.celVinc || info.celTirado) ? { celFixe: info.celFixe || '', celVinc: info.celVinc || null, celTirado: !!info.celTirado } : {});

  /**
   * Monta (uma vez) o índice cliente → cupons → itens.
   * - Só conta como compra o cupom encontrado nas vendas da loja; o que não foi encontrado
   *   fica à parte (semVenda) e não entra em visitas, valor nem ticket.
   * - Quando a nota tem data (XML do AppNext), a venda precisa ser do mesmo dia (±1),
   *   para não juntar vendas diferentes com o mesmo número (outro caixa/série, NF-e × NFC-e).
   * - Taxas (serviço/delivery) aparecem nos itens, mas não somam no valor do cliente.
   */
  TS.prepararClientes = function () {
    const db = TS.db;
    const taxas = TS.rules.ids.taxas;
    const porChave = new Map(); // "cupom|lojaId" -> índices
    for (let i = 0; i < db.n; i++) {
      const k = db.cupom[i] + '|' + db.loja[i];
      let a = porChave.get(k);
      if (!a) porChave.set(k, (a = []));
      a.push(i);
    }
    const lojaId = new Map(db.D.loja.map((s, i) => [s, i]));
    const cad = new Map(db.clientes.map((c) => [c.cpf, c]));
    const porCPF = new Map();
    let semVendaTotal = 0;
    const semVendaLista = []; // cupons com CPF que não casaram com nenhuma venda, com o motivo provável
    const cliente = (cpf, nomeAlt) => {
      let c = porCPF.get(cpf);
      if (!c) {
        const info = cad.get(cpf) || {};
        const nome = (info.nome || nomeAlt || '').replace(/^[\s\-–—]+/, '').trim();
        const cel = digits(info.celular);
        const local = cel.length >= 12 && cel.startsWith('55') ? cel.slice(2) : cel; // aceita com o 55 na frente
        c = { cpf, empresa: cpf.length === 14, nome, celular: cel, wpp: local.length >= 10 && local.length <= 11 ? TS.demo ? '#demo' : 'https://wa.me/55' + local : null, nascimento: info.nascimento || null, cidade: info.cidade || '', email: info.email || '', cupons: [], semVenda: 0, divergencias: [], ...celInfo(info) };
        porCPF.set(cpf, c);
      }
      return c;
    };
    const resumo = (itens) => {
      let day = null, vt = 0, qtd = 0;
      const vends = new Set();
      for (const i of itens) {
        if (day === null || db.day[i] > day) day = db.day[i];
        if (taxas.has(db.desc[i])) continue;
        vt += db.vt[i] || 0; qtd += TS.qtdItem(i); vends.add(db.D.vendedor[db.vend[i]]);
      }
      return { day, vt, qtd, vendedores: [...vends].filter(Boolean).join(', ') };
    };
    const cupomXml = new Map(); // "lojaId|dia|cupom" → { cpf, k } (cupom com CPF na nota)
    for (const x of db.xml) {
      if (!x.cpf) continue;
      const lid = lojaId.get(x.loja);
      let itens = lid === undefined ? [] : porChave.get(x.cupom + '|' + lid) || [];
      if (x.data && itens.length) {
        const d = TS.isoToDay(x.data);
        itens = itens.filter((i) => Math.abs(db.day[i] - d) <= 1);
      }
      const c = cliente(x.cpf);
      if (!itens.length) {
        c.semVenda++; semVendaTotal++;
        // por que não casou: loja sem vendas, data fora do período das vendas, número em outra data ou número inexistente
        const d = x.data ? TS.isoToDay(x.data) : null;
        const mesmoNum = lid === undefined ? [] : porChave.get(x.cupom + '|' + lid) || [];
        let motivo;
        if (lid === undefined) motivo = 'loja sem vendas importadas';
        else if (d != null && (d < db.minDay - 1 || d > db.maxDay + 1)) motivo = 'data fora do período das vendas';
        else if (mesmoNum.length) {
          const outra = mesmoNum.map((i) => db.day[i]).sort((a, b) => Math.abs(a - d) - Math.abs(b - d))[0];
          motivo = `o número existe nas vendas, mas em ${fmt.date(TS.dayToIso(outra))}`;
        } else motivo = 'número do cupom não está no relatório de vendas';
        semVendaLista.push({ cpf: x.cpf, cupom: x.cupom, data: x.data || '', loja: x.loja, motivo });
        continue;
      }
      const k = { cupom: x.cupom, loja: x.loja, lojaId: lid, itens, ...resumo(itens) };
      c.cupons.push(k);
      for (const i of itens) cupomXml.set(lid + '|' + db.day[i] + '|' + x.cupom, { cpf: x.cpf, k });
    }
    // FIXE: compras do programa de fidelidade ligadas aos cupons (o FIXE não tem o número do cupom)
    const fx = TS.fx && TS.fx.tem() ? TS.fx.preparar() : null;
    const fixe = fx ? { alvos: fx.alvos, ligadas: fx.lig.length, confirmadas: 0, porFixe: 0, divergencias: [], semCupom: fx.semCupom, bases: fx.bases, movs: fx.movs } : null;
    if (fx) {
      for (const { m, c: cv } of fx.lig) {
        const x = cupomXml.get(cv.lojaId + '|' + cv.day + '|' + cv.cupom);
        if (x) {
          x.k.fxMov = m;
          if (x.cpf === m.cpf) { fixe.confirmadas++; x.k.fixeOk = true; continue; }
          // a nota saiu num CPF e os pontos foram para outro
          const dv = { cupom: cv.cupom, day: cv.day, lojaId: cv.lojaId, loja: db.D.loja[cv.lojaId], vt: x.k.vt, cpfNota: x.cpf, cpfFixe: m.cpf, nomeFixe: m.nome };
          x.k.cpfFixe = m.cpf;
          fixe.divergencias.push(dv);
          cliente(m.cpf, m.nome).divergencias.push(dv);
          continue;
        }
        // cupom sem CPF na nota: o cliente vem do FIXE
        const k = { cupom: cv.cupom, loja: db.D.loja[cv.lojaId], lojaId: cv.lojaId, itens: cv.itens, origem: 'fixe', fxMov: m, ...resumo(cv.itens) };
        cliente(m.cpf, m.nome).cupons.push(k);
        fixe.porFixe++;
      }
    }
    // vendas sem FIXE: nota no CPF de quem está no programa, depois do cadastro, e nenhum movimento no FIXE nesse dia
    // (o cliente pode ter esquecido de falar ou a loja não lançou: serve para rastrear e corrigir)
    if (fixe) {
      fixe.temLeads = (fx.bases || []).some((b) => b.membrosEm);
      fixe.temLogs = fx.logsAte != null;
      fixe.logsAte = fx.logsAte;
      fixe.semFixe = [];
      const rpp = ((fx.bases || [])[0] || {}).regras ? fx.bases[0].regras.reaisPorPonto : 50;
      for (const c of porCPF.values()) {
        if (c.empresa) continue;
        c.membroFixe = fx.membros.has(c.cpf);
        c.cadastroFixe = c.membroFixe ? fx.membros.get(c.cpf) : null;
        if (!c.membroFixe || !fixe.temLogs) continue;
        for (const k of c.cupons) {
          if (k.origem === 'fixe' || k.fixeOk || k.cpfFixe || k.day == null) continue;
          if (k.day >= fx.logsAte) continue;                               // depois da exportação dos Logs: ainda não dá para saber
          if (c.cadastroFixe != null && k.day <= c.cadastroFixe) continue; // antes de entrar no programa
          if (fx.movDia.has(c.cpf + '|' + k.day)) continue;
          k.semFixe = true;
          k.ptsPerdidos = Math.floor(k.vt / rpp + 1e-6);
          fixe.semFixe.push({ c, k });
        }
      }
    }
    const hoje = TS.todayDay();
    const lista = [];
    let soSemVenda = 0;
    const cuponsCPF = new Map(); // "cupom|lojaId" → cliente (para a % de vendas com CPF)
    const cha = TS.rules.ids.chaTotal;
    // vendedoras ativas = venderam nos últimos 60 dias dos dados (quem saiu da loja não vira {vendedora})
    let ultDia = 0; for (let i = 0; i < db.n; i++) if (db.day[i] > ultDia) ultDia = db.day[i];
    const vendAtivas = new Set();
    for (let i = 0; i < db.n; i++) if (db.day[i] > ultDia - 60) { const v = db.D.vendedor[db.vend[i]]; if (v) vendAtivas.add(v); }
    for (const c of porCPF.values()) {
      if (!c.cupons.length) { if (c.semVenda) soSemVenda++; continue; } // nenhuma compra encontrada nas vendas
      c.cupons.sort((a, b) => b.day - a.day);
      c.visitas = new Set(c.cupons.map((k) => k.cupom + '|' + k.loja + '|' + k.day)).size;
      c.ultima = c.cupons[0].day;
      c.primeira = c.cupons[c.cupons.length - 1].day;
      c.ausencia = hoje - c.ultima;
      c.idade = idade(c.nascimento);
      c.aniv = c.nascimento ? c.nascimento.slice(8, 10) + '/' + c.nascimento.slice(5, 7) : '';
      // ficha: frequência, chá favorito, pacote, vendedora, gasto 12 meses
      const dias = [...new Set(c.cupons.map((k) => k.day))].sort((a, b) => a - b);
      c.intervalo = dias.length >= 2 ? (dias[dias.length - 1] - dias[0]) / (dias.length - 1) : null;
      const diasCha = new Set(), porCha = new Map(), porTam = new Map(), porVend = new Map(), gramas = new Map(), atendeu = new Map();
      c.chaUltimo = null;
      c.gasto12 = 0; c.gasto12ant = 0;
      for (const k of c.cupons) {
        cuponsCPF.set(k.cupom + '|' + k.lojaId + '|' + k.day, c);
        if (k.day > hoje - 365) c.gasto12 += k.vt; else if (k.day > hoje - 730) c.gasto12ant += k.vt;
        for (const i of k.itens) {
          if (taxas.has(db.desc[i])) continue;
          const v = db.D.vendedor[db.vend[i]];
          if (v) { porVend.set(v, (porVend.get(v) || 0) + (db.vt[i] || 0)); (atendeu.get(v) || atendeu.set(v, new Set()).get(v)).add(k.cupom + '|' + k.loja + '|' + k.day); }
          // chá a granel/pacote (tem kg); xícaras e bebidas não contam
          if (!cha.has(db.grupo[i]) || !(db.cha[i] > 0)) continue;
          if (c.chaUltimo == null) c.chaUltimo = db.D.produto[db.prod[i]]; // cupons em ordem do mais novo
          diasCha.add(k.day);
          gramas.set(k.day, (gramas.get(k.day) || 0) + db.cha[i] * 1000);
          porCha.set(db.prod[i], (porCha.get(db.prod[i]) || 0) + db.cha[i]);
          if (db.so[i]) porTam.set(db.so[i], (porTam.get(db.so[i]) || 0) + (db.qtd[i] || 0));
        }
      }
      const maior = (m) => { let b = null; for (const [k, v] of m) if (!b || v > b[1]) b = [k, v]; return b ? b[0] : null; };
      const fav = maior(porCha);
      c.chaFavorito = fav != null ? db.D.produto[fav] : null;
      c.pacote = maior(porTam);
      c.vendedora = maior(porVend);
      // quem mais atendeu (nº de compras), entre as vendedoras que ainda estão na loja; empate → quem vendeu mais
      c.vendedoraPref = [...atendeu].filter(([v]) => vendAtivas.has(v)).sort((a, b) => b[1].size - a[1].size || (porVend.get(b[0]) || 0) - (porVend.get(a[0]) || 0)).map(([v]) => v)[0] || null;
      const dc = [...diasCha].sort((a, b) => a - b);
      c.ultimaCha = dc.length ? dc[dc.length - 1] : null;
      c.gramasUltima = c.ultimaCha != null ? Math.round(gramas.get(c.ultimaCha) || 0) : 0;
      // quando o chá da última compra deve acabar = gramas da última compra ÷ consumo por dia.
      // Consumo: pelo histórico da pessoa (chá comprado antes da última compra ÷ dias entre a 1ª e a última),
      // quando há pelo menos 60 dias de histórico; senão, ~3 g por dia (1 xícara). Fica entre 15 e 180 dias.
      c.gDia = null; c.reporEstimado = true;
      if (dc.length >= 2 && dc[dc.length - 1] - dc[0] >= 60) {
        let antes = 0; for (const [dia, g] of gramas) if (dia < c.ultimaCha) antes += g;
        const gd = antes / (dc[dc.length - 1] - dc[0]);
        if (gd > 0.3) { c.gDia = gd; c.reporEstimado = false; }
      }
      const gd = c.gDia || 3;
      c.intervaloCha = c.gramasUltima > 0 ? Math.min(180, Math.max(15, Math.round(c.gramasUltima / gd))) : null;
      c.proxCha = c.intervaloCha ? c.ultimaCha + c.intervaloCha : null;
      lista.push(c);
    }
    // segmentos (sobre o histórico todo)
    const gastos = lista.map((c) => c.gasto12).filter((v) => v > 0).sort((a, b) => b - a);
    const corteVip = gastos.length >= 10 ? gastos[Math.floor(gastos.length * 0.1) - 1] : Infinity;
    const hojeIso = TS.dayToIso(hoje), anoHoje = +hojeIso.slice(0, 4), mesHoje = +hojeIso.slice(5, 7) - 1;
    const proximos7 = new Set(Array.from({ length: 8 }, (_, k) => TS.dayToIso(hoje + k).slice(5, 10)));
    for (const c of lista) {
      const t = new Set();
      const p = new Date(c.primeira * 864e5);
      if (p.getUTCMonth() === mesHoje && p.getUTCFullYear() === anoHoje) t.add('novo');
      if (c.cupons.filter((k) => k.day > hoje - 365).length >= 5) t.add('fiel');
      if (c.gasto12 > 0 && c.gasto12 >= corteVip) t.add('vip');
      if (c.visitas === 1 && c.ausencia >= 30) t.add('uma');
      if (c.visitas >= 3 && c.intervalo && c.ausencia > Math.max(2 * c.intervalo, 60)) t.add('sumido');
      if (c.proxCha != null && hoje >= c.proxCha - 3 && hoje <= c.proxCha + 45) t.add('repor');
      if (c.nascimento && proximos7.has(c.nascimento.slice(5, 10))) t.add('aniv');
      c.fx = fx ? fx.porCpf.get(c.cpf) || null : null;
      if (c.fx && c.fx.em30 > 0) t.add('vence');
      if (c.cupons.some((k) => k.semFixe)) t.add('semfixe');
      if (fixe && fixe.temLeads && !c.empresa && !c.membroFixe) t.add('forafixe');
      c.tags = t;
    }
    // RFM: notas de 1 a 5 em recência, frequência e valor (12 meses) e o grupo; e o grupo de 30 dias atrás (movimento)
    const rfmHoje = calcRfm(lista, hoje), rfmAntes = calcRfm(lista, hoje - 30);
    for (const c of lista) { c.rfm = rfmHoje.get(c.cpf) || null; c.rfmAntes = rfmAntes.get(c.cpf) || null; }
    // quem tem pontos no FIXE mas nenhum cupom com CPF: entra nas campanhas pelo cadastro (nome e celular)
    const lojaAt = state.loja || '';
    const contatosAnt = TS.cli && TS.cli.contatosLoja === lojaAt ? TS.cli.contatos : null;
    TS.cli = { cad, lista, fixe, porCPF, fxPorCpf: fx ? fx.porCpf : null, semVendaTotal, semVendaLista, soSemVenda, cuponsXml: db.xml.length, cuponsCPF, contatos: contatosAnt, contatosLoja: contatosAnt ? lojaAt : null, cidades: [...new Set(db.clientes.map((c) => c.cidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')) };
  };
  // ---------- RFM (recência, frequência e valor): o comportamento de cada cliente em grupos ----------
  const GRUPOS_RFM = [
    ['campeao', '🏆 Campeões', 'Compram muito, sempre, e vieram há pouco.', 'Lançamentos e atenção VIP; peça indicação.'],
    ['leal', '💚 Leais', 'Compram com frequência e voltam.', 'Programa de pontos, novidades do tipo de chá favorito.'],
    ['novo', '✨ Novos', 'Primeira compra nos últimos 60 dias.', 'A 2ª compra é a mais importante: convide a voltar.'],
    ['promissor', '🌱 Promissores', 'Vieram há pouco, ainda compram pouco.', 'Apresente outros chás e o programa de pontos.'],
    ['atencao', '👀 Precisam de atenção', 'Bons clientes que estão espaçando as visitas.', 'Lembre do chá favorito antes que sumam.'],
    ['risco', '⚠️ Em risco', 'Vinham com frequência (2 compras ou mais no ano) e estão sumindo.', 'Contato pessoal já: mensagem com o chá favorito.'],
    ['naoperder', '🚨 Não pode perder', 'Estavam entre os melhores e pararam de vir.', 'Ligação ou oferta especial: são os que mais faziam diferença.'],
    ['hibernando', '😴 Hibernando', 'Compravam pouco e pararam há um tempo.', 'Campanha de volta, barata (novidades).'],
    ['perdido', '💤 Perdidos', 'Sem vir há muito tempo e compravam pouco.', 'Só em campanhas grandes; não gaste esforço individual.'],
  ];
  const RFM = Object.fromEntries(GRUPOS_RFM.map(([id, nome, dica, acao], ordem) => [id, { id, nome, dica, acao, ordem }]));
  TS.RFM = { GRUPOS: GRUPOS_RFM.map(([id]) => RFM[id]), por: RFM };
  /** notas por quintil dentro da loja (5 = melhor) e o grupo de cada cliente, olhando só as compras até o dia "ref" */
  function calcRfm(lista, ref) {
    const xs = [];
    for (const c of lista) {
      let ult = null, prim = null, val = 0;
      const dias = new Set();
      for (const k of c.cupons) {
        if (k.day > ref) continue;
        if (ult == null || k.day > ult) ult = k.day;
        if (prim == null || k.day < prim) prim = k.day;
        if (k.day > ref - 365) { dias.add(k.day); val += k.vt || 0; }
      }
      if (ult == null) continue;
      xs.push({ cpf: c.cpf, rec: ref - ult, freq: dias.size, val, prim, visitas: new Set(c.cupons.filter((k) => k.day <= ref).map((k) => k.day)).size });
    }
    const out = new Map();
    if (!xs.length) return out;
    // nota pela posição (empates ficam com a mesma nota): rec menor é melhor; freq e val maiores são melhores
    // frequência e valor: comparados só entre quem comprou nos 12 meses (quem não comprou fica com nota 1)
    const nota = (campo, melhorMenor) => {
      const ord = (campo === 'rec' ? xs : xs.filter((x) => x.freq > 0)).map((x) => x[campo]).sort((a, b) => a - b);
      if (!ord.length) return () => 1;
      return (v) => { let lo = 0, hi = ord.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ord[m] < v) lo = m + 1; else hi = m; } let up = lo; while (up < ord.length && ord[up] === v) up++; const pct = (lo + up) / 2 / ord.length; const n = Math.min(5, Math.floor(pct * 5) + 1); return melhorMenor ? 6 - n : n; };
    };
    // recência em dias corridos (o chá acaba em 1 a 2 meses): 5 = até 30 d, 4 = até 60, 3 = até 120, 2 = até 240, 1 = mais
    const nR = (d) => (d <= 30 ? 5 : d <= 60 ? 4 : d <= 120 ? 3 : d <= 240 ? 2 : 1), nF = nota('freq', false), nM = nota('val', false);
    for (const x of xs) {
      const r = nR(x.rec), f = x.freq ? nF(x.freq) : 1, m = x.val ? nM(x.val) : 1, fm = Math.round((f + m) / 2);
      const g = x.visitas === 1 && x.rec <= 60 ? 'novo' : r >= 4 && fm >= 4 ? 'campeao' : r >= 3 && fm >= 3 ? 'leal' : r >= 4 ? 'promissor'
        : r <= 2 && fm >= 4 && x.freq >= 2 ? 'naoperder' : r <= 2 && x.freq >= 2 ? 'risco' : r === 3 ? 'atencao' : r === 2 ? 'hibernando' : 'perdido';
      out.set(x.cpf, { r, f, m, g });
    }
    return out;
  }
  /**
   * Indicadores: "Saúde da base" no topo — quem está sumindo (movimento dos grupos RFM nos últimos 30 dias) e o caminho
   * para agir (a lista já filtrada e a tela Hoje). Mesmas contas do cartão dos grupos (cartaoRfm).
   */
  function cartaoSaude() {
    const todos = TS.cli.lista.filter((c) => c.rfm);
    if (!todos.length) return null;
    const BONS = new Set(['campeao', 'leal']), RUINS = new Set(['atencao', 'risco', 'naoperder', 'hibernando', 'perdido']);
    const pioraram = TS.cli.lista.filter((c) => c.rfm && c.rfmAntes && BONS.has(c.rfmAntes.g) && RUINS.has(c.rfm.g)).length;
    const n = (g) => todos.filter((c) => c.rfm.g === g).length;
    const antes = (g) => TS.cli.lista.filter((c) => c.rfmAntes && c.rfmAntes.g === g).length;
    const risco = n('risco') + n('naoperder'), perdidos = n('perdido'), dPerd = perdidos - antes('perdido');
    const ir = (g) => { state.cli.rfm = g; state.cli.seg = ''; location.hash = '#clilista'; };
    const pode = TS.pages && TS.pages.hoje;
    // redesenho (decisão do dono, 22/11/2026): o "como está" vira a 1ª coluna do herói e o "o que fazer" vira ações numeradas
    const col = { rot: 'Clientes bons sumindo', num: fmt.int(risco), estado: risco ? 'ruim' : null,
      dica: 'Clientes dos grupos "Não pode perder" e "Em risco": compravam bem e estão sumindo. Todos os clientes da loja, comparados com 30 dias atrás (não seguem o período nem os filtros).',
      linhas: [h('span', null, 'Não pode perder e Em risco'), pioraram ? h('span', { class: 'muted' }, `${fmt.int(pioraram)} ${pioraram === 1 ? 'era Campeão ou Leal' : 'eram Campeões ou Leais'} há 30 dias`) : null,
        h('span', null, `${fmt.int(perdidos)} ${perdidos === 1 ? 'perdido' : 'perdidos'}`, dPerd ? h('span', { class: dPerd > 0 ? 'neg' : 'pos' }, ` · ${dPerd > 0 ? '+' : '−'}${fmt.int(Math.abs(dPerd))} em 30 dias`) : null)] };
    const acoes = [
      pode ? { titulo: 'Mandar mensagem para quem está sumindo', texto: 'Sumindo, aniversariantes e hora de repor: a lista do dia já está pronta.', acao: { rotulo: 'Contatar → Hoje ›', href: '#hoje' } } : null,
      risco ? { titulo: `Ver os ${fmt.int(risco)} ${risco === 1 ? 'cliente bom que está sumindo' : 'clientes bons que estão sumindo'}`, texto: 'Na Lista de clientes, já filtrada pelo grupo.', acao: { rotulo: 'Ver na Lista ›', onclick: () => ir(n('naoperder') ? 'naoperder' : 'risco') } } : null,
      perdidos ? { titulo: `Ver os ${fmt.int(perdidos)} ${perdidos === 1 ? 'cliente perdido' : 'clientes perdidos'}`, texto: 'Não compram há muito tempo: uma oferta forte ou deixar de lado.', acao: { rotulo: 'Ver na Lista ›', onclick: () => ir('perdido') } } : null,
    ].filter(Boolean);
    return { col, acoes: acoes.length ? TS.cardSec('O que fazer agora', { sub: 'clientes da loja toda, comparados com 30 dias atrás' }, TS.acoesNum(acoes)) : null };
  }
  /** Indicadores: quantos clientes em cada grupo (RFM), quanto gastaram e quem mudou de grupo nos últimos 30 dias */
  function cartaoRfm() {
    const todos = TS.cli.lista.filter((c) => c.rfm);
    if (!todos.length) return TS.card('Grupos de clientes (RFM)', null, TS.empty('Sem clientes com compra identificada.'));
    const por = new Map(TS.RFM.GRUPOS.map((g) => [g.id, { n: 0, antes: 0, gasto: 0 }]));
    for (const c of todos) { const x = por.get(c.rfm.g); x.n++; x.gasto += c.gasto12 || 0; }
    for (const c of TS.cli.lista) if (c.rfmAntes) por.get(c.rfmAntes.g).antes++;
    const totG = [...por.values()].reduce((a, x) => a + x.gasto, 0) || 1;
    const ir = (g) => { state.cli.rfm = g; state.cli.seg = ''; location.hash = '#clilista'; };
    const linhas = TS.RFM.GRUPOS.map((g) => {
      const x = por.get(g.id), d = x.n - x.antes;
      return h('tr', { class: 'rfm-linha', role: 'button', tabindex: 0, title: `${g.dica} O que fazer: ${g.acao} (clique para ver a lista)`, onclick: () => ir(g.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(g.id); } } },
        h('td', { class: 'l' }, h('span', { class: 'cli-tag rfm-' + g.id }, g.nome)),
        h('td', null, fmt.int(x.n), h('small', { class: 'muted' }, ` ${fmt.pct(x.n / todos.length, 0)}`)),
        h('td', { class: d > 0 ? (['risco', 'naoperder', 'hibernando', 'perdido', 'atencao'].includes(g.id) ? 'neg' : 'pos') : d < 0 ? (['risco', 'naoperder', 'hibernando', 'perdido', 'atencao'].includes(g.id) ? 'pos' : 'neg') : 'muted' }, d === 0 ? '=' : (d > 0 ? '+' : '−') + fmt.int(Math.abs(d))),
        h('td', null, fmt.brl0(x.gasto), h('small', { class: 'muted' }, ` ${fmt.pct(x.gasto / totG, 0)}`)));
    });
    // quem piorou: dos bons grupos para os de risco nos últimos 30 dias
    const BONS = new Set(['campeao', 'leal']), RUINS = new Set(['atencao', 'risco', 'naoperder', 'hibernando', 'perdido']);
    const mov = new Map();
    for (const c of TS.cli.lista) if (c.rfm && c.rfmAntes && BONS.has(c.rfmAntes.g) && RUINS.has(c.rfm.g)) { const k = c.rfmAntes.g + '>' + c.rfm.g; mov.set(k, (mov.get(k) || 0) + 1); }
    const movs = [...mov].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return TS.card('Grupos de clientes (RFM)', 'Recência, frequência e valor (12 meses) comparados entre os clientes da loja · coluna "30 dias": quanto o grupo mudou no último mês · clique para ver a lista',
      h('div', { class: 'table-wrap free' }, h('table', { class: 't rfm-t' },
        h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Grupo'), h('th', null, 'Clientes'), h('th', null, '30 dias'), h('th', null, 'Gasto 12 meses'))),
        h('tbody', null, linhas))),
      movs.length ? h('div', { class: 'rfm-mov' }, h('b', null, 'Atenção: '), movs.map(([k, n]) => { const [a, b] = k.split('>'); return `${fmt.int(n)} ${n === 1 ? 'cliente passou' : 'clientes passaram'} de ${TS.RFM.por[a].nome} para ${TS.RFM.por[b].nome}`; }).join(' · '), '.') : null);
  }
  /** Indicadores: retenção por safra — dos clientes que compraram pela 1ª vez em cada mês, quantos % voltaram */
  function cartaoSafras() {
    const hoje = TS.todayDay(), JAN = [30, 60, 90, 180, 365];
    const meses = new Map();
    for (const c of TS.cli.lista) {
      if (c.primeira == null || c.primeira < hoje - 13 * 31) continue;
      const ym = TS.dayToIso(c.primeira).slice(0, 7);
      const voltou = c.cupons.filter((k) => k.day > c.primeira).map((k) => k.day);
      const x = meses.get(ym) || meses.set(ym, { n: 0, el: JAN.map(() => 0), v: JAN.map(() => 0) }).get(ym);
      x.n++;
      JAN.forEach((d, k) => { if (hoje - c.primeira >= d) { x.el[k]++; if (voltou.some((dd) => dd <= c.primeira + d)) x.v[k]++; } });
    }
    const yms = [...meses.keys()].sort().reverse().slice(0, 12);
    if (!yms.length) return TS.card('Retenção por safra', null, TS.empty('Sem clientes novos nos últimos 12 meses.'));
    const cor = (p) => `rgba(44, 82, 52, ${(0.08 + Math.min(1, p / 0.6) * 0.62).toFixed(2)})`;
    const linhas = yms.map((ym) => { const x = meses.get(ym); return h('tr', null, h('td', { class: 'l' }, TS.ymLabel(ym)), h('td', null, fmt.int(x.n)),
      ...JAN.map((d, k) => { if (!x.el[k] || x.el[k] < x.n * 0.5) return h('td', { class: 'muted safra-vazio', title: 'Ainda não deu tempo' }, '·'); const p = x.v[k] / x.el[k];
        return h('td', { class: 'safra-cel', style: { background: cor(p), color: p > 0.35 ? '#fff' : null }, title: `${fmt.int(x.v[k])} de ${fmt.int(x.el[k])} voltaram em até ${d} dias` }, fmt.pct(p, 0)); })); });
    return TS.card('Retenção por safra', 'Clientes pelo mês da 1ª compra: quantos % voltaram a comprar em até 30, 60, 90, 180 e 365 dias · mostra se a loja está segurando os clientes novos',
      h('div', { class: 'table-wrap free' }, h('table', { class: 't safra-t' },
        h('thead', null, h('tr', null, h('th', { class: 'l' }, '1ª compra'), h('th', null, 'Novos'), ...JAN.map((d) => h('th', null, d < 365 ? `${d} d` : '1 ano')))),
        h('tbody', null, linhas))));
  }
  const chipRfm = (c) => (c.rfm ? h('span', { class: 'cli-tag rfm-' + c.rfm.g, title: `${RFM[c.rfm.g].dica} Notas R${c.rfm.r} F${c.rfm.f} V${c.rfm.m} (1 a 5). O que fazer: ${RFM[c.rfm.g].acao}` }, RFM[c.rfm.g].nome) : null);
  TS.chipRfm = chipRfm;

  // ---------- contatos (contatado / não quer mensagens), guardados por loja no servidor ----------
  const NOMES_SEG = { hoje: 'Contatar hoje', aniv: 'Aniversário (7 dias)', sumido: 'Sumidos', repor: 'Hora de repor', vence: 'Pontos vencendo', semfixe: 'Compras sem FIXE', forafixe: 'Fora do FIXE', novo: 'Novos do mês', fiel: 'Fiéis', vip: 'VIP', uma: 'Uma compra só' };
  const DICA_SEG = {
    hoje: 'Aniversariantes da semana, sumidos, quem está na hora de repor e quem tem pontos do FIXE vencendo — sem quem recebeu mensagem dentro do intervalo entre mensagens da loja (21 dias, em Configurações) ou não quer mensagens.',
    vence: 'Têm pontos do programa de fidelidade (FIXE) que vencem nos próximos 30 dias.',
    semfixe: 'Estão no FIXE, mas têm compra com CPF na nota sem nenhum lançamento no FIXE naquele dia (não informou ou não foi lançado).',
    forafixe: 'Deram o CPF na nota, mas não estão na base do FIXE desta loja: dá para convidar a se cadastrar.',
    aniv: 'Fazem aniversário nos próximos 7 dias.',
    sumido: 'Compraram 3 vezes ou mais e estão sem vir há mais que o dobro do intervalo de costume (e mais de 60 dias).',
    repor: 'O chá a granel da última compra deve estar acabando: gramas levadas ÷ consumo por dia (pelo histórico da pessoa; sem histórico, ~3 g por dia).',
    novo: 'Primeira compra neste mês.', fiel: '5 compras ou mais nos últimos 12 meses.', vip: 'Os 10% que mais gastaram nos últimos 12 meses.', uma: 'Compraram uma vez só (há 30 dias ou mais) e não voltaram.',
  };
  const lojaIdDe = (c) => {
    if (!c.cupons || !c.cupons.length) return state.loja && state.loja !== 'todas' ? state.loja : TS.db.metas[0] && TS.db.metas[0].id;
    const nomeVenda = TS.db.D.loja[c.cupons[0].lojaId];
    const m = (TS.db.metas || []).find((x) => (x.nomesVenda || []).includes(nomeVenda));
    return m ? m.id : (TS.db.metas[0] && TS.db.metas[0].id);
  };
  const contatoDe = (c) => (TS.cli.contatos ? TS.cli.contatos[c.cpf] : null);
  /** trava contra mensagem insistente: dias mínimos entre duas mensagens para o mesmo cliente (Configurações → Lojas → Mensagens) */
  const intervaloDe = (lojaId) => { const m = (TS.db.metas || []).find((x) => x.id === lojaId); return (m && m.wppIntervalo) || 21; };
  TS.intervaloMsg = (lojaId) => intervaloDe(lojaId || state.loja);
  /** recebeu mensagem dentro do intervalo? → { dias, ate } ou null */
  const recebeuRecente = (c) => { const ct = contatoDe(c); if (!ct || !ct.em) return null; const iv = intervaloDe(lojaIdDe(c)), dd = Math.floor((Date.now() - Date.parse(ct.em)) / 864e5); return dd < iv ? { dias: dd, ate: new Date(Date.parse(ct.em) + iv * 864e5), iv, ct } : null; };
  let carregandoContatos = null;
  function carregarContatos() {
    const lojaAlvo = state.loja || '';
    if ((TS.cli.contatos && TS.cli.contatosLoja === lojaAlvo) || carregandoContatos === lojaAlvo) return;
    if (TS.demo) { TS.cli.contatos = {}; TS.cli.contatosLoja = lojaAlvo; return; }
    carregandoContatos = lojaAlvo;
    fetch('/api/contatos?loja=' + encodeURIComponent(lojaAlvo), { credentials: 'same-origin' }).then((r) => r.json())
      .then((j) => {
        if ((state.loja || '') !== lojaAlvo || !TS.cli) return;
        TS.cli.contatos = j.contatos || {};
        TS.cli.contatosLoja = lojaAlvo;
        if (state.page === 'clientes' || state.page === 'clilista' || state.page === 'hoje') TS.render();
      })
      .catch(() => { if ((state.loja || '') === lojaAlvo && TS.cli) { TS.cli.contatos = {}; TS.cli.contatosLoja = lojaAlvo; } })
      .finally(() => { if (carregandoContatos === lojaAlvo) carregandoContatos = null; });
  }
  /** busca de novo quem foi contatado (outra pessoa pode ter enviado de outro computador) */
  async function recarregarContatos() {
    const lojaAlvo = state.loja || '';
    if (TS.demo) { TS.cli.contatos = TS.cli.contatos || {}; TS.cli.contatosLoja = lojaAlvo; return; }
    try {
      const j = await (await fetch('/api/contatos?loja=' + encodeURIComponent(lojaAlvo), { credentials: 'same-origin' })).json();
      if (j.contatos && (state.loja || '') === lojaAlvo && TS.cli) { TS.cli.contatos = j.contatos; TS.cli.contatosLoja = lojaAlvo; }
    } catch { /* fica o que tinha */ }
  }
  async function marcar(c, acao, motivo, envio) {
    const loja = lojaIdDe(c);
    let novo, desfazerAte = null;
    if (TS.demo) {
      const a = { ...(TS.cli.contatos[c.cpf] || {}) };
      if (acao === 'contatado') Object.assign(a, { em: new Date().toISOString(), por: 'você', motivo });
      if (acao === 'optout') a.optout = true;
      if (acao === 'aceita') { delete a.optout; delete a.optoutOrigem; }
      if (acao === 'limpar') { delete a.em; delete a.motivo; }
      if (acao === 'contatado' && envio) { const ant = TS.cli.contatos[c.cpf]; a.desfazer = { antes: ant && ant.em ? { em: ant.em, por: ant.por, motivo: ant.motivo } : null }; }
      novo = a;
      if (envio) desfazerAte = new Date(Date.now() + 120e3).toISOString();
    } else {
      const r = await fetch('/api/contatos', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ loja, cpf: c.cpf, acao, motivo, ...(envio ? { envio: true, campanha: envio.campanha || '' } : {}) }) });
      const j = await r.json();
      if (!r.ok) { const e = new Error(j.erro || 'Falha ao salvar.'); e.bloqueado = !!j.bloqueado; throw e; }
      novo = j.contato ? { ...j.contato, loja } : null;
      desfazerAte = j.desfazerAte || null;
    }
    if (novo && Object.keys(novo).length) TS.cli.contatos[c.cpf] = novo; else delete TS.cli.contatos[c.cpf];
    return { desfazerAte };
  }
  /** "Desfazer" (Hoje): a mensagem não foi enviada — volta a marca de antes (o servidor só aceita de quem enviou, até 2 minutos depois) */
  async function desfazerEnvio(c) {
    const loja = lojaIdDe(c);
    if (TS.demo) {
      const a = TS.cli.contatos[c.cpf] || {};
      const antes = a.desfazer && a.desfazer.antes;
      const { em, por, motivo, desfazer, ...resto } = a;
      const novo = { ...resto, ...(antes || {}) };
      if (Object.keys(novo).length) TS.cli.contatos[c.cpf] = novo; else delete TS.cli.contatos[c.cpf];
      return;
    }
    const r = await fetch('/api/contatos/desfazer', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ loja, cpf: c.cpf }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Não deu para desfazer.');
    if (j.contato && Object.keys(j.contato).length) TS.cli.contatos[c.cpf] = { ...j.contato, loja }; else delete TS.cli.contatos[c.cpf];
  }
  /**
   * Link que abre a conversa vazia no WhatsApp (lista, tabela, ficha, janelas): regra forte também aqui (decisão do dono) —
   * o servidor confere antes (intervalo da loja, não quer, fila do robô) e NÃO marca contatado. espera: true (Lista de espera,
   * avisar que chegou é pedido do cliente) só trava quem não quer mensagens. A janela abre já no clique (senão o navegador bloqueia).
   */
  async function abrirConversaWpp(c, o = {}) {
    if (!c || !c.wpp) return false;
    if (TS.demo) { TS.avisar('Na apresentação o WhatsApp não abre (número fictício). No painel de verdade, o servidor confere antes se este cliente pode receber mensagem (intervalo da loja, não quer mensagens, fila do robô).'); return false; }
    const w = window.open('about:blank', '_blank');
    try {
      const r = await fetch('/api/contatos/conferir', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify({ loja: lojaIdDe(c), cpf: c.cpf, espera: o.espera === true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (w) w.close(); if (j.bloqueado) { TS.avisar(j.erro, { titulo: 'WhatsApp não aberto' }); await recarregarContatos(); } else TS.avisarErro(new Error(j.erro || 'Não deu certo.')); return false; }
    } catch (e) { if (w) w.close(); TS.avisarErro(e); return false; }
    if (w) { try { w.opener = null; } catch { /* ok */ } w.location.href = c.wpp; } else window.location.href = c.wpp;
    return true;
  }
  TS.abrirConversaWpp = (c, o) => abrirConversaWpp(c, o);
  /** link "● WhatsApp" que passa pela conferência (a mesma aparência de antes) */
  const linkConversa = (c, rot, cls = 'wpp') => h('a', { class: cls, href: '#', role: 'button', title: 'Abrir a conversa no WhatsApp (o painel confere antes se este cliente pode receber mensagem)', onclick: (e) => { e.preventDefault(); e.stopPropagation(); abrirConversaWpp(c); } }, rot);
  /**
   * Envio manual pelo WhatsApp (Hoje, ficha do cliente, fila de Campanhas). Regra forte (decisão do dono): o servidor confere
   * ANTES de o WhatsApp abrir — quem já recebeu mensagem dentro do intervalo da loja, quem não quer e quem está na fila do robô
   * não recebem; a pessoa vê o porquê (erro com `bloqueado`). A janela é aberta já no clique (senão o navegador a bloqueia) e
   * fecha se o servidor recusar. → true quando abriu.
   */
  async function enviarWpp(c, txt, motivo, campanha) {
    if (TS.demo) { const r = await marcar(c, 'contatado', motivo, { campanha }); TS.avisar('Na apresentação o WhatsApp não abre (número fictício). A mensagem seria:\n\n' + txt, { titulo: 'Mensagem de exemplo' }); return r; }
    const w = window.open('about:blank', '_blank');
    let r;
    try { r = await marcar(c, 'contatado', motivo, { campanha }); } catch (e) { if (w) w.close(); throw e; }
    const link = linkWpp(c, txt);
    if (w) { try { w.opener = null; } catch { /* ok */ } w.location.href = link; } else window.location.href = link;
    return r;
  }
  // modelos de mensagem (editáveis em Configurações → Lojas → Mensagens de WhatsApp)
  TS.WPP_PADRAO = [
    { nome: 'Aniversário', texto: 'Oi, {nome}! A equipe da {loja} deseja um feliz aniversário 🎉 Que tal passar aqui esta semana para comemorar com um chá?' },
    { nome: 'Sentimos sua falta', texto: 'Oi, {nome}! Faz um tempinho que você não passa na {loja}. Chegaram novidades que têm a sua cara — vem provar! 🍵' },
    { nome: 'Hora de repor', texto: 'Oi, {nome}! Seu {cha} já deve estar acabando 🍵 Quer que a gente separe um pacote para você na {loja}?' },
    { nome: 'Novidades', texto: 'Oi, {nome}! Temos novidades na {loja} e lembrei de você. Posso te mandar as opções?' },
    { nome: 'Pontos vencendo', texto: 'Oi, {nome}! Você tem {pontos} pontos no programa de fidelidade da {loja}, e parte deles vence em {vence}. Que tal usar numa visita? 🍵' },
  ];
  const modelosDe = (lojaId) => { const m = (TS.db.metas || []).find((x) => x.id === lojaId); return (m && m.wpp && m.wpp.length ? m.wpp : TS.WPP_PADRAO); };
  const nomeBonito = (n) => String(n || '').trim().toLowerCase().split(/\s+/).map((p, k) => (k && /^(da|de|do|das|dos|e)$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
  const saudacao = () => TS.msgWpp.saudacao(new Date().getHours());
  /** campos da mensagem (campanhas e WhatsApp): chave, o que é, e o que vai quando o cliente não tem o dado */
  TS.CAMPOS_MSG = [
    ['nome', 'primeiro nome'], ['nomecompleto', 'nome completo'], ['saudacao', 'Bom dia / Boa tarde / Boa noite (na hora do envio)'],
    ['vendedora', 'vendedora que mais atendeu o cliente (só quem vendeu nos últimos 60 dias; sem ela: "equipe da <loja>")', (c) => !c.vendedoraPref],
    ['apresentacao', '"Aqui é a <vendedora>, da <loja>" (sem vendedora: "Aqui é a equipe da <loja>")'],
    ['cha', 'chá favorito', (c) => !c.chaFavorito], ['ultimocha', 'último chá que comprou', (c) => !c.chaUltimo],
    ['pacote', 'tamanho de pacote que costuma levar (ex.: 100g)', (c) => !c.pacote],
    ['pontos', 'saldo de pontos'], ['vencepts', 'pontos que vencem na próxima data'], ['vence', 'data em que os próximos pontos vencem', (c) => !(c.fx && c.fx.prox != null)],
    ['ultimacompra', 'data da última compra'], ['dias', 'dias desde a última compra'], ['visitas', 'quantas vezes comprou'],
    ['aniversario', 'dia e mês do aniversário', (c) => !c.aniv], ['loja', 'nome da loja'],
  ];
  const primeiroNome = (n) => { const p = String(n || '').trim().split(/\s+/)[0] || ''; return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : ''; };
  /** valores dos {campos} da mensagem para este cliente (o robô do WhatsApp recebe estes mesmos valores) */
  function valoresWpp(c) {
    const lid = lojaIdDe(c);
    const loja = ((TS.lojas || []).find((l) => l.id === lid) || {}).nome || 'Tea Shop';
    const fx = c.fx || {};
    return {
      nome: primeiroNome(c.nome) || 'tudo bem', nomecompleto: nomeBonito(c.nome) || 'tudo bem', loja, cha: c.chaFavorito || 'chá',
      ultimocha: c.chaUltimo || c.chaFavorito || 'chá', pacote: c.pacote ? `${c.pacote}g` : '', vendedora: primeiroNome(c.vendedoraPref) || `equipe da ${loja}`, // "Aqui é a {vendedora}" → "Aqui é a equipe da Tea Shop…"
      pontos: fmt.int(fx.saldo || 0), vence: fx.prox != null ? fmt.date(TS.dayToIso(fx.prox)) : '—', vencepts: fmt.int(fx.proxPts || 0),
      ultimacompra: c.ultima != null ? fmt.date(TS.dayToIso(c.ultima)) : '—', dias: c.ausencia != null ? fmt.int(c.ausencia) : '—',
      aniversario: c.aniv || '—', visitas: fmt.int(c.visitas || 0), saudacao: saudacao(),
      apresentacao: primeiroNome(c.vendedoraPref) ? `Aqui é a ${primeiroNome(c.vendedoraPref)}, da ${loja}` : `Aqui é a equipe da ${loja}`, // Resumo diário: a vendedora que mais atende o cliente
    };
  }
  const textoWpp = (modelo, c) => TS.msgWpp.montar(modelo.texto, valoresWpp(c));
  const linkWpp = (c, txt) => (TS.demo ? '#demo' : TS.msgWpp.linkComTexto(c.wpp, txt));

  const digits = (s) => String(s || '').replace(/\D/g, '');
  /** aniversário para mostrar: dd/mm/aaaa quando o cadastro tem o ano de verdade (mesma conferência da idade); senão dd/mm. Mensagens usam c.aniv (dd/mm) */
  const anivTxt = (c) => (c.nascimento && c.idade != null ? `${c.aniv}/${c.nascimento.slice(0, 4)}` : c.aniv);
  function idade(iso) {
    if (!iso) return null;
    const n = new Date(), y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    let a = n.getFullYear() - y;
    if (n.getMonth() + 1 < m || (n.getMonth() + 1 === m && n.getDate() < d)) a--;
    // ano de mentira (1900) ou data do cadastro no lugar do nascimento: mantém o aniversário, sem idade
    return a >= 12 && a <= 105 ? a : null;
  }
  const faixa = (a) => (a == null ? null : a < 20 ? 'até 19' : a <= 29 ? '20 a 29' : a <= 39 ? '30 a 39' : a <= 49 ? '40 a 49' : a <= 59 ? '50 a 59' : '60+');

  // ---------- filtros ----------
  TS.filtrosClientes = function () {
    if (TS.garantirClientes) TS.garantirClientes();
    const s = state.cli, db = TS.db, box = h('div'), rerender = () => TS.render();
    const txt = (label, key, ph, mode) => {
      const i = h('input', { class: 'f-input', type: 'search', placeholder: ph, value: s[key], inputmode: mode || null });
      i.addEventListener('input', TS.debounce(() => { s[key] = i.value.trim(); rerender(); }, 500));
      return h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, label), i);
    };
    const faixaNum = (label, kMin, kMax, chips) => {
      const a = h('input', { class: 'f-input', type: 'number', min: 0, placeholder: 'de', value: s[kMin] });
      const b = h('input', { class: 'f-input', type: 'number', min: 0, placeholder: 'até', value: s[kMax] });
      TS.aoConfirmar(a, () => { s[kMin] = a.value; rerender(); });
      TS.aoConfirmar(b, () => { s[kMax] = b.value; rerender(); });
      return h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, label), h('div', { class: 'f-row' }, a, b),
        chips ? h('div', { class: 'chips' }, chips.map(([lab, mi, ma]) => h('button', { type: 'button', class: 'chip' + (String(s[kMin]) === String(mi) && String(s[kMax]) === String(ma) ? ' on' : ''), onclick: () => { s[kMin] = String(mi); s[kMax] = String(ma); rerender(); } }, lab))) : null);
    };
    // período das compras: o mesmo bloco das outras telas, mas guardado à parte (aqui o padrão é todo o histórico)
    const p = s.per;
    box.append(...TS.blocoPeriodo(p, rerender, { padrao: 'tudo', rotulo: 'Período',
      dica: h('small', { class: 'muted' }, p.de != null || p.ate != null || p.mes ? 'Valores, visitas e ticket só desse período. "Dias sem comprar" olha a última compra de verdade.' : `Todo o histórico (até ${fmt.date(TS.dayToIso(TS.todayDay()))}).`) }));
    box.append(
      txt('Nome', 'nome', 'Nome do cliente'),
      txt('CPF', 'cpf', 'Somente números', 'numeric'),
      txt('Telefone', 'tel', 'Número ou parte dele', 'tel'),
      txt('Cupom', 'cupom', 'Nº do cupom', 'numeric'),
      txt('Produto comprado', 'produto', 'Ex.: earl grey'),
      faixaNum('Visitas (cupons)', 'visMin', 'visMax', [['1', 1, 1], ['2 a 4', 2, 4], ['5+', 5, '']]),
      faixaNum('Dias sem comprar', 'ausMin', 'ausMax', [['30+', 30, ''], ['60+', 60, ''], ['90+', 90, ''], ['180+', 180, '']]),
    );
    const mes = h('select', { class: 'f-input' }, h('option', { value: '' }, 'Qualquer mês'), TS.MESES.map((m, i) => h('option', { value: String(i + 1).padStart(2, '0'), selected: s.aniv === String(i + 1).padStart(2, '0') || null }, m)));
    mes.addEventListener('change', () => { s.aniv = mes.value; rerender(); });
    const hojeMes = TS.hojeSP ? TS.hojeSP().slice(5, 7) : String(new Date().getMonth() + 1).padStart(2, '0');
    box.append(h('div', { class: 'f-group' }, h('span', { class: 'f-label' }, 'Aniversário'), mes,
      h('div', { class: 'chips' }, h('button', { type: 'button', class: 'chip' + (s.aniv === hojeMes ? ' on' : ''), onclick: () => { s.aniv = s.aniv === hojeMes ? '' : hojeMes; rerender(); } }, 'Aniversariantes do mês'))));
    if (db.opts.lojas.length > 1) box.append(TS.multiSelect({ label: 'Loja', options: db.opts.lojas, selected: s.lojas, onChange: rerender, placeholder: 'Todas as lojas' }));
    box.append(TS.multiSelect({ label: 'Grupo comprado', options: db.opts.grupos, selected: s.grupos, onChange: rerender }));
    if (TS.cli && TS.cli.cidades.length) box.append(TS.multiSelect({ label: 'Cidade (cadastro)', options: TS.cli.cidades.map((c) => [c, c]), selected: s.cidade, onChange: rerender, placeholder: 'Todas' }));
    return box;
  };

  /** o dia está no período escolhido nos Clientes? (só o mês = aquele mês em todos os anos) */
  function noPeriodoCli() {
    const p = state.cli.per;
    const de = p.de ?? -Infinity, ate = p.ate ?? Infinity, soMes = p.mes && !p.ano ? p.mes : null;
    if (de === -Infinity && ate === Infinity && !soMes) return null;
    return (day) => day >= de && day <= ate && (!soMes || new Date(day * 86400000).getUTCMonth() + 1 === soMes);
  }

  // ---------- aplicação dos filtros ----------
  /** telefone digitado na busca: só os dígitos, sem o 55 do Brasil na frente (quando veio com ele) */
  function telBusca(t) { const d = String(t).replace(/\D/g, ''); return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d; }
  /** o celular do cliente tem esse número (ou parte dele)? Aceita com ou sem o 9 da frente do celular */
  function telConfere(cel, q) {
    const d = telBusca(cel || '');
    if (!d || !q) return false;
    if (d.includes(q)) return true;
    const sem9 = (x) => (x.length === 11 && x[2] === '9' ? x.slice(0, 2) + x.slice(3) : null); // DDD + 9 + 8 dígitos → sem o 9
    const com9 = (x) => (x.length === 10 ? x.slice(0, 2) + '9' + x.slice(2) : null);
    return [sem9(q), com9(q)].some((v) => v && d.includes(v)) || [sem9(d), com9(d)].some((v) => v && v.includes(q));
  }
  function filtrar() {
    const s = state.cli, db = TS.db;
    const nome = TS.norm(s.nome), cpf = s.cpf.replace(/\D/g, ''), tel = telBusca(s.tel || ''), cupom = s.cupom.replace(/\D/g, ''), prod = TS.norm(s.produto);
    const num = (v) => (v === '' || v == null ? null : +v);
    const vMin = num(s.visMin), vMax = num(s.visMax), aMin = num(s.ausMin), aMax = num(s.ausMax);
    const filtraItens = prod || s.grupos.size;
    let prodOk = null;
    if (prod) { prodOk = new Uint8Array(db.D.descricao.length); db.D.descricao.forEach((t, i) => { if (TS.norm(t).includes(prod)) prodOk[i] = 1; }); }
    const noPer = noPeriodoCli();
    const out = [];
    for (const c of TS.cli.lista) {
      if (nome && !TS.norm(c.nome).includes(nome)) continue;
      if (cpf && !c.cpf.includes(cpf)) continue;
      if (tel && !telConfere(c.celular, tel)) continue;
      if ((aMin != null || aMax != null) && c.ausencia == null) continue;
      if (aMin != null && c.ausencia < aMin) continue;
      if (aMax != null && c.ausencia > aMax) continue;
      if (s.aniv && (!c.nascimento || c.nascimento.slice(5, 7) !== s.aniv)) continue;
      if (s.seg) {
        const ct = contatoDe(c);
        if (s.seg === 'hoje') {
          if (!(c.tags.has('aniv') || c.tags.has('sumido') || c.tags.has('repor') || c.tags.has('vence'))) continue;
          if (ct && (ct.optout || (ct.em && Date.now() - Date.parse(ct.em) < intervaloDe(lojaIdDe(c)) * 864e5))) continue;
        } else if (!c.tags.has(s.seg)) continue;
      }
      if (s.rfm && (!c.rfm || c.rfm.g !== s.rfm)) continue;
      if (s.cidade.size && !s.cidade.has(c.cidade)) continue;
      let cupons = c.cupons;
      if (noPer) cupons = cupons.filter((k) => noPer(k.day));
      if (s.lojas.size) cupons = cupons.filter((k) => s.lojas.has(k.lojaId));
      if (cupom) cupons = cupons.filter((k) => String(k.cupom).includes(cupom));
      if (filtraItens) {
        cupons = cupons.map((k) => {
          const itens = k.itens.filter((i) => (!prodOk || prodOk[db.desc[i]]) && (!s.grupos.size || s.grupos.has(db.grupoC[i])));
          return itens.length ? { ...k, itensFiltrados: itens } : null;
        }).filter(Boolean);
      }
      if (!cupons.length) continue;
      const visitas = cupons.length;
      if (vMin != null && visitas < vMin) continue;
      if (vMax != null && visitas > vMax) continue;
      const taxas = TS.rules.ids.taxas;
      // com filtro de produto/grupo, o valor é só dos itens filtrados
      const somaItens = (k) => { let v = 0, q = 0; for (const i of k.itensFiltrados) { if (taxas.has(db.desc[i])) continue; v += db.vt[i] || 0; q += TS.qtdItem(i); } return [v, q]; };
      let vt = 0, qtd = 0;
      for (const k of cupons) { const [v, q] = k.itensFiltrados ? somaItens(k) : [k.vt, k.qtd]; vt += v; qtd += q; }
      out.push({ c, cupons, visitas, vt, qtd, tkm: vt / visitas });
    }
    return out;
  }

  // ---------- Clientes → Hoje: quem contatar hoje e por quê (gerente, franqueado e admin; a vendedora não vê clientes) ----------
  const MOTIVOS_HOJE = {
    naoperder: { nome: '🚨 Não pode perder', modelo: 'Sentimos sua falta', peso: 100, dica: 'Cliente que comprava muito e com frequência e está sumindo (grupo "Não pode perder" da análise RFM). É o primeiro a contatar.' },
    risco: { nome: '⚠️ Em risco', modelo: 'Sentimos sua falta', peso: 90, dica: 'Cliente bom que está demorando mais que o normal para voltar (grupo "Em risco" da análise RFM).' },
    aniv: { nome: '🎂 Aniversário', modelo: 'Aniversário', peso: 80, dica: 'Faz aniversário nos próximos dias (data do cadastro).' },
    repor: { nome: '🍵 Hora de repor', modelo: 'Hora de repor', peso: 70, dica: 'Pelo ritmo de compra do cliente, o chá dele já deve estar acabando.' },
    validade: { nome: '🍃 Chá dele perto da validade', peso: 60, dica: 'O chá favorito (ou o último que comprou) tem lote na loja vencendo em menos de 60 dias (Estoque → Validade): dá para oferecer com condição especial.', texto: 'Oi, {nome}! O {chaoferta} que você gosta está com condição especial esta semana na {loja} 🍵 Quer que a gente separe um pacote para você?' },
    vence: { nome: '★ Pontos vencendo', modelo: 'Pontos vencendo', peso: 50, dica: 'Tem pontos do programa de fidelidade (FIXE) vencendo em breve.' },
    atencao: { nome: '👀 Precisa de atenção', modelo: 'Novidades', peso: 40, dica: 'Cliente médio que começou a espaçar as compras (grupo "Precisa de atenção" da análise RFM).' },
  };
  const hojeF = { motivo: '', vend: '' };
  /** meta do dia: (meta do mês − VENDAS DA META até ontem) ÷ dias de loja aberta que faltam (com hoje), e a parte de
   *  cada vendedora pelas HORAS dela na escala de hoje (TS.escalaTurnos, mapa.js); sem escala, partes iguais entre quem
   *  não está de férias — a conta é TS.metaDia.dividir (metadia.js). Vendas da meta = chá aromatizado, chá puro e
   *  acessórios, sem Espaço Gourmet: a mesma base da meta e do Comissionamento. Não muda a meta do mês nem a comissão. */
  function cartaoMetaDia() {
    const db = TS.db;
    if (!db || !db.n || !TS.metaCalc) return null;
    const hojeD = TS.todayDay(), hojeIso = TS.dayToIso(hojeD), ym = hojeIso.slice(0, 7);
    const meta = TS.metaCalc(ym).valor;
    if (!meta) return null;
    const ini = TS.isoToDay(ym + '-01');
    const I = TS.rules.ids;
    const naMeta = (i) => { const g = db.grupoC[i]; return !I.eg.has(db.cat[i]) && (I.arom.has(g) || I.puro.has(g) || I.acess.has(g)); };
    const idx = (de, ate) => TS.filtrar({ de, ate, ignorar: ['vendedores', 'grupos', 'cats', 'produto'], mesLivre: true }).filter(naMeta);
    const soma = (ii) => ii.reduce((s, i) => s + (db.vt[i] || 0), 0);
    const ateOntem = hojeD > ini ? soma(idx(ini, hojeD - 1)) : 0;
    const hojeIdx = db.maxDay >= hojeD ? idx(hojeD, hojeD) : [];
    // dias de loja aberta que faltam no mês (com hoje): horário de funcionamento da loja e feriados fechados
    const cfg = (db.metas || []).find((m) => m.id === state.loja) || null;
    const ultimo = TS.isoToDay(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10));
    let restam = 0;
    for (let d = hojeD; d <= ultimo; d++) if (TS.lojaAberta(cfg, TS.dayToIso(d))) restam++; // o mesmo "dia de loja aberta" da projeção
    const falta = Math.max(0, meta - ateOntem);
    const metaHoje = restam ? falta / restam : falta;
    const vendHoje = soma(hojeIdx);
    // quem vende na loja: quem teve pelo menos 3% das vendas da meta nos últimos 30 dias
    const part = new Map();
    for (const i of idx(hojeD - 30, hojeD - 1)) { const v = db.D.vendedor[db.vend[i]]; if (v) part.set(v, (part.get(v) || 0) + (db.vt[i] || 0)); }
    const tot30 = [...part.values()].reduce((a, b) => a + b, 0);
    const hojeV = new Map();
    for (const i of hojeIdx) { const v = db.D.vendedor[db.vend[i]]; if (v) hojeV.set(v, (hojeV.get(v) || 0) + (db.vt[i] || 0)); }
    const souVend = TS.eu && TS.eu.perfil === 'vendedor';
    const eu = souVend ? String(TS.eu.vendedor || '').toUpperCase() : null;
    const semV = (v) => /^SEM VENDEDOR$/i.test(String(v).trim());
    const quemVende = [...part].filter(([v, x]) => !semV(v) && x / tot30 >= 0.03).map(([v]) => v);
    // horas de cada pessoa na escala de hoje (a vendedora não recebe a escala dos colegas: partes iguais)
    const esc = !souVend && TS.escalaTurnos && TS.equipe ? TS.escalaTurnos(hojeIso, hojeIso) : null;
    let horas = null, semNome = [];
    if (esc) {
      const par = TS.equipe.calc.casarNomes(esc.pessoas, [...part.keys()].filter((v) => !semV(v)));
      horas = esc.turnos.filter((t) => par.has(t.nome)).map((t) => [par.get(t.nome), TS.equipe.calc.liquido(t)]);
      semNome = [...new Set(esc.turnos.filter((t) => !par.has(t.nome)).map((t) => t.nome))];
    }
    const DV = TS.metaDia.dividir({ meta: metaHoje, pessoas: quemVende, horas, semEscala: souVend ? 'sem-acesso' : 'nao-lancada', ferias: (cfg && cfg.ferias) || [], hoje: hojeIso });
    const vends = DV.partes.filter((p) => !eu || String(p.nome).toUpperCase() === eu);
    const hTxt = (min) => `${Math.floor(min / 60)}h${min % 60 ? String(Math.round(min % 60)).padStart(2, '0') : ''}`;
    const nomeBonito = (v) => String(v).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    const temHoje = db.maxDay >= hojeD;
    const barra = (feito, alvo) => h('div', { class: 'md-barra' }, h('i', { style: { width: Math.min(100, alvo ? (feito / alvo) * 100 : 0) + '%' } }));
    return h('div', { class: 'card md-card' },
      h('div', { class: 'md-topo' },
        h('div', null, h('div', { class: 'card-title' }, 'Meta de hoje'),
          h('div', { class: 'card-sub' }, `Falta ${fmt.brl0(falta)} para a meta do mês (${fmt.brl0(meta)}) em ${restam} ${restam === 1 ? 'dia' : 'dias'} de loja aberta`,
            TS.dica(`Meta de hoje = (meta do mês ${fmt.brl0(meta)} − vendas da meta até ontem ${fmt.brl0(ateOntem)}) ÷ ${restam} ${restam === 1 ? 'dia' : 'dias'} de loja aberta que faltam, contando hoje.\n\nVendas da meta = chá aromatizado, chá puro e acessórios, sem Espaço Gourmet: a mesma base do Comissionamento. O faturamento da loja (Resumo) é maior porque inclui o Espaço Gourmet e os outros grupos.`))),
        h('div', { class: 'md-num' }, h('b', null, fmt.brl0(metaHoje)), temHoje ? h('small', null, `vendas da meta hoje: ${fmt.brl0(vendHoje)}`) : h('small', null, 'as vendas de hoje chegam na próxima atualização'))),
      temHoje ? barra(vendHoje, metaHoje) : null,
      vends.length ? h('div', { class: 'md-vends' }, ...vends.map((p) => {
        const alvo = p.alvo, feito = hojeV.get(p.nome) || 0;
        return h('div', { class: 'md-v' }, h('span', { class: 'md-nome' }, nomeBonito(p.nome), p.minutos != null ? h('small', { class: 'muted' }, ` · ${hTxt(p.minutos)} na escala`) : null),
          h('span', { class: 'md-alvo' }, h('b', null, fmt.brl0(alvo)), temHoje ? h('small', null, ` · fez ${fmt.brl0(feito)}${feito >= alvo ? ' ✓' : ''}`) : null),
          temHoje ? barra(feito, alvo) : null);
      })) : null,
      h('small', { class: 'muted md-nota', 'data-divisao': DV.modo }, 'Conta só as vendas da meta (chás e acessórios, sem Espaço Gourmet). ', TS.metaDia.comoDividiu(DV),
        !eu && DV.fora.length ? ` ${DV.foraPorque === 'ferias' ? 'De férias hoje' : 'Sem turno na escala de hoje (folga, férias ou nome diferente do vendedor)'}: ${DV.fora.map(nomeBonito).join(', ')}.` : '',
        '',
        TS.dica(`Meta de hoje da loja: ${fmt.brl0(metaHoje)}.\n\nCom escala lançada: parte de cada pessoa = meta de hoje × horas dela na escala de hoje ÷ horas de todos que trabalham hoje (horas líquidas, sem o intervalo; a escala é a de Equipe → Movimento e escala, com os ajustes do mês).${DV.modo === 'escala' ? `\n\nHoje: ${DV.partes.map((p) => `${nomeBonito(p.nome)} ${hTxt(p.minutos)}`).join(' + ')} = ${hTxt(DV.total)}.` : ''}\n\nSem escala lançada (ou sem ninguém da escala com o mesmo nome do vendedor): partes iguais entre quem teve pelo menos 3% das vendas da meta nos últimos 30 dias e não está de férias hoje.\n\nÉ só o alvo do dia: a meta do mês e a comissão continuam como no Comissionamento.`)),
      // nome da escala que não bate com o vendedor das vendas: problema de cadastro, uma linha para quem pode corrigir
      !eu && semNome.length ? h('p', { class: 'warn-t md-escala' }, `⚠ Na escala de hoje, mas sem venda com esse nome: ${semNome.join(', ')} — as horas não entram na divisão. `,
        h('a', { href: '#mapa' }, 'Corrigir a escala ›'), TS.dica('O nome na escala (Equipe → Movimento e escala) precisa ser igual ao do vendedor nas vendas do AppNext. Corrija o nome na escala para as horas dessa pessoa entrarem na divisão da meta.')) : null);
  }
  /**
   * Quadro "Meta de hoje" (decisão do dono: fica no Início, onde todo mundo começa o dia; saiu de Clientes → Hoje).
   * TS.cartaoMetaDia() → elemento (card .md-card) ou null. Usa a loja do seletor (state.loja; com "todas" devolve null)
   * e os dados já carregados (TS.db, TS.metaCalc, TS.rules, TS.metaDia; a escala por TS.escalaTurnos/TS.equipe quando a
   * pessoa tem acesso). Não busca nada no servidor e não depende da lista de clientes.
   */
  TS.cartaoMetaDia = () => (state.loja && state.loja !== 'todas' ? cartaoMetaDia() : null);

  /**
   * Quem contatar hoje e por quê (tela Clientes → Hoje e Campanha Resumo diário, que roda também no servidor pelo robô):
   * com WhatsApp, sem "não quer", sem mensagem dentro do intervalo da loja; motivos em ordem de importância; o motivo cuja
   * mensagem cita um chá sem estoque (chá a granel: menos de 100 g) sai. val = TS.validade.dados (lotes), disp = TS.estoqueDisp.
   * → { itens: [{ c, ms, oferta, peso }], foraSemEstoque, contatadosHoje }
   */
  function hojeItens(val, disp) {
      // chás perto da validade (Estoque → Validade): nome normalizado → dias
      const perto = new Map();
      for (const l of (val && val.lotes) || []) if (l.dias != null && l.dias >= 0 && l.dias < 60) { const k = TS.norm(l.desc); if (!perto.has(k) || l.dias < perto.get(k).dias) perto.set(k, { dias: l.dias, desc: l.desc }); }
      const semTam = (t) => TS.norm(String(t || '')).replace(/\s*[-–]?\s*\d+\s*(g|gr|grs|gramas)\b.*$/, '').trim();
      // trava: não oferecer produto que a loja não tem (estoque 0 no AppNext e nenhuma nota de entrada depois do estoque)
      let foraSemEstoque = 0;
      const hojeIso = TS.hojeSP();
      let contatadosHoje = 0;
      const itens = [];
      for (const c of TS.cli.lista) {
        const ct = contatoDe(c);
        if (ct && ct.em && new Date(ct.em).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) === hojeIso) contatadosHoje++;
        if (!c.wpp || (ct && (ct.optout || (ct.em && Date.now() - Date.parse(ct.em) < intervaloDe(lojaIdDe(c)) * 864e5)))) continue;
        const ms = [];
        if (c.rfm && (c.rfm.g === 'naoperder' || c.rfm.g === 'risco' || c.rfm.g === 'atencao')) ms.push(c.rfm.g);
        if (c.tags.has('aniv')) ms.push('aniv');
        if (c.tags.has('repor')) ms.push('repor');
        let oferta = null;
        for (const t of [c.chaFavorito, c.chaUltimo]) { const x = t && perto.get(semTam(t)); if (x) { oferta = x.desc; break; } }
        if (oferta) ms.push('validade');
        if (c.tags.has('vence')) ms.push('vence');
        if (!ms.length) continue;
        // a mensagem do motivo cita o chá ({cha}/{ultimocha})? se ele está sem estoque (chá a granel: menos de 100 g), o motivo sai (volta quando chegar a nota)
        const mods0 = modelosDe(lojaIdDe(c));
        const txtDe = (m) => { const x = MOTIVOS_HOJE[m]; return x.texto || ((mods0.find((y) => y.nome === x.modelo) || mods0[0] || {}).texto || ''); };
        const antes = ms.length;
        for (let k = ms.length - 1; k >= 0; k--) if (TS.semEstoqueNaMensagem && TS.semEstoqueNaMensagem(disp, txtDe(ms[k]), c, { chaoferta: oferta })) ms.splice(k, 1);
        if (!ms.length) { if (antes) foraSemEstoque++; continue; }
        ms.sort((a, b) => MOTIVOS_HOJE[b].peso - MOTIVOS_HOJE[a].peso);
        itens.push({ c, ms, oferta, peso: MOTIVOS_HOJE[ms[0]].peso + ms.length + Math.min(9, (c.gasto12 || 0) / 500) });
      }
      itens.sort((a, b) => b.peso - a.peso);
      return { itens, foraSemEstoque, contatadosHoje };
  }

  TS.pages.hoje = function (root) {
    if (TS.subClientes) root.append(TS.subClientes('hoje'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Hoje'),
      h('div', { class: 'page-sub' }, 'Quem contatar hoje e por quê: uma mensagem por cliente, pelo WhatsApp da loja.'))));
    if (!TS.cli || !TS.cli.lista) { root.append(h('div', { class: 'notice' }, 'Os clientes ainda não foram carregados.')); return; }
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'Escolha uma loja no seletor do topo.')); return; }
    carregarContatos();
    // a "Meta de hoje" foi para o Início (decisão do dono, TS.cartaoMetaDia): aqui fica só a lista, no topo
    const corpo = h('div');
    root.append(corpo);
    let faixaDesf = null;
    const tirarFaixa = () => { if (faixaDesf) { clearTimeout(faixaDesf.t); faixaDesf.remove(); faixaDesf = null; } };
    /** depois de abrir o WhatsApp: "Fulana marcada como contatada · Desfazer" por 10 s (um toque sem querer não tira o cliente da lista) */
    const mostrarDesfazer = (c, val) => {
      tirarFaixa();
      const nome = primeiroNome(c.nome) || 'Cliente';
      const bt = h('button', { type: 'button', class: 'btn' }, 'Desfazer');
      const el = h('div', { class: 'hj-desfazer', role: 'status' }, h('span', null, `${nome} marcada como contatada.`), bt);
      bt.addEventListener('click', async () => {
        bt.disabled = true;
        try { await desfazerEnvio(c); tirarFaixa(); pintar(val); } catch (e) { tirarFaixa(); TS.avisarErro(e); await recarregarContatos(); pintar(val); }
      });
      el.t = setTimeout(tirarFaixa, 10000);
      faixaDesf = el;
      document.body.append(el);
      // trocou de tela: a faixa vai junto
      const ob = new MutationObserver(() => { if (!corpo.isConnected) { ob.disconnect(); tirarFaixa(); } });
      ob.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => ob.disconnect(), 11000);
    };
    const pintar = (val) => {
      const disp = (val && val.disp) || null;
      const { itens, foraSemEstoque, contatadosHoje } = hojeItens(val, disp);
      // Campanha Resumo diário com o robô: quem está na lista de hoje dele aparece com "🤖 o robô envia hoje" (sem botão)
      const rs = (val && val.resumo) || null;
      for (const x of itens) { x.robo = !!(rs && rs.pendentes.has(x.c.cpf)); x.comp = !!(rs && rs.comparacao && rs.comparacao.has(x.c.cpf)); }
      const nRobo = itens.filter((x) => x.robo).length;
      const irResumo = h('button', { type: 'button', class: 'link-btn', onclick: () => { TS.abrirResumo = true; location.hash = '#campanhas'; } }, rs ? 'Abrir a campanha' : 'Criar a Campanha Resumo diário');
      const faixaResumo = !TS.msgWpp ? null : h('p', { class: 'muted hj-resumo' }, '🤖 ',
        rs && rs.robo ? `${TS.msgWpp.NOME_RESUMO}: o robô do WhatsApp envia hoje ${fmt.int(nRobo)} ${nRobo === 1 ? 'mensagem' : 'mensagens'} desta lista (marcados com "o robô envia hoje"). O resto é com a equipe. `
          : rs ? `${TS.msgWpp.NOME_RESUMO} existe, mas não está enviando pelo robô agora: a equipe envia por aqui. `
            : 'Quer que o robô do WhatsApp envie parte desta lista sozinho, todo dia? ',
        irResumo, TS.dica('A Campanha Resumo diário usa esta mesma lista, só com os motivos escolhidos, uma mensagem por cliente (o motivo mais importante dele), assinada pela vendedora que mais o atende. Valem as mesmas travas: intervalo entre mensagens, quem não quer e estoque.'));
      const vends = [...new Set(itens.map((x) => x.c.vendedoraPref).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const sel = itens.filter((x) => (!hojeF.motivo || x.ms.includes(hojeF.motivo)) && (!hojeF.vend || x.c.vendedoraPref === hojeF.vend));
      const conta = (m) => itens.filter((x) => x.ms.includes(m)).length;
      const chip = (rot, valor, dica) => h('button', { type: 'button', class: 'chip' + (hojeF.motivo === valor ? ' on' : ''), 'aria-pressed': String(hojeF.motivo === valor), title: dica, onclick: () => { hojeF.motivo = valor && hojeF.motivo === valor ? '' : valor; pintar(val); } }, rot);
      const chips = h('div', { class: 'chips hj-chips', role: 'group', 'aria-label': 'Motivo' },
        chip(`Todos (${fmt.int(itens.length)})`, '', 'Todos os clientes para contatar hoje. Um cliente pode ter mais de um motivo: por isso a soma dos motivos passa do total.'),
        ...Object.entries(MOTIVOS_HOJE).filter(([m]) => conta(m)).map(([m, x]) => chip(`${x.nome} (${fmt.int(conta(m))})`, m, x.dica)));
      const selV = vends.length ? h('select', { class: 'f-input hj-vend', 'aria-label': 'Vendedora' }, h('option', { value: '' }, 'Todas as vendedoras'), ...vends.map((v) => h('option', { value: v, selected: hojeF.vend === v || null }, v))) : null;
      if (selV) selV.addEventListener('change', () => { hojeF.vend = selV.value; pintar(val); });
      const linha = (x) => {
        const c = x.c, m0 = MOTIVOS_HOJE[x.ms[0]];
        const mods = modelosDe(lojaIdDe(c));
        const txt = m0.texto ? TS.cliApi.texto(m0.texto, c, { chaoferta: x.oferta || c.chaFavorito || 'chá' }) : textoWpp(mods.find((m) => m.nome === m0.modelo) || mods[0], c);
        // a mensagem: duas linhas com reticências; tocar mostra inteira (o celular não mostra o title)
        const msg = h('button', { type: 'button', class: 'hj-msg', title: 'Ver a mensagem inteira', 'aria-expanded': 'false' }, txt);
        msg.addEventListener('click', () => { const ab = msg.classList.toggle('aberta'); msg.setAttribute('aria-expanded', String(ab)); });
        const el = h('div', { class: 'hj-item' },
          h('div', { class: 'hj-quem' }, h('button', { type: 'button', class: 'hj-nome', onclick: () => abrirClientes([c.cpf]), title: 'Abrir a ficha' }, c.nome || fmtCPF(c.cpf)),
            h('div', { class: 'hj-motivos' }, ...x.ms.map((m) => h('span', { class: 'hj-mot hj-' + m, title: MOTIVOS_HOJE[m].dica }, MOTIVOS_HOJE[m].nome))),
            h('small', { class: 'muted' }, [c.vendedoraPref && `atende: ${c.vendedoraPref}`, c.chaFavorito && `gosta de ${c.chaFavorito}`, x.oferta && `oferecer: ${x.oferta}`, c.ausencia != null && `${fmt.int(c.ausencia)} d sem vir`].filter(Boolean).join(' · '))),
          msg,
          h('div', { class: 'hj-acoes' }, x.comp ? h('span', { class: 'hj-robo', title: 'Sorteado hoje para o grupo de comparação da Campanha Resumo diário: fica sem mensagem para medir se a campanha traz clientes de volta. Mandar mensagem estragaria a medida.' }, '🤖 sem mensagem hoje (comparação)') : x.robo ? h('span', { class: 'hj-robo', title: 'Este cliente está na lista de hoje da Campanha Resumo diário: o robô do WhatsApp manda a mensagem sozinho. A equipe não envia (seria mensagem em dobro).' }, '🤖 o robô envia hoje') : h('button', { type: 'button', class: 'btn primary hj-wpp', onclick: async (e) => {
            const bt = e.currentTarget;
            bt.disabled = true;
            try {
              await enviarWpp(c, txt, 'Hoje · ' + m0.nome.replace(/^\S+\s/, ''));
              pintar(val); // sai da lista e "contatados hoje" já conta
              mostrarDesfazer(c, val);
            } catch (er) { bt.disabled = false; if (er.bloqueado) { TS.avisar(er.message); await recarregarContatos(); pintar(val); } else TS.avisarErro(er); }
          } }, 'WhatsApp')));
        return el;
      };
      const LIM = 30;
      const iv = intervaloDe(state.loja);
      const emRisco = itens.filter((x) => x.ms.includes('risco') || x.ms.includes('naoperder')).length;
      corpo.replaceChildren(
        h('div', { class: 'card hj-card' },
          h('div', { class: 'hj-cab' },
            h('div', { class: 'card-title' }, 'Para contatar hoje', TS.dica(`Clientes com WhatsApp, sem mensagem nos últimos ${iv} dias (de qualquer tela, campanha ou do robô) e que não pediram para não receber, com pelo menos um motivo para contatar.\n\nContatados hoje: clientes com mensagem aberta hoje pelo painel (Hoje, Lista e Campanhas) ou enviada pelo robô.`)),
            h('div', { class: 'hj-conta' }, h('b', null, fmt.int(itens.length)), ' para contatar · ', h('b', null, fmt.int(contatadosHoje)), ` ${contatadosHoje === 1 ? 'contatado' : 'contatados'} hoje`,
              emRisco ? ' · ' : null,
              emRisco ? h('button', { type: 'button', class: 'link-btn hj-risco', title: 'Mostrar só os clientes bons que estão sumindo (Não pode perder; sem nenhum, Em risco)', onclick: () => { hojeF.motivo = conta('naoperder') ? 'naoperder' : 'risco'; pintar(val); } }, `${fmt.int(emRisco)} em risco`) : null)),
          faixaResumo,
          h('div', { class: 'hj-ferr' }, chips, selV),
          sel.length ? h('div', { class: 'hj-lista' }, ...sel.slice(0, LIM).map(linha)) : TS.empty('Ninguém para contatar com esses filtros. 🎉'),
          sel.length > LIM ? h('p', { class: 'muted' }, `Mostrando os ${LIM} mais importantes de ${fmt.int(sel.length)}. Depois de contatar, a lista anda.`) : null,
          foraSemEstoque ? h('p', { class: 'muted hj-fora' }, `🚫 ${fmt.int(foraSemEstoque)} cliente${foraSemEstoque === 1 ? '' : 's'} fora da lista: a mensagem citaria um chá sem estoque (no chá a granel, menos de 100 g). Voltam quando chegar a nota de entrada do chá.`) : null,
          h('small', { class: 'muted hj-rodape' }, 'Ordem: quem é mais importante primeiro (clientes bons sumindo, aniversário, hora de repor…). Ao abrir o WhatsApp, o cliente fica marcado como contatado e sai da lista (se a mensagem não foi enviada, dá para desfazer por alguns segundos). Mande poucas por vez para o WhatsApp não restringir o número.')));
    };
    // espera o estoque (chá a granel) para não mostrar quem receberia mensagem de chá que a loja não tem
    if (!TS.validade) pintar(null);
    else {
      corpo.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Conferindo o estoque dos chás…')))));
      Promise.all([TS.validade.dados(state.loja).catch(() => null), TS.estoqueDisp(state.loja).catch(() => null), TS.resumoDoDia ? TS.resumoDoDia(state.loja).catch(() => null) : null]).then(([v, disp, resumo]) => {
        if (!corpo.isConnected) return;
        pintar({ ...(v || {}), disp, resumo });
        if (!disp) corpo.prepend(h('div', { class: 'notice' }, 'Não consegui ler o estoque agora: a lista não está conferindo se o produto citado na mensagem tem em estoque.'));
      });
    }
  };

  // ---------- página ----------
  // Clientes → Lista de clientes (só a lista, com segmentos) e Indicadores (base, fidelidade, números e gráficos)
  TS.pages.clilista = (root) => telaClientes(root, 'lista');
  TS.pages.clientes = (root) => telaClientes(root, 'indicadores');
  function telaClientes(root, modo) {
    const db = TS.db, s = state.cli, ehLista = modo === 'lista';
    if (TS.subClientes) root.append(TS.subClientes(ehLista ? 'clilista' : 'clientes'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, ehLista ? 'Lista de clientes' : 'Indicadores de clientes'),
      h('div', { class: 'page-sub' }, ehLista ? 'Cada cliente com a ficha, os cupons e os itens; segmentos para saber quem contatar' : 'Base de clientes, fidelidade e o perfil de quem compra (cupons identificados por CPF)'))));
    if (!db.xml.length && !(TS.fx && TS.fx.tem())) { root.append(h('div', { class: 'notice' }, 'A planilha "Xml" (cupons com CPF) não foi carregada.')); return; }
    carregarContatos();
    // os segmentos (Contatar hoje, VIP…) são da lista: nos indicadores valem só os filtros da barra lateral
    const segSalvo = s.seg, rfmSalvo = s.rfm;
    if (!ehLista) { s.seg = ''; s.rfm = ''; }
    const lista = filtrar();
    s.seg = segSalvo; s.rfm = rfmSalvo;
    if (!ehLista && TS.cli.semVendaTotal) {
      const pct = TS.cli.semVendaTotal / TS.cli.cuponsXml;
      root.append(h('div', { class: 'notice cli-semvenda' + (pct > 0.2 ? ' err' : ''), role: 'button', tabindex: '0', title: 'Clique para ver a lista', onclick: abrirSemVenda, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirSemVenda(); } } },
        h('b', null, `${fmt.int(TS.cli.semVendaTotal)} cupons com CPF (${fmt.pct(pct, 0)}) não foram encontrados nas vendas`),
        ` e ficaram de fora das contas${TS.cli.soSemVenda ? ` (${fmt.int(TS.cli.soSemVenda)} CPFs só têm cupons assim)` : ''}. Normalmente são vendas fora do período importado ou números de cupom que não batem com o relatório de vendas. `,
        h('span', { class: 'link-btn' }, 'Ver a lista ›')));
    }

    if (!ehLista) {
      // o veredito primeiro (decisão do dono, revisão de 22/11): quem está sumindo e o caminho para agir
      const saude = cartaoSaude();
      // cada seção diz a quais filtros responde (antes o filtro mudava um quadro e não os outros, sem aviso)
      const alcance = (t) => h('p', { class: 'muted cli-alcance' }, t);
      const base = baseDeClientes(lista);
      root.append(TS.heroi([saude && saude.col, ...base.cols], { titulo: 'Saúde da base' }),
        alcance('Clientes sumindo: a loja toda, comparada com 30 dias atrás. Vendas com CPF e recompra: período e loja dos filtros (a recompra e os clientes novos seguem também os filtros de cliente — nome, CPF, cupom…).'));
      if (saude && saude.acoes) root.append(h('div', { class: 'mt' }, saude.acoes));
      root.append(...base.resto);
      root.append(TS.section('Comportamento dos clientes'), alcance('Todos os clientes da loja, pelos últimos 12 meses: não seguem o período nem os filtros de cliente.'), h('div', { class: 'grid g-2 rfm-grid' }, cartaoRfm(), cartaoSafras()));
      if (TS.cli.fixe) { root.append(TS.section('Fidelidade')); const cr = cartaoResgate(TS.cli.fixe); if (cr) root.append(cr); const rf = TS.cartaoRetornoFid && TS.cartaoRetornoFid(TS.cli.fixe); if (rf) root.append(rf); root.append(cartaoFixe(TS.cli.fixe)); }
      root.append(TS.section('Perfil dos clientes'), alcance('Seguem todos os filtros (período, loja e os filtros de cliente).'));
    }

    const ordem = s.ordem;
    const ORD = { recente: (a, b) => (b.c.ultima ?? -1) - (a.c.ultima ?? -1), valor: (a, b) => b.vt - a.vt, visitas: (a, b) => b.visitas - a.visitas, ausencia: (a, b) => (b.c.ausencia ?? -1) - (a.c.ausencia ?? -1), nome: (a, b) => (a.c.nome || 'zzz').localeCompare(b.c.nome || 'zzz', 'pt-BR') };
    lista.sort(ORD[ordem] || ORD.recente);

    const tot = lista.reduce((t, r) => t + r.vt, 0);
    const comWpp = lista.filter((r) => r.c.wpp).length;
    const visMed = lista.length ? lista.reduce((t, r) => t + r.visitas, 0) / lista.length : null;
    const mesAtual = String(new Date().getMonth() + 1).padStart(2, '0');
    const anivMes = lista.filter((r) => r.c.nascimento && r.c.nascimento.slice(5, 7) === mesAtual).length;
    if (!ehLista) root.append(h('div', { class: 'grid g-kpi' },
      TS.kpi('Clientes', fmt.int(lista.length), `de ${fmt.int(TS.cli.lista.length)} com compra identificada`),
      TS.kpi('Faturamento desses clientes', fmt.brl0(tot)),
      TS.kpi('Visitas por cliente', fmt.n1(visMed), 'média'),
      TS.kpi('Com WhatsApp', fmt.int(comWpp), lista.length ? fmt.pct(comWpp / lista.length, 0) + ' do filtro' : null),
      TS.kpi('Aniversariantes do mês', fmt.int(anivMes), TS.MESES[+mesAtual - 1])));

    // ---- lista
    const listBox = h('div', { class: 'cli-list' });
    const PAG = 40;
    let mostrados = 0;
    const mais = h('button', { class: 'btn', type: 'button', style: { margin: '12px auto 0', display: 'block' } });
    const paint = () => {
      const fim = Math.min(lista.length, mostrados + PAG);
      for (let k = mostrados; k < fim; k++) listBox.append(clienteCard(lista[k]));
      mostrados = fim;
      mais.textContent = `Mostrar mais (${fmt.int(lista.length - mostrados)} restantes)`;
      mais.style.display = mostrados < lista.length ? 'block' : 'none';
    };
    mais.addEventListener('click', paint);
    if (ehLista) paint(); // nos Indicadores a lista não aparece: não monta os cartões à toa

    const segBar = h('div', { class: 'cli-segs' }, h('span', { class: 'f-label' }, 'Segmentos:'),
      Object.entries(NOMES_SEG).filter(([k]) => !['vence', 'semfixe', 'forafixe'].includes(k) || TS.cli.fixe).map(([k, nome]) => h('button', { type: 'button', class: 'chip' + (s.seg === k ? ' on' : '') + (k === 'hoje' ? ' chip-destaque' : ''), title: DICA_SEG[k], onclick: () => { s.seg = s.seg === k ? '' : k; TS.render(); } }, nome)),
      s.seg ? h('small', { class: 'muted cli-seg-dica' }, DICA_SEG[s.seg]) : null,
      h('div', { class: 'cli-segs-rfm' }, h('span', { class: 'f-label' }, 'Grupos (RFM):', TS.dica('Cada cliente ganha uma nota de 1 a 5 em Recência (até 30, 60, 120, 240 dias ou mais sem vir), Frequência e Valor (últimos 12 meses, comparando com os outros clientes da loja). As notas viram o grupo.')),
        ...TS.RFM.GRUPOS.map((g) => h('button', { type: 'button', class: 'chip rfm-chip rfm-' + g.id + (s.rfm === g.id ? ' on' : ''), title: `${g.dica} O que fazer: ${g.acao}`, onclick: () => { s.rfm = s.rfm === g.id ? '' : g.id; TS.render(); } }, g.nome)),
        s.rfm ? h('small', { class: 'muted cli-seg-dica' }, `${RFM[s.rfm].dica} O que fazer: ${RFM[s.rfm].acao}`) : null));
    const ordSel = TS.seg([['Mais recentes', 'recente'], ['Maior valor', 'valor'], ['Mais visitas', 'visitas'], ['Mais tempo sem vir', 'ausencia'], ['Nome', 'nome']], ordem, (v) => { s.ordem = v; TS.render(); });
    const csv = h('button', { class: 'btn', type: 'button', onclick: () => baixarCSV(lista) }, 'Baixar lista (CSV)');
    const csvWpp = h('button', { class: 'btn', type: 'button', title: 'Só nome e celular de quem tem WhatsApp e não pediu para não receber mensagens', onclick: () => baixarCSVWpp(lista) }, 'Lista para WhatsApp (CSV)');
    const listaCard = TS.cardWithTools(ehLista ? `${fmt.int(lista.length)} ${lista.length === 1 ? 'cliente' : 'clientes'}` : 'Lista de clientes', 'Clique num cliente para ver a ficha, os cupons e os itens', h('div', { class: 'table-tools' }, ordSel, csv, csvWpp),
      segBar, lista.length ? listBox : TS.empty('Nenhum cliente com esses filtros.'), mais);

    if (ehLista) { root.append(listaCard); return; }
    // ---- gráficos do perfil dos clientes
    const lado = h('div', { class: 'grid g-2 mt', style: { alignItems: 'start' } });
    // top chás desses clientes
    const prodVal = new Map();
    for (const r of lista) for (const k of r.cupons) for (const i of (k.itensFiltrados || k.itens)) {
      if (!TS.rules.ids.catChaKg.has(db.cat[i]) && !TS.rules.ids.arom.has(db.grupoC[i]) && !TS.rules.ids.puro.has(db.grupoC[i])) continue;
      prodVal.set(db.prod[i], (prodVal.get(db.prod[i]) || 0) + (db.vt[i] || 0));
    }
    const topCha = [...prodVal].sort((a, b) => b[1] - a[1]).slice(0, 5);
    lado.append(TS.card('Chás mais comprados', lista.length === 1 ? 'por este cliente' : 'pelos clientes do filtro (R$)', topCha.length ? TS.chart({
      type: 'doughnut',
      data: { labels: topCha.map(([p]) => db.D.produto[p]), datasets: [{ data: topCha.map(([, v]) => v), backgroundColor: TS.cores.slice(0, 5), borderWidth: 2, borderColor: '#fff' }] },
      options: { cutout: '58%', plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${fmt.brl(c.raw)}` } } } },
    }) : TS.empty()));
    const top = (arr, key, fm, titulo, sub) => {
      const rows = arr.filter((r) => r[key] != null).sort((a, b) => b[key] - a[key]).slice(0, 5);
      return TS.card(titulo, sub, rows.length ? TS.chart({
        type: 'bar',
        data: { labels: rows.map((r) => { const n = r.c.nome || r.c.cpf; return n.length > 16 ? n.slice(0, 15) + '…' : n; }), datasets: [{ data: rows.map((r) => r[key]), backgroundColor: '#2C5234', borderRadius: 4, maxBarThickness: 18 }] },
        options: { indexAxis: 'y', layout: { padding: { left: 8, right: 80 } }, plugins: { legend: { display: false }, valueLabels: { display: true, format: fm }, tooltip: { callbacks: { label: (c) => fm(c.raw) } } }, scales: { x: { display: false }, y: { grid: { display: false }, ticks: { font: { size: 11 }, crossAlign: 'far' } } } },
      }, 'short') : TS.empty());
    };
    lado.append(top(lista, 'vt', fmt.brl0, 'Top 5 em faturamento', 'Clientes do filtro'));
    lado.append(top(lista.filter((r) => r.cupons.length >= 2), 'tkm', fmt.brl, 'Top 5 em ticket médio', 'Clientes com 2 ou mais compras'));
    const faixas = ['até 19', '20 a 29', '30 a 39', '40 a 49', '50 a 59', '60+'];
    const cont = Object.fromEntries(faixas.map((f) => [f, 0]));
    let semData = 0;
    for (const r of lista) { const f = faixa(r.c.idade); if (f) cont[f]++; else semData++; }
    const comData = lista.length - semData;
    lado.append(TS.card('Faixa etária', `${fmt.int(comData)} clientes com data de nascimento`, comData ? TS.chart({
      type: 'bar', data: { labels: faixas, datasets: [{ data: faixas.map((f) => cont[f]), backgroundColor: '#C9A227', borderRadius: 4 }] },
      options: { plugins: { legend: { display: false }, valueLabels: { display: true, format: (v) => `${v} (${fmt.pct(v / comData, 0)})` } }, scales: { y: { display: false, grace: '15%' }, x: TS.axisCat } },
    }, 'short') : TS.empty()));

    const junto = cartaoLevamJunto();
    if (junto) lado.prepend(junto);
    root.append(lado);
  }

  function clienteCard(r) {
    const db = TS.db, c = r.c;
    const nome = c.nome || 'Cliente sem cadastro';
    const card = h('div', { class: 'cli' });
    const ausTxt = c.ausencia == null ? '—' : c.ausencia === 0 ? 'hoje' : `${fmt.int(c.ausencia)} d`;
    const head = h('div', { class: 'cli-head', role: 'button', tabindex: 0, 'aria-expanded': 'false' },
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'cli-name', title: nome }, nome),
        h('div', { class: 'cli-meta' },
          h('span', null, fmtCPF(c.cpf)), c.empresa ? h('span', { class: 'cli-emp' }, 'empresa') : null,
          c.idade != null ? h('span', null, `${c.idade} anos`) : null,
          c.aniv ? h('span', null, '🎂 ' + anivTxt(c)) : null,
          c.cidade ? h('span', null, c.cidade) : null,
          c.fx && c.fx.saldo ? h('span', { class: 'cli-pts', title: c.fx.prox != null ? `Saldo no FIXE · ${fmt.int(c.fx.proxPts)} pts vencem em ${fmt.date(TS.dayToIso(c.fx.prox))}` : 'Saldo no FIXE' }, `★ ${fmt.int(c.fx.saldo)} pts`) : null,
          chipRfm(c),
          ...[...(c.tags || [])].map((t) => h('span', { class: 'cli-tag t-' + t, title: DICA_SEG[t] }, NOMES_SEG[t])),
          (() => { const ct = contatoDe(c); return ct && ct.optout ? h('span', { class: 'cli-tag t-optout', title: 'Pediu para não receber mensagens' }, 'não quer mensagens') : ct && ct.em ? h('span', { class: 'cli-tag t-contato', title: `Contatado por ${ct.por || '?'}${ct.motivo ? ' · ' + ct.motivo : ''}` }, 'contatado ' + fmt.date(ct.em.slice(0, 10))) : null; })(),
          c.wpp ? linkConversa(c, '● WhatsApp') : null)),
      h('div', { class: 'cli-stat' }, fmt.int(r.visitas), h('small', null, 'visitas')),
      h('div', { class: 'cli-stat' }, fmt.brl0(r.vt), h('small', null, 'total')),
      h('div', { class: 'cli-stat hide-sm' }, fmt.brl(r.tkm), h('small', null, 'ticket')),
      h('div', { class: 'cli-stat hide-sm' }, c.ultima != null ? fmt.date(TS.dayToIso(c.ultima)) : '—', h('small', null, 'última')),
      h('div', { class: 'cli-stat hide-sm' }, ausTxt, h('small', null, 'sem vir')),
      h('div', { class: 'cli-caret' }, '›'));
    const body = h('div', { class: 'cli-body' });
    let aberto = false;
    // clicar no cliente abre a mesma janela usada em todo o painel (ficha, contato, cupons e fidelidade)
    const toggle = () => abrirClientes([c.cpf]);
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    card.append(head, body);
    return card;
  }
  /** ficha, ações, avisos e cupons de um cliente (lista e janela) */
  function corpoCliente(c, r, destaque) {
    const db = TS.db, out = [];
    const hm = (m) => (m.min != null ? ` ${String(Math.floor(m.min / 60)).padStart(2, '0')}:${String(m.min % 60).padStart(2, '0')}` : '');
    // na janela de comparação: o que o FIXE registrou para este CPF no dia do cupom
    if (destaque && destaque.day != null && c.fx) {
      const doDia = c.fx.movs.filter((m) => m.day === destaque.day);
      out.push(h('div', { class: 'cupom-aviso fx-dia' }, h('b', null, `No FIXE em ${fmt.date(TS.dayToIso(destaque.day))}: `),
        doDia.length ? h('ul', { class: 'fi-lista' }, doDia.map((m) => h('li', { class: m.anulado ? 'anulado' : null }, h('b', null, hm(m).trim() || 'sem hora'), ' · ', TIPO_MOV[m.tipo] || m.tipo, m.pontos ? ` · ${m.pontos} pts` : '', m.produtos.length ? h('small', null, ' — ' + m.produtos.join(', ')) : null)))
          : 'nenhum movimento neste dia.'));
    }
    if (c.cupons.length) out.push(fichaCliente(c, r), destaque && destaque.cpfNota ? null : acoesCliente(c));
    else {
      const f = blocoFidelidade(c);
      const item = (rot, val) => (val ? h('div', { class: 'fi' }, h('span', null, rot), h('b', null, val)) : null);
      const tel = fmtTel(c.celular);
      const contato = [tel ? h('div', { class: 'fi' }, h('span', null, 'Celular', celDica(c)), h('b', null, tel), celNota(c)) : celNota(c), item('E-mail', c.email), item('Cidade', c.cidade), item('Aniversário', c.aniv ? `${anivTxt(c)}${c.idade != null ? ` · ${c.idade} anos` : ''}` : null)].filter(Boolean);
      out.push(h('div', { class: 'cli-ficha' }, contato.length ? h('div', { class: 'fi-bloco' }, h('div', { class: 'fi-tit' }, 'Contato (cadastro do FIXE)'), ...contato) : null,
        f || h('div', { class: 'fi-bloco fi-largo' }, h('div', { class: 'fi-nota' }, 'Sem dados no FIXE.'))),
        h('p', { class: 'muted', style: { margin: '0 0 8px', fontSize: '12px' } }, 'Nenhuma compra com este CPF na nota foi encontrada nas vendas.'));
    }
    for (const dv of c.divergencias || []) out.push(h('div', { class: 'cupom-aviso' }, h('span', { class: 'cli-tag t-semfixe', style: { marginLeft: 0, marginRight: '6px' } }, 'CPF diferente no FIXE'), `Cupom ${dv.cupom} de ${fmt.date(TS.dayToIso(dv.day))} (${fmt.brl(dv.vt)}): compra feita no CPF `, cpfLink(dv.cpfNota, { cupom: dv.cupom, day: dv.day, cpfNota: dv.cpfNota }, c.cpf), ', mas foi usado o CPF deste cliente no FIXE.'));
    if (c.semVenda) out.push(h('p', { class: 'muted', style: { margin: '0 0 8px', fontSize: '12px' } }, `+ ${c.semVenda} cupom(ns) com o CPF desta pessoa não foram encontrados nas vendas (não entram nas contas).`));
    // filtro dos cupons: com pontos, CPF pelo FIXE, sem FIXE, resgate, CPF diferente
    const tiposDe = (k) => { const t = []; if (k.fxMov && k.fxMov.cpf === c.cpf) t.push('pontos'); if (k.origem === 'fixe') t.push('pelofixe'); if (k.semFixe) t.push('semfixe'); if (k.cpfFixe) t.push('div'); if (k.itens.some(TS.ehResgate)) t.push('resgate'); return t; };
    const contTipo = {};
    for (const k of r.cupons) for (const t of tiposDe(k)) contTipo[t] = (contTipo[t] || 0) + 1;
    const ROT = [['', 'Todos'], ['pontos', 'Com pontos no FIXE'], ['pelofixe', 'CPF pelo FIXE'], ['resgate', 'Resgate'], ['semfixe', 'Sem FIXE'], ['div', 'CPF diferente']];
    const elsCupom = [];
    if (r.cupons.length > 1 && Object.keys(contTipo).length) {
      const chips = h('div', { class: 'chips cupom-filtro' });
      const aplicar = (t) => { for (const [el, ts] of elsCupom) el.hidden = !!t && !ts.includes(t); for (const b of chips.children) b.classList.toggle('on', b.dataset.t === t); };
      for (const [t, rot] of ROT) if (!t || contTipo[t]) chips.append(h('button', { type: 'button', class: 'chip' + (t ? '' : ' on'), 'data-t': t, onclick: () => aplicar(t) }, t ? `${rot} (${contTipo[t]})` : `${rot} (${r.cupons.length})`));
      out.push(chips);
    }
    // saldo do FIXE no dia: pontos desta compra (validade) e resgates do dia, com o saldo logo depois
    const linhaFixe = (k) => {
      if (!c.fx || k.day == null) return null;
      const partes = [];
      const m = k.fxMov && k.fxMov.cpf === c.cpf ? k.fxMov : null;
      if (m && m.tipo === 'pontos' && !m.anulado) partes.push(h('span', null, h('b', { class: 'pos' }, `+${fmt.int(m.pontos)} pts`), m.vence != null ? ` · valem até ${fmt.date(TS.dayToIso(m.vence))}` : '', m.saldoApos != null ? ` · saldo depois: ${fmt.int(m.saldoApos)} pts` : ''));
      if (k.itens.some(TS.ehResgate)) {
        const rs = c.fx.movs.filter((x) => x.tipo === 'resgate' && !x.anulado && x.day === k.day);
        for (const x of rs) partes.push(h('span', null, h('b', { class: 'neg' }, `−${fmt.int(x.pontos)} pts no resgate`), x.saldoApos != null ? ` · saldo depois: ${fmt.int(x.saldoApos)} pts` : ''));
      }
      return partes.length ? h('div', { class: 'cupom-fixe-linha' }, h('span', { class: 'muted' }, 'FIXE: '), ...partes.flatMap((p, i) => (i ? [h('span', { class: 'muted' }, ' | '), p] : [p]))) : null;
    };
    for (const k of r.cupons) {
      const itens = k.itensFiltrados || k.itens;
      const tb = h('table', { class: 'cupom-items' });
      // item a R$ 0,01 com o mesmo nome de um produto vendido normalmente = prêmio do programa de fidelidade (resgate)
      const ehPremio = TS.ehResgate;
      for (const i of itens) tb.append(h('tr', { class: TS.rules.ids.taxas.has(db.desc[i]) ? 'taxa' : ehPremio(i) ? 'premio' : null, title: TS.rules.ids.taxas.has(db.desc[i]) ? 'Taxa: não soma no valor do cliente' : null },
        h('td', null, db.D.descricao[db.desc[i]], ehPremio(i) ? h('span', { class: 'cli-tag t-premio' }, 'Resgate') : null), h('td', { class: 'r' }, `${fmt.int(db.qtd[i])} un.`), h('td', { class: 'r' }, fmt.brl(db.vt[i])), h('td', { class: 'r', style: { color: '#6B7A70' } }, db.D.vendedor[db.vend[i]])));
      const temPremio = k.itens.some(ehPremio);
      if (!itens.length) tb.append(h('tr', null, h('td', { style: { color: '#6B7A70' } }, 'Cupom sem itens na planilha de vendas.')));
      const aviso = k.cpfFixe ? h('div', { class: 'cupom-aviso' }, 'Compra feita no CPF ', fmtCPF(c.cpf), ', mas foi usado o CPF ', cpfLink(k.cpfFixe, { cupom: k.cupom, day: k.day, cpfNota: c.cpf }), ' no FIXE. Clique no CPF para comparar os dois históricos.') : null;
      const el = h('div', { class: 'cupom' + (k.cpfFixe ? ' cupom-div' : '') + (destaque && destaque.cupom === k.cupom && destaque.day === k.day ? ' cupom-destaque' : '') }, aviso,
        h('div', { class: 'cupom-head' }, h('span', null, h('b', null, `Cupom ${k.cupom}`), ' · ', k.day != null ? fmt.date(TS.dayToIso(k.day)) : 'sem data', TS.db.opts.lojas.length > 1 ? ' · ' + k.loja : '',
          temPremio ? h('span', { class: 'cli-tag t-premio', title: 'Cupom com prêmio do programa de fidelidade (item a R$ 0,01)' }, '★ Resgate') : null,
          k.origem === 'fixe' ? h('span', { class: 'cli-tag t-fixe', title: 'A nota saiu sem CPF; a compra foi ligada a este cliente pelos pontos lançados no FIXE (mesmo dia, hora e produtos).' }, 'CPF pelo FIXE') : null,
          k.fixeOk ? h('span', { class: 'cli-tag t-fixe-ok', title: 'Os pontos desta compra foram para o mesmo CPF da nota.' }, 'FIXE ✓') : null,
          k.cpfFixe ? h('span', { class: 'cli-tag t-semfixe', title: `Os pontos desta compra foram para outro CPF no FIXE (${fmtCPF(k.cpfFixe)}).` }, 'CPF diferente no FIXE') : null,
          k.semFixe ? h('span', { class: 'cli-tag t-semfixe', title: `Cliente do FIXE, nota com o CPF, mas nenhum lançamento no FIXE neste dia (não informou ou não foi lançado).${k.ptsPerdidos ? ` Deixou de ganhar ${k.ptsPerdidos} pt(s).` : ''}` }, 'Sem FIXE') : null),
          h('span', null, `${fmt.int(k.qtd)} ${k.qtd === 1 ? 'item' : 'itens'} · `, h('b', null, fmt.brl(k.vt)))),
        linhaFixe(k), tb);
      elsCupom.push([el, tiposDe(k)]);
      out.push(el);
    }
    // compras da pessoa (pelo FIXE) que o painel não ligou a nenhum cupom: mesmo formato dos cupons, com o motivo
    if (destaque && c.fx) {
      const soltas = c.fx.movs.filter((m) => (m.tipo === 'pontos' || m.tipo === 'compra') && !m.cupom && !m.anulado && m.propria);
      if (soltas.length) out.push(h('div', { class: 'fi-tit fx-soltas-tit' }, `Compras no FIXE sem cupom ligado (${soltas.length})`));
      const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
      const cand = (x) => `${x.cupom}${x.min != null ? ` (${hhmm(x.min)}` : ' ('}${x.min != null ? ' · ' : ''}${fmt.brl(x.vt)})`;
      for (const m of soltas.slice(0, 20)) {
        const motivo = m.motivo === 'periodo' ? 'Sem vendas deste dia no painel (fora do período importado).'
          : m.motivo === 'ambiguo' ? `Mais de um cupom parecido no dia: ${m.cands.map(cand).join(', ')}. Confira qual é.`
            : m.motivo === 'usado' ? `O cupom mais parecido já foi ligado a outra compra do FIXE: ${m.cands.map(cand).join(', ')}.`
              : m.tipo === 'compra' ? 'Compra antiga importada no FIXE, só com a data: nenhum cupom do dia com esses produtos.'
                : `Nenhum cupom do dia com esses produtos e horário.${m.cands && m.cands.length ? ` Mais perto do horário: ${m.cands.map(cand).join(', ')}.` : ''}`;
        const tb = h('table', { class: 'cupom-items' });
        for (const p of m.produtos) tb.append(h('tr', null, h('td', null, p), h('td', { class: 'r', style: { color: '#6B7A70' } }, '—')));
        if (!m.produtos.length) tb.append(h('tr', null, h('td', { style: { color: '#6B7A70' } }, 'O FIXE não informou os produtos.')));
        out.push(h('div', { class: 'cupom cupom-fixe' },
          h('div', { class: 'cupom-head' },
            h('span', null, h('b', null, 'Cupom não identificado'), ' · ', fmt.date(TS.dayToIso(m.day)), m.min != null ? ' ' + hhmm(m.min) : '',
              h('span', { class: 'cli-tag t-forafixe', style: { marginLeft: '6px' }, title: motivo }, m.tipo === 'compra' ? 'Compra antiga no FIXE' : 'Só no FIXE')),
            h('span', null, m.tipo === 'pontos' ? h('b', null, `+${fmt.int(m.pontos)} pts`) : h('span', { class: 'muted' }, 'sem pontos'))),
          tb,
          h('div', { class: 'cupom-rodape' }, motivo)));
      }
      if (soltas.length > 20) out.push(h('p', { class: 'muted', style: { fontSize: '12px' } }, `+ ${soltas.length - 20} compras mais antigas no FIXE.`));
    }
    return out.filter(Boolean);
  }

  /** dados completos de um CPF para a janela (inclusive quem só existe no FIXE) */
  function clientePorCpf(cpf) {
    if (TS.garantirClientes) TS.garantirClientes();
    let c = TS.cli.porCPF && TS.cli.porCPF.get(cpf);
    const fxc = TS.cli.fxPorCpf ? TS.cli.fxPorCpf.get(cpf) : null;
    if (!c) {
      // cliente só do FIXE (nenhuma compra com o CPF na nota): os dados vêm do cadastro (Base de leads), como nas campanhas
      const info = (TS.cli.cad && TS.cli.cad.get(cpf)) || {};
      const cel = digits(info.celular), local = cel.length >= 12 && cel.startsWith('55') ? cel.slice(2) : cel;
      const nasc = info.nascimento || null;
      c = { cpf, empresa: cpf.length === 14, nome: (info.nome || (fxc && fxc.nome) || '').trim(), celular: cel, wpp: local.length >= 10 && local.length <= 11 ? (TS.demo ? '#demo' : 'https://wa.me/55' + local) : null,
        nascimento: nasc, idade: idade(nasc), aniv: nasc ? nasc.slice(8, 10) + '/' + nasc.slice(5, 7) : '', cidade: info.cidade || '', email: info.email || '',
        cupons: [], divergencias: [], tags: new Set(), semVenda: 0, ...celInfo(info) };
    }
    if (!c.fx && fxc) c.fx = fxc;
    if (!c.tags) c.tags = new Set();
    const cupons = c.cupons;
    const vt = cupons.reduce((t, k) => t + k.vt, 0), qtd = cupons.reduce((t, k) => t + k.qtd, 0);
    return { c, r: { c, cupons, visitas: cupons.length, vt, qtd, tkm: cupons.length ? vt / cupons.length : null } };
  }
  /** CPF que abre a janela do cliente */
  function cpfLink(cpf, comparar, cpfFixe) {
    return h('button', { type: 'button', class: 'cpf-link', title: comparar ? 'Ver o histórico dos dois CPFs lado a lado' : 'Ver o histórico deste CPF',
      onclick: (e) => { e.stopPropagation(); if (comparar) abrirClientes([comparar.cpfNota, cpfFixe || cpf], comparar); else abrirClientes([cpf]); } }, fmtCPF(cpf));
  }
  /** janela com uma lista (mesmo visual da janela do cliente); clicar numa linha abre o cliente por cima */
  function abrirLista(titulo, ...corpo) {
    document.querySelector('.camada-lista')?.remove();
    const fechar = () => { camada.remove(); if (!document.querySelector('.camada-cheia')) document.body.classList.remove('com-camada'); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.camada-cli')) fechar(); };
    const caixa = h('div', { class: 'card card-cheio fech-modal cli-janela' },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      h('div', { class: 'fech-modal-topo' }, h('b', null, titulo)), ...corpo.filter(Boolean));
    const camada = h('div', { class: 'camada-cheia camada-lista', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === camada) fechar(); } }, caixa);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', esc);
  }
  /** lista de clientes em janela: nome, CPF, contato e o que importa para aquela lista; clicar abre o cliente */
  function listaClientesJanela(titulo, explicacao, itens, colsExtra = [], arquivo) {
    const d = (day) => (day == null ? '—' : fmt.date(TS.dayToIso(day)));
    const linhas = itens.map((x) => {
      const { c } = clientePorCpf(x.cpf);
      const ct = contatoDe(c) || {};
      return { ...x, nome: c.nome || '—', cpfN: x.cpf, cpf: fmtCPF(x.cpf), cel: ct.optout ? 'não quer mensagens' : fmtTel(c.celular) || '—', wpp: !ct.optout && c.wpp, saldo: c.fx ? c.fx.saldo : null, ultima: c.ultima, ultimaTxt: d(c.ultima) };
    });
    const cols = [
      { key: 'nome', label: 'Cliente', align: 'l', render: (r) => h('span', null, r.nome, r.wpp ? linkConversa(clientePorCpf(r.cpfN).c, ' ● WhatsApp') : null) },
      { key: 'cpf', label: 'CPF', align: 'l', render: (r) => cpfLink(r.cpfN) },
      { key: 'cel', label: 'Celular', align: 'l' },
      ...colsExtra,
      { key: 'saldo', label: 'Pontos hoje', fmt: (v) => (v == null ? '—' : fmt.int(v)) },
      { key: 'ultima', label: 'Última compra', align: 'l', render: (r) => r.ultimaTxt },
    ];
    abrirLista(`${titulo} (${fmt.int(linhas.length)})`,
      explicacao ? h('p', { class: 'muted' }, explicacao) : null,
      arquivo ? h('div', { class: 'cfg-acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => csv(arquivo, cols.map((c) => c.label), linhas.map((r) => cols.map((c) => (c.key === 'nome' ? r.nome : c.key === 'cel' ? (TS.demo ? '' : r.cel) : c.key === 'ultima' ? r.ultimaTxt : c.csv ? c.csv(r) : r[c.key] ?? '')))) }, 'Baixar lista (CSV)')) : null,
      TS.table({ cols, rows: linhas, sortKey: 'ultima', onRowClick: (r) => abrirClientes([r.cpfN]) }));
  }
  /** janela com os cupons com CPF que não casaram com as vendas: data, loja, cupom, cliente e o motivo provável */
  function abrirSemVenda() {
    document.querySelector('.camada-semvenda')?.remove();
    const L = TS.cli.semVendaLista || [];
    const fechar = () => { camada.remove(); if (!document.querySelector('.camada-cheia')) document.body.classList.remove('com-camada'); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.camada-cli')) fechar(); };
    const porMotivo = new Map();
    for (const x of L) { const k = x.motivo.startsWith('o número existe') ? 'o número existe nas vendas, mas em outra data' : x.motivo; porMotivo.set(k, (porMotivo.get(k) || 0) + 1); }
    const DICA = {
      'número do cupom não está no relatório de vendas': 'O AppNext emitiu a nota, mas o número não aparece no relatório de vendas importado. Confira no AppNext se a venda foi cancelada ou se está em outra loja.',
      'o número existe nas vendas, mas em outra data': 'O mesmo número de cupom aparece em outra data: pode ser numeração reiniciada (outro caixa ou série) ou a data da nota diferente da venda.',
      'data fora do período das vendas': 'A nota é de uma data que o relatório de vendas ainda não cobre. Importe o histórico de vendas desse período.',
      'loja sem vendas importadas': 'A loja da nota não tem vendas no painel.',
    };
    const resumo = h('div', { class: 'cli-sv-resumo' }, ...[...porMotivo].sort((a, b) => b[1] - a[1]).map(([m, n]) => h('div', { title: DICA[m] || '' }, h('b', null, fmt.int(n)), ' ', m)));
    const linhas = L.map((x) => { const cad = TS.cli.cad.get(x.cpf) || {}; return { ...x, nome: cad.nome || '', dia: x.data ? TS.isoToDay(x.data) : null }; });
    const tab = TS.table({
      cols: [
        { key: 'dia', label: 'Data', align: 'l', render: (r) => (r.data ? fmt.date(r.data) : '—'), sortVal: (r) => r.dia ?? -1 },
        new Set(L.map((x) => x.loja)).size > 1 ? { key: 'loja', label: 'Loja', align: 'l' } : null,
        { key: 'cupom', label: 'Cupom', align: 'l' },
        { key: 'cpf', label: 'CPF', align: 'l', render: (r) => h('button', { type: 'button', class: 'link-btn', title: 'Abrir o histórico do cliente', onclick: () => abrirClientes([r.cpf]) }, fmtCPF(r.cpf)) },
        { key: 'nome', label: 'Cliente', align: 'l', wrap: true, render: (r) => r.nome || h('span', { class: 'muted' }, 'sem cadastro') },
        { key: 'motivo', label: 'Motivo provável', align: 'l', wrap: true, render: (r) => h('span', { title: DICA[r.motivo.startsWith('o número existe') ? 'o número existe nas vendas, mas em outra data' : r.motivo] || '' }, r.motivo) },
      ].filter(Boolean),
      rows: linhas, sortKey: 'dia', maxHeight: '60vh', search: 'Buscar cupom, CPF ou cliente…', searchKeys: ['cupom', 'cpf', 'nome', 'motivo'],
    });
    const caixa = h('div', { class: 'card card-cheio fech-modal cli-sv' },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      h('div', { class: 'fech-modal-topo' }, h('b', null, `${fmt.int(L.length)} cupons com CPF que não foram encontrados nas vendas`)),
      h('p', { class: 'muted' }, 'Notas com CPF (XML do AppNext) cujo número de cupom não casou com nenhuma venda da mesma loja até 1 dia de diferença. Passe o mouse no motivo para ver o que conferir. Clique no CPF para abrir o histórico do cliente.'),
      resumo, tab);
    const camada = h('div', { class: 'camada-cheia camada-semvenda', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === camada) fechar(); } }, caixa);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', esc);
  }

  TS.abrirClientes = (cpfs, destaque) => abrirClientes(cpfs, destaque);
  function abrirClientes(cpfs, destaque) {
    document.querySelector('.camada-cli')?.remove();
    const fechar = () => { camada.remove(); if (!document.querySelector('.camada-cheia')) document.body.classList.remove('com-camada'); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    const rot = cpfs.length === 2 ? ['CPF da nota', 'CPF no FIXE'] : [null];
    const colunas = cpfs.map((cpf, j) => {
      const { c, r } = clientePorCpf(cpf);
      const ct = contatoDe(c);
      return h('div', { class: 'cli-janela-col' },
        rot[j] ? h('div', { class: 'cli-janela-rot' }, rot[j]) : null,
        h('div', { class: 'cli-janela-cab' },
          h('div', { class: 'cj-top' },
            h('div', { class: 'cj-ident' },
              h('div', { class: 'cj-nome' }, c.nome || 'Cliente sem cadastro'),
              h('div', { class: 'cli-meta' }, h('span', null, fmtCPF(c.cpf)),
                ...[...c.tags].map((t) => h('span', { class: 'cli-tag t-' + t, title: DICA_SEG[t] }, NOMES_SEG[t])),
                ct && ct.optout ? h('span', { class: 'cli-tag t-optout' }, 'não quer mensagens') : null)),
            c.wpp && !(ct && ct.optout) ? linkConversa(c, 'WhatsApp', 'btn cj-wpp') : null),
          h('div', { class: 'cj-kpis' },
            h('div', null, h('small', null, 'Compras'), h('b', null, fmt.int(r.visitas))),
            h('div', null, h('small', null, 'Total gasto'), h('b', null, fmt.brl0(r.vt))),
            h('div', null, h('small', null, 'Ticket médio'), h('b', null, r.tkm != null ? fmt.brl0(r.tkm) : '—')),
            h('div', null, h('small', null, 'Última compra'), h('b', null, c.ultima != null ? fmt.date(TS.dayToIso(c.ultima)) : '—'), c.ausencia != null ? h('em', null, c.ausencia === 0 ? 'hoje' : `há ${fmt.int(c.ausencia)} dias`) : null),
            c.fx ? h('div', { class: 'cj-pts' }, h('small', null, 'Pontos'), h('b', null, `★ ${fmt.int(c.fx.saldo || 0)}`), c.fx.em30 ? h('em', null, `${fmt.int(c.fx.em30)} vencem em 30 dias`) : null) : null)),
        ...corpoCliente(c, r, destaque || { cupom: null }).filter(Boolean));
    });
    const caixa = h('div', { class: 'card card-cheio fech-modal cli-janela' + (cpfs.length === 2 ? ' dupla' : '') },
      h('button', { type: 'button', class: 'icon-btn exp-fechar', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: fechar }, '✕'),
      h('div', { class: 'fech-modal-topo' }, h('b', null, cpfs.length === 2 ? `Cupom ${destaque.cupom} de ${fmt.date(TS.dayToIso(destaque.day))}: nota num CPF, pontos em outro` : 'Histórico do cliente')),
      h('div', { class: 'cli-janela-cols' }, ...colunas));
    const camada = h('div', { class: 'camada-cheia camada-cli', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === camada) fechar(); } }, caixa);
    document.body.append(camada);
    document.body.classList.add('com-camada');
    document.addEventListener('keydown', esc);
    const alvo = caixa.querySelector('.cupom-destaque');
    if (alvo) setTimeout(() => alvo.scrollIntoView({ block: 'center' }), 50);
  }
  // ---------- quem leva X também leva ----------
  function cartaoLevamJunto() {
    const s = state.cli, db = TS.db;
    const q = TS.norm(s.produto);
    if (!q) return null;
    const noPer = noPeriodoCli() || (() => true);
    const taxas = TS.rules.ids.taxas;
    const alvo = new Uint8Array(db.D.descricao.length);
    db.D.descricao.forEach((t, i) => { if (TS.norm(t).includes(q)) alvo[i] = 1; });
    const porCupom = new Map(); // cupons do período que têm o produto
    for (let i = 0; i < db.n; i++) {
      if (!noPer(db.day[i])) continue;
      if (alvo[db.desc[i]]) porCupom.set(db.cupom[i] + '|' + db.loja[i] + '|' + db.day[i], true);
    }
    if (!porCupom.size) return TS.card(`Quem leva "${s.produto}"`, 'também leva…', TS.empty('Nenhuma venda desse produto no período.'));
    const cont = new Map();
    const vistos = new Set();
    for (let i = 0; i < db.n; i++) {
      const k = db.cupom[i] + '|' + db.loja[i] + '|' + db.day[i];
      if (!porCupom.has(k) || alvo[db.desc[i]] || taxas.has(db.desc[i])) continue;
      const kp = k + '#' + db.prod[i];
      if (vistos.has(kp)) continue;
      vistos.add(kp);
      cont.set(db.prod[i], (cont.get(db.prod[i]) || 0) + 1);
    }
    const top = [...cont].sort((a, b) => b[1] - a[1]).slice(0, 8);
    return TS.card(`Quem leva "${s.produto}"`, `também leva… (${fmt.int(porCupom.size)} cupons com o produto, de todas as vendas do período)`,
      top.length ? h('ul', { class: 'cli-junto' }, top.map(([p, n]) => h('li', null, h('span', null, db.D.produto[p]), h('b', null, fmt.pct(n / porCupom.size, 0))))) : TS.empty('Sempre comprado sozinho.'));
  }

  // ---------- indicadores da base e vendedoras ----------
  function baseDeClientes(lista) {
    const s = state.cli, db = TS.db;
    const noPer = noPeriodoCli() || (() => true);
    const taxas = TS.rules.ids.taxas;
    const lojasOk = s.lojas.size ? s.lojas : null;
    // todas as vendas do período: cupons por vendedora e com/sem CPF
    const cupons = new Map(); // "cupom|loja|day" → { vt, vends:Set }
    for (let i = 0; i < db.n; i++) {
      if (!noPer(db.day[i])) continue;
      if (lojasOk && !lojasOk.has(db.loja[i])) continue;
      const v = db.D.vendedor[db.vend[i]];
      if (!v || /^sem vendedor$/i.test(v)) continue;
      const k = db.cupom[i] + '|' + db.loja[i] + '|' + db.day[i];
      let x = cupons.get(k);
      if (!x) cupons.set(k, (x = { vt: 0, vends: new Set() }));
      if (!taxas.has(db.desc[i])) x.vt += db.vt[i] || 0;
      x.vends.add(v);
    }
    let nTot = 0, vtTot = 0, nCpf = 0, vtCpf = 0;
    const porVend = new Map();
    const pv = (v) => { let a = porVend.get(v); if (!a) porVend.set(v, (a = { nome: v, cupons: 0, cpf: 0, novos: 0, lnovos: [], cliFixe: 0, semFixe: 0 })); return a; };
    // "voltou" só para quem já teve o prazo inteiro (recompra.js): o cliente do fim do período teve menos tempo para voltar
    const RC = TS.recompra, hojeRC = Math.min(db.maxDay, TS.todayDay());
    const partida = (ref, c) => ({ ref, dias: c.cupons.map((k) => k.day) });
    for (const [k, x] of cupons) {
      const temCpf = TS.cli.cuponsCPF.has(k);
      nTot++; vtTot += x.vt;
      if (temCpf) { nCpf++; vtCpf += x.vt; }
      for (const v of x.vends) { const a = pv(v); a.cupons++; if (temCpf) a.cpf++; }
    }
    // clientes novos no período: a primeira compra foi atendida por quem?
    for (const c of TS.cli.lista) {
      if (c.primeira == null || !noPer(c.primeira)) continue;
      const k1 = c.cupons[c.cupons.length - 1];
      if (lojasOk && !lojasOk.has(k1.lojaId)) continue;
      for (const v of new Set(k1.itens.map((i) => db.D.vendedor[db.vend[i]]).filter((v) => v && !/^sem vendedor$/i.test(v)))) {
        const a = pv(v); a.novos++; a.lnovos.push(partida(c.primeira, c));
      }
    }
    // compras de clientes do FIXE (entre o cadastro e a data dos Logs) e quantas passaram sem FIXE
    const fxi = TS.cli.fixe;
    const comFixe = !!(fxi && fxi.temLogs);
    if (comFixe) {
      for (const c of TS.cli.lista) {
        if (!c.membroFixe) continue;
        for (const k of c.cupons) {
          if (!noPer(k.day) || k.day >= fxi.logsAte || (c.cadastroFixe != null && k.day <= c.cadastroFixe)) continue;
          if (lojasOk && !lojasOk.has(k.lojaId)) continue;
          for (const v of new Set(k.itens.map((i) => db.D.vendedor[db.vend[i]]).filter((v) => v && !/^sem vendedor$/i.test(v)))) { const a = pv(v); a.cliFixe++; if (k.semFixe) a.semFixe++; }
        }
      }
    }
    // recompra: dos clientes do filtro, quem comprou de novo em até 90 dias depois da primeira compra do período
    const REC = RC.recompra(lista.map((r) => partida(Math.min(...r.cupons.map((k) => k.day)), r.c)), hojeRC);
    const inicioDados = fmt.date(TS.dayToIso(db.minDay));
    // redesenho: os números que decidem vão para o herói da tela (colunas); ticket e clientes novos ficam como linhas de apoio
    const novosN = lista.filter((r) => r.c.primeira != null && noPer(r.c.primeira)).length;
    const cols = [
      { rot: 'Vendas com CPF', num: fmt.pct(nTot ? nCpf / nTot : null, 1), dica: 'Cupons de venda em que o cliente informou o CPF (e a nota foi encontrada). Período e loja dos filtros.',
        linhas: [`${fmt.int(nCpf)} de ${fmt.int(nTot)} cupons do período`, h('span', { class: 'cli-ticket', title: 'Ticket médio dos cupons com CPF × de todos os cupons do período' }, 'Ticket do cliente identificado ', h('b', null, fmt.brl(nCpf ? vtCpf / nCpf : null)), ` · geral ${fmt.brl(nTot ? vtTot / nTot : null)}`)] },
      { rot: `Recompra em ${RC.PRAZO} dias`, num: REC.pouco ? '—' : fmt.pct(REC.pct, 0),
        dica: `Dos clientes do filtro, quantos compraram de novo em até ${RC.PRAZO} dias depois da primeira compra deles no período.\n\nSó entra quem já teve os ${RC.PRAZO} dias inteiros para voltar: o cliente que comprou na semana passada ainda não teve tempo e fica separado ("ainda no prazo"), para não puxar o % para baixo.\n\nCom menos de ${RC.MIN} clientes de prazo completo aparece "poucos dados" em vez do %: com tão pouca gente o número muda a cada compra. Em período curto e recente (este mês, últimos 30 dias) é normal não haver ninguém com o prazo completo.\n\nClientes novos no período: primeira compra com CPF (na nota ou ligada pelo FIXE) dentro do histórico que o painel tem (vendas desde ${inicioDados}). "Novo" é novo para o painel: cliente antigo que só agora informou o CPF também aparece como novo.`,
        linhas: [REC.pouco ? `poucos dados: ${fmt.int(REC.elegiveis)} ${REC.elegiveis === 1 ? 'cliente' : 'clientes'} com ${RC.PRAZO} dias completos${REC.elegiveis ? ` (${fmt.int(REC.voltaram)} ${REC.voltaram === 1 ? 'voltou' : 'voltaram'})` : ''}` : `${fmt.int(REC.voltaram)} de ${fmt.int(REC.elegiveis)} clientes${REC.semPrazo ? ` · ${fmt.int(REC.semPrazo)} ainda no prazo` : ''}`,
          h('span', { class: 'cli-novos' }, h('b', null, fmt.int(novosN)), ` ${novosN === 1 ? 'cliente novo' : 'clientes novos'} no período (primeira compra com CPF)`)] },
    ];
    // novos × recorrentes por mês (últimos 12 meses do período)
    // agrupado pelo período: sem período (Tudo) = últimos 12 meses por mês; com período = por dia, semana ou mês
    const pp = state.cli.per;
    const fim = pp.ate ?? TS.todayDay();
    let meses, ymDe, rot, porX = 'por mês';
    if (pp.de == null) {
      meses = [];
      { const f = new Date(fim * 864e5); for (let k = 11; k >= 0; k--) { const d = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - k, 1)); meses.push(d.toISOString().slice(0, 7)); } }
      ymDe = (day) => new Date(day * 864e5).toISOString().slice(0, 7);
      rot = TS.ymLabel;
    } else {
      const B = TS.baldes(pp.de, fim);
      meses = B.chaves; ymDe = B.chave; rot = B.rotulo; porX = B.porX;
    }
    const nov = Object.fromEntries(meses.map((m) => [m, 0])), rec = Object.fromEntries(meses.map((m) => [m, 0]));
    for (const c of TS.cli.lista) {
      const ymPrim = ymDe(c.primeira);
      const noMes = new Set();
      for (const k of c.cupons) { if (lojasOk && !lojasOk.has(k.lojaId)) continue; const ym = ymDe(k.day); if (ym in nov) noMes.add(ym); }
      for (const ym of noMes) { if (ym === ymPrim) nov[ym]++; else rec[ym]++; }
    }
    const grafico = TS.card(`Clientes ${porX}`, 'Novos (primeira compra) × recorrentes — clientes identificados por CPF · acompanha o período', TS.chart({
      type: 'bar',
      data: { labels: meses.map(rot), datasets: [
        { label: 'Novos', data: meses.map((m) => nov[m]), backgroundColor: '#C9A227', borderRadius: 3 },
        { label: 'Recorrentes', data: meses.map((m) => rec[m]), backgroundColor: '#2C5234', borderRadius: 3 }] },
      options: { plugins: { tooltip: { mode: 'index', intersect: false } }, scales: { x: { stacked: true, ...TS.axisCat }, y: { stacked: true, ...TS.axisNum(fmt.int) } } },
    }));
    const rows = [...porVend.values()].filter((a) => a.cupons > 0).map((a) => { const rc = RC.recompra(a.lnovos, hojeRC); return { ...a, rc, voltaram: rc.voltaram, pct: a.cupons ? a.cpf / a.cupons : null, pctVolta: rc.pouco ? -1 : rc.pct, pctSemFixe: a.cliFixe ? a.semFixe / a.cliFixe : null }; });
    const rcTot = RC.recompra(rows.flatMap((r) => r.lnovos), hojeRC);
    const celVolta = (rc) => (!rc ? '—' : rc.pouco ? h('span', { class: 'muted', title: `Só ${fmt.int(rc.elegiveis)} ${rc.elegiveis === 1 ? 'cliente novo' : 'clientes novos'} com ${RC.PRAZO} dias completos (mínimo ${RC.MIN}): pouco para virar %.` }, 'poucos dados') : fmt.pct(rc.pct, 0));
    const tab = TS.table({
      cols: [
        { key: 'nome', label: 'Vendedora', align: 'l' },
        { key: 'cupons', label: 'Cupons', fmt: fmt.int },
        { key: 'cpf', label: 'Com CPF', fmt: fmt.int },
        { key: 'pct', label: '% com CPF', fmt: (v) => fmt.pct(v, 0) },
        { key: 'novos', label: 'Clientes novos', fmt: fmt.int, title: 'Clientes cuja primeira compra com CPF (dentro do histórico do painel) foi no período e foi atendida por ela.' },
        { key: 'voltaram', label: 'Voltaram', title: `Dos clientes novos dela que já tiveram ${RC.PRAZO} dias inteiros para voltar, quantos compraram de novo nesse prazo (com qualquer vendedora). Ex.: "3 de 12" = 12 com o prazo completo, 3 voltaram.`, fmt: (v, r) => (r.rc ? `${fmt.int(r.rc.voltaram)} de ${fmt.int(r.rc.elegiveis)}` : '—') },
        { key: 'pctVolta', label: '% voltaram', title: `Voltaram ÷ clientes novos com ${RC.PRAZO} dias completos. O cliente novo do fim do período ainda não teve tempo de voltar e fica de fora. Com menos de ${RC.MIN} clientes de prazo completo aparece "poucos dados": o % mudaria a cada compra e não serve para comparar vendedoras.`, fmt: (v, r) => celVolta(r.rc) },
        ...(comFixe ? [
          { key: 'semFixe', label: 'Sem FIXE', fmt: fmt.int },
          { key: 'pctSemFixe', label: '% sem FIXE', fmt: (v) => (v == null ? '—' : fmt.pct(v, 0)) },
        ] : []),
      ],
      rows, sortKey: 'pct',
      total: { nome: 'Total', cupons: nTot, cpf: nCpf, pct: nTot ? nCpf / nTot : null, novos: rows.reduce((t, r) => t + r.novos, 0), rc: rcTot, voltaram: rcTot.voltaram, pctVolta: rcTot.pouco ? -1 : rcTot.pct,
        ...(comFixe ? (() => { const cf = rows.reduce((t, r) => t + r.cliFixe, 0), sf = rows.reduce((t, r) => t + r.semFixe, 0); return { semFixe: sf, pctSemFixe: cf ? sf / cf : null }; })() : {}) },
    });
    return { cols, resto: [TS.section('Base de clientes'), h('p', { class: 'muted cli-alcance' }, 'Período e loja dos filtros (o gráfico e a tabela das vendedoras).'),
      h('div', { class: 'grid mt', style: { alignItems: 'start' } }, grafico,
        TS.card('Vendedoras e clientes', '% de vendas com CPF (pedir o CPF faz a base crescer) · clientes novos = primeira compra atendida por ela · voltaram = compraram de novo em até 90 dias (só quem já teve o prazo inteiro)' + (comFixe ? ' · sem FIXE = compras de clientes do FIXE sem lançamento no dia (o cliente pode não ter informado)' : ''), tab))] };
  }

  // ---------- ficha e ações ----------
  function fichaCliente(c, r) {
    const hoje = TS.todayDay();
    const d = (day) => fmt.date(TS.dayToIso(day));
    const varia = c.gasto12ant > 0 ? c.gasto12 / c.gasto12ant - 1 : null;
    const item = (rot, val, dica) => (val == null || val === '' ? null : h('div', { class: 'fi' }, h('span', null, rot, TS.dica(dica)), h('b', null, val)));
    const bloco = (titulo, ...itens) => { const v = itens.filter(Boolean); return v.length ? h('div', { class: 'fi-bloco' }, h('div', { class: 'fi-tit' }, titulo), ...v) : null; };
    const tel = fmtTel(c.celular);
    const prox = c.intervalo ? Math.round(c.ultima + c.intervalo) : null;
    const repor = c.proxCha == null ? null
      : c.proxCha < hoje - 45 ? null
        : c.proxCha <= hoje ? `já deve ter acabado (${d(c.proxCha)})` : `por volta de ${d(c.proxCha)}`;
    const dicaRepor = c.proxCha == null ? null : c.reporEstimado
      ? `Na última compra de chá (${d(c.ultimaCha)}) levou ${c.gramasUltima} g. Sem histórico suficiente, o painel considera ~3 g por dia (1 xícara): dura ~${c.intervaloCha} dias.`
      : `Na última compra de chá (${d(c.ultimaCha)}) levou ${c.gramasUltima} g. Pelo histórico, consome ~${fmt.n1(c.gDia)} g por dia: dura ~${c.intervaloCha} dias.`;
    return h('div', { class: 'cli-ficha' }, ...[
      bloco('Contato',
        tel ? h('div', { class: 'fi' }, h('span', null, 'Celular', celDica(c)), h('b', null, tel, c.wpp ? linkConversa(c, ' WhatsApp') : null), celNota(c)) : celNota(c),
        item('E-mail', c.email || null),
        item('Cidade', c.cidade || null),
        item('Aniversário', c.aniv ? `${anivTxt(c)}${c.idade != null ? ` · ${c.idade} anos` : ''}` : null)),
      bloco('Histórico',
        item('Cliente desde', d(c.primeira)),
        item('Compras', `${fmt.int(c.visitas)}${r.visitas !== c.visitas ? ` (${fmt.int(r.visitas)} no período)` : ''}`),
        item('Frequência', c.intervalo ? `a cada ~${fmt.int(Math.round(c.intervalo))} dias` : 'comprou uma vez'),
        item('Última compra', `${d(c.ultima)} · ${c.ausencia === 0 ? 'hoje' : `há ${fmt.int(c.ausencia)} dias`}`),
        prox ? item('Próxima visita esperada', prox < hoje ? `${d(prox)} (atrasada ${fmt.int(hoje - prox)} dias)` : d(prox), 'Última compra + intervalo médio entre as compras') : null),
      bloco('Preferências',
        item('Chá favorito (a granel)', c.chaFavorito),
        item('Pacote preferido', c.pacote ? `${c.pacote} g` : null),
        item('Chá deve acabar', repor, dicaRepor),
        c.proxCha != null ? h('div', { class: 'fi-nota' }, dicaRepor) : null,
        item('Mais atendida por', c.vendedora)),
      (() => {
        // produtos que mais compra (quantidade, sem taxas e prêmios)
        const db = TS.db, cont = new Map();
        for (const k of c.cupons) for (const i of k.itens) {
          if (TS.rules.ids.taxas.has(db.desc[i]) || TS.ehResgate(i)) continue;
          const p = cont.get(db.prod[i]) || cont.set(db.prod[i], { q: 0, vt: 0, n: 0 }).get(db.prod[i]);
          p.q += db.qtd[i] || 0; p.vt += db.vt[i] || 0; p.n++;
        }
        const top = [...cont].sort((a, b) => b[1].n - a[1].n || b[1].vt - a[1].vt).slice(0, 5);
        return top.length ? bloco('Mais compra', ...top.map(([pid, x]) => h('div', { class: 'fi fi-top' }, h('span', null, db.D.produto[pid]), h('b', null, `${fmt.int(x.n)}×`, h('small', null, fmt.brl0(x.vt)))))) : null;
      })(),
      bloco('Valores',
        item('Gasto nos últimos 12 meses', fmt.brl(c.gasto12), 'Soma das compras com CPF nos últimos 365 dias.'),
        c.gasto12ant > 0 ? item('12 meses anteriores', fmt.brl(c.gasto12ant), 'Soma das compras de 13 a 24 meses atrás, para comparar.') : null,
        varia != null ? h('div', { class: 'fi' }, h('span', null, 'Variação', TS.dica('Quanto o cliente gastou nos últimos 12 meses comparado com os 12 meses anteriores. Positivo = está gastando mais.')), h('b', { class: varia >= 0 ? 'pos' : 'neg' }, `${fmt.delta(varia)} ${varia >= 0 ? 'a mais' : 'a menos'}`)) : null,
        item('Ticket médio', fmt.brl(r.tkm), 'Valor médio de cada compra (no período escolhido nos filtros).'),
        item('Preço médio por item', fmt.brl(r.qtd ? r.vt / r.qtd : null), 'Valor gasto ÷ itens comprados.'),
        item('Itens por compra', fmt.n2(r.visitas ? r.qtd / r.visitas : null), 'Quantos itens o cliente leva em média por compra.'),
        item('Itens comprados', fmt.int(r.qtd))),
      blocoFidelidade(c),
      blocoLojas(c),
    ].filter(Boolean));
  }
  // ---------- fidelidade (FIXE) ----------
  const TIPO_MOV = { pontos: 'Pontos da compra', compra: 'Compra (histórico antigo)', resgate: 'Resgate', expirou: 'Pontos expirados', cancelado: 'Operação cancelada', boasvindas: 'Boas-vindas', ajuste: 'Ajuste de pontos', saida: 'Pontos retirados', outro: 'Outro' };
  /**
   * Onde o cliente compra nos últimos 12 meses: esta loja (cupons das vendas, com e sem FIXE) e as outras lojas da rede
   * (compras lançadas no FIXE; o valor é estimado pelos pontos × R$ por ponto). Loja preferida = a de mais compras;
   * empate = a de maior valor.
   */
  function lojasDoCliente(c) {
    const hoje = TS.todayDay(), desde = hoje - 365;
    const rpp = c.fx && c.fx.movs[0] ? c.fx.movs[0].base.regras.reaisPorPonto || 50 : 50;
    const movs = c.fx ? c.fx.movs.filter((m) => !m.anulado && m.day > desde) : [];
    const nomeNossa = (movs.find((m) => m.propria) || {}).loja || (TS.db.metas.find((m) => m.id === state.loja) || {}).nome || 'Esta loja';
    const nossa = { nome: nomeNossa, nossa: true, compras: 0, gasto: 0, pontos: 0, resgates: 0, estimado: false };
    for (const k of c.cupons) if (k.day != null && k.day > desde) { nossa.compras++; nossa.gasto += k.vt; }
    const outras = new Map();
    for (const m of movs) {
      const l = m.propria ? nossa : outras.get(m.loja) || outras.set(m.loja, { nome: m.loja, nossa: false, compras: 0, gasto: 0, pontos: 0, resgates: 0, estimado: true }).get(m.loja);
      if (m.tipo === 'pontos' || m.tipo === 'compra') { if (!m.propria) { l.compras++; l.gasto += (m.pontos || 0) * rpp; } l.pontos += m.pontos || 0; }
      else if (m.tipo === 'resgate') l.resgates++;
    }
    const todas = [nossa, ...outras.values()].filter((l) => l.compras || l.resgates || l.nossa);
    const pref = todas.filter((l) => l.compras).sort((a, b) => b.compras - a.compras || b.gasto - a.gasto)[0] || null;
    return { lojas: todas.sort((a, b) => b.compras - a.compras || b.gasto - a.gasto), pref };
  }
  TS.lojasDoCliente = lojasDoCliente;
  function blocoLojas(c) {
    const { lojas, pref } = lojasDoCliente(c);
    if (lojas.length < 2) return null;
    const tb = h('table', { class: 'cupom-items fi-lojas' },
      h('thead', null, h('tr', null, h('th', null, 'Loja'), h('th', { class: 'r' }, 'Compras'), h('th', { class: 'r' }, 'Gasto'), h('th', { class: 'r' }, 'Pontos'), h('th', { class: 'r' }, 'Resgates'))),
      h('tbody', null, ...lojas.map((l) => h('tr', { class: l.nossa ? 'nossa' : null },
        h('td', null, l === pref ? h('span', { class: 'cli-tag t-fiel', style: { marginLeft: 0, marginRight: '6px' } }, '★ preferida') : null, l.nome, l.nossa ? h('small', { class: 'muted' }, ' (esta loja)') : null),
        h('td', { class: 'r' }, fmt.int(l.compras)), h('td', { class: 'r' }, (l.estimado ? '≈ ' : '') + fmt.brl0(l.gasto)), h('td', { class: 'r' }, fmt.int(l.pontos)), h('td', { class: 'r' }, fmt.int(l.resgates))))));
    return h('div', { class: 'fi-bloco fi-largo' },
      h('div', { class: 'fi-tit' }, 'Onde compra (últimos 12 meses)', TS.dica('Esta loja: cupons das vendas (com e sem FIXE). Outras lojas da rede: compras lançadas no FIXE, com o valor estimado pelos pontos (≈ pontos × R$ por ponto). Loja preferida = a de mais compras; no empate, a de maior valor.')),
      tb, pref && !pref.nossa ? h('div', { class: 'fi-nota' }, `Compra mais em ${pref.nome} do que aqui: bom alvo para uma campanha de "volte para a nossa loja".`) : null);
  }

  function blocoFidelidade(c) {
    const f = c.fx;
    const d = (day) => fmt.date(TS.dayToIso(day));
    const item = (rot, val, dica) => (val == null || val === '' ? null : h('div', { class: 'fi' }, h('span', null, rot, TS.dica(dica)), h('b', null, val)));
    const sem = c.cupons.filter((k) => k.semFixe);
    const linhaSem = sem.length ? item('Compras sem FIXE', `${fmt.int(sem.length)}${sem.reduce((t, k) => t + k.ptsPerdidos, 0) ? ` · ${fmt.int(sem.reduce((t, k) => t + k.ptsPerdidos, 0))} pts não lançados` : ''}`, 'Compras com o CPF na nota sem lançamento no FIXE no dia. Os cupons estão marcados "Sem FIXE" abaixo.') : null;
    if (!f) {
      if (c.tags && c.tags.has('forafixe')) return h('div', { class: 'fi-bloco fi-largo' }, h('div', { class: 'fi-tit' }, 'Fidelidade (FIXE)'), h('div', { class: 'fi-nota' }, 'Não está na base do FIXE desta loja. Dá para convidar a se cadastrar e começar a pontuar.'));
      if (c.membroFixe) return h('div', { class: 'fi-bloco fi-largo' }, h('div', { class: 'fi-tit' }, 'Fidelidade (FIXE)'),
        item('No programa desde', c.cadastroFixe != null ? d(c.cadastroFixe) : 'cadastrado'), item('Saldo de pontos', '0 (sem movimentos nos Logs)'), linhaSem);
      return null;
    }
    const outras = f.movs.filter((m) => (m.tipo === 'pontos' || m.tipo === 'compra') && !m.propria && !m.anulado);
    const ult = f.movs.slice(0, 5);
    const regras = (f.movs[0] && f.movs[0].base.regras) || { reaisPorPonto: 50, validadeMeses: 12 };
    return h('div', { class: 'fi-bloco fi-largo' }, h('div', { class: 'fi-tit' }, 'Fidelidade (FIXE)'),
      item('Saldo de pontos', fmt.int(f.saldo), f.saldoFixe != null ? (() => { const em = f.saldoFixeEm ? new Date(f.saldoFixeEm) : null, quando = em && !isNaN(em) ? em.toLocaleDateString('pt-BR') + ' ' + em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        const de = f.saldoFixeOrigem === 'sinc' ? `lido no FIXE${quando ? ' em ' + quando : ''} (sincronização)` : `da Base de leads${quando ? ' de ' + quando : ''}`;
        return `Saldo oficial do FIXE: ${fmt.int(f.saldoFixeLido)} pts ${de}` + (f.saldoFixeDepois ? `, ${f.saldoFixeDepois > 0 ? '+' : '−'} ${fmt.int(Math.abs(f.saldoFixeDepois))} pts dos movimentos nos Logs depois disso.` : '. Os movimentos dos Logs depois disso entram na conta.'); })() : `Calculado pelos Logs: pontos ganhos que ainda valem (cada lote vale ${regras.validadeMeses} meses), menos resgates e expirações. Importe a Base de leads para ver o saldo oficial do FIXE.`),
      f.saldoFixe == null && !(TS.db.fidelidade || []).some((b) => b.saldosFixe || (b.membros || []).some((x) => x.length > 2)) ? h('div', { class: 'fi-nota' }, 'Saldo calculado pelos Logs. Para trazer o saldo oficial do FIXE, use "Sincronizar saldos com o FIXE" em Configurações → Integrações → FIXE.') : null,
      f.saldoFixe != null && f.saldoLogs != null && f.saldoFixe > f.saldoLogs ? h('div', { class: 'fi-nota' }, `${fmt.int(f.saldoFixe - f.saldoLogs)} dos ${fmt.int(f.saldoFixe)} pts vêm de compras antigas importadas no FIXE (antes dos pontos por produto). Esses pontos não têm data de vencimento no FIXE: nos Logs, só vencem os pontos lançados no FIXE, 12 meses depois de cada compra.`)
      : f.saldoFixe != null && f.saldoLogs != null && f.saldoLogs !== f.saldoFixe ? h('div', { class: 'fi-nota' }, `Só pelos Logs o saldo daria ${fmt.int(f.saldoLogs)} pts (${f.saldoFixe > f.saldoLogs ? '+' : ''}${fmt.int(f.saldoFixe - f.saldoLogs)} no FIXE). A diferença costuma ser ponto de compra antiga que os Logs não detalham, ajuste ou bônus, ou ponto vencido que o FIXE ainda não baixou. Veja o extrato abaixo.`) : null,
      f.prox != null ? item('Próximo vencimento', `${fmt.int(f.proxPts)} pts em ${d(f.prox)}`) : null,
      f.em30 ? item('Vencem em 30 dias', `${fmt.int(f.em30)} pts`) : null,
      item('Ganhos · resgatados · expirados', `${fmt.int(f.ganhos)} · ${fmt.int(f.resgatados)} · ${fmt.int(f.expirados)}`),
      c.cadastroFixe != null ? item('No programa desde', d(c.cadastroFixe)) : null,
      linhaSem,
      f.vencidosSemBaixa ? h('div', { class: 'fi-nota' }, `${fmt.int(f.vencidosSemBaixa)} pts já passaram da validade e ainda não aparecem como expirados no FIXE (não entram no saldo).`) : null,
      outras.length ? h('div', { class: 'fi-sub' }, h('div', { class: 'fi-tit2' }, `Compras em outras lojas da rede (${outras.length})`),
        h('ul', { class: 'fi-lista' }, outras.slice(0, 6).map((m) => h('li', null, h('b', null, d(m.day)), ' · ', m.loja, m.produtos.length ? h('small', null, ' — ' + m.produtos.slice(0, 3).join(', ') + (m.produtos.length > 3 ? '…' : '')) : null)))) : null,
      f.movs.length > 5 ? h('details', { class: 'fi-sub fi-extrato' }, h('summary', null, `Extrato completo dos Logs (${f.movs.length} movimentos, com o saldo depois de cada um)`),
        h('table', { class: 'cupom-items' }, h('tbody', null, ...f.movs.map((m) => h('tr', { class: m.anulado ? 'anulado' : null },
          h('td', null, d(m.day), m.min != null ? ` ${String(Math.floor(m.min / 60)).padStart(2, '0')}:${String(m.min % 60).padStart(2, '0')}` : ''),
          h('td', null, TIPO_MOV[m.tipo] || m.tipo, m.txt ? h('small', { class: 'muted' }, ' — ' + m.txt) : null, m.propria ? '' : h('small', { class: 'muted' }, ' · ' + m.loja), m.anulado ? h('small', { class: 'muted' }, ' (cancelado no PDV)') : null),
          h('td', { class: 'r' }, m.pontos ? h('b', { class: ['resgate', 'expirou', 'saida'].includes(m.tipo) ? 'neg' : 'pos' }, `${['resgate', 'expirou', 'saida'].includes(m.tipo) ? '−' : '+'}${m.pontos}`) : ''),
          h('td', { class: 'r muted' }, m.saldoApos != null && !m.anulado ? `saldo ${fmt.int(m.saldoApos)}` : '')))))) : null,
      ult.length ? h('div', { class: 'fi-sub' }, h('div', { class: 'fi-tit2' }, 'Últimos movimentos'),
        h('ul', { class: 'fi-lista' }, ult.map((m) => h('li', { class: m.anulado ? 'anulado' : null, title: m.anulado ? 'Cancelado no PDV logo depois' : null },
          h('b', null, d(m.day)), m.min != null ? ` ${String(Math.floor(m.min / 60)).padStart(2, '0')}:${String(m.min % 60).padStart(2, '0')}` : '', ' · ', TIPO_MOV[m.tipo] || m.tipo,
          m.pontos ? h('strong', { class: m.tipo === 'resgate' || m.tipo === 'expirou' ? 'neg' : 'pos' }, ` ${m.tipo === 'resgate' || m.tipo === 'expirou' ? '−' : '+'}${m.pontos}`) : null,
          m.propria ? '' : h('small', null, ' · ' + m.loja))))) : null);
  }
  function csv(nome, cab, linhas) {
    const esc = (v) => { const t = v == null ? '' : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const blob = new Blob(['﻿' + [cab, ...linhas].map((l) => l.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${nome}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  /** caixinha de indicador dos cartões de fidelidade; com abrir(), vira botão que abre a lista */
  function statFx(rot, val, sub, dica, cls, abrir) {
    const el = h('div', { class: 'fx-stat' + (cls ? ' ' + cls : '') + (abrir ? ' fx-stat-click' : '') }, h('span', null, rot, TS.dica(dica)), h('b', null, val), sub ? h('small', null, sub) : null, abrir ? h('small', { class: 'fx-ver' }, 'ver lista ›') : null);
    if (abrir) { el.setAttribute('role', 'button'); el.tabIndex = 0; el.addEventListener('click', (e) => { if (!e.target.closest('.dica-i')) abrir(); }); el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } }); }
    return el;
  }

  // ---------- resgate de pontos: dos clientes que chegaram ao mínimo para resgatar, quantos resgataram no prazo ----------
  const colsResgate = (comDias) => [
    { key: 'eleg', label: 'Chegou ao mínimo', align: 'l', render: (r) => fmt.date(TS.dayToIso(r.eleg)), csv: (r) => fmt.date(TS.dayToIso(r.eleg)) },
    ...(comDias ? [{ key: 'dias', label: 'Resgatou em', render: (r) => (r.dias === 0 ? 'no mesmo dia' : `${fmt.int(r.dias)} dias`), csv: (r) => r.dias }] : []),
  ];
  function cartaoResgate(fx) {
    if (!fx.movs || !fx.movs.length) return null;
    const rg = (fx.bases.find((b) => b.ev && b.ev.length) || {}).regras || {};
    const min = rg.minResgate || 6, prazo = rg.prazoResgate || 90;
    const ate = fx.logsAte ?? TS.todayDay();
    const noPer = noPeriodoCli() || (() => true);
    // um ciclo por cliente: o primeiro em que ficou elegível dentro do período
    const porCpf = new Map();
    for (const c of TS.fx.resgates(fx.movs, { min, prazo, ate })) if (noPer(c.E) && !porCpf.has(c.cpf)) porCpf.set(c.cpf, c);
    const cs = [...porCpf.values()];
    const sim = cs.filter((c) => c.res === 'sim'), nao = cs.filter((c) => c.res === 'nao'), ab = cs.filter((c) => c.res === 'aberto');
    const fechados = sim.length + nao.length;
    const dias = sim.map((c) => c.dias).sort((a, b) => a - b);
    const mediana = dias.length ? (dias.length % 2 ? dias[(dias.length - 1) / 2] : (dias[dias.length / 2 - 1] + dias[dias.length / 2]) / 2) : null;
    // pontos que se moveram no período (ganhos, resgatados, expirados)
    let ganhos = 0, resg = 0, exp = 0;
    for (const m of fx.movs) {
      if (m.anulado || !noPer(m.day)) continue;
      if ((m.tipo === 'pontos' || m.tipo === 'boasvindas') && m.pontos > 0) ganhos += m.pontos;
      else if (m.tipo === 'resgate') resg += m.pontos;
      else if (m.tipo === 'expirou') exp += m.pontos;
    }
    const stat = statFx;
    const grupo = (titulo, ...itens) => h('div', { class: 'fx-grupo' }, h('div', { class: 'fx-grupo-tit' }, titulo), h('div', { class: 'fx-stats' }, ...itens.filter(Boolean)));
    const taxa = fechados ? sim.length / fechados : null;
    // ---- retorno do programa: o que a loja devolveu em prêmios (no caixa os prêmios saem a R$ 0,01)
    const db = TS.db, rpp = rg.reaisPorPonto || 50;
    // o prêmio sai a R$ 0,01 com o mesmo nome do produto normal; a R$ 0,01 com outro nome (ex.: brinde de promoção) não é resgate
    const chaveNome = TS.nomeChave;
    const precoNormal = new Map(); // nome sem "fidelidade" → Map(preço → peso) das vendas normais
    const linhaNormal = new Map(); // nome sem "fidelidade" → última linha vendida normalmente (para o custo)
    const premios = [];
    let fat = 0;
    const desdeAno = TS.todayDay() - 365;
    for (let i = 0; i < db.n; i++) {
      const vu = db.vu[i];
      if (vu != null && Math.abs(vu - 0.01) < 1e-7) { if (noPer(db.day[i]) && db.qtd[i] > 0 && TS.ehResgate(i)) premios.push(i); continue; }
      if (noPer(db.day[i]) && !TS.rules.ids.taxas.has(db.desc[i])) fat += db.vt[i] || 0;
      if (vu >= 0.05 && db.qtd[i] > 0) {
        const k = chaveNome(db.D.descricao[db.desc[i]]);
        // preço do último ano; produto que só vendeu antes disso usa o preço mais antigo (peso menor)
        let m = precoNormal.get(k); if (!m) precoNormal.set(k, (m = new Map()));
        const pv = Math.round(vu * 100) / 100; m.set(pv, (m.get(pv) || 0) + db.qtd[i] * (db.day[i] >= desdeAno ? 1000 : 1));
        const u = linhaNormal.get(k); if (u == null || db.day[i] >= db.day[u]) linhaNormal.set(k, i);
      }
    }
    const moda = (m) => { let b = null, n = -1; for (const [v, q] of m) if (q > n) { b = v; n = q; } return b; };
    // produto normal do prêmio: mesmo nome; se o prêmio vem sem o tamanho ("Pu Erh Original Fidelidade"), o mais barato
    // dos produtos que começam com esse nome ("Pu Erh Original 50G")
    const parDe = new Map();
    const par = (i) => {
      const k = chaveNome(db.D.descricao[db.desc[i]]);
      if (parDe.has(k)) return parDe.get(k);
      let r = precoNormal.has(k) ? k : null;
      if (!r) { let best = null; for (const [kk, m] of precoNormal) if (kk.startsWith(k + ' ')) { const v = moda(m); if (best == null || v < best[1]) best = [kk, v]; } r = best && best[0]; }
      parDe.set(k, r);
      return r;
    };
    let valorPremios = 0, nPremios = 0, semPar = 0;
    for (const i of premios) {
      nPremios += db.qtd[i];
      const k = par(i);
      if (k) valorPremios += moda(precoNormal.get(k)) * db.qtd[i]; else semPar += db.qtd[i];
    }
    const compras = ganhos * rpp; // compras que geraram pontos
    const prometido = resg ? valorPremios / (resg * rpp) : null; // valor do prêmio ÷ gasto que os pontos representam
    const diasPer = (() => { const pp = state.cli.per; const de = pp.de ?? db.minDay, a = pp.ate ?? db.maxDay; return pp.mes && !pp.ano ? 31 : a - de + 1; })();
    const curto = diasPer < 180;
    const custoBox = h('b', null, '…'), custoSub = h('small', null, 'calculando o custo dos prêmios');
    const custoPctFat = h('small', null);
    const retornoGrupo = premios.length ? h('div', { class: 'fx-grupo' }, h('div', { class: 'fx-grupo-tit' }, 'Retorno do programa'),
      h('div', { class: 'fx-stats' },
        stat('Prometido no resgate', prometido == null ? '—' : fmt.pct(prometido, 1), `valor do prêmio ÷ gasto de R$ ${fmt.int(rpp)} por ponto`, `Quanto o cliente recebe quando resgata: valor dos prêmios ÷ (pontos resgatados × R$ ${rpp}). Comparável à tabela de prêmios da franquia.`),
        stat('Retorno efetivo ao cliente', compras ? fmt.pct(valorPremios / compras, 1) : '—', fat ? `${fmt.pct(valorPremios / fat, 1)} do faturamento total` : null, `Valor de venda dos prêmios entregues ÷ compras que geraram pontos no período (pontos ganhos × R$ ${rpp}). Menor que o prometido porque nem todos resgatam e pontos vencem. Abaixo: o mesmo valor sobre todo o faturamento da loja.`, 'ok'),
        h('div', { class: 'fx-stat ok' }, h('span', null, 'Custo real para a loja', TS.dica('Custo dos produtos dados como prêmio (o que a loja gastou de fato) ÷ compras que geraram pontos. Abaixo: sobre todo o faturamento.')), custoBox, custoSub, custoPctFat)),
      null) : null;
    // "Como é calculado": as contas com os números do período
    const brl = fmt.brl0, linhaCusto = h('li', null, 'Custo real para a loja: calculando…');
    const conta = h('details', { class: 'rs-conta' }, h('summary', null, 'Como é calculado'),
      h('ul', null,
        h('li', null, h('b', null, 'Resgatam: '), `dos ${fmt.int(cs.length)} clientes que chegaram a ${fmt.int(min)} pontos no período, ${fmt.int(sim.length)} resgataram em até ${fmt.int(prazo)} dias e ${fmt.int(nao.length)} não; os ${fmt.int(ab.length)} que ainda estão no prazo ficam fora. ${fmt.int(sim.length)} ÷ ${fmt.int(fechados)} = ${taxa == null ? '—' : fmt.pct(taxa, 0)}. Cada cliente conta uma vez (a primeira vez no período em que o saldo válido chegou ao mínimo).`),
        premios.length ? h('li', null, h('b', null, 'Prêmios: '), `${fmt.int(nPremios)} itens saíram no caixa a R$ 0,01 com o nome de um produto vendido normalmente (ou com "Fidelidade" no nome). Pelo preço normal desses produtos, valem ${brl(valorPremios)}${semPar ? ` (${fmt.int(semPar)} sem produto correspondente ficaram fora)` : ''}. Itens a R$ 0,01 com outro nome (promoções) não entram.`) : null,
        premios.length ? h('li', null, h('b', null, 'Prometido no resgate: '), `${brl(valorPremios)} ÷ (${fmt.int(resg)} pontos resgatados × R$ ${fmt.int(rpp)} = ${brl(resg * rpp)}) = ${prometido == null ? '—' : fmt.pct(prometido, 1)}. É o que o cliente recebe quando resgata; comparável à tabela de prêmios.`) : null,
        premios.length ? h('li', null, h('b', null, 'Retorno efetivo ao cliente: '), `${brl(valorPremios)} ÷ (${fmt.int(ganhos)} pontos ganhos × R$ ${fmt.int(rpp)} = ${brl(compras)} em compras que geraram pontos) = ${compras ? fmt.pct(valorPremios / compras, 1) : '—'}. Sobre todo o faturamento (${brl(fat)}): ${fat ? fmt.pct(valorPremios / fat, 1) : '—'}. Fica abaixo do prometido porque nem todos resgatam e pontos vencem.`) : null,
        premios.length ? linhaCusto : null,
        h('li', null, `Mínimo (${fmt.int(min)} pontos) e prazo (${fmt.int(prazo)} dias) ficam em Configurações → Lojas → Integrações → Regras dos pontos.`)));
    if (retornoGrupo) {
      const semAcesso = () => { custoBox.textContent = '—'; custoSub.textContent = 'sem acesso ao estoque e custos'; linhaCusto.replaceChildren(h('b', null, 'Custo real para a loja: '), 'aparece para quem tem acesso a Estoque e margem.'); };
      if (TS.custosLoja) TS.custosLoja().then((M) => {
        if (!M) return semAcesso();
        let c = 0, sem = 0;
        for (const i of premios) {
          // custo do próprio prêmio no estoque; se não tiver, o custo unitário do produto normal (mesmo nome sem "fidelidade")
          let x = M.custo(i);
          if (x == null) { const pk = par(i), j = pk ? linhaNormal.get(pk) : null; const cj = j != null ? M.custo(j) : null; if (cj != null && db.qtd[j] > 0) x = (cj / db.qtd[j]) * db.qtd[i]; }
          if (x == null) sem += db.qtd[i]; else c += x;
        }
        custoBox.textContent = compras ? fmt.pct(c / compras, 1) : '—';
        custoSub.textContent = `${fmt.brl0(c)} em prêmios${sem ? ` (${fmt.int(sem)} sem custo, fora)` : ''}`;
        custoPctFat.textContent = fat ? `${fmt.pct(c / fat, 1)} do faturamento total` : '';
        linhaCusto.replaceChildren(h('b', null, 'Custo real para a loja: '), `custo dos prêmios ${fmt.brl0(c)} ÷ ${fmt.brl0(compras)} = ${compras ? fmt.pct(c / compras, 1) : '—'}; sobre o faturamento: ${fat ? fmt.pct(c / fat, 1) : '—'}. Custo do próprio prêmio no estoque ou, sem ele, o do produto normal${sem ? `; ${fmt.int(sem)} sem custo ficaram fora` : ''}.`);
      }).catch(semAcesso); else semAcesso();
    }
    const card = TS.card('Resgate de pontos', `Clientes que chegaram a ${fmt.int(min)} pontos (o mínimo para resgatar) no período · resgatou = fez um resgate em até ${fmt.int(prazo)} dias${fx.logsAte != null ? ` · logs do FIXE até ${fmt.date(TS.dayToIso(fx.logsAte))}` : ''}`,
      cs.length ? h('div', null,
        h('div', { class: 'rs-topo' },
          h('div', { class: 'rs-num' }, h('b', null, taxa == null ? '—' : fmt.pct(taxa, 0)), h('span', null, 'resgatam')),
          h('p', null, fechados ? `${fmt.int(sim.length)} de ${fmt.int(fechados)} clientes que chegaram a ${fmt.int(min)} pontos resgataram em até ${fmt.int(prazo)} dias.` : `Ninguém completou ainda os ${fmt.int(prazo)} dias de prazo.`,
            ab.length ? h('span', { class: 'muted' }, ` ${fmt.int(ab.length)} ${ab.length === 1 ? 'cliente ainda está' : 'clientes ainda estão'} no prazo e não entram na conta.`) : null)),
        premios.length && curto ? h('div', { class: 'notice rs-aviso' }, `Período curto (${fmt.int(diasPer)} dias): os resgates de agora vêm de pontos ganhos meses antes, então o retorno do programa oscila. Para um número confiável use 12 meses.`) : null,
        h('div', { class: 'rs-grupos' },
        grupo('Clientes',
          stat('Resgataram', fmt.int(sim.length), mediana != null ? (mediana < 1 ? 'a maioria no mesmo dia em que chegou ao mínimo' : `metade em até ${fmt.int(Math.round(mediana))} dias`) : null, `Fizeram um resgate até ${prazo} dias depois de chegar a ${min} pontos. Clique para ver quem.`, 'ok',
            sim.length ? () => listaClientesJanela('Resgataram', `Chegaram a ${min} pontos no período e resgataram em até ${prazo} dias.`, sim.map((x) => ({ cpf: x.cpf, eleg: x.E, dias: x.dias })), colsResgate(true), 'resgataram') : null),
          stat('Não resgataram', fmt.int(nao.length), `passaram ${fmt.int(prazo)} dias sem resgate`, `Chegaram a ${min} pontos e não resgataram em ${prazo} dias (alguns podem estar juntando para um prêmio maior). Clique para ver quem e chamar para resgatar.`, nao.length ? 'alerta' : null,
            nao.length ? () => listaClientesJanela('Não resgataram', `Chegaram a ${min} pontos no período e passaram ${prazo} dias sem resgatar. Bons para um convite: "você tem pontos para trocar por um prêmio".`, nao.map((x) => ({ cpf: x.cpf, eleg: x.E })), colsResgate(false), 'nao-resgataram') : null),
          stat('Ainda no prazo', fmt.int(ab.length), 'ficam fora do %', `Chegaram a ${min} pontos há menos de ${prazo} dias: ainda podem resgatar. Clique para ver quem.`, null,
            ab.length ? () => listaClientesJanela('Ainda no prazo', `Chegaram a ${min} pontos há menos de ${prazo} dias.`, ab.map((x) => ({ cpf: x.cpf, eleg: x.E })), colsResgate(false), 'no-prazo') : null)),
        grupo('Pontos no período',
          stat('Ganhos', fmt.int(ganhos), 'compras e boas-vindas', 'Pontos lançados no FIXE no período: compras (R$ ' + fmt.int(rpp) + ' = 1 ponto) e pontos de boas-vindas. Cancelamentos no caixa são descontados.'),
          stat('Resgatados', fmt.int(resg), ganhos ? `${fmt.pct(resg / ganhos, 0)} dos ganhos` : null, 'Pontos trocados por prêmios no período. A % compara com os pontos ganhos no mesmo período (os resgatados podem ter sido ganhos antes).'),
          stat('Expirados', fmt.int(exp), ganhos ? `${fmt.pct(exp / ganhos, 0)} dos ganhos` : null, `Pontos que venceram sem uso no período (cada ponto vale ${fmt.int(rg.validadeMeses || 12)} meses).`, exp ? 'alerta' : null)),
        retornoGrupo),
        conta)
        : TS.empty(`Nenhum cliente chegou a ${min} pontos no período.`));
    card.classList.add('fx-card');
    return card;
  }

  function cartaoFixe(fx) {
    const em = (fx.bases || []).map((b) => b.em).filter(Boolean).sort()[0];
    const nomes = (fx.bases || []).map((b) => b.lojas.filter((n, i) => b.propria[i]).join(' / ')).filter(Boolean).join(' · ');
    const sem = fx.alvos - fx.ligadas;
    const d = (day) => fmt.date(TS.dayToIso(day));
    const semFixe = (fx.semFixe || []).slice().sort((a, b) => b.k.day - a.k.day);
    const ptsSem = semFixe.reduce((t, x) => t + x.k.ptsPerdidos, 0);
    const fora = fx.temLeads ? TS.cli.lista.filter((c) => c.tags.has('forafixe')).sort((a, b) => b.ultima - a.ultima) : [];
    // cada lista abre numa janela ao clicar no indicador correspondente
    const janelas = {};
    if (fx.divergencias.length) janelas.div = () => abrirLista(`Compras com CPF diferente (${fmt.int(fx.divergencias.length)})`, h('p', { class: 'muted' }, 'Compra feita num CPF, mas os pontos foram para outro CPF no FIXE. Clique numa linha para ver os dois históricos lado a lado.'), TS.table({
      cols: [
        { key: 'data', label: 'Data', align: 'l' }, { key: 'cupom', label: 'Cupom', align: 'l' },
        { key: 'nota', label: 'CPF da nota', align: 'l', render: (r) => cpfLink(r.x.cpfNota, { cupom: r.x.cupom, day: r.x.day, cpfNota: r.x.cpfNota }, r.x.cpfFixe) }, { key: 'fixe', label: 'CPF no FIXE', align: 'l', render: (r) => cpfLink(r.x.cpfFixe, { cupom: r.x.cupom, day: r.x.day, cpfNota: r.x.cpfNota }) }, { key: 'nome', label: 'Nome no FIXE', align: 'l' }, { key: 'vt', label: 'Valor', fmt: fmt.brl },
      ],
      rows: fx.divergencias.map((x) => ({ data: d(x.day), dia: x.day, cupom: String(x.cupom), nota: fmtCPF(x.cpfNota), fixe: fmtCPF(x.cpfFixe), nome: x.nomeFixe || '—', vt: x.vt, x })),
      sortKey: 'dia',
      onRowClick: (row) => abrirClientes([row.x.cpfNota, row.x.cpfFixe], { cupom: row.x.cupom, day: row.x.day, cpfNota: row.x.cpfNota }),
    }));
    if (semFixe.length) {
      const linhas = semFixe.map(({ c, k }) => ({ data: d(k.day), dia: k.day, cupom: String(k.cupom), nome: c.nome || '—', cpf: fmtCPF(c.cpf), cpfN: c.cpf, vt: k.vt, pts: k.ptsPerdidos, vend: k.vendedores || '—', k }));
      janelas.sem = () => abrirLista(`Vendas sem FIXE (${fmt.int(semFixe.length)})`,
        h('p', { class: 'muted' }, 'A nota saiu com o CPF de quem está no FIXE (depois do cadastro), mas o FIXE não tem nenhum movimento desse CPF no dia. Pode ser que o cliente não tenha informado ou que a compra não tenha sido lançada. Serve para conferir e, se o FIXE permitir, lançar os pontos.'),
        h('div', { class: 'cfg-acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => csv('vendas-sem-fixe', ['Data', 'Cupom', 'Cliente', 'CPF', 'Valor (R$)', 'Pontos não lançados', 'Vendedora'], linhas.map((r) => [r.data, r.cupom, r.nome, r.cpf, r.vt.toFixed(2).replace('.', ','), r.pts, r.vend])) }, 'Baixar lista (CSV)')),
        TS.table({
          cols: [{ key: 'data', label: 'Data', align: 'l' }, { key: 'cupom', label: 'Cupom', align: 'l' }, { key: 'nome', label: 'Cliente', align: 'l' }, { key: 'cpf', label: 'CPF', align: 'l', render: (r) => cpfLink(r.cpfN) },
            { key: 'vt', label: 'Valor', fmt: fmt.brl }, { key: 'pts', label: 'Pontos', fmt: fmt.int }, { key: 'vend', label: 'Vendedora', align: 'l' }],
          rows: linhas, sortKey: 'dia', onRowClick: (r) => abrirClientes([r.cpfN], { cupom: r.k.cupom, day: r.k.day }),
        }));
    }
    if (fora.length) {
      const linhas = fora.map((c) => { const ct = contatoDe(c) || {}; return { nome: c.nome || '—', cpf: fmtCPF(c.cpf), cpfN: c.cpf, cel: ct.optout ? 'não quer mensagens' : fmtTel(c.celular) || '—', compras: c.visitas, ultima: d(c.ultima), dia: c.ultima, vend: c.vendedora || '—' }; });
      janelas.fora = () => abrirLista(`Clientes fora do FIXE (${fmt.int(fora.length)})`,
        h('p', { class: 'muted' }, 'Deram o CPF na nota, mas não estão na base do FIXE desta loja (Base de leads). Se o cliente se cadastrou em outra loja da rede com outra base, também aparece aqui.'),
        h('div', { class: 'cfg-acoes' }, h('button', { type: 'button', class: 'btn', onclick: () => csv('clientes-fora-do-fixe', ['Cliente', 'CPF', 'Celular', 'Compras', 'Última compra', 'Mais atendida por'], linhas.map((r) => [r.nome, r.cpf, TS.demo ? '' : r.cel, r.compras, r.ultima, r.vend])) }, 'Baixar lista (CSV)')),
        TS.table({
          cols: [{ key: 'nome', label: 'Cliente', align: 'l' }, { key: 'cpf', label: 'CPF', align: 'l', render: (r) => cpfLink(r.cpfN) }, { key: 'cel', label: 'Celular', align: 'l' }, { key: 'compras', label: 'Compras', fmt: fmt.int }, { key: 'ultima', label: 'Última compra', align: 'l' }, { key: 'vend', label: 'Mais atendida por', align: 'l' }],
          rows: linhas, sortKey: 'dia', onRowClick: (r) => abrirClientes([r.cpfN]),
        }));
    }
    const comoFunciona = `O FIXE não guarda o número do cupom. O painel procura, na mesma loja e no mesmo dia, o cupom com hora próxima (até 2 h), os mesmos produtos e o valor que daria os pontos lançados. Só liga quando um cupom é claramente o melhor; na dúvida, deixa sem ligar. "Venda sem FIXE" só olha compras entre o cadastro do cliente no FIXE e a data dos Logs${fx.logsAte != null ? ` (${d(fx.logsAte)})` : ''}.${nomes ? ` Lojas do FIXE consideradas desta loja: ${nomes}.` : ''} Clique nos indicadores marcados com "ver lista" para abrir os clientes.`;
    const stat = statFx;
    const grupo = (titulo, ...itens) => { const v = itens.filter(Boolean); return v.length ? h('div', { class: 'fx-grupo' }, h('div', { class: 'fx-grupo-tit' }, titulo), h('div', { class: 'fx-stats' }, ...v)) : null; };
    const card = TS.card('Fidelidade (FIXE)', `Compras do programa de fidelidade ligadas aos cupons de venda${em ? ` · logs de ${fmt.date(em.slice(0, 10))}` : ''} · clique nos indicadores com "ver lista"`,
      fx.temLogs ? grupo('Ligação das compras do FIXE aos cupons',
        stat('Compras no FIXE', fmt.int(fx.alvos), 'nesta loja, no período das vendas', 'Movimentos de compra do FIXE desta loja em dias que têm vendas no painel'),
        stat('Cupom confirmado', fmt.int(fx.confirmadas), 'mesmo CPF na nota e no FIXE', 'Compras do FIXE ligadas a um cupom que saiu com o mesmo CPF na nota: tudo certo.'),
        stat('Cliente achado pelo FIXE', fmt.int(fx.porFixe), 'nota sem CPF', 'A nota saiu sem CPF: a compra passou a contar para o cliente do FIXE'),
        stat('Sem cupom', fmt.int(sem), sem && fx.alvos ? fmt.pct(sem / fx.alvos, 0) + ' das compras do FIXE' : null, 'Não achou um cupom claramente igual (hora ou produtos diferentes, ou mais de um parecido)')) : null,
      grupo('Para conferir e corrigir',
        fx.temLogs ? stat('CPF diferente', fmt.int(fx.divergencias.length), 'nota num CPF, pontos em outro', 'Compra feita num CPF, mas foi usado outro CPF no FIXE. Clique para ver as compras.', fx.divergencias.length ? 'alerta' : null, janelas.div) : null,
        fx.temLogs ? stat('Vendas sem FIXE', fmt.int(semFixe.length), ptsSem ? `${fmt.int(ptsSem)} pts não lançados` : 'sem lançamento no dia', 'Nota no CPF de quem está no FIXE e nenhum movimento no FIXE no dia. Clique para ver as vendas.', semFixe.length ? 'alerta' : null, janelas.sem) : null,
        fx.temLeads ? stat('Fora do FIXE', fmt.int(fora.length), 'deram CPF, não estão na base', 'Clientes com CPF na nota que não estão na Base de leads do FIXE desta loja: dá para convidar a se cadastrar. Clique para ver quem.', null, janelas.fora) : null));
    // "Como funciona" vai para o ⓘ do título (texto com as lojas desta base)
    const ic = card.querySelector('.card-title .dica-i');
    if (ic) ic.replaceWith(TS.dica(comoFunciona));
    // pontos antigos importados no FIXE: não vencem (o FIXE só faz vencer os pontos lançados por ele)
    { let n = 0, pts = 0;
      for (const f of (TS.cli.fxPorCpf || new Map()).values()) if (f.saldoFixe != null && f.saldoLogs != null && f.saldoFixe > f.saldoLogs) { n++; pts += f.saldoFixe - f.saldoLogs; }
      if (n) card.append(h('div', { class: 'notice fx-antigos' }, h('b', null, `${fmt.int(pts)} pts de ${fmt.int(n)} clientes vêm de compras antigas importadas no FIXE e não vencem. `),
        'Nos Logs, o FIXE só faz vencer os pontos lançados por ele (12 meses depois de cada compra); o saldo importado ficou sem data. Por isso esses clientes não entram em "Pontos vencendo". Vale confirmar com a FIXE se esse saldo deveria vencer.')); }
    card.classList.add('fx-card');
    return card;
  }
  // usado pela tela Campanhas
  TS.cliApi = {
    aplicarCelular: (cpf, vinc) => aplicarCelular(cpf, vinc), mesmoTel: (a, b) => mesmoTel(a, b),
    telConfere: (cel, q) => telConfere(cel, telBusca(q)),
    abrirClientes: (cpfs) => abrirClientes(cpfs), contatoDe: (c) => contatoDe(c), intervalo: () => intervaloDe(state.loja), recarregarContatos: () => recarregarContatos(), marcar: (c, acao, motivo) => marcar(c, acao, motivo),
    carregarContatos: () => carregarContatos(), modelos: () => modelosDe(state.loja), fmtTel: (x) => fmtTel(x), fmtCPF: (x) => fmtCPF(x), csv: (a, b, c) => csv(a, b, c),
    texto: (txt, c, extra = {}) => TS.msgWpp.montar(txt, valoresWpp(c), extra), valores: (c) => valoresWpp(c),
    linkWpp: (c, txt) => linkWpp(c, txt), enviarWpp: (c, txt, motivo, campanha) => enviarWpp(c, txt, motivo, campanha),
    hojeItens: (val, disp) => hojeItens(val, disp), MOTIVOS_HOJE,
    /** todos os clientes que podem entrar numa campanha: os da lista + quem só aparece no FIXE (com cadastro) */
    universo() {
      const out = [...TS.cli.lista];
      const vistos = new Set(out.map((c) => c.cpf));
      for (const [cpf, f] of TS.cli.fxPorCpf || []) {
        if (vistos.has(cpf)) continue;
        const info = (TS.cli.cad && TS.cli.cad.get(cpf)) || {};
        const cel = digits(info.celular);
        const local = cel.length >= 12 && cel.startsWith('55') ? cel.slice(2) : cel;
        out.push({ cpf, nome: (info.nome || f.nome || '').trim(), celular: cel, wpp: local.length >= 10 && local.length <= 11 ? 'https://wa.me/55' + local : null,
          nascimento: info.nascimento || null, cupons: [], visitas: 0, ultima: null, ausencia: null, tags: new Set(f.em30 > 0 ? ['vence'] : []), fx: f, soFixe: true, ...celInfo(info) });
      }
      return out;
    },
  };
  const fmtTel = (cel) => {
    let d = String(cel || '').replace(/\D/g, '');
    if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d || null;
  };
  // ---------- celular trocado pelo painel (vínculo da conversa do WhatsApp) ----------
  const soLocal = (n) => { const d = String(n || '').replace(/\D/g, ''); return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d; };
  /** chave do celular, a mesma do servidor (`ZF.foneChave`, src/zapfila.js): 55 + DDD + número, com o 9 do celular —
   *  com e sem o 9 é o mesmo número (pedido do dono). '' quando não tem DDD */
  const telChave = (n) => { let d = String(n || '').replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; if (d.length === 12 && d.startsWith('55') && /[6-9]/.test(d[4])) d = d.slice(0, 4) + '9' + d.slice(4); return /^55\d{10,11}$/.test(d) ? d : ''; };
  const mesmoTel = (a, b) => { const ka = telChave(a); return !!ka && ka === telChave(b); };
  /** ⓘ do celular na ficha: de onde vem o número */
  function celDica(c) {
    if (!c.celVinc) return c.celTirado ? TS.dica('O número que este cliente tinha no FIXE foi ligado a outro cliente pelo painel (pela conversa do WhatsApp). Ele fica sem celular no painel até o FIXE ter outro número.') : null;
    const quando = c.celVinc.em ? fmt.date(c.celVinc.em.slice(0, 10)) : '';
    return TS.dica(`Número trocado pelo painel${quando ? ' em ' + quando : ''}${c.celVinc.por ? ' por ' + c.celVinc.por : ''}, pela conversa do WhatsApp. É ele que vale no Hoje, nas campanhas e no robô. O FIXE não foi mudado.`);
  }
  /** linha embaixo do celular: o número do FIXE (igual, outro ou o antigo) */
  function celNota(c) {
    if (c.celTirado && !c.celVinc) return h('div', { class: 'fi' }, h('span', null, 'Celular', celDica(c)), h('b', { class: 'muted' }, 'ligado a outro cliente pelo painel'));
    if (!c.celVinc) return null;
    const fixe = c.celFixe || '', antigo = c.celVinc.antigo || '';
    const quando = c.celVinc.em ? fmt.date(c.celVinc.em.slice(0, 10)) : '';
    let txt;
    if (fixe && mesmoTel(fixe, c.celular)) txt = 'igual ao do FIXE';
    else if (fixe && antigo && !mesmoTel(fixe, antigo)) return h('small', { class: 'warn-t cel-nota' }, `Trocado pelo painel${quando ? ' em ' + quando : ''}. O FIXE tem outro número agora: ${fmtTel(fixe)} — desfaça o vínculo na conversa para usar o do FIXE.`);
    else txt = `trocado pelo painel${quando ? ' em ' + quando : ''}${c.celVinc.por ? ' por ' + c.celVinc.por : ''}${fixe ? ` · no FIXE: ${fmtTel(fixe)}` : ''}`;
    return h('small', { class: 'muted cel-nota' }, txt);
  }
  /**
   * aplica o vínculo na memória da tela (depois de vincular/desfazer: o próximo /api/dados já vem com ele do servidor).
   * vinc = { cel, em, por, antigo } ou null (desfazer: volta o do FIXE).
   */
  function aplicarCelular(cpf, vinc) {
    if (TS.garantirClientes) TS.garantirClientes();
    const cad = TS.cli && TS.cli.cad;
    if (!cad) return;
    let info = cad.get(cpf);
    if (!info) { info = { cpf, nome: '', celular: '' }; cad.set(cpf, info); if (TS.db && TS.db.clientes) TS.db.clientes.push(info); }
    const wppDe = (cel) => { const l = soLocal(cel); return l.length >= 10 && l.length <= 11 ? (TS.demo ? '#demo' : 'https://wa.me/55' + l) : null; };
    const alvos = (k) => [cad.get(k), TS.cli.porCPF && TS.cli.porCPF.get(k)].filter(Boolean);
    if (vinc) {
      // outro cliente com o mesmo número fica sem ele (um número, um cliente)
      for (const [k, o] of cad) if (k !== cpf && o && mesmoTel(o.celular, vinc.cel)) for (const x of alvos(k)) { if (x.celVinc) { x.celular = x.celFixe || ''; delete x.celVinc; } else { x.celFixe = x.celular; x.celular = ''; x.celTirado = true; } x.wpp = wppDe(x.celular); }
      for (const x of alvos(cpf)) { if (!x.celVinc) x.celFixe = x.celular || ''; x.celular = vinc.cel; x.celVinc = { em: vinc.em, por: vinc.por, antigo: vinc.antigo || x.celFixe || '' }; x.celTirado = false; x.wpp = wppDe(vinc.cel); }
    } else {
      for (const x of alvos(cpf)) { if (x.celVinc) { x.celular = x.celFixe || ''; delete x.celVinc; x.wpp = wppDe(x.celular); } }
    }
  }
  function acoesCliente(c) {
    const box = h('div', { class: 'cli-acoes' });
    const pintar = () => {
      const ct = contatoDe(c) || {};
      box.replaceChildren();
      if (ct.optout) {
        box.append(h('span', { class: 'muted' }, ct.optoutOrigem ? `Não recebe mensagens: ${ct.optoutOrigem}${ct.optoutEm ? ' em ' + fmt.date(ct.optoutEm.slice(0, 10)) : ''}. Se foi engano, clique em "Voltou a aceitar". ` : 'Pediu para não receber mensagens. '), h('button', { type: 'button', class: 'btn', onclick: () => agir('aceita') }, 'Voltou a aceitar'));
        return;
      }
      if (c.wpp) {
        const mods = modelosDe(lojaIdDe(c));
        const sugerido = c.tags.has('aniv') ? 'Aniversário' : c.tags.has('repor') ? 'Hora de repor' : c.tags.has('sumido') || c.tags.has('uma') ? 'Sentimos sua falta' : 'Novidades';
        const sel = h('select', { class: 'f-input', 'aria-label': 'Modelo de mensagem' }, mods.map((m, k) => h('option', { value: k, selected: m.nome === sugerido || null }, m.nome)));
        const prev = h('div', { class: 'cli-msg' });
        const atual = () => mods[+sel.value];
        const aviso = h('div', { class: 'notice cli-sem-estoque', hidden: true });
        // a trava de estoque só libera o botão depois de ler o estoque (clique rápido não passa sem conferir)
        let disp = null, faltando = null, lido = !(TS.estoqueDisp && state.loja && state.loja !== 'todas');
        const pv = () => {
          prev.textContent = textoWpp(atual(), c);
          faltando = TS.semEstoqueNaMensagem ? TS.semEstoqueNaMensagem(disp, atual().texto, c) : null;
          aviso.hidden = !faltando; aviso.textContent = faltando ? `🚫 ${faltando} está sem estoque (no chá a granel, menos de 100 g): esta mensagem oferece um produto que a loja não tem. Escolha outra mensagem ou espere a nota de entrada.` : '';
          const bt = box.querySelector('.cli-wpp a.btn.primary'); if (bt) bt.classList.toggle('desab', !!faltando);
        };
        sel.addEventListener('change', pv); pv();
        if (!lido) TS.estoqueDisp(state.loja).then((d) => { disp = d; lido = true; pv(); }).catch(() => { lido = true; aviso.hidden = false; aviso.textContent = 'Não consegui ler o estoque agora: confira se o produto da mensagem tem na loja antes de enviar.'; });
        const rr0 = recebeuRecente(c);
        box.append(h('div', { class: 'cli-wpp' }, h('span', { class: 'f-label' }, 'Mensagem pronta'), sel, prev, aviso,
          rr0 ? h('div', { class: 'notice cli-sem-estoque' }, `⏳ Recebeu mensagem há ${rr0.dias} ${rr0.dias === 1 ? 'dia' : 'dias'}${rr0.ct.motivo ? ' (' + rr0.ct.motivo + ')' : ''}: a próxima só a partir de ${rr0.ate.toLocaleDateString('pt-BR')} (uma a cada ${rr0.iv} dias).`) : null,
          h('div', { class: 'cfg-inline' },
            h('a', { class: 'btn primary', href: '#', onclick: async (e) => {
              e.preventDefault();
              if (!lido) { TS.avisar('Conferindo o estoque… tente de novo em um instante.'); return; }
              if (faltando) { TS.avisar(`${faltando} está sem estoque (no chá a granel, menos de 100 g): escolha outra mensagem.`); return; }
              const rr = recebeuRecente(c);
              if (rr) { TS.avisar(`${c.nome || 'Este cliente'} recebeu mensagem da loja há ${rr.dias} ${rr.dias === 1 ? 'dia' : 'dias'}${rr.ct.motivo ? ' (' + rr.ct.motivo + ')' : ''}. Para não ser insistente, a próxima só a partir de ${rr.ate.toLocaleDateString('pt-BR')} (uma mensagem a cada ${rr.iv} dias).`); return; }
              if (TS.demo) { await TS.avisar(textoWpp(atual(), c), { titulo: 'Na apresentação o WhatsApp não abre (número fictício). A mensagem seria:' }); try { await marcar(c, 'contatado', atual().nome); pintar(); } catch (er) { TS.avisarErro(er); } return; }
              // o servidor confere a regra da loja antes de abrir (regra forte: uma mensagem por cliente no intervalo)
              try { await enviarWpp(c, textoWpp(atual(), c), atual().nome); pintar(); } catch (er) { if (er.bloqueado) { TS.avisar(er.message); await recarregarContatos(); pintar(); } else TS.avisarErro(er); }
            } }, 'Abrir no WhatsApp'),
            h('small', { class: 'muted' }, 'Ao abrir, o cliente fica marcado como contatado.'))));
      }
      box.append(h('div', { class: 'cfg-inline cli-botoes' },
        ct.em ? h('span', { class: 'muted' }, `Contatado em ${fmt.date(ct.em.slice(0, 10))}${ct.por ? ' por ' + ct.por : ''}${ct.motivo ? ' (' + ct.motivo + ')' : ''}.`) : null,
        h('button', { type: 'button', class: 'btn', onclick: () => agir('contatado', 'ligação/outro') }, ct.em ? 'Marcar contato de novo' : 'Marcar como contatado'),
        ct.em ? h('button', { type: 'button', class: 'btn', onclick: () => agir('limpar') }, 'Desfazer contato') : null,
        // Conversas do WhatsApp: só admin e franqueado (decisão do dono)
        c.wpp && (TS.demo || (TS.eu && ['admin', 'franqueado'].includes(TS.eu.perfil))) && TS.pages.conversas ? h('button', { type: 'button', class: 'btn', title: 'Abre a conversa do WhatsApp da loja com este cliente (Clientes → Conversas).', onclick: () => { TS.abrirConversa = TS.foneConversa ? TS.foneConversa(c) : ''; document.querySelectorAll('.camada-cheia').forEach((x) => x.remove()); document.body.classList.remove('com-camada'); location.hash = '#conversas'; } }, '💬 Ver conversa') : null,
        h('button', { type: 'button', class: 'btn ghost-danger', title: 'LGPD: a pessoa sai das listas de contato e da exportação para WhatsApp', onclick: () => { if (confirm('Marcar que este cliente NÃO quer receber mensagens?')) agir('optout'); } }, 'Não quer mensagens')));
    };
    const agir = async (acao, motivo) => { try { await marcar(c, acao, motivo); pintar(); } catch (e) { TS.avisarErro(e); } };
    pintar();
    return box;
  }

  const fmtCPF = (s) => (s && s.length === 11 ? `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`
    : s && s.length === 14 ? `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}` : s || '');

  /** para lista de transmissão / campanha: só quem tem WhatsApp e não pediu para não receber mensagens */
  function baixarCSVWpp(lista) {
    const ok = lista.filter((r) => r.c.wpp && !(contatoDe(r.c) || {}).optout);
    if (!ok.length) { TS.avisar('Nenhum cliente da lista tem WhatsApp (ou todos pediram para não receber mensagens).'); return; }
    const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const cel = (c) => { const d = c.celular.replace(/\D/g, ''); return d.startsWith('55') && d.length >= 12 ? '+' + d : '+55' + d; };
    const linhas = [['Nome', 'Celular'].join(';'), ...ok.map((r) => [r.c.nome, TS.demo ? '' : cel(r.c)].map(esc).join(';'))];
    const blob = new Blob(['\ufeff' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `whatsapp-teashop-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function baixarCSV(lista) {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const linhas = [['Nome', 'CPF', 'Celular', 'WhatsApp', 'E-mail', 'Cidade', 'Nascimento', 'Visitas', 'Total (R$)', 'Última compra', 'Dias sem comprar', 'Segmentos', 'Chá favorito', 'Aceita mensagens', 'Último contato'].join(';')];
    for (const r of lista) {
      const c = r.c, ct = contatoDe(c) || {};
      linhas.push([c.nome, fmtCPF(c.cpf), c.celular, TS.demo ? '' : c.wpp || '', c.email, c.cidade, c.nascimento ? fmt.date(c.nascimento) : '', r.visitas, r.vt.toFixed(2).replace('.', ','), c.ultima != null ? fmt.date(TS.dayToIso(c.ultima)) : '', c.ausencia ?? '',
        [...(c.tags || [])].map((t) => NOMES_SEG[t]).join(', '), c.chaFavorito || '', ct.optout ? 'Não' : 'Sim', ct.em ? fmt.date(ct.em.slice(0, 10)) : ''].map(esc).join(';'));
    }
    const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `clientes-teashop-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
})();
