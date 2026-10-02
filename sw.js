// Service Worker: アプリ本体をオフライン対応し、国土地理院タイルを端末にキャッシュする
const VERSION = 'v1.2.0';
const APP_CACHE = 'b787-app-' + VERSION;
const TILE_CACHE = 'b787-tiles-v1';
const TILE_LIMIT = 4000;   // 端末に保持する地形・写真タイルの上限枚数

const APP_SHELL = [
  './', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './css/style.css', './js/audio/sound.js', './js/data/airports.js', './js/data/navaids.js', './js/main.js',
  './js/render/aircraft.js', './js/render/airports.js', './js/render/shared.js', './js/render/terrain.js', './js/render/world.js',
  './js/sim/aircraft-787.js', './js/sim/atmosphere.js', './js/sim/autoflight.js', './js/sim/copilot.js', './js/sim/elevation.js',
  './js/sim/engines.js', './js/sim/fbw.js', './js/sim/fdm.js', './js/sim/fmc.js', './js/sim/gpws.js', './js/sim/navigation.js',
  './js/sim/simulation.js', './js/sim/systems.js', './js/ui/cdu.js', './js/ui/checklist.js', './js/ui/draw.js', './js/ui/eicas.js',
  './js/ui/hud.js', './js/ui/input.js', './js/ui/mcp.js', './js/ui/menu.js', './js/ui/nd.js', './js/ui/overhead.js',
  './js/ui/pedestal.js', './js/ui/pfd.js', './js/ui/tutorial.js', './js/util/geo.js', './js/util/math.js', './vendor/three.module.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('b787-app-') && k !== APP_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

let trimming = false;
async function trimTiles() {
  if (trimming) return;
  trimming = true;
  try {
    const c = await caches.open(TILE_CACHE);
    const keys = await c.keys();
    for (let i = 0; i < keys.length - TILE_LIMIT; i++) await c.delete(keys[i]);
  } finally { trimming = false; }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 地理院タイル: キャッシュ優先（404 の海域タイルもそのまま返す）
  if (url.hostname === 'cyberjapandata.gsi.go.jp') {
    e.respondWith((async () => {
      const c = await caches.open(TILE_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { c.put(req, res.clone()); if (Math.random() < 0.02) trimTiles(); }
      return res;
    })());
    return;
  }

  // アプリ本体: キャッシュを即返し、裏で更新（次回起動時に新版）
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(APP_CACHE);
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || (req.mode === 'navigate' ? c.match('./index.html') : Response.error());
    })());
  }
});
