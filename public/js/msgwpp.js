/* Mensagem de WhatsApp das campanhas: a montagem do texto, o telefone e as regras de quem sai da fila.
 * Funções puras, usadas pelos dois lados para o resultado ser igual: a tela (envio manual, clientes.js e campanhas.js)
 * e o servidor (robô do WhatsApp, src/zapfila.js). Testes: tests/unit/zapfila.test.js. */
(function () {
  /** campos que a mensagem aceita ({nome}, {cha}…); {saudacao} é calculada na hora do envio */
  const CAMPOS = ['nome', 'nomecompleto', 'loja', 'cha', 'ultimocha', 'pacote', 'vendedora', 'pontos', 'vence', 'vencepts', 'ultimacompra', 'dias', 'aniversario', 'visitas', 'saudacao'];
  const saudacao = (hora) => (hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite');
  const tem = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /** troca os {campos} pelos valores do cliente; os extras da campanha ({produto}) entram depois */
  function montar(texto, valores, extras) {
    const v = valores || {};
    let t = String(texto || '').replace(/\{([a-z]+)\}/g, (m, k) => (tem(v, k) ? v[k] : m)).replace(/ {2,}/g, ' ');
    for (const [k, x] of Object.entries(extras || {})) t = t.split('{' + k + '}').join(x);
    return t;
  }

  /** número para o robô a partir do link do envio manual ("https://wa.me/5562999998888" → "5562999998888") */
  const paraDoLink = (wpp) => { const m = /^https:\/\/wa\.me\/(55\d{10,11})$/.exec(String(wpp || '')); return m ? m[1] : null; };
  /** o mesmo link que a tela monta a partir do celular do cadastro (aceita com o 55 na frente) */
  function linkDoCelular(celular) {
    const cel = String(celular || '').replace(/\D/g, '');
    const local = cel.length >= 12 && cel.startsWith('55') ? cel.slice(2) : cel;
    return local.length >= 10 && local.length <= 11 ? 'https://wa.me/55' + local : null;
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

  const API = { CAMPOS, saudacao, montar, paraDoLink, linkDoCelular, listaProdutos, nomesProdutos, extras, textos, variacaoDaVez, motivoCampanha, prazoCampanha, bloqueio, textoBloqueio };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  TS.msgWpp = API;
})();
