// Regras de permissão e segurança que ainda não tinham teste (PERF, SEG, APP, ORC, EQP, PRC, IA, NFE).
// Sobe o painel de verdade (dados temporários, coletor de mentira, IA simulada) com usuários de cada perfil e confere
// pelo que o servidor responde. Nada de segredo real: senhas, tokens e chaves abaixo são de mentira.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'segperf-'));
const CONFIG_FILE = path.join(tmp, 'lojas.json');
const PORTA = require('./_porta')(6700, 100); // faixa só deste arquivo (6700–6799); coletor de mentira em listen(0)
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'senha-teste-123';
// valores de mentira (formato parecido com o de verdade, para as validações aceitarem)
const TOKEN_TG = '987654321:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const SMTP_REDE = 'senha-smtp-rede-falsa';
const GMAIL_LOJA = 'senha-app-gmail-falsa';
const FIXE_PASS = 'senha-fixe-falsa';
const APPNEXT_PASS = 'senha-appnext-falsa';
const TOKEN_GERAL = 'token-upload-geral-de-teste-0123456789';
const TOKEN_L1 = 'token-upload-l1-de-teste-0123456789';
const TOKEN_L2 = 'token-upload-l2-de-teste-0123456789';
const CHAVE_IA = 'sk-ant-api03-' + 'y'.repeat(40) + 'ZZ99';
const DEV_FILA = 'aaaaaaaaaaa1', DEV_OK = 'aaaaaaaaaaa2', DEV_CONCL = 'aaaaaaaaaaa3', NFE_TESTE = 'bbbbbbbbbbb1';

let srv, col;
const cookies = {};
let ipSeq = 10;
const proximoIp = () => `198.51.100.${ipSeq++ % 250}`;

const pedir = (nome, url, opt = {}) => fetch(BASE + url, { redirect: 'manual', ...opt, headers: { Cookie: cookies[nome] || '', 'X-Painel': '1', 'Content-Type': 'application/json', ...(opt.headers || {}) } });
const status = async (nome, url, opt) => (await pedir(nome, url, opt)).status;
const corpo = (method, b) => ({ method, body: JSON.stringify(b || {}) });
/** o mesmo pedido, mas sem o cabeçalho X-Painel (como faria um site de terceiros) */
const semX = (nome, url, opt = {}) => fetch(BASE + url, { redirect: 'manual', ...opt, headers: { Cookie: cookies[nome] || '', 'Content-Type': 'application/json' } });
const lerAud = () => { try { return fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const form = (o) => new URLSearchParams(o).toString();

async function entrar(nome, senha = SENHA, extra = {}) {
  const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': proximoIp(), ...extra }, body: form({ usuario: nome, senha }) });
  const c = (r.headers.get('set-cookie') || '').split(';')[0];
  return { r, cookie: c.startsWith('ts_sess=') ? c : null };
}

before(async () => {
  process.env.DATA_DIR = tmp; process.env.CONFIG_FILE = CONFIG_FILE;
  const C = require('../../src/config');
  const senha = await C.hashSenhaAsync(SENHA);
  const u = (perfil, lojas, extra) => ({ senha, perfil, lojas, ativo: true, ...extra });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    uploadToken: TOKEN_GERAL,
    lojas: [
      { id: 'l1', nome: 'Loja Um', uploadToken: TOKEN_L1,
        // equipe, escala, feriados e banco de horas com nomes das colegas (EQP-10)
        operacao: { equipe: { funcionarios: 2, nomes: ['ANA LIMA', 'BIA REIS'], pessoas: [{ nome: 'BIA REIS', folga: 'seg' }] } },
        escalaAjustes: { '2026-11': { '2026-11-03': { 'BIA REIS': { tipo: 'folga' } } } },
        feriadosHoras: { '2026-11': { '2026-11-15': { 'BIA REIS': 6, 'ANA LIMA': 4 } } },
        bancoHoras: { padrao: 'banco', prazo: 6, desde: '2026-11', lanc: [{ pessoa: 'BIA REIS', horas: 12, motivo: 'feriado' }] },
        ferias: [{ vendedor: 'BIA REIS', de: '2026-11-20', ate: '2026-11-25' }] },
      { id: 'l2', nome: 'Loja Dois', uploadToken: TOKEN_L2 },
      { id: 'l3', nome: 'Loja Tres' },
    ],
    usuarios: {
      chefe: u('admin', ['*']),
      dono: u('franqueado', ['l1', 'l3']),
      dono2: u('franqueado', ['l2']),
      dono_ia: u('franqueado', ['l1']),
      ger_l1: u('gerente', ['l1'], { telas: ['resumo', 'validade'], telasV: 8 }),
      ger_l2: u('gerente', ['l2'], { telas: ['resumo'], telasV: 8 }),
      ger_l12: u('gerente', ['l1', 'l2'], { telas: ['resumo'], telasV: 8 }),
      // gerente com todas as telas, até a do orçamento forçada no arquivo: mesmo assim não faz orçamento (ORC-01)
      ger_tudo: u('gerente', ['l1'], { telas: ['resumo', 'orcamento', 'dre', 'estoque', 'precos', 'site', 'notas', 'pedido', 'validade', 'rentab', 'mapa'], telasV: 8 }),
      vend: u('vendedor', ['l1'], { vendedor: 'ANA LIMA' }),
      vend_l2: u('vendedor', ['l2'], { vendedor: 'CAIO' }),
      troca: u('gerente', ['l1'], { telas: ['resumo'], telasV: 8 }),
    },
  }));
  // segredos de mentira guardados no servidor (SEG-03): SMTP e Telegram da rede, Gmail da loja, AppNext e FIXE
  fs.writeFileSync(path.join(tmp, 'notificacoes.json'), JSON.stringify({
    ativo: true, horario: '08:00',
    telegram: { token: TOKEN_TG, destinos: [{ chatId: '444444', nome: 'TG da loja um', lojas: ['l1'] }] },
    email: { host: 'smtp.rede.exemplo.com.br', port: 587, user: 'rede@exemplo.com.br', pass: SMTP_REDE, from: 'Rede <rede@exemplo.com.br>', destinos: [{ email: 'um@exemplo.com.br', nome: 'Da um', lojas: ['l1'] }] },
    lojas: { l1: { email: { host: 'smtp.gmail.com', port: 587, user: 'loja.um@exemplo.com.br', pass: GMAIL_LOJA, from: 'Loja Um <loja.um@exemplo.com.br>' }, destinos: [], fechamento: { ativo: false, horario: '23:30' } } },
  }));
  fs.mkdirSync(C.COLETOR_DIR, { recursive: true });
  fs.writeFileSync(path.join(C.COLETOR_DIR, 'l1.env'), `APPNEXT_REDE=rede\nAPPNEXT_USER=u\nAPPNEXT_PASS=${APPNEXT_PASS}\nFIXE_URL=https://fixe.exemplo.com.br\nFIXE_USER=u\nFIXE_PASS=${FIXE_PASS}\n`);
  // estoque com um chá a granel a R$ 123,45 o kg (PRC-03)
  const pastaEst = path.join(C.pastaLoja('l1'), 'estoque');
  fs.mkdirSync(pastaEst, { recursive: true });
  fs.writeFileSync(path.join(pastaEst, 'atual.json'), JSON.stringify({ em: new Date().toISOString(), itens: [{ cod: '101', desc: 'CHA VERDE TESTE', un: 'KG', qtd: 2, custo: 123.45 }] }));
  // cadastro de preços com custo (PRC-07: a tela Site recebe só o preço de tabela)
  const pastaCad = path.join(C.pastaLoja('l1'), 'cadastro');
  fs.mkdirSync(pastaCad, { recursive: true });
  fs.writeFileSync(path.join(pastaCad, 'tabela.json'), JSON.stringify({ simples: { em: new Date().toISOString(), origem: 'teste', itens: [{ cod: '101', desc: 'CHA VERDE TESTE 100G', un: 'UN', grupo: 'CHÁ VERDE', preco: 39.9, custo: 17.77 }] } }));
  // devoluções com a NF-e já pedida, gravada ou concluída (NFE-04)
  const dev = (id, nfe) => {
    const p = path.join(C.pastaLoja('l1'), 'devolucoes', id);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'devolucao.json'), JSON.stringify({ id, em: new Date().toISOString(), por: 'dono', nota: { id: '1', nf: '555' }, itens: [], nfe }));
  };
  dev(DEV_FILA, { estado: 'na_fila', em: new Date().toISOString() });
  dev(DEV_OK, { estado: 'ok', em: new Date().toISOString(), chave: '5'.repeat(44) });
  dev(DEV_CONCL, { estado: 'concluida', em: new Date().toISOString() });
  // coletor de mentira: o robô da NF-e "já está trabalhando" (409) para qualquer pedido de NF-e
  // NF-e de venda já testada (estado "teste", há 5 min), pronta para emitir (NFE-04)
  const pastaNfe = path.join(C.pastaLoja('l1'), 'nfe');
  fs.mkdirSync(path.join(pastaNfe, 'envio'), { recursive: true });
  const ha5min = new Date(Date.now() - 5 * 60e3).toISOString();
  fs.writeFileSync(path.join(pastaNfe, 'rascunhos.json'), JSON.stringify([{ id: NFE_TESTE, estado: 'teste', simular: true, em: ha5min, fim: ha5min, por: 'dono', parceiro: { nome: 'Empresa Teste' }, itens: [{ cod: '101', qtd: 1 }], total: 10, totalAppNext: 10 }]));
  fs.writeFileSync(path.join(pastaNfe, 'envio', NFE_TESTE + '.json'), JSON.stringify({ parceiroId: '1', itens: [{ cod: '101', qtd: 1 }], total: 10, simular: true }));
  // coletor de mentira: o robô da NF-e "já está trabalhando" (409) quando pedem a leitura dos cadastros; o resto aceita
  col = http.createServer((req, res) => {
    let b = '';
    req.on('data', (x) => { b += x; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      let j = {}; try { j = JSON.parse(b || '{}'); } catch { /* ok */ }
      if (req.url.startsWith('/nfe/') && j.acao === 'cadastros') { res.statusCode = 409; return res.end(JSON.stringify({ erro: 'O robô da NF-e desta loja já está trabalhando.' })); }
      res.end(JSON.stringify(req.url.startsWith('/status/') ? { configurada: true, horarios: [], estado: 'parado' } : { ok: true }));
    });
  });
  await new Promise((ok) => col.listen(0, '127.0.0.1', ok));
  srv = spawn(process.execPath, ['server.js'], { cwd: RAIZ, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORTA), DATA_DIR: tmp, CONFIG_FILE, SESSION_SECRET: 'teste-seguranca-perfis', NODE_ENV: 'test', IA_FALSO: '1', UPLOAD_TOKEN: '', COOKIE_SECURE: '', PAINEL_AMBIENTE: '',
      COLETOR_URL: `http://127.0.0.1:${col.address().port}`, COLETOR_TOKEN: 'token-coletor-de-teste', GITHUB_TOKEN: '' } });
  await require('./_subir')(srv, BASE); // até 90 s, e mostra o erro do servidor se ele cair
  for (const nome of ['chefe', 'dono', 'dono2', 'dono_ia', 'ger_l1', 'ger_l2', 'ger_tudo', 'vend', 'vend_l2']) {
    const { cookie } = await entrar(nome);
    assert.ok(cookie, `login de ${nome}`);
    cookies[nome] = cookie;
  }
});
after(async () => {
  if (srv) { const fim = new Promise((ok) => srv.once('exit', ok)); srv.kill(); await fim; }
  if (col) await new Promise((ok) => col.close(ok));
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // dados temporários do teste: apaga
});

const novoUsuario = (quem, dados) => pedir(quem, '/api/admin/usuarios', corpo('POST', { senha: 'senha-nova-123', trocarSenha: false, ...dados }));
const usuariosDe = async (quem) => (await (await pedir(quem, '/api/admin/estado')).json()).usuarios;

// ---------------------------------------------------------------- PERF ----------------------------------------------------------------
test('PERF-02: só existem 4 perfis — criar ou mudar para outro perfil é recusado', async () => {
  for (const perfil of ['superadmin', 'franquia', 'dono', 'ADMIN', '', 'vendedora']) {
    const r = await novoUsuario('chefe', { nome: 'p02-' + (perfil || 'vazio').toLowerCase(), perfil, lojas: ['l1'], vendedor: 'ANA LIMA', telas: ['resumo'] });
    assert.strictEqual(r.status, 400, `perfil "${perfil}" foi aceito`);
    assert.match((await r.json()).erro, /Perfil inválido/);
  }
  assert.strictEqual((await novoUsuario('chefe', { nome: 'p02-ok', perfil: 'gerente', lojas: ['l1'], telas: ['resumo'] })).status, 200);
  assert.strictEqual(await status('chefe', '/api/admin/usuarios/p02-ok', corpo('PUT', { perfil: 'supervisor' })), 400);
  const u = (await usuariosDe('chefe')).find((x) => x.nome === 'p02-ok');
  assert.strictEqual(u.perfil, 'gerente');
  assert.ok((await usuariosDe('chefe')).every((x) => ['admin', 'franqueado', 'gerente', 'vendedor'].includes(x.perfil)));
});

test('PERF-17: franqueado cria e altera só gerentes e vendedores das próprias lojas', async () => {
  // criar
  assert.strictEqual((await novoUsuario('dono', { nome: 'p17-ger', perfil: 'gerente', lojas: ['l1'], telas: ['resumo'] })).status, 200);
  assert.strictEqual((await novoUsuario('dono', { nome: 'p17-vend', perfil: 'vendedor', lojas: ['l3'], vendedor: 'ZECA' })).status, 200);
  assert.strictEqual((await novoUsuario('dono', { nome: 'p17-adm', perfil: 'admin', lojas: ['*'] })).status, 400, 'franqueado criou admin');
  assert.strictEqual((await novoUsuario('dono', { nome: 'p17-frq', perfil: 'franqueado', lojas: ['l1'] })).status, 400, 'franqueado criou franqueado');
  assert.strictEqual((await novoUsuario('dono', { nome: 'p17-l2', perfil: 'gerente', lojas: ['l2'], telas: ['resumo'] })).status, 400, 'loja de outro franqueado');
  assert.strictEqual((await novoUsuario('dono', { nome: 'p17-l12', perfil: 'gerente', lojas: ['l1', 'l2'], telas: ['resumo'] })).status, 400, 'uma das lojas é de outro');
  assert.strictEqual((await novoUsuario('dono', { nome: 'p17-tudo', perfil: 'gerente', lojas: ['*'], telas: ['resumo'] })).status, 400, 'loja "*"');
  // gerente e vendedora não chegam às rotas de usuário
  assert.strictEqual((await novoUsuario('ger_tudo', { nome: 'p17-x', perfil: 'vendedor', lojas: ['l1'], vendedor: 'X' })).status, 403);
  assert.strictEqual((await novoUsuario('vend', { nome: 'p17-y', perfil: 'vendedor', lojas: ['l1'], vendedor: 'Y' })).status, 403);
  // lista: só os gerentes e vendedores das lojas dele
  const nomes = (await usuariosDe('dono')).map((x) => x.nome);
  for (const fora of ['chefe', 'dono', 'dono2', 'dono_ia', 'ger_l2', 'ger_l12', 'vend_l2']) assert.ok(!nomes.includes(fora), `franqueado vê ${fora}`);
  for (const dentro of ['ger_l1', 'vend', 'p17-ger', 'p17-vend']) assert.ok(nomes.includes(dentro), `franqueado não vê ${dentro}`);
  // alterar, encerrar sessões e excluir: só quem ele vê
  for (const alvo of ['chefe', 'dono2', 'dono_ia', 'ger_l2', 'ger_l12', 'vend_l2']) {
    assert.strictEqual(await status('dono', `/api/admin/usuarios/${alvo}`, corpo('PUT', { ativo: false })), 403, `alterou ${alvo}`);
    assert.strictEqual(await status('dono', `/api/admin/usuarios/${alvo}/encerrar-sessoes`, { method: 'POST' }), 403, `encerrou ${alvo}`);
    assert.strictEqual(await status('dono', `/api/admin/usuarios/${alvo}`, { method: 'DELETE' }), 403, `excluiu ${alvo}`);
  }
  assert.strictEqual(await status('dono', '/api/admin/usuarios/p17-ger', corpo('PUT', { perfil: 'franqueado' })), 400, 'promoveu a franqueado');
  assert.strictEqual(await status('dono', '/api/admin/usuarios/p17-ger', corpo('PUT', { perfil: 'admin' })), 400, 'promoveu a admin');
  assert.strictEqual(await status('dono', '/api/admin/usuarios/p17-ger', corpo('PUT', { lojas: ['l1', 'l2'] })), 400, 'levou para a loja de outro');
  assert.strictEqual(await status('dono', '/api/admin/usuarios/p17-ger', corpo('PUT', { telas: ['resumo', 'mapa'] })), 200);
  assert.strictEqual(await status('dono', '/api/admin/usuarios/p17-vend', { method: 'DELETE' }), 200);
  // o próprio franqueado não aparece para ele: não se altera
  assert.strictEqual(await status('dono', '/api/admin/usuarios/dono', corpo('PUT', { perfil: 'admin', lojas: ['*'] })), 403);
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  assert.strictEqual(cfg.usuarios.chefe.ativo, true); assert.strictEqual(cfg.usuarios.dono2.ativo, true); assert.strictEqual(cfg.usuarios.dono.perfil, 'franqueado');
  assert.strictEqual(cfg.usuarios['p17-ger'].perfil, 'gerente');
});

test('PERF-17: ninguém muda o próprio perfil, nem se desativa, nem mexe no próprio prazo; prazo só o admin', async () => {
  assert.strictEqual((await novoUsuario('chefe', { nome: 'p17-adm2', perfil: 'admin' })).status, 200);
  const { cookie } = await entrar('p17-adm2', 'senha-nova-123');
  cookies['p17-adm2'] = cookie;
  assert.strictEqual(await status('p17-adm2', '/api/admin/usuarios/p17-adm2', corpo('PUT', { perfil: 'franqueado', lojas: ['l1'] })), 400, 'mudou o próprio perfil');
  assert.strictEqual(await status('p17-adm2', '/api/admin/usuarios/p17-adm2', corpo('PUT', { ativo: false })), 400, 'se desativou');
  assert.strictEqual(await status('p17-adm2', '/api/admin/usuarios/p17-adm2', corpo('PUT', { acessoDias: 30 })), 400, 'mudou o próprio prazo');
  assert.strictEqual(await status('p17-adm2', '/api/admin/usuarios/p17-adm2', { method: 'DELETE' }), 400, 'excluiu a si mesmo');
  // prazo de acesso (ACESSO-ADMIN-01): franqueado não define nem muda
  assert.strictEqual((await novoUsuario('dono', { nome: 'p17-prz', perfil: 'gerente', lojas: ['l1'], telas: ['resumo'], acessoDias: 14 })).status, 403);
  assert.strictEqual(await status('dono', '/api/admin/usuarios/ger_l1', corpo('PUT', { acessoDias: 14 })), 403);
  assert.strictEqual(await status('dono', '/api/admin/usuarios/ger_l1', corpo('PUT', { acessoAte: '2030-01-01' })), 403);
  assert.strictEqual(await status('chefe', '/api/admin/usuarios/ger_l1', corpo('PUT', { acessoDias: 3650 })), 200);
  assert.strictEqual(await status('chefe', '/api/admin/usuarios/ger_l1', corpo('PUT', { acessoDias: 0 })), 200);
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  assert.strictEqual(cfg.usuarios['p17-adm2'].perfil, 'admin'); assert.notStrictEqual(cfg.usuarios['p17-adm2'].ativo, false);
  assert.ok(!cfg.usuarios['p17-prz']);
  assert.ok(!cfg.usuarios.ger_l1.acessoAte);
});

test('PERF-18: vendedor com uma loja e um nome de vendedor; gerente com pelo menos uma tela; admin com loja "*"', async () => {
  const erro = async (dados, re) => { const r = await novoUsuario('chefe', dados); assert.strictEqual(r.status, 400, JSON.stringify(dados)); assert.match((await r.json()).erro, re); };
  await erro({ nome: 'p18-v2', perfil: 'vendedor', lojas: ['l1', 'l2'], vendedor: 'ANA LIMA' }, /uma loja só/);
  await erro({ nome: 'p18-v0', perfil: 'vendedor', lojas: [], vendedor: 'ANA LIMA' }, /pelo menos uma loja/);
  await erro({ nome: 'p18-vsem', perfil: 'vendedor', lojas: ['l1'] }, /qual vendedor/);
  await erro({ nome: 'p18-vbr', perfil: 'vendedor', lojas: ['l1'], vendedor: '   ' }, /qual vendedor/);
  await erro({ nome: 'p18-g0', perfil: 'gerente', lojas: ['l1'], telas: [] }, /pelo menos uma tela/);
  await erro({ nome: 'p18-gx', perfil: 'gerente', lojas: ['l1'], telas: ['tela-que-nao-existe'] }, /pelo menos uma tela/);
  await erro({ nome: 'p18-gsl', perfil: 'gerente', lojas: [], telas: ['resumo'] }, /pelo menos uma loja/);
  await erro({ nome: 'p18-gin', perfil: 'gerente', lojas: ['l9'], telas: ['resumo'] }, /Loja inexistente/);
  // gerente sem telas na alteração também é recusado
  assert.strictEqual(await status('chefe', '/api/admin/usuarios/ger_l1', corpo('PUT', { telas: [] })), 400);
  // admin: sempre "*", mesmo pedindo uma loja só
  assert.strictEqual((await novoUsuario('chefe', { nome: 'p18-adm', perfil: 'admin', lojas: ['l1'] })).status, 200);
  assert.strictEqual((await novoUsuario('chefe', { nome: 'p18-vok', perfil: 'vendedor', lojas: ['l1'], vendedor: 'ana lima' })).status, 200);
  const us = await usuariosDe('chefe');
  assert.deepStrictEqual(us.find((x) => x.nome === 'p18-adm').lojas, ['*']);
  const v = us.find((x) => x.nome === 'p18-vok');
  assert.deepStrictEqual(v.lojas, ['l1']); assert.strictEqual(v.vendedor, 'ANA LIMA');
  // ninguém além do admin fica com "*"
  assert.ok(us.filter((x) => x.perfil !== 'admin').every((x) => !x.lojas.includes('*')));
});

// ---------------------------------------------------------------- SEG ----------------------------------------------------------------
test('SEG-03: senhas do SMTP e do Gmail, token do Telegram e senhas do AppNext/FIXE nunca voltam (só "tem senha")', async () => {
  const proibidos = [TOKEN_TG, SMTP_REDE, GMAIL_LOJA, FIXE_PASS, APPNEXT_PASS];
  const conferir = (txt, onde) => { for (const p of proibidos) assert.ok(!txt.includes(p), `${onde}: vazou um segredo`); assert.ok(!/"pass"\s*:/.test(txt), `${onde}: campo "pass"`); };
  const notif = await (await pedir('chefe', '/api/admin/notif')).text();
  conferir(notif, 'notif (admin)');
  const n = JSON.parse(notif);
  assert.strictEqual(n.email.temSenha, true); assert.strictEqual(n.telegram.configurado, true); assert.strictEqual(n.telegram.token, undefined);
  conferir(await (await pedir('dono', '/api/admin/notif')).text(), 'notif (franqueado)');
  for (const quem of ['chefe', 'dono']) {
    const txt = await (await pedir(quem, '/api/admin/estado')).text();
    conferir(txt, `estado (${quem})`);
    const l1 = JSON.parse(txt).lojas.find((l) => l.id === 'l1');
    assert.strictEqual(l1.fechEmail.email.temSenha, true);
    assert.strictEqual(l1.fixe.temSenha, true); assert.strictEqual(l1.coletor.temSenha, true);
  }
  // gravar o fechamento devolve a configuração, também sem a senha
  const r = await pedir('dono', '/api/admin/lojas/l1/fechamento-email', corpo('PUT', { fechamento: { ativo: false } }));
  assert.strictEqual(r.status, 200);
  const txt = await r.text();
  conferir(txt, 'fechamento-email');
  assert.strictEqual(JSON.parse(txt).fechEmail.email.temSenha, true);
  // configuração guiada: só sim/não
  conferir(await (await pedir('dono', '/api/admin/guia')).text(), 'guia');
});

test('SEG-05: token de upload — errado ou de outra loja é recusado (401), o certo passa; comparação em tempo constante', async () => {
  const up = (loja, arq, tok) => fetch(`${BASE}/api/upload/${loja}/${arq}`, { method: 'POST', headers: { ...(tok != null ? { Authorization: 'Bearer ' + tok } : {}), 'Content-Type': 'application/octet-stream' }, body: Buffer.from('x') });
  assert.strictEqual((await up('l1', 'naoexiste', null)).status, 401, 'sem token');
  assert.strictEqual((await up('l1', 'naoexiste', 'errado')).status, 401, 'token errado');
  assert.strictEqual((await up('l1', 'naoexiste', TOKEN_L1.slice(0, -1))).status, 401, 'token quase igual (um caractere a menos)');
  assert.strictEqual((await up('l1', 'naoexiste', TOKEN_L1 + 'x')).status, 401, 'token com um caractere a mais');
  assert.strictEqual((await up('l1', 'naoexiste', TOKEN_L2)).status, 401, 'token da loja 2 na loja 1');
  // certo: passa da autenticação e para na validação do nome do arquivo (400)
  assert.strictEqual((await up('l1', 'naoexiste', TOKEN_L1)).status, 400, 'token da própria loja');
  assert.strictEqual((await up('l2', 'naoexiste', TOKEN_GERAL)).status, 400, 'token geral');
  // no código: a comparação usa safeEq (hash + crypto.timingSafeEqual), nunca === com o token
  const src = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  assert.match(src, /const safeEq = \(a, b\) => crypto\.timingSafeEqual\(/);
  const ini = src.indexOf('function autenticarUpload('), fim = src.indexOf('\n}\n', ini);
  assert.ok(ini > 0 && fim > ini, 'autenticarUpload não encontrada');
  const fn = src.slice(ini, fim);
  assert.match(fn, /tokens\.some\(\(t\) => safeEq\(dado, t\)\)/);
  assert.ok(!/(dado|token|t)\s*[!=]==?\s*(dado|t|loja\.uploadToken|cfg\.uploadToken)\b/.test(fn), 'comparação direta do token');
});

test('SEG-09: troca de senha — 8 a 200 caracteres, diferente da atual, e derruba as outras sessões', async () => {
  const a = await entrar('troca'), b = await entrar('troca');
  assert.ok(a.cookie && b.cookie);
  const trocar = (cookie, o) => fetch(BASE + '/trocar-senha', { method: 'POST', redirect: 'manual', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': proximoIp() }, body: form(o) });
  const erro = async (o) => { const r = await trocar(a.cookie, o); assert.strictEqual(r.status, 302); return (r.headers.get('location') || '').replace(/^\/trocar-senha\?e=/, '').split('&')[0]; };
  assert.strictEqual(await erro({ atual: 'senha-errada-000', nova: 'outra-senha-boa', confirma: 'outra-senha-boa' }), 'atual');
  assert.strictEqual(await erro({ atual: SENHA, nova: '1234567', confirma: '1234567' }), 'curta', '7 caracteres');
  const longa = 'a'.repeat(201);
  assert.strictEqual(await erro({ atual: SENHA, nova: longa, confirma: longa }), 'curta', '201 caracteres');
  assert.strictEqual(await erro({ atual: SENHA, nova: 'outra-senha-boa', confirma: 'outra-senha-b0a' }), 'confirma');
  assert.strictEqual(await erro({ atual: SENHA, nova: SENHA, confirma: SENHA }), 'igual');
  // nada mudou até aqui: as duas sessões continuam
  assert.strictEqual((await fetch(BASE + '/api/ia/estado', { headers: { Cookie: a.cookie } })).status, 200);
  assert.strictEqual((await fetch(BASE + '/api/ia/estado', { headers: { Cookie: b.cookie } })).status, 200);
  // 8 caracteres exatos vale
  const nova = 'Nv8#chav';
  const r = await trocar(a.cookie, { atual: SENHA, nova, confirma: nova });
  assert.strictEqual(r.status, 302); assert.strictEqual(r.headers.get('location'), '/?senha=ok');
  const novoCookie = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(novoCookie.startsWith('ts_sess='), 'a sessão de quem trocou continua com um cookie novo');
  assert.strictEqual((await fetch(BASE + '/api/ia/estado', { headers: { Cookie: b.cookie } })).status, 401, 'a outra sessão caiu');
  assert.strictEqual((await fetch(BASE + '/api/ia/estado', { headers: { Cookie: a.cookie } })).status, 401, 'o cookie antigo de quem trocou também');
  assert.strictEqual((await fetch(BASE + '/api/ia/estado', { headers: { Cookie: novoCookie } })).status, 200);
  assert.strictEqual((await entrar('troca')).cookie, null, 'a senha antiga não entra mais');
  assert.ok((await entrar('troca', nova)).cookie, 'a senha nova entra');
  assert.ok(lerAud().some((e) => e.por === 'troca' && e.acao === 'trocou a própria senha'));
  assert.ok(!fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8').includes(nova), 'senha na auditoria');
});

test('SEG-10: cabeçalhos de segurança e CSP restrita nas páginas e na API', async () => {
  for (const url of ['/login', '/api/ia/estado']) {
    const r = await fetch(BASE + url, { headers: { Cookie: cookies.dono } });
    const h = (k) => r.headers.get(k) || '';
    assert.strictEqual(h('x-content-type-options'), 'nosniff', url);
    assert.strictEqual(h('x-frame-options'), 'DENY', url);
    assert.strictEqual(h('referrer-policy'), 'same-origin', url);
    assert.strictEqual(h('cross-origin-opener-policy'), 'same-origin', url);
    assert.match(h('permissions-policy'), /microphone=\(\)/, url);
    assert.strictEqual(h('x-powered-by'), '', url);
    const csp = Object.fromEntries(h('content-security-policy').split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));
    assert.deepStrictEqual(csp['default-src'], ["'self'"], url);
    assert.deepStrictEqual(csp['script-src'], ["'self'"], url + ': script-src sem inline nem servidor de fora');
    assert.deepStrictEqual(csp['connect-src'], ["'self'"], url);
    assert.deepStrictEqual(csp['frame-ancestors'], ["'none'"], url);
    assert.deepStrictEqual(csp['object-src'], ["'none'"], url);
    assert.deepStrictEqual(csp['base-uri'], ["'self'"], url);
    assert.deepStrictEqual(csp['form-action'], ["'self'"], url);
    // imagens de fora: só https dos servidores de fotos liberados, nunca curinga
    assert.ok(csp['img-src'].every((x) => ["'self'", 'data:', 'blob:'].includes(x) || /^https:\/\/[a-z0-9.-]+$/.test(x)), url + ': img-src');
    assert.ok(!Object.values(csp).flat().some((x) => x === '*' || x === "'unsafe-eval'" || x === 'http:' || x === 'https:'), url + ': curinga na CSP');
  }
});

test('SEG-11: login, sair e trocar senha só da mesma origem (Origin/Referer de fora → 403)', async () => {
  const fora = 'https://site-de-fora.exemplo.com';
  const postar = (url, headers, cookie) => fetch(BASE + url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': proximoIp(), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: form({ usuario: 'dono', senha: SENHA, atual: SENHA, nova: 'qualquer-uma-1', confirma: 'qualquer-uma-1' }) });
  for (const h of [{ Origin: fora }, { Referer: fora + '/login' }, { Origin: 'http://127.0.0.1:1' }, { Origin: 'isto não é uma url' }]) {
    const r = await postar('/login', h);
    assert.strictEqual(r.status, 403, 'login ' + JSON.stringify(h));
    assert.ok(!(r.headers.get('set-cookie') || '').includes('ts_sess='), 'login de fora ganhou sessão');
    assert.strictEqual((await postar('/logout', h, cookies.dono)).status, 403, 'logout ' + JSON.stringify(h));
    assert.strictEqual((await postar('/trocar-senha', h, cookies.dono)).status, 403, 'trocar-senha ' + JSON.stringify(h));
  }
  // o "sair" de fora não derrubou a sessão nem a troca de senha de fora mudou a senha
  assert.strictEqual((await fetch(BASE + '/api/ia/estado', { headers: { Cookie: cookies.dono } })).status, 200);
  // mesma origem passa
  const ok = await postar('/login', { Origin: BASE });
  assert.strictEqual(ok.status, 302);
  assert.ok((ok.headers.get('set-cookie') || '').includes('ts_sess='));
});

test('SEG-19: os arquivos versionados e as mensagens de commit não têm e-mail pessoal (só endereços de exemplo)', (t) => {
  // domínios de e-mail pessoal; o endereço é aceito só se a parte antes do @ for de exemplo
  const PESSOAL = /[A-Za-z0-9._%+-]+@(?:gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|bol|uol|terra|ig|protonmail|proton)\.(?:com|com\.br|me)\b/gi;
  const EXEMPLO = /^(?:usuario|usuaria|seuemail|seu\.email|email|nome|fulano|fulana|sicrano|maria\.silva|joao\.silva|cliente|teste|exemplo|outro|outra|loja|teashop\.loja|teashop\.painel|x|y|z|a|b)(?:\+[a-z0-9-]+)?$/i;
  let arquivos;
  try { arquivos = execFileSync('git', ['ls-files', '-z'], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean); } catch { t.skip('sem git nesta máquina'); return; }
  const achados = [];
  for (const f of arquivos) {
    if (/\.(png|jpe?g|gif|webp|ico|pdf|xlsx|zip|gz|br|woff2?|ttf)$/i.test(f)) continue;
    let txt; try { txt = fs.readFileSync(path.join(RAIZ, f), 'utf8'); } catch { continue; }
    if (txt.includes('\0')) continue; // binário
    for (const m of txt.matchAll(PESSOAL)) if (!EXEMPLO.test(m[0].split('@')[0])) achados.push(`${f}: …@${m[0].split('@')[1]}`);
  }
  let msgs = '';
  try { msgs = execFileSync('git', ['log', '--format=%B'], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }); } catch { /* sem histórico */ }
  for (const m of msgs.matchAll(PESSOAL)) if (!EXEMPLO.test(m[0].split('@')[0])) achados.push(`mensagem de commit: …@${m[0].split('@')[1]}`);
  // só o domínio vai para a mensagem de erro (o endereço não vai para o log do teste)
  assert.deepStrictEqual(achados, [], 'e-mail pessoal em arquivo versionado ou commit (use um endereço de exemplo)');
});

// ---------------------------------------------------------------- APP / ORC ----------------------------------------------------------------
test('APP-13: rotas que gravam exigem o cabeçalho X-Painel: 1 (sem ele ou com outro valor: 403, nada gravado)', async () => {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const rotas = [
    ['PUT', '/api/estoque/classe?loja=l1', { meses: 3 }],
    ['POST', '/api/orcamentos', { loja: 'l1', cliente: { empresa: 'Empresa Teste' }, itens: [] }],
    ['POST', '/api/checklist/marcar', { loja: 'l1', dia: hoje, tipo: 'abertura', item: 'x', feito: true }],
    ['POST', '/api/ia/perguntar', { loja: 'l1', mensagens: [{ role: 'user', content: 'oi' }] }],
    ['PUT', '/api/admin/lojas/l1/regras', { regras: null }],
    ['POST', '/api/nfe/cadastros', { loja: 'l1' }],
    ['DELETE', '/api/admin/usuarios/vend', null],
  ];
  const audAntes = lerAud().length;
  for (const [method, url, b] of rotas) {
    const opt = { method, ...(b ? { body: JSON.stringify(b) } : {}) };
    assert.strictEqual((await semX('dono', url, opt)).status, 403, `${method} ${url} sem X-Painel`);
    assert.strictEqual((await semX('dono', url, { ...opt, headers: { Cookie: cookies.dono, 'Content-Type': 'application/json', 'X-Painel': '0' } })).status, 403, `${method} ${url} com X-Painel: 0`);
  }
  assert.strictEqual(lerAud().length, audAntes, 'pedido recusado foi para a auditoria como feito');
  assert.ok(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).usuarios.vend, 'excluiu sem X-Painel');
  // com o cabeçalho, a mesma rota grava
  assert.strictEqual(await status('dono', '/api/estoque/classe?loja=l1', corpo('PUT', { meses: 3 })), 200);
});

test('ORC-01: orçamento só admin e franqueado — gerente (mesmo com a tela marcada) e vendedora recebem 403', async () => {
  const novo = { loja: 'l1', cliente: { empresa: 'Empresa Teste' }, itens: [] };
  for (const quem of ['ger_tudo', 'ger_l1', 'vend']) {
    assert.strictEqual(await status(quem, '/api/orcamentos?loja=l1'), 403, `${quem} lista`);
    assert.strictEqual(await status(quem, '/api/orcamentos', corpo('POST', novo)), 403, `${quem} cria`);
    assert.strictEqual(await status(quem, '/api/orcamentos/abc/situacao', corpo('POST', { loja: 'l1', situacao: 'aprovado' })), 403, `${quem} muda situação`);
    assert.strictEqual(await status(quem, '/api/orcamentos/abc?loja=l1', { method: 'DELETE' }), 403, `${quem} exclui`);
  }
  assert.strictEqual(await status('dono', '/api/orcamentos?loja=l1'), 200);
  assert.strictEqual(await status('chefe', '/api/orcamentos?loja=l1'), 200);
  assert.strictEqual(await status('dono', '/api/orcamentos?loja=l2'), 400, 'loja de outro franqueado');
  assert.notStrictEqual(await status('dono', '/api/orcamentos', corpo('POST', novo)), 403);
});

// ---------------------------------------------------------------- EQP ----------------------------------------------------------------
test('EQP-10: a vendedora não recebe escala, equipe, banco nem horas das colegas em /api/dados', async () => {
  const txtV = await (await pedir('vend', '/api/dados?loja=l1', { headers: { 'Accept-Encoding': 'identity' } })).text();
  assert.ok(txtV.length > 50, 'resposta vazia');
  assert.ok(!txtV.includes('BIA REIS'), 'nome da colega vazou para a vendedora (escala, equipe, feriados, banco ou férias)');
  assert.ok(!/"folga"/.test(txtV), 'escala da colega');
  const txtD = await (await pedir('dono', '/api/dados?loja=l1', { headers: { 'Accept-Encoding': 'identity' } })).text();
  assert.ok(txtD.includes('BIA REIS'), 'a gestão recebe a equipe (controle do teste)');
  // a gerente sem a tela Clientes também recebe a equipe (só a vendedora não)
  assert.ok((await (await pedir('ger_l1', '/api/dados?loja=l1', { headers: { 'Accept-Encoding': 'identity' } })).text()).includes('BIA REIS'));
});

// ---------------------------------------------------------------- PRC ----------------------------------------------------------------
test('PRC-03: Validade — custo do lote só para quem vê custos (vendedora e gerente sem tela de custo recebem nulo)', async () => {
  const lote = async (quem) => {
    const r = await pedir(quem, '/api/validade?loja=l1');
    assert.strictEqual(r.status, 200, quem);
    const j = await r.json();
    const l = j.lotes.find((x) => x.cod === '101');
    assert.ok(l, `${quem}: lote do chá não veio`);
    return { j, l, txt: JSON.stringify(j) };
  };
  const d = await lote('dono');
  assert.strictEqual(d.l.custoKg, 123.45); assert.strictEqual(d.j.custos, true);
  assert.strictEqual((await lote('ger_tudo')).l.custoKg, 123.45, 'gerente com tela de custo');
  for (const quem of ['vend', 'ger_l1']) {
    const x = await lote(quem);
    assert.strictEqual(x.l.custoKg, null, `${quem}: custo do lote`);
    assert.strictEqual(x.j.custos, false);
    assert.ok(!x.txt.includes('123.45'), `${quem}: custo em algum lugar da resposta`);
    for (const p of Object.values(x.j.resumo.porFaixa)) assert.strictEqual(p.custo, null, `${quem}: custo no resumo`);
    assert.strictEqual(x.j.resumo.risco.custo, null);
  }
  assert.strictEqual(await status('ger_l2', '/api/validade?loja=l2'), 403, 'gerente sem a tela Validade');
});

test('PRC-07: tela Site — só o preço de tabela, sem custo; vendedora e gerente sem a tela não abrem', async () => {
  const r = await pedir('ger_tudo', '/api/site?loja=l1');
  assert.strictEqual(r.status, 200);
  const txt = await r.text(), j = JSON.parse(txt);
  assert.deepStrictEqual(j.tabela, [{ cod: '101', desc: 'CHA VERDE TESTE 100G', preco: 39.9 }]);
  assert.ok(!txt.includes('17.77') && !/"custo/i.test(txt), 'custo na tela Site');
  assert.strictEqual(j.podeConsultar, false, 'gerente não dispara a consulta');
  assert.strictEqual(await status('vend', '/api/site?loja=l1'), 403);
  assert.strictEqual(await status('ger_l1', '/api/site?loja=l1'), 403);
  assert.strictEqual(await status('ger_tudo', '/api/site/consultar', corpo('POST', { loja: 'l1' })), 403);
});

test('PRC-06: configuração do estoque e classe travada — só admin e franqueado (gerente com Estoque e vendedora: 403)', async () => {
  const cfg = { entregaDias: 10, coberturaDias: 30, paradoDias: 90, segurancaPct: 20, simplesPct: 6, cartaoPct: 2 };
  for (const quem of ['ger_tudo', 'ger_l1', 'vend']) {
    assert.strictEqual(await status(quem, '/api/estoque/cfg?loja=l1', corpo('PUT', cfg)), 403, `${quem} cfg`);
    assert.strictEqual(await status(quem, '/api/estoque/classe?loja=l1', corpo('PUT', { meses: 6 })), 403, `${quem} janela da classe`);
    assert.strictEqual(await status(quem, '/api/estoque/classe?loja=l1', corpo('PUT', { cod: '101', classe: 'Estrela' })), 403, `${quem} trava a classe`);
  }
  assert.strictEqual(await status('dono', '/api/estoque/classe?loja=l1', corpo('PUT', { meses: 6 })), 200);
  assert.strictEqual(await status('chefe', '/api/estoque/classe?loja=l1', corpo('PUT', { meses: 12 })), 200);
  assert.strictEqual(await status('dono', '/api/estoque/classe?loja=l2', corpo('PUT', { meses: 6 })), 400, 'loja de outro franqueado');
  assert.notStrictEqual(await status('dono', '/api/estoque/cfg?loja=l1', corpo('PUT', cfg)), 403);
  const l1 = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).lojas.find((l) => l.id === 'l1');
  assert.strictEqual(l1.classeCfg.meses, 12);
});

// ---------------------------------------------------------------- IA ----------------------------------------------------------------
test('IA-16: pergunta à IA vai para a auditoria (sem o texto) e há limite de pedidos por pessoa (429)', async () => {
  // chave de mentira (IA_FALSO=1: nada vai para a Anthropic)
  assert.strictEqual(await status('dono_ia', '/api/ia/chave', corpo('PUT', { loja: 'l1', chave: CHAVE_IA })), 200);
  const cfgTxt = await (await pedir('dono_ia', '/api/ia/config?loja=l1')).text();
  assert.ok(!cfgTxt.includes(CHAVE_IA), 'a chave da IA voltou para a tela');
  const pergunta = 'Quanto a loja vendeu de chá verde hoje? (texto do teste)';
  const r = await pedir('dono_ia', '/api/ia/perguntar', corpo('POST', { loja: 'l1', mensagens: [{ role: 'user', content: pergunta }] }));
  assert.strictEqual(r.status, 200);
  const aud = lerAud();
  assert.ok(aud.some((e) => e.por === 'dono_ia' && e.acao === 'perguntou à IA' && e.detalhe && e.detalhe.loja === 'l1'), 'pergunta sem auditoria');
  assert.ok(aud.some((e) => e.por === 'dono_ia' && e.acao === 'cadastrou a chave da IA'));
  assert.ok(!fs.readFileSync(path.join(tmp, 'auditoria.jsonl'), 'utf8').includes(pergunta), 'texto da pergunta na auditoria');
  // vendedora e gerente não usam
  assert.strictEqual(await status('vend', '/api/ia/perguntar', corpo('POST', { loja: 'l1', mensagens: [{ role: 'user', content: 'oi' }] })), 403);
  assert.strictEqual(await status('ger_tudo', '/api/ia/perguntar', corpo('POST', { loja: 'l1', mensagens: [{ role: 'user', content: 'oi' }] })), 403);
  // limite: 150 pedidos em 15 min por pessoa (conta até pedido inválido); o 151º é recusado
  const invalido = corpo('POST', { loja: 'l1', mensagens: [] });
  for (let i = 1; i < 150; i++) assert.strictEqual(await status('dono_ia', '/api/ia/perguntar', invalido), 400, `pedido ${i + 1}`);
  const lim = await pedir('dono_ia', '/api/ia/perguntar', corpo('POST', { loja: 'l1', mensagens: [{ role: 'user', content: 'mais uma' }] }));
  assert.strictEqual(lim.status, 429);
  assert.strictEqual(await status('dono_ia', '/api/ia/pedido', corpo('POST', { loja: 'l1', dados: { itens: [{ cod: '1' }] } })), 429, 'o limite vale para a revisão do pedido também');
  // o limite é por pessoa: outro franqueado continua perguntando
  assert.notStrictEqual(await status('dono', '/api/ia/perguntar', invalido), 429);
});

// ---------------------------------------------------------------- NFE ----------------------------------------------------------------
test('NFE-04: pedido repetido para a mesma nota devolve 409 (devolução na fila, gravada ou concluída; robô ocupado)', async () => {
  for (const [id, re] of [[DEV_FILA, /já está cuidando/], [DEV_OK, /já foi gravada/], [DEV_CONCL, /já foi concluída/]]) {
    const r = await pedir('dono', `/api/devolucoes/${id}/nfe`, corpo('POST', { loja: 'l1' }));
    assert.strictEqual(r.status, 409, id);
    assert.match((await r.json()).erro, re);
  }
  // excluir com o robô gravando também espera (409)
  assert.strictEqual(await status('dono', `/api/devolucoes/${DEV_FILA}?loja=l1`, { method: 'DELETE' }), 409);
  // o coletor diz que o robô da NF-e já está trabalhando: o painel repassa 409 (não 400 nem 200)
  const r = await pedir('dono', '/api/nfe/cadastros', corpo('POST', { loja: 'l1' }));
  assert.strictEqual(r.status, 409);
  assert.match((await r.json()).erro, /já está trabalhando/);
});

test('NFE-04: mandar emitir de novo a mesma NF-e de venda é recusado e não gera um segundo pedido ao robô', async () => {
  const envio = path.join(tmp, 'l1', 'nfe', 'envio');
  const r1 = await pedir('dono', '/api/nfe/emitir', corpo('POST', { loja: 'l1', id: NFE_TESTE }));
  assert.strictEqual(r1.status, 200, 'a primeira vez vai');
  const antes = fs.readdirSync(envio).length;
  const r2 = await pedir('dono', '/api/nfe/emitir', corpo('POST', { loja: 'l1', id: NFE_TESTE }));
  assert.ok(r2.status >= 400, 'a segunda vez foi aceita');
  assert.match((await r2.json()).erro, /já foi mandada/);
  assert.strictEqual(fs.readdirSync(envio).length, antes, 'um segundo pedido foi gravado para o robô');
});

test('NFE-04: emitir de novo a mesma NF-e de venda responde 409 (como a devolução e o robô ocupado)', async () => {
  const r = await pedir('dono', '/api/nfe/emitir', corpo('POST', { loja: 'l1', id: NFE_TESTE }));
  assert.strictEqual(r.status, 409);
});
