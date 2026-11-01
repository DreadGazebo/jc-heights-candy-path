/* Candy Trail service worker (v7.2: shell cache bumped so the activate
   step purges the v11 shell cache; navigations bypass the HTTP cache so a
   fresh deploy is never masked by a stale cached page, as since v6.4.1). */
var SHELL = 'ct-shell-v15';
var FONTS = 'ct-fonts-v6';
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
    await Promise.all(keys.map(function (k) { return (k === SHELL || k === TILES || k === FONTS) ? null : caches.delete(k); }));
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
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    /* Webfonts: cache-first (they are versioned/immutable in practice). */
    event.respondWith((async function () {
      var cache = await caches.open(FONTS);
      var hit = await cache.match(req);
      if (hit) return hit;
      var res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    event.respondWith((async function () {
      var cache = await caches.open(SHELL);
      try {
        /* Navigations go to the network bypassing the HTTP cache: the app
           is one self-contained page, and a stale cached copy (the host
           serves a 10-minute max-age) must never mask a fresh deploy. */
        var res = req.mode === 'navigate' ? await fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }) : await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        var hit = await cache.match(req, { ignoreSearch: true });
        return hit || Response.error();
      }
    })());
  }
});
