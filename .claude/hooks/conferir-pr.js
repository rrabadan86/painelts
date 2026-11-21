#!/usr/bin/env node
'use strict';
/**
 * Hook (PostToolUse, Bash): depois de um `git push` que deu certo, lembra o Claude de seguir a skill conferir-pr até o fim
 * (PR, testes do GitHub, merge com ✓, testes do main, aviso ao dono). Não bloqueia nada; só entrega o lembrete na hora.
 * Push de tag (versão de segurança) não gera lembrete.
 */
const { execFileSync } = require('child_process');
const git = (args, cwd) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

let entrada = '';
process.stdin.on('data', (c) => { entrada += c; });
process.stdin.on('end', () => {
  let j;
  try { j = JSON.parse(entrada); } catch { return; }
  const ti = j.tool_input || {};
  const cmd = String(ti.command || '');
  if (!/\bgit\b[^;&|]*\bpush\b/.test(cmd) || ti.run_in_background) return;
  if (/\bpush\b[^;&|]*\b(--tags|tag)\b|\bpush\s+origin\s+\d{8}-/.test(cmd)) return; // tag de versão
  const saida = JSON.stringify(j.tool_response || '');
  if (/rejected|error:|fatal:|failed to push/i.test(saida)) return; // o push não foi: nada a conferir ainda
  const raiz = process.env.CLAUDE_PROJECT_DIR || j.cwd || process.cwd();
  const ramo = git(['rev-parse', '--abbrev-ref', 'HEAD'], raiz);
  const sha = git(['rev-parse', 'HEAD'], raiz);
  if (!ramo || ramo === 'main' || ramo === 'HEAD') return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `Lembrete (hook conferir-pr): o ramo ${ramo} foi enviado (commit ${sha}). Siga a skill conferir-pr até o fim: `
        + 'abra o PR (ou atualize a descrição do PR aberto deste ramo), assine a atividade, agende UM lembrete com este SHA completo, '
        + 'faça o merge só com os testes do GitHub ✓, confira o run "Testes" do main e avise o dono que pode instalar. '
        + 'Lembretes agendados com outro SHA ficam vencidos.',
    },
  }));
});
