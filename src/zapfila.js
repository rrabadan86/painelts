'use strict';
/**
 * Fila do robô do WhatsApp (campanhas com "Enviar pelo robô"): quem recebe a próxima mensagem, ou por que não há.
 * TODAS as travas ficam aqui, no servidor (decisão do dono — o número é o da loja e pode ser bloqueado):
 *   ligado/pausado · dias e horário · teto do número por dia · ritmo aleatório · limite por dia de cada campanha ·
 *   intervalo da loja entre mensagens ao mesmo cliente · "não quer mensagens" · número sem WhatsApp · trava de estoque.
 * `decidir` é conta pura (testada em tests/unit/zapfila.test.js); o resto só lê e grava os arquivos da loja:
 *   dados/<loja>/zap/estado.json   { ligado, pausa, proximoEm, falhas, dia, enviadosDia, optoutsDesde, conexao, sessao }
 *   dados/<loja>/zap/preparo.json  { <campanha>: { em, por, rodada, itens: { <cpf>: { para, v, espera? } } } }
 *   dados/<loja>/zap/naoquer.json  { <número>: { em, cpfs } } — quem respondeu "parar": não recebe pelo robô
 *                                  (até a loja marcar "Voltou a aceitar" na ficha do cliente)
 *   dados/<loja>/zap/enviados.json { <número>: { em, cpf } } — último envio do robô para cada número
 * O texto sai igual ao do envio manual: os valores dos {campos} de cada cliente são os mesmos que a tela usa
 * (calculados com os dados de vendas e do FIXE) e a montagem é a de public/js/msgwpp.js nos dois lados. Quem manda
 * esses valores (o `preparo`): o servidor sozinho, todo dia (src/zapauto.js, a conta da própria tela), e o navegador
 * de quem abre Campanhas.
 */
const fs = require('fs');
const path = require('path');
const C = require('./config');
const CAMP = require('./campanhas');
const M = require('../public/js/msgwpp');

// horario: 'loja' (padrão, decisão do dono) = envia no horário de funcionamento da loja, dia a dia; 'proprio' = das/as/dias abaixo
const PADRAO = { horario: 'loja', min: 900, max: 1200, das: '09:00', as: '18:30', dias: [1, 2, 3, 4, 5, 6], teto: 30, falhas: 3 };
const ORIGEM_RESPOSTA = 'respondeu parar pelo WhatsApp'; // fica no contato e na fila: a loja vê de onde veio e pode desfazer
const PREPARO_DIAS = 3; // os valores dos campos ({pontos}, {dias}…) envelhecem: depois disso a lista precisa ser conferida de novo
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const NUMERO = /^55\d{10,11}$/;
/**
 * Chave única do celular (pedido do dono): o mesmo número com e sem o 9º dígito é o mesmo cliente.
 * Ex.: 62981718205 = 6281718205 → '5562981718205'. Contas antigas do WhatsApp respondem sem o 9; o FIXE pode ter qualquer um.
 * Só celular (o número local de 8 dígitos começando com 6, 7, 8 ou 9) ganha o 9; fixo fica como está.
 */
function foneChave(n) {
  let d = String(n || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.length === 12 && d.startsWith('55') && /[6-9]/.test(d[4])) d = d.slice(0, 4) + '9' + d.slice(4);
  return d;
}
/** o mesmo objeto, com as chaves de celular na forma única (junta o que estava guardado com e sem o 9) */
function porChave(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const c = foneChave(k);
    if (!out[c]) { out[c] = v; continue; }
    // dois registros do mesmo número: fica o mais recente, e os clientes dos dois
    const a = out[c], b = v, ea = String((a && a.em) || a || ''), eb = String((b && b.em) || b || '');
    const novo = eb > ea ? b : a;
    const cpfs = [...new Set([...((a && a.cpfs) || []), ...((b && b.cpfs) || [])])];
    out[c] = novo && typeof novo === 'object' ? { ...novo, ...(cpfs.length || (novo.cpfs) ? { cpfs } : {}) } : novo;
  }
  return out;
}
const CPF_OK = /^\d{11}(\d{3})?$/;
const hm = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const limpo = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const fim4 = (n) => String(n || '').slice(-4);

// ---------- configuração da loja (lojas.json → zap) ----------
function cfgDe(loja) {
  const z = (loja && loja.zap) || {};
  const r = validarCfg({ ...PADRAO, ...z });
  return r.ok || { ...PADRAO };
}
function validarCfg(b) {
  b = b || {};
  const int = (v) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v.trim())) ? Number(v) : NaN);
  const min = int(b.min), max = int(b.max), teto = int(b.teto), falhas = int(b.falhas);
  if (!(Number.isInteger(min) && Number.isInteger(max) && min >= 60 && max <= 7200)) return { erro: 'Ritmo: de 60 a 7200 segundos entre uma mensagem e outra.' };
  if (min > max) return { erro: 'Ritmo: o primeiro número precisa ser menor ou igual ao segundo.' };
  const das = String(b.das || ''), as = String(b.as || '');
  if (!HORA.test(das) || !HORA.test(as)) return { erro: 'Horário de envio inválido (use HH:MM).' };
  if (hm(das) >= hm(as)) return { erro: 'Horário de envio: o início precisa ser antes do fim.' };
  const dias = Array.isArray(b.dias) ? [...new Set(b.dias.map((d) => int(d)))].sort() : null;
  if (!dias || !dias.length || dias.some((d) => !(Number.isInteger(d) && d >= 0 && d <= 6))) return { erro: 'Escolha pelo menos um dia da semana.' };
  if (!(Number.isInteger(teto) && teto >= 1 && teto <= 200)) return { erro: 'Máximo por dia: de 1 a 200 mensagens.' };
  if (!(Number.isInteger(falhas) && falhas >= 1 && falhas <= 10)) return { erro: 'Parar sozinho: de 1 a 10 falhas seguidas.' };
  const horario = b.horario == null ? 'loja' : b.horario;
  if (horario !== 'loja' && horario !== 'proprio') return { erro: 'Horário de envio: escolha "igual ao funcionamento da loja" ou "horário próprio".' };
  return { ok: { horario, min, max, das, as, dias, teto, falhas } };
}

// ---------- arquivos ----------
const pasta = (id) => path.join(C.pastaLoja(id), 'zap');
const arq = (id, nome) => path.join(pasta(id), nome + '.json');
function lerJson(id, nome) { try { const j = JSON.parse(fs.readFileSync(arq(id, nome), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; } }
function gravarJson(id, nome, j) { C.gravarAtomico(arq(id, nome), JSON.stringify(j), 0o640); }

const ESTADO0 = { ligado: false, pausa: null, proximoEm: null, falhas: 0, dia: null, enviadosDia: 0, optoutsDesde: null, conexao: null, sessao: false };
const lerEstado = (id) => ({ ...ESTADO0, ...lerJson(id, 'estado') });
const temEstado = (id) => fs.existsSync(arq(id, 'estado'));
/** lê, muda e grava de uma vez (nada assíncrono no meio: um "Pausar" durante um envio não se perde) */
function mudarEstado(id, fn) { const e = lerEstado(id); fn(e); gravarJson(id, 'estado', e); return e; }

const arqContatos = (id) => path.join(C.pastaLoja(id), 'contatos.json');
function lerContatos(id) { try { return JSON.parse(fs.readFileSync(arqContatos(id), 'utf8')) || {}; } catch { return {}; } }
function mudarContato(id, cpf, fn) {
  const todos = lerContatos(id);
  const c = todos[cpf] || {};
  fn(c);
  todos[cpf] = c;
  C.gravarAtomico(arqContatos(id), JSON.stringify(todos), 0o640);
}

const lerPreparo = (id) => lerJson(id, 'preparo');
/** os valores dos campos e o número de cada cliente pendente: do servidor (src/zapauto.js) ou do navegador de quem tem a tela Clientes */
function gravarPreparo(id, campId, itens, por, agora = Date.now()) {
  const c = CAMP.ler(id).find((x) => x.id === campId);
  const rod = c && c.rodadas && c.rodadas[0];
  if (!rod) return { erro: 'Campanha não encontrada.' };
  if (!Array.isArray(itens) || itens.length > 5000) return { erro: 'Lista inválida.' };
  const pend = new Set(rod.lista.filter((x) => x.st === 'p').map((x) => x.cpf));
  const out = {};
  for (const x of itens) {
    const cpf = String((x && x.cpf) || '');
    if (!CPF_OK.test(cpf) || !pend.has(cpf)) continue;
    const v = {};
    for (const k of M.CAMPOS) if (k !== 'saudacao' && x.v && typeof x.v[k] === 'string') v[k] = limpo(x.v[k], 80);
    const para = NUMERO.test(String(x.para || '')) ? String(x.para) : null;
    out[cpf] = { para, v, ...(x.espera ? { espera: limpo(x.espera, 80) } : {}) };
  }
  const todos = lerPreparo(id);
  const vivas = new Set(CAMP.ler(id).map((x) => x.id));
  for (const k of Object.keys(todos)) if (!vivas.has(k)) delete todos[k]; // campanha apagada: os dados vão junto
  todos[campId] = { em: new Date(agora).toISOString(), por, rodada: rod.id, itens: out };
  gravarJson(id, 'preparo', todos);
  return { ok: { clientes: Object.keys(out).length } };
}
/** mensagem ou critérios mudaram: o que foi conferido antes não vale mais */
function limparPreparo(id, campId) {
  const todos = lerPreparo(id);
  if (!todos[campId]) return;
  delete todos[campId];
  gravarJson(id, 'preparo', todos);
}

// ---------- relógio de Brasília ----------
const FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const SEM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function relogio(agora) {
  const p = {};
  for (const x of FMT.formatToParts(new Date(agora))) p[x.type] = x.value;
  return { dia: C.diaSP(agora), sem: SEM[p.weekday], hora: +p.hour, min: +p.hour * 60 + +p.minute };
}
/**
 * Janela de envio de um dia (decisão do dono: "igual ao funcionamento da loja, cada dia da semana um horário").
 * → { das, as, origem: 'loja'|'feriado'|'proprio' } ou null (não envia nesse dia). iso = 'AAAA-MM-DD' (Brasília); sem = 0 (dom)…6 (sáb).
 * horario 'loja' com o funcionamento cadastrado: horário especial da data (feriado: fechado → null) primeiro, depois o do dia da
 * semana (fechado → null), de 30 minutos antes de abrir (MARGEM_ABRE_MIN) até 30 minutos antes de fechar (MARGEM_FECHA_MIN). Sem funcionamento cadastrado (ou horario 'proprio'): das/as/dias.
 */
const DIAS_OP = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const SEM_WPP_PAUSA = 5; // decisão do dono: 5 clientes seguidos "sem WhatsApp" pausam o robô (a conferência do número pode ter falhado)
const MARGEM_FECHA_MIN = 30; // decisão do dono: pelo horário da loja, o robô para 30 minutos antes de fechar
const MARGEM_ABRE_MIN = 30; // decisão do dono (23/11/2026): e começa 30 minutos antes de abrir
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** janela de envio pelo horário da loja: de 30 min antes de abrir até 30 min antes de fechar → { das, as } ou null */
const janelaLoja = (abre, fecha) => {
  const ini = Math.max(0, hm(abre) - MARGEM_ABRE_MIN), fim = hm(fecha) - MARGEM_FECHA_MIN;
  if (fim <= hm(abre)) return null; // não sobra tempo de envio nesse dia (conta pelo horário aberto, não pela margem da manhã)
  return { das: hhmm(ini), as: hhmm(fim) };
};
function temFuncionamento(loja) {
  const f = loja && loja.operacao && loja.operacao.funcionamento;
  return !!(f && DIAS_OP.every((d) => f[d] && typeof f[d] === 'object' && (f[d].fechado === true || (HORA.test(f[d].abre || '') && HORA.test(f[d].fecha || '')))));
}
function janelaDoDia(loja, cfg, iso, sem) {
  cfg = cfg || PADRAO;
  if (cfg.horario !== 'proprio' && temFuncionamento(loja)) {
    const esp = loja.feriadosHorario && loja.feriadosHorario[iso];
    if (esp && typeof esp === 'object') {
      if (esp.fechado) return null;
      if (HORA.test(esp.abre || '') && HORA.test(esp.fecha || '') && esp.abre < esp.fecha) { const j = janelaLoja(esp.abre, esp.fecha); return j ? { ...j, origem: 'feriado' } : null; }
    }
    const f = loja.operacao.funcionamento[DIAS_OP[sem]];
    if (f.fechado || !(f.abre < f.fecha)) return null;
    const j = janelaLoja(f.abre, f.fecha);
    return j ? { ...j, origem: 'loja' } : null;
  }
  return cfg.dias.includes(sem) ? { das: cfg.das, as: cfg.as, origem: 'proprio' } : null;
}
/** os próximos N dias de envio da loja (a tela usa para "volta segunda às 09:00" e o término estimado) */
function agenda(loja, cfg, agora = Date.now(), n = 21) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const r = relogio(agora + k * 864e5);
    const j = janelaDoDia(loja, cfg, r.dia, r.sem);
    out.push(j ? { dia: r.dia, sem: r.sem, das: j.das, as: j.as } : null);
  }
  return out;
}
/** mensagens que o robô já mandou hoje pelo número da loja (todas as campanhas) */
const enviadosHoje = (estado, agora) => (estado.dia === relogio(agora).dia ? estado.enviadosDia || 0 : 0);

// ---------- a decisão (conta pura) ----------
const MOTIVOS = {
  sem_servico: 'O robô do WhatsApp não está instalado neste servidor.',
  desconectado: 'O WhatsApp da loja não está conectado.',
  desligado: 'O robô está desligado.',
  pausado: 'O robô está pausado.',
  fora_dia: 'Hoje não é dia de envio.',
  loja_fechada: 'Hoje a loja está fechada: o robô envia no horário de funcionamento da loja.',
  fora_janela: 'Fora do horário de envio.',
  teto: 'O máximo de mensagens de hoje foi atingido. Continua no próximo dia de envio.',
  ritmo: 'Esperando o intervalo entre uma mensagem e outra.',
  sem_campanha: 'Nenhuma campanha está marcada para enviar pelo robô.',
  conferir_lista: 'A lista precisa ser conferida: o painel não conseguiu conferir sozinho. Abra a tela Campanhas (ela confere ao abrir).',
  limite_campanha: 'As campanhas chegaram ao limite de hoje. Continua amanhã.',
  esperando_estoque: 'Só faltam clientes esperando estoque do produto oferecido (no chá a granel, pelo menos 100 g).',
  sem_pendentes: 'Todas as mensagens das campanhas do robô já foram enviadas.',
  fora_periodo: 'As campanhas do robô estão fora do período (data de início ou de término).',
};
const ordem = (a, b) => String(a.criadaEm || '').localeCompare(String(b.criadaEm || '')) || String(a.id).localeCompare(String(b.id));
/** campanhas que o robô envia: ligadas para o robô e não pausadas, da mais antiga para a mais nova (ordem estável) */
const campanhasDoRobo = (campanhas) => (campanhas || []).filter((c) => c.robo === true && c.ativa !== false && c.rodadas && c.rodadas[0]).sort(ordem);
/** envios de hoje da campanha (todas as listas, manuais e do robô): é o mesmo limite da fila manual */
const enviadosCampanhaHoje = (c, dia) => c.rodadas.reduce((n, r) => n + r.lista.filter((x) => x.st === 'e' && x.em && C.diaSP(x.em) === dia).length, 0);

/**
 * → { marcar: [{ campanha, rodada, cpf, st, motivo, optout? }], msg?: { id, campanha, nome, rodada, cliente, para, texto, v }, motivo? }
 * `marcar` são os clientes que saem da fila sem receber (pediu para não receber, recebeu há pouco, sem celular válido).
 */
function decidir({ cfg, estado, campanhas, contatos, preparo, naoquer, enviados, intervalo, agora, janela, horarioLoja }) {
  const marcar = [];
  const fim = (motivo) => ({ marcar, motivo });
  if (!estado.ligado) return fim('desligado');
  if (estado.pausa) return fim('pausado');
  const r = relogio(agora);
  // janela de hoje (quem chama calcula pelo horário da loja: janelaDoDia); sem ela, das/as/dias da configuração
  const jan = janela !== undefined ? janela : (cfg.dias.includes(r.sem) ? { das: cfg.das, as: cfg.as } : null);
  if (!jan) return fim(horarioLoja ? 'loja_fechada' : 'fora_dia');
  if (r.min < hm(jan.das) || r.min >= hm(jan.as)) return fim('fora_janela');
  if (enviadosHoje(estado, agora) >= cfg.teto) return fim('teto');
  if (estado.proximoEm && agora < Date.parse(estado.proximoEm)) return fim('ritmo');
  const todasRobo = campanhasDoRobo(campanhas);
  if (!todasRobo.length) return fim('sem_campanha');
  const robos = todasRobo.filter((c) => !M.foraDoPeriodo(c, r.dia)); // só as campanhas dentro do período (início e término)
  if (!robos.length) return fim('fora_periodo');
  contatos = contatos || {}; preparo = preparo || {}; naoquer = porChave(naoquer); enviados = porChave(enviados);
  let conferir = false, limite = false, estoque = false;
  for (const c of robos) {
    const rod = c.rodadas[0];
    if (!rod.lista.some((x) => x.st === 'p')) continue;
    const limiteDia = c.limiteDia != null ? c.limiteDia : 20;
    if (limiteDia > 0 && enviadosCampanhaHoje(c, r.dia) >= limiteDia) { limite = true; continue; }
    const prep = preparo[c.id];
    const prepOk = prep && prep.rodada === rod.id && prep.itens && agora - Date.parse(prep.em) < PREPARO_DIAS * 864e5;
    const dias = M.prazoCampanha(c, intervalo), minha = M.motivoCampanha(c.nome);
    const sai = (it, st, motivo, extra) => marcar.push({ campanha: c.id, rodada: rod.id, cpf: it.cpf, st, motivo, ...extra });
    for (const it of rod.lista) {
      if (it.st !== 'p') continue;
      const b = M.bloqueio(it, contatos[it.cpf], { intervalo, dias, minha, agora });
      if (b) { sai(it, 'x', M.textoBloqueio(b)); continue; }
      if (!prepOk) { conferir = true; break; }
      const p = prep.itens[it.cpf];
      if (!p) { conferir = true; continue; } // entrou na lista depois da última conferência: espera a próxima
      if (p.para && naoquer[foneChave(p.para)]) { sai(it, 'o', ORIGEM_RESPOSTA, { optout: true, para: p.para }); continue; }
      if (p.espera) { estoque = true; continue; } // a mensagem ofereceria produto sem estoque: continua na lista
      if (!NUMERO.test(p.para || '')) { sai(it, 'x', 'sem celular válido'); continue; }
      const ja = enviados[foneChave(p.para)];
      if (ja && ja.cpf !== it.cpf && agora - Date.parse(ja.em) < intervalo * 864e5) { sai(it, 'x', 'mesmo celular de outro cliente que já recebeu'); continue; }
      const textos = M.textosDe(c, it); // Resumo diário: o texto do motivo do cliente
      const k = M.variacaoDaVez(rod.lista, textos.length);
      const texto = M.montar(textos[k], { ...p.v, saudacao: M.saudacao(r.hora) }, M.extras(c)).trim();
      if (!texto) { sai(it, 'x', 'mensagem vazia'); continue; }
      return { marcar, msg: { id: `${c.id}-${rod.id}-${it.cpf}`, campanha: c.id, nome: c.nome, rodada: rod.id, cliente: { cpf: it.cpf, nome: it.nome || '' }, para: p.para, texto, v: textos.length > 1 ? k : null } };
    }
  }
  return fim(conferir ? 'conferir_lista' : limite ? 'limite_campanha' : estoque ? 'esperando_estoque' : 'sem_pendentes');
}

/** lê os dados da loja e decide: a próxima mensagem, ou o motivo de não haver */
function proxima(lojaId, agora = Date.now()) {
  const loja = C.get().lojas.find((l) => l.id === lojaId);
  if (!loja) return { marcar: [], motivo: 'desligado' };
  const cfg = cfgDe(loja), r = relogio(agora);
  return decidir({
    janela: janelaDoDia(loja, cfg, r.dia, r.sem), horarioLoja: cfg.horario !== 'proprio' && temFuncionamento(loja),
    cfg, estado: lerEstado(lojaId), campanhas: CAMP.ler(lojaId), contatos: lerContatos(lojaId), preparo: lerPreparo(lojaId),
    naoquer: lerJson(lojaId, 'naoquer'), enviados: lerJson(lojaId, 'enviados'), intervalo: loja.wppIntervalo || 21, agora,
  });
}

/** o número que respondeu "parar" era deste cliente (descoberto quando ele chegou na fila) */
function ligarNumeroAoCliente(id, para, cpf) {
  const n = porChave(lerJson(id, 'naoquer')), k = foneChave(para);
  if (!n[k]) return;
  const e = typeof n[k] === 'object' ? n[k] : { em: String(n[k]), cpfs: [] };
  if (!Array.isArray(e.cpfs)) e.cpfs = [];
  if (!e.cpfs.includes(cpf)) e.cpfs.push(cpf);
  n[k] = e;
  gravarJson(id, 'naoquer', n);
}
/** a loja desfez na ficha do cliente ("Voltou a aceitar"): o número dele sai da lista de quem respondeu "parar" */
function voltouAAceitar(id, cpf) {
  const n = porChave(lerJson(id, 'naoquer'));
  const dele = new Set(Object.values(lerPreparo(id)).map((p) => p && p.itens && p.itens[cpf] && p.itens[cpf].para).filter(Boolean).map(foneChave));
  let mudou = false;
  for (const [num, e] of Object.entries(n)) if (dele.has(num) || (e && Array.isArray(e.cpfs) && e.cpfs.includes(cpf))) { delete n[num]; mudou = true; }
  if (mudou) gravarJson(id, 'naoquer', n);
}

/**
 * Regra forte do envio manual (decisão do dono): antes de o WhatsApp abrir na tela (Hoje, ficha do cliente, fila de Campanhas),
 * o servidor confere. → null (pode) ou a explicação em português de por que não pode:
 *   pediu para não receber (inclusive "parar" respondido ao robô) · já recebeu mensagem dentro do intervalo da loja (de qualquer
 *   tela, campanha ou do robô) · está na fila de hoje de uma campanha do robô ligado (o robô é quem manda; `campanha` = a própria
 *   campanha da fila manual não conta).
 */
function envioManualBloqueado({ lojaId, cpf, contato, campanha, agora = Date.now(), soOptout = false, para = '' }) {
  const loja = C.get().lojas.find((l) => l.id === lojaId);
  const intervalo = (loja && loja.wppIntervalo) || 21;
  const ct = contato || {};
  const nq = lerJson(lojaId, 'naoquer');
  if (ct.optout || Object.values(nq).some((e) => e && Array.isArray(e.cpfs) && e.cpfs.includes(cpf))) return 'Mensagem não enviada: este cliente pediu para não receber mensagens.';
  // Lista de espera (avisar que o produto chegou, pedido do próprio cliente): só "não quer mensagens" trava
  if (soOptout) return null;
  if (ct.em && agora - Date.parse(ct.em) < intervalo * 864e5) {
    const quando = new Date(ct.em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const ate = new Date(Date.parse(ct.em) + intervalo * 864e5).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const deQuem = ct.por === 'robô' ? 'pelo robô do WhatsApp' : ct.por ? `por ${ct.por}` : '';
    return `Mensagem não enviada: este cliente já recebeu mensagem em ${quando}${deQuem ? ' ' + deQuem : ''}${ct.motivo ? ` (${String(ct.motivo).replace(/^Campanha: /, 'campanha ')})` : ''}. Regra da loja: uma mensagem a cada ${intervalo} dias por cliente — a próxima pode sair a partir de ${ate}.`;
  }
  // o MESMO CELULAR de outro cliente (mãe e filha, casal: CPFs diferentes, um WhatsApp só) já recebeu dentro do intervalo —
  // a trava é pelo número, como no robô (visto pelo dono em 23/11/2026: Giovana recebeu do robô e a Pallomma, no mesmo número, pela equipe no dia seguinte)
  if (NUMERO.test(String(para || ''))) {
    const ja = porChave(lerJson(lojaId, 'enviados'))[foneChave(para)];
    if (ja && ja.cpf !== cpf && agora - Date.parse(ja.em) < intervalo * 864e5) {
      const quando = new Date(ja.em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const ate = new Date(Date.parse(ja.em) + intervalo * 864e5).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      return `Mensagem não enviada: este celular é o mesmo de outro cliente, que já recebeu mensagem nele em ${quando}${ja.por === 'robô' || !ja.por ? ' pelo robô do WhatsApp' : ' por ' + ja.por}. Regra da loja: uma mensagem a cada ${intervalo} dias por número — a próxima pode sair a partir de ${ate}.`;
    }
  }
  if (temEstado(lojaId) && lerEstado(lojaId).ligado && !lerEstado(lojaId).pausa) {
    const c = campanhasDoRobo(CAMP.ler(lojaId)).find((x) => x.id !== campanha && x.rodadas[0].lista.some((it) => it.cpf === cpf && it.st === 'p'));
    if (c) return `Mensagem não enviada: este cliente está na fila do robô do WhatsApp (${c.nome}). O robô envia sozinho; mandar pela equipe também seria mensagem em dobro.`;
  }
  return null;
}

/** envio pela equipe aceito: o número entra no mesmo registro do robô ("enviados"), para a trava valer por número dos dois lados */
function registrarEnvioNumero(lojaId, para, cpf, por, agora = Date.now()) {
  if (!NUMERO.test(String(para || ''))) return;
  const env = porChave(lerJson(lojaId, 'enviados'));
  for (const k of Object.keys(env)) if (agora - Date.parse(env[k].em) > 120 * 864e5) delete env[k];
  env[foneChave(para)] = { em: new Date(agora).toISOString(), cpf, por };
  gravarJson(lojaId, 'enviados', env);
}

/** próximo horário dentro do ritmo "de X a Y segundos" (sorteio; o gerador é injetado nos testes) */
const sortear = (cfg, agora, rnd = Math.random) => agora + (cfg.min + Math.floor(rnd() * (cfg.max - cfg.min + 1))) * 1000;

module.exports = {
  foneChave, porChave, janelaDoDia, agenda, temFuncionamento, MARGEM_FECHA_MIN, MARGEM_ABRE_MIN, SEM_WPP_PAUSA,
  envioManualBloqueado, registrarEnvioNumero, PADRAO, PREPARO_DIAS, ORIGEM_RESPOSTA, ligarNumeroAoCliente, voltouAAceitar, MOTIVOS, NUMERO, fim4, cfgDe, validarCfg, relogio, enviadosHoje, campanhasDoRobo, decidir, proxima, sortear,
  lerEstado, temEstado, mudarEstado, lerContatos, mudarContato, lerPreparo, gravarPreparo, limparPreparo, lerJson, gravarJson,
};
