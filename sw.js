const CACHE_NAME = "cloudsync-shell-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/about.html",
  "/docs.html",
  "/status.html",
  "/privacy.html",
  "/terms.html",
  "/contact.html",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/app-icon-192.svg",
  "/app-icon-512.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("cloudsync-shell-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // API responses may contain private file metadata or user data. Never cache them.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request).catch(() => new Response(
      JSON.stringify({ error: "The local file API is unavailable while offline." }),
      { status: 503, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }
    )));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        } catch {
          // Keep the network response usable even if browser storage is unavailable.
        }
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request) || await caches.match("/index.html");
      return cached || new Response("CloudSync is offline. Reconnect to the local server and retry.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
      });
    }));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then(async (response) => {
      if (response.ok && response.type === "basic") {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        } catch {
          // Keep the network response usable even if browser storage is unavailable.
        }
      }
      return response;
    });
  }));
});
