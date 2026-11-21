#!/usr/bin/env node
'use strict';
/**
 * Hook (PreToolUse, Bash): antes de um `git commit`, se o favorito do carrinho (public/js/carrinho-site.js) ou o robô do
 * Sistema de Pedidos (coletor/nextsoft_pedido.py) foram mexidos, roda os testes deles em páginas de mentira (skill
 * testar-favorito). Falhou: o commit é BLOQUEADO até corrigir. Não abre o site da franquia; não precisa do servidor.
 */
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const ALVOS = ['public/js/carrinho-site.js', 'coletor/nextsoft_pedido.py'];
const git = (args, cwd) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

let entrada = '';
process.stdin.on('data', (c) => { entrada += c; });
process.stdin.on('end', () => {
  let j;
  try { j = JSON.parse(entrada); } catch { process.exit(0); }
  const cmd = String((j.tool_input && j.tool_input.command) || '');
  if (!/\bgit\b[^;&|]*\bcommit\b/.test(cmd)) process.exit(0);
  const raiz = process.env.CLAUDE_PROJECT_DIR || j.cwd || process.cwd();
  // o que vai entrar: o que já está no stage, o que está mexido e não foi adicionado (git commit -a / git add no mesmo comando)
  const mexidos = new Set([...git(['diff', '--cached', '--name-only'], raiz).split('\n'), ...git(['diff', '--name-only'], raiz).split('\n')].map((s) => s.trim()).filter(Boolean));
  const tocados = ALVOS.filter((a) => mexidos.has(a) || cmd.includes(a));
  if (!tocados.length) process.exit(0);
  const rodar = (bin, args) => spawnSync(bin, args, { cwd: raiz, encoding: 'utf8', timeout: 240000, env: { ...process.env, CI: '' } });
  const falhas = [];
  const u = rodar(process.execPath, ['--test', 'tests/unit/carrinho-salvo.test.js']);
  if (u.status !== 0) falhas.push('tests/unit/carrinho-salvo.test.js\n' + String(u.stdout || '').split('\n').filter((l) => /^not ok|error:|expected|actual/i.test(l.trim())).slice(0, 12).join('\n'));
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const e = rodar(npx, ['playwright', 'test', '-c', path.join('.claude', 'hooks', 'pw-favorito.config.js'), '--reporter=line']);
  if (e.status !== 0) falhas.push('tests/e2e/carrinho-conjunta.spec.js\n' + String((e.stdout || '') + (e.stderr || '')).split('\n').filter((l) => /✘|failed|Error:|Expected|Received|›/.test(l)).slice(0, 15).join('\n'));
  if (!falhas.length) process.exit(0);
  process.stderr.write(`Commit bloqueado (hook testar-favorito): ${tocados.join(' e ')} mudou e os testes do favorito/robô em páginas de mentira falharam.\n`
    + falhas.join('\n\n') + '\nSiga a skill testar-favorito: corrija, rode de novo e só então faça o commit. Nunca desligue o teste.\n');
  process.exit(2);
});
