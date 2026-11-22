'use strict';
// CLI-CEL: celular trocado pelo painel (vínculo da conversa do WhatsApp com o cliente — decisão do dono, 22/11/2026).
// O número vinculado vale em todo o painel e no robô (substitui o do FIXE no pacote de /api/dados); um número é de um
// cliente só; só admin e franqueado da loja vinculam; a auditoria guarda só os 4 últimos dígitos; o "parar" que chega
// pelo número novo acha o cliente.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cel-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = 5900 + Math.floor(Math.random() * 90); // faixa só deste arquivo
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'senha-teste-123';
const CPF_A = '11122233344', CPF_B = '55566677788', CPF_C = '99988877766';
const NOVO = '62981112222'; // o número novo da cliente A (era de B no FIXE)
let srv, C;
const cookies = {};
let ipSeq = 20;
const pedir = (nome, url, opt = {}) => fetch(BASE + url, { ...opt, headers: { Cookie: cookies[nome] || '', 'X-Painel': '1', 'Content-Type': 'application/json', ...(opt.headers || {}) } });
const post = (nome, url, corpo) => pedir(nome, url, { method: 'POST', body: JSON.stringify(corpo || {}) });
const auditoria = () => fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const vinculos = () => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'l1', 'clientes', 'celulares.json'), 'utf8')); } catch { return {}; } };

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  C = require('../../src/config');
  const senha = await C.hashSenhaAsync(SENHA);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    lojas: [{ id: 'l1', nome: 'Loja Um', drive: {} }, { id: 'l2', nome: 'Loja Dois', drive: {} }],
    usuarios: {
      chefe: { senha, perfil: 'admin', lojas: ['*'], ativo: true },
      dono1: { senha, perfil: 'franqueado', lojas: ['l1'], ativo: true },
      dono2: { senha, perfil: 'franqueado', lojas: ['l2'], ativo: true },
      gercli: { senha, perfil: 'gerente', lojas: ['l1'], ativo: true, telas: ['clientes'], telasV: 8 },
      vend1: { senha, perfil: 'vendedor', lojas: ['l1'], ativo: true, vendedor: 'ANA' },
    },
  }));
  // cadastro de clientes da loja (como a planilha Dados_Clientes)
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Planilha1');
  ws.addRow(['CPF', 'NOME', 'CELULAR', 'DATA NASC.', 'EMAIL', 'CIDADE']);
  ws.addRow([CPF_A, 'ANA ANTIGA', '62 99999-0001', '', '', 'GOIANIA']);
  ws.addRow([CPF_B, 'BETO', '62 98111-2222', '', '', 'GOIANIA']);
  ws.addRow([CPF_C, 'CARLA', '62 97777-0003', '', '', 'GOIANIA']);
  fs.mkdirSync(path.join(tmp, 'l1'), { recursive: true });
  await wb.xlsx.writeFile(path.join(tmp, 'l1', 'Dados_Clientes.xlsx'));
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-cel', NODE_ENV: 'test', IA_FALSO: '1', ZAP_URL: '', ZAP_TOKEN: '', COLETOR_URL: '', COLETOR_TOKEN: '', GITHUB_TOKEN: '' } });
  await require('./_subir')(srv, BASE);
  for (const nome of ['chefe', 'dono1', 'dono2', 'gercli', 'vend1']) {
    const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': `203.0.113.${ipSeq++}` }, body: `usuario=${nome}&senha=${encodeURIComponent(SENHA)}` });
    cookies[nome] = (r.headers.get('set-cookie') || '').split(';')[0];
  }
});
after(async () => {
  if (srv) { const fim = new Promise((ok) => srv.once('exit', ok)); srv.kill(); await fim; }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // dados temporários do teste: apaga
});

/** os clientes que a pessoa recebe em /api/dados (o pacote é JSON; o cadastro vem em `clientes`) */
async function clientesDe(nome) {
  const r = await pedir(nome, '/api/dados?loja=l1', { headers: { 'Accept-Encoding': 'identity' } });
  assert.strictEqual(r.status, 200);
  const txt = await r.text();
  const j = JSON.parse(txt);
  return { lista: j.clientes || [], txt };
}

test('CLI-CEL: só admin e franqueado da loja vinculam; gerente, vendedora e franqueado de outra loja não', async () => {
  for (const [nome, st] of [['gercli', 403], ['vend1', 403], ['dono2', 400]]) {
    const r = await post(nome, '/api/clientes/celular', { loja: 'l1', cpf: CPF_A, cel: NOVO });
    assert.strictEqual(r.status, st, nome);
  }
  const semCab = await fetch(BASE + '/api/clientes/celular', { method: 'POST', headers: { Cookie: cookies.dono1, 'Content-Type': 'application/json' }, body: JSON.stringify({ loja: 'l1', cpf: CPF_A, cel: NOVO }) });
  assert.strictEqual(semCab.status, 403, 'sem X-Painel');
  assert.deepStrictEqual(vinculos(), {});
  assert.strictEqual((await post('dono1', '/api/clientes/celular', { loja: 'l1', cpf: '00000000000', cel: NOVO })).status, 400, 'cliente que não é da loja');
  assert.strictEqual((await post('dono1', '/api/clientes/celular', { loja: 'l1', cpf: CPF_A, cel: '123' })).status, 400, 'número sem DDD');
});

test('CLI-CEL: vincular troca o celular no pacote (tela e robô), tira o número do outro cliente, audita sem o número completo', async () => {
  const r = await post('dono1', '/api/clientes/celular', { loja: 'l1', cpf: CPF_A, cel: '55' + NOVO });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.vinculo.cel, '55' + NOVO);
  assert.strictEqual(vinculos()[CPF_A].antigo, '62999990001', 'guarda o número do FIXE na hora');
  const { lista } = await clientesDe('chefe');
  const a = lista.find((c) => c.cpf === CPF_A), b = lista.find((c) => c.cpf === CPF_B);
  assert.strictEqual(a.celular, '55' + NOVO, 'o número novo vale');
  assert.strictEqual(a.celFixe.replace(/\D/g, ''), '62999990001');
  assert.ok(a.celVinc && a.celVinc.por === 'dono1');
  assert.strictEqual(b.celular, '', 'quem tinha o mesmo número no FIXE fica sem ele (um número, um cliente)');
  assert.strictEqual(b.celTirado, true);
  // gerente com Clientes recebe o mesmo; a vendedora não recebe cliente nenhum
  assert.strictEqual((await clientesDe('gercli')).lista.find((c) => c.cpf === CPF_A).celular, '55' + NOVO);
  const v = await clientesDe('vend1');
  assert.strictEqual(v.lista.length, 0);
  assert.ok(!v.txt.includes(NOVO));
  // auditoria: CPF abreviado e só os 4 últimos dígitos
  const reg = auditoria().filter((x) => /trocou o celular/.test(x.acao)).pop();
  const linha = JSON.stringify(reg);
  assert.ok(reg && reg.detalhe.fim === '2222');
  assert.ok(!linha.includes(NOVO) && !linha.includes('981112222'), 'nunca o número completo');
  assert.ok(!linha.includes(CPF_A), 'nunca o CPF completo');
  // a Lista de espera acha pelo número novo
  const e = await (await pedir('dono1', '/api/espera/clientes?loja=l1&q=81112222')).json();
  assert.ok(e.clientes.some((c) => c.cpf === CPF_A));
  assert.ok(!e.clientes.some((c) => c.cpf === CPF_B));
});

test('CLI-CEL: o mesmo número em outro cliente tira do anterior; desfazer volta o do FIXE', async () => {
  // o mesmo número sem o 9 (como o WhatsApp antigo manda): é o mesmo número, então sai da A
  const r = await post('chefe', '/api/clientes/celular', { loja: 'l1', cpf: CPF_C, cel: '6281112222' });
  assert.strictEqual((await r.json()).tirouDe, 1);
  assert.strictEqual(vinculos()[CPF_C].cel, '55' + NOVO, 'guardado na forma única (com o 9)');
  assert.deepStrictEqual(Object.keys(vinculos()), [CPF_C]);
  let { lista } = await clientesDe('chefe');
  assert.strictEqual(lista.find((c) => c.cpf === CPF_A).celular.replace(/\D/g, ''), '62999990001', 'A volta ao número do FIXE');
  assert.strictEqual(lista.find((c) => c.cpf === CPF_C).celular, '55' + NOVO);
  assert.strictEqual((await post('gercli', '/api/clientes/celular/desfazer', { loja: 'l1', cpf: CPF_C })).status, 403);
  assert.strictEqual((await post('dono1', '/api/clientes/celular/desfazer', { loja: 'l1', cpf: CPF_C })).status, 200);
  assert.strictEqual((await post('dono1', '/api/clientes/celular/desfazer', { loja: 'l1', cpf: CPF_C })).status, 400, 'nada para desfazer');
  ({ lista } = await clientesDe('chefe'));
  assert.strictEqual(lista.find((c) => c.cpf === CPF_C).celular.replace(/\D/g, ''), '62977770003');
  assert.strictEqual(lista.find((c) => c.cpf === CPF_B).celular.replace(/\D/g, ''), '62981112222', 'B volta a ter o número do FIXE');
  assert.ok(auditoria().some((x) => /desfez a troca de celular/.test(x.acao)));
  // a apresentação só responde (não grava)
  const d = await fetch(BASE + '/api/demo/clientes/celular', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cel: NOVO }) });
  assert.strictEqual(d.status, 200);
  assert.deepStrictEqual(vinculos(), {});
});

test('CLI-CEL: conta pura — aplicar, um número por cliente, com e sem o 9', () => {
  const CEL = require('../../src/celulares');
  const cl = [{ cpf: '1', celular: '6299990001' }, { cpf: '2', celular: '62981112222' }, { cpf: '3', celular: '6281112222' }];
  const out = CEL.aplicar(cl, { 1: { cel: '5562981112222', em: 'x', por: 'p', antigo: '6299990001' } });
  assert.strictEqual(out[0].celular, '5562981112222');
  assert.strictEqual(out[0].celFixe, '6299990001');
  assert.strictEqual(out[1].celular, '');
  assert.strictEqual(out[2].celular, '', 'o mesmo número sem o 9 também');
  assert.strictEqual(cl[0].celular, '6299990001', 'não mexe na lista recebida (cache)');
  assert.strictEqual(CEL.aplicar(cl, {}), cl);
  assert.ok(CEL.mesmoNumero('5562981112222', '6281112222'));
  assert.ok(!CEL.mesmoNumero('', ''));
});

test('CLI-CEL: o "parar" que chega pelo número novo acha o cliente (mesmo antes de o robô mandar algo para ele)', async () => {
  const CEL = require('../../src/celulares');
  const ZF = require('../../src/zapfila');
  const ZL = require('../../src/zaplaco');
  CEL.vincular('l1', { cpf: CPF_A, cel: NOVO, antigo: '62999990001' }, 'teste');
  ZF.mudarEstado('l1', (s) => { s.ligado = true; s.sessao = true; });
  const agora = Date.parse('2026-03-04T13:00:00Z');
  const zap = { ativo: () => true, status: async () => ({ estado: 'conectado' }), optouts: async () => ({ itens: [{ de: '55' + NOVO, em: new Date(agora).toISOString() }] }), enviar: async () => ({ ok: true }) };
  await ZL.passo('l1', agora, { zap, rnd: () => 0 });
  const ct = ZF.lerContatos('l1')[CPF_A];
  assert.ok(ct && ct.optout, 'a cliente do número novo entra em "não quer mensagens"');
  assert.ok(!(ZF.lerContatos('l1')[CPF_B] || {}).optout, 'quem tinha o número no FIXE não');
  CEL.desfazer('l1', CPF_A);
});
