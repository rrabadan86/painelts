#!/usr/bin/env node
'use strict';
/**
 * Hook (PostToolUse, Bash): depois de um teste de tela que terminou bem, apaga test-results/, playwright-report/
 * e tests/.dados/ (o que a bateria deixa para trás). Se o teste falhou, o Claude Code não chama este hook
 * e as pastas ficam para investigar — lembre de apagar depois.
 * Comando em segundo plano (run_in_background) é ignorado: os testes ainda estão rodando.
 */
const fs = require('fs');
const path = require('path');

let entrada = '';
process.stdin.on('data', (c) => { entrada += c; });
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(entrada);
    const ti = j.tool_input || {};
    const cmd = String(ti.command || '');
    if (ti.run_in_background) return;
    if (!/playwright\s+test|test:e2e|test:tudo/.test(cmd)) return;
    const raiz = process.env.CLAUDE_PROJECT_DIR || j.cwd || process.cwd();
    for (const p of ['test-results', 'playwright-report', path.join('tests', '.dados')]) {
      fs.rmSync(path.join(raiz, p), { recursive: true, force: true });
    }
  } catch { /* nunca atrapalha o trabalho */ }
});
