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
 * O contador de "clientes que entraram na loja" não existe no sistema: fica em branco.
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
    `👤 Clientes: ${f.clientes.total} (loja ${f.clientes.loja} · omni/corp ${f.clientes.omni} · delivery ${f.clientes.delivery})`,
    `🛍️ Itens: ${f.itens} · TKM ${brl(f.tkm)} · IPA ${num(f.ipa)} · PMA ${brl(f.pma)}`,
    f.recalculo ? `🔁 Recálculo da meta: ${f.recalculo.meta > 0 ? 'faltam ' + brl(f.recalculo.meta) : brl(-f.recalculo.meta) + ' acima'} · super meta: ${f.recalculo.superMeta > 0 ? 'faltam ' + brl(f.recalculo.superMeta) : brl(-f.recalculo.superMeta) + ' acima'}` : null,
    f.porDia ? `➡️ Para bater a meta do mês: ${brl(f.porDia.valor)} por dia nos ${f.porDia.dias} dias que faltam` : null,
    '',
    `☕ Espaço Gourmet: ${brl(f.eg.realizadas)} (meta ${brl(f.eg.metaDia)} · histórico ${brl(f.eg.historico)}) · ${f.eg.clientes} clientes · TKM ${brl(f.eg.tkm)}`,
    `🏪 Venda total do dia (loja + corp. + EG): ${brl(f.total.hoje)} · histórico ${brl(f.total.historico)}`,
  ];
  return l.filter((x) => x != null).join('\n');
}

function html(f) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cor = (bom) => (bom == null ? '#1d2b22' : bom ? '#1F5FBF' : '#B5452B');
  const sec = (t) => `<tr><td colspan="3" style="background:#D9D4C7;font-weight:700;padding:6px 10px">${esc(t)}</td></tr>`;
  const lin = (rot, val, extra = '', { forte, corVal, corExtra } = {}) =>
    `<tr><td style="padding:5px 10px;${forte ? 'font-weight:700;' : 'padding-left:24px;'}">${esc(rot)}</td><td style="padding:5px 10px;text-align:right;font-weight:700;white-space:nowrap;color:${corVal || '#1d2b22'}">${esc(val)}</td><td style="padding:5px 10px;text-align:right;color:${corExtra || '#1d2b22'}">${esc(extra)}</td></tr>`;
  const r = f.recalculo;
  return `<table cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;color:#1d2b22;width:100%;max-width:620px;border:1px solid #D9D4C7">
<tr><td colspan="3" style="background:#F3EBCF;color:#5b4a12;padding:7px 10px;font-size:12px">📊 Fechamento <b>automático</b> do <b>Painel Tea Shop</b>, com as vendas registradas no AppNext · desenvolvido por <b>Rodrigo Rabadan</b></td></tr>
<tr><td colspan="3" style="background:#2C5234;color:#fff;padding:9px 10px;font-weight:700">${esc(f.loja.nome)} · fechamento de ${esc(nomeDia(f.dia))}, ${dataBr(f.dia)}</td></tr>
${f.vendedoras.length ? `<tr><td colspan="3" style="padding:6px 10px;color:#5b6b60">Vendedoras do dia: ${esc(f.vendedoras.map((v) => v.nome).join(', '))}</td></tr>` : ''}
${lin('Meta do Dia', brl(f.meta.dia), pct(f.acumulado.pct), { forte: true, corExtra: cor(f.acumulado.pct == null ? null : f.acumulado.pct >= 1) })}
${lin(`Vendas Histórico (${dataBr(f.diaHistorico)})`, brl(f.vendas.historico), brl(f.acumulado.historico))}
${lin('Vendas Realizadas', brl(f.vendas.realizadas), brl(f.acumulado.realizado), { forte: true, corVal: cor(f.vendas.pctMeta == null ? null : f.vendas.pctMeta >= 1), corExtra: cor(f.acumulado.pctMeta == null ? null : f.acumulado.pctMeta >= 1) })}
${sec('Clientes')}
${lin('Clientes Total de Loja', f.clientes.total, '', { forte: true, corVal: '#1F5FBF' })}
${lin('Clientes de Omnichannel / Corporativo', f.clientes.omni)}
${lin('Clientes de Delivery', f.clientes.delivery)}
${lin('Clientes de Loja', f.clientes.loja, '', { forte: true })}
${lin('Clientes que entraram na loja', '—', 'sem contador')}
${sec('Indicadores')}
${lin('Itens Vendidos', f.itens, f.itensHist ? `hist. ${f.itensHist}` : '')}
${lin('TKM', brl(f.tkm), f.tkmHist ? `hist. ${brl(f.tkmHist)}` : '')}
${lin('IPA', num(f.ipa), f.ipaHist ? `hist. ${num(f.ipaHist)}` : '')}
${lin('PMA', brl(f.pma), f.pmaHist ? `hist. ${brl(f.pmaHist)}` : '')}
${r ? sec('Meta do mês (acumulada até o dia)') + lin('Recálculo da Meta', brl(Math.abs(r.meta)), r.meta > 0 ? 'falta' : 'acima', { forte: true, corVal: cor(r.meta <= 0) }) + lin('Recálculo da Super Meta', brl(Math.abs(r.superMeta)), r.superMeta > 0 ? 'falta' : 'acima', { forte: true, corVal: cor(r.superMeta <= 0) }) : ''}
${f.porDia ? lin('Para bater a meta do mês', `${brl(f.porDia.valor)}/dia`, `${f.porDia.dias} dias`) : ''}
${sec('Espaço Gourmet')}
${lin('Meta do dia EG', brl(f.eg.metaDia), pct(f.eg.pct), { forte: true })}
${lin('Vendas Histórico', brl(f.eg.historico))}
${lin('Vendas Realizadas', brl(f.eg.realizadas), '', { forte: true, corVal: '#1F5FBF' })}
${lin('Clientes em Venda', f.eg.clientes)}
${lin('TKM', brl(f.eg.tkm))}
${sec('Total')}
${lin('Venda Total Diária (Loja + Corp. + EG)', brl(f.total.hoje), '', { forte: true })}
${lin('Venda Total Diária (Loja + EG) Hist.', brl(f.total.historico), '', { forte: true })}
</table>`;
}

module.exports = { calcular, ultimoDia, texto, html, anoAntes };
