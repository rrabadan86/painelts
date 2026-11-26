'use strict';
// LOGIN-APPNEXT-01 (erro visto pelo dono em 26/11/2026: "Page.fill: Timeout … waiting for input[placeholder='Rede']"):
// o login do robô espera o formulário, recarrega a página uma vez e, se o campo "Rede" não aparece, grava um diagnóstico
// sem valores digitados e para com uma mensagem clara. Todos os robôs do AppNext usam a mesma função.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const raiz = path.join(__dirname, '../..');

test('LOGIN-APPNEXT-01: todos os robôs do AppNext fazem login por preencher_login (nenhum preenche o campo Rede direto)', () => {
  for (const f of fs.readdirSync(path.join(raiz, 'coletor')).filter((x) => /^nextsoft_.*\.py$/.test(x) && x !== 'nextsoft_export_to_drive.py')) {
    const t = fs.readFileSync(path.join(raiz, 'coletor', f), 'utf8');
    assert.ok(!/fill\(nx\.SEL\["rede"\]/.test(t), `${f} preenche o login sem preencher_login`);
  }
});

test('LOGIN-APPNEXT-01: formulário que demora → recarrega uma vez e entra; que nunca aparece → diagnóstico e erro claro', (t) => {
  if (spawnSync('python3', ['--version']).status !== 0) { t.skip('sem python3'); return; }
  const prog = `
import sys, types, json, os
os.environ.update({'SAIDA_ARQUIVO': '/tmp/nao-usado.xlsx', 'APPNEXT_REDE': 'teste', 'APPNEXT_USER': 'teste', 'APPNEXT_PASS': 'teste'})  # valores de mentira: a página do teste não é o site
pw = types.ModuleType('playwright'); api = types.ModuleType('playwright.sync_api'); api.sync_playwright = None; api.TimeoutError = TimeoutError
sys.modules['playwright'] = pw; sys.modules['playwright.sync_api'] = api
# módulos que o robô usa e o ambiente de testes pode não ter (o teste só usa preencher_login)
def falso(nome, **attrs):
    try: __import__(nome)
    except ImportError:
        m = types.ModuleType(nome); m.__dict__.update(attrs); sys.modules[nome] = m
falso('dotenv', load_dotenv=lambda *a, **k: None)
falso('openpyxl', Workbook=object)
falso('openpyxl.styles', Font=object, Alignment=object)
sys.path.insert(0, ${JSON.stringify(path.join(raiz, 'coletor'))})
import nextsoft_export_to_drive as N
logs = []
N.log = lambda m: logs.append(m)
class Pagina:
    def __init__(self, aparece_apos):
        self.url = 'https://app.exemplo/#/login'; self.n = 0; self.aparece = aparece_apos; self.feitos = []
    def wait_for_selector(self, sel, state=None, timeout=None):
        self.n += 1
        if self.aparece is None or self.n < self.aparece: raise TimeoutError('timeout')
    def reload(self, **k): self.feitos.append('reload')
    def evaluate(self, js): return {'titulo': 'AppNext', 'campos': ['Usuário', 'Senha'], 'botoes': ['Entrar']}
    def fill(self, sel, v): self.feitos.append('fill')
    def click(self, sel): self.feitos.append('click')
p1 = Pagina(2); N.preencher_login(p1)
p2 = Pagina(None); erro = None
try: N.preencher_login(p2)
except RuntimeError as e: erro = str(e)
p3 = Pagina(None); p3.url = 'https://app.exemplo/#/loja/1'; N.preencher_login(p3)
class Nav:
    def __init__(self, falha): self.alvos = []; self.falha = falha
    def wait_for_timeout(self, ms): pass
    def goto(self, alvo, **k):
        self.alvos.append(alvo)
        if self.falha(alvo): raise Exception('net::ERR_CERT_COMMON_NAME_INVALID')
n1 = Nav(lambda a: False); N.goto_login_with_retries(n1, 'https://www.appnext.com.br/#/login')
n2 = Nav(lambda a: True); erro2 = None
try: N.goto_login_with_retries(n2, 'https://www.appnext.com.br/#/login', tries=1)
except RuntimeError as e: erro2 = str(e)
print(json.dumps({'p1': p1.feitos, 'p2': p2.feitos, 'erro': erro, 'p3': p3.feitos, 'diag': any('diagnóstico' in l for l in logs), 'n1': n1.alvos, 'erro2': erro2}))`;
  const r = spawnSync('python3', ['-c', prog], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(o.p1, ['reload', 'fill', 'fill', 'fill', 'click'], 'recarregou uma vez e entrou');
  assert.deepEqual(o.p2, ['reload'], 'nunca apareceu: não digita nada');
  assert.match(o.erro, /não mostrou o campo "Rede"/);
  assert.ok(o.diag, 'diagnóstico no log');
  assert.deepEqual(o.p3, [], 'já logado: não mexe');
  assert.deepEqual(o.n1, ['https://www.appnext.com.br/#/login'], 'tenta primeiro o endereço com www (o sem www está com o certificado errado)');
  assert.match(o.erro2, /Não consegui abrir o AppNext a partir do servidor/);
});

test('NF-FILA-01: o laço da fila do coletor não morre e avisa quando a fila parou; a tela não mostra mais "N na frente"', () => {
  const col = fs.readFileSync(path.join(raiz, 'coletor/coletor.py'), 'utf8');
  assert.match(col, /except BaseException as e:[^\n]*\n\s+log\(f"trabalhador: erro inesperado/);
  assert.match(col, /parado = bool\(n\) and not t and time\.time\(\) - batida_trab > 60/);
  const tela = fs.readFileSync(path.join(raiz, 'public/js/precos.js'), 'utf8');
  assert.ok(!/na frente/.test(tela));
  assert.match(tela, /roboParado/);
  assert.match(tela, /sem resposta do coletor agora; tentando de novo/, 'erro numa consulta não congela a tela em "na fila"');
});
