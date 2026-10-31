/* CARDECK service worker: keeps the app itself available offline.
   Your cards never pass through here; they live in IndexedDB and on GitHub.
   The app's own files load from the network first (so updates arrive at once) and fall back to the cache offline. */
const CACHE = 'cardeck-app-v1.2.2';
const FILES = ['./', './index.html', './app.css', './app.js', './manifest.webmanifest',
  './fonts/source-serif-4.woff2', './fonts/source-serif-4-italic.woff2', './fonts/caveat-600.woff2',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png', './icons/favicon-64.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const key = e.request.mode === 'navigate' ? './index.html' : e.request;
  const stable = /\/(fonts|icons)\//.test(url.pathname);
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(key, { ignoreSearch: true });
    if (stable && hit) return hit;
    const net = fetch(e.request, { cache: 'no-cache' }).then(res => { if (res.ok) cache.put(key, res.clone()); return res; });
    if (!hit) return net;
    // Network first, but never keep you waiting more than 2.5 seconds on a slow connection.
    return Promise.race([net.catch(() => hit), new Promise(r => setTimeout(() => r(hit), 2500))]);
  }));
});
