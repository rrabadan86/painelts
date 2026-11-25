/* Retorno das campanhas de WhatsApp (Clientes → Campanhas): quem voltou a comprar depois da mensagem e o grupo de comparação.
 * Contas puras, usadas pela tela (campanhas.js) e pelo servidor (src/campanhas.js, no sorteio do grupo de comparação).
 * - "Voltou" = comprou (cupom com CPF) DEPOIS do envio: do dia seguinte até N dias depois. O painel não tem a hora de cada
 *   compra; quando a compra traz a hora (k.em), vale só a que foi depois da hora do envio (inclusive no mesmo dia).
 * - "% voltaram" = voltaram ÷ enviados cujo prazo JÁ FECHOU; quem ainda está no prazo aparece separado.
 * - Grupo de comparação: 10% da lista fica sem mensagem (st 'c'), por sorteio estável pelo CPF + campanha (o mesmo cliente
 *   cai sempre do mesmo lado naquela campanha). Só em lista com 50 clientes ou mais. O retorno deles é medido na mesma
 *   janela, contada do dia em que a lista foi criada. Efeito da campanha = quem recebeu − quem não recebeu.
 *   Com menos de 20 clientes de prazo fechado em algum dos lados: "poucos dados".
 * st de cada cliente da lista: 'p' pendente · 'e' enviada · 'o' não quer mensagens · 'x' pulada · 'c' comparação (nunca recebe). */
(function () {
  'use strict';
  const PCT = 10;        // % da lista que fica sem mensagem
  const MIN_LISTA = 50;  // lista menor que isso não separa grupo (10% de 30 são 3 clientes: não mede nada)
  const MIN_GRUPO = 20;  // clientes de prazo fechado em cada lado para a diferença não ser sorte
  const DIA = 864e5, FUSO = 3 * 3600e3; // Brasília = UTC−3 (sem horário de verão)

  // FNV-1a de 32 bits: sorteio estável, igual no navegador e no servidor
  const hash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return h >>> 0; };
  /** este cliente fica no grupo de comparação desta campanha? (sempre a mesma resposta para o mesmo CPF + campanha) */
  const noGrupo = (campId, cpf) => hash(String(campId) + '|' + String(cpf)) % 100 < PCT;

  /** separa o grupo de comparação entre os pendentes de uma lista nova.
   *  o = { ligado, em (ISO do momento da lista: vira o "envio" de quem não recebe), tamanho (da lista inteira; padrão lista.length) } */
  function separar(lista, campId, o = {}) {
    const tam = o.tamanho != null ? o.tamanho : lista.length;
    if (!o.ligado || tam < MIN_LISTA) return lista;
    return lista.map((x) => (x.st === 'p' && noGrupo(campId, x.cpf) ? { ...x, st: 'c', em: o.em } : x));
  }

  /** dia de Brasília (dias desde 1970, como TS.isoToDay) de um instante ISO */
  const diaDe = (iso) => Math.floor((Date.parse(iso) - FUSO) / DIA);

  /** as compras de um cliente que contam como retorno de um envio (mesma regra de retornoItem) */
  function cuponsDoEnvio(item, cupons, janela) {
    const t = Date.parse(item.em), e = diaDe(item.em);
    return (cupons || []).filter((k) => k.day <= e + janela && (k.em && Number.isFinite(Date.parse(k.em)) ? Date.parse(k.em) > t : k.day > e));
  }

  /** retorno de UM cliente da lista. cupons: [{ day, vt, em? }] do cliente; hoje: dia de hoje (Brasília).
   *  → null (não foi enviado nem é do grupo de comparação) | { voltou, vt, primeira, fechado, aberto, envio } */
  function retornoItem(item, cupons, janela, hoje) {
    if (!item || (item.st !== 'e' && item.st !== 'c') || !item.em) return null;
    const t = Date.parse(item.em);
    if (!Number.isFinite(t)) return null;
    const e = diaDe(item.em);
    let vt = 0, primeira = null, n = 0;
    for (const k of cupons || []) {
      if (!(k.day <= e + janela)) continue;
      const depois = k.em && Number.isFinite(Date.parse(k.em)) ? Date.parse(k.em) > t : k.day > e; // sem a hora da compra: só do dia seguinte em diante
      if (!depois) continue;
      n++; vt += k.vt || 0;
      if (primeira == null || k.day < primeira) primeira = k.day;
    }
    const fechado = hoje > e + janela; // o último dia do prazo já acabou
    return { voltou: n > 0, vt, primeira, fechado, aberto: !fechado, envio: e };
  }

  const grupo0 = () => ({ n: 0, fechados: 0, abertos: 0, volt: 0, voltFech: 0, voltAbertos: 0, vt: 0, vtFech: 0, taxa: null, gasto: null });
  function somar(g, x) {
    g.n++;
    if (x.fechado) { g.fechados++; if (x.voltou) { g.voltFech++; g.vtFech += x.vt; } } else { g.abertos++; if (x.voltou) g.voltAbertos++; }
    if (x.voltou) { g.volt++; g.vt += x.vt; }
  }
  const fechar = (g) => { g.taxa = g.fechados ? g.voltFech / g.fechados : null; g.gasto = g.fechados ? g.vtFech / g.fechados : null; return g; };

  /** efeito da campanha: quem recebeu × quem não recebeu, só com quem já teve o prazo inteiro.
   *  → null (sem grupo de comparação ou sem ninguém de prazo fechado num dos lados) |
   *    { taxa (diferença em pontos, fração), gasto (R$ por cliente), vendasAMais (gasto × recebedores fechados), poucos } */
  function efeito(rec, ctl) {
    if (!ctl || !ctl.fechados || !rec.fechados) return null;
    const gasto = rec.gasto - ctl.gasto;
    return { taxa: rec.taxa - ctl.taxa, gasto, vendasAMais: gasto * rec.fechados, poucos: ctl.fechados < MIN_GRUPO || rec.fechados < MIN_GRUPO };
  }

  /** resumo de uma lista. cuponsDe(cpf) → cupons do cliente. filtro(item) opcional (ex.: só uma variação da mensagem). */
  function resumo(lista, cuponsDe, janela, hoje, filtro) {
    const s = { total: 0, pend: 0, opt: 0, pul: 0, env: 0, comp: 0, rec: grupo0(), ctl: grupo0() };
    for (const it of lista || []) {
      if (filtro && !filtro(it)) continue;
      s.total++;
      if (it.st === 'p') s.pend++; else if (it.st === 'o') s.opt++; else if (it.st === 'x') s.pul++;
      if (it.st !== 'e' && it.st !== 'c') continue;
      if (it.st === 'e') s.env++; else s.comp++;
      const x = retornoItem(it, cuponsDe(it.cpf), janela, hoje);
      if (x) somar(it.st === 'e' ? s.rec : s.ctl, x);
    }
    fechar(s.rec); fechar(s.ctl);
    s.efeito = s.comp ? efeito(s.rec, s.ctl) : null;
    return s;
  }

  /** retorno de TODAS as campanhas juntas (CAMP-TOT-01, pedido do dono de 25/11/2026): cada cliente e cada compra contam uma vez,
   *  mesmo quando o cliente recebeu mais de uma campanha no mesmo prazo (cada campanha, olhada sozinha, conta a compra; a soma não).
   *  campanhas: [{ janela, rodadas: [{ lista }] }] · cuponsDe(cpf) → [{ day, vt, em? }] (objetos estáveis: a mesma compra é o mesmo objeto)
   *  hoje: dia de Brasília · noPer(dia) opcional: só os envios (e as listas do grupo de comparação) com o dia no período.
   *  → { campanhas, rec: { n, fechados, volt, voltFech, vt, taxa }, ctl: { … }, efeito (pontos, fração) | null, poucos } */
  function geral(campanhas, cuponsDe, hoje, noPer) {
    const porCpf = { e: new Map(), c: new Map() }, comEnvio = new Set();
    for (const camp of campanhas || []) {
      const jan = +camp.janela || 30;
      for (const r of camp.rodadas || []) for (const it of r.lista || []) {
        if ((it.st !== 'e' && it.st !== 'c') || !it.em || !Number.isFinite(Date.parse(it.em))) continue;
        const e = diaDe(it.em);
        if (noPer && !noPer(e)) continue;
        const m = porCpf[it.st];
        if (!m.has(it.cpf)) m.set(it.cpf, []);
        m.get(it.cpf).push({ it, jan, e });
        if (it.st === 'e') comEnvio.add(camp);
      }
    }
    const somar = (m, pular) => {
      const g = { n: 0, fechados: 0, volt: 0, voltFech: 0, vt: 0, taxa: null };
      for (const [cpf, envios] of m) {
        if (pular && pular.has(cpf)) continue;
        const cupons = cuponsDe(cpf);
        const contados = new Set();
        let fechado = false, voltFech = false;
        for (const x of envios) {
          const ks = cuponsDoEnvio(x.it, cupons, x.jan);
          for (const k of ks) contados.add(k);
          if (hoje > x.e + x.jan) { fechado = true; if (ks.length) voltFech = true; }
        }
        g.n++;
        if (contados.size) { g.volt++; for (const k of contados) g.vt += k.vt || 0; }
        if (fechado) { g.fechados++; if (voltFech) g.voltFech++; }
      }
      g.taxa = g.fechados ? g.voltFech / g.fechados : null;
      return g;
    };
    const rec = somar(porCpf.e);
    const ctl = somar(porCpf.c, porCpf.e); // quem recebeu alguma campanha não serve de comparação
    const efeito = rec.taxa != null && ctl.taxa != null ? rec.taxa - ctl.taxa : null;
    return { campanhas: comEnvio.size, rec, ctl, efeito, poucos: efeito != null && (ctl.fechados < MIN_GRUPO || rec.fechados < MIN_GRUPO) };
  }

  const API = { PCT, MIN_LISTA, MIN_GRUPO, noGrupo, separar, diaDe, retornoItem, cuponsDoEnvio, resumo, efeito, geral };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }
  TS.campRetorno = API;
})();
