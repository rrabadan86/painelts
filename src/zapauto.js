'use strict';
/**
 * Robô do WhatsApp sem depender de alguém abrir a tela Campanhas: o servidor, sozinho,
 *   1) cria a lista nova da campanha recorrente (semanal/mensal) quando a anterior vence, e
 *   2) renova a "lista conferida" (número e valores dos {campos} de cada pendente — o `preparo` de src/zapfila.js).
 * Só para loja com o robô ligado e campanha marcada "Enviar pelo robô".
 *
 * A conta é A MESMA da tela, sem cópia: este arquivo carrega os próprios arquivos de public/js (core, regras,
 * fidelidade, clientes, validade, campanhas) num contexto isolado do Node, entrega a eles o mesmo pacote de dados que
 * /api/dados manda para o navegador de quem vê tudo, e chama TS.campanhasCalc (public/js/campanhas.js). Quem muda a
 * regra na tela muda aqui junto. O contexto não tem rede nem página: `fetch` só responde a leitura do estoque.
 *
 * Rede de segurança: a lista conferida continua valendo 3 dias (ZF.PREPARO_DIAS). Se esta tarefa falhar por 3 dias,
 * o robô para com "a lista precisa ser conferida" — nunca envia com valores velhos.
 * Privacidade: nada de cliente vai para log nem auditoria (só contagens e o nome da campanha).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const C = require('./config');
const CAMP = require('./campanhas');
const ZF = require('./zapfila');

const POR = 'robô';
// ordem do pacote da tela (APP_SCRIPTS, server.js): só os arquivos de que a conta precisa
const ARQUIVOS = ['core.js', 'contas.js', 'rules.js', 'fidelidade.js', 'msgwpp.js', 'clientes.js', 'campanhas.js', 'validade.js'];
const PUB = path.join(__dirname, '..', 'public', 'js');
const scripts = new Map(); // arquivo → { mtime, script }
function script(nome) {
  const arq = path.join(PUB, nome), mtime = fs.statSync(arq).mtimeMs;
  const c = scripts.get(nome);
  if (c && c.mtime === mtime) return c.script;
  const s = new vm.Script(fs.readFileSync(arq, 'utf8'), { filename: 'public/js/' + nome });
  scripts.set(nome, { mtime, script: s });
  return s;
}

/**
 * Monta "a tela" no servidor para uma loja. → { listaDe(filtros) → [{ cpf, nome }], itens(campanha) → Promise<[{ cpf, para, v, espera? }]> }
 *   corpo      texto JSON do pacote de dados da loja (o de /api/dados para quem vê tudo, histórico completo)
 *   contatos   dados/<loja>/contatos.json (quem foi contatado / não quer mensagens)
 *   disponivel () → o que /api/estoque/disponivel devolve (trava de estoque); se falhar, quem receberia oferta espera
 *   validade   () → { lotes: [{ desc, dias }] } (Campanha Resumo diário: chá perto da validade); sem ela, o motivo fica de fora
 *   agora      relógio (ms) — a tela usa "hoje" em várias contas ({dias}, aniversário, quem foi contatado há pouco)
 */
function tela({ loja, corpo, contatos, disponivel, validade, agora = Date.now() }) {
  const caixa = {
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URLSearchParams, __agora: agora,
    __disp: async () => JSON.stringify(await disponivel(loja.id)), // falhou: a tela trata como "estoque não conferido"
    __val: async () => { if (!validade) throw new Error('sem validade'); return JSON.stringify(await validade(loja.id)); },
  };
  const ctx = vm.createContext(caixa);
  // relógio injetado: `new Date()` e `Date.now()` dos arquivos da tela passam a ser o `agora` desta conferência.
  // Tudo entra e sai do contexto como texto JSON (nenhum objeto do servidor fica ao alcance dos arquivos da tela).
  vm.runInContext(`
    var window = globalThis; var location = { pathname: '/', hash: '' };
    (function () {
      var D = Date, t = __agora;
      globalThis.Date = class extends D { constructor(...a) { if (a.length) super(...a); else super(t); } static now() { return t; } };
    })();
    globalThis.fetch = async function (url) {
      const u = String(url);
      if (u.indexOf('/api/estoque/disponivel?') !== 0 && u.indexOf('/api/validade?') !== 0) throw new Error('sem rede no servidor');
      const s = u.indexOf('/api/validade?') === 0 ? await __val() : await __disp();
      return { ok: true, status: 200, json: async () => JSON.parse(s) };
    };`, ctx);
  for (const f of ARQUIVOS) {
    script(f).runInContext(ctx);
    if (f === 'core.js') vm.runInContext('TS.pages = TS.pages || {};', ctx); // as telas se registram aqui (ninguém as abre)
  }
  // os mesmos passos de main.js ao receber os dados: decodificar, preparar as regras e o índice de clientes
  vm.runInContext(`(function (corpo, loja, contatos) {
    loja = JSON.parse(loja);
    TS.state.loja = loja.id;
    TS.lojas = [loja];
    TS.db = TS.decode(JSON.parse(corpo));
    TS.rules.prepare();
    TS.prepararClientes();
    TS.cli.contatos = JSON.parse(contatos);
    TS.cli.contatosLoja = loja.id;
  })`, ctx)(String(corpo), JSON.stringify({ id: loja.id, nome: loja.nome }),
    JSON.stringify(Object.fromEntries(Object.entries(contatos || {}).map(([cpf, c]) => [cpf, { ...c, loja: loja.id }]))));
  const chamar = (codigo, ...args) => vm.runInContext(codigo, ctx)(...args.map((a) => JSON.stringify(a)));
  return {
    listaDe: (filtros) => JSON.parse(chamar('(f) => JSON.stringify(TS.campanhasCalc.listaDe(JSON.parse(f)))', filtros || {})),
    /** a lista nova de uma campanha (a Campanha Resumo diário lê a validade e o estoque, como na tela) */
    async lista(filtros) {
      return JSON.parse(await chamar('async (f, l) => JSON.stringify(await TS.campanhasCalc.listaAgora(JSON.parse(f), JSON.parse(l)))', filtros || {}, loja.id));
    },
    async itens(camp) {
      const s = await chamar(`async (camp, lojaId) => {
        let disp = null;
        try { disp = await TS.estoqueDisp(JSON.parse(lojaId)); } catch { /* sem leitura do estoque: quem receberia oferta de produto espera */ }
        return JSON.stringify(TS.campanhasCalc.itensPreparo(JSON.parse(camp), disp));
      }`, camp, loja.id);
      return JSON.parse(s);
    },
  };
}

/**
 * Confere uma loja agora: lista nova das recorrentes vencidas + lista conferida de cada campanha do robô.
 * → { campanhas, rodadas: [nomes das que ganharam lista nova], clientes } ou { motivo } quando não há o que fazer.
 *   deps.corpo(loja) → Promise<{ sig, json() }> · deps.disponivel(lojaId) → itens do estoque (pode ser async)
 */
async function conferir(lojaId, agora = Date.now(), deps) {
  const loja = C.get().lojas.find((l) => l.id === lojaId);
  if (!loja || !ZF.temEstado(lojaId) || !ZF.lerEstado(lojaId).ligado) return { motivo: 'desligado' };
  if (!ZF.campanhasDoRobo(CAMP.ler(lojaId)).length) return { motivo: 'sem_campanha' };
  const d = await deps.corpo(loja);
  const t = tela({ loja, corpo: d.json(), contatos: ZF.lerContatos(lojaId), disponivel: deps.disponivel, validade: deps.validade, agora });
  const rodadas = [];
  let clientes = 0, campanhas = 0;
  // relê a cada passo: a tela (ou o laço de envio) pode ter mexido nas campanhas enquanto os dados carregavam
  for (const { id } of ZF.campanhasDoRobo(CAMP.ler(lojaId))) {
    let c = CAMP.ler(lojaId).find((x) => x.id === id);
    if (!c || c.robo !== true || c.ativa === false) continue;
    if (c.recorrente && !CAMP.rodadaEmDia(c, agora)) {
      const r = CAMP.novaRodada(lojaId, id, await t.lista(c.filtros), POR, agora);
      if (r.erro) throw new Error(r.erro);
      c = r.ok;
      if (!r.repetida) {
        rodadas.push(c.nome);
        C.auditar(POR, 'criou lista nova da campanha recorrente', lojaId, { loja: lojaId, campanha: c.nome, clientes: c.rodadas[0].lista.length });
      }
    }
    const g = ZF.gravarPreparo(lojaId, id, await t.itens(c), POR, agora);
    if (g.erro) throw new Error(g.erro);
    clientes += g.ok.clientes; campanhas++;
  }
  return { campanhas, rodadas, clientes, sig: d.sig };
}

// ---------- a tarefa: quando os dados da loja mudam ou o dia vira, no máximo uma vez por hora por loja ----------
const HORA = 3600e3;
const feito = new Map(); // loja → { em, dia, sig, ok }
/** falta a lista conferida de alguma campanha do robô (mensagem editada, campanha recém-marcada, lista nova)? */
function faltaPreparo(lojaId, agora) {
  const prep = ZF.lerPreparo(lojaId);
  return ZF.campanhasDoRobo(CAMP.ler(lojaId)).some((c) => {
    const p = prep[c.id];
    return !(p && p.rodada === c.rodadas[0].id) || (c.recorrente && !CAMP.rodadaEmDia(c, agora));
  });
}
/** um passo da tarefa para uma loja → { rodou, ... } (os testes chamam direto, com relógio e dados de mentira) */
async function passo(lojaId, agora, deps) {
  const loja = C.get().lojas.find((l) => l.id === lojaId);
  if (!loja || !ZF.temEstado(lojaId) || !ZF.lerEstado(lojaId).ligado) { feito.delete(lojaId); return { rodou: false, motivo: 'desligado' }; }
  if (!ZF.campanhasDoRobo(CAMP.ler(lojaId)).length) return { rodou: false, motivo: 'sem_campanha' };
  const f = feito.get(lojaId);
  if (f && agora - f.em < HORA) return { rodou: false, motivo: 'ha_pouco' }; // no máximo 1× por hora (também depois de falha)
  const dia = C.diaSP(agora);
  if (f && f.ok && f.dia === dia && !faltaPreparo(lojaId, agora)) {
    // mesmo dia e nada faltando: só refaz se os dados da loja mudaram (coleta nova)
    let sig = null;
    try { sig = (await deps.corpo(loja)).sig; } catch { /* sem dados agora: tenta na próxima hora */ }
    if (sig === f.sig) { f.em = agora; return { rodou: false, motivo: 'sem_mudanca' }; }
  }
  try {
    const r = await conferir(lojaId, agora, deps);
    feito.set(lojaId, { em: agora, dia, sig: r.sig || null, ok: true });
    ZF.mudarEstado(lojaId, (s) => { s.auto = { em: new Date(agora).toISOString(), ok: true }; });
    return { rodou: true, ...r };
  } catch (e) {
    // falhou: fica o que já estava conferido (vale 3 dias); passado o prazo o robô para e avisa
    feito.set(lojaId, { em: agora, dia, sig: null, ok: false });
    ZF.mudarEstado(lojaId, (s) => { s.auto = { em: new Date(agora).toISOString(), ok: false }; });
    console.error(`[zap] ${lojaId}: não consegui conferir a lista sozinho:`, C.msgErro(e));
    return { rodou: true, erro: true };
  }
}

let rodando = false;
async function rodada(deps, agora = Date.now()) {
  if (rodando) return;
  rodando = true;
  try { for (const l of C.get().lojas) await passo(l.id, agora, deps); } finally { rodando = false; }
}
/** liga a tarefa (server.js): confere 2 minutos depois de subir e de 5 em 5 minutos vê se alguma loja precisa */
function iniciar(deps) {
  if (!require('./zap').ativo()) return null; // sem o serviço do robô nada roda
  const quieto = () => rodada(deps).catch((e) => console.error('[zap] conferência automática:', C.msgErro(e)));
  setTimeout(quieto, 2 * 60e3).unref();
  const t = setInterval(quieto, 5 * 60e3);
  t.unref();
  return t;
}

module.exports = { ARQUIVOS, tela, conferir, passo, rodada, iniciar, _esquecer: () => feito.clear() };
