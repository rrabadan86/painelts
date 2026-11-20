/* Service worker do painel: só notificações.
 * - "push": mostra a notificação que o painel mandou (mensagem quebrada vira um aviso genérico, sem erro).
 * - "notificationclick": abre ou foca o painel no link recebido (só link do próprio painel, começando com "/").
 * Não guarda nenhuma página em cache: o painel continua sempre vindo do servidor. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const TITULO = 'Tea Shop · Painel', TEXTO = 'Há uma novidade no painel. Toque para abrir.';
const texto = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');
// só caminho do próprio site: "/..." e nunca "//outro-site" nem "/\outro-site"
const linkOk = (l) => (typeof l === 'string' && /^\/(?![/\\])/.test(l) && l.length < 300 ? l : '/');

self.addEventListener('push', (e) => {
  let d = null;
  try { d = e.data ? e.data.json() : null; } catch (err) { d = null; }
  if (!d || typeof d !== 'object') d = {};
  e.waitUntil(self.registration.showNotification(texto(d.titulo, 80) || TITULO, {
    body: texto(d.texto, 300) || TEXTO,
    icon: '/icones/icone-192.png',
    badge: '/icones/selo-96.png',
    tag: texto(d.tag, 40) || 'painel',
    renotify: true,
    data: { link: linkOk(d.link) },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = linkOk(e.notification.data && e.notification.data.link);
  e.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const janela = abertas.find((c) => new URL(c.url).origin === self.location.origin);
    if (janela) {
      try { await janela.focus(); if ('navigate' in janela) await janela.navigate(link); return; } catch (err) { /* abre uma nova abaixo */ }
    }
    await self.clients.openWindow(link);
  })());
});
