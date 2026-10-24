// The static phone app's service worker (web/play/): it keeps the app's files
// for offline use, and gives each configuration its own manifest, so that
// several configurations install as several apps.
//
// - Files: the app's own (this directory) and the page's it uses (one
//   directory up), cached when the worker installs, then served from the cache
//   while the network refreshes them for the next start (stale while
//   revalidate): a republished page reaches the installed apps.
// - Pages: the app's address with its configuration (./?c=...) is served from
//   the cached ./, the configuration staying in the address.
// - Manifest: manifest.webmanifest?c=... is answered with a manifest whose
//   identity (id) is a hash of the configuration and whose start_url carries
//   it: Android installs each configuration as an app of its own, which opens
//   on its configuration. (iOS keeps the address of the page it adds to the
//   home screen, and gives each such app its own storage.)
//
// A classic worker (module workers are not everywhere yet): the configuration's
// decoding and hash are written again here, as in web/phone-config.js.
const CACHE = "faust-elements-play";
const FILES = [
  "./", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png",
  "../phone/phone.js", "../phone/phone.css", "../motion.js", "../phone-config.js", "../controls.js",
  "../elements-processor.js", "../faust-wasm-dsp.js",
  "../dsp/voice.wasm", "../dsp/voice.json", "../dsp/body.wasm", "../dsp/body.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// The app's name in a configuration (?c=BASE64URL(JSON), its field n), or null.
function configName(c) {
  try {
    const bytes = Uint8Array.from(atob(c.replaceAll("-", "+").replaceAll("_", "/")), (ch) => ch.charCodeAt(0));
    const config = JSON.parse(new TextDecoder().decode(bytes));
    return typeof config.n === "string" && config.n ? config.n : null;
  } catch {
    return null;
  }
}

// FNV-1a of a configuration's text, in base 36 (as configHash of phone-config.js).
function hash(c) {
  let h = 0x811c9dc5;
  for (let i = 0; i < c.length; i += 1) {
    h ^= c.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// The manifest of one configuration.
function manifest(c) {
  const name = configName(c) || "Elements";
  return new Response(JSON.stringify({
    name,
    short_name: name.length > 12 ? name.slice(0, 12) : name,
    id: `./?app=${hash(c)}`,
    start_url: `./?c=${c}`,
    scope: "./",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1b1b1d",
    theme_color: "#1b1b1d",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  }), { headers: { "Content-Type": "application/manifest+json" } });
}

// A cached file at once, refreshed from the network for the next time; the
// network when it is not cached yet.
async function staleWhileRevalidate(request, key) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key, { ignoreSearch: true });
  const refresh = fetch(request).then((response) => {
    if (response.ok && response.type === "basic") cache.put(key, response.clone());
    return response;
  }).catch(() => null);
  return hit || (await refresh) || new Response("offline", { status: 503 });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const here = new URL("./", self.location.href);
  if (url.href.startsWith(new URL("manifest.webmanifest", here).href) && url.searchParams.has("c")) {
    event.respondWith(manifest(url.searchParams.get("c")));
    return;
  }
  // The app's page with any configuration: the cached page itself.
  const key = request.mode === "navigate" && url.pathname === here.pathname ? new Request(here.href) : request;
  event.respondWith(staleWhileRevalidate(request, key));
});
