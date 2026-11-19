'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-'));
fs.writeFileSync(path.join(tmp, 'lojas.json'), JSON.stringify({ lojas: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], usuarios: { fr: { lojas: ['a', 'b'], perfil: 'franqueado' }, f2: { lojas: ['c'], perfil: 'franqueado' } } }));
process.env.CONFIG_FILE = path.join(tmp, 'lojas.json');
process.env.DATA_DIR = tmp;
process.env.IA_FALSO = '1';
const IA = require('../../src/ia');
const IAP = require('../../src/iaprompts');
const CHAVE = 'sk-ant-api03-' + 'x'.repeat(40) + 'AB12';

test('IA: uma chave por loja, criptografada e nunca devolvida; formato antigo migra', () => {
  // formato antigo (uma chave para várias lojas): cada loja vira dona do próprio registro
  fs.writeFileSync(path.join(tmp, 'ia.json'), JSON.stringify({ chaves: { x1: { enc: IA.cifrar(CHAVE), fim: 'AB12', dono: 'fr', lojas: ['b', 'c'], teto: 7 } }, uso: { x1: { '2026-11': { pedidos: 3, usd: 0.5 } } } }));
  assert.equal(IA.chaveDaLoja('b').fim, 'AB12');
  assert.equal(IA.chaveDaLoja('c').teto, 7);
  assert.equal(IA.chaveDaLoja('a'), null);
  assert.ok(IA.salvar({ chave: 'abc', loja: 'a', user: 'fr' }).erro);
  const r = IA.salvar({ chave: CHAVE, loja: 'a', teto: 5, user: 'fr' });
  assert.equal(r.ok.fim, 'AB12');
  const bruto = fs.readFileSync(path.join(tmp, 'ia.json'), 'utf8');
  assert.ok(!bruto.includes(CHAVE) && !bruto.includes('x'.repeat(20)), 'a chave não fica em texto no arquivo');
  assert.equal((fs.statSync(path.join(tmp, 'ia.json')).mode & 0o777), 0o600);
  const s = IA.situacao('a');
  assert.ok(!JSON.stringify(s).includes(CHAVE));
  assert.equal(s.chave.fim, 'AB12');
  assert.equal(s.chave.teto, 5);
  // trocar a chave da loja b não mexe na c
  IA.salvar({ chave: CHAVE.replace('AB12', 'CD34'), loja: 'b', user: 'fr' });
  assert.equal(IA.chaveDaLoja('b').fim, 'CD34');
  assert.equal(IA.chaveDaLoja('c').fim, 'AB12');
  assert.ok(IA.remover('b').ok);
  assert.equal(IA.chaveDaLoja('b'), null);
  assert.ok(IA.remover('c').ok);
  assert.equal(IA.decifrar(IA.cifrar('olá')), 'olá');
});

test('IA: uso do mês e teto', async () => {
  const id = 'a';
  const j = await IA.mensagens('a', { messages: [{ role: 'user', content: 'oi' }] });
  assert.ok(j.content.length);
  const u = IA.usoDoMes(id);
  assert.equal(u.pedidos, 1);
  assert.ok(u.usd > 0);
  // custo: 1M entrada + 1M saída = 3 + 15
  assert.equal(IA.custo({ input_tokens: 1e6, output_tokens: 1e6 }), 18);
  IA.alterar('a', { teto: 1 });
  const d = JSON.parse(fs.readFileSync(path.join(tmp, 'ia.json'), 'utf8'));
  for (const m of Object.values(d.uso[id])) m.usd = 1.5;
  fs.writeFileSync(path.join(tmp, 'ia.json'), JSON.stringify(d));
  await assert.rejects(IA.mensagens('a', { messages: [{ role: 'user', content: 'oi' }] }), /teto/);
  await assert.rejects(IA.mensagens('c', { messages: [{ role: 'user', content: 'oi' }] }), /não está ligada/);
});

test('IA: conferência das mensagens e ferramentas por perfil', () => {
  assert.equal(IAP.conferirMensagens([{ role: 'user', content: 'quanto vendemos?' }]), null);
  assert.ok(IAP.conferirMensagens([{ role: 'assistant', content: 'x' }]));
  assert.ok(IAP.conferirMensagens([{ role: 'user', content: [{ type: 'tool_use', id: '1', name: 'x', input: {} }] }]));
  // o que a IA devolveu (inclusive raciocínio) volta como veio
  assert.equal(IAP.conferirMensagens([{ role: 'user', content: 'q' }, { role: 'assistant', content: [{ type: 'thinking', thinking: '…', signature: 's' }, { type: 'tool_use', id: 't', name: 'consultar_vendas', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '{}' }] }]), null);
  assert.ok(IAP.conferirMensagens([{ role: 'user', content: 'a'.repeat(5000) }]));
  const ok = [{ role: 'user', content: 'q' }, { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'consultar_vendas', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '{}' }] }];
  assert.equal(IAP.conferirMensagens(ok), null);
  const nomes = (p) => IAP.ferramentas(p).map((t) => t.name);
  assert.ok(!nomes({ clientes: false, custos: false }).includes('consultar_clientes'));
  assert.ok(!nomes({ clientes: false, custos: false }).includes('consultar_estoque'));
  assert.ok(nomes({ clientes: true, custos: true }).includes('consultar_estoque'));
  const sis = IAP.sistemaPergunta({ hoje: '2026-11-18', loja: 'X' }, { clientes: false, custos: false, perfil: 'gerente' });
  assert.match(sis, /não vê dados de clientes/);
  assert.match(sis, /não vê custo/);
});

test('IA: histórico de conversas por pessoa e por loja, sem a lista de clientes', () => {
  const IAC = require('../../src/iaconversas');
  const vis = [{ eu: 'Quanto vendemos?' }, { ia: { passos: ['consultando as vendas'], texto: 'R$ 10', graficos: [], clientes: [{ n: 3, cpfs: ['12345678901'] }] } }];
  assert.ok(IAC.salvar('fr', 'zz', { loja: 'a', vis }).erro);
  assert.ok(IAC.salvar('fr', 'aaaaaaaaaaaa', { loja: 'a', vis: [] }).erro);
  assert.ok(IAC.salvar('fr', 'aaaaaaaaaaaa', { loja: 'a', vis, mensagens: [{ role: 'user', content: 'Quanto vendemos?' }] }).ok);
  IAC.salvar('fr', 'bbbbbbbbbbbb', { loja: 'b', vis });
  assert.deepEqual(IAC.lista('fr', 'a').map((c) => c.id), ['aaaaaaaaaaaa']);
  assert.equal(IAC.lista('fr', 'a')[0].titulo, 'Quanto vendemos?');
  assert.equal(IAC.lista('fr', 'a')[0].perguntas, 1);
  assert.equal(IAC.lista('f2', 'a').length, 0, 'cada pessoa vê só as suas');
  const c = IAC.abrir('fr', 'aaaaaaaaaaaa');
  assert.ok(!JSON.stringify(c).includes('12345678901'), 'CPF não fica gravado');
  assert.equal(c.vis[1].ia.clientes[0].n, 3);
  assert.equal(c.mensagens.length, 1);
  assert.ok(IAC.salvar('fr', 'aaaaaaaaaaaa', { loja: 'b', vis }).erro, 'não troca de loja');
  assert.ok(IAC.apagar('fr', 'aaaaaaaaaaaa').ok);
  assert.equal(IAC.abrir('fr', 'aaaaaaaaaaaa'), null);
});

test('IA: diagnóstico e revisão do pedido não forçam a ferramenta (os modelos novos recusam) e pedem de novo se vier só texto', async () => {
  IA.salvar({ chave: CHAVE, loja: 'c', user: 'f2' });
  const enviados = [];
  const fetchAntes = global.fetch, falsoAntes = process.env.IA_FALSO;
  process.env.IA_FALSO = '0';
  const respostas = [
    { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: 'Aqui está a explicação…' }] },
    { stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 't1', name: 'diagnostico', input: { resumo: 'ok' } }] },
  ];
  global.fetch = async (url, op) => { enviados.push(JSON.parse(op.body)); return { ok: true, status: 200, json: async () => respostas.shift() }; };
  try {
    const r = await IA.comFerramenta('c', { max_tokens: 100, system: 's', ferramenta: IAP.FERR_DIAG, conteudo: 'dados' });
    assert.deepEqual(r, { resumo: 'ok' });
    assert.equal(enviados.length, 2);
    for (const b of enviados) assert.deepEqual(b.tool_choice, { type: 'auto' });
    assert.equal(enviados[1].messages.length, 3, 'a segunda tentativa leva a resposta anterior e o pedido da ferramenta');
  } finally {
    global.fetch = fetchAntes; process.env.IA_FALSO = falsoAntes;
    IA.remover('c');
  }
});

test('IA: diagnóstico do Início é gerado uma vez por arquivo (loja + dia), mesmo com duas pessoas abrindo juntas', async () => {
  const arq = path.join(tmp, 'a', 'ia', 'diag-2026-11-19-loja.json');
  let chamadas = 0;
  const gerar = async () => { chamadas++; await new Promise((r) => setTimeout(r, 30)); return { diagnostico: { manchete: 'x' }, em: 'agora' }; };
  const [a, b] = await Promise.all([IA.umaVez(arq, gerar), IA.umaVez(arq, gerar)]);
  assert.equal(chamadas, 1, 'duas pessoas ao mesmo tempo: uma geração só');
  assert.deepEqual(a, b);
  const c = await IA.umaVez(arq, gerar);
  assert.equal(chamadas, 1, 'quem abre depois lê a guardada');
  assert.equal(c.guardada, true);
  assert.equal(c.diagnostico.manchete, 'x');
  // IA sem resposta: não guarda (dá para tentar de novo)
  const arq2 = path.join(tmp, 'a', 'ia', 'diag-2026-11-19-todas-x.json');
  assert.equal(await IA.umaVez(arq2, async () => null), null);
  assert.ok(!fs.existsSync(arq2));
});

test('IA: só admin e franqueado usam (gerente e vendedora não)', () => {
  assert.equal(IA.podeUsar('admin'), true);
  assert.equal(IA.podeUsar('franqueado'), true);
  assert.equal(IA.podeUsar('gerente'), false);
  assert.equal(IA.podeUsar('vendedor'), false);
  assert.equal(IA.podeUsar(undefined), false);
});
