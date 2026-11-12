#!/usr/bin/env node
'use strict';
/**
 * Administração de lojas e usuários do painel (edita config/lojas.json).
 * O painel relê o arquivo sozinho: não precisa reiniciar.
 *
 *   node scripts/admin.js iniciar            (cria o lojas.json com a loja de Torres)
 *   node scripts/admin.js listar
 *   node scripts/admin.js loja <id> "<Nome da loja>" [meta]
 *   node scripts/admin.js drive <loja> <arquivo> <id-do-drive | ->
 *   node scripts/admin.js usuario <nome> <loja1,loja2 | *> [--senha XYZ]
 *   node scripts/admin.js remover-usuario <nome>
 *   node scripts/admin.js remover-loja <id>
 *   node scripts/admin.js copiar-drive <loja> [--todas]   (copia as planilhas do Drive para a VPS)
 *   node scripts/admin.js github <loja> <dono/repositorio | -> [workflow] [branch]
 *   node scripts/admin.js token [loja]       (sem loja: token geral; com loja: só envia para ela)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const C = require('../src/config');

const FILE = C.CONFIG_FILE;
const ARQS = Object.keys(C.ARQUIVOS);

function ler() {
  if (!fs.existsSync(FILE)) return { lojas: [], usuarios: {}, uploadToken: null };
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}
function gravar(cfg) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}
const sair = (msg) => { console.error('Erro: ' + msg); process.exit(1); };
const normId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');

function perguntarSenha(prompt) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) sair('rode com "docker compose exec" (terminal interativo) ou passe --senha');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(prompt)) rl.output.write(s); else rl.output.write(''); };
    rl.question(prompt, (v) => { rl.close(); process.stdout.write('\n'); resolve(v); });
  });
}

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  const cfg = ler();
  cfg.lojas = cfg.lojas || []; cfg.usuarios = cfg.usuarios || {};

  if (!cmd || cmd === 'ajuda' || cmd === '--help') {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 16).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
    console.log(`Arquivos de cada loja: ${ARQS.join(', ')}`);
    return;
  }

  if (cmd === 'iniciar') {
    if (fs.existsSync(FILE)) sair(`${FILE} já existe. Use os outros comandos para editar.`);
    const ex = [path.join(__dirname, '..', 'config.exemplo', 'lojas.exemplo.json'), path.join(__dirname, '..', 'config', 'lojas.exemplo.json')].find((f) => fs.existsSync(f));
    const base = ex ? JSON.parse(fs.readFileSync(ex, 'utf8')) : { lojas: [], usuarios: {} };
    base.uploadToken = crypto.randomBytes(24).toString('base64url');
    gravar(base);
    for (const l of base.lojas) fs.mkdirSync(C.pastaLoja(normId(l.id)), { recursive: true });
    console.log(`Criado ${FILE} com ${base.lojas.length} loja(s).\nToken de upload (guarde para o script diário):\n\n${base.uploadToken}\n\nAgora crie os usuários: node scripts/admin.js usuario <nome> <loja | *>`);
    return;
  }

  if (cmd === 'listar') {
    console.log(`Configuração: ${FILE}\nPasta de dados: ${C.DATA_DIR}\n`);
    for (const l of cfg.lojas) {
      console.log(`LOJA ${l.id} — ${l.nome}${l.meta ? ` (meta R$ ${l.meta})` : ''} · token próprio: ${l.uploadToken ? 'sim' : 'não'} · script: ${l.github ? l.github.repo : 'não ligado'}`);
      for (const a of ARQS) {
        const local = path.join(C.pastaLoja(normId(l.id)), `${a}.xlsx`);
        const st = fs.existsSync(local) ? fs.statSync(local) : null;
        const origem = st ? `VPS (atualizado ${st.mtime.toLocaleString('pt-BR')})` : l.drive?.[a] ? `Drive ${l.drive[a]}` : '—';
        console.log(`   ${a.padEnd(15)} ${origem}`);
      }
    }
    console.log('\nUSUÁRIOS');
    for (const [u, v] of Object.entries(cfg.usuarios)) console.log(`   ${u.padEnd(15)} lojas: ${(v.lojas || []).join(', ')}`);
    console.log(`\nToken geral de upload: ${cfg.uploadToken ? 'definido' : 'não definido'}`);
    return;
  }

  if (cmd === 'loja') {
    const [id, nome, meta] = args;
    const nid = normId(id);
    if (!nid || !nome) sair('uso: loja <id> "<Nome>" [meta]   — id só com letras minúsculas, números, - ou _');
    let l = cfg.lojas.find((x) => normId(x.id) === nid);
    if (!l) { l = { id: nid, nome, drive: {} }; cfg.lojas.push(l); } else l.nome = nome;
    if (meta !== undefined) l.meta = meta === '-' ? null : Number(meta);
    fs.mkdirSync(C.pastaLoja(nid), { recursive: true });
    gravar(cfg);
    console.log(`Loja "${nid}" salva. Pasta de dados: ${C.pastaLoja(nid)}`);
    return;
  }

  if (cmd === 'drive') {
    const [id, arq, driveId] = args;
    const l = cfg.lojas.find((x) => normId(x.id) === normId(id));
    if (!l) sair(`loja "${id}" não existe`);
    if (!ARQS.includes(arq)) sair(`arquivo deve ser um de: ${ARQS.join(', ')}`);
    l.drive = l.drive || {};
    if (!driveId || driveId === '-') delete l.drive[arq]; else l.drive[arq] = driveId;
    gravar(cfg);
    console.log(`${l.id}/${arq}: ${l.drive[arq] ? 'Drive ' + l.drive[arq] : 'sem Drive'}`);
    return;
  }

  if (cmd === 'copiar-drive') {
    const l = cfg.lojas.find((x) => normId(x.id) === normId(args[0]));
    if (!l) sair('uso: copiar-drive <loja> [--todas]   (--todas também substitui as que já estão na VPS)');
    const todas = args.includes('--todas');
    const { baixarDriveId } = require('../src/sources');
    const pasta = C.pastaLoja(normId(l.id));
    fs.mkdirSync(pasta, { recursive: true });
    let ok = 0, falhas = 0;
    for (const [arq, id] of Object.entries(l.drive || {})) {
      const destino = path.join(pasta, `${arq}.xlsx`);
      if (fs.existsSync(destino) && !todas) { console.log(`   ${arq.padEnd(15)} já está na VPS (mantido)`); continue; }
      try {
        const buf = await baixarDriveId(id);
        const tmp = destino + '.tmp';
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, destino);
        console.log(`   ${arq.padEnd(15)} copiado (${Math.round(buf.length / 1024)} KB)`);
        ok++;
      } catch (e) {
        console.log(`   ${arq.padEnd(15)} FALHOU: ${e.message}`);
        falhas++;
      }
    }
    console.log(`\n${ok} copiado(s), ${falhas} falha(s). O painel passa a usar as cópias da VPS no próximo acesso.`);
    if (!falhas) console.log('Para atualizar uma dessas planilhas no futuro, rode este comando de novo com --todas, ou envie o arquivo pela rota de upload.');
    return;
  }

  if (cmd === 'github') {
    const [id, repo, workflow, ref] = args;
    const l = cfg.lojas.find((x) => normId(x.id) === normId(id));
    if (!l) sair(`loja "${id}" não existe`);
    if (!repo) sair('uso: github <loja> <dono/repositorio> [workflow=run.yml] [branch=main]   (use - para remover)');
    if (repo === '-') delete l.github;
    else {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) sair('repositório no formato dono/nome, ex.: rrabadan86/TS---Palmas');
      l.github = { repo, workflow: workflow || 'run.yml', ref: ref || 'main' };
    }
    gravar(cfg);
    console.log(l.github ? `${l.id}: botão de atualização vai disparar ${l.github.repo} (${l.github.workflow}, branch ${l.github.ref})` : `${l.id}: botão de atualização desligado`);
    if (l.github && !process.env.GITHUB_TOKEN) console.log('Atenção: falta GITHUB_TOKEN no .env (veja o README).');
    return;
  }

  if (cmd === 'usuario') {
    const nome = String(args[0] || '').trim().toLowerCase();
    const lojas = String(args[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!nome || !lojas.length) sair('uso: usuario <nome> <loja1,loja2 | *> [--senha XYZ]');
    for (const l of lojas) if (l !== '*' && !cfg.lojas.some((x) => normId(x.id) === normId(l))) sair(`loja "${l}" não existe (crie com: loja ${l} "Nome")`);
    const i = args.indexOf('--senha');
    let senha = i >= 0 ? args[i + 1] : null;
    if (!senha) {
      senha = await perguntarSenha(`Senha para ${nome}: `);
      const conf = await perguntarSenha('Repita a senha: ');
      if (senha !== conf) sair('as senhas não conferem');
    }
    if (String(senha).length < 8) sair('use pelo menos 8 caracteres');
    cfg.usuarios[nome] = { senha: C.hashSenha(senha), lojas: lojas.map((l) => (l === '*' ? '*' : normId(l))) };
    gravar(cfg);
    console.log(`Usuário "${nome}" salvo com acesso a: ${lojas.join(', ')}`);
    return;
  }

  if (cmd === 'remover-usuario') {
    const nome = String(args[0] || '').toLowerCase();
    if (!cfg.usuarios[nome]) sair(`usuário "${nome}" não existe`);
    delete cfg.usuarios[nome];
    gravar(cfg);
    console.log(`Usuário "${nome}" removido.`);
    return;
  }

  if (cmd === 'remover-loja') {
    const nid = normId(args[0]);
    const n = cfg.lojas.length;
    cfg.lojas = cfg.lojas.filter((x) => normId(x.id) !== nid);
    if (cfg.lojas.length === n) sair(`loja "${nid}" não existe`);
    gravar(cfg);
    console.log(`Loja "${nid}" removida (os arquivos em ${C.pastaLoja(nid)} foram mantidos).`);
    return;
  }

  if (cmd === 'token') {
    const novo = crypto.randomBytes(24).toString('base64url');
    if (args[0]) {
      const l = cfg.lojas.find((x) => normId(x.id) === normId(args[0]));
      if (!l) sair(`loja "${args[0]}" não existe`);
      l.uploadToken = novo;
      gravar(cfg);
      console.log(`Novo token da loja ${l.id} (só envia arquivos para ela):\n\n${novo}\n\nColoque no secret PAINEL_TOKEN do repositório da loja. O token anterior desta loja deixou de funcionar.`);
    } else {
      cfg.uploadToken = novo;
      gravar(cfg);
      console.log(`Novo token GERAL (envia para qualquer loja):\n\n${novo}\n\nO token geral anterior deixou de funcionar. Prefira tokens por loja: node scripts/admin.js token <loja>`);
    }
    return;
  }

  sair(`comando desconhecido: ${cmd}. Rode sem argumentos para ver a ajuda.`);
})();
