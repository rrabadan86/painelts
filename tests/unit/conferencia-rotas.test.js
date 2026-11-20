// Vendas → Conferência no servidor: quem pode ver, o que a rota entrega a partir dos arquivos da loja (vendas, fechamento
// do caixa e XML cancelado) e a opção da loja de tirar cupom cancelado das vendas (padrão: só avisar).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conf-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = 4100 + Math.floor(Math.random() * 200); // faixa só deste arquivo
const BASE = `http://127.0.0.1:${PORTA}`;
let srv;
const cookies = {};
const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const menos = (n) => new Date(Date.parse(hoje + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const D3 = menos(3), D2 = menos(2), D1 = menos(1);
const chave = (num) => '5226' + '0'.repeat(16) + '65' + '001' + String(num).padStart(9, '0') + '1'.repeat(10);

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  const C = require('../../src/config');
  const senha = await C.hashSenhaAsync('senha-teste-123');
  const u = (perfil, extra) => ({ senha, perfil, lojas: ['l1'], ativo: true, ...extra });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    lojas: [{ id: 'l1', nome: 'Loja 1' }, { id: 'l2', nome: 'Loja 2 (de outro franqueado)' }],
    usuarios: { dono: u('franqueado'), ger_com: u('gerente', { telas: ['resumo', 'conferencia'], telasV: 8 }), ger_sem: u('gerente', { telas: ['resumo', 'cupons'], telasV: 8 }), ger_pad: u('gerente', { telasV: 8 }), vend: u('vendedor', { vendedor: 'ANA' }) },
  }));
  // vendas: [data, cupom, loja, vendedor, descricao, produto, grupo, grupoC, cat, subgrupo, qtd, soNumeros, qtdCha, vu, du, vt, min, cod]
  const linha = (data, cupom, vt, vendedor = 'ANA', descricao = 'Chá X 50G') => [data, cupom, 'LOJA 1', vendedor, descricao, 'Chá X', 'CHÁ PRETO AROMATIZADO', 'CHÁ AROMATIZADO', '', '', 1, 50, 0.05, vt, 0, vt, 600, '1'];
  const vendas = [linha(D3, 101, 200), linha(D3, 102, 100), linha(D3, 102, 15, 'ANA', 'Taxa de Serviço'), // dia D3: 300 + 15 de taxa
    linha(D2, 201, 400), linha(D2, 202, 80, 'BIA'), // dia D2: 480; o cupom 202 foi cancelado
    linha(D1, 301, 250)]; // dia D1: sem fechamento
  const porMes = new Map();
  for (const l of vendas) { const ym = l[0].slice(0, 7); if (!porMes.has(ym)) porMes.set(ym, []); porMes.get(ym).push(l); }
  fs.mkdirSync(path.join(tmp, 'l1', 'base'), { recursive: true });
  for (const [ym, ls] of porMes) fs.writeFileSync(path.join(tmp, 'l1', 'base', `${ym}.json.gz`), zlib.gzipSync(JSON.stringify(ls)));
  // caixa: D3 = 315 (as vendas + a taxa de serviço) com falta de R$ 10 na gaveta; D2 = 400 (sem o cupom cancelado)
  const fech = (dia, total, reserva, op) => ({ id: dia, numero: 1, dia, pdv: 1, turno: 'Único', abertura: dia + 'T10:00:00', fechamento: dia + 'T22:00:00', opAbertura: op, opFechamento: op, fundoInicial: 300, reserva, cancelado: dia === D2 ? 80 : 0,
    recebimentos: [{ forma: 'Pix', venda: total - 50, informado: total - 50, dif: 0 }, { forma: 'Dinheiro', venda: 50, informado: 50, dif: 0 }], sangrias: [], suprimentos: [] });
  fs.mkdirSync(path.join(tmp, 'l1', 'caixa'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'l1', 'caixa', 'fechamentos.json'), JSON.stringify({ atualizado: new Date().toISOString(), fechamentos: [fech(D3, 315, 340, 'Carla'), fech(D2, 400, 350, 'Carla')] }));
  // XML cancelado do cupom 202 (NFC-e) + o evento do cancelamento (não conta de novo) + uma devolução cancelada (não é venda)
  const dir = path.join(tmp, 'l1', 'xmls', D2.slice(0, 7), 'cancelados');
  fs.mkdirSync(dir, { recursive: true });
  const xml = (num, v, extra = '') => `<nfeProc><NFe><infNFe><ide><mod>65</mod><nNF>${num}</nNF><tpNF>1</tpNF>${extra}</ide><total><ICMSTot><vNF>${v}</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
  fs.writeFileSync(path.join(dir, `${D2.replace(/-/g, '')}_${chave(202)}.xml`), xml(202, '80.00'));
  fs.writeFileSync(path.join(dir, `${D2.replace(/-/g, '')}_evento_${chave(202)}.xml`), '<procEventoNFe/>');
  fs.writeFileSync(path.join(dir, `${D2.replace(/-/g, '')}_${chave(900)}.xml`), xml(900, '500.00', '<finNFe>4</finNFe>'));

  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-conferencia', NODE_ENV: 'test' }, stdio: 'ignore' });
  for (let k = 0; k < 100; k++) { try { const r = await fetch(BASE + '/login'); if (r.status < 500) break; } catch { /* subindo */ } await new Promise((ok) => setTimeout(ok, 100)); }
  for (const nome of ['dono', 'ger_com', 'ger_sem', 'ger_pad', 'vend']) {
    const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `usuario=${nome}&senha=senha-teste-123` });
    const c = (r.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(c.startsWith('ts_sess='), `login de ${nome}`);
    cookies[nome] = c;
  }
});
after(async () => {
  if (srv) { const fim = new Promise((ok) => srv.once('exit', ok)); srv.kill(); await fim; }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // dados temporários do teste: apaga
});

const pedir = (nome, url, opt = {}) => fetch(BASE + url, { ...opt, headers: { Cookie: cookies[nome], 'Content-Type': 'application/json', ...(opt.headers || {}) } });
const fatPainel = async (nome) => {
  const d = await (await pedir(nome, '/api/dados?loja=l1')).json();
  return d.vendas.vt.reduce((s, x, i) => s + (d.dict.descricao[d.vendas.descricao[i]] === 'Taxa de Serviço' ? 0 : x), 0);
};

test('quem vê a Conferência: admin/franqueado e gerente com a tela; vendedora e gerente sem a tela não; nunca outra loja', async () => {
  assert.strictEqual((await pedir('dono', '/api/conferencia?loja=l1')).status, 200);
  assert.strictEqual((await pedir('ger_com', '/api/conferencia?loja=l1')).status, 200);
  assert.strictEqual((await pedir('ger_sem', '/api/conferencia?loja=l1')).status, 403);
  assert.strictEqual((await pedir('ger_pad', '/api/conferencia?loja=l1')).status, 403, 'a tela não vem marcada no padrão do gerente');
  assert.strictEqual((await pedir('vend', '/api/conferencia?loja=l1')).status, 403);
  assert.strictEqual((await pedir('dono', '/api/conferencia?loja=l2')).status, 400, 'loja de outro franqueado');
});

test('a rota confere o faturamento do painel com o caixa, explica a taxa de serviço e marca o cupom cancelado que ainda conta', async () => {
  const d = await (await pedir('dono', '/api/conferencia?loja=l1')).json();
  assert.deepStrictEqual(d.cfg, { tolerancia: 1, cancelados: 'avisar' });
  const por = Object.fromEntries(d.lista.map((x) => [x.dia, x]));
  assert.deepStrictEqual([por[D3].fat, por[D3].caixa, por[D3].dif, por[D3].estado, por[D3].cod], [300, 315, 15, 'explicado', 'taxa']);
  assert.deepStrictEqual([por[D3].gaveta, por[D3].operador], [-10, 'Carla'], 'gaveta: 340 contados − (300 + 50 em dinheiro)');
  assert.deepStrictEqual([por[D2].fat, por[D2].caixa, por[D2].dif, por[D2].estado, por[D2].cod], [480, 400, -80, 'explicado', 'cancelado']);
  assert.strictEqual(por[D1].estado, 'semfechamento');
  assert.deepStrictEqual(d.cancelados.lista.map((x) => [x.numero, x.valor, x.nasVendas, x.valorVendas, x.vendedores]), [[202, 80, true, 80, ['BIA']]], 'a devolução cancelada e o evento não entram');
  assert.deepStrictEqual(d.cancelados.impacto, { cupons: 1, valor: 80, valorMeta: 80 });
  assert.strictEqual(d.cancelados.pdv.total, 80);
  assert.deepStrictEqual(d.formas.map((f) => [f.rot, f.valor]), [['Pix', 615], ['Dinheiro', 100]]);
  assert.deepStrictEqual([d.sobras.faltas.n, d.sobras.faltas.valor], [1, -10]);
  assert.strictEqual(d.podeCfg, true);
  assert.strictEqual(d.fontes.find((f) => f.id === 'caixa').sinal, 'verde');
  assert.strictEqual(d.fontes.find((f) => f.id === 'estoque').sinal, 'cinza', 'sem estoque: sem dados, não um número inventado');
  assert.strictEqual((await (await pedir('ger_com', '/api/conferencia?loja=l1')).json()).podeCfg, false);
});

test('ajustes: só admin/franqueado, com X-Painel; valores inválidos são recusados', async () => {
  const put = (nome, corpo, cab = { 'X-Painel': '1' }) => pedir(nome, '/api/conferencia/cfg?loja=l1', { method: 'PUT', headers: cab, body: JSON.stringify(corpo) });
  assert.strictEqual((await put('dono', { tolerancia: 5 }, {})).status, 403, 'sem X-Painel');
  assert.strictEqual((await put('ger_com', { tolerancia: 5 })).status, 403);
  assert.strictEqual((await put('vend', { cancelados: 'excluir' })).status, 403);
  assert.strictEqual((await put('dono', { tolerancia: -1 })).status, 400);
  assert.strictEqual((await put('dono', { cancelados: 'apagar' })).status, 400);
  assert.strictEqual((await pedir('dono', '/api/conferencia/cfg?loja=l2', { method: 'PUT', headers: { 'X-Painel': '1' }, body: '{"tolerancia":5}' })).status, 400);
  const r = await put('dono', { tolerancia: '20,5' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual((await r.json()).cfg, { tolerancia: 20.5, cancelados: 'avisar' });
  const d = await (await pedir('dono', '/api/conferencia?loja=l1')).json();
  assert.strictEqual(d.lista.find((x) => x.dia === D3).estado, 'bate', 'R$ 15 de diferença cabem na tolerância nova');
  await put('dono', { tolerancia: 1 });
});

test('cupom cancelado: por padrão só avisa (as vendas não mudam); com "tirar das vendas" ele sai do painel e a mudança é auditada', async () => {
  assert.strictEqual(await fatPainel('dono'), 1030, 'padrão: o cupom cancelado continua nas vendas');
  const r = await pedir('dono', '/api/conferencia/cfg?loja=l1', { method: 'PUT', headers: { 'X-Painel': '1' }, body: JSON.stringify({ cancelados: 'excluir' }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(await fatPainel('dono'), 950, 'antes R$ 1.030 → depois R$ 950 (sem o cupom 202 de R$ 80)');
  const d = await (await pedir('dono', '/api/conferencia?loja=l1')).json();
  assert.deepStrictEqual(d.cancelados.impacto, { cupons: 0, valor: 0, valorMeta: 0 });
  assert.deepStrictEqual(d.cancelados.excluidos, { cupons: 1, valor: 80 });
  const d2 = d.lista.find((x) => x.dia === D2);
  assert.deepStrictEqual([d2.fat, d2.dif, d2.estado], [400, 0, 'bate']);
  const aud = fs.readdirSync(tmp).filter((f) => /audit/i.test(f)).map((f) => fs.readFileSync(path.join(tmp, f), 'utf8')).join('\n');
  assert.match(aud, /TIRAR das vendas os cupons cancelados/);
  // volta ao padrão
  await pedir('dono', '/api/conferencia/cfg?loja=l1', { method: 'PUT', headers: { 'X-Painel': '1' }, body: JSON.stringify({ cancelados: 'avisar' }) });
  assert.strictEqual(await fatPainel('dono'), 1030);
});
