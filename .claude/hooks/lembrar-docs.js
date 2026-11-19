#!/usr/bin/env node
'use strict';
/**
 * Hook (PostToolUse, Bash): depois de um `git commit`, confere se o commit mexeu numa parte do painel cuja regra
 * (.claude/rules), skill ou o CLAUDE.md talvez precise de atualização — e devolve um LEMBRETE ao Claude.
 * Não bloqueia nada: o Claude decide se a mudança pede atualizar as instruções (regra nova, rota, permissão, fluxo).
 * Commit que já mexe na instrução da área, ou que só mexe em .md / .claude, não gera lembrete.
 */
const { execFileSync } = require('child_process');

const git = (args, cwd) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

// área → [arquivos de código que a definem, instrução que a descreve, o que conferir]
const AREAS = [
  { nome: 'IA', codigo: /^(src\/ia[^/]*\.js|public\/js\/ia\.js|public\/js\/inicio\.js)$/, doc: '.claude/rules/ia.md', o: 'permissões da IA, ferramentas, análise do dia, custo' },
  { nome: 'NF-e', codigo: /^(src\/(nfe|nfsaida|devolucao|brasilapi|xml[a-z]*)\.js|public\/js\/(nfsaida|devolucao|danfe|creditos|orcamento)\.js|coletor\/nextsoft_(nfe|xml)\.py)$/, doc: '.claude/rules/nfe.md', o: 'quem pode emitir, fluxo do robô, auditoria' },
  { nome: 'coletor', codigo: /^(coletor\/|src\/coletor\.js)/, doc: '.claude/rules/coletor.md', o: 'o que o robô pode gravar no AppNext/FIXE, saídas JSON' },
  { nome: 'base da tela', codigo: /^public\/js\/(core|components|main|pages)\.js$|^public\/styles\.css$/, doc: '.claude/rules/tela.md', o: 'comportamento comum de TS.table/TS.chart/celular' },
  { nome: 'testes e subida', codigo: /^(package\.json|playwright\.config\.js|\.github\/workflows\/)/, doc: '.claude/skills/subir-versao/SKILL.md', o: 'comandos de teste e o caminho até o main' },
];

let entrada = '';
process.stdin.on('data', (c) => { entrada += c; });
process.stdin.on('end', () => {
  let j;
  try { j = JSON.parse(entrada); } catch { return; }
  const ti = j.tool_input || {};
  const cmd = String(ti.command || '');
  if (!/\bgit\b[^;&|]*\bcommit\b/.test(cmd) || ti.run_in_background) return;
  const raiz = process.env.CLAUDE_PROJECT_DIR || j.cwd || process.cwd();
  // o commit acabou de ser feito agora? (evita lembrar de um commit antigo se este falhou)
  const quando = +git(['log', '-1', '--format=%ct'], raiz).trim();
  if (!quando || Date.now() / 1000 - quando > 120) return;
  const arqs = git(['diff-tree', '--no-commit-id', '--name-only', '--diff-filter=ACMRD', '-r', 'HEAD'], raiz).split('\n').map((s) => s.trim()).filter(Boolean);
  if (!arqs.length || arqs.every((f) => f.endsWith('.md') || f.startsWith('.claude/'))) return;
  const temDoc = (d) => arqs.includes(d);
  const lembretes = [];
  for (const a of AREAS) {
    const mexidos = arqs.filter((f) => a.codigo.test(f));
    if (mexidos.length && !temDoc(a.doc)) lembretes.push(`- ${a.nome} (${mexidos.slice(0, 3).join(', ')}${mexidos.length > 3 ? '…' : ''}): confira ${a.doc} — ${a.o}.`);
  }
  // tela nova, regra nova no servidor ou rota nova: o CLAUDE.md / skill nova-tela podem precisar de linha nova
  const novos = git(['diff-tree', '--no-commit-id', '--name-only', '--diff-filter=A', '-r', 'HEAD'], raiz).split('\n').filter((f) => /^(public\/js|src)\/[^/]+\.js$/.test(f));
  if (novos.length && !temDoc('CLAUDE.md')) lembretes.push(`- arquivo novo (${novos.join(', ')}): o CLAUDE.md descreve a organização do projeto e a skill nova-tela o checklist — confira se precisam citar isto.`);
  const diffServer = arqs.includes('server.js') ? git(['show', '--format=', '-U0', 'HEAD', '--', 'server.js'], raiz) : '';
  const rotas = (diffServer.match(/^\+.*\bapp\.(get|post|put|delete)\('(\/api\/[^']+)'/gm) || []).map((l) => l.match(/'(\/api\/[^']+)'/)[1]);
  if (rotas.length && !temDoc('CLAUDE.md')) lembretes.push(`- rota(s) nova(s) no server.js (${rotas.slice(0, 4).join(', ')}): se trazem regra de permissão nova (perfil, quem pode), registre no CLAUDE.md (Perfis) ou na regra da área.`);
  if (!lembretes.length) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: 'Lembrete (hook lembrar-docs): este commit mexeu em partes cujas instruções do Claude podem ter ficado desatualizadas.\n'
        + lembretes.join('\n')
        + '\nSe a mudança criou regra, permissão, fluxo ou convenção nova, atualize a instrução no mesmo PR (commit à parte "Claude: …"). Se não mudou nada que as instruções descrevam, siga sem mexer.',
    },
  }));
});
