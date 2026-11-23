#!/usr/bin/env node
'use strict';
/**
 * Testa a alteração pela matriz de rastreabilidade (decisão do dono, 23/11/2026):
 *   npm run testar-alteracao                 → compara com origin/main
 *   npm run testar-alteracao -- outra-base   → compara com outra base (ramo, tag, commit)
 *   ... -- --so-listar                        → só mostra as regras afetadas, sem rodar nada
 *   ... -- --sem-telas                        → roda só os testes de unidade (e do serviço do WhatsApp)
 * 1. Junta os arquivos mexidos (commits desde a base + o que ainda não foi commitado).
 * 2. Acha na matriz (docs/rastreabilidade.md) as regras cujos arquivos estão em "Onde está".
 * 3. Roda PRIMEIRO os testes dessas regras (unidade, serviço do WhatsApp e telas nos dois aparelhos).
 * 4. Avisa as regras afetadas que estão sem teste (❌).
 * A bateria completa continua obrigatória antes de subir (skill subir-versao); isto só dá a resposta mais cedo.
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const M = require('./matriz');

const RAIZ = path.join(__dirname, '..');
const args = process.argv.slice(2);
const soListar = args.includes('--so-listar');
const semTelas = args.includes('--sem-telas');
const base = args.find((a) => !a.startsWith('--')) || 'origin/main';
const git = (a) => { try { return execFileSync('git', a, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const linhas = (t) => t.split('\n').map((s) => s.trim()).filter(Boolean);

const mexidos = new Set([
  ...linhas(git(['diff', '--name-only', `${base}...HEAD`])),
  ...linhas(git(['diff', '--name-only', 'HEAD'])),
  ...linhas(git(['ls-files', '--others', '--exclude-standard'])),
]);
if (!mexidos.size) { console.log(`Nada mexido em relação a ${base}.`); process.exit(0); }

const m = M.ler();
const regras = M.regrasDosArquivos([...mexidos], m);
const testes = new Set();
for (const r of regras) for (const t of M.testesDe(r.teste)) testes.add(t);
// teste mexido também roda
for (const f of mexidos) if (/^tests\/(unit|e2e)\/.+\.(test|spec)\.js$/.test(f) || /^zap\/tests\/.+\.test\.js$/.test(f)) testes.add(f);
const existe = (t) => fs.existsSync(path.join(RAIZ, t));
const unit = [...testes].filter((t) => t.startsWith('tests/unit/') && existe(t)).sort();
const zap = [...testes].some((t) => t.startsWith('zap/tests')) ? ['zap/tests'] : [];
const telas = [...testes].filter((t) => t.startsWith('tests/e2e/') && existe(t)).sort();
const semTeste = regras.filter((r) => r.cobertura === '❌');

console.log(`Arquivos mexidos em relação a ${base}: ${mexidos.size}`);
console.log(`Regras da matriz afetadas: ${regras.length}${regras.length ? '' : ' (nenhum arquivo mexido aparece em "Onde está")'}`);
for (const r of regras) console.log(`  ${r.cobertura || '?'} ${r.celula} — ${r.arquivos.join(', ')}`);
if (semTeste.length) {
  console.log(`\n⚠️  ${semTeste.length} regra(s) afetada(s) SEM teste: ${semTeste.map((r) => r.celula).join(', ')}`);
  console.log('   Crie o teste no mesmo PR (ou confira à mão e diga no PR) e atualize a linha da matriz.');
}
if (!mexidos.has('docs/rastreabilidade.md') && regras.length) console.log('\nℹ️  A matriz (docs/rastreabilidade.md) não foi mexida: se a regra, o teste ou a cobertura mudou, atualize a linha.');
console.log(`\nTestes das regras afetadas: ${unit.length} de unidade${zap.length ? ', o serviço do WhatsApp' : ''}, ${telas.length} de tela.`);
if (soListar || (!unit.length && !zap.length && !telas.length)) process.exit(0);

let falhou = false;
const rodar = (titulo, cmd, a, opt = {}) => {
  console.log(`\n▶ ${titulo}`);
  const r = spawnSync(cmd, a, { cwd: RAIZ, stdio: 'inherit', ...opt });
  if (r.status !== 0) { falhou = true; console.log(`✗ ${titulo}: falhou`); } else console.log(`✓ ${titulo}`);
};
if (unit.length) rodar('unidade', process.execPath, ['--test', ...unit]);
if (zap.length) rodar('serviço do WhatsApp', process.execPath, ['--test', ...fs.readdirSync(path.join(RAIZ, 'zap/tests')).filter((f) => f.endsWith('.test.js')).map((f) => `zap/tests/${f}`)]);
if (telas.length && !semTelas) {
  // config temporária com outra porta (não briga com um servidor de teste já rodando); apagada no fim
  const tmp = path.join(RAIZ, 'pw.alteracao.tmp.config.js');
  const porta = String(3400 + Math.floor(Math.random() * 90));
  fs.writeFileSync(tmp, fs.readFileSync(path.join(RAIZ, 'playwright.config.js'), 'utf8').replace(/\b3099\b/g, porta));
  try { rodar('telas (computador e celular)', 'npx', ['playwright', 'test', '-c', tmp, '--trace', 'off', '--reporter=line', ...telas]); }
  finally { fs.rmSync(tmp, { force: true }); fs.rmSync(path.join(RAIZ, 'test-results'), { recursive: true, force: true }); fs.rmSync(path.join(RAIZ, 'tests/.dados'), { recursive: true, force: true }); }
}
console.log(falhou ? '\nResultado: há teste falhando nas regras mexidas. Corrija antes de subir.' : '\nResultado: os testes das regras mexidas passaram. Antes de subir, rode a bateria completa (skill subir-versao).');
process.exit(falhou ? 1 : 0);
