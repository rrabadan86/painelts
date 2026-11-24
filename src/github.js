'use strict';
/**
 * Dispara e acompanha o script de cada loja no GitHub Actions.
 * Usa um token do GitHub (GITHUB_TOKEN no .env) com permissão "Actions: Read and write"
 * apenas nos repositórios das lojas. O token nunca vai para o navegador.
 */
const API = (process.env.GITHUB_API || 'https://api.github.com').replace(/\/$/, '');
const ATIVOS = new Set(['queued', 'in_progress', 'requested', 'waiting', 'pending']);

async function gh(path, { method = 'GET', body } = {}) {
  require('./config').travaHomolog('GitHub');
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw Object.assign(new Error('GITHUB_TOKEN não configurado no .env'), { codigo: 'sem_token' });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(API + path, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'teashop-painel',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch { /* sem corpo */ }
    if (!res.ok) {
      const msg = (json && json.message) || txt || res.statusText;
      const dica = res.status === 404 ? ' (repositório/workflow não encontrado ou o token não tem acesso a ele)'
        : res.status === 401 ? ' (token inválido ou expirado)'
          : res.status === 403 ? ' (o token não tem permissão "Actions: Read and write" neste repositório)' : '';
      throw Object.assign(new Error(`GitHub ${res.status}: ${msg}${dica}`), { status: res.status });
    }
    return json;
  } finally { clearTimeout(t); }
}

const caminho = (g) => `/repos/${g.repo}/actions/workflows/${encodeURIComponent(g.workflow)}`;

function resumo(run) {
  if (!run) return null;
  const ativo = ATIVOS.has(run.status);
  return {
    id: run.id,
    estado: ativo ? (run.status === 'in_progress' ? 'rodando' : 'na_fila') : (run.conclusion === 'success' ? 'ok' : 'falhou'),
    conclusao: run.conclusion,
    gatilho: run.event === 'schedule' ? 'agendado' : run.event === 'workflow_dispatch' ? 'manual' : run.event,
    inicio: run.run_started_at || run.created_at,
    criado: run.created_at,
    fim: ativo ? null : run.updated_at,
    url: run.html_url,
  };
}

async function ultimaExecucao(g) {
  const r = await gh(`${caminho(g)}/runs?per_page=1&branch=${encodeURIComponent(g.ref)}`);
  return resumo(r && r.workflow_runs && r.workflow_runs[0]);
}

async function disparar(g) {
  await gh(`${caminho(g)}/dispatches`, { method: 'POST', body: { ref: g.ref } });
}

module.exports = { ultimaExecucao, disparar };
