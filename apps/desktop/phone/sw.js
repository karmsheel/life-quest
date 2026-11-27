/*
 * The phone shell, cached so the app opens with the studio quit.
 *
 * Personal data is never cached: every `/api/` request goes to the network and
 * fails when the studio is not reachable. The app renders its outbox and the
 * last metric from IndexedDB, which is the whole offline story.
 *
 * The precache list and the cache version are filled at build time by the Vite
 * plugin in `vite.config.ts`; the hashed asset names are only known then.
 */
const CACHE = `lq-phone-__CACHE_VERSION__`;
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // network only

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/phone/")));
    return;
  }

  event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request)));
});
