'use strict';
// Robô do WhatsApp sem ninguém abrir a tela Campanhas: o servidor cria a lista nova da campanha recorrente e renova a
// lista conferida rodando a conta da PRÓPRIA tela (os arquivos de public/js) com o pacote de dados de /api/dados.
// Dados de exemplo pequenos, com resultado conferido à mão; relógio injetado; nada sai daqui (robô de mentira).
const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapauto-'));
process.env.DATA_DIR = tmp;
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
const TODOS_OS_DIAS = { dias: [0, 1, 2, 3, 4, 5, 6] };
const LOJAS = ['l1', 'l2', 'l3', 'l4', 'l5'];
fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify({ lojas: LOJAS.map((id) => ({ id, nome: 'Loja Um', wppIntervalo: 21, zap: TODOS_OS_DIAS })), usuarios: {} }));
const C = require('../../src/config');
const CAMP = require('../../src/campanhas');
const ZF = require('../../src/zapfila');
const ZL = require('../../src/zaplaco');
const ZA = require('../../src/zapauto');
const { pack } = require('../../src/sources');
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

// quarta-feira, 4 de março de 2026, 10:00 em Brasília
const QUARTA_10H = Date.parse('2026-03-04T13:00:00Z');
const DIA = 864e5, HORA = 3600e3;
const ANA = '11111111111', BIA = '22222222222', CAIO = '33333333333', DUDA = '44444444444', EDU = '55555555555';

// ---------- dados de exemplo: o mesmo formato que o servidor carrega das planilhas e manda em /api/dados ----------
const venda = (data, cupom, vendedor, descricao, produto, grupo, o = {}) => ({ data, cupom, loja: 'LOJA UM', vendedor, descricao, produto, grupo, grupoC: grupo, cat: '', subgrupo: '', cod: String(cupom), qtd: 1, soNumeros: null, qtdCha: 0, vu: 50, du: 0, vt: 50, min: null, ...o });
const VENDAS = [
  venda('2025-12-01', 101, 'MARIA', 'EARL GREY 100G', 'EARL GREY', 'CHÁ PRETO AROMATIZADO', { qtd: 2, soNumeros: 100, qtdCha: 0.2, vt: 100 }),
  venda('2026-01-10', 102, 'MARIA', 'SENCHA 50G', 'SENCHA', 'CHÁ VERDE PURO', { soNumeros: 50, qtdCha: 0.05, vt: 30 }),
  venda('2026-02-20', 103, 'JOANA', 'CANECA AZUL', 'CANECA AZUL', 'ACESSÓRIOS', { vt: 80 }),
  venda('2025-06-01', 104, 'JOANA', 'CANECA AZUL', 'CANECA AZUL', 'ACESSÓRIOS'),
  venda('2026-02-01', 105, 'JOANA', 'CANECA AZUL', 'CANECA AZUL', 'ACESSÓRIOS'),
  venda('2026-01-20', 106, 'JOANA', 'CANECA AZUL', 'CANECA AZUL', 'ACESSÓRIOS'),
];
const cupomCpf = (cpf, cupom) => ({ cpf, cupom, loja: 'LOJA UM', data: VENDAS.find((v) => v.cupom === cupom).data });
const corpoDe = (lojaId, vendas = VENDAS) => JSON.stringify(pack({
  vendas, meta: null, avisos: [], fontes: [], fidelidade: [],
  metaCfgs: [{ id: lojaId, nome: 'Loja Um', nomesVenda: ['LOJA UM'], wppIntervalo: 21 }],
  xml: [cupomCpf(ANA, 101), cupomCpf(ANA, 102), cupomCpf(BIA, 103), cupomCpf(CAIO, 104), cupomCpf(DUDA, 105), cupomCpf(EDU, 106)],
  clientes: [
    { cpf: ANA, nome: 'ANA SOUZA', celular: '(62) 91111-0001', nascimento: '1990-03-15' },
    { cpf: BIA, nome: 'BIA LIMA', celular: '5562911110002' },
    { cpf: CAIO, nome: 'CAIO SEM CELULAR', celular: '' },
    { cpf: DUDA, nome: 'DUDA NAO QUER', celular: '62911110004' },
    { cpf: EDU, nome: 'EDU CONTATADO', celular: '62911110005' },
  ],
}, { lojas: [{ id: lojaId, nome: 'Loja Um' }], perfil: 'completo' }));
const CONTATOS = { [DUDA]: { optout: true }, [EDU]: { em: new Date(QUARTA_10H - 5 * DIA).toISOString(), por: 'dono', motivo: 'Campanha: outra' } };
const ESTOQUE = { itens: [['EARL GREY', 'kg', true], ['SENCHA', 'kg', true]] };

/** os dados que o servidor entrega à tarefa (no painel: o pacote de /api/dados e a leitura do estoque) */
function fontes(lojaId, o = {}) {
  const f = { pedidos: 0, sig: 's1', vendas: VENDAS, falha: null, estoque: ESTOQUE, ...o };
  f.corpo = async () => { f.pedidos++; if (f.falha) throw new Error(f.falha); return { sig: f.sig, json: () => corpoDe(lojaId, f.vendas) }; };
  f.disponivel = () => { if (!f.estoque) throw new Error('sem estoque'); return f.estoque; };
  return f;
}
function roboDeMentira() {
  const z = { enviados: [] };
  z.ativo = () => true;
  z.status = async () => ({ estado: 'conectado', numeroFim: '8888' });
  z.enviar = async (loja, msg) => { z.enviados.push({ loja, ...msg }); return { ok: true, idMsg: 'm' + z.enviados.length }; };
  z.optouts = async () => ({ itens: [] });
  return z;
}
/** loja com o robô ligado e uma campanha do robô gravada direto no arquivo (datas no passado, como numa loja de verdade) */
function montarLoja(lojaId, camp = {}) {
  fs.rmSync(path.join(tmp, lojaId), { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, lojaId), { recursive: true });
  const c = { id: 'c1', nome: 'Sem comprar', mensagem: '{saudacao}, {nome}! Faz {dias} dias que você não vem.', variacoes: [], limiteDia: 20, janela: 30, recorrente: '', ativa: true, robo: true,
    filtros: { ausMin: 10 }, criadaEm: '2026-02-10T12:00:00.000Z', por: 'dono', rodadas: [{ id: 'r0', em: '2026-02-10T12:00:00.000Z', por: 'dono', lista: [{ cpf: ANA, nome: 'ANA SOUZA', st: 'p' }, { cpf: BIA, nome: 'BIA LIMA', st: 'p' }] }], ...camp };
  fs.writeFileSync(path.join(tmp, lojaId, 'campanhas.json'), JSON.stringify([c]));
  fs.writeFileSync(path.join(tmp, lojaId, 'contatos.json'), JSON.stringify(CONTATOS));
  ZF.mudarEstado(lojaId, (s) => { s.ligado = true; s.sessao = true; });
  ZA._esquecer();
  return c;
}
const campanha = (lojaId) => CAMP.ler(lojaId)[0];
const auditoria = (acao) => { try { return fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.acao === acao); } catch { return []; } };

// ---------- (a) a mesma conta da tela ----------
test('a conta que roda no servidor é a dos arquivos da tela (nenhuma cópia da regra)', () => {
  const m = /const APP_SCRIPTS = \[([\s\S]*?)\];/.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8'));
  const daTela = [...m[1].matchAll(/'([\w.-]+\.js)'/g)].map((x) => x[1]);
  assert.deepStrictEqual(daTela.filter((f) => ZA.ARQUIVOS.includes(f)), ZA.ARQUIVOS, 'os mesmos arquivos do pacote da tela, na mesma ordem');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'zapauto.js'), 'utf8');
  for (const regra of ['ausencia', 'chaFavorito', 'optout', 'semContato', 'vendedoraPref']) assert.ok(!src.includes(regra), `"${regra}" é conta da tela: não pode ser refeita em src/zapauto.js`);
  const tela = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'campanhas.js'), 'utf8');
  assert.match(tela, /TS\.zapPreparar\(state\.loja, camp\.id, itensPreparo\(/, 'a tela manda a lista conferida feita pela mesma função');
  assert.match(tela, /lista: listaDe\(c\.filtros\)/, 'a tela cria a lista da recorrente pela mesma função');
});

test('quem entra na lista: os critérios da tela (com celular, sem "não quer mensagens", sem contato recente)', () => {
  const t = ZA.tela({ loja: { id: 'l1', nome: 'Loja Um' }, corpo: corpoDe('l1'), contatos: CONTATOS, disponivel: () => ESTOQUE, agora: QUARTA_10H });
  // Ana (53 dias) e Bia (12 dias) entram; Caio não tem celular, Duda pediu para não receber, Edu recebeu há 5 dias
  assert.deepStrictEqual(t.listaDe({ ausMin: 10 }), [{ cpf: ANA, nome: 'ANA SOUZA' }, { cpf: BIA, nome: 'BIA LIMA' }]);
  assert.deepStrictEqual(t.listaDe({ ausMin: 30 }), [{ cpf: ANA, nome: 'ANA SOUZA' }]);
  assert.deepStrictEqual(t.listaDe({ ausMin: 10, tipos: ['Chá verde'] }).map((x) => x.cpf), [ANA], 'tipo de chá que já comprou');
  assert.deepStrictEqual(t.listaDe({ produtos: ['~caneca'], compraDias: 30 }).map((x) => x.cpf), [BIA], 'comprou o produto nos últimos 30 dias');
  assert.deepStrictEqual(t.listaDe({ aniv: 'atual' }).map((x) => x.cpf), [ANA], 'aniversário no mês atual (março, pelo relógio injetado)');
  assert.deepStrictEqual(t.listaDe({ ptsMin: 1 }), [], 'ninguém tem pontos');
  // sem o contato recente do Edu ele entra: a lista segue os contatos da loja
  const t2 = ZA.tela({ loja: { id: 'l1', nome: 'Loja Um' }, corpo: corpoDe('l1'), contatos: {}, disponivel: () => ESTOQUE, agora: QUARTA_10H });
  assert.deepStrictEqual(t2.listaDe({ ausMin: 10 }).map((x) => x.cpf), [ANA, BIA, DUDA, EDU]);
});

test('valores dos campos e número de cada pendente: os que a tela calcula', async () => {
  const camp = { id: 'c1', mensagem: 'Oi, {nome}! Seu {cha} acabou?', variacoes: [], filtros: {}, rodadas: [{ id: 'r0', lista: [{ cpf: ANA, st: 'p' }, { cpf: BIA, st: 'p' }, { cpf: CAIO, st: 'p' }, { cpf: EDU, st: 'e' }, { cpf: '99999999999', st: 'p' }] }] };
  const loja = { id: 'l1', nome: 'Loja Um' };
  const itens = await ZA.tela({ loja, corpo: corpoDe('l1'), contatos: CONTATOS, disponivel: () => ESTOQUE, agora: QUARTA_10H }).itens(camp);
  assert.deepStrictEqual(itens.map((x) => x.cpf), [ANA, BIA, CAIO], 'só pendentes que estão nos dados');
  const [ana, bia, caio] = itens;
  assert.strictEqual(ana.para, '5562911110001');
  assert.strictEqual(bia.para, '5562911110002');
  assert.strictEqual(caio.para, null, 'sem celular: o robô marca e segue');
  const { saudacao, ...v } = ana.v;
  assert.ok(['Bom dia', 'Boa tarde', 'Boa noite'].includes(saudacao), 'a saudação é refeita na hora do envio');
  assert.deepStrictEqual(v, { nome: 'Ana', nomecompleto: 'Ana Souza', loja: 'Loja Um', cha: 'EARL GREY', ultimocha: 'SENCHA', pacote: '100g', vendedora: 'Maria',
    pontos: '0', vence: '—', vencepts: '0', ultimacompra: '10/01/2026', dias: '53', aniversario: '15/03', visitas: '2' });
  assert.deepStrictEqual({ cha: bia.v.cha, pacote: bia.v.pacote, vendedora: bia.v.vendedora, dias: bia.v.dias, visitas: bia.v.visitas, aniversario: bia.v.aniversario },
    { cha: 'chá', pacote: '', vendedora: 'Joana', dias: '12', visitas: '1', aniversario: '—' });
  assert.strictEqual(ana.espera, undefined);
  // trava de estoque: a mensagem oferece o chá favorito e a loja não tem → espera; sem leitura do estoque → espera também
  const sem = await ZA.tela({ loja, corpo: corpoDe('l1'), contatos: {}, disponivel: () => ({ itens: [['EARL GREY', 'kg', false]] }), agora: QUARTA_10H }).itens(camp);
  assert.strictEqual(sem[0].espera, 'EARL GREY');
  assert.strictEqual(sem[1].espera, undefined, 'a Bia não tem chá favorito: a mensagem não oferece produto');
  const semLeitura = await ZA.tela({ loja, corpo: corpoDe('l1'), contatos: {}, disponivel: () => { throw new Error('fora do ar'); }, agora: QUARTA_10H }).itens(camp);
  assert.strictEqual(semLeitura[0].espera, 'estoque não conferido');
  // no dia seguinte os dias mudam: é por isso que a lista é refeita todo dia
  const amanha = await ZA.tela({ loja, corpo: corpoDe('l1'), contatos: {}, disponivel: () => ESTOQUE, agora: QUARTA_10H + DIA }).itens(camp);
  assert.strictEqual(amanha[0].v.dias, '54');
});

// ---------- (b) campanha recorrente ----------
test('campanha recorrente vencida: o servidor cria a lista nova sozinho, uma vez só, e registra na auditoria', async () => {
  // lista de fevereiro com a Ana já enviada; em março a mensal vence
  montarLoja('l2', { recorrente: 'mensal', rodadas: [{ id: 'r0', em: '2026-02-10T12:00:00.000Z', por: 'dono', lista: [{ cpf: ANA, nome: 'ANA SOUZA', st: 'e', em: '2026-02-10T13:00:00.000Z', por: 'dono' }] }] });
  fs.writeFileSync(path.join(tmp, 'l2', 'contatos.json'), JSON.stringify({ [DUDA]: { optout: true } }));
  const f = fontes('l2');
  const r = await ZA.passo('l2', QUARTA_10H, f);
  assert.strictEqual(r.rodou, true);
  assert.deepStrictEqual(r.rodadas, ['Sem comprar']);
  let c = campanha('l2');
  assert.strictEqual(c.rodadas.length, 2);
  assert.strictEqual(c.rodadas[0].por, 'robô');
  assert.strictEqual(c.rodadas[0].em, new Date(QUARTA_10H).toISOString());
  assert.deepStrictEqual(c.rodadas[0].lista, [{ cpf: ANA, nome: 'ANA SOUZA', st: 'p' }, { cpf: BIA, nome: 'BIA LIMA', st: 'p' }, { cpf: EDU, nome: 'EDU CONTATADO', st: 'p' }]);
  assert.strictEqual(ZF.lerPreparo('l2').c1.rodada, c.rodadas[0].id, 'a lista conferida já é a da lista nova');
  const aud = auditoria('criou lista nova da campanha recorrente').filter((l) => l.alvo === 'l2');
  assert.strictEqual(aud.length, 1);
  assert.deepStrictEqual(aud[0].detalhe, { loja: 'l2', campanha: 'Sem comprar', clientes: 3 });
  assert.ok(!JSON.stringify(aud).includes(ANA) && !JSON.stringify(aud).includes('6291111'), 'nada de cliente na auditoria');
  // de novo no mesmo mês (outra hora, outro dia, dados novos): não cria outra
  assert.strictEqual((await ZA.passo('l2', QUARTA_10H + 10 * 60e3, f)).motivo, 'ha_pouco', 'no máximo uma vez por hora');
  f.sig = 's2';
  assert.deepStrictEqual((await ZA.passo('l2', QUARTA_10H + 2 * HORA, f)).rodadas, []);
  assert.deepStrictEqual((await ZA.passo('l2', QUARTA_10H + 5 * DIA, f)).rodadas, []);
  assert.deepStrictEqual((await ZA.conferir('l2', QUARTA_10H + 5 * DIA, f)).rodadas, []);
  c = campanha('l2');
  assert.strictEqual(c.rodadas.length, 2);
  assert.strictEqual(auditoria('criou lista nova da campanha recorrente').filter((l) => l.alvo === 'l2').length, 1);
  // abril: lista nova de novo (uma)
  const abril = Date.parse('2026-04-01T13:00:00Z');
  assert.deepStrictEqual((await ZA.passo('l2', abril, f)).rodadas, ['Sem comprar']);
  assert.strictEqual(campanha('l2').rodadas.length, 3);
  // semanal: vence com 7 dias
  montarLoja('l2', { recorrente: 'semanal', rodadas: [{ id: 'r0', em: new Date(QUARTA_10H - 6 * DIA).toISOString(), por: 'dono', lista: [] }] });
  assert.deepStrictEqual((await ZA.passo('l2', QUARTA_10H, fontes('l2'))).rodadas, []);
  ZA._esquecer();
  assert.deepStrictEqual((await ZA.passo('l2', QUARTA_10H + DIA, fontes('l2'))).rodadas, ['Sem comprar']);
});

test('só mexe em loja com o robô ligado e em campanha do robô ativa', async () => {
  montarLoja('l3', { robo: false, recorrente: 'mensal' });
  const f = fontes('l3');
  assert.deepStrictEqual(await ZA.passo('l3', QUARTA_10H, f), { rodou: false, motivo: 'sem_campanha' });
  montarLoja('l3', { ativa: false, recorrente: 'mensal' });
  assert.strictEqual((await ZA.passo('l3', QUARTA_10H, f)).motivo, 'sem_campanha');
  montarLoja('l3', { recorrente: 'mensal' });
  ZF.mudarEstado('l3', (s) => { s.ligado = false; });
  assert.strictEqual((await ZA.passo('l3', QUARTA_10H, f)).motivo, 'desligado');
  assert.strictEqual(f.pedidos, 0, 'nem carrega os dados da loja');
  assert.strictEqual(campanha('l3').rodadas.length, 1);
  assert.deepStrictEqual(ZF.lerPreparo('l3'), {});
});

// ---------- (c) o robô envia sem ninguém abrir a tela ----------
test('o robô envia hoje e no dia seguinte sem ninguém abrir a tela, com os valores do dia', async () => {
  montarLoja('l4');
  const f = fontes('l4'), zap = roboDeMentira(), rnd = () => 0;
  // sem a tarefa o robô não tem a lista conferida
  assert.strictEqual((await ZL.passo('l4', QUARTA_10H, { zap, rnd })).motivo, 'conferir_lista');
  const r = await ZA.passo('l4', QUARTA_10H, f);
  assert.deepStrictEqual({ rodou: r.rodou, campanhas: r.campanhas, clientes: r.clientes, rodadas: r.rodadas }, { rodou: true, campanhas: 1, clientes: 2, rodadas: [] });
  assert.strictEqual(ZF.lerPreparo('l4').c1.por, 'robô');
  assert.strictEqual(ZF.lerPreparo('l4').c1.itens[ANA].v.saudacao, undefined);
  assert.strictEqual(ZF.lerEstado('l4').auto.ok, true);
  assert.strictEqual((await ZL.passo('l4', QUARTA_10H + 60e3, { zap, rnd })).enviou, true);
  assert.deepStrictEqual([zap.enviados[0].para, zap.enviados[0].texto], ['5562911110001', 'Bom dia, Ana! Faz 53 dias que você não vem.']);
  // mesma hora, mesmo dia, mesmos dados: não refaz (nem relê a loja antes de uma hora)
  assert.strictEqual((await ZA.passo('l4', QUARTA_10H + 30 * 60e3, f)).motivo, 'ha_pouco');
  const antes = f.pedidos;
  assert.strictEqual((await ZA.passo('l4', QUARTA_10H + 2 * HORA, f)).motivo, 'sem_mudanca');
  assert.strictEqual(f.pedidos, antes + 1, 'só confere se os dados mudaram');
  // chegou a coleta (dados novos: a Bia comprou hoje): refaz no mesmo dia
  f.sig = 's2';
  f.vendas = [...VENDAS, venda('2026-03-04', 107, 'JOANA', 'CANECA AZUL', 'CANECA AZUL', 'ACESSÓRIOS')];
  assert.strictEqual((await ZA.passo('l4', QUARTA_10H + 4 * HORA, f)).rodou, true);
  assert.strictEqual(ZF.lerPreparo('l4').c1.itens[BIA].v.dias, '12', 'sem CPF no cupom novo, a Bia continua igual');
  // quinta-feira: ninguém abriu a tela; a tarefa refaz e o robô envia com os dias de quinta
  const quinta = QUARTA_10H + DIA;
  assert.strictEqual((await ZA.passo('l4', quinta, f)).rodou, true);
  assert.strictEqual((await ZL.passo('l4', quinta + 60e3, { zap, rnd })).enviou, true);
  assert.deepStrictEqual([zap.enviados[1].para, zap.enviados[1].texto], ['5562911110002', 'Bom dia, Bia! Faz 13 dias que você não vem.']);
  assert.deepStrictEqual(campanha('l4').rodadas[0].lista.map((x) => [x.cpf, x.st, x.por]), [[ANA, 'e', 'robô'], [BIA, 'e', 'robô']]);
  // uma semana depois, sem a tela: a lista conferida continua em dia (nada pendente, nada para avisar)
  const semana = QUARTA_10H + 7 * DIA;
  await ZA.passo('l4', semana, f);
  assert.strictEqual((await ZL.passo('l4', semana + 60e3, { zap, rnd })).motivo, 'sem_pendentes');
});

// ---------- (d) a rede de segurança ----------
test('a tarefa falha: o robô segue com a lista conferida por 3 dias e depois para com o aviso', async () => {
  montarLoja('l5');
  const f = fontes('l5'), zap = roboDeMentira(), rnd = () => 0;
  await ZA.passo('l5', QUARTA_10H, f);
  // a partir de quinta os dados da loja não carregam mais
  f.falha = 'planilha fora do ar';
  const erros = [], original = console.error;
  console.error = (...a) => erros.push(a.join(' '));
  try {
    const quinta = QUARTA_10H + DIA;
    assert.deepStrictEqual(await ZA.passo('l5', quinta, f), { rodou: true, erro: true });
    assert.strictEqual(ZF.lerEstado('l5').auto.ok, false);
    assert.strictEqual((await ZA.passo('l5', quinta + 20 * 60e3, f)).motivo, 'ha_pouco', 'depois de falhar também espera uma hora');
    // dentro do prazo o robô ainda envia com o que foi conferido na quarta
    assert.strictEqual((await ZL.passo('l5', quinta + 60e3, { zap, rnd })).enviou, true);
    assert.strictEqual(zap.enviados[0].texto, 'Bom dia, Ana! Faz 53 dias que você não vem.');
    // sábado (3 dias depois da última conferência): para e avisa, mesmo com a Bia pendente
    const sabado = QUARTA_10H + 3 * DIA + 60e3;
    assert.strictEqual((await ZA.passo('l5', sabado, f)).erro, true);
    const p = await ZL.passo('l5', sabado + 60e3, { zap, rnd });
    assert.strictEqual(p.motivo, 'conferir_lista');
    assert.match(ZF.MOTIVOS.conferir_lista, /lista precisa ser conferida/);
    assert.strictEqual(zap.enviados.length, 1, 'nada sai com valores velhos');
    assert.strictEqual(campanha('l5').rodadas[0].lista[1].st, 'p');
  } finally { console.error = original; }
  assert.ok(erros.length >= 2 && erros.every((e) => !e.includes(ANA) && !e.includes('6291111')), 'o log não leva dado de cliente');
  // os dados voltaram: a tarefa refaz e o robô retoma sozinho
  f.falha = null;
  const domingo = QUARTA_10H + 4 * DIA;
  assert.strictEqual((await ZA.passo('l5', domingo, f)).rodou, true);
  assert.strictEqual((await ZL.passo('l5', domingo + 60e3, { zap, rnd })).enviou, true);
  assert.strictEqual(zap.enviados[1].texto, 'Bom dia, Bia! Faz 16 dias que você não vem.');
});
