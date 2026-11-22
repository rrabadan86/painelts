'use strict';
// Site público do painel (public/site): a página técnica fala de TODAS as regras, skills e travas que existem no projeto.
// Criou skill, regra ou hook novo: acrescente na página (este teste avisa).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..', '..');
const tec = fs.readFileSync(path.join(raiz, 'public', 'site', 'tecnico.html'), 'utf8');
const ini = fs.readFileSync(path.join(raiz, 'public', 'site', 'index.html'), 'utf8');

test('SITE-02: a página técnica cita cada skill, cada arquivo de regras e cada trava automática do projeto', () => {
  const skills = fs.readdirSync(path.join(raiz, '.claude', 'skills')).filter((d) => fs.existsSync(path.join(raiz, '.claude', 'skills', d, 'SKILL.md')));
  const regras = fs.readdirSync(path.join(raiz, '.claude', 'rules')).filter((f) => f.endsWith('.md'));
  const cfg = JSON.parse(fs.readFileSync(path.join(raiz, '.claude', 'settings.json'), 'utf8'));
  const hooks = [...new Set([...JSON.stringify(cfg.hooks || {}).matchAll(/hooks\/([\w-]+)\.js/g)].map((m) => m[1]))];
  assert.ok(skills.length >= 6 && regras.length >= 6 && hooks.length >= 5);
  for (const s of skills) assert.ok(tec.includes(`<code>${s}</code>`), `falta a skill "${s}" na página técnica`);
  for (const r of regras) assert.ok(tec.includes(`<code>${r}</code>`), `falta o arquivo de regras "${r}" na página técnica`);
  for (const h of hooks) assert.ok(tec.includes(`<code>${h}</code>`), `falta a trava "${h}" na página técnica`);
});

test('SITE-03: o site diz que é projeto independente e não promete o que as regras proíbem', () => {
  for (const h of [ini, tec]) {
    // decisão do dono (22/11/2026): a frase não diz mais "para a própria operação" (o painel pode ser oferecido a outros franqueados)
    assert.match(h, /Projeto independente, criado por um franqueado a partir da operação das próprias lojas\. Não é produto da franqueadora nem da NextSoft/);
    assert.ok(!/própria operação/.test(h));
    assert.ok(!/<script/i.test(h));
  }
  assert.match(ini, /Finalizar o pedido continua sendo com você/);
  assert.match(ini, /dados fictícios/);
});
