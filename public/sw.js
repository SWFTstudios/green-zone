// Keeps the app shell available when signal drops mid-drive. API calls always go to the network.
const CACHE = "green-zone-v3";
const SHELL = [
  "/",
  "/index.html",
  "/app.js",
  "/styles.css",
  "/icon.svg",
  "/manifest.webmanifest",
  "/vendor/maplibre/maplibre-gl.mjs",
  "/vendor/maplibre/maplibre-gl-worker.mjs",
  "/vendor/maplibre/maplibre-gl.css",
  "/gzmap.js",
  "/explore.js",
  "/areas-core.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Network first so deploys show up right away; fall back to the cached shell offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/index.html"))),
  );
});
