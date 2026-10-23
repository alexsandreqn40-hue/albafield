/* Alba Field · service worker: la app abre y funciona sin señal. */
const VERSION = 'geofield-1.0.0';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/db.js', 'js/geo.js', 'js/photo.js', 'js/exports.js', 'js/onedrive.js', 'js/app.js',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/jszip.min.js', 'vendor/piexif.js',
  'vendor/images/layers.png', 'vendor/images/layers-2x.png', 'vendor/images/marker-icon.png', 'vendor/images/marker-icon-2x.png', 'vendor/images/marker-shadow.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'guia.html',
];
const TILE_CACHE = 'gf-osm-tiles', OFFLINE_TILES = 'gf-offline-tiles', MAX_TILES = 4000;
const EMPTY_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('geofield-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Teselas del mapa offline importado (ZIP XYZ)
  if (url.origin === location.origin && url.pathname.includes('/_tiles/')) {
    e.respondWith(caches.open(OFFLINE_TILES).then(c => c.match(url.href)).then(r => r || new Response(EMPTY_PNG, { headers: { 'Content-Type': 'image/png' } })));
    return;
  }
  // Teselas OpenStreetMap: lo que se vio con señal queda disponible sin señal
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith((async () => {
      const c = await caches.open(TILE_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok || r.type === 'opaque') { c.put(req, r.clone()); trim(c); }
        return r;
      } catch (_) { return new Response(EMPTY_PNG, { headers: { 'Content-Type': 'image/png' } }); }
    })());
    return;
  }
  if (url.origin !== location.origin) return; // Microsoft login / Graph: siempre red

  // App: navegación con red primero (actualiza), sin señal → caché
  if (req.mode === 'navigate') {
    // con señal débil no se espera más de 3,5 s: se abre la copia guardada
    const net = fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put('index.html', cp)); } return r; });
    const slow = new Promise(res => setTimeout(res, 3500)).then(() => caches.match('index.html', { ignoreSearch: true }));
    e.respondWith(Promise.race([net.catch(() => null), slow]).then(r => r || net.catch(() => caches.match('index.html', { ignoreSearch: true })))
      .then(r => r || caches.match('index.html', { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});

let trimming = false;
async function trim(c) {
  if (trimming) return; trimming = true;
  try { const ks = await c.keys(); if (ks.length > MAX_TILES) for (const k of ks.slice(0, ks.length - MAX_TILES)) await c.delete(k); }
  finally { trimming = false; }
}
