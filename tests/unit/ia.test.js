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

test('IA: chave criptografada, nunca devolvida, uma chave por loja', () => {
  assert.ok(IA.salvar({ chave: 'abc', lojas: ['a'], user: 'fr' }).erro);
  const r = IA.salvar({ chave: CHAVE, lojas: ['a', 'b'], teto: 5, user: 'fr' });
  assert.equal(r.ok.fim, 'AB12');
  const bruto = fs.readFileSync(path.join(tmp, 'ia.json'), 'utf8');
  assert.ok(!bruto.includes(CHAVE) && !bruto.includes('x'.repeat(20)), 'a chave não fica em texto no arquivo');
  assert.equal((fs.statSync(path.join(tmp, 'ia.json')).mode & 0o777), 0o600);
  const s = IA.situacao([{ id: 'a', nome: 'A' }, { id: 'b', nome: 'B' }], 'fr', 'franqueado');
  assert.ok(!JSON.stringify(s).includes(CHAVE));
  assert.equal(s.chaves.length, 1);
  assert.deepEqual(s.chaves[0].lojas, ['a', 'b']);
  assert.equal(s.chaves[0].teto, 5);
  // outra chave para a loja b: sai da primeira
  const r2 = IA.salvar({ chave: CHAVE.replace('AB12', 'CD34'), lojas: ['b'], user: 'fr' });
  assert.equal(IA.chaveDaLoja('b').id, r2.ok.id);
  assert.deepEqual(IA.chaveDaLoja('a').lojas, ['a']);
  // só o dono (ou admin) mexe
  assert.ok(IA.remover(r2.ok.id, 'f2', 'franqueado').erro);
  assert.ok(IA.remover(r2.ok.id, 'fr', 'franqueado').ok);
  assert.equal(IA.chaveDaLoja('b'), null);
  assert.equal(IA.decifrar(IA.cifrar('olá')), 'olá');
});

test('IA: uso do mês e teto', async () => {
  const id = IA.chaveDaLoja('a').id;
  const j = await IA.mensagens('a', { messages: [{ role: 'user', content: 'oi' }] });
  assert.ok(j.content.length);
  const u = IA.usoDoMes(id);
  assert.equal(u.pedidos, 1);
  assert.ok(u.usd > 0);
  // custo: 1M entrada + 1M saída = 3 + 15
  assert.equal(IA.custo({ input_tokens: 1e6, output_tokens: 1e6 }), 18);
  IA.alterar(id, { teto: 1 }, 'fr', 'franqueado', ['a', 'b']);
  const d = JSON.parse(fs.readFileSync(path.join(tmp, 'ia.json'), 'utf8'));
  for (const m of Object.values(d.uso[id])) m.usd = 1.5;
  fs.writeFileSync(path.join(tmp, 'ia.json'), JSON.stringify(d));
  await assert.rejects(IA.mensagens('a', { messages: [{ role: 'user', content: 'oi' }] }), /teto/);
  await assert.rejects(IA.mensagens('c', { messages: [{ role: 'user', content: 'oi' }] }), /não está configurada/);
});

test('IA: conferência das mensagens e ferramentas por perfil', () => {
  assert.equal(IAP.conferirMensagens([{ role: 'user', content: 'quanto vendemos?' }]), null);
  assert.ok(IAP.conferirMensagens([{ role: 'assistant', content: 'x' }]));
  assert.ok(IAP.conferirMensagens([{ role: 'user', content: [{ type: 'tool_use', id: '1', name: 'x', input: {} }] }]));
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
