#!/usr/bin/env node
'use strict';
/**
 * Hook (PreToolUse, Bash): impede que segredos e dados da loja entrem no Git.
 * Olha só comandos com `git add`, `git commit` ou `git push` e confere os arquivos que iriam junto:
 *   - já preparados para o commit (staged);
 *   - com `git add`/`commit -a`: os alterados e os novos que o .gitignore não segura;
 *   - com `git add -f`: os caminhos citados no comando (o -f passa por cima do .gitignore);
 *   - com `git push`: os arquivos dos commits que ainda não estão no GitHub.
 * Se achar algo proibido, bloqueia (código 2) e diz o porquê. Qualquer falha do próprio hook deixa passar.
 */
const { execFileSync } = require('child_process');

const PROIBIDOS = [
  [/(^|\/)\.env(\.[^/]*)?$/, '.env'],
  [/^config\/lojas\.json$/, 'config/lojas.json'],
  [/^config\/coletor\/[^/]*\.env/, 'config/coletor/*.env'],
  [/^config\/ia\.json$/, 'config/ia.json'],
  [/^config\/ia-mestra\.key$/, 'config/ia-mestra.key'],
  [/^dados\//, 'dados/'],
  [/^config\/backups\//, 'backups'],
  [/(^|\/)[^/]*backup[^/]*\.(zip|tar|gz|tgz|json)$/i, 'backups'],
];
// modelos sem segredo podem ir: .env.example, config/coletor/exemplo.env.modelo
const MODELO = /\.(example|exemplo|modelo|sample)$/i;
const proibido = (f) => { if (MODELO.test(f)) return null; const p = PROIBIDOS.find(([re]) => re.test(f)); return p && p[1]; };

function git(args, cwd) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').map((s) => s.trim()).filter(Boolean); } catch { return []; }
}

let entrada = '';
process.stdin.on('data', (c) => { entrada += c; });
process.stdin.on('end', () => {
  let cmd = '', cwd = process.cwd();
  try { const j = JSON.parse(entrada); cmd = String((j.tool_input && j.tool_input.command) || ''); cwd = j.cwd || cwd; } catch { process.exit(0); }
  if (!/\bgit\b[^;&|]*\b(add|commit|push)\b/.test(cmd)) process.exit(0);

  const raiz = git(['rev-parse', '--show-toplevel'], cwd)[0] || cwd;
  const arquivos = new Set(git(['diff', '--cached', '--name-only'], raiz));
  if (/\bgit\b[^;&|]*\badd\b/.test(cmd) || /\bgit\b[^;&|]*\bcommit\b[^;&|]*\s(-a|--all|-[a-zA-Z]*a[a-zA-Z]*)\b/.test(cmd)) {
    git(['ls-files', '--modified', '--others', '--exclude-standard'], raiz).forEach((f) => arquivos.add(f));
  }
  const addForcado = cmd.match(/\bgit\b[^;&|]*\badd\b([^;&|]*)/);
  if (addForcado && /(\s-f\b|--force)/.test(addForcado[1])) {
    addForcado[1].split(/\s+/).filter((t) => t && !t.startsWith('-')).forEach((t) => arquivos.add(t.replace(/^\.\//, '').replace(/^["']|["']$/g, '')));
  }
  if (/\bgit\b[^;&|]*\bpush\b/.test(cmd)) {
    const base = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], raiz)[0] || 'origin/main';
    git(['diff', '--name-only', `${base}...HEAD`], raiz).forEach((f) => arquivos.add(f));
  }

  const achados = [...arquivos].map((f) => [f, proibido(f)]).filter((x) => x[1]);
  if (!achados.length) process.exit(0);
  process.stderr.write(
    'BLOQUEADO: estes arquivos não podem ir para o Git (segredos ou dados da loja — regra do CLAUDE.md):\n'
    + achados.map(([f, r]) => `  - ${f}  (${r})`).join('\n')
    + '\nTire do commit (git restore --staged <arquivo>) e confira o .gitignore. Se for um commit já feito, desfaça antes do push.\n',
  );
  process.exit(2);
});
