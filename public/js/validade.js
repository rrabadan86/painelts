/* Estoque → Validade: lotes do chá a granel (só o chá em kg tem validade).
   Cada entrada de chá é um lote, com validade de 12 meses da entrada. A equipe digita o nº do lote (vem "0")
   e corrige a validade se o pacote disser outra coisa. O saldo de cada lote vem do estoque atual do AppNext,
   distribuído da entrada mais nova para a mais antiga (o mais antigo foi vendido primeiro).
   Também alimenta: Vendas → Promoção ("vender primeiro"), Estoque → Pedido (aviso) e Clientes → Campanhas. */
(function () {
  const { h, fmt, state } = TS;
  const COR = { vencido: 'vl-vencido', critica: 'vl-critica', acao: 'vl-acao', atencao: 'vl-atencao', ok: 'vl-ok', sem: 'vl-sem' };
  const ICONE = { vencido: '⚫', critica: '🔴', acao: '🟠', atencao: '🟡', ok: '🟢', sem: '⚪' };
  const NOME = { vencido: '⚫ Vencido', critica: '🔴 Menos de 30 dias', acao: '🟠 30 a 60 dias', atencao: '🟡 60 a 90 dias', ok: '🟢 Mais de 90 dias', sem: '⚪ Sem data' };
  const CURTO = { vencido: 'Vencido', critica: '< 30 dias', acao: '30–60 dias', atencao: '60–90 dias', ok: '> 90 dias', sem: 'Sem data' };
  const kgTxt = (v) => (v == null ? '—' : v < 1 ? `${fmt.int(Math.round(v * 1000))} g` : `${fmt.kg(v)} kg`);
  const diasTxt = (d) => (d == null ? 'sem data' : d < 0 ? `venceu há ${-d} d` : d === 0 ? 'vence hoje' : `${d} d`);
  const toast = (msg, erro) => { const t = h('div', { class: 'toast' + (erro ? ' err' : '') }, msg); document.body.append(t); setTimeout(() => t.remove(), erro ? 6000 : 3000); };

  async function req(metodo, url, corpo) {
    const r = await fetch(TS.api(url), { method: metodo, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.erro || 'Não deu certo.'); e.status = r.status; throw e; }
    return j;
  }
  // os dados ficam guardados 1 minuto (Promoção, Pedido e a tela usam os mesmos)
  const cache = new Map();
  function dados(loja, forcar) {
    const c = cache.get(loja);
    if (!forcar && c && Date.now() - c.em < 60000) return c.p;
    const p = req('GET', `validade?loja=${encodeURIComponent(loja)}`);
    cache.set(loja, { em: Date.now(), p });
    p.catch(() => cache.delete(loja));
    return p;
  }
  const badge = (f) => h('span', { class: 'vl-badge ' + COR[f] }, ICONE[f] + ' ' + CURTO[f]);
  const podeCampanha = () => (TS.paginas ? TS.paginas().includes('campanhas') : false);

  /** abre Clientes → Campanhas com a campanha pronta para quem já comprou o chá */
  function campanhaDoCha(l) {
    const nome = l.desc.replace(/\s+/g, ' ').trim();
    const titulo = nome.charAt(0) + nome.slice(1).toLowerCase();
    TS.campanhaPronta = {
      pronta: true, nome: `Validade: ${titulo}`.slice(0, 60), recorrente: '', janela: 15,
      mensagem: `Oi, {nome}! Você que gosta de ${titulo}: estamos com ele fresquinho em condição especial esta semana na {loja} 🍵 Quer que a gente separe um pacote para você?`,
      filtros: { produtos: ['~' + nome] },
    };
    location.hash = '#campanhas';
  }
  /** entradas recentes do chá (+ "saldo sem nota" quando houver), com o saldo que o painel calcula hoje */
  function lotesDoCha(d, cod) {
    const atuais = new Map(d.lotes.filter((l) => l.cod === cod).map((l) => [l.chave, l]));
    const out = ((d.entradas || {})[cod] || []).map((e) => ({ ...e, saldo: atuais.has(e.chave) ? atuais.get(e.chave).saldo : 0 }));
    for (const l of atuais.values()) if (!out.some((e) => e.chave === l.chave)) out.push({ chave: l.chave, nf: l.nf, entrada: l.entrada, lote: l.lote, validade: l.validade, saldo: l.saldo });
    return out;
  }
  const rotLote = (e) => (e.entrada ? `Entrada ${fmt.date(e.entrada)} · NF ${e.nf}` : 'Saldo sem nota') + ` · lote ${e.lote && e.lote !== '0' ? e.lote : '0'}` + (e.validade ? ` · vence ${fmt.date(e.validade)}` : '');
  /** campos em gramas, um por lote; onChange(mapa chave → kg, soma em kg) */
  function camposLotes(lotes, valores, onChange, desabilitado) {
    const vals = new Map(lotes.map((e) => [e.chave, valores[e.chave] ?? 0]));
    const avisar = () => onChange(Object.fromEntries([...vals].filter(([, v]) => v > 0)), Math.round([...vals.values()].reduce((a, b) => a + b, 0) * 1000) / 1000);
    return h('div', { class: 'vl-lotes-campos' }, ...lotes.map((e) => {
      const i = h('input', { class: 'f-input vl-g', type: 'text', inputmode: 'numeric', value: vals.get(e.chave) ? String(Math.round(vals.get(e.chave) * 1000)) : '', placeholder: '0', disabled: desabilitado || null, 'aria-label': `Gramas: ${rotLote(e)}` });
      i.addEventListener('input', () => { const g = Number(i.value.replace(/\D/g, '')) || 0; vals.set(e.chave, g / 1000); avisar(); });
      return h('label', { class: 'vl-lote-linha' }, h('span', null, rotLote(e)), h('span', { class: 'vl-g-box' }, i, h('small', null, 'g')));
    }));
  }

  /** "Ajustar os lotes deste chá": quanto tem de cada lote (a soma tem de ser o estoque do AppNext) */
  function ajustarCha(l, d, loja, depois) {
    const lotes = lotesDoCha(d, l.cod);
    const S = Math.round(d.lotes.filter((x) => x.cod === l.cod).reduce((a, x) => a + x.saldo, 0) * 1000) / 1000;
    let mapa = Object.fromEntries(lotes.filter((e) => e.saldo > 0).map((e) => [e.chave, e.saldo])), soma = S;
    const ok = h('button', { type: 'button', class: 'btn primary' }, 'Salvar');
    const info = h('div', { class: 'vl-soma' });
    const erro = h('div', { class: 'muted vl-erro' });
    const pintarSoma = () => {
      const igual = Math.abs(soma - S) < 0.0015;
      info.replaceChildren(h('b', null, `Soma: ${kgTxt(soma)}`), ` · estoque no AppNext: ${kgTxt(S)}`, igual ? h('span', { class: 'vl-okk' }, ' ✓') : h('span', { class: 'vl-dif' }, ` · ${soma > S ? 'sobram' : 'faltam'} ${kgTxt(Math.abs(soma - S))}`));
      ok.disabled = !igual;
    };
    const fundo = h('div', { class: 'cp-modal-bg' });
    const fechar = () => fundo.remove();
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    const enviar = async (corpoReq) => {
      ok.disabled = true; erro.textContent = '';
      if (TS.demo) { fechar(); toast('Na apresentação nada é salvo.'); return; }
      try { await req('PUT', 'validade/saldo', { loja, ...corpoReq }); cache.delete(loja); fechar(); toast('Lotes ajustados.'); depois(); } catch (e) { erro.textContent = e.message; ok.disabled = false; }
    };
    ok.addEventListener('click', () => enviar({ cod: l.cod, lotes: mapa }));
    const manual = d.lotes.some((x) => x.cod === l.cod && x.ajuste && x.ajuste.tipo === 'manual');
    fundo.append(h('div', { class: 'card cp-copiar vl-modal' },
      h('h3', null, `Lotes de ${l.desc}`),
      h('p', { class: 'muted' }, 'Pese quanto tem de cada lote (em gramas). Use quando a loja abriu um pacote novo antes do antigo.'),
      h('p', { class: 'vl-aviso' }, h('b', null, 'Não é inventário: '), 'não muda nada no AppNext, só diz ao painel de que lote é cada parte do estoque. A soma tem de dar o estoque que já está no AppNext. Se não der, o total está errado: corrija pelo Inventário (dá para contar por lote lá).'),
      camposLotes(lotes, mapa, (m, sm) => { mapa = m; soma = sm; pintarSoma(); }), info, erro,
      h('div', { class: 'cp-acoes' },
        manual ? h('button', { type: 'button', class: 'link-btn', title: 'Esquece o ajuste e volta a calcular: o estoque fica nas entradas mais novas', onclick: () => enviar({ chave: l.chave, automatico: true }) }, 'voltar ao automático') : null,
        h('span', { style: { flex: 1 } }), h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Cancelar'), ok)));
    pintarSoma();
    document.body.append(fundo);
    const primeiro = fundo.querySelector('input'); if (primeiro) primeiro.focus();
  }

  /** chás a granel de uma nota de entrada com o nº do lote e a validade (vale antes do estoque ser atualizado) */
  /** campos de lote e validade de um chá a granel da nota (salvam sozinhos ao sair do campo) */
  function camposItem(loja, it, aoSalvar) {
    {
      const lote = h('input', { class: 'f-input vl-lote' + (it.lote === '0' ? ' vl-vazio' : ''), value: it.lote === '0' ? '' : it.lote, placeholder: 'nº do lote', maxlength: 30, autocomplete: 'off', autocapitalize: 'characters', 'aria-label': `Lote de ${it.desc}` });
      const val = h('input', { class: 'f-input vl-val', type: 'date', value: it.validade || '', min: it.entrada, 'aria-label': `Validade de ${it.desc}` });
      const enviar = (corpoReq, el) => {
        if (TS.demo) { el.classList.add('vl-salvo'); setTimeout(() => el.classList.remove('vl-salvo'), 1200); return; }
        el.classList.add('vl-salvando');
        req('PUT', 'validade/lote', { loja, chave: it.chave, ...corpoReq }).then((j) => {
          cache.delete(loja);
          const e = j.editado || {};
          it.lote = e.lote || '0'; it.validade = e.validade || it.validadePadrao;
          el.classList.remove('vl-salvando'); el.classList.add('vl-salvo'); setTimeout(() => el.classList.remove('vl-salvo'), 1200);
          if ('validade' in corpoReq) val.value = it.validade;
          if (aoSalvar) aoSalvar(it);
        }).catch((e) => { el.classList.remove('vl-salvando'); toast(e.message, true); });
      };
      lote.addEventListener('change', () => { lote.value = lote.value.trim().toUpperCase(); lote.classList.toggle('vl-vazio', !lote.value); enviar({ lote: lote.value }, lote); });
      lote.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lote.blur(); } });
      TS.aoConfirmar(val, () => { if (val.value !== (it.validade || '')) enviar({ validade: val.value }, val); }); // só ao sair do campo: digitar o dia já disparava "change" e a tela redesenhava
      return { lote, val };
    }
  }
  function linhasNota(loja, nt, aoSalvar) {
    return h('div', { class: 'vl-nota-itens' }, ...nt.itens.map((it) => {
      const { lote, val } = camposItem(loja, it, aoSalvar);
      return h('div', { class: 'vl-nota-item' },
        h('div', { class: 'vl-nota-cha' }, h('b', null, it.desc), h('small', { class: 'muted vl-sub' }, `cód. ${it.cod} · ${kgTxt(it.qtd)}`)),
        h('label', { class: 'vl-campo' }, h('small', null, 'Lote'), lote),
        h('label', { class: 'vl-campo' }, h('small', null, 'Validade'), val));
    }));
  }
  /** chás a granel da nota com lote e validade, para pôr dentro da tabela de produtos: Promise<{ itens, porCod, campos(cod) }> */
  function lotesDaNota(loja, n, aoSalvar) {
    if (!loja || loja === 'todas') return Promise.resolve(null);
    return req('GET', `validade/notas?loja=${encodeURIComponent(loja)}&nota=${encodeURIComponent(n.id)}`).then((j) => {
      const nt = (j.notas || [])[0];
      if (!nt || !nt.itens.length) return null;
      const porCod = new Map();
      for (const it of nt.itens) (porCod.get(String(it.cod)) || porCod.set(String(it.cod), []).get(String(it.cod))).push(it);
      // os campos de cada chá: criados uma vez (a tabela redesenha ao ordenar/buscar e reaproveita os mesmos)
      const prontos = new Map();
      const campos = (cod) => {
        const its = porCod.get(String(cod));
        if (!its) return null;
        if (!prontos.has(String(cod))) prontos.set(String(cod), h('div', { class: 'vl-nota-campos' }, ...its.map((it) => {
          const { lote, val } = camposItem(loja, it, aoSalvar);
          return h('div', { class: 'vl-nota-par' }, h('label', { class: 'vl-campo' }, h('small', null, 'Lote'), lote), h('label', { class: 'vl-campo' }, h('small', null, 'Validade'), val));
        })));
        return prontos.get(String(cod));
      };
      return { itens: nt.itens, porCod, campos };
    }).catch(() => null);
  }
  /** Estoque → Notas fiscais → nota de entrada: bloco "Lotes do chá a granel" (some se a nota não tem chá a granel) */
  function blocoNota(loja, n, aoSalvar) {
    const box = h('div');
    if (!loja || loja === 'todas') return box;
    req('GET', `validade/notas?loja=${encodeURIComponent(loja)}&nota=${encodeURIComponent(n.id)}`).then((j) => {
      const nt = (j.notas || [])[0];
      if (!nt || !nt.itens.length || !box.isConnected) return;
      const falta = h('span', { class: 'vl-falta' });
      const contar = () => { const f = nt.itens.filter((x) => x.lote === '0').length; falta.textContent = f ? ` · ${f} sem lote` : ' · tudo preenchido ✓'; falta.className = f ? 'vl-falta' : 'vl-falta ok'; };
      contar();
      box.replaceChildren(h('div', { class: 'vl-nota' },
        h('div', { class: 'vl-nota-tit' }, h('b', null, '🍃 Lotes do chá a granel'), falta),
        h('small', { class: 'muted' }, 'Digite o nº do lote que está no pacote. A validade já vem com 12 meses da entrada; corrija se o pacote disser outra data.'),
        linhasNota(loja, nt, () => { contar(); if (aoSalvar) aoSalvar(); })));
    }).catch(() => null); // sem permissão: o bloco não aparece
    return box;
  }
  /** notas de entrada com lote pendente: { id da nota: quantos chás faltam } */
  const pendentes = (loja) => (req('GET', `validade/notas?loja=${encodeURIComponent(loja)}`).then((j) => j.pendentes || {}).catch(() => ({})));

  /**
   * Janela dos lotes de um chá (a mesma no Estoque e na Validade, ao clicar no nome do chá).
   * Em cima, o chá ABERTO: nota, chegada, abertura, vencimento depois de aberto e quantidade (datas editáveis).
   * Embaixo, os lotes FECHADOS, do mais antigo para o mais novo: nota, chegada, validade do pacote, quantidade e "Abrir lote"
   * (marca a abertura hoje; o vencimento passa a ser 6 meses depois).
   */
  function janelaPacotes(loja, cod, desc, aoMudar) {
    document.querySelectorAll('.vl-pac-bg').forEach((x) => x.remove());
    const fundo = h('div', { class: 'cp-modal-bg vl-pac-bg' });
    const caixa = h('div', { class: 'card vl-pac', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Lotes de ${desc}` }, h('p', { class: 'muted' }, 'Carregando…'));
    fundo.append(caixa); document.body.append(fundo);
    const fechar = () => fundo.remove();
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
    const enviar = (rota, corpo, el, msg) => {
      if (TS.demo) { toast(TS.DEMO_AVISO); return; }
      el.disabled = true;
      req('PUT', rota, { loja, ...corpo }).then(() => { cache.delete(loja); toast(msg); if (aoMudar) aoMudar(); carregar(); }).catch((e) => { el.disabled = false; toast(e.message, true); });
    };
    /** campo de data que só grava ao sair do campo */
    const data = (valor, attrs, aoMudarData) => {
      const i = h('input', { class: 'f-input vl-pac-data', type: 'date', value: valor || '', ...attrs });
      TS.aoConfirmar(i, () => { if (i.value && i.value !== (valor || '')) aoMudarData(i.value, i); });
      return i;
    };
    const campo = (rotulo, valor, dica, marca) => h('div', { class: 'vl-pac-campo' }, h('small', null, rotulo, dica ? TS.dica(dica) : null, marca || null), h('div', null, valor));
    const nfTxt = (l) => (l.entrada ? `NF ${l.nf}` : 'sem nota');
    function carregar() {
      dados(loja, true).then((d) => {
        if (!fundo.isConnected) return;
        const M = d.mesesAberto || 6, P = d.pacoteKg || 1;
        const ls = d.lotes.filter((l) => String(l.cod) === String(cod)).sort((a, b) => (String(a.entrada || '') < String(b.entrada || '') ? -1 : 1));
        // ---- aberto: uma linha por pacote na lata ----
        const abertos = ls.flatMap((l) => (l.abertos || []).map((a) => ({ l, a }))).sort((x, y) => (x.a.abertoEm < y.a.abertoEm ? -1 : 1));
        const linhaAberto = ({ l, a }) => h('div', { class: 'vl-pac-linha vl-pac-aberto' },
          campo('Nota de entrada', h('b', null, nfTxt(l)), l.lote && l.lote !== '0' ? `Lote ${l.lote}.` : 'Sem nº de lote digitado.'),
          campo('Chegou em', fmt.date(l.entrada)),
          campo('Aberto em', data(a.abertoEm, { min: l.entrada || null, max: d.hoje, 'aria-label': `Dia em que o chá da ${nfTxt(l)} foi aberto` }, (v, el) => enviar('validade/abertura', { chave: l.chave, n: a.n, dia: v }, el, 'Data de abertura salva.')),
            a.estimado ? 'O painel estimou esta data pelo ritmo do chá (ele não vê o pacote sendo aberto). Se a loja sabe o dia certo, troque.' : `Informado por ${a.por || 'alguém da equipe'}. Pode trocar.`,
            a.estimado ? h('span', { class: 'vl-pac-marca' }, 'estimado') : null),
          campo('Vence em', data(a.validade, { min: a.abertoEm, class: 'f-input vl-pac-data vl-ate', 'aria-label': `Vencimento do chá aberto da ${nfTxt(l)}` }, (v, el) => enviar('validade/abertura', { chave: l.chave, n: a.n, ate: v }, el, 'Vencimento salvo.')),
            `Depois de aberto, o chá vale ${M} meses. A data vem preenchida (abertura + ${M} meses) e pode ser trocada.`,
            a.editada ? h('button', { type: 'button', class: 'link-btn vl-pac-marca', title: `Volta para ${fmt.date(a.validadePadrao)} (${M} meses depois da abertura).`, onclick: (e) => enviar('validade/abertura', { chave: l.chave, n: a.n, ate: '' }, e.target, 'Vencimento voltou para a data calculada.') }, 'voltar à calculada') : null),
          campo('Quantidade', h('b', null, kgTxt(a.kg)), 'Quanto deste pacote ainda está na lata, pelo estoque do AppNext.'),
          !a.estimado ? h('div', { class: 'vl-pac-acao' }, h('button', { type: 'button', class: 'link-btn', title: 'Apaga a abertura informada. Se o estoque mostrar que o pacote está aberto, o painel volta a estimar a data; senão o pacote volta a contar como fechado.', onclick: (e) => enviar('validade/abertura', { chave: l.chave, n: a.n, dia: '' }, e.target, 'Abertura desfeita.') }, 'desfazer')) : null);
        // ---- fechado: uma linha por lote com pacote fechado, do mais antigo para o mais novo ----
        const fechados = ls.filter((l) => l.fechado > 0.0005 && l.entrada);
        const linhaFechado = (l, k) => {
          const n = Math.round(l.fechado / P);
          const abrir = h('button', { type: 'button', class: 'btn vl-pac-abrir' + (k === 0 ? ' primary' : ''), title: `Marca um pacote desta nota como aberto hoje (${fmt.date(d.hoje)}). O vencimento dele passa a ser ${M} meses depois. Dá para corrigir a data em seguida, na parte de cima.` }, 'Abrir lote');
          abrir.addEventListener('click', () => enviar('validade/abertura', { chave: l.chave, abrir: true }, abrir, 'Lote aberto hoje.'));
          return h('div', { class: 'vl-pac-linha vl-pac-fechado' },
            campo('Nota de entrada', h('b', null, nfTxt(l)), l.lote && l.lote !== '0' ? `Lote ${l.lote}.` : 'Sem nº de lote digitado.'),
            campo('Chegou em', fmt.date(l.entrada)),
            campo('Validade do pacote', data(l.validadePacote, { min: l.entrada || null, 'aria-label': `Validade do pacote da ${nfTxt(l)}` }, (v, el) => enviar('validade/lote', { chave: l.chave, validade: v }, el, 'Validade do pacote salva.')),
              'A data impressa no pacote, que vale enquanto ele está fechado. Vem preenchida com 12 meses depois da chegada: troque pela do pacote.'),
            campo('Quantidade', h('span', null, h('b', null, kgTxt(l.fechado)), n > 0 ? h('small', { class: 'muted' }, ` · ${fmt.int(n)} ${n === 1 ? 'pacote' : 'pacotes'}`) : null)),
            h('div', { class: 'vl-pac-acao' }, abrir, h('small', { class: 'muted' }, k === 0 ? 'o próximo a abrir' : `abrir em ${k + 1}º`)));
        };
        const semNota = ls.filter((l) => !l.entrada);
        caixa.replaceChildren(...[
          h('div', { class: 'vl-pac-topo' }, h('h3', null, `Lotes de ${desc}`), h('button', { type: 'button', class: 'link-btn', onclick: fechar }, 'Fechar ✕')),
          h('div', { class: 'vl-pac-sec' }, h('h4', null, '🫙 Chá aberto', TS.dica(`O chá que já saiu do pacote e está na lata. Vale ${M} meses a partir da abertura. O painel descobre pelo estoque qual está aberto; "Abrir lote", embaixo, marca um pacote como aberto hoje.`)),
            abertos.length ? abertos.map(linhaAberto) : h('p', { class: 'muted vl-pac-vazio' }, fechados.length ? 'Nenhum pacote aberto: pelo estoque, estão todos fechados. Abriu um? Use "Abrir lote" abaixo.' : 'Nenhum pacote aberto.')),
          h('div', { class: 'vl-pac-sec' }, h('h4', null, '📦 Lotes fechados', TS.dica('Pacotes ainda fechados, do mais antigo para o mais novo: abra sempre o primeiro da lista. Fechado, vale a validade do pacote.')),
            fechados.length ? fechados.map(linhaFechado) : h('p', { class: 'muted vl-pac-vazio' }, 'Nenhum pacote fechado deste chá.')),
          (() => {
            const hs = (d.historico || []).filter((x) => String(x.cod) === String(cod));
            if (!hs.length) return h('p', { class: 'muted vl-pac-hist-vazio' }, 'Histórico: ainda não há pacote deste chá que tenha acabado desde que o painel passou a registrar as aberturas.');
            return h('details', { class: 'vl-pac-hist' }, h('summary', null, `Histórico de aberturas (${fmt.int(hs.length)})`, TS.dica('Pacotes deste chá que já acabaram: de qual nota eram, quando chegaram, quando foram abertos (estimado pelo painel ou informado por alguém), até quando valiam e quando acabaram. Fica guardado por 3 anos. As alterações feitas à mão também aparecem em Configurações → Histórico de alterações.')),
              h('div', { class: 'vl-pac-hist-l' }, hs.map((x) => h('div', { class: 'vl-pac-linha vl-pac-hist-i' },
                campo('Nota de entrada', h('b', null, x.nf ? `NF ${x.nf}` : 'sem nota'), x.lote ? `Lote ${x.lote}.` : null),
                campo('Chegou em', fmt.date(x.entrada)),
                campo('Aberto em', h('span', null, fmt.date(x.abertoEm), h('small', { class: 'muted' }, x.estimado ? ' · estimado' : x.por ? ` · por ${x.por}` : ''))),
                campo('Valia até', h('span', { class: x.acabouEm > x.validade ? 'neg' : null, title: x.acabouEm > x.validade ? 'Acabou depois do vencimento.' : null }, fmt.date(x.validade))),
                campo('Acabou em', fmt.date(x.acabouEm))))));
          })(),
          semNota.length ? h('p', { class: 'muted vl-pac-semnota' }, `Saldo sem nota: ${kgTxt(semNota.reduce((x, l) => x + l.saldo, 0))}. O painel não sabe de qual pacote veio: acerte pelo inventário por lote.`) : null,
          !ls.length ? h('p', { class: 'muted' }, 'Este chá não tem saldo no estoque agora.') : null,
        ].filter(Boolean));
      }).catch((e) => caixa.replaceChildren(h('div', { class: 'notice err' }, e.message), h('button', { type: 'button', class: 'btn', onclick: fechar }, 'Fechar')));
    }
    carregar();
  }

  TS.validade = { dados, badge, campanhaDoCha, lotesDoCha, camposLotes, rotLote, blocoNota, lotesDaNota, pendentes, janelaPacotes };

  /**
   * Trava de estoque das mensagens: toda mensagem que oferece produto só sai se a loja tiver.
   * TS.estoqueDisp(loja) → { tem(nome) → true | false | null (produto que o painel não achou no estoque: não trava) }
   * O nome pode ser o do pacote ("Valeriana Garden 100G"): vale o chá a granel ("VALERIANA GARDEN").
   */
  const semTamanho = (t) => TS.norm(String(t || '')).replace(/\s*[-–]?\s*\d+\s*(g|gr|grs|gramas)\b.*$/, '').trim();
  const dispCache = new Map();
  TS.estoqueDisp = function (loja) {
    const c = dispCache.get(loja);
    if (c && Date.now() - c.em < 60000) return c.p;
    const p = req('GET', `estoque/disponivel?loja=${encodeURIComponent(loja)}`).then((j) => {
      const exato = new Map(), base = new Map();
      for (const [desc, un, tem] of j.itens || []) {
        const n = TS.norm(desc); exato.set(n, (exato.get(n) || false) || !!tem);
        if (String(un).toLowerCase() === 'kg') { const b = semTamanho(desc); base.set(b, (base.get(b) || false) || !!tem); }
      }
      const tem = (nome) => {
        if (!nome) return null;
        const n = TS.norm(nome);
        if (exato.has(n)) return exato.get(n);
        const b = semTamanho(nome);
        if (base.has(b)) return base.get(b);
        if (exato.has(b)) return exato.get(b);
        return null;
      };
      return { tem, em: j.em };
    });
    dispCache.set(loja, { em: Date.now(), p });
    p.catch(() => dispCache.delete(loja));
    return p;
  };
  /** produtos que a mensagem oferece para este cliente: {cha}, {ultimocha}, {produto} (os da campanha) e {chaoferta} */
  TS.produtosDaMensagem = (texto, c, extra = {}) => {
    const t = String(texto || ''), out = [];
    if (/\{cha\}/.test(t) && c.chaFavorito) out.push(c.chaFavorito);
    if (/\{ultimocha\}/.test(t) && c.chaUltimo) out.push(c.chaUltimo);
    if (/\{produto\}/.test(t)) out.push(...(extra.produtos || []));
    if (/\{chaoferta\}/.test(t) && extra.chaoferta) out.push(extra.chaoferta);
    return out;
  };
  /** o primeiro produto citado que está sem estoque (ou null) */
  TS.semEstoqueNaMensagem = (disp, texto, c, extra) => (disp ? TS.produtosDaMensagem(texto, c, extra).find((p) => disp.tem(p) === false) || null : null);

  TS.pages.validade = function (root) {
    if (TS.subEstoque) root.append(TS.subEstoque('validade'));
    root.append(h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Validade e lotes'),
      h('div', { class: 'page-sub' }, 'Chá a granel: cada entrada é um lote, com validade de 12 meses. Digite o nº do lote que está no pacote quando a mercadoria chegar.'))));
    if (!state.loja || state.loja === 'todas') { root.append(h('div', { class: 'notice' }, 'A validade é de cada loja: escolha uma loja no seletor do topo.')); return; }
    const corpo = h('div', null, h('div', { class: 'card' }, h('div', { class: 'loading' }, h('div', null, h('div', { class: 'spinner' }), h('p', null, 'Carregando os lotes…')))));
    root.append(corpo);
    const loja = state.loja;
    if (state.valFaixa) { F.faixa = state.valFaixa; state.valFaixa = null; } // veio de um aviso do Início já filtrado
    dados(loja, true).then((d) => { if (corpo.isConnected) pintar(corpo, loja, d); })
      .catch((e) => corpo.replaceChildren(h('div', { class: 'notice err' }, TS.demo ? 'A validade dos lotes não está na apresentação.' : e.message)));
  };

  const F = { faixa: 'risco', familia: '', q: '', semLote: false }; // filtros sobrevivem enquanto a tela está aberta
  function pintar(corpo, loja, d) {
    const r = d.resumo, pf = r.porFaixa;
    const repintar = () => dados(loja, true).then((nd) => { if (corpo.isConnected) pintar(corpo, loja, nd); }).catch(() => null);
    const ids = ['vencido', 'critica', 'acao', 'atencao', 'ok', ...(pf.sem.lotes ? ['sem'] : [])];
    const totKg = ids.reduce((a, id) => a + pf[id].kg, 0) || 1;
    const emRisco = d.lotes.filter((l) => l.dias != null && l.dias < 90).length;
    const filtroFaixa = (id) => { F.faixa = id; pintar(corpo, loja, d); };

    // ---- resumo: valor em risco + barra das faixas (as faixas são o filtro da lista) ----
    const barra = h('div', { class: 'vl-barra', role: 'img', 'aria-label': 'Estoque de chá a granel por faixa de validade' },
      ...ids.filter((id) => pf[id].kg > 0).map((id) => h('i', { class: COR[id], style: { width: (pf[id].kg / totKg * 100).toFixed(2) + '%' }, title: `${NOME[id]}: ${kgTxt(pf[id].kg)}` })));
    const chip = (id, rot, n, kg) => h('button', { type: 'button', class: 'vl-chip ' + (COR[id] || '') + (F.faixa === id ? ' on' : ''), 'aria-pressed': String(F.faixa === id), onclick: () => filtroFaixa(id) },
      h('span', null, rot), h('b', null, fmt.int(n)), kg != null ? h('small', null, kgTxt(kg)) : null);
    const resumo = h('div', { class: 'card vl-resumo' },
      h('div', { class: 'vl-risco' },
        h('small', null, `Valor em risco · vence em menos de ${d.riscoDias} dias`, TS.dica('A preço de venda (pacote de 100 g): o que deixa de entrar se o chá vencer. Inclui os vencidos.' + (d.custos ? ' A custo: o que a loja perde.' : ''))),
        h('b', null, fmt.brl0(r.risco.venda)),
        h('small', { class: 'muted' }, `${kgTxt(r.risco.kg)} em ${fmt.int(r.risco.lotes)} lote${r.risco.lotes === 1 ? '' : 's'}${d.custos && r.risco.custo != null ? ` · a custo ${fmt.brl0(r.risco.custo)}` : ''}`)),
      h('div', { class: 'vl-faixas' }, barra,
        h('div', { class: 'vl-chips' },
          chip('risco', 'Vence em até 90 dias', emRisco),
          ...ids.map((id) => chip(id, CURTO[id] === 'Vencido' ? '⚫ Vencido' : ICONE[id] + ' ' + CURTO[id], pf[id].lotes, pf[id].kg)),
          chip('todos', 'Todos', d.lotes.length))));
    const alerta = pf.vencido.lotes ? h('div', { class: 'notice vl-alerta' }, h('b', null, `⚫ ${fmt.int(pf.vencido.lotes)} lote${pf.vencido.lotes === 1 ? '' : 's'} vencido${pf.vencido.lotes === 1 ? '' : 's'} (${kgTxt(pf.vencido.kg)}): `),
      'retire da venda e lance a perda no AppNext. ', F.faixa !== 'vencido' ? h('button', { type: 'button', class: 'link-btn', onclick: () => filtroFaixa('vencido') }, 'ver quais') : null) : null;

    // ---- filtros da lista ----
    const fams = [...new Set(d.lotes.map((l) => l.familia).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const selFam = fams.length ? h('select', { class: 'f-input', 'aria-label': 'Tipo de chá' }, h('option', { value: '' }, 'Todos os tipos de chá'), ...fams.map((f) => h('option', { value: f, selected: F.familia === f || null }, f))) : null;
    if (selFam) selFam.addEventListener('change', () => { F.familia = selFam.value; desenharTabela(); });
    const semLote = h('label', { class: 'vl-check' }, h('input', { type: 'checkbox', checked: F.semLote || null, onchange: (e) => { F.semLote = e.target.checked; desenharTabela(); } }), ` só sem nº de lote (${fmt.int(r.semLote)})`);
    const ferr = h('div', { class: 'vl-filtros' });
    const tabela = h('div');
    function linhas() {
      return d.lotes.filter((l) => (F.faixa === 'todos' ? true : F.faixa === 'risco' ? l.dias != null && l.dias < 90 : l.faixa === F.faixa)
        && (!F.familia || l.familia === F.familia) && (!F.semLote || l.lote === '0'));
    }
    function salvar(l, corpoReq, el) {
      if (TS.demo) { // apresentação: muda só na tela
        if ('lote' in corpoReq) l.lote = corpoReq.lote || '0';
        el.classList.add('vl-salvo'); setTimeout(() => el.classList.remove('vl-salvo'), 1200);
        return;
      }
      el.classList.add('vl-salvando');
      req('PUT', 'validade/lote', { loja, chave: l.chave, ...corpoReq }).then((j) => {
        cache.delete(loja);
        if (j.lote) Object.assign(l, j.lote);
        el.classList.remove('vl-salvando'); el.classList.add('vl-salvo'); setTimeout(() => el.classList.remove('vl-salvo'), 1200);
        if ('validade' in corpoReq) repintar();
      }).catch((e) => { el.classList.remove('vl-salvando'); toast(e.message, true); });
    }
    /** situação dos pacotes do lote: o que está na lata (com a data de abertura) e os fechados, com a ordem para abrir */
    function pacotes(l) {
      const P = d.pacoteKg || 1, out = [];
      if (l.pacoteN > 0 && l.abertoEm) {
        out.push(h('small', { class: 'vl-sub vl-lata' },
          h('span', { title: `Pelo estoque, ${kgTxt(l.aberto)} deste lote já estão na lata. Depois de aberto vale esta data (vem com ${d.mesesAberto || 6} meses da abertura e pode ser trocada).` },
            `🫙 na lata ${kgTxt(l.aberto)} · aberto em ${fmt.date(l.abertoEm)}${l.abertoEstimado ? ' (estimado)' : ''} · consumir até ${fmt.date(l.validadeAberto)}`),
          h('button', { type: 'button', class: 'link-btn vl-abriu', title: 'Abre os pacotes deste chá para corrigir o dia em que foi para a lata ou a data de vencimento depois de aberto.', onclick: () => janelaPacotes(loja, l.cod, l.desc, repintar) }, 'corrigir')));
      }
      if (l.fechado > 0.0005) {
        const n = Math.round(l.fechado / P);
        out.push(h('small', { class: 'vl-sub vl-fechado', title: `Pacotes ainda fechados deste lote. A ordem é a de chegada: abra sempre o mais antigo primeiro. Os fechados seguem só a validade do pacote.` },
          `📦 ${n > 0 ? `${fmt.int(n)} ${n === 1 ? 'pacote fechado' : 'pacotes fechados'}` : `${kgTxt(l.fechado)} fechado`} · ${l.abrirOrdem === 1 ? 'o próximo a abrir' : `abrir em ${l.abrirOrdem}º`}`));
      }
      if (l.entrada && !(l.pacoteN > 0)) out.push(h('button', { type: 'button', class: 'link-btn vl-ver-pac', title: 'Abre os pacotes deste chá, do mais antigo para o mais novo, para informar que um pacote foi aberto ou corrigir a data.', onclick: () => janelaPacotes(loja, l.cod, l.desc, repintar) }, 'pacotes deste chá'));
      return out.length ? h('div', { class: 'vl-pacotes' }, out) : null;
    }
    function desenharTabela() {
      const rows = linhas();
      const cols = [
        { key: 'dias', label: 'Vence', align: 'l', title: `Pacote fechado: a validade do pacote. Depois que vai para a lata: o "consumir até" (${d.mesesAberto || 6} meses da abertura, se ninguém trocar), que passa a valer no lugar da data da chegada. Lote com chá aberto mostra a validade do que está aberto.`,
          render: (l) => h('div', null, badge(l.faixa), h('small', { class: 'vl-dias' }, diasTxt(l.dias)),
            l.motivo === 'aberto' ? h('small', { class: 'vl-sub vl-motivo', title: `O chá foi para a lata em ${fmt.date(l.abertoEm)}: depois de aberto vale o "consumir até" (${fmt.date(l.validadeAberto)}), no lugar da validade da chegada (${fmt.date(l.validadePacote)}).` }, '🫙 depois de aberto') : null) },
        { key: 'desc', label: 'Chá', align: 'l', title: 'Clique no nome do chá para ver os lotes dele: nota de entrada, chegada, se está aberto ou fechado, abertura e vencimento, e para informar que abriu um pacote.',
          render: (l) => h('div', null, l.entrada || l.pacoteN > 0
            ? h('button', { type: 'button', class: 'vl-nome', title: 'Ver os lotes deste chá: nota, chegada, aberto ou fechado, abertura e vencimento.', onclick: () => janelaPacotes(loja, l.cod, l.desc, repintar) }, l.desc)
            : h('b', null, l.desc),
          h('small', { class: 'muted vl-sub' }, [l.tipo || (TS.grupoProd ? TS.grupoProd.texto(l.cod, l.desc, true) : '') || l.familia, l.entrada ? `entrada ${fmt.date(l.entrada)} · NF ${l.nf}` : 'saldo sem nota'].filter(Boolean).join(' · ')),
          pacotes(l)) },
        { key: 'saldo', label: 'Saldo', render: (l) => h('div', { class: 'vl-saldo' },
          h('span', { title: l.qtdEntrada ? `chegaram ${kgTxt(l.qtdEntrada)}` : null }, kgTxt(l.saldo)),
          l.ajuste ? h('small', { class: 'vl-sub vl-aj', title: `${l.ajuste.tipo === 'inventario' ? 'Contado por lote no inventário' : 'Ajustado na tela'}${l.ajuste.por ? ' por ' + l.ajuste.por : ''} em ${new Date(l.ajuste.em).toLocaleDateString('pt-BR')}; as vendas depois disso saem do lote mais antigo` }, l.ajuste.tipo === 'inventario' ? 'contado no inventário' : 'ajustado') : null,
          h('button', { type: 'button', class: 'link-btn vl-ajustar', title: 'Divide o estoque deste chá entre os lotes (ex.: abriram o pacote novo antes do antigo). Não é inventário: não muda nada no AppNext e a soma tem de ser o estoque que já está lá. Se o total estiver errado, corrija pelo Inventário.', onclick: () => ajustarCha(l, d, loja, repintar) }, '⚖ ajustar')) },
        { key: 'lote', label: 'Lote', align: 'l', render: (l) => {
          const i = h('input', { class: 'f-input vl-lote' + (l.lote === '0' ? ' vl-vazio' : ''), value: l.lote === '0' ? '' : l.lote, placeholder: 'nº do lote', maxlength: 30, 'aria-label': `Lote de ${l.desc}`, autocomplete: 'off', autocapitalize: 'characters' });
          i.addEventListener('change', () => { i.value = i.value.trim().toUpperCase(); i.classList.toggle('vl-vazio', !i.value); salvar(l, { lote: i.value }, i); });
          i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
          return i;
        } },
        { key: 'validade', label: 'Validade', align: 'l', title: 'A data que está valendo, já preenchida e editável. Pacote fechado: a validade do pacote (12 meses da chegada até alguém digitar a impressa). Chá aberto (🫙): a data final de consumo, que vem com 6 meses depois da abertura.', render: (l) => {
          // chá aberto: o campo é a data final de consumo (a que vale); a validade do pacote continua editável na janela do chá
          if (l.motivo === 'aberto' && l.validadeAberto) {
            const ia = h('input', { class: 'f-input vl-val vl-val-aberto', type: 'date', value: l.validadeAberto, min: l.abertoEm || null, 'aria-label': `Data final de consumo de ${l.desc}` });
            const mandar = (ate) => {
              if (TS.demo) { toast(TS.DEMO_AVISO); ia.value = l.validadeAberto; return; }
              ia.classList.add('vl-salvando');
              req('PUT', 'validade/abertura', { loja, chave: l.chave, ate }).then(() => { cache.delete(loja); repintar(); }).catch((e) => { ia.classList.remove('vl-salvando'); ia.value = l.validadeAberto; toast(e.message, true); });
            };
            TS.aoConfirmar(ia, () => { if (ia.value && ia.value !== l.validadeAberto) mandar(ia.value); }); // só ao sair do campo
            const voltaA = l.validadeAbertoEditada ? h('button', { type: 'button', class: 'link-btn vl-volta-consumo', title: `Volta para a data final de consumo calculada pelo painel: ${fmt.date(l.validadeAbertoPadrao)} (${d.mesesAberto || 6} meses depois da abertura).`, onclick: () => mandar('') }, 'voltar à data final de consumo') : null;
            return h('div', { class: 'vl-val-box' }, ia, voltaA,
              h('small', { class: 'muted vl-sub', title: `Depois de aberto vale a data final de consumo. A validade do pacote (${l.validadePacote ? fmt.date(l.validadePacote) : 'sem data'}) fica na janela do chá: clique no nome.` }, `🫙 data final de consumo${l.validadeAbertoEditada ? ' · corrigida' : ''}`));
          }
          const i = h('input', { class: 'f-input vl-val', type: 'date', value: l.validade || '', min: l.entrada || null, 'aria-label': `Validade de ${l.desc}` });
          TS.aoConfirmar(i, () => { if (i.value !== (l.validade || '')) salvar(l, { validade: i.value }, i); }); // só ao sair do campo (o Chrome dispara "change" a cada parte da data)
          const volta = !l.padrao && l.validadePadrao && l.validade !== l.validadePadrao ? h('button', { type: 'button', class: 'link-btn', title: `Voltar para 12 meses da entrada (${fmt.date(l.validadePadrao)})`, onclick: () => salvar(l, { validade: '' }, i) }, 'voltar a 12 meses') : null;
          return h('div', { class: 'vl-val-box' }, i, volta, !l.padrao && l.editadoPor ? h('small', { class: 'muted vl-sub' }, `corrigida por ${l.editadoPor}`) : null);
        } },
        { key: 'venda', label: d.custos ? 'Valor (venda · custo)' : 'Valor (venda)', render: (l) => h('div', { class: 'vl-valor' }, h('span', null, l.precoKg ? fmt.brl0(l.saldo * l.precoKg) : '—'),
          d.custos && l.custoKg ? h('small', { class: 'muted vl-sub' }, 'custo ' + fmt.brl0(l.saldo * l.custoKg)) : null) },
        ...(podeCampanha() ? [{ key: 'acao', label: '', align: 'l', render: (l) => (l.dias != null && l.dias < 60 && l.dias >= 0
          ? h('button', { type: 'button', class: 'btn vl-camp', title: `Campanha no WhatsApp para quem já comprou ${l.desc}`, onclick: () => campanhaDoCha(l) }, '📣 Campanha') : null) }] : []),
      ];
      const rowsT = rows.map((l) => ({ ...l, venda: l.saldo * (l.precoKg || 0), dias: l.dias == null ? 99999 : l.dias, _l: l }));
      const tab = rows.length ? TS.table({
        cols: cols.map((c) => ({ ...c, render: c.render ? (row) => c.render(row._l) : undefined })), rows: rowsT, sortKey: 'dias', sortDir: 'asc',
        search: 'Buscar chá, lote ou NF', searchKeys: ['desc', 'cod', 'lote', 'nf'], pageSize: 50, cls: 'vl-tabela',
      }) : null;
      ferr.replaceChildren(...[tab && tab.searchBox ? (tab.searchBox.classList.add('vl-busca'), tab.searchBox) : null, selFam, semLote].filter(Boolean));
      tabela.replaceChildren(tab || TS.empty(F.faixa === 'risco' ? 'Nenhum lote vence nos próximos 90 dias. 🎉' : 'Nenhum lote com esses filtros.'));
    }

    const quando = d.em ? new Date(d.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    const titulo = F.faixa === 'risco' ? 'Lotes que vencem em até 90 dias' : F.faixa === 'todos' ? 'Todos os lotes' : `Lotes: ${NOME[F.faixa]}`;
    corpo.replaceChildren(
      alerta, resumo,
      h('div', { class: 'card vl-lista-card' },
        h('div', { class: 'card-head' }, h('div', null, h('div', { class: 'card-title' }, titulo),
          h('div', { class: 'card-sub' }, `Saldo pelo estoque do AppNext de ${quando} · o mais antigo sai primeiro · só chá a granel tem validade`))),
        ferr, tabela),
      h('details', { class: 'card vl-ajuda' }, h('summary', null, 'Como funciona'), h('ul', null,
        h('li', null, 'Cada entrada de chá a granel é um lote. Digite o nº do lote que está no pacote na nota de entrada (Estoque → Notas fiscais) ou aqui. A validade já vem com 12 meses da entrada; se o pacote disser outra data, corrija.'),
        h('li', null, 'O saldo de cada lote sai do estoque do AppNext: o que sobrou fica nas entradas mais novas, porque o mais antigo é vendido primeiro. Por isso, venda sempre o lote mais antigo.'),
        h('li', null, 'Abriram o pacote novo antes do antigo? Em "⚖ ajustar", pese quanto tem de cada lote. O ajustar não é inventário: não muda o AppNext, só divide o estoque entre os lotes. Se o total estiver errado, use o Inventário (o chá a granel pode ser contado por lote).'),
        h('li', null, `Depois de aberto: o chá chega em pacotes de ${d.pacoteKg || 1} kg e, quando o pacote vai para a lata, tem ${d.mesesAberto || 6} meses para ser consumido. O painel vê pelo estoque qual pacote está aberto (🫙) e estima o dia em que foi aberto; depois de aberto, é o "consumir até" que vale para o chá da lata, no lugar da validade da chegada. Os pacotes fechados (📦) mostram a ordem para abrir: sempre o mais antigo. Todas as datas vêm preenchidas e podem ser trocadas em "corrigir" ou em "pacotes deste chá" (também no Estoque, em 🫙 pacotes).`),
        h('li', null, 'Saída ou entrada lançada no AppNext (perda, ajuste, inventário) muda o total: saída sai do lote mais antigo, como uma venda; entrada sem nota vira "saldo sem nota".'),
        h('li', null, '⚫ Vencido: tire da venda e lance a perda no AppNext. 🔴 e 🟠: degustação, oferta e campanha. 🟡: deixe na frente da prateleira.'),
        h('li', null, 'Os lotes em risco aparecem também em Vendas → Promoção, no Pedido (para não comprar mais do mesmo chá) e no resumo diário.'))));
    desenharTabela();
  }

  /**
   * Combos para queimar o chá perto da validade sem prejuízo: o acessório que mais sai junto com aquele chá
   * (nos cupons dos últimos 12 meses; se o chá tem poucas vendas, o do mesmo tipo de chá) e o desconto
   * que ainda deixa a margem líquida acima da mínima configurada no Estoque (só para quem vê custos).
   */
  const semTam = (s) => TS.norm(String(s || '')).replace(/\s*[-–]?\s*\d+\s*(g|gr|grs|gramas)\b.*$/, '').trim();
  function montarCombos(ls, M, cfg) {
    const db = TS.db;
    if (!db || !db.n || !ls.length) return [];
    const idx = TS.filtrar({ de: db.maxDay - 365, ate: db.maxDay, ignorar: ['vendedores', 'grupos', 'cats', 'produto'] });
    const ehAcess = (i) => /ACESS/i.test(db.D.grupoC[db.grupoC[i]] || '');
    const porCupom = new Map(); // cupom → linhas
    for (const i of idx) { const k = TS.chaveCupom(i); (porCupom.get(k) || porCupom.set(k, []).get(k)).push(i); }
    const baseDesc = new Map(); // índice da descrição → nome sem o tamanho
    const nomeBase = (i) => { const k = db.desc[i]; if (!baseDesc.has(k)) baseDesc.set(k, semTam(db.D.descricao[k])); return baseDesc.get(k); };
    const precoMedio = (linhas) => { let q = 0, v = 0, c = 0, qc = 0; for (const i of linhas) { const qq = db.qtd[i] || 0; q += qq; v += db.vt[i] || 0; const cc = M ? M.custo(i) : null; if (cc != null) { c += cc; qc += qq; } } return { preco: q ? v / q : null, custo: qc ? c / qc : null }; };
    const out = [];
    for (const l of ls.slice(0, 12)) {
      const alvo = TS.norm(l.desc);
      const doCha = idx.filter((i) => nomeBase(i) === alvo && !ehAcess(i));
      if (!doCha.length) continue;
      // o pacote mais vendido do chá (100 g, 50 g…)
      const porDesc = new Map(); for (const i of doCha) porDesc.set(db.desc[i], (porDesc.get(db.desc[i]) || 0) + (db.qtd[i] || 0));
      const pacote = [...porDesc].sort((a, b) => b[1] - a[1])[0][0];
      // acessório que sai junto: no cupom do chá; com poucas vendas, nos cupons do mesmo grupo (tipo de chá)
      const contar = (linhasBase) => {
        const cups = new Set(linhasBase.map((i) => TS.chaveCupom(i)));
        const cont = new Map();
        for (const k of cups) { const vistos = new Set(); for (const i of porCupom.get(k) || []) if (ehAcess(i) && !vistos.has(db.desc[i])) { vistos.add(db.desc[i]); cont.set(db.desc[i], (cont.get(db.desc[i]) || 0) + 1); } }
        return { cups: cups.size, top: [...cont].sort((a, b) => b[1] - a[1])[0] || null };
      };
      let base = contar(doCha), porTipo = false;
      if (!base.top || base.top[1] < 3) {
        const g = db.grupo[doCha[0]];
        const doGrupo = idx.filter((i) => db.grupo[i] === g && !ehAcess(i));
        const x = contar(doGrupo);
        if (x.top && (!base.top || x.top[1] > base.top[1])) { base = x; porTipo = db.D.grupo[g] || true; }
      }
      if (!base.top) continue;
      const accDesc = base.top[0];
      const pCha = precoMedio(doCha.filter((i) => db.desc[i] === pacote).slice(-200));
      const pAcc = precoMedio(idx.filter((i) => db.desc[i] === accDesc).slice(-200));
      const combo = { l, cha: db.D.descricao[pacote], acc: db.D.descricao[accDesc], juntos: base.top[1], porTipo, preco: (pCha.preco || 0) + (pAcc.preco || 0), desconto: null, margem: null };
      if (M && cfg && pCha.custo != null && pAcc.custo != null && combo.preco > 0) {
        const custo = pCha.custo + pAcc.custo, taxas = ((cfg.simplesPct || 0) + (cfg.cartaoPct || 0)) / 100, mMin = (cfg.margemMin ?? 15) / 100;
        combo.margem = 1 - custo / combo.preco - taxas;
        const dMax = 1 - custo / (combo.preco * (1 - mMin - taxas));
        combo.desconto = dMax >= 0.05 ? Math.min(25, Math.floor(dMax * 100 / 5) * 5) : 0;
        combo.mMin = mMin;
      }
      out.push(combo);
    }
    return out;
  }

  /** Vendas → Promoção: "Para a próxima promoção" — o que vender primeiro e os combos sugeridos */
  TS.validade.secaoPromocao = function (loja) {
    const box = h('div');
    if (!loja || loja === 'todas') return box;
    dados(loja).then(async (d) => {
      const ls = d.lotes.filter((l) => l.dias != null && l.dias >= 0 && l.dias < 60).sort((a, b) => a.dias - b.dias);
      const venc = d.lotes.filter((l) => l.faixa === 'vencido');
      if ((!ls.length && !venc.length) || !box.isConnected) return;
      let M = null, cfg = null;
      try { M = await TS.custosLoja(); if (M) cfg = (await TS.estoqueBuscar(loja)).cfg; } catch { /* sem custos: combos sem desconto */ }
      const combos = montarCombos(ls, M, cfg);
      const temVal = TS.paginas && TS.paginas().includes('validade');
      const vender = TS.card('🍃 Vender primeiro', ls.length ? `${fmt.int(ls.length)} lote${ls.length === 1 ? '' : 's'} vencem em menos de 60 dias · ${fmt.brl0(ls.reduce((a, l) => a + l.saldo * (l.precoKg || 0), 0))} a preço de venda` : 'Nenhum lote vence nos próximos 60 dias.',
        ls.length ? h('div', { class: 'vl-pp-lista' }, ...ls.slice(0, 8).map((l) => h('div', { class: 'vl-pp-it' }, badge(l.faixa),
          h('div', null, h('b', null, l.desc), h('small', { class: 'muted vl-sub' }, `${kgTxt(l.saldo)} · ${diasTxt(l.dias)}${l.lote !== '0' ? ` · lote ${l.lote}` : ''}`))))) : null,
        ls.length > 8 ? h('small', { class: 'muted' }, `e mais ${ls.length - 8}`) : null,
        venc.length ? h('div', { class: 'vl-pp-venc' }, `⚫ ${fmt.int(venc.length)} lote${venc.length === 1 ? '' : 's'} vencido${venc.length === 1 ? '' : 's'} (${kgTxt(venc.reduce((a, l) => a + l.saldo, 0))}) não entram aqui: retire da venda.`) : null,
        temVal ? h('a', { href: '#validade', class: 'link-btn vl-pp-link' }, 'Ver os lotes na Validade →') : null);
      const comb = TS.card('🎁 Combos sugeridos', M ? `Chá perto da validade + o acessório que mais sai junto · desconto que mantém a margem líquida acima de ${fmt.int((cfg && cfg.margemMin) ?? 15)}%` : 'Chá perto da validade + o acessório que mais sai junto (nos cupons dos últimos 12 meses)',
        combos.length ? h('div', { class: 'vl-pp-lista' }, ...combos.slice(0, 6).map((c) => h('div', { class: 'vl-combo' },
          h('div', null, h('b', null, c.cha), h('span', { class: 'vl-mais' }, ' + '), h('b', null, c.acc),
            h('small', { class: 'muted vl-sub' }, `${c.porTipo ? `sai junto com ${typeof c.porTipo === 'string' ? c.porTipo.toLowerCase() : 'esse tipo de chá'}` : 'sai junto com este chá'} em ${fmt.int(c.juntos)} cupons · ${diasTxt(c.l.dias)}`)),
          h('div', { class: 'vl-combo-preco' }, c.preco > 0 ? h('span', null, fmt.brl(c.preco)) : null,
            c.desconto == null ? null : c.desconto > 0 ? h('span', { class: 'vl-desc', title: `Com ${c.desconto}% de desconto a margem líquida fica acima de ${fmt.int(c.mMin * 100)}% (hoje: ${fmt.pct(c.margem, 0)})` }, `até ${c.desconto}% off`) : h('span', { class: 'vl-desc sem', title: `Margem líquida hoje: ${fmt.pct(c.margem, 0)} — sem espaço para desconto sem ficar abaixo da mínima` }, 'sem margem: use degustação'))))) : h('p', { class: 'muted' }, 'Ainda não há vendas suficientes desses chás com acessórios para sugerir combos.'),
        M ? null : h('small', { class: 'muted' }, 'O desconto sugerido aparece para quem vê os custos.'));
      box.replaceChildren(h('div', { class: 'section-label' }, 'Para a próxima promoção · pela validade dos lotes'), h('div', { class: 'grid g-2 vl-pp' }, vender, comb));
    }).catch(() => null); // sem permissão ou sem estoque: a seção não aparece
    return box;
  };
  TS.validade.cartaoVenderPrimeiro = TS.validade.secaoPromocao;

  /** Estoque → Pedido: por código, o lote mais urgente (< 90 dias) de cada chá */
  TS.validade.riscoPorCod = async function (loja) {
    const out = new Map();
    try {
      const d = await dados(loja);
      for (const l of d.lotes) if (l.dias != null && l.dias < 90 && (!out.has(l.cod) || l.dias < out.get(l.cod).dias)) out.set(l.cod, { dias: l.dias, faixa: l.faixa, kg: d.lotes.filter((x) => x.cod === l.cod && x.dias != null && x.dias < 90).reduce((s, x) => s + x.saldo, 0) });
    } catch { /* sem permissão: sem aviso */ }
    return out;
  };
})();
