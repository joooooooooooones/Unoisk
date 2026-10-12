// Service worker: gør Unoisk installerbar og lader appen starte uden net.
// Netværk først, så en ny version altid hentes, når der er forbindelse.

const CACHE = 'unoisk-v5';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/game.js',
  'js/host.js',
  'js/net.js',
  'js/bot.js',
  'js/avatars.js',
  'js/fx.js',
  'js/sound.js',
  'vendor/peerjs.min.js',
  'vendor/qrcode.js',
  'vendor/fonts/nunito-latin-wght-normal.woff2',
  'manifest.webmanifest',
  'icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })),
  );
});
