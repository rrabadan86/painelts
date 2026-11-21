'use strict';
// Robô do WhatsApp das campanhas: a fila (todas as travas ficam no servidor) e o laço de envio, com um robô de mentira.
// Nada sai daqui: o "serviço zap" é um objeto (ou um servidor HTTP local) que só anota o que recebeu.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: [{ id: 'l1', nome: 'Loja Um', wppIntervalo: 21 }], usuarios: {} }));
const C = require('../../src/config');
const CAMP = require('../../src/campanhas');
const ZF = require('../../src/zapfila');
const ZL = require('../../src/zaplaco');
const M = require('../../public/js/msgwpp');
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

// quarta-feira, 4 de março de 2026, 10:00 em Brasília
const QUARTA_10H = Date.parse('2026-03-04T13:00:00Z');
const DIA = 864e5, MIN = 60e3;
const CPF = ['11111111111', '22222222222', '33333333333', '44444444444'];
const NUM = ['5562911110001', '5562911110002', '5562911110003', '5562911110004'];
const valores = (nome) => ({ nome, nomecompleto: nome + ' Silva', loja: 'Loja Um', cha: 'Earl Grey', ultimocha: 'Sencha', pacote: '100g', vendedora: 'Ana', pontos: '1.250', vence: '31/03/2026', vencepts: '300', ultimacompra: '10/01/2026', dias: '53', aniversario: '12/05', visitas: '8' });
const camp = (id, o = {}) => ({ id, nome: 'Pontos ' + id, mensagem: '{saudacao}, {nome}! Você tem {pontos} pontos na {loja}.', variacoes: [], limiteDia: 20, janela: 30, recorrente: '', ativa: true, robo: true, filtros: {}, criadaEm: '2026-03-01T12:00:00.000Z',
  rodadas: [{ id: 'r' + id, em: '2026-03-01T12:00:00.000Z', lista: CPF.slice(0, 3).map((cpf, k) => ({ cpf, nome: 'Cliente ' + (k + 1), st: 'p' })) }], ...o });
const prep = (c, agora = QUARTA_10H, mudar = {}) => ({ em: new Date(agora - 3600e3).toISOString(), por: 'dono', rodada: c.rodadas[0].id,
  itens: Object.fromEntries(c.rodadas[0].lista.map((it) => { const k = CPF.indexOf(it.cpf); return [it.cpf, { para: NUM[k], v: valores('Cliente' + (k + 1)), ...(mudar[it.cpf] || {}) }]; })) });
/** tudo certo para enviar: ligado, quarta às 10h, uma campanha do robô com três pendentes conferidos */
const cena = (o = {}) => {
  const c = camp('a');
  return { cfg: { ...ZF.PADRAO }, estado: { ligado: true, pausa: null, proximoEm: null, dia: null, enviadosDia: 0 }, campanhas: [c], contatos: {}, preparo: { a: prep(c) }, naoquer: {}, enviados: {}, intervalo: 21, agora: QUARTA_10H, ...o };
};

// ---------- a fila: conta pura ----------
test('envia para o primeiro pendente, com o texto e o número iguais aos do envio manual', () => {
  const s = cena();
  const d = ZF.decidir(s);
  assert.deepStrictEqual(d.marcar, []);
  assert.strictEqual(d.msg.cliente.cpf, CPF[0]);
  assert.strictEqual(d.msg.para, NUM[0]);
  assert.strictEqual(d.msg.texto, 'Bom dia, Cliente1! Você tem 1.250 pontos na Loja Um.');
  // o envio manual monta com a mesma função e os mesmos valores (clientes.js → TS.msgWpp.montar)
  assert.strictEqual(d.msg.texto, M.montar(s.campanhas[0].mensagem, { ...valores('Cliente1'), saudacao: 'Bom dia' }, M.extras(s.campanhas[0])));
  assert.strictEqual(d.msg.id, 'a-ra-' + CPF[0]);
  assert.strictEqual(d.msg.v, null);
});

test('a tela usa a mesma montagem: clientes.js e campanhas.js chamam o módulo comum', () => {
  const cli = fs.readFileSync(path.join(__dirname, '../../public/js/clientes.js'), 'utf8');
  const cp = fs.readFileSync(path.join(__dirname, '../../public/js/campanhas.js'), 'utf8');
  assert.match(cli, /const textoWpp = \(modelo, c\) => TS\.msgWpp\.montar\(modelo\.texto, valoresWpp\(c\)\)/);
  assert.match(cli, /texto: \(txt, c, extra = \{\}\) => TS\.msgWpp\.montar\(txt, valoresWpp\(c\), extra\)/);
  assert.match(cp, /TS\.msgWpp\.bloqueio\(/);
  assert.match(cp, /TS\.msgWpp\.variacaoDaVez\(/);
  // a conta antiga da tela (regex + espaços duplos + extras) dá o mesmo resultado
  const antiga = (texto, v, extra) => { let t = texto.replace(/\{([a-z]+)\}/g, (m, k) => (k in v ? v[k] : m)).replace(/ {2,}/g, ' '); for (const [k, x] of Object.entries(extra)) t = t.split('{' + k + '}').join(x); return t; };
  const v = { ...valores('Bia'), pacote: '', saudacao: 'Boa tarde' };
  for (const t of ['Oi, {nome}! Leve {pacote}  de {cha}.', '{saudacao}, {nomecompleto}: {produto} chegou. {naoexiste}', 'Sem campos', '{pontos} pts vencem em {vence} ({vencepts})'])
    assert.strictEqual(M.montar(t, v, { produto: 'Sencha 100G' }), antiga(t, v, { produto: 'Sencha 100G' }));
});

test('telefone: o número do robô sai do mesmo link wa.me do envio manual', () => {
  assert.strictEqual(M.paraDoLink(M.linkDoCelular('(62) 99999-8888')), '5562999998888');
  assert.strictEqual(M.paraDoLink(M.linkDoCelular('5562999998888')), '5562999998888');
  assert.strictEqual(M.paraDoLink(M.linkDoCelular('6233334444')), '556233334444');
  assert.strictEqual(M.linkDoCelular('99998888'), null, 'sem DDD não tem link');
  assert.strictEqual(M.paraDoLink('#demo'), null, 'na apresentação não há número');
  assert.strictEqual(M.paraDoLink(null), null);
});

test('saudação pela hora de Brasília e {produto} pelos critérios da campanha', () => {
  const c = camp('a', { mensagem: '{saudacao}! Chegou {produto}.', filtros: { produtos: ['Sencha 100G', '~earl grey'] } });
  const tarde = QUARTA_10H + 5 * 3600e3; // 15:00
  const d = ZF.decidir(cena({ campanhas: [c], preparo: { a: prep(c, tarde) }, agora: tarde }));
  assert.strictEqual(d.msg.texto, 'Boa tarde! Chegou Sencha 100G e earl grey.');
});

test('desligado ou pausado: não envia', () => {
  assert.strictEqual(ZF.decidir(cena({ estado: { ligado: false } })).motivo, 'desligado');
  const d = ZF.decidir(cena({ estado: { ligado: true, pausa: { auto: true, em: 'x' } } }));
  assert.strictEqual(d.motivo, 'pausado');
  assert.strictEqual(d.msg, undefined);
});

test('janela: fora dos dias e do horário não envia (horário de Brasília)', () => {
  const domingo = QUARTA_10H - 3 * DIA;
  assert.strictEqual(ZF.decidir(cena({ agora: domingo })).motivo, 'fora_dia');
  assert.strictEqual(ZF.decidir(cena({ agora: QUARTA_10H - 61 * MIN })).motivo, 'fora_janela', '08:59');
  assert.ok(ZF.decidir(cena({ agora: QUARTA_10H - 60 * MIN })).msg, '09:00 já vale');
  const c = camp('a');
  const fim = QUARTA_10H + 8 * 3600e3 + 30 * MIN; // 18:30
  assert.strictEqual(ZF.decidir(cena({ agora: fim, campanhas: [c], preparo: { a: prep(c, fim) } })).motivo, 'fora_janela', '18:30 já não vale');
  assert.ok(ZF.decidir(cena({ agora: fim - MIN, campanhas: [c], preparo: { a: prep(c, fim) } })).msg, '18:29 ainda vale');
  assert.strictEqual(ZF.decidir(cena({ cfg: { ...ZF.PADRAO, dias: [0, 6] } })).motivo, 'fora_dia', 'quarta fora dos dias escolhidos');
});

test('teto do número por dia: para no limite e zera na virada do dia', () => {
  assert.strictEqual(ZF.decidir(cena({ estado: { ligado: true, dia: '2026-03-04', enviadosDia: 30 } })).motivo, 'teto');
  assert.ok(ZF.decidir(cena({ estado: { ligado: true, dia: '2026-03-04', enviadosDia: 29 } })).msg);
  assert.ok(ZF.decidir(cena({ estado: { ligado: true, dia: '2026-03-03', enviadosDia: 30 } })).msg, 'o que foi enviado ontem não conta hoje');
  assert.strictEqual(ZF.enviadosHoje({ dia: '2026-03-03', enviadosDia: 30 }, QUARTA_10H), 0);
  // 23:30 de terça em Brasília ainda é terça (02:30 UTC de quarta)
  assert.strictEqual(ZF.relogio(Date.parse('2026-03-04T02:30:00Z')).dia, '2026-03-03');
});

test('ritmo: espera o horário sorteado; o sorteio fica sempre entre o mínimo e o máximo', () => {
  assert.strictEqual(ZF.decidir(cena({ estado: { ligado: true, proximoEm: new Date(QUARTA_10H + 1000).toISOString() } })).motivo, 'ritmo');
  assert.ok(ZF.decidir(cena({ estado: { ligado: true, proximoEm: new Date(QUARTA_10H).toISOString() } })).msg);
  const cfg = { ...ZF.PADRAO, min: 900, max: 1200 };
  assert.strictEqual(ZF.sortear(cfg, 0, () => 0), 900e3);
  assert.strictEqual(ZF.sortear(cfg, 0, () => 0.999999), 1200e3);
  assert.strictEqual(ZF.sortear(cfg, 0, () => 0.5), 1050e3);
  assert.strictEqual(ZF.sortear({ ...cfg, min: 60, max: 60 }, 5000, () => 0.7), 65000);
  for (let k = 0; k < 200; k++) { const t = ZF.sortear(cfg, 0); assert.ok(t >= 900e3 && t <= 1200e3); }
});

test('quem pediu para não receber sai da fila e o robô segue para o próximo', () => {
  const d = ZF.decidir(cena({ contatos: { [CPF[0]]: { optout: true } } }));
  assert.deepStrictEqual(d.marcar, [{ campanha: 'a', rodada: 'ra', cpf: CPF[0], st: 'x', motivo: 'não quer mensagens' }]);
  assert.strictEqual(d.msg.cliente.cpf, CPF[1]);
});

test('intervalo da loja vale no servidor: quem recebeu há pouco não recebe de novo', () => {
  const ha = (dias, motivo) => ({ [CPF[0]]: { em: new Date(QUARTA_10H - dias * DIA).toISOString(), por: 'ana', motivo } });
  let d = ZF.decidir(cena({ contatos: ha(5, 'Hoje') }));
  assert.strictEqual(d.marcar[0].st, 'x');
  assert.match(d.marcar[0].motivo, /^já recebeu em 27\/02\/2026 \(Hoje\)$/);
  assert.strictEqual(d.msg.cliente.cpf, CPF[1]);
  assert.strictEqual(ZF.decidir(cena({ contatos: ha(22, 'Hoje') })).msg.cliente.cpf, CPF[0], 'passou o intervalo');
  assert.strictEqual(ZF.decidir(cena({ contatos: ha(20.9, 'Hoje'), intervalo: 21 })).msg.cliente.cpf, CPF[1]);
  // prazo maior pedido na campanha (60 dias): vale para mensagem de outra origem, não para a própria campanha nem para o liberado
  const c = camp('a', { filtros: { semContato: 60 } });
  const com = (contatos, lista) => { const cc = { ...c, rodadas: [{ ...c.rodadas[0], lista: lista || c.rodadas[0].lista }] }; return ZF.decidir(cena({ campanhas: [cc], preparo: { a: prep(cc) }, contatos })); };
  assert.strictEqual(com(ha(40, 'Hoje')).msg.cliente.cpf, CPF[1]);
  assert.strictEqual(com(ha(40, M.motivoCampanha(c.nome))).msg.cliente.cpf, CPF[0]);
  assert.strictEqual(com(ha(40, 'Hoje'), [{ cpf: CPF[0], nome: 'A', st: 'p', liberado: true }]).msg.cliente.cpf, CPF[0]);
  // mesmo liberado à mão, o intervalo da loja continua valendo
  assert.strictEqual(com(ha(5, 'Hoje'), [{ cpf: CPF[0], nome: 'A', st: 'p', liberado: true }]).msg, undefined);
});

test('só campanhas ativas marcadas para o robô; enviado e pulado não recebem de novo', () => {
  assert.strictEqual(ZF.decidir(cena({ campanhas: [camp('a', { robo: false })] })).motivo, 'sem_campanha');
  assert.strictEqual(ZF.decidir(cena({ campanhas: [camp('a', { robo: undefined })] })).motivo, 'sem_campanha', 'padrão desligado');
  assert.strictEqual(ZF.decidir(cena({ campanhas: [camp('a', { ativa: false })] })).motivo, 'sem_campanha');
  const c = camp('a');
  c.rodadas[0].lista[0].st = 'e'; c.rodadas[0].lista[1].st = 'x';
  assert.strictEqual(ZF.decidir(cena({ campanhas: [c] })).msg.cliente.cpf, CPF[2]);
  c.rodadas[0].lista[2].st = 'o';
  assert.strictEqual(ZF.decidir(cena({ campanhas: [c] })).motivo, 'sem_pendentes');
});

test('grupo de comparação (st "c"): o robô nunca envia, não conta como pendente e não entra na lista conferida', () => {
  const c = camp('a');
  c.rodadas[0].lista[0].st = 'c'; c.rodadas[0].lista[0].em = c.rodadas[0].em; // o primeiro da fila foi sorteado para ficar sem mensagem
  const d = ZF.decidir(cena({ campanhas: [c] }));
  assert.strictEqual(d.msg.cliente.cpf, CPF[1], 'pula o cliente da comparação e segue para o próximo pendente');
  assert.deepStrictEqual(d.marcar, [], 'não marca o cliente da comparação como pulado');
  // só sobraram clientes da comparação: não há pendentes (nem "conferir a lista")
  c.rodadas[0].lista[1].st = 'e'; c.rodadas[0].lista[2].st = 'c';
  assert.strictEqual(ZF.decidir(cena({ campanhas: [c] })).motivo, 'sem_pendentes');
  assert.strictEqual(ZF.decidir(cena({ campanhas: [c], preparo: {} })).motivo, 'sem_pendentes');
  // a lista conferida só guarda pendentes: quem é da comparação fica de fora mesmo que a tela mande
  CAMP.criar('l1', { nome: 'Comparar', mensagem: 'Oi {nome}', robo: true, comparar: false, lista: CPF.slice(0, 3).map((cpf) => ({ cpf, nome: 'x' })) }, 'dono');
  const todas = CAMP.ler('l1'), nova = todas[0];
  nova.rodadas[0].lista[0].st = 'c';
  fs.writeFileSync(path.join(C.pastaLoja('l1'), 'campanhas.json'), JSON.stringify(todas));
  const g = ZF.gravarPreparo('l1', nova.id, CPF.slice(0, 3).map((cpf, k) => ({ cpf, para: NUM[k], v: valores('C' + k) })), 'dono');
  assert.strictEqual(g.ok.clientes, 2);
  assert.ok(!ZF.lerPreparo('l1')[nova.id].itens[CPF[0]]);
  // e o cliente da comparação não pode ser marcado como enviado pela rota de marcar
  assert.match(CAMP.marcar('l1', nova.id, nova.rodadas[0].id, CPF[0], 'e', 'robô').erro, /grupo de comparação/);
  CAMP.apagar('l1', nova.id);
});

test('duas campanhas: acabou uma (ou bateu o limite dela), passa para a próxima, sempre na mesma ordem', () => {
  const nova = camp('b', { criadaEm: '2026-03-02T12:00:00.000Z', rodadas: [{ id: 'rb', em: '2026-03-02T12:00:00.000Z', lista: [{ cpf: CPF[3], nome: 'Cliente 4', st: 'p' }] }] });
  const velha = camp('a');
  const preparo = { a: prep(velha), b: prep(nova) };
  assert.strictEqual(ZF.decidir(cena({ campanhas: [nova, velha], preparo })).msg.campanha, 'a', 'a mais antiga primeiro, em qualquer ordem do arquivo');
  assert.strictEqual(ZF.decidir(cena({ campanhas: [velha, nova], preparo })).msg.campanha, 'a');
  // limite por dia da campanha (1): com um envio hoje, ela espera e a outra segue
  const noLimite = camp('a', { limiteDia: 1 });
  Object.assign(noLimite.rodadas[0].lista[0], { st: 'e', em: new Date(QUARTA_10H - 3600e3).toISOString(), por: 'robô' });
  let d = ZF.decidir(cena({ campanhas: [noLimite, nova], preparo }));
  assert.strictEqual(d.msg.campanha, 'b');
  assert.strictEqual(d.msg.cliente.cpf, CPF[3]);
  // o envio de ontem não conta no limite de hoje
  noLimite.rodadas[0].lista[0].em = new Date(QUARTA_10H - DIA).toISOString();
  assert.strictEqual(ZF.decidir(cena({ campanhas: [noLimite, nova], preparo })).msg.campanha, 'a');
  // sem a segunda campanha: o motivo é o limite
  noLimite.rodadas[0].lista[0].em = new Date(QUARTA_10H - 3600e3).toISOString();
  assert.strictEqual(ZF.decidir(cena({ campanhas: [noLimite], preparo })).motivo, 'limite_campanha');
  // primeira campanha terminada: vai para a segunda
  const feita = camp('a');
  feita.rodadas[0].lista.forEach((x) => { x.st = 'e'; x.em = new Date(QUARTA_10H - 5 * DIA).toISOString(); });
  assert.strictEqual(ZF.decidir(cena({ campanhas: [feita, nova], preparo })).msg.campanha, 'b');
});

test('variações: rodízio pela quantidade já enviada, como na fila manual', () => {
  const c = camp('a', { variacoes: ['Segunda versão, {nome}.'] });
  assert.strictEqual(ZF.decidir(cena({ campanhas: [c] })).msg.v, 0);
  c.rodadas[0].lista[0].st = 'e'; c.rodadas[0].lista[0].em = new Date(QUARTA_10H - 30 * DIA).toISOString();
  const d = ZF.decidir(cena({ campanhas: [c] }));
  assert.strictEqual(d.msg.v, 1);
  assert.strictEqual(d.msg.texto, 'Segunda versão, Cliente2.');
});

test('lista sem conferência, vencida ou de outra rodada: não envia e pede para conferir', () => {
  assert.strictEqual(ZF.decidir(cena({ preparo: {} })).motivo, 'conferir_lista');
  const c = camp('a');
  assert.strictEqual(ZF.decidir(cena({ preparo: { a: prep(c, QUARTA_10H - ZF.PREPARO_DIAS * DIA) } })).motivo, 'conferir_lista', 'conferida há mais de 3 dias');
  assert.strictEqual(ZF.decidir(cena({ preparo: { a: { ...prep(c), rodada: 'outra' } } })).motivo, 'conferir_lista');
  // cliente que entrou na lista depois da conferência espera; os outros seguem
  const p = prep(c); delete p.itens[CPF[0]];
  const d = ZF.decidir(cena({ preparo: { a: p } }));
  assert.strictEqual(d.msg.cliente.cpf, CPF[1]);
  assert.deepStrictEqual(d.marcar, []);
});

test('telefone inválido: marca e segue; esperando estoque: fica na lista sem enviar', () => {
  const c = camp('a');
  let d = ZF.decidir(cena({ preparo: { a: prep(c, QUARTA_10H, { [CPF[0]]: { para: null }, [CPF[1]]: { para: '62999' } }) } }));
  assert.deepStrictEqual(d.marcar.map((m) => [m.cpf, m.st, m.motivo]), [[CPF[0], 'x', 'sem celular válido'], [CPF[1], 'x', 'sem celular válido']]);
  assert.strictEqual(d.msg.cliente.cpf, CPF[2]);
  const todos = Object.fromEntries(CPF.slice(0, 3).map((cpf) => [cpf, { espera: 'Sencha 100G' }]));
  d = ZF.decidir(cena({ preparo: { a: prep(c, QUARTA_10H, todos) } }));
  assert.deepStrictEqual(d.marcar, []);
  assert.strictEqual(d.motivo, 'esperando_estoque');
});

test('número que respondeu "parar" e celular repetido em outro cliente: não recebem', () => {
  let d = ZF.decidir(cena({ naoquer: { [NUM[0]]: '2026-03-03T12:00:00.000Z' } }));
  assert.deepStrictEqual(d.marcar, [{ campanha: 'a', rodada: 'ra', cpf: CPF[0], st: 'o', motivo: 'respondeu parar pelo WhatsApp', optout: true, para: NUM[0] }]);
  assert.strictEqual(d.msg.cliente.cpf, CPF[1]);
  d = ZF.decidir(cena({ enviados: { [NUM[0]]: { em: new Date(QUARTA_10H - 2 * DIA).toISOString(), cpf: '99999999999' } } }));
  assert.strictEqual(d.marcar[0].motivo, 'mesmo celular de outro cliente que já recebeu');
  assert.strictEqual(d.msg.cliente.cpf, CPF[1]);
});

test('configuração: valida ritmo, horário, dias, teto e falhas', () => {
  const ok = (o) => ZF.validarCfg({ ...ZF.PADRAO, ...o });
  assert.deepStrictEqual(ok({}).ok, ZF.PADRAO);
  assert.deepStrictEqual(ZF.PADRAO, { min: 900, max: 1200, das: '09:00', as: '18:30', dias: [1, 2, 3, 4, 5, 6], teto: 30, falhas: 3 });
  for (const ruim of [{ min: 59 }, { max: 7201 }, { min: 1300, max: 1200 }, { min: 'abc' }, { min: 90.5 }, { das: '9:00' }, { as: '24:00' }, { das: '18:30', as: '09:00' }, { das: '10:00', as: '10:00' },
    { dias: [] }, { dias: [7] }, { dias: 'seg' }, { teto: 0 }, { teto: 201 }, { falhas: 0 }, { falhas: 11 }]) assert.ok(ok(ruim).erro, JSON.stringify(ruim));
  assert.deepStrictEqual(ok({ min: 60, max: 7200, dias: [6, 0, 0], teto: 200, falhas: 10 }).ok, { ...ZF.PADRAO, min: 60, max: 7200, dias: [0, 6], teto: 200, falhas: 10 });
  assert.deepStrictEqual(ok({ min: '300', max: '300', teto: '1' }).ok, { ...ZF.PADRAO, min: 300, max: 300, teto: 1 });
  // configuração estragada no arquivo: volta ao padrão seguro
  assert.deepStrictEqual(ZF.cfgDe({ zap: { min: 1, max: 2 } }), ZF.PADRAO);
  assert.deepStrictEqual(ZF.cfgDe({ zap: { teto: 10 } }), { ...ZF.PADRAO, teto: 10 });
});

// ---------- o laço, com um robô de mentira ----------
function roboDeMentira(o = {}) {
  const z = { enviados: [], chamadas: [], estado: 'conectado', resposta: () => ({ ok: true, idMsg: 'm1' }), saidas: [], ligado: true, ...o };
  z.ativo = () => z.ligado;
  z.status = async () => { z.chamadas.push('status'); return { estado: z.estado, numeroFim: '8888' }; };
  z.enviar = async (loja, msg) => { z.chamadas.push('enviar'); z.enviados.push({ loja, ...msg }); const r = z.resposta(msg); if (r instanceof Error) throw r; return r; };
  z.optouts = async () => { z.chamadas.push('optouts'); return { itens: z.saidas }; };
  return z;
}
let criada;
function montarLoja(o = {}) {
  fs.rmSync(path.join(tmp, 'l1'), { recursive: true, force: true });
  const r = CAMP.criar('l1', { nome: 'Pontos', mensagem: 'Oi, {nome}! Você tem {pontos} pontos.', robo: true, limiteDia: 20, lista: CPF.slice(0, 3).map((cpf, k) => ({ cpf, nome: 'Cliente ' + (k + 1) })), ...o }, 'dono');
  criada = r.ok;
  ZF.gravarPreparo('l1', criada.id, CPF.slice(0, 3).map((cpf, k) => ({ cpf, para: NUM[k], v: valores('Cliente' + (k + 1)) })), 'dono', QUARTA_10H - 3600e3);
  ZF.mudarEstado('l1', (s) => { s.ligado = true; s.sessao = true; });
}
const itemDe = (cpf) => CAMP.ler('l1')[0].rodadas[0].lista.find((x) => x.cpf === cpf);
const auditoria = () => C.lerAuditoria(200).map((x) => x.acao);
beforeEach(() => montarLoja());

test('laço: envia uma mensagem, grava na campanha como o envio manual (por: robô) e sorteia o próximo horário', async () => {
  const zap = roboDeMentira();
  const r = await ZL.passo('l1', QUARTA_10H, { zap, rnd: () => 0 });
  assert.strictEqual(r.enviou, true);
  assert.deepStrictEqual(zap.enviados, [{ loja: 'l1', id: `${criada.id}-${criada.rodadas[0].id}-${CPF[0]}`, campanha: criada.id, nome: 'Pontos', rodada: criada.rodadas[0].id, cliente: { cpf: CPF[0], nome: 'Cliente 1' }, para: NUM[0], texto: 'Oi, Cliente1! Você tem 1.250 pontos.', v: null }]);
  const it = itemDe(CPF[0]);
  assert.strictEqual(it.st, 'e'); assert.strictEqual(it.por, 'robô'); assert.ok(it.em);
  const ct = ZF.lerContatos('l1')[CPF[0]];
  assert.strictEqual(ct.por, 'robô'); assert.strictEqual(ct.motivo, 'Campanha: Pontos');
  const e = ZF.lerEstado('l1');
  assert.strictEqual(e.enviadosDia, 1); assert.strictEqual(e.dia, '2026-03-04'); assert.strictEqual(e.falhas, 0);
  assert.strictEqual(Date.parse(e.proximoEm), QUARTA_10H + 900e3, 'sorteio no mínimo do ritmo (gerador injetado)');
  // 30 segundos depois: ainda no intervalo, nada sai
  const r2 = await ZL.passo('l1', QUARTA_10H + 30e3, { zap, rnd: () => 0 });
  assert.strictEqual(r2.motivo, 'ritmo');
  assert.strictEqual(zap.enviados.length, 1);
  // passado o intervalo: o segundo cliente
  await ZL.passo('l1', QUARTA_10H + 900e3, { zap, rnd: () => 0.999999 });
  assert.strictEqual(zap.enviados[1].cliente.cpf, CPF[1]);
  assert.strictEqual(Date.parse(ZF.lerEstado('l1').proximoEm), QUARTA_10H + 900e3 + 1200e3);
  assert.strictEqual(ZF.lerEstado('l1').enviadosDia, 2);
});

test('laço: teto do dia e virada do dia', async () => {
  const zap = roboDeMentira();
  C.alterar((cfg) => { cfg.lojas[0].zap = { ...ZF.PADRAO, teto: 1, min: 60, max: 60 }; });
  try {
    await ZL.passo('l1', QUARTA_10H, { zap });
    const r = await ZL.passo('l1', QUARTA_10H + 2 * 3600e3, { zap });
    assert.strictEqual(r.motivo, 'teto');
    assert.strictEqual(zap.enviados.length, 1);
    ZF.gravarPreparo('l1', criada.id, CPF.slice(1, 3).map((cpf, k) => ({ cpf, para: NUM[k + 1], v: valores('Cliente' + (k + 2)) })), 'dono', QUARTA_10H + DIA - 3600e3);
    const r2 = await ZL.passo('l1', QUARTA_10H + DIA, { zap });
    assert.strictEqual(r2.enviou, true, 'quinta-feira: o contador zerou');
    assert.strictEqual(ZF.lerEstado('l1').enviadosDia, 1);
    assert.strictEqual(ZF.lerEstado('l1').dia, '2026-03-05');
  } finally { C.alterar((cfg) => { delete cfg.lojas[0].zap; }); }
});

test('laço: número sem WhatsApp sai da fila com o motivo e não conta como falha', async () => {
  const zap = roboDeMentira({ resposta: () => ({ ok: false, motivo: 'sem_whatsapp' }) });
  const r = await ZL.passo('l1', QUARTA_10H, { zap, rnd: () => 0 });
  assert.strictEqual(r.motivo, 'sem_whatsapp');
  const it = itemDe(CPF[0]);
  assert.strictEqual(it.st, 'x'); assert.strictEqual(it.motivo, 'sem WhatsApp'); assert.strictEqual(it.por, 'robô');
  const e = ZF.lerEstado('l1');
  assert.strictEqual(e.falhas, 0); assert.strictEqual(e.enviadosDia, 0); assert.strictEqual(e.pausa, null);
  assert.strictEqual(ZF.lerContatos('l1')[CPF[0]], undefined, 'não fica como contatado');
});

test('laço: depois de N falhas seguidas pausa sozinho, avisa na auditoria e não envia mais', async () => {
  const zap = roboDeMentira({ resposta: () => ({ ok: false, motivo: 'falha', erro: 'x' }) });
  let t = QUARTA_10H;
  for (let k = 1; k <= 3; k++) {
    const r = await ZL.passo('l1', t, { zap, rnd: () => 0 });
    assert.strictEqual(r.motivo, 'falha');
    assert.strictEqual(r.pausou, k === 3);
    assert.strictEqual(ZF.lerEstado('l1').falhas, k);
    t += 900e3;
  }
  const e = ZF.lerEstado('l1');
  assert.strictEqual(e.pausa.auto, true);
  assert.ok(auditoria().includes('robô do WhatsApp pausou sozinho'));
  assert.strictEqual(itemDe(CPF[0]).st, 'p', 'quem não recebeu continua pendente');
  const antes = zap.enviados.length;
  assert.strictEqual((await ZL.passo('l1', t + 3600e3, { zap })).motivo, 'pausado');
  assert.strictEqual(zap.enviados.length, antes);
  // erro de rede (o serviço não respondeu) também conta como falha; um envio certo zera a contagem
  montarLoja();
  const z2 = roboDeMentira({ resposta: () => new Error('o robô do WhatsApp não respondeu') });
  await ZL.passo('l1', QUARTA_10H, { zap: z2, rnd: () => 0 });
  assert.strictEqual(ZF.lerEstado('l1').falhas, 1);
  z2.resposta = () => ({ ok: true });
  await ZL.passo('l1', QUARTA_10H + 900e3, { zap: z2, rnd: () => 0 });
  assert.strictEqual(ZF.lerEstado('l1').falhas, 0);
  assert.strictEqual(z2.enviados[0].id, z2.enviados[1].id, 'a nova tentativa usa o mesmo id (o serviço não reenvia)');
});

test('laço: cliente que respondeu "parar" entra em "não quer mensagens" e não recebe', async () => {
  const zap = roboDeMentira({ saidas: [{ de: NUM[0], em: '2026-03-04T12:50:00.000Z' }, { de: 'lixo' }] });
  const r = await ZL.passo('l1', QUARTA_10H, { zap, rnd: () => 0 });
  assert.strictEqual(r.msg.cliente.cpf, CPF[1], 'pulou o primeiro');
  assert.strictEqual(ZF.lerContatos('l1')[CPF[0]].optout, true);
  assert.strictEqual(ZF.lerContatos('l1')[CPF[0]].optoutPor, 'robô');
  assert.strictEqual(ZF.lerContatos('l1')[CPF[0]].optoutOrigem, 'respondeu parar pelo WhatsApp', 'fica a origem, para a loja poder desfazer');
  assert.deepStrictEqual(ZF.lerJson('l1', 'naoquer')[NUM[0]].cpfs, [CPF[0]]);
  // a loja desfaz ("Voltou a aceitar"): o número sai da lista do robô
  ZF.voltouAAceitar('l1', CPF[0]);
  assert.strictEqual(ZF.lerJson('l1', 'naoquer')[NUM[0]], undefined);
  assert.strictEqual(itemDe(CPF[0]).st, 'x');
  assert.ok(!zap.enviados.some((m) => m.para === NUM[0]));
  assert.ok(auditoria().includes('cliente não quer contato'));
  // pausado também lê as respostas (quem responde depois não fica sem ser atendido)
  montarLoja();
  ZF.mudarEstado('l1', (s) => { s.pausa = { auto: false, em: 'x' }; });
  const z2 = roboDeMentira({ saidas: [{ de: NUM[2], em: '2026-03-04T12:50:00.000Z' }] });
  assert.strictEqual((await ZL.passo('l1', QUARTA_10H, { zap: z2 })).motivo, 'pausado');
  assert.strictEqual(ZF.lerContatos('l1')[CPF[2]].optout, true);
  assert.strictEqual(z2.enviados.length, 0);
});

test('laço: desconectado, desligado ou sem o serviço instalado, nada é enviado', async () => {
  const zap = roboDeMentira({ estado: 'caiu' });
  assert.strictEqual((await ZL.passo('l1', QUARTA_10H, { zap })).motivo, 'desconectado');
  assert.strictEqual(zap.enviados.length, 0);
  assert.strictEqual(ZF.lerEstado('l1').conexao.estado, 'caiu');
  assert.ok(auditoria().includes('robô do WhatsApp: a conexão caiu'));
  // voltou: a marca some e o envio continua
  zap.estado = 'conectado';
  assert.strictEqual((await ZL.passo('l1', QUARTA_10H + MIN, { zap })).enviou, true);
  assert.strictEqual(ZF.lerEstado('l1').conexao, null);
  // o serviço respondeu "desconectado" no envio: ninguém é marcado como enviado
  montarLoja();
  const z2 = roboDeMentira({ resposta: () => ({ ok: false, motivo: 'desconectado' }) });
  assert.strictEqual((await ZL.passo('l1', QUARTA_10H, { zap: z2 })).motivo, 'desconectado');
  assert.strictEqual(itemDe(CPF[0]).st, 'p');
  assert.strictEqual(ZF.lerEstado('l1').falhas, 0);
  // desligado (sem sessão): nem chama o serviço
  montarLoja();
  ZF.mudarEstado('l1', (s) => { s.ligado = false; s.sessao = false; });
  const z3 = roboDeMentira();
  assert.strictEqual((await ZL.passo('l1', QUARTA_10H, { zap: z3 })).motivo, 'desligado');
  assert.deepStrictEqual(z3.chamadas, []);
  // sem ZAP_URL/ZAP_TOKEN
  montarLoja();
  const z4 = roboDeMentira({ ligado: false });
  assert.strictEqual((await ZL.passo('l1', QUARTA_10H, { zap: z4 })).motivo, 'sem_servico');
  assert.deepStrictEqual(z4.chamadas, []);
});

test('laço: fora do horário não envia; quem recebeu pelo painel há pouco é pulado no servidor', async () => {
  const zap = roboDeMentira();
  assert.strictEqual((await ZL.passo('l1', QUARTA_10H - 2 * 3600e3, { zap })).motivo, 'fora_janela');
  assert.strictEqual(zap.enviados.length, 0);
  ZF.mudarContato('l1', CPF[0], (c) => Object.assign(c, { em: new Date(QUARTA_10H - 2 * DIA).toISOString(), por: 'ana', motivo: 'Hoje' }));
  const r = await ZL.passo('l1', QUARTA_10H, { zap });
  assert.strictEqual(r.msg.cliente.cpf, CPF[1]);
  assert.strictEqual(itemDe(CPF[0]).st, 'x');
  assert.match(itemDe(CPF[0]).motivo, /^já recebeu em 02\/03\/2026/);
});

test('lista conferida: só guarda pendentes da campanha, campos conhecidos e número válido; some ao apagar a campanha', () => {
  const r = ZF.gravarPreparo('l1', criada.id, [
    { cpf: CPF[0], para: NUM[0], v: { nome: 'Ana\n\u0007', intruso: 'x', saudacao: 'Oi', pontos: 12 } },
    { cpf: CPF[1], para: '123', v: { nome: 'Bia' }, espera: 'Sencha' },
    { cpf: CPF[3], para: NUM[3], v: { nome: 'fora da lista' } }, { cpf: 'abc' }, null,
  ], 'dono', QUARTA_10H);
  assert.deepStrictEqual(r.ok, { clientes: 2 });
  const p = ZF.lerPreparo('l1')[criada.id];
  assert.deepStrictEqual(p.itens, { [CPF[0]]: { para: NUM[0], v: { nome: 'Ana' } }, [CPF[1]]: { para: null, v: { nome: 'Bia' }, espera: 'Sencha' } });
  assert.ok(ZF.gravarPreparo('l1', 'nao-existe', [], 'dono').erro);
  ZF.limparPreparo('l1', criada.id);
  assert.strictEqual(ZF.lerPreparo('l1')[criada.id], undefined);
});

// ---------- o cliente do serviço (src/zap.js) contra um robô de mentira em HTTP ----------
test('cliente do serviço: manda o token, segue o contrato e não roda sem ZAP_URL/ZAP_TOKEN', async () => {
  const pedidos = [];
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      pedidos.push({ m: req.method, url: req.url, token: req.headers['x-zap-token'], corpo: corpo ? JSON.parse(corpo) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.headers['x-zap-token'] !== 'segredo-teste') { res.statusCode = 401; return res.end('{}'); }
      res.end(JSON.stringify(req.url.startsWith('/status/') ? { estado: 'conectado', numeroFim: '8888' } : req.url.startsWith('/optouts/') ? { itens: [] } : { ok: true, idMsg: 'abc' }));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const ZAP = require('../../src/zap');
  try {
    delete process.env.ZAP_URL; delete process.env.ZAP_TOKEN;
    assert.strictEqual(ZAP.ativo(), false);
    await assert.rejects(ZAP.status('l1'), /não está instalado/);
    process.env.ZAP_URL = `http://127.0.0.1:${srv.address().port}/`; process.env.ZAP_TOKEN = 'segredo-teste';
    assert.strictEqual(ZAP.ativo(), true);
    assert.strictEqual((await ZAP.status('l1')).estado, 'conectado');
    assert.deepStrictEqual(await ZAP.enviar('l1', { id: 'i1', para: NUM[0], texto: 'Oi', campanha: 'não vai', cliente: { cpf: CPF[0] } }), { ok: true, idMsg: 'abc' });
    await ZAP.conectar('l1'); await ZAP.conectar('l1', NUM[1]); await ZAP.desconectar('l1'); await ZAP.optouts('l1', '2026-03-04T00:00:00.000Z');
    assert.deepStrictEqual(pedidos.map((p) => `${p.m} ${p.url}`), ['GET /status/l1', 'POST /enviar/l1', 'POST /conectar/l1', 'POST /conectar/l1', 'POST /desconectar/l1', 'GET /optouts/l1?desde=2026-03-04T00%3A00%3A00.000Z']);
    assert.ok(pedidos.every((p) => p.token === 'segredo-teste'));
    assert.deepStrictEqual(pedidos[1].corpo, { id: 'i1', para: NUM[0], texto: 'Oi' }, 'só id, número e texto vão para o serviço (nada de CPF)');
    assert.deepStrictEqual(pedidos[2].corpo, {}); assert.deepStrictEqual(pedidos[3].corpo, { numero: NUM[1] });
    process.env.ZAP_TOKEN = 'errado';
    await assert.rejects(ZAP.status('l1'), /ZAP_TOKEN diferente/);
  } finally { delete process.env.ZAP_URL; delete process.env.ZAP_TOKEN; await new Promise((ok) => srv.close(ok)); }
});

test('período da campanha: antes do início e depois do término o robô não envia; com outra campanha no período, segue por ela', () => {
  // QUARTA_10H = 04/03/2026 em Brasília
  const s = cena(); s.campanhas[0].inicio = '2026-03-05';
  assert.strictEqual(ZF.decidir(s).motivo, 'fora_periodo');
  const t = cena(); t.campanhas[0].fim = '2026-03-03';
  assert.strictEqual(ZF.decidir(t).motivo, 'fora_periodo');
  const u = cena(); Object.assign(u.campanhas[0], { inicio: '2026-03-04', fim: '2026-03-04' });
  assert.ok(ZF.decidir(u).msg, 'no dia do início e do término envia');
  // duas campanhas: a que terminou é pulada, a outra envia
  const v = cena(); const b = camp('b', { criadaEm: '2026-03-02T12:00:00.000Z' });
  v.campanhas[0].fim = '2026-03-01'; v.campanhas.push(b); v.preparo.b = prep(b);
  assert.strictEqual(ZF.decidir(v).msg.campanha, 'b');
  assert.ok(ZF.MOTIVOS.fora_periodo);
});

test('WPP-EMOJI-01: link do envio manual vai por api.whatsapp.com com o texto bem codificado (emoji inteiro, acento, quebra de linha)', () => {
  const W = require('../../public/js/msgwpp');
  const txt = 'Lienny, tudo bem? 😊🍵\n\nO Rooibos Provence voltou ao estoque! ✨ Será um prazer 💚';
  const l = W.linkComTexto('https://wa.me/5562999998888', txt);
  assert.match(l, /^https:\/\/api\.whatsapp\.com\/send\?phone=5562999998888&text=/);
  assert.strictEqual(decodeURIComponent(l.split('text=')[1]), txt, 'o texto volta igual, com os emojis');
  assert.ok(!l.includes('%EF%BF%BD'), 'nenhum caractere de substituição');
  assert.match(l, /%F0%9F%98%8A/, 'emoji codificado em 4 bytes');
  // só o número, com ou sem 55; sem número abre para escolher o contato
  assert.match(W.linkComTexto('5562999998888', 'oi'), /phone=5562999998888&text=oi$/);
  assert.strictEqual(W.linkComTexto('', 'oi'), 'https://api.whatsapp.com/send?text=oi');
  // emoji partido (metade de um par) não derruba o envio: some, o resto vai
  const partido = 'oi ' + '😊'.slice(0, 1) + ' fim';
  assert.strictEqual(decodeURIComponent(W.linkComTexto('5562999998888', partido).split('text=')[1]).replace(/\uFFFD/g, ''), 'oi  fim');
});
