// The phone app's service worker: every file of the app cached when it is
// installed, then served from the cache, so that the app plays offline. A new
// build is a new app, at its own address with its own cache; web/pwa.js fills
// in __BUILD__ and __FILES__.
const CACHE = "faust-elements-__BUILD__";
const FILES = __FILES__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.open(CACHE)
    .then((cache) => cache.match(event.request, { ignoreSearch: true }))
    .then((hit) => hit || fetch(event.request)));
});
