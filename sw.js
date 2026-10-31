/* JC Heights Candy Path service worker.
   Shell: network-first for pages (updates keep flowing), cache fallback offline.
   Tiles: cache-first with a bounded runtime cache, plus a precache of the
   Heights core at zoom 15-16 so the home neighborhood works offline. */
var SHELL = 'cp-shell-v1';
var TILES = 'cp-tiles-v1';

function tileXY(lat, lng, z) {
  var n = Math.pow(2, z);
  var x = Math.floor((lng + 180) / 360 * n);
  var latRad = lat * Math.PI / 180;
  var y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return [x, y];
}
function heightsTileUrls() {
  var urls = [];
  var bbox = { n: 40.763, s: 40.738, w: -74.060, e: -74.030 };
  [15, 16].forEach(function (z) {
    var a = tileXY(bbox.n, bbox.w, z), b = tileXY(bbox.s, bbox.e, z);
    for (var x = a[0]; x <= b[0]; x++) for (var y = a[1]; y <= b[1]; y++)
      urls.push('https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png');
  });
  return urls;
}
self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var shell = await caches.open(SHELL);
    await shell.addAll(['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png']).catch(function () {});
    var tiles = await caches.open(TILES);
    var urls = heightsTileUrls();
    for (var i = 0; i < urls.length; i += 8) {
      await Promise.all(urls.slice(i, i + 8).map(function (u) { return tiles.add(u).catch(function () {}); }));
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) { return (k === SHELL || k === TILES) ? null : caches.delete(k); }));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.hostname.indexOf('supabase') >= 0) return; /* live data: never cache */
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith((async function () {
      var cache = await caches.open(TILES);
      var hit = await cache.match(req);
      if (hit) return hit;
      var res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    event.respondWith((async function () {
      var cache = await caches.open(SHELL);
      try {
        var res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        var hit = await cache.match(req, { ignoreSearch: true });
        return hit || Response.error();
      }
    })());
  }
});
