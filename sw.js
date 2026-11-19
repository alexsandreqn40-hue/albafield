/* Alba Field · service worker: la app abre y funciona sin señal, y envía fotos y audios en segundo plano
   cuando vuelve la señal (Background Sync en Android/Chrome), aunque la app esté cerrada. */
importScripts('js/db.js', 'js/drive.js', 'js/sync.js');
const VERSION = 'albafield-2.3.0';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/db.js', 'js/geo.js', 'js/photo.js', 'js/exports.js', 'js/drive.js', 'js/sync.js', 'js/app.js', 'drive/Code.gs',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/jszip.min.js', 'vendor/piexif.js', 'vendor/qrcode.js',
  'vendor/images/layers.png', 'vendor/images/layers-2x.png', 'vendor/images/marker-icon.png', 'vendor/images/marker-icon-2x.png', 'vendor/images/marker-shadow.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'guia.html',
];
const TILE_CACHE = 'gf-osm-tiles', OFFLINE_TILES = 'gf-offline-tiles', MAX_TILES = 4000;
// tesela vacía TRANSPARENTE (antes era un píxel azul: sin señal el mapa quedaba todo azul)
const EMPTY_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmNgYGBgAAAABQABGWkDzwAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => (k.startsWith('geofield-') || k.startsWith('albafield-')) && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
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
  if (url.origin !== location.origin) return; // Google Drive (Apps Script): siempre red

  // App: siempre la versión instalada completa (pantalla y código juntos). Las versiones nuevas se descargan
  // enteras en segundo plano y se activan de una vez: nunca queda la pantalla nueva con el código viejo.
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(VERSION).then(c => c.match('index.html')).then(r => r || fetch(req).catch(() => caches.match('index.html', { ignoreSearch: true }))));
    return;
  }
  e.respondWith(caches.open(VERSION).then(c => c.match(req, { ignoreSearch: true })).then(hit => hit || caches.match(req, { ignoreSearch: true })).then(hit => hit || fetch(req)));
});

let trimming = false;
async function trim(c) {
  if (trimming) return; trimming = true;
  try { const ks = await c.keys(); if (ks.length > MAX_TILES) for (const k of ks.slice(0, ks.length - MAX_TILES)) await c.delete(k); }
  finally { trimming = false; }
}

/* Envío en segundo plano: el navegador lo dispara al volver la señal y lo reintenta si falla */
self.addEventListener('sync', e => {
  if (e.tag !== 'albafield-media') return;
  e.waitUntil((async () => {
    const r = await Sync.run({});
    const cs = await self.clients.matchAll({ type: 'window' });
    cs.forEach(c => c.postMessage({ type: 'albafield-synced', result: { ok: r.ok, failed: r.failed, left: r.left, aborted: r.aborted || null } }));
    if (r.left && r.kind === 'net') throw new Error('pendientes');   // el navegador reprograma el intento
  })());
});
