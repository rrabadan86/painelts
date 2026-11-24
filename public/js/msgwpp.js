/* Mensagem de WhatsApp das campanhas: a montagem do texto, o telefone e as regras de quem sai da fila.
 * Funções puras, usadas pelos dois lados para o resultado ser igual: a tela (envio manual, clientes.js e campanhas.js)
 * e o servidor (robô do WhatsApp, src/zapfila.js). Testes: tests/unit/zapfila.test.js. */
(function () {
  /** campos que a mensagem aceita ({nome}, {cha}…); {saudacao} é calculada na hora do envio */
  const CAMPOS = ['nome', 'nomecompleto', 'loja', 'cha', 'ultimocha', 'pacote', 'vendedora', 'apresentacao', 'pontos', 'vence', 'vencepts', 'ultimacompra', 'dias', 'aniversario', 'visitas', 'chaoferta', 'saudacao'];
  const saudacao = (hora) => (hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite');
  const tem = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /** troca os {campos} pelos valores do cliente; os extras da campanha ({produto}) entram depois */
  function montar(texto, valores, extras) {
    const v = valores || {};
    let t = String(texto || '').replace(/\{([a-z]+)\}/g, (m, k) => (tem(v, k) ? v[k] : m)).replace(/ {2,}/g, ' ');
    for (const [k, x] of Object.entries(extras || {})) t = t.split('{' + k + '}').join(x);
    return t;
  }

  /** {apresentacao}: modelos editáveis em Configurações → loja → Mensagens (decisão do dono, 23/11/2026). Padrão sem o artigo
   *  ("Aqui é Gabrielly"/"Aqui é Felipe"): o antigo "Aqui é a …" saía errado para vendedor. Só aceita {vendedora} e {loja}. */
  const APRES_PADRAO = { com: 'Aqui é {vendedora}, da {loja}', sem: 'Aqui é a equipe da {loja}' };
  /** texto da apresentação: com a vendedora que mais atende o cliente ou, sem ela, o da equipe */
  function apresentacao(modelos, vendedora, loja) {
    const m = modelos || {};
    // "Sempre assinar como a equipe" (pedido do dono, 23/11/2026): usa o modelo sem vendedora mesmo com a favorita
    if (m.equipe) vendedora = '';
    const mod = vendedora ? (String(m.com || '').trim() || APRES_PADRAO.com) : (String(m.sem || '').trim() || APRES_PADRAO.sem);
    return mod.replace(/\{vendedora\}/g, vendedora || '').replace(/\{loja\}/g, loja || 'Tea Shop').replace(/\{[a-z]+\}/g, '').replace(/ {2,}/g, ' ').trim();
  }
  /** modelo válido para gravar: até 120 caracteres, uma linha, só {vendedora} e {loja}; vazio = o padrão */
  function apresentacaoValida(t) {
    const s = String(t == null ? '' : t).replace(/[\r\n\t]+/g, ' ').trim();
    if (!s) return '';
    if (s.length > 120) return null;
    const outros = (s.match(/\{([a-z]+)\}/g) || []).filter((x) => x !== '{vendedora}' && x !== '{loja}');
    return outros.length ? null : s;
  }

  /** número para o robô a partir do link do envio manual ("https://wa.me/5562999998888" → "5562999998888") */
  const paraDoLink = (wpp) => { const m = /^https:\/\/wa\.me\/(55\d{10,11})$/.exec(String(wpp || '')); return m ? m[1] : null; };
  /** o mesmo link que a tela monta a partir do celular do cadastro (aceita com o 55 na frente) */
  function linkDoCelular(celular) {
    const cel = String(celular || '').replace(/\D/g, '');
    const local = cel.length >= 12 && cel.startsWith('55') ? cel.slice(2) : cel;
    return local.length >= 10 && local.length <= 11 ? 'https://wa.me/55' + local : null;
  }

  /**
   * Link do envio manual com o texto já escrito. Usa api.whatsapp.com/send em vez de wa.me/…?text=: no celular, o desvio do
   * wa.me estragava os emojis (chegavam ao cliente como "��"; acentos passavam). wpp = link do cadastro ("https://wa.me/55…")
   * ou só o número; sem número, o WhatsApp abre para escolher o contato. O texto vai bem formado (emoji partido vira nada, não erro).
   */
  function linkComTexto(wpp, texto) {
    const m = /(\d{10,13})\/?$/.exec(String(wpp || ''));
    const t = String(texto ?? '');
    const bom = typeof t.toWellFormed === 'function' ? t.toWellFormed() : t.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
    return 'https://api.whatsapp.com/send?' + (m ? 'phone=' + m[1] + '&' : '') + 'text=' + encodeURIComponent(bom);
  }

  /** produtos do filtro: [{ t, contem }]. "~texto" = todos os produtos que contêm o texto; o campo antigo "produto" vira "contém" */
  function listaProdutos(f) {
    f = f || {};
    const l = Array.isArray(f.produtos) && f.produtos.length ? f.produtos : f.produto ? ['~' + f.produto] : [];
    return l.filter(Boolean).map((x) => (x[0] === '~' ? { t: x.slice(1), contem: true } : { t: x, contem: false }));
  }
  /** {produto} na mensagem: os nomes escolhidos ("African Sunset 250G e African Sunset 100G") */
  function nomesProdutos(f) {
    const n = listaProdutos(f).map((x) => x.t.replace(/\s+/g, ' ').trim());
    return n.length <= 1 ? n[0] || '' : n.slice(0, -1).join(', ') + ' e ' + n[n.length - 1];
  }
  const extras = (camp) => ({ produto: nomesProdutos(camp && camp.filtros) });

  /** mensagem principal + variações, e qual é a da vez (rodízio pela quantidade já enviada na lista) */
  const textos = (camp) => [camp.mensagem, ...(camp.variacoes || [])];

  /**
   * Campanha Resumo diário (decisão do dono): a lista do dia é a da tela Clientes → Hoje, só com os motivos escolhidos, uma
   * mensagem por cliente — a do motivo mais importante dele, nesta ordem. Cada motivo tem o próprio texto (camp.porMotivo).
   */
  const MOTIVOS_RESUMO = ['validade', 'vence', 'repor', 'aniv', 'naoperder', 'risco', 'atencao'];
  const RESUMO_PADRAO = ['validade', 'vence', 'repor'];
  const NOME_RESUMO = 'Campanha Resumo diário';
  const ehResumo = (camp) => !!(camp && camp.filtros && Array.isArray(camp.filtros.resumo));
  /** os textos que valem para este cliente da lista: o do motivo dele (Resumo diário) ou a mensagem + variações */
  const textosDe = (camp, it) => (ehResumo(camp) && it && it.m && camp.porMotivo && camp.porMotivo[it.m] ? [camp.porMotivo[it.m]] : textos(camp));
  const variacaoDaVez = (lista, n) => (n > 0 ? lista.filter((x) => x.st === 'e').length % n : 0);

  /** marca do contato feito por esta campanha (fica no cadastro de contatos do cliente) */
  const motivoCampanha = (nome) => 'Campanha: ' + String(nome || '').slice(0, 28);
  /** dias sem contato pedidos na campanha: nunca menos que o intervalo da loja */
  const prazoCampanha = (camp, intervalo) => Math.max(Number(String(((camp && camp.filtros) || {}).semContato ?? '').replace(',', '.')) || 0, intervalo);

  /** por que este cliente pendente sai da fila: pediu para não receber, ou recebeu mensagem há pouco.
   *  O intervalo da loja vale sempre (até para a mesma campanha e para quem foi "voltado para a fila");
   *  o prazo maior pedido na campanha pode ser liberado à mão. → null | { tipo: 'optout' } | { tipo: 'recente', em, motivo } */
  function bloqueio(it, ct, o) {
    if (!it || it.st !== 'p' || !ct) return null;
    if (ct.optout) return { tipo: 'optout' };
    if (!ct.em) return null;
    const ha = o.agora - Date.parse(ct.em);
    if (ha < o.intervalo * 864e5 || (!it.liberado && o.dias && ha < o.dias * 864e5 && ct.motivo !== o.minha)) return { tipo: 'recente', em: ct.em, motivo: ct.motivo || '' };
    return null;
  }
  const dataBR = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const textoBloqueio = (b) => (b.tipo === 'optout' ? 'não quer mensagens' : `já recebeu em ${dataBR(b.em.slice(0, 10))}${b.motivo ? ' (' + b.motivo.replace(/^Campanha: /, 'campanha ') + ')' : ''}`);

  /**
   * Nome como se escreve (pedido do dono, 24/11/2026: o cadastro do FIXE vem "rodrigo rabadan" ou "RODRIGO RABADAN"):
   * a 1ª letra de cada nome e sobrenome em maiúscula, também depois de hífen e apóstrofo ("ana-paula d'ávila" →
   * "Ana-Paula D'Ávila"); "da, de, do, das, dos, e" minúsculos no meio; tira sujeira do começo (".rodrigo", "1rodrigo").
   * Uma função só para a tela (envio manual, Lista de espera, Orçamento) e o robô. Teste: NOME-MSG-01.
   */
  const PARTICULAS = /^(da|de|do|das|dos|e|di|du|del)$/;
  function nomeProprio(n) {
    const limpo = String(n || '').replace(/^[^\p{L}]+/u, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!limpo) return '';
    return limpo.split(' ').map((p, k) => (k && PARTICULAS.test(p) ? p : p.replace(/(^|[-'’])(\p{L})/gu, (m, sep, l) => sep + l.toUpperCase()))).join(' ');
  }
  /** o primeiro nome, no mesmo padrão ("RODRIGO RABADAN" → "Rodrigo"; "ana-paula" → "Ana-Paula") */
  const primeiroNome = (n) => nomeProprio(n).split(' ')[0] || '';

  /** período da campanha: 'antes' (ainda não começou), 'depois' (já terminou) ou null (dentro, ou sem datas). dia = 'AAAA-MM-DD' de Brasília */
  const foraDoPeriodo = (c, dia) => (c && c.inicio && dia < c.inicio ? 'antes' : c && c.fim && dia > c.fim ? 'depois' : null);
  const API = { nomeProprio, primeiroNome, APRES_PADRAO, apresentacao, apresentacaoValida, MOTIVOS_RESUMO, RESUMO_PADRAO, NOME_RESUMO, ehResumo, textosDe, foraDoPeriodo, CAMPOS, saudacao, montar, paraDoLink, linkDoCelular, linkComTexto, listaProdutos, nomesProdutos, extras, textos, variacaoDaVez, motivoCampanha, prazoCampanha, bloqueio, textoBloqueio };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  TS.msgWpp = API;
})();
