// Correções de segurança: sobe o painel de verdade (dados temporários) e confere cada regra pelo que o servidor responde.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = 3900 + Math.floor(Math.random() * 200); // faixa só deste arquivo
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'senha-teste-123';
const ENV = { PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-seguranca', NODE_ENV: 'test', IA_FALSO: '1', ESPERA_BUSCAS_DIA: '6', LOGIN_ESPERA_MAX_MS: '150' };
let srv, C, INV;
const cookies = {};
let ipSeq = 10;
const ipNovo = () => `203.0.113.${ipSeq++}`; // faixa reservada para documentação/testes

async function subir() {
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '../..'), env: { ...process.env, ...ENV }, stdio: 'ignore' });
  for (let k = 0; k < 300; k++) { try { const r = await fetch(BASE + '/login'); if (r.status < 500) break; } catch { /* subindo */ } await new Promise((ok) => setTimeout(ok, 100)); }
}
async function parar() { if (srv) { const fim = new Promise((ok) => srv.once('exit', ok)); srv.kill(); await fim; srv = null; } }
const entrar = (usuario, senha, ip) => fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': ip || ipNovo() }, body: `usuario=${usuario}&senha=${encodeURIComponent(senha)}` });
const cookieDe = (r) => (r.headers.get('set-cookie') || '').split(';')[0];
const pedir = (nome, url, opt = {}) => fetch(BASE + url, { ...opt, headers: { Cookie: cookies[nome] || '', 'X-Painel': '1', 'Content-Type': 'application/json', ...(opt.headers || {}) } });
const status = async (nome, url, opt) => (await pedir(nome, url, opt)).status;

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  C = require('../../src/config');
  INV = require('../../src/inventario');
  const senha = await C.hashSenhaAsync(SENHA);
  const u = (perfil, extra) => ({ senha, perfil, lojas: ['l1'], ativo: true, ...extra });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    lojas: [{ id: 'l1', nome: 'Loja 1' }],
    uploadToken: 'token-de-teste-do-upload',
    usuarios: {
      dono: u('franqueado', { nome: 'Dona Teste' }),
      ger_notas: u('gerente', { telas: ['notas', 'inventario'], telasV: 8 }),
      vend: u('vendedor', { vendedor: 'ANA' }),
      alvo: u('gerente', { telasV: 8 }),
      sai: u('gerente', { telasV: 8 }),
    },
  }));
  await subir();
  for (const nome of ['dono', 'ger_notas', 'vend', 'sai']) {
    const c = cookieDe(await entrar(nome, SENHA));
    assert.ok(c.startsWith('ts_sess='), `login de ${nome}`);
    cookies[nome] = c;
  }
});
after(async () => {
  await parar();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // dados temporários do teste: apaga
});

test('destinatários do e-mail das devoluções: só admin e franqueado gravam (gerente com Notas não)', async () => {
  const corpo = JSON.stringify({ loja: 'l1', emails: ['franquia@exemplo.com.br'] });
  assert.strictEqual(await status('ger_notas', '/api/devolucoes/destinatarios', { method: 'PUT', body: corpo }), 403);
  assert.strictEqual(await status('vend', '/api/devolucoes/destinatarios', { method: 'PUT', body: corpo }), 403);
  assert.strictEqual(await status('dono', '/api/devolucoes/destinatarios', { method: 'PUT', body: corpo }), 200);
  // o gerente continua vendo (travado na tela) e registrando devolução
  const j = await (await pedir('ger_notas', '/api/devolucoes?loja=l1')).json();
  assert.deepStrictEqual(j.destinatarios, ['franquia@exemplo.com.br']);
});

test('/health sem login devolve só { ok } (nada de ids de loja)', async () => {
  const j = await (await fetch(BASE + '/health')).json();
  assert.deepStrictEqual(j, { ok: true });
});

test('nomes herdados de Object não passam por tipo de planilha (Object.hasOwn)', async () => {
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(200)]);
  const r = await fetch(BASE + '/api/upload/l1/constructor', { method: 'POST', headers: { Authorization: 'Bearer token-de-teste-do-upload' }, body: zip });
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).erro, /Arquivo inválido/);
  const r2 = await pedir('dono', '/api/admin/lojas/l1/upload/toString', { method: 'POST', body: zip, headers: { 'Content-Type': 'application/octet-stream' } });
  assert.strictEqual(r2.status, 400);
  assert.match((await r2.json()).erro, /Tipo de planilha inválido/);
});

test('inventário: GET da planilha não fecha a contagem; gerar é POST com X-Painel', async () => {
  const cat = [{ cod: '1', desc: 'Chá A', un: 'UN', qtd: 5, custo: 2 }];
  const c = INV.criar('l1', { cods: ['1'] }, 'dono', cat, 'gerente').ok;
  INV.contar('l1', c.id, '1', 3, 'dono');
  const url = `/api/inventario/contagem/${c.id}/planilha?loja=l1`;
  assert.strictEqual(await status('dono', url), 409, 'GET antes de gerar: não gera sozinho');
  assert.strictEqual(INV.ler('l1', c.id).st, 'contando', 'o GET não mudou o estado');
  assert.ok(!INV.ler('l1', c.id).planilha);
  assert.strictEqual(await status('dono', url, { method: 'POST', headers: { 'X-Painel': '0' } }), 403, 'POST sem X-Painel');
  assert.strictEqual(await status('vend', url, { method: 'POST' }), 403, 'vendedora não gera');
  assert.strictEqual(INV.ler('l1', c.id).st, 'contando');
  const r = await pedir('dono', url, { method: 'POST' });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /spreadsheetml/);
  assert.ok((await r.arrayBuffer()).byteLength > 1000);
  const depois = INV.ler('l1', c.id);
  assert.strictEqual(depois.st, 'gerado');
  assert.strictEqual(depois.planilha.itens[0].nova, 3);
  // depois de gerada, o GET só relê a mesma planilha (sem regravar)
  const em = depois.planilha.em;
  assert.strictEqual(await status('dono', url), 200);
  assert.strictEqual(INV.ler('l1', c.id).planilha.em, em);
  // desfazer: o GET também não marca nada
  assert.strictEqual(await status('dono', `/api/inventario/contagem/${c.id}/desfazer?loja=l1`), 400);
});

test('Lista de espera: vendedora precisa de 4 letras no nome e tem teto de buscas por dia (com auditoria)', async () => {
  const j3 = await (await pedir('vend', '/api/espera/clientes?loja=l1&q=ana')).json();
  assert.deepStrictEqual(j3.clientes, []);
  assert.match(j3.dica, /4 letras/);
  // quem tem a tela Clientes (franqueado) continua buscando com 3 letras e sem teto
  const jd = await (await pedir('dono', '/api/espera/clientes?loja=l1&q=ana')).json();
  assert.ok(!jd.dica);
  for (let k = 0; k < 6; k++) assert.strictEqual(await status('vend', '/api/espera/clientes?loja=l1&q=maria'), 200, `busca ${k + 1}`);
  const r = await pedir('vend', '/api/espera/clientes?loja=l1&q=maria');
  assert.strictEqual(r.status, 429);
  assert.match((await r.json()).erro, /limite de buscas/);
  for (let k = 0; k < 8; k++) assert.strictEqual(await status('dono', '/api/espera/clientes?loja=l1&q=maria'), 200);
  const aud = C.lerAuditoria(50).filter((a) => a.usuario === 'vend' || a.user === 'vend' || JSON.stringify(a).includes('"vend"'));
  assert.ok(aud.some((a) => /muitas buscas de clientes/.test(a.acao)), 'aviso de volume na auditoria');
  assert.ok(aud.some((a) => /limite diário de buscas/.test(a.acao)), 'teto na auditoria');
});

test('login: errar a senha de outra pessoa (de vários IPs) não trava a conta dela; por IP+usuário continua bloqueando', async () => {
  // 34 senhas erradas para "alvo", cada uma de um IP: antes, com 30 a conta travava para todo mundo por 15 min
  for (let k = 0; k < 34; k++) {
    const r = await entrar('alvo', 'errada-' + k);
    assert.match(r.headers.get('location'), /e=1/, `tentativa ${k + 1} é só "senha errada"`);
  }
  const t0 = Date.now();
  const ok = await entrar('alvo', SENHA);
  assert.ok(cookieDe(ok).startsWith('ts_sess='), 'a senha certa continua entrando');
  assert.ok(Date.now() - t0 >= 100, 'mas com atraso (a força bruta fica lenta)');
  // do mesmo IP: 8 erros bloqueiam aquele IP para aquele usuário (mesmo com a senha certa depois)
  const ip = ipNovo();
  for (let k = 0; k < 8; k++) await entrar('alvo', 'errada', ip);
  assert.match((await entrar('alvo', SENHA, ip)).headers.get('location'), /e=limite/);
  // e de outro IP a dona da conta segue entrando
  assert.ok(cookieDe(await entrar('alvo', SENHA)).startsWith('ts_sess='));
  assert.ok(C.lerAuditoria(80).some((a) => /muitas senhas erradas/.test(a.acao)), 'fica na auditoria');
});

test('apresentação: rotas com corpo têm limite por IP', async () => {
  const ip = ipNovo();
  const put = () => fetch(BASE + '/api/demo/ia/chave', { method: 'PUT', headers: { 'X-Forwarded-For': ip, 'Content-Type': 'application/json' }, body: '{}' });
  const rs = await Promise.all(Array.from({ length: 240 }, put));
  assert.ok(rs.every((r) => r.status === 400), 'dentro do limite responde normal');
  assert.strictEqual((await put()).status, 429);
  // leitura (GET) e outro IP não são afetados
  assert.strictEqual((await fetch(BASE + '/api/demo/ia/estado', { headers: { 'X-Forwarded-For': ip } })).status, 200);
  assert.strictEqual((await fetch(BASE + '/api/demo/ia/chave', { method: 'PUT', headers: { 'X-Forwarded-For': ipNovo() } })).status, 400);
});

test('vendedora: não consulta o coletor (/api/script) e "atualizar=1" não força a releitura', async () => {
  const r = await pedir('vend', '/api/script?loja=l1');
  assert.strictEqual(r.status, 403);
  assert.strictEqual((await r.json()).disponivel, false);
  assert.strictEqual(await status('dono', '/api/script?loja=l1'), 200);
  const a = await pedir('vend', '/api/dados?loja=l1');
  const b = await pedir('vend', '/api/dados?loja=l1&atualizar=1');
  assert.strictEqual(b.status, a.status);
  if (a.status === 200) assert.strictEqual(b.headers.get('x-dados-em'), a.headers.get('x-dados-em'), 'mesma carga: não releu as planilhas');
});

test('análise do dia (IA): fica registrado quem gerou', async () => {
  const chave = 'sk-ant-api03-' + 'x'.repeat(40) + 'AB12'; // formato válido, chave fictícia (IA_FALSO: nada sai do servidor)
  assert.strictEqual(await status('dono', '/api/ia/chave', { method: 'PUT', body: JSON.stringify({ loja: 'l1', chave }) }), 200);
  const r = await pedir('dono', '/api/ia/diagnostico', { method: 'POST', body: JSON.stringify({ loja: 'l1', fatos: { vendas: 10, avisos: [] } }) });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.por, 'Dona Teste');
  const de2 = await (await pedir('dono', '/api/ia/diagnostico', { method: 'POST', body: JSON.stringify({ loja: 'l1', fatos: { vendas: 999 } }) })).json();
  assert.strictEqual(de2.guardada, true);
  assert.strictEqual(de2.por, 'Dona Teste');
  assert.ok(C.lerAuditoria(80).some((a) => /gerou a análise do dia/.test(a.acao)));
});

test('mensagem de erro: caminho do servidor não vai para a tela; validação escrita à mão passa', () => {
  let e;
  try { fs.readFileSync(path.join(tmp, 'nao-existe', 'x.json')); } catch (err) { e = err; }
  const erroLog = console.error; console.error = () => {};
  try {
    const m = C.msgErro(e, 'teste');
    assert.strictEqual(m, C.MSG_ERRO_INTERNO);
    assert.ok(!m.includes(tmp));
    assert.strictEqual(C.msgErro(new Error(`falhou ao abrir ${C.DATA_DIR}/l1/a.xlsx`)), C.MSG_ERRO_INTERNO);
  } finally { console.error = erroLog; }
  assert.strictEqual(C.msgErro(new Error('Informe o mês (AAAA-MM).')), 'Informe o mês (AAAA-MM).');
  const rede = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED', syscall: 'connect' });
  assert.strictEqual(C.msgErro(rede), 'connect ECONNREFUSED 127.0.0.1:9', 'erro de rede (sem caminho) continua explicando');
});

test('"Sair" continua valendo depois de reiniciar o painel (fica no disco) e não derruba as outras sessões', async () => {
  assert.strictEqual(await status('sai', '/api/eu'), 200);
  const outra = cookieDe(await entrar('sai', SENHA)); // a mesma pessoa em outro aparelho
  const r = await fetch(BASE + '/logout', { method: 'POST', redirect: 'manual', headers: { Cookie: cookies.sai } });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(await status('sai', '/api/eu'), 401);
  const arq = path.join(tmp, 'sessoes-encerradas.json');
  const guardado = fs.readFileSync(arq, 'utf8');
  assert.ok(JSON.parse(guardado).length === 1);
  assert.ok(!guardado.includes('sai'), 'só a assinatura e a validade; nada do usuário');
  await parar();
  await subir();
  assert.strictEqual(await status('sai', '/api/eu'), 401, 'o cookie de quem saiu não volta a valer');
  assert.strictEqual((await fetch(BASE + '/api/eu', { headers: { Cookie: outra } })).status, 200, 'a outra sessão segue valendo');
  assert.strictEqual(await status('dono', '/api/eu'), 200);
});

test('e-mail do FIXE: só vale com DKIM/DMARC do domínio do FIXE confirmado pelo servidor que recebeu', async () => {
  const FX = require('../../src/fixemail');
  const { simpleParser } = require('mailparser');
  const email = (ars, de = 'FIXE <fixe@fixecrm.com.br>') => simpleParser([...ars.map((a) => 'Authentication-Results: ' + a), 'From: ' + de, 'To: loja@exemplo.com.br', 'Subject: [Tea Shop] Arquivo Exportado', '', 'oi'].join('\r\n'));
  const ok = async (...a) => FX.remetenteAutenticado(await email(...a));
  // assinatura do próprio domínio
  assert.strictEqual(await ok(['mx.google.com; dkim=pass header.i=@fixecrm.com.br header.s=s1 header.b=AbC; spf=pass (google.com: domain of x@envio.exemplo.com designates 198.51.100.7 as permitted sender) smtp.mailfrom=x@envio.exemplo.com']), true);
  assert.strictEqual(await ok(['mx.google.com; dkim=pass header.d=mail.fixecrm.com.br header.s=s1']), true);
  assert.strictEqual(await ok(['mx.google.com; dkim=pass header.i=@envio.exemplo.com; spf=pass smtp.mailfrom=x@envio.exemplo.com; dmarc=pass (p=NONE) header.from=fixecrm.com.br']), true, 'DMARC do domínio passou');
  // spf=pass sozinho não diz nada sobre o "De"
  assert.strictEqual(await ok(['mx.google.com; spf=pass smtp.mailfrom=qualquer@atacante.exemplo.com']), false);
  // sem conferência nenhuma
  assert.strictEqual(await ok([]), false);
  // DKIM de outro domínio (o atacante assina o próprio domínio e põe o FIXE no "De")
  assert.strictEqual(await ok(['mx.google.com; dkim=pass header.i=@atacante.exemplo.com; spf=pass smtp.mailfrom=a@atacante.exemplo.com; dmarc=fail header.from=fixecrm.com.br']), false);
  assert.strictEqual(await ok(['mx.google.com; dkim=pass header.i=@fixecrm.com.br.atacante.exemplo.com']), false, 'domínio parecido não vale');
  assert.strictEqual(await ok(['mx.google.com; dkim=fail header.i=@fixecrm.com.br; spf=pass smtp.mailfrom=a@b.exemplo.com']), false);
  // cabeçalho pronto de quem mandou fica abaixo do que o servidor escreveu: só o do topo conta
  assert.strictEqual(await ok(['mx.google.com; dkim=none; spf=pass smtp.mailfrom=a@atacante.exemplo.com', 'mx.google.com; dkim=pass header.i=@fixecrm.com.br']), false);
  // comentário não engana a leitura
  assert.strictEqual(await ok(['mx.google.com; dkim=fail (dkim=pass header.i=@fixecrm.com.br) header.i=@atacante.exemplo.com']), false);
  // outro remetente
  assert.strictEqual(await ok(['mx.google.com; dkim=pass header.i=@fixecrm.com.br'], 'Outro <outro@fixecrm.com.br>'), false);
});

test('link do e-mail do FIXE: só https e só do domínio do FIXE', () => {
  const FX = require('../../src/fixemail');
  const a = (href, txt = 'Baixar agora') => `<p><a href="${href}">${txt}</a></p>`;
  assert.strictEqual(FX.linkDoEmail(a('https://app.fixecrm.com.br/exportacoes/1?a=1&amp;b=2')), 'https://app.fixecrm.com.br/exportacoes/1?a=1&b=2');
  assert.strictEqual(FX.linkDoEmail(a('https://fixecrm.com.br/x.xlsx', 'arquivo')), 'https://fixecrm.com.br/x.xlsx');
  assert.strictEqual(FX.linkDoEmail(a('https://atacante.exemplo.com/planilha.xlsx')), null);
  assert.strictEqual(FX.linkDoEmail(a('http://app.fixecrm.com.br/x.xlsx')), null, 'http não');
  assert.strictEqual(FX.linkDoEmail(a('https://fixecrm.com.br.atacante.exemplo.com/x.xlsx')), null);
  assert.strictEqual(FX.linkDoEmail(a('https://fixecrm.com.br@atacante.exemplo.com/x.xlsx')), null);
  assert.strictEqual(FX.linkDoEmail(a('https://app.fixecrm.com.br:pw@atacante.exemplo.com/')), null);
  // um link estranho antes do verdadeiro não passa na frente
  assert.strictEqual(FX.linkDoEmail(a('https://atacante.exemplo.com/x') + a('https://app.fixecrm.com.br/y')), 'https://app.fixecrm.com.br/y');
  // o dono pode liberar outro endereço sem mexer no código
  process.env.FIXE_LINK_DOMINIOS = 'arquivos.exemplo.com.br';
  try { assert.strictEqual(FX.linkDoEmail(a('https://arquivos.exemplo.com.br/x.xlsx')), 'https://arquivos.exemplo.com.br/x.xlsx'); } finally { delete process.env.FIXE_LINK_DOMINIOS; }
  assert.strictEqual(FX.linkDoEmail(a('https://arquivos.exemplo.com.br/x.xlsx')), null);
});

test('código do carrinho: renova enquanto está em uso, mas só até 3 h depois de gerado', (t) => {
  const PED = require('../../src/pedido');
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-19T12:00:00Z') });
  const { codigo } = PED.criarCodigo('l1', [{ cod: '1', nome: 'Chá A', qtd: 2 }], 'dono');
  const passo = { itens: [{ cod: '1', nome: 'Chá A', pedido: 2, qtd: 2, status: 'ok' }] };
  // 2 h 50 min usando sem parar (um aviso a cada 10 min): segue valendo
  for (let k = 0; k < 17; k++) { t.mock.timers.tick(10 * 60e3); assert.ok(PED.progresso(codigo, passo).ok, `aos ${(k + 1) * 10} min`); }
  assert.ok(Date.parse(PED.carrinho('l1').expira) <= Date.parse('2026-11-19T15:00:00Z'), 'a validade não passa de 3 h da geração');
  t.mock.timers.tick(11 * 60e3); // 3 h 01 min
  assert.match(PED.progresso(codigo, passo).erro, /vencido/);
  assert.strictEqual(PED.lerCodigo(codigo), null);
});
