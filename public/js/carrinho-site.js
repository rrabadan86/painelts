/* Favorito "Carrinho Tea Shop": roda DENTRO do Sistema de Pedidos (grnteashop.nextsoft.com.br), na sessão de quem
 * está logado, e coloca no carrinho a lista que o painel gerou (Estoque → Pedido → "Montar carrinho no site").
 * - A lista vem do painel por um código de uso único (#teashop=… no endereço, 30 min).
 * - Trabalha num quadro escondido (mesmo site), produto por produto: busca pelo nome, confere o nome exato,
 *   ajusta ao múltiplo, coloca no carrinho e confere o topo ("N Itens - R$ …").
 * - NUNCA passa da etapa 2: não escolhe pagamento nem finaliza o pedido.
 * - Mostra o andamento aqui e devolve para o painel. Produto com problema tem "Tentar de novo". */
(function () {
  if (window.__teashopCarrinho) { window.__teashopCarrinho.mostrar(); return; }
  const SCRIPT = document.currentScript && document.currentScript.src;
  const PAINEL = SCRIPT ? new URL(SCRIPT).origin : '';
  const P = 'ctl00_ContentPlaceHolder1_', L = P + 'ucListagem1_';
  const BASE = location.pathname.replace(/[^/]*$/, ''); // /Pedidos/
  const esq = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const num = (s) => { const m = /-?[\d.]*\d(?:,\d+)?/.exec(String(s || '')); return m ? +m[0].replace(/\./g, '').replace(',', '.') : null; };
  const br = (v, d = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- código ----------
  const m = /teashop=([a-f0-9]{20,})/.exec(location.hash);
  let codigo = m ? m[1] : sessionStorage.getItem('teashopCodigo');
  if (m) { sessionStorage.setItem('teashopCodigo', codigo); history.replaceState(null, '', location.pathname + location.search); }

  // ---------- quadro na tela ----------
  const css = `#tsc{position:fixed;right:12px;bottom:12px;width:420px;max-width:calc(100vw - 24px);max-height:80vh;z-index:2147483000;background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);font:14px/1.4 Arial,sans-serif;color:#1F2A22;display:flex;flex-direction:column;overflow:hidden}
#tsc header{background:#2C5234;color:#fff;padding:12px 14px;display:flex;align-items:center;gap:8px}#tsc header b{flex:1;font-size:15px}
#tsc header button{background:transparent;border:0;color:#fff;font-size:18px;cursor:pointer}
#tsc .c{padding:12px 14px;overflow:auto}#tsc .bar{height:8px;background:#ECE6D8;border-radius:4px;margin:8px 0;overflow:hidden}#tsc .bar i{display:block;height:100%;background:#2C5234;transition:width .3s}
#tsc ul{list-style:none;margin:8px 0 0;padding:0}#tsc li{display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #F0EBDF;font-size:13px}#tsc li span{flex:1}
#tsc .st{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}.tsc-ok{background:#E3EFE3;color:#22603A}.tsc-er{background:#F8E1DB;color:#9A3420}.tsc-av{background:#F6EBC4;color:#7A5E0E}.tsc-pe{background:#EEE;color:#666}
#tsc button.tb{border:1px solid #2C5234;background:#fff;color:#2C5234;border-radius:8px;padding:3px 8px;font-size:12px;cursor:pointer}#tsc button.pr{background:#2C5234;color:#fff;border:0;border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer;margin-top:10px}
#tsc .tsc-av-t{color:#9A3420}#tsc .msg{padding:10px;border-radius:8px;margin-top:8px}#tsc .ok{background:#E3EFE3;color:#22603A}#tsc .er{background:#F8E1DB;color:#7A2B18}`;
  const st = document.createElement('style'); st.textContent = css; document.head.append(st);
  const box = document.createElement('div'); box.id = 'tsc';
  box.innerHTML = '<header><b>🛒 Carrinho Tea Shop</b><button type="button" title="Fechar">✕</button></header><div class="c"><div class="topo">Preparando…</div><div class="bar"><i style="width:0"></i></div><div class="msgs"></div><ul></ul></div>';
  document.body.append(box);
  const el = { topo: box.querySelector('.topo'), bar: box.querySelector('.bar i'), msgs: box.querySelector('.msgs'), lista: box.querySelector('ul') };
  let rodando = false, fr = null;
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  box.querySelector('header button').onclick = () => { if (rodando && !confirm('Parar de colocar produtos no carrinho?')) return; parar = true; if (fr) fr.remove(); box.remove(); delete window.__teashopCarrinho; };
  let parar = false;
  const msg = (t, cls) => { el.msgs.innerHTML = ''; if (t) { const d = document.createElement('div'); d.className = 'msg ' + (cls || ''); d.innerHTML = t; el.msgs.append(d); } };
  window.__teashopCarrinho = { mostrar: () => box.scrollIntoView() };

  if (!PAINEL || !codigo) { msg('Abra o site pelo painel: <b>Estoque → Pedido → Montar carrinho no site</b>. Depois clique neste favorito.', 'er'); el.topo.textContent = ''; return; }
  if (document.getElementById('UserName')) { msg('Entre no site com o login da loja e clique no favorito de novo.', 'er'); el.topo.textContent = ''; return; }

  // ---------- quadro escondido onde o trabalho acontece (a página da pessoa não recarrega) ----------
  fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;left:-3000px;top:0;width:1300px;height:900px;border:0;visibility:hidden';
  document.body.append(fr);
  let carregou = null;
  fr.addEventListener('load', () => { if (carregou) { const f = carregou; carregou = null; f(); } });
  const abrir = (url) => new Promise((ok, falha) => { const t = setTimeout(() => { carregou = null; falha(new Error('o site demorou para responder')); }, 45000); carregou = () => { clearTimeout(t); ok(); }; fr.src = url; });
  /** faz uma ação que recarrega o quadro e espera terminar */
  const agir = (fn) => new Promise((ok, falha) => { const t = setTimeout(() => { carregou = null; falha(new Error('o site demorou para responder')); }, 45000); carregou = () => { clearTimeout(t); ok(); }; try { fn(); } catch (e) { clearTimeout(t); carregou = null; falha(e); } });
  const doc = () => fr.contentDocument;
  const topoCarrinho = (d) => { const t = [...d.querySelectorAll('a,span')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t.length < 60 && /Ite(m|ns)\s*-\s*R\$/i.test(t)); return t.sort((a, b) => a.length - b.length)[0] || ''; };
  function cartoes(d) {
    return [...d.querySelectorAll('input[id*="txtQtde_"]')].map((q) => {
      let c = q;
      for (let i = 0; i < 8 && c.parentElement; i++) { c = c.parentElement; if (/Pedido M[ií]nimo/i.test(c.innerText) && c.querySelectorAll('input[id*="txtQtde_"]').length === 1) break; }
      const t = c.innerText.replace(/\r/g, ''), linhas = t.split('\n').map((s) => s.trim()).filter(Boolean);
      const iMin = linhas.findIndex((s) => /Pedido M[ií]nimo/i.test(s));
      const g = (re) => { const x = re.exec(t); return x ? x[1].trim() : null; };
      const min = g(/Pedido M[ií]nimo:\s*([^\n]+)/i);
      return { q, nome: (iMin > 0 ? linhas.slice(0, iMin).filter((s) => !/^NOVIDADE$/i.test(s)).pop() : linhas[0]) || '', preco: num(g(/R\$\s*([\d.,]+)/)), min: min && !/livre/i.test(min) ? num(min) : null, max: num(g(/Pedido M[áa]ximo:\s*([^\n]+)/i)), mult: num(g(/M[úu]ltiplo de\s*([\d.,]+)/i)) || 1 };
    });
  }
  /**
   * "Venda Conjunta": o site só vende o produto junto com outro (ex.: a mug com o infusor dela) e pede para confirmar.
   * Decisão do dono: aceitar em "Colocar Todos no Carrinho". → { botao, itens: [{ cod, nome, qtd, preco }] } ou null
   */
  const RE_TODOS = /^colocar\s+todos\s+no\s+carrinho$/i;
  /**
   * Aviso do site depois do clique (ex.: janela "Atenção" com "O produto X não possui estoque suficiente." e "Fechar").
   * Na loja real (22/11/2026) o aviso não era o .modal de sempre e às vezes chegava atrasado: procura qualquer janela visível
   * (.modal, role=dialog/alertdialog, .bootbox, .swal2-popup, .ui-dialog) e também qualquer bloco visível com o texto de estoque,
   * fecha pelo "Fechar"/×/OK e devolve o texto. A janela "Venda Conjunta" não é aviso (quem cuida dela é vendaConjunta()).
   */
  const RE_ESTOQUE = /n[ãa]o\s+possui\s+estoque\s+suficiente|estoque\s+insuficiente/i;
  const RE_FECHAR = /^(fechar|ok|×|x|fechar\s*×)$/i;
  const BOTOES = 'button,a,input[type=button],input[type=submit],[onclick],.btn,span';
  function avisoDoSite(d) {
    const w = d.defaultView;
    const fechado = (e) => { for (let x = e; x && x.nodeType === 1; x = x.parentElement) if (w.getComputedStyle(x).display === 'none') return true; return w.getComputedStyle(e).visibility === 'hidden'; };
    const texto = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
    const ignorar = (e) => e.id === 'modalCarregamentoAjax' || e.id === 'modalCarrinho' || /colocar\s+todos\s+no\s+carrinho/i.test(e.textContent || '');
    let janelas = [...d.querySelectorAll('.modal, [role=dialog], [role=alertdialog], .bootbox, .swal2-popup, .ui-dialog')]
      .filter((e) => !ignorar(e) && !fechado(e) && texto(e));
    janelas = janelas.filter((e) => !janelas.some((o) => o !== e && o.contains(e))); // a de fora, não o miolo dela
    // bloco visível com o texto de estoque que não é janela padrão: sobe até o pai que tem o botão de fechar
    if (!janelas.length) {
      const folhas = [...d.querySelectorAll('div,p,span,td,li,section')].filter((e) => RE_ESTOQUE.test(e.textContent || '') && ![...e.children].some((c) => RE_ESTOQUE.test(c.textContent || '')) && !fechado(e) && !e.closest('[data-tsc-visto]'));
      for (const f of folhas) {
        // sem botão de fechar por perto, fica o próprio bloco (nunca sobe até a página inteira)
        let c = f, achou = null;
        for (let i = 0; i < 6 && c && c !== d.body; i++, c = c.parentElement) { if ([...c.querySelectorAll(BOTOES)].some((b) => RE_FECHAR.test(texto(b) || b.value || ''))) { achou = c; break; } }
        const j = achou || f;
        if (!ignorar(j)) janelas.push(j);
      }
    }
    const m = janelas.find((e) => RE_ESTOQUE.test(e.textContent || '')) || janelas[0];
    if (!m) return null;
    const corpo = m.querySelector('.modal-body, .bootbox-body, .swal2-html-container') || m;
    // o texto do aviso: o bloco mais interno com a frase de estoque (sem o título "Atenção" nem o botão)
    const frase = [...m.querySelectorAll('*')].reverse().find((e) => RE_ESTOQUE.test(e.textContent || '') && ![...e.children].some((c) => RE_ESTOQUE.test(c.textContent || '')));
    const txt = (frase ? texto(frase) : texto(corpo)).replace(/\s*(fechar|ok|×)\s*$/i, '').trim();
    // fecha a janela para seguir com o próximo produto
    const fechar = [...m.querySelectorAll(BOTOES)].find((b) => RE_FECHAR.test(texto(b) || b.value || '')) || m.querySelector('[data-dismiss],[aria-label=Close],.close');
    try {
      if (fechar) fechar.click();
      else if (m.matches('.modal, [role=dialog], [role=alertdialog], .bootbox, .swal2-popup, .ui-dialog')) m.style.display = 'none';
      else m.setAttribute('data-tsc-visto', '1'); // bloco sem botão de fechar: não conta de novo no próximo produto
    } catch { /* ok */ }
    return txt || 'O site mostrou um aviso.';
  }
  /**
   * De quem é o aviso: "O produto Happy Pumpkin não possui estoque…" pode chegar atrasado, já durante o produto seguinte.
   * Devolve o nome (de `atual` ou de um dos `anteriores`) citado no texto; sem nome no texto, é do produto atual.
   */
  function donoDoAviso(texto, atual, anteriores) {
    const m = /produto\s+(.+?)\s+n[ãa]o\s+possui/i.exec(texto || '');
    if (!m) return atual;
    const n = esq(m[1]), parece = (x) => { const e = esq(x); return e === n || (e.length >= 4 && n.length >= 4 && (e.includes(n) || n.includes(e))); };
    if (parece(atual)) return atual;
    return (anteriores || []).find((x) => esq(x) === n) || (anteriores || []).find(parece) || atual;
  }
  function vendaConjunta(d) {
    const w = d.defaultView;
    const txt = (e) => String(e.tagName === 'INPUT' ? e.value || '' : e.textContent || '').replace(/\s+/g, ' ').trim();
    // janela fechada = ele ou um pai com display:none. Não exige tamanho nem "visível": o quadro de trabalho é invisível e,
    // no site de verdade, a checagem por tamanho deixava a janela passar sem ser aceita
    const fechado = (e) => { for (let x = e; x && x.nodeType === 1; x = x.parentElement) if (w.getComputedStyle(x).display === 'none') return true; return false; };
    const achados = [...d.querySelectorAll('a,button,input,span,div,label,td')].filter((b) => RE_TODOS.test(txt(b)) && !fechado(b));
    if (!achados.length) return null;
    const el = achados[achados.length - 1]; // o mais interno com o texto
    const botao = el.closest('a,button,input,[onclick]') || el;
    const janela = botao.closest('.modal, .modal-content, [role=dialog], .ui-dialog') || d;
    const itens = [...janela.querySelectorAll('table tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim())).filter((c) => c.length >= 4 && /\d/.test(c[0]))
      .map((c) => ({ cod: c[0], nome: c[1], qtd: num(c[c.length - 2]), preco: num(c[c.length - 1]) }));
    return { botao, itens };
  }
  /** clique como o de uma pessoa (alguns botões do site só reagem ao toque completo) */
  function clicar(el) {
    const w = el.ownerDocument.defaultView;
    for (const t of ['mousedown', 'mouseup']) { try { el.dispatchEvent(new w.MouseEvent(t, { bubbles: true, cancelable: true, view: w })); } catch { /* segue com o clique */ } }
    el.click();
  }
  /** segunda tentativa: se o botão é um link do site ("javascript:…"), segue o link direto */
  function seguirLink(el) {
    const hr = el.getAttribute && el.getAttribute('href');
    if (hr && /^javascript:/i.test(hr)) { try { el.ownerDocument.defaultView.eval(decodeURIComponent(hr.replace(/^javascript:/i, ''))); return; } catch { /* cai no clique */ } }
    clicar(el);
  }
  /** o que havia na página quando o site não confirmou: ajuda a descobrir por que (sem dado de cliente; só janelas e botões) */
  function diagnostico(d) {
    try {
      const w = d.defaultView;
      const jan = [...d.querySelectorAll('.modal,[role=dialog],.ui-dialog')].map((m) => `${m.id || String(m.className).split(' ')[0] || m.tagName}=${w.getComputedStyle(m).display}`).slice(0, 6).join(' ');
      const bot = [...d.querySelectorAll('*')].filter((e) => !e.children.length && /colocar\s+todos/i.test(e.tagName === 'INPUT' ? e.value || '' : e.textContent || '')).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}`).slice(0, 3).join(' ');
      return `janelas: ${jan || 'nenhuma'} | botão "Colocar Todos": ${bot || 'não achei'} | texto "Venda Conjunta": ${/venda\s+conjunta/i.test(d.body ? d.body.textContent : '') ? 'sim' : 'não'}`.slice(0, 190);
    } catch { return ''; }
  }
  const ajustar = (qtd, c) => { let q = Math.max(qtd, c.min || 0); q = Math.round(Math.ceil(q / c.mult - 1e-9) * c.mult * 1000) / 1000; if (c.max && q > c.max) q = Math.floor(c.max / c.mult + 1e-9) * c.mult; return q; };

  async function abrirFornecedor() {
    await abrir(BASE + 'Abertura.aspx');
    const d = doc();
    if (d.getElementById('UserName')) throw new Error('O site pediu login de novo. Entre e clique no favorito.');
    d.getElementById('new-pedido')?.click();
    await espera(400);
    const sel = d.getElementById(P + 'ddlFornecedores');
    if (!sel) throw new Error('Não achei a escolha de fornecedor em "Novo Pedido".');
    const op = [...sel.options].find((o) => o.text.trim().toUpperCase() === 'FRANQUIAS');
    if (!op) throw new Error('O fornecedor FRANQUIAS não aparece em "Todos Fornecedores".');
    await agir(() => { sel.value = op.value; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    for (let k = 0; k < 20 && !doc().getElementById(L + 'txtBusca'); k++) await espera(500);
    if (!doc().getElementById(L + 'txtBusca')) throw new Error('A tela de produtos de FRANQUIAS não abriu.');
  }

  /** aviso que ficou aberto de um produto anterior (chegou atrasado): fecha e marca aquele produto, nunca o atual */
  const anteriores = (atualNome) => itens.filter((i) => res.has(i.cod) && i.nome !== atualNome).map((i) => i.nome);
  function atribuirAviso(nome, aviso) {
    const it = itens.find((i) => i.nome === nome), x = it && res.get(it.cod);
    if (!x || x.status === 'ok') return;
    res.set(it.cod, { ...x, status: RE_ESTOQUE.test(aviso) ? 'sem_estoque' : 'recusado', erro: aviso, atrasado: true });
    pintar(); avisar(false);
  }
  /** confere se há aviso na tela: de outro produto → marca aquele e devolve null; deste → devolve o texto */
  function avisoDe(nome) {
    const a = avisoDoSite(doc());
    if (!a) return null;
    const dono = donoDoAviso(a, nome, anteriores(nome));
    if (dono !== nome) { atribuirAviso(dono, a); return null; }
    return a;
  }

  async function colocar(it) {
    const r = { cod: it.cod, nome: it.nome, pedido: it.qtd };
    try {
      avisoDe(null); // um aviso atrasado do produto anterior não pode cair neste
      let d = doc();
      const busca = d.getElementById(L + 'txtBusca');
      busca.value = it.nome;
      await agir(() => d.getElementById(L + 'btnBuscar').click());
      let alvo = null;
      for (let k = 0; k < 8 && !alvo; k++) { alvo = cartoes(doc()).find((c) => esq(c.nome) === esq(it.nome)); if (!alvo) await espera(600); }
      avisoDe(null); // a busca recarrega o quadro: o aviso atrasado pode aparecer agora
      if (!alvo) return { ...r, status: 'nao_encontrado' };
      if (!alvo.preco || alvo.preco <= 0.011) return { ...r, status: 'indisponivel' };
      const q = ajustar(it.qtd, alvo);
      if (!(q > 0)) return { ...r, status: 'acima_do_maximo' };
      d = doc();
      const antes = topoCarrinho(d);
      alvo.q.value = br(q);
      alvo.q.dispatchEvent(new Event('change', { bubbles: true }));
      const botao = d.getElementById(alvo.q.id.replace(/txtQtde_\d+$/, 'lnkAddCart'));
      if (!botao) return { ...r, status: 'erro', erro: 'botão "Colocar no Carrinho" não encontrado' };
      // o clique pode recarregar o quadro ou só atualizar o topo: espera um dos dois
      const recarregou = agir(() => botao.click()).catch(() => null);
      let depois = antes, aviso = null, junto = null, aceitou = 0;
      for (let k = 0; k < 50 && depois === antes && !aviso; k++) {
        await Promise.race([recarregou, espera(500)]);
        // venda conjunta (mug + infusor): aceita "Colocar Todos no Carrinho" e continua esperando o carrinho mudar.
        // Se a janela continuar aberta depois do clique, tenta mais uma vez seguindo o link do botão
        const vc = aceitou < 2 ? vendaConjunta(doc()) : null;
        if (vc) {
          if (!junto) junto = vc.itens;
          aceitou++;
          const de = agir(() => (aceitou === 1 ? clicar(vc.botao) : seguirLink(vc.botao))).catch(() => null);
          await Promise.race([de, espera(1500)]);
          depois = topoCarrinho(doc());
          continue;
        }
        depois = topoCarrinho(doc());
        if (depois === antes) aviso = avisoDe(it.nome);
      }
      // o carrinho não mudou e nada apareceu: o aviso do site às vezes chega bem depois — espera mais um pouco só por ele
      for (let k = 0; k < 16 && depois === antes && !aviso; k++) {
        await espera(500);
        depois = topoCarrinho(doc());
        if (depois === antes) aviso = avisoDe(it.nome);
      }
      if (depois !== antes) return { ...r, qtd: q, preco: alvo.preco, status: 'ok', junto: junto && junto.length ? junto : undefined };
      if (aviso) return { ...r, qtd: q, preco: alvo.preco, status: RE_ESTOQUE.test(aviso) || /estoque/i.test(aviso) ? 'sem_estoque' : 'recusado', erro: aviso };
      return { ...r, qtd: q, preco: alvo.preco, status: 'sem_confirmacao', erro: `${aceitou ? `aceitei a venda conjunta ${aceitou}× e o carrinho não mudou · ` : ''}${diagnostico(doc())}` };
    } catch (e) {
      return { ...r, status: 'erro', erro: String(e.message || e).slice(0, 200) };
    }
  }

  // ---------- estado e tela ----------
  let itens = [], res = new Map(), atual = null;
  const ROT = { ok: ['no carrinho', 'tsc-ok'], sem_estoque: ['fora de estoque', 'tsc-er'], recusado: ['o site recusou', 'tsc-er'], indisponivel: ['indisponível', 'tsc-er'], nao_encontrado: ['não achou', 'tsc-er'], acima_do_maximo: ['acima do máximo', 'tsc-av'], sem_confirmacao: ['sem confirmação', 'tsc-av'], erro: ['erro', 'tsc-er'] };
  function pintar() {
    const feitos = itens.filter((i) => res.has(i.cod)).length, ok = [...res.values()].filter((x) => x.status === 'ok').length;
    el.bar.style.width = `${itens.length ? Math.round((feitos / itens.length) * 100) : 0}%`;
    el.topo.innerHTML = `<b>${feitos}/${itens.length} produtos processados</b> · ${ok} no carrinho${atual ? `<br><small>Agora: ${esc(atual)}</small>` : ''}`;
    el.lista.innerHTML = '';
    for (const it of itens) {
      const x = res.get(it.cod);
      const li = document.createElement('li');
      const [t, c] = x ? ROT[x.status] : it.nome === atual ? ['colocando…', 'tsc-pe'] : ['na fila', 'tsc-pe'];
      li.innerHTML = `<span>${esc(it.nome)}${x && x.qtd ? ` <small>(${br(x.qtd, x.qtd % 1 ? 2 : 0)})</small>` : ''}${x && x.junto ? x.junto.map((j) => `<br><small>+ junto: ${esc(j.nome)}${j.qtd ? ` (${br(j.qtd, j.qtd % 1 ? 2 : 0)})` : ''}</small>`).join('') : ''}${x && x.erro && (x.status === 'sem_estoque' || x.status === 'recusado') ? `<br><small class="tsc-av-t">Site: ${esc(x.erro)}</small>` : ''}${x && x.erro && x.status === 'sem_confirmacao' ? `<br><small style="color:#666">Diagnóstico: ${esc(x.erro)}</small>` : ''}</span><em class="st ${c}" title="${x && x.erro ? esc(x.erro) : ''}">${t}</em>`;
      if (x && !['ok', 'indisponivel', 'sem_estoque'].includes(x.status) && !rodando) {
        const b = document.createElement('button'); b.className = 'tb'; b.textContent = 'Tentar de novo';
        b.title = x.status === 'sem_confirmacao' ? 'O site não confirmou. Ele pode já estar no carrinho: confira antes para não dobrar.' : '';
        b.onclick = () => rodar([it]);
        li.append(b);
      }
      el.lista.append(li);
    }
  }
  async function avisar(fim, topo) {
    try {
      await fetch(`${PAINEL}/api/pedido-site/progresso?c=${codigo}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ itens: [...res.values()], atual, fim, carrinhoDepois: fim ? { texto: topo || '' } : undefined }) });
    } catch { /* o painel só acompanha; o carrinho segue */ }
  }
  async function rodar(lista) {
    if (rodando) return;
    rodando = true; parar = false; msg('Não feche esta aba até terminar.');
    try {
      await abrirFornecedor();
      for (const it of lista) {
        if (parar) break;
        atual = it.nome; res.delete(it.cod); pintar(); avisar(false);
        res.set(it.cod, await colocar(it));
        atual = null; pintar(); avisar(false);
      }
    } catch (e) {
      msg(`Parou: ${esc(e.message || e)}`, 'er');
    }
    rodando = false; atual = null;
    // a página de cima mostra o carrinho atualizado
    try { await abrir(BASE + 'Abertura.aspx'); } catch { /* ok */ }
    const topo = topoCarrinho(doc() || document);
    pintar();
    const ok = [...res.values()].filter((x) => x.status === 'ok').length, prob = itens.length - ok;
    msg(`<b>Pronto:</b> ${ok} de ${itens.length} produtos no carrinho${topo ? ` (${esc(topo)})` : ''}.${prob ? ` ${prob} com problema: veja abaixo e use "Tentar de novo" se fizer sentido.` : ''}<br>O pedido <b>não foi finalizado</b>: confira o carrinho e finalize no site.<br><button class="pr" type="button">Ver o carrinho</button>`, 'ok');
    el.msgs.querySelector('button.pr').onclick = () => { location.href = BASE + 'Abertura.aspx'; };
    avisar(true, topo);
  }

  (async () => {
    try {
      const r = await fetch(`${PAINEL}/api/pedido-site/lista?c=${codigo}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { sessionStorage.removeItem('teashopCodigo'); throw new Error(j.erro || 'Não consegui ler a lista do painel.'); }
      itens = j.itens;
      box.querySelector('header b').textContent = `🛒 Carrinho Tea Shop · ${j.loja}`;
      const quem = [...document.querySelectorAll('a')].map((a) => a.textContent.replace(/\s+/g, ' ').trim()).find((t) => /^Olá/.test(t));
      pintar();
      const topo = topoCarrinho(document);
      if (topo && !/N[ãa]o h[áa] Ite/i.test(topo) && !confirm(`O carrinho já tem itens (${topo}). Os produtos da lista serão somados a ele. Continuar?`)) { msg('Nada foi colocado. Esvazie ou finalize o carrinho e clique no favorito de novo.', 'er'); return; }
      if (quem) box.querySelector('header b').textContent = `🛒 Carrinho Tea Shop · ${quem.replace(/^Olá,?\s*/, '')}`;
      await rodar(itens);
    } catch (e) { msg(esc(e.message || e), 'er'); el.topo.textContent = ''; }
  })();
})();
