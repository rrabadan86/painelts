'use strict';
/**
 * server.js — API interna do robô do WhatsApp (só o painel fala com ela, pela rede do docker compose).
 * Toda chamada exige o cabeçalho X-Zap-Token. O contrato está no README desta pasta.
 *
 * O servidor recebe a FÁBRICA do cliente do WhatsApp: na VPS é a de verdade (wa.js, carregada só
 * aqui embaixo, ao rodar); nos testes é um cliente de mentira — por isso os testes não precisam
 * da biblioteca do WhatsApp nem do Chromium.
 */
const http = require('http');
const crypto = require('crypto');
const { criarSessoes, erroCurto } = require('./sessoes');

const MAX_CORPO = 64 * 1024;

function tokenConfere(recebido, esperado) {
  if (!esperado || typeof recebido !== 'string' || !recebido) return false;   // sem ZAP_TOKEN, ninguém entra
  const a = crypto.createHash('sha256').update(recebido).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > MAX_CORPO) { reject(Object.assign(new Error('Pedido grande demais.'), { pedidoInvalido: true })); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      const txt = Buffer.concat(partes).toString('utf8').trim();
      if (!txt) return resolve({});
      try {
        const j = JSON.parse(txt);
        if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('não é objeto');
        resolve(j);
      } catch (_) { reject(Object.assign(new Error('O corpo precisa ser JSON.'), { pedidoInvalido: true })); }
    });
    req.on('error', reject);
  });
}

const ROTAS = { status: 'GET', optouts: 'GET', conversas: 'GET', conectar: 'POST', desconectar: 'POST', enviar: 'POST', historico: 'POST' };

/**
 * @param {object} opcoes  token (ZAP_TOKEN) · fabrica (cliente do WhatsApp por loja) · workDir · e o que criarSessoes aceita
 * @returns {{ servidor: http.Server, sessoes: object }}
 */
function criarServidor(opcoes = {}) {
  const token = opcoes.token || '';
  const log = opcoes.log || ((m) => console.log('[zap] ' + m));
  const sessoes = opcoes.sessoes || criarSessoes(opcoes);

  const servidor = http.createServer(async (req, res) => {
    const responder = (codigo, corpo) => {
      if (res.headersSent) return;
      const txt = JSON.stringify(corpo);
      res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(txt), 'Cache-Control': 'no-store' });
      res.end(txt);
    };
    try {
      if (!tokenConfere(req.headers['x-zap-token'], token)) return responder(401, { erro: 'Não autorizado.' });
      const url = new URL(req.url, 'http://zap');
      if (url.pathname === '/saude') {
        return req.method === 'GET' ? responder(200, { ok: true }) : responder(405, { erro: 'Método não aceito.' });
      }
      const m = /^\/([a-z]+)\/([^/]+)$/.exec(url.pathname);
      if (!m || !ROTAS[m[1]]) return responder(404, { erro: 'Não existe.' });
      const acao = m[1];
      let loja;
      try { loja = decodeURIComponent(m[2]); } catch (_) { loja = ''; }
      if (req.method !== ROTAS[acao]) return responder(405, { erro: 'Método não aceito.' });

      if (acao === 'status') return responder(200, sessoes.status(loja));
      if (acao === 'optouts') return responder(200, sessoes.optouts(loja, url.searchParams.get('desde')));
      if (acao === 'conversas') return responder(200, sessoes.conversas(loja, url.searchParams.get('desde')));
      sessoes.status(loja);                        // confere o id da loja antes de ler o corpo
      const corpo = await lerCorpo(req);
      if (acao === 'conectar') return responder(200, await sessoes.conectar(loja, corpo));
      if (acao === 'desconectar') return responder(200, await sessoes.desconectar(loja));
      if (acao === 'historico') return responder(200, sessoes.historico(loja, corpo));
      return responder(200, await sessoes.enviar(loja, corpo));
    } catch (e) {
      if (e && e.pedidoInvalido) return responder(400, { erro: e.message });
      log('erro na API: ' + erroCurto(e));
      return responder(500, { erro: 'Erro no serviço do WhatsApp.' });
    }
  });
  return { servidor, sessoes };
}

module.exports = { criarServidor, tokenConfere };

// ---------- rodando de verdade (docker) ----------
if (require.main === module) {
  const token = (process.env.ZAP_TOKEN || '').trim();
  const porta = parseInt(process.env.ZAP_PORTA || '8010', 10);
  const workDir = process.env.ZAP_WORK || '/work';
  const log = (m) => console.log(`${new Date().toISOString()} [zap] ${m}`);
  if (!token) log('ATENÇÃO: ZAP_TOKEN vazio — toda chamada será recusada. Preencha no .env e suba de novo.');

  try { require('fs').mkdirSync(workDir, { recursive: true }); require('fs').accessSync(workDir, require('fs').constants.W_OK); }
  catch (_) { log(`ATENÇÃO: sem permissão para gravar em ${workDir}. Na VPS: mkdir -p zap-work && chown -R 1000:1000 zap-work`); }

  const { fabricaReal } = require('./wa');        // a biblioteca do WhatsApp só é carregada na hora de conectar
  const { servidor, sessoes } = criarServidor({ token, workDir, fabrica: fabricaReal, log });
  servidor.listen(porta, '0.0.0.0', () => {
    log(`ouvindo na porta ${porta} (só a rede interna do compose)`);
    const voltaram = sessoes.retomar();           // só quem já estava conectado; ninguém novo é ligado sozinho
    if (!voltaram.length) log('nenhuma loja com sessão salva: aguardando o painel pedir para conectar');
  });
  const vigia = setInterval(() => { sessoes.vigiar().catch(() => {}); }, 15 * 60 * 1000);
  vigia.unref();

  let saindo = false;
  const sair = async (sinal) => {
    if (saindo) return;
    saindo = true;
    log(`${sinal}: fechando os navegadores com segurança…`);
    servidor.close();
    const limite = setTimeout(() => process.exit(0), 25000);
    try { await sessoes.fechar(); } catch (_) { /* segue */ }
    clearTimeout(limite);
    process.exit(0);
  };
  process.on('SIGTERM', () => sair('SIGTERM'));
  process.on('SIGINT', () => sair('SIGINT'));
  // Erro solto do navegador não pode derrubar as outras lojas.
  process.on('unhandledRejection', (e) => log('erro não tratado: ' + erroCurto(e)));
  process.on('uncaughtException', (e) => log('exceção não tratada: ' + erroCurto(e)));
}
