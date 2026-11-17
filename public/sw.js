const CACHE = 'achaki-shell-v2';
const SHELL = ['/', '/styles.css', '/app.js', '/icons.js', '/favicon.png', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/fonts/inter.woff2'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('achaki-shell-') && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const key = event.request.mode === 'navigate' && url.pathname === '/' ? '/' : url.pathname;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(key)) return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(key)) || Response.error()));
});
