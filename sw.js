const CACHE = 'achaki-prototipo-v15';
const ASSETS = [
  './prototipo.html', './styles.css', './app.js', './favicon.png', './manifest.webmanifest',
  './assets/items/fone.jpg', './assets/items/carteira.jpg', './assets/items/chave-carro.jpg',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  const obsolete = name => name === 'achaki-v14' || (name.startsWith('achaki-prototipo-') && name !== CACHE);
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(obsolete).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => {
      const fallback = await caches.match(new URL('./prototipo.html', scope));
      return fallback || Response.error();
    }));
    return;
  }
  event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});
