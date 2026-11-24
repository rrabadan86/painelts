// HOMOLOG-02: o atualizador da VPS (scripts/atualizador.sh) em repositórios de mentira, com um "docker" de mentira.
//  - produção sem versão liberada: segue o main testado (como sempre foi);
//  - produção com versão liberada (tag versao-AAAA-MM-DD): instala só a versão liberada, nunca o main à frente dela;
//  - homologação (.env com PAINEL_AMBIENTE=homologacao): instala sozinha a versão testada mais nova, com o compose dela.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atualizador-'));
const SCRIPT = path.join(__dirname, '../../scripts/atualizador.sh');
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...a], { cwd, encoding: 'utf8' }).trim();
const sha = {};
const fakeBin = path.join(tmp, 'bin');

before(() => {
  // docker de mentira: anota a chamada
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'docker'), '#!/bin/sh\necho "docker $*" >> "$DOCKER_LOG"\nexit 0\n', { mode: 0o755 });
  // origem com 3 versões no main e o ramo "testes" dizendo que todas passaram
  const origem = path.join(tmp, 'origem.git');
  git(tmp, 'init', '-q', '--bare', origem);
  const trab = path.join(tmp, 'trab');
  git(tmp, 'clone', '-q', origem, trab);
  for (const n of ['c1', 'c2', 'c3']) { fs.writeFileSync(path.join(trab, 'v.txt'), n); git(trab, 'add', '.'); git(trab, 'commit', '-q', '-m', n); sha[n] = git(trab, 'rev-parse', 'HEAD'); }
  git(trab, 'push', '-q', 'origin', 'HEAD:main');
  git(trab, 'checkout', '-q', '--orphan', 'testes'); git(trab, 'rm', '-rq', '--cached', '.');
  fs.writeFileSync(path.join(trab, 'resultados.txt'), ['c1', 'c2', 'c3'].map((n) => `${sha[n]}\tsuccess\t2026-11-24\thttp://x\n`).join(''));
  git(trab, 'add', 'resultados.txt'); git(trab, 'commit', '-q', '-m', 'testes'); git(trab, 'push', '-q', 'origin', 'HEAD:testes');
});
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })); // dados temporários do teste: apaga

/** uma instalação (produção ou homologação) parada em c1, com o script do projeto */
function instalacao(nome, env = '') {
  const dir = path.join(tmp, nome);
  git(tmp, 'clone', '-q', path.join(tmp, 'origem.git'), dir);
  git(dir, 'reset', '-q', '--hard', sha.c1);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'atualizador.sh'));
  fs.writeFileSync(path.join(dir, '.git', 'info', 'exclude'), 'scripts/\n.env\ndados/\n.atualizador/\n');
  if (env) fs.writeFileSync(path.join(dir, '.env'), env);
  return dir;
}
const rodar = (dir) => execFileSync('bash', [path.join(dir, 'scripts', 'atualizador.sh')], { env: { ...process.env, ATUALIZADOR_PATH_TESTE: fakeBin, DOCKER_LOG: path.join(dir, 'docker.log') }, encoding: 'utf8' });
const pedir = (dir) => fs.writeFileSync(path.join(dir, 'dados', '_sistema', 'atualizar.pedido'), 'chefe\n');
const instalado = (dir) => git(dir, 'rev-parse', 'HEAD');
const dockerLog = (dir) => { try { return fs.readFileSync(path.join(dir, 'docker.log'), 'utf8'); } catch { return ''; } };

test('HOMOLOG-02: produção sem versão liberada segue o main testado, como sempre', () => {
  const dir = instalacao('prod-main');
  rodar(dir);
  pedir(dir); rodar(dir);
  assert.strictEqual(instalado(dir), sha.c3);
  assert.match(dockerLog(dir), /docker compose up -d --build/);
  assert.doesNotMatch(dockerLog(dir), /homolog/);
});

test('HOMOLOG-02: com versão liberada, a produção instala só ela (o main à frente fica para a próxima versão)', () => {
  git(path.join(tmp, 'trab'), 'tag', '-a', 'versao-2026-11-25', sha.c2, '-m', 'Versão de 25/11: robô e conversas');
  git(path.join(tmp, 'trab'), 'push', '-q', 'origin', 'versao-2026-11-25');
  const dir = instalacao('prod-versao');
  rodar(dir);
  const v = fs.readFileSync(path.join(dir, 'dados', '_sistema', 'versao.txt'), 'utf8');
  assert.match(v, /^trilho\tversoes$/m);
  assert.match(v, /^versao\tversao-2026-11-25\t\w+\tVersão de 25\/11: robô e conversas$/m);
  assert.ok(!fs.existsSync(path.join(dir, 'dados', '_sistema', 'atualizar.pedido')), 'a produção nunca instala sozinha');
  pedir(dir); rodar(dir);
  assert.strictEqual(instalado(dir), sha.c2, 'parou na versão liberada, não no c3');
  assert.match(fs.readFileSync(path.join(dir, 'dados', '_sistema', 'status.txt'), 'utf8'), /versao-2026-11-25/);
  // sem versão nova: pedir de novo não muda nada
  pedir(dir); rodar(dir);
  assert.strictEqual(instalado(dir), sha.c2);
});

test('HOMOLOG-02: a homologação instala sozinha a versão testada mais nova, com o compose dela e sem backup', () => {
  const dir = instalacao('homolog', 'PAINEL_AMBIENTE=homologacao\n');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'backup.sh'), 'touch "$(dirname "$0")/../BACKUP_RODOU"\n');
  rodar(dir); // verifica e deixa o pedido automático
  rodar(dir); // instala
  assert.strictEqual(instalado(dir), sha.c3, 'segue o main, não a versão liberada');
  assert.match(dockerLog(dir), /docker compose -p teashop-homolog -f docker-compose\.homolog\.yml up -d --build/);
  assert.match(fs.readFileSync(path.join(dir, 'dados', '_sistema', 'versao.txt'), 'utf8'), /^ambiente\thomologacao$/m);
  assert.ok(!fs.existsSync(path.join(dir, 'BACKUP_RODOU')), 'a homologação não faz backup');
});
