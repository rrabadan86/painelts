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

const PADRAO = { min: 900, max: 1200, das: '09:00', as: '18:30', dias: [1, 2, 3, 4, 5, 6], teto: 30, falhas: 3 };
const ORIGEM_RESPOSTA = 'respondeu parar pelo WhatsApp'; // fica no contato e na fila: a loja vê de onde veio e pode desfazer
const PREPARO_DIAS = 3; // os valores dos campos ({pontos}, {dias}…) envelhecem: depois disso a lista precisa ser conferida de novo
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const NUMERO = /^55\d{10,11}$/;
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
  return { ok: { min, max, das, as, dias, teto, falhas } };
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
/** mensagens que o robô já mandou hoje pelo número da loja (todas as campanhas) */
const enviadosHoje = (estado, agora) => (estado.dia === relogio(agora).dia ? estado.enviadosDia || 0 : 0);

// ---------- a decisão (conta pura) ----------
const MOTIVOS = {
  sem_servico: 'O robô do WhatsApp não está instalado neste servidor.',
  desconectado: 'O WhatsApp da loja não está conectado.',
  desligado: 'O robô está desligado.',
  pausado: 'O robô está pausado.',
  fora_dia: 'Hoje não é dia de envio.',
  fora_janela: 'Fora do horário de envio.',
  teto: 'O máximo de mensagens de hoje foi atingido. Continua no próximo dia de envio.',
  ritmo: 'Esperando o intervalo entre uma mensagem e outra.',
  sem_campanha: 'Nenhuma campanha está marcada para enviar pelo robô.',
  conferir_lista: 'A lista precisa ser conferida: o painel não conseguiu conferir sozinho. Abra a tela Campanhas (ela confere ao abrir).',
  limite_campanha: 'As campanhas chegaram ao limite de hoje. Continua amanhã.',
  esperando_estoque: 'Só faltam clientes esperando estoque do produto oferecido.',
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
function decidir({ cfg, estado, campanhas, contatos, preparo, naoquer, enviados, intervalo, agora }) {
  const marcar = [];
  const fim = (motivo) => ({ marcar, motivo });
  if (!estado.ligado) return fim('desligado');
  if (estado.pausa) return fim('pausado');
  const r = relogio(agora);
  if (!cfg.dias.includes(r.sem)) return fim('fora_dia');
  if (r.min < hm(cfg.das) || r.min >= hm(cfg.as)) return fim('fora_janela');
  if (enviadosHoje(estado, agora) >= cfg.teto) return fim('teto');
  if (estado.proximoEm && agora < Date.parse(estado.proximoEm)) return fim('ritmo');
  const todasRobo = campanhasDoRobo(campanhas);
  if (!todasRobo.length) return fim('sem_campanha');
  const robos = todasRobo.filter((c) => !M.foraDoPeriodo(c, r.dia)); // só as campanhas dentro do período (início e término)
  if (!robos.length) return fim('fora_periodo');
  contatos = contatos || {}; preparo = preparo || {}; naoquer = naoquer || {}; enviados = enviados || {};
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
    const textos = M.textos(c);
    for (const it of rod.lista) {
      if (it.st !== 'p') continue;
      const b = M.bloqueio(it, contatos[it.cpf], { intervalo, dias, minha, agora });
      if (b) { sai(it, 'x', M.textoBloqueio(b)); continue; }
      if (!prepOk) { conferir = true; break; }
      const p = prep.itens[it.cpf];
      if (!p) { conferir = true; continue; } // entrou na lista depois da última conferência: espera a próxima
      if (p.para && naoquer[p.para]) { sai(it, 'o', ORIGEM_RESPOSTA, { optout: true, para: p.para }); continue; }
      if (p.espera) { estoque = true; continue; } // a mensagem ofereceria produto sem estoque: continua na lista
      if (!NUMERO.test(p.para || '')) { sai(it, 'x', 'sem celular válido'); continue; }
      const ja = enviados[p.para];
      if (ja && ja.cpf !== it.cpf && agora - Date.parse(ja.em) < intervalo * 864e5) { sai(it, 'x', 'mesmo celular de outro cliente que já recebeu'); continue; }
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
  return decidir({
    cfg: cfgDe(loja), estado: lerEstado(lojaId), campanhas: CAMP.ler(lojaId), contatos: lerContatos(lojaId), preparo: lerPreparo(lojaId),
    naoquer: lerJson(lojaId, 'naoquer'), enviados: lerJson(lojaId, 'enviados'), intervalo: loja.wppIntervalo || 21, agora,
  });
}

/** o número que respondeu "parar" era deste cliente (descoberto quando ele chegou na fila) */
function ligarNumeroAoCliente(id, para, cpf) {
  const n = lerJson(id, 'naoquer');
  if (!n[para]) return;
  const e = typeof n[para] === 'object' ? n[para] : { em: String(n[para]), cpfs: [] };
  if (!e.cpfs.includes(cpf)) e.cpfs.push(cpf);
  n[para] = e;
  gravarJson(id, 'naoquer', n);
}
/** a loja desfez na ficha do cliente ("Voltou a aceitar"): o número dele sai da lista de quem respondeu "parar" */
function voltouAAceitar(id, cpf) {
  const n = lerJson(id, 'naoquer');
  const dele = new Set(Object.values(lerPreparo(id)).map((p) => p && p.itens && p.itens[cpf] && p.itens[cpf].para).filter(Boolean));
  let mudou = false;
  for (const [num, e] of Object.entries(n)) if (dele.has(num) || (e && Array.isArray(e.cpfs) && e.cpfs.includes(cpf))) { delete n[num]; mudou = true; }
  if (mudou) gravarJson(id, 'naoquer', n);
}

/** próximo horário dentro do ritmo "de X a Y segundos" (sorteio; o gerador é injetado nos testes) */
const sortear = (cfg, agora, rnd = Math.random) => agora + (cfg.min + Math.floor(rnd() * (cfg.max - cfg.min + 1))) * 1000;

module.exports = {
  PADRAO, PREPARO_DIAS, ORIGEM_RESPOSTA, ligarNumeroAoCliente, voltouAAceitar, MOTIVOS, NUMERO, fim4, cfgDe, validarCfg, relogio, enviadosHoje, campanhasDoRobo, decidir, proxima, sortear,
  lerEstado, temEstado, mudarEstado, lerContatos, mudarContato, lerPreparo, gravarPreparo, limparPreparo, lerJson, gravarJson,
};
