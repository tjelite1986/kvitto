// v2: the SVG icon was replaced by a PNG icon set — bump so the cached SVG goes.
const CACHE = "kvitto-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls always go straight to the network
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Next.js static files: cache-first (content-hashed)
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, clone));
            return res;
          })
      )
    );
    return;
  }

  // Icons: cache-first
  if (
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".ico")
  ) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, clone));
            return res;
          })
      )
    );
    return;
  }

  // Pages: network-first, fall back to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
