'use strict';
/**
 * Fechamento do dia — substitui a planilha "Acompanhamento de vendas" que as lojas
 * preenchiam à mão e mandavam por e-mail no fim do expediente.
 *
 * Mesmas contas da planilha:
 *  - Meta do dia = meta do mês ÷ dias do mês; meta acumulada = meta do dia × dia do mês
 *  - Vendas histórico = o mesmo dia do ano anterior (mesma data)
 *  - Vendas realizadas = caixa da loja (sem Espaço Gourmet, sem corporativo/omnichannel)
 *  - % = realizado acumulado no mês ÷ histórico acumulado até o mesmo dia
 *  - Recálculo da meta = meta acumulada até hoje − realizado acumulado (super meta = meta × 1,2)
 *  - TKM = vendas ÷ clientes; IPA = itens ÷ clientes; PMA = vendas ÷ itens
 *  - Clientes: só o total do dia e o total do histórico (mesma data do ano anterior).
 */
const I = require('./indicadores');

const EG = 'ESPAÇO GOURMET';
const DIA = 86400000;
const isoDia = (d) => new Date(d * DIA).toISOString().slice(0, 10);
const diaIso = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / DIA);
const diasNoMes = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
const anoAntes = (iso) => {
  const y = +iso.slice(0, 4) - 1, m = iso.slice(5, 7);
  const d = Math.min(+iso.slice(8, 10), diasNoMes(`${y}-${m}`)); // 29/02 → 28/02
  return `${y}-${m}-${String(d).padStart(2, '0')}`;
};
const semVendedor = (v) => !v || /^sem vendedor$/i.test(String(v).trim());
const ehCorp = (v) => /corporativ/i.test(v || '');
const ehOmni = (v) => /omni|e-?commerce|loja virtual|online|site|ifood|rappi/i.test(v || '');
const ehTaxa = (v) => /^taxa /i.test(String(v.descricao || '').trim());
const ehDelivery = (v) => /delivery|entrega/i.test(String(v.descricao || '')) || /delivery|entrega/i.test(String(v.vendedor || ''));

/** números de um conjunto de linhas de venda de um dia (ou período) */
function numeros(linhas) {
  let loja = 0, corpOmni = 0, eg = 0, total = 0, itens = 0;
  const cupons = { loja: new Set(), omni: new Set(), delivery: new Set(), eg: new Set() };
  const porVend = new Map();
  for (const v of linhas) {
    const x = v.vt || 0;
    total += x;
    const ch = v.cupom + '|' + v.loja;
    if (v.grupoC === EG || v.cat === EG) { eg += x; cupons.eg.add(ch); continue; }
    if (ehCorp(v.vendedor) || ehOmni(v.vendedor)) { corpOmni += x; cupons.omni.add(ch); continue; }
    loja += x;
    if (!ehTaxa(v)) itens += v.qtd || 0;
    if (ehDelivery(v)) cupons.delivery.add(ch);
    else cupons.loja.add(ch);
    if (!semVendedor(v.vendedor) && !/delivery|entrega/i.test(v.vendedor)) porVend.set(v.vendedor, (porVend.get(v.vendedor) || 0) + x);
  }
  for (const c of cupons.delivery) cupons.loja.delete(c);
  const cliLoja = cupons.loja.size, cliOmni = cupons.omni.size, cliDel = cupons.delivery.size;
  const cliTotal = cliLoja + cliOmni + cliDel;
  return {
    loja, corpOmni, eg, total, itens,
    clientes: { total: cliTotal, omni: cliOmni, delivery: cliDel, loja: cliLoja, eg: cupons.eg.size },
    tkm: cliTotal ? loja / cliTotal : null, ipa: cliTotal ? itens / cliTotal : null, pma: itens ? loja / itens : null,
    egTkm: cupons.eg.size ? eg / cupons.eg.size : null,
    vendedoras: [...porVend.entries()].sort((a, b) => b[1] - a[1]).map(([nome, vt]) => ({ nome, vt })),
  };
}

/** fechamento de uma loja num dia (AAAA-MM-DD) */
function calcular({ loja, vendas, metaPlanilha }, dia) {
  const ym = dia.slice(0, 7), n = diasNoMes(ym), dm = +dia.slice(8, 10);
  const hist = anoAntes(dia);
  const doDia = (d) => vendas.filter((v) => v.data === d);
  const doPeriodo = (de, ate) => vendas.filter((v) => v.data >= de && v.data <= ate);
  const hoje = numeros(doDia(dia));
  const ant = numeros(doDia(hist));
  const acum = numeros(doPeriodo(ym + '-01', dia));
  const acumHist = numeros(doPeriodo(hist.slice(0, 7) + '-01', hist));
  const metaMes = I.metaMes(loja, ym, metaPlanilha, vendas);
  const metaDia = metaMes ? metaMes / n : null;
  const metaAcum = metaDia != null ? metaDia * dm : null;
  // Espaço Gourmet: meta = EG do mesmo mês do ano anterior (+ % da meta automática) ÷ dias
  const egMesAnt = numeros(doPeriodo(`${+ym.slice(0, 4) - 1}${ym.slice(4)}-01`, `${+ym.slice(0, 4) - 1}${ym.slice(4)}-${diasNoMes(`${+ym.slice(0, 4) - 1}${ym.slice(4)}`)}`)).eg;
  const pctAuto = loja.metaAuto && loja.metaAuto.ativo ? (loja.metaAuto.pct || 0) / 100 : 0;
  const egMetaDia = egMesAnt > 0 ? (egMesAnt * (1 + pctAuto)) / n : null;
  const restantes = n - dm;
  return {
    loja: { id: loja.id, nome: loja.nome }, dia, diaHistorico: hist, temVendas: hoje.total > 0,
    vendedoras: hoje.vendedoras,
    meta: { mes: metaMes, dia: metaDia, acumulada: metaAcum },
    vendas: { historico: ant.loja, realizadas: hoje.loja, pctDia: ant.loja ? hoje.loja / ant.loja : null, pctMeta: metaDia ? hoje.loja / metaDia : null },
    acumulado: { realizado: acum.loja, historico: acumHist.loja, pct: acumHist.loja ? acum.loja / acumHist.loja : null, pctMeta: metaAcum ? acum.loja / metaAcum : null },
    clientes: { ...hoje.clientes, historico: ant.clientes.total, entraram: null },
    itens: hoje.itens, itensHist: ant.itens,
    tkm: hoje.tkm, ipa: hoje.ipa, pma: hoje.pma, tkmHist: ant.tkm, ipaHist: ant.ipa, pmaHist: ant.pma,
    recalculo: metaAcum != null ? { meta: metaAcum - acum.loja, superMeta: metaAcum * 1.2 - acum.loja } : null,
    porDia: metaMes != null && restantes > 0 ? { valor: Math.max(0, (metaMes - acum.loja) / restantes), dias: restantes } : null,
    corpOmni: hoje.corpOmni,
    eg: { metaDia: egMetaDia, historico: ant.eg, realizadas: hoje.eg, clientes: hoje.clientes.eg, tkm: hoje.egTkm, pct: egMetaDia ? hoje.eg / egMetaDia : null },
    total: { hoje: hoje.total, historico: ant.total },
  };
}

/** último dia com vendas até "ate" */
function ultimoDia(vendas, ate) {
  let u = '';
  for (const v of vendas) if (v.data <= ate && v.data > u) u = v.data;
  return u || null;
}

// ---------- formatos para e-mail e Telegram ----------
const brl = (x) => (x == null || !isFinite(x) ? '—' : 'R$\u00a0' + x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const num = (x, c = 2) => (x == null || !isFinite(x) ? '—' : x.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }));
const pct = (x) => (x == null || !isFinite(x) ? '—' : (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
const dataBr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const nomeDia = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' });

function texto(f) {
  const l = [
    `━━ ${f.loja.nome} ━━`,
    `📊 Fechamento automático do Painel Tea Shop (vendas do AppNext)`,
    `🧾 Fechamento de ${nomeDia(f.dia)}, ${dataBr(f.dia)}`,
    f.vendedoras.length ? `👥 ${f.vendedoras.map((v) => v.nome).join(', ')}` : null,
    '',
    `🎯 Meta do dia: ${brl(f.meta.dia)}`,
    `📜 Vendas histórico (${dataBr(f.diaHistorico)}): ${brl(f.vendas.historico)}`,
    `💰 Vendas realizadas: ${brl(f.vendas.realizadas)}${f.vendas.pctMeta != null ? ` (${pct(f.vendas.pctMeta)} da meta do dia)` : ''}`,
    `📈 Acumulado no mês: ${brl(f.acumulado.realizado)} · histórico ${brl(f.acumulado.historico)} (${pct(f.acumulado.pct)})`,
    '',
    `👤 Clientes: ${f.clientes.total} · histórico ${f.clientes.historico || '—'}`,
    `🛍️ Itens: ${f.itens} · TKM ${brl(f.tkm)} · IPA ${num(f.ipa)} · PMA ${brl(f.pma)}`,
    f.recalculo ? `🔁 Recálculo da meta: ${f.recalculo.meta > 0 ? '🔴 -' + brl(f.recalculo.meta) : '🔵 ' + brl(-f.recalculo.meta)} · super meta: ${f.recalculo.superMeta > 0 ? '🔴 -' + brl(f.recalculo.superMeta) : '🔵 ' + brl(-f.recalculo.superMeta)}` : null,
    f.porDia ? `➡️ Para bater a meta do mês: ${brl(f.porDia.valor)} por dia nos ${f.porDia.dias} dias que faltam` : null,
    '',
    `☕ Espaço Gourmet: ${brl(f.eg.realizadas)} (meta ${brl(f.eg.metaDia)} · histórico ${brl(f.eg.historico)}) · ${f.eg.clientes} clientes · TKM ${brl(f.eg.tkm)}`,
    `🏪 Venda total do dia (loja + corp. + EG): ${brl(f.total.hoje)} · histórico ${brl(f.total.historico)}`,
  ];
  return l.filter((x) => x != null).join('\n');
}

function html(f) {
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const VERDE = '#2C5234', ESCURO = '#1F3D2B', OURO = '#C9A227', CREME = '#F7F4EC', LINHA = '#ECE7DB', CINZA = '#7A857D', AZUL = '#1F5FBF', VERM = '#B5452B';
  const cor = (bom) => (bom == null ? ESCURO : bom ? AZUL : VERM);
  // sobra = positivo (azul); falta = negativo (vermelho): R$ -16.884,60
  const sinal = (v) => (v == null || !isFinite(v) ? '—' : v < 0 ? `R$\u00a0-${brl(-v).replace('R$\u00a0', '')}` : brl(v));
  const td = 'padding:9px 0;border-bottom:1px solid ' + LINHA + ';font-size:14px;';
  const num = 'text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;';
  // tabela de uma seção: [rótulo, valor, valor 2] com cabeçalho opcional das colunas
  const secao = (titulo, colunas, linhas) => `
<tr><td style="padding:22px 24px 0">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    <tr>
      <td style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${VERDE};padding-bottom:6px;border-bottom:2px solid ${OURO}">${esc(titulo)}</td>
      ${(colunas || ['', '']).map((c) => `<td style="font-size:11px;font-weight:600;color:${CINZA};${num}padding-bottom:6px;border-bottom:2px solid ${OURO};width:108px">${esc(c)}</td>`).join('')}
    </tr>
    ${linhas.filter(Boolean).map(([rot, a, b, o = {}]) => `<tr>
      <td style="${td}color:${o.forte ? ESCURO : '#3D4A42'};${o.forte ? 'font-weight:700;' : ''}">${esc(rot)}</td>
      <td style="${td}${num}font-weight:700;color:${o.corA || ESCURO}">${esc(a ?? '')}</td>
      <td style="${td}${num}color:${o.corB || CINZA}">${esc(b ?? '')}</td></tr>`).join('')}
  </table>
</td></tr>`;
  const card = (rot, valor, sub, corValor, corSub) => `
<td width="33%" valign="top" style="padding:0 3px">
  <div style="background:${CREME};border-radius:12px;padding:10px 9px">
    <div style="font-size:10px;color:${CINZA};text-transform:uppercase;letter-spacing:.6px">${esc(rot)}</div>
    <div style="font-size:16px;font-weight:700;color:${corValor || ESCURO};margin-top:4px">${esc(valor)}</div>
    <div style="font-size:12px;color:${corSub || CINZA};margin-top:2px">${esc(sub)}</div>
  </div>
</td>`;
  const r = f.recalculo;
  const pctMetaDia = f.vendas.pctMeta, pctAcum = f.acumulado.pct;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;border-collapse:separate;background:#ffffff;border:1px solid ${LINHA};border-radius:16px;font-family:Arial,Helvetica,sans-serif;color:${ESCURO}">
<tr><td style="padding:22px 24px 4px">
  <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;color:${OURO};text-transform:uppercase">Fechamento do dia</div>
  <div style="font-size:22px;font-weight:700;color:${ESCURO};margin-top:4px">${esc(f.loja.nome)}</div>
  <div style="font-size:14px;color:${CINZA};margin-top:2px">${esc(nomeDia(f.dia))}, ${dataBr(f.dia)}${f.vendedoras.length ? ` · ${esc(f.vendedoras.map((v) => v.nome).join(', '))}` : ''}</div>
  <div style="font-size:11px;color:${CINZA};margin-top:8px">Gerado automaticamente pelo <b style="color:${VERDE}">Painel Tea Shop</b> com as vendas do AppNext · desenvolvido por <b style="color:${VERDE}">Rodrigo Rabadan</b></div>
</td></tr>
<tr><td style="padding:14px 18px 0">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed"><tr>
    ${card('Vendas do dia', brl(f.vendas.realizadas), pctMetaDia != null ? `${pct(pctMetaDia)} da meta do dia` : 'sem meta', cor(pctMetaDia == null ? null : pctMetaDia >= 1), cor(pctMetaDia == null ? null : pctMetaDia >= 1))}
    ${card('Meta do dia', brl(f.meta.dia), f.meta.mes ? `meta do mês ${brl(f.meta.mes)}` : '')}
    ${card('Acumulado no mês', brl(f.acumulado.realizado), pctAcum != null ? `${pct(pctAcum)} do histórico` : '', null, cor(pctAcum == null ? null : pctAcum >= 1))}
  </tr></table>
</td></tr>
${secao('Vendas', ['Dia', 'Acumulado'], [
    ['Meta', brl(f.meta.dia), brl(f.meta.acumulada)],
    [`Histórico (${dataBr(f.diaHistorico)})`, brl(f.vendas.historico), brl(f.acumulado.historico)],
    ['Realizado', brl(f.vendas.realizadas), brl(f.acumulado.realizado), { forte: true, corA: cor(pctMetaDia == null ? null : pctMetaDia >= 1), corB: cor(f.acumulado.pctMeta == null ? null : f.acumulado.pctMeta >= 1) }],
  ])}
${secao('Clientes', ['Hoje', 'Histórico'], [
    ['Total', f.clientes.total, f.clientes.historico || '—', { forte: true }],
  ])}
${secao('Indicadores', ['Hoje', 'Histórico'], [
    ['Itens vendidos', fmtNum(f.itens, 0), f.itensHist ? fmtNum(f.itensHist, 0) : '—'],
    ['TKM', brl(f.tkm), f.tkmHist ? brl(f.tkmHist) : '—'],
    ['IPA', num2(f.ipa), f.ipaHist ? num2(f.ipaHist) : '—'],
    ['PMA', brl(f.pma), f.pmaHist ? brl(f.pmaHist) : '—'],
  ])}
${r ? secao('Meta do mês', null, [
    ['Recálculo da meta', sinal(-r.meta), '', { forte: true, corA: cor(r.meta <= 0) }],
    ['Recálculo da super meta', sinal(-r.superMeta), '', { forte: true, corA: cor(r.superMeta <= 0) }],
    f.porDia ? ['Para bater a meta do mês', `${brl(f.porDia.valor)}/dia`, `${f.porDia.dias} dias`] : null,
  ]) : ''}
${secao('Espaço Gourmet', ['Hoje', 'Histórico'], [
    ['Vendas', brl(f.eg.realizadas), brl(f.eg.historico), { forte: true, corA: cor(f.eg.pct == null ? null : f.eg.pct >= 1) }],
    ['Meta do dia', brl(f.eg.metaDia), f.eg.pct != null ? pct(f.eg.pct) : ''],
    ['Clientes', f.eg.clientes, ''],
    ['TKM', brl(f.eg.tkm), ''],
  ])}
${secao('Total do dia', ['Hoje', 'Histórico'], [
    ['Loja + corporativo + Espaço Gourmet', brl(f.total.hoje), brl(f.total.historico), { forte: true }],
  ])}
<tr><td style="padding:20px 24px 22px;font-size:11px;line-height:1.5;color:${CINZA}">
  Azul = acima da meta · vermelho = abaixo · histórico = mesma data do ano anterior.
</td></tr>
</table>`;
}
const fmtNum = (x, c) => num(x, c);
const num2 = (x) => num(x, 2);

module.exports = { calcular, ultimoDia, texto, html, anoAntes };
