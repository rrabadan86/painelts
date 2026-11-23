/* Produtos → Site, filtro "Mudou em": as contas são puras (testadas em tests/unit/sitedia.test.js); a tela (site.js) só mostra.
 * O histórico de cada produto do site (src/site.js) guarda um ponto [data ISO da consulta, preço, preço "de" ou null,
 * disponível 1/0] a cada consulta em que algo mudou (preço null = saiu do site). A data de uma mudança é, portanto, a da
 * consulta em que o painel a viu (o site é consultado uma vez por dia, às 10h, e em "Consultar agora").
 * Para separar "nenhuma mudança" de "sem consulta neste dia" o servidor também guarda a lista das consultas feitas
 * (`consultas`, desde 23/11/2026); antes disso só se sabe dos dias em que alguma coisa mudou (`consultasDesde`). */
(function () {
  const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  /** dia (AAAA-MM-DD, horário de Brasília) de uma data ISO */
  const diaSP = (iso) => FMT.format(new Date(iso));
  const igual = (x, y) => (x == null && y == null) || (x != null && y != null && Math.abs(x - y) < 0.01);
  /** dois pontos do histórico diferem em algo que a tela mostra: preço, preço "de", estoque, ou o produto saiu/voltou */
  const mudou = (a, b) => !igual(a[1], b[1]) || !igual(a[2] ?? null, b[2] ?? null) || (a[1] != null && b[1] != null && (a[3] ?? 1) !== (b[3] ?? 1));

  /** as mudanças de UM produto que o painel viu naquele dia: [{ em, a, b }] (a = ponto anterior, b = o do dia), na ordem.
   *  O primeiro ponto (quando o painel começou a guardar o produto) não é mudança. */
  function mudancasDoDia(pts, dia) {
    const out = [];
    if (!Array.isArray(pts) || !dia) return out;
    for (let k = 1; k < pts.length; k++) if (diaSP(pts[k][0]) === dia && mudou(pts[k - 1], pts[k])) out.push({ em: pts[k][0], a: pts[k - 1], b: pts[k] });
    return out;
  }

  /** a primeira e a última consulta de cada dia: Map(dia → { primeira, ultima }) — das consultas guardadas e, para os dias
   *  de antes dessa lista, das datas que aparecem no histórico (toda data do histórico é uma consulta) */
  function diasDeConsulta(consultas, historico) {
    const m = new Map();
    const por = (iso) => {
      if (!iso || Number.isNaN(Date.parse(iso))) return;
      const d = diaSP(iso), x = m.get(d);
      if (!x) m.set(d, { primeira: iso, ultima: iso });
      else { if (Date.parse(iso) < Date.parse(x.primeira)) x.primeira = iso; if (Date.parse(iso) > Date.parse(x.ultima)) x.ultima = iso; }
    };
    for (const iso of consultas || []) por(iso);
    for (const l of Object.values(historico || {})) if (Array.isArray(l)) for (const p of l) por(p && p[0]);
    return m;
  }

  /** como está aquele dia: 'consultado' (houve consulta: lista vazia = nenhuma mudança), 'sem-consulta' (com certeza não
   *  houve consulta: dia futuro, antes da primeira consulta guardada ou depois do começo da lista de consultas) ou
   *  'sem-registro' (antes de o painel guardar a lista das consultas e sem mudança registrada: não dá para saber) */
  function situacaoDia(dia, dias, consultasDesde, hoje) {
    if (!dia) return 'qualquer';
    if (dias.has(dia)) return 'consultado';
    if (hoje && dia > hoje) return 'sem-consulta';
    const todos = [...dias.keys()].sort();
    if (!todos.length || dia < todos[0]) return 'sem-consulta';
    if (consultasDesde && dia >= diaSP(consultasDesde)) return 'sem-consulta';
    return 'sem-registro';
  }

  /** o dia anterior (AAAA-MM-DD) */
  const diaAntes = (dia) => new Date(Date.parse(dia + 'T12:00:00Z') - 86400e3).toISOString().slice(0, 10);

  const API = { diaSP, mudou, mudancasDoDia, diasDeConsulta, situacaoDia, diaAntes };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof TS !== 'undefined') TS.siteDia = API;
})();
